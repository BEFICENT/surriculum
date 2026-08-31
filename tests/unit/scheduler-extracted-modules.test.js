'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const dialogs = require('../../scripts/scheduler/dialogs.js');
const storage = require('../../scripts/scheduler/storage.js');
const meetingModel = require('../../scripts/scheduler/meeting-model.js');
const foundation = require('../../scripts/scheduler/foundation.js');
const courseDetails = require('../../scripts/scheduler/course-details.js');
const courseUi = require('../../scripts/scheduler/course-ui.js');
const gridGeometry = require('../../scripts/scheduler/grid-geometry.js');
const gridAvailability = require('../../scripts/scheduler/grid-availability.js');
const gridController = require('../../scripts/scheduler/grid-controller.js');
const resultFiltering = require('../../scripts/scheduler/results-filtering.js');
const resultCard = require('../../scripts/scheduler/result-card.js');
const resultsController = require('../../scripts/scheduler/results-controller.js');
const schedulerSession = require('../../scripts/scheduler/session.js');
const sidebar = require('../../scripts/scheduler/sidebar.js');
const programDetails = require('../../scripts/scheduler/program-details.js');
const termContext = require('../../scripts/scheduler/term-context.js');

test('extracted Scheduler modules expose narrow frozen APIs through their composers', () => {
  for (const api of [
    dialogs, storage, meetingModel, courseDetails, gridGeometry, gridAvailability,
    resultFiltering, resultCard, schedulerSession, sidebar, programDetails, termContext,
  ]) assert.equal(Object.isFrozen(api), true);

  assert.equal(typeof meetingModel.createMeetingModelTools, 'function');
  assert.equal(foundation.createPickerModal, dialogs.createPickerModal);
  assert.equal(foundation.loadSchedulerState, storage.loadSchedulerState);
  assert.equal(courseUi.createCourseDetailsController, courseDetails.createCourseDetailsController);
  assert.equal(typeof gridController.createGridController, 'function');
  assert.equal(typeof resultsController.createResultsController, 'function');
});

test('desktop Scheduler geometry uses invariant metrics without forcing computed layout', () => {
  let computedStyleReads = 0;
  let mobileMode = false;
  const scheduledFrames = [];
  const fakeWindow = {
    requestAnimationFrame(callback) {
      scheduledFrames.push(callback);
      return scheduledFrames.length;
    },
    cancelAnimationFrame() {},
    addEventListener() {},
    removeEventListener() {},
    getComputedStyle() {
      computedStyleReads += 1;
      return {
        getPropertyValue(name) {
          return {
            '--scheduler-minute': '0.5px',
            '--scheduler-top-gap': '8px',
            '--scheduler-block-gap': '2px',
          }[name] || '';
        },
      };
    },
  };
  const fakeDocument = {
    body: { classList: { contains: () => mobileMode } },
  };
  const fakeStyle = {
    getPropertyValue: () => '',
    setProperty() {},
  };
  const schedulerBody = {
    isConnected: true,
    style: fakeStyle,
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  const geometry = gridGeometry.createGridGeometry({
    window: fakeWindow,
    document: fakeDocument,
    body: schedulerBody,
    modal: {},
    schedulerGridElement: { style: fakeStyle },
    days: [],
    dayStartMin: 520,
    displayEndMin: 1180,
    gridMaxEndMin: 1440,
    minutesToLabel: String,
  });

  assert.deepEqual(geometry.getSchedulerLayout(), {
    pxPerMin: 1.05,
    topGapPx: 14,
    blockGapPx: 6,
  });
  assert.equal(computedStyleReads, 0);

  mobileMode = true;
  geometry.invalidateSchedulerLayout();
  assert.deepEqual(geometry.getSchedulerLayout(), {
    pxPerMin: 0.5,
    topGapPx: 8,
    blockGapPx: 2,
  });
  assert.equal(computedStyleReads, 1);
  assert.equal(geometry.getSchedulerLayout().pxPerMin, 0.5);
  assert.equal(computedStyleReads, 1, 'responsive metrics should remain cached within a render boundary');
  geometry.dispose();
});

test('live Scheduler session accessors preserve replacement identity', () => {
  let selected = { MATH101: { crn: '1' } };
  let blocked = [];
  const session = schedulerSession.createLiveSession({
    selected: { get: () => selected, set: (value) => { selected = value; } },
    blocked: { get: () => blocked, set: (value) => { blocked = value; } },
  });
  assert.equal(session.selected, selected);
  const replacement = { CS201: { crn: '2' } };
  session.selected = replacement;
  assert.equal(selected, replacement);
  assert.equal(session.selected, replacement);
  const nextBlocked = [{ dayKey: 'M', start: 520, end: 580 }];
  session.blocked = nextBlocked;
  assert.equal(blocked, nextBlocked);
});

test('term context scopes planned and prerequisite history to the selected term', () => {
  const fakeWindow = {
    curriculum: {
      semesters: [
        { termCode: '202401', courses: [{ code: 'MATH101' }] },
        { termCode: '202402', courses: [{ code: 'CS201' }] },
        { termCode: '202501', courses: [{ code: 'CS301' }] },
      ],
      isDegreeEligibleCourse: () => true,
    },
    semesterTermCode: (semester) => semester.termCode,
  };
  const tools = termContext.createTermContextTools({
    window: fakeWindow,
    termCode: '202402',
    normalizeCourseId: (value) => String(value || '').replace(/\s+/g, '').toUpperCase(),
    normalizePlannerCode: (value) => String(value || '').replace(/\s+/g, '').toUpperCase(),
    getSelected: () => ({}),
  });
  assert.deepEqual([...tools.computeTakenUpToTermSet()].sort(), ['CS201', 'MATH101']);
  assert.deepEqual([...tools.computeTakenBeforeCurrentTermSet()], ['MATH101']);
});

test('program-detail tools use injected live catalog data', () => {
  let catalog = [{ Major: 'MATH', Code: '101', Course_Name: 'Calculus', SU_credit: '3' }];
  const tools = programDetails.createProgramDetailTools({
    window: {},
    normalizeCourseId: (value) => String(value || '').replace(/\s+/g, '').toUpperCase(),
    getCoursePageInfoMap: () => new Map(),
    getCourseData: () => catalog,
    getInfo: (code, data) => data.find((row) => `${row.Major}${row.Code}` === code) || null,
  });
  assert.equal(tools.getPlannerInfo('MATH101').Course_Name, 'Calculus');
  catalog = [{ Major: 'MATH', Code: '101', Course_Name: 'Updated', SU_credit: '3' }];
  assert.equal(tools.getPlannerInfo('MATH101').Course_Name, 'Updated');
});

test('Smart Sort keeps its before-target policy and selected Scheduler term', () => {
  const values = new Map();
  const controls = {};
  const fakeWindow = { courseFilters: null };
  const filtering = resultFiltering.createResultFiltering({
    window: fakeWindow,
    termCode: '202502',
    preferenceGetItem: (key) => values.has(key) ? values.get(key) : null,
    preferenceSetItem: (key, value) => { values.set(key, value); return true; },
    controls,
  });
  assert.deepEqual(filtering.scoreRankerOptions, {
    progressPolicy: 'before-target',
    targetTermCode: '202502',
  });
  assert.equal(Object.isFrozen(filtering.scoreRankerOptions), true);
});

test('result-card renderer returns keyed markup without mutating the entry', () => {
  const entry = { course_id: 'MATH101', title: 'Calculus', sections: [] };
  const renderer = resultCard.createResultCardRenderer({
    window: {},
    coursePreviewInstructor: () => '',
    buildDetailUrl: () => '',
    shouldShowDetails: () => false,
    getCourseDetails: () => null,
    normalizeCourseId: (value) => String(value || '').toUpperCase(),
    getCoreqsFor: () => [],
    sectionMeetingPreview: () => '',
    sectionInstructorPreview: () => '',
    sectionAvailabilityClasses: () => [],
    escapeHtml: foundation.escapeHtml,
    getSelectedSection: () => null,
    expandedResultSections: new Set(),
    shouldHighlightAvailability: () => false,
    getRequiredBundleCourseIds: () => [],
    pickBestBundleSections: () => null,
    shouldShowBlockedCourses: () => false,
    normalizePlannerCode: (value) => String(value || '').toUpperCase(),
    canFitWithBlockedHours: () => true,
    formatCredit: String,
  });
  const card = renderer.renderCard({
    entry,
    selected: {},
    missingByCourse: {},
    scheduleIndex: new Map([['MATH101', entry]]),
    unmetPrereqById: new Map(),
    requirementEvaluationById: new Map(),
    takenBeforeSetForHighlight: null,
    occForAvailability: null,
    blocked: [],
    keepVisible: new Set(),
  });
  assert.equal(card.key, 'course:MATH101');
  assert.match(card.html, /data-course="MATH101"/);
  assert.deepEqual(entry, { course_id: 'MATH101', title: 'Calculus', sections: [] });
});
