'use strict';

// Pure helpers from helper_functions.js that the whole engine leans on but
// nothing pinned: credit parsing (called to size every pool — a bug here
// mis-counts credits everywhere), numeric extraction, and the course-catalog
// lookups getInfo / isCourseValid.
//
// All pure enough for the tolerant vm loader (getInfo/isCourseValid read
// window.curriculum for the double-major fallback, which resolves to the
// sandbox and is simply absent here — the main-catalog path is what matters).

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScriptGlobals } = require('./helpers/load-script');

const h = loadScriptGlobals('scripts/helper_functions.js');

test('parseCreditValue: plain integers and decimals', () => {
  assert.equal(h.parseCreditValue('3'), 3);
  assert.equal(h.parseCreditValue('0'), 0);
  assert.equal(h.parseCreditValue('2.5'), 2.5, 'half credits are allowed');
  assert.equal(h.parseCreditValue(4), 4, 'a number, not just a string');
});

test('parseCreditValue: comma decimal separator (European catalogs)', () => {
  // The scraped data occasionally uses a comma; it must not read as an integer.
  assert.equal(h.parseCreditValue('2,5'), 2.5);
  assert.equal(h.parseCreditValue('3,0'), 3);
});

test('parseCreditValue: absent / non-numeric values are 0, not NaN', () => {
  // Catalog credit fields can be '', '-', null or undefined. Every consumer
  // adds the result to a running total, so NaN would poison a whole pool.
  for (const v of ['', '-', '   ', null, undefined, 'N/A', 'abc']) {
    const r = h.parseCreditValue(v);
    assert.equal(Number.isFinite(r), true, `parseCreditValue(${JSON.stringify(v)}) must be finite`);
    assert.equal(r, 0, `parseCreditValue(${JSON.stringify(v)}) should be 0`);
  }
});

test('parseCreditValue: leading/trailing whitespace is tolerated', () => {
  assert.equal(h.parseCreditValue('  3  '), 3);
  assert.equal(h.parseCreditValue('\t2.5\n'), 2.5);
});

test('formatCreditValue: always one decimal place', () => {
  assert.equal(h.formatCreditValue('3'), '3.0');
  assert.equal(h.formatCreditValue('2.5'), '2.5');
  assert.equal(h.formatCreditValue('2,5'), '2.5', 'formats through parseCreditValue');
  assert.equal(h.formatCreditValue(''), '0.0');
});

test('extractNumericValue: pulls the first run of digits, else null', () => {
  assert.equal(h.extractNumericValue('con12'), 12, 'container-id style');
  assert.equal(h.extractNumericValue('s3'), 3);
  assert.equal(h.extractNumericValue('CS201'), 201);
  assert.equal(h.extractNumericValue('no digits here'), null);
  assert.equal(h.extractNumericValue(''), null);
});

// A tiny in-memory catalog: getInfo/isCourseValid take course_data explicitly.
const CATALOG = [
  { Major: 'CS', Code: '201', Course_Name: 'Intro', SU_credit: '3', EL_Type: 'required' },
  { Major: 'MATH', Code: '101', Course_Name: 'Calc', SU_credit: '4', EL_Type: 'university' },
];

test('getInfo: finds a course by combined Major+Code', () => {
  const rec = h.getInfo('CS201', CATALOG);
  assert.ok(rec, 'CS201 should be found');
  assert.equal(rec.Course_Name, 'Intro');
  assert.equal(rec.EL_Type, 'required');
});

test('getInfo: normalizes whitespace in the queried code', () => {
  // The app passes codes that may carry a space ("CS 201"); the lookup strips it.
  assert.equal(h.getInfo('CS 201', CATALOG).Code, '201');
  assert.equal(h.getInfo('  MATH101 ', CATALOG).Major, 'MATH');
});

test('getInfo: an unknown course yields a falsy result, not a throw', () => {
  assert.ok(!h.getInfo('ZZZ999', CATALOG));
  assert.ok(!h.getInfo('', CATALOG));
});

test('isCourseValid: true only for codes present in the catalog', () => {
  assert.equal(h.isCourseValid({ code: 'CS201' }, CATALOG), true);
  assert.equal(h.isCourseValid({ code: 'CS 201' }, CATALOG), true, 'space-normalized');
  assert.equal(h.isCourseValid({ code: 'ZZZ999' }, CATALOG), false);
  assert.equal(h.isCourseValid({ code: '' }, CATALOG), false);
});
