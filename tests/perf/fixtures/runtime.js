'use strict';

const { FIXTURES, getFixture } = require('./plans');

const ONBOARDING_RELEASE = '3.1';
const DEFAULT_ACADEMIC_DATE = '2026-08-29T09:00:00.000Z';
const ONBOARDING_KEYS = Object.freeze({
  cohort: 'surriculum.preference.onboardingCohort',
  helpSeen: 'surriculum.preference.onboardingHelpSeen',
  lastSeenRelease: 'surriculum.preference.onboardingLastSeenRelease',
});

async function installDefaultOnboardingState(browserContext) {
  if (!browserContext || typeof browserContext.addInitScript !== 'function') {
    throw new TypeError('installDefaultOnboardingState requires a Playwright BrowserContext.');
  }
  await browserContext.addInitScript(({ keys, release }) => {
    try {
      localStorage.setItem(keys.cohort, release);
      localStorage.setItem(keys.helpSeen, 'true');
      localStorage.setItem(keys.lastSeenRelease, release);
    } catch (_) {}
  }, { keys: ONBOARDING_KEYS, release: ONBOARDING_RELEASE });
}

async function installFixedDate(browserContext, value = DEFAULT_ACADEMIC_DATE) {
  if (!browserContext || typeof browserContext.addInitScript !== 'function') {
    throw new TypeError('installFixedDate requires a Playwright BrowserContext.');
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new TypeError(`Invalid fixed academic date: ${value}`);
  await browserContext.addInitScript((fixedTimestamp) => {
    const NativeDate = Date;
    function FixedDate(...args) {
      if (!new.target) return new NativeDate(fixedTimestamp).toString();
      return Reflect.construct(
        NativeDate,
        args.length ? args : [fixedTimestamp],
        new.target,
      );
    }
    Object.setPrototypeOf(FixedDate, NativeDate);
    FixedDate.prototype = NativeDate.prototype;
    FixedDate.now = () => fixedTimestamp;
    Object.defineProperty(FixedDate, 'name', { value: 'Date' });
    globalThis.Date = FixedDate;
  }, timestamp);
}

function normalizedFixture(fixtureOrName) {
  if (typeof fixtureOrName === 'string') return getFixture(fixtureOrName);
  if (!fixtureOrName || typeof fixtureOrName !== 'object') {
    throw new TypeError('A fixture name or fixture object is required.');
  }
  return JSON.parse(JSON.stringify(fixtureOrName));
}

async function waitForImportedFixture(page, fixture, timeout = 30_000) {
  const expected = {
    courses: fixture.expectedCourseCount,
    semesters: fixture.expectedSemesterCount,
    termCodes: fixture.expectedTermCodes,
  };
  await page.waitForFunction((value) => {
    const semesters = window.curriculum && Array.isArray(window.curriculum.semesters)
      ? window.curriculum.semesters : null;
    if (!semesters || semesters.length !== value.semesters) return false;
    const count = semesters.reduce(
      (total, semester) => total + (Array.isArray(semester.courses) ? semester.courses.length : 0),
      0,
    );
    if (count !== value.courses) return false;
    const codes = semesters.map((semester) => String(semester.termCode || ''));
    return codes.length === value.termCodes.length
      && codes.every((code, index) => code === value.termCodes[index]);
  }, expected, { timeout });

  await page.waitForFunction((value) => (
    document.querySelectorAll('.container_semester').length === value.semesters
      && document.querySelectorAll('.container_semester .course').length === value.courses
  ), expected, { timeout });

  const snapshot = await page.evaluate(() => {
    const semesters = window.curriculum.semesters || [];
    return {
      major: window.curriculum.major,
      courseCount: semesters.reduce(
        (total, semester) => total + (semester.courses || []).length,
        0,
      ),
      semesterCount: semesters.length,
      termCodes: semesters.map((semester) => String(semester.termCode || '')),
      renderedCourseCount: document.querySelectorAll('.container_semester .course').length,
      renderedSemesterCount: document.querySelectorAll('.container_semester').length,
    };
  });

  if (snapshot.courseCount !== fixture.expectedCourseCount
      || snapshot.renderedCourseCount !== fixture.expectedCourseCount) {
    throw new Error(
      `${fixture.id}: expected exactly ${fixture.expectedCourseCount} imported courses, `
        + `but model/render counts are ${snapshot.courseCount}/${snapshot.renderedCourseCount}. `
        + 'A catalog lookup may have silently skipped a fixture course.',
    );
  }
  return snapshot;
}

async function importFixture(page, fixtureOrName, options = {}) {
  if (!page || typeof page.evaluate !== 'function') {
    throw new TypeError('importFixture requires a Playwright Page.');
  }
  const fixture = normalizedFixture(fixtureOrName);
  const timeout = Number(options.timeout || 30_000);
  await page.waitForFunction(
    () => Boolean(window.planStorage && window.planStorage.importPlanObject),
    null,
    { timeout },
  );
  await page.evaluate(({ input, onboarding }) => {
    localStorage.setItem(onboarding.keys.cohort, onboarding.release);
    localStorage.setItem(onboarding.keys.helpSeen, 'true');
    localStorage.setItem(onboarding.keys.lastSeenRelease, onboarding.release);
    window.planStorage.importPlanObject({
      type: 'surriculum_plan',
      version: input.schemaVersion,
      plan: { name: input.planName, state: input.plan },
    }, { activate: true });
    Object.entries(input.preferences || {}).forEach(([key, value]) => {
      window.preferenceStorage.setItem(key, String(value));
    });
  }, {
    input: fixture,
    onboarding: { keys: ONBOARDING_KEYS, release: ONBOARDING_RELEASE },
  });

  if (options.reload !== false) {
    await page.reload({ waitUntil: 'domcontentloaded', timeout });
  }
  const snapshot = await waitForImportedFixture(page, fixture, timeout);
  return { fixture, snapshot };
}

function createFixtureHelpers(page, options = {}) {
  return {
    available: Object.keys(FIXTURES),
    get: getFixture,
    seed: (name, seedOptions = {}) => importFixture(page, name, {
      ...options,
      ...seedOptions,
    }),
  };
}

module.exports = {
  DEFAULT_ACADEMIC_DATE,
  ONBOARDING_KEYS,
  ONBOARDING_RELEASE,
  createFixtureHelpers,
  importFixture,
  installDefaultOnboardingState,
  installFixedDate,
  waitForImportedFixture,
};
