'use strict';

const { test, expect } = require('../fixtures');

test.describe('app shell (desktop)', () => {
  test('loads with v3.1 branding, core controls, and no browser errors', async ({ page, browserErrors }) => {
    await page.goto('/');

    await expect(page).toHaveTitle('SUrriculum v3.1');
    await expect(page.locator('.header-title')).toContainText('SUrriculum v3.1');

    // The program controls are the entry point for everything else.
    await expect(page.locator('select.change_major')).toBeVisible();
    await expect(page.locator('select.entryTerm')).toBeVisible();

    // Desktop must NOT activate the mobile layer.
    await expect(page.locator('body')).not.toHaveClass(/is-mobile/);

    expect(browserErrors, browserErrors.join('\n')).toEqual([]);
  });
});
