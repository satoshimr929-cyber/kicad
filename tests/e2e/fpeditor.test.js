// The footprint editor: load from the bundled library or a local .kicad_mod,
// select and move pads, edit them numerically, undo, and save a .kicad_mod
// that KiCad can read.
'use strict';

const fs = require('fs');
const os = require('os');
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
  const fpText = function () {
    return page.evaluate(function () { return window.KiFpEditor.__state().text; });
  };

  // --- open from the Footprint field ---------------------------------------
  await cv.clickWorld(50.8, 38.1);                     // sample R1
  await H.setField(page, 'Footprint', 'Resistor_SMD_Mock:R_0603_1608Metric');
  await page.click('.fp-edit-btn');
  await page.waitForTimeout(1200);
  H.check('editor opens', await page.$eval('#fpEditorModal', function (el) { return !el.hidden; }));
  H.check('it loads the named footprint from the library',
    (await page.$eval('#fpName', function (el) { return el.value; })) === 'R_0603_1608Metric');

  const fpBox = await page.$eval('#fpCanvas', function (el) {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y };
  });
  const fpPoint = function (wx, wy) {
    return page.evaluate(function (a) {
      const v = window.KiFpEditor.__state().renderer.view;
      return { x: a[2] + (a[0] - v.panX) * v.scale, y: a[3] + (a[1] - v.panY) * v.scale };
    }, [wx, wy, fpBox.x, fpBox.y]);
  };
  const fpInk = function () {
    return page.$eval('#fpCanvas', function (c) {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (Math.abs(d[i]) > 40 || Math.abs(d[i + 1] - 16) > 40 || Math.abs(d[i + 2] - 35) > 40) n++;
      }
      return n;
    });
  };
  H.check('the footprint is drawn (' + (await fpInk()) + ' px)', (await fpInk()) > 2000);

  // --- select a pad --------------------------------------------------------
  let pt = await fpPoint(-0.825, 0);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(250);
  const panel = await page.$eval('#fpPanel', function (el) { return el.textContent; });
  H.check('tapping a pad selects it and fills the panel',
    panel.indexOf('パッド 1') >= 0, panel.slice(0, 40));

  // --- drag it, on a 0.05mm grid ------------------------------------------
  pt = await fpPoint(-0.825, 0);
  const scale = await page.evaluate(function () {
    return window.KiFpEditor.__state().renderer.view.scale;
  });
  await page.mouse.move(pt.x, pt.y);
  await page.mouse.down();
  await page.mouse.move(pt.x + scale * 0.5, pt.y, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(250);
  H.check('dragging the selected pad moves it by the snapped delta',
    /\(pad "1"[\s\S]{0,80}?\(at -0\.325 0\)/.test(await fpText()), 'pad 1 did not land on -0.325');

  // --- numeric edit --------------------------------------------------------
  const widthInput = await page.evaluateHandle(function () {
    const fields = Array.from(document.querySelectorAll('#fpPanel .fp-field'));
    const f = fields.find(function (x) { return x.querySelector('span').textContent.indexOf('幅') === 0; });
    return f ? f.querySelector('input') : null;
  });
  await widthInput.asElement().fill('1.2');
  await widthInput.asElement().press('Enter');
  await page.waitForTimeout(250);
  H.check('the pad size can be typed in', /\(size 1\.2 0\.95\)/.test(await fpText()));

  // --- undo / redo ---------------------------------------------------------
  await page.click('#fpUndoBtn');
  await page.waitForTimeout(250);
  H.check('undo restores the previous size', /\(size 0\.8 0\.95\)/.test(await fpText()));
  await page.click('#fpRedoBtn');
  await page.waitForTimeout(250);
  H.check('redo reapplies it', /\(size 1\.2 0\.95\)/.test(await fpText()));

  // --- rename and save -----------------------------------------------------
  await page.fill('#fpName', 'R_0603_custom');
  await page.press('#fpName', 'Enter');
  await page.waitForTimeout(250);
  const dl = await Promise.all([
    page.waitForEvent('download'),
    page.click('#fpSaveBtn'),
  ]).then(function (r) { return r[0]; });
  H.check('the download is named after the footprint',
    dl.suggestedFilename() === 'R_0603_custom.kicad_mod', dl.suggestedFilename());
  const saved = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kicad-dl-')), 'out.kicad_mod');
  await dl.saveAs(saved);
  const savedText = fs.readFileSync(saved, 'utf8');
  H.check('the saved file is renamed and carries the edits',
    savedText.indexOf('(footprint "R_0603_custom"') === 0 && /\(size 1\.2 0\.95\)/.test(savedText));
  H.check('the saved .kicad_mod reparses',
    H.sexpr().parse(savedText).children[0].value === 'footprint');

  // --- open a local file ---------------------------------------------------
  await page.setInputFiles('#fpFileInput',
    path.join(H.REPO, 'tests', 'fixtures', 'footprints', 'Test_Lib.pretty', 'FP_UNIQUE_XYZ.kicad_mod'));
  await page.waitForTimeout(700);
  H.check('a local .kicad_mod can be opened',
    (await page.$eval('#fpName', function (el) { return el.value; })) === 'FP_UNIQUE_XYZ');
  H.check('its through-hole pads and drills are parsed',
    /thru_hole/.test(await fpText()) && /\(drill 0\.9\)/.test(await fpText()));

  // --- select a graphic and delete it -------------------------------------
  pt = await fpPoint(0, -2);                            // the F.SilkS fp_line
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(250);
  H.check('a graphic can be selected',
    (await page.$eval('#fpPanel', function (el) { return el.textContent; })).indexOf('図形') >= 0);
  await page.keyboard.press('Delete');
  await page.waitForTimeout(250);
  H.check('Delete removes it', (await fpText()).indexOf('fp_line') < 0);
  await page.click('#fpUndoBtn');
  await page.waitForTimeout(250);
  H.check('the delete is undoable', (await fpText()).indexOf('fp_line') >= 0);

  await page.click('#fpEditorClose');
  H.check('the editor closes', await page.$eval('#fpEditorModal', function (el) { return el.hidden; }));
  H.check('no uncaught page errors', errors.length === 0, errors.join(' | '));

  await browser.close();
  await srv.close();
});
