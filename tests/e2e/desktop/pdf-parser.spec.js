'use strict';

const { test, expect } = require('../fixtures');

// A clean synthetic transcript token stream (no personal data), shaped the way
// parseAcademicRecordsPdf tokenizes extracted PDF text:
//   <Season Year-Year>  then  <CODE> <title...> <LEVEL> <GRADE> <SUcr> <ECTS>
const PDF_TEXT = [
  'Fall 2024-2025',
  'CS201 Programming Fundamentals UG A 3 6',
  'MATH101 Calculus UG B 3 6',
  'Spring 2024-2025',
  'NS101 Science of Nature UG A 4 8',
].join('\n');

test.describe('PDF transcript parsing (desktop)', () => {
  test('parseAcademicRecordsPdf extracts courses, grades and semesters', async ({ page }) => {
    await page.goto('/');

    const result = await page.evaluate(
      (txt) => window.academicRecordsParser.parseAcademicRecordsPdf(txt),
      PDF_TEXT,
    );

    const byCode = Object.fromEntries(result.courses.map((c) => [c.code, c]));
    expect(Object.keys(byCode).sort()).toEqual(['CS201', 'MATH101', 'NS101']);

    expect(byCode.CS201.grade).toBe('A');
    expect(byCode.CS201.semester).toBe('Fall 2024-2025');
    expect(byCode.MATH101.grade).toBe('B');
    expect(byCode.MATH101.semester).toBe('Fall 2024-2025');
    expect(byCode.NS101.grade).toBe('A');
    expect(byCode.NS101.semester).toBe('Spring 2024-2025');
  });

  test('a YOK-style transcript is routed to the YOK parser without error', async ({ page }) => {
    await page.goto('/');
    // The YOK branch is selected by this header marker; assert it is handled and
    // returns the standard shape rather than throwing.
    const result = await page.evaluate(
      () => window.academicRecordsParser.parseAcademicRecordsPdf('NOT DOKUM BELGESI\n... yok layout ...'),
    );
    expect(result).toBeTruthy();
    expect(Array.isArray(result.courses)).toBe(true);
  });
});
