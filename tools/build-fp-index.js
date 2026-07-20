#!/usr/bin/env node
// build-fp-index.js — deploy-time packaging of the KiCad footprint libraries.
//
// Usage: node tools/build-fp-index.js <kicad-footprints-dir> <output-dir>
//
// Writes into <output-dir>:
//   fp-index.json        search index [[lib, name, descr], ...]
//   fp/<Lib>.kicad_fps   every <Lib>.pretty merged into one parseable file
//                        (kicad_footprint_lib (footprint ...) ...) — our own
//                        container, read only by this app's footprint editor.
// Descriptions come from a cheap regex, not a full parse, and the merge just
// concatenates the original file texts, so footprints round-trip unchanged.

'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const srcDir = process.argv[2];
const outDir = process.argv[3];
if (!srcDir || !outDir) {
  console.error('usage: build-fp-index.js <kicad-footprints-dir> <output-dir>');
  process.exit(1);
}
const outFile = path.join(outDir, 'fp-index.json');
const fpDir = path.join(outDir, 'fp');
fs.mkdirSync(fpDir, { recursive: true });

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
    const merged = ['(kicad_footprint_lib'];
    files.forEach(function (f) {
      const name = f.replace(/\.kicad_mod$/, '');
      let descr = '';
      try {
        const text = fs.readFileSync(path.join(srcDir, dir.name, f), 'utf8')
          .replace(/^﻿/, '');
        merged.push(text.trim());
        const m = DESCR_RE.exec(text);
        if (m) descr = m[1].replace(/\\(.)/g, '$1').slice(0, 80);
      } catch (_) { /* unreadable file: index the name anyway */ }
      footprints.push([lib, name, descr]);
    });
    merged.push(')\n');
    fs.writeFileSync(path.join(fpDir, lib + '.kicad_fps'), merged.join('\n'));
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
fs.writeFileSync(outFile, JSON.stringify(index));

const size = fs.statSync(outFile).size;
let fpBytes = 0;
fs.readdirSync(fpDir).forEach(function (f) {
  fpBytes += fs.statSync(path.join(fpDir, f)).size;
});
console.log('fp libraries: ' + index.libs);
console.log('footprints:   ' + index.count);
console.log('fp index:     ' + (size / 1024).toFixed(0) + ' KB (' + outFile + ')');
console.log('fp geometry:  ' + (fpBytes / 1048576).toFixed(0) + ' MB (' + fpDir + ')');
