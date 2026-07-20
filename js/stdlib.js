// stdlib.js — lazy loader for the bundled KiCad standard symbol libraries.
//
// The deploy step packages the official kicad-symbols files under library/
// together with a search index (see tools/build-lib-index.js). This module
// fetches the index once, then individual .kicad_sym files on demand, and
// flattens `extends`-derived symbols into standalone definitions in the same
// form KiCad embeds into a schematic's lib_symbols.

(function (global) {
  'use strict';

  const BASE = 'library/';
  let indexPromise = null;
  const libCache = {}; // lib name -> Promise<parsed root>

  // The deploy step stamps the commit SHA into <meta name="build">, so every
  // deployment fetches the library under fresh URLs that no cache layer can
  // have gone stale on. Locally (content="dev") no version query is added.
  let buildTag = null;
  function tag() {
    if (buildTag === null) {
      const m = typeof document !== 'undefined'
        ? document.querySelector('meta[name="build"]') : null;
      buildTag = m && m.content && m.content !== 'dev' ? m.content : '';
    }
    return buildTag;
  }

  // Fetch a library file dodging stale caches. Right after a deploy the Pages
  // CDN can negative-cache a 404 (and browsers cache it in turn), so first
  // revalidate with the origin, and on any failure retry once with a
  // cache-busting query — a fresh cache key at every layer. The service
  // worker's offline fallback matches with ignoreSearch, so the query does
  // not break offline use.
  function fetchFresh(path, label) {
    function check(res) {
      if (!res.ok) throw new Error(label + ': HTTP ' + res.status);
      return res;
    }
    const first = tag() ? path + '?v=' + encodeURIComponent(tag()) : path;
    return fetch(first, { cache: 'no-cache' }).then(check).catch(function () {
      return fetch(path + '?r=' + Date.now(), { cache: 'reload' }).then(check);
    });
  }

  function loadIndex() {
    if (!indexPromise) {
      indexPromise = fetchFresh(BASE + 'index.json', 'index.json')
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (data && data.symbols && data.symbols.length) return data;
          // An empty index was briefly deployed once; a copy may linger in
          // caches. Force a fresh copy before giving up.
          return fetch(BASE + 'index.json?r=' + Date.now(), { cache: 'reload' })
            .then(function (res) {
              if (!res.ok) throw new Error('index.json: HTTP ' + res.status);
              return res.json();
            }).then(function (fresh) {
              if (fresh && fresh.symbols && fresh.symbols.length) return fresh;
              throw new Error('索引が空です（ライブラリ未配備）');
            });
        })
        .catch(function (err) {
          indexPromise = null; // allow retry
          throw err;
        });
    }
    return indexPromise;
  }

  function loadLib(lib) {
    if (!libCache[lib]) {
      libCache[lib] = fetchFresh(BASE + lib + '.kicad_sym', lib + '.kicad_sym')
        .then(function (res) { return res.text(); })
        .then(function (text) {
          return global.SExpr.parse(text);
        }).catch(function (err) {
          delete libCache[lib];
          throw err;
        });
    }
    return libCache[lib];
  }

  const M = function () { return global.KiModel; };

  function findSymbol(root, name) {
    return M().childLists(root, 'symbol').find(function (sn) {
      return sn.children[1] && sn.children[1].value === name;
    }) || null;
  }

  function propNode(symNode, key) {
    return M().childLists(symNode, 'property').find(function (p) {
      return p.children[1] && p.children[1].value === key;
    }) || null;
  }

  function clone(node) {
    return global.SExpr.parse(global.SExpr.serialize(node, 0));
  }

  // Build a standalone `(symbol "Lib:Name" ...)` definition for `name`,
  // resolving an `extends` chain by cloning the base symbol, renaming its
  // sub-symbol units, and applying each derivation's property overrides.
  function flatten(root, lib, name) {
    const chain = []; // derived-most first
    let cur = findSymbol(root, name);
    let guard = 0;
    while (cur && guard++ < 6) {
      chain.push(cur);
      const ext = M().firstChild(cur, 'extends');
      cur = ext && ext.children[1] ? findSymbol(root, ext.children[1].value) : null;
      if (!ext) break;
    }
    if (!chain.length) return null;

    const base = chain[chain.length - 1];
    const baseName = base.children[1].value;
    const def = clone(base);

    // Rename the symbol itself and its unit sub-symbols to the derived name.
    def.children[1] = { kind: 'atom', value: lib + ':' + name, quoted: true };
    M().childLists(def, 'symbol').forEach(function (sub) {
      if (!sub.children[1]) return;
      const subName = sub.children[1].value;
      if (subName.indexOf(baseName + '_') === 0) {
        sub.children[1] = {
          kind: 'atom',
          value: name + subName.slice(baseName.length),
          quoted: true,
        };
      }
    });

    // Apply property overrides from base-most derivation to derived-most.
    for (let i = chain.length - 2; i >= 0; i--) {
      M().childLists(chain[i], 'property').forEach(function (p) {
        const key = p.children[1] ? p.children[1].value : null;
        if (!key) return;
        const existing = propNode(def, key);
        const copy = clone(p);
        if (existing) {
          def.children[def.children.indexOf(existing)] = copy;
        } else {
          const props = M().childLists(def, 'property');
          const anchor = props.length ? props[props.length - 1] : null;
          const idx = anchor ? def.children.indexOf(anchor) + 1 : 2;
          def.children.splice(idx, 0, copy);
        }
      });
    }
    return def;
  }

  // Resolve one symbol into { def, ref, value, label } — the same meta shape
  // the app's importedParts/choosePart placement path consumes.
  function loadSymbol(lib, name) {
    return loadLib(lib).then(function (root) {
      const def = flatten(root, lib, name);
      if (!def) throw new Error(lib + ':' + name + ' が見つかりません');
      const refP = propNode(def, 'Reference');
      const ref = (refP && refP.children[2] ? refP.children[2].value : 'U')
        .replace(/[^A-Za-z#].*$/, '') || 'U';
      return {
        def: global.SExpr.serialize(def, 0),
        ref: ref,
        value: name,
        label: name,
      };
    });
  }

  // Search index of the bundled KiCad footprint libraries (names only; the
  // geometry is not shipped). Same freshness handling as the symbol index.
  let fpIndexPromise = null;
  function loadFpIndex() {
    if (!fpIndexPromise) {
      fpIndexPromise = fetchFresh(BASE + 'fp-index.json', 'fp-index.json')
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (data && data.footprints && data.footprints.length) return data;
          return fetch(BASE + 'fp-index.json?r=' + Date.now(), { cache: 'reload' })
            .then(function (res) {
              if (!res.ok) throw new Error('fp-index.json: HTTP ' + res.status);
              return res.json();
            }).then(function (fresh) {
              if (fresh && fresh.footprints && fresh.footprints.length) return fresh;
              throw new Error('フットプリント索引が空です');
            });
        })
        .catch(function (err) {
          fpIndexPromise = null; // allow retry
          throw err;
        });
    }
    return fpIndexPromise;
  }

  // Footprint geometry: each <Lib>.pretty ships merged as fp/<Lib>.kicad_fps
  // (see tools/build-fp-index.js); loaded lazily for the footprint editor.
  const fpLibCache = {}; // lib name -> Promise<parsed root>
  function loadFpLib(lib) {
    if (!fpLibCache[lib]) {
      fpLibCache[lib] = fetchFresh(BASE + 'fp/' + lib + '.kicad_fps', lib + '.kicad_fps')
        .then(function (res) { return res.text(); })
        .then(function (text) {
          return global.SExpr.parse(text);
        }).catch(function (err) {
          delete fpLibCache[lib];
          throw err;
        });
    }
    return fpLibCache[lib];
  }

  // Resolve one footprint into a fresh clone the editor may mutate freely.
  function loadFootprint(lib, name) {
    return loadFpLib(lib).then(function (root) {
      const fp = M().childLists(root, 'footprint').find(function (f) {
        return f.children[1] && f.children[1].value === name;
      });
      if (!fp) throw new Error(lib + ':' + name + ' が見つかりません');
      return clone(fp);
    });
  }

  global.KiStdLib = {
    loadIndex: loadIndex,
    loadSymbol: loadSymbol,
    loadFpIndex: loadFpIndex,
    loadFootprint: loadFootprint,
  };
})(typeof window !== 'undefined' ? window : globalThis);
