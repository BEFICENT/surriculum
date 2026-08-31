// Custom-course add/edit/review form.
// Loaded after custom_course_runtime.js and before custom_course_ui.js.
(function installCustomCourseForm(root) {
    'use strict';

    function createController(options) {
        const deps = options || {};
        const document = deps.document || root.document;
        const getCurriculum = deps.getCurriculum;
        const getCourseData = deps.getCourseData;
        const getPrimaryProgram = deps.getPrimaryProgram;
        const getPrimaryCatalogIdentitySet = deps.getPrimaryCatalogIdentitySet;
        const getPrimaryCatalogData = deps.getPrimaryCatalogData;
        const getPrimaryCustomRecords = deps.getPrimaryCustomRecords;
        const normalizeCustomCourseForStorage = deps.normalizeCustomCourseForStorage;
        const planGetItem = deps.planGetItem;
        const planSetItem = deps.planSetItem;
        const requestPlanSave = deps.requestPlanSave;
        const flushPlanSaves = deps.flushPlanSaves;
        const uiAlert = deps.uiAlert;
        const escapeHtml = deps.escapeHtml;
        const activateAccessibleDialog = deps.activateAccessibleDialog;
        const getCombinedCodeFromCourseObj = deps.getCombinedCodeFromCourseObj;
        const normalizeCombinedCourseCode = deps.normalizeCombinedCourseCode;
        const splitCombinedCourseCode = deps.splitCombinedCourseCode;
        const titleExplicitlySaysBasicLanguage = deps.titleExplicitlySaysBasicLanguage;
        const isCustomLanguageCandidate = deps.isCustomLanguageCandidate;
        const findCustomCourseStorageIndex = deps.findCustomCourseStorageIndex;
        const loadCustomCoursesForMajor = deps.loadCustomCoursesForMajor;
        const _customClassificationIdentity = deps._customClassificationIdentity;
        const renameSemesterOccurrences = deps.renameSemesterOccurrences;
        const refreshSemesterOccurrenceDom = deps.refreshSemesterOccurrenceDom;
        const getActiveContextProgramCodes = deps.getActiveContextProgramCodes;
        const findOfficialContextCourse = deps.findOfficialContextCourse;
        const replaceContextRuntimeCustomCourses = deps.replaceContextRuntimeCustomCourses;
        const refreshCourseDatalistsAndTypes = deps.refreshCourseDatalistsAndTypes;
        const customCourseIdentityConflict = deps.customCourseIdentityConflict;
        const restoreStoredValue = deps.restoreStoredValue;
        const createProgramCategoryHelp = deps.createProgramCategoryHelp;

        function showCustomCourseForm(prefill = null, courseObj = null, onSaveCallback = null, onCancelCallback = null, courseStorageIndex = null, linkedProgramCourses = null) {
            // Prevent multiple modals
            if (document.querySelector('.custom_course_modal')) return;

        const primaryProgramCode = String(getPrimaryProgram() || '').trim().toUpperCase();

        // Append overlay to body so it covers the full viewport
        const boardDom = document.body;

        // Create overlay container
        const overlay = document.createElement('div');
        overlay.classList.add('custom_course_overlay');

        // Create modal container
        const modal = document.createElement('div');
        modal.classList.add('custom_course_modal');
        let customCourseDialog = null;
        let customCourseFieldSequence = 0;

        // Title
        const title = document.createElement('h3');
        const isTranscriptReview = typeof onCancelCallback === 'function';
        title.innerText = isTranscriptReview
            ? 'Review Imported Course'
            : (courseObj ? 'Edit Custom Course' : 'Add Custom Course');
        modal.appendChild(title);

        if (isTranscriptReview) {
            const importNote = document.createElement('p');
            importNote.className = 'cc-import-note';
            importNote.textContent = 'Save to keep this transcript course. Skip & Remove will undo its imported course, semester occurrence, and saved custom-course definition.';
            modal.appendChild(importNote);
        }

        // Helper to create input row
        function createInputRow(labelText, inputType = 'text', placeholder = '', defaultValue = '') {
            const row = document.createElement('div');
            row.classList.add('cc-row');

            const label = document.createElement('label');
            label.innerText = labelText;
            row.appendChild(label);

            const input = document.createElement('input');
            input.id = `custom-course-field-${++customCourseFieldSequence}`;
            label.htmlFor = input.id;
            input.type = inputType;
            input.placeholder = placeholder;
            input.value = defaultValue;
            row.appendChild(input);

            return { row, input };
        }

            // Course Code input (e.g., CS101)
            const { row: codeRow, input: codeInput } = createInputRow('Course Code:', 'text', 'e.g. CS300');
            codeInput.maxLength = 21;
            modal.appendChild(codeRow);

            // Course Name input
            const { row: nameRow, input: nameInput } = createInputRow('Course Name:', 'text', 'Course name');
            nameInput.maxLength = 200;
            modal.appendChild(nameRow);

            // SU Credits input
            const { row: suRow, input: suInput } = createInputRow('SU Credits:', 'number', 'e.g. 3');
            modal.appendChild(suRow);

            // ECTS input
            const { row: ectsRow, input: ectsInput } = createInputRow('ECTS:', 'number', 'e.g. 6');
            modal.appendChild(ectsRow);

            // Basic Science credits input
            const { row: bsRow, input: bsInput } = createInputRow('Basic Science credits:', 'number', 'e.g. 0');
            bsInput.value = '0';
            modal.appendChild(bsRow);

            // Engineering credits input
            const { row: engRow, input: engInput } = createInputRow('Engineering credits:', 'number', 'e.g. 0');
            engInput.value = '0';
            modal.appendChild(engRow);

            [suInput, ectsInput, bsInput, engInput].forEach(function(input) {
                input.min = '0';
                input.max = '100';
                input.step = 'any';
            });

            // EL Type dropdown
            const typeRow = document.createElement('div');
            typeRow.classList.add('cc-row');
            const typeLabel = document.createElement('label');
            typeLabel.innerText = `${primaryProgramCode} Category:`;
            typeLabel.htmlFor = 'cc-primary-program-category';
            const primaryCategoryOptions = ['core', 'area', 'university', 'free', 'required', 'none', 'unknown'];
            const primaryCategoryHelp = createProgramCategoryHelp(
                primaryProgramCode,
                primaryCategoryOptions
            );
            const typeLabelLine = document.createElement('div');
            typeLabelLine.className = 'program-category-label-line';
            typeLabelLine.appendChild(typeLabel);
            typeLabelLine.appendChild(primaryCategoryHelp.button);
            typeRow.appendChild(typeLabelLine);
            const typeSelect = document.createElement('select');
            typeSelect.id = 'cc-primary-program-category';
            typeSelect.className = 'cc-program-category cc-primary-program-category';
            primaryCategoryOptions.forEach(function(opt) {
                const option = document.createElement('option');
                option.value = opt;
                option.innerText = opt === 'unknown'
                    ? 'N/A (not allocated)'
                    : opt.charAt(0).toUpperCase() + opt.slice(1);
                typeSelect.appendChild(option);
            });
            typeRow.appendChild(typeSelect);
            typeRow.appendChild(primaryCategoryHelp.panel);

            // A stored custom definition can become dormant when the selected
            // admit term gains an official row with the same code. Show the
            // catalog category in that case, but retain the dormant custom
            // category underneath so switching back to another term restores
            // the user's program-scoped classification.
            const primaryOfficialNote = document.createElement('small');
            primaryOfficialNote.id = 'cc-primary-program-category-official-note';
            primaryOfficialNote.className = 'cc-program-category-note cc-language-note is-hidden';
            primaryOfficialNote.textContent = 'The official catalog category applies to this course.';
            typeRow.appendChild(primaryOfficialNote);
            const primaryDefaultType = typeSelect.value;
            let primaryEditableType = typeSelect.value;
            let primaryCategoryTouched = false;
            let primaryLastSyncedCode = null;
            const findPrimaryCustomType = function(combinedCode) {
                const target = _customClassificationIdentity(combinedCode);
                if (!target) return '';
                const stored = loadCustomCoursesForMajor(primaryProgramCode);
                const matches = stored.filter(function(record) {
                    return _customClassificationIdentity(getCombinedCodeFromCourseObj(record)) === target;
                });
                const match = matches.length === 1 ? matches[0] : null;
                return match ? String(match.EL_Type || '').toLowerCase() : '';
            };
            const findOfficialPrimaryCourse = function(combinedCode) {
                const target = _customClassificationIdentity(combinedCode);
                if (!target || !getPrimaryCatalogIdentitySet().has(target)) return null;
                return getPrimaryCatalogData().find(function(record) {
                    return _customClassificationIdentity(getCombinedCodeFromCourseObj(record)) === target;
                }) || null;
            };
            const normalizePrimaryType = function(value) {
                const type = String(value || '').toLowerCase();
                return Array.from(typeSelect.options).some(function(option) {
                    return option.value === type;
                }) ? type : 'unknown';
            };
            const syncPrimaryOfficialCategory = function() {
                const currentCode = normalizeCombinedCourseCode(codeInput.value);
                if (!primaryCategoryTouched && currentCode !== primaryLastSyncedCode) {
                    const storedType = findPrimaryCustomType(currentCode);
                    if (storedType) primaryEditableType = normalizePrimaryType(storedType);
                    else if (!courseObj) primaryEditableType = primaryDefaultType;
                }
                primaryLastSyncedCode = currentCode;
                const official = findOfficialPrimaryCourse(currentCode);
                if (official) {
                    typeSelect.value = normalizePrimaryType(official.EL_Type);
                    typeSelect.disabled = true;
                    typeSelect.setAttribute('aria-describedby', primaryOfficialNote.id);
                    primaryOfficialNote.classList.remove('is-hidden');
                } else {
                    typeSelect.disabled = false;
                    typeSelect.removeAttribute('aria-describedby');
                    typeSelect.value = primaryEditableType;
                    primaryOfficialNote.classList.add('is-hidden');
                }
            };
            typeSelect.addEventListener('change', function() {
                if (!typeSelect.disabled) {
                    primaryEditableType = typeSelect.value;
                    primaryCategoryTouched = true;
                }
            });
            modal.appendChild(typeRow);

            // Faculty (optional). Several graduation rules count courses by the
            // faculty that OFFERS them, so a custom course needs to be able to
            // say — or to say nothing, which is the honest answer for a transfer
            // or exchange course that belongs to no Sabanci faculty. It used to
            // be hardcoded to FENS, which silently made every custom course
            // count toward FENS-specific rules.
            const facultyRow = document.createElement('div');
            facultyRow.classList.add('cc-row');
            const facultyLabel = document.createElement('label');
            facultyLabel.innerText = 'Faculty (optional):';
            const facultyHelpBtn = document.createElement('button');
            facultyHelpBtn.type = 'button';
            facultyHelpBtn.className = 'cc-help';
            facultyHelpBtn.textContent = '?';
            facultyHelpBtn.setAttribute('aria-label', 'What is Faculty, and when should I set it?');
            facultyHelpBtn.setAttribute('aria-expanded', 'false');
            const facultyLabelLine = document.createElement('div');
            facultyLabelLine.className = 'program-category-label-line';
            facultyLabelLine.appendChild(facultyLabel);
            facultyLabelLine.appendChild(facultyHelpBtn);
            facultyRow.appendChild(facultyLabelLine);

            const facultySelect = document.createElement('select');
            facultySelect.id = 'cc-faculty';
            facultyLabel.htmlFor = facultySelect.id;
            facultySelect.className = 'cc-faculty';
            [
                ['', 'None / not applicable'],
                ['FENS', 'FENS — Engineering and Natural Sciences'],
                ['FASS', 'FASS — Arts and Social Sciences'],
                ['SBS', 'SBS — School of Management (SOM)'],
                ['SL', 'SL — School of Languages'],
            ].forEach(function(pair) {
                const option = document.createElement('option');
                option.value = pair[0];
                option.innerText = pair[1];
                facultySelect.appendChild(option);
            });
            facultyRow.appendChild(facultySelect);

            const facultyHelp = document.createElement('p');
            facultyHelp.id = 'cc-faculty-help';
            facultyHelp.className = 'cc-help-text is-hidden';
            facultyHelp.innerText = [
                'The faculty that offers the course. Some graduation rules count courses by faculty '
                + '— for example DSA needs at least 3 core electives from each of FENS, FASS and SBS, '
                + 'and MAN needs 9 free-elective credits from FASS or FENS courses.',
                'Leave it as "None" for transfer or exchange courses that do not belong to a Sabancı '
                + 'faculty. They still count toward your credits, ECTS and category totals — they just '
                + 'will not count toward these faculty-specific rules.',
            ].join('\n\n');
            facultyRow.appendChild(facultyHelp);
            facultyHelpBtn.setAttribute('aria-controls', facultyHelp.id);

            facultyHelpBtn.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                const willShow = facultyHelp.classList.contains('is-hidden');
                facultyHelp.classList.toggle('is-hidden', !willShow);
                facultyHelpBtn.setAttribute('aria-expanded', willShow ? 'true' : 'false');
            });

            modal.appendChild(facultyRow);

            // Language courses need one piece of metadata that cannot be
            // inferred from an exchange transcript code: whether this is a
            // beginning/basic course subject to the two-course cap, or a
            // higher/other language course. Keep an unreviewed state distinct
            // from an explicit "other" classification.
            const languageLevelRow = document.createElement('div');
            languageLevelRow.classList.add('cc-row', 'cc-language-level-row');
            const languageLevelLabel = document.createElement('label');
            languageLevelLabel.innerText = 'Language level:';
            languageLevelLabel.htmlFor = 'cc-language-level';
            languageLevelRow.appendChild(languageLevelLabel);

            const languageLevelSelect = document.createElement('select');
            languageLevelSelect.id = 'cc-language-level';
            languageLevelSelect.className = 'cc-language-level';
            [
                ['', 'Choose after reviewing the course'],
                ['basic', 'Beginning / basic'],
                ['other', 'Higher level / other'],
            ].forEach(function(pair) {
                const option = document.createElement('option');
                option.value = pair[0];
                option.innerText = pair[1];
                languageLevelSelect.appendChild(option);
            });
            languageLevelRow.appendChild(languageLevelSelect);

            const languageLevelHelp = document.createElement('p');
            languageLevelHelp.id = 'cc-language-level-help';
            languageLevelHelp.className = 'cc-language-note';
            languageLevelHelp.textContent = 'Only beginning/basic language courses use the two-course free-elective limit. Higher-level language courses do not use that limit.';
            languageLevelSelect.setAttribute('aria-describedby', languageLevelHelp.id);
            languageLevelRow.appendChild(languageLevelHelp);
            modal.appendChild(languageLevelRow);

            const initialLanguageLevel = (() => {
                const raw = courseObj && courseObj.Language_Level !== undefined
                    ? courseObj.Language_Level
                    : (prefill && prefill.languageLevel !== undefined ? prefill.languageLevel : '');
                const normalized = String(raw || '').trim().toLowerCase();
                return normalized === 'basic' || normalized === 'other' ? normalized : '';
            })();
            let languageLevelTouched = !!initialLanguageLevel;
            languageLevelSelect.value = initialLanguageLevel;

            const updateLanguageLevelRow = function() {
                const candidate = isCustomLanguageCandidate(
                    codeInput.value,
                    nameInput.value,
                    facultySelect.value,
                    languageLevelSelect.value || initialLanguageLevel
                );
                languageLevelRow.hidden = !candidate;
                languageLevelRow.classList.toggle('is-hidden', !candidate);
                if (!candidate) {
                    languageLevelSelect.value = '';
                    languageLevelSelect.required = false;
                    return;
                }
                languageLevelSelect.required = true;
                if (!languageLevelTouched) {
                    languageLevelSelect.value = titleExplicitlySaysBasicLanguage(nameInput.value)
                        ? 'basic' : '';
                }
            };
            languageLevelSelect.addEventListener('change', function() {
                languageLevelTouched = true;
            });
            codeInput.addEventListener('input', updateLanguageLevelRow);
            nameInput.addEventListener('input', updateLanguageLevelRow);
            facultySelect.addEventListener('change', updateLanguageLevelRow);

            // Every selected program gets its own category. Definitions remain
            // scoped by program code, so changing a main/double-major/minor
            // selection cannot reuse an unrelated program's classification.
            const contextCategoryControls = new Map();
            const transcriptLinksByProgram = new Map();
            if (isTranscriptReview && Array.isArray(linkedProgramCourses)) {
                linkedProgramCourses.forEach(function(link) {
                    const program = String((link && link.program) || '').trim().toUpperCase();
                    if (program && !transcriptLinksByProgram.has(program)) {
                        transcriptLinksByProgram.set(program, link);
                    }
                });
            }
            const initialCombinedCode = (() => {
                try {
                    if (courseObj && courseObj.Major && courseObj.Code) return String(courseObj.Major + courseObj.Code).toUpperCase();
                    if (prefill && prefill.code) return String(prefill.code).toUpperCase().replace(/\s+/g, '');
                } catch (_) {}
                return '';
            })();
            const findContextCustomType = (programCode, combinedCode) => {
                try {
                    if (!programCode || !combinedCode) return '';
                    const existing = loadCustomCoursesForMajor(programCode);
                    const target = _customClassificationIdentity(combinedCode);
                    const matches = [];
                    for (let i = 0; i < existing.length; i++) {
                        const rec = existing[i];
                        if (!rec) continue;
                        const code = _customClassificationIdentity(getCombinedCodeFromCourseObj(rec));
                        if (code === target) matches.push(rec);
                    }
                    if (matches.length === 1) return String(matches[0].EL_Type || '').toLowerCase();
                } catch (_) {}
                return '';
            };
            getActiveContextProgramCodes().forEach(function(programCode, index) {
                const contextTypeRow = document.createElement('div');
                contextTypeRow.classList.add('cc-row', 'cc-program-category-row');
                contextTypeRow.dataset.program = programCode;
                const isDoubleMajorContext = programCode === String((getCurriculum() && getCurriculum().doubleMajor) || '').toUpperCase();
                const contextOptions = isDoubleMajorContext
                    ? ['core', 'area', 'university', 'free', 'required', 'none', 'unknown']
                    : ['required', 'core', 'area', 'free', 'unknown'];
                const contextTypeLabel = document.createElement('label');
                const selectId = `cc-program-category-${index}`;
                contextTypeLabel.innerText = `${programCode} Category:`;
                contextTypeLabel.htmlFor = selectId;
                const contextCategoryHelp = createProgramCategoryHelp(programCode, contextOptions);
                const contextLabelLine = document.createElement('div');
                contextLabelLine.className = 'program-category-label-line';
                contextLabelLine.appendChild(contextTypeLabel);
                contextLabelLine.appendChild(contextCategoryHelp.button);
                contextTypeRow.appendChild(contextLabelLine);

                const contextTypeSelect = document.createElement('select');
                contextTypeSelect.id = selectId;
                contextTypeSelect.className = 'cc-program-category';
                contextOptions.forEach(function(opt) {
                    const option = document.createElement('option');
                    option.value = opt;
                    option.innerText = opt === 'unknown'
                        ? 'N/A (not allocated)'
                        : opt.charAt(0).toUpperCase() + opt.slice(1);
                    contextTypeSelect.appendChild(option);
                });
                const normalizeContextType = function(value) {
                    const type = String(value || '').toLowerCase();
                    return contextOptions.includes(type) ? type : 'unknown';
                };
                let editableValue = normalizeContextType(
                    findContextCustomType(programCode, initialCombinedCode)
                );
                let categoryTouched = false;
                let lastSyncedCode = null;
                contextTypeSelect.value = editableValue;
                contextTypeSelect.addEventListener('change', function() {
                    if (!contextTypeSelect.disabled) {
                        editableValue = contextTypeSelect.value;
                        categoryTouched = true;
                    }
                });
                contextTypeRow.appendChild(contextTypeSelect);
                contextTypeRow.appendChild(contextCategoryHelp.panel);

                const officialNote = document.createElement('small');
                officialNote.id = `${selectId}-official-note`;
                officialNote.className = 'cc-program-category-note cc-language-note is-hidden';
                officialNote.textContent = 'The official catalog category applies to this course.';
                contextTypeRow.appendChild(officialNote);

                const syncOfficialCategory = function() {
                    const currentCode = normalizeCombinedCourseCode(codeInput.value);
                    if (!categoryTouched && currentCode !== lastSyncedCode) {
                        const storedType = findContextCustomType(programCode, currentCode);
                        if (storedType) {
                            // A pre-existing target definition owns its category.
                            editableValue = normalizeContextType(storedType);
                        } else if (!courseObj) {
                            // A fresh Add form has no source definition whose
                            // category should follow the newly typed code.
                            editableValue = 'unknown';
                        }
                        // On edit/rename, an absent target inherits the source
                        // program's current category. This is still untouched
                        // UI state; an explicit selection below always wins.
                    }
                    lastSyncedCode = currentCode;
                    const official = findOfficialContextCourse(programCode, currentCode);
                    if (official) {
                        const officialType = String(official.EL_Type || '').toLowerCase();
                        contextTypeSelect.value = Array.from(contextTypeSelect.options).some(function(option) {
                            return option.value === officialType;
                        }) ? officialType : 'unknown';
                        contextTypeSelect.disabled = true;
                        contextTypeSelect.setAttribute('aria-describedby', officialNote.id);
                        officialNote.classList.remove('is-hidden');
                    } else {
                        contextTypeSelect.disabled = false;
                        contextTypeSelect.removeAttribute('aria-describedby');
                        contextTypeSelect.value = editableValue;
                        officialNote.classList.add('is-hidden');
                    }
                };
                contextCategoryControls.set(programCode, {
                    select: contextTypeSelect,
                    syncOfficialCategory,
                    getEditableValue: function() { return editableValue; },
                });
                modal.appendChild(contextTypeRow);
                syncOfficialCategory();
            });
            codeInput.addEventListener('input', function() {
                syncPrimaryOfficialCategory();
                contextCategoryControls.forEach(function(control) {
                    control.syncOfficialCategory();
                });
            });

            // If prefill data or an existing course object is provided,
            // populate the inputs and select accordingly.
            if (prefill || courseObj) {
                // Code may be provided as combined string or separate parts; if we
                // have courseObj (the actual course object), we can use its
                // Major and Code fields to reconstruct the code. Otherwise use
                // prefill.code.
                if (courseObj && courseObj.Major != null && courseObj.Code != null) {
                    codeInput.value = courseObj.Major + courseObj.Code;
                } else if (prefill.code) {
                    codeInput.value = prefill.code;
                }
                if (courseObj && courseObj.Course_Name) {
                    nameInput.value = courseObj.Course_Name;
                } else if (prefill.name) {
                    nameInput.value = prefill.name;
                }
                if (courseObj && courseObj.SU_credit !== undefined && courseObj.SU_credit !== null) {
                    suInput.value = courseObj.SU_credit;
                } else if (prefill.suCredits !== undefined) {
                    suInput.value = prefill.suCredits;
                }
                if (courseObj && courseObj.ECTS !== undefined && courseObj.ECTS !== null) {
                    ectsInput.value = courseObj.ECTS;
                } else if (prefill.ects !== undefined) {
                    ectsInput.value = prefill.ects;
                }
                if (courseObj && courseObj.Basic_Science !== undefined) {
                    bsInput.value = courseObj.Basic_Science;
                } else if (prefill.basicScience !== undefined) {
                    bsInput.value = prefill.basicScience;
                }
                if (courseObj && courseObj.Engineering !== undefined) {
                    engInput.value = courseObj.Engineering;
                } else if (prefill.engineering !== undefined) {
                    engInput.value = prefill.engineering;
                }
                // Set EL type dropdown
                if (courseObj && courseObj.EL_Type) {
                    typeSelect.value = courseObj.EL_Type;
                } else if (prefill.elType) {
                    typeSelect.value = prefill.elType;
                }
                primaryEditableType = normalizePrimaryType(typeSelect.value);
                // Set faculty dropdown ('' is a real, meaningful choice here,
                // so check for presence rather than truthiness.)
                if (courseObj && courseObj.Faculty !== undefined && courseObj.Faculty !== null) {
                    facultySelect.value = String(courseObj.Faculty);
                } else if (prefill.faculty !== undefined) {
                    facultySelect.value = String(prefill.faculty);
                }
            }

            contextCategoryControls.forEach(function(control) {
                control.syncOfficialCategory();
            });
            syncPrimaryOfficialCategory();

            updateLanguageLevelRow();

        // Buttons container
        const buttonsRow = document.createElement('div');
        buttonsRow.classList.add('cc-buttons');

        const cancelBtn = document.createElement('button');
        cancelBtn.innerText = isTranscriptReview ? 'Skip & Remove' : 'Cancel';
        cancelBtn.classList.add('btn', 'btn-secondary', 'btn-sm');
            cancelBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                if (typeof onCancelCallback === 'function' && onCancelCallback() === false) {
                    return;
                }
                if (customCourseDialog) customCourseDialog.close();
                // Normal edit cancellation preserves its historical callback
                // behavior; transcript cancellation reaches here only after a
                // successful rollback.
                if (typeof onSaveCallback === 'function') {
                    onSaveCallback();
                }
            });
        buttonsRow.appendChild(cancelBtn);

        const saveBtn = document.createElement('button');
        saveBtn.innerText = isTranscriptReview ? 'Save & Keep' : 'Save';
        saveBtn.classList.add('btn', 'btn-primary', 'btn-sm');
            saveBtn.addEventListener('click', async function(e) {
                e.stopPropagation();
                // Read input values
                const rawCode = normalizeCombinedCourseCode(codeInput.value);
                if (!rawCode) {
                    await uiAlert('Missing course code', '<p>Course code is required.</p>');
                    return;
                }
                const parsedIdentity = splitCombinedCourseCode(rawCode);
                if (!parsedIdentity) {
                    await uiAlert('Invalid course code', '<p>Invalid course code format. Use e.g. <strong>CS300</strong>, <strong>MATH101</strong>, or <strong>ACC201R</strong>.</p>');
                    return;
                }
                const parsedMajor = parsedIdentity.major;
                const parsedCode = parsedIdentity.code;
                const originalCombinedCode = courseObj ? getCombinedCodeFromCourseObj(courseObj) : '';
                const combinedCodeNow = parsedIdentity.combined;
                const editingDormantPrimaryOverlay = !!originalCombinedCode
                    && getPrimaryCatalogIdentitySet().has(
                        _customClassificationIdentity(originalCombinedCode)
                    );
                if (editingDormantPrimaryOverlay && originalCombinedCode !== combinedCodeNow) {
                    await uiAlert(
                        'Official catalog course code',
                        '<p>This saved classification is dormant because the current catalog already contains that course code. Its code cannot be renamed here.</p>'
                    );
                    return;
                }
                const languageLevel = languageLevelRow.hidden
                    ? '' : String(languageLevelSelect.value || '').toLowerCase();
                if (!languageLevelRow.hidden && languageLevel !== 'basic' && languageLevel !== 'other') {
                    await uiAlert(
                        'Choose the language level',
                        '<p>Select whether this is a <strong>Beginning / basic</strong> or <strong>Higher level / other</strong> language course. This determines whether the beginning-language limit applies.</p>'
                    );
                    languageLevelSelect.focus();
                    return;
                }
                let candidate;
                try {
                    const candidateInput = {
                        Major: parsedMajor,
                        Code: parsedCode,
                        Course_Name: nameInput.value.trim() || rawCode,
                        ECTS: ectsInput.value.toString() || '0',
                        Engineering: engInput.value.toString() || '0',
                        Basic_Science: bsInput.value.toString() || '0',
                        SU_credit: suInput.value.toString() || '0',
                        Faculty: facultySelect.value,
                        EL_Type: typeSelect.disabled ? primaryEditableType : typeSelect.value,
                        Faculty_Course: 'No'
                    };
                    if (languageLevel) candidateInput.Language_Level = languageLevel;
                    candidate = normalizeCustomCourseForStorage(candidateInput);
                } catch (validationError) {
                    await uiAlert(
                        'Invalid custom course',
                        `<p>${escapeHtml(validationError && validationError.message ? validationError.message : 'Please check the course fields.')}</p>`
                    );
                    return;
                }

                const majorKey = String(getPrimaryProgram() || '').toUpperCase();
                const key = 'customCourses_' + majorKey;
                const previousRaw = planGetItem(key);
                const existing = loadCustomCoursesForMajor(majorKey);
                let storageIndex = -1;
                if (courseObj) {
                    storageIndex = findCustomCourseStorageIndex(existing, originalCombinedCode, courseStorageIndex);
                    if (storageIndex < 0) {
                        await uiAlert('Could not identify custom course', `<p><strong>${escapeHtml(originalCombinedCode)}</strong> has duplicate or missing saved definitions. No changes were made.</p>`);
                        return;
                    }
                }
                const conflict = customCourseIdentityConflict(existing, combinedCodeNow, storageIndex);
                if (conflict) {
                    const description = conflict === 'catalog'
                        ? 'already exists in the selected program catalog'
                        : 'is already used by another custom course';
                    await uiAlert('Course code already exists', `<p><strong>${escapeHtml(combinedCodeNow)}</strong> ${description}. Choose a different code.</p>`);
                    return;
                }

                const next = existing.slice();
                if (courseObj) next[storageIndex] = candidate;
                else next.push(candidate);

                // Prepare every active secondary-program definition before the
                // first write. Each program keeps a full course record with its
                // own EL_Type while course identity, credits, faculty and
                // language metadata stay synchronized with the primary record.
                const contextPlans = [];
                let contextPreparationError = '';
                try {
                    getActiveContextProgramCodes().forEach(function(programCode) {
                        if (contextPreparationError) return;
                        const contextKey = 'customCourses_' + programCode;
                        const contextPreviousRaw = planGetItem(contextKey);
                        const contextExisting = loadCustomCoursesForMajor(programCode);
                        const originalMatches = [];
                        const targetMatches = [];
                        const originalIdentity = _customClassificationIdentity(originalCombinedCode);
                        const targetIdentity = _customClassificationIdentity(combinedCodeNow);
                        contextExisting.forEach(function(record, index) {
                            const recordIdentity = _customClassificationIdentity(getCombinedCodeFromCourseObj(record));
                            if (originalIdentity && recordIdentity === originalIdentity) originalMatches.push(index);
                            if (recordIdentity === targetIdentity) targetMatches.push(index);
                        });
                        if (originalMatches.length > 1 || targetMatches.length > 1) {
                            contextPreparationError = `${programCode} has duplicate saved definitions for this course.`;
                            return;
                        }
                        const originalIndex = originalMatches.length ? originalMatches[0] : -1;
                        const targetIndex = targetMatches.length ? targetMatches[0] : -1;
                        const officialCourse = findOfficialContextCourse(programCode, combinedCodeNow);
                        // Renaming into an official code retires only the old
                        // contextual overlay. The target catalog row is
                        // authoritative, and no new dormant overlay is created.
                        if (officialCourse && originalCombinedCode
                            && originalCombinedCode !== combinedCodeNow) {
                            if (originalIndex >= 0) {
                                const contextNext = contextExisting.slice();
                                contextNext.splice(originalIndex, 1);
                                contextPlans.push({
                                    programCode,
                                    key: contextKey,
                                    previousRaw: contextPreviousRaw,
                                    previousList: contextExisting,
                                    nextList: contextNext,
                                });
                            }
                            return;
                        }

                        // When a rename targets a definition that this program
                        // already knows, merge into that target and retire the
                        // old-code overlay. The target's stored category remains
                        // the untouched default exposed by the control above.
                        const existingIndex = targetIndex >= 0 ? targetIndex : originalIndex;
                        // If the course is official in this admit term and has no
                        // overlay, the catalog is sufficient. A same-code dormant
                        // overlay is retained so switching terms can restore that
                        // program-scoped classification.
                        if (officialCourse && existingIndex < 0) return;

                        const control = contextCategoryControls.get(programCode);
                        const existingType = existingIndex >= 0
                            ? String(contextExisting[existingIndex].EL_Type || '').toLowerCase() : '';
                        const selectedType = control && typeof control.getEditableValue === 'function'
                            ? String(control.getEditableValue() || '').toLowerCase() : '';
                        const finalType = selectedType || existingType || 'unknown';
                        const contextInput = Object.assign({}, candidate, { EL_Type: finalType });
                        const transcriptLink = transcriptLinksByProgram.get(programCode);
                        if (existingIndex >= 0 && transcriptLink
                            && transcriptLink.previousCourse
                            && typeof transcriptLink.previousCourse === 'object') {
                            const existingContext = contextExisting[existingIndex];
                            // Save & Keep refreshes the transcript fields shared
                            // through `candidate`, but retains each program's
                            // non-transcript classification metadata. Language
                            // level intentionally remains candidate-owned so one
                            // reviewed choice is shared across every program.
                            contextInput.Engineering = existingContext.Engineering;
                            contextInput.Basic_Science = existingContext.Basic_Science;
                            contextInput.Faculty = existingContext.Faculty;
                            contextInput.Faculty_Course = 'No';
                        }
                        const contextCandidate = normalizeCustomCourseForStorage(contextInput);
                        const contextNext = contextExisting.slice();
                        let nextIndex = existingIndex;
                        if (originalCombinedCode && originalCombinedCode !== combinedCodeNow
                            && originalIndex >= 0 && originalIndex !== existingIndex) {
                            contextNext.splice(originalIndex, 1);
                            if (nextIndex > originalIndex) nextIndex -= 1;
                        }
                        if (nextIndex >= 0) contextNext[nextIndex] = contextCandidate;
                        else contextNext.push(contextCandidate);
                        contextPlans.push({
                            programCode,
                            key: contextKey,
                            previousRaw: contextPreviousRaw,
                            previousList: contextExisting,
                            nextList: contextNext,
                        });
                    });
                } catch (contextError) {
                    contextPreparationError = contextError && contextError.message
                        ? contextError.message : 'A selected program category is invalid.';
                }
                if (contextPreparationError) {
                    await uiAlert(
                        'Could not prepare program categories',
                        `<p>${escapeHtml(contextPreparationError)} No changes were made.</p>`
                    );
                    return;
                }

                const storagePlans = [{
                    programCode: majorKey,
                    key,
                    previousRaw,
                    previousList: existing,
                    nextList: next,
                    primary: true,
                }].concat(contextPlans);
                const completedWrites = [];
                const rollbackStoragePlans = function() {
                    let restored = true;
                    for (let i = completedWrites.length - 1; i >= 0; i--) {
                        if (restoreStoredValue(completedWrites[i].key, completedWrites[i].previousRaw) === false) {
                            restored = false;
                        }
                    }
                    return restored;
                };
                let storageWriteFailed = false;
                for (let i = 0; i < storagePlans.length; i++) {
                    const plan = storagePlans[i];
                    try {
                        if (planSetItem(plan.key, JSON.stringify(plan.nextList)) === false) {
                            storageWriteFailed = true;
                            break;
                        }
                        completedWrites.push(plan);
                    } catch (_) {
                        storageWriteFailed = true;
                        break;
                    }
                }
                if (storageWriteFailed) {
                    const restored = rollbackStoragePlans();
                    await uiAlert(
                        'Could not save custom course',
                        `<p><strong>${escapeHtml(combinedCodeNow)}</strong> was not changed because browser storage rejected a program category.${restored ? '' : ' Some saved data could not be restored; reload before continuing.'}</p>`
                    );
                    return;
                }

                let previousRecord = null;
                let previousCourseDataIndex = -1;
                if (editingDormantPrimaryOverlay) {
                    previousRecord = courseObj;
                } else if (courseObj) {
                    previousRecord = getPrimaryCustomRecords().find(function(record) {
                        return getCombinedCodeFromCourseObj(record) === originalCombinedCode;
                    }) || courseObj;
                    previousCourseDataIndex = getCourseData().indexOf(previousRecord);
                    if (previousCourseDataIndex < 0) previousCourseDataIndex = getCourseData().indexOf(courseObj);
                    const primaryRuntimeIndex = getPrimaryCustomRecords().indexOf(previousRecord);
                    if (primaryRuntimeIndex >= 0) getPrimaryCustomRecords().splice(primaryRuntimeIndex, 1, candidate);
                    else getPrimaryCustomRecords().push(candidate);
                    if (previousCourseDataIndex >= 0) getCourseData()[previousCourseDataIndex] = candidate;
                    else getCourseData().push(candidate);
                } else {
                    getPrimaryCustomRecords().push(candidate);
                    getCourseData().push(candidate);
                }

                const codeChanged = !!courseObj && originalCombinedCode !== combinedCodeNow;
                if (!editingDormantPrimaryOverlay) {
                    if (codeChanged) renameSemesterOccurrences(originalCombinedCode, combinedCodeNow, candidate);
                    else refreshSemesterOccurrenceDom(combinedCodeNow, candidate);
                }

                contextPlans.forEach(function(plan) {
                    replaceContextRuntimeCustomCourses(plan.programCode, plan.nextList);
                });
                // Update any open dropdowns so the new or updated course appears as an option
                refreshCourseDatalistsAndTypes();
                const saveRequested = requestPlanSave();
                if (codeChanged && (!saveRequested || !flushPlanSaves())) {
                    const restored = rollbackStoragePlans();
                    contextPlans.forEach(function(plan) {
                        replaceContextRuntimeCustomCourses(plan.programCode, plan.previousList);
                    });
                    const candidateRuntimeIndex = getPrimaryCustomRecords().indexOf(candidate);
                    if (candidateRuntimeIndex >= 0 && previousRecord) {
                        getPrimaryCustomRecords().splice(candidateRuntimeIndex, 1, previousRecord);
                    }
                    if (previousCourseDataIndex >= 0 && previousRecord) getCourseData()[previousCourseDataIndex] = previousRecord;
                    renameSemesterOccurrences(combinedCodeNow, originalCombinedCode, previousRecord || courseObj);
                    refreshCourseDatalistsAndTypes();
                    await uiAlert('Could not rename custom course', `<p>The planner snapshot could not be saved. <strong>${escapeHtml(originalCombinedCode)}</strong> was ${restored ? 'restored' : 'not fully restored; reload before continuing'}.</p>`);
                    return;
                }
                // Remove modal
                if (customCourseDialog) customCourseDialog.close();
                // Invoke callback to process next pending custom course
                if (typeof onSaveCallback === 'function') {
                    onSaveCallback();
                }
            });
        buttonsRow.appendChild(saveBtn);

        modal.appendChild(buttonsRow);

        // Prevent overlay clicks from triggering underlying events
        modal.addEventListener('click', function(e) {
            e.stopPropagation();
        });

        // Append modal to overlay and overlay to board
        overlay.appendChild(modal);
        // Do not allow closing the form by clicking outside the modal
        overlay.addEventListener('click', function(e) {
            e.stopPropagation();
        });
        boardDom.appendChild(overlay);
        customCourseDialog = activateAccessibleDialog(overlay, modal, title, {
            initialFocus: codeInput,
            onEscape: function() { cancelBtn.click(); },
        });
    }

        function showPendingReview(options) {
            const review = options || {};
            return showCustomCourseForm(
                review.prefill || null,
                review.course || null,
                review.onSave || null,
                review.onCancel || null,
                Number.isInteger(review.storageIndex) ? review.storageIndex : null,
                Array.isArray(review.linkedProgramCourses) ? review.linkedProgramCourses : null
            );
        }


        return Object.freeze({
            showForm: showCustomCourseForm,
            showPendingReview,
        });
    }

    root.surriculumCustomCourseForm = Object.freeze({ createController });
})(typeof window !== 'undefined' ? window : globalThis);
