'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');

const PLAN = {
  major: 'CS',
  entryTerm: 'Fall 2024-2025',
  curriculum: [['MATH101', 'MATH102', 'NS101']],
  grades: [['A', 'B', 'A']],
  dates: ['Fall 2024-2025'],
};

test('planner shell, requirements, persistence, and graduation dialog work', async ({
  page,
  browserErrors,
}) => {
  await seedPlan(page, PLAN);

  await expect(page).toHaveTitle('SUrriculum v3.1');
  await expect(page.locator('select.change_major')).toHaveValue('CS');
  await page.waitForFunction(() => (
    Boolean(window.curriculum)
    && window.requirementsStatus?.main?.available === true
  ));

  const math101 = page.locator('.course:has(.course_code:text-is("MATH101"))');
  await math101.locator('.grade').click();
  await page.locator('.grade-option[data-value="B+"]').click();

  // Exercise the synchronous lifecycle save path shared by real tab closes,
  // then prove the persisted planner can be reconstructed in both engines.
  await page.evaluate(() => {
    const event = typeof PageTransitionEvent === 'function'
      ? new PageTransitionEvent('pagehide', { persisted: false })
      : new Event('pagehide');
    window.dispatchEvent(event);
  });
  await page.reload();
  await expect(page.locator('.course:has(.course_code:text-is("MATH101")) .grade'))
    .toHaveText('B+');

  await page.locator('.check').click();
  const dialog = page.locator('.graduation_modal_overlay');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.graduation_card.is-incomplete').first()).toBeVisible();

  expect(browserErrors, browserErrors.join('\n')).toEqual([]);
});
