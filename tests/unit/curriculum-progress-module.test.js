'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadScriptsGlobals, REPO_ROOT } = require('./helpers/load-script');

const g = loadScriptsGlobals([
  'scripts/domain/curriculum-allocation.js',
  'scripts/domain/curriculum-progress.js',
]);

test('curriculum progress installs a frozen namespace and preserves compatibility globals', () => {
  const api = g.SurriculumModules.curriculumProgress;
  assert.ok(api);
  assert.equal(Object.isFrozen(api), true);
  assert.equal(Object.isFrozen(api.COURSE_PROGRESS_STATES), true);
  assert.equal(typeof api.create, 'function');

  for (const [name, value] of Object.entries(api)) {
    if (name === 'create') continue;
    assert.equal(g[name], value, `${name} compatibility identity should be preserved`);
  }
});

test('curriculum progress loads between allocation and requirement policy', () => {
  const source = fs.readFileSync(path.join(REPO_ROOT, 'index.html'), 'utf8');
  const scripts = [...source.matchAll(/<script\s+([^>]*?)src="([^"]+)"([^>]*)><\/script>/g)]
    .map((match) => ({ attrs: `${match[1]} ${match[3]}`, src: match[2] }));
  const requiredOrder = [
    'scripts/domain/curriculum-allocation.js',
    'scripts/domain/curriculum-recalculation.js',
    'scripts/domain/curriculum-progress.js',
    'scripts/domain/requirement-engine.js',
    'scripts/s_curriculum.js',
  ];
  const positions = requiredOrder.map((src) => scripts.findIndex((script) => script.src === src));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual(positions, [...positions].sort((left, right) => left - right));
  for (const src of requiredOrder) {
    assert.match(scripts.find((script) => script.src === src).attrs, /\bdefer\b/);
  }
});

test('the pure factory receives grade, chronology, and credit policy explicitly', () => {
  const calls = [];
  const policy = {
    normalizeGrade(value) {
      calls.push(['normalize', value]);
      return String(value || '').trim().toUpperCase();
    },
    evaluateGrade(grade, basis) {
      calls.push(['evaluate', grade, basis]);
      return {
        token: grade,
        supported: true,
        successful: grade === 'OK',
        earnsCredit: grade === 'OK',
        pending: false,
        countsInGpa: grade === 'OK',
        gpaPoints: grade === 'OK' ? 4 : null,
        needsReview: false,
        gradingBasis: basis || 'letter',
      };
    },
  };
  const pure = g.SurriculumModules.curriculumProgress.create({
    creditOfCourse: (course) => Number(course.units || 0),
    getGradePolicy: () => policy,
    getDocument: () => undefined,
    getTermNameToCode: () => (name) => (
      name === 'Spring 2024-2025' ? '202402' : ''
    ),
    getCurrentTermNameFromDate: () => undefined,
    getCurrentTermCode: () => '',
    getCurrentTermName: () => '',
    getSemesterTermCode: () => (semester) => semester.termCode,
    getCompareSemesterTerms: () => (left, right) => left.rank - right.rank,
    getNow: () => new Date('2025-01-01T00:00:00Z'),
  });

  assert.equal(Object.isFrozen(pure), true);
  assert.equal(pure.normalizeProgressTermCode('Spring 2024-2025'), '202402');
  assert.equal(pure.compareCurriculumSemesterTerms({ rank: 2 }, { rank: 5 }), -3);
  assert.equal(
    pure.courseProgressState({ grade: 'ok', gradingBasis: 'letter' }, { termCode: '202401' }, '202402'),
    pure.COURSE_PROGRESS_STATES.EARNED,
  );

  const semesters = [{ termCode: '202401', courses: [
    { code: 'CS101', grade: 'ok', gradingBasis: 'letter', units: 4 },
  ] }];
  assert.equal(pure.calculateEarnedSuCredits(semesters, '202402'), 4);
  const gpa = pure.calculateGpaForMembership(semesters, () => true, '202402', false);
  assert.equal(gpa.credits, 4);
  assert.equal(gpa.points, 16);
  assert.ok(calls.some(([name]) => name === 'evaluate'));
});
