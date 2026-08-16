'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');
const { openScheduler } = require('../helpers/scheduler');

const TERM = 'Fall 2024-2025';
const SCHEDULER_TERM = '202403';

const denseControlsPlan = {
  major: 'CS',
  entryTerm: TERM,
  doubleMajor: 'DSA',
  entryTermDM: TERM,
  minor1: 'FIN-MINOR',
  entryTermMinor1: TERM,
  minor2: 'ANALY-MINOR',
  entryTermMinor2: TERM,
  minor3: 'PHIL-MINOR',
  entryTermMinor3: TERM,
  curriculum: [['MATH101'], ['CS201']],
  grades: [['A'], ['A']],
  dates: [TERM, 'Spring 2024-2025'],
};

const schedulerPlan = {
  major: 'CS',
  entryTerm: TERM,
  curriculum: [],
  grades: [],
  dates: [],
  schedulerSelectedTerm: SCHEDULER_TERM,
  schedulerStates: {
    [SCHEDULER_TERM]: {
      selected: { HUM201D: { course_id: 'HUM201D', crn: '30127' } },
      blocked: [],
    },
  },
};

async function settleResponsiveLayout(page) {
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
}

async function readDesktopSidebarLayout(page) {
  return page.evaluate(() => {
    const rect = (element) => {
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
    };
    const inside = (child, parent, tolerance = 1) => child.left >= parent.left - tolerance
      && child.right <= parent.right + tolerance
      && child.top >= parent.top - tolerance
      && child.bottom <= parent.bottom + tolerance;
    const horizontalOverlap = (first, second) => Math.max(
      0, Math.min(first.right, second.right) - Math.max(first.left, second.left),
    );
    const visible = (element) => {
      const styles = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return styles.display !== 'none' && styles.visibility !== 'hidden'
        && box.width > 0 && box.height > 0;
    };

    const main = document.querySelector('.main-content');
    const sidebar = document.querySelector('.sidebar');
    const content = sidebar.querySelector('.sidebar-content');
    const board = document.querySelector('.board');
    const reset = sidebar.querySelector('.resetLocal');
    content.scrollTop = content.scrollHeight;

    const mainBox = rect(main);
    const sidebarBox = rect(sidebar);
    const contentBox = rect(content);
    const boardBox = rect(board);
    const resetBox = rect(reset);
    const controls = Array.from(content.querySelectorAll('select, button')).filter(visible).map(rect);
    return {
      sidebarInMain: inside(sidebarBox, mainBox),
      boardInMain: inside(boardBox, mainBox),
      sidebarBoardOverlap: horizontalOverlap(sidebarBox, boardBox),
      controlsInSidebarHorizontally: controls.every((box) => (
        box.left >= sidebarBox.left - 1 && box.right <= sidebarBox.right + 1
      )),
      resetReachable: inside(resetBox, contentBox),
      contentCanScroll: content.scrollHeight > content.clientHeight + 1,
      contentHorizontalOverflow: content.scrollWidth - content.clientWidth,
      documentHorizontalOverflow:
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

async function readDesktopSchedulerLayout(modal) {
  return modal.evaluate((root) => {
    const rect = (element) => {
      const box = element.getBoundingClientRect();
      return {
        left: box.left, right: box.right, top: box.top, bottom: box.bottom,
        width: box.width, height: box.height,
      };
    };
    const inside = (child, parent, tolerance = 1) => child.left >= parent.left - tolerance
      && child.right <= parent.right + tolerance
      && child.top >= parent.top - tolerance
      && child.bottom <= parent.bottom + tolerance;
    const horizontalInside = (child, parent, tolerance = 1) => (
      child.left >= parent.left - tolerance && child.right <= parent.right + tolerance
    );
    const horizontalOverlap = (first, second) => Math.max(
      0, Math.min(first.right, second.right) - Math.max(first.left, second.left),
    );

    const header = root.querySelector('.scheduler-header');
    const title = header.querySelector('.scheduler-title');
    const actions = header.querySelector('.scheduler-header-actions');
    const layout = root.querySelector('.scheduler-layout');
    const sidebar = root.querySelector('.scheduler-sidebar');
    const gridWrap = root.querySelector('.scheduler-grid-wrap');
    const gridHeader = root.querySelector('.scheduler-grid-header');
    const grid = root.querySelector('.scheduler-grid');
    const days = Array.from(root.querySelectorAll('.scheduler-day-col')).filter((element) => (
      getComputedStyle(element).display !== 'none'
    ));
    const dayHeaders = Array.from(root.querySelectorAll('.scheduler-grid-day')).filter((element) => (
      getComputedStyle(element).display !== 'none'
    ));
    const block = root.querySelector('.scheduler-block[data-course="HUM201D"]');

    const modalBox = rect(root);
    const headerBox = rect(header);
    const titleBox = rect(title);
    const actionsBox = rect(actions);
    const layoutBox = rect(layout);
    const sidebarBox = rect(sidebar);
    const sidebarVisible = getComputedStyle(sidebar).display !== 'none'
      && sidebarBox.width > 0 && sidebarBox.height > 0;
    const gridWrapBox = rect(gridWrap);
    const gridHeaderBox = rect(gridHeader);
    const gridBox = rect(grid);
    const dayBoxes = days.map(rect);
    const dayHeaderBoxes = dayHeaders.map(rect);
    const blockBox = rect(block);
    const blockDayBox = rect(block.closest('.scheduler-day-col'));
    return {
      modalInViewport: modalBox.left >= -1 && modalBox.right <= window.innerWidth + 1
        && modalBox.top >= -1 && modalBox.bottom <= window.innerHeight + 1,
      headerInModal: inside(headerBox, modalBox),
      titleInHeader: inside(titleBox, headerBox),
      actionsInHeader: inside(actionsBox, headerBox),
      titleActionsOverlap: horizontalOverlap(titleBox, actionsBox),
      layoutInModal: inside(layoutBox, modalBox),
      sidebarGeometryValid: !sidebarVisible || inside(sidebarBox, layoutBox),
      sidebarVisibilityMatchesState: sidebarVisible
        !== root.querySelector('.scheduler-body').classList.contains('is-sidebar-collapsed'),
      gridInLayout: inside(gridWrapBox, layoutBox),
      sidebarGridOverlap: sidebarVisible ? horizontalOverlap(sidebarBox, gridWrapBox) : 0,
      gridHeaderInWrap: inside(gridHeaderBox, gridWrapBox),
      daysInGridHorizontally: dayBoxes.every((box) => horizontalInside(box, gridBox)),
      dayHeadersInHeader: dayHeaderBoxes.every((box) => horizontalInside(box, gridHeaderBox)),
      minimumDayWidth: Math.min(...dayBoxes.map((box) => box.width)),
      blockInDay: inside(blockBox, blockDayBox),
      blockHasArea: blockBox.width > 0 && blockBox.height > 0,
      modalHorizontalOverflow: root.scrollWidth - root.clientWidth,
      headerHorizontalOverflow: header.scrollWidth - header.clientWidth,
      gridHorizontalOverflow: grid.scrollWidth - grid.clientWidth,
      documentHorizontalOverflow:
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

test.describe('responsive planner and scheduler geometry (desktop)', () => {
  test('planner sidebar stays separate from the board and its final controls remain reachable', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedPlan(page, denseControlsPlan);
    await expect(page.getByLabel('Minor 3 program')).toHaveValue('PHIL-MINOR');

    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 1280, height: 500 },
      { width: 900, height: 1200 },
    ]) {
      await page.setViewportSize(viewport);
      await expect(page.locator('body')).not.toHaveClass(/is-mobile/);
      await settleResponsiveLayout(page);
      const layout = await readDesktopSidebarLayout(page);
      expect(layout, `${viewport.width}x${viewport.height} containment`).toMatchObject({
        sidebarInMain: true,
        boardInMain: true,
        controlsInSidebarHorizontally: true,
        resetReachable: true,
      });
      expect(layout.sidebarBoardOverlap, `${viewport.width}x${viewport.height} sidebar/board overlap`)
        .toBeLessThanOrEqual(1);
      expect(layout.contentHorizontalOverflow, `${viewport.width}x${viewport.height} sidebar overflow`)
        .toBeLessThanOrEqual(1);
      expect(layout.documentHorizontalOverflow, `${viewport.width}x${viewport.height} document overflow`)
        .toBeLessThanOrEqual(1);
      if (viewport.height === 500) expect(layout.contentCanScroll).toBe(true);
    }
  });

  test('desktop scheduler modal, header, days, and a committed block stay contained', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 2560, height: 1080 });
    await seedPlan(page, schedulerPlan);
    const modal = await openScheduler(page);
    await expect(modal.locator('.scheduler-block[data-course="HUM201D"]').first()).toBeVisible();

    for (const viewport of [
      { width: 2560, height: 1080 },
      { width: 1024, height: 600 },
      { width: 821, height: 600 },
    ]) {
      await page.setViewportSize(viewport);
      await expect(page.locator('body')).not.toHaveClass(/is-mobile/);
      await settleResponsiveLayout(page);
      const layout = await readDesktopSchedulerLayout(modal);
      expect(layout, `${viewport.width}x${viewport.height} scheduler containment`).toMatchObject({
        modalInViewport: true,
        headerInModal: true,
        titleInHeader: true,
        actionsInHeader: true,
        layoutInModal: true,
        sidebarGeometryValid: true,
        sidebarVisibilityMatchesState: true,
        gridInLayout: true,
        gridHeaderInWrap: true,
        daysInGridHorizontally: true,
        dayHeadersInHeader: true,
        blockInDay: true,
        blockHasArea: true,
      });
      expect(layout.titleActionsOverlap, `${viewport.width}x${viewport.height} header overlap`)
        .toBeLessThanOrEqual(0.5);
      expect(layout.sidebarGridOverlap, `${viewport.width}x${viewport.height} sidebar/grid overlap`)
        .toBeLessThanOrEqual(0.5);
      expect(layout.minimumDayWidth, `${viewport.width}x${viewport.height} usable day width`)
        .toBeGreaterThan(40);
      expect(layout.modalHorizontalOverflow).toBeLessThanOrEqual(1);
      expect(layout.headerHorizontalOverflow).toBeLessThanOrEqual(1);
      expect(layout.gridHorizontalOverflow).toBeLessThanOrEqual(1);
      expect(layout.documentHorizontalOverflow).toBeLessThanOrEqual(1);
    }
  });

  test('an open scheduler adopts mobile landscape mode across a same-orientation resize', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 900, height: 600 });
    await seedPlan(page, schedulerPlan);
    await openScheduler(page);
    await expect(page.locator('body')).not.toHaveClass(/is-mobile/);
    await expect(page.locator('.scheduler-modal')).not.toHaveClass(/m-scheduler/);

    await page.setViewportSize({ width: 800, height: 600 });
    await expect(page.locator('body')).toHaveClass(/is-mobile/);
    const modal = page.locator('.scheduler-modal');
    await expect(modal).toHaveClass(/m-scheduler/, { timeout: 10000 });
    await expect(modal).toHaveCount(1);
    await expect(page.locator('.scheduler-overlay')).toHaveCount(1);
    await expect(modal.locator('.m-sched-corner-search')).toBeVisible();
    for (const day of ['M', 'T', 'W', 'R', 'F']) {
      await expect(modal.locator(`.scheduler-day-col[data-day="${day}"]`)).toBeVisible();
    }
    await expect(modal.locator('.scheduler-block[data-course="HUM201D"]').first()).toBeVisible();

    const geometry = await modal.evaluate((root) => {
      const box = root.getBoundingClientRect();
      return {
        oneModal: document.querySelectorAll('.scheduler-modal').length === 1,
        inViewport: box.left >= -1 && box.right <= window.innerWidth + 1
          && box.top >= -1 && box.bottom <= window.innerHeight + 1,
        documentHorizontalOverflow:
          document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    expect(geometry).toMatchObject({ oneModal: true, inViewport: true });
    expect(geometry.documentHorizontalOverflow).toBeLessThanOrEqual(1);
  });
});
