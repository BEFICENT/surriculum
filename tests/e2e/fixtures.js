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
  browserErrors: async ({ page }, use) => {
    const errors = [];
    page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (IGNORED_CONSOLE.some((re) => re.test(text))) return;
      errors.push('console.error: ' + text);
    });
    await use(errors);
  },
});

module.exports = { test, expect: base.expect };
