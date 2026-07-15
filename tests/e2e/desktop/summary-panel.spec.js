'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');
const { seedGradPlan } = require('../helpers/passing-plan');

// displaySummary() — the progress view behind the "Summary" button, and the
// screen students actually read to see where they stand. ~900 lines of
// graduation_check.js with no coverage until now.
//
// The assertion that matters is that it AGREES WITH THE ENGINE. The summary
// renders its own card from `sem.total*` and its own requirement lookup
// (lookupReq), separate from the one canGraduate uses (getReq) — and this
// codebase's recurring bug has been two parallel implementations of one rule
// drifting apart. A summary that quietly disagreed with the graduation check
// would be worse than either being wrong alone: the student would be told two
// different things.
//
// Frozen term 202401.
const TERM_NAME = 'Fall 2024-2025';
const ROOT = path.resolve(__dirname, '..', '..', '..');
const REQS = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, 'requirements', '202401.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l)).map((d) => [d.major, d]),
);

const openSummary = async (page) => {
  await page.locator('.summary').click();
  const overlay = page.locator('.summary_modal_overlay');
  await expect(overlay).toBeVisible({ timeout: 10000 });
  return overlay;
};

// The card is 10 rows of "Label: value / limit". Parse them back out so the
// test reads what the student reads, not an internal.
const readCard = (page) => page.evaluate(() => {
  const card = document.querySelector('.summary_modal');
  if (!card) return null;
  const rows = {};
  card.querySelectorAll('.summary_modal_child p').forEach((p) => {
    const m = /^(.+?):\s*([\d.]+)\s*\/\s*([\d.]+)$/.exec((p.textContent || '').trim());
    if (m) rows[m[1].trim()] = { value: Number(m[2]), limit: Number(m[3]) };
  });
  return { title: (card.querySelector('.summary_modal_title') || {}).textContent || '', rows };
});

const modelTotals = (page) => page.evaluate(() => {
  const s = window.curriculum.semesters;
  const sum = (f) => s.reduce((a, x) => a + (x[f] || 0), 0);
  const gpaCredits = sum('totalGPACredits');
  return {
    total: sum('totalCredit'),
    ects: sum('totalECTS'),
    university: sum('totalUniversity'),
    required: sum('totalRequired'),
    core: sum('totalCore'),
    area: sum('totalArea'),
    free: sum('totalFree'),
    science: sum('totalScience'),
    engineering: sum('totalEngineering'),
    gpa: gpaCredits ? Number((sum('totalGPA') / gpaCredits).toFixed(3)) : 0,
  };
});

test.describe('summary panel', () => {
  test('every metric shown matches the engine model and the requirement limits', async ({ page }) => {
    await seedGradPlan(page, {});
    await openSummary(page);

    const card = await readCard(page);
    const model = await modelTotals(page);
    const req = REQS.CS;

    expect(card, 'the summary card should render').not.toBeNull();
    expect(card.title).toContain('Computer Science');

    // The values the student reads must be the engine's own numbers — not a
    // second, independently-derived set.
    const pairs = [
      ['SU Credits', model.total, req.total],
      ['ECTS', model.ects, req.ects],
      ['University', model.university, req.university],
      ['Required', model.required, req.required],
      ['Core', model.core, req.core],
      ['Area', model.area, req.area],
      ['Free', model.free, req.free],
      ['Basic Science', model.science, req.science],
      ['Engineering', model.engineering, req.engineering],
    ];
    for (const [label, value, limit] of pairs) {
      expect(card.rows[label], `the card should have a "${label}" row`).toBeTruthy();
      expect(card.rows[label].value, `${label} value should match the model`).toBeCloseTo(value, 2);
      expect(card.rows[label].limit, `${label} limit should match requirements/202401`).toBe(limit);
    }
    expect(card.rows.GPA.value, 'GPA should match the model').toBeCloseTo(model.gpa, 2);
    expect(card.rows.GPA.limit, 'GPA is out of 4.00').toBe(4);
  });

  test('the summary agrees with the graduation check about what is met', async ({ page }) => {
    // A complete plan: canGraduate returns 0, so EVERY metric on the card must
    // be at or above its limit. If the two ever disagree the student is told
    // two different things at once.
    await seedGradPlan(page, {});
    expect(await page.evaluate(() => window.curriculum.canGraduate()), 'the plan should graduate').toBe(0);

    await openSummary(page);
    const card = await readCard(page);
    for (const [label, row] of Object.entries(card.rows)) {
      if (label === 'GPA') continue; // 4.00 is the scale, not a threshold
      expect(row.value, `${label} (${row.value}/${row.limit}) must be met on a graduating plan`)
        .toBeGreaterThanOrEqual(row.limit);
    }
  });

  test('an incomplete plan shows the shortfall rather than hiding it', async ({ page }) => {
    // Drop the internship + a required course; the card must reflect the gap.
    await seedGradPlan(page, { drop: ['CS395', 'CS201'] });
    await openSummary(page);
    const card = await readCard(page);
    const model = await modelTotals(page);

    expect(card.rows.Required.value, 'Required should drop with CS201 gone').toBeCloseTo(model.required, 2);
    expect(card.rows['SU Credits'].value).toBeCloseTo(model.total, 2);
  });

  test('clicking Summary again closes the panel rather than stacking one', async ({ page }) => {
    // A document-level handler removes the overlay on any click outside the
    // card — and the Summary button is outside it. So the button toggles.
    await seedGradPlan(page, {});
    await openSummary(page);
    await expect(page.locator('.summary_modal')).toHaveCount(1);

    await page.locator('.summary').click({ force: true });
    await expect(page.locator('.summary_modal'), 'the second click should close it').toHaveCount(0);
  });

  test('displaySummary is guarded against building a second card', async ({ page }) => {
    // The toggle above means the button alone can never exercise the guard, so
    // call the global directly — twice, with the panel already open. It bails on
    // an existing .summary_modal. Without that, any re-entry (a re-render, a
    // second caller) would silently double every card.
    await seedGradPlan(page, {});
    await openSummary(page);

    await page.evaluate(() => {
      window.displaySummary(window.curriculum, window.curriculum.major);
      window.displaySummary(window.curriculum, window.curriculum.major);
    });
    await expect(page.locator('.summary_modal'), 're-entry must not stack cards').toHaveCount(1);
    await expect(page.locator('.summary_modal_overlay'), 'nor stack overlays').toHaveCount(1);
  });

  test('"View detailed summary" opens the pool breakdown, and back returns', async ({ page }) => {
    await seedGradPlan(page, {});
    const overlay = await openSummary(page);

    await overlay.locator('.summary_detail_btn').first().click();
    const panel = overlay.locator('.summary_major_panel');
    await expect(panel, 'the detail panel should open').not.toHaveClass(/is-hidden/);
    await expect(overlay.locator('.summary_cards_row'), 'the overview should hide').toHaveClass(/is-hidden/);

    await panel.locator('.summary_back_btn').first().click();
    await expect(panel, 'back should hide the detail panel').toHaveClass(/is-hidden/);
    await expect(overlay.locator('.summary_cards_row'), 'back should restore the overview').not.toHaveClass(/is-hidden/);
  });

  test('a double major renders a second card with its own limits', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: TERM_NAME,
      doubleMajor: 'ME',
      entryTermDM: TERM_NAME,
      curriculum: [['CS201', 'ME201']],
      grades: [['A', 'A']],
      dates: [TERM_NAME],
    });
    await openSummary(page);

    await expect(page.locator('.summary_modal'), 'one card per program').toHaveCount(2);
    const limits = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('.summary_modal').forEach((card) => {
        const row = [...card.querySelectorAll('.summary_modal_child p')]
          .find((p) => (p.textContent || '').startsWith('Required:'));
        const m = row ? /\/\s*([\d.]+)/.exec(row.textContent) : null;
        out.push(m ? Number(m[1]) : null);
      });
      return out;
    });
    // Each card must use ITS OWN major's requirements — CS 29 vs ME 45. Sharing
    // one limit across both is the obvious way for this to break.
    expect(limits.sort((a, b) => a - b), 'CS and ME required limits').toEqual([REQS.CS.required, REQS.ME.required].sort((a, b) => a - b));
  });
});
