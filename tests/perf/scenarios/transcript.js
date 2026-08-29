'use strict';

const { buildSyntheticPdfTranscript } = require('../fixtures/transcripts');
const {
  assertScenarioContext,
  recordInvariant,
  runPhase,
  seedFixture,
  summarizeDurations,
} = require('./_shared');

module.exports = {
  id: 'transcript',
  description: 'Measures deterministic large transcript parsing without personal data.',
  tags: ['transcript', 'parser', 'cpu'],

  async run(ctx) {
    assertScenarioContext(ctx);
    const { page } = ctx;
    const phases = [];
    const invariants = [];
    const courseCount = Math.max(30, Number(ctx.options?.transcriptCourses || 120));
    const iterations = Math.max(1, Number(ctx.options?.transcriptIterations || 5));
    const transcript = buildSyntheticPdfTranscript(courseCount);
    await seedFixture(ctx, 'empty');

    const parserReady = await page.evaluate(() => Boolean(
      window.academicRecordsParser
        && typeof window.academicRecordsParser.parseAcademicRecordsPdf === 'function',
    ));
    await recordInvariant(ctx, invariants, 'transcript.pdf-parser-is-available', parserReady, {});
    if (!parserReady) return { phases, invariants, metadata: { skipped: 'PDF parser unavailable.' } };

    let parseResult;
    await runPhase(ctx, phases, 'transcript.synthetic-pdf-parse', async () => {
      parseResult = await page.evaluate(({ text, repetitions }) => {
        const durations = [];
        let last = null;
        for (let iteration = 0; iteration < repetitions; iteration += 1) {
          const startedAt = performance.now();
          last = window.academicRecordsParser.parseAcademicRecordsPdf(text);
          durations.push(performance.now() - startedAt);
        }
        return {
          durations,
          courseCount: last?.courses?.length || 0,
          detectedRecords: last?.detectedRecords ?? null,
          invalidGrades: last?.invalidGradeCourses?.length || 0,
          skipped: last?.skippedCourses?.length || 0,
        };
      }, { text: transcript.text, repetitions: iterations });
      return {
        ...parseResult,
        durationSummary: summarizeDurations(parseResult.durations),
      };
    });

    await recordInvariant(
      ctx,
      invariants,
      'transcript.synthetic-input-parses-exactly',
      parseResult.courseCount === transcript.expectedCourseCount
        && (parseResult.detectedRecords === null
          || parseResult.detectedRecords === transcript.expectedDetectedRecords),
      {
        fixture: transcript.id,
        expectedCourseCount: transcript.expectedCourseCount,
        expectedDetectedRecords: transcript.expectedDetectedRecords,
        actualCourseCount: parseResult.courseCount,
        actualDetectedRecords: parseResult.detectedRecords,
        invalidGrades: parseResult.invalidGrades,
        skipped: parseResult.skipped,
      },
    );

    await runPhase(ctx, phases, 'transcript.import-menu-open-close', async () => {
      const toggle = page.locator('.import-toggle');
      await toggle.click();
      const dropdown = page.locator('#importDropdown');
      await dropdown.waitFor({ state: 'visible' });
      const controls = await dropdown.locator('button, input').count();
      await toggle.click();
      await dropdown.waitFor({ state: 'hidden' });
      return { controls };
    });

    return {
      phases,
      invariants,
      metadata: {
        fixture: transcript.id,
        iterations,
        durationSummary: summarizeDurations(parseResult.durations),
        parseResult,
      },
    };
  },
};
