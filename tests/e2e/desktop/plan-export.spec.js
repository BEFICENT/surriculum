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
    expect(obj.version).toBe(1);
    expect(obj.plan.state.major).toBe('CS');
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
        totalCredit: sum('totalCredit'),
        gpa: sum('totalGPACredits') ? +(sum('totalGPA') / sum('totalGPACredits')).toFixed(2) : null,
        blocked: JSON.parse(window.planStorage.getItem('schedulerState_202403')).blocked,
      };
    });
    expect(m.major).toBe('CS');
    expect(m.codes).toEqual(['MATH101', 'MATH102', 'NS101']);
    expect(m.totalCredit).toBe(10);
    expect(m.gpa).toBe(3.7);
    expect(m.blocked).toEqual(PLAN.schedulerStates['202403'].blocked);
  });
});
