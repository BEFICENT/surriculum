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
  for (const relative of [
    'scripts/app/transcript-custom-course-review.js',
    'scripts/app/program_context.js',
  ]) {
    vm.runInContext(
      fs.readFileSync(path.join(ROOT, relative), 'utf8'),
      sandbox,
      { filename: relative },
    );
  }
  return sandbox;
}

function model(overrides = {}) {
  const combined = (course) => String((course && course.Major) || '')
    + String((course && course.Code) || '');
  return {
    getCombinedCode: combined,
    normalizeCombinedCode: (value) => String(value || '').toUpperCase().replace(/\s+/g, ''),
    splitCombinedCode(value) {
      const match = String(value || '').match(/^([A-Z]+)(\d.*)$/);
      return match ? { major: match[1], code: match[2] } : null;
    },
    loadStoredCourses: () => [],
    creditNumber: (value) => Number(value) || 0,
    hasAnyNonZeroCredits: () => false,
    fillCreditsFromSource: () => false,
    findCourseByCombinedCode: (list, code) => list.find((course) => combined(course) === code) || null,
    identity: (value) => String(value || '').toUpperCase().replace(/\s+/g, ''),
    activeRecords: (records) => Array.isArray(records) ? records : [],
    ...overrides,
  };
}

function customCourseUi(overrides = {}) {
  return {
    restoreStoredValue() { return true; },
    createProgramCategoryHelp() {
      return { button: {}, panel: {} };
    },
    showPendingReview() {},
    runtime: {
      removeSemesterOccurrencesByCode() {},
      removeCourseDataRecord() {},
      getActiveContextProgramCodes() { return []; },
      replaceContextRuntimeCustomCourses() {},
      refreshCourseDatalistsAndTypes() {},
    },
    ...overrides,
  };
}

test('program context is frozen and binds one academic-import controller with live state', () => {
  const sandbox = loadModule();
  let courseData = [{ code: 'first' }];
  let curriculum = { id: 'curriculum-a' };
  let capturedOptions = null;
  let bindCount = 0;
  const importController = { bind() { bindCount += 1; } };
  const controller = sandbox.surriculumProgramContext.createController({
    model: model(),
    customCourseUi: customCourseUi(),
    state: {
      getCourseData: () => courseData,
      getCurriculum: () => curriculum,
    },
    academicImportFactory: {
      createController(options) {
        capturedOptions = options;
        return importController;
      },
    },
    appRuntime: { sessionPlanId: 'plan-a' },
    academicRecordsParser: { parser: true },
    pdfTranscriptReader: { pdf: true },
    loadCoursePageInfoIndex() {},
  });

  assert.equal(Object.isFrozen(sandbox.surriculumProgramContext), true);
  assert.equal(Object.isFrozen(controller), true);
  assert.equal(controller.bindAcademicImport(), importController);
  assert.equal(controller.bindAcademicImport(), importController);
  assert.equal(bindCount, 1);
  assert.equal(capturedOptions.sessionPlanId, 'plan-a');
  assert.equal(typeof capturedOptions.processPendingCustomCourses, 'function');
  assert.equal(capturedOptions.getCourseData(), courseData);
  assert.equal(capturedOptions.getCurriculum(), curriculum);

  courseData = [{ code: 'second' }];
  curriculum = { id: 'curriculum-b' };
  assert.equal(capturedOptions.getCourseData(), courseData);
  assert.equal(capturedOptions.getCurriculum(), curriculum);
});

test('pending transcript reviews preserve object identity and advance sequentially', () => {
  const shown = [];
  const ui = customCourseUi({ showPendingReview(options) { shown.push(options); } });
  const sandbox = loadModule();
  const controller = sandbox.surriculumProgramContext.createController({
    model: model(),
    customCourseUi: ui,
  });
  const firstCourse = { Major: 'ENS', Code: '491', Course_Name: 'Project' };
  const secondCourse = { Major: 'CS', Code: '499', Course_Name: 'Independent Study' };
  const pending = [
    { course: firstCourse, parsedInfo: { code: 'ENS491', title: 'Imported Project' } },
    { course: secondCourse },
  ];

  controller.processPendingCustomCourses(pending);
  assert.equal(shown.length, 1);
  assert.equal(shown[0].course, firstCourse);
  assert.equal(shown[0].prefill.code, 'ENS491');
  assert.equal(shown[0].prefill.name, 'Imported Project');
  assert.equal(typeof shown[0].onCancel, 'function');

  shown[0].onSave();
  assert.equal(shown.length, 2);
  assert.equal(shown[1].course, secondCourse);
  assert.equal(shown[1].prefill.code, 'CS499');
  assert.equal(pending.length, 0);
});

test('double-major loading keeps one shared catalog reference and refreshes pickers', async () => {
  const sandbox = loadModule();
  const primary = { Major: 'CS', Code: '101' };
  const dmOnly = { Major: 'EE', Code: '201' };
  const catalog = [dmOnly];
  const curriculum = {
    doubleMajor: '',
    recalcCalls: [],
    recalcEffectiveTypesDouble(data) { this.recalcCalls.push(data); },
  };
  let dmData = [];
  let dmCodes = new Set();
  let dmCustom = [{ stale: true }];
  const datalist = {};
  const populated = [];
  const loads = [];
  let releaseRequirements;
  const requirementsReady = new Promise((resolve) => { releaseRequirements = resolve; });
  const controller = sandbox.surriculumProgramContext.createController({
    model: model(),
    customCourseUi: customCourseUi(),
    document: { querySelectorAll() { return [datalist]; } },
    loadProgramCatalog(program, term) {
      loads.push([program, term]);
      return Promise.resolve(catalog);
    },
    populateCourseDataList(target, records) { populated.push([target, records]); },
    ensureRequirementsReady: () => requirementsReady,
    state: {
      getCurriculum: () => curriculum,
      getCourseData: () => [primary],
      getPrimaryCustomRecords: () => [],
      getPrimaryCatalogCodes: () => new Set(['CS101']),
      getDoubleMajorCourseData: () => dmData,
      setDoubleMajorCourseData: (records) => { dmData = records; },
      getDoubleMajorCatalogCodes: () => dmCodes,
      setDoubleMajorCatalogCodes: (codes) => { dmCodes = codes; },
      getDoubleMajorCustomRecords: () => dmCustom,
      setDoubleMajorCustomRecords: (records) => { dmCustom = records; },
      getDoubleMajorTermCode: () => '202601',
    },
  });

  const activation = controller.setDoubleMajor('EE');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(dmData.length, 0, 'catalog activation must wait for exact requirements');
  releaseRequirements();
  await activation;
  assert.deepEqual(loads, [['EE', '202601']]);
  assert.equal(curriculum.doubleMajor, 'EE');
  assert.equal(curriculum.entryTermDM, '202601');
  assert.equal(dmData, catalog);
  assert.equal(curriculum.doubleMajorCourseData, catalog);
  assert.equal(curriculum.recalcCalls.at(-1), catalog);
  assert.equal(dmCodes.has('EE201'), true);
  assert.equal(Array.isArray(dmCustom), true);
  assert.equal(dmCustom.length, 0);
  assert.equal(populated.at(-1)[0], datalist);
  assert.equal(populated.at(-1)[1][0], primary);
  assert.equal(populated.at(-1)[1][1], dmOnly);
});

test('bulk custom-course deletion fails closed before mutating planner state', async () => {
  const alerts = [];
  const mutations = [];
  const sandbox = loadModule();
  const primaryCourse = { Major: 'CUS', Code: '100' };
  const controller = sandbox.surriculumProgramContext.createController({
    model: model({
      loadStoredCourses(program) { return program === 'CS' ? [primaryCourse] : []; },
    }),
    customCourseUi: customCourseUi({
      runtime: {
        removeSemesterOccurrencesByCode() { mutations.push('semester'); },
        removeCourseDataRecord() { mutations.push('catalog'); },
        getActiveContextProgramCodes() { return []; },
        replaceContextRuntimeCustomCourses() { mutations.push('context'); },
        refreshCourseDatalistsAndTypes() {},
      },
    }),
    planGetItem: () => JSON.stringify([primaryCourse]),
    planRemoveItem: () => false,
    uiConfirm: async () => true,
    uiAlert: async (title) => { alerts.push(title); },
    state: {
      getPrimaryProgram: () => 'CS',
      getPrimaryCustomRecords: () => [primaryCourse],
      getPrimaryCatalogIdentities: () => new Set(),
    },
    location: { reload() { mutations.push('reload'); } },
  });

  await controller.deleteAllCustomCourses();
  assert.deepEqual(mutations, []);
  assert.deepEqual(alerts, ['Could not delete custom courses']);
});
