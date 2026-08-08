'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');

const TERM = 'Fall 2024-2025';
const OTHER_TERM = 'Spring 2024-2025';
const EARLIER_ENTRY_TERM = 'Fall 2023-2024';

// These regressions must exercise the mutation debounce and lifecycle/reload
// flushes, not pass because the old polling loop happened to run first.  Main's
// autosave is the only two-second interval in the desktop app; suppress it before
// every document loads and leave every other timer alone.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const nativeSetInterval = window.setInterval.bind(window);
    window.__autosaveFallbackIntervalsBlocked = 0;
    window.setInterval = (callback, delay, ...args) => {
      if (Number(delay) === 2000) {
        window.__autosaveFallbackIntervalsBlocked += 1;
        return 0;
      }
      return nativeSetInterval(callback, delay, ...args);
    };
  });
});

async function seedAutosavePlan(page, overrides = {}) {
  await seedPlan(page, {
    major: 'CS',
    entryTerm: TERM,
    curriculum: [['MATH101']],
    grades: [['']],
    dates: [TERM],
    ...overrides,
  });
  await page.waitForFunction(() => window.planStorage
    && typeof window.planStorage.requestSave === 'function'
    && typeof window.planStorage.flushSaves === 'function');
  expect(await page.evaluate(() => window.__autosaveFallbackIntervalsBlocked))
    .toBeGreaterThan(0);
}

async function waitForRenderedCourse(page, code) {
  await page.waitForFunction((courseCode) => !!(window.curriculum
    && window.curriculum.hasCourse(courseCode)), code, { timeout: 20000 });
  await expect(page.locator(`.course:has(.course_code:text-is("${code}"))`)).toHaveCount(1);
}

test.describe('plan autosave hardening', () => {
  test('a normal mutation is persisted by the short debounce without lifecycle help', async ({ page }) => {
    await seedAutosavePlan(page);
    expect(await page.evaluate(() => JSON.parse(window.planStorage.getItem('grades'))))
      .toEqual([['']]);

    await page.locator('.course:has(.course_code:text-is("MATH101")) .grade').click();
    await page.locator('.grade-option[data-value="B"]').click();

    // The fallback interval is disabled by beforeEach. No visibility, pagehide,
    // or navigation event is dispatched, so only requestSave's short debounce
    // can update this namespace within the one-second deadline.
    await expect.poll(
      () => page.evaluate(() => JSON.parse(window.planStorage.getItem('grades'))),
      { timeout: 1000, intervals: [50, 100, 150] },
    ).toEqual([['B']]);
    expect(await page.evaluate(() => window.planStorage.hasPlan(
      window.planStorage.getActivePlanId(),
    ))).toBe(true);
  });

  test('a failed parallel snapshot rolls back every planner array', async ({ page }) => {
    await seedAutosavePlan(page, { grades: [['A']] });

    const result = await page.evaluate(() => {
      const storage = window.planStorage;
      const id = storage.getActivePlanId();
      const keys = ['curriculum', 'grades', 'gradingBases', 'dates'];
      const read = () => Object.fromEntries(keys.map((key) => [key, storage.getItem(key, id)]));
      const before = read();
      let message = '';
      try {
        // gradingBases is deliberately invalid and is visited after the first
        // two fields, exercising rollback of a partially attempted snapshot.
        storage.setSnapshot({
          curriculum: JSON.stringify([['CS201']]),
          grades: JSON.stringify([['B']]),
          gradingBases: null,
          dates: JSON.stringify(['Spring 2024-2025']),
        }, id);
      } catch (error) {
        message = String(error && error.message || error);
      }
      return { before, after: read(), message };
    });

    expect(result.message).toContain('gradingBases');
    expect(result.after).toEqual(result.before);
  });

  test('a stale page cannot recreate a plan removed by another tab', async ({ page }) => {
    await seedAutosavePlan(page);

    const result = await page.evaluate(() => {
      const storage = window.planStorage;
      const doomed = storage.getActivePlanId();
      const keep = storage.createPlan('Cross-tab survivor');

      const gradeCell = document.querySelector('.course .grade');
      gradeCell.click();
      document.querySelector('.grade-option[data-value="C+"]').click();

      // Simulate another tab deleting the active session plan and selecting
      // the remaining plan, without running this page's controller.
      const indexKey = 'surriculum.plans.v1';
      const index = JSON.parse(localStorage.getItem(indexKey));
      index.plans = index.plans.filter((plan) => plan.id !== doomed);
      index.activeId = keep;
      localStorage.setItem(indexKey, JSON.stringify(index));
      Object.keys(localStorage)
        .filter((key) => key.startsWith(`surriculum.plan.${doomed}.`))
        .forEach((key) => localStorage.removeItem(key));

      let directWriteError = '';
      try {
        storage.setItem('major', 'ME', doomed);
      } catch (error) {
        directWriteError = String(error && error.message || error);
      }
      window.dispatchEvent(new Event('pagehide'));
      return {
        keep,
        directWriteError,
        activeId: JSON.parse(localStorage.getItem(indexKey)).activeId,
        orphanKeys: Object.keys(localStorage)
          .filter((key) => key.startsWith(`surriculum.plan.${doomed}.`)),
      };
    });

    expect(result.directWriteError).toContain('no longer available');
    expect(result.activeId).toBe(result.keep);
    expect(result.orphanKeys).toEqual([]);
  });

  test('pagehide synchronously saves pending grade, term, and course edits', async ({ page }) => {
    await seedAutosavePlan(page);

    const snapshot = await page.evaluate(({ otherTerm }) => {
      // Keep all mutations and pagehide in one browser task. A debounce callback
      // cannot run between them, so this specifically proves the lifecycle flush.
      const gradeCell = document.querySelector('.course .grade');
      gradeCell.click();
      document.querySelector('.grade-option[data-value="B"]').click();

      document.querySelector('.semester_date_edit').click();
      const termSelect = document.querySelector('.date select');
      termSelect.value = otherTerm;
      // Call the delegated mutation handler directly: a synthetic click would
      // continue through main's unrelated overlay cleanup after the handler
      // removes its own tick node, leaving that cleanup with a detached target.
      dynamic_click({ target: document.querySelector('.date .tick') }, window.curriculum, course_data);

      // Use the planner's model primitive directly. The UI picker schedules a
      // focus/render callback that is intentionally irrelevant here and can race
      // the synthetic pagehide; addCourse is the mutation boundary autosave owns.
      const semester = window.curriculum.semesters[0];
      window.curriculum.course_id += 1;
      semester.addCourse(new s_course('CS201', `c${window.curriculum.course_id}`));

      const read = () => ({
        curriculum: JSON.parse(window.planStorage.getItem('curriculum')),
        grades: JSON.parse(window.planStorage.getItem('grades')),
        dates: JSON.parse(window.planStorage.getItem('dates')),
      });
      const beforePagehide = read();

      const event = typeof PageTransitionEvent === 'function'
        ? new PageTransitionEvent('pagehide', { persisted: false })
        : new Event('pagehide');
      window.dispatchEvent(event);
      return { beforePagehide, afterPagehide: read() };
    }, { otherTerm: OTHER_TERM });

    expect(snapshot.beforePagehide).toEqual({
      curriculum: [['MATH101']],
      grades: [['']],
      dates: [TERM],
    });
    expect(snapshot.afterPagehide).toEqual({
      curriculum: [['MATH101', 'CS201']],
      grades: [['B', '']],
      dates: [OTHER_TERM],
    });

    await page.reload();
    await waitForRenderedCourse(page, 'CS201');
    const restored = await page.evaluate(() => ({
      courses: window.curriculum.semesters[0].courses.map((course) => course.code),
      grades: window.curriculum.semesters[0].courses.map((course) => course.grade),
      term: window.curriculum.semesters[0].termName,
    }));
    expect(restored).toEqual({
      courses: ['MATH101', 'CS201'],
      grades: ['B', ''],
      term: OTHER_TERM,
    });
  });

  test('backgrounding with the term editor open saves other edits without storing the transient ellipsis', async ({ page }) => {
    await seedAutosavePlan(page);

    const stored = await page.evaluate(() => {
      const gradeCell = document.querySelector('.course .grade');
      gradeCell.click();
      document.querySelector('.grade-option[data-value="A-"]').click();

      // The editor temporarily removes the date's <p>. The legacy serializer
      // represented that transient DOM as "...", which must never reach storage.
      document.querySelector('.semester_date_edit').click();
      const originalVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');
      const originalHidden = Object.getOwnPropertyDescriptor(document, 'hidden');
      Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));

      const result = {
        editorStillOpen: !!document.querySelector('.date select'),
        grades: JSON.parse(window.planStorage.getItem('grades')),
        dates: JSON.parse(window.planStorage.getItem('dates')),
      };
      if (originalVisibility) Object.defineProperty(document, 'visibilityState', originalVisibility);
      else delete document.visibilityState;
      if (originalHidden) Object.defineProperty(document, 'hidden', originalHidden);
      else delete document.hidden;
      return result;
    });

    expect(stored.editorStillOpen).toBe(true);
    expect(stored.grades, 'the hidden flush must still save non-transient changes').toEqual([['A-']]);
    expect(stored.dates).toEqual([TERM]);
    expect(stored.dates).not.toContain('...');

    await page.reload();
    await waitForRenderedCourse(page, 'MATH101');
    expect(await page.evaluate(() => window.curriculum.semesters[0].courses[0].grade)).toBe('A-');
    await expect(page.locator('.container_semester .date p').first()).toHaveText(TERM);
  });

  test('pending edits survive immediate entry-term and major reloads', async ({ page }) => {
    await seedAutosavePlan(page);

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      page.evaluate(({ entryTerm }) => {
        const gradeCell = document.querySelector('.course .grade');
        gradeCell.click();
        document.querySelector('.grade-option[data-value="B+"]').click();
        const selector = document.querySelector('.entryTerm');
        selector.value = entryTerm;
        selector.dispatchEvent(new Event('change', { bubbles: true }));
      }, { entryTerm: EARLIER_ENTRY_TERM }),
    ]);
    await waitForRenderedCourse(page, 'MATH101');
    expect(await page.evaluate(() => ({
      grade: window.curriculum.semesters[0].courses[0].grade,
      entryTerm: window.planStorage.getItem('entryTerm'),
    }))).toEqual({ grade: 'B+', entryTerm: EARLIER_ENTRY_TERM });

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      page.evaluate(() => {
        const gradeCell = document.querySelector('.course .grade');
        gradeCell.click();
        document.querySelector('.grade-option[data-value="C"]').click();
        const selector = document.querySelector('.change_major');
        selector.value = 'ME';
        selector.dispatchEvent(new Event('change', { bubbles: true }));
      }),
    ]);
    await waitForRenderedCourse(page, 'MATH101');
    expect(await page.evaluate(() => ({
      grade: window.curriculum.semesters[0].courses[0].grade,
      major: window.curriculum.major,
    }))).toEqual({ grade: 'C', major: 'ME' });
  });

  test('a dirty active plan cannot be resurrected by deletion pagehide', async ({ page }) => {
    await seedAutosavePlan(page, { grades: [['A']] });
    const ids = await page.evaluate(() => {
      const doomed = window.planStorage.getActivePlanId();
      // seedPlan imports through the public API, so the original default plan
      // is already a valid replacement for the imported active plan.
      const keep = window.planStorage.getPlans().find((plan) => plan.id !== doomed).id;
      return { doomed, keep };
    });

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      page.evaluate((doomed) => {
        const gradeCell = document.querySelector('.course .grade');
        gradeCell.click();
        document.querySelector('.grade-option[data-value="D+"]').click();
        window.planStorage.deletePlan(doomed);
      }, ids.doomed),
    ]);
    await page.waitForFunction(() => !!(window.planStorage && window.planStorage.getPlans));

    const result = await page.evaluate((doomed) => ({
      activeId: window.planStorage.getActivePlanId(),
      planIds: window.planStorage.getPlans().map((plan) => plan.id),
      orphanKeys: Object.keys(localStorage).filter((key) => key.includes(doomed)),
    }), ids.doomed);
    expect(result.activeId).toBe(ids.keep);
    expect(result.planIds).not.toContain(ids.doomed);
    expect(result.orphanKeys).toEqual([]);
  });

  test('a dirty reset cannot be resurrected and preserves unrelated localStorage', async ({ page }) => {
    await seedAutosavePlan(page, { grades: [['A']] });
    const oldPlanId = await page.evaluate(() => {
      localStorage.setItem('autosave-test-sentinel', 'keep me');
      return window.planStorage.getActivePlanId();
    });

    await page.locator('.resetLocal').evaluate((button) => button.click());
    const resetModal = page.locator('.modal-overlay').filter({ hasText: /Reset local data/i });
    await expect(resetModal).toBeVisible();

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      page.evaluate(() => {
        const gradeCell = document.querySelector('.course .grade');
        gradeCell.click();
        document.querySelector('.grade-option[data-value="F"]').click();
        const reset = Array.from(document.querySelectorAll('.modal-overlay .app-modal-footer button'))
          .find((button) => button.textContent.trim() === 'Reset');
        if (!reset) throw new Error('Expected reset confirmation button');
        reset.click();
      }),
    ]);
    await page.waitForFunction(() => !!(window.planStorage && window.planStorage.getPlans));

    const result = await page.evaluate((oldId) => ({
      sentinel: localStorage.getItem('autosave-test-sentinel'),
      activeId: window.planStorage.getActivePlanId(),
      oldKeys: Object.keys(localStorage).filter((key) => key.includes(oldId)),
    }), oldPlanId);
    expect(result.sentinel).toBe('keep me');
    expect(result.activeId).not.toBe(oldPlanId);
    expect(result.oldKeys).toEqual([]);
  });

  test('UI import activation flushes the old plan before switching', async ({ page }) => {
    await seedAutosavePlan(page, { grades: [['A']] });
    const oldPlanId = await page.evaluate(() => window.planStorage.getActivePlanId());
    const importedState = {
      major: 'CS',
      entryTerm: TERM,
      curriculum: [['MATH102']],
      grades: [['A-']],
      dates: [TERM],
    };

    await Promise.all([
      page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
      page.evaluate(({ state }) => {
        const gradeCell = document.querySelector('.course .grade');
        gradeCell.click();
        document.querySelector('.grade-option[data-value="B-"]').click();

        const payload = JSON.stringify({
          type: 'surriculum_plan',
          version: 1,
          plan: { name: 'Imported autosave check', state },
        });
        const input = document.getElementById('planImportInput2');
        const file = new File([payload], 'autosave-plan.json', { type: 'application/json' });
        Object.defineProperty(input, 'files', { configurable: true, value: [file] });
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }, { state: importedState }),
    ]);
    await waitForRenderedCourse(page, 'MATH102');

    const result = await page.evaluate((oldId) => ({
      activeId: window.planStorage.getActivePlanId(),
      activeName: window.planStorage.getActivePlan().name,
      oldGrades: JSON.parse(window.planStorage.getItem('grades', oldId)),
      activeCourses: window.curriculum.semesters[0].courses.map((course) => course.code),
    }), oldPlanId);
    expect(result.activeId).not.toBe(oldPlanId);
    expect(result.activeName).toBe('Imported autosave check');
    expect(result.oldGrades).toEqual([['B-']]);
    expect(result.activeCourses).toEqual(['MATH102']);
  });
});
