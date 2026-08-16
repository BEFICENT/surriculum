'use strict';

const {
  test,
  expect,
  ONBOARDING_KEYS,
  ONBOARDING_RELEASE,
} = require('../fixtures');

const UPDATE_NAME = /What['’]s new in SUrriculum 3\.1/;

async function waitForApp(page) {
  await page.waitForFunction(() => (
    document.readyState === 'complete'
    && typeof window.openHelpInformation === 'function'
  ));
  await expect(page.locator('body')).toHaveClass(/is-mobile/);
}

async function expectNoDeferredStartupDialog(page) {
  await waitForApp(page);
  await page.waitForTimeout(100);
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

test.describe('returning-user update (mobile)', () => {
  test.use({ onboardingState: 'upgrade' });

  test('is contained, traps focus, closes with Escape, and stays acknowledged', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/');
    await waitForApp(page);

    const update = page.getByRole('dialog', { name: UPDATE_NAME });
    await expect(update).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    const modal = update.locator('.release-update-modal');
    const guide = update.locator('.release-update-guide');
    await expect(modal).toBeVisible();
    await expect(guide).toBeVisible();

    const geometry = await update.evaluate((overlay) => {
      const modalElement = overlay.querySelector('.release-update-modal');
      const body = modalElement.querySelector('.app-modal-body');
      const modalBox = modalElement.getBoundingClientRect();
      return {
        modalInViewport: modalBox.left >= -1 && modalBox.right <= window.innerWidth + 1
          && modalBox.top >= -1 && modalBox.bottom <= window.innerHeight + 1,
        bodyHorizontalOverflow: body.scrollWidth - body.clientWidth,
        documentHorizontalOverflow:
          document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    expect(geometry.modalInViewport).toBe(true);
    expect(geometry.bodyHorizontalOverflow).toBeLessThanOrEqual(1);
    expect(geometry.documentHorizontalOverflow).toBeLessThanOrEqual(1);

    const close = update.getByRole('button', { name: /Close What['’]s new in SUrriculum 3\.1/ });
    await expect(close).toBeFocused();
    const lastFocusable = update.locator(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), '
      + 'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ).last();
    await lastFocusable.focus();
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(update).toHaveCount(0);
    await expect.poll(() => page.evaluate(
      (key) => localStorage.getItem(key),
      ONBOARDING_KEYS.lastSeenRelease,
    )).toBe(ONBOARDING_RELEASE);

    await page.reload();
    await expectNoDeferredStartupDialog(page);
  });
});

test.describe('first-use Help (mobile)', () => {
  test.use({ onboardingState: 'fresh' });

  test('uses the existing full-screen Help guide without stacking another dialog', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    await waitForApp(page);

    const help = page.getByRole('dialog', { name: 'Help & information' });
    await expect(help).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await expect(help).toHaveClass(/help-info-overlay/);
    await expect(help.locator('#helpInfoGuide')).toBeVisible();

    const geometry = await help.evaluate((overlay) => {
      const modal = overlay.querySelector('.help-info-modal');
      const box = modal.getBoundingClientRect();
      return {
        modalInViewport: box.left >= -1 && box.right <= window.innerWidth + 1
          && box.top >= -1 && box.bottom <= window.innerHeight + 1,
        documentHorizontalOverflow:
          document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    expect(geometry.modalInViewport).toBe(true);
    expect(geometry.documentHorizontalOverflow).toBeLessThanOrEqual(1);

    await page.keyboard.press('Escape');
    await expect(help).toHaveCount(0);
    const markers = await page.evaluate((keys) => ({
      helpSeen: localStorage.getItem(keys.helpSeen),
      lastSeenRelease: localStorage.getItem(keys.lastSeenRelease),
    }), ONBOARDING_KEYS);
    expect(markers).toEqual({
      helpSeen: 'true',
      lastSeenRelease: ONBOARDING_RELEASE,
    });

    await page.reload();
    await expectNoDeferredStartupDialog(page);
  });
});
