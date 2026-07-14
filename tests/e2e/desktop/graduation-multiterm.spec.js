'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');
const plans = require('../fixtures/passing-plans-multiterm.json');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const readReqs = (term) => Object.fromEntries(
  fs.readFileSync(path.join(ROOT, 'requirements', `${term}.jsonl`), 'utf8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((d) => [d.major, d]),
);
const termName = (code) => {
  const y = Number(code.slice(0, 4));
  const season = { '01': 'Fall', '02': 'Spring', '03': 'Summer' }[code.slice(4)];
  return `${season} ${y}-${y + 1}`;
};

// Runs the per-major requirement engine across several frozen terms, spanning
// pre-2025 and 2025+ admits (so the is2025Plus special-case branches — ME
// CS404/CS412, the 2025+ math exclusion — are exercised too). Robust assertion:
// canGraduate never throws and the allocation fills the two most reliable
// categories (required = named courses, university) to threshold for every
// (term, major) combination.
test.describe('per-major graduation engine across frozen terms', () => {
  for (const [term, majors] of Object.entries(plans)) {
    const reqs = readReqs(term);
    for (const [major, courses] of Object.entries(majors)) {
      test(`${term} ${major}: allocation runs and meets required + university`, async ({ page }) => {
        await seedPlan(page, {
          major,
          entryTerm: termName(term),
          curriculum: [courses],
          grades: [courses.map(() => 'A')],
          dates: [termName(term)],
        });
        const r = await page.evaluate(() => {
          const s = window.curriculum.semesters;
          const sum = (f) => s.reduce((a, x) => a + (x[f] || 0), 0);
          return {
            flag: window.curriculum.canGraduate(),
            required: sum('totalRequired'),
            university: sum('totalUniversity'),
          };
        });
        const req = reqs[major];
        expect(typeof r.flag, `${term} ${major} flag type`).toBe('number');
        expect(r.required, `${term} ${major} required`).toBeGreaterThanOrEqual(req.required);
        expect(r.university, `${term} ${major} university`).toBeGreaterThanOrEqual(req.university);
      });
    }
  }
});
