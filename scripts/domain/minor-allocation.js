// Minor-program allocation and completion policy.
(function installMinorAllocation(root) {
    'use strict';

    function createMinorAllocationService(dependencies) {
        const config = dependencies || {};
        const window = config.window || root;
        const document = config.document || window.document;
        // ES-module bridges may install after deferred classic scripts. Resolve
        // this dependency at call time to preserve file:// and hosted boot order.
        const parseCreditValue = (...args) => {
            const parser = typeof config.parseCreditValue === 'function'
                ? config.parseCreditValue : window.parseCreditValue;
            if (typeof parser !== 'function') throw new Error('parseCreditValue is unavailable');
            return parser(...args);
        };

        function courseCountsTowardDegreePlan(curriculum, course, semester) {
            try {
                if (curriculum && typeof curriculum.getCourseProgressState === 'function' && semester) {
                    return curriculum.getCourseProgressState(course, semester) !== 'unsuccessful';
                }
                if (curriculum && typeof curriculum.isDegreeEligibleCourse === 'function') {
                    return curriculum.isDegreeEligibleCourse(course);
                }
                if (typeof window !== 'undefined' && window.gradePolicy
                    && typeof window.gradePolicy.evaluateGrade === 'function') {
                    const outcome = window.gradePolicy.evaluateGrade(
                        course && course.grade,
                        course && course.gradingBasis,
                    );
                    return !!(outcome.supported && (outcome.earnsCredit || outcome.pending));
                }
                const elem = document.getElementById(course && course.id);
                const grade = elem ? elem.querySelector('.grade') : null;
                const value = String(grade ? grade.textContent : '').trim().toUpperCase();
                return ['', 'REGISTERED', 'P', 'I', 'S', 'T',
                    'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D'].includes(value);
            } catch (_) {
                return false;
            }
        }

        // Compute how taken courses are allocated for a minor, including the
        // "overflow" behavior (Core → Area → Free) and equivalence rules.
        function computeMinorAllocation(curriculum, minorCode, options) {
            const opts = options || {};
            const computeCgpa = () => {
                if (opts.progressGpa && typeof opts.progressGpa === 'object') {
                    return {
                        cgpa: Number(opts.progressGpa.value),
                        credits: Number(opts.progressGpa.credits) || 0,
                        resolved: opts.progressGpa.resolved !== false,
                        issues: Array.isArray(opts.progressGpa.issues) ? opts.progressGpa.issues : [],
                    };
                }
                // The current app always has a term-aware actual-GPA source. Prefer it
                // even when it has zero credits; falling through in that case would let
                // manually entered future grades masquerade as CGPA.
                if (curriculum && typeof curriculum.getActualGpa === 'function') {
                    try {
                        const gpa = curriculum.getActualGpa();
                        return { cgpa: Number(gpa.value), credits: Number(gpa.credits) || 0,
                            resolved: gpa.resolved !== false,
                            issues: Array.isArray(gpa.issues) ? gpa.issues : [] };
                    } catch (_) {}
                }
                if (curriculum && typeof curriculum.getGraduationProgress === 'function') {
                    try {
                        const progress = curriculum.getGraduationProgress('main');
                        const gpa = progress && progress.gpa ? progress.gpa : {};
                        return { cgpa: Number(gpa.value), credits: Number(gpa.credits) || 0,
                            resolved: gpa.resolved !== false,
                            issues: Array.isArray(gpa.issues) ? gpa.issues : [] };
                    } catch (_) {}
                }
                let gpaCredits = 0;
                let gpaValue = 0.0;
                try {
                    for (let i = 0; i < curriculum.semesters.length; i++) {
                        const sem = curriculum.semesters[i];
                        gpaCredits += (sem && sem.totalGPACredits) ? sem.totalGPACredits : 0;
                        gpaValue += (sem && sem.totalGPA) ? sem.totalGPA : 0;
                    }
                } catch (_) {}
                if (!gpaCredits) return { cgpa: NaN, credits: 0, resolved: true, issues: [] };
                const cgpa = gpaValue / gpaCredits;
                return { cgpa, credits: gpaCredits, resolved: true, issues: [] };
            };

            const gpaThresholdForMinor = (code) => {
                // Exception: Entrepreneurship minor requires 2.50 CGPA.
                if (String(code || '').toUpperCase() === 'ENTREP-MINOR') return 2.50;
                return 2.72;
            };

            const termCode = (() => {
                try {
                    const map = curriculum && curriculum.minorTermsByCode ? curriculum.minorTermsByCode : {};
                    const t = map && map[minorCode] ? String(map[minorCode]) : '';
                    if (t) return t;
                } catch (_) {}
                try {
                    return curriculum && curriculum.entryTermMinor ? String(curriculum.entryTermMinor) : '';
                } catch (_) {
                    return '';
                }
            })();

            const reqMap = (() => {
                try {
                    if (typeof window !== 'undefined' && typeof window.loadMinorRequirementsForTerm === 'function') {
                        const m = window.loadMinorRequirementsForTerm(termCode);
                        if (m && typeof m === 'object') return m;
                    }
                } catch (_) {}
                return (typeof window !== 'undefined' && window.minorRequirements) ? window.minorRequirements : {};
            })();
            const req = reqMap ? reqMap[minorCode] : null;
            const dataByCode = curriculum && curriculum.minorCourseDataByCode ? curriculum.minorCourseDataByCode : {};
            const courseData = dataByCode ? dataByCode[minorCode] : null;
            const catalogCodesByMinor = curriculum && curriculum.minorCatalogCodeSetsByCode
                ? curriculum.minorCatalogCodeSetsByCode : {};
            const officialCatalogCodes = catalogCodesByMinor && catalogCodesByMinor[minorCode] instanceof Set
                ? catalogCodesByMinor[minorCode] : null;

            const parseInt0 = (v) => {
                const n = parseInt(v || '0', 10);
                return isNaN(n) ? 0 : n;
            };
            const parseCredit0 = (v) => {
                try {
                    if (typeof parseCreditValue === 'function') return parseCreditValue(v);
                } catch (_) {}
                const n = Number.parseFloat(v || '0');
                return Number.isFinite(n) ? n : 0;
            };
            const normalizeCode = (v) => String(v || '').toUpperCase().replace(/\s+/g, '');

            if (!req || !Array.isArray(courseData)) {
                return { ok: false, title: minorCode, error: 'Missing minor data files.' };
            }

            // Collect passed/planned courses (ignore grade F).
            const taken = new Set();
            const progressStateByCode = new Map();
            try {
                for (let i = 0; i < curriculum.semesters.length; i++) {
                    const sem = curriculum.semesters[i];
                    for (let j = 0; j < sem.courses.length; j++) {
                        const c = sem.courses[j];
                        if (!c || !c.code) continue;
                        if (typeof opts.isEligible === 'function') {
                            if (!opts.isEligible(c, sem)) continue;
                        } else if (!courseCountsTowardDegreePlan(curriculum, c, sem)) continue;
                        const normalized = normalizeCode(c.code);
                        taken.add(normalized);
                        if (curriculum && typeof curriculum.getCourseProgressState === 'function') {
                            progressStateByCode.set(normalized, curriculum.getCourseProgressState(c, sem));
                        }
                    }
                }
            } catch (_) {}

            const categories = req.categories || {};
            const fullOrder = ['required', 'core', 'area', 'free'];
            const nextInOrder = (cat) => {
                const idx = fullOrder.indexOf(cat);
                return idx >= 0 && idx < fullOrder.length - 1 ? fullOrder[idx + 1] : null;
            };

            // Course metadata + pools
            const courseByCode = new Map();
            const pools = { required: [], core: [], area: [], free: [], university: [] };
            for (let i = 0; i < courseData.length; i++) {
                const c = courseData[i];
                const code = normalizeCode((c.Major || '') + (c.Code || ''));
                if (!code) continue;
                const baseCat = String(c.EL_Type || '').toLowerCase();
                courseByCode.set(code, { ...c, __code: code, __baseCat: baseCat });
                if (pools[baseCat]) pools[baseCat].push(code);
            }

            // Equivalence lookup per category.
            const eqGroupLookup = {};
            for (const catKey of fullOrder) {
                const cfg = categories[catKey] || {};
                const eq = Array.isArray(cfg.equivalents) ? cfg.equivalents : [];
                const lookup = new Map();
                for (let i = 0; i < eq.length; i++) {
                    const group = Array.isArray(eq[i]) ? eq[i] : [];
                    for (let j = 0; j < group.length; j++) {
                        lookup.set(normalizeCode(group[j]), i);
                    }
                }
                eqGroupLookup[catKey] = lookup;
            }

            const totals = {
                required: { courses: 0, credits: 0 },
                core: { courses: 0, credits: 0 },
                area: { courses: 0, credits: 0 },
                free: { courses: 0, credits: 0 },
            };
            const usedEqGroup = {
                required: new Set(),
                core: new Set(),
                area: new Set(),
                free: new Set(),
            };

            const needsMet = (cat) => {
                const cfg = categories[cat] || {};
                const needC = parseInt0(cfg.minCourses);
                const needS = parseInt0(cfg.minSU);
                if (!needC && !needS) return false; // do not auto-overflow categories with no requirements
                const have = totals[cat] || { courses: 0, credits: 0 };
                return (have.courses >= needC) && (have.credits >= needS);
            };

            const canCountEquivalenceIn = (cat, code) => {
                const lookup = eqGroupLookup[cat];
                if (!lookup) return true;
                const groupId = lookup.get(code);
                if (groupId === undefined) return true;
                return !usedEqGroup[cat].has(groupId);
            };
            const markEquivalenceUsed = (cat, code) => {
                const lookup = eqGroupLookup[cat];
                if (!lookup) return;
                const groupId = lookup.get(code);
                if (groupId === undefined) return;
                usedEqGroup[cat].add(groupId);
            };

            // Build list of taken minor courses (only those present in this minor).
            const takenMinorCourses = [];
            for (const code of taken) {
                const rec = courseByCode.get(code);
                if (!rec) continue;
                // A stored overlay may deliberately classify a course as N/A (none or
                // unknown). Do not silently turn that fail-closed choice into minor free
                // credit. Minor requirements currently allocate only these four pools.
                if (!fullOrder.includes(rec.__baseCat)) continue;
                const baseCat = rec.__baseCat;
                const credit = parseCredit0(rec.SU_credit);
                takenMinorCourses.push({ code, baseCat, credit,
                    progressState: progressStateByCode.get(code) || 'earned' });
            }
            const catSortIdx = (cat) => {
                const idx = fullOrder.indexOf(cat);
                return idx === -1 ? 999 : idx;
            };
            takenMinorCourses.sort((a, b) => {
                const stateRank = { earned: 0, current: 1, future: 2, unverified: 3 };
                const as = Object.prototype.hasOwnProperty.call(stateRank, a.progressState) ? stateRank[a.progressState] : 4;
                const bs = Object.prototype.hasOwnProperty.call(stateRank, b.progressState) ? stateRank[b.progressState] : 4;
                if (as !== bs) return as - bs;
                const ai = catSortIdx(a.baseCat);
                const bi = catSortIdx(b.baseCat);
                if (ai !== bi) return ai - bi;
                return String(a.code).localeCompare(String(b.code));
            });

            const allocationByCode = {};
            for (let i = 0; i < takenMinorCourses.length; i++) {
                const c = takenMinorCourses[i];
                let cat = c.baseCat;
                while (cat) {
                    if (!canCountEquivalenceIn(cat, c.code)) {
                        cat = nextInOrder(cat);
                        continue;
                    }
                    const next = nextInOrder(cat);
                    if (next && needsMet(cat)) {
                        cat = next;
                        continue;
                    }
                    totals[cat].courses += 1;
                    totals[cat].credits += c.credit;
                    markEquivalenceUsed(cat, c.code);
                    allocationByCode[c.code] = { allocatedCat: cat, baseCat: c.baseCat,
                        movedDown: cat !== c.baseCat, credit: c.credit,
                        progressState: c.progressState };
                    break;
                }
            }

            // Validate completion.
            let allOk = true;
            const perCatOk = {};
            for (const catKey of fullOrder) {
                const cfg = categories[catKey] || {};
                const needC = parseInt0(cfg.minCourses);
                const needS = parseInt0(cfg.minSU);
                const have = totals[catKey];
                let ok = true;
                if (needC) ok = ok && (have.courses >= needC);
                if (needS) ok = ok && (have.credits >= needS);
                if (catKey === 'required' && cfg.allListedRequired) {
                    const eq = Array.isArray(cfg.equivalents) ? cfg.equivalents : [];
                    const eqFlat = new Set(eq.flat().map(x => normalizeCode(x)));
                    // `allListedRequired` names the university's official required
                    // list. A user-added Required overlay may satisfy generic count/SU
                    // minima, but it must not make itself a newly mandatory named
                    // course. Older injected/test data without an official-code set
                    // retains the historical behavior.
                    const poolCodes = (pools.required || []).filter((code) =>
                        !officialCatalogCodes || officialCatalogCodes.has(code)
                    );
                    for (let i = 0; i < poolCodes.length; i++) {
                        const code = poolCodes[i];
                        if (eqFlat.has(code)) continue;
                        if (!taken.has(code)) ok = false;
                    }
                    for (let i = 0; i < eq.length; i++) {
                        const group = Array.isArray(eq[i]) ? eq[i].map(x => normalizeCode(x)) : [];
                        if (group.length && !group.some(c => taken.has(c))) ok = false;
                    }
                }
                perCatOk[catKey] = ok;
                if ((categories[catKey] && typeof categories[catKey] === 'object') && !ok) allOk = false;
            }

            const totalCourses = totals.required.courses + totals.core.courses + totals.area.courses + totals.free.courses;
            const totalCredits = totals.required.credits + totals.core.credits + totals.area.credits + totals.free.credits;
            const minAllC = parseInt0(req.minCourses);
            const minAllS = parseInt0(req.minSU);
            if (minAllC && totalCourses < minAllC) allOk = false;
            if (minAllS && totalCredits < minAllS) allOk = false;
            if (!Object.keys(categories).length) allOk = false;

            // Build a classification-only allocation for PGPA membership. Unlike the
            // completion allocation above, this pass admits an F/letter-basis NA so a
            // failed in-program course can contribute zero points over its SU credits
            // without earning credit. Successful/planned courses sort ahead of failures,
            // so a failure cannot displace a fulfilled equivalence or elective slot.
            let pgpaResult = {
                value: NaN, credits: 0, points: 0, resolved: false, unresolved: true,
                issues: [], complete: false, missingCredits: 0, missingCourses: [],
                projected: false,
            };
            let projectedPgpaResult = { ...pgpaResult, projected: true };
            let membershipAllocationByCode = allocationByCode;
            if (opts.calculateProgramGpa !== false) {
                const candidate = (course) => {
                    try {
                        if (curriculum && typeof curriculum.isProgramGpaCandidate === 'function') {
                            return curriculum.isProgramGpaCandidate(course);
                        }
                        const policy = (typeof window !== 'undefined') ? window.gradePolicy : null;
                        if (policy && typeof policy.evaluateGrade === 'function') {
                            const outcome = policy.evaluateGrade(course && course.grade, course && course.gradingBasis);
                            return !!(outcome.earnsCredit || outcome.pending || outcome.countsInGpa || outcome.needsReview);
                        }
                    } catch (_) {}
                    return true;
                };
                const membership = computeMinorAllocation(curriculum, minorCode, {
                    ...opts,
                    calculateProgramGpa: false,
                    isEligible: candidate,
                });
                membershipAllocationByCode = (membership && membership.allocationByCode) || {};
                const isMember = (course) => {
                    const record = membershipAllocationByCode[normalizeCode(course && course.code)];
                    return !!record && ['required', 'core', 'area', 'free', 'university']
                        .includes(String(record.allocatedCat || '').toLowerCase());
                };
                if (curriculum && typeof curriculum.calculateGpaForMembership === 'function') {
                    pgpaResult = curriculum.calculateGpaForMembership(isMember, undefined, false);
                    projectedPgpaResult = curriculum.calculateGpaForMembership(isMember, undefined, true);
                }
            }

            // Minor certificates require both the overall CGPA and this minor's PGPA.
            const gpaResult = computeCgpa();
            const { cgpa } = gpaResult;
            const gpaThreshold = gpaThresholdForMinor(minorCode);
            const cgpaOk = gpaResult.resolved !== false && isFinite(cgpa) && cgpa >= gpaThreshold;
            const pgpa = Number(pgpaResult.value);
            const pgpaOk = opts.calculateProgramGpa === false
                ? true
                : pgpaResult.resolved !== false && pgpaResult.credits > 0
                    && isFinite(pgpa) && pgpa >= gpaThreshold;
            if (!cgpaOk || !pgpaOk) allOk = false;

            return {
                ok: allOk,
                title: req.name || minorCode,
                req,
                categories,
                totals,
                perCatOk,
                pools,
                courseByCode,
                allocationByCode,
                membershipAllocationByCode,
                termCode,
                cgpa,
                gpaResolved: gpaResult.resolved !== false,
                gpaIssues: gpaResult.issues,
                gpaThreshold,
                gpaOk: cgpaOk,
                cgpaOk,
                pgpa,
                pgpaCredits: Number(pgpaResult.credits) || 0,
                pgpaResolved: pgpaResult.resolved !== false,
                pgpaIssues: Array.isArray(pgpaResult.issues) ? pgpaResult.issues : [],
                pgpaOk,
                projectedPgpa: projectedPgpaResult,
                averagesOk: cgpaOk && pgpaOk,
            };
        }

        return Object.freeze({
            courseCountsTowardDegreePlan,
            computeMinorAllocation,
        });
    }

    const service = createMinorAllocationService({ window: root });
    const namespace = root.SurriculumModules || (root.SurriculumModules = {});
    const api = Object.freeze({
        create: createMinorAllocationService,
        courseCountsTowardDegreePlan: service.courseCountsTowardDegreePlan,
        computeMinorAllocation: service.computeMinorAllocation,
    });
    namespace.minorAllocation = api;

    root.courseCountsTowardDegreePlan = api.courseCountsTowardDegreePlan;
    root.computeMinorAllocation = api.computeMinorAllocation;
})(typeof window !== 'undefined' ? window : globalThis);
