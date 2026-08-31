'use strict';

const { test, expect } = require('../fixtures');
const {
  RETURNING_PLAN,
  gatePrimaryCatalog,
  seedReturningPlanBeforeNavigation,
  waitForPlannerReady,
} = require('../helpers/planner-startup');

test('a returning plan stays visibly busy until its semesters finish hydrating', async ({
  page,
  browserErrors,
}) => {
  await seedReturningPlanBeforeNavigation(page);
  const catalog = await gatePrimaryCatalog(page);
  const navigation = page.goto('/', { waitUntil: 'domcontentloaded' });

  await catalog.started;
  await navigation;
  try {
    const board = page.locator('#board');
    const loadingState = page.locator('#plannerLoadingState');

    await expect(board).toHaveAttribute('aria-busy', 'true');
    await expect(loadingState).toBeVisible();
    await expect(loadingState).toHaveAttribute('role', 'status');
    await expect(loadingState).toHaveAttribute('aria-live', 'polite');
    await expect(loadingState.locator('.planner-loading-message'))
      .toContainText(/Loading (?:your )?semesters/i);
    expect(await page.evaluate(() => window.__surriculumPlannerReady)).toBe(false);
    await expect(page.locator('.container_semester')).toHaveCount(0);
    await expect(page.locator('.add-semester-ghost')).toHaveCount(0);
  } finally {
    catalog.release();
  }

  expect(await waitForPlannerReady(page)).toBe(true);
  await expect(page.locator('#board')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#plannerLoadingState')).toBeHidden();
  await expect(page.locator('.container_semester .date p')).toHaveText(RETURNING_PLAN.dates);
  await expect(page.locator('.container_semester .course_code'))
    .toHaveText(RETURNING_PLAN.curriculum.flat());
  await expect(page.locator('.add-semester-ghost')).toBeVisible();
  expect(browserErrors, browserErrors.join('\n')).toEqual([]);
});
