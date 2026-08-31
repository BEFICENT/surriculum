'use strict';

const { test, expect } = require('../fixtures');

test.describe('scheduler controller seams', () => {
  test('schedule management and term switching remain wired after extraction', async ({ page, browserErrors }) => {
    await page.goto('/');
    await page.waitForFunction(() => typeof window.openSchedulerModal === 'function');
    await page.evaluate(() => { window.openSchedulerModal('202403'); });

    let modal = page.locator('.scheduler-modal');
    await expect(modal).toBeVisible({ timeout: 15000 });
    await expect(modal.locator('.scheduler-schedule-name')).toHaveText('Default schedule');
    await modal.locator('.scheduler-schedule-toggle').click();

    let picker = page.locator('.scheduler-picker-modal').filter({ hasText: 'Schedules' });
    await expect(picker).toBeVisible();
    await expect(picker.locator('.scheduler-picker-option').filter({ hasText: 'Default schedule' }))
      .toContainText('Active');
    await picker.getByRole('button', { name: 'New', exact: true }).click();

    await expect(modal.locator('.scheduler-schedule-name')).toHaveText('New schedule');
    picker = page.locator('.scheduler-picker-modal').filter({ hasText: 'Schedules' });
    await expect(picker).toBeVisible();
    await picker.locator('.scheduler-picker-option').filter({ hasText: 'Default schedule' }).click();
    await expect(modal.locator('.scheduler-schedule-name')).toHaveText('Default schedule');

    picker = page.locator('.scheduler-picker-modal').filter({ hasText: 'Schedules' });
    await expect(picker).toBeVisible();
    await picker.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.locator('.scheduler-picker-modal')).toHaveCount(0);

    await modal.locator('.scheduler-term-select').selectOption('202501');
    modal = page.locator('.scheduler-modal');
    await expect(modal).toHaveCount(1);
    await expect(modal.locator('.scheduler-term-select')).toHaveValue('202501');
    await expect(modal.locator('.scheduler-course').first()).toBeVisible({ timeout: 15000 });

    expect(browserErrors, browserErrors.join('\n')).toEqual([]);
  });
});
