// Custom-course manager and deletion UI.
// Loaded after custom_course_runtime.js and before custom_course_ui.js.
(function installCustomCourseManager(root) {
    'use strict';

    function createController(options) {
        const deps = options || {};
        const document = deps.document || root.document;
        const getPrimaryProgram = deps.getPrimaryProgram;
        const getPrimaryCatalogIdentitySet = deps.getPrimaryCatalogIdentitySet;
        const planGetItem = deps.planGetItem;
        const planSetItem = deps.planSetItem;
        const requestPlanSave = deps.requestPlanSave;
        const flushPlanSaves = deps.flushPlanSaves;
        const uiAlert = deps.uiAlert;
        const uiConfirm = deps.uiConfirm;
        const escapeHtml = deps.escapeHtml;
        const activateAccessibleDialog = deps.activateAccessibleDialog;
        const location = deps.location || root.location || { reload() {} };
        const getCombinedCodeFromCourseObj = deps.getCombinedCodeFromCourseObj;
        const normalizeCombinedCourseCode = deps.normalizeCombinedCourseCode;
        const findCustomCourseStorageIndex = deps.findCustomCourseStorageIndex;
        const loadCustomCoursesForMajor = deps.loadCustomCoursesForMajor;
        const _customClassificationIdentity = deps._customClassificationIdentity;
        const removeSemesterOccurrencesByCode = deps.removeSemesterOccurrencesByCode;
        const getActiveContextProgramCodes = deps.getActiveContextProgramCodes;
        const replaceContextRuntimeCustomCourses = deps.replaceContextRuntimeCustomCourses;
        const replacePrimaryRuntimeCustomCourses = deps.replacePrimaryRuntimeCustomCourses;
        const refreshCourseDatalistsAndTypes = deps.refreshCourseDatalistsAndTypes;
        const restoreStoredValue = deps.restoreStoredValue;
        const showCustomCourseForm = deps.showCustomCourseForm;

        async function removeCustomCourseByCodeFromCurrentMajor(combinedCode, preferredIndex) {
            const target = normalizeCombinedCourseCode(combinedCode);
            const targetIdentity = _customClassificationIdentity(target);
            if (!target) return false;
            const majorKey = String(getPrimaryProgram() || '').toUpperCase();
            const existing = loadCustomCoursesForMajor(majorKey);
            if (!existing.length) return false;
            const storageIndex = findCustomCourseStorageIndex(existing, target, preferredIndex);
            if (storageIndex < 0) {
                await uiAlert('Could not identify custom course', `<p><strong>${escapeHtml(target)}</strong> has duplicate saved definitions. Rename or remove the duplicates individually before continuing.</p>`);
                return false;
            }
            const key = 'customCourses_' + majorKey;
            const previousRaw = planGetItem(key);
            const next = existing.slice();
            next.splice(storageIndex, 1);
            const targetIdentityRemains = next.some(function(course) {
                return _customClassificationIdentity(getCombinedCodeFromCourseObj(course)) === targetIdentity;
            });
            const contextPlans = [];
            getActiveContextProgramCodes().forEach(function(programCode) {
                const contextKey = 'customCourses_' + programCode;
                const contextExisting = loadCustomCoursesForMajor(programCode);
                const contextNext = targetIdentityRemains
                    ? contextExisting.slice()
                    : contextExisting.filter(function(course) {
                        return _customClassificationIdentity(getCombinedCodeFromCourseObj(course)) !== targetIdentity;
                    });
                if (contextNext.length !== contextExisting.length) {
                    contextPlans.push({
                        programCode,
                        key: contextKey,
                        previousRaw: planGetItem(contextKey),
                        previousList: contextExisting,
                        nextList: contextNext,
                    });
                }
            });
            const storagePlans = [{ key, previousRaw, previousList: existing, nextList: next }]
                .concat(contextPlans);
            const completedWrites = [];
            let writeFailed = false;
            for (let i = 0; i < storagePlans.length; i++) {
                const plan = storagePlans[i];
                try {
                    if (planSetItem(plan.key, JSON.stringify(plan.nextList)) === false) {
                        writeFailed = true;
                        break;
                    }
                    completedWrites.push(plan);
                } catch (_) {
                    writeFailed = true;
                    break;
                }
            }
            if (writeFailed) {
                for (let i = completedWrites.length - 1; i >= 0; i--) {
                    restoreStoredValue(completedWrites[i].key, completedWrites[i].previousRaw);
                }
                await uiAlert('Could not delete custom course', `<p><strong>${escapeHtml(target)}</strong> was not changed because browser storage rejected a program update.</p>`);
                return false;
            }

            if (!getPrimaryCatalogIdentitySet().has(targetIdentity)
                && !targetIdentityRemains) {
                removeSemesterOccurrencesByCode(target);
            }
            replacePrimaryRuntimeCustomCourses(next);
            contextPlans.forEach(function(plan) {
                replaceContextRuntimeCustomCourses(plan.programCode, plan.nextList);
            });
            refreshCourseDatalistsAndTypes();
            const saveRequested = requestPlanSave();
            if (!saveRequested || !flushPlanSaves()) {
                for (let i = completedWrites.length - 1; i >= 0; i--) {
                    restoreStoredValue(completedWrites[i].key, completedWrites[i].previousRaw);
                }
                await uiAlert('Could not delete custom course', `<p>The planner snapshot could not be saved. <strong>${escapeHtml(target)}</strong> will be restored now.</p>`);
                location.reload();
                return false;
            }
            return true;
        }

        function showManageCustomCoursesModal() {
            if (document.querySelector('.custom_course_manage_overlay')) return;
            const majorKey = String(getPrimaryProgram() || '').toUpperCase();
            const readList = () => loadCustomCoursesForMajor(majorKey);
            if (!readList().length) {
                uiAlert('No custom courses', '<p>There are no custom courses to manage for this program.</p>');
                return;
            }

            const boardDom = document.body;
            const overlay = document.createElement('div');
            overlay.className = 'custom_course_manage_overlay';

            const modal = document.createElement('div');
            modal.className = 'custom_course_manage_modal';
            let manageDialog = null;

            const title = document.createElement('h3');
            title.innerText = 'Manage Custom Courses';
            modal.appendChild(title);

            const subtitle = document.createElement('p');
            subtitle.className = 'custom_course_manage_subtitle';
            subtitle.innerText = `${majorKey} custom courses`;
            modal.appendChild(subtitle);

            const listEl = document.createElement('div');
            listEl.className = 'custom_course_manage_list';
            modal.appendChild(listEl);

            const footer = document.createElement('div');
            footer.className = 'custom_course_manage_footer';
            const closeBtn = document.createElement('button');
            closeBtn.className = 'btn btn-secondary btn-sm';
            closeBtn.innerText = 'Close';
            closeBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                if (manageDialog) manageDialog.close();
            });
            footer.appendChild(closeBtn);
            modal.appendChild(footer);

            const renderList = () => {
                const courses = readList();
                if (!courses.length) {
                    if (manageDialog) manageDialog.close();
                    uiAlert('No custom courses', '<p>There are no custom courses left to manage.</p>');
                    return;
                }
                listEl.innerHTML = '';

                courses.forEach(function(course, courseIndex) {
                    const combined = getCombinedCodeFromCourseObj(course);
                    const item = document.createElement('div');
                    item.className = 'custom_course_manage_item';

                    const info = document.createElement('div');
                    info.className = 'custom_course_manage_info';

                    const line1 = document.createElement('div');
                    line1.className = 'custom_course_manage_line1';
                    line1.innerHTML = `<strong>${escapeHtml(combined)}</strong> — ${escapeHtml(course.Course_Name || combined)}`;
                    info.appendChild(line1);

                    const line2 = document.createElement('div');
                    line2.className = 'custom_course_manage_line2';
                    line2.textContent =
                        `SU ${course.SU_credit || '0'} • ECTS ${course.ECTS || '0'} • ` +
                        `BS ${course.Basic_Science || 0} • ENG ${course.Engineering || 0} • ` +
                        `Type ${String(course.EL_Type || 'none')}` +
                        (course.Language_Level
                            ? ` • Language ${course.Language_Level === 'basic' ? 'beginning/basic' : 'higher/other'}`
                            : '');
                    info.appendChild(line2);

                    const actions = document.createElement('div');
                    actions.className = 'custom_course_manage_actions';

                    const editBtn = document.createElement('button');
                    editBtn.className = 'btn btn-secondary btn-sm';
                    editBtn.innerHTML = '<i class="fa-solid fa-pen"></i>&nbsp;Edit';
                    editBtn.setAttribute('aria-label', `Edit ${combined}`);
                    editBtn.addEventListener('click', function(e) {
                        e.stopPropagation();
                        showCustomCourseForm(null, course, function() {
                            renderList();
                        }, null, courseIndex);
                    });
                    actions.appendChild(editBtn);

                    const deleteBtn = document.createElement('button');
                    deleteBtn.className = 'btn btn-danger btn-sm';
                    deleteBtn.innerHTML = '<i class="fa-solid fa-trash"></i>&nbsp;Delete';
                    deleteBtn.setAttribute('aria-label', `Delete ${combined}`);
                    deleteBtn.addEventListener('click', async function(e) {
                        e.stopPropagation();
                        const ok = await uiConfirm(
                            'Delete custom course?',
                            `<p>Delete <strong>${escapeHtml(combined)}</strong> from custom courses?</p><p>This cannot be undone.</p>`,
                            { confirmText: 'Delete', danger: true }
                        );
                        if (!ok) return;
                        if (await removeCustomCourseByCodeFromCurrentMajor(combined, courseIndex)) {
                            renderList();
                        }
                    });
                    actions.appendChild(deleteBtn);

                    item.appendChild(info);
                    item.appendChild(actions);
                    listEl.appendChild(item);
                });
            };

            renderList();

            modal.addEventListener('click', function(e) { e.stopPropagation(); });
            overlay.addEventListener('click', function(e) { e.stopPropagation(); });
            overlay.appendChild(modal);
            boardDom.appendChild(overlay);
            manageDialog = activateAccessibleDialog(overlay, modal, title, {
                initialFocus: closeBtn,
            });
        }

        return Object.freeze({
            removeByCode: removeCustomCourseByCodeFromCurrentMajor,
            showManager: showManageCustomCoursesModal,
        });
    }

    root.surriculumCustomCourseManager = Object.freeze({ createController });
})(typeof window !== 'undefined' ? window : globalThis);
