// harness.js — assertions, a static file server and browser helpers shared by
// the tests. Each test file runs standalone (`node tests/e2e/smoke.test.js`)
// and under tests/run.sh, which just aggregates exit codes.
'use strict';

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const REPO = path.resolve(__dirname, '..', '..');

// --- assertions -----------------------------------------------------------

let passed = 0;
const failures = [];

function check(name, ok, detail) {
  if (ok) { passed++; console.log('PASS  ' + name); return true; }
  failures.push(name + (detail ? ' — ' + detail : ''));
  console.log('FAIL  ' + name + (detail ? ' — ' + detail : ''));
  return false;
}

function finish() {
  console.log('----  ' + passed + ' passed, ' + failures.length + ' failed');
  failures.forEach(function (f) { console.log('      FAILED: ' + f); });
  process.exit(failures.length ? 1 : 0);
}

// Wrap a test body so an exception is a failure rather than an unhandled
// rejection, and the summary always prints.
function run(fn) {
  fn().then(finish, function (err) {
    check('test body completed without throwing', false, err && err.stack ? err.stack : String(err));
    finish();
  });
}

// --- static server --------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

// serve(dir, opts) -> { url, requests, close() }
// opts.handle(req, url, res) may answer a request itself (return true) so a
// test can inject faults such as "404 unless the URL carries a cache buster".
function serve(dir, opts) {
  opts = opts || {};
  const requests = [];
  const server = http.createServer(function (req, res) {
    const u = new URL(req.url, 'http://localhost');
    requests.push(u.pathname + u.search);
    if (opts.handle && opts.handle(req, u, res)) return;
    let fp = path.join(dir, decodeURIComponent(u.pathname));
    if (fp.endsWith('/') || fp.endsWith(path.sep)) fp = path.join(fp, 'index.html');
    fs.readFile(fp, function (err, data) {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise(function (resolve) {
    server.listen(0, '127.0.0.1', function () {
      const port = server.address().port;
      resolve({
        url: 'http://127.0.0.1:' + port,
        requests: requests,
        close: function () { return new Promise(function (r) { server.close(r); }); },
      });
    });
  });
}

// --- staging site ---------------------------------------------------------

// Build a servable copy of the app in a temp dir.
//   library: 'none' | 'mock' | <path to a prebuilt library dir>
// 'mock' runs the real tools/build-*-index.js over tests/fixtures, so the
// build scripts are exercised too and the format never drifts.
function stagingDir(opts) {
  opts = opts || {};
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'kicad-test-'));
  ['index.html', 'manifest.webmanifest', 'sw.js'].forEach(function (f) {
    fs.copyFileSync(path.join(REPO, f), path.join(out, f));
  });
  ['css', 'js', 'samples', 'icons'].forEach(function (d) {
    fs.cpSync(path.join(REPO, d), path.join(out, d), { recursive: true });
  });

  const library = opts.library || 'none';
  if (library === 'mock') {
    const { execFileSync } = require('child_process');
    const libOut = path.join(out, 'library');
    // Footprints: fixtures + this repo's own Custom.pretty, as the deploy does.
    const fpSrc = fs.mkdtempSync(path.join(os.tmpdir(), 'kicad-fp-'));
    fs.cpSync(path.join(REPO, 'tests', 'fixtures', 'footprints'), fpSrc, { recursive: true });
    fs.cpSync(path.join(REPO, 'footprints'), fpSrc, { recursive: true });
    execFileSync(process.execPath,
      [path.join(REPO, 'tools', 'build-lib-index.js'),
        path.join(REPO, 'tests', 'fixtures', 'symbols'), libOut], { stdio: 'pipe' });
    execFileSync(process.execPath,
      [path.join(REPO, 'tools', 'build-fp-index.js'), fpSrc, libOut], { stdio: 'pipe' });
  } else if (library !== 'none') {
    fs.cpSync(library, path.join(out, 'library'), { recursive: true });
  }
  return out;
}

// --- browser --------------------------------------------------------------

async function launch(opts) {
  opts = opts || {};
  const { chromium } = require('./pw').load();
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: opts.viewport || { width: 1280, height: 900 },
  });
  const errors = [];
  const dialogs = [];
  page.on('pageerror', function (e) { errors.push('PAGEERROR: ' + e.message); });
  page.on('dialog', function (d) { dialogs.push(d.message()); d.accept(); });
  return { browser: browser, page: page, errors: errors, dialogs: dialogs };
}

// Helpers bound to a loaded page: world<->screen clicks and canvas ink.
async function canvasHelpers(page, selector) {
  const box = await page.$eval(selector, function (el) {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  return {
    box: box,
    // click at a fraction of the canvas, always on screen
    clickFrac: async function (fx, fy) {
      await page.mouse.click(box.x + box.w * fx, box.y + box.h * fy);
      await page.waitForTimeout(180);
    },
    // click a schematic world coordinate (mm)
    clickWorld: async function (wx, wy) {
      const pt = await page.evaluate(function (a) {
        const v = window.__kicad.view;
        return { x: a[2] + (a[0] - v.panX) * v.scale, y: a[3] + (a[1] - v.panY) * v.scale };
      }, [wx, wy, box.x, box.y]);
      await page.mouse.click(pt.x, pt.y);
      await page.waitForTimeout(180);
    },
    // count pixels that are clearly not the light background
    ink: function () {
      return page.$eval(selector, function (c) {
        const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i] < 200 || d[i + 1] < 200 || d[i + 2] < 200) n++;
        }
        return n;
      });
    },
  };
}

// Edit a labelled field in the properties panel and commit it.
async function setField(page, label, value) {
  const handle = await page.evaluateHandle(function (lbl) {
    const rows = Array.from(document.querySelectorAll('#propContent .field'));
    const row = rows.find(function (r) { return r.querySelector('label').textContent === lbl; });
    return row ? row.querySelector('input') : null;
  }, label);
  const el = handle.asElement();
  if (!el) throw new Error('no properties field labelled "' + label + '"');
  await el.fill(value);
  await el.press('Enter');
  await page.waitForTimeout(250);
}

function sexpr() {
  globalThis.window = globalThis;
  require(path.join(REPO, 'js', 'sexpr.js'));
  return globalThis.SExpr;
}

module.exports = {
  REPO: REPO,
  check: check,
  finish: finish,
  run: run,
  serve: serve,
  stagingDir: stagingDir,
  launch: launch,
  canvasHelpers: canvasHelpers,
  setField: setField,
  sexpr: sexpr,
};
