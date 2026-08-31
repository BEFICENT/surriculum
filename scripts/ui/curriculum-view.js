// Workload accounting and DOM rendering for curriculum allocation results.
(function installCurriculumView(root) {
    'use strict';

    const PRIMARY_ALLOCATED_CREDIT_TYPES = new Set([
        'required', 'core', 'area', 'free', 'university',
    ]);

    function currentWorkloadCourseDefinition(curriculum, course) {
        const normalizeCode = (value) => String(value || '').trim().toUpperCase()
            .replace(/\s+/g, '');
        const code = normalizeCode(course && course.code);
        if (!code) return null;

        // The active primary list already contains the authoritative catalog plus
        // non-colliding custom definitions. Search it first so a secondary-program
        // record cannot change the primary occurrence metadata.
        const primaryData = curriculum && Array.isArray(curriculum.primaryCourseData)
            ? curriculum.primaryCourseData : [];
        let globalFallback = null;
        for (let i = 0; i < primaryData.length; i++) {
            const record = primaryData[i];
            const recordCode = normalizeCode(String((record && record.Major) || '')
                + String((record && record.Code) || ''));
            if (recordCode !== code) continue;
            if (record && record.__globalCourseDefinition) {
                if (!globalFallback) globalFallback = record;
                continue;
            }
            return record;
        }

        // The shared resolver applies the same non-global precedence to active
        // double-major and minor catalogs, then falls back to remembered external
        // metadata. This supplies credits for courses absent from the main catalog
        // without making them eligible for the main degree.
        const getInfoFn = (typeof getInfo === 'function') ? getInfo
            : ((typeof window !== 'undefined' && typeof window.getInfo === 'function')
                ? window.getInfo : null);
        if (getInfoFn) {
            try {
                const resolved = getInfoFn(code, primaryData);
                if (resolved) return resolved;
            } catch (_) {}
        }
        return globalFallback;
    }

    // Keep the semester workload separate from the primary degree total. Workload
    // includes every positive-SU course card (failed, projected, N/A, or allocated),
    // while the split reflects the completed primary-program allocation pass.
    function recomputeSemesterPrimaryCreditSplit(curriculum) {
        const semesters = curriculum && Array.isArray(curriculum.semesters)
            ? curriculum.semesters : [];
        const creditNumber = (value) => {
            let credit = 0;
            try {
                credit = (typeof parseCreditValue === 'function')
                    ? parseCreditValue(value) : Number.parseFloat(value || 0);
            } catch (_) {
                credit = Number.parseFloat(value || 0);
            }
            return Number.isFinite(credit) && credit > 0 ? credit : 0;
        };
        const tidy = (value) => Math.round((Number(value) || 0) * 1000) / 1000;
        const primaryProgramCode = String((curriculum && curriculum.major) || '')
            .trim().toUpperCase();

        semesters.forEach((semester) => {
            let load = 0;
            let allocated = 0;
            let unallocated = 0;
            const courses = semester && Array.isArray(semester.courses)
                ? semester.courses : [];
            courses.forEach((course) => {
                const definition = currentWorkloadCourseDefinition(curriculum, course);
                let definitionCredit = null;
                if (definition && Object.prototype.hasOwnProperty.call(definition, 'SU_credit')) {
                    const raw = String(definition.SU_credit == null ? '' : definition.SU_credit)
                        .trim().replace(',', '.');
                    const parsed = raw ? Number.parseFloat(raw) : NaN;
                    if (Number.isFinite(parsed) && parsed >= 0) definitionCredit = parsed;
                }
                // Refresh the occurrence even when allocation exited early (failed,
                // explicit N/A, alternative exclusion, or language-level review).
                // A real zero is meaningful and must replace stale positive credit.
                if (definitionCredit !== null && course) course.SU_credit = definitionCredit;
                const credit = creditNumber(definitionCredit !== null
                    ? definitionCredit : (course && course.SU_credit));
                if (!(credit > 0)) return;
                load += credit;
                const effectiveType = String((course && course.effective_type) || '')
                    .trim().toLowerCase();
                if (PRIMARY_ALLOCATED_CREDIT_TYPES.has(effectiveType)) allocated += credit;
                else unallocated += credit;
            });
            semester.totalLoadCredit = tidy(load);
            semester.primaryAllocatedCredit = tidy(allocated);
            semester.primaryUnallocatedCredit = tidy(unallocated);
            semester.primaryProgramCode = primaryProgramCode;
        });
    }

    // Render the allocation result to the DOM: each course's `.course_type` label
    // (single, or dual MAIN/DM parts for a double major) and each semester's
    // workload/category-split indicator. Reads ONLY the model the allocation sets
    // (effective types, workload split, and categories), so it runs as a separate
    // pass AFTER allocation rather than being interleaved into it — the domain/UI
    // split for the engine. No-ops
    // safely outside a browser. Pinned by allocation-render.spec.js.
    function renderAllocationLabels(curriculum) {
        if (typeof document === 'undefined') return;
        const isDouble = !!curriculum.doubleMajor;
        const label = (v) => (String(v || '').toLowerCase() === 'none' ? 'N/A' : String(v || '').toUpperCase());
        const displayLabel = (value, reason) => {
            if (reason === BASIC_LANGUAGE_EXCLUSION_REASON) return 'N/A (BASIC-LANGUAGE LIMIT)';
            if (reason === LANGUAGE_LEVEL_REVIEW_REASON) return 'N/A (REVIEW LANGUAGE LEVEL)';
            return label(value);
        };
        const movedDown = (base, eff) => {
            const b = String(base || '').toLowerCase();
            const e = String(eff || '').toLowerCase();
            return !!(b && e && b !== e && e !== 'none');
        };
        const sems = curriculum.semesters || [];
        for (let i = 0; i < sems.length; i++) {
            const sem = sems[i];
            const courses = sem.courses || [];
            for (let j = 0; j < courses.length; j++) {
                const course = courses[j];
                if (!course || !course.id) continue;
                let typeSpan = null;
                try {
                    const elem = document.getElementById(course.id);
                    typeSpan = elem ? elem.querySelector('.course_type') : null;
                } catch (_) {}
                if (!typeSpan) continue;
                typeSpan.title = '';
                if (isDouble && course.effective_type_dm) {
                    const mainReason = course.degreeExclusionReason || '';
                    const dmReason = course.degreeExclusionReasonDM || '';
                    const mt = displayLabel(course.effective_type, mainReason);
                    const dt = displayLabel(course.effective_type_dm, dmReason);
                    const mainCls = movedDown(course.category, course.effective_type) ? 'is-overflow-type' : '';
                    const dmCls = movedDown(course.categoryDM, course.effective_type_dm) ? 'is-overflow-type' : '';
                    try {
                        typeSpan.replaceChildren();
                        const mainPart = document.createElement('span');
                        mainPart.className = 'course_type_part ct-main' + (mainCls ? ' ' + mainCls : '');
                        mainPart.textContent = mt;
                        if (mainReason) mainPart.title = mainReason;
                        const separator = document.createElement('span');
                        separator.className = 'ct-sep';
                        separator.textContent = ' / ';
                        const dmPart = document.createElement('span');
                        dmPart.className = 'course_type_part ct-dm' + (dmCls ? ' ' + dmCls : '');
                        dmPart.textContent = dt;
                        if (dmReason) dmPart.title = dmReason;
                        typeSpan.appendChild(mainPart);
                        typeSpan.appendChild(separator);
                        typeSpan.appendChild(dmPart);
                    } catch (_) {
                        typeSpan.textContent = mt + ' / ' + dt;
                    }
                    // Dual labels colour per part, so clear any whole-span class.
                    try { typeSpan.classList.remove('is-overflow-type'); } catch (_) {}
                } else {
                    // Single label. In double-major mode overflow is coloured per
                    // part, so the whole-span class is cleared (matches the old DM
                    // render); in single-major mode it toggles with the main overflow.
                    const reason = course.degreeExclusionReason || '';
                    typeSpan.textContent = displayLabel(course.effective_type, reason);
                    typeSpan.title = reason;
                    try {
                        if (isDouble) typeSpan.classList.remove('is-overflow-type');
                        else typeSpan.classList.toggle('is-overflow-type', movedDown(course.category, course.effective_type));
                    } catch (_) {}
                }
            }
            // Per-semester workload/category-split indicator.
            try {
                const semElem = document.getElementById(sem.id);
                let containerElem = semElem && semElem.closest ? semElem.closest('.container_semester') : null;
                if (!containerElem && semElem) {
                    let parent = semElem.parentNode;
                    while (parent && !(parent.classList && parent.classList.contains('container_semester'))) {
                        parent = parent.parentNode;
                    }
                    containerElem = parent;
                }
                const span = containerElem && containerElem.querySelector('.total_credit_text span');
                if (span) {
                    if (typeof updateSemesterCreditIndicator === 'function') {
                        updateSemesterCreditIndicator(span, sem);
                    } else {
                        const fallbackLoad = sem.totalLoadCredit !== null
                            && sem.totalLoadCredit !== undefined
                            ? sem.totalLoadCredit : sem.totalCredit;
                        span.textContent = fallbackLoad + ' SU';
                    }
                }
            } catch (_) {}
        }
    }

    // Compose the synchronous visual follow-up for a completed allocation.
    // The domain constructor receives only the returned callback; it never
    // reaches into the DOM, picker controller, or requisite controller itself.
    function createAllocationUpdateHandler(options) {
        const opts = options && typeof options === 'object' ? options : {};
        const updateCourseLists = typeof opts.updateCourseLists === 'function'
            ? opts.updateCourseLists : null;
        const queueRequisiteWarnings = typeof opts.queueRequisiteWarnings === 'function'
            ? opts.queueRequisiteWarnings : null;
        return function handleAllocationUpdated(curriculum) {
            renderAllocationLabels(curriculum);
            if (updateCourseLists) {
                try { updateCourseLists(curriculum); } catch (_) {}
            }
            if (queueRequisiteWarnings) {
                try { queueRequisiteWarnings(curriculum); } catch (_) {}
            }
        };
    }

    const namespace = root.SurriculumModules || (root.SurriculumModules = {});
    const api = Object.freeze({
        currentWorkloadCourseDefinition,
        recomputeSemesterPrimaryCreditSplit,
        renderAllocationLabels,
        createAllocationUpdateHandler,
    });
    namespace.curriculumView = api;
    Object.assign(root, api);
})(typeof window !== 'undefined' ? window : globalThis);
