'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');

test.describe('planner accessibility', () => {
  test('static selectors, toggles, and disclosure controls have accurate names and state', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => !!window.planStorage);

    for (const name of [
      'Major program',
      'Major admit term',
      'Double-major program',
      'Double-major admit term',
      'Academic records file',
    ]) {
      expect(await page.getByLabel(name).count(), `${name} should label at least one control`).toBeGreaterThan(0);
    }
    for (const name of [
      'Show Course Details',
      'Hide Taken Courses',
      'Smart Sort',
    ]) {
      expect(await page.getByRole('checkbox', { name }).count(), `${name} should name its toggle`).toBeGreaterThan(0);
    }
    expect(await page.getByRole('checkbox', { name: /Only show offered courses/ }).count())
      .toBeGreaterThan(0);

    const sidebarToggle = page.getByRole('button', { name: 'Collapse planner controls' });
    await expect(sidebarToggle).toHaveAttribute('aria-expanded', 'true');
    await sidebarToggle.click();
    const expandSidebar = page.getByRole('button', { name: 'Expand planner controls' });
    await expect(expandSidebar).toHaveAttribute('aria-expanded', 'false');

    const importToggle = page.getByRole('button', { name: 'Import Records' });
    await expect(importToggle).toHaveAttribute('aria-expanded', 'false');
    await importToggle.click();
    await expect(importToggle).toHaveAttribute('aria-expanded', 'true');
  });

  test('shared modal traps focus, closes with Escape, and restores the opener', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Default Plan/ }).click();
    const opener = page.getByRole('button', { name: 'New plan' });
    await opener.click();

    const dialog = page.getByRole('dialog', { name: 'New plan' });
    await expect(dialog).toBeVisible();
    const input = dialog.getByRole('textbox', { name: 'New plan' });
    await expect(input).toBeFocused();

    const close = dialog.getByRole('button', { name: 'Close New plan' });
    const continueButton = dialog.getByRole('button', { name: 'Continue' });
    await continueButton.focus();
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(continueButton).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();
  });

  test('plans can be reordered one step with buttons and a live announcement', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => !!window.planStorage);
    await page.evaluate(() => {
      window.planStorage.createPlan('Second Plan');
      window.planStorage.createPlan('Third Plan');
    });
    await page.reload();
    await page.getByRole('button', { name: /Default Plan/ }).click();

    const move = page.getByRole('button', { name: 'Move Third Plan up' });
    await move.click();
    await expect(move).toBeFocused();
    await expect(page.locator('.plan-select')).toHaveText([
      'Default Plan',
      'Third Plan',
      'Second Plan',
    ]);
    await expect(page.locator('#a11yStatus')).toHaveText(
      'Moved Third Plan up to position 2 of 3.'
    );
    expect(await page.evaluate(() => window.planStorage.getPlans().map((plan) => plan.name))).toEqual([
      'Default Plan',
      'Third Plan',
      'Second Plan',
    ]);
  });

  test('semesters can be reordered one step while the DOM and model stay aligned', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [['CS201'], ['CS204'], ['CS300']],
      grades: [['A'], ['A'], ['A']],
      dates: ['Fall 2024-2025', 'Spring 2024-2025', 'Fall 2025-2026'],
    });

    const move = page.getByRole('button', { name: 'Move Fall 2025-2026 up' });
    await move.click();
    await expect(move).toBeFocused();
    await expect(page.locator('.container_semester .date p')).toHaveText([
      'Fall 2024-2025',
      'Fall 2025-2026',
      'Spring 2024-2025',
    ]);
    expect(await page.evaluate(() => window.curriculum.semesters.map(
      (semester) => semester.courses.map((course) => course.code)
    ))).toEqual([['CS201'], ['CS300'], ['CS204']]);
    await expect(page.locator('#a11yStatus')).toHaveText(
      'Moved Fall 2025-2026 up to position 2 of 3.'
    );
  });

  test('semester term editing keeps the select and group named', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [['CS201']],
      grades: [['A']],
      dates: ['Fall 2024-2025'],
    });

    const semester = page.locator('.container_semester').first();
    await page.getByRole('button', { name: 'Edit Fall 2024-2025 term' }).click();
    await expect(page.getByRole('combobox', {
      name: 'Semester term for Fall 2024-2025',
    })).toBeVisible();
    await expect(semester).not.toHaveAttribute('aria-labelledby', /.+/);
    await expect(semester).toHaveAttribute('aria-label', 'Editing semester');

    await page.getByRole('button', { name: 'Save semester term' }).click();
    await expect(semester).toHaveAttribute('aria-labelledby', /semester-label-/);
    await expect(semester).not.toHaveAttribute('aria-label', /.+/);
  });

  test('reduced-motion preference suppresses planner transitions and contrast tokens pass AA', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');

    const values = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const rgb = (value) => {
        const hex = value.trim().replace('#', '');
        return [0, 2, 4].map((offset) => parseInt(hex.slice(offset, offset + 2), 16));
      };
      const luminance = (value) => {
        const channels = rgb(value).map((channel) => {
          const normalized = channel / 255;
          return normalized <= 0.03928
            ? normalized / 12.92
            : ((normalized + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
      };
      const contrast = (first, second) => {
        const a = luminance(first);
        const b = luminance(second);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      };
      return {
        sidebarTransition: getComputedStyle(document.querySelector('.sidebar')).transitionDuration,
        secondary: contrast(
          root.getPropertyValue('--text-secondary'),
          root.getPropertyValue('--bg-card')
        ),
        muted: contrast(
          root.getPropertyValue('--text-muted'),
          root.getPropertyValue('--bg-card')
        ),
        accent: contrast(
          root.getPropertyValue('--accent'),
          root.getPropertyValue('--text-inverse')
        ),
      };
    });

    expect(parseFloat(values.sidebarTransition)).toBeLessThanOrEqual(0.001);
    expect(values.secondary).toBeGreaterThanOrEqual(4.5);
    expect(values.muted).toBeGreaterThanOrEqual(4.5);
    expect(values.accent).toBeGreaterThanOrEqual(4.5);
  });
});
