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

  function loadIndex() {
    if (!indexPromise) {
      indexPromise = fetch(BASE + 'index.json').then(function (res) {
        if (!res.ok) throw new Error('index.json: HTTP ' + res.status);
        return res.json();
      }).catch(function (err) {
        indexPromise = null; // allow retry
        throw err;
      });
    }
    return indexPromise;
  }

  function loadLib(lib) {
    if (!libCache[lib]) {
      libCache[lib] = fetch(BASE + lib + '.kicad_sym').then(function (res) {
        if (!res.ok) throw new Error(lib + '.kicad_sym: HTTP ' + res.status);
        return res.text();
      }).then(function (text) {
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

  global.KiStdLib = {
    loadIndex: loadIndex,
    loadSymbol: loadSymbol,
  };
})(typeof window !== 'undefined' ? window : globalThis);
