// Term-scoped program-progress snapshot orchestration for Smart Sort. The
// stateful curriculum injects allocation/catalog boundaries; this module owns
// snapshot assembly, double-major union totals, and candidate-impact wiring.
(function installSuggestionProgressSnapshot(root) {
    'use strict';

    const namespace = root.SurriculumModules || (root.SurriculumModules = {});

    function createSuggestionProgressSnapshot(dependencies) {
        const runtime = dependencies || {};
        const requiredFunctions = [
            'normalizeProgressTermCode',
            'isDegreeEligibleCourse',
            'semesterProgressTermCode',
            'canonicalCourseCode',
            'groupProgressFor',
            'facultyProgress',
            'programUnionGenericRecords',
            'totalsForGenericRecords',
            'getChronologicalSemesters',
            'lookupCatalogRecord',
        ];
        for (let i = 0; i < requiredFunctions.length; i++) {
            const name = requiredFunctions[i];
            if (typeof runtime[name] !== 'function') {
                throw new TypeError(`suggestion-progress-snapshot requires ${name}`);
            }
        }
        if (!runtime.candidateImpactCalculator
            || typeof runtime.candidateImpactCalculator.build !== 'function') {
            throw new TypeError(
                'suggestion-progress-snapshot requires candidateImpactCalculator.build',
            );
        }

        const normalizeProgressTermCode = runtime.normalizeProgressTermCode;
        const isDegreeEligibleCourse = runtime.isDegreeEligibleCourse;
        const semesterProgressTermCode = runtime.semesterProgressTermCode;
        const canonicalCourseCode = runtime.canonicalCourseCode;
        const groupProgressFor = runtime.groupProgressFor;
        const facultyProgress = runtime.facultyProgress;
        const programUnionGenericRecords = runtime.programUnionGenericRecords;
        const totalsForGenericRecords = runtime.totalsForGenericRecords;
        const getChronologicalSemesters = runtime.getChronologicalSemesters;
        const lookupCatalogRecord = runtime.lookupCatalogRecord;
        const candidateImpactCalculator = runtime.candidateImpactCalculator;
        const earnedState = runtime.earnedState;

        function combine(view, programSnapshot, mainSnapshot) {
            if (view !== 'dm') {
                return {
                    ...programSnapshot,
                    genericRecords: programSnapshot.records,
                    mainProgramRecords: programSnapshot.records,
                };
            }
            const genericRecords = programUnionGenericRecords(
                mainSnapshot && mainSnapshot.records,
                programSnapshot && programSnapshot.records,
            );
            const unionTotals = totalsForGenericRecords(genericRecords);
            return {
                ...programSnapshot,
                totals: {
                    ...programSnapshot.totals,
                    ...unionTotals,
                },
                genericRecords,
                mainProgramRecords: mainSnapshot && mainSnapshot.records
                    ? mainSnapshot.records : new Map(),
            };
        }

        function candidateImpacts(curriculum, view, snapshot, eligibleBeforeTarget) {
            const isDM = view === 'dm';
            const major = isDM ? curriculum.doubleMajor : curriculum.major;
            const catalog = isDM
                ? curriculum.doubleMajorCourseData : curriculum.primaryCourseData;
            return candidateImpactCalculator.build({
                curriculum,
                major,
                entryTerm: isDM ? curriculum.entryTermDM : curriculum.entryTerm,
                catalog,
                snapshot,
                eligibleBeforeTarget,
                chronologicalSemesters: getChronologicalSemesters(curriculum),
                lookupCatalogRecord: (code, data) => (
                    lookupCatalogRecord(major, catalog, code, data)
                ),
            });
        }

        function buildViews(context, targetTermCode, options) {
            const state = context || {};
            const curriculum = state.curriculum || {};
            const runProgressAllocation = state.runProgressAllocation;
            if (typeof runProgressAllocation !== 'function') {
                throw new TypeError(
                    'suggestion-progress-snapshot requires runProgressAllocation',
                );
            }

            const normalizedTarget = normalizeProgressTermCode(targetTermCode);
            const targetNumber = Number(normalizedTarget || 0);
            const unavailable = (view) => ({
                available: false,
                view,
                targetTermCode: normalizedTarget,
                totals: {},
                groupRows: [],
                courseCodes: new Set(),
            });
            if (!targetNumber) {
                return {
                    available: false,
                    targetTermCode: '',
                    main: unavailable('main'),
                    dm: unavailable('dm'),
                };
            }

            const eligibleBeforeTarget = (course, semester) => {
                if (!isDegreeEligibleCourse(course)) return false;
                const code = semesterProgressTermCode(semester);
                return !!code && Number(code) < targetNumber;
            };
            const stableState = () => earnedState;
            const courseCodes = new Set();
            const semesters = Array.isArray(curriculum.semesters) ? curriculum.semesters : [];
            for (let i = 0; i < semesters.length; i++) {
                const semester = semesters[i];
                const courses = semester && Array.isArray(semester.courses)
                    ? semester.courses : [];
                for (let j = 0; j < courses.length; j++) {
                    const course = courses[j];
                    if (eligibleBeforeTarget(course, semester)) {
                        courseCodes.add(canonicalCourseCode(course.code));
                    }
                }
            }

            const finishSnapshot = (view, snapshot) => {
                const groupContext = {
                    curr: curriculum,
                    semesters,
                    fields: snapshot.fields,
                    entryTerm: snapshot.entryTerm,
                    isEligible: snapshot.isEligible,
                };
                const req = snapshot.req || {};
                const groupRows = req.groups
                    ? groupProgressFor(groupContext, req.groups, req.facultyReq)
                    : (req.facultyReq
                        ? facultyProgress(groupContext, req.facultyReq) : []);
                return {
                    ...snapshot,
                    view,
                    targetTermCode: normalizedTarget,
                    groupRows,
                    courseCodes: new Set(courseCodes),
                };
            };

            const mainSnapshot = runProgressAllocation(
                'main', 'before_target', eligibleBeforeTarget, stableState,
            );
            const main = finishSnapshot('main', mainSnapshot);
            let dm = unavailable('dm');
            if (curriculum.doubleMajor) {
                const dmSnapshot = runProgressAllocation(
                    'dm', 'before_target', eligibleBeforeTarget, stableState,
                );
                dm = finishSnapshot('dm', combine('dm', dmSnapshot, mainSnapshot));
            }
            if (options && options.includeCandidateImpacts === true) {
                main.candidateImpacts = candidateImpacts(
                    curriculum, 'main', main, eligibleBeforeTarget,
                );
                if (dm && dm.available) {
                    dm.candidateImpacts = candidateImpacts(
                        curriculum, 'dm', dm, eligibleBeforeTarget,
                    );
                }
            }
            return {
                available: !!(main.available || dm.available),
                targetTermCode: normalizedTarget,
                main,
                dm,
            };
        }

        function selectView(snapshots, view) {
            const programView = view === 'dm' ? 'dm' : 'main';
            const snapshot = snapshots && snapshots[programView];
            return snapshot || {
                available: false,
                view: programView,
                targetTermCode: '',
                totals: {},
                groupRows: [],
                courseCodes: new Set(),
            };
        }

        return Object.freeze({ buildViews, selectView, combine });
    }

    namespace.suggestionProgressSnapshot = Object.freeze({
        create: createSuggestionProgressSnapshot,
    });
})(typeof window !== 'undefined' ? window : globalThis);
