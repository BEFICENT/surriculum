'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');

test.describe('minors + double major (desktop)', () => {
  test('computeMinorAllocation returns a well-formed allocation with GPA gating', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      minor1: 'ANALY-MINOR',
      entryTermMinor1: 'Fall 2024-2025',
      curriculum: [['MATH101', 'NS101', 'CS201']],
      grades: [['A', 'A', 'A']],
      dates: ['Fall 2024-2025'],
    });

    const r = await page.evaluate(() => {
      const fn = window.computeMinorAllocation
        || (typeof computeMinorAllocation === 'function' ? computeMinorAllocation : null);
      const res = fn(window.curriculum, 'ANALY-MINOR');
      return {
        error: res.error || null,
        hasTitle: !!res.title,
        totalsCats: res.totals ? Object.keys(res.totals).sort() : null,
        cgpa: res.cgpa,
        gpaOk: res.gpaOk,
      };
    });

    expect(r.error).toBeNull();
    expect(r.hasTitle).toBe(true);
    // The allocation buckets every category the minor can draw from.
    expect(r.totalsCats).toEqual(['area', 'core', 'free', 'required']);
    // CGPA is the plan's overall GPA (all A's) and clears the minor threshold.
    expect(r.cgpa).toBe(4);
    expect(r.gpaOk).toBe(true);
  });

  test('an incomplete double major cannot graduate', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      doubleMajor: 'DSA',
      entryTermDM: 'Fall 2024-2025',
      curriculum: [['MATH101', 'NS101', 'CS201']],
      grades: [['A', 'A', 'A']],
      dates: ['Fall 2024-2025'],
    });

    // canGraduateDouble() mirrors canGraduate(): 0 when done, else a positive
    // flag for the first unmet requirement. This 3-course plan is far from done.
    const dmFlag = await page.evaluate(() => window.curriculum.canGraduateDouble());
    expect(dmFlag).toBeGreaterThan(0);
  });
});
