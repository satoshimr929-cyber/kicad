// sexpr.js — KiCad S-expression parser and serializer.
//
// The parser produces a tree that preserves enough information to be
// serialized back to a valid .kicad_sch file. Two node kinds exist:
//
//   { kind: 'list', children: [ ...nodes ] }
//   { kind: 'atom', value: <string>, quoted: <bool> }
//
// For a list node, children[0] is normally the head symbol atom
// (e.g. "wire", "symbol", "at"). Editing keeps the tree as the source of
// truth: only the nodes that actually change are touched, so unmodified
// values round-trip byte-for-byte through their original atom strings.

(function (global) {
  'use strict';

  function isSpace(ch) {
    return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r';
  }

  // Parse a full document string into a single root list node.
  function parse(text) {
    let i = 0;
    const n = text.length;

    function skipWs() {
      while (i < n && isSpace(text[i])) i++;
    }

    function parseNode() {
      skipWs();
      if (i >= n) throw new Error('Unexpected end of input');
      const ch = text[i];
      if (ch === '(') {
        i++; // consume '('
        const children = [];
        for (;;) {
          skipWs();
          if (i >= n) throw new Error('Unterminated list');
          if (text[i] === ')') {
            i++; // consume ')'
            break;
          }
          children.push(parseNode());
        }
        return { kind: 'list', children: children };
      }
      if (ch === ')') {
        throw new Error('Unexpected ) at position ' + i);
      }
      if (ch === '"') {
        return parseQuoted();
      }
      return parseBareAtom();
    }

    function parseQuoted() {
      i++; // consume opening quote
      let out = '';
      while (i < n) {
        const ch = text[i++];
        if (ch === '\\') {
          const esc = text[i++];
          switch (esc) {
            case 'n': out += '\n'; break;
            case 'r': out += '\r'; break;
            case 't': out += '\t'; break;
            case '"': out += '"'; break;
            case '\\': out += '\\'; break;
            default: out += esc; break;
          }
        } else if (ch === '"') {
          return { kind: 'atom', value: out, quoted: true };
        } else {
          out += ch;
        }
      }
      throw new Error('Unterminated string literal');
    }

    function parseBareAtom() {
      let start = i;
      while (i < n && !isSpace(text[i]) && text[i] !== '(' && text[i] !== ')' && text[i] !== '"') {
        i++;
      }
      return { kind: 'atom', value: text.slice(start, i), quoted: false };
    }

    skipWs();
    const root = parseNode();
    skipWs();
    return root;
  }

  function escapeString(s) {
    let out = '';
    for (let k = 0; k < s.length; k++) {
      const ch = s[k];
      if (ch === '\\') out += '\\\\';
      else if (ch === '"') out += '\\"';
      else if (ch === '\n') out += '\\n';
      else if (ch === '\r') out += '\\r';
      else if (ch === '\t') out += '\\t';
      else out += ch;
    }
    return out;
  }

  function atomToString(node) {
    if (node.quoted) return '"' + escapeString(node.value) + '"';
    // A bare atom that is empty must still round-trip as a quoted empty string.
    if (node.value === '') return '""';
    return node.value;
  }

  // True if a list contains only atoms (no nested lists). Such lists are
  // printed on a single line, matching KiCad's general layout style.
  function isFlat(node) {
    if (node.kind !== 'list') return true;
    return node.children.every(function (c) { return c.kind === 'atom'; });
  }

  // Serialize a node. Returns a string whose FIRST line has no leading
  // indentation (the caller positions it); continuation lines are indented
  // relative to `indent`.
  function serialize(node, indent) {
    indent = indent || 0;

    if (node.kind === 'atom') {
      return atomToString(node);
    }

    if (isFlat(node)) {
      const inner = node.children.map(atomToString).join(' ');
      return '(' + inner + ')';
    }

    // Multi-line: leading atoms (head plus any simple atoms before the first
    // nested list) stay on the opening line; the rest are indented one level.
    const childPad = '  '.repeat(indent + 1);
    const children = node.children;
    let head = '(';
    let k = 0;
    for (; k < children.length && children[k].kind === 'atom'; k++) {
      head += (k === 0 ? '' : ' ') + atomToString(children[k]);
    }

    const lines = [head];
    for (; k < children.length; k++) {
      lines.push(childPad + serialize(children[k], indent + 1));
    }
    lines[lines.length - 1] += ')';
    return lines.join('\n');
  }

  function serializeDocument(root) {
    return serialize(root, 0) + '\n';
  }

  global.SExpr = {
    parse: parse,
    serialize: serialize,
    serializeDocument: serializeDocument,
    escapeString: escapeString,
  };
})(typeof window !== 'undefined' ? window : globalThis);
