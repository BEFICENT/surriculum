'use strict';

// Seed a full plan via the app's OWN import path (a versioned, user-facing
// format — the most refactor-stable hook available), then reload so the app
// renders it exactly as it would a real saved plan.
//
// `state` uses the persisted shape the app reads on load:
//   {
//     major:      'CS',
//     entryTerm:  'Fall 2024-2025',
//     curriculum: [ ['MATH101','MATH102'], ['CS201'] ],  // course codes, per semester
//     grades:     [ ['A','B'],             ['A-'] ],       // grades,       per semester
//     dates:      [ 'Fall 2024-2025',      'Spring 2024-2025' ], // term name per semester
//   }
// Courses must be real codes present in the scraped course DB, or the loader
// silently skips them (that's the app's own behaviour).
async function seedPlan(page, state) {
  await page.goto('/');
  await page.waitForFunction(() => !!(window.planStorage && window.planStorage.importPlanObject));

  // Do not replace the throwaway/default document while its catalog fetch is
  // still in flight. WebKit reports a navigation-cancelled same-origin fetch
  // as an uncaught "due to access control checks" page error, which can hide a
  // real cross-browser regression behind a retry. Waiting for the public boot
  // promise also makes the import begin from the same settled state a person
  // sees before using the plan controls.
  await page.waitForFunction(() => typeof window.whenSurriculumPlannerReady === 'function', null, {
    timeout: 15000,
  });
  const initialBooted = await page.evaluate(() => window.whenSurriculumPlannerReady());
  if (initialBooted !== true) throw new Error('The initial planner document did not finish booting.');

  await page.evaluate((s) => {
    // Keep most fixtures on v1 so every test exercises migration. Grading
    // bases require v2; global transcript metadata was added in v3; canonical
    // per-semester term identities were added in v4.
    const version = Object.prototype.hasOwnProperty.call(s, 'termCodes')
      ? 4 : (Object.prototype.hasOwnProperty.call(s, 'globalCourseMetadata')
        ? 3 : (Object.prototype.hasOwnProperty.call(s, 'gradingBases') ? 2 : 1));
    const obj = { type: 'surriculum_plan', version, plan: { name: 'E2E Plan', state: s } };
    window.planStorage.importPlanObject(obj, { activate: true });
  }, state);

  await page.reload();

  // Static planner controls and planStorage are available before the
  // asynchronous requirements/catalog hydration completes. Wait on the app's
  // canonical planner-hydration promise for every plan shape, including an
  // intentionally empty curriculum where there is no rendered course selector
  // to wait for.
  await page.waitForFunction(() => typeof window.whenSurriculumPlannerReady === 'function', null, {
    timeout: 15000,
  });
  const booted = await page.evaluate(() => window.whenSurriculumPlannerReady());
  if (booted !== true) throw new Error('The seeded planner document did not finish booting.');
  await page.waitForFunction(
    () => window.__surriculumPlannerReady === true
      && !!window.curriculum
      && Array.isArray(window.curriculum.semesters),
    null,
    { timeout: 15000 },
  );

  const expectsCourses = Array.isArray(state.curriculum) && state.curriculum.some((sem) => sem && sem.length);
  if (expectsCourses) {
    // Wait for BOTH the rendered courses and the model to be populated — the
    // plan loads async after reload (course DB fetch -> reload()), and tests
    // read window.curriculum immediately, so racing that is the main flake source.
    // Mobile semesters may legitimately start collapsed, so the course can be
    // present in the rendered plan without being visible.  Attachment plus the
    // model check below is the stable indication that async hydration finished.
    await page.waitForSelector('.container_semester .course', {
      state: 'attached',
      timeout: 15000,
    });
    await page.waitForFunction(
      () => !!(window.curriculum && Array.isArray(window.curriculum.semesters)
        && window.curriculum.semesters.some((s) => s.courses && s.courses.length)),
      { timeout: 15000 },
    );
  }
}

// Read the curriculum's aggregate credit/GPA totals from the live model.
// earnedCredits = sum of semester.totalCredit; GPA = totalGPA / totalGPACredits.
async function readCurriculumTotals(page) {
  return page.evaluate(() => {
    const sems = (window.curriculum && window.curriculum.semesters) || [];
    const sum = (f) => sems.reduce((a, s) => a + (s[f] || 0), 0);
    const gpaCredits = sum('totalGPACredits');
    return {
      earnedCredits: sum('totalCredit'),
      gpaValue: sum('totalGPA'),
      gpaCredits,
      gpa: gpaCredits ? +(sum('totalGPA') / gpaCredits).toFixed(3) : null,
    };
  });
}

// Move `codes` to the front of a course list, preserving the order of the rest.
//
// Allocation is chronological and capped per pool, so course ORDER decides which
// courses land in a pool and which overflow past it. Fixtures are generated in
// catalog order; when a test needs a specific course to actually occupy a pool
// slot (or needs the order that exposes an order-dependent bug), hoist it.
const hoist = (courses, codes) => [
  ...codes.filter((c) => courses.includes(c)),
  ...courses.filter((c) => !codes.includes(c)),
];

module.exports = { seedPlan, readCurriculumTotals, hoist };
