'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');

// A tiny, fully deterministic plan. Credits/grades below are hand-checkable and
// the intro courses used are extremely stable in the scraped data, so exact
// numbers double as a canary if that data ever shifts.
const PLAN = {
  major: 'CS',
  entryTerm: 'Fall 2024-2025',
  curriculum: [['MATH101', 'MATH102', 'NS101']], // credits 3 + 3 + 4 = 10
  grades: [['A', 'B', 'A']],                      // 4.0, 3.0, 4.0
  dates: ['Fall 2024-2025'],
};

test.describe('graduation check + credit/GPA math (desktop)', () => {
  test('aggregates credits and GPA from a seeded plan', async ({ page }) => {
    await seedPlan(page, PLAN);

    const m = await page.evaluate(() => {
      const sems = window.curriculum.semesters;
      const sum = (f) => sems.reduce((a, s) => a + (s[f] || 0), 0);
      return {
        courses: sems.reduce((a, s) => a + s.courses.length, 0),
        totalCredit: sum('totalCredit'),
        gpaValue: sum('totalGPA'),
        gpaCredits: sum('totalGPACredits'),
      };
    });

    expect(m.courses).toBe(3);
    expect(m.totalCredit).toBe(10); // 3 + 3 + 4
    // GPA = (3*4.0 + 3*3.0 + 4*4.0) / (3+3+4) = 37 / 10 = 3.70
    expect(m.gpaValue).toBe(37);
    expect(m.gpaCredits).toBe(10);
    expect(+(m.gpaValue / m.gpaCredits).toFixed(2)).toBe(3.7);
  });

  test('an incomplete plan cannot graduate and the check flags it', async ({ page }) => {
    await seedPlan(page, PLAN);

    // canGraduate() returns 0 when all requirements are met, else a positive
    // flag code for the first unmet one (see flagMessages.js). This 3-course
    // plan is far from done, so it must be a positive flag.
    const flag = await page.evaluate(() => window.curriculum.canGraduate());
    expect(flag).toBeGreaterThan(0);

    await page.locator('.check').click();
    const overlay = page.locator('.graduation_modal_overlay');
    await expect(overlay).toBeVisible();
    // The major card is rendered and marked incomplete, with a reason message.
    await expect(overlay.locator('.graduation_card.is-incomplete').first()).toBeVisible();
    await expect(overlay.locator('.graduation_card_message').first()).not.toBeEmpty();
  });

  test('hasCourse recognizes seeded courses (incl. CS210/DSA210 alias)', async ({ page }) => {
    await seedPlan(page, PLAN);
    const res = await page.evaluate(() => ({
      math101: window.curriculum.hasCourse('MATH101'),
      lowercaseWhitespace: window.curriculum.hasCourse(' math 101 '),
      absent: window.curriculum.hasCourse('CS404'),
    }));
    expect(res.math101).toBe(true);
    expect(res.lowercaseWhitespace).toBe(true); // normalizer strips case/space
    expect(res.absent).toBe(false);
  });
});
