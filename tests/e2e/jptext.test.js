// Japanese on the canvas. The Hershey stroke font is ASCII-only, so non-ASCII
// is painted with the browser font; before that fallback existed the text was
// saved to the file but drawn as blank space.
'use strict';

const path = require('path');
const H = require('../lib/harness');

H.run(async function () {
  const dir = H.stagingDir({ library: 'mock' });
  const srv = await H.serve(dir);
  const { browser, page, errors } = await H.launch();

  await page.goto(srv.url + '/index.html');
  await page.click('#sampleBtn');
  await page.waitForTimeout(500);
  const cv = await H.canvasHelpers(page, '#canvas');
  const text = function () { return page.evaluate(function () { return window.__kicad.text(); }); };

  // --- a text item ---------------------------------------------------------
  await page.click('[data-tool="text"]');
  await cv.clickFrac(0.30, 0.18);
  await page.click('[data-tool="select"]');
  await cv.clickFrac(0.30, 0.18);
  H.check('text item placed and selected',
    (await page.evaluate(function () { return window.__kicad.selKind(); })) === 'text');

  await H.setField(page, 'テキスト', '');
  const blank = await cv.ink();
  await H.setField(page, 'テキスト', 'ABC');
  const ascii = await cv.ink();
  H.check('ASCII text draws ink (' + (ascii - blank) + ' px)', ascii - blank > 50);

  await H.setField(page, 'テキスト', '');
  await H.setField(page, 'テキスト', '日本語テスト');
  const jp = await cv.ink();
  H.check('Japanese text draws ink (' + (jp - blank) + ' px)', jp - blank > 50);

  await H.setField(page, 'テキスト', '');
  await H.setField(page, 'テキスト', '電源 5V ライン');
  const mixed = await cv.ink();
  H.check('mixed Japanese and ASCII draws ink (' + (mixed - blank) + ' px)', mixed - blank > 80);
  H.check('the Japanese is stored in the file',
    (await text()).indexOf('電源 5V ライン') >= 0);

  // Rotation must carry the browser-font run with it.
  await H.setField(page, '角度 (°)', '90');
  const rotated = await cv.ink();
  H.check('rotated Japanese still draws (' + (rotated - blank) + ' px)', rotated - blank > 50);

  // --- a label -------------------------------------------------------------
  await page.click('[data-tool="label"]');
  await cv.clickFrac(0.62, 0.18);
  await page.click('[data-tool="select"]');
  await cv.clickFrac(0.62, 0.18);
  // Measure against an empty label, so the figure is the Japanese alone and
  // not the difference against the default "LABEL" text.
  await H.setField(page, 'テキスト', '');
  const emptyLabel = await cv.ink();
  await H.setField(page, 'テキスト', '信号線');
  const afterLabel = await cv.ink();
  H.check('Japanese label draws ink (' + (afterLabel - emptyLabel) + ' px)',
    afterLabel - emptyLabel > 30);

  // --- the footprint editor uses the same fallback -------------------------
  await cv.clickWorld(50.8, 38.1);                     // sample R1
  await H.setField(page, 'Footprint', 'Test_Lib:FP_JP_TEXT');
  await page.click('.fp-edit-btn');
  await page.waitForTimeout(1200);
  H.check('footprint editor opened on the fixture',
    (await page.$eval('#fpName', function (el) { return el.value; })) === 'FP_JP_TEXT');
  const fpInk = await page.$eval('#fpCanvas', function (c) {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (Math.abs(d[i]) > 40 || Math.abs(d[i + 1] - 16) > 40 || Math.abs(d[i + 2] - 35) > 40) n++;
    }
    return n;
  });
  H.check('footprint editor draws its Japanese fp_text (' + fpInk + ' px)', fpInk > 3000);
  await page.click('#fpEditorClose');

  H.check('no uncaught page errors', errors.length === 0, errors.join(' | '));
  const final = await text();
  await browser.close();
  await srv.close();
  H.check('the schematic reparses with Japanese in it',
    H.sexpr().parse(final).children[0].value === 'kicad_sch');
  void path;
});
