// strokefont.js — renders text with the Hershey single-stroke font (js/hershey.js)
// so schematic text matches KiCad's stroke ("Newstroke") look instead of a
// filled system font.
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

  // Total string width in font units (single line).
  function widthUnits(text) {
    let w = 0;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === ' ') { w += SPACE; continue; }
      w += advance(glyphFor(ch));
    }
    return w;
  }

  function widthMm(text, sizeMm) {
    return widthUnits(text) * (sizeMm / CAP_HEIGHT);
  }

  // Produce polylines (arrays of {x,y}) in world mm for a single line of text.
  // opts: { x, y, size, angle, hjustify, vjustify }
  //   hjustify: 'left' | 'center' | 'right'   (default center)
  //   vjustify: 'top' | 'center' | 'bottom'   (default center; bottom == baseline)
  function polylines(text, opts) {
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

    const out = [];
    let cursor = startX;                       // mm along the (unrotated) baseline
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (ch === ' ') { cursor += SPACE * s; continue; }
      const g = glyphFor(ch);
      if (!g) { cursor += SPACE * s; continue; }
      const gx = cursor - g.minX * s;          // place glyph's left edge at cursor
      for (let k = 0; k < g.strokes.length; k++) {
        const stroke = g.strokes[k];
        const poly = [];
        for (let j = 0; j < stroke.length; j++) {
          const lx = gx + stroke[j][0] * s;                    // text-local x (mm)
          const ly = (stroke[j][1] - BASELINE) * s + baseOff;  // text-local y (mm, y-down)
          // Rotate (CCW on screen, matching symbol transform) then translate.
          const rx = lx * cos + ly * sin;
          const ry = -lx * sin + ly * cos;
          poly.push({ x: opts.x + rx, y: opts.y + ry });
        }
        out.push(poly);
      }
      cursor += advance(g) * s;
    }
    return out;
  }

  global.StrokeFont = {
    polylines: polylines,
    widthMm: widthMm,
    CAP_HEIGHT: CAP_HEIGHT,
  };
})(typeof window !== 'undefined' ? window : globalThis);
