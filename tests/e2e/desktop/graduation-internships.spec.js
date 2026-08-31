'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');
const plans = require('../test-data/passing-plans-multiterm.json');

// Captured from the official Fall 2025-2026 SUIS Required Courses pages on
// 2026-07-23. CS395 already has a dedicated branch test; these are the other six
// internship-bearing programs. Each internship is zero-credit, so removing it
// leaves every credit threshold untouched and isolates canGraduate() flag 4.
const TERM = '202501';
const TERM_NAME = 'Fall 2025-2026';
const ROOT = path.resolve(__dirname, '..', '..', '..');
const reqs = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, 'requirements', `${TERM}.jsonl`), 'utf8')
    .split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)).map((row) => [row.major, row]),
);

const CASES = [
  ['BIO', 'BSBIO', 'BIO395'],
  ['DSA', 'BSDSA', 'DSA395'],
  ['EE', 'BSEE', 'EE395'],
  ['IE', 'BSMS', 'IE395'],
  ['MAT', 'BSMAT', 'MAT395'],
  ['ME', 'BSME', 'ME395'],
];

const sourceUrl = (program) => (
  'https://suis.sabanciuniv.edu/prod/SU_DEGREE.p_degree_detail'
  + `?P_PROGRAM=${program}&P_LANG=EN&P_LEVEL=UG&P_TERM=${TERM}&P_SUBMIT=Select`
);

test.describe('live-backed internship requirements (202501)', () => {
  for (const [major, program, internship] of CASES) {
    test(`${major}: missing ${internship} raises flag 4`, async ({ page }) => {
      expect(reqs[major].internshipCourse, sourceUrl(program)).toBe(internship);
      expect(plans[TERM][major], `${major} fixture must contain ${internship}`).toContain(internship);

      const courses = plans[TERM][major].filter((code) => code !== internship);
      await seedPlan(page, {
        major,
        entryTerm: TERM_NAME,
        curriculum: [courses],
        grades: [courses.map(() => 'A')],
        dates: [TERM_NAME],
      });

      expect(await page.evaluate(() => window.curriculum.canGraduate())).toBe(4);
    });
  }
});
