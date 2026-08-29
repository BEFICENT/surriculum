'use strict';

const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const test = require('node:test');

const { waitForStableFingerprint } = require('../scenarios/_shared');

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

class FakeElement {
  constructor(parent = null) {
    this.parent = parent;
    this.children = [];
    this.textContent = '';
    this.scrollHeight = 100;
    this.scrollWidth = 100;
    this.value = '';
    if (parent) parent.children.push(this);
  }

  contains(candidate) {
    for (let current = candidate; current; current = current.parent) {
      if (current === this) return true;
    }
    return false;
  }
}

class FakePage {
  async evaluate(callback, argument) {
    return callback(argument);
  }

  async waitForFunction(callback, argument, options = {}) {
    const deadline = performance.now() + Number(options.timeout || 1_000);
    while (performance.now() < deadline) {
      if (await callback(argument)) return true;
      await delay(8);
    }
    throw new Error('FakePage.waitForFunction timed out.');
  }
}

test('stability wait cannot reuse prior state before a delayed result mutation', async () => {
  const originalWindow = global.window;
  const originalDocument = global.document;
  const originalMutationObserver = global.MutationObserver;
  const observers = new Set();
  const documentElement = new FakeElement();
  const root = new FakeElement(documentElement);
  const results = new FakeElement(root);
  const search = new FakeElement(root);
  const options = [new FakeElement(results)];

  const fakeDocument = {
    documentElement,
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    },
    querySelectorAll(selector) {
      if (selector === '.root') return [root];
      if (selector === '.root .results') return [results];
      if (selector === '.root .search') return [search];
      return [];
    },
  };
  root.querySelectorAll = (selector) => {
    if (selector === '.course-option, .scheduler-course') return options.slice();
    if (selector === '*') return [results, search, ...options];
    return [];
  };

  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback;
    }

    observe() {
      observers.add(this);
    }

    disconnect() {
      observers.delete(this);
    }
  }

  global.window = {};
  global.document = fakeDocument;
  global.MutationObserver = FakeMutationObserver;
  try {
    const page = new FakePage();
    const startedAt = performance.now();
    let completed = false;
    const completion = waitForStableFingerprint(page, '.root', async () => {
      search.value = 'after';
      setTimeout(() => {
        options.push(new FakeElement(results));
        root.scrollHeight += 10;
        const record = { target: results, addedNodes: options.slice(-1), removedNodes: [] };
        for (const observer of observers) observer.callback([record]);
      }, 80);
    }, {
      expected: { selector: '.root .search', value: 'after' },
      mutationSelector: '.root .results',
      quietMs: 40,
      stableFrames: 2,
      timeout: 1_000,
    }).then(() => {
      completed = true;
    });

    await delay(50);
    assert.equal(completed, false, 'the waiter must not finish on the pre-action fingerprint');
    await completion;
    assert.ok(
      performance.now() - startedAt >= 110,
      'the waiter must observe the delayed render and then a quiet window',
    );
    assert.equal(options.length, 2);
    assert.equal(observers.size, 0, 'the per-action observer should be disconnected');
    assert.equal(global.window.__surriculumPerfStabilityWaits.size, 0);
  } finally {
    if (originalWindow === undefined) delete global.window;
    else global.window = originalWindow;
    if (originalDocument === undefined) delete global.document;
    else global.document = originalDocument;
    if (originalMutationObserver === undefined) delete global.MutationObserver;
    else global.MutationObserver = originalMutationObserver;
  }
});
