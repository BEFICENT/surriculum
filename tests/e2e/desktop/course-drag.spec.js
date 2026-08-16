'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');

const course = (page, code) => page.locator(
  `.course:has(.course_code:text-is("${code}"))`,
);

const readPlan = (page) => page.evaluate(() => ({
  model: window.curriculum.semesters.map((semester) => ({
    termCode: semester.termCode,
    codes: semester.courses.map((item) => item.code),
    grades: semester.courses.map((item) => item.grade),
    gradingBases: semester.courses.map((item) => item.gradingBasis),
    totalLoadCredit: semester.totalLoadCredit,
    totalGPA: semester.totalGPA,
    totalGPACredits: semester.totalGPACredits,
  })),
  dom: [...document.querySelectorAll('.container_semester')].map((container) => ({
    term: String((container.querySelector('.date p') || {}).textContent || '').trim(),
    codes: [...container.querySelectorAll('.course_code')]
      .map((element) => String(element.textContent || '').trim()),
  })),
  stored: Object.fromEntries(
    ['curriculum', 'grades', 'gradingBases', 'dates', 'termCodes']
      .map((key) => [key, JSON.parse(window.planStorage.getItem(key))]),
  ),
}));

async function beginCourseDrag(page, code) {
  const card = course(page, code);
  const handle = card.locator('.course_drag');
  await expect(handle).toBeVisible();
  await expect(handle).toHaveAttribute('aria-label', `Move ${code} to another semester`);
  await expect(handle).toHaveAttribute('title', `Drag or choose where to move ${code}`);
  await expect(handle).toHaveAttribute('draggable', 'true');
  await handle.hover();
  // A prior cancelled drag can leave the pointer over the same handle, in
  // which case Playwright quite correctly emits no second mouseover. Dispatch
  // the real delegated event explicitly so each independent gesture is armed.
  await handle.dispatchEvent('mouseover');
  await expect(card).toHaveAttribute('draggable', 'true');
  await page.evaluate((courseCode) => {
    const source = [...document.querySelectorAll('.course')].find((element) => (
      String((element.querySelector('.course_code') || {}).textContent || '').trim() === courseCode
    ));
    window.__courseDndTransfer = new DataTransfer();
    window.__courseDndElement = source;
    window.__courseDndModel = window.curriculum.semesters
      .flatMap((semester) => semester.courses)
      .find((item) => item.id === source.id);
    source.dispatchEvent(new DragEvent('dragstart', {
      bubbles: true,
      cancelable: true,
      dataTransfer: window.__courseDndTransfer,
    }));
  }, code);
  await expect(card).toHaveClass(/course-dragging/);
}

async function dragOverCourse(page, code, edge = 'before') {
  await page.evaluate(({ courseCode, requestedEdge }) => {
    const target = [...document.querySelectorAll('.course')].find((element) => (
      String((element.querySelector('.course_code') || {}).textContent || '').trim() === courseCode
    ));
    const rect = target.getBoundingClientRect();
    target.dispatchEvent(new DragEvent('dragover', {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + rect.width / 2,
      clientY: requestedEdge === 'before' ? rect.top + 1 : rect.bottom - 1,
      dataTransfer: window.__courseDndTransfer,
    }));
  }, { courseCode: code, requestedEdge: edge });
}

async function dragOverSemester(page, term) {
  await page.evaluate((termName) => {
    const target = [...document.querySelectorAll('.container_semester')].find((container) => (
      String((container.querySelector('.date p') || {}).textContent || '').trim() === termName
    ));
    const rect = target.getBoundingClientRect();
    target.querySelector('.semester').dispatchEvent(new DragEvent('dragover', {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      dataTransfer: window.__courseDndTransfer,
    }));
  }, term);
}

async function dropCourse(page, target) {
  await page.evaluate((targetRef) => {
    const element = targetRef.startsWith('course:')
      ? [...document.querySelectorAll('.course')].find((candidate) => (
        String((candidate.querySelector('.course_code') || {}).textContent || '').trim()
          === targetRef.slice('course:'.length)
      ))
      : document.querySelector(targetRef);
    element.dispatchEvent(new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer: window.__courseDndTransfer,
    }));
  }, target);
}

async function endCourseDrag(page) {
  await page.evaluate(() => {
    window.__courseDndElement.dispatchEvent(new DragEvent('dragend', {
      bubbles: true,
      cancelable: true,
      dataTransfer: window.__courseDndTransfer,
    }));
  });
}

async function expectNoDragPreview(page) {
  await expect(page.locator('.course-drop-placeholder')).toHaveCount(0);
  await expect(page.locator('.course-dragging')).toHaveCount(0);
  await expect(page.locator('.course-drop-target')).toHaveCount(0);
  await expect(page.locator('.semester-dragging')).toHaveCount(0);
  await expect(page.locator('.semester-drop-target')).toHaveCount(0);
  await expect(page.locator('[data-semester-drop-edge]')).toHaveCount(0);
}

test.describe('desktop planner course drag-and-drop', () => {
  test('cross-semester move preserves the occurrence, grade, basis, storage, and reload', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [['MATH101', 'CS201'], ['MATH102', 'SPS101']],
      grades: [['B+', 'A'], ['S', 'C']],
      gradingBases: [['letter', 'letter'], ['satisfactory', 'letter']],
      dates: ['Fall 2024-2025', 'Spring 2024-2025'],
    });

    const sourceCard = course(page, 'MATH101');
    const sourceHandle = sourceCard.locator('.course_drag');
    const targetCard = course(page, 'MATH102');
    await expect(sourceHandle).toBeVisible();
    await expect(sourceHandle).toHaveAttribute('aria-label', 'Move MATH101 to another semester');
    await expect(sourceHandle).toHaveAttribute('title', 'Drag or choose where to move MATH101');
    await expect(sourceHandle).toHaveAttribute('draggable', 'true');
    expect(await sourceCard.getAttribute('draggable')).not.toBe('true');
    await page.evaluate(() => {
      const source = [...document.querySelectorAll('.course')].find((element) => (
        String((element.querySelector('.course_code') || {}).textContent || '').trim()
          === 'MATH101'
      ));
      window.__courseDndElement = source;
      window.__courseDndModel = window.curriculum.semesters[0].courses
        .find((item) => item.id === source.id);
    });
    const targetBox = await targetCard.boundingBox();
    expect(targetBox).not.toBeNull();
    await sourceHandle.dragTo(targetCard, {
      targetPosition: { x: Math.max(1, targetBox.width / 2), y: 1 },
    });

    expect(await page.evaluate(() => ({
      sameElement: document.querySelector('.course:has(.course_code:nth-child(1))') !== null
        && document.getElementById(window.__courseDndElement.id) === window.__courseDndElement,
      sameModel: window.curriculum.semesters[1].courses[0] === window.__courseDndModel,
      id: window.curriculum.semesters[1].courses[0].id,
      grade: window.curriculum.semesters[1].courses[0].grade,
      basis: window.curriculum.semesters[1].courses[0].gradingBasis,
    }))).toEqual({
      sameElement: true,
      sameModel: true,
      id: await course(page, 'MATH101').getAttribute('id'),
      grade: 'B+',
      basis: 'letter',
    });
    await expect(page.locator('#a11yStatus')).toHaveText(
      'Moved MATH101 to Spring 2024-2025.',
    );
    await expectNoDragPreview(page);

    const expected = {
      curriculum: [['CS201'], ['MATH101', 'MATH102', 'SPS101']],
      grades: [['A'], ['B+', 'S', 'C']],
      gradingBases: [['letter'], ['letter', 'satisfactory', 'letter']],
      dates: ['Fall 2024-2025', 'Spring 2024-2025'],
      termCodes: ['202401', '202402'],
    };
    const moved = await readPlan(page);
    expect(moved.model.map(({ codes, grades, gradingBases }) => ({ codes, grades, gradingBases })))
      .toEqual([
        { codes: ['CS201'], grades: ['A'], gradingBases: ['letter'] },
        {
          codes: ['MATH101', 'MATH102', 'SPS101'],
          grades: ['B+', 'S', 'C'],
          gradingBases: ['letter', 'satisfactory', 'letter'],
        },
      ]);
    expect(moved.dom.map((row) => row.codes)).toEqual(expected.curriculum);
    expect(moved.stored).toEqual(expected);

    await page.reload();
    await page.waitForFunction(() => window.curriculum
      && window.curriculum.semesters.length === 2
      && window.curriculum.semesters[1].courses.length === 3);
    const restored = await readPlan(page);
    expect(restored.dom.map((row) => row.codes)).toEqual(expected.curriculum);
    expect(restored.stored).toEqual(expected);
  });

  test('keyboard activation offers term destinations and moves the course to the selected tail', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [['MATH101'], ['CS201', 'CS204']],
      grades: [['B+'], ['A', 'C']],
      gradingBases: [['letter'], ['letter', 'letter']],
      dates: ['Fall 2024-2025', 'Spring 2024-2025'],
    });

    const handle = course(page, 'MATH101').locator('.course_drag');
    await handle.focus();
    await expect(handle).toBeFocused();
    await handle.press('Enter');

    const modal = page.locator('.modal.app-modal').filter({
      has: page.locator('.app-modal-title', { hasText: /^Move MATH101$/ }),
    });
    await expect(modal).toBeVisible();
    await expect(modal).toContainText(
      'Choose the destination semester. The course will be placed at the end.',
    );
    const destination = modal.locator(
      '.course-move-destination[data-course-move-destination]',
      { hasText: /^Spring 2024-2025$/ },
    );
    await expect(destination).toHaveCount(1);
    expect(await modal.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await expect(destination).toBeFocused();
    await destination.press('Enter');

    await expect(modal).toHaveCount(0);
    await expect(page.locator('#con1 .course')).toHaveCount(0);
    expect(await page.locator('#con2 .course_code').allTextContents()).toEqual([
      'CS201',
      'CS204',
      'MATH101',
    ]);
    await expect(page.locator('#a11yStatus')).toHaveText(
      'Moved MATH101 to Spring 2024-2025.',
    );
    await expect(course(page, 'MATH101').locator('.course_drag')).toBeFocused();
    const moved = await readPlan(page);
    expect(moved.stored.curriculum).toEqual([[], ['CS201', 'CS204', 'MATH101']]);
    expect(moved.stored.grades).toEqual([[], ['A', 'C', 'B+']]);
    expect(moved.stored.gradingBases).toEqual([[], ['letter', 'letter', 'letter']]);
    await expectNoDragPreview(page);
  });

  test('dragover shows a real insertion marker before/after a course and at the empty tail', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [['MATH101'], ['CS201', 'CS204']],
      grades: [['A'], ['B', 'C']],
      dates: ['Fall 2024-2025', 'Spring 2024-2025'],
    });
    await beginCourseDrag(page, 'MATH101');

    await dragOverCourse(page, 'CS201', 'before');
    const previewBefore = await page.evaluate(() => {
      const target = document.querySelector('#con2');
      const marker = target.querySelector('.course-drop-placeholder');
      const hovered = target.querySelector('.course:has(.course_code)');
      const children = [...target.querySelector('.semester').children];
      return {
        target: target.classList.contains('course-drop-target'),
        markerCount: document.querySelectorAll('.course-drop-placeholder').length,
        markerIndex: children.indexOf(marker),
        hoveredIndex: children.indexOf(hovered),
        markerTop: marker.getBoundingClientRect().top,
        hoveredTop: hovered.getBoundingClientRect().top,
        markerHeight: marker.getBoundingClientRect().height,
      };
    });
    expect(previewBefore).toMatchObject({
      target: true,
      markerCount: 1,
      markerIndex: 0,
      hoveredIndex: 1,
    });
    expect(previewBefore.markerTop).toBeLessThan(previewBefore.hoveredTop);
    expect(previewBefore.markerHeight).toBeGreaterThan(0);

    await dragOverCourse(page, 'CS201', 'after');
    const previewAfter = await page.evaluate(() => {
      const semester = document.querySelector('#con2 .semester');
      const marker = semester.querySelector('.course-drop-placeholder');
      const hovered = [...semester.querySelectorAll('.course')].find((element) => (
        element.querySelector('.course_code').textContent.trim() === 'CS201'
      ));
      const children = [...semester.children];
      return {
        markerCount: document.querySelectorAll('.course-drop-placeholder').length,
        markerIndex: children.indexOf(marker),
        hoveredIndex: children.indexOf(hovered),
        markerTop: marker.getBoundingClientRect().top,
        hoveredBottom: hovered.getBoundingClientRect().bottom,
      };
    });
    expect(previewAfter.markerCount).toBe(1);
    expect(previewAfter.markerIndex).toBe(previewAfter.hoveredIndex + 1);
    expect(previewAfter.markerTop).toBeGreaterThanOrEqual(previewAfter.hoveredBottom - 1);

    await dragOverSemester(page, 'Spring 2024-2025');
    expect(await page.evaluate(() => {
      const semester = document.querySelector('#con2 .semester');
      const marker = semester.querySelector('.course-drop-placeholder');
      return [...semester.children].indexOf(marker) === semester.children.length - 1;
    })).toBe(true);
    await endCourseDrag(page);
    await expectNoDragPreview(page);
  });

  test('Escape, dragend, outside, same-semester, and self drops leave the plan unchanged', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [['MATH101', 'CS204'], ['CS201']],
      grades: [['B+', 'C'], ['A']],
      gradingBases: [['letter', 'letter'], ['letter']],
      dates: ['Fall 2024-2025', 'Spring 2024-2025'],
    });
    const before = await readPlan(page);

    await beginCourseDrag(page, 'MATH101');
    await dragOverCourse(page, 'CS201', 'before');
    await page.keyboard.press('Escape');
    await expectNoDragPreview(page);
    await expect(course(page, 'MATH101')).toHaveAttribute('draggable', 'false');
    expect(await readPlan(page)).toEqual(before);
    await endCourseDrag(page);

    await beginCourseDrag(page, 'MATH101');
    await dragOverCourse(page, 'CS201', 'after');
    await endCourseDrag(page);
    await expectNoDragPreview(page);
    expect(await readPlan(page)).toEqual(before);

    await beginCourseDrag(page, 'MATH101');
    await dragOverCourse(page, 'CS204', 'after');
    await expect(page.locator('.course-drop-placeholder')).toHaveCount(0);
    await expect(page.locator('.course-drop-target')).toHaveCount(0);
    await dropCourse(page, 'course:CS204');
    await expectNoDragPreview(page);
    expect(await readPlan(page)).toEqual(before);

    await beginCourseDrag(page, 'MATH101');
    await dropCourse(page, 'body');
    await expectNoDragPreview(page);
    expect(await readPlan(page)).toEqual(before);

    await beginCourseDrag(page, 'MATH101');
    await dragOverCourse(page, 'MATH101', 'before');
    await dropCourse(page, 'course:MATH101');
    await expectNoDragPreview(page);
    expect(await readPlan(page)).toEqual(before);
  });

  test('moving a prerequisite into the same term recalculates totals and warnings, then moving it back clears them', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [['MATH101'], ['MATH102']],
      grades: [['A'], ['']],
      dates: ['Fall 2024-2025', 'Spring 2024-2025'],
    });
    await page.evaluate(async () => {
      await window.courseRequisites.refreshPlannerWarnings();
      window.__courseMoveRecalcCalls = 0;
      const original = window.curriculum.recalcEffectiveTypes;
      window.curriculum.recalcEffectiveTypes = function (...args) {
        window.__courseMoveRecalcCalls += 1;
        return original.apply(this, args);
      };
    });
    const prerequisiteWarning = page.locator(
      '.course:has(.course_code:text-is("MATH102")) '
      + '.planner-requisite-warning[data-warning-kind="prerequisite"]',
    );
    await expect(prerequisiteWarning).toHaveCount(0);

    await beginCourseDrag(page, 'MATH101');
    await dragOverCourse(page, 'MATH102', 'before');
    await dropCourse(page, 'course:MATH102');
    await expect(prerequisiteWarning).toContainText('MATH101');
    expect(await page.evaluate(() => window.__courseMoveRecalcCalls)).toBeGreaterThanOrEqual(1);
    expect((await readPlan(page)).model.map((row) => row.totalLoadCredit)).toEqual([0, 6]);

    await beginCourseDrag(page, 'MATH101');
    await dragOverSemester(page, 'Fall 2024-2025');
    await dropCourse(page, '#con1 .semester');
    await expect(prerequisiteWarning).toHaveCount(0);
    expect(await page.evaluate(() => window.__courseMoveRecalcCalls)).toBeGreaterThanOrEqual(2);
    expect((await readPlan(page)).model.map((row) => row.totalLoadCredit)).toEqual([3, 3]);
  });

  test('semester drag preview matches both committed directions and cleans up after drop and Escape', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [['MATH101'], ['CS201'], ['CS204']],
      grades: [['A'], ['A'], ['A']],
      dates: ['Fall 2024-2025', 'Spring 2024-2025', 'Fall 2025-2026'],
    });
    const startSemesterDrag = async (sourceId) => page.evaluate((id) => {
      window.__semesterDndTransfer = new DataTransfer();
      window.__semesterDndSource = document.querySelector(`#${id}`);
      window.__semesterDndSource.dispatchEvent(new DragEvent('dragstart', {
        bubbles: true,
        cancelable: true,
        dataTransfer: window.__semesterDndTransfer,
      }));
    }, sourceId);
    const previewSemester = async (targetId) => page.evaluate((id) => {
      const target = document.querySelector(`#${id}`);
      const inner = target.querySelector('.date p') || target.firstElementChild;
      inner.dispatchEvent(new DragEvent('dragover', {
        bubbles: true,
        cancelable: true,
        dataTransfer: window.__semesterDndTransfer,
      }));
    }, targetId);
    const dropSemester = async (targetId) => page.evaluate((id) => {
      const target = document.querySelector(`#${id}`);
      const inner = target.querySelector('.date p') || target.firstElementChild;
      inner.dispatchEvent(new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        dataTransfer: window.__semesterDndTransfer,
      }));
    }, targetId);
    const displayedTerms = () => page.locator('.container_semester .date p')
      .evaluateAll((labels) => labels.map((label) => label.textContent.trim()));

    await startSemesterDrag('con1');
    await expect(page.locator('#con1')).toHaveClass(/semester-dragging/);
    await previewSemester('con3');
    await expect(page.locator('#con3')).toHaveClass(/semester-drop-target/);
    await expect(page.locator('#con3')).toHaveAttribute('data-semester-drop-edge', 'after');
    expect(await page.locator('#con3').evaluate((element) => getComputedStyle(element, '::after').display))
      .toBe('block');
    await dropSemester('con3');
    expect(await displayedTerms()).toEqual([
      'Spring 2024-2025',
      'Fall 2025-2026',
      'Fall 2024-2025',
    ]);
    await expectNoDragPreview(page);

    await startSemesterDrag('con3');
    await expect(page.locator('#con3')).toHaveClass(/semester-dragging/);
    await previewSemester('con1');
    await expect(page.locator('#con1')).toHaveClass(/semester-drop-target/);
    await expect(page.locator('#con1')).toHaveAttribute('data-semester-drop-edge', 'before');
    expect(await page.locator('#con1').evaluate((element) => getComputedStyle(element, '::before').display))
      .toBe('block');
    await dropSemester('con1');
    expect(await displayedTerms()).toEqual([
      'Fall 2024-2025',
      'Spring 2024-2025',
      'Fall 2025-2026',
    ]);
    await expectNoDragPreview(page);

    await startSemesterDrag('con1');
    await previewSemester('con3');
    await page.keyboard.press('Escape');
    await expectNoDragPreview(page);
    await page.evaluate(() => {
      window.__semesterDndSource.dispatchEvent(new DragEvent('dragend', {
        bubbles: true,
        cancelable: true,
        dataTransfer: window.__semesterDndTransfer,
      }));
    });
    await expectNoDragPreview(page);
  });

  test('a final save failure restores the original model, DOM, and durable arrays', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [['MATH101'], ['CS201']],
      grades: [['B+'], ['A']],
      gradingBases: [['letter'], ['letter']],
      dates: ['Fall 2024-2025', 'Spring 2024-2025'],
    });
    const before = await readPlan(page);
    await page.evaluate(() => {
      window.planStorage.flushSaves();
      const original = window.planStorage.flushSaves.bind(window.planStorage);
      let calls = 0;
      window.planStorage.flushSaves = function (...args) {
        calls += 1;
        if (calls === 2) return false;
        return original(...args);
      };
    });

    await beginCourseDrag(page, 'MATH101');
    await dragOverCourse(page, 'CS201', 'before');
    await dropCourse(page, 'course:CS201');
    await expect(page.locator('.modal.app-modal').filter({ hasText: 'Course not moved' })).toBeVisible();
    expect(await readPlan(page)).toEqual(before);
    await expectNoDragPreview(page);

    await page.waitForTimeout(2200);
    expect((await readPlan(page)).stored).toEqual(before.stored);
    await page.reload();
    await page.waitForFunction(() => window.curriculum
      && window.curriculum.semesters.length === 2
      && window.curriculum.semesters.every((semester) => semester.courses.length === 1));
    expect(await readPlan(page)).toEqual(before);
  });

  test('canonical duplicate destination fails closed without moving either course', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [['CS210'], ['CS204']],
      grades: [['A'], ['B']],
      dates: ['Fall 2024-2025', 'Spring 2024-2025'],
    });
    await page.evaluate(() => {
      const targetSemester = window.curriculum.semesters[1];
      targetSemester.courses[0].code = 'DSA210';
      document.querySelector('#con2 .course_code').textContent = 'DSA210';
      window.planStorage.requestSave();
      window.planStorage.flushSaves();
    });
    const before = await readPlan(page);

    await beginCourseDrag(page, 'CS210');
    await dragOverCourse(page, 'DSA210', 'before');
    await dropCourse(page, 'course:DSA210');

    await expect(page.locator('.modal.app-modal').filter({ hasText: 'Course not moved' })).toBeVisible();
    expect(await readPlan(page)).toEqual(before);
    await expectNoDragPreview(page);
  });
});
