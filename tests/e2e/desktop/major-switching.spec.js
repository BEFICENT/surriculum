'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');

// Major / entry-term switching (main.js). The highest-traffic wiring in the
// file and, until now, untested beyond the controls existing.
//
// The model is: on change, persist the choice to plan storage and
// location.reload(). Everything else — loading the new major's catalog and its
// requirements, and re-running allocation — happens on the fresh bootstrap. So
// the test that matters is not "the dropdown changed" but "the SAME plan is now
// evaluated against the NEW program". A refactor that reloaded without
// re-pointing the catalog, or persisted the wrong key, would leave the label
// changed and the evaluation stale.
//
// Frozen term 202401.
const TERM_NAME = 'Fall 2024-2025';

// Read a course's allocation plus the live requirement thresholds, so a switch
// is observable in the numbers the engine actually uses.
const readState = (page, code) => page.evaluate((c) => {
  let eff = null;
  window.curriculum.semesters.forEach((s) => s.courses.forEach((x) => { if (x.code === c) eff = x.effective_type; }));
  return { major: window.curriculum.major, doubleMajor: window.curriculum.doubleMajor, entryTerm: window.curriculum.entryTerm, eff };
}, code);

// Change a program select and wait for the reload it triggers to settle.
const switchSelect = async (page, selector, value, until) => {
  await page.locator(selector).selectOption(value);
  await page.waitForFunction(until, value, { timeout: 20000 });
  await page.waitForFunction(
    () => !!(window.curriculum && Array.isArray(window.curriculum.semesters)
      && window.curriculum.semesters.some((s) => s.courses && s.courses.length)),
    null,
    { timeout: 20000 },
  );
};

test.describe('major and entry-term switching', () => {
  test('switching major re-evaluates the same plan against the new catalog', async ({ page }) => {
    // CS204 is `required` in the CS catalog but `core` in ME's. If the switch
    // only relabelled the major without reloading the catalog, its allocation
    // would not move.
    await seedPlan(page, {
      major: 'CS',
      entryTerm: TERM_NAME,
      curriculum: [['CS204']],
      grades: [['A']],
      dates: [TERM_NAME],
    });

    const before = await readState(page, 'CS204');
    expect(before.major).toBe('CS');
    expect(before.eff, 'CS204 is required for CS').toBe('required');

    await switchSelect(page, '.change_major', 'ME', (m) => window.curriculum && window.curriculum.major === m);

    const after = await readState(page, 'CS204');
    expect(after.major, 'the curriculum should now be ME').toBe('ME');
    expect(after.eff, 'the same course is core for ME — proving the ME catalog loaded').toBe('core');
  });

  test('the switch persists, so a reload keeps the new major', async ({ page }) => {
    await seedPlan(page, { major: 'CS', entryTerm: TERM_NAME, curriculum: [['CS204']], grades: [['A']], dates: [TERM_NAME] });
    await switchSelect(page, '.change_major', 'ME', (m) => window.curriculum && window.curriculum.major === m);

    // A plain reload (not via the dropdown) must come back as ME, and the
    // dropdown must reflect it — i.e. the choice was written to storage.
    await page.reload();
    await page.waitForFunction(() => !!(window.curriculum && window.curriculum.major));
    expect(await page.evaluate(() => window.curriculum.major)).toBe('ME');
    await expect(page.locator('.change_major')).toHaveValue('ME');
  });

  test('the requirement thresholds follow the major', async ({ page }) => {
    // CS required = 29, ME required = 32. The engine must evaluate against the
    // new major's requirements, not the old ones.
    await seedPlan(page, { major: 'CS', entryTerm: TERM_NAME, curriculum: [['CS204']], grades: [['A']], dates: [TERM_NAME] });

    const reqFor = () => page.evaluate(() => {
      const r = (typeof requirements !== 'undefined' ? requirements : window.requirements) || {};
      const m = window.curriculum.major;
      const rec = r[m] || (Object.values(r).find((v) => v && v.required != null)) || {};
      return { major: m, required: rec.required };
    });

    expect(await reqFor()).toEqual({ major: 'CS', required: 29 });
    await switchSelect(page, '.change_major', 'ME', (m) => window.curriculum && window.curriculum.major === m);
    expect(await reqFor()).toEqual({ major: 'ME', required: 32 });
  });

  test('setting a double major loads its catalog and evaluates a second allocation', async ({ page }) => {
    await seedPlan(page, { major: 'CS', entryTerm: TERM_NAME, curriculum: [['CS204']], grades: [['A']], dates: [TERM_NAME] });

    // The double-major select is collapsed until the user asks for it. Reveal it
    // via the real affordance, matching the flow a user takes.
    await expect(page.locator('.doubleMajor')).toBeHidden();
    await page.locator('#addDoubleMajorBtn').click();
    await expect(page.locator('.doubleMajor'), 'the DM select should appear').toBeVisible();

    await switchSelect(page, '.doubleMajor', 'ME', () => window.curriculum && window.curriculum.doubleMajor === 'ME');

    const st = await readState(page, 'CS204');
    expect(st.doubleMajor, 'the double major should be set').toBe('ME');
    // The DM pass runs and CS204 gets a second, ME-based category.
    const dmEff = await page.evaluate(() => {
      let e = null;
      window.curriculum.semesters.forEach((s) => s.courses.forEach((x) => { if (x.code === 'CS204') e = x.effective_type_dm; }));
      return e;
    });
    expect(dmEff, 'CS204 is core under ME as the double major').toBe('core');
  });

  test('adding a double major reviews only genuine custom courses, not ordinary N/A courses', async ({ page }) => {
    const customCode = 'ZZZ626';
    await seedPlan(page, {
      major: 'CS',
      entryTerm: TERM_NAME,
      globalCourseMetadata: [{
        code: 'HIST484',
        title: 'Peripheral Populations in the Ottoman Empire (1300-1914)',
        suCredits: 3,
        ects: 6,
      }],
      customCourses: {
        CS: [{
          Major: 'ZZZ',
          Code: '626',
          Course_Name: 'Primary custom elective',
          ECTS: '6',
          Engineering: 0,
          Basic_Science: 0,
          SU_credit: '3',
          Faculty: 'FENS',
          Faculty_Course: 'No',
          EL_Type: 'free',
        }],
      },
      // HIST484 is restored from the global course index; CS395 is an
      // ordinary CS/202401 catalog row that is absent from DSA/202401.
      // Neither provenance makes the course a user-owned custom definition.
      curriculum: [['HIST484', 'CS395', customCode]],
      grades: [['B', 'A', 'A']],
      dates: [TERM_NAME],
    });
    await page.waitForFunction(() => window.curriculum
      && window.curriculum.semesters.some((semester) => semester.courses
        .some((course) => course.code === 'HIST484'))
      && course_data.some((course) => course.__globalCourseDefinition
        && `${course.Major}${course.Code}` === 'HIST484'));

    await page.locator('#addDoubleMajorBtn').click();
    await switchSelect(
      page,
      '.doubleMajor',
      'DSA',
      () => window.curriculum && window.curriculum.doubleMajor === 'DSA',
    );

    const review = page.locator('.double_major_modal');
    await expect(review).toBeVisible({ timeout: 15000 });
    await expect(review.getByRole('heading', { name: 'Set DSA Category', exact: true }))
      .toBeVisible();
    await expect(review).toContainText('ZZZ626 - Primary custom elective');
    await expect(review).not.toContainText('HIST484');
    await expect(review).not.toContainText('CS395');
    const category = review.getByRole('combobox', { name: 'DSA Category:', exact: true });
    await category.selectOption('area');
    await review.getByRole('button', { name: 'Save', exact: true }).click();

    // A second modal here would mean the globally restored HIST484 fallback
    // was incorrectly queued as if it were another user-created course.
    await expect(page.locator('.double_major_modal')).toHaveCount(0);
    await page.waitForFunction((code) => {
      const rows = JSON.parse(window.planStorage.getItem('customCourses_DSA') || '[]');
      return rows.some((course) => `${course.Major}${course.Code}` === code);
    }, customCode);

    const state = await page.evaluate((code) => {
      const occurrence = (target) => window.curriculum.semesters
        .flatMap((semester) => semester.courses)
        .find((course) => course.code === target);
      const normalize = (course) => `${course.Major || ''}${course.Code || ''}`;
      return {
        dmStored: JSON.parse(window.planStorage.getItem('customCourses_DSA') || '[]')
          .map((course) => ({
            code: normalize(course),
            type: course.EL_Type,
            faculty: course.Faculty,
          })),
        dmRuntime: window.curriculum.doubleMajorCourseData
          .map((course) => ({ code: normalize(course), faculty: course.Faculty })),
        primaryStoredCodes: JSON.parse(window.planStorage.getItem('customCourses_CS') || '[]')
          .map(normalize),
        hist: {
          main: occurrence('HIST484').effective_type,
          dm: occurrence('HIST484').effective_type_dm,
          global: Boolean(course_data.find((course) => normalize(course) === 'HIST484')
            ?.__globalCourseDefinition),
        },
        cs395: {
          main: occurrence('CS395').effective_type,
          dm: occurrence('CS395').effective_type_dm,
          global: Boolean(course_data.find((course) => normalize(course) === 'CS395')
            ?.__globalCourseDefinition),
        },
        custom: {
          main: occurrence(code).effective_type,
          dm: occurrence(code).effective_type_dm,
        },
      };
    }, customCode);
    expect(state.dmStored).toEqual([{ code: customCode, type: 'area', faculty: 'FENS' }]);
    expect(state.dmRuntime).toContainEqual({ code: customCode, faculty: 'FENS' });
    expect(state.dmRuntime.map((course) => course.code)).not.toContain('HIST484');
    expect(state.dmRuntime.map((course) => course.code)).not.toContain('CS395');
    expect(state.primaryStoredCodes).toEqual([customCode]);
    expect(state.hist).toEqual({ main: 'none', dm: 'none', global: true });
    expect(state.cs395).toEqual({ main: 'required', dm: 'none', global: false });
    expect(state.custom).toEqual({ main: 'free', dm: 'area' });

    await page.reload();
    await page.waitForFunction((code) => window.curriculum
      && window.curriculum.doubleMajor === 'DSA'
      && window.curriculum.semesters.some((semester) => semester.courses
        .some((course) => course.code === code)), customCode);
    await expect(page.locator('.double_major_modal')).toHaveCount(0);
    expect(await page.evaluate(() => {
      const stored = JSON.parse(window.planStorage.getItem('customCourses_DSA') || '[]');
      const runtime = window.curriculum.doubleMajorCourseData
        .find((course) => `${course.Major}${course.Code}` === 'ZZZ626');
      return {
        stored: stored.map((course) => ({
          code: `${course.Major}${course.Code}`,
          faculty: course.Faculty,
        })),
        runtimeFaculty: runtime && runtime.Faculty,
      };
    })).toEqual({
      stored: [{ code: customCode, faculty: 'FENS' }],
      runtimeFaculty: 'FENS',
    });
  });

  test('a legacy CS210 custom alias does not prompt over target catalog DSA210', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: TERM_NAME,
      customCourses: {
        CS: [{
          Major: 'CS',
          Code: '210',
          Course_Name: 'Legacy Introduction to Data Science override',
          ECTS: '6',
          Engineering: 0,
          Basic_Science: 0,
          SU_credit: '3',
          Faculty: 'FENS',
          Faculty_Course: 'No',
          EL_Type: 'free',
        }],
      },
      curriculum: [['CS204']],
      grades: [['A']],
      dates: [TERM_NAME],
    });
    await page.waitForFunction(() => JSON.parse(
      window.planStorage.getItem('customCourses_CS') || '[]',
    ).some((course) => `${course.Major}${course.Code}` === 'CS210'));

    await page.locator('#addDoubleMajorBtn').click();
    await switchSelect(
      page,
      '.doubleMajor',
      'DSA',
      () => window.curriculum && window.curriculum.doubleMajor === 'DSA',
    );
    await page.waitForFunction(() => window.curriculum
      && Array.isArray(window.curriculum.doubleMajorCourseData)
      && window.curriculum.doubleMajorCourseData.some((course) => (
        typeof window.canonicalCourseCode === 'function'
          ? window.canonicalCourseCode(`${course.Major}${course.Code}`)
          : `${course.Major}${course.Code}`
      ) === 'DSA210'));

    await expect(page.locator('.double_major_modal')).toHaveCount(0);
    expect(await page.evaluate(() => {
      const combined = (course) => `${course.Major || ''}${course.Code || ''}`;
      const canonical = (course) => (
        typeof window.canonicalCourseCode === 'function'
          ? window.canonicalCourseCode(combined(course))
          : combined(course)
      );
      return {
        primaryStored: JSON.parse(window.planStorage.getItem('customCourses_CS') || '[]')
          .map(combined),
        dmStored: JSON.parse(window.planStorage.getItem('customCourses_DSA') || '[]')
          .map(combined),
        primaryAliasRows: course_data
          .filter((course) => canonical(course) === 'DSA210')
          .map((course) => ({ code: combined(course), type: course.EL_Type })),
        targetAliasRows: window.curriculum.doubleMajorCourseData
          .filter((course) => canonical(course) === 'DSA210')
          .map((course) => ({ code: combined(course), type: course.EL_Type })),
      };
    })).toEqual({
      primaryStored: ['CS210'],
      dmStored: [],
      primaryAliasRows: [{ code: 'DSA210', type: 'core' }],
      targetAliasRows: [{ code: 'DSA210', type: 'required' }],
    });
  });

  test('clearing the double major back to None removes it', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: TERM_NAME,
      doubleMajor: 'ME',
      entryTermDM: TERM_NAME,
      curriculum: [['CS204']],
      grades: [['A']],
      dates: [TERM_NAME],
    });
    expect((await readState(page, 'CS204')).doubleMajor).toBe('ME');

    // The None option has an empty value.
    await switchSelect(page, '.doubleMajor', '', () => window.curriculum && !window.curriculum.doubleMajor);
    expect((await readState(page, 'CS204')).doubleMajor, 'the double major should be cleared').toBeFalsy();
  });

  test('switching entry term keeps the major and reloads its catalog for that term', async ({ page }) => {
    await seedPlan(page, { major: 'CS', entryTerm: TERM_NAME, curriculum: [['CS204']], grades: [['A']], dates: [TERM_NAME] });

    const OTHER_TERM = 'Fall 2023-2024';
    await switchSelect(page, '.entryTerm', OTHER_TERM, (t) => window.curriculum && window.curriculum.entryTerm === '202301');

    const st = await readState(page, 'CS204');
    expect(st.major, 'the major should survive an entry-term change').toBe('CS');
    expect(st.entryTerm, 'the entry term should update').toBe('202301');
    expect(st.eff, 'CS204 is still required for CS in the earlier catalog').toBe('required');
  });
});
