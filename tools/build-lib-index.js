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

// The upstream layout has changed across releases:
//   - classic: one <Lib>.kicad_sym multi-symbol file (root or nested)
//   - KiCad 10+: a <Lib>.kicad_symdir/ directory with one single-symbol
//     .kicad_sym file per symbol
// Collect both forms as {lib, files: [paths...]} sources.
function collectLibs(dir) {
  const libs = []; // {lib, files}
  (function walk(d) {
    fs.readdirSync(d, { withFileTypes: true }).forEach(function (ent) {
      if (ent.name === '.git') return;
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) {
        if (ent.name.endsWith('.kicad_symdir')) {
          const inner = fs.readdirSync(p)
            .filter(function (f) { return f.endsWith('.kicad_sym'); })
            .sort()
            .map(function (f) { return path.join(p, f); });
          if (inner.length) libs.push({ lib: ent.name.replace(/\.kicad_symdir$/, ''), files: inner });
        } else {
          walk(p);
        }
      } else if (ent.name.endsWith('.kicad_sym')) {
        libs.push({ lib: ent.name.replace(/\.kicad_sym$/, ''), files: [p] });
      }
    });
  })(dir);
  return libs.sort(function (a, b) { return a.lib.localeCompare(b.lib); });
}

const libSources = collectLibs(srcDir);
if (libSources.length === 0) {
  console.error('No .kicad_sym files found under ' + srcDir + ' — top-level contents:');
  fs.readdirSync(srcDir).slice(0, 40).forEach(function (e) { console.error('  ' + e); });
  process.exit(1);
}

const symbols = [];
const seenLibs = {};
let libCount = 0;
let failed = 0;

libSources.forEach(function (src) {
  if (seenLibs[src.lib]) {
    console.error('DUPLICATE lib name skipped: ' + src.lib);
    return;
  }
  seenLibs[src.lib] = true;

  // Parse every source file of the library and gather its (symbol ...) nodes
  // into one merged document, so the app always sees one file per library.
  const symbolNodes = [];
  let ok = true;
  src.files.forEach(function (fp) {
    let root;
    try {
      root = S.parse(fs.readFileSync(fp, 'utf8'));
    } catch (err) {
      console.error('PARSE FAIL ' + fp + ': ' + err.message);
      ok = false;
      return;
    }
    childLists(root, 'symbol').forEach(function (sn) { symbolNodes.push(sn); });
  });
  if (!ok && symbolNodes.length === 0) { failed++; return; }

  const merged = {
    kind: 'list',
    children: [
      { kind: 'atom', value: 'kicad_symbol_lib', quoted: false },
      S.parse('(version 20251024)'),
      S.parse('(generator "kicad-sch-web-bundler")'),
    ].concat(symbolNodes),
  };
  fs.writeFileSync(path.join(outDir, src.lib + '.kicad_sym'), S.serializeDocument(merged));
  libCount++;

  // Index every symbol; extends-derived ones fall back to the parent's
  // Reference/Description when they don't override them.
  const byName = {};
  symbolNodes.forEach(function (sn) {
    if (sn.children[1]) byName[sn.children[1].value] = sn;
  });
  symbolNodes.forEach(function (sn) {
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
    symbols.push([src.lib, name, ref || 'U', (desc || '').slice(0, 60)]);
  });
});

const index = {
  version: version,
  generated: new Date().toISOString(),
  libs: libCount,
  count: symbols.length,
  symbols: symbols,
};
const indexPath = path.join(outDir, 'index.json');
fs.writeFileSync(indexPath, JSON.stringify(index));

const size = fs.statSync(indexPath).size;
console.log('libraries: ' + index.libs + (failed ? ' (' + failed + ' failed to parse)' : ''));
console.log('symbols:   ' + index.count);
console.log('index:     ' + (size / 1024).toFixed(0) + ' KB (' + indexPath + ')');
