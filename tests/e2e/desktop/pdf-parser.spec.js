'use strict';

const { test, expect } = require('../fixtures');

// A clean synthetic transcript token stream (no personal data), shaped the way
// parseAcademicRecordsPdf tokenizes extracted PDF text:
//   <Season Year-Year>  then  <CODE> <title...> <LEVEL> <GRADE> <SUcr> <ECTS>
const PDF_TEXT = [
  'Fall 2024-2025',
  'CS201 Programming Fundamentals UG A 3 6',
  'MATH101 Calculus UG B 3 6',
  'PHYS101 Physics UG W 3 6',
  'CHEM101 Chemistry UG NA 3 6',
  'SPS101 Society UG S 3 6',
  'HUM101 Humanity UG A+ 3 6',
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
    expect(Object.keys(byCode).sort()).toEqual([
      'CHEM101', 'CS201', 'MATH101', 'NS101', 'PHYS101', 'SPS101',
    ]);

    expect(byCode.CS201.grade).toBe('A');
    expect(byCode.CS201.gradingBasis).toBe('letter');
    expect(byCode.CS201.semester).toBe('Fall 2024-2025');
    expect(byCode.MATH101.grade).toBe('B');
    expect(byCode.MATH101.semester).toBe('Fall 2024-2025');
    expect(byCode.PHYS101.grade).toBe('W');
    expect(byCode.PHYS101.gradingBasis).toBeUndefined();
    expect(byCode.CHEM101.grade).toBe('NA');
    expect(byCode.CHEM101.gradingBasis).toBeUndefined();
    expect(byCode.SPS101.gradingBasis).toBe('satisfactory');
    expect(byCode.NS101.grade).toBe('A');
    expect(byCode.NS101.semester).toBe('Spring 2024-2025');
    expect(byCode.HUM101).toBeUndefined();
    expect(result.invalidGradeCourses).toEqual([
      { code: 'HUM101', grade: 'A+', semester: 'Fall 2024-2025' },
    ]);
  });

  test('a YOK-style transcript is routed to the YOK parser without error', async ({ page }) => {
    await page.goto('/');
    const yokText = [
      'NOT DOKUM BELGESI',
      '(2024-2025 Fall Term)',
      'PHYS101', 'Fizik', '(Physics)', 'Completed', 'English', '3', '0', '3', '6', 'W', '-',
      'CHEM101', 'Kimya', '(Chemistry)', 'Completed', 'English', '3', '0', '3', '6', 'NA', '-',
      'SPS101', 'Toplum', '(Society)', 'Completed', 'English', '3', '0', '3', '6', 'S', '-',
      'HUM101', 'Insanlik', '(Humanity)', 'Completed', 'English', '3', '0', '3', '6', 'A+', '-',
    ].join('\n');
    const result = await page.evaluate(
      (text) => window.academicRecordsParser.parseAcademicRecordsPdf(text),
      yokText,
    );
    const byCode = Object.fromEntries(result.courses.map((course) => [course.code, course]));
    expect(Object.keys(byCode).sort()).toEqual(['CHEM101', 'PHYS101', 'SPS101']);
    expect(byCode.PHYS101.grade).toBe('W');
    expect(byCode.CHEM101.grade).toBe('NA');
    expect(byCode.SPS101.gradingBasis).toBe('satisfactory');
    expect(result.invalidGradeCourses).toEqual([
      { code: 'HUM101', grade: 'A+', semester: 'Fall 2024-2025' },
    ]);
  });

  test('YOK skips excluded/repeated rows and reconciles duplicate attempts chronologically', async ({ page }) => {
    await page.goto('/');
    const yokText = [
      'NOT DOKUM BELGESI',
      '(2024-2025 Spring Term)',
      'MATH101', 'Matematik', '(Calculus)', 'Completed', 'English', '3', '0', '3', '6', 'A', '-',
      'HIST191', 'Tarih', '(History)', 'Excluded', 'English', '2', '0', '2', '3', 'B', '-',
      '(2023-2024 Fall Term)',
      'MATH101', 'Matematik', '(Calculus)', 'Completed', 'English', '3', '0', '3', '6', 'D', '-',
      'PROJ201', 'Proje', '(Project)', 'Repeated', 'English', '1', '0', '1', '1', 'W', '-',
    ].join('\n');

    const result = await page.evaluate(
      (text) => window.academicRecordsParser.parseAcademicRecordsPdf(text),
      yokText,
    );
    expect(result.courses).toEqual([
      expect.objectContaining({ code: 'MATH101', grade: 'A', semester: 'Spring 2024-2025' }),
    ]);
    expect(result.supersededCourses).toEqual([
      expect.objectContaining({ code: 'MATH101', grade: 'D', keptGrade: 'A' }),
    ]);
    expect(result.skippedCourses).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'HIST191', reason: 'excluded' }),
      expect.objectContaining({ code: 'PROJ201', reason: 'repeated' }),
    ]));
  });

  test('PDF duplicate selection keeps the latest term before import', async ({ page }) => {
    await page.goto('/');
    const text = [
      'Spring 2024-2025',
      'MATH101 Calculus UG A 3 6',
      'Fall 2023-2024',
      'MATH101 Calculus UG D 3 6',
    ].join('\n');
    const result = await page.evaluate(
      (pdfText) => window.academicRecordsParser.parseAcademicRecordsPdf(pdfText),
      text,
    );
    expect(result.courses).toEqual([
      expect.objectContaining({ code: 'MATH101', grade: 'A', semester: 'Spring 2024-2025' }),
    ]);
    expect(result.supersededCourses).toEqual([
      expect.objectContaining({ code: 'MATH101', grade: 'D', keptSemester: 'Spring 2024-2025' }),
    ]);
  });

  test('a missing grade column keeps wrapped title and status text out of invalid grades', async ({ page }) => {
    await page.goto('/');
    const text = [
      'Fall 2024-2025',
      'CS201',
      'Programming',
      'UG',
      'Fundamentals',
      '3',
      '6',
      'Completed',
      'MATH101',
      'Calculus',
      'UG',
      'Completed',
      '3',
      '6',
    ].join('\n');

    const result = await page.evaluate(
      (pdfText) => window.academicRecordsParser.parseAcademicRecordsPdf(pdfText),
      text,
    );

    expect(result.courses).toEqual([
      expect.objectContaining({
        code: 'CS201', title: 'Programming Fundamentals', grade: '', suCredits: 3, ects: 6,
      }),
      expect.objectContaining({
        code: 'MATH101', title: 'Calculus', grade: '', suCredits: 3, ects: 6,
      }),
    ]);
    expect(result.invalidGradeCourses).toEqual([]);
  });

  test('a missing level marker uses the numeric columns to distinguish titles from grades', async ({ page }) => {
    await page.goto('/');
    const text = [
      'Fall 2024-2025',
      'ART101 Art and Law 1 2 Survey 3 6 Completed',
      'CS201 A History of AI I A 3 6 Completed',
      'MATH101 Calculus B + 3 6 Completed',
      'HUM101 Art and Law A+ 3 6 Completed',
    ].join('\n');

    const result = await page.evaluate(
      (pdfText) => window.academicRecordsParser.parseAcademicRecordsPdf(pdfText),
      text,
    );

    expect(result.courses).toEqual([
      expect.objectContaining({
        code: 'ART101', title: 'Art and Law 1 2 Survey', grade: '', suCredits: 3, ects: 6,
      }),
      expect.objectContaining({
        code: 'CS201', title: 'A History of AI I', grade: 'A', suCredits: 3, ects: 6,
      }),
      expect.objectContaining({
        code: 'MATH101', title: 'Calculus', grade: 'B+', suCredits: 3, ects: 6,
      }),
    ]);
    expect(result.invalidGradeCourses).toEqual([
      { code: 'HUM101', grade: 'A+', semester: 'Fall 2024-2025' },
    ]);
    expect(result.detectedRecords).toBe(4);
  });
});
