'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');
const plans = require('../fixtures/passing-plans-202401.json');

// Requirement thresholds per major (frozen term 202401).
const REQS = Object.fromEntries(
  fs.readFileSync(path.join(__dirname, '..', '..', '..', 'requirements', '202401.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((d) => [d.major, d]),
);

// Majors whose credit-greedy complete plan ALSO clears the major-specific
// diversity / named-course checks (distinct areas, FENS-core counts, 400-level
// credits, ...), so it graduates outright. The others are complete on credits
// but their diversity requirements aren't satisfiable by a generic generator;
// asserting the credit engine there is still the point.
//
// IE is NOT in this set despite being credit-complete. Its SUIS math rule
// ("either MATH 212 or MATH 201") excludes the extra from every pool, including
// the faculty-course tally — and this fixture happens to hold MATH201 + MATH212
// with MATH203 as its only other FENS-marked maths, so excluding MATH201 leaves
// one where flag 19 wants two. A property of the generated plan (a real student
// would also hold MATH204), not of the engine.
const FULLY_GRADUATES = new Set(['CS', 'ECON', 'ME']);

// Sweeps every major's requirement thresholds through recalcEffectiveTypes +
// canGraduate — the class of code the MATH201/212 bug lived in.
test.describe('per-major graduation engine (202401)', () => {
  for (const [major, courses] of Object.entries(plans)) {
    test(`${major}: allocation satisfies every credit requirement`, async ({ page }) => {
      await seedPlan(page, {
        major,
        entryTerm: 'Fall 2024-2025',
        curriculum: [courses],
        grades: [courses.map(() => 'A')],
        dates: ['Fall 2024-2025'],
      });

      const r = await page.evaluate(() => {
        const s = window.curriculum.semesters;
        const sum = (f) => s.reduce((a, x) => a + (x[f] || 0), 0);
        return {
          flag: window.curriculum.canGraduate(),
          university: sum('totalUniversity'),
          required: sum('totalRequired'),
          core: sum('totalCore'),
          area: sum('totalArea'),
          free: sum('totalFree'),
          total: sum('totalCredit'),
        };
      });

      const req = REQS[major];
      // The allocation engine must fill every SU-credit category to threshold.
      expect(r.university, `${major} university`).toBeGreaterThanOrEqual(req.university);
      expect(r.required, `${major} required`).toBeGreaterThanOrEqual(req.required);
      expect(r.core, `${major} core`).toBeGreaterThanOrEqual(req.core);
      expect(r.area, `${major} area`).toBeGreaterThanOrEqual(req.area);
      expect(r.free, `${major} free`).toBeGreaterThanOrEqual(req.free);
      expect(r.total, `${major} total`).toBeGreaterThanOrEqual(req.total);

      // canGraduate() must return a number (never throw) for every major.
      expect(typeof r.flag, `${major} flag type`).toBe('number');

      if (FULLY_GRADUATES.has(major)) {
        expect(r.flag, `${major} should graduate`).toBe(0);
      }
    });
  }
});
