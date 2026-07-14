'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');
const plans = require('../fixtures/passing-plans-multiterm.json');

// KNOWN BUG — same class as the MATH201/212 fix (commit 29d6186), found by the
// multi-term graduation sweep. For ME 2025+ admits, "CS404 OR CS412 is
// required"; a student who completes BOTH should still graduate (one counts as
// required, the other as core). But the ME special-case reassigns them AFTER
// the allocation cascade, and its recompute never re-promotes an overflowed
// required course to refill the required cap — so `required` comes out 3 short
// (42 < 45) and canGraduate() wrongly returns flag 2 (required credits short).
//
// The test asserts the CORRECT behavior and is marked test.fail() so it tracks
// the bug without breaking the suite. Remove the .fail() once the ME special-
// case decides the alternative BEFORE the cascade (the way the math fix does).
test.describe('ME CS404/CS412 alternative (2025+)', () => {
  test.fail('completing BOTH CS404 and CS412 still graduates', async ({ page }) => {
    const both = [...plans['202501'].ME, 'CS412']; // plan already has CS404
    await seedPlan(page, {
      major: 'ME',
      entryTerm: 'Fall 2025-2026',
      curriculum: [both],
      grades: [both.map(() => 'A')],
      dates: ['Fall 2025-2026'],
    });
    const flag = await page.evaluate(() => window.curriculum.canGraduate());
    expect(flag).toBe(0);
  });
});
