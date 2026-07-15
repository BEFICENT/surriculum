'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');
const { openScheduler } = require('../helpers/scheduler');

// Drag-to-block: the user clicks "Block hours", then click+drags on a day column
// to mark time as unavailable. Previously untested end to end — the existing
// blocked-hours coverage seeds the state directly, so nothing exercised the
// mouse interaction that produces it, nor the snapping and merging it applies.
//
// Frozen term 202401 throughout: nothing here depends on course hours, but the
// scheduler needs a real term index to render its grid.
const TERM = '202401';
const TERM_NAME = 'Fall 2024-2025';

// scheduler.js: the grid starts at 08:40 and blocks snap to that hour lattice —
// so boundaries fall at 08:40, 09:40, 10:40 ... NOT on the clock hour.
const DAY_START_MIN = 8 * 60 + 40; // 520

async function openGrid(page) {
  await seedPlan(page, {
    major: 'CS',
    entryTerm: TERM_NAME,
    curriculum: [],
    grades: [],
    dates: [],
    schedulerSelectedTerm: TERM,
  });
  const modal = await openScheduler(page);
  await expect(modal.locator('.scheduler-day-col[data-day="M"]')).toBeVisible({ timeout: 10000 });
  return modal;
}

// Inverse of the page's pointerYToMinute(): minute -> viewport y.
// pointerYToMinute is DAY_START_MIN + ((clientY - gridTop + scrollTop - topGap) / pxPerMin).
async function minuteToY(page, minute) {
  return page.evaluate(({ min, dayStart }) => {
    const grid = document.querySelector('.scheduler-grid');
    const cs = getComputedStyle(grid);
    const num = (v, d) => (Number.isFinite(parseFloat(v)) ? parseFloat(v) : d);
    const pxPerMin = num(cs.getPropertyValue('--scheduler-minute'), 1.05);
    const topGapPx = num(cs.getPropertyValue('--scheduler-top-gap'), 14);
    const rect = grid.getBoundingClientRect();
    return rect.top - (grid.scrollTop || 0) + topGapPx + ((min - dayStart) * pxPerMin);
  }, { min: minute, dayStart: DAY_START_MIN });
}

async function colX(page, dayKey) {
  return page.evaluate((d) => {
    const col = document.querySelector(`.scheduler-day-col[data-day="${d}"]`);
    const r = col.getBoundingClientRect();
    return r.left + r.width / 2;
  }, dayKey);
}

// Drag on a day column between two minute offsets.
async function dragBlock(page, dayKey, fromMin, toMin) {
  const x = await colX(page, dayKey);
  const y1 = await minuteToY(page, fromMin);
  const y2 = await minuteToY(page, toMin);
  await page.mouse.move(x, y1);
  await page.mouse.down();
  // At least one intermediate move: updateBlockDrag() is what records the range,
  // and a down->up with no move leaves the default 1-hour block.
  await page.mouse.move(x, (y1 + y2) / 2);
  await page.mouse.move(x, y2);
  await page.mouse.up();
}

// The blocked ranges the feature actually persists, for the active term.
const readBlocked = (page) => page.evaluate((term) => {
  const raw = window.planStorage.getItem(`schedulerState_${term}`);
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  const list = Array.isArray(parsed.blocked) ? parsed.blocked : [];
  return list
    .map((b) => ({ dayKey: b.dayKey, start: b.start, end: b.end }))
    .sort((a, b) => (a.dayKey === b.dayKey ? a.start - b.start : a.dayKey.localeCompare(b.dayKey)));
}, TERM);

const enableBlockMode = async (page, modal) => {
  await modal.locator('.scheduler-blocked-toggle').click();
  await expect(modal.locator('.scheduler-blocked-toggle')).toHaveText(/Exit block mode/i);
};

test.describe('scheduler drag-to-block', () => {
  test('dragging does nothing until block mode is on', async ({ page }) => {
    await openGrid(page);
    // Block mode defaults off, so the grid must ignore the drag entirely —
    // otherwise a user dragging to scroll would blank out their day.
    await dragBlock(page, 'M', DAY_START_MIN, DAY_START_MIN + 120);
    expect(await readBlocked(page), 'no block should be created without block mode').toEqual([]);
  });

  test('a drag creates one blocked range, snapped to the hour lattice', async ({ page }) => {
    const modal = await openGrid(page);
    await enableBlockMode(page, modal);

    // Start mid-cell and end mid-cell: start snaps DOWN, end snaps UP, so the
    // result should cover the whole 2 hours the pointer touched.
    await dragBlock(page, 'M', DAY_START_MIN + 20, DAY_START_MIN + 100);

    expect(await readBlocked(page)).toEqual([
      { dayKey: 'M', start: DAY_START_MIN, end: DAY_START_MIN + 120 },
    ]);
  });

  test('a click with no drag blocks a single hour', async ({ page }) => {
    const modal = await openGrid(page);
    await enableBlockMode(page, modal);

    const x = await colX(page, 'W');
    const y = await minuteToY(page, DAY_START_MIN + 70); // inside the 2nd hour cell
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.up();

    // Snapping is floor-based, so a click in the lower half of a cell must select
    // that cell, not the next one.
    expect(await readBlocked(page)).toEqual([
      { dayKey: 'W', start: DAY_START_MIN + 60, end: DAY_START_MIN + 120 },
    ]);
  });

  test('a drag cannot start on top of an existing blocked range', async ({ page }) => {
    const modal = await openGrid(page);
    await enableBlockMode(page, modal);
    await dragBlock(page, 'T', DAY_START_MIN, DAY_START_MIN + 120);

    // Blocked ranges render as `.scheduler-block-bg`, and startBlockDrag bails
    // out on that target by design. So a drag beginning inside an existing block
    // is a no-op, not a new range.
    await dragBlock(page, 'T', DAY_START_MIN + 30, DAY_START_MIN + 180);

    expect(await readBlocked(page), 'the second drag should have been ignored').toEqual([
      { dayKey: 'T', start: DAY_START_MIN, end: DAY_START_MIN + 120 },
    ]);
  });

  test('overlapping ranges on the same day merge into one', async ({ page }) => {
    const modal = await openGrid(page);
    await enableBlockMode(page, modal);

    await dragBlock(page, 'T', DAY_START_MIN, DAY_START_MIN + 120);
    // Must START outside the existing block (see the test above), so drag
    // upward from below it: 700 -> 580 overlaps 520-640 and should merge.
    await dragBlock(page, 'T', DAY_START_MIN + 180, DAY_START_MIN + 60);

    expect(await readBlocked(page), 'the two overlapping ranges should merge').toEqual([
      { dayKey: 'T', start: DAY_START_MIN, end: DAY_START_MIN + 180 },
    ]);
  });

  test('ranges on different days stay separate', async ({ page }) => {
    const modal = await openGrid(page);
    await enableBlockMode(page, modal);

    // Same hours, different days: merging is per-day, so these must not combine.
    await dragBlock(page, 'M', DAY_START_MIN, DAY_START_MIN + 60);
    await dragBlock(page, 'F', DAY_START_MIN, DAY_START_MIN + 60);

    expect(await readBlocked(page)).toEqual([
      { dayKey: 'F', start: DAY_START_MIN, end: DAY_START_MIN + 60 },
      { dayKey: 'M', start: DAY_START_MIN, end: DAY_START_MIN + 60 },
    ]);
  });

  test('blocked ranges render on the grid, and Clear asks before wiping them', async ({ page }) => {
    const modal = await openGrid(page);
    await enableBlockMode(page, modal);

    await dragBlock(page, 'R', DAY_START_MIN, DAY_START_MIN + 120);
    await expect(modal.locator('.scheduler-day-col[data-day="R"] .scheduler-block.is-blocked')).toHaveCount(1);
    await expect(modal.locator('.scheduler-blocked-item')).toHaveCount(1);

    // Clear is destructive, so it confirms first — and cancelling must keep the
    // blocks.
    await modal.locator('.scheduler-blocked-clear').click();
    await page.locator('.scheduler-picker-modal button', { hasText: 'Cancel' }).click();
    expect(await readBlocked(page), 'cancelling must not clear anything').toHaveLength(1);

    await modal.locator('.scheduler-blocked-clear').click();
    await page.locator('.scheduler-picker-modal button', { hasText: /^Clear$/ }).click();

    await expect(modal.locator('.scheduler-block.is-blocked')).toHaveCount(0);
    await expect(modal.locator('.scheduler-blocked-item')).toHaveCount(0);
    expect(await readBlocked(page), 'Clear should empty the persisted state too').toEqual([]);
  });

  test('clicking a blocked range in block mode unblocks it', async ({ page }) => {
    const modal = await openGrid(page);
    await enableBlockMode(page, modal);
    await dragBlock(page, 'W', DAY_START_MIN, DAY_START_MIN + 60);
    await dragBlock(page, 'F', DAY_START_MIN, DAY_START_MIN + 60);
    expect(await readBlocked(page)).toHaveLength(2);

    await modal.locator('.scheduler-day-col[data-day="W"] .scheduler-block.scheduler-block-bg').click();
    await page.locator('.scheduler-picker-modal button', { hasText: /Unblock|Remove|Yes/i }).first().click();

    // Only the clicked day's range goes.
    expect(await readBlocked(page)).toEqual([
      { dayKey: 'F', start: DAY_START_MIN, end: DAY_START_MIN + 60 },
    ]);
  });
});
