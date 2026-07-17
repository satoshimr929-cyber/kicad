// app.js — UI wiring: file I/O, pan/zoom, selection, move, property editing.

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
    fitBtn: document.getElementById('fitBtn'),
    zoomInBtn: document.getElementById('zoomInBtn'),
    zoomOutBtn: document.getElementById('zoomOutBtn'),
    gridChk: document.getElementById('gridChk'),
    fileName: document.getElementById('fileName'),
    dirtyFlag: document.getElementById('dirtyFlag'),
    dropHint: document.getElementById('dropHint'),
    coords: document.getElementById('coords'),
    canvasWrap: document.getElementById('canvasWrap'),
    propContent: document.getElementById('propContent'),
  };

  const state = {
    schem: null,
    filename: 'schematic.kicad_sch',
    dirty: false,
    selected: null,
  };

  const GRID = 1.27; // mm — snap resolution while moving symbols
  function snap(v) { return Math.round(v / GRID) * GRID; }

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
    state.selected = null;
    setDirty(false);
    renderer.setSchematic(state.schem);
    renderer.selected = null;
    renderer.fit();
    renderer.render();

    els.dropHint.classList.add('hide');
    els.fileName.textContent = state.filename;
    [els.saveBtn, els.fitBtn, els.zoomInBtn, els.zoomOutBtn].forEach(function (b) { b.disabled = false; });
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
    const text = S.serializeDocument(state.schem.root);
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

  // --- pointer interaction (pan / select / move) ----------------------------

  const drag = { mode: null, startX: 0, startY: 0, panX0: 0, panY0: 0, moved: false, symStart: null };

  function eventWorld(e) {
    const rect = canvas.getBoundingClientRect();
    return renderer.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
  }

  canvas.addEventListener('mousedown', function (e) {
    if (!state.schem || e.button !== 0) return;
    const w = eventWorld(e);
    const sym = renderer.symbolAt(w.x, w.y);
    drag.startX = e.clientX;
    drag.startY = e.clientY;
    drag.moved = false;

    if (sym) {
      selectSymbol(sym);
      drag.mode = 'move';
      const pl = state.schem.placement(sym);
      drag.symStart = { x: pl.x, y: pl.y, worldX: w.x, worldY: w.y };
      canvas.classList.add('movable');
    } else {
      if (state.selected) selectSymbol(null);
      drag.mode = 'pan';
      drag.panX0 = renderer.view.panX;
      drag.panY0 = renderer.view.panY;
      canvas.classList.add('grabbing');
    }
  });

  window.addEventListener('mousemove', function (e) {
    if (state.schem) {
      const w = eventWorld(e);
      els.coords.textContent = w.x.toFixed(2) + ', ' + w.y.toFixed(2) + ' mm';
    }
    if (!drag.mode) return;
    const dxScreen = e.clientX - drag.startX;
    const dyScreen = e.clientY - drag.startY;
    if (Math.abs(dxScreen) + Math.abs(dyScreen) > 3) drag.moved = true;

    if (drag.mode === 'pan') {
      renderer.view.panX = drag.panX0 - dxScreen / renderer.view.scale;
      renderer.view.panY = drag.panY0 - dyScreen / renderer.view.scale;
      renderer.render();
    } else if (drag.mode === 'move' && state.selected) {
      const w = eventWorld(e);
      const nx = snap(drag.symStart.x + (w.x - drag.symStart.worldX));
      const ny = snap(drag.symStart.y + (w.y - drag.symStart.worldY));
      moveSymbolTo(state.selected, nx, ny);
    }
  });

  window.addEventListener('mouseup', function () {
    if (drag.mode === 'move' && drag.moved) { setDirty(true); syncPropInputs(); }
    drag.mode = null;
    canvas.classList.remove('grabbing', 'movable');
  });

  // --- symbol mutations -----------------------------------------------------

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
    renderer.render();
  }

  function rotateSelected() {
    if (!state.selected) return;
    const sym = state.selected;
    const pl = state.schem.placement(sym);
    const newAngle = (pl.angle + 90) % 360;
    M.writeAt(sym, pl.x, pl.y, newAngle);
    // Rotate field positions 90° about the symbol origin (screen CCW).
    M.childLists(sym, 'property').forEach(function (p) {
      const at = M.readAt(p);
      if (!at) return;
      const rx = at.x - pl.x, ry = at.y - pl.y;
      M.writeAt(p, pl.x + ry, pl.y - rx, at.angle);
    });
    renderer.invalidate(sym);
    renderer.render();
    setDirty(true);
    syncPropInputs();
  }

  // --- selection & property panel ------------------------------------------

  function selectSymbol(sym) {
    state.selected = sym;
    renderer.selected = sym;
    renderer.render();
    renderProps();
  }

  function renderProps() {
    const c = els.propContent;
    c.innerHTML = '';
    if (!state.schem) {
      c.innerHTML = '<p class="hint">ファイルを読み込んでください。</p>';
      return;
    }
    if (!state.selected) {
      const counts = summary();
      c.innerHTML =
        '<p class="hint">シンボルをクリックして選択すると、プロパティを編集できます。</p>' +
        '<div class="section-label">回路図の内容</div>' +
        '<div class="prop-sub">' + counts + '</div>';
      return;
    }

    const sym = state.selected;
    const pl = state.schem.placement(sym);
    const lidNode = M.firstChild(sym, 'lib_id');
    const libId = lidNode && lidNode.children[1] ? lidNode.children[1].value : '(不明)';
    const props = state.schem.properties(sym);
    const refProp = props.find(function (p) { return p.key === 'Reference'; });
    const valProp = props.find(function (p) { return p.key === 'Value'; });

    const title = document.createElement('p');
    title.className = 'prop-title';
    title.textContent = refProp ? refProp.value : 'シンボル';
    c.appendChild(title);

    const sub = document.createElement('p');
    sub.className = 'prop-sub';
    sub.textContent = libId;
    c.appendChild(sub);

    // Reference / Value editors.
    props.forEach(function (p) {
      if (p.key !== 'Reference' && p.key !== 'Value' && !p.value) return;
      c.appendChild(fieldRow(p.key, p.value, function (val) {
        state.schem.setProperty(p.node, val);
        renderer.render();
        setDirty(true);
        if (p.key === 'Reference') title.textContent = val;
      }));
    });

    // Position / angle.
    c.appendChild(document.createElement('div')).className = 'section-label';
    c.lastChild.textContent = '配置';

    const posWrap = document.createElement('div');
    posWrap.className = 'pos-row';
    const xField = fieldRow('X (mm)', M.fmt(pl.x), function (v) { applyPos(); });
    const yField = fieldRow('Y (mm)', M.fmt(pl.y), function (v) { applyPos(); });
    posWrap.appendChild(xField); posWrap.appendChild(yField);
    c.appendChild(posWrap);
    c.appendChild(fieldRow('角度 (°)', M.fmt(pl.angle), function () { applyPos(); }));

    function applyPos() {
      const nx = parseFloat(xField.querySelector('input').value);
      const ny = parseFloat(yField.querySelector('input').value);
      const na = parseFloat(c.querySelectorAll('.field input')[c.querySelectorAll('.field input').length - 1].value);
      if (!isFinite(nx) || !isFinite(ny)) return;
      const pl2 = state.schem.placement(sym);
      const dx = nx - pl2.x, dy = ny - pl2.y;
      M.writeAt(sym, nx, ny, isFinite(na) ? na : pl2.angle);
      M.childLists(sym, 'property').forEach(function (pr) {
        const at = M.readAt(pr);
        if (at) M.writeAt(pr, at.x + dx, at.y + dy, at.angle);
      });
      renderer.invalidate(sym);
      renderer.render();
      setDirty(true);
    }

    const actions = document.createElement('div');
    actions.className = 'actions';
    const rotBtn = document.createElement('button');
    rotBtn.className = 'btn';
    rotBtn.textContent = '90° 回転';
    rotBtn.addEventListener('click', rotateSelected);
    const deselectBtn = document.createElement('button');
    deselectBtn.className = 'btn';
    deselectBtn.textContent = '選択解除';
    deselectBtn.addEventListener('click', function () { selectSymbol(null); });
    actions.appendChild(rotBtn); actions.appendChild(deselectBtn);
    c.appendChild(actions);
  }

  // Re-sync the position inputs after a drag/rotate without rebuilding the panel.
  function syncPropInputs() { renderProps(); }

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
    const parts = [];
    const nSym = s.symbols().length;
    const nWire = s.items('wire').length;
    const nLabel = s.items(['label', 'global_label', 'hierarchical_label']).length;
    const nJunc = s.items('junction').length;
    parts.push('シンボル: ' + nSym);
    parts.push('配線: ' + nWire);
    parts.push('ラベル: ' + nLabel);
    parts.push('ジャンクション: ' + nJunc);
    return parts.join('<br>');
  }

  // --- misc -----------------------------------------------------------------

  window.addEventListener('resize', function () { if (state.schem) renderer.render(); });
  window.addEventListener('beforeunload', function (e) {
    if (state.dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  // Initial paint so the canvas sizes correctly.
  renderer.render();
})();
