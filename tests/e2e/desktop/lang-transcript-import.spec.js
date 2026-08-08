'use strict';

const { test, expect } = require('../fixtures');

const transcriptCourse = (overrides = {}) => ({
  code: 'LANG100',
  title: 'Basic Swedish for International Students',
  semester: 'Fall 2024-2025',
  grade: 'B+',
  suCredits: 3,
  ects: 6,
  ...overrides,
});

test.describe('exchange LANG transcript imports', () => {
  test('preserves the transcript record and classifies main/DM programs independently', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate((input) => {
      const originalCreateSemester = window.createSemeter;
      const createCalls = [];
      const data = [];
      try {
        window.createSemeter = (...args) => createCalls.push({
          courses: args[1],
          grades: args[4],
          term: args[5],
          gradingBases: args[6],
        });
        const curriculum = {
          major: 'MAN',
          doubleMajor: 'CS',
          doubleMajorCourseData: [],
          recalcEffectiveTypes() {},
        };
        const imported = window.academicRecordsParser.importParsedCourses(
          [input], data, curriculum,
        );
        const planId = window.planStorage.getSessionPlanId();
        const read = (program) => JSON.parse(
          window.planStorage.getItem(`customCourses_${program}`, planId) || '[]',
        ).find((record) => `${record.Major}${record.Code}` === 'LANG100');
        return {
          stats: imported.stats,
          pending: imported.pendingCustomCourses.map((entry) => ({
            parsedInfo: entry.parsedInfo,
            programs: entry.programCourses.map((item) => ({
              program: item.program,
              type: item.course.EL_Type,
              languageLevel: item.course.Language_Level || '',
            })),
          })),
          mainRecord: read('MAN'),
          dmRecord: read('CS'),
          data,
          createCalls,
        };
      } finally {
        window.createSemeter = originalCreateSemester;
      }
    }, transcriptCourse());

    expect(result.stats.importedCourses).toBe(1);
    expect(result.stats.notFoundCourses).toEqual([]);
    expect(result.stats.skippedCourses).toEqual([]);
    expect(result.createCalls).toEqual([{
      courses: ['LANG100'],
      grades: ['B+'],
      term: 'Fall 2024-2025',
      gradingBases: ['letter'],
    }]);
    expect(result.mainRecord).toMatchObject({
      Major: 'LANG',
      Code: '100',
      Course_Name: 'Basic Swedish for International Students',
      SU_credit: '3',
      ECTS: '6',
      EL_Type: 'free',
      Faculty: '',
      Faculty_Course: 'No',
    });
    expect(result.mainRecord.Language_Level || '').toBe('');
    expect(result.dmRecord).toMatchObject({
      Major: 'LANG',
      Code: '100',
      Course_Name: 'Basic Swedish for International Students',
      SU_credit: '3',
      ECTS: '6',
      EL_Type: 'unknown',
      Faculty: '',
      Faculty_Course: 'No',
    });
    expect(result.dmRecord.Language_Level || '').toBe('');
    expect(result.data).toEqual([expect.objectContaining({
      Major: 'LANG', Code: '100', EL_Type: 'free',
    })]);
    expect(result.data[0].Language_Level || '').toBe('');
    expect(result.pending).toEqual([{
      parsedInfo: expect.objectContaining({
        code: 'LANG100', title: 'Basic Swedish for International Students',
        suCredits: 3, ects: 6, elType: 'free', Language_Level: 'basic',
      }),
      programs: [
        { program: 'MAN', type: 'free', languageLevel: '' },
        { program: 'CS', type: 'unknown', languageLevel: '' },
      ],
    }]);
  });

  test('preserves a previously reviewed language level while refreshing transcript metadata', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate((input) => {
      const storage = window.planStorage;
      const planId = storage.getSessionPlanId();
      const prior = storage.normalizeCustomCourse({
        Major: 'LANG', Code: '100', Course_Name: 'Earlier title',
        ECTS: '4', Engineering: 0, Basic_Science: 0, SU_credit: '2',
        Faculty: '', Faculty_Course: 'No', EL_Type: 'free', Language_Level: 'other',
      });
      storage.setItem('customCourses_MAN', JSON.stringify([prior]), planId);
      const originalCreateSemester = window.createSemeter;
      try {
        window.createSemeter = () => {};
        const data = [prior];
        const imported = window.academicRecordsParser.importParsedCourses([input], data, {
          major: 'MAN', recalcEffectiveTypes() {},
        });
        const stored = JSON.parse(storage.getItem('customCourses_MAN', planId) || '[]')[0];
        return {
          stored,
          runtime: data[0],
          pendingLevel: imported.pendingCustomCourses[0].parsedInfo.Language_Level,
        };
      } finally {
        window.createSemeter = originalCreateSemester;
      }
    }, transcriptCourse());

    expect(result.stored).toMatchObject({
      Course_Name: 'Basic Swedish for International Students',
      SU_credit: '3', ECTS: '6', Language_Level: 'other',
    });
    expect(result.runtime.Language_Level).toBe('other');
    expect(result.pendingLevel).toBe('other');
  });

  test('FENS imports a higher-level LANG course as N/A without inventing a T grade or level', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate((input) => {
      const originalCreateSemester = window.createSemeter;
      const calls = [];
      const data = [];
      try {
        window.createSemeter = (...args) => calls.push({ grades: args[4], bases: args[6] });
        const imported = window.academicRecordsParser.importParsedCourses([input], data, {
          major: 'CS',
          recalcEffectiveTypes() {},
        });
        const planId = window.planStorage.getSessionPlanId();
        const stored = JSON.parse(
          window.planStorage.getItem('customCourses_CS', planId) || '[]',
        ).find((record) => `${record.Major}${record.Code}` === 'LANG240');
        return {
          stats: imported.stats,
          stored,
          pendingLevel: imported.pendingCustomCourses[0].parsedInfo.Language_Level,
          calls,
        };
      } finally {
        window.createSemeter = originalCreateSemester;
      }
    }, transcriptCourse({
      code: 'LANG240',
      title: 'Swedish Conversation and Culture',
      grade: 'A-',
      suCredits: 2.5,
      ects: 5,
    }));

    expect(result.stats.importedCourses).toBe(1);
    expect(result.calls).toEqual([{ grades: ['A-'], bases: ['letter'] }]);
    expect(result.stored).toMatchObject({
      Major: 'LANG', Code: '240', Course_Name: 'Swedish Conversation and Culture',
      SU_credit: '2.5', ECTS: '5', EL_Type: 'unknown',
    });
    expect(result.stored.Language_Level || '').toBe('');
    expect(result.pendingLevel).toBe('');
  });

  test('does not treat a merely LANG-prefixed subject as the exchange LANG subject', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate((input) => {
      const originalCreateSemester = window.createSemeter;
      let createCalls = 0;
      try {
        window.createSemeter = () => { createCalls += 1; };
        const imported = window.academicRecordsParser.importParsedCourses([input], [], {
          major: 'MAN',
          recalcEffectiveTypes() {},
        });
        return {
          stats: imported.stats,
          pendingCount: imported.pendingCustomCourses.length,
          createCalls,
        };
      } finally {
        window.createSemeter = originalCreateSemester;
      }
    }, transcriptCourse({ code: 'LANGUAGE999', title: 'Unrelated subject' }));

    expect(result.createCalls).toBe(0);
    expect(result.pendingCount).toBe(0);
    expect(result.stats.importedCourses).toBe(0);
    expect(result.stats.notFoundCourses).toEqual(['LANGUAGE999']);
  });

  test('rolls back the main LANG definition if the DM definition cannot be stored', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate((input) => {
      const originalStorage = window.planStorage;
      const originalCreateSemester = window.createSemeter;
      const planId = originalStorage.getSessionPlanId();
      originalStorage.removeItem('customCourses_MAN', planId);
      originalStorage.removeItem('customCourses_CS', planId);
      let createCalls = 0;
      window.planStorage = {
        getSessionPlanId: () => planId,
        normalizeCustomCourse: (course) => originalStorage.normalizeCustomCourse(course),
        getItem: (key, id) => originalStorage.getItem(key, id),
        setItem: (key, value, id) => key === 'customCourses_CS'
          ? false : originalStorage.setItem(key, value, id),
        removeItem: (key, id) => originalStorage.removeItem(key, id),
        requestSave: () => true,
      };
      try {
        window.createSemeter = () => { createCalls += 1; };
        const data = [];
        const imported = window.academicRecordsParser.importParsedCourses([input], data, {
          major: 'MAN',
          doubleMajor: 'CS',
          doubleMajorCourseData: [],
          recalcEffectiveTypes() {},
        });
        return {
          stats: imported.stats,
          pendingCount: imported.pendingCustomCourses.length,
          data,
          createCalls,
          mainRaw: originalStorage.getItem('customCourses_MAN', planId),
          dmRaw: originalStorage.getItem('customCourses_CS', planId),
        };
      } finally {
        window.planStorage = originalStorage;
        window.createSemeter = originalCreateSemester;
      }
    }, transcriptCourse());

    expect(result.createCalls).toBe(0);
    expect(result.pendingCount).toBe(0);
    expect(result.data).toEqual([]);
    expect(result.mainRaw).toBeNull();
    expect(result.dmRaw).toBeNull();
    expect(result.stats.importedCourses).toBe(0);
    expect(result.stats.skippedCourses).toEqual([{
      code: 'LANG100', semester: 'Fall 2024-2025', grade: 'B+',
      reason: 'custom-course-storage-failed',
    }]);
  });

  test('rolls back durable and runtime LANG definitions when course creation fails', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate((input) => {
      const storage = window.planStorage;
      const planId = storage.getSessionPlanId();
      storage.removeItem('customCourses_MAN', planId);
      storage.removeItem('customCourses_CS', planId);
      const globalRecord = {
        Major: 'LANG', Code: '100', Course_Name: 'Global index placeholder',
        SU_credit: '1', ECTS: '2', EL_Type: 'unknown',
        __globalCourseDefinition: true,
      };
      const data = [globalRecord];
      const curriculum = {
        major: 'MAN', doubleMajor: 'CS', doubleMajorCourseData: [], semesters: [],
        recalcEffectiveTypes() {},
      };
      const originalCreateSemester = window.createSemeter;
      const originalConsoleError = console.error;
      try {
        // The importer intentionally reports creation exceptions. Suppress the
        // synthetic one so the shared browser-error fixture can judge the
        // rollback assertions instead of treating the test injection itself as
        // an application console failure.
        console.error = () => {};
        window.createSemeter = () => { throw new Error('synthetic creation failure'); };
        const imported = window.academicRecordsParser.importParsedCourses(
          [input], data, curriculum,
        );
        return {
          stats: imported.stats,
          pendingCount: imported.pendingCustomCourses.length,
          mainRaw: storage.getItem('customCourses_MAN', planId),
          dmRaw: storage.getItem('customCourses_CS', planId),
          runtime: data,
          semesters: curriculum.semesters,
        };
      } finally {
        window.createSemeter = originalCreateSemester;
        console.error = originalConsoleError;
      }
    }, transcriptCourse());

    expect(result.stats.importedCourses).toBe(0);
    expect(result.stats.skippedCourses).toEqual([{
      code: 'LANG100', semester: 'Fall 2024-2025', grade: 'B+', reason: 'create-failed',
    }]);
    expect(result.pendingCount).toBe(0);
    expect(result.mainRaw).toBeNull();
    expect(result.dmRaw).toBeNull();
    expect(result.runtime).toEqual([expect.objectContaining({
      Course_Name: 'Global index placeholder', __globalCourseDefinition: true,
    })]);
    expect(result.semesters).toEqual([]);
  });
});
