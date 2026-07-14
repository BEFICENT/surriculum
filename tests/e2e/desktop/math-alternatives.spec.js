'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');
const { CS_PASSING_PLAN } = require('../helpers/passing-plan');

// Official SUIS rule (pre-2025 CS admits): a student completes EITHER MATH212
// OR MATH201. If both are completed, the extra one is excluded from the core,
// area and free elective pools — it counts toward nothing, and the other fills
// the math slot inside `required`. So a plan that is otherwise complete must
// still graduate when it happens to contain both.
test.describe('MATH201 / MATH212 alternative rule (desktop)', () => {
  test('completing both still counts one toward required and graduates', async ({ page }) => {
    // The passing plan already contains MATH201; add MATH212 so both are present.
    const both = [...CS_PASSING_PLAN, 'MATH212'];
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [both],
      grades: [both.map(() => 'A')],
      dates: ['Fall 2024-2025'],
    });

    const r = await page.evaluate(() => {
      const sems = window.curriculum.semesters;
      const sum = (f) => sems.reduce((a, s) => a + (s[f] || 0), 0);
      const eff = {};
      sems.forEach((s) => s.courses.forEach((c) => {
        if (c.code === 'MATH201' || c.code === 'MATH212') eff[c.code] = c.effective_type;
      }));
      return { flag: window.curriculum.canGraduate(), required: sum('totalRequired'), eff };
    });

    // The math slot is filled (MATH212 is 4cr, so required is 30 here), the
    // requirement is met, and the plan graduates.
    expect(r.required).toBeGreaterThanOrEqual(29);
    expect(r.flag).toBe(0);

    // MATH212 (the kept course) counts toward required; MATH201 (the extra) is
    // excluded entirely (effective_type 'none') and NOT dumped into the free pool.
    expect(r.eff.MATH212).toBe('required');
    expect(r.eff.MATH201).toBe('none');
  });
});
