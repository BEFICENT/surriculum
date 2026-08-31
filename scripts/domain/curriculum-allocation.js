// Curriculum allocation policy shared by main-major, double-major, progress,
// and Smart Sort simulation passes. It mutates only the explicit course and
// semester objects supplied by callers.
(function installCurriculumAllocation(root) {
    'use strict';

    // Kept private here because alternative-policy evaluation needs normalized
    // codes without depending on the stateful curriculum constructor.
    function normalizeAllocationCourseCode(code) {
        return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
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
    // count toward free electives. Keep the complete known Sabanci catalog set
    // explicit: several historical languages disappeared from newer program
    // catalogs, which made a title-only/current-catalog check silently miss them.
    // Intermediate/higher courses (for example FRE130/140 and TUR201) are NOT
    // capped. Exchange placeholder courses use the reviewed `Language_Level`
    // metadata instead; LANG by itself never implies a level.
    const BASIC_LANGUAGE_COURSES = new Set([
        'ARA110', 'ARA120', 'CHI110', 'CHI120', 'FRE110', 'FRE120',
        'GER110', 'GER120', 'ITA110', 'ITA120', 'JAP110', 'JAP120',
        'LAT110', 'LAT120', 'PERS110', 'PERS120', 'RUS110', 'RUS120',
        'SPA110', 'SPA120', 'TUR101', 'TUR102',
    ]);

    const BASIC_LANGUAGE_EXCLUSION_REASON = 'Not counted — basic-language limit';
    const LANGUAGE_LEVEL_REVIEW_REASON = 'Not counted — review language level';

    function normalizedLanguageLevel(value) {
        const level = String(value || '').trim().toLowerCase();
        return level === 'basic' || level === 'other' ? level : '';
    }

    // `record` is the selected program's catalog/custom-course record. A trusted
    // built-in code always wins; otherwise only an explicit reviewed level may
    // classify a foreign LANG course as basic. Missing metadata remains unknown.
    function isBasicLanguageCourse(course, record, languageLevelField) {
        const code = normalizeAllocationCourseCode(course && course.code);
        if (BASIC_LANGUAGE_COURSES.has(code)) return true;
        if (record) return normalizedLanguageLevel(record.Language_Level) === 'basic';
        const field = languageLevelField || 'Language_Level';
        return normalizedLanguageLevel(course && course[field]) === 'basic';
    }

    function isExactExchangeLanguageCourse(course, record) {
        const recordCode = record
            ? String(record.Major || '') + String(record.Code || '')
            : '';
        const code = normalizeAllocationCourseCode(recordCode || (course && course.code));
        const match = code.match(/^([A-Z]+)(\d[A-Z0-9]*)$/);
        return !!match && match[1] === 'LANG';
    }

    // Transcript import persists its provisional custom record before opening the
    // review dialog so the transcript course itself is never lost. If that dialog
    // is interrupted by a reload/page close, fail closed: an exact LANG course is
    // not degree-eligible until the user explicitly reviews its level.
    function languageCourseNeedsLevelReview(course, record) {
        return !!record
            && isExactExchangeLanguageCourse(course, record)
            && normalizedLanguageLevel(record.Language_Level) === '';
    }

    function languageCapForRequirements(req) {
        const groups = req && Array.isArray(req.groups) ? req.groups : [];
        for (let i = 0; i < groups.length; i++) {
            if (groups[i] && groups[i].rule === 'languageCap') {
                const max = Number(groups[i].max);
                return Number.isFinite(max) && max >= 0 ? max : null;
            }
        }
        return null;
    }

    // University Courses HUM pools — identical in every major's catalog.
    const HUM_200_LEVEL = ['HUM201', 'HUM202', 'HUM207'];
    const HUM_300_LEVEL = ['HUM311', 'HUM312', 'HUM317', 'HUM321', 'HUM322', 'HUM371'];
    const HUM_ANY_LEVEL = HUM_200_LEVEL.concat(HUM_300_LEVEL);

    // These pools support the data-driven `humRequired` graduation rule. Programs
    // requiring two HUM courses need one 2xx and one 3xx; programs requiring one
    // accept either pool.

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
    function countBasicLanguageInFree(semesters, effField, isEligible, languageLevelField) {
        const eligible = isEligible || isDegreeEligibleCourse;
        let count = 0;
        for (let i = 0; i < semesters.length; i++) {
            const courses = semesters[i].courses || [];
            for (let j = 0; j < courses.length; j++) {
                const course = courses[j];
                if (!course || !eligible(course, semesters[i])) continue;
                if (String(course[effField] || '').toLowerCase() !== 'free') continue;
                if (isBasicLanguageCourse(course, null, languageLevelField)) count++;
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
                            if (!codes.includes(normalizeAllocationCourseCode(course.code))) return;
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
                        if (normalizeAllocationCourseCode(c.code) === 'MATH212') excluded.add(c);
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
        languageLevel: 'Language_Level',
        exclusionReason: 'degreeExclusionReason',
        total: {
            core: 'totalCore', area: 'totalArea', free: 'totalFree',
            required: 'totalRequired', university: 'totalUniversity',
        },
    };
    const DM_FIELDS = {
        category: 'categoryDM',
        effective: 'effective_type_dm',
        languageLevel: 'Language_LevelDM',
        exclusionReason: 'degreeExclusionReasonDM',
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
            languageLevel: key + '_language_level',
            exclusionReason: key + '_exclusion_reason',
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

    const namespace = root.SurriculumModules || (root.SurriculumModules = {});
    const api = Object.freeze({
        BASIC_LANGUAGE_EXCLUSION_REASON,
        LANGUAGE_LEVEL_REVIEW_REASON,
        HUM_200_LEVEL,
        HUM_300_LEVEL,
        HUM_ANY_LEVEL,
        MAIN_FIELDS,
        DM_FIELDS,
        normalizedLanguageLevel,
        isBasicLanguageCourse,
        languageCourseNeedsLevelReview,
        languageCapForRequirements,
        isPsyAdvancedCode,
        selectCorePools,
        countBasicLanguageInFree,
        collectAltPairExtras,
        mathAlternativeSkipPredicate,
        allocateCascade,
        resolveAlternativeRules,
        progressAllocationFields,
        creditOfCourse,
        recomputeCategoryTotals,
        applyManDiversity,
    });
    namespace.curriculumAllocation = api;

    Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis);
