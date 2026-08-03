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
        ];
        const imported = window.academicRecordsParser.importParsedCourses([
          { code: 'MATH101', semester: 'Fall 2024-2025', grade: ' a- ' },
          { code: 'SPS101', semester: 'Fall 2024-2025', grade: 'S' },
          { code: 'CHEM101', semester: 'Fall 2024-2025', grade: 'NA' },
          { code: 'HUM101', semester: 'Fall 2024-2025', grade: 'A+' },
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
});
