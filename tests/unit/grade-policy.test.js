'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { REPO_ROOT } = require('./helpers/load-script');

let grades;
let browserBridge;

test.before(async () => {
  browserBridge = {};
  globalThis.window = browserBridge;
  const moduleUrl = pathToFileURL(path.join(REPO_ROOT, 'scripts/domain/grades.js')).href;
  grades = await import(moduleUrl);
  delete globalThis.window;
});

test('exports one canonical, immutable token list and browser policy', () => {
  assert.deepEqual(grades.GRADE_TOKENS, [
    '',
    'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'F',
    'P', 'S', 'U', 'I', 'T', 'NA', 'W',
  ]);
  assert.equal(Object.isFrozen(grades.GRADE_TOKENS), true);
  assert.deepEqual(grades.GRADE_UI_OPTIONS.map((option) => option.value), grades.GRADE_TOKENS);
  assert.equal(grades.GRADE_UI_OPTIONS.every(Object.isFrozen), true);
  assert.equal(browserBridge.gradePolicy, grades.gradePolicy);
  assert.equal(browserBridge.gradePolicy.evaluateGrade, grades.evaluateGrade);
});

test('normalizes blank and Registered without accepting unknown grades', () => {
  for (const value of [undefined, null, '', '   ', 'Registered', ' registered ']) {
    assert.equal(grades.normalizeGrade(value), '', String(value));
  }
  assert.equal(grades.normalizeGrade(' b+ '), 'B+');
  assert.equal(grades.normalizeGrade('na'), 'NA');
  assert.equal(grades.normalizeGrade('A+'), null);
  assert.equal(grades.normalizeGrade('unexpected'), null);
  assert.equal(grades.isSupportedGrade('Registered'), true);
  assert.equal(grades.isSupportedGrade('A+'), false);
});

test('normalizes and infers grading bases conservatively', () => {
  const { LETTER, SATISFACTORY, UNKNOWN } = grades.GRADING_BASIS;
  assert.equal(grades.normalizeGradingBasis('letter'), LETTER);
  assert.equal(grades.normalizeGradingBasis('GPA-bearing'), LETTER);
  assert.equal(grades.normalizeGradingBasis('satisfactory'), SATISFACTORY);
  assert.equal(grades.normalizeGradingBasis('non_gpa'), SATISFACTORY);
  assert.equal(grades.normalizeGradingBasis('not-a-basis'), UNKNOWN);

  assert.equal(grades.inferGradingBasis('B+'), LETTER);
  assert.equal(grades.inferGradingBasis('F'), LETTER);
  assert.equal(grades.inferGradingBasis('S'), SATISFACTORY);
  assert.equal(grades.inferGradingBasis('P'), UNKNOWN);
  assert.equal(grades.inferGradingBasis('S', LETTER), SATISFACTORY);
  assert.equal(grades.inferGradingBasis('A', SATISFACTORY), LETTER);
  assert.equal(grades.inferGradingBasis('NA'), UNKNOWN);
  assert.equal(grades.inferGradingBasis('NA', LETTER), LETTER);
  assert.equal(grades.inferGradingBasis('I', SATISFACTORY), SATISFACTORY);
});

test('letter grades have the official GPA and credit outcomes', () => {
  const expected = {
    A: 4.0,
    'A-': 3.7,
    'B+': 3.3,
    B: 3.0,
    'B-': 2.7,
    'C+': 2.3,
    C: 2.0,
    'C-': 1.7,
    'D+': 1.3,
    D: 1.0,
    F: 0.0,
  };

  for (const [token, points] of Object.entries(expected)) {
    const outcome = grades.evaluateGrade(token);
    assert.equal(outcome.supported, true, token);
    assert.equal(outcome.terminal, true, token);
    assert.equal(outcome.successful, token !== 'F', token);
    assert.equal(outcome.earnsCredit, token !== 'F', token);
    assert.equal(outcome.countsInGpa, true, token);
    assert.equal(outcome.gpaPoints, points, token);
    assert.equal(outcome.pending, false, token);
    assert.equal(outcome.gradingBasis, grades.GRADING_BASIS.LETTER, token);
  }
});

test('S/U/P/I/T/W have distinct success, credit and status semantics', () => {
  const expected = {
    S: { successful: true, earnsCredit: true, pending: false, withdrawn: false, terminal: true },
    U: { successful: false, earnsCredit: false, pending: false, withdrawn: false, terminal: true },
    P: { successful: false, earnsCredit: false, pending: true, withdrawn: false, terminal: false },
    I: { successful: false, earnsCredit: false, pending: true, withdrawn: false, terminal: false },
    T: { successful: true, earnsCredit: true, pending: false, withdrawn: false, terminal: true },
    W: { successful: false, earnsCredit: false, pending: false, withdrawn: true, terminal: true },
  };

  for (const [token, wanted] of Object.entries(expected)) {
    const outcome = grades.evaluateGrade(token);
    for (const [field, value] of Object.entries(wanted)) {
      assert.equal(outcome[field], value, `${token}.${field}`);
    }
    assert.equal(outcome.countsInGpa, false, token);
    assert.equal(outcome.gpaPoints, null, token);
  }
});

test('blank and Registered are pending, unearned, GPA-neutral aliases', () => {
  const blank = grades.evaluateGrade('');
  const registered = grades.evaluateGrade('Registered');
  assert.deepEqual(registered, blank);
  assert.equal(blank.token, '');
  assert.equal(blank.status, 'ungraded');
  assert.equal(blank.pending, true);
  assert.equal(blank.terminal, false);
  assert.equal(blank.successful, false);
  assert.equal(blank.earnsCredit, false);
  assert.equal(blank.countsInGpa, false);
});

test('NA is F-equivalent on letter basis and U-equivalent on satisfactory basis', () => {
  const letter = grades.evaluateGrade('NA', grades.GRADING_BASIS.LETTER);
  assert.equal(letter.successful, false);
  assert.equal(letter.earnsCredit, false);
  assert.equal(letter.countsInGpa, true);
  assert.equal(letter.gpaPoints, 0);
  assert.equal(letter.equivalentGrade, 'F');
  assert.equal(letter.requiresGradingBasis, false);
  assert.equal(letter.basisResolved, true);

  const satisfactory = grades.evaluateGrade('NA', { gradingBasis: 'satisfactory' });
  assert.equal(satisfactory.successful, false);
  assert.equal(satisfactory.earnsCredit, false);
  assert.equal(satisfactory.countsInGpa, false);
  assert.equal(satisfactory.gpaPoints, null);
  assert.equal(satisfactory.equivalentGrade, 'U');
  assert.equal(satisfactory.requiresGradingBasis, false);
  assert.equal(satisfactory.basisResolved, true);
});

test('NA without a basis and unsupported grades fail closed', () => {
  const unresolvedNa = grades.evaluateGrade('NA');
  assert.equal(unresolvedNa.supported, true);
  assert.equal(unresolvedNa.successful, false);
  assert.equal(unresolvedNa.earnsCredit, false);
  assert.equal(unresolvedNa.countsInGpa, false);
  assert.equal(unresolvedNa.requiresGradingBasis, true);
  assert.equal(unresolvedNa.basisResolved, false);
  assert.equal(unresolvedNa.needsReview, true);

  for (const token of ['A+', 'unexpected']) {
    const outcome = grades.evaluateGrade(token);
    assert.equal(outcome.token, null, token);
    assert.equal(outcome.supported, false, token);
    assert.equal(outcome.successful, false, token);
    assert.equal(outcome.earnsCredit, false, token);
    assert.equal(outcome.countsInGpa, false, token);
    assert.equal(outcome.pending, false, token);
    assert.equal(outcome.withdrawn, false, token);
    assert.equal(outcome.needsReview, true, token);
  }
});
