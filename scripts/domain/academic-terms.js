// Academic-term identity, ordering, and semester-load policy.
//
// This remains a classic-script compatible module while the application still
// uses deferred, non-module consumers. New code should use
// `window.SurriculumModules.academicTerms`; the individual window properties below are
// the temporary compatibility bridge for the existing app.
(function installAcademicTerms(root) {
    'use strict';

    function getCurrentTermNameFromDate(d) {
        try {
            const y = d.getFullYear();
            const m = d.getMonth();
            const day = d.getDate();
            if (m === 0 && day < 20) {
                const start = y - 1;
                return `Fall ${start}-${start + 1}`;
            }
            if (m < 5 || (m === 5 && day < 20)) {
                const start = y - 1;
                return `Spring ${start}-${start + 1}`;
            }
            if (m < 7 || (m === 7 && day < 20)) {
                const start = y - 1;
                return `Summer ${start}-${start + 1}`;
            }
            const start = y;
            return `Fall ${start}-${start + 1}`;
        } catch (_) {
            return '';
        }
    }

    function termNameToCode(name) {
        const match = name && name.match(/(Fall|Spring|Summer)\s+(\d{4})-(\d{4})/);
        if (!match) return '';
        const suffix = { Fall: '01', Spring: '02', Summer: '03' }[match[1]] || '01';
        return match[2] + suffix;
    }

    function termCodeToName(code) {
        const value = String(code || '');
        if (value.length !== 6) return '';
        const year = value.slice(0, 4);
        const term = { '01': 'Fall', '02': 'Spring', '03': 'Summer' }[value.slice(4)] || '';
        if (!term) return '';
        return `${term} ${year}-${Number(year) + 1}`;
    }

    function semesterTermCode(value) {
        const normalize = (candidate) => {
            const raw = String(candidate || '').trim();
            if (/^\d{4}(01|02|03)$/.test(raw)) return raw;
            const match = raw.match(/^(Fall|Spring|Summer)\s+(\d{4})-(\d{4})$/i);
            if (!match || Number(match[3]) !== Number(match[2]) + 1) return '';
            const suffix = { fall: '01', spring: '02', summer: '03' }[match[1].toLowerCase()];
            return match[2] + suffix;
        };

        if (!value || typeof value !== 'object') return normalize(value);
        const candidates = [value.termCode, value.termName, value.date, value.term]
            .map(normalize)
            .filter(Boolean);
        if (!candidates.length) return '';
        const first = candidates[0];
        return candidates.every((code) => code === first) ? first : '';
    }

    function semesterAcademicTieKey(semester) {
        const courses = semester && Array.isArray(semester.courses) ? semester.courses : [];
        const courseSignature = courses.map((course) => {
            const code = String(course && course.code !== undefined ? course.code : course)
                .toUpperCase().replace(/[^A-Z0-9]/g, '');
            const grade = String((course && course.grade) || '').trim().toUpperCase();
            const basis = String((course && course.gradingBasis) || '').trim().toLowerCase();
            return [code, grade, basis].join('|');
        })
            .filter((value) => value.replace(/\|/g, ''))
            .sort()
            .join('\u0001');
        const storedIdentity = ['termCode', 'termName', 'date', 'term']
            .map((field) => String((semester && semester[field]) || '').trim().toUpperCase())
            .join('|');
        return [courseSignature, storedIdentity].join('\u0000');
    }

    function compareSemesterTerms(left, right) {
        const leftCode = semesterTermCode(left);
        const rightCode = semesterTermCode(right);
        if (leftCode && rightCode && leftCode !== rightCode) {
            return Number(leftCode) - Number(rightCode);
        }
        if (leftCode && !rightCode) return -1;
        if (!leftCode && rightCode) return 1;
        const leftTie = semesterAcademicTieKey(left);
        const rightTie = semesterAcademicTieKey(right);
        return leftTie < rightTie ? -1 : (leftTie > rightTie ? 1 : 0);
    }

    function hasDuplicateSemesterTerm(curriculumOrSemesters, candidate, options) {
        const semesters = Array.isArray(curriculumOrSemesters)
            ? curriculumOrSemesters
            : (curriculumOrSemesters && Array.isArray(curriculumOrSemesters.semesters)
                ? curriculumOrSemesters.semesters : []);
        const candidateCode = semesterTermCode(candidate);
        if (!candidateCode) return false;
        const excludedId = String((options && options.excludeSemesterId) || '');
        return semesters.some((semester) => {
            if (!semester || semester === candidate) return false;
            if (excludedId && String(semester.id || '') === excludedId) return false;
            return semesterTermCode(semester) === candidateCode;
        });
    }

    function normalizeTermIdentifier(term) {
        const raw = String(term || '').trim();
        if (!raw) return '';
        if (/^\d{6}$/.test(raw)) return raw;
        return termNameToCode(raw) || raw;
    }

    function displayTermIdentifier(term) {
        const normalized = normalizeTermIdentifier(term);
        if (/^\d{6}$/.test(normalized)) return termCodeToName(normalized) || normalized;
        return normalized;
    }

    const REGULAR_SEMESTER_CREDIT_LIMIT = 20;
    const SUMMER_SEMESTER_CREDIT_LIMIT = 8;

    function isSummerTerm(termOrSemester) {
        if (termOrSemester && typeof termOrSemester === 'object') {
            const stableCode = String(termOrSemester.termCode || '').trim();
            if (/^\d{4}(01|02|03)$/.test(stableCode)) return stableCode.endsWith('03');
            return isSummerTerm(termOrSemester.termName);
        }
        const raw = String(termOrSemester || '').trim();
        if (!raw) return false;
        return /^\d{4}03$/.test(normalizeTermIdentifier(raw));
    }

    function semesterCreditLimit(termOrSemester) {
        return isSummerTerm(termOrSemester)
            ? SUMMER_SEMESTER_CREDIT_LIMIT
            : REGULAR_SEMESTER_CREDIT_LIMIT;
    }

    function isSemesterCreditOverLimit(termOrSemester, explicitTotal) {
        const storedLoadValue = termOrSemester && typeof termOrSemester === 'object'
            ? termOrSemester.totalLoadCredit : null;
        const storedLoad = storedLoadValue !== null && storedLoadValue !== undefined
            ? Number(storedLoadValue) : NaN;
        const rawTotal = Number.isFinite(storedLoad) && storedLoad >= 0
            ? storedLoad
            : (explicitTotal !== undefined
                ? explicitTotal
                : (termOrSemester && typeof termOrSemester === 'object'
                    ? termOrSemester.totalCredit : 0));
        const total = Number(rawTotal);
        return Number.isFinite(total) && total > semesterCreditLimit(termOrSemester);
    }

    function updateSemesterCreditIndicator(span, semester, explicitLoad) {
        if (!span) return null;
        const storedLoadValue = semester && semester.totalLoadCredit;
        const storedLoad = storedLoadValue !== null && storedLoadValue !== undefined
            ? Number(storedLoadValue) : NaN;
        const rawLoad = Number.isFinite(storedLoad) && storedLoad >= 0
            ? storedLoad
            : (explicitLoad !== undefined
                ? explicitLoad
                : (semester && semester.totalCredit !== undefined ? semester.totalCredit : 0));
        const load = Math.max(0, Number(rawLoad) || 0);
        const storedAllocatedValue = semester && semester.primaryAllocatedCredit;
        const storedAllocated = storedAllocatedValue !== null && storedAllocatedValue !== undefined
            ? Number(storedAllocatedValue) : NaN;
        const allocated = Number.isFinite(storedAllocated) && storedAllocated >= 0
            ? Math.min(load, storedAllocated) : load;
        const storedUnallocatedValue = semester && semester.primaryUnallocatedCredit;
        const storedUnallocated = storedUnallocatedValue !== null && storedUnallocatedValue !== undefined
            ? Number(storedUnallocatedValue) : NaN;
        const unallocated = Number.isFinite(storedUnallocated) && storedUnallocated >= 0
            ? Math.min(load, storedUnallocated) : Math.max(0, load - allocated);
        const compactCredit = (value) => String(
            Math.round((Number(value) || 0) * 1000) / 1000
        );
        const loadText = compactCredit(load);
        const allocatedText = compactCredit(allocated);
        const unallocatedText = compactCredit(unallocated);
        const limit = semesterCreditLimit(semester);
        const overLimit = isSemesterCreditOverLimit(semester, load);
        const summer = isSummerTerm(semester);
        const seasonLabel = summer ? 'Summer' : 'regular semester';

        span.textContent = loadText + ' SU' + (unallocated > 0
            ? ' (' + unallocatedText + ' N/A)' : '');
        span.classList.toggle('is-overlimit', overLimit);
        span.dataset.suLoad = loadText;
        span.dataset.primaryAllocatedSu = allocatedText;
        span.dataset.primaryUnallocatedSu = unallocatedText;
        span.dataset.creditLimit = String(limit);
        span.dataset.overloadAdvisory = overLimit ? 'true' : 'false';
        const program = String((semester && semester.primaryProgramCode) || '').trim().toUpperCase();
        const allocatedDestination = program
            ? `${program} degree categories` : "the primary program's degree categories";
        const unallocatedDestination = program
            ? `a ${program} degree category` : 'a primary-program degree category';
        const thresholdText = overLimit
            ? `Above the standard ${limit}-SU ${seasonLabel} load; an overload may be possible with approval.`
            : `Standard ${summer ? 'Summer' : 'regular-semester'} load threshold: ${limit} SU.`;
        const message = `${loadText} SU semester load: ${allocatedText} SU are allocated to ${allocatedDestination}; ${unallocatedText} SU are not allocated to ${unallocatedDestination} (N/A). Grade, PGPA, and other-program treatment are separate. ${thresholdText}`;
        span.title = message;
        span.setAttribute('aria-label', message);
        return { load, allocated, unallocated, limit, overLimit };
    }

    function updateCurrentTermHighlights() {
        try {
            const currentTerm = String(root.currentTermName || '');
            if (!currentTerm || typeof document === 'undefined') return;
            document.querySelectorAll('.container_semester').forEach((container) => {
                const label = container.querySelector('.date p');
                const value = label ? label.textContent.trim() : '';
                container.classList.toggle('current-term', Boolean(value && value === currentTerm));
            });
        } catch (_) {}
    }

    const now = new Date();
    const currentTermName = getCurrentTermNameFromDate(now);
    const currentMatch = currentTermName.match(/(Fall|Spring|Summer)\s+(\d{4})-(\d{4})/);
    const academicYear = currentMatch ? Number(currentMatch[2]) : now.getFullYear() - 1;
    const startYear = Math.max(2019, academicYear - 6);
    const endYear = Math.min(2030, academicYear + 6);
    const terms = [];
    for (let year = endYear; year >= startYear; year--) {
        const range = `${year}-${year + 1}`;
        terms.push(`Summer ${range}`, `Spring ${range}`, `Fall ${range}`);
    }
    const entryTerms = [];
    for (let year = academicYear; year >= startYear; year--) {
        const range = `${year}-${year + 1}`;
        entryTerms.push(`Summer ${range}`, `Spring ${range}`, `Fall ${range}`);
    }

    root.currentTermName = currentTermName;
    root.currentAcademicYearStart = academicYear;
    root.currentTermCode = termNameToCode(currentTermName);
    root.terms = terms;
    root.entryTerms = entryTerms;

    const api = Object.freeze({
        getCurrentTermNameFromDate,
        termNameToCode,
        termCodeToName,
        semesterTermCode,
        compareSemesterTerms,
        hasDuplicateSemesterTerm,
        normalizeTermIdentifier,
        displayTermIdentifier,
        isSummerTerm,
        semesterCreditLimit,
        isSemesterCreditOverLimit,
        updateSemesterCreditIndicator,
        updateCurrentTermHighlights,
        get terms() { return root.terms; },
        get entryTerms() { return root.entryTerms; },
    });
    const namespace = root.SurriculumModules || (root.SurriculumModules = {});
    namespace.academicTerms = api;

    root.getCurrentTermNameFromDate = getCurrentTermNameFromDate;
    root.termNameToCode = termNameToCode;
    root.termCodeToName = termCodeToName;
    root.semesterTermCode = semesterTermCode;
    root.compareSemesterTerms = compareSemesterTerms;
    root.hasDuplicateSemesterTerm = hasDuplicateSemesterTerm;
    root.normalizeTermIdentifier = normalizeTermIdentifier;
    root.displayTermIdentifier = displayTermIdentifier;
    root.isSummerTerm = isSummerTerm;
    root.semesterCreditLimit = semesterCreditLimit;
    root.isSemesterCreditOverLimit = isSemesterCreditOverLimit;
    root.updateSemesterCreditIndicator = updateSemesterCreditIndicator;
    root.updateCurrentTermHighlights = updateCurrentTermHighlights;
})(typeof window !== 'undefined' ? window : globalThis);
