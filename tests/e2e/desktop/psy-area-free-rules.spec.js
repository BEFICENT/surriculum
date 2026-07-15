'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan, hoist } = require('../helpers/plan');
const plans = require('../fixtures/passing-plans-multiterm.json');

// Two PSY rules that SUIS states and the engine never checked. Both are
// omissions rather than wrong logic, so no test could have found them — only
// the SUIS text:
//
//   Area electives: "At least 6 courses from all PSY coded undergraduate
//     courses. At least 2 courses must be from PSY 4XX-level advanced
//     Psychology courses."            -> flag 39
//   Free electives: "at most two of the beginning/basic level second language
//     courses can be used to fulfill the free elective requirements."
//                                     -> flag 40
//
// The 6-course minimum needs no check of its own: `area` is 18 credits = 6x3cr
// and the PSY catalog types only PSY-coded courses as area, so the generic area
// check already covers it. Only the 4XX half was missing.
//
// REACHING THESE FLAGS: canGraduate returns the FIRST unmet requirement, and
// the generated PSY plan stops at flag 18 (its faculty courses span only PSYCH
// and SBS, and 3 areas are needed). One faculty course from any third area
// clears that and lets the PSY-specific checks run — ECON201 below.
const TERM = '202301';
const TERM_NAME = 'Fall 2023-2024';
const THIRD_AREA_FACULTY_COURSE = 'ECON201'; // spans a third faculty area -> clears flag 18
const AREA_4XX_FLAG = 39;
const BASIC_LANGUAGE_FLAG = 40;

// PSY 4XX area electives absent from the generated plan. They must be HOISTED:
// area caps at 18 credits (6 courses) and the plan already carries 10 area-typed
// courses, so appending would just overflow them into free electives.
const PSY_4XX = ['PSY403', 'PSY407'];

const seedPsy = ({ page, add = [], front = [] }) => {
  const courses = hoist(plans[TERM].PSY.concat(add), front);
  return seedPlan(page, {
    major: 'PSY',
    entryTerm: TERM_NAME,
    curriculum: [courses],
    grades: [courses.map(() => 'A')],
    dates: [TERM_NAME],
  });
};

const read = (page) => page.evaluate(() => {
  const psy4xx = [];
  const basicLang = [];
  window.curriculum.semesters.forEach((s) => s.courses.forEach((c) => {
    const eff = (c.effective_type || '').toLowerCase();
    if (eff === 'area' && /^PSY4\d{2}$/.test(c.code)) psy4xx.push(c.code);
    if (eff === 'free' && ['FRE110', 'FRE120', 'GER110', 'GER120', 'SPA110', 'SPA120', 'TUR101', 'TUR102'].includes(c.code)) basicLang.push(c.code);
  }));
  return { flag: window.curriculum.canGraduate(), psy4xx, basicLang };
});

test.describe('PSY area + free elective rules', () => {
  test('area electives without any PSY 4XX course are flagged', async ({ page }) => {
    // The generated plan's 10 area courses are all 3XX — so it violates the
    // SUIS rule, and the engine used to pass it.
    await seedPsy({ page, add: [THIRD_AREA_FACULTY_COURSE] });
    const r = await read(page);
    expect(r.psy4xx, 'the generated plan has no 4XX area electives').toEqual([]);
    expect(r.flag, 'should require 2 PSY 4XX-level area electives').toBe(AREA_4XX_FLAG);
  });

  test('two PSY 4XX area electives satisfy the rule', async ({ page }) => {
    await seedPsy({ page, add: [THIRD_AREA_FACULTY_COURSE, ...PSY_4XX], front: PSY_4XX });
    const r = await read(page);
    expect(r.psy4xx.sort(), 'both 4XX courses should occupy area slots').toEqual(PSY_4XX);
    expect(r.flag, 'the 4XX requirement should now be met').not.toBe(AREA_4XX_FLAG);
  });

  test('one PSY 4XX area elective is not enough', async ({ page }) => {
    await seedPsy({ page, add: [THIRD_AREA_FACULTY_COURSE, 'PSY403'], front: ['PSY403'] });
    const r = await read(page);
    expect(r.psy4xx, 'exactly one 4XX area elective').toEqual(['PSY403']);
    expect(r.flag, 'SUIS requires at least 2, so one must still flag').toBe(AREA_4XX_FLAG);
  });

  test('more than two basic language courses in free electives are flagged', async ({ page }) => {
    const langs = ['FRE110', 'FRE120', 'GER110'];
    await seedPsy({
      page,
      add: [THIRD_AREA_FACULTY_COURSE, ...PSY_4XX, ...langs],
      front: PSY_4XX, // keep the 4XX rule satisfied so flag 40 is the one left
    });
    const r = await read(page);
    expect(r.basicLang.sort(), 'the three basic language courses land in free electives').toEqual(langs.sort());
    expect(r.flag, 'at most 2 basic language courses may count').toBe(BASIC_LANGUAGE_FLAG);
  });

  test('exactly two basic language courses are allowed', async ({ page }) => {
    await seedPsy({
      page,
      add: [THIRD_AREA_FACULTY_COURSE, ...PSY_4XX, 'FRE110', 'FRE120'],
      front: PSY_4XX,
    });
    const r = await read(page);
    expect(r.basicLang, 'two basic language courses').toHaveLength(2);
    expect(r.flag, 'two is the cap, not a violation').not.toBe(BASIC_LANGUAGE_FLAG);
  });

  test('both new flags have messages, and so does flag 77', async ({ page }) => {
    await page.goto('/');
    const msgs = await page.evaluate(async () => {
      const { buildFlagMessages } = await import('/cases/flagMessages.js');
      const m = buildFlagMessages('PSY');
      return { 39: m[39] && m[39](), 40: m[40] && m[40](), 77: m[77] && m[77]() };
    });
    expect(msgs[39], 'flag 39 message').toMatch(/4XX|400/i);
    expect(msgs[40], 'flag 40 message').toMatch(/language/i);
    // 77 is returned by the PSY double-major core check and had NO message,
    // so the UI rendered a bare "Error code 77" at the student.
    expect(msgs[77], 'flag 77 must not fall back to "Error code 77"').toMatch(/Core Elective/i);
  });
});
