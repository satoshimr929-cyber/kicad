// Every built-in part definition must be valid and self-consistent, because a
// broken one only shows up as a blank entry in the part chooser at runtime.
'use strict';

const path = require('path');
const H = require('../lib/harness');
const S = H.sexpr();
require(path.join(H.REPO, 'js', 'parts.js'));
const { PARTS, ORDER } = globalThis.KiParts;

function head(n) { return n && n.kind === 'list' && n.children[0] ? n.children[0].value : null; }
function lists(n, name) {
  return n.children.filter(function (c) { return c.kind === 'list' && head(c) === name; });
}
function pinsOf(root) {
  const out = [];
  lists(root, 'symbol').forEach(function (u) {
    u.children.forEach(function (c) { if (c.kind === 'list' && head(c) === 'pin') out.push(c); });
  });
  return out;
}
function propOf(root, key) {
  const p = lists(root, 'property').find(function (pr) {
    return pr.children[1] && pr.children[1].value === key;
  });
  return p && p.children[2] ? p.children[2].value : null;
}

H.check('ORDER and PARTS cover the same ids',
  ORDER.length === Object.keys(PARTS).length &&
  ORDER.every(function (id) { return PARTS[id]; }),
  'ORDER=' + ORDER.length + ' PARTS=' + Object.keys(PARTS).length);

H.check('at least 30 built-in parts', ORDER.length >= 30, 'got ' + ORDER.length);

let bad = [];
ORDER.forEach(function (id) {
  const meta = PARTS[id];
  let root;
  try { root = S.parse(meta.def); } catch (err) { bad.push(id + ': ' + err.message); return; }

  if (head(root) !== 'symbol') bad.push(id + ': def is not a (symbol ...)');
  if (root.children[1].value !== id) {
    bad.push(id + ': def name is "' + root.children[1].value + '", expected the lib id');
  }
  if (!meta.ref) bad.push(id + ': no reference prefix');
  if (!meta.value) bad.push(id + ': no value');
  if (!meta.label) bad.push(id + ': no chooser label');
  if (propOf(root, 'Reference') === null) bad.push(id + ': def has no Reference property');
  if (propOf(root, 'Value') === null) bad.push(id + ': def has no Value property');

  const pins = pinsOf(root);
  if (pins.length === 0) bad.push(id + ': no pins');
  const numbers = pins.map(function (p) {
    const n = p.children.find(function (c) { return c.kind === 'list' && head(c) === 'number'; });
    return n && n.children[1] ? n.children[1].value : null;
  });
  if (numbers.some(function (n) { return n === null; })) bad.push(id + ': a pin has no number');
  if (new Set(numbers).size !== numbers.length) {
    bad.push(id + ': duplicate pin numbers (' + numbers.join(',') + ')');
  }
  // Round-trip: what we inject into lib_symbols must survive a save/load cycle.
  try {
    if (S.serialize(S.parse(S.serialize(root, 0)), 0) !== S.serialize(root, 0)) {
      bad.push(id + ': does not round-trip through the serializer');
    }
  } catch (err) { bad.push(id + ': re-parse failed: ' + err.message); }
});
H.check('every built-in part parses and is self-consistent', bad.length === 0, bad.join(' | '));

// Reference prefixes drive auto-numbering, so they must be plain letters.
const badRefs = ORDER.filter(function (id) { return !/^[A-Z]{1,3}$/.test(PARTS[id].ref); });
H.check('reference prefixes are 1-3 uppercase letters', badRefs.length === 0,
  badRefs.map(function (id) { return id + '=' + PARTS[id].ref; }).join(', '));

H.finish();
