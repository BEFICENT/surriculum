// Browser adapter and cache for the pure suggestion-ranking policy.
// Existing Planner/Scheduler consumers keep their window-level compatibility API.
(function installCourseSuggestionScorer(root) {
    'use strict';

    const COURSE_SUGGESTION_CATALOG_IDS = new WeakMap();
    let courseSuggestionCatalogId = 0;
    let courseSuggestionScoreCache = null;

    function courseSuggestionCatalogToken(value) {
        if (!value || (typeof value !== 'object' && typeof value !== 'function')) return 'none:0';
        let id = COURSE_SUGGESTION_CATALOG_IDS.get(value);
        if (!id) {
            id = ++courseSuggestionCatalogId;
            COURSE_SUGGESTION_CATALOG_IDS.set(value, id);
        }
        return String(id) + ':' + (Array.isArray(value) ? value.length : 0);
    }

    // Cheap invalidation key for scorer reuse. It deliberately includes canonical
    // semester identity and ordered course state, so direct model changes in tests
    // and legacy integrations remain safe when they directly edit semester state.
    // Catalog identity/length and the plan revision cover normal program, admit-term,
    // and custom-course refreshes without hashing hundreds of records. Integrations
    // that edit a catalog record in place must request a plan save to turn revision.
    function getCourseSuggestionScorerKey(opts) {
        try {
            if (typeof window === 'undefined') return 'unavailable';
            const cur = window.curriculum || null;
            const scoringOptions = opts && typeof opts === 'object' ? opts : {};
            const beforeTarget = scoringOptions.progressPolicy === 'before-target'
                || scoringOptions.schedulerPreviousOnly === true;
            const explicitTarget = String(scoringOptions.targetTermCode || '').trim();
            const legacyTarget = scoringOptions.schedulerPreviousOnly === true
                ? String(window.currentTermCode || '').trim() : '';
            const rawTarget = explicitTarget || legacyTarget;
            const target = /^\d{4}(01|02|03)$/.test(rawTarget)
                ? rawTarget : ('invalid:' + rawTarget);
            const normalize = (value) => String(value || '').toUpperCase().replace(/\s+/g, '');
            const termIdentity = (semester) => {
                let canonical = '';
                try { canonical = String(semesterTermCode(semester) || ''); } catch (_) {}
                return [
                    canonical,
                    String(semester && semester.termCode || ''),
                    String(semester && semester.termName || ''),
                    String(semester && semester.date || ''),
                    String(semester && semester.term || ''),
                ].join('~');
            };
            const semesterSignature = cur && Array.isArray(cur.semesters)
                ? cur.semesters.map((semester) => {
                    const courses = semester && Array.isArray(semester.courses) ? semester.courses : [];
                    const rows = courses.map((course) => [
                        normalize(course && course.code),
                        String(course && course.grade || '').toUpperCase(),
                        String(course && course.gradingBasis || '').toLowerCase(),
                        String(course && course.category || '').toLowerCase(),
                        String(course && course.categoryDM || '').toLowerCase(),
                    ].join('~'));
                    return termIdentity(semester) + '[' + rows.join(',') + ']';
                }).join(';') : '';
            const minors = cur && Array.isArray(cur.minors) ? cur.minors.slice().sort() : [];
            const minorCatalogs = [];
            if (cur && cur.minorCourseDataByCode) {
                minors.forEach((minor) => {
                    minorCatalogs.push(minor + ':' + courseSuggestionCatalogToken(
                        cur.minorCourseDataByCode[minor],
                    ));
                });
            }
            const mainCatalog = (typeof course_data !== 'undefined' && Array.isArray(course_data))
                ? course_data : null;
            let planRevision = 0;
            try {
                const storage = window.planStorage;
                if (storage && typeof storage.getChangeRevision === 'function') {
                    planRevision = Number(storage.getChangeRevision()) || 0;
                }
            } catch (_) {}
            return [
                beforeTarget ? 'before-target' : 'all-plan',
                target,
                planRevision,
                cur ? String(cur.major || '') : '',
                cur ? String(cur.entryTerm || '') : '',
                cur ? String(cur.doubleMajor || '') : '',
                cur ? String(cur.entryTermDM || '') : '',
                minors.join(','),
                courseSuggestionCatalogToken(mainCatalog),
                courseSuggestionCatalogToken(cur && cur.primaryCourseData),
                courseSuggestionCatalogToken(cur && cur.doubleMajorCourseData),
                minorCatalogs.join(','),
                semesterSignature,
            ].join('|');
        } catch (_) {
            return 'unavailable';
        }
    }

    const EMPTY_COURSE_SUGGESTION_SCORER = Object.freeze({
        key: 'unavailable',
        available: false,
        progressPolicy: 'unavailable',
        targetTermCode: '',
        score: () => 0,
    });

    // Build one immutable, term-scoped scorer for a complete render pass. Planner
    // and Scheduler can then rank hundreds of candidates without re-running the
    // curriculum allocator for every course. The arithmetic itself lives in the
    // pure scripts/domain/suggestion-ranking.js module.
    function buildCourseSuggestionScorer(opts) {
        try {
            if (typeof window === 'undefined') return EMPTY_COURSE_SUGGESTION_SCORER;
            const ranking = window.suggestionRanking;
            if (!ranking
                || typeof ranking.canonicalizeSuggestionCode !== 'function'
                || typeof ranking.buildSuggestionRecordMap !== 'function'
                || typeof ranking.scoreSuggestionCourse !== 'function') {
                return EMPTY_COURSE_SUGGESTION_SCORER;
            }
            const cur = window.curriculum || null;
            const canonicalize = ranking.canonicalizeSuggestionCode;

            const parseNum = (v) => {
                const n = parseFloat(v || '0');
                return isFinite(n) ? n : 0;
            };
            const lookupReq = (majorCode, termCode) => {
                const allReq = (typeof globalThis !== 'undefined' && globalThis.requirements)
                    ? globalThis.requirements
                    : (window.requirements ? window.requirements : {});
                if (!majorCode) return {};
                if (typeof globalThis !== 'undefined' && typeof globalThis.getRequirementRecord === 'function') {
                    return globalThis.getRequirementRecord(majorCode, termCode) || {};
                }
                if (termCode && allReq && allReq[termCode] && allReq[termCode][majorCode]) return allReq[termCode][majorCode];
                if (allReq && allReq[majorCode]) return allReq[majorCode];
                return {};
            };
            const isEngineeringMajor = (majorCode, termCode) => {
                const req = lookupReq(majorCode, termCode) || {};
                return parseNum(req.engineering) > 0;
            };

            const scoringOptions = opts && typeof opts === 'object' ? opts : {};
            const beforeTarget = scoringOptions.progressPolicy === 'before-target'
                || scoringOptions.schedulerPreviousOnly === true;
            const progressTermCode = (() => {
                try {
                    const explicit = String(scoringOptions.targetTermCode || '').trim();
                    const legacy = scoringOptions.schedulerPreviousOnly === true
                        ? String(window.currentTermCode || '').trim() : '';
                    const value = explicit || legacy;
                    return /^\d{4}(01|02|03)$/.test(value) ? Number(value) : 0;
                } catch (_) {
                    return 0;
                }
            })();
            if (beforeTarget && !progressTermCode) {
                return Object.freeze({
                    key: getCourseSuggestionScorerKey(scoringOptions),
                    available: false,
                    progressPolicy: 'before-target',
                    targetTermCode: '',
                    score: () => 0,
                });
            }
            const semesterTermNumbers = (() => {
                const map = new Map();
                try {
                    if (!beforeTarget || !progressTermCode) return map;
                    const semesters = cur && Array.isArray(cur.semesters) ? cur.semesters : [];
                    for (let i = 0; i < semesters.length; i++) {
                        const semester = semesters[i];
                        const codeN = parseInt(String(semesterTermCode(semester) || ''), 10) || 0;
                        if (semester && codeN) map.set(semester, codeN);
                    }
                } catch (_) {}
                return map;
            })();
            const includeSemester = (sem) => {
                try {
                    if (!beforeTarget) return true;
                    // A caller that explicitly requests destination-term progress
                    // must never fall back to the whole plan when the term is bad.
                    if (!progressTermCode) return false;
                    const code = sem && semesterTermNumbers.has(sem) ? semesterTermNumbers.get(sem) : 0;
                    if (!code) return false;
                    return code < progressTermCode;
                } catch (_) {
                    return true;
                }
            };

            const scopedProgress = (() => {
                const out = { main: null, dm: null };
                if (!beforeTarget || !progressTermCode || !cur) return out;
                try {
                    if (typeof cur.getProgramProgressBeforeTermViews === 'function') {
                        const views = cur.getProgramProgressBeforeTermViews(
                            String(progressTermCode),
                            { includeCandidateImpacts: true },
                        );
                        out.main = views && views.main ? views.main : null;
                        out.dm = views && views.dm ? views.dm : null;
                    } else if (typeof cur.getProgramProgressBeforeTerm === 'function') {
                        out.main = cur.getProgramProgressBeforeTerm('main', String(progressTermCode));
                        if (cur.doubleMajor) {
                            out.dm = cur.getProgramProgressBeforeTerm('dm', String(progressTermCode));
                        }
                    }
                } catch (_) {}
                return out;
            })();

            const currentSciEng = (which) => {
                const scoped = which === 'dm' ? scopedProgress.dm : scopedProgress.main;
                if (scoped && scoped.available && scoped.totals) {
                    return {
                        sci: parseNum(scoped.totals.science),
                        eng: parseNum(scoped.totals.engineering),
                    };
                }
                let sci = 0;
                let eng = 0;
                try {
                    if (cur && Array.isArray(cur.semesters)) {
                        for (let i = 0; i < cur.semesters.length; i++) {
                            const sem = cur.semesters[i];
                            if (!includeSemester(sem)) continue;
                            // The existing full-plan policy uses the shared generic
                            // science/engineering totals for both program contexts.
                            sci += parseNum(sem && sem.totalScience);
                            eng += parseNum(sem && sem.totalEngineering);
                        }
                    }
                } catch (_) {}
                return { sci, eng };
            };

            const currentMajReqUni = (which) => {
                const scoped = which === 'dm' ? scopedProgress.dm : scopedProgress.main;
                if (scoped && scoped.available && scoped.totals) {
                    return {
                        uni: parseNum(scoped.totals.university),
                        req: parseNum(scoped.totals.required),
                    };
                }
                let uni = 0;
                let req = 0;
                try {
                    if (!cur || !Array.isArray(cur.semesters)) return { uni: 0, req: 0 };
                    for (let i = 0; i < cur.semesters.length; i++) {
                        const sem = cur.semesters[i];
                        if (!sem) continue;
                        if (!includeSemester(sem)) continue;
                        if (which === 'dm') {
                            uni += parseNum(sem.totalUniversityDM);
                            req += parseNum(sem.totalRequiredDM);
                        } else {
                            uni += parseNum(sem.totalUniversity);
                            req += parseNum(sem.totalRequired);
                        }
                    }
                } catch (_) {}
                return { uni, req };
            };

            const groupProgress = (view) => {
                try {
                    const scoped = view === 'dm' ? scopedProgress.dm : scopedProgress.main;
                    if (scoped && scoped.available && Array.isArray(scoped.groupRows)) {
                        return scoped.groupRows;
                    }
                    if (beforeTarget) return [];
                    if (!cur || typeof cur.requirementGroupProgress !== 'function') return [];
                    return cur.requirementGroupProgress(view);
                } catch (_) {
                    return [];
                }
            };
            // The set of course codes belonging to an UNMET enumerable group (a group
            // with an explicit `members` list — credits pools + the one-of rules).
            // Prefix/faculty/level rules have no member list and contribute none.
            const groupBonusCodes = (view, req) => {
                const set = new Set();
                try {
                    if (!req || !Array.isArray(req.groups)) return set;
                    const okById = {};
                    groupProgress(view).forEach((r) => { okById[r.id] = r.ok; });
                    req.groups.forEach((g) => {
                        if (Array.isArray(g.members) && g.members.length && okById[g.id] === false) {
                            g.members.forEach((c) => set.add(canonicalize(c)));
                        }
                    });
                } catch (_) {}
                return set;
            };

            const candidateImpactContext = (view) => {
                const scoped = view === 'dm' ? scopedProgress.dm : scopedProgress.main;
                const out = {
                    available: false,
                    excludedCodes: new Set(),
                    baseTypeOverrides: new Map(),
                    retainBaseTypeCodes: new Set(),
                    groupBonusCodes: new Set(),
                };
                const impacts = scoped && scoped.available ? scoped.candidateImpacts : null;
                if (!impacts || typeof impacts.forEach !== 'function') return out;
                // Candidate simulation is authoritative when present: unlike the
                // enumerable-members fallback below, it accounts for exclusive
                // pairs, pool overflow, predicates, and the candidate's effective
                // allocation before deciding whether a group actually advances.
                out.available = true;
                try {
                    impacts.forEach((impact, code) => {
                        const canonical = canonicalize(code);
                        if (!canonical || !impact || typeof impact !== 'object') return;
                        if (impact.excluded) out.excludedCodes.add(canonical);
                        if (impact.baseTypeOverride) {
                            out.baseTypeOverrides.set(canonical, impact.baseTypeOverride);
                        }
                        if (impact.forceBaseType || impact.retainBaseType) {
                            out.retainBaseTypeCodes.add(canonical);
                        }
                        if (impact.fillsUnmetGroup) out.groupBonusCodes.add(canonical);
                    });
                } catch (_) {}
                return out;
            };
            const poolNeeds = (view, req) => {
                const scoped = view === 'dm' ? scopedProgress.dm : scopedProgress.main;
                if (!scoped || !scoped.available || !scoped.totals) return null;
                return {
                    required: parseNum(scoped.totals.required) < parseNum(req && req.required),
                    core: parseNum(scoped.totals.core) < parseNum(req && req.core),
                    area: parseNum(scoped.totals.area) < parseNum(req && req.area),
                };
            };
            const hasCourseInProgressWindow = (courseCode, view) => {
                const wanted = canonicalize(courseCode);
                if (!wanted || !cur || !Array.isArray(cur.semesters)) return false;
                const scoped = view === 'dm' ? scopedProgress.dm : scopedProgress.main;
                if (scoped && scoped.available && scoped.courseCodes
                    && typeof scoped.courseCodes.has === 'function') {
                    return scoped.courseCodes.has(wanted);
                }
                for (let i = 0; i < cur.semesters.length; i++) {
                    const sem = cur.semesters[i];
                    if (!includeSemester(sem)) continue;
                    const courses = sem && Array.isArray(sem.courses) ? sem.courses : [];
                    for (let j = 0; j < courses.length; j++) {
                        if (canonicalize(courses[j] && courses[j].code) === wanted) return true;
                    }
                }
                return false;
            };
            const meBaseTypeOverrides = (majorCode, admitTermCode, view) => {
                const overrides = new Map();
                const termNum = parseInt(String(admitTermCode || '0'), 10);
                if (String(majorCode || '').toUpperCase() !== 'ME'
                    || isNaN(termNum) || termNum < 202501) return overrides;
                const pairs = [['ME403', 'ME425'], ['CS404', 'CS412']];
                for (let i = 0; i < pairs.length; i++) {
                    const left = pairs[i][0];
                    const right = pairs[i][1];
                    if (hasCourseInProgressWindow(right, view)) overrides.set(left, 'core');
                    if (hasCourseInProgressWindow(left, view)) overrides.set(right, 'core');
                }
                return overrides;
            };

            const buildMap = ranking.buildSuggestionRecordMap;
            const contexts = [];
            try {
                // Main major
                if (cur && cur.major) {
                    const term = String(cur.entryTerm || '');
                    const req = lookupReq(cur.major, term) || {};
                    const isEng = isEngineeringMajor(cur.major, term);
                    const prog = currentMajReqUni('main');
                    const sciEng = currentSciEng('main');
                    const impact = candidateImpactContext('main');
                    const legacyOverrides = meBaseTypeOverrides(cur.major, term, 'main');
                    legacyOverrides.forEach((type, code) => {
                        if (!impact.baseTypeOverrides.has(code)) {
                            impact.baseTypeOverrides.set(code, type);
                        }
                    });
                    const reqUni = parseNum(req.university);
                    const reqReq = parseNum(req.required);
                    contexts.push({
                        weight: 1.2,
                        majorCode: String(cur.major || ''),
                        termCode: term,
                        includeBsWeights: isEng && sciEng.sci < parseNum(req.science),
                        includeEngWeights: isEng && sciEng.eng < parseNum(req.engineering),
                        includeUniversityWeights: (reqUni > 0) ? (prog.uni < reqUni) : true,
                        includeRequiredWeights: (reqReq > 0) ? (prog.req < reqReq) : true,
                        groupBonusCodes: impact.available
                            ? impact.groupBonusCodes
                            : groupBonusCodes('main', req),
                        excludedCodes: impact.excludedCodes,
                        retainBaseTypeCodes: impact.retainBaseTypeCodes,
                        poolNeeds: poolNeeds('main', req),
                        baseTypeOverrides: impact.baseTypeOverrides,
                        map: buildMap(course_data),
                    });
                } else {
                    contexts.push({
                        weight: 1.0,
                        includeBsWeights: false,
                        includeEngWeights: false,
                        includeUniversityWeights: true,
                        includeRequiredWeights: true,
                        map: buildMap(course_data),
                    });
                }

                // Double major
                if (cur && cur.doubleMajor && Array.isArray(cur.doubleMajorCourseData)) {
                    const term = String(cur.entryTermDM || '');
                    const req = lookupReq(cur.doubleMajor, term) || {};
                    const isEng = isEngineeringMajor(cur.doubleMajor, term);
                    const prog = currentMajReqUni('dm');
                    const sciEng = currentSciEng('dm');
                    const impact = candidateImpactContext('dm');
                    const legacyOverrides = meBaseTypeOverrides(cur.doubleMajor, term, 'dm');
                    legacyOverrides.forEach((type, code) => {
                        if (!impact.baseTypeOverrides.has(code)) {
                            impact.baseTypeOverrides.set(code, type);
                        }
                    });
                    const reqUni = parseNum(req.university);
                    const reqReq = parseNum(req.required);
                    contexts.push({
                        weight: 0.8,
                        majorCode: String(cur.doubleMajor || ''),
                        termCode: term,
                        includeBsWeights: isEng && sciEng.sci < parseNum(req.science),
                        includeEngWeights: isEng && sciEng.eng < parseNum(req.engineering),
                        includeUniversityWeights: (reqUni > 0) ? (prog.uni < reqUni) : true,
                        includeRequiredWeights: (reqReq > 0) ? (prog.req < reqReq) : true,
                        groupBonusCodes: impact.available
                            ? impact.groupBonusCodes
                            : groupBonusCodes('dm', req),
                        excludedCodes: impact.excludedCodes,
                        retainBaseTypeCodes: impact.retainBaseTypeCodes,
                        poolNeeds: poolNeeds('dm', req),
                        baseTypeOverrides: impact.baseTypeOverrides,
                        map: buildMap(cur.doubleMajorCourseData),
                    });
                }

                // Minors (half weight)
                if (cur && Array.isArray(cur.minors) && cur.minors.length && cur.minorCourseDataByCode) {
                    cur.minors.forEach((minorCode) => {
                        const list = cur.minorCourseDataByCode[minorCode];
                        if (!Array.isArray(list) || !list.length) return;
                        contexts.push({
                            weight: 0.5,
                            includeBsWeights: false,
                            includeEngWeights: false,
                            includeUniversityWeights: true,
                            includeRequiredWeights: true,
                            map: buildMap(list),
                        });
                    });
                }
            } catch (_) {}

            const scorer = {
                key: getCourseSuggestionScorerKey(scoringOptions),
                available: true,
                progressPolicy: beforeTarget ? 'before-target' : 'all-plan',
                targetTermCode: progressTermCode ? String(progressTermCode) : '',
                score: (courseCode) => {
                    try {
                        return ranking.scoreSuggestionCourse(courseCode, contexts);
                    } catch (_) {
                        return 0;
                    }
                },
            };
            return Object.freeze(scorer);
        } catch (_) {
            return EMPTY_COURSE_SUGGESTION_SCORER;
        }
    }

    function computeCourseSuggestionScore(courseCode, opts) {
        const key = getCourseSuggestionScorerKey(opts);
        if (!courseSuggestionScoreCache
            || courseSuggestionScoreCache.key !== key
            || !courseSuggestionScoreCache.scorer
            || courseSuggestionScoreCache.scorer.available === false) {
            const scorer = buildCourseSuggestionScorer(opts);
            courseSuggestionScoreCache = {
                key: scorer && scorer.key ? scorer.key : key,
                scorer,
            };
        }
        return courseSuggestionScoreCache.scorer.score(courseCode);
    }

    if (typeof window !== 'undefined') {
        window.getCourseSuggestionScorerKey = getCourseSuggestionScorerKey;
        window.buildCourseSuggestionScorer = buildCourseSuggestionScorer;
        window.computeCourseSuggestionScore = computeCourseSuggestionScore;
    }

    const namespace = root.SurriculumModules || (root.SurriculumModules = {});
    namespace.courseSuggestionScorer = Object.freeze({
        getCacheKey: getCourseSuggestionScorerKey,
        build: buildCourseSuggestionScorer,
        score: computeCourseSuggestionScore,
    });
})(typeof window !== 'undefined' ? window : globalThis);
