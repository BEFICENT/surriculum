'use strict';

const { test, expect } = require('../fixtures');

const SUIS_ADMIT_TERM_PATH = 'SUIS → Student Records → General Student Information';

const HELP_SECTIONS = [
  ['help-getting-started', 'Getting started', 'Getting started'],
  ['help-planner', 'Using the planner', 'Using the planner'],
  ['help-scheduler', 'Building a schedule', 'Building a schedule'],
  ['help-progress', 'Progress & credits', 'Progress & credits'],
  ['help-data', 'Plans, imports & privacy', 'Plans, imports & privacy'],
  ['help-about', 'Contact & project credits', 'Contact & credits'],
];

async function openHelp(page) {
  const opener = page.getByRole('button', { name: 'Help & information' });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Help & information' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.help-info-modal')).toBeVisible();
  return { opener, dialog };
}

test.describe('Help & information (desktop)', () => {
  test('is the final sidebar action and provides navigable user guidance', async ({ page }) => {
    await page.goto('/');

    const helpGroup = page.locator('.sidebar-content > .control-group.control-group-help');
    await expect(helpGroup).toHaveCount(1);
    await expect(helpGroup.locator('#openHelpInfoButton')).toHaveAccessibleName('Help & information');
    await expect(page.locator('.sidebar-content > .control-group').last())
      .toHaveClass(/control-group-help/);

    const { dialog } = await openHelp(page);
    const guide = dialog.locator('#helpInfoGuide.help-info-guide');
    await expect(guide).toBeVisible();

    const nav = dialog.getByRole('navigation', { name: 'Help topics' });
    await expect(nav).toBeVisible();
    for (const [id, headingName, navName] of HELP_SECTIONS) {
      const section = guide.locator(`#${id}`);
      await expect(section).toHaveCount(1);
      await expect(section.getByRole('heading', { name: headingName, exact: true })).toBeVisible();
      await expect(nav.locator(`a.help-info-nav-link[href="#${id}"]`))
        .toHaveAccessibleName(navName);
    }

    await expect(guide.locator('.help-info-disclaimer')).toContainText(/verify/i);
    await expect(guide.locator('.help-info-disclaimer')).toContainText(/official/i);
    await expect(guide.locator('#help-getting-started')).toContainText(SUIS_ADMIT_TERM_PATH);
    const contact = guide.locator('a[href^="mailto:"]');
    await expect(contact).toHaveAttribute('href', 'mailto:bilal.gebenoglu@sabanciuniv.edu');
    await expect(contact).toHaveAccessibleName(/bilal\.gebenoglu@sabanciuniv\.edu/i);

    const credits = guide.locator('#help-about');
    const projectLink = credits.locator('a[href^="https://"]');
    expect(await projectLink.count()).toBeGreaterThan(0);
    for (const link of await projectLink.all()) {
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', /noopener/);
    }

    const plannerLink = nav.locator('a[href="#help-planner"]');
    await plannerLink.click();
    await expect.poll(async () => guide.locator('#help-planner').evaluate((section, root) => {
      const sectionBox = section.getBoundingClientRect();
      const guideBox = root.getBoundingClientRect();
      return sectionBox.top >= guideBox.top - 1 && sectionBox.top < guideBox.bottom;
    }, await guide.elementHandle())).toBe(true);
  });

  test('traps focus and restores the opener after Escape and the close button', async ({ page }) => {
    await page.goto('/');
    const { opener, dialog } = await openHelp(page);
    const close = dialog.getByRole('button', { name: 'Close Help & information' });
    await expect(close).toBeFocused();

    const lastFocusable = dialog.locator(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), '
      + 'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ).last();
    await lastFocusable.focus();
    await page.keyboard.press('Tab');
    await expect(close).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(lastFocusable).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(opener).toBeFocused();

    await opener.click();
    const reopened = page.getByRole('dialog', { name: 'Help & information' });
    await reopened.getByRole('button', { name: 'Close Help & information' }).click();
    await expect(reopened).toHaveCount(0);
    await expect(opener).toBeFocused();
  });

  test('stays contained and internally scrollable on a short desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 420 });
    await page.goto('/');
    const { dialog } = await openHelp(page);
    const guide = dialog.locator('.help-info-guide');
    await guide.locator('#help-about').scrollIntoViewIfNeeded();

    const geometry = await dialog.evaluate((overlay) => {
      const modal = overlay.querySelector('.help-info-modal');
      const body = modal.querySelector('.app-modal-body');
      const guideElement = modal.querySelector('.help-info-guide');
      const lastSection = guideElement.querySelector('#help-about');
      const rect = (element) => element.getBoundingClientRect();
      const insideViewport = (box) => box.left >= -1 && box.right <= window.innerWidth + 1
        && box.top >= -1 && box.bottom <= window.innerHeight + 1;
      const modalBox = rect(modal);
      const bodyBox = rect(body);
      const lastBox = rect(lastSection);
      return {
        modalInViewport: insideViewport(modalBox),
        bodyInModal: bodyBox.left >= modalBox.left - 1 && bodyBox.right <= modalBox.right + 1
          && bodyBox.top >= modalBox.top - 1 && bodyBox.bottom <= modalBox.bottom + 1,
        lastSectionReachable: lastBox.top < bodyBox.bottom && lastBox.bottom > bodyBox.top,
        guideHorizontalOverflow: guideElement.scrollWidth - guideElement.clientWidth,
        bodyHorizontalOverflow: body.scrollWidth - body.clientWidth,
        documentHorizontalOverflow:
          document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });

    expect(geometry).toMatchObject({
      modalInViewport: true,
      bodyInModal: true,
      lastSectionReachable: true,
    });
    expect(geometry.guideHorizontalOverflow).toBeLessThanOrEqual(1);
    expect(geometry.bodyHorizontalOverflow).toBeLessThanOrEqual(1);
    expect(geometry.documentHorizontalOverflow).toBeLessThanOrEqual(1);
  });
});
