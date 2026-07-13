'use strict';

const { test, expect } = require('../fixtures');

test.describe('controls (desktop)', () => {
  test('offered-courses toggle uses the "for <term> term" wording', async ({ page }) => {
    await page.goto('/');
    // main.js rewrites this label from window.currentTermName on load.
    const label = page.locator('#offeredThisTermLabel');
    await expect(label).toHaveText(/^Only show offered courses for .+ term$/);
  });

  test('hide-taken and offered-courses toggles exist and default on', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('#hideTakenCoursesToggle')).toBeChecked();
    await expect(page.locator('#offeredThisTermToggle')).toBeChecked();
  });
});
