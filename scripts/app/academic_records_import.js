// Academic Records Summary/PDF import controller.
// Loaded as a deferred classic script after the transcript parser and PDF reader.
(function (global) {
    'use strict';

    const documentClassifiers = Object.freeze({
        mentionsDegreeEvaluation(text) {
            try { return /degree\s+evaluation/i.test(String(text || '')); }
            catch (_) { return false; }
        },
        isEngineeringCreditDistribution(text) {
            try {
                const value = String(text || '');
                return /\bbasic\s+science\s+and\s+engineering\b/i.test(value)
                    && /\bects\b/i.test(value)
                    && /\bdistribution\b/i.test(value);
            } catch (_) { return false; }
        },
        isAcademicRecordsSummary(text) {
            try { return /academic\s+records\s+summary/i.test(String(text || '')); }
            catch (_) { return false; }
        },
        isYokTranscript(text) {
            try {
                const value = String(text || '');
                return value.includes('NOT DÖKÜM BELGESİ') || value.includes('NOT DOKUM BELGESI');
            } catch (_) { return false; }
        },
        isNoPermissionHtml(text) {
            try {
                const value = String(text || '');
                return value.includes('Sorry! You have no permission to access this page')
                    || value.includes('You have no permission to access this page')
                    || value.includes('Thanks for your patience')
                    || value.includes('Information Technology</h3>');
            } catch (_) { return false; }
        },
    });

    function classifyDocument(text) {
        if (documentClassifiers.isYokTranscript(text)) return 'yok-transcript';
        if (documentClassifiers.isAcademicRecordsSummary(text)) return 'academic-records-summary';
        if (documentClassifiers.isNoPermissionHtml(text)) return 'no-permission-html';
        if (documentClassifiers.isEngineeringCreditDistribution(text)) return 'credit-distribution';
        if (documentClassifiers.mentionsDegreeEvaluation(text)) return 'degree-evaluation';
        return 'unknown';
    }

    function createController(options) {
        const opts = options || {};
        const runtime = opts.runtime || global.surriculumAppRuntime;
        if (!runtime) throw new Error('Academic import requires surriculumAppRuntime.');
        const parser = opts.parser || global.academicRecordsParser;
        const pdfReader = opts.pdfReader || global.pdfTranscriptReader;
        const getCourseData = typeof opts.getCourseData === 'function' ? opts.getCourseData : () => [];
        const getCurriculum = typeof opts.getCurriculum === 'function' ? opts.getCurriculum : () => null;
        const processPending = typeof opts.processPendingCustomCourses === 'function'
            ? opts.processPendingCustomCourses : () => {};
        const loadCoursePageInfoIndex = opts.loadCoursePageInfoIndex || global.loadCoursePageInfoIndex;
        const getStorage = typeof opts.getStorage === 'function'
            ? opts.getStorage : () => global.planStorage || null;
        const getUi = typeof opts.getUi === 'function'
            ? opts.getUi : () => global.uiModal || null;
        const sessionPlanId = Object.prototype.hasOwnProperty.call(opts, 'sessionPlanId')
            ? opts.sessionPlanId : runtime.sessionPlanId;
        const escapeHtml = runtime.escapeHtml;
        const uiAlert = runtime.uiAlert;
        const admitTermPolicyListHtml = runtime.guidance.policyListHtml;
        const admitTermVerificationHtml = runtime.guidance.verificationHtml;

        async function handleAcademicRecordsImport() {
        const fileInput = document.getElementById('academicRecordsInput');

        if (fileInput.files.length > 0) {
            const file = fileInput.files[0];
            let parsedData;

            try {
                const ui = getUi();
                const {
                    mentionsDegreeEvaluation,
                    isEngineeringCreditDistribution,
                    isAcademicRecordsSummary,
                    isYokTranscript,
                    isNoPermissionHtml,
                } = documentClassifiers;
                const showDegreeEvalWarning = async () => {
                    const ui = getUi();
                    const title = 'Wrong file: Degree Evaluation';
                    const body = (
                        '<p>This looks like a <strong>Degree Evaluation</strong> document. SUrriculum can only import from your <strong>Academic Records Summary</strong>.</p>' +
                        '<p><strong>Please do not upload Degree Evaluation.</strong></p>' +
                        '<p>Please upload the correct file:</p>' +
                        '<ol>' +
                        '<li>Go to <strong>SUIS</strong> → <strong>Student</strong> → <strong>Student Records</strong> → <strong>Academic Transcript</strong></li>' +
                        '<li>Open your <strong>Academic Records Summary</strong></li>' +
                        '<li>Save it as <strong>HTML (preferred)</strong> or print to <strong>PDF</strong></li>' +
                        '<li>Upload that file here</li>' +
                        '</ol>' +
                        '<p>You can also upload your <strong>YÖK Transcript PDF</strong> (not preferred).</p>'
                    );
                    try { fileInput.value = ''; } catch (_) {}
                    try {
                        if (ui && typeof ui.alert === 'function') {
                            await ui.alert(title, body);
                        } else {
                            await uiAlert(title, body);
                        }
                    } catch (_) {}
                };
                const showCreditDistributionWarning = async () => {
                    const title = 'Wrong file: course credit-distribution list';
                    const body = (
                        '<p>This is a <strong>Basic Science and Engineering ECTS credit-distribution list</strong>, not a student transcript. SUrriculum can only import from your <strong>Academic Records Summary</strong>.</p>' +
                        '<p>Please upload the correct file:</p>' +
                        '<ol>' +
                        '<li>Go to <strong>SUIS</strong> → <strong>Student</strong> → <strong>Student Records</strong> → <strong>Academic Transcript</strong></li>' +
                        '<li>Open your <strong>Academic Records Summary</strong></li>' +
                        '<li>Save it as <strong>HTML (preferred)</strong> or print to <strong>PDF</strong></li>' +
                        '<li>Upload that file here</li>' +
                        '</ol>' +
                        '<p>You can also upload your <strong>YÖK Transcript PDF</strong> (not preferred).</p>'
                    );
                    try { fileInput.value = ''; } catch (_) {}
                    try {
                        if (ui && typeof ui.alert === 'function') {
                            await ui.alert(title, body);
                        } else {
                            await uiAlert(title, body);
                        }
                    } catch (_) {}
                };
                const showHtmlSaveWarning = async () => {
                    const title = 'Cannot import this HTML file';
                    const body =
                        '<p>This HTML file does not contain your transcript data. This usually happens when you save the page as <strong>HTML only</strong> or when the saved page is missing required content.</p>' +
                        '<p>Please re-save your <strong>Academic Records Summary</strong> as:</p>' +
                        '<ol>' +
                        '<li>Open <strong>Academic Records Summary</strong> in SUIS (make sure you are logged in)</li>' +
                        '<li>Press <strong>Ctrl+S</strong> / <strong>Save Page As…</strong></li>' +
                        '<li>Choose <strong>Webpage, Complete</strong> (not “HTML only”)</li>' +
                        '<li>Upload the saved <strong>.html</strong> file here</li>' +
                        '</ol>' +
                        '<p>Alternatively, print the same page to <strong>PDF</strong> and import that.</p>' +
                        '<p>You can also upload a <strong>YÖK Transcript PDF</strong> (not preferred).</p>';
                    try { fileInput.value = ''; } catch (_) {}
                    try {
                        if (ui && typeof ui.alert === 'function') await ui.alert(title, body);
                        else await uiAlert(title, body);
                    } catch (_) {}
                };

                if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
                    if (!pdfReader || typeof pdfReader.extractText !== 'function') {
                        throw new Error('The local PDF transcript reader is unavailable.');
                    }
                    const extraction = await pdfReader.extractText(file);
                    const text = extraction.text;
                    // Academic Records PDFs may mention Degree Evaluation at the end.
                    // Classify known non-transcript documents before using that phrase
                    // as a Degree Evaluation signal. Never apply this to YÖK transcripts.
                    if (!isYokTranscript(text) && !isAcademicRecordsSummary(text)) {
                        if (isEngineeringCreditDistribution(text)) {
                            await showCreditDistributionWarning();
                            return;
                        }
                        if (mentionsDegreeEvaluation(text)) {
                            await showDegreeEvalWarning();
                            return;
                        }
                    }
                    parsedData = parser.parseAcademicRecordsPdf(text);
                } else {
                    const maxTranscriptFileBytes = 10 * 1024 * 1024;
                    if (Number.isFinite(file.size) && file.size > maxTranscriptFileBytes) {
                        const sizeError = new Error('Transcript file exceeds the 10 MB limit.');
                        sizeError.code = 'TRANSCRIPT_FILE_TOO_LARGE';
                        throw sizeError;
                    }
                    const htmlContent = await file.text();
                    // File.size is authoritative for normal browser File objects;
                    // keep a string-length backstop for synthetic/legacy objects.
                    if (htmlContent.length > maxTranscriptFileBytes) {
                        const sizeError = new Error('Transcript file exceeds the 10 MB limit.');
                        sizeError.code = 'TRANSCRIPT_FILE_TOO_LARGE';
                        throw sizeError;
                    }
                    if (isNoPermissionHtml(htmlContent)) {
                        await showHtmlSaveWarning();
                        return;
                    }
                    if (!isAcademicRecordsSummary(htmlContent)) {
                        if (isEngineeringCreditDistribution(htmlContent)) {
                            await showCreditDistributionWarning();
                            return;
                        }
                        if (mentionsDegreeEvaluation(htmlContent)) {
                            await showDegreeEvalWarning();
                            return;
                        }
                    }
                    parsedData = parser.parseAcademicRecords(htmlContent);
                }
            } catch (err) {
                const ui = getUi();
                const errorCode = err && typeof err.code === 'string' ? err.code : '';
                const showImportAlert = async (title, body) => {
                    if (ui && typeof ui.alert === 'function') await ui.alert(title, body);
                    else await uiAlert(title, body);
                };
                if (errorCode === 'PDF_NO_TEXT') {
                    try { fileInput.value = ''; } catch (_) {}
                    await showImportAlert(
                        'PDF has no readable text',
                        '<p>The PDF contains pages, but it has no selectable text for SUrriculum to read.</p>' +
                        '<p>This commonly happens with <strong>Microsoft Print to PDF</strong>. Open Academic Records Summary again and use your browser\'s <strong>Save as PDF</strong>, or save it as <strong>HTML (Webpage, Complete)</strong>.</p>' +
                        '<p>If the document was scanned, run OCR before importing it.</p>'
                    );
                    return;
                }
                if (['PDF_FILE_TOO_LARGE', 'PDF_TOO_MANY_PAGES', 'PDF_TOO_COMPLEX'].includes(errorCode)) {
                    try { fileInput.value = ''; } catch (_) {}
                    await showImportAlert(
                        'PDF is too large or complex',
                        '<p>For safe local processing, transcript imports are limited to <strong>10 MB</strong>, <strong>100 pages</strong>, 50,000 text fragments, and 1,000,000 extracted characters.</p>' +
                        '<p>Please export only Academic Records Summary, or save it as <strong>HTML (Webpage, Complete)</strong>.</p>'
                    );
                    return;
                }
                if (errorCode === 'TRANSCRIPT_FILE_TOO_LARGE') {
                    try { fileInput.value = ''; } catch (_) {}
                    await showImportAlert(
                        'Transcript file is too large',
                        '<p>For safe local processing, HTML transcript imports are limited to <strong>10 MB</strong>.</p>' +
                        '<p>Please save only Academic Records Summary as <strong>HTML (Webpage, Complete)</strong>, or import its PDF export.</p>'
                    );
                    return;
                }
                console.error(err);
                if (ui && typeof ui.alert === 'function') {
                    await ui.alert('Import failed', '<p>Failed to read the file.</p><p>Please try exporting again as HTML (preferred) or PDF.</p>');
                } else {
                    await uiAlert('Import failed', '<p>Failed to read the file.</p><p>Please try exporting again as HTML (preferred) or PDF.</p>');
                }
                return;
            }

            const parserInvalidGrades = parsedData && Array.isArray(parsedData.invalidGradeCourses)
                ? parsedData.invalidGradeCourses : [];
            const parserSuperseded = parsedData && Array.isArray(parsedData.supersededCourses)
                ? parsedData.supersededCourses : [];
            const parserSkipped = parsedData && Array.isArray(parsedData.skippedCourses)
                ? parsedData.skippedCourses : [];
            const importRecordCode = (item) => escapeHtml(
                item && typeof item === 'object' && item.code ? item.code : (item || 'Unknown course')
            );
            const importRecordContext = (item, semesterField = 'semester', gradeField = 'grade') => {
                if (!item || typeof item !== 'object') return '';
                const details = [];
                if (item[semesterField]) details.push(escapeHtml(item[semesterField]));
                if (item[gradeField] !== undefined && item[gradeField] !== null && String(item[gradeField]).trim()) {
                    details.push(`grade ${escapeHtml(String(item[gradeField]).trim())}`);
                }
                return details.length ? ` <small>(${details.join(', ')})</small>` : '';
            };
            const renderImportRecordList = (items, describe) => {
                if (!Array.isArray(items) || !items.length) return '';
                return `<ul>${items.map((item) => {
                    const detail = typeof describe === 'function'
                        ? describe(item)
                        : importRecordContext(item);
                    return `<li><strong>${importRecordCode(item)}</strong>${detail || ''}</li>`;
                }).join('')}</ul>`;
            };
            const describeSkippedImportRecord = (item) => {
                const context = importRecordContext(item);
                const reason = item && item.reason ? String(item.reason) : '';
                const descriptions = {
                    repeated: 'marked <strong>Repeated</strong> on the transcript. Sabancı uses this status for both repeated and substituted courses, so SUrriculum did not guess or import this record.',
                    excluded: 'marked <strong>Excluded</strong> on the transcript and was not imported.',
                    'ambiguous-existing-occurrence': 'multiple matching entries already exist in the plan, so no occurrence was changed.',
                    'invalid-course-code': 'the course code could not be interpreted.',
                    'missing-or-unrecognized-semester': 'the record has a <strong>missing or unrecognized semester</strong> (expected Fall, Spring, or Summer), so it was not imported.',
                    'custom-course-storage-failed': 'the custom-course definition could not be saved safely, so the course was not imported.',
                    'create-failed': 'the course could not be added to the plan.',
                    'create-unavailable': 'course creation was unavailable.'
                };
                const description = descriptions[reason]
                    || escapeHtml(reason ? reason.replace(/-/g, ' ') : 'not importable');
                return `${context}: ${description}`;
            };
            const renderImportChangeSections = (stats) => {
                const data = stats || {};
                const added = Array.isArray(data.addedCourses) ? data.addedCourses : [];
                const updated = Array.isArray(data.updatedCourses) ? data.updatedCourses : [];
                let html = '';
                if (added.length) {
                    html += `<p><strong>Added (${added.length}):</strong></p>${renderImportRecordList(added)}`;
                }
                if (updated.length) {
                    html += `<p><strong>Updated (${updated.length}):</strong></p>${renderImportRecordList(updated)}`;
                }
                return html;
            };
            const renderImportIssueSections = (stats) => {
                const data = stats || {};
                const notFound = Array.isArray(data.notFoundCourses) ? data.notFoundCourses : [];
                const retainedUnallocated = Array.isArray(data.retainedUnallocatedCourses)
                    ? data.retainedUnallocatedCourses : [];
                const invalid = Array.isArray(data.invalidGradeCourses) ? data.invalidGradeCourses : [];
                const alreadyPresent = Array.isArray(data.alreadyPresentCourses) ? data.alreadyPresentCourses : [];
                const superseded = Array.isArray(data.supersededCourses) ? data.supersededCourses : [];
                const skipped = Array.isArray(data.skippedCourses) ? data.skippedCourses : [];
                let html = '';
                if (retainedUnallocated.length) {
                    html += `<p><strong>Retained as N/A (${retainedUnallocated.length}):</strong> these courses were known to the cumulative course index or saved plan but were outside the selected program/admit-term catalogs.</p>${renderImportRecordList(retainedUnallocated)}`;
                    html += '<p><small>Their letter grades count toward CGPA, but they remain outside PGPA and graduation requirements until a matching major, double major, minor, and admit term is selected.</small></p>';
                }
                if (notFound.length) {
                    html += `<p><strong>Not found (${notFound.length}):</strong> these courses could not be verified in either the selected catalogs or the global course index and were not imported.</p>${renderImportRecordList(notFound, () => '')}`;
                }
                if (invalid.length) {
                    html += `<p><strong>Unsupported grades (${invalid.length}):</strong> these records were not imported.</p>${renderImportRecordList(invalid)}`;
                }
                if (alreadyPresent.length) {
                    html += `<p><strong>Already in the plan (${alreadyPresent.length}):</strong></p>${renderImportRecordList(alreadyPresent, (item) => {
                        if (item && item.reason === 'different-semester') {
                            const existing = item.semester ? escapeHtml(item.semester) : 'another semester';
                            const imported = item.importedSemester ? escapeHtml(item.importedSemester) : 'the transcript semester';
                            return `: already stored in ${existing}; the transcript places it in ${imported}, so SUrriculum left it unchanged.`;
                        }
                        return `${importRecordContext(item)}: already matched the imported record; no change was needed.`;
                    })}`;
                }
                if (superseded.length) {
                    html += `<p><strong>Older duplicate records (${superseded.length}):</strong> SUrriculum kept the latest record for each course:</p>${renderImportRecordList(superseded, (item) => {
                        const dropped = importRecordContext(item);
                        const kept = importRecordContext(item, 'keptSemester', 'keptGrade');
                        return `${dropped} → kept latest record${kept}`;
                    })}`;
                }
                if (skipped.length) {
                    html += `<p><strong>Skipped (${skipped.length}):</strong></p>${renderImportRecordList(skipped, describeSkippedImportRecord)}`;
                }
                return html;
            };
            if (!parsedData || !Array.isArray(parsedData.courses) || parsedData.courses.length === 0) {
                const ui = getUi();
                try {
                    if (parserInvalidGrades.length || parserSkipped.length || parserSuperseded.length) {
                        const body = '<p>The transcript was read, but it contained no importable latest course records.</p>'
                            + renderImportIssueSections({
                                invalidGradeCourses: parserInvalidGrades,
                                supersededCourses: parserSuperseded,
                                skippedCourses: parserSkipped
                            });
                        const title = parserInvalidGrades.length ? 'Grades need review' : 'No importable courses';
                        if (ui && typeof ui.alert === 'function') await ui.alert(title, body);
                        else await uiAlert(title, body);
                        return;
                    }
                    if (ui && typeof ui.alert === 'function') {
                        await ui.alert(
                            'No courses detected',
                            '<p>The file was read successfully, but no courses were detected.</p>' +
                            '<p>Make sure you upload the correct document:</p>' +
                            '<ol>' +
                            '<li>SUIS → Student → Student Records → Academic Transcript</li>' +
                            '<li>Open <strong>Academic Records Summary</strong> (not Degree Evaluation)</li>' +
                            '<li>Save as <strong>HTML</strong> (preferred) or print to <strong>PDF</strong></li>' +
                            '</ol>' +
                            '<p><strong>Important:</strong> Some PDFs created using <strong>Microsoft Print to PDF</strong> may not import correctly. If this happens, re-export the same page using <strong>Save as PDF</strong> (recommended) or save as <strong>HTML</strong> instead.</p>' +
                            '<p>If you are importing a <strong>YÖK Transcript PDF</strong>, ensure it is the “NOT DÖKÜM BELGESİ” format.</p>'
                        );
                    } else {
                        await uiAlert('No courses detected', '<p>No courses were detected in this file.</p>');
                    }
                } catch (_) {}
                return;
            }

            // Import courses to curriculum. The parser returns an object
            // containing both statistics and a list of pending custom
            // courses that need additional user input.
            // Load the catalog-independent identity index on demand. The
            // synchronous importer can then retain real courses that are only
            // missing because program/admit-term settings are incomplete.
            try {
                if (typeof loadCoursePageInfoIndex === 'function') {
                    await loadCoursePageInfoIndex();
                }
            } catch (_) {}
            const importStorage = getStorage();
            let importCheckpoint = null;
            try {
                if (!importStorage
                    || typeof importStorage.captureCheckpoint !== 'function'
                    || typeof importStorage.restoreCheckpoint !== 'function'
                    || typeof importStorage.flushSaves !== 'function') {
                    throw new Error('Plan checkpoint storage is unavailable.');
                }
                // A transcript parse can begin while a grade/course/term edit
                // is still inside the autosave debounce. Make that live state
                // durable before capturing the rollback point; otherwise a
                // later import-save failure could restore an older snapshot
                // and silently discard the edit made just before importing.
                if (importStorage.flushSaves({ onlyIfPending: true }) === false) {
                    throw new Error('Pending planner changes could not be saved.');
                }
                importCheckpoint = importStorage.captureCheckpoint(sessionPlanId || undefined);
            } catch (checkpointError) {
                await uiAlert(
                    'Import could not start',
                    '<p>SUrriculum could not save and checkpoint your current plan. Nothing was imported.</p>'
                );
                return;
            }

            const importResult = parser.importParsedCourses(
                parsedData.courses,
                getCourseData(),
                getCurriculum()
            );

            const importStats = importResult.stats;
            const pendingList = importResult.pendingCustomCourses || [];

            if (importStats) {
                const mergeParserIssues = (field, issues) => {
                    if (!issues.length) return;
                    if (!Array.isArray(importStats[field])) importStats[field] = [];
                    importStats[field].push(...issues);
                };
                mergeParserIssues('invalidGradeCourses', parserInvalidGrades);
                mergeParserIssues('supersededCourses', parserSuperseded);
                mergeParserIssues('skippedCourses', parserSkipped);
                if (parsedData && Number.isFinite(Number(parsedData.detectedRecords))) {
                    importStats.totalRecords = Number(parsedData.detectedRecords);
                }
                importStats.updatedCourseCount = Array.isArray(importStats.updatedCourses)
                    ? importStats.updatedCourses.length : Number(importStats.updatedCourseCount || 0);
                importStats.changedCourses = Number(importStats.importedCourses || 0) + importStats.updatedCourseCount;
            }

            const ui = getUi();
            if (!importStats || typeof importStats.importedCourses !== 'number') {
                if (ui && typeof ui.alert === 'function') {
                    await ui.alert('Import failed', '<p>Import did not return results.</p>');
                } else {
                    await uiAlert('Import failed', '<p>Import did not return results.</p>');
                }
                return;
            }

            const changedCourses = Number(importStats.changedCourses || 0);
            const issueSections = renderImportIssueSections(importStats);
            const alreadyPresentCount = Array.isArray(importStats.alreadyPresentCourses)
                ? importStats.alreadyPresentCourses.length : 0;

            if (changedCourses > 0) {
                let saved = false;
                try {
                    const requested = typeof importStorage.requestSave === 'function'
                        && importStorage.requestSave();
                    saved = !!requested
                        && typeof importStorage.flushSaves === 'function'
                        && importStorage.flushSaves() !== false;
                } catch (_) {
                    saved = false;
                }
                if (!saved) {
                    let restored = false;
                    try {
                        // Prevent pagehide/visibility handlers from retrying a
                        // failed live snapshot after the known-good checkpoint
                        // has been put back.
                        if (typeof importStorage.suspendSaves === 'function') {
                            importStorage.suspendSaves();
                        }
                        restored = importStorage.restoreCheckpoint(importCheckpoint) !== false;
                    } catch (_) {
                        restored = false;
                    }
                    await uiAlert(
                        'Import was not saved',
                        restored
                            ? '<p>Browser storage rejected the imported changes. Your previous plan was restored and will now be reloaded.</p>'
                            : '<p>Browser storage rejected the imported changes and the previous checkpoint could not be fully restored. Reload the page before making more changes, then restore a recent plan export if anything is missing.</p>'
                    );
                    global.location.reload();
                    return;
                }
            }

            if (changedCourses === 0) {
                const body = (
                    `<p>${alreadyPresentCount ? 'No plan changes were needed.' : 'No courses were added or updated.'}</p>` +
                    `<p>Detected <strong>${importStats.totalRecords || importStats.totalCourses || 0}</strong> transcript record(s).</p>` +
                    issueSections +
                    (!alreadyPresentCount
                        ? '<p>Check that the selected major/double major and admit terms match this transcript. Verify the relevant dates in <strong>SUIS → Student Records → General Student Information</strong>.</p>'
                        : '')
                );
                const title = alreadyPresentCount ? 'Import complete' : 'No courses imported';
                if (ui && typeof ui.alert === 'function') await ui.alert(title, body);
                else await uiAlert(title, body);
                return;
            }

            const updatedCount = Number(importStats.updatedCourseCount || 0);
            const messageHtml = `<p>Added <strong>${importStats.importedCourses}</strong> new course(s) and updated <strong>${updatedCount}</strong> existing course(s).</p>${renderImportChangeSections(importStats)}${issueSections}`;
            if (ui && typeof ui.alert === 'function') await ui.alert('Import complete', messageHtml);
            else await uiAlert('Import complete', messageHtml);

            // Reminder: program/admit-term selections are not inferred from the transcript.
            try {
                const reminderTitle = 'Reminder: choose your programs & admit terms';
                const reminderBody =
                    '<p>SUrriculum does <strong>not</strong> automatically detect your <strong>major</strong>, <strong>double major</strong>, <strong>minor(s)</strong>, or their <strong>admit terms</strong> from the imported file.</p>' +
                    '<p>Please double-check the sidebar selections so the requirements match your catalog:</p>' +
                    admitTermPolicyListHtml +
                    admitTermVerificationHtml +
                    '<p>If these are wrong, your graduation/summary results can look incorrect.</p>';
                if (ui && typeof ui.alert === 'function') await ui.alert(reminderTitle, reminderBody);
                else await uiAlert(reminderTitle, reminderBody);
            } catch (_) {}

            // If there are pending custom courses, process them
            if (pendingList.length > 0) {
                const queue = pendingList.slice();
                processPending(queue);
            }
            const importDropdown = document.getElementById('importDropdown');
            if (importDropdown) importDropdown.classList.remove('active');
        } else {
            const ui = getUi();
            if (ui && typeof ui.alert === 'function') {
                await ui.alert('Select a file', '<p>Please select an <strong>Academic Records Summary</strong> HTML/PDF file (or a YÖK Transcript PDF) and try again.</p>');
            } else {
                await uiAlert('Select a file', '<p>Please select a file and try again.</p>');
            }
        }
    }

        function bind() {
            const button = global.document.getElementById('importAcademicRecords');
            if (!button) return false;
            button.onclick = handleAcademicRecordsImport;
            // The static button starts disabled so a very fast click cannot be
            // lost while catalogs and planner state are still booting. Publish
            // interactivity only after its live import handler exists.
            button.disabled = false;
            if (typeof button.removeAttribute === 'function') {
                button.removeAttribute('aria-busy');
            }
            return true;
        }

        return Object.freeze({ bind, handleAcademicRecordsImport });
    }

    global.surriculumAcademicImport = Object.freeze({
        classifyDocument,
        createController,
    });
})(typeof window !== 'undefined' ? window : globalThis);
