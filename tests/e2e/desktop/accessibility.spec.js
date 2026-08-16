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
      'Show course details',
      'Hide courses planned by this term',
      'Only show courses offered in the semester',
      'Smart Sort',
    ]) {
      expect(await page.getByRole('checkbox', { name }).count(), `${name} should name its toggle`).toBeGreaterThan(0);
    }
    await expect(page.getByRole('region', { name: 'Course picker defaults' }))
      .toHaveAccessibleDescription(
        'Applied when a course picker opens. Offered-only changes stay local to that picker.',
      );

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

  test('plan and transcript popovers close with Escape and restore their toggles', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => !!window.planStorage);

    const planToggle = page.getByRole('button', { name: /Default Plan/ });
    await planToggle.click();
    await expect(page.locator('#planDropdown')).toHaveClass(/active/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#planDropdown')).not.toHaveClass(/active/);
    await expect(planToggle).toBeFocused();

    const importToggle = page.getByRole('button', { name: 'Import Records' });
    await importToggle.click();
    await expect(page.locator('#importDropdown')).toHaveClass(/active/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#importDropdown')).not.toHaveClass(/active/);
    await expect(importToggle).toBeFocused();
  });

  test('the custom-course dialog is named, labels every field, traps focus, and restores its opener', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => typeof course_data !== 'undefined'
      && Array.isArray(course_data) && course_data.length > 0);

    const opener = page.getByRole('button', { name: /Add Custom Course/i });
    await opener.click();
    const dialog = page.getByRole('dialog', { name: 'Add Custom Course' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');

    const code = dialog.getByRole('textbox', { name: 'Course Code:' });
    await expect(code).toBeFocused();
    await expect(dialog.getByRole('textbox', { name: 'Course Name:' })).toBeVisible();
    for (const name of [
      'SU Credits:', 'ECTS:', 'Basic Science credits:', 'Engineering credits:',
    ]) {
      await expect(dialog.getByRole('spinbutton', { name })).toBeVisible();
    }
    await expect(dialog.getByRole('combobox', { name: 'Faculty (optional):' })).toBeVisible();

    const save = dialog.getByRole('button', { name: 'Save', exact: true });
    await save.focus();
    await page.keyboard.press('Tab');
    await expect(code).toBeFocused();

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

    const move = page.getByRole('button', { name: 'Move Fall 2025-2026 left' });
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
      'Moved Fall 2025-2026 left to position 2 of 3.'
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

  test('course actions are course-specific and grades are fully keyboard operable', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [['MATH101']],
      grades: [['']],
      dates: ['Fall 2024-2025'],
    });

    await expect(page.getByRole('button', { name: 'Details for MATH101' })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Delete MATH101' })).toHaveCount(1);

    const grade = page.getByRole('button', { name: /^Grade for MATH101:/ });
    await expect(grade).toHaveAttribute('aria-label', 'Grade for MATH101: not entered');
    await expect(grade).toHaveAttribute('aria-expanded', 'false');
    await grade.focus();
    await page.keyboard.press('Enter');

    const listbox = page.getByRole('listbox', { name: 'Select grade for MATH101' });
    await expect(listbox).toBeVisible();
    await expect(listbox).toBeFocused();
    await expect(grade).toHaveAttribute('aria-expanded', 'true');

    await page.keyboard.press('End');
    await expect(listbox.locator('.grade-option[data-value="W"]'))
      .toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Home');
    await page.keyboard.press('ArrowDown');
    await expect(listbox.getByRole('option', { name: 'A', exact: true }))
      .toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Enter');

    await expect(grade).toHaveText('A');
    await expect(grade).toHaveAttribute('aria-label', 'Grade for MATH101: A');
    await expect(grade).toHaveAttribute('aria-expanded', 'false');
    await expect(grade).toBeFocused();
    await expect.poll(() => page.evaluate(() => window.curriculum.semesters[0].courses[0].grade))
      .toBe('A');

    await grade.press('Enter');
    await expect(listbox).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(listbox).toHaveCount(0);
    await expect(grade).toBeFocused();
    await expect(grade).toHaveText('A');
  });

  test('reduced-motion preference suppresses planner transitions and contrast tokens pass AA', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');

    const sidebarTransition = await page.locator('.sidebar').evaluate(
      (element) => getComputedStyle(element).transitionDuration,
    );
    expect(parseFloat(sidebarTransition)).toBeLessThanOrEqual(0.001);

    for (const theme of ['light', 'dark']) {
      await page.evaluate((name) => {
        document.documentElement.dataset.theme = name;
      }, theme);
      await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      }));

      const values = await page.evaluate(() => {
        const resolveToken = (token) => {
          const probe = document.createElement('span');
          probe.style.cssText = `position:fixed;left:-10000px;top:0;color:var(${token}) !important;`;
          document.body.appendChild(probe);
          const channels = getComputedStyle(probe).color.match(/[\d.]+/g).slice(0, 3).map(Number);
          probe.remove();
          return channels;
        };
        const luminance = (channels) => {
          const linear = channels.map((channel) => {
            const normalized = channel / 255;
            return normalized <= 0.03928
              ? normalized / 12.92
              : ((normalized + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
        };
        const contrast = (first, second) => {
          const a = luminance(resolveToken(first));
          const b = luminance(resolveToken(second));
          return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        };
        const result = {
          secondary: contrast('--text-secondary', '--bg-card'),
          muted: contrast('--text-muted', '--bg-card'),
          accent: contrast('--accent', '--text-inverse'),
        };
        return result;
      });

      expect(values.secondary, `${theme} secondary text contrast`).toBeGreaterThanOrEqual(4.5);
      expect(values.muted, `${theme} muted text contrast`).toBeGreaterThanOrEqual(4.5);
      expect(values.accent, `${theme} accent contrast`).toBeGreaterThanOrEqual(4.5);
    }
  });
});
