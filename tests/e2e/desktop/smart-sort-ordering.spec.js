'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');
const { openScheduler } = require('../helpers/scheduler');

const TARGET_TERM = Object.freeze({ code: '202402', name: 'Spring 2024-2025' });
const LATER_TERM = Object.freeze({ code: '202501', name: 'Fall 2025-2026' });
const PRIOR_TERM = Object.freeze({ code: '202401', name: 'Fall 2024-2025' });

// The CS university curriculum totals exactly 41 SU with this set. HUM202 is
// deliberately used instead of the suggestion candidate HUM201: meeting the
// requirement must suppress an otherwise-untaken equivalent course.
const UNIVERSITY_41 = Object.freeze([
  'AL102', 'HIST191', 'HIST192', 'HUM202', 'IF100',
  'MATH101', 'MATH102', 'NS101', 'NS102', 'PROJ201',
  'SPS101', 'SPS102', 'SPS303', 'TLL101', 'TLL102',
]);

const UNIVERSITY_CANDIDATE = 'HUM201';
const REQUIRED_CANDIDATE = 'CS201';

const semesterFor = (page, termName) => page.locator(
  `.container_semester:has(.date p:text-is("${termName}"))`,
);

async function seedBoundaryPlan(page) {
  await seedPlan(page, {
    major: 'CS',
    entryTerm: PRIOR_TERM.name,
    // Deliberately store the later semester first. Smart Sort must use each
    // semester's canonical term identity, never visual/model array position.
    curriculum: [UNIVERSITY_41.slice(), []],
    grades: [UNIVERSITY_41.map(() => 'A'), []],
    dates: [LATER_TERM.name, TARGET_TERM.name],
    termCodes: [LATER_TERM.code, TARGET_TERM.code],
    schedulerSelectedTerm: TARGET_TERM.code,
  });

  const universityCredits = await page.evaluate((termCode) => {
    const semester = window.curriculum.semesters.find((item) => item.termCode === termCode);
    return semester ? semester.totalUniversity : null;
  }, LATER_TERM.code);
  expect(universityCredits, 'the later-term fixture must meet CS university credits exactly').toBe(41);
}

async function configureSmartSort(page) {
  await page.evaluate(() => {
    window.sortBasedOnScore = true;
    window.hideTakenCourses = false;
    window.plannerFilterOfferedOnly = false;

    const set = (key, value) => window.preferenceStorage.setItem(key, value);
    set('sortBasedOnScore', 'true');
    set('hideTakenCourses', 'false');
    set('plannerFilterOfferedOnly', 'false');
    set('plannerFilterCheckPrerequisites', 'false');
    set('schedulerCheckPrereqs', 'false');
    set('schedulerShowUnmetPrereqs', 'true');
  });
}

async function forceFlatSmartSort(page) {
  await page.evaluate(() => {
    window.buildCourseSuggestionScorer = (options) => Object.freeze({
      key: `flat:${String(options && options.targetTermCode || '')}`,
      available: true,
      progressPolicy: String(options && options.progressPolicy || ''),
      targetTermCode: String(options && options.targetTermCode || ''),
      score: () => 0,
    });
  });
}

async function setChecked(locator, checked) {
  if ((await locator.isChecked()) === checked) return;
  // Filter switches visually hide the input, so exercise the user-facing label.
  const label = locator.locator('xpath=ancestor::label[1]');
  await expect(label).toBeVisible();
  await label.click();
  if (checked) await expect(locator).toBeChecked();
  else await expect(locator).not.toBeChecked();
}

async function plannerCodes(picker) {
  return picker.locator('.course-option[data-code]').evaluateAll((nodes) => (
    nodes.map((node) => node.dataset.code)
  ));
}

async function schedulerCodes(modal) {
  return modal.locator('.scheduler-course[data-course]').evaluateAll((nodes) => (
    nodes.map((node) => node.dataset.course)
  ));
}

function expectBefore(codes, first, second) {
  expect(codes, `${first} and ${second} must both be rendered`).toEqual(
    expect.arrayContaining([first, second]),
  );
  expect(
    codes.indexOf(first),
    `${first} should appear before ${second}; rendered order: ${codes.join(', ')}`,
  ).toBeLessThan(codes.indexOf(second));
}

function expectAlphabetical(codes) {
  expect(codes.length, 'the visible result set must not be empty').toBeGreaterThan(0);
  expect(codes).toEqual(codes.slice().sort((left, right) => left.localeCompare(right)));
}

async function openTargetPlannerPicker(page) {
  const semester = semesterFor(page, TARGET_TERM.name);
  await expect(semester).toHaveCount(1);
  await semester.locator('.addCourse').click();
  const picker = semester.locator('.input_container');
  await expect(picker).toBeVisible();
  await picker.locator('.course_select').fill('201');
  await expect(picker.locator(`.course-option[data-code="${UNIVERSITY_CANDIDATE}"]`)).toBeVisible();
  await expect(picker.locator(`.course-option[data-code="${REQUIRED_CANDIDATE}"]`)).toBeVisible();
  return picker;
}

async function searchSchedulerFor201(modal) {
  await modal.locator('.scheduler-search').fill('201');
  // Scheduler search is debounced by 80 ms. Wait for the filtered render, not
  // merely for cards that happened to be present in the original top 60.
  await expect.poll(async () => {
    const codes = await schedulerCodes(modal);
    return codes.length > 0 && codes.every((code) => code.includes('201'));
  }, { timeout: 10000 }).toBe(true);
  await expect(modal.locator(`.scheduler-course[data-course="${UNIVERSITY_CANDIDATE}"]`))
    .toBeVisible();
  await expect(modal.locator(`.scheduler-course[data-course="${REQUIRED_CANDIDATE}"]`))
    .toBeVisible();
}

async function setCurrentTerm(page, term) {
  await page.evaluate(({ code, name }) => {
    window.currentTermCode = code;
    window.currentTermName = name;
  }, term);
}

async function instrumentScorerBuilds(page) {
  await page.evaluate(() => {
    const original = window.buildCourseSuggestionScorer;
    if (typeof original !== 'function') throw new Error('Smart Sort scorer builder is unavailable');
    window.__smartSortScorerBuildProbe = { count: 0, calls: [] };
    window.buildCourseSuggestionScorer = function instrumentedScorerBuilder(options) {
      const scorer = original.call(this, options);
      const probe = window.__smartSortScorerBuildProbe;
      probe.count += 1;
      probe.calls.push({
        progressPolicy: String(options && options.progressPolicy || ''),
        targetTermCode: String(options && options.targetTermCode || ''),
        key: String(scorer && scorer.key || ''),
      });
      return scorer;
    };
  });
}

async function scorerBuildProbe(page) {
  return page.evaluate(() => ({
    count: window.__smartSortScorerBuildProbe.count,
    calls: window.__smartSortScorerBuildProbe.calls.slice(),
  }));
}

async function expectScorerBuildCount(page, expected) {
  await expect.poll(async () => (await scorerBuildProbe(page)).count).toBe(expected);
}

async function searchSchedulerForPrefix(modal, query, prefix) {
  await modal.locator('.scheduler-search').fill(query);
  await expect.poll(async () => {
    const codes = await schedulerCodes(modal);
    return codes.length > 0 && codes.every((code) => code.startsWith(prefix));
  }, { timeout: 10000 }).toBe(true);
}

test.describe('Smart Sort visible ordering', () => {
  test('Planner uses the destination term and falls back to alphabetical order', async ({ page }) => {
    await seedBoundaryPlan(page);
    await configureSmartSort(page);

    const picker = await openTargetPlannerPicker(page);
    expectBefore(await plannerCodes(picker), UNIVERSITY_CANDIDATE, REQUIRED_CANDIDATE);

    await picker.locator('.planner-course-filter-btn').click();
    const menu = picker.locator('.planner-course-filter-menu');
    await expect(menu).toBeVisible();
    await setChecked(menu.locator('.planner-filter-smart-sort'), false);

    const alphabetical = await plannerCodes(picker);
    expectAlphabetical(alphabetical);
    expectBefore(alphabetical, REQUIRED_CANDIDATE, UNIVERSITY_CANDIDATE);
  });

  test('Scheduler ranks for its selected non-current term and toggles alphabetically', async ({ page }) => {
    await seedBoundaryPlan(page);
    await configureSmartSort(page);
    await setCurrentTerm(page, { code: '202602', name: 'Spring 2026-2027' });

    const modal = await openScheduler(page);
    await expect(modal.locator('.scheduler-term-select')).toHaveValue(TARGET_TERM.code);
    await searchSchedulerFor201(modal);
    expectBefore(await schedulerCodes(modal), UNIVERSITY_CANDIDATE, REQUIRED_CANDIDATE);

    await modal.locator('.scheduler-filter-btn').click();
    const menu = modal.locator('.scheduler-filter-menu');
    await expect(menu).toBeVisible();
    await setChecked(menu.locator('.scheduler-toggle-score'), false);

    const alphabetical = await schedulerCodes(modal);
    expectAlphabetical(alphabetical);
    expectBefore(alphabetical, REQUIRED_CANDIDATE, UNIVERSITY_CANDIDATE);
  });

  test('Scheduler invalidates cached scores when the plan changes before a same-term reopen', async ({ page }) => {
    await seedBoundaryPlan(page);
    await configureSmartSort(page);
    await setCurrentTerm(page, TARGET_TERM);

    let modal = await openScheduler(page);
    await searchSchedulerFor201(modal);
    expectBefore(await schedulerCodes(modal), UNIVERSITY_CANDIDATE, REQUIRED_CANDIDATE);

    await modal.locator('.scheduler-close').click();
    await expect(modal).toHaveCount(0);

    const moved = await page.evaluate(({ fromCode, toCode, toName }) => {
      const semester = window.curriculum.semesters.find((item) => item.termCode === fromCode);
      if (!semester) return null;
      Object.assign(semester, {
        termCode: toCode,
        termName: toName,
        date: toName,
        term: toName,
      });
      return {
        termCode: window.semesterTermCode(semester),
        university: semester.totalUniversity,
      };
    }, {
      fromCode: LATER_TERM.code,
      toCode: PRIOR_TERM.code,
      toName: PRIOR_TERM.name,
    });
    expect(moved).toEqual({ termCode: PRIOR_TERM.code, university: 41 });

    modal = await openScheduler(page);
    await expect(modal.locator('.scheduler-term-select')).toHaveValue(TARGET_TERM.code);
    await searchSchedulerFor201(modal);
    expectBefore(await schedulerCodes(modal), REQUIRED_CANDIDATE, UNIVERSITY_CANDIDATE);
  });

  test('an open Planner picker rebuilds once for a saved plan revision and updates in place', async ({ page }) => {
    await seedBoundaryPlan(page);
    await configureSmartSort(page);
    await instrumentScorerBuilds(page);

    const picker = await openTargetPlannerPicker(page);
    expectBefore(await plannerCodes(picker), UNIVERSITY_CANDIDATE, REQUIRED_CANDIDATE);
    await expectScorerBuildCount(page, 1);

    const mutation = await page.evaluate(({ fromCode, toCode, toName }) => {
      const storage = window.planStorage;
      const semester = window.curriculum.semesters.find((item) => item.termCode === fromCode);
      if (!storage || !semester) return null;
      window.__smartSortPlanChangeEvents = 0;
      document.addEventListener('surriculum:planchange', () => {
        window.__smartSortPlanChangeEvents += 1;
      });
      const beforeRevision = storage.getChangeRevision();
      // Model a transactional flow: establish a durable checkpoint, mutate,
      // then save the committed state. Both requests turn the revision, while
      // observers should receive one coalesced notification after the commit.
      const checkpointSaved = storage.requestSave();
      storage.flushSaves();
      Object.assign(semester, {
        termCode: toCode,
        termName: toName,
        date: toName,
        term: toName,
      });
      const saved = storage.requestSave();
      return {
        checkpointSaved,
        saved,
        beforeRevision,
        afterRevision: storage.getChangeRevision(),
        termCode: window.semesterTermCode(semester),
      };
    }, {
      fromCode: LATER_TERM.code,
      toCode: PRIOR_TERM.code,
      toName: PRIOR_TERM.name,
    });

    expect(mutation).not.toBeNull();
    expect(mutation.checkpointSaved).toBe(true);
    expect(mutation.saved).toBe(true);
    expect(mutation.afterRevision).toBe(mutation.beforeRevision + 2);
    expect(mutation.termCode).toBe(PRIOR_TERM.code);
    await expect.poll(() => page.evaluate(() => window.__smartSortPlanChangeEvents)).toBe(1);

    await expect.poll(async () => {
      const codes = await plannerCodes(picker);
      const requiredIndex = codes.indexOf(REQUIRED_CANDIDATE);
      const universityIndex = codes.indexOf(UNIVERSITY_CANDIDATE);
      return requiredIndex >= 0 && universityIndex >= 0 && requiredIndex < universityIndex;
    }).toBe(true);
    await expectScorerBuildCount(page, 2);

    // Re-renders and a duplicate notification for the same saved revision must
    // reuse the scorer that was just built, not allocate the curriculum again.
    await picker.locator('.course_select').fill('20');
    await expect(picker.locator(`.course-option[data-code="${REQUIRED_CANDIDATE}"]`))
      .toBeVisible();
    await picker.locator('.course_select').fill('201');
    await page.evaluate((revision) => {
      document.dispatchEvent(new CustomEvent('surriculum:planchange', {
        detail: { revision },
      }));
    }, mutation.afterRevision);
    await expectScorerBuildCount(page, 2);

    const probe = await scorerBuildProbe(page);
    expect(probe.calls).toHaveLength(2);
    expect(probe.calls.every((call) => (
      call.progressPolicy === 'before-target' && call.targetTermCode === TARGET_TERM.code
    ))).toBe(true);
    expect(new Set(probe.calls.map((call) => call.key)).size).toBe(2);
  });

  test('Scheduler reuses one scorer across repeated result renders in a modal', async ({ page }) => {
    await seedBoundaryPlan(page);
    await configureSmartSort(page);
    await setCurrentTerm(page, TARGET_TERM);
    await instrumentScorerBuilds(page);

    const modal = await openScheduler(page);
    await expect(modal.locator('.scheduler-term-select')).toHaveValue(TARGET_TERM.code);
    await expectScorerBuildCount(page, 1);

    await searchSchedulerForPrefix(modal, UNIVERSITY_CANDIDATE, UNIVERSITY_CANDIDATE);
    await expectScorerBuildCount(page, 1);
    await searchSchedulerForPrefix(modal, REQUIRED_CANDIDATE, REQUIRED_CANDIDATE);
    await expectScorerBuildCount(page, 1);
    await searchSchedulerFor201(modal);
    await expectScorerBuildCount(page, 1);

    const probe = await scorerBuildProbe(page);
    expect(probe.calls).toHaveLength(1);
    expect(probe.calls[0]).toMatchObject({
      progressPolicy: 'before-target',
      targetTermCode: TARGET_TERM.code,
    });
    expect(probe.calls[0].key).not.toBe('');
  });

  test('Planner and Scheduler keep definitively blocked courses below ready courses', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: PRIOR_TERM.name,
      curriculum: [[]],
      grades: [[]],
      dates: [TARGET_TERM.name],
      termCodes: [TARGET_TERM.code],
      schedulerSelectedTerm: TARGET_TERM.code,
    });
    await configureSmartSort(page);
    await page.evaluate(() => {
      window.preferenceStorage.setItem('plannerFilterCheckPrerequisites', 'true');
      window.preferenceStorage.setItem('plannerFilterShowUnmetPrerequisites', 'true');
      window.preferenceStorage.setItem('schedulerCheckPrereqs', 'true');
      window.preferenceStorage.setItem('schedulerShowUnmetPrereqs', 'true');
    });
    await forceFlatSmartSort(page);

    const semester = semesterFor(page, TARGET_TERM.name);
    await semester.locator('.addCourse').click();
    const picker = semester.locator('.input_container');
    await picker.locator('.course_select').fill('MATH');
    const plannerBlocked = picker.locator('.course-option[data-code="MATH102"]');
    const plannerReady = picker.locator('.course-option[data-code="MATH201"]');
    await expect(plannerBlocked).toBeVisible({ timeout: 15000 });
    await expect(plannerReady).toBeVisible({ timeout: 15000 });
    await expect.poll(async () => {
      const codes = await plannerCodes(picker);
      return codes.indexOf('MATH201') >= 0
        && codes.indexOf('MATH102') >= 0
        && codes.indexOf('MATH201') < codes.indexOf('MATH102');
    }).toBe(true);
    await picker.locator('.delete_add_course').click();

    const modal = await openScheduler(page);
    await modal.locator('.scheduler-search').fill('MATH');
    const schedulerBlocked = modal.locator('.scheduler-course[data-course="MATH102"]');
    const schedulerReady = modal.locator('.scheduler-course[data-course="MATH201"]');
    await expect(schedulerBlocked).toHaveClass(/is-unmet-prereq/, { timeout: 15000 });
    await expect(schedulerReady).toBeVisible({ timeout: 15000 });
    expectBefore(await schedulerCodes(modal), 'MATH201', 'MATH102');
  });

  test('Planner keeps known offered courses above known absent courses at equal score', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: PRIOR_TERM.name,
      curriculum: [[]],
      grades: [[]],
      dates: [TARGET_TERM.name],
      termCodes: [TARGET_TERM.code],
    });
    await configureSmartSort(page);
    await forceFlatSmartSort(page);
    await page.evaluate(() => {
      window.loadTermScheduleIndex = async () => new Map([
        ['MATH201', { course_id: 'MATH201' }],
      ]);
    });

    const semester = semesterFor(page, TARGET_TERM.name);
    await semester.locator('.addCourse').click();
    const picker = semester.locator('.input_container');
    await picker.locator('.course_select').fill('MATH');
    const offered = picker.locator('.course-option[data-code="MATH201"]');
    const absent = picker.locator('.course-option[data-code="MATH102"]');
    await expect(offered).toHaveAttribute('data-offering-state', 'offered', { timeout: 15000 });
    await expect(absent).toHaveAttribute('data-offering-state', 'not-offered', { timeout: 15000 });
    expectBefore(await plannerCodes(picker), 'MATH201', 'MATH102');
  });
});
