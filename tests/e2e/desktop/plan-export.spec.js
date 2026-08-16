'use strict';

const fs = require('node:fs');
const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');

test.describe('plan export / import round-trip (desktop)', () => {
  test('round-trips reviewed language metadata and an unallocated custom category', async ({ page }) => {
    const languageCourse = {
      Major: 'LANG', Code: '240', Course_Name: 'Swedish Conversation',
      ECTS: '5', Engineering: 0, Basic_Science: 0, SU_credit: '2.5',
      Faculty: '', Faculty_Course: 'No', EL_Type: 'unknown', Language_Level: 'other',
    };
    await seedPlan(page, {
      major: 'CS', entryTerm: 'Fall 2024-2025',
      customCourses: { CS: [languageCourse] },
      curriculum: [], grades: [], dates: [],
    });

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.evaluate(() => window.planStorage.exportPlan()),
    ]);
    const exported = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    expect(exported.plan.state.customCourses.CS).toEqual([
      expect.objectContaining({
        Major: 'LANG', Code: '240', EL_Type: 'unknown', Language_Level: 'other',
      }),
    ]);

    const stored = await page.evaluate((obj) => {
      const id = window.planStorage.importPlanObject(obj);
      return JSON.parse(window.planStorage.getItem('customCourses_CS', id));
    }, exported);
    expect(stored).toEqual(exported.plan.state.customCourses.CS);
  });

  test('rejects malformed imported language classifications atomically', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => {
      const base = {
        Major: 'LANG', Code: '100', Course_Name: 'Swedish', ECTS: '6',
        Engineering: 0, Basic_Science: 0, SU_credit: '3', Faculty: '',
        Faculty_Course: 'No', EL_Type: 'free',
      };
      const levels = ['advanced', 1, { value: 'basic' }];
      const before = window.planStorage.getPlans().length;
      const messages = levels.map((Language_Level) => {
        try {
          window.planStorage.importPlanObject({
            type: 'surriculum_plan', version: 3,
            plan: {
              name: 'Bad language level',
              state: { major: 'MAN', customCourses: { MAN: [{ ...base, Language_Level }] } },
            },
          });
          return null;
        } catch (error) {
          return String(error && error.message ? error.message : error);
        }
      });
      return { before, after: window.planStorage.getPlans().length, messages };
    });
    expect(result.after).toBe(result.before);
    expect(result.messages.every((message) => /Language_Level/.test(message))).toBe(true);
  });

  test('exporting then re-importing a plan preserves courses, credits, GPA and weekend blocks', async ({ page }) => {
    const PLAN = {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [['MATH101', 'MATH102', 'NS101', 'HIST484']],
      grades: [['A', 'B', 'A', 'B']],
      dates: ['Fall 2024-2025'],
      globalCourseMetadata: [{
        code: 'HIST484',
        title: 'Peripheral Populations in the Ottoman Empire (1300-1914)',
        suCredits: 3,
        ects: 6,
      }],
      schedulerSelectedTerm: '202403',
      schedulerStates: {
        202403: {
          selected: {},
          blocked: [
            { id: 'sat', dayKey: 'S', start: 780, end: 840 },
            { id: 'sun', dayKey: 'U', start: 900, end: 960 },
          ],
        },
      },
    };
    await seedPlan(page, PLAN);

    // Trigger the REAL export (a JSON blob download) and read it back.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.evaluate(() => window.planStorage.exportPlan()),
    ]);
    const filePath = await download.path();
    const obj = JSON.parse(fs.readFileSync(filePath, 'utf8'));

    // The export uses the versioned envelope and carries the plan state.
    expect(obj.type).toBe('surriculum_plan');
    expect(obj.version).toBe(4);
    expect(obj.plan.state.major).toBe('CS');
    expect(obj.plan.state.gradingBases).toEqual([['letter', 'letter', 'letter', 'letter']]);
    expect(obj.plan.state.termCodes).toEqual(['202401']);
    expect(obj.plan.state.globalCourseMetadata).toEqual(PLAN.globalCourseMetadata);
    expect(obj.plan.state.schedulerStates['202403'].blocked).toEqual(PLAN.schedulerStates['202403'].blocked);

    // Re-import it as a new active plan and reload while the cumulative index
    // is unavailable. The exported snapshot must be sufficient to preserve the
    // unresolved course, its transcript credits, and its GPA contribution.
    await page.evaluate((o) => window.planStorage.importPlanObject(o, { activate: true }), obj);
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
    await page.waitForFunction(
      () => !!(window.curriculum && Array.isArray(window.curriculum.semesters)
        && window.curriculum.semesters.some((s) => s.courses && s.courses.length)),
      { timeout: 15000 },
    );

    // The round-tripped plan matches the original exactly.
    const m = await page.evaluate(() => {
      const sems = window.curriculum.semesters;
      const sum = (f) => sems.reduce((a, s) => a + (s[f] || 0), 0);
      return {
        major: window.curriculum.major,
        codes: sems.flatMap((s) => s.courses.map((c) => c.code)).sort(),
        gradingBases: sems.flatMap((s) => s.courses.map((c) => c.gradingBasis)),
        totalCredit: sum('totalCredit'),
        gpaCredits: sum('totalGPACredits'),
        gpa: sum('totalGPACredits') ? +(sum('totalGPA') / sum('totalGPACredits')).toFixed(2) : null,
        hist: sems.flatMap((s) => s.courses).find((course) => course.code === 'HIST484'),
        blocked: JSON.parse(window.planStorage.getItem('schedulerState_202403')).blocked,
        globalCourseMetadata: JSON.parse(window.planStorage.getItem('globalCourseMetadata')),
      };
    });
    expect(m.major).toBe('CS');
    expect(m.codes).toEqual(['HIST484', 'MATH101', 'MATH102', 'NS101']);
    expect(m.gradingBases).toEqual(['letter', 'letter', 'letter', 'letter']);
    expect(m.totalCredit).toBe(10);
    expect(m.gpaCredits).toBe(13);
    expect(m.gpa).toBe(3.54);
    expect(m.hist).toMatchObject({
      code: 'HIST484', grade: 'B', gradingBasis: 'letter', SU_credit: 3, ECTS: 6,
      effective_type: 'none',
    });
    expect(m.blocked).toEqual(PLAN.schedulerStates['202403'].blocked);
    expect(m.globalCourseMetadata).toEqual(PLAN.globalCourseMetadata);
  });

  test('version 2 preserves an explicit grading basis for an ambiguous NA', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [['MATH101']],
      grades: [['NA']],
      gradingBases: [['satisfactory']],
      dates: ['Fall 2024-2025'],
    });

    const before = await page.evaluate(() => {
      const course = window.curriculum.semesters[0].courses[0];
      return {
        grade: course.grade,
        basis: course.gradingBasis,
        gpa: window.curriculum.getActualGpa(),
      };
    });
    expect(before.grade).toBe('NA');
    expect(before.basis).toBe('satisfactory');
    expect(before.gpa.resolved).toBe(true);
    expect(before.gpa.credits).toBe(0);
  });

  test('keeps grades and grading bases when an imported plan omits dates', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [['MATH101']],
      grades: [['NA']],
      gradingBases: [['satisfactory']],
    });

    const loaded = await page.evaluate(() => {
      const course = window.curriculum.semesters[0].courses[0];
      return { grade: course.grade, gradingBasis: course.gradingBasis };
    });
    expect(loaded).toEqual({ grade: 'NA', gradingBasis: 'satisfactory' });
  });

  test('version 1 imports synthesize grading bases from decisive grades', async ({ page }) => {
    await page.goto('/');
    const state = await page.evaluate(() => {
      const id = window.planStorage.importPlanObject({
        type: 'surriculum_plan',
        version: 1,
        plan: {
          name: 'Legacy grades',
          state: {
            major: 'CS',
            curriculum: [['MATH101', 'MATH102', 'MATH201']],
            grades: [['A', 'S', 'NA']],
          },
        },
      });
      return JSON.parse(window.planStorage.getItem('gradingBases', id));
    });
    expect(state).toEqual([['letter', 'satisfactory', 'unknown']]);
  });

  test('version 2 rejects a grading-basis array that is not aligned to courses', async ({ page }) => {
    await page.goto('/');
    const message = await page.evaluate(() => {
      try {
        window.planStorage.importPlanObject({
          type: 'surriculum_plan',
          version: 2,
          plan: {
            name: 'Malformed bases',
            state: {
              curriculum: [['MATH101', 'MATH102']],
              grades: [['A', 'B']],
              gradingBases: [['letter']],
            },
          },
        });
        return null;
      } catch (error) {
        return String(error && error.message ? error.message : error);
      }
    });
    expect(message).toContain('must have one grading basis per course');
  });

  test('decisive grades canonicalize conflicting imported basis metadata', async ({ page }) => {
    await page.goto('/');
    const bases = await page.evaluate(() => {
      const id = window.planStorage.importPlanObject({
        type: 'surriculum_plan',
        version: 2,
        plan: {
          name: 'Conflicting bases',
          state: {
            curriculum: [['MATH101', 'MATH102', 'MATH201']],
            grades: [['A', 'S', 'NA']],
            gradingBases: [['satisfactory', 'letter', 'letter']],
          },
        },
      });
      return JSON.parse(window.planStorage.getItem('gradingBases', id));
    });
    expect(bases).toEqual([['letter', 'satisfactory', 'letter']]);
  });

  test('export repairs stale stored grading-basis dimensions', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [['MATH101', 'MATH102']],
      grades: [['A', 'S']],
      dates: ['Fall 2024-2025'],
    });
    const staleId = await page.evaluate(() => {
      const id = window.planStorage.duplicatePlan(window.planStorage.getActivePlanId(), 'Stale copy');
      window.planStorage.setItem('gradingBases', JSON.stringify([['letter']]), id);
      return id;
    });

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.evaluate((id) => window.planStorage.exportPlan(id), staleId),
    ]);
    const exported = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    expect(exported.plan.state.gradingBases).toEqual([['letter', 'satisfactory']]);
    const importedId = await page.evaluate((obj) => window.planStorage.importPlanObject(obj), exported);
    expect(importedId).toBeTruthy();
  });

  test('version 3 rejects malformed global metadata atomically', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => {
      const valid = {
        code: 'HIST484', title: 'Peripheral Populations', suCredits: 3, ects: 6,
      };
      const cases = [
        { label: 'unknown field', version: 3, rows: [{ ...valid, unexpected: true }] },
        { label: 'duplicate code', version: 3, rows: [valid, { ...valid, code: ' hist 484 ' }] },
        { label: 'invalid code', version: 3, rows: [{ ...valid, code: '../HIST484' }] },
        { label: 'missing title', version: 3, rows: [{ code: 'HIST484', suCredits: 3, ects: 6 }] },
        { label: 'missing SU credits', version: 3, rows: [{ code: 'HIST484', title: 'History', ects: 6 }] },
        { label: 'missing ECTS', version: 3, rows: [{ code: 'HIST484', title: 'History', suCredits: 3 }] },
        { label: 'negative credits', version: 3, rows: [{ ...valid, suCredits: -1 }] },
        { label: 'oversized credits', version: 3, rows: [{ ...valid, ects: 101 }] },
        {
          label: 'too many rows', version: 3,
          rows: Array.from({ length: 2001 }, (_, i) => ({
            code: `ZZ${i + 1}`, title: `Course ${i + 1}`, suCredits: 3, ects: 6,
          })),
        },
        { label: 'v2 future field', version: 2, rows: [valid] },
        { label: 'v1 future field', version: 1, rows: [valid] },
      ];
      const before = window.planStorage.getPlans().length;
      const messages = cases.map((entry) => {
        try {
          window.planStorage.importPlanObject({
            type: 'surriculum_plan',
            version: entry.version,
            plan: { name: entry.label, state: { globalCourseMetadata: entry.rows } },
          });
          return null;
        } catch (error) {
          return String(error && error.message ? error.message : error);
        }
      });
      return { before, after: window.planStorage.getPlans().length, messages };
    });

    expect(result.after).toBe(result.before);
    expect(result.messages.every(Boolean)).toBe(true);
    expect(result.messages[0]).toContain('unknown field');
    expect(result.messages[1]).toContain('duplicate course code');
    expect(result.messages[2]).toContain('invalid course code');
    expect(result.messages[3]).toContain('.title: is required');
    expect(result.messages[4]).toContain('.suCredits: is required');
    expect(result.messages[5]).toContain('.ects: is required');
    expect(result.messages[6]).toContain('between 0 and 100');
    expect(result.messages[7]).toContain('between 0 and 100');
    expect(result.messages[8]).toContain('at most 2000 courses');
    expect(result.messages[9]).toContain('unknown field');
    expect(result.messages[10]).toContain('unknown field');
  });

  test('stored metadata reads and exports salvage valid rows', async ({ page }) => {
    await page.goto('/');
    const validRows = [
      { code: 'HIST484', title: 'History', suCredits: 3, ects: 6 },
      { code: 'SOC301', title: 'Sociology', suCredits: 2.5, ects: 5 },
    ];
    const stored = await page.evaluate((rows) => {
      const id = window.planStorage.getActivePlanId();
      localStorage.setItem(`surriculum.plan.${id}.globalCourseMetadata`, JSON.stringify([
        rows[0],
        { code: 'BROKEN999', title: 'Broken', suCredits: -1, ects: 6 },
        { ...rows[0], code: ' hist 484 ' },
        rows[1],
      ]));
      return JSON.parse(window.planStorage.getItem('globalCourseMetadata'));
    }, validRows);
    expect(stored).toEqual(validRows);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.evaluate(() => window.planStorage.exportPlan()),
    ]);
    const exported = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    expect(exported.plan.state.globalCourseMetadata).toEqual(validRows);
  });
});
