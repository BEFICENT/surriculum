'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');
const { openScheduler } = require('../helpers/scheduler');

const TARGET_TERM_CODE = '202402';
const TARGET_TERM_NAME = 'Spring 2024-2025';
const OTHER_TERM_NAME = 'Fall 2024-2025';
const GRADUATE_CODE = 'CS515';
const GRADUATE_TITLE = 'Deep Learning';
const GRADUATE_CRN = '20265';
const STALE_GRADUATE_TITLE = 'Stale graduate-course placeholder';

const graduateSchedulerState = () => ({
  schedulerSelectedTerm: TARGET_TERM_CODE,
  schedulerStates: {
    [TARGET_TERM_CODE]: {
      selected: {
        [GRADUATE_CODE]: { course_id: GRADUATE_CODE, crn: GRADUATE_CRN },
      },
      blocked: [],
    },
  },
});

async function seedGraduateSyncPlan(page) {
  await seedPlan(page, {
    major: 'CS',
    entryTerm: OTHER_TERM_NAME,
    curriculum: [['MATH101'], ['CS201']],
    grades: [['A'], ['']],
    gradingBases: [['letter'], ['unknown']],
    dates: [OTHER_TERM_NAME, TARGET_TERM_NAME],
    termCodes: ['202401', TARGET_TERM_CODE],
    ...graduateSchedulerState(),
  });
}

async function seedStaleGraduateSyncPlan(page) {
  await seedPlan(page, {
    major: 'CS',
    entryTerm: OTHER_TERM_NAME,
    curriculum: [['MATH101'], [GRADUATE_CODE]],
    grades: [['A'], ['']],
    gradingBases: [['letter'], ['unknown']],
    dates: [OTHER_TERM_NAME, TARGET_TERM_NAME],
    termCodes: ['202401', TARGET_TERM_CODE],
    globalCourseMetadata: [{
      code: GRADUATE_CODE,
      title: STALE_GRADUATE_TITLE,
      suCredits: 0,
      ects: 6,
    }],
    ...graduateSchedulerState(),
  });
}

async function syncSchedulerSelection(page) {
  await openScheduler(page);
  await expect(page.locator(`.scheduler-selected-item[data-course="${GRADUATE_CODE}"]`))
    .toBeVisible();
  await page.locator('.scheduler-pick-plan').click();
  const confirmation = page.getByRole('dialog', { name: `Update ${TARGET_TERM_NAME}` });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole('button', { name: 'Replace' }).click();
  await expect(page.locator('.scheduler-pick-plan')).toBeEnabled();
}

async function readGraduatePlannerState(page) {
  return page.evaluate(({ code, targetTerm }) => {
    const storage = window.planStorage;
    const planId = storage.getSessionPlanId();
    const target = (window.curriculum.semesters || [])
      .find((semester) => semester.termName === targetTerm);
    const course = target && (target.courses || []).find((row) => row.code === code);
    const courseNode = course && document.getElementById(course.id);
    const catalogRows = Array.isArray(course_data)
      ? course_data.filter((row) => `${row.Major || ''}${row.Code || ''}` === code)
      : [];
    return {
      semesterCount: (window.curriculum.semesters || []).length,
      renderedSemesterCount: document.querySelectorAll('.container_semester').length,
      course: course ? {
        code: course.code,
        suCredits: Number(course.SU_credit),
        ects: Number(course.ECTS),
        effectiveType: course.effective_type,
      } : null,
      card: courseNode ? {
        title: courseNode.querySelector('.course_name')?.textContent.trim() || '',
        credits: courseNode.querySelector('.course_credit')?.textContent.trim() || '',
        type: courseNode.querySelector('.course_type')?.textContent.trim() || '',
      } : null,
      metadata: JSON.parse(storage.getItem('globalCourseMetadata', planId) || '[]'),
      customCoursesRaw: storage.getItem('customCourses_CS', planId),
      catalogRows: catalogRows.map((row) => ({
        code: `${row.Major || ''}${row.Code || ''}`,
        title: row.Course_Name,
        suCredits: Number(row.SU_credit),
        ects: Number(row.ECTS),
        type: row.EL_Type,
        internalGlobal: Boolean(row.__globalCourseDefinition),
      })),
      storedCurriculum: JSON.parse(storage.getItem('curriculum', planId) || 'null'),
    };
  }, { code: GRADUATE_CODE, targetTerm: TARGET_TERM_NAME });
}

async function readStaleAtomicState(page) {
  return page.evaluate(({ code, targetTerm }) => {
    const storage = window.planStorage;
    const planId = storage.getSessionPlanId();
    const semester = (window.curriculum.semesters || [])
      .find((row) => row.termName === targetTerm);
    const course = semester && (semester.courses || []).find((row) => row.code === code);
    const card = course && document.getElementById(course.id);
    const runtime = Array.isArray(course_data)
      ? course_data.find((row) => `${row.Major || ''}${row.Code || ''}` === code)
      : null;
    return {
      courseJson: JSON.stringify(course || null),
      cardOuterHtml: card ? card.outerHTML : null,
      runtimeDefinitionJson: JSON.stringify(runtime || null),
      globalMetadataRaw: storage.getItem('globalCourseMetadata', planId),
      customCoursesRaw: storage.getItem('customCourses_CS', planId),
      curriculumRaw: storage.getItem('curriculum', planId),
    };
  }, { code: GRADUATE_CODE, targetTerm: TARGET_TERM_NAME });
}

test.describe('graduate scheduler courses in the planner (desktop)', () => {
  test('sync persists a real graduate course as internal metadata without creating a custom course', async ({ page }) => {
    await seedGraduateSyncPlan(page);
    await syncSchedulerSelection(page);

    const state = await readGraduatePlannerState(page);
    expect(state.metadata).toEqual([{
      code: GRADUATE_CODE,
      title: GRADUATE_TITLE,
      suCredits: 3,
      ects: 0,
    }]);
    expect(state.customCoursesRaw).toBeNull();
    expect(state.storedCurriculum).toEqual([['MATH101'], [GRADUATE_CODE]]);
    expect(state.course).toEqual({
      code: GRADUATE_CODE,
      suCredits: 3,
      ects: 0,
      effectiveType: 'none',
    });
    expect(state.card).toMatchObject({
      title: GRADUATE_TITLE,
      type: 'N/A',
    });
    expect(state.card.credits).toMatch(/^3(?:\.0)? credits$/);
  });

  test('repeat sync refreshes a stale internal definition while preserving known ECTS', async ({ page }) => {
    await seedStaleGraduateSyncPlan(page);

    const stale = await readGraduatePlannerState(page);
    expect(stale.course).toMatchObject({
      code: GRADUATE_CODE,
      suCredits: 0,
      ects: 6,
      effectiveType: 'none',
    });
    expect(stale.card).toMatchObject({
      title: STALE_GRADUATE_TITLE,
      type: 'N/A',
    });

    await syncSchedulerSelection(page);

    const refreshed = await readGraduatePlannerState(page);
    expect(refreshed.metadata).toEqual([{
      code: GRADUATE_CODE,
      title: GRADUATE_TITLE,
      suCredits: 3,
      ects: 6,
    }]);
    expect(refreshed.customCoursesRaw).toBeNull();
    expect(refreshed.course).toEqual({
      code: GRADUATE_CODE,
      suCredits: 3,
      ects: 6,
      effectiveType: 'none',
    });
    expect(refreshed.card).toMatchObject({
      title: GRADUATE_TITLE,
      type: 'N/A',
    });
    expect(refreshed.card.credits).toMatch(/^3(?:\.0)? credits$/);
    expect(refreshed.catalogRows).toEqual([{
      code: GRADUATE_CODE,
      title: GRADUATE_TITLE,
      suCredits: 3,
      ects: 6,
      type: 'unknown',
      internalGlobal: true,
    }]);
  });

  test('pre-commit save failure cannot mutate a reused stale internal course', async ({ page }) => {
    await seedStaleGraduateSyncPlan(page);
    await openScheduler(page);
    await expect(page.locator(`.scheduler-selected-item[data-course="${GRADUATE_CODE}"]`))
      .toBeVisible();

    const before = await readStaleAtomicState(page);
    await page.evaluate(() => {
      const storage = window.planStorage;
      const original = storage.requestSave;
      window.__restoreGraduateRequestSave = () => { storage.requestSave = original; };
      // This is the checkpoint immediately after asynchronous preparation and
      // before commitPlannerReplacement. Preparation must therefore be pure.
      storage.requestSave = () => false;
    });

    await page.locator('.scheduler-pick-plan').click();
    const confirmation = page.getByRole('dialog', { name: `Update ${TARGET_TERM_NAME}` });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole('button', { name: 'Replace' }).click();
    await expect(page.locator('.scheduler-pick-plan')).toBeEnabled();

    const failure = page.getByRole('dialog', { name: 'Update failed' });
    await expect(failure).toBeVisible();
    await expect(failure).toContainText('current planner changes could not be saved');

    const after = await readStaleAtomicState(page);
    expect(after).toEqual(before);
    await expect(page.locator(
      `.container_semester:has(.date p:text-is("${TARGET_TERM_NAME}")) .course_name`,
    )).toHaveText(STALE_GRADUATE_TITLE);
    await expect(page.locator(
      `.container_semester:has(.date p:text-is("${TARGET_TERM_NAME}")) .course_credit`,
    )).toHaveText(/^0(?:\.0)? credits$/);

    await page.evaluate(() => window.__restoreGraduateRequestSave());
  });

  test('reload renders semesters before a stalled global index and preserves graduate metadata', async ({ page }) => {
    await seedGraduateSyncPlan(page);
    await syncSchedulerSelection(page);

    // Keep the cumulative course-page request unresolved. A schedule-sourced
    // definition is already stored with the plan, so restoring the planner must
    // not hold every semester hostage to this optional enrichment request.
    await page.addInitScript(() => {
      const nativeFetch = window.fetch.bind(window);
      window.__graduateIndexRequested = false;
      window.__graduateIndexReleased = false;
      window.__releaseGraduateIndex = () => {};
      window.fetch = (resource, options) => {
        const url = typeof resource === 'string'
          ? resource : String(resource && resource.url || '');
        if (!url.includes('all_coursepage_info.jsonl')) {
          return nativeFetch(resource, options);
        }
        window.__graduateIndexRequested = true;
        return new Promise((resolve, reject) => {
          window.__releaseGraduateIndex = () => {
            window.__graduateIndexReleased = true;
            reject(new TypeError('Synthetic stalled global-index request'));
          };
        });
      };
    });

    await page.reload({ waitUntil: 'domcontentloaded' });
    try {
      await expect(page.locator('.container_semester')).toHaveCount(2, { timeout: 2000 });
      await page.waitForFunction(() => window.__graduateIndexRequested === true, null, {
        timeout: 1000,
      });
      expect(await page.evaluate(() => window.__graduateIndexReleased)).toBe(false);

      const state = await readGraduatePlannerState(page);
      expect(state).toMatchObject({
        semesterCount: 2,
        renderedSemesterCount: 2,
        course: {
          code: GRADUATE_CODE,
          suCredits: 3,
          ects: 0,
          effectiveType: 'none',
        },
        card: {
          title: GRADUATE_TITLE,
          type: 'N/A',
        },
        metadata: [{
          code: GRADUATE_CODE,
          title: GRADUATE_TITLE,
          suCredits: 3,
          ects: 0,
        }],
        customCoursesRaw: null,
      });
      expect(state.card.credits).toMatch(/^3(?:\.0)? credits$/);
    } finally {
      await page.evaluate(() => {
        if (typeof window.__releaseGraduateIndex === 'function') {
          window.__releaseGraduateIndex();
        }
      }).catch(() => {});
    }

    // Rejection is the failed-index half of the contract. The already-rendered
    // stored definition must remain intact after background enrichment gives up.
    await page.waitForFunction(() => window.__graduateIndexReleased === true);
    await expect(page.locator('.container_semester')).toHaveCount(2);
    const afterFailure = await readGraduatePlannerState(page);
    expect(afterFailure.course).toMatchObject({
      code: GRADUATE_CODE,
      suCredits: 3,
      effectiveType: 'none',
    });
    expect(afterFailure.card).toMatchObject({ title: GRADUATE_TITLE, type: 'N/A' });
  });

  test('a failed final save rolls graduate metadata and its runtime definition back', async ({ page }) => {
    await seedGraduateSyncPlan(page);
    await openScheduler(page);
    await expect(page.locator(`.scheduler-selected-item[data-course="${GRADUATE_CODE}"]`))
      .toBeVisible();

    const before = await readGraduatePlannerState(page);
    await page.evaluate(() => {
      const storage = window.planStorage;
      const original = storage.setSnapshot;
      let calls = 0;
      window.__restoreGraduateSnapshotWriter = () => { storage.setSnapshot = original; };
      storage.setSnapshot = (...args) => {
        calls += 1;
        // The pre-commit checkpoint succeeds. The final planner snapshot and
        // best-effort rollback snapshot fail, exercising in-memory + auxiliary
        // metadata rollback rather than a successful persistence round-trip.
        if (calls >= 2) return false;
        return original.apply(storage, args);
      };
    });

    await page.locator('.scheduler-pick-plan').click();
    const confirmation = page.getByRole('dialog', { name: `Update ${TARGET_TERM_NAME}` });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole('button', { name: 'Replace' }).click();
    await expect(page.locator('.scheduler-pick-plan')).toBeEnabled();

    const failure = page.getByRole('dialog', { name: 'Update failed' });
    await expect(failure).toBeVisible();
    await expect(failure).toContainText('updated planner could not be saved');

    const after = await readGraduatePlannerState(page);
    expect(after.metadata).toEqual(before.metadata);
    expect(after.customCoursesRaw).toBe(before.customCoursesRaw);
    expect(after.storedCurriculum).toEqual(before.storedCurriculum);
    expect(after.course).toEqual(before.course);
    expect(after.card).toEqual(before.card);
    expect(after.catalogRows).toEqual(before.catalogRows);
    await expect(page.locator(`.container_semester .course_code`, { hasText: GRADUATE_CODE }))
      .toHaveCount(0);

    await page.evaluate(() => {
      window.__restoreGraduateSnapshotWriter();
      window.planStorage.requestSave();
      window.planStorage.flushSaves();
    });
  });
});
