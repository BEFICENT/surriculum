'use strict';

// Unit tests for the term-name <-> term-code helpers in helper_functions.js.
// These are pure and dependency-free, and the ordering property they encode is
// load-bearing: the scheduler's prereq check and the "hide taken" filter both
// compare numeric term codes to decide what counts as past / current / future.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScriptGlobals } = require('./helpers/load-script');

const h = loadScriptGlobals('scripts/helper_functions.js');

test('termNameToCode maps season + year to a 6-digit code', () => {
  assert.equal(h.termNameToCode('Fall 2024-2025'), '202401');
  assert.equal(h.termNameToCode('Spring 2024-2025'), '202402');
  assert.equal(h.termNameToCode('Summer 2024-2025'), '202403');
  assert.equal(h.termNameToCode('Fall 2025-2026'), '202501');
  assert.equal(h.termNameToCode('Summer 2025-2026'), '202503');
  assert.equal(h.termNameToCode('not a term'), '');
});

test('termCodeToName is the inverse of termNameToCode', () => {
  for (const name of ['Fall 2024-2025', 'Spring 2024-2025', 'Summer 2025-2026', 'Fall 2026-2027']) {
    assert.equal(h.termCodeToName(h.termNameToCode(name)), name);
  }
});

test('term codes sort chronologically (Fall < Spring < Summer, then by year)', () => {
  // This is exactly the ordering the scheduler relies on to tell whether a
  // planned course sits before, in, or after the selected term.
  const chronological = [
    'Fall 2024-2025', 'Spring 2024-2025', 'Summer 2024-2025',
    'Fall 2025-2026', 'Spring 2025-2026', 'Summer 2025-2026',
    'Fall 2026-2027',
  ];
  const codes = chronological.map((n) => Number(h.termNameToCode(n)));
  const sorted = [...codes].sort((a, b) => a - b);
  assert.deepEqual(codes, sorted, 'numeric term codes must be monotonic with real-world term order');
});

test('normalizeTermIdentifier / displayTermIdentifier round-trip names and codes', () => {
  assert.equal(h.normalizeTermIdentifier('Spring 2024-2025'), '202402');
  assert.equal(h.normalizeTermIdentifier('202402'), '202402'); // already a code -> unchanged
  assert.equal(h.displayTermIdentifier('202402'), 'Spring 2024-2025');
  assert.equal(h.displayTermIdentifier('Spring 2024-2025'), 'Spring 2024-2025');
});
