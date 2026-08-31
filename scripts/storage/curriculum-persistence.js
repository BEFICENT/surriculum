// Curriculum serialization, hydration, and incremental semester totals.
(function installCurriculumPersistence(root) {
    'use strict';

    function getPlanStorageSessionId(storage) {
        try {
            return storage && typeof storage.getSessionPlanId === 'function'
                ? storage.getSessionPlanId() || null : null;
        } catch (_) {
            return null;
        }
    }

    // Keep persistence independent from the later-loaded ES-module bridge in
    // scripts/domain/credits.js. This intentionally mirrors parseCreditValue's
    // finite-number and comma-decimal contract without reaching into another
    // runtime layer.
    function parseStoredCreditValue(value) {
        try {
            const raw = String(value ?? '').trim();
            if (!raw) return 0;
            const parsed = parseFloat(raw.replace(',', '.'));
            return Number.isFinite(parsed) ? parsed : 0;
        } catch (_) {
            return 0;
        }
    }

    // Adjust semester totals by adding or subtracting the specified course's
    // credit, science/engineering values and category totals. `multiplier`
    // should be +1 to add credits or -1 to remove them.
    function adjustSemesterTotals(semesterObj, courseInfo, multiplier) {
        if (!semesterObj || !courseInfo) return;
        multiplier = multiplier || 1;
        const credit = parseStoredCreditValue(courseInfo['SU_credit'] || '0');
        const bs = parseFloat(courseInfo['Basic_Science'] || '0');
        const eng = parseFloat(courseInfo['Engineering'] || '0');
        const ects = parseFloat(courseInfo['ECTS'] || '0');
        semesterObj.totalCredit += multiplier * credit;
        semesterObj.totalScience += multiplier * bs;
        semesterObj.totalEngineering += multiplier * eng;
        semesterObj.totalECTS += multiplier * ects;
        const el = (courseInfo['EL_Type'] || '').toLowerCase();
        if (el === 'free') semesterObj.totalFree += multiplier * credit;
        else if (el === 'area') semesterObj.totalArea += multiplier * credit;
        else if (el === 'core') semesterObj.totalCore += multiplier * credit;
        else if (el === 'university') semesterObj.totalUniversity += multiplier * credit;
        else if (el === 'required') semesterObj.totalRequired += multiplier * credit;
    }

    function serializator(curriculum)
    {
        const semesters = curriculum && Array.isArray(curriculum.semesters) ? curriculum.semesters : [];
        return JSON.stringify(semesters.map((semester) =>
            (semester && Array.isArray(semester.courses) ? semester.courses : [])
                .map((course) => String((course && course.code) || ''))));
    }

    function grades_serializator(curriculum)
    {
        // The course model is authoritative. In particular, opening the grade
        // picker temporarily replaces the DOM text with dropdown markup; serializing
        // that transient UI used to turn a saved F into a blank grade on reload.
        if (curriculum && Array.isArray(curriculum.semesters)) {
            return JSON.stringify(curriculum.semesters.map((semester) =>
                (semester.courses || []).map((course) => String(course.grade || ''))));
        }

        // Legacy fallback for callers that do not yet have a curriculum instance.
        let containers = document.querySelectorAll('.container_semester');


        let result = '[';
        containers.forEach((container)=>{
            result = result + '[';
            container.querySelectorAll(".grade").forEach((grade)=>{
                if(grade.innerHTML.length <= 2){result = result + '"' + grade.innerHTML + '"';}
                else {result = result + '""'}
                result = result + ','
            })
            if(result[result.length-1] == ',') result = result.slice(0,-1)
            result = result + ']';
            result = result + ",";
        })
        if(result[result.length-1] == ',') result = result.slice(0,-1)
        result = result + ']';
        return result;
    }

    function grading_bases_serializator(curriculum)
    {
        const semesters = curriculum && Array.isArray(curriculum.semesters) ? curriculum.semesters : [];
        return JSON.stringify(semesters.map((semester) =>
            (semester && Array.isArray(semester.courses) ? semester.courses : [])
                .map((course) => {
                    const basis = String((course && course.gradingBasis) || '').trim().toLowerCase();
                    return basis === 'letter' || basis === 'satisfactory' ? basis : 'unknown';
                })));
    }

    function dates_serializator(curriculum)
    {
        // The model is authoritative. While a term is being edited, the UI
        // temporarily replaces its <p> with a <select>; reading that transient DOM
        // used to persist "..." if the tab was backgrounded at that moment.
        const semesters = curriculum && Array.isArray(curriculum.semesters)
            ? curriculum.semesters : null;
        const dates = semesters
            ? semesters.map((semester) => String((semester && semester.termName) || ''))
            : Array.from(document.querySelectorAll('.date')).map((date) => {
                const label = date.querySelector('p');
                return label ? String(label.textContent || '') : '';
            });
        return JSON.stringify(dates);
    }

    function term_codes_serializator(curriculum)
    {
        const semesters = curriculum && Array.isArray(curriculum.semesters)
            ? curriculum.semesters : [];
        return JSON.stringify(semesters.map((semester) => {
            // Preserve a valid stored code even when it conflicts with the label.
            // Keeping both fields is what lets semesterTermCode fail closed after a
            // reload instead of silently choosing one side of corrupted metadata.
            const stored = String((semester && semester.termCode) || '').trim();
            if (/^\d{4}(01|02|03)$/.test(stored)) return stored;
            return semesterTermCode(semester && (semester.termName || semester.date || semester.term));
        }));
    }

    function reload(curriculum, course_data)
    {
        let data, grades, gradingBases, dates, termCodes;
        let restoredAnySemester = false;
        const ps = (typeof window !== 'undefined') ? window.planStorage : null;
        const planId = getPlanStorageSessionId(ps);
        const get = (k) => {
            if (ps && typeof ps.getItem === 'function') {
                if (!planId) return null;
                try { return ps.getItem(k, planId); } catch (_) { return null; }
            }
            try { return localStorage.getItem(k); } catch (_) {}
            return null;
        };
        try{data = JSON.parse(get("curriculum"));} catch{}
        try{grades = JSON.parse(get("grades"));}   catch{}
        try{gradingBases = JSON.parse(get("gradingBases"));} catch{}
        try{dates = JSON.parse(get("dates"))}      catch{}
        try{termCodes = JSON.parse(get("termCodes"))} catch{}
        if(data)
        {
            for(let i = 0; i < data.length; i++)
            {
                const persistedTermCode = Array.isArray(termCodes) && typeof termCodes[i] === 'string'
                    && /^\d{4}(01|02|03)$/.test(String(termCodes[i]).trim())
                    ? String(termCodes[i]).trim() : '';
                const persistedTermName = dates && typeof dates[i] === 'string'
                    ? dates[i]
                    : (persistedTermCode ? termCodeToName(persistedTermCode) : '');
                // Each persisted field is optional in imported/legacy plans. Keep
                // fields that are present instead of dropping grades merely because
                // the plan did not include custom semester labels.
                const created = createSemeter(
                    true,
                    data[i],
                    curriculum,
                    course_data,
                    grades && Array.isArray(grades[i]) ? grades[i] : [],
                    persistedTermName,
                    gradingBases && Array.isArray(gradingBases[i]) ? gradingBases[i] : [],
                    { deferPlannerRefresh: true },
                );
                if (created) restoredAnySemester = true;

                // Dates remain the human-readable label. The optional parallel
                // termCodes array is the stable identity boundary introduced after
                // legacy plans had already been saved, so its absence is expected.
                if (created && Array.isArray(termCodes) && typeof termCodes[i] === 'string') {
                    try {
                        const semesterElement = created.querySelector('.semester');
                        const semester = semesterElement && curriculum
                            && typeof curriculum.getSemester === 'function'
                            ? curriculum.getSemester(semesterElement.id) : null;
                        if (semester) {
                            semester.termCode = persistedTermCode;
                        }
                    } catch (_) {}
                }

            }
        }

        // A returning plan can contain many semesters. Building each card used
        // to recalculate the whole curriculum, rescan semester accessibility,
        // and refresh current-term decoration once per row. The persisted plan
        // is one atomic snapshot, so perform those whole-plan passes once after
        // every card and canonical term code has been restored.
        try {
            if (curriculum && typeof curriculum.recalcEffectiveTypes === 'function') {
                curriculum.recalcEffectiveTypes(course_data);
            }
        } catch (_) {}
        if (restoredAnySemester) {
            try {
                if (typeof root.updateCurrentTermHighlights === 'function') {
                    root.updateCurrentTermHighlights();
                }
            } catch (_) {}
            try {
                if (typeof root.refreshSemesterAccessibility === 'function') {
                    root.refreshSemesterAccessibility();
                }
            } catch (_) {}
        }
    }

    const namespace = root.SurriculumModules || (root.SurriculumModules = {});
    namespace.curriculumPersistence = Object.freeze({
        adjustSemesterTotals,
        serializator,
        gradesSerializator: grades_serializator,
        gradingBasesSerializator: grading_bases_serializator,
        datesSerializator: dates_serializator,
        termCodesSerializator: term_codes_serializator,
        reload,
    });

    root.adjustSemesterTotals = adjustSemesterTotals;
    root.serializator = serializator;
    root.grades_serializator = grades_serializator;
    root.grading_bases_serializator = grading_bases_serializator;
    root.dates_serializator = dates_serializator;
    root.term_codes_serializator = term_codes_serializator;
    root.reload = reload;
})(typeof window !== 'undefined' ? window : globalThis);
