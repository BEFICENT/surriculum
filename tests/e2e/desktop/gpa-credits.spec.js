'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan, readCurriculumTotals } = require('../helpers/plan');

// MATH101 and MATH102 are 3-credit intro courses (stable in the scraped data).
const base = { major: 'CS', entryTerm: 'Fall 2024-2025', dates: ['Fall 2024-2025'] };

test.describe('GPA + earned-credit rules (desktop)', () => {
  test('letter grades produce a credit-weighted GPA', async ({ page }) => {
    await seedPlan(page, { ...base, curriculum: [['MATH101', 'MATH102']], grades: [['A', 'B']] });
    const t = await readCurriculumTotals(page);
    expect(t.earnedCredits).toBe(6);
    expect(t.gpaValue).toBe(21); // 3*4.0 + 3*3.0
    expect(t.gpaCredits).toBe(6);
    expect(t.gpa).toBe(3.5);
  });

  test('a transfer (T) grade earns credit but is excluded from GPA', async ({ page }) => {
    await seedPlan(page, { ...base, curriculum: [['MATH101', 'MATH102']], grades: [['A', 'T']] });
    const t = await readCurriculumTotals(page);
    expect(t.earnedCredits).toBe(6); // T still counts toward earned credits
    expect(t.gpaValue).toBe(12); // only MATH101 (A) contributes
    expect(t.gpaCredits).toBe(3); // T excluded from the GPA denominator
    expect(t.gpa).toBe(4);
  });

  test('an F counts as 0.0 in GPA and is excluded from earned credits', async ({ page }) => {
    await seedPlan(page, { ...base, curriculum: [['MATH101', 'MATH102']], grades: [['A', 'F']] });
    const t = await readCurriculumTotals(page);
    expect(t.earnedCredits).toBe(3); // F removed from earned credits
    expect(t.gpaValue).toBe(12); // 3*4.0 + 3*0.0
    expect(t.gpaCredits).toBe(6); // F still counts in the GPA denominator
    expect(t.gpa).toBe(2);
  });

  test('an ungraded (Registered) course earns credit but is excluded from GPA', async ({ page }) => {
    await seedPlan(page, { ...base, curriculum: [['MATH101', 'MATH102']], grades: [['A', '']] });
    const t = await readCurriculumTotals(page);
    expect(t.earnedCredits).toBe(6);
    expect(t.gpaValue).toBe(12);
    expect(t.gpaCredits).toBe(3);
    expect(t.gpa).toBe(4);
  });

  test('GPA and credits aggregate across multiple semesters', async ({ page }) => {
    await seedPlan(page, {
      ...base,
      curriculum: [['MATH101'], ['MATH102']],
      grades: [['A'], ['C']],
      dates: ['Fall 2024-2025', 'Spring 2024-2025'],
    });
    const t = await readCurriculumTotals(page);
    expect(t.earnedCredits).toBe(6);
    expect(t.gpaValue).toBe(18); // 3*4.0 + 3*2.0
    expect(t.gpaCredits).toBe(6);
    expect(t.gpa).toBe(3);
  });
});
