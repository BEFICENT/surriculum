'use strict';

const fs = require('node:fs');
const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');

test.describe('plan export / import round-trip (desktop)', () => {
  test('exporting then re-importing a plan preserves courses, credits, GPA and weekend blocks', async ({ page }) => {
    const PLAN = {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [['MATH101', 'MATH102', 'NS101']],
      grades: [['A', 'B', 'A']],
      dates: ['Fall 2024-2025'],
      schedulerSelectedTerm: '202403',
      schedulerStates: {
        202403: {
          selected: {},
          blocked: [
            { id: 'sat', dayKey: 'S', start: 780, end: 840 },
            { id: 'sun', dayKey: 'U', start: 900, end: 960 },
          ],
        },
      },
    };
    await seedPlan(page, PLAN);

    // Trigger the REAL export (a JSON blob download) and read it back.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.evaluate(() => window.planStorage.exportPlan()),
    ]);
    const filePath = await download.path();
    const obj = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    // The export uses the versioned envelope and carries the plan state.
    expect(obj.type).toBe('surriculum_plan');
    expect(obj.version).toBe(2);
    expect(obj.plan.state.major).toBe('CS');
    expect(obj.plan.state.gradingBases).toEqual([['letter', 'letter', 'letter']]);
    expect(obj.plan.state.schedulerStates['202403'].blocked).toEqual(PLAN.schedulerStates['202403'].blocked);

    // Re-import it as a new active plan and reload the app onto it.
    await page.evaluate((o) => window.planStorage.importPlanObject(o, { activate: true }), obj);
    await page.reload();
    await page.waitForFunction(
      () => !!(window.curriculum && Array.isArray(window.curriculum.semesters)
        && window.curriculum.semesters.some((s) => s.courses && s.courses.length)),
      { timeout: 15000 },
    );

    // The round-tripped plan matches the original exactly.
    const m = await page.evaluate(() => {
      const sems = window.curriculum.semesters;
      const sum = (f) => sems.reduce((a, s) => a + (s[f] || 0), 0);
      return {
        major: window.curriculum.major,
        codes: sems.flatMap((s) => s.courses.map((c) => c.code)).sort(),
        gradingBases: sems.flatMap((s) => s.courses.map((c) => c.gradingBasis)),
        totalCredit: sum('totalCredit'),
        gpa: sum('totalGPACredits') ? +(sum('totalGPA') / sum('totalGPACredits')).toFixed(2) : null,
        blocked: JSON.parse(window.planStorage.getItem('schedulerState_202403')).blocked,
      };
    });
    expect(m.major).toBe('CS');
    expect(m.codes).toEqual(['MATH101', 'MATH102', 'NS101']);
    expect(m.gradingBases).toEqual(['letter', 'letter', 'letter']);
    expect(m.totalCredit).toBe(10);
    expect(m.gpa).toBe(3.7);
    expect(m.blocked).toEqual(PLAN.schedulerStates['202403'].blocked);
  });

  test('version 2 preserves an explicit grading basis for an ambiguous NA', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [['MATH101']],
      grades: [['NA']],
      gradingBases: [['satisfactory']],
      dates: ['Fall 2024-2025'],
    });

    const before = await page.evaluate(() => {
      const course = window.curriculum.semesters[0].courses[0];
      return {
        grade: course.grade,
        basis: course.gradingBasis,
        gpa: window.curriculum.getActualGpa(),
      };
    });
    expect(before.grade).toBe('NA');
    expect(before.basis).toBe('satisfactory');
    expect(before.gpa.resolved).toBe(true);
    expect(before.gpa.credits).toBe(0);
  });

  test('keeps grades and grading bases when an imported plan omits dates', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [['MATH101']],
      grades: [['NA']],
      gradingBases: [['satisfactory']],
    });

    const loaded = await page.evaluate(() => {
      const course = window.curriculum.semesters[0].courses[0];
      return { grade: course.grade, gradingBasis: course.gradingBasis };
    });
    expect(loaded).toEqual({ grade: 'NA', gradingBasis: 'satisfactory' });
  });

  test('version 1 imports synthesize grading bases from decisive grades', async ({ page }) => {
    await page.goto('/');
    const state = await page.evaluate(() => {
      const id = window.planStorage.importPlanObject({
        type: 'surriculum_plan',
        version: 1,
        plan: {
          name: 'Legacy grades',
          state: {
            major: 'CS',
            curriculum: [['MATH101', 'MATH102', 'MATH201']],
            grades: [['A', 'S', 'NA']],
          },
        },
      });
      return JSON.parse(window.planStorage.getItem('gradingBases', id));
    });
    expect(state).toEqual([['letter', 'satisfactory', 'unknown']]);
  });

  test('version 2 rejects a grading-basis array that is not aligned to courses', async ({ page }) => {
    await page.goto('/');
    const message = await page.evaluate(() => {
      try {
        window.planStorage.importPlanObject({
          type: 'surriculum_plan',
          version: 2,
          plan: {
            name: 'Malformed bases',
            state: {
              curriculum: [['MATH101', 'MATH102']],
              grades: [['A', 'B']],
              gradingBases: [['letter']],
            },
          },
        });
        return null;
      } catch (error) {
        return String(error && error.message ? error.message : error);
      }
    });
    expect(message).toContain('must have one grading basis per course');
  });

  test('decisive grades canonicalize conflicting imported basis metadata', async ({ page }) => {
    await page.goto('/');
    const bases = await page.evaluate(() => {
      const id = window.planStorage.importPlanObject({
        type: 'surriculum_plan',
        version: 2,
        plan: {
          name: 'Conflicting bases',
          state: {
            curriculum: [['MATH101', 'MATH102', 'MATH201']],
            grades: [['A', 'S', 'NA']],
            gradingBases: [['satisfactory', 'letter', 'letter']],
          },
        },
      });
      return JSON.parse(window.planStorage.getItem('gradingBases', id));
    });
    expect(bases).toEqual([['letter', 'satisfactory', 'letter']]);
  });

  test('export repairs stale stored grading-basis dimensions', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [['MATH101', 'MATH102']],
      grades: [['A', 'S']],
      dates: ['Fall 2024-2025'],
    });
    const staleId = await page.evaluate(() => {
      const id = window.planStorage.duplicatePlan(window.planStorage.getActivePlanId(), 'Stale copy');
      window.planStorage.setItem('gradingBases', JSON.stringify([['letter']]), id);
      return id;
    });

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.evaluate((id) => window.planStorage.exportPlan(id), staleId),
    ]);
    const exported = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    expect(exported.plan.state.gradingBases).toEqual([['letter', 'satisfactory']]);
    const importedId = await page.evaluate((obj) => window.planStorage.importPlanObject(obj), exported);
    expect(importedId).toBeTruthy();
  });
});
