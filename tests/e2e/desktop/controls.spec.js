'use strict';

const { test, expect } = require('../fixtures');

test.describe('controls (desktop)', () => {
  test('sidebar exposes only the four course-picker defaults', async ({ page }) => {
    await page.goto('/');

    const defaultIds = await page.locator('.control-group-option input[type="checkbox"]')
      .evaluateAll((inputs) => inputs.map((input) => input.id));
    expect(defaultIds).toEqual([
      'courseDetailsToggle',
      'hideTakenCoursesToggle',
      'plannerOfferedOnlyToggle',
      'sortByScoreToggle',
    ]);

    await expect(page.locator('#plannerOfferedOnlyToggle'))
      .toHaveAccessibleName(/offered.*semester/i);
    await expect(page.locator('#offeredThisTermToggle')).toHaveCount(0);
    await expect(page.locator('#offeredThisTermLabel')).toHaveCount(0);

    await expect(page.locator('#hideTakenCoursesToggle')).toBeChecked();
    await expect(page.locator('#plannerOfferedOnlyToggle')).toBeChecked();
  });
});
