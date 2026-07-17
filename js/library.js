// library.js — built-in power symbol definitions for the place-power tool.
//
// When the user places a power symbol into a schematic whose `lib_symbols`
// does not yet contain the definition, the matching def below is parsed and
// inserted so the file stays self-contained (as KiCad requires).

(function (global) {
  'use strict';

  // Arrow-with-stem style used by KiCad's up-pointing power rails.
  function upPowerDef(name) {
    return '(symbol "power:' + name + '" (power) (pin_names (offset 0)) (in_bom yes) (on_board yes)\n' +
      '  (property "Reference" "#PWR" (at 0 -3.81 0) (effects (font (size 1.27 1.27)) hide))\n' +
      '  (property "Value" "' + name + '" (at 0 3.556 0) (effects (font (size 1.27 1.27))))\n' +
      '  (symbol "' + name + '_0_1"\n' +
      '    (polyline (pts (xy -0.762 1.27) (xy 0 2.54) (xy 0.762 1.27))\n' +
      '      (stroke (width 0) (type default)) (fill (type none)))\n' +
      '    (polyline (pts (xy 0 0) (xy 0 2.54))\n' +
      '      (stroke (width 0) (type default)) (fill (type none)))\n' +
      '  )\n' +
      '  (symbol "' + name + '_1_1"\n' +
      '    (pin power_in line (at 0 0 90) (length 0) hide\n' +
      '      (name "' + name + '" (effects (font (size 1.27 1.27))))\n' +
      '      (number "1" (effects (font (size 1.27 1.27)))))\n' +
      '  )\n' +
      ')';
  }

  const GND_DEF =
    '(symbol "power:GND" (power) (pin_names (offset 0)) (in_bom yes) (on_board yes)\n' +
    '  (property "Reference" "#PWR" (at 0 -6.35 0) (effects (font (size 1.27 1.27)) hide))\n' +
    '  (property "Value" "GND" (at 0 -3.81 0) (effects (font (size 1.27 1.27))))\n' +
    '  (symbol "GND_0_1"\n' +
    '    (polyline (pts (xy 0 0) (xy 0 -1.27) (xy 1.27 -1.27) (xy 0 -2.54) (xy -1.27 -1.27) (xy 0 -1.27))\n' +
    '      (stroke (width 0) (type default)) (fill (type none)))\n' +
    '  )\n' +
    '  (symbol "GND_1_1"\n' +
    '    (pin power_in line (at 0 0 270) (length 0) hide\n' +
    '      (name "GND" (effects (font (size 1.27 1.27))))\n' +
    '      (number "1" (effects (font (size 1.27 1.27)))))\n' +
    '  )\n' +
    ')';

  // valueDy / refDy: world-mm offsets from the anchor for the instance's
  // Value / Reference field positions (GND hangs below, rails sit above).
  const POWER = {
    'power:GND':  { def: GND_DEF,            valueDy: 4.826,  refDy: 6.35 },
    'power:+5V':  { def: upPowerDef('+5V'),  valueDy: -3.556, refDy: -5.08 },
    'power:+3V3': { def: upPowerDef('+3V3'), valueDy: -3.556, refDy: -5.08 },
    'power:+12V': { def: upPowerDef('+12V'), valueDy: -3.556, refDy: -5.08 },
    'power:VCC':  { def: upPowerDef('VCC'),  valueDy: -3.556, refDy: -5.08 },
  };

  // Heads that belong to the file header — a created lib_symbols goes after them.
  const META_HEADS = ['version', 'generator', 'generator_version', 'uuid', 'paper', 'title_block'];

  // Make sure `libId` exists in the schematic's lib_symbols; returns its meta.
  function ensurePower(schem, libId) {
    const meta = POWER[libId];
    if (!meta) return null;
    if (!schem.libSymbols[libId]) {
      const M = global.KiModel;
      const node = global.SExpr.parse(meta.def);
      let lib = M.firstChild(schem.root, 'lib_symbols');
      if (!lib) {
        lib = { kind: 'list', children: [{ kind: 'atom', value: 'lib_symbols', quoted: false }] };
        let idx = schem.root.children.length;
        for (let i = 1; i < schem.root.children.length; i++) {
          const h = M.head(schem.root.children[i]);
          if (h && META_HEADS.indexOf(h) < 0) { idx = i; break; }
        }
        schem.root.children.splice(idx, 0, lib);
      }
      lib.children.push(node);
      schem.registerLibSymbol(node);
    }
    return meta;
  }

  global.KiLibrary = {
    POWER: POWER,
    ensurePower: ensurePower,
  };
})(typeof window !== 'undefined' ? window : globalThis);
