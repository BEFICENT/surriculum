// Stateful allocation-pass controller for the live curriculum model. The
// constructor supplies every policy and side-effect boundary explicitly; this
// module owns the shared main/double-major traversal without owning curriculum
// state or replacing live semester/course objects.
(function installCurriculumRecalculation(root) {
    'use strict';

    const REQUIRED_FUNCTIONS = [
        'getRequirement',
        'isValidRequirement',
        'resolveGetInfo',
        'compareSemesters',
        'resolveAlternativeRules',
        'languageCapForRequirements',
        'normalizedLanguageLevel',
        'languageCourseNeedsLevelReview',
        'isBasicLanguageCourse',
        'allocateCascade',
        'applyManDiversity',
        'parseCreditValue',
        'lookupCustomRecord',
        'recomputePrimaryCreditSplit',
        'notifyAllocationUpdated',
    ];

    function create(dependencies) {
        const deps = dependencies || {};
        for (let i = 0; i < REQUIRED_FUNCTIONS.length; i++) {
            const name = REQUIRED_FUNCTIONS[i];
            if (typeof deps[name] !== 'function') {
                throw new Error(`curriculum-recalculation requires ${name}()`);
            }
        }
        if (!deps.mainFields || !deps.doubleMajorFields) {
            throw new Error('curriculum-recalculation requires main and double-major fields');
        }

        const parseCredit = (value) => deps.parseCreditValue(value);

        const findExactCatalogRecord = (catalog, code) => {
            const records = Array.isArray(catalog) ? catalog : [];
            for (let i = 0; i < records.length; i++) {
                const record = records[i];
                if ((record.Major + record.Code) === code) {
                    return record;
                }
            }
            return null;
        };

        const resetMainTotals = (semesters) => {
            for (let i = 0; i < semesters.length; i++) {
                const sem = semesters[i];
                sem.totalCredit = 0;
                sem.totalArea = 0;
                sem.totalCore = 0;
                sem.totalFree = 0;
                sem.totalUniversity = 0;
                sem.totalRequired = 0;
                sem.totalScience = 0.0;
                sem.totalEngineering = 0.0;
                sem.totalECTS = 0.0;
            }
        };

        const resetDoubleMajorTotals = (semesters) => {
            for (let i = 0; i < semesters.length; i++) {
                const sem = semesters[i];
                sem.totalCoreDM = 0;
                sem.totalAreaDM = 0;
                sem.totalFreeDM = 0;
                sem.totalRequiredDM = 0;
                sem.totalUniversityDM = 0;
                sem.totalScienceDM = 0;
                sem.totalEngineeringDM = 0;
                sem.totalECTSDM = 0;
            }
        };

        const addCategoryCredit = (sem, fields, type, credit) => {
            const field = fields.total[type];
            if (field) sem[field] += credit;
        };

        const mainMetricsFrom = (source, parsedCredit) => ({
            credit: parsedCredit === undefined
                ? parseCredit((source && source.SU_credit) || '0') : parsedCredit,
            science: parseFloat((source && source.Basic_Science) || '0'),
            engineering: parseFloat((source && source.Engineering) || '0'),
            ects: parseFloat((source && source.ECTS) || '0'),
        });

        const hydrateMainCourse = (course, source, metrics, preserveExisting) => {
            course.Basic_Science = metrics.science;
            course.Engineering = metrics.engineering;
            course.SU_credit = metrics.credit;
            course.ECTS = metrics.ects;
            course.Faculty_Course = (source && source.Faculty_Course)
                ? source.Faculty_Course
                : (preserveExisting ? (course.Faculty_Course || 'No') : 'No');
            course.Faculty = (source && source.Faculty)
                ? source.Faculty : (preserveExisting ? (course.Faculty || '') : '');
        };

        const addMainMetrics = (sem, metrics) => {
            sem.totalCredit += metrics.credit;
            sem.totalScience += metrics.science;
            sem.totalEngineering += metrics.engineering;
            sem.totalECTS += metrics.ects;
        };

        const hydrateDoubleMajorCourse = (course, info, credit) => {
            course.SU_credit = credit;
            course.Basic_Science = parseFloat(info.Basic_Science || '0') || 0;
            course.Engineering = parseFloat(info.Engineering || '0') || 0;
            course.ECTS = parseFloat(info.ECTS || '0') || 0;
            course.Faculty_Course = info.Faculty_Course || course.Faculty_Course || 'No';
            course.Faculty = info.Faculty || course.Faculty || '';
        };

        const addDoubleMajorMetrics = (sem, source) => {
            sem.totalScienceDM += parseFloat((source && source.Basic_Science) || '0');
            sem.totalEngineeringDM += parseFloat((source && source.Engineering) || '0');
            sem.totalECTSDM += parseFloat((source && source.ECTS) || '0');
        };

        function runAllocationPass(curriculum, config) {
            const semesters = curriculum.semesters;
            const sorted = semesters.slice().sort(deps.compareSemesters);
            const counters = { required: 0, core: 0, area: 0 };
            const thresholds = {
                required: config.requirements.required || 0,
                core: config.requirements.core || 0,
                area: config.requirements.area || 0,
            };
            const basicLanguageLimit = deps.languageCapForRequirements(config.requirements);
            let basicLanguagesCounted = 0;
            const forceIeCore = config.major === 'IE'
                && curriculum.hasDegreeEligibleCourse('CS201')
                && curriculum.hasDegreeEligibleCourse('DSA201');
            const alternatives = deps.resolveAlternativeRules(
                config.major,
                config.entryTerm,
                sorted,
                semesters,
                config.getInfo,
                config.catalog,
                (code) => curriculum.hasDegreeEligibleCourse(code),
                config.requirements.groups,
                (course) => curriculum.isDegreeEligibleCourse(course),
            );

            for (let i = 0; i < sorted.length; i++) {
                const sem = sorted[i];
                for (let j = 0; j < sem.courses.length; j++) {
                    const course = sem.courses[j];
                    delete course[config.exclusionReasonField];
                    course[config.languageLevelField] = '';

                    if (!curriculum.isDegreeEligibleCourse(course)) {
                        course[config.fields.effective] = 'none';
                        delete course[config.fields.category];
                        continue;
                    }
                    if (alternatives.excluded.has(course)) {
                        course[config.fields.effective] = 'none';
                        continue;
                    }

                    let info = config.findInfo(course);
                    if (!info) info = deps.lookupCustomRecord(config.major, course.code);
                    if (config.clearCategoryBeforeClassification) {
                        delete course[config.fields.category];
                    }

                    if (!info) {
                        const fallback = config.unknownMetricSource(course);
                        const metrics = mainMetricsFrom(fallback || course);
                        if (config.isMain) {
                            hydrateMainCourse(course, fallback, metrics, true);
                            addMainMetrics(sem, metrics);
                        } else {
                            // The legacy pass resolves the SU value here even
                            // though unknown DM courses cannot enter a category.
                            parseCredit(course.SU_credit || '0');
                            addDoubleMajorMetrics(sem, course);
                        }
                        course[config.fields.effective] = 'none';
                        continue;
                    }

                    let staticType = String(info.EL_Type || '').toLowerCase();
                    course[config.languageLevelField] = deps.normalizedLanguageLevel(info.Language_Level);
                    if (alternatives.typeOverride.has(course)) {
                        staticType = alternatives.typeOverride.get(course);
                    }
                    if (deps.languageCourseNeedsLevelReview(course, info)) {
                        course[config.fields.effective] = 'none';
                        course[config.exclusionReasonField] = deps.languageLevelReviewReason;
                        delete course[config.fields.category];
                        continue;
                    }
                    if (staticType === 'unknown') {
                        course[config.fields.effective] = 'none';
                        if (!config.isMain) delete course[config.fields.category];
                        continue;
                    }
                    if (staticType) {
                        course[config.fields.category] = staticType.charAt(0).toUpperCase()
                            + staticType.slice(1);
                    }

                    const credit = parseCredit(info.SU_credit || '0');
                    const metrics = mainMetricsFrom(info, credit);
                    if (config.isMain) hydrateMainCourse(course, info, metrics, false);
                    else hydrateDoubleMajorCourse(course, info, credit);

                    const pinCore = alternatives.forceCore.has(course)
                        || (forceIeCore && course.code === 'CS201');
                    const effectiveType = deps.allocateCascade(
                        staticType,
                        credit,
                        counters,
                        thresholds,
                        pinCore,
                    );
                    if (effectiveType === 'free' && basicLanguageLimit !== null
                        && deps.isBasicLanguageCourse(course, info)) {
                        if (basicLanguagesCounted >= basicLanguageLimit) {
                            course[config.fields.effective] = 'none';
                            course[config.exclusionReasonField] = deps.basicLanguageExclusionReason;
                            continue;
                        }
                        basicLanguagesCounted++;
                    }

                    course[config.fields.effective] = effectiveType;
                    addCategoryCredit(sem, config.fields, effectiveType, credit);
                    if (config.isMain) addMainMetrics(sem, metrics);
                    else addDoubleMajorMetrics(sem, info);
                }
            }
            return sorted;
        }

        function recalculateMain(curriculum, courseData) {
            curriculum.primaryCourseData = Array.isArray(courseData) ? courseData : [];
            const requirements = deps.getRequirement(curriculum.major, curriculum.entryTerm);
            if (!deps.isValidRequirement(curriculum.major, requirements)) return;
            const getInfo = deps.resolveGetInfo();
            if (!getInfo) return;

            resetMainTotals(curriculum.semesters);
            const sorted = runAllocationPass(curriculum, {
                isMain: true,
                major: curriculum.major,
                entryTerm: curriculum.entryTerm,
                requirements,
                catalog: courseData,
                getInfo,
                fields: deps.mainFields,
                exclusionReasonField: 'degreeExclusionReason',
                languageLevelField: 'Language_Level',
                clearCategoryBeforeClassification: false,
                findInfo: (course) => findExactCatalogRecord(courseData, course.code),
                unknownMetricSource: (course) => {
                    try {
                        if (curriculum.doubleMajor
                            && Array.isArray(curriculum.doubleMajorCourseData)) {
                            return findExactCatalogRecord(
                                curriculum.doubleMajorCourseData,
                                course.code,
                            );
                        }
                    } catch (_) {}
                    return null;
                },
            });

            if (curriculum.major === 'MAN') {
                deps.applyManDiversity(
                    sorted,
                    curriculum.semesters,
                    deps.mainFields,
                    requirements.core || 0,
                    requirements.area || 0,
                );
            }
            deps.recomputePrimaryCreditSplit(curriculum);

            try {
                if (curriculum.doubleMajor && Array.isArray(curriculum.doubleMajorCourseData)) {
                    curriculum.recalcEffectiveTypesDouble(
                        curriculum.doubleMajorCourseData,
                        { suppressNotify: true },
                    );
                }
            } catch (_) {}
            deps.notifyAllocationUpdated();
        }

        function recalculateDoubleMajor(curriculum, courseData, options) {
            if (!curriculum.doubleMajor) return;
            curriculum.doubleMajorCourseData = Array.isArray(courseData) ? courseData : [];
            const requirements = deps.getRequirement(curriculum.doubleMajor, curriculum.entryTermDM);
            if (!deps.isValidRequirement(curriculum.doubleMajor, requirements)) return;
            const getInfo = deps.resolveGetInfo();
            if (!getInfo) return;

            resetDoubleMajorTotals(curriculum.semesters);
            const sorted = runAllocationPass(curriculum, {
                isMain: false,
                major: curriculum.doubleMajor,
                entryTerm: curriculum.entryTermDM,
                requirements,
                catalog: courseData,
                getInfo,
                fields: deps.doubleMajorFields,
                exclusionReasonField: 'degreeExclusionReasonDM',
                languageLevelField: 'Language_LevelDM',
                clearCategoryBeforeClassification: true,
                findInfo: (course) => getInfo(course.code, courseData),
                unknownMetricSource: (course) => course,
            });

            if (curriculum.doubleMajor === 'MAN') {
                deps.applyManDiversity(
                    sorted,
                    curriculum.semesters,
                    deps.doubleMajorFields,
                    requirements.core || 0,
                    requirements.area || 0,
                );
            }
            deps.recomputePrimaryCreditSplit(curriculum);
            if (!(options && options.suppressNotify === true)) {
                deps.notifyAllocationUpdated();
            }
        }

        return Object.freeze({ recalculateMain, recalculateDoubleMajor });
    }

    const namespace = root.SurriculumModules || (root.SurriculumModules = {});
    namespace.curriculumRecalculation = Object.freeze({ create });
})(typeof window !== 'undefined' ? window : globalThis);
