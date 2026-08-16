'use strict';

const {
  test,
  expect,
  ONBOARDING_KEYS,
  ONBOARDING_RELEASE,
} = require('../fixtures');

const UPDATE_TITLE = /What['’]s new in SUrriculum 3\.1/;
const UPDATE_CLOSE_NAME = /Close What['’]s new in SUrriculum 3\.1/;
const HELP_TITLE = 'Help & information';

async function openApp(page) {
  await page.goto('/');
  await page.waitForFunction(() => (
    document.readyState === 'complete'
    && typeof window.openHelpInformation === 'function'
  ));
}

async function expectNoDeferredStartupDialog(page) {
  await page.waitForFunction(() => (
    document.readyState === 'complete'
    && typeof window.openHelpInformation === 'function'
  ));
  // Startup presentation may be queued until the shared modal API and Help
  // guide are ready. Give that queue a turn before asserting it stayed quiet.
  await page.waitForTimeout(100);
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

async function readMarkers(page) {
  return page.evaluate((keys) => ({
    cohort: localStorage.getItem(keys.cohort),
    helpSeen: localStorage.getItem(keys.helpSeen),
    lastSeenRelease: localStorage.getItem(keys.lastSeenRelease),
  }), ONBOARDING_KEYS);
}

test.describe('first-use Help onboarding', () => {
  test.use({ onboardingState: 'fresh' });

  test('shows Help only once, then persists the deliberate dismissal', async ({ page }) => {
    await openApp(page);

    const help = page.getByRole('dialog', { name: HELP_TITLE });
    await expect(help).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await expect(page.getByRole('dialog', { name: UPDATE_TITLE })).toHaveCount(0);
    await expect(help.locator('#helpInfoGuide')).toBeVisible();
    await expect(help.getByRole('button', { name: `Close ${HELP_TITLE}` })).toBeFocused();

    expect(await readMarkers(page)).toEqual({
      cohort: ONBOARDING_RELEASE,
      // Presentation itself records delivery so closing through Escape, the X,
      // or the backdrop cannot turn first-run Help into a recurring obstacle.
      helpSeen: 'true',
      lastSeenRelease: ONBOARDING_RELEASE,
    });

    await help.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(help).toHaveCount(0);
    expect(await readMarkers(page)).toEqual({
      cohort: ONBOARDING_RELEASE,
      helpSeen: 'true',
      lastSeenRelease: ONBOARDING_RELEASE,
    });

    await page.reload();
    await expectNoDeferredStartupDialog(page);
  });
});

test.describe('returning-user 3.1 update', () => {
  test.use({ onboardingState: 'upgrade' });

  test('summarizes the release concisely, acknowledges it, and leaves manual Help available', async ({ page }) => {
    await openApp(page);

    const update = page.getByRole('dialog', { name: UPDATE_TITLE });
    await expect(update).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await expect(page.getByRole('dialog', { name: HELP_TITLE })).toHaveCount(0);
    await expect(update).toHaveClass(/release-update-overlay/);
    await expect(update.locator('.release-update-modal')).toBeVisible();
    const guide = update.locator('.release-update-guide');
    await expect(guide).toBeVisible();

    const copy = (await guide.innerText()).replace(/\s+/g, ' ').trim();
    expect(copy.length, 'the release summary should remain quick to scan').toBeLessThan(1400);
    const itemCount = await guide.locator('li').count();
    expect(itemCount, 'the release summary should have a useful short list').toBeGreaterThanOrEqual(3);
    expect(itemCount, 'the release summary should not become a changelog').toBeLessThanOrEqual(6);
    await expect(guide).toContainText(/planner/i);
    await expect(guide).toContainText(/scheduler/i);
    await expect(guide).toContainText(/summary|progress/i);
    await expect(guide).toContainText(/planning aid/i);
    await expect(guide).toContainText(/verify/i);
    await expect(update.getByRole('button', { name: 'Open Help' })).toBeVisible();
    await expect(update.getByRole('button', { name: 'Continue' })).toBeVisible();
    await expect(update.getByRole('button', { name: UPDATE_CLOSE_NAME })).toBeFocused();

    expect(await readMarkers(page)).toEqual({
      cohort: `pre-${ONBOARDING_RELEASE}`,
      helpSeen: null,
      // The release is recorded when delivered; every close path is therefore
      // a durable one-time dismissal rather than only the Continue button.
      lastSeenRelease: ONBOARDING_RELEASE,
    });

    await update.getByRole('button', { name: 'Continue' }).click();
    await expect(update).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect.poll(() => readMarkers(page)).toEqual({
      cohort: `pre-${ONBOARDING_RELEASE}`,
      helpSeen: null,
      lastSeenRelease: ONBOARDING_RELEASE,
    });

    await page.reload();
    await expectNoDeferredStartupDialog(page);

    const opener = page.getByRole('button', { name: HELP_TITLE });
    await opener.click();
    const manualHelp = page.getByRole('dialog', { name: HELP_TITLE });
    await expect(manualHelp).toBeVisible();
    await manualHelp.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(manualHelp).toHaveCount(0);
    await expect(opener).toBeFocused();
  });

  test('Open Help replaces the update dialog instead of stacking over it', async ({ page }) => {
    await openApp(page);

    const update = page.getByRole('dialog', { name: UPDATE_TITLE });
    await expect(update).toBeVisible();
    await update.getByRole('button', { name: 'Open Help' }).click();

    await expect(update).toHaveCount(0);
    const help = page.getByRole('dialog', { name: HELP_TITLE });
    await expect(help).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await expect(help.locator('#helpInfoGuide')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(help).toHaveCount(0);
    expect((await readMarkers(page)).lastSeenRelease).toBe(ONBOARDING_RELEASE);

    await page.reload();
    await expectNoDeferredStartupDialog(page);
  });

  test('waits for restored double-major review work before showing the update', async ({ page }) => {
    const termName = 'Fall 2024-2025';
    await page.addInitScript(({ term }) => {
      // Seed the currently-live app's legacy storage shape before its first
      // 3.1 load. A primary custom course genuinely requires classification
      // for the restored DSA double major during startup.
      localStorage.setItem('major', 'CS');
      localStorage.setItem('doubleMajor', 'DSA');
      localStorage.setItem('entryTerm', term);
      localStorage.setItem('entryTermDM', term);
      localStorage.setItem('customCourses_CS', JSON.stringify([{
        Major: 'ZZZ',
        Code: '626',
        Course_Name: 'Primary custom elective',
        ECTS: '6',
        Engineering: 0,
        Basic_Science: 0,
        SU_credit: '3',
        Faculty: 'FENS',
        Faculty_Course: 'No',
        EL_Type: 'free',
      }]));
    }, { term: termName });

    let dmRequestCount = 0;
    let markSecondRequestStarted;
    let releaseSecondRequest;
    const secondRequestStarted = new Promise((resolve) => { markSecondRequestStarted = resolve; });
    const secondRequestGate = new Promise((resolve) => { releaseSecondRequest = resolve; });
    const routeDmCatalog = async (route) => {
      dmRequestCount += 1;

      // fetchCourseData probes six paths with synchronous XHR before its
      // asynchronous fetch fallback. Force those probes to miss so the seventh
      // request in each DM load is genuinely asynchronous and can expose the
      // readiness race without freezing the renderer.
      if (dmRequestCount % 7 !== 0) {
        await route.fulfill({ status: 404, contentType: 'application/json', body: '[]' });
        return;
      }
      if (dmRequestCount === 14) {
        markSecondRequestStarted();
        await secondRequestGate;
      }
      const response = await route.fetch();
      await route.fulfill({ response });
    };
    await page.route('**/DSA.jsonl', routeDmCatalog);
    await page.route('**/DSA.json', routeDmCatalog);

    const navigation = page.goto('/');
    await secondRequestStarted;
    try {
      // The old race dispatched app readiness while this restored-program
      // request was still pending, so the update could open first.
      await page.waitForTimeout(100);
      expect(await page.evaluate(() => window.__surriculumReady === true)).toBe(false);
      await expect(page.getByRole('dialog', { name: UPDATE_TITLE })).toHaveCount(0);
      await expect(page.getByRole('dialog', { name: HELP_TITLE })).toHaveCount(0);
    } finally {
      releaseSecondRequest();
    }
    await navigation;

    const dmReview = page.getByRole('dialog', { name: 'Set DSA Category' });
    await expect(dmReview).toBeVisible();
    await expect(dmReview).toContainText('ZZZ626 - Primary custom elective');
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await expect(page.getByRole('dialog', { name: UPDATE_TITLE })).toHaveCount(0);
    expect(await page.evaluate(() => window.__surriculumReady === true)).toBe(false);

    await dmReview.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dmReview).toHaveCount(0);

    const update = page.getByRole('dialog', { name: UPDATE_TITLE });
    await expect(update).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await expect(page.getByRole('dialog', { name: HELP_TITLE })).toHaveCount(0);
    expect(await page.evaluate(() => window.__surriculumReady === true)).toBe(true);
  });
});

test.describe('release announcement versioning', () => {
  test('an unregistered future app version never reuses the 3.1 announcement', async ({ page }) => {
    await page.addInitScript((futureVersion) => {
      Object.defineProperty(window, 'APP_VERSION', {
        configurable: true,
        get: () => futureVersion,
        // Ignore the assignment made by the real version script so this test
        // exercises the onboarding code exactly as a future version bump would.
        set: () => {},
      });
    }, '3.2');

    await openApp(page);
    await page.waitForFunction(() => window.__surriculumReady === true);
    await expect.poll(() => page.evaluate(() => window.APP_VERSION)).toBe('3.2');
    await expect.poll(async () => (await readMarkers(page)).cohort).toBe(ONBOARDING_RELEASE);
    await expectNoDeferredStartupDialog(page);
    await expect(page.locator('.release-update-guide')).toHaveCount(0);
    expect((await readMarkers(page)).lastSeenRelease).toBe(ONBOARDING_RELEASE);
  });

  test('an older cached build cannot lower a newer release acknowledgment', async ({ page }) => {
    await openApp(page);
    await expectNoDeferredStartupDialog(page);
    await page.evaluate(({ key, newerRelease }) => {
      localStorage.setItem(key, newerRelease);
    }, { key: ONBOARDING_KEYS.lastSeenRelease, newerRelease: '3.2' });

    await page.getByRole('button', { name: HELP_TITLE }).click();
    const help = page.getByRole('dialog', { name: HELP_TITLE });
    await expect(help).toBeVisible();
    await expect.poll(async () => (await readMarkers(page)).lastSeenRelease).toBe('3.2');
    await help.getByRole('button', { name: 'Close', exact: true }).click();
  });
});

test.describe('damaged onboarding markers', () => {
  test.use({ onboardingState: 'corrupt' });

  test('falls back to the previous-live upgrade path and repairs acknowledgment safely', async ({ page }) => {
    await openApp(page);

    const update = page.getByRole('dialog', { name: UPDATE_TITLE });
    await expect(update).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await expect(page.getByRole('dialog', { name: HELP_TITLE })).toHaveCount(0);

    await update.getByRole('button', { name: UPDATE_CLOSE_NAME }).click();
    await expect(update).toHaveCount(0);
    await expect.poll(async () => (await readMarkers(page)).lastSeenRelease)
      .toBe(ONBOARDING_RELEASE);

    await page.reload();
    await expectNoDeferredStartupDialog(page);
  });
});
