'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');
const plans = require('../fixtures/passing-plans-multiterm.json');

// Characterization of the ALLOCATION's DOM rendering — the .course_type labels
// and the per-semester total-credit text. No spec asserted these before (the
// graduation/allocation specs all read the effective_type MODEL, never the
// rendered DOM), yet the upcoming domain/UI split moves exactly this rendering
// out of recalcEffectiveTypes()/…Double(). These pin the render contract as a
// general invariant — derived from the model, not hard-coded values — so the
// separation must reproduce it.

const TERM = '202301';
const TERM_NAME = 'Fall 2023-2024';

// For every modelled course: its rendered .course_type (whole-span text/class and
// the dual ct-main/ct-dm parts) plus the model fields the render derives from.
const readCourseLabels = (page) => page.evaluate(() => {
  const out = [];
  (window.curriculum.semesters || []).forEach((s) => (s.courses || []).forEach((c) => {
    if (!c || !c.id) return;
    const el = document.getElementById(c.id);
    const t = el && el.querySelector('.course_type');
    if (!t) return;
    const main = t.querySelector('.ct-main');
    const dm = t.querySelector('.ct-dm');
    out.push({
      code: c.code,
      effective_type: c.effective_type,
      category: c.category,
      effective_type_dm: c.effective_type_dm,
      categoryDM: c.categoryDM,
      text: t.textContent.trim(),
      overflowWhole: t.classList.contains('is-overflow-type'),
      mainPart: main ? { text: main.textContent.trim(), overflow: main.classList.contains('is-overflow-type') } : null,
      dmPart: dm ? { text: dm.textContent.trim(), overflow: dm.classList.contains('is-overflow-type') } : null,
    });
  }));
  return out;
});

const upper = (v) => ((v || '').toLowerCase() === 'none' ? 'N/A' : (v || '').toUpperCase());
const movedDown = (base, eff) => {
  const b = (base || '').toLowerCase();
  const e = (eff || '').toLowerCase();
  return !!(b && e && b !== e && e !== 'none');
};

const seedSingle = (page, major) => seedPlan(page, {
  major, entryTerm: TERM_NAME,
  curriculum: [plans[TERM][major]], grades: [plans[TERM][major].map(() => 'A')], dates: [TERM_NAME],
});

test.describe('allocation render contract — single major', () => {
  test('course_type text and overflow class are derived from the model', async ({ page }) => {
    await seedSingle(page, 'CS');
    const labels = await readCourseLabels(page);
    expect(labels.length, 'courses rendered').toBeGreaterThan(0);
    for (const c of labels) {
      expect(c.text, `${c.code} label text`).toBe(upper(c.effective_type));
      expect(c.overflowWhole, `${c.code} overflow class`).toBe(movedDown(c.category, c.effective_type));
    }
  });

  test('per-semester total-credit text and overlimit class', async ({ page }) => {
    await seedSingle(page, 'CS');
    const totals = await page.evaluate(() => {
      const out = [];
      (window.curriculum.semesters || []).forEach((s) => {
        let p = document.getElementById(s.id);
        while (p && !(p.classList && p.classList.contains('container_semester'))) p = p.parentElement;
        const span = p && p.querySelector('.total_credit_text span');
        if (!span) return;
        out.push({ total: s.totalCredit, text: span.textContent.trim(), overlimit: span.classList.contains('is-overlimit') });
      });
      return out;
    });
    expect(totals.length, 'semesters rendered').toBeGreaterThan(0);
    for (const s of totals) {
      expect(s.text).toBe(`Total: ${s.total} credits`);
      expect(s.overlimit).toBe((s.total || 0) > 20);
    }
  });
});

test.describe('allocation render contract — double major (dual labels)', () => {
  test('ct-main / ct-dm parts follow both allocations; whole-span class cleared', async ({ page }) => {
    // A neutral main major (MAN) with VACD as the double major, seeded with the
    // VACD plan — same setup dm-vacd-core-pools.spec uses to exercise the DM pass.
    await seedPlan(page, {
      major: 'MAN', entryTerm: TERM_NAME, doubleMajor: 'VACD', entryTermDM: TERM_NAME,
      curriculum: [plans[TERM].VACD], grades: [plans[TERM].VACD.map(() => 'A')], dates: [TERM_NAME],
    });
    const dual = (await readCourseLabels(page)).filter((c) => c.mainPart && c.dmPart);
    expect(dual.length, 'some courses render dual MAIN/DM labels').toBeGreaterThan(0);
    for (const c of dual) {
      expect(c.mainPart.text, `${c.code} main part`).toBe(upper(c.effective_type));
      expect(c.dmPart.text, `${c.code} dm part`).toBe(upper(c.effective_type_dm));
      expect(c.mainPart.overflow, `${c.code} main overflow`).toBe(movedDown(c.category, c.effective_type));
      expect(c.dmPart.overflow, `${c.code} dm overflow`).toBe(movedDown(c.categoryDM, c.effective_type_dm));
      // Dual labels colour per part, so the wrapping span carries no overflow class.
      expect(c.overflowWhole, `${c.code} whole-span overflow cleared`).toBe(false);
    }
  });
});
