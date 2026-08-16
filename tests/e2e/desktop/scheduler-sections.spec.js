'use strict';

const { test, expect } = require('../fixtures');
const { openScheduler, pickCourse, readBlockHues } = require('../helpers/scheduler');

test.describe('scheduler section picking (desktop)', () => {
  test('picking a section commits it as a grid block and a selected entry', async ({ page }) => {
    await page.goto('/');
    const modal = await openScheduler(page);

    await pickCourse(page, 'NS101');

    // The committed section renders as a coloured block in a day column...
    await expect(
      modal.locator('.scheduler-day-col .scheduler-block[data-course="NS101"]').first(),
    ).toBeVisible();
    // ...and appears in the "Selected Sections" list with a colour dot.
    await expect(modal.locator('.scheduler-selected-label').filter({ hasText: 'NS101' }).first()).toBeVisible();
    await expect(modal.locator('.scheduler-color-dot').first()).toBeVisible();
  });

  test('committed course blocks never render in the unreadable yellow band', async ({ page }) => {
    await page.goto('/');
    await openScheduler(page);

    // These course ids hash INTO the yellow band (45-80deg) under the old colour
    // function; the fix must steer every hue out of it. Committing them and
    // reading the REAL rendered block colour is a precise revert guard.
    for (const code of ['PSY201', 'HIST191']) {
      await pickCourse(page, code);
    }

    const hues = await readBlockHues(page);
    expect(hues.length).toBeGreaterThan(0);
    for (const { course, hue } of hues) {
      expect(
        hue === null || hue < 45 || hue >= 80,
        `block ${course} rendered at hue ${hue}, inside the reserved yellow band`,
      ).toBeTruthy();
    }
  });
});
