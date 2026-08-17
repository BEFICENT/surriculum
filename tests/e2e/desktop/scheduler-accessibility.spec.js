'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');

const seedScheduler = async (page) => {
  await seedPlan(page, {
    major: 'CS',
    entryTerm: 'Fall 2024-2025',
    curriculum: [],
    grades: [],
    dates: [],
    schedulerSelectedTerm: '202401',
  });
  await page.waitForFunction(() => typeof window.openSchedulerModal === 'function');
};

test.describe('scheduler accessibility', () => {
  test('main and nested dialogs manage names, focus, Escape, and labelled controls', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 720 });
    await seedScheduler(page);

    const opener = page.locator('#openSchedulerButton');
    await opener.click();

    const dialog = page.getByRole('dialog', { name: /Scheduler —/ });
    await expect(dialog).toBeVisible({ timeout: 15000 });
    await expect(dialog.getByRole('textbox', { name: 'Search courses' })).toBeFocused();
    await expect(dialog.getByRole('combobox', { name: 'Schedule term' })).toBeVisible();

    const filters = dialog.getByRole('button', { name: 'Filters' });
    await expect(filters).toHaveAttribute('aria-expanded', 'false');
    await filters.click();
    await expect(filters).toHaveAttribute('aria-expanded', 'true');

    for (const name of [
      'Hide courses planned before the selected term',
      'Show course details',
      'Smart Sort',
      'Hover preview',
      'Highlight course availability',
      'Show blocked courses',
      'Check prerequisites',
      'Show unmet prerequisites',
    ]) {
      await expect(dialog.getByRole('checkbox', { name })).toHaveCount(1);
    }
    for (const name of ['Min SU credits', 'Min ECTS', 'Min Basic Science', 'Min Engineering']) {
      await expect(dialog.getByRole('spinbutton', { name })).toHaveCount(1);
    }
    for (const name of ['Min Major type', 'Min Double Major type', 'Min Minor type']) {
      await expect(dialog.getByRole('combobox', { name })).toHaveCount(1);
    }

    await page.keyboard.press('Escape');
    await expect(filters).toHaveAttribute('aria-expanded', 'false');
    await expect(dialog).toBeVisible();
    await expect(filters).toBeFocused();

    const disclosures = dialog.locator('.scheduler-collapsible-header');
    await expect(disclosures).toHaveCount(3);
    for (const disclosure of await disclosures.all()) {
      await expect(disclosure).toHaveAttribute('aria-expanded', /true|false/);
      const controlledId = await disclosure.getAttribute('aria-controls');
      expect(controlledId).toBeTruthy();
      await expect(dialog.locator(`#${controlledId}`)).toHaveCount(1);
    }
    const firstDisclosure = disclosures.first();
    await firstDisclosure.click();
    await expect(firstDisclosure).toHaveAttribute('aria-expanded', 'false');
    await expect(dialog.locator(`#${await firstDisclosure.getAttribute('aria-controls')}`)).toBeHidden();

    const more = dialog.getByRole('button', { name: 'More', exact: true });
    await more.click();
    const actions = page.getByRole('dialog', { name: 'Scheduler actions' });
    await expect(actions).toBeVisible();
    const firstAction = actions.getByRole('button', { name: 'Copy CRNs' });
    await expect(firstAction).toBeFocused();

    const actionButtons = actions.getByRole('button');
    const lastAction = actionButtons.last();
    await lastAction.focus();
    await page.keyboard.press('Tab');
    await expect(actions.getByRole('button', { name: 'Close Scheduler actions' })).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(actions).toHaveCount(0);
    await expect(dialog, 'Escape closes only the topmost Scheduler dialog').toBeVisible();
    await expect(more).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
  });

  test('course actions include their course and mobile day tabs expose selection state', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await seedScheduler(page);
    await page.evaluate(() => window.openSchedulerModal());

    const modal = page.locator('.scheduler-modal.m-scheduler');
    await expect(modal).toBeVisible({ timeout: 15000 });
    const tablist = modal.getByRole('tablist', { name: 'Schedule days' });
    await expect(tablist).toBeVisible();
    const tabs = tablist.getByRole('tab');
    await expect(tabs).toHaveCount(5);

    const selected = tablist.locator('[role="tab"][aria-selected="true"]');
    await expect(selected).toHaveCount(1);
    await expect(selected).toHaveAttribute('tabindex', '0');
    const selectedDay = await selected.getAttribute('data-day');
    const selectedIndex = ['M', 'T', 'W', 'R', 'F'].indexOf(selectedDay);
    expect(selectedIndex).toBeGreaterThanOrEqual(0);

    await selected.focus();
    await page.keyboard.press('ArrowRight');
    const nextDay = ['M', 'T', 'W', 'R', 'F'][(selectedIndex + 1) % 5];
    const nextTab = tablist.locator(`[role="tab"][data-day="${nextDay}"]`);
    await expect(nextTab).toHaveAttribute('aria-selected', 'true');
    await expect(nextTab).toBeFocused();
    await expect(tablist.locator('[role="tab"][aria-selected="true"]')).toHaveCount(1);

    await modal.locator('.m-sched-fab').click();
    const search = modal.getByRole('textbox', { name: 'Search courses' });
    await search.fill('CS201');
    const courseActions = modal.locator('.scheduler-course[data-course="CS201"] > .scheduler-course-actions').first();
    await expect(courseActions.getByRole('button', { name: 'Details for CS201' })).toHaveCount(1);
    await expect(courseActions.getByRole('button', { name: 'Pick section for CS201' })).toHaveCount(1);
  });
});
