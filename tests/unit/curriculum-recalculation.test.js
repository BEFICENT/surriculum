'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScriptsGlobals } = require('./helpers/load-script');
const { CURRICULUM_SCRIPT_PATHS } = require('./helpers/load-curriculum');

const MODULE_PATH = 'scripts/domain/curriculum-recalculation.js';
const g = loadScriptsGlobals(MODULE_PATH);

const MAIN_FIELDS = {
  category: 'category',
  effective: 'effective_type',
  total: {
    core: 'totalCore', area: 'totalArea', free: 'totalFree',
    required: 'totalRequired', university: 'totalUniversity',
  },
};
const DM_FIELDS = {
  category: 'categoryDM',
  effective: 'effective_type_dm',
  total: {
    core: 'totalCoreDM', area: 'totalAreaDM', free: 'totalFreeDM',
    required: 'totalRequiredDM', university: 'totalUniversityDM',
  },
};

function createController(overrides = {}) {
  const events = [];
  const requirements = overrides.requirements || {
    required: 3, core: 0, area: 0, groups: [],
  };
  const dependencies = {
    getRequirement() { return requirements; },
    isValidRequirement() { return true; },
    resolveGetInfo() {
      return (code, catalog) => (catalog || [])
        .find((record) => record.Major + record.Code === code) || null;
    },
    compareSemesters(left, right) { return left.order - right.order; },
    resolveAlternativeRules() {
      return { excluded: new Set(), typeOverride: new Map(), forceCore: new Set() };
    },
    languageCapForRequirements() { return null; },
    normalizedLanguageLevel(value) { return String(value || '').toLowerCase(); },
    languageCourseNeedsLevelReview() { return false; },
    isBasicLanguageCourse() { return false; },
    allocateCascade(staticType, credit, counters, limits, pinCore) {
      if (pinCore) {
        counters.core += credit;
        return 'core';
      }
      if (staticType === 'required') {
        if (counters.required < limits.required) {
          counters.required += credit;
          return 'required';
        }
        return 'free';
      }
      if (staticType === 'core') {
        if (counters.core < limits.core) {
          counters.core += credit;
          return 'core';
        }
        return 'free';
      }
      return staticType;
    },
    applyManDiversity() { events.push('man'); },
    parseCreditValue(value) { return Number.parseFloat(value || 0) || 0; },
    lookupCustomRecord() { return null; },
    recomputePrimaryCreditSplit() { events.push('recompute'); },
    notifyAllocationUpdated() { events.push('notify'); },
    mainFields: MAIN_FIELDS,
    doubleMajorFields: DM_FIELDS,
    basicLanguageExclusionReason: 'basic-limit',
    languageLevelReviewReason: 'language-review',
    ...overrides.dependencies,
  };
  return {
    controller: g.SurriculumModules.curriculumRecalculation.create(dependencies),
    events,
  };
}

function course(code) {
  return { code, grade: '', gradeBasis: 'letter' };
}

function curriculumFor(semesters) {
  return {
    semesters,
    major: 'CS',
    entryTerm: '202301',
    doubleMajor: '',
    entryTermDM: '',
    isDegreeEligibleCourse() { return true; },
    hasDegreeEligibleCourse() { return false; },
  };
}

test('recalculation installs a frozen dependency-injected controller API', () => {
  const api = g.SurriculumModules.curriculumRecalculation;
  assert.equal(Object.isFrozen(api), true);
  assert.equal(typeof api.create, 'function');
  assert.throws(
    () => api.create({}),
    /curriculum-recalculation requires getRequirement\(\)/,
  );
});

test('main allocation is synchronous, chronological, and preserves live identities', () => {
  const newerCourse = course('CS202');
  const olderCourse = course('CS201');
  const newer = { order: 2, courses: [newerCourse] };
  const older = { order: 1, courses: [olderCourse] };
  const semesters = [newer, older];
  const curriculum = curriculumFor(semesters);
  const catalog = [
    { Major: 'CS', Code: '201', EL_Type: 'required', SU_credit: '3', ECTS: '5' },
    { Major: 'CS', Code: '202', EL_Type: 'required', SU_credit: '3', ECTS: '5' },
  ];
  const { controller, events } = createController();

  const result = controller.recalculateMain(curriculum, catalog);

  assert.equal(result, undefined);
  assert.equal(curriculum.semesters, semesters);
  assert.equal(curriculum.semesters[0], newer,
    'chronological allocation must not reorder planner cards');
  assert.equal(older.courses[0], olderCourse);
  assert.equal(olderCourse.effective_type, 'required');
  assert.equal(newerCourse.effective_type, 'free');
  assert.equal(older.totalRequired, 3);
  assert.equal(newer.totalFree, 3);
  assert.equal(older.totalCredit, 3);
  assert.equal(newer.totalCredit, 3);
  assert.deepEqual(events, ['recompute', 'notify']);
});

test('double-major allocation uses parallel fields and honors notification suppression', () => {
  const occurrence = course('EE301');
  const semester = { order: 1, courses: [occurrence] };
  const curriculum = curriculumFor([semester]);
  curriculum.doubleMajor = 'EE';
  curriculum.entryTermDM = '202301';
  const catalog = [{
    Major: 'EE', Code: '301', EL_Type: 'core', SU_credit: '3',
    Basic_Science: '1', Engineering: '2', ECTS: '5', Faculty_Course: 'Engineering',
  }];
  const { controller, events } = createController({
    requirements: { required: 0, core: 3, area: 0, groups: [] },
  });

  controller.recalculateDoubleMajor(curriculum, catalog, { suppressNotify: true });

  assert.equal(occurrence.effective_type_dm, 'core');
  assert.equal(occurrence.categoryDM, 'Core');
  assert.equal(occurrence.effective_type, undefined);
  assert.equal(semester.totalCoreDM, 3);
  assert.equal(semester.totalScienceDM, 1);
  assert.equal(semester.totalEngineeringDM, 2);
  assert.equal(semester.totalECTSDM, 5);
  assert.deepEqual(events, ['recompute']);
});

test('the stateful constructor fails closed when the recalculation controller is absent', () => {
  const missing = loadScriptsGlobals([
    'scripts/domain/curriculum-allocation.js',
    'scripts/domain/curriculum-progress.js',
    'scripts/domain/requirement-engine.js',
    'scripts/domain/suggestion-candidate-impact.js',
    'scripts/domain/suggestion-progress-snapshot.js',
    'scripts/ui/curriculum-view.js',
    'scripts/s_curriculum.js',
  ]);
  assert.throws(
    () => new missing.s_curriculum(),
    /curriculum-recalculation\.js must load before s_curriculum\.js/,
  );
});

test('the reviewed curriculum stack loads recalculation before the model', () => {
  const modulePosition = CURRICULUM_SCRIPT_PATHS.indexOf(MODULE_PATH);
  const allocationPosition = CURRICULUM_SCRIPT_PATHS
    .indexOf('scripts/domain/curriculum-allocation.js');
  const modelPosition = CURRICULUM_SCRIPT_PATHS.indexOf('scripts/s_curriculum.js');
  assert.ok(allocationPosition >= 0);
  assert.ok(modulePosition > allocationPosition);
  assert.ok(modelPosition > modulePosition);
});
