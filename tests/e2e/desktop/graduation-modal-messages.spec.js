'use strict';

const { test, expect } = require('../fixtures');
const { seedGradPlan } = require('../helpers/passing-plan');

// The graduation modal (displayGraduationResults) is the integration point
// between the flag engine and what a student actually reads: it takes
// canGraduate()'s flag, looks up buildFlagMessages(major)[flag](), and renders
// it in the card. Both halves were tested in isolation — the flag numbers
// (graduation-branches) and the message strings (buildFlagMessages) — but not
// that the modal wires the RIGHT message to the RIGHT flag.
//
// That wiring is exactly where two real bugs lived: flag 26 named the wrong
// requirement (Physics vs Philosophy), and flag 77 had no message at all, so
// the modal fell back to rendering a bare "Error code 77" at the student. The
// fallback is still in the code — `msg[flag] ? msg[flag]() : ` + "Error code N"
// — so a reachable flag without a message is a live failure mode.
//
// Frozen term 202401, driven from the full CS passing plan.
const openModal = async (page) => {
  await page.locator('.check').click();
  const overlay = page.locator('.graduation_modal_overlay');
  await expect(overlay).toBeVisible({ timeout: 10000 });
  return overlay;
};

const majorMessage = (overlay) => overlay.locator('.graduation_card').first().locator('.graduation_card_message').first();

test.describe('graduation modal messages', () => {
  test('a complete plan shows the pass state, not a reason', async ({ page }) => {
    await seedGradPlan(page, {});
    expect(await page.evaluate(() => window.curriculum.canGraduate()), 'the plan graduates').toBe(0);

    const overlay = await openModal(page);
    await expect(overlay.locator('.graduation_card.is-complete').first()).toBeVisible();
    await expect(majorMessage(overlay)).toContainText(/pass/i);
  });

  // Each row: a drop that produces a known flag (verified in
  // graduation-branches), and the human message that flag must render.
  const cases = [
    { name: 'missing internship (flag 4) names the internship course', drop: ['CS395'], expect: /CS395/ },
    { name: 'missing SPS303 (flag 11) names SPS303', drop: ['SPS303'], expect: /SPS303/ },
    { name: 'required short (flag 2) talks about Required credits', drop: ['CS301'], expect: /required/i },
  ];

  for (const c of cases) {
    test(c.name, async ({ page }) => {
      await seedGradPlan(page, { drop: c.drop });
      const overlay = await openModal(page);
      const msg = majorMessage(overlay);

      await expect(overlay.locator('.graduation_card.is-incomplete').first()).toBeVisible();
      await expect(msg).toHaveText(c.expect);
      // The regression guard that matters most: never the raw fallback.
      await expect(msg, 'the modal must never render a bare "Error code N"').not.toHaveText(/Error code/i);
    });
  }

  test('a low CGPA (flag 38) shows the GPA message', async ({ page }) => {
    await seedGradPlan(page, { grade: 'D' });
    const overlay = await openModal(page);
    await expect(majorMessage(overlay)).toContainText(/GPA/i);
  });

  test('no reachable flag renders as "Error code N"', async ({ page }) => {
    // Sweep several incomplete plans and assert none of them produce the raw
    // fallback — i.e. every flag the engine can actually return has a message.
    // This is the general form of the flag-77 bug.
    for (const drop of [['CS395'], ['SPS303'], ['CS301'], ['HUM201', 'HUM202']]) {
      // seedGradPlan reloads the page, so each iteration starts fresh and the
      // prior modal is gone with the navigation — no explicit close needed.
      await seedGradPlan(page, { drop });
      const overlay = await openModal(page);
      await expect(
        majorMessage(overlay),
        `plan missing ${drop.join(', ')} rendered a raw error code`,
      ).not.toHaveText(/Error code/i);
    }
  });
});
