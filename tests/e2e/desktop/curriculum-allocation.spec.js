'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');

// Entry term 202401 is frozen, so the requirement lists that drive
// recalcEffectiveTypes (which category each course counts toward) are stable.
test.describe('curriculum type allocation (desktop)', () => {
  test('courses are categorized into university / required / core', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [
        ['MATH101', 'NS101', 'SPS101', 'IF100', 'HIST191'],
        ['CS201', 'CS204', 'MATH201', 'CS300', 'CS310'],
      ],
      grades: [['A', 'A', 'A', 'A', 'A'], ['A', 'A', 'A', 'A', 'A']],
      dates: ['Fall 2024-2025', 'Spring 2024-2025'],
    });

    const alloc = await page.evaluate(() => {
      const sems = window.curriculum.semesters;
      const sum = (f) => sems.reduce((a, s) => a + (s[f] || 0), 0);
      const types = {};
      sems.forEach((s) => s.courses.forEach((c) => { types[c.code] = c.effective_type; }));
      return {
        types,
        university: sum('totalUniversity'),
        required: sum('totalRequired'),
        core: sum('totalCore'),
        area: sum('totalArea'),
        free: sum('totalFree'),
      };
    });

    // Freshman foundation courses count as University Courses.
    for (const c of ['MATH101', 'NS101', 'SPS101', 'IF100', 'HIST191']) {
      expect(alloc.types[c], c).toBe('university');
    }
    // Core program courses count as Required...
    for (const c of ['CS201', 'CS204', 'MATH201', 'CS300']) {
      expect(alloc.types[c], c).toBe('required');
    }
    // ...and CS310 lands in the Core elective pool.
    expect(alloc.types.CS310).toBe('core');

    // Category credit totals follow from the above (3 credits each here).
    expect(alloc.university).toBe(15);
    expect(alloc.required).toBe(12);
    expect(alloc.core).toBe(3);
    expect(alloc.area).toBe(0);
    expect(alloc.free).toBe(0);
  });
});
