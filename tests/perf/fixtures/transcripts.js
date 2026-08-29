'use strict';

const TRANSCRIPT_TERMS = Object.freeze([
  'Fall 2021-2022',
  'Spring 2021-2022',
  'Fall 2022-2023',
  'Spring 2022-2023',
  'Fall 2023-2024',
  'Spring 2023-2024',
  'Fall 2024-2025',
  'Spring 2024-2025',
]);

function buildSyntheticPdfTranscript(courseCount = 120) {
  const normalizedCount = Math.max(1, Math.floor(Number(courseCount) || 120));
  const rows = [];
  for (let index = 0; index < normalizedCount; index += 1) {
    if (index % 15 === 0) {
      rows.push(TRANSCRIPT_TERMS[Math.floor(index / 15) % TRANSCRIPT_TERMS.length]);
    }
    const code = `PERF${String(100 + index).padStart(3, '0')}`;
    const grade = index % 17 === 0 ? 'S' : (index % 11 === 0 ? 'B+' : 'A');
    // Keep the title free of numeric tokens: the parser deliberately treats
    // numbers as potential credit columns, so numbered titles would make this
    // synthetic input unlike a stable transcript row.
    rows.push(`${code} Synthetic Performance Course UG ${grade} 3 6`);
  }
  return Object.freeze({
    id: `synthetic-pdf-${normalizedCount}`,
    format: 'pdf-text',
    text: rows.join('\n'),
    expectedDetectedRecords: normalizedCount,
    expectedCourseCount: normalizedCount,
  });
}

module.exports = { TRANSCRIPT_TERMS, buildSyntheticPdfTranscript };
