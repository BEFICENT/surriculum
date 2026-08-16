'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');
const plans = require('../fixtures/passing-plans-multiterm.json');

// DSA's core electives must include at least 3 courses from each of FENS, FASS
// and SBS (flags 27/28/29).
//
// THE BUG THIS PINS: the counts read `Faculty_Course` — the marker for
// membership of the faculty-course pool, which flags 14/20/21/22 in the very
// same block correctly use for a *different* rule — instead of `Faculty`, the
// offering faculty that every course carries. Across DSA's catalog, in ALL 21
// terms:
//
//   by Faculty_Course:  FENS=4   FASS=0   SBS=1    <- flag 28 needs >= 3 FASS
//   by Faculty:         FENS=20  FASS=8   SBS=5
//
// So flag 28 could not be satisfied by ANY course selection in ANY term: no DSA
// student could ever graduate, and the message ("You need at least 3 FASS
// courses in your core electives!") named a set with zero members. The
// multi-term sweep never caught it because DSA stops at flag 27, one check
// earlier — a reminder that pinning a first-unmet flag says nothing about the
// checks behind it.
const TERM = '202301';
const TERM_NAME = 'Fall 2023-2024';

// Core-typed DSA courses, by offering faculty. The generated plan carries three
// FASS ones and NO SBS ones, so SBS is what it lacks.
const SBS_CORE = ['MKTG414', 'OPIM402', 'OPIM408'];
const FASS_CORE_IN_PLAN = ['ECON401', 'ECON494', 'ECON495'];

const seedDsa = (page, { add = [], drop = [] } = {}) => {
  const courses = plans[TERM].DSA.filter((c) => !drop.includes(c)).concat(add);
  return seedPlan(page, {
    major: 'DSA',
    entryTerm: TERM_NAME,
    curriculum: [courses],
    grades: [courses.map(() => 'A')],
    dates: [TERM_NAME],
  });
};

// Recomputes the rule's own inputs. Note it keys off `category` (the STATIC
// catalog type), not effective_type — a core-typed course counts even when the
// cascade overflows it into area/free, so no hoisting is needed here.
const readCore = (page) => page.evaluate(() => {
  let fens = 0, fass = 0, sbs = 0;
  window.curriculum.semesters.forEach((s) => s.courses.forEach((c) => {
    if (c.category !== 'Core') return;
    if (c.Faculty === 'FENS') fens++;
    else if (c.Faculty === 'FASS') fass++;
    else if (c.Faculty === 'SBS') sbs++;
  }));
  return { flag: window.curriculum.canGraduate(), fens, fass, sbs };
});

test.describe('DSA core-elective faculty rules', () => {
  test('all three faculty requirements can be satisfied at once', async ({ page }) => {
    // THE headline guard. Under the old field this was unreachable for every
    // possible plan; if it fails, DSA is ungraduatable again.
    await seedDsa(page, { add: SBS_CORE });
    const r = await readCore(page);

    expect(r.fens, 'FENS core electives').toBeGreaterThanOrEqual(3);
    expect(r.fass, 'FASS core electives').toBeGreaterThanOrEqual(3);
    expect(r.sbs, 'SBS core electives').toBeGreaterThanOrEqual(3);
    expect([27, 28, 29], `flag ${r.flag}: no core-faculty rule should still fire`).not.toContain(r.flag);
  });

  test('too few SBS core electives raises flag 29', async ({ page }) => {
    // The generated plan carries no SBS core elective at all.
    await seedDsa(page);
    const r = await readCore(page);
    expect(r.sbs, 'the generated plan has no SBS core electives').toBeLessThan(3);
    expect(r.flag).toBe(29);
  });

  test('too few FASS core electives raises flag 28', async ({ page }) => {
    // Add the SBS ones so 29 cannot mask 28 — the failure must be the FASS rule.
    await seedDsa(page, { add: SBS_CORE, drop: FASS_CORE_IN_PLAN });
    const r = await readCore(page);
    expect(r.fass, 'FASS core electives after dropping the plan\'s three').toBeLessThan(3);
    expect(r.flag).toBe(28);
  });

  test('the faculty-course rules keep using Faculty_Course, not Faculty', async ({ page }) => {
    // Flags 14/20/21/22 are about the FACULTY-COURSE POOL and were always right.
    // The fix must not have swept them along: they count a different attribute
    // for a different rule, and conflating the two is the bug itself.
    await seedDsa(page, { add: SBS_CORE });
    const counts = await page.evaluate(() => {
      let facultyCourses = 0, byFacultyField = 0;
      window.curriculum.semesters.forEach((s) => s.courses.forEach((c) => {
        if (c.Faculty_Course && c.Faculty_Course !== 'No') facultyCourses++;
        if (c.Faculty) byFacultyField++;
      }));
      return { facultyCourses, byFacultyField };
    });
    // Every course has a Faculty; only a small minority are faculty courses. If
    // these ever converge, the two attributes have been conflated.
    expect(counts.facultyCourses, 'faculty courses are a small subset').toBeLessThan(counts.byFacultyField);
    expect(counts.facultyCourses, 'the plan does carry some faculty courses').toBeGreaterThan(0);
  });
});
