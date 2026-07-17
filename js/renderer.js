// renderer.js — Canvas renderer for a KiCad schematic.
//
// World units are millimetres, matching the file. Screen = (world - pan) *
// scale. The tricky part is the symbol transform: library graphics use +Y up,
// while the sheet uses +Y down, so every library point is Y-flipped, then
// rotated (KiCad's positive angle is counter-clockwise on screen), then
// translated to the instance position.

(function (global) {
  'use strict';

  const M = global.KiModel;

  // Classic KiCad "light" palette.
  const COLORS = {
    background: '#ffffff',
    grid: '#e6e6e6',
    page: '#c8c8c8',
    wire: '#008000',
    bus: '#000080',
    junction: '#008000',
    noConnect: '#0000c0',
    symbol: '#840000',
    symbolFill: '#ffffc2',
    pin: '#840000',
    pinNumber: '#840000',
    pinName: '#008484',
    reference: '#008484',
    value: '#008484',
    field: '#808080',
    label: '#000000',
    globalLabel: '#a02020',
    hierLabel: '#a02020',
    text: '#000000',
    sheet: '#a02020',
    selection: '#ff8c00',
  };

  function Renderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.schem = null;
    this.view = { scale: 4, panX: 0, panY: 0 }; // scale = px per mm
    this.selection = [];   // array of {kind, node}
    this.rubber = null;    // {x0,y0,x1,y1} in world mm while band-selecting
    this.draft = null;     // {x0,y0,x1,y1,kind} preview segment while drawing a wire
    this.bboxCache = new WeakMap();
    this.showGrid = true;
  }

  Renderer.prototype.setSchematic = function (schem) {
    this.schem = schem;
    this.bboxCache = new WeakMap();
  };

  Renderer.prototype.invalidate = function (node) {
    if (node) this.bboxCache.delete(node);
    else this.bboxCache = new WeakMap();
  };

  // --- coordinate transforms ------------------------------------------------

  Renderer.prototype.worldToScreen = function (x, y) {
    return {
      x: (x - this.view.panX) * this.view.scale,
      y: (y - this.view.panY) * this.view.scale,
    };
  };

  Renderer.prototype.screenToWorld = function (sx, sy) {
    return {
      x: sx / this.view.scale + this.view.panX,
      y: sy / this.view.scale + this.view.panY,
    };
  };

  // Transform a library point (+Y up) to world/sheet coordinates.
  function symbolTransform(lx, ly, p) {
    let x = lx, y = ly;
    if (p.mirror === 'y') x = -x; // mirror about Y axis
    if (p.mirror === 'x') y = -y; // mirror about X axis
    y = -y;                       // lib +Y up  ->  sheet +Y down
    const a = (p.angle || 0) * Math.PI / 180;
    const cos = Math.cos(a), sin = Math.sin(a);
    return {
      x: p.x + x * cos + y * sin,
      y: p.y - x * sin + y * cos,
    };
  }
  Renderer.symbolTransform = symbolTransform;

  // --- bounding boxes -------------------------------------------------------

  function growBox(box, x, y) {
    if (x < box.minX) box.minX = x;
    if (y < box.minY) box.minY = y;
    if (x > box.maxX) box.maxX = x;
    if (y > box.maxY) box.maxY = y;
  }

  Renderer.prototype.symbolBBox = function (symbolNode) {
    let box = this.bboxCache.get(symbolNode);
    if (box) return box;

    const lib = this.schem.libFor(symbolNode);
    const p = this.schem.placement(symbolNode);
    box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

    if (lib) {
      lib.bodies.forEach(function (body) {
        if (body.unit !== 0 && body.unit !== p.unit) return;
        body.graphics.forEach(function (g) {
          collectGraphicPoints(g).forEach(function (pt) {
            const w = symbolTransform(pt.x, pt.y, p);
            growBox(box, w.x, w.y);
          });
        });
        body.pins.forEach(function (pin) {
          const tip = symbolTransform(pin.x, pin.y, p);
          const bx = pin.x + pin.length * Math.cos(pin.angle * Math.PI / 180);
          const by = pin.y + pin.length * Math.sin(pin.angle * Math.PI / 180);
          const base = symbolTransform(bx, by, p);
          growBox(box, tip.x, tip.y);
          growBox(box, base.x, base.y);
        });
      });
    }

    if (!isFinite(box.minX)) {
      // No graphics (e.g. power symbol placeholder): fall back to a small box.
      box = { minX: p.x - 2.54, minY: p.y - 2.54, maxX: p.x + 2.54, maxY: p.y + 2.54 };
    }
    this.bboxCache.set(symbolNode, box);
    return box;
  };

  function collectGraphicPoints(g) {
    switch (g.type) {
      case 'rectangle':
        return [g.start, g.end, { x: g.start.x, y: g.end.y }, { x: g.end.x, y: g.start.y }];
      case 'polyline':
        return g.pts;
      case 'circle':
        return [
          { x: g.center.x - g.radius, y: g.center.y - g.radius },
          { x: g.center.x + g.radius, y: g.center.y + g.radius },
        ];
      case 'arc':
        return [g.start, g.mid, g.end];
      case 'text':
        return [{ x: g.x, y: g.y }];
      default:
        return [];
    }
  }

  // Overall bounding box of the whole schematic, in world coords.
  Renderer.prototype.contentBBox = function () {
    const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    const self = this;
    if (!this.schem) return null;

    this.schem.symbols().forEach(function (s) {
      const b = self.symbolBBox(s);
      growBox(box, b.minX, b.minY);
      growBox(box, b.maxX, b.maxY);
    });
    ['wire', 'bus', 'polyline'].forEach(function (t) {
      self.schem.items(t).forEach(function (w) {
        M.readPts(w).forEach(function (pt) { growBox(box, pt.x, pt.y); });
      });
    });
    ['label', 'global_label', 'hierarchical_label', 'text', 'junction', 'no_connect'].forEach(function (t) {
      self.schem.items(t).forEach(function (node) {
        const at = M.readAt(node);
        if (at) growBox(box, at.x, at.y);
      });
    });
    self.schem.items('sheet').forEach(function (sh) {
      const at = M.readAt(sh);
      const size = M.firstChild(sh, 'size');
      if (at) {
        growBox(box, at.x, at.y);
        if (size) growBox(box, at.x + M.num(size.children[1]), at.y + M.num(size.children[2]));
      }
    });

    if (!isFinite(box.minX)) return null;
    return box;
  };

  Renderer.prototype.fit = function () {
    const box = this.contentBBox();
    const rect = this.canvas.getBoundingClientRect();
    if (!box) {
      this.view = { scale: 4, panX: 0, panY: 0 };
      return;
    }
    const margin = 10; // mm
    const w = (box.maxX - box.minX) + margin * 2;
    const h = (box.maxY - box.minY) + margin * 2;
    const sx = rect.width / w;
    const sy = rect.height / h;
    const scale = Math.min(sx, sy);
    this.view.scale = scale > 0 && isFinite(scale) ? scale : 4;
    this.view.panX = box.minX - margin - (rect.width / this.view.scale - w) / 2;
    this.view.panY = box.minY - margin - (rect.height / this.view.scale - h) / 2;
  };

  // --- hit testing ----------------------------------------------------------

  // `tol` expands each bbox by that many mm — handy for imprecise touch taps.
  Renderer.prototype.symbolAt = function (worldX, worldY, tol) {
    tol = tol || 0;
    const symbols = this.schem.symbols();
    for (let i = symbols.length - 1; i >= 0; i--) {
      const b = this.symbolBBox(symbols[i]);
      if (worldX >= b.minX - tol && worldX <= b.maxX + tol &&
          worldY >= b.minY - tol && worldY <= b.maxY + tol) {
        return symbols[i];
      }
    }
    return null;
  };

  // --- rendering ------------------------------------------------------------

  Renderer.prototype.render = function () {
    const ctx = this.ctx;
    const dpr = global.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    if (this.canvas.width !== Math.round(rect.width * dpr) ||
        this.canvas.height !== Math.round(rect.height * dpr)) {
      this.canvas.width = Math.round(rect.width * dpr);
      this.canvas.height = Math.round(rect.height * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, rect.width, rect.height);

    if (!this.schem) return;
    if (this.showGrid) this.drawGrid(rect);

    const self = this;
    // Wires / buses.
    this.schem.items('bus').forEach(function (w) { self.drawWire(w, COLORS.bus, 0.3); });
    this.schem.items('wire').forEach(function (w) { self.drawWire(w, COLORS.wire, 0.15); });
    this.schem.items('polyline').forEach(function (w) { self.drawWire(w, COLORS.text, 0.15); });

    // Symbols.
    this.schem.symbols().forEach(function (s) { self.drawSymbol(s); });

    // Junctions, no-connects.
    this.schem.items('junction').forEach(function (j) { self.drawJunction(j); });
    this.schem.items('no_connect').forEach(function (n) { self.drawNoConnect(n); });

    // Labels & text.
    this.schem.items('label').forEach(function (l) { self.drawLabel(l, COLORS.label, 'local'); });
    this.schem.items('global_label').forEach(function (l) { self.drawLabel(l, COLORS.globalLabel, 'global'); });
    this.schem.items('hierarchical_label').forEach(function (l) { self.drawLabel(l, COLORS.hierLabel, 'hier'); });
    this.schem.items('text').forEach(function (t) { self.drawText(t); });
    this.schem.items('sheet').forEach(function (sh) { self.drawSheet(sh); });

    if (this.selection && this.selection.length) {
      for (let i = 0; i < this.selection.length; i++) {
        const it = this.selection[i];
        this.drawSelectionBox(this.itemBBox(it.kind, it.node));
      }
    }
    if (this.rubber) this.drawRubber();
    if (this.draft) this.drawDraft();
  };

  Renderer.prototype.drawDraft = function () {
    const d = this.draft;
    const ctx = this.ctx;
    const a = this.worldToScreen(d.x0, d.y0);
    const b = this.worldToScreen(d.x1, d.y1);
    ctx.strokeStyle = d.kind === 'bus' ? COLORS.bus : COLORS.wire;
    ctx.lineWidth = Math.max(1, (d.kind === 'bus' ? 0.3 : 0.15) * this.view.scale);
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.setLineDash([]);
    // Mark the fixed starting point.
    ctx.fillStyle = ctx.strokeStyle;
    ctx.fillRect(a.x - 3, a.y - 3, 6, 6);
  };

  Renderer.prototype.drawGrid = function (rect) {
    const ctx = this.ctx;
    const step = 2.54; // mm
    const px = step * this.view.scale;
    if (px < 6) return; // too dense to be useful
    const start = this.screenToWorld(0, 0);
    const end = this.screenToWorld(rect.width, rect.height);
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = Math.ceil(start.x / step) * step; x < end.x; x += step) {
      const s = this.worldToScreen(x, 0);
      ctx.moveTo(s.x, 0);
      ctx.lineTo(s.x, rect.height);
    }
    for (let y = Math.ceil(start.y / step) * step; y < end.y; y += step) {
      const s = this.worldToScreen(0, y);
      ctx.moveTo(0, s.y);
      ctx.lineTo(rect.width, s.y);
    }
    ctx.stroke();
  };

  Renderer.prototype.drawWire = function (node, color, widthMm) {
    const pts = M.readPts(node);
    if (pts.length < 2) return;
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, widthMm * this.view.scale);
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const s = this.worldToScreen(pts[i].x, pts[i].y);
      if (i === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
    }
    ctx.stroke();
  };

  Renderer.prototype.drawJunction = function (node) {
    const at = M.readAt(node);
    if (!at) return;
    const ctx = this.ctx;
    const s = this.worldToScreen(at.x, at.y);
    ctx.fillStyle = COLORS.junction;
    ctx.beginPath();
    ctx.arc(s.x, s.y, Math.max(2, 0.5 * this.view.scale), 0, Math.PI * 2);
    ctx.fill();
  };

  Renderer.prototype.drawNoConnect = function (node) {
    const at = M.readAt(node);
    if (!at) return;
    const ctx = this.ctx;
    const s = this.worldToScreen(at.x, at.y);
    const r = 0.635 * this.view.scale;
    ctx.strokeStyle = COLORS.noConnect;
    ctx.lineWidth = Math.max(1, 0.15 * this.view.scale);
    ctx.beginPath();
    ctx.moveTo(s.x - r, s.y - r); ctx.lineTo(s.x + r, s.y + r);
    ctx.moveTo(s.x - r, s.y + r); ctx.lineTo(s.x + r, s.y - r);
    ctx.stroke();
  };

  Renderer.prototype.drawSymbol = function (symbolNode) {
    const lib = this.schem.libFor(symbolNode);
    const p = this.schem.placement(symbolNode);
    const ctx = this.ctx;
    const self = this;

    if (lib) {
      lib.bodies.forEach(function (body) {
        if (body.unit !== 0 && body.unit !== p.unit) return;
        body.graphics.forEach(function (g) { self.drawGraphic(g, p); });
        body.pins.forEach(function (pin) { self.drawPin(pin, p, lib); });
      });
    }

    // Visible properties (Reference, Value, ...) at their absolute positions.
    this.schem.properties(symbolNode).forEach(function (prop) {
      if (prop.hidden || !prop.value || !prop.at) return;
      let color = COLORS.field;
      if (prop.key === 'Reference') color = COLORS.reference;
      else if (prop.key === 'Value') color = COLORS.value;
      self.drawFieldText(prop.value, prop.at.x, prop.at.y, prop.at.angle, color, 1.27, prop.node);
    });
  };

  Renderer.prototype.drawGraphic = function (g, p) {
    const ctx = this.ctx;
    const self = this;
    ctx.strokeStyle = COLORS.symbol;
    ctx.lineWidth = Math.max(1, 0.15 * this.view.scale);
    ctx.lineJoin = 'round';

    function moveTo(pt) { const s = self.worldToScreen(pt.x, pt.y); ctx.moveTo(s.x, s.y); }
    function lineTo(pt) { const s = self.worldToScreen(pt.x, pt.y); ctx.lineTo(s.x, s.y); }

    function applyFill(fill) {
      if (fill === 'background') { ctx.fillStyle = COLORS.symbolFill; ctx.fill(); }
      else if (fill === 'outline') { ctx.fillStyle = COLORS.symbol; ctx.fill(); }
    }

    if (g.type === 'rectangle') {
      const c = [
        symbolTransform(g.start.x, g.start.y, p),
        symbolTransform(g.end.x, g.start.y, p),
        symbolTransform(g.end.x, g.end.y, p),
        symbolTransform(g.start.x, g.end.y, p),
      ];
      ctx.beginPath();
      moveTo(c[0]); lineTo(c[1]); lineTo(c[2]); lineTo(c[3]); ctx.closePath();
      applyFill(g.fill);
      ctx.stroke();
    } else if (g.type === 'polyline') {
      if (g.pts.length < 2) return;
      ctx.beginPath();
      for (let i = 0; i < g.pts.length; i++) {
        const w = symbolTransform(g.pts[i].x, g.pts[i].y, p);
        if (i === 0) moveTo(w); else lineTo(w);
      }
      applyFill(g.fill);
      ctx.stroke();
    } else if (g.type === 'circle') {
      const c = symbolTransform(g.center.x, g.center.y, p);
      const s = this.worldToScreen(c.x, c.y);
      ctx.beginPath();
      ctx.arc(s.x, s.y, g.radius * this.view.scale, 0, Math.PI * 2);
      applyFill(g.fill);
      ctx.stroke();
    } else if (g.type === 'arc') {
      this.drawArc(g, p);
    } else if (g.type === 'text') {
      const w = symbolTransform(g.x, g.y, p);
      this.drawFieldText(g.text, w.x, w.y, 0, COLORS.symbol, 1.27, null);
    }
  };

  Renderer.prototype.drawArc = function (g, p) {
    const a = symbolTransform(g.start.x, g.start.y, p);
    const b = symbolTransform(g.mid.x, g.mid.y, p);
    const c = symbolTransform(g.end.x, g.end.y, p);
    const ctx = this.ctx;
    ctx.strokeStyle = COLORS.symbol;
    ctx.lineWidth = Math.max(1, 0.15 * this.view.scale);

    const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
    if (Math.abs(d) < 1e-9) {
      // Degenerate: draw straight segments.
      const sa = this.worldToScreen(a.x, a.y), sc = this.worldToScreen(c.x, c.y);
      ctx.beginPath(); ctx.moveTo(sa.x, sa.y); ctx.lineTo(sc.x, sc.y); ctx.stroke();
      return;
    }
    const a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, c2 = c.x * c.x + c.y * c.y;
    const cx = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
    const cy = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
    const r = Math.hypot(a.x - cx, a.y - cy);
    const sc = this.worldToScreen(cx, cy);
    let a1 = Math.atan2(a.y - cy, a.x - cx);
    let am = Math.atan2(b.y - cy, b.x - cx);
    let a3 = Math.atan2(c.y - cy, c.x - cx);
    // Choose sweep direction so the arc passes through the mid point.
    const anticlockwise = !angleBetween(a1, am, a3);
    ctx.beginPath();
    ctx.arc(sc.x, sc.y, r * this.view.scale, a1, a3, anticlockwise);
    ctx.stroke();
  };

  // True if sweeping clockwise from a1 to a2 passes through mid.
  function angleBetween(a1, mid, a2) {
    const norm = function (x) { while (x < 0) x += Math.PI * 2; while (x >= Math.PI * 2) x -= Math.PI * 2; return x; };
    const span = norm(a2 - a1);
    const m = norm(mid - a1);
    return m <= span;
  }

  Renderer.prototype.drawPin = function (pin, p, lib) {
    if (pin.hide) return;
    const ctx = this.ctx;
    // The pin's (at) point is the connection tip; the angle points inward toward
    // the body, so the body end is tip + length·(cos, sin).
    const rad = pin.angle * Math.PI / 180;
    const bx = pin.x + pin.length * Math.cos(rad);
    const by = pin.y + pin.length * Math.sin(rad);
    const tip = symbolTransform(pin.x, pin.y, p);
    const base = symbolTransform(bx, by, p);

    const st = this.worldToScreen(tip.x, tip.y);
    const sb = this.worldToScreen(base.x, base.y);
    ctx.strokeStyle = COLORS.pin;
    ctx.lineWidth = Math.max(1, 0.15 * this.view.scale);
    ctx.beginPath();
    ctx.moveTo(sb.x, sb.y); ctx.lineTo(st.x, st.y);
    ctx.stroke();

    // Pin number near the pin body; pin name near the tip (unless hidden).
    if (this.view.scale >= 6) {
      const mid = { x: (tip.x + base.x) / 2, y: (tip.y + base.y) / 2 };
      if (!lib.hidePinNumbers && pin.number && pin.number !== '~') {
        this.drawFieldText(pin.number, mid.x, mid.y - 0.4, 0, COLORS.pinNumber, 1.0, null);
      }
      if (!lib.hidePinNames && pin.name && pin.name !== '~') {
        this.drawFieldText(pin.name, tip.x, tip.y, 0, COLORS.pinName, 1.0, null);
      }
    }
  };

  // --- text (Hershey single-stroke, KiCad-like) -----------------------------

  // Read font size (mm) from a node's (effects (font (size h w))).
  function fieldSize(node) {
    const eff = M.firstChild(node, 'effects');
    if (!eff) return 1.27;
    const font = M.firstChild(eff, 'font');
    if (!font) return 1.27;
    const size = M.firstChild(font, 'size');
    return size ? M.num(size.children[1]) : 1.27;
  }

  // Read (effects ... (justify left|right|top|bottom ...)) into {h, v}.
  function parseJustify(node) {
    const eff = M.firstChild(node, 'effects');
    const out = { h: null, v: null };
    if (!eff) return out;
    const j = M.firstChild(eff, 'justify');
    if (!j) return out;
    j.children.slice(1).forEach(function (c) {
      if (c.kind !== 'atom') return;
      if (c.value === 'left' || c.value === 'right') out.h = c.value;
      else if (c.value === 'top' || c.value === 'bottom') out.v = c.value;
    });
    return out;
  }

  // Core stroke-text drawer. opts: {size, angle, color, hjustify, vjustify, width}
  Renderer.prototype.drawStrokeText = function (text, x, y, opts) {
    if (text === '' || text == null) return;
    const polys = global.StrokeFont.polylines(String(text), {
      x: x, y: y,
      size: opts.size || 1.27,
      angle: opts.angle || 0,
      hjustify: opts.hjustify || 'center',
      vjustify: opts.vjustify || 'center',
    });
    const ctx = this.ctx;
    ctx.strokeStyle = opts.color || COLORS.text;
    ctx.lineWidth = Math.max(1, (opts.width || 0.12) * this.view.scale);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 0; i < polys.length; i++) {
      const p = polys[i];
      ctx.beginPath();
      for (let j = 0; j < p.length; j++) {
        const s = this.worldToScreen(p[j].x, p[j].y);
        if (j === 0) ctx.moveTo(s.x, s.y); else ctx.lineTo(s.x, s.y);
      }
      ctx.stroke();
    }
  };

  // Symbol fields / pin labels: centred by default.
  Renderer.prototype.drawFieldText = function (text, x, y, angle, color, sizeMm, owner) {
    this.drawStrokeText(text, x, y, {
      size: sizeMm, angle: angle, color: color, hjustify: 'center', vjustify: 'center',
    });
  };

  Renderer.prototype.drawLabel = function (node, color, kind) {
    const at = M.readAt(node);
    const text = node.children[1] ? node.children[1].value : '';
    if (!at) return;
    const j = parseJustify(node);
    const size = fieldSize(node);
    const hj = j.h || 'left';
    const vj = j.v || 'center';
    // For global / hierarchical labels, outline the text so they read distinctly.
    if (kind !== 'local') {
      const w = global.StrokeFont.widthMm(text, size);
      const pad = size * 0.5;
      const ctx = this.ctx;
      const cx = at.x, cy = at.y;
      // Rough box centred on the text, aligned to the anchor by justify.
      let x0 = cx, x1 = cx + w;
      if (hj === 'center') { x0 = cx - w / 2; x1 = cx + w / 2; }
      else if (hj === 'right') { x0 = cx - w; x1 = cx; }
      const y0 = cy - size * 0.9, y1 = cy + size * 0.9;
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1, 0.12 * this.view.scale);
      const a = this.worldToScreen(x0 - pad, y0), b = this.worldToScreen(x1 + pad, y1);
      ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    }
    this.drawStrokeText(text, at.x, at.y, {
      size: size, angle: at.angle, color: color, hjustify: hj, vjustify: vj,
    });
  };

  Renderer.prototype.drawText = function (node) {
    const at = M.readAt(node);
    const text = node.children[1] ? node.children[1].value : '';
    if (!at) return;
    const size = fieldSize(node);
    const j = parseJustify(node);
    const self = this;
    text.split('\n').forEach(function (line, i) {
      self.drawStrokeText(line, at.x, at.y + i * size * 1.5, {
        size: size, angle: at.angle, color: COLORS.text,
        hjustify: j.h || 'left', vjustify: j.v || 'top',
      });
    });
  };

  Renderer.prototype.drawSheet = function (node) {
    const at = M.readAt(node);
    const size = M.firstChild(node, 'size');
    if (!at || !size) return;
    const ctx = this.ctx;
    const w = M.num(size.children[1]), h = M.num(size.children[2]);
    const s = this.worldToScreen(at.x, at.y);
    ctx.strokeStyle = COLORS.sheet;
    ctx.lineWidth = Math.max(1, 0.15 * this.view.scale);
    ctx.strokeRect(s.x, s.y, w * this.view.scale, h * this.view.scale);
    const self = this;
    M.childLists(node, 'property').forEach(function (pr, i) {
      const val = pr.children[2] ? pr.children[2].value : '';
      self.drawStrokeText(val, at.x, at.y - 1 - i * 1.6, {
        size: 1.27, angle: 0, color: COLORS.sheet, hjustify: 'left', vjustify: 'bottom',
      });
    });
  };

  Renderer.prototype.drawSelectionBox = function (b) {
    if (!b) return;
    const ctx = this.ctx;
    const tl = this.worldToScreen(b.minX, b.minY);
    const br = this.worldToScreen(b.maxX, b.maxY);
    const pad = 4;
    ctx.strokeStyle = COLORS.selection;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 3]);
    ctx.strokeRect(tl.x - pad, tl.y - pad, (br.x - tl.x) + pad * 2, (br.y - tl.y) + pad * 2);
    ctx.setLineDash([]);
  };

  Renderer.prototype.drawRubber = function () {
    const r = this.rubber;
    const ctx = this.ctx;
    const a = this.worldToScreen(Math.min(r.x0, r.x1), Math.min(r.y0, r.y1));
    const b = this.worldToScreen(Math.max(r.x0, r.x1), Math.max(r.y0, r.y1));
    ctx.fillStyle = 'rgba(37, 99, 235, 0.08)';
    ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
    ctx.strokeStyle = '#2563eb';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    ctx.setLineDash([]);
  };

  // --- generic item hit-testing & bounds ------------------------------------

  function distToSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }

  // Bounding box (world mm) for any selectable item kind.
  Renderer.prototype.itemBBox = function (kind, node) {
    if (kind === 'symbol') return this.symbolBBox(node);
    if (kind === 'wire' || kind === 'bus' || kind === 'polyline') {
      const pts = M.readPts(node);
      if (!pts.length) return null;
      const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
      pts.forEach(function (p) { growBox(b, p.x, p.y); });
      b.minX -= 0.3; b.minY -= 0.3; b.maxX += 0.3; b.maxY += 0.3;
      return b;
    }
    const at = M.readAt(node);
    if (!at) return null;
    if (kind === 'junction' || kind === 'no_connect') {
      return { minX: at.x - 1, minY: at.y - 1, maxX: at.x + 1, maxY: at.y + 1 };
    }
    // Labels and free text: approximate box from stroke-font metrics + justify.
    const text = node.children[1] ? node.children[1].value : '';
    const size = fieldSize(node);
    const w = (global.StrokeFont ? global.StrokeFont.widthMm(text, size) : text.length * size) + size;
    const h = size * 1.8;
    const j = parseJustify(node);
    const hj = j.h || 'left';
    let x0, x1;
    if (hj === 'center') { x0 = -w / 2; x1 = w / 2; }
    else if (hj === 'right') { x0 = -w; x1 = 0; }
    else { x0 = 0; x1 = w; }
    if (at.angle === 90 || at.angle === 270) {
      // Rotated CCW: local +x runs upward on the sheet.
      return { minX: at.x - h / 2, minY: at.y - x1, maxX: at.x + h / 2, maxY: at.y - x0 };
    }
    return { minX: at.x + x0, minY: at.y - h / 2, maxX: at.x + x1, maxY: at.y + h / 2 };
  };

  // Topmost item of any kind at a world point. Small point-like items win,
  // then text, then symbols, then wires.
  Renderer.prototype.itemAt = function (wx, wy, tol) {
    tol = tol || 0.5;
    const s = this.schem;
    if (!s) return null;
    const self = this;

    let hit = null;
    ['junction', 'no_connect'].some(function (k) {
      return s.items(k).some(function (n) {
        const at = M.readAt(n);
        if (at && Math.hypot(wx - at.x, wy - at.y) <= Math.max(tol, 1)) {
          hit = { kind: k, node: n };
          return true;
        }
        return false;
      });
    });
    if (hit) return hit;

    ['label', 'global_label', 'hierarchical_label', 'text'].some(function (k) {
      return s.items(k).some(function (n) {
        const b = self.itemBBox(k, n);
        if (b && wx >= b.minX - tol && wx <= b.maxX + tol &&
            wy >= b.minY - tol && wy <= b.maxY + tol) {
          hit = { kind: k, node: n };
          return true;
        }
        return false;
      });
    });
    if (hit) return hit;

    const sym = this.symbolAt(wx, wy, tol);
    if (sym) return { kind: 'symbol', node: sym };

    ['wire', 'bus', 'polyline'].some(function (k) {
      return s.items(k).some(function (n) {
        const pts = M.readPts(n);
        for (let i = 0; i + 1 < pts.length; i++) {
          if (distToSeg(wx, wy, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y) <= Math.max(tol, 0.4)) {
            hit = { kind: k, node: n };
            return true;
          }
        }
        return false;
      });
    });
    return hit;
  };

  Renderer.COLORS = COLORS;
  global.KiRenderer = Renderer;
})(typeof window !== 'undefined' ? window : globalThis);
