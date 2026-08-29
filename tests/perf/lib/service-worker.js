'use strict';

/**
 * Browser-side implementation kept as a named function so the bounded state
 * transition can be exercised by the performance contract tests as well as by
 * Playwright.
 */
function waitForActivatedServiceWorker(deadlineMs) {
  return new Promise((resolve, reject) => {
    if (!('serviceWorker' in navigator)) {
      reject(new Error('service workers are unavailable in this browser context'));
      return;
    }

    const timeoutMs = Math.max(1, Number(deadlineMs || 30_000));
    const workerListeners = new Map();
    let registration = null;
    let pollTimer = null;
    let timeoutTimer = null;
    let settled = false;
    let lastState = 'ready promise pending';

    const cleanup = () => {
      if (pollTimer !== null) clearTimeout(pollTimer);
      if (timeoutTimer !== null) clearTimeout(timeoutTimer);
      for (const [worker, listener] of workerListeners) {
        worker.removeEventListener('statechange', listener);
      }
      workerListeners.clear();
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const scheduleCheck = () => {
      if (settled || pollTimer !== null) return;
      pollTimer = setTimeout(() => {
        pollTimer = null;
        checkRegistration();
      }, Math.min(50, timeoutMs));
    };
    const watchWorker = (worker) => {
      if (!worker || workerListeners.has(worker)) return;
      const listener = () => checkRegistration();
      worker.addEventListener('statechange', listener);
      workerListeners.set(worker, listener);
    };
    const checkRegistration = () => {
      if (settled || !registration) return;
      watchWorker(registration.installing);
      watchWorker(registration.waiting);
      watchWorker(registration.active);
      const active = registration.active;
      lastState = active?.state || registration.installing?.state
        || registration.waiting?.state || 'no active worker';
      if (active && active.state === 'activated') {
        finish(resolve, {
          scope: registration.scope,
          scriptURL: active.scriptURL || '',
          state: active.state,
        });
        return;
      }
      scheduleCheck();
    };

    timeoutTimer = setTimeout(() => finish(
      reject,
      new Error(
        `service worker did not reach active state "activated" within ${timeoutMs}ms `
          + `(last observed state: ${lastState})`,
      ),
    ), timeoutMs);

    navigator.serviceWorker.ready.then(
      (readyRegistration) => {
        registration = readyRegistration;
        checkRegistration();
      },
      (error) => finish(
        reject,
        error instanceof Error ? error : new Error(String(error)),
      ),
    );
  });
}

/** Wait for an activated service worker without allowing a broken install to hang forever. */
async function waitForServiceWorkerReady(page, timeout = 30_000) {
  const timeoutMs = Math.max(1, Number(timeout || 30_000));
  return page.evaluate(waitForActivatedServiceWorker, timeoutMs);
}

module.exports = { waitForActivatedServiceWorker, waitForServiceWorkerReady };
