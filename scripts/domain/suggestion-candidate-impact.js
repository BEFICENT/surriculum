// Candidate-specific graduation impact simulation for Smart Sort. The module
// owns no curriculum state: callers inject allocation policy once and provide
// the term-scoped program snapshot for each calculation.
(function installSuggestionCandidateImpact(root) {
    'use strict';

    const namespace = root.SurriculumModules || (root.SurriculumModules = {});

    function createSuggestionCandidateImpact(dependencies) {
        const runtime = dependencies || {};
        const requiredFunctions = [
            'normalizeCourseCode',
            'canonicalCourseCode',
            'normalizedLanguageLevel',
            'parseCreditValue',
            'resolveAlternativeRules',
            'allocateCascade',
            'applyManDiversity',
            'groupProgressFor',
        ];
        for (let i = 0; i < requiredFunctions.length; i++) {
            const name = requiredFunctions[i];
            if (typeof runtime[name] !== 'function') {
                throw new TypeError(`suggestion-candidate-impact requires ${name}`);
            }
        }

        const normalizeCourseCode = runtime.normalizeCourseCode;
        const canonicalCourseCode = runtime.canonicalCourseCode;
        const normalizedLanguageLevel = runtime.normalizedLanguageLevel;
        const parseCreditValue = runtime.parseCreditValue;
        const resolveAlternativeRules = runtime.resolveAlternativeRules;
        const allocateCascade = runtime.allocateCascade;
        const applyManDiversity = runtime.applyManDiversity;
        const groupProgressFor = runtime.groupProgressFor;
        const hum200Level = Object.freeze(Array.from(runtime.hum200Level || []));
        const hum300Level = Object.freeze(Array.from(runtime.hum300Level || []));
        const humAnyLevel = Object.freeze(Array.from(runtime.humAnyLevel || []));

        function build(context) {
            const state = context || {};
            const impacts = new Map();
            const snapshot = state.snapshot;
            if (!snapshot || !snapshot.available) return impacts;

            const curriculum = state.curriculum;
            const major = state.major;
            const entryTerm = state.entryTerm;
            const catalog = state.catalog;
            const req = snapshot.req || {};
            const fields = snapshot.fields;
            const eligibleBeforeTarget = state.eligibleBeforeTarget;
            const lookup = state.lookupCatalogRecord;
            if (!major || !Array.isArray(catalog) || !fields
                || typeof eligibleBeforeTarget !== 'function'
                || typeof lookup !== 'function') return impacts;

            const chronological = Array.isArray(state.chronologicalSemesters)
                ? state.chronologicalSemesters : [];
            const priorSemesters = [];
            const priorCodes = new Set();
            const priority = new Map();
            let nextPriority = 0;
            for (let i = 0; i < chronological.length; i++) {
                const source = chronological[i];
                const courses = (source && Array.isArray(source.courses) ? source.courses : [])
                    .filter((course) => eligibleBeforeTarget(course, source));
                if (!courses.length) continue;
                priorSemesters.push({ courses });
                for (let j = 0; j < courses.length; j++) {
                    const course = courses[j];
                    priority.set(course, nextPriority++);
                    priorCodes.add(canonicalCourseCode(course && course.code));
                }
            }

            const baseRows = new Map();
            (Array.isArray(snapshot.groupRows) ? snapshot.groupRows : []).forEach((row) => {
                if (row && row.id) baseRows.set(String(row.id), row);
            });
            const ieCs201StaticType = String(
                (major === 'IE' ? lookup('CS201', catalog) : null)?.EL_Type || '',
            ).trim().toLowerCase();
            const requirementCounters = {
                required: Number(snapshot.totals && snapshot.totals.required) || 0,
                core: Number(snapshot.totals && snapshot.totals.core) || 0,
                area: Number(snapshot.totals && snapshot.totals.area) || 0,
            };
            const requirementCaps = {
                required: Number(req.required) || 0,
                core: Number(req.core) || 0,
                area: Number(req.area) || 0,
            };
            const namedRequirementReasons = (code) => {
                const reasons = [];
                if (code === 'SPS303' && !priorCodes.has('SPS303')) {
                    reasons.push('University requirement: SPS303');
                }
                const internship = canonicalCourseCode(req.internshipCourse);
                if (internship && code === internship && !priorCodes.has(internship)) {
                    reasons.push('Required internship');
                }
                const hasAny = (codes) => codes.some((candidate) => priorCodes.has(candidate));
                const humRequired = Number(req.humRequired) || 0;
                if (humRequired >= 2) {
                    if (hum200Level.includes(code) && !hasAny(hum200Level)) {
                        reasons.push('University requirement: one 200-level HUM');
                    }
                    if (hum300Level.includes(code) && !hasAny(hum300Level)) {
                        reasons.push('University requirement: one 300-level HUM');
                    }
                } else if (humRequired >= 1 && humAnyLevel.includes(code)
                    && !hasAny(humAnyLevel)) {
                    reasons.push('University requirement: one HUM');
                }
                return reasons;
            };

            for (let i = 0; i < catalog.length; i++) {
                const record = catalog[i];
                if (!record || record.__globalCourseDefinition) continue;
                const rawCode = normalizeCourseCode(
                    String(record.Major || '') + String(record.Code || ''),
                );
                const code = canonicalCourseCode(rawCode);
                if (!code) continue;
                // The current DSA210 row is authoritative over its CS210 alias.
                if (impacts.has(code) && rawCode !== code) continue;

                const staticType = String(record.EL_Type || '').trim().toLowerCase();
                const candidate = {
                    code,
                    SU_credit: parseCreditValue(record.SU_credit || '0'),
                    Basic_Science: parseFloat(record.Basic_Science || '0') || 0,
                    Engineering: parseFloat(record.Engineering || '0') || 0,
                    ECTS: parseFloat(record.ECTS || '0') || 0,
                    Faculty_Course: record.Faculty_Course || 'No',
                    Faculty: record.Faculty || '',
                };
                candidate[fields.category] = staticType
                    ? staticType.charAt(0).toUpperCase() + staticType.slice(1) : '';
                candidate[fields.languageLevel] = normalizedLanguageLevel(record.Language_Level);

                const candidateSemester = { courses: [candidate] };
                const candidateSemesters = priorSemesters.concat(candidateSemester);
                priority.set(candidate, nextPriority);
                const hasCourse = (wanted) => {
                    const normalized = canonicalCourseCode(wanted);
                    return normalized === code || priorCodes.has(normalized);
                };
                // IE's allocator pins CS201 to Core whenever both CS201 and DSA201
                // are present. Older catalogs publish both as Required, so the
                // candidate completing the pair has marginal Core value.
                const completesIeForcedCorePair = major === 'IE' && (
                    (code === 'CS201' && priorCodes.has('DSA201'))
                    || (code === 'DSA201' && priorCodes.has('CS201')
                        && ieCs201StaticType === 'required')
                );
                const alternatives = resolveAlternativeRules(
                    major,
                    entryTerm,
                    candidateSemesters,
                    candidateSemesters,
                    lookup,
                    catalog,
                    hasCourse,
                    req.groups,
                    () => true,
                    (course) => priority.has(course) ? priority.get(course) : nextPriority,
                );

                const excluded = alternatives.excluded.has(candidate);
                let baseType = alternatives.typeOverride.has(candidate)
                    ? alternatives.typeOverride.get(candidate) : staticType;
                if (completesIeForcedCorePair) baseType = 'core';
                const forceCore = alternatives.forceCore.has(candidate)
                    || completesIeForcedCorePair;
                let effectiveType = 'none';
                if (!excluded && baseType && baseType !== 'none' && baseType !== 'unknown') {
                    const counters = { ...requirementCounters };
                    effectiveType = allocateCascade(
                        baseType,
                        candidate.SU_credit,
                        counters,
                        requirementCaps,
                        forceCore,
                    ) || 'none';
                }
                candidate[fields.effective] = effectiveType;

                // MAN's diversity pass can swap an earlier elective when this
                // candidate supplies a missing prefix. Simulate on copies so the
                // visible allocation and the cached progress snapshot stay pure.
                let candidateGroupSemesters = candidateSemesters;
                if (major === 'MAN' && !excluded && effectiveType !== 'none') {
                    const simulated = candidateSemesters.map((semester, semesterIndex) => ({
                        courses: (semester.courses || []).map((course, courseIndex) => ({
                            ...course,
                            id: course && course.id
                                ? course.id
                                : `suggestion_man_${semesterIndex}_${courseIndex}`,
                        })),
                    }));
                    applyManDiversity(
                        simulated,
                        simulated,
                        fields,
                        Number(req.core) || 0,
                        Number(req.area) || 0,
                    );
                    candidateGroupSemesters = simulated;
                    const simulatedCandidateSemester = simulated[simulated.length - 1];
                    const simulatedCandidate = simulatedCandidateSemester
                        && simulatedCandidateSemester.courses[0];
                    effectiveType = simulatedCandidate
                        ? simulatedCandidate[fields.effective] || 'none' : 'none';
                    if (effectiveType !== 'none') baseType = effectiveType;
                }

                const reasons = namedRequirementReasons(code);
                let fillsUnmetGroup = false;
                if (!excluded && effectiveType !== 'none' && Array.isArray(req.groups)) {
                    const nextRows = groupProgressFor({
                        curr: curriculum,
                        semesters: candidateGroupSemesters,
                        fields,
                        entryTerm,
                        isEligible: () => true,
                    }, req.groups, req.facultyReq);
                    for (let r = 0; r < nextRows.length; r++) {
                        const nextRow = nextRows[r];
                        const previous = nextRow && nextRow.id
                            ? baseRows.get(String(nextRow.id)) : null;
                        if (!previous || previous.ok !== false || nextRow.isCap) continue;
                        const beforeValue = Number(previous.current);
                        const afterValue = Number(nextRow.current);
                        if (nextRow.ok === true
                            || (Number.isFinite(beforeValue) && Number.isFinite(afterValue)
                                && afterValue > beforeValue)) {
                            fillsUnmetGroup = true;
                            if (nextRow.label) reasons.push(String(nextRow.label));
                        }
                    }
                }

                impacts.set(code, Object.freeze({
                    excluded,
                    baseTypeOverride: baseType !== staticType ? baseType : '',
                    forceBaseType: forceCore,
                    retainBaseType: reasons.length > 0 || fillsUnmetGroup,
                    fillsUnmetGroup,
                    effectiveType,
                    reasons: Object.freeze(Array.from(new Set(reasons))),
                }));
            }
            return impacts;
        }

        return Object.freeze({ build });
    }

    namespace.suggestionCandidateImpact = Object.freeze({
        create: createSuggestionCandidateImpact,
    });
})(typeof window !== 'undefined' ? window : globalThis);
