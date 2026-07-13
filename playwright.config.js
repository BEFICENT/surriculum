// Playwright config for SUrriculum's end-to-end tests.
//
// These drive the REAL app in a real browser (the same way changes have been
// verified by hand), so they pin behaviour at the UI boundary and survive
// internal refactors. The app is served statically by Python's http.server —
// no build step — exactly like the normal dev loop.
const { defineConfig, devices } = require('@playwright/test');

const PORT = 8000;
const BASE_URL = `http://localhost:${PORT}`;

module.exports = defineConfig({
  testDir: './tests/e2e',
  // The app leans on global/DOM state and a shared localStorage; keep runs
  // deterministic by executing serially rather than racing parallel workers.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  // A retry budget absorbs environment noise: cold-start data-fetch timing, and
  // intermittent sandbox denials of even the localhost navigation
  // (net::ERR_NETWORK_ACCESS_DENIED before the app loads). A *real* regression
  // fails consistently and still fails; only sub-100%-reproducible flakes are
  // retried, and Playwright flags them as "flaky" so they stay visible.
  retries: 2,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    // Start every test from a clean slate (no leaked plan from a prior test).
    storageState: undefined,
  },
  projects: [
    {
      name: 'desktop',
      testMatch: '**/desktop/**/*.spec.js',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      // Phone profile exercises the mobile UI layer (body.is-mobile, <= 820px).
      name: 'mobile',
      testMatch: '**/mobile/**/*.spec.js',
      use: { ...devices['Pixel 7'] },
    },
  ],
  webServer: {
    command: 'python -m http.server ' + PORT,
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 30000,
  },
});
