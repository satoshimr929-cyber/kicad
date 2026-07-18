#!/usr/bin/env node
// build-lib-index.js — deploy-time packaging of the KiCad symbol libraries.
//
// Usage: node tools/build-lib-index.js <kicad-symbols-dir> <output-dir>
//
// Copies every *.kicad_sym into <output-dir>/ and writes <output-dir>/index.json:
//   { version, libs, count, symbols: [[lib, name, refPrefix, description], ...] }
// The app fetches index.json once for search, then lazy-loads individual
// library files on placement. Runs in GitHub Actions where network access to
// github.com/KiCad/kicad-symbols is available (the dev sandbox has none).

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

globalThis.window = globalThis;
require(path.join(__dirname, '..', 'js', 'sexpr.js'));
const S = globalThis.SExpr;

function head(node) {
  return node && node.kind === 'list' && node.children[0] && node.children[0].kind === 'atom'
    ? node.children[0].value : null;
}
function childLists(node, name) {
  return node.children.filter(function (c) { return c.kind === 'list' && head(c) === name; });
}
function propValue(symNode, key) {
  const p = childLists(symNode, 'property').find(function (pr) {
    return pr.children[1] && pr.children[1].value === key;
  });
  return p && p.children[2] ? p.children[2].value : '';
}

const srcDir = process.argv[2];
const outDir = process.argv[3];
if (!srcDir || !outDir) {
  console.error('usage: build-lib-index.js <kicad-symbols-dir> <output-dir>');
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });

let version = 'unknown';
try {
  version = execSync('git rev-parse --short HEAD',
    { cwd: srcDir, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
} catch (_) { /* not a git checkout (e.g. mock library in tests) */ }

const files = fs.readdirSync(srcDir).filter(function (f) { return f.endsWith('.kicad_sym'); }).sort();
const symbols = [];
let failed = 0;

files.forEach(function (file) {
  const lib = file.replace(/\.kicad_sym$/, '');
  const text = fs.readFileSync(path.join(srcDir, file), 'utf8');
  let root;
  try {
    root = S.parse(text);
  } catch (err) {
    console.error('PARSE FAIL ' + file + ': ' + err.message);
    failed++;
    return;
  }
  fs.copyFileSync(path.join(srcDir, file), path.join(outDir, file));

  // Index derived (extends) symbols too; their own properties carry ref/desc,
  // falling back to the parent's when the derived symbol doesn't override.
  const all = childLists(root, 'symbol');
  const byName = {};
  all.forEach(function (sn) {
    if (sn.children[1]) byName[sn.children[1].value] = sn;
  });
  all.forEach(function (sn) {
    const name = sn.children[1] ? sn.children[1].value : '';
    if (!name) return;
    let refNode = sn, guard = 0;
    let ref = propValue(refNode, 'Reference');
    let desc = propValue(refNode, 'Description');
    while ((!ref || !desc) && guard++ < 5) {
      const ext = childLists(refNode, 'extends')[0];
      const parent = ext && ext.children[1] ? byName[ext.children[1].value] : null;
      if (!parent) break;
      if (!ref) ref = propValue(parent, 'Reference');
      if (!desc) desc = propValue(parent, 'Description');
      refNode = parent;
    }
    symbols.push([lib, name, ref || 'U', (desc || '').slice(0, 60)]);
  });
});

const index = {
  version: version,
  generated: new Date().toISOString(),
  libs: files.length - failed,
  count: symbols.length,
  symbols: symbols,
};
const indexPath = path.join(outDir, 'index.json');
fs.writeFileSync(indexPath, JSON.stringify(index));

const size = fs.statSync(indexPath).size;
console.log('libraries: ' + index.libs + (failed ? ' (' + failed + ' failed to parse)' : ''));
console.log('symbols:   ' + index.count);
console.log('index:     ' + (size / 1024).toFixed(0) + ' KB (' + indexPath + ')');
