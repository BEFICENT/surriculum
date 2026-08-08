// Curriculum constructor. In a non-module environment this function will
// be attached to the global window so that other scripts can instantiate
// curricula without using ES module imports.

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
        const policy = (typeof window !== 'undefined') ? window.gradePolicy : null;
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
        const policy = (typeof window !== 'undefined') ? window.gradePolicy : null;
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
        const elem = document.getElementById(course.id);
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
    if (/^\d{6}$/.test(raw)) return raw;
    try {
        const fn = (typeof termNameToCode === 'function') ? termNameToCode
            : ((typeof window !== 'undefined' && typeof window.termNameToCode === 'function')
                ? window.termNameToCode : null);
        const code = fn ? String(fn(raw) || '') : '';
        return /^\d{6}$/.test(code) ? code : '';
    } catch (_) {
        return '';
    }
}

function currentProgressTermCode(explicitCode) {
    const explicit = normalizeProgressTermCode(explicitCode);
    if (explicit) return explicit;
    try {
        if (typeof window !== 'undefined') {
            if (typeof window.getCurrentTermNameFromDate === 'function') {
                const live = normalizeProgressTermCode(window.getCurrentTermNameFromDate(new Date()));
                if (live) return live;
            }
            const code = normalizeProgressTermCode(window.currentTermCode);
            if (code) return code;
            return normalizeProgressTermCode(window.currentTermName);
        }
    } catch (_) {}
    return '';
}

function semesterProgressTermCode(semester) {
    if (!semester) return '';
    const direct = normalizeProgressTermCode(
        semester.termCode || semester.term || semester.termName || semester.date,
    );
    if (direct) return direct;
    try {
        const termList = (typeof terms !== 'undefined' && Array.isArray(terms)) ? terms
            : ((typeof window !== 'undefined' && Array.isArray(window.terms)) ? window.terms : []);
        const idx = semester.termIndex;
        if (idx !== null && idx !== undefined && idx >= 0 && idx < termList.length) {
            const fromIndex = normalizeProgressTermCode(termList[idx]);
            if (fromIndex) return fromIndex;
        }
    } catch (_) {}
    // Legacy plans did not persist a term on the semester model. The rendered
    // semester heading is the last-resort bridge until such a plan is saved.
    try {
        const elem = document.getElementById(semester.id);
        const container = elem && elem.closest ? elem.closest('.container_semester') : null;
        const label = container ? container.querySelector('.date p') : null;
        return normalizeProgressTermCode(label ? label.textContent : '');
    } catch (_) {
        return '';
    }
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

// Expose s_curriculum constructor globally when running in a browser.
if (typeof window !== 'undefined') {
    window.s_curriculum = s_curriculum;
    window.REQUIREMENTS_UNAVAILABLE_FLAG = REQUIREMENTS_UNAVAILABLE_FLAG;
    window.COURSE_PROGRESS_STATES = COURSE_PROGRESS_STATES;
    window.courseProgressState = courseProgressState;
    window.isProgramEffectiveType = isProgramEffectiveType;
    window.calculateGpaForMembership = calculateGpaForMembership;
    window.doubleMajorAverageThreshold = doubleMajorAverageThreshold;
    window.calculateEarnedSuCredits = calculateEarnedSuCredits;
    window.estimatedClassLevelForEarnedCredits = estimatedClassLevelForEarnedCredits;
}

// SUIS rule (VACD): "Only one of the following course pairs will be counted
// towards the degree: 'VA 301 or VA 303', 'VA 401 or VA 403', 'VA 300 or
// PROJ 300'. All the other courses are required."
// PROJ300 no longer exists in any catalog, but SUIS still states the pair, so
// it is kept verbatim — an absent course simply never matches.
const VACD_REQUIRED_PAIRS = [['VA301', 'VA303'], ['VA401', 'VA403'], ['VA300', 'PROJ300']];

// SUIS rule (ME, 2025+ admits): "'ME 403 or ME 425' is required. For students
// who take both courses, 'ME 403/ME 425' is counted towards 'Core Elective'
// course requirements." Likewise for "CS 404 or CS 412".
const ME_2025_ALT_PAIRS = [['ME403', 'ME425'], ['CS404', 'CS412']];

// SUIS (PSY): "Philosophy Requirement Course — Either one of the courses below:
// PHIL 300, PHIL 301." Both are catalog-`required`, and the threshold is tight
// (the seven named PSY courses = 18cr, + one PHIL = 21 = the requirement), so
// this is an alternative pair like the ones above.
//
// SUIS is SILENT on taking both — there is no published rule. Assumption agreed
// with the maintainer: one fills the requirement, the extra counts as a FREE
// elective. Without this the extra cascades into `core`, which PSY's own rules
// contradict: PSY's core is a named 14-course pool that does not include PHIL,
// so an extra PHIL could wrongly help satisfy the core requirement.
const PSY_PHILOSOPHY_PAIR = [['PHIL300', 'PHIL301']];

// Beginning/Basic level language courses — SUIS caps how many of these may
// count toward free electives. These are the School of Languages courses
// (catalog `Faculty: 'SL'`) whose names begin with "Basic". The Intermediate
// ones (FRE130/140, GER130/140, TUR201) and TLL/ENG/AL are NOT capped.
const BASIC_LANGUAGE_COURSES = new Set([
    'FRE110', 'FRE120', 'GER110', 'GER120', 'SPA110', 'SPA120', 'TUR101', 'TUR102',
]);

// University Courses HUM pools — identical in every major's catalog.
const HUM_200_LEVEL = ['HUM201', 'HUM202', 'HUM207'];
const HUM_300_LEVEL = ['HUM311', 'HUM312', 'HUM317', 'HUM321', 'HUM322', 'HUM371'];
const HUM_ANY_LEVEL = HUM_200_LEVEL.concat(HUM_300_LEVEL);

// The two-HUM requirement (one 2xx AND one 3xx) is now stated per program in
// PROGRAM_RULES (flags 12/13 for ECON/MAN/PSIR/PSY/VACD; CS/FENS need one HUM).
// A `humRequired` field in the scraped requirements data would let the tables be
// generated rather than hand-listed — worth doing when the scraper next changes.

// "PSY 4XX-level advanced Psychology courses" (SUIS, PSY area electives).
function isPsyAdvancedCode(code) {
    return /^PSY\s?4\d{2}$/.test(String(code || '').toUpperCase().replace(/\s+/g, ''));
}

// (The former ECON_MATH_REQ / EE_SPECIAL_AREA_CODES / MAN_*_PREFIXES /
// PSIR_CORE_*_POOL / PSY_PHILOSOPHY graduation constants — and the VACD_CORE_POOL_*
// allocation constants — now live as scraped group data in the requirements records
// (see fetch_requirements.py + graduationRulesFor + selectCorePools). MAN_*_PREFIXES
// remain: still used by the allocation engine.)

// Decides each Core-Elective pool course's allocation BEFORE the cascade, from
// the program's SCRAPED `credits` groups (members / min / exclusivePairs /
// overflowTo — see fetch_requirements.py). Returns a Map course -> target type:
// 'core' for the courses filling a pool's minimum (pinned to core so a non-pool
// core elective cannot take the slot the pool graduation check counts), and the
// pool's `overflowTo` (e.g. 'area') for the extras, which then spill onward
// through the normal cascade. Data-driven and per-term, this replaced the hard-
// coded VACD_CORE_POOL_* constants: it tracks the real per-term minimums (VACD's
// Core II was 18 SU pre-2024, 12 after) and generalises to every pooled program
// (VACD, PSIR).
//
// Must run pre-cascade for the usual reason (see collectAltPairExtras): deciding
// afterwards demoted an extra out of `core` once the cascade had already capped
// core and pushed the surplus down, so the freed core slot was never refilled.
function selectCorePools(sortedSems, creditGroups, isExcluded, isEligible) {
    const pools = (creditGroups || []).map((g) => {
        const pairKeyByCode = {};
        (g.exclusivePairs || []).forEach((pair) => {
            const key = pair.join('|');
            pair.forEach((code) => { pairKeyByCode[code] = key; });
        });
        return {
            members: new Set(g.members || []),
            min: g.min || 0,
            overflowTo: g.overflowTo || 'area',
            pairKeyByCode,
            takenPairKeys: new Set(),
            credits: 0,
        };
    });

    const out = new Map();
    for (let i = 0; i < sortedSems.length; i++) {
        const courses = sortedSems[i].courses || [];
        for (let j = 0; j < courses.length; j++) {
            const course = courses[j];
            if (!course || (isEligible && !isEligible(course))
                || (isExcluded && isExcluded(course))) continue;
            for (let p = 0; p < pools.length; p++) {
                const pool = pools[p];
                if (!pool.members.has(course.code)) continue;
                const pairKey = pool.pairKeyByCode[course.code] || null;
                if (pool.credits < pool.min && (!pairKey || !pool.takenPairKeys.has(pairKey))) {
                    out.set(course, 'core');
                    pool.credits += creditOfCourse(course);
                    if (pairKey) pool.takenPairKeys.add(pairKey);
                } else {
                    out.set(course, pool.overflowTo);
                }
                break; // a course belongs to at most one pool
            }
        }
    }
    return out;
}

// SUIS states the same free-elective language cap on every non-engineering
// major, in near-identical words:
//   MAN:  "At most 2 of the Beginning / Basic level language courses can be
//          used to fulfill the requirements for this area."
//   PSY:  "at most two of the beginning/basic level second language courses
//          can be used to fulfill the free elective requirements."
//   VACD: "At most 2 of the Begnining / Basic level language courses can be
//          used to fulfill the requirements for this area."
//   PSIR: "At most two of the beginning/basic level second language courses
//          can be used to fulfill the free elective requirements."
//   ECON: "At most 2 of the Beginning / Basic level language courses can be
//          used to fulfill the requirements for this area."
// One helper for all ten call sites (five majors x main/double-major pass):
// hand-copying this rule per major is how the last several bugs survived.
// `effField` selects the pass: 'effective_type' or 'effective_type_dm'.
const BASIC_LANGUAGE_LIMIT = 2;
function countBasicLanguageInFree(semesters, effField, isEligible) {
    const eligible = isEligible || isDegreeEligibleCourse;
    let count = 0;
    for (let i = 0; i < semesters.length; i++) {
        const courses = semesters[i].courses || [];
        for (let j = 0; j < courses.length; j++) {
            const course = courses[j];
            if (!course || !eligible(course, semesters[i])) continue;
            if (String(course[effField] || '').toLowerCase() !== 'free') continue;
            if (BASIC_LANGUAGE_COURSES.has(course.code)) count++;
        }
    }
    return count;
}

// Alternative-course pairs: a pair is one required slot and the student takes
// ONE of the two. Returns the EXTRA courses — everything after the
// chronologically first member of each pair the student actually completed.
//
// What happens to an extra differs per rule and is the caller's decision, so
// this only identifies them. SUIS is explicit and inconsistent about it: ME's
// extra "is counted towards Core Elective", while VACD's is not "counted
// towards the degree" at all.
//
// Callers MUST act on this BEFORE the allocation cascade. Demoting an extra
// afterwards leaves `required` short: the cascade has already capped `required`
// at its threshold and pushed the surplus into the elective pools, so freeing a
// required slot after the fact never pulls those courses back. Deciding up
// front lets the cascade fill `required` with the kept course.
//
// Shared by both allocation passes: the double-major copy of this rule drifted
// from the main one and kept a bug the main one had already fixed.
function collectAltPairExtras(sortedSems, pairs, isEligible) {
    const norm = (v) => String(v || '').toUpperCase().replace(/\s+/g, '');
    const extras = [];
    for (let p = 0; p < pairs.length; p++) {
        const taken = [];
        for (let i = 0; i < sortedSems.length; i++) {
            const courses = sortedSems[i].courses || [];
            for (let j = 0; j < courses.length; j++) {
                const c = courses[j];
                if (c && (!isEligible || isEligible(c))
                    && pairs[p].indexOf(norm(c.code)) !== -1) taken.push(c);
            }
        }
        for (let k = 1; k < taken.length; k++) extras.push(taken[k]);
    }
    return extras;
}

// Programs whose pre-2025 alternative has a single redundant course that can
// be excluded deterministically when MATH212 is present.
//
// EE and ME state a compound alternative instead: MATH212 OR the complete
// MATH201+MATH202 pair. Their published Required minimums (33/32) make either
// ordinary route work without an exclusion. The unusual all-three-courses case
// remains deliberately untouched until its preferred attempt/order policy is
// specified; it must not complicate the normal routes.
//
// MAT, BIO and DSA are excluded for a different reason: they state no such rule
// and type these courses quite differently (BIO has MATH212 as an `area`
// elective), so the predicate must not touch them.
const MATH_ALTERNATIVE_MAJORS = new Set(['CS', 'IE']);

// SUIS math-alternative rule. MATH212 "Linear Algebra and Differential
// Equations" replaces MATH201 "Linear Algebra" + MATH202 "Differential
// Equations" — but WHICH of them it replaces differs by program:
//
//   CS, IE:  "either MATH 212 or MATH 201"                  (they need only the
//                                                            linear-algebra half)
//   EE, ME:  "either MATH 212 or both (MATH 201 and MATH 202)"
//
// Rather than hard-code four majors, read it off the catalog, which already
// encodes the distinction precisely: for CS/IE, MATH202 is an ordinary `area`
// elective and no part of the alternative; for EE/ME it is `required`. So the
// courses MATH212 stands in for are exactly the `required`-typed ones among
// {MATH201, MATH202} for that program. This is also why CS's original predicate
// skipped only MATH201 and never MATH202 — which looked arbitrary and was right.
//
// 2025+ admits: "MATH 201 and MATH 202 are not included in any course pool",
// full stop, regardless of what else was taken.
//
// SCOPE OF THE EXCLUSION — an interpretation, not a quote. SUIS says the extra
// "will not be included in core, area and free elective course pools", naming
// three pools and saying nothing about the faculty-course pool, which it treats
// separately. We exclude it from EVERYTHING (effective_type 'none'), so an
// excluded MATH201 also stops counting toward the ">=2 MATH-coded faculty
// courses" rule. Maintainer's call, on the reasoning that the 2025+ note says
// "any course pool" outright and reading the older wording more narrowly would
// invent a distinction SUIS never draws. Worth revisiting if SUIS ever clarifies:
// it decides whether some pre-2025 CS/IE students see flag 19.
//
// EE/ME are not wired into this exclusion predicate: their 4-SU route and 6-SU
// pair route are both accepted by their official Required minimum, while the
// only case needing an exclusion decision is the deferred all-three edge.
//
// `elTypeOf(code)` returns the course's EL_Type in this program's catalog.
function mathAlternativeSkipPredicate(entryTermCode, hasCourse, elTypeOf) {
    const entry = parseInt(entryTermCode || '0', 10);
    const is2025Plus = !isNaN(entry) && entry >= 202501;
    if (is2025Plus) {
        return (code) => code === 'MATH201' || code === 'MATH202';
    }
    // Pre-2025: nothing is redundant unless MATH212 is actually held.
    if (!hasCourse('MATH212')) return () => false;
    return (code) => (code === 'MATH201' || code === 'MATH202')
        && elTypeOf(code) === 'required';
}

// The allocation cascade: decide a single course's effective category from its
// static (catalog) type and credit, advancing the running pool counters.
// Surplus spills one pool down: required -> core -> area -> free. `pinCore`
// forces a course into core regardless of the cap (named-pool rules: VACD's
// core pools, IE's CS201) while still consuming core capacity, so ordinary core
// electives fill only the remainder. university / free / anything unexpected
// pass through unchanged.
//
// Shared verbatim by the main-major and double-major passes — this is the one
// piece of allocation logic they both need, and keeping two hand-copies of it
// is exactly how the pool counters drifted before. `counters` and `reqs` carry
// { required, core, area }; `counters` is mutated in place.
function allocateCascade(staticType, credit, counters, reqs, pinCore) {
    if (pinCore) {
        counters.core += credit;
        return 'core';
    }
    if (staticType === 'core') {
        if (counters.core < reqs.core) { counters.core += credit; return 'core'; }
        if (counters.area < reqs.area) { counters.area += credit; return 'area'; }
        return 'free';
    }
    if (staticType === 'area') {
        if (counters.area < reqs.area) { counters.area += credit; return 'area'; }
        return 'free';
    }
    if (staticType === 'required') {
        // A zero-credit required course (e.g. VACD's VA300) consumes no capacity,
        // so it can never overflow: reallocating it would just mislabel a named
        // required course as an elective.
        if (counters.required < reqs.required || credit === 0) {
            counters.required += credit;
            return 'required';
        }
        if (counters.core < reqs.core) { counters.core += credit; return 'core'; }
        if (counters.area < reqs.area) { counters.area += credit; return 'area'; }
        return 'free';
    }
    // 'free', 'university', and any unexpected type are not reallocated.
    return staticType;
}

// Resolve a program's alternative-course rules BEFORE the allocation cascade
// (see collectAltPairExtras for why they cannot run afterwards). Returns the
// three collections the cascade consults:
//   excluded     - counts toward nothing (no pool, no credit total): CS/IE math
//                  extras, 2025+ unknown-typed maths, and VACD pair extras.
//   typeOverride - re-point a course at a specific pool: ME's pair extra -> core,
//                  PSY's philosophy extra -> free, VACD's pool extras -> area.
//   forceCore    - pinned to core regardless of the core cap: VACD's core pools.
//
// Shared by both allocation passes; `major` / `entryTerm` / `getInfoFn` /
// `courseData` select the program (main major or double major). `sortedSems` is
// the chronological order the pair/pool rules depend on; `allSems` is used only
// for the order-independent math-exclusion sweep. `hasCourse` takes a code.
function resolveAlternativeRules(major, entryTerm, sortedSems, allSems, getInfoFn, courseData,
    hasCourse, groups, isEligible, priorityOf) {
    const excluded = new Set();
    const typeOverride = new Map();
    const forceCore = new Set();

    if (MATH_ALTERNATIVE_MAJORS.has(major)) {
        // MATH212 stands in for the `required`-typed subset of {MATH201, MATH202}
        // in this program's catalog (MATH201 for the CS/IE programs entering
        // this branch).
        const elTypeOf = (code) => {
            const rec = getInfoFn(code, courseData);
            return String((rec && rec['EL_Type']) || '').toLowerCase();
        };
        const shouldSkipMath = mathAlternativeSkipPredicate(entryTerm, hasCourse, elTypeOf);
        const entry = parseInt(entryTerm || '0', 10);
        let keepRequiredAlternative = false;
        if (typeof priorityOf === 'function' && !isNaN(entry) && entry < 202501 && hasCourse('MATH212')) {
            const bestRank = (codes) => {
                let best = Infinity;
                allSems.forEach((sem) => {
                    (sem.courses || []).forEach((course) => {
                        if (!course || (isEligible && !isEligible(course, sem))) return;
                        if (!codes.includes(normalizeCourseCode(course.code))) return;
                        const rank = Number(priorityOf(course, sem));
                        if (isFinite(rank)) best = Math.min(best, rank);
                    });
                });
                return best;
            };
            const requiredAlternatives = ['MATH201', 'MATH202']
                .filter((code) => elTypeOf(code) === 'required' && hasCourse(code));
            keepRequiredAlternative = requiredAlternatives.length > 0
                && bestRank(requiredAlternatives) < bestRank(['MATH212']);
        }
        allSems.forEach((sem) => {
            (sem.courses || []).forEach((c) => {
                if (!c || (isEligible && !isEligible(c, sem))) return;
                if (keepRequiredAlternative) {
                    if (normalizeCourseCode(c.code) === 'MATH212') excluded.add(c);
                } else if (shouldSkipMath(c.code)) {
                    excluded.add(c);
                }
            });
        });
    }

    // Deliberately a SEPARATE chain from the maths above, not an `else if`: ME
    // needs both the MATH212 rule AND its own alternative pairs, and chaining
    // them would silently drop the pairs.
    if (major === 'ME') {
        // SUIS: the extra of an ME pair IS counted — toward Core Elective.
        const entry = parseInt(entryTerm || '0', 10);
        if (!isNaN(entry) && entry >= 202501) {
            collectAltPairExtras(sortedSems, ME_2025_ALT_PAIRS, isEligible)
                .forEach((c) => typeOverride.set(c, 'core'));
        }
    } else if (major === 'VACD') {
        // SUIS: "Only one ... will be counted towards the degree" — unlike ME's
        // rule, this one does not count the extra at all, so it is excluded
        // outright rather than allowed to fill a free-elective slot. (The core
        // pools themselves are resolved by the data-driven block below.)
        collectAltPairExtras(sortedSems, VACD_REQUIRED_PAIRS, isEligible)
            .forEach((c) => excluded.add(c));
    } else if (major === 'PSY') {
        // No published rule for taking both; the extra counts as free by agreed
        // assumption. See PSY_PHILOSOPHY_PAIR.
        collectAltPairExtras(sortedSems, PSY_PHILOSOPHY_PAIR, isEligible)
            .forEach((c) => typeOverride.set(c, 'free'));
    }

    // Core-Elective pool selection, driven by the program's SCRAPED `credits`
    // groups (VACD's two core pools, PSIR's). Runs for ANY pooled program, after
    // the program-specific exclusions above so an excluded course cannot fill a
    // pool. Courses filling a pool minimum are pinned to core — the cascade's
    // core cap must not let a non-pool core elective take the slot, since the pool
    // graduation checks count pool courses that actually landed in core — and the
    // extras take the pool's `overflowTo` and spill on through the cascade.
    const creditGroups = (groups || []).filter((g) => g.rule === 'credits');
    if (creditGroups.length) {
        selectCorePools(sortedSems, creditGroups, (c) => excluded.has(c), isEligible)
            .forEach((type, course) => {
                if (type === 'core') forceCore.add(course);
                else typeOverride.set(course, type);
            });
    }

    return { excluded, typeOverride, forceCore };
}

// Field descriptor for a program's allocation: which per-course and per-semester
// fields it reads and writes. The main major and the double major keep parallel
// sets on the SAME course/semester objects (the double-major set is …DM-suffixed
// and reuses the shared credit/science/ECTS totals). This is the first piece of
// "program as a value": allocation helpers take a descriptor instead of hard-
// coding one program's field names.
const MAIN_FIELDS = {
    category: 'category',
    effective: 'effective_type',
    total: {
        core: 'totalCore', area: 'totalArea', free: 'totalFree',
        required: 'totalRequired', university: 'totalUniversity',
    },
};
const DM_FIELDS = {
    category: 'categoryDM',
    effective: 'effective_type_dm',
    total: {
        core: 'totalCoreDM', area: 'totalAreaDM', free: 'totalFreeDM',
        required: 'totalRequiredDM', university: 'totalUniversityDM',
    },
};

function progressAllocationFields(view, layer) {
    const key = '_progress_' + String(view || 'main') + '_' + String(layer || 'projected');
    return {
        category: key + '_category',
        effective: key + '_effective',
        total: {
            core: key + '_core', area: key + '_area', free: key + '_free',
            required: key + '_required', university: key + '_university',
        },
        metric: {
            total: key + '_total', science: key + '_science',
            engineering: key + '_engineering', ects: key + '_ects',
        },
    };
}

const creditOfCourse = (course) => ((typeof parseCreditValue === 'function')
    ? parseCreditValue(course.SU_credit || '0')
    : (parseFloat(course.SU_credit || '0') || 0));

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

// Tally the student's FACULTY COURSES by pool. `Faculty_Course` is the
// faculty-course pool marker (only ~10% of courses carry one) — NOT the offering
// faculty, which is `Faculty`. Conflating the two caused the MAN and DSA bugs, so
// the distinction is deliberate. Courses the given allocation excludes (its
// `effField` === 'none' — a failed course, or a math alternative SUIS drops)
// count toward nothing. `effField` is the effective-type field of the pass being
// checked: 'effective_type' for the main major, 'effective_type_dm' for the DM.
//
// This is the ONE tally the graduation checks share. It was hand-written 22 times
// across the major blocks and the copies had drifted (only CS/EE skipped excluded
// courses); every block now calls this via countFacultyCourses().
function tallyFacultyCourses(semesters, effField, isEligible) {
    const eff = effField || MAIN_FIELDS.effective;
    const eligible = isEligible || isDegreeEligibleCourse;
    const tally = { total: 0, fens: 0, fass: 0, sbs: 0, math: 0 };
    for (let i = 0; i < semesters.length; i++) {
        const courses = semesters[i].courses || [];
        for (let a = 0; a < courses.length; a++) {
            const course = courses[a];
            if (!course || !eligible(course, semesters[i]) || course[eff] === 'none') continue;
            const pool = course.Faculty_Course;
            if (!pool || pool === 'No') continue;
            tally.total++;
            if (pool === 'FENS') {
                tally.fens++;
                if (String(course.code || '').startsWith('MATH')) tally.math++;
            } else if (pool === 'FASS') {
                tally.fass++;
            } else if (pool === 'SBS') {
                tally.sbs++;
            }
        }
    }
    return tally;
}

// Distinct "areas" spanned by the FACULTY COURSES, for the FASS programs'
// "span at least 3 different areas" rule (flag 18: ECON/PSIR/PSY/VACD). Same pool
// marker and none-skip as tallyFacultyCourses. The prefix->area map was copied
// into all four branches; ECON's copy alone tested a "PSYCH" prefix, which no SU
// course code carries (psychology is "PSY"), so ECON silently never credited a
// psychology area — unified here to "PSY".
function tallyFacultyAreas(semesters, effField, isEligible) {
    const eff = effField || MAIN_FIELDS.effective;
    const eligible = isEligible || isDegreeEligibleCourse;
    const areas = new Set();
    for (let i = 0; i < semesters.length; i++) {
        const courses = semesters[i].courses || [];
        for (let a = 0; a < courses.length; a++) {
            const course = courses[a];
            if (!course || !eligible(course, semesters[i]) || course[eff] === 'none') continue;
            const pool = course.Faculty_Course;
            if (!pool || pool === 'No') continue;
            const code = String(course.code || '');
            if (code.startsWith('CULT')) areas.add('CULT');
            else if (code.startsWith('ECON')) areas.add('ECON');
            else if (code.startsWith('HART')) areas.add('HART');
            else if (code.startsWith('PSY')) areas.add('PSYCH');
            else if (code.startsWith('SPS') || code.startsWith('POLS') || code.startsWith('IR')) areas.add('SPS/POLS/IR');
            else if (code.startsWith('VA')) areas.add('VA');
            else if (pool === 'FENS') areas.add('FENS');
            else if (pool === 'SBS') areas.add('SBS');
        }
    }
    return areas;
}

// ---- Rules as data: the graduation-rule evaluator ---------------------------
// A program's per-major graduation requirements are expressed as an ORDERED list
// of plain-data rule descriptors (see PROGRAM_RULES). evaluateRules walks the
// list and returns the flag code of the FIRST unmet rule (0 = all met) — exactly
// the "first unmet requirement wins" behaviour the hand-written per-major branches
// had. The SAME list drives both the main and double-major passes: `ctx.fields`
// is the pass descriptor (MAIN_FIELDS / DM_FIELDS), so each rule reads the right
// pass's effective-type / category fields. Every rule also carries a `suis`
// string citing the SUIS section it comes from.

function forEachCourse(semesters, fn, isEligible) {
    const eligible = isEligible || isDegreeEligibleCourse;
    for (let i = 0; i < semesters.length; i++) {
        const courses = semesters[i].courses || [];
        for (let a = 0; a < courses.length; a++) {
            if (courses[a] && eligible(courses[a], semesters[i])) fn(courses[a], semesters[i]);
        }
    }
}

// Effective category for a course under a given pass, with the historical
// fallback to the static catalog category when the effective type is unset.
function effectiveCategory(course, fields) {
    const e = course[fields.effective];
    if (e) return String(e).toLowerCase();
    const c = fields.category ? course[fields.category] : '';
    return String(c || '').toLowerCase();
}

// Sum SU credits of the courses whose code is in `pool`. Options:
//   effField/catField: the pass's fields (for requireCore's effective lookup);
//   requireCore: only count courses whose effective category is 'core' (VACD);
//   pairs: arrays of mutually-exclusive codes — only the first taken of each pair
//          counts (VACD Core II VA302/VA304, VA402/VA404).
function sumPoolCredits(semesters, pool, opts) {
    const o = opts || {};
    const set = new Set(pool);
    const fields = { effective: o.effField || MAIN_FIELDS.effective, category: o.catField };
    const pairKey = {};
    const seenPairs = o.pairs ? new Set() : null;
    if (o.pairs) o.pairs.forEach((p) => { const k = p.join('|'); p.forEach((c) => { pairKey[c] = k; }); });
    let sum = 0;
    forEachCourse(semesters, (course) => {
        const code = course.code || ((course.Major || '') + (course.Code || ''));
        if (!set.has(code)) return;
        if (o.requireCore && effectiveCategory(course, fields) !== 'core') return;
        if (seenPairs) {
            const k = pairKey[code];
            if (k) { if (seenPairs.has(k)) return; seenPairs.add(k); }
        }
        sum += creditOfCourse(course);
    }, o.isEligible);
    return sum;
}

// type -> predicate(ctx, rule) returning TRUE when the requirement is SATISFIED.
// `ctx` = { curr, semesters, fields, entryTerm }.
const RULE_EVALUATORS = {
    // A specific course is present.
    hasCourse: (ctx, r) => hasDegreeEligibleCourse(ctx.semesters, r.code, ctx.isEligible),
    // At least one of a list is present ("one of the following").
    hasAny: (ctx, r) => hasAnyDegreeEligibleCourse(ctx.semesters, r.codes, ctx.isEligible),
    // A faculty-course pool count meets its minimum (see tallyFacultyCourses).
    facultyCount: (ctx, r) => tallyFacultyCourses(ctx.semesters, ctx.fields.effective, ctx.isEligible)[r.pool] >= r.min,
    // Faculty courses span at least `min` distinct areas (flag 18).
    facultyAreas: (ctx, r) => tallyFacultyAreas(ctx.semesters, ctx.fields.effective, ctx.isEligible).size >= r.min,
    // At most `max` basic/beginning language courses among the free electives.
    languageCap: (ctx, r) => countBasicLanguageInFree(ctx.semesters, ctx.fields.effective, ctx.isEligible) <= r.max,
    // Credits from courses with a code prefix in a STATIC catalog category
    // (EE 400-level core, flag 23).
    levelCreditSum: (ctx, r) => {
        let sum = 0;
        const catField = ctx.fields.category;
        forEachCourse(ctx.semesters, (course) => {
            if (String(course.code || '').startsWith(r.prefix) && course[catField] === r.category) {
                sum += creditOfCourse(course);
            }
        }, ctx.isEligible);
        return sum >= r.min;
    },
    // At least one course from an explicit list, or matching a prefix+static
    // category (EE special area electives, flag 24).
    specialCourseAny: (ctx, r) => {
        const catField = ctx.fields.category;
        let found = false;
        forEachCourse(ctx.semesters, (course) => {
            if (found) return;
            const code = String(course.code || '');
            if (r.codes && r.codes.includes(course.code)) found = true;
            else if (r.altPrefix && code.startsWith(r.altPrefix) && course[catField] === r.altCategory) found = true;
        }, ctx.isEligible);
        return found;
    },
    // Credits from a named pool meet a minimum, with optional effective-core
    // filter and mutually-exclusive pairs (VACD/PSIR core-elective pools).
    poolCreditSum: (ctx, r) => sumPoolCredits(ctx.semesters, r.pool, {
        effField: ctx.fields.effective, catField: ctx.fields.category,
        requireCore: r.requireCore, pairs: r.pairs, isEligible: ctx.isEligible,
    }) >= r.min,
    // At least `min` area-effective courses whose code is an advanced PSY course
    // (flag 39).
    psyAdvancedAreaCount: (ctx, r) => {
        let n = 0;
        forEachCourse(ctx.semesters, (course) => {
            if (String(course[ctx.fields.effective] || '').toLowerCase() === 'area'
                && isPsyAdvancedCode(course.code)) n++;
        }, ctx.isEligible);
        return n >= r.min;
    },
    // Courses in a given effective category span at least `min` of the listed
    // code prefixes (MAN core/area area-spread, flags 35/36).
    categoryPrefixSpan: (ctx, r) => {
        const seen = new Set();
        forEachCourse(ctx.semesters, (course) => {
            if (effectiveCategory(course, ctx.fields) !== r.category) return;
            const code = String(course.code || '');
            for (let i = 0; i < r.prefixes.length; i++) {
                if (code.startsWith(r.prefixes[i])) { seen.add(r.prefixes[i]); break; }
            }
        }, ctx.isEligible);
        return seen.size >= r.min;
    },
    // Credits of free-effective courses OFFERED BY one of the given faculties
    // (`Faculty`, not the faculty-course pool) meet a minimum (MAN, flag 37).
    freeOfferingFacultyCredits: (ctx, r) => {
        let sum = 0;
        forEachCourse(ctx.semesters, (course) => {
            if (String(course[ctx.fields.effective] || '').toLowerCase() === 'free'
                && r.faculties.includes(course.Faculty)) {
                sum += creditOfCourse(course);
            }
        }, ctx.isEligible);
        return sum >= r.min;
    },
    // Count of STATIC-core courses OFFERED BY a faculty meets a minimum
    // (DSA core electives, flags 27/28/29).
    coreOfferingFacultyCount: (ctx, r) => {
        let n = 0;
        const catField = ctx.fields.category;
        forEachCourse(ctx.semesters, (course) => {
            if (course[catField] === 'Core' && course.Faculty === r.faculty) n++;
        }, ctx.isEligible);
        return n >= r.min;
    },
    // Applies only from a given entry term onward; otherwise auto-satisfied
    // (ME 2025+ requires CS404|CS412, flag 2).
    entryGatedHasAny: (ctx, r) => {
        const entry = parseInt(ctx.entryTerm || '0', 10);
        if (isNaN(entry) || entry < r.minTerm) return true;
        return hasAnyDegreeEligibleCourse(ctx.semesters, r.codes, ctx.isEligible);
    },
};

function evaluateRules(ctx, rules) {
    for (let i = 0; i < rules.length; i++) {
        const r = rules[i];
        const ev = RULE_EVALUATORS[r.type];
        // An unknown rule type is a table bug; skip it rather than throw so a
        // single bad descriptor can't block a graduation check entirely.
        if (!ev) continue;
        if (!ev(ctx, r)) return r.flag;
    }
    return 0;
}

// Required of EVERY undergraduate program (each major's SUIS page carries the
// identical block). Prepended to every program's rules. The freshman/1XX + PROJ201
// half is enforced by the generic university-credit check; SPS 303 is the one
// specific course, so it is the rule here.
const UNIVERSITY_RULES = [
    { type: 'hasCourse', code: 'SPS303', flag: 11, suis: 'University Courses (all programs)' },
];

// Per-program graduation requirements as ORDERED data. Evaluated after the
// generic credit/GPA checks (which stay in canGraduate), first unmet wins. The
// same table drives the main and double-major passes. HUM rules live here because
// they differ by program: the FASS programs need one 2XX then one 3XX (flags
// 12 then 13); CS needs any single HUM (12); the FENS programs state none.
// All 12 programs are now migrated to the requirement-groups model — their special
// rules are generated from the scraped `groups` / `facultyReq` data (see
// graduationRulesFor). This is the fallback for a program whose data has not been
// authored yet; it is intentionally empty.
const PROGRAM_RULES = {};

// The HUM university requirement, built from the program's scraped `humRequired`
// (requirements data, via fetch_requirements.py): 2 = one 2XX AND one 3XX HUM
// (flags 12 then 13); 1 = any single HUM (flag 12); 0 / absent = none. Kept out of
// PROGRAM_RULES so the rule is data rather than hand-listed per program.
function humRules(humRequired) {
    if (humRequired >= 2) {
        return [
            { type: 'hasAny', codes: HUM_200_LEVEL, flag: 12, suis: 'University Courses (HUM 2XX)' },
            { type: 'hasAny', codes: HUM_300_LEVEL, flag: 13, suis: 'University Courses (HUM 3XX)' },
        ];
    }
    if (humRequired >= 1) {
        return [{ type: 'hasAny', codes: HUM_ANY_LEVEL, flag: 12, suis: 'University Courses (one HUM)' }];
    }
    return [];
}

// The faculty-course TICKER, generated from the program's scraped `facultyReq`.
// Faculty-course-ness is a cross-cutting tag (`Faculty_Course`) a course carries
// alongside its base type, so this is a plain count, not a base-inheriting group.
// Emitted in a fixed order (first-unmet-wins) with the flag each threshold implies
// — the message wording is threshold-specific (e.g. "3 FENS" is flag 16, "1 FENS"
// is flag 20).
const FACULTY_POOL_ORDER = ['total', 'math', 'fens', 'fass', 'sbs'];
function facultyPoolFlag(pool, min) {
    switch (pool) {
        case 'total': return 14;
        case 'math': return 19;
        case 'fens': return min >= 3 ? 16 : 20;
        case 'fass': return min >= 3 ? 15 : 21;
        case 'sbs': return 22;
        default: return 0;
    }
}
function facultyRules(facultyReq) {
    if (!facultyReq) return [];
    const rules = [];
    for (let i = 0; i < FACULTY_POOL_ORDER.length; i++) {
        const pool = FACULTY_POOL_ORDER[i];
        const min = facultyReq[pool];
        if (min != null) rules.push({ type: 'facultyCount', pool, min, flag: facultyPoolFlag(pool, min), suis: 'Faculty Courses' });
    }
    if (facultyReq.areas != null) rules.push({ type: 'facultyAreas', min: facultyReq.areas, flag: 18, suis: 'Faculty Courses (areas)' });
    return rules;
}

// Graduation rules generated from a program's ORDERED `groups` list (each a named
// subset of a base type, or the special `faculty` marker that splices in the
// cross-cutting faculty ticker at its position in the order — so first-unmet-wins
// matches the program's SUIS order). Each `rule` maps to a step-4 evaluator; a
// credits group measures base-effective credit when `requireBase` is set. An
// unknown rule is skipped (incomplete data rather than a thrown check).
function groupRules(groups, facultyReq) {
    const out = [];
    for (let i = 0; i < (groups ? groups.length : 0); i++) {
        const g = groups[i];
        switch (g.rule) {
            case 'faculty':
                Array.prototype.push.apply(out, facultyRules(facultyReq));
                break;
            case 'credits':
                out.push({ type: 'poolCreditSum', pool: g.members, requireCore: !!g.requireBase, pairs: g.exclusivePairs, min: g.min, flag: g.flag, suis: g.suis });
                break;
            case 'oneOf':
                out.push({ type: 'hasAny', codes: g.members, flag: g.flag, suis: g.suis });
                break;
            case 'entryGatedOneOf':
                out.push({ type: 'entryGatedHasAny', minTerm: g.minTerm, codes: g.members, flag: g.flag, suis: g.suis });
                break;
            case 'levelCredits':
                out.push({ type: 'levelCreditSum', prefix: g.prefix, category: g.category, min: g.min, flag: g.flag, suis: g.suis });
                break;
            case 'specialAny':
                out.push({ type: 'specialCourseAny', codes: g.members, altPrefix: g.altPrefix, altCategory: g.altCategory, flag: g.flag, suis: g.suis });
                break;
            case 'prefixSpan':
                out.push({ type: 'categoryPrefixSpan', category: g.category, prefixes: g.prefixes, min: g.min, flag: g.flag, suis: g.suis });
                break;
            case 'offeringCredits':
                out.push({ type: 'freeOfferingFacultyCredits', faculties: g.faculties, min: g.min, flag: g.flag, suis: g.suis });
                break;
            case 'offeringCount':
                out.push({ type: 'coreOfferingFacultyCount', faculty: g.faculty, min: g.min, flag: g.flag, suis: g.suis });
                break;
            case 'advancedCount':
                out.push({ type: 'psyAdvancedAreaCount', min: g.min, flag: g.flag, suis: g.suis });
                break;
            case 'languageCap':
                out.push({ type: 'languageCap', max: g.max, flag: g.flag, suis: g.suis });
                break;
            default:
                break;
        }
    }
    return out;
}

// ---- Requirement-group PROGRESS (summary UI) --------------------------------
// The graduation check only needs "met / first-unmet flag". The Summary panel
// wants the numbers behind each rule ("Core I: 6/9 SU"), so groupProgressFor
// measures the SAME quantity each evaluator compares, and reports it as an
// ordered list of progress rows. It mirrors groupRules one-for-one so the two can
// never disagree about what a group means; `ok` is derived from the same compare
// (>= min, or <= max for a cap).

const FACULTY_POOL_LABELS = {
    total: 'Faculty courses',
    math: 'MATH faculty courses',
    fens: 'FENS faculty courses',
    fass: 'FASS faculty courses',
    sbs: 'SBS faculty courses',
};

// Progress rows for the faculty-course ticker, mirroring facultyRules' order.
function facultyProgress(ctx, facultyReq) {
    if (!facultyReq) return [];
    const tally = tallyFacultyCourses(ctx.semesters, ctx.fields.effective, ctx.isEligible);
    const rows = [];
    for (let i = 0; i < FACULTY_POOL_ORDER.length; i++) {
        const pool = FACULTY_POOL_ORDER[i];
        const min = facultyReq[pool];
        if (min == null) continue;
        const current = tally[pool] || 0;
        rows.push({ id: 'faculty_' + pool, label: FACULTY_POOL_LABELS[pool] || pool,
            suis: 'Faculty Courses', current, target: min, unit: 'course', ok: current >= min });
    }
    if (facultyReq.areas != null) {
        const current = tallyFacultyAreas(ctx.semesters, ctx.fields.effective, ctx.isEligible).size;
        rows.push({ id: 'faculty_areas', label: 'Faculty-course areas', suis: 'Faculty Courses (areas)',
            current, target: facultyReq.areas, unit: 'area', ok: current >= facultyReq.areas });
    }
    return rows;
}

// Per-group progress rows for a program's ordered `groups` list (the faculty
// marker expands to facultyProgress at its position). Each row:
//   { id, label, suis, base, current, target, unit, ok, isCap?, note? }
// A boolean group ("one of …") reports current 0/1 against target 1.
function groupProgressFor(ctx, groups, facultyReq) {
    const out = [];
    const fields = ctx.fields;
    const catField = fields.category;
    for (let i = 0; i < (groups ? groups.length : 0); i++) {
        const g = groups[i];
        const base = { id: g.id, label: g.label, suis: g.suis, base: g.base };
        switch (g.rule) {
            case 'faculty':
                Array.prototype.push.apply(out, facultyProgress(ctx, facultyReq));
                break;
            case 'credits': {
                const current = sumPoolCredits(ctx.semesters, g.members, {
                    effField: fields.effective, catField, requireCore: !!g.requireBase,
                    pairs: g.exclusivePairs, isEligible: ctx.isEligible });
                out.push({ ...base, current, target: g.min, unit: 'SU', ok: current >= g.min });
                break;
            }
            case 'oneOf': {
                const current = hasAnyDegreeEligibleCourse(ctx.semesters, g.members, ctx.isEligible) ? 1 : 0;
                out.push({ ...base, current, target: 1, unit: 'course', ok: current >= 1 });
                break;
            }
            case 'entryGatedOneOf': {
                const entry = parseInt(ctx.entryTerm || '0', 10);
                if (isNaN(entry) || entry < g.minTerm) {
                    out.push({ ...base, current: 1, target: 1, unit: 'course', ok: true,
                        note: 'Not required for your admit term' });
                } else {
                    const current = hasAnyDegreeEligibleCourse(ctx.semesters, g.members, ctx.isEligible) ? 1 : 0;
                    out.push({ ...base, current, target: 1, unit: 'course', ok: current >= 1 });
                }
                break;
            }
            case 'levelCredits': {
                let sum = 0;
                forEachCourse(ctx.semesters, (course) => {
                    if (String(course.code || '').startsWith(g.prefix) && course[catField] === g.category) {
                        sum += creditOfCourse(course);
                    }
                }, ctx.isEligible);
                out.push({ ...base, current: sum, target: g.min, unit: 'SU', ok: sum >= g.min });
                break;
            }
            case 'specialAny': {
                let found = false;
                forEachCourse(ctx.semesters, (course) => {
                    if (found) return;
                    const code = String(course.code || '');
                    if (g.members && g.members.includes(course.code)) found = true;
                    else if (g.altPrefix && code.startsWith(g.altPrefix) && course[catField] === g.altCategory) found = true;
                }, ctx.isEligible);
                out.push({ ...base, current: found ? 1 : 0, target: 1, unit: 'course', ok: found });
                break;
            }
            case 'prefixSpan': {
                const seen = new Set();
                forEachCourse(ctx.semesters, (course) => {
                    if (effectiveCategory(course, fields) !== g.category) return;
                    const code = String(course.code || '');
                    for (let k = 0; k < g.prefixes.length; k++) {
                        if (code.startsWith(g.prefixes[k])) { seen.add(g.prefixes[k]); break; }
                    }
                }, ctx.isEligible);
                out.push({ ...base, current: seen.size, target: g.min, unit: 'area', ok: seen.size >= g.min });
                break;
            }
            case 'offeringCredits': {
                let sum = 0;
                forEachCourse(ctx.semesters, (course) => {
                    if (String(course[fields.effective] || '').toLowerCase() === 'free'
                        && g.faculties.includes(course.Faculty)) {
                        sum += creditOfCourse(course);
                    }
                }, ctx.isEligible);
                out.push({ ...base, current: sum, target: g.min, unit: 'SU', ok: sum >= g.min });
                break;
            }
            case 'offeringCount': {
                let n = 0;
                forEachCourse(ctx.semesters, (course) => {
                    if (course[catField] === 'Core' && course.Faculty === g.faculty) n++;
                }, ctx.isEligible);
                out.push({ ...base, current: n, target: g.min, unit: 'course', ok: n >= g.min });
                break;
            }
            case 'advancedCount': {
                let n = 0;
                forEachCourse(ctx.semesters, (course) => {
                    if (String(course[fields.effective] || '').toLowerCase() === 'area'
                        && isPsyAdvancedCode(course.code)) n++;
                }, ctx.isEligible);
                out.push({ ...base, current: n, target: g.min, unit: 'course', ok: n >= g.min });
                break;
            }
            case 'languageCap': {
                const current = countBasicLanguageInFree(ctx.semesters, fields.effective, ctx.isEligible);
                out.push({ ...base, current, target: g.max, unit: 'course', isCap: true, ok: current <= g.max });
                break;
            }
            default:
                break;
        }
    }
    return out;
}

// The ordered rule list for a program. `req` is its requirements record. When it
// carries the requirement-groups data, the special rules are GENERATED from it:
// `groups` (ordered, with the faculty marker) drives programs with special
// requirements; a bare `facultyReq` (no groups) covers the faculty-ticker-only
// programs. Otherwise the app falls back to the hard-listed PROGRAM_RULES entry
// (unmigrated). Always prefixed by the shared university rules + the HUM rule.
function graduationRulesFor(major, req) {
    const r = req || {};
    const shared = UNIVERSITY_RULES.concat(humRules(r.humRequired));
    if (r.groups) {
        return shared.concat(groupRules(r.groups, r.facultyReq));
    }
    if (r.facultyReq) {
        return shared.concat(facultyRules(r.facultyReq));
    }
    return shared.concat(PROGRAM_RULES[major] || []);
}

// Render the allocation result to the DOM: each course's `.course_type` label
// (single, or dual MAIN/DM parts for a double major) and each semester's
// total-credit text. Reads ONLY the model the allocation sets (effective_type /
// category / totalCredit), so it runs as a separate pass AFTER allocation rather
// than being interleaved into it — the domain/UI split for the engine. No-ops
// safely outside a browser. Pinned by allocation-render.spec.js.
function renderAllocationLabels(curriculum) {
    if (typeof document === 'undefined') return;
    const isDouble = !!curriculum.doubleMajor;
    const label = (v) => (String(v || '').toLowerCase() === 'none' ? 'N/A' : String(v || '').toUpperCase());
    const movedDown = (base, eff) => {
        const b = String(base || '').toLowerCase();
        const e = String(eff || '').toLowerCase();
        return !!(b && e && b !== e && e !== 'none');
    };
    const sems = curriculum.semesters || [];
    for (let i = 0; i < sems.length; i++) {
        const sem = sems[i];
        const courses = sem.courses || [];
        for (let j = 0; j < courses.length; j++) {
            const course = courses[j];
            if (!course || !course.id) continue;
            let typeSpan = null;
            try {
                const elem = document.getElementById(course.id);
                typeSpan = elem ? elem.querySelector('.course_type') : null;
            } catch (_) {}
            if (!typeSpan) continue;
            if (isDouble && course.effective_type_dm) {
                const mt = label(course.effective_type);
                const dt = label(course.effective_type_dm);
                const mainCls = movedDown(course.category, course.effective_type) ? 'is-overflow-type' : '';
                const dmCls = movedDown(course.categoryDM, course.effective_type_dm) ? 'is-overflow-type' : '';
                try {
                    typeSpan.replaceChildren();
                    const mainPart = document.createElement('span');
                    mainPart.className = 'course_type_part ct-main' + (mainCls ? ' ' + mainCls : '');
                    mainPart.textContent = mt;
                    const separator = document.createElement('span');
                    separator.className = 'ct-sep';
                    separator.textContent = ' / ';
                    const dmPart = document.createElement('span');
                    dmPart.className = 'course_type_part ct-dm' + (dmCls ? ' ' + dmCls : '');
                    dmPart.textContent = dt;
                    typeSpan.appendChild(mainPart);
                    typeSpan.appendChild(separator);
                    typeSpan.appendChild(dmPart);
                } catch (_) {
                    typeSpan.textContent = mt + ' / ' + dt;
                }
                // Dual labels colour per part, so clear any whole-span class.
                try { typeSpan.classList.remove('is-overflow-type'); } catch (_) {}
            } else {
                // Single label. In double-major mode overflow is coloured per
                // part, so the whole-span class is cleared (matches the old DM
                // render); in single-major mode it toggles with the main overflow.
                typeSpan.textContent = label(course.effective_type);
                try {
                    if (isDouble) typeSpan.classList.remove('is-overflow-type');
                    else typeSpan.classList.toggle('is-overflow-type', movedDown(course.category, course.effective_type));
                } catch (_) {}
            }
        }
        // Per-semester total-credit text.
        try {
            const semElem = document.getElementById(sem.id);
            let containerElem = semElem && semElem.closest ? semElem.closest('.container_semester') : null;
            if (!containerElem && semElem) {
                let parent = semElem.parentNode;
                while (parent && !(parent.classList && parent.classList.contains('container_semester'))) {
                    parent = parent.parentNode;
                }
                containerElem = parent;
            }
            const span = containerElem && containerElem.querySelector('.total_credit_text span');
            if (span) {
                span.textContent = 'Total: ' + sem.totalCredit + ' credits';
                try { span.classList.toggle('is-overlimit', (sem.totalCredit || 0) > 20); } catch (_) {}
            }
        } catch (_) {}
    }
}

// Reset and re-accumulate a program's per-semester category totals from the
// courses' current effective types. The generic credit/science/engineering/ECTS
// totals are owned by the main allocation loop and deliberately not touched.
function recomputeCategoryTotals(allSems, fields) {
    const T = fields.total;
    for (let i = 0; i < allSems.length; i++) {
        const sem = allSems[i];
        sem[T.core] = 0;
        sem[T.area] = 0;
        sem[T.free] = 0;
        sem[T.required] = 0;
        sem[T.university] = 0;
        for (let j = 0; j < sem.courses.length; j++) {
            const course = sem.courses[j];
            if (!course) continue;
            const et = course[fields.effective];
            if (!et || et === 'none') continue;
            const c = creditOfCourse(course);
            if (et === 'core') sem[T.core] += c;
            else if (et === 'area') sem[T.area] += c;
            else if (et === 'free') sem[T.free] += c;
            else if (et === 'required') sem[T.required] += c;
            else if (et === 'university') sem[T.university] += c;
        }
    }
}

// MAN's core/area electives carry "at least one from each area" constraints, and
// an extra core elective may count as an area elective. The generic cascade can
// place a required-prefix core elective into area/free even when a feasible
// assignment exists, so after the cascade MAN re-selects: a core-prefix-covering
// subset counts as core (then fill to the core threshold), an area-prefix-
// covering subset of the remainder counts as area (then fill to the area
// threshold), and everything left becomes free. Shared by both passes via the
// `fields` descriptor; only the effective-type field is rewritten, then the
// category totals are recomputed to match.
const MAN_CORE_PREFIXES = ['ACC', 'FIN', 'MGMT', 'MKTG', 'OPIM', 'ORG'];
const MAN_AREA_PREFIXES = ['ACC', 'FIN', 'MKTG', 'OPIM', 'ORG'];

function applyManDiversity(sortedSems, allSems, fields, reqCore, reqArea) {
    const firstMatchingPrefix = (code, prefixes) => {
        for (let i = 0; i < prefixes.length; i++) {
            if (code.startsWith(prefixes[i])) return prefixes[i];
        }
        return null;
    };

    // Gather elective candidates in chronological order (as the allocation loop
    // used them).
    const electiveItems = [];
    for (let i = 0; i < sortedSems.length; i++) {
        const sem = sortedSems[i];
        for (let j = 0; j < sem.courses.length; j++) {
            const course = sem.courses[j];
            if (!course || !course.id) continue;
            if (course[fields.effective] === 'none') continue;
            const cat = course[fields.category];
            if (cat !== 'Core' && cat !== 'Area') continue;
            const credit = creditOfCourse(course);
            electiveItems.push({
                id: course.id,
                code: course.code,
                staticType: (cat || '').toLowerCase(),
                credit: isNaN(credit) ? 0 : credit,
                courseRef: course,
            });
        }
    }

    const coreCandidates = electiveItems.filter((it) => it.staticType === 'core');
    const selectedCore = new Set();
    const coreByPrefix = {};
    for (let i = 0; i < coreCandidates.length; i++) {
        const it = coreCandidates[i];
        const prefix = firstMatchingPrefix(it.code, MAN_CORE_PREFIXES);
        if (!prefix) continue;
        if (!coreByPrefix[prefix]) coreByPrefix[prefix] = [];
        coreByPrefix[prefix].push(it);
    }
    let coreCredits = 0;
    for (let i = 0; i < MAN_CORE_PREFIXES.length; i++) {
        const bucket = coreByPrefix[MAN_CORE_PREFIXES[i]] || [];
        if (bucket.length) {
            const pick = bucket[0];
            if (!selectedCore.has(pick.id)) {
                selectedCore.add(pick.id);
                coreCredits += pick.credit;
            }
        }
    }
    for (let i = 0; i < coreCandidates.length && coreCredits < reqCore; i++) {
        const it = coreCandidates[i];
        if (selectedCore.has(it.id)) continue;
        selectedCore.add(it.id);
        coreCredits += it.credit;
    }

    // Area candidates: static area electives plus overflow core electives not
    // selected as core.
    const areaCandidates = electiveItems
        .filter((it) => it.staticType === 'area')
        .concat(coreCandidates.filter((it) => !selectedCore.has(it.id)));
    const selectedArea = new Set();
    const areaByPrefix = {};
    for (let i = 0; i < areaCandidates.length; i++) {
        const it = areaCandidates[i];
        const prefix = firstMatchingPrefix(it.code, MAN_AREA_PREFIXES);
        if (!prefix) continue;
        if (!areaByPrefix[prefix]) areaByPrefix[prefix] = [];
        areaByPrefix[prefix].push(it);
    }
    let areaCredits = 0;
    for (let i = 0; i < MAN_AREA_PREFIXES.length; i++) {
        const bucket = areaByPrefix[MAN_AREA_PREFIXES[i]] || [];
        if (bucket.length) {
            const pick = bucket[0];
            if (!selectedArea.has(pick.id) && !selectedCore.has(pick.id)) {
                selectedArea.add(pick.id);
                areaCredits += pick.credit;
            }
        }
    }
    for (let i = 0; i < areaCandidates.length && areaCredits < reqArea; i++) {
        const it = areaCandidates[i];
        if (selectedCore.has(it.id) || selectedArea.has(it.id)) continue;
        selectedArea.add(it.id);
        areaCredits += it.credit;
    }

    for (let i = 0; i < electiveItems.length; i++) {
        const it = electiveItems[i];
        if (selectedCore.has(it.id)) it.courseRef[fields.effective] = 'core';
        else if (selectedArea.has(it.id)) it.courseRef[fields.effective] = 'area';
        else it.courseRef[fields.effective] = 'free';
    }

    recomputeCategoryTotals(allSems, fields);
}

function s_curriculum()
{
    this.semester_id = 0;
    this.course_id = 0;
    this.container_id = 0;
    this.semesters = [];
    this.major = '';

    // Academic entry term codes (e.g., "202301") for the main major and
    // optional double major. These control which requirement set is used
    // when evaluating graduation status.
    this.entryTerm = '';

    // When the user chooses a double major via the UI, this property is
    // assigned the second major's code (e.g., "EE").  When set, the
    // curriculum will compute a second set of effective course categories
    // (core, area, free) for the double major using the
    // recalcEffectiveTypesDouble method.  If undefined or empty, no
    // double major processing occurs.
    this.doubleMajor = '';
    this.entryTermDM = '';

    // Helper to retrieve requirement object for a given major and term code.
    // The global `requirements` may either be a flat object keyed by major or
    // a nested object keyed by term then major. This function abstracts the
    // lookup so both formats are supported during the transition to
    // term-based data.
    const getReq = (major, term) => {
        if (typeof getRequirementRecord === 'function') {
            return getRequirementRecord(major, term) || {};
        }
        if (typeof requirements === 'undefined') return {};
        if (requirements[term] && requirements[term][major]) {
            return requirements[term][major];
        }
        if (requirements[major]) return requirements[major];
        return {};
    };

    const requirementRecordIsValid = (major, record) => {
        if (typeof isValidRequirementRecord === 'function') {
            return isValidRequirementRecord(record, major);
        }
        if (!record || typeof record !== 'object' || Array.isArray(record)) return false;
        const fields = ['university', 'required', 'core', 'area', 'free', 'ects', 'total', 'humRequired'];
        return fields.every(field => Number.isInteger(record[field]) && record[field] >= 0)
            && record.total > 0
            && record.ects > 0
            && record.facultyReq
            && typeof record.facultyReq === 'object'
            && !Array.isArray(record.facultyReq);
    };

    const catalogRecordFor = (catalog, code) => {
        const target = normalizeCourseCode(code);
        const rows = Array.isArray(catalog) ? catalog : [];
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            if (normalizeCourseCode((row && row.Major || '') + (row && row.Code || '')) === target) {
                return row;
            }
        }
        return null;
    };

    const customRecordFor = (major, code) => {
        try {
            if (typeof localStorage === 'undefined') return null;
            const key = 'customCourses_' + major;
            const ps = (typeof window !== 'undefined') ? window.planStorage : null;
            const planId = (ps && typeof ps.getSessionPlanId === 'function')
                ? ps.getSessionPlanId() : null;
            let stored = null;
            if (ps && typeof ps.getItem === 'function') {
                if (!planId) return null;
                try { stored = ps.getItem(key, planId); } catch (_) { return null; }
            } else {
                try { stored = localStorage.getItem(key); } catch (_) {}
            }
            if (!stored) return null;
            return catalogRecordFor(JSON.parse(stored), code);
        } catch (_) {
            return null;
        }
    };

    const sortedProgressSemesters = () => this.semesters.slice().sort((a, b) => {
        const codeA = semesterProgressTermCode(a);
        const codeB = semesterProgressTermCode(b);
        if (codeA && codeB && codeA !== codeB) return codeA.localeCompare(codeB);
        if (codeA && !codeB) return -1;
        if (!codeA && codeB) return 1;
        const idxA = (a.termIndex !== null && a.termIndex !== undefined) ? a.termIndex : -1;
        const idxB = (b.termIndex !== null && b.termIndex !== undefined) ? b.termIndex : -1;
        return idxB - idxA;
    });

    const addProgressMetric = (sem, fields, key, value) => {
        const n = parseFloat(value || '0');
        sem[fields.metric[key]] += isNaN(n) ? 0 : n;
    };

    // Independent allocation pass used by the earned/projected audit. It
    // intentionally writes only private progress fields; the planner's normal
    // effective types and totals remain the forward-looking allocation.
    const runProgressAllocation = (view, layer, isEligible, stateOf) => {
        const isDM = view === 'dm';
        const major = isDM ? this.doubleMajor : this.major;
        const entryTerm = isDM ? this.entryTermDM : this.entryTerm;
        const req = getReq(major, entryTerm);
        const fields = progressAllocationFields(view, layer);
        if (!major || !requirementRecordIsValid(major, req)) {
            return { available: false, major, entryTerm, req, fields, totals: {}, records: new Map(), isEligible };
        }

        const catalog = isDM ? this.doubleMajorCourseData : this.primaryCourseData;
        const lookup = (code, data) => catalogRecordFor(data || catalog, code)
            || customRecordFor(major, code);
        const chronological = sortedProgressSemesters();
        // Keep projected allocation monotonic from the student's perspective:
        // earned courses claim pools first, followed by current, future, and
        // unverified courses. Within each state, retain chronological/course
        // order. This prevents a planned course from visually displacing credit
        // that has already been earned while preserving the normal cascade.
        const stateOrder = [
            COURSE_PROGRESS_STATES.EARNED,
            COURSE_PROGRESS_STATES.CURRENT,
            COURSE_PROGRESS_STATES.FUTURE,
            COURSE_PROGRESS_STATES.UNVERIFIED,
            COURSE_PROGRESS_STATES.UNSUCCESSFUL,
        ];
        const sorted = [];
        for (let s = 0; s < stateOrder.length; s++) {
            const wanted = stateOrder[s];
            for (let i = 0; i < chronological.length; i++) {
                const source = chronological[i];
                const courses = (source.courses || []).filter((course) => {
                    const state = typeof stateOf === 'function'
                        ? stateOf(course, source) : courseProgressState(course, source);
                    return state === wanted;
                });
                if (courses.length) sorted.push({ _progressSource: source, courses });
            }
        }
        const semesterByCourse = new Map();
        const records = new Map();

        for (let i = 0; i < this.semesters.length; i++) {
            const sem = this.semesters[i];
            Object.values(fields.total).forEach((name) => { sem[name] = 0; });
            Object.values(fields.metric).forEach((name) => { sem[name] = 0; });
            const courses = sem.courses || [];
            for (let j = 0; j < courses.length; j++) {
                const course = courses[j];
                if (!course) continue;
                semesterByCourse.set(course, sem);
                course[fields.effective] = 'none';
                delete course[fields.category];

                // Named-pool selection reads credit metadata before the main
                // cascade. Seed it from this program's catalog first.
                const info = lookup(course.code, catalog);
                if (info) {
                    course.SU_credit = (typeof parseCreditValue === 'function')
                        ? parseCreditValue(info.SU_credit || '0')
                        : (parseFloat(info.SU_credit || '0') || 0);
                    course.Basic_Science = parseFloat(info.Basic_Science || '0') || 0;
                    course.Engineering = parseFloat(info.Engineering || '0') || 0;
                    course.ECTS = parseFloat(info.ECTS || '0') || 0;
                    course.Faculty_Course = info.Faculty_Course || course.Faculty_Course || 'No';
                    course.Faculty = info.Faculty || course.Faculty || '';
                }
            }
        }

        const eligible = (course, sem) => !!course
            && isEligible(course, sem || semesterByCourse.get(course));
        const hasEligible = (code) => hasDegreeEligibleCourse(this.semesters, code, eligible);
        const reqs = { required: req.required || 0, core: req.core || 0, area: req.area || 0 };
        const counters = { required: 0, core: 0, area: 0 };
        const forceCSCore = major === 'IE' && hasEligible('CS201') && hasEligible('DSA201');
        const alternatives = resolveAlternativeRules(
            major, entryTerm, sorted, this.semesters, lookup, catalog,
            hasEligible, req.groups, eligible,
            (course, sem) => stateOrder.indexOf(
                typeof stateOf === 'function'
                    ? stateOf(course, sem || semesterByCourse.get(course))
                    : courseProgressState(course, sem || semesterByCourse.get(course)),
            ),
        );

        for (let i = 0; i < sorted.length; i++) {
            const semView = sorted[i];
            const sem = semView._progressSource || semView;
            const courses = semView.courses || [];
            for (let j = 0; j < courses.length; j++) {
                const course = courses[j];
                if (!eligible(course, sem) || alternatives.excluded.has(course)) continue;

                let info = lookup(course.code, catalog);
                if (!info && !isDM) {
                    // A course known only to the double-major catalog contributes
                    // inherent credit/ECTS to the shared degree total, but must
                    // not inherit the double major's category in the main pass.
                    const fallback = catalogRecordFor(this.doubleMajorCourseData, course.code);
                    const credit = fallback
                        ? ((typeof parseCreditValue === 'function')
                            ? parseCreditValue(fallback.SU_credit || '0')
                            : (parseFloat(fallback.SU_credit || '0') || 0))
                        : creditOfCourse(course);
                    const science = parseFloat((fallback && fallback.Basic_Science) || course.Basic_Science || '0') || 0;
                    const engineering = parseFloat((fallback && fallback.Engineering) || course.Engineering || '0') || 0;
                    const ects = parseFloat((fallback && fallback.ECTS) || course.ECTS || '0') || 0;
                    course.SU_credit = credit;
                    course.Basic_Science = science;
                    course.Engineering = engineering;
                    course.ECTS = ects;
                    course.Faculty_Course = (fallback && fallback.Faculty_Course) || course.Faculty_Course || 'No';
                    course.Faculty = (fallback && fallback.Faculty) || course.Faculty || '';
                    addProgressMetric(sem, fields, 'total', credit);
                    addProgressMetric(sem, fields, 'science', science);
                    addProgressMetric(sem, fields, 'engineering', engineering);
                    addProgressMetric(sem, fields, 'ects', ects);
                    records.set(course, { effective: 'none', category: '', credit,
                        science, engineering, ects, countsTotal: true });
                    continue;
                }
                if (!info) continue;

                let staticType = String(info.EL_Type || '').toLowerCase();
                if (alternatives.typeOverride.has(course)) {
                    staticType = alternatives.typeOverride.get(course);
                }
                if (staticType === 'unknown') continue;

                const credit = (typeof parseCreditValue === 'function')
                    ? parseCreditValue(info.SU_credit || '0')
                    : (parseFloat(info.SU_credit || '0') || 0);
                const science = parseFloat(info.Basic_Science || '0') || 0;
                const engineering = parseFloat(info.Engineering || '0') || 0;
                const ects = parseFloat(info.ECTS || '0') || 0;
                course.SU_credit = credit;
                course.Basic_Science = science;
                course.Engineering = engineering;
                course.ECTS = ects;
                course.Faculty_Course = info.Faculty_Course || 'No';
                course.Faculty = info.Faculty || '';
                if (staticType) {
                    course[fields.category] = staticType.charAt(0).toUpperCase() + staticType.slice(1);
                }

                const pinCore = alternatives.forceCore.has(course)
                    || (forceCSCore && course.code === 'CS201');
                const effective = allocateCascade(staticType, credit, counters, reqs, pinCore);
                course[fields.effective] = effective || 'none';
                const totalField = fields.total[effective];
                if (totalField) sem[totalField] += credit;
                // The DM's generic degree totals are shared with the main plan;
                // its own pass owns only category allocation.
                if (!isDM) {
                    addProgressMetric(sem, fields, 'total', credit);
                    addProgressMetric(sem, fields, 'science', science);
                    addProgressMetric(sem, fields, 'engineering', engineering);
                    addProgressMetric(sem, fields, 'ects', ects);
                }
                records.set(course, { effective: effective || 'none', category: staticType,
                    credit, science, engineering, ects, countsTotal: !isDM });
            }
        }

        if (major === 'MAN') {
            applyManDiversity(sorted, this.semesters, fields, req.core || 0, req.area || 0);
        }

        const totals = {
            area: 0, core: 0, free: 0, university: 0, required: 0,
            total: 0, science: 0, engineering: 0, ects: 0,
        };
        for (let i = 0; i < this.semesters.length; i++) {
            const sem = this.semesters[i];
            Object.keys(fields.total).forEach((key) => { totals[key] += sem[fields.total[key]] || 0; });
            Object.keys(fields.metric).forEach((key) => { totals[key] += sem[fields.metric[key]] || 0; });
        }
        records.forEach((record, course) => { record.effective = course[fields.effective] || 'none'; });
        return { available: true, major, entryTerm, req, fields, totals, records, isEligible };
    };

    const actualProgressGpa = (explicitCurrentTermCode) => calculateGpaForMembership(
        this.semesters,
        () => true,
        explicitCurrentTermCode,
        false,
    );

    const programGpaForSnapshot = (snapshot, explicitCurrentTermCode, includeEstimates) => {
        if (!snapshot || !snapshot.available || !(snapshot.records instanceof Map)) {
            return {
                value: NaN, credits: 0, points: 0, resolved: false, unresolved: true,
                issues: [{ code: 'PROGRAM_REQUIREMENTS_UNAVAILABLE', courseCode: '', grade: '' }],
                complete: false, missingCredits: 0, missingCourses: [],
                projected: includeEstimates === true, available: false,
            };
        }
        const result = calculateGpaForMembership(
            this.semesters,
            (course) => {
                const record = snapshot.records.get(course);
                return !!record && isProgramEffectiveType(record.effective);
            },
            explicitCurrentTermCode,
            includeEstimates === true,
        );
        return { ...result, available: true, program: snapshot.major };
    };

    const programMembershipSnapshot = (view, explicitCurrentTermCode) => {
        const programView = view === 'dm' ? 'dm' : 'main';
        const currentTerm = currentProgressTermCode(explicitCurrentTermCode);
        const stateOf = (course, sem) => courseProgressState(course, sem, currentTerm);
        return runProgressAllocation(
            programView,
            'program_gpa',
            (course) => courseCanHaveProgramGpaMembership(course),
            stateOf,
        );
    };

    // Public, allocation-independent access to the same actual-GPA policy used
    // by Summary and graduation progress. Keeping this separate prevents
    // compatibility callers from rebuilding GPA out of raw semester caches.
    this.getActualGpa = function(explicitCurrentTermCode) {
        return actualProgressGpa(explicitCurrentTermCode);
    };

    this.getEarnedSuCredits = function(explicitCurrentTermCode) {
        return calculateEarnedSuCredits(this.semesters, explicitCurrentTermCode);
    };

    this.getEstimatedClassLevel = function(explicitCurrentTermCode) {
        return estimatedClassLevelForEarnedCredits(
            this.getEarnedSuCredits(explicitCurrentTermCode),
        );
    };

    // Program GPA uses the program-specific effective allocation. Its private
    // membership pass can classify an F/letter-basis NA without awarding the
    // course any degree credit or changing the planner's visible allocation.
    this.getProgramGpa = function(view, explicitCurrentTermCode, includeEstimates) {
        const snapshot = programMembershipSnapshot(view, explicitCurrentTermCode);
        return programGpaForSnapshot(snapshot, explicitCurrentTermCode, includeEstimates === true);
    };

    this.calculateGpaForMembership = function(isMember, explicitCurrentTermCode, includeEstimates) {
        return calculateGpaForMembership(
            this.semesters,
            isMember,
            explicitCurrentTermCode,
            includeEstimates === true,
        );
    };

    this.isProgramGpaCandidate = function(course) {
        return courseCanHaveProgramGpaMembership(course);
    };

    const combinedProgressSnapshot = (view, programSnapshot, mainSnapshot) => {
        if (view !== 'dm') return { ...programSnapshot, genericRecords: programSnapshot.records,
            mainProgramRecords: programSnapshot.records };
        const mainTotals = mainSnapshot && mainSnapshot.totals ? mainSnapshot.totals : {};
        return {
            ...programSnapshot,
            totals: {
                ...programSnapshot.totals,
                total: mainTotals.total || 0,
                science: mainTotals.science || 0,
                engineering: mainTotals.engineering || 0,
                ects: mainTotals.ects || 0,
            },
            genericRecords: mainSnapshot && mainSnapshot.records ? mainSnapshot.records : new Map(),
            mainProgramRecords: mainSnapshot && mainSnapshot.records ? mainSnapshot.records : new Map(),
        };
    };

    const evaluateProgressAllocation = (view, snapshot, requireGpa, explicitCurrentTermCode, averages) => {
        if (!snapshot || !snapshot.available) return REQUIREMENTS_UNAVAILABLE_FLAG;
        const req = snapshot.req || {};
        const totals = snapshot.totals || {};
        const isDM = view === 'dm';
        const totalReq = (req.total || 0) + (isDM ? 30 : 0);
        const ectsReq = (req.ects || 0) + (isDM ? 60 : 0);
        if ((totals.university || 0) < (req.university || 0)) return 1;
        if (req.internshipCourse
            && !hasDegreeEligibleCourse(this.semesters, req.internshipCourse, snapshot.isEligible)) return 4;
        if ((totals.total || 0) < totalReq) return 5;
        if ((totals.science || 0) < (req.science || 0)) return 8;
        if ((totals.engineering || 0) < (req.engineering || 0)) return 9;
        if ((totals.ects || 0) < ectsReq) return 10;
        if ((totals.required || 0) < (req.required || 0)) return 2;
        if ((totals.core || 0) < (req.core || 0)) return 3;
        if ((totals.area || 0) < (req.area || 0)) return 6;
        if ((totals.free || 0) < (req.free || 0)) return 7;

        const averageSet = averages || {};
        const gpa = averageSet.cgpa || actualProgressGpa(explicitCurrentTermCode);
        const pgpa = averageSet.pgpa || { value: NaN, credits: 0, resolved: false };
        const mainPgpa = averageSet.mainPgpa || pgpa;
        const threshold = Number(averageSet.threshold) || (isDM ? 3.20 : 2.00);
        if (!gpa.resolved) return 38;
        if (requireGpa && !gpa.credits) return 38;
        if (gpa.credits && gpa.value < threshold) return 38;
        if (!pgpa.resolved) return 41;
        if (requireGpa && !pgpa.credits) return 41;
        if (pgpa.credits && pgpa.value < threshold) return 41;
        if (isDM) {
            if (!mainPgpa.resolved) return 41;
            if (requireGpa && !mainPgpa.credits) return 41;
            if (mainPgpa.credits && mainPgpa.value < threshold) return 41;
        }
        const ctx = { curr: this, semesters: this.semesters, fields: snapshot.fields,
            entryTerm: snapshot.entryTerm, isEligible: snapshot.isEligible };
        return evaluateRules(ctx, graduationRulesFor(snapshot.major, req));
    };

    this.getCourseProgressState = function(course, semester, explicitCurrentTermCode) {
        return courseProgressState(course, semester, explicitCurrentTermCode);
    };

    this.getGraduationProgress = function(view, explicitCurrentTermCode) {
        const programView = view === 'dm' ? 'dm' : 'main';
        const currentTerm = currentProgressTermCode(explicitCurrentTermCode);
        const stateOf = (course, sem) => courseProgressState(course, sem, currentTerm);
        const predicates = {
            earned: (course, sem) => stateOf(course, sem) === COURSE_PROGRESS_STATES.EARNED,
            current: (course, sem) => {
                const s = stateOf(course, sem);
                return s === COURSE_PROGRESS_STATES.EARNED || s === COURSE_PROGRESS_STATES.CURRENT;
            },
            future: (course, sem) => {
                const s = stateOf(course, sem);
                return s === COURSE_PROGRESS_STATES.EARNED || s === COURSE_PROGRESS_STATES.CURRENT
                    || s === COURSE_PROGRESS_STATES.FUTURE;
            },
            projected: (course, sem) => stateOf(course, sem) !== COURSE_PROGRESS_STATES.UNSUCCESSFUL,
            programGpa: (course) => courseCanHaveProgramGpaMembership(course),
        };
        const layers = {};
        const layerNames = ['earned', 'current', 'future', 'projected', 'programGpa'];
        for (let i = 0; i < layerNames.length; i++) {
            const layer = layerNames[i];
            const mainSnapshot = runProgressAllocation('main', layer, predicates[layer], stateOf);
            const programSnapshot = programView === 'dm'
                ? runProgressAllocation('dm', layer, predicates[layer], stateOf) : mainSnapshot;
            layers[layer] = combinedProgressSnapshot(programView, programSnapshot, mainSnapshot);
        }

        const metricKeys = ['total', 'ects', 'university', 'required', 'core', 'area', 'free', 'science', 'engineering'];
        const breakdown = {};
        for (let i = 0; i < metricKeys.length; i++) {
            breakdown[metricKeys[i]] = { earned: 0, current: 0, future: 0, unverified: 0, projected: 0 };
        }
        const semesterByCourse = new Map();
        for (let i = 0; i < this.semesters.length; i++) {
            const sem = this.semesters[i];
            (sem.courses || []).forEach((course) => { if (course) semesterByCourse.set(course, sem); });
        }
        const addBreakdown = (metric, course, amount) => {
            if (!breakdown[metric]) return;
            const state = stateOf(course, semesterByCourse.get(course));
            if (!Object.prototype.hasOwnProperty.call(breakdown[metric], state)) return;
            const n = Number(amount || 0);
            if (!isFinite(n) || n <= 0) return;
            breakdown[metric][state] += n;
        };

        // Attribute visible segments under the final projected allocation. The
        // earned and projected completion flags still come from their exact,
        // independent passes; attribution from one pass keeps every displayed
        // segment non-negative and guarantees that the equation adds up.
        layers.projected.records.forEach((record, course) => {
            const category = String(record.effective || '').toLowerCase();
            if (['university', 'required', 'core', 'area', 'free'].includes(category)) {
                addBreakdown(category, course, record.credit);
            }
        });
        layers.projected.genericRecords.forEach((record, course) => {
            if (!record.countsTotal) return;
            addBreakdown('total', course, record.credit);
            addBreakdown('ects', course, record.ects);
            addBreakdown('science', course, record.science);
            addBreakdown('engineering', course, record.engineering);
        });
        for (let i = 0; i < metricKeys.length; i++) {
            const b = breakdown[metricKeys[i]];
            b.projected = b.earned + b.current + b.future + b.unverified;
        }

        const cgpa = actualProgressGpa(currentTerm);
        const pgpa = programGpaForSnapshot(layers.programGpa, currentTerm, false);
        const projectedPgpa = programGpaForSnapshot(layers.programGpa, currentTerm, true);
        let mainPgpa = pgpa;
        let projectedMainPgpa = projectedPgpa;
        if (programView === 'dm') {
            const mainMembership = {
                ...layers.programGpa,
                major: this.major,
                records: layers.programGpa.mainProgramRecords || new Map(),
            };
            mainPgpa = programGpaForSnapshot(mainMembership, currentTerm, false);
            projectedMainPgpa = programGpaForSnapshot(mainMembership, currentTerm, true);
        }
        const averageThreshold = programView === 'dm'
            ? doubleMajorAverageThreshold(this.entryTerm) : 2.00;
        const averages = { cgpa, pgpa, mainPgpa, threshold: averageThreshold };
        const earnedFlag = evaluateProgressAllocation(
            programView, layers.earned, true, currentTerm, averages,
        );
        const projectedFlag = evaluateProgressAllocation(
            programView, layers.projected, false, currentTerm, averages,
        );
        const available = earnedFlag !== REQUIREMENTS_UNAVAILABLE_FLAG
            && projectedFlag !== REQUIREMENTS_UNAVAILABLE_FLAG;
        const status = !available ? 'unavailable'
            : (earnedFlag === 0 ? 'complete' : (projectedFlag === 0 ? 'projected' : 'incomplete'));
        const estimatedClassLevel = this.getEstimatedClassLevel(currentTerm);
        const earnedSuCredits = estimatedClassLevel.earnedCredits;
        const courseStates = [];
        for (let i = 0; i < this.semesters.length; i++) {
            const sem = this.semesters[i];
            const courses = sem.courses || [];
            for (let j = 0; j < courses.length; j++) {
                const course = courses[j];
                const record = layers.projected.records.get(course);
                const pgpaRecord = layers.programGpa.records.get(course);
                courseStates.push({ course, semester: sem, state: stateOf(course, sem),
                    effective: record ? record.effective : 'none',
                    pgpaEffective: pgpaRecord ? pgpaRecord.effective : 'none' });
            }
        }
        return { view: programView, status, available, earnedFlag, projectedFlag,
            breakdown, layers, courseStates, gpa: cgpa, cgpa, pgpa, projectedPgpa,
            mainPgpa, projectedMainPgpa, averageThreshold,
            earnedSuCredits, estimatedClassLevel,
            averageChecks: {
                cgpa: cgpa.resolved && cgpa.credits > 0 && cgpa.value >= averageThreshold,
                pgpa: pgpa.resolved && pgpa.credits > 0 && pgpa.value >= averageThreshold,
                mainPgpa: mainPgpa.resolved && mainPgpa.credits > 0
                    && mainPgpa.value >= averageThreshold,
            },
            currentTerm };
    };

    this.canGraduateEarned = function() {
        return this.getGraduationProgress('main').earnedFlag;
    };

    this.canGraduateDoubleEarned = function() {
        return this.getGraduationProgress('dm').earnedFlag;
    };

    this.getSemester = function(id)
    {
        for(let i = 0; i < this.semesters.length; i++)
        {
            if(this.semesters[i].id == id)
            {
                return this.semesters[i];
            }
        }
        try {
            console.warn('Semester not found:', id);
        } catch (_) {}
        return null;
    };
    this.deleteSemester = function(id)
    {
        let removed = false;
        for(let i = 0; i < this.semesters.length; i++)
        {
            if(this.semesters[i].id == id)
            {
                this.semesters.splice(i,1);
                removed = true;
                break;
            }
        }
        if (removed) {
            try {
                const storage = (typeof window !== 'undefined') ? window.planStorage : null;
                if (storage && typeof storage.requestSave === 'function') storage.requestSave();
            } catch (_) {}
        }
    }
    this.print = function()
    {
        for(let i = 0; i < this.semesters.length; i++)
        {
            for(let a = 0; a < this.semesters[i].courses.length; a++)
            {
                console.log(this.semesters[i].courses[a].code)
            }
        }
    }
    this.hasCourse = function(course)
    {
        // Structural presence intentionally remains separate from degree-plan
        // eligibility. The planner uses this method for duplicate prevention.
        const target = canonicalCourseCode(course);
        for(let i = 0; i < this.semesters.length; i++)
        {
            for(let a = 0; a < this.semesters[i].courses.length; a++)
            {
                if(canonicalCourseCode(this.semesters[i].courses[a].code) === target)
                {return true;}
            }
        }
        return false;
    }
    // Tally the student's FACULTY COURSES by pool. `Faculty_Course` is the
    // faculty-course pool marker (only ~10% of courses carry one) — NOT the
    // offering faculty, which is `Faculty`. Conflating the two caused the MAN
    // and DSA bugs, so the distinction is deliberate here.
    //
    // Courses excluded from every pool (effective_type 'none' — a failed course,
    // or a math alternative SUIS drops) count toward nothing, including this.
    //
    // New code should use this rather than hand-rolling the loop: the same tally
    // is currently written out 22 times across the major blocks, and the copies
    // have already drifted (CS skips excluded courses; BIO does not).
    // Thin wrappers over the shared module-level tallies. `fields` selects the
    // pass (MAIN_FIELDS / DM_FIELDS); default is the main major.
    this.countFacultyCourses = function(fields) {
        return tallyFacultyCourses(this.semesters, fields && fields.effective);
    }
    this.countFacultyAreas = function(fields) {
        return tallyFacultyAreas(this.semesters, fields && fields.effective);
    }
    // True when ANY of `codes` is present. For "one of the following" rules.
    this.hasAnyCourse = function(codes) {
        for (let i = 0; i < codes.length; i++) {
            if (this.hasCourse(codes[i])) return true;
        }
        return false;
    }
    // Degree-plan eligibility is grade-based and shared by allocation,
    // graduation, double-major, minor and summary calculations. A failed
    // attempt can therefore remain visible/present without satisfying a rule.
    this.isDegreeEligibleCourse = function(course) {
        return isDegreeEligibleCourse(course);
    }
    this.hasDegreeEligibleCourse = function(code) {
        return hasDegreeEligibleCourse(this.semesters, code);
    }
    this.hasAnyDegreeEligibleCourse = function(codes) {
        return hasAnyDegreeEligibleCourse(this.semesters, codes);
    }

    // Per-requirement-group progress for the Summary panel (Phase 4). Returns an
    // ordered list of progress rows for the given pass ('dm' → double major, else
    // the main major) — the same groups graduationRulesFor evaluates, measured as
    // current/target so the UI can show "Core I: 6/9 SU". Empty for programs with
    // no requirement-groups data. Reads the effective types the allocation set, so
    // call it after recalcEffectiveTypes(Double).
    this.requirementGroupProgress = function(view, mode) {
        const isDM = view === 'dm';
        const major = isDM ? this.doubleMajor : this.major;
        if (!major) return [];
        const term = isDM ? this.entryTermDM : this.entryTerm;
        const req = getReq(major, term) || {};
        if (!requirementRecordIsValid(major, req)) return [];
        let fields = isDM ? DM_FIELDS : MAIN_FIELDS;
        let isEligible;
        if (mode === 'earned' || mode === 'projected') {
            const progress = this.getGraduationProgress(isDM ? 'dm' : 'main');
            const snapshot = progress.layers[mode];
            if (!snapshot || !snapshot.available) return [];
            fields = snapshot.fields;
            isEligible = snapshot.isEligible;
        }
        const ctx = { curr: this, semesters: this.semesters, fields, entryTerm: term, isEligible };
        if (req.groups) return groupProgressFor(ctx, req.groups, req.facultyReq);
        if (req.facultyReq) return facultyProgress(ctx, req.facultyReq);
        return [];
    };

    this.canGraduate = function()
    {
        const req = getReq(this.major, this.entryTerm);
        if (!requirementRecordIsValid(this.major, req)) return REQUIREMENTS_UNAVAILABLE_FLAG;

        let area = 0;
        let core = 0;
        let free = 0;
        let university = 0;
        let required = 0;
        let total = 0;
        let science = 0;
        let engineering = 0;
        let ects = 0;

        for(let i = 0; i < this.semesters.length; i++)
        {
            total = total + this.semesters[i].totalCredit;
            area = area + this.semesters[i].totalArea;
            core = core + this.semesters[i].totalCore;
            free = free + this.semesters[i].totalFree;
            university = university + this.semesters[i].totalUniversity;
            required = required + this.semesters[i].totalRequired;
            science += this.semesters[i].totalScience;
            engineering += this.semesters[i].totalEngineering;
            ects += this.semesters[i].totalECTS;
        }
        // Generic requirement checks
        if (university < req.university) return 1;
        if (req.internshipCourse && !this.hasDegreeEligibleCourse(req.internshipCourse)) return 4;
        if (total < req.total) return 5;
        if (science < req.science) return 8;
        if (engineering < req.engineering) return 9;
        if (ects < req.ects) return 10;
        if (required < req.required) return 2;
        // Check core, area and free credits against requirements directly.
        // Do not perform dynamic reallocation here because the effective
        // categories have already been computed via recalcEffectiveTypes().
        // Flag codes must align with flagMessages.js:
        // 3=core, 6=area, 7=free, 8=science.
        if (core < req.core) return 3;
        if (area < req.area) return 6;
        if (free < req.free) return 7;
        // GPA check for graduation
        const gpaThresholdMainMajor = 2.00;
        const gpa = this.getActualGpa();
        if (!gpa.resolved || (gpa.credits && gpa.value < gpaThresholdMainMajor)) return 38;
        const pgpa = this.getProgramGpa('main');
        if (!pgpa.resolved || (pgpa.credits && pgpa.value < gpaThresholdMainMajor)) return 41;
        // SPS 303, the HUM requirement and the per-major requirements are DATA
        // -- see PROGRAM_RULES -- evaluated in order, first unmet wins. The same
        // table drives the double-major pass (canGraduateDouble) via DM_FIELDS.
        const ctx = { curr: this, semesters: this.semesters, fields: MAIN_FIELDS, entryTerm: this.entryTerm };
        return evaluateRules(ctx, graduationRulesFor(this.major, req));
    }

    /**
     * Recalculate the effective category (core/area/free) for every course
     * across all semesters based on chronological order. The `terms` array
     * lists the most recent term first, so larger `termIndex` values represent
     * earlier semesters. This method therefore sorts semesters in descending
     * order of `termIndex` and then
     * allocates course credits to required, core, area and free categories
     * according to the major requirements. If the required requirement is
     * filled, additional required courses count toward the core requirement.
     * If the core requirement is then satisfied, overflow continues to the
     * area requirement and finally to free electives. Courses with static
     * type "university" are not reallocated. After reallocation, the semester
     * totals for required, core, area and free are updated accordingly and
     * each course's `.effective_type` field is set. The displayed course type
     * in the DOM (the `.course_type` element) is also updated to reflect the
     * effective category.
     *
     * @param {Array} course_data The full course data array for the current major.
     */
    this.recalcEffectiveTypes = function (course_data) {
        this.primaryCourseData = Array.isArray(course_data) ? course_data : [];
        // Determine requirement thresholds for this major. If a requirement is
        // undefined (e.g., for non-engineering majors without a science
        // requirement), default to 0 so no credits are allocated to that
        // category.
        const req = getReq(this.major, this.entryTerm);
        if (!requirementRecordIsValid(this.major, req)) return;
        const reqCore = req.core || 0;
        const reqArea = req.area || 0;
        const reqRequired = req.required || 0;

        // Before performing any lookups, attempt to find the `getInfo` helper
        // function. In a browser environment `getInfo` is declared in
        // helper_functions.js and becomes a property of the global `window`.
        // In the unlikely event that it cannot be found, we skip
        // reallocation since course information will be unavailable.
        const getInfoFn = (typeof getInfo === 'function') ? getInfo :
            ((typeof window !== 'undefined' && typeof window.getInfo === 'function') ? window.getInfo : null);
        if (!getInfoFn) {
            return;
        }


        // First reset totals for each semester. We will accumulate fresh values
        // below. Note: totalCredit is recomputed to avoid stale values.
        for (let i = 0; i < this.semesters.length; i++) {
            const sem = this.semesters[i];
            sem.totalCredit = 0;
            sem.totalArea = 0;
            sem.totalCore = 0;
            sem.totalFree = 0;
            sem.totalUniversity = 0;
            sem.totalRequired = 0;
            sem.totalScience = 0.0;
            sem.totalEngineering = 0.0;
            sem.totalECTS = 0.0;
            // We leave totalGPA and totalGPACredits untouched because they
            // depend on the user's recorded grades rather than the static type.
        }

        // Sort a copy of semesters chronologically based on the stored
        // `termIndex` property. The `terms` array is ordered most-recent
        // first, so larger indices represent earlier (older) semesters.
        // If `termIndex` is null/undefined (e.g., a semester without a valid
        // date), treat it as very small so it will be allocated last.
        const sortedSemesters = this.semesters.slice().sort((a, b) => {
            const idxA = (a.termIndex !== null && a.termIndex !== undefined) ? a.termIndex : -1;
            const idxB = (b.termIndex !== null && b.termIndex !== undefined) ? b.termIndex : -1;
            return idxB - idxA; // larger index = earlier term
        });

        // Running credit counters and their thresholds for the allocation
        // cascade (allocateCascade): once a pool is full its surplus spills to
        // the next. `counters` is mutated in place as courses are placed.
        const counters = { required: 0, core: 0, area: 0 };
        const reqs = { required: reqRequired, core: reqCore, area: reqArea };
        // Special-case: for IE majors, if both DSA201 and CS201 are taken,
        // CS201 must always count towards core regardless of when it is
        // taken. Record the condition once so it can be applied inside the
        // allocation loop without repeated lookups.
        const forceCSCore = (
            this.major === 'IE' &&
            this.hasDegreeEligibleCourse('CS201') &&
            this.hasDegreeEligibleCourse('DSA201')
        );

        // Alternative-course rules, resolved BEFORE the allocation cascade below
        // (see resolveAlternativeRules / collectAltPairExtras for why they cannot
        // run afterwards). Shared with the double-major pass.
        const { excluded: excludedFromDegree, typeOverride, forceCore } = resolveAlternativeRules(
            this.major, this.entryTerm, sortedSemesters, this.semesters,
            getInfoFn, course_data, (c) => this.hasDegreeEligibleCourse(c), req.groups,
            (course) => this.isDegreeEligibleCourse(course),
        );

        // Iterate semesters in chronological order
        for (let i = 0; i < sortedSemesters.length; i++) {
            const sem = sortedSemesters[i];
            // Iterate courses in the order they appear within the semester.
            for (let j = 0; j < sem.courses.length; j++) {
                const course = sem.courses[j];
                // Failed/unsuccessful attempts remain in the plan but do not
                // take credits, categories, pair positions or requirement slots.
                if (!this.isDegreeEligibleCourse(course)) {
                    course.effective_type = 'none';
                    delete course.category;
                    continue;
                }
                // Excluded alternative (SUIS rule): counts toward no pool, and
                // toward no credit total either — hence the `continue` before
                // any of the totals below are touched.
                if (excludedFromDegree.has(course)) {
                    course.effective_type = 'none';
                    continue;
                }
                // Attempt to find course information in the primary major's
                // course_data.  We do this search ourselves rather than
                // relying on getInfo() because getInfo has been extended to
                // return details from the double major's catalog as well. If
                // the course is not found in the primary dataset, we treat
                // it as unknown for the main major (excluded from core/area
                // allocations) even if getInfo returns a valid object from
                // the double major.
                let infoMain = null;
                for (let ii = 0; ii < course_data.length; ii++) {
                    if ((course_data[ii]['Major'] + course_data[ii]['Code']) === course.code) {
                        infoMain = course_data[ii];
                        break;
                    }
                }
                // If the course was not found in the provided course_data, it
                // may be a custom course stored in localStorage.  Attempt to
                // retrieve the custom course list for the current major and
                // search for the matching code.
                if (!infoMain) {
                    try {
                        if (typeof localStorage !== 'undefined') {
                            const key = 'customCourses_' + this.major;
                            const ps = (typeof window !== 'undefined') ? window.planStorage : null;
                            const planId = (ps && typeof ps.getSessionPlanId === 'function')
                                ? ps.getSessionPlanId() : null;
                            const get = (k) => {
                                if (ps && typeof ps.getItem === 'function') {
                                    if (!planId) return null;
                                    try { return ps.getItem(k, planId); } catch (_) { return null; }
                                }
                                try { return localStorage.getItem(k); } catch (_) {}
                                return null;
                            };
                            const stored = get(key);
                            if (stored) {
                                const parsed = JSON.parse(stored);
                                if (Array.isArray(parsed)) {
                                    for (let ci = 0; ci < parsed.length; ci++) {
                                        const cc = parsed[ci];
                                        if ((cc['Major'] + cc['Code']) === course.code) {
                                            infoMain = cc;
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                    } catch (_) {}
                }
                let credit, scienceVal, engVal, ectsVal, staticType;
                if (!infoMain) {
                    // Course does not exist in the main major's catalog.  Use
                    // properties from the course object (if set) or fall
                    // back to the double major's catalog to derive credit
                    // information.  These courses count towards total
                    // credits, science, engineering and ECTS but are not
                    // allocated to core/area/free categories for the main
                    // major.
                    // Attempt to find the course in the double major's
                    // catalog to obtain SU_credit, Basic_Science, etc.
                    let dmInfo = null;
                    try {
                        if (this.doubleMajor && Array.isArray(this.doubleMajorCourseData)) {
                            for (let di = 0; di < this.doubleMajorCourseData.length; di++) {
                                const dm = this.doubleMajorCourseData[di];
                                if ((dm['Major'] + dm['Code']) === course.code) {
                                    dmInfo = dm;
                                    break;
                                }
                            }
                        }
                    } catch (_) {}
                    // Determine credit values from dmInfo or course object
                    credit = 0;
                    scienceVal = 0;
                    engVal = 0;
                    ectsVal = 0;
                    if (dmInfo) {
                        credit = (typeof parseCreditValue === 'function')
                            ? parseCreditValue(dmInfo['SU_credit'] || '0')
                            : (parseFloat(dmInfo['SU_credit'] || '0') || 0);
                        scienceVal = parseFloat(dmInfo['Basic_Science'] || '0');
                        engVal = parseFloat(dmInfo['Engineering'] || '0');
                        ectsVal = parseFloat(dmInfo['ECTS'] || '0');
                    } else {
                        credit = (typeof parseCreditValue === 'function')
                            ? parseCreditValue(course.SU_credit || course.SU_credit || '0')
                            : (parseFloat(course.SU_credit || course.SU_credit || '0') || 0);
                        scienceVal = parseFloat(course.Basic_Science || '0');
                        engVal = parseFloat(course.Engineering || '0');
                        ectsVal = parseFloat(course.ECTS || '0');
                    }
                    sem.totalCredit += credit;
                    sem.totalScience += scienceVal;
                    sem.totalEngineering += engVal;
                    sem.totalECTS += ectsVal;
                    course.effective_type = 'none';
                    // Populate course attributes for unknown courses from dmInfo or course
                    // This ensures faculty and science/engineering credits persist
                    course.Basic_Science = scienceVal;
                    course.Engineering = engVal;
                    course.SU_credit = credit;
                    course.ECTS = ectsVal;
                    course.Faculty_Course = (dmInfo && dmInfo['Faculty_Course']) ? dmInfo['Faculty_Course'] : (course.Faculty_Course || 'No');
                    course.Faculty = (dmInfo && dmInfo['Faculty']) ? dmInfo['Faculty'] : (course.Faculty || '');
                    continue;
                }
                // Use information from the main major catalog
                staticType = (infoMain['EL_Type'] || '').toLowerCase();
                // ME 2025+ alternative pairs: the extra course of a pair counts
                // toward Core Elective rather than occupying a required slot.
                if (typeOverride.has(course)) staticType = typeOverride.get(course);
                // SUIS: a course the catalog types `unknown` is "not included in
                // any course pool" for this program, so it counts toward NOTHING
                // — not a pool and not the independent degree total. A gap
                // between category minimums and Total does not make an expressly
                // excluded course eligible. The `continue` runs before any total
                // is touched.
                //
                // The catalog uses this consistently and only where SUIS says
                // so: MATH201/MATH202 for the 2025+ engineering admits ("not
                // included in any course pool"), and NS213/NS214 — physics for
                // scientists and engineers — for the non-engineering majors.
                if (staticType === 'unknown') {
                    course.effective_type = 'none';
                    continue;
                }
                credit = (typeof parseCreditValue === 'function')
                    ? parseCreditValue(infoMain['SU_credit'] || '0')
                    : (parseFloat(infoMain['SU_credit'] || '0') || 0);
                scienceVal = parseFloat(infoMain['Basic_Science'] || '0');
                engVal = parseFloat(infoMain['Engineering'] || '0');
                ectsVal = parseFloat(infoMain['ECTS'] || '0');

                // Populate course attributes from main catalog.  Assign
                // these fields directly so that faculty course counts
                // and science/engineering credits persist across reloads.
                course.Basic_Science = scienceVal;
                course.Engineering = engVal;
                course.SU_credit = credit;
                course.ECTS = ectsVal;
                course.Faculty_Course = infoMain['Faculty_Course'] || 'No';
                // The OFFERING faculty (FASS/FENS/SBS/SL) — distinct from
                // Faculty_Course above, which marks membership of the faculty-
                // course pool. Rules worded "offered by X" need this one.
                course.Faculty = infoMain['Faculty'] || '';

                // Update generic totals (credits, science, engineering, ECTS)
                sem.totalCredit += credit;
                sem.totalScience += scienceVal;
                sem.totalEngineering += engVal;
                sem.totalECTS += ectsVal;

                // Assign category to the course for major-specific checks.  Use
                // capitalized form (e.g., "Core", "Area", etc.).  This
                // property is consumed by checks such as EE 400-level core
                // requirements in canGraduate() and canGraduateDouble().
                if (staticType) {
                    course.category = staticType.charAt(0).toUpperCase() + staticType.slice(1);
                }

                // The allocation cascade (shared with the double-major pass).
                const pinCore = forceCore.has(course)
                    || (forceCSCore && course.code === 'CS201');
                const effectiveType = allocateCascade(staticType, credit, counters, reqs, pinCore);
                // Persist the effective type on the course object
                course.effective_type = effectiveType;

                // Update semester category totals based on the effective type.
                if (effectiveType === 'core') {
                    sem.totalCore += credit;
                } else if (effectiveType === 'area') {
                    sem.totalArea += credit;
                } else if (effectiveType === 'free') {
                    sem.totalFree += credit;
                } else if (effectiveType === 'university') {
                    sem.totalUniversity += credit;
                } else if (effectiveType === 'required') {
                    sem.totalRequired += credit;
                }
                // The DOM label for this course is written by renderAllocationLabels
                // after allocation, from course.effective_type — not here.
            }
        }

        // (CS math-alternative exclusions are handled BEFORE the allocation
        // cascade above via `excludedFromDegree`, so the kept course fills `required`.)

        // (ME 2025+ alternative pairs — ME403/ME425 and CS404/CS412 — are
        // handled BEFORE the allocation cascade above via `typeOverride`, so the
        // kept course fills `required` and the extra is allocated as a core
        // elective.)

        // (Core-Elective pools — VACD's two, PSIR's two — are resolved BEFORE the
        // allocation cascade above via selectCorePools() from the scraped `credits`
        // groups: courses filling a pool's minimum are pinned to core, extras take
        // the pool's `overflowTo` and spill on through the normal cascade. Doing it
        // afterwards demoted an extra out of core once the cascade had already
        // capped core and pushed the surplus down, and nothing refilled the freed
        // slot. The cascade then handles allocation, totals and DOM labels
        // uniformly.)

        // Special-case MAN: core/area electives have additional "at least one
        // from each area" constraints, and extra core electives can be counted
        // as area electives. The generic credit-threshold allocator may place
        // a required area-prefix core elective into area/free, causing the
        // MAN-specific checks to fail even though a feasible assignment exists.
        //
        // Normalize MAN elective effective types after the generic pass by
        // selecting a subset of static core electives to count as core that
        // covers all required prefixes, and pushing duplicates/overflow into
        // area/free to satisfy area elective rules.
        if (this.major === 'MAN') {
            applyManDiversity(sortedSemesters, this.semesters, MAIN_FIELDS, reqCore, reqArea);

        }

        // Recalculate the double major's effective types too, if active, so its
        // categories stay in sync whenever the primary allocation runs. That pass
        // renders the (dual) labels itself; a single major renders here. Rendering
        // is a separate pass over the model — see renderAllocationLabels.
        let renderedByDouble = false;
        try {
            if (this.doubleMajor && Array.isArray(this.doubleMajorCourseData)) {
                this.recalcEffectiveTypesDouble(this.doubleMajorCourseData);
                renderedByDouble = true;
            }
        } catch (ex) {
            // ignore errors if DM recalc fails
        }
        if (!renderedByDouble) renderAllocationLabels(this);

        // After DM recalculation, update the course selection datalist to
        // include any DM-only courses.  This requires a global helper
        // exposed on window.  We wrap in try to avoid errors when the
        // helper is not defined.
        try {
            if (typeof window !== 'undefined' && typeof window.updateDatalistForDoubleMajor === 'function') {
                window.updateDatalistForDoubleMajor();
            }
        } catch (_) {}
        // Planner prerequisite/corequisite notices are advisory DOM only. Queue
        // them after every model allocation refresh so add/delete, grades, term
        // edits, imports, and semester moves all converge on one update path.
        try {
            const requisites = (typeof window !== 'undefined') ? window.courseRequisites : null;
            if (requisites && typeof requisites.queuePlannerWarningRefresh === 'function') {
                requisites.queuePlannerWarningRefresh();
            }
        } catch (_) {}
    };

    /**
     * Recalculate the effective category for every course across all
     * semesters for the selected double major. This mirrors
     * recalcEffectiveTypes() but uses the second major's requirements and
     * its own course catalog (provided via course_data_dm) to determine
     * whether a course counts toward required, core, area, or free credits.
     * Surplus required courses spill over to core, then area, then free.
     * The results are stored on each course object under the
     * `.effective_type_dm` property, and per-semester totals are kept in
     * `sem.totalCoreDM`, `sem.totalAreaDM`, `sem.totalFreeDM` and
     * `sem.totalRequiredDM`.
     *
     * If no double major is selected (this.doubleMajor is falsy), the
     * function returns immediately without making changes.
     *
     * @param {Array} course_data_dm The course catalog for the double major
     */
    this.recalcEffectiveTypesDouble = function(course_data_dm) {
        if (!this.doubleMajor) return;
        this.doubleMajorCourseData = Array.isArray(course_data_dm) ? course_data_dm : [];
        // Determine requirement thresholds for the double major. Required,
        // core and area requirements are drawn from the second major's
        // requirements.
        const dmReq = getReq(this.doubleMajor, this.entryTermDM);
        if (!requirementRecordIsValid(this.doubleMajor, dmReq)) return;
        const dmCoreReq = dmReq.core || 0;
        const dmAreaReq = dmReq.area || 0;
        const dmReqRequired = dmReq.required || 0;
        // Acquire the getInfo helper.  If unavailable, skip processing.
        const getInfoFnDM = (typeof getInfo === 'function') ? getInfo :
            ((typeof window !== 'undefined' && typeof window.getInfo === 'function') ? window.getInfo : null);
        if (!getInfoFnDM) return;
        // Running credit counters and thresholds for the allocation cascade
        // (allocateCascade), the double-major counterpart of the main pass.
        const dmCounters = { required: 0, core: 0, area: 0 };
        const dmReqs = { required: dmReqRequired, core: dmCoreReq, area: dmAreaReq };
        // For IE as a double major, ensure CS201 always counts as core when
        // both CS201 and DSA201 are present. Capture the condition once here
        // so the allocation loop can enforce it deterministically regardless
        // of course order.
        const dmForceCSCore = (
            this.doubleMajor === 'IE' &&
            this.hasDegreeEligibleCourse('CS201') &&
            this.hasDegreeEligibleCourse('DSA201')
        );
        // Reset per-semester DM totals.  In addition to core/area/free, we
        // maintain separate totals for required and university courses for
        // the double major so that summary and graduation checks can
        // correctly count these categories even when the course does not
        // exist in the primary major.  We also initialize DM science,
        // engineering and ECTS totals although those are currently reused
        // from the primary allocation.
        for (let i = 0; i < this.semesters.length; i++) {
            const sem = this.semesters[i];
            sem.totalCoreDM = 0;
            sem.totalAreaDM = 0;
            sem.totalFreeDM = 0;
            // Required and university totals for DM
            sem.totalRequiredDM = 0;
            sem.totalUniversityDM = 0;
            // Science/engineering/ECTS DM totals can be derived from main totals,
            // but initialize them here in case future logic requires separate
            // tracking.
            sem.totalScienceDM = 0;
            sem.totalEngineeringDM = 0;
            sem.totalECTSDM = 0;
        }
        // Sort semesters chronologically by termIndex (larger index = earlier).
        // If a semester has no valid termIndex, allocate it last.
        const sorted = this.semesters.slice().sort((a, b) => {
            const aIdx = (a.termIndex !== null && a.termIndex !== undefined) ? a.termIndex : -1;
            const bIdx = (b.termIndex !== null && b.termIndex !== undefined) ? b.termIndex : -1;
            return bIdx - aIdx;
        });

        // Alternative-course rules for the double major, resolved BEFORE the
        // allocation loop below — the same shared helper as the main-major pass,
        // read off the DOUBLE major's code, entry term and catalog.
        const { excluded: excludedFromDegreeDM, typeOverride: typeOverrideDM, forceCore: forceCoreDM } =
            resolveAlternativeRules(
                this.doubleMajor, this.entryTermDM, sorted, this.semesters,
                getInfoFnDM, course_data_dm, (c) => this.hasDegreeEligibleCourse(c), dmReq.groups,
                (course) => this.isDegreeEligibleCourse(course),
            );

        // Walk semesters and courses allocating DM categories
        for (let i = 0; i < sorted.length; i++) {
            const sem = sorted[i];
            for (let j = 0; j < sem.courses.length; j++) {
                const course = sem.courses[j];
                if (!this.isDegreeEligibleCourse(course)) {
                    course.effective_type_dm = 'none';
                    delete course.categoryDM;
                    continue;
                }
                // Excluded alternative (SUIS rule): counts toward no DM pool.
                if (excludedFromDegreeDM.has(course)) {
                    course.effective_type_dm = 'none';
                    continue;
                }
                let info = getInfoFnDM(course.code, course_data_dm);
                // If the course is not present in the fetched double major
                // catalog, check localStorage for a custom course definition
                // under `customCourses_<doubleMajor>`.
                if (!info) {
                    try {
                        if (typeof localStorage !== 'undefined') {
                            const keyDM = 'customCourses_' + this.doubleMajor;
                            const ps = (typeof window !== 'undefined') ? window.planStorage : null;
                            const planId = (ps && typeof ps.getSessionPlanId === 'function')
                                ? ps.getSessionPlanId() : null;
                            const get = (k) => {
                                if (ps && typeof ps.getItem === 'function') {
                                    if (!planId) return null;
                                    try { return ps.getItem(k, planId); } catch (_) { return null; }
                                }
                                try { return localStorage.getItem(k); } catch (_) {}
                                return null;
                            };
                            const storedDM = get(keyDM);
                            if (storedDM) {
                                const parsedDM = JSON.parse(storedDM);
                                if (Array.isArray(parsedDM)) {
                                    for (let ci = 0; ci < parsedDM.length; ci++) {
                                        const cc = parsedDM[ci];
                                        if ((cc['Major'] + cc['Code']) === course.code) {
                                            info = cc;
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                    } catch (_) {}
                }
                let dmType = 'free';
                let credit = 0;
                let dmStaticType = '';
                // Clear previously cached DM category before recalculating.
                delete course.categoryDM;
                if (info) {
                    dmStaticType = (info['EL_Type'] || '').toLowerCase();
                    // Alternative pairs: the extra course of a pair counts
                    // toward an elective pool rather than a required slot.
                    if (typeOverrideDM.has(course)) dmStaticType = typeOverrideDM.get(course);
                    // SUIS: `unknown` means "not included in any course pool" for
                    // this program — see the main-major pass for the full note.
                    if (dmStaticType === 'unknown') {
                        course.effective_type_dm = 'none';
                        delete course.categoryDM;
                        continue;
                    }
                    if (dmStaticType) {
                        course.categoryDM = dmStaticType.charAt(0).toUpperCase() + dmStaticType.slice(1);
                    }
                    credit = (typeof parseCreditValue === 'function')
                        ? parseCreditValue(info['SU_credit'] || '0')
                        : (parseFloat(info['SU_credit'] || '0') || 0);
                    // The allocation cascade (shared with the main-major pass).
                    const dmPinCore = forceCoreDM.has(course)
                        || (dmForceCSCore && course.code === 'CS201');
                    dmType = allocateCascade(dmStaticType, credit, dmCounters, dmReqs, dmPinCore);
                } else {
                    // Unknown course in the double major catalog: do not
                    // allocate it to any DM category. Still count its credit
                    // values for science/engineering/ECTS tracking.
                    credit = (typeof parseCreditValue === 'function')
                        ? parseCreditValue(course.SU_credit || course.SU_credit || '0')
                        : (parseFloat(course.SU_credit || course.SU_credit || '0') || 0);
                    dmType = 'none';
                    dmStaticType = 'none';
                    delete course.categoryDM;
                }
                // Assign DM effective type
                course.effective_type_dm = dmType;
                // Accumulate per-semester DM totals.  Include required
                // and university categories.
                if (dmType === 'core') {
                    sem.totalCoreDM += credit;
                } else if (dmType === 'area') {
                    sem.totalAreaDM += credit;
                } else if (dmType === 'free') {
                    sem.totalFreeDM += credit;
                } else if (dmType === 'required') {
                    sem.totalRequiredDM += credit;
                } else if (dmType === 'university') {
                    sem.totalUniversityDM += credit;
                }
                // Science/engineering/ECTS totals for DM reuse the same values
                // as the main major because they are inherent course
                // attributes.  Accumulate them so that DM summary can
                // optionally display separate DM science/engineering/ECTS.
                if (info) {
                    sem.totalScienceDM += parseFloat(info['Basic_Science'] || '0');
                    sem.totalEngineeringDM += parseFloat(info['Engineering'] || '0');
                    sem.totalECTSDM += parseFloat(info['ECTS'] || '0');
                } else {
                    sem.totalScienceDM += parseFloat(course.Basic_Science || '0');
                    sem.totalEngineeringDM += parseFloat(course.Engineering || '0');
                    sem.totalECTSDM += parseFloat(course.ECTS || '0');
                }
            }
        }

        // Special-case MAN double major: normalize core/area elective effective
        // types to satisfy the per-area constraints while still allowing extra
        // core electives to count as area electives.
        if (this.doubleMajor === 'MAN') {
            applyManDiversity(sorted, this.semesters, DM_FIELDS, dmCoreReq, dmAreaReq);
        }

        // (CS double-major math exclusions are handled BEFORE the allocation
        // loop above via `excludedFromDegreeDM`, so the kept course fills `required`.)

        // (ME double-major alternative pairs — ME403/ME425 and CS404/CS412 —
        // are handled BEFORE the allocation loop above via `typeOverrideDM`.
        // The old code here handled only CS404/CS412, and did so after the
        // cascade, which left `required` short.)

        // VACD double major: its core pools and required pairs are now resolved
        // BEFORE the allocation cascade above (see the pre-cascade block), exactly
        // like the main-major pass. The old post-cascade block that lived here
        // stranded non-pool core courses in a pool-first order (bug #21); removed.
        // Render the (dual main/DM) labels + total credits from the model.
        renderAllocationLabels(this);
    };

    /**
     * Determine if the student can graduate from the selected double major.
     * This function mirrors canGraduate() but applies the double major
     * thresholds (SU credits +30, ECTS +60) and uses the double major
     * effective category totals (CoreDM, AreaDM, FreeDM) for core/area/free
     * checks. Major-specific logic is preserved to ensure that special
     * requirements (e.g., internships, faculty course counts) remain in
     * effect for the double major.
     *
     * Returns 0 if the student can graduate; otherwise returns a code
     * corresponding to the missing requirement. Codes align with those in
     * canGraduate().
     */
    this.canGraduateDouble = function() {
        if (!this.doubleMajor) return 0;
        const req = getReq(this.doubleMajor, this.entryTermDM);
        if (!requirementRecordIsValid(this.doubleMajor, req)) return REQUIREMENTS_UNAVAILABLE_FLAG;

        // Accumulate totals for the double major
        let area = 0;
        let core = 0;
        let free = 0;
        let university = 0;
        let required = 0;
        let total = 0;
        let science = 0;
        let engineering = 0;
        let ects = 0;
        for (let i = 0; i < this.semesters.length; i++) {
            const sem = this.semesters[i];
            total += sem.totalCredit;
            area += (sem.totalAreaDM || 0);
            core += (sem.totalCoreDM || 0);
            free += (sem.totalFreeDM || 0);
            // Use DM-specific university/required totals if available, otherwise
            // fall back to the primary totals.  This ensures courses that are
            // classified as university or required in the second major are
            // properly counted even when absent in the primary major.
            university += (sem.totalUniversityDM !== undefined ? sem.totalUniversityDM : sem.totalUniversity);
            required += (sem.totalRequiredDM !== undefined ? sem.totalRequiredDM : sem.totalRequired);
            science += sem.totalScience;
            engineering += sem.totalEngineering;
            ects += sem.totalECTS;
        }
        // Fetch requirements for double major and adjust SU/ECTS thresholds
        const totalReq = (req.total || 0) + 30;
        const ectsReq = (req.ects || 0) + 60;
        // Generic checks
        if (university < (req.university || 0)) return 1;
        if (req.internshipCourse && !this.hasDegreeEligibleCourse(req.internshipCourse)) return 4;
        if (total < totalReq) return 5;
        if (science < (req.science || 0)) return 8;
        if (engineering < (req.engineering || 0)) return 9;
        if (ects < ectsReq) return 10;
        if (required < (req.required || 0)) return 2;
        // Core/area/free requirements. Flag codes mirror flagMessages.js
        // where 3=core, 6=area, 7=free and 8=science.
        if (core < (req.core || 0)) return 3;
        if (area < (req.area || 0)) return 6;
        if (free < (req.free || 0)) return 7;
        // GPA check for graduation
        const gpaThresholdDoubleMajor = doubleMajorAverageThreshold(this.entryTerm);
        const gpa = this.getActualGpa();
        if (!gpa.resolved || (gpa.credits && gpa.value < gpaThresholdDoubleMajor)) return 38;
        const mainPgpa = this.getProgramGpa('main');
        const dmPgpa = this.getProgramGpa('dm');
        if (!mainPgpa.resolved || !dmPgpa.resolved
            || (mainPgpa.credits && mainPgpa.value < gpaThresholdDoubleMajor)
            || (dmPgpa.credits && dmPgpa.value < gpaThresholdDoubleMajor)) return 41;
        // Per-major requirements are the SAME data the main pass uses (see
        // PROGRAM_RULES), evaluated here against the double-major allocation via
        // DM_FIELDS. This is what makes the double major enforce EXACTLY the
        // program requirements -- closing the drift where the DM branches had
        // grown their own incomplete copies (non-CS missing SPS303/HUM, EE with
        // no faculty check, ECON without MATH212).
        const ctx = { curr: this, semesters: this.semesters, fields: DM_FIELDS, entryTerm: this.entryTermDM };
        return evaluateRules(ctx, graduationRulesFor(this.doubleMajor, req));
    };

    // end of s_curriculum constructor
}

