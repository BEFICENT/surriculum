'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');

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
  curriculum: [['MATH101']],
  grades: [['A']],
  dates: [TERM],
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

async function openMobileScheduler(page) {
  await page.evaluate(() => window.openSchedulerModal());
  const modal = page.locator('.scheduler-modal.m-scheduler');
  await expect(modal).toBeVisible({ timeout: 15000 });
  await expect(modal.locator('.scheduler-course').first()).toBeVisible({ timeout: 15000 });
  return modal;
}

async function waitForLandscapeFit(modal) {
  await expect.poll(async () => modal.evaluate((root) => {
    const grid = root.querySelector('.scheduler-grid');
    if (!grid) return Infinity;
    const styles = getComputedStyle(grid);
    const ppm = parseFloat(styles.getPropertyValue('--scheduler-minute'));
    const topGap = parseFloat(styles.getPropertyValue('--scheduler-top-gap')) || 14;
    const minutes = parseFloat(root.getAttribute('data-grid-minutes')) || 660;
    const target = Math.max(0.26, Math.min(1, (grid.clientHeight - topGap - 2) / minutes));
    return Math.abs(ppm - target);
  })).toBeLessThan(0.005);
}

async function readMobileControlsLayout(page) {
  return page.evaluate(() => {
    const rect = (element) => {
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
    };
    const inside = (child, parent, tolerance = 1) => child.left >= parent.left - tolerance
      && child.right <= parent.right + tolerance
      && child.top >= parent.top - tolerance
      && child.bottom <= parent.bottom + tolerance;
    const overlapArea = (first, second) => Math.max(
      0, Math.min(first.right, second.right) - Math.max(first.left, second.left),
    ) * Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top));
    const visible = (element) => {
      const styles = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return styles.display !== 'none' && styles.visibility !== 'hidden'
        && box.width > 0 && box.height > 0;
    };

    const main = document.querySelector('.main-content');
    const sidebar = document.querySelector('.sidebar');
    const content = sidebar.querySelector('.sidebar-content');
    const nav = document.querySelector('#mNav');
    const reset = sidebar.querySelector('.resetLocal');
    content.scrollTop = content.scrollHeight;

    const mainBox = rect(main);
    const sidebarBox = rect(sidebar);
    const contentBox = rect(content);
    const navBox = rect(nav);
    const resetBox = rect(reset);
    const controls = Array.from(content.querySelectorAll('select, button')).filter(visible).map(rect);
    return {
      sidebarInMain: inside(sidebarBox, mainBox),
      contentInSidebar: inside(contentBox, sidebarBox),
      navInViewport: navBox.left >= -1 && navBox.right <= window.innerWidth + 1
        && navBox.top >= -1 && navBox.bottom <= window.innerHeight + 1,
      sidebarNavOverlap: overlapArea(sidebarBox, navBox),
      resetReachable: inside(resetBox, contentBox),
      resetNavOverlap: overlapArea(resetBox, navBox),
      controlsInSidebarHorizontally: controls.every((box) => (
        box.left >= sidebarBox.left - 1 && box.right <= sidebarBox.right + 1
      )),
      contentCanScroll: content.scrollHeight > content.clientHeight + 1,
      contentHorizontalOverflow: content.scrollWidth - content.clientWidth,
      documentHorizontalOverflow:
        document.documentElement.scrollWidth - document.documentElement.clientWidth,
    };
  });
}

test.describe('responsive planner and scheduler geometry (mobile)', () => {
  test('Controls stay contained and the danger-zone actions remain reachable on compact phones', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 320, height: 568 });
    await seedPlan(page, denseControlsPlan);
    await page.locator('.m-nav-item[data-mtab="controls"]').click();
    await expect(page.locator('body')).toHaveAttribute('data-mobile-tab', 'controls');
    await expect(page.getByLabel('Minor 3 program')).toHaveValue('PHIL-MINOR');

    for (const viewport of [
      { width: 320, height: 568 },
      { width: 568, height: 320 },
    ]) {
      await page.setViewportSize(viewport);
      await expect(page.locator('body')).toHaveClass(/is-mobile/);
      await expect(page.locator('.sidebar')).toBeVisible();
      await expect(page.locator('.board')).toBeHidden();
      await settleResponsiveLayout(page);
      const layout = await readMobileControlsLayout(page);
      expect(layout, `${viewport.width}x${viewport.height} Controls containment`).toMatchObject({
        sidebarInMain: true,
        contentInSidebar: true,
        navInViewport: true,
        resetReachable: true,
        controlsInSidebarHorizontally: true,
        contentCanScroll: true,
      });
      expect(layout.sidebarNavOverlap).toBeLessThanOrEqual(0.5);
      expect(layout.resetNavOverlap).toBeLessThanOrEqual(0.5);
      expect(layout.contentHorizontalOverflow).toBeLessThanOrEqual(1);
      expect(layout.documentHorizontalOverflow).toBeLessThanOrEqual(1);
    }
  });

  test('320x568 portrait scheduler keeps its header, day view, FAB, and sheet content contained', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 320, height: 568 });
    await seedPlan(page, schedulerPlan);
    const modal = await openMobileScheduler(page);
    await modal.locator('.m-sched-day[data-day="W"]').click();
    await expect(modal.locator('.scheduler-block[data-course="HUM201D"]').first()).toBeVisible();

    const closed = await modal.evaluate((root) => {
      const rect = (element) => {
        const box = element.getBoundingClientRect();
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
      };
      const inside = (child, parent, tolerance = 1) => child.left >= parent.left - tolerance
        && child.right <= parent.right + tolerance
        && child.top >= parent.top - tolerance
        && child.bottom <= parent.bottom + tolerance;
      const overlapArea = (first, second) => Math.max(
        0, Math.min(first.right, second.right) - Math.max(first.left, second.left),
      ) * Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top));
      const header = root.querySelector('.scheduler-header');
      const title = header.querySelector('.scheduler-title');
      const actions = header.querySelector('.scheduler-header-actions');
      const days = root.querySelector('.m-sched-days');
      const grid = root.querySelector('.scheduler-grid');
      const fab = root.querySelector('.m-sched-fab');
      const modalBox = rect(root);
      const headerBox = rect(header);
      const titleBox = rect(title);
      const actionsBox = rect(actions);
      return {
        modalInViewport: modalBox.left >= -1 && modalBox.right <= window.innerWidth + 1
          && modalBox.top >= -1 && modalBox.bottom <= window.innerHeight + 1,
        headerInModal: inside(headerBox, modalBox),
        titleInHeader: inside(titleBox, headerBox),
        actionsInHeader: inside(actionsBox, headerBox),
        titleActionsOverlap: overlapArea(titleBox, actionsBox),
        daysInModal: inside(rect(days), modalBox),
        gridInModal: inside(rect(grid), modalBox),
        fabInModal: inside(rect(fab), modalBox),
        visibleDayCount: Array.from(root.querySelectorAll('.scheduler-day-col')).filter((element) => (
          getComputedStyle(element).display !== 'none'
        )).length,
        headerHorizontalOverflow: header.scrollWidth - header.clientWidth,
        documentHorizontalOverflow:
          document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    expect(closed).toMatchObject({
      modalInViewport: true,
      headerInModal: true,
      titleInHeader: true,
      actionsInHeader: true,
      daysInModal: true,
      gridInModal: true,
      fabInModal: true,
      visibleDayCount: 1,
    });
    expect(closed.titleActionsOverlap).toBeLessThanOrEqual(0.5);
    expect(closed.headerHorizontalOverflow).toBeLessThanOrEqual(1);
    expect(closed.documentHorizontalOverflow).toBeLessThanOrEqual(1);

    await modal.locator('.m-sched-fab').click();
    await expect(modal).toHaveClass(/m-sheet-open/);
    const sidebar = modal.locator('.scheduler-sidebar');
    await expect.poll(async () => sidebar.evaluate((panel) => {
      const box = panel.getBoundingClientRect();
      return box.left >= -1 && box.right <= window.innerWidth + 1
        && box.top >= -1 && box.bottom <= window.innerHeight + 1;
    })).toBe(true);
    const lastCourse = sidebar.locator('.scheduler-course').last();
    await lastCourse.scrollIntoViewIfNeeded();
    const sheet = await modal.evaluate((root) => {
      const rect = (element) => {
        const box = element.getBoundingClientRect();
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
      };
      const inside = (child, parent, tolerance = 1) => child.left >= parent.left - tolerance
        && child.right <= parent.right + tolerance
        && child.top >= parent.top - tolerance
        && child.bottom <= parent.bottom + tolerance;
      const overlapArea = (first, second) => Math.max(
        0, Math.min(first.right, second.right) - Math.max(first.left, second.left),
      ) * Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top));
      const panel = root.querySelector('.scheduler-sidebar');
      const bar = panel.querySelector('.m-sched-sheet-bar');
      const done = root.querySelector('.m-sched-done-fab');
      const last = panel.querySelector('.scheduler-course:last-child');
      const panelBox = rect(panel);
      return {
        barInPanel: inside(rect(bar), panelBox),
        lastCourseInPanel: inside(rect(last), panelBox),
        doneInViewport: (() => {
          const box = rect(done);
          return box.left >= -1 && box.right <= window.innerWidth + 1
            && box.top >= -1 && box.bottom <= window.innerHeight + 1;
        })(),
        lastDoneOverlap: overlapArea(rect(last), rect(done)),
        panelHorizontalOverflow: panel.scrollWidth - panel.clientWidth,
      };
    });
    expect(sheet).toMatchObject({ barInPanel: true, lastCourseInPanel: true, doneInViewport: true });
    expect(sheet.lastDoneOverlap).toBeLessThanOrEqual(0.5);
    expect(sheet.panelHorizontalOverflow).toBeLessThanOrEqual(1);
  });

  test('568x320 landscape scheduler contains its compact week and Add-courses side panel', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 568, height: 320 });
    await seedPlan(page, schedulerPlan);
    const modal = await openMobileScheduler(page);
    await waitForLandscapeFit(modal);
    for (const day of ['M', 'T', 'W', 'R', 'F']) {
      await expect(modal.locator(`.scheduler-day-col[data-day="${day}"]`)).toBeVisible();
    }

    const compact = await modal.evaluate((root) => {
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
      const overlapArea = (first, second) => Math.max(
        0, Math.min(first.right, second.right) - Math.max(first.left, second.left),
      ) * Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top));
      const header = root.querySelector('.scheduler-header');
      const title = header.querySelector('.scheduler-title');
      const legend = header.querySelector('.scheduler-legend');
      const actions = header.querySelector('.scheduler-header-actions');
      const gridHeader = root.querySelector('.scheduler-grid-header');
      const grid = root.querySelector('.scheduler-grid');
      const days = Array.from(root.querySelectorAll('.scheduler-day-col')).filter((element) => (
        getComputedStyle(element).display !== 'none'
      ));
      const headers = Array.from(root.querySelectorAll('.scheduler-grid-day')).filter((element) => (
        getComputedStyle(element).display !== 'none'
      ));
      const block = root.querySelector('.scheduler-block[data-course="HUM201D"]');
      const day = block.closest('.scheduler-day-col');
      const modalBox = rect(root);
      const headerBox = rect(header);
      const titleBox = rect(title);
      const legendBox = rect(legend);
      const actionsBox = rect(actions);
      const gridHeaderBox = rect(gridHeader);
      const gridBox = rect(grid);
      const dayBoxes = days.map(rect);
      return {
        modalInViewport: modalBox.left >= -1 && modalBox.right <= window.innerWidth + 1
          && modalBox.top >= -1 && modalBox.bottom <= window.innerHeight + 1,
        headerInModal: inside(headerBox, modalBox),
        titleInHeader: inside(titleBox, headerBox),
        legendInHeader: inside(legendBox, headerBox),
        actionsInHeader: inside(actionsBox, headerBox),
        titleActionsOverlap: overlapArea(titleBox, actionsBox),
        legendActionsOverlap: overlapArea(legendBox, actionsBox),
        gridHeaderInModal: inside(gridHeaderBox, modalBox),
        gridInModal: inside(gridBox, modalBox),
        daysInGridHorizontally: dayBoxes.every((box) => horizontalInside(box, gridBox)),
        headersInGridHeader: headers.map(rect).every((box) => horizontalInside(box, gridHeaderBox)),
        minimumDayWidth: Math.min(...dayBoxes.map((box) => box.width)),
        blockInDay: inside(rect(block), rect(day)),
        blockHasArea: rect(block).width > 0 && rect(block).height >= 8,
        headerHorizontalOverflow: header.scrollWidth - header.clientWidth,
        gridHorizontalOverflow: grid.scrollWidth - grid.clientWidth,
        gridVerticalOverflow: grid.scrollHeight - grid.clientHeight,
        documentHorizontalOverflow:
          document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    expect(compact).toMatchObject({
      modalInViewport: true,
      headerInModal: true,
      titleInHeader: true,
      legendInHeader: true,
      actionsInHeader: true,
      gridHeaderInModal: true,
      gridInModal: true,
      daysInGridHorizontally: true,
      headersInGridHeader: true,
      blockInDay: true,
      blockHasArea: true,
    });
    expect(compact.titleActionsOverlap).toBeLessThanOrEqual(0.5);
    expect(compact.legendActionsOverlap).toBeLessThanOrEqual(0.5);
    expect(compact.minimumDayWidth).toBeGreaterThan(40);
    expect(compact.headerHorizontalOverflow).toBeLessThanOrEqual(1);
    expect(compact.gridHorizontalOverflow).toBeLessThanOrEqual(1);
    expect(compact.gridVerticalOverflow).toBeLessThanOrEqual(2);
    expect(compact.documentHorizontalOverflow).toBeLessThanOrEqual(1);

    await modal.locator('.m-sched-corner-search').click();
    await expect(modal).toHaveClass(/m-sheet-open/);
    const panel = modal.locator('.scheduler-sidebar');
    await expect.poll(async () => panel.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return box.left >= -1 && box.right <= window.innerWidth + 1
        && box.top >= -1 && box.bottom <= window.innerHeight + 1;
    })).toBe(true);
    const panelGeometry = await panel.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const close = element.querySelector('.m-sched-sheet-close').getBoundingClientRect();
      return {
        width: box.width,
        closeInside: close.left >= box.left - 1 && close.right <= box.right + 1
          && close.top >= box.top - 1 && close.bottom <= box.bottom + 1,
        horizontalOverflow: element.scrollWidth - element.clientWidth,
      };
    });
    expect(panelGeometry.closeInside).toBe(true);
    expect(panelGeometry.width).toBeLessThanOrEqual(568 * 0.62 + 1);
    expect(panelGeometry.horizontalOverflow).toBeLessThanOrEqual(1);
  });
});
