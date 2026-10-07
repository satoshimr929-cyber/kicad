// The hand-authored RP2040-Zero part: its geometry comes from Waveshare's
// mechanical drawing, and a symbol pin that disagrees with a footprint pad
// silently produces a wrong board, so assert both against the drawing.
'use strict';

const fs = require('fs');
const path = require('path');
const H = require('../lib/harness');
const S = H.sexpr();

const FP = path.join(H.REPO, 'footprints', 'Custom.pretty', 'RP2040-Zero.kicad_mod');
const SYM = path.join(H.REPO, 'custom', 'RP2040-Zero.kicad_sym');

function head(n) { return n && n.kind === 'list' && n.children[0] ? n.children[0].value : null; }
function lists(n, name) {
  return n.children.filter(function (c) { return c.kind === 'list' && head(c) === name; });
}
function sub(n, name) { return lists(n, name)[0]; }
function num(a) { return parseFloat(a.value); }

// --- footprint ------------------------------------------------------------

const fp = S.parse(fs.readFileSync(FP, 'utf8'));
H.check('footprint parses', head(fp) === 'footprint' && fp.children[1].value === 'RP2040-Zero');

const pads = lists(fp, 'pad').map(function (p) {
  const at = sub(p, 'at');
  const fn = sub(p, 'pinfunction');
  const size = sub(p, 'size');
  const drill = sub(p, 'drill');
  return {
    n: parseInt(p.children[1].value, 10),
    type: p.children[2].value,
    shape: p.children[3].value,
    x: num(at.children[1]), y: num(at.children[2]),
    w: num(size.children[1]), h: num(size.children[2]),
    drill: drill ? num(drill.children[1]) : 0,
    name: fn && fn.children[1] ? fn.children[1].value : null,
  };
});

H.check('23 pads', pads.length === 23, 'got ' + pads.length);
H.check('pad numbers are exactly 1..23',
  pads.map(function (p) { return p.n; }).join() ===
  Array.from({ length: 23 }, function (_, i) { return i + 1; }).join());
H.check('all pads are through-hole (THT-only variant)',
  pads.every(function (p) { return p.type === 'thru_hole'; }));
H.check('pad 1 is rectangular, the rest round (KiCad pin-1 convention)',
  pads[0].shape === 'rect' && pads.slice(1).every(function (p) { return p.shape === 'circle'; }));
H.check('every pad carries a pinfunction',
  pads.every(function (p) { return p.name; }));

// Numbers straight off the Waveshare drawing.
const BOARD_W = 18.0, BOARD_H = 23.5;
const xs = Array.from(new Set(pads.map(function (p) { return p.x; }))).sort(function (a, b) { return a - b; });
const ys = Array.from(new Set(pads.map(function (p) { return p.y; }))).sort(function (a, b) { return a - b; });

H.check('row spacing is 15.24mm (0.6in)', xs[0] === -7.62 && xs[xs.length - 1] === 7.62,
  'columns at ' + xs.join(', '));
H.check('board edge to pad column is 1.38mm', BOARD_W / 2 - 7.62 === 1.38);
H.check('top edge to first pad is 1.59mm', Math.abs((BOARD_H / 2 + ys[0]) - 1.59) < 1e-9,
  'first row y=' + ys[0]);
H.check('side rows are symmetric about the origin',
  Math.abs(ys[0] + ys[ys.length - 1]) < 1e-9);
H.check('pitch is 2.54mm on both axes',
  ys.every(function (y, i) { return i === 0 || Math.abs(y - ys[i - 1] - 2.54) < 1e-9; }) &&
  xs.slice(1, -1).every(function (x, i, a) { return i === 0 || Math.abs(x - a[i - 1] - 2.54) < 1e-9; }));
H.check('right edge to the bottom-right-only pad is 3.92mm',
  Math.abs((BOARD_W / 2 - 5.08) - 3.92) < 1e-9);

const bottom = pads.filter(function (p) { return p.y === ys[ys.length - 1] && Math.abs(p.x) < 7.62; });
H.check('5 pads along the bottom edge at x = 0, +/-2.54, +/-5.08',
  bottom.length === 5 && bottom.map(function (p) { return p.x; }).sort(function (a, b) { return a - b; })
    .join() === '-5.08,-2.54,0,2.54,5.08');

H.check('every pad sits inside the 18.0 x 23.5mm outline',
  pads.every(function (p) {
    return Math.abs(p.x) + p.w / 2 <= BOARD_W / 2 && Math.abs(p.y) + p.h / 2 <= BOARD_H / 2;
  }));

let minGap = Infinity;
for (let i = 0; i < pads.length; i++) {
  for (let j = i + 1; j < pads.length; j++) {
    const d = Math.hypot(pads[i].x - pads[j].x, pads[i].y - pads[j].y) - pads[i].w;
    if (d < minGap) minGap = d;
  }
}
H.check('copper gap between adjacent pads >= 0.8mm', minGap >= 0.8, 'min ' + minGap.toFixed(3) + 'mm');
H.check('drills are 1.0mm (2.54mm header pins)',
  pads.every(function (p) { return p.drill === 1; }));

// --- symbol ---------------------------------------------------------------

const lib = S.parse(fs.readFileSync(SYM, 'utf8'));
H.check('symbol library parses', head(lib) === 'kicad_symbol_lib');
const sym = lists(lib, 'symbol')[0];
H.check('symbol is named RP2040-Zero', sym.children[1].value === 'RP2040-Zero');

const pins = [];
lists(sym, 'symbol').forEach(function (u) {
  u.children.forEach(function (c) {
    if (c.kind !== 'list' || head(c) !== 'pin') return;
    pins.push({
      etype: c.children[1].value,
      name: sub(c, 'name').children[1].value,
      n: parseInt(sub(c, 'number').children[1].value, 10),
    });
  });
});
pins.sort(function (a, b) { return a.n - b.n; });

H.check('symbol has 23 pins', pins.length === 23, 'got ' + pins.length);

const padByNum = {};
pads.forEach(function (p) { padByNum[p.n] = p; });
const mismatched = pins.filter(function (p) {
  return !padByNum[p.n] || padByNum[p.n].name !== p.name;
});
H.check('all 23 symbol pins match the footprint pad of the same number',
  mismatched.length === 0,
  mismatched.map(function (p) {
    return p.n + ': symbol=' + p.name + ' footprint=' + (padByNum[p.n] || {}).name;
  }).join(', '));

const gpio = pins.filter(function (p) { return /^GP\d+$/.test(p.name); });
H.check('20 GPIO pins plus 5V / GND / 3V3', gpio.length === 20 &&
  ['5V', 'GND', '3V3'].every(function (n) {
    return pins.some(function (p) { return p.name === n; });
  }), gpio.length + ' GPIO');

const byName = {};
pins.forEach(function (p) { byName[p.name] = p; });
H.check('power pins have power electrical types',
  byName['5V'].etype === 'power_in' && byName['GND'].etype === 'power_in' &&
  byName['3V3'].etype === 'power_out');
H.check('GPIO pins are bidirectional',
  gpio.every(function (p) { return p.etype === 'bidirectional'; }));

const fpProp = lists(sym, 'property').find(function (p) {
  return p.children[1] && p.children[1].value === 'Footprint';
});
H.check('symbol defaults to Custom:RP2040-Zero',
  fpProp && fpProp.children[2].value === 'Custom:RP2040-Zero');

// The repo-local library must be the one the deploy picks up.
H.check('footprint lives in a .pretty directory named Custom',
  path.basename(path.dirname(FP)) === 'Custom.pretty');

H.finish();
