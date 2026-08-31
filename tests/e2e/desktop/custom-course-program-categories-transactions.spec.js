'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');
const {
  TERM,
  custom,
  selectedPrograms,
  waitForPrograms,
  openEditForm,
  readProgramDefinitions,
} = require('../helpers/custom-course-program-categories');

test.describe('per-program custom-course categories', () => {
  test('bulk deletion preserves official courses and unrelated secondary overlays', async ({ page }) => {
    const codes = ['CS201', 'DSA395', 'FIN301'];
    await seedPlan(page, {
      ...selectedPrograms({ minor2: null, minor3: null }),
      customCourses: {
        CS: [custom('CS201', 'free', { Course_Name: 'Dormant CS override' })],
        DSA: [
          custom('CS201', 'area', {
            Course_Name: 'Linked DSA overlay',
            Engineering: 6,
          }),
          custom('DSA395', 'free', {
            Course_Name: 'Dormant DSA override',
            ECTS: '5',
            Engineering: 5,
            SU_credit: '0',
            Faculty: 'FENS',
          }),
          // Keep an unrelated DSA overlay to prove bulk deletion filters by
          // the primary custom-course code instead of clearing the whole key.
          custom('FIN301', 'none', { Course_Name: 'Unrelated DSA classification' }),
        ],
        'FIN-MINOR': [
          custom('CS201', 'free', { Course_Name: 'Linked FIN overlay' }),
          custom('FIN301', 'area', { Course_Name: 'Dormant FIN override' }),
        ],
      },
      curriculum: [codes],
      grades: [['A', 'A', 'A']],
      dates: [TERM],
    });
    await waitForPrograms(page, 'CS201');
    await page.waitForFunction(() => window.curriculum
      && Array.isArray(window.curriculum.doubleMajorCourseData)
      && window.curriculum.doubleMajorCourseData.some((course) =>
        `${course.Major || ''}${course.Code || ''}` === 'DSA395'));
    await expect(page.locator('.modal-overlay:visible'), 'exact catalog credits avoid the repair notice')
      .toHaveCount(0);
    await expect(page.locator('.double_major_overlay'), 'all planned codes are already classified')
      .toHaveCount(0);

    const before = await page.evaluate((targets) => ({
      occurrenceCodes: window.curriculum.semesters.flatMap((semester) => semester.courses)
        .map((course) => course.code).filter((code) => targets.includes(code)).sort(),
      primaryRows: course_data.filter((course) => `${course.Major}${course.Code}` === 'CS201')
        .map((course) => course.EL_Type),
      dmRows: window.curriculum.doubleMajorCourseData
        .filter((course) => `${course.Major}${course.Code}` === 'DSA395')
        .map((course) => course.EL_Type),
      minorRows: window.curriculum.minorCourseDataByCode['FIN-MINOR']
        .filter((course) => `${course.Major}${course.Code}` === 'FIN301')
        .map((course) => course.EL_Type),
    }), codes);
    expect(before.occurrenceCodes).toEqual(codes.slice().sort());
    expect(before.primaryRows).toEqual(['required']);
    expect(before.dmRows).toEqual(['required']);
    expect(before.minorRows).toEqual(['required']);

    await page.locator('.deleteCustom').click();
    const confirm = page.locator('.modal-overlay').filter({ hasText: /Delete custom courses/i });
    await expect(confirm).toBeVisible();
    await Promise.all([
      page.waitForNavigation(),
      confirm.getByRole('button', { name: 'Delete', exact: true }).click(),
    ]);
    await waitForPrograms(page, 'CS201');

    const after = await page.evaluate((targets) => ({
      occurrenceCodes: window.curriculum.semesters.flatMap((semester) => semester.courses)
        .map((course) => course.code).filter((code) => targets.includes(code)).sort(),
      storage: ['CS', 'DSA', 'FIN-MINOR'].map((program) =>
        JSON.parse(window.planStorage.getItem(`customCourses_${program}`) || '[]')),
    }), codes);
    expect(after.occurrenceCodes).toEqual(codes.slice().sort());
    expect(after.storage[0]).toEqual([]);
    expect(after.storage[1]).toEqual(expect.arrayContaining([
      expect.objectContaining({ Major: 'DSA', Code: '395', EL_Type: 'free' }),
      expect.objectContaining({ Major: 'FIN', Code: '301', EL_Type: 'none' }),
    ]));
    expect(after.storage[2]).toEqual([
      expect.objectContaining({ Major: 'FIN', Code: '301', EL_Type: 'area' }),
    ]);
  });

  test('rename and delete update every selected program overlay', async ({ page }) => {
    const oldCode = 'ZZZ660';
    const nextCode = 'ZZZ661';
    const programs = ['CS', 'DSA', 'FIN-MINOR', 'ANALY-MINOR', 'PHIL-MINOR'];
    const types = ['core', 'area', 'required', 'core', 'free'];
    await seedPlan(page, {
      ...selectedPrograms(),
      customCourses: Object.fromEntries(programs.map((program, index) => [
        program, [custom(oldCode, types[index], { Course_Name: 'Durable original' })],
      ])),
      curriculum: [[oldCode]],
      grades: [['B+']],
      gradingBases: [['letter']],
      dates: [TERM],
    });
    await waitForPrograms(page, oldCode);

    const form = await openEditForm(page, oldCode);
    await form.locator('.cc-row').nth(0).locator('input').fill(nextCode);
    await form.locator('.cc-row').nth(1).locator('input').fill('Renamed everywhere');
    await form.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(form).toBeHidden();

    let renamed = await readProgramDefinitions(page, programs, nextCode);
    for (let i = 0; i < programs.length; i++) {
      expect(renamed[programs[i]]).toMatchObject({
        code: nextCode, type: types[i], name: 'Renamed everywhere', credits: '3',
      });
    }
    const old = await readProgramDefinitions(page, programs, oldCode);
    for (const program of programs) expect(old[program]).toBeNull();

    await page.reload();
    await waitForPrograms(page, nextCode);
    renamed = await readProgramDefinitions(page, programs, nextCode);
    for (let i = 0; i < programs.length; i++) expect(renamed[programs[i]]?.type).toBe(types[i]);

    await page.locator('.manageCustomCourses').click();
    const manage = page.locator('.custom_course_manage_overlay');
    await manage.locator('.custom_course_manage_item', { hasText: nextCode })
      .getByRole('button', { name: /delete/i }).click();
    const confirm = page.locator('.modal-overlay').filter({ hasText: /Delete custom course/i });
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click();

    await expect(page.locator('.course_code', { hasText: nextCode })).toHaveCount(0);
    const deleted = await readProgramDefinitions(page, programs, nextCode);
    for (const program of programs) expect(deleted[program]).toBeNull();
  });

  test('a later program-key write failure rolls back every earlier category and the planner rename', async ({ page, browserErrors }) => {
    const oldCode = 'ZZZ670';
    const nextCode = 'ZZZ671';
    const programs = ['CS', 'DSA', 'FIN-MINOR', 'ANALY-MINOR', 'PHIL-MINOR'];
    const types = ['core', 'area', 'required', 'core', 'free'];
    await seedPlan(page, {
      ...selectedPrograms(),
      customCourses: Object.fromEntries(programs.map((program, index) => [
        program, [custom(oldCode, types[index], { Course_Name: 'Before failed rename' })],
      ])),
      curriculum: [[oldCode]],
      grades: [['A-']],
      gradingBases: [['letter']],
      dates: [TERM],
    });
    await waitForPrograms(page, oldCode);

    await page.evaluate((rejectedCode) => {
      const original = Storage.prototype.setItem;
      window.__programCategoryStorageSetItem = original;
      window.__programCategoryWriteCount = 0;
      Storage.prototype.setItem = function setItemWithNthFailure(key, value) {
        let writesRejectedCode = false;
        try {
          writesRejectedCode = JSON.parse(String(value || '[]')).some((course) =>
            `${course.Major || ''}${course.Code || ''}`.toUpperCase() === rejectedCode);
        } catch (_) {}
        const isCandidateWrite = String(key || '').includes('customCourses_')
          && writesRejectedCode;
        if (isCandidateWrite) window.__programCategoryWriteCount += 1;
        if (isCandidateWrite && window.__programCategoryWriteCount === 4) {
          throw new DOMException('Synthetic custom-course quota failure', 'QuotaExceededError');
        }
        return original.call(this, key, value);
      };
    }, nextCode);

    const form = await openEditForm(page, oldCode);
    await form.locator('.cc-row').nth(0).locator('input').fill(nextCode);
    await form.locator('.cc-row').nth(1).locator('input').fill('Must roll back');
    await form.getByRole('button', { name: 'Save', exact: true }).click();
    const warning = page.locator('.modal-overlay').filter({ hasText: /Could not/i });
    const interception = await page.evaluate(() => ({
      count: window.__programCategoryWriteCount,
      keys: ['CS', 'DSA', 'FIN-MINOR', 'ANALY-MINOR', 'PHIL-MINOR'].map((program) => ({
        program,
        codes: JSON.parse(window.planStorage.getItem(`customCourses_${program}`) || '[]')
          .map((course) => `${course.Major}${course.Code}`),
      })),
    }));
    await expect(warning, JSON.stringify(interception)).toBeVisible();
    const expectedErrorIndex = browserErrors.findIndex((message) =>
      /console\.error: Failed to save plan data: QuotaExceededError/.test(message));
    expect(expectedErrorIndex).toBeGreaterThanOrEqual(0);
    browserErrors.splice(expectedErrorIndex, 1);
    await warning.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(form, 'the failed transaction remains reviewable').toBeVisible();

    const state = await page.evaluate(({ oldTarget, newTarget, keys }) => {
      const original = window.__programCategoryStorageSetItem;
      const read = (program) => JSON.parse(
        window.planStorage.getItem(`customCourses_${program}`) || '[]',
      );
      const normalize = (course) => `${course.Major || ''}${course.Code || ''}`;
      const result = {
        definitions: Object.fromEntries(keys.map((program) => [program, read(program).map(normalize)])),
        oldOccurrence: window.curriculum.hasCourse(oldTarget),
        newOccurrence: window.curriculum.hasCourse(newTarget),
        renderedOld: Array.from(document.querySelectorAll('.course_code'))
          .some((node) => node.textContent === oldTarget),
      };
      Storage.prototype.setItem = original;
      delete window.__programCategoryStorageSetItem;
      delete window.__programCategoryWriteCount;
      return result;
    }, { oldTarget: oldCode, newTarget: nextCode, keys: programs });
    expect(state.oldOccurrence).toBe(true);
    expect(state.newOccurrence).toBe(false);
    expect(state.renderedOld).toBe(true);
    for (const program of programs) expect(state.definitions[program]).toEqual([oldCode]);
  });
});
