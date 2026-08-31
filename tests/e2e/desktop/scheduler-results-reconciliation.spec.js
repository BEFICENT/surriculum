'use strict';

const { test, expect } = require('../fixtures');

test.describe('scheduler result reconciliation', () => {
  test('reuses unchanged course cards and replaces only changed cards', async ({ page, browserErrors }) => {
    await page.goto('/');
    await page.waitForFunction(() => typeof window.openSchedulerModal === 'function');
    await page.evaluate(() => {
      window.preferenceStorage.setItem('schedulerCheckPrereqs', 'false');
      window.openSchedulerModal('202403');
    });

    const modal = page.locator('.scheduler-modal');
    const search = modal.locator('.scheduler-search');
    await expect(modal).toBeVisible({ timeout: 15000 });
    await search.fill('MATH101');
    const card = modal.locator('.scheduler-course[data-course="MATH101"]');
    await expect(card).toBeVisible({ timeout: 15000 });

    await page.evaluate(() => {
      const current = document.querySelector('.scheduler-course[data-course="MATH101"]');
      window.__schedulerReconcileCard = current;
      current.__schedulerReconcileMarker = 'preserved';
    });

    // The normalized query and rendered markup are unchanged. The detached
    // parse can be discarded and the already-attached course node should stay.
    await search.fill('MATH101 ');
    await page.waitForTimeout(180);
    expect(await page.evaluate(() => {
      const current = document.querySelector('.scheduler-course[data-course="MATH101"]');
      return current === window.__schedulerReconcileCard
        && current.__schedulerReconcileMarker === 'preserved';
    })).toBe(true);

    // Expanding sections changes this card's markup, so only this keyed node is
    // replaced while the delegated result-list interaction remains functional.
    await card.locator('.scheduler-course-actions > .scheduler-sections-toggle').click();
    await expect(card.locator(':scope > .scheduler-inline-sections .scheduler-inline-section-row').first())
      .toBeVisible();
    expect(await page.evaluate(() => (
      document.querySelector('.scheduler-course[data-course="MATH101"]')
        !== window.__schedulerReconcileCard
    ))).toBe(true);

    expect(browserErrors, browserErrors.join('\n')).toEqual([]);
  });

  test('load more extends the keyed page and a new search resets its limit', async ({ page, browserErrors }) => {
    await page.goto('/');
    await page.waitForFunction(() => typeof window.openSchedulerModal === 'function');
    await page.evaluate(() => {
      window.hideTakenCourses = false;
      window.sortBasedOnScore = false;
      window.preferenceStorage.setItem('hideTakenCourses', 'false');
      window.preferenceStorage.setItem('sortBasedOnScore', 'false');
      window.preferenceStorage.setItem('schedulerCheckPrereqs', 'false');
      window.openSchedulerModal('202403');
    });

    const modal = page.locator('.scheduler-modal');
    const cards = modal.locator('.scheduler-course');
    const loadMore = modal.locator('.scheduler-load-more');
    const search = modal.locator('.scheduler-search');
    await expect(modal).toBeVisible({ timeout: 15000 });
    await expect(cards).toHaveCount(60, { timeout: 15000 });
    await expect(loadMore).toBeVisible();

    await page.evaluate(() => {
      const first = document.querySelector('.scheduler-course');
      window.__schedulerFirstPagedCard = first;
      first.__schedulerPagedMarker = 'preserved';
    });
    await loadMore.click();
    await expect.poll(() => cards.count()).toBeGreaterThan(60);
    expect(await page.evaluate(() => {
      const first = document.querySelector('.scheduler-course');
      return first === window.__schedulerFirstPagedCard
        && first.__schedulerPagedMarker === 'preserved';
    })).toBe(true);

    await search.fill('MATH');
    await expect.poll(() => cards.count()).toBeLessThanOrEqual(60);
    await search.fill('');
    await expect(cards).toHaveCount(60);
    await expect(loadMore).toBeVisible();
    expect(browserErrors, browserErrors.join('\n')).toEqual([]);
  });
});
