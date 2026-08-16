'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');

const PLAN = {
  major: 'CS',
  entryTerm: 'Fall 2024-2025',
  curriculum: [['IF100']],
  grades: [['']],
  dates: ['Fall 2028-2029'],
  termCodes: ['202801'],
};

const SUMMER_PLAN = {
  major: 'CS',
  entryTerm: 'Fall 2024-2025',
  curriculum: [['IF100']],
  grades: [['']],
  dates: ['Summer 2028-2029'],
  termCodes: ['202803'],
};

async function mockOfferingHistory(page) {
  const body = `${JSON.stringify({
    course_id: 'CS301',
    scrape_ok: true,
    last_offered_terms: [
      { term: 'Spring 2022-2023' },
      { term: 'Spring 2023-2024' },
      { term: 'Spring 2024-2025' },
    ],
  })}\n`;
  await page.addInitScript((jsonl) => {
    window.__courseOfferingsJsonlText = jsonl;
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (resource, options) => {
      const url = typeof resource === 'string'
        ? resource : String(resource && resource.url || '');
      if (url.includes('courses/all_coursepage_info.jsonl')) {
        return Promise.resolve(new Response(jsonl, {
          status: 200,
          headers: { 'Content-Type': 'application/x-ndjson' },
        }));
      }
      return nativeFetch(resource, options);
    };
  }, body);
}

async function openExpandedPicker(page) {
  const semester = page.locator('.container_semester').first();
  await expect(semester).toBeVisible();
  if (await semester.evaluate((element) => element.classList.contains('m-collapsed'))) {
    await semester.locator('.date p').click();
  }
  await expect(semester).not.toHaveClass(/m-collapsed/);
  await semester.locator('.addCourse').click();
  const picker = semester.locator('.input_container');
  await expect(picker).toBeVisible();
  return picker;
}

const semesterFor = (page, term) => page.locator(
  `.container_semester:has(.date p:text-is("${term}"))`,
);

async function openPickerForTerm(page, term) {
  const semester = semesterFor(page, term);
  await expect(semester).toHaveCount(1);
  await expect(semester).toBeVisible();
  if (await semester.evaluate((element) => element.classList.contains('m-collapsed'))) {
    await semester.locator('.date p').click();
  }
  await expect(semester).not.toHaveClass(/m-collapsed/);
  await semester.locator('.addCourse').click();
  const picker = semester.locator('.input_container');
  await expect(picker).toBeVisible();
  await picker.locator('.planner-course-filter-btn').click();
  const menu = picker.locator('.planner-course-filter-menu');
  await expect(menu).toBeVisible();
  return { semester, picker, menu };
}

async function setChecked(locator, checked) {
  if ((await locator.isChecked()) === checked) return;
  const label = locator.locator('xpath=ancestor::label[1]');
  await expect(label).toBeVisible();
  await label.click();
  if (checked) await expect(locator).toBeChecked();
  else await expect(locator).not.toBeChecked();
}

for (const viewport of [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
]) {
  test(`planner filters and history tags stay contained and permit selection at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await mockOfferingHistory(page);
    await seedPlan(page, PLAN);
    await expect(page.locator('body')).toHaveClass(/is-mobile/);

    const picker = await openExpandedPicker(page);
    const filterButton = picker.locator('.planner-course-filter-btn');
    await filterButton.click();
    const menu = picker.locator('.planner-course-filter-menu');
    await expect(menu).toBeVisible();

    const geometry = await menu.evaluate((panel) => {
      const rect = panel.getBoundingClientRect();
      const picker = panel.closest('.input_container');
      const button = picker.querySelector('.planner-course-filter-btn');
      const buttonRect = button.getBoundingClientRect();
      const visibleControls = Array.from(panel.querySelectorAll('button, input, select')).filter((control) => {
        const styles = getComputedStyle(control);
        const box = control.getBoundingClientRect();
        return styles.display !== 'none' && styles.visibility !== 'hidden'
          && box.width > 0 && box.height > 0;
      });
      return {
        panel: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
        filterButton: { width: buttonRect.width, height: buttonRect.height },
        controlsContainedHorizontally: visibleControls.every((control) => {
          const box = control.getBoundingClientRect();
          return box.left >= rect.left - 1 && box.right <= rect.right + 1;
        }),
        documentOverflow:
          document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    expect(geometry.panel.left).toBeGreaterThanOrEqual(-1);
    expect(geometry.panel.right).toBeLessThanOrEqual(viewport.width + 1);
    expect(geometry.panel.top).toBeGreaterThanOrEqual(-1);
    expect(geometry.panel.bottom).toBeLessThanOrEqual(viewport.height + 1);
    expect(geometry.controlsContainedHorizontally).toBe(true);
    expect(geometry.documentOverflow).toBeLessThanOrEqual(1);
    expect(geometry.filterButton.width).toBeGreaterThanOrEqual(40);
    expect(geometry.filterButton.height).toBeGreaterThanOrEqual(36);

    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await picker.locator('.course_select').fill('CS301');
    const option = picker.locator('.course-option[data-code="CS301"]');
    await expect(option).toBeVisible();
    await expect(option).toHaveAttribute('data-offering-pattern', 'no-fall');
    const historyBadge = option.locator('[data-badge-kind="history-season"]');
    await expect(historyBadge).toHaveText('No Fall offerings found');
    const optionGeometry = await option.evaluate((element) => {
      const optionRect = element.getBoundingClientRect();
      const dropdownRect = element.closest('.course-dropdown').getBoundingClientRect();
      const badges = Array.from(element.querySelectorAll('[data-badge-kind^="history-"]'));
      return {
        optionWithinDropdown: optionRect.left >= dropdownRect.left - 1
          && optionRect.right <= dropdownRect.right + 1,
        badgesContained: badges.every((badge) => {
          const box = badge.getBoundingClientRect();
          return box.left >= optionRect.left - 1 && box.right <= optionRect.right + 1;
        }),
        documentOverflow:
          document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    expect(optionGeometry.optionWithinDropdown).toBe(true);
    expect(optionGeometry.badgesContained).toBe(true);
    expect(optionGeometry.documentOverflow).toBeLessThanOrEqual(1);

    await option.click();
    await picker.locator('.enter').click();
    const card = page.locator('.course:has(.course_code:text-is("CS301"))');
    await expect(card).toHaveCount(1);
    await expect(card.locator('[data-offering-advisory="no-fall"]'))
      .toHaveText('No Fall offerings found', { timeout: 15000 });
  });
}

test('offered-only stays picker-local and the mobile Controls toggle is a future-picker default', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedPlan(page, {
    major: 'CS',
    entryTerm: 'Fall 2024-2025',
    curriculum: [[], [], []],
    grades: [[], [], []],
    dates: ['Fall 2026-2027', 'Spring 2026-2027', 'Summer 2026-2027'],
    termCodes: ['202601', '202602', '202603'],
  });
  await expect(page.locator('body')).toHaveClass(/is-mobile/);

  const sidebarOffered = page.locator('#plannerOfferedOnlyToggle');
  await page.locator('.m-nav-item[data-mtab="controls"]').click();
  await expect(page.locator('body')).toHaveAttribute('data-mobile-tab', 'controls');
  await setChecked(sidebarOffered, true);
  await page.locator('.m-nav-item[data-mtab="planner"]').click();

  const fall = await openPickerForTerm(page, 'Fall 2026-2027');
  const spring = await openPickerForTerm(page, 'Spring 2026-2027');
  const fallOffered = fall.menu.locator('.planner-filter-offered');
  const springOffered = spring.menu.locator('.planner-filter-offered');
  await expect(fallOffered).toBeChecked();
  await expect(springOffered).toBeChecked();

  // Opening Spring closes Fall's menu. Re-expand Fall and reopen its filter
  // sheet so this follows the same visible mobile interaction as a user.
  await page.keyboard.press('Escape');
  await expect(spring.menu).toBeHidden();
  if (await fall.semester.evaluate((element) => element.classList.contains('m-collapsed'))) {
    await fall.semester.locator('.date p').click();
  }
  if (!(await fall.menu.isVisible())) {
    await fall.picker.locator('.planner-course-filter-btn').click();
    await expect(fall.menu).toBeVisible();
  }
  await setChecked(fallOffered, false);
  await expect(sidebarOffered).toBeChecked();
  await expect(springOffered).toBeChecked();
  await expect.poll(() => page.evaluate(
    () => window.preferenceStorage.getItem('plannerFilterOfferedOnly'),
  )).toBe('true');

  // Controls changes save a new default but leave both open picker instances
  // untouched, including Spring's inherited value.
  await page.locator('.m-nav-item[data-mtab="controls"]').click();
  await expect(page.locator('body')).toHaveAttribute('data-mobile-tab', 'controls');
  await setChecked(sidebarOffered, false);
  await expect(fallOffered).not.toBeChecked();
  await expect(springOffered).toBeChecked();
  await expect.poll(() => page.evaluate(
    () => window.preferenceStorage.getItem('plannerFilterOfferedOnly'),
  )).toBe('false');

  await page.locator('.m-nav-item[data-mtab="planner"]').click();
  const summer = await openPickerForTerm(page, 'Summer 2026-2027');
  await expect(summer.menu.locator('.planner-filter-offered')).not.toBeChecked();
});

test('Summer history badge and planned-card tag stay contained on a narrow phone', async ({ page }) => {
  const viewport = { width: 320, height: 568 };
  await page.setViewportSize(viewport);
  await mockOfferingHistory(page);
  await seedPlan(page, SUMMER_PLAN);
  await expect(page.locator('body')).toHaveClass(/is-mobile/);
  await page.evaluate(() => {
    window.preferenceStorage.setItem('plannerFilterCheckPrerequisites', 'false');
  });

  const picker = await openExpandedPicker(page);
  const filterButton = picker.locator('.planner-course-filter-btn');
  await filterButton.click();
  const menu = picker.locator('.planner-course-filter-menu');
  await expect(menu.locator('.planner-filter-prerequisites')).not.toBeChecked();
  await page.keyboard.press('Escape');

  await picker.locator('.course_select').fill('CS301');
  const option = picker.locator('.course-option[data-code="CS301"]');
  await expect(option).toBeVisible();
  await expect(option).toHaveAttribute('data-offering-pattern', 'no-summer');
  const historyBadge = option.locator('[data-badge-kind="history-season"]');
  await expect(historyBadge).toHaveText('No Summer offerings found');

  const geometry = await option.evaluate((element) => {
    const optionRect = element.getBoundingClientRect();
    const dropdownRect = element.closest('.course-dropdown').getBoundingClientRect();
    const badgeRect = element.querySelector('[data-badge-kind="history-season"]')
      .getBoundingClientRect();
    return {
      optionWithinDropdown: optionRect.left >= dropdownRect.left - 1
        && optionRect.right <= dropdownRect.right + 1,
      badgeWithinOption: badgeRect.left >= optionRect.left - 1
        && badgeRect.right <= optionRect.right + 1,
      documentOverflow:
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
  expect(geometry.optionWithinDropdown).toBe(true);
  expect(geometry.badgeWithinOption).toBe(true);
  expect(geometry.documentOverflow).toBeLessThanOrEqual(1);

  await option.click();
  await picker.locator('.enter').click();
  const card = page.locator('.course:has(.course_code:text-is("CS301"))');
  await expect(card).toHaveCount(1);
  await expect(card.locator('[data-offering-advisory="no-summer"]'))
    .toHaveText('No Summer offerings found', { timeout: 15000 });
});
