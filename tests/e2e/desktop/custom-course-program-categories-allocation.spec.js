'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');
const {
  TERM,
  custom,
  categorySelect,
  categoryLabels,
  selectedPrograms,
  waitForPrograms,
  openAddForm,
  openEditForm,
  fillIdentity,
  readProgramDefinitions,
  readMinorAllocation,
} = require('../helpers/custom-course-program-categories');

test.describe('per-program custom-course categories', () => {
  test('program role swaps, duplicate minors, and remove/re-add keep categories tied to codes', async ({ page }) => {
    const code = 'ZZZ630';
    const records = {
      CS: [custom(code, 'core')],
      IE: [custom(code, 'area')],
      'FIN-MINOR': [custom(code, 'required')],
      'ANALY-MINOR': [custom(code, 'core')],
      'PHIL-MINOR': [custom(code, 'free')],
    };
    await seedPlan(page, {
      ...selectedPrograms({ doubleMajor: 'IE' }),
      customCourses: records,
      curriculum: [[code]],
      grades: [['A']],
      dates: [TERM],
    });
    await waitForPrograms(page, code);

    let form = await openEditForm(page, code);
    expect(await categoryLabels(form)).toEqual([
      'ANALY-MINOR Category', 'CS Category', 'FIN-MINOR Category',
      'IE Category', 'PHIL-MINOR Category',
    ]);
    await expect(categorySelect(form, 'CS')).toHaveValue('core');
    await expect(categorySelect(form, 'IE')).toHaveValue('area');
    await form.getByRole('button', { name: 'Cancel', exact: true }).click();

    // Swap which code is the main versus double-major program, select FIN
    // twice, and temporarily remove ANALY. The category follows its program
    // key, while a duplicate selected minor produces only one selector.
    await page.evaluate(() => {
      window.planStorage.setItem('major', 'IE');
      window.planStorage.setItem('doubleMajor', 'CS');
      window.planStorage.setItem('minor1', 'FIN-MINOR');
      window.planStorage.setItem('minor2', 'FIN-MINOR');
      window.planStorage.setItem('minor3', 'PHIL-MINOR');
    });
    await page.reload();
    await waitForPrograms(page, code);

    form = await openEditForm(page, code);
    expect(await categoryLabels(form)).toEqual([
      'CS Category', 'FIN-MINOR Category', 'IE Category', 'PHIL-MINOR Category',
    ]);
    await expect(categorySelect(form, 'IE'), 'IE remains area when it becomes the main major')
      .toHaveValue('area');
    await expect(categorySelect(form, 'CS'), 'CS remains core when it becomes the double major')
      .toHaveValue('core');
    await expect(form.locator('.cc-row').filter({ hasText: /^\s*FIN-MINOR Category:?/ }))
      .toHaveCount(1);
    await form.getByRole('button', { name: 'Cancel', exact: true }).click();

    // Re-adding a previously removed minor recovers that minor's own durable
    // category rather than copying whichever selector currently occupies its slot.
    await page.evaluate(() => window.planStorage.setItem('minor2', 'ANALY-MINOR'));
    await page.reload();
    await waitForPrograms(page, code);
    form = await openEditForm(page, code);
    await expect(categorySelect(form, 'ANALY-MINOR')).toHaveValue('core');
    await expect(categorySelect(form, 'FIN-MINOR')).toHaveValue('required');
  });

  test('minor none, unknown, and university categories remain unallocated instead of falling back to free', async ({ page }) => {
    const noneCode = 'ZZZ640';
    const unknownCode = 'ZZZ641';
    const universityCode = 'ZZZ642';
    await seedPlan(page, {
      ...selectedPrograms({ doubleMajor: null, minor2: null, minor3: null }),
      customCourses: {
        CS: [custom(noneCode, 'free'), custom(unknownCode, 'free'), custom(universityCode, 'free')],
        'FIN-MINOR': [
          custom(noneCode, 'none'),
          custom(unknownCode, 'unknown'),
          custom(universityCode, 'university'),
        ],
      },
      curriculum: [[noneCode, unknownCode, universityCode]],
      grades: [['A', 'A', 'A']],
      dates: [TERM],
    });
    await waitForPrograms(page, noneCode);

    for (const code of [noneCode, unknownCode, universityCode]) {
      const result = await readMinorAllocation(page, 'FIN-MINOR', code);
      expect(result.allocation, `${code} must not become a free minor elective`).toBeNull();
      expect(result.totals.free).toEqual({ courses: 0, credits: 0 });
    }
  });

  test('the official minor catalog remains authoritative over a colliding overlay', async ({ page }) => {
    const code = 'FIN301';
    await seedPlan(page, {
      ...selectedPrograms({ doubleMajor: null, minor2: null, minor3: null }),
      customCourses: {
        CS: [custom(code, 'core', { Course_Name: 'Attempted primary override' })],
        'FIN-MINOR': [custom(code, 'area', { Course_Name: 'Attempted override' })],
      },
      curriculum: [[code]],
      grades: [['A']],
      dates: [TERM],
    });
    await waitForPrograms(page, code);

    const form = await openEditForm(page, code);
    await expect(categorySelect(form, 'CS')).toBeDisabled();
    await expect(categorySelect(form, 'CS')).toHaveValue('free');
    await expect(form.locator('.cc-row').filter({ hasText: /^\s*CS Category:/ }))
      .toContainText('The official catalog category applies to this course.');
    await expect(categorySelect(form, 'FIN-MINOR')).toBeDisabled();
    await expect(categorySelect(form, 'FIN-MINOR')).toHaveValue('required');
    await expect(form.locator('.cc-program-category-row[data-program="FIN-MINOR"]'))
      .toContainText('The official catalog category applies to this course.');
    await form.getByRole('button', { name: 'Cancel', exact: true }).click();

    const result = await page.evaluate((target) => {
      const rows = window.curriculum.minorCourseDataByCode['FIN-MINOR']
        .filter((course) => `${course.Major || ''}${course.Code || ''}` === target);
      const fn = window.computeMinorAllocation
        || (typeof computeMinorAllocation === 'function' ? computeMinorAllocation : null);
      const allocation = fn(window.curriculum, 'FIN-MINOR', { calculateProgramGpa: false });
      return {
        runtime: rows.map((course) => ({ type: course.EL_Type, name: course.Course_Name })),
        allocated: allocation.allocationByCode[target],
        storedPrimary: JSON.parse(window.planStorage.getItem('customCourses_CS') || '[]')[0],
        storedOverlay: JSON.parse(window.planStorage.getItem('customCourses_FIN-MINOR') || '[]')[0],
      };
    }, code);
    expect(result.runtime).toEqual([{ type: 'required', name: 'Financial Management' }]);
    expect(result.allocated).toMatchObject({ baseCat: 'required', allocatedCat: 'required' });
    // Keeping the dormant stored choice is useful if the user changes to a
    // catalog where the code is not official; it simply must not override this catalog.
    expect(result.storedPrimary.EL_Type).toBe('core');
    expect(result.storedOverlay.EL_Type).toBe('area');
  });

  test('custom required courses neither replace nor expand all-listed requirements', async ({ page }) => {
    const customCodes = ['ZZZ650', 'ZZZ651'];
    const officialCodes = ['MATH306', 'OPIM390'];
    await seedPlan(page, {
      ...selectedPrograms({
        doubleMajor: null,
        minor1: 'ANALY-MINOR',
        minor2: null,
        minor3: null,
      }),
      customCourses: {
        CS: customCodes.map((code) => custom(code, 'free')),
        'ANALY-MINOR': customCodes.map((code) => custom(code, 'required')),
      },
      curriculum: [[...officialCodes, ...customCodes]],
      grades: [['A', 'A', 'A', 'A']],
      dates: [TERM],
    });
    await waitForPrograms(page, customCodes[0]);

    const results = await page.evaluate(({ official, customOnly }) => {
      const fn = window.computeMinorAllocation
        || (typeof computeMinorAllocation === 'function' ? computeMinorAllocation : null);
      const run = (eligible) => fn(window.curriculum, 'ANALY-MINOR', {
        calculateProgramGpa: false,
        isEligible: (course) => eligible.includes(course.code),
      });
      const officialResult = run(official);
      const customResult = run(customOnly);
      return {
        official: {
          total: officialResult.totals.required,
          requiredOk: officialResult.perCatOk.required,
        },
        customOnly: {
          total: customResult.totals.required,
          requiredOk: customResult.perCatOk.required,
        },
      };
    }, { official: officialCodes, customOnly: customCodes });

    expect(results.official).toEqual({
      total: { courses: 2, credits: 6 },
      requiredOk: true,
    });
    expect(results.customOnly).toEqual({
      total: { courses: 2, credits: 6 },
      requiredOk: false,
    });
  });

  test('untouched secondary categories survive adding and renaming to their stored codes', async ({ page }) => {
    const addTarget = 'ZZZ655';
    const renameFrom = 'ZZZ656';
    const renameTarget = 'ZZZ657';
    await seedPlan(page, {
      ...selectedPrograms({
        minor2: null,
        entryTermMinor2: null,
        minor3: null,
        entryTermMinor3: null,
      }),
      customCourses: {
        CS: [custom(renameFrom, 'core')],
        DSA: [
          custom(addTarget, 'area', { Course_Name: 'Stored add target' }),
          custom(renameFrom, 'free', { Course_Name: 'Stored old rename row' }),
          custom(renameTarget, 'required', { Course_Name: 'Stored rename target' }),
        ],
      },
      curriculum: [[renameFrom]],
      grades: [['A']],
      dates: [TERM],
    });
    await waitForPrograms(page, renameFrom);

    const addForm = await openAddForm(page);
    await fillIdentity(addForm, addTarget, 'Added through primary');
    await categorySelect(addForm, 'CS').selectOption('free');
    await addForm.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(addForm).toBeHidden();
    expect((await readProgramDefinitions(page, ['DSA'], addTarget)).DSA).toMatchObject({
      type: 'area',
      name: 'Added through primary',
    });

    const editForm = await openEditForm(page, renameFrom);
    await editForm.locator('.cc-row').nth(0).locator('input').fill(renameTarget);
    await editForm.locator('.cc-row').nth(1).locator('input').fill('Renamed through primary');
    await editForm.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(editForm).toBeHidden();
    expect((await readProgramDefinitions(page, ['DSA'], renameTarget)).DSA).toMatchObject({
      type: 'required',
      name: 'Renamed through primary',
    });
    expect((await readProgramDefinitions(page, ['DSA'], renameFrom)).DSA).toBeNull();
  });
});
