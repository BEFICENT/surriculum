'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');

// Two board-building flows in main.js, both previously untested:
//   .addSemester  — append one empty semester
//   .autoAdd      — "Add First Year Courses": seed two freshman semesters, but
//                   only when the board is empty
//
// Frozen term 202401.
const TERM_NAME = 'Fall 2024-2025';

const seedEmpty = (page) => seedPlan(page, {
  major: 'CS',
  entryTerm: TERM_NAME,
  curriculum: [],
  grades: [],
  dates: [],
});

const counts = (page) => page.evaluate(() => ({
  dom: document.querySelectorAll('.container_semester').length,
  model: (window.curriculum.semesters || []).length,
}));

test.describe('adding semesters', () => {
  test('the add-semester button appends one empty semester, DOM and model together', async ({ page }) => {
    await seedEmpty(page);
    const before = await counts(page);

    await page.locator('.addSemester').click();
    await expect(page.locator('.container_semester')).toHaveCount(before.dom + 1);

    const after = await counts(page);
    expect(after.model, 'the model gains a semester too').toBe(before.model + 1);
    // The new semester is empty — the button adds a slot, not courses.
    const lastCourses = await page.evaluate(() => {
      const sems = window.curriculum.semesters;
      return sems[sems.length - 1].courses.length;
    });
    expect(lastCourses, 'a fresh semester starts with no courses').toBe(0);
  });

  test('add-semester can be clicked repeatedly', async ({ page }) => {
    await seedEmpty(page);
    const before = (await counts(page)).dom;
    await page.locator('.addSemester').click();
    await page.locator('.addSemester').click();
    await expect(page.locator('.container_semester')).toHaveCount(before + 2);
  });
});

test.describe('Add First Year Courses', () => {
  const FALL = ['MATH101', 'NS101', 'SPS101', 'IF100', 'TLL101', 'HIST191', 'CIP101N'];
  const SPRING = ['MATH102', 'NS102', 'SPS102', 'AL102', 'TLL102', 'HIST192', 'PROJ201'];

  test('on an empty board it seeds two freshman semesters from the entry term', async ({ page }) => {
    await seedEmpty(page);
    expect((await counts(page)).model, 'starts empty').toBe(0);

    await page.locator('.autoAdd').click();
    await expect(page.locator('.container_semester')).toHaveCount(2);

    const allCodes = await page.evaluate(
      () => window.curriculum.semesters.flatMap((s) => s.courses.map((c) => c.code)),
    );
    for (const c of [...FALL, ...SPRING]) {
      expect(allCodes, `first-year set should include ${c}`).toContain(c);
    }

    // The term labels come from the rendered semester headers (.date p). The
    // courses must be anchored at the entry term, not the earliest catalog term.
    const terms = await page.evaluate(
      () => [...document.querySelectorAll('.container_semester .date p')].map((p) => (p.textContent || '').trim()),
    );
    expect(terms.join(' '), 'anchored at the entry term').toContain('Fall 2024-2025');
    expect(terms.join(' '), 'and the following spring').toContain('Spring 2024-2025');
  });

  test('it refuses to run when semesters already exist, and changes nothing', async ({ page }) => {
    // The guard: it only builds onto an empty board, to avoid clobbering a plan.
    await seedPlan(page, {
      major: 'CS',
      entryTerm: TERM_NAME,
      curriculum: [['CS201']],
      grades: [['A']],
      dates: [TERM_NAME],
    });
    const before = await counts(page);
    expect(before.model, 'a plan is present').toBeGreaterThan(0);

    await page.locator('.autoAdd').click();

    // uiAlert renders through uiModal → a .modal-overlay identified by its copy.
    // The board is untouched.
    const overlay = page.locator('.modal-overlay').filter({ hasText: /first year courses/i });
    await expect(overlay, 'a blocking alert should explain why it refused').toBeVisible({ timeout: 5000 });
    expect(await counts(page), 'the existing board must be unchanged').toEqual(before);
  });
});
