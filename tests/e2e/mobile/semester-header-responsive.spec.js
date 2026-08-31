'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');

// A deliberately wide workload label exercises the header's worst case. The
// N/A portion is part of the term load and therefore must remain visible.
const unallocatedCustomCourse = {
  Major: 'ZZZ',
  Code: '925',
  Course_Name: 'Fractional Unallocated Course',
  ECTS: '5',
  Engineering: 0,
  Basic_Science: 0,
  SU_credit: '2.5',
  Faculty: '',
  Faculty_Course: 'No',
  EL_Type: 'unknown',
};

const PLAN = {
  major: 'CS',
  entryTerm: 'Fall 2024-2025',
  customCourses: { CS: [unallocatedCustomCourse] },
  curriculum: [['MATH101', 'ZZZ925']],
  grades: [['A', 'A']],
  dates: ['Spring 2025-2026'],
};

async function readHeaderGeometry(semester) {
  return semester.evaluate((card) => {
    const visible = (element) => {
      if (!element) return false;
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden'
        && box.width > 0 && box.height > 0;
    };
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
    const inside = (child, parent, tolerance = 1) => child.left >= parent.left - tolerance
      && child.right <= parent.right + tolerance
      && child.top >= parent.top - tolerance
      && child.bottom <= parent.bottom + tolerance;
    const overlapArea = (first, second) => Math.max(
      0,
      Math.min(first.right, second.right) - Math.max(first.left, second.left),
    ) * Math.max(
      0,
      Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top),
    );
    const commonVerticalOverlap = (boxes) => Math.max(
      0,
      Math.min(...boxes.map((box) => box.bottom))
        - Math.max(...boxes.map((box) => box.top)),
    );
    const union = (boxes) => boxes.reduce((result, box) => ({
      left: Math.min(result.left, box.left),
      right: Math.max(result.right, box.right),
      top: Math.min(result.top, box.top),
      bottom: Math.max(result.bottom, box.bottom),
    }));

    const date = card.querySelector('.date');
    const label = date.querySelector('p');
    const credit = card.querySelector('.total_credit');
    const chevron = date.querySelector('.m-sem-chevron');
    const grip = date.querySelector('.semester_drag');
    const board = card.closest('.board');
    const actionElements = Array.from(date.querySelectorAll(
      '.semester_date_edit, .semester_move, .delete_semester',
    )).filter(visible);
    const actionBoxes = actionElements.map(rect);
    const cardBox = rect(card);
    const dateBox = rect(date);
    const labelBox = rect(label);
    const creditBox = rect(credit);
    const chevronBox = rect(chevron);
    const actionsBox = actionBoxes.length ? union(actionBoxes) : null;
    const range = document.createRange();
    range.selectNodeContents(label);
    const labelLines = Array.from(range.getClientRects())
      .filter((box) => box.width > 0 && box.height > 0).length;
    let maximumActionOverlap = 0;
    let maximumActionCenterDelta = 0;
    for (let index = 0; index < actionBoxes.length; index += 1) {
      for (let next = index + 1; next < actionBoxes.length; next += 1) {
        maximumActionOverlap = Math.max(
          maximumActionOverlap,
          overlapArea(actionBoxes[index], actionBoxes[next]),
        );
        maximumActionCenterDelta = Math.max(
          maximumActionCenterDelta,
          Math.abs(
            (actionBoxes[index].top + actionBoxes[index].bottom) / 2
              - (actionBoxes[next].top + actionBoxes[next].bottom) / 2,
          ),
        );
      }
    }

    return {
      collapsed: card.classList.contains('m-collapsed'),
      labelLines,
      actionCount: actionBoxes.length,
      gripVisible: visible(grip),
      creditVisible: visible(credit),
      chevronVisible: visible(chevron),
      dateInCard: inside(dateBox, cardBox),
      labelInCard: inside(labelBox, cardBox),
      creditInCard: inside(creditBox, cardBox),
      chevronInCard: inside(chevronBox, cardBox),
      actionsInCard: actionBoxes.every((box) => inside(box, cardBox)),
      labelCreditOverlap: overlapArea(labelBox, creditBox),
      labelChevronOverlap: overlapArea(labelBox, chevronBox),
      creditChevronOverlap: overlapArea(creditBox, chevronBox),
      labelActionsOverlap: actionsBox ? overlapArea(labelBox, actionsBox) : 0,
      creditActionsOverlap: actionsBox ? overlapArea(creditBox, actionsBox) : 0,
      chevronActionsOverlap: actionsBox ? overlapArea(chevronBox, actionsBox) : 0,
      maximumActionOverlap,
      maximumActionCenterDelta,
      expandedRowCommonOverlap: actionsBox
        ? commonVerticalOverlap([labelBox, creditBox, chevronBox, actionsBox]) : 0,
      collapsedRowCommonOverlap: commonVerticalOverlap([labelBox, creditBox, chevronBox]),
      cardHeight: cardBox.height,
      cardOverflow: card.scrollWidth - card.clientWidth,
      dateOverflow: date.scrollWidth - date.clientWidth,
      boardOverflow: board.scrollWidth - board.clientWidth,
    };
  });
}

test.describe('responsive mobile semester headers', () => {
  for (const width of [320, 360, 390, 412]) {
    test(`${width}px keeps expanded and collapsed headers uncluttered`, async ({ page }) => {
      await page.setViewportSize({ width, height: 850 });
      await seedPlan(page, PLAN);
      await expect(page.locator('body')).toHaveClass(/is-mobile/);

      const board = page.locator('.board');
      await expect(board, 'mobile planner does not animate through a squeezed desktop sidebar offset')
        .toHaveCSS('transition-duration', '0s');

      const semester = page.locator('.container_semester').first();
      const label = semester.locator('.date p');
      const grip = semester.locator('.semester_drag');
      await expect(label).toHaveText('Spring 2025-2026');
      await expect(semester.locator('.total_credit_text')).toContainText('5.5 SU (2.5 N/A)');
      await expect(grip, 'the pointer-oriented desktop drag grip stays off touch headers').toBeHidden();
      // This is a pixel-geometry contract, so measure the final Inter and
      // Font Awesome metrics rather than a transient fallback-font layout.
      await page.evaluate(() => document.fonts.ready);

      if (await semester.evaluate((card) => card.classList.contains('m-collapsed'))) {
        await label.click();
      }
      await expect(semester).not.toHaveClass(/m-collapsed/);

      const expanded = await readHeaderGeometry(semester);
      expect(expanded).toMatchObject({
        collapsed: false,
        actionCount: 4,
        gripVisible: false,
        creditVisible: true,
        chevronVisible: true,
        dateInCard: true,
        labelInCard: true,
        creditInCard: true,
        chevronInCard: true,
        actionsInCard: true,
      });
      expect(expanded.labelLines).toBeLessThanOrEqual(width >= 360 ? 1 : 2);
      for (const [pair, value] of Object.entries({
        termCredit: expanded.labelCreditOverlap,
        termChevron: expanded.labelChevronOverlap,
        termActions: expanded.labelActionsOverlap,
        creditActions: expanded.creditActionsOverlap,
        chevronActions: expanded.chevronActionsOverlap,
        actionPair: expanded.maximumActionOverlap,
      })) expect(value, `${pair} does not overlap`).toBeLessThanOrEqual(0.5);
      expect(expanded.maximumActionCenterDelta, 'the four touch actions remain one row')
        .toBeLessThanOrEqual(1);
      if (width >= 360) {
        expect(
          expanded.expandedRowCommonOverlap,
          'term, credit, chevron, and actions share one header row',
        ).toBeGreaterThan(1);
      }
      expect(expanded.cardOverflow).toBeLessThanOrEqual(1);
      expect(expanded.dateOverflow).toBeLessThanOrEqual(1);
      expect(expanded.boardOverflow).toBeLessThanOrEqual(1);

      await label.click();
      await expect(semester).toHaveClass(/m-collapsed/);
      await expect(grip).toBeHidden();

      const collapsed = await readHeaderGeometry(semester);
      expect(collapsed).toMatchObject({
        collapsed: true,
        actionCount: 0,
        gripVisible: false,
        creditVisible: true,
        chevronVisible: true,
        dateInCard: true,
        labelInCard: true,
        creditInCard: true,
        chevronInCard: true,
        actionsInCard: true,
      });
      expect(collapsed.labelLines, 'collapsed term may wrap once beside the workload pill')
        .toBeLessThanOrEqual(width >= 360 ? 1 : 2);
      for (const [pair, value] of Object.entries({
        termCredit: collapsed.labelCreditOverlap,
        termChevron: collapsed.labelChevronOverlap,
        creditChevron: collapsed.creditChevronOverlap,
      })) expect(value, `${pair} does not overlap`).toBeLessThanOrEqual(0.5);
      expect(collapsed.collapsedRowCommonOverlap).toBeGreaterThan(1);
      expect(collapsed.cardHeight, 'collapsed semester remains a compact header').toBeLessThanOrEqual(80);
      expect(collapsed.cardOverflow).toBeLessThanOrEqual(1);
      expect(collapsed.dateOverflow).toBeLessThanOrEqual(1);
      expect(collapsed.boardOverflow).toBeLessThanOrEqual(1);
    });
  }
});
