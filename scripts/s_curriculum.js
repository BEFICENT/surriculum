// Curriculum constructor. In a non-module environment this function will
// be attached to the global window so that other scripts can instantiate
// curricula without using ES module imports.


// Expose s_curriculum constructor globally when running in a browser.
if (typeof window !== 'undefined') {
    window.s_curriculum = s_curriculum;
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

// VACD's core requirement is two named pools with their own minimums, and the
// pools contain mutually-exclusive pairs. Courses beyond a pool's minimum are
// EXTRA: they spill into area electives, then free — they do not count as core.
const VACD_CORE_POOL_1 = ['HART292', 'HART293', 'HART380', 'HART413', 'HART426', 'VA315', 'VA420', 'VA430'];
const VACD_CORE_POOL_1_MIN = 9;
const VACD_CORE_POOL_2 = ['VA202', 'VA204', 'VA234', 'VA302', 'VA304', 'VA402', 'VA404'];
const VACD_CORE_POOL_2_MIN = 12;
const VACD_CORE_POOL_2_PAIRS = [['VA302', 'VA304'], ['VA402', 'VA404']];

// (The former ECON_MATH_REQ / EE_SPECIAL_AREA_CODES / MAN_*_PREFIXES /
// PSIR_CORE_*_POOL / PSY_PHILOSOPHY graduation constants now live as scraped group
// data in the requirements records — see fetch_requirements.py + graduationRulesFor.
// VACD_CORE_POOL_* and MAN_*_PREFIXES remain: still used by the allocation engine.)

// Decides each VACD pool course's pool BEFORE the allocation cascade, returning
// a Map of course -> static type ('core' for the ones filling a pool minimum,
// 'area' for the extras, which then spill area -> free through the normal
// cascade).
//
// Must run pre-cascade for the usual reason (see collectAltPairExtras): doing it
// afterwards demoted an extra out of `core` once the cascade had already capped
// core and pushed the surplus down, so the freed core slot was never refilled.
// VACD's core requirement (27) EXCEEDS its pool minimums (9+12=21), so the
// balance must come from core-typed courses outside both pools — and those were
// exactly the ones left stranded in `free`.
function selectVacdCorePools(sortedSems, isExcluded) {
    const pool1 = new Set(VACD_CORE_POOL_1);
    const pool2 = new Set(VACD_CORE_POOL_2);
    const pairKeyByCode = {};
    VACD_CORE_POOL_2_PAIRS.forEach((pair) => {
        pairKeyByCode[pair[0]] = pair.join('|');
        pairKeyByCode[pair[1]] = pair.join('|');
    });
    const creditOf = (c) => ((typeof parseCreditValue === 'function')
        ? parseCreditValue(c.SU_credit || '0')
        : (parseFloat(c.SU_credit || '0') || 0));

    const out = new Map();
    const takenPairKeys = new Set();
    let pool1Credits = 0;
    let pool2Credits = 0;

    for (let i = 0; i < sortedSems.length; i++) {
        const courses = sortedSems[i].courses || [];
        for (let j = 0; j < courses.length; j++) {
            const course = courses[j];
            if (!course || (isExcluded && isExcluded(course))) continue;
            const code = course.code;
            if (pool1.has(code)) {
                if (pool1Credits < VACD_CORE_POOL_1_MIN) {
                    out.set(course, 'core');
                    pool1Credits += creditOf(course);
                } else {
                    out.set(course, 'area');
                }
            } else if (pool2.has(code)) {
                const pairKey = pairKeyByCode[code] || null;
                if (pool2Credits < VACD_CORE_POOL_2_MIN && (!pairKey || !takenPairKeys.has(pairKey))) {
                    out.set(course, 'core');
                    pool2Credits += creditOf(course);
                    if (pairKey) takenPairKeys.add(pairKey);
                } else {
                    out.set(course, 'area');
                }
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
function countBasicLanguageInFree(semesters, effField) {
    let count = 0;
    for (let i = 0; i < semesters.length; i++) {
        const courses = semesters[i].courses || [];
        for (let j = 0; j < courses.length; j++) {
            const course = courses[j];
            if (!course) continue;
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
function collectAltPairExtras(sortedSems, pairs) {
    const norm = (v) => String(v || '').toUpperCase().replace(/\s+/g, '');
    const extras = [];
    for (let p = 0; p < pairs.length; p++) {
        const taken = [];
        for (let i = 0; i < sortedSems.length; i++) {
            const courses = sortedSems[i].courses || [];
            for (let j = 0; j < courses.length; j++) {
                const c = courses[j];
                if (c && pairs[p].indexOf(norm(c.code)) !== -1) taken.push(c);
            }
        }
        for (let k = 1; k < taken.length; k++) extras.push(taken[k]);
    }
    return extras;
}

// Programs whose SUIS "Required Courses" note states the MATH212 alternative
// AND whose required threshold can actually be met on the MATH212 path.
//
// EE and ME state the rule too ("either MATH 212 or both (MATH 201 and
// MATH 202)") but are DELIBERATELY EXCLUDED pending a threshold fix — see
// mathAlternativeSkipPredicate. Their thresholds assume the 201+202 path and are
// 2 credits out of reach on the MATH212 path, so applying the exclusion there
// would take a student who currently passes and fail them.
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
// WHY EE/ME ARE NOT WIRED UP HERE. Their required thresholds cannot be reached
// on the MATH212 path at all:
//
//                threshold   via MATH212 (4cr)   via 201+202 (6cr)
//        EE         35            33  SHORT            35  ok
//        ME         34            32  SHORT            34  ok
//
// The threshold is the sum of the required list, which carries 201+202; MATH212
// is worth two credits less than the pair it replaces. So an EE/ME student on
// the MATH212 path is ALREADY told they cannot graduate (flag 2) — a live bug
// independent of this rule, and one that lives in the threshold rather than
// here. Applying the exclusion for EE/ME before fixing that would also fail the
// students who hold all three courses, who pass today. CS/IE are unaffected:
// their alternative is MATH212 (4cr) vs MATH201 (3cr), so the newer course is
// worth MORE and every path clears.
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
//   excluded     - counts toward nothing (no pool, no credit total): the CS/IE/
//                  EE/ME math-alternative extras and VACD's required-pair extras.
//   typeOverride - re-point a course at a specific pool: ME's pair extra -> core,
//                  PSY's philosophy extra -> free, VACD's pool extras -> area.
//   forceCore    - pinned to core regardless of the core cap: VACD's core pools.
//
// Shared by both allocation passes; `major` / `entryTerm` / `getInfoFn` /
// `courseData` select the program (main major or double major). `sortedSems` is
// the chronological order the pair/pool rules depend on; `allSems` is used only
// for the order-independent math-exclusion sweep. `hasCourse` takes a code.
function resolveAlternativeRules(major, entryTerm, sortedSems, allSems, getInfoFn, courseData, hasCourse) {
    const excluded = new Set();
    const typeOverride = new Map();
    const forceCore = new Set();

    if (MATH_ALTERNATIVE_MAJORS.has(major)) {
        // MATH212 stands in for the `required`-typed subset of {MATH201, MATH202}
        // in this program's catalog — MATH201 alone for CS/IE, both for EE/ME.
        const elTypeOf = (code) => {
            const rec = getInfoFn(code, courseData);
            return String((rec && rec['EL_Type']) || '').toLowerCase();
        };
        const shouldSkipMath = mathAlternativeSkipPredicate(entryTerm, hasCourse, elTypeOf);
        allSems.forEach((sem) => {
            (sem.courses || []).forEach((c) => { if (c && shouldSkipMath(c.code)) excluded.add(c); });
        });
    }

    // Deliberately a SEPARATE chain from the maths above, not an `else if`: ME
    // needs both the MATH212 rule AND its own alternative pairs, and chaining
    // them would silently drop the pairs.
    if (major === 'ME') {
        // SUIS: the extra of an ME pair IS counted — toward Core Elective.
        const entry = parseInt(entryTerm || '0', 10);
        if (!isNaN(entry) && entry >= 202501) {
            collectAltPairExtras(sortedSems, ME_2025_ALT_PAIRS)
                .forEach((c) => typeOverride.set(c, 'core'));
        }
    } else if (major === 'VACD') {
        // SUIS: "Only one ... will be counted towards the degree" — unlike ME's
        // rule, this one does not count the extra at all, so it is excluded
        // outright rather than allowed to fill a free-elective slot. The two core
        // pools are then resolved: courses filling a minimum are pinned to core
        // (the cascade's core cap must not let a non-pool course take the slot,
        // since flags 30/31 count pool courses that actually landed in core);
        // extras are typed `area` and spill area -> free via the cascade. Pinning
        // is safe — the two minimums total 21, under the 27-credit core need.
        collectAltPairExtras(sortedSems, VACD_REQUIRED_PAIRS)
            .forEach((c) => excluded.add(c));
        selectVacdCorePools(sortedSems, (c) => excluded.has(c))
            .forEach((type, course) => {
                if (type === 'core') forceCore.add(course);
                else typeOverride.set(course, type);
            });
    } else if (major === 'PSY') {
        // No published rule for taking both; the extra counts as free by agreed
        // assumption. See PSY_PHILOSOPHY_PAIR.
        collectAltPairExtras(sortedSems, PSY_PHILOSOPHY_PAIR)
            .forEach((c) => typeOverride.set(c, 'free'));
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

const creditOfCourse = (course) => ((typeof parseCreditValue === 'function')
    ? parseCreditValue(course.SU_credit || '0')
    : (parseFloat(course.SU_credit || '0') || 0));

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
function tallyFacultyCourses(semesters, effField) {
    const eff = effField || MAIN_FIELDS.effective;
    const tally = { total: 0, fens: 0, fass: 0, sbs: 0, math: 0 };
    for (let i = 0; i < semesters.length; i++) {
        const courses = semesters[i].courses || [];
        for (let a = 0; a < courses.length; a++) {
            const course = courses[a];
            if (!course || course[eff] === 'none') continue;
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
function tallyFacultyAreas(semesters, effField) {
    const eff = effField || MAIN_FIELDS.effective;
    const areas = new Set();
    for (let i = 0; i < semesters.length; i++) {
        const courses = semesters[i].courses || [];
        for (let a = 0; a < courses.length; a++) {
            const course = courses[a];
            if (!course || course[eff] === 'none') continue;
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

function forEachCourse(semesters, fn) {
    for (let i = 0; i < semesters.length; i++) {
        const courses = semesters[i].courses || [];
        for (let a = 0; a < courses.length; a++) {
            if (courses[a]) fn(courses[a]);
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
    });
    return sum;
}

// type -> predicate(ctx, rule) returning TRUE when the requirement is SATISFIED.
// `ctx` = { curr, semesters, fields, entryTerm }.
const RULE_EVALUATORS = {
    // A specific course is present.
    hasCourse: (ctx, r) => ctx.curr.hasCourse(r.code),
    // At least one of a list is present ("one of the following").
    hasAny: (ctx, r) => ctx.curr.hasAnyCourse(r.codes),
    // A faculty-course pool count meets its minimum (see tallyFacultyCourses).
    facultyCount: (ctx, r) => tallyFacultyCourses(ctx.semesters, ctx.fields.effective)[r.pool] >= r.min,
    // Faculty courses span at least `min` distinct areas (flag 18).
    facultyAreas: (ctx, r) => tallyFacultyAreas(ctx.semesters, ctx.fields.effective).size >= r.min,
    // At most `max` basic/beginning language courses among the free electives.
    languageCap: (ctx, r) => countBasicLanguageInFree(ctx.semesters, ctx.fields.effective) <= r.max,
    // Credits from courses with a code prefix in a STATIC catalog category
    // (EE 400-level core, flag 23).
    levelCreditSum: (ctx, r) => {
        let sum = 0;
        const catField = ctx.fields.category;
        forEachCourse(ctx.semesters, (course) => {
            if (String(course.code || '').startsWith(r.prefix) && course[catField] === r.category) {
                sum += creditOfCourse(course);
            }
        });
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
        });
        return found;
    },
    // Credits from a named pool meet a minimum, with optional effective-core
    // filter and mutually-exclusive pairs (VACD/PSIR core-elective pools).
    poolCreditSum: (ctx, r) => sumPoolCredits(ctx.semesters, r.pool, {
        effField: ctx.fields.effective, catField: ctx.fields.category,
        requireCore: r.requireCore, pairs: r.pairs,
    }) >= r.min,
    // At least `min` area-effective courses whose code is an advanced PSY course
    // (flag 39).
    psyAdvancedAreaCount: (ctx, r) => {
        let n = 0;
        forEachCourse(ctx.semesters, (course) => {
            if (String(course[ctx.fields.effective] || '').toLowerCase() === 'area'
                && isPsyAdvancedCode(course.code)) n++;
        });
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
        });
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
        });
        return sum >= r.min;
    },
    // Count of STATIC-core courses OFFERED BY a faculty meets a minimum
    // (DSA core electives, flags 27/28/29).
    coreOfferingFacultyCount: (ctx, r) => {
        let n = 0;
        const catField = ctx.fields.category;
        forEachCourse(ctx.semesters, (course) => {
            if (course[catField] === 'Core' && course.Faculty === r.faculty) n++;
        });
        return n >= r.min;
    },
    // Applies only from a given entry term onward; otherwise auto-satisfied
    // (ME 2025+ requires CS404|CS412, flag 2).
    entryGatedHasAny: (ctx, r) => {
        const entry = parseInt(ctx.entryTerm || '0', 10);
        if (isNaN(entry) || entry < r.minTerm) return true;
        return ctx.curr.hasAnyCourse(r.codes);
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
    const tally = tallyFacultyCourses(ctx.semesters, ctx.fields.effective);
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
        const current = tallyFacultyAreas(ctx.semesters, ctx.fields.effective).size;
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
                    effField: fields.effective, catField, requireCore: !!g.requireBase, pairs: g.exclusivePairs });
                out.push({ ...base, current, target: g.min, unit: 'SU', ok: current >= g.min });
                break;
            }
            case 'oneOf': {
                const current = ctx.curr.hasAnyCourse(g.members) ? 1 : 0;
                out.push({ ...base, current, target: 1, unit: 'course', ok: current >= 1 });
                break;
            }
            case 'entryGatedOneOf': {
                const entry = parseInt(ctx.entryTerm || '0', 10);
                if (isNaN(entry) || entry < g.minTerm) {
                    out.push({ ...base, current: 1, target: 1, unit: 'course', ok: true,
                        note: 'Not required for your admit term' });
                } else {
                    const current = ctx.curr.hasAnyCourse(g.members) ? 1 : 0;
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
                });
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
                });
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
                });
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
                });
                out.push({ ...base, current: sum, target: g.min, unit: 'SU', ok: sum >= g.min });
                break;
            }
            case 'offeringCount': {
                let n = 0;
                forEachCourse(ctx.semesters, (course) => {
                    if (course[catField] === 'Core' && course.Faculty === g.faculty) n++;
                });
                out.push({ ...base, current: n, target: g.min, unit: 'course', ok: n >= g.min });
                break;
            }
            case 'advancedCount': {
                let n = 0;
                forEachCourse(ctx.semesters, (course) => {
                    if (String(course[fields.effective] || '').toLowerCase() === 'area'
                        && isPsyAdvancedCode(course.code)) n++;
                });
                out.push({ ...base, current: n, target: g.min, unit: 'course', ok: n >= g.min });
                break;
            }
            case 'languageCap': {
                const current = countBasicLanguageInFree(ctx.semesters, fields.effective);
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
                    typeSpan.innerHTML =
                        '<span class="course_type_part ct-main ' + mainCls + '">' + mt + '</span>' +
                        '<span class="ct-sep"> / </span>' +
                        '<span class="course_type_part ct-dm ' + dmCls + '">' + dt + '</span>';
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
                span.innerHTML = 'Total: ' + sem.totalCredit + ' credits';
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
        if (typeof requirements === 'undefined') return {};
        if (requirements[term] && requirements[term][major]) {
            return requirements[term][major];
        }
        if (requirements[major]) return requirements[major];
        return {};
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
        for(let i = 0; i < this.semesters.length; i++)
        {
            if(this.semesters[i].id == id)
            {
                this.semesters.splice(i,1)
            }
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
        // Use a strict normalizer (strip anything that's not A-Z/0-9). This
        // prevents subtle mismatches from PDFs/HTMLs that may contain
        // non-standard whitespace or punctuation in extracted course codes.
        const normalize = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        const canonicalize = (c) => {
            const n = normalize(c);
            // CS210 was renamed to DSA210; treat them as the same course.
            if (n === 'CS210' || n === 'DSA210') return 'DSA210';
            return n;
        };
        const target = canonicalize(course);
        for(let i = 0; i < this.semesters.length; i++)
        {
            for(let a = 0; a < this.semesters[i].courses.length; a++)
            {
                if(canonicalize(this.semesters[i].courses[a].code) === target)
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

    // Per-requirement-group progress for the Summary panel (Phase 4). Returns an
    // ordered list of progress rows for the given pass ('dm' → double major, else
    // the main major) — the same groups graduationRulesFor evaluates, measured as
    // current/target so the UI can show "Core I: 6/9 SU". Empty for programs with
    // no requirement-groups data. Reads the effective types the allocation set, so
    // call it after recalcEffectiveTypes(Double).
    this.requirementGroupProgress = function(view) {
        const isDM = view === 'dm';
        const major = isDM ? this.doubleMajor : this.major;
        if (!major) return [];
        const term = isDM ? this.entryTermDM : this.entryTerm;
        const req = getReq(major, term) || {};
        const fields = isDM ? DM_FIELDS : MAIN_FIELDS;
        const ctx = { curr: this, semesters: this.semesters, fields, entryTerm: term };
        if (req.groups) return groupProgressFor(ctx, req.groups, req.facultyReq);
        if (req.facultyReq) return facultyProgress(ctx, req.facultyReq);
        return [];
    };

    this.canGraduate = function()
    {
        let area = 0;
        let core = 0;
        let free = 0;
        let university = 0;
        let required = 0;
        let total = 0;
        let science = 0;
        let engineering = 0;
        let ects = 0;
        let gpaCredits = 0;
        let gpaValue = 0.0;

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
            gpaCredits += this.semesters[i].totalGPACredits;
            gpaValue += this.semesters[i].totalGPA;
        }
        // Generic requirement checks
        const req = getReq(this.major, this.entryTerm);
        if (university < req.university) return 1;
        if (req.internshipCourse && !this.hasCourse(req.internshipCourse)) return 4;
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
        let GPA = gpaCredits ? (gpaValue / gpaCredits).toFixed(3) : NaN;
        if (!isNaN(GPA)){
            if (GPA < gpaThresholdMainMajor) return 38; // Flag for main major
        }
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
        // Determine requirement thresholds for this major. If a requirement is
        // undefined (e.g., for non-engineering majors without a science
        // requirement), default to 0 so no credits are allocated to that
        // category.
        const req = getReq(this.major, this.entryTerm);
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
            this.hasCourse('CS201') &&
            this.hasCourse('DSA201')
        );

        // Alternative-course rules, resolved BEFORE the allocation cascade below
        // (see resolveAlternativeRules / collectAltPairExtras for why they cannot
        // run afterwards). Shared with the double-major pass.
        const { excluded: excludedFromDegree, typeOverride, forceCore } = resolveAlternativeRules(
            this.major, this.entryTerm, sortedSemesters, this.semesters,
            getInfoFn, course_data, (c) => this.hasCourse(c),
        );

        // Iterate semesters in chronological order
        for (let i = 0; i < sortedSemesters.length; i++) {
            const sem = sortedSemesters[i];
            // Iterate courses in the order they appear within the semester.
            for (let j = 0; j < sem.courses.length; j++) {
                const course = sem.courses[j];
                // Skip credit calculations for courses with grade F
                let gradeText = '';
                try {
                    const elem = document.getElementById(course.id);
                    if (elem) {
                        const gr = elem.querySelector('.grade');
                        gradeText = gr ? gr.textContent.trim() : '';
                    }
                } catch (_) {}
                if (gradeText === 'F') {
                    course.effective_type = 'none';
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
                            const get = (k) => {
                                try { return ps ? ps.getItem(k) : localStorage.getItem(k); } catch (_) {}
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
                // — not a pool, and not the degree total either (every major's
                // `total` is exactly the sum of its pool minimums, so a course
                // in no pool cannot contribute to it). Same treatment as the
                // hard-coded alternative exclusions above; the `continue` runs
                // before any total is touched.
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

        // (VACD's core pools are resolved BEFORE the allocation cascade above
        // via selectVacdCorePools() + `typeOverride`: pool courses filling a
        // minimum are typed `core`, extras are typed `area` and spill to free
        // through the normal cascade. Doing it afterwards demoted an extra out
        // of core once the cascade had already capped core and pushed the
        // surplus down, and nothing refilled the freed slot from the
        // core-typed courses stranded in `free` — VACD's core requirement (27)
        // exceeds its pool minimums (9+12), so that balance MUST come from
        // outside the pools. The cascade now handles allocation, totals and
        // DOM labels uniformly.)

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
        // Determine requirement thresholds for the double major. Required,
        // core and area requirements are drawn from the second major's
        // requirements.
        const dmReq = getReq(this.doubleMajor, this.entryTermDM);
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
            this.hasCourse('CS201') &&
            this.hasCourse('DSA201')
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
                getInfoFnDM, course_data_dm, (c) => this.hasCourse(c),
            );

        // Walk semesters and courses allocating DM categories
        for (let i = 0; i < sorted.length; i++) {
            const sem = sorted[i];
            for (let j = 0; j < sem.courses.length; j++) {
                const course = sem.courses[j];
                let gradeText = '';
                try {
                    const elem = document.getElementById(course.id);
                    if (elem) {
                        const gr = elem.querySelector('.grade');
                        gradeText = gr ? gr.textContent.trim() : '';
                    }
                } catch (_) {}
                if (gradeText === 'F') {
                    course.effective_type_dm = 'none';
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
                            const get = (k) => {
                                try { return ps ? ps.getItem(k) : localStorage.getItem(k); } catch (_) {}
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
        let gpaCreditsDM = 0;
        let gpaValueDM = 0;
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
            gpaCreditsDM += sem.totalGPACredits;
            gpaValueDM += sem.totalGPA;
        }
        // Fetch requirements for double major and adjust SU/ECTS thresholds
        const req = getReq(this.doubleMajor, this.entryTermDM);
        const totalReq = (req.total || 0) + 30;
        const ectsReq = (req.ects || 0) + 60;
        // Generic checks
        if (university < (req.university || 0)) return 1;
        if (req.internshipCourse && !this.hasCourse(req.internshipCourse)) return 4;
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
        const gpaThresholdDoubleMajor = 3.20;
        let GPA = gpaCreditsDM ? (gpaValueDM / gpaCreditsDM).toFixed(3) : NaN;
        if (!isNaN(GPA)){
            if (this.doubleMajor && GPA < gpaThresholdDoubleMajor) return 38; // Flag for double major
        }
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

