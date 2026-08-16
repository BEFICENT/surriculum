'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');

const CHRONOLOGICAL_PLAN = {
  major: 'CS',
  entryTerm: 'Fall 2024-2025',
  curriculum: [['CS201'], ['CS204'], ['CS300']],
  grades: [['A'], ['A'], ['A']],
  dates: ['Fall 2024-2025', 'Spring 2024-2025', 'Fall 2025-2026'],
};

const visualPlannerStack = (page) => page.evaluate(() => {
  const elements = [
    ...document.querySelectorAll('.board .container_semester'),
    ...document.querySelectorAll('.board .add-semester-ghost'),
  ];
  return elements.map((element) => {
    const box = element.getBoundingClientRect();
    const label = element.classList.contains('add-semester-ghost')
      ? 'New Semester'
      : String((element.querySelector('.date p') || {}).textContent || '').trim();
    return {
      kind: element.classList.contains('add-semester-ghost') ? 'new-semester' : 'semester',
      label,
      top: box.top,
      left: box.left,
    };
  }).sort((left, right) => (left.top - right.top) || (left.left - right.left));
});

const visualSemesterTerms = async (page) => (await visualPlannerStack(page))
  .filter((row) => row.kind === 'semester')
  .map((row) => row.label);

const plannerAlignment = (page) => page.evaluate(() => ({
  dom: [...document.querySelectorAll('.container_semester')].map((container) => ({
    term: String((container.querySelector('.date p') || {}).textContent || '').trim(),
    codes: [...container.querySelectorAll('.course_code')]
      .map((element) => String(element.textContent || '').trim()),
  })),
  model: window.curriculum.semesters.map((semester) => ({
    term: semester.termName,
    codes: semester.courses.map((course) => course.code),
  })),
}));

const waitForThreeSemesterPlan = async (page) => {
  await expect(page.locator('.container_semester')).toHaveCount(3);
  await page.waitForFunction(() => window.curriculum
    && window.curriculum.semesters.length === 3
    && window.curriculum.semesters.every((semester) => semester.courses.length === 1));
};

test('mobile keeps New Semester first and presents saved semesters newest first after reload', async ({ page }) => {
  await seedPlan(page, CHRONOLOGICAL_PLAN);
  await expect(page.locator('body')).toHaveClass(/is-mobile/);
  await expect(page.locator('body')).toHaveAttribute('data-mobile-tab', 'planner');

  const expectedStack = [
    { kind: 'new-semester', label: 'New Semester' },
    { kind: 'semester', label: 'Fall 2025-2026' },
    { kind: 'semester', label: 'Spring 2024-2025' },
    { kind: 'semester', label: 'Fall 2024-2025' },
  ];
  const readStackContract = async () => {
    const stack = await visualPlannerStack(page);
    expect(stack.map(({ kind, label }) => ({ kind, label }))).toEqual(expectedStack);
    for (let index = 1; index < stack.length; index += 1) {
      expect(stack[index - 1].top, `${stack[index - 1].label} is above ${stack[index].label}`)
        .toBeLessThan(stack[index].top);
    }
  };

  await readStackContract();
  expect(await plannerAlignment(page)).toEqual({
    dom: [
      { term: 'Fall 2024-2025', codes: ['CS201'] },
      { term: 'Spring 2024-2025', codes: ['CS204'] },
      { term: 'Fall 2025-2026', codes: ['CS300'] },
    ],
    model: [
      { term: 'Fall 2024-2025', codes: ['CS201'] },
      { term: 'Spring 2024-2025', codes: ['CS204'] },
      { term: 'Fall 2025-2026', codes: ['CS300'] },
    ],
  });

  expect(await page.evaluate(() => window.planStorage.flushSaves())).toBe(true);
  await page.reload();
  await waitForThreeSemesterPlan(page);
  await expect(page.locator('body')).toHaveClass(/is-mobile/);
  await readStackContract();
});

test('live breakpoint changes only the presentation order and restores the desktop row', async ({ page }) => {
  await seedPlan(page, CHRONOLOGICAL_PLAN);

  await page.setViewportSize({ width: 900, height: 700 });
  await expect(page.locator('body')).not.toHaveClass(/is-mobile/);
  const desktopBefore = await visualPlannerStack(page);
  expect(desktopBefore.map((row) => row.label)).toEqual([
    'Fall 2024-2025',
    'Spring 2024-2025',
    'Fall 2025-2026',
    'New Semester',
  ]);
  for (let index = 1; index < desktopBefore.length; index += 1) {
    expect(desktopBefore[index - 1].left).toBeLessThan(desktopBefore[index].left);
  }

  await page.setViewportSize({ width: 800, height: 700 });
  await expect(page.locator('body')).toHaveClass(/is-mobile/);
  expect((await visualPlannerStack(page)).map((row) => row.label)).toEqual([
    'New Semester',
    'Fall 2025-2026',
    'Spring 2024-2025',
    'Fall 2024-2025',
  ]);

  await page.setViewportSize({ width: 900, height: 700 });
  await expect(page.locator('body')).not.toHaveClass(/is-mobile/);
  const desktopAfter = await visualPlannerStack(page);
  expect(desktopAfter.map((row) => row.label)).toEqual(desktopBefore.map((row) => row.label));
  expect(await plannerAlignment(page)).toEqual({
    dom: CHRONOLOGICAL_PLAN.dates.map((term, index) => ({
      term,
      codes: [CHRONOLOGICAL_PLAN.curriculum[index][0]],
    })),
    model: CHRONOLOGICAL_PLAN.dates.map((term, index) => ({
      term,
      codes: [CHRONOLOGICAL_PLAN.curriculum[index][0]],
    })),
  });
});

test('adding from the top control keeps the new latest term directly below it after reload', async ({ page }) => {
  await seedPlan(page, CHRONOLOGICAL_PLAN);
  const addSemester = page.locator('.add-semester-ghost');
  await expect(addSemester).toBeVisible();
  await addSemester.click();
  await expect(page.locator('.container_semester')).toHaveCount(4);

  const added = await page.evaluate(() => {
    const semester = window.curriculum.semesters[window.curriculum.semesters.length - 1];
    return {
      term: semester.termName,
      code: semester.termCode,
      modelTerms: window.curriculum.semesters.map((row) => row.termName),
    };
  });
  expect(added.code.localeCompare('202501'), 'the generated term follows the previous latest term')
    .toBeGreaterThan(0);
  expect((await visualPlannerStack(page)).map((row) => row.label)).toEqual([
    'New Semester',
    added.term,
    'Fall 2025-2026',
    'Spring 2024-2025',
    'Fall 2024-2025',
  ]);
  expect(added.modelTerms).toEqual([
    'Fall 2024-2025',
    'Spring 2024-2025',
    'Fall 2025-2026',
    added.term,
  ]);

  expect(await page.evaluate(() => window.planStorage.flushSaves())).toBe(true);
  await page.reload();
  await expect(page.locator('.container_semester')).toHaveCount(4);
  await page.waitForFunction(() => window.curriculum
    && window.curriculum.semesters.length === 4
    && window.curriculum.semesters.reduce((count, row) => count + row.courses.length, 0) === 3);
  expect((await visualPlannerStack(page)).map((row) => row.label)).toEqual([
    'New Semester',
    added.term,
    'Fall 2025-2026',
    'Spring 2024-2025',
    'Fall 2024-2025',
  ]);
});

test('mobile hides the desktop grip while visual button reordering preserves card state', async ({ page }) => {
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
  await expect(page.locator('body')).toHaveClass(/is-mobile/);
  await page.evaluate(({ current }) => {
    document.querySelectorAll('.container_semester').forEach((container) => {
      const term = String((container.querySelector('.date p') || {}).textContent || '').trim();
      container.classList.toggle('m-collapsed', term !== current);
    });
  }, { current: termNames.current });

  const handles = page.locator('.container_semester .semester_drag');
  await expect(handles).toHaveCount(3);
  for (const handle of await handles.all()) await expect(handle).toBeHidden();

  const currentCard = page.locator('.container_semester').filter({ hasText: termNames.current });
  await expect(currentCard).not.toHaveClass(/m-collapsed/);
  await page.getByRole('button', { name: `Move ${termNames.current} up` }).click();
  await page.getByRole('button', { name: `Move ${termNames.current} up` }).click();

  const state = await page.evaluate(() => ({
    model: window.curriculum.semesters.map((semester) => semester.courses.map((course) => course.code)),
    dom: [...document.querySelectorAll('.container_semester')].map((container) => ({
      term: String((container.querySelector('.date p') || {}).textContent || '').trim(),
      codes: [...container.querySelectorAll('.course_code')]
        .map((element) => String(element.textContent || '').trim()),
      current: container.classList.contains('current-term'),
      collapsed: container.classList.contains('m-collapsed'),
    })),
  }));
  expect(state.model).toEqual([['CS204'], ['CS300'], ['CS201']]);
  expect(state.dom.map((row) => row.codes)).toEqual(state.model);
  expect(state.dom[2]).toMatchObject({
    term: termNames.current,
    codes: ['CS201'],
    current: true,
    collapsed: false,
  });
  expect(state.dom[0].collapsed).toBe(true);
  expect(state.dom[1].collapsed).toBe(true);
  expect((await visualSemesterTerms(page))[0]).toBe(termNames.current);
});

test('mobile up/down controls follow the reversed visual stack and keep DOM/model aligned', async ({ page }) => {
  await seedPlan(page, CHRONOLOGICAL_PLAN);
  await page.evaluate(() => {
    document.querySelectorAll('.container_semester').forEach((container) => {
      container.classList.remove('m-collapsed');
    });
  });

  const topUp = page.getByRole('button', { name: 'Move Fall 2025-2026 up' });
  const topDown = page.getByRole('button', { name: 'Move Fall 2025-2026 down' });
  const middleUp = page.getByRole('button', { name: 'Move Spring 2024-2025 up' });
  const middleDown = page.getByRole('button', { name: 'Move Spring 2024-2025 down' });
  const bottomUp = page.getByRole('button', { name: 'Move Fall 2024-2025 up' });
  const bottomDown = page.getByRole('button', { name: 'Move Fall 2024-2025 down' });

  await expect(topUp).toBeVisible();
  await expect(topUp).toBeDisabled();
  await expect(topUp.locator('i')).toHaveClass(/fa-arrow-up/);
  await expect(topDown).toBeEnabled();
  await expect(topDown.locator('i')).toHaveClass(/fa-arrow-down/);
  await expect(middleUp).toBeEnabled();
  await expect(middleDown).toBeEnabled();
  await expect(bottomUp).toBeEnabled();
  await expect(bottomDown).toBeDisabled();
  expect(await visualSemesterTerms(page)).toEqual([
    'Fall 2025-2026',
    'Spring 2024-2025',
    'Fall 2024-2025',
  ]);

  await topDown.focus();
  await topDown.press('Enter');
  expect(await visualSemesterTerms(page)).toEqual([
    'Spring 2024-2025',
    'Fall 2025-2026',
    'Fall 2024-2025',
  ]);
  await expect(page.locator('#a11yStatus')).toHaveText(
    'Moved Fall 2025-2026 down to position 2 of 3.',
  );
  const afterDown = await plannerAlignment(page);
  expect(afterDown.dom).toEqual(afterDown.model);
  expect(afterDown.model.map((row) => row.codes)).toEqual([['CS201'], ['CS300'], ['CS204']]);

  const oldestUp = page.getByRole('button', { name: 'Move Fall 2024-2025 up' });
  await oldestUp.focus();
  await oldestUp.press('Space');
  expect(await visualSemesterTerms(page)).toEqual([
    'Spring 2024-2025',
    'Fall 2024-2025',
    'Fall 2025-2026',
  ]);
  await expect(page.locator('#a11yStatus')).toHaveText(
    'Moved Fall 2024-2025 up to position 2 of 3.',
  );
  const afterUp = await plannerAlignment(page);
  expect(afterUp.dom).toEqual(afterUp.model);
  expect(afterUp.model.map((row) => row.codes)).toEqual([['CS300'], ['CS201'], ['CS204']]);
});

test('deleting visual edge semesters refreshes the remaining move boundaries', async ({ page }) => {
  await seedPlan(page, CHRONOLOGICAL_PLAN);
  await page.evaluate(() => {
    document.querySelectorAll('.container_semester').forEach((container) => {
      container.classList.remove('m-collapsed');
    });
  });

  const newest = page.locator('.container_semester').filter({ hasText: 'Fall 2025-2026' });
  await newest.locator('.delete_semester').click();
  await expect(page.locator('.container_semester')).toHaveCount(2);
  expect(await visualSemesterTerms(page)).toEqual([
    'Spring 2024-2025',
    'Fall 2024-2025',
  ]);
  await expect(page.getByRole('button', { name: 'Move Spring 2024-2025 up' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Move Spring 2024-2025 down' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Move Fall 2024-2025 up' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Move Fall 2024-2025 down' })).toBeDisabled();

  const oldest = page.locator('.container_semester').filter({ hasText: 'Fall 2024-2025' });
  await oldest.locator('.delete_semester').click();
  await expect(page.locator('.container_semester')).toHaveCount(1);
  expect(await visualSemesterTerms(page)).toEqual(['Spring 2024-2025']);
  await expect(page.getByRole('button', { name: 'Move Spring 2024-2025 up' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Move Spring 2024-2025 down' })).toBeDisabled();

  const aligned = await plannerAlignment(page);
  expect(aligned.dom).toEqual(aligned.model);
  expect(aligned.model).toEqual([{ term: 'Spring 2024-2025', codes: ['CS204'] }]);
});
