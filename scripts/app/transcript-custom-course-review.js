// Transcript-import review queue and transactional rollback for custom courses.
// Program selection and catalog coordination remain owned by program_context.js.
(function installTranscriptCustomCourseReview(root) {
    'use strict';

    function createController(options) {
        const opts = options || {};
        const state = opts.state || {};
        const document = opts.document || root.document;
        const model = opts.model;
        const customCourseUi = opts.customCourseUi;
        if (!model) {
            throw new Error('Transcript custom-course review requires a custom-course model.');
        }
        if (!customCourseUi || !customCourseUi.runtime) {
            throw new Error('Transcript custom-course review requires the custom-course UI controller.');
        }

        const getCurriculum = state.getCurriculum || (() => null);
        const getCourseData = state.getCourseData || (() => []);
        const getPrimaryProgram = state.getPrimaryProgram || (() => '');
        const getPrimaryCustomRecords = state.getPrimaryCustomRecords || (() => []);
        const planGetItem = opts.planGetItem || (() => null);
        const planSetItem = opts.planSetItem || (() => false);
        const requestPlanSave = opts.requestPlanSave || (() => false);
        const uiAlert = opts.uiAlert || (() => Promise.resolve());
        const escapeHtml = opts.escapeHtml || ((value) => String(value == null ? '' : value));

        const getCombinedCodeFromCourseObj = model.getCombinedCode;
        const loadCustomCoursesForMajor = model.loadStoredCourses;
        const { restoreStoredValue } = customCourseUi;
        const {
            getActiveContextProgramCodes,
            replaceContextRuntimeCustomCourses,
            refreshCourseDatalistsAndTypes,
        } = customCourseUi.runtime;

        function rollbackPendingTranscriptCustomCourse(entry) {
            const pendingCourse = entry && entry.course;
            const targetCode = getCombinedCodeFromCourseObj(pendingCourse);
            if (!pendingCourse || !targetCode) return true;

            const majorKey = String((getCurriculum() && getCurriculum().major) || getPrimaryProgram() || '').toUpperCase();
            const linkedPrograms = Array.isArray(entry && entry.programCourses)
                && entry.programCourses.length
                ? entry.programCourses
                : [{ program: majorKey, course: pendingCourse }];
            const storageBackups = [];
            const seenPrograms = new Set();
            const restoreStorageBackups = function() {
                let restored = true;
                for (let i = storageBackups.length - 1; i >= 0; i--) {
                    if (restoreStoredValue(storageBackups[i].key, storageBackups[i].previousRaw) === false) {
                        restored = false;
                    }
                }
                return restored;
            };
            const rollbackStorageFailed = function() {
                restoreStorageBackups();
                uiAlert(
                    'Could not remove imported course',
                    `<p><strong>${escapeHtml(targetCode)}</strong> is still saved because browser storage rejected the rollback. The review form has been left open.</p>`
                );
                return false;
            };
            for (let linkIndex = 0; linkIndex < linkedPrograms.length; linkIndex++) {
                const link = linkedPrograms[linkIndex] || {};
                const program = String(link.program || majorKey).toUpperCase();
                if (!program || seenPrograms.has(program)) continue;
                seenPrograms.add(program);
                const linkedCode = getCombinedCodeFromCourseObj(link.course) || targetCode;
                const key = 'customCourses_' + program;
                const previousRaw = planGetItem(key);
                let stored;
                try {
                    stored = JSON.parse(previousRaw || '[]');
                    if (!Array.isArray(stored)) return rollbackStorageFailed();
                } catch (_) {
                    return rollbackStorageFailed();
                }
                let storedIndex = -1;
                for (let i = stored.length - 1; i >= 0; i--) {
                    if (getCombinedCodeFromCourseObj(stored[i]) === linkedCode) {
                        storedIndex = i;
                        break;
                    }
                }
                // The importer durably wrote every linked definition before it
                // opened this review. A missing one means storage changed under
                // us, so fail closed instead of dismissing the review with a
                // partially rolled-back plan.
                if (storedIndex < 0) return rollbackStorageFailed();
                const nextStored = stored.slice();
                if (link.previousCourse && typeof link.previousCourse === 'object') {
                    // Restore only this record, not the import-time whole-list
                    // snapshot. Other LANG courses may have been queued after
                    // this one and must remain available for their own review.
                    nextStored[storedIndex] = link.previousCourse;
                } else {
                    nextStored.splice(storedIndex, 1);
                }
                storageBackups.push({ key, previousRaw });
                if (planSetItem(key, JSON.stringify(nextStored)) === false) {
                    return rollbackStorageFailed();
                }
            }

            const affectedSemesters = [];
            try {
                const semesters = getCurriculum() && Array.isArray(getCurriculum().semesters)
                    ? getCurriculum().semesters.slice() : [];
                semesters.forEach(function(semester) {
                    if (!semester || !Array.isArray(semester.courses)) return;
                    const matches = semester.courses.filter(function(course) {
                        return String((course && course.code) || '').toUpperCase().replace(/\s+/g, '') === targetCode;
                    });
                    if (!matches.length) return;
                    affectedSemesters.push(semester);
                    matches.forEach(function(course) {
                        const node = course && course.id ? document.getElementById(course.id) : null;
                        const deleteButton = node ? node.querySelector('.delete_course') : null;
                        if (deleteButton) {
                            try { deleteButton.click(); } catch (_) {}
                        }
                        if (semester.courses.includes(course)) {
                            try {
                                if (typeof semester.deleteCourse === 'function') semester.deleteCourse(course.id);
                                else semester.courses.splice(semester.courses.indexOf(course), 1);
                            } catch (_) {}
                            try { if (node) node.remove(); } catch (_) {}
                        }
                    });
                });
            } catch (_) {}

            affectedSemesters.forEach(function(semester) {
                if (!semester || !Array.isArray(semester.courses) || semester.courses.length) return;
                const semesterNode = semester.id ? document.getElementById(semester.id) : null;
                const container = semesterNode && semesterNode.closest
                    ? semesterNode.closest('.container_semester') : null;
                const deleteButton = container ? container.querySelector('.delete_semester') : null;
                if (deleteButton) {
                    try { deleteButton.click(); } catch (_) {}
                }
                if (getCurriculum() && Array.isArray(getCurriculum().semesters) && getCurriculum().semesters.includes(semester)) {
                    try {
                        if (typeof getCurriculum().deleteSemester === 'function') getCurriculum().deleteSemester(semester.id);
                        else getCurriculum().semesters.splice(getCurriculum().semesters.indexOf(semester), 1);
                    } catch (_) {}
                    try { if (container) container.remove(); } catch (_) {}
                }
            });

            try {
                const dataMutation = entry && entry.courseDataMutation;
                if (dataMutation && dataMutation.kind === 'replaced'
                    && dataMutation.previousCourse && typeof dataMutation.previousCourse === 'object') {
                    let idx = getCourseData().indexOf(pendingCourse);
                    if (idx < 0 && Number.isInteger(dataMutation.index)
                        && dataMutation.index >= 0 && dataMutation.index < getCourseData().length
                        && getCombinedCodeFromCourseObj(getCourseData()[dataMutation.index]) === targetCode) {
                        idx = dataMutation.index;
                    }
                    if (idx >= 0) getCourseData()[idx] = dataMutation.previousCourse;
                } else if (!dataMutation || dataMutation.kind === 'inserted') {
                    // Remove only the exact runtime object inserted by this
                    // import. Falling back to a code match could delete a base
                    // catalog row when the imported definition was never added.
                    const idx = getCourseData().lastIndexOf(pendingCourse);
                    if (idx >= 0) getCourseData().splice(idx, 1);
                }
            } catch (_) {}

            // Restore the linked contextual definitions in the live custom
            // catalogs too. A re-import can temporarily replace an existing
            // definition, so simply removing the importer object would leave
            // storage and the running planner out of sync.
            linkedPrograms.forEach(function(link) {
                if (!link) return;
                const program = String(link.program || majorKey).toUpperCase();
                const linkedCode = getCombinedCodeFromCourseObj(link.course) || targetCode;
                const previousCourse = link.previousCourse && typeof link.previousCourse === 'object'
                    ? link.previousCourse : null;

                if (program === majorKey) {
                    let index = getPrimaryCustomRecords().indexOf(link.course);
                    if (index < 0) {
                        index = getPrimaryCustomRecords().findIndex(function(record) {
                            return getCombinedCodeFromCourseObj(record) === linkedCode;
                        });
                    }
                    if (previousCourse) {
                        if (index >= 0) {
                            const runtimeRecord = getPrimaryCustomRecords()[index];
                            getPrimaryCustomRecords()[index] = previousCourse;
                            const runtimeIndex = getCourseData().indexOf(runtimeRecord);
                            if (runtimeIndex >= 0) getCourseData()[runtimeIndex] = previousCourse;
                        } else {
                            getPrimaryCustomRecords().push(previousCourse);
                            if (!getCourseData().some(function(record) {
                                return getCombinedCodeFromCourseObj(record) === linkedCode;
                            })) getCourseData().push(previousCourse);
                        }
                    } else if (index >= 0 && getPrimaryCustomRecords()[index] === link.course) {
                        const runtimeRecord = getPrimaryCustomRecords()[index];
                        getPrimaryCustomRecords().splice(index, 1);
                        const runtimeIndex = getCourseData().indexOf(runtimeRecord);
                        if (runtimeIndex >= 0) getCourseData().splice(runtimeIndex, 1);
                    }
                    return;
                }

                if (!getActiveContextProgramCodes().includes(program)) return;
                replaceContextRuntimeCustomCourses(program, loadCustomCoursesForMajor(program));
            });

            refreshCourseDatalistsAndTypes();
            requestPlanSave();
            return true;
        }

        // Helper to sequentially process a list of pending custom courses.
        // Each entry should contain a `course` (reference to the course object
        // already added to getCourseData()) and optionally a `parsedInfo` object
        // containing raw code/title/credits extracted from the transcript. The
        // function will show the custom course modal prefilled with the known
        // information and allow the user to complete any missing fields. Once
        // the user saves or cancels, the next pending course is processed.
        function processPendingCustomCourses(list) {
            if (!Array.isArray(list) || list.length === 0) return;
            const next = list.shift();
            const prefill = {};
            if (next.parsedInfo && next.parsedInfo.code) {
                prefill.code = next.parsedInfo.code;
            } else if (next.course && next.course.Major && next.course.Code) {
                prefill.code = next.course.Major + next.course.Code;
            }
            if (next.parsedInfo && next.parsedInfo.title) {
                prefill.name = next.parsedInfo.title;
            } else if (next.course && next.course.Course_Name) {
                prefill.name = next.course.Course_Name;
            }
            if (next.course) {
                prefill.suCredits = next.course.SU_credit;
                prefill.ects = next.course.ECTS;
                prefill.basicScience = next.course.Basic_Science;
                prefill.engineering = next.course.Engineering;
                prefill.elType = next.course.EL_Type;
            }
            if (next.parsedInfo && next.parsedInfo.Language_Level !== undefined) {
                prefill.languageLevel = next.parsedInfo.Language_Level;
            } else if (next.course && next.course.Language_Level !== undefined) {
                prefill.languageLevel = next.course.Language_Level;
            }
            // Show the custom course form. Pass the existing course object so
            // that the save handler updates it instead of creating a new one.
            customCourseUi.showPendingReview({
                prefill,
                course: next.course,
                onSave: function() { processPendingCustomCourses(list); },
                onCancel: function() { return rollbackPendingTranscriptCustomCourse(next); },
                linkedProgramCourses: next.programCourses,
            });
        }

        return Object.freeze({
            processPendingCustomCourses,
            rollbackPendingTranscriptCustomCourse,
        });
    }

    root.surriculumTranscriptCustomCourseReview = Object.freeze({ createController });
})(typeof window !== 'undefined' ? window : globalThis);
