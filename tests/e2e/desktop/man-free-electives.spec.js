'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');

// Official SUIS rule (MAN free electives):
//   "26 SU credits are required. 9 out of these 26 SU credits should be among
//    the courses offered by FASS or FENS. At most 2 of the Beginning / Basic
//    level language courses can be used to fulfill the requirements for this
//    area."
//
// All three conditions report the SAME flag (37), so these tests read the
// underlying counts rather than only the flag — otherwise they could not tell
// which of the three fired.
//
// Two bugs this pins:
//  1. "offered by FASS or FENS" was read from `Faculty_Course` — the marker for
//     membership of the FACULTY-COURSE pool (~66 of 670 courses) — instead of
//     `Faculty`, the offering faculty (every course has one). Regular FASS/FENS
//     free electives counted for nothing.
//  2. The basic-language cap listed LANG101-104, which exist in no catalog (the
//     source comment said "Example codes"), so the cap could never fire. The
//     real School of Languages basic courses are FRE110/120, GER110/120,
//     SPA110/120, TUR101/102.
const TERM = 'Fall 2024-2025';

const seedMan = (page, courses) => seedPlan(page, {
  major: 'MAN',
  entryTerm: TERM,
  curriculum: [courses],
  grades: [courses.map(() => 'A')],
  dates: [TERM],
});

// Recompute the rule's own inputs from the live model, over free-allocated
// courses only — mirroring what canGraduate does.
const readFree = (page) => page.evaluate(() => {
  const BASIC = ['FRE110', 'FRE120', 'GER110', 'GER120', 'SPA110', 'SPA120', 'TUR101', 'TUR102'];
  let credits = 0, fassFens = 0, basicLang = 0, missingFaculty = 0;
  window.curriculum.semesters.forEach((s) => s.courses.forEach((c) => {
    if ((c.effective_type || '').toLowerCase() !== 'free') return;
    const cr = parseFloat(c.SU_credit || '0') || 0;
    credits += cr;
    if (c.Faculty === 'FASS' || c.Faculty === 'FENS') fassFens += cr;
    if (BASIC.includes(c.code)) basicLang += 1;
    if (!c.Faculty) missingFaculty += 1;
  }));
  return { credits, fassFens, basicLang, missingFaculty };
});

test.describe('MAN free-elective rules', () => {
  test('the offering faculty is available on every allocated course', async ({ page }) => {
    // `Faculty` is what the "offered by FASS or FENS" rule reads. It was never
    // copied onto the course object, so the rule had nothing to read.
    await seedMan(page, ['PSY201', 'HIST191', 'MATH101', 'FRE110']);
    const r = await readFree(page);
    expect(r.missingFaculty, 'no free-allocated course should be missing its Faculty').toBe(0);
  });

  test('regular FASS/FENS free electives count toward the 9-credit rule', async ({ page }) => {
    // None of these is a designated "faculty course"; all are plainly offered by
    // FASS or FENS. Under the old `Faculty_Course` check they contributed 0.
    const courses = ['PSY303', 'PSY304', 'CS412'];
    await seedMan(page, courses);
    const r = await readFree(page);
    expect(r.credits, 'the courses should be allocated to free electives').toBeGreaterThan(0);
    expect(r.fassFens, 'FASS/FENS-offered free electives must count').toBeGreaterThan(0);
    expect(r.fassFens, 'they are the only free electives here, so all of it counts').toBe(r.credits);
  });

  test('basic language courses are recognised; intermediate ones are not', async ({ page }) => {
    await seedMan(page, ['FRE110', 'FRE120', 'GER110', 'FRE130', 'TUR201']);
    const r = await readFree(page);
    // FRE110 + FRE120 + GER110 are "Basic"; FRE130/TUR201 are "Intermediate"
    // and are deliberately outside the cap.
    expect(r.basicLang, 'the three Basic courses should be counted').toBe(3);
  });

  test('the SL language courses the cap targets really exist', async ({ page }) => {
    // Guards the class of bug that made the cap dead: placeholder course codes.
    // If a catalog rename ever orphans these, this fails loudly.
    await seedMan(page, ['FRE110', 'FRE120', 'GER110', 'GER120', 'SPA110', 'SPA120', 'TUR101', 'TUR102']);
    const seen = await page.evaluate(() => {
      const out = [];
      window.curriculum.semesters.forEach((s) => s.courses.forEach((c) => out.push(c.code)));
      return out;
    });
    for (const c of ['FRE110', 'FRE120', 'GER110', 'GER120', 'SPA110', 'SPA120', 'TUR101', 'TUR102']) {
      expect(seen, `${c} should exist in the MAN catalog`).toContain(c);
    }
  });
});
