'use strict';

const { test, expect } = require('../fixtures');

const OPENER_NAME = 'What does admit term mean?';
const DIALOG_NAME = 'What is an admit term?';
const SUIS_PATH = 'SUIS → Student Records → General Student Information';

async function openMobileAdmitTermHelp(page) {
  await page.locator('.m-nav-item[data-mtab="controls"]').click();
  await expect(page.locator('body')).toHaveAttribute('data-mobile-tab', 'controls');

  const heading = page.locator('.program-controls-heading');
  await expect(heading).toBeVisible();
  const opener = heading.getByRole('button', { name: OPENER_NAME, exact: true });
  await opener.scrollIntoViewIfNeeded();
  await expect(opener).toBeVisible();
  await expect(opener).toHaveAttribute('aria-haspopup', 'dialog');
  expect(await opener.evaluate((button) => button.closest('[aria-hidden="true"]') === null),
    'the mobile help control must not inherit aria-hidden').toBe(true);

  await opener.click();
  const dialog = page.getByRole('dialog', { name: DIALOG_NAME, exact: true });
  await expect(dialog).toBeVisible();
  return { opener, dialog, guide: dialog.locator('#admitTermHelpGuide') };
}

test.describe('Admit-term help (mobile)', () => {
  test('is reachable in Controls and stays contained at narrow phone sizes', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/');
    const { dialog, guide } = await openMobileAdmitTermHelp(page);

    await expect(guide).toBeVisible();
    await expect(guide).toContainText(SUIS_PATH);
    await expect(guide).toContainText(/main major \/ minor/i);
    await expect(guide).toContainText(/before Fall 2026-2027/i);
    await expect(guide).toContainText(/Fall 2026-2027 or later/i);

    for (const viewport of [
      { width: 320, height: 568 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await guide.locator(':scope > :last-child').scrollIntoViewIfNeeded();
      const geometry = await dialog.evaluate((overlay) => {
        const modal = overlay.querySelector('.admit-term-help-modal');
        const body = modal.querySelector('.app-modal-body');
        const content = modal.querySelector('#admitTermHelpGuide');
        const last = content.lastElementChild;
        const modalBox = modal.getBoundingClientRect();
        const bodyBox = body.getBoundingClientRect();
        const lastBox = last.getBoundingClientRect();
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

      expect(geometry.modalInViewport, `${viewport.width}px modal containment`).toBe(true);
      expect(geometry.bodyInModal, `${viewport.width}px body containment`).toBe(true);
      expect(geometry.finalContentReachable, `${viewport.width}px content reachability`).toBe(true);
      expect(geometry.contentHorizontalOverflow, `${viewport.width}px content overflow`)
        .toBeLessThanOrEqual(1);
      expect(geometry.bodyHorizontalOverflow, `${viewport.width}px body overflow`)
        .toBeLessThanOrEqual(1);
      expect(geometry.documentHorizontalOverflow, `${viewport.width}px document overflow`)
        .toBeLessThanOrEqual(1);
    }
  });
});
