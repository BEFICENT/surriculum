'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');
const {
  importTranscriptCustomCourseForReview,
  readTranscriptCustomCourseState,
} = require('../helpers/academic-records');
test.describe('academic records parsing (desktop)', () => {
  test('a failed import save preserves a live edit flushed into the pre-import checkpoint', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS', entryTerm: 'Fall 2024-2025',
      curriculum: [['MATH101']], grades: [['']], dates: ['Fall 2024-2025'],
    });
    await page.waitForFunction(() => Array.isArray(window.course_data || course_data)
      && course_data.length > 0 && window.curriculum);

    const beforePlanCount = await page.evaluate(() => window.planStorage.getPlans().length);
    const oneCourseTranscript = `
      <table class="courseTable">
        <thead><tr><th><b>Fall 2024-2025</b></th></tr></thead>
        <tbody><tr><td>CS201</td><td>Introduction to Computing</td><td>1</td><td>A</td><td>3</td><td>6</td><td>Completed</td></tr></tbody>
      </table>`;
    await page.locator('#academicRecordsInput').setInputFiles({
      name: 'synthetic-save-failure.html',
      mimeType: 'text/html',
      buffer: Buffer.from(oneCourseTranscript),
    });
    await page.evaluate(() => {
      // Keep the grade edit and import launch in one browser task so the edit
      // is still inside the 250 ms autosave debounce when import begins.
      document.querySelector('.course .grade').click();
      document.querySelector('.grade-option[data-value="B"]').click();

      const storage = window.planStorage;
      const realFlush = storage.flushSaves.bind(storage);
      storage.flushSaves = (options) => {
        // The preflight must persist the pending B. Reject only the later flush
        // of the imported CS201 snapshot.
        if (options && options.onlyIfPending) return realFlush(options);
        return false;
      };
      document.getElementById('importAcademicRecords').click();
    });

    const failure = page.locator('.modal-overlay').filter({ hasText: /Import was not saved/i });
    await expect(failure).toBeVisible();
    await expect(page.locator('.modal-overlay').filter({ hasText: /Import complete/i })).toHaveCount(0);
    const during = await page.evaluate(() => ({
      curriculum: JSON.parse(window.planStorage.getItem('curriculum') || '[]'),
      grades: JSON.parse(window.planStorage.getItem('grades') || '[]'),
    }));
    expect(during, 'rollback keeps the pending edit that preflight made durable').toEqual({
      curriculum: [['MATH101']],
      grades: [['B']],
    });

    await Promise.all([
      page.waitForNavigation(),
      failure.getByRole('button', { name: 'OK', exact: true }).click(),
    ]);
    await page.waitForFunction(() => window.curriculum && Array.isArray(window.curriculum.semesters));
    const afterReload = await page.evaluate(() => ({
      importedOccurrences: (window.curriculum.semesters || []).flatMap((semester) =>
        (semester.courses || []).filter((course) => course.code === 'CS201')),
      mathGrade: (window.curriculum.semesters || []).flatMap((semester) => semester.courses || [])
        .find((course) => course.code === 'MATH101')?.grade || '',
      planCount: window.planStorage.getPlans().length,
    }));
    expect(afterReload.importedOccurrences).toEqual([]);
    expect(afterReload.mathGrade).toBe('B');
    expect(afterReload.planCount).toBe(beforePlanCount);
  });

  test('skipping transcript custom-course review rolls back the placeholder and stays removed after reload', async ({ page }) => {
    const code = 'FEL98765';
    await seedPlan(page, {
      major: 'CS', entryTerm: 'Fall 2024-2025', curriculum: [], grades: [], dates: [],
    });
    await page.waitForFunction(() => Array.isArray(window.course_data || course_data)
      && course_data.length > 0 && window.curriculum);

    const review = await importTranscriptCustomCourseForReview(page, code);
    await expect(review.getByRole('button', { name: 'Skip & Remove', exact: true })).toBeVisible();
    await review.getByRole('button', { name: 'Skip & Remove', exact: true }).click();
    await expect(review).toBeHidden();

    expect(await readTranscriptCustomCourseState(page, code)).toEqual({
      customCount: 0,
      catalogCount: 0,
      occurrences: [],
      renderedCount: 0,
      semesterCount: 0,
    });

    await page.evaluate(() => window.planStorage.flushSaves());
    await page.reload();
    await page.waitForFunction(() => window.curriculum && Array.isArray(window.curriculum.semesters)
      && typeof course_data !== 'undefined' && Array.isArray(course_data) && course_data.length > 0);
    expect(await readTranscriptCustomCourseState(page, code)).toEqual({
      customCount: 0,
      catalogCount: 0,
      occurrences: [],
      renderedCount: 0,
      semesterCount: 0,
    });
  });

  test('saving transcript custom-course review keeps the definition and occurrence after reload', async ({ page }) => {
    const code = 'FEL98765';
    await seedPlan(page, {
      major: 'CS', entryTerm: 'Fall 2024-2025', curriculum: [], grades: [], dates: [],
    });
    await page.waitForFunction(() => typeof course_data !== 'undefined'
      && Array.isArray(course_data) && course_data.length > 0 && window.curriculum);

    const review = await importTranscriptCustomCourseForReview(page, code);
    await expect(review.getByRole('button', { name: 'Save & Keep', exact: true })).toBeVisible();
    await review.getByRole('button', { name: 'Save & Keep', exact: true }).click();
    await expect(review).toBeHidden();

    expect(await readTranscriptCustomCourseState(page, code)).toMatchObject({
      customCount: 1,
      catalogCount: 1,
      occurrences: [{ code, grade: 'A', term: 'Fall 2024-2025' }],
      renderedCount: 1,
      semesterCount: 1,
    });

    await page.evaluate(() => window.planStorage.flushSaves());
    await page.reload();
    await page.waitForFunction((targetCode) => window.curriculum
      && (window.curriculum.semesters || []).some((semester) =>
        (semester.courses || []).some((course) => course.code === targetCode)), code);
    expect(await readTranscriptCustomCourseState(page, code)).toMatchObject({
      customCount: 1,
      catalogCount: 1,
      occurrences: [{ code, grade: 'A', term: 'Fall 2024-2025' }],
      renderedCount: 1,
      semesterCount: 1,
    });
  });

  test('LANG review requires an explicit level and preserves independent main/DM categories', async ({ page }) => {
    const code = 'LANG240';
    await seedPlan(page, {
      major: 'MAN', entryTerm: 'Fall 2024-2025',
      doubleMajor: 'CS', entryTermDM: 'Fall 2024-2025',
      curriculum: [], grades: [], dates: [],
    });
    await page.waitForFunction(() => typeof course_data !== 'undefined'
      && Array.isArray(course_data) && course_data.length > 0 && window.curriculum);

    const review = await importTranscriptCustomCourseForReview(page, code, {
      title: 'Swedish Conversation and Culture', grade: 'B+',
    });
    const level = review.locator('.cc-language-level');
    await expect(level, 'an exchange LANG course is explicitly reviewable').toBeVisible();
    await expect(level, 'a number/title guess must not silently classify it').toHaveValue('');
    await expect(review.getByRole('combobox', { name: /^MAN Category:?$/ }))
      .toHaveValue('free');
    await expect(review.getByRole('combobox', { name: /^CS Category:?$/ }))
      .toHaveValue('unknown');

    await review.getByRole('button', { name: 'Save & Keep', exact: true }).click();
    const warning = page.locator('.modal-overlay').filter({ hasText: /Choose the language level/i });
    await expect(warning).toBeVisible();
    await warning.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(review, 'validation leaves the review open').toBeVisible();

    await level.selectOption('other');
    await review.getByRole('button', { name: 'Save & Keep', exact: true }).click();
    await expect(review).toBeHidden();

    const result = await page.evaluate((target) => {
      const read = (program) => JSON.parse(
        window.planStorage.getItem(`customCourses_${program}`) || '[]',
      ).find((course) => `${course.Major}${course.Code}` === target);
      const attempt = (window.curriculum.semesters || []).flatMap((semester) => semester.courses || [])
        .find((course) => course.code === target);
      return { main: read('MAN'), dm: read('CS'), grade: attempt && attempt.grade };
    }, code);
    expect(result.main).toMatchObject({ EL_Type: 'free', Language_Level: 'other' });
    expect(result.dm).toMatchObject({ EL_Type: 'unknown', Language_Level: 'other' });
    expect(result.grade, 'the transcript grade is never replaced with T').toBe('B+');
  });

  test('Save & Keep on LANG re-import preserves each program classification and refreshes transcript fields', async ({ page }) => {
    const code = 'LANG240';
    const priorByProgram = {
      MAN: {
        Major: 'LANG', Code: '240', Course_Name: 'Prior MAN title',
        ECTS: '4', Engineering: 0.5, Basic_Science: 0.25, SU_credit: '2',
        Faculty: 'SBS', Faculty_Course: 'No', EL_Type: 'area', Language_Level: 'other',
      },
      CS: {
        Major: 'LANG', Code: '240', Course_Name: 'Prior CS title',
        ECTS: '5', Engineering: 1.5, Basic_Science: 0.75, SU_credit: '2.5',
        Faculty: 'FENS', Faculty_Course: 'No', EL_Type: 'core', Language_Level: 'other',
      },
      'FIN-MINOR': {
        Major: 'LANG', Code: '240', Course_Name: 'Prior FIN title',
        ECTS: '3', Engineering: 0.25, Basic_Science: 0.5, SU_credit: '1.5',
        Faculty: 'FASS', Faculty_Course: 'No', EL_Type: 'required', Language_Level: 'other',
      },
    };
    await seedPlan(page, {
      major: 'MAN', entryTerm: 'Fall 2024-2025',
      doubleMajor: 'CS', entryTermDM: 'Fall 2024-2025',
      minor1: 'FIN-MINOR', entryTermMinor1: 'Fall 2024-2025',
      customCourses: {
        MAN: [priorByProgram.MAN],
        CS: [priorByProgram.CS],
        'FIN-MINOR': [priorByProgram['FIN-MINOR']],
      },
      curriculum: [], grades: [], dates: [],
    });
    await page.waitForFunction(() => typeof course_data !== 'undefined'
      && Array.isArray(course_data)
      && course_data.some((course) => `${course.Major}${course.Code}` === 'LANG240')
      && window.curriculum
      && Array.isArray(window.curriculum.minors)
      && window.curriculum.minors.includes('FIN-MINOR'));

    const refreshedTitle = 'Advanced Swedish Abroad';
    const review = await importTranscriptCustomCourseForReview(page, code, {
      title: refreshedTitle, grade: 'A-',
    });
    await expect(review.getByRole('combobox', { name: /^MAN Category:?$/ })).toHaveValue('area');
    await expect(review.getByRole('combobox', { name: /^CS Category:?$/ })).toHaveValue('core');
    await expect(review.getByRole('combobox', { name: /^FIN-MINOR Category:?$/ }))
      .toHaveValue('required');
    await expect(review.getByRole('combobox', { name: 'Language level:' })).toHaveValue('other');

    await review.getByRole('button', { name: 'Save & Keep', exact: true }).click();
    await expect(review).toBeHidden();

    const saved = await page.evaluate((target) => {
      const read = (program) => JSON.parse(
        window.planStorage.getItem(`customCourses_${program}`) || '[]',
      ).find((course) => `${course.Major}${course.Code}` === target);
      const occurrence = (window.curriculum.semesters || [])
        .flatMap((semester) => semester.courses || [])
        .find((course) => course.code === target);
      return {
        main: read('MAN'),
        dm: read('CS'),
        minor: read('FIN-MINOR'),
        occurrence: occurrence && {
          grade: occurrence.grade,
          suCredits: Number(occurrence.SU_credit),
          ects: Number(occurrence.ECTS),
        },
      };
    }, code);

    expect(saved.main).toMatchObject({
      Course_Name: refreshedTitle, SU_credit: '3', ECTS: '6',
      EL_Type: 'area', Engineering: 0.5, Basic_Science: 0.25,
      Faculty: 'SBS', Language_Level: 'other',
    });
    expect(saved.dm).toMatchObject({
      Course_Name: refreshedTitle, SU_credit: '3', ECTS: '6',
      EL_Type: 'core', Engineering: 1.5, Basic_Science: 0.75,
      Faculty: 'FENS', Language_Level: 'other',
    });
    expect(saved.minor).toMatchObject({
      Course_Name: refreshedTitle, SU_credit: '3', ECTS: '6',
      EL_Type: 'required', Engineering: 0.25, Basic_Science: 0.5,
      Faculty: 'FASS', Language_Level: 'other',
    });
    expect(saved.occurrence).toEqual({ grade: 'A-', suCredits: 3, ects: 6 });
  });

  test('skipping LANG review rolls back every contextual definition without touching catalog rows', async ({ page }) => {
    const code = 'LANG100';
    await seedPlan(page, {
      major: 'MAN', entryTerm: 'Fall 2024-2025',
      doubleMajor: 'CS', entryTermDM: 'Fall 2024-2025',
      curriculum: [], grades: [], dates: [],
    });
    await page.waitForFunction(() => typeof course_data !== 'undefined'
      && Array.isArray(course_data) && course_data.length > 0 && window.curriculum);
    const catalogCountBefore = await page.evaluate(() => course_data.length);

    const review = await importTranscriptCustomCourseForReview(page, code, {
      title: 'Beginning Swedish', grade: 'A-',
    });
    await expect(review.locator('.cc-language-level')).toHaveValue('basic');
    await review.getByRole('button', { name: 'Skip & Remove', exact: true }).click();
    await expect(review).toBeHidden();

    const result = await page.evaluate((target) => {
      const hasStored = (program) => JSON.parse(
        window.planStorage.getItem(`customCourses_${program}`) || '[]',
      ).some((course) => `${course.Major}${course.Code}` === target);
      return {
        mainStored: hasStored('MAN'),
        dmStored: hasStored('CS'),
        languageRows: course_data.filter((course) => `${course.Major}${course.Code}` === target).length,
        catalogCount: course_data.length,
        baseCatalogPresent: course_data.some((course) => `${course.Major}${course.Code}` === 'MATH101'),
      };
    }, code);
    expect(result).toEqual({
      mainStored: false,
      dmStored: false,
      languageRows: 0,
      catalogCount: catalogCountBefore,
      baseCatalogPresent: true,
    });
  });

  test('failed multi-program LANG rollback restores earlier removals and leaves review open', async ({ page }) => {
    const code = 'LANG100';
    await seedPlan(page, {
      major: 'MAN', entryTerm: 'Fall 2024-2025',
      doubleMajor: 'CS', entryTermDM: 'Fall 2024-2025',
      curriculum: [], grades: [], dates: [],
    });
    await page.waitForFunction(() => typeof course_data !== 'undefined'
      && Array.isArray(course_data) && course_data.length > 0 && window.curriculum);
    const review = await importTranscriptCustomCourseForReview(page, code, {
      title: 'Beginning Swedish', grade: 'A-',
    });

    await page.evaluate(() => {
      const original = window.planStorage;
      window.__langRollbackStorage = original;
      window.planStorage = Object.assign({}, original, {
        setItem(key, value, planId) {
          if (key === 'customCourses_CS' && JSON.parse(value || '[]').length === 0) return false;
          return original.setItem(key, value, planId);
        },
      });
    });
    await review.getByRole('button', { name: 'Skip & Remove', exact: true }).click();
    const warning = page.locator('.modal-overlay').filter({ hasText: /Could not remove imported course/i });
    await expect(warning).toBeVisible();
    await warning.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(review, 'a partial rollback never dismisses the review').toBeVisible();

    const counts = await page.evaluate((target) => {
      const original = window.__langRollbackStorage;
      const count = (program) => JSON.parse(original.getItem(`customCourses_${program}`) || '[]')
        .filter((course) => `${course.Major}${course.Code}` === target).length;
      window.planStorage = original;
      delete window.__langRollbackStorage;
      return { main: count('MAN'), dm: count('CS') };
    }, code);
    expect(counts, 'the already-removed main definition was restored').toEqual({ main: 1, dm: 1 });

    // Prove the restored state remains removable after the synthetic failure is gone.
    await review.getByRole('button', { name: 'Skip & Remove', exact: true }).click();
    await expect(review).toBeHidden();
  });

  test('a failed transcript-course rename restores linked language metadata', async ({ page }) => {
    const code = 'LANG240';
    await seedPlan(page, {
      major: 'MAN', entryTerm: 'Fall 2024-2025',
      doubleMajor: 'CS', entryTermDM: 'Fall 2024-2025',
      curriculum: [], grades: [], dates: [],
    });
    await page.waitForFunction(() => typeof course_data !== 'undefined'
      && Array.isArray(course_data) && course_data.length > 0 && window.curriculum);
    const review = await importTranscriptCustomCourseForReview(page, code, {
      title: 'Swedish Conversation and Culture', grade: 'B+',
    });
    await review.getByRole('combobox', { name: 'Language level:' }).selectOption('other');
    await review.locator('.cc-row').first().locator('input').fill('LANG241');

    await page.evaluate(() => {
      const original = window.planStorage;
      window.__langRenameStorage = original;
      window.planStorage = Object.assign({}, original, {
        flushSaves() { return false; },
      });
    });
    await review.getByRole('button', { name: 'Save & Keep', exact: true }).click();
    const warning = page.locator('.modal-overlay').filter({ hasText: /Could not rename custom course/i });
    await expect(warning).toBeVisible();
    await warning.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(review).toBeVisible();

    const restored = await page.evaluate(() => {
      const original = window.__langRenameStorage;
      const read = (program) => JSON.parse(original.getItem(`customCourses_${program}`) || '[]');
      const result = { main: read('MAN'), dm: read('CS') };
      window.planStorage = original;
      delete window.__langRenameStorage;
      return result;
    });
    for (const records of [restored.main, restored.dm]) {
      expect(records).toHaveLength(1);
      expect(`${records[0].Major}${records[0].Code}`).toBe(code);
      expect(Object.hasOwn(records[0], 'Language_Level')).toBe(false);
    }
  });

  test('skipping a re-imported LANG course restores each program\'s exact prior definition', async ({ page }) => {
    const code = 'LANG240';
    const mainBefore = {
      Major: 'LANG', Code: '240', Course_Name: 'Prior MAN definition',
      ECTS: '4', Engineering: 0, Basic_Science: 0, SU_credit: '2',
      Faculty: '', Faculty_Course: 'No', EL_Type: 'area', Language_Level: 'other',
    };
    const dmBefore = {
      Major: 'LANG', Code: '240', Course_Name: 'Prior CS definition',
      ECTS: '5', Engineering: 1, Basic_Science: 0, SU_credit: '2.5',
      Faculty: 'FENS', Faculty_Course: 'No', EL_Type: 'core', Language_Level: 'basic',
    };
    await seedPlan(page, {
      major: 'MAN', entryTerm: 'Fall 2024-2025',
      doubleMajor: 'CS', entryTermDM: 'Fall 2024-2025',
      customCourses: { MAN: [mainBefore], CS: [dmBefore] },
      curriculum: [], grades: [], dates: [],
    });
    await page.waitForFunction(() => typeof course_data !== 'undefined'
      && Array.isArray(course_data) && course_data.some((course) => `${course.Major}${course.Code}` === 'LANG240'));

    const review = await importTranscriptCustomCourseForReview(page, code, {
      title: 'Beginning Swedish Abroad', grade: 'A-',
    });
    await review.getByRole('button', { name: 'Skip & Remove', exact: true }).click();
    await expect(review).toBeHidden();

    const restored = await page.evaluate((target) => {
      const read = (program) => JSON.parse(
        window.planStorage.getItem(`customCourses_${program}`) || '[]',
      ).find((course) => `${course.Major}${course.Code}` === target);
      const runtime = course_data.find((course) => `${course.Major}${course.Code}` === target);
      const occurrenceCount = (window.curriculum.semesters || [])
        .flatMap((semester) => semester.courses || [])
        .filter((course) => course.code === target).length;
      return { main: read('MAN'), dm: read('CS'), runtimeName: runtime && runtime.Course_Name, occurrenceCount };
    }, code);
    expect(restored.main).toEqual(mainBefore);
    expect(restored.dm).toEqual(dmBefore);
    expect(restored.runtimeName).toBe(mainBefore.Course_Name);
    expect(restored.occurrenceCount).toBe(0);
  });

  test('an interrupted LANG review fails closed after reload and remains editable', async ({ page }) => {
    const code = 'LANG240';
    await seedPlan(page, {
      major: 'MAN', entryTerm: 'Fall 2024-2025',
      curriculum: [], grades: [], dates: [],
    });
    await page.waitForFunction(() => typeof course_data !== 'undefined'
      && Array.isArray(course_data) && course_data.length > 0 && window.curriculum);

    const review = await importTranscriptCustomCourseForReview(page, code, {
      title: 'Beginning Swedish Abroad', grade: 'B+',
    });
    await expect(
      review.getByRole('combobox', { name: 'Language level:' }),
      'Beginning is a UI suggestion, not a durable classification',
    ).toHaveValue('basic');

    // Simulate closing/reloading the page before the mandatory review is
    // completed. The transient review queue is gone, but its durable unknown
    // state must never be promoted to degree credit.
    await page.reload();
    await page.waitForFunction((target) => window.curriculum
      && (window.curriculum.semesters || []).some((semester) =>
        (semester.courses || []).some((course) => course.code === target)), code);

    const before = await page.evaluate((target) => {
      const semester = window.curriculum.semesters.find((item) =>
        (item.courses || []).some((course) => course.code === target));
      const course = semester.courses.find((item) => item.code === target);
      const stored = JSON.parse(window.planStorage.getItem('customCourses_MAN') || '[]')
        .find((item) => `${item.Major}${item.Code}` === target);
      return {
        effectiveType: course.effective_type,
        reason: course.degreeExclusionReason,
        grade: course.grade,
        freeCredits: semester.totalFree,
        degreeCredits: semester.totalCredit,
        gpaCredits: semester.totalGPACredits,
        storedLevel: stored && stored.Language_Level,
      };
    }, code);
    expect(before).toEqual({
      effectiveType: 'none',
      reason: 'Not counted — review language level',
      grade: 'B+',
      freeCredits: 0,
      degreeCredits: 0,
      gpaCredits: 3,
      storedLevel: undefined,
    });
    await expect(page.locator('.container_semester .course', { hasText: code }))
      .toContainText('N/A (REVIEW LANGUAGE LEVEL)');

    // The review can be recovered without re-importing the transcript: Manage
    // Custom Courses exposes the same explicit choice after any reload.
    await page.locator('.manageCustomCourses').click();
    const manage = page.locator('.custom_course_manage_overlay');
    await expect(manage).toBeVisible();
    await manage.locator('.custom_course_manage_item', { hasText: code })
      .getByRole('button', { name: /edit/i }).click();
    const edit = page.locator('.custom_course_modal');
    const level = edit.getByRole('combobox', { name: 'Language level:' });
    await expect(level).toBeVisible();
    // The title-based suggestion may be offered again, but the assertions
    // above prove it was not persisted or counted before this explicit Save.
    await expect(level).toHaveValue('basic');
    await level.selectOption('other');
    await edit.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(edit).toBeHidden();

    await page.waitForFunction((target) => {
      const semester = (window.curriculum.semesters || []).find((item) =>
        (item.courses || []).some((course) => course.code === target));
      const course = semester && semester.courses.find((item) => item.code === target);
      return course && course.effective_type === 'free' && !course.degreeExclusionReason;
    }, code);
    const after = await page.evaluate((target) => {
      const semester = window.curriculum.semesters.find((item) =>
        (item.courses || []).some((course) => course.code === target));
      const course = semester.courses.find((item) => item.code === target);
      const stored = JSON.parse(window.planStorage.getItem('customCourses_MAN') || '[]')
        .find((item) => `${item.Major}${item.Code}` === target);
      return {
        effectiveType: course.effective_type,
        reason: course.degreeExclusionReason || '',
        grade: course.grade,
        freeCredits: semester.totalFree,
        degreeCredits: semester.totalCredit,
        gpaCredits: semester.totalGPACredits,
        storedLevel: stored && stored.Language_Level,
      };
    }, code);
    expect(after).toEqual({
      effectiveType: 'free', reason: '', grade: 'B+',
      freeCredits: 3, degreeCredits: 3, gpaCredits: 3, storedLevel: 'other',
    });
  });
});
