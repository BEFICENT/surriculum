'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');
const { openScheduler } = require('../helpers/scheduler');

const TARGET_TERM_CODE = '202402';
const TARGET_TERM_NAME = 'Spring 2024-2025';
const OTHER_TERM_NAME = 'Fall 2024-2025';
const CS201_CRN = '20603';
const ACC201R_CRN = '20051';

function schedulerState(selected) {
  return {
    schedulerSelectedTerm: TARGET_TERM_CODE,
    schedulerStates: {
      [TARGET_TERM_CODE]: { selected, blocked: [] },
    },
  };
}

async function confirmPlannerReplacement(page, triggerTwice = false) {
  if (triggerTwice) {
    await page.evaluate(() => {
      const button = document.querySelector('.scheduler-pick-plan');
      button.click();
      button.click();
    });
  } else {
    await page.locator('.scheduler-pick-plan').click();
  }
  const confirmation = page.locator('.modal-overlay').filter({
    has: page.locator('.app-modal-title', { hasText: `Update ${TARGET_TERM_NAME}` }),
  });
  await expect(confirmation).toHaveCount(1);
  await confirmation.getByRole('button', { name: 'Replace' }).click();
  // Resolving the confirmation does not await the scheduler handler. Its
  // button remains disabled until preflight, commit/rollback, and UI refresh
  // have all completed, giving every assertion below a stable boundary.
  await expect(page.locator('.scheduler-pick-plan')).toBeEnabled();
}

async function plannerState(page) {
  return page.evaluate(() => ({
    semesters: window.curriculum.semesters.map((semester) => ({
      termName: semester.termName,
      totals: {
        credit: semester.totalCredit,
        area: semester.totalArea,
        core: semester.totalCore,
        free: semester.totalFree,
        university: semester.totalUniversity,
        required: semester.totalRequired,
        science: semester.totalScience,
        engineering: semester.totalEngineering,
        ects: semester.totalECTS,
        gpa: semester.totalGPA,
        gpaCredits: semester.totalGPACredits,
      },
      courses: semester.courses.map((course) => ({
        code: course.code,
        id: course.id,
        grade: course.grade,
        gradingBasis: course.gradingBasis,
        schedulerCrn: course.scheduler_crn || '',
        marker: course.schedulerSyncMarker || '',
        suCredit: course.SU_credit,
        ects: course.ECTS,
        effectiveType: course.effective_type,
        category: course.category,
      })),
    })),
    dom: Array.from(document.querySelectorAll('.container_semester')).map((container) => ({
      label: container.querySelector('.date p')?.textContent || '',
      total: container.querySelector('.total_credit_text span')?.textContent || '',
      courses: Array.from(container.querySelectorAll('.course')).map((course) => ({
        id: course.id,
        code: course.querySelector('.course_code')?.textContent || '',
        grade: course.querySelector('.grade')?.textContent || '',
        type: course.querySelector('.course_type')?.textContent || '',
      })),
    })),
    stored: {
      curriculum: JSON.parse(window.planStorage.getItem('curriculum')),
      grades: JSON.parse(window.planStorage.getItem('grades')),
      gradingBases: JSON.parse(window.planStorage.getItem('gradingBases')),
      dates: JSON.parse(window.planStorage.getItem('dates')),
    },
  }));
}

test.describe('scheduler to planner transaction (desktop)', () => {
  test('moves a retained course once while preserving grade, basis, id, and metadata', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: OTHER_TERM_NAME,
      curriculum: [['CS201', 'ACC201R'], ['MATH101']],
      grades: [['B+', 'A'], ['C']],
      gradingBases: [['letter', 'letter'], ['letter']],
      dates: [OTHER_TERM_NAME, TARGET_TERM_NAME],
      globalCourseMetadata: [{
        code: 'ACC201R', title: 'Accounting recitation', suCredits: 0, ects: 0,
      }],
      ...schedulerState({
        CS201: { course_id: 'CS201', crn: CS201_CRN },
        ACC201R: { course_id: 'ACC201R', crn: ACC201R_CRN },
      }),
    });
    const before = await page.evaluate(() => {
      const course = window.curriculum.semesters
        .flatMap((semester) => semester.courses)
        .find((candidate) => candidate.code === 'CS201');
      course.schedulerSyncMarker = 'keep-me';
      return {
        id: course.id,
        suCredit: course.SU_credit,
        ects: course.ECTS,
      };
    });

    await openScheduler(page);
    const targetSemesterId = await page.evaluate((targetTermName) => {
      const semester = window.curriculum.semesters
        .find((candidate) => candidate.termName === targetTermName);
      const label = semester && document.getElementById(semester.id)
        ?.closest('.container_semester')?.querySelector('.date p');
      // Model identity must still find this semester while its visible term
      // label is transient (the real term editor replaces the <p> entirely).
      if (label) label.textContent = '...';
      return semester && semester.id;
    }, TARGET_TERM_NAME);
    await confirmPlannerReplacement(page, true);
    await expect(page.locator('.modal-overlay .app-modal-title', { hasText: 'Update failed' }))
      .toHaveCount(0);

    const state = await plannerState(page);
    const other = state.semesters.find((semester) => semester.termName === OTHER_TERM_NAME);
    const target = state.semesters.find((semester) => semester.termName === TARGET_TERM_NAME);
    expect(other.courses.map((course) => course.code)).toEqual(['ACC201R']);
    expect(target.courses).toEqual([expect.objectContaining({
      code: 'CS201',
      id: before.id,
      grade: 'B+',
      gradingBasis: 'letter',
      schedulerCrn: CS201_CRN,
      marker: 'keep-me',
      suCredit: before.suCredit,
      ects: before.ects,
    })]);
    expect(state.stored.curriculum).toEqual([['ACC201R'], ['CS201']]);
    expect(state.stored.grades).toEqual([['A'], ['B+']]);
    expect(state.stored.gradingBases).toEqual([['letter'], ['letter']]);
    expect(state.semesters).toHaveLength(2);
    await expect(page.locator(`#${targetSemesterId} .course .grade`)).toHaveText('B+');
  });

  test('rolls model, DOM, and persisted arrays back when the synchronous commit fails', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: OTHER_TERM_NAME,
      curriculum: [['CS201'], ['MATH101']],
      grades: [['B'], ['A-']],
      gradingBases: [['letter'], ['letter']],
      dates: [OTHER_TERM_NAME, TARGET_TERM_NAME],
      ...schedulerState({
        CS201: { course_id: 'CS201', crn: CS201_CRN },
      }),
    });
    const before = await plannerState(page);
    await openScheduler(page);
    await page.evaluate(() => {
      window.curriculum.recalcEffectiveTypes = () => {
        throw new Error('Injected planner commit failure');
      };
    });

    await confirmPlannerReplacement(page);
    const failure = page.locator('.modal-overlay').filter({
      has: page.locator('.app-modal-title', { hasText: 'Update failed' }),
    });
    await expect(failure).toBeVisible();
    await expect(failure).toContainText('Injected planner commit failure');
    await expect(failure).toContainText('previous planner courses were kept');

    expect(await plannerState(page)).toEqual(before);
    await expect(page.locator(
      `.container_semester:has(.date p:text-is("${OTHER_TERM_NAME}")) .course_code`,
    )).toHaveText('CS201');
    await expect(page.locator(
      `.container_semester:has(.date p:text-is("${TARGET_TERM_NAME}")) .course_code`,
    )).toHaveText('MATH101');
  });

  test('an all-component selection aborts without clearing or moving planner courses', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: OTHER_TERM_NAME,
      curriculum: [['ACC201R'], ['MATH101']],
      grades: [['A'], ['B']],
      gradingBases: [['letter'], ['letter']],
      dates: [OTHER_TERM_NAME, TARGET_TERM_NAME],
      globalCourseMetadata: [{
        code: 'ACC201R', title: 'Accounting recitation', suCredits: 0, ects: 0,
      }],
      ...schedulerState({
        ACC201R: { course_id: 'ACC201R', crn: ACC201R_CRN },
      }),
    });
    const before = await plannerState(page);
    await openScheduler(page);
    await confirmPlannerReplacement(page);

    const failure = page.locator('.modal-overlay').filter({
      has: page.locator('.app-modal-title', { hasText: 'Update failed' }),
    });
    await expect(failure).toContainText('Only lab or recitation sections are selected');
    expect(await plannerState(page)).toEqual(before);
    await expect(page.locator('.scheduler-pick-plan')).toBeEnabled();
  });

  test('a final snapshot failure restores the known-good checkpoint', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: OTHER_TERM_NAME,
      curriculum: [['CS201'], ['MATH101']],
      grades: [['B-'], ['A']],
      gradingBases: [['letter'], ['letter']],
      dates: [OTHER_TERM_NAME, TARGET_TERM_NAME],
      ...schedulerState({
        CS201: { course_id: 'CS201', crn: CS201_CRN },
      }),
    });
    const before = await plannerState(page);
    await openScheduler(page);
    await page.evaluate(() => {
      const storage = window.planStorage;
      const original = storage.setSnapshot;
      let calls = 0;
      window.__restoreSchedulerSnapshotWriter = () => { storage.setSnapshot = original; };
      storage.setSnapshot = (...args) => {
        calls += 1;
        // The pre-commit checkpoint succeeds; the post-mutation save and the
        // best-effort rollback save fail, leaving that checkpoint authoritative.
        if (calls >= 2) return false;
        return original.apply(storage, args);
      };
    });

    await confirmPlannerReplacement(page);
    const failure = page.locator('.modal-overlay').filter({
      has: page.locator('.app-modal-title', { hasText: 'Update failed' }),
    });
    await expect(failure).toContainText('updated planner could not be saved');
    expect(await plannerState(page)).toEqual(before);

    await page.evaluate(() => {
      window.__restoreSchedulerSnapshotWriter();
      window.planStorage.requestSave();
      window.planStorage.flushSaves();
    });
  });
});
