'use strict';

const { test, expect } = require('../fixtures');

const SUIS_ADMIT_TERM_PATH = 'SUIS → Student Records → General Student Information';

async function openMobileHelp(page) {
  await page.locator('.m-nav-item[data-mtab="controls"]').click();
  await expect(page.locator('body')).toHaveAttribute('data-mobile-tab', 'controls');

  const helpGroup = page.locator('.sidebar-content > .control-group.control-group-help');
  await expect(page.locator('.sidebar-content > .control-group').last())
    .toHaveClass(/control-group-help/);

  const opener = helpGroup.getByRole('button', { name: 'Help & information' });
  await opener.scrollIntoViewIfNeeded();
  await expect(opener).toBeVisible();
  await opener.click();

  const dialog = page.getByRole('dialog', { name: 'Help & information' });
  await expect(dialog).toBeVisible();
  return { opener, dialog };
}

test.describe('Help & information (mobile)', () => {
  test('is reachable from Controls and keeps every help topic available', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/');
    const { dialog } = await openMobileHelp(page);
    const guide = dialog.locator('#helpInfoGuide');

    await expect(dialog.getByRole('navigation', { name: 'Help topics' })).toBeVisible();
    for (const id of [
      'help-getting-started',
      'help-planner',
      'help-scheduler',
      'help-progress',
      'help-data',
      'help-about',
    ]) {
      await expect(guide.locator(`#${id}`)).toHaveCount(1);
      await expect(dialog.locator(`a.help-info-nav-link[href="#${id}"]`)).toHaveCount(1);
    }
    await expect(guide.locator('.help-info-disclaimer')).toContainText(/verify/i);
    await expect(guide.locator('.help-info-disclaimer')).toContainText(/official/i);
    await expect(guide.locator('#help-getting-started')).toContainText(SUIS_ADMIT_TERM_PATH);
    await expect(guide.locator('a[href="mailto:bilal.gebenoglu@sabanciuniv.edu"]')).toBeVisible();

    await dialog.locator('a.help-info-nav-link[href="#help-about"]').click();
    await expect.poll(async () => guide.locator('#help-about').evaluate((section, root) => {
      const sectionBox = section.getBoundingClientRect();
      const guideBox = root.getBoundingClientRect();
      return sectionBox.top < guideBox.bottom && sectionBox.bottom > guideBox.top;
    }, await guide.elementHandle())).toBe(true);
  });

  test('contains the modal without horizontal overflow at 320px and 390px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/');
    const { dialog } = await openMobileHelp(page);

    for (const viewport of [
      { width: 320, height: 568 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      await dialog.locator('#help-about').scrollIntoViewIfNeeded();
      const geometry = await dialog.evaluate((overlay) => {
        const modal = overlay.querySelector('.help-info-modal');
        const body = modal.querySelector('.app-modal-body');
        const guide = modal.querySelector('.help-info-guide');
        const lastSection = guide.querySelector('#help-about');
        const rect = (element) => element.getBoundingClientRect();
        const modalBox = rect(modal);
        const bodyBox = rect(body);
        const lastBox = rect(lastSection);
        return {
          modalInViewport: modalBox.left >= -1 && modalBox.right <= window.innerWidth + 1
            && modalBox.top >= -1 && modalBox.bottom <= window.innerHeight + 1,
          lastSectionReachable: lastBox.top < bodyBox.bottom && lastBox.bottom > bodyBox.top,
          guideHorizontalOverflow: guide.scrollWidth - guide.clientWidth,
          bodyHorizontalOverflow: body.scrollWidth - body.clientWidth,
          documentHorizontalOverflow:
            document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });
      expect(geometry.modalInViewport, `${viewport.width}px modal containment`).toBe(true);
      expect(geometry.lastSectionReachable, `${viewport.width}px final topic reachability`).toBe(true);
      expect(geometry.guideHorizontalOverflow, `${viewport.width}px guide overflow`).toBeLessThanOrEqual(1);
      expect(geometry.bodyHorizontalOverflow, `${viewport.width}px body overflow`).toBeLessThanOrEqual(1);
      expect(geometry.documentHorizontalOverflow, `${viewport.width}px document overflow`).toBeLessThanOrEqual(1);
    }
  });
});
