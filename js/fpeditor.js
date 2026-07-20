// fpeditor.js — full-screen editor for one KiCad footprint (.kicad_mod).
//
// Loads a footprint from the bundled full library (KiStdLib.loadFootprint) or
// a local .kicad_mod file, renders it with KiFpRenderer, and lets pads /
// shapes / texts be selected, dragged (0.05mm snap), tweaked numerically and
// deleted. Undo/redo snapshots the tree via KiHistory. Saving downloads a
// fresh .kicad_mod for use in desktop KiCad.

(function (global) {
  'use strict';

  const S = function () { return global.SExpr; };
  const M = function () { return global.KiModel; };

  const SNAP = 0.05; // mm

  let els = null;
  let renderer = null;
  let history = null;
  let fp = null; // (footprint ...) node

  function q(id) { return document.getElementById(id); }

  function ensureInit() {
    if (els) return;
    els = {
      modal: q('fpEditorModal'),
      canvas: q('fpCanvas'),
      name: q('fpName'),
      save: q('fpSaveBtn'),
      close: q('fpEditorClose'),
      file: q('fpFileInput'),
      undo: q('fpUndoBtn'),
      redo: q('fpRedoBtn'),
      fit: q('fpFitBtn'),
      zoomIn: q('fpZoomIn'),
      zoomOut: q('fpZoomOut'),
      panel: q('fpPanel'),
    };
    renderer = new global.KiFpRenderer(els.canvas);
    bindUi();
    bindPointer();
  }

  // --- lifecycle ------------------------------------------------------------

  function setFootprint(node) {
    fp = node;
    renderer.setFootprint(fp);
    history = new global.KiHistory();
    history.init(S().serialize(fp, 0));
    els.name.value = fp.children[1] ? fp.children[1].value : '';
    els.modal.hidden = false;
    requestAnimationFrame(function () {
      renderer.fit();
      renderer.render();
      buildPanel();
    });
  }

  function openFromValue(value) {
    ensureInit();
    const m = /^([^:]+):(.+)$/.exec((value || '').trim());
    if (!m) {
      els.modal.hidden = false;
      fp = null;
      renderer.setFootprint(null);
      renderer.render();
      els.name.value = '';
      buildPanel();
      alert('Footprint 欄に「ライブラリ:名前」形式の値が無いため、\n' +
        '「.kicad_mod を開く…」からファイルを読み込んでください。');
      return;
    }
    global.KiStdLib.loadFootprint(m[1], m[2]).then(function (node) {
      setFootprint(node);
    }).catch(function (err) {
      alert('フットプリントを読み込めませんでした。\n' + err.message);
    });
  }

  function commit() {
    history.commit(S().serialize(fp, 0));
    updateUndoButtons();
  }

  function applySnapshot(text) {
    if (!text) return;
    const keep = renderer.view;
    fp = S().parse(text);
    renderer.setFootprint(fp);
    renderer.view = keep;
    els.name.value = fp.children[1] ? fp.children[1].value : '';
    renderer.render();
    buildPanel();
    updateUndoButtons();
  }

  function updateUndoButtons() {
    els.undo.disabled = !history || !history.canUndo();
    els.redo.disabled = !history || !history.canRedo();
  }

  // --- UI wiring ------------------------------------------------------------

  function bindUi() {
    els.close.addEventListener('click', function () { els.modal.hidden = true; });
    els.fit.addEventListener('click', function () { renderer.fit(); renderer.render(); });
    els.zoomIn.addEventListener('click', function () { zoomCenter(1.4); });
    els.zoomOut.addEventListener('click', function () { zoomCenter(1 / 1.4); });
    els.undo.addEventListener('click', function () { if (history) applySnapshot(history.undo()); });
    els.redo.addEventListener('click', function () { if (history) applySnapshot(history.redo()); });

    els.name.addEventListener('change', function () {
      if (!fp) return;
      const v = els.name.value.trim();
      if (!v) { els.name.value = fp.children[1].value; return; }
      fp.children[1] = { kind: 'atom', value: v, quoted: true };
      commit();
    });

    els.save.addEventListener('click', function () {
      if (!fp) return;
      const text = S().serializeDocument(fp);
      const name = (fp.children[1] ? fp.children[1].value : 'footprint') + '.kicad_mod';
      const blob = new Blob([text], { type: 'text/plain' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    });

    els.file.addEventListener('change', function () {
      const file = els.file.files[0];
      els.file.value = '';
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function () {
        try {
          const root = S().parse(String(reader.result));
          if (M().head(root) !== 'footprint') throw new Error('footprint ファイルではありません');
          setFootprint(root);
        } catch (err) {
          alert('.kicad_mod を読み込めませんでした。\n' + err.message);
        }
      };
      reader.readAsText(file);
    });

    document.addEventListener('keydown', function (e) {
      if (els.modal.hidden) return;
      const tag = document.activeElement && document.activeElement.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); els.undo.click(); }
      else if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); els.redo.click(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection(); }
      else if (e.key === 'Escape') { renderer.selection = null; renderer.render(); buildPanel(); }
    });
  }

  function zoomCenter(f) {
    const rect = els.canvas.getBoundingClientRect();
    zoomAt(rect.width / 2, rect.height / 2, f);
  }

  function zoomAt(sx, sy, f) {
    const v = renderer.view;
    const w = renderer.screenToWorld(sx, sy);
    v.scale = Math.max(2, Math.min(2000, v.scale * f));
    v.panX = w.x - sx / v.scale;
    v.panY = w.y - sy / v.scale;
    renderer.render();
  }

  // --- pointer interaction (1-finger pan / tap select / drag selected) ------

  function bindPointer() {
    const canvas = els.canvas;
    const pointers = new Map();
    let drag = null; // {mode:'pan'|'move', sx, sy, moved, base}
    let pinch = null;

    canvas.addEventListener('pointerdown', function (e) {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (pointers.size === 2) {
        const pts = Array.from(pointers.values());
        pinch = { d: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) };
        drag = null;
        return;
      }
      const w = renderer.screenToWorld(e.offsetX, e.offsetY);
      const tol = 4 / renderer.view.scale + 0.05;
      const hit = fp ? renderer.itemAt(w.x, w.y, tol) : null;
      if (hit && renderer.selection === hit.node) {
        drag = { mode: 'move', sx: e.offsetX, sy: e.offsetY, moved: false, base: captureItem(hit.node) };
      } else {
        drag = { mode: 'pan', sx: e.offsetX, sy: e.offsetY, moved: false, hit: hit };
      }
    });

    canvas.addEventListener('pointermove', function (e) {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (pinch && pointers.size === 2) {
        const pts = Array.from(pointers.values());
        const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (d > 0 && pinch.d > 0) {
          zoomAt((pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2, d / pinch.d);
        }
        pinch.d = d;
        return;
      }
      if (!drag) return;
      const dx = e.offsetX - drag.sx, dy = e.offsetY - drag.sy;
      if (!drag.moved && Math.hypot(dx, dy) < 5) return;
      drag.moved = true;
      if (drag.mode === 'pan') {
        renderer.view.panX -= dx / renderer.view.scale;
        renderer.view.panY -= dy / renderer.view.scale;
        drag.sx = e.offsetX; drag.sy = e.offsetY;
        renderer.render();
      } else {
        const wdx = snap(dx / renderer.view.scale);
        const wdy = snap(dy / renderer.view.scale);
        restoreItem(renderer.selection, drag.base);
        offsetItem(renderer.selection, wdx, wdy);
        renderer.render();
      }
    });

    function finish(e) {
      if (pointers.has(e.pointerId)) pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (!drag) return;
      if (drag.mode === 'move' && drag.moved) {
        commit();
        buildPanel();
      } else if (!drag.moved) {
        // Tap: select / deselect.
        renderer.selection = drag.hit ? drag.hit.node :
          (drag.mode === 'move' ? renderer.selection : null);
        renderer.render();
        buildPanel();
      }
      drag = null;
    }
    canvas.addEventListener('pointerup', finish);
    canvas.addEventListener('pointercancel', finish);

    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      zoomAt(e.offsetX, e.offsetY, e.deltaY < 0 ? 1.2 : 1 / 1.2);
    }, { passive: false });
  }

  function snap(v) { return Math.round(v / SNAP) * SNAP; }

  // Capture / restore / offset an item's coordinates for dragging.
  function captureItem(node) {
    return S().serialize(node, 0);
  }

  function restoreItem(node, text) {
    const fresh = S().parse(text);
    node.children = fresh.children;
  }

  function offsetItem(node, dx, dy) {
    const h = M().head(node);
    if (h === 'pad' || h === 'fp_text' || h === 'property') {
      const at = M().readAt(node);
      if (at) M().writeAt(node, at.x + dx, at.y + dy, at.angle);
      return;
    }
    ['start', 'end', 'center', 'mid'].forEach(function (nm) {
      const n = M().firstChild(node, nm);
      if (!n) return;
      n.children[1] = M().atomNode(M().fmt(M().num(n.children[1]) + dx));
      n.children[2] = M().atomNode(M().fmt(M().num(n.children[2]) + dy));
    });
    const pts = M().firstChild(node, 'pts');
    if (pts) {
      pts.children.forEach(function (xy) {
        if (xy.kind !== 'list' || M().head(xy) !== 'xy') return;
        xy.children[1] = M().atomNode(M().fmt(M().num(xy.children[1]) + dx));
        xy.children[2] = M().atomNode(M().fmt(M().num(xy.children[2]) + dy));
      });
    }
  }

  function deleteSelection() {
    const node = renderer.selection;
    if (!node || !fp) return;
    if (M().head(node) === 'property') {
      alert('Reference / Value プロパティは削除できません。');
      return;
    }
    const idx = fp.children.indexOf(node);
    if (idx >= 0) fp.children.splice(idx, 1);
    renderer.selection = null;
    renderer.render();
    commit();
    buildPanel();
  }

  // --- property panel -------------------------------------------------------

  function field(label, value, onCommit) {
    const wrap = document.createElement('label');
    wrap.className = 'fp-field';
    const span = document.createElement('span');
    span.textContent = label;
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value;
    input.addEventListener('change', function () { onCommit(input.value); });
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') input.blur(); });
    wrap.appendChild(span);
    wrap.appendChild(input);
    return wrap;
  }

  function numField(label, value, apply) {
    return field(label, M().fmt(value), function (v) {
      const n = parseFloat(v);
      if (!isFinite(n)) { buildPanel(); return; }
      apply(n);
      renderer.render();
      commit();
      buildPanel();
    });
  }

  function buildPanel() {
    const c = els.panel;
    c.innerHTML = '';
    const node = renderer.selection;
    if (!fp) {
      c.textContent = 'フットプリントを読み込んでください。';
      return;
    }
    if (!node) {
      c.textContent = 'パッド・図形・テキストをタップで選択。選択中の要素はドラッグで移動できます（0.05mm スナップ）。';
      return;
    }
    const h = M().head(node);
    const title = document.createElement('div');
    title.className = 'fp-panel-title';
    c.appendChild(title);

    if (h === 'pad') {
      const p = renderer.padInfo(node);
      title.textContent = 'パッド ' + (p.number || '(無番)') + ' — ' + p.type + ' / ' + p.shape;
      c.appendChild(field('番号', p.number, function (v) {
        node.children[1] = { kind: 'atom', value: v, quoted: true };
        renderer.render(); commit(); buildPanel();
      }));
      c.appendChild(numField('X (mm)', p.x, function (n) {
        const at = M().readAt(node); M().writeAt(node, n, at.y, at.angle);
      }));
      c.appendChild(numField('Y (mm)', p.y, function (n) {
        const at = M().readAt(node); M().writeAt(node, at.x, n, at.angle);
      }));
      c.appendChild(numField('幅 (mm)', p.w, function (n) { setSize(node, n, null); }));
      c.appendChild(numField('高さ (mm)', p.h, function (n) { setSize(node, null, n); }));
      c.appendChild(numField('回転 (°)', p.rot, function (n) {
        const at = M().readAt(node); M().writeAt(node, at.x, at.y, n);
      }));
      if (p.drillW > 0) {
        c.appendChild(numField('ドリル (mm)', p.drillW, function (n) { setDrill(node, n); }));
      }
    } else if (h === 'fp_text' || h === 'property') {
      const isProp = h === 'property';
      const label = isProp ? node.children[1].value : (node.children[1] ? node.children[1].value : 'text');
      title.textContent = 'テキスト (' + label + ')';
      const txtIdx = 2;
      c.appendChild(field('内容', node.children[txtIdx] ? node.children[txtIdx].value : '',
        function (v) {
          node.children[txtIdx] = { kind: 'atom', value: v, quoted: true };
          renderer.render(); commit(); buildPanel();
        }));
      const at = M().readAt(node) || { x: 0, y: 0, angle: 0 };
      c.appendChild(numField('X (mm)', at.x, function (n) { M().writeAt(node, n, at.y, at.angle); }));
      c.appendChild(numField('Y (mm)', at.y, function (n) { M().writeAt(node, at.x, n, at.angle); }));
    } else {
      title.textContent = '図形 (' + h.replace('fp_', '') + ')';
      const st = M().firstChild(node, 'stroke');
      const wNode = st ? M().firstChild(st, 'width') : M().firstChild(node, 'width');
      if (wNode) {
        c.appendChild(numField('線幅 (mm)', M().num(wNode.children[1]), function (n) {
          wNode.children[1] = M().atomNode(M().fmt(n));
        }));
      }
    }

    const del = document.createElement('button');
    del.className = 'btn';
    del.textContent = '削除';
    del.addEventListener('click', deleteSelection);
    c.appendChild(del);
  }

  function setSize(pad, w, h) {
    const size = M().firstChild(pad, 'size');
    if (!size) return;
    if (w != null) size.children[1] = M().atomNode(M().fmt(w));
    if (h != null) size.children[2] = M().atomNode(M().fmt(h));
  }

  function setDrill(pad, d) {
    const drill = M().firstChild(pad, 'drill');
    if (!drill) return;
    for (let i = 1; i < drill.children.length; i++) {
      if (drill.children[i].kind === 'atom' && isFinite(parseFloat(drill.children[i].value))) {
        drill.children[i] = M().atomNode(M().fmt(d));
        return;
      }
    }
  }

  global.KiFpEditor = {
    openFromValue: openFromValue,
    // test hook
    __state: function () {
      return { fp: fp, renderer: renderer, text: fp ? S().serialize(fp, 0) : '' };
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
