// The canvas font. Two things matter: existing ASCII schematics must keep
// rendering byte-for-byte the same (regression golden), and characters the
// Hershey table lacks — Japanese above all — must come back as runs for the
// renderer to paint with the browser font rather than being dropped.
'use strict';

const fs = require('fs');
const path = require('path');
const H = require('../lib/harness');

globalThis.window = globalThis;
require(path.join(H.REPO, 'js', 'hershey.js'));
require(path.join(H.REPO, 'js', 'strokefont.js'));
const F = globalThis.StrokeFont;
const HERSHEY = globalThis.Hershey;

const round = function (v) { return Math.round(v * 1e6) / 1e6; };

// --- the table itself -----------------------------------------------------

H.check('Hershey table covers printable ASCII',
  HERSHEY.first === 33 && HERSHEY.glyphs.length >= 94,
  'first=' + HERSHEY.first + ' glyphs=' + HERSHEY.glyphs.length);

// --- ASCII must not move --------------------------------------------------

const golden = JSON.parse(
  fs.readFileSync(path.join(H.REPO, 'tests', 'fixtures', 'strokefont-ascii-golden.json'), 'utf8'));

const drifted = [];
golden.out.forEach(function (g) {
  const laid = F.layout(g.text, g.place);
  const polys = laid.polys.map(function (p) {
    return p.map(function (q) { return [round(q.x), round(q.y)]; });
  });
  if (JSON.stringify(polys) !== JSON.stringify(g.polys)) {
    drifted.push(JSON.stringify(g.text) + ' @ ' + JSON.stringify(g.place) + ' (geometry)');
  }
  if (round(F.widthMm(g.text, g.place.size)) !== g.width) {
    drifted.push(JSON.stringify(g.text) + ' (width)');
  }
  if (laid.runs.length !== 0) {
    drifted.push(JSON.stringify(g.text) + ' produced browser-font runs, expected none');
  }
});
H.check('ASCII geometry and advance widths match the golden (' + golden.out.length + ' cases)',
  drifted.length === 0, drifted.slice(0, 6).join(' | '));

H.check('polylines() still returns just the stroke geometry',
  JSON.stringify(F.polylines('R1', { x: 0, y: 0, size: 1.27 })) ===
  JSON.stringify(F.layout('R1', { x: 0, y: 0, size: 1.27 }).polys));

// --- non-ASCII falls back rather than vanishing ---------------------------

const jp = F.layout('日本語', { x: 10, y: 20, size: 1.27, hjustify: 'left' });
H.check('pure Japanese yields one run and no strokes',
  jp.runs.length === 1 && jp.runs[0].text === '日本語' && jp.polys.length === 0);
H.check('the run sits on the text baseline',
  jp.runs[0].x === 10 && Math.abs(jp.runs[0].y - 20.635) < 1e-6,
  JSON.stringify(jp.runs[0]));

const mixed = F.layout('電源 5V', { x: 0, y: 0, size: 1.27, hjustify: 'left' });
H.check('mixed text strokes the latin and runs the Japanese',
  mixed.polys.length > 0 && mixed.runs.length === 1 && mixed.runs[0].text === '電源');

const twoRuns = F.layout('あ A い', { x: 0, y: 0, size: 1.27 });
H.check('a space breaks a run so latin can be interleaved',
  twoRuns.runs.length === 2 && twoRuns.runs.map(function (r) { return r.text; }).join('|') === 'あ|い');

H.check('Japanese has a non-zero advance so centring accounts for it',
  F.widthMm('日本語', 1.27) > F.widthMm('', 1.27),
  'width=' + F.widthMm('日本語', 1.27));
H.check('full-width characters advance one em each',
  Math.abs(F.widthMm('日本語', 1.27) - 1.27 * 3) < 1e-9,
  'width=' + F.widthMm('日本語', 1.27));
H.check('half-width non-ASCII advances less than a full-width one',
  F.widthMm('é', 1.27) < F.widthMm('日', 1.27));

// Rotation must apply to runs the same way it does to strokes.
const rot = F.layout('日', { x: 0, y: 0, size: 1.27, angle: 90, hjustify: 'left', vjustify: 'bottom' });
H.check('a rotated run is placed by the same transform as strokes',
  Math.abs(rot.runs[0].x) < 1e-9 && Math.abs(rot.runs[0].y) < 1e-9 && rot.runs[0].angle === 90,
  JSON.stringify(rot.runs[0]));

const empty = F.layout('', { x: 0, y: 0, size: 1 });
const ctrl = F.layout('\u0001\u0002', { x: 0, y: 0, size: 1 });
H.check('empty and control-character input produce nothing to draw',
  empty.polys.length === 0 && empty.runs.length === 0 &&
  ctrl.polys.length === 0 && ctrl.runs.length === 0);

H.finish();
