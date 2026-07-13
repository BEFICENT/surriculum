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

  await page.evaluate((s) => {
    const obj = { type: 'surriculum_plan', version: 1, plan: { name: 'E2E Plan', state: s } };
    window.planStorage.importPlanObject(obj, { activate: true });
  }, state);

  await page.reload();

  const expectsCourses = Array.isArray(state.curriculum) && state.curriculum.some((sem) => sem && sem.length);
  if (expectsCourses) {
    // Wait for BOTH the rendered courses and the model to be populated — the
    // plan loads async after reload (course DB fetch -> reload()), and tests
    // read window.curriculum immediately, so racing that is the main flake source.
    await page.waitForSelector('.container_semester .course', { timeout: 15000 });
    await page.waitForFunction(
      () => !!(window.curriculum && Array.isArray(window.curriculum.semesters)
        && window.curriculum.semesters.some((s) => s.courses && s.courses.length)),
      { timeout: 15000 },
    );
  }
}

module.exports = { seedPlan };
