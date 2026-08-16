'use strict';

const { test, expect } = require('../fixtures');

const LIGHT_PALETTE = {
  body: ['rgb(30, 41, 59)', 'rgb(248, 250, 252)'],
  header: ['linear-gradient(135deg, rgb(13, 71, 161) 0%, rgb(25, 118, 210) 100%)'],
  headerTitle: ['rgb(255, 255, 255)'],
  primary: ['rgb(255, 255, 255)', 'rgb(13, 71, 161)'],
  secondary: ['rgb(71, 85, 105)', 'rgb(255, 255, 255)', 'rgb(226, 232, 240)'],
  danger: ['rgb(255, 255, 255)', 'rgb(220, 38, 38)'],
  warning: ['rgb(17, 24, 39)', 'rgb(245, 158, 11)'],
  legacyDestructive: ['rgb(255, 255, 255)', 'rgb(255, 0, 0)'],
  programComplete: ['rgb(21, 128, 61)', 'rgba(22, 163, 74, 0.13)'],
  programProgress: ['rgb(29, 78, 216)', 'rgba(37, 99, 235, 0.12)'],
  programProjected: ['rgb(180, 83, 9)', 'rgba(180, 83, 9, 0.12)'],
  programUnavailable: ['rgb(180, 83, 9)', 'rgba(180, 83, 9, 0.12)'],
  earnedChip: ['rgb(21, 128, 61)', 'rgba(22, 163, 74, 0.1)'],
  currentChip: ['rgb(37, 99, 235)', 'rgba(37, 99, 235, 0.1)'],
  futureChip: ['rgb(124, 58, 237)', 'rgba(124, 58, 237, 0.1)'],
  unverifiedChip: ['rgb(180, 83, 9)', 'rgba(180, 83, 9, 0.1)'],
  unsuccessfulChip: ['rgb(185, 28, 28)', 'rgba(220, 38, 38, 0.1)'],
  earnedSegment: ['rgb(22, 163, 74)'],
  currentSegment: ['rgb(37, 99, 235)'],
  futureSegment: ['rgb(124, 58, 237)'],
  unverifiedSegment: ['rgb(217, 119, 6)'],
  detailCta: ['rgb(255, 255, 255)', 'rgb(13, 71, 161)', 'rgb(13, 71, 161)'],
};

const DARK_PALETTE = {
  body: ['rgb(241, 245, 249)', 'rgb(15, 23, 42)'],
  header: ['linear-gradient(135deg, rgb(30, 41, 59) 0%, rgb(51, 65, 85) 100%)'],
  headerTitle: ['rgb(255, 255, 255)'],
  primary: ['rgb(255, 255, 255)', 'rgb(59, 130, 246)'],
  secondary: ['rgb(203, 213, 225)', 'rgb(30, 41, 59)', 'rgb(51, 65, 85)'],
  danger: ['rgb(255, 255, 255)', 'rgb(220, 38, 38)'],
  warning: ['rgb(17, 24, 39)', 'rgb(245, 158, 11)'],
  legacyDestructive: ['rgb(255, 255, 255)', 'rgb(255, 0, 0)'],
  programComplete: ['rgb(134, 239, 172)', 'rgba(22, 163, 74, 0.13)'],
  programProgress: ['rgb(147, 197, 253)', 'rgba(37, 99, 235, 0.12)'],
  programProjected: ['rgb(252, 211, 77)', 'rgba(180, 83, 9, 0.12)'],
  programUnavailable: ['rgb(252, 211, 77)', 'rgba(180, 83, 9, 0.12)'],
  earnedChip: ['rgb(74, 222, 128)', 'rgba(22, 163, 74, 0.1)'],
  currentChip: ['rgb(96, 165, 250)', 'rgba(37, 99, 235, 0.1)'],
  futureChip: ['rgb(196, 181, 253)', 'rgba(124, 58, 237, 0.1)'],
  unverifiedChip: ['rgb(251, 191, 36)', 'rgba(180, 83, 9, 0.1)'],
  unsuccessfulChip: ['rgb(248, 113, 113)', 'rgba(220, 38, 38, 0.1)'],
  earnedSegment: ['rgb(22, 163, 74)'],
  currentSegment: ['rgb(37, 99, 235)'],
  futureSegment: ['rgb(124, 58, 237)'],
  unverifiedSegment: ['rgb(217, 119, 6)'],
  detailCta: ['rgb(255, 255, 255)', 'rgb(29, 78, 216)', 'rgb(29, 78, 216)'],
};

async function installThemeProbes(page) {
  await page.evaluate(() => {
    const host = document.createElement('div');
    host.id = 'theme-test-probes';
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'position:fixed;left:-10000px;top:0;';
    host.innerHTML = `
      <button data-probe="primary" class="btn btn-primary">Primary</button>
      <button data-probe="secondary" class="btn btn-secondary">Secondary</button>
      <button data-probe="danger" class="btn btn-danger">Danger</button>
      <button data-probe="warning" class="btn btn-warning">Warning</button>
      <span class="summary_program_status is-complete">Complete</span>
      <span class="summary_program_status is-progress">In progress</span>
      <span class="summary_program_status is-projected">Projected</span>
      <span class="summary_program_status is-unavailable">Unavailable</span>
      <div class="major-summary">
        <span class="ms-state-chip is-earned">Earned</span>
        <span class="ms-state-chip is-current">Current</span>
        <span class="ms-state-chip is-future">Future</span>
        <span class="ms-state-chip is-unverified">Unverified</span>
        <span class="ms-state-chip is-unsuccessful">Unsuccessful</span>
      </div>
      <span class="summary_segment is-earned"></span>
      <span class="summary_segment is-current"></span>
      <span class="summary_segment is-future"></span>
      <span class="summary_segment is-unverified"></span>
      <div class="summary_program_card_footer">
        <button class="summary_detail_btn">View requirement details</button>
      </div>`;
    document.body.appendChild(host);
  });
}

async function waitForThemePaint(page) {
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
}

async function readPalette(page) {
  return page.evaluate(() => {
    const styles = (selector) => getComputedStyle(document.querySelector(selector));
    const colorAndBackground = (selector) => {
      const value = styles(selector);
      return [value.color, value.backgroundColor];
    };
    const background = (selector) => [styles(selector).backgroundColor];
    const colorBackgroundBorder = (selector) => {
      const value = styles(selector);
      return [value.color, value.backgroundColor, value.borderTopColor];
    };
    return {
      body: colorAndBackground('body'),
      header: [styles('.header').backgroundImage],
      headerTitle: [styles('.header-title').color],
      primary: colorAndBackground('[data-probe="primary"]'),
      secondary: colorBackgroundBorder('[data-probe="secondary"]'),
      danger: colorAndBackground('[data-probe="danger"]'),
      warning: colorAndBackground('[data-probe="warning"]'),
      legacyDestructive: colorAndBackground('.deleteCustom'),
      programComplete: colorAndBackground('.summary_program_status.is-complete'),
      programProgress: colorAndBackground('.summary_program_status.is-progress'),
      programProjected: colorAndBackground('.summary_program_status.is-projected'),
      programUnavailable: colorAndBackground('.summary_program_status.is-unavailable'),
      earnedChip: colorAndBackground('.ms-state-chip.is-earned'),
      currentChip: colorAndBackground('.ms-state-chip.is-current'),
      futureChip: colorAndBackground('.ms-state-chip.is-future'),
      unverifiedChip: colorAndBackground('.ms-state-chip.is-unverified'),
      unsuccessfulChip: colorAndBackground('.ms-state-chip.is-unsuccessful'),
      earnedSegment: background('.summary_segment.is-earned'),
      currentSegment: background('.summary_segment.is-current'),
      futureSegment: background('.summary_segment.is-future'),
      unverifiedSegment: background('.summary_segment.is-unverified'),
      detailCta: colorBackgroundBorder('.summary_detail_btn'),
    };
  });
}

test.describe('theme contract (desktop)', () => {
  test('manual switching preserves shell classes, colors, event detail, and persistence', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.addInitScript(() => {
      window.__themeEvents = [];
      window.addEventListener('themeChanged', (event) => {
        window.__themeEvents.push(event.detail);
      });
    });
    await page.goto('/');
    await page.waitForFunction(() => !!window.SURRICULUM_THEMES);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    const registryIds = await page.evaluate(() => {
      const registry = window.SURRICULUM_THEMES;
      if (Array.isArray(registry)) {
        return registry.map((entry) => typeof entry === 'string'
          ? entry
          : (entry.id || entry.value || entry.name));
      }
      return Object.entries(registry).map(([key, entry]) => typeof entry === 'string'
        ? entry
        : (entry.id || entry.value || entry.name || key));
    });
    expect(new Set(registryIds).size).toBe(registryIds.length);
    expect(registryIds).toEqual(expect.arrayContaining(['light', 'dark']));

    await installThemeProbes(page);
    await waitForThemePaint(page);
    expect(await readPalette(page)).toEqual(LIGHT_PALETTE);

    await page.evaluate(() => {
      document.body.classList.add('theme-test-sentinel');
      window.__themeEvents.length = 0;
    });
    await page.locator('#themeToggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await waitForThemePaint(page);

    await expect(page.locator('body')).toHaveClass(/theme-test-sentinel/);
    await expect.poll(() => readPalette(page)).toEqual(DARK_PALETTE);
    const switched = await page.evaluate(() => ({
      events: window.__themeEvents,
      stored: window.preferenceStorage.getItem('theme'),
    }));
    expect(switched.events).toEqual([{ theme: 'dark' }]);
    expect(switched.stored).toBe('dark');

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    expect(await page.evaluate(() => window.preferenceStorage.getItem('theme'))).toBe('dark');
  });

  test('an invalid stored theme falls back to the supported system preference', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.addInitScript(() => {
      localStorage.setItem('surriculum.preference.theme', 'not-a-surriculum-theme');
    });
    await page.goto('/');
    await page.waitForFunction(() => !!window.SURRICULUM_THEMES);

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'not-a-surriculum-theme');
    await expect(page.locator('body')).not.toHaveClass(/not-a-surriculum-theme/);
  });
});
