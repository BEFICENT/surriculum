'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');

const EMPTY_PLAN = {
  major: 'CS',
  entryTerm: 'Fall 2024-2025',
  curriculum: [[]],
  grades: [[]],
  dates: ['Fall 2028-2029'],
  termCodes: ['202801'],
};

const DENSE_PLAN = {
  major: 'CS',
  entryTerm: 'Fall 2024-2025',
  curriculum: [['IF100', 'MATH101', 'MATH102', 'CS201', 'CS204', 'CS301']],
  grades: [['', '', '', '', '', '']],
  dates: ['Fall 2028-2029'],
  termCodes: ['202801'],
};

async function settleGeometry(page) {
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
}

async function expandSemester(semester) {
  if (await semester.evaluate((element) => element.classList.contains('m-collapsed'))) {
    await semester.locator('.date p').click();
  }
  await expect(semester).not.toHaveClass(/m-collapsed/);
}

async function openPicker(page, { scrollAddButton = false } = {}) {
  const semester = page.locator('.container_semester').first();
  await expect(semester).toBeVisible({ timeout: 15000 });
  await expandSemester(semester);
  const addButton = semester.locator('.addCourse');
  if (scrollAddButton) await addButton.scrollIntoViewIfNeeded();
  await addButton.click();
  const picker = semester.locator('.input_container');
  await expect(picker).toBeVisible();
  await expect(picker.locator('.course-dropdown .course-option').first()).toBeVisible();
  await settleGeometry(page);
  return picker;
}

async function readGeometry(picker) {
  return picker.locator('.course-dropdown').evaluate((dropdown) => {
    const rect = (element) => {
      const box = element.getBoundingClientRect();
      return {
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        width: box.width,
        height: box.height,
      };
    };
    const row = dropdown.closest('.input-wrapper').querySelector('.planner-course-search-row');
    const board = dropdown.closest('.container_semester').closest('.board');
    const dropdownBox = rect(dropdown);
    const rowBox = rect(row);
    const boardBox = rect(board);
    const firstOption = dropdown.querySelector('.course-option[data-code]');
    const firstOptionBox = firstOption ? rect(firstOption) : null;
    const visualTop = window.visualViewport ? window.visualViewport.offsetTop : 0;
    const visualBottom = window.visualViewport
      ? visualTop + window.visualViewport.height : window.innerHeight;
    const placement = dropdown.dataset.placement || '';
    return {
      dropdown: dropdownBox,
      row: rowBox,
      board: boardBox,
      placement,
      gap: placement === 'below'
        ? dropdownBox.top - rowBox.bottom
        : rowBox.top - dropdownBox.bottom,
      safeTop: Math.max(boardBox.top + 8, visualTop + 8),
      safeBottom: Math.min(boardBox.bottom - 8, visualBottom - 8),
      inlineMaxHeight: Number.parseFloat(dropdown.style.maxHeight || '0'),
      clientHeight: dropdown.clientHeight,
      listScrolls: dropdown.scrollHeight > dropdown.clientHeight + 1,
      firstCompleteOptionContained: !!firstOptionBox
        && firstOptionBox.left >= dropdownBox.left - 1
        && firstOptionBox.right <= dropdownBox.right + 1
        && firstOptionBox.top >= dropdownBox.top - 1
        && firstOptionBox.bottom <= dropdownBox.bottom + 1,
      documentHorizontalOverflow:
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
      documentVerticalOverflow:
        document.documentElement.scrollHeight - document.documentElement.clientHeight,
    };
  });
}

function expectContained(geometry, label) {
  expect(geometry.dropdown.left, `${label}: left edge`).toBeGreaterThanOrEqual(7);
  expect(geometry.dropdown.right, `${label}: right edge`)
    .toBeLessThanOrEqual(geometry.board.right + 1);
  expect(geometry.dropdown.top, `${label}: safe top`)
    .toBeGreaterThanOrEqual(geometry.safeTop - 1);
  expect(geometry.dropdown.bottom, `${label}: safe bottom`)
    .toBeLessThanOrEqual(geometry.safeBottom + 1);
  expect(geometry.gap, `${label}: anchor gap`).toBeGreaterThanOrEqual(4);
  expect(geometry.gap, `${label}: anchor gap`).toBeLessThanOrEqual(8);
  expect(geometry.documentHorizontalOverflow, `${label}: document horizontal overflow`)
    .toBeLessThanOrEqual(1);
  expect(geometry.documentVerticalOverflow, `${label}: document vertical overflow`)
    .toBeLessThanOrEqual(1);
}

test.describe('planner course picker geometry (mobile)', () => {
  test('opens below a naturally high empty-semester picker', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 390, height: 844 });
    await seedPlan(page, EMPTY_PLAN);
    await expect(page.locator('body')).toHaveClass(/is-mobile/);

    const picker = await openPicker(page);
    const geometry = await readGeometry(picker);
    expect(geometry.placement).toBe('below');
    expectContained(geometry, 'empty semester');
    expect(geometry.dropdown.height, 'fallback provides a usable rendered list height')
      .toBeGreaterThanOrEqual(160);
    expect(geometry.clientHeight, 'fallback provides at least 160px of list content area')
      .toBeGreaterThanOrEqual(160);
    expect(geometry.firstCompleteOptionContained, 'the first result is completely visible')
      .toBe(true);
    expect(geometry.listScrolls, 'the catalog scrolls inside the contained dropdown').toBe(true);
  });

  test('opens above a naturally low dense-semester picker', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 320, height: 568 });
    await seedPlan(page, DENSE_PLAN);
    await expect(page.locator('body')).toHaveClass(/is-mobile/);

    const picker = await openPicker(page, { scrollAddButton: true });
    const geometry = await readGeometry(picker);
    expect(geometry.placement).toBe('above');
    expectContained(geometry, 'dense semester');
    expect(geometry.listScrolls, 'the catalog scrolls inside the contained dropdown').toBe(true);
  });
});
