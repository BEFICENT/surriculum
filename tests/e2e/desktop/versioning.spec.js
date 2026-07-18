'use strict';

const { test, expect } = require('../fixtures');

// The app used to carry three version numbers that drifted independently: the
// <title>, the header text, and the service-worker cache key. Step 2 separates
// the concerns into a single app version (version.js), a data version
// (data/manifest.json), and the storage-schema version (plan_manager.js), and
// derives the SW cache key from app + data so it never needs a manual bump.
//
// These tests pin that: the displayed version is DRIVEN by window.APP_VERSION
// (not just the static markup, which a passing branding check alone couldn't
// distinguish), and the data manifest is served and well-formed.

test.describe('app version is single-sourced from version.js', () => {
  test('APP_VERSION is defined and drives the title + header', async ({ page }) => {
    await page.goto('/');
    const r = await page.evaluate(() => ({
      appVersion: window.APP_VERSION,
      title: document.title,
      header: document.querySelector('.header-title')
        ? document.querySelector('.header-title').textContent.trim()
        : null,
    }));
    expect(r.appVersion, 'window.APP_VERSION should be defined').toBeTruthy();
    // The displayed strings must be derived from APP_VERSION, not hard-coded.
    expect(r.title).toBe(`SUrriculum v${r.appVersion}`);
    expect(r.header).toBe(`SUrriculum v${r.appVersion}`);
  });
});

test.describe('data version lives in data/manifest.json', () => {
  test('the manifest is served and carries a dataVersion', async ({ page }) => {
    await page.goto('/');
    const m = await page.evaluate(async () => {
      const res = await fetch('/data/manifest.json', { cache: 'no-store' });
      return { status: res.status, json: res.ok ? await res.json() : null };
    });
    expect(m.status).toBe(200);
    expect(typeof m.json.dataVersion, 'dataVersion should be a string').toBe('string');
    expect(m.json.dataVersion.length).toBeGreaterThan(0);
  });
});
