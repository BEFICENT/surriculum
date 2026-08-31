// Academic Records planner lookup, catalog resolution, and GPA mutation helpers.
(function installAcademicRecordsCatalogResolution(root) {
    'use strict';

    const namespace = root.SurriculumModules || (root.SurriculumModules = {});
    const parsing = namespace.academicRecordsParsing;
    if (!parsing) {
        throw new Error('scripts/academic-records/parser.js must load before catalog-resolution.js');
    }
    const {
        getTranscriptGradePolicy,
        normalizeTranscriptGrade,
        inferTranscriptGradingBasis,
        canonicalTranscriptCourseCode,
        normalizeTranscriptSemester,
    } = parsing;

    function createAcademicRecordsCatalogResolution(dependencies) {
        const runtime = dependencies || {};
        const document = runtime.document;
        const getSemesterTermCode = typeof runtime.getSemesterTermCode === 'function'
            ? runtime.getSemesterTermCode : () => runtime.semesterTermCode;
        const getResolveGlobalCourseDefinition =
            typeof runtime.getResolveGlobalCourseDefinition === 'function'
                ? runtime.getResolveGlobalCourseDefinition
                : () => runtime.resolveGlobalCourseDefinition;
        const getRememberGlobalCourseDefinition =
            typeof runtime.getRememberGlobalCourseDefinition === 'function'
                ? runtime.getRememberGlobalCourseDefinition
                : () => runtime.rememberGlobalCourseDefinition;
        const refreshSemesterAccessibility = runtime.refreshSemesterAccessibility;
        const formatCreditValue = runtime.formatCreditValue;
        const evaluateGradeForLegacyTotals = runtime.evaluateGradeForLegacyTotals;
        const parseCreditValue = runtime.parseCreditValue;

        function formatTranscriptSemester(semester) {
            const value = String(semester || '').trim();
            return normalizeTranscriptSemester(value) || value;
        }

        function curriculumCourseOccurrences(curriculum, rawCode) {
            const code = canonicalTranscriptCourseCode(rawCode);
            const occurrences = [];
            const semesters = curriculum && Array.isArray(curriculum.semesters) ? curriculum.semesters : [];
            semesters.forEach((semester) => {
                const courses = semester && Array.isArray(semester.courses) ? semester.courses : [];
                courses.forEach((course) => {
                    if (canonicalTranscriptCourseCode(course && course.code) === code) {
                        occurrences.push({ semester, course });
                    }
                });
            });
            return occurrences;
        }

        function curriculumSemesterName(semester) {
            if (!semester) return '';
            if (semester.termName) return formatTranscriptSemester(semester.termName);
            return '';
        }

        function transcriptTermCode(value) {
            const normalized = normalizeTranscriptSemester(value && typeof value === 'object'
                ? (value.termName || value.date || value.term || '') : value);
            const match = normalized.match(/^(Fall|Spring|Summer)\s+(\d{4})-\d{4}$/);
            if (!match) return '';
            const suffix = { Fall: '01', Spring: '02', Summer: '03' }[match[1]];
            return match[2] + suffix;
        }

        function curriculumSemesterTermCode(semester) {
            try {
                const shared = getSemesterTermCode();
                if (typeof shared === 'function') return String(shared(semester) || '');
            } catch (_) {
                return '';
            }
            const stored = String((semester && semester.termCode) || '').trim();
            const named = transcriptTermCode(semester);
            if (stored && !/^\d{4}(01|02|03)$/.test(stored)) return '';
            if (stored && named && stored !== named) return '';
            return stored || named;
        }

        function curriculumSemestersForTranscriptTerm(curriculum, termName) {
            const targetCode = transcriptTermCode(termName);
            if (!targetCode) return [];
            const semesters = curriculum && Array.isArray(curriculum.semesters)
                ? curriculum.semesters : [];
            return semesters.filter((semester) => curriculumSemesterTermCode(semester) === targetCode);
        }

        function courseCatalogRecord(courseData, curriculum, rawCode) {
            const code = canonicalTranscriptCourseCode(rawCode);
            const lists = [courseData];
            if (curriculum && curriculum.doubleMajor && Array.isArray(curriculum.doubleMajorCourseData)) {
                lists.push(curriculum.doubleMajorCourseData);
            }
            if (curriculum && Array.isArray(curriculum.minors) && curriculum.minorCourseDataByCode) {
                curriculum.minors.forEach((minorCode) => {
                    const list = curriculum.minorCourseDataByCode[minorCode];
                    if (Array.isArray(list)) lists.push(list);
                });
            }
            let globalFallback = null;
            for (const list of lists) {
                if (!Array.isArray(list)) continue;
                for (const record of list) {
                    const recordCode = canonicalTranscriptCourseCode(
                        record && record.code ? record.code : String((record && record.Major) || '') + String((record && record.Code) || '')
                    );
                    if (recordCode !== code) continue;
                    if (record && record.__globalCourseDefinition) {
                        if (!globalFallback) globalFallback = record;
                        continue;
                    }
                    return record;
                }
            }
            return globalFallback;
        }

        function transcriptCatalogRecordCode(record) {
            return canonicalTranscriptCourseCode(
                record && record.code
                    ? record.code
                    : String((record && record.Major) || '') + String((record && record.Code) || '')
            );
        }

        function resolveTranscriptCourseRecord(course, courseData, curriculum) {
            const catalogRecord = courseCatalogRecord(courseData, curriculum, course && course.code);
            if (catalogRecord && !catalogRecord.__globalCourseDefinition) {
                return { record: catalogRecord, isGlobal: false, changed: false, source: 'selected-catalog' };
            }

            const code = canonicalTranscriptCourseCode(course && course.code);
            let globalRecord = catalogRecord && catalogRecord.__globalCourseDefinition
                ? catalogRecord : null;
            const wasStoredPlaceholder = !!(globalRecord && globalRecord.__storedCoursePlaceholder);
            const existingTitle = String((globalRecord && globalRecord.Course_Name) || '').trim();
            const transcriptTitle = String((course && course.title) || '').trim();
            const fallbackTitle = existingTitle && existingTitle !== code
                ? existingTitle : (transcriptTitle || existingTitle || code);
            const existingSu = Number(globalRecord && globalRecord.SU_credit);
            const existingEcts = Number(globalRecord && globalRecord.ECTS);
            const transcriptSu = Number(course && course.suCredits);
            const transcriptEcts = Number(course && course.ects);
            // Parser defaults use zero when a credit cell could not be extracted.
            // Preserve a known nonzero snapshot; otherwise a positive transcript value
            // can fill a genuinely empty fallback. A verified current index value still
            // wins inside resolveGlobalCourseDefinition.
            const fallbackSu = Number.isFinite(existingSu) && existingSu > 0
                ? existingSu : (Number.isFinite(transcriptSu) && transcriptSu > 0
                    ? transcriptSu : (Number.isFinite(existingSu) ? existingSu : 0));
            const fallbackEcts = Number.isFinite(existingEcts) && existingEcts > 0
                ? existingEcts : (Number.isFinite(transcriptEcts) && transcriptEcts > 0
                    ? transcriptEcts : (Number.isFinite(existingEcts) ? existingEcts : 0));
            let resolvedFromIndex = false;
            try {
                const resolver = getResolveGlobalCourseDefinition();
                if (resolver) {
                    const resolved = resolver(course && course.code, {
                        title: fallbackTitle,
                        suCredits: fallbackSu,
                        ects: fallbackEcts,
                    });
                    if (resolved) {
                        globalRecord = resolved;
                        resolvedFromIndex = true;
                    }
                }
            } catch (_) {}

            // A plan restored while the cumulative index is unavailable has an
            // internal marker, possibly carrying a saved metadata snapshot. A later
            // transcript import fills only what that fallback does not already know.
            if (globalRecord && wasStoredPlaceholder) {
                globalRecord = Object.assign({}, globalRecord, {
                    Course_Name: resolvedFromIndex
                        ? (globalRecord.Course_Name || fallbackTitle) : fallbackTitle,
                    SU_credit: String(resolvedFromIndex ? Number(globalRecord.SU_credit || 0) : fallbackSu),
                    ECTS: String(resolvedFromIndex ? Number(globalRecord.ECTS || 0) : fallbackEcts),
                    __storedCoursePlaceholder: false,
                });
            }
            if (!globalRecord) {
                return { record: null, isGlobal: false, changed: false, source: 'unresolved' };
            }

            const existingIndex = Array.isArray(courseData)
                ? courseData.findIndex(record => transcriptCatalogRecordCode(record) === code)
                : -1;
            const previousRecord = existingIndex >= 0 ? courseData[existingIndex] : null;
            const comparedFields = [
                'Course_Name', 'SU_credit', 'ECTS', 'Engineering', 'Basic_Science',
                'Faculty', 'Faculty_Course', 'EL_Type', '__storedCoursePlaceholder'
            ];
            const changed = !previousRecord || comparedFields.some(field =>
                String(previousRecord[field] ?? '') !== String(globalRecord[field] ?? '')
            );
            if (existingIndex < 0 && Array.isArray(courseData)) courseData.push(globalRecord);
            else if (existingIndex >= 0 && previousRecord.__globalCourseDefinition) {
                courseData[existingIndex] = globalRecord;
            }

            try {
                const remember = getRememberGlobalCourseDefinition();
                if (typeof remember === 'function') {
                    remember(globalRecord);
                }
            } catch (_) {}
            return {
                record: globalRecord,
                isGlobal: true,
                changed,
                source: resolvedFromIndex
                    ? 'global-course-index'
                    : (wasStoredPlaceholder ? 'saved-transcript-fallback' : 'existing-global-definition'),
            };
        }

        function applyTranscriptCatalogRecordToOccurrence(occurrence, record) {
            if (!occurrence || !occurrence.course || !record) return false;
            const course = occurrence.course;
            const numericFields = ['SU_credit', 'ECTS', 'Engineering', 'Basic_Science'];
            const textFields = ['Faculty', 'Faculty_Course'];
            let changed = false;
            numericFields.forEach((field) => {
                const next = Number(record[field] || 0);
                const normalized = Number.isFinite(next) ? next : 0;
                if (Number(course[field] || 0) !== normalized) changed = true;
                course[field] = normalized;
            });
            textFields.forEach((field) => {
                const next = String(record[field] || (field === 'Faculty_Course' ? 'No' : ''));
                if (String(course[field] || '') !== next) changed = true;
                course[field] = next;
            });

            try {
                if (typeof document !== 'undefined' && course.id) {
                    const node = document.getElementById(course.id);
                    const nameNode = node && node.querySelector('.course_name');
                    const creditNode = node && node.querySelector('.course_credit');
                    const scienceNode = node && node.querySelector('.course_bs_credit');
                    if (nameNode) nameNode.textContent = String(record.Course_Name || course.code || '');
                    if (creditNode) {
                        const creditText = typeof formatCreditValue === 'function'
                            ? formatCreditValue(course.SU_credit) : String(course.SU_credit);
                        creditNode.textContent = creditText + ' credits';
                    }
                    if (scienceNode) scienceNode.textContent = 'BS: ' + course.Basic_Science + ' credits';
                }
            } catch (_) {}
            return changed;
        }

        function evaluateTranscriptGpaOutcome(grade, basis) {
            if (typeof evaluateGradeForLegacyTotals === 'function') {
                return evaluateGradeForLegacyTotals(grade, basis);
            }
            const policy = getTranscriptGradePolicy();
            return policy && typeof policy.evaluateGrade === 'function'
                ? policy.evaluateGrade(grade, basis) : null;
        }

        function recomputeSemesterTranscriptGpa(semester, curriculum, courseData) {
            if (!semester || !Array.isArray(semester.courses)) return;
            let totalGPA = 0;
            let totalGPACredits = 0;
            semester.courses.forEach((course) => {
                const record = courseCatalogRecord(courseData, curriculum, course && course.code);
                const creditValue = record ? record.SU_credit : course && course.SU_credit;
                const credit = typeof parseCreditValue === 'function'
                    ? parseCreditValue(creditValue || 0) : (parseFloat(creditValue || 0) || 0);
                const canonicalGrade = normalizeTranscriptGrade(course && course.grade);
                const grade = canonicalGrade === null
                    ? String((course && course.grade) || '').trim().toUpperCase() : canonicalGrade;
                const basis = inferTranscriptGradingBasis(grade, course && course.gradingBasis) || 'unknown';
                const outcome = evaluateTranscriptGpaOutcome(grade, basis);
                if (!outcome || !outcome.countsInGpa) return;
                totalGPA += credit * outcome.gpaPoints;
                totalGPACredits += credit;
            });
            semester.totalGPA = totalGPA;
            semester.totalGPACredits = totalGPACredits;
        }

        function updateExistingTranscriptCourse(occurrence, gradeRecord, curriculum, courseData) {
            if (!occurrence || !occurrence.course || !occurrence.semester || !gradeRecord) return false;
            const course = occurrence.course;
            const semester = occurrence.semester;
            const oldGrade = normalizeTranscriptGrade(course.grade);
            const oldCanonicalGrade = oldGrade === null ? String(course.grade || '').trim().toUpperCase() : oldGrade;
            const oldBasis = inferTranscriptGradingBasis(oldCanonicalGrade, course.gradingBasis) || 'unknown';
            const nextBasis = gradeRecord.gradingBasis || oldBasis || 'unknown';
            if (oldCanonicalGrade === gradeRecord.grade && oldBasis === nextBasis) return false;

            const record = courseCatalogRecord(courseData, curriculum, course.code);
            const creditValue = record ? record.SU_credit : course.SU_credit;
            const credit = typeof parseCreditValue === 'function'
                ? parseCreditValue(creditValue || 0) : (parseFloat(creditValue || 0) || 0);
            const oldOutcome = evaluateTranscriptGpaOutcome(oldCanonicalGrade, oldBasis);
            const nextOutcome = evaluateTranscriptGpaOutcome(gradeRecord.grade, nextBasis);
            if (oldOutcome && oldOutcome.countsInGpa) {
                semester.totalGPA = Number(semester.totalGPA || 0) - (credit * oldOutcome.gpaPoints);
                semester.totalGPACredits = Number(semester.totalGPACredits || 0) - credit;
            }
            if (nextOutcome && nextOutcome.countsInGpa) {
                semester.totalGPA = Number(semester.totalGPA || 0) + (credit * nextOutcome.gpaPoints);
                semester.totalGPACredits = Number(semester.totalGPACredits || 0) + credit;
            }

            course.grade = gradeRecord.grade;
            course.gradingBasis = nextBasis;
            try {
                if (typeof document !== 'undefined' && course.id) {
                    const node = document.getElementById(course.id);
                    const gradeNode = node && node.querySelector('.grade');
                    if (gradeNode) gradeNode.textContent = gradeRecord.grade || 'Add grade';
                }
            } catch (_) {}
            return true;
        }

        return Object.freeze({
            formatTranscriptSemester,
            curriculumCourseOccurrences,
            curriculumSemesterName,
            transcriptTermCode,
            curriculumSemesterTermCode,
            curriculumSemestersForTranscriptTerm,
            courseCatalogRecord,
            transcriptCatalogRecordCode,
            resolveTranscriptCourseRecord,
            applyTranscriptCatalogRecordToOccurrence,
            evaluateTranscriptGpaOutcome,
            recomputeSemesterTranscriptGpa,
            updateExistingTranscriptCourse,
        });
    }

    namespace.academicRecordsCatalogResolution = Object.freeze({
        create: createAcademicRecordsCatalogResolution,
    });
})(typeof window !== 'undefined' ? window : globalThis);
