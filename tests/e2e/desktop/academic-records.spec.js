'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');

// A minimal SYNTHETIC transcript (no real personal data) shaped like the SUIS
// "Academic Records Summary" HTML the parser consumes: one .courseTable per
// semester, rows of [code, title, attempt, grade, suCredits, ects, status].
// It deliberately exercises the parser's rules.
const TRANSCRIPT_HTML = `
  <table class="courseTable">
    <thead><tr><th><b>Fall 2024-2025</b></th></tr></thead>
    <tbody>
      <tr><td>COURSE CODE</td><td>TITLE</td><td>ATT</td><td>GRADE</td><td>SU</td><td>ECTS</td><td>STATUS</td></tr>
      <tr><td>MATH 101</td><td>Calculus</td><td>1</td><td>A</td><td>3</td><td>6</td><td>Completed</td></tr>
      <tr><td>CS210</td><td>Data Structures</td><td>1</td><td>B</td><td>3</td><td>6</td><td>Completed</td></tr>
      <tr><td>PHYS101</td><td>Physics</td><td>1</td><td>W</td><td>3</td><td>6</td><td>Completed</td></tr>
      <tr><td>CHEM101</td><td>Chemistry</td><td>1</td><td>NA</td><td>3</td><td>6</td><td>Completed</td></tr>
      <tr><td>HUM101</td><td>Humanity</td><td>1</td><td>A+</td><td>3</td><td>6</td><td>Completed</td></tr>
      <tr><td>HIST191</td><td>History</td><td>2</td><td>C</td><td>3</td><td>6</td><td>Repeated</td></tr>
      <tr><td>CS201</td><td>Intro to Programming</td><td>1</td><td>Registered</td><td>3</td><td>6</td><td>Completed</td></tr>
    </tbody>
  </table>`;

test.describe('academic records parsing (desktop)', () => {
  test('parseAcademicRecords applies the transcript extraction rules', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(
      (html) => window.academicRecordsParser.parseAcademicRecords(html),
      TRANSCRIPT_HTML,
    );

    const codes = result.courses.map((c) => c.code).sort();
    // W and NA are retained as unsuccessful attempts; A+ is not an official SU
    // undergraduate token and is rejected rather than becoming an ungraded row.
    expect(codes).toEqual(['CHEM101', 'CS201', 'DSA210', 'MATH101', 'PHYS101']);

    const byCode = Object.fromEntries(result.courses.map((c) => [c.code, c]));
    expect(byCode.MATH101.grade).toBe('A');
    expect(byCode.MATH101.gradingBasis).toBe('letter');
    expect(byCode.MATH101.suCredits).toBe(3);
    expect(byCode.MATH101.semester).toBe('Fall 2024-2025');
    expect(byCode.CS201.grade).toBe(''); // "Registered" normalizes to blank
    expect(byCode.PHYS101.grade).toBe('W');
    expect(byCode.PHYS101.gradingBasis).toBeUndefined();
    expect(byCode.CHEM101.grade).toBe('NA');
    expect(byCode.CHEM101.gradingBasis).toBeUndefined();
    expect(byCode.DSA210).toBeTruthy();  // CS210 -> DSA210 rename applied
    expect(codes).not.toContain('HIST191');
    expect(codes).not.toContain('HUM101');
    expect(result.invalidGradeCourses).toEqual([
      { code: 'HUM101', grade: 'A+', semester: 'Fall 2024-2025' },
    ]);
  });

  test('the latest non-Repeated attempt wins even when it is withdrawn', async ({ page }) => {
    await page.goto('/');
    // Newest-first exports must still keep the chronologically newest attempt;
    // DOM order is not a chronology guarantee.
    const html = `
      <table class="courseTable">
        <thead><tr><th><b>Fall 2024-2025</b></th></tr></thead>
        <tbody><tr><td>MATH101</td><td>Calculus</td><td>2</td><td>W</td><td>3</td><td>6</td><td>Completed</td></tr></tbody>
      </table>
      <table class="courseTable">
        <thead><tr><th><b>Fall 2023-2024</b></th></tr></thead>
        <tbody><tr><td>MATH101</td><td>Calculus</td><td>1</td><td>D</td><td>3</td><td>6</td><td>Completed</td></tr></tbody>
      </table>`;
    const result = await page.evaluate((h) => window.academicRecordsParser.parseAcademicRecords(h), html);
    expect(result.courses).toHaveLength(1);
    expect(result.courses[0].grade).toBe('W');
    expect(result.courses[0].semester).toBe('Fall 2024-2025');
    expect(result.supersededCourses).toEqual([
      expect.objectContaining({ code: 'MATH101', semester: 'Fall 2023-2024', keptSemester: 'Fall 2024-2025' }),
    ]);
  });

  test('import passes canonical grades and parallel grading bases to createSemeter', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(() => {
      const originalCreateSemester = window.createSemeter;
      const calls = [];
      window.createSemeter = (...args) => calls.push(args);
      try {
        const curriculum = { major: 'CS', recalcEffectiveTypes() {} };
        const courseData = [
          { code: 'MATH101', Major: 'MATH', Code: '101' },
          { code: 'SPS101', Major: 'SPS', Code: '101' },
          { code: 'CHEM101', Major: 'CHEM', Code: '101' },
          { code: 'HUM101', Major: 'HUM', Code: '101' },
        ];
        const imported = window.academicRecordsParser.importParsedCourses([
          { code: 'MATH101', semester: 'Fall 2024-2025', grade: ' a- ' },
          { code: 'SPS101', semester: 'Fall 2024-2025', grade: 'S' },
          { code: 'CHEM101', semester: 'Fall 2024-2025', grade: 'NA' },
          { code: 'HUM101', semester: 'Fall 2024-2025', grade: 'A+' },
        ], courseData, curriculum);
        return {
          grades: calls[0][4],
          gradingBases: calls[0][6],
          stats: imported.stats,
        };
      } finally {
        window.createSemeter = originalCreateSemester;
      }
    });

    expect(result.grades).toEqual(['A-', 'S', 'NA']);
    expect(result.gradingBases).toEqual(['letter', 'satisfactory', '']);
    expect(result.stats.importedCourses).toBe(3);
    expect(result.stats.invalidGradeCourses).toEqual([
      { code: 'HUM101', grade: 'A+', semester: 'Fall 2024-2025' },
    ]);
  });

  test('re-import updates the matching planned occurrence without adding a semester', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [['MATH101']],
      grades: [['']],
      dates: ['Fall 2024-2025'],
    });

    const result = await page.evaluate(() => {
      const beforeSemesters = window.curriculum.semesters.length;
      const imported = window.academicRecordsParser.importParsedCourses([
        { code: 'MATH101', semester: 'Fall 2024-2025', grade: 'A' },
      ], course_data, window.curriculum);
      const course = window.curriculum.semesters[0].courses[0];
      return {
        stats: imported.stats,
        beforeSemesters,
        afterSemesters: window.curriculum.semesters.length,
        grade: course.grade,
        basis: course.gradingBasis,
      };
    });

    expect(result.beforeSemesters).toBe(result.afterSemesters);
    expect(result.grade).toBe('A');
    expect(result.basis).toBe('letter');
    expect(result.stats.importedCourses).toBe(0);
    expect(result.stats.updatedCourseCount).toBe(1);
    expect(result.stats.addedCourses).toEqual([]);
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
    await page.evaluate(() => document.getElementById('importAcademicRecords').click());

    const overlay = page.locator('.modal-overlay').filter({ hasText: /No courses imported/i });
    await expect(overlay).toBeVisible();
    await expect(overlay).toContainText('ZZZ999');
    await expect(overlay).toContainText('HUM101');
    await expect(overlay).toContainText(/not found/i);
    await expect(overlay).toContainText(/unsupported/i);
  });
});
