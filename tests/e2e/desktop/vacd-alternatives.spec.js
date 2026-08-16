'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');

// Official SUIS rule (VACD):
//   "Only one of the following course pairs will be counted towards the degree:
//    'VA 301 or VA 303', 'VA 401 or VA 403', 'VA 300 or PROJ 300'. All the
//    other courses are required."
//
// Two consequences, and they pull in opposite directions:
//   - The KEPT course of each pair occupies its required slot, so taking both
//     must not cost the student required credits.
//   - The EXTRA is not counted towards the degree AT ALL. Note SUIS says
//     exactly what it means elsewhere: ME's rule explicitly redirects its extra
//     to "Core Elective". VACD's does not, so the extra is excluded outright —
//     it does not get to fill a free-elective slot.
//
// The named required set is credit-tight:
//   VA201(4) + VA203(4) + VA300(0) + one of VA301/VA303(3) + one of VA401/VA403(4)
//   = 15 = the VACD `required` requirement.
// That tightness is what made the old post-cascade implementation wrong: the
// cascade capped `required` at 15 and pushed the surplus into the elective
// pools, then the pair rule demoted a course afterwards — freeing a required
// slot that nothing refilled. It only showed up for SOME course orderings,
// which is why these tests assert the same result across several of them.
const ENTRY = 'Fall 2024-2025';
const PAIRS = [['VA301', 'VA303'], ['VA401', 'VA403']];
const ALL_REQUIRED = ['VA201', 'VA203', 'VA300', 'VA301', 'VA303', 'VA401', 'VA403'];
const VACD_REQUIRED_CREDITS = 15;

// The same course set in different chronological orders. Every one of these is
// a student who has completed every named required course, so every one must
// reach the required threshold.
const ORDERINGS = {
  'catalog order': ['VA201', 'VA203', 'VA300', 'VA301', 'VA303', 'VA401', 'VA403'],
  'pairs taken first': ['VA401', 'VA403', 'VA301', 'VA303', 'VA201', 'VA203', 'VA300'],
  'extras taken last': ['VA201', 'VA203', 'VA300', 'VA301', 'VA401', 'VA303', 'VA403'],
  'interleaved': ['VA303', 'VA201', 'VA403', 'VA300', 'VA203', 'VA301', 'VA401'],
};

const termFor = (i) => `${i % 2 ? 'Spring' : 'Fall'} ${2020 + Math.floor(i / 2)}-${2021 + Math.floor(i / 2)}`;

const allocate = async (page, order) => {
  await seedPlan(page, {
    major: 'VACD',
    entryTerm: ENTRY,
    curriculum: order.map((c) => [c]),
    grades: order.map(() => ['A']),
    dates: order.map((_, i) => termFor(i)),
  });
  return page.evaluate((all) => {
    const s = window.curriculum.semesters;
    const eff = {};
    s.forEach((x) => x.courses.forEach((c) => { if (all.includes(c.code)) eff[c.code] = c.effective_type; }));
    return { required: s.reduce((a, x) => a + (x.totalRequired || 0), 0), eff };
  }, ALL_REQUIRED);
};

test.describe('VACD alternative-pair rule', () => {
  for (const [label, order] of Object.entries(ORDERINGS)) {
    test(`taking both of each pair still meets required — ${label}`, async ({ page }) => {
      const r = await allocate(page, order);

      // The whole point: a student holding every required course reaches the
      // threshold no matter what order they took them in.
      expect(r.required, `VACD required credits (${label})`).toBeGreaterThanOrEqual(VACD_REQUIRED_CREDITS);

      // Exactly one of each pair holds the required slot; the extra counts
      // toward nothing ('none'), NOT toward a free elective.
      for (const [a, b] of PAIRS) {
        const types = [r.eff[a], r.eff[b]];
        expect(
          types.filter((t) => t === 'required'),
          `${a}/${b}: exactly one should be required (got ${types})`,
        ).toHaveLength(1);
        expect(types, `${a}/${b}: the extra should not count towards the degree`).toContain('none');
      }

      // VA300 carries 0 credits, so it can never fill a pool and must not be
      // reallocated out of `required` by the overflow cascade.
      expect(r.eff.VA300, 'VA300 (0 credits) should stay required').toBe('required');
    });
  }

  test('allocation is identical across orderings', async ({ page }) => {
    const results = {};
    for (const [label, order] of Object.entries(ORDERINGS)) {
      results[label] = await allocate(page, order);
    }
    // Per-course types can legitimately differ (which member of a pair is kept
    // depends on which was taken first), but the required TOTAL may not.
    const totals = Object.entries(results).map(([label, r]) => `${label}=${r.required}`);
    const distinct = new Set(Object.values(results).map((r) => r.required));
    expect(distinct.size, `required total must not depend on course order (${totals.join(', ')})`).toBe(1);
  });
});
