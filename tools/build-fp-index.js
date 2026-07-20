#!/usr/bin/env node
// build-fp-index.js — deploy-time index of the KiCad footprint libraries.
//
// Usage: node tools/build-fp-index.js <kicad-footprints-dir> <output-file>
//
// Writes a search index of every <Lib>.pretty/<Name>.kicad_mod:
//   { version, generated, libs, count, footprints: [[lib, name, descr], ...] }
// Only the index ships — the app needs footprint names for assignment, not
// the geometry. Descriptions come from a cheap regex, not a full parse.

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const srcDir = process.argv[2];
const outFile = process.argv[3];
if (!srcDir || !outFile) {
  console.error('usage: build-fp-index.js <kicad-footprints-dir> <output-file>');
  process.exit(1);
}

let version = 'unknown';
try {
  version = execSync('git rev-parse --short HEAD',
    { cwd: srcDir, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
} catch (_) { /* not a git checkout (e.g. mock library in tests) */ }

const DESCR_RE = /\(descr\s+"((?:[^"\\]|\\.)*)"/;

const footprints = [];
let libCount = 0;

fs.readdirSync(srcDir, { withFileTypes: true })
  .filter(function (e) { return e.isDirectory() && e.name.endsWith('.pretty'); })
  .sort(function (a, b) { return a.name.localeCompare(b.name); })
  .forEach(function (dir) {
    const lib = dir.name.replace(/\.pretty$/, '');
    const files = fs.readdirSync(path.join(srcDir, dir.name))
      .filter(function (f) { return f.endsWith('.kicad_mod'); })
      .sort();
    if (!files.length) return;
    libCount++;
    files.forEach(function (f) {
      const name = f.replace(/\.kicad_mod$/, '');
      let descr = '';
      try {
        const m = DESCR_RE.exec(fs.readFileSync(path.join(srcDir, dir.name, f), 'utf8'));
        if (m) descr = m[1].replace(/\\(.)/g, '$1').slice(0, 80);
      } catch (_) { /* unreadable file: index the name anyway */ }
      footprints.push([lib, name, descr]);
    });
  });

if (footprints.length === 0) {
  console.error('No .pretty/.kicad_mod libraries found under ' + srcDir + ' — top-level contents:');
  fs.readdirSync(srcDir).slice(0, 40).forEach(function (e) { console.error('  ' + e); });
  process.exit(1);
}

const index = {
  version: version,
  generated: new Date().toISOString(),
  libs: libCount,
  count: footprints.length,
  footprints: footprints,
};
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(index));

const size = fs.statSync(outFile).size;
console.log('fp libraries: ' + index.libs);
console.log('footprints:   ' + index.count);
console.log('fp index:     ' + (size / 1024).toFixed(0) + ' KB (' + outFile + ')');
