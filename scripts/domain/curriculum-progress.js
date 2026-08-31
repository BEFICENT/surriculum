// Pure curriculum grade, chronology, progress, and program-membership policy.
(function installCurriculumProgress(root) {
    'use strict';

    const namespace = root.SurriculumModules || (root.SurriculumModules = {});
    const allocation = namespace.curriculumAllocation;
    if (!allocation || typeof allocation.creditOfCourse !== 'function') {
        throw new Error('scripts/domain/curriculum-allocation.js must load before curriculum-progress.js');
    }

    function createCurriculumProgress(dependencies) {
        const runtime = dependencies || {};
        const creditOfCourse = typeof runtime.creditOfCourse === 'function'
            ? runtime.creditOfCourse : allocation.creditOfCourse;
        const getGradePolicy = typeof runtime.getGradePolicy === 'function'
            ? runtime.getGradePolicy : () => null;
        const getDocument = typeof runtime.getDocument === 'function'
            ? runtime.getDocument : () => undefined;
        const getTermNameToCode = typeof runtime.getTermNameToCode === 'function'
            ? runtime.getTermNameToCode : () => undefined;
        const getCurrentTermNameFromDate = typeof runtime.getCurrentTermNameFromDate === 'function'
            ? runtime.getCurrentTermNameFromDate : () => undefined;
        const getCurrentTermCode = typeof runtime.getCurrentTermCode === 'function'
            ? runtime.getCurrentTermCode : () => '';
        const getCurrentTermName = typeof runtime.getCurrentTermName === 'function'
            ? runtime.getCurrentTermName : () => '';
        const getSemesterTermCode = typeof runtime.getSemesterTermCode === 'function'
            ? runtime.getSemesterTermCode : () => undefined;
        const getCompareSemesterTerms = typeof runtime.getCompareSemesterTerms === 'function'
            ? runtime.getCompareSemesterTerms : () => undefined;
        const getNow = typeof runtime.getNow === 'function'
            ? runtime.getNow : () => new Date();

const REQUIREMENTS_UNAVAILABLE_FLAG = 99;

// The browser policy in scripts/domain/grades.js is authoritative. This small
// fallback keeps the pure VM tests and a partially loaded page conservative;
// production consumers all reach the shared window.gradePolicy object.
const FALLBACK_GRADE_POINTS = Object.freeze({
    A: 4.0, 'A-': 3.7, 'B+': 3.3, B: 3.0, 'B-': 2.7,
    'C+': 2.3, C: 2.0, 'C-': 1.7, 'D+': 1.3, D: 1.0, F: 0.0,
});
const FALLBACK_SPECIAL_GRADES = new Set(['', 'P', 'S', 'U', 'I', 'T', 'NA', 'W']);
const COURSE_PROGRESS_STATES = Object.freeze({
    EARNED: 'earned',
    CURRENT: 'current',
    FUTURE: 'future',
    UNVERIFIED: 'unverified',
    UNSUCCESSFUL: 'unsuccessful',
});
const PROGRAM_EFFECTIVE_TYPES = new Set([
    'university', 'required', 'core', 'area', 'free',
]);

function normalizeCourseGrade(grade) {
    const raw = String(grade || '').trim().toUpperCase();
    try {
        const policy = getGradePolicy();
        if (policy && typeof policy.normalizeGrade === 'function') {
            const normalized = policy.normalizeGrade(raw);
            return normalized === null ? raw : normalized;
        }
    } catch (_) {}
    return raw === 'REGISTERED' ? '' : raw;
}

function fallbackGradeOutcome(grade, rawBasis) {
    const token = normalizeCourseGrade(grade);
    let basis = ['letter', 'satisfactory'].includes(String(rawBasis || '').trim().toLowerCase())
        ? String(rawBasis).trim().toLowerCase() : 'unknown';
    if (!Object.prototype.hasOwnProperty.call(FALLBACK_GRADE_POINTS, token)
        && !FALLBACK_SPECIAL_GRADES.has(token)) {
        return { token: null, supported: false, successful: false, earnsCredit: false,
            pending: false, countsInGpa: false, gpaPoints: null, needsReview: true,
            requiresGradingBasis: false, gradingBasis: 'unknown' };
    }
    if (Object.prototype.hasOwnProperty.call(FALLBACK_GRADE_POINTS, token)) {
        basis = 'letter';
        return { token, supported: true, successful: token !== 'F', earnsCredit: token !== 'F',
            pending: false, countsInGpa: true, gpaPoints: FALLBACK_GRADE_POINTS[token],
            needsReview: false, requiresGradingBasis: false, gradingBasis: 'letter' };
    }
    if (token === 'S' || token === 'U') basis = 'satisfactory';
    if (token === 'NA') {
        const resolved = basis === 'letter' || basis === 'satisfactory';
        return { token, supported: true, successful: false, earnsCredit: false, pending: false,
            countsInGpa: basis === 'letter', gpaPoints: basis === 'letter' ? 0 : null,
            needsReview: !resolved, requiresGradingBasis: !resolved, gradingBasis: basis };
    }
    const successful = token === 'S' || token === 'T';
    const pending = token === '' || token === 'P' || token === 'I';
    return { token, supported: true, successful, earnsCredit: successful, pending,
        countsInGpa: false, gpaPoints: null, needsReview: false,
        requiresGradingBasis: false, gradingBasis: basis };
}

function evaluateCourseGrade(grade, gradingBasis) {
    try {
        const policy = getGradePolicy();
        if (policy && typeof policy.evaluateGrade === 'function') {
            return policy.evaluateGrade(grade, gradingBasis);
        }
    } catch (_) {}
    return fallbackGradeOutcome(grade, gradingBasis);
}

function gradeForCourse(course) {
    if (!course) return '';
    // New and reloaded courses always carry a model grade. The DOM fallback is
    // for legacy/plain objects created outside s_course (including old plans).
    if (typeof course.grade === 'string') return normalizeCourseGrade(course.grade);
    try {
        const document = getDocument();
        const elem = document && typeof document.getElementById === 'function'
            ? document.getElementById(course.id) : null;
        const grade = elem ? elem.querySelector('.grade') : null;
        return normalizeCourseGrade(grade ? grade.textContent : '');
    } catch (_) {
        return '';
    }
}

function isDegreeEligibleCourse(course) {
    if (!course) return false;
    const outcome = evaluateCourseGrade(gradeForCourse(course), course.gradingBasis);
    return !!(outcome.supported && (outcome.earnsCredit || outcome.pending));
}

function normalizeProgressTermCode(term) {
    const raw = String(term || '').trim();
    if (/^\d{4}(01|02|03)$/.test(raw)) return raw;
    try {
        const fn = getTermNameToCode();
        const code = fn ? String(fn(raw) || '') : '';
        return /^\d{4}(01|02|03)$/.test(code) ? code : '';
    } catch (_) {
        return '';
    }
}

function currentProgressTermCode(explicitCode) {
    const explicit = normalizeProgressTermCode(explicitCode);
    if (explicit) return explicit;
    try {
        const currentTermNameFromDate = getCurrentTermNameFromDate();
        if (typeof currentTermNameFromDate === 'function') {
            const live = normalizeProgressTermCode(currentTermNameFromDate(getNow()));
            if (live) return live;
        }
        const code = normalizeProgressTermCode(getCurrentTermCode());
        if (code) return code;
        return normalizeProgressTermCode(getCurrentTermName());
    } catch (_) {}
    return '';
}

function semesterProgressTermCode(semester) {
    if (!semester) return '';
    try {
        const fn = getSemesterTermCode();
        if (fn) return String(fn(semester) || '');
    } catch (_) {}

    // Pure-test/partial-load fallback with the same fail-closed contract as
    // the course-metadata service. A stale index or rendered label is not academic
    // identity and therefore cannot establish chronology.
    const codes = [semester.termCode, semester.termName, semester.date, semester.term]
        .map(normalizeProgressTermCode)
        .filter(Boolean);
    if (!codes.length) return '';
    return codes.every((code) => code === codes[0]) ? codes[0] : '';
}

function curriculumSemesterTieKey(semester) {
    const courses = semester && Array.isArray(semester.courses) ? semester.courses : [];
    const courseSignature = courses.map((course) => {
        const code = String(course && course.code !== undefined ? course.code : course)
            .toUpperCase().replace(/[^A-Z0-9]/g, '');
        const grade = String((course && course.grade) || '').trim().toUpperCase();
        const basis = String((course && course.gradingBasis) || '').trim().toLowerCase();
        return [code, grade, basis].join('|');
    })
        .filter((value) => value.replace(/\|/g, ''))
        .sort()
        .join('\u0001');
    const identity = ['termCode', 'termName', 'date', 'term']
        .map((field) => String((semester && semester[field]) || '').trim().toUpperCase())
        .join('|');
    return [courseSignature, identity].join('\u0000');
}

function compareCurriculumSemesterTerms(left, right) {
    try {
        const fn = getCompareSemesterTerms();
        if (fn) return fn(left, right);
    } catch (_) {}
    const leftCode = semesterProgressTermCode(left);
    const rightCode = semesterProgressTermCode(right);
    if (leftCode && rightCode && leftCode !== rightCode) return Number(leftCode) - Number(rightCode);
    if (leftCode && !rightCode) return -1;
    if (!leftCode && rightCode) return 1;
    const leftTie = curriculumSemesterTieKey(left);
    const rightTie = curriculumSemesterTieKey(right);
    return leftTie < rightTie ? -1 : (leftTie > rightTie ? 1 : 0);
}

// A real final grade proves completion even while the course still sits in the
// current term. Successful/pending future-term grades remain projections: they
// are commonly used as expected grades while planning. An explicit F/U/NA/W is
// never projected as successful. Blank/P/I work as projected credit but do not
// become earned merely because their term is in the past.
function courseProgressState(course, semester, explicitCurrentTermCode) {
    if (!course) return COURSE_PROGRESS_STATES.UNVERIFIED;
    const grade = gradeForCourse(course);
    const outcome = evaluateCourseGrade(grade, course.gradingBasis);
    const courseTerm = semesterProgressTermCode(semester);
    const currentTerm = currentProgressTermCode(explicitCurrentTermCode);
    if (!outcome.supported || (!outcome.successful && !outcome.pending)) {
        return COURSE_PROGRESS_STATES.UNSUCCESSFUL;
    }
    if (courseTerm && currentTerm && courseTerm > currentTerm) {
        return COURSE_PROGRESS_STATES.FUTURE;
    }
    if (!courseTerm || !currentTerm) return COURSE_PROGRESS_STATES.UNVERIFIED;
    if (outcome.successful && outcome.earnsCredit) return COURSE_PROGRESS_STATES.EARNED;
    if (courseTerm && currentTerm && courseTerm === currentTerm) {
        return COURSE_PROGRESS_STATES.CURRENT;
    }
    return COURSE_PROGRESS_STATES.UNVERIFIED;
}

// Program GPA membership is intentionally distinct from earned-credit
// eligibility. A failed letter-graded course can belong to a program (and
// therefore contribute zero points over its SU credits to PGPA) without
// satisfying any course or credit requirement. The allocation pass used for
// membership runs successful/planned courses first and classifies these
// terminal failures afterwards, so they cannot displace earned credit.
function isProgramEffectiveType(value) {
    return PROGRAM_EFFECTIVE_TYPES.has(String(value || '').trim().toLowerCase());
}

function programRecordCountsTowardCombinedDegree(record, isMainRecord) {
    if (!record) return false;
    // Main allocation has historically admitted a small fallback class of
    // DM-catalog courses to the generic degree total without assigning a main
    // category. Preserve that valid fallback, while DM records must have an
    // actual program allocation to join the union.
    return isProgramEffectiveType(record.effective)
        || (isMainRecord && record.countsTotal === true);
}

function programUnionGenericRecords(mainRecords, dmRecords) {
    const main = mainRecords instanceof Map ? mainRecords : new Map();
    const dm = dmRecords instanceof Map ? dmRecords : new Map();
    const courses = new Set([...main.keys(), ...dm.keys()]);
    const union = new Map();
    courses.forEach((course) => {
        const mainRecord = main.get(course);
        const dmRecord = dm.get(course);
        const mainCounts = programRecordCountsTowardCombinedDegree(mainRecord, true);
        const dmCounts = programRecordCountsTowardCombinedDegree(dmRecord, false);
        if (!mainCounts && !dmCounts) return;
        // Course credit/ECTS are inherent. Prefer the main record when both
        // programs accept it, and include exactly one copy in the union.
        const source = mainCounts ? mainRecord : dmRecord;
        union.set(course, { ...source, countsTotal: true });
    });
    return union;
}

function totalsForGenericRecords(records) {
    const totals = { total: 0, science: 0, engineering: 0, ects: 0 };
    const rows = records instanceof Map ? records : new Map();
    rows.forEach((record) => {
        if (!record || record.countsTotal !== true) return;
        totals.total += Number(record.credit || 0) || 0;
        totals.science += Number(record.science || 0) || 0;
        totals.engineering += Number(record.engineering || 0) || 0;
        totals.ects += Number(record.ects || 0) || 0;
    });
    return totals;
}

function combinedDegreeMetricsFromAllocations(semesters) {
    const totals = { total: 0, science: 0, engineering: 0, ects: 0 };
    const rows = Array.isArray(semesters) ? semesters : [];
    for (let i = 0; i < rows.length; i++) {
        const courses = rows[i] && Array.isArray(rows[i].courses) ? rows[i].courses : [];
        for (let j = 0; j < courses.length; j++) {
            const course = courses[j];
            if (!course || (!isProgramEffectiveType(course.effective_type)
                && !isProgramEffectiveType(course.effective_type_dm))) continue;
            totals.total += creditOfCourse(course);
            totals.science += Number(course.Basic_Science || 0) || 0;
            totals.engineering += Number(course.Engineering || 0) || 0;
            totals.ects += Number(course.ECTS || 0) || 0;
        }
    }
    return totals;
}

function courseCanHaveProgramGpaMembership(course) {
    if (!course) return false;
    const outcome = evaluateCourseGrade(gradeForCourse(course), course.gradingBasis);
    return !!(outcome.earnsCredit || outcome.pending || outcome.countsInGpa || outcome.needsReview);
}

function calculateGpaForMembership(semesters, isMember, explicitCurrentTermCode, includeEstimates) {
    let points = 0;
    let credits = 0;
    let missingCredits = 0;
    const issues = [];
    const missingCourses = [];
    const currentTerm = currentProgressTermCode(explicitCurrentTermCode);
    const projected = includeEstimates === true;
    const member = typeof isMember === 'function' ? isMember : (() => true);
    const rows = Array.isArray(semesters) ? semesters : [];

    for (let i = 0; i < rows.length; i++) {
        const sem = rows[i];
        const courseTerm = semesterProgressTermCode(sem);
        const courses = (sem && Array.isArray(sem.courses)) ? sem.courses : [];
        for (let j = 0; j < courses.length; j++) {
            const course = courses[j];
            if (!course || !member(course, sem)) continue;
            // Actual averages only accept a known current/past term. Projected
            // averages may use explicitly entered grades from future terms.
            if (!projected && (!courseTerm || !currentTerm || courseTerm > currentTerm)) continue;

            const grade = gradeForCourse(course);
            const outcome = evaluateCourseGrade(grade, course.gradingBasis);
            const credit = creditOfCourse(course);
            if (outcome.needsReview) {
                if (credit > 0) {
                    issues.push({
                        code: outcome.requiresGradingBasis
                            ? 'NA_GRADING_BASIS_UNKNOWN' : 'UNSUPPORTED_GRADE',
                        courseCode: String(course.code || ''),
                        grade,
                    });
                }
                continue;
            }
            if (outcome.countsInGpa) {
                points += credit * outcome.gpaPoints;
                credits += credit;
                continue;
            }
            if (projected && outcome.pending
                && String(outcome.gradingBasis || '').toLowerCase() !== 'satisfactory'
                && credit > 0) {
                missingCredits += credit;
                missingCourses.push(String(course.code || ''));
            }
        }
    }

    const resolved = issues.length === 0;
    return {
        value: resolved && credits ? points / credits : NaN,
        credits,
        points,
        resolved,
        unresolved: !resolved,
        issues,
        complete: resolved && missingCredits === 0,
        missingCredits,
        missingCourses,
        projected,
    };
}

function doubleMajorAverageThreshold(entryTerm) {
    const code = parseInt(String(entryTerm || '0'), 10);
    return Number.isFinite(code) && code > 0 && code < 201901 ? 2.72 : 3.20;
}

function normalizeCourseCode(code) {
    return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function canonicalCourseCode(code) {
    const normalized = normalizeCourseCode(code);
    // CS210 was renamed to DSA210; treat them as the same course.
    return normalized === 'CS210' || normalized === 'DSA210' ? 'DSA210' : normalized;
}

function hasDegreeEligibleCourse(semesters, code, isEligible) {
    const target = canonicalCourseCode(code);
    const eligible = isEligible || isDegreeEligibleCourse;
    for (let i = 0; i < semesters.length; i++) {
        const courses = semesters[i].courses || [];
        for (let j = 0; j < courses.length; j++) {
            const course = courses[j];
            if (course && eligible(course, semesters[i])
                && canonicalCourseCode(course.code) === target) return true;
        }
    }
    return false;
}

function hasAnyDegreeEligibleCourse(semesters, codes, isEligible) {
    for (let i = 0; i < codes.length; i++) {
        if (hasDegreeEligibleCourse(semesters, codes[i], isEligible)) return true;
    }
    return false;
}

// Allocation policy lives in scripts/domain/curriculum-allocation.js.
// Class level is an informational estimate, not a graduation allocation. It
// therefore uses every course whose term/grade state is genuinely earned,
// including a known course that does not belong to the selected program's
// pools. Current, future, unverified, and unsuccessful work is deliberately
// excluded. Undergraduate class levels begin at 34, 64, and 94 earned credits;
// the UI labels the result as an estimate because it is calculated from the
// academic record currently stored in the planner.
function calculateEarnedSuCredits(semesters, explicitCurrentTermCode) {
    const rows = Array.isArray(semesters) ? semesters : [];
    let total = 0;
    for (let i = 0; i < rows.length; i++) {
        const sem = rows[i];
        const courses = sem && Array.isArray(sem.courses) ? sem.courses : [];
        for (let j = 0; j < courses.length; j++) {
            const course = courses[j];
            if (!course || courseProgressState(course, sem, explicitCurrentTermCode)
                !== COURSE_PROGRESS_STATES.EARNED) continue;
            const credit = Number(creditOfCourse(course));
            if (isFinite(credit) && credit > 0) total += credit;
        }
    }
    return total;
}

function estimatedClassLevelForEarnedCredits(value) {
    const parsed = Number(value);
    const earnedCredits = isFinite(parsed) && parsed > 0 ? parsed : 0;
    if (earnedCredits >= 94) {
        return { label: 'Senior', earnedCredits, nextLabel: null,
            nextThreshold: null, creditsToNext: 0, estimated: true };
    }
    if (earnedCredits >= 64) {
        return { label: 'Junior', earnedCredits, nextLabel: 'Senior',
            nextThreshold: 94, creditsToNext: 94 - earnedCredits, estimated: true };
    }
    if (earnedCredits >= 34) {
        return { label: 'Sophomore', earnedCredits, nextLabel: 'Junior',
            nextThreshold: 64, creditsToNext: 64 - earnedCredits, estimated: true };
    }
    return { label: 'Freshman', earnedCredits, nextLabel: 'Sophomore',
        nextThreshold: 34, creditsToNext: 34 - earnedCredits, estimated: true };
}

        return Object.freeze({
            REQUIREMENTS_UNAVAILABLE_FLAG,
            COURSE_PROGRESS_STATES,
            normalizeCourseGrade,
            fallbackGradeOutcome,
            evaluateCourseGrade,
            gradeForCourse,
            isDegreeEligibleCourse,
            normalizeProgressTermCode,
            currentProgressTermCode,
            semesterProgressTermCode,
            curriculumSemesterTieKey,
            compareCurriculumSemesterTerms,
            courseProgressState,
            isProgramEffectiveType,
            programRecordCountsTowardCombinedDegree,
            programUnionGenericRecords,
            totalsForGenericRecords,
            combinedDegreeMetricsFromAllocations,
            courseCanHaveProgramGpaMembership,
            calculateGpaForMembership,
            doubleMajorAverageThreshold,
            normalizeCourseCode,
            canonicalCourseCode,
            hasDegreeEligibleCourse,
            hasAnyDegreeEligibleCourse,
            calculateEarnedSuCredits,
            estimatedClassLevelForEarnedCredits,
        });
    }

    const browserApi = createCurriculumProgress({
        creditOfCourse: allocation.creditOfCourse,
        getGradePolicy: () => root && root.gradePolicy,
        getDocument: () => root && root.document,
        getTermNameToCode: () => root && root.termNameToCode,
        getCurrentTermNameFromDate: () => root && root.getCurrentTermNameFromDate,
        getCurrentTermCode: () => root && root.currentTermCode,
        getCurrentTermName: () => root && root.currentTermName,
        getSemesterTermCode: () => root && root.semesterTermCode,
        getCompareSemesterTerms: () => root && root.compareSemesterTerms,
        getNow: () => new Date(),
    });
    const api = Object.freeze(Object.assign({
        create: createCurriculumProgress,
    }, browserApi));
    namespace.curriculumProgress = api;

    // Preserve the classic-script function globals consumed by the stateful
    // constructor and existing callers while the namespace becomes canonical.
    Object.assign(root, browserApi);
})(typeof window !== 'undefined' ? window : globalThis);
