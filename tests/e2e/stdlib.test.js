// The bundled standard library: index search, lazy per-library loading, and
// flattening of `extends`-derived symbols into standalone definitions.
'use strict';

const H = require('../lib/harness');

H.run(async function () {
  const dir = H.stagingDir({ library: 'mock' });
  const srv = await H.serve(dir);
  const { browser, page, errors, dialogs } = await H.launch();

  await page.goto(srv.url + '/index.html');
  await page.click('#sampleBtn');
  await page.waitForTimeout(500);
  const cv = await H.canvasHelpers(page, '#canvas');
  const text = function () { return page.evaluate(function () { return window.__kicad.text(); }); };

  // --- index ---------------------------------------------------------------
  await page.click('#partBtn');
  await page.waitForTimeout(250);
  await page.click('#stdlibBtn');
  await page.waitForFunction(function () {
    return document.getElementById('stdlibBtn').textContent.indexOf('シンボル') >= 0;
  }, { timeout: 10000 });
  H.check('the standard library index loads and reports its count',
    /3 シンボル/.test(await page.$eval('#stdlibBtn', function (el) { return el.textContent; })),
    await page.$eval('#stdlibBtn', function (el) { return el.textContent; }));

  // The index is fetched once, not per keystroke.
  const indexHits = srv.requests.filter(function (r) { return r.indexOf('/library/index.json') === 0; });
  H.check('index.json is fetched once', indexHits.length === 1, JSON.stringify(indexHits));

  // --- search --------------------------------------------------------------
  await page.fill('#partSearch', 'NE555');
  await page.waitForTimeout(300);
  let hits = await page.$$eval('#partList .part-item.std', function (els) {
    return els.map(function (e) { return e.title; });
  });
  H.check('search finds a standard-library symbol', hits.join() === 'Timer_Mock:NE555', hits.join());
  H.check('a divider separates built-in parts from library hits',
    (await page.$$('#partList .std-divider')).length === 1);

  await page.fill('#partSearch', 'industry standard');
  await page.waitForTimeout(300);
  hits = await page.$$eval('#partList .part-item.std', function (els) {
    return els.map(function (e) { return e.title; });
  });
  H.check('search also matches the description text',
    hits.join() === 'Amplifier_Mock:LM358', hits.join());

  // --- place a plain symbol ------------------------------------------------
  await page.fill('#partSearch', 'NE555');
  await page.waitForTimeout(300);
  await page.click('.part-item.std');
  await page.waitForTimeout(600);
  H.check('the preview shows the library symbol',
    (await page.$eval('#previewTitle', function (el) { return el.textContent; })) === 'Timer_Mock:NE555');
  H.check('the preview shows its description',
    /Single precision timer/.test(await page.$eval('#previewDesc', function (el) { return el.textContent; })));
  await page.click('#previewPlace');
  await page.waitForTimeout(250);
  await cv.clickFrac(0.72, 0.22);
  let t = await text();
  H.check('library symbol is placed', /\(lib_id "Timer_Mock:NE555"\)/.test(t));
  H.check('its definition is injected into lib_symbols', /\(symbol "Timer_Mock:NE555"/.test(t));
  H.check('it is numbered with the library reference prefix', /\(property "Reference" "U1"/.test(t));
  await page.click('[data-tool="select"]');

  // --- place an extends-derived symbol ------------------------------------
  await page.click('#partBtn');
  await page.waitForTimeout(250);
  await page.fill('#partSearch', 'LM358');
  await page.waitForTimeout(300);
  await page.click('.part-item.std');
  await page.waitForTimeout(600);
  await page.click('#previewPlace');
  await page.waitForTimeout(250);
  await cv.clickFrac(0.72, 0.55);
  t = await text();
  H.check('derived symbol is placed', /\(lib_id "Amplifier_Mock:LM358"\)/.test(t));
  H.check('the derived definition is flattened, with no extends left',
    /\(symbol "Amplifier_Mock:LM358"/.test(t) && t.indexOf('(extends') < 0);

  // Inspect the injected definition as a tree rather than by regex.
  const S = H.sexpr();
  const doc = S.parse(t);
  const headOf = function (n) {
    return n && n.kind === 'list' && n.children[0] ? n.children[0].value : null;
  };
  const listsOf = function (n, name) {
    return n.children.filter(function (c) { return c.kind === 'list' && headOf(c) === name; });
  };
  const libSymbols = listsOf(doc, 'lib_symbols')[0];
  const def = listsOf(libSymbols, 'symbol').find(function (sn) {
    return sn.children[1] && sn.children[1].value === 'Amplifier_Mock:LM358';
  });
  H.check('the flattened definition is in lib_symbols', !!def);

  const units = listsOf(def, 'symbol').map(function (u) { return u.children[1].value; });
  H.check('the parent sub-units are renamed after the derived symbol',
    units.indexOf('LM358_0_1') >= 0 && units.indexOf('LM358_1_1') >= 0, units.join(', '));

  let pinCount = 0;
  listsOf(def, 'symbol').forEach(function (u) {
    u.children.forEach(function (c) { if (headOf(c) === 'pin') pinCount++; });
  });
  H.check('all three parent pins come across', pinCount === 3, 'got ' + pinCount);

  const propOf = function (node, key) {
    const pr = listsOf(node, 'property').find(function (x) {
      return x.children[1] && x.children[1].value === key;
    });
    return pr && pr.children[2] ? pr.children[2].value : null;
  };
  H.check('the derived Value overrides the parent', propOf(def, 'Value') === 'LM358');
  H.check('the parent default footprint is inherited by the definition',
    propOf(def, 'Footprint') === 'Package_SO_Mock:SOIC-8_3.9x4.9mm_P1.27mm',
    String(propOf(def, 'Footprint')));

  const instance = doc.children.filter(function (c) {
    if (headOf(c) !== 'symbol') return false;
    const lid = listsOf(c, 'lib_id')[0];
    return lid && lid.children[1].value === 'Amplifier_Mock:LM358';
  })[0];
  H.check('the placed instance carries the inherited footprint',
    propOf(instance, 'Footprint') === 'Package_SO_Mock:SOIC-8_3.9x4.9mm_P1.27mm',
    String(propOf(instance, 'Footprint')));

  // Only the libraries actually used are fetched.
  const libHits = srv.requests.filter(function (r) { return /\/library\/\w+\.kicad_sym/.test(r); });
  const libNames = Array.from(new Set(libHits.map(function (r) { return r.split('?')[0]; })));
  H.check('libraries are lazy-loaded, one fetch per library used',
    libNames.length === 2, libNames.join(', '));

  H.check('no error dialogs', dialogs.length === 0, dialogs.join(' | '));
  H.check('no uncaught page errors', errors.length === 0, errors.join(' | '));

  const final = await text();
  await browser.close();
  await srv.close();
  H.check('the schematic reparses', H.sexpr().parse(final).children[0].value === 'kicad_sch');
});
