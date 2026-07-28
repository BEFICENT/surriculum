'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');
const { openScheduler } = require('../helpers/scheduler');

const TERM = '202501';

async function seedScheduler(page, selected = {}, term = TERM) {
  await seedPlan(page, {
    major: 'CS',
    entryTerm: 'Fall 2025-2026',
    curriculum: [],
    grades: [],
    dates: [],
    schedulerSelectedTerm: term,
    schedulerStates: {
      [term]: { selected, blocked: [] },
    },
  });
}

test.describe('scheduler date-specific intensive meetings (desktop)', () => {
  test('an intensive section is available and previews each unique slot once', async ({ page }) => {
    await seedScheduler(page);
    const modal = await openScheduler(page);

    await modal.locator('.scheduler-search').fill('ACC801');
    const card = modal.locator('.scheduler-course[data-course="ACC801"]');
    await expect(card).toBeVisible();
    await expect(card).toHaveClass(/\bis-available\b/);
    await expect(card).not.toHaveClass(/is-available-conflict/);

    await card.hover();
    // ACC801 has twelve raw meeting rows but only three unique weekly slots:
    // Friday evening, Saturday morning, and Saturday afternoon.
    await expect(modal.locator('.scheduler-block.is-preview[data-course="ACC801"]')).toHaveCount(3);
    await expect(modal.locator('.scheduler-block.is-preview-conflict')).toHaveCount(0);
    await expect(modal.locator('.scheduler-day-col[data-day="F"] .scheduler-block.is-preview')).toHaveAttribute('data-date-count', '4');
    await expect(modal.locator('.scheduler-day-col[data-day="S"] .scheduler-block.is-preview')).toHaveCount(2);
  });

  test('a selected intensive section does not duplicate or conflict with itself', async ({ page }) => {
    await seedScheduler(page, { ACC801: { course_id: 'ACC801', crn: '13264' } });
    const modal = await openScheduler(page);

    await expect(modal.locator('.scheduler-block[data-course="ACC801"]')).toHaveCount(3);
    await expect(modal.locator('.scheduler-day-col[data-day="F"] .scheduler-block[data-course="ACC801"]')).toHaveCount(1);
    await expect(modal.locator('.scheduler-day-col[data-day="S"] .scheduler-block[data-course="ACC801"]')).toHaveCount(2);
    await expect(modal.locator('.scheduler-block[data-course="ACC801"].is-conflict')).toHaveCount(0);
  });

  test('availability distinguishes disjoint and shared calendar dates', async ({ page }) => {
    await seedScheduler(page, { ACC801: { course_id: 'ACC801', crn: '13264' } });
    const modal = await openScheduler(page);

    // BAN800 occupies the same Friday/Saturday clock times, but only before
    // ACC801 starts, so it is genuinely compatible.
    await modal.locator('.scheduler-search').fill('BAN800');
    const disjoint = modal.locator('.scheduler-course[data-course="BAN800"]');
    await expect(disjoint).toBeVisible();
    await expect(disjoint).toHaveClass(/\bis-available\b/);
    await expect(disjoint).not.toHaveClass(/is-available-conflict/);

    // BAN900 shares Nov 15, Nov 21, and Nov 22 occurrences with ACC801.
    await modal.locator('.scheduler-search').fill('BAN900');
    const overlapping = modal.locator('.scheduler-course[data-course="BAN900"]');
    await expect(overlapping).toBeVisible();
    await expect(overlapping).toHaveClass(/is-available-conflict/);
  });

  test('same clock times on disjoint dates remain conflict-free when selected', async ({ page }) => {
    await seedScheduler(page, {
      ACC801: { course_id: 'ACC801', crn: '13264' },
      BAN800: { course_id: 'BAN800', crn: '13263' },
    });
    const modal = await openScheduler(page);

    await expect(modal.locator('.scheduler-block[data-course="ACC801"]')).toHaveCount(3);
    await expect(modal.locator('.scheduler-block[data-course="BAN800"]')).toHaveCount(3);
    await expect(modal.locator('.scheduler-block.is-conflict')).toHaveCount(0);
  });

  test('shared intensive dates still flag every genuinely conflicting slot', async ({ page }) => {
    await seedScheduler(page, {
      ACC801: { course_id: 'ACC801', crn: '13264' },
      BAN900: { course_id: 'BAN900', crn: '13260' },
    });
    const modal = await openScheduler(page);

    // The aggregated Friday, Saturday-morning, and Saturday-afternoon blocks
    // each share at least one actual date, so both courses' six blocks conflict.
    await expect(modal.locator('.scheduler-block.is-conflict')).toHaveCount(6);
  });

  test('a calendar-range intersection without that weekday is not a conflict', async ({ page }) => {
    await seedScheduler(page, {
      DA518: { course_id: 'DA518', crn: '21492' },
      IT526: { course_id: 'IT526', crn: '21488' },
    }, '202002');
    const modal = await openScheduler(page);

    // Both sections say Thursday 19:00-22:00 and their ranges intersect from
    // Mar 20-23, 2021, but that four-day intersection contains no Thursday.
    await expect(modal.locator('.scheduler-day-col[data-day="R"] .scheduler-block')).toHaveCount(2);
    await expect(modal.locator('.scheduler-block.is-conflict')).toHaveCount(0);
  });

  test('disjoint date phases with overlapping clocks all remain visible', async ({ page }) => {
    await seedScheduler(page, {
      ENG0001: { course_id: 'ENG0001', crn: '10784' },
    }, '202301');
    const modal = await openScheduler(page);

    await expect(modal.locator('.scheduler-block[data-course="ENG0001"]')).toHaveCount(14);
    await expect(modal.locator('.scheduler-block[data-course="ENG0001"].is-conflict')).toHaveCount(0);

    await modal.locator('.scheduler-search').fill('ENG0001');
    await modal.locator('.scheduler-sections-toggle[data-course="ENG0001"]').click();
    const section = modal.locator('.scheduler-inline-section-row[data-course="ENG0001"][data-crn="10784"]');
    await expect(section).toBeVisible();
    await section.hover();

    // This section changes its timetable halfway through the term. Its fourteen
    // distinct slots must all render, including weekly-overlapping Monday slots
    // from disjoint halves of the calendar.
    const previews = modal.locator('.scheduler-block.is-preview[data-course="ENG0001"]');
    await expect(previews).toHaveCount(14);
    const monday = modal.locator('.scheduler-day-col[data-day="M"] .scheduler-block.is-preview[data-course="ENG0001"]');
    await expect(monday).toHaveCount(4);
    const positions = await monday.evaluateAll((nodes) => nodes.map((node) => ({
      start: node.getAttribute('data-start'),
      left: node.style.left,
      width: node.style.width,
    })));
    const early = positions.find((item) => item.start === '540');
    const later = positions.find((item) => item.start === '600');
    expect(early && early.width).toBeTruthy();
    expect(later && later.width).toBeTruthy();
    expect(early.left).not.toBe(later.left);
  });
});
