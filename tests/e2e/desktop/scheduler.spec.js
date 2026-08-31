'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');

async function setSchedulerToggle(modal, selector, checked) {
  const toggle = modal.locator(selector);
  if ((await toggle.isChecked()) === checked) return;
  const label = toggle.locator('xpath=ancestor::label[1]');
  await expect(label).toBeVisible();
  await label.click();
  if (checked) await expect(toggle).toBeChecked();
  else await expect(toggle).not.toBeChecked();
}

test.describe('scheduler (desktop)', () => {
  test('opens and lists offered courses for the term', async ({ page, browserErrors }) => {
    await page.goto('/');

    // The launcher is bound without an inline handler so the CSP can keep
    // script-src free of unsafe-inline.
    await page.locator('#openSchedulerButton').click();

    const modal = page.locator('.scheduler-modal');
    await expect(modal).toBeVisible({ timeout: 15000 });
    await expect(modal.locator('.scheduler-term')).toContainText(/Fall|Spring|Summer/);

    // Results are fetched async from the schedule index; wait for the first card.
    await expect(modal.locator('.scheduler-course').first()).toBeVisible({ timeout: 15000 });
    expect(await modal.locator('.scheduler-course').count()).toBeGreaterThan(0);

    expect(browserErrors, browserErrors.join('\n')).toEqual([]);
  });

  test('loads independent Scheduler data concurrently and abandons a closed modal', async ({ page, browserErrors }) => {
    await page.goto('/');
    await page.waitForFunction(() => (
      typeof window.openSchedulerModal === 'function'
      && typeof window.loadCoursePageInfoIndex === 'function'
    ));

    // Let any app-start enrichment settle, then force this opening to perform
    // fresh reads that the route gates below can observe.
    await page.evaluate(async () => {
      try { if (window.__courseOfferingsPromise) await window.__courseOfferingsPromise; } catch (_) {}
      try { if (window.__coursePageInfoPromise) await window.__coursePageInfoPromise; } catch (_) {}
      window.__scheduleIndexPromise = null;
      window.__scheduleIndexTerm = '';
      window.__coursePageInfoPromise = null;
      window.__courseOfferingsJsonlText = '';
      window.coursePageInfoByCode = null;
      try { performance.clearMarks('surriculum:scheduler-ready'); } catch (_) {}
    });

    let releaseLoads;
    const loadGate = new Promise((resolve) => { releaseLoads = resolve; });
    const started = new Set();
    let resolveBothStarted;
    const bothStarted = new Promise((resolve) => { resolveBothStarted = resolve; });
    const markStarted = (name) => {
      started.add(name);
      if (started.size === 2) resolveBothStarted();
    };

    await page.route('**/courses/schedule/202403.jsonl', async (route) => {
      markStarted('schedule');
      await loadGate;
      await route.continue();
    });
    await page.route('**/courses/all_coursepage_info.jsonl', async (route) => {
      markStarted('course-info');
      await loadGate;
      await route.continue();
    });

    try {
      await page.evaluate(() => { window.openSchedulerModal('202403'); });
      const modal = page.locator('.scheduler-modal');
      await expect(modal).toBeVisible({ timeout: 15000 });

      // Both requests must reach their gates before either one is released. If
      // startup serializes them, the second request can never reach this point.
      await Promise.race([
        bothStarted,
        new Promise((_, reject) => setTimeout(() => reject(new Error(
          `Timed out waiting for concurrent Scheduler reads; started: ${Array.from(started).join(', ')}`,
        )), 5000)),
      ]);

      await modal.locator('.scheduler-close').click();
      await expect(page.locator('.scheduler-overlay')).toHaveCount(0);
    } finally {
      releaseLoads();
      await page.unrouteAll({ behavior: 'wait' });
    }

    await page.waitForTimeout(150);
    await expect(page.locator('.scheduler-overlay')).toHaveCount(0);
    expect(await page.evaluate(() => (
      performance.getEntriesByName('surriculum:scheduler-ready').length
    ))).toBe(0);
    expect(browserErrors, browserErrors.join('\n')).toEqual([]);
  });

  test('earlier-planned filter keeps selected and future terms visible', async ({ page }) => {
    // The Scheduler hides only courses planned before its selected term. A
    // course in the selected term must remain available for section selection,
    // and a future course has not reached this point in the plan yet.
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [['MATH101'], ['MATH102'], ['MATH203']],
      grades: [['A'], [''], ['']],
      dates: ['Fall 2024-2025', 'Summer 2025-2026', 'Fall 2026-2027'],
      schedulerSelectedTerm: '202503',
    });

    await page.evaluate(() => { window.hideTakenCourses = true; window.openSchedulerModal(); });
    const modal = page.locator('.scheduler-modal');
    await expect(modal).toBeVisible({ timeout: 15000 });

    // Narrow the list so result pagination can't be what hides a course.
    await modal.locator('.scheduler-search').fill('MATH');
    await expect(modal.locator('.scheduler-course').first()).toBeVisible({ timeout: 15000 });

    // MATH101 is planned before the selected term -> hidden.
    await expect(modal.locator('.scheduler-course[data-course="MATH101"]')).toHaveCount(0);
    // MATH102 belongs to the selected term and remains schedulable.
    await expect(modal.locator('.scheduler-course[data-course="MATH102"]')).toHaveCount(1);
    // MATH203 is planned only in a later term and also remains visible.
    await expect(modal.locator('.scheduler-course[data-course="MATH203"]')).toHaveCount(1);
  });

  test('legacy CS210 search finds DSA210 and an earlier legacy plan entry hides it', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [['CS210'], []],
      grades: [['A'], []],
      dates: ['Fall 2024-2025', 'Spring 2024-2025'],
      termCodes: ['202401', '202402'],
      schedulerSelectedTerm: '202402',
    });

    await page.evaluate(() => {
      window.hideTakenCourses = false;
      window.preferenceStorage.setItem('hideTakenCourses', 'false');
      window.preferenceStorage.setItem('schedulerCheckPrereqs', 'false');
      window.openSchedulerModal();
    });
    const modal = page.locator('.scheduler-modal');
    await expect(modal).toBeVisible({ timeout: 15000 });
    await modal.locator('.scheduler-search').fill('CS210');

    const canonical = modal.locator('.scheduler-course[data-course="DSA210"]');
    await expect(canonical).toHaveCount(1, { timeout: 15000 });
    await expect(canonical).toBeVisible();

    await modal.locator('.scheduler-filter-btn').click();
    await expect(modal.locator('.scheduler-filter-menu')).toBeVisible();
    await setSchedulerToggle(modal, '.scheduler-toggle-hide-taken', true);
    await expect(canonical).toHaveCount(0);
  });

  test('a same-term legacy CS210 plan entry keeps canonical DSA210 schedulable', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [['CS210']],
      grades: [['']],
      dates: ['Spring 2024-2025'],
      termCodes: ['202402'],
      schedulerSelectedTerm: '202402',
    });

    await page.evaluate(() => {
      window.hideTakenCourses = true;
      window.preferenceStorage.setItem('hideTakenCourses', 'true');
      window.preferenceStorage.setItem('schedulerCheckPrereqs', 'false');
      window.openSchedulerModal();
    });
    const modal = page.locator('.scheduler-modal');
    await expect(modal).toBeVisible({ timeout: 15000 });
    await modal.locator('.scheduler-search').fill('CS210');

    await expect(modal.locator('.scheduler-course[data-course="DSA210"]'))
      .toBeVisible({ timeout: 15000 });
  });

  test('shared prerequisite evaluator still marks unmet scheduler courses', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [[]],
      grades: [[]],
      dates: ['Spring 2024-2025'],
      schedulerSelectedTerm: '202402',
    });

    await page.evaluate(() => {
      window.preferenceStorage.setItem('schedulerCheckPrereqs', 'true');
      window.preferenceStorage.setItem('schedulerShowUnmetPrereqs', 'true');
      window.openSchedulerModal();
    });
    const modal = page.locator('.scheduler-modal');
    await expect(modal).toBeVisible({ timeout: 15000 });
    await modal.locator('.scheduler-search').fill('MATH102');

    const course = modal.locator('.scheduler-course[data-course="MATH102"]');
    await expect(course).toBeVisible({ timeout: 15000 });
    await expect(course).toHaveClass(/is-unmet-prereq/);
    await expect(course).toContainText(/Prereq.*MATH101/s);
  });

  test('SPS303 scheduler card shows the unmet 58 prior-SU General Requirement', async ({ page }) => {
    const prior56 = [
      'IF100', 'MATH101', 'SPS101', 'AL102', 'MATH102', 'SPS102',
      'HUM201', 'HUM202', 'HUM207', 'HUM311', 'HUM312', 'HUM317',
      'CS201', 'CS204', 'CS300', 'CS301', 'CS302', 'CS305', 'TLL101',
    ];
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [prior56, []],
      grades: [prior56.map(() => ''), []],
      dates: ['Fall 2024-2025', 'Spring 2024-2025'],
      schedulerSelectedTerm: '202402',
    });

    await page.evaluate(() => {
      window.preferenceStorage.setItem('schedulerCheckPrereqs', 'true');
      window.preferenceStorage.setItem('schedulerShowUnmetPrereqs', 'true');
      window.openSchedulerModal();
    });
    const modal = page.locator('.scheduler-modal');
    await expect(modal).toBeVisible({ timeout: 15000 });
    await modal.locator('.scheduler-search').fill('SPS303');

    const course = modal.locator('.scheduler-course[data-course="SPS303"]');
    await expect(course).toBeVisible({ timeout: 15000 });
    await expect(course).toHaveClass(/is-unmet-prereq/);
    await expect(course).toContainText(/Prereq.*Prior SU: 56 of 58 planned\/completed/s);

    await course.locator('.scheduler-course-actions > .scheduler-details').click();
    const details = page.locator('.scheduler-details-modal');
    await expect(details).toBeVisible();
    await expect(details).toContainText('General requirements');
    await expect(details).toContainText('58.000 credits');
  });

  test('HUM201 scheduler prerequisite combines the SPS clauses and 23 prior SU', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [['SPS101', 'IF100', 'MATH101'], []],
      grades: [['A', '', 'A'], []],
      dates: ['Fall 2024-2025', 'Spring 2024-2025'],
      schedulerSelectedTerm: '202402',
    });

    await page.evaluate(() => {
      window.preferenceStorage.setItem('schedulerCheckPrereqs', 'true');
      window.preferenceStorage.setItem('schedulerShowUnmetPrereqs', 'true');
      window.openSchedulerModal();
    });
    const modal = page.locator('.scheduler-modal');
    await expect(modal).toBeVisible({ timeout: 15000 });
    await modal.locator('.scheduler-search').fill('HUM201');

    const course = modal.locator('.scheduler-course[data-course="HUM201"]');
    await expect(course).toBeVisible({ timeout: 15000 });
    await expect(course).toHaveClass(/is-unmet-prereq/);
    await expect(course).toContainText(/Prereq.*SPS102/s);
    await expect(course).toContainText(/Prereq.*Prior SU: 9 of 23 planned\/completed/s);
  });

  test('ENS491 uses the shared registration guidance and keeps ENS491R as one linked component', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [[]],
      grades: [[]],
      dates: ['Spring 2024-2025'],
      termCodes: ['202402'],
      schedulerSelectedTerm: '202402',
    });

    await page.evaluate(() => {
      window.preferenceStorage.setItem('schedulerCheckPrereqs', 'true');
      window.preferenceStorage.setItem('schedulerShowUnmetPrereqs', 'true');
      window.openSchedulerModal();
    });
    const modal = page.locator('.scheduler-modal');
    await expect(modal).toBeVisible({ timeout: 15000 });
    await modal.locator('.scheduler-search').fill('ENS491');

    const course = modal.locator('.scheduler-course[data-course="ENS491"]');
    await expect(course).toBeVisible({ timeout: 15000 });
    await expect(course).toHaveClass(/is-unmet-prereq/);
    await expect(course).toContainText('Unmet registration guidance');
    await expect(course).toContainText(/80 SU/i);
    await expect(course).toContainText(/CS300, CS306, or CS308/i);
    const linkedRows = course.locator('.scheduler-coreq-row', { hasText: 'ENS491R' });
    await expect(linkedRows).toHaveCount(1);
    await expect(modal.locator('.scheduler-course[data-course="ENS491R"]')).toHaveCount(0);

    // A direct component-code query resolves to its reviewed parent instead of
    // surfacing the reverse ENS491R -> ENS491 catalog edge as a second card.
    await modal.locator('.scheduler-search').fill('ENS491R');
    await expect(course).toBeVisible({ timeout: 15000 });
    await expect(modal.locator('.scheduler-course')).toHaveCount(1);
    await expect(modal.locator('.scheduler-course[data-course="ENS491R"]')).toHaveCount(0);
    await expect(course.locator('.scheduler-coreq-row', { hasText: 'ENS491R' })).toHaveCount(1);

    await course.locator('.scheduler-course-actions > .scheduler-details').click();
    const details = page.locator('.scheduler-details-modal');
    await expect(details).toBeVisible();
    await expect(details.locator('.scheduler-registration-guidance'))
      .toContainText('Registration guidance');
    await expect(details.locator('.scheduler-registration-guidance'))
      .toContainText(/reviewed 2026-08-17/i);
    await expect(details.locator('.scheduler-registration-guidance a'))
      .toHaveAttribute('href', /suis\.sabanciuniv\.edu/);
    await expect(details).not.toContainText('Computer Science and Engineering: CS 300');
  });
});
