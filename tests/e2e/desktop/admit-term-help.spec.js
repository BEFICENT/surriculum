'use strict';

const { test, expect } = require('../fixtures');

const OPENER_NAME = 'What does admit term mean?';
const DIALOG_NAME = 'What is an admit term?';
const SUIS_PATH = 'SUIS → Student Records → General Student Information';

async function openAdmitTermHelp(page) {
  const heading = page.locator('.program-controls-heading');
  await expect(heading).toBeVisible();

  const opener = heading.getByRole('button', { name: OPENER_NAME, exact: true });
  await expect(opener).toHaveAttribute('id', 'openAdmitTermHelpButton');
  await expect(opener).toHaveAttribute('aria-haspopup', 'dialog');
  await expect(opener).toBeVisible();
  expect(await opener.evaluate((button) => button.closest('[aria-hidden="true"]') === null),
    'the interactive help control must not inherit aria-hidden').toBe(true);

  await opener.click();
  const dialog = page.getByRole('dialog', { name: DIALOG_NAME, exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.admit-term-help-modal')).toBeVisible();
  await expect(dialog.locator('#admitTermHelpGuide')).toBeVisible();
  return { opener, dialog, guide: dialog.locator('#admitTermHelpGuide') };
}

async function expectAdmitTermRules(guide) {
  await expect(guide).toContainText(SUIS_PATH);
  await expect(guide).toContainText(/main major \/ minor/i);
  await expect(guide).toContainText(/initial university entry term/i);
  await expect(guide).toContainText(/double[- ]major/i);
  await expect(guide).toContainText(/before Fall 2026-2027/i);
  await expect(guide).toContainText(/first term after/i);
  await expect(guide).toContainText(/application was accepted/i);
  await expect(guide).toContainText(/Fall 2026-2027 or later/i);
}

test.describe('Admit-term help (desktop)', () => {
  test('explains every program rule and restores focus after keyboard dismissal', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.footer')).toContainText(SUIS_PATH);
    const { opener, dialog, guide } = await openAdmitTermHelp(page);
    await expectAdmitTermRules(guide);

    const close = dialog.getByRole('button', { name: `Close ${DIALOG_NAME}`, exact: true });
    await expect(close).toBeFocused();

    const lastFocusable = dialog.locator(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), '
      + 'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ).last();
    await lastFocusable.focus();
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();

    await opener.click();
    const reopened = page.getByRole('dialog', { name: DIALOG_NAME, exact: true });
    await reopened.getByRole('button', { name: `Close ${DIALOG_NAME}`, exact: true }).click();
    await expect(reopened).toHaveCount(0);
    await expect(opener).toBeFocused();
  });

  test('stays contained and internally scrollable on a short desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 420 });
    await page.goto('/');
    const { dialog, guide } = await openAdmitTermHelp(page);
    await guide.locator(':scope > :last-child').scrollIntoViewIfNeeded();

    const geometry = await dialog.evaluate((overlay) => {
      const modal = overlay.querySelector('.admit-term-help-modal');
      const body = modal.querySelector('.app-modal-body');
      const content = modal.querySelector('#admitTermHelpGuide');
      const last = content.lastElementChild;
      const rect = (element) => element.getBoundingClientRect();
      const modalBox = rect(modal);
      const bodyBox = rect(body);
      const lastBox = rect(last);
      return {
        modalInViewport: modalBox.left >= -1 && modalBox.right <= window.innerWidth + 1
          && modalBox.top >= -1 && modalBox.bottom <= window.innerHeight + 1,
        bodyInModal: bodyBox.left >= modalBox.left - 1 && bodyBox.right <= modalBox.right + 1
          && bodyBox.top >= modalBox.top - 1 && bodyBox.bottom <= modalBox.bottom + 1,
        finalContentReachable: lastBox.top < bodyBox.bottom && lastBox.bottom > bodyBox.top,
        contentHorizontalOverflow: content.scrollWidth - content.clientWidth,
        bodyHorizontalOverflow: body.scrollWidth - body.clientWidth,
        documentHorizontalOverflow:
          document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });

    expect(geometry).toMatchObject({
      modalInViewport: true,
      bodyInModal: true,
      finalContentReachable: true,
    });
    expect(geometry.contentHorizontalOverflow).toBeLessThanOrEqual(1);
    expect(geometry.bodyHorizontalOverflow).toBeLessThanOrEqual(1);
    expect(geometry.documentHorizontalOverflow).toBeLessThanOrEqual(1);
  });
});
