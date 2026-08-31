// Custom-course management and form UI coordinator.
// Composes the custom-course model and runtime while reading live planner state
// exclusively through the injected accessors.
(function installCustomCourseUi(root) {
    'use strict';

    function createController(options) {
        const opts = options || {};
        const state = opts.state || {};
        const document = opts.document || root.document;
        const model = opts.model;
        const runtimeFactory = opts.runtimeFactory || root.surriculumCustomCourseRuntime;
        if (!model) throw new Error('Custom-course UI requires a model instance.');
        if (!runtimeFactory || typeof runtimeFactory.createController !== 'function') {
            throw new Error('Custom-course UI requires the custom-course runtime.');
        }

        const getCurriculum = state.getCurriculum || (() => null);
        const getCourseData = state.getCourseData || (() => []);
        const getPrimaryProgram = state.getPrimaryProgram || (() => '');
        const getPrimaryCatalogIdentitySet = state.getPrimaryCatalogIdentities || (() => new Set());
        const getPrimaryCatalogData = state.getPrimaryCatalogData || (() => []);
        const getPrimaryCustomRecords = state.getPrimaryCustomRecords || (() => []);

        const normalizeCustomCourseForStorage = opts.normalizeCourse || ((course) => course);
        const normalizeCustomCourseListForStorage = opts.normalizeList || ((_program, list) => list);
        const populateCourseDataList = opts.populateCourseDataList || (() => {});
        const updateDatalistForDoubleMajor = opts.updateDatalistForDoubleMajor;
        const parseCreditValue = opts.parseCreditValue;
        const formatCreditValue = opts.formatCreditValue;
        const planGetItem = opts.planGetItem || (() => null);
        const planSetItem = opts.planSetItem || (() => false);
        const planRemoveItem = opts.planRemoveItem || (() => false);
        const requestPlanSave = opts.requestPlanSave || (() => false);
        const flushPlanSaves = opts.flushPlanSaves || (() => false);
        const uiAlert = opts.uiAlert || (() => Promise.resolve());
        const uiConfirm = opts.uiConfirm || (() => Promise.resolve(false));
        const escapeHtml = opts.escapeHtml || ((value) => String(value == null ? '' : value));
        const activateAccessibleDialog = opts.activateAccessibleDialog || ((overlay) => ({
            close() { try { overlay.remove(); } catch (_) {} },
        }));
        const location = opts.location || root.location || { reload() {} };

        const getCombinedCodeFromCourseObj = model.getCombinedCode;
        const normalizeCombinedCourseCode = model.normalizeCombinedCode;
        const splitCombinedCourseCode = model.splitCombinedCode;
        const titleExplicitlySaysBasicLanguage = model.titleExplicitlySaysBasicLanguage;
        const isCustomLanguageCandidate = model.isLanguageCandidate;
        const findCustomCourseStorageIndex = model.findStorageIndex;
        const loadCustomCoursesForMajor = model.loadStoredCourses;
        const _customClassificationIdentity = model.identity;

        const customCourseRuntime = runtimeFactory.createController({
            model,
            normalizeList: normalizeCustomCourseListForStorage,
            document,
            parseCreditValue,
            formatCreditValue,
            populateCourseDataList,
            updateDatalistForDoubleMajor,
            state,
        });
        const {
            renameSemesterOccurrences,
            refreshSemesterOccurrenceDom,
            removeSemesterOccurrencesByCode,
            removeCourseDataRecord,
            removeDoubleMajorCustomRecordsAt,
            getActiveContextProgramCodes,
            findOfficialContextCourse,
            replaceContextRuntimeCustomCourses,
            replacePrimaryRuntimeCustomCourses,
            refreshCourseDatalistsAndTypes,
        } = customCourseRuntime;

        function customCourseIdentityConflict(list, combinedCode, excludedIndex) {
            const target = _customClassificationIdentity(combinedCode);
            const editingSameDormantOverlay = Number.isInteger(excludedIndex)
                && excludedIndex >= 0 && excludedIndex < list.length
                && _customClassificationIdentity(getCombinedCodeFromCourseObj(list[excludedIndex])) === target;
            if (getPrimaryCatalogIdentitySet().has(target) && !editingSameDormantOverlay) return 'catalog';
            for (let i = 0; i < list.length; i++) {
                if (i === excludedIndex) continue;
                if (_customClassificationIdentity(getCombinedCodeFromCourseObj(list[i])) === target) return 'custom';
            }
            return '';
        }


        function restoreStoredValue(key, rawValue) {
            return rawValue === null ? planRemoveItem(key) : planSetItem(key, rawValue);
        }



        let programCategoryHelpSequence = 0;
        const programCategoryHelpDescriptions = {
            required: ['Required', 'Starts in the required pool. A custom choice does not create a named or equivalent requirement, approve a substitution, or grant university approval.'],
            core: ['Core', 'Starts in the program\'s core-elective pool.'],
            area: ['Area', 'Starts in an area, concentration, or specialization pool.'],
            university: ['University', 'Stays in the university-course pool, but does not replace a specifically named university requirement.'],
            free: ['Free', 'Stays in the free-elective pool.'],
            none: ['None', 'Uses no category pool or program GPA (PGPA), although main-plan SU/ECTS may still count toward the overall degree total.'],
            unknown: ['N/A', 'Contributes nothing through this program. CGPA and treatment by other selected programs remain separate.'],
        };

        function createProgramCategoryHelp(programCode, availableTypes) {
            const code = String(programCode || 'program').trim().toUpperCase() || 'PROGRAM';
            const types = Array.isArray(availableTypes) ? availableTypes : [];
            const isMinor = !types.includes('university') && !types.includes('none');
            const panelId = `program-category-help-${++programCategoryHelpSequence}`;
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'program-category-help';
            button.textContent = '?';
            button.setAttribute('aria-label', `Explain ${code} course categories`);
            button.setAttribute('aria-controls', panelId);
            button.setAttribute('aria-expanded', 'false');

            const panel = document.createElement('div');
            panel.id = panelId;
            panel.className = 'program-category-help-text is-hidden';
            panel.setAttribute('role', 'note');

            const intro = document.createElement('p');
            intro.textContent = isMinor
                ? `For ${code}, this is the course's starting minor category. Each selected program is classified separately; the minor's requirements and equivalence rules decide where it actually counts. Check Summary for the result.`
                : `For ${code}, this is the course's starting program category. Each selected program is classified separately. As requirements fill, eligible credit may move down Required → Core → Area → Free; program-specific rules can also reassign or exclude it. Check Summary for where it actually counts.`;
            panel.appendChild(intro);

            const list = document.createElement('ul');
            types.forEach(function(type) {
                let definition = programCategoryHelpDescriptions[type];
                if (!definition) return;
                if (isMinor && type === 'required') {
                    definition = ['Required', 'Starts in the minor required pool. It does not replace a named or equivalent required course or grant approval for a substitution.'];
                } else if (isMinor && type === 'unknown') {
                    definition = ['N/A', 'Enters neither the minor total nor the minor program GPA. CGPA and treatment by other selected programs remain separate.'];
                }
                const item = document.createElement('li');
                item.dataset.category = type;
                const name = document.createElement('strong');
                name.textContent = definition[0] + ': ';
                item.appendChild(name);
                item.appendChild(document.createTextNode(definition[1]));
                list.appendChild(item);
            });
            panel.appendChild(list);

            const footer = document.createElement('p');
            footer.textContent = isMinor
                ? 'Main- and other-program treatment and CGPA remain separate. A disabled selector means the official catalog category for this minor and admit term applies. Custom classifications are planning assumptions, not university approval.'
                : 'Category never changes grade or CGPA treatment. A disabled selector means the official catalog category for this program and admit term applies; any saved custom choice is dormant. Custom classifications are planning assumptions, not university approval.';
            panel.appendChild(footer);

            button.addEventListener('click', function(event) {
                event.preventDefault();
                event.stopPropagation();
                const willShow = panel.classList.contains('is-hidden');
                if (willShow) {
                    const container = panel.closest('.custom_course_modal, .double_major_modal');
                    if (container) {
                        container.querySelectorAll('.program-category-help-text:not(.is-hidden)')
                            .forEach(function(otherPanel) {
                                if (otherPanel === panel) return;
                                otherPanel.classList.add('is-hidden');
                                const otherButton = container.querySelector(
                                    `.program-category-help[aria-controls="${otherPanel.id}"]`
                                );
                                if (otherButton) otherButton.setAttribute('aria-expanded', 'false');
                            });
                    }
                }
                panel.classList.toggle('is-hidden', !willShow);
                button.setAttribute('aria-expanded', willShow ? 'true' : 'false');
            });
            return { button, panel };
        }

        const formFactory = opts.formFactory || root.surriculumCustomCourseForm;
        const managerFactory = opts.managerFactory || root.surriculumCustomCourseManager;
        if (!formFactory || typeof formFactory.createController !== 'function') {
            throw new Error('Custom-course UI requires the custom-course form module.');
        }
        if (!managerFactory || typeof managerFactory.createController !== 'function') {
            throw new Error('Custom-course UI requires the custom-course manager module.');
        }

        const customCourseForm = formFactory.createController({
            document,
            getCurriculum,
            getCourseData,
            getPrimaryProgram,
            getPrimaryCatalogIdentitySet,
            getPrimaryCatalogData,
            getPrimaryCustomRecords,
            normalizeCustomCourseForStorage,
            planGetItem,
            planSetItem,
            requestPlanSave,
            flushPlanSaves,
            uiAlert,
            escapeHtml,
            activateAccessibleDialog,
            getCombinedCodeFromCourseObj,
            normalizeCombinedCourseCode,
            splitCombinedCourseCode,
            titleExplicitlySaysBasicLanguage,
            isCustomLanguageCandidate,
            findCustomCourseStorageIndex,
            loadCustomCoursesForMajor,
            _customClassificationIdentity,
            renameSemesterOccurrences,
            refreshSemesterOccurrenceDom,
            getActiveContextProgramCodes,
            findOfficialContextCourse,
            replaceContextRuntimeCustomCourses,
            refreshCourseDatalistsAndTypes,
            customCourseIdentityConflict,
            restoreStoredValue,
            createProgramCategoryHelp,
        });
        const showCustomCourseForm = customCourseForm.showForm;
        const showPendingReview = customCourseForm.showPendingReview;

        const customCourseManager = managerFactory.createController({
            document,
            getPrimaryProgram,
            getPrimaryCatalogIdentitySet,
            planGetItem,
            planSetItem,
            requestPlanSave,
            flushPlanSaves,
            uiAlert,
            uiConfirm,
            escapeHtml,
            activateAccessibleDialog,
            location,
            getCombinedCodeFromCourseObj,
            normalizeCombinedCourseCode,
            findCustomCourseStorageIndex,
            loadCustomCoursesForMajor,
            _customClassificationIdentity,
            removeSemesterOccurrencesByCode,
            getActiveContextProgramCodes,
            replaceContextRuntimeCustomCourses,
            replacePrimaryRuntimeCustomCourses,
            refreshCourseDatalistsAndTypes,
            restoreStoredValue,
            showCustomCourseForm,
        });
        const removeCustomCourseByCodeFromCurrentMajor = customCourseManager.removeByCode;
        const showManageCustomCoursesModal = customCourseManager.showManager;

        let bound = false;
        function bind(options) {
            if (bound) return api;
            bound = true;
            const bindOptions = options || {};
            const customCourseButton = document.querySelector('.customCourse');
            if (customCourseButton) {
                customCourseButton.addEventListener('click', function() {
                    showCustomCourseForm();
                });
            }
            const manageButton = document.querySelector('.manageCustomCourses');
            if (manageButton) {
                manageButton.addEventListener('click', function() {
                    showManageCustomCoursesModal();
                });
            }
            const deleteButton = document.querySelector('.deleteCustom');
            if (deleteButton && typeof bindOptions.onDeleteAll === 'function') {
                deleteButton.addEventListener('click', function() {
                    bindOptions.onDeleteAll();
                });
            }
            return api;
        }

        const api = Object.freeze({
            runtime: customCourseRuntime,
            bind,
            showForm: showCustomCourseForm,
            showPendingReview,
            showManager: showManageCustomCoursesModal,
            removeByCode: removeCustomCourseByCodeFromCurrentMajor,
            restoreStoredValue,
            createProgramCategoryHelp,
        });
        return api;
    }

    root.surriculumCustomCourseUi = Object.freeze({ createController });
})(typeof window !== 'undefined' ? window : globalThis);
