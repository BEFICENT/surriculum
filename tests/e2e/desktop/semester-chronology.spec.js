'use strict';

const fs = require('node:fs');
const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');

const FALL = 'Fall 2024-2025';
const SPRING = 'Spring 2024-2025';

const readPlannerState = (page) => page.evaluate(() => {
  const parse = (key) => JSON.parse(window.planStorage.getItem(key));
  return {
    model: window.curriculum.semesters.map((semester) => ({
      term: semester.termName,
      codes: semester.courses.map((course) => course.code),
      grades: semester.courses.map((course) => course.grade),
      gradingBases: semester.courses.map((course) => course.gradingBasis),
    })),
    stored: {
      curriculum: parse('curriculum'),
      grades: parse('grades'),
      gradingBases: parse('gradingBases'),
      dates: parse('dates'),
      termCodes: parse('termCodes'),
    },
  };
});

test.describe('semester chronology guards', () => {
  test('editing a semester to an existing canonical term is rejected without mutation', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: FALL,
      curriculum: [['CS201'], ['CS204']],
      grades: [['A'], ['B+']],
      gradingBases: [['letter'], ['letter']],
      dates: [FALL, SPRING],
    });
    expect(await page.evaluate(() => window.planStorage.flushSaves())).toBe(true);
    const before = await readPlannerState(page);

    await page.getByRole('button', { name: `Edit ${SPRING} term` }).click();
    const editor = page.locator('#con2 .date select');
    await editor.selectOption(FALL);
    await page.getByRole('button', { name: 'Save semester term' }).click();

    const alert = page.getByRole('dialog', { name: 'Semester already exists' });
    await expect(alert).toBeVisible();
    await expect(editor, 'the rejected value remains open for correction').toBeVisible();
    await expect(editor).toHaveValue(FALL);
    expect(await readPlannerState(page)).toEqual(before);

    await alert.getByRole('button', { name: 'OK', exact: true }).click();
    await expect(editor, 'dismissing the explanation must not close the term editor').toBeVisible();
  });

  test('New Semester skips a wrapped candidate that is already used', async ({ page }) => {
    await page.goto('/');
    const boundary = await page.evaluate(() => {
      const newest = terms[0];
      let wrapped = '';
      for (let distance = 1; distance < terms.length; distance += 1) {
        const candidate = terms[(terms.length - distance) % terms.length];
        if (!String(candidate).includes('Summer')) {
          wrapped = candidate;
          break;
        }
      }
      return { newest, wrapped };
    });
    expect(boundary.newest).toBeTruthy();
    expect(boundary.wrapped).toBeTruthy();
    expect(boundary.wrapped).not.toBe(boundary.newest);

    await seedPlan(page, {
      major: 'CS',
      entryTerm: boundary.wrapped,
      curriculum: [['CS201'], ['CS204']],
      grades: [['A'], ['A']],
      dates: [boundary.newest, boundary.wrapped],
    });
    await page.locator('.addSemester').click();
    await expect(page.locator('.container_semester')).toHaveCount(3);

    const identities = await page.evaluate(() => window.curriculum.semesters.map((semester) => ({
      term: semester.termName,
      code: window.semesterTermCode(semester),
    })));
    expect(identities.every((item) => item.code), 'every interactive semester has a valid term').toBe(true);
    expect(new Set(identities.map((item) => item.code)).size,
      `New Semester produced a duplicate: ${JSON.stringify(identities)}`).toBe(identities.length);
  });

  test('legacy duplicate-term rows survive sorting, saving, and reload without skewing parallel data', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: FALL,
      curriculum: [['CS204'], ['CS201']],
      grades: [['S'], ['B+']],
      gradingBases: [['satisfactory'], ['letter']],
      dates: [FALL, FALL],
    });

    const canonicalRows = (rows) => rows.map((row) => JSON.stringify(row)).sort();
    const expectedRows = canonicalRows([
      { term: FALL, codes: ['CS204'], grades: ['S'], gradingBases: ['satisfactory'] },
      { term: FALL, codes: ['CS201'], grades: ['B+'], gradingBases: ['letter'] },
    ]);
    expect(canonicalRows((await readPlannerState(page)).model)).toEqual(expectedRows);

    await page.getByRole('button', { name: 'Sort semesters chronologically' }).click();
    expect(await page.evaluate(() => window.planStorage.flushSaves())).toBe(true);
    expect(canonicalRows((await readPlannerState(page)).model)).toEqual(expectedRows);

    await page.reload();
    await expect(page.locator('.container_semester')).toHaveCount(2);
    await page.waitForFunction(() => window.curriculum
      && window.curriculum.semesters.length === 2
      && window.curriculum.semesters.every((semester) => semester.courses.length === 1));
    const restored = await readPlannerState(page);
    expect(canonicalRows(restored.model)).toEqual(expectedRows);
    expect(restored.stored.dates).toEqual([FALL, FALL]);
    expect(restored.stored.termCodes).toEqual(['202401', '202401']);
    expect(restored.stored.curriculum.flat().sort()).toEqual(['CS201', 'CS204']);
    expect(restored.stored.grades.flat().sort()).toEqual(['B+', 'S']);
    expect(restored.stored.gradingBases.flat().sort()).toEqual(['letter', 'satisfactory']);
  });

  test('a legacy dates-only plan hydrates canonical identities and exports them as v4', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: FALL,
      curriculum: [['CS201'], ['CS204']],
      grades: [['A'], ['B+']],
      dates: [FALL, SPRING],
    });
    await page.evaluate(() => {
      const id = window.planStorage.getActivePlanId();
      const key = Object.keys(localStorage).find((candidate) => (
        candidate.includes(`.${id}.`) && candidate.endsWith('.termCodes')
      ));
      if (!key) throw new Error('Could not locate the active plan termCodes key');
      localStorage.removeItem(key);
    });

    await page.reload();
    await page.waitForFunction(() => window.curriculum
      && window.curriculum.semesters.length === 2
      && window.curriculum.semesters.every((semester) => semester.courses.length === 1));
    expect(await page.evaluate(() => window.curriculum.semesters.map((semester) => ({
      name: semester.termName,
      code: semester.termCode,
      canonical: window.semesterTermCode(semester),
    })))).toEqual([
      { name: FALL, code: '202401', canonical: '202401' },
      { name: SPRING, code: '202402', canonical: '202402' },
    ]);

    // Remove the derived storage field once more so export itself must perform
    // the backward-compatible dates -> termCodes synthesis.
    await page.evaluate(() => {
      const id = window.planStorage.getActivePlanId();
      const key = Object.keys(localStorage).find((candidate) => (
        candidate.includes(`.${id}.`) && candidate.endsWith('.termCodes')
      ));
      if (key) localStorage.removeItem(key);
    });
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.evaluate(() => window.planStorage.exportPlan()),
    ]);
    const exported = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    expect(exported.version).toBe(4);
    expect(exported.plan.state.dates).toEqual([FALL, SPRING]);
    expect(exported.plan.state.termCodes).toEqual(['202401', '202402']);
  });
});
