// Data-driven graduation requirements and requirement-group progress.
(function installRequirementEngine(root) {
    'use strict';

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
    // of plain-data rule descriptors generated from its requirement record. evaluateRules walks the
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

    // Count distinct eligible course codes from a named pool. A repeated attempt
    // of the same course can appear in more than one semester, but it must not
    // satisfy a requirement for two different HUM courses twice.
    function countDistinctPoolCourses(semesters, pool, isEligible) {
        const allowed = new Set((pool || []).map(canonicalCourseCode));
        const seen = new Set();
        forEachCourse(semesters, (course) => {
            const code = canonicalCourseCode(course.code);
            if (allowed.has(code)) seen.add(code);
        }, isEligible);
        return seen.size;
    }

    // type -> predicate(ctx, rule) returning TRUE when the requirement is SATISFIED.
    // `ctx` = { curr, semesters, fields, entryTerm }.
    const RULE_EVALUATORS = {
        // A specific course is present.
        hasCourse: (ctx, r) => hasDegreeEligibleCourse(ctx.semesters, r.code, ctx.isEligible),
        // At least one of a list is present ("one of the following").
        hasAny: (ctx, r) => hasAnyDegreeEligibleCourse(ctx.semesters, r.codes, ctx.isEligible),
        // At least `min` different eligible course codes from a list are present.
        hasDistinctAny: (ctx, r) => countDistinctPoolCourses(
            ctx.semesters, r.codes, ctx.isEligible,
        ) >= r.min,
        // A faculty-course pool count meets its minimum (see tallyFacultyCourses).
        facultyCount: (ctx, r) => tallyFacultyCourses(ctx.semesters, ctx.fields.effective, ctx.isEligible)[r.pool] >= r.min,
        // Faculty courses span at least `min` distinct areas (flag 18).
        facultyAreas: (ctx, r) => tallyFacultyAreas(ctx.semesters, ctx.fields.effective, ctx.isEligible).size >= r.min,
        // At most `max` basic/beginning language courses among the free electives.
        languageCap: (ctx, r) => countBasicLanguageInFree(
            ctx.semesters, ctx.fields.effective, ctx.isEligible, ctx.fields.languageLevel,
        ) <= r.max,
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

    // The HUM university requirement is fully described by scraped requirement
    // data. `humRequired` is the number of distinct HUM courses. `humRule: any`
    // accepts that many courses from either level; `one200One300` requires one
    // course from each level. Unknown or missing policy is not inferred from the
    // count; requirement-record validation rejects it before graduation runs.
    function humRules(humRequired, humRule) {
        const required = Number(humRequired);
        const rule = String(humRule || '');
        if (required === 2 && rule === 'one200One300') {
            return [
                { type: 'hasAny', codes: HUM_200_LEVEL, flag: 12, suis: 'University Courses (HUM 2XX)' },
                { type: 'hasAny', codes: HUM_300_LEVEL, flag: 13, suis: 'University Courses (HUM 3XX)' },
            ];
        }
        if ((required === 1 || required === 2) && rule === 'any') {
            return [{
                type: 'hasDistinctAny',
                codes: HUM_ANY_LEVEL,
                min: required,
                flag: 12,
                suis: `University Courses (${required} HUM)`,
            }];
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
                    const current = countBasicLanguageInFree(
                        ctx.semesters, fields.effective, ctx.isEligible, fields.languageLevel,
                    );
                    let excluded = 0;
                    forEachCourse(ctx.semesters, (course) => {
                        if (course[fields.exclusionReason] === BASIC_LANGUAGE_EXCLUSION_REASON) excluded++;
                    }, ctx.isEligible);
                    const note = excluded > 0
                        ? `${excluded} additional basic language course${excluded === 1 ? '' : 's'} excluded from degree credit`
                        : undefined;
                    out.push({ ...base, current, target: g.max, unit: 'course', isCap: true,
                        ok: current <= g.max, ...(note ? { note } : {}) });
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
    // programs. Always prefixed by the shared university rules + the HUM rule.
    function graduationRulesFor(major, req) {
        const r = req || {};
        const shared = UNIVERSITY_RULES.concat(humRules(r.humRequired, r.humRule));
        if (r.groups) {
            return shared.concat(groupRules(r.groups, r.facultyReq));
        }
        if (r.facultyReq) {
            return shared.concat(facultyRules(r.facultyReq));
        }
        return shared;
    }

    const namespace = root.SurriculumModules || (root.SurriculumModules = {});
    const api = Object.freeze({
        tallyFacultyCourses,
        tallyFacultyAreas,
        sumPoolCredits,
        evaluateRules,
        facultyRules,
        groupRules,
        facultyProgress,
        groupProgressFor,
        graduationRulesFor,
    });
    namespace.requirementEngine = api;
    Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis);
