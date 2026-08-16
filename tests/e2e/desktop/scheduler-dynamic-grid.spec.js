'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');
const { openScheduler } = require('../helpers/scheduler');

const TERM = '202403';

async function seedScheduler(page, selected = {}, blocked = [], term = TERM) {
  await seedPlan(page, {
    major: 'CS',
    entryTerm: 'Fall 2024-2025',
    curriculum: [],
    grades: [],
    dates: [],
    schedulerSelectedTerm: term,
    schedulerStates: {
      [term]: { selected, blocked },
    },
  });
}

test.describe('scheduler dynamic weekend and late grid (desktop)', () => {
  test('off-grid results extend only while their exact section is previewed', async ({ page }) => {
    await seedScheduler(page);
    const modal = await openScheduler(page);

    // This frozen term contains weekend and 22:00 classes, but merely loading it
    // must leave the normal Monday-Friday, 08:40-19:40 grid unchanged.
    await expect(modal).toHaveAttribute('data-grid-days', 'MTWRF');
    await expect(modal).toHaveAttribute('data-grid-minutes', '660');
    await expect(modal.locator('.scheduler-grid-day[data-day="S"]')).toBeHidden();

    await modal.locator('.scheduler-search').fill('DA519');
    const card = modal.locator('.scheduler-course[data-course="DA519"]');
    await expect(card).toBeVisible();
    await card.hover();

    // DA519/30192 meets Wednesday 19:00-22:00 and Saturday 13:00-16:00.
    await expect(modal).toHaveAttribute('data-grid-days', 'MTWRFS');
    await expect(modal).toHaveAttribute('data-grid-minutes', '840');
    await expect(modal.locator('.scheduler-grid-day[data-day="S"]')).toBeVisible();
    await expect(modal.locator('.scheduler-day-col[data-day="W"] .scheduler-block.is-preview[data-end="1320"]')).toHaveCount(1);
    await expect(modal.locator('.scheduler-day-col[data-day="S"] .scheduler-block.is-preview')).toHaveCount(1);

    await modal.locator('.scheduler-results').dispatchEvent('mouseleave');
    await expect(modal.locator('.scheduler-block.is-preview')).toHaveCount(0);
    await expect(modal).toHaveAttribute('data-grid-days', 'MTWRF');
    await expect(modal).toHaveAttribute('data-grid-minutes', '660');
  });

  test('a selected Saturday section keeps the extension until removal', async ({ page }) => {
    await seedScheduler(
      page,
      { DA519: { course_id: 'DA519', crn: '30192' } },
      [{ id: 'sat-block', dayKey: 'S', start: 780, end: 840 }],
    );
    const modal = await openScheduler(page);

    await expect(modal).toHaveAttribute('data-grid-days', 'MTWRFS');
    await expect(modal).toHaveAttribute('data-grid-minutes', '840');
    await expect(modal.locator('.scheduler-day-col[data-day="S"] .scheduler-block[data-course="DA519"]')).toHaveCount(1);
    await expect(modal.locator('.scheduler-day-col[data-day="S"] .scheduler-block-bg[data-block-id="sat-block"]')).toBeVisible();
    await expect(modal.locator('.scheduler-day-col[data-day="S"] .scheduler-block.is-blocked-conflict')).toHaveCount(1);

    await modal.locator('.scheduler-remove[data-course="DA519"]').click();
    await expect(modal).toHaveAttribute('data-grid-days', 'MTWRF');
    await expect(modal).toHaveAttribute('data-grid-minutes', '660');
    await expect(modal.locator('.scheduler-grid-day[data-day="S"]')).toBeHidden();
    // A blocked Saturday alone is retained, but does not expand the UI.
    await expect(modal.locator('.scheduler-block-bg[data-block-id="sat-block"]')).toHaveCount(0);
  });

  test('a late-only selection extends time without adding a weekend', async ({ page }) => {
    await seedScheduler(page, { DA522: { course_id: 'DA522', crn: '30194' } });
    const modal = await openScheduler(page);

    await expect(modal).toHaveAttribute('data-grid-days', 'MTWRF');
    await expect(modal).toHaveAttribute('data-grid-minutes', '840');
    await expect(modal.locator('.scheduler-grid-day[data-day="S"]')).toBeHidden();
    await expect(modal.locator('.scheduler-block[data-course="DA522"][data-end="1320"]')).toHaveCount(2);
  });

  test('a longer blocked range is clipped to the visible late extension', async ({ page }) => {
    await seedScheduler(
      page,
      { ENS204R: { course_id: 'ENS204R', crn: '30108' } },
      [{ id: 'late-block', dayKey: 'M', start: 19 * 60, end: 22 * 60 }],
    );
    const modal = await openScheduler(page);

    // ENS204R ends at 20:30, so the lattice exposes through 20:40. The saved
    // 19:00-22:00 block remains intact but its visible background is clipped.
    await expect(modal).toHaveAttribute('data-grid-minutes', '720');
    const block = modal.locator('.scheduler-block-bg[data-block-id="late-block"]');
    await expect(block).toBeVisible();
    await expect(block).toHaveAttribute('data-start', '1140');
    await expect(block).toHaveAttribute('data-end', '1320');
    await expect(block).toHaveAttribute('data-display-end', '1240');
    await expect(modal.locator('.scheduler-block[data-course="ENS204R"].is-blocked-conflict')).toHaveCount(1);
  });

  test('Saturday and late meetings participate in committed conflicts', async ({ page }) => {
    await seedScheduler(page, {
      DA519: { course_id: 'DA519', crn: '30192' },
      SEC512: { course_id: 'SEC512', crn: '30198' },
    });
    const modal = await openScheduler(page);

    // These two sections overlap once on Wednesday night and once on Saturday.
    await expect(modal.locator('.scheduler-day-col[data-day="W"] .scheduler-block.is-conflict')).toHaveCount(2);
    await expect(modal.locator('.scheduler-day-col[data-day="S"] .scheduler-block.is-conflict')).toHaveCount(2);
    await expect(modal.locator('.scheduler-block.is-conflict')).toHaveCount(4);
  });

  test('historical Sunday meetings follow the same selected-only policy', async ({ page }) => {
    await seedScheduler(
      page,
      { MART822: { course_id: 'MART822', crn: '23134' } },
      [],
      '202402',
    );
    const modal = await openScheduler(page);

    await expect(modal).toHaveAttribute('data-grid-days', 'MTWRFSU');
    await expect(modal.locator('.scheduler-grid-day[data-day="U"]')).toBeVisible();
    await expect(modal.locator('.scheduler-day-col[data-day="U"] .scheduler-block[data-course="MART822"]').first()).toBeVisible();
  });

  test('incomplete meeting data stays neutral and does not expand the grid', async ({ page }) => {
    await seedScheduler(page, {}, [], '201901');
    const modal = await openScheduler(page);

    await modal.locator('.scheduler-search').fill('MFIN550');
    const card = modal.locator('.scheduler-course[data-course="MFIN550"]');
    await expect(card).toBeVisible();
    await expect(card).toHaveClass(/is-time-unknown/);
    await expect(card).not.toHaveClass(/is-available(?:\s|$)/);

    await card.hover();
    await expect(modal.locator('.scheduler-block.is-preview')).toHaveCount(0);
    await expect(modal).toHaveAttribute('data-grid-days', 'MTWRF');
    await expect(modal).toHaveAttribute('data-grid-minutes', '660');
  });
});
