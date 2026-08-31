'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const SOURCE = fs.readFileSync(
  path.join(ROOT, 'scripts/app/planner-loading-state.js'),
  'utf8',
);
const PLANNER_CSS = fs.readFileSync(path.join(ROOT, 'styles/planner.css'), 'utf8');

function element() {
  const attributes = new Map();
  return {
    attributes,
    dataset: {},
    hidden: false,
    textContent: '',
    setAttribute(name, value) { attributes.set(name, String(value)); },
    removeAttribute(name) { attributes.delete(name); },
    getAttribute(name) { return attributes.has(name) ? attributes.get(name) : null; },
  };
}

function setup() {
  const board = element();
  const state = element();
  const message = element();
  state.querySelector = (selector) => (
    selector === '.planner-loading-message' ? message : null
  );
  const elements = { board, plannerLoadingState: state };
  const document = {
    getElementById(id) { return elements[id] || null; },
  };
  const sandbox = { document };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: 'planner-loading-state.js' });
  const controller = sandbox.surriculumPlannerLoadingState.createController({ document });
  return { sandbox, controller, board, state, message };
}

test('planner loading controller exposes a frozen, idempotent state API', () => {
  const { sandbox, controller, board, state, message } = setup();
  assert.equal(Object.isFrozen(sandbox.surriculumPlannerLoadingState), true);
  assert.equal(Object.isFrozen(controller), true);

  assert.equal(controller.start(), true);
  assert.equal(controller.start(), true);
  assert.equal(board.getAttribute('aria-busy'), 'true');
  assert.equal(state.dataset.state, 'loading');
  assert.equal(state.hidden, false);
  assert.equal(state.getAttribute('hidden'), null);
  assert.equal(state.getAttribute('role'), 'status');
  assert.equal(state.getAttribute('aria-live'), 'polite');
  assert.equal(message.textContent, 'Loading your semesters…');

  assert.equal(controller.finish(), true);
  assert.equal(controller.finish(), true);
  assert.equal(board.getAttribute('aria-busy'), 'false');
  assert.equal(state.dataset.state, 'ready');
  assert.equal(state.hidden, true);
  assert.equal(state.getAttribute('hidden'), '');
});

test('planner loading controller reports failure and can restart cleanly', () => {
  const { controller, board, state, message } = setup();

  controller.fail('  Catalog unavailable  ');
  controller.fail('  Catalog unavailable  ');
  assert.equal(board.getAttribute('aria-busy'), 'false');
  assert.equal(state.dataset.state, 'error');
  assert.equal(state.hidden, false);
  assert.equal(state.getAttribute('role'), 'alert');
  assert.equal(state.getAttribute('aria-live'), 'assertive');
  assert.equal(message.textContent, 'Catalog unavailable');

  controller.start('Restoring plan…');
  assert.equal(board.getAttribute('aria-busy'), 'true');
  assert.equal(state.dataset.state, 'loading');
  assert.equal(state.getAttribute('role'), 'status');
  assert.equal(state.getAttribute('aria-live'), 'polite');
  assert.equal(message.textContent, 'Restoring plan…');
});

test('planner loading controller validates its DOM dependencies', () => {
  const sandbox = {};
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox, { filename: 'planner-loading-state.js' });

  assert.throws(
    () => sandbox.surriculumPlannerLoadingState.createController({}),
    /document is required/,
  );
  assert.throws(
    () => sandbox.surriculumPlannerLoadingState.createController({
      document: { getElementById() { return null; } },
    }),
    /elements are required/,
  );
});

test('planner loading CSS overlays the board without joining mobile flex order', () => {
  assert.match(PLANNER_CSS, /\.planner-loading-state\s*\{[\s\S]*?position:\s*absolute/);
  assert.match(PLANNER_CSS, /\.planner-loading-state\[hidden\]\s*\{[\s\S]*?display:\s*none\s*!important/);
  assert.match(PLANNER_CSS, /\.planner-loading-spinner\s*\{[\s\S]*?animation:\s*planner-loading-spin/);
  assert.match(PLANNER_CSS, /\.planner-loading-state\[data-state="error"\][\s\S]*?var\(--state-danger\)/);
});
