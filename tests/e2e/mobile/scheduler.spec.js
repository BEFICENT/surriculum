'use strict';

const { test, expect } = require('../fixtures');

test.describe('mobile scheduler', () => {
  test('portrait is a day-at-a-time view with a working day selector', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('body')).toHaveClass(/is-mobile/);

    await page.evaluate(() => { window.openSchedulerModal(); });
    const modal = page.locator('.scheduler-modal.m-scheduler');
    await expect(modal).toBeVisible({ timeout: 15000 });

    // Injected Mon-Fri day selector.
    await expect(modal.locator('.m-sched-day')).toHaveCount(5);

    // Tapping Wednesday switches the view to that day only.
    await modal.locator('.m-sched-day[data-day="W"]').click();
    await expect(modal).toHaveAttribute('data-m-day', 'W');
    await expect(modal.locator('.scheduler-day-col[data-day="W"]')).toBeVisible();
    await expect(modal.locator('.scheduler-day-col[data-day="M"]')).toBeHidden();
  });

  test('landscape shows the whole week scaled to fit', async ({ page }) => {
    await page.setViewportSize({ width: 915, height: 412 }); // rotate to landscape
    await page.goto('/');
    await expect(page.locator('body')).toHaveClass(/is-mobile/);

    await page.evaluate(() => { window.openSchedulerModal(); });
    const modal = page.locator('.scheduler-modal.m-scheduler');
    await expect(modal).toBeVisible({ timeout: 15000 });

    // All five day columns are visible at once (no day-at-a-time hiding).
    for (const d of ['M', 'T', 'W', 'R', 'F']) {
      await expect(modal.locator(`.scheduler-day-col[data-day="${d}"]`)).toBeVisible();
    }

    // The fit scale (px-per-minute) is set so the day compresses to fit.
    const ppm = await page.evaluate(
      () => getComputedStyle(document.documentElement).getPropertyValue('--m-fit-ppm').trim(),
    );
    expect(ppm).not.toBe('');
    expect(parseFloat(ppm)).toBeGreaterThan(0);
  });
});
