'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');

const PLAN = {
  major: 'CS',
  entryTerm: 'Fall 2024-2025',
  curriculum: [['MATH101'], ['CS201'], ['CS204']],
  grades: [['A'], ['A'], ['A']],
  dates: ['Fall 2024-2025', 'Spring 2024-2025', 'Fall 2025-2026'],
};

const displayedTerms = (page) => page.locator('.container_semester .date p')
  .evaluateAll((labels) => labels.map((label) => String(label.textContent || '').trim()));

const modelCodes = (page) => page.evaluate(() => window.curriculum.semesters
  .map((semester) => semester.courses.map((course) => course.code)));

async function startSemesterDrag(page, sourceId) {
  const source = page.locator(`#${sourceId}`);
  const handle = source.locator('.semester_drag');
  await expect(handle).toBeVisible();
  await handle.hover();
  await expect(source).toHaveAttribute('draggable', 'true');
  await page.evaluate((id) => {
    window.__semesterPreviewTransfer = new DataTransfer();
    window.__semesterPreviewSource = document.querySelector(`#${id}`);
    window.__semesterPreviewSource.dispatchEvent(new DragEvent('dragstart', {
      bubbles: true,
      cancelable: true,
      dataTransfer: window.__semesterPreviewTransfer,
    }));
  }, sourceId);
  await expect(source).toHaveClass(/semester-dragging/);
}

async function dragOver(page, selector) {
  await page.evaluate((targetSelector) => {
    const target = document.querySelector(targetSelector);
    const box = target.getBoundingClientRect();
    target.dispatchEvent(new DragEvent('dragover', {
      bubbles: true,
      cancelable: true,
      clientX: box.left + box.width / 2,
      clientY: box.top + box.height / 2,
      dataTransfer: window.__semesterPreviewTransfer,
    }));
  }, selector);
}

async function dropOn(page, selector) {
  await page.evaluate((targetSelector) => {
    const target = document.querySelector(targetSelector);
    const box = target.getBoundingClientRect();
    target.dispatchEvent(new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      clientX: box.left + box.width / 2,
      clientY: box.top + box.height / 2,
      dataTransfer: window.__semesterPreviewTransfer,
    }));
  }, selector);
}

async function endSemesterDrag(page) {
  await page.evaluate(() => {
    window.__semesterPreviewSource.dispatchEvent(new DragEvent('dragend', {
      bubbles: true,
      cancelable: true,
      dataTransfer: window.__semesterPreviewTransfer,
    }));
  });
}

async function expectPreviewClean(page) {
  await expect(page.locator('.semester-drop-placeholder')).toHaveCount(0);
  await expect(page.locator('.semester-dragging')).toHaveCount(0);
  await expect(page.locator('.semester-drop-target')).toHaveCount(0);
  await expect(page.locator('[data-semester-drop-edge]')).toHaveCount(0);
}

async function expectSlotPreview(page, { sourceId, targetId, edge }) {
  const source = page.locator(`#${sourceId}`);
  const target = page.locator(`#${targetId}`);
  const placeholder = page.locator('.semester-drop-placeholder');
  await expect(placeholder).toHaveCount(1);
  await expect(placeholder).toBeVisible();
  await expect(placeholder).toHaveAttribute('aria-hidden', 'true');
  await expect(placeholder).toHaveAttribute('data-semester-drop-target-id', targetId);
  const sourceTerm = String(await source.locator('.date p').textContent()).trim();
  await expect(placeholder).toHaveText(`Move ${sourceTerm} here`);
  await expect(target).toHaveClass(/semester-drop-target/);
  await expect(target).toHaveAttribute('data-semester-drop-edge', edge);
  await expect(page.locator('.container_semester')).toHaveCount(3);

  const geometry = await page.evaluate(({ sourceSelector, targetSelector, expectedEdge }) => {
    const sourceElement = document.querySelector(sourceSelector);
    const targetElement = document.querySelector(targetSelector);
    const previewElement = document.querySelector('.semester-drop-placeholder');
    const sourceBox = sourceElement.getBoundingClientRect();
    const targetBox = targetElement.getBoundingClientRect();
    const previewBox = previewElement.getBoundingClientRect();
    const style = getComputedStyle(previewElement);
    return {
      widthDelta: Math.abs(sourceBox.width - previewBox.width),
      heightDelta: Math.abs(sourceBox.height - previewBox.height),
      onExpectedSide: expectedEdge === 'after'
        ? targetBox.right <= previewBox.left + 1
        : previewBox.right <= targetBox.left + 1,
      hasVisualCue: style.borderStyle !== 'none'
        || style.outlineStyle !== 'none'
        || style.backgroundColor !== 'rgba(0, 0, 0, 0)',
      isRealCard: previewElement.classList.contains('container_semester'),
    };
  }, {
    sourceSelector: `#${sourceId}`,
    targetSelector: `#${targetId}`,
    expectedEdge: edge,
  });
  expect(geometry.widthDelta).toBeLessThanOrEqual(2);
  expect(geometry.heightDelta).toBeLessThanOrEqual(2);
  expect(geometry.onExpectedSide).toBe(true);
  expect(geometry.hasVisualCue).toBe(true);
  expect(geometry.isRealCard).toBe(false);
}

test.describe('desktop semester insertion preview', () => {
  test('the preview occupies the committed slot in both directions and always cleans up', async ({ page }) => {
    await seedPlan(page, PLAN);
    const originalTerms = [
      'Fall 2024-2025',
      'Spring 2024-2025',
      'Fall 2025-2026',
    ];

    // Earlier -> later: the real cards do not jump while hovering. A full card
    // slot after the target shows exactly where the dragged semester will land.
    await startSemesterDrag(page, 'con1');
    await dragOver(page, '#con3 .date p');
    await expectSlotPreview(page, { sourceId: 'con1', targetId: 'con3', edge: 'after' });
    expect(await displayedTerms(page)).toEqual(originalTerms);
    expect(await modelCodes(page)).toEqual([['MATH101'], ['CS201'], ['CS204']]);

    await dropOn(page, '#con3 .date p');
    expect(await displayedTerms(page)).toEqual([
      'Spring 2024-2025',
      'Fall 2025-2026',
      'Fall 2024-2025',
    ]);
    expect(await modelCodes(page)).toEqual([['CS201'], ['CS204'], ['MATH101']]);
    await expectPreviewClean(page);

    // Later -> earlier: the placeholder displaces the target from beneath the
    // pointer, so it must itself remain a working dragover/drop surface.
    await startSemesterDrag(page, 'con3');
    await dragOver(page, '#con1 .date p');
    await expectSlotPreview(page, { sourceId: 'con3', targetId: 'con1', edge: 'before' });
    expect(await displayedTerms(page)).toEqual([
      'Spring 2024-2025',
      'Fall 2025-2026',
      'Fall 2024-2025',
    ]);
    await dragOver(page, '.semester-drop-placeholder');
    await expectSlotPreview(page, { sourceId: 'con3', targetId: 'con1', edge: 'before' });
    await dropOn(page, '.semester-drop-placeholder');
    expect(await displayedTerms(page)).toEqual(originalTerms);
    expect(await modelCodes(page)).toEqual([['MATH101'], ['CS201'], ['CS204']]);
    await expectPreviewClean(page);

    // Cancelling either with Escape or the browser's dragend leaves no false
    // insertion slot or highlighted target behind.
    await startSemesterDrag(page, 'con1');
    await dragOver(page, '#con3 .date p');
    await expect(page.locator('.semester-drop-placeholder')).toBeVisible();
    await page.keyboard.press('Escape');
    await expectPreviewClean(page);
    await endSemesterDrag(page);
    await expectPreviewClean(page);

    await startSemesterDrag(page, 'con1');
    await dragOver(page, '#con3 .date p');
    await expect(page.locator('.semester-drop-placeholder')).toBeVisible();
    await endSemesterDrag(page);
    await expectPreviewClean(page);
    expect(await displayedTerms(page)).toEqual(originalTerms);
    expect(await modelCodes(page)).toEqual([['MATH101'], ['CS201'], ['CS204']]);
  });
});
