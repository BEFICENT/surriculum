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
const FALL_TERM = 'Fall 2024-2025';
const SPRING_TERM = 'Spring 2024-2025';
const SUMMER_TERM = 'Summer 2024-2025';

const EIGHT_CREDITS = ['NS101', 'NS102'];
const SIX_CREDITS = ['IF100', 'MATH101'];
const NINE_CREDITS = [...SIX_CREDITS, 'SPS101'];
const TWENTY_CREDITS = ['NS101', 'NS102', 'CS303', 'CS308', 'CS401'];

const seedCreditPlan = (page, term, courses) => seedPlan(page, {
  major: 'CS', entryTerm: FALL_TERM,
  curriculum: [courses], grades: [courses.map(() => 'A')], dates: [term],
});

const addCourseThroughPicker = async (page, code) => {
  const semester = page.locator('.container_semester').first();
  await semester.locator('.addCourse').click();
  await semester.locator('.course_select').fill(code);
  await page.locator(`.course-option[data-code="${code}"]`).first().click();
  await semester.locator('.enter').click();
  await expect(semester.locator(`.course:has(.course_code:text-is("${code}"))`)).toHaveCount(1);
};

const expectAdvisoryOverload = async (total) => {
  await expect(total).toHaveClass(/is-overlimit/);
  await expect(total).toHaveAttribute('data-overload-advisory', 'true');
  await expect(total).toHaveAttribute('title', /approval/i);
  await expect(total).toHaveAttribute('aria-label', /approval/i);
};

const changeFirstSemesterTerm = async (page, from, to) => {
  await page.getByRole('button', { name: `Edit ${from} term` }).click();
  await page.getByRole('combobox', { name: `Semester term for ${from}` }).selectOption(to);
  await page.getByRole('button', { name: 'Save semester term' }).click();
  await expect(page.locator('.container_semester .date p').first()).toHaveText(to);
};

const readFirstSemesterCreditState = (page) => page.evaluate(() => {
  const semester = window.curriculum.semesters[0];
  const semesterElement = document.getElementById(semester.id);
  const container = semesterElement && semesterElement.closest('.container_semester');
  const span = container && container.querySelector('.total_credit_text span');
  return {
    termName: semester.termName,
    total: Number(semester.totalCredit),
    text: span && span.textContent.trim(),
    overlimit: !!(span && span.classList.contains('is-overlimit')),
    creditLimit: span && span.dataset.creditLimit,
    modelCodes: semester.courses.map((course) => course.code),
    renderedCodes: container
      ? [...container.querySelectorAll('.course_code')].map((node) => node.textContent.trim())
      : [],
  };
});

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
        out.push({
          termName: s.termName,
          total: s.totalCredit,
          text: span.textContent.trim(),
          overlimit: span.classList.contains('is-overlimit'),
        });
      });
      return out;
    });
    expect(totals.length, 'semesters rendered').toBeGreaterThan(0);
    for (const s of totals) {
      expect(s.text).toBe(`Total: ${s.total} credits`);
      const limit = String(s.termName || '').startsWith('Summer ') ? 8 : 20;
      expect(s.overlimit).toBe((s.total || 0) > limit);
    }
  });
});

test.describe('advisory semester credit indicators', () => {
  test('Summer stays within the standard load at exactly 8 credits', async ({ page }) => {
    await seedCreditPlan(page, SUMMER_TERM, EIGHT_CREDITS);

    expect(await readFirstSemesterCreditState(page)).toEqual({
      termName: SUMMER_TERM,
      total: 8,
      text: 'Total: 8 credits',
      overlimit: false,
      creditLimit: '8',
      modelCodes: EIGHT_CREDITS,
      renderedCodes: EIGHT_CREDITS,
    });
  });

  test('Summer turns red above 8 credits without rejecting the added course', async ({ page }) => {
    await seedCreditPlan(page, SUMMER_TERM, SIX_CREDITS);
    expect((await readFirstSemesterCreditState(page)).overlimit).toBe(false);

    await addCourseThroughPicker(page, 'SPS101');
    await expectAdvisoryOverload(page.locator('.container_semester .total_credit_text span').first());

    expect(await readFirstSemesterCreditState(page)).toEqual({
      termName: SUMMER_TERM,
      total: 9,
      text: 'Total: 9 credits',
      overlimit: true,
      creditLimit: '8',
      modelCodes: NINE_CREDITS,
      renderedCodes: NINE_CREDITS,
    });
  });

  for (const term of [FALL_TERM, SPRING_TERM]) {
    test(`${term.split(' ')[0]} stays normal at 20 credits and turns red above 20`, async ({ page }) => {
      await seedCreditPlan(page, term, TWENTY_CREDITS);
      expect(await readFirstSemesterCreditState(page)).toEqual({
        termName: term,
        total: 20,
        text: 'Total: 20 credits',
        overlimit: false,
        creditLimit: '20',
        modelCodes: TWENTY_CREDITS,
        renderedCodes: TWENTY_CREDITS,
      });

      await addCourseThroughPicker(page, 'IF100');
      await expectAdvisoryOverload(page.locator('.container_semester .total_credit_text span').first());

      const overloaded = await readFirstSemesterCreditState(page);
      expect(overloaded).toEqual({
        termName: term,
        total: 23,
        text: 'Total: 23 credits',
        overlimit: true,
        creditLimit: '20',
        modelCodes: [...TWENTY_CREDITS, 'IF100'],
        renderedCodes: [...TWENTY_CREDITS, 'IF100'],
      });
    });
  }

  test('changing the term immediately reapplies the threshold to the same total', async ({ page }) => {
    await seedCreditPlan(page, FALL_TERM, NINE_CREDITS);
    const total = page.locator('.container_semester .total_credit_text span').first();
    await expect(total).not.toHaveClass(/is-overlimit/);

    await changeFirstSemesterTerm(page, FALL_TERM, SUMMER_TERM);
    await expectAdvisoryOverload(total);
    expect(await readFirstSemesterCreditState(page)).toEqual({
      termName: SUMMER_TERM,
      total: 9,
      text: 'Total: 9 credits',
      overlimit: true,
      creditLimit: '8',
      modelCodes: NINE_CREDITS,
      renderedCodes: NINE_CREDITS,
    });

    await changeFirstSemesterTerm(page, SUMMER_TERM, SPRING_TERM);
    await expect(total).not.toHaveClass(/is-overlimit/);
    expect(await readFirstSemesterCreditState(page)).toEqual({
      termName: SPRING_TERM,
      total: 9,
      text: 'Total: 9 credits',
      overlimit: false,
      creditLimit: '20',
      modelCodes: NINE_CREDITS,
      renderedCodes: NINE_CREDITS,
    });
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
