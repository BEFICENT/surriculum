'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');

// Major / entry-term switching (main.js). The highest-traffic wiring in the
// file and, until now, untested beyond the controls existing.
//
// The model is: on change, persist the choice to plan storage and
// location.reload(). Everything else — loading the new major's catalog and its
// requirements, and re-running allocation — happens on the fresh bootstrap. So
// the test that matters is not "the dropdown changed" but "the SAME plan is now
// evaluated against the NEW program". A refactor that reloaded without
// re-pointing the catalog, or persisted the wrong key, would leave the label
// changed and the evaluation stale.
//
// Frozen term 202401.
const TERM_NAME = 'Fall 2024-2025';

// Read a course's allocation plus the live requirement thresholds, so a switch
// is observable in the numbers the engine actually uses.
const readState = (page, code) => page.evaluate((c) => {
  let eff = null;
  window.curriculum.semesters.forEach((s) => s.courses.forEach((x) => { if (x.code === c) eff = x.effective_type; }));
  return { major: window.curriculum.major, doubleMajor: window.curriculum.doubleMajor, entryTerm: window.curriculum.entryTerm, eff };
}, code);

// Change a program select and wait for the reload it triggers to settle.
const switchSelect = async (page, selector, value, until) => {
  await page.locator(selector).selectOption(value);
  await page.waitForFunction(until, value, { timeout: 20000 });
  await page.waitForFunction(
    () => !!(window.curriculum && Array.isArray(window.curriculum.semesters)
      && window.curriculum.semesters.some((s) => s.courses && s.courses.length)),
    null,
    { timeout: 20000 },
  );
};

test.describe('major and entry-term switching', () => {
  test('switching major re-evaluates the same plan against the new catalog', async ({ page }) => {
    // CS204 is `required` in the CS catalog but `core` in ME's. If the switch
    // only relabelled the major without reloading the catalog, its allocation
    // would not move.
    await seedPlan(page, {
      major: 'CS',
      entryTerm: TERM_NAME,
      curriculum: [['CS204']],
      grades: [['A']],
      dates: [TERM_NAME],
    });

    const before = await readState(page, 'CS204');
    expect(before.major).toBe('CS');
    expect(before.eff, 'CS204 is required for CS').toBe('required');

    await switchSelect(page, '.change_major', 'ME', (m) => window.curriculum && window.curriculum.major === m);

    const after = await readState(page, 'CS204');
    expect(after.major, 'the curriculum should now be ME').toBe('ME');
    expect(after.eff, 'the same course is core for ME — proving the ME catalog loaded').toBe('core');
  });

  test('the switch persists, so a reload keeps the new major', async ({ page }) => {
    await seedPlan(page, { major: 'CS', entryTerm: TERM_NAME, curriculum: [['CS204']], grades: [['A']], dates: [TERM_NAME] });
    await switchSelect(page, '.change_major', 'ME', (m) => window.curriculum && window.curriculum.major === m);

    // A plain reload (not via the dropdown) must come back as ME, and the
    // dropdown must reflect it — i.e. the choice was written to storage.
    await page.reload();
    await page.waitForFunction(() => !!(window.curriculum && window.curriculum.major));
    expect(await page.evaluate(() => window.curriculum.major)).toBe('ME');
    await expect(page.locator('.change_major')).toHaveValue('ME');
  });

  test('the requirement thresholds follow the major', async ({ page }) => {
    // CS required = 29, ME required = 34. The engine must evaluate against the
    // new major's requirements, not the old ones.
    await seedPlan(page, { major: 'CS', entryTerm: TERM_NAME, curriculum: [['CS204']], grades: [['A']], dates: [TERM_NAME] });

    const reqFor = () => page.evaluate(() => {
      const r = (typeof requirements !== 'undefined' ? requirements : window.requirements) || {};
      const m = window.curriculum.major;
      const rec = r[m] || (Object.values(r).find((v) => v && v.required != null)) || {};
      return { major: m, required: rec.required };
    });

    expect(await reqFor()).toEqual({ major: 'CS', required: 29 });
    await switchSelect(page, '.change_major', 'ME', (m) => window.curriculum && window.curriculum.major === m);
    expect(await reqFor()).toEqual({ major: 'ME', required: 34 });
  });

  test('setting a double major loads its catalog and evaluates a second allocation', async ({ page }) => {
    await seedPlan(page, { major: 'CS', entryTerm: TERM_NAME, curriculum: [['CS204']], grades: [['A']], dates: [TERM_NAME] });

    // The double-major select is collapsed until the user asks for it. Reveal it
    // via the real affordance, matching the flow a user takes.
    await expect(page.locator('.doubleMajor')).toBeHidden();
    await page.locator('#addDoubleMajorBtn').click();
    await expect(page.locator('.doubleMajor'), 'the DM select should appear').toBeVisible();

    await switchSelect(page, '.doubleMajor', 'ME', () => window.curriculum && window.curriculum.doubleMajor === 'ME');

    const st = await readState(page, 'CS204');
    expect(st.doubleMajor, 'the double major should be set').toBe('ME');
    // The DM pass runs and CS204 gets a second, ME-based category.
    const dmEff = await page.evaluate(() => {
      let e = null;
      window.curriculum.semesters.forEach((s) => s.courses.forEach((x) => { if (x.code === 'CS204') e = x.effective_type_dm; }));
      return e;
    });
    expect(dmEff, 'CS204 is core under ME as the double major').toBe('core');
  });

  test('clearing the double major back to None removes it', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: TERM_NAME,
      doubleMajor: 'ME',
      entryTermDM: TERM_NAME,
      curriculum: [['CS204']],
      grades: [['A']],
      dates: [TERM_NAME],
    });
    expect((await readState(page, 'CS204')).doubleMajor).toBe('ME');

    // The None option has an empty value.
    await switchSelect(page, '.doubleMajor', '', () => window.curriculum && !window.curriculum.doubleMajor);
    expect((await readState(page, 'CS204')).doubleMajor, 'the double major should be cleared').toBeFalsy();
  });

  test('switching entry term keeps the major and reloads its catalog for that term', async ({ page }) => {
    await seedPlan(page, { major: 'CS', entryTerm: TERM_NAME, curriculum: [['CS204']], grades: [['A']], dates: [TERM_NAME] });

    const OTHER_TERM = 'Fall 2023-2024';
    await switchSelect(page, '.entryTerm', OTHER_TERM, (t) => window.curriculum && window.curriculum.entryTerm === '202301');

    const st = await readState(page, 'CS204');
    expect(st.major, 'the major should survive an entry-term change').toBe('CS');
    expect(st.entryTerm, 'the entry term should update').toBe('202301');
    expect(st.eff, 'CS204 is still required for CS in the earlier catalog').toBe('required');
  });
});
