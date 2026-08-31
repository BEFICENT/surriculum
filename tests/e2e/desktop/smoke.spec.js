'use strict';

const { test, expect } = require('../fixtures');

test.describe('app shell (desktop)', () => {
  test('loads with v3.1 branding, core controls, and no browser errors', async ({ page, browserErrors }) => {
    const requestedUrls = [];
    page.on('request', request => requestedUrls.push(request.url()));
    await page.addInitScript(() => {
      window.__surriculumSyncXhrCalls = [];
      const originalOpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function monitoredOpen(method, url, asyncFlag, ...rest) {
        if (asyncFlag === false) {
          window.__surriculumSyncXhrCalls.push(String(url || ''));
        }
        return Reflect.apply(originalOpen, this, [method, url, asyncFlag, ...rest]);
      };
    });
    await page.goto('/');

    await expect(page).toHaveTitle('SUrriculum v3.1');
    await expect(page.locator('.header-title')).toContainText('SUrriculum v3.1');

    // The program controls are the entry point for everything else.
    await expect(page.locator('select.change_major')).toBeVisible();
    await expect(page.locator('select.entryTerm')).toBeVisible();

    // Desktop must NOT activate the mobile layer.
    await expect(page.locator('body')).not.toHaveClass(/is-mobile/);

    await page.waitForFunction(() => (
      Boolean(window.curriculum)
      && window.requirementsStatus?.main?.available === true
    ));
    const requirementState = await page.evaluate(() => ({
      curriculumTerm: window.curriculum.entryTerm,
      major: window.curriculum.major,
      recordAvailable: Boolean(window.getRequirementRecord(
        window.curriculum.major,
        window.curriculum.entryTerm,
      )),
      status: window.requirementsStatus.main,
    }));
    expect(requirementState.status.available).toBe(true);
    expect(requirementState.status.term).toBe(requirementState.curriculumTerm);
    expect(requirementState.recordAvailable).toBe(true);
    expect(requestedUrls.some(url => /\/requirements\/default\.(?:jsonl|json)(?:[?#]|$)/.test(url))).toBe(false);
    expect(await page.evaluate(() => window.__surriculumSyncXhrCalls)).toEqual([]);

    expect(browserErrors, browserErrors.join('\n')).toEqual([]);
  });
});
