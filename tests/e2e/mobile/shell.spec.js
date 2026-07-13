'use strict';

const { test, expect } = require('../fixtures');

test.describe('mobile shell', () => {
  test('activates the is-mobile layer with a 4-item bottom nav', async ({ page }) => {
    await page.goto('/');

    // The mobile layer is additive and gated on body.is-mobile (<= 820px).
    await expect(page.locator('body')).toHaveClass(/is-mobile/);

    const nav = page.locator('#mNav');
    await expect(nav).toBeVisible();
    await expect(nav.locator('.m-nav-item')).toHaveCount(4);

    // Default screen is the planner.
    await expect(page.locator('body')).toHaveAttribute('data-mobile-tab', 'planner');
  });

  test('bottom-nav tabs switch the active screen', async ({ page }) => {
    await page.goto('/');
    await page.locator('.m-nav-item[data-mtab="controls"]').click();
    await expect(page.locator('body')).toHaveAttribute('data-mobile-tab', 'controls');
    await page.locator('.m-nav-item[data-mtab="planner"]').click();
    await expect(page.locator('body')).toHaveAttribute('data-mobile-tab', 'planner');
  });
});
