'use strict';

const { test, expect } = require('../fixtures');

test.describe('shared preference storage', () => {
  test('copies legacy keys before the app reads them without deleting generic storage', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('theme', 'dark-theme');
      localStorage.setItem('showCourseDetails', 'false');
      localStorage.setItem('schedulerHoverPreview', 'false');
    });

    await page.goto('/');
    await expect(page.locator('body')).toHaveClass(/dark-theme/);
    await expect(page.locator('#courseDetailsToggle')).not.toBeChecked();

    const stored = await page.evaluate(() => ({
      theme: window.preferenceStorage.getItem('theme'),
      details: window.preferenceStorage.getItem('showCourseDetails'),
      hover: window.preferenceStorage.getItem('schedulerHoverPreview'),
      genericKeys: ['theme', 'showCourseDetails', 'schedulerHoverPreview']
        .filter((key) => localStorage.getItem(key) !== null),
      scopedKeys: [
        'surriculum.preference.theme',
        'surriculum.preference.showCourseDetails',
        'surriculum.preference.schedulerHoverPreview',
      ].filter((key) => localStorage.getItem(key) !== null),
    }));

    expect(stored).toEqual({
      theme: 'dark-theme',
      details: 'false',
      hover: 'false',
      genericKeys: ['theme', 'showCourseDetails', 'schedulerHoverPreview'],
      scopedKeys: [
        'surriculum.preference.theme',
        'surriculum.preference.showCourseDetails',
        'surriculum.preference.schedulerHoverPreview',
      ],
    });
  });

  test('keeps preferences shared between tabs without plan-scoped copies', async ({ browser }) => {
    const context = await browser.newContext();
    const first = await context.newPage();
    const second = await context.newPage();
    await first.goto('/');
    await second.goto('/');

    await first.evaluate(() => window.preferenceStorage.setItem('sortBasedOnScore', 'false'));
    await expect.poll(() => second.evaluate(
      () => window.preferenceStorage.getItem('sortBasedOnScore')
    )).toBe('false');

    const keys = await first.evaluate(() => Object.keys(localStorage));
    expect(keys).toContain('surriculum.preference.sortBasedOnScore');
    expect(keys).not.toContain('sortBasedOnScore');
    expect(keys.some((key) => /^surriculum\.plan\..*\.sortBasedOnScore$/.test(key))).toBe(false);
    await context.close();
  });
});
