'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');

const PLAN = {
  major: 'CS',
  entryTerm: 'Fall 2024-2025',
  curriculum: [['CS201'], ['CS204']],
  grades: [['A'], ['A']],
  dates: ['Fall 2024-2025', 'Spring 2024-2025'],
};

test.describe('responsive semester accordion affordance', () => {
  test('chevrons stay hidden on desktop across a live mobile round trip', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 700 });
    await seedPlan(page, PLAN);

    const body = page.locator('body');
    const semesters = page.locator('.container_semester');
    const chevrons = page.locator('.m-sem-chevron');
    const firstHeader = semesters.first().locator('.date');

    // The mobile adapter injects the affordance ahead of time so crossing the
    // breakpoint does not need to rebuild semester cards. Font Awesome must not
    // make those dormant icons visible in desktop mode.
    await expect(body).not.toHaveClass(/is-mobile/);
    await expect(chevrons).toHaveCount(2);
    await expect(chevrons.first()).toBeHidden();
    await expect(chevrons.first()).toHaveCSS('display', 'none');

    const collapsedBeforeDesktopClick = await semesters.first().evaluate(
      (semester) => semester.classList.contains('m-collapsed'),
    );
    await firstHeader.click();
    await expect(semesters.first()).toHaveClass(
      collapsedBeforeDesktopClick ? /m-collapsed/ : /^(?!.*m-collapsed).*$/,
    );

    await page.setViewportSize({ width: 800, height: 700 });
    await expect(body).toHaveClass(/is-mobile/);
    await expect(chevrons.first()).toBeVisible();

    await page.setViewportSize({ width: 900, height: 700 });
    await expect(body).not.toHaveClass(/is-mobile/);
    await expect(chevrons).toHaveCount(2);
    await expect(chevrons.first()).toBeHidden();
    await expect(chevrons.first()).toHaveCSS('display', 'none');
  });
});
