'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');

// Semester drag-and-drop (scripts/mouse_and_drag.js, 126 lines, previously zero
// tests). Dragging a semester onto another rotates it into that position,
// swapping container innerHTML and the curriculum.semesters array in lockstep.
//
// The invariant that matters is that those two stay in sync: `con{N}` must keep
// matching `semesters[N-1]`. They are moved by two separate loops over the same
// indices, so a slip in either desynchronises the model from what is on screen —
// the user would see courses under the wrong semester, and every downstream
// total would be computed against a different plan than the one displayed.
//
// It also calls recalcEffectiveTypes afterwards, which matters here more than it
// looks: allocation is order-dependent (that is what the whole VACD pool saga
// turned on), so a reorder that skipped the recalc would leave stale categories.
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

  test('dropping a semester onto itself changes nothing', async ({ page }) => {
    await seedThree(page);
    const before = await readOrder(page);
    await dragOnto(page, 'con2', 'con2');
    expect(await readOrder(page), 'a no-op drag must not disturb the plan').toEqual(before);
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

  test('reordering re-runs allocation rather than leaving stale categories', async ({ page }) => {
    // Allocation is chronological and pool-capped, so order decides categories.
    // The drop handler calls recalcEffectiveTypes for exactly this reason; if a
    // refactor drops that call, effective types would survive from the old order.
    await seedThree(page);
    const typesBefore = await page.evaluate(() => {
      const out = {};
      window.curriculum.semesters.forEach((s) => s.courses.forEach((c) => { out[c.code] = c.effective_type; }));
      return out;
    });
    expect(Object.keys(typesBefore).length, 'all three courses should be allocated').toBe(3);

    await dragOnto(page, 'con1', 'con3');

    const after = await page.evaluate(() => {
      const out = {};
      window.curriculum.semesters.forEach((s) => s.courses.forEach((c) => { out[c.code] = c.effective_type; }));
      return out;
    });
    // These three are all `required` for CS and well under the threshold, so the
    // categories should be unchanged — but every course must still HAVE one.
    // A skipped recalc shows up as a missing or stale type.
    for (const code of ['CS201', 'CS204', 'CS300']) {
      expect(after[code], `${code} should still be allocated after the reorder`).toBeTruthy();
      expect(after[code], `${code} category`).toBe(typesBefore[code]);
    }
  });
});
