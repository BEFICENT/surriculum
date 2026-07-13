'use strict';

// Shared Playwright fixtures for SUrriculum's e2e tests.
//
// The app swallows a lot of failures in try/catch, so a broken flow often shows
// up only as a console.error or an uncaught pageerror rather than a thrown test
// failure. This fixture records both so a test can assert `browserErrors` is
// empty and catch that whole class of silent regressions.
const base = require('@playwright/test');

// Network-layer failures aren't app regressions. The app pulls three external
// CDNs (Google Fonts, Font Awesome, pdf.js via unpkg); those are blocked in
// sandboxed/offline test environments but load fine in production. Ignore
// net:: errors only — HTTP status errors (e.g. a 404 on a local data file) and
// real app console.errors still fail the suite.
const IGNORED_CONSOLE = [/net::ERR_/];

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
