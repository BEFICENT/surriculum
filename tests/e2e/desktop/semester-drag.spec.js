'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');

// Semester drag-and-drop. Dragging a semester onto another rotates the complete
// card into that position together with the matching curriculum semester.
//
// The invariant that matters is that those two stay in sync: `con{N}` must keep
// matching `semesters[N-1]`. A slip in either side desynchronises the model from
// what is on screen —
// the user would see courses under the wrong semester, and every downstream
// total would be computed against a different plan than the one displayed.
//
// Card order is presentation-only. Academic chronology comes from canonical
// term codes, so a reorder must preserve the already-computed academic state.
const TERM_NAME = 'Fall 2024-2025';

const seedThree = (page) => seedPlan(page, {
  major: 'CS',
  entryTerm: TERM_NAME,
  curriculum: [['CS201'], ['CS204'], ['CS300']],
  grades: [['A'], ['A'], ['A']],
  dates: ['Fall 2024-2025', 'Spring 2024-2025', 'Fall 2025-2026'],
});

// Drive the real document-level handlers: dragstart records the dragged
// container, drop does the reorder. Playwright's dragTo can't be used — the
// containers only become draggable on mouseover of their handle, and the
// handler keys off e.target being the container itself.
const dragOnto = (page, fromId, toId) => page.evaluate(({ from, to }) => {
  const src = document.querySelector(`#${from}`);
  const dst = document.querySelector(`#${to}`);
  src.dispatchEvent(new DragEvent('dragstart', { bubbles: true }));
  // The drop must land on an element INSIDE the target container: the handler
  // resolves it with getAncestor(), which starts at parentNode and so never
  // matches the container itself. A real pointer always lands on inner content.
  const inner = dst.querySelector('.date p') || dst.firstElementChild;
  inner.dispatchEvent(new DragEvent('drop', { bubbles: true }));
}, { from: fromId, to: toId });

// Read DOM and model side by side so a desync is visible in the failure.
const readOrder = (page) => page.evaluate(() => ({
  dom: [...document.querySelectorAll('.container_semester')].map((c) => ({
    id: c.id,
    term: ((c.querySelector('.date p') || {}).textContent || '').trim(),
    codes: [...c.querySelectorAll('.course .course_code')].map((el) => (el.textContent || '').trim()),
  })),
  model: window.curriculum.semesters.map((s) => s.courses.map((c) => c.code)),
}));

const readDetailedOrder = (page) => page.evaluate(() => ({
  dom: [...document.querySelectorAll('.container_semester')].map((container) => ({
    term: String((container.querySelector('.date p') || {}).textContent || '').trim(),
    codes: [...container.querySelectorAll('.course .course_code')]
      .map((element) => String(element.textContent || '').trim()),
    collapsed: container.classList.contains('m-collapsed'),
    current: container.classList.contains('current-term'),
  })),
  model: window.curriculum.semesters.map((row) => ({
    term: row.termName,
    codes: row.courses.map((item) => item.code),
    grades: row.courses.map((item) => item.grade),
    gradingBases: row.courses.map((item) => item.gradingBasis),
  })),
}));

const readStoredPlannerArrays = (page) => page.evaluate(() => {
  const parse = (key) => JSON.parse(window.planStorage.getItem(key));
  return {
    curriculum: parse('curriculum'),
    grades: parse('grades'),
    gradingBases: parse('gradingBases'),
    dates: parse('dates'),
    termCodes: parse('termCodes'),
  };
});

const readAcademicSnapshot = (page) => page.evaluate(() => window.curriculum.semesters
  .map((semester) => ({
    termCode: semester.termCode,
    termName: semester.termName,
    totals: {
      totalLoadCredit: semester.totalLoadCredit,
      primaryAllocatedCredit: semester.primaryAllocatedCredit,
      primaryUnallocatedCredit: semester.primaryUnallocatedCredit,
      totalCredit: semester.totalCredit,
      totalArea: semester.totalArea,
      totalCore: semester.totalCore,
      totalFree: semester.totalFree,
      totalUniversity: semester.totalUniversity,
      totalRequired: semester.totalRequired,
      totalScience: semester.totalScience,
      totalEngineering: semester.totalEngineering,
      totalECTS: semester.totalECTS,
      totalGPA: semester.totalGPA,
      totalGPACredits: semester.totalGPACredits,
    },
    courses: semester.courses.map((course) => ({
      code: course.code,
      grade: course.grade,
      gradingBasis: course.gradingBasis,
      category: course.category || null,
      categoryDM: course.categoryDM || null,
      effectiveType: course.effective_type || null,
      effectiveTypeDM: course.effective_type_dm || null,
    })),
  }))
  .sort((left, right) => left.termCode.localeCompare(right.termCode)));

test.describe('semester drag-and-drop', () => {
  test('dragging the first semester onto the third rotates it into place', async ({ page }) => {
    await seedThree(page);
    await dragOnto(page, 'con1', 'con3');

    const { model } = await readOrder(page);
    // [CS201, CS204, CS300] -> the dragged semester moves to the end, the rest
    // shift up one.
    expect(model).toEqual([['CS204'], ['CS300'], ['CS201']]);
  });

  test('dragging the last semester onto the first rotates the other way', async ({ page }) => {
    await seedThree(page);
    await dragOnto(page, 'con3', 'con1');
    const { model } = await readOrder(page);
    expect(model).toEqual([['CS300'], ['CS201'], ['CS204']]);
  });

  test('the rendered order stays in sync with the model', async ({ page }) => {
    // The invariant. The DOM and the array are reordered by two separate loops;
    // if they ever disagree, the user is looking at a different plan than the
    // one being scored.
    await seedThree(page);
    await dragOnto(page, 'con1', 'con3');

    const { dom, model } = await readOrder(page);
    expect(dom.map((d) => d.id), 'container ids stay in document order').toEqual(['con1', 'con2', 'con3']);
    for (let i = 0; i < dom.length; i++) {
      expect(dom[i].codes, `${dom[i].id} on screen should match semesters[${i}] in the model`).toEqual(model[i]);
    }
  });

  test('a semester carries its term label with it', async ({ page }) => {
    await seedThree(page);
    await dragOnto(page, 'con1', 'con3');
    const { dom } = await readOrder(page);
    // The whole container's content moves, dates included — so the dragged
    // semester keeps its own term rather than inheriting the slot's.
    expect(dom.map((d) => d.term)).toEqual(['Spring 2024-2025', 'Fall 2025-2026', 'Fall 2024-2025']);
  });

  test('drag persistence keeps courses, grades, grading bases, and dates aligned after reload', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: TERM_NAME,
      curriculum: [['CS201'], ['CS204'], ['CS300']],
      grades: [['B+'], ['S'], ['A-']],
      gradingBases: [['letter'], ['satisfactory'], ['letter']],
      dates: ['Fall 2024-2025', 'Spring 2024-2025', 'Fall 2025-2026'],
    });

    await dragOnto(page, 'con1', 'con3');
    expect(await page.evaluate(() => window.planStorage.flushSaves())).toBe(true);

    const expected = {
      curriculum: [['CS204'], ['CS300'], ['CS201']],
      grades: [['S'], ['A-'], ['B+']],
      gradingBases: [['satisfactory'], ['letter'], ['letter']],
      dates: ['Spring 2024-2025', 'Fall 2025-2026', 'Fall 2024-2025'],
      termCodes: ['202402', '202501', '202401'],
    };
    expect(await readStoredPlannerArrays(page)).toEqual(expected);

    await page.reload();
    await expect(page.locator('.container_semester')).toHaveCount(3);
    await page.waitForFunction(() => window.curriculum
      && window.curriculum.semesters.length === 3
      && window.curriculum.semesters.every((row) => row.courses.length === 1));

    const restored = await readDetailedOrder(page);
    expect(restored.dom.map((row) => ({ term: row.term, codes: row.codes }))).toEqual([
      { term: 'Spring 2024-2025', codes: ['CS204'] },
      { term: 'Fall 2025-2026', codes: ['CS300'] },
      { term: 'Fall 2024-2025', codes: ['CS201'] },
    ]);
    expect(restored.model).toEqual([
      { term: 'Spring 2024-2025', codes: ['CS204'], grades: ['S'], gradingBases: ['satisfactory'] },
      { term: 'Fall 2025-2026', codes: ['CS300'], grades: ['A-'], gradingBases: ['letter'] },
      { term: 'Fall 2024-2025', codes: ['CS201'], grades: ['B+'], gradingBases: ['letter'] },
    ]);
  });

  test('current-term highlighting and disclosure state travel with the moved semester', async ({ page }) => {
    await page.goto('/');
    const termNames = await page.evaluate(() => {
      const current = String(window.currentTermCode || '');
      const year = Number(current.slice(0, 4));
      const suffix = current.slice(4);
      const previous = suffix === '03' ? `${year}02`
        : (suffix === '02' ? `${year}01` : `${year - 1}03`);
      const next = suffix === '01' ? `${year}02`
        : (suffix === '02' ? `${year}03` : `${year + 1}01`);
      return {
        current: window.currentTermName,
        previous: window.termCodeToName(previous),
        next: window.termCodeToName(next),
      };
    });
    await seedPlan(page, {
      major: 'CS',
      entryTerm: termNames.previous,
      curriculum: [['CS201'], ['CS204'], ['CS300']],
      grades: [['A'], ['A'], ['A']],
      dates: [termNames.current, termNames.previous, termNames.next],
    });
    await page.evaluate(({ current }) => {
      document.querySelectorAll('.container_semester').forEach((container) => {
        const term = String((container.querySelector('.date p') || {}).textContent || '').trim();
        container.classList.toggle('m-collapsed', term !== current);
      });
    }, { current: termNames.current });

    await dragOnto(page, 'con1', 'con3');
    const moved = page.locator('.container_semester').filter({ hasText: termNames.current });
    await expect(moved).toHaveCount(1);
    await expect(moved).toHaveClass(/current-term/);
    await expect(moved).not.toHaveClass(/m-collapsed/);
    await expect(page.locator('.container_semester').nth(2)).toContainText(termNames.current);
    await expect(page.locator('.container_semester').nth(0)).toHaveClass(/m-collapsed/);
    await expect(page.locator('.container_semester').nth(1)).toHaveClass(/m-collapsed/);
  });

  test('desktop move controls use left/right directions and move cards horizontally', async ({ page }) => {
    await seedThree(page);
    await expect(page.locator('body')).not.toHaveClass(/is-mobile/);

    const cardFor = (term) => page.locator('.container_semester').filter({ hasText: term });
    const first = cardFor('Fall 2024-2025');
    const middle = cardFor('Spring 2024-2025');
    const last = cardFor('Fall 2025-2026');
    const firstPrevious = first.locator('.semester_move_previous');
    const firstNext = first.locator('.semester_move_next');
    const middlePrevious = middle.locator('.semester_move_previous');
    const middleNext = middle.locator('.semester_move_next');
    const lastNext = last.locator('.semester_move_next');

    await expect(firstPrevious).toBeVisible();
    await expect(firstPrevious).toBeDisabled();
    await expect(firstPrevious).toHaveAttribute('aria-label', 'Move Fall 2024-2025 left');
    await expect(firstPrevious).toHaveAttribute('title', 'Move Fall 2024-2025 left');
    await expect(firstPrevious.locator('i')).toHaveClass(/fa-arrow-left/);
    await expect(firstNext).toBeEnabled();
    await expect(firstNext).toHaveAttribute('aria-label', 'Move Fall 2024-2025 right');
    await expect(firstNext).toHaveAttribute('title', 'Move Fall 2024-2025 right');
    await expect(firstNext.locator('i')).toHaveClass(/fa-arrow-right/);
    await expect(middlePrevious).toBeEnabled();
    await expect(middleNext).toBeEnabled();
    await expect(lastNext).toBeDisabled();

    const horizontalRows = async () => page.locator('.container_semester').evaluateAll((containers) => (
      containers.map((container) => ({
        code: String((container.querySelector('.course_code') || {}).textContent || '').trim(),
        left: container.getBoundingClientRect().left,
      }))
    ));
    const before = await horizontalRows();
    expect(before.map((row) => row.code)).toEqual(['CS201', 'CS204', 'CS300']);
    expect(before[0].left).toBeLessThan(before[1].left);
    expect(before[1].left).toBeLessThan(before[2].left);

    await firstNext.focus();
    await firstNext.press('Enter');
    const afterRight = await horizontalRows();
    expect(afterRight.map((row) => row.code)).toEqual(['CS204', 'CS201', 'CS300']);
    expect(afterRight[0].left).toBeLessThan(afterRight[1].left);
    expect(afterRight[1].left).toBeLessThan(afterRight[2].left);
    expect((await readOrder(page)).model).toEqual([['CS204'], ['CS201'], ['CS300']]);
    await expect(page.locator('#a11yStatus')).toHaveText(
      'Moved Fall 2024-2025 right to position 2 of 3.',
    );
    await expect(cardFor('Fall 2024-2025').locator('.semester_move_next')).toBeFocused();

    const lastPrevious = cardFor('Fall 2025-2026').locator('.semester_move_previous');
    await lastPrevious.focus();
    await lastPrevious.press('Space');
    const afterLeft = await horizontalRows();
    expect(afterLeft.map((row) => row.code)).toEqual(['CS204', 'CS300', 'CS201']);
    expect(afterLeft[0].left).toBeLessThan(afterLeft[1].left);
    expect(afterLeft[1].left).toBeLessThan(afterLeft[2].left);
    expect((await readOrder(page)).model).toEqual([['CS204'], ['CS300'], ['CS201']]);
    await expect(page.locator('#a11yStatus')).toHaveText(
      'Moved Fall 2025-2026 left to position 2 of 3.',
    );
    await expect(cardFor('Fall 2025-2026').locator('.semester_move_previous')).toBeFocused();
    await expect(page.locator('#con1 .semester_move_previous')).toBeDisabled();
    await expect(page.locator('#con3 .semester_move_next')).toBeDisabled();
  });

  test('live desktop/mobile resize updates move directions without replacing or blurring the control', async ({ page }) => {
    await page.setViewportSize({ width: 900, height: 700 });
    await seedThree(page);
    await expect(page.locator('body')).not.toHaveClass(/is-mobile/);

    const latest = page.locator('.container_semester').filter({ hasText: 'Fall 2025-2026' });
    const previous = latest.locator('.semester_move_previous');
    const next = latest.locator('.semester_move_next');
    await expect(previous).toBeVisible();
    await expect(previous).toHaveAttribute('aria-label', 'Move Fall 2025-2026 left');
    await expect(previous.locator('i')).toHaveClass(/fa-arrow-left/);
    await previous.focus();
    await expect(previous).toBeFocused();

    await page.setViewportSize({ width: 800, height: 700 });
    await expect(page.locator('body')).toHaveClass(/is-mobile/);
    await expect(previous).toBeVisible();
    // Mobile visually reverses the persisted desktop row: this DOM-last card
    // is now at the top, so its previous-slot action moves down and its
    // next-slot action is the disabled visual Up boundary.
    await expect(previous).toHaveAttribute('aria-label', 'Move Fall 2025-2026 down');
    await expect(previous).toHaveAttribute('title', 'Move Fall 2025-2026 down');
    await expect(previous.locator('i')).toHaveClass(/fa-arrow-down/);
    await expect(next).toHaveAttribute('aria-label', 'Move Fall 2025-2026 up');
    await expect(next.locator('i')).toHaveClass(/fa-arrow-up/);
    await expect(next).toBeDisabled();
    await expect(previous).toBeFocused();

    await page.setViewportSize({ width: 900, height: 700 });
    await expect(page.locator('body')).not.toHaveClass(/is-mobile/);
    await expect(previous).toHaveAttribute('aria-label', 'Move Fall 2025-2026 left');
    await expect(previous.locator('i')).toHaveClass(/fa-arrow-left/);
    await expect(next).toHaveAttribute('aria-label', 'Move Fall 2025-2026 right');
    await expect(next.locator('i')).toHaveClass(/fa-arrow-right/);
    await expect(previous).toBeFocused();
  });

  test('Sort Semesters orders oldest to newest while preserving each card disclosure state', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: TERM_NAME,
      curriculum: [['CS300'], ['CS204'], ['CS201']],
      grades: [['A-'], ['S'], ['B+']],
      gradingBases: [['letter'], ['satisfactory'], ['letter']],
      dates: ['Fall 2025-2026', 'Spring 2024-2025', 'Fall 2024-2025'],
    });
    await page.evaluate(() => {
      const states = new Map([
        ['CS300', true],
        ['CS204', false],
        ['CS201', true],
      ]);
      document.querySelectorAll('.container_semester').forEach((container) => {
        const code = String((container.querySelector('.course_code') || {}).textContent || '').trim();
        container.classList.toggle('m-collapsed', states.get(code));
      });
    });

    const sort = page.getByRole('button', { name: 'Sort semesters chronologically' });
    const lowerPlannerActions = page.locator('.control-group').filter({ has: page.locator('.autoAdd') });
    await expect(lowerPlannerActions, 'the sort action belongs with the lower planner utilities').toHaveCount(1);
    await expect(lowerPlannerActions.locator('#sortSemestersChronologically')).toHaveCount(1);
    await expect(page.locator('.control-group').filter({ has: page.locator('.addSemester') })
      .locator('#sortSemestersChronologically')).toHaveCount(0);
    await expect(sort).toHaveText(/Sort Semesters/);
    await sort.click();

    const sorted = await readDetailedOrder(page);
    expect(sorted.dom.map((row) => ({ term: row.term, codes: row.codes, collapsed: row.collapsed }))).toEqual([
      { term: 'Fall 2024-2025', codes: ['CS201'], collapsed: true },
      { term: 'Spring 2024-2025', codes: ['CS204'], collapsed: false },
      { term: 'Fall 2025-2026', codes: ['CS300'], collapsed: true },
    ]);
    expect(sorted.model.map((row) => ({ term: row.term, codes: row.codes }))).toEqual([
      { term: 'Fall 2024-2025', codes: ['CS201'] },
      { term: 'Spring 2024-2025', codes: ['CS204'] },
      { term: 'Fall 2025-2026', codes: ['CS300'] },
    ]);
    await expect(page.locator('#a11yStatus')).toHaveText(
      'Sorted semesters chronologically from oldest to newest.',
    );
  });

  test('dropping a semester onto itself changes nothing', async ({ page }) => {
    await seedThree(page);
    const before = await readOrder(page);
    await dragOnto(page, 'con2', 'con2');
    expect(await readOrder(page), 'a no-op drag must not disturb the plan').toEqual(before);
  });

  test('deleting the last card then adding one keeps contiguous ids and a working drag path', async ({ page }) => {
    await seedThree(page);
    await page.locator('#con3 .delete_semester').click();
    await expect(page.locator('.container_semester')).toHaveCount(2);
    await page.locator('.addSemester').click();
    await expect(page.locator('.container_semester')).toHaveCount(3);

    expect(await page.locator('.container_semester').evaluateAll((rows) => rows.map((row) => row.id)))
      .toEqual(['con1', 'con2', 'con3']);
    expect(await page.evaluate(() => window.curriculum.container_id)).toBe(3);

    const newTerm = await page.locator('#con3 .date p').textContent();
    await dragOnto(page, 'con3', 'con1');
    const moved = await readOrder(page);
    expect(moved.dom.map((row) => row.id)).toEqual(['con1', 'con2', 'con3']);
    expect(moved.dom[0]).toMatchObject({ term: String(newTerm).trim(), codes: [] });
    expect(moved.model).toEqual([[], ['CS201'], ['CS204']]);
  });

  test('dropping outside any semester is inert and does not throw', async ({ page, browserErrors }) => {
    // The handler only acts when the drop target has a .container_semester
    // ancestor. Anywhere else must be a no-op — and crucially must not throw:
    // getAncestor walks up to `document`, which has no classList, so an
    // unmatched search used to raise "Cannot read properties of undefined
    // (reading 'contains')" on every drag released over the page background.
    await seedThree(page);
    const before = await readOrder(page);
    await page.evaluate(() => {
      document.querySelector('#con1').dispatchEvent(new DragEvent('dragstart', { bubbles: true }));
      document.body.dispatchEvent(new DragEvent('drop', { bubbles: true }));
    });
    expect(await readOrder(page), 'a drop on the page background must be inert').toEqual(before);
    expect(browserErrors, 'the drop handler must not throw').toEqual([]);
  });

  test('getAncestor returns null instead of throwing at the top of the tree', async ({ page }) => {
    // The root cause, pinned directly: the walk ends at `document`, which is not
    // an Element and has no classList.
    await seedThree(page);
    const r = await page.evaluate(() => {
      try {
        return { value: getAncestor(document.body, 'container_semester') };
      } catch (e) {
        return { threw: String((e && e.message) || e) };
      }
    });
    expect(r.threw, `getAncestor threw: ${r.threw}`).toBeUndefined();
    expect(r.value, 'no matching ancestor should yield null').toBeNull();
  });

  test('reordering is presentation-only and preserves the academic snapshot', async ({ page }) => {
    await seedThree(page);
    await page.evaluate(() => {
      window.__semesterRecalcCalls = { main: 0, doubleMajor: 0 };
      const wrap = (name, counter) => {
        if (typeof window.curriculum[name] !== 'function') return;
        const original = window.curriculum[name];
        window.curriculum[name] = function (...args) {
          window.__semesterRecalcCalls[counter] += 1;
          return original.apply(this, args);
        };
      };
      wrap('recalcEffectiveTypes', 'main');
      wrap('recalcEffectiveTypesDouble', 'doubleMajor');
    });
    const before = await readAcademicSnapshot(page);

    await dragOnto(page, 'con1', 'con3');

    expect(await page.evaluate(() => window.__semesterRecalcCalls)).toEqual({
      main: 0,
      doubleMajor: 0,
    });
    expect(await readAcademicSnapshot(page)).toEqual(before);
  });
});
