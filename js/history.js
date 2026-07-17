// history.js — undo/redo over serialized schematic snapshots.
//
// The schematic is small (KiB scale), so each history entry is simply the
// full serialized .kicad_sch text. `baseline` is the current state; undo and
// redo move it between the past and future stacks and return the text to load.

(function (global) {
  'use strict';

  function KiHistory(limit) {
    this.limit = limit || 100;
    this.past = [];
    this.future = [];
    this.baseline = null;
  }

  KiHistory.prototype.init = function (text) {
    this.past = [];
    this.future = [];
    this.baseline = text;
  };

  // Record a new state. Returns true if it differed from the baseline.
  KiHistory.prototype.commit = function (text) {
    if (this.baseline === null) { this.baseline = text; return false; }
    if (text === this.baseline) return false;
    this.past.push(this.baseline);
    if (this.past.length > this.limit) this.past.shift();
    this.baseline = text;
    this.future.length = 0;
    return true;
  };

  KiHistory.prototype.undo = function () {
    if (!this.past.length) return null;
    this.future.push(this.baseline);
    this.baseline = this.past.pop();
    return this.baseline;
  };

  KiHistory.prototype.redo = function () {
    if (!this.future.length) return null;
    this.past.push(this.baseline);
    this.baseline = this.future.pop();
    return this.baseline;
  };

  KiHistory.prototype.canUndo = function () { return this.past.length > 0; };
  KiHistory.prototype.canRedo = function () { return this.future.length > 0; };

  global.KiHistory = KiHistory;
})(typeof window !== 'undefined' ? window : globalThis);
