'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');
const { TRANSCRIPT_HTML } = require('../helpers/academic-records');
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
    expect(result.skippedCourses).toEqual([
      { code: 'HIST191', grade: 'C', semester: 'Fall 2024-2025', reason: 'repeated' },
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

  test('an invalid HTML semester table does not inherit a neighboring valid term', async ({ page }) => {
    await page.goto('/');
    const html = `
      <table class="courseTable">
        <thead><tr><th><b>Fall 2023-2024</b></th></tr></thead>
        <tbody><tr><td>CS201</td><td>Programming</td><td>1</td><td>A</td><td>3</td><td>6</td><td>Completed</td></tr></tbody>
      </table>
      <table class="courseTable">
        <thead><tr><th><b>Autumn 2024-2025</b></th></tr></thead>
        <tbody><tr><td>MATH101</td><td>Calculus</td><td>1</td><td>B</td><td>3</td><td>6</td><td>Completed</td></tr></tbody>
      </table>
      <table class="courseTable">
        <thead><tr><th><b>Spring 2025-2026</b></th></tr></thead>
        <tbody><tr><td>HUM101</td><td>Humanity</td><td>1</td><td>C</td><td>3</td><td>6</td><td>Completed</td></tr></tbody>
      </table>`;

    const result = await page.evaluate(
      (content) => window.academicRecordsParser.parseAcademicRecords(content),
      html,
    );
    expect(result.courses.map(({ code, semester }) => ({ code, semester }))).toEqual([
      { code: 'CS201', semester: 'Fall 2023-2024' },
      { code: 'HUM101', semester: 'Spring 2025-2026' },
    ]);
    expect(result.skippedCourses).toEqual([{
      code: 'MATH101', grade: 'B', semester: 'Autumn 2024-2025',
      reason: 'missing-or-unrecognized-semester',
    }]);
    expect(result.detectedRecords).toBe(3);
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
          { code: 'NS101', Major: 'NS', Code: '101' },
        ];
        const imported = window.academicRecordsParser.importParsedCourses([
          { code: 'MATH101', semester: 'Fall 2024-2025', grade: ' a- ' },
          { code: 'SPS101', semester: 'Fall 2024-2025', grade: 'S' },
          { code: 'CHEM101', semester: 'Fall 2024-2025', grade: 'NA' },
          { code: 'HUM101', semester: 'Fall 2024-2025', grade: 'A+' },
          { code: 'NS101', semester: 'Fall 2024-2027', grade: 'A' },
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
    expect(result.stats.skippedCourses).toEqual([
      {
        code: 'NS101', grade: 'A', semester: 'Fall 2024-2027',
        reason: 'missing-or-unrecognized-semester',
      },
    ]);
  });
});
