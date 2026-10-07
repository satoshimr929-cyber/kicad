// The core loop: open a schematic, see it drawn, place a part, draw a wire,
// undo, and save something KiCad can still read.
'use strict';

const H = require('../lib/harness');

H.run(async function () {
  const dir = H.stagingDir({ library: 'none' });
  const srv = await H.serve(dir);
  const { browser, page, errors } = await H.launch();

  await page.goto(srv.url + '/index.html');
  await page.click('#sampleBtn');
  await page.waitForTimeout(500);
  const cv = await H.canvasHelpers(page, '#canvas');
  const text = function () { return page.evaluate(function () { return window.__kicad.text(); }); };

  H.check('sample schematic loads', (await text()).indexOf('kicad_sch') >= 0);
  const ink = await cv.ink();
  H.check('sample is drawn on the canvas (' + ink + ' px)', ink > 3000);

  // Part chooser -> preview -> place
  await page.click('#partBtn');
  await page.waitForTimeout(250);
  H.check('part chooser opens', await page.$eval('#partModal', function (el) { return !el.hidden; }));
  await page.click('.part-item[title="Device:R"]');
  await page.waitForTimeout(350);
  H.check('clicking a part shows the preview, not immediate placement',
    await page.$eval('#partPreview', function (el) { return !el.hidden; }) &&
    (await page.evaluate(function () { return window.__kicad.tool(); })) !== 'part');
  await page.click('#previewPlace');
  await page.waitForTimeout(250);
  H.check('placement is armed from the preview',
    (await page.evaluate(function () { return window.__kicad.placePart(); })) === 'Device:R');

  await cv.clickFrac(0.75, 0.30);
  let t = await text();
  H.check('part is placed with an auto-assigned reference',
    /\(property "Reference" "R3"/.test(t));
  H.check('its library definition is injected into lib_symbols',
    /\(symbol "Device:R"/.test(t));
  await page.click('[data-tool="select"]');

  // Wire
  const wiresBefore = (t.match(/\(wire/g) || []).length;
  await page.click('[data-tool="wire"]');
  await cv.clickFrac(0.20, 0.60);
  await cv.clickFrac(0.35, 0.60);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(250);
  t = await text();
  H.check('a wire is drawn', (t.match(/\(wire/g) || []).length === wiresBefore + 1);

  // Undo / redo
  await page.keyboard.press('Control+z');
  await page.waitForTimeout(250);
  const undone = ((await text()).match(/\(wire/g) || []).length;
  await page.keyboard.press('Control+y');
  await page.waitForTimeout(250);
  const redone = ((await text()).match(/\(wire/g) || []).length;
  H.check('undo and redo move one step each',
    undone === wiresBefore && redone === wiresBefore + 1,
    'undone=' + undone + ' redone=' + redone);

  H.check('no uncaught page errors', errors.length === 0, errors.join(' | '));

  const final = await text();
  await browser.close();
  await srv.close();
  H.check('the saved schematic reparses', H.sexpr().parse(final).children[0].value === 'kicad_sch');
});
