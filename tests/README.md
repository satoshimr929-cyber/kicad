# tests

```sh
tests/run.sh          # everything
tests/run.sh unit     # node only, ~2s
tests/run.sh e2e      # drives the real app in headless Chromium
tests/run.sh jptext   # any test whose path matches
node tests/unit/rp2040.test.js   # a single suite, standalone
```

Each suite prints `PASS`/`FAIL` per assertion and exits non-zero if any failed,
so `run.sh` is just an aggregator and there is no framework to learn.

## Requirements

* **unit** — node only.
* **e2e** — Playwright with Chromium. The repo deliberately has no
  `package.json` (the app ships as plain static files), so Playwright is
  resolved from a global install or from `PLAYWRIGHT_PATH`
  (see `tests/lib/pw.js`):

  ```sh
  npm i -g playwright && playwright install chromium
  ```

  `jptext.test.js` needs a Japanese font installed on the machine
  (e.g. `fonts-noto-cjk`), because that is what the browser-font fallback
  draws with.

## Layout

| path | what it covers |
| --- | --- |
| `unit/parts.test.js` | every built-in part parses, has pins with unique numbers, round-trips |
| `unit/model.test.js` | parser/serializer round-trips of real files, string escaping, `readAt`/`writePts`/`ensureProperty` |
| `unit/strokefont.test.js` | ASCII geometry frozen against a golden; non-ASCII returns browser-font runs |
| `unit/rp2040.test.js` | the hand-authored RP2040-Zero: pad geometry against Waveshare's drawing, and symbol pins vs footprint pads |
| `unit/buildtools.test.js` | the deploy-time index builders, incl. `extends` inheritance and failing on empty input |
| `e2e/smoke.test.js` | load, render, place a part, wire, undo/redo, save |
| `e2e/jptext.test.js` | Japanese in text items, labels, rotated text and the footprint editor |
| `e2e/stdlib.test.js` | library index search, lazy loading, `extends` flattening, footprint inheritance |
| `e2e/fpeditor.test.js` | footprint editor: select, drag, numeric edit, undo, rename, save, local file |
| `e2e/cachebust.test.js` | recovery when a stale CDN serves 404 or an empty index |

`lib/harness.js` holds the assertions, a static file server (whose `handle`
hook is how `cachebust` injects faults), the staging-site builder and the
browser helpers. `lib/pw.js` finds Playwright.

## Fixtures

`fixtures/symbols` and `fixtures/footprints` are small stand-ins for the
official KiCad libraries, which are ~390 MB and fetched at deploy time rather
than committed. `harness.stagingDir({ library: 'mock' })` runs the **real**
`tools/build-*-index.js` over them, so the build scripts are covered too and
the on-disk format cannot drift from what the app expects. The symbol fixtures
cover both upstream layouts (a flat `.kicad_sym` and a `.kicad_symdir/`
directory) and include an `extends`-derived symbol.

To run the e2e suites against the real libraries instead, build them once and
point the harness at the result:

```sh
git clone --depth 1 -b 10.0.4 https://gitlab.com/kicad/libraries/kicad-symbols.git /tmp/ks
git clone --depth 1 -b 10.0.4 https://gitlab.com/kicad/libraries/kicad-footprints.git /tmp/kf
cp -r footprints/*.pretty /tmp/kf/
node tools/build-lib-index.js /tmp/ks /tmp/lib
node tools/build-fp-index.js /tmp/kf /tmp/lib
```

then use `H.stagingDir({ library: '/tmp/lib' })` in a scratch test.

`fixtures/strokefont-ascii-golden.json` freezes the stroke-font output for 48
string/placement combinations. Existing schematics are all ASCII, so this is
what stops a font change from silently moving text that already renders
correctly. Regenerate it **only** when a change to the glyph geometry is
intended, and say so in the commit message.
