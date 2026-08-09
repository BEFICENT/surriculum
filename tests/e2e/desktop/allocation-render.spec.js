'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');
const plans = require('../fixtures/passing-plans-multiterm.json');

// Characterization of the ALLOCATION's DOM rendering — the .course_type labels
// and the per-semester workload text. No spec asserted these before (the
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

const customCourse = (code, elType, suCredit = '3') => ({
  Major: code.replace(/\d+$/, ''),
  Code: code.replace(/^\D+/, ''),
  Course_Name: `Custom ${code}`,
  ECTS: String(Number(suCredit) * 2),
  Engineering: 0,
  Basic_Science: 0,
  SU_credit: String(suCredit),
  Faculty: '',
  Faculty_Course: 'No',
  EL_Type: elType,
});

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

const expectFirstSemesterCreditSplit = async (page, expected) => {
  const indicator = page.locator('.container_semester .total_credit_text span').first();
  await expect(indicator).toHaveText(expected.text);
  await expect(indicator).toHaveAttribute('data-su-load', String(expected.load));
  await expect(indicator).toHaveAttribute(
    'data-primary-allocated-su', String(expected.allocated),
  );
  await expect(indicator).toHaveAttribute(
    'data-primary-unallocated-su', String(expected.unallocated),
  );
  await expect(indicator).toHaveAttribute(
    'data-overload-advisory', expected.overLimit ? 'true' : 'false',
  );
  await expect(indicator).toHaveAttribute('data-credit-limit', String(expected.limit));
  const title = await indicator.getAttribute('title');
  const ariaLabel = await indicator.getAttribute('aria-label');
  expect(ariaLabel, 'the compact credit split has a full accessible explanation').toBe(title);
  const threshold = expected.overLimit
    ? `Above the standard ${expected.limit}-SU ${expected.seasonLabel === 'regular-semester' ? 'regular semester' : 'Summer'} load; an overload may be possible with approval.`
    : `Standard ${expected.seasonLabel} load threshold: ${expected.limit} SU.`;
  expect(title).toBe(
    `${expected.load} SU semester load: ${expected.allocated} SU are allocated to ${expected.major} degree categories; `
    + `${expected.unallocated} SU are not allocated to a ${expected.major} degree category (N/A). `
    + `Grade, PGPA, and other-program treatment are separate. ${threshold}`,
  );
};

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

  test('per-semester workload text and overlimit class', async ({ page }) => {
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
          load: s.totalLoadCredit,
          unallocated: s.primaryUnallocatedCredit,
          text: span.textContent.trim(),
          overlimit: span.classList.contains('is-overlimit'),
        });
      });
      return out;
    });
    expect(totals.length, 'semesters rendered').toBeGreaterThan(0);
    for (const s of totals) {
      expect(s.text).toBe(`${s.load} SU${s.unallocated > 0 ? ` (${s.unallocated} N/A)` : ''}`);
      const limit = String(s.termName || '').startsWith('Summer ') ? 8 : 20;
      expect(s.overlimit).toBe((s.load || 0) > limit);
    }
  });
});

test.describe('advisory semester credit indicators', () => {
  test('Summer stays within the standard load at exactly 8 credits', async ({ page }) => {
    await seedCreditPlan(page, SUMMER_TERM, EIGHT_CREDITS);

    expect(await readFirstSemesterCreditState(page)).toEqual({
      termName: SUMMER_TERM,
      total: 8,
      text: '8 SU',
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
      text: '9 SU',
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
        text: '20 SU',
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
        text: '23 SU',
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
      text: '9 SU',
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
      text: '9 SU',
      overlimit: false,
      creditLimit: '20',
      modelCodes: NINE_CREDITS,
      renderedCodes: NINE_CREDITS,
    });
  });

  test('catalog N/A credit remains outside the degree total but drives Summer workload overload', async ({ page }) => {
    await seedPlan(page, {
      major: 'MAN', entryTerm: FALL_TERM,
      curriculum: [[...SIX_CREDITS, 'NS213']],
      grades: [['A', 'A', 'A']],
      dates: [SUMMER_TERM],
    });

    await expectFirstSemesterCreditSplit(page, {
      text: '9 SU (3 N/A)', load: 9, allocated: 6, unallocated: 3,
      major: 'MAN', limit: 8, seasonLabel: 'Summer', overLimit: true,
    });
    const model = await page.evaluate(() => {
      const semester = window.curriculum.semesters[0];
      const before = {
        totalCredit: semester.totalCredit,
        graduation: window.curriculum.canGraduate(),
      };
      window.curriculum.recalcEffectiveTypes(course_data);
      return {
        before,
        after: {
          totalCredit: semester.totalCredit,
          graduation: window.curriculum.canGraduate(),
        },
        catalogCourseType: semester.courses.find((course) => course.code === 'NS213')
          ?.effective_type,
      };
    });
    expect(model.catalogCourseType).toBe('none');
    expect(model.before.totalCredit).toBe(6);
    expect(model.after).toEqual(model.before);
  });

  test('a custom N/A course drives the regular-term workload without entering degree credit', async ({ page }) => {
    const code = 'ZZZ925';
    await seedPlan(page, {
      major: 'CS', entryTerm: FALL_TERM,
      customCourses: { CS: [customCourse(code, 'unknown')] },
      curriculum: [[...TWENTY_CREDITS, code]],
      grades: [[...TWENTY_CREDITS.map(() => 'A'), 'A']],
      dates: [FALL_TERM],
    });

    await expectFirstSemesterCreditSplit(page, {
      text: '23 SU (3 N/A)', load: 23, allocated: 20, unallocated: 3,
      major: 'CS', limit: 20, seasonLabel: 'regular-semester', overLimit: true,
    });
    const model = await page.evaluate(() => {
      const semester = window.curriculum.semesters[0];
      return {
        totalCredit: semester.totalCredit,
        customType: semester.courses.find((course) => course.code === 'ZZZ925')
          ?.effective_type,
      };
    });
    expect(model).toEqual({ totalCredit: 20, customType: 'none' });
  });

  test('an unsuccessful attempt still contributes to workload as primary N/A', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS', entryTerm: FALL_TERM,
      curriculum: [['MATH101']], grades: [['F']], dates: [FALL_TERM],
    });

    await expectFirstSemesterCreditSplit(page, {
      text: '3 SU (3 N/A)', load: 3, allocated: 0, unallocated: 3,
      major: 'CS', limit: 20, seasonLabel: 'regular-semester', overLimit: false,
    });
    expect(await page.evaluate(() => window.curriculum.semesters[0].totalCredit)).toBe(0);
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
