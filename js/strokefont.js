// strokefont.js — renders text with the Hershey single-stroke font (js/hershey.js)
// so schematic text matches KiCad's stroke ("Newstroke") look instead of a
// filled system font.
//
// The Hershey table only covers ASCII (U+21..U+7E). Characters outside it —
// Japanese above all — are collected into "runs" that the caller draws with the
// browser's own font, so mixed text like "電源 5V" renders completely while the
// latin part keeps the stroke look. `layout()` returns both; `polylines()` is
// the stroke-only view kept for callers that do not draw runs.
//
// Font units: y increases downward; capital letters span y≈1 (top) to y≈22
// (baseline), i.e. a cap height of ~21 units. Text is produced as polylines in
// WORLD millimetres, honouring anchor position, size, rotation and justify, so
// the renderer can transform them to screen the same way it does wires.

(function (global) {
  'use strict';

  const DATA = global.Hershey;
  const CAP_TOP = 1;        // font-unit y of the top of capitals
  const BASELINE = 22;      // font-unit y of the baseline
  const CAP_HEIGHT = BASELINE - CAP_TOP; // ≈21 units == one text "size"
  const GAP = 3;            // inter-glyph spacing, font units
  const SPACE = 10;         // width of a space, font units

  // Parse a glyph path string into { strokes: [[[x,y]...]...], minX, maxX }.
  function parseGlyph(d) {
    const strokes = [];
    let cur = null;
    let minX = Infinity, maxX = -Infinity;
    if (d) {
      const tokens = d.split(/\s+/);
      for (let i = 0; i < tokens.length; i++) {
        let t = tokens[i];
        if (!t) continue;
        const penUp = t[0] === 'M';
        if (t[0] === 'M' || t[0] === 'L') t = t.slice(1);
        const comma = t.indexOf(',');
        if (comma < 0) continue;
        const x = parseFloat(t.slice(0, comma));
        const y = parseFloat(t.slice(comma + 1));
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (penUp || !cur) { cur = [[x, y]]; strokes.push(cur); }
        else cur.push([x, y]);
      }
    }
    if (!isFinite(minX)) { minX = 0; maxX = 0; }
    return { strokes: strokes, minX: minX, maxX: maxX };
  }

  // Lazily parse all glyphs once.
  let GLYPHS = null;
  function glyphs() {
    if (!GLYPHS) GLYPHS = DATA.glyphs.map(parseGlyph);
    return GLYPHS;
  }

  function glyphFor(ch) {
    const code = ch.charCodeAt(0);
    const idx = code - DATA.first;
    const g = glyphs();
    if (idx < 0 || idx >= g.length) return null;
    return g[idx];
  }

  // Advance width of a glyph in font units.
  function advance(g) {
    if (!g || g.strokes.length === 0) return SPACE;
    return (g.maxX - g.minX) + GAP;
  }

  // Characters drawn with the browser font instead: CJK sits in a square em
  // box, so one `size`; anything else non-ASCII gets roughly half of that.
  const FULL_WIDTH = [
    [0x1100, 0x115f], [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf],
    [0x4e00, 0x9fff], [0xa000, 0xa4cf], [0xac00, 0xd7a3], [0xf900, 0xfaff],
    [0xfe30, 0xfe6f], [0xff00, 0xff60], [0xffe0, 0xffe6],
  ];
  function isFullWidth(code) {
    for (let i = 0; i < FULL_WIDTH.length; i++) {
      if (code >= FULL_WIDTH[i][0] && code <= FULL_WIDTH[i][1]) return true;
    }
    return false;
  }
  function nativeAdvance(ch) {
    const code = ch.charCodeAt(0);
    if (code < 0x20) return 0;
    return isFullWidth(code) ? CAP_HEIGHT : CAP_HEIGHT * 0.55;
  }

  // Advance of one character, whichever path will draw it.
  function charAdvance(ch) {
    if (ch === ' ') return SPACE;
    const g = glyphFor(ch);
    return g ? advance(g) : nativeAdvance(ch);
  }

  // Total string width in font units (single line).
  function widthUnits(text) {
    let w = 0;
    for (let i = 0; i < text.length; i++) w += charAdvance(text[i]);
    return w;
  }

  function widthMm(text, sizeMm) {
    return widthUnits(text) * (sizeMm / CAP_HEIGHT);
  }

  // Lay a single line out. Returns { polys, runs }:
  //   polys — arrays of {x,y} in world mm, for the stroke font
  //   runs  — { text, x, y, angle, size } in world mm, to draw with the
  //           browser font; x/y is the run's baseline start, already rotated
  // opts: { x, y, size, angle, hjustify, vjustify }
  //   hjustify: 'left' | 'center' | 'right'   (default center)
  //   vjustify: 'top' | 'center' | 'bottom'   (default center; bottom == baseline)
  function layout(text, opts) {
    const size = opts.size || 1.27;
    const s = size / CAP_HEIGHT;              // mm per font unit
    const angle = (opts.angle || 0) * Math.PI / 180;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const hj = opts.hjustify || 'center';
    const vj = opts.vjustify || 'center';

    const totalW = widthUnits(text) * s;      // mm
    let startX;                                // mm, left edge of text
    if (hj === 'center') startX = -totalW / 2;
    else if (hj === 'right') startX = -totalW;
    else startX = 0;

    // Baseline offset (mm) relative to the anchor point.
    let baseOff;
    if (vj === 'top') baseOff = size;         // caps start at anchor -> baseline below
    else if (vj === 'center') baseOff = size / 2;
    else baseOff = 0;                          // bottom/baseline

    // Rotate a text-local point (CCW on screen, matching symbol transform)
    // and translate it onto the anchor.
    function place(lx, ly) {
      return { x: opts.x + (lx * cos + ly * sin), y: opts.y + (-lx * sin + ly * cos) };
    }

    const out = [];
    const runs = [];
    let run = null;                            // { text, start } being collected
    function flushRun() {
      if (!run) return;
      const at = place(run.start, baseOff);
      runs.push({ text: run.text, x: at.x, y: at.y, angle: opts.angle || 0, size: size });
      run = null;
    }

    let cursor = startX;                       // mm along the (unrotated) baseline
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      const g = ch === ' ' ? null : glyphFor(ch);
      if (!g) {
        // No stroke glyph: space just advances, control characters are dropped,
        // anything else joins a run the caller draws with the browser font.
        if (ch === ' ') { flushRun(); cursor += SPACE * s; continue; }
        if (ch.charCodeAt(0) < 0x20) { flushRun(); continue; }
        if (!run) run = { text: '', start: cursor };
        run.text += ch;
        cursor += nativeAdvance(ch) * s;
        continue;
      }
      flushRun();
      const gx = cursor - g.minX * s;          // place glyph's left edge at cursor
      for (let k = 0; k < g.strokes.length; k++) {
        const stroke = g.strokes[k];
        const poly = [];
        for (let j = 0; j < stroke.length; j++) {
          const lx = gx + stroke[j][0] * s;                    // text-local x (mm)
          const ly = (stroke[j][1] - BASELINE) * s + baseOff;  // text-local y (mm, y-down)
          poly.push(place(lx, ly));
        }
        out.push(poly);
      }
      cursor += advance(g) * s;
    }
    flushRun();
    return { polys: out, runs: runs };
  }

  function polylines(text, opts) { return layout(text, opts).polys; }

  global.StrokeFont = {
    layout: layout,
    polylines: polylines,
    widthMm: widthMm,
    CAP_HEIGHT: CAP_HEIGHT,
  };
})(typeof window !== 'undefined' ? window : globalThis);
