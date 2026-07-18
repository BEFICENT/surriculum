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

// Programs whose SUIS page requires TWO HUM courses — one 2xx and one 3xx —
// rather than one. Confirmed verbatim for all five; the FENS programs
// (university 41) require one instead.
//
// This mirrors the university-credit split exactly (44 vs 41 = the 3 SU of one
// extra HUM course), so it could be derived from `req.university === 44`. It is
// stated explicitly on purpose: deriving a named academic rule from a credit
// total is the kind of implicit cleverness that reads as a coincidence later and
// breaks the first time a threshold moves for an unrelated reason. Better still
// would be a `humRequired` field in the requirements data — worth doing when the
// scraper next changes.
const HUM_TWO_LEVEL_MAJORS = new Set(['ECON', 'MAN', 'PSIR', 'PSY', 'VACD']);

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

    this.getTotalCredits = function ()
    {};
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
    this.countFacultyCourses = function() {
        const tally = { total: 0, fens: 0, fass: 0, sbs: 0, math: 0 };
        for (let i = 0; i < this.semesters.length; i++) {
            const courses = this.semesters[i].courses || [];
            for (let a = 0; a < courses.length; a++) {
                const course = courses[a];
                if (!course || course.effective_type === 'none') continue;
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
    // True when ANY of `codes` is present. For "one of the following" rules.
    this.hasAnyCourse = function(codes) {
        for (let i = 0; i < codes.length; i++) {
            if (this.hasCourse(codes[i])) return true;
        }
        return false;
    }
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
        // ---- University Courses: SHARED across every undergrad program ----
        // Every major's SUIS page carries the identical block: "All freshman
        // courses (1XX coded courses, including PROJ 201) and SPS 303 are
        // required." These were previously checked for CS only, so a non-CS
        // student missing SPS 303 was told they could graduate.
        if (!this.hasCourse('SPS303')) return 11;

        // HUM requirement. FASS/SBS programs: "At least 2 of the below listed
        // HUM courses must be taken. First the 2xx coded course, then the 3xx
        // coded course must be taken." — confirmed verbatim on ECON, MAN, PSIR,
        // PSY and VACD.
        //
        // NB this cannot be a count or a credit check: HUM201 + HUM202 is two
        // HUM courses and reaches the 44-credit university total, yet fails the
        // rule for want of a 3xx. It has to be compositional — one from each
        // level. That is exactly what flags 12 and 13 were always for; only the
        // 12 half was ever written.
        //
        // FENS programs require one HUM instead (BIO, DSA: "One of the HUM
        // coded course listed below is required"). Their exact wording for
        // CS/EE/IE/MAT/ME is unverified, so their existing behaviour is left
        // alone here rather than guessed at.
        if (HUM_TWO_LEVEL_MAJORS.has(this.major)) {
            if (!this.hasAnyCourse(HUM_200_LEVEL)) return 12;
            if (!this.hasAnyCourse(HUM_300_LEVEL)) return 13;
        }

        // Major-specific CS checks (only additional flags beyond generic)
        if(this.major == 'CS')
        {
            // SUIS (CS, a FENS 1-HUM program): "One of the HUM coded course
            // listed below is required" — the list is all nine, 2xx AND 3xx.
            // This previously demanded a 2xx specifically, so a CS student whose
            // single HUM was a 3xx (e.g. HUM311) reached university=41 yet was
            // told they had not met their HUM. Any HUM satisfies it. (In effect
            // unreachable — a student with zero HUM is short on university
            // credits and trips flag 1 first — but kept as the correct check.)
            if (!this.hasAnyCourse(HUM_ANY_LEVEL)) return 12;
            {
                // Check faculty course requirements for CS
                let facultyCoursesCount = 0;
                let fensCoursesCount = 0;
                let mathCoursesCount = 0;

                for(let i = 0; i < this.semesters.length; i++) {
                    for(let a = 0; a < this.semesters[i].courses.length; a++) {
                        let course = this.semesters[i].courses[a];
                        if (course && course.effective_type === 'none') continue;
                        // Count faculty courses using the new Faculty_Course attribute
                        if(course.Faculty_Course && course.Faculty_Course !== 'No') {
                            facultyCoursesCount++;

                            // Count FENS courses
                            if(course.Faculty_Course === "FENS") {
                                fensCoursesCount++;
                            }

                            // Count MATH courses from FENS faculty courses
                            if(course.Faculty_Course === "FENS" && course.code.startsWith("MATH")) {
                                mathCoursesCount++;
                            }
                        }
                    }
                }

                if(facultyCoursesCount < 5) return 14;
                if(mathCoursesCount < 2) return 19;
                if(fensCoursesCount < 3) return 16;
            }
        }
        else if(this.major == 'IE')
        {
            // Generic checks apply
            // Additional IE-specific logic can be added here if needed
            {
                // Check faculty course requirements for IE (same as CS, EE, MAT)
                let facultyCoursesCount = 0;
                let fensCoursesCount = 0;
                let mathCoursesCount = 0;

                for(let i = 0; i < this.semesters.length; i++) {
                    for(let a = 0; a < this.semesters[i].courses.length; a++) {
                        let course = this.semesters[i].courses[a];
                        // Count faculty courses using the new Faculty_Course attribute
                        if(course.Faculty_Course && course.Faculty_Course !== 'No') {
                            facultyCoursesCount++;

                            // Count FENS courses
                            if(course.Faculty_Course === "FENS") {
                                fensCoursesCount++;
                            }

                            // Count MATH courses from FENS faculty courses
                            if(course.Faculty_Course === "FENS" && course.code.startsWith("MATH")) {
                                mathCoursesCount++;
                            }
                        }
                    }
                }

                if(facultyCoursesCount < 5) return 14;
                if(mathCoursesCount < 2) return 19;
                if(fensCoursesCount < 3) return 16;
            }
        }
        else if(this.major == 'EE')
        {
            // Generic checks apply
            {
                // SUIS (EE, Faculty Courses): "a total of at least 5 courses
                // should be completed from FENS Faculty Courses and/or FASS, SBS
                // Faculty Courses. At least 2 of these courses must be MATH
                // coded. In addition, at least 3 of these courses must be from
                // the pool of FENS Faculty Courses."
                //
                // EE had NO faculty-course checks at all — the only major
                // missing them, though its rule is word-for-word BIO's. EE
                // students were simply never checked against a requirement they
                // must meet.
                const facultyEE = this.countFacultyCourses();
                if (facultyEE.total < 5) return 14;
                if (facultyEE.math < 2) return 19;
                if (facultyEE.fens < 3) return 16;

                // Check for minimum 400-level EE courses requirement (9 credits)
                let ee400LevelCredits = 0;
                for(let i = 0; i < this.semesters.length; i++) {
                    for(let a = 0; a < this.semesters[i].courses.length; a++) {
                        let course = this.semesters[i].courses[a];
                        // Check if it's a 400-level EE course in core electives
                        if(course.code.startsWith("EE4") && course.category === "Core") {
                            ee400LevelCredits += (typeof parseCreditValue === 'function')
                                ? parseCreditValue(course.SU_credit || '0')
                                : (parseFloat(course.SU_credit || '0') || 0);
                        }
                    }
                }

                if (ee400LevelCredits < 9) return 23;

                else
                {

                    // Check for minimum one course from specific area electives
                    let hasSpecificAreaCourse = false;
                    const specificAreaCourses = ["CS300", "CS401", "CS412", "ME303", "PHYS302", "PHYS303"];

                    for(let i = 0; i < this.semesters.length; i++) {
                        for(let a = 0; a < this.semesters[i].courses.length; a++) {
                            let course = this.semesters[i].courses[a];
                            // Check for specific area courses
                            if(specificAreaCourses.includes(course.code) ||
                                (course.code.startsWith("EE48") && course.category === "Area")) {
                                hasSpecificAreaCourse = true;
                                break;
                            }
                        }
                        if(hasSpecificAreaCourse) break;
                    }

                    if(!hasSpecificAreaCourse) return 24;

                }
            }
        }
        else if(this.major == 'MAT')
        {
            // Generic checks apply
            {
                // Check if student has at least 5 faculty courses with special requirements
                let facultyCoursesCount = 0;
                let fensCoursesCount = 0;
                let mathCoursesCount = 0;

                for(let i = 0; i < this.semesters.length; i++) {
                    for(let a = 0; a < this.semesters[i].courses.length; a++) {
                        let course = this.semesters[i].courses[a];
                        // Count faculty courses using the new Faculty_Course attribute
                        if(course.Faculty_Course && course.Faculty_Course !== 'No') {
                            facultyCoursesCount++;

                            // Count FENS courses
                            if(course.Faculty_Course === "FENS") {
                                fensCoursesCount++;
                            }

                            // Count MATH courses from FENS faculty courses
                            if(course.Faculty_Course === "FENS" && course.code.startsWith("MATH")) {
                                mathCoursesCount++;
                            }
                        }
                    }
                }

                if(facultyCoursesCount < 5) return 14;
                if(mathCoursesCount < 2) return 19;
                if(fensCoursesCount < 3) return 16;

            }
        }
        else if(this.major == 'BIO')
        {
            // Generic checks apply
            {
                // Check faculty course requirements for BIO
                let facultyCoursesCount = 0;
                let fensCoursesCount = 0;
                let mathCoursesCount = 0;

                for(let i = 0; i < this.semesters.length; i++) {
                    for(let a = 0; a < this.semesters[i].courses.length; a++) {
                        let course = this.semesters[i].courses[a];
                        // Count faculty courses using the new Faculty_Course attribute
                        if(course.Faculty_Course && course.Faculty_Course !== 'No') {
                            facultyCoursesCount++;

                            // Count FENS courses
                            if(course.Faculty_Course === "FENS") {
                                fensCoursesCount++;
                            }

                            // Count MATH courses from FENS faculty courses
                            if(course.Faculty_Course === "FENS" && course.code.startsWith("MATH")) {
                                mathCoursesCount++;
                            }
                        }
                    }
                }

                if(facultyCoursesCount < 5) return 14;
                if(mathCoursesCount < 2) return 19;
                if(fensCoursesCount < 3) return 16;

            }
        }
        else if(this.major == 'ME')
        {
            // Generic checks apply
            {
                const meEntry = parseInt(this.entryTerm || '0', 10);
                if (!isNaN(meEntry) && meEntry >= 202501) {
                    if (!(this.hasCourse('CS404') || this.hasCourse('CS412'))) return 2;
                }

                // Check faculty course requirements for ME (same as CS, EE, MAT, IE)
                let facultyCoursesCount = 0;
                let fensCoursesCount = 0;
                let mathCoursesCount = 0;

                for(let i = 0; i < this.semesters.length; i++) {
                    for(let a = 0; a < this.semesters[i].courses.length; a++) {
                        let course = this.semesters[i].courses[a];
                        // Count faculty courses using the new Faculty_Course attribute
                        if(course.Faculty_Course && course.Faculty_Course !== 'No') {
                            facultyCoursesCount++;

                            // Count FENS courses
                            if(course.Faculty_Course === "FENS") {
                                fensCoursesCount++;
                            }

                            // Count MATH courses from FENS faculty courses
                            if(course.Faculty_Course === "FENS" && course.code.startsWith("MATH")) {
                                mathCoursesCount++;
                            }
                        }
                    }
                }

                if(facultyCoursesCount < 5) return 14;
                if(mathCoursesCount < 2) return 19;
                if(fensCoursesCount < 3) return 16;
            }
        }
        else if(this.major == 'ECON')
        {
            // Generic checks apply
            {
                // Check if Math requirement (3 credits) is fulfilled
                // SUIS (ECON, "Mathematics Requirement Courses"): 1 course from
                // MATH201 / MATH202 / MATH204 / MATH212. MATH212 was missing —
                // it replaces MATH201+MATH202, is `required` in ECON's catalog
                // (4cr), and a student who satisfied their maths with it was
                // told they had not.
                let hasMathRequirement = this.hasAnyCourse(['MATH201', 'MATH202', 'MATH204', 'MATH212']);
                if (!hasMathRequirement) return 25;

                // Check if at least 5 faculty courses requirement is met
                let facultyCoursesCount = 0;
                let fassCount = 0;
                let areasCount = new Set();

                for(let i = 0; i < this.semesters.length; i++) {
                    for(let a = 0; a < this.semesters[i].courses.length; a++) {
                        let course = this.semesters[i].courses[a];
                        // Count faculty courses using the new Faculty_Course attribute
                        if(course.Faculty_Course && course.Faculty_Course !== 'No') {
                            facultyCoursesCount++;

                            // Count FASS courses
                            if(course.Faculty_Course === "FASS") {
                                fassCount++;
                            }

                            // Track areas (simplified check)
                            if(course.code.startsWith("CULT")) areasCount.add("CULT");
                            else if(course.code.startsWith("ECON")) areasCount.add("ECON");
                            else if(course.code.startsWith("HART")) areasCount.add("HART");
                            else if(course.code.startsWith("PSYCH")) areasCount.add("PSYCH");
                            else if(course.code.startsWith("SPS") || course.code.startsWith("POLS") || course.code.startsWith("IR")) areasCount.add("SPS/POLS/IR");
                            else if(course.code.startsWith("VA")) areasCount.add("VA");
                            else if(course.Faculty_Course === "FENS") areasCount.add("FENS");
                            else if(course.Faculty_Course === "SBS") areasCount.add("SBS");
                        }
                    }
                }

                if(facultyCoursesCount < 5) return 14;
                if(fassCount < 3) return 15;
                if(areasCount.size < 3) return 18;

                // SUIS: at most 2 Beginning/Basic level language courses may
                // count toward the free electives.
                if (countBasicLanguageInFree(this.semesters, 'effective_type') > BASIC_LANGUAGE_LIMIT) return 40;
            }
        }
        else if(this.major == 'MAN') {
            // Generic checks apply
            {
                // Check faculty course requirements for MAN
                let facultyCoursesCount = 0;
                let sbsCoursesCount = 0;

                for (let i = 0; i < this.semesters.length; i++) {
                    for (let a = 0; a < this.semesters[i].courses.length; a++) {
                        let course = this.semesters[i].courses[a];
                        // Count faculty courses using the new Faculty_Course attribute
                        if (course.Faculty_Course && course.Faculty_Course !== 'No') {
                            facultyCoursesCount++;

                            // Count SBS courses
                            if (course.Faculty_Course === "SBS") {
                                sbsCoursesCount++;
                            }
                        }
                    }
                }

                if (facultyCoursesCount < 5) return 14;
                if (sbsCoursesCount < 2) return 22;

                // Core electives requirement: 6 courses from 6 different areas
                let coreAreas = new Set();
                let coreCount = 0;
                for (let i = 0; i < this.semesters.length; i++) {
                    for (let a = 0; a < this.semesters[i].courses.length; a++) {
                        const course = this.semesters[i].courses[a];
                        const eff = (course.effective_type || (course.category && course.category.toLowerCase()) || '').toLowerCase();
                        if (eff === 'core') {
                            coreCount++;
                            if (course.code.startsWith('ACC')) coreAreas.add('ACC');
                            else if (course.code.startsWith('FIN')) coreAreas.add('FIN');
                            else if (course.code.startsWith('MGMT')) coreAreas.add('MGMT');
                            else if (course.code.startsWith('MKTG')) coreAreas.add('MKTG');
                            else if (course.code.startsWith('OPIM')) coreAreas.add('OPIM');
                            else if (course.code.startsWith('ORG')) coreAreas.add('ORG');
                        }
                    }
                }
                if (coreAreas.size < 6) return 35;

                // Area electives requirement: 5 courses from 5 different areas
                let areaAreas = new Set();
                let areaCount = 0;
                for (let i = 0; i < this.semesters.length; i++) {
                    for (let a = 0; a < this.semesters[i].courses.length; a++) {
                        const course = this.semesters[i].courses[a];
                        const eff = (course.effective_type || (course.category && course.category.toLowerCase()) || '').toLowerCase();
                        if (eff === 'area') {
                            areaCount++;
                            if (course.code.startsWith('ACC')) areaAreas.add('ACC');
                            else if (course.code.startsWith('FIN')) areaAreas.add('FIN');
                            else if (course.code.startsWith('MKTG')) areaAreas.add('MKTG');
                            else if (course.code.startsWith('OPIM')) areaAreas.add('OPIM');
                            else if (course.code.startsWith('ORG')) areaAreas.add('ORG');
                        }
                    }
                }
                if (areaAreas.size < 5) return 36;

                // SUIS (MAN free electives): "26 SU credits are required. 9 out
                // of these 26 SU credits should be among the courses offered by
                // FASS or FENS. At most 2 of the Beginning / Basic level
                // language courses can be used to fulfill the requirements for
                // this area."
                let freeElectiveCredits = 0;
                let fassFensCredits = 0;

                for (let i = 0; i < this.semesters.length; i++) {
                    for (let a = 0; a < this.semesters[i].courses.length; a++) {
                        const course = this.semesters[i].courses[a];
                        const eff = (course.effective_type || (course.category && course.category.toLowerCase()) || '').toLowerCase();
                        if (eff === 'free') {
                            const c = (typeof parseCreditValue === 'function')
                                ? parseCreditValue(course.SU_credit || '0')
                                : (parseFloat(course.SU_credit || '0') || 0);
                            freeElectiveCredits += c;
                            // "offered by FASS or FENS" is the OFFERING faculty
                            // (`Faculty`), not the faculty-course pool marker
                            // (`Faculty_Course`, set on only ~66 of 670 courses).
                            if (course.Faculty === 'FASS' || course.Faculty === 'FENS') {
                                fassFensCredits += c;
                            }
                        }
                    }
                }

                // Check Free Electives requirements
                // The 26-credit condition is redundant with the generic free
                // check (MAN's `free` requirement IS 26), so it never fires —
                // kept as a guard in case the two ever diverge.
                if (freeElectiveCredits < 26) return 37;
                if (fassFensCredits < 9) return 37;
                // Its own flag: 37's message only describes the FASS/FENS rule,
                // so reporting the language cap as 37 told students the wrong
                // thing entirely.
                if (countBasicLanguageInFree(this.semesters, 'effective_type') > BASIC_LANGUAGE_LIMIT) return 40;
            }
        }
        else if(this.major == 'PSIR')
        {
            // Generic checks apply
            {
                // Check faculty course requirements for PSIR
                let facultyCoursesCount = 0;
                let fassCoursesCount = 0;
                let areasCount = new Set();

                for(let i = 0; i < this.semesters.length; i++) {
                    for(let a = 0; a < this.semesters[i].courses.length; a++) {
                        let course = this.semesters[i].courses[a];
                        // Count faculty courses using the new Faculty_Course attribute
                        if(course.Faculty_Course && course.Faculty_Course !== 'No') {
                            facultyCoursesCount++;

                            // Count FASS courses
                            if(course.Faculty_Course === "FASS") {
                                fassCoursesCount++;
                            }

                            // Track areas for PSIR
                            if(course.code.startsWith("CULT")) areasCount.add("CULT");
                            else if(course.code.startsWith("ECON")) areasCount.add("ECON");
                            else if(course.code.startsWith("HART")) areasCount.add("HART");
                            else if(course.code.startsWith("PSY")) areasCount.add("PSYCH");
                            else if(course.code.startsWith("SPS") || course.code.startsWith("POLS") || course.code.startsWith("IR")) areasCount.add("SPS/POLS/IR");
                            else if(course.code.startsWith("VA")) areasCount.add("VA");
                            else if(course.Faculty_Course === "FENS") areasCount.add("FENS");
                            else if(course.Faculty_Course === "SBS") areasCount.add("SBS");
                        }
                    }
                }

                if(facultyCoursesCount < 5) return 14;
                if(fassCoursesCount < 3) return 15;
                if(areasCount.size < 3) return 18;

                // Core Electives I (Political Science)
                let coreElectivesICount = 0;
                const coreElectivesIPool = ['LAW312', 'POLS251', 'POLS353', 'POLS404', 'POLS455', 'POLS483', 'POLS493', 'SOC201'];
                for (let i = 0; i < this.semesters.length; i++) {
                    for (let a = 0; a < this.semesters[i].courses.length; a++) {
                        const course = this.semesters[i].courses[a];
                        const courseCode = course.code || ((course.Major || '') + (course.Code || ''));
                        if (coreElectivesIPool.includes(courseCode)) {
                            coreElectivesICount += (typeof parseCreditValue === 'function')
                                ? parseCreditValue(course.SU_credit || '0')
                                : (parseFloat(course.SU_credit || '0') || 0);
                        }
                    }
                }
                if (coreElectivesICount < 12) return 33;

                // Core Electives II (International Relations)
                let coreElectivesIICount = 0;
                const coreElectivesIIPool = ['CONF400', 'IR301', 'IR342', 'IR391', 'IR394', 'IR405', 'IR489', 'LAW311', 'POLS492'];
                for (let i = 0; i < this.semesters.length; i++) {
                    for (let a = 0; a < this.semesters[i].courses.length; a++) {
                        const course = this.semesters[i].courses[a];
                        const courseCode = course.code || ((course.Major || '') + (course.Code || ''));
                        if (coreElectivesIIPool.includes(courseCode)) {
                            coreElectivesIICount += (typeof parseCreditValue === 'function')
                                ? parseCreditValue(course.SU_credit || '0')
                                : (parseFloat(course.SU_credit || '0') || 0);
                        }
                    }
                }
                if (coreElectivesIICount < 12) return 34;

                // SUIS: at most 2 Beginning/Basic level language courses may
                // count toward the free electives.
                if (countBasicLanguageInFree(this.semesters, 'effective_type') > BASIC_LANGUAGE_LIMIT) return 40;
            }
        }
        else if(this.major == 'PSY')
        {
            // Generic checks apply
            {
                // Check Philosophy requirement
                let hasPhilosophy = this.hasCourse("PHIL300") || this.hasCourse("PHIL301");
                if (!hasPhilosophy) return 26;

                // Check faculty course requirements for PSY
                let facultyCoursesCount = 0;
                let fassCoursesCount = 0;
                let areasCount = new Set();

                for(let i = 0; i < this.semesters.length; i++) {
                    for(let a = 0; a < this.semesters[i].courses.length; a++) {
                        let course = this.semesters[i].courses[a];
                        // Count faculty courses using the new Faculty_Course attribute
                        if(course.Faculty_Course && course.Faculty_Course !== 'No') {
                            facultyCoursesCount++;

                            // Count FASS courses
                            if(course.Faculty_Course === "FASS") {
                                fassCoursesCount++;
                            }

                            // Track areas for PSY
                            if(course.code.startsWith("CULT")) areasCount.add("CULT");
                            else if(course.code.startsWith("ECON")) areasCount.add("ECON");
                            else if(course.code.startsWith("HART")) areasCount.add("HART");
                            else if(course.code.startsWith("PSY")) areasCount.add("PSYCH");
                            else if(course.code.startsWith("SPS") || course.code.startsWith("POLS") || course.code.startsWith("IR")) areasCount.add("SPS/POLS/IR");
                            else if(course.code.startsWith("VA")) areasCount.add("VA");
                            else if(course.Faculty_Course === "FENS") areasCount.add("FENS");
                            else if(course.Faculty_Course === "SBS") areasCount.add("SBS");
                        }
                    }
                }

                if(facultyCoursesCount < 5) return 14;
                if(fassCoursesCount < 3) return 15;
                if(areasCount.size < 3) return 18;

                // SUIS (PSY area electives): "At least 6 courses from all PSY
                // coded undergraduate courses. At least 2 courses must be from
                // PSY 4XX-level advanced Psychology courses."
                // The 6-course minimum needs no check of its own: the `area`
                // threshold is 18 credits = 6 x 3cr, and the PSY catalog types
                // only PSY-coded courses as area, so the generic area check
                // already enforces it. Only the 4XX rule is left.
                //
                // SUIS (PSY free electives): "at most two of the beginning/basic
                // level second language courses can be used to fulfill the free
                // elective requirements."
                let psy4xxAreaCount = 0;
                for (let i = 0; i < this.semesters.length; i++) {
                    for (let a = 0; a < this.semesters[i].courses.length; a++) {
                        const course = this.semesters[i].courses[a];
                        if ((course.effective_type || '').toLowerCase() === 'area'
                            && isPsyAdvancedCode(course.code)) psy4xxAreaCount++;
                    }
                }
                if (psy4xxAreaCount < 2) return 39;
                if (countBasicLanguageInFree(this.semesters, 'effective_type') > BASIC_LANGUAGE_LIMIT) return 40;
            }
        }
        else if(this.major == 'VACD')
        {
            // Generic checks apply
            {
                // Check faculty course requirements for VACD
                let facultyCoursesCount = 0;
                let fassCoursesCount = 0;
                let areasCount = new Set();

                for(let i = 0; i < this.semesters.length; i++) {
                    for(let a = 0; a < this.semesters[i].courses.length; a++) {
                        let course = this.semesters[i].courses[a];
                        // Count faculty courses using the new Faculty_Course attribute
                        if(course.Faculty_Course && course.Faculty_Course !== 'No') {
                            facultyCoursesCount++;

                            // Count FASS courses
                            if(course.Faculty_Course === "FASS") {
                                fassCoursesCount++;
                            }

                            // Track areas for VACD
                            if(course.code.startsWith("CULT")) areasCount.add("CULT");
                            else if(course.code.startsWith("ECON")) areasCount.add("ECON");
                            else if(course.code.startsWith("HART")) areasCount.add("HART");
                            else if(course.code.startsWith("PSY")) areasCount.add("PSYCH");
                            else if(course.code.startsWith("SPS") || course.code.startsWith("POLS") || course.code.startsWith("IR")) areasCount.add("SPS/POLS/IR");
                            else if(course.code.startsWith("VA")) areasCount.add("VA");
                            else if(course.Faculty_Course === "FENS") areasCount.add("FENS");
                            else if(course.Faculty_Course === "SBS") areasCount.add("SBS");
                        }
                    }
                }

                if(facultyCoursesCount < 5) return 14;
                if(fassCoursesCount < 3) return 15;
                if(areasCount.size < 3) return 18;

                // Core Electives I (Art/Design History Courses) for VACD
                let coreElectivesICount = 0;
                const coreElectivesIPool = ['HART292', 'HART293', 'HART380', 'HART413', 'HART426', 'VA315', 'VA420', 'VA430'];
                for (let i = 0; i < this.semesters.length; i++) {
                    for (let a = 0; a < this.semesters[i].courses.length; a++) {
                        const course = this.semesters[i].courses[a];
                        const courseCode = course.code || ((course.Major || '') + (course.Code || ''));
                        const eff = (course.effective_type || (course.category && course.category.toLowerCase()) || '').toLowerCase();
                        if (eff === 'core' && coreElectivesIPool.includes(courseCode)) {
                            coreElectivesICount += (typeof parseCreditValue === 'function')
                                ? parseCreditValue(course.SU_credit || '0')
                                : (parseFloat(course.SU_credit || '0') || 0);
                        }
                    }
                }
                if (coreElectivesICount < 9) return 30;

                // Core Electives II (Skill Courses) for VACD
                let coreElectivesIICount = 0;
                const coreElectivesIIPool = ['VA202', 'VA204', 'VA234', 'VA302', 'VA304', 'VA402', 'VA404'];
                const pairKeyByCode = {
                    VA302: 'VA302|VA304',
                    VA304: 'VA302|VA304',
                    VA402: 'VA402|VA404',
                    VA404: 'VA402|VA404',
                };
                const seenPairKeys = new Set();
                for (let i = 0; i < this.semesters.length; i++) {
                    for (let a = 0; a < this.semesters[i].courses.length; a++) {
                        const course = this.semesters[i].courses[a];
                        const courseCode = course.code || ((course.Major || '') + (course.Code || ''));
                        const eff = (course.effective_type || (course.category && course.category.toLowerCase()) || '').toLowerCase();
                        if (eff === 'core' && coreElectivesIIPool.includes(courseCode)) {
                            const pairKey = pairKeyByCode[courseCode];
                            if (pairKey) {
                                if (seenPairKeys.has(pairKey)) continue;
                                seenPairKeys.add(pairKey);
                            }
                            coreElectivesIICount += (typeof parseCreditValue === 'function')
                                ? parseCreditValue(course.SU_credit || '0')
                                : (parseFloat(course.SU_credit || '0') || 0);
                        }
                    }
                }
                if (coreElectivesIICount < 12) return 31;
                // SUIS: at most 2 Beginning/Basic level language courses may
                // count toward the free electives.
                if (countBasicLanguageInFree(this.semesters, 'effective_type') > BASIC_LANGUAGE_LIMIT) return 40;
            }
        }
        else if(this.major == 'DSA')
        {
            // Generic checks apply
            {
                // Check faculty course requirements for DSA
                let facultyCoursesCount = 0;
                let fensCoursesCount = 0;
                let fassCoursesCount = 0;
                let sbsCoursesCount = 0;

                for(let i = 0; i < this.semesters.length; i++) {
                    for(let a = 0; a < this.semesters[i].courses.length; a++) {
                        let course = this.semesters[i].courses[a];
                        // Count faculty courses using the new Faculty_Course attribute
                        if(course.Faculty_Course && course.Faculty_Course !== 'No') {
                            facultyCoursesCount++;

                            // Count courses by faculty
                            if(course.Faculty_Course === "FENS") {
                                fensCoursesCount++;
                            } else if(course.Faculty_Course === "FASS") {
                                fassCoursesCount++;
                            } else if(course.Faculty_Course === "SBS") {
                                sbsCoursesCount++;
                            }
                        }
                    }
                }

                if(facultyCoursesCount < 5) return 14;
                if(fensCoursesCount < 1) return 20;
                if(fassCoursesCount < 1) return 21;
                if(sbsCoursesCount < 1) return 22;

                // Check core electives requirements
                // At least 27 SU credits with at least 3 courses from each faculty
                let fensCoreCount = 0;
                let fassCoreCount = 0;
                let sbsCoreCount = 0;

                for(let i = 0; i < this.semesters.length; i++) {
                    for(let a = 0; a < this.semesters[i].courses.length; a++) {
                        let course = this.semesters[i].courses[a];
                        if(course.category === "Core") {
                            // "3 FASS courses in your core electives" means core
                            // electives OFFERED BY that faculty -> `Faculty`.
                            // NOT `Faculty_Course`, which marks membership of the
                            // faculty-course pool and is what flags 14/20/21/22
                            // above correctly use. They are different attributes:
                            // every course has a Faculty; only ~10% are faculty
                            // courses.
                            if(course.Faculty === "FENS") {
                                fensCoreCount++;
                            } else if(course.Faculty === "FASS") {
                                fassCoreCount++;
                            } else if(course.Faculty === "SBS") {
                                sbsCoreCount++;
                            }
                        }
                    }
                }

                if(fensCoreCount < 3) return 27;
                if(fassCoreCount < 3) return 28;
                if(sbsCoreCount < 3) return 29;
            }
        }
        return 0; // No issues found, return 0
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
                    try {
                        const courseElem = document.getElementById(course.id);
                        if (courseElem) {
                            const typeElem = courseElem.querySelector('.course_type');
                            if (typeElem) typeElem.textContent = 'N/A';
                        }
                    } catch (_) {}
                    continue;
                }
                // Excluded alternative (SUIS rule): counts toward no pool, and
                // toward no credit total either — hence the `continue` before
                // any of the totals below are touched.
                if (excludedFromDegree.has(course)) {
                    course.effective_type = 'none';
                    try {
                        const courseElem = document.getElementById(course.id);
                        const typeElem = courseElem ? courseElem.querySelector('.course_type') : null;
                        if (typeElem) typeElem.textContent = 'N/A';
                    } catch (_) {}
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
                    // Update DOM label to N/A
                    try {
                        const courseElem = document.getElementById(course.id);
                        if (courseElem) {
                            const typeElem = courseElem.querySelector('.course_type');
                            if (typeElem) {
                                typeElem.textContent = 'N/A';
                            }
                        }
                    } catch (_) {}
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
                    try {
                        const courseElem = document.getElementById(course.id);
                        const typeElem = courseElem ? courseElem.querySelector('.course_type') : null;
                        if (typeElem) typeElem.textContent = 'N/A';
                    } catch (_) {}
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

                // Update the course type displayed in the DOM if possible. The
                // course element has id equal to course.id (e.g., 'c3'). It
                // contains a child with class 'course_type' that shows the
                // static type. We update its text content to reflect the
                // effective type. If the element does not exist (e.g., during
                // server-side tests), this call will silently fail.
                try {
                    const courseElem = document.getElementById(course.id);
                    if (courseElem) {
                        const typeElem = courseElem.querySelector('.course_type');
                        if (typeElem) {
                            typeElem.textContent = effectiveType.toUpperCase();
                            try {
                                const base = (staticType || '').toLowerCase();
                                const eff = (effectiveType || '').toLowerCase();
                                const movedDown = !!(base && eff && base !== eff && eff !== 'none');
                                typeElem.classList.toggle('is-overflow-type', movedDown);
                            } catch (_) {}
                        }
                    }
                } catch (err) {
                    // Ignore DOM errors in non-browser contexts
                }
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

            // Update DOM type label for MAN elective normalization (skip if not present).
            try {
                for (let i = 0; i < this.semesters.length; i++) {
                    const sem = this.semesters[i];
                    for (let j = 0; j < sem.courses.length; j++) {
                        const course = sem.courses[j];
                        if (!course || !course.id) continue;
                        const courseElem = document.getElementById(course.id);
                        if (!courseElem) continue;
                        const typeElem = courseElem.querySelector('.course_type');
                        if (typeElem && course.effective_type) {
                            typeElem.textContent = course.effective_type.toUpperCase();
                            try {
                                const base = (course.category || '').toString().toLowerCase();
                                const eff = (course.effective_type || '').toString().toLowerCase();
                                const movedDown = !!(base && eff && base !== eff && eff !== 'none');
                                typeElem.classList.toggle('is-overflow-type', movedDown);
                            } catch (_) {}
                        }
                    }
                }
            } catch (_) {}
        }
        // After reallocation, update the displayed total credits for each
        // semester in the user interface. Each semester element has an id
        // (e.g., 's1') and resides within a container with class
        // 'container_semester' which contains a span showing the total.
        try {
            for (let i = 0; i < this.semesters.length; i++) {
                const sem = this.semesters[i];
                const semElem = document.getElementById(sem.id);
                if (semElem) {
                    // Traverse up to the nearest container_semester
                    let containerElem = semElem.closest && semElem.closest('.container_semester');
                    if (!containerElem) {
                        // Fallback manual traversal if closest isn't available
                        let parent = semElem.parentNode;
                        while (parent && !parent.classList.contains('container_semester')) {
                            parent = parent.parentNode;
                        }
                        containerElem = parent;
                    }
                    if (containerElem) {
                        const span = containerElem.querySelector('.total_credit_text span');
                        if (span) {
                            span.innerHTML = 'Total: ' + sem.totalCredit + ' credits';
                            try {
                                span.classList.toggle('is-overlimit', (sem.totalCredit || 0) > 20);
                            } catch (_) {}
                        }
                    }
                }
            }
        } catch (err) {
            // Ignore DOM errors in non-browser contexts
        }

        // If a double major is active on this curriculum, trigger
        // recalculation of effective types for the second major using
        // whatever course data array has been stored on the
        // curriculum instance.  This ensures that DM categories are
        // updated whenever the primary allocation runs (e.g., after
        // adding or removing courses/semesters).
        try {
            if (this.doubleMajor && Array.isArray(this.doubleMajorCourseData)) {
                this.recalcEffectiveTypesDouble(this.doubleMajorCourseData);
            }
        } catch (ex) {
            // ignore errors if DM recalc fails
        }

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
        // Update DOM to show both primary and double major types
        try {
            for (let i = 0; i < this.semesters.length; i++) {
                const sem = this.semesters[i];
                for (let j = 0; j < sem.courses.length; j++) {
                    const course = sem.courses[j];
                    if (!course || !course.id) continue;
                    const elem = document.getElementById(course.id);
                    if (!elem) continue;
                    const typeSpan = elem.querySelector('.course_type');
                    if (!typeSpan) continue;
                    const mainType = course.effective_type || (typeSpan.textContent && typeSpan.textContent.trim().toLowerCase());
                    const dmTypeLabel = course.effective_type_dm;
                    if (this.doubleMajor && dmTypeLabel) {
                        // Compose both types, capitalize each
                        const mt = (mainType === 'none' ? 'N/A' : (mainType || '').toString().toUpperCase());
                        const dt = (dmTypeLabel === 'none' ? 'N/A' : dmTypeLabel.toUpperCase());
                        try {
                            const baseMain = (course.category || '').toString().toLowerCase();
                            const effMain = (course.effective_type || '').toString().toLowerCase();
                            const movedDownMain = !!(baseMain && effMain && baseMain !== effMain && effMain !== 'none');
                            const baseDM = (course.categoryDM || '').toString().toLowerCase();
                            const effDM = (course.effective_type_dm || '').toString().toLowerCase();
                            const movedDownDM = !!(baseDM && effDM && baseDM !== effDM && effDM !== 'none');

                            const mainCls = movedDownMain ? 'is-overflow-type' : '';
                            const dmCls = movedDownDM ? 'is-overflow-type' : '';
                            // Types are controlled values (CORE/AREA/FREE/etc.). Render as spans so
                            // overflow coloring can be applied per-major independently.
                            typeSpan.innerHTML =
                                `<span class="course_type_part ct-main ${mainCls}">${mt}</span>` +
                                `<span class="ct-sep"> / </span>` +
                                `<span class="course_type_part ct-dm ${dmCls}">${dt}</span>`;
                        } catch (_) {
                            typeSpan.textContent = mt + ' / ' + dt;
                        }
                    } else {
                        // Only main type
                        typeSpan.textContent = (mainType === 'none' ? 'N/A' : (mainType || '').toString().toUpperCase());
                    }
                    // When showing combined main/DM types we color per-part; do not
                    // apply a single overflow class to the whole label.
                    try { typeSpan.classList.remove('is-overflow-type'); } catch (_) {}
                }
            }
        } catch (err) {
            // Ignore DOM errors
        }
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
        // Major-specific checks for double major
        const maj = this.doubleMajor;
        if (maj === 'CS') {
            // Check CS-specific requirements
            if (!this.hasCourse("SPS303")) return 11;
            // Any HUM satisfies it — see the main-major pass.
            if (!this.hasAnyCourse(HUM_ANY_LEVEL)) return 12;
            {
                let facultyCoursesCount = 0;
                let fensCoursesCount = 0;
                let mathCoursesCount = 0;
                for (let i = 0; i < this.semesters.length; i++) {
                    for (let a = 0; a < this.semesters[i].courses.length; a++) {
                        const course = this.semesters[i].courses[a];
                        if (course && course.effective_type_dm === 'none') continue;
                        if (course.Faculty_Course && course.Faculty_Course !== 'No') {
                            facultyCoursesCount++;
                            if (course.Faculty_Course === 'FENS') fensCoursesCount++;
                            if (course.Faculty_Course === 'FENS' && course.code.startsWith('MATH')) mathCoursesCount++;
                        }
                    }
                }
                if (facultyCoursesCount < 5) return 14;
                if (mathCoursesCount < 2) return 19;
                if (fensCoursesCount < 3) return 16;
            }
        } else if (maj === 'IE') {
            {
                let facultyCoursesCount = 0;
                let fensCoursesCount = 0;
                let mathCoursesCount = 0;
                for (let i = 0; i < this.semesters.length; i++) {
                    for (let a = 0; a < this.semesters[i].courses.length; a++) {
                        const course = this.semesters[i].courses[a];
                        if (course.Faculty_Course && course.Faculty_Course !== 'No') {
                            facultyCoursesCount++;
                            if (course.Faculty_Course === 'FENS') fensCoursesCount++;
                            if (course.Faculty_Course === 'FENS' && course.code.startsWith('MATH')) mathCoursesCount++;
                        }
                    }
                }
                if (facultyCoursesCount < 5) return 14;
                if (mathCoursesCount < 2) return 19;
                if (fensCoursesCount < 3) return 16;
            }
        } else if (maj === 'EE') {
            {
                let ee400LevelCredits = 0;
                for (let i = 0; i < this.semesters.length; i++) {
                    for (let a = 0; a < this.semesters[i].courses.length; a++) {
                        const course = this.semesters[i].courses[a];
                        if (course.code.startsWith('EE4') && course.categoryDM === 'Core') {
                            ee400LevelCredits += (typeof parseCreditValue === 'function')
                                ? parseCreditValue(course.SU_credit || '0')
                                : (parseFloat(course.SU_credit || '0') || 0);
                        }
                    }
                }
                if (ee400LevelCredits < 9) return 23;
                else {
                    let hasSpecificAreaCourse = false;
                    const specificAreaCourses = ['CS300','CS401','CS412','ME303','PHYS302','PHYS303'];
                    for (let i = 0; i < this.semesters.length && !hasSpecificAreaCourse; i++) {
                        for (let a = 0; a < this.semesters[i].courses.length; a++) {
                            const course = this.semesters[i].courses[a];
                            if (specificAreaCourses.includes(course.code) || (course.code.startsWith('EE48') && course.categoryDM === 'Area')) {
                                hasSpecificAreaCourse = true;
                                break;
                            }
                        }
                    }
                    if (!hasSpecificAreaCourse) return 24;
                }
            }
        } else if (maj === 'MAT') {
            {
                let facultyCoursesCount = 0;
                let fensCoursesCount = 0;
                let mathCoursesCount = 0;
                for (let i = 0; i < this.semesters.length; i++) {
                    for (let a = 0; a < this.semesters[i].courses.length; a++) {
                        const course = this.semesters[i].courses[a];
                        if (course.Faculty_Course && course.Faculty_Course !== 'No') {
                            facultyCoursesCount++;
                            if (course.Faculty_Course === 'FENS') fensCoursesCount++;
                            if (course.Faculty_Course === 'FENS' && course.code.startsWith('MATH')) mathCoursesCount++;
                        }
                    }
                }
                if (facultyCoursesCount < 5) return 14;
                if (mathCoursesCount < 2) return 19;
                if (fensCoursesCount < 3) return 16;
            }
        } else if (maj === 'BIO') {
            {
                let facultyCoursesCount = 0;
                let fensCoursesCount = 0;
                let mathCoursesCount = 0;
                for (let i = 0; i < this.semesters.length; i++) {
                    for (let a = 0; a < this.semesters[i].courses.length; a++) {
                        const course = this.semesters[i].courses[a];
                        if (course.Faculty_Course && course.Faculty_Course !== 'No') {
                            facultyCoursesCount++;
                            if (course.Faculty_Course === 'FENS') fensCoursesCount++;
                            if (course.Faculty_Course === 'FENS' && course.code.startsWith('MATH')) mathCoursesCount++;
                        }
                    }
                }
                if (facultyCoursesCount < 5) return 14;
                if (mathCoursesCount < 2) return 19;
                if (fensCoursesCount < 3) return 16;
            }
        } else if (maj === 'ME') {
            {
                const meEntryDM = parseInt(this.entryTermDM || '0', 10);
                if (!isNaN(meEntryDM) && meEntryDM >= 202501) {
                    if (!(this.hasCourse('CS404') || this.hasCourse('CS412'))) return 2;
                }

                let facultyCoursesCount = 0;
                let fensCoursesCount = 0;
                let mathCoursesCount = 0;
                for (let i = 0; i < this.semesters.length; i++) {
                    for (let a = 0; a < this.semesters[i].courses.length; a++) {
                        const course = this.semesters[i].courses[a];
                        if (course.Faculty_Course && course.Faculty_Course !== 'No') {
                            facultyCoursesCount++;
                            if (course.Faculty_Course === 'FENS') fensCoursesCount++;
                            if (course.Faculty_Course === 'FENS' && course.code.startsWith('MATH')) mathCoursesCount++;
                        }
                    }
                }
                if (facultyCoursesCount < 5) return 14;
                if (mathCoursesCount < 2) return 19;
                if (fensCoursesCount < 3) return 16;
            }
        } else if (maj === 'ECON') {
            {
                let hasMathRequirement = this.hasCourse('MATH201') || this.hasCourse('MATH202') || this.hasCourse('MATH204');
                if (!hasMathRequirement) return 25;
                let facultyCoursesCount = 0;
                let fassCount = 0;
                let areasCount = new Set();
                for (let i = 0; i < this.semesters.length; i++) {
                    for (let a = 0; a < this.semesters[i].courses.length; a++) {
                        const course = this.semesters[i].courses[a];
                        if (course.Faculty_Course && course.Faculty_Course !== 'No') {
                            facultyCoursesCount++;
                            if (course.Faculty_Course === 'FASS') fassCount++;
                            if (course.code.startsWith('CULT')) areasCount.add('CULT');
                            else if (course.code.startsWith('ECON')) areasCount.add('ECON');
                            else if (course.code.startsWith('HART')) areasCount.add('HART');
                            else if (course.code.startsWith('PSYCH')) areasCount.add('PSYCH');
                            else if (course.code.startsWith('SPS') || course.code.startsWith('POLS') || course.code.startsWith('IR')) areasCount.add('SPS/POLS/IR');
                            else if (course.code.startsWith('VA')) areasCount.add('VA');
                            else if (course.Faculty_Course === 'FENS') areasCount.add('FENS');
                            else if (course.Faculty_Course === 'SBS') areasCount.add('SBS');
                        }
                    }
                }
                if (facultyCoursesCount < 5) return 14;
                if (fassCount < 3) return 15;
                if (areasCount.size < 3) return 18;
                // SUIS: at most 2 Beginning/Basic level language courses may
                // count toward the free electives.
                if (countBasicLanguageInFree(this.semesters, 'effective_type_dm') > BASIC_LANGUAGE_LIMIT) return 40;
            }
        } else if (maj === 'MAN') {
            {
                let facultyCoursesCount = 0;
                let sbsCoursesCount = 0;
                for (let i = 0; i < this.semesters.length; i++) {
                    for (let a = 0; a < this.semesters[i].courses.length; a++) {
                        const course = this.semesters[i].courses[a];
                        if (course.Faculty_Course && course.Faculty_Course !== 'No') {
                            facultyCoursesCount++;
                            if (course.Faculty_Course === 'SBS') sbsCoursesCount++;
                        }
                    }
                }
                if (facultyCoursesCount < 5) return 14;
                if (sbsCoursesCount < 2) return 22;
                // Core electives requirement: 6 courses from 6 different areas
                let coreAreas = new Set();
                let coreCount = 0;
                for (let i = 0; i < this.semesters.length; i++) {
                    for (let a = 0; a < this.semesters[i].courses.length; a++) {
                        const course = this.semesters[i].courses[a];
                        const eff = (course.effective_type_dm || (course.categoryDM && course.categoryDM.toLowerCase()) || '').toLowerCase();
                        if (eff === 'core') {
                            coreCount++;
                            if (course.code.startsWith('ACC')) coreAreas.add('ACC');
                            else if (course.code.startsWith('FIN')) coreAreas.add('FIN');
                            else if (course.code.startsWith('MGMT')) coreAreas.add('MGMT');
                            else if (course.code.startsWith('MKTG')) coreAreas.add('MKTG');
                            else if (course.code.startsWith('OPIM')) coreAreas.add('OPIM');
                            else if (course.code.startsWith('ORG')) coreAreas.add('ORG');
                        }
                    }
                }
                if (coreAreas.size < 6) return 35;

                // Area electives requirement: 5 courses from 5 different areas
                let areaAreas = new Set();
                let areaCount = 0;
                for (let i = 0; i < this.semesters.length; i++) {
                    for (let a = 0; a < this.semesters[i].courses.length; a++) {
                        const course = this.semesters[i].courses[a];
                        const eff = (course.effective_type_dm || (course.categoryDM && course.categoryDM.toLowerCase()) || '').toLowerCase();
                        if (eff === 'area') {
                            areaCount++;
                            if (course.code.startsWith('ACC')) areaAreas.add('ACC');
                            else if (course.code.startsWith('FIN')) areaAreas.add('FIN');
                            else if (course.code.startsWith('MKTG')) areaAreas.add('MKTG');
                            else if (course.code.startsWith('OPIM')) areaAreas.add('OPIM');
                            else if (course.code.startsWith('ORG')) areaAreas.add('ORG');
                        }
                    }
                }
                if (areaAreas.size < 5) return 36;

                // SUIS (MAN free electives) — see the main-major copy of this
                // rule in canGraduate() for the quoted text.
                let freeElectiveCredits = 0;
                let fassFensCredits = 0;

                for (let i = 0; i < this.semesters.length; i++) {
                    for (let a = 0; a < this.semesters[i].courses.length; a++) {
                        const course = this.semesters[i].courses[a];
                        const eff = (course.effective_type_dm || (course.categoryDM && course.categoryDM.toLowerCase()) || '').toLowerCase();
                        if (eff === 'free') {
                            const c = (typeof parseCreditValue === 'function')
                                ? parseCreditValue(course.SU_credit || '0')
                                : (parseFloat(course.SU_credit || '0') || 0);
                            freeElectiveCredits += c;
                            // "offered by FASS or FENS" = the offering faculty.
                            if (course.Faculty === 'FASS' || course.Faculty === 'FENS') {
                                fassFensCredits += c;
                            }
                        }
                    }
                }

                // Check Free Electives requirements
                // The 26-credit condition is redundant with the generic free
                // check (MAN's `free` requirement IS 26), so it never fires —
                // kept as a guard in case the two ever diverge.
                if (freeElectiveCredits < 26) return 37;
                if (fassFensCredits < 9) return 37;
                // Its own flag: 37's message only describes the FASS/FENS rule,
                // so reporting the language cap as 37 told students the wrong
                // thing entirely.
                if (countBasicLanguageInFree(this.semesters, 'effective_type_dm') > BASIC_LANGUAGE_LIMIT) return 40;
            }
        } else if (maj === 'PSIR') {
            {
                let facultyCoursesCount = 0;
                let fassCoursesCount = 0;
                let areasCount = new Set();
                for (let i = 0; i < this.semesters.length; i++) {
                    for (let a = 0; a < this.semesters[i].courses.length; a++) {
                        const course = this.semesters[i].courses[a];
                        if (course.Faculty_Course && course.Faculty_Course !== 'No') {
                            facultyCoursesCount++;
                            if (course.Faculty_Course === 'FASS') fassCoursesCount++;
                            if (course.code.startsWith('CULT')) areasCount.add('CULT');
                            else if (course.code.startsWith('ECON')) areasCount.add('ECON');
                            else if (course.code.startsWith('HART')) areasCount.add('HART');
                            else if (course.code.startsWith('PSY')) areasCount.add('PSYCH');
                            else if (course.code.startsWith('SPS') || course.code.startsWith('POLS') || course.code.startsWith('IR')) areasCount.add('SPS/POLS/IR');
                            else if (course.code.startsWith('VA')) areasCount.add('VA');
                            else if (course.Faculty_Course === 'FENS') areasCount.add('FENS');
                            else if (course.Faculty_Course === 'SBS') areasCount.add('SBS');
                        }
                    }
                }
                if (facultyCoursesCount < 5) return 14;
                if (fassCoursesCount < 3) return 15;
                if (areasCount.size < 3) return 18;

                // Core Electives I (Political Science)
                let coreElectivesICount = 0;
                const coreElectivesIPool = ['LAW312', 'POLS251', 'POLS353', 'POLS404', 'POLS455', 'POLS483', 'POLS493', 'SOC201'];
                for (let i = 0; i < this.semesters.length; i++) {
                    for (let a = 0; a < this.semesters[i].courses.length; a++) {
                        const course = this.semesters[i].courses[a];
                        const courseCode = course.code || ((course.Major || '') + (course.Code || ''));
                        if (coreElectivesIPool.includes(courseCode)) {
                            coreElectivesICount += (typeof parseCreditValue === 'function')
                                ? parseCreditValue(course.SU_credit || '0')
                                : (parseFloat(course.SU_credit || '0') || 0);
                        }
                    }
                }
                if (coreElectivesICount < 12) return 33;

                // Core Electives II (International Relations)
                let coreElectivesIICount = 0;
                const coreElectivesIIPool = ['CONF400', 'IR301', 'IR342', 'IR391', 'IR394', 'IR405', 'IR489', 'LAW311', 'POLS492'];
                for (let i = 0; i < this.semesters.length; i++) {
                    for (let a = 0; a < this.semesters[i].courses.length; a++) {
                        const course = this.semesters[i].courses[a];
                        const courseCode = course.code || ((course.Major || '') + (course.Code || ''));
                        if (coreElectivesIIPool.includes(courseCode)) {
                            coreElectivesIICount += (typeof parseCreditValue === 'function')
                                ? parseCreditValue(course.SU_credit || '0')
                                : (parseFloat(course.SU_credit || '0') || 0);
                        }
                    }
                }
                if (coreElectivesIICount < 12) return 34;
                // SUIS: at most 2 Beginning/Basic level language courses may
                // count toward the free electives.
                if (countBasicLanguageInFree(this.semesters, 'effective_type_dm') > BASIC_LANGUAGE_LIMIT) return 40;
            }
        } else if (maj === 'PSY') {
            {
                let hasPhilosophy = this.hasCourse('PHIL300') || this.hasCourse('PHIL301');
                if (!hasPhilosophy) return 26;
                let facultyCoursesCount = 0;
                let fassCoursesCount = 0;
                let areasCount = new Set();
                for (let i = 0; i < this.semesters.length; i++) {
                    for (let a = 0; a < this.semesters[i].courses.length; a++) {
                        const course = this.semesters[i].courses[a];
                        if (course.Faculty_Course && course.Faculty_Course !== 'No') {
                            facultyCoursesCount++;
                            if (course.Faculty_Course === 'FASS') fassCoursesCount++;
                            if (course.code.startsWith('CULT')) areasCount.add('CULT');
                            else if (course.code.startsWith('ECON')) areasCount.add('ECON');
                            else if (course.code.startsWith('HART')) areasCount.add('HART');
                            else if (course.code.startsWith('PSY')) areasCount.add('PSYCH');
                            else if (course.code.startsWith('SPS') || course.code.startsWith('POLS') || course.code.startsWith('IR')) areasCount.add('SPS/POLS/IR');
                            else if (course.code.startsWith('VA')) areasCount.add('VA');
                            else if (course.Faculty_Course === 'FENS') areasCount.add('FENS');
                            else if (course.Faculty_Course === 'SBS') areasCount.add('SBS');
                        }
                    }
                }
                if (facultyCoursesCount < 5) return 14;
                if (fassCoursesCount < 3) return 15;
                if (areasCount.size < 3) return 18;

                // SUIS (PSY): area electives need >= 2 PSY 4XX-level courses;
                // free electives may count at most 2 basic language courses.
                // See the main-major PSY block for the quoted text.
                let psy4xxAreaCountDM = 0;
                for (let i = 0; i < this.semesters.length; i++) {
                    for (let a = 0; a < this.semesters[i].courses.length; a++) {
                        const course = this.semesters[i].courses[a];
                        if ((course.effective_type_dm || '').toLowerCase() === 'area'
                            && isPsyAdvancedCode(course.code)) psy4xxAreaCountDM++;
                    }
                }
                if (psy4xxAreaCountDM < 2) return 39;
                if (countBasicLanguageInFree(this.semesters, 'effective_type_dm') > BASIC_LANGUAGE_LIMIT) return 40;

                // Core electives requirement: 7 courses. Redundant with the
                // generic core check above (core = 21 credits and every pool
                // course is 3cr, so 21 credits IS 7 courses) and therefore
                // unreachable — but it had no message at all, which rendered a
                // bare "Error code 77" to the student. Kept with a message
                // rather than removed, in case the pool ever gains a course
                // whose credit value breaks that equivalence.
                let psyCoreCount = 0;
                for (let i = 0; i < this.semesters.length; i++) {
                    for (let a = 0; a < this.semesters[i].courses.length; a++) {
                        const course = this.semesters[i].courses[a];
                        if (course.categoryDM === 'Core') {
                            psyCoreCount++;
                        }
                    }
                }
                if (psyCoreCount < 7) return 77;
            }
        } else if (maj === 'VACD') {
            {
                let facultyCoursesCount = 0;
                let fassCoursesCount = 0;
                let areasCount = new Set();
                for (let i = 0; i < this.semesters.length; i++) {
                    for (let a = 0; a < this.semesters[i].courses.length; a++) {
                        const course = this.semesters[i].courses[a];
                        if (course.Faculty_Course && course.Faculty_Course !== 'No') {
                            facultyCoursesCount++;
                            if (course.Faculty_Course === 'FASS') fassCoursesCount++;
                            if (course.code.startsWith('CULT')) areasCount.add('CULT');
                            else if (course.code.startsWith('ECON')) areasCount.add('ECON');
                            else if (course.code.startsWith('HART')) areasCount.add('HART');
                            else if (course.code.startsWith('PSY')) areasCount.add('PSYCH');
                            else if (course.code.startsWith('SPS') || course.code.startsWith('POLS') || course.code.startsWith('IR')) areasCount.add('SPS/POLS/IR');
                            else if (course.code.startsWith('VA')) areasCount.add('VA');
                            else if (course.Faculty_Course === 'FENS') areasCount.add('FENS');
                            else if (course.Faculty_Course === 'SBS') areasCount.add('SBS');
                        }
                    }
                }
                if (facultyCoursesCount < 5) return 14;
                if (fassCoursesCount < 3) return 15;
                if (areasCount.size < 3) return 18;

                // Core Electives I (Art/Design History Courses) for VACD
                let coreElectivesICount = 0;
                const coreElectivesIPool = ['HART292', 'HART293', 'HART380', 'HART413', 'HART426', 'VA315', 'VA420', 'VA430'];
                for (let i = 0; i < this.semesters.length; i++) {
                    for (let a = 0; a < this.semesters[i].courses.length; a++) {
                        const course = this.semesters[i].courses[a];
                        const courseCode = course.code || ((course.Major || '') + (course.Code || ''));
                        const eff = (course.effective_type_dm || (course.categoryDM && course.categoryDM.toLowerCase()) || '').toLowerCase();
                        if (eff === 'core' && coreElectivesIPool.includes(courseCode)) {
                            coreElectivesICount += (typeof parseCreditValue === 'function')
                                ? parseCreditValue(course.SU_credit || '0')
                                : (parseFloat(course.SU_credit || '0') || 0);
                        }
                    }
                }
                if (coreElectivesICount < 9) return 30;

                // Core Electives II (Skill Courses) for VACD
                let coreElectivesIICount = 0;
                const coreElectivesIIPool = ['VA202', 'VA204', 'VA234', 'VA302', 'VA304', 'VA402', 'VA404'];
                const pairKeyByCode = {
                    VA302: 'VA302|VA304',
                    VA304: 'VA302|VA304',
                    VA402: 'VA402|VA404',
                    VA404: 'VA402|VA404',
                };
                const seenPairKeys = new Set();
                for (let i = 0; i < this.semesters.length; i++) {
                    for (let a = 0; a < this.semesters[i].courses.length; a++) {
                        const course = this.semesters[i].courses[a];
                        const courseCode = course.code || ((course.Major || '') + (course.Code || ''));
                        const eff = (course.effective_type_dm || (course.categoryDM && course.categoryDM.toLowerCase()) || '').toLowerCase();
                        if (eff === 'core' && coreElectivesIIPool.includes(courseCode)) {
                            const pairKey = pairKeyByCode[courseCode];
                            if (pairKey) {
                                if (seenPairKeys.has(pairKey)) continue;
                                seenPairKeys.add(pairKey);
                            }
                            coreElectivesIICount += (typeof parseCreditValue === 'function')
                                ? parseCreditValue(course.SU_credit || '0')
                                : (parseFloat(course.SU_credit || '0') || 0);
                        }
                    }
                }
                if (coreElectivesIICount < 12) return 31;
                // SUIS: at most 2 Beginning/Basic level language courses may
                // count toward the free electives.
                if (countBasicLanguageInFree(this.semesters, 'effective_type_dm') > BASIC_LANGUAGE_LIMIT) return 40;
            }
        } else if (maj === 'DSA') {
            {
                let facultyCoursesCount = 0;
                let fensCoursesCount = 0;
                let fassCoursesCount = 0;
                let sbsCoursesCount = 0;
                for (let i = 0; i < this.semesters.length; i++) {
                    for (let a = 0; a < this.semesters[i].courses.length; a++) {
                        const course = this.semesters[i].courses[a];
                        if (course.Faculty_Course && course.Faculty_Course !== 'No') {
                            facultyCoursesCount++;
                            if (course.Faculty_Course === 'FENS') fensCoursesCount++;
                            else if (course.Faculty_Course === 'FASS') fassCoursesCount++;
                            else if (course.Faculty_Course === 'SBS') sbsCoursesCount++;
                        }
                    }
                }
                if (facultyCoursesCount < 5) return 14;
                if (fensCoursesCount < 1) return 20;
                if (fassCoursesCount < 1) return 21;
                if (sbsCoursesCount < 1) return 22;
                // Core electives requirements: at least 27 SU credits with at least 3 courses from each faculty
                let fensCoreCount = 0;
                let fassCoreCount = 0;
                let sbsCoreCount = 0;
                for (let i = 0; i < this.semesters.length; i++) {
                    for (let a = 0; a < this.semesters[i].courses.length; a++) {
                        const course = this.semesters[i].courses[a];
                        if (course.categoryDM === 'Core') {
                            // The OFFERING faculty, not the faculty-course pool
                            // marker -- see the main-major copy.
                            if (course.Faculty === 'FENS') fensCoreCount++;
                            else if (course.Faculty === 'FASS') fassCoreCount++;
                            else if (course.Faculty === 'SBS') sbsCoreCount++;
                        }
                    }
                }
                // Each faculty must have at least 3 core courses. Report the same
                // flags the main-major pass does: this returned 18 for all three,
                // whose message ("faculty courses must span at least 3 different
                // areas") describes an unrelated rule.
                if (fensCoreCount < 3) return 27;
                if (fassCoreCount < 3) return 28;
                if (sbsCoreCount < 3) return 29;
                // Sum of SU credits from core courses for DSA must be at least 27
                let coreSUCredits = 0;
                for (let i = 0; i < this.semesters.length; i++) {
                    for (let a = 0; a < this.semesters[i].courses.length; a++) {
                        const course = this.semesters[i].courses[a];
                        if (course.categoryDM === 'Core') {
                            coreSUCredits += (typeof parseCreditValue === 'function')
                                ? parseCreditValue(course.SU_credit || '0')
                                : (parseFloat(course.SU_credit || '0') || 0);
                        }
                    }
                }
                if (coreSUCredits < 27) return 18;
            }
        }
        return 0;
    };

    // end of s_curriculum constructor
}

