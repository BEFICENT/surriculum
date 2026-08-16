'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');
const { CS_PASSING_PLAN, seedGradPlan } = require('../helpers/passing-plan');

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
  const liveTermNames = async (page) => {
    await page.goto('/');
    return page.evaluate(() => {
      const current = String(window.currentTermCode || '');
      const year = Number(current.slice(0, 4));
      const suffix = current.slice(4);
      const pastCode = suffix === '03' ? `${year}02` : (suffix === '02' ? `${year}01` : `${year - 1}03`);
      const futureCode = suffix === '01' ? `${year}02` : (suffix === '02' ? `${year}03` : `${year + 1}01`);
      return { past: window.termCodeToName(pastCode), current: window.currentTermName,
        future: window.termCodeToName(futureCode) };
    });
  };

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

  test('posted grades in the current term count as earned immediately', async ({ page }) => {
    const terms = await liveTermNames(page);
    await seedPlan(page, {
      major: 'CS', entryTerm: 'Fall 2024-2025',
      curriculum: [CS_PASSING_PLAN],
      grades: [CS_PASSING_PLAN.map(() => 'A')],
      dates: [terms.current],
    });

    const progress = await page.evaluate(() => {
      const p = window.curriculum.getGraduationProgress('main');
      return { status: p.status, earnedFlag: p.earnedFlag };
    });
    expect(progress.status).toBe('complete');
    expect(progress.earnedFlag).toBe(0);
    const overlay = await openModal(page);
    await expect(overlay.locator('.graduation_card.is-complete').first()).toBeVisible();
    await expect(overlay.locator('.graduation_status_badge').first()).toHaveText('Complete');
  });

  test('posted low grades in the current term affect GPA and graduation immediately', async ({ page }) => {
    const terms = await liveTermNames(page);
    await seedPlan(page, {
      major: 'CS', entryTerm: 'Fall 2024-2025',
      curriculum: [CS_PASSING_PLAN],
      grades: [CS_PASSING_PLAN.map(() => 'D')],
      dates: [terms.current],
    });

    const result = await page.evaluate(() => {
      const p = window.curriculum.getGraduationProgress('main');
      return {
        status: p.status,
        earnedFlag: p.earnedFlag,
        projectedFlag: p.projectedFlag,
        gpa: p.gpa.value,
        gpaCredits: p.gpa.credits,
        legacyFlag: window.curriculum.canGraduate(),
      };
    });
    expect(result.status).toBe('incomplete');
    expect(result.earnedFlag).toBe(38);
    expect(result.projectedFlag).toBe(38);
    expect(result.gpa).toBe(1);
    expect(result.gpaCredits).toBeGreaterThan(0);
    expect(result.legacyFlag).toBe(38);

    const overlay = await openModal(page);
    await expect(overlay.locator('.graduation_card.is-incomplete').first()).toBeVisible();
    await expect(majorMessage(overlay)).toContainText(/GPA/i);
  });

  test('a complete future plan is projected complete, even with expected grades', async ({ page }) => {
    const terms = await liveTermNames(page);
    await seedPlan(page, {
      major: 'CS', entryTerm: 'Fall 2024-2025',
      curriculum: [CS_PASSING_PLAN],
      // A future expected D must not lower today's actual GPA. Before the
      // time-aware legacy cleanup, canGraduate() incorrectly returned flag 38.
      grades: [CS_PASSING_PLAN.map(() => 'D')],
      dates: [terms.future],
    });

    const progress = await page.evaluate(() => {
      const p = window.curriculum.getGraduationProgress('main');
      return {
        status: p.status,
        projectedFlag: p.projectedFlag,
        total: p.breakdown.total,
        gpaCredits: p.gpa.credits,
        gpaFinite: Number.isFinite(p.gpa.value),
        legacyFlag: window.curriculum.canGraduate(),
      };
    });
    expect(progress.status).toBe('projected');
    expect(progress.projectedFlag).toBe(0);
    expect(progress.gpaCredits).toBe(0);
    expect(progress.gpaFinite).toBe(false);
    expect(progress.legacyFlag).toBe(progress.projectedFlag);
    expect(progress.total.earned).toBe(0);
    expect(progress.total.future).toBeGreaterThan(0);
    const overlay = await openModal(page);
    await expect(overlay.locator('.graduation_card.is-projected').first()).toBeVisible();
    await expect(overlay.locator('.graduation_status_badge').first()).toHaveText('Projected complete');
  });

  test('a minor with no computable CGPA cannot be marked complete', async ({ page }) => {
    const terms = await liveTermNames(page);
    const courses = ['FIN301', 'FIN401', 'FIN402', 'FIN403', 'FIN404', 'ACC301'];
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      minor1: 'FIN-MINOR',
      entryTermMinor1: 'Fall 2024-2025',
      curriculum: [courses],
      grades: [courses.map(() => 'T')],
      dates: [terms.past],
    });

    const allocation = await page.evaluate(() => {
      const fn = window.computeMinorAllocation
        || (typeof computeMinorAllocation === 'function' ? computeMinorAllocation : null);
      const res = fn(window.curriculum, 'FIN-MINOR', {
        progressGpa: window.curriculum.getGraduationProgress('main').gpa,
        isEligible: (course, sem) => window.curriculum.getCourseProgressState(course, sem) === 'earned',
      });
      return { ok: res.ok, gpaOk: res.gpaOk, cgpa: Number.isFinite(res.cgpa) ? res.cgpa : null };
    });
    expect(allocation).toEqual({ ok: false, gpaOk: false, cgpa: null });

    const overlay = await openModal(page);
    const card = overlay.locator('.graduation_card').filter({ hasText: 'Finance Minor' });
    await expect(card).toHaveCount(1);
    await expect(card).toHaveClass(/is-incomplete/);
    await expect(card.locator('.graduation_status_badge')).toHaveText('Incomplete');
    await expect(card).toContainText('CGPA requirement');
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
