'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScriptsGlobals } = require('./helpers/load-script');

const g = loadScriptsGlobals([
  'scripts/domain/academic-terms.js',
  'scripts/ui/course-history-table.js',
  'scripts/adapters/course-suggestion-scorer.js',
  'scripts/data/course-metadata.js',
  'scripts/storage/curriculum-persistence.js',
  'scripts/domain/curriculum-allocation.js',
  'scripts/domain/curriculum-recalculation.js',
  'scripts/domain/curriculum-progress.js',
  'scripts/domain/requirement-engine.js',
  'scripts/domain/suggestion-candidate-impact.js',
  'scripts/domain/suggestion-progress-snapshot.js',
  'scripts/ui/curriculum-view.js',
  'scripts/s_curriculum.js',
]);

test('the compatibility stack installs namespaced APIs without claiming SUrriculum', () => {
  assert.ok(g.SurriculumModules);
  assert.equal(g.SUrriculum, undefined,
    'main.js owns the SUrriculum planner-boot callable name');
  for (const name of [
    'academicTerms',
    'courseHistoryTable',
    'courseSuggestionScorer',
    'courseMetadata',
    'curriculumPersistence',
    'curriculumAllocation',
    'curriculumRecalculation',
    'curriculumProgress',
    'requirementEngine',
    'suggestionCandidateImpact',
    'suggestionProgressSnapshot',
    'curriculumView',
  ]) {
    assert.ok(g.SurriculumModules[name], `${name} namespace should be installed`);
    assert.equal(Object.isFrozen(g.SurriculumModules[name]), true);
  }
});

test('legacy consumers receive the same functions exposed by each module API', () => {
  assert.equal(g.termNameToCode, g.SurriculumModules.academicTerms.termNameToCode);
  assert.equal(g.computeCourseSuggestionScore,
    g.SurriculumModules.courseSuggestionScorer.score);
  assert.equal(g.populateCourseDataList,
    g.SurriculumModules.courseMetadata.populateCourseDataList);
  assert.equal(g.getCoursesList,
    g.SurriculumModules.courseMetadata.getCoursesList);
  assert.equal(g.buildCourseHistoryTableElement,
    g.SurriculumModules.courseHistoryTable.buildCourseHistoryTableElement);
  assert.equal(g.buildCourseHistoryTableElement([]), null);
  assert.equal(g.reload, g.SurriculumModules.curriculumPersistence.reload);
  assert.equal(g.allocateCascade,
    g.SurriculumModules.curriculumAllocation.allocateCascade);
  assert.equal(g.courseProgressState,
    g.SurriculumModules.curriculumProgress.courseProgressState);
  assert.equal(g.evaluateRules, g.SurriculumModules.requirementEngine.evaluateRules);
  assert.equal(g.renderAllocationLabels,
    g.SurriculumModules.curriculumView.renderAllocationLabels);
  assert.equal(typeof g.SurriculumModules.curriculumView.createAllocationUpdateHandler,
    'function');
  assert.equal(typeof g.s_curriculum, 'function');
});

test('curriculum persistence owns its storage identity and credit parsing boundaries', () => {
  const isolated = loadScriptsGlobals('scripts/storage/curriculum-persistence.js');
  const semester = {
    totalCredit: 0,
    totalScience: 0,
    totalEngineering: 0,
    totalECTS: 0,
    totalFree: 0,
    totalArea: 0,
    totalCore: 0,
    totalUniversity: 0,
    totalRequired: 0,
  };

  isolated.parseCreditValue = () => {
    throw new Error('the late ES-module bridge must not be consulted');
  };
  isolated.adjustSemesterTotals(semester, {
    SU_credit: '2,5',
    Basic_Science: '1',
    Engineering: '2',
    ECTS: '5',
    EL_Type: 'core',
  }, 1);
  assert.equal(semester.totalCredit, 2.5);
  assert.equal(semester.totalCore, 2.5);

  isolated.SurriculumModules.courseMetadata = {
    getPlanStorageSessionId() {
      throw new Error('persistence must not reach upward into metadata');
    },
  };
  const reads = [];
  isolated.planStorage = {
    getSessionPlanId() { return 'plan-boundary'; },
    getItem(key, planId) {
      reads.push([key, planId]);
      return key === 'curriculum' ? '[]' : null;
    },
  };
  isolated.reload({ semesters: [] }, []);
  assert.ok(reads.length > 0);
  assert.ok(reads.every(([, planId]) => planId === 'plan-boundary'));
});

test('allocation publishes one model update through an injected controller hook', () => {
  const isolated = loadScriptsGlobals([
    'scripts/domain/curriculum-allocation.js',
    'scripts/domain/curriculum-recalculation.js',
    'scripts/domain/curriculum-progress.js',
    'scripts/domain/requirement-engine.js',
    'scripts/domain/suggestion-candidate-impact.js',
    'scripts/domain/suggestion-progress-snapshot.js',
    'scripts/ui/curriculum-view.js',
    'scripts/s_curriculum.js',
  ]);
  isolated.requirements = {
    '202301': {
      CS: {
        university: 0,
        required: 0,
        core: 0,
        area: 0,
        free: 0,
        ects: 1,
        total: 1,
        humRequired: 0,
        facultyReq: {},
      },
    },
  };
  isolated.getInfo = () => null;

  const curriculum = new isolated.s_curriculum();
  curriculum.major = 'CS';
  curriculum.entryTerm = '202301';
  let updates = 0;
  curriculum.setAllocationUpdateHandler((updated) => {
    assert.equal(updated, curriculum);
    updates += 1;
  });

  curriculum.recalcEffectiveTypes([]);
  assert.equal(updates, 1);
  assert.equal(typeof isolated.document, 'undefined',
    'the allocation model must not require a DOM to publish its update');
});

test('curriculum view composes picker and requisite follow-up outside the domain model', () => {
  const isolated = loadScriptsGlobals('scripts/ui/curriculum-view.js');
  const calls = [];
  const curriculum = { semesters: [] };
  const handler = isolated.SurriculumModules.curriculumView.createAllocationUpdateHandler({
    updateCourseLists(updated) { calls.push(['courses', updated]); },
    queueRequisiteWarnings(updated) { calls.push(['requisites', updated]); },
  });
  handler(curriculum);
  assert.deepEqual(calls.map(([name, value]) => [name, value === curriculum]), [
    ['courses', true],
    ['requisites', true],
  ]);
});
