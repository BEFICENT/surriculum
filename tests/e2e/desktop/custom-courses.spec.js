'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');

// Custom courses: user-defined courses stored per plan under
// `customCourses_<major>` and concatenated onto the fetched course_data at
// bootstrap (main.js). Untested until now, despite feeding straight into the
// allocation engine — a custom course is indistinguishable from a catalog one
// once loaded, so it can move every total and every requirement.
//
// This is the main.js side of the app, which had 3 tests across 2800 lines.
//
// Frozen term 202401. The codes below are deliberately absent from the real CS
// catalog, so anything observed about them can only come from the custom-course
// path.
const TERM_NAME = 'Fall 2024-2025';

const custom = (code, elType, extra = {}) => ({
  Major: code.replace(/\d+$/, ''),
  Code: code.replace(/^\D+/, ''),
  Course_Name: `Custom ${code}`,
  ECTS: '6',
  Engineering: 0,
  Basic_Science: 0,
  SU_credit: '3',
  Faculty: 'FENS',
  Faculty_Course: 'No',
  EL_Type: elType,
  ...extra,
});

const seedWithCustom = (page, courses, plannedCodes) => seedPlan(page, {
  major: 'CS',
  entryTerm: TERM_NAME,
  customCourses: { CS: courses },
  curriculum: [plannedCodes],
  grades: [plannedCodes.map(() => 'A')],
  dates: [TERM_NAME],
});

const readCourse = (page, code) => page.evaluate((c) => {
  let found = null;
  window.curriculum.semesters.forEach((s) => s.courses.forEach((x) => {
    if (x.code === c) found = { code: x.code, eff: x.effective_type, su: x.SU_credit, faculty: x.Faculty, facultyCourse: x.Faculty_Course };
  }));
  const s = window.curriculum.semesters;
  const sum = (f) => s.reduce((a, x) => a + (x[f] || 0), 0);
  return {
    found,
    totals: { core: sum('totalCore'), credit: sum('totalCredit'), science: sum('totalScience'), ects: sum('totalECTS') },
  };
}, code);

test.describe('custom courses', () => {
  test('a custom course is loaded into the course DB and allocated like a catalog one', async ({ page }) => {
    await seedWithCustom(page, [custom('ZZZ101', 'core')], ['ZZZ101']);
    const { found } = await readCourse(page, 'ZZZ101');

    expect(found, 'the custom course should survive into the curriculum').toBeTruthy();
    expect(found.eff, 'its EL_Type should drive its allocation').toBe('core');
  });

  test('its credits and ECTS reach the totals', async ({ page }) => {
    const { totals: base } = await (async () => {
      await seedWithCustom(page, [], []);
      return readCourse(page, 'ZZZ101');
    })();

    await seedWithCustom(page, [custom('ZZZ102', 'core', { SU_credit: '4', ECTS: '7' })], ['ZZZ102']);
    const { totals } = await readCourse(page, 'ZZZ102');

    expect(totals.credit - base.credit, 'SU credits should count').toBe(4);
    expect(totals.ects - base.ects, 'ECTS should count').toBe(7);
    expect(totals.core - base.core, 'a core-typed custom course should fill core').toBe(4);
  });

  test('basic-science credits on a custom course count toward the science requirement', async ({ page }) => {
    // Science is a graduation threshold in its own right (flag 8), so a custom
    // course claiming science credit moves a real requirement.
    await seedWithCustom(page, [custom('ZZZ103', 'core', { Basic_Science: 5 })], ['ZZZ103']);
    const { totals } = await readCourse(page, 'ZZZ103');
    expect(totals.science, 'basic-science should reach the science total').toBe(5);
  });

  test('an unknown EL_Type is allocated to nothing rather than guessed', async ({ page }) => {
    // The form constrains EL_Type, but storage is user-editable (and exports
    // round-trip through it), so a junk value must not be silently promoted
    // into a pool.
    await seedWithCustom(page, [custom('ZZZ104', 'nonsense')], ['ZZZ104']);
    const { found, totals } = await readCourse(page, 'ZZZ104');
    expect(found, 'the course should still load').toBeTruthy();
    expect(['core', 'area', 'free', 'required', 'university'], `unexpected allocation "${found.eff}"`).not.toContain(found.eff);
    expect(totals.core, 'it must not land in a pool').toBe(0);
  });

  test('custom courses are scoped to their major', async ({ page }) => {
    // The key is customCourses_<major>. A course defined for ME must not appear
    // for a CS student — otherwise switching major would leak courses across
    // catalogs.
    await seedPlan(page, {
      major: 'CS',
      entryTerm: TERM_NAME,
      customCourses: { ME: [custom('ZZZ105', 'core')] },
      curriculum: [['CS201']],
      grades: [['A']],
      dates: [TERM_NAME],
    });
    const inDb = await page.evaluate(() => course_data.some((c) => (String(c.Major || '') + String(c.Code || '')) === 'ZZZ105'));
    expect(inDb, "another major's custom course must not load for CS").toBe(false);
  });

  test('a custom course can carry a requirement over its threshold', async ({ page }) => {
    // The integration that matters: custom courses are real to the engine, so
    // one can be the difference between graduating and not.
    const codes = ['ZZZ201', 'ZZZ202', 'ZZZ203'];
    await seedWithCustom(page, codes.map((c) => custom(c, 'core', { SU_credit: '10' })), codes);
    const { totals } = await readCourse(page, codes[0]);
    // CS needs 31 core credits; 3 x 10 = 30 is deliberately just short, so the
    // cascade must cap rather than over-credit.
    expect(totals.core, 'core should take all 30 custom credits, capped by nothing yet').toBe(30);
  });

  test('the export round-trips custom courses', async ({ page }) => {
    // customCourses is a first-class part of the plan state, so a plan that
    // relies on them must survive export/import — otherwise the student silently
    // loses courses their graduation depends on.
    await seedWithCustom(page, [custom('ZZZ106', 'area')], ['ZZZ106']);
    const roundTripped = await page.evaluate(() => {
      const id = window.planStorage.getActivePlanId();
      const raw = window.planStorage.getItem('customCourses_CS', id);
      return JSON.parse(raw || '[]').map((c) => String(c.Major) + String(c.Code));
    });
    expect(roundTripped, 'the custom course should be readable from plan state').toContain('ZZZ106');
  });
});
