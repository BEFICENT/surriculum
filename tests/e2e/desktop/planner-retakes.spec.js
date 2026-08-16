'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');

const FALL = 'Fall 2024-2025';
const SPRING = 'Spring 2024-2025';

async function plannerRetakeState(page) {
  return page.evaluate(() => ({
    courseId: window.curriculum.course_id,
    semesters: window.curriculum.semesters.map((semester) => ({
      termName: semester.termName,
      courses: semester.courses.map((course) => ({
        code: course.code,
        id: course.id,
        grade: course.grade,
        gradingBasis: course.gradingBasis,
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

async function attemptDuplicateAdd(page, semesterIndex, code) {
  const semester = page.locator('.container_semester').nth(semesterIndex);
  await semester.locator('.addCourse').click();
  await semester.locator('.course_select').fill(code);
  await semester.locator('.enter').click();
}

test.describe('planner retakes (desktop)', () => {
  test('confirming an F-grade retake replaces the earlier entry with a fresh ungraded attempt', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: FALL,
      curriculum: [['MATH101'], ['MATH102']],
      grades: [['F'], ['']],
      gradingBases: [['letter'], ['unknown']],
      dates: [FALL, SPRING],
    });
    const before = await plannerRetakeState(page);
    const oldId = before.semesters[0].courses[0].id;

    await attemptDuplicateAdd(page, 1, 'MATH101');
    const dialog = page.getByRole('dialog', { name: 'Plan this course as a retake?' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(FALL);
    await expect(dialog).toContainText(SPRING);
    await expect(dialog).toContainText(/grade F/i);
    await expect(dialog).toContainText(/temporarily removes.*credit.*GPA.*prerequisite effect/i);
    await expect(dialog).toContainText(/transcript retains both registrations/i);
    await dialog.getByRole('button', { name: 'Replace earlier entry' }).click();

    await expect(page.locator('.course:has(.course_code:text-is("MATH101"))')).toHaveCount(1);
    await expect(page.locator('.container_semester').nth(0).locator('.course')).toHaveCount(0);
    await expect(page.locator('.container_semester').nth(1)
      .locator('.course:has(.course_code:text-is("MATH101")) .grade')).toHaveText('Add grade');

    const after = await plannerRetakeState(page);
    expect(after.semesters.map((semester) => semester.courses.map((course) => course.code)))
      .toEqual([[], ['MATH102', 'MATH101']]);
    const replacement = after.semesters[1].courses[1];
    expect(replacement).toEqual(expect.objectContaining({
      code: 'MATH101',
      grade: '',
      gradingBasis: 'unknown',
    }));
    expect(replacement.id).not.toBe(oldId);
    expect(after.stored.curriculum).toEqual([[], ['MATH102', 'MATH101']]);
    expect(after.stored.grades).toEqual([[], ['', '']]);
    expect(after.stored.gradingBases).toEqual([[], ['unknown', 'unknown']]);
  });

  test('cancelling an eligible retake preserves the earlier attempt and saved plan', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: FALL,
      curriculum: [['MATH101'], ['MATH102']],
      grades: [['A'], ['']],
      gradingBases: [['letter'], ['unknown']],
      dates: [FALL, SPRING],
    });
    const before = await plannerRetakeState(page);

    await attemptDuplicateAdd(page, 1, 'MATH101');
    const dialog = page.getByRole('dialog', { name: 'Plan this course as a retake?' });
    await expect(dialog).toContainText(/temporarily removes.*credit.*GPA.*prerequisite effect/i);
    await dialog.getByRole('button', { name: 'Cancel' }).click();

    await expect(dialog).toBeHidden();
    expect(await plannerRetakeState(page)).toEqual(before);
    await expect(page.locator('.container_semester').nth(1).locator('.course_select'))
      .toHaveValue('MATH101');
  });

  test('a failed final retake save cannot overwrite the durable checkpoint while the alert is open', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: FALL,
      curriculum: [['MATH101'], ['MATH102']],
      grades: [['F'], ['']],
      gradingBases: [['letter'], ['unknown']],
      dates: [FALL, SPRING],
    });
    const before = await plannerRetakeState(page);
    await page.evaluate(() => {
      const storage = window.planStorage;
      storage.flushSaves();
      const original = storage.setSnapshot;
      let calls = 0;
      storage.setSnapshot = (...args) => {
        calls += 1;
        window.__retakeSnapshotCalls = calls;
        if (calls === 2) return false;
        return original.apply(storage, args);
      };
    });

    await attemptDuplicateAdd(page, 1, 'MATH101');
    const confirmation = page.getByRole('dialog', { name: 'Plan this course as a retake?' });
    await confirmation.getByRole('button', { name: 'Replace earlier entry' }).click();

    const failure = page.getByRole('dialog', { name: 'Retake not added' });
    await expect(failure).toContainText(/earlier course will be restored/i);
    await page.waitForTimeout(2200);

    const whileOpen = await plannerRetakeState(page);
    expect(whileOpen.stored).toEqual(before.stored);
    expect(await page.evaluate(() => window.__retakeSnapshotCalls)).toBe(2);

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      failure.getByRole('button', { name: 'OK' }).click(),
    ]);
    await page.waitForFunction(() => window.curriculum
      && window.curriculum.semesters.length === 2
      && window.curriculum.semesters[0].courses.some((course) => course.code === 'MATH101'));

    const restored = await plannerRetakeState(page);
    expect(restored.stored).toEqual(before.stored);
    expect(restored.semesters.map((semester) => semester.courses.map((course) => ({
      code: course.code,
      grade: course.grade,
      gradingBasis: course.gradingBasis,
    })))).toEqual([
      [{ code: 'MATH101', grade: 'F', gradingBasis: 'letter' }],
      [{ code: 'MATH102', grade: '', gradingBasis: 'unknown' }],
    ]);
  });

  test('an unfinished earlier attempt is not offered as a retake', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: FALL,
      curriculum: [['MATH101'], []],
      grades: [[''], []],
      gradingBases: [['unknown'], []],
      dates: [FALL, SPRING],
    });
    const before = await plannerRetakeState(page);

    await attemptDuplicateAdd(page, 1, 'MATH101');
    const alert = page.getByRole('dialog', { name: 'Already added' });
    await expect(alert).toContainText(/does not yet have a final grade/i);
    await expect(page.getByRole('dialog', { name: 'Plan this course as a retake?' })).toHaveCount(0);
    expect(await plannerRetakeState(page)).toEqual(before);
  });
});
