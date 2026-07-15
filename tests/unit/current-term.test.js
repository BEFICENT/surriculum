'use strict';

// Unit tests for getCurrentTermNameFromDate(), which decides what "now" means
// academically. It is load-bearing well beyond its size: the scheduler's default
// term, the "only show offered courses for <term>" filter, the current-term
// highlight, and the academicYear the term dropdowns are built from all derive
// from it. An off-by-one here silently shifts every one of them, and only for
// students unlucky enough to load the app near a boundary.
//
// The academic calendar it encodes (a term "starts" in the year the Fall did):
//   Jan 1  - Jan 19   -> Fall   of the PREVIOUS academic year (still finishing)
//   Jan 20 - Jun 19   -> Spring of the previous year
//   Jun 20 - Aug 31   -> Summer of the previous year
//   Sep 1  - Dec 31   -> Fall   of the CURRENT year
//
// Note every boundary is tested from both sides: the ones inside a month
// (Jan 19/20, Jun 19/20) are hand-written comparisons in the source and are
// exactly where an off-by-one would hide.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScriptGlobals } = require('./helpers/load-script');

const h = loadScriptGlobals('scripts/helper_functions.js');

// Month is 0-indexed in the Date constructor; spelled out here so the test reads
// as a calendar rather than as arithmetic.
const JAN = 0, FEB = 1, JUN = 5, JUL = 6, AUG = 7, SEP = 8, DEC = 11;
const at = (y, m, d) => h.getCurrentTermNameFromDate(new Date(y, m, d));

test('Jan 1-19 is still the previous year Fall term', () => {
  assert.equal(at(2025, JAN, 1), 'Fall 2024-2025');
  assert.equal(at(2025, JAN, 19), 'Fall 2024-2025', 'Jan 19 is the last Fall day');
});

test('Jan 20 flips to Spring of the same academic year', () => {
  assert.equal(at(2025, JAN, 20), 'Spring 2024-2025', 'Jan 20 is the first Spring day');
  assert.equal(at(2025, FEB, 1), 'Spring 2024-2025');
});

test('Spring runs to Jun 19', () => {
  assert.equal(at(2025, JUN, 19), 'Spring 2024-2025', 'Jun 19 is the last Spring day');
});

test('Jun 20 flips to Summer', () => {
  assert.equal(at(2025, JUN, 20), 'Summer 2024-2025', 'Jun 20 is the first Summer day');
  assert.equal(at(2025, JUL, 15), 'Summer 2024-2025');
  assert.equal(at(2025, AUG, 31), 'Summer 2024-2025', 'Aug 31 is the last Summer day');
});

test('Sep 1 starts the NEW academic year Fall', () => {
  // The only boundary where the academic year rolls over: Aug 31 belongs to
  // 2024-2025, Sep 1 to 2025-2026.
  assert.equal(at(2025, SEP, 1), 'Fall 2025-2026', 'Sep 1 is the first Fall day');
  assert.equal(at(2025, DEC, 31), 'Fall 2025-2026', 'Dec 31 is still that Fall');
});

test('the year rolls over at Sep 1 and back at Jan 1, not at New Year', () => {
  // Dec 31 -> Jan 1 crosses the calendar year but NOT the academic term.
  assert.equal(at(2025, DEC, 31), 'Fall 2025-2026');
  assert.equal(at(2026, JAN, 1), 'Fall 2025-2026', 'the term must survive New Year');
});

test('every day of a year maps to a term, and the sequence never goes backwards', () => {
  // Guards the whole calendar in one sweep: no gaps (a day returning ''), and no
  // day that jumps to an earlier term than the day before it.
  const order = { Fall: 1, Spring: 2, Summer: 3 };
  const rank = (name) => {
    const m = /^(Fall|Spring|Summer) (\d{4})-(\d{4})$/.exec(name);
    assert.ok(m, `every day must map to a well-formed term, got "${name}"`);
    return Number(m[2]) * 10 + order[m[1]];
  };

  let prev = rank(at(2025, JAN, 1));
  const d = new Date(2025, JAN, 1);
  for (let i = 0; i < 365; i++) {
    d.setDate(d.getDate() + 1);
    const cur = rank(h.getCurrentTermNameFromDate(d));
    assert.ok(cur >= prev, `term went backwards on ${d.toDateString()}`);
    prev = cur;
  }
});

test('an invalid date yields an empty string rather than throwing', () => {
  // Callers treat '' as "unknown" and fall back; a throw here would break app
  // bootstrap, since this runs at module load.
  assert.equal(h.getCurrentTermNameFromDate(null), '');
  assert.equal(h.getCurrentTermNameFromDate(undefined), '');
  assert.equal(h.getCurrentTermNameFromDate('not a date'), '');
});

test('the term it returns round-trips through the term-code helpers', () => {
  // getCurrentTermNameFromDate feeds termNameToCode all over the app, so its
  // output format has to be exactly what that parser expects.
  for (const [m, d] of [[JAN, 5], [FEB, 14], [JUN, 30], [SEP, 15], [DEC, 20]]) {
    const name = at(2025, m, d);
    const code = h.termNameToCode(name);
    assert.match(code, /^\d{6}$/, `${name} should convert to a 6-digit code`);
    assert.equal(h.termCodeToName(code), name, `${name} should survive the round trip`);
  }
});
