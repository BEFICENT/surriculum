'use strict';

const { test, expect } = require('../fixtures');
const { seedGradPlan } = require('../helpers/passing-plan');

const flag = (page) => page.evaluate(() => window.curriculum.canGraduate());

// canGraduate() returns 0 when every requirement is met, else a positive flag
// for the FIRST unmet one. Starting from a complete plan and dropping exactly
// one thing isolates individual checks. Frozen term 202401.
test.describe('graduation requirement branches (desktop)', () => {
  test('a complete plan graduates (flag 0)', async ({ page }) => {
    await seedGradPlan(page);
    expect(await flag(page)).toBe(0);
  });

  test('missing the internship course (CS395) flags 4', async ({ page }) => {
    await seedGradPlan(page, { drop: ['CS395'] });
    expect(await flag(page)).toBe(4);
  });

  test('dropping a required course flags 2 (required credits short)', async ({ page }) => {
    await seedGradPlan(page, { drop: ['CS301'] });
    expect(await flag(page)).toBe(2);
  });

  test('CGPA below 2.00 flags 38', async ({ page }) => {
    // All-D still earns credits (only F is excluded), so every credit
    // requirement is met and the GPA gate is what fails.
    await seedGradPlan(page, { grade: 'D' });
    expect(await flag(page)).toBe(38);
  });

  test('missing SPS303 flags 11 (CS-specific)', async ({ page }) => {
    await seedGradPlan(page, { drop: ['SPS303'] });
    expect(await flag(page)).toBe(11);
  });

  // Notes on branches deliberately not asserted here:
  // - Required (flag 2) is testable by dropping ONE required course because the
  //   required pool is a small fixed set that can't be backfilled. Core/area/
  //   free (flags 3/6/7) are NOT: dropping one elective just lets another
  //   eligible course backfill the pool, so isolating them needs dropping the
  //   whole backfill set (fragile), and is skipped.
  // - HUM (flag 12) is effectively unreachable with the 202401 data: the
  //   non-HUM university courses total only 38 credits, so meeting the 41-credit
  //   university requirement forces a HUM course, which satisfies the check.
});
