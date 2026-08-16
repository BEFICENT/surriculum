'use strict';

// Deliberately small Firefox/WebKit coverage. The full browser suite remains
// Chromium-only; repeating hundreds of planner combinations in every engine
// would make pull-request feedback much slower without adding proportional
// confidence.
const { defineConfig, devices } = require('@playwright/test');

const PORT = 8000;
const BASE_URL = `http://127.0.0.1:${PORT}`;

module.exports = defineConfig({
  testDir: './tests/e2e/cross-browser',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    storageState: undefined,
  },
  projects: [
    {
      name: 'firefox-critical',
      use: { ...devices['Desktop Firefox'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'webkit-critical',
      use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 800 } },
    },
  ],
  webServer: {
    command: 'python -m http.server ' + PORT,
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 30000,
  },
});
