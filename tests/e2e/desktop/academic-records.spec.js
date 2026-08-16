'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');

// A minimal SYNTHETIC transcript (no real personal data) shaped like the SUIS
// "Academic Records Summary" HTML the parser consumes: one .courseTable per
// semester, rows of [code, title, attempt, grade, suCredits, ects, status].
// It deliberately exercises the parser's rules.
const TRANSCRIPT_HTML = `
  <table class="courseTable">
    <thead><tr><th><b>Fall 2024-2025</b></th></tr></thead>
    <tbody>
      <tr><td>COURSE CODE</td><td>TITLE</td><td>ATT</td><td>GRADE</td><td>SU</td><td>ECTS</td><td>STATUS</td></tr>
      <tr><td>MATH 101</td><td>Calculus</td><td>1</td><td>A</td><td>3</td><td>6</td><td>Completed</td></tr>
      <tr><td>CS210</td><td>Data Structures</td><td>1</td><td>B</td><td>3</td><td>6</td><td>Completed</td></tr>
      <tr><td>PHYS101</td><td>Physics</td><td>1</td><td>W</td><td>3</td><td>6</td><td>Completed</td></tr>
      <tr><td>CHEM101</td><td>Chemistry</td><td>1</td><td>NA</td><td>3</td><td>6</td><td>Completed</td></tr>
      <tr><td>HUM101</td><td>Humanity</td><td>1</td><td>A+</td><td>3</td><td>6</td><td>Completed</td></tr>
      <tr><td>HIST191</td><td>History</td><td>2</td><td>C</td><td>3</td><td>6</td><td>Repeated</td></tr>
      <tr><td>CS201</td><td>Intro to Programming</td><td>1</td><td>Registered</td><td>3</td><td>6</td><td>Completed</td></tr>
    </tbody>
  </table>`;

// HIST484 exists in older program catalogs but not in CS/202401. Its live
// course-page request now fails, so the checked-in global row is useful only
// because the refresh pipeline hydrates its intrinsic metadata from those
// otherwise inaccessible catalog snapshots. This is the production case the
// global fallback is designed to preserve.
const GLOBAL_ONLY_CODE = 'HIST484';

const importTranscriptCustomCourseForReview = async (page, code, options = {}) => {
  const title = options.title || 'Transcript-only elective';
  const grade = options.grade || 'A';
  const html = `
    <table class="courseTable">
      <thead><tr><th><b>Fall 2024-2025</b></th></tr></thead>
      <tbody><tr><td>${code}</td><td>${title}</td><td>1</td><td>${grade}</td><td>3</td><td>6</td><td>Completed</td></tr></tbody>
    </table>`;
  await page.locator('#academicRecordsInput').setInputFiles({
    name: 'synthetic-custom-course.html',
    mimeType: 'text/html',
    buffer: Buffer.from(html),
  });
  await page.evaluate(() => document.getElementById('importAcademicRecords').click());

  const importModal = page.locator('.modal-overlay').filter({ hasText: /Import complete/i });
  await expect(importModal).toBeVisible();
  await expect(importModal).toContainText(code);
  await importModal.getByRole('button', { name: 'OK', exact: true }).click();

  const reminderModal = page.locator('.modal-overlay').filter({
    hasText: /Reminder: choose your programs & admit terms/i,
  });
  await expect(reminderModal).toBeVisible();
  await expect(reminderModal)
    .toContainText('SUIS → Student Records → General Student Information');
  await reminderModal.getByRole('button', { name: 'OK', exact: true }).click();

  const review = page.locator('.custom_course_modal');
  await expect(review).toBeVisible();
  await expect(review.locator('h3')).toHaveText('Review Imported Course');
  await expect(review).toContainText(/Save to keep this transcript course/i);
  await expect(review.locator('.cc-row').first().locator('input')).toHaveValue(code);
  return review;
};

const readTranscriptCustomCourseState = (page, code) => page.evaluate((targetCode) => {
  const normalize = (course) => String((course && course.Major) || '')
    + String((course && course.Code) || '');
  const planId = window.planStorage.getSessionPlanId();
  const customCourses = JSON.parse(
    window.planStorage.getItem('customCourses_CS', planId) || '[]',
  );
  const occurrences = (window.curriculum.semesters || []).flatMap((semester) =>
    (semester.courses || []).filter((course) => course.code === targetCode)
      .map((course) => ({ code: course.code, grade: course.grade, term: semester.termName })));
  return {
    customCount: customCourses.filter((course) => normalize(course) === targetCode).length,
    catalogCount: course_data.filter((course) => normalize(course) === targetCode).length,
    occurrences,
    renderedCount: Array.from(document.querySelectorAll('.container_semester .course'))
      .filter((node) => node.textContent.includes(targetCode)).length,
    semesterCount: window.curriculum.semesters.length,
  };
}, code);

const readImportedCourseProgress = (page, code) => page.evaluate((courseCode) => {
  const semester = (window.curriculum.semesters || []).find((row) =>
    (row.courses || []).some((course) => course.code === courseCode));
  const course = semester && semester.courses.find((row) => row.code === courseCode);
  const catalogInfo = window.getInfo(courseCode, course_data);
  const progress = window.curriculum.getGraduationProgress('main');
  const state = (progress.courseStates || []).find((row) => row.course.code === courseCode);
  return {
    termName: semester && semester.termName,
    course: course && {
      code: course.code,
      grade: course.grade,
      gradingBasis: course.gradingBasis,
      suCredits: Number(course.SU_credit),
      ects: Number(course.ECTS),
      effectiveType: course.effective_type,
    },
    state: state && {
      effective: state.effective,
      pgpaEffective: state.pgpaEffective,
    },
    catalog: catalogInfo && {
      type: catalogInfo.EL_Type,
      internalGlobal: Boolean(catalogInfo.__globalCourseDefinition),
    },
    cgpa: {
      value: progress.cgpa.value,
      credits: progress.cgpa.credits,
      points: progress.cgpa.points,
    },
    legacySemesterGpa: {
      credits: Number((semester && semester.totalGPACredits) || 0),
      points: Number((semester && semester.totalGPA) || 0),
    },
    pgpa: {
      value: Number.isFinite(progress.pgpa.value) ? progress.pgpa.value : null,
      credits: progress.pgpa.credits,
      points: progress.pgpa.points,
    },
    degreeTotal: progress.breakdown.total,
    listedAsCourseChoice: window.getCoursesList(course_data)
      .some((item) => item.code === courseCode),
  };
}, code);

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

  test('parseAcademicRecords applies the transcript extraction rules', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(
      (html) => window.academicRecordsParser.parseAcademicRecords(html),
      TRANSCRIPT_HTML,
    );

    const codes = result.courses.map((c) => c.code).sort();
    // W and NA are retained as unsuccessful attempts; A+ is not an official SU
    // undergraduate token and is rejected rather than becoming an ungraded row.
    expect(codes).toEqual(['CHEM101', 'CS201', 'DSA210', 'MATH101', 'PHYS101']);

    const byCode = Object.fromEntries(result.courses.map((c) => [c.code, c]));
    expect(byCode.MATH101.grade).toBe('A');
    expect(byCode.MATH101.gradingBasis).toBe('letter');
    expect(byCode.MATH101.suCredits).toBe(3);
    expect(byCode.MATH101.semester).toBe('Fall 2024-2025');
    expect(byCode.CS201.grade).toBe(''); // "Registered" normalizes to blank
    expect(byCode.PHYS101.grade).toBe('W');
    expect(byCode.PHYS101.gradingBasis).toBeUndefined();
    expect(byCode.CHEM101.grade).toBe('NA');
    expect(byCode.CHEM101.gradingBasis).toBeUndefined();
    expect(byCode.DSA210).toBeTruthy();  // CS210 -> DSA210 rename applied
    expect(codes).not.toContain('HIST191');
    expect(codes).not.toContain('HUM101');
    expect(result.invalidGradeCourses).toEqual([
      { code: 'HUM101', grade: 'A+', semester: 'Fall 2024-2025' },
    ]);
    expect(result.skippedCourses).toEqual([
      { code: 'HIST191', grade: 'C', semester: 'Fall 2024-2025', reason: 'repeated' },
    ]);
  });

  test('the latest non-Repeated attempt wins even when it is withdrawn', async ({ page }) => {
    await page.goto('/');
    // Newest-first exports must still keep the chronologically newest attempt;
    // DOM order is not a chronology guarantee.
    const html = `
      <table class="courseTable">
        <thead><tr><th><b>Fall 2024-2025</b></th></tr></thead>
        <tbody><tr><td>MATH101</td><td>Calculus</td><td>2</td><td>W</td><td>3</td><td>6</td><td>Completed</td></tr></tbody>
      </table>
      <table class="courseTable">
        <thead><tr><th><b>Fall 2023-2024</b></th></tr></thead>
        <tbody><tr><td>MATH101</td><td>Calculus</td><td>1</td><td>D</td><td>3</td><td>6</td><td>Completed</td></tr></tbody>
      </table>`;
    const result = await page.evaluate((h) => window.academicRecordsParser.parseAcademicRecords(h), html);
    expect(result.courses).toHaveLength(1);
    expect(result.courses[0].grade).toBe('W');
    expect(result.courses[0].semester).toBe('Fall 2024-2025');
    expect(result.supersededCourses).toEqual([
      expect.objectContaining({ code: 'MATH101', semester: 'Fall 2023-2024', keptSemester: 'Fall 2024-2025' }),
    ]);
  });

  test('an invalid HTML semester table does not inherit a neighboring valid term', async ({ page }) => {
    await page.goto('/');
    const html = `
      <table class="courseTable">
        <thead><tr><th><b>Fall 2023-2024</b></th></tr></thead>
        <tbody><tr><td>CS201</td><td>Programming</td><td>1</td><td>A</td><td>3</td><td>6</td><td>Completed</td></tr></tbody>
      </table>
      <table class="courseTable">
        <thead><tr><th><b>Autumn 2024-2025</b></th></tr></thead>
        <tbody><tr><td>MATH101</td><td>Calculus</td><td>1</td><td>B</td><td>3</td><td>6</td><td>Completed</td></tr></tbody>
      </table>
      <table class="courseTable">
        <thead><tr><th><b>Spring 2025-2026</b></th></tr></thead>
        <tbody><tr><td>HUM101</td><td>Humanity</td><td>1</td><td>C</td><td>3</td><td>6</td><td>Completed</td></tr></tbody>
      </table>`;

    const result = await page.evaluate(
      (content) => window.academicRecordsParser.parseAcademicRecords(content),
      html,
    );
    expect(result.courses.map(({ code, semester }) => ({ code, semester }))).toEqual([
      { code: 'CS201', semester: 'Fall 2023-2024' },
      { code: 'HUM101', semester: 'Spring 2025-2026' },
    ]);
    expect(result.skippedCourses).toEqual([{
      code: 'MATH101', grade: 'B', semester: 'Autumn 2024-2025',
      reason: 'missing-or-unrecognized-semester',
    }]);
    expect(result.detectedRecords).toBe(3);
  });

  test('import passes canonical grades and parallel grading bases to createSemeter', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(() => {
      const originalCreateSemester = window.createSemeter;
      const calls = [];
      window.createSemeter = (...args) => calls.push(args);
      try {
        const curriculum = { major: 'CS', recalcEffectiveTypes() {} };
        const courseData = [
          { code: 'MATH101', Major: 'MATH', Code: '101' },
          { code: 'SPS101', Major: 'SPS', Code: '101' },
          { code: 'CHEM101', Major: 'CHEM', Code: '101' },
          { code: 'HUM101', Major: 'HUM', Code: '101' },
          { code: 'NS101', Major: 'NS', Code: '101' },
        ];
        const imported = window.academicRecordsParser.importParsedCourses([
          { code: 'MATH101', semester: 'Fall 2024-2025', grade: ' a- ' },
          { code: 'SPS101', semester: 'Fall 2024-2025', grade: 'S' },
          { code: 'CHEM101', semester: 'Fall 2024-2025', grade: 'NA' },
          { code: 'HUM101', semester: 'Fall 2024-2025', grade: 'A+' },
          { code: 'NS101', semester: 'Fall 2024-2027', grade: 'A' },
        ], courseData, curriculum);
        return {
          grades: calls[0][4],
          gradingBases: calls[0][6],
          stats: imported.stats,
        };
      } finally {
        window.createSemeter = originalCreateSemester;
      }
    });

    expect(result.grades).toEqual(['A-', 'S', 'NA']);
    expect(result.gradingBases).toEqual(['letter', 'satisfactory', '']);
    expect(result.stats.importedCourses).toBe(3);
    expect(result.stats.invalidGradeCourses).toEqual([
      { code: 'HUM101', grade: 'A+', semester: 'Fall 2024-2025' },
    ]);
    expect(result.stats.skippedCourses).toEqual([
      {
        code: 'NS101', grade: 'A', semester: 'Fall 2024-2027',
        reason: 'missing-or-unrecognized-semester',
      },
    ]);
  });

  test('transcript custom-course storage stays bound to the session plan and fails closed', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(() => {
      const originalStorage = window.planStorage;
      const originalResolver = window.resolveGlobalCourseDefinition;
      const originalCreateSemester = window.createSemeter;
      const storageCalls = { get: [], set: [], save: [] };
      const createCalls = [];
      let persistedCustomCourses = [];
      const sessionPlanId = 'session-plan-under-test';
      const stubStorage = Object.assign({}, originalStorage, {
        getSessionPlanId: () => sessionPlanId,
        getItem(key, planId) {
          storageCalls.get.push({ key, planId });
          return JSON.stringify(persistedCustomCourses);
        },
        setItem(key, value, planId) {
          persistedCustomCourses = JSON.parse(value);
          storageCalls.set.push({ key, value: persistedCustomCourses, planId });
          return true;
        },
        requestSave(planId) {
          storageCalls.save.push(planId);
          return true;
        },
      });
      window.planStorage = stubStorage;
      window.resolveGlobalCourseDefinition = () => null;
      window.createSemeter = (_interactive, courses) => createCalls.push(courses.slice());
      localStorage.setItem('customCourses_CS', JSON.stringify(['legacy-unscoped-sentinel']));

      try {
        const curriculum = { major: 'CS', recalcEffectiveTypes() {} };
        const successfulCourseData = [];
        const successfulImport = window.academicRecordsParser.importParsedCourses([{
          code: 'FEL999', title: 'Transcript Elective', semester: 'Fall 2024-2025',
          grade: 'A', suCredits: 3, ects: 6,
        }], successfulCourseData, curriculum);

        // Once planStorage exists, a read error must not consult or combine
        // the legacy unscoped key with the current session plan.
        stubStorage.getItem = (key, planId) => {
          storageCalls.get.push({ key, planId, failed: true });
          throw new Error('synthetic plan storage failure');
        };
        const failedCourseData = [];
        const failedImport = window.academicRecordsParser.importParsedCourses([{
          code: 'FEL998', title: 'Second Transcript Elective', semester: 'Spring 2024-2025',
          grade: 'B', suCredits: 3, ects: 6,
        }], failedCourseData, curriculum);

        return {
          storageCalls,
          createCalls,
          persistedCustomCourses,
          successfulCourseData,
          successfulPendingCount: successfulImport.pendingCustomCourses.length,
          failedCourseData,
          failedPendingCount: failedImport.pendingCustomCourses.length,
          failedStats: failedImport.stats,
          legacyRaw: JSON.parse(localStorage.getItem('customCourses_CS')),
        };
      } finally {
        window.planStorage = originalStorage;
        window.resolveGlobalCourseDefinition = originalResolver;
        window.createSemeter = originalCreateSemester;
        localStorage.removeItem('customCourses_CS');
      }
    });

    expect(result.storageCalls.get).toEqual([
      { key: 'customCourses_CS', planId: 'session-plan-under-test' },
      { key: 'customCourses_CS', planId: 'session-plan-under-test', failed: true },
    ]);
    expect(result.storageCalls.set).toHaveLength(1);
    expect(result.storageCalls.set[0]).toMatchObject({
      key: 'customCourses_CS', planId: 'session-plan-under-test',
    });
    expect(result.storageCalls.set[0].value).toEqual([
      expect.objectContaining({ Major: 'FEL', Code: '999', EL_Type: 'free' }),
    ]);
    expect(result.storageCalls.save).toEqual(['session-plan-under-test']);
    expect(result.createCalls).toEqual([['FEL999']]);
    expect(result.persistedCustomCourses).toEqual([
      expect.objectContaining({ Major: 'FEL', Code: '999', EL_Type: 'free' }),
    ]);
    expect(result.successfulCourseData).toEqual(result.persistedCustomCourses);
    expect(result.successfulPendingCount).toBe(1);
    expect(result.failedCourseData).toEqual([]);
    expect(result.failedPendingCount).toBe(0);
    expect(result.failedStats.importedCourses).toBe(0);
    expect(result.failedStats.changedCourses).toBe(0);
    expect(result.failedStats.skippedCourses).toEqual([{
      code: 'FEL998', grade: 'B', semester: 'Spring 2024-2025',
      reason: 'custom-course-storage-failed',
    }]);
    expect(result.legacyRaw).toEqual(['legacy-unscoped-sentinel']);
  });

  test('re-import updates the matching planned occurrence without adding a semester', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [['MATH101']],
      grades: [['']],
      dates: ['Fall 2024-2025'],
    });

    const result = await page.evaluate(() => {
      const beforeSemesters = window.curriculum.semesters.length;
      const imported = window.academicRecordsParser.importParsedCourses([
        { code: 'MATH101', semester: 'Fall 2024-2025', grade: 'A' },
      ], course_data, window.curriculum);
      const course = window.curriculum.semesters[0].courses[0];
      return {
        stats: imported.stats,
        beforeSemesters,
        afterSemesters: window.curriculum.semesters.length,
        grade: course.grade,
        basis: course.gradingBasis,
      };
    });

    expect(result.beforeSemesters).toBe(result.afterSemesters);
    expect(result.grade).toBe('A');
    expect(result.basis).toBe('letter');
    expect(result.stats.importedCourses).toBe(0);
    expect(result.stats.updatedCourseCount).toBe(1);
    expect(result.stats.addedCourses).toEqual([]);
  });

  test('importing a new course reuses the matching term card and preserves its existing row', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [['MATH101']],
      grades: [['A']],
      gradingBases: [['letter']],
      dates: ['Fall 2024-2025'],
    });
    const beforeId = await page.evaluate(() => window.curriculum.semesters[0].courses[0].id);

    const stats = await page.evaluate(async () => {
      const imported = await window.academicRecordsParser.importParsedCourses([{
        code: 'NS101',
        title: 'Science of Nature',
        semester: 'Fall 2024-2025',
        grade: 'B+',
        suCredits: 4,
        ects: 8,
      }], course_data, window.curriculum);
      window.planStorage.flushSaves();
      return imported.stats;
    });

    const state = await page.evaluate(() => ({
      semesters: window.curriculum.semesters.map((semester) => ({
        name: semester.termName,
        code: window.semesterTermCode(semester),
        courses: semester.courses.map((course) => ({
          code: course.code,
          id: course.id,
          grade: course.grade,
          gradingBasis: course.gradingBasis,
        })),
      })),
      cards: [...document.querySelectorAll('.container_semester')].map((container) => ({
        term: String((container.querySelector('.date p') || {}).textContent || '').trim(),
        codes: [...container.querySelectorAll('.course_code')]
          .map((element) => String(element.textContent || '').trim()),
      })),
      stored: {
        curriculum: JSON.parse(window.planStorage.getItem('curriculum')),
        grades: JSON.parse(window.planStorage.getItem('grades')),
        gradingBases: JSON.parse(window.planStorage.getItem('gradingBases')),
        dates: JSON.parse(window.planStorage.getItem('dates')),
        termCodes: JSON.parse(window.planStorage.getItem('termCodes')),
      },
    }));

    expect(stats.importedCourses).toBe(1);
    expect(stats.addedCourses).toEqual([{
      code: 'NS101', semester: 'Fall 2024-2025', grade: 'B+',
    }]);
    expect(state.semesters).toEqual([{
      name: 'Fall 2024-2025',
      code: '202401',
      courses: [
        { code: 'MATH101', id: beforeId, grade: 'A', gradingBasis: 'letter' },
        expect.objectContaining({ code: 'NS101', grade: 'B+', gradingBasis: 'letter' }),
      ],
    }]);
    expect(state.cards).toEqual([{
      term: 'Fall 2024-2025', codes: ['MATH101', 'NS101'],
    }]);
    expect(state.stored).toEqual({
      curriculum: [['MATH101', 'NS101']],
      grades: [['A', 'B+']],
      gradingBases: [['letter', 'letter']],
      dates: ['Fall 2024-2025'],
      termCodes: ['202401'],
    });
  });

  test('only a selected minor catalog confers membership on a synthetic course', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(async () => {
      const originalCreateSemester = window.createSemeter;
      const calls = [];
      window.createSemeter = (...args) => calls.push(args);
      try {
        const selectedMinorCourse = {
          Major: 'MINR', Code: '999', Course_Name: 'Selected Minor Course',
          SU_credit: '3', ECTS: '6', Engineering: 0, Basic_Science: 0,
          Faculty: 'FASS', Faculty_Course: 'No', EL_Type: 'required',
        };
        const unselectedMinorCourse = {
          Major: 'OFFR', Code: '999', Course_Name: 'Unselected Minor Course',
          SU_credit: '3', ECTS: '6', Engineering: 0, Basic_Science: 0,
          Faculty: 'FASS', Faculty_Course: 'No', EL_Type: 'required',
        };
        const selectedGlobalFallback = {
          Major: 'MINR', Code: '999', Course_Name: 'Internal fallback',
          SU_credit: '2', ECTS: '4', EL_Type: 'unknown',
          __globalCourseDefinition: true,
        };
        const existingGlobalFallback = {
          Major: 'FALL', Code: '999', Course_Name: 'Existing global course',
          SU_credit: '3', ECTS: '6', EL_Type: 'unknown',
          __globalCourseDefinition: true,
        };
        const curriculum = {
          major: 'CS',
          minors: ['SYN-MINOR'],
          minorCourseDataByCode: {
            'SYN-MINOR': [selectedMinorCourse],
            'OTHER-MINOR': [unselectedMinorCourse],
          },
          recalcEffectiveTypes() {},
        };
        const imported = await window.academicRecordsParser.importParsedCourses([
          {
            code: 'MINR999', title: 'Selected Minor Course', semester: 'Fall 2024-2025',
            grade: 'A', suCredits: 3, ects: 6,
          },
          {
            code: 'OFFR999', title: 'Unselected Minor Course', semester: 'Fall 2024-2025',
            grade: 'A', suCredits: 3, ects: 6,
          },
          {
            code: 'FALL999', title: 'Existing global course', semester: 'Fall 2024-2025',
            grade: 'B', suCredits: 3, ects: 6,
          },
        ], [selectedGlobalFallback, existingGlobalFallback], curriculum);
        return {
          calls: calls.map((args) => ({ courses: args[1], grades: args[4], term: args[5] })),
          stats: imported.stats,
        };
      } finally {
        window.createSemeter = originalCreateSemester;
      }
    });

    expect(result.calls).toEqual([
      { courses: ['MINR999', 'FALL999'], grades: ['A', 'B'], term: 'Fall 2024-2025' },
    ]);
    expect(result.stats.importedCourses).toBe(2);
    expect(result.stats.notFoundCourses).toEqual(['OFFR999']);
    expect(result.stats.retainedUnallocatedCourses).toEqual([{
      code: 'FALL999', semester: 'Fall 2024-2025', grade: 'B',
      suCredits: 3, source: 'existing-global-definition',
    }]);
  });

  test('transcript metadata backfills missing fields in a global course definition', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(async () => {
      const index = await window.loadCoursePageInfoIndex();
      index.set('FILL999', {
        course_id: 'FILL999',
        subj_code: 'FILL',
        crse_numb: '999',
        title: null,
        su_credits: null,
        ects: null,
        engineering: null,
        basic_science: null,
        last_offered_terms: [],
      });
      const definition = window.resolveGlobalCourseDefinition('FILL999', {
        title: 'Transcript Fallback Title',
        suCredits: 2.5,
        ects: 5,
      });
      window.rememberGlobalCourseDefinition(definition);
      window.planStorage.setItem('curriculum', JSON.stringify([['FILL999']]));
      window.planStorage.setItem('grades', JSON.stringify([['B']]));
      window.planStorage.setItem('gradingBases', JSON.stringify([['letter']]));
      window.planStorage.setItem('dates', JSON.stringify(['Fall 2024-2025']));
      return definition;
    });

    expect(result).toEqual({
      Major: 'FILL',
      Code: '999',
      Course_Name: 'Transcript Fallback Title',
      ECTS: '5',
      Engineering: 0,
      Basic_Science: 0,
      SU_credit: '2.5',
      Faculty: '',
      Faculty_Course: 'No',
      EL_Type: 'unknown',
      __globalCourseDefinition: true,
    });

    // Simulate the cumulative index being temporarily unavailable on reload.
    // The plan-scoped snapshot must preserve the course and its GPA credits,
    // and autosave must not erase the unresolved saved code.
    await page.addInitScript(() => {
      const nativeFetch = window.fetch.bind(window);
      window.fetch = (resource, options) => {
        const url = typeof resource === 'string' ? resource : String(resource && resource.url || '');
        if (url.includes('all_coursepage_info.jsonl')) {
          return Promise.reject(new TypeError('Synthetic global-index outage'));
        }
        return nativeFetch(resource, options);
      };
    });
    await page.reload();
    await page.waitForFunction(() => window.curriculum
      && (window.curriculum.semesters || []).some((semester) =>
        (semester.courses || []).some((course) => course.code === 'FILL999')));

    expect(await readImportedCourseProgress(page, 'FILL999')).toMatchObject({
      course: {
        code: 'FILL999', grade: 'B', gradingBasis: 'letter',
        suCredits: 2.5, ects: 5, effectiveType: 'none',
      },
      state: { effective: 'none', pgpaEffective: 'none' },
      catalog: { type: 'unknown', internalGlobal: true },
      cgpa: { value: 3, credits: 2.5, points: 7.5 },
      pgpa: { value: null, credits: 0, points: 0 },
      listedAsCourseChoice: false,
    });
    await page.waitForTimeout(2200);
    expect(await page.evaluate(() => JSON.parse(window.planStorage.getItem('curriculum'))))
      .toEqual([['FILL999']]);
  });

  test('re-import repairs a legacy global placeholder during an index outage', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => window.planStorage && window.planStorage.importPlanObject);
    await page.evaluate(() => window.planStorage.importPlanObject({
      type: 'surriculum_plan',
      version: 2,
      plan: {
        name: 'Legacy placeholder',
        state: {
          major: 'CS',
          entryTerm: 'Fall 2024-2025',
          curriculum: [['FILL999']],
          grades: [['']],
          gradingBases: [['unknown']],
          dates: ['Fall 2024-2025'],
        },
      },
    }, { activate: true }));
    await page.addInitScript(() => {
      const nativeFetch = window.fetch.bind(window);
      window.fetch = (resource, options) => {
        const url = typeof resource === 'string' ? resource : String(resource && resource.url || '');
        if (url.includes('all_coursepage_info.jsonl')) {
          return Promise.reject(new TypeError('Synthetic global-index outage'));
        }
        return nativeFetch(resource, options);
      };
    });
    await page.reload();
    await page.waitForFunction(() => window.curriculum
      && (window.curriculum.semesters || []).some((semester) =>
        (semester.courses || []).some((course) => course.code === 'FILL999')));

    expect(await readImportedCourseProgress(page, 'FILL999')).toMatchObject({
      course: { code: 'FILL999', grade: '', suCredits: 0, ects: 0 },
      catalog: { type: 'unknown', internalGlobal: true },
      cgpa: { credits: 0, points: 0 },
    });

    const result = await page.evaluate(() => {
      const imported = window.academicRecordsParser.importParsedCourses([{
        code: 'FILL999',
        title: 'Transcript-restored course',
        semester: 'Fall 2024-2025',
        grade: 'B',
        suCredits: 2.5,
        ects: 5,
      }], course_data, window.curriculum);
      const occurrences = (window.curriculum.semesters || []).flatMap((semester) =>
        (semester.courses || []).filter((course) => course.code === 'FILL999'));
      return { stats: imported.stats, occurrences: occurrences.length };
    });

    expect(result.occurrences).toBe(1);
    expect(result.stats.updatedCourseCount).toBe(1);
    expect(result.stats.importedCourses).toBe(0);
    expect(result.stats.retainedUnallocatedCourses).toEqual([{
      code: 'FILL999', semester: 'Fall 2024-2025', grade: 'B',
      suCredits: 2.5, source: 'saved-transcript-fallback',
    }]);
    expect(await readImportedCourseProgress(page, 'FILL999')).toMatchObject({
      course: {
        code: 'FILL999', grade: 'B', gradingBasis: 'letter',
        suCredits: 2.5, ects: 5, effectiveType: 'none',
      },
      state: { effective: 'none', pgpaEffective: 'none' },
      catalog: { type: 'unknown', internalGlobal: true },
      cgpa: { value: 3, credits: 2.5, points: 7.5 },
      legacySemesterGpa: { credits: 2.5, points: 7.5 },
      pgpa: { value: null, credits: 0, points: 0 },
    });
    expect(await page.evaluate(() => JSON.parse(
      window.planStorage.getItem('globalCourseMetadata') || '[]',
    ))).toEqual([{
      code: 'FILL999', title: 'Transcript-restored course', suCredits: 2.5, ects: 5,
    }]);

    await page.waitForTimeout(2200);
    await page.reload();
    await page.waitForFunction(() => window.curriculum
      && (window.curriculum.semesters || []).some((semester) =>
        (semester.courses || []).some((course) => course.code === 'FILL999')));
    expect(await readImportedCourseProgress(page, 'FILL999')).toMatchObject({
      course: { code: 'FILL999', grade: 'B', suCredits: 2.5, ects: 5 },
      cgpa: { value: 3, credits: 2.5, points: 7.5 },
      legacySemesterGpa: { credits: 2.5, points: 7.5 },
    });

    // Transcript parsers use 0 when a credit cell is missing. A same-grade
    // re-import must treat that as absent fallback metadata, preserve the
    // nonzero saved snapshot, and still report the metadata-only repair.
    const zeroFallback = await page.evaluate(() => {
      const imported = window.academicRecordsParser.importParsedCourses([{
        code: 'FILL999', title: '', semester: 'Fall 2024-2025', grade: 'B',
        suCredits: 0, ects: 0,
      }], course_data, window.curriculum);
      return imported.stats;
    });
    expect(zeroFallback.updatedCourseCount).toBe(1);
    expect(zeroFallback.retainedUnallocatedCourses).toEqual([{
      code: 'FILL999', semester: 'Fall 2024-2025', grade: 'B',
      suCredits: 2.5, source: 'saved-transcript-fallback',
    }]);
    expect(await readImportedCourseProgress(page, 'FILL999')).toMatchObject({
      course: { code: 'FILL999', grade: 'B', suCredits: 2.5, ects: 5 },
      cgpa: { value: 3, credits: 2.5, points: 7.5 },
      legacySemesterGpa: { credits: 2.5, points: 7.5 },
    });
    expect(await page.evaluate(() => JSON.parse(
      window.planStorage.getItem('globalCourseMetadata') || '[]',
    ))).toEqual([{
      code: 'FILL999', title: 'Transcript-restored course', suCredits: 2.5, ects: 5,
    }]);
  });

  test('a globally known transcript course is retained as N/A for the program and survives reload', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [],
      grades: [],
      dates: [],
    });
    await page.waitForFunction(() => typeof course_data !== 'undefined'
      && Array.isArray(course_data) && course_data.length > 0
      && window.curriculum && typeof window.curriculum.getGraduationProgress === 'function');

    const hydrated = await page.evaluate(async (courseCode) => {
      const index = await window.loadCoursePageInfoIndex();
      if (!index.has(courseCode)) throw new Error('Hydrated historical course did not load');
      const row = index.get(courseCode);
      return {
        title: row.title,
        suCredits: row.su_credits,
        ects: row.ects,
        faculty: row.faculty,
        scrapeOk: row.scrape_ok,
      };
    }, GLOBAL_ONLY_CODE);
    expect(hydrated).toEqual({
      title: 'Peripheral Populations in the Ottoman Empire (1300-1914)',
      suCredits: 3,
      ects: 6,
      faculty: 'FASS',
      scrapeOk: false,
    });

    // Deliberately conflicting transcript metadata proves the hydrated catalog
    // identity wins. Use the real file-input path so the retained-N/A warning
    // is pinned at the UI boundary as well.
    const html = `
      <table class="courseTable">
        <thead><tr><th><b>Fall 2024-2025</b></th></tr></thead>
        <tbody><tr><td>${GLOBAL_ONLY_CODE}</td><td>Transcript Title</td><td>1</td><td>B</td><td>2.5</td><td>5</td><td>Completed</td></tr></tbody>
      </table>`;
    await page.locator('#academicRecordsInput').setInputFiles({
      name: 'synthetic-global-course.html',
      mimeType: 'text/html',
      buffer: Buffer.from(html),
    });
    await page.evaluate(() => document.getElementById('importAcademicRecords').click());
    const importModal = page.locator('.modal-overlay').filter({ hasText: /Import complete/i });
    await expect(importModal).toBeVisible();
    await expect(importModal).toContainText(GLOBAL_ONLY_CODE);
    await expect(importModal).toContainText(/retained as N\/A/i);
    await expect(importModal).toContainText(/count toward CGPA/i);
    await expect(importModal).toContainText(/outside PGPA and graduation/i);
    expect(await page.evaluate((courseCode) => {
      const rows = JSON.parse(window.planStorage.getItem('globalCourseMetadata') || '[]');
      return rows.find((row) => row.code === courseCode) || null;
    }, GLOBAL_ONLY_CODE)).toEqual({
      code: GLOBAL_ONLY_CODE,
      title: 'Peripheral Populations in the Ottoman Empire (1300-1914)',
      suCredits: 3,
      ects: 6,
    });

    const beforeReload = await readImportedCourseProgress(page, GLOBAL_ONLY_CODE);
    expect(beforeReload).toMatchObject({
      termName: 'Fall 2024-2025',
      course: {
        code: GLOBAL_ONLY_CODE,
        grade: 'B',
        gradingBasis: 'letter',
        suCredits: 3,
        ects: 6,
        effectiveType: 'none',
      },
      state: { effective: 'none', pgpaEffective: 'none' },
      catalog: { type: 'unknown', internalGlobal: true },
      cgpa: { value: 3, credits: 3, points: 9 },
      pgpa: { value: null, credits: 0, points: 0 },
      degreeTotal: { earned: 0, current: 0, future: 0, unverified: 0, projected: 0 },
      listedAsCourseChoice: false,
    });

    // Exercise the same periodic persistence fields used by the app, then load
    // in a fresh page context that must resolve the definition from the index.
    await page.evaluate(() => {
      window.planStorage.setItem('curriculum', serializator(window.curriculum));
      window.planStorage.setItem('grades', grades_serializator(window.curriculum));
      window.planStorage.setItem('gradingBases', grading_bases_serializator(window.curriculum));
      window.planStorage.setItem('dates', dates_serializator());
    });
    await page.reload();
    await page.waitForFunction((courseCode) => window.curriculum
      && (window.curriculum.semesters || []).some((semester) =>
        (semester.courses || []).some((course) => course.code === courseCode)), GLOBAL_ONLY_CODE);

    expect(await readImportedCourseProgress(page, GLOBAL_ONLY_CODE)).toEqual(beforeReload);

    // The same saved occurrence becomes a normal program course when the user
    // corrects the admit-term selection to a catalog containing HIST484.
    await page.evaluate(() => window.planStorage.setItem('entryTerm', 'Fall 2020-2021'));
    await page.reload();
    await page.waitForFunction((courseCode) => window.curriculum
      && (window.curriculum.semesters || []).some((semester) =>
        (semester.courses || []).some((course) => course.code === courseCode)), GLOBAL_ONLY_CODE);
    expect(await readImportedCourseProgress(page, GLOBAL_ONLY_CODE)).toMatchObject({
      course: { code: GLOBAL_ONLY_CODE, suCredits: 3, ects: 6, effectiveType: 'free' },
      state: { effective: 'free', pgpaEffective: 'free' },
      catalog: { type: 'free', internalGlobal: false },
      cgpa: { value: 3, credits: 3, points: 9 },
      pgpa: { value: 3, credits: 3, points: 9 },
      listedAsCourseChoice: false,
    });
  });

  test('a truly unknown valid-grade course is explicitly reported and skipped', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(async () => {
      const index = await window.loadCoursePageInfoIndex();
      const originalCreateSemester = window.createSemeter;
      const calls = [];
      window.createSemeter = (...args) => calls.push(args);
      try {
        index.delete('ZZZ999');
        const imported = await window.academicRecordsParser.importParsedCourses([{
          code: 'ZZZ999',
          title: 'Reliable Transcript-Only Metadata',
          semester: 'Fall 2024-2025',
          grade: 'A',
          suCredits: 3,
          ects: 6,
        }], [], { major: 'CS', minors: [], recalcEffectiveTypes() {} });
        return { stats: imported.stats, createCalls: calls.length };
      } finally {
        window.createSemeter = originalCreateSemester;
      }
    });

    expect(result.createCalls).toBe(0);
    expect(result.stats.importedCourses).toBe(0);
    expect(result.stats.invalidGradeCourses).toEqual([]);
    expect(result.stats.notFoundCourses).toEqual(['ZZZ999']);
  });

  test('zero-change import reports unsupported and not-found records together', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [],
      grades: [],
      dates: [],
    });
    await page.waitForFunction(() => typeof course_data !== 'undefined'
      && Array.isArray(course_data) && course_data.length > 0);

    const html = `
      <table class="courseTable">
        <thead><tr><th><b>Fall 2024-2025</b></th></tr></thead>
        <tbody>
          <tr><td>ZZZ999</td><td>Unknown Course</td><td>1</td><td>A</td><td>3</td><td>6</td><td>Completed</td></tr>
          <tr><td>HUM101</td><td>Humanity</td><td>1</td><td>A+</td><td>3</td><td>6</td><td>Completed</td></tr>
        </tbody>
      </table>`;
    await page.locator('#academicRecordsInput').setInputFiles({
      name: 'synthetic-academic-records.html',
      mimeType: 'text/html',
      buffer: Buffer.from(html),
    });
    await page.evaluate(() => document.getElementById('importAcademicRecords').click());

    const overlay = page.locator('.modal-overlay').filter({ hasText: /No courses imported/i });
    await expect(overlay).toBeVisible();
    await expect(overlay).toContainText('ZZZ999');
    await expect(overlay).toContainText('HUM101');
    await expect(overlay).toContainText(/could not be verified/i);
    await expect(overlay).toContainText(/unsupported/i);
  });

  test('an unrecognized transcript term is explained without mutating the plan', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [['MATH101']],
      grades: [['A']],
      dates: ['Fall 2024-2025'],
    });
    const before = await page.evaluate(() => ({
      curriculum: serializator(window.curriculum),
      grades: grades_serializator(window.curriculum),
      dates: dates_serializator(window.curriculum),
    }));
    const html = `
      <table class="courseTable">
        <thead><tr><th><b>Autumn 2024-2025</b></th></tr></thead>
        <tbody><tr><td>NS101</td><td>Science of Nature</td><td>1</td><td>A</td><td>4</td><td>8</td><td>Completed</td></tr></tbody>
      </table>`;
    await page.locator('#academicRecordsInput').setInputFiles({
      name: 'synthetic-missing-term.html',
      mimeType: 'text/html',
      buffer: Buffer.from(html),
    });
    await page.evaluate(() => document.getElementById('importAcademicRecords').click());

    const overlay = page.locator('.modal-overlay').filter({ hasText: /No importable courses/i });
    await expect(overlay).toBeVisible();
    await expect(overlay).toContainText('NS101');
    await expect(overlay).toContainText('Autumn 2024-2025');
    await expect(overlay).toContainText(/missing or unrecognized semester/i);
    expect(await page.evaluate(() => ({
      curriculum: serializator(window.curriculum),
      grades: grades_serializator(window.curriculum),
      dates: dates_serializator(window.curriculum),
    }))).toEqual(before);
    expect(await page.evaluate(() => window.curriculum.semesters
      .some((semester) => semester.termName === 'Unknown Semester'))).toBe(false);
  });

  test('successful import identifies every non-imported and superseded transcript record', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [],
      grades: [],
      dates: [],
    });
    await page.waitForFunction(() => typeof course_data !== 'undefined'
      && Array.isArray(course_data) && course_data.length > 0);

    const html = `
      <table class="courseTable">
        <thead><tr><th><b>Fall 2023-2024</b></th></tr></thead>
        <tbody>
          <tr><td>MATH101</td><td>Calculus</td><td>1</td><td>D</td><td>3</td><td>6</td><td>Completed</td></tr>
          <tr><td>HIST191</td><td>History</td><td>1</td><td>C</td><td>3</td><td>6</td><td>Repeated</td></tr>
          <tr><td>PROJ201</td><td>Project</td><td>1</td><td>W</td><td>3</td><td>6</td><td>Excluded</td></tr>
        </tbody>
      </table>
      <table class="courseTable">
        <thead><tr><th><b>Fall 2024-2025</b></th></tr></thead>
        <tbody>
          <tr><td>MATH101</td><td>Calculus</td><td>2</td><td>A</td><td>3</td><td>6</td><td>Completed</td></tr>
          <tr><td>ZZZ999</td><td>Unknown Course</td><td>1</td><td>B</td><td>3</td><td>6</td><td>Completed</td></tr>
        </tbody>
      </table>
      <table class="courseTable">
        <thead><tr><th>Missing term heading</th></tr></thead>
        <tbody><tr><td>NS101</td><td>Science of Nature</td><td>1</td><td>B+</td><td>4</td><td>8</td><td>Completed</td></tr></tbody>
      </table>`;
    await page.locator('#academicRecordsInput').setInputFiles({
      name: 'synthetic-import-report.html',
      mimeType: 'text/html',
      buffer: Buffer.from(html),
    });
    await page.evaluate(() => document.getElementById('importAcademicRecords').click());

    const overlay = page.locator('.modal-overlay').filter({ hasText: /Import complete/i });
    await expect(overlay).toBeVisible();
    await expect(overlay).toContainText(/Added \(1\)/i);
    await expect(overlay).toContainText('MATH101');
    await expect(overlay).toContainText(/Not found \(1\)/i);
    await expect(overlay).toContainText('ZZZ999');
    await expect(overlay).toContainText(/Older duplicate records \(1\)/i);
    await expect(overlay).toContainText(/Fall 2023-2024.*kept latest record.*Fall 2024-2025/i);
    await expect(overlay).toContainText(/Skipped \(3\)/i);
    await expect(overlay).toContainText('HIST191');
    await expect(overlay).toContainText('PROJ201');
    await expect(overlay).toContainText('NS101');
    await expect(overlay).toContainText(/missing or unrecognized semester/i);
    await expect(overlay).toContainText(/both repeated and substituted courses/i);
    await expect(overlay).toContainText(/marked Excluded/i);
  });

  test('all-skipped import explains transcript status without creating courses', async ({ page }) => {
    await page.goto('/');
    const html = `
      <table class="courseTable">
        <thead><tr><th><b>Fall 2024-2025</b></th></tr></thead>
        <tbody>
          <tr><td>HIST191</td><td>History</td><td>1</td><td>C</td><td>3</td><td>6</td><td>Repeated</td></tr>
          <tr><td>PROJ201</td><td>Project</td><td>1</td><td>W</td><td>3</td><td>6</td><td>Excluded</td></tr>
        </tbody>
      </table>`;
    await page.locator('#academicRecordsInput').setInputFiles({
      name: 'synthetic-all-skipped.html',
      mimeType: 'text/html',
      buffer: Buffer.from(html),
    });
    await page.evaluate(() => document.getElementById('importAcademicRecords').click());

    const overlay = page.locator('.modal-overlay').filter({ hasText: /No importable courses/i });
    await expect(overlay).toBeVisible();
    await expect(overlay).toContainText('HIST191');
    await expect(overlay).toContainText('PROJ201');
    await expect(overlay).toContainText(/both repeated and substituted courses/i);
    await expect(overlay).toContainText(/marked Excluded/i);
  });

  test('an oversized HTML transcript is rejected before parsing without changing the plan', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [['CS201']],
      grades: [['A']],
      dates: ['Fall 2024-2025'],
    });
    const before = await page.evaluate(() => ({
      curriculum: serializator(window.curriculum),
      grades: grades_serializator(window.curriculum),
      dates: dates_serializator(window.curriculum),
    }));

    await page.locator('#academicRecordsInput').setInputFiles({
      name: 'oversized-transcript.html',
      mimeType: 'text/html',
      buffer: Buffer.alloc((10 * 1024 * 1024) + 1, 0x20),
    });
    await page.evaluate(() => document.getElementById('importAcademicRecords').click());

    const overlay = page.locator('.modal-overlay').filter({ hasText: /Transcript file is too large/i });
    await expect(overlay).toBeVisible();
    await expect(overlay).toContainText('10 MB');
    await expect(page.locator('#academicRecordsInput')).toHaveValue('');
    expect(await page.evaluate(() => ({
      curriculum: serializator(window.curriculum),
      grades: grades_serializator(window.curriculum),
      dates: dates_serializator(window.curriculum),
    }))).toEqual(before);
  });
});
