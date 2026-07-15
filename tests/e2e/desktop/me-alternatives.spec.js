'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');
const plans = require('../fixtures/passing-plans-multiterm.json');

// Official SUIS rule (ME, 2025+ admits):
//   "ME403 or ME425" is required. If both are taken, the extra counts toward
//   the Core Elective requirement.
//   "CS404 or CS412" is required. If both are taken, the extra counts toward
//   the Core Elective requirement.
// In the 2025+ catalog all four are EL_Type `required`, so taking both of a
// pair must NOT cost the student required credits — the extra simply becomes a
// core elective.
const TERM = '202501';
const TERM_NAME = 'Fall 2025-2026';
const ME_REQUIRED = 45;

test.describe('ME alternative-pair rule (2025+)', () => {
  test('taking both of each pair keeps required met and sends the extra to core', async ({ page }) => {
    // The generated ME plan contains every required course, so it contains BOTH
    // members of both alternative pairs.
    const courses = plans[TERM].ME;
    for (const c of ['ME403', 'ME425', 'CS404', 'CS412']) {
      expect(courses, `fixture should contain ${c}`).toContain(c);
    }

    await seedPlan(page, {
      major: 'ME',
      entryTerm: TERM_NAME,
      curriculum: [courses],
      grades: [courses.map(() => 'A')],
      dates: [TERM_NAME],
    });

    const r = await page.evaluate(() => {
      const s = window.curriculum.semesters;
      const sum = (f) => s.reduce((a, x) => a + (x[f] || 0), 0);
      const eff = {};
      s.forEach((x) => x.courses.forEach((c) => {
        if (['ME403', 'ME425', 'CS404', 'CS412'].includes(c.code)) eff[c.code] = c.effective_type;
      }));
      return { required: sum('totalRequired'), eff };
    });

    // The required pool must still reach its threshold — taking the extra
    // course of a pair must not cost required credits.
    expect(r.required, 'ME required credits').toBeGreaterThanOrEqual(ME_REQUIRED);

    // Exactly one of each pair occupies a required slot; the extra does not —
    // it enters the elective pools as a Core Elective (and may then overflow to
    // area/free via the standard cascade if core is already satisfied, as it is
    // in this fully-loaded plan).
    const pairCheck = (a, b, label) => {
      const types = [r.eff[a], r.eff[b]];
      expect(types.filter((t) => t === 'required'), `${label}: exactly one should be required (got ${types})`).toHaveLength(1);
      const extra = types.find((t) => t !== 'required');
      expect(['core', 'area', 'free'], `${label}: extra should be an elective, got "${extra}"`).toContain(extra);
    };
    pairCheck('ME403', 'ME425', 'ME403/ME425');
    pairCheck('CS404', 'CS412', 'CS404/CS412');
  });
});
