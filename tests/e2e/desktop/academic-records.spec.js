'use strict';

const { test, expect } = require('../fixtures');

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
    // MATH101 kept; CS210 aliased to DSA210; CS201 kept (Registered).
    // PHYS101 dropped (grade W); HIST191 dropped (Repeated); header row ignored.
    expect(codes).toEqual(['CS201', 'DSA210', 'MATH101']);

    const byCode = Object.fromEntries(result.courses.map((c) => [c.code, c]));
    expect(byCode.MATH101.grade).toBe('A');
    expect(byCode.MATH101.suCredits).toBe(3);
    expect(byCode.MATH101.semester).toBe('Fall 2024-2025');
    expect(byCode.CS201.grade).toBe(''); // "Registered" normalizes to blank
    expect(byCode.DSA210).toBeTruthy();  // CS210 -> DSA210 rename applied
    expect(codes).not.toContain('PHYS101');
    expect(codes).not.toContain('HIST191');
  });

  test('the latest attempt of a repeated-across-semesters course wins', async ({ page }) => {
    await page.goto('/');
    // Same course in two semesters (a retake); the later table should overwrite.
    const html = `
      <table class="courseTable">
        <thead><tr><th><b>Fall 2023-2024</b></th></tr></thead>
        <tbody><tr><td>MATH101</td><td>Calculus</td><td>1</td><td>D</td><td>3</td><td>6</td><td>Completed</td></tr></tbody>
      </table>
      <table class="courseTable">
        <thead><tr><th><b>Fall 2024-2025</b></th></tr></thead>
        <tbody><tr><td>MATH101</td><td>Calculus</td><td>2</td><td>A</td><td>3</td><td>6</td><td>Completed</td></tr></tbody>
      </table>`;
    const result = await page.evaluate((h) => window.academicRecordsParser.parseAcademicRecords(h), html);
    expect(result.courses).toHaveLength(1);
    expect(result.courses[0].grade).toBe('A');
    expect(result.courses[0].semester).toBe('Fall 2024-2025');
  });
});
