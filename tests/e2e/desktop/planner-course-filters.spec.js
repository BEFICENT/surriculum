'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');

const semesterFor = (page, term) => page.locator(
  `.container_semester:has(.date p:text-is("${term}"))`,
);

async function openPicker(page, term) {
  const semester = semesterFor(page, term);
  await expect(semester).toHaveCount(1);
  await semester.locator('.addCourse').click();
  const picker = semester.locator('.input_container');
  await expect(picker).toBeVisible();
  await expect(picker.locator('.course_select')).toBeFocused();
  return picker;
}

async function closePicker(picker) {
  await picker.locator('.delete_add_course').click();
  await expect(picker).toHaveCount(0);
}

async function openFilters(picker) {
  const button = picker.locator('.planner-course-filter-btn');
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await button.click();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  const menu = picker.locator('.planner-course-filter-menu');
  await expect(menu).toBeVisible();
  return { button, menu };
}

async function chooseOptionContaining(select, text) {
  const value = await select.locator('option').evaluateAll((options, needle) => {
    const normalized = String(needle || '').toLowerCase();
    const match = options.find((option) => (
      String(option.textContent || '').toLowerCase().includes(normalized)
    ));
    return match ? match.value : null;
  }, text);
  expect(value, `expected an option containing "${text}"`).not.toBeNull();
  await select.selectOption(value);
}

async function setChecked(locator, checked) {
  if ((await locator.isChecked()) !== checked) {
    if (checked) await locator.check();
    else await locator.uncheck();
  }
}

const courseOption = (picker, code) => picker.locator(`.course-option[data-code="${code}"]`);

const historyRecord = (courseId, terms, values = {}) => ({
  course_id: courseId,
  scrape_ok: values.scrapeOk !== false,
  last_offered_terms: terms.map((term) => ({ term })),
});

async function mockOfferingHistory(page, records) {
  const body = `${records.map((record) => JSON.stringify(record)).join('\n')}\n`;
  await page.addInitScript((jsonl) => {
    // The app has two lazy readers for this index and may have a service worker
    // in a reused local profile. Pin both the shared text cache and fetch so
    // the fixture stays deterministic regardless of which reader starts first.
    window.__courseOfferingsJsonlText = jsonl;
    const nativeFetch = window.fetch.bind(window);
    window.fetch = (resource, options) => {
      const url = typeof resource === 'string'
        ? resource : String(resource && resource.url || '');
      if (url.includes('courses/all_coursepage_info.jsonl')) {
        return Promise.resolve(new Response(jsonl, {
          status: 200,
          headers: { 'Content-Type': 'application/x-ndjson' },
        }));
      }
      return nativeFetch(resource, options);
    };
  }, body);
}

test.describe('planner course filters (desktop)', () => {
  test('close control and Escape dismiss filters, restore focus, and preserve picker-local choices', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [['IF100']],
      grades: [['A']],
      dates: ['Spring 2024-2025'],
      termCodes: ['202402'],
    });

    const picker = await openPicker(page, 'Spring 2024-2025');
    const { button, menu } = await openFilters(picker);
    const closeButton = menu.locator('.planner-course-filter-close');
    await expect(closeButton).toBeVisible();
    await expect(closeButton).toHaveAccessibleName(/close course filters/i);

    await chooseOptionContaining(menu.locator('.planner-filter-level'), '400');
    await setChecked(menu.locator('.planner-filter-show-unmet'), false);
    await closeButton.click();
    await expect(menu).toBeHidden();
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(button).toBeFocused();

    await button.click();
    await expect(menu).toBeVisible();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(menu.locator('.planner-filter-level')).toHaveValue('400');
    await expect(menu.locator('.planner-filter-show-unmet')).not.toBeChecked();

    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(button).toBeFocused();
  });

  test('filter menu is accessible, intersects search, reports results, and resets cleanly', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [['IF100']],
      grades: [['A']],
      dates: ['Spring 2024-2025'],
      termCodes: ['202402'],
    });

    const picker = await openPicker(page, 'Spring 2024-2025');
    const input = picker.locator('.course_select');
    await input.fill('programming fundamentals');
    await expect(courseOption(picker, 'CS201')).toBeVisible();

    const { button, menu } = await openFilters(picker);
    await expect(button).toHaveAccessibleName(/course filters/i);
    await expect(button).toHaveAttribute('aria-controls', await menu.getAttribute('id'));
    await expect(menu).toHaveAttribute('role', 'dialog');
    await expect(menu).toHaveAccessibleName(/course filter options/i);
    await expect(menu.locator('.planner-filter-status')).toHaveAttribute('role', 'status');
    await expect(menu.locator('.planner-filter-status')).toContainText(/\d+\s+courses?/i);
    const countBadge = button.locator('.planner-course-filter-count');
    const initialFilterCount = await countBadge.evaluate((element) => (
      element.hidden ? 0 : Number(element.textContent || 0)
    ));

    await chooseOptionContaining(menu.locator('.planner-filter-level'), '400');
    await expect.poll(async () => Number(await countBadge.textContent())).toBe(initialFilterCount + 1);
    await expect(courseOption(picker, 'CS201')).toHaveCount(0);
    await expect(picker).toContainText(/no courses match/i);

    await menu.locator('.planner-filter-reset').click();
    await expect(courseOption(picker, 'CS201')).toBeVisible();
    await expect(menu.locator('.planner-filter-level')).toHaveValue('');
    await expect(countBadge).toBeHidden();

    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await expect(button).toBeFocused();
  });

  test('program/category and level filters use the selected program classification', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      doubleMajor: 'IE',
      entryTermDM: 'Fall 2024-2025',
      curriculum: [['IF100']],
      grades: [['A']],
      dates: ['Spring 2024-2025'],
      termCodes: ['202402'],
    });

    const picker = await openPicker(page, 'Spring 2024-2025');
    const input = picker.locator('.course_select');
    const { menu } = await openFilters(picker);
    const program = menu.locator('.planner-filter-program');
    const category = menu.locator('.planner-filter-category');

    await input.fill('IE305');
    await chooseOptionContaining(program, 'CS');
    await chooseOptionContaining(category, 'Required');
    await expect(courseOption(picker, 'IE305')).toHaveCount(0);

    // IE305 is Area in the CS catalog but Required for the IE double major.
    await chooseOptionContaining(program, 'IE');
    await expect(courseOption(picker, 'IE305')).toBeVisible();

    await menu.locator('.planner-filter-reset').click();
    await input.fill('CS');
    await chooseOptionContaining(menu.locator('.planner-filter-level'), '400');
    await expect(courseOption(picker, 'CS401')).toBeVisible();
    await expect(courseOption(picker, 'CS201')).toHaveCount(0);
  });

  test('legacy CS210 search resolves DSA210 and hide-taken uses the canonical identity', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [['CS210'], []],
      grades: [['A'], []],
      dates: ['Fall 2024-2025', 'Spring 2024-2025'],
      termCodes: ['202401', '202402'],
    });

    const picker = await openPicker(page, 'Spring 2024-2025');
    const { menu } = await openFilters(picker);
    const hideTaken = menu.locator('.planner-filter-hide-taken');
    await setChecked(hideTaken, false);

    await picker.locator('.course_select').fill('CS210');
    await expect(courseOption(picker, 'DSA210')).toHaveCount(1);
    await expect(courseOption(picker, 'DSA210')).toBeVisible();

    await setChecked(hideTaken, true);
    await expect(courseOption(picker, 'DSA210')).toHaveCount(0);

    await setChecked(hideTaken, false);
    await picker.locator('.course_select').fill('DSA210');
    await expect(courseOption(picker, 'DSA210')).toBeVisible();
  });

  test('prerequisite filtering follows each target term code, not card order', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      // Deliberately newest-to-oldest visually. MATH101 is chronologically
      // after Fall but before Summer.
      curriculum: [[], [], ['MATH101']],
      grades: [[], [], ['A']],
      dates: ['Summer 2024-2025', 'Fall 2024-2025', 'Spring 2024-2025'],
      termCodes: ['202403', '202401', '202402'],
    });

    const fallPicker = await openPicker(page, 'Fall 2024-2025');
    await fallPicker.locator('.course_select').fill('MATH102');
    const fallOption = courseOption(fallPicker, 'MATH102');
    await expect(fallOption).toBeVisible();
    await expect(fallOption).toHaveAttribute('data-requisite-state', 'unmet');
    await expect(fallOption).toContainText(/MATH101/i);
    let controls = await openFilters(fallPicker);
    await setChecked(controls.menu.locator('.planner-filter-prerequisites'), true);
    await setChecked(controls.menu.locator('.planner-filter-show-unmet'), false);
    await expect(fallOption).toHaveCount(0);
    await closePicker(fallPicker);

    const summerPicker = await openPicker(page, 'Summer 2024-2025');
    await summerPicker.locator('.course_select').fill('MATH102');
    controls = await openFilters(summerPicker);
    await setChecked(controls.menu.locator('.planner-filter-prerequisites'), true);
    await setChecked(controls.menu.locator('.planner-filter-show-unmet'), false);
    const summerOption = courseOption(summerPicker, 'MATH102');
    await expect(summerOption).toBeVisible();
    await expect(summerOption).toHaveAttribute('data-requisite-state', 'met');
  });

  test('prior-SU filtering observes the exact earlier-term boundary for SPS303', async ({ page }) => {
    const prior56 = [
      'IF100', 'MATH101', 'SPS101', 'AL102', 'MATH102', 'SPS102',
      'HUM201', 'HUM202', 'HUM207', 'HUM311', 'HUM312', 'HUM317',
      'CS201', 'CS204', 'CS300', 'CS301', 'CS302', 'CS305', 'TLL101',
    ];
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [prior56, ['TLL102'], []],
      grades: [prior56.map(() => ''), [''], []],
      dates: ['Fall 2024-2025', 'Spring 2024-2025', 'Summer 2024-2025'],
      termCodes: ['202401', '202402', '202403'],
    });

    const springPicker = await openPicker(page, 'Spring 2024-2025');
    await springPicker.locator('.course_select').fill('SPS303');
    const springOption = courseOption(springPicker, 'SPS303');
    await expect(springOption).toBeVisible();
    await expect(springOption).toHaveAttribute('data-requisite-state', 'unmet');
    await expect(springOption).toContainText(/56 of 58 SU/i);
    let controls = await openFilters(springPicker);
    await setChecked(controls.menu.locator('.planner-filter-prerequisites'), true);
    await setChecked(controls.menu.locator('.planner-filter-show-unmet'), false);
    await expect(springOption).toHaveCount(0);
    await closePicker(springPicker);

    // TLL102 is same-term for Spring and therefore excluded there; it becomes
    // prior credit for Summer and takes the running total exactly to 58 SU.
    const summerPicker = await openPicker(page, 'Summer 2024-2025');
    await summerPicker.locator('.course_select').fill('SPS303');
    controls = await openFilters(summerPicker);
    await setChecked(controls.menu.locator('.planner-filter-prerequisites'), true);
    await setChecked(controls.menu.locator('.planner-filter-show-unmet'), false);
    const summerOption = courseOption(summerPicker, 'SPS303');
    await expect(summerOption).toBeVisible();
    await expect(summerOption).toHaveAttribute('data-requisite-state', 'met');
  });

  test('offered filtering uses the exact target term and keeps unknown data visible', async ({ page }) => {
    const custom = {
      Major: 'ZZZ',
      Code: '925',
      Course_Name: 'Offering Unknown Course',
      ECTS: '5',
      Engineering: 0,
      Basic_Science: 0,
      SU_credit: '2.5',
      Faculty: '',
      Faculty_Course: 'No',
      EL_Type: 'free',
    };
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      customCourses: { CS: [custom] },
      curriculum: [['IF100'], []],
      grades: [['A'], []],
      dates: ['Fall 2026-2027', 'Fall 2028-2029'],
      termCodes: ['202601', '202801'],
    });

    const knownPicker = await openPicker(page, 'Fall 2026-2027');
    let controls = await openFilters(knownPicker);
    await setChecked(controls.menu.locator('.planner-filter-offered'), true);
    await knownPicker.locator('.course_select').fill('CS201');
    await expect(courseOption(knownPicker, 'CS201')).toBeVisible({ timeout: 15000 });
    await expect(courseOption(knownPicker, 'CS201')).toHaveAttribute('data-offering-state', 'offered');
    await knownPicker.locator('.course_select').fill('CS395');
    await expect(courseOption(knownPicker, 'CS395')).toHaveCount(0);
    await closePicker(knownPicker);

    const unknownPicker = await openPicker(page, 'Fall 2028-2029');
    controls = await openFilters(unknownPicker);
    await setChecked(controls.menu.locator('.planner-filter-offered'), true);
    await unknownPicker.locator('.course_select').fill('ZZZ925');
    const unknown = courseOption(unknownPicker, 'ZZZ925');
    await expect(unknown).toBeVisible({ timeout: 15000 });
    await expect(unknown).toHaveAttribute('data-offering-state', 'unknown');
  });

  test('historical offering tags stay advisory with prerequisites disabled and sparse data fails open', async ({ page }) => {
    await mockOfferingHistory(page, [
      historyRecord('CS301', [
        'Spring 2022-2023',
        'Spring 2023-2024',
        'Spring 2024-2025',
      ]),
      historyRecord('CS302', ['Spring 2024-2025']),
      historyRecord('CS401', [
        'Fall 2021-2022',
        'Spring 2023-2024',
      ]),
    ]);
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [['IF100']],
      grades: [['']],
      dates: ['Fall 2028-2029'],
      termCodes: ['202801'],
    });
    await page.evaluate(() => {
      window.preferenceStorage.setItem('plannerFilterCheckPrerequisites', 'false');
      // Cadence is deliberately evaluated against the real current term. Pin
      // this fixture to the Summer reference it was authored for so crossing
      // an academic-year boundary cannot silently change "limited" to
      // "regular" (or eventually "irregular").
      window.currentTermCode = '202503';
    });

    const picker = await openPicker(page, 'Fall 2028-2029');
    const input = picker.locator('.course_select');
    const { menu } = await openFilters(picker);
    await expect(menu.locator('.planner-filter-prerequisites')).not.toBeChecked();
    await page.keyboard.press('Escape');

    await input.fill('CS301');
    const seasonal = courseOption(picker, 'CS301');
    await expect(seasonal).toHaveAttribute('data-offering-pattern', 'no-fall');
    await expect(seasonal).toHaveAttribute('data-offering-cadence', 'limited');
    await expect(seasonal.locator('[data-badge-kind="history-season"]'))
      .toHaveText('No Fall offerings found');

    await input.fill('CS401');
    const irregular = courseOption(picker, 'CS401');
    await expect(irregular).toHaveAttribute('data-offering-pattern', 'irregular');
    await expect(irregular).toHaveAttribute('data-offering-cadence', 'irregular');
    await expect(irregular.locator('[data-badge-kind="history-cadence"]'))
      .toHaveText('Not offered every year');

    await input.fill('CS302');
    const sparse = courseOption(picker, 'CS302');
    await expect(sparse).toHaveAttribute('data-offering-pattern', 'limited');
    await expect(sparse).toHaveAttribute('data-offering-cadence', 'limited');
    await expect(sparse.locator('[data-badge-kind^="history-"]')).toHaveCount(0);
    await expect(sparse).toBeVisible();
  });

  test('Summer history tags stay advisory with prerequisites disabled and invalid evidence fails open', async ({ page }) => {
    await mockOfferingHistory(page, [
      historyRecord('CS301', [
        'Fall 2022-2023',
        'Spring 2023-2024',
        'Fall 2024-2025',
      ]),
      historyRecord('CS302', [
        'Fall 2023-2024',
        'Spring 2023-2024',
        'Fall 2024-2025',
      ]),
      historyRecord('CS401', [
        'Fall 2022-2023',
        'Spring 2023-2024',
        'Fall 2024-2025',
      ], { scrapeOk: false }),
    ]);
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [['IF100']],
      grades: [['']],
      dates: ['Summer 2028-2029'],
      termCodes: ['202803'],
    });
    await page.evaluate(() => {
      window.preferenceStorage.setItem('plannerFilterCheckPrerequisites', 'false');
    });

    const picker = await openPicker(page, 'Summer 2028-2029');
    const input = picker.locator('.course_select');
    const { menu } = await openFilters(picker);
    await expect(menu.locator('.planner-filter-prerequisites')).not.toBeChecked();
    await page.keyboard.press('Escape');

    await input.fill('CS301');
    const seasonal = courseOption(picker, 'CS301');
    await expect(seasonal).toHaveAttribute('data-offering-pattern', 'no-summer');
    await expect(seasonal.locator('[data-badge-kind="history-season"]'))
      .toHaveText('No Summer offerings found');
    await expect(seasonal.locator('[data-badge-kind^="history-"]')).toHaveCount(1);

    // Multiple regular terms in only two academic years are still sparse;
    // within-year observations must not inflate the Summer evidence threshold.
    await input.fill('CS302');
    const sparse = courseOption(picker, 'CS302');
    await expect(sparse).toHaveAttribute('data-offering-pattern', 'limited');
    await expect(sparse.locator('[data-badge-kind^="history-"]')).toHaveCount(0);
    await expect(sparse).toBeVisible();

    await input.fill('CS401');
    const failed = courseOption(picker, 'CS401');
    await expect(failed).toHaveAttribute('data-offering-pattern', 'unknown');
    await expect(failed.locator('[data-badge-kind^="history-"]')).toHaveCount(0);
    await expect(failed).toBeVisible();
  });

  test('an exact offered result suppresses every conflicting picker advisory', async ({ page }) => {
    await mockOfferingHistory(page, [
      historyRecord('CS201', [
        // Three Fall observations support the seasonal signal, while the
        // gaps inside the completed-year window support irregular cadence.
        'Fall 2018-2019',
        'Fall 2021-2022',
        'Fall 2023-2024',
      ]),
    ]);
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [['IF100']],
      grades: [['']],
      dates: ['Spring 2026-2027'],
      termCodes: ['202602'],
    });

    const picker = await openPicker(page, 'Spring 2026-2027');
    await picker.locator('.course_select').fill('CS201');
    const option = courseOption(picker, 'CS201');
    // Exact offering evidence is loaded for annotation even while the
    // Offered-only filter is off; users should never see a contradictory
    // historical warning flash as the stronger schedule data arrives.
    await expect(option).toHaveAttribute('data-offering-state', 'offered', {
      timeout: 15000,
    });
    await expect(option).toHaveAttribute('data-offering-pattern', 'known');
    await expect(option.locator('[data-badge-kind^="history-"]')).toHaveCount(0);

    const { menu } = await openFilters(picker);
    await setChecked(menu.locator('.planner-filter-offered'), true);
    await expect(option).toBeVisible({ timeout: 15000 });
    await expect(option).toHaveAttribute('data-offering-state', 'offered');
    await expect(option).toHaveAttribute('data-offering-pattern', 'known');
    await expect(option.locator('[data-badge-kind^="history-"]')).toHaveCount(0);
  });

  test('planned-course tags skip earned cards and defer to exact target schedules', async ({ page }) => {
    await mockOfferingHistory(page, [
      historyRecord('CS201', [
        // Both regular seasons are represented, so this produces only the
        // cadence advisory. The card must still consult the exact schedule.
        'Fall 2018-2019',
        'Fall 2021-2022',
        'Spring 2023-2024',
      ]),
      historyRecord('CS301', [
        'Spring 2022-2023',
        'Spring 2023-2024',
        'Spring 2024-2025',
      ]),
      historyRecord('CS302', [
        'Fall 2022-2023',
        'Fall 2023-2024',
        'Fall 2024-2025',
      ]),
    ]);
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [['CS302'], ['CS201'], ['CS301']],
      grades: [['A'], [''], ['']],
      dates: ['Spring 2023-2024', 'Fall 2026-2027', 'Fall 2028-2029'],
      termCodes: ['202302', '202601', '202801'],
    });

    const earned = semesterFor(page, 'Spring 2023-2024')
      .locator('.course:has(.course_code:text-is("CS302"))');
    await expect(earned.locator('.planner-course-offering-tags')).toHaveCount(0);

    // CS201 is listed in the exact 202601 schedule. That positive evidence is
    // stronger than the synthetic irregular history and removes its cadence
    // advisory too.
    const exactOffered = semesterFor(page, 'Fall 2026-2027')
      .locator('.course:has(.course_code:text-is("CS201"))');

    // 202801 has no exact schedule snapshot, so unknown fails open and the
    // conservative history advisory remains visible on the planned card.
    const future = semesterFor(page, 'Fall 2028-2029')
      .locator('.course:has(.course_code:text-is("CS301"))');
    const tags = future.locator('.planner-course-offering-tags');
    await expect(tags).toHaveAttribute('data-offering-history-state', 'known', {
      timeout: 15000,
    });
    await expect(tags.locator('[data-offering-advisory="no-fall"]'))
      .toHaveText('No Fall offerings found');
    // The future tag proves this async render pass has completed, so absence
    // here is the exact-schedule precedence result rather than an early read.
    await expect(exactOffered.locator('.planner-course-offering-tags')).toHaveCount(0);
  });

  test('planned Summer cards are tagged only in Summer and yield to an exact offering', async ({ page }) => {
    const regularHistory = [
      'Fall 2022-2023',
      'Spring 2023-2024',
      'Fall 2024-2025',
    ];
    await mockOfferingHistory(page, [
      historyRecord('CS201', regularHistory),
      historyRecord('CS301', regularHistory),
      historyRecord('CS302', regularHistory),
    ]);
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [['CS201'], ['CS301'], ['CS302']],
      grades: [[''], [''], ['']],
      dates: ['Summer 2025-2026', 'Summer 2028-2029', 'Fall 2028-2029'],
      termCodes: ['202503', '202803', '202801'],
    });

    const futureSummer = semesterFor(page, 'Summer 2028-2029')
      .locator('.course:has(.course_code:text-is("CS301"))');
    const futureTags = futureSummer.locator('.planner-course-offering-tags');
    await expect(futureTags).toHaveAttribute('data-offering-history-state', 'known', {
      timeout: 15000,
    });
    await expect(futureTags.locator('[data-offering-advisory="no-summer"]'))
      .toHaveText('No Summer offerings found');

    // The same history is not a warning in a regular semester.
    const fall = semesterFor(page, 'Fall 2028-2029')
      .locator('.course:has(.course_code:text-is("CS302"))');
    await expect(fall.locator('.planner-course-offering-tags')).toHaveCount(0);

    // CS201 is in the exact 202503 schedule. The stronger selected-term
    // evidence suppresses the otherwise-applicable Summer history tag.
    const exactOffered = semesterFor(page, 'Summer 2025-2026')
      .locator('.course:has(.course_code:text-is("CS201"))');
    await expect(exactOffered.locator('.planner-course-offering-tags')).toHaveCount(0);
  });

  test('a conflicting stored semester identity produces no card tag or schedule lookup', async ({ page }) => {
    await mockOfferingHistory(page, [
      historyRecord('CS301', [
        'Spring 2022-2023',
        'Spring 2023-2024',
        'Spring 2024-2025',
      ]),
    ]);
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [['CS301']],
      grades: [['']],
      dates: ['Fall 2028-2029'],
      termCodes: ['202801'],
    });

    const card = semesterFor(page, 'Fall 2028-2029')
      .locator('.course:has(.course_code:text-is("CS301"))');
    await expect(card.locator('[data-offering-advisory="no-fall"]'))
      .toHaveText('No Fall offerings found', { timeout: 15000 });

    const result = await page.evaluate(async () => {
      const semester = window.curriculum.semesters[0];
      // Neither side was used in the initial render, so a schedule lookup here
      // would expose code- or label-precedence instead of canonical fail-open.
      semester.termCode = '202901';
      semester.termName = 'Spring 2028-2029';
      semester.date = 'Spring 2028-2029';
      const scheduleLookups = [];
      const original = window.loadTermScheduleIndex;
      window.loadTermScheduleIndex = function wrappedScheduleLookup(termCode) {
        scheduleLookups.push(String(termCode || ''));
        return original.apply(this, arguments);
      };
      try {
        const canonicalTermCode = window.semesterTermCode(semester);
        await window.courseRequisites.refreshPlannerWarnings();
        return { canonicalTermCode, scheduleLookups };
      } finally {
        window.loadTermScheduleIndex = original;
      }
    });

    expect(result.canonicalTermCode).toBe('');
    expect(result.scheduleLookups).toEqual([]);
    await expect(card.locator('.planner-course-offering-tags')).toHaveCount(0);
  });
});
