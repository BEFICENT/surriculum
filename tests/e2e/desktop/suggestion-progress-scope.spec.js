'use strict';

const { test, expect } = require('../fixtures');
const { seedPlan } = require('../helpers/plan');

const scoreBefore = (page, code, targetTermCode) => page.evaluate(
  ({ candidate, target }) => window.computeCourseSuggestionScore(candidate, {
    progressPolicy: 'before-target',
    targetTermCode: target,
  }),
  { candidate: code, target: targetTermCode },
);

test.describe('term-scoped suggestion progress', () => {
  test('uses a strict academic boundary and excludes failed or ambiguous-term courses', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [
        ['SPS101'],
        ['MATH101', 'CS201'],
        ['IF100'],
        ['NS101'],
      ],
      grades: [['A'], ['A', 'F'], ['A'], ['A']],
      dates: [
        'Fall 2023-2024',
        'Fall 2024-2025',
        'Spring 2024-2025',
        'Summer 2024-2025',
      ],
      termCodes: ['202301', '202401', '202402', '202403'],
    });

    const result = await page.evaluate(() => {
      const current = window.curriculum;
      const ambiguous = current.semesters.find((semester) =>
        (semester.courses || []).some((course) => course.code === 'SPS101'));
      // Keep the persisted numeric identity but make the display identity
      // disagree. semesterTermCode must fail closed for this semester.
      ambiguous.termName = 'Spring 2023-2024';

      const summarize = () => {
        const snapshot = current.getProgramProgressBeforeTerm('main', '202402');
        return {
          available: snapshot.available,
          target: snapshot.targetTermCode,
          courseCodes: [...snapshot.courseCodes].sort(),
          totals: {
            total: snapshot.totals.total,
            university: snapshot.totals.university,
            required: snapshot.totals.required,
            science: snapshot.totals.science,
          },
        };
      };

      const chronological = summarize();
      current.semesters.reverse();
      const visuallyReordered = summarize();
      return { chronological, visuallyReordered };
    });

    expect(result.chronological).toEqual({
      available: true,
      target: '202402',
      courseCodes: ['MATH101'],
      totals: { total: 3, university: 3, required: 0, science: 6 },
    });
    expect(result.visuallyReordered).toEqual(result.chronological);
  });

  test('reallocates the scoped plan instead of filtering full-plan effective totals', async ({ page }) => {
    await seedPlan(page, {
      major: 'CS',
      entryTerm: 'Fall 2024-2025',
      curriculum: [['MATH201'], ['MATH212']],
      grades: [['A'], ['A']],
      dates: ['Fall 2024-2025', 'Summer 2024-2025'],
      termCodes: ['202401', '202403'],
    });

    const result = await page.evaluate(() => {
      const current = window.curriculum;
      const visibleState = () => current.semesters.map((semester) => ({
        totals: {
          totalCredit: semester.totalCredit,
          totalArea: semester.totalArea,
          totalCore: semester.totalCore,
          totalFree: semester.totalFree,
          totalUniversity: semester.totalUniversity,
          totalRequired: semester.totalRequired,
          totalScience: semester.totalScience,
          totalEngineering: semester.totalEngineering,
          totalECTS: semester.totalECTS,
        },
        courses: (semester.courses || []).map((course) => ({
          code: course.code,
          category: course.category,
          effective: course.effective_type,
          exclusionReason: course.degreeExclusionReason || '',
        })),
      }));

      const math201 = current.semesters
        .flatMap((semester) => semester.courses || [])
        .find((course) => course.code === 'MATH201');
      const before = visibleState();
      const fullPlanEffective = math201.effective_type;
      const snapshot = current.getProgramProgressBeforeTerm('main', '202402');
      const record = snapshot.records.get(math201);
      const after = visibleState();

      return {
        fullPlanEffective,
        scopedEffective: record && record.effective,
        scopedRequired: snapshot.totals.required,
        scopedTotal: snapshot.totals.total,
        scopedCodes: [...snapshot.courseCodes].sort(),
        visibleUnchanged: JSON.stringify(before) === JSON.stringify(after),
      };
    });

    // In the full plan, future MATH212 makes MATH201 the redundant alternative.
    expect(result.fullPlanEffective).toBe('none');
    // Before Spring, MATH212 has not happened, so MATH201 must be restored to
    // the required pool by a fresh scoped allocation.
    expect(result.scopedEffective).toBe('required');
    expect(result.scopedRequired).toBe(3);
    expect(result.scopedTotal).toBe(3);
    expect(result.scopedCodes).toEqual(['MATH201']);
    expect(result.visibleUnchanged).toBe(true);
  });

  test('applies both ME 2025+ alternative pairs only when the counterpart is earlier', async ({ page }) => {
    const plan = (termName, termCode) => ({
      major: 'ME',
      entryTerm: 'Fall 2025-2026',
      curriculum: [['ME403', 'CS404']],
      grades: [['A', 'A']],
      dates: [termName],
      termCodes: [termCode],
    });

    // Both counterparts are later than the selected Spring term. They cannot
    // turn the candidates into pair extras or satisfy the CS one-of group yet.
    await seedPlan(page, plan('Summer 2025-2026', '202503'));
    await page.waitForFunction(() => !!window.suggestionRanking);
    const future = {
      me425: await scoreBefore(page, 'ME425', '202502'),
      cs412: await scoreBefore(page, 'CS412', '202502'),
      progress: await page.evaluate(() => {
        const snapshot = window.curriculum.getProgramProgressBeforeTerm('main', '202502');
        const csGroup = snapshot.groupRows.find((row) => row.id === 'cs_alt');
        return {
          me403: snapshot.courseCodes.has('ME403'),
          cs404: snapshot.courseCodes.has('CS404'),
          csGroupMet: !!(csGroup && csGroup.ok),
        };
      }),
    };

    // Move the same eligible counterparts before Spring. ME425 becomes the
    // ME403/ME425 core extra; CS412 becomes the CS404/CS412 core extra and its
    // one-of group bonus is also suppressed because that group is now met.
    await seedPlan(page, plan('Fall 2025-2026', '202501'));
    await page.waitForFunction(() => !!window.suggestionRanking);
    const prior = {
      me425: await scoreBefore(page, 'ME425', '202502'),
      cs412: await scoreBefore(page, 'CS412', '202502'),
      progress: await page.evaluate(() => {
        const snapshot = window.curriculum.getProgramProgressBeforeTerm('main', '202502');
        const csGroup = snapshot.groupRows.find((row) => row.id === 'cs_alt');
        return {
          me403: snapshot.courseCodes.has('ME403'),
          cs404: snapshot.courseCodes.has('CS404'),
          csGroupMet: !!(csGroup && csGroup.ok),
        };
      }),
    };

    expect(future.progress).toEqual({ me403: false, cs404: false, csGroupMet: false });
    expect(prior.progress).toEqual({ me403: true, cs404: true, csGroupMet: true });
    expect(future.me425 - prior.me425).toBeCloseTo(10 * 1.2, 3);
    expect(future.cs412 - prior.cs412).toBeCloseTo((10 + 6) * 1.2, 3);
  });

  test('double-major scoring uses the DM snapshot strictly before the target term', async ({ page }) => {
    const plan = (termName, termCode) => ({
      major: 'MAN',
      entryTerm: 'Fall 2025-2026',
      doubleMajor: 'ME',
      entryTermDM: 'Fall 2025-2026',
      curriculum: [['CS404']],
      grades: [['A']],
      dates: [termName],
      termCodes: [termCode],
    });

    // A same-term counterpart must not satisfy the ME double-major one-of
    // group or change the candidate's paired-course type yet.
    await seedPlan(page, plan('Spring 2025-2026', '202502'));
    const sameTerm = {
      score: await scoreBefore(page, 'CS412', '202502'),
      group: await page.evaluate(() => {
        const snapshot = window.curriculum.getProgramProgressBeforeTerm('dm', '202502');
        const row = snapshot.groupRows.find((item) => item.id === 'cs_alt');
        return { hasCounterpart: snapshot.courseCodes.has('CS404'), met: !!(row && row.ok) };
      }),
    };

    await seedPlan(page, plan('Fall 2025-2026', '202501'));
    const prior = {
      score: await scoreBefore(page, 'CS412', '202502'),
      group: await page.evaluate(() => {
        const snapshot = window.curriculum.getProgramProgressBeforeTerm('dm', '202502');
        const row = snapshot.groupRows.find((item) => item.id === 'cs_alt');
        return { hasCounterpart: snapshot.courseCodes.has('CS404'), met: !!(row && row.ok) };
      }),
    };

    expect(sameTerm.group).toEqual({ hasCounterpart: false, met: false });
    expect(prior.group).toEqual({ hasCounterpart: true, met: true });
    // ME required -> core is a 10-point drop and the now-met group removes its
    // 6-point bonus. Only the double-major context changes, so weight is 0.8.
    expect(sameTerm.score - prior.score).toBeCloseTo((10 + 6) * 0.8, 3);
  });

  test('an explicitly invalid scoped group target never falls through to whole-plan rows', async ({ page }) => {
    await seedPlan(page, {
      major: 'VACD',
      entryTerm: 'Fall 2024-2025',
      curriculum: [['HART292', 'HART293', 'HART413']],
      grades: [['A', 'A', 'A']],
      dates: ['Fall 2024-2025'],
      termCodes: ['202401'],
    });

    const result = await page.evaluate(() => {
      const current = window.curriculum;
      const wholePlan = current.requirementGroupProgress('main');
      return {
        wholePlanRows: wholePlan.length,
        wholePlanCoreMet: !!wholePlan.find((row) => row.id === 'core_arthistory')?.ok,
        malformed: current.requirementGroupProgress('main', {
          beforeTermCode: 'not-a-term',
        }),
        blank: current.requirementGroupProgress('main', { beforeTermCode: '' }),
      };
    });

    expect(result.wholePlanRows).toBeGreaterThan(0);
    expect(result.wholePlanCoreMet).toBe(true);
    expect(result.malformed).toEqual([]);
    expect(result.blank).toEqual([]);
  });
});
