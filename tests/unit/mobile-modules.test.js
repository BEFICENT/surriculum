'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '../..');
const MODULES = Object.freeze([
  ['viewportMode', 'scripts/mobile/viewport-mode.js'],
  ['navigationProgress', 'scripts/mobile/navigation-progress.js'],
  ['plannerAccordion', 'scripts/mobile/planner-accordion.js'],
  ['schedulerAdaptation', 'scripts/mobile/scheduler-adaptation.js'],
]);

function source(relative) {
  return fs.readFileSync(path.join(ROOT, ...relative.split('/')), 'utf8');
}

function run(relative, sandbox) {
  const context = vm.createContext(sandbox || {});
  vm.runInContext(source(relative), context, { filename: relative });
  return context;
}

test('focused mobile modules install narrow frozen APIs without initializing on load', () => {
  const sandbox = run(MODULES[0][1], {});
  for (let index = 1; index < MODULES.length; index += 1) {
    vm.runInContext(source(MODULES[index][1]), sandbox, {
      filename: MODULES[index][1],
    });
  }

  assert.ok(sandbox.SurriculumMobileModules);
  for (const [name] of MODULES) {
    const api = sandbox.SurriculumMobileModules[name];
    assert.ok(api, `${name} API should be installed`);
    assert.equal(Object.isFrozen(api), true, `${name} API should be frozen`);
    assert.deepEqual(Object.keys(api), ['init']);
    assert.equal(typeof api.init, 'function');
  }
});

test('mobile.js initializes focused modules once in the historical IIFE order', () => {
  const calls = [];
  const stubs = {};
  for (const [name] of MODULES) {
    stubs[name] = Object.freeze({ init() { calls.push(name); } });
  }
  const sandbox = run('mobile.js', { SurriculumMobileModules: stubs });

  assert.deepEqual(calls, MODULES.map(([name]) => name));
  assert.ok(sandbox.SurriculumMobile);
  assert.equal(Object.isFrozen(sandbox.SurriculumMobile), true);
  assert.deepEqual(Object.keys(sandbox.SurriculumMobile), ['init']);

  sandbox.SurriculumMobile.init();
  assert.deepEqual(calls, MODULES.map(([name]) => name), 'composition entry must bind once');
});

test('mobile responsibilities remain physically owned by their focused modules', () => {
  const entry = source('mobile.js');
  const viewport = source('scripts/mobile/viewport-mode.js');
  const navigation = source('scripts/mobile/navigation-progress.js');
  const planner = source('scripts/mobile/planner-accordion.js');
  const scheduler = source('scripts/mobile/scheduler-adaptation.js');

  assert.doesNotMatch(entry, /MOBILE_MAX_WIDTH|buildProgress|syncSemesters|updateFitPpm/);
  assert.match(viewport, /MOBILE_MAX_WIDTH/);
  assert.match(navigation, /function buildProgress\(/);
  assert.match(planner, /function syncSemesters\(/);
  assert.match(scheduler, /function updateFitPpm\(/);
});
