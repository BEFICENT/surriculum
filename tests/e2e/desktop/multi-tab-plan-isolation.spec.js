'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');
const { openScheduler } = require('../helpers/scheduler');

const TERM = '202503';
const TERM_NAME = 'Fall 2024-2025';

test('a tab stays bound to its rendered plan after another tab switches the shared active plan', async ({ page, context }) => {
  await seedPlan(page, {
    major: 'CS',
    entryTerm: TERM_NAME,
    curriculum: [['CS201']],
    grades: [['A']],
    dates: [TERM_NAME],
    globalCourseMetadata: [{ code: 'AOLD999', title: 'Existing A metadata', suCredits: 1, ects: 2 }],
    schedulerSelectedTerm: TERM,
    schedulerStates: {
      [TERM]: {
        selected: { CS201: { course_id: 'CS201', crn: '30206' } },
        blocked: [],
      },
    },
  });

  const ids = await page.evaluate(({ term }) => {
    const storage = window.planStorage;
    const a = storage.getSessionPlanId();
    const b = storage.importPlanObject({
      type: 'surriculum_plan',
      version: 3,
      plan: {
        name: 'Plan B',
        state: {
          major: 'CS',
          entryTerm: 'Spring 2024-2025',
          curriculum: [['MATH101']],
          grades: [['B']],
          gradingBases: [['letter']],
          dates: ['Spring 2024-2025'],
          globalCourseMetadata: [{ code: 'BONLY999', title: 'Plan B metadata', suCredits: 4, ects: 8 }],
          schedulerSelectedTerm: term,
          schedulerStates: {
            [term]: {
              selected: { MATH101: { course_id: 'MATH101', crn: '99999' } },
              blocked: [],
            },
          },
        },
      },
    }, { activate: false });
    return { a, b };
  }, { term: TERM });

  const pageB = await context.newPage();
  try {
    await pageB.goto('/');
    await pageB.waitForFunction(() => !!(window.planStorage && window.planStorage.getSessionPlanId));
    await pageB.evaluate((planB) => window.planStorage.setActivePlanId(planB), ids.b);
    await pageB.reload();
    await pageB.waitForFunction(
      (planB) => window.planStorage && window.planStorage.getSessionPlanId() === planB,
      ids.b,
    );

    const identities = await page.evaluate(() => ({
      session: window.planStorage.getSessionPlanId(),
      sharedActive: window.planStorage.getActivePlanId(),
    }));
    expect(identities).toEqual({ session: ids.a, sharedActive: ids.b });

    // Force the plan menu to render again after the cross-tab switch. Its
    // header and active row describe this tab's rendered plan, not activeId.
    await page.locator('#planToggle').click();
    const rowA = page.locator(`.plan-item[data-id="${ids.a}"]`);
    await rowA.locator('button[title="Rename"]').click();
    const renameModal = page.locator('.modal-overlay').last();
    await renameModal.locator('input').fill('Plan A renamed');
    await renameModal.getByRole('button', { name: 'Rename' }).click();
    await expect(page.locator('#activePlanName')).toHaveText('Plan A renamed');
    await expect(page.locator(`.plan-item[data-id="${ids.a}"]`)).toHaveClass(/\bactive\b/);
    await expect(page.locator(`.plan-item[data-id="${ids.b}"]`)).not.toHaveClass(/\bactive\b/);

    // The asynchronous New Plan flow must copy from A even though the shared
    // activeId now points at B.
    const copiedFrom = await page.evaluate(async () => {
      const storage = window.planStorage;
      const originalDuplicate = storage.duplicatePlan;
      const originalPrompt = window.uiModal.prompt;
      const originalConfirm = window.uiModal.confirm;
      let source = null;
      storage.duplicatePlan = (id) => { source = id; return null; };
      window.uiModal.prompt = () => Promise.resolve('Copy probe');
      window.uiModal.confirm = () => Promise.resolve(true);
      try {
        document.getElementById('addPlanBtn').click();
        for (let i = 0; i < 20 && !source; i++) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        return source;
      } finally {
        storage.duplicatePlan = originalDuplicate;
        window.uiModal.prompt = originalPrompt;
        window.uiModal.confirm = originalConfirm;
      }
    });
    expect(copiedFrom).toBe(ids.a);

    // helper_functions.js must read A's planner arrays and write A's metadata.
    const reloaded = await page.evaluate(() => {
      const calls = [];
      const original = window.createSemeter;
      window.createSemeter = (...args) => calls.push({
        courses: args[1], grades: args[4], date: args[5], gradingBases: args[6],
      });
      try {
        window.reload({ semesters: [] }, []);
      } finally {
        window.createSemeter = original;
      }
      window.rememberGlobalCourseDefinition({
        code: 'AONLY999', title: 'Added from tab A', suCredits: 3, ects: 6,
      });
      return calls;
    });
    expect(reloaded).toEqual([{
      courses: ['CS201'], grades: ['A'], date: TERM_NAME, gradingBases: ['letter'],
    }]);

    // Exercise s_curriculum's custom-course fallback and verify the plan ID it
    // supplies even after activeId changed in the other tab.
    const customReadPlanIds = await page.evaluate(() => {
      const storage = window.planStorage;
      const original = storage.getItem;
      const seen = [];
      storage.getItem = function(key, planId) {
        if (String(key).startsWith('customCourses_')) seen.push(planId);
        return original.call(this, key, planId);
      };
      try {
        window.curriculum.recalcEffectiveTypes([]);
      } finally {
        storage.getItem = original;
      }
      return seen;
    });
    expect(customReadPlanIds.length).toBeGreaterThan(0);
    expect(customReadPlanIds.every((id) => id === ids.a)).toBe(true);

    const modal = await openScheduler(page);
    await expect(modal.locator('.scheduler-selected')).toContainText('CS201');
    await modal.locator('.scheduler-clear').click();

    // Scheduler preferences intentionally remain global across plans/tabs.
    const hoverToggle = modal.locator('.scheduler-toggle-hover-preview');
    const expectedGlobalPreference = await hoverToggle.evaluate((element) => {
      element.checked = !element.checked;
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return String(element.checked);
    });
    await expect.poll(() => pageB.evaluate(
      () => localStorage.getItem('schedulerHoverPreview'),
    )).toBe(expectedGlobalPreference);

    const stored = await page.evaluate(({ a, b, term }) => {
      const storage = window.planStorage;
      return {
        aMetadata: JSON.parse(storage.getItem('globalCourseMetadata', a) || '[]'),
        bMetadata: JSON.parse(storage.getItem('globalCourseMetadata', b) || '[]'),
        aScheduler: JSON.parse(storage.getItem(`schedulerState_${term}`, a) || '{}'),
        bScheduler: JSON.parse(storage.getItem(`schedulerState_${term}`, b) || '{}'),
        legacyMetadata: localStorage.getItem('globalCourseMetadata'),
        legacyScheduler: localStorage.getItem(`schedulerState_${term}`),
      };
    }, { ...ids, term: TERM });

    expect(stored.aMetadata.map((row) => row.code)).toEqual(['AOLD999', 'AONLY999']);
    expect(stored.bMetadata.map((row) => row.code)).toEqual(['BONLY999']);
    expect(stored.aScheduler.selected).toEqual({});
    expect(stored.bScheduler.selected).toEqual({
      MATH101: { course_id: 'MATH101', crn: '99999' },
    });
    expect(stored.legacyMetadata).toBeNull();
    expect(stored.legacyScheduler).toBeNull();

    // If B deletes A while A is still open, stale helpers must fail closed:
    // no write may land in B, a raw legacy key, or a recreated A namespace.
    const beforeDeletionWrite = await pageB.evaluate(({ b, term }) => ({
      metadata: window.planStorage.getItem('globalCourseMetadata', b),
      scheduler: window.planStorage.getItem(`schedulerState_${term}`, b),
    }), { b: ids.b, term: TERM });
    const deletion = await pageB.evaluate((a) => window.planStorage.deletePlan(a), ids.a);
    expect(deletion.ok).toBe(true);

    await page.evaluate(() => {
      window.rememberGlobalCourseDefinition({
        code: 'STALE999', title: 'Must not be saved', suCredits: 9, ects: 9,
      });
      document.querySelector('.scheduler-clear').click();
      window.planStorage.requestSave();
      window.planStorage.flushSaves();
    });

    const afterDeletionWrite = await pageB.evaluate(({ a, b, term }) => ({
      metadata: window.planStorage.getItem('globalCourseMetadata', b),
      scheduler: window.planStorage.getItem(`schedulerState_${term}`, b),
      legacyMetadata: localStorage.getItem('globalCourseMetadata'),
      legacyScheduler: localStorage.getItem(`schedulerState_${term}`),
      orphanAKeys: Object.keys(localStorage).filter((key) => key.startsWith(`surriculum.plan.${a}.`)),
    }), { ...ids, term: TERM });
    expect(afterDeletionWrite.metadata).toBe(beforeDeletionWrite.metadata);
    expect(afterDeletionWrite.scheduler).toBe(beforeDeletionWrite.scheduler);
    expect(afterDeletionWrite.legacyMetadata).toBeNull();
    expect(afterDeletionWrite.legacyScheduler).toBeNull();
    expect(afterDeletionWrite.orphanAKeys).toEqual([]);
  } finally {
    await pageB.close();
  }
});

test('deleting another tab\'s shared-active plan flushes and preserves the visible session plan', async ({ page, context }) => {
  await seedPlan(page, {
    major: 'CS',
    entryTerm: TERM_NAME,
    curriculum: [['CS201']],
    grades: [['A']],
    dates: [TERM_NAME],
  });

  const ids = await page.evaluate(() => {
    const storage = window.planStorage;
    return { a: storage.getSessionPlanId(), b: storage.createPlan('Plan B') };
  });
  const pageB = await context.newPage();
  try {
    await pageB.goto('/');
    await pageB.waitForFunction(() => !!(window.planStorage && window.planStorage.getSessionPlanId));
    await pageB.evaluate((planB) => window.planStorage.setActivePlanId(planB), ids.b);
    await pageB.reload();
    await pageB.waitForFunction(
      (planB) => window.planStorage.getSessionPlanId() === planB,
      ids.b,
    );

    expect(await page.evaluate(() => ({
      session: window.planStorage.getSessionPlanId(),
      sharedActive: window.planStorage.getActivePlanId(),
    }))).toEqual({ session: ids.a, sharedActive: ids.b });

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      page.evaluate((planB) => {
        const course = window.curriculum.semesters[0].courses[0];
        course.grade = 'B';
        course.gradingBasis = 'letter';
        window.planStorage.requestSave();
        setTimeout(() => window.planStorage.deletePlan(planB), 0);
      }, ids.b),
    ]);
    await page.waitForFunction(
      (planA) => window.planStorage
        && window.planStorage.getSessionPlanId() === planA
        && window.curriculum
        && window.curriculum.semesters[0]
        && window.curriculum.semesters[0].courses[0]
        && window.curriculum.semesters[0].courses[0].grade === 'B',
      ids.a,
    );

    const result = await page.evaluate(({ a, b }) => ({
      session: window.planStorage.getSessionPlanId(),
      sharedActive: window.planStorage.getActivePlanId(),
      storedGrades: JSON.parse(window.planStorage.getItem('grades', a) || '[]'),
      planBExists: window.planStorage.hasPlan(b),
    }), ids);
    expect(result).toEqual({
      session: ids.a,
      sharedActive: ids.a,
      storedGrades: [['B']],
      planBExists: false,
    });
  } finally {
    await pageB.close();
  }
});
