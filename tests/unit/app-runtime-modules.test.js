const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

function context(overrides = {}) {
  const sandbox = {
    console: { error() {}, warn() {}, log() {} },
    setTimeout(callback) { callback(); return 1; },
    clearTimeout() {},
    ...overrides,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  return sandbox;
}

function load(file, sandbox) {
  vm.runInContext(read(file), sandbox, { filename: file });
  return sandbox;
}

function storage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    values,
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); return true; },
    removeItem(key) { values.delete(key); return true; },
  };
}

test('main delegates each extracted app responsibility', () => {
  const main = read('main.js');
  const programContext = read('scripts/app/program_context.js');
  const transcriptReview = read('scripts/app/transcript-custom-course-review.js');
  const programSelection = read('scripts/app/program-selection-controller.js');
  assert.ok(main.split(/\r?\n/).length <= 1050);
  for (const contract of [
    'surriculumProgramData.loadTermManifest',
    'programData.loadProgramCatalog',
    'programData.loadMinorCatalog',
    'initializeRequirementsAsync',
    'initializeMinorRequirementsAsync',
    'surriculumAppRuntime.configure',
    'curriculum.setAllocationUpdateHandler',
    'curriculumView.createAllocationUpdateHandler',
    'requisites.queuePlannerWarningRefresh',
    'surriculumCustomCourseModel.create',
    'surriculumCustomCourseUi.createController',
    'surriculumProgramContext.createController',
    'programContext.bindAcademicImport',
    'programContext.setDoubleMajor',
    'surriculumOnboarding.init',
    'surriculumMobileNotice.init',
    'surriculumPlannerPreferences.createController',
    'surriculumSavedCourseRestoration.createSavedCourseRestoration',
    'surriculumAppShell.createController',
    'surriculumProgramSelection.createController',
    'appShellController.bindSidebar',
    'appShellController.bindHeaderAndImportMenus',
  ]) assert.match(main, new RegExp(contract.replace('.', '\\.')));
  assert.doesNotMatch(main, /new XMLHttpRequest\s*\(/);
  assert.match(main, /await Promise\.all\(requirementReadiness\)/);
  assert.match(main, /await SUrriculum\(/);
  assert.match(main, /window\.__surriculumReady\s*=\s*false/);
  assert.match(main, /window\.__surriculumPlannerReady\s*=\s*false/);
  assert.match(main, /window\.whenSurriculumPlannerReady\s*=\s*\(\)\s*=>\s*surriculumPlannerReadyPromise/);
  assert.match(main, /settleSurriculumPlannerReady\(true\)/);
  assert.match(main, /window\.surriculumReadyPromise\s*=\s*surriculumReadyPromise/);
  assert.match(main, /window\.whenSurriculumReady\s*=\s*\(\)\s*=>\s*surriculumReadyPromise/);
  assert.match(main, /if \(!isBootPlanAvailable\(\)\) return false/);
  assert.match(main, /updateCourseLists:\s*\(\)\s*=>\s*\{[\s\S]*?window\.updateDatalistForDoubleMajor\(\)/);
  assert.ok(
    main.lastIndexOf('surriculumOnboarding.init()') < main.lastIndexOf('surriculumProgramData.loadTermManifest()'),
    'readiness consumers must register before the async manifest starts planner boot',
  );
  assert.doesNotMatch(main, /async function handleAcademicRecordsImport/);
  assert.doesNotMatch(main, /function showCustomCourseForm/);
  assert.doesNotMatch(main, /function showManageCustomCoursesModal/);
  assert.doesNotMatch(main, /function rollbackPendingTranscriptCustomCourse/);
  assert.doesNotMatch(main, /function setDoubleMajor/);
  assert.doesNotMatch(main, /function handleDeleteCustomCourses/);
  assert.doesNotMatch(main, /const helpGuideHtml/);
  assert.doesNotMatch(main, /touchStartX/);
  assert.doesNotMatch(main, /getElementById\('headerMore'\)/);
  assert.doesNotMatch(main, /doubleMajorControlsRow/);
  assert.doesNotMatch(main, /bindMinorTermSelect/);
  assert.doesNotMatch(programContext, /customCourseUi\.showPendingReview/);
  assert.doesNotMatch(programContext, /function rollbackPendingTranscriptCustomCourse/);
  assert.match(programContext, /transcriptReviewFactory\.createController/);
  assert.match(transcriptReview, /customCourseUi\.showPendingReview/);
  assert.match(transcriptReview, /function rollbackPendingTranscriptCustomCourse/);
  assert.doesNotMatch(
    transcriptReview,
    /function setDoubleMajor|function handleDeleteCustomCourses|academicImportFactory/,
  );
  assert.match(programContext, /function setDoubleMajor/);
  assert.match(programContext, /function handleDeleteCustomCourses/);
  assert.match(programContext, /function bindAcademicImport/);
  assert.match(programContext, /factory\.createController/);
  assert.match(programContext, /ensureRequirementsReady/);
  assert.match(programSelection, /updateMinorOptionAvailability/);
  assert.match(programSelection, /entryTermMinor\$\{slot\}/);
});

test('classic app modules load in dependency order immediately before main', () => {
  const html = read('index.html');
  const expected = [
    'scripts/app/program-data.js',
    'scripts/app/runtime.js',
    'scripts/app/custom_course_model.js',
    'scripts/app/custom_course_runtime.js',
    'scripts/app/custom_course_manager.js',
    'scripts/app/custom_course_form.js',
    'scripts/app/custom_course_ui.js',
    'scripts/app/academic_records_import.js',
    'scripts/app/transcript-custom-course-review.js',
    'scripts/app/program_context.js',
    'scripts/app/onboarding.js',
    'scripts/app/mobile_notice.js',
    'scripts/app/planner-preferences.js',
    'scripts/app/saved-course-restoration.js',
    'scripts/app/shell-controller.js',
    'scripts/app/program-selection-controller.js',
    'main.js',
  ];
  let previous = -1;
  for (const file of expected) {
    const index = html.indexOf(`src="${file}"`);
    assert.ok(index > previous, `${file} must follow its dependencies`);
    const tagStart = html.lastIndexOf('<script', index);
    const tagEnd = html.indexOf('>', index);
    assert.match(html.slice(tagStart, tagEnd + 1), /\bdefer\b/);
    previous = index;
  }
});

test('SUrriculum keeps its callable name while async readiness stays explicit', () => {
  const main = read('main.js');
  const architecture = read('docs/architecture.md');
  assert.match(main, /async function SUrriculum\(major_chosen_by_user, bootManifest\)/);
  assert.match(main, /const surriculumReadyPromise\s*=\s*startSurriculum\(\)/);
  assert.match(main, /window\.surriculumReadyPromise\s*=\s*surriculumReadyPromise/);
  assert.match(main, /window\.whenSurriculumReady\s*=\s*\(\)\s*=>\s*surriculumReadyPromise/);
  assert.match(main, /window\.whenSurriculumPlannerReady\s*=\s*\(\)\s*=>\s*surriculumPlannerReadyPromise/);
  assert.match(architecture, /`SUrriculum` remains callable for name\s+compatibility/);
  assert.match(architecture, /returns a Promise/);
});

test('runtime pins plan id, builds warmup URLs, and latches write failure', () => {
  const calls = [];
  const planStorage = storage({
    major: 'CS',
    entryTerm: 'Fall 2025-2026',
    doubleMajor: 'EE',
    entryTermDM: '202601',
    minor1: 'MAT-MIN',
    entryTermMinor1: '202602',
  });
  planStorage.getSessionPlanId = () => 'plan-a';
  planStorage.getItem = (key, planId) => {
    calls.push(['get', key, planId]);
    return planStorage.values.has(key) ? planStorage.values.get(key) : null;
  };
  planStorage.setItem = (key, value, planId) => {
    calls.push(['set', key, planId]);
    return key === 'fail' ? false : true;
  };
  planStorage.flushSaves = () => true;
  const alerts = [];
  const sandbox = context({
    navigator: {},
    planStorage,
    preferenceStorage: storage(),
    localStorage: storage(),
    uiModal: { alert(title) { alerts.push(title); return Promise.resolve(); } },
    location: { reload() { calls.push(['reload']); } },
    termNameToCode(value) { return value === 'Fall 2025-2026' ? '202601' : value; },
  });
  load('scripts/app/runtime.js', sandbox);

  assert.equal(sandbox.planGetItem('major'), 'CS');
  assert.equal(sandbox.planSetItem('major', 'BIO'), true);
  assert.ok(calls.some((call) => call[2] === 'plan-a'));
  assert.deepEqual(Array.from(sandbox.surriculumAppRuntime.selectedPlanDataPaths()), [
    'requirements/202601.jsonl',
    'courses/202601/CS.jsonl',
    'courses/202601/EE.jsonl',
    'requirements/minors/202602.jsonl',
    'courses/minors/202602/MAT-MIN.jsonl',
  ]);
  assert.equal(sandbox.planSetItem('fail', 'x'), false);
  assert.equal(sandbox.reloadAfterPlanFlush(), false);
  assert.deepEqual(alerts, ['Could not save changes']);
  assert.equal(calls.some((call) => call[0] === 'reload'), false);
  assert.equal(sandbox._planIdForSession, 'plan-a');
  assert.equal(Object.isFrozen(sandbox.surriculumAppRuntime), true);
});

test('runtime treats a deleted pinned plan as a cancelled document', () => {
  const calls = [];
  const planStorage = {
    getSessionPlanId: () => 'deleted-plan',
    hasPlan: () => false,
    getItem() { calls.push('get'); return 'unexpected'; },
    setItem() { calls.push('set'); return true; },
    removeItem() { calls.push('remove'); return true; },
  };
  const sandbox = context({
    navigator: {},
    planStorage,
    localStorage: storage(),
    location: { reload() { calls.push('reload'); } },
  });
  load('scripts/app/runtime.js', sandbox);

  assert.equal(sandbox.surriculumAppRuntime.isSessionPlanAvailable(), false);
  assert.equal(sandbox.planGetItem('major'), null);
  assert.equal(sandbox.planSetItem('major', 'CS'), false);
  assert.equal(sandbox.planRemoveItem('major'), false);
  assert.deepEqual(calls, []);
  assert.equal(sandbox.surriculumAppRuntime.planWriteFailed, false);
});

test('academic classifier prioritizes known transcript formats', () => {
  const sandbox = context();
  load('scripts/app/academic_records_import.js', sandbox);
  const classify = sandbox.surriculumAcademicImport.classifyDocument;
  assert.equal(classify('Academic Records Summary Degree Evaluation'), 'academic-records-summary');
  assert.equal(classify('NOT DOKUM BELGESI Degree Evaluation'), 'yok-transcript');
  assert.equal(classify('Basic Science and Engineering ECTS Distribution'), 'credit-distribution');
  assert.equal(classify('Sorry! You have no permission to access this page'), 'no-permission-html');
  assert.equal(classify('Degree Evaluation'), 'degree-evaluation');
});

test('academic import checkpoints before mutation and saves before custom review', async () => {
  const events = [];
  const input = {
    files: [{
      type: 'text/html', name: 'records.html', size: 100,
      async text() { return 'Academic Records Summary'; },
    }],
    value: 'records.html',
  };
  const button = {
    disabled: true,
    attributes: new Set(['aria-busy']),
    removeAttribute(name) { this.attributes.delete(name); },
  };
  const elements = {
    academicRecordsInput: input,
    importAcademicRecords: button,
    importDropdown: { classList: { remove() { events.push('dropdown'); } } },
  };
  const document = { getElementById(id) { return elements[id] || null; } };
  const planStorage = {
    flushSaves(options) {
      events.push(options && options.onlyIfPending ? 'flush-pending' : 'flush-import');
      return true;
    },
    captureCheckpoint(planId) { events.push('checkpoint:' + planId); return {}; },
    restoreCheckpoint() { throw new Error('unexpected rollback'); },
    requestSave() { events.push('request-save'); return true; },
  };
  const parser = {
    parseAcademicRecords() {
      events.push('parse');
      return { courses: [{ code: 'CS101' }], detectedRecords: 1 };
    },
    importParsedCourses() {
      events.push('mutate');
      return {
        stats: {
          importedCourses: 1, addedCourses: [{ code: 'CS101' }], updatedCourses: [],
          alreadyPresentCourses: [], retainedUnallocatedCourses: [], notFoundCourses: [],
          invalidGradeCourses: [], supersededCourses: [], skippedCourses: [],
        },
        pendingCustomCourses: [{ code: 'CS101' }],
      };
    },
  };
  const sandbox = context({
    document,
    planStorage,
    uiModal: { async alert(title) { events.push('alert:' + title); return {}; } },
    location: { reload() { throw new Error('unexpected reload'); } },
  });
  load('scripts/app/academic_records_import.js', sandbox);
  const controller = sandbox.surriculumAcademicImport.createController({
    runtime: {
      escapeHtml: String,
      uiAlert() {},
      sessionPlanId: 'plan-import',
      guidance: { policyListHtml: '', verificationHtml: '' },
    },
    parser,
    pdfReader: {},
    getCourseData: () => [],
    getCurriculum: () => ({}),
    getStorage: () => planStorage,
    loadCoursePageInfoIndex: async () => events.push('load-index'),
    processPendingCustomCourses: () => events.push('pending'),
  });

  assert.equal(controller.bind(), true);
  assert.equal(button.disabled, false);
  assert.equal(button.attributes.has('aria-busy'), false);
  await button.onclick();
  assert.ok(events.indexOf('flush-pending') < events.indexOf('checkpoint:plan-import'));
  assert.ok(events.indexOf('checkpoint:plan-import') < events.indexOf('mutate'));
  assert.ok(events.indexOf('mutate') < events.indexOf('request-save'));
  assert.ok(events.indexOf('flush-import') < events.indexOf('pending'));
});

test('onboarding and mobile notice initializers bind once', () => {
  const bindings = [];
  const sandbox = context({
    APP_VERSION: '3.1',
    storageSchemaInfo: { firstRunEver: false },
    preferenceGetItem() { return null; },
    preferenceSetItem() { return true; },
    admitTermGuidanceHtml: '<p></p>',
    sessionStorage: storage(),
    document: {
      getElementById(id) {
        if (id === 'openHelpInfoButton' || id === 'openAdmitTermHelpButton') {
          return { addEventListener(type) { bindings.push(id + ':' + type); } };
        }
        return null;
      },
      addEventListener(type) { bindings.push('document:' + type); },
      querySelector() { return null; },
    },
  });
  load('scripts/app/onboarding.js', sandbox);
  sandbox.surriculumOnboarding.init();
  sandbox.surriculumOnboarding.init();
  assert.equal(bindings.filter((value) => value === 'document:surriculum:ready').length, 1);
  assert.equal(typeof sandbox.openHelpInformation, 'function');

  const mobileBindings = [];
  const mobile = context({
    preferenceGetItem() { return null; },
    preferenceSetItem() { return true; },
    matchMedia() {
      return { matches: true, addEventListener(type) { mobileBindings.push('media:' + type); } };
    },
    addEventListener(type) { mobileBindings.push('window:' + type); },
    document: {
      getElementById(id) {
        if (id === 'mobileNotice') return { classList: { toggle() {}, add() {} } };
        if (id === 'mobileNoticeDismiss') {
          return { addEventListener(type) { mobileBindings.push('dismiss:' + type); } };
        }
        return null;
      },
    },
  });
  load('scripts/app/mobile_notice.js', mobile);
  mobile.surriculumMobileNotice.init();
  mobile.surriculumMobileNotice.init();
  assert.equal(mobileBindings.filter((value) => value === 'dismiss:click').length, 1);
});
