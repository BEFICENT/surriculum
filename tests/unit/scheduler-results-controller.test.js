'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const results = require('../../scripts/scheduler/results.js');
const { createResultsController } = require('../../scripts/scheduler/results-controller.js');

class FakeTarget {
  constructor() {
    this.listeners = new Map();
    this.attributes = new Map();
    this.classList = { toggle() {} };
    this.checked = false;
    this.value = '';
  }

  addEventListener(type, listener) {
    const list = this.listeners.get(type) || [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter(item => item !== listener));
  }

  dispatchEvent(event) {
    (this.listeners.get(event.type) || []).slice().forEach(listener => listener(event));
  }

  emit(type) {
    this.dispatchEvent({ type, target: this, preventDefault() {}, stopPropagation() {} });
  }

  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) || ''; }
  contains(target) { return target === this; }
}

test('results controller reads live state and computes prior-term inputs once per render', async () => {
  const document = new FakeTarget();
  const search = new FakeTarget();
  const scoreToggle = new FakeTarget();
  const preferences = new Map([
    ['hideTakenCourses', 'false'],
    ['showCourseDetails', 'false'],
    ['sortBasedOnScore', 'true'],
    ['schedulerHighlightAvailability', 'false'],
    ['schedulerCheckPrereqs', 'false'],
  ]);
  const rendered = [];
  let priorInclusiveCalls = 0;
  let priorOnlyCalls = 0;
  let reconcileCalls = 0;
  let scoreCalls = 0;
  const window = {
    document,
    Event: class { constructor(type) { this.type = type; } },
    courseFilters: { countActiveFilters: () => 0 },
    getCourseSuggestionScorerKey: () => 'stable',
    buildCourseSuggestionScorer: () => ({
      key: 'stable',
      score() { scoreCalls++; return 7; },
    }),
  };
  const scheduleIndex = new Map([
    ['MATH101', { course_id: 'MATH101', title: 'Calculus', sections: [] }],
  ]);
  const session = {
    selected: {},
    blocked: [],
    scheduleIndex,
    coursePageInfoMap: null,
    missingByCourse: {},
    orphanByCourse: {},
    reverseCoreqIndex: null,
    takenBeforeCurrentTermSet: null,
  };
  const controller = createResultsController({
    foundation: {
      normalizeCourseId: value => String(value || '').toUpperCase().replace(/\s+/g, ''),
      escapeHtml: String,
      preferenceGetItem: key => preferences.has(key) ? preferences.get(key) : null,
      preferenceSetItem: (key, value) => preferences.set(key, value),
      loadTermScheduleIndex: async () => scheduleIndex,
    },
    results,
    session,
    window,
    document,
    termCode: '202501',
    plannedCourses: [],
    resultsReconciler: {
      renderHtml: html => rendered.push(html),
      renderKeyedHtml: value => rendered.push(Array.isArray(value)
        ? value.map(item => item.html).join('') : value),
    },
    controls: { searchElement: search, scoreToggle },
    normalizePlannerCode: value => String(value || '').toUpperCase().replace(/\s+/g, ''),
    sectionInstructorPreview: () => '',
    sectionMeetingPreview: () => '',
    buildDetailUrl: () => '',
    getCourseDetails: () => null,
    formatCredit: String,
    buildSchedulerRequirementContext: () => null,
    computeTakenUpToTermSet: () => { priorInclusiveCalls++; return new Set(); },
    computeTakenBeforeCurrentTermSet: () => { priorOnlyCalls++; return new Set(['CS101']); },
    buildReverseCoreqIndex: () => new Map(),
    getCoreqsFor: () => [],
    getSelectedSection: () => null,
    canFitWithBlockedHours: () => true,
    getOccupiedByDayFromSelected: () => ({}),
    sectionAvailabilityClasses: () => [],
    getRequiredBundleCourseIds: () => [],
    pickBestBundleSections: () => null,
    reconcileRenderedResults: () => { reconcileCalls++; },
    resetHover: () => {},
    renderSelected: () => {},
    schedulerIsMounted: () => true,
  });

  controller.renderResults(scheduleIndex, 'math');
  assert.equal(priorInclusiveCalls, 1);
  assert.equal(priorOnlyCalls, 1);
  assert.deepEqual([...session.takenBeforeCurrentTermSet], ['CS101']);
  assert.equal(scoreCalls, 1);
  assert.equal(reconcileCalls, 1);
  assert.match(rendered.at(-1), /MATH101/);

  scoreToggle.checked = false;
  const beforeToggle = priorOnlyCalls;
  scoreToggle.emit('change');
  assert.equal(priorOnlyCalls, beforeToggle + 1, 'shared preference feedback must not double-render');

  search.value = 'calculus';
  const beforeSearch = priorOnlyCalls;
  search.emit('input');
  await new Promise(resolve => setTimeout(resolve, 110));
  assert.equal(priorOnlyCalls, beforeSearch + 1, 'debounced search renders exactly once');
  assert.equal(controller.getLastQuery(), 'calculus');

  controller.dispose();
  assert.equal((search.listeners.get('input') || []).length, 0);
});

test('legacy prerequisite fallback retains AND/OR semantics', () => {
  const ast = results.parsePrerequisiteAst('CS101 and (MATH101 or MATH102)');
  assert.equal(results.evaluatePrerequisiteAst(ast, new Set(['CS101', 'MATH102']), value => value).ok, true);
  assert.deepEqual(
    results.evaluatePrerequisiteAst(ast, new Set(['CS101']), value => value),
    { ok: false, required: [], oneOf: [['MATH101', 'MATH102']] },
  );
});
