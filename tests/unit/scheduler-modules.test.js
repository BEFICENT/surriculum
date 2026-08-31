'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '../..');
const foundation = require('../../scripts/scheduler/foundation.js');
const courseUi = require('../../scripts/scheduler/course-ui.js');
const plannerSync = require('../../scripts/scheduler/planner-sync.js');
const results = require('../../scripts/scheduler/results.js');
const resultsController = require('../../scripts/scheduler/results-controller.js');
const grid = require('../../scripts/scheduler/grid-controller.js');
const selection = require('../../scripts/scheduler/selection-controller.js');

class FakeNode {
  constructor(name) {
    this.name = name;
    this.parentNode = null;
  }

  get nextSibling() {
    if (!this.parentNode) return null;
    const siblings = this.parentNode.childNodes;
    const index = siblings.indexOf(this);
    return index >= 0 ? siblings[index + 1] || null : null;
  }
}

class FakeContainer {
  constructor() {
    this.childNodes = [];
  }

  get firstChild() {
    return this.childNodes[0] || null;
  }

  insertBefore(node, reference) {
    if (node.parentNode) node.parentNode.removeChild(node);
    const index = reference == null ? this.childNodes.length : this.childNodes.indexOf(reference);
    if (index < 0) throw new Error('Reference node is not a child.');
    this.childNodes.splice(index, 0, node);
    node.parentNode = this;
    return node;
  }

  removeChild(node) {
    const index = this.childNodes.indexOf(node);
    if (index < 0) throw new Error('Node is not a child.');
    this.childNodes.splice(index, 1);
    node.parentNode = null;
    return node;
  }
}

class FakeButton {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  removeEventListener(type, listener) {
    if (this.listeners.get(type) === listener) this.listeners.delete(type);
  }
}

test('Scheduler modules expose immutable classic-script namespaces', () => {
  for (const api of [foundation, courseUi, plannerSync, results, resultsController, grid, selection]) {
    assert.equal(Object.isFrozen(api), true);
  }
  assert.equal(typeof foundation.createMeetingModelTools, 'function');
  assert.equal(typeof courseUi.createCourseDetailsController, 'function');
  assert.equal(typeof courseUi.createScheduleManager, 'function');
  assert.equal(typeof plannerSync.createPlannerSyncController, 'function');
  assert.equal(typeof results.createCourseResultsReconciler, 'function');
  assert.equal(typeof resultsController.createResultsController, 'function');
  assert.equal(typeof grid.createGridController, 'function');
  assert.equal(typeof selection.createSelectionController, 'function');
});

test('Scheduler foundation preserves compact meeting parsing behind its factory', () => {
  assert.deepEqual(foundation.parseDaysToKeys('MWF'), ['M', 'W', 'F']);
  assert.deepEqual(foundation.parseDaysToKeys('TBA'), []);
  assert.deepEqual(foundation.parseTimeRangeToMinutes('12:40 pm - 2:30 pm'), {
    start: 760,
    end: 870,
  });

  const meetingTools = foundation.createMeetingModelTools();
  assert.equal(Object.isFrozen(meetingTools), true);
  assert.deepEqual(
    meetingTools.getSectionIntervals({
      meetings: [{ days: 'MW', start_min: 520, end_min: 630, where: 'FENS' }],
    }).map((interval) => interval.dayKey),
    ['M', 'W'],
  );
});

test('keyed Scheduler results preserve unchanged nodes across reordering', () => {
  const container = new FakeContainer();
  const firstA = new FakeNode('first-a');
  const firstB = new FakeNode('first-b');
  let cache = results.reconcileKeyedNodes(container, [
    { key: 'course:A', signature: '<div>A</div>', node: firstA },
    { key: 'course:B', signature: '<div>B</div>', node: firstB },
  ]);
  assert.deepEqual(container.childNodes, [firstA, firstB]);

  const discardedA = new FakeNode('discarded-a');
  const discardedB = new FakeNode('discarded-b');
  cache = results.reconcileKeyedNodes(container, [
    { key: 'course:B', signature: '<div>B</div>', node: discardedB },
    { key: 'course:A', signature: '<div>A</div>', node: discardedA },
  ], cache);
  assert.deepEqual(container.childNodes, [firstB, firstA]);
  assert.equal(discardedA.parentNode, null);
  assert.equal(discardedB.parentNode, null);

  const changedA = new FakeNode('changed-a');
  cache = results.reconcileKeyedNodes(container, [
    { key: 'course:A', signature: '<div>A expanded</div>', node: changedA },
  ], cache);
  assert.deepEqual(container.childNodes, [changedA]);
  assert.equal(firstA.parentNode, null);
  assert.equal(firstB.parentNode, null);
  assert.equal(cache.get('course:A').node, changedA);
});

test('Scheduler results reconciler releases its detached parsing tree after each render', () => {
  class FakeCourseNode extends FakeNode {
    constructor(courseId, markup) {
      super(courseId);
      this.nodeType = 1;
      this.courseId = courseId;
      this.outerHTML = markup;
      this.textContent = courseId;
      this.classList = { contains: (name) => name === 'scheduler-course' };
    }

    getAttribute(name) {
      return name === 'data-course' ? this.courseId : null;
    }
  }

  const template = {
    content: new FakeContainer(),
    clearCount: 0,
    parseCount: 0,
    set innerHTML(markup) {
      for (const node of this.content.childNodes) node.parentNode = null;
      this.content.childNodes = [];
      if (!markup) {
        this.clearCount += 1;
        return;
      }
      this.parseCount += 1;
      const courseId = /data-course="([^"]+)"/.exec(markup)?.[1] || '';
      const node = new FakeCourseNode(courseId, markup);
      node.parentNode = this.content;
      this.content.childNodes.push(node);
    },
  };
  const container = new FakeContainer();
  container.ownerDocument = {
    createElement(name) {
      assert.equal(name, 'template');
      return template;
    },
  };
  const reconciler = results.createCourseResultsReconciler(container);
  const markup = '<div class="scheduler-course" data-course="MATH101">MATH101</div>';

  reconciler.renderHtml(markup);
  const attached = container.firstChild;
  reconciler.renderHtml(markup);

  assert.equal(container.firstChild, attached, 'the unchanged keyed card remains attached');
  assert.deepEqual(template.content.childNodes, [], 'discarded parsed candidates are released');
  assert.equal(template.clearCount, 2);

  reconciler.renderKeyedHtml([{ key: 'course:MATH101', html: markup }]);
  assert.equal(container.firstChild, attached);
  assert.equal(template.parseCount, 2, 'an unchanged keyed card is not parsed again');

  const changedMarkup = markup.replace('MATH101</div>', 'Calculus</div>');
  reconciler.renderKeyedHtml([{ key: 'course:MATH101', html: changedMarkup }]);
  assert.notEqual(container.firstChild, attached);
  assert.equal(template.parseCount, 3, 'a changed keyed card is parsed exactly once');
});

test('schedule manager applies a selected schedule through injected render seams', async () => {
  const button = new FakeButton();
  const label = { textContent: '' };
  const persisted = [];
  const calls = [];
  const initial = {
    schedules: {
      activeId: 'default',
      order: ['default'],
      items: {
        default: { id: 'default', name: 'Default schedule', selected: {}, blocked: [], ui: {} },
      },
    },
  };
  const session = { state: initial, selected: {}, blocked: [], scheduleIndex: new Map() };
  const activeSchedule = (rootState) => rootState.schedules.items[rootState.schedules.activeId];
  const controller = courseUi.createScheduleManager({
    foundation: {
      planSetItem(key, value) { persisted.push([key, JSON.parse(value)]); return true; },
      loadSchedulerState() { return initial; },
      createPickerModal: async () => ({ action: 'close' }),
      createTextInputModal: async () => ({ action: 'cancel' }),
      escapeHtml: foundation.escapeHtml,
    },
    session,
    termCode: '202501',
    scheduleButton: button,
    scheduleName: label,
    getActiveSchedule: activeSchedule,
    applyScheduleUi: () => calls.push('ui'),
    renderBlocked: () => calls.push('blocked'),
    recomputeMissingCoreqs: async () => calls.push('coreqs'),
    renderSelected: () => calls.push('selected'),
    renderGrid: () => calls.push('grid'),
    renderResults: (_index, query) => calls.push(`results:${query}`),
    getLastQuery: () => 'math',
  });

  const nextSelected = { MATH101: { crn: '10777' } };
  const nextBlocked = [{ dayKey: 'M', start: 520, end: 570 }];
  const next = {
    schedules: {
      activeId: 'alternate',
      order: ['alternate'],
      items: {
        alternate: {
          id: 'alternate',
          name: 'Alternate',
          selected: nextSelected,
          blocked: nextBlocked,
          ui: { planCollapsed: true },
        },
      },
    },
  };
  await controller.applyActiveScheduleFromRoot(next);

  assert.equal(session.state, next);
  assert.equal(session.selected, nextSelected);
  assert.equal(session.blocked, nextBlocked);
  assert.equal(label.textContent, 'Alternate');
  assert.deepEqual(calls, ['ui', 'blocked', 'coreqs', 'selected', 'grid', 'results:math']);
  assert.equal(persisted.at(-1)[0], 'schedulerState_202501');
  assert.equal(button.listeners.has('click'), true);
  controller.dispose();
  assert.equal(button.listeners.has('click'), false);
});

test('Scheduler orchestrator remains a small composition layer', () => {
  const source = fs.readFileSync(path.join(ROOT, 'scripts/scheduler.js'), 'utf8');
  const gridGeometrySource = fs.readFileSync(path.join(ROOT, 'scripts/scheduler/grid-geometry.js'), 'utf8');
  const gridControllerSource = fs.readFileSync(path.join(ROOT, 'scripts/scheduler/grid-controller.js'), 'utf8');
  const lineCount = source.split(/\r?\n/).length;
  assert.ok(lineCount < 1000, `scripts/scheduler.js grew back to ${lineCount} lines.`);
  assert.doesNotMatch(source, /function activateSchedulerEdgeBlur/);
  assert.doesNotMatch(source, /const openScheduleManager =/);
  assert.doesNotMatch(source, /const replacePlannerSemester =/);
  assert.match(source, /schedulerCourseUi\.createScheduleManager\(/);
  assert.match(source, /schedulerPlannerSync\.createPlannerSyncController\(/);
  assert.match(source, /schedulerResults\.createCourseResultsReconciler\(/);
  assert.match(source, /schedulerResultsController\.createResultsController\(/);
  assert.match(source, /schedulerGrid\.createGridController\(/);
  assert.match(source, /schedulerSelection\.createSelectionController\(/);
  assert.doesNotMatch(source, /const renderGrid =/);
  assert.doesNotMatch(source, /const recomputeMissingCoreqs =/);
  assert.doesNotMatch(source, /const renderResults =/);
  assert.match(source, /getActiveSchedule:\s*schedulerSession\.getActiveSchedule/);
  assert.doesNotMatch(source, /^\s*getActiveSchedule,\s*$/m);
  assert.doesNotMatch(gridGeometrySource, /\b(?:let|const|var)\s+blockDrag\b/);
  assert.match(gridControllerSource, /\blet\s+blockDrag\s*=\s*null/);
});

test('Scheduler controllers load before the classic orchestrator', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const paths = [
    'scripts/scheduler/results.js',
    'scripts/scheduler/results-controller.js',
    'scripts/scheduler/grid-controller.js',
    'scripts/scheduler/selection-controller.js',
    'scripts/scheduler.js',
  ];
  const positions = paths.map((relative) => html.indexOf(`src="${relative}"`));
  assert.ok(positions.every((position) => position >= 0));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  paths.forEach((relative) => {
    assert.match(html, new RegExp(`<script[^>]+src="${relative.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]+defer`));
  });
});
