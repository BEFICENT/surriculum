// Runtime custom-course catalog and semester occurrence coordination.
// All mutable planner state is supplied through accessors by main.js.
(function (global) {
    'use strict';

    function createController(options) {
        const opts = options || {};
        const state = opts.state || {};
        const model = opts.model;
        if (!model) throw new Error('Custom-course runtime requires a model instance.');

        const document = opts.document || global.document;
        const getCurriculum = state.getCurriculum || (() => null);
        const getCourseData = state.getCourseData || (() => []);
        const getPrimaryProgram = state.getPrimaryProgram || (() => '');
        const getPrimaryCatalogCodes = state.getPrimaryCatalogCodes || (() => new Set());
        const getPrimaryCustomRecords = state.getPrimaryCustomRecords || (() => []);
        const setPrimaryCustomRecords = state.setPrimaryCustomRecords || (() => {});
        const getDoubleMajorCourseData = state.getDoubleMajorCourseData || (() => []);
        const getDoubleMajorCatalogCodes = state.getDoubleMajorCatalogCodes || (() => new Set());
        const getDoubleMajorCustomRecords = state.getDoubleMajorCustomRecords || (() => []);
        const setDoubleMajorCustomRecords = state.setDoubleMajorCustomRecords || (() => {});
        const getMinorCourseData = state.getMinorCourseData || (() => ({}));
        const getMinorCatalogCodeSets = state.getMinorCatalogCodeSets || (() => ({}));
        const getMinorCustomRecords = state.getMinorCustomRecords || (() => ({}));
        const normalizeCustomCourseListForStorage = opts.normalizeList || ((_program, list) => list);
        const populateCourseDataList = opts.populateCourseDataList || (() => {});
        const updateDatalistForDoubleMajor = opts.updateDatalistForDoubleMajor;
        const parseCreditValue = opts.parseCreditValue;
        const formatCreditValue = opts.formatCreditValue;

        const normalizeCombinedCourseCode = model.normalizeCombinedCode;
        const getCombinedCodeFromCourseObj = model.getCombinedCode;
        const getSemesterOccurrenceCode = model.getOccurrenceCode;
        const _customClassificationIdentity = model.identity;
        const _customClassificationIdentitySet = model.identitySet;
        const _activeCustomCourseRecords = model.activeRecords;

        function updateCourseOccurrenceDom(semester, occurrence, previousCode, nextCode, definition) {
            const nodes = [];
            try {
                if (occurrence && typeof occurrence === 'object' && occurrence.id) {
                    const node = document.getElementById(occurrence.id);
                    if (node) nodes.push(node);
                }
                if (!nodes.length && semester && semester.id) {
                    const semesterNode = document.getElementById(semester.id);
                    if (semesterNode) {
                        semesterNode.querySelectorAll('.course').forEach(function(node) {
                            const label = node.querySelector('.course_code');
                            if (normalizeCombinedCourseCode(label && label.textContent) === previousCode) nodes.push(node);
                        });
                    }
                }
            } catch (_) {}
            nodes.forEach(function(node) {
                try {
                    const codeNode = node.querySelector('.course_code');
                    if (codeNode) codeNode.textContent = nextCode;
                    if (!definition) return;
                    const nameNode = node.querySelector('.course_name');
                    if (nameNode) nameNode.textContent = String(definition.Course_Name || nextCode);
                    const typeNode = node.querySelector('.course_type');
                    if (typeNode) typeNode.textContent = String(definition.EL_Type || 'none').toUpperCase();
                    const creditNode = node.querySelector('.course_credit');
                    if (creditNode) {
                        const credit = (typeof parseCreditValue === 'function')
                            ? parseCreditValue(definition.SU_credit || '0')
                            : (parseFloat(definition.SU_credit || '0') || 0);
                        const text = (typeof formatCreditValue === 'function')
                            ? formatCreditValue(credit) : Number(credit).toFixed(1);
                        creditNode.textContent = text + ' credits';
                    }
                    const bsNode = node.querySelector('.course_bs_credit');
                    if (bsNode) bsNode.textContent = 'BS: ' + (definition.Basic_Science || '0') + ' credits';
                } catch (_) {}
            });
        }

        function renameSemesterOccurrences(previousCode, nextCode, definition) {
            const oldCode = normalizeCombinedCourseCode(previousCode);
            const newCode = normalizeCombinedCourseCode(nextCode);
            const changed = [];
            if (!getCurriculum() || !Array.isArray(getCurriculum().semesters)) return changed;
            getCurriculum().semesters.forEach(function(semester) {
                if (!semester || !Array.isArray(semester.courses)) return;
                for (let i = 0; i < semester.courses.length; i++) {
                    const occurrence = semester.courses[i];
                    if (getSemesterOccurrenceCode(occurrence) !== oldCode) continue;
                    changed.push({ semester, index: i, occurrence, wasString: typeof occurrence === 'string' });
                    if (typeof occurrence === 'string') semester.courses[i] = newCode;
                    else occurrence.code = newCode;
                    updateCourseOccurrenceDom(semester, occurrence, oldCode, newCode, definition);
                }
            });
            return changed;
        }

        function refreshSemesterOccurrenceDom(combinedCode, definition) {
            const target = normalizeCombinedCourseCode(combinedCode);
            if (!getCurriculum() || !Array.isArray(getCurriculum().semesters)) return;
            getCurriculum().semesters.forEach(function(semester) {
                if (!semester || !Array.isArray(semester.courses)) return;
                semester.courses.forEach(function(occurrence) {
                    if (getSemesterOccurrenceCode(occurrence) === target) {
                        updateCourseOccurrenceDom(semester, occurrence, target, target, definition);
                    }
                });
            });
        }

        function removeSemesterOccurrencesByCode(combinedCode) {
            const target = normalizeCombinedCourseCode(combinedCode);
            let removed = 0;
            if (!getCurriculum() || !Array.isArray(getCurriculum().semesters)) return removed;
            getCurriculum().semesters.forEach(function(semester) {
                if (!semester || !Array.isArray(semester.courses)) return;
                const matches = semester.courses.slice().filter(function(occurrence) {
                    return getSemesterOccurrenceCode(occurrence) === target;
                });
                matches.forEach(function(occurrence) {
                    const node = occurrence && typeof occurrence === 'object' && occurrence.id
                        ? document.getElementById(occurrence.id) : null;
                    const deleteButton = node ? node.querySelector('.delete_course') : null;
                    if (deleteButton) {
                        try { deleteButton.click(); } catch (_) {}
                    }
                    if (semester.courses.includes(occurrence)) {
                        try {
                            if (occurrence && typeof occurrence === 'object' && occurrence.id
                                && typeof semester.deleteCourse === 'function') {
                                semester.deleteCourse(occurrence.id);
                            } else {
                                semester.courses.splice(semester.courses.indexOf(occurrence), 1);
                            }
                        } catch (_) {}
                        try { if (node) node.remove(); } catch (_) {}
                    }
                    removed++;
                });
            });
            return removed;
        }

        function removeCourseDataRecord(record, combinedCode) {
            let index = record ? getCourseData().indexOf(record) : -1;
            if (index < 0) {
                const target = normalizeCombinedCourseCode(combinedCode);
                for (let i = getCourseData().length - 1; i >= 0; i--) {
                    if (getCombinedCodeFromCourseObj(getCourseData()[i]) === target) {
                        index = i;
                        break;
                    }
                }
            }
            if (index >= 0) getCourseData().splice(index, 1);
        }

        function removeDoubleMajorCustomRecordAt(index) {
            if (!Number.isInteger(index) || index < 0 || index >= getDoubleMajorCustomRecords().length) return null;
            const record = getDoubleMajorCustomRecords()[index];
            const runtimeIndex = getDoubleMajorCourseData().indexOf(record);
            if (runtimeIndex >= 0) getDoubleMajorCourseData().splice(runtimeIndex, 1);
            getDoubleMajorCustomRecords().splice(index, 1);
            return record;
        }

        function removeDoubleMajorCustomRecordsAt(indexes) {
            Array.from(new Set(indexes || [])).sort(function(a, b) { return b - a; })
                .forEach(removeDoubleMajorCustomRecordAt);
        }

        function replaceDoubleMajorCustomRecordAt(index, record) {
            const previous = getDoubleMajorCustomRecords()[index];
            const runtimeIndex = previous ? getDoubleMajorCourseData().indexOf(previous) : -1;
            if (index >= 0 && index < getDoubleMajorCustomRecords().length) {
                getDoubleMajorCustomRecords()[index] = record;
            } else {
                getDoubleMajorCustomRecords().push(record);
            }
            if (runtimeIndex >= 0) getDoubleMajorCourseData()[runtimeIndex] = record;
            else getDoubleMajorCourseData().push(record);
        }

        function getActiveContextProgramCodes() {
            const primary = String((getCurriculum() && getCurriculum().major) || getPrimaryProgram() || '').toUpperCase();
            const candidates = [];
            try { candidates.push(getCurriculum() && getCurriculum().doubleMajor); } catch (_) {}
            try {
                if (getCurriculum() && Array.isArray(getCurriculum().minors)) {
                    getCurriculum().minors.forEach(function(code) { candidates.push(code); });
                }
            } catch (_) {}
            const seen = new Set(primary ? [primary] : []);
            const programs = [];
            candidates.forEach(function(rawCode) {
                const code = String(rawCode || '').trim().toUpperCase();
                if (!code || seen.has(code)) return;
                seen.add(code);
                programs.push(code);
            });
            return programs;
        }

        function getContextCatalogCodeSet(programCode) {
            const program = String(programCode || '').toUpperCase();
            if (program && program === String((getCurriculum() && getCurriculum().doubleMajor) || '').toUpperCase()) {
                return getDoubleMajorCatalogCodes();
            }
            return getMinorCatalogCodeSets()[program] || new Set();
        }

        function getContextCourseData(programCode) {
            const program = String(programCode || '').toUpperCase();
            if (program && program === String((getCurriculum() && getCurriculum().doubleMajor) || '').toUpperCase()) {
                return getDoubleMajorCourseData();
            }
            return getMinorCourseData()[program] || [];
        }

        function findOfficialContextCourse(programCode, combinedCode) {
            const target = _customClassificationIdentity(combinedCode);
            const catalogIdentities = _customClassificationIdentitySet(getContextCatalogCodeSet(programCode));
            if (!target || !catalogIdentities.has(target)) return null;
            const data = getContextCourseData(programCode);
            for (let i = 0; i < data.length; i++) {
                if (_customClassificationIdentity(getCombinedCodeFromCourseObj(data[i])) === target
                    && !data[i].__globalCourseDefinition) return data[i];
            }
            return null;
        }

        function replaceContextRuntimeCustomCourses(programCode, storedList) {
            const program = String(programCode || '').toUpperCase();
            const catalogCodes = getContextCatalogCodeSet(program);
            const normalized = normalizeCustomCourseListForStorage(program, Array.isArray(storedList) ? storedList : []);
            // A stale imported overlay may collide with an official row. Keep it
            // durable until the user edits that course, but never activate it.
            const runtimeList = _activeCustomCourseRecords(normalized, catalogCodes);

            if (program && program === String((getCurriculum() && getCurriculum().doubleMajor) || '').toUpperCase()) {
                const previous = new Set(getDoubleMajorCustomRecords());
                for (let i = getDoubleMajorCourseData().length - 1; i >= 0; i--) {
                    if (previous.has(getDoubleMajorCourseData()[i])) getDoubleMajorCourseData().splice(i, 1);
                }
                setDoubleMajorCustomRecords(runtimeList);
                runtimeList.forEach(function(record) { getDoubleMajorCourseData().push(record); });
                getCurriculum().doubleMajorCourseData = getDoubleMajorCourseData();
                return;
            }

            const data = getMinorCourseData()[program];
            if (!Array.isArray(data)) return;
            const previous = new Set(getMinorCustomRecords()[program] || []);
            for (let i = data.length - 1; i >= 0; i--) {
                if (previous.has(data[i])) data.splice(i, 1);
            }
            getMinorCustomRecords()[program] = runtimeList;
            runtimeList.forEach(function(record) { data.push(record); });
            if (getCurriculum() && getCurriculum().minorCourseDataByCode) {
                getCurriculum().minorCourseDataByCode[program] = data;
            }
        }

        function replacePrimaryRuntimeCustomCourses(storedList) {
            const normalized = normalizeCustomCourseListForStorage(
                String((getCurriculum() && getCurriculum().major) || getPrimaryProgram() || '').toUpperCase(),
                Array.isArray(storedList) ? storedList : []
            );
            const runtimeList = _activeCustomCourseRecords(normalized, getPrimaryCatalogCodes());
            const previous = new Set(getPrimaryCustomRecords());
            for (let i = getCourseData().length - 1; i >= 0; i--) {
                if (previous.has(getCourseData()[i])) getCourseData().splice(i, 1);
            }
            setPrimaryCustomRecords(runtimeList);
            runtimeList.forEach(function(record) { getCourseData().push(record); });
        }

        function refreshCourseDatalistsAndTypes() {
            try {
                document.querySelectorAll('datalist.course_list').forEach(function(dl) {
                    populateCourseDataList(dl, getCourseData());
                });
            } catch (_) {}
            try {
                if (typeof getCurriculum().recalcEffectiveTypes === 'function') {
                    getCurriculum().recalcEffectiveTypes(getCourseData());
                }
            } catch (_) {}
            try {
                if (getCurriculum().doubleMajor && typeof getCurriculum().recalcEffectiveTypesDouble === 'function') {
                    getCurriculum().recalcEffectiveTypesDouble(getDoubleMajorCourseData());
                }
            } catch (_) {}
            try {
                if (getCurriculum().doubleMajor && typeof updateDatalistForDoubleMajor === 'function') {
                    updateDatalistForDoubleMajor();
                }
            } catch (_) {}
        }

        return Object.freeze({
            updateCourseOccurrenceDom,
            renameSemesterOccurrences,
            refreshSemesterOccurrenceDom,
            removeSemesterOccurrencesByCode,
            removeCourseDataRecord,
            removeDoubleMajorCustomRecordAt,
            removeDoubleMajorCustomRecordsAt,
            replaceDoubleMajorCustomRecordAt,
            getActiveContextProgramCodes,
            getContextCatalogCodeSet,
            getContextCourseData,
            findOfficialContextCourse,
            replaceContextRuntimeCustomCourses,
            replacePrimaryRuntimeCustomCourses,
            refreshCourseDatalistsAndTypes,
        });
    }

    global.surriculumCustomCourseRuntime = Object.freeze({ createController });
})(typeof window !== 'undefined' ? window : globalThis);
