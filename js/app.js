// app.js — UI wiring: file I/O, pan/zoom, selection, editing tools, history.

(function () {
  'use strict';

  const S = window.SExpr;
  const M = window.KiModel;

  const canvas = document.getElementById('canvas');
  const renderer = new window.KiRenderer(canvas);

  const els = {
    fileInput: document.getElementById('fileInput'),
    sampleBtn: document.getElementById('sampleBtn'),
    saveBtn: document.getElementById('saveBtn'),
    undoBtn: document.getElementById('undoBtn'),
    redoBtn: document.getElementById('redoBtn'),
    fitBtn: document.getElementById('fitBtn'),
    zoomInBtn: document.getElementById('zoomInBtn'),
    zoomOutBtn: document.getElementById('zoomOutBtn'),
    gridChk: document.getElementById('gridChk'),
    fieldsBtn: document.getElementById('fieldsBtn'),
    fileName: document.getElementById('fileName'),
    dirtyFlag: document.getElementById('dirtyFlag'),
    dropHint: document.getElementById('dropHint'),
    coords: document.getElementById('coords'),
    canvasWrap: document.getElementById('canvasWrap'),
    propContent: document.getElementById('propContent'),
    sidebar: document.getElementById('sidebar'),
    sidebarHeader: document.getElementById('sidebarHeader'),
  };

  // On mobile the sidebar header acts as a drag handle to expand/collapse.
  els.sidebarHeader.addEventListener('click', function () {
    els.sidebar.classList.toggle('open');
  });

  const state = {
    schem: null,
    filename: 'schematic.kicad_sch',
    dirty: false,
    sel: [],                    // array of {kind, node}
    tool: 'select',             // active placement tool
    placePart: null,            // libId when the 'part' tool is active
    // On-canvas field visibility overrides, key -> bool. A key absent from
    // this map falls back to the default rule in isFieldVisible(): only
    // Reference/Value show by default, everything else (Footprint, Datasheet,
    // Description, custom fields, ...) is hidden until the user opts in. This
    // is independent of each field's own (effects ... hide) flag in the file.
    fieldVisibility: {},
  };

  function isFieldVisible(key) {
    if (Object.prototype.hasOwnProperty.call(state.fieldVisibility, key)) {
      return state.fieldVisibility[key];
    }
    return key === 'Reference' || key === 'Value';
  }
  renderer.fieldFilter = isFieldVisible;

  // In-progress wire/bus drawing: `last` is the fixed end of the next segment.
  const wireDraft = { last: null, kind: 'wire' };

  // --- tool switching -------------------------------------------------------

  const toolButtons = Array.prototype.slice.call(document.querySelectorAll('#toolsBar .tool'));
  const powerSel = document.getElementById('powerSel');

  function setTool(tool) {
    state.tool = tool;
    cancelDraft();
    if (tool !== 'select') setSelection([]);
    toolButtons.forEach(function (b) {
      b.classList.toggle('active', b.dataset.tool === tool);
    });
    if (tool !== 'part') state.placePart = null;
    const pb = document.getElementById('partBtn');
    if (pb) pb.classList.toggle('active', tool === 'part');
    canvas.classList.toggle('crosshair', tool !== 'select');
  }

  function cancelDraft() {
    wireDraft.last = null;
    renderer.draft = null;
    renderer.render();
  }

  toolButtons.forEach(function (b) {
    b.addEventListener('click', function () { setTool(b.dataset.tool); });
  });
  powerSel.addEventListener('change', function () { setTool('power'); });

  // --- part chooser ---------------------------------------------------------

  const partModal = document.getElementById('partModal');
  const partList = document.getElementById('partList');
  const partBtn = document.getElementById('partBtn');
  const partClose = document.getElementById('partClose');
  const partSearch = document.getElementById('partSearch');
  const symImport = document.getElementById('symImport');

  // Extra library defs imported from user .kicad_sym files (libId -> {def,...}).
  const importedParts = {};

  function buildPartList() {
    partList.innerHTML = '';
    function addItem(libId, meta) {
      const div = document.createElement('div');
      div.className = 'part-item';
      div.textContent = meta.label || libId;
      div.title = libId;
      div.dataset.search = (meta.label || '') + ' ' + libId;
      div.addEventListener('click', function () { choosePart(libId); });
      partList.appendChild(div);
    }
    window.KiParts.ORDER.forEach(function (id) { addItem(id, window.KiParts.PARTS[id]); });
    Object.keys(importedParts).forEach(function (id) { addItem(id, importedParts[id]); });
    applyPartFilter();
  }

  // Show/hide part-item cards by whether their label/libId contains the query
  // (case-insensitive); an empty query shows everything. Once the standard
  // library index is loaded, a 2+ character query also searches all of it.
  function applyPartFilter() {
    const q = partSearch.value.trim().toLowerCase();
    let visible = 0;
    Array.prototype.forEach.call(partList.querySelectorAll('.part-item:not(.std)'), function (el) {
      const match = !q || el.dataset.search.toLowerCase().indexOf(q) >= 0;
      el.classList.toggle('filtered-out', !match);
      if (match) visible++;
    });

    Array.prototype.forEach.call(
      partList.querySelectorAll('.std-divider, .part-item.std'),
      function (el) { el.remove(); });
    if (stdIndex && q.length >= 2) {
      const matches = [];
      for (let i = 0; i < stdIndex.symbols.length && matches.length < 100; i++) {
        const s = stdIndex.symbols[i]; // [lib, name, refPrefix, description]
        if ((s[0] + ':' + s[1] + ' ' + s[3]).toLowerCase().indexOf(q) >= 0) matches.push(s);
      }
      if (matches.length) {
        const div = document.createElement('div');
        div.className = 'std-divider';
        div.textContent = '標準ライブラリ (' + matches.length + (matches.length >= 100 ? '+' : '') + ' 件)';
        partList.appendChild(div);
        matches.forEach(function (s) {
          const el = document.createElement('div');
          el.className = 'part-item std';
          el.title = s[0] + ':' + s[1];
          const nm = document.createElement('span');
          nm.textContent = s[1];
          const lb = document.createElement('span');
          lb.className = 'std-lib';
          lb.textContent = s[0] + (s[3] ? ' — ' + s[3] : '');
          el.appendChild(nm);
          el.appendChild(lb);
          el.addEventListener('click', function () { choosePartStd(s[0], s[1]); });
          partList.appendChild(el);
        });
        visible += matches.length;
      }
    }

    let note = partList.querySelector('.no-match');
    if (visible === 0) {
      if (!note) {
        note = document.createElement('div');
        note.className = 'no-match';
        note.textContent = '一致する部品がありません。';
        partList.appendChild(note);
      }
    } else if (note) {
      note.remove();
    }
  }
  partSearch.addEventListener('input', applyPartFilter);

  // --- standard library (bundled KiCad symbol libraries) --------------------

  const stdlibBtn = document.getElementById('stdlibBtn');
  let stdIndex = null;

  stdlibBtn.addEventListener('click', function () {
    if (stdIndex) return;
    stdlibBtn.disabled = true;
    stdlibBtn.textContent = '読み込み中…';
    window.KiStdLib.loadIndex().then(function (ix) {
      stdIndex = ix;
      stdlibBtn.textContent = '標準ライブラリ: ' + ix.count + ' シンボル';
      applyPartFilter();
      partSearch.focus();
    }).catch(function (err) {
      stdlibBtn.disabled = false;
      stdlibBtn.textContent = '標準ライブラリを読み込む';
      alert('標準ライブラリを読み込めませんでした。\n' + err.message);
    });
  });

  function choosePartStd(lib, name) {
    window.KiStdLib.loadSymbol(lib, name).then(function (meta) {
      importedParts[lib + ':' + name] = meta;
      choosePart(lib + ':' + name);
    }).catch(function (err) {
      alert('シンボルを読み込めませんでした。\n' + err.message);
    });
  }

  function openPartModal() {
    if (!state.schem) { alert('先にファイルを開くかサンプルを読み込んでください。'); return; }
    partSearch.value = '';
    buildPartList();
    partModal.hidden = false;
    partSearch.focus();
  }
  function closePartModal() { partModal.hidden = true; }

  partBtn.addEventListener('click', openPartModal);
  partClose.addEventListener('click', closePartModal);
  partModal.addEventListener('click', function (e) { if (e.target === partModal) closePartModal(); });

  function choosePart(libId) {
    state.placePart = libId;
    closePartModal();
    setTool('part');
  }

  // Import a .kicad_sym file: register every (symbol "...") it defines.
  symImport.addEventListener('change', function () {
    const file = symImport.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function () {
      let root;
      try { root = S.parse(reader.result); } catch (err) {
        alert('.kicad_sym の解析に失敗しました: ' + err.message); return;
      }
      const syms = M.childLists(root, 'symbol');
      if (!syms.length) { alert('シンボルが見つかりませんでした。'); return; }
      let count = 0;
      syms.forEach(function (sn) {
        const name = sn.children[1] ? sn.children[1].value : null;
        if (!name || name.indexOf(':') < 0) return; // skip child unit symbols
        importedParts[name] = {
          def: S.serialize(sn, 0),
          value: name.split(':')[1],
          ref: guessRefPrefix(sn),
          label: name.split(':')[1] + ' (取込)',
        };
        count++;
      });
      alert(count + ' 個のシンボルを取り込みました。');
      buildPartList();
    };
    reader.readAsText(file);
    symImport.value = '';
  });

  function guessRefPrefix(symNode) {
    const ref = M.childLists(symNode, 'property').find(function (p) {
      return p.children[1] && p.children[1].value === 'Reference';
    });
    const v = ref && ref.children[2] ? ref.children[2].value : 'U';
    return v.replace(/[^A-Za-z].*$/, '') || 'U';
  }

  const WIRE_KINDS = ['wire', 'bus', 'polyline'];
  const LABEL_KINDS = ['label', 'global_label', 'hierarchical_label'];
  function isWireKind(k) { return WIRE_KINDS.indexOf(k) >= 0; }
  function isLabelKind(k) { return LABEL_KINDS.indexOf(k) >= 0; }

  const GRID = 1.27; // mm — snap resolution while moving items
  function snap(v) { return Math.round(v / GRID) * GRID; }

  // --- history --------------------------------------------------------------

  const history = new window.KiHistory();

  function serializeNow() { return S.serializeDocument(state.schem.root); }

  // Call after any completed mutation: snapshots the tree for undo.
  function commitHistory() {
    if (!state.schem) return;
    if (history.commit(serializeNow())) setDirty(true);
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    els.undoBtn.disabled = !history.canUndo();
    els.redoBtn.disabled = !history.canRedo();
  }

  // Restore a history snapshot, keeping the current view (no re-fit).
  function applyText(text) {
    state.schem = new M.Schematic(S.parse(text));
    renderer.setSchematic(state.schem);
    setDirty(true);
    updateHistoryButtons();
    setSelection([]);
  }

  function undoAction() { const t = history.undo(); if (t) applyText(t); }
  function redoAction() { const t = history.redo(); if (t) applyText(t); }

  els.undoBtn.addEventListener('click', undoAction);
  els.redoBtn.addEventListener('click', redoAction);

  // --- loading --------------------------------------------------------------

  function loadText(text, filename) {
    let root;
    try {
      root = S.parse(text);
    } catch (err) {
      alert('ファイルの解析に失敗しました:\n' + err.message);
      return;
    }
    if (M.head(root) !== 'kicad_sch') {
      alert('これは KiCad 回路図 (.kicad_sch) ファイルではないようです。\nルート要素: ' + M.head(root));
      return;
    }
    state.schem = new M.Schematic(root);
    state.filename = filename || 'schematic.kicad_sch';
    state.sel = [];
    state.fieldVisibility = {};
    wireDraft.last = null;
    renderer.draft = null;
    renderer.setSchematic(state.schem);
    renderer.selection = state.sel;
    setDirty(false);
    history.init(serializeNow());
    updateHistoryButtons();
    renderer.fit();
    renderer.render();

    els.dropHint.classList.add('hide');
    els.fileName.textContent = state.filename;
    [els.saveBtn, els.fitBtn, els.zoomInBtn, els.zoomOutBtn, els.fieldsBtn].forEach(function (b) { b.disabled = false; });
    renderProps();
  }

  function loadFile(file) {
    const reader = new FileReader();
    reader.onload = function () { loadText(reader.result, file.name); };
    reader.readAsText(file);
  }

  els.fileInput.addEventListener('change', function () {
    if (els.fileInput.files[0]) loadFile(els.fileInput.files[0]);
  });
  els.sampleBtn.addEventListener('click', function () {
    loadText(window.SAMPLE_SCH, 'sample.kicad_sch');
  });

  // Drag & drop.
  ['dragenter', 'dragover'].forEach(function (ev) {
    els.canvasWrap.addEventListener(ev, function (e) {
      e.preventDefault(); els.canvasWrap.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach(function (ev) {
    els.canvasWrap.addEventListener(ev, function (e) {
      e.preventDefault(); els.canvasWrap.classList.remove('dragover');
    });
  });
  els.canvasWrap.addEventListener('drop', function (e) {
    const file = e.dataTransfer.files[0];
    if (file) loadFile(file);
  });

  // --- saving ---------------------------------------------------------------

  els.saveBtn.addEventListener('click', function () {
    if (!state.schem) return;
    const text = serializeNow();
    const blob = new Blob([text], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = state.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setDirty(false);
  });

  function setDirty(v) {
    state.dirty = v;
    els.dirtyFlag.hidden = !v;
  }

  // --- view controls --------------------------------------------------------

  els.fitBtn.addEventListener('click', function () { renderer.fit(); renderer.render(); });
  els.gridChk.addEventListener('change', function () {
    renderer.showGrid = els.gridChk.checked; renderer.render();
  });
  els.zoomInBtn.addEventListener('click', function () { zoomAtCenter(1.25); });
  els.zoomOutBtn.addEventListener('click', function () { zoomAtCenter(0.8); });

  // --- field visibility modal -------------------------------------------

  const fieldModal = document.getElementById('fieldModal');
  const fieldsList = document.getElementById('fieldsList');

  // Distinct property keys across all symbols, Reference/Value first, then
  // alphabetical. Recomputed each time the modal opens so newly-placed
  // components' fields show up too.
  function collectFieldKeys() {
    const seen = {};
    const keys = [];
    state.schem.symbols().forEach(function (sym) {
      state.schem.properties(sym).forEach(function (p) {
        if (!p.value || seen[p.key]) return;
        seen[p.key] = true;
        keys.push(p.key);
      });
    });
    const priority = { Reference: 0, Value: 1 };
    keys.sort(function (a, b) {
      const pa = priority[a] !== undefined ? priority[a] : 2;
      const pb = priority[b] !== undefined ? priority[b] : 2;
      return pa !== pb ? pa - pb : a.localeCompare(b);
    });
    return keys;
  }

  function buildFieldsList() {
    const keys = collectFieldKeys();
    fieldsList.innerHTML = '';
    if (!keys.length) {
      fieldsList.innerHTML = '<p class="hint">シンボルにプロパティがありません。</p>';
      return;
    }
    keys.forEach(function (key) {
      const row = document.createElement('label');
      row.className = 'field-row';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = isFieldVisible(key);
      cb.addEventListener('change', function () {
        state.fieldVisibility[key] = cb.checked;
        renderer.render();
      });
      const span = document.createElement('span');
      span.textContent = key;
      row.appendChild(cb);
      row.appendChild(span);
      fieldsList.appendChild(row);
    });
  }

  function openFieldsModal() {
    if (!state.schem) return;
    buildFieldsList();
    fieldModal.hidden = false;
  }
  function closeFieldsModal() { fieldModal.hidden = true; }

  els.fieldsBtn.addEventListener('click', openFieldsModal);
  document.getElementById('fieldsClose').addEventListener('click', closeFieldsModal);
  fieldModal.addEventListener('click', function (e) { if (e.target === fieldModal) closeFieldsModal(); });

  document.getElementById('fieldsAllBtn').addEventListener('click', function () {
    collectFieldKeys().forEach(function (key) { state.fieldVisibility[key] = true; });
    buildFieldsList();
    renderer.render();
  });
  document.getElementById('fieldsNoneBtn').addEventListener('click', function () {
    collectFieldKeys().forEach(function (key) { state.fieldVisibility[key] = false; });
    buildFieldsList();
    renderer.render();
  });
  document.getElementById('fieldsResetBtn').addEventListener('click', function () {
    state.fieldVisibility = {};
    buildFieldsList();
    renderer.render();
  });

  function zoomAtCenter(factor) {
    const rect = canvas.getBoundingClientRect();
    zoomAt(rect.width / 2, rect.height / 2, factor);
  }

  function zoomAt(sx, sy, factor) {
    const before = renderer.screenToWorld(sx, sy);
    renderer.view.scale *= factor;
    const after = renderer.screenToWorld(sx, sy);
    renderer.view.panX += before.x - after.x;
    renderer.view.panY += before.y - after.y;
    renderer.render();
  }

  canvas.addEventListener('wheel', function (e) {
    if (!state.schem) return;
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.12 : 0.893);
  }, { passive: false });

  // --- pointer interaction (pan / select / move / rubber / pinch) -----------
  //
  //   mouse/pen : dragging an item moves it (whole selection if it's part of
  //               one); dragging empty space pans; Shift+drag = band select;
  //               Shift+click toggles membership.
  //   touch     : one finger always pans; a tap selects; dragging an
  //               already-selected item moves the selection.
  //   two touch : pinch to zoom.

  const drag = {
    mode: null, startX: 0, startY: 0, panX0: 0, panY0: 0,
    moved: false, pointerType: 'mouse', tapItem: null,
    origs: null, startWorld: null, addToSel: false, middle: false,
  };
  const pointers = new Map(); // pointerId -> {x, y} client coords
  let pinch = null;

  function eventWorld(e) {
    const rect = canvas.getBoundingClientRect();
    return renderer.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
  }

  // Stop the browser's middle-click autoscroll so it can pan instead.
  canvas.addEventListener('mousedown', function (e) {
    if (e.button === 1) e.preventDefault();
  });

  canvas.addEventListener('pointerdown', function (e) {
    if (!state.schem) return;
    // Middle button always pans, KiCad-style, regardless of the active tool.
    if (e.pointerType === 'mouse' && e.button === 1) {
      e.preventDefault();
      try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      drag.startX = e.clientX;
      drag.startY = e.clientY;
      drag.moved = false;
      drag.middle = true;
      drag.tapItem = null;
      drag.mode = 'pan';
      drag.panX0 = renderer.view.panX;
      drag.panY0 = renderer.view.panY;
      canvas.classList.add('grabbing');
      return;
    }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    drag.middle = false;
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 2) {
      drag.mode = null;
      renderer.rubber = null;
      canvas.classList.remove('grabbing', 'movable');
      pinch = pinchState();
      return;
    }
    if (pointers.size !== 1) return;

    const w = eventWorld(e);
    const touch = e.pointerType === 'touch';
    const tol = (touch ? 8 : 4) / renderer.view.scale;

    drag.startX = e.clientX;
    drag.startY = e.clientY;
    drag.moved = false;
    drag.pointerType = e.pointerType;
    drag.startWorld = w;
    drag.addToSel = e.shiftKey;

    // With a placement tool active, dragging pans and a tap places.
    if (state.tool !== 'select') {
      drag.tapItem = null;
      drag.mode = 'pan';
      drag.panX0 = renderer.view.panX;
      drag.panY0 = renderer.view.panY;
      return;
    }

    const item = renderer.itemAt(w.x, w.y, tol);
    drag.tapItem = item;

    if (e.shiftKey && !touch) {
      if (item) {
        drag.mode = 'click'; // toggle handled on pointerup
      } else {
        drag.mode = 'rubber';
        renderer.rubber = { x0: w.x, y0: w.y, x1: w.x, y1: w.y };
      }
      return;
    }

    const inSel = item && isSelected(item.node);
    const canMove = touch ? inSel : !!item;
    if (canMove) {
      if (!touch && !inSel) setSelection([item]);
      drag.mode = 'move';
      drag.origs = captureOrigins();
      canvas.classList.add('movable');
    } else {
      drag.mode = 'pan';
      drag.panX0 = renderer.view.panX;
      drag.panY0 = renderer.view.panY;
      canvas.classList.add('grabbing');
    }
  });

  canvas.addEventListener('pointermove', function (e) {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (state.schem) {
      const w = eventWorld(e);
      els.coords.textContent = w.x.toFixed(2) + ', ' + w.y.toFixed(2) + ' mm';
      // Live preview of the pending wire segment (mouse hover or touch drag).
      if ((state.tool === 'wire' || state.tool === 'bus') && wireDraft.last) {
        const t = orthoTarget(wireDraft.last, { x: snap(w.x), y: snap(w.y) });
        renderer.draft = { x0: wireDraft.last.x, y0: wireDraft.last.y, x1: t.x, y1: t.y, kind: wireDraft.kind };
        renderer.render();
      }
    }

    if (pinch && pointers.size >= 2) {
      const now = pinchState();
      if (pinch.dist > 0 && now.dist > 0) zoomAt(now.cx, now.cy, now.dist / pinch.dist);
      pinch = now;
      return;
    }
    if (!drag.mode) return;

    const dxScreen = e.clientX - drag.startX;
    const dyScreen = e.clientY - drag.startY;
    if (Math.abs(dxScreen) + Math.abs(dyScreen) > 3) drag.moved = true;

    if (drag.mode === 'pan') {
      renderer.view.panX = drag.panX0 - dxScreen / renderer.view.scale;
      renderer.view.panY = drag.panY0 - dyScreen / renderer.view.scale;
      renderer.render();
    } else if (drag.mode === 'rubber') {
      const w = eventWorld(e);
      renderer.rubber.x1 = w.x;
      renderer.rubber.y1 = w.y;
      renderer.render();
    } else if (drag.mode === 'move' && state.sel.length) {
      const w = eventWorld(e);
      const dx = snap(w.x - drag.startWorld.x);
      const dy = snap(w.y - drag.startWorld.y);
      applyMoveDelta(drag.origs, dx, dy);
    }
  });

  function endPointer(e) {
    pointers.delete(e.pointerId);
    if (canvas.hasPointerCapture && canvas.hasPointerCapture(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }
    if (pointers.size < 2) pinch = null;

    if (drag.mode === 'rubber') {
      const rb = renderer.rubber;
      renderer.rubber = null;
      if (drag.moved && rb) {
        setSelection(itemsInRect({
          x0: Math.min(rb.x0, rb.x1), x1: Math.max(rb.x0, rb.x1),
          y0: Math.min(rb.y0, rb.y1), y1: Math.max(rb.y0, rb.y1),
        }));
      } else {
        renderer.render();
      }
    } else if (drag.mode === 'move' && drag.moved) {
      commitHistory();
      renderProps();
    } else if (drag.mode && !drag.moved && !drag.middle) {
      // A tap/click that did not drag.
      if (state.tool !== 'select') {
        handleToolTap(drag.startWorld);
      } else if (drag.tapItem) {
        if (drag.addToSel) toggleSelection(drag.tapItem);
        else setSelection([drag.tapItem]);
      } else if (state.sel.length && !drag.addToSel) {
        setSelection([]);
      }
    }

    if (pointers.size === 0) {
      drag.mode = null;
      canvas.classList.remove('grabbing', 'movable');
    }
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);

  function pinchState() {
    const pts = Array.from(pointers.values());
    const rect = canvas.getBoundingClientRect();
    const dx = pts[0].x - pts[1].x, dy = pts[0].y - pts[1].y;
    return {
      dist: Math.hypot(dx, dy),
      cx: (pts[0].x + pts[1].x) / 2 - rect.left,
      cy: (pts[0].y + pts[1].y) / 2 - rect.top,
    };
  }

  // --- selection ------------------------------------------------------------

  function isSelected(node) {
    return state.sel.some(function (it) { return it.node === node; });
  }

  function setSelection(items) {
    state.sel = items || [];
    renderer.selection = state.sel;
    renderer.render();
    renderProps();
    els.sidebar.classList.toggle('open', state.sel.length > 0);
  }

  function toggleSelection(item) {
    const next = state.sel.slice();
    const i = next.findIndex(function (it) { return it.node === item.node; });
    if (i >= 0) next.splice(i, 1); else next.push(item);
    setSelection(next);
  }

  function allItems() {
    const out = state.schem.symbols().map(function (n) { return { kind: 'symbol', node: n }; });
    WIRE_KINDS.concat(LABEL_KINDS, ['text', 'junction', 'no_connect', 'bus_entry']).forEach(function (k) {
      state.schem.items(k).forEach(function (n) { out.push({ kind: k, node: n }); });
    });
    return out;
  }

  function itemsInRect(r) {
    return allItems().filter(function (it) {
      const b = renderer.itemBBox(it.kind, it.node);
      return b && b.maxX >= r.x0 && b.minX <= r.x1 && b.maxY >= r.y0 && b.minY <= r.y1;
    });
  }

  // --- mutations ------------------------------------------------------------

  function captureOrigins() {
    return state.sel.map(function (it) {
      if (it.kind === 'symbol') {
        const pl = state.schem.placement(it.node);
        return { it: it, x: pl.x, y: pl.y };
      }
      if (isWireKind(it.kind)) {
        return { it: it, pts: M.readPts(it.node) };
      }
      const at = M.readAt(it.node);
      return { it: it, x: at ? at.x : 0, y: at ? at.y : 0, angle: at ? at.angle : 0 };
    });
  }

  // Move every selected item to (original + snapped delta).
  function applyMoveDelta(origs, dx, dy) {
    origs.forEach(function (o) {
      const k = o.it.kind;
      if (k === 'symbol') {
        moveSymbolTo(o.it.node, o.x + dx, o.y + dy);
      } else if (isWireKind(k)) {
        M.writePts(o.it.node, o.pts.map(function (p) { return { x: p.x + dx, y: p.y + dy }; }));
      } else {
        M.writeAt(o.it.node, o.x + dx, o.y + dy, o.angle);
      }
    });
    renderer.render();
  }

  function moveSymbolTo(symbolNode, nx, ny) {
    const pl = state.schem.placement(symbolNode);
    const dx = nx - pl.x, dy = ny - pl.y;
    if (dx === 0 && dy === 0) return;
    M.writeAt(symbolNode, nx, ny, pl.angle);
    // Property text positions are absolute; shift them by the same delta.
    M.childLists(symbolNode, 'property').forEach(function (p) {
      const at = M.readAt(p);
      if (at) M.writeAt(p, at.x + dx, at.y + dy, at.angle);
    });
    renderer.invalidate(symbolNode);
  }

  function rotateSymbol(node) {
    const pl = state.schem.placement(node);
    const na = (pl.angle + 90) % 360;
    M.writeAt(node, pl.x, pl.y, na);
    // Rotate field positions 90° about the symbol origin (screen CCW).
    M.childLists(node, 'property').forEach(function (p) {
      const at = M.readAt(p);
      if (!at) return;
      const rx = at.x - pl.x, ry = at.y - pl.y;
      M.writeAt(p, pl.x + ry, pl.y - rx, at.angle);
    });
    renderer.invalidate(node);
  }

  function rotateSelected() {
    if (!state.sel.length) return;
    state.sel.forEach(function (it) {
      if (it.kind === 'symbol') {
        rotateSymbol(it.node);
      } else if (isLabelKind(it.kind) || it.kind === 'text') {
        const at = M.readAt(it.node);
        if (at) M.writeAt(it.node, at.x, at.y, (at.angle + 90) % 360);
      }
    });
    renderer.render();
    commitHistory();
    renderProps();
  }

  function mirrorSelected(axis) {
    let did = false;
    state.sel.forEach(function (it) {
      if (it.kind !== 'symbol') return;
      const pl = state.schem.placement(it.node);
      M.setMirror(it.node, pl.mirror === axis ? null : axis);
      renderer.invalidate(it.node);
      did = true;
    });
    if (!did) return;
    renderer.render();
    commitHistory();
    renderProps();
  }

  function deleteSelected() {
    if (!state.sel.length) return;
    state.sel.forEach(function (it) {
      M.removeChild(state.schem.root, it.node);
    });
    renderer.invalidate();
    setSelection([]);
    commitHistory();
  }

  // --- placement tools ------------------------------------------------------

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }

  const f = M.fmt;

  function addTop(node) {
    state.schem.root.children.push(node);
    return node;
  }

  // Constrain the pending segment to horizontal or vertical (dominant axis).
  function orthoTarget(from, to) {
    return Math.abs(to.x - from.x) >= Math.abs(to.y - from.y)
      ? { x: to.x, y: from.y }
      : { x: from.x, y: to.y };
  }

  function handleToolTap(wRaw) {
    if (!state.schem) return;
    const w = { x: snap(wRaw.x), y: snap(wRaw.y) };

    switch (state.tool) {
      case 'wire':
      case 'bus': {
        if (!wireDraft.last) {
          wireDraft.last = w;
          wireDraft.kind = state.tool;
          renderer.draft = { x0: w.x, y0: w.y, x1: w.x, y1: w.y, kind: state.tool };
          renderer.render();
          return;
        }
        const t = orthoTarget(wireDraft.last, w);
        if (t.x === wireDraft.last.x && t.y === wireDraft.last.y) {
          cancelDraft(); // clicking the same point ends the run
          return;
        }
        addWireSegment(wireDraft.kind, wireDraft.last, t);
        wireDraft.last = t;
        renderer.draft = { x0: t.x, y0: t.y, x1: t.x, y1: t.y, kind: wireDraft.kind };
        renderer.render();
        return;
      }
      case 'junction':
        addTop(S.parse('(junction (at ' + f(w.x) + ' ' + f(w.y) + ') (diameter 0) (color 0 0 0 0) (uuid "' + uuid() + '"))'));
        finishPlacement(null);
        return;
      case 'no_connect':
        addTop(S.parse('(no_connect (at ' + f(w.x) + ' ' + f(w.y) + ') (uuid "' + uuid() + '"))'));
        finishPlacement(null);
        return;
      case 'label': {
        const node = addTop(S.parse('(label "NET1" (at ' + f(w.x) + ' ' + f(w.y) + ' 0)\n' +
          '  (effects (font (size 1.27 1.27)) (justify left bottom))\n' +
          '  (uuid "' + uuid() + '"))'));
        finishPlacement({ kind: 'label', node: node });
        return;
      }
      case 'global_label': {
        const node = addTop(S.parse('(global_label "NET1" (shape input) (at ' + f(w.x) + ' ' + f(w.y) + ' 0)\n' +
          '  (effects (font (size 1.27 1.27)) (justify left))\n' +
          '  (uuid "' + uuid() + '"))'));
        finishPlacement({ kind: 'global_label', node: node });
        return;
      }
      case 'text': {
        const node = addTop(S.parse('(text "TEXT" (at ' + f(w.x) + ' ' + f(w.y) + ' 0)\n' +
          '  (effects (font (size 1.27 1.27)) (justify left bottom))\n' +
          '  (uuid "' + uuid() + '"))'));
        finishPlacement({ kind: 'text', node: node });
        return;
      }
      case 'power':
        placePower(powerSel.value, w.x, w.y);
        return;
      case 'part':
        if (state.placePart) placeComponent(state.placePart, w.x, w.y);
        return;
    }
  }

  // Common tail for single-click placements.
  function finishPlacement(selectItem) {
    renderer.render();
    commitHistory();
    if (selectItem) setSelection([selectItem]);
    else renderProps();
  }

  function addWireSegment(kind, a, b) {
    addTop(S.parse('(' + kind + ' (pts (xy ' + f(a.x) + ' ' + f(a.y) + ') (xy ' + f(b.x) + ' ' + f(b.y) + '))\n' +
      '  (stroke (width 0) (type default))\n' +
      '  (uuid "' + uuid() + '"))'));
    if (kind === 'wire') {
      // T-connections: junction where an endpoint meets another wire's middle,
      // or where an existing endpoint sits inside this new segment.
      const candidates = [a, b];
      state.schem.items('wire').forEach(function (wn) {
        M.readPts(wn).forEach(function (p) {
          if (pointInsideSeg(p, a, b)) candidates.push(p);
        });
      });
      candidates.forEach(maybeAddJunction);
    }
    renderer.render();
    commitHistory();
  }

  const EPS = 0.01;
  function near(p, q) { return Math.abs(p.x - q.x) < EPS && Math.abs(p.y - q.y) < EPS; }

  // True if p lies on segment a-b but is not one of its endpoints.
  function pointInsideSeg(p, a, b) {
    if (near(p, a) || near(p, b)) return false;
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (Math.abs(cross) > EPS) return false;
    const dot = (p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y);
    const len2 = (b.x - a.x) * (b.x - a.x) + (b.y - a.y) * (b.y - a.y);
    return dot > EPS && dot < len2 - EPS;
  }

  function maybeAddJunction(pt) {
    const already = state.schem.items('junction').some(function (j) {
      const at = M.readAt(j);
      return at && near(at, pt);
    });
    if (already) return;
    let ends = 0, interiors = 0;
    state.schem.items('wire').forEach(function (wn) {
      const pts = M.readPts(wn);
      let endHit = false, interiorHit = false;
      for (let i = 0; i < pts.length; i++) {
        if (near(pts[i], pt)) endHit = true;
      }
      for (let i = 0; i + 1 < pts.length; i++) {
        if (pointInsideSeg(pt, pts[i], pts[i + 1])) interiorHit = true;
      }
      if (endHit) ends++;
      else if (interiorHit) interiors++;
    });
    if (ends >= 3 || (ends >= 1 && interiors >= 1)) {
      addTop(S.parse('(junction (at ' + f(pt.x) + ' ' + f(pt.y) + ') (diameter 0) (color 0 0 0 0) (uuid "' + uuid() + '"))'));
    }
  }

  // Next free "#PWR0n" reference for placed power symbols.
  function nextPwrRef() {
    let max = 0;
    state.schem.symbols().forEach(function (sym) {
      state.schem.properties(sym).forEach(function (p) {
        if (p.key !== 'Reference') return;
        const m = /^#PWR0*(\d+)$/.exec(p.value);
        if (m) max = Math.max(max, parseInt(m[1], 10));
      });
    });
    return '#PWR0' + (max + 1);
  }

  function placePower(libId, x, y) {
    const meta = window.KiLibrary.ensurePower(state.schem, libId);
    if (!meta) return;
    const name = libId.split(':')[1];
    const node = addTop(S.parse(
      '(symbol (lib_id "' + libId + '") (at ' + f(x) + ' ' + f(y) + ' 0) (unit 1)\n' +
      '  (in_bom yes) (on_board yes) (dnp no)\n' +
      '  (uuid "' + uuid() + '")\n' +
      '  (property "Reference" "' + nextPwrRef() + '" (at ' + f(x) + ' ' + f(y + meta.refDy) + ' 0)\n' +
      '    (effects (font (size 1.27 1.27)) hide))\n' +
      '  (property "Value" "' + name + '" (at ' + f(x) + ' ' + f(y + meta.valueDy) + ' 0)\n' +
      '    (effects (font (size 1.27 1.27))))\n' +
      '  (pin "1" (uuid "' + uuid() + '"))\n' +
      ')'));
    renderer.invalidate();
    finishPlacement({ kind: 'symbol', node: node });
  }

  // Next free reference "<prefix><n>" for a component of the given prefix.
  function nextRef(prefix) {
    let max = 0;
    const re = new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\d+)$');
    state.schem.symbols().forEach(function (sym) {
      state.schem.properties(sym).forEach(function (p) {
        if (p.key !== 'Reference') return;
        const m = re.exec(p.value);
        if (m) max = Math.max(max, parseInt(m[1], 10));
      });
    });
    return prefix + (max + 1);
  }

  function placeComponent(libId, x, y) {
    const meta = (window.KiParts.PARTS[libId]) || importedParts[libId];
    if (!meta) return;
    window.KiLibrary.ensureLibDef(state.schem, libId, meta.def);
    const lib = state.schem.libSymbols[libId];
    // Emit an instance pin entry for every unique pin number in the lib symbol.
    const seen = {};
    let pinsSexpr = '';
    if (lib) {
      lib.bodies.forEach(function (bd) {
        bd.pins.forEach(function (pin) {
          if (pin.number == null || seen[pin.number]) return;
          seen[pin.number] = true;
          pinsSexpr += '  (pin "' + pin.number + '" (uuid "' + uuid() + '"))\n';
        });
      });
    }
    // Carry the library's default footprint into the instance, KiCad-style.
    let fpSexpr = '';
    try {
      const defRoot = S.parse(meta.def);
      const fp = M.childLists(defRoot, 'property').find(function (p) {
        return p.children[1] && p.children[1].value === 'Footprint';
      });
      const fpVal = fp && fp.children[2] ? fp.children[2].value : '';
      if (fpVal) {
        fpSexpr = '  (property "Footprint" "' + S.escapeString(fpVal) + '"' +
          ' (at ' + f(x) + ' ' + f(y) + ' 0)\n' +
          '    (effects (font (size 1.27 1.27)) hide))\n';
      }
    } catch (_) { /* def without a footprint default */ }

    const ref = nextRef(meta.ref);
    const node = addTop(S.parse(
      '(symbol (lib_id "' + libId + '") (at ' + f(x) + ' ' + f(y) + ' 0) (unit 1)\n' +
      '  (in_bom yes) (on_board yes) (dnp no)\n' +
      '  (uuid "' + uuid() + '")\n' +
      '  (property "Reference" "' + ref + '" (at ' + f(x + 3.81) + ' ' + f(y - 1.27) + ' 0)\n' +
      '    (effects (font (size 1.27 1.27)) (justify left)))\n' +
      '  (property "Value" "' + meta.value + '" (at ' + f(x + 3.81) + ' ' + f(y + 1.27) + ' 0)\n' +
      '    (effects (font (size 1.27 1.27)) (justify left)))\n' +
      fpSexpr +
      pinsSexpr +
      ')'));
    renderer.invalidate();
    finishPlacement({ kind: 'symbol', node: node });
  }

  // --- copy / paste / duplicate ---------------------------------------------

  // In-app clipboard: serialized S-expression text per copied item.
  let clipboard = []; // array of {kind, text}
  const PASTE_OFFSET = 2.54; // mm

  function copySelection() {
    if (!state.sel.length) return;
    clipboard = state.sel.map(function (it) {
      return { kind: it.kind, text: S.serialize(it.node, 0) };
    });
  }

  function cutSelection() {
    if (!state.sel.length) return;
    copySelection();
    deleteSelected();
  }

  // Replace every (uuid ...) in the tree with a fresh one.
  function regenUuids(node) {
    if (node.kind !== 'list') return;
    if (M.head(node) === 'uuid' && node.children[1]) {
      node.children[1] = { kind: 'atom', value: uuid(), quoted: node.children[1].quoted };
      return;
    }
    node.children.forEach(regenUuids);
  }

  // Shift a freshly inserted item by (dx, dy), fields included.
  function offsetItem(kind, node, dx, dy) {
    if (kind === 'symbol') {
      const pl = state.schem.placement(node);
      moveSymbolTo(node, pl.x + dx, pl.y + dy);
    } else if (isWireKind(kind)) {
      M.writePts(node, M.readPts(node).map(function (p) {
        return { x: p.x + dx, y: p.y + dy };
      }));
    } else {
      const at = M.readAt(node);
      if (at) M.writeAt(node, at.x + dx, at.y + dy, at.angle);
    }
  }

  function pasteClipboard() {
    if (!state.schem || !clipboard.length) return;
    const pasted = [];
    clipboard.forEach(function (entry) {
      let node;
      try { node = S.parse(entry.text); } catch (_) { return; }
      regenUuids(node);
      addTop(node);
      offsetItem(entry.kind, node, PASTE_OFFSET, PASTE_OFFSET);
      // Re-annotate symbol references so the copy gets the next free number.
      if (entry.kind === 'symbol') {
        const refProp = state.schem.properties(node).find(function (p) {
          return p.key === 'Reference';
        });
        if (refProp && refProp.value) {
          const newRef = refProp.value.indexOf('#PWR') === 0
            ? nextPwrRef()
            : nextRef(refProp.value.replace(/[^A-Za-z].*$/, '') || 'U');
          state.schem.setProperty(refProp.node, newRef);
        }
      }
      pasted.push({ kind: entry.kind, node: node });
    });
    if (!pasted.length) return;
    // Next paste of the same clipboard lands one more step away.
    clipboard = pasted.map(function (it) {
      return { kind: it.kind, text: S.serialize(it.node, 0) };
    });
    renderer.invalidate();
    commitHistory();
    setSelection(pasted);
  }

  function duplicateSelection() {
    if (!state.sel.length) return;
    const saved = clipboard;
    copySelection();
    pasteClipboard();
    clipboard = saved.length ? saved : clipboard;
  }

  // --- keyboard shortcuts ---------------------------------------------------

  window.addEventListener('keydown', function (e) {
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    const k = e.key;
    if ((e.ctrlKey || e.metaKey) && (k === 'z' || k === 'Z')) {
      e.preventDefault();
      if (e.shiftKey) redoAction(); else undoAction();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (k === 'y' || k === 'Y')) {
      e.preventDefault();
      redoAction();
      return;
    }
    if (!state.schem) return;
    if ((e.ctrlKey || e.metaKey) && (k === 'c' || k === 'C')) { copySelection(); return; }
    if ((e.ctrlKey || e.metaKey) && (k === 'x' || k === 'X')) { e.preventDefault(); cutSelection(); return; }
    if ((e.ctrlKey || e.metaKey) && (k === 'v' || k === 'V')) { e.preventDefault(); pasteClipboard(); return; }
    if (k === 'Escape') {
      if (wireDraft.last) cancelDraft();
      else if (state.tool !== 'select') setTool('select');
      else setSelection([]);
      return;
    }
    if (k === 'w' || k === 'W') { setTool('wire'); return; }
    if (k === 'l' || k === 'L') { setTool('label'); return; }
    if (!state.sel.length) return;
    if (k === 'd' || k === 'D') { e.preventDefault(); duplicateSelection(); }
    else if (k === 'r' || k === 'R') rotateSelected();
    else if (k === 'x' || k === 'X') mirrorSelected('x');
    else if (k === 'y' || k === 'Y') mirrorSelected('y');
    else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); deleteSelected(); }
  });

  // --- property panel -------------------------------------------------------

  function kindLabel(kind) {
    return {
      wire: '配線', bus: 'バス', polyline: '図形線', bus_entry: 'バスエントリ',
      label: 'ラベル', global_label: 'グローバルラベル',
      hierarchical_label: '階層ラベル', text: 'テキスト',
      junction: 'ジャンクション', no_connect: '未接続マーク',
      symbol: 'シンボル',
    }[kind] || kind;
  }

  function renderProps() {
    const c = els.propContent;
    c.innerHTML = '';
    if (!state.schem) {
      c.innerHTML = '<p class="hint">ファイルを読み込んでください。</p>';
      return;
    }
    if (state.sel.length === 0) {
      c.innerHTML =
        '<p class="hint">アイテムをクリック / タップで選択。Shift+ドラッグで範囲選択。<br>' +
        'ツールバーの「配線」等で新規描画（クリックで頂点、Esc で終了）。<br>' +
        'R: 回転, X/Y: 反転, D: 複製, Ctrl+C/V: コピー/貼り付け, Del: 削除, W: 配線, L: ラベル, Ctrl+Z: 元に戻す</p>' +
        '<div class="section-label">回路図の内容</div>' +
        '<div class="prop-sub">' + summary() + '</div>';
      return;
    }
    if (state.sel.length > 1) {
      renderMultiProps(c);
      return;
    }
    const it = state.sel[0];
    if (it.kind === 'symbol') renderSymbolProps(c, it.node);
    else if (isLabelKind(it.kind) || it.kind === 'text') renderTextProps(c, it);
    else renderSimpleProps(c, it);
  }

  function titleRow(c, text, sub) {
    const t = document.createElement('p');
    t.className = 'prop-title';
    t.textContent = text;
    c.appendChild(t);
    if (sub) {
      const s = document.createElement('p');
      s.className = 'prop-sub';
      s.textContent = sub;
      c.appendChild(s);
    }
    return t;
  }

  function actionsRow(c, buttons) {
    const row = document.createElement('div');
    row.className = 'actions';
    buttons.forEach(function (b) {
      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.textContent = b[0];
      btn.addEventListener('click', b[1]);
      row.appendChild(btn);
    });
    c.appendChild(row);
    return row;
  }

  function renderMultiProps(c) {
    titleRow(c, state.sel.length + ' 個のアイテムを選択中');
    actionsRow(c, [
      ['90° 回転', rotateSelected],
      ['複製', duplicateSelection],
      ['削除', deleteSelected],
    ]);
    actionsRow(c, [
      ['選択解除', function () { setSelection([]); }],
    ]);
  }

  // KiCad standard footprint name suggestions per reference prefix, offered
  // in the Footprint field's datalist (free text is still allowed).
  const FOOTPRINT_SUGGESTIONS = {
    R: ['Resistor_SMD:R_0402_1005Metric', 'Resistor_SMD:R_0603_1608Metric',
        'Resistor_SMD:R_0805_2012Metric', 'Resistor_SMD:R_1206_3216Metric',
        'Resistor_THT:R_Axial_DIN0207_L6.3mm_D2.5mm_P10.16mm_Horizontal'],
    C: ['Capacitor_SMD:C_0402_1005Metric', 'Capacitor_SMD:C_0603_1608Metric',
        'Capacitor_SMD:C_0805_2012Metric', 'Capacitor_SMD:C_1206_3216Metric',
        'Capacitor_THT:CP_Radial_D5.0mm_P2.50mm'],
    L: ['Inductor_SMD:L_0603_1608Metric', 'Inductor_SMD:L_0805_2012Metric'],
    FB: ['Inductor_SMD:L_0603_1608Metric', 'Inductor_SMD:L_0805_2012Metric'],
    D: ['Diode_SMD:D_SOD-123', 'Diode_SMD:D_SOD-323',
        'Diode_THT:D_DO-35_SOD27_P7.62mm_Horizontal',
        'LED_SMD:LED_0603_1608Metric', 'LED_SMD:LED_0805_2012Metric',
        'LED_THT:LED_D5.0mm'],
    Q: ['Package_TO_SOT_SMD:SOT-23', 'Package_TO_SOT_SMD:SOT-223-3_TabPin2',
        'Package_TO_SOT_THT:TO-92_Inline', 'Package_TO_SOT_THT:TO-220-3_Vertical'],
    U: ['Package_SO:SOIC-8_3.9x4.9mm_P1.27mm', 'Package_SO:SOIC-14_3.9x8.7mm_P1.27mm',
        'Package_DIP:DIP-8_W7.62mm', 'Package_DIP:DIP-14_W7.62mm',
        'Package_TO_SOT_SMD:SOT-23-5', 'Package_TO_SOT_SMD:SOT-223-3_TabPin2'],
    J: ['Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Vertical',
        'Connector_PinHeader_2.54mm:PinHeader_1x03_P2.54mm_Vertical',
        'Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical',
        'Connector_PinHeader_2.54mm:PinHeader_1x06_P2.54mm_Vertical',
        'Connector_PinHeader_2.54mm:PinHeader_1x08_P2.54mm_Vertical'],
    Y: ['Crystal:Crystal_SMD_3225-4Pin_3.2x2.5mm', 'Crystal:Crystal_HC49-4H_Vertical'],
    SW: ['Button_Switch_SMD:SW_SPST_TL3342', 'Button_Switch_THT:SW_PUSH_6mm'],
    F: ['Fuse:Fuse_0603_1608Metric', 'Fuse:Fuse_1206_3216Metric'],
    TP: ['TestPoint:TestPoint_Pad_D1.5mm', 'TestPoint:TestPoint_Loop_D2.60mm_Drill1.4mm'],
    BZ: ['Buzzer_Beeper:Buzzer_12x9.5RM7.6'],
    K: ['Relay_THT:Relay_SPDT_Finder_36.11'],
  };

  function fillFootprintDatalist(refValue) {
    const dl = document.getElementById('fpList');
    dl.innerHTML = '';
    const prefix = (refValue || '').replace(/[^A-Za-z].*$/, '');
    (FOOTPRINT_SUGGESTIONS[prefix] || []).forEach(function (fp) {
      const opt = document.createElement('option');
      opt.value = fp;
      dl.appendChild(opt);
    });
  }

  function renderSymbolProps(c, sym) {
    const pl = state.schem.placement(sym);
    const lidNode = M.firstChild(sym, 'lib_id');
    const libId = lidNode && lidNode.children[1] ? lidNode.children[1].value : '(不明)';
    const props = state.schem.properties(sym);
    const refProp = props.find(function (p) { return p.key === 'Reference'; });

    const title = titleRow(c, refProp ? refProp.value : 'シンボル', libId);
    fillFootprintDatalist(refProp ? refProp.value : '');

    let sawFootprint = false;
    props.forEach(function (p) {
      const isFootprint = p.key === 'Footprint';
      if (isFootprint) sawFootprint = true;
      // Reference/Value/Footprint always show; other fields only when non-empty.
      if (p.key !== 'Reference' && p.key !== 'Value' && !isFootprint && !p.value) return;
      const row = fieldRow(p.key, p.value, function (val) {
        state.schem.setProperty(p.node, val);
        renderer.render();
        commitHistory();
        if (p.key === 'Reference') { title.textContent = val; fillFootprintDatalist(val); }
      });
      if (isFootprint) row.querySelector('input').setAttribute('list', 'fpList');
      c.appendChild(row);
    });

    // Symbols placed from the built-in library have no Footprint property yet:
    // offer the field anyway and create the property on first commit.
    if (!sawFootprint) {
      const row = fieldRow('Footprint', '', function (val) {
        if (!val) return;
        state.schem.ensureProperty(sym, 'Footprint', val);
        renderer.render();
        commitHistory();
      });
      row.querySelector('input').setAttribute('list', 'fpList');
      c.appendChild(row);
    }

    const sec = document.createElement('div');
    sec.className = 'section-label';
    sec.textContent = '配置';
    c.appendChild(sec);

    const posWrap = document.createElement('div');
    posWrap.className = 'pos-row';
    const xField = fieldRow('X (mm)', M.fmt(pl.x), applyPos);
    const yField = fieldRow('Y (mm)', M.fmt(pl.y), applyPos);
    posWrap.appendChild(xField);
    posWrap.appendChild(yField);
    c.appendChild(posWrap);
    const aField = fieldRow('角度 (°)', M.fmt(pl.angle), applyPos);
    c.appendChild(aField);

    function applyPos() {
      const nx = parseFloat(xField.querySelector('input').value);
      const ny = parseFloat(yField.querySelector('input').value);
      const na = parseFloat(aField.querySelector('input').value);
      if (!isFinite(nx) || !isFinite(ny)) return;
      const pl2 = state.schem.placement(sym);
      const dx = nx - pl2.x, dy = ny - pl2.y;
      M.writeAt(sym, nx, ny, isFinite(na) ? ((na % 360) + 360) % 360 : pl2.angle);
      M.childLists(sym, 'property').forEach(function (pr) {
        const at = M.readAt(pr);
        if (at) M.writeAt(pr, at.x + dx, at.y + dy, at.angle);
      });
      renderer.invalidate(sym);
      renderer.render();
      commitHistory();
    }

    actionsRow(c, [
      ['90° 回転', rotateSelected],
      ['左右反転', function () { mirrorSelected('y'); }],
      ['上下反転', function () { mirrorSelected('x'); }],
    ]);
    actionsRow(c, [
      ['複製', duplicateSelection],
      ['削除', deleteSelected],
      ['選択解除', function () { setSelection([]); }],
    ]);
  }

  function renderTextProps(c, it) {
    const node = it.node;
    const at = M.readAt(node);
    titleRow(c, kindLabel(it.kind));

    c.appendChild(fieldRow('テキスト', node.children[1] ? node.children[1].value : '', function (val) {
      M.setText(node, val);
      renderer.render();
      commitHistory();
    }));
    if (at) {
      c.appendChild(fieldRow('角度 (°)', M.fmt(at.angle), function (val) {
        const na = parseFloat(val);
        if (!isFinite(na)) return;
        M.writeAt(node, at.x, at.y, ((na % 360) + 360) % 360);
        renderer.render();
        commitHistory();
      }));
    }
    actionsRow(c, [
      ['90° 回転', rotateSelected],
      ['削除', deleteSelected],
      ['選択解除', function () { setSelection([]); }],
    ]);
  }

  function renderSimpleProps(c, it) {
    let sub = '';
    if (isWireKind(it.kind)) {
      sub = M.readPts(it.node).map(function (p) {
        return '(' + M.fmt(p.x) + ', ' + M.fmt(p.y) + ')';
      }).join(' → ');
    } else {
      const at = M.readAt(it.node);
      if (at) sub = '(' + M.fmt(at.x) + ', ' + M.fmt(at.y) + ')';
    }
    titleRow(c, kindLabel(it.kind), sub);
    actionsRow(c, [
      ['削除', deleteSelected],
      ['選択解除', function () { setSelection([]); }],
    ]);
  }

  function fieldRow(label, value, onCommit) {
    const wrap = document.createElement('div');
    wrap.className = 'field';
    const lab = document.createElement('label');
    lab.textContent = label;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value;
    input.addEventListener('change', function () { onCommit(input.value); });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') input.blur(); });
    wrap.appendChild(lab);
    wrap.appendChild(input);
    return wrap;
  }

  function summary() {
    const s = state.schem;
    return [
      'シンボル: ' + s.symbols().length,
      '配線: ' + s.items('wire').length,
      'ラベル: ' + s.items(LABEL_KINDS).length,
      'ジャンクション: ' + s.items('junction').length,
    ].join('<br>');
  }

  // --- misc -----------------------------------------------------------------

  function onViewportChange() { if (state.schem) renderer.render(); }
  window.addEventListener('resize', onViewportChange);
  window.addEventListener('orientationchange', onViewportChange);
  window.addEventListener('beforeunload', function (e) {
    if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  // PWA file handling: open .kicad_sch files launched via OS association.
  if ('launchQueue' in window && window.launchQueue.setConsumer) {
    window.launchQueue.setConsumer(function (launchParams) {
      if (!launchParams.files || !launchParams.files.length) return;
      launchParams.files[0].getFile().then(function (file) {
        const reader = new FileReader();
        reader.onload = function () { loadText(reader.result, file.name); };
        reader.readAsText(file);
      });
    });
  }

  // Initial paint so the canvas sizes correctly.
  renderer.render();

  // Minimal hook for automated tests / debugging.
  window.__kicad = {
    view: renderer.view,
    tool: function () { return state.tool; },
    placePart: function () { return state.placePart; },
    dangling: function () { return renderer._danglingCount; },
    selCount: function () { return state.sel.length; },
    selKind: function () { return state.sel.length ? state.sel[0].kind : null; },
    text: function () { return state.schem ? serializeNow() : ''; },
    undo: undoAction,
    redo: redoAction,
  };
})();
