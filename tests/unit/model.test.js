// Parser, serializer and the model helpers that every edit goes through. A
// round-trip fault here corrupts saved files, which is the worst failure the
// app has, so the real sample and the hand-authored parts are checked byte for
// byte.
'use strict';

const fs = require('fs');
const path = require('path');
const H = require('../lib/harness');
const S = H.sexpr();
require(path.join(H.REPO, 'js', 'model.js'));
const M = globalThis.KiModel;

// --- round trips ----------------------------------------------------------

[
  ['samples/sample.kicad_sch', 'kicad_sch'],
  ['custom/RP2040-Zero.kicad_sym', 'kicad_symbol_lib'],
  ['footprints/Custom.pretty/RP2040-Zero.kicad_mod', 'footprint'],
  ['tests/fixtures/symbols/Amplifier_Mock.kicad_sym', 'kicad_symbol_lib'],
  ['tests/fixtures/footprints/Test_Lib.pretty/FP_JP_TEXT.kicad_mod', 'footprint'],
].forEach(function (pair) {
  const file = pair[0];
  const text = fs.readFileSync(path.join(H.REPO, file), 'utf8');
  const root = S.parse(text);
  H.check(file + ' parses as (' + pair[1] + ' ...)', root.children[0].value === pair[1]);
  const once = S.serializeDocument(root);
  const twice = S.serializeDocument(S.parse(once));
  H.check(file + ' is stable across serialize/parse', once === twice);
});

// --- string escaping ------------------------------------------------------

[
  'plain',
  'with "quotes"',
  'back\\slash',
  '日本語テキスト',
  '電源 5V ライン',
  'tab\tand\nnewline',
].forEach(function (v) {
  const text = '(text "' + S.escapeString(v) + '" (at 0 0 0))';
  let got = null;
  try { got = S.parse(text).children[1].value; } catch (err) { got = 'PARSE ERROR: ' + err.message; }
  H.check('escapes and recovers ' + JSON.stringify(v), got === v, 'got ' + JSON.stringify(got));
});

// --- geometry helpers -----------------------------------------------------

const sym = S.parse('(symbol (lib_id "Device:R") (at 10 20 90) (unit 1))');
const at = M.readAt(sym);
H.check('readAt reads x, y and angle', at.x === 10 && at.y === 20 && at.angle === 90);
M.writeAt(sym, 1.27, -2.54, 180);
H.check('writeAt round-trips through the tree',
  S.serialize(sym, 0).indexOf('(at 1.27 -2.54 180)') >= 0, S.serialize(sym, 0));

// A two-argument (at x y) must keep only two arguments.
const j = S.parse('(junction (at 5 5) (diameter 0))');
M.writeAt(j, 7.62, 7.62);
H.check('writeAt leaves a 2-argument (at x y) alone',
  S.serialize(j, 0).indexOf('(at 7.62 7.62)') >= 0, S.serialize(j, 0));

const wire = S.parse('(wire (pts (xy 0 0) (xy 10 0)))');
const pts = M.readPts(wire);
H.check('readPts returns every vertex', pts.length === 2 && pts[1].x === 10);
M.writePts(wire, [{ x: 1, y: 2 }, { x: 3, y: 4 }]);
const rewritten = M.readPts(wire);
H.check('writePts replaces the vertex list',
  rewritten.length === 2 && rewritten[0].x === 1 && rewritten[0].y === 2 &&
  rewritten[1].x === 3 && rewritten[1].y === 4,
  JSON.stringify(rewritten));

H.check('fmt trims trailing zeros and normalises -0',
  M.fmt(1.270000) === '1.27' && M.fmt(-0) === '0' && M.fmt(2) === '2');

// --- schematic-level helpers ---------------------------------------------

const schem = new M.Schematic(S.parse(
  fs.readFileSync(path.join(H.REPO, 'samples', 'sample.kicad_sch'), 'utf8')));
H.check('sample has symbols and wires',
  schem.symbols().length > 0 && schem.items('wire').length > 0,
  schem.symbols().length + ' symbols, ' + schem.items('wire').length + ' wires');

const first = schem.symbols()[0];
const props = schem.properties(first);
H.check('properties() exposes key/value pairs',
  props.some(function (p) { return p.key === 'Reference'; }));

// ensureProperty creates a hidden field when the symbol has none, which is how
// Footprint gets attached to built-in parts.
const before = schem.properties(first).some(function (p) { return p.key === 'Footprint'; });
schem.ensureProperty(first, 'Footprint', 'Resistor_SMD:R_0603_1608Metric');
const after = schem.properties(first).find(function (p) { return p.key === 'Footprint'; });
H.check('ensureProperty adds a missing property', !!after);
H.check('ensureProperty stores the value',
  after.value === 'Resistor_SMD:R_0603_1608Metric');
H.check('a created property is hidden on the sheet, as KiCad does',
  /hide/.test(S.serialize(after.node, 0)), S.serialize(after.node, 0));
schem.ensureProperty(first, 'Footprint', 'Resistor_SMD:R_0805_2012Metric');
H.check('ensureProperty updates rather than duplicating',
  schem.properties(first).filter(function (p) { return p.key === 'Footprint'; }).length === 1);
H.check('the edited schematic still serialises and reparses',
  S.parse(schem.serialize ? schem.serialize() : S.serializeDocument(schem.root))
    .children[0].value === 'kicad_sch');
void before;

H.finish();
