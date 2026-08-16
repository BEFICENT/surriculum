'use strict';

// Shared Playwright fixtures for SUrriculum's e2e tests.
//
// The app swallows a lot of failures in try/catch, so a broken flow often shows
// up only as a console.error or an uncaught pageerror rather than a thrown test
// failure. This fixture records both so a test can assert `browserErrors` is
// empty and catch that whole class of silent regressions.
const base = require('@playwright/test');

const ONBOARDING_RELEASE = '3.1';
const ONBOARDING_KEYS = Object.freeze({
  cohort: 'surriculum.preference.onboardingCohort',
  helpSeen: 'surriculum.preference.onboardingHelpSeen',
  lastSeenRelease: 'surriculum.preference.onboardingLastSeenRelease',
  schema: 'surriculum.appDataVersion',
});

// Subresource load failures are browser-generated ("Failed to load resource:
// ...") and aren't app-logic regressions, so they don't fail the suite:
//  - the scheduler probes several candidate schedule-data paths and one 404s
//    benignly while another succeeds.
// Everything else — uncaught pageerrors and console.error calls the app itself
// makes — still fails the suite.
const IGNORED_CONSOLE = [
  /Failed to load resource/,
  // The service worker races the sandbox and sometimes can't fetch its own
  // script. Same-origin, but the fetch happens in worker scope so it never
  // surfaces as a page `requestfailed` for the guard below to notice.
  /An unknown error occurred when fetching the script/,
];

// Uncaught errors that are artifacts of THIS environment rather than the app.
// Kept as a short, specific list — never a broad pattern — because the whole
// value of the fixture is that a genuinely missing global looks like a real
// bug.
const IGNORED_PAGEERROR = [
  /Failed to register a ServiceWorker/,
];

const test = base.test.extend({
  // Most E2E tests exercise the app after onboarding, so keep their historical
  // clean-start behaviour by acknowledging the current release before the
  // first document loads. Dedicated onboarding specs opt into fresh, upgrade,
  // or corrupt states. The sessionStorage sentinel makes this a one-time seed:
  // reload assertions observe what the app actually persisted instead of an
  // init script silently restoring the fixture on every navigation.
  onboardingState: ['dismissed', { option: true }],
  onboardingStorage: [async ({ context, onboardingState }, use) => {
    // Install at context scope so tabs created directly by a test inherit the
    // same non-blocking baseline as the fixture's primary page.
    await context.addInitScript(({ keys, release, state }) => {
      const sentinel = `__surriculum_e2e_onboarding_seeded_${state}`;
      try {
        if (sessionStorage.getItem(sentinel) === '1') return;
        sessionStorage.setItem(sentinel, '1');

        Object.values(keys).forEach((key) => localStorage.removeItem(key));
        if (state === 'dismissed') {
          localStorage.setItem(keys.cohort, release);
          localStorage.setItem(keys.helpSeen, 'true');
          localStorage.setItem(keys.lastSeenRelease, release);
        } else if (state === 'upgrade') {
          // Version 1 is the storage schema written by the currently live app.
          localStorage.setItem(keys.schema, '1');
        } else if (state === 'corrupt') {
          localStorage.setItem(keys.schema, '1');
          localStorage.setItem(keys.cohort, '{not-a-cohort');
          localStorage.setItem(keys.helpSeen, 'definitely');
          localStorage.setItem(keys.lastSeenRelease, '{not-a-version');
        }
        // `fresh` intentionally leaves every marker and the schema absent.
      } catch (_) {}
    }, { keys: ONBOARDING_KEYS, release: ONBOARDING_RELEASE, state: onboardingState });
    await use();
  }, { auto: true }],

  // `auto: true` so EVERY test gets this, whether or not it asks for the
  // fixture. It used to be opt-in, and only 2 of 202 tests opted in — the net
  // was there but hardly wired up, so an uncaught TypeError could fire on a
  // flow a test was driving and the test would still pass. (That is exactly
  // what happened: getAncestor threw on every drag dropped outside a semester,
  // and the drag test sailed past it.)
  //
  // A test that MEANS to trigger an error should assert on `browserErrors` and
  // then empty it — see semester-drag.spec.js.
  browserErrors: [async ({ page, baseURL, onboardingStorage }, use, testInfo) => {
    const errors = [];
    page.on('pageerror', (err) => {
      if (IGNORED_PAGEERROR.some((re) => re.test(err.message))) return;
      errors.push('pageerror: ' + err.message);
    });
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const text = msg.text();
      if (IGNORED_CONSOLE.some((re) => re.test(text))) return;
      errors.push('console.error: ' + text);
    });

    // The sandbox intermittently denies localhost requests
    // (net::ERR_NETWORK_ACCESS_DENIED). When one of the app's OWN scripts fails
    // to load, everything downstream throws — "s_curriculum is not defined",
    // "entryTerms is not defined", the service worker failing to register. Those
    // are a broken RUN, not a broken app, and blanket-ignoring their messages
    // would blind this fixture to the real thing (a genuinely missing global
    // looks identical). Record the failed request so an otherwise-passing
    // attempt is rejected and Playwright retries with a clean load.
    const appResourceFailures = [];
    page.on('requestfailed', (req) => {
      const failureText = String((req.failure() && req.failure().errorText) || '');
      // A navigation deliberately cancels requests owned by the page being
      // replaced. That is normal during tests which reseed a plan by reloading
      // while detached/background enrichment is still in flight; it is not a
      // failed application load. Keep genuine transport failures (including
      // ERR_NETWORK_ACCESS_DENIED) release-blocking below.
      if (/^(?:net::ERR_ABORTED|NS_BINDING_ABORTED)$/i.test(failureText)) return;
      // WebKit uses this exact phrase when a navigation/update supersedes its
      // service-worker script request. Scope the exception to sw.js only so a
      // cancelled application asset or data request remains release-blocking.
      let isCancelledServiceWorkerRequest = false;
      try {
        isCancelledServiceWorkerRequest = failureText === 'Load request cancelled'
          && /\/sw\.js$/i.test(new URL(req.url()).pathname);
      } catch (_) {}
      if (isCancelledServiceWorkerRequest) return;
      const failure = failureText ? `${req.url()} (${failureText})` : req.url();
      if (baseURL && req.url().startsWith(baseURL)) {
        appResourceFailures.push(failure);
        return;
      }
      // Some focused tests mount the same app on a second localhost origin
      // (for example the GitHub Pages /surriculum/ service-worker check).
      try {
        const requestOrigin = new URL(req.url()).origin;
        const pageOrigin = new URL(page.url()).origin;
        if (requestOrigin === pageOrigin) appResourceFailures.push(failure);
      } catch (_) {}
    });

    await use(errors);

    // Only when the test would otherwise have passed: if it already failed, its
    // own failure is the more useful one and must not be masked.
    const otherwisePassed = testInfo.status === 'passed' && testInfo.expectedStatus === 'passed';
    if (appResourceFailures.length && otherwisePassed) {
      throw new Error(
        `The app had ${appResourceFailures.length} failed same-origin request(s); retrying with a clean load:\n  `
        + appResourceFailures.join('\n  '),
      );
    }
    if (errors.length && otherwisePassed) {
      throw new Error(
        `The app emitted ${errors.length} uncaught error(s) during this test:\n  ` + errors.join('\n  '),
      );
    }
  }, { auto: true }],
});

module.exports = {
  test,
  expect: base.expect,
  ONBOARDING_KEYS,
  ONBOARDING_RELEASE,
};
