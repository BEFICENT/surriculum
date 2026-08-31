'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const gridModule = require('../../scripts/scheduler/grid-controller.js');
const selectionModule = require('../../scripts/scheduler/selection-controller.js');

class FakeElement {
  constructor() {
    this.listeners = new Map();
    this.attributes = new Map();
    this.innerHTML = '';
    this.isConnected = true;
    this.style = {
      values: new Map(),
      setProperty: (key, value) => this.style.values.set(key, value),
      getPropertyValue: (key) => this.style.values.get(key) || '',
    };
    this.classList = {
      add() {},
      remove() {},
      toggle() {},
      contains() { return false; },
    };
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  removeEventListener(type, listener) {
    if (this.listeners.get(type) === listener) this.listeners.delete(type);
  }

  querySelector() {
    return null;
  }

  querySelectorAll() {
    return [];
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) || '';
  }

  dispatchEvent() {}
}

function gridFixture() {
  const documentListeners = new Map();
  const windowListeners = new Map();
  const document = {
    addEventListener(type, listener) { documentListeners.set(type, listener); },
    removeEventListener(type, listener) {
      if (documentListeners.get(type) === listener) documentListeners.delete(type);
    },
    createElement() { return new FakeElement(); },
  };
  const window = {
    document,
    CustomEvent: class {
      constructor(type, options) {
        this.type = type;
        this.detail = options && options.detail;
      }
    },
    addEventListener(type, listener) { windowListeners.set(type, listener); },
    removeEventListener(type, listener) {
      if (windowListeners.get(type) === listener) windowListeners.delete(type);
    },
    requestAnimationFrame() { return 1; },
    cancelAnimationFrame() {},
    getComputedStyle() {
      return { getPropertyValue() { return ''; } };
    },
  };
  const body = new FakeElement();
  const modal = new FakeElement();
  const session = {
    selected: {},
    blocked: [{ id: 'old', dayKey: 'M', start: 520, end: 580 }],
    scheduleIndex: null,
    missingByCourse: {},
    takenBeforeCurrentTermSet: null,
  };
  const persisted = [];
  const foundation = {
    DAYS: [{ key: 'M' }, { key: 'T' }],
    DAY_START_MIN: 520,
    normalizeCourseId(value) {
      return String(value || '').toUpperCase().replace(/\s+/g, '');
    },
    minutesToLabel(value) { return String(value); },
    hslFromString() { return 'hsl(0 50% 50%)'; },
    async loadTermScheduleIndex() { return null; },
    async createPickerModal() { return { action: 'cancel' }; },
    saveSchedulerState(termCode, patch) { persisted.push([termCode, patch]); },
  };
  const meeting = {
    dateWindowsOverlapOnDay() { return true; },
    getSectionIntervals(section) { return section && section.intervals || []; },
    sectionHasIncompleteMeetingData() { return false; },
  };
  const controller = gridModule.createGridController({
    foundation,
    session,
    meeting,
    window,
    document,
    body,
    modal,
    termCode: '202501',
    displayEndMin: 1180,
    gridMaxEndMin: 1440,
    escapeHtml: String,
    shouldHoverPreview: () => true,
    shouldHighlightAvailability: () => true,
    shouldShowBlockedCourses: () => true,
    computeTakenBeforeCurrentTermSet: () => new Set(),
    normalizePlannerCode: foundation.normalizeCourseId,
    getCoreqsFor: () => [],
    computeBundleClosure: (code) => new Set([code]),
    pickSectionForCourse: async () => {},
    openCourseDetailsModal: async () => {},
    removeSelectionFromGrid: async () => {},
    renderResults: () => {},
    getLastQuery: () => '',
  });
  return { controller, session, persisted, documentListeners, windowListeners };
}

test('grid controller reads live selected/blocked session references', () => {
  const fixture = gridFixture();
  const { controller, session, persisted } = fixture;
  assert.equal(Object.isFrozen(controller), true);
  assert.equal(controller.getBlockedByDay().M[0].id, 'old');

  session.blocked = [{ id: 'new', dayKey: 'T', start: 600, end: 660 }];
  assert.equal(controller.getBlockedByDay().M.length, 0);
  assert.equal(controller.getBlockedByDay().T[0].id, 'new');

  controller.setBlocked([{ id: 'saved', dayKey: 'M', start: 640, end: 700 }]);
  assert.equal(session.blocked[0].id, 'saved');
  assert.equal(persisted.at(-1)[0], '202501');
  assert.equal(persisted.at(-1)[1].blocked, session.blocked);

  session.selected = { CS101: { crn: '1' } };
  assert.deepEqual(
    controller.sectionAvailabilityClasses('CS101', { crn: '1', intervals: [] }, {}),
    ['is-selected'],
  );
  session.selected = {};
  assert.deepEqual(
    controller.sectionAvailabilityClasses('CS101', { crn: '1', intervals: [] }, {}),
    ['is-available'],
  );

  assert.deepEqual(controller.mergeBlockedIntervalsForDay('M', [
    { id: 'a', start: 520, end: 580 },
    { id: 'b', start: 580, end: 640 },
  ]), [{ id: 'a', dayKey: 'M', start: 520, end: 640 }]);
  controller.dispose();
  assert.equal(fixture.documentListeners.has('mouseup'), false);
  assert.equal(fixture.windowListeners.has('resize'), false);
});

test('selection controller recomputes corequisites and mutates the live selection', async () => {
  const selectedEl = new FakeElement();
  const resultsEl = new FakeElement();
  const clearBtn = new FakeElement();
  const info = new Map([
    ['CS101', { corequisites: 'CS101R' }],
    ['CS101R', {}],
    ['MATH101', {}],
  ]);
  const scheduleIndex = new Map([
    ['CS101', { course_id: 'CS101', sections: [{ crn: '1', section: 'A' }] }],
    ['CS101R', { course_id: 'CS101R', sections: [{ crn: '2', section: 'R1' }] }],
    ['MATH101', { course_id: 'MATH101', title: 'Math', sections: [{ crn: '3', section: 'A' }] }],
  ]);
  const session = {
    selected: { CS101: { course_id: 'CS101', crn: '1' } },
    scheduleIndex,
    coursePageInfoMap: info,
    reverseCoreqIndex: null,
    missingByCourse: {},
    orphanByCourse: {},
  };
  const renderCalls = [];
  const expandedResultSections = new Set();
  const foundation = {
    normalizeCourseId(value) {
      return String(value || '').toUpperCase().replace(/\s+/g, '');
    },
    extractCoreqCourseIdsFromCoursePageInfoField(value) {
      return String(value || '').split(/\s*,\s*/).filter(Boolean);
    },
    async createPickerModal() { return { action: 'cancel' }; },
    async loadTermScheduleIndex() { return scheduleIndex; },
    saveSchedulerState(_term, patch) { renderCalls.push(['save', patch.selected]); },
    escapeHtml: String,
    hslFromString() { return 'hsl(0 50% 50%)'; },
  };
  const grid = {
    reconcileRenderedSelected() {},
    clearHoverHighlights() {},
    isGridRenderableInterval() { return true; },
    sectionAvailabilityClasses() { return []; },
    getOccupiedByDayFromSelected() { return {}; },
    renderGrid() { renderCalls.push(['grid']); },
    clearGridBlocks() {},
    clearPreviewBlocks() {},
  };
  const window = {
    registrationRules: null,
    async loadCoursePageInfoIndex() { return info; },
  };
  const controller = selectionModule.createSelectionController({
    foundation,
    session,
    meeting: {
      getSectionIntervals() { return []; },
      sectionHasIncompleteMeetingData() { return false; },
    },
    grid,
    window,
    termCode: '202501',
    selectedElement: selectedEl,
    resultsElement: resultsEl,
    clearButton: clearBtn,
    sectionMeetingPreview: () => '',
    sectionInstructorPreview: () => '',
    buildDetailUrl: () => '',
    openCourseDetailsModal: async () => {},
    getCourseDetails: () => ({ su: 3, bs: 0, eng: 0, minorTypes: [] }),
    formatCredit: String,
    shouldShowDetails: () => false,
    renderResults: () => renderCalls.push(['results']),
    getLastQuery: () => '',
    expandedResultSections,
    resultsReconciler: { renderHtml() {} },
  });

  assert.equal(Object.isFrozen(controller), true);
  assert.deepEqual(controller.getCoreqsFor('CS101'), ['CS101R']);
  assert.equal(controller.buildReverseCoreqIndex(scheduleIndex).get('CS101R').has('CS101'), true);

  await controller.recomputeMissingCoreqs();
  assert.deepEqual(session.missingByCourse.CS101, ['CS101R']);

  session.selected = {
    CS101: { course_id: 'CS101', crn: '1' },
    CS101R: { course_id: 'CS101R', crn: '2' },
  };
  assert.deepEqual([...controller.computeBundleClosure('CS101')].sort(), ['CS101', 'CS101R']);

  await controller.pickSpecificSection(scheduleIndex, 'MATH101', '3');
  assert.equal(session.selected.MATH101.crn, '3');
  assert.ok(renderCalls.some(([name]) => name === 'save'));
  assert.ok(renderCalls.some(([name]) => name === 'grid'));
  assert.ok(renderCalls.some(([name]) => name === 'results'));

  const resultClick = resultsEl.listeners.get('click');
  assert.equal(typeof resultClick, 'function');
  await resultClick({
    target: {
      closest(selector) {
        if (selector !== '.scheduler-sections-toggle') return null;
        return { getAttribute: () => 'MATH101' };
      },
    },
  });
  assert.equal(expandedResultSections.has('MATH101'), true);
  assert.equal(renderCalls.at(-1)[0], 'results');
});
