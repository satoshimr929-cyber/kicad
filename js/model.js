// model.js — structured access over the parsed S-expression tree.
//
// The parsed tree stays the single source of truth for saving. This module
// provides read helpers for the renderer and mutation helpers for the editor,
// plus a one-time parse of `lib_symbols` into an easy-to-draw shape.

(function (global) {
  'use strict';

  // --- generic tree helpers -------------------------------------------------

  function head(node) {
    return node && node.kind === 'list' && node.children[0] && node.children[0].kind === 'atom'
      ? node.children[0].value
      : null;
  }

  function childLists(node, name) {
    if (!node || node.kind !== 'list') return [];
    return node.children.filter(function (c) {
      return c.kind === 'list' && head(c) === name;
    });
  }

  function firstChild(node, name) {
    return childLists(node, name)[0] || null;
  }

  // Atom children of a list, excluding the head symbol.
  function atomArgs(node) {
    if (!node || node.kind !== 'list') return [];
    return node.children.slice(1).filter(function (c) { return c.kind === 'atom'; });
  }

  function num(atom) {
    return atom ? parseFloat(atom.value) : 0;
  }

  function atomNode(value, quoted) {
    return { kind: 'atom', value: String(value), quoted: !!quoted };
  }

  // Format a number the way KiCad tends to: trim trailing zeros, keep it plain.
  function fmt(n) {
    if (!isFinite(n)) return '0';
    let s = n.toFixed(6);
    if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
    if (s === '-0') s = '0';
    return s;
  }

  // --- geometry helpers -----------------------------------------------------

  // Read an `(at x y [angle])` list into {x, y, angle}.
  function readAt(node) {
    const at = firstChild(node, 'at');
    if (!at) return null;
    const a = at.children;
    return {
      node: at,
      x: num(a[1]),
      y: num(a[2]),
      angle: a[3] ? num(a[3]) : 0,
    };
  }

  function writeAt(node, x, y, angle) {
    const at = firstChild(node, 'at');
    if (!at) return;
    at.children[1] = atomNode(fmt(x));
    at.children[2] = atomNode(fmt(y));
    // Only touch the angle slot if the list already has one, or a non-zero
    // angle is requested — junction/no_connect `(at x y)` lists must stay 2-arg.
    if (typeof angle === 'number' && (at.children[3] !== undefined || angle !== 0)) {
      at.children[3] = atomNode(fmt(angle));
    }
  }

  // Overwrite the coordinates inside a `(pts (xy ...) ...)` list.
  function writePts(node, pts) {
    const ptsNode = firstChild(node, 'pts');
    if (!ptsNode) return;
    const xys = childLists(ptsNode, 'xy');
    for (let i = 0; i < xys.length && i < pts.length; i++) {
      xys[i].children[1] = atomNode(fmt(pts[i].x));
      xys[i].children[2] = atomNode(fmt(pts[i].y));
    }
  }

  function removeChild(parent, node) {
    const i = parent.children.indexOf(node);
    if (i >= 0) parent.children.splice(i, 1);
    return i >= 0;
  }

  // First value argument of e.g. (label "TEXT" ...) / (text "TEXT" ...).
  function setText(node, value) {
    node.children[1] = atomNode(value, true);
  }

  // Set, change or clear a symbol instance's (mirror x|y). axis null removes it.
  function setMirror(symbolNode, axis) {
    let m = firstChild(symbolNode, 'mirror');
    if (!axis) {
      if (m) removeChild(symbolNode, m);
      return;
    }
    if (m) { m.children[1] = atomNode(axis); return; }
    m = { kind: 'list', children: [atomNode('mirror'), atomNode(axis)] };
    const at = firstChild(symbolNode, 'at');
    const idx = at ? symbolNode.children.indexOf(at) : -1;
    symbolNode.children.splice(idx >= 0 ? idx + 1 : symbolNode.children.length, 0, m);
  }

  // Read `(pts (xy x y) ...)` into [{x, y}, ...].
  function readPts(node) {
    const pts = firstChild(node, 'pts');
    if (!pts) return [];
    return childLists(pts, 'xy').map(function (p) {
      return { x: num(p.children[1]), y: num(p.children[2]) };
    });
  }

  // --- lib_symbols parsing --------------------------------------------------

  // A sub-symbol name looks like "Device:R_0_1" (unit 0, body-style 1).
  function parseUnitStyle(name) {
    const m = /_(\d+)_(\d+)$/.exec(name);
    if (!m) return { unit: 0, style: 1 };
    return { unit: parseInt(m[1], 10), style: parseInt(m[2], 10) };
  }

  function fill(node) {
    const f = firstChild(node, 'fill');
    if (!f) return 'none';
    const t = firstChild(f, 'type');
    return t ? t.children[1].value : 'none';
  }

  function parseGraphic(node) {
    const type = head(node);
    switch (type) {
      case 'rectangle': {
        const s = firstChild(node, 'start');
        const e = firstChild(node, 'end');
        return {
          type: 'rectangle',
          start: { x: num(s.children[1]), y: num(s.children[2]) },
          end: { x: num(e.children[1]), y: num(e.children[2]) },
          fill: fill(node),
        };
      }
      case 'polyline': {
        return { type: 'polyline', pts: readPts(node), fill: fill(node) };
      }
      case 'circle': {
        const c = firstChild(node, 'center');
        const r = firstChild(node, 'radius');
        return {
          type: 'circle',
          center: { x: num(c.children[1]), y: num(c.children[2]) },
          radius: num(r.children[1]),
          fill: fill(node),
        };
      }
      case 'arc': {
        const s = firstChild(node, 'start');
        const m = firstChild(node, 'mid');
        const e = firstChild(node, 'end');
        return {
          type: 'arc',
          start: { x: num(s.children[1]), y: num(s.children[2]) },
          mid: { x: num(m.children[1]), y: num(m.children[2]) },
          end: { x: num(e.children[1]), y: num(e.children[2]) },
          fill: fill(node),
        };
      }
      case 'text': {
        const at = readAt(node);
        return {
          type: 'text',
          text: node.children[1] ? node.children[1].value : '',
          x: at ? at.x : 0,
          y: at ? at.y : 0,
          angle: at ? at.angle : 0,
        };
      }
      case 'pin': {
        const at = readAt(node);
        const len = firstChild(node, 'length');
        const nameN = firstChild(node, 'name');
        const numN = firstChild(node, 'number');
        const args = atomArgs(node); // [electrical_type, graphic_style, ('hide')]
        const style = args[1] && args[1].value !== 'hide' ? args[1].value : 'line';
        return {
          type: 'pin',
          x: at ? at.x : 0,
          y: at ? at.y : 0,
          angle: at ? at.angle : 0,
          length: len ? num(len.children[1]) : 2.54,
          name: nameN ? nameN.children[1].value : '',
          number: numN ? numN.children[1].value : '',
          etype: args[0] ? args[0].value : 'passive',
          style: style,
          hide: node.children.some(function (c) { return c.kind === 'atom' && c.value === 'hide'; }),
        };
      }
      default:
        return null;
    }
  }

  function parseLibSymbol(node) {
    const name = node.children[1] ? node.children[1].value : '';
    const pinNamesNode = firstChild(node, 'pin_names');
    const hidePinNumbers = childLists(node, 'pin_numbers').some(function (p) {
      return p.children.some(function (c) { return c.kind === 'atom' && c.value === 'hide'; });
    });
    let pinNameOffset = 0.508;
    let hidePinNames = false;
    if (pinNamesNode) {
      const off = firstChild(pinNamesNode, 'offset');
      if (off) pinNameOffset = num(off.children[1]);
      hidePinNames = pinNamesNode.children.some(function (c) {
        return c.kind === 'atom' && c.value === 'hide';
      });
    }

    const bodies = [];
    childLists(node, 'symbol').forEach(function (sub) {
      const us = parseUnitStyle(sub.children[1] ? sub.children[1].value : '');
      const graphics = [];
      const pins = [];
      sub.children.forEach(function (c) {
        if (c.kind !== 'list') return;
        const g = parseGraphic(c);
        if (!g) return;
        if (g.type === 'pin') pins.push(g);
        else graphics.push(g);
      });
      bodies.push({ unit: us.unit, style: us.style, graphics: graphics, pins: pins });
    });

    return {
      name: name,
      bodies: bodies,
      hidePinNumbers: hidePinNumbers,
      hidePinNames: hidePinNames,
      pinNameOffset: pinNameOffset,
    };
  }

  // --- schematic wrapper ----------------------------------------------------

  function Schematic(root) {
    this.root = root;
    this.libSymbols = {};
    const lib = firstChild(root, 'lib_symbols');
    if (lib) {
      childLists(lib, 'symbol').forEach(function (s) {
        const parsed = parseLibSymbol(s);
        this.libSymbols[parsed.name] = parsed;
      }, this);
    }
  }

  // Parse an inserted `(symbol "lib:Name" ...)` lib definition and make it
  // available for rendering (used when placing built-in power symbols).
  Schematic.prototype.registerLibSymbol = function (node) {
    const parsed = parseLibSymbol(node);
    this.libSymbols[parsed.name] = parsed;
    return parsed;
  };

  // Direct top-level child lists with any of the given heads.
  Schematic.prototype.items = function (names) {
    const set = Array.isArray(names) ? names : [names];
    return this.root.children.filter(function (c) {
      return c.kind === 'list' && set.indexOf(head(c)) >= 0;
    });
  };

  Schematic.prototype.symbols = function () {
    return childLists(this.root, 'symbol');
  };

  Schematic.prototype.libFor = function (symbolNode) {
    const lidNode = firstChild(symbolNode, 'lib_id');
    const libId = lidNode && lidNode.children[1] ? lidNode.children[1].value : null;
    return libId ? this.libSymbols[libId] : null;
  };

  // A symbol instance's placement.
  Schematic.prototype.placement = function (symbolNode) {
    const at = readAt(symbolNode);
    const mirrorNode = firstChild(symbolNode, 'mirror');
    const unitNode = firstChild(symbolNode, 'unit');
    return {
      x: at ? at.x : 0,
      y: at ? at.y : 0,
      angle: at ? at.angle : 0,
      mirror: mirrorNode && mirrorNode.children[1] ? mirrorNode.children[1].value : null,
      unit: unitNode ? num(unitNode.children[1]) : 1,
    };
  };

  // Properties of a symbol as editable descriptors.
  Schematic.prototype.properties = function (symbolNode) {
    return childLists(symbolNode, 'property').map(function (p) {
      return {
        node: p,
        key: p.children[1] ? p.children[1].value : '',
        value: p.children[2] ? p.children[2].value : '',
        at: readAt(p),
        hidden: (function () {
          const eff = firstChild(p, 'effects');
          return eff ? eff.children.some(function (c) {
            return c.kind === 'atom' && c.value === 'hide';
          }) : false;
        })(),
      };
    });
  };

  Schematic.prototype.setProperty = function (propNode, value) {
    propNode.children[2] = atomNode(value, true);
  };

  global.KiModel = {
    head: head,
    childLists: childLists,
    firstChild: firstChild,
    atomArgs: atomArgs,
    num: num,
    fmt: fmt,
    atomNode: atomNode,
    readAt: readAt,
    writeAt: writeAt,
    readPts: readPts,
    writePts: writePts,
    removeChild: removeChild,
    setText: setText,
    setMirror: setMirror,
    Schematic: Schematic,
  };
})(typeof window !== 'undefined' ? window : globalThis);
