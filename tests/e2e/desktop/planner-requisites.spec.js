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
    const picker = page.locator('.container_semester .input_container').first();
    await picker.locator('.planner-course-filter-btn').click();
    await picker.locator('.planner-filter-offered').uncheck();
    await picker.locator('.course_select').fill('EE202');
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

  test('SPS303 reports prior planned/completed SU and clears at the 58-SU boundary', async ({ page }) => {
    // All codes are distinct real catalog courses: 18 × 3 SU + TLL101 2 SU =
    // 56 prior SU. The blank grades intentionally prove that planned eligible
    // work follows the same semantics as ordinary planner prerequisites.
    const prior56 = [
      'IF100', 'MATH101', 'SPS101', 'AL102', 'MATH102', 'SPS102',
      'HUM201', 'HUM202', 'HUM207', 'HUM311', 'HUM312', 'HUM317',
      'CS201', 'CS204', 'CS300', 'CS301', 'CS302', 'CS305', 'TLL101',
    ];
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [prior56, ['SPS303']],
      grades: [prior56.map(() => ''), ['']],
      dates: ['Fall 2024-2025', 'Spring 2024-2025'],
    });
    await page.evaluate(() => window.courseRequisites.refreshPlannerWarnings());

    const priorWarning = warning(page, 'SPS303', 'prior-credits');
    await expect(priorWarning).toContainText('56 of 58 SU planned/completed in earlier terms');
    await expect(priorWarning).toContainText(/advisory.*approval/i);

    // A same-term course must not satisfy the prior-credit rule.
    await page.evaluate(() => {
      const target = window.curriculum.semesters[1];
      const course = target && target.courses && target.courses[0];
      const extra = Object.assign(Object.create(Object.getPrototypeOf(course)), course, {
        code: 'TLL102', id: 'same-term-tll102', SU_credit: 2, grade: '',
      });
      target.courses.push(extra);
    });
    await page.evaluate(() => window.courseRequisites.refreshPlannerWarnings());
    await expect(priorWarning).toContainText('56 of 58 SU planned/completed in earlier terms');

    // Move the 2-SU row to the earlier semester in the model; 58 is sufficient.
    await page.evaluate(() => {
      const target = window.curriculum.semesters[1];
      const earlierSemester = window.curriculum.semesters[0];
      const index = target.courses.findIndex((course) => course.code === 'TLL102');
      earlierSemester.courses.push(target.courses.splice(index, 1)[0]);
    });
    await page.evaluate(() => window.courseRequisites.refreshPlannerWarnings());
    await expect(priorWarning).toHaveCount(0);
  });

  test('HUM201 enforces both General Requirements SPS courses and 23 prior SU', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [['SPS101', 'IF100', 'MATH101'], ['HUM201']],
      grades: [['A', '', 'A'], ['']],
      dates: ['Fall 2024-2025', 'Spring 2024-2025'],
    });
    await page.evaluate(() => window.courseRequisites.refreshPlannerWarnings());

    await expect(warning(page, 'HUM201', 'prerequisite')).toContainText('SPS102');
    await expect(warning(page, 'HUM201', 'prior-credits'))
      .toContainText('9 of 23 SU planned/completed in earlier terms');

    await page.locator('.course:has(.course_code:text-is("HUM201")) .details_course').click();
    const details = page.locator('.modal.app-modal').filter({ hasText: 'Course Details' });
    await expect(details).toBeVisible();
    await expect(details).toContainText('General requirements');
    await expect(details).toContainText('23.000 credits');
    await expect(details.locator('.course-details-section').filter({ hasText: 'Prerequisites' }))
      .toHaveCount(0);
  });

  test('ENS491 picker, card, and details use reviewed program-aware registration guidance', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [[]],
      grades: [[]],
      dates: ['Spring 2024-2025'],
      termCodes: ['202402'],
    });

    const semester = page.locator('.container_semester').first();
    await semester.locator('.addCourse').click();
    const picker = semester.locator('.input_container');
    await picker.locator('.planner-course-filter-btn').click();
    const filters = picker.locator('.planner-course-filter-menu');
    const check = filters.locator('.planner-filter-prerequisites');
    if (!(await check.isChecked())) await check.check();
    const showUnmet = filters.locator('.planner-filter-show-unmet');
    if (!(await showUnmet.isChecked())) await showUnmet.check();
    await page.keyboard.press('Escape');

    await picker.locator('.course_select').fill('ENS491');
    const option = picker.locator('.course-option[data-code="ENS491"]');
    await expect(option).toBeVisible({ timeout: 15000 });
    await expect(option).toHaveAttribute('data-requisite-state', 'unmet');
    await expect(option).toContainText('Unmet registration guidance');
    await expect(option).toContainText(/80 SU/i);
    await expect(option).toContainText(/CS300, CS306, or CS308/i);

    await picker.locator('.planner-course-filter-btn').click();
    await showUnmet.uncheck();
    await expect(option).toHaveCount(0);
    await showUnmet.check();
    await expect(option).toBeVisible();
    await filters.locator('.planner-course-filter-close').click();
    await picker.locator('.course_select').fill('ENS491');
    await expect(option).toBeVisible();

    await option.click();
    await picker.locator('.enter').click();
    await page.evaluate(() => window.courseRequisites.refreshPlannerWarnings());

    const card = page.locator('.course:has(.course_code:text-is("ENS491"))');
    await expect(card).toHaveCount(1);
    const cardWarnings = card.locator('.planner-course-warnings');
    await expect(cardWarnings).toContainText(/80 SU/i);
    await expect(cardWarnings).toContainText(/CS300, CS306, or CS308/i);
    const reviewedSource = warning(page, 'ENS491', 'registration-source');
    await expect(reviewedSource).toContainText(/reviewed registration source/i);
    await expect(reviewedSource.locator('a')).toHaveAttribute('href', /suis\.sabanciuniv\.edu/);

    await card.locator('.details_course').click();
    const details = page.locator('.modal.app-modal').filter({ hasText: 'Course Details' });
    await expect(details).toBeVisible();
    const guidance = details.locator('.course-registration-guidance');
    await expect(guidance).toContainText('Registration guidance');
    await expect(guidance).toContainText('Needs attention');
    await expect(guidance).toContainText(/80 SU/i);
    await expect(guidance).toContainText(/CS300, CS306, or CS308/i);
    await expect(guidance).toContainText(/reviewed 2026-08-17/i);
    await expect(guidance.locator('a')).toHaveAttribute('href', /suis\.sabanciuniv\.edu/);
    await expect(details.locator('.course-details-section h4', { hasText: /^Description$/ }))
      .toHaveCount(0);
    await expect(details.locator('.course-details-section h4', { hasText: /^Prerequisites$/ }))
      .toHaveCount(0);
    await expect(details).not.toContainText('Computer Science and Engineering: CS 300');
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
