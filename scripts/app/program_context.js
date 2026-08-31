// Selected-program catalog coordination, custom-course deletion, and Academic
// Records binding. Transcript review and rollback belong to the dedicated
// transcript-custom-course-review controller.
// Mutable planner data remains owned by main.js and is accessed only through
// the supplied live state boundary.
(function installProgramContext(root) {
    'use strict';

    function createController(options) {
        const opts = options || {};
        const state = opts.state || {};
        const document = opts.document || root.document;
        const model = opts.model;
        const customCourseUi = opts.customCourseUi;
        if (!model) throw new Error('Program context requires a custom-course model.');
        if (!customCourseUi || !customCourseUi.runtime) {
            throw new Error('Program context requires the custom-course UI controller.');
        }

        const getCurriculum = state.getCurriculum || (() => null);
        const getCourseData = state.getCourseData || (() => []);
        const getPrimaryProgram = state.getPrimaryProgram || (() => '');
        const getPrimaryCatalogCodes = state.getPrimaryCatalogCodes || (() => new Set());
        const getPrimaryCatalogIdentitySet = state.getPrimaryCatalogIdentities || (() => new Set());
        const getPrimaryCustomRecords = state.getPrimaryCustomRecords || (() => []);
        const setPrimaryCustomRecords = state.setPrimaryCustomRecords || (() => {});
        const getDoubleMajorCourseData = state.getDoubleMajorCourseData || (() => []);
        const setDoubleMajorCourseData = state.setDoubleMajorCourseData || (() => {});
        const getDoubleMajorCatalogCodes = state.getDoubleMajorCatalogCodes || (() => new Set());
        const setDoubleMajorCatalogCodes = state.setDoubleMajorCatalogCodes || (() => {});
        const getDoubleMajorCustomRecords = state.getDoubleMajorCustomRecords || (() => []);
        const setDoubleMajorCustomRecords = state.setDoubleMajorCustomRecords || (() => {});
        const getDoubleMajorTermCode = state.getDoubleMajorTermCode || (() => '');

        const loadProgramCatalog = opts.loadProgramCatalog || (() => Promise.resolve([]));
        const normalizeCustomCourseListForStorage = opts.normalizeList || ((_program, list) => list);
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
        const populateCourseDataList = opts.populateCourseDataList || (() => {});
        const termCodeToName = opts.termCodeToName || ((term) => String(term || ''));
        const location = opts.location || root.location || { reload() {} };
        const ensureRequirementsReady = opts.ensureRequirementsReady || (() => Promise.resolve());

        const getCombinedCodeFromCourseObj = model.getCombinedCode;
        const normalizeCombinedCourseCode = model.normalizeCombinedCode;
        const splitCombinedCourseCode = model.splitCombinedCode;
        const loadCustomCoursesForMajor = model.loadStoredCourses;
        const _creditNumber = model.creditNumber;
        const _hasAnyNonZeroCredits = model.hasAnyNonZeroCredits;
        const _fillCreditsFromSource = model.fillCreditsFromSource;
        const _findCourseByCombinedCodeInList = model.findCourseByCombinedCode;
        const _customClassificationIdentity = model.identity;
        const _activeCustomCourseRecords = model.activeRecords;

        const {
            restoreStoredValue,
            createProgramCategoryHelp,
        } = customCourseUi;
        const {
            removeSemesterOccurrencesByCode,
            removeCourseDataRecord,
            getActiveContextProgramCodes,
            replaceContextRuntimeCustomCourses,
            refreshCourseDatalistsAndTypes,
        } = customCourseUi.runtime;

        const transcriptReviewFactory = opts.transcriptReviewFactory
            || root.surriculumTranscriptCustomCourseReview;
        if (!transcriptReviewFactory || typeof transcriptReviewFactory.createController !== 'function') {
            throw new Error('Program context requires the transcript custom-course review controller.');
        }
        const transcriptReview = transcriptReviewFactory.createController({
            model,
            customCourseUi,
            document,
            planGetItem,
            planSetItem,
            requestPlanSave,
            uiAlert,
            escapeHtml,
            state: {
                getCurriculum,
                getCourseData,
                getPrimaryProgram,
                getPrimaryCustomRecords,
            },
        });
        const {
            processPendingCustomCourses,
            rollbackPendingTranscriptCustomCourse,
        } = transcriptReview;


        function _findCourseCreditsSourceByCombinedCode(combinedCode, dmBaseList) {
            return (
                _findCourseByCombinedCodeInList(getCourseData(), combinedCode) ||
                _findCourseByCombinedCodeInList(dmBaseList, combinedCode) ||
                null
            );
        }

        function _repairDmCustomCoursesCredits(dmCode, dmCustomCourses, dmBaseList) {
            if (!dmCode || !Array.isArray(dmCustomCourses) || dmCustomCourses.length === 0) return 0;
            const previousCourses = dmCustomCourses.map(function(course) {
                return course && typeof course === 'object' ? Object.assign({}, course) : course;
            });
            let changedCount = 0;
            for (let i = 0; i < dmCustomCourses.length; i++) {
                const dmCourse = dmCustomCourses[i];
                if (!dmCourse || typeof dmCourse !== 'object') continue;
                const combined = (dmCourse.Major || '') + (dmCourse.Code || '');
                if (!combined) continue;
                const source = _findCourseCreditsSourceByCombinedCode(combined, dmBaseList);
                if (!source || !_hasAnyNonZeroCredits(source)) continue;
                if (_fillCreditsFromSource(dmCourse, source)) changedCount++;
            }
            if (changedCount > 0) {
                try {
                    const keyDM = 'customCourses_' + dmCode;
                    if (!planSetItem(keyDM, JSON.stringify(dmCustomCourses))) {
                        dmCustomCourses.splice(0, dmCustomCourses.length, ...previousCourses);
                        return 0;
                    }
                } catch (_) {
                    dmCustomCourses.splice(0, dmCustomCourses.length, ...previousCourses);
                    return 0;
                }
            }
            return changedCount;
        }


        function _activePrimaryCustomCourseByCode(combinedCode, records) {
            const target = _customClassificationIdentity(combinedCode);
            if (!target) return null;
            const sourceRecords = Array.isArray(records) ? records : getPrimaryCustomRecords();
            const activeRecords = _activeCustomCourseRecords(sourceRecords, getPrimaryCatalogCodes());
            const matches = activeRecords.filter(function(record) {
                return _customClassificationIdentity(getCombinedCodeFromCourseObj(record)) === target;
            });
            // Duplicate custom definitions are ambiguous. The custom-course
            // manager already asks the user to repair them, so this automatic
            // classification path must not silently pick one.
            return matches.length === 1 ? matches[0] : null;
        }

        function _storedActivePrimaryCustomCourseByCode(combinedCode) {
            const primaryProgram = String((getCurriculum() && getCurriculum().major) || '').toUpperCase();
            if (!primaryProgram) return null;
            const parsed = JSON.parse(planGetItem('customCourses_' + primaryProgram) || '[]');
            if (!Array.isArray(parsed)) return null;
            const normalized = normalizeCustomCourseListForStorage(primaryProgram, parsed);
            return _activePrimaryCustomCourseByCode(combinedCode, normalized);
        }

        /**
         * Return active primary custom definitions that still need a category
         * for the selected double-major program.
         *
         * `getCourseData()` is deliberately not consulted here. It is a runtime
         * catalog that also contains official primary rows and restored global
         * transcript definitions (which correctly remain N/A when absent from
         * the target catalog). Custom-course ownership comes only from the
         * validated, program-scoped primary custom records.
         */
        function _pendingDoubleMajorCustomCourses() {
            const targetCodes = new Set(getDoubleMajorCourseData().map(function(record) {
                return _customClassificationIdentity(getCombinedCodeFromCourseObj(record));
            }).filter(Boolean));
            try {
                loadCustomCoursesForMajor(getCurriculum() && getCurriculum().doubleMajor).forEach(function(record) {
                    const identity = _customClassificationIdentity(getCombinedCodeFromCourseObj(record));
                    if (identity) targetCodes.add(identity);
                });
            } catch (_) {}
            const seen = new Set();
            const pending = [];

            getPrimaryCustomRecords().forEach(function(record) {
                const code = getCombinedCodeFromCourseObj(record);
                const identity = _customClassificationIdentity(code);
                if (!code || !identity || seen.has(identity) || targetCodes.has(identity)) return;
                seen.add(identity);

                // Fail closed when old/imported storage contains duplicate
                // definitions for the same custom code.
                if (!_activePrimaryCustomCourseByCode(code)) return;
                pending.push({
                    code,
                    title: record.Course_Name || code,
                });
            });
            return pending;
        }

        /**
         * Process a queue of courses that are missing a double major category.
         * For each course code in the list, we prompt the user to select
         * a category (core/area/free/university/required).  Once the user
         * selects a type, we create a new course object for the double
         * major and append it to the double major course data and
         * localStorage.  After all items have been processed, we
         * recalculate effective types for the double major.
         * @param {Array} list - Array of objects { code, title }
         * @param {function} [onComplete] - Called after every review dialog settles
         */
        function processPendingDoubleMajor(list, onComplete) {
            if (!Array.isArray(list) || list.length === 0) {
                // After processing all, recalc double major categories and
                // update the datalist to include any courses defined via
                // DM classification.  This ensures newly added DM
                // custom courses appear in the selection dropdown.
                try {
                    getCurriculum().recalcEffectiveTypesDouble(getDoubleMajorCourseData());
                } catch (ex) {}
                // Refresh datalist with DM uniques
                updateDatalistForDoubleMajor();
                if (typeof onComplete === 'function') onComplete();
                return;
            }
             const item = list.shift();
             const sourceCustomCourse = _activePrimaryCustomCourseByCode(item && item.code);
             const targetDoubleMajor = String((getCurriculum() && getCurriculum().doubleMajor) || '').toUpperCase();
             let alreadyStoredForDoubleMajor = false;
             try {
                 const itemIdentity = _customClassificationIdentity(item && item.code);
                 alreadyStoredForDoubleMajor = loadCustomCoursesForMajor(targetDoubleMajor).some(function(record) {
                     return _customClassificationIdentity(getCombinedCodeFromCourseObj(record)) === itemIdentity;
                 });
             } catch (_) {}
             const alreadyDefinedForDoubleMajor = !!sourceCustomCourse
                 && getDoubleMajorCourseData().some(function(record) {
                     return _customClassificationIdentity(getCombinedCodeFromCourseObj(record))
                         === _customClassificationIdentity(item.code);
                 });
             // Revalidate provenance at the mutation boundary. This keeps an
             // ordinary catalog/global N/A row (or a stale queued item) from
             // ever becoming a customCourses_<DM> overlay.
             if (!sourceCustomCourse || alreadyDefinedForDoubleMajor || alreadyStoredForDoubleMajor) {
                 processPendingDoubleMajor(list, onComplete);
                 return;
             }
             if (!targetDoubleMajor) {
                 processPendingDoubleMajor(list, onComplete);
                 return;
             }
             showCourseTypeFormDM(item.code, item.title, async function(selectedType) {
                 if (selectedType) {
                    let source = null;
                    try { source = _storedActivePrimaryCustomCourseByCode(item.code); } catch (_) {}
                    if (!source) {
                        await uiAlert(
                            'Custom course changed',
                            `<p><strong>${escapeHtml(item.code)}</strong> is no longer an active custom course for the primary program. No ${escapeHtml(targetDoubleMajor)} category was saved.</p>`
                        );
                        processPendingDoubleMajor(list, onComplete);
                        return;
                    }
                    const sourceCode = getCombinedCodeFromCourseObj(source) || normalizeCombinedCourseCode(item.code);
                    const identity = splitCombinedCourseCode(sourceCode);
                    const maj = identity ? identity.major : '';
                    const num = identity ? identity.code : '';
                    const newCourseDM = {
                        Major: maj,
                        Code: num,
                        Course_Name: source.Course_Name || item.title || sourceCode,
                        ECTS: source ? String(source.ECTS ?? '0') : '0',
                        Engineering: source ? _creditNumber(source.Engineering) : 0,
                        Basic_Science: source ? _creditNumber(source.Basic_Science) : 0,
                        SU_credit: source ? String(source.SU_credit ?? '0') : '0',
                        // Program category is independent, but inherent course
                        // metadata must stay identical across program-scoped
                        // definitions. Faculty is used by requirement groups.
                        Faculty: source && source.Faculty ? String(source.Faculty) : '',
                        EL_Type: selectedType,
                        Faculty_Course: 'No'
                    };
                    if (source && source.Language_Level) {
                        newCourseDM.Language_Level = source.Language_Level;
                    }
                    // Persist the definition before changing the live DM model.
                    let persisted = false;
                    let persistedCourse = null;
                    try {
                        // If the selected program changed while this modal was
                        // open, discard the stale queue rather than writing its
                        // category under a different program key.
                        if (String((getCurriculum() && getCurriculum().doubleMajor) || '').toUpperCase() !== targetDoubleMajor) {
                            throw new Error('Double-major selection changed');
                        }
                        const keyDM = 'customCourses_' + targetDoubleMajor;
                        const parsedDM = JSON.parse(planGetItem(keyDM) || '[]');
                        if (!Array.isArray(parsedDM)) throw new Error('Invalid double-major custom-course storage');
                        const existingDM = normalizeCustomCourseListForStorage(targetDoubleMajor, parsedDM);
                        const targetCode = _customClassificationIdentity(item.code);
                        const targetMatches = existingDM.filter(function(record) {
                            return _customClassificationIdentity(getCombinedCodeFromCourseObj(record)) === targetCode;
                        });
                        if (targetMatches.length > 1) {
                            throw new Error('Ambiguous double-major custom-course definitions');
                        }
                        persistedCourse = targetMatches.length === 1 ? targetMatches[0] : null;

                        // A concurrently created definition wins. Otherwise,
                        // validate the full next list before performing the one
                        // durable write, so corrupt legacy storage is never
                        // overwritten or partially repaired by this prompt.
                        if (persistedCourse) {
                            persisted = true;
                        } else {
                            const nextDM = normalizeCustomCourseListForStorage(
                                targetDoubleMajor,
                                existingDM.concat([newCourseDM])
                            );
                            persistedCourse = nextDM.find(function(record) {
                                return _customClassificationIdentity(getCombinedCodeFromCourseObj(record)) === targetCode;
                            }) || null;
                            persisted = !!persistedCourse && planSetItem(keyDM, JSON.stringify(nextDM));
                        }
                    } catch (_) {}
                    if (!persisted) {
                        await uiAlert(`Could not save ${escapeHtml(targetDoubleMajor)} category`, `<p>The category for <strong>${escapeHtml(item.code)}</strong> was not applied because browser storage rejected the update.</p>`);
                        processPendingDoubleMajor(list, onComplete);
                        return;
                    }
                    if (!getDoubleMajorCourseData().some(function(record) {
                        return _customClassificationIdentity(getCombinedCodeFromCourseObj(record))
                            === _customClassificationIdentity(getCombinedCodeFromCourseObj(persistedCourse));
                    })) {
                        getDoubleMajorCourseData().push(persistedCourse);
                        getDoubleMajorCustomRecords().push(persistedCourse);
                    }
                }
                // Process next
                processPendingDoubleMajor(list, onComplete);
            });
        }

        /**
         * Show a modal to choose a category for a course under the double
         * major.  Only the category selector is presented; credits are
         * assumed to be zero by default.  On save, the callback is
         * invoked with the selected category; on cancel, callback is
         * invoked with null.
         * @param {string} code - The course code (e.g., CS101)
         * @param {string} title - The course name
         * @param {function} callback - Called with selected category or null
         */
        function showCourseTypeFormDM(code, title, callback) {
            // Avoid multiple modals
            if (document.querySelector('.double_major_modal')) return;
            const dmCode = String((getCurriculum() && getCurriculum().doubleMajor) || 'Double Major').toUpperCase();
            const overlay = document.createElement('div');
            overlay.classList.add('double_major_overlay');
            const modal = document.createElement('div');
            modal.classList.add('double_major_modal');
            let doubleMajorDialog = null;
            // Title
            const h = document.createElement('h3');
            h.innerText = `Set ${dmCode} Category`;
            modal.appendChild(h);
            // Info text
            const info = document.createElement('p');
            info.innerText = code + ' - ' + title;
            modal.appendChild(info);
            // Select
            const selectLabel = document.createElement('label');
            selectLabel.htmlFor = 'dm-program-category';
            selectLabel.innerText = `${dmCode} Category:`;
            const dmCategoryOptions = ['core', 'area', 'required', 'university', 'free', 'none', 'unknown'];
            const dmCategoryHelp = createProgramCategoryHelp(dmCode, dmCategoryOptions);
            const dmLabelLine = document.createElement('div');
            dmLabelLine.className = 'program-category-label-line';
            dmLabelLine.appendChild(selectLabel);
            dmLabelLine.appendChild(dmCategoryHelp.button);
            modal.appendChild(dmLabelLine);
            const select = document.createElement('select');
            select.id = 'dm-program-category';
            dmCategoryOptions.forEach(function(opt) {
                const o = document.createElement('option');
                o.value = opt;
                o.innerText = opt === 'unknown'
                    ? 'N/A (not allocated)'
                    : opt.charAt(0).toUpperCase() + opt.slice(1);
                select.appendChild(o);
            });
            modal.appendChild(select);
            modal.appendChild(dmCategoryHelp.panel);
            // Buttons
            const buttons = document.createElement('div');
            buttons.classList.add('dm-buttons');
            const cancel = document.createElement('button');
            cancel.type = 'button';
            cancel.innerText = 'Cancel';
            cancel.classList.add('btn', 'btn-secondary', 'btn-sm');
            cancel.addEventListener('click', function(e) {
                e.stopPropagation();
                if (doubleMajorDialog) doubleMajorDialog.close();
                if (callback) callback(null);
            });
            buttons.appendChild(cancel);
            const save = document.createElement('button');
            save.type = 'button';
            save.innerText = 'Save';
            save.classList.add('btn', 'btn-primary', 'btn-sm');
            save.onclick = function(e) {
                e.stopPropagation();
                const chosen = select.value;
                if (doubleMajorDialog) doubleMajorDialog.close();
                if (callback) callback(chosen);
            };
            buttons.appendChild(save);
            modal.appendChild(buttons);
            overlay.appendChild(modal);
            // Prevent closing the modal by clicking outside
            overlay.addEventListener('click', function(e) {
                e.stopPropagation();
            });
            document.body.appendChild(overlay);
            doubleMajorDialog = activateAccessibleDialog(overlay, modal, h, {
                initialFocus: select,
                onEscape: function() { cancel.click(); },
            });
        }

        /**
         * Load and activate a double major.  This function fetches the course
         * data for the selected second major, loads any custom courses for
         * that major, and then recalculates effective types for the double
         * major.  It also scans existing courses in the getCurriculum() to
         * identify any that do not yet exist in the double major course data
         * and prompts the user to classify them for the double major.
         * @param {string} dm - The double major code (e.g., EE)
         */
        function setDoubleMajor(dm) {
            getCurriculum().doubleMajor = dm;
            getCurriculum().entryTermDM = getDoubleMajorTermCode();
            // Attach the loaded DM course data to the getCurriculum() so
            // recalcEffectiveTypes() can trigger DM recalculation automatically.
            // Fetch course data for second major
            return Promise.all([
                ensureRequirementsReady(),
                loadProgramCatalog(dm, getDoubleMajorTermCode()),
            ]).then(async function(results) {
                const jsonDM = results[1];
                if (!jsonDM || jsonDM.length === 0) {
                    await uiAlert(
                        'No course data',
                        `<p>No course data available for <strong>${escapeHtml(dm)}</strong> in <strong>${escapeHtml(termCodeToName(getDoubleMajorTermCode()))}</strong>.</p>`
                    );
                }
                // Important: keep `getDoubleMajorCourseData()` as a single shared
                // array reference. Some UIs (e.g., detailed summaries) read
                // from `getCurriculum().doubleMajorCourseData`, so reassigning via
                // `.concat()` would desync that reference and hide custom DM
                // courses in lists while totals still compute correctly.
                setDoubleMajorCourseData(Array.isArray(jsonDM) ? jsonDM : []);
                setDoubleMajorCatalogCodes(new Set(getDoubleMajorCourseData().map(getCombinedCodeFromCourseObj).filter(Boolean)));
                setDoubleMajorCustomRecords([]);
                // Save DM course data on the getCurriculum() instance so
                // recalcEffectiveTypes() can trigger DM recalculation.
                getCurriculum().doubleMajorCourseData = getDoubleMajorCourseData();
                // Load custom courses for second major
                let dmStoredCustomCourses = [];
                try {
                    const keyDM = 'customCourses_' + dm;
                    const storedDM = planGetItem(keyDM);
                    if (storedDM) {
                        const parsedDM = JSON.parse(storedDM);
                        if (Array.isArray(parsedDM)) {
                            dmStoredCustomCourses = normalizeCustomCourseListForStorage(dm, parsedDM);
                        }
                    }
                } catch (ex) {}

                // Repair legacy DM custom courses that were saved with missing
                // credits (ECTS / SU / ENG / BS) by copying credits from the
                // main course definition when available.
                const repaired = _repairDmCustomCoursesCredits(dm, dmStoredCustomCourses, getDoubleMajorCourseData());
                if (repaired > 0) {
                    try {
                        const shownKey = 'dmCustomCoursesCreditsRepairShown_' + dm;
                        if (!planGetItem(shownKey)) {
                            planSetItem(shownKey, '1');
                            await uiAlert(
                                'Repaired double major credits',
                                `<p>Fixed missing credit values for <strong>${repaired}</strong> saved double major course${repaired === 1 ? '' : 's'} (ECTS / SU / ENG / BS).</p>`
                            );
                        }
                    } catch (_) {}
                }
                const dmCustomCourses = _activeCustomCourseRecords(
                    dmStoredCustomCourses,
                    getDoubleMajorCatalogCodes()
                );
                if (dmCustomCourses && dmCustomCourses.length) {
                    setDoubleMajorCustomRecords(dmCustomCourses);
                    for (let i = 0; i < dmCustomCourses.length; i++) {
                        getDoubleMajorCourseData().push(dmCustomCourses[i]);
                    }
                }
                // Recalc categories for DM
                getCurriculum().recalcEffectiveTypesDouble(getDoubleMajorCourseData());
                // Only genuine, active primary custom definitions need a
                // program-specific planning classification. Ordinary catalog
                // courses and restored global transcript rows remain N/A when
                // they are absent from the target program catalog.
                const pending = _pendingDoubleMajorCustomCourses();
                if (pending.length > 0) {
                    await new Promise(function(resolve) {
                        processPendingDoubleMajor(pending, resolve);
                    });
                }

                // After loading the double major data, update the course
                // selection datalist to include courses unique to the
                // double major.  We combine the primary major's
                // getCourseData() with any DM course whose Major+Code
                // combination is not present in the primary data.  This
                // ensures the user can add DM-only courses while
                // maintaining separate credit calculations for the main
                // major.  Updating the datalist at this point allows
                // immediate selection of DM courses before any
                // pending classifications complete.  We will update
                // again after pending courses are classified (see below).
                updateDatalistForDoubleMajor();
            });
        }

        /**
         * Update the datalist for course selection when a double major is
         * active.  This helper builds a combined course list consisting
         * of the main major's courses plus any courses unique to the
         * double major (i.e., those not present in the main major's
         * getCourseData()).  It then rebuilds the datalist options so that
         * users can select courses from either major.  Courses unique
         * to the double major will still be ignored for the main
         * major's category allocations (handled in recalcEffectiveTypes).
         */
        function updateDatalistForDoubleMajor() {
            try {
                // If no double major is selected, reset to primary data
                if (!getCurriculum().doubleMajor) {
                    document.querySelectorAll('datalist.course_list').forEach(function(dl) {
                        populateCourseDataList(dl, getCourseData());
                    });
                    return;
                }
                // Build a set of main course codes for quick lookup
                const mainSet = new Set(getCourseData().map(function(c) {
                    return _customClassificationIdentity((c.Major || '') + (c.Code || ''));
                }).filter(Boolean));
                // Collect unique double major courses
                const dmUnique = [];
                getDoubleMajorCourseData().forEach(function(dm) {
                    const key = _customClassificationIdentity((dm.Major || '') + (dm.Code || ''));
                    if (!mainSet.has(key)) dmUnique.push(dm);
                });
                // Combine arrays
                const combined = getCourseData().concat(dmUnique);
                document.querySelectorAll('datalist.course_list').forEach(function(dl) {
                    populateCourseDataList(dl, combined);
                });
            } catch (ex) {
                // ignore errors
            }
        }
        /**
         * Deletes all custom courses defined for the current major. Custom
         * courses are stored under the localStorage key `customCourses_<major>`.
         * This function removes those entries from both localStorage and the
         * in-memory `getCourseData()` array. It also removes any instances of
         * those courses from the current getCurriculum()'s semesters. Finally it
         * updates the stored getCurriculum() in localStorage and reloads the page
         * so that the UI reflects the changes. A confirmation prompt guards
         * against accidental deletion.
         */
        async function handleDeleteCustomCourses() {
            const primaryProgram = String(getPrimaryProgram() || '').toUpperCase();
            const primaryKey = 'customCourses_' + primaryProgram;
            const primaryList = loadCustomCoursesForMajor(primaryProgram);
            if (!primaryList.length) {
                await uiAlert('No custom courses', '<p>There are no primary-program custom courses to delete for this plan.</p>');
                return;
            }
            const deletedCodes = new Set(primaryList.map(function(record) {
                return _customClassificationIdentity(getCombinedCodeFromCourseObj(record));
            }).filter(Boolean));
            const primaryPlan = {
                programCode: primaryProgram,
                key: primaryKey,
                previousRaw: planGetItem(primaryKey),
                previousList: primaryList,
                nextList: [],
            };
            const contextPlans = getActiveContextProgramCodes().map(function(programCode) {
                const key = 'customCourses_' + programCode;
                const previousList = loadCustomCoursesForMajor(programCode);
                const nextList = previousList.filter(function(record) {
                    return !deletedCodes.has(
                        _customClassificationIdentity(getCombinedCodeFromCourseObj(record))
                    );
                });
                return {
                    programCode,
                    key,
                    previousRaw: planGetItem(key),
                    previousList,
                    nextList,
                };
            }).filter(function(plan) {
                return plan.nextList.length !== plan.previousList.length;
            });
            const plans = [primaryPlan].concat(contextPlans);

            const confirmMsg = `Are you sure you want to delete all ${primaryProgram} custom courses and their selected-program categories?`;
            if (!(await uiConfirm('Delete custom courses?', `<p>${escapeHtml(confirmMsg)}</p><p>This cannot be undone.</p>`, { confirmText: 'Delete', danger: true }))) {
                return;
            }

            const completed = [];
            let removalFailed = false;
            for (let i = 0; i < plans.length; i++) {
                try {
                    const plan = plans[i];
                    const persisted = plan.nextList.length
                        ? planSetItem(plan.key, JSON.stringify(plan.nextList))
                        : planRemoveItem(plan.key);
                    if (persisted === false) {
                        removalFailed = true;
                        break;
                    }
                    completed.push(plans[i]);
                } catch (_) {
                    removalFailed = true;
                    break;
                }
            }
            if (removalFailed) {
                for (let i = completed.length - 1; i >= 0; i--) {
                    restoreStoredValue(completed[i].key, completed[i].previousRaw);
                }
                await uiAlert('Could not delete custom courses', '<p>No planner courses were changed because browser storage rejected a program update.</p>');
                return;
            }

            // Only primary-program custom definitions own planner occurrences.
            // Secondary rows are classification overlays for the same real
            // courses and must never delete planner occurrences. A dormant main
            // overlay that collides with the official catalog does not own the
            // official course occurrence either.
            primaryPlan.previousList.map(getCombinedCodeFromCourseObj).filter(function(code) {
                return code && !getPrimaryCatalogIdentitySet().has(_customClassificationIdentity(code));
            }).forEach(removeSemesterOccurrencesByCode);
            getPrimaryCustomRecords().forEach(function(record) {
                removeCourseDataRecord(record, getCombinedCodeFromCourseObj(record));
            });
            setPrimaryCustomRecords([]);

            contextPlans.forEach(function(plan) {
                replaceContextRuntimeCustomCourses(plan.programCode, plan.nextList);
            });
            // Recalculate effective types and update datalist
            try {
                if (typeof getCurriculum().recalcEffectiveTypes === 'function') {
                    getCurriculum().recalcEffectiveTypes(getCourseData());
                }
                if (getCurriculum().doubleMajor && typeof getCurriculum().recalcEffectiveTypesDouble === 'function') {
                    getCurriculum().recalcEffectiveTypesDouble(getDoubleMajorCourseData());
                }
                document.querySelectorAll('datalist.course_list').forEach(function(dl) {
                    populateCourseDataList(dl, getCourseData());
                });
                if (getCurriculum().doubleMajor && typeof updateDatalistForDoubleMajor === 'function') {
                    updateDatalistForDoubleMajor();
                }
            } catch (err) {
                // ignore
            }
            const saveRequested = requestPlanSave();
            if (!saveRequested || !flushPlanSaves()) {
                for (let i = completed.length - 1; i >= 0; i--) {
                    restoreStoredValue(completed[i].key, completed[i].previousRaw);
                }
                await uiAlert('Could not delete custom courses', '<p>The planner snapshot could not be saved. Your custom courses will be restored now.</p>');
                location.reload();
                return;
            }
            // Reload the page to ensure every derived panel reflects removal.
            location.reload();
        }


        let academicImportController = null;
        function bindAcademicImport() {
            if (academicImportController) return academicImportController;
            const factory = opts.academicImportFactory;
            const appRuntime = opts.appRuntime;
            if (!factory || typeof factory.createController !== 'function') {
                throw new Error('Program context requires the academic-import controller factory.');
            }
            academicImportController = factory.createController({
                runtime: appRuntime,
                parser: opts.academicRecordsParser,
                pdfReader: opts.pdfTranscriptReader,
                getCourseData,
                getCurriculum,
                processPendingCustomCourses,
                loadCoursePageInfoIndex: opts.loadCoursePageInfoIndex,
                sessionPlanId: appRuntime && appRuntime.sessionPlanId,
            });
            academicImportController.bind();
            return academicImportController;
        }

        const api = Object.freeze({
            bindAcademicImport,
            processPendingCustomCourses,
            rollbackPendingTranscriptCustomCourse,
            setDoubleMajor,
            updateDatalistForDoubleMajor,
            deleteAllCustomCourses: handleDeleteCustomCourses,
        });
        root.updateDatalistForDoubleMajor = updateDatalistForDoubleMajor;
        return api;
    }

    root.surriculumProgramContext = Object.freeze({ createController });
})(typeof window !== 'undefined' ? window : globalThis);
