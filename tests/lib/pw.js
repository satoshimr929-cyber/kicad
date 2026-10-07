// pw.js — locate Playwright, which may be installed globally rather than in
// this repo (the repo has no package.json on purpose: the app ships as plain
// static files). Set PLAYWRIGHT_PATH to override.
'use strict';

const { execSync } = require('child_process');
const path = require('path');

const CANDIDATES = [
  process.env.PLAYWRIGHT_PATH,
  'playwright',
  '/opt/node22/lib/node_modules/playwright',
  '/usr/lib/node_modules/playwright',
  '/usr/local/lib/node_modules/playwright',
];

function globalRoot() {
  try {
    return execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch (_) { return null; }
}

function load() {
  const tried = [];
  const root = globalRoot();
  const list = CANDIDATES.concat(root ? [path.join(root, 'playwright')] : []);
  for (const c of list) {
    if (!c) continue;
    try { return require(c); } catch (err) { tried.push(c); }
  }
  throw new Error(
    'Playwright not found. Install it (npm i -g playwright) or set PLAYWRIGHT_PATH.\n' +
    'Tried: ' + tried.join(', '));
}

module.exports = { load: load };
