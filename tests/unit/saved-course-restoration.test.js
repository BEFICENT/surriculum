'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createSavedCourseRestoration } = require('../../scripts/app/saved-course-restoration');

function withGlobal(overrides, run) {
  const previous = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  return Promise.resolve().then(run).finally(() => {
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
}

function createHarness(overrides = {}) {
  const courseData = overrides.courseData || [];
  const curriculum = overrides.curriculum || { semesters: [], minorCourseDataByCode: {} };
  const api = createSavedCourseRestoration({
    getCourseData: () => courseData,
    getDoubleMajorCourseData: () => overrides.doubleMajorCourseData || [],
    getCurriculum: () => curriculum,
    planGetItem: (key) => (key === 'curriculum' ? JSON.stringify(overrides.saved || []) : null),
    parseCreditValue: Number,
    formatCreditValue: (value) => String(value),
    evaluateGrade: overrides.evaluateGrade || (() => null),
  });
  return { api, courseData, curriculum };
}

test('saved courses absent from selected catalogs receive plan-scoped placeholders', async () => {
  await withGlobal({
    getStoredGlobalCourseMetadata: () => new Map([[
      'ENS491', { title: 'Engineering Project', suCredits: 3, ects: 6 },
    ]]),
  }, async () => {
    const { api, courseData } = createHarness({ saved: [['ENS491', 'ENS491']] });
    const result = api.restore();

    assert.deepEqual(result.missing, ['ENS491']);
    assert.equal(result.preserved.length, 1);
    assert.equal(courseData.length, 1);
    assert.equal(courseData[0].Major, 'ENS');
    assert.equal(courseData[0].Code, '491');
    assert.equal(courseData[0].Course_Name, 'Engineering Project');
    assert.equal(courseData[0].SU_credit, '3');
    assert.equal(courseData[0].__storedCoursePlaceholder, true);
  });
});

test('selected-program records remain authoritative over saved placeholders', async () => {
  await withGlobal({
    getStoredGlobalCourseMetadata: () => new Map(),
  }, async () => {
    const { api, courseData } = createHarness({
      saved: [['ENS491']],
      doubleMajorCourseData: [{ Major: 'ENS', Code: '491', Course_Name: 'Official' }],
    });
    assert.deepEqual(api.restore(), { added: [], missing: [] });
    assert.deepEqual(courseData, []);
  });
});

test('background enrichment updates live courses and recomputes semester GPA', async () => {
  const labels = {
    '.course_name': { textContent: '' },
    '.course_credit': { textContent: '' },
    '.course_bs_credit': { textContent: '' },
  };
  const placeholder = {
    Major: 'ENS', Code: '491', __globalCourseDefinition: true, __storedCoursePlaceholder: true,
  };
  const liveCourse = { code: 'ENS491', id: 'course-1', grade: 'A', gradingBasis: 'letter' };
  const curriculum = {
    semesters: [{ courses: [liveCourse], totalGPA: 99, totalGPACredits: 99 }],
    minorCourseDataByCode: {},
    recalcEffectiveTypesCalls: 0,
    recalcEffectiveTypes() { this.recalcEffectiveTypesCalls += 1; },
  };
  const resolved = {
    Major: 'ENS', Code: '491', Course_Name: 'Engineering Project', SU_credit: '3',
    ECTS: '6', Basic_Science: '1', Engineering: '2', Faculty_Course: 'Yes', Faculty: 'FENS',
    __globalCourseDefinition: true,
  };
  const courseData = [placeholder];

  await withGlobal({
    document: {
      getElementById: () => ({ querySelector: (selector) => labels[selector] || null }),
    },
    loadCoursePageInfoIndex: async () => {},
    getStoredGlobalCourseMetadata: () => new Map(),
    resolveGlobalCourseDefinition: () => resolved,
    rememberGlobalCourseDefinition: () => {},
  }, async () => {
    const { api } = createHarness({
      courseData,
      curriculum,
      evaluateGrade: () => ({ countsInGpa: true, gpaPoints: 4 }),
    });
    await api.enrich({ preserved: [placeholder] });

    assert.equal(courseData[0], resolved);
    assert.equal(liveCourse.SU_credit, 3);
    assert.equal(liveCourse.ECTS, 6);
    assert.equal(curriculum.semesters[0].totalGPA, 12);
    assert.equal(curriculum.semesters[0].totalGPACredits, 3);
    assert.equal(curriculum.recalcEffectiveTypesCalls, 1);
    assert.equal(labels['.course_name'].textContent, 'Engineering Project');
    assert.equal(labels['.course_credit'].textContent, '3 credits');
  });
});
