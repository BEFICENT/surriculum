'use strict';

const { test, expect } = require('../fixtures');
const { openScheduler } = require('../helpers/scheduler');

async function settleGeometry(page) {
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
}

async function readBlurGeometry(page) {
  return page.evaluate(() => {
    const overlay = document.querySelector('.scheduler-overlay');
    const modal = overlay && overlay.querySelector('.scheduler-modal');
    const bands = overlay ? Array.from(overlay.querySelectorAll('.scheduler-edge-blur')) : [];
    if (!overlay || !modal) return null;

    const rect = (element) => {
      const box = element.getBoundingClientRect();
      return {
        left: box.left,
        top: box.top,
        right: box.right,
        bottom: box.bottom,
        width: box.width,
        height: box.height,
      };
    };
    const modalRect = rect(modal);
    const overlayRect = rect(overlay);
    const bandRects = bands.map((band) => ({
      side: Array.from(band.classList).find((name) => name.startsWith('scheduler-edge-blur--')),
      hidden: band.hidden,
      filter: getComputedStyle(band).backdropFilter,
      rect: rect(band),
    }));
    const visibleArea = bandRects.reduce((sum, band) => (
      sum + (band.hidden ? 0 : band.rect.width * band.rect.height)
    ), 0);
    const intersections = bandRects.map((band) => Math.max(
      0,
      Math.min(band.rect.right, modalRect.right) - Math.max(band.rect.left, modalRect.left),
    ) * Math.max(
      0,
      Math.min(band.rect.bottom, modalRect.bottom) - Math.max(band.rect.top, modalRect.top),
    ));

    return {
      overlayFilter: getComputedStyle(overlay).backdropFilter,
      overlayRect,
      modalRect,
      bands: bandRects,
      visibleArea,
      expectedArea: (overlayRect.width * overlayRect.height) - (modalRect.width * modalRect.height),
      recordedArea: Number(overlay.dataset.schedulerBlurArea),
      intersections,
    };
  });
}

function expectEdgeGeometry(geometry) {
  expect(geometry).not.toBeNull();
  expect(geometry.overlayFilter).toBe('none');
  expect(geometry.bands).toHaveLength(4);
  expect(geometry.bands.map((band) => band.side).sort()).toEqual([
    'scheduler-edge-blur--bottom',
    'scheduler-edge-blur--left',
    'scheduler-edge-blur--right',
    'scheduler-edge-blur--top',
  ]);
  expect(geometry.bands.every((band) => band.hidden || /blur\(/.test(band.filter))).toBe(true);
  // Inline band coordinates are rounded to hundredths of a CSS pixel. Across
  // a viewport perimeter that can accumulate a few dozen square pixels while
  // still being far below one physical pixel of visible edge width.
  const roundingTolerance = Math.max(geometry.overlayRect.width, geometry.overlayRect.height) * 0.1;
  expect(Math.abs(geometry.visibleArea - geometry.expectedArea)).toBeLessThan(roundingTolerance);
  expect(Math.abs(geometry.recordedArea - geometry.expectedArea)).toBeLessThan(1);
  expect(Math.max(...geometry.intersections)).toBeLessThan(1);
}

test.describe('scheduler edge-only backdrop blur', () => {
  test('tracks the live modal rectangle and cleans up without a viewport blur', async ({ page }) => {
    await page.goto('/');
    const modal = await openScheduler(page);
    await settleGeometry(page);

    expectEdgeGeometry(await readBlurGeometry(page));

    await page.setViewportSize({ width: 1040, height: 690 });
    await settleGeometry(page);
    expectEdgeGeometry(await readBlurGeometry(page));

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator('body')).toHaveClass(/\bis-mobile\b/);
    await page.locator('.scheduler-overlay .scheduler-modal').waitFor({ state: 'visible' });
    await expect(modal).toHaveClass(/\bm-scheduler\b/);
    await modal.locator('.scheduler-course').first().waitFor({ state: 'visible' });
    await settleGeometry(page);
    const mobile = await readBlurGeometry(page);
    expect(mobile.overlayFilter).toBe('none');
    expect(mobile.bands).toHaveLength(4);
    expect(mobile.bands.every((band) => band.hidden)).toBe(true);
    expect(mobile.recordedArea).toBe(0);

    await page.setViewportSize({ width: 1040, height: 690 });
    await expect(page.locator('body')).not.toHaveClass(/\bis-mobile\b/);
    await page.locator('.scheduler-overlay .scheduler-modal').waitFor({ state: 'visible' });
    await expect(modal).not.toHaveClass(/\bm-scheduler\b/);
    await modal.locator('.scheduler-course').first().waitFor({ state: 'visible' });
    await settleGeometry(page);
    expectEdgeGeometry(await readBlurGeometry(page));

    await modal.evaluate((element) => element.classList.add('is-fullscreen'));
    await settleGeometry(page);
    const fullscreen = await readBlurGeometry(page);
    expect(fullscreen.bands.every((band) => band.hidden)).toBe(true);
    expect(fullscreen.recordedArea).toBe(0);

    await modal.locator('.scheduler-close').click();
    await expect(page.locator('.scheduler-overlay')).toHaveCount(0);
    await expect(page.locator('.scheduler-edge-blur')).toHaveCount(0);
  });
});
