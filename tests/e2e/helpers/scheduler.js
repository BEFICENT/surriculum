'use strict';

const { expect } = require('@playwright/test');

// Open the scheduler modal and wait for its course list to render.
async function openScheduler(page) {
  await page.evaluate(() => { window.openSchedulerModal(); });
  const modal = page.locator('.scheduler-modal');
  await expect(modal).toBeVisible({ timeout: 15000 });
  await expect(modal.locator('.scheduler-course').first()).toBeVisible({ timeout: 15000 });
  return modal;
}

// Commit a course's first available section in the open scheduler and wait for
// its grid block(s) to render. Corequisite prompts (a second picker with a
// "Skip" button) are skipped so this works uniformly for coreq and non-coreq
// courses. Narrows the search first so pagination can't hide the card.
async function pickCourse(page, code) {
  const modal = page.locator('.scheduler-modal');
  await modal.locator('.scheduler-search').fill(code);

  const card = modal.locator(`.scheduler-course[data-course="${code}"]`);
  await expect(card).toBeVisible({ timeout: 10000 });
  // The pick button carries its own data-course; target the main course's
  // directly (a coreq course also renders a second .scheduler-pick for its
  // recitation inside the same card).
  await modal.locator(`.scheduler-pick[data-course="${code}"]`).first().click();

  const picker = page.locator('.scheduler-picker-modal');
  await expect(picker).toBeVisible({ timeout: 10000 });
  await picker.locator('.scheduler-picker-option').first().click();

  // A corequisite picker may follow (possibly more than one); skip through them
  // until no picker overlay remains.
  for (let i = 0; i < 5; i++) {
    const overlay = page.locator('.scheduler-picker-overlay');
    if (!(await overlay.isVisible().catch(() => false))) break;
    const skip = page.locator('.scheduler-picker-modal button', { hasText: 'Skip' });
    if (await skip.isVisible().catch(() => false)) {
      await skip.click();
    } else {
      await page.locator('.scheduler-picker-modal .scheduler-picker-option').first().click();
    }
  }

  await expect(
    modal.locator(`.scheduler-day-col .scheduler-block[data-course="${code}"]`).first(),
  ).toBeVisible({ timeout: 10000 });
}

// Read every committed grid block's course + rendered background hue (0-360),
// deriving hue from the computed rgb so it reflects the REAL colour function.
async function readBlockHues(page) {
  return page.evaluate(() => {
    function hueOf(bg) {
      const m = String(bg || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (!m) return null;
      const r = +m[1] / 255, g = +m[2] / 255, b = +m[3] / 255;
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
      let h = 0;
      if (d === 0) h = 0;
      else if (mx === r) h = 60 * (((g - b) / d) % 6);
      else if (mx === g) h = 60 * ((b - r) / d + 2);
      else h = 60 * ((r - g) / d + 4);
      if (h < 0) h += 360;
      return Math.round(h);
    }
    const blocks = document.querySelectorAll('.scheduler-modal .scheduler-day-col .scheduler-block');
    return [...blocks].map((b) => ({
      course: b.getAttribute('data-course'),
      hue: hueOf(getComputedStyle(b).backgroundColor),
    }));
  });
}

module.exports = { openScheduler, pickCourse, readBlockHues };
