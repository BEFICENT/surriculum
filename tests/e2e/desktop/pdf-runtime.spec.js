'use strict';

const path = require('node:path');
const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..', '..');
const NORMAL_TRANSCRIPT = path.join(
  REPOSITORY_ROOT,
  'tests',
  'fixtures',
  'academic-records',
  'Academic Records Summary.pdf',
);
const MICROSOFT_PRINT_TO_PDF_TRANSCRIPT = path.join(
  REPOSITORY_ROOT,
  'tests',
  'fixtures',
  'academic-records',
  'Academic Records Summary_microsoft_printtopdf.pdf',
);
const CREDIT_DISTRIBUTION_CATALOG = path.join(
  REPOSITORY_ROOT,
  'tests',
  'fixtures',
  'suis',
  'basic-science-list',
  'katalog_basic_eng_degerler_202401_yuklenen_07.05.2025.pdf',
);
const PAGES_URL = 'http://127.0.0.1:8001/surriculum/';
const PDFJS_VERSION = '6.2.108';
const PDFJS_MODULE_PATH = `assets/vendor/pdfjs-${PDFJS_VERSION}/pdf.min.mjs`;
const PDFJS_WORKER_PATH = `assets/vendor/pdfjs-${PDFJS_VERSION}/pdf.worker.min.mjs`;
const PDFJS_CACHE_NAME = `surriculum-pdfjs-${PDFJS_VERSION}`;

async function waitForPdfImportApp(page) {
  await page.waitForFunction(() => !!(
    window.pdfTranscriptReader
    && window.academicRecordsParser
    && document.getElementById('academicRecordsInput')
  ));
}

async function snapshotPlan(page) {
  return page.evaluate(() => ({
    persisted: {
      curriculum: window.planStorage.getItem('curriculum'),
      grades: window.planStorage.getItem('grades'),
      dates: window.planStorage.getItem('dates'),
    },
    live: (window.curriculum && window.curriculum.semesters || []).map((semester) => ({
      name: semester.name,
      courses: (semester.courses || []).map((course) => ({
        code: course.code,
        grade: course.grade,
        gradingBasis: course.gradingBasis || null,
      })),
    })),
  }));
}

async function seedStablePlan(page) {
  await seedPlan(page, {
    major: 'CS',
    entryTerm: 'Fall 2024-2025',
    curriculum: [['MATH101']],
    grades: [['A']],
    dates: ['Fall 2024-2025'],
  });
  await waitForPdfImportApp(page);
}

test.describe('local PDF transcript runtime (desktop)', () => {
  test('PDF.js 6.2.108 extracts the real transcript and preserves parser semantics', async ({ page, context }) => {
    const pdfRuntimeRequests = [];
    const fakeWorkerWarnings = [];
    context.on('request', (request) => {
      const url = request.url();
      if (/assets\/vendor\/pdfjs-|(?:unpkg|cdnjs|jsdelivr).*pdfjs/i.test(url)) {
        pdfRuntimeRequests.push(url);
      }
    });
    page.on('console', (message) => {
      if (message.type() === 'warning' && /fake worker/i.test(message.text())) {
        fakeWorkerWarnings.push(message.text());
      }
    });

    await page.goto('/');
    await waitForPdfImportApp(page);
    await page.locator('#academicRecordsInput').setInputFiles(NORMAL_TRANSCRIPT);

    const result = await page.evaluate(async () => {
      const input = document.getElementById('academicRecordsInput');
      const extraction = await window.pdfTranscriptReader.extractText(input.files[0]);
      const parsed = window.academicRecordsParser.parseAcademicRecordsPdf(extraction.text);
      const pdfjs = await window.pdfTranscriptReader.loadLibrary();
      const courses = parsed.courses.map((course) => ({
        code: course.code,
        grade: course.grade,
        semester: course.semester,
        gradingBasis: course.gradingBasis || null,
        suCredits: course.suCredits,
        ects: course.ects,
      }));
      return {
        version: extraction.pdfjsVersion,
        pageCount: extraction.pageCount,
        textItemCount: extraction.textItemCount,
        workerSrc: pdfjs.GlobalWorkerOptions.workerSrc,
        courseCount: courses.length,
        skippedCount: parsed.skippedCourses.length,
        invalidGradeCount: parsed.invalidGradeCourses.length,
        supersededCount: parsed.supersededCourses.length,
        cs201: courses.find((course) => course.code === 'CS201') || null,
        cip101n: courses.find((course) => course.code === 'CIP101N') || null,
        lang100: courses.find((course) => course.code === 'LANG100') || null,
      };
    });

    expect(result).toMatchObject({
      version: PDFJS_VERSION,
      pageCount: 7,
      courseCount: 38,
      skippedCount: 3,
      invalidGradeCount: 0,
      supersededCount: 0,
      cs201: {
        code: 'CS201',
        grade: 'A',
        semester: 'Fall 2023-2024',
        gradingBasis: 'letter',
      },
      cip101n: {
        code: 'CIP101N',
        grade: 'S',
        semester: 'Fall 2022-2023',
        gradingBasis: 'satisfactory',
      },
      lang100: {
        code: 'LANG100',
        grade: 'B+',
        semester: 'Fall 2024-2025',
        gradingBasis: 'letter',
        suCredits: 2,
        ects: 3,
      },
    });
    expect(result.textItemCount).toBeGreaterThan(1000);
    expect(result.workerSrc).toBe(new URL(PDFJS_WORKER_PATH, page.url()).href);
    expect(pdfRuntimeRequests).toEqual(expect.arrayContaining([
      new URL(PDFJS_MODULE_PATH, page.url()).href,
      new URL(PDFJS_WORKER_PATH, page.url()).href,
    ]));
    expect(pdfRuntimeRequests.every((url) => new URL(url).origin === new URL(page.url()).origin)).toBe(true);
    expect(fakeWorkerWarnings).toEqual([]);
  });

  test('Microsoft Print to PDF gets no-text guidance without mutating the plan', async ({ page }) => {
    await seedStablePlan(page);
    const before = await snapshotPlan(page);

    await page.locator('#academicRecordsInput').setInputFiles(MICROSOFT_PRINT_TO_PDF_TRANSCRIPT);
    await page.evaluate(() => document.getElementById('importAcademicRecords').click());

    const modal = page.locator('.modal-overlay').filter({ hasText: /PDF has no readable text/i });
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('Microsoft Print to PDF');
    await expect(modal).toContainText('Save as PDF');
    await expect(modal).toContainText('HTML (Webpage, Complete)');
    await expect(modal).toContainText(/OCR/i);
    await expect(page.locator('#academicRecordsInput')).toHaveValue('');
    expect(await snapshotPlan(page)).toEqual(before);
  });

  test('oversize metadata is rejected before reading bytes or loading PDF.js', async ({ page, context }) => {
    const pdfRuntimeRequests = [];
    context.on('request', (request) => {
      if (/assets\/vendor\/pdfjs-/.test(request.url())) pdfRuntimeRequests.push(request.url());
    });

    // This page intentionally does not boot the app or register its service
    // worker, so any vendor request here could only come from the reader.
    await page.goto('/manifest.json');
    await page.addScriptTag({ url: '/scripts/pdf_transcript_reader.js' });
    const result = await page.evaluate(async () => {
      let arrayBufferCalls = 0;
      try {
        await window.pdfTranscriptReader.extractText({
          size: window.pdfTranscriptReader.limits.maxFileBytes + 1,
          async arrayBuffer() {
            arrayBufferCalls += 1;
            return new ArrayBuffer(0);
          },
        });
        return { code: null, arrayBufferCalls };
      } catch (error) {
        return { code: error.code, arrayBufferCalls };
      }
    });

    expect(result).toEqual({ code: 'PDF_FILE_TOO_LARGE', arrayBufferCalls: 0 });
    expect(pdfRuntimeRequests).toEqual([]);
  });

  test('an oversized upload shows the local safety limits without mutating the plan', async ({ page }) => {
    await seedStablePlan(page);
    const before = await snapshotPlan(page);
    const runtimeLoadsBefore = await page.evaluate(() => performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((url) => /assets\/vendor\/pdfjs-/.test(url)));

    await page.locator('#academicRecordsInput').setInputFiles({
      name: 'oversized-transcript.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.alloc((10 * 1024 * 1024) + 1),
    });
    await page.evaluate(() => document.getElementById('importAcademicRecords').click());

    const modal = page.locator('.modal-overlay').filter({ hasText: /PDF is too large or complex/i });
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('10 MB');
    await expect(modal).toContainText('100 pages');
    await expect(page.locator('#academicRecordsInput')).toHaveValue('');
    expect(await snapshotPlan(page)).toEqual(before);
    expect(await page.evaluate(() => performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((url) => /assets\/vendor\/pdfjs-/.test(url)))).toEqual(runtimeLoadsBefore);
  });

  test('a Basic Science and Engineering credit-distribution PDF is rejected without mutating the plan', async ({ page }) => {
    await seedStablePlan(page);
    const before = await snapshotPlan(page);

    await page.locator('#academicRecordsInput').setInputFiles(CREDIT_DISTRIBUTION_CATALOG);
    await page.evaluate(() => document.getElementById('importAcademicRecords').click());

    const modal = page.locator('.modal-overlay').filter({ hasText: /Wrong file: course credit-distribution list/i });
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('Basic Science and Engineering ECTS credit-distribution list');
    await expect(modal).toContainText('Academic Records Summary');
    await expect(modal).not.toContainText('This looks like a Degree Evaluation');
    await expect(page.locator('#academicRecordsInput')).toHaveValue('');
    expect(await snapshotPlan(page)).toEqual(before);
  });

  test('first-use extraction works offline from the GitHub Pages subpath', async ({ page, context }) => {
    const fakeWorkerWarnings = [];
    page.on('console', (message) => {
      if (message.type() === 'warning' && /fake worker/i.test(message.text())) {
        fakeWorkerWarnings.push(message.text());
      }
    });
    await page.goto(PAGES_URL);
    await waitForPdfImportApp(page);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);

    const expectedRuntimeUrls = [PDFJS_MODULE_PATH, PDFJS_WORKER_PATH]
      .map((assetPath) => new URL(assetPath, PAGES_URL).href);
    await expect.poll(async () => page.evaluate(async (cacheName) => {
      const cache = await caches.open(cacheName);
      return (await cache.keys()).map((request) => request.url);
    }, PDFJS_CACHE_NAME), { timeout: 15000 }).toEqual(expect.arrayContaining(expectedRuntimeUrls));

    const pageRuntimeLoadsBefore = await page.evaluate(() => performance
      .getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((url) => /assets\/vendor\/pdfjs-/.test(url)));
    expect(pageRuntimeLoadsBefore).toEqual([]);

    await page.locator('#academicRecordsInput').setInputFiles(NORMAL_TRANSCRIPT);
    await context.setOffline(true);
    try {
      const result = await page.evaluate(async () => {
        const input = document.getElementById('academicRecordsInput');
        const extraction = await window.pdfTranscriptReader.extractText(input.files[0]);
        const parsed = window.academicRecordsParser.parseAcademicRecordsPdf(extraction.text);
        const pdfjs = await window.pdfTranscriptReader.loadLibrary();
        return {
          version: extraction.pdfjsVersion,
          pageCount: extraction.pageCount,
          courseCount: parsed.courses.length,
          skippedCount: parsed.skippedCourses.length,
          invalidGradeCount: parsed.invalidGradeCourses.length,
          workerSrc: pdfjs.GlobalWorkerOptions.workerSrc,
        };
      });

      expect(result).toEqual({
        version: PDFJS_VERSION,
        pageCount: 7,
        courseCount: 38,
        skippedCount: 3,
        invalidGradeCount: 0,
        workerSrc: new URL(PDFJS_WORKER_PATH, PAGES_URL).href,
      });
      expect(fakeWorkerWarnings).toEqual([]);
    } finally {
      await context.setOffline(false);
    }
  });
});
