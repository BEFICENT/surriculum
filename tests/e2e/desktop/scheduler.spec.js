'use strict';

const { test, expect } = require('../fixtures');

test.describe('scheduler (desktop)', () => {
  test('opens and lists offered courses for the term', async ({ page, browserErrors }) => {
    await page.goto('/');

    // Fire the opener without awaiting its internal async chain (it fetches the
    // schedule index before inserting the modal, and cold-start timing varies);
    // wait on the observable modal instead, with a generous timeout.
    await page.evaluate(() => { window.openSchedulerModal(); });

    const modal = page.locator('.scheduler-modal');
    await expect(modal).toBeVisible({ timeout: 15000 });
    await expect(modal.locator('.scheduler-term')).toContainText(/Fall|Spring|Summer/);

    // Results are fetched async from the schedule index; wait for the first card.
    await expect(modal.locator('.scheduler-course').first()).toBeVisible({ timeout: 15000 });
    expect(await modal.locator('.scheduler-course').count()).toBeGreaterThan(0);

    expect(browserErrors, browserErrors.join('\n')).toEqual([]);
  });
});
