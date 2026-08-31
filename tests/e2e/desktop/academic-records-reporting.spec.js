'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');
const { triggerAcademicImport } = require('../helpers/academic-records');
test.describe('academic records parsing (desktop)', () => {
  test('a truly unknown valid-grade course is explicitly reported and skipped', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(async () => {
      const index = await window.loadCoursePageInfoIndex();
      const originalCreateSemester = window.createSemeter;
      const calls = [];
      window.createSemeter = (...args) => calls.push(args);
      try {
        index.delete('ZZZ999');
        const imported = await window.academicRecordsParser.importParsedCourses([{
          code: 'ZZZ999',
          title: 'Reliable Transcript-Only Metadata',
          semester: 'Fall 2024-2025',
          grade: 'A',
          suCredits: 3,
          ects: 6,
        }], [], { major: 'CS', minors: [], recalcEffectiveTypes() {} });
        return { stats: imported.stats, createCalls: calls.length };
      } finally {
        window.createSemeter = originalCreateSemester;
      }
    });

    expect(result.createCalls).toBe(0);
    expect(result.stats.importedCourses).toBe(0);
    expect(result.stats.invalidGradeCourses).toEqual([]);
    expect(result.stats.notFoundCourses).toEqual(['ZZZ999']);
  });

  test('zero-change import reports unsupported and not-found records together', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [],
      grades: [],
      dates: [],
    });
    await page.waitForFunction(() => typeof course_data !== 'undefined'
      && Array.isArray(course_data) && course_data.length > 0);

    const html = `
      <table class="courseTable">
        <thead><tr><th><b>Fall 2024-2025</b></th></tr></thead>
        <tbody>
          <tr><td>ZZZ999</td><td>Unknown Course</td><td>1</td><td>A</td><td>3</td><td>6</td><td>Completed</td></tr>
          <tr><td>HUM101</td><td>Humanity</td><td>1</td><td>A+</td><td>3</td><td>6</td><td>Completed</td></tr>
        </tbody>
      </table>`;
    await page.locator('#academicRecordsInput').setInputFiles({
      name: 'synthetic-academic-records.html',
      mimeType: 'text/html',
      buffer: Buffer.from(html),
    });
    await triggerAcademicImport(page);

    const overlay = page.locator('.modal-overlay').filter({ hasText: /No courses imported/i });
    await expect(overlay).toBeVisible();
    await expect(overlay).toContainText('ZZZ999');
    await expect(overlay).toContainText('HUM101');
    await expect(overlay).toContainText(/could not be verified/i);
    await expect(overlay).toContainText(/unsupported/i);
  });

  test('an unrecognized transcript term is explained without mutating the plan', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [['MATH101']],
      grades: [['A']],
      dates: ['Fall 2024-2025'],
    });
    const before = await page.evaluate(() => ({
      curriculum: serializator(window.curriculum),
      grades: grades_serializator(window.curriculum),
      dates: dates_serializator(window.curriculum),
    }));
    const html = `
      <table class="courseTable">
        <thead><tr><th><b>Autumn 2024-2025</b></th></tr></thead>
        <tbody><tr><td>NS101</td><td>Science of Nature</td><td>1</td><td>A</td><td>4</td><td>8</td><td>Completed</td></tr></tbody>
      </table>`;
    await page.locator('#academicRecordsInput').setInputFiles({
      name: 'synthetic-missing-term.html',
      mimeType: 'text/html',
      buffer: Buffer.from(html),
    });
    await triggerAcademicImport(page);

    const overlay = page.locator('.modal-overlay').filter({ hasText: /No importable courses/i });
    await expect(overlay).toBeVisible();
    await expect(overlay).toContainText('NS101');
    await expect(overlay).toContainText('Autumn 2024-2025');
    await expect(overlay).toContainText(/missing or unrecognized semester/i);
    expect(await page.evaluate(() => ({
      curriculum: serializator(window.curriculum),
      grades: grades_serializator(window.curriculum),
      dates: dates_serializator(window.curriculum),
    }))).toEqual(before);
    expect(await page.evaluate(() => window.curriculum.semesters
      .some((semester) => semester.termName === 'Unknown Semester'))).toBe(false);
  });

  test('successful import identifies every non-imported and superseded transcript record', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [],
      grades: [],
      dates: [],
    });
    await page.waitForFunction(() => typeof course_data !== 'undefined'
      && Array.isArray(course_data) && course_data.length > 0);

    const html = `
      <table class="courseTable">
        <thead><tr><th><b>Fall 2023-2024</b></th></tr></thead>
        <tbody>
          <tr><td>MATH101</td><td>Calculus</td><td>1</td><td>D</td><td>3</td><td>6</td><td>Completed</td></tr>
          <tr><td>HIST191</td><td>History</td><td>1</td><td>C</td><td>3</td><td>6</td><td>Repeated</td></tr>
          <tr><td>PROJ201</td><td>Project</td><td>1</td><td>W</td><td>3</td><td>6</td><td>Excluded</td></tr>
        </tbody>
      </table>
      <table class="courseTable">
        <thead><tr><th><b>Fall 2024-2025</b></th></tr></thead>
        <tbody>
          <tr><td>MATH101</td><td>Calculus</td><td>2</td><td>A</td><td>3</td><td>6</td><td>Completed</td></tr>
          <tr><td>ZZZ999</td><td>Unknown Course</td><td>1</td><td>B</td><td>3</td><td>6</td><td>Completed</td></tr>
        </tbody>
      </table>
      <table class="courseTable">
        <thead><tr><th>Missing term heading</th></tr></thead>
        <tbody><tr><td>NS101</td><td>Science of Nature</td><td>1</td><td>B+</td><td>4</td><td>8</td><td>Completed</td></tr></tbody>
      </table>`;
    await page.locator('#academicRecordsInput').setInputFiles({
      name: 'synthetic-import-report.html',
      mimeType: 'text/html',
      buffer: Buffer.from(html),
    });
    await triggerAcademicImport(page);

    const overlay = page.locator('.modal-overlay').filter({ hasText: /Import complete/i });
    await expect(overlay).toBeVisible();
    await expect(overlay).toContainText(/Added \(1\)/i);
    await expect(overlay).toContainText('MATH101');
    await expect(overlay).toContainText(/Not found \(1\)/i);
    await expect(overlay).toContainText('ZZZ999');
    await expect(overlay).toContainText(/Older duplicate records \(1\)/i);
    await expect(overlay).toContainText(/Fall 2023-2024.*kept latest record.*Fall 2024-2025/i);
    await expect(overlay).toContainText(/Skipped \(3\)/i);
    await expect(overlay).toContainText('HIST191');
    await expect(overlay).toContainText('PROJ201');
    await expect(overlay).toContainText('NS101');
    await expect(overlay).toContainText(/missing or unrecognized semester/i);
    await expect(overlay).toContainText(/both repeated and substituted courses/i);
    await expect(overlay).toContainText(/marked Excluded/i);
  });

  test('all-skipped import explains transcript status without creating courses', async ({ page }) => {
    await page.goto('/');
    const html = `
      <table class="courseTable">
        <thead><tr><th><b>Fall 2024-2025</b></th></tr></thead>
        <tbody>
          <tr><td>HIST191</td><td>History</td><td>1</td><td>C</td><td>3</td><td>6</td><td>Repeated</td></tr>
          <tr><td>PROJ201</td><td>Project</td><td>1</td><td>W</td><td>3</td><td>6</td><td>Excluded</td></tr>
        </tbody>
      </table>`;
    await page.locator('#academicRecordsInput').setInputFiles({
      name: 'synthetic-all-skipped.html',
      mimeType: 'text/html',
      buffer: Buffer.from(html),
    });
    await triggerAcademicImport(page);

    const overlay = page.locator('.modal-overlay').filter({ hasText: /No importable courses/i });
    await expect(overlay).toBeVisible();
    await expect(overlay).toContainText('HIST191');
    await expect(overlay).toContainText('PROJ201');
    await expect(overlay).toContainText(/both repeated and substituted courses/i);
    await expect(overlay).toContainText(/marked Excluded/i);
  });

  test('an oversized HTML transcript is rejected before parsing without changing the plan', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [['CS201']],
      grades: [['A']],
      dates: ['Fall 2024-2025'],
    });
    const before = await page.evaluate(() => ({
      curriculum: serializator(window.curriculum),
      grades: grades_serializator(window.curriculum),
      dates: dates_serializator(window.curriculum),
    }));

    await page.locator('#academicRecordsInput').setInputFiles({
      name: 'oversized-transcript.html',
      mimeType: 'text/html',
      buffer: Buffer.alloc((10 * 1024 * 1024) + 1, 0x20),
    });
    await triggerAcademicImport(page);

    const overlay = page.locator('.modal-overlay').filter({ hasText: /Transcript file is too large/i });
    await expect(overlay).toBeVisible();
    await expect(overlay).toContainText('10 MB');
    await expect(page.locator('#academicRecordsInput')).toHaveValue('');
    expect(await page.evaluate(() => ({
      curriculum: serializator(window.curriculum),
      grades: grades_serializator(window.curriculum),
      dates: dates_serializator(window.curriculum),
    }))).toEqual(before);
  });
});
