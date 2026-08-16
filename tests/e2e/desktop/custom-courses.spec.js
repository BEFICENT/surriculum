'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');

// Custom courses: user-defined courses stored per plan under
// `customCourses_<major>` and concatenated onto the fetched course_data at
// bootstrap (main.js). Untested until now, despite feeding straight into the
// allocation engine — a custom course is indistinguishable from a catalog one
// once loaded, so it can move every total and every requirement.
//
// This is the main.js side of the app, which had 3 tests across 2800 lines.
//
// Frozen term 202401. The codes below are deliberately absent from the real CS
// catalog, so anything observed about them can only come from the custom-course
// path.
const TERM_NAME = 'Fall 2024-2025';

const custom = (code, elType, extra = {}) => ({
  Major: code.replace(/\d+$/, ''),
  Code: code.replace(/^\D+/, ''),
  Course_Name: `Custom ${code}`,
  ECTS: '6',
  Engineering: 0,
  Basic_Science: 0,
  SU_credit: '3',
  Faculty: 'FENS',
  Faculty_Course: 'No',
  EL_Type: elType,
  ...extra,
});

const seedWithCustom = (page, courses, plannedCodes) => seedPlan(page, {
  major: 'CS',
  entryTerm: TERM_NAME,
  customCourses: { CS: courses },
  curriculum: [plannedCodes],
  grades: [plannedCodes.map(() => 'A')],
  dates: [TERM_NAME],
});

const readCourse = (page, code) => page.evaluate((c) => {
  let found = null;
  window.curriculum.semesters.forEach((s) => s.courses.forEach((x) => {
    if (x.code === c) found = { code: x.code, eff: x.effective_type, su: x.SU_credit, faculty: x.Faculty, facultyCourse: x.Faculty_Course };
  }));
  const s = window.curriculum.semesters;
  const sum = (f) => s.reduce((a, x) => a + (x[f] || 0), 0);
  return {
    found,
    totals: { core: sum('totalCore'), credit: sum('totalCredit'), science: sum('totalScience'), ects: sum('totalECTS') },
  };
}, code);

test.describe('custom courses', () => {
  test('a custom course is loaded into the course DB and allocated like a catalog one', async ({ page }) => {
    await seedWithCustom(page, [custom('ZZZ101', 'core')], ['ZZZ101']);
    const { found } = await readCourse(page, 'ZZZ101');

    expect(found, 'the custom course should survive into the curriculum').toBeTruthy();
    expect(found.eff, 'its EL_Type should drive its allocation').toBe('core');
  });

  test('its credits and ECTS reach the totals', async ({ page }) => {
    const { totals: base } = await (async () => {
      await seedWithCustom(page, [], []);
      return readCourse(page, 'ZZZ101');
    })();

    await seedWithCustom(page, [custom('ZZZ102', 'core', { SU_credit: '4', ECTS: '7' })], ['ZZZ102']);
    const { totals } = await readCourse(page, 'ZZZ102');

    expect(totals.credit - base.credit, 'SU credits should count').toBe(4);
    expect(totals.ects - base.ects, 'ECTS should count').toBe(7);
    expect(totals.core - base.core, 'a core-typed custom course should fill core').toBe(4);
  });

  test('basic-science credits on a custom course count toward the science requirement', async ({ page }) => {
    // Science is a graduation threshold in its own right (flag 8), so a custom
    // course claiming science credit moves a real requirement.
    await seedWithCustom(page, [custom('ZZZ103', 'core', { Basic_Science: 5 })], ['ZZZ103']);
    const { totals } = await readCourse(page, 'ZZZ103');
    expect(totals.science, 'basic-science should reach the science total').toBe(5);
  });

  test('an unknown EL_Type is allocated to nothing rather than guessed', async ({ page }) => {
    // The form constrains EL_Type, but storage is user-editable (and exports
    // round-trip through it), so a junk value must not be silently promoted
    // into a pool.
    await seedWithCustom(page, [custom('ZZZ104', 'nonsense')], ['ZZZ104']);
    const { found, totals } = await readCourse(page, 'ZZZ104');
    expect(found, 'the course should still load').toBeTruthy();
    expect(['core', 'area', 'free', 'required', 'university'], `unexpected allocation "${found.eff}"`).not.toContain(found.eff);
    expect(totals.core, 'it must not land in a pool').toBe(0);
  });

  test('custom courses are scoped to their major', async ({ page }) => {
    // The key is customCourses_<major>. A course defined for ME must not appear
    // for a CS student — otherwise switching major would leak courses across
    // catalogs.
    await seedPlan(page, {
      major: 'CS',
      entryTerm: TERM_NAME,
      customCourses: { ME: [custom('ZZZ105', 'core')] },
      curriculum: [['CS201']],
      grades: [['A']],
      dates: [TERM_NAME],
    });
    const inDb = await page.evaluate(() => course_data.some((c) => (String(c.Major || '') + String(c.Code || '')) === 'ZZZ105'));
    expect(inDb, "another major's custom course must not load for CS").toBe(false);
  });

  test('a custom course can carry a requirement over its threshold', async ({ page }) => {
    // The integration that matters: custom courses are real to the engine, so
    // one can be the difference between graduating and not.
    const codes = ['ZZZ201', 'ZZZ202', 'ZZZ203'];
    await seedWithCustom(page, codes.map((c) => custom(c, 'core', { SU_credit: '10' })), codes);
    const { totals } = await readCourse(page, codes[0]);
    // CS needs 31 core credits; 3 x 10 = 30 is deliberately just short, so the
    // cascade must cap rather than over-credit.
    expect(totals.core, 'core should take all 30 custom credits, capped by nothing yet').toBe(30);
  });

  test('the export round-trips custom courses', async ({ page }) => {
    // customCourses is a first-class part of the plan state, so a plan that
    // relies on them must survive export/import — otherwise the student silently
    // loses courses their graduation depends on.
    await seedWithCustom(page, [custom('ZZZ106', 'area')], ['ZZZ106']);
    const roundTripped = await page.evaluate(() => {
      const id = window.planStorage.getActivePlanId();
      const raw = window.planStorage.getItem('customCourses_CS', id);
      return JSON.parse(raw || '[]').map((c) => String(c.Major) + String(c.Code));
    });
    expect(roundTripped, 'the custom course should be readable from plan state').toContain('ZZZ106');
  });
});

// --- The Add Custom Course form (main.js) ---
//
// Faculty is OPTIONAL and user-chosen. It used to be hardcoded to 'FENS' on
// every created course, which silently made all of them count toward
// FENS-specific graduation rules (DSA's 3-per-faculty core rule, MAN's
// FASS/FENS free-elective credits). Transfer and exchange courses belong to no
// Sabanci faculty at all, so "none" has to be expressible — and is the default.
test.describe('custom course form', () => {
  const openForm = async (page) => {
    await page.locator('.customCourse').click();
    const modal = page.locator('.custom_course_modal');
    await expect(modal).toBeVisible({ timeout: 10000 });
    return modal;
  };

  const fill = async (modal, { code, name, su }) => {
    const rows = modal.locator('.cc-row');
    await rows.nth(0).locator('input').fill(code);
    await rows.nth(1).locator('input').fill(name);
    await rows.nth(2).locator('input').fill(su);
  };

  const savedCourses = (page) => page.evaluate(
    () => JSON.parse(window.planStorage.getItem('customCourses_CS') || '[]'),
  );

  test('faculty defaults to none, so a custom course claims no faculty by default', async ({ page }) => {
    await seedPlan(page, { major: 'CS', entryTerm: TERM_NAME, curriculum: [['CS201']], grades: [['A']], dates: [TERM_NAME] });
    const modal = await openForm(page);

    await expect(modal.locator('.cc-faculty'), 'default is "none"').toHaveValue('');
    await expect(modal.locator('.cc-language-level-row'), 'non-language courses keep the extra field out of the way').toBeHidden();

    await fill(modal, { code: 'XYZ301', name: 'Exchange Course', su: '3' });
    await modal.locator('.cc-buttons button', { hasText: /save|add|create/i }).first().click();

    const saved = await savedCourses(page);
    const rec = saved.find((c) => String(c.Major) + String(c.Code) === 'XYZ301');
    expect(rec, 'the course should be saved').toBeTruthy();
    expect(rec.Faculty, 'a transfer/exchange course claims no faculty').toBe('');
    expect(rec.Faculty_Course, 'a custom course is never in the faculty-course pool').toBe('No');
    expect(Object.hasOwn(rec, 'Language_Level'), 'non-language records remain unchanged').toBe(false);
  });

  test('language level is reviewable and only explicit Basic/Beginning wording is suggested', async ({ page }) => {
    await seedPlan(page, { major: 'CS', entryTerm: TERM_NAME, curriculum: [], grades: [], dates: [] });
    const modal = await openForm(page);

    await fill(modal, { code: 'LANG901', name: 'Basic Icelandic', su: '3' });
    const level = modal.getByRole('combobox', { name: 'Language level:' });
    await expect(level).toBeVisible();
    await expect(level).toHaveAttribute('aria-describedby', 'cc-language-level-help');
    await expect(modal.locator('#cc-language-level-help')).toContainText('two-course free-elective limit');
    await expect(level, 'the literal title safely seeds the review').toHaveValue('basic');

    // The suggestion stays user-reviewable; choosing the other classification
    // must win and persist rather than being recomputed from the title.
    await level.selectOption('other');
    await modal.getByRole('button', { name: 'Save', exact: true }).click();
    const rec = (await savedCourses(page))
      .find((course) => `${course.Major}${course.Code}` === 'LANG901');
    expect(rec).toMatchObject({ Language_Level: 'other' });
  });

  test('a chosen faculty is persisted and counts toward faculty rules', async ({ page }) => {
    await seedPlan(page, { major: 'CS', entryTerm: TERM_NAME, curriculum: [['CS201']], grades: [['A']], dates: [TERM_NAME] });
    const modal = await openForm(page);

    await fill(modal, { code: 'XYZ302', name: 'Real FASS Course', su: '3' });
    await modal.locator('.cc-faculty').selectOption('FASS');
    await modal.locator('.cc-buttons button', { hasText: /save|add|create/i }).first().click();

    const rec = (await savedCourses(page)).find((c) => String(c.Major) + String(c.Code) === 'XYZ302');
    expect(rec.Faculty, 'the chosen faculty should persist').toBe('FASS');

    // And it must reach the course object the rules read.
    const onCourse = await page.evaluate(() => {
      const rec2 = course_data.find((c) => (String(c.Major || '') + String(c.Code || '')) === 'XYZ302');
      return rec2 ? rec2.Faculty : null;
    });
    expect(onCourse, 'the loaded catalog record carries the faculty').toBe('FASS');
  });

  test('the ? button explains what faculty is and when to leave it blank', async ({ page }) => {
    await seedPlan(page, { major: 'CS', entryTerm: TERM_NAME, curriculum: [['CS201']], grades: [['A']], dates: [TERM_NAME] });
    const modal = await openForm(page);

    const help = modal.locator('.cc-help-text');
    const btn = modal.locator('.cc-help');
    const categoryBtn = modal.getByRole('button', {
      name: 'Explain CS course categories', exact: true,
    });
    await expect(help, 'the explanation starts collapsed').toBeHidden();
    await expect(btn, 'the ? control is visible without the icon font').toBeVisible();
    await expect(categoryBtn, 'the program-category ? control is visible').toBeVisible();

    const helpGeometry = await modal.evaluate((form) => {
      const metrics = (button) => {
        const box = button.getBoundingClientRect();
        const glyph = getComputedStyle(button, '::before');
        return {
          targetWidth: box.width,
          targetHeight: box.height,
          glyphWidth: parseFloat(glyph.width),
          glyphHeight: parseFloat(glyph.height),
        };
      };
      return {
        faculty: metrics(form.querySelector('.cc-help')),
        category: metrics(form.querySelector('.program-category-help')),
      };
    });
    expect(helpGeometry.faculty.targetWidth, 'Faculty help target width').toBeGreaterThanOrEqual(24);
    expect(helpGeometry.faculty.targetHeight, 'Faculty help target height').toBeGreaterThanOrEqual(24);
    expect(helpGeometry.category.targetWidth, 'category help target width').toBeGreaterThanOrEqual(24);
    expect(helpGeometry.category.targetHeight, 'category help target height').toBeGreaterThanOrEqual(24);
    expect(helpGeometry.faculty.glyphWidth, 'Faculty visible glyph width').toBe(16);
    expect(helpGeometry.faculty.glyphHeight, 'Faculty visible glyph height').toBe(16);
    expect(helpGeometry.category.glyphWidth, 'category visible glyph width').toBe(16);
    expect(helpGeometry.category.glyphHeight, 'category visible glyph height').toBe(16);
    expect(helpGeometry.category).toMatchObject({
      glyphWidth: helpGeometry.faculty.glyphWidth,
      glyphHeight: helpGeometry.faculty.glyphHeight,
    });

    await btn.click();
    await expect(help).toBeVisible();
    await expect(help, 'it should say when NOT to set a faculty').toContainText(/transfer or exchange/i);
    await expect(btn).toHaveAttribute('aria-expanded', 'true');

    await btn.click();
    await expect(help, 'the ? toggles it back').toBeHidden();
  });
});

// --- Editing a custom course (guards this session's Faculty field) ---
//
// The edit path opens the same form prefilled from the existing course and
// saves through an `{ ...courseObj, ... }` spread. If either the prefill or the
// spread ever drops Faculty, an edit would silently reset a course's faculty —
// which now changes what graduation rules it counts toward. Both directions are
// pinned here because Faculty was only just made editable.
test.describe('editing a custom course', () => {
  const seedWithFass = (page) => seedPlan(page, {
    major: 'CS',
    entryTerm: TERM_NAME,
    customCourses: { CS: [custom('QQQ400', 'core', { Faculty: 'FASS', Course_Name: 'Original Name' })] },
    curriculum: [['CS201']],
    grades: [['A']],
    dates: [TERM_NAME],
  });

  const openEditForm = async (page) => {
    await page.locator('.manageCustomCourses').click();
    const manage = page.locator('.custom_course_manage_overlay');
    await expect(manage).toBeVisible({ timeout: 10000 });
    await manage.locator('.custom_course_manage_item', { hasText: 'QQQ400' })
      .getByRole('button', { name: /edit/i }).click();
    const form = page.locator('.custom_course_modal');
    await expect(form).toBeVisible({ timeout: 10000 });
    return form;
  };

  test('manage and edit dialogs are named, keyboard-contained, and restore focus in stack order', async ({ page }) => {
    await seedWithFass(page);
    const manageOpener = page.getByRole('button', { name: /Manage Custom Courses/i });
    await manageOpener.click();
    const manage = page.getByRole('dialog', { name: 'Manage Custom Courses' });
    await expect(manage).toBeVisible();
    await expect(manage).toHaveAttribute('aria-modal', 'true');
    const close = manage.getByRole('button', { name: 'Close', exact: true });
    await expect(close).toBeFocused();

    const edit = manage.getByRole('button', { name: /edit/i });
    await edit.click();
    const editDialog = page.getByRole('dialog', { name: 'Edit Custom Course' });
    await expect(editDialog).toBeVisible();
    await expect(editDialog.getByRole('textbox', { name: 'Course Code:' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(editDialog).toHaveCount(0);
    await expect(manage).toBeVisible();
    await expect(edit).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(manage).toHaveCount(0);
    await expect(manageOpener).toBeFocused();
  });

  test('the edit form prefills the existing faculty', async ({ page }) => {
    await seedWithFass(page);
    const form = await openEditForm(page);
    await expect(form.locator('.cc-faculty'), 'faculty should prefill to the stored value').toHaveValue('FASS');
  });

  test('editing another field preserves the faculty', async ({ page }) => {
    await seedWithFass(page);
    const form = await openEditForm(page);

    // Change only the name, then save. Faculty must survive the round trip.
    await form.locator('.cc-row').nth(1).locator('input').fill('Renamed Course');
    await form.locator('.cc-buttons button', { hasText: /save|update|add/i }).first().click();

    const rec = await page.evaluate(
      () => JSON.parse(window.planStorage.getItem('customCourses_CS') || '[]').find((c) => String(c.Major) + String(c.Code) === 'QQQ400'),
    );
    expect(rec.Course_Name, 'the name change should persist').toBe('Renamed Course');
    expect(rec.Faculty, 'and the faculty must not be reset by the edit').toBe('FASS');
  });

  test('cancelling a normal edit keeps the stored custom course unchanged', async ({ page }) => {
    await seedWithFass(page);
    const form = await openEditForm(page);

    await form.locator('.cc-row').nth(1).locator('input').fill('Unsaved Name');
    await form.locator('.cc-faculty').selectOption('FENS');
    await form.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(form).toBeHidden();

    const rec = await page.evaluate(
      () => JSON.parse(window.planStorage.getItem('customCourses_CS') || '[]')
        .find((course) => String(course.Major) + String(course.Code) === 'QQQ400'),
    );
    expect(rec.Course_Name).toBe('Original Name');
    expect(rec.Faculty).toBe('FASS');
  });
});

test.describe('custom course identity and destructive changes', () => {
  const openManage = async (page) => {
    await page.locator('.manageCustomCourses').click();
    const manage = page.locator('.custom_course_manage_overlay');
    await expect(manage).toBeVisible({ timeout: 10000 });
    return manage;
  };

  const openEdit = async (page, code) => {
    const manage = await openManage(page);
    await manage.locator('.custom_course_manage_item', { hasText: code })
      .getByRole('button', { name: /edit/i }).click();
    const form = page.locator('.custom_course_modal');
    await expect(form).toBeVisible();
    return form;
  };

  const fillAddForm = async (page, code) => {
    await page.locator('.customCourse').click();
    const form = page.locator('.custom_course_modal');
    await expect(form).toBeVisible();
    const rows = form.locator('.cc-row');
    await rows.nth(0).locator('input').fill(code);
    await rows.nth(1).locator('input').fill(`Custom ${code}`);
    await rows.nth(2).locator('input').fill('3');
    await rows.nth(3).locator('input').fill('6');
    return form;
  };

  const dismissAlert = async (page, title) => {
    const alert = page.locator('.modal-overlay').filter({ hasText: title });
    await expect(alert).toBeVisible();
    await alert.getByRole('button', { name: 'OK', exact: true }).click();
  };

  test('editing planned N/A SU refreshes workload and crosses the Summer advisory threshold', async ({ page }) => {
    const code = 'QQQ450';
    await seedPlan(page, {
      major: 'CS',
      entryTerm: TERM_NAME,
      customCourses: {
        CS: [custom(code, 'unknown', { SU_credit: '2', ECTS: '4' })],
      },
      curriculum: [['IF100', 'MATH101', code]],
      grades: [['A', 'A', 'A']],
      dates: ['Summer 2024-2025'],
    });

    const indicator = page.locator('.container_semester .total_credit_text span').first();
    await expect(indicator).toHaveText('8 SU (2 N/A)');
    await expect(indicator).toHaveAttribute('data-su-load', '8');
    await expect(indicator).toHaveAttribute('data-primary-unallocated-su', '2');
    await expect(indicator).toHaveAttribute('data-overload-advisory', 'false');
    await expect(indicator).not.toHaveClass(/is-overlimit/);

    const form = await openEdit(page, code);
    await form.locator('.cc-row').nth(2).locator('input').fill('3');
    await form.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(form).toBeHidden();

    await expect(indicator).toHaveText('9 SU (3 N/A)');
    await expect(indicator).toHaveAttribute('data-su-load', '9');
    await expect(indicator).toHaveAttribute('data-primary-allocated-su', '6');
    await expect(indicator).toHaveAttribute('data-primary-unallocated-su', '3');
    await expect(indicator).toHaveAttribute('data-credit-limit', '8');
    await expect(indicator).toHaveAttribute('data-overload-advisory', 'true');
    await expect(indicator).toHaveClass(/is-overlimit/);
    await expect(indicator).toHaveAttribute('title', /Above the standard 8-SU Summer load/);

    const saved = await page.evaluate((courseCode) => {
      const semester = window.curriculum.semesters[0];
      const occurrence = semester.courses.find((course) => course.code === courseCode);
      const record = JSON.parse(window.planStorage.getItem('customCourses_CS') || '[]')
        .find((course) => `${course.Major}${course.Code}` === courseCode);
      return {
        occurrenceSu: Number(occurrence && occurrence.SU_credit),
        storedSu: Number(record && record.SU_credit),
        degreeTotal: semester.totalCredit,
        load: semester.totalLoadCredit,
        allocated: semester.primaryAllocatedCredit,
        unallocated: semester.primaryUnallocatedCredit,
      };
    }, code);
    expect(saved).toEqual({
      occurrenceSu: 3,
      storedSu: 3,
      degreeTotal: 6,
      load: 9,
      allocated: 6,
      unallocated: 3,
    });
  });

  test('renaming an in-use custom course preserves its attempt and stays coherent after reload', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: TERM_NAME,
      customCourses: { CS: [custom('QQQ400', 'core', { Course_Name: 'Original custom' })] },
      curriculum: [['QQQ400', 'CS201']],
      grades: [['B+', 'A']],
      gradingBases: [['letter', 'letter']],
      dates: [TERM_NAME],
    });

    const form = await openEdit(page, 'QQQ400');
    await form.locator('.cc-row').nth(0).locator('input').fill('QQQ401');
    await form.locator('.cc-row').nth(1).locator('input').fill('Renamed custom');
    await form.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(form).toBeHidden();

    const live = await page.evaluate(() => {
      const occurrence = window.curriculum.semesters.flatMap((semester) => semester.courses)
        .find((course) => course.code === 'QQQ401');
      const stored = JSON.parse(window.planStorage.getItem('customCourses_CS') || '[]');
      return {
        oldOccurrence: window.curriculum.hasCourse('QQQ400'),
        occurrence: occurrence && {
          code: occurrence.code,
          grade: occurrence.grade,
          gradingBasis: occurrence.gradingBasis,
          id: occurrence.id,
        },
        storedCodes: stored.map((course) => String(course.Major) + String(course.Code)),
        renderedCode: document.querySelector('.course_code')?.textContent,
      };
    });
    expect(live.oldOccurrence).toBe(false);
    expect(live.occurrence).toMatchObject({ code: 'QQQ401', grade: 'B+', gradingBasis: 'letter' });
    expect(live.occurrence.id).toBeTruthy();
    expect(live.storedCodes).toEqual(['QQQ401']);
    await expect(page.locator('.course_code', { hasText: 'QQQ401' })).toHaveCount(1);

    await page.reload();
    await page.waitForFunction(() => window.curriculum && window.curriculum.hasCourse('QQQ401'));
    const restored = await page.evaluate(() => {
      const occurrence = window.curriculum.semesters.flatMap((semester) => semester.courses)
        .find((course) => course.code === 'QQQ401');
      return {
        hasOld: window.curriculum.hasCourse('QQQ400'),
        code: occurrence && occurrence.code,
        grade: occurrence && occurrence.grade,
        gradingBasis: occurrence && occurrence.gradingBasis,
        storedCodes: JSON.parse(window.planStorage.getItem('customCourses_CS') || '[]')
          .map((course) => String(course.Major) + String(course.Code)),
      };
    });
    expect(restored).toEqual({
      hasOld: false,
      code: 'QQQ401',
      grade: 'B+',
      gradingBasis: 'letter',
      storedCodes: ['QQQ401'],
    });
  });

  test('singular delete removes the definition and live occurrence before reload', async ({ page }) => {
    await seedWithCustom(page, [custom('QQQ410', 'core')], ['QQQ410', 'CS201']);
    const manage = await openManage(page);
    await manage.locator('.custom_course_manage_item', { hasText: 'QQQ410' })
      .getByRole('button', { name: /delete/i }).click();
    const confirm = page.locator('.modal-overlay').filter({ hasText: /Delete custom course/i });
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click();

    await expect(page.locator('.course_code', { hasText: 'QQQ410' })).toHaveCount(0);
    expect(await page.evaluate(() => ({
      hasCourse: window.curriculum.hasCourse('QQQ410'),
      stored: JSON.parse(window.planStorage.getItem('customCourses_CS') || '[]'),
      inCatalog: course_data.some((course) => `${course.Major || ''}${course.Code || ''}` === 'QQQ410'),
    }))).toEqual({ hasCourse: false, stored: [], inCatalog: false });

    await page.reload();
    await page.waitForFunction(() => window.curriculum && window.curriculum.hasCourse('CS201'));
    expect(await page.evaluate(() => window.curriculum.hasCourse('QQQ410'))).toBe(false);
  });

  test('a rejected edit write leaves storage, model, and DOM untouched', async ({ page }) => {
    await seedWithCustom(page, [custom('QQQ420', 'core', { Course_Name: 'Durable name' })], ['QQQ420']);
    await page.evaluate(() => {
      const original = window.planStorage.setItem.bind(window.planStorage);
      window.planStorage.setItem = (key, value, planId) => (
        key === 'customCourses_CS' ? false : original(key, value, planId)
      );
    });

    const form = await openEdit(page, 'QQQ420');
    await form.locator('.cc-row').nth(0).locator('input').fill('QQQ421');
    await form.locator('.cc-row').nth(1).locator('input').fill('Should not stick');
    await form.getByRole('button', { name: 'Save', exact: true }).click();
    await dismissAlert(page, 'Could not save custom course');
    await expect(form).toBeVisible();

    expect(await page.evaluate(() => ({
      oldOccurrence: window.curriculum.hasCourse('QQQ420'),
      newOccurrence: window.curriculum.hasCourse('QQQ421'),
      renderedOld: Array.from(document.querySelectorAll('.course_code')).some((node) => node.textContent === 'QQQ420'),
      storedCodes: JSON.parse(window.planStorage.getItem('customCourses_CS') || '[]')
        .map((course) => String(course.Major) + String(course.Code)),
    }))).toEqual({
      oldOccurrence: true,
      newOccurrence: false,
      renderedOld: true,
      storedCodes: ['QQQ420'],
    });
  });

  test('new custom courses cannot shadow another custom course or the selected catalog', async ({ page }) => {
    await seedWithCustom(page, [custom('QQQ430', 'core')], ['CS201']);
    const form = await fillAddForm(page, 'QQQ430');
    await form.getByRole('button', { name: 'Save', exact: true }).click();
    await dismissAlert(page, 'Course code already exists');
    await expect(form).toBeVisible();

    await form.locator('.cc-row').nth(0).locator('input').fill('CS201');
    await form.getByRole('button', { name: 'Save', exact: true }).click();
    await dismissAlert(page, 'Course code already exists');

    // CS210 is the legacy identity of the catalog's DSA210 row. It must
    // not bypass the official-course collision check under its old code.
    await form.locator('.cc-row').nth(0).locator('input').fill('CS210');
    await form.getByRole('button', { name: 'Save', exact: true }).click();
    await dismissAlert(page, 'Course code already exists');
    await expect(form).toBeVisible();

    expect(await page.evaluate(() => ({
      stored: JSON.parse(window.planStorage.getItem('customCourses_CS') || '[]')
        .map((course) => String(course.Major) + String(course.Code)),
      qqqCount: course_data.filter((course) => `${course.Major || ''}${course.Code || ''}` === 'QQQ430').length,
      cs201Count: course_data.filter((course) => `${course.Major || ''}${course.Code || ''}` === 'CS201').length,
    }))).toEqual({ stored: ['QQQ430'], qqqCount: 1, cs201Count: 1 });
  });

  test('renaming cannot overwrite another custom course or a catalog course', async ({ page }) => {
    await seedWithCustom(page, [custom('QQQ440', 'core'), custom('QQQ441', 'area')], ['QQQ440']);
    const form = await openEdit(page, 'QQQ440');
    await form.locator('.cc-row').nth(0).locator('input').fill('QQQ441');
    await form.getByRole('button', { name: 'Save', exact: true }).click();
    await dismissAlert(page, 'Course code already exists');

    await form.locator('.cc-row').nth(0).locator('input').fill('CS201');
    await form.getByRole('button', { name: 'Save', exact: true }).click();
    await dismissAlert(page, 'Course code already exists');

    expect(await page.evaluate(() => ({
      occurrence: window.curriculum.semesters.flatMap((semester) => semester.courses)
        .find((course) => course.code === 'QQQ440')?.code,
      stored: JSON.parse(window.planStorage.getItem('customCourses_CS') || '[]')
        .map((course) => String(course.Major) + String(course.Code)),
    }))).toEqual({ occurrence: 'QQQ440', stored: ['QQQ440', 'QQQ441'] });
  });

  test('a rejected bulk-delete storage removal leaves definitions and occurrences untouched', async ({ page }) => {
    await seedWithCustom(page, [custom('QQQ450', 'core')], ['QQQ450']);
    await page.evaluate(() => {
      const original = window.planStorage.removeItem.bind(window.planStorage);
      window.planStorage.removeItem = (key, planId) => (
        key === 'customCourses_CS' ? false : original(key, planId)
      );
    });

    await page.locator('.deleteCustom').click();
    const confirm = page.locator('.modal-overlay').filter({ hasText: /Delete custom courses/i });
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click();
    await dismissAlert(page, 'Could not delete custom courses');

    expect(await page.evaluate(() => ({
      occurrence: window.curriculum.hasCourse('QQQ450'),
      stored: JSON.parse(window.planStorage.getItem('customCourses_CS') || '[]')
        .map((course) => String(course.Major) + String(course.Code)),
      rendered: Array.from(document.querySelectorAll('.course_code')).some((node) => node.textContent === 'QQQ450'),
    }))).toEqual({ occurrence: true, stored: ['QQQ450'], rendered: true });
  });

  test('bulk deletion preserves secondary-only overlays and real planner courses', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: TERM_NAME,
      doubleMajor: 'DSA',
      entryTermDM: TERM_NAME,
      customCourses: { DSA: [custom('CS201', 'core')] },
      curriculum: [['CS201']],
      grades: [['A']],
      dates: [TERM_NAME],
    });

    const repairNotice = page.locator('.modal-overlay').filter({ hasText: /Repaired double major credits/i });
    if (await repairNotice.isVisible()) {
      await repairNotice.getByRole('button', { name: 'OK', exact: true }).click();
    }

    await page.locator('.deleteCustom').click();
    const notice = page.locator('.modal-overlay').filter({ hasText: /No custom courses/i });
    await expect(notice).toBeVisible();
    await notice.getByRole('button', { name: 'OK', exact: true }).click();

    expect(await page.evaluate(() => ({
      hasCourse: window.curriculum.hasCourse('CS201'),
      dmCustom: JSON.parse(window.planStorage.getItem('customCourses_DSA') || '[]')
        .map((course) => `${course.Major}${course.Code}`),
      rendered: Array.from(document.querySelectorAll('.course_code')).some((node) => node.textContent === 'CS201'),
    }))).toEqual({ hasCourse: true, dmCustom: ['CS201'], rendered: true });
  });

  test('deleting one canonical alias repairs primary runtime without deleting program categories', async ({ page }) => {
    // Use a primary catalog without the official alias so the surviving
    // definition should become live immediately after the ambiguity is fixed.
    await page.route('**/courses/202401/BIO.jsonl', async (route) => {
      const response = await route.fetch();
      const body = (await response.text()).split(/\r?\n/).filter((line) => {
        if (!line.trim()) return false;
        const row = JSON.parse(line);
        return !['CS210', 'DSA210'].includes(`${row.Major || ''}${row.Code || ''}`);
      }).join('\n');
      await route.fulfill({ response, body: `${body}\n` });
    });
    await seedPlan(page, {
      major: 'BIO',
      entryTerm: TERM_NAME,
      doubleMajor: 'CS',
      entryTermDM: TERM_NAME,
      customCourses: {
        BIO: [custom('CS210', 'free'), custom('DSA210', 'area')],
        CS: [custom('CS210', 'core')],
      },
      curriculum: [[]],
      grades: [[]],
      dates: [TERM_NAME],
    });

    const manage = await openManage(page);
    await manage.locator('.custom_course_manage_item', { hasText: 'CS210' })
      .getByRole('button', { name: /delete/i }).click();
    const confirm = page.locator('.modal-overlay').filter({ hasText: /Delete custom course/i });
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click();

    const readAliasState = () => page.evaluate(() => {
      const combined = (course) => `${course.Major || ''}${course.Code || ''}`;
      const canonical = (course) => window.canonicalCourseCode(combined(course));
      return {
        primaryStored: JSON.parse(window.planStorage.getItem('customCourses_BIO') || '[]')
          .map(combined),
        contextStored: JSON.parse(window.planStorage.getItem('customCourses_CS') || '[]')
          .map(combined),
        primaryRuntime: course_data
          .filter((course) => canonical(course) === 'DSA210')
          .map((course) => ({
            code: combined(course),
            name: course.Course_Name,
            type: course.EL_Type,
            facultyCourse: course.Faculty_Course,
          })),
      };
    });
    await expect.poll(readAliasState).toEqual({
      primaryStored: ['DSA210'],
      contextStored: ['CS210'],
      primaryRuntime: [{
        code: 'DSA210', name: 'Custom DSA210', type: 'area', facultyCourse: 'No',
      }],
    });

    await page.reload();
    await page.waitForFunction(() => window.curriculum
      && typeof course_data !== 'undefined' && Array.isArray(course_data));
    expect(await readAliasState()).toEqual({
      primaryStored: ['DSA210'],
      contextStored: ['CS210'],
      primaryRuntime: [{
        code: 'DSA210', name: 'Custom DSA210', type: 'area', facultyCourse: 'No',
      }],
    });
  });

  test('singular delete removes the mirrored DM category without touching DM catalog data', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: TERM_NAME,
      doubleMajor: 'DSA',
      entryTermDM: TERM_NAME,
      customCourses: {
        CS: [custom('QQQ460', 'core')],
        DSA: [custom('QQQ460', 'area')],
      },
      curriculum: [['QQQ460']],
      grades: [['B']],
      dates: [TERM_NAME],
    });

    const manage = await openManage(page);
    await manage.locator('.custom_course_manage_item', { hasText: 'QQQ460' })
      .getByRole('button', { name: /delete/i }).click();
    const confirm = page.locator('.modal-overlay').filter({ hasText: /Delete custom course/i });
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click();

    expect(await page.evaluate(() => ({
      hasCourse: window.curriculum.hasCourse('QQQ460'),
      primary: JSON.parse(window.planStorage.getItem('customCourses_CS') || '[]'),
      dm: JSON.parse(window.planStorage.getItem('customCourses_DSA') || '[]'),
      runtimeDm: window.curriculum.doubleMajorCourseData
        .filter((course) => `${course.Major || ''}${course.Code || ''}` === 'QQQ460').length,
      catalogStillLoaded: window.curriculum.doubleMajorCourseData.length > 0,
    }))).toEqual({ hasCourse: false, primary: [], dm: [], runtimeDm: 0, catalogStillLoaded: true });
  });

  test('renaming into a real DM catalog code removes the old overlay without duplicating catalog data', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: TERM_NAME,
      doubleMajor: 'DSA',
      entryTermDM: TERM_NAME,
      customCourses: {
        CS: [custom('QQQ470', 'core')],
        DSA: [custom('QQQ470', 'area')],
      },
      curriculum: [['QQQ470']],
      grades: [['A-']],
      dates: [TERM_NAME],
    });

    const form = await openEdit(page, 'QQQ470');
    await form.locator('.cc-row').nth(0).locator('input').fill('DSA395');
    await form.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(form).toBeHidden();

    const readState = () => page.evaluate(() => ({
      hasOld: window.curriculum.hasCourse('QQQ470'),
      hasNew: window.curriculum.hasCourse('DSA395'),
      dmStored: JSON.parse(window.planStorage.getItem('customCourses_DSA') || '[]')
        .map((course) => `${course.Major || ''}${course.Code || ''}`),
      dmRuntimeNew: window.curriculum.doubleMajorCourseData
        .filter((course) => `${course.Major || ''}${course.Code || ''}` === 'DSA395').length,
      dmRuntimeOld: window.curriculum.doubleMajorCourseData
        .filter((course) => `${course.Major || ''}${course.Code || ''}` === 'QQQ470').length,
    }));
    expect(await readState()).toEqual({
      hasOld: false,
      hasNew: true,
      dmStored: [],
      dmRuntimeNew: 1,
      dmRuntimeOld: 0,
    });

    await page.reload();
    await page.waitForFunction(() => window.curriculum && window.curriculum.hasCourse('DSA395'));
    expect(await readState()).toEqual({
      hasOld: false,
      hasNew: true,
      dmStored: [],
      dmRuntimeNew: 1,
      dmRuntimeOld: 0,
    });
  });
});
