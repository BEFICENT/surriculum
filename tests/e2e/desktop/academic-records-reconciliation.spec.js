'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');
const {
  GLOBAL_ONLY_CODE,
  triggerAcademicImport,
  readImportedCourseProgress,
} = require('../helpers/academic-records');
test.describe('academic records parsing (desktop)', () => {
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
    await triggerAcademicImport(page);
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
});
