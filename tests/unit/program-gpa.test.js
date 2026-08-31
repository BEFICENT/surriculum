'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCurriculumGlobals } = require('./helpers/load-curriculum');

const g = loadCurriculumGlobals();

const course = (code, grade, effective, extras = {}) => ({
  code,
  grade,
  gradingBasis: 'letter',
  SU_credit: 3,
  pgpaEffective: effective,
  ...extras,
});

const calculate = (semesters, projected = false) => g.calculateGpaForMembership(
  semesters,
  (c) => g.isProgramEffectiveType(c.pgpaEffective),
  '202502',
  projected,
);

test('only recognized effective program categories enter PGPA', () => {
  const result = calculate([{ termCode: '202502', courses: [
    course('CS201', 'D', 'required'),
    course('HIST191', 'A', 'none'),
    course('FREE101', 'B', 'free'),
    course('BAD101', 'A', 'unknown'),
  ] }]);

  assert.equal(result.credits, 6);
  assert.equal(result.points, 12);
  assert.equal(result.value, 2);
});

test('an in-program F and letter-basis NA contribute zero points over their credits', () => {
  const result = calculate([{ termCode: '202502', courses: [
    course('CS201', 'A', 'required'),
    course('CS204', 'F', 'core'),
    course('CS300', 'NA', 'area'),
    course('EXTRA', 'NA', 'none', { gradingBasis: 'unknown' }),
  ] }]);

  assert.equal(result.resolved, true, 'an unresolved N/A-effective course must not poison PGPA');
  assert.equal(result.credits, 9);
  assert.equal(result.points, 12);
  assert.equal(result.value, 4 / 3);
});

test('GPA-neutral grades remain neutral even when the course belongs to the program', () => {
  const result = calculate([{ termCode: '202502', courses: [
    course('PROJ102', 'S', 'required', { gradingBasis: 'satisfactory' }),
    course('TRANSFER', 'T', 'free'),
    course('WITHDRAWN', 'W', 'area'),
    course('CS201', 'B', 'core'),
  ] }]);

  assert.equal(result.credits, 3);
  assert.equal(result.points, 9);
  assert.equal(result.value, 3);
});

test('current grades are actual; future grades and missing estimates are projected only', () => {
  const semesters = [
    { termCode: '202502', courses: [course('CS201', 'A', 'required')] },
    { termCode: '202503', courses: [
      course('CS204', 'D', 'core'),
      course('CS300', '', 'area'),
    ] },
  ];

  const actual = calculate(semesters, false);
  assert.equal(actual.credits, 3);
  assert.equal(actual.value, 4);
  assert.equal(actual.missingCredits, 0);

  const projected = calculate(semesters, true);
  assert.equal(projected.credits, 6);
  assert.equal(projected.value, 2.5);
  assert.equal(projected.missingCredits, 3);
  assert.deepEqual(Array.from(projected.missingCourses), ['CS300']);
  assert.equal(projected.complete, false);
});

test('main and double-major membership can classify the same course independently', () => {
  const semesters = [{ termCode: '202502', courses: [
    { ...course('CS201', 'D', 'required'), main: 'required', dm: 'none' },
    { ...course('VA201', 'A', 'free'), main: 'none', dm: 'core' },
    { ...course('MATH101', 'B', 'university'), main: 'university', dm: 'university' },
  ] }];
  const main = g.calculateGpaForMembership(
    semesters, (c) => g.isProgramEffectiveType(c.main), '202502', false,
  );
  const dm = g.calculateGpaForMembership(
    semesters, (c) => g.isProgramEffectiveType(c.dm), '202502', false,
  );

  assert.equal(main.value, 2);
  assert.equal(dm.value, 3.5);
});

test('double-major average threshold follows initial SU registration term', () => {
  assert.equal(g.doubleMajorAverageThreshold('201803'), 2.72);
  assert.equal(g.doubleMajorAverageThreshold('201901'), 3.20);
  assert.equal(g.doubleMajorAverageThreshold('202501'), 3.20);
});

function curriculumWithProgramCourses(courses, catalog) {
  g.requirements = {
    202401: {
      CS: {
        university: 0,
        required: 3,
        core: 0,
        area: 0,
        free: 0,
        ects: 3,
        total: 3,
        humRequired: 1,
        humRule: 'any',
        science: 0,
        engineering: 0,
        facultyReq: {},
      },
    },
  };
  const curriculum = new g.s_curriculum();
  curriculum.major = 'CS';
  curriculum.entryTerm = '202401';
  curriculum.primaryCourseData = catalog;
  curriculum.semesters = [{ termCode: '202502', courses }];
  return curriculum;
}

test('private membership allocation gives an ordinary passing plan a finite PGPA', () => {
  const curriculum = curriculumWithProgramCourses(
    [{ code: 'CS101', grade: 'A', gradingBasis: 'letter', SU_credit: 3 }],
    [{ Major: 'CS', Code: '101', EL_Type: 'required', SU_credit: 3,
      ECTS: 5, Basic_Science: 0, Engineering: 0, Faculty_Course: 'No' }],
  );

  const result = curriculum.getProgramGpa('main', '202502');
  assert.equal(result.available, true);
  assert.equal(result.resolved, true);
  assert.equal(result.credits, 3);
  assert.equal(result.points, 12);
  assert.equal(result.value, 4);
});

test('private membership allocation includes a recognized F but excludes effective N/A courses', () => {
  const curriculum = curriculumWithProgramCourses(
    [
      { code: 'CS101', grade: 'A', gradingBasis: 'letter', SU_credit: 3 },
      { code: 'CS201', grade: 'F', gradingBasis: 'letter', SU_credit: 3 },
      { code: 'CS299', grade: 'A', gradingBasis: 'letter', SU_credit: 3 },
      { code: 'HIST999', grade: 'A', gradingBasis: 'letter', SU_credit: 3 },
    ],
    [
      { Major: 'CS', Code: '101', EL_Type: 'required', SU_credit: 3,
        ECTS: 5, Basic_Science: 0, Engineering: 0, Faculty_Course: 'No' },
      { Major: 'CS', Code: '201', EL_Type: 'core', SU_credit: 3,
        ECTS: 5, Basic_Science: 0, Engineering: 0, Faculty_Course: 'No' },
      { Major: 'CS', Code: '299', EL_Type: 'unknown', SU_credit: 3,
        ECTS: 5, Basic_Science: 0, Engineering: 0, Faculty_Course: 'No' },
    ],
  );

  const result = curriculum.getProgramGpa('main', '202502');
  assert.equal(result.resolved, true);
  assert.equal(result.credits, 6);
  assert.equal(result.points, 12);
  assert.equal(result.value, 2);
});

test('private membership keeps a future F out of actual PGPA but includes it in projected PGPA', () => {
  const curriculum = curriculumWithProgramCourses(
    [{ code: 'CS101', grade: 'A', gradingBasis: 'letter', SU_credit: 3 }],
    [
      { Major: 'CS', Code: '101', EL_Type: 'required', SU_credit: 3,
        ECTS: 5, Basic_Science: 0, Engineering: 0, Faculty_Course: 'No' },
      { Major: 'CS', Code: '201', EL_Type: 'core', SU_credit: 3,
        ECTS: 5, Basic_Science: 0, Engineering: 0, Faculty_Course: 'No' },
    ],
  );
  curriculum.semesters.push({
    termCode: '202503',
    courses: [{ code: 'CS201', grade: 'F', gradingBasis: 'letter', SU_credit: 3 }],
  });

  const actual = curriculum.getProgramGpa('main', '202502', false);
  assert.equal(actual.credits, 3);
  assert.equal(actual.value, 4);

  const projected = curriculum.getProgramGpa('main', '202502', true);
  assert.equal(projected.credits, 6);
  assert.equal(projected.points, 12);
  assert.equal(projected.value, 2);
});
