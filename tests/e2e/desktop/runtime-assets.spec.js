'use strict';

const { test, expect } = require('../fixtures');

test('boot-time code, styles, and fonts are same-origin and usable', async ({ page }) => {
  const runtimeRequests = [];
  page.on('request', (request) => {
    if (['script', 'stylesheet', 'font', 'worker'].includes(request.resourceType())) {
      runtimeRequests.push(request.url());
    }
  });

  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);

  const pageOrigin = new URL(page.url()).origin;
  expect(runtimeRequests.length).toBeGreaterThan(10);
  expect(runtimeRequests.every((url) => new URL(url).origin === pageOrigin)).toBe(true);
  expect(runtimeRequests.some((url) => /assets\/vendor\/inter-5\.3\.0/.test(url))).toBe(true);
  expect(runtimeRequests.some((url) => /assets\/vendor\/fontawesome-6\.4\.0/.test(url))).toBe(true);
  expect(await page.evaluate(() => ({
    inter: document.fonts.check('16px "Inter Variable"'),
    icons: document.fonts.check('900 16px "Font Awesome 6 Free"'),
    schedulerIcon: getComputedStyle(
      document.querySelector('#openSchedulerButton i'),
      '::before'
    ).content,
  }))).toEqual({
    inter: true,
    icons: true,
    schedulerIcon: expect.stringMatching(/^".+"$/),
  });
});
