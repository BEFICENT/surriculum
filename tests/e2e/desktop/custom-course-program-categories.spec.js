'use strict';

const fs = require('node:fs');
const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');

const TERM = 'Fall 2024-2025';
const MINOR_TERM = TERM;

const custom = (code, elType, extra = {}) => ({
  Major: code.replace(/\d+$/, ''),
  Code: code.replace(/^\D+/, ''),
  Course_Name: `Custom ${code}`,
  ECTS: '6',
  Engineering: 0,
  Basic_Science: 0,
  SU_credit: '3',
  Faculty: '',
  Faculty_Course: 'No',
  EL_Type: elType,
  ...extra,
});

const categorySelect = (form, program) => form.locator('.cc-row')
  .filter({ hasText: new RegExp(`^\\s*${program.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} Category:?`) })
  .locator('select');

const categoryLabels = async (form) => (await form.locator('.cc-row .program-category-label-line > label').allTextContents())
  .map((label) => label.trim().replace(/:$/, ''))
  .filter((label) => label.endsWith(' Category'))
  .sort();

const selectedPrograms = (overrides = {}) => ({
  major: 'CS',
  entryTerm: TERM,
  doubleMajor: 'DSA',
  entryTermDM: TERM,
  minor1: 'FIN-MINOR',
  entryTermMinor1: MINOR_TERM,
  minor2: 'ANALY-MINOR',
  entryTermMinor2: MINOR_TERM,
  minor3: 'PHIL-MINOR',
  entryTermMinor3: MINOR_TERM,
  ...overrides,
});

const waitForPrograms = (page, courseCode) => page.waitForFunction((target) => {
  if (!window.curriculum || !Array.isArray(window.curriculum.semesters)) return false;
  const minors = window.curriculum.minorCourseDataByCode || {};
  if (!minors['FIN-MINOR'] && !minors['ANALY-MINOR'] && !minors['PHIL-MINOR']) return false;
  if (!target) return true;
  return window.curriculum.semesters.some((semester) =>
    (semester.courses || []).some((course) => course.code === target));
}, courseCode || '');

const openAddForm = async (page) => {
  await page.locator('.customCourse').click();
  const form = page.locator('.custom_course_modal');
  await expect(form).toBeVisible({ timeout: 10000 });
  return form;
};

const openEditForm = async (page, code) => {
  await page.locator('.manageCustomCourses').click();
  const manage = page.locator('.custom_course_manage_overlay');
  await expect(manage).toBeVisible({ timeout: 10000 });
  await manage.locator('.custom_course_manage_item', { hasText: code })
    .getByRole('button', { name: /edit/i }).click();
  const form = page.locator('.custom_course_modal');
  await expect(form).toBeVisible();
  return form;
};

const fillIdentity = async (form, code, name = `Custom ${code}`, suCredits = '3') => {
  const rows = form.locator('.cc-row');
  await rows.nth(0).locator('input').fill(code);
  await rows.nth(1).locator('input').fill(name);
  await rows.nth(2).locator('input').fill(suCredits);
  await rows.nth(3).locator('input').fill('6');
};

const readProgramDefinitions = (page, programs, code) => page.evaluate(({ keys, target }) => {
  const normalize = (course) => `${course.Major || ''}${course.Code || ''}`.toUpperCase();
  return Object.fromEntries(keys.map((program) => {
    const rows = JSON.parse(window.planStorage.getItem(`customCourses_${program}`) || '[]');
    const course = rows.find((record) => normalize(record) === target);
    return [program, course ? {
      code: normalize(course),
      type: String(course.EL_Type || '').toLowerCase(),
      name: course.Course_Name,
      credits: String(course.SU_credit),
    } : null];
  }));
}, { keys: programs, target: code.toUpperCase() });

const addCourseToFirstSemester = async (page, code) => {
  const semester = page.locator('.container_semester').first();
  await semester.locator('.addCourse').click();
  await semester.locator('.course_select').fill(code);
  await page.locator(`.course-option[data-code="${code}"]`).first().click();
  await semester.locator('.enter').click();
  const course = page.locator(`.course:has(.course_code:text-is("${code}"))`);
  await expect(course).toHaveCount(1);
  await course.locator('.grade').click();
  await page.locator('.grade-option[data-value="A"]').first().click();
  await page.evaluate(() => window.planStorage.flushSaves());
};

const readMinorAllocation = (page, minor, code) => page.evaluate(({ program, target }) => {
  const fn = window.computeMinorAllocation
    || (typeof computeMinorAllocation === 'function' ? computeMinorAllocation : null);
  const result = fn(window.curriculum, program, { calculateProgramGpa: false });
  const allocation = result.allocationByCode[target] || null;
  return {
    error: result.error || null,
    allocation,
    totals: result.totals,
    storedType: result.courseByCode.get(target)?.__baseCat || null,
  };
}, { program: minor, target: code.toUpperCase() });

test.describe('per-program custom-course categories', () => {
  test('uses code-labelled independent selectors and round-trips a new minor course', async ({ page }) => {
    const code = 'ZZZ620';
    const programs = ['CS', 'DSA', 'FIN-MINOR', 'ANALY-MINOR', 'PHIL-MINOR'];
    const types = {
      CS: 'core',
      DSA: 'area',
      'FIN-MINOR': 'required',
      'ANALY-MINOR': 'area',
      'PHIL-MINOR': 'free',
    };
    await seedPlan(page, {
      ...selectedPrograms(),
      curriculum: [['MATH101']],
      grades: [['A']],
      dates: [TERM],
    });
    await waitForPrograms(page);

    const before = await page.evaluate((target) => Object.fromEntries(
      Object.entries(window.curriculum.minorCourseDataByCode).map(([program, rows]) => [
        program,
        rows.some((course) => `${course.Major || ''}${course.Code || ''}` === target),
      ]),
    ), code);
    expect(before['FIN-MINOR']).toBe(false);
    expect(before['ANALY-MINOR']).toBe(false);
    expect(before['PHIL-MINOR']).toBe(false);

    const form = await openAddForm(page);
    await expect(form.getByText(/Double Major Category|Category \(EL_Type\)/)).toHaveCount(0);
    expect(await categoryLabels(form)).toEqual(programs.map((program) => `${program} Category`).sort());
    expect(await categorySelect(form, 'CS').locator('option').evaluateAll((options) =>
      options.map((option) => option.value))).toEqual([
      'core', 'area', 'university', 'free', 'required', 'none', 'unknown',
    ]);
    expect(await categorySelect(form, 'DSA').locator('option').evaluateAll((options) =>
      options.map((option) => option.value))).toEqual([
      'core', 'area', 'university', 'free', 'required', 'none', 'unknown',
    ]);
    for (const minor of ['FIN-MINOR', 'ANALY-MINOR', 'PHIL-MINOR']) {
      expect(await categorySelect(form, minor).locator('option').evaluateAll((options) =>
        options.map((option) => option.value))).toEqual([
        'required', 'core', 'area', 'free', 'unknown',
      ]);
    }
    await fillIdentity(form, code, 'Exchange Decision Science', '2.5');
    for (const program of programs) {
      await categorySelect(form, program).selectOption(types[program]);
    }
    await form.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(form).toBeHidden();

    const saved = await readProgramDefinitions(page, programs, code);
    for (const program of programs) {
      expect(saved[program]).toMatchObject({ type: types[program], credits: '2.5' });
    }

    await addCourseToFirstSemester(page, code);
    await page.reload();
    await waitForPrograms(page, code);

    const edit = await openEditForm(page, code);
    expect(await categoryLabels(edit)).toEqual(programs.map((program) => `${program} Category`).sort());
    for (const program of programs) {
      await expect(categorySelect(edit, program)).toHaveValue(types[program]);
    }
    await edit.getByRole('button', { name: 'Cancel', exact: true }).click();

    expect(await readMinorAllocation(page, 'FIN-MINOR', code)).toMatchObject({
      error: null,
      allocation: { baseCat: 'required', allocatedCat: 'required', credit: 2.5 },
      storedType: 'required',
    });
    expect(await readMinorAllocation(page, 'ANALY-MINOR', code)).toMatchObject({
      error: null,
      allocation: { baseCat: 'area', allocatedCat: 'area', credit: 2.5 },
      storedType: 'area',
    });

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.evaluate(() => window.planStorage.exportPlan()),
    ]);
    const exported = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    for (const program of programs) {
      const record = exported.plan.state.customCourses[program]
        .find((course) => `${course.Major}${course.Code}` === code);
      expect(record?.EL_Type).toBe(types[program]);
      expect(String(record?.SU_credit)).toBe('2.5');
    }

    await page.evaluate((object) => window.planStorage.importPlanObject(object, { activate: true }), exported);
    await page.reload();
    await waitForPrograms(page, code);
    const imported = await readProgramDefinitions(page, programs, code);
    for (const program of programs) expect(imported[program]?.type).toBe(types[program]);
    expect(await readMinorAllocation(page, 'FIN-MINOR', code)).toMatchObject({
      allocation: { baseCat: 'required', allocatedCat: 'required', credit: 2.5 },
    });
  });

  test('category help is program-scoped, accessible, option-specific, and independently toggleable', async ({ page }) => {
    await seedPlan(page, {
      ...selectedPrograms({
        minor2: null,
        entryTermMinor2: null,
        minor3: null,
        entryTermMinor3: null,
      }),
      curriculum: [['MATH101']],
      grades: [['A']],
      dates: [TERM],
    });
    await waitForPrograms(page);

    const form = await openAddForm(page);
    const expectations = {
      CS: ['core', 'area', 'university', 'free', 'required', 'none', 'unknown'],
      DSA: ['core', 'area', 'university', 'free', 'required', 'none', 'unknown'],
      'FIN-MINOR': ['required', 'core', 'area', 'free', 'unknown'],
    };
    const controlledIds = new Set();
    let previouslyOpen = null;

    for (const [program, categories] of Object.entries(expectations)) {
      const help = form.getByRole('button', {
        name: `Explain ${program} course categories`, exact: true,
      });
      const labelLine = help.locator('..');
      await expect(labelLine).toHaveClass(/\bprogram-category-label-line\b/);
      await expect(labelLine.locator('label')).toHaveText(`${program} Category:`);
      await expect(categorySelect(form, program)).toHaveAccessibleName(`${program} Category:`);
      await expect(help).toHaveText('?');
      await expect(help).toHaveAttribute('type', 'button');
      await expect(help).toHaveAttribute('aria-expanded', 'false');

      const panelId = await help.getAttribute('aria-controls');
      expect(panelId, `${program} help must control a panel`).toBeTruthy();
      expect(controlledIds.has(panelId), `${program} help id must be unique`).toBe(false);
      controlledIds.add(panelId);
      const panel = form.locator(`#${panelId}`);
      await expect(panel).toHaveAttribute('role', 'note');
      await expect(panel).toHaveClass(/\bis-hidden\b/);
      await expect(panel).toBeHidden();
      const intro = panel.locator('p').first();
      await expect(intro).toContainText(/Each selected program is classified separately[.;]/);
      if (program === 'FIN-MINOR') {
        await expect(intro).toContainText(`For ${program}, this is the course's starting minor category.`);
        await expect(intro).toContainText("the minor's requirements and equivalence rules");
        await expect(intro).toContainText('Check Summary for the result.');
        await expect(intro).not.toContainText('Required → Core → Area → Free');
      } else {
        await expect(intro).toContainText(`For ${program}, this is the course's starting program category.`);
        await expect(intro).toContainText('Required → Core → Area → Free');
        await expect(intro).toContainText('Check Summary for where it actually counts.');
      }

      const renderedCategories = await panel.locator('li[data-category]').evaluateAll((items) =>
        items.map((item) => item.dataset.category));
      expect(renderedCategories).toEqual(categories);
      for (const category of categories) {
        const item = panel.locator(`li[data-category="${category}"]`);
        if (category === 'required') {
          await expect(item).toContainText(program === 'FIN-MINOR'
            ? 'Starts in the minor required pool.' : 'Starts in the required pool.');
          await expect(item).toContainText(/does not (replace|create).*named|equivalent/i);
          await expect(item).toContainText(/approval|approve/i);
        } else if (category === 'core') {
          await expect(item).toContainText('Starts in');
          await expect(item).toContainText('core-elective pool');
        } else if (category === 'area') {
          await expect(item).toContainText('Starts in');
          await expect(item).toContainText('area, concentration, or specialization pool');
        } else if (category === 'university') {
          await expect(item).toContainText('Stays in the university-course pool');
          await expect(item).toContainText('does not replace a specifically named university requirement');
        } else if (category === 'free') {
          await expect(item).toContainText('Stays in the free-elective pool.');
        } else if (category === 'none') {
          await expect(item).toContainText('Uses no category pool or program GPA');
          await expect(item).toContainText('main-plan SU/ECTS may still count');
        } else if (category === 'unknown') {
          await expect(item).toContainText(program === 'FIN-MINOR'
            ? 'Enters neither the minor total nor the minor program GPA.'
            : 'Contributes nothing through this program.');
          await expect(item).toContainText('CGPA');
          await expect(item).toContainText('other selected programs');
        }
      }
      if (program === 'FIN-MINOR') {
        await expect(panel.locator('li[data-category="university"], li[data-category="none"]'))
          .toHaveCount(0);
      }
      const footer = panel.locator('p').last();
      await expect(footer).toContainText('official catalog category');
      await expect(footer).toContainText('Custom classifications are planning assumptions, not university approval.');
      await expect(footer).toContainText('CGPA');

      await help.click();
      await expect(help).toHaveAttribute('aria-expanded', 'true');
      await expect(panel).not.toHaveClass(/\bis-hidden\b/);
      await expect(panel).toBeVisible();
      await expect(form.locator('.program-category-help-text:visible')).toHaveCount(1);
      if (previouslyOpen) {
        await expect(previouslyOpen.help).toHaveAttribute('aria-expanded', 'false');
        await expect(previouslyOpen.panel).toBeHidden();
      }
      previouslyOpen = { help, panel };
    }
    await previouslyOpen.help.click();
    await expect(previouslyOpen.help).toHaveAttribute('aria-expanded', 'false');
    await expect(previouslyOpen.panel).toBeHidden();
    await expect(form.locator('.program-category-help-text:visible')).toHaveCount(0);
  });

  test('expanded category help stays horizontally contained at 320px', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await seedPlan(page, {
      ...selectedPrograms({
        minor2: null,
        entryTermMinor2: null,
        minor3: null,
        entryTermMinor3: null,
      }),
      curriculum: [['MATH101']],
      grades: [['A']],
      dates: [TERM],
    });
    await waitForPrograms(page);
    await page.waitForFunction(() => document.body.classList.contains('is-mobile'));
    await page.locator('.m-nav-item[data-mtab="controls"]').click();
    await expect(page.locator('.customCourse')).toBeVisible();

    const form = await openAddForm(page);
    for (const program of ['CS', 'DSA', 'FIN-MINOR']) {
      const help = form.getByRole('button', {
        name: `Explain ${program} course categories`, exact: true,
      });
      await help.click();
      await expect(help).toHaveAttribute('aria-expanded', 'true');
      await expect(form.locator('.program-category-help-text:visible')).toHaveCount(1);

      const layout = await form.evaluate((modal) => {
        const rect = (element) => {
          const box = element.getBoundingClientRect();
          return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
        };
        const horizontallyInside = (child, parent, tolerance = 1) =>
          child.left >= parent.left - tolerance && child.right <= parent.right + tolerance;
        const overlay = modal.closest('.custom_course_overlay');
        const modalBox = rect(modal);
        const overlayBox = rect(overlay);
        const labelLines = Array.from(modal.querySelectorAll('.program-category-label-line'));
        const buttons = Array.from(modal.querySelectorAll('.program-category-help'));
        const panels = Array.from(modal.querySelectorAll('.program-category-help-text:not(.is-hidden)'));
        return {
          isMobile: document.body.classList.contains('is-mobile'),
          viewportWidth: window.innerWidth,
          visiblePanelCount: panels.length,
          overlayInViewport: overlayBox.left >= -1 && overlayBox.right <= window.innerWidth + 1,
          modalInViewport: modalBox.left >= -1 && modalBox.right <= window.innerWidth + 1,
          modalInOverlay: horizontallyInside(modalBox, overlayBox),
          modalBottomInViewport: modalBox.bottom <= window.innerHeight + 1,
          labelLinesInModal: labelLines.every((line) => horizontallyInside(rect(line), modalBox)),
          buttonsInModal: buttons.every((button) => horizontallyInside(rect(button), modalBox)),
          panelsInModal: panels.every((panel) => horizontallyInside(rect(panel), modalBox)),
          controlsHaveArea: [...buttons, ...panels].every((element) => {
            const box = rect(element);
            return box.right > box.left && box.bottom > box.top;
          }),
          minHelpWidth: Math.min(...buttons.map((button) => button.getBoundingClientRect().width)),
          minHelpHeight: Math.min(...buttons.map((button) => button.getBoundingClientRect().height)),
          documentOverflow: document.documentElement.scrollWidth
            - document.documentElement.clientWidth,
          overlayOverflow: overlay.scrollWidth - overlay.clientWidth,
          modalOverflow: modal.scrollWidth - modal.clientWidth,
          labelLineOverflow: Math.max(0, ...labelLines.map((line) => line.scrollWidth - line.clientWidth)),
          panelOverflow: Math.max(0, ...panels.map((panel) => panel.scrollWidth - panel.clientWidth)),
        };
      });
      expect(layout, `${program} help at 320px`).toMatchObject({
        isMobile: true,
        viewportWidth: 320,
        visiblePanelCount: 1,
        overlayInViewport: true,
        modalInViewport: true,
        modalInOverlay: true,
        modalBottomInViewport: true,
        labelLinesInModal: true,
        buttonsInModal: true,
        panelsInModal: true,
        controlsHaveArea: true,
      });
      expect(layout.documentOverflow, `${program} document overflow`).toBeLessThanOrEqual(1);
      expect(layout.overlayOverflow, `${program} overlay overflow`).toBeLessThanOrEqual(1);
      expect(layout.modalOverflow, `${program} modal overflow`).toBeLessThanOrEqual(1);
      expect(layout.labelLineOverflow, `${program} category label-line overflow`).toBeLessThanOrEqual(1);
      expect(layout.panelOverflow, `${program} category help-panel overflow`).toBeLessThanOrEqual(1);
      expect(layout.minHelpWidth, `${program} help target width`).toBeGreaterThanOrEqual(24);
      expect(layout.minHelpHeight, `${program} help target height`).toBeGreaterThanOrEqual(24);

      await help.click();
      await expect(help).toHaveAttribute('aria-expanded', 'false');
      await expect(form.locator('.program-category-help-text:visible')).toHaveCount(0);
    }
  });

  test('pending double-major classification exposes the same category-help semantics', async ({ page }) => {
    const code = 'ZZZ625';
    await seedPlan(page, {
      major: 'CS',
      entryTerm: TERM,
      doubleMajor: 'DSA',
      entryTermDM: TERM,
      customCourses: { CS: [custom(code, 'free')] },
      curriculum: [[code]],
      grades: [['A']],
      dates: [TERM],
    });

    const modal = page.locator('.double_major_modal');
    await expect(modal).toBeVisible({ timeout: 15000 });
    await expect(modal.getByRole('heading', { name: 'Set DSA Category', exact: true }))
      .toBeVisible();
    await expect(modal.locator('.program-category-label-line > label'))
      .toHaveText('DSA Category:');
    await expect(modal.getByRole('combobox', { name: 'DSA Category:', exact: true }))
      .toHaveValue('core');

    const help = modal.getByRole('button', {
      name: 'Explain DSA course categories', exact: true,
    });
    await expect(help).toHaveText('?');
    await expect(help).toHaveAttribute('aria-expanded', 'false');
    const panelId = await help.getAttribute('aria-controls');
    expect(panelId).toBeTruthy();
    const panel = modal.locator(`#${panelId}`);
    await expect(panel).toHaveAttribute('role', 'note');
    await expect(panel).toBeHidden();
    expect(await panel.locator('li[data-category]').evaluateAll((items) =>
      items.map((item) => item.dataset.category))).toEqual([
      'core', 'area', 'required', 'university', 'free', 'none', 'unknown',
    ]);

    await help.click();
    await expect(help).toHaveAttribute('aria-expanded', 'true');
    await expect(panel).toBeVisible();
    await expect(panel.locator('p').first()).toContainText('starting program category');
    await expect(panel.locator('p').first()).toContainText('Required → Core → Area → Free');
    await expect(panel.locator('li[data-category="required"]')).toContainText('does not create');
    await expect(panel.locator('li[data-category="required"]')).toContainText(/approval|approve/i);
    await expect(panel.locator('li[data-category="none"]')).toContainText('no category pool or program GPA');
    await expect(panel.locator('li[data-category="none"]')).toContainText('main-plan SU/ECTS may still count');
    await expect(panel.locator('li[data-category="unknown"]')).toContainText('Contributes nothing');
    await expect(panel.locator('li[data-category="unknown"]')).toContainText('CGPA');
    await expect(panel.locator('p').last()).toContainText('official catalog category');
    await expect(panel.locator('p').last()).toContainText('Category never changes grade or CGPA treatment.');
    await expect(panel.locator('p').last()).toContainText('planning assumptions, not university approval');

    await help.click();
    await expect(help).toHaveAttribute('aria-expanded', 'false');
    await expect(panel).toBeHidden();
  });

  test('program role swaps, duplicate minors, and remove/re-add keep categories tied to codes', async ({ page }) => {
    const code = 'ZZZ630';
    const records = {
      CS: [custom(code, 'core')],
      IE: [custom(code, 'area')],
      'FIN-MINOR': [custom(code, 'required')],
      'ANALY-MINOR': [custom(code, 'core')],
      'PHIL-MINOR': [custom(code, 'free')],
    };
    await seedPlan(page, {
      ...selectedPrograms({ doubleMajor: 'IE' }),
      customCourses: records,
      curriculum: [[code]],
      grades: [['A']],
      dates: [TERM],
    });
    await waitForPrograms(page, code);

    let form = await openEditForm(page, code);
    expect(await categoryLabels(form)).toEqual([
      'ANALY-MINOR Category', 'CS Category', 'FIN-MINOR Category',
      'IE Category', 'PHIL-MINOR Category',
    ]);
    await expect(categorySelect(form, 'CS')).toHaveValue('core');
    await expect(categorySelect(form, 'IE')).toHaveValue('area');
    await form.getByRole('button', { name: 'Cancel', exact: true }).click();

    // Swap which code is the main versus double-major program, select FIN
    // twice, and temporarily remove ANALY. The category follows its program
    // key, while a duplicate selected minor produces only one selector.
    await page.evaluate(() => {
      window.planStorage.setItem('major', 'IE');
      window.planStorage.setItem('doubleMajor', 'CS');
      window.planStorage.setItem('minor1', 'FIN-MINOR');
      window.planStorage.setItem('minor2', 'FIN-MINOR');
      window.planStorage.setItem('minor3', 'PHIL-MINOR');
    });
    await page.reload();
    await waitForPrograms(page, code);

    form = await openEditForm(page, code);
    expect(await categoryLabels(form)).toEqual([
      'CS Category', 'FIN-MINOR Category', 'IE Category', 'PHIL-MINOR Category',
    ]);
    await expect(categorySelect(form, 'IE'), 'IE remains area when it becomes the main major')
      .toHaveValue('area');
    await expect(categorySelect(form, 'CS'), 'CS remains core when it becomes the double major')
      .toHaveValue('core');
    await expect(form.locator('.cc-row').filter({ hasText: /^\s*FIN-MINOR Category:?/ }))
      .toHaveCount(1);
    await form.getByRole('button', { name: 'Cancel', exact: true }).click();

    // Re-adding a previously removed minor recovers that minor's own durable
    // category rather than copying whichever selector currently occupies its slot.
    await page.evaluate(() => window.planStorage.setItem('minor2', 'ANALY-MINOR'));
    await page.reload();
    await waitForPrograms(page, code);
    form = await openEditForm(page, code);
    await expect(categorySelect(form, 'ANALY-MINOR')).toHaveValue('core');
    await expect(categorySelect(form, 'FIN-MINOR')).toHaveValue('required');
  });

  test('minor none, unknown, and university categories remain unallocated instead of falling back to free', async ({ page }) => {
    const noneCode = 'ZZZ640';
    const unknownCode = 'ZZZ641';
    const universityCode = 'ZZZ642';
    await seedPlan(page, {
      ...selectedPrograms({ doubleMajor: null, minor2: null, minor3: null }),
      customCourses: {
        CS: [custom(noneCode, 'free'), custom(unknownCode, 'free'), custom(universityCode, 'free')],
        'FIN-MINOR': [
          custom(noneCode, 'none'),
          custom(unknownCode, 'unknown'),
          custom(universityCode, 'university'),
        ],
      },
      curriculum: [[noneCode, unknownCode, universityCode]],
      grades: [['A', 'A', 'A']],
      dates: [TERM],
    });
    await waitForPrograms(page, noneCode);

    for (const code of [noneCode, unknownCode, universityCode]) {
      const result = await readMinorAllocation(page, 'FIN-MINOR', code);
      expect(result.allocation, `${code} must not become a free minor elective`).toBeNull();
      expect(result.totals.free).toEqual({ courses: 0, credits: 0 });
    }
  });

  test('the official minor catalog remains authoritative over a colliding overlay', async ({ page }) => {
    const code = 'FIN301';
    await seedPlan(page, {
      ...selectedPrograms({ doubleMajor: null, minor2: null, minor3: null }),
      customCourses: {
        CS: [custom(code, 'core', { Course_Name: 'Attempted primary override' })],
        'FIN-MINOR': [custom(code, 'area', { Course_Name: 'Attempted override' })],
      },
      curriculum: [[code]],
      grades: [['A']],
      dates: [TERM],
    });
    await waitForPrograms(page, code);

    const form = await openEditForm(page, code);
    await expect(categorySelect(form, 'CS')).toBeDisabled();
    await expect(categorySelect(form, 'CS')).toHaveValue('free');
    await expect(form.locator('.cc-row').filter({ hasText: /^\s*CS Category:/ }))
      .toContainText('The official catalog category applies to this course.');
    await expect(categorySelect(form, 'FIN-MINOR')).toBeDisabled();
    await expect(categorySelect(form, 'FIN-MINOR')).toHaveValue('required');
    await expect(form.locator('.cc-program-category-row[data-program="FIN-MINOR"]'))
      .toContainText('The official catalog category applies to this course.');
    await form.getByRole('button', { name: 'Cancel', exact: true }).click();

    const result = await page.evaluate((target) => {
      const rows = window.curriculum.minorCourseDataByCode['FIN-MINOR']
        .filter((course) => `${course.Major || ''}${course.Code || ''}` === target);
      const fn = window.computeMinorAllocation
        || (typeof computeMinorAllocation === 'function' ? computeMinorAllocation : null);
      const allocation = fn(window.curriculum, 'FIN-MINOR', { calculateProgramGpa: false });
      return {
        runtime: rows.map((course) => ({ type: course.EL_Type, name: course.Course_Name })),
        allocated: allocation.allocationByCode[target],
        storedPrimary: JSON.parse(window.planStorage.getItem('customCourses_CS') || '[]')[0],
        storedOverlay: JSON.parse(window.planStorage.getItem('customCourses_FIN-MINOR') || '[]')[0],
      };
    }, code);
    expect(result.runtime).toEqual([{ type: 'required', name: 'Financial Management' }]);
    expect(result.allocated).toMatchObject({ baseCat: 'required', allocatedCat: 'required' });
    // Keeping the dormant stored choice is useful if the user changes to a
    // catalog where the code is not official; it simply must not override this catalog.
    expect(result.storedPrimary.EL_Type).toBe('core');
    expect(result.storedOverlay.EL_Type).toBe('area');
  });

  test('bulk deletion preserves official courses and unrelated secondary overlays', async ({ page }) => {
    const codes = ['CS201', 'DSA395', 'FIN301'];
    await seedPlan(page, {
      ...selectedPrograms({ minor2: null, minor3: null }),
      customCourses: {
        CS: [custom('CS201', 'free', { Course_Name: 'Dormant CS override' })],
        DSA: [
          custom('CS201', 'area', {
            Course_Name: 'Linked DSA overlay',
            Engineering: 6,
          }),
          custom('DSA395', 'free', {
            Course_Name: 'Dormant DSA override',
            ECTS: '5',
            Engineering: 5,
            SU_credit: '0',
            Faculty: 'FENS',
          }),
          // Keep an unrelated DSA overlay to prove bulk deletion filters by
          // the primary custom-course code instead of clearing the whole key.
          custom('FIN301', 'none', { Course_Name: 'Unrelated DSA classification' }),
        ],
        'FIN-MINOR': [
          custom('CS201', 'free', { Course_Name: 'Linked FIN overlay' }),
          custom('FIN301', 'area', { Course_Name: 'Dormant FIN override' }),
        ],
      },
      curriculum: [codes],
      grades: [['A', 'A', 'A']],
      dates: [TERM],
    });
    await waitForPrograms(page, 'CS201');
    await page.waitForFunction(() => window.curriculum
      && Array.isArray(window.curriculum.doubleMajorCourseData)
      && window.curriculum.doubleMajorCourseData.some((course) =>
        `${course.Major || ''}${course.Code || ''}` === 'DSA395'));
    await expect(page.locator('.modal-overlay:visible'), 'exact catalog credits avoid the repair notice')
      .toHaveCount(0);
    await expect(page.locator('.double_major_overlay'), 'all planned codes are already classified')
      .toHaveCount(0);

    const before = await page.evaluate((targets) => ({
      occurrenceCodes: window.curriculum.semesters.flatMap((semester) => semester.courses)
        .map((course) => course.code).filter((code) => targets.includes(code)).sort(),
      primaryRows: course_data.filter((course) => `${course.Major}${course.Code}` === 'CS201')
        .map((course) => course.EL_Type),
      dmRows: window.curriculum.doubleMajorCourseData
        .filter((course) => `${course.Major}${course.Code}` === 'DSA395')
        .map((course) => course.EL_Type),
      minorRows: window.curriculum.minorCourseDataByCode['FIN-MINOR']
        .filter((course) => `${course.Major}${course.Code}` === 'FIN301')
        .map((course) => course.EL_Type),
    }), codes);
    expect(before.occurrenceCodes).toEqual(codes.slice().sort());
    expect(before.primaryRows).toEqual(['required']);
    expect(before.dmRows).toEqual(['required']);
    expect(before.minorRows).toEqual(['required']);

    await page.locator('.deleteCustom').click();
    const confirm = page.locator('.modal-overlay').filter({ hasText: /Delete custom courses/i });
    await expect(confirm).toBeVisible();
    await Promise.all([
      page.waitForNavigation(),
      confirm.getByRole('button', { name: 'Delete', exact: true }).click(),
    ]);
    await waitForPrograms(page, 'CS201');

    const after = await page.evaluate((targets) => ({
      occurrenceCodes: window.curriculum.semesters.flatMap((semester) => semester.courses)
        .map((course) => course.code).filter((code) => targets.includes(code)).sort(),
      storage: ['CS', 'DSA', 'FIN-MINOR'].map((program) =>
        JSON.parse(window.planStorage.getItem(`customCourses_${program}`) || '[]')),
    }), codes);
    expect(after.occurrenceCodes).toEqual(codes.slice().sort());
    expect(after.storage[0]).toEqual([]);
    expect(after.storage[1]).toEqual(expect.arrayContaining([
      expect.objectContaining({ Major: 'DSA', Code: '395', EL_Type: 'free' }),
      expect.objectContaining({ Major: 'FIN', Code: '301', EL_Type: 'none' }),
    ]));
    expect(after.storage[2]).toEqual([
      expect.objectContaining({ Major: 'FIN', Code: '301', EL_Type: 'area' }),
    ]);
  });

  test('custom required courses neither replace nor expand all-listed requirements', async ({ page }) => {
    const customCodes = ['ZZZ650', 'ZZZ651'];
    const officialCodes = ['MATH306', 'OPIM390'];
    await seedPlan(page, {
      ...selectedPrograms({
        doubleMajor: null,
        minor1: 'ANALY-MINOR',
        minor2: null,
        minor3: null,
      }),
      customCourses: {
        CS: customCodes.map((code) => custom(code, 'free')),
        'ANALY-MINOR': customCodes.map((code) => custom(code, 'required')),
      },
      curriculum: [[...officialCodes, ...customCodes]],
      grades: [['A', 'A', 'A', 'A']],
      dates: [TERM],
    });
    await waitForPrograms(page, customCodes[0]);

    const results = await page.evaluate(({ official, customOnly }) => {
      const fn = window.computeMinorAllocation
        || (typeof computeMinorAllocation === 'function' ? computeMinorAllocation : null);
      const run = (eligible) => fn(window.curriculum, 'ANALY-MINOR', {
        calculateProgramGpa: false,
        isEligible: (course) => eligible.includes(course.code),
      });
      const officialResult = run(official);
      const customResult = run(customOnly);
      return {
        official: {
          total: officialResult.totals.required,
          requiredOk: officialResult.perCatOk.required,
        },
        customOnly: {
          total: customResult.totals.required,
          requiredOk: customResult.perCatOk.required,
        },
      };
    }, { official: officialCodes, customOnly: customCodes });

    expect(results.official).toEqual({
      total: { courses: 2, credits: 6 },
      requiredOk: true,
    });
    expect(results.customOnly).toEqual({
      total: { courses: 2, credits: 6 },
      requiredOk: false,
    });
  });

  test('untouched secondary categories survive adding and renaming to their stored codes', async ({ page }) => {
    const addTarget = 'ZZZ655';
    const renameFrom = 'ZZZ656';
    const renameTarget = 'ZZZ657';
    await seedPlan(page, {
      ...selectedPrograms({
        minor2: null,
        entryTermMinor2: null,
        minor3: null,
        entryTermMinor3: null,
      }),
      customCourses: {
        CS: [custom(renameFrom, 'core')],
        DSA: [
          custom(addTarget, 'area', { Course_Name: 'Stored add target' }),
          custom(renameFrom, 'free', { Course_Name: 'Stored old rename row' }),
          custom(renameTarget, 'required', { Course_Name: 'Stored rename target' }),
        ],
      },
      curriculum: [[renameFrom]],
      grades: [['A']],
      dates: [TERM],
    });
    await waitForPrograms(page, renameFrom);

    const addForm = await openAddForm(page);
    await fillIdentity(addForm, addTarget, 'Added through primary');
    await categorySelect(addForm, 'CS').selectOption('free');
    await addForm.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(addForm).toBeHidden();
    expect((await readProgramDefinitions(page, ['DSA'], addTarget)).DSA).toMatchObject({
      type: 'area',
      name: 'Added through primary',
    });

    const editForm = await openEditForm(page, renameFrom);
    await editForm.locator('.cc-row').nth(0).locator('input').fill(renameTarget);
    await editForm.locator('.cc-row').nth(1).locator('input').fill('Renamed through primary');
    await editForm.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(editForm).toBeHidden();
    expect((await readProgramDefinitions(page, ['DSA'], renameTarget)).DSA).toMatchObject({
      type: 'required',
      name: 'Renamed through primary',
    });
    expect((await readProgramDefinitions(page, ['DSA'], renameFrom)).DSA).toBeNull();
  });

  test('rename and delete update every selected program overlay', async ({ page }) => {
    const oldCode = 'ZZZ660';
    const nextCode = 'ZZZ661';
    const programs = ['CS', 'DSA', 'FIN-MINOR', 'ANALY-MINOR', 'PHIL-MINOR'];
    const types = ['core', 'area', 'required', 'core', 'free'];
    await seedPlan(page, {
      ...selectedPrograms(),
      customCourses: Object.fromEntries(programs.map((program, index) => [
        program, [custom(oldCode, types[index], { Course_Name: 'Durable original' })],
      ])),
      curriculum: [[oldCode]],
      grades: [['B+']],
      gradingBases: [['letter']],
      dates: [TERM],
    });
    await waitForPrograms(page, oldCode);

    const form = await openEditForm(page, oldCode);
    await form.locator('.cc-row').nth(0).locator('input').fill(nextCode);
    await form.locator('.cc-row').nth(1).locator('input').fill('Renamed everywhere');
    await form.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(form).toBeHidden();

    let renamed = await readProgramDefinitions(page, programs, nextCode);
    for (let i = 0; i < programs.length; i++) {
      expect(renamed[programs[i]]).toMatchObject({
        code: nextCode, type: types[i], name: 'Renamed everywhere', credits: '3',
      });
    }
    const old = await readProgramDefinitions(page, programs, oldCode);
    for (const program of programs) expect(old[program]).toBeNull();

    await page.reload();
    await waitForPrograms(page, nextCode);
    renamed = await readProgramDefinitions(page, programs, nextCode);
    for (let i = 0; i < programs.length; i++) expect(renamed[programs[i]]?.type).toBe(types[i]);

    await page.locator('.manageCustomCourses').click();
    const manage = page.locator('.custom_course_manage_overlay');
    await manage.locator('.custom_course_manage_item', { hasText: nextCode })
      .getByRole('button', { name: /delete/i }).click();
    const confirm = page.locator('.modal-overlay').filter({ hasText: /Delete custom course/i });
    await confirm.getByRole('button', { name: 'Delete', exact: true }).click();

    await expect(page.locator('.course_code', { hasText: nextCode })).toHaveCount(0);
    const deleted = await readProgramDefinitions(page, programs, nextCode);
    for (const program of programs) expect(deleted[program]).toBeNull();
  });

  test('a later program-key write failure rolls back every earlier category and the planner rename', async ({ page, browserErrors }) => {
    const oldCode = 'ZZZ670';
    const nextCode = 'ZZZ671';
    const programs = ['CS', 'DSA', 'FIN-MINOR', 'ANALY-MINOR', 'PHIL-MINOR'];
    const types = ['core', 'area', 'required', 'core', 'free'];
    await seedPlan(page, {
      ...selectedPrograms(),
      customCourses: Object.fromEntries(programs.map((program, index) => [
        program, [custom(oldCode, types[index], { Course_Name: 'Before failed rename' })],
      ])),
      curriculum: [[oldCode]],
      grades: [['A-']],
      gradingBases: [['letter']],
      dates: [TERM],
    });
    await waitForPrograms(page, oldCode);

    await page.evaluate((rejectedCode) => {
      const original = Storage.prototype.setItem;
      window.__programCategoryStorageSetItem = original;
      window.__programCategoryWriteCount = 0;
      Storage.prototype.setItem = function setItemWithNthFailure(key, value) {
        let writesRejectedCode = false;
        try {
          writesRejectedCode = JSON.parse(String(value || '[]')).some((course) =>
            `${course.Major || ''}${course.Code || ''}`.toUpperCase() === rejectedCode);
        } catch (_) {}
        const isCandidateWrite = String(key || '').includes('customCourses_')
          && writesRejectedCode;
        if (isCandidateWrite) window.__programCategoryWriteCount += 1;
        if (isCandidateWrite && window.__programCategoryWriteCount === 4) {
          throw new DOMException('Synthetic custom-course quota failure', 'QuotaExceededError');
        }
        return original.call(this, key, value);
      };
    }, nextCode);

    const form = await openEditForm(page, oldCode);
    await form.locator('.cc-row').nth(0).locator('input').fill(nextCode);
    await form.locator('.cc-row').nth(1).locator('input').fill('Must roll back');
    await form.getByRole('button', { name: 'Save', exact: true }).click();
    const warning = page.locator('.modal-overlay').filter({ hasText: /Could not/i });
    const interception = await page.evaluate(() => ({
      count: window.__programCategoryWriteCount,
      keys: ['CS', 'DSA', 'FIN-MINOR', 'ANALY-MINOR', 'PHIL-MINOR'].map((program) => ({
        program,
        codes: JSON.parse(window.planStorage.getItem(`customCourses_${program}`) || '[]')
          .map((course) => `${course.Major}${course.Code}`),
      })),
    }));
    await expect(warning, JSON.stringify(interception)).toBeVisible();
    const expectedErrorIndex = browserErrors.findIndex((message) =>
      /console\.error: Failed to save plan data: QuotaExceededError/.test(message));
    expect(expectedErrorIndex).toBeGreaterThanOrEqual(0);
    browserErrors.splice(expectedErrorIndex, 1);
    await warning.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(form, 'the failed transaction remains reviewable').toBeVisible();

    const state = await page.evaluate(({ oldTarget, newTarget, keys }) => {
      const original = window.__programCategoryStorageSetItem;
      const read = (program) => JSON.parse(
        window.planStorage.getItem(`customCourses_${program}`) || '[]',
      );
      const normalize = (course) => `${course.Major || ''}${course.Code || ''}`;
      const result = {
        definitions: Object.fromEntries(keys.map((program) => [program, read(program).map(normalize)])),
        oldOccurrence: window.curriculum.hasCourse(oldTarget),
        newOccurrence: window.curriculum.hasCourse(newTarget),
        renderedOld: Array.from(document.querySelectorAll('.course_code'))
          .some((node) => node.textContent === oldTarget),
      };
      Storage.prototype.setItem = original;
      delete window.__programCategoryStorageSetItem;
      delete window.__programCategoryWriteCount;
      return result;
    }, { oldTarget: oldCode, newTarget: nextCode, keys: programs });
    expect(state.oldOccurrence).toBe(true);
    expect(state.newOccurrence).toBe(false);
    expect(state.renderedOld).toBe(true);
    for (const program of programs) expect(state.definitions[program]).toEqual([oldCode]);
  });
});
