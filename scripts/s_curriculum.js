// Curriculum constructor. In a non-module environment this function will
// be attached to the global window so that other scripts can instantiate
// curricula without using ES module imports.

// Progress and program-membership policy is provided by
// scripts/domain/curriculum-progress.js. Keep the constructor export here
// for classic-script consumers.
if (typeof window !== 'undefined') window.s_curriculum = s_curriculum;
function s_curriculum()
{
    this.semester_id = 0;
    this.course_id = 0;
    this.container_id = 0;
    this.semesters = [];
    this.major = '';

    // Allocation is domain work. The application controller owns the visual
    // follow-up (labels, picker data, and advisory requisite notices) and
    // installs one synchronous handler after constructing the curriculum.
    // Keeping the callback private prevents callers from replacing model state
    // merely to refresh the UI.
    let allocationUpdateHandler = null;
    this.setAllocationUpdateHandler = function(handler) {
        allocationUpdateHandler = typeof handler === 'function' ? handler : null;
    };
    const notifyAllocationUpdated = () => {
        if (!allocationUpdateHandler) return;
        try { allocationUpdateHandler(this); } catch (_) {}
    };

    // Academic entry term codes (e.g., "202301") for the main major and
    // optional double major. These control which requirement set is used
    // when evaluating graduation status.
    this.entryTerm = '';

    // When the user chooses a double major via the UI, this property is
    // assigned the second major's code (e.g., "EE").  When set, the
    // curriculum will compute a second set of effective course categories
    // (core, area, free) for the double major using the
    // recalcEffectiveTypesDouble method.  If undefined or empty, no
    // double major processing occurs.
    this.doubleMajor = '';
    this.entryTermDM = '';

    // Helper to retrieve requirement object for a given major and term code.
    // The global `requirements` may either be a flat object keyed by major or
    // a nested object keyed by term then major. This compatibility lookup keeps
    // older local-file snapshots readable while current data remains term based.
    const getReq = (major, term) => {
        if (typeof getRequirementRecord === 'function') {
            return getRequirementRecord(major, term) || {};
        }
        if (typeof requirements === 'undefined') return {};
        if (requirements[term] && requirements[term][major]) {
            return requirements[term][major];
        }
        if (requirements[major]) return requirements[major];
        return {};
    };

    const requirementRecordIsValid = (major, record) => {
        if (typeof isValidRequirementRecord === 'function') {
            return isValidRequirementRecord(record, major);
        }
        if (!record || typeof record !== 'object' || Array.isArray(record)) return false;
        const fields = ['university', 'required', 'core', 'area', 'free', 'ects', 'total', 'humRequired'];
        return fields.every(field => Number.isInteger(record[field]) && record[field] >= 0)
            && record.total > 0
            && record.ects > 0
            && record.facultyReq
            && typeof record.facultyReq === 'object'
            && !Array.isArray(record.facultyReq);
    };

    const catalogRecordFor = (catalog, code) => {
        const target = normalizeCourseCode(code);
        const rows = Array.isArray(catalog) ? catalog : [];
        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            if (normalizeCourseCode((row && row.Major || '') + (row && row.Code || '')) === target) {
                return row;
            }
        }
        return null;
    };

    const customRecordsFor = (major) => {
        try {
            if (typeof localStorage === 'undefined') return null;
            const key = 'customCourses_' + major;
            const ps = (typeof window !== 'undefined') ? window.planStorage : null;
            const planId = (ps && typeof ps.getSessionPlanId === 'function')
                ? ps.getSessionPlanId() : null;
            let stored = null;
            if (ps && typeof ps.getItem === 'function') {
                if (!planId) return null;
                try { stored = ps.getItem(key, planId); } catch (_) { return null; }
            } else {
                try { stored = localStorage.getItem(key); } catch (_) {}
            }
            if (!stored) return null;
            const parsed = JSON.parse(stored);
            return Array.isArray(parsed) ? parsed : null;
        } catch (_) {
            return null;
        }
    };

    const customRecordFor = (major, code) =>
        catalogRecordFor(customRecordsFor(major), code);

    // The live allocation passes historically match persisted custom records by
    // their exact Major+Code identity. Keep that compatibility detail separate
    // from the normalized lookup used by read-only progress snapshots.
    const allocationCustomRecordFor = (major, code) => {
        const records = customRecordsFor(major) || [];
        for (let i = 0; i < records.length; i++) {
            const record = records[i];
            if ((record.Major + record.Code) === code) return record;
        }
        return null;
    };

    const sortedProgressSemesters = () => this.semesters.slice().sort(compareCurriculumSemesterTerms);

    const addProgressMetric = (sem, fields, key, value) => {
        const n = parseFloat(value || '0');
        sem[fields.metric[key]] += isNaN(n) ? 0 : n;
    };

    // Independent allocation pass used by the earned/projected audit. It
    // intentionally writes only private progress fields; the planner's normal
    // effective types and totals remain the forward-looking allocation.
    const runProgressAllocation = (view, layer, isEligible, stateOf) => {
        const isDM = view === 'dm';
        const major = isDM ? this.doubleMajor : this.major;
        const entryTerm = isDM ? this.entryTermDM : this.entryTerm;
        const req = getReq(major, entryTerm);
        const fields = progressAllocationFields(view, layer);
        if (!major || !requirementRecordIsValid(major, req)) {
            return { available: false, major, entryTerm, req, fields, totals: {}, records: new Map(), isEligible };
        }

        const catalog = isDM ? this.doubleMajorCourseData : this.primaryCourseData;
        const lookup = (code, data) => catalogRecordFor(data || catalog, code)
            || customRecordFor(major, code);
        const chronological = sortedProgressSemesters();
        // Keep projected allocation monotonic from the student's perspective:
        // earned courses claim pools first, followed by current, future, and
        // unverified courses. Within each state, retain chronological/course
        // order. This prevents a planned course from visually displacing credit
        // that has already been earned while preserving the normal cascade.
        const stateOrder = [
            COURSE_PROGRESS_STATES.EARNED,
            COURSE_PROGRESS_STATES.CURRENT,
            COURSE_PROGRESS_STATES.FUTURE,
            COURSE_PROGRESS_STATES.UNVERIFIED,
            COURSE_PROGRESS_STATES.UNSUCCESSFUL,
        ];
        const sorted = [];
        for (let s = 0; s < stateOrder.length; s++) {
            const wanted = stateOrder[s];
            for (let i = 0; i < chronological.length; i++) {
                const source = chronological[i];
                const courses = (source.courses || []).filter((course) => {
                    const state = typeof stateOf === 'function'
                        ? stateOf(course, source) : courseProgressState(course, source);
                    return state === wanted;
                });
                if (courses.length) sorted.push({ _progressSource: source, courses });
            }
        }
        const semesterByCourse = new Map();
        const records = new Map();

        for (let i = 0; i < this.semesters.length; i++) {
            const sem = this.semesters[i];
            Object.values(fields.total).forEach((name) => { sem[name] = 0; });
            Object.values(fields.metric).forEach((name) => { sem[name] = 0; });
            const courses = sem.courses || [];
            for (let j = 0; j < courses.length; j++) {
                const course = courses[j];
                if (!course) continue;
                semesterByCourse.set(course, sem);
                course[fields.effective] = 'none';
                delete course[fields.category];
                course[fields.languageLevel] = '';
                course[fields.exclusionReason] = '';

                // Named-pool selection reads credit metadata before the main
                // cascade. Seed it from this program's catalog first.
                const info = lookup(course.code, catalog);
                if (info) {
                    course.SU_credit = (typeof parseCreditValue === 'function')
                        ? parseCreditValue(info.SU_credit || '0')
                        : (parseFloat(info.SU_credit || '0') || 0);
                    course.Basic_Science = parseFloat(info.Basic_Science || '0') || 0;
                    course.Engineering = parseFloat(info.Engineering || '0') || 0;
                    course.ECTS = parseFloat(info.ECTS || '0') || 0;
                    course.Faculty_Course = info.Faculty_Course || course.Faculty_Course || 'No';
                    course.Faculty = info.Faculty || course.Faculty || '';
                    course[fields.languageLevel] = normalizedLanguageLevel(info.Language_Level);
                }
            }
        }

        const eligible = (course, sem) => !!course
            && isEligible(course, sem || semesterByCourse.get(course));
        const hasEligible = (code) => hasDegreeEligibleCourse(this.semesters, code, eligible);
        const reqs = { required: req.required || 0, core: req.core || 0, area: req.area || 0 };
        const counters = { required: 0, core: 0, area: 0 };
        const basicLanguageLimit = languageCapForRequirements(req);
        let basicLanguagesCounted = 0;
        const forceCSCore = major === 'IE' && hasEligible('CS201') && hasEligible('DSA201');
        const alternatives = resolveAlternativeRules(
            major, entryTerm, sorted, this.semesters, lookup, catalog,
            hasEligible, req.groups, eligible,
            (course, sem) => stateOrder.indexOf(
                typeof stateOf === 'function'
                    ? stateOf(course, sem || semesterByCourse.get(course))
                    : courseProgressState(course, sem || semesterByCourse.get(course)),
            ),
        );

        for (let i = 0; i < sorted.length; i++) {
            const semView = sorted[i];
            const sem = semView._progressSource || semView;
            const courses = semView.courses || [];
            for (let j = 0; j < courses.length; j++) {
                const course = courses[j];
                if (!eligible(course, sem) || alternatives.excluded.has(course)) continue;

                let info = lookup(course.code, catalog);
                if (!info && !isDM) {
                    // A course known only to the double-major catalog contributes
                    // inherent credit/ECTS to the shared degree total, but must
                    // not inherit the double major's category in the main pass.
                    const fallback = catalogRecordFor(this.doubleMajorCourseData, course.code);
                    const credit = fallback
                        ? ((typeof parseCreditValue === 'function')
                            ? parseCreditValue(fallback.SU_credit || '0')
                            : (parseFloat(fallback.SU_credit || '0') || 0))
                        : creditOfCourse(course);
                    const science = parseFloat((fallback && fallback.Basic_Science) || course.Basic_Science || '0') || 0;
                    const engineering = parseFloat((fallback && fallback.Engineering) || course.Engineering || '0') || 0;
                    const ects = parseFloat((fallback && fallback.ECTS) || course.ECTS || '0') || 0;
                    course.SU_credit = credit;
                    course.Basic_Science = science;
                    course.Engineering = engineering;
                    course.ECTS = ects;
                    course.Faculty_Course = (fallback && fallback.Faculty_Course) || course.Faculty_Course || 'No';
                    course.Faculty = (fallback && fallback.Faculty) || course.Faculty || '';
                    addProgressMetric(sem, fields, 'total', credit);
                    addProgressMetric(sem, fields, 'science', science);
                    addProgressMetric(sem, fields, 'engineering', engineering);
                    addProgressMetric(sem, fields, 'ects', ects);
                    records.set(course, { effective: 'none', category: '', credit,
                        science, engineering, ects, countsTotal: true });
                    continue;
                }
                if (!info) continue;

                let staticType = String(info.EL_Type || '').toLowerCase();
                if (alternatives.typeOverride.has(course)) {
                    staticType = alternatives.typeOverride.get(course);
                }
                course[fields.languageLevel] = normalizedLanguageLevel(info.Language_Level);
                if (languageCourseNeedsLevelReview(course, info)) {
                    course[fields.exclusionReason] = LANGUAGE_LEVEL_REVIEW_REASON;
                    continue;
                }
                if (staticType === 'unknown') continue;

                const credit = (typeof parseCreditValue === 'function')
                    ? parseCreditValue(info.SU_credit || '0')
                    : (parseFloat(info.SU_credit || '0') || 0);
                const science = parseFloat(info.Basic_Science || '0') || 0;
                const engineering = parseFloat(info.Engineering || '0') || 0;
                const ects = parseFloat(info.ECTS || '0') || 0;
                course.SU_credit = credit;
                course.Basic_Science = science;
                course.Engineering = engineering;
                course.ECTS = ects;
                course.Faculty_Course = info.Faculty_Course || 'No';
                course.Faculty = info.Faculty || '';
                if (staticType) {
                    course[fields.category] = staticType.charAt(0).toUpperCase() + staticType.slice(1);
                }

                const pinCore = alternatives.forceCore.has(course)
                    || (forceCSCore && course.code === 'CS201');
                const effective = allocateCascade(staticType, credit, counters, reqs, pinCore);
                if (effective === 'free' && basicLanguageLimit !== null
                    && isBasicLanguageCourse(course, info)) {
                    if (basicLanguagesCounted >= basicLanguageLimit) {
                        course[fields.effective] = 'none';
                        course[fields.exclusionReason] = BASIC_LANGUAGE_EXCLUSION_REASON;
                        records.set(course, { effective: 'none', category: staticType,
                            credit, science, engineering, ects, countsTotal: false,
                            reason: BASIC_LANGUAGE_EXCLUSION_REASON });
                        continue;
                    }
                    basicLanguagesCounted++;
                }
                course[fields.effective] = effective || 'none';
                const totalField = fields.total[effective];
                if (totalField) sem[totalField] += credit;
                // The DM's generic degree totals are shared with the main plan;
                // its own pass owns only category allocation.
                if (!isDM) {
                    addProgressMetric(sem, fields, 'total', credit);
                    addProgressMetric(sem, fields, 'science', science);
                    addProgressMetric(sem, fields, 'engineering', engineering);
                    addProgressMetric(sem, fields, 'ects', ects);
                }
                records.set(course, { effective: effective || 'none', category: staticType,
                    credit, science, engineering, ects, countsTotal: !isDM });
            }
        }

        if (major === 'MAN') {
            applyManDiversity(sorted, this.semesters, fields, req.core || 0, req.area || 0);
        }

        const totals = {
            area: 0, core: 0, free: 0, university: 0, required: 0,
            total: 0, science: 0, engineering: 0, ects: 0,
        };
        for (let i = 0; i < this.semesters.length; i++) {
            const sem = this.semesters[i];
            Object.keys(fields.total).forEach((key) => { totals[key] += sem[fields.total[key]] || 0; });
            Object.keys(fields.metric).forEach((key) => { totals[key] += sem[fields.metric[key]] || 0; });
        }
        records.forEach((record, course) => { record.effective = course[fields.effective] || 'none'; });
        return { available: true, major, entryTerm, req, fields, totals, records, isEligible };
    };

    const actualProgressGpa = (explicitCurrentTermCode) => calculateGpaForMembership(
        this.semesters,
        () => true,
        explicitCurrentTermCode,
        false,
    );

    const programGpaForSnapshot = (snapshot, explicitCurrentTermCode, includeEstimates) => {
        if (!snapshot || !snapshot.available || !(snapshot.records instanceof Map)) {
            return {
                value: NaN, credits: 0, points: 0, resolved: false, unresolved: true,
                issues: [{ code: 'PROGRAM_REQUIREMENTS_UNAVAILABLE', courseCode: '', grade: '' }],
                complete: false, missingCredits: 0, missingCourses: [],
                projected: includeEstimates === true, available: false,
            };
        }
        const result = calculateGpaForMembership(
            this.semesters,
            (course) => {
                const record = snapshot.records.get(course);
                return !!record && isProgramEffectiveType(record.effective);
            },
            explicitCurrentTermCode,
            includeEstimates === true,
        );
        return { ...result, available: true, program: snapshot.major };
    };

    const programMembershipSnapshot = (view, explicitCurrentTermCode) => {
        const programView = view === 'dm' ? 'dm' : 'main';
        const currentTerm = currentProgressTermCode(explicitCurrentTermCode);
        const stateOf = (course, sem) => courseProgressState(course, sem, currentTerm);
        return runProgressAllocation(
            programView,
            'program_gpa',
            (course) => courseCanHaveProgramGpaMembership(course),
            stateOf,
        );
    };

    // Public, allocation-independent access to the same actual-GPA policy used
    // by Summary and graduation progress. Keeping this separate prevents
    // compatibility callers from rebuilding GPA out of raw semester caches.
    this.getActualGpa = function(explicitCurrentTermCode) {
        return actualProgressGpa(explicitCurrentTermCode);
    };

    this.getEarnedSuCredits = function(explicitCurrentTermCode) {
        return calculateEarnedSuCredits(this.semesters, explicitCurrentTermCode);
    };

    this.getEstimatedClassLevel = function(explicitCurrentTermCode) {
        return estimatedClassLevelForEarnedCredits(
            this.getEarnedSuCredits(explicitCurrentTermCode),
        );
    };

    // Program GPA uses the program-specific effective allocation. Its private
    // membership pass can classify an F/letter-basis NA without awarding the
    // course any degree credit or changing the planner's visible allocation.
    this.getProgramGpa = function(view, explicitCurrentTermCode, includeEstimates) {
        const snapshot = programMembershipSnapshot(view, explicitCurrentTermCode);
        return programGpaForSnapshot(snapshot, explicitCurrentTermCode, includeEstimates === true);
    };

    this.calculateGpaForMembership = function(isMember, explicitCurrentTermCode, includeEstimates) {
        return calculateGpaForMembership(
            this.semesters,
            isMember,
            explicitCurrentTermCode,
            includeEstimates === true,
        );
    };

    this.isProgramGpaCandidate = function(course) {
        return courseCanHaveProgramGpaMembership(course);
    };

    // Candidate-impact simulation is a pure domain responsibility. This
    // constructor supplies the current curriculum and catalog boundaries while
    // the extracted module owns the Smart Sort classification algorithm.
    const candidateImpactModule = (typeof SurriculumModules !== 'undefined')
        ? SurriculumModules.suggestionCandidateImpact : null;
    if (!candidateImpactModule || typeof candidateImpactModule.create !== 'function') {
        throw new Error(
            'scripts/domain/suggestion-candidate-impact.js must load before s_curriculum.js',
        );
    }
    const candidateImpactCalculator = candidateImpactModule.create({
        normalizeCourseCode,
        canonicalCourseCode,
        normalizedLanguageLevel,
        parseCreditValue: (typeof parseCreditValue === 'function')
            ? parseCreditValue
            : (value) => parseFloat(value || '0') || 0,
        resolveAlternativeRules,
        allocateCascade,
        applyManDiversity,
        groupProgressFor,
        hum200Level: HUM_200_LEVEL,
        hum300Level: HUM_300_LEVEL,
        humAnyLevel: HUM_ANY_LEVEL,
    });
    const progressSnapshotModule = (typeof SurriculumModules !== 'undefined')
        ? SurriculumModules.suggestionProgressSnapshot : null;
    if (!progressSnapshotModule || typeof progressSnapshotModule.create !== 'function') {
        throw new Error(
            'scripts/domain/suggestion-progress-snapshot.js must load before s_curriculum.js',
        );
    }
    const progressBeforeTermSnapshots = progressSnapshotModule.create({
        normalizeProgressTermCode,
        isDegreeEligibleCourse,
        semesterProgressTermCode,
        canonicalCourseCode,
        groupProgressFor,
        facultyProgress,
        programUnionGenericRecords,
        totalsForGenericRecords,
        getChronologicalSemesters: () => sortedProgressSemesters(),
        lookupCatalogRecord: (major, catalog, code, data) =>
            catalogRecordFor(data || catalog, code) || customRecordFor(major, code),
        candidateImpactCalculator,
        earnedState: COURSE_PROGRESS_STATES.EARNED,
    });
    const recalculationModule = (typeof SurriculumModules !== 'undefined')
        ? SurriculumModules.curriculumRecalculation : null;
    if (!recalculationModule || typeof recalculationModule.create !== 'function') {
        throw new Error(
            'scripts/domain/curriculum-recalculation.js must load before s_curriculum.js',
        );
    }
    const recalculationController = recalculationModule.create({
        getRequirement: getReq,
        isValidRequirement: requirementRecordIsValid,
        resolveGetInfo: () => ((typeof getInfo === 'function') ? getInfo
            : ((typeof window !== 'undefined' && typeof window.getInfo === 'function')
                ? window.getInfo : null)),
        compareSemesters: compareCurriculumSemesterTerms,
        resolveAlternativeRules,
        languageCapForRequirements,
        normalizedLanguageLevel,
        languageCourseNeedsLevelReview,
        isBasicLanguageCourse,
        allocateCascade,
        applyManDiversity,
        parseCreditValue: (value) => ((typeof parseCreditValue === 'function')
            ? parseCreditValue(value) : (parseFloat(value || '0') || 0)),
        lookupCustomRecord: allocationCustomRecordFor,
        recomputePrimaryCreditSplit: (curriculum) =>
            recomputeSemesterPrimaryCreditSplit(curriculum),
        notifyAllocationUpdated,
        mainFields: MAIN_FIELDS,
        doubleMajorFields: DM_FIELDS,
        basicLanguageExclusionReason: BASIC_LANGUAGE_EXCLUSION_REASON,
        languageLevelReviewReason: LANGUAGE_LEVEL_REVIEW_REASON,
    });
    // Smart Sort's term-scoped snapshot assembly is delegated to the focused
    // domain orchestrator. Keep these methods as stable compatibility entry points.
    this.getProgramProgressBeforeTermViews = function(targetTermCode, options) {
        return progressBeforeTermSnapshots.buildViews({
            curriculum: this,
            runProgressAllocation,
        }, targetTermCode, options);
    };

    this.getProgramProgressBeforeTerm = function(view, targetTermCode) {
        return progressBeforeTermSnapshots.selectView(
            this.getProgramProgressBeforeTermViews(targetTermCode),
            view,
        );
    };

    const evaluateProgressAllocation = (view, snapshot, requireGpa, explicitCurrentTermCode, averages) => {
        if (!snapshot || !snapshot.available) return REQUIREMENTS_UNAVAILABLE_FLAG;
        const req = snapshot.req || {};
        const totals = snapshot.totals || {};
        const isDM = view === 'dm';
        const totalReq = (req.total || 0) + (isDM ? 30 : 0);
        const ectsReq = (req.ects || 0) + (isDM ? 60 : 0);
        if ((totals.university || 0) < (req.university || 0)) return 1;
        if (req.internshipCourse
            && !hasDegreeEligibleCourse(this.semesters, req.internshipCourse, snapshot.isEligible)) return 4;
        if ((totals.total || 0) < totalReq) return 5;
        if ((totals.science || 0) < (req.science || 0)) return 8;
        if ((totals.engineering || 0) < (req.engineering || 0)) return 9;
        if ((totals.ects || 0) < ectsReq) return 10;
        if ((totals.required || 0) < (req.required || 0)) return 2;
        if ((totals.core || 0) < (req.core || 0)) return 3;
        if ((totals.area || 0) < (req.area || 0)) return 6;
        if ((totals.free || 0) < (req.free || 0)) return 7;

        const averageSet = averages || {};
        const gpa = averageSet.cgpa || actualProgressGpa(explicitCurrentTermCode);
        const pgpa = averageSet.pgpa || { value: NaN, credits: 0, resolved: false };
        const mainPgpa = averageSet.mainPgpa || pgpa;
        const threshold = Number(averageSet.threshold) || (isDM ? 3.20 : 2.00);
        if (!gpa.resolved) return 38;
        if (requireGpa && !gpa.credits) return 38;
        if (gpa.credits && gpa.value < threshold) return 38;
        if (!pgpa.resolved) return 41;
        if (requireGpa && !pgpa.credits) return 41;
        if (pgpa.credits && pgpa.value < threshold) return 41;
        if (isDM) {
            if (!mainPgpa.resolved) return 41;
            if (requireGpa && !mainPgpa.credits) return 41;
            if (mainPgpa.credits && mainPgpa.value < threshold) return 41;
        }
        const ctx = { curr: this, semesters: this.semesters, fields: snapshot.fields,
            entryTerm: snapshot.entryTerm, isEligible: snapshot.isEligible };
        return evaluateRules(ctx, graduationRulesFor(snapshot.major, req));
    };

    this.getCourseProgressState = function(course, semester, explicitCurrentTermCode) {
        return courseProgressState(course, semester, explicitCurrentTermCode);
    };

    this.getGraduationProgress = function(view, explicitCurrentTermCode) {
        const programView = view === 'dm' ? 'dm' : 'main';
        const currentTerm = currentProgressTermCode(explicitCurrentTermCode);
        const stateOf = (course, sem) => courseProgressState(course, sem, currentTerm);
        const predicates = {
            earned: (course, sem) => stateOf(course, sem) === COURSE_PROGRESS_STATES.EARNED,
            current: (course, sem) => {
                const s = stateOf(course, sem);
                return s === COURSE_PROGRESS_STATES.EARNED || s === COURSE_PROGRESS_STATES.CURRENT;
            },
            future: (course, sem) => {
                const s = stateOf(course, sem);
                return s === COURSE_PROGRESS_STATES.EARNED || s === COURSE_PROGRESS_STATES.CURRENT
                    || s === COURSE_PROGRESS_STATES.FUTURE;
            },
            projected: (course, sem) => stateOf(course, sem) !== COURSE_PROGRESS_STATES.UNSUCCESSFUL,
            programGpa: (course) => courseCanHaveProgramGpaMembership(course),
        };
        const layers = {};
        const layerNames = ['earned', 'current', 'future', 'projected', 'programGpa'];
        for (let i = 0; i < layerNames.length; i++) {
            const layer = layerNames[i];
            const mainSnapshot = runProgressAllocation('main', layer, predicates[layer], stateOf);
            const programSnapshot = programView === 'dm'
                ? runProgressAllocation('dm', layer, predicates[layer], stateOf) : mainSnapshot;
            layers[layer] = progressBeforeTermSnapshots.combine(
                programView, programSnapshot, mainSnapshot,
            );
        }

        const metricKeys = ['total', 'ects', 'university', 'required', 'core', 'area', 'free', 'science', 'engineering'];
        const breakdown = {};
        for (let i = 0; i < metricKeys.length; i++) {
            breakdown[metricKeys[i]] = { earned: 0, current: 0, future: 0, unverified: 0, projected: 0 };
        }
        const semesterByCourse = new Map();
        for (let i = 0; i < this.semesters.length; i++) {
            const sem = this.semesters[i];
            (sem.courses || []).forEach((course) => { if (course) semesterByCourse.set(course, sem); });
        }
        const addBreakdown = (metric, course, amount) => {
            if (!breakdown[metric]) return;
            const state = stateOf(course, semesterByCourse.get(course));
            if (!Object.prototype.hasOwnProperty.call(breakdown[metric], state)) return;
            const n = Number(amount || 0);
            if (!isFinite(n) || n <= 0) return;
            breakdown[metric][state] += n;
        };

        // Attribute visible segments under the final projected allocation. The
        // earned and projected completion flags still come from their exact,
        // independent passes; attribution from one pass keeps every displayed
        // segment non-negative and guarantees that the equation adds up.
        layers.projected.records.forEach((record, course) => {
            const category = String(record.effective || '').toLowerCase();
            if (['university', 'required', 'core', 'area', 'free'].includes(category)) {
                addBreakdown(category, course, record.credit);
            }
        });
        layers.projected.genericRecords.forEach((record, course) => {
            if (!record.countsTotal) return;
            addBreakdown('total', course, record.credit);
            addBreakdown('ects', course, record.ects);
            addBreakdown('science', course, record.science);
            addBreakdown('engineering', course, record.engineering);
        });
        for (let i = 0; i < metricKeys.length; i++) {
            const b = breakdown[metricKeys[i]];
            b.projected = b.earned + b.current + b.future + b.unverified;
        }

        const cgpa = actualProgressGpa(currentTerm);
        const pgpa = programGpaForSnapshot(layers.programGpa, currentTerm, false);
        const projectedPgpa = programGpaForSnapshot(layers.programGpa, currentTerm, true);
        let mainPgpa = pgpa;
        let projectedMainPgpa = projectedPgpa;
        if (programView === 'dm') {
            const mainMembership = {
                ...layers.programGpa,
                major: this.major,
                records: layers.programGpa.mainProgramRecords || new Map(),
            };
            mainPgpa = programGpaForSnapshot(mainMembership, currentTerm, false);
            projectedMainPgpa = programGpaForSnapshot(mainMembership, currentTerm, true);
        }
        const averageThreshold = programView === 'dm'
            ? doubleMajorAverageThreshold(this.entryTerm) : 2.00;
        const averages = { cgpa, pgpa, mainPgpa, threshold: averageThreshold };
        const earnedFlag = evaluateProgressAllocation(
            programView, layers.earned, true, currentTerm, averages,
        );
        const projectedFlag = evaluateProgressAllocation(
            programView, layers.projected, false, currentTerm, averages,
        );
        const available = earnedFlag !== REQUIREMENTS_UNAVAILABLE_FLAG
            && projectedFlag !== REQUIREMENTS_UNAVAILABLE_FLAG;
        const status = !available ? 'unavailable'
            : (earnedFlag === 0 ? 'complete' : (projectedFlag === 0 ? 'projected' : 'incomplete'));
        const estimatedClassLevel = this.getEstimatedClassLevel(currentTerm);
        const earnedSuCredits = estimatedClassLevel.earnedCredits;
        const courseStates = [];
        for (let i = 0; i < this.semesters.length; i++) {
            const sem = this.semesters[i];
            const courses = sem.courses || [];
            for (let j = 0; j < courses.length; j++) {
                const course = courses[j];
                const record = layers.projected.records.get(course);
                const pgpaRecord = layers.programGpa.records.get(course);
                courseStates.push({ course, semester: sem, state: stateOf(course, sem),
                    effective: record ? record.effective : 'none',
                    pgpaEffective: pgpaRecord ? pgpaRecord.effective : 'none' });
            }
        }
        return { view: programView, status, available, earnedFlag, projectedFlag,
            breakdown, layers, courseStates, gpa: cgpa, cgpa, pgpa, projectedPgpa,
            mainPgpa, projectedMainPgpa, averageThreshold,
            earnedSuCredits, estimatedClassLevel,
            averageChecks: {
                cgpa: cgpa.resolved && cgpa.credits > 0 && cgpa.value >= averageThreshold,
                pgpa: pgpa.resolved && pgpa.credits > 0 && pgpa.value >= averageThreshold,
                mainPgpa: mainPgpa.resolved && mainPgpa.credits > 0
                    && mainPgpa.value >= averageThreshold,
            },
            currentTerm };
    };

    this.canGraduateEarned = function() {
        return this.getGraduationProgress('main').earnedFlag;
    };

    this.canGraduateDoubleEarned = function() {
        return this.getGraduationProgress('dm').earnedFlag;
    };

    this.getSemester = function(id)
    {
        for(let i = 0; i < this.semesters.length; i++)
        {
            if(this.semesters[i].id == id)
            {
                return this.semesters[i];
            }
        }
        try {
            console.warn('Semester not found:', id);
        } catch (_) {}
        return null;
    };
    this.deleteSemester = function(id)
    {
        let removed = false;
        for(let i = 0; i < this.semesters.length; i++)
        {
            if(this.semesters[i].id == id)
            {
                this.semesters.splice(i,1);
                removed = true;
                break;
            }
        }
        if (removed) {
            try {
                const storage = (typeof window !== 'undefined') ? window.planStorage : null;
                if (storage && typeof storage.requestSave === 'function') storage.requestSave();
            } catch (_) {}
        }
    }
    this.hasCourse = function(course)
    {
        // Structural presence intentionally remains separate from degree-plan
        // eligibility. The planner uses this method for duplicate prevention.
        const target = canonicalCourseCode(course);
        for(let i = 0; i < this.semesters.length; i++)
        {
            for(let a = 0; a < this.semesters[i].courses.length; a++)
            {
                if(canonicalCourseCode(this.semesters[i].courses[a].code) === target)
                {return true;}
            }
        }
        return false;
    }
    // Tally the student's FACULTY COURSES by pool. `Faculty_Course` is the
    // faculty-course pool marker (only ~10% of courses carry one) — NOT the
    // offering faculty, which is `Faculty`. Conflating the two caused the MAN
    // and DSA bugs, so the distinction is deliberate here.
    //
    // Courses excluded from every pool (effective_type 'none' — a failed course,
    // or a math alternative SUIS drops) count toward nothing, including this.
    //
    // New code should use this rather than hand-rolling the loop: the same tally
    // is currently written out 22 times across the major blocks, and the copies
    // have already drifted (CS skips excluded courses; BIO does not).
    // Thin wrappers over the shared module-level tallies. `fields` selects the
    // pass (MAIN_FIELDS / DM_FIELDS); default is the main major.
    this.countFacultyCourses = function(fields) {
        return tallyFacultyCourses(this.semesters, fields && fields.effective);
    }
    this.countFacultyAreas = function(fields) {
        return tallyFacultyAreas(this.semesters, fields && fields.effective);
    }
    // True when ANY of `codes` is present. For "one of the following" rules.
    this.hasAnyCourse = function(codes) {
        for (let i = 0; i < codes.length; i++) {
            if (this.hasCourse(codes[i])) return true;
        }
        return false;
    }
    // Degree-plan eligibility is grade-based and shared by allocation,
    // graduation, double-major, minor and summary calculations. A failed
    // attempt can therefore remain visible/present without satisfying a rule.
    this.isDegreeEligibleCourse = function(course) {
        return isDegreeEligibleCourse(course);
    }
    this.hasDegreeEligibleCourse = function(code) {
        return hasDegreeEligibleCourse(this.semesters, code);
    }
    this.hasAnyDegreeEligibleCourse = function(codes) {
        return hasAnyDegreeEligibleCourse(this.semesters, codes);
    }

    // Per-requirement-group progress for the Summary panel (Phase 4). Returns an
    // ordered list of progress rows for the given pass ('dm' → double major, else
    // the main major) — the same groups graduationRulesFor evaluates, measured as
    // current/target so the UI can show "Core I: 6/9 SU". Empty for programs with
    // no requirement-groups data. Reads the effective types the allocation set, so
    // call it after recalcEffectiveTypes(Double).
    this.requirementGroupProgress = function(view, mode, options) {
        let progressMode = mode;
        let progressOptions = options;
        // Backward-compatible shorthand: requirementGroupProgress(view,
        // { beforeTermCode }) leaves the existing earned/projected mode slot
        // available while making term-scoped callers concise.
        if (mode && typeof mode === 'object') {
            progressOptions = mode;
            progressMode = '';
        }
        const isDM = view === 'dm';
        const major = isDM ? this.doubleMajor : this.major;
        if (!major) return [];
        const term = isDM ? this.entryTermDM : this.entryTerm;
        const req = getReq(major, term) || {};
        if (!requirementRecordIsValid(major, req)) return [];
        const hasBeforeTermCode = !!(progressOptions && typeof progressOptions === 'object'
            && Object.prototype.hasOwnProperty.call(progressOptions, 'beforeTermCode'));
        const beforeTermCode = hasBeforeTermCode
            ? normalizeProgressTermCode(progressOptions.beforeTermCode) : '';
        // A caller explicitly requesting scoped progress must never receive
        // whole-plan rows because the supplied destination was malformed.
        if (hasBeforeTermCode && !beforeTermCode) return [];
        if (beforeTermCode) {
            const scoped = this.getProgramProgressBeforeTerm(view, beforeTermCode);
            return scoped && Array.isArray(scoped.groupRows) ? scoped.groupRows : [];
        }
        let fields = isDM ? DM_FIELDS : MAIN_FIELDS;
        let isEligible;
        if (progressMode === 'earned' || progressMode === 'projected') {
            const progress = this.getGraduationProgress(isDM ? 'dm' : 'main');
            const snapshot = progress.layers[progressMode];
            if (!snapshot || !snapshot.available) return [];
            fields = snapshot.fields;
            isEligible = snapshot.isEligible;
        }
        const ctx = { curr: this, semesters: this.semesters, fields, entryTerm: term, isEligible };
        if (req.groups) return groupProgressFor(ctx, req.groups, req.facultyReq);
        if (req.facultyReq) return facultyProgress(ctx, req.facultyReq);
        return [];
    };

    this.canGraduate = function()
    {
        const req = getReq(this.major, this.entryTerm);
        if (!requirementRecordIsValid(this.major, req)) return REQUIREMENTS_UNAVAILABLE_FLAG;

        let area = 0;
        let core = 0;
        let free = 0;
        let university = 0;
        let required = 0;
        let total = 0;
        let science = 0;
        let engineering = 0;
        let ects = 0;

        for(let i = 0; i < this.semesters.length; i++)
        {
            total = total + this.semesters[i].totalCredit;
            area = area + this.semesters[i].totalArea;
            core = core + this.semesters[i].totalCore;
            free = free + this.semesters[i].totalFree;
            university = university + this.semesters[i].totalUniversity;
            required = required + this.semesters[i].totalRequired;
            science += this.semesters[i].totalScience;
            engineering += this.semesters[i].totalEngineering;
            ects += this.semesters[i].totalECTS;
        }
        // Generic requirement checks
        if (university < req.university) return 1;
        if (req.internshipCourse && !this.hasDegreeEligibleCourse(req.internshipCourse)) return 4;
        if (total < req.total) return 5;
        if (science < req.science) return 8;
        if (engineering < req.engineering) return 9;
        if (ects < req.ects) return 10;
        if (required < req.required) return 2;
        // Check core, area and free credits against requirements directly.
        // Do not perform dynamic reallocation here because the effective
        // categories have already been computed via recalcEffectiveTypes().
        // Flag codes must align with graduation-flag-messages.js:
        // 3=core, 6=area, 7=free, 8=science.
        if (core < req.core) return 3;
        if (area < req.area) return 6;
        if (free < req.free) return 7;
        // GPA check for graduation
        const gpaThresholdMainMajor = 2.00;
        const gpa = this.getActualGpa();
        if (!gpa.resolved || (gpa.credits && gpa.value < gpaThresholdMainMajor)) return 38;
        const pgpa = this.getProgramGpa('main');
        if (!pgpa.resolved || (pgpa.credits && pgpa.value < gpaThresholdMainMajor)) return 41;
        // SPS 303, the HUM requirement and the per-major requirements are DATA
        // -- see the requirement engine -- evaluated in order, first unmet wins. The same
        // table drives the double-major pass (canGraduateDouble) via DM_FIELDS.
        const ctx = { curr: this, semesters: this.semesters, fields: MAIN_FIELDS, entryTerm: this.entryTerm };
        return evaluateRules(ctx, graduationRulesFor(this.major, req));
    }

    // Stable public entry points. The extracted controller owns the shared
    // chronological traversal and mutates these live semester/course objects
    // synchronously before it publishes the allocation update.
    this.recalcEffectiveTypes = function(course_data) {
        return recalculationController.recalculateMain(this, course_data);
    };

    this.recalcEffectiveTypesDouble = function(course_data_dm, options) {
        return recalculationController.recalculateDoubleMajor(this, course_data_dm, options);
    };

    /**
     * Determine if the student can graduate from the selected double major.
     * This function mirrors canGraduate() but applies the double major
     * thresholds (SU credits +30, ECTS +60) and uses the double major
     * effective category totals (CoreDM, AreaDM, FreeDM) for core/area/free
     * checks. Major-specific logic is preserved to ensure that special
     * requirements (e.g., internships, faculty course counts) remain in
     * effect for the double major.
     *
     * Returns 0 if the student can graduate; otherwise returns a code
     * corresponding to the missing requirement. Codes align with those in
     * canGraduate().
     */
    this.getCombinedDegreeMetrics = function() {
        return combinedDegreeMetricsFromAllocations(this.semesters);
    };

    this.canGraduateDouble = function() {
        if (!this.doubleMajor) return 0;
        const req = getReq(this.doubleMajor, this.entryTermDM);
        if (!requirementRecordIsValid(this.doubleMajor, req)) return REQUIREMENTS_UNAVAILABLE_FLAG;

        // Accumulate totals for the double major
        let area = 0;
        let core = 0;
        let free = 0;
        let university = 0;
        let required = 0;
        const combinedMetrics = combinedDegreeMetricsFromAllocations(this.semesters);
        const total = combinedMetrics.total;
        const science = combinedMetrics.science;
        const engineering = combinedMetrics.engineering;
        const ects = combinedMetrics.ects;
        for (let i = 0; i < this.semesters.length; i++) {
            const sem = this.semesters[i];
            area += (sem.totalAreaDM || 0);
            core += (sem.totalCoreDM || 0);
            free += (sem.totalFreeDM || 0);
            // Use DM-specific university/required totals if available, otherwise
            // fall back to the primary totals.  This ensures courses that are
            // classified as university or required in the second major are
            // properly counted even when absent in the primary major.
            university += (sem.totalUniversityDM !== undefined ? sem.totalUniversityDM : sem.totalUniversity);
            required += (sem.totalRequiredDM !== undefined ? sem.totalRequiredDM : sem.totalRequired);
        }
        // Fetch requirements for double major and adjust SU/ECTS thresholds
        const totalReq = (req.total || 0) + 30;
        const ectsReq = (req.ects || 0) + 60;
        // Generic checks
        if (university < (req.university || 0)) return 1;
        if (req.internshipCourse && !this.hasDegreeEligibleCourse(req.internshipCourse)) return 4;
        if (total < totalReq) return 5;
        if (science < (req.science || 0)) return 8;
        if (engineering < (req.engineering || 0)) return 9;
        if (ects < ectsReq) return 10;
        if (required < (req.required || 0)) return 2;
        // Core/area/free requirements. Flag codes mirror graduation-flag-messages.js
        // where 3=core, 6=area, 7=free and 8=science.
        if (core < (req.core || 0)) return 3;
        if (area < (req.area || 0)) return 6;
        if (free < (req.free || 0)) return 7;
        // GPA check for graduation
        const gpaThresholdDoubleMajor = doubleMajorAverageThreshold(this.entryTerm);
        const gpa = this.getActualGpa();
        if (!gpa.resolved || (gpa.credits && gpa.value < gpaThresholdDoubleMajor)) return 38;
        const mainPgpa = this.getProgramGpa('main');
        const dmPgpa = this.getProgramGpa('dm');
        if (!mainPgpa.resolved || !dmPgpa.resolved
            || (mainPgpa.credits && mainPgpa.value < gpaThresholdDoubleMajor)
            || (dmPgpa.credits && dmPgpa.value < gpaThresholdDoubleMajor)) return 41;
        // Per-major requirements are the SAME data the main pass uses (see
        // requirement engine), evaluated here against the double-major allocation via
        // DM_FIELDS. This is what makes the double major enforce EXACTLY the
        // program requirements -- closing the drift where the DM branches had
        // grown their own incomplete copies (non-CS missing SPS303/HUM, EE with
        // no faculty check, ECON without MATH212).
        const ctx = { curr: this, semesters: this.semesters, fields: DM_FIELDS, entryTerm: this.entryTermDM };
        return evaluateRules(ctx, graduationRulesFor(this.doubleMajor, req));
    };

    // end of s_curriculum constructor
}

