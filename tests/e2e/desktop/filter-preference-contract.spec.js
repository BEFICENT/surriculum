'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');

const semesterFor = (page, term) => page.locator(
  `.container_semester:has(.date p:text-is("${term}"))`,
);

async function setChecked(locator, checked) {
  if ((await locator.isChecked()) === checked) return;
  // The app's switch inputs are intentionally visually hidden; exercise the
  // associated visible label instead of force-clicking the implementation.
  const label = locator.locator('xpath=ancestor::label[1]');
  await expect(label).toBeVisible();
  await label.click();
  if (checked) await expect(locator).toBeChecked();
  else await expect(locator).not.toBeChecked();
}

async function openPickerFilters(page, term) {
  const semester = semesterFor(page, term);
  await expect(semester).toHaveCount(1);
  await semester.locator('.addCourse').click();
  const picker = semester.locator('.input_container');
  await expect(picker).toBeVisible();
  await picker.locator('.planner-course-filter-btn').click();
  const menu = picker.locator('.planner-course-filter-menu');
  await expect(menu).toBeVisible();
  return { picker, menu };
}

async function closePicker(page, picker) {
  const menu = picker.locator('.planner-course-filter-menu');
  if (await menu.isVisible()) await page.keyboard.press('Escape');
  await picker.locator('.delete_add_course').click();
  await expect(picker).toHaveCount(0);
}

async function openSchedulerFilters(page) {
  await page.locator('#openSchedulerButton').click();
  const modal = page.locator('.scheduler-modal');
  await expect(modal).toBeVisible({ timeout: 15000 });
  await modal.locator('.scheduler-filter-btn').click();
  const menu = modal.locator('.scheduler-filter-menu');
  await expect(menu).toBeVisible();
  return { modal, menu };
}

const BASE_PLAN = {
  major: 'CS',
  entryTerm: 'Fall 2024-2025',
  curriculum: [[]],
  grades: [[]],
  dates: ['Spring 2024-2025'],
  termCodes: ['202402'],
  schedulerSelectedTerm: '202402',
};

test.describe('course-filter preference contract (desktop)', () => {
  test('three shared controls synchronize while offered-only remains a picker default', async ({ page }) => {
    await seedPlan(page, BASE_PLAN);

    const sidebar = {
      details: page.locator('#courseDetailsToggle'),
      hideTaken: page.locator('#hideTakenCoursesToggle'),
      offered: page.locator('#plannerOfferedOnlyToggle'),
      smartSort: page.locator('#sortByScoreToggle'),
    };

    // Sidebar changes become the defaults of a subsequently opened planner picker.
    await setChecked(sidebar.details, false);
    await setChecked(sidebar.hideTaken, false);
    await setChecked(sidebar.offered, false);
    await setChecked(sidebar.smartSort, false);

    let pickerState = await openPickerFilters(page, 'Spring 2024-2025');
    const planner = {
      details: pickerState.menu.locator('.planner-filter-details'),
      hideTaken: pickerState.menu.locator('.planner-filter-hide-taken'),
      offered: pickerState.menu.locator('.planner-filter-offered'),
      smartSort: pickerState.menu.locator('.planner-filter-smart-sort'),
    };
    for (const control of Object.values(planner)) await expect(control).not.toBeChecked();

    // The three shared controls update the sidebar immediately. Offered-only is
    // a per-picker override: changing it must not rewrite the sidebar default.
    await setChecked(planner.details, true);
    await setChecked(planner.hideTaken, true);
    await setChecked(planner.smartSort, true);
    await setChecked(planner.offered, true);
    await expect(sidebar.details).toBeChecked();
    await expect(sidebar.hideTaken).toBeChecked();
    await expect(sidebar.smartSort).toBeChecked();
    await expect(sidebar.offered).not.toBeChecked();
    await closePicker(page, pickerState.picker);

    const scheduler = await openSchedulerFilters(page);
    await expect(scheduler.menu.locator('.scheduler-toggle-details')).toBeChecked();
    await expect(scheduler.menu.locator('.scheduler-toggle-hide-taken')).toBeChecked();
    await expect(scheduler.menu.locator('.scheduler-toggle-score')).toBeChecked();
    await expect(scheduler.menu.locator('.scheduler-toggle-offered')).toHaveCount(0);
    await expect(scheduler.menu).not.toContainText(/only offered in (this|the selected) semester/i);

    await setChecked(scheduler.menu.locator('.scheduler-toggle-details'), false);
    await setChecked(scheduler.menu.locator('.scheduler-toggle-hide-taken'), false);
    await setChecked(scheduler.menu.locator('.scheduler-toggle-score'), false);
    await expect(sidebar.details).not.toBeChecked();
    await expect(sidebar.hideTaken).not.toBeChecked();
    await expect(sidebar.smartSort).not.toBeChecked();
    await expect(sidebar.offered).not.toBeChecked();

    await scheduler.modal.locator('.scheduler-close').click();
    await expect(scheduler.modal).toHaveCount(0);

    pickerState = await openPickerFilters(page, 'Spring 2024-2025');
    await expect(pickerState.menu.locator('.planner-filter-details')).not.toBeChecked();
    await expect(pickerState.menu.locator('.planner-filter-hide-taken')).not.toBeChecked();
    await expect(pickerState.menu.locator('.planner-filter-smart-sort')).not.toBeChecked();
    await expect(pickerState.menu.locator('.planner-filter-offered')).not.toBeChecked();

    const stored = await page.evaluate(() => ({
      details: window.preferenceStorage.getItem('showCourseDetails'),
      hideTaken: window.preferenceStorage.getItem('hideTakenCourses'),
      offered: window.preferenceStorage.getItem('plannerFilterOfferedOnly'),
      smartSort: window.preferenceStorage.getItem('sortBasedOnScore'),
    }));
    expect(stored).toEqual({
      details: 'false',
      hideTaken: 'false',
      offered: 'false',
      smartSort: 'false',
    });
  });

  test('offered-only overrides stay local while every picker uses its exact target term', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [[], []],
      grades: [[], []],
      dates: ['Fall 2026-2027', 'Spring 2026-2027'],
      termCodes: ['202601', '202602'],
    });

    // Keep the fixture independent from scraped schedule snapshots: the two
    // target terms deliberately offer opposite courses.
    await page.evaluate(() => {
      window.__offeredFilterTermLookups = [];
      window.loadTermScheduleIndex = async (termCode) => {
        const code = String(termCode || '');
        window.__offeredFilterTermLookups.push(code);
        if (code === '202601') return new Map([['CS201', { course_id: 'CS201' }]]);
        if (code === '202602') return new Map([['CS204', { course_id: 'CS204' }]]);
        return null;
      };
    });

    const sidebarOffered = page.locator('#plannerOfferedOnlyToggle');
    await setChecked(sidebarOffered, true);

    const fall = await openPickerFilters(page, 'Fall 2026-2027');
    const spring = await openPickerFilters(page, 'Spring 2026-2027');
    const fallOffered = fall.menu.locator('.planner-filter-offered');
    const springOffered = spring.menu.locator('.planner-filter-offered');

    // Both existing pickers inherit the sidebar default when created.
    await expect(fallOffered).toBeChecked();
    await expect(springOffered).toBeChecked();

    await fall.picker.locator('.course_select').fill('CS2');
    await spring.picker.locator('.course_select').fill('CS2');
    await expect(fall.picker.locator('.course-option[data-code="CS201"]')).toBeVisible();
    await expect(fall.picker.locator('.course-option[data-code="CS204"]')).toHaveCount(0);
    await expect(spring.picker.locator('.course-option[data-code="CS204"]')).toBeVisible();
    await expect(spring.picker.locator('.course-option[data-code="CS201"]')).toHaveCount(0);

    const lookups = await page.evaluate(() => window.__offeredFilterTermLookups.slice());
    expect(lookups).toEqual(expect.arrayContaining(['202601', '202602']));

    // Changing Fall is an instance-local override. It neither changes the
    // saved default nor mutates the already-open Spring picker.
    if (!(await fall.menu.isVisible())) {
      await fall.picker.locator('.planner-course-filter-btn').click();
      await expect(fall.menu).toBeVisible();
    }
    await setChecked(fallOffered, false);
    await expect(sidebarOffered).toBeChecked();
    await expect(springOffered).toBeChecked();
    await expect.poll(() => page.evaluate(
      () => window.preferenceStorage.getItem('plannerFilterOfferedOnly'),
    )).toBe('true');

    // Sidebar edits change the default for future pickers only. Spring keeps
    // the value it inherited when it was created.
    await setChecked(sidebarOffered, false);
    await expect(fallOffered).not.toBeChecked();
    await expect(springOffered).toBeChecked();
    await expect.poll(() => page.evaluate(
      () => window.preferenceStorage.getItem('plannerFilterOfferedOnly'),
    )).toBe('false');

    await closePicker(page, fall.picker);
    await closePicker(page, spring.picker);

    // A newly created picker receives the latest sidebar default.
    const reopenedFall = await openPickerFilters(page, 'Fall 2026-2027');
    await expect(reopenedFall.menu.locator('.planner-filter-offered')).not.toBeChecked();
  });

  test('planner-specific filters never overwrite Scheduler defaults', async ({ page }) => {
    await seedPlan(page, BASE_PLAN);
    await page.evaluate(() => {
      const set = (key, value) => window.preferenceStorage.setItem(key, value);
      set('schedulerMinMajorType', 'required');
      set('schedulerMinDmType', 'area');
      set('schedulerMinMinorType', 'core');
      set('schedulerMinSuCredits', '7');
      set('schedulerMinEcts', '8');
      set('schedulerMinBasicScience', '9');
      set('schedulerMinEngineering', '10');
      set('schedulerCheckPrereqs', 'true');
      set('schedulerShowUnmetPrereqs', 'false');

      set('plannerFilterProgram', '');
      set('plannerFilterCategory', '');
      set('plannerFilterLevel', '');
      set('plannerFilterMinSu', '');
      set('plannerFilterMinEcts', '');
      set('plannerFilterMinBasicScience', '');
      set('plannerFilterMinEngineering', '');
      set('plannerFilterCheckPrerequisites', 'true');
      set('plannerFilterShowUnmetPrerequisites', 'true');
    });

    const { picker, menu } = await openPickerFilters(page, 'Spring 2024-2025');
    await menu.locator('.planner-filter-program').selectOption('CS');
    await menu.locator('.planner-filter-category').selectOption('required');
    await menu.locator('.planner-filter-level').selectOption('400');
    await menu.locator('.planner-filter-min-su').fill('1');
    await menu.locator('.planner-filter-min-ects').fill('2');
    await menu.locator('.planner-filter-min-bs').fill('3');
    await menu.locator('.planner-filter-min-engineering').fill('4');
    await setChecked(menu.locator('.planner-filter-show-unmet'), false);
    await setChecked(menu.locator('.planner-filter-prerequisites'), false);

    const values = await page.evaluate(() => {
      const get = (key) => window.preferenceStorage.getItem(key);
      return {
        planner: {
          program: get('plannerFilterProgram'),
          category: get('plannerFilterCategory'),
          level: get('plannerFilterLevel'),
          minSu: get('plannerFilterMinSu'),
          minEcts: get('plannerFilterMinEcts'),
          minBs: get('plannerFilterMinBasicScience'),
          minEngineering: get('plannerFilterMinEngineering'),
          checkPrerequisites: get('plannerFilterCheckPrerequisites'),
          showUnmetPrerequisites: get('plannerFilterShowUnmetPrerequisites'),
        },
        scheduler: {
          mainType: get('schedulerMinMajorType'),
          dmType: get('schedulerMinDmType'),
          minorType: get('schedulerMinMinorType'),
          minSu: get('schedulerMinSuCredits'),
          minEcts: get('schedulerMinEcts'),
          minBs: get('schedulerMinBasicScience'),
          minEngineering: get('schedulerMinEngineering'),
          checkPrerequisites: get('schedulerCheckPrereqs'),
          showUnmetPrerequisites: get('schedulerShowUnmetPrereqs'),
        },
      };
    });
    expect(values.planner).toEqual({
      program: 'CS',
      category: 'required',
      level: '400',
      minSu: '1',
      minEcts: '2',
      minBs: '3',
      minEngineering: '4',
      checkPrerequisites: 'false',
      showUnmetPrerequisites: 'false',
    });
    expect(values.scheduler).toEqual({
      mainType: 'required',
      dmType: 'area',
      minorType: 'core',
      minSu: '7',
      minEcts: '8',
      minBs: '9',
      minEngineering: '10',
      checkPrerequisites: 'true',
      showUnmetPrerequisites: 'false',
    });

    await closePicker(page, picker);
    const scheduler = await openSchedulerFilters(page);
    await expect(scheduler.menu.locator('.scheduler-filter-min-main')).toHaveValue('required');
    await expect(scheduler.menu.locator('.scheduler-filter-min-dm')).toHaveValue('area');
    await expect(scheduler.menu.locator('.scheduler-filter-min-minor')).toHaveValue('core');
    await expect(scheduler.menu.locator('.scheduler-filter-min-su')).toHaveValue('7');
    await expect(scheduler.menu.locator('.scheduler-filter-min-ects')).toHaveValue('8');
    await expect(scheduler.menu.locator('.scheduler-filter-min-bs')).toHaveValue('9');
    await expect(scheduler.menu.locator('.scheduler-filter-min-eng')).toHaveValue('10');
    await expect(scheduler.menu.locator('.scheduler-toggle-prereq')).toBeChecked();
    await expect(scheduler.menu.locator('.scheduler-toggle-show-unmet-prereq')).not.toBeChecked();
  });

  test('legacy offeredThisTermOnly migrates once without deleting or regaining authority', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('offeredThisTermOnly', 'false');
    });
    await seedPlan(page, BASE_PLAN);

    const sidebarOffered = page.locator('#plannerOfferedOnlyToggle');
    await expect(sidebarOffered).not.toBeChecked();
    let { picker, menu } = await openPickerFilters(page, 'Spring 2024-2025');
    await expect(menu.locator('.planner-filter-offered')).not.toBeChecked();
    await closePicker(page, picker);

    let stored = await page.evaluate(() => ({
      genericLegacy: localStorage.getItem('offeredThisTermOnly'),
      scopedLegacy: localStorage.getItem('surriculum.preference.offeredThisTermOnly'),
      planner: localStorage.getItem('surriculum.preference.plannerFilterOfferedOnly'),
    }));
    expect(stored).toEqual({
      genericLegacy: 'false',
      scopedLegacy: 'false',
      planner: 'false',
    });

    await setChecked(sidebarOffered, true);
    await page.reload();
    await expect(page.locator('#plannerOfferedOnlyToggle')).toBeChecked();
    ({ picker, menu } = await openPickerFilters(page, 'Spring 2024-2025'));
    await expect(menu.locator('.planner-filter-offered')).toBeChecked();

    stored = await page.evaluate(() => ({
      legacy: window.preferenceStorage.getItem('offeredThisTermOnly'),
      planner: window.preferenceStorage.getItem('plannerFilterOfferedOnly'),
    }));
    expect(stored).toEqual({ legacy: 'false', planner: 'true' });
  });
});
