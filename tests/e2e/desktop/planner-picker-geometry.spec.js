'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');

const singleSemesterPlan = {
  major: 'CS',
  entryTerm: 'Fall 2024-2025',
  curriculum: [['IF100']],
  grades: [['A']],
  dates: ['Fall 2024-2025'],
  termCodes: ['202401'],
};

const horizontalPlan = {
  major: 'CS',
  entryTerm: 'Fall 2024-2025',
  curriculum: [['IF100'], ['MATH101'], ['CS201'], ['CS301'], ['CS401']],
  grades: [['A'], ['A'], ['A'], [''], ['']],
  dates: [
    'Fall 2024-2025',
    'Spring 2024-2025',
    'Fall 2025-2026',
    'Spring 2025-2026',
    'Fall 2026-2027',
  ],
  termCodes: ['202401', '202402', '202501', '202502', '202601'],
};

const semesterFor = (page, term) => page.locator(
  `.container_semester:has(.date p:text-is("${term}"))`,
);

async function settleGeometry(page, picker) {
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
  if (!picker) return;

  // Chromium can dispatch the viewport resize before flex layout has moved
  // the semester row. The picker intentionally follows that later layout via
  // ResizeObserver, so wait for the user-visible invariant instead of assuming
  // a fixed number of animation frames covers both delivery phases.
  await expect.poll(async () => {
    const geometry = await pickerGeometry(picker);
    return geometry.dropdown.top >= geometry.safeTop - 1
      && geometry.dropdown.bottom <= geometry.safeBottom + 1
      && geometry.anchorGap >= 4
      && geometry.anchorGap <= 8;
  }, {
    message: 'course picker should settle against its search row inside the visible board',
    timeout: 2000,
    intervals: [16, 32, 50],
  }).toBe(true);
}

async function openPicker(page, term) {
  const semester = semesterFor(page, term);
  await expect(semester).toHaveCount(1);
  await semester.scrollIntoViewIfNeeded();
  await semester.locator('.addCourse').click();
  const picker = semester.locator('.input_container');
  await expect(picker).toBeVisible();
  await expect(picker.locator('.course_select')).toBeFocused();
  await expect(picker.locator('.course-dropdown .course-option').first()).toBeVisible();
  await settleGeometry(page, picker);
  return picker;
}

async function pickerGeometry(picker) {
  return picker.locator('.course-dropdown').evaluate((dropdown) => {
    const box = (element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    };
    const row = dropdown.closest('.input-wrapper').querySelector('.planner-course-search-row');
    const semester = dropdown.closest('.container_semester');
    const board = semester.closest('.board');
    const dropdownBox = box(dropdown);
    const rowBox = box(row);
    const semesterBox = box(semester);
    const boardBox = box(board);
    const visualTop = window.visualViewport ? window.visualViewport.offsetTop : 0;
    const visualBottom = window.visualViewport
      ? visualTop + window.visualViewport.height : window.innerHeight;
    return {
      dropdown: dropdownBox,
      row: rowBox,
      semester: semesterBox,
      board: boardBox,
      placement: dropdown.dataset.placement || '',
      inlineMaxHeight: Number.parseFloat(dropdown.style.maxHeight || '0'),
      computedMaxHeight: Number.parseFloat(getComputedStyle(dropdown).maxHeight || '0'),
      availableAbove: Math.max(0, rowBox.top - 6),
      anchorGap: rowBox.top - dropdownBox.bottom,
      safeTop: Math.max(boardBox.top + 8, visualTop + 8),
      safeBottom: Math.min(boardBox.bottom - 8, visualBottom - 8),
      visualViewport: {
        offsetTop: visualTop,
        width: window.visualViewport ? window.visualViewport.width : window.innerWidth,
        height: window.visualViewport ? window.visualViewport.height : window.innerHeight,
        scale: window.visualViewport ? window.visualViewport.scale : 1,
      },
      listScrolls: dropdown.scrollHeight > dropdown.clientHeight + 1,
      viewport: { width: window.innerWidth, height: window.innerHeight },
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
    .toBeLessThanOrEqual(geometry.viewport.width - 7);
  expect(geometry.dropdown.top, `${label}: board/visual-viewport top edge`)
    .toBeGreaterThanOrEqual(geometry.safeTop - 1);
  expect(geometry.dropdown.bottom, `${label}: board/visual-viewport bottom edge`)
    .toBeLessThanOrEqual(geometry.safeBottom + 1);
  expect(geometry.anchorGap, `${label}: list/search gap`).toBeGreaterThanOrEqual(4);
  expect(geometry.anchorGap, `${label}: list/search gap`).toBeLessThanOrEqual(8);
  expect(Math.abs(geometry.dropdown.width - geometry.row.width), `${label}: anchor width`)
    .toBeLessThanOrEqual(2);
  expect(geometry.inlineMaxHeight, `${label}: available space ceiling`)
    .toBeLessThanOrEqual(geometry.availableAbove + 1);
  expect(geometry.computedMaxHeight, `${label}: applied max-height`)
    .toBeCloseTo(geometry.inlineMaxHeight, 0);
  expect(geometry.documentHorizontalOverflow, `${label}: document horizontal overflow`)
    .toBeLessThanOrEqual(1);
  expect(geometry.documentVerticalOverflow, `${label}: document vertical overflow`)
    .toBeLessThanOrEqual(1);
}

test.describe('planner course picker geometry (desktop)', () => {
  test('uses a tall semester card\'s available space and contracts on a short viewport', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1280, height: 1000 });
    await seedPlan(page, singleSemesterPlan);
    await expect(page.locator('body')).not.toHaveClass(/is-mobile/);

    const picker = await openPicker(page, 'Fall 2024-2025');
    const tall = await pickerGeometry(picker);
    expectContained(tall, 'tall viewport');
    expect(tall.placement).toBe('above');
    expect(tall.inlineMaxHeight, 'tall cards should not retain the legacy 320px ceiling')
      .toBeGreaterThan(320);
    expect(tall.dropdown.height, 'the visible list should use the extra room')
      .toBeGreaterThan(320);
    expect(tall.listScrolls, 'the large catalog still has one contained list scroller').toBe(true);

    await page.setViewportSize({ width: 1280, height: 520 });
    await settleGeometry(page, picker);
    const short = await pickerGeometry(picker);
    expectContained(short, 'short viewport');
    expect(short.placement).toBe('above');
    expect(short.inlineMaxHeight, 'short cards reduce the list ceiling')
      .toBeLessThan(tall.inlineMaxHeight);
    expect(short.dropdown.height, 'short cards reduce the rendered list')
      .toBeLessThan(tall.dropdown.height);
    expect(short.listScrolls, 'course results remain scrollable on short cards').toBe(true);

    await page.setViewportSize({ width: 1280, height: 1000 });
    await settleGeometry(page, picker);
    const restored = await pickerGeometry(picker);
    expectContained(restored, 'restored tall viewport');
    expect(restored.placement).toBe('above');
    expect(restored.inlineMaxHeight).toBeGreaterThan(short.inlineMaxHeight);
    expect(restored.inlineMaxHeight).toBeCloseTo(tall.inlineMaxHeight, 0);
  });

  test('stays anchored and contained while the horizontal semester board scrolls', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1000, height: 760 });
    await seedPlan(page, horizontalPlan);
    await expect(page.locator('body')).not.toHaveClass(/is-mobile/);

    const picker = await openPicker(page, 'Spring 2025-2026');
    const board = page.locator('.board');
    const before = await pickerGeometry(picker);
    expectContained(before, 'before board scroll');
    expect(before.placement).toBe('above');

    const didScroll = await board.evaluate((element) => {
      const previous = element.scrollLeft;
      const maximum = Math.max(0, element.scrollWidth - element.clientWidth);
      const preferred = Math.min(maximum, previous + 72);
      element.scrollLeft = preferred !== previous
        ? preferred
        : Math.max(0, previous - 72);
      element.dispatchEvent(new Event('scroll'));
      return Math.abs(element.scrollLeft - previous) > 1;
    });
    expect(didScroll, 'fixture must exercise the board-scroll positioning path').toBe(true);
    await settleGeometry(page, picker);

    const after = await pickerGeometry(picker);
    expectContained(after, 'after board scroll');
    expect(after.placement).toBe('above');
    expect(Math.abs(after.row.left - before.row.left), 'anchor moved with its semester')
      .toBeGreaterThan(1);
    const expectedLeft = Math.max(
      8,
      Math.min(Math.round(after.row.left), Math.max(8, after.viewport.width - after.row.width - 8)),
    );
    expect(after.dropdown.left, 'list follows the moved search row').toBeCloseTo(expectedLeft, 0);
  });

  test('keeps above placement anchored inside a shrunken visual viewport', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1280, height: 1000 });
    await seedPlan(page, singleSemesterPlan);
    await expect(page.locator('body')).not.toHaveClass(/is-mobile/);

    const picker = await openPicker(page, 'Fall 2024-2025');
    const session = await page.context().newCDPSession(page);
    try {
      // Pinch-zoom semantics shrink visualViewport while leaving the CSS
      // layout viewport (the containing block for fixed `bottom`) unchanged.
      // A placement calculation that substitutes visualViewport.height for
      // layout height shifts an above-positioned list away from its anchor.
      await session.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1.1 });
      await expect.poll(() => page.evaluate(() => (
        window.visualViewport ? window.visualViewport.scale : 1
      ))).toBeGreaterThan(1.05);
      await settleGeometry(page, picker);

      const zoomed = await pickerGeometry(picker);
      expect(zoomed.visualViewport.height).toBeLessThan(zoomed.viewport.height - 40);
      expect(zoomed.placement).toBe('above');
      expectContained(zoomed, 'shrunken visual viewport');
      expect(zoomed.anchorGap, 'fixed bottom resolves to six CSS pixels above the anchor')
        .toBeCloseTo(6, 0);
    } finally {
      await session.send('Emulation.setPageScaleFactor', { pageScaleFactor: 1 });
      await session.detach();
    }
  });
});
