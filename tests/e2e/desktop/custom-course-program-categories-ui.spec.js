'use strict';

const fs = require('node:fs');
const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');
const {
  TERM,
  custom,
  categorySelect,
  categoryLabels,
  selectedPrograms,
  waitForPrograms,
  openAddForm,
  openEditForm,
  fillIdentity,
  readProgramDefinitions,
  addCourseToFirstSemester,
  readMinorAllocation,
} = require('../helpers/custom-course-program-categories');

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

    const modal = page.getByRole('dialog', { name: 'Set DSA Category' });
    await expect(modal).toBeVisible({ timeout: 15000 });
    await expect(modal).toHaveAttribute('aria-modal', 'true');
    await expect(modal.getByRole('heading', { name: 'Set DSA Category', exact: true }))
      .toBeVisible();
    await expect(modal.locator('.program-category-label-line > label'))
      .toHaveText('DSA Category:');
    await expect(modal.getByRole('combobox', { name: 'DSA Category:', exact: true }))
      .toHaveValue('core');
    await expect(modal.getByRole('combobox', { name: 'DSA Category:', exact: true }))
      .toBeFocused();

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

    await page.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);
  });
});
