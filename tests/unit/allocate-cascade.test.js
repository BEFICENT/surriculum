'use strict';

// allocateCascade is the heart of the allocation engine: given a course's static
// (catalog) category and credit, plus the running pool counters and thresholds,
// it decides the course's effective category and advances the counters. Surplus
// spills one pool down — required -> core -> area -> free.
//
// It used to live as two hand-copied blocks (main-major and double-major passes),
// which is exactly how the pool counters drifted (bugs #3/#4/#21). Now it's a
// single module-level function shared by both, so it can be pinned directly here
// rather than only through full-app e2e allocation runs.
//
// Loaded via the tolerant vm loader: s_curriculum.js only declares constants and
// functions at top level, so it evaluates cleanly and exposes allocateCascade.

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScriptGlobals } = require('./helpers/load-script');

const { allocateCascade } = loadScriptGlobals('scripts/s_curriculum.js');

// Convenience: fresh counters, and a helper that places a course and returns
// both the resulting type and the mutated counters.
const REQS = { required: 6, core: 6, area: 3 };
const place = (staticType, credit, counters, pinCore = false) => {
  const type = allocateCascade(staticType, credit, counters, REQS, pinCore);
  return { type, counters };
};

test('required fills required, then overflows core -> area -> free', () => {
  const c = { required: 0, core: 0, area: 0 };
  assert.equal(place('required', 3, c).type, 'required'); // 3/6 required
  assert.equal(place('required', 3, c).type, 'required'); // 6/6 required (full)
  assert.equal(place('required', 3, c).type, 'core');     // required full -> core
  assert.equal(place('required', 3, c).type, 'core');     // 6/6 core (full)
  assert.equal(place('required', 3, c).type, 'area');     // core full -> area
  assert.equal(place('required', 3, c).type, 'free');     // area full -> free
  assert.deepEqual(c, { required: 6, core: 6, area: 3 });
});

test('a zero-credit required course always stays required (never overflows)', () => {
  // VACD's VA300 is 0 credits: it consumes no capacity, so it can never overflow
  // — reallocating it would mislabel a named required course as an elective.
  const c = { required: 6, core: 6, area: 3 }; // every pool already full
  assert.equal(place('required', 0, c).type, 'required');
  assert.deepEqual(c, { required: 6, core: 6, area: 3 }, 'a 0-credit course moves no counter');
});

test('core fills core, then overflows to area, then free', () => {
  const c = { required: 0, core: 0, area: 0 };
  assert.equal(place('core', 3, c).type, 'core'); // 3/6
  assert.equal(place('core', 3, c).type, 'core'); // 6/6
  assert.equal(place('core', 3, c).type, 'area'); // core full -> area (3/3)
  assert.equal(place('core', 3, c).type, 'free'); // area full -> free
  assert.deepEqual(c, { required: 0, core: 6, area: 3 });
});

test('area fills area, then overflows to free', () => {
  const c = { required: 0, core: 0, area: 0 };
  assert.equal(place('area', 3, c).type, 'area'); // 3/3
  assert.equal(place('area', 3, c).type, 'free'); // area full -> free
  assert.deepEqual(c, { required: 0, core: 0, area: 3 });
});

test('free and university pass through unchanged, moving no counter', () => {
  const c = { required: 0, core: 0, area: 0 };
  assert.equal(place('free', 3, c).type, 'free');
  assert.equal(place('university', 3, c).type, 'university');
  assert.deepEqual(c, { required: 0, core: 0, area: 0 });
});

test('an unexpected/blank type passes through unchanged', () => {
  const c = { required: 0, core: 0, area: 0 };
  assert.equal(allocateCascade('', 3, c, REQS, false), '');
  assert.equal(allocateCascade('none', 3, c, REQS, false), 'none');
  assert.deepEqual(c, { required: 0, core: 0, area: 0 });
});

test('pinCore forces core regardless of the cap, and still consumes core capacity', () => {
  // Named-pool rules (VACD core pools, IE's CS201) pin a course to core even
  // when core is already full — but the credits still count so ordinary core
  // electives fill only the remainder.
  const c = { required: 0, core: 99, area: 0 };
  assert.equal(place('area', 4, c, true).type, 'core', 'pinned even though its static type is area');
  assert.equal(c.core, 103, 'pinned credits still advance the core counter');
});

test('the cascade honours whatever thresholds it is given', () => {
  // Not hard-coded to any major: a program with no core requirement sends a
  // core-typed course straight past core.
  const c = { required: 0, core: 0, area: 0 };
  const reqs = { required: 0, core: 0, area: 0 };
  assert.equal(allocateCascade('core', 3, c, reqs, false), 'free', 'no core capacity -> straight to free');
  assert.deepEqual(c, { required: 0, core: 0, area: 0 });
});
