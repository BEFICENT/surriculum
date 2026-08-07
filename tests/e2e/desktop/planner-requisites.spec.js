'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');
const plans = require('../fixtures/passing-plans-multiterm.json');

const warning = (page, courseCode, kind) => page.locator(
  `.course:has(.course_code:text-is("${courseCode}")) .planner-requisite-warning[data-warning-kind="${kind}"]`,
);

test.describe('advisory planner prerequisite/corequisite warnings', () => {
  test('a failed earlier prerequisite warns, then clears when its grade becomes successful', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [['ENS491'], ['ENS492']],
      grades: [['F'], ['']],
      dates: ['Fall 2024-2025', 'Spring 2024-2025'],
    });
    await page.evaluate(() => window.courseRequisites.refreshPlannerWarnings());

    await expect(warning(page, 'ENS492', 'prerequisite')).toContainText('ENS491');
    await page.locator('.course:has(.course_code:text-is("ENS491")) .grade').click();
    await page.locator('.grade-option[data-value="A"]').click();
    await expect(warning(page, 'ENS492', 'prerequisite')).toHaveCount(0);
  });

  test('EE200/EE202 warn as real corequisites while EE202R stays suppressed', async ({ page }) => {
    await seedPlan(page, {
      major: 'EE',
      entryTerm: 'Fall 2024-2025',
      curriculum: [['EE200']],
      grades: [['']],
      dates: ['Fall 2024-2025'],
    });
    await page.evaluate(() => window.courseRequisites.refreshPlannerWarnings());
    await expect(warning(page, 'EE200', 'corequisite')).toContainText('EE202');

    await page.locator('.container_semester .addCourse').first().click();
    await page.locator('.container_semester .course_select').first().fill('EE202');
    await page.locator('.course-option[data-code="EE202"]').first().click();
    await page.locator('.container_semester .enter').first().click();
    await expect(warning(page, 'EE200', 'corequisite')).toHaveCount(0);
    await expect(warning(page, 'EE202', 'corequisite')).toHaveCount(0);

    await page.locator('.course:has(.course_code:text-is("EE202")) .delete_course').click();
    await expect(warning(page, 'EE200', 'corequisite')).toContainText('EE202');
  });

  test('an explicitly concurrent prerequisite is accepted only where marked', async ({ page }) => {
    await seedPlan(page, {
      major: 'ME',
      entryTerm: 'Fall 2024-2025',
      curriculum: [['MATH102'], ['NS102', 'ENS205']],
      grades: [['A'], ['', '']],
      dates: ['Fall 2024-2025', 'Spring 2024-2025'],
    });
    await page.evaluate(() => window.courseRequisites.refreshPlannerWarnings());

    await expect(warning(page, 'ENS205', 'prerequisite')).toHaveCount(0);
  });

  test('warnings remain advisory and do not alter graduation results', async ({ page }) => {
    const courses = plans['202301'].CS;
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2023-2024',
      curriculum: [courses, ['EE200']],
      grades: [courses.map(() => 'A'), ['']],
      dates: ['Fall 2023-2024', 'Fall 2026-2027'],
    });
    const graduationBefore = await page.evaluate(() => window.curriculum.canGraduate());
    await page.evaluate(() => window.courseRequisites.refreshPlannerWarnings());

    await expect(warning(page, 'EE200', 'corequisite')).toContainText('EE202');
    await expect(page.locator('.planner-course-warnings')).toHaveAttribute('role', 'status');
    await expect(page.locator('.planner-course-warnings')).toHaveCount(1);
    await expect(page.locator('.course:has(.planner-course-warnings) .course_code')).toHaveText('EE200');
    expect(graduationBefore).toBe(0);
    expect(await page.evaluate(() => window.curriculum.canGraduate())).toBe(0);
  });
});
