'use strict';

const { CS_PASSING_PLAN } = require('../../e2e/helpers/passing-plan');

const EXPECTED_CS_PASSING_COURSES = 60;
if (CS_PASSING_PLAN.length !== EXPECTED_CS_PASSING_COURSES) {
  throw new Error(
    `The performance fixture expects ${EXPECTED_CS_PASSING_COURSES} CS courses; `
      + `the shared passing plan now contains ${CS_PASSING_PLAN.length}.`,
  );
}

const TERM_DEFINITIONS = Object.freeze([
  Object.freeze({ code: '202401', label: 'Fall 2024-2025' }),
  Object.freeze({ code: '202402', label: 'Spring 2024-2025' }),
  Object.freeze({ code: '202403', label: 'Summer 2024-2025' }),
  Object.freeze({ code: '202501', label: 'Fall 2025-2026' }),
  Object.freeze({ code: '202502', label: 'Spring 2025-2026' }),
  Object.freeze({ code: '202503', label: 'Summer 2025-2026' }),
  Object.freeze({ code: '202601', label: 'Fall 2026-2027' }),
]);

const SCHEDULER_TARGET_COURSES = Object.freeze([
  'CS201',
  'CS204',
  'MATH101',
  'NS101',
  'IF100',
  'SPS101',
]);

const SCHEDULER_PREFERENCES = Object.freeze({
  light: Object.freeze({
    hideTakenCourses: 'false',
    showCourseDetails: 'false',
    sortBasedOnScore: 'false',
    schedulerHoverPreview: 'false',
    schedulerHighlightAvailability: 'false',
    schedulerShowBlockedCourses: 'false',
    schedulerCheckPrereqs: 'false',
    schedulerShowUnmetPrereqs: 'false',
  }),
  heavy: Object.freeze({
    hideTakenCourses: 'true',
    showCourseDetails: 'true',
    sortBasedOnScore: 'true',
    schedulerHoverPreview: 'true',
    schedulerHighlightAvailability: 'true',
    schedulerShowBlockedCourses: 'true',
    schedulerCheckPrereqs: 'true',
    schedulerShowUnmetPrereqs: 'true',
  }),
});

const PLANNER_PREFERENCES = Object.freeze({
  plannerFilterOfferedOnly: 'false',
  plannerFilterCheckPrerequisites: 'true',
  plannerFilterShowUnmetPrerequisites: 'true',
  plannerFilterProgram: '',
  plannerFilterCategory: '',
  plannerFilterLevel: '',
  plannerFilterMinSu: '',
  plannerFilterMinEcts: '',
  plannerFilterMinBasicScience: '',
  plannerFilterMinEngineering: '',
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function countCourses(state) {
  return (state.curriculum || []).reduce(
    (total, semester) => total + (Array.isArray(semester) ? semester.length : 0),
    0,
  );
}

function buildDenseCurriculum() {
  const target = new Set(SCHEDULER_TARGET_COURSES);
  const priorCourses = CS_PASSING_PLAN.filter((course) => !target.has(course));
  const semesters = Array.from({ length: TERM_DEFINITIONS.length }, () => []);
  priorCourses.forEach((course, index) => {
    semesters[index % (semesters.length - 1)].push(course);
  });
  semesters[semesters.length - 1] = SCHEDULER_TARGET_COURSES.slice();
  return semesters;
}

function buildDensePlan() {
  const curriculum = buildDenseCurriculum();
  return {
    major: 'CS',
    entryTerm: TERM_DEFINITIONS[0].label,
    curriculum,
    grades: curriculum.map((courses, semesterIndex) => courses.map(() => (
      semesterIndex === curriculum.length - 1 ? '' : 'A'
    ))),
    dates: TERM_DEFINITIONS.map((term) => term.label),
    termCodes: TERM_DEFINITIONS.map((term) => term.code),
    schedulerSelectedTerm: TERM_DEFINITIONS[TERM_DEFINITIONS.length - 1].code,
  };
}

function buildTypicalPlan() {
  const termDefinitions = TERM_DEFINITIONS.filter((_, index) => [0, 1, 3, 4].includes(index));
  const curriculum = [
    ['CIP101N', 'IF100', 'MATH101', 'NS101', 'SPS101', 'TLL101'],
    ['AL102', 'MATH102', 'NS102', 'SPS102', 'TLL102', 'HIST191'],
    ['CS201', 'CS204', 'MATH201', 'MATH203', 'HUM201', 'PROJ201'],
    ['CS300', 'CS301', 'CS302', 'CS305', 'HUM202', 'SPS303'],
  ];
  return {
    major: 'CS',
    entryTerm: TERM_DEFINITIONS[0].label,
    curriculum,
    grades: curriculum.map((courses, semesterIndex) => courses.map(() => (
      semesterIndex < 2 ? 'A' : ''
    ))),
    dates: termDefinitions.map((term) => term.label),
    termCodes: termDefinitions.map((term) => term.code),
    schedulerSelectedTerm: termDefinitions[termDefinitions.length - 1].code,
  };
}

function buildEmptyPlan() {
  const termDefinitions = TERM_DEFINITIONS.slice(0, 4);
  return {
    major: 'CS',
    entryTerm: TERM_DEFINITIONS[0].label,
    curriculum: termDefinitions.map(() => []),
    grades: termDefinitions.map(() => []),
    dates: termDefinitions.map((term) => term.label),
    termCodes: termDefinitions.map((term) => term.code),
    schedulerSelectedTerm: termDefinitions[termDefinitions.length - 1].code,
  };
}

function makeFixture(id, description, plan, preferences = {}) {
  const expectedTermCodes = plan.termCodes.slice();
  const fixture = {
    id,
    description,
    planName: `Performance: ${id}`,
    schemaVersion: 4,
    plan: clone(plan),
    preferences: { ...PLANNER_PREFERENCES, ...preferences },
    expectedCourseCount: countCourses(plan),
    expectedSemesterCount: plan.curriculum.length,
    expectedTermCodes,
  };
  if (fixture.expectedSemesterCount !== fixture.expectedTermCodes.length) {
    throw new Error(`${id}: term-code and semester counts differ.`);
  }
  if (fixture.plan.grades.length !== fixture.expectedSemesterCount) {
    throw new Error(`${id}: grade and semester counts differ.`);
  }
  return Object.freeze(fixture);
}

const FIXTURES = Object.freeze({
  empty: makeFixture(
    'empty',
    'Four fixed semesters with no courses.',
    buildEmptyPlan(),
    SCHEDULER_PREFERENCES.light,
  ),
  typical: makeFixture(
    'typical',
    'A representative 24-course CS plan across four fixed semesters.',
    buildTypicalPlan(),
    SCHEDULER_PREFERENCES.light,
  ),
  'scheduler-light': makeFixture(
    'scheduler-light',
    'The dense 60-course plan with expensive Scheduler presentation filters disabled.',
    buildDensePlan(),
    SCHEDULER_PREFERENCES.light,
  ),
  'scheduler-heavy': makeFixture(
    'scheduler-heavy',
    'The dense 60-course plan with prerequisites, details, sorting, highlighting, and hover preview enabled.',
    buildDensePlan(),
    SCHEDULER_PREFERENCES.heavy,
  ),
});

function getFixture(name) {
  const fixture = FIXTURES[name];
  if (!fixture) {
    throw new Error(`Unknown performance fixture "${name}". Available: ${Object.keys(FIXTURES).join(', ')}`);
  }
  return clone(fixture);
}

module.exports = {
  EXPECTED_CS_PASSING_COURSES,
  FIXTURES,
  PLANNER_PREFERENCES,
  SCHEDULER_PREFERENCES,
  SCHEDULER_TARGET_COURSES,
  TERM_DEFINITIONS,
  buildDensePlan,
  buildEmptyPlan,
  buildTypicalPlan,
  countCourses,
  getFixture,
};
