// grades.js
// Canonical, context-free grade semantics for every grade accepted by SUrriculum.
//
// This module deliberately does not decide whether a course is past, current or
// future. It describes only what an announced grade means. The progress engine
// can combine this result with term information without rebuilding grade rules.

export const GRADING_BASIS = Object.freeze({
  LETTER: 'letter',
  SATISFACTORY: 'satisfactory',
  UNKNOWN: 'unknown',
});

export const LETTER_GRADE_POINTS = Object.freeze({
  A: 4.0,
  'A-': 3.7,
  'B+': 3.3,
  B: 3.0,
  'B-': 2.7,
  'C+': 2.3,
  C: 2.0,
  'C-': 1.7,
  'D+': 1.3,
  D: 1.0,
  F: 0.0,
});

// Empty string is the canonical representation of both an ungraded course and
// the transcript label "Registered". A+ is intentionally absent: it is not an
// SU undergraduate grade.
export const GRADE_TOKENS = Object.freeze([
  '',
  'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'F',
  'P', 'S', 'U', 'I', 'T', 'NA', 'W',
]);

const SUPPORTED_GRADE_TOKENS = new Set(GRADE_TOKENS);

const freezeOption = (value, label, group, description) => Object.freeze({
  value,
  label,
  group,
  description,
});

// Presentation metadata is kept beside the policy so every grade picker can
// expose the same complete vocabulary without inventing another token list.
export const GRADE_UI_OPTIONS = Object.freeze([
  freezeOption('', 'Registered / no grade', 'status', 'No final grade has been announced.'),
  freezeOption('A', 'A', 'letter', 'GPA-bearing grade: 4.00.'),
  freezeOption('A-', 'A-', 'letter', 'GPA-bearing grade: 3.70.'),
  freezeOption('B+', 'B+', 'letter', 'GPA-bearing grade: 3.30.'),
  freezeOption('B', 'B', 'letter', 'GPA-bearing grade: 3.00.'),
  freezeOption('B-', 'B-', 'letter', 'GPA-bearing grade: 2.70.'),
  freezeOption('C+', 'C+', 'letter', 'GPA-bearing grade: 2.30.'),
  freezeOption('C', 'C', 'letter', 'GPA-bearing grade: 2.00.'),
  freezeOption('C-', 'C-', 'letter', 'GPA-bearing grade: 1.70.'),
  freezeOption('D+', 'D+', 'letter', 'GPA-bearing grade: 1.30.'),
  freezeOption('D', 'D', 'letter', 'GPA-bearing grade: 1.00.'),
  freezeOption('F', 'F', 'letter', 'Unsuccessful GPA-bearing grade: 0.00.'),
  freezeOption('P', 'P — Progressing', 'status', 'Work is still in progress.'),
  freezeOption('S', 'S — Satisfactory', 'satisfactory', 'Successful and GPA-neutral.'),
  freezeOption('U', 'U — Unsatisfactory', 'satisfactory', 'Unsuccessful and GPA-neutral.'),
  freezeOption('I', 'I — Incomplete', 'status', 'Required work or an exam is still incomplete.'),
  freezeOption('T', 'T — Transfer', 'administrative', 'Transferred credit; GPA-neutral.'),
  freezeOption('NA', 'NA — Not attended', 'administrative', 'Unsuccessful; GPA treatment depends on the course grading basis.'),
  freezeOption('W', 'W — Withdrawn', 'administrative', 'Withdrawn with no earned credit or GPA effect.'),
]);

/**
 * Normalize a grade from UI, storage or transcript input.
 *
 * @returns {string|null} A canonical token, or null for unsupported input.
 */
export function normalizeGrade(rawGrade) {
  if (rawGrade === null || rawGrade === undefined) return '';
  const normalized = String(rawGrade).trim().toUpperCase();
  if (!normalized || normalized === 'REGISTERED') return '';
  return SUPPORTED_GRADE_TOKENS.has(normalized) ? normalized : null;
}

export function isSupportedGrade(rawGrade) {
  return normalizeGrade(rawGrade) !== null;
}

/**
 * Normalize persisted/catalog grading-basis metadata.
 *
 * A few conservative aliases are accepted so old or imported data can migrate
 * to the canonical values without changing the policy's output vocabulary.
 */
export function normalizeGradingBasis(rawBasis) {
  if (rawBasis === null || rawBasis === undefined) return GRADING_BASIS.UNKNOWN;
  const normalized = String(rawBasis).trim().toLowerCase().replace(/_/g, '-');
  if (['letter', 'gpa', 'gpa-bearing', 'letter-grade'].includes(normalized)) {
    return GRADING_BASIS.LETTER;
  }
  if (['satisfactory', 'non-gpa', 's/u', 'su'].includes(normalized)) {
    return GRADING_BASIS.SATISFACTORY;
  }
  return GRADING_BASIS.UNKNOWN;
}

/**
 * Infer a basis when the grade itself proves it. A decisive grade wins over
 * persisted metadata so an old basis cannot survive a later A→S or S→A edit.
 * Explicit metadata resolves only ambiguous NA/I/T/W/unannounced grades.
 */
export function inferGradingBasis(rawGrade, explicitBasis) {
  const grade = normalizeGrade(rawGrade);
  if (grade !== null && Object.prototype.hasOwnProperty.call(LETTER_GRADE_POINTS, grade)) {
    return GRADING_BASIS.LETTER;
  }
  if (grade === 'S' || grade === 'U') {
    return GRADING_BASIS.SATISFACTORY;
  }
  return normalizeGradingBasis(explicitBasis);
}

const BASE_OUTCOMES = Object.freeze({
  '': Object.freeze({
    status: 'ungraded', terminal: false, successful: false, earnsCredit: false,
    countsInGpa: false, gpaPoints: null, pending: true, withdrawn: false,
  }),
  P: Object.freeze({
    status: 'progressing', terminal: false, successful: false, earnsCredit: false,
    countsInGpa: false, gpaPoints: null, pending: true, withdrawn: false,
  }),
  S: Object.freeze({
    status: 'satisfactory', terminal: true, successful: true, earnsCredit: true,
    countsInGpa: false, gpaPoints: null, pending: false, withdrawn: false,
  }),
  U: Object.freeze({
    status: 'unsatisfactory', terminal: true, successful: false, earnsCredit: false,
    countsInGpa: false, gpaPoints: null, pending: false, withdrawn: false,
  }),
  I: Object.freeze({
    status: 'incomplete', terminal: false, successful: false, earnsCredit: false,
    countsInGpa: false, gpaPoints: null, pending: true, withdrawn: false,
  }),
  T: Object.freeze({
    status: 'transfer', terminal: true, successful: true, earnsCredit: true,
    countsInGpa: false, gpaPoints: null, pending: false, withdrawn: false,
  }),
  W: Object.freeze({
    status: 'withdrawn', terminal: true, successful: false, earnsCredit: false,
    countsInGpa: false, gpaPoints: null, pending: false, withdrawn: true,
  }),
});

const unsupportedOutcome = (rawGrade) => Object.freeze({
  token: null,
  rawToken: rawGrade === null || rawGrade === undefined ? '' : String(rawGrade).trim().toUpperCase(),
  supported: false,
  status: 'unsupported',
  gradingBasis: GRADING_BASIS.UNKNOWN,
  basisResolved: false,
  terminal: false,
  successful: false,
  earnsCredit: false,
  countsInGpa: false,
  gpaPoints: null,
  pending: false,
  withdrawn: false,
  requiresGradingBasis: false,
  equivalentGrade: null,
  needsReview: true,
});

/**
 * Evaluate the official meaning of a grade.
 *
 * `basisOrOptions` may be a canonical/recognized basis string or an object with
 * a `gradingBasis` property. An NA with unknown basis remains unsuccessful but
 * deliberately has no GPA contribution until the basis is known.
 */
export function evaluateGrade(rawGrade, basisOrOptions) {
  const grade = normalizeGrade(rawGrade);
  if (grade === null) return unsupportedOutcome(rawGrade);

  const explicitBasis = basisOrOptions && typeof basisOrOptions === 'object'
    ? basisOrOptions.gradingBasis
    : basisOrOptions;
  const gradingBasis = inferGradingBasis(grade, explicitBasis);

  let base;
  let equivalentGrade = null;
  let requiresGradingBasis = false;

  if (Object.prototype.hasOwnProperty.call(LETTER_GRADE_POINTS, grade)) {
    const points = LETTER_GRADE_POINTS[grade];
    base = {
      status: grade === 'F' ? 'failed' : 'passed',
      terminal: true,
      successful: grade !== 'F',
      earnsCredit: grade !== 'F',
      countsInGpa: true,
      gpaPoints: points,
      pending: false,
      withdrawn: false,
    };
  } else if (grade === 'NA') {
    const letterBasis = gradingBasis === GRADING_BASIS.LETTER;
    const satisfactoryBasis = gradingBasis === GRADING_BASIS.SATISFACTORY;
    requiresGradingBasis = !letterBasis && !satisfactoryBasis;
    equivalentGrade = letterBasis ? 'F' : (satisfactoryBasis ? 'U' : null);
    base = {
      status: 'not-attended',
      terminal: true,
      successful: false,
      earnsCredit: false,
      countsInGpa: letterBasis,
      gpaPoints: letterBasis ? 0.0 : null,
      pending: false,
      withdrawn: false,
    };
  } else {
    base = BASE_OUTCOMES[grade];
  }

  return Object.freeze({
    token: grade,
    rawToken: grade,
    supported: true,
    status: base.status,
    gradingBasis,
    basisResolved: gradingBasis !== GRADING_BASIS.UNKNOWN,
    terminal: base.terminal,
    successful: base.successful,
    earnsCredit: base.earnsCredit,
    countsInGpa: base.countsInGpa,
    gpaPoints: base.gpaPoints,
    pending: base.pending,
    withdrawn: base.withdrawn,
    requiresGradingBasis,
    equivalentGrade,
    needsReview: requiresGradingBasis,
  });
}

// Compatibility name retained for the planner's mutable credit/GPA update
// paths. It delegates to the canonical policy so the legacy consumers cannot
// drift into a second grade table.
export function evaluateGradeForLegacyTotals(rawGrade, gradingBasis) {
  return evaluateGrade(rawGrade, gradingBasis);
}

export const gradePolicy = Object.freeze({
  GRADING_BASIS,
  LETTER_GRADE_POINTS,
  GRADE_TOKENS,
  GRADE_UI_OPTIONS,
  normalizeGrade,
  isSupportedGrade,
  normalizeGradingBasis,
  inferGradingBasis,
  evaluateGrade,
});

// Bridge for the classic browser scripts. New module code can import the named
// exports directly; legacy consumers can read the same policy at call time.
if (typeof window !== 'undefined') {
  window.gradePolicy = gradePolicy;
  window.evaluateGradeForLegacyTotals = evaluateGradeForLegacyTotals;
}
