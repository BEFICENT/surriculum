'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScriptGlobals } = require('./helpers/load-script');

const g = loadScriptGlobals('scripts/s_curriculum.js');
const classify = (grade, termCode, current = '202502') => g.courseProgressState(
  { grade },
  { termCode },
  current,
);

test('current-term final grades are real immediately', () => {
  for (const grade of ['A', 'A-', 'B+', 'C', 'D+', 'D', 'S', 'T']) {
    assert.equal(classify(grade, '202502'), 'earned', `${grade} should be earned`);
  }
});

test('current-term pending grades remain current', () => {
  for (const grade of ['', 'Registered', 'P', 'I']) {
    assert.equal(classify(grade, '202502'), 'current', `${grade || 'blank'} should be current`);
  }
});

test('explicit unsuccessful results earn no credit in any term', () => {
  for (const term of ['202501', '202502', '202503']) {
    for (const grade of ['F', 'U', 'NA', 'W']) {
      assert.equal(classify(grade, term), 'unsuccessful', `${term} ${grade}`);
    }
  }
});

test('past final grades are earned while unresolved past courses need verification', () => {
  assert.equal(classify('A', '202501'), 'earned');
  for (const grade of ['', 'Registered', 'P', 'I', 'unexpected']) {
    assert.equal(classify(grade, '202501'), 'unverified');
  }
});

test('future-term entries stay projected even when a grade was entered', () => {
  for (const grade of ['', 'A', 'D', 'P', 'I']) {
    assert.equal(classify(grade, '202503'), 'future', `${grade || 'blank'} should stay future`);
  }
});

test('unknown term identity fails closed as unverified', () => {
  assert.equal(classify('A', ''), 'unverified');
  assert.equal(classify('', 'not-a-term'), 'unverified');
});

test('term-code ordering spans academic years', () => {
  assert.equal(classify('', '202503', '202502'), 'future');
  assert.equal(classify('', '202601', '202503'), 'future');
  assert.equal(classify('', '202501', '202503'), 'unverified');
});
