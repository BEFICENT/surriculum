'use strict';

const { test, expect } = require('../fixtures');

async function installMobileProgressProbes(page) {
  await page.evaluate(() => {
    const host = document.createElement('div');
    host.id = 'mobile-theme-test-probes';
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'position:fixed;left:-10000px;top:0;';
    host.innerHTML = `
      <div class="m-progress">
        <div class="m-prog-breakdown">
          <span class="is-current">Current</span>
          <span class="is-future">Future</span>
          <span class="is-unverified">Unverified</span>
        </div>
        <div class="m-prog-bar">
          <span class="m-prog-fill is-earned"></span>
          <span class="m-prog-fill is-current"></span>
          <span class="m-prog-fill is-future"></span>
          <span class="m-prog-fill is-unverified"></span>
        </div>
      </div>`;
    document.body.appendChild(host);
  });
}

async function waitForThemePaint(page) {
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
}

async function readMobileProgressPalette(page) {
  return page.evaluate(() => {
    const color = (selector) => getComputedStyle(document.querySelector(selector)).color;
    const background = (selector) => getComputedStyle(document.querySelector(selector)).backgroundColor;
    return {
      currentText: color('.m-prog-breakdown .is-current'),
      futureText: color('.m-prog-breakdown .is-future'),
      unverifiedText: color('.m-prog-breakdown .is-unverified'),
      earnedFill: background('.m-prog-fill.is-earned'),
      currentFill: background('.m-prog-fill.is-current'),
      futureFill: background('.m-prog-fill.is-future'),
      unverifiedFill: background('.m-prog-fill.is-unverified'),
    };
  });
}

test('mobile theme switching preserves mobile shell state and progress colors', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  await page.waitForFunction(() => !!window.SURRICULUM_THEMES);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('body')).toHaveClass(/is-mobile/);
  await expect(page.locator('body')).toHaveAttribute('data-mobile-tab', 'planner');

  await installMobileProgressProbes(page);
  await waitForThemePaint(page);
  expect(await readMobileProgressPalette(page)).toEqual({
    currentText: 'rgb(37, 99, 235)',
    futureText: 'rgb(124, 58, 237)',
    unverifiedText: 'rgb(180, 83, 9)',
    earnedFill: 'rgb(22, 163, 74)',
    currentFill: 'rgb(37, 99, 235)',
    futureFill: 'rgb(124, 58, 237)',
    unverifiedFill: 'rgb(217, 119, 6)',
  });

  await page.evaluate(() => document.body.classList.add('theme-test-sentinel'));
  await page.locator('#headerMore').click();
  await expect(page.locator('#themeToggle')).toBeVisible();
  await page.locator('#themeToggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await waitForThemePaint(page);

  await expect(page.locator('body')).toHaveClass(/is-mobile/);
  await expect(page.locator('body')).toHaveClass(/theme-test-sentinel/);
  await expect(page.locator('body')).toHaveAttribute('data-mobile-tab', 'planner');
  await expect.poll(() => readMobileProgressPalette(page)).toEqual({
    currentText: 'rgb(96, 165, 250)',
    futureText: 'rgb(196, 181, 253)',
    unverifiedText: 'rgb(251, 191, 36)',
    earnedFill: 'rgb(22, 163, 74)',
    currentFill: 'rgb(37, 99, 235)',
    futureFill: 'rgb(124, 58, 237)',
    unverifiedFill: 'rgb(217, 119, 6)',
  });
});
