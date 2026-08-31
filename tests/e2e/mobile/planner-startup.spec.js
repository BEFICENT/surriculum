'use strict';

const { test, expect } = require('../fixtures');
const {
  gatePrimaryCatalog,
  seedReturningPlanBeforeNavigation,
  visualPlannerStack,
  waitForPlannerReady,
} = require('../helpers/planner-startup');

test('mobile transitions from loading to New Semester first and newest semesters first', async ({
  page,
  browserErrors,
}) => {
  await seedReturningPlanBeforeNavigation(page);
  const catalog = await gatePrimaryCatalog(page);
  const navigation = page.goto('/', { waitUntil: 'domcontentloaded' });

  await catalog.started;
  await navigation;
  try {
    await expect(page.locator('body')).toHaveClass(/is-mobile/);
    await expect(page.locator('body')).toHaveAttribute('data-mobile-tab', 'planner');
    await expect(page.locator('#board')).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('#plannerLoadingState')).toBeVisible();
    await expect(page.locator('.container_semester')).toHaveCount(0);
    await expect(page.locator('.add-semester-ghost')).toHaveCount(0);
    expect(await visualPlannerStack(page)).toEqual([]);
  } finally {
    catalog.release();
  }

  expect(await waitForPlannerReady(page)).toBe(true);
  await expect(page.locator('#board')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#plannerLoadingState')).toBeHidden();

  const expected = [
    { kind: 'new-semester', label: 'New Semester' },
    { kind: 'semester', label: 'Fall 2025-2026' },
    { kind: 'semester', label: 'Spring 2024-2025' },
    { kind: 'semester', label: 'Fall 2024-2025' },
  ];
  const stack = await visualPlannerStack(page);
  expect(stack.map(({ kind, label }) => ({ kind, label }))).toEqual(expected);
  for (let index = 1; index < stack.length; index += 1) {
    expect(stack[index - 1].top, `${stack[index - 1].label} is above ${stack[index].label}`)
      .toBeLessThan(stack[index].top);
  }
  expect(browserErrors, browserErrors.join('\n')).toEqual([]);
});
