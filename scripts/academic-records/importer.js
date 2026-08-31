// Academic Records planner lookup, mutation, rollback, and import transactions.
(function installAcademicRecordsImporter(root) {
    'use strict';

    const namespace = root.SurriculumModules || (root.SurriculumModules = {});
    const parsing = namespace.academicRecordsParsing;
    if (!parsing) {
        throw new Error('scripts/academic-records/parser.js must load before importer.js');
    }
    const catalogResolutionFactory = namespace.academicRecordsCatalogResolution;
    if (!catalogResolutionFactory || typeof catalogResolutionFactory.create !== 'function') {
        throw new Error(
            'scripts/academic-records/catalog-resolution.js must load before importer.js',
        );
    }
    const {
        TRANSCRIPT_SEMESTER_SKIP_REASON,
        normalizeTranscriptGradeRecord,
        canonicalTranscriptCourseCode,
        isExactTranscriptLangCourseCode,
        suggestedTranscriptLanguageLevel,
        transcriptSelectedDegreePrograms,
        transcriptLanguageTypeForProgram,
        normalizeTranscriptSemester,
        transcriptSemesterIssueLabel,
        transcriptSemesterOrder,
        makeTranscriptCandidate,
        reconcileTranscriptCandidates,
    } = parsing;

    function createAcademicRecordsImporter(dependencies) {
        const runtime = dependencies || {};
        const document = runtime.document;
        const localStorage = runtime.localStorage;
        const getCreateSemester = typeof runtime.getCreateSemester === 'function'
            ? runtime.getCreateSemester : () => runtime.createSemester;
        const getSemesterTermCode = typeof runtime.getSemesterTermCode === 'function'
            ? runtime.getSemesterTermCode : () => runtime.semesterTermCode;
        const getResolveGlobalCourseDefinition = typeof runtime.getResolveGlobalCourseDefinition === 'function'
            ? runtime.getResolveGlobalCourseDefinition : () => runtime.resolveGlobalCourseDefinition;
        const getRememberGlobalCourseDefinition = typeof runtime.getRememberGlobalCourseDefinition === 'function'
            ? runtime.getRememberGlobalCourseDefinition : () => runtime.rememberGlobalCourseDefinition;
        const getPlanStorage = typeof runtime.getPlanStorage === 'function'
            ? runtime.getPlanStorage : () => runtime.planStorage;
        const refreshSemesterAccessibility = runtime.refreshSemesterAccessibility;
        const formatCreditValue = runtime.formatCreditValue;
        const evaluateGradeForLegacyTotals = runtime.evaluateGradeForLegacyTotals;
        const parseCreditValue = runtime.parseCreditValue;

        const catalogResolution = catalogResolutionFactory.create({
            document,
            getSemesterTermCode,
            getResolveGlobalCourseDefinition,
            getRememberGlobalCourseDefinition,
            refreshSemesterAccessibility,
            formatCreditValue,
            evaluateGradeForLegacyTotals,
            parseCreditValue,
        });
        const {
            formatTranscriptSemester,
            curriculumCourseOccurrences,
            curriculumSemesterName,
            transcriptTermCode,
            curriculumSemesterTermCode,
            curriculumSemestersForTranscriptTerm,
            transcriptCatalogRecordCode,
            resolveTranscriptCourseRecord,
            applyTranscriptCatalogRecordToOccurrence,
            recomputeSemesterTranscriptGpa,
            updateExistingTranscriptCourse,
        } = catalogResolution;

function mergeImportedSemesterIntoExisting(curriculum, createdContainer, targetSemester, courseData, previousContainerId) {
    if (!curriculum || !createdContainer || !targetSemester) return false;
    const createdElement = createdContainer.querySelector('.semester');
    const createdSemester = createdElement && typeof curriculum.getSemester === 'function'
        ? curriculum.getSemester(createdElement.id) : null;
    const targetElement = targetSemester.id && typeof document !== 'undefined'
        ? document.getElementById(targetSemester.id) : null;
    if (!createdElement || !createdSemester || !targetElement || createdSemester === targetSemester) return false;

    const createdIndex = curriculum.semesters.indexOf(createdSemester);
    const targetCourses = Array.isArray(targetSemester.courses)
        ? targetSemester.courses.slice() : [];
    const incomingCourses = Array.isArray(createdSemester.courses)
        ? createdSemester.courses.slice() : [];
    const incomingNodes = Array.from(createdElement.querySelectorAll('.course'));
    if (createdIndex < 0 || incomingCourses.length !== incomingNodes.length) return false;

    try {
        targetSemester.courses = targetCourses.concat(incomingCourses);
        incomingNodes.forEach((node) => targetElement.appendChild(node));
        curriculum.semesters.splice(createdIndex, 1);
        createdContainer.remove();
        if (Number.isInteger(previousContainerId)) curriculum.container_id = previousContainerId;
        try {
            if (typeof renumberSemesterContainers === 'function') {
                renumberSemesterContainers(curriculum);
            }
        } catch (_) {}
        recomputeSemesterTranscriptGpa(targetSemester, curriculum, courseData);
        try {
            if (typeof refreshSemesterAccessibility === 'function') refreshSemesterAccessibility();
        } catch (_) {}
        return true;
    } catch (_) {
        targetSemester.courses = targetCourses;
        incomingNodes.forEach((node) => {
            try { createdElement.appendChild(node); } catch (_) {}
        });
        if (curriculum.semesters.indexOf(createdSemester) < 0) {
            curriculum.semesters.splice(Math.max(0, createdIndex), 0, createdSemester);
        }
        if (Number.isInteger(previousContainerId)) curriculum.container_id = previousContainerId + 1;
        return false;
    }
}

function discardCreatedTranscriptSemester(curriculum, createdContainer, previousContainerId) {
    if (!curriculum || !createdContainer) return;
    try {
        const createdElement = createdContainer.querySelector('.semester');
        const createdSemester = createdElement && typeof curriculum.getSemester === 'function'
            ? curriculum.getSemester(createdElement.id) : null;
        const index = createdSemester && Array.isArray(curriculum.semesters)
            ? curriculum.semesters.indexOf(createdSemester) : -1;
        if (index >= 0) curriculum.semesters.splice(index, 1);
    } catch (_) {}
    try { createdContainer.remove(); } catch (_) {}
    if (Number.isInteger(previousContainerId)) curriculum.container_id = previousContainerId;
    try {
        if (typeof renumberSemesterContainers === 'function') {
            renumberSemesterContainers(curriculum);
        }
    } catch (_) {}
    try {
        if (typeof refreshSemesterAccessibility === 'function') refreshSemesterAccessibility();
    } catch (_) {}
}

function removeEmptySemestersCreatedAfter(curriculum, priorSemesterIds) {
    if (!curriculum || !Array.isArray(curriculum.semesters)) return;
    const prior = priorSemesterIds instanceof Set ? priorSemesterIds : new Set();
    for (let i = curriculum.semesters.length - 1; i >= 0; i--) {
        const semester = curriculum.semesters[i];
        if (!semester || prior.has(semester.id) || (Array.isArray(semester.courses) && semester.courses.length)) continue;
        try {
            if (typeof document !== 'undefined' && semester.id) {
                const node = document.getElementById(semester.id);
                const container = node && node.closest('.container_semester');
                if (container) container.remove();
            }
        } catch (_) {}
        curriculum.semesters.splice(i, 1);
    }
}

/**
 * Checks if parsed courses exist in the course data and creates semesters with valid courses
 * @param {Array} parsedCourses - Array of course objects parsed from the HTML
 * @param {Object} courseData - Course data from the program JSON
 * @param {Object} curriculum - The curriculum object to add courses to
 * @returns {Object} Statistics about the import process
 */
function importParsedCourses(parsedCourses, courseData, curriculum) {
    const inputCourses = Array.isArray(parsedCourses) ? parsedCourses : [];
    const invalidSemesterRecords = [];
    const importCandidates = [];
    inputCourses.forEach((course, sourceOrder) => {
        const code = canonicalTranscriptCourseCode(course && course.code);
        const semester = normalizeTranscriptSemester(course && course.semester);
        if (!semester) {
            invalidSemesterRecords.push({
                code: code,
                grade: String((course && course.grade) || '').trim(),
                semester: transcriptSemesterIssueLabel(course && course.semester),
                reason: TRANSCRIPT_SEMESTER_SKIP_REASON
            });
            return;
        }
        importCandidates.push(makeTranscriptCandidate(
            Object.assign({}, course, { code: code, semester: semester }),
            course && course.grade,
            course && course.gradingBasis,
            { sourceOrder }
        ));
    });
    const reconciled = reconcileTranscriptCandidates(importCandidates);
    const uniqueCodes = new Set(inputCourses
        .map(course => canonicalTranscriptCourseCode(course && course.code))
        .filter(Boolean));

    const stats = {
        totalRecords: inputCourses.length,
        totalCourses: uniqueCodes.size,
        importedCourses: 0,
        updatedCourses: [],
        addedCourses: [],
        alreadyPresentCourses: [],
        supersededCourses: reconciled.supersededCourses.slice(),
        skippedCourses: invalidSemesterRecords,
        notFoundCourses: [],
        retainedUnallocatedCourses: [],
        invalidGradeCourses: reconciled.invalidGradeCourses.slice()
    };
    // When we encounter courses that need to be created as custom courses
    // (based on their prefix), we'll push them into this array.  The
    // consuming code in main.js can then prompt the user to fill in
    // additional fields (e.g. engineering/basic science credits) for each
    // pending course.  Each entry will hold a reference to the newCourse
    // object that was inserted into courseData so it can be updated later.
    const pendingCustomCourses = [];

    // LANG definitions are persisted before semester creation so the planner
    // can resolve the imported occurrence. If creation later fails, undo only
    // this course's contextual definitions (preserving any other LANG courses
    // queued by the same import) and restore the exact runtime catalog entry.
    const rollbackPendingTranscriptLanguageCourse = (entry) => {
        if (!entry || !Array.isArray(entry.programCourses)) return false;
        const normalizedCode = canonicalTranscriptCourseCode(
            entry.parsedInfo && entry.parsedInfo.code
        );
        const storage = getPlanStorage();
        const sessionPlanId = storage && typeof storage.getSessionPlanId === 'function'
            ? storage.getSessionPlanId() : null;
        if (!normalizedCode || !storage || !sessionPlanId
            || typeof storage.getItem !== 'function'
            || typeof storage.setItem !== 'function') return false;

        const writes = [];
        try {
            entry.programCourses.forEach((link) => {
                const program = String((link && link.program) || '').trim().toUpperCase();
                if (!program) throw new Error('Missing language-course program context.');
                const key = 'customCourses_' + program;
                const previousRaw = storage.getItem(key, sessionPlanId);
                const current = JSON.parse(previousRaw || '[]');
                if (!Array.isArray(current)) throw new Error('Invalid saved custom-course list.');
                const currentIndex = current.findIndex(record =>
                    transcriptCatalogRecordCode(record) === normalizedCode
                );
                if (currentIndex < 0) throw new Error('Imported language-course definition is missing.');
                const next = current.slice();
                if (link.previousCourse && typeof link.previousCourse === 'object') {
                    next[currentIndex] = link.previousCourse;
                } else {
                    next.splice(currentIndex, 1);
                }
                const shouldRemoveMissingKey = !next.length
                    && (link.previousRaw === null || link.previousRaw === undefined);
                if (shouldRemoveMissingKey && typeof storage.removeItem === 'function') {
                    if (storage.removeItem(key, sessionPlanId) === false) {
                        throw new Error('Plan-scoped language-course rollback was rejected.');
                    }
                } else if (storage.setItem(key, JSON.stringify(next), sessionPlanId) === false) {
                    throw new Error('Plan-scoped language-course rollback was rejected.');
                }
                writes.push({ key, previousRaw });
            });
        } catch (rollbackError) {
            // Restore any program lists already changed by this rollback. The
            // original import definitions remain available for explicit user
            // recovery if browser storage itself rejects the transaction.
            for (let i = writes.length - 1; i >= 0; i--) {
                const write = writes[i];
                try {
                    if (write.previousRaw === null || write.previousRaw === undefined) {
                        if (typeof storage.removeItem === 'function') {
                            storage.removeItem(write.key, sessionPlanId);
                        }
                    } else {
                        storage.setItem(write.key, write.previousRaw, sessionPlanId);
                    }
                } catch (_) {}
            }
            return false;
        }

        const mutation = entry.courseDataMutation;
        if (mutation && mutation.kind === 'replaced'
            && mutation.previousCourse && typeof mutation.previousCourse === 'object') {
            let index = Array.isArray(courseData) ? courseData.indexOf(entry.course) : -1;
            if (index < 0 && Array.isArray(courseData) && Number.isInteger(mutation.index)
                && mutation.index >= 0 && mutation.index < courseData.length
                && transcriptCatalogRecordCode(courseData[mutation.index]) === normalizedCode) {
                index = mutation.index;
            }
            if (index >= 0) courseData[index] = mutation.previousCourse;
        } else if (mutation && mutation.kind === 'inserted' && Array.isArray(courseData)) {
            const index = courseData.lastIndexOf(entry.course);
            if (index >= 0) courseData.splice(index, 1);
        }

        const pendingIndex = pendingCustomCourses.indexOf(entry);
        if (pendingIndex >= 0) pendingCustomCourses.splice(pendingIndex, 1);
        return true;
    };

    // Group courses by semester
    const courseBySemester = {};

    // Parse the semester order to allow for correct sorting
    const getSemesterOrder = (semester) => {
        const order = transcriptSemesterOrder(semester);
        return order === null ? 0 : order;
    };

    reconciled.courses.forEach(course => {
        const gradeRecord = normalizeTranscriptGradeRecord(course.grade, course.gradingBasis);
        if (!gradeRecord) return;

        const importedSemester = formatTranscriptSemester(course.semester);
        const existingOccurrences = curriculumCourseOccurrences(curriculum, course.code);
        if (existingOccurrences.length === 1) {
            const occurrence = existingOccurrences[0];
            const existingSemester = curriculumSemesterName(occurrence.semester);
            const sameTerm = curriculumSemesterTermCode(occurrence.semester)
                && curriculumSemesterTermCode(occurrence.semester) === transcriptTermCode(importedSemester);
            if (sameTerm) {
                const resolution = resolveTranscriptCourseRecord(course, courseData, curriculum);
                const occurrenceChanged = resolution.isGlobal
                    ? applyTranscriptCatalogRecordToOccurrence(occurrence, resolution.record) : false;
                const gradeChanged = updateExistingTranscriptCourse(
                    occurrence, gradeRecord, curriculum, courseData
                );
                if (resolution.isGlobal) {
                    stats.retainedUnallocatedCourses.push({
                        code: course.code,
                        semester: importedSemester,
                        grade: gradeRecord.grade,
                        suCredits: Number(resolution.record.SU_credit || 0),
                        source: resolution.source,
                    });
                }
                if (resolution.changed || occurrenceChanged) {
                    recomputeSemesterTranscriptGpa(occurrence.semester, curriculum, courseData);
                }
                if (gradeChanged || resolution.changed || occurrenceChanged) {
                    stats.updatedCourses.push({ code: course.code, semester: importedSemester, grade: gradeRecord.grade });
                } else {
                    stats.alreadyPresentCourses.push({
                        code: course.code,
                        semester: importedSemester,
                        grade: gradeRecord.grade,
                        reason: 'unchanged'
                    });
                }
            } else {
                stats.alreadyPresentCourses.push({
                    code: course.code,
                    semester: existingSemester,
                    importedSemester: importedSemester,
                    grade: gradeRecord.grade,
                    reason: 'different-semester'
                });
            }
            return;
        }

        const matchingTermSemesters = curriculumSemestersForTranscriptTerm(curriculum, importedSemester);
        if (matchingTermSemesters.length > 1) {
            stats.skippedCourses.push({
                code: course.code,
                semester: importedSemester,
                grade: gradeRecord.grade,
                reason: 'ambiguous-existing-semester'
            });
            return;
        }
        if (existingOccurrences.length > 1) {
            stats.skippedCourses.push({
                code: course.code,
                semester: importedSemester,
                grade: gradeRecord.grade,
                reason: 'ambiguous-existing-occurrence'
            });
            return;
        }

        // Extract course code prefix and number for better matching
        const prefixMatch = course.code.match(/^[A-Z]+/);
        const numberMatch = course.code.match(/\d+[A-Z0-9]*/);
        if (!prefixMatch || !numberMatch) {
            stats.skippedCourses.push({
                code: course.code,
                semester: importedSemester,
                grade: gradeRecord.grade,
                reason: 'invalid-course-code'
            });
            return;
        }
        // Resolve against every selected program context. Program membership is
        // contextual: the same real course can be absent from the primary
        // catalog while belonging to a selected double major or minor.
        const resolution = resolveTranscriptCourseRecord(course, courseData, curriculum);
        const globalRecord = resolution.isGlobal ? resolution.record : null;
        let courseExists = !!resolution.record;
        const isTranscriptLanguage = isExactTranscriptLangCourseCode(course.code);

        // A course that is real but absent from the selected program/admit-term
        // catalogs must not be confused with an invalid course. The cumulative
        // course-page index is the catalog-independent identity layer. Main
        // loads it before import; the resolver returns a catalog-shaped record
        // with static type `unknown`, which deliberately yields effective N/A:
        // it can carry transcript credits into CGPA without claiming PGPA or
        // graduation-pool membership.
        if (globalRecord && !isTranscriptLanguage) {
            stats.retainedUnallocatedCourses.push({
                code: course.code,
                semester: importedSemester,
                grade: gradeRecord.grade,
                suCredits: Number(globalRecord.SU_credit || 0),
                source: resolution.source,
            });
        }

        // LANG is the exact synthetic subject used for exchange/Erasmus
        // language courses. It is not a transfer-grade marker: retain the
        // transcript's real grade and create a contextual course definition for
        // every selected degree. Language courses are free electives outside
        // FENS, while FENS keeps them visible/GPA-bearing but deliberately
        // unallocated (`unknown`) so they cannot inflate graduation totals.
        //
        // Persist every selected-program definition before exposing the main
        // definition to courseData. This prevents a partially classified double
        // major course from appearing imported when one of the writes fails.
        if (isTranscriptLanguage) {
            const programs = transcriptSelectedDegreePrograms(curriculum);
            const normalizedCode = canonicalTranscriptCourseCode(course.code);
            const identity = normalizedCode.match(/^([A-Z]+)(\d[A-Z0-9]*)$/);
            const languageLevelSuggestion = suggestedTranscriptLanguageLevel(course.title);
            const storage = getPlanStorage();
            const sessionPlanId = storage && typeof storage.getSessionPlanId === 'function'
                ? storage.getSessionPlanId() : null;
            const prepared = [];

            try {
                if (!programs.length || !identity || !storage || !sessionPlanId
                    || typeof storage.normalizeCustomCourse !== 'function'
                    || typeof storage.getItem !== 'function'
                    || typeof storage.setItem !== 'function') {
                    throw new Error('Plan-scoped language-course storage is unavailable.');
                }

                programs.forEach((program) => {
                    const key = 'customCourses_' + program;
                    const previousRaw = storage.getItem(key, sessionPlanId);
                    const parsed = JSON.parse(previousRaw || '[]');
                    if (!Array.isArray(parsed)) throw new Error('Invalid saved custom-course list.');
                    const existingIndex = parsed.findIndex(record =>
                        transcriptCatalogRecordCode(record) === normalizedCode
                    );
                    const existing = existingIndex >= 0 ? parsed[existingIndex] : null;
                    const existingLevel = existing
                        && ['basic', 'other', ''].includes(String(existing.Language_Level || '').toLowerCase())
                        ? String(existing.Language_Level || '').toLowerCase() : '';
                    const transcriptSu = Number(course.suCredits);
                    const transcriptEcts = Number(course.ects);
                    const existingSu = Number(existing && existing.SU_credit);
                    const existingEcts = Number(existing && existing.ECTS);
                    const su = Number.isFinite(transcriptSu) && transcriptSu > 0
                        ? transcriptSu : (Number.isFinite(existingSu) ? existingSu : 0);
                    const ects = Number.isFinite(transcriptEcts) && transcriptEcts > 0
                        ? transcriptEcts : (Number.isFinite(existingEcts) ? existingEcts : 0);
                    // Re-import refreshes transcript-authoritative identity/name/
                    // credit fields, but an existing program definition owns its
                    // classification. In particular, do not turn MAN Area, CS
                    // Core, or a minor Required choice back into an inferred
                    // default just because the same transcript was imported
                    // again.
                    const definition = storage.normalizeCustomCourse({
                        Major: identity[1],
                        Code: identity[2],
                        Course_Name: String(course.title || (existing && existing.Course_Name) || normalizedCode),
                        ECTS: String(ects),
                        Engineering: existing ? existing.Engineering : 0,
                        Basic_Science: existing ? existing.Basic_Science : 0,
                        SU_credit: String(su),
                        Faculty: existing ? existing.Faculty : '',
                        EL_Type: existing ? existing.EL_Type : transcriptLanguageTypeForProgram(program),
                        Faculty_Course: 'No',
                        // A title suggestion is only a review-form prefill. It
                        // must not become durable until the user explicitly
                        // saves the review, because reloading with the modal
                        // open must leave an unreviewed LANG course fail-closed.
                        // Preserve a level that the user reviewed previously.
                        Language_Level: existingLevel,
                    });
                    const nextList = parsed.slice();
                    if (existingIndex >= 0) nextList[existingIndex] = definition;
                    else nextList.push(definition);
                    prepared.push({
                        program,
                        key,
                        previousRaw,
                        // Keep the exact record that existed before this
                        // transcript import. The review UI uses this per-course
                        // backup instead of restoring the whole list, because a
                        // single import can queue several LANG courses at once.
                        // Restoring an older whole-list snapshot would erase
                        // later queued courses.
                        previousCourse: existingIndex >= 0
                            ? JSON.parse(JSON.stringify(existing)) : null,
                        previousIndex: existingIndex,
                        definition,
                        nextList,
                    });
                });

                const written = [];
                try {
                    prepared.forEach((entry) => {
                        if (storage.setItem(
                            entry.key,
                            JSON.stringify(entry.nextList),
                            sessionPlanId
                        ) === false) {
                            throw new Error('Plan-scoped language-course storage rejected the write.');
                        }
                        written.push(entry);
                    });
                } catch (storageError) {
                    // Best-effort rollback to the exact prior values. A missing
                    // key must remain missing rather than becoming an empty list.
                    for (let rollbackIndex = written.length - 1; rollbackIndex >= 0; rollbackIndex--) {
                        const entry = written[rollbackIndex];
                        try {
                            if (entry.previousRaw === null || entry.previousRaw === undefined) {
                                if (typeof storage.removeItem === 'function') {
                                    storage.removeItem(entry.key, sessionPlanId);
                                }
                            } else {
                                storage.setItem(entry.key, entry.previousRaw, sessionPlanId);
                            }
                        } catch (_) {}
                    }
                    throw storageError;
                }

                const mainProgram = String((curriculum && curriculum.major) || '').trim().toUpperCase();
                const mainEntry = prepared.find(entry => entry.program === mainProgram) || prepared[0];
                const mainDefinition = mainEntry && mainEntry.definition;
                if (!mainDefinition) throw new Error('No main language-course definition was created.');

                let courseDataMutation = { kind: 'none', index: -1, previousCourse: null };
                if (Array.isArray(courseData)) {
                    const dataIndex = courseData.findIndex(record =>
                        transcriptCatalogRecordCode(record) === normalizedCode
                    );
                    if (dataIndex < 0) {
                        courseData.push(mainDefinition);
                        courseDataMutation = {
                            kind: 'inserted',
                            index: courseData.length - 1,
                            previousCourse: null,
                        };
                    } else if (courseData[dataIndex] && courseData[dataIndex].__globalCourseDefinition) {
                        courseDataMutation = {
                            kind: 'replaced',
                            index: dataIndex,
                            previousCourse: courseData[dataIndex],
                        };
                        courseData[dataIndex] = mainDefinition;
                    }
                }
                pendingCustomCourses.push({
                    course: mainDefinition,
                    programCourses: prepared.map(entry => ({
                        program: entry.program,
                        course: entry.definition,
                        previousRaw: entry.previousRaw,
                        previousCourse: entry.previousCourse,
                        previousIndex: entry.previousIndex,
                    })),
                    courseDataMutation,
                    parsedInfo: {
                        code: normalizedCode,
                        title: course.title,
                        suCredits: Number(mainDefinition.SU_credit || 0),
                        ects: Number(mainDefinition.ECTS || 0),
                        elType: mainDefinition.EL_Type,
                        // Explicit prior review wins; otherwise seed only the
                        // pending form. The stored/runtime definition remains
                        // unreviewed until the form is saved.
                        Language_Level: mainDefinition.Language_Level || languageLevelSuggestion,
                    },
                });
                courseExists = true;
            } catch (languageCourseError) {
                stats.skippedCourses.push({
                    code: course.code,
                    semester: importedSemester,
                    grade: gradeRecord.grade,
                    reason: 'custom-course-storage-failed'
                });
                return;
            }
        }

        // If a non-LANG course does not exist, attempt to automatically add it
        // as a custom course for the legacy special elective prefixes. We use
        // both short and full prefixes (e.g., COR/CORE, ARE/AREA) to match
        // variations in the transcript. If a match is found we create a
        // placeholder course using the known credit information and queue it
        // for user confirmation via the custom course modal.
        if (!courseExists) {
            const code = course.code || '';
            let prefix = '';
            let elType = '';
            // Determine elective type based on prefix.  Accept both the
            // minimal three-letter form (COR, ARE, FEL, LANG) and their
            // longer forms (CORE, AREA, etc.).
            if (/^COR(E)?/.test(code)) {
                prefix = code.match(/^([A-Z]+)/)[0];
                elType = 'core';
            } else if (/^ARE(A)?/.test(code)) {
                prefix = code.match(/^([A-Z]+)/)[0];
                elType = 'area';
            } else if (/^FEL/.test(code)) {
                prefix = code.match(/^([A-Z]+)/)[0];
                elType = 'free';
            }
            if (elType) {
                const numMatch = code.match(/\d+[A-Z0-9]*/);
                const num = numMatch ? numMatch[0] : '';
                // Use the credit information from the parsed course when
                // available. Default to zero if missing.
                const su = (typeof course.suCredits === 'number' && !isNaN(course.suCredits)) ? course.suCredits : 0;
                const ectsVal = (typeof course.ects === 'number' && !isNaN(course.ects)) ? course.ects : 0;
                let newCourse = {
                    Major: prefix,
                    Code: num,
                    Course_Name: course.title || code,
                    ECTS: ectsVal.toString(),
                    Engineering: 0,
                    Basic_Science: 0,
                    SU_credit: su.toString(),
                    Faculty: '',
                    EL_Type: elType,
                    Faculty_Course: 'No'
                };
                try {
                    const storage = getPlanStorage();
                    if (!storage || typeof storage.normalizeCustomCourse !== 'function') {
                        throw new Error('Custom-course validation is unavailable.');
                    }
                    newCourse = storage.normalizeCustomCourse(newCourse);
                } catch (validationError) {
                    stats.notFoundCourses.push(course.code);
                    return;
                }
                // Persist the placeholder before exposing it to the live
                // catalog or planner. Otherwise a storage failure can create a
                // course that appears imported but disappears after reload.
                try {
                    const key = 'customCourses_' + curriculum.major;
                    const ps = getPlanStorage();
                    let existingRaw = null;
                    let sessionPlanId = null;
                    if (ps) {
                        sessionPlanId = ps.getSessionPlanId();
                        existingRaw = ps.getItem(key, sessionPlanId);
                    } else {
                        existingRaw = localStorage.getItem(key);
                    }
                    const existingList = JSON.parse(existingRaw || '[]');
                    existingList.push(newCourse);
                    if (ps) {
                        if (ps.setItem(key, JSON.stringify(existingList), sessionPlanId) === false) {
                            throw new Error('Plan-scoped custom-course storage rejected the write.');
                        }
                    } else {
                        localStorage.setItem(key, JSON.stringify(existingList));
                    }
                } catch (e) {
                    // A plan-scoped storage error must fail closed. Falling back
                    // to a legacy unscoped key could leak this course into a
                    // different plan after another tab changes the active plan.
                    stats.skippedCourses.push({
                        code: course.code,
                        semester: importedSemester,
                        grade: gradeRecord.grade,
                        reason: 'custom-course-storage-failed'
                    });
                    return;
                }
                // Only a durable placeholder may participate in this import.
                courseData.push(newCourse);
                // Queue this course for user confirmation.  We capture the
                // reference to the inserted course object and the parsed
                // information to prefill the form later.
                pendingCustomCourses.push({
                    course: newCourse,
                    parsedInfo: {
                        code: course.code,
                        title: course.title,
                        suCredits: su,
                        ects: ectsVal,
                        elType: elType
                    }
                });
                courseExists = true;
            }
        }

        if (courseExists) {
            // Get formatted semester name
            const formattedSemester = formatTranscriptSemester(course.semester);

            // Group by semester
            if (!courseBySemester[formattedSemester]) {
                courseBySemester[formattedSemester] = {
                    name: formattedSemester,
                    order: getSemesterOrder(course.semester),
                    existingSemesterId: matchingTermSemesters.length === 1
                        ? matchingTermSemesters[0].id : '',
                    courses: [],
                    grades: {}, // Store grades for each course
                    gradingBases: {}
                };
            }
            // Store course and its canonical grade metadata.
            courseBySemester[formattedSemester].courses.push(course.code);
            courseBySemester[formattedSemester].grades[course.code] = gradeRecord.grade;
            courseBySemester[formattedSemester].gradingBases[course.code] = gradeRecord.gradingBasis;
        } else {
            stats.notFoundCourses.push(course.code);
        }
    });

    // Sort semesters by their order (chronologically)
    const sortedSemesters = Object.values(courseBySemester)
        .sort((a, b) => a.order - b.order);  // Ascending order (oldest first)

    // Process in reverse order so oldest appears on the left.  When each
    // semester is inserted at the beginning, the oldest needs to be
    // inserted last.  We collect any courses with grades in the same
    // order as they appear in `sortedSemesters`.
    for (let i = sortedSemesters.length - 1; i >= 0; i--) {
        const semesterData = sortedSemesters[i];
        // Only create a semester if there is at least one course to add.
        if (semesterData.courses && semesterData.courses.length > 0) {
            const gradeList = semesterData.courses.map(courseCode => {
                return semesterData.grades[courseCode] || '';
            });
            const gradingBasisList = semesterData.courses.map(courseCode => {
                return semesterData.gradingBases[courseCode] || '';
            });
            const inspectableCurriculum = curriculum && Array.isArray(curriculum.semesters);
            const priorSemesterIds = new Set(inspectableCurriculum
                ? curriculum.semesters.map(semester => semester && semester.id) : []);
            const existingTarget = inspectableCurriculum && semesterData.existingSemesterId
                ? curriculum.semesters.find(semester => (
                    semester && semester.id === semesterData.existingSemesterId
                    && curriculumSemesterTermCode(semester) === transcriptTermCode(semesterData.name)
                )) : null;
            const createFn = getCreateSemester();
            let createSucceeded = false;
            if (createFn) {
                try {
                    const previousContainerId = Number(curriculum && curriculum.container_id);
                    const created = createFn(
                        existingTarget ? true : false,
                        semesterData.courses,
                        curriculum,
                        courseData,
                        gradeList,
                        semesterData.name,
                        gradingBasisList,
                    );
                    // Browser production is inspectable and requires the
                    // created container. Parser-only consumers historically
                    // inject a void creation callback, where a non-throwing
                    // call is the only available success signal.
                    createSucceeded = inspectableCurriculum ? !!created : true;
                    if (createSucceeded && existingTarget) {
                        createSucceeded = mergeImportedSemesterIntoExisting(
                            curriculum,
                            created,
                            existingTarget,
                            courseData,
                            Number.isInteger(previousContainerId) ? previousContainerId : null,
                        );
                        if (!createSucceeded) {
                            discardCreatedTranscriptSemester(
                                curriculum,
                                created,
                                Number.isInteger(previousContainerId) ? previousContainerId : null,
                            );
                        }
                    }
                } catch (error) {
                    console.error('Failed to create imported semester:', error);
                }
            }

            semesterData.courses.forEach((courseCode) => {
                const added = inspectableCurriculum
                    ? curriculumCourseOccurrences(curriculum, courseCode).length > 0
                    : createSucceeded;
                if (added) {
                    stats.importedCourses++;
                    stats.addedCourses.push({
                        code: courseCode,
                        semester: semesterData.name,
                        grade: semesterData.grades[courseCode] || ''
                    });
                } else {
                    const pendingLanguageEntry = pendingCustomCourses.find(entry =>
                        entry && Array.isArray(entry.programCourses)
                        && canonicalTranscriptCourseCode(entry.parsedInfo && entry.parsedInfo.code)
                            === canonicalTranscriptCourseCode(courseCode)
                    );
                    if (pendingLanguageEntry) {
                        rollbackPendingTranscriptLanguageCourse(pendingLanguageEntry);
                    }
                    stats.skippedCourses.push({
                        code: courseCode,
                        semester: semesterData.name,
                        grade: semesterData.grades[courseCode] || '',
                        reason: createFn ? 'create-failed' : 'create-unavailable'
                    });
                }
            });
            if (inspectableCurriculum) {
                removeEmptySemestersCreatedAfter(curriculum, priorSemesterIds);
            }
        }
    }

    stats.updatedCourseCount = stats.updatedCourses.length;
    stats.alreadyPresentCourseCount = stats.alreadyPresentCourses.length;
    stats.supersededCourseCount = stats.supersededCourses.length;
    stats.skippedCourseCount = stats.skippedCourses.length;
    stats.changedCourses = stats.importedCourses + stats.updatedCourseCount;

    // Only a real planner change needs a recalculation. In particular, a file
    // whose records all have invalid semesters must leave the live plan wholly
    // untouched rather than causing an unrelated allocation pass.
    if (stats.changedCourses > 0) {
        try {
            if (typeof curriculum.recalcEffectiveTypes === 'function') {
                curriculum.recalcEffectiveTypes(courseData);
            }
        } catch (err) {
            // Preserve the import result; the normal planner render path will
            // recalculate again after the next successful mutation/reload.
        }
    }

    // Imports may update only grades/bases or remove an empty temporary term,
    // so semester/course creation hooks alone do not cover every mutation.
    try {
        const storage = getPlanStorage();
        if (stats.changedCourses > 0 && storage && typeof storage.requestSave === 'function') {
            storage.requestSave(storage.getSessionPlanId());
        }
    } catch (_) {}

    // Finally, return both the import statistics and any pending custom
    // courses.  Do not return prematurely inside loops; returning here
    // ensures we process all semesters and recalc credits before
    // prompting the user for missing information.
    return {
        stats: stats,
        pendingCustomCourses: pendingCustomCourses
    };
}

        return Object.freeze({ importParsedCourses });
    }

    function browserDependencies(global) {
        return {
            document: global && global.document,
            localStorage: global && global.localStorage,
            getCreateSemester: () => global && global.createSemeter,
            getSemesterTermCode: () => global && global.semesterTermCode,
            getResolveGlobalCourseDefinition: () => global && global.resolveGlobalCourseDefinition,
            getRememberGlobalCourseDefinition: () => global && global.rememberGlobalCourseDefinition,
            getPlanStorage: () => global && global.planStorage,
            refreshSemesterAccessibility() {
                const fn = global && global.refreshSemesterAccessibility;
                if (typeof fn === 'function') return fn.apply(global, arguments);
            },
            formatCreditValue(value) {
                const fn = global && global.formatCreditValue;
                return typeof fn === 'function' ? fn(value) : String(value);
            },
            evaluateGradeForLegacyTotals(grade, basis) {
                const fn = global && global.evaluateGradeForLegacyTotals;
                return typeof fn === 'function' ? fn(grade, basis) : null;
            },
            parseCreditValue(value) {
                const fn = global && global.parseCreditValue;
                if (typeof fn === 'function') return fn(value);
                const parsed = parseFloat(value || 0);
                return Number.isFinite(parsed) ? parsed : 0;
            },
        };
    }

    const browserApi = createAcademicRecordsImporter(browserDependencies(root));
    namespace.academicRecordsImporter = Object.freeze({
        create: createAcademicRecordsImporter,
        importParsedCourses: browserApi.importParsedCourses,
    });
})(typeof window !== 'undefined' ? window : globalThis);
