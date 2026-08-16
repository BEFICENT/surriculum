'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan, readCurriculumTotals } = require('../helpers/plan');

test.describe('planner CRUD (desktop)', () => {
  test('deleting a course removes it from the board and the model', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [['MATH101', 'MATH102', 'NS101']],
      grades: [['A', 'A', 'A']],
      dates: ['Fall 2024-2025'],
    });
    expect(await page.evaluate(() => window.curriculum.hasCourse('MATH102'))).toBe(true);

    await page.locator('.course:has(.course_code:text-is("MATH102")) .delete_course').click();

    await expect(page.locator('.course:has(.course_code:text-is("MATH102"))')).toHaveCount(0);
    expect(await page.evaluate(() => window.curriculum.hasCourse('MATH102'))).toBe(false);
    // The other courses are untouched.
    expect(await page.evaluate(() => window.curriculum.hasCourse('MATH101'))).toBe(true);
  });

  test('adding a course through the picker inserts it into the semester', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [['MATH101']],
      grades: [['A']],
      dates: ['Fall 2024-2025'],
    });
    expect(await page.evaluate(() => window.curriculum.hasCourse('CS201'))).toBe(false);

    await page.locator('.container_semester .addCourse').first().click();
    await page.locator('.container_semester .course_select').first().fill('CS201');
    // The dropdown floats at the document level; pick the matching option, commit.
    await page.locator('.course-option[data-code="CS201"]').first().click();
    await page.locator('.container_semester .enter').first().click();

    await expect(page.locator('.course:has(.course_code:text-is("CS201"))')).toHaveCount(1);
    expect(await page.evaluate(() => window.curriculum.hasCourse('CS201'))).toBe(true);
    await expect(page.getByRole('button', { name: 'Details for CS201' })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Delete CS201' })).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Grade for CS201: not entered' })).toHaveCount(1);
  });

  test('assigning a grade to an ungraded course updates the GPA', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [['MATH101']],
      grades: [['']], // ungraded
      dates: ['Fall 2024-2025'],
    });
    expect((await readCurriculumTotals(page)).gpaCredits).toBe(0);

    await page.locator('.course:has(.course_code:text-is("MATH101")) .grade').click();
    await page.locator('.grade-option[data-value="A"]').click();

    const t = await readCurriculumTotals(page);
    expect(t.gpaValue).toBe(12); // 3 credits * 4.0
    expect(t.gpaCredits).toBe(3);
    expect(t.gpa).toBe(4);

    await page.locator('.course:has(.course_code:text-is("MATH101")) .grade').click();
    await page.locator('.grade-option[data-value="S"]').click();
    const satisfactory = await readCurriculumTotals(page);
    expect(satisfactory.gpaCredits).toBe(0);
    expect(await page.evaluate(() => window.curriculum.semesters[0].courses[0].gradingBasis))
      .toBe('satisfactory');
  });

  test('the grade picker exposes special grades and resolves NA basis explicitly', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [['MATH101']],
      grades: [['']],
      dates: ['Fall 2024-2025'],
    });

    const grade = page.locator('.course:has(.course_code:text-is("MATH101")) .grade');
    await grade.click();
    for (const token of ['P', 'S', 'U', 'I', 'T', 'W']) {
      await expect(page.locator(`.grade-option[data-value="${token}"]`)).toHaveCount(1);
    }
    await expect(page.locator('.grade-option[data-value="NA"]')).toHaveCount(2);
    await page.locator('.grade-option[data-value="NA"][data-basis="satisfactory"]').click();

    const result = await page.evaluate(() => {
      const course = window.curriculum.semesters[0].courses[0];
      return { grade: course.grade, basis: course.gradingBasis, gpa: window.curriculum.getActualGpa() };
    });
    expect(result.grade).toBe('NA');
    expect(result.basis).toBe('satisfactory');
    expect(result.gpa.resolved).toBe(true);
    expect(result.gpa.credits).toBe(0);
  });

  test('dismissing the grade picker leaves the previous grade unchanged', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [['MATH101']],
      grades: [['A']],
      dates: ['Fall 2024-2025'],
    });

    const grade = page.locator('.course:has(.course_code:text-is("MATH101")) .grade');
    await grade.click();
    await page.locator('.summary').click();

    await expect(grade).toHaveText('A');
    expect(await page.evaluate(() => window.curriculum.semesters[0].courses[0].grade)).toBe('A');
  });
});
