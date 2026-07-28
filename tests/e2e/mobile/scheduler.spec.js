'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');

async function seedScheduler(page, selected = {}) {
  await seedPlan(page, {
    major: 'CS',
    entryTerm: 'Fall 2024-2025',
    curriculum: [],
    grades: [],
    dates: [],
    schedulerSelectedTerm: '202403',
    schedulerStates: {
      202403: { selected, blocked: [] },
    },
  });
}

async function openMobileScheduler(page) {
  await page.evaluate(() => { window.openSchedulerModal(); });
  const modal = page.locator('.scheduler-modal.m-scheduler');
  await expect(modal).toBeVisible({ timeout: 15000 });
  await expect(modal.locator('.scheduler-course').first()).toBeVisible({ timeout: 15000 });
  return modal;
}

async function tapCoursePreview(modal, courseId) {
  const portraitFab = modal.locator('.m-sched-fab');
  if (await portraitFab.isVisible()) await portraitFab.click();
  else await modal.locator('.m-sched-corner-search').click();

  await modal.locator('.scheduler-search').fill(courseId);
  const card = modal.locator(`.scheduler-course[data-course="${courseId}"]`);
  await expect(card).toBeVisible();
  await card.locator('.scheduler-course-head').click();
  await expect(modal).toHaveClass(/m-preview/);
}

async function waitForLandscapeFit(modal) {
  await expect.poll(async () => modal.evaluate((root) => {
    const grid = root.querySelector('.scheduler-grid');
    if (!grid) return Infinity;
    const styles = getComputedStyle(grid);
    const ppm = parseFloat(styles.getPropertyValue('--scheduler-minute'));
    const topGap = parseFloat(styles.getPropertyValue('--scheduler-top-gap')) || 14;
    const minutes = parseFloat(root.getAttribute('data-grid-minutes')) || 660;
    const target = Math.max(0.26, Math.min(1, (grid.clientHeight - topGap - 2) / minutes));
    return Math.abs(ppm - target);
  // The production refit deliberately ignores sub-1% changes, and the CSS
  // value is rounded to three decimals, so this means "settled" rather than
  // requiring mathematical identity with the target.
  })).toBeLessThan(0.005);
}

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

  test('portrait adds Saturday only while a selected section needs it', async ({ page }) => {
    await seedScheduler(page, { DA519: { course_id: 'DA519', crn: '30192' } });

    await page.evaluate(() => { window.openSchedulerModal(); });
    const modal = page.locator('.scheduler-modal.m-scheduler');
    await expect(modal).toBeVisible({ timeout: 15000 });
    await expect(modal.locator('.m-sched-day')).toHaveCount(6, { timeout: 15000 });

    await modal.locator('.m-sched-day[data-day="S"]').click();
    await expect(modal).toHaveAttribute('data-m-day', 'S');
    await expect(modal.locator('.scheduler-day-col[data-day="S"]')).toBeVisible();
    await expect(modal.locator('.scheduler-day-col[data-day="S"] .scheduler-block[data-course="DA519"]')).toBeVisible();

    await modal.locator('.scheduler-remove[data-course="DA519"]').evaluate(button => button.click());
    await expect(modal.locator('.m-sched-day')).toHaveCount(5);
    await expect(modal.locator('.m-sched-day[data-day="S"]')).toHaveCount(0);
    await expect(modal).not.toHaveAttribute('data-m-day', 'S');
  });

  test('tap preview expands Saturday and late hours even when desktop hover preview is disabled', async ({ page }) => {
    await seedScheduler(page);
    await page.evaluate(() => localStorage.setItem('schedulerHoverPreview', 'false'));
    const modal = await openMobileScheduler(page);

    // DA519/30192 meets Wednesday 19:00-22:00 and Saturday 13:00-16:00.
    await tapCoursePreview(modal, 'DA519');
    await expect(modal).toHaveAttribute('data-grid-days', 'MTWRFS');
    await expect(modal).toHaveAttribute('data-grid-minutes', '840');
    await expect(modal.locator('.m-sched-day')).toHaveCount(6);
    await expect(modal).toHaveAttribute('data-m-day', 'W');
    await expect(modal.locator('.scheduler-day-col[data-day="W"] .scheduler-block.is-preview[data-end="1320"]')).toBeVisible();

    await modal.locator('.m-sched-day[data-day="S"]').click();
    await expect(modal.locator('.scheduler-day-col[data-day="S"] .scheduler-block.is-preview[data-course="DA519"]')).toBeVisible();

    await modal.locator('.m-prev-back').click();
    await expect(modal).not.toHaveClass(/m-preview/);
    await expect(modal.locator('.scheduler-block.is-preview')).toHaveCount(0);
    await expect(modal).toHaveAttribute('data-grid-days', 'MTWRF');
    await expect(modal).toHaveAttribute('data-grid-minutes', '660');
    await expect(modal.locator('.m-sched-day')).toHaveCount(5);
  });

  test('landscape restores committed block geometry after a late preview collapses', async ({ page }) => {
    await page.setViewportSize({ width: 915, height: 412 });
    await seedScheduler(page, { HUM201D: { course_id: 'HUM201D', crn: '30127' } });
    const modal = await openMobileScheduler(page);
    const reference = modal.locator('.scheduler-block[data-course="HUM201D"][data-day="W"]');
    await expect(reference).toBeVisible();
    await waitForLandscapeFit(modal);
    const before = await reference.evaluate(el => ({
      top: parseFloat(el.style.top),
      height: parseFloat(el.style.height),
    }));

    await tapCoursePreview(modal, 'DA519');
    await expect(modal).toHaveAttribute('data-grid-days', 'MTWRFS');
    await expect(modal).toHaveAttribute('data-grid-minutes', '840');
    await waitForLandscapeFit(modal);

    await modal.locator('.m-prev-back').click();
    await expect(modal.locator('.scheduler-block.is-preview')).toHaveCount(0);
    await expect(modal).toHaveAttribute('data-grid-days', 'MTWRF');
    await expect(modal).toHaveAttribute('data-grid-minutes', '660');
    await waitForLandscapeFit(modal);
    const after = await reference.evaluate(el => ({
      top: parseFloat(el.style.top),
      height: parseFloat(el.style.height),
    }));

    // Allow one CSS pixel for the initial pre-render estimate being replaced by
    // the measured fit; the old clamped-height drift is several pixels larger.
    expect(Math.abs(after.top - before.top)).toBeLessThan(1.25);
    expect(Math.abs(after.height - before.height)).toBeLessThan(1.25);
  });
});
