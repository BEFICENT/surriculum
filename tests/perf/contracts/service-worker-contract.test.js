'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  waitForServiceWorkerReady,
} = require('../lib/service-worker');
const {
  offlineFailureSignature,
  recordedOfflineFailureSignatures,
} = require('../run');

class FakeWorker extends EventTarget {
  constructor(state, scriptURL = 'https://example.test/sw.js?v=test') {
    super();
    this.state = state;
    this.scriptURL = scriptURL;
  }

  transitionTo(state) {
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }
}

async function withServiceWorkerContainer(serviceWorker, action) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { serviceWorker },
  });
  try {
    return await action();
  } finally {
    if (original) Object.defineProperty(globalThis, 'navigator', original);
    else delete globalThis.navigator;
  }
}

const fakePage = {
  evaluate(callback, argument) {
    return callback(argument);
  },
};

test('service-worker ready waits for the active worker to reach activated', async () => {
  const worker = new FakeWorker('activating');
  const registration = {
    scope: 'https://example.test/',
    active: worker,
    installing: null,
    waiting: null,
  };

  await withServiceWorkerContainer({ ready: Promise.resolve(registration) }, async () => {
    let resolved = false;
    const ready = waitForServiceWorkerReady(fakePage, 1_000).then((value) => {
      resolved = true;
      return value;
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(resolved, false);

    worker.transitionTo('activated');
    assert.deepEqual(await ready, {
      scope: registration.scope,
      scriptURL: worker.scriptURL,
      state: 'activated',
    });
  });
});

test('service-worker ready rejects boundedly when activation never completes', async () => {
  const worker = new FakeWorker('activating');
  const registration = {
    scope: 'https://example.test/',
    active: worker,
    installing: null,
    waiting: null,
  };

  await withServiceWorkerContainer({ ready: Promise.resolve(registration) }, async () => {
    await assert.rejects(
      waitForServiceWorkerReady(fakePage, 20),
      /did not reach active state "activated" within 20ms.*activating/,
    );
  });
});

test('offline request exemptions require an exact scenario-recorded signature', () => {
  const recorded = recordedOfflineFailureSignatures([{
    method: 'GET',
    url: 'https://example.test/courses/202401/CS.jsonl',
    error: 'net::ERR_INTERNET_DISCONNECTED',
  }]);

  assert.equal(recorded.has(offlineFailureSignature({
    method: 'GET',
    url: 'https://example.test/courses/202401/CS.jsonl',
    error: 'net::ERR_INTERNET_DISCONNECTED',
  })), true);
  assert.equal(recorded.has(offlineFailureSignature({
    method: 'GET',
    url: 'https://example.test/requirements/202401.jsonl',
    error: 'net::ERR_INTERNET_DISCONNECTED',
  })), false);
  assert.equal(recorded.has(offlineFailureSignature({
    method: 'GET',
    url: 'https://example.test/courses/202401/CS.jsonl',
    error: 'net::ERR_FAILED',
  })), false);
});
