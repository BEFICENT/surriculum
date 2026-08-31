'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');

function loadModule(overrides = {}) {
  const sandbox = {
    console: { error() {}, warn() {}, log() {} },
    ...overrides,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync(
      path.join(ROOT, 'scripts/app/transcript-custom-course-review.js'),
      'utf8',
    ),
    sandbox,
    { filename: 'scripts/app/transcript-custom-course-review.js' },
  );
  return sandbox;
}

function createModel(storage = new Map()) {
  const combined = (course) => String((course && course.Major) || '')
    + String((course && course.Code) || '');
  return {
    getCombinedCode: combined,
    loadStoredCourses(program) {
      return JSON.parse(storage.get(`customCourses_${program}`) || '[]');
    },
  };
}

function createUi(overrides = {}) {
  const runtimeOverrides = overrides.runtime || {};
  return {
    restoreStoredValue() { return true; },
    showPendingReview() {},
    ...overrides,
    runtime: {
      getActiveContextProgramCodes() { return []; },
      replaceContextRuntimeCustomCourses() {},
      refreshCourseDatalistsAndTypes() {},
      ...runtimeOverrides,
    },
  };
}

test('transcript review module is frozen and preserves queued course identity', () => {
  const shown = [];
  const sandbox = loadModule();
  const controller = sandbox.surriculumTranscriptCustomCourseReview.createController({
    model: createModel(),
    customCourseUi: createUi({ showPendingReview(options) { shown.push(options); } }),
  });
  const firstCourse = {
    Major: 'ENS',
    Code: '491',
    Course_Name: 'Project',
    Language_Level: 'Advanced',
  };
  const secondCourse = { Major: 'CS', Code: '499', Course_Name: 'Independent Study' };
  const pending = [
    {
      course: firstCourse,
      parsedInfo: {
        code: 'ENS491',
        title: 'Imported Project',
        Language_Level: 'Intermediate',
      },
    },
    { course: secondCourse },
  ];

  controller.processPendingCustomCourses(pending);

  assert.equal(Object.isFrozen(sandbox.surriculumTranscriptCustomCourseReview), true);
  assert.equal(Object.isFrozen(controller), true);
  assert.equal(shown.length, 1);
  assert.equal(shown[0].course, firstCourse);
  assert.equal(shown[0].prefill.code, 'ENS491');
  assert.equal(shown[0].prefill.name, 'Imported Project');
  assert.equal(shown[0].prefill.languageLevel, 'Intermediate');
  assert.equal(typeof shown[0].onCancel, 'function');

  shown[0].onSave();
  assert.equal(shown.length, 2);
  assert.equal(shown[1].course, secondCourse);
  assert.equal(shown[1].prefill.code, 'CS499');
  assert.equal(pending.length, 0);
});

test('rollback restores linked program definitions and exact live object identity', () => {
  const pendingPrimary = { Major: 'LANG', Code: '100', Course_Name: 'Imported primary' };
  const previousPrimary = { Major: 'LANG', Code: '100', Course_Name: 'Previous primary' };
  const pendingDouble = { Major: 'LANG', Code: '100', Course_Name: 'Imported double' };
  const previousDouble = { Major: 'LANG', Code: '100', Course_Name: 'Previous double' };
  const untouched = { Major: 'LANG', Code: '200', Course_Name: 'Untouched' };
  const storage = new Map([
    ['customCourses_CS', JSON.stringify([pendingPrimary, untouched])],
    ['customCourses_EE', JSON.stringify([pendingDouble, untouched])],
  ]);
  const primaryRecords = [pendingPrimary];
  const courseData = [pendingPrimary];
  const occurrence = { id: 'course-1', code: 'LANG100' };
  const semester = { id: 'semester-1', courses: [occurrence] };
  const curriculum = { major: 'CS', semesters: [semester] };
  const contextRefreshes = [];
  let refreshCount = 0;
  let saveCount = 0;
  const sandbox = loadModule();
  const controller = sandbox.surriculumTranscriptCustomCourseReview.createController({
    model: createModel(storage),
    customCourseUi: createUi({
      restoreStoredValue(key, raw) { storage.set(key, raw); return true; },
      runtime: {
        getActiveContextProgramCodes() { return ['EE']; },
        replaceContextRuntimeCustomCourses(program, records) {
          contextRefreshes.push([program, records]);
        },
        refreshCourseDatalistsAndTypes() { refreshCount += 1; },
      },
    }),
    document: { getElementById() { return null; } },
    planGetItem: (key) => storage.get(key) || null,
    planSetItem(key, value) { storage.set(key, value); return true; },
    requestPlanSave() { saveCount += 1; return true; },
    state: {
      getCurriculum: () => curriculum,
      getCourseData: () => courseData,
      getPrimaryProgram: () => 'CS',
      getPrimaryCustomRecords: () => primaryRecords,
    },
  });

  const result = controller.rollbackPendingTranscriptCustomCourse({
    course: pendingPrimary,
    courseDataMutation: {
      kind: 'replaced',
      index: 0,
      previousCourse: previousPrimary,
    },
    programCourses: [
      { program: 'CS', course: pendingPrimary, previousCourse: previousPrimary },
      { program: 'EE', course: pendingDouble, previousCourse: previousDouble },
    ],
  });

  assert.equal(result, true);
  assert.equal(primaryRecords[0], previousPrimary);
  assert.equal(courseData[0], previousPrimary);
  assert.equal(curriculum.semesters.length, 0);
  assert.deepEqual(JSON.parse(storage.get('customCourses_CS')), [previousPrimary, untouched]);
  assert.deepEqual(JSON.parse(storage.get('customCourses_EE')), [previousDouble, untouched]);
  assert.equal(contextRefreshes.length, 1);
  assert.equal(contextRefreshes[0][0], 'EE');
  assert.deepEqual(contextRefreshes[0][1], [previousDouble, untouched]);
  assert.equal(refreshCount, 1);
  assert.equal(saveCount, 1);
});

test('multi-program rollback fails closed and restores earlier durable writes', () => {
  const pendingPrimary = { Major: 'LANG', Code: '100', Course_Name: 'Imported primary' };
  const pendingDouble = { Major: 'LANG', Code: '100', Course_Name: 'Imported double' };
  const originalPrimaryRaw = JSON.stringify([pendingPrimary]);
  const storage = new Map([
    ['customCourses_CS', originalPrimaryRaw],
    ['customCourses_EE', '[]'],
  ]);
  const alerts = [];
  const primaryRecords = [pendingPrimary];
  const courseData = [pendingPrimary];
  const curriculum = {
    major: 'CS',
    semesters: [{ courses: [{ code: 'LANG100' }] }],
  };
  const sandbox = loadModule();
  const controller = sandbox.surriculumTranscriptCustomCourseReview.createController({
    model: createModel(storage),
    customCourseUi: createUi({
      restoreStoredValue(key, raw) { storage.set(key, raw); return true; },
    }),
    planGetItem: (key) => storage.get(key) || null,
    planSetItem(key, value) { storage.set(key, value); return true; },
    uiAlert(title) { alerts.push(title); return Promise.resolve(); },
    state: {
      getCurriculum: () => curriculum,
      getCourseData: () => courseData,
      getPrimaryProgram: () => 'CS',
      getPrimaryCustomRecords: () => primaryRecords,
    },
  });

  const result = controller.rollbackPendingTranscriptCustomCourse({
    course: pendingPrimary,
    programCourses: [
      { program: 'CS', course: pendingPrimary },
      { program: 'EE', course: pendingDouble },
    ],
  });

  assert.equal(result, false);
  assert.equal(storage.get('customCourses_CS'), originalPrimaryRaw);
  assert.equal(primaryRecords[0], pendingPrimary);
  assert.equal(courseData[0], pendingPrimary);
  assert.equal(curriculum.semesters[0].courses.length, 1);
  assert.deepEqual(alerts, ['Could not remove imported course']);
});
