// fprenderer.js — Canvas renderer for KiCad footprints (.kicad_mod trees).
//
// Mirrors the schematic renderer's view model (mm world units, +Y down —
// the same axes .kicad_mod uses) with pcbnew-like layer colours. Draws one
// `(footprint ...)` node: pads (smd / thru-hole with drills), graphic shapes
// per layer, and stroke-font texts. Also provides hit-testing and a content
// bounding box for the editor.

(function (global) {
  'use strict';

  const M = function () { return global.KiModel; };

  const COLORS = {
    background: '#001023',
    grid: '#2a3644',
    axis: '#48586a',
    'F.Cu': '#c83434',
    'B.Cu': '#4d7fc4',
    '*.Cu': '#c8a834',
    'F.SilkS': '#f0e0a0',
    'B.SilkS': '#e8b2a7',
    'F.Fab': '#a8a8a8',
    'B.Fab': '#585d84',
    'F.CrtYd': '#d864ff',
    'B.CrtYd': '#f4b3c2',
    'F.Mask': '#9b26b6',
    'B.Mask': '#02a3a9',
    'Edge.Cuts': '#d0d2cd',
    'Dwgs.User': '#c2c2c2',
    'Cmts.User': '#7fc2f4',
    hole: '#e8e8e8',
    padText: '#ffffff',
    selection: '#ff8c00',
    fallback: '#909090',
  };

  function layerColor(name) {
    return COLORS[name] || COLORS.fallback;
  }

  function FpRenderer(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.fp = null; // (footprint ...) node
    this.view = { scale: 40, panX: -10, panY: -10 };
    this.selection = null; // child node of fp, or null
  }

  FpRenderer.prototype.setFootprint = function (fp) {
    this.fp = fp;
    this.selection = null;
  };

  FpRenderer.prototype.worldToScreen = function (x, y) {
    return {
      x: (x - this.view.panX) * this.view.scale,
      y: (y - this.view.panY) * this.view.scale,
    };
  };

  FpRenderer.prototype.screenToWorld = function (sx, sy) {
    return {
      x: sx / this.view.scale + this.view.panX,
      y: sy / this.view.scale + this.view.panY,
    };
  };

  // --- item helpers ---------------------------------------------------------

  const SHAPE_HEADS = { fp_line: 1, fp_rect: 1, fp_circle: 1, fp_arc: 1, fp_poly: 1 };

  // Every drawable / editable child of the footprint, classified.
  FpRenderer.prototype.items = function () {
    if (!this.fp) return [];
    const out = [];
    this.fp.children.forEach(function (c) {
      if (c.kind !== 'list') return;
      const h = M().head(c);
      if (h === 'pad') out.push({ kind: 'pad', node: c });
      else if (SHAPE_HEADS[h]) out.push({ kind: 'shape', node: c });
      else if (h === 'fp_text' || h === 'property') {
        // KiCad 8+ puts Reference/Value in (property ...); hidden bookkeeping
        // properties carry (hide yes).
        if (h === 'property' && hasHide(c)) return;
        out.push({ kind: 'text', node: c });
      }
    });
    return out;
  };

  function hasHide(node) {
    return node.children.some(function (c) {
      if (c.kind === 'atom') return c.value === 'hide';
      return c.kind === 'list' && M().head(c) === 'hide' &&
        (!c.children[1] || c.children[1].value === 'yes');
    });
  }

  function itemLayer(node) {
    const l = M().firstChild(node, 'layer');
    if (l && l.children[1]) return l.children[1].value;
    const ls = M().firstChild(node, 'layers');
    if (ls) {
      for (let i = 1; i < ls.children.length; i++) {
        const v = ls.children[i].value;
        if (v === 'F.Cu' || v === 'B.Cu' || v === '*.Cu') return v;
      }
      return ls.children[1] ? ls.children[1].value : '';
    }
    return '';
  }

  function strokeWidth(node) {
    const st = M().firstChild(node, 'stroke');
    const w = st ? M().firstChild(st, 'width') : M().firstChild(node, 'width');
    return w ? M().num(w.children[1]) : 0.12;
  }

  // pad geometry: { x, y, rot, w, h, shape, type, drillW, drillH, rratio }
  FpRenderer.prototype.padInfo = function (pad) {
    const at = M().readAt(pad) || { x: 0, y: 0, angle: 0 };
    const size = M().firstChild(pad, 'size');
    const w = size ? M().num(size.children[1]) : 1;
    const h = size && size.children[2] ? M().num(size.children[2]) : w;
    const type = pad.children[2] ? pad.children[2].value : 'smd';
    const shape = pad.children[3] ? pad.children[3].value : 'rect';
    let drillW = 0, drillH = 0;
    const drill = M().firstChild(pad, 'drill');
    if (drill) {
      const args = drill.children.slice(1).filter(function (c) { return c.kind === 'atom'; });
      if (args[0] && args[0].value === 'oval') {
        drillW = M().num(args[1]) || 0;
        drillH = M().num(args[2]) || drillW;
      } else {
        drillW = drillH = M().num(args[0]) || 0;
      }
    }
    const rr = M().firstChild(pad, 'roundrect_rratio');
    return {
      x: at.x, y: at.y, rot: at.angle || 0, w: w, h: h,
      shape: shape, type: type, drillW: drillW, drillH: drillH,
      rratio: rr ? M().num(rr.children[1]) : 0.25,
      number: pad.children[1] ? pad.children[1].value : '',
    };
  };

  // --- rendering ------------------------------------------------------------

  FpRenderer.prototype.render = function () {
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
    if (!this.fp) return;

    this.drawGrid(rect);
    this.drawAxes(rect);

    const self = this;
    const items = this.items();
    const order = { shape: 0, text: 1, pad: 2 };
    items.slice().sort(function (a, b) { return order[a.kind] - order[b.kind]; })
      .forEach(function (it) {
        if (it.kind === 'pad') self.drawPad(it.node, false);
        else if (it.kind === 'shape') self.drawShape(it.node, false);
        else self.drawText(it.node, false);
      });

    // Selection halo on top.
    if (this.selection) {
      const h = M().head(this.selection);
      if (h === 'pad') this.drawPad(this.selection, true);
      else if (SHAPE_HEADS[h]) this.drawShape(this.selection, true);
      else this.drawText(this.selection, true);
    }
  };

  FpRenderer.prototype.drawGrid = function (rect) {
    const ctx = this.ctx;
    let step = 0.1;
    while (step * this.view.scale < 10) step *= 5;
    const tl = this.screenToWorld(0, 0);
    const br = this.screenToWorld(rect.width, rect.height);
    ctx.fillStyle = COLORS.grid;
    const r = 1;
    for (let x = Math.ceil(tl.x / step) * step; x <= br.x; x += step) {
      for (let y = Math.ceil(tl.y / step) * step; y <= br.y; y += step) {
        const s = this.worldToScreen(x, y);
        ctx.fillRect(s.x - r / 2, s.y - r / 2, r, r);
      }
    }
  };

  FpRenderer.prototype.drawAxes = function (rect) {
    const ctx = this.ctx;
    const o = this.worldToScreen(0, 0);
    ctx.strokeStyle = COLORS.axis;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, o.y); ctx.lineTo(rect.width, o.y);
    ctx.moveTo(o.x, 0); ctx.lineTo(o.x, rect.height);
    ctx.stroke();
  };

  FpRenderer.prototype.drawPad = function (pad, selected) {
    const ctx = this.ctx;
    const p = this.padInfo(pad);
    const s = this.worldToScreen(p.x, p.y);
    const sw = p.w * this.view.scale;
    const sh = p.h * this.view.scale;

    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(-p.rot * Math.PI / 180);

    ctx.fillStyle = selected ? COLORS.selection : layerColor(itemLayer(pad));
    ctx.globalAlpha = selected ? 0.9 : 1;
    ctx.beginPath();
    if (p.shape === 'circle') {
      ctx.arc(0, 0, sw / 2, 0, Math.PI * 2);
    } else if (p.shape === 'oval') {
      roundRectPath(ctx, -sw / 2, -sh / 2, sw, sh, Math.min(sw, sh) / 2);
    } else if (p.shape === 'roundrect') {
      roundRectPath(ctx, -sw / 2, -sh / 2, sw, sh, Math.min(sw, sh) * p.rratio);
    } else { // rect / trapezoid / custom fallback
      ctx.rect(-sw / 2, -sh / 2, sw, sh);
    }
    ctx.fill();

    if (p.drillW > 0) {
      ctx.fillStyle = COLORS.hole;
      const dw = p.drillW * this.view.scale;
      const dh = (p.drillH || p.drillW) * this.view.scale;
      ctx.beginPath();
      if (Math.abs(dw - dh) < 0.01) ctx.arc(0, 0, dw / 2, 0, Math.PI * 2);
      else roundRectPath(ctx, -dw / 2, -dh / 2, dw, dh, Math.min(dw, dh) / 2);
      ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;

    // Pad number (upright, centred), only when it fits readably.
    if (p.number && Math.min(sw, sh) > 9) {
      const size = Math.min(p.w, p.h) * 0.5;
      this.strokeText(String(p.number), p.x, p.y, size, COLORS.padText, 0, size * 0.16);
    }
  };

  function roundRectPath(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  FpRenderer.prototype.drawShape = function (node, selected) {
    const ctx = this.ctx;
    const h = M().head(node);
    const layer = itemLayer(node);
    ctx.strokeStyle = selected ? COLORS.selection : layerColor(layer);
    ctx.lineWidth = Math.max(1, strokeWidth(node) * this.view.scale) + (selected ? 2 : 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash(/CrtYd$/.test(layer) ? [4, 3] : []);

    const self = this;
    function pt(name) {
      const n = M().firstChild(node, name);
      return n ? { x: M().num(n.children[1]), y: M().num(n.children[2]) } : null;
    }

    ctx.beginPath();
    if (h === 'fp_line') {
      const a = pt('start'), b = pt('end');
      if (a && b) {
        const s1 = this.worldToScreen(a.x, a.y), s2 = this.worldToScreen(b.x, b.y);
        ctx.moveTo(s1.x, s1.y); ctx.lineTo(s2.x, s2.y);
      }
    } else if (h === 'fp_rect') {
      const a = pt('start'), b = pt('end');
      if (a && b) {
        const s1 = this.worldToScreen(a.x, a.y), s2 = this.worldToScreen(b.x, b.y);
        ctx.rect(Math.min(s1.x, s2.x), Math.min(s1.y, s2.y),
          Math.abs(s2.x - s1.x), Math.abs(s2.y - s1.y));
      }
    } else if (h === 'fp_circle') {
      const c = pt('center'), e = pt('end');
      if (c && e) {
        const sc = this.worldToScreen(c.x, c.y);
        const r = Math.hypot(e.x - c.x, e.y - c.y) * this.view.scale;
        ctx.arc(sc.x, sc.y, r, 0, Math.PI * 2);
      }
    } else if (h === 'fp_arc') {
      const a = pt('start'), m = pt('mid'), b = pt('end');
      if (a && m && b) this.arcPath(a, m, b);
    } else if (h === 'fp_poly') {
      const ptsNode = M().firstChild(node, 'pts');
      if (ptsNode) {
        let first = true;
        ptsNode.children.forEach(function (xy) {
          if (xy.kind !== 'list' || M().head(xy) !== 'xy') return;
          const s = self.worldToScreen(M().num(xy.children[1]), M().num(xy.children[2]));
          if (first) { ctx.moveTo(s.x, s.y); first = false; } else ctx.lineTo(s.x, s.y);
        });
        ctx.closePath();
      }
    }
    ctx.stroke();
    ctx.setLineDash([]);
  };

  // Three-point arc through start/mid/end (screen-space path).
  FpRenderer.prototype.arcPath = function (a, m, b) {
    const ctx = this.ctx;
    const d = 2 * (a.x * (m.y - b.y) + m.x * (b.y - a.y) + b.x * (a.y - m.y));
    if (Math.abs(d) < 1e-9) {
      const s1 = this.worldToScreen(a.x, a.y), s2 = this.worldToScreen(b.x, b.y);
      ctx.moveTo(s1.x, s1.y); ctx.lineTo(s2.x, s2.y);
      return;
    }
    const aa = a.x * a.x + a.y * a.y;
    const mm = m.x * m.x + m.y * m.y;
    const bb = b.x * b.x + b.y * b.y;
    const cx = (aa * (m.y - b.y) + mm * (b.y - a.y) + bb * (a.y - m.y)) / d;
    const cy = (aa * (b.x - m.x) + mm * (a.x - b.x) + bb * (m.x - a.x)) / d;
    const r = Math.hypot(a.x - cx, a.y - cy) * this.view.scale;
    const sc = this.worldToScreen(cx, cy);
    const a1 = Math.atan2(a.y - cy, a.x - cx);
    const a2 = Math.atan2(m.y - cy, m.x - cx);
    const a3 = Math.atan2(b.y - cy, b.x - cx);
    const ccw = ((a2 - a1 + Math.PI * 2) % (Math.PI * 2)) >
      ((a3 - a1 + Math.PI * 2) % (Math.PI * 2));
    ctx.moveTo(this.worldToScreen(a.x, a.y).x, this.worldToScreen(a.x, a.y).y);
    ctx.arc(sc.x, sc.y, r, a1, a3, ccw);
  };

  FpRenderer.prototype.drawText = function (node, selected) {
    const at = M().readAt(node) || { x: 0, y: 0, angle: 0 };
    const text = textValue(node);
    if (!text) return;
    const effects = M().firstChild(node, 'effects');
    const font = effects ? M().firstChild(effects, 'font') : null;
    const sizeN = font ? M().firstChild(font, 'size') : null;
    const size = sizeN ? M().num(sizeN.children[1]) : 1;
    const thickN = font ? M().firstChild(font, 'thickness') : null;
    const thick = thickN ? M().num(thickN.children[1]) : size * 0.15;
    const color = selected ? COLORS.selection : layerColor(itemLayer(node));
    this.strokeText(text, at.x, at.y, size, color, at.angle || 0, thick);
  };

  function textValue(node) {
    const h = M().head(node);
    if (h === 'property') return node.children[2] ? node.children[2].value : '';
    return node.children[2] ? node.children[2].value : '';
  }

  FpRenderer.prototype.strokeText = function (text, x, y, size, color, angle, thick) {
    const polys = global.StrokeFont.polylines(String(text), {
      x: x, y: y, size: size,
      angle: ((angle || 0) % 180 !== 0) ? 90 : 0,
      hjustify: 'center', vjustify: 'center',
    });
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, (thick || size * 0.15) * this.view.scale);
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

  // --- geometry queries -----------------------------------------------------

  FpRenderer.prototype.itemBBox = function (it) {
    const node = it.node || it;
    const h = M().head(node);
    const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    function grow(x, y) {
      box.minX = Math.min(box.minX, x); box.maxX = Math.max(box.maxX, x);
      box.minY = Math.min(box.minY, y); box.maxY = Math.max(box.maxY, y);
    }
    const self = this;
    if (h === 'pad') {
      const p = this.padInfo(node);
      const half = (Math.abs(p.rot % 180) === 90)
        ? { w: p.h / 2, h: p.w / 2 } : { w: p.w / 2, h: p.h / 2 };
      grow(p.x - half.w, p.y - half.h); grow(p.x + half.w, p.y + half.h);
    } else if (h === 'fp_text' || h === 'property') {
      const at = M().readAt(node) || { x: 0, y: 0 };
      const text = textValue(node) || '';
      const w = Math.max(1, text.length * 0.8);
      grow(at.x - w / 2, at.y - 0.7); grow(at.x + w / 2, at.y + 0.7);
    } else {
      ['start', 'end', 'center', 'mid'].forEach(function (nm) {
        const n = M().firstChild(node, nm);
        if (n) grow(M().num(n.children[1]), M().num(n.children[2]));
      });
      const ptsNode = M().firstChild(node, 'pts');
      if (ptsNode) {
        ptsNode.children.forEach(function (xy) {
          if (xy.kind === 'list' && M().head(xy) === 'xy') {
            grow(M().num(xy.children[1]), M().num(xy.children[2]));
          }
        });
      }
      if (h === 'fp_circle') {
        const c = M().firstChild(node, 'center'), e = M().firstChild(node, 'end');
        if (c && e) {
          const cx = M().num(c.children[1]), cy = M().num(c.children[2]);
          const r = Math.hypot(M().num(e.children[1]) - cx, M().num(e.children[2]) - cy);
          grow(cx - r, cy - r); grow(cx + r, cy + r);
        }
      }
    }
    return isFinite(box.minX) ? box : null;
  };

  FpRenderer.prototype.contentBBox = function () {
    const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    const self = this;
    this.items().forEach(function (it) {
      const b = self.itemBBox(it);
      if (!b) return;
      box.minX = Math.min(box.minX, b.minX); box.maxX = Math.max(box.maxX, b.maxX);
      box.minY = Math.min(box.minY, b.minY); box.maxY = Math.max(box.maxY, b.maxY);
    });
    return isFinite(box.minX) ? box : null;
  };

  FpRenderer.prototype.fit = function () {
    const box = this.contentBBox();
    const rect = this.canvas.getBoundingClientRect();
    if (!box) { this.view = { scale: 40, panX: -rect.width / 80, panY: -rect.height / 80 }; return; }
    const margin = Math.max(1, (box.maxX - box.minX) * 0.15);
    const w = (box.maxX - box.minX) + margin * 2;
    const h = (box.maxY - box.minY) + margin * 2;
    const scale = Math.min(rect.width / w, rect.height / h);
    this.view.scale = scale > 0 && isFinite(scale) ? scale : 40;
    this.view.panX = box.minX - margin - (rect.width / this.view.scale - w) / 2;
    this.view.panY = box.minY - margin - (rect.height / this.view.scale - h) / 2;
  };

  // Topmost item at a world point (pads first — they are the edit target).
  FpRenderer.prototype.itemAt = function (wx, wy, tol) {
    tol = tol || 0.2;
    const items = this.items();
    const order = ['pad', 'text', 'shape'];
    for (let k = 0; k < order.length; k++) {
      for (let i = items.length - 1; i >= 0; i--) {
        const it = items[i];
        if (it.kind !== order[k]) continue;
        if (it.kind === 'shape' && !this.shapeHit(it.node, wx, wy, tol)) continue;
        const b = this.itemBBox(it);
        if (b && wx >= b.minX - tol && wx <= b.maxX + tol &&
            wy >= b.minY - tol && wy <= b.maxY + tol) return it;
      }
    }
    return null;
  };

  FpRenderer.prototype.shapeHit = function (node, wx, wy, tol) {
    const h = M().head(node);
    const w2 = strokeWidth(node) / 2 + tol;
    function P(nm) {
      const n = M().firstChild(node, nm);
      return n ? { x: M().num(n.children[1]), y: M().num(n.children[2]) } : null;
    }
    function segDist(a, b) {
      const dx = b.x - a.x, dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, ((wx - a.x) * dx + (wy - a.y) * dy) / len2)) : 0;
      return Math.hypot(wx - (a.x + t * dx), wy - (a.y + t * dy));
    }
    if (h === 'fp_line') {
      const a = P('start'), b = P('end');
      return a && b && segDist(a, b) <= w2;
    }
    if (h === 'fp_rect') {
      const a = P('start'), b = P('end');
      if (!a || !b) return false;
      const c = [{ x: a.x, y: a.y }, { x: b.x, y: a.y }, { x: b.x, y: b.y }, { x: a.x, y: b.y }];
      for (let i = 0; i < 4; i++) if (segDist(c[i], c[(i + 1) % 4]) <= w2) return true;
      return false;
    }
    if (h === 'fp_circle') {
      const c = P('center'), e = P('end');
      if (!c || !e) return false;
      const r = Math.hypot(e.x - c.x, e.y - c.y);
      return Math.abs(Math.hypot(wx - c.x, wy - c.y) - r) <= w2;
    }
    // arcs / polys: bbox test is enough for editing purposes
    return true;
  };

  global.KiFpRenderer = FpRenderer;
})(typeof window !== 'undefined' ? window : globalThis);
