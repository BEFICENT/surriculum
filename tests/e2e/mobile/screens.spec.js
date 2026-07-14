'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');

const PLAN = {
  major: 'CS',
  entryTerm: 'Fall 2024-2025',
  curriculum: [['MATH101', 'NS101'], ['MATH102']],
  grades: [['A', 'A'], ['A']],
  dates: ['Fall 2024-2025', 'Spring 2024-2025'],
};

test.describe('mobile screens', () => {
  test('planner is a collapsible accordion of semesters', async ({ page }) => {
    await seedPlan(page, PLAN);
    await expect(page.locator('body')).toHaveClass(/is-mobile/);

    // Each semester card gets a chevron affordance, and (with no current term
    // among the seeded ones) exactly one is left expanded, the rest collapsed.
    await expect(page.locator('.m-sem-chevron').first()).toBeVisible();
    const collapsed = page.locator('.container_semester.m-collapsed');
    await expect(collapsed).toHaveCount(1);

    // Tapping the collapsed semester's header expands it.
    await collapsed.locator('.date').click();
    await expect(page.locator('.container_semester.m-collapsed')).toHaveCount(0);
  });

  test('progress screen renders a program card with a completion bar', async ({ page }) => {
    await seedPlan(page, PLAN);

    await page.locator('.m-nav-item[data-mtab="progress"]').click();
    await expect(page.locator('body')).toHaveAttribute('data-mobile-tab', 'progress');

    const card = page.locator('#mProgress .m-prog-card').first();
    await expect(card).toBeVisible({ timeout: 10000 });
    await expect(card.locator('.m-prog-title')).not.toBeEmpty();
    await expect(card.locator('.m-prog-bar')).toBeVisible();
  });
});
