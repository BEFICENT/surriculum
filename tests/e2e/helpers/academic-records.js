'use strict';

const { expect } = require('../fixtures');

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

// HIST484 exists in older program catalogs but not in CS/202401. Its live
// course-page request now fails, so the checked-in global row is useful only
// because the refresh pipeline hydrates its intrinsic metadata from those
// otherwise inaccessible catalog snapshots. This is the production case the
// global fallback is designed to preserve.
const GLOBAL_ONLY_CODE = 'HIST484';

const triggerAcademicImport = async (page) => {
  const button = page.locator('#importAcademicRecords');
  await expect(button).toBeEnabled({ timeout: 15000 });
  // The dropdown is intentionally closed in parser-focused tests, so invoke
  // the now-enabled control without adding unrelated menu interaction.
  await button.evaluate((element) => element.click());
};

const importTranscriptCustomCourseForReview = async (page, code, options = {}) => {
  const title = options.title || 'Transcript-only elective';
  const grade = options.grade || 'A';
  const html = `
    <table class="courseTable">
      <thead><tr><th><b>Fall 2024-2025</b></th></tr></thead>
      <tbody><tr><td>${code}</td><td>${title}</td><td>1</td><td>${grade}</td><td>3</td><td>6</td><td>Completed</td></tr></tbody>
    </table>`;
  await page.locator('#academicRecordsInput').setInputFiles({
    name: 'synthetic-custom-course.html',
    mimeType: 'text/html',
    buffer: Buffer.from(html),
  });
  await triggerAcademicImport(page);

  const importModal = page.locator('.modal-overlay').filter({ hasText: /Import complete/i });
  await expect(importModal).toBeVisible();
  await expect(importModal).toContainText(code);
  await importModal.getByRole('button', { name: 'OK', exact: true }).click();

  const reminderModal = page.locator('.modal-overlay').filter({
    hasText: /Reminder: choose your programs & admit terms/i,
  });
  await expect(reminderModal).toBeVisible();
  await expect(reminderModal)
    .toContainText('SUIS → Student Records → General Student Information');
  await reminderModal.getByRole('button', { name: 'OK', exact: true }).click();

  const review = page.locator('.custom_course_modal');
  await expect(review).toBeVisible();
  await expect(review.locator('h3')).toHaveText('Review Imported Course');
  await expect(review).toContainText(/Save to keep this transcript course/i);
  await expect(review.locator('.cc-row').first().locator('input')).toHaveValue(code);
  return review;
};

const readTranscriptCustomCourseState = (page, code) => page.evaluate((targetCode) => {
  const normalize = (course) => String((course && course.Major) || '')
    + String((course && course.Code) || '');
  const planId = window.planStorage.getSessionPlanId();
  const customCourses = JSON.parse(
    window.planStorage.getItem('customCourses_CS', planId) || '[]',
  );
  const occurrences = (window.curriculum.semesters || []).flatMap((semester) =>
    (semester.courses || []).filter((course) => course.code === targetCode)
      .map((course) => ({ code: course.code, grade: course.grade, term: semester.termName })));
  return {
    customCount: customCourses.filter((course) => normalize(course) === targetCode).length,
    catalogCount: course_data.filter((course) => normalize(course) === targetCode).length,
    occurrences,
    renderedCount: Array.from(document.querySelectorAll('.container_semester .course'))
      .filter((node) => node.textContent.includes(targetCode)).length,
    semesterCount: window.curriculum.semesters.length,
  };
}, code);

const readImportedCourseProgress = (page, code) => page.evaluate((courseCode) => {
  const semester = (window.curriculum.semesters || []).find((row) =>
    (row.courses || []).some((course) => course.code === courseCode));
  const course = semester && semester.courses.find((row) => row.code === courseCode);
  const catalogInfo = window.getInfo(courseCode, course_data);
  const progress = window.curriculum.getGraduationProgress('main');
  const state = (progress.courseStates || []).find((row) => row.course.code === courseCode);
  return {
    termName: semester && semester.termName,
    course: course && {
      code: course.code,
      grade: course.grade,
      gradingBasis: course.gradingBasis,
      suCredits: Number(course.SU_credit),
      ects: Number(course.ECTS),
      effectiveType: course.effective_type,
    },
    state: state && {
      effective: state.effective,
      pgpaEffective: state.pgpaEffective,
    },
    catalog: catalogInfo && {
      type: catalogInfo.EL_Type,
      internalGlobal: Boolean(catalogInfo.__globalCourseDefinition),
    },
    cgpa: {
      value: progress.cgpa.value,
      credits: progress.cgpa.credits,
      points: progress.cgpa.points,
    },
    legacySemesterGpa: {
      credits: Number((semester && semester.totalGPACredits) || 0),
      points: Number((semester && semester.totalGPA) || 0),
    },
    pgpa: {
      value: Number.isFinite(progress.pgpa.value) ? progress.pgpa.value : null,
      credits: progress.pgpa.credits,
      points: progress.pgpa.points,
    },
    degreeTotal: progress.breakdown.total,
    listedAsCourseChoice: window.getCoursesList(course_data)
      .some((item) => item.code === courseCode),
  };
}, code);

module.exports = {
  TRANSCRIPT_HTML,
  GLOBAL_ONLY_CODE,
  triggerAcademicImport,
  importTranscriptCustomCourseForReview,
  readTranscriptCustomCourseState,
  readImportedCourseProgress,
};
