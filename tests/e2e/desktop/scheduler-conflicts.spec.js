'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');
const { openScheduler, pickCourse } = require('../helpers/scheduler');

// These use a FROZEN past term (202401, Fall 2024-2025) so the course hours the
// assertions depend on can't shift when current/future terms are re-scraped.
test.describe('scheduler conflicts + blocked hours (desktop)', () => {
  test('two overlapping sections are flagged as a time conflict', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [],
      grades: [],
      dates: [],
      schedulerSelectedTerm: '202401',
    });

    const modal = await openScheduler(page);

    // AL102 (every section Mon 9:40-11:30) and CS445 (Mon 9:40-11:30) collide on
    // Monday no matter which section is chosen, so the conflict is unavoidable.
    await pickCourse(page, 'AL102');
    await pickCourse(page, 'CS445');

    // Both Monday blocks get flagged; their other meetings (AL102 Tue, CS445 Fri)
    // don't, so exactly the two overlapping blocks are conflicts.
    await expect(modal.locator('.scheduler-block.is-conflict')).toHaveCount(2, { timeout: 10000 });
  });

  test('a committed section overlapping a blocked hour is flagged', async ({ page }) => {
    // Seed a blocked window over Monday 9:40-11:30 (580-690 min) for term 202401.
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [],
      grades: [],
      dates: [],
      schedulerSelectedTerm: '202401',
      schedulerStates: {
        202401: { selected: {}, blocked: [{ id: 'b1', dayKey: 'M', start: 580, end: 690 }] },
      },
    });

    const modal = await openScheduler(page);

    // The blocked window renders on the grid.
    await expect(modal.locator('.scheduler-block-bg').first()).toBeVisible();

    // AL102's Monday meeting (9:40-11:30) sits exactly inside the blocked window,
    // so committing it flags that block as a blocked-hours conflict.
    await pickCourse(page, 'AL102');
    await expect(modal.locator('.scheduler-block.is-blocked-conflict')).toHaveCount(1, { timeout: 10000 });
  });
});
