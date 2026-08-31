// Application composition entry point. index.html loads the reviewed runtime
// dependencies as ordered deferred classic scripts before this file.

let course_data;
//can only be CS, BIO, MAT, EE, ME, IE, ECON, DSA, MAN, PSIR, PSY, VACD:
let initial_major_chosen = 'CS'
let saveInterval;

if (!window.surriculumAppRuntime) {
    throw new Error('scripts/app/runtime.js must load before main.js');
}
if (!window.surriculumProgramData) {
    throw new Error('scripts/app/program-data.js must load before main.js');
}
if (!window.surriculumAppShell || typeof window.surriculumAppShell.createController !== 'function') {
    throw new Error('scripts/app/shell-controller.js must load before main.js');
}
window.surriculumAppRuntime.configure({ getInitialMajor: () => initial_major_chosen });
window.__surriculumReady = false;
window.__surriculumPlannerReady = false;
let resolveSurriculumPlannerReady;
const surriculumPlannerReadyPromise = new Promise((resolve) => {
    resolveSurriculumPlannerReady = resolve;
});
window.surriculumPlannerReadyPromise = surriculumPlannerReadyPromise;
window.whenSurriculumPlannerReady = () => surriculumPlannerReadyPromise;

function settleSurriculumPlannerReady(ready) {
    if (typeof resolveSurriculumPlannerReady !== 'function') return;
    window.__surriculumPlannerReady = ready === true;
    resolveSurriculumPlannerReady(ready === true);
    resolveSurriculumPlannerReady = null;
}

function isBootPlanAvailable() {
    const runtime = window.surriculumAppRuntime;
    return !runtime || typeof runtime.isSessionPlanAvailable !== 'function'
        || runtime.isSessionPlanAvailable();
}


async function SUrriculum(major_chosen_by_user, bootManifest) {
    if (!isBootPlanAvailable()) return false;
    try { performance.mark('surriculum:planner-hydrate-start'); } catch (_) {}
    const programData = window.surriculumProgramData;
    const majorsByTerm = bootManifest && typeof bootManifest === 'object'
        ? bootManifest : {};
    const defaultMajors = Array.isArray(majorsByTerm.default)
        ? majorsByTerm.default
        : Array.from(programData.DEFAULT_MAJORS);
    const fetchCourseData = (major, termCode) => programData.loadProgramCatalog(major, termCode);
    const fetchMinorCourseData = (minorProgram, termCode) => programData.loadMinorCatalog(minorProgram, termCode);
    function getMajorsForTerm(code) {
        return majorsByTerm[code] || defaultMajors;
    }

    // Build entry term options from the scraped term manifest so admit term
    // selectors only show terms for which data exists. Cap the upper bound
    // dynamically based on the device's current term.
    try {
        const termCodeKeys = Object.keys(majorsByTerm || {}).filter(k => /^\d{6}$/.test(k));
        const termCodes = termCodeKeys.map(k => parseInt(k, 10)).filter(n => !isNaN(n));
        termCodes.sort((a, b) => b - a);
        const minCode = 201901; // fixed minimum (Fall 2019-2020)
        const maxAvailable = termCodes.length ? termCodes[0] : minCode;
        let currentCode = 0;
        try {
            const ctName = (typeof window !== 'undefined' && window.currentTermName) ? window.currentTermName : '';
            currentCode = parseInt(termNameToCode(ctName), 10) || 0;
        } catch (_) {}
        const maxCode = Math.max(maxAvailable, currentCode);
        const entryCodes = termCodes.filter(c => c >= minCode && c <= maxCode);
        const entryNames = entryCodes.map(c => termCodeToName(String(c)));
        if (Array.isArray(entryNames) && entryNames.length) {
            entryTerms = entryNames;
        }
    } catch (_) {}

    // Determine entry terms for main and double majors from localStorage. The
    // terms are stored as display strings (e.g. "Fall 2023-2024"). We convert
    // them to numeric codes to locate the scraped JSON files.
    let entryTermName = planGetItem('entryTerm') || '';
    if (!entryTermName || (Array.isArray(entryTerms) && entryTerms.length && !entryTerms.includes(entryTermName))) {
        entryTermName = entryTerms[0];
    }
    let entryTermDMName = planGetItem('entryTermDM') || entryTermName;
    if (!entryTermDMName || (Array.isArray(entryTerms) && entryTerms.length && !entryTerms.includes(entryTermDMName))) {
        entryTermDMName = entryTermName;
    }

    // Minor admit term options: prefer the scraped minor term manifest if
    // available; otherwise fall back to the general entry terms list.
    let minorEntryTerms = entryTerms;
    try {
        const codes = (typeof window !== 'undefined' && typeof window.loadMinorTermCodesAsync === 'function')
            ? await window.loadMinorTermCodesAsync()
            : ((typeof window !== 'undefined' && typeof window.loadMinorTermCodes === 'function')
                ? window.loadMinorTermCodes()
                : []);
        if (Array.isArray(codes) && codes.length) {
            const names = codes.map(c => termCodeToName(String(c))).filter(Boolean);
            if (names.length) minorEntryTerms = names;
        }
    } catch (_) {}
    if (!isBootPlanAvailable()) return false;

    const pickValidMinorTermName = (candidate, fallback) => {
        const c = String(candidate || '').trim();
        if (!c) return fallback;
        if (Array.isArray(minorEntryTerms) && minorEntryTerms.length && !minorEntryTerms.includes(c)) return fallback;
        return c;
    };
    const minorDefaultTermName = (() => {
        if (Array.isArray(minorEntryTerms) && minorEntryTerms.length) {
            if (minorEntryTerms.includes(entryTermName)) return entryTermName;
            return minorEntryTerms[0];
        }
        return entryTermName;
    })();
    const legacyMinorTermName = planGetItem('entryTermMinor') || '';
    const entryTermMinor1Name = pickValidMinorTermName(planGetItem('entryTermMinor1') || legacyMinorTermName, minorDefaultTermName);
    const entryTermMinor2Name = pickValidMinorTermName(planGetItem('entryTermMinor2') || legacyMinorTermName, minorDefaultTermName);
    const entryTermMinor3Name = pickValidMinorTermName(planGetItem('entryTermMinor3') || legacyMinorTermName, minorDefaultTermName);
    if (!isBootPlanAvailable()) return false;
    try {
        if (!planGetItem('major')) planSetItem('major', major_chosen_by_user);
        if (!planGetItem('entryTerm')) planSetItem('entryTerm', entryTermName);
        if (!planGetItem('entryTermDM')) planSetItem('entryTermDM', entryTermDMName);
        if (!planGetItem('entryTermMinor1')) planSetItem('entryTermMinor1', entryTermMinor1Name);
        if (!planGetItem('entryTermMinor2')) planSetItem('entryTermMinor2', entryTermMinor2Name);
        if (!planGetItem('entryTermMinor3')) planSetItem('entryTermMinor3', entryTermMinor3Name);
        // Keep the legacy key in sync (older exports/backwards compatibility).
        if (!planGetItem('entryTermMinor') || planGetItem('entryTermMinor') !== entryTermMinor1Name) {
            planSetItem('entryTermMinor', entryTermMinor1Name);
        }
    } catch (_) {}
    if (!isBootPlanAvailable()) return false;
    const entryTermCode = termNameToCode(entryTermName);
    const entryTermDMCode = termNameToCode(entryTermDMName);
    const entryTermMinor1Code = termNameToCode(entryTermMinor1Name);
    const entryTermMinor2Code = termNameToCode(entryTermMinor2Name);
    const entryTermMinor3Code = termNameToCode(entryTermMinor3Name);

    // requirements.js starts unavailable. Load the exact main/DM term files
    // only after the stored selections have been validated against the term
    // manifest, so graduation never observes a synthetic or wrong-term record.
    const requirementReadiness = [];
    try {
        if (typeof window.initializeRequirementsAsync === 'function') {
            requirementReadiness.push(window.initializeRequirementsAsync(entryTermCode, entryTermDMCode));
        } else if (typeof window.initializeRequirements === 'function') {
            window.initializeRequirements(entryTermCode, entryTermDMCode);
        }
    } catch (error) {
        console.error('Unable to initialize graduation requirements:', error);
    }
    try {
        const selectedMinorRequirementTerms = [
            [planGetItem('minor1'), entryTermMinor1Code],
            [planGetItem('minor2'), entryTermMinor2Code],
            [planGetItem('minor3'), entryTermMinor3Code],
        ].filter(function(entry) { return !!entry[0]; }).map(function(entry) { return entry[1]; });
        const exactMinorTerms = Array.from(new Set(
            [entryTermMinor1Code].concat(selectedMinorRequirementTerms).filter(Boolean)
        ));
        if (typeof window.initializeMinorRequirementsAsync === 'function') {
            requirementReadiness.push(
                window.initializeMinorRequirementsAsync(exactMinorTerms, entryTermMinor1Code)
            );
        } else if (typeof window.loadMinorRequirementsForTerm === 'function') {
            window.minorRequirements = window.loadMinorRequirementsForTerm(entryTermMinor1Code) || {};
        }
    } catch (error) {
        console.error('Unable to initialize minor requirements:', error);
    }
    await Promise.all(requirementReadiness);
    if (!isBootPlanAvailable()) return false;

    // Storage for the double major's course data.  It will be populated when
    // the user selects a double major via setDoubleMajor().
    let doubleMajorCourseData = [];
    let doubleMajorCatalogCodeSet = new Set();
    let doubleMajorCustomCourseRecords = [];

    return fetchCourseData(major_chosen_by_user, entryTermCode)
    .then(async json => {
        if (!isBootPlanAvailable()) return false;
        if (!window.surriculumCustomCourseModel) {
            throw new Error('scripts/app/custom_course_model.js must load before main.js');
        }
        const customCourseModel = window.surriculumCustomCourseModel.create({
            canonicalize: (code) => (typeof canonicalCourseCode === 'function' ? canonicalCourseCode(code) : code),
            getPlanItem: planGetItem,
            normalizeList: normalizeCustomCourseListForStorage,
        });
        const loadCustomCoursesForMajor = customCourseModel.loadStoredCourses;
        const _customClassificationIdentitySet = customCourseModel.identitySet;
        const _activeCustomCourseRecords = customCourseModel.activeRecords;

        // Fail open: local file reads can report false negatives even when the
        // catalog exists, so keep any data that was successfully retrieved.
        if (!json || json.length === 0) {
            console.warn('No course data available for ' + major_chosen_by_user + ' in ' + entryTermName + '.');
        }
        if (!window.surriculumProgramSelection
            || typeof window.surriculumProgramSelection.createController !== 'function') {
            throw new Error('scripts/app/program-selection-controller.js must load before main.js');
        }
        const programSelectionController = window.surriculumProgramSelection.createController({
            document,
            primaryProgram: major_chosen_by_user,
            entryTerms,
            minorEntryTerms,
            entryTermName,
            entryTermDMName,
            entryTermMinor1Name,
            entryTermMinor2Name,
            entryTermMinor3Name,
            minorDefaultTermName,
            entryTermCode,
            entryTermDMCode,
            getMajorsForTerm,
            planGetItem,
            planSetItem,
            planRemoveItem,
            reloadAfterPlanFlush,
            escapeHtml,
        });
        programSelectionController.initialize();

    const primaryProgramCatalogData = Array.isArray(json) ? json : [];
    const primaryCatalogCodeSet = new Set(primaryProgramCatalogData.map(function(record) {
        return String((record && record.Major) || '') + String((record && record.Code) || '');
    }).map(function(code) {
        return code.toUpperCase().replace(/\s+/g, '');
    }).filter(Boolean));
    const primaryCatalogIdentitySet = _customClassificationIdentitySet(primaryCatalogCodeSet);
    let primaryCustomCourseRecords = [];
    course_data = primaryProgramCatalogData;

    // Restore major-scoped custom courses and append them without modifying
    // the underlying catalog. Missing first-use storage must fail open.
    try {
        const customKey = 'customCourses_' + major_chosen_by_user;
        const stored = planGetItem(customKey);
        if (stored) {
            const parsed = JSON.parse(stored);
            if (Array.isArray(parsed)) {
                primaryCustomCourseRecords = _activeCustomCourseRecords(
                    normalizeCustomCourseListForStorage(major_chosen_by_user, parsed),
                    primaryCatalogCodeSet
                );
                course_data = course_data.concat(primaryCustomCourseRecords);
            }
        }
    } catch (err) {
        console.error('Failed to load custom courses:', err);
    }

    // Preload double major data so that courses unique to the second major
    // are available when reloading semesters from localStorage.
    let savedDMPref = '';
    try {
        savedDMPref = planGetItem('doubleMajor') || '';
    } catch (_) {}
    if (savedDMPref) {
        const dmData = await fetchCourseData(savedDMPref, entryTermDMCode);
        if (!isBootPlanAvailable()) return false;
        if (Array.isArray(dmData)) {
            doubleMajorCourseData = dmData.slice();
        } else {
            doubleMajorCourseData = [];
        }
        doubleMajorCatalogCodeSet = new Set(doubleMajorCourseData.map(function(record) {
            return String((record && record.Major) || '') + String((record && record.Code) || '');
        }).map(function(code) {
            return code.toUpperCase().replace(/\s+/g, '');
        }).filter(Boolean));
        try {
            const keyDM = 'customCourses_' + savedDMPref;
            const storedDM = planGetItem(keyDM);
            if (storedDM) {
                const parsedDM = JSON.parse(storedDM);
                if (Array.isArray(parsedDM)) {
                    doubleMajorCustomCourseRecords = _activeCustomCourseRecords(
                        normalizeCustomCourseListForStorage(savedDMPref, parsedDM),
                        doubleMajorCatalogCodeSet
                    );
                    doubleMajorCourseData = doubleMajorCourseData.concat(doubleMajorCustomCourseRecords);
                }
            }
        } catch (_) {}
    }

    // Preload minor course lists (up to 3). Minor catalogs are stored under
    // courses/minors/<PROGRAM>.jsonl and are merged into the Add Course
    // dropdown similarly to double majors.
    const minorProgramsSet = new Set();
    const minorTermsByCode = {};
    try {
        const m1 = planGetItem('minor1') || '';
        const m2 = planGetItem('minor2') || '';
        const m3 = planGetItem('minor3') || '';
        const t1 = termNameToCode(planGetItem('entryTermMinor1') || entryTermMinor1Name) || entryTermMinor1Code;
        const t2 = termNameToCode(planGetItem('entryTermMinor2') || entryTermMinor2Name) || entryTermMinor2Code;
        const t3 = termNameToCode(planGetItem('entryTermMinor3') || entryTermMinor3Name) || entryTermMinor3Code;
        if (m1) {
            minorProgramsSet.add(m1);
            if (!minorTermsByCode[m1]) minorTermsByCode[m1] = t1;
        }
        if (m2) {
            minorProgramsSet.add(m2);
            if (!minorTermsByCode[m2]) minorTermsByCode[m2] = t2;
        }
        if (m3) {
            minorProgramsSet.add(m3);
            if (!minorTermsByCode[m3]) minorTermsByCode[m3] = t3;
        }
    } catch (_) {}
    const minorPrograms = Array.from(minorProgramsSet);
    const minorCourseDataByCode = {};
    const minorCatalogCodeSetsByCode = {};
    const minorCustomCourseRecordsByCode = {};
    try {
        const loadedMinorCatalogs = await Promise.all(minorPrograms.map(async (mp) => ({
            program: mp,
            data: await fetchMinorCourseData(mp, minorTermsByCode[mp] || entryTermMinor1Code),
        })));
        for (const loadedMinor of loadedMinorCatalogs) {
            const mp = loadedMinor.program;
            const data = loadedMinor.data;
            const catalog = Array.isArray(data) ? data.slice() : [];
            const catalogCodes = new Set(catalog.map(function(record) {
                return String((record && record.Major) || '') + String((record && record.Code) || '');
            }).map(function(code) {
                return code.toUpperCase().replace(/\s+/g, '');
            }).filter(Boolean));
            minorCatalogCodeSetsByCode[mp] = catalogCodes;

            // The same durable program-scoped records used for main and double
            // majors also hold a selected minor's custom classification. Never
            // append an overlay that collides with an official catalog row: the
            // university's classification remains authoritative.
            const storedCustom = loadCustomCoursesForMajor(mp);
            const runtimeCustom = _activeCustomCourseRecords(storedCustom, catalogCodes);
            minorCustomCourseRecordsByCode[mp] = runtimeCustom;
            minorCourseDataByCode[mp] = catalog.concat(runtimeCustom);
        }
    } catch (_) {}
    if (!isBootPlanAvailable()) return false;
    let curriculum = new s_curriculum();
    try {
        const curriculumView = window.SurriculumModules
            && window.SurriculumModules.curriculumView;
        if (curriculumView && typeof curriculumView.createAllocationUpdateHandler === 'function'
            && typeof curriculum.setAllocationUpdateHandler === 'function') {
            curriculum.setAllocationUpdateHandler(curriculumView.createAllocationUpdateHandler({
                updateCourseLists: () => {
                    if (typeof window.updateDatalistForDoubleMajor === 'function') {
                        window.updateDatalistForDoubleMajor();
                    }
                },
                queueRequisiteWarnings: () => {
                    const requisites = window.courseRequisites;
                    if (requisites && typeof requisites.queuePlannerWarningRefresh === 'function') {
                        requisites.queuePlannerWarningRefresh();
                    }
                },
            }));
        }
    } catch (_) {}
    curriculum.major = major_chosen_by_user;
    curriculum.entryTerm = entryTermCode;
    curriculum.entryTermDM = entryTermDMCode;
    // Backward-compatible field: use Minor 1 term as a "default minor term".
    curriculum.entryTermMinor = entryTermMinor1Code;
    if (savedDMPref) {
        curriculum.doubleMajorCourseData = doubleMajorCourseData;
        curriculum.doubleMajor = savedDMPref;
        curriculum.entryTermDM = entryTermDMCode;
    }
    if (minorPrograms.length) {
        curriculum.minors = minorPrograms.slice();
        curriculum.minorCourseDataByCode = { ...minorCourseDataByCode };
        curriculum.minorCatalogCodeSetsByCode = { ...minorCatalogCodeSetsByCode };
        curriculum.minorTermsByCode = { ...minorTermsByCode };
    } else {
        curriculum.minors = [];
        curriculum.minorCourseDataByCode = {};
        curriculum.minorCatalogCodeSetsByCode = {};
        curriculum.minorTermsByCode = {};
    }

    // Compatibility helpers read the live curriculum to validate courses that
    // belong only to a double major.
    if (typeof window !== 'undefined') {
        window.curriculum = curriculum;
    }

    // Saved plans may contain real university courses outside the selected
    // program catalogs. Keep that recovery policy in its own small service so
    // planner boot only coordinates the synchronous restore and detached
    // enrichment phases.
    if (!window.surriculumSavedCourseRestoration
        || typeof window.surriculumSavedCourseRestoration.createSavedCourseRestoration !== 'function') {
        throw new Error('Saved-course restoration module is unavailable.');
    }
    const savedCourseRestoration = window.surriculumSavedCourseRestoration.createSavedCourseRestoration({
        getCourseData: () => course_data,
        getDoubleMajorCourseData: () => doubleMajorCourseData,
        getCurriculum: () => curriculum,
        planGetItem,
        parseCreditValue,
        formatCreditValue,
        evaluateGrade: (grade, gradingBasis) => (
            typeof evaluateGradeForLegacyTotals === 'function'
                ? evaluateGradeForLegacyTotals(grade, gradingBasis)
                : null
        ),
    });
    if (!window.surriculumPlannerPreferences
        || typeof window.surriculumPlannerPreferences.createController !== 'function') {
        throw new Error('Planner preference module is unavailable.');
    }
    const plannerPreferences = window.surriculumPlannerPreferences.createController({
        document,
        preferenceGetItem,
        preferenceSetItem,
    });
    plannerPreferences.initialize();

    // Target dynamically created elements.
    document.addEventListener('click', function(e){
        dynamic_click(e, curriculum, course_data);
        // Summary/graduation overlays: clicking outside the cards/panels should close.
        try {
            if (e.target && typeof e.target.closest === 'function') {
                const summaryOverlay = e.target.closest('.summary_modal_overlay');
                if (summaryOverlay) {
                    // The content wrapper is the Summary surface. In compact
                    // view its cards row owns scrolling, so clicks on its blank
                    // space or scrollbar must not be mistaken for backdrop
                    // clicks. Only the actual dimmed backdrop dismisses it.
                    const insideSummarySurface = e.target.closest('.summary_overlay_content');
                    if (!insideSummarySurface) {
                        try {
                            document.querySelectorAll('.summary_modal_overlay').forEach(function(ov){
                                if (typeof ov._closeSummary === 'function') ov._closeSummary();
                                else ov.remove();
                            });
                        } catch {}
                    }
                    return;
                }
                const gradOverlay = e.target.closest('.graduation_modal_overlay');
                if (gradOverlay) {
                    const insideGrad = e.target.closest('.graduation_modal');
                    if (!insideGrad) {
                        try{document.querySelector('.graduation_modal').remove();} catch{}
                        try{document.querySelector('.graduation_modal_overlay').remove();} catch{}
                    }
                    return;
                }
            }
        } catch (_) {}
        const clickTarget = e.target && e.target.classList ? e.target : null;
        const summaryTrigger = clickTarget && typeof clickTarget.closest === 'function'
            ? clickTarget.closest('.summary') : null;
        const summaryModal = clickTarget && typeof clickTarget.closest === 'function'
            ? clickTarget.closest('.summary_modal') : null;
        if (!summaryModal && !summaryTrigger) {
            try {
                document.querySelectorAll('.summary_modal_overlay').forEach(function(ov){
                    if (typeof ov._closeSummary === 'function') ov._closeSummary();
                    else ov.remove();
                });
            } catch {}
        }
        const graduationTrigger = clickTarget && typeof clickTarget.closest === 'function'
            ? clickTarget.closest('.check') : null;
        const graduationModal = clickTarget && typeof clickTarget.closest === 'function'
            ? clickTarget.closest('.graduation_modal') : null;
        if (!graduationModal && !graduationTrigger) {
            try{document.querySelector('.graduation_modal').remove();} catch{}
            try{document.querySelector('.graduation_modal_overlay').remove();} catch{}
        }
    });
    document.addEventListener('mouseover', function(e){
        mouseover(e);
        if (e.target.classList.contains('btn'))
        {e.target.style.backgroundColor = '';}
        else if(e.target.parentNode.classList && e.target.parentNode.classList.contains('btn'))
        {e.target.parentNode.style.backgroundColor = '';}
        else
        {
            document.querySelectorAll('.btn').forEach( element => {element.style.backgroundColor = ''});
        }
    })
    document.addEventListener('mouseout', function(e){
        mouseout(e);
        if (e.target.classList.contains('btn'))
        {e.target.style.backgroundColor = '';}
    })

    try {
        if (typeof window !== 'undefined' && typeof window.updateCurrentTermHighlights === 'function') {
            window.updateCurrentTermHighlights();
        }
    } catch (_) {}

    let dragged_item = null;
    let dragged_course = null;
    let course_drop_preview = null;
    document.addEventListener('dragstart', function(e){
        if(e.target.classList.contains("container_semester")) {
            dragged_item = e.target;
            dragged_course = null;
            e.target.classList.add('semester-dragging');
            try {
                if (e.dataTransfer) {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', semesterTermLabel(e.target));
                }
            } catch (_) {}
        } else if ((e.target.classList.contains('course')
            || (e.target.closest && e.target.closest('.course_drag')))
            && typeof isDesktopPlannerDrag === 'function' && isDesktopPlannerDrag()) {
            dragged_course = e.target.classList.contains('course')
                ? e.target : e.target.closest('.course');
            dragged_item = null;
            dragged_course.classList.add('course-dragging');
            try {
                if (e.dataTransfer) {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', courseCodeLabel(dragged_course));
                }
            } catch (_) {}
        }
    })
    document.addEventListener('dragend', function(e){
        try {
            if (dragged_course) {
                dragged_course.setAttribute('draggable', 'false');
            }
        } catch (_) {}
        dragged_item = null;
        dragged_course = null;
        course_drop_preview = null;
        try { clearPlannerDragPreview(); } catch (_) {}
    })
    document.addEventListener('dragover', function(e){
        if (dragged_course) {
            if (typeof isDesktopPlannerDrag !== 'function' || !isDesktopPlannerDrag()) return;
            const preview = plannerCourseInsertionPreview(e, dragged_course);
            if (!preview) {
                course_drop_preview = null;
                return;
            }
            course_drop_preview = preview;
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
            return;
        }
        if (!dragged_item) return;
        plannerSemesterInsertionPreview(e, dragged_item);
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    })

    document.addEventListener('drop', function(e){
        if (dragged_course) {
            e.preventDefault();
            try {
                commitPlannerCourseMove(curriculum, course_data, dragged_course, course_drop_preview);
            } finally {
                try { dragged_course.setAttribute('draggable', 'false'); } catch (_) {}
                dragged_course = null;
                course_drop_preview = null;
                clearPlannerDragPreview();
            }
            return;
        }
        drop(e, curriculum, dragged_item, course_data);
        dragged_item = null;
        clearPlannerDragPreview();
    })

    // Touch dragging mirrors desktop reorder behavior and suppresses scrolling.
    document.addEventListener('touchstart', function(e){
        // Only begin dragging if the user taps the dedicated drag handle.
        const handle = e.target && e.target.closest
            ? e.target.closest('.semester_drag')
            : getAncestor(e.target, 'semester_drag');
        if(handle){
            dragged_item = handle.closest
                ? handle.closest('.container_semester')
                : getAncestor(handle, 'container_semester');
        }
    })
    document.addEventListener('touchmove', function(e){
        if(dragged_item){
            // Prevent viewport scrolling while dragging a semester
            e.preventDefault();
        }
    }, {passive:false})
    document.addEventListener('touchend', function(e){
        if(dragged_item){
            const touch = e.changedTouches && e.changedTouches[0];
            if (touch) {
                drop(e, curriculum, dragged_item, course_data, {x: touch.clientX, y: touch.clientY});
            }
            dragged_item = null;
        }
    })
    document.addEventListener('touchcancel', function(){
        dragged_item = null;
    })
    /*
    document.addEventListener("input", function(e){
        if(e.target.classList.contains())
    })*/

    // Non-dynamic controls.
    const addSemester = document.querySelector(".addSemester");
    addSemester.addEventListener('click', function(){
        const board = document.querySelector('.board');
        const newContainer = createSemeter(true, [], curriculum, course_data);
        if (!newContainer) return;
        const ghost = document.querySelector('.add-semester-ghost');
        if (ghost && board) {
            board.insertBefore(newContainer, ghost);
            const style = getComputedStyle(newContainer);
            const width = newContainer.offsetWidth + parseInt(style.marginLeft) + parseInt(style.marginRight);
            board.scrollBy({ left: width, behavior: 'smooth' });
        }
    });

    function ensureGhostSemester() {
        const board = document.querySelector('.board');
        if (!board) return;
        let ghost = board.querySelector('.add-semester-ghost');
        if (!ghost) {
            ghost = document.createElement('div');
            ghost.classList.add('add-semester-ghost');
            ghost.textContent = '+ New Semester';
            ghost.addEventListener('click', function() {
                const newContainer = createSemeter(true, [], curriculum, course_data);
                if (!newContainer) return;
                const style = getComputedStyle(newContainer);
                const width = newContainer.offsetWidth + parseInt(style.marginLeft) + parseInt(style.marginRight);
                board.insertBefore(newContainer, ghost);
                board.scrollBy({ left: width, behavior: 'smooth' });
            });
            board.appendChild(ghost);
        }
    }

    const appShellController = window.surriculumAppShell.createController({ window, document });
    appShellController.bindSidebar();


    const auto_add = document.querySelector('.autoAdd');
    auto_add.addEventListener('click', async function(){
        // Check if there are existing semesters
        const semesters = document.querySelectorAll('.semester');
        if (semesters.length > 0) {
            await uiAlert(
                'Cannot add first year courses',
                '<p><strong>Add First Year Courses</strong> only works when no semesters are present.</p><p>Create a new plan or delete existing semesters and try again.</p>'
            );
            return;
        }

        // Determine the user's entry term so that the automatically added
        // semesters start from that term rather than the earliest term in
        // the list (Fall 2019-2020).
        const entryTerm = planGetItem('entryTerm') || entryTerms[0];
        const entryCode = termNameToCode(entryTerm);

        // Helper to compute the next chronological term code
        function nextTermCode(code) {
            const term = code.slice(4);
            const year = parseInt(code.slice(0, 4), 10);
            if (term === '01') return String(year) + '02'; // Fall -> Spring
            // Summer -> Fall of next academic year
            return String(year + 1) + '01';
        }

        const nextCode = nextTermCode(entryCode);
        const nextTerm = termCodeToName(nextCode);

        // Automatically insert the typical first year courses into two semesters.
        let fs_courses = ["MATH101","NS101","SPS101","IF100","TLL101","HIST191","CIP101N"];
        let ss_courses = ["MATH102","NS102","SPS102","AL102","TLL102","HIST192","PROJ201"];

        // Insert the next term first so that the entry term ends up at the top
        // of the board. Pass explicit term names to createSemeter so that the
        // semesters use the correct dates.
        createSemeter(false, ss_courses, curriculum, course_data, [], nextTerm);
        createSemeter(false, fs_courses, curriculum, course_data, [], entryTerm);
    })

    // Older markup wrapped the text inside a <p> tag. Guard against that
    // structure to avoid errors when clicking the button in the new UI.
    const checkText = document.querySelector('.check>p');
    if (checkText) {
        checkText.addEventListener('click', function(){
            document.querySelector('.check').click();
        });
    }
    const check_graduation = document.querySelector('.check');
    check_graduation.addEventListener('click', function(){
        displayGraduationResults(curriculum);
    })

    const summary = document.querySelector('.summary');
    summary.addEventListener('click', function(){
        displaySummary(curriculum, major_chosen_by_user);
    })

    // The custom-course modal persists major-scoped definitions and refreshes
    // course datalists immediately; only one instance may be open at a time.

        if (!window.surriculumCustomCourseUi) {
            throw new Error('scripts/app/custom_course_ui.js must load before main.js');
        }
        let programContext = null;
        const customCourseUi = window.surriculumCustomCourseUi.createController({
            model: customCourseModel,
            runtimeFactory: window.surriculumCustomCourseRuntime,
            normalizeCourse: normalizeCustomCourseForStorage,
            normalizeList: normalizeCustomCourseListForStorage,
            document,
            parseCreditValue: typeof parseCreditValue === 'function' ? parseCreditValue : null,
            formatCreditValue: typeof formatCreditValue === 'function' ? formatCreditValue : null,
            populateCourseDataList,
            updateDatalistForDoubleMajor: () => {
                if (programContext) programContext.updateDatalistForDoubleMajor();
            },
            planGetItem,
            planSetItem,
            planRemoveItem,
            requestPlanSave,
            flushPlanSaves,
            uiAlert,
            uiConfirm,
            escapeHtml,
            activateAccessibleDialog,
            location,
            state: {
                getCurriculum: () => curriculum,
                getCourseData: () => course_data,
                getPrimaryProgram: () => major_chosen_by_user,
                getPrimaryCatalogCodes: () => primaryCatalogCodeSet,
                getPrimaryCatalogIdentities: () => primaryCatalogIdentitySet,
                getPrimaryCatalogData: () => primaryProgramCatalogData,
                getPrimaryCustomRecords: () => primaryCustomCourseRecords,
                setPrimaryCustomRecords: (records) => { primaryCustomCourseRecords = records; },
                getDoubleMajorCourseData: () => doubleMajorCourseData,
                getDoubleMajorCatalogCodes: () => doubleMajorCatalogCodeSet,
                getDoubleMajorCustomRecords: () => doubleMajorCustomCourseRecords,
                setDoubleMajorCustomRecords: (records) => { doubleMajorCustomCourseRecords = records; },
                getMinorCourseData: () => minorCourseDataByCode,
                getMinorCatalogCodeSets: () => minorCatalogCodeSetsByCode,
                getMinorCustomRecords: () => minorCustomCourseRecordsByCode,
            },
        });
        if (!window.surriculumProgramContext) {
            throw new Error('scripts/app/program_context.js must load before main.js');
        }
        programContext = window.surriculumProgramContext.createController({
            model: customCourseModel,
            customCourseUi,
            document,
            loadProgramCatalog: fetchCourseData,
            normalizeList: normalizeCustomCourseListForStorage,
            planGetItem,
            planSetItem,
            planRemoveItem,
            requestPlanSave,
            flushPlanSaves,
            uiAlert,
            uiConfirm,
            escapeHtml,
            activateAccessibleDialog,
            populateCourseDataList,
            termCodeToName,
            location,
            academicImportFactory: window.surriculumAcademicImport,
            appRuntime: window.surriculumAppRuntime,
            academicRecordsParser: window.academicRecordsParser,
            pdfTranscriptReader: window.pdfTranscriptReader,
            loadCoursePageInfoIndex: window.loadCoursePageInfoIndex,
            ensureRequirementsReady: () => Promise.all([
                typeof window.whenRequirementsReady === 'function'
                    ? window.whenRequirementsReady() : Promise.resolve(),
                typeof window.whenMinorRequirementsReady === 'function'
                    ? window.whenMinorRequirementsReady() : Promise.resolve(),
            ]),
            state: {
                getCurriculum: () => curriculum,
                getCourseData: () => course_data,
                getPrimaryProgram: () => major_chosen_by_user,
                getPrimaryCatalogCodes: () => primaryCatalogCodeSet,
                getPrimaryCatalogIdentities: () => primaryCatalogIdentitySet,
                getPrimaryCustomRecords: () => primaryCustomCourseRecords,
                setPrimaryCustomRecords: (records) => { primaryCustomCourseRecords = records; },
                getDoubleMajorCourseData: () => doubleMajorCourseData,
                setDoubleMajorCourseData: (records) => { doubleMajorCourseData = records; },
                getDoubleMajorCatalogCodes: () => doubleMajorCatalogCodeSet,
                setDoubleMajorCatalogCodes: (codes) => { doubleMajorCatalogCodeSet = codes; },
                getDoubleMajorCustomRecords: () => doubleMajorCustomCourseRecords,
                setDoubleMajorCustomRecords: (records) => { doubleMajorCustomCourseRecords = records; },
                getDoubleMajorTermCode: () => entryTermDMCode,
            },
        });
        customCourseUi.bind({
            onDeleteAll: () => programContext.deleteAllCustomCourses(),
        });

    // Bind reset local data button click
    const resetLocalBtn = document.querySelector('.resetLocal');
    if (resetLocalBtn) {
        resetLocalBtn.addEventListener('click', async function() {
            const ok = await uiConfirm(
                'Reset local data?',
                '<p>Are you sure you want to reset <strong>all SUrriculum data</strong> stored in this browser?</p>' +
                '<p>This will remove saved semesters, custom courses, grades, and your saved plans.</p>',
                { confirmText: 'Reset', danger: true }
            );
            if (ok) {
                let resetComplete = false;
                try {
                    clearInterval(saveInterval);
                    const storage = (typeof window !== 'undefined') ? window.planStorage : null;
                    if (!storage || typeof storage.clearAllAppData !== 'function') {
                        throw new Error('SUrriculum storage management is unavailable.');
                    }
                    storage.clearAllAppData();
                    resetComplete = true;
                } catch (ex) {
                    console.error('Failed to reset SUrriculum data:', ex);
                    await uiAlert(
                        'Reset failed',
                        `<p>${escapeHtml(ex && ex.message ? ex.message : 'Could not reset SUrriculum data.')}</p>`
                    );
                }
                if (resetComplete) location.reload();
            }
        });
    }

    // The old 'Add Double Major' button functionality has been replaced
    // by a persistent dropdown created near the major display.  Any
    // unused event handlers referencing '.addDoubleMajor' are removed.

    // Restore catalog-independent definitions synchronously before reloading.
    // The optional cumulative-index enrichment starts only after the semester
    // cards have been rebuilt below.
    const restoredGlobalDefinitions = savedCourseRestoration.restore();

    //Reload items from local storage:
    reload(curriculum, course_data);
    // Enrichment is deliberately detached from startup. Saved metadata (or a
    // marker fallback for legacy plans) has already made every course renderable.
    void savedCourseRestoration.enrich(restoredGlobalDefinitions);
    // After reloading existing semesters, recalculate effective categories
    // so that the allocation respects chronological order. Guard against
    // missing recalc function.
    try {
        if (typeof curriculum.recalcEffectiveTypes === 'function') {
            curriculum.recalcEffectiveTypes(course_data);
        }
    } catch(err) {
        // ignore
    }
    // Ensure the ghost semester container is appended after reloading existing semesters
    ensureGhostSemester();
    // Capture every parallel array before the first write, then save the whole
    // planner snapshot through one hook. This keeps debounce, lifecycle, plan
    // switching, and the 2-second fallback on the same persistence path.
    const savePlanSnapshot = function() {
        let snapshot;
        try {
            snapshot = {
                curriculum: serializator(curriculum),
                grades: grades_serializator(curriculum),
                gradingBases: grading_bases_serializator(curriculum),
                dates: dates_serializator(curriculum),
                termCodes: term_codes_serializator(curriculum),
            };
        } catch (err) {
            try { console.error('Failed to serialize planner state:', err); } catch (_) {}
            return false;
        }
        try {
            const storage = (typeof window !== 'undefined') ? window.planStorage : null;
            if (storage && typeof storage.setSnapshot === 'function') {
                return storage.setSnapshot(snapshot, _planIdForSession || undefined) !== false;
            }
        } catch (err) {
            try { console.error('Failed to save planner snapshot:', err); } catch (_) {}
            return false;
        }
        return [
            planSetItem('curriculum', snapshot.curriculum),
            planSetItem('grades', snapshot.grades),
            planSetItem('gradingBases', snapshot.gradingBases),
            planSetItem('dates', snapshot.dates),
            planSetItem('termCodes', snapshot.termCodes),
        ].every(Boolean);
    };

    try {
        if (typeof window !== 'undefined' && window.planStorage && typeof window.planStorage.registerSaveHook === 'function') {
            window.planStorage.registerSaveHook(savePlanSnapshot, { planId: _planIdForSession });
        }
    } catch (_) {}

    // Retain the existing polling save as a conservative fallback for any
    // mutation path that has not yet requested a debounced save explicitly.
    saveInterval = setInterval(function() {
        const storage = (typeof window !== 'undefined') ? window.planStorage : null;
        if (storage && typeof storage.flushSaves === 'function') storage.flushSaves();
        else savePlanSnapshot();
    }, 2000);

    //createSemeter(false, ["MATH101","MATH102","MATH201","MATH203","IF100","TLL101"], curriculum, course_data)
    //createSemeter(false, ["NS101","SPS101","SPS102","AL102","TLL102","HIST192","PROJ201", "NS102", "HIST191", "CIP101N", "CS210", "MATH306", "CS201", "CS204", "MATH204"], curriculum, course_data)

    // No debug alerts in production; remove for clean UI

        programContext.bindAcademicImport();
        // Publish planner readiness before optional double-major review pauses.
        settleSurriculumPlannerReady(true);

        appShellController.bindHeaderAndImportMenus();



    // Reactivate a saved double major so its categories are recalculated.
    try {
        const savedDMInit = planGetItem('doubleMajor') || '';
        const dmSelect = document.querySelector('.doubleMajor');
        if (dmSelect && dmSelect.tagName === 'SELECT') {
            dmSelect.value = savedDMInit;
        }
        if (savedDMInit) {
            // The program-context controller expects uppercase codes.
            await programContext.setDoubleMajor(savedDMInit.toUpperCase());
        }
    } catch (e) {
        // ignore
    }
    if (!isBootPlanAvailable()) return false;

    // Startup guidance waits for the visible plan and its program context to
    // finish loading. Consumers use a sticky flag as well as the event so a
    // listener registered late in this same script cannot miss readiness.
    try {
        window.__surriculumReady = true;
        try { performance.mark('surriculum:planner-ready'); } catch (_) {}
        document.dispatchEvent(new CustomEvent('surriculum:ready'));
    } catch (_) {}
    return true;

    })
    .catch(error => {
        console.error(error);
        return false;
    });
}

if (!window.surriculumOnboarding || !window.surriculumMobileNotice) {
    throw new Error('Onboarding and mobile-notice modules must load before main.js');
}
window.surriculumOnboarding.init();
window.surriculumMobileNotice.init();

// Load the term manifest first, then await exact catalogs and requirements.
// The program-data module owns the local file:// compatibility fallback.
async function startSurriculum() {
    const bootManifest = await window.surriculumProgramData.loadTermManifest();
    if (!isBootPlanAvailable()) return false;
    const majorExisting = planGetItem('major');
    return await SUrriculum(majorExisting || initial_major_chosen, bootManifest);
}

const surriculumReadyPromise = startSurriculum();
window.surriculumReadyPromise = surriculumReadyPromise;
window.whenSurriculumReady = () => surriculumReadyPromise;
surriculumReadyPromise.then(
    (ready) => {
        if (ready !== true) settleSurriculumPlannerReady(false);
    },
    (error) => {
        settleSurriculumPlannerReady(false);
        console.error(error);
    }
);
