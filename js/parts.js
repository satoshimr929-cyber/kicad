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
    'Device:R':   { def: passive2('R', { ref: 'R' }, R_BODY),   value: 'R',    ref: 'R', label: 'R 抵抗' },
    'Device:C':   { def: passive2('C', { ref: 'C' }, C_BODY, 2.794), value: 'C', ref: 'C', label: 'C コンデンサ' },
    'Device:CP':  { def: passive2('CP', { ref: 'C' }, CP_BODY, 2.794), value: 'C', ref: 'C', label: 'CP 電解コンデンサ' },
    'Device:L':   { def: passive2('L', { ref: 'L' }, L_BODY),   value: 'L',    ref: 'L', label: 'L インダクタ' },
    'Device:D':   { def: diode('D'),         value: 'D',   ref: 'D', label: 'D ダイオード' },
    'Device:LED': { def: diode('LED', LED_EXTRA), value: 'LED', ref: 'D', label: 'LED' },
    'Transistor_BJT:Q_NPN_BCE': { def: NPN_DEF, value: 'Q_NPN_BCE', ref: 'Q', label: 'Q NPNトランジスタ' },
    'Amplifier_Operational:OpAmp': { def: OPAMP_DEF, value: 'OpAmp', ref: 'U', label: 'オペアンプ' },
    'Connector:Conn_01x02': { def: connector(2), value: 'Conn_01x02', ref: 'J', label: 'コネクタ 2ピン' },
    'Connector:Conn_01x03': { def: connector(3), value: 'Conn_01x03', ref: 'J', label: 'コネクタ 3ピン' },
    'Switch:SW_Push': { def: SW_DEF, value: 'SW_Push', ref: 'SW', label: 'プッシュスイッチ' },
  };

  // Menu order.
  const ORDER = [
    'Device:R', 'Device:C', 'Device:CP', 'Device:L', 'Device:D', 'Device:LED',
    'Transistor_BJT:Q_NPN_BCE', 'Amplifier_Operational:OpAmp',
    'Connector:Conn_01x02', 'Connector:Conn_01x03', 'Switch:SW_Push',
  ];

  global.KiParts = { PARTS: PARTS, ORDER: ORDER };
})(typeof window !== 'undefined' ? window : globalThis);
