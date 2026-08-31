const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
function load(file, sandbox) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), sandbox, { filename: file });
}
function sandbox() {
  const value = { console, setTimeout, clearTimeout };
  value.window = value;
  value.globalThis = value;
  vm.createContext(value);
  return value;
}

test('custom model canonicalizes identities and filters official or ambiguous overlays', () => {
  const scope = sandbox();
  load('scripts/app/custom_course_model.js', scope);
  const model = scope.surriculumCustomCourseModel.create({
    canonicalize(code) { return code === 'PHIL300' ? 'PHIL301' : code; },
    getPlanItem() { return '[]'; },
    normalizeList(_program, list) { return list; },
  });
  const records = [
    { Major: 'PHIL', Code: '300' },
    { Major: 'CS', Code: '299' },
    { Major: 'CS', Code: '299' },
    { Major: 'HUM', Code: '201' },
  ];

  assert.equal(model.identity(' phil 300 '), 'PHIL301');
  assert.deepEqual(
    Array.from(model.activeRecords(records, new Set(['PHIL301']))).map(model.getCombinedCode),
    ['HUM201'],
  );
  assert.equal(model.findStorageIndex(records, 'CS299'), -1);
  assert.equal(model.findStorageIndex(records, 'HUM201'), 3);
  assert.equal(model.isLanguageCandidate('FRE101', '', '', ''), true);
  assert.equal(model.isLanguageCandidate('TLL101', 'Academic Writing', 'SL', ''), false);
});

test('custom model fills only zero credit fields and preserves field representation', () => {
  const scope = sandbox();
  load('scripts/app/custom_course_model.js', scope);
  const model = scope.surriculumCustomCourseModel.create();
  const target = { ECTS: '0', SU_credit: '1', Engineering: 0, Basic_Science: 0 };

  assert.equal(model.fillCreditsFromSource(target, {
    ECTS: '6', SU_credit: '3', Engineering: 2, Basic_Science: 1,
  }), true);
  assert.deepEqual(
    {
      ECTS: target.ECTS,
      SU_credit: target.SU_credit,
      Engineering: target.Engineering,
      Basic_Science: target.Basic_Science,
    },
    { ECTS: '6', SU_credit: '1', Engineering: 2, Basic_Science: 1 },
  );
});

test('custom runtime preserves double-major array identity and official precedence', () => {
  const scope = sandbox();
  load('scripts/app/custom_course_model.js', scope);
  load('scripts/app/custom_course_runtime.js', scope);
  const model = scope.surriculumCustomCourseModel.create({
    canonicalize(code) { return code === 'PHIL300' ? 'PHIL301' : code; },
  });

  const official = { Major: 'PHIL', Code: '301', EL_Type: 'core' };
  const doubleMajorData = [official];
  const originalReference = doubleMajorData;
  let customRecords = [];
  const curriculum = { doubleMajor: 'PHIL', doubleMajorCourseData: doubleMajorData, minors: [] };
  const controller = scope.surriculumCustomCourseRuntime.createController({
    model,
    document: { getElementById() { return null; }, querySelectorAll() { return []; } },
    normalizeList(_program, list) { return list; },
    state: {
      getCurriculum: () => curriculum,
      getCourseData: () => [],
      getPrimaryProgram: () => 'CS',
      getPrimaryCatalogCodes: () => new Set(),
      getPrimaryCustomRecords: () => [],
      setPrimaryCustomRecords() {},
      getDoubleMajorCourseData: () => doubleMajorData,
      getDoubleMajorCatalogCodes: () => new Set(['PHIL301']),
      getDoubleMajorCustomRecords: () => customRecords,
      setDoubleMajorCustomRecords(records) { customRecords = records; },
      getMinorCourseData: () => ({}),
      getMinorCatalogCodeSets: () => ({}),
      getMinorCustomRecords: () => ({}),
    },
  });

  controller.replaceContextRuntimeCustomCourses('PHIL', [
    { Major: 'PHIL', Code: '300', EL_Type: 'free' },
    { Major: 'HUM', Code: '201', EL_Type: 'university' },
  ]);
  assert.equal(doubleMajorData, originalReference);
  assert.equal(curriculum.doubleMajorCourseData, originalReference);
  assert.deepEqual(doubleMajorData.map(model.getCombinedCode), ['PHIL301', 'HUM201']);
  assert.deepEqual(customRecords.map(model.getCombinedCode), ['HUM201']);
});

test('custom runtime renames string and object semester occurrences', () => {
  const scope = sandbox();
  load('scripts/app/custom_course_model.js', scope);
  load('scripts/app/custom_course_runtime.js', scope);
  const model = scope.surriculumCustomCourseModel.create();
  const semesters = [{
    id: 'semester-1',
    courses: ['CS299', { id: 'course-1', code: 'CS299' }, 'MATH101'],
  }];
  const curriculum = { semesters, minors: [] };
  const controller = scope.surriculumCustomCourseRuntime.createController({
    model,
    document: { getElementById() { return null; }, querySelectorAll() { return []; } },
    state: {
      getCurriculum: () => curriculum,
      getCourseData: () => [],
      getPrimaryProgram: () => 'CS',
      getPrimaryCatalogCodes: () => new Set(),
      getPrimaryCustomRecords: () => [],
      setPrimaryCustomRecords() {},
      getDoubleMajorCourseData: () => [],
      getDoubleMajorCatalogCodes: () => new Set(),
      getDoubleMajorCustomRecords: () => [],
      setDoubleMajorCustomRecords() {},
      getMinorCourseData: () => ({}),
      getMinorCatalogCodeSets: () => ({}),
      getMinorCustomRecords: () => ({}),
    },
  });

  const changed = controller.renameSemesterOccurrences('CS299', 'CS300', null);
  assert.equal(changed.length, 2);
  assert.equal(semesters[0].courses[0], 'CS300');
  assert.equal(semesters[0].courses[1].code, 'CS300');
  assert.equal(semesters[0].courses[2], 'MATH101');
});

test('focused custom-course modules compose in their declared runtime order', () => {
  const scope = sandbox();
  for (const file of [
    'scripts/app/custom_course_model.js',
    'scripts/app/custom_course_runtime.js',
    'scripts/app/custom_course_manager.js',
    'scripts/app/custom_course_form.js',
    'scripts/app/custom_course_ui.js',
  ]) load(file, scope);

  const document = {
    querySelector() { return null; },
    querySelectorAll() { return []; },
    getElementById() { return null; },
  };
  const model = scope.surriculumCustomCourseModel.create({
    getPlanItem() { return '[]'; },
  });
  const controller = scope.surriculumCustomCourseUi.createController({
    model,
    document,
    state: {
      getCurriculum: () => ({ semesters: [], minors: [] }),
      getCourseData: () => [],
      getPrimaryProgram: () => 'CS',
      getPrimaryCatalogCodes: () => new Set(),
      getPrimaryCatalogIdentities: () => new Set(),
      getPrimaryCatalogData: () => [],
      getPrimaryCustomRecords: () => [],
      setPrimaryCustomRecords() {},
      getDoubleMajorCourseData: () => [],
      getDoubleMajorCatalogCodes: () => new Set(),
      getDoubleMajorCustomRecords: () => [],
      setDoubleMajorCustomRecords() {},
      getMinorCourseData: () => ({}),
      getMinorCatalogCodeSets: () => ({}),
      getMinorCustomRecords: () => ({}),
    },
  });

  assert.equal(Object.isFrozen(controller), true);
  assert.equal(Object.isFrozen(controller.runtime), true);
  assert.equal(typeof controller.showForm, 'function');
  assert.equal(typeof controller.showManager, 'function');
  assert.equal(typeof controller.removeByCode, 'function');
});

test('custom UI composes the runtime, reads live state, and binds controls once', async () => {
  const scope = sandbox();
  load('scripts/app/custom_course_manager.js', scope);
  load('scripts/app/custom_course_form.js', scope);
  load('scripts/app/custom_course_ui.js', scope);

  assert.deepEqual(Object.keys(scope.surriculumCustomCourseManager), ['createController']);
  assert.deepEqual(Object.keys(scope.surriculumCustomCourseForm), ['createController']);
  assert.equal(Object.isFrozen(scope.surriculumCustomCourseManager), true);
  assert.equal(Object.isFrozen(scope.surriculumCustomCourseForm), true);

  const writes = [];
  const loadedPrograms = [];
  const listeners = new Map();
  const button = (selector) => ({
    addEventListener(type, handler) {
      const key = `${selector}:${type}`;
      const registered = listeners.get(key) || [];
      registered.push(handler);
      listeners.set(key, registered);
    },
  });
  const buttons = new Map([
    ['.customCourse', button('.customCourse')],
    ['.manageCustomCourses', button('.manageCustomCourses')],
    ['.deleteCustom', button('.deleteCustom')],
  ]);
  const document = {
    querySelector(selector) { return buttons.get(selector) || null; },
  };
  let primaryProgram = 'CS';
  const state = {
    getCurriculum: () => ({ semesters: [], minors: [] }),
    getCourseData: () => [],
    getPrimaryProgram: () => primaryProgram,
    getPrimaryCatalogCodes: () => new Set(),
    getPrimaryCatalogIdentities: () => new Set(),
    getPrimaryCatalogData: () => [],
    getPrimaryCustomRecords: () => [],
    setPrimaryCustomRecords() {},
    getDoubleMajorCourseData: () => [],
    getDoubleMajorCatalogCodes: () => new Set(),
    getDoubleMajorCustomRecords: () => [],
    setDoubleMajorCustomRecords() {},
    getMinorCourseData: () => ({}),
    getMinorCatalogCodeSets: () => ({}),
    getMinorCustomRecords: () => ({}),
  };
  const model = {
    getCombinedCode(course) { return `${course.Major || ''}${course.Code || ''}`; },
    normalizeCombinedCode(code) { return String(code || '').replace(/\s+/g, '').toUpperCase(); },
    splitCombinedCode() { return null; },
    titleExplicitlySaysBasicLanguage() { return false; },
    isLanguageCandidate() { return false; },
    findStorageIndex() { return 0; },
    loadStoredCourses(program) {
      loadedPrograms.push(program);
      return program === 'BIO' ? [{ Major: 'BIO', Code: '299', EL_Type: 'free' }] : [];
    },
    identity(code) { return String(code || '').replace(/\s+/g, '').toUpperCase(); },
  };
  const runtime = Object.freeze({
    renameSemesterOccurrences() {},
    refreshSemesterOccurrenceDom() {},
    removeSemesterOccurrencesByCode() {},
    removeCourseDataRecord() {},
    removeDoubleMajorCustomRecordsAt() {},
    getActiveContextProgramCodes() { return []; },
    findOfficialContextCourse() { return null; },
    replaceContextRuntimeCustomCourses() {},
    replacePrimaryRuntimeCustomCourses() {},
    refreshCourseDatalistsAndTypes() {},
  });
  let runtimeOptions = null;
  const runtimeFactory = {
    createController(options) { runtimeOptions = options; return runtime; },
  };
  const controller = scope.surriculumCustomCourseUi.createController({
    model,
    runtimeFactory,
    document,
    state,
    planGetItem() { return '[{"Major":"BIO","Code":"299"}]'; },
    planSetItem(key, value) { writes.push([key, value]); return true; },
    requestPlanSave() { return true; },
    flushPlanSaves() { return true; },
  });

  assert.equal(runtimeOptions.model, model);
  assert.equal(runtimeOptions.state, state);
  assert.equal(controller.runtime, runtime);
  assert.equal(Object.isFrozen(controller), true);
  assert.equal(Object.isFrozen(scope.surriculumCustomCourseUi), true);
  assert.deepEqual(Object.keys(scope.surriculumCustomCourseUi), ['createController']);
  assert.deepEqual(Array.from(Object.keys(controller)).sort(), [
    'bind',
    'createProgramCategoryHelp',
    'removeByCode',
    'restoreStoredValue',
    'runtime',
    'showForm',
    'showManager',
    'showPendingReview',
  ]);

  let deleteAllCalls = 0;
  controller.bind({ onDeleteAll() { deleteAllCalls += 1; } });
  controller.bind({ onDeleteAll() { deleteAllCalls += 100; } });
  assert.equal(listeners.get('.customCourse:click').length, 1);
  assert.equal(listeners.get('.manageCustomCourses:click').length, 1);
  assert.equal(listeners.get('.deleteCustom:click').length, 1);
  listeners.get('.deleteCustom:click')[0]();
  assert.equal(deleteAllCalls, 1);

  primaryProgram = 'BIO';
  assert.equal(await controller.removeByCode('BIO299', 0), true);
  assert.equal(loadedPrograms[0], 'BIO', 'the operation reads the program when invoked');
  assert.equal(writes[0][0], 'customCourses_BIO');
});

test('custom UI fails clearly when its focused modules are loaded out of order', () => {
  const scope = sandbox();
  load('scripts/app/custom_course_ui.js', scope);
  const model = {
    getCombinedCode() { return ''; },
    normalizeCombinedCode() { return ''; },
    splitCombinedCode() { return null; },
    titleExplicitlySaysBasicLanguage() { return false; },
    isLanguageCandidate() { return false; },
    findStorageIndex() { return -1; },
    loadStoredCourses() { return []; },
    identity(value) { return value; },
  };
  const runtimeFactory = {
    createController() { return {}; },
  };
  assert.throws(
    () => scope.surriculumCustomCourseUi.createController({ model, runtimeFactory }),
    /requires the custom-course form module/,
  );
});
