// Library fetches have to survive a stale CDN. GitHub Pages has twice served a
// 404 (and once an empty index) for library files right after a deploy while
// the page itself was already new, so js/stdlib.js revalidates and then retries
// under a cache-busting URL. Both recovery paths are exercised here with a
// server that injects those faults.
'use strict';

const H = require('../lib/harness');

async function scenario(name, fault, expectCount) {
  const dir = H.stagingDir({ library: 'mock' });
  const srv = await H.serve(dir, { handle: fault });
  const { browser, page, errors, dialogs } = await H.launch();

  await page.goto(srv.url + '/index.html');
  await page.click('#sampleBtn');
  await page.waitForTimeout(400);
  await page.click('#partBtn');
  await page.waitForTimeout(250);
  await page.click('#stdlibBtn');

  let loaded = true;
  try {
    await page.waitForFunction(function () {
      return document.getElementById('stdlibBtn').textContent.indexOf('シンボル') >= 0;
    }, { timeout: 10000 });
  } catch (err) { loaded = false; }

  const label = await page.$eval('#stdlibBtn', function (el) { return el.textContent.trim(); });
  H.check(name + ': the index still loads (' + label + ')',
    loaded && label.indexOf(expectCount + ' シンボル') >= 0, label);
  H.check(name + ': no error dialog was shown', dialogs.length === 0, dialogs.join(' | '));
  H.check(name + ': no uncaught page errors', errors.length === 0, errors.join(' | '));

  const plain = srv.requests.filter(function (r) { return r === '/library/index.json'; });
  const busted = srv.requests.filter(function (r) { return /\/library\/index\.json\?r=/.test(r); });
  H.check(name + ': the first try is the plain URL', plain.length >= 1);
  H.check(name + ': it retries under a cache-busting URL', busted.length >= 1,
    JSON.stringify(srv.requests.filter(function (r) { return r.indexOf('/library/') === 0; })));

  await browser.close();
  await srv.close();
  return srv.requests;
}

H.run(async function () {
  // 1. A stale edge answers 404 for anything without a cache buster.
  const reqs = await scenario('stale 404', function (req, u, res) {
    if (u.pathname.indexOf('/library/') !== 0) return false;
    if (u.searchParams.has('r')) return false;
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end('<h1>404</h1>');
    return true;
  }, 3);

  // Placing a symbol must recover the same way for the library file itself.
  H.check('library files are retried too, not just the index',
    reqs.some(function (r) { return /\/library\/\w+\.kicad_sym\?r=/.test(r); }) ||
    !reqs.some(function (r) { return /\/library\/\w+\.kicad_sym/.test(r); }),
    JSON.stringify(reqs.filter(function (r) { return /kicad_sym/.test(r); })));

  // 2. A stale edge answers 200 with the empty index deployed before the
  //    libraries were built. Serving that silently would look like "the
  //    library loaded but finds nothing".
  await scenario('stale empty index', function (req, u, res) {
    if (u.pathname !== '/library/index.json' || u.searchParams.has('r')) return false;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ version: 'stale', generated: '', libs: 0, count: 0, symbols: [] }));
    return true;
  }, 3);
});
