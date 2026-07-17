// parts.js — built-in component symbol library for the "部品" placement tool.
//
// Each entry carries a KiCad-format lib_symbol definition (same S-expression
// syntax as a .kicad_sym file) plus placement metadata. Definitions are parsed
// and injected into the schematic's lib_symbols on first use, exactly like the
// power symbols in library.js, so saved files stay self-contained.

(function (global) {
  'use strict';

  // Two-pin passive drawn vertically (pins at top/bottom), like R/C/L.
  function passive2(name, value, bodyStyles, pinLen, pinY) {
    pinLen = pinLen || 1.27;
    pinY = pinY || 3.81;
    return '(symbol "Device:' + name + '" (pin_numbers hide) (pin_names (offset 0)' +
      (name === 'C' || name === 'CP' ? ' hide' : '') + ') (in_bom yes) (on_board yes)\n' +
      '  (property "Reference" "' + value.ref + '" (at 2.032 0 90) (effects (font (size 1.27 1.27))))\n' +
      '  (property "Value" "' + name + '" (at 0 0 90) (effects (font (size 1.27 1.27))))\n' +
      '  (symbol "' + name + '_0_1"\n' + bodyStyles + '  )\n' +
      '  (symbol "' + name + '_1_1"\n' +
      '    (pin passive line (at 0 ' + pinY + ' 270) (length ' + pinLen + ')\n' +
      '      (name "~" (effects (font (size 1.27 1.27)))) (number "1" (effects (font (size 1.27 1.27)))))\n' +
      '    (pin passive line (at 0 -' + pinY + ' 90) (length ' + pinLen + ')\n' +
      '      (name "~" (effects (font (size 1.27 1.27)))) (number "2" (effects (font (size 1.27 1.27)))))\n' +
      '  )\n)';
  }

  const R_BODY =
    '    (rectangle (start -1.016 -2.54) (end 1.016 2.54) (stroke (width 0.254) (type default)) (fill (type none)))\n';
  const C_BODY =
    '    (polyline (pts (xy -2.032 -0.762) (xy 2.032 -0.762)) (stroke (width 0.508) (type default)) (fill (type none)))\n' +
    '    (polyline (pts (xy -2.032 0.762) (xy 2.032 0.762)) (stroke (width 0.508) (type default)) (fill (type none)))\n';
  const CP_BODY =
    '    (rectangle (start -2.032 0.508) (end 2.032 1.016) (stroke (width 0) (type default)) (fill (type outline)))\n' +
    '    (rectangle (start -2.032 -1.016) (end 2.032 -0.508) (stroke (width 0.508) (type default)) (fill (type none)))\n' +
    '    (polyline (pts (xy -1.27 2.286) (xy -0.254 2.286)) (stroke (width 0) (type default)) (fill (type none)))\n' +
    '    (polyline (pts (xy -0.762 2.794) (xy -0.762 1.778)) (stroke (width 0) (type default)) (fill (type none)))\n';
  const L_BODY =
    '    (arc (start 0 -2.54) (mid 0.6323 -1.905) (end 0 -1.27) (stroke (width 0) (type default)) (fill (type none)))\n' +
    '    (arc (start 0 -1.27) (mid 0.6323 -0.635) (end 0 0) (stroke (width 0) (type default)) (fill (type none)))\n' +
    '    (arc (start 0 0) (mid 0.6323 0.635) (end 0 1.27) (stroke (width 0) (type default)) (fill (type none)))\n' +
    '    (arc (start 0 1.27) (mid 0.6323 1.905) (end 0 2.54) (stroke (width 0) (type default)) (fill (type none)))\n';

  const D_BODY =
    '    (polyline (pts (xy 1.27 1.27) (xy 1.27 -1.27)) (stroke (width 0.254) (type default)) (fill (type none)))\n' +
    '    (polyline (pts (xy -1.27 1.27) (xy 1.27 0) (xy -1.27 -1.27) (xy -1.27 1.27)) (stroke (width 0.254) (type default)) (fill (type none)))\n';
  const LED_EXTRA =
    '    (polyline (pts (xy -1.27 -2.032) (xy -0.254 -3.048)) (stroke (width 0) (type default)) (fill (type none)))\n' +
    '    (polyline (pts (xy 0.254 -2.032) (xy 1.27 -3.048)) (stroke (width 0) (type default)) (fill (type none)))\n' +
    '    (polyline (pts (xy -0.762 -2.794) (xy -0.254 -3.048) (xy -0.508 -2.54)) (stroke (width 0) (type default)) (fill (type none)))\n' +
    '    (polyline (pts (xy 0.762 -2.794) (xy 1.27 -3.048) (xy 1.016 -2.54)) (stroke (width 0) (type default)) (fill (type none)))\n';

  // Two-pin part drawn horizontally with pins left/right (D/LED/diodes).
  function diode(name, extra) {
    return '(symbol "Device:' + name + '" (pin_numbers hide) (pin_names (offset 1.016) hide) (in_bom yes) (on_board yes)\n' +
      '  (property "Reference" "D" (at 0 2.54 0) (effects (font (size 1.27 1.27))))\n' +
      '  (property "Value" "' + name + '" (at 0 -2.54 0) (effects (font (size 1.27 1.27))))\n' +
      '  (symbol "' + name + '_0_1"\n' + D_BODY + (extra || '') + '  )\n' +
      '  (symbol "' + name + '_1_1"\n' +
      '    (pin passive line (at -3.81 0 0) (length 2.54)\n' +
      '      (name "K" (effects (font (size 1.27 1.27)))) (number "1" (effects (font (size 1.27 1.27)))))\n' +
      '    (pin passive line (at 3.81 0 180) (length 2.54)\n' +
      '      (name "A" (effects (font (size 1.27 1.27)))) (number "2" (effects (font (size 1.27 1.27)))))\n' +
      '  )\n)';
  }

  // Zener: cathode bar gets small flags bent at both ends.
  const ZENER_EXTRA =
    '    (polyline (pts (xy 1.27 1.27) (xy 1.905 1.905)) (stroke (width 0.254) (type default)) (fill (type none)))\n' +
    '    (polyline (pts (xy 1.27 -1.27) (xy 0.635 -1.905)) (stroke (width 0.254) (type default)) (fill (type none)))\n';
  // Schottky: cathode bar gets small perpendicular tabs (S-shape flags).
  const SCHOTTKY_EXTRA =
    '    (polyline (pts (xy 1.27 1.27) (xy 1.27 0.635) (xy 1.905 0.635)) (stroke (width 0.254) (type default)) (fill (type none)))\n' +
    '    (polyline (pts (xy 1.27 -1.27) (xy 1.27 -0.635) (xy 0.635 -0.635)) (stroke (width 0.254) (type default)) (fill (type none)))\n';

  // Three-terminal linear regulator: box with IN/OUT pins left/right, GND down.
  const REG_DEF =
    '(symbol "Regulator_Linear:LM7805" (pin_names (offset 0.762)) (in_bom yes) (on_board yes)\n' +
    '  (property "Reference" "U" (at 0 3.556 0) (effects (font (size 1.27 1.27))))\n' +
    '  (property "Value" "LM7805" (at 0 -3.556 0) (effects (font (size 1.27 1.27))))\n' +
    '  (symbol "LM7805_0_1"\n' +
    '    (rectangle (start -5.08 -2.54) (end 5.08 2.54) (stroke (width 0.254) (type default)) (fill (type background)))\n' +
    '  )\n' +
    '  (symbol "LM7805_1_1"\n' +
    '    (pin input line (at -7.62 0 0) (length 2.54) (name "IN" (effects (font (size 1.27 1.27)))) (number "1" (effects (font (size 1.27 1.27)))))\n' +
    '    (pin output line (at 7.62 0 180) (length 2.54) (name "OUT" (effects (font (size 1.27 1.27)))) (number "2" (effects (font (size 1.27 1.27)))))\n' +
    '    (pin power_in line (at 0 -5.08 90) (length 2.54) (name "GND" (effects (font (size 1.27 1.27)))) (number "3" (effects (font (size 1.27 1.27)))))\n' +
    '  )\n)';

  // Two-pin crystal: box body with a plate line on each side, pins left/right.
  const XTAL_DEF =
    '(symbol "Device:Crystal" (pin_names (offset 1.016)) (in_bom yes) (on_board yes)\n' +
    '  (property "Reference" "Y" (at 0 2.54 0) (effects (font (size 1.27 1.27))))\n' +
    '  (property "Value" "Crystal" (at 0 -2.54 0) (effects (font (size 1.27 1.27))))\n' +
    '  (symbol "Crystal_0_1"\n' +
    '    (rectangle (start -1.27 -1.905) (end 1.27 1.905) (stroke (width 0.254) (type default)) (fill (type none)))\n' +
    '    (polyline (pts (xy -2.286 -1.905) (xy -2.286 1.905)) (stroke (width 0.254) (type default)) (fill (type none)))\n' +
    '    (polyline (pts (xy 2.286 -1.905) (xy 2.286 1.905)) (stroke (width 0.254) (type default)) (fill (type none)))\n' +
    '  )\n' +
    '  (symbol "Crystal_1_1"\n' +
    '    (pin passive line (at -3.81 0 0) (length 1.524) (name "1" (effects (font (size 1.27 1.27)))) (number "1" (effects (font (size 1.27 1.27)))))\n' +
    '    (pin passive line (at 3.81 0 180) (length 1.524) (name "2" (effects (font (size 1.27 1.27)))) (number "2" (effects (font (size 1.27 1.27)))))\n' +
    '  )\n)';

  const FERRITE_BODY =
    '    (rectangle (start -2.54 -1.27) (end 2.54 1.27) (stroke (width 0.254) (type default)) (fill (type none)))\n' +
    '    (polyline (pts (xy -1.397 -1.27) (xy -1.905 1.27)) (stroke (width 0.254) (type default)) (fill (type none)))\n' +
    '    (polyline (pts (xy 0.508 -1.27) (xy 0 1.27)) (stroke (width 0.254) (type default)) (fill (type none)))\n' +
    '    (polyline (pts (xy 2.413 -1.27) (xy 1.905 1.27)) (stroke (width 0.254) (type default)) (fill (type none)))\n';

  // Ferrite bead: horizontal 2-pin part (left/right), distinct from passive2's vertical layout.
  const FERRITE_DEF =
    '(symbol "Device:Ferrite_Bead" (pin_numbers hide) (pin_names (offset 0.254)) (in_bom yes) (on_board yes)\n' +
    '  (property "Reference" "FB" (at 0 2.54 0) (effects (font (size 1.27 1.27))))\n' +
    '  (property "Value" "Ferrite_Bead" (at 0 -2.54 0) (effects (font (size 1.27 1.27))))\n' +
    '  (symbol "Ferrite_Bead_0_1"\n' + FERRITE_BODY + '  )\n' +
    '  (symbol "Ferrite_Bead_1_1"\n' +
    '    (pin passive line (at -5.08 0 0) (length 2.54) (name "1" (effects (font (size 1.27 1.27)))) (number "1" (effects (font (size 1.27 1.27)))))\n' +
    '    (pin passive line (at 5.08 0 180) (length 2.54) (name "2" (effects (font (size 1.27 1.27)))) (number "2" (effects (font (size 1.27 1.27)))))\n' +
    '  )\n)';

  // Fuse: same vertical body shape as passive2's rectangle, but its own lib entry.
  const FUSE_BODY =
    '    (rectangle (start -0.762 -2.54) (end 0.762 2.54) (stroke (width 0.254) (type default)) (fill (type none)))\n' +
    '    (polyline (pts (xy 0 -2.54) (xy 0 2.54)) (stroke (width 0) (type default)) (fill (type none)))\n';

  // Relay SPDT: coil (2 pins, left) drawn as an inductor arcs, common+NC+NO contacts (right).
  const RELAY_DEF =
    '(symbol "Relay:Relay_SPDT" (pin_names (offset 0.508)) (in_bom yes) (on_board yes)\n' +
    '  (property "Reference" "K" (at -2.54 6.35 0) (effects (font (size 1.27 1.27))))\n' +
    '  (property "Value" "Relay_SPDT" (at -2.54 -6.35 0) (effects (font (size 1.27 1.27))))\n' +
    '  (symbol "Relay_SPDT_0_1"\n' +
    '    (rectangle (start -5.08 -5.08) (end 0 5.08) (stroke (width 0.254) (type default)) (fill (type none)))\n' +
    '    (circle (center 3.81 2.54) (radius 0.508) (stroke (width 0) (type default)) (fill (type none)))\n' +
    '    (circle (center 3.81 -2.54) (radius 0.508) (stroke (width 0) (type default)) (fill (type none)))\n' +
    '    (polyline (pts (xy 4.318 2.667) (xy 4.318 -1.905)) (stroke (width 0) (type default)) (fill (type none)))\n' +
    '    (polyline (pts (xy 3.302 -1.905) (xy 6.35 -1.905)) (stroke (width 0) (type default)) (fill (type none)))\n' +
    '    (polyline (pts (xy 3.302 2.54) (xy 6.35 2.54)) (stroke (width 0) (type default)) (fill (type none)))\n' +
    '  )\n' +
    '  (symbol "Relay_SPDT_1_1"\n' +
    '    (pin passive line (at -7.62 2.54 0) (length 2.54) (name "Coil+" (effects (font (size 1.27 1.27)))) (number "1" (effects (font (size 1.27 1.27)))))\n' +
    '    (pin passive line (at -7.62 -2.54 0) (length 2.54) (name "Coil-" (effects (font (size 1.27 1.27)))) (number "2" (effects (font (size 1.27 1.27)))))\n' +
    '    (pin passive line (at 8.89 2.54 180) (length 2.54) (name "COM" (effects (font (size 1.27 1.27)))) (number "3" (effects (font (size 1.27 1.27)))))\n' +
    '    (pin passive line (at 8.89 -1.905 180) (length 2.54) (name "NO" (effects (font (size 1.27 1.27)))) (number "4" (effects (font (size 1.27 1.27)))))\n' +
    '    (pin passive line (at 8.89 -5.08 180) (length 2.54) (name "NC" (effects (font (size 1.27 1.27)))) (number "5" (effects (font (size 1.27 1.27)))))\n' +
    '  )\n)';

  // Buzzer: rounded body approximated as a circle with a stem, 2 pins below.
  const BUZZER_DEF =
    '(symbol "Buzzer:Buzzer" (pin_names (offset 1.016)) (in_bom yes) (on_board yes)\n' +
    '  (property "Reference" "BZ" (at -3.81 3.556 0) (effects (font (size 1.27 1.27))))\n' +
    '  (property "Value" "Buzzer" (at -3.81 -3.81 0) (effects (font (size 1.27 1.27))))\n' +
    '  (symbol "Buzzer_0_1"\n' +
    '    (circle (center -1.27 0) (radius 2.54) (stroke (width 0.254) (type default)) (fill (type none)))\n' +
    '    (polyline (pts (xy -1.27 -2.54) (xy -1.27 -3.556) (xy 1.27 -3.556) (xy 1.27 -2.032))\n' +
    '      (stroke (width 0.254) (type default)) (fill (type none)))\n' +
    '  )\n' +
    '  (symbol "Buzzer_1_1"\n' +
    '    (pin passive line (at -1.27 -6.35 90) (length 2.794) (name "1" (effects (font (size 1.27 1.27)))) (number "1" (effects (font (size 1.27 1.27)))))\n' +
    '    (pin passive line (at 1.27 -6.35 90) (length 2.794) (name "2" (effects (font (size 1.27 1.27)))) (number "2" (effects (font (size 1.27 1.27)))))\n' +
    '  )\n)';

  // Test point: a single pin with an open circle target.
  const TESTPOINT_DEF =
    '(symbol "Connector:TestPoint" (pin_names (offset 0.762) hide) (in_bom yes) (on_board yes)\n' +
    '  (property "Reference" "TP" (at 0 3.048 0) (effects (font (size 1.27 1.27))))\n' +
    '  (property "Value" "TestPoint" (at 0 -3.048 0) (effects (font (size 1.27 1.27))))\n' +
    '  (symbol "TestPoint_0_1"\n' +
    '    (circle (center 0 1.27) (radius 0.762) (stroke (width 0.254) (type default)) (fill (type none)))\n' +
    '  )\n' +
    '  (symbol "TestPoint_1_1"\n' +
    '    (pin passive line (at 0 0 90) (length 0.508) (name "1" (effects (font (size 1.27 1.27)))) (number "1" (effects (font (size 1.27 1.27)))))\n' +
    '  )\n)';

  // Two-input logic gate. `shape` selects the body outline; `invert` adds a
  // small bubble on the output for NAND/NOR/NOT.
  function gate2(name, bodyPolyline, invert) {
    const outLen = invert ? 1.778 : 2.54;
    const bubble = invert
      ? '    (circle (center 3.048 0) (radius 0.508) (stroke (width 0.254) (type default)) (fill (type none)))\n'
      : '';
    return '(symbol "74xx:' + name + '" (pin_names (offset 0.508) hide) (in_bom yes) (on_board yes)\n' +
      '  (property "Reference" "U" (at 0 3.81 0) (effects (font (size 1.27 1.27))))\n' +
      '  (property "Value" "' + name + '" (at 0 -3.81 0) (effects (font (size 1.27 1.27))))\n' +
      '  (symbol "' + name + '_0_1"\n' + bodyPolyline + bubble + '  )\n' +
      '  (symbol "' + name + '_1_1"\n' +
      '    (pin input line (at -5.08 1.27 0) (length 2.54) (name "A" (effects (font (size 1.27 1.27)))) (number "1" (effects (font (size 1.27 1.27)))))\n' +
      '    (pin input line (at -5.08 -1.27 0) (length 2.54) (name "B" (effects (font (size 1.27 1.27)))) (number "2" (effects (font (size 1.27 1.27)))))\n' +
      '    (pin output line (at ' + fmtNum(2.54 + outLen) + ' 0 180) (length ' + outLen + ') (name "Y" (effects (font (size 1.27 1.27)))) (number "3" (effects (font (size 1.27 1.27)))))\n' +
      '  )\n)';
  }

  // Single-input gate (NOT / inverter).
  function gate1(name, bodyPolyline) {
    return '(symbol "74xx:' + name + '" (pin_names (offset 0.508) hide) (in_bom yes) (on_board yes)\n' +
      '  (property "Reference" "U" (at 0 3.81 0) (effects (font (size 1.27 1.27))))\n' +
      '  (property "Value" "' + name + '" (at 0 -3.81 0) (effects (font (size 1.27 1.27))))\n' +
      '  (symbol "' + name + '_0_1"\n' + bodyPolyline +
      '    (circle (center 3.048 0) (radius 0.508) (stroke (width 0.254) (type default)) (fill (type none)))\n' +
      '  )\n' +
      '  (symbol "' + name + '_1_1"\n' +
      '    (pin input line (at -5.08 0 0) (length 2.54) (name "A" (effects (font (size 1.27 1.27)))) (number "1" (effects (font (size 1.27 1.27)))))\n' +
      '    (pin output line (at 5.334 0 180) (length 1.778) (name "Y" (effects (font (size 1.27 1.27)))) (number "2" (effects (font (size 1.27 1.27)))))\n' +
      '  )\n)';
  }

  // AND/NAND: flat-back D shape (rectangle + semicircle nose).
  const AND_BODY =
    '    (polyline (pts (xy -2.54 2.54) (xy 0 2.54)) (stroke (width 0.254) (type default)) (fill (type none)))\n' +
    '    (polyline (pts (xy -2.54 -2.54) (xy 0 -2.54)) (stroke (width 0.254) (type default)) (fill (type none)))\n' +
    '    (polyline (pts (xy -2.54 2.54) (xy -2.54 -2.54)) (stroke (width 0.254) (type default)) (fill (type none)))\n' +
    '    (arc (start 0 2.54) (mid 2.54 0) (end 0 -2.54) (stroke (width 0.254) (type default)) (fill (type none)))\n';
  // OR/NOR: curved-back shield shape approximated with arcs.
  const OR_BODY =
    '    (arc (start -2.54 2.54) (mid -1.651 0) (end -2.54 -2.54) (stroke (width 0.254) (type default)) (fill (type none)))\n' +
    '    (arc (start -2.54 2.54) (mid 0.508 1.27) (end 2.54 0) (stroke (width 0.254) (type default)) (fill (type none)))\n' +
    '    (arc (start -2.54 -2.54) (mid 0.508 -1.27) (end 2.54 0) (stroke (width 0.254) (type default)) (fill (type none)))\n';
  // NOT/buffer: a plain triangle.
  const TRI_BODY =
    '    (polyline (pts (xy -2.54 2.54) (xy -2.54 -2.54) (xy 2.54 0) (xy -2.54 2.54)) (stroke (width 0.254) (type default)) (fill (type none)))\n';

  const NPN_DEF =
    '(symbol "Transistor_BJT:Q_NPN_BCE" (pin_names (offset 0)) (in_bom yes) (on_board yes)\n' +
    '  (property "Reference" "Q" (at 5.08 1.27 0) (effects (font (size 1.27 1.27)) (justify left)))\n' +
    '  (property "Value" "Q_NPN_BCE" (at 5.08 -1.27 0) (effects (font (size 1.27 1.27)) (justify left)))\n' +
    '  (symbol "Q_NPN_BCE_0_1"\n' +
    '    (polyline (pts (xy 0.635 0.635) (xy 2.54 2.54)) (stroke (width 0) (type default)) (fill (type none)))\n' +
    '    (polyline (pts (xy 0.635 -0.635) (xy 2.54 -2.54)) (stroke (width 0) (type default)) (fill (type none)))\n' +
    '    (polyline (pts (xy 0.635 1.905) (xy 0.635 -1.905)) (stroke (width 0.254) (type default)) (fill (type none)))\n' +
    '    (polyline (pts (xy 1.778 -1.322) (xy 2.54 -2.54) (xy 1.322 -1.778) (xy 1.778 -1.322)) (stroke (width 0) (type default)) (fill (type outline)))\n' +
    '    (circle (center 1.27 0) (radius 2.8194) (stroke (width 0.254) (type default)) (fill (type none)))\n' +
    '  )\n' +
    '  (symbol "Q_NPN_BCE_1_1"\n' +
    '    (pin input line (at -3.81 0 0) (length 4.445) (name "B" (effects (font (size 1.27 1.27)))) (number "1" (effects (font (size 1.27 1.27)))))\n' +
    '    (pin passive line (at 2.54 5.08 270) (length 2.54) (name "C" (effects (font (size 1.27 1.27)))) (number "2" (effects (font (size 1.27 1.27)))))\n' +
    '    (pin passive line (at 2.54 -5.08 90) (length 2.54) (name "E" (effects (font (size 1.27 1.27)))) (number "3" (effects (font (size 1.27 1.27)))))\n' +
    '  )\n)';

  // PNP: same outline as NPN but the emitter arrow points inward (toward the base).
  const PNP_DEF =
    '(symbol "Transistor_BJT:Q_PNP_BCE" (pin_names (offset 0)) (in_bom yes) (on_board yes)\n' +
    '  (property "Reference" "Q" (at 5.08 1.27 0) (effects (font (size 1.27 1.27)) (justify left)))\n' +
    '  (property "Value" "Q_PNP_BCE" (at 5.08 -1.27 0) (effects (font (size 1.27 1.27)) (justify left)))\n' +
    '  (symbol "Q_PNP_BCE_0_1"\n' +
    '    (polyline (pts (xy 0.635 0.635) (xy 2.54 2.54)) (stroke (width 0) (type default)) (fill (type none)))\n' +
    '    (polyline (pts (xy 0.635 -0.635) (xy 2.54 -2.54)) (stroke (width 0) (type default)) (fill (type none)))\n' +
    '    (polyline (pts (xy 0.635 1.905) (xy 0.635 -1.905)) (stroke (width 0.254) (type default)) (fill (type none)))\n' +
    '    (polyline (pts (xy 1.203 1.983) (xy 0.635 2.54) (xy 1.968 2.821) (xy 1.203 1.983)) (stroke (width 0) (type default)) (fill (type outline)))\n' +
    '    (circle (center 1.27 0) (radius 2.8194) (stroke (width 0.254) (type default)) (fill (type none)))\n' +
    '  )\n' +
    '  (symbol "Q_PNP_BCE_1_1"\n' +
    '    (pin input line (at -3.81 0 0) (length 4.445) (name "B" (effects (font (size 1.27 1.27)))) (number "1" (effects (font (size 1.27 1.27)))))\n' +
    '    (pin passive line (at 2.54 5.08 270) (length 2.54) (name "C" (effects (font (size 1.27 1.27)))) (number "2" (effects (font (size 1.27 1.27)))))\n' +
    '    (pin passive line (at 2.54 -5.08 90) (length 2.54) (name "E" (effects (font (size 1.27 1.27)))) (number "3" (effects (font (size 1.27 1.27)))))\n' +
    '  )\n)';

  // MOSFET (N/P channel): gate on the left, drain/source vertical on the right
  // with a gap (insulated gate) and an arrow on the source showing polarity.
  function mosfet(name, arrowUp) {
    const arrow = arrowUp
      ? '    (polyline (pts (xy 1.397 -1.524) (xy 2.54 -2.286) (xy 1.397 -3.048) (xy 1.397 -1.524)) (stroke (width 0) (type default)) (fill (type outline)))\n'
      : '    (polyline (pts (xy 1.397 1.524) (xy 2.54 2.286) (xy 1.397 3.048) (xy 1.397 1.524)) (stroke (width 0) (type default)) (fill (type outline)))\n';
    return '(symbol "Transistor_FET:' + name + '" (pin_names (offset 0)) (in_bom yes) (on_board yes)\n' +
      '  (property "Reference" "Q" (at 6.35 0 0) (effects (font (size 1.27 1.27)) (justify left)))\n' +
      '  (property "Value" "' + name + '" (at 6.35 -2.54 0) (effects (font (size 1.27 1.27)) (justify left)))\n' +
      '  (symbol "' + name + '_0_1"\n' +
      '    (polyline (pts (xy 1.27 2.54) (xy 1.27 -2.54)) (stroke (width 0.254) (type default)) (fill (type none)))\n' +
      '    (polyline (pts (xy 1.27 1.905) (xy 5.08 1.905) (xy 5.08 5.08)) (stroke (width 0) (type default)) (fill (type none)))\n' +
      '    (polyline (pts (xy 1.27 -1.905) (xy 5.08 -1.905) (xy 5.08 -5.08)) (stroke (width 0) (type default)) (fill (type none)))\n' +
      arrow +
      '    (polyline (pts (xy 0 3.81) (xy 0 -3.81)) (stroke (width 0.762) (type default)) (fill (type none)))\n' +
      '    (circle (center 2.54 0) (radius 3.683) (stroke (width 0.254) (type default)) (fill (type none)))\n' +
      '  )\n' +
      '  (symbol "' + name + '_1_1"\n' +
      '    (pin input line (at -5.08 0 0) (length 5.08) (name "G" (effects (font (size 1.27 1.27)))) (number "1" (effects (font (size 1.27 1.27)))))\n' +
      '    (pin passive line (at 5.08 7.62 270) (length 2.54) (name "D" (effects (font (size 1.27 1.27)))) (number "2" (effects (font (size 1.27 1.27)))))\n' +
      '    (pin passive line (at 5.08 -7.62 90) (length 2.54) (name "S" (effects (font (size 1.27 1.27)))) (number "3" (effects (font (size 1.27 1.27)))))\n' +
      '  )\n)';
  }

  const OPAMP_DEF =
    '(symbol "Amplifier_Operational:OpAmp" (pin_names (offset 0.127) hide) (in_bom yes) (on_board yes)\n' +
    '  (property "Reference" "U" (at 0 5.08 0) (effects (font (size 1.27 1.27))))\n' +
    '  (property "Value" "OpAmp" (at 0 -5.08 0) (effects (font (size 1.27 1.27))))\n' +
    '  (symbol "OpAmp_0_1"\n' +
    '    (polyline (pts (xy 5.08 0) (xy -5.08 5.08) (xy -5.08 -5.08) (xy 5.08 0)) (stroke (width 0.254) (type default)) (fill (type background)))\n' +
    '    (polyline (pts (xy -2.54 2.54) (xy -3.81 2.54)) (stroke (width 0) (type default)) (fill (type none)))\n' +
    '    (polyline (pts (xy -2.54 -1.905) (xy -3.81 -1.905)) (stroke (width 0) (type default)) (fill (type none)))\n' +
    '    (polyline (pts (xy -3.175 -1.27) (xy -3.175 -2.54)) (stroke (width 0) (type default)) (fill (type none)))\n' +
    '    (polyline (pts (xy -3.175 3.175) (xy -3.175 1.905)) (stroke (width 0) (type default)) (fill (type none)))\n' +
    '  )\n' +
    '  (symbol "OpAmp_1_1"\n' +
    '    (pin output line (at 7.62 0 180) (length 2.54) (name "~" (effects (font (size 1.27 1.27)))) (number "1" (effects (font (size 1.27 1.27)))))\n' +
    '    (pin input line (at -7.62 -2.54 0) (length 2.54) (name "-" (effects (font (size 1.27 1.27)))) (number "2" (effects (font (size 1.27 1.27)))))\n' +
    '    (pin input line (at -7.62 2.54 0) (length 2.54) (name "+" (effects (font (size 1.27 1.27)))) (number "3" (effects (font (size 1.27 1.27)))))\n' +
    '  )\n)';

  // A generic single-row pin-header connector with `n` pins.
  function connector(n) {
    let body = '';
    let pins = '';
    const top = (n - 1) * 2.54 / 2 + 2.54;
    for (let i = 0; i < n; i++) {
      const y = top - 2.54 - i * 2.54;
      body += '    (rectangle (start -1.27 ' + fmtNum(y + 1.016) + ') (end 0 ' + fmtNum(y - 1.016) + ') (stroke (width 0.1524) (type default)) (fill (type none)))\n';
      pins += '    (pin passive line (at -5.08 ' + fmtNum(y) + ' 0) (length 3.81) (name "Pin_' + (i + 1) + '" (effects (font (size 1.27 1.27)))) (number "' + (i + 1) + '" (effects (font (size 1.27 1.27)))))\n';
    }
    return '(symbol "Connector:Conn_01x' + pad2(n) + '" (pin_names (offset 1.016) hide) (in_bom yes) (on_board yes)\n' +
      '  (property "Reference" "J" (at 0 ' + fmtNum(top + 1.27) + ' 0) (effects (font (size 1.27 1.27))))\n' +
      '  (property "Value" "Conn_01x' + pad2(n) + '" (at 0 ' + fmtNum(-top - 1.27) + ' 0) (effects (font (size 1.27 1.27))))\n' +
      '  (symbol "Conn_01x' + pad2(n) + '_1_1"\n' + body + pins + '  )\n)';
  }

  const SW_DEF =
    '(symbol "Switch:SW_Push" (pin_names (offset 1.016) hide) (in_bom yes) (on_board yes)\n' +
    '  (property "Reference" "SW" (at 0 3.81 0) (effects (font (size 1.27 1.27))))\n' +
    '  (property "Value" "SW_Push" (at 0 -2.54 0) (effects (font (size 1.27 1.27))))\n' +
    '  (symbol "SW_Push_0_1"\n' +
    '    (circle (center -2.032 0) (radius 0.508) (stroke (width 0) (type default)) (fill (type none)))\n' +
    '    (circle (center 2.032 0) (radius 0.508) (stroke (width 0) (type default)) (fill (type none)))\n' +
    '    (polyline (pts (xy 0 1.27) (xy 0 2.54)) (stroke (width 0) (type default)) (fill (type none)))\n' +
    '    (polyline (pts (xy -2.032 0.508) (xy 2.032 1.524)) (stroke (width 0) (type default)) (fill (type none)))\n' +
    '  )\n' +
    '  (symbol "SW_Push_1_1"\n' +
    '    (pin passive line (at -5.08 0 0) (length 2.54) (name "1" (effects (font (size 1.27 1.27)))) (number "1" (effects (font (size 1.27 1.27)))))\n' +
    '    (pin passive line (at 5.08 0 180) (length 2.54) (name "2" (effects (font (size 1.27 1.27)))) (number "2" (effects (font (size 1.27 1.27)))))\n' +
    '  )\n)';

  function fmtNum(n) {
    let s = n.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
    return s === '-0' ? '0' : s;
  }
  function pad2(n) { return n < 10 ? '0' + n : '' + n; }

  // libId -> { def, value (default), ref (prefix), label (menu text) }
  const PARTS = {
    // --- passives ---
    'Device:R':   { def: passive2('R', { ref: 'R' }, R_BODY),   value: 'R',    ref: 'R', label: 'R 抵抗' },
    'Device:C':   { def: passive2('C', { ref: 'C' }, C_BODY, 2.794), value: 'C', ref: 'C', label: 'C コンデンサ' },
    'Device:CP':  { def: passive2('CP', { ref: 'C' }, CP_BODY, 2.794), value: 'C', ref: 'C', label: 'CP 電解コンデンサ' },
    'Device:L':   { def: passive2('L', { ref: 'L' }, L_BODY),   value: 'L',    ref: 'L', label: 'L インダクタ' },
    'Device:Ferrite_Bead': { def: FERRITE_DEF, value: 'Ferrite_Bead', ref: 'FB', label: 'フェライトビーズ' },
    'Device:Fuse': { def: passive2('Fuse', { ref: 'F' }, FUSE_BODY), value: 'Fuse', ref: 'F', label: 'ヒューズ' },
    'Device:Crystal': { def: XTAL_DEF, value: 'Crystal', ref: 'Y', label: '水晶発振子' },

    // --- diodes ---
    'Device:D':   { def: diode('D'),         value: 'D',   ref: 'D', label: 'D ダイオード' },
    'Device:LED': { def: diode('LED', LED_EXTRA), value: 'LED', ref: 'D', label: 'LED' },
    'Device:D_Zener': { def: diode('D_Zener', ZENER_EXTRA), value: 'D_Zener', ref: 'D', label: 'ツェナーダイオード' },
    'Device:D_Schottky': { def: diode('D_Schottky', SCHOTTKY_EXTRA), value: 'D_Schottky', ref: 'D', label: 'ショットキーダイオード' },

    // --- transistors / regulators ---
    'Transistor_BJT:Q_NPN_BCE': { def: NPN_DEF, value: 'Q_NPN_BCE', ref: 'Q', label: 'NPN トランジスタ' },
    'Transistor_BJT:Q_PNP_BCE': { def: PNP_DEF, value: 'Q_PNP_BCE', ref: 'Q', label: 'PNP トランジスタ' },
    'Transistor_FET:Q_NMOS_GSD': { def: mosfet('Q_NMOS_GSD', false), value: 'Q_NMOS_GSD', ref: 'Q', label: 'N-MOSFET' },
    'Transistor_FET:Q_PMOS_GSD': { def: mosfet('Q_PMOS_GSD', true), value: 'Q_PMOS_GSD', ref: 'Q', label: 'P-MOSFET' },
    'Regulator_Linear:LM7805': { def: REG_DEF, value: 'LM7805', ref: 'U', label: '3端子レギュレータ' },
    'Amplifier_Operational:OpAmp': { def: OPAMP_DEF, value: 'OpAmp', ref: 'U', label: 'オペアンプ' },

    // --- logic gates ---
    '74xx:AND2':  { def: gate2('AND2', AND_BODY, false), value: 'AND2',  ref: 'U', label: 'AND ゲート' },
    '74xx:NAND2': { def: gate2('NAND2', AND_BODY, true),  value: 'NAND2', ref: 'U', label: 'NAND ゲート' },
    '74xx:OR2':   { def: gate2('OR2', OR_BODY, false),   value: 'OR2',   ref: 'U', label: 'OR ゲート' },
    '74xx:NOT1':  { def: gate1('NOT1', TRI_BODY),        value: 'NOT1',  ref: 'U', label: 'NOT (インバータ)' },

    // --- electromechanical ---
    'Switch:SW_Push': { def: SW_DEF, value: 'SW_Push', ref: 'SW', label: 'プッシュスイッチ' },
    'Relay:Relay_SPDT': { def: RELAY_DEF, value: 'Relay_SPDT', ref: 'K', label: 'リレー (SPDT)' },
    'Buzzer:Buzzer': { def: BUZZER_DEF, value: 'Buzzer', ref: 'BZ', label: 'ブザー' },

    // --- connectors ---
    'Connector:Conn_01x02': { def: connector(2), value: 'Conn_01x02', ref: 'J', label: 'コネクタ 2ピン' },
    'Connector:Conn_01x03': { def: connector(3), value: 'Conn_01x03', ref: 'J', label: 'コネクタ 3ピン' },
    'Connector:Conn_01x04': { def: connector(4), value: 'Conn_01x04', ref: 'J', label: 'コネクタ 4ピン' },
    'Connector:Conn_01x05': { def: connector(5), value: 'Conn_01x05', ref: 'J', label: 'コネクタ 5ピン' },
    'Connector:Conn_01x06': { def: connector(6), value: 'Conn_01x06', ref: 'J', label: 'コネクタ 6ピン' },
    'Connector:Conn_01x08': { def: connector(8), value: 'Conn_01x08', ref: 'J', label: 'コネクタ 8ピン' },
    'Connector:Conn_01x10': { def: connector(10), value: 'Conn_01x10', ref: 'J', label: 'コネクタ 10ピン' },
    'Connector:TestPoint': { def: TESTPOINT_DEF, value: 'TestPoint', ref: 'TP', label: 'テストポイント' },
  };

  // Menu order, grouped by category.
  const ORDER = [
    'Device:R', 'Device:C', 'Device:CP', 'Device:L', 'Device:Ferrite_Bead', 'Device:Fuse', 'Device:Crystal',
    'Device:D', 'Device:LED', 'Device:D_Zener', 'Device:D_Schottky',
    'Transistor_BJT:Q_NPN_BCE', 'Transistor_BJT:Q_PNP_BCE',
    'Transistor_FET:Q_NMOS_GSD', 'Transistor_FET:Q_PMOS_GSD',
    'Regulator_Linear:LM7805', 'Amplifier_Operational:OpAmp',
    '74xx:AND2', '74xx:NAND2', '74xx:OR2', '74xx:NOT1',
    'Switch:SW_Push', 'Relay:Relay_SPDT', 'Buzzer:Buzzer',
    'Connector:Conn_01x02', 'Connector:Conn_01x03', 'Connector:Conn_01x04',
    'Connector:Conn_01x05', 'Connector:Conn_01x06', 'Connector:Conn_01x08',
    'Connector:Conn_01x10', 'Connector:TestPoint',
  ];

  global.KiParts = { PARTS: PARTS, ORDER: ORDER };
})(typeof window !== 'undefined' ? window : globalThis);
