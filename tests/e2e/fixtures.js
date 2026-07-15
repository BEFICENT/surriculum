'use strict';

// Shared Playwright fixtures for SUrriculum's e2e tests.
//
// The app swallows a lot of failures in try/catch, so a broken flow often shows
// up only as a console.error or an uncaught pageerror rather than a thrown test
// failure. This fixture records both so a test can assert `browserErrors` is
// empty and catch that whole class of silent regressions.
const base = require('@playwright/test');

// Subresource load failures are browser-generated ("Failed to load resource:
// ...") and aren't app-logic regressions, so they don't fail the suite:
//  - external CDNs (Google Fonts, Font Awesome, pdf.js/unpkg) are blocked in
//    sandboxed/offline runs but load fine in production;
//  - the scheduler probes several candidate schedule-data paths and one 404s
//    benignly while another succeeds.
// Everything else — uncaught pageerrors and console.error calls the app itself
// makes — still fails the suite.
const IGNORED_CONSOLE = [
  /Failed to load resource/,
  // The service worker races the sandbox and sometimes can't fetch its own
  // script. Same-origin, but the fetch happens in worker scope so it never
  // surfaces as a page `requestfailed` for the guard below to notice.
  /An unknown error occurred when fetching the script/,
];

// Uncaught errors that are artifacts of THIS environment rather than the app.
// Kept as a short, specific list — never a broad pattern — because the whole
// value of the fixture is that a genuinely missing global looks like a real
// bug. Each entry names a third-party thing that simply is not there when the
// sandbox blocks its origin, and that loads fine in production.
const IGNORED_PAGEERROR = [
  // pdf.js is loaded from unpkg; blocked here, so its global is absent. The
  // pdf-parser spec injects the library itself rather than relying on the CDN.
  /pdfjsLib is not defined/,
  /Failed to register a ServiceWorker/,
];

const test = base.test.extend({
  // `auto: true` so EVERY test gets this, whether or not it asks for the
  // fixture. It used to be opt-in, and only 2 of 202 tests opted in — the net
  // was there but hardly wired up, so an uncaught TypeError could fire on a
  // flow a test was driving and the test would still pass. (That is exactly
  // what happened: getAncestor threw on every drag dropped outside a semester,
  // and the drag test sailed past it.)
  //
  // A test that MEANS to trigger an error should assert on `browserErrors` and
  // then empty it — see semester-drag.spec.js.
  browserErrors: [async ({ page, baseURL }, use, testInfo) => {
    const errors = [];
    page.on('pageerror', (err) => {
      if (IGNORED_PAGEERROR.some((re) => re.test(err.message))) return;
      errors.push('pageerror: ' + err.message);
    });
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (IGNORED_CONSOLE.some((re) => re.test(text))) return;
      errors.push('console.error: ' + text);
    });

    // The sandbox intermittently denies localhost requests
    // (net::ERR_NETWORK_ACCESS_DENIED). When one of the app's OWN scripts fails
    // to load, everything downstream throws — "s_curriculum is not defined",
    // "entryTerms is not defined", the service worker failing to register. Those
    // are a broken RUN, not a broken app, and blanket-ignoring their messages
    // would blind this fixture to the real thing (a genuinely missing global
    // looks identical). So instead: notice that a same-origin request failed,
    // and decline to judge the errors at all — the retry gets a clean load.
    let appResourceFailed = false;
    page.on('requestfailed', (req) => {
      if (baseURL && req.url().startsWith(baseURL)) appResourceFailed = true;
    });

    await use(errors);

    // Only when the test would otherwise have passed: if it already failed, its
    // own failure is the more useful one and must not be masked.
    if (errors.length && !appResourceFailed && testInfo.status === testInfo.expectedStatus) {
      throw new Error(
        `The app emitted ${errors.length} uncaught error(s) during this test:\n  ` + errors.join('\n  '),
      );
    }
  }, { auto: true }],
});

module.exports = { test, expect: base.expect };
