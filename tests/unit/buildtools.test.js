// The deploy-time index builders. They run only in CI, so a regression here is
// invisible until the published site loses its library.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const H = require('../lib/harness');

const FIXT = path.join(H.REPO, 'tests', 'fixtures');
const SYMS = path.join(FIXT, 'symbols');
const FPS = path.join(FIXT, 'footprints');
const S = H.sexpr();

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'kicad-build-')); }
function build(script, src, out) {
  return execFileSync(process.execPath,
    [path.join(H.REPO, 'tools', script), src, out], { encoding: 'utf8' });
}

// --- symbols --------------------------------------------------------------

const symOut = tmp();
const symLog = build('build-lib-index.js', SYMS, symOut);
const ix = JSON.parse(fs.readFileSync(path.join(symOut, 'index.json'), 'utf8'));

H.check('symbol index covers both upstream layouts (flat file and .kicad_symdir)',
  ix.libs === 2 && ix.count === 3, JSON.stringify({ libs: ix.libs, count: ix.count }));
H.check('each library is merged into one <Lib>.kicad_sym',
  fs.existsSync(path.join(symOut, 'Amplifier_Mock.kicad_sym')) &&
  fs.existsSync(path.join(symOut, 'Timer_Mock.kicad_sym')));
H.check('merged library files parse as (kicad_symbol_lib ...)',
  S.parse(fs.readFileSync(path.join(symOut, 'Amplifier_Mock.kicad_sym'), 'utf8'))
    .children[0].value === 'kicad_symbol_lib');

const entry = {};
ix.symbols.forEach(function (s) { entry[s[0] + ':' + s[1]] = s; });
H.check('index rows are [lib, name, refPrefix, description]',
  entry['Timer_Mock:NE555'][2] === 'U' &&
  entry['Timer_Mock:NE555'][3] === 'Single precision timer');
H.check('an extends-derived symbol inherits its parent reference prefix',
  entry['Amplifier_Mock:LM358'][2] === 'U');
H.check('an extends-derived symbol keeps its own description',
  entry['Amplifier_Mock:LM358'][3] === 'Dual op-amp, industry standard');
H.check('the builder reports its counts for the CI log',
  /libraries:\s*2/.test(symLog) && /symbols:\s*3/.test(symLog), symLog.trim());

// --- footprints -----------------------------------------------------------

const fpOut = tmp();
const fpSrc = tmp();
fs.cpSync(FPS, fpSrc, { recursive: true });
fs.cpSync(path.join(H.REPO, 'footprints'), fpSrc, { recursive: true });
const fpLog = build('build-fp-index.js', fpSrc, fpOut);
const fx = JSON.parse(fs.readFileSync(path.join(fpOut, 'fp-index.json'), 'utf8'));

const names = fx.footprints.map(function (f) { return f[0] + ':' + f[1]; });
H.check('footprint index lists every .pretty/.kicad_mod found',
  fx.count === 4 && names.indexOf('Custom:RP2040-Zero') >= 0 &&
  names.indexOf('Resistor_SMD_Mock:R_0603_1608Metric') >= 0, names.join(', '));
H.check('this repo’s own footprints are indexed alongside the fixtures',
  fx.libs === 3, 'libs=' + fx.libs);
H.check('descriptions are carried into the index',
  fx.footprints.every(function (f) { return typeof f[2] === 'string'; }) &&
  fx.footprints.some(function (f) { return f[2].length > 10; }));

H.check('geometry ships as one <Lib>.kicad_fps per library',
  fs.existsSync(path.join(fpOut, 'fp', 'Custom.kicad_fps')) &&
  fs.existsSync(path.join(fpOut, 'fp', 'Test_Lib.kicad_fps')));

const merged = S.parse(fs.readFileSync(path.join(fpOut, 'fp', 'Test_Lib.kicad_fps'), 'utf8'));
H.check('merged footprint files parse and keep every footprint',
  merged.children[0].value === 'kicad_footprint_lib' &&
  merged.children.filter(function (c) {
    return c.kind === 'list' && c.children[0].value === 'footprint';
  }).length === 2);
H.check('the builder reports its counts for the CI log',
  /fp libraries:\s*3/.test(fpLog) && /footprints:\s*4/.test(fpLog), fpLog.trim());

// --- empty input must fail loudly, not publish an empty library -----------

['build-lib-index.js', 'build-fp-index.js'].forEach(function (script) {
  const emptySrc = tmp();
  let code = 0;
  try {
    execFileSync(process.execPath, [path.join(H.REPO, 'tools', script), emptySrc, tmp()],
      { stdio: 'pipe' });
  } catch (err) { code = err.status; }
  H.check(script + ' exits non-zero when it finds no libraries', code !== 0, 'exit=' + code);
});

H.finish();
