'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScriptGlobals } = require('./helpers/load-script');

test('planner preference controller publishes and synchronizes shared picker defaults once', () => {
  const globals = loadScriptGlobals('scripts/app/planner-preferences.js');
  globals.Event = class Event { constructor(type) { this.type = type; } };
  const listeners = new Map();
  const toggles = new Map([
    ['courseDetailsToggle', { checked: false }],
    ['hideTakenCoursesToggle', { checked: false }],
    ['plannerOfferedOnlyToggle', { checked: false }],
    ['sortByScoreToggle', { checked: false }],
  ]);
  toggles.forEach((toggle) => {
    toggle.listeners = {};
    toggle.addEventListener = (name, listener) => { toggle.listeners[name] = listener; };
  });
  const details = [{ style: {} }, { style: {} }];
  const document = {
    getElementById: (id) => toggles.get(id) || null,
    querySelectorAll: (selector) => (selector === '.course_bs_credit' ? details : []),
    addEventListener(name, listener) {
      const bucket = listeners.get(name) || [];
      bucket.push(listener);
      listeners.set(name, bucket);
    },
    dispatchEvent(event) {
      (listeners.get(event.type) || []).forEach((listener) => listener(event));
    },
  };
  const stored = new Map([
    ['showCourseDetails', 'false'],
    ['hideTakenCourses', 'true'],
  ]);
  const controller = globals.surriculumPlannerPreferences.createController({
    document,
    preferenceGetItem: (key) => (stored.has(key) ? stored.get(key) : null),
    preferenceSetItem: (key, value) => stored.set(key, value),
  });

  assert.equal(Object.isFrozen(controller), true);
  assert.equal(controller.initialize(), true);
  assert.equal(controller.initialize(), false);
  assert.equal(globals.showCourseDetails, false);
  assert.equal(globals.hideTakenCourses, true);
  assert.equal(globals.plannerFilterOfferedOnly, true);
  assert.equal(globals.sortBasedOnScore, true);
  assert.ok(details.every((element) => element.style.display === 'none'));

  toggles.get('courseDetailsToggle').listeners.change({ target: { checked: true } });
  assert.equal(globals.showCourseDetails, true);
  assert.equal(stored.get('showCourseDetails'), 'true');
  assert.ok(details.every((element) => element.style.display === ''));
});
