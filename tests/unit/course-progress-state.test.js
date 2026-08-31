'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCurriculumGlobals } = require('./helpers/load-curriculum');

const g = loadCurriculumGlobals();
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
  for (const grade of ['', 'Registered', 'P', 'I']) {
    assert.equal(classify(grade, '202501'), 'unverified');
  }
  assert.equal(classify('unexpected', '202501'), 'unsuccessful');
  assert.equal(classify('A+', '202501'), 'unsuccessful');
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

test('estimated class-level bands use the undergraduate 34/64/94 boundaries', () => {
  const level = (credits) => g.estimatedClassLevelForEarnedCredits(credits).label;
  assert.equal(level(-1), 'Freshman');
  assert.equal(level(0), 'Freshman');
  assert.equal(level(33.99), 'Freshman');
  assert.equal(level(34), 'Sophomore');
  assert.equal(level(63.99), 'Sophomore');
  assert.equal(level(64), 'Junior');
  assert.equal(level(93.99), 'Junior');
  assert.equal(level(94), 'Senior');
  assert.equal(level(125), 'Senior');

  assert.deepEqual(
    JSON.parse(JSON.stringify(g.estimatedClassLevelForEarnedCredits(57))),
    {
      label: 'Sophomore', earnedCredits: 57, nextLabel: 'Junior',
      nextThreshold: 64, creditsToNext: 7, estimated: true,
    },
  );
});

test('earned SU credits are grade/term based and independent of program allocation', () => {
  const semesters = [
    {
      termCode: '202501',
      courses: [
        { code: 'PASTA', grade: 'A', SU_credit: 3, effective_type: 'none' },
        { code: 'PASTT', grade: 'T', SU_credit: 2, effective_type: 'none' },
        { code: 'PASTF', grade: 'F', SU_credit: 3, effective_type: 'required' },
        { code: 'PASTU', grade: 'U', SU_credit: 2, effective_type: 'required' },
      ],
    },
    {
      termCode: '202502',
      courses: [
        { code: 'CURRENTD', grade: 'D', SU_credit: 2, effective_type: 'free' },
        { code: 'CURRENTS', grade: 'S', SU_credit: 1, effective_type: 'free' },
        { code: 'CURRENTBLANK', grade: '', SU_credit: 3, effective_type: 'free' },
      ],
    },
    {
      termCode: '202503',
      courses: [{ code: 'FUTUREA', grade: 'A', SU_credit: 4, effective_type: 'required' }],
    },
    {
      termCode: '',
      courses: [{ code: 'UNKNOWNTERM', grade: 'A', SU_credit: 5, effective_type: 'required' }],
    },
  ];

  assert.equal(g.calculateEarnedSuCredits(semesters, '202502'), 8);
});

test('semester workload split uses positive raw SU and only primary effective pools', () => {
  const curriculum = {
    semesters: [
      {
        totalLoadCredit: 999,
        primaryAllocatedCredit: 999,
        primaryUnallocatedCredit: 999,
        courses: [
          { code: 'CORE300', SU_credit: '3', effective_type: 'core' },
          {
            code: 'FAILED250', grade: 'F', SU_credit: '2.5',
            effective_type: 'none', effective_type_dm: 'required',
          },
          { code: 'UNIV125', SU_credit: '1.25', effective_type: 'university' },
          { code: 'PENDING400', SU_credit: '4', effective_type: '' },
          { code: 'INVALID300', SU_credit: '3', effective_type: 'unexpected' },
          { code: 'NEGATIVE', SU_credit: '-2', effective_type: 'required' },
          { code: 'MISSING', SU_credit: 'not-a-number', effective_type: 'required' },
        ],
      },
      {
        totalLoadCredit: 7,
        primaryAllocatedCredit: 4,
        primaryUnallocatedCredit: 3,
        courses: [],
      },
    ],
  };

  g.recomputeSemesterPrimaryCreditSplit(curriculum);

  assert.deepEqual(
    {
      load: curriculum.semesters[0].totalLoadCredit,
      allocated: curriculum.semesters[0].primaryAllocatedCredit,
      unallocated: curriculum.semesters[0].primaryUnallocatedCredit,
    },
    { load: 13.75, allocated: 4.25, unallocated: 9.5 },
  );
  assert.deepEqual(
    {
      load: curriculum.semesters[1].totalLoadCredit,
      allocated: curriculum.semesters[1].primaryAllocatedCredit,
      unallocated: curriculum.semesters[1].primaryUnallocatedCredit,
    },
    { load: 0, allocated: 0, unallocated: 0 },
    'an empty semester clears stale split values',
  );
});

test('primary catalog SU restores an occurrence hydrated with a different DM credit', () => {
  const occurrence = {
    code: 'SHARED300',
    SU_credit: 4,
    effective_type: 'core',
    effective_type_dm: 'required',
  };
  const curriculum = {
    major: 'CS',
    primaryCourseData: [{
      Major: 'SHARED', Code: '300', SU_credit: '3', EL_Type: 'core',
    }],
    doubleMajorCourseData: [{
      Major: 'SHARED', Code: '300', SU_credit: '4', EL_Type: 'required',
    }],
    semesters: [{ courses: [occurrence] }],
  };

  g.recomputeSemesterPrimaryCreditSplit(curriculum);

  assert.equal(occurrence.SU_credit, 3, 'secondary-program hydration must be restored');
  assert.deepEqual(
    {
      load: curriculum.semesters[0].totalLoadCredit,
      allocated: curriculum.semesters[0].primaryAllocatedCredit,
      unallocated: curriculum.semesters[0].primaryUnallocatedCredit,
      program: curriculum.semesters[0].primaryProgramCode,
    },
    { load: 3, allocated: 3, unallocated: 0, program: 'CS' },
    'one planned occurrence contributes its primary SU exactly once',
  );
});
