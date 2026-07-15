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
// CS404/CS412, the 2025+ math exclusion — are exercised too).
//
// Each plan is a greedy credit-complete degree generated from that term's
// catalog, so it clears every generic requirement. That is what makes the
// EXPECTED_FLAG table below useful: canGraduate() returns the FIRST unmet
// requirement, so a credit-complete plan lands squarely on the major-specific
// diversity/named-course branch — pinning branches that are otherwise
// unreachable without a hand-curated fixture per major.
//
// The terms are frozen, so these values are deterministic. Flags:
//   0  = graduates
//   18 = faculty courses must span >= 3 areas
//   19 = >= 2 MATH courses (only MATH201-204 carry the FENS Faculty_Course
//        marker; MATH101/102/212 do NOT count toward this)
//   23 = >= 9 credits of 400-level EE
//   27 = >= 3 FENS courses among core electives
//   35 = core courses must span >= 6 areas
//
// A non-zero value here is CORRECT behaviour on a generically-complete plan,
// not a bug: the generator picks courses to clear credit thresholds and has no
// notion of these diversity rules. The exception is ME/IE at 2025+, where the
// generator wrongly applies CS's 2025+ math exclusion (dropping MATH201/202,
// which no rule excludes for ME/IE) and so hands the engine a plan that really
// does lack its FENS math — a fixture limitation, recorded rather than hidden.
const EXPECTED_FLAG = {
  202301: { BIO: 19, CS: 0, DSA: 27, ECON: 0, EE: 23, IE: 0, MAN: 35, MAT: 19, ME: 0, PSIR: 0, PSY: 18, VACD: 0 },
  202402: { BIO: 19, CS: 0, DSA: 27, ECON: 0, EE: 23, IE: 0, MAN: 35, MAT: 19, ME: 0, PSIR: 0, PSY: 18, VACD: 0 },
  202403: { BIO: 19, CS: 0, DSA: 27, ECON: 0, EE: 23, IE: 0, MAN: 35, MAT: 19, ME: 0, PSIR: 0, PSY: 18, VACD: 0 },
  202501: { BIO: 19, CS: 0, DSA: 27, ECON: 0, EE: 23, IE: 19, MAN: 35, MAT: 19, ME: 19, PSIR: 0, PSY: 18, VACD: 0 },
  202502: { BIO: 19, CS: 0, DSA: 27, ECON: 0, EE: 23, IE: 19, MAN: 35, MAT: 19, ME: 19, PSIR: 0, PSY: 18, VACD: 0 },
};

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
        expect(r.required, `${term} ${major} required`).toBeGreaterThanOrEqual(req.required);
        expect(r.university, `${term} ${major} university`).toBeGreaterThanOrEqual(req.university);
        // Pins the exact first-unmet requirement (see EXPECTED_FLAG above).
        expect(r.flag, `${term} ${major} graduation flag`).toBe(EXPECTED_FLAG[term][major]);
      });
    }
  }
});
