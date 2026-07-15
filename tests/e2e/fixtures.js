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
const IGNORED_CONSOLE = [/Failed to load resource/];

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
  browserErrors: [async ({ page }, use, testInfo) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (IGNORED_CONSOLE.some((re) => re.test(text))) return;
      errors.push('console.error: ' + text);
    });

    await use(errors);

    // Only when the test would otherwise have passed: if it already failed,
    // its own failure is the more useful one and must not be masked.
    if (errors.length && testInfo.status === testInfo.expectedStatus) {
      throw new Error(
        `The app emitted ${errors.length} uncaught error(s) during this test:\n  ` + errors.join('\n  '),
      );
    }
  }, { auto: true }],
});

module.exports = { test, expect: base.expect };
