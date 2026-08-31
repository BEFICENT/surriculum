'use strict';

const RETURNING_PLAN = Object.freeze({
  major: 'CS',
  entryTerm: 'Fall 2024-2025',
  curriculum: Object.freeze([
    Object.freeze(['CS201']),
    Object.freeze(['CS204']),
    Object.freeze(['CS300']),
  ]),
  grades: Object.freeze([
    Object.freeze(['A']),
    Object.freeze(['A']),
    Object.freeze(['A']),
  ]),
  gradingBases: Object.freeze([
    Object.freeze(['letter']),
    Object.freeze(['letter']),
    Object.freeze(['letter']),
  ]),
  dates: Object.freeze([
    'Fall 2024-2025',
    'Spring 2024-2025',
    'Fall 2025-2026',
  ]),
  termCodes: Object.freeze(['202401', '202402', '202501']),
});

async function seedReturningPlanBeforeNavigation(page, state = RETURNING_PLAN) {
  const stored = Object.fromEntries(Object.entries(state).map(([key, value]) => [
    key,
    typeof value === 'string' ? value : JSON.stringify(value),
  ]));

  await page.addInitScript((values) => {
    // A first-load legacy plan is the only deterministic way to have a
    // returning plan in storage before application boot. The production
    // migration copies these keys into the active plan namespace.
    localStorage.removeItem('surriculum.plans.migrated.v1');
    Object.entries(values).forEach(([key, value]) => localStorage.setItem(key, value));
  }, stored);
}

async function gatePrimaryCatalog(page) {
  let markStarted;
  let releaseRequest;
  let released = false;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const releaseGate = new Promise((resolve) => { releaseRequest = resolve; });
  const pattern = '**/courses/202401/CS.jsonl';

  await page.route(pattern, async (route) => {
    markStarted();
    await releaseGate;
    await route.continue();
  });

  return {
    started,
    release() {
      if (released) return;
      released = true;
      releaseRequest();
    },
  };
}

async function waitForPlannerReady(page) {
  await page.waitForFunction(() => typeof window.whenSurriculumPlannerReady === 'function');
  return page.evaluate(() => window.whenSurriculumPlannerReady());
}

async function visualPlannerStack(page) {
  return page.evaluate(() => {
    const elements = [
      ...document.querySelectorAll('.board .container_semester'),
      ...document.querySelectorAll('.board .add-semester-ghost'),
    ];
    return elements.map((element) => {
      const box = element.getBoundingClientRect();
      const isNewSemester = element.classList.contains('add-semester-ghost');
      return {
        kind: isNewSemester ? 'new-semester' : 'semester',
        label: isNewSemester
          ? 'New Semester'
          : String((element.querySelector('.date p') || {}).textContent || '').trim(),
        top: box.top,
        left: box.left,
      };
    }).sort((left, right) => (left.top - right.top) || (left.left - right.left));
  });
}

module.exports = {
  RETURNING_PLAN,
  gatePrimaryCatalog,
  seedReturningPlanBeforeNavigation,
  visualPlannerStack,
  waitForPlannerReady,
};
