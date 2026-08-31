'use strict';

const { expect } = require('../fixtures');

const TERM = 'Fall 2024-2025';
const MINOR_TERM = TERM;

const custom = (code, elType, extra = {}) => ({
  Major: code.replace(/\d+$/, ''),
  Code: code.replace(/^\D+/, ''),
  Course_Name: `Custom ${code}`,
  ECTS: '6',
  Engineering: 0,
  Basic_Science: 0,
  SU_credit: '3',
  Faculty: '',
  Faculty_Course: 'No',
  EL_Type: elType,
  ...extra,
});

const categorySelect = (form, program) => form.locator('.cc-row')
  .filter({ hasText: new RegExp(`^\\s*${program.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} Category:?`) })
  .locator('select');

const categoryLabels = async (form) => (await form.locator('.cc-row .program-category-label-line > label').allTextContents())
  .map((label) => label.trim().replace(/:$/, ''))
  .filter((label) => label.endsWith(' Category'))
  .sort();

const selectedPrograms = (overrides = {}) => ({
  major: 'CS',
  entryTerm: TERM,
  doubleMajor: 'DSA',
  entryTermDM: TERM,
  minor1: 'FIN-MINOR',
  entryTermMinor1: MINOR_TERM,
  minor2: 'ANALY-MINOR',
  entryTermMinor2: MINOR_TERM,
  minor3: 'PHIL-MINOR',
  entryTermMinor3: MINOR_TERM,
  ...overrides,
});

const waitForPrograms = (page, courseCode) => page.waitForFunction((target) => {
  if (!window.curriculum || !Array.isArray(window.curriculum.semesters)) return false;
  const minors = window.curriculum.minorCourseDataByCode || {};
  if (!minors['FIN-MINOR'] && !minors['ANALY-MINOR'] && !minors['PHIL-MINOR']) return false;
  if (!target) return true;
  return window.curriculum.semesters.some((semester) =>
    (semester.courses || []).some((course) => course.code === target));
}, courseCode || '');

const openAddForm = async (page) => {
  await page.locator('.customCourse').click();
  const form = page.locator('.custom_course_modal');
  await expect(form).toBeVisible({ timeout: 10000 });
  return form;
};

const openEditForm = async (page, code) => {
  await page.locator('.manageCustomCourses').click();
  const manage = page.locator('.custom_course_manage_overlay');
  await expect(manage).toBeVisible({ timeout: 10000 });
  await manage.locator('.custom_course_manage_item', { hasText: code })
    .getByRole('button', { name: /edit/i }).click();
  const form = page.locator('.custom_course_modal');
  await expect(form).toBeVisible();
  return form;
};

const fillIdentity = async (form, code, name = `Custom ${code}`, suCredits = '3') => {
  const rows = form.locator('.cc-row');
  await rows.nth(0).locator('input').fill(code);
  await rows.nth(1).locator('input').fill(name);
  await rows.nth(2).locator('input').fill(suCredits);
  await rows.nth(3).locator('input').fill('6');
};

const readProgramDefinitions = (page, programs, code) => page.evaluate(({ keys, target }) => {
  const normalize = (course) => `${course.Major || ''}${course.Code || ''}`.toUpperCase();
  return Object.fromEntries(keys.map((program) => {
    const rows = JSON.parse(window.planStorage.getItem(`customCourses_${program}`) || '[]');
    const course = rows.find((record) => normalize(record) === target);
    return [program, course ? {
      code: normalize(course),
      type: String(course.EL_Type || '').toLowerCase(),
      name: course.Course_Name,
      credits: String(course.SU_credit),
    } : null];
  }));
}, { keys: programs, target: code.toUpperCase() });

const addCourseToFirstSemester = async (page, code) => {
  // Custom-course category tests are independent of the destination term's
  // official schedule, where a newly created code is necessarily absent.
  const offeredOnly = page.locator('#plannerOfferedOnlyToggle');
  if (await offeredOnly.isChecked()) {
    await page.locator('.toggle-switch:has(#plannerOfferedOnlyToggle)').click();
    await expect(offeredOnly).not.toBeChecked();
  }

  const semester = page.locator('.container_semester').first();
  await semester.locator('.addCourse').click();
  await semester.locator('.course_select').fill(code);
  await page.locator(`.course-option[data-code="${code}"]`).first().click();
  await semester.locator('.enter').click();
  const course = page.locator(`.course:has(.course_code:text-is("${code}"))`);
  await expect(course).toHaveCount(1);
  await course.locator('.grade').click();
  await page.locator('.grade-option[data-value="A"]').first().click();
  await page.evaluate(() => window.planStorage.flushSaves());
};

const readMinorAllocation = (page, minor, code) => page.evaluate(({ program, target }) => {
  const fn = window.computeMinorAllocation
    || (typeof computeMinorAllocation === 'function' ? computeMinorAllocation : null);
  const result = fn(window.curriculum, program, { calculateProgramGpa: false });
  const allocation = result.allocationByCode[target] || null;
  return {
    error: result.error || null,
    allocation,
    totals: result.totals,
    storedType: result.courseByCode.get(target)?.__baseCat || null,
  };
}, { program: minor, target: code.toUpperCase() });

module.exports = {
  TERM,
  MINOR_TERM,
  custom,
  categorySelect,
  categoryLabels,
  selectedPrograms,
  waitForPrograms,
  openAddForm,
  openEditForm,
  fillIdentity,
  readProgramDefinitions,
  addCourseToFirstSemester,
  readMinorAllocation,
};
