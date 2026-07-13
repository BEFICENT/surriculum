'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');

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

  test('hide-taken keeps a future-term-planned course visible but hides a past-term one', async ({ page }) => {
    // Regression guard for the fix: a course planned only for a term AFTER the
    // scheduler's selected term is not "taken" yet and must stay listed.
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [['MATH101'], ['MATH102']], // sem0 past, sem1 future
      grades: [['A'], ['']],
      dates: ['Fall 2024-2025', 'Fall 2026-2027'], // 202401 (past), 202601 (future)
      schedulerSelectedTerm: '202503', // Summer 2025-2026: strictly between the two
    });

    await page.evaluate(() => { window.hideTakenCourses = true; window.openSchedulerModal(); });
    const modal = page.locator('.scheduler-modal');
    await expect(modal).toBeVisible({ timeout: 15000 });

    // Narrow the list so result pagination can't be what hides a course.
    await modal.locator('.scheduler-search').fill('MATH10');
    await expect(modal.locator('.scheduler-course').first()).toBeVisible({ timeout: 15000 });

    // MATH102 is planned for a FUTURE term -> not taken yet -> visible.
    await expect(modal.locator('.scheduler-course[data-course="MATH102"]')).toHaveCount(1);
    // MATH101 is planned for a PAST term -> taken -> hidden.
    await expect(modal.locator('.scheduler-course[data-course="MATH101"]')).toHaveCount(0);
  });
});
