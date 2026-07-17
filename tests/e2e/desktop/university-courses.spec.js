'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');
const plans = require('../fixtures/passing-plans-multiterm.json');

// University Courses are a SHARED rule: every undergrad SUIS page carries the
// identical block. The code implemented a fragment of it, for CS only.
//
//   "All freshman courses (1XX coded courses, including PROJ 201) and SPS 303
//    are required."                                    -> flag 11, every major
//
//   FASS/SBS programs (university 44): "At least 2 of the below listed HUM
//    courses must be taken. First the 2xx coded course, then the 3xx coded
//    course must be taken."                            -> flags 12 + 13
//   FENS programs (university 41): one HUM course.
//
// The HUM rule cannot be a count or a credit check — HUM201 + HUM202 is two HUM
// courses and reaches 44 university credits, yet fails the rule for want of a
// 3xx. It is compositional: one from each level. That is what flags 12 and 13
// were always for; only the 12 half was ever written, leaving 13 dead.
const TERM = '202501';
const TERM_NAME = 'Fall 2025-2026';

const HUM_2XX = ['HUM201', 'HUM202', 'HUM207'];
const HUM_3XX = ['HUM311', 'HUM312', 'HUM317', 'HUM321', 'HUM322', 'HUM371'];

// SUIS-confirmed: these five require one 2xx AND one 3xx.
const TWO_HUM_MAJORS = ['ECON', 'MAN', 'PSIR', 'PSY', 'VACD'];

const seed = (page, major, drop = []) => {
  const courses = plans[TERM][major].filter((c) => !drop.includes(c));
  return seedPlan(page, {
    major,
    entryTerm: TERM_NAME,
    curriculum: [courses],
    grades: [courses.map(() => 'A')],
    dates: [TERM_NAME],
  });
};

const flag = (page) => page.evaluate(() => window.curriculum.canGraduate());

test.describe('SPS 303 is required for every undergrad program', () => {
  // Previously checked for CS only, so a non-CS student missing SPS 303 was
  // told they could graduate.
  for (const major of ['CS', 'ECON', 'PSIR', 'VACD', 'DSA', 'MAN']) {
    test(`${major}: dropping SPS 303 raises flag 11`, async ({ page }) => {
      expect(plans[TERM][major], 'fixture should carry SPS303').toContain('SPS303');
      await seed(page, major, ['SPS303']);
      expect(await flag(page)).toBe(11);
    });
  }
});

test.describe('HUM requirement (FASS/SBS programs need a 2xx AND a 3xx)', () => {
  for (const major of TWO_HUM_MAJORS) {
    test(`${major}: no 3xx HUM raises flag 13`, async ({ page }) => {
      // The case the maintainer flagged: keep the 2xx courses, drop every 3xx.
      // The student still holds two HUM courses and their university credits,
      // and is still short of the rule.
      await seed(page, major, HUM_3XX);
      expect(await flag(page), `${major} should require a 3xx HUM`).toBe(13);
    });

    test(`${major}: no 2xx HUM raises flag 12`, async ({ page }) => {
      await seed(page, major, HUM_2XX);
      expect(await flag(page), `${major} should require a 2xx HUM`).toBe(12);
    });
  }

  test('two 2xx HUM courses do not satisfy the rule', async ({ page }) => {
    // The exact trap: HUM201 + HUM202 = two HUM courses, university credits met,
    // rule unmet. A count-based check would pass this.
    const courses = plans[TERM].ECON.filter((c) => !HUM_3XX.includes(c) && c !== 'HUM207');
    const has2xx = courses.filter((c) => HUM_2XX.includes(c));
    expect(has2xx.length, 'the plan should still hold two 2xx HUM courses').toBe(2);

    await seedPlan(page, {
      major: 'ECON',
      entryTerm: TERM_NAME,
      curriculum: [courses],
      grades: [courses.map(() => 'A')],
      dates: [TERM_NAME],
    });

    const university = await page.evaluate(
      () => window.curriculum.semesters.reduce((a, s) => a + (s.totalUniversity || 0), 0),
    );
    expect(university, 'university credits are still met').toBeGreaterThanOrEqual(44);
    expect(await flag(page), 'yet the HUM rule is not').toBe(13);
  });

  test('FENS programs are not held to the two-level rule', async ({ page }) => {
    // DSA needs one HUM ("One of the HUM coded course listed below is
    // required"), so dropping the 3xx courses must not flag it.
    await seed(page, 'DSA', HUM_3XX);
    const f = await flag(page);
    expect([12, 13], `DSA got flag ${f}; FENS programs need one HUM, not one of each`).not.toContain(f);
  });
});

test.describe('CS accepts any HUM, not only a 2xx', () => {
  // SUIS (CS, a FENS 1-HUM program): "One of the HUM coded course listed below
  // is required" — the list is all nine, 2xx AND 3xx. The check used to demand a
  // 2xx, so a CS student whose single HUM was a 3xx reached university=41 yet was
  // told they had not met their HUM.
  const { seedPlan: seedFull } = require('../helpers/plan');
  const { CS_PASSING_PLAN } = require('../helpers/passing-plan');

  const seedCsHum = (page, hum) => {
    const courses = CS_PASSING_PLAN
      .filter((c) => !['HUM201', 'HUM202', 'HUM207'].includes(c))
      .concat(hum ? [hum] : []);
    return seedFull(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [courses],
      grades: [courses.map(() => 'A')],
      dates: ['Fall 2024-2025'],
    });
  };

  test('a single 3xx HUM satisfies the requirement (was wrongly flag 12)', async ({ page }) => {
    await seedCsHum(page, 'HUM311');
    const r = await page.evaluate(() => ({
      flag: window.curriculum.canGraduate(),
      university: window.curriculum.semesters.reduce((a, s) => a + (s.totalUniversity || 0), 0),
    }));
    expect(r.university, 'a 3cr HUM keeps university at threshold').toBeGreaterThanOrEqual(41);
    expect(r.flag, 'HUM311 alone should satisfy the HUM requirement').toBe(0);
  });

  test('no HUM at all is caught by university credits (flag 1), never a HUM flag', async ({ page }) => {
    // With zero HUM the student is short on university credits, so the generic
    // check binds first — the HUM flag is effectively unreachable, which is fine.
    await seedCsHum(page, null);
    const r = await page.evaluate(() => ({
      flag: window.curriculum.canGraduate(),
      university: window.curriculum.semesters.reduce((a, s) => a + (s.totalUniversity || 0), 0),
    }));
    expect(r.university, 'without a HUM, university is short of 41').toBeLessThan(41);
    expect(r.flag, 'so flag 1 (university credits) binds, not a HUM flag').toBe(1);
  });
});
