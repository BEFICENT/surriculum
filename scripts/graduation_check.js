// Remove ES module imports. Instead, rely on global functions and objects
// that are attached to the `window` (e.g., buildFlagMessages and
// requirements). This is necessary when running under the file:// scheme
// where ES module imports may not be available.

function courseCountsTowardDegreePlan(curriculum, course, semester) {
    try {
        if (curriculum && typeof curriculum.getCourseProgressState === 'function' && semester) {
            return curriculum.getCourseProgressState(course, semester) !== 'unsuccessful';
        }
        if (curriculum && typeof curriculum.isDegreeEligibleCourse === 'function') {
            return curriculum.isDegreeEligibleCourse(course);
        }
        if (typeof window !== 'undefined' && window.gradePolicy
            && typeof window.gradePolicy.evaluateGrade === 'function') {
            const outcome = window.gradePolicy.evaluateGrade(
                course && course.grade,
                course && course.gradingBasis,
            );
            return !!(outcome.supported && (outcome.earnsCredit || outcome.pending));
        }
        const elem = document.getElementById(course && course.id);
        const grade = elem ? elem.querySelector('.grade') : null;
        const value = String(grade ? grade.textContent : '').trim().toUpperCase();
        return ['', 'REGISTERED', 'P', 'I', 'S', 'T',
            'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D'].includes(value);
    } catch (_) {
        return false;
    }
}

// Compute how taken courses are allocated for a minor, including the
// "overflow" behavior (Core → Area → Free) and equivalence rules.
function computeMinorAllocation(curriculum, minorCode, options) {
    const opts = options || {};
    const computeCgpa = () => {
        if (opts.progressGpa && typeof opts.progressGpa === 'object') {
            return {
                cgpa: Number(opts.progressGpa.value),
                credits: Number(opts.progressGpa.credits) || 0,
                resolved: opts.progressGpa.resolved !== false,
                issues: Array.isArray(opts.progressGpa.issues) ? opts.progressGpa.issues : [],
            };
        }
        // The current app always has a term-aware actual-GPA source. Prefer it
        // even when it has zero credits; falling through in that case would let
        // manually entered future grades masquerade as CGPA.
        if (curriculum && typeof curriculum.getActualGpa === 'function') {
            try {
                const gpa = curriculum.getActualGpa();
                return { cgpa: Number(gpa.value), credits: Number(gpa.credits) || 0,
                    resolved: gpa.resolved !== false,
                    issues: Array.isArray(gpa.issues) ? gpa.issues : [] };
            } catch (_) {}
        }
        if (curriculum && typeof curriculum.getGraduationProgress === 'function') {
            try {
                const progress = curriculum.getGraduationProgress('main');
                const gpa = progress && progress.gpa ? progress.gpa : {};
                return { cgpa: Number(gpa.value), credits: Number(gpa.credits) || 0,
                    resolved: gpa.resolved !== false,
                    issues: Array.isArray(gpa.issues) ? gpa.issues : [] };
            } catch (_) {}
        }
        let gpaCredits = 0;
        let gpaValue = 0.0;
        try {
            for (let i = 0; i < curriculum.semesters.length; i++) {
                const sem = curriculum.semesters[i];
                gpaCredits += (sem && sem.totalGPACredits) ? sem.totalGPACredits : 0;
                gpaValue += (sem && sem.totalGPA) ? sem.totalGPA : 0;
            }
        } catch (_) {}
        if (!gpaCredits) return { cgpa: NaN, credits: 0, resolved: true, issues: [] };
        const cgpa = gpaValue / gpaCredits;
        return { cgpa, credits: gpaCredits, resolved: true, issues: [] };
    };

    const gpaThresholdForMinor = (code) => {
        // Exception: Entrepreneurship minor requires 2.50 CGPA.
        if (String(code || '').toUpperCase() === 'ENTREP-MINOR') return 2.50;
        return 2.72;
    };

    const termCode = (() => {
        try {
            const map = curriculum && curriculum.minorTermsByCode ? curriculum.minorTermsByCode : {};
            const t = map && map[minorCode] ? String(map[minorCode]) : '';
            if (t) return t;
        } catch (_) {}
        try {
            return curriculum && curriculum.entryTermMinor ? String(curriculum.entryTermMinor) : '';
        } catch (_) {
            return '';
        }
    })();

    const reqMap = (() => {
        try {
            if (typeof window !== 'undefined' && typeof window.loadMinorRequirementsForTerm === 'function') {
                const m = window.loadMinorRequirementsForTerm(termCode);
                if (m && typeof m === 'object') return m;
            }
        } catch (_) {}
        return (typeof window !== 'undefined' && window.minorRequirements) ? window.minorRequirements : {};
    })();
    const req = reqMap ? reqMap[minorCode] : null;
    const dataByCode = curriculum && curriculum.minorCourseDataByCode ? curriculum.minorCourseDataByCode : {};
    const courseData = dataByCode ? dataByCode[minorCode] : null;
    const catalogCodesByMinor = curriculum && curriculum.minorCatalogCodeSetsByCode
        ? curriculum.minorCatalogCodeSetsByCode : {};
    const officialCatalogCodes = catalogCodesByMinor && catalogCodesByMinor[minorCode] instanceof Set
        ? catalogCodesByMinor[minorCode] : null;

    const parseInt0 = (v) => {
        const n = parseInt(v || '0', 10);
        return isNaN(n) ? 0 : n;
    };
    const parseCredit0 = (v) => {
        try {
            if (typeof parseCreditValue === 'function') return parseCreditValue(v);
        } catch (_) {}
        const n = Number.parseFloat(v || '0');
        return Number.isFinite(n) ? n : 0;
    };
    const normalizeCode = (v) => String(v || '').toUpperCase().replace(/\s+/g, '');

    if (!req || !Array.isArray(courseData)) {
        return { ok: false, title: minorCode, error: 'Missing minor data files.' };
    }

    // Collect passed/planned courses (ignore grade F).
    const taken = new Set();
    const progressStateByCode = new Map();
    try {
        for (let i = 0; i < curriculum.semesters.length; i++) {
            const sem = curriculum.semesters[i];
            for (let j = 0; j < sem.courses.length; j++) {
                const c = sem.courses[j];
                if (!c || !c.code) continue;
                if (typeof opts.isEligible === 'function') {
                    if (!opts.isEligible(c, sem)) continue;
                } else if (!courseCountsTowardDegreePlan(curriculum, c, sem)) continue;
                const normalized = normalizeCode(c.code);
                taken.add(normalized);
                if (curriculum && typeof curriculum.getCourseProgressState === 'function') {
                    progressStateByCode.set(normalized, curriculum.getCourseProgressState(c, sem));
                }
            }
        }
    } catch (_) {}

    const categories = req.categories || {};
    const fullOrder = ['required', 'core', 'area', 'free'];
    const nextInOrder = (cat) => {
        const idx = fullOrder.indexOf(cat);
        return idx >= 0 && idx < fullOrder.length - 1 ? fullOrder[idx + 1] : null;
    };

    // Course metadata + pools
    const courseByCode = new Map();
    const pools = { required: [], core: [], area: [], free: [], university: [] };
    for (let i = 0; i < courseData.length; i++) {
        const c = courseData[i];
        const code = normalizeCode((c.Major || '') + (c.Code || ''));
        if (!code) continue;
        const baseCat = String(c.EL_Type || '').toLowerCase();
        courseByCode.set(code, { ...c, __code: code, __baseCat: baseCat });
        if (pools[baseCat]) pools[baseCat].push(code);
    }

    // Equivalence lookup per category.
    const eqGroupLookup = {};
    for (const catKey of fullOrder) {
        const cfg = categories[catKey] || {};
        const eq = Array.isArray(cfg.equivalents) ? cfg.equivalents : [];
        const lookup = new Map();
        for (let i = 0; i < eq.length; i++) {
            const group = Array.isArray(eq[i]) ? eq[i] : [];
            for (let j = 0; j < group.length; j++) {
                lookup.set(normalizeCode(group[j]), i);
            }
        }
        eqGroupLookup[catKey] = lookup;
    }

    const totals = {
        required: { courses: 0, credits: 0 },
        core: { courses: 0, credits: 0 },
        area: { courses: 0, credits: 0 },
        free: { courses: 0, credits: 0 },
    };
    const usedEqGroup = {
        required: new Set(),
        core: new Set(),
        area: new Set(),
        free: new Set(),
    };

    const needsMet = (cat) => {
        const cfg = categories[cat] || {};
        const needC = parseInt0(cfg.minCourses);
        const needS = parseInt0(cfg.minSU);
        if (!needC && !needS) return false; // do not auto-overflow categories with no requirements
        const have = totals[cat] || { courses: 0, credits: 0 };
        return (have.courses >= needC) && (have.credits >= needS);
    };

    const canCountEquivalenceIn = (cat, code) => {
        const lookup = eqGroupLookup[cat];
        if (!lookup) return true;
        const groupId = lookup.get(code);
        if (groupId === undefined) return true;
        return !usedEqGroup[cat].has(groupId);
    };
    const markEquivalenceUsed = (cat, code) => {
        const lookup = eqGroupLookup[cat];
        if (!lookup) return;
        const groupId = lookup.get(code);
        if (groupId === undefined) return;
        usedEqGroup[cat].add(groupId);
    };

    // Build list of taken minor courses (only those present in this minor).
    const takenMinorCourses = [];
    for (const code of taken) {
        const rec = courseByCode.get(code);
        if (!rec) continue;
        // A stored overlay may deliberately classify a course as N/A (none or
        // unknown). Do not silently turn that fail-closed choice into minor free
        // credit. Minor requirements currently allocate only these four pools.
        if (!fullOrder.includes(rec.__baseCat)) continue;
        const baseCat = rec.__baseCat;
        const credit = parseCredit0(rec.SU_credit);
        takenMinorCourses.push({ code, baseCat, credit,
            progressState: progressStateByCode.get(code) || 'earned' });
    }
    const catSortIdx = (cat) => {
        const idx = fullOrder.indexOf(cat);
        return idx === -1 ? 999 : idx;
    };
    takenMinorCourses.sort((a, b) => {
        const stateRank = { earned: 0, current: 1, future: 2, unverified: 3 };
        const as = Object.prototype.hasOwnProperty.call(stateRank, a.progressState) ? stateRank[a.progressState] : 4;
        const bs = Object.prototype.hasOwnProperty.call(stateRank, b.progressState) ? stateRank[b.progressState] : 4;
        if (as !== bs) return as - bs;
        const ai = catSortIdx(a.baseCat);
        const bi = catSortIdx(b.baseCat);
        if (ai !== bi) return ai - bi;
        return String(a.code).localeCompare(String(b.code));
    });

    const allocationByCode = {};
    for (let i = 0; i < takenMinorCourses.length; i++) {
        const c = takenMinorCourses[i];
        let cat = c.baseCat;
        while (cat) {
            if (!canCountEquivalenceIn(cat, c.code)) {
                cat = nextInOrder(cat);
                continue;
            }
            const next = nextInOrder(cat);
            if (next && needsMet(cat)) {
                cat = next;
                continue;
            }
            totals[cat].courses += 1;
            totals[cat].credits += c.credit;
            markEquivalenceUsed(cat, c.code);
            allocationByCode[c.code] = { allocatedCat: cat, baseCat: c.baseCat,
                movedDown: cat !== c.baseCat, credit: c.credit,
                progressState: c.progressState };
            break;
        }
    }

    // Validate completion.
    let allOk = true;
    const perCatOk = {};
    for (const catKey of fullOrder) {
        const cfg = categories[catKey] || {};
        const needC = parseInt0(cfg.minCourses);
        const needS = parseInt0(cfg.minSU);
        const have = totals[catKey];
        let ok = true;
        if (needC) ok = ok && (have.courses >= needC);
        if (needS) ok = ok && (have.credits >= needS);
        if (catKey === 'required' && cfg.allListedRequired) {
            const eq = Array.isArray(cfg.equivalents) ? cfg.equivalents : [];
            const eqFlat = new Set(eq.flat().map(x => normalizeCode(x)));
            // `allListedRequired` names the university's official required
            // list. A user-added Required overlay may satisfy generic count/SU
            // minima, but it must not make itself a newly mandatory named
            // course. Older injected/test data without an official-code set
            // retains the historical behavior.
            const poolCodes = (pools.required || []).filter((code) =>
                !officialCatalogCodes || officialCatalogCodes.has(code)
            );
            for (let i = 0; i < poolCodes.length; i++) {
                const code = poolCodes[i];
                if (eqFlat.has(code)) continue;
                if (!taken.has(code)) ok = false;
            }
            for (let i = 0; i < eq.length; i++) {
                const group = Array.isArray(eq[i]) ? eq[i].map(x => normalizeCode(x)) : [];
                if (group.length && !group.some(c => taken.has(c))) ok = false;
            }
        }
        perCatOk[catKey] = ok;
        if ((categories[catKey] && typeof categories[catKey] === 'object') && !ok) allOk = false;
    }

    const totalCourses = totals.required.courses + totals.core.courses + totals.area.courses + totals.free.courses;
    const totalCredits = totals.required.credits + totals.core.credits + totals.area.credits + totals.free.credits;
    const minAllC = parseInt0(req.minCourses);
    const minAllS = parseInt0(req.minSU);
    if (minAllC && totalCourses < minAllC) allOk = false;
    if (minAllS && totalCredits < minAllS) allOk = false;
    if (!Object.keys(categories).length) allOk = false;

    // Build a classification-only allocation for PGPA membership. Unlike the
    // completion allocation above, this pass admits an F/letter-basis NA so a
    // failed in-program course can contribute zero points over its SU credits
    // without earning credit. Successful/planned courses sort ahead of failures,
    // so a failure cannot displace a fulfilled equivalence or elective slot.
    let pgpaResult = {
        value: NaN, credits: 0, points: 0, resolved: false, unresolved: true,
        issues: [], complete: false, missingCredits: 0, missingCourses: [],
        projected: false,
    };
    let projectedPgpaResult = { ...pgpaResult, projected: true };
    let membershipAllocationByCode = allocationByCode;
    if (opts.calculateProgramGpa !== false) {
        const candidate = (course) => {
            try {
                if (curriculum && typeof curriculum.isProgramGpaCandidate === 'function') {
                    return curriculum.isProgramGpaCandidate(course);
                }
                const policy = (typeof window !== 'undefined') ? window.gradePolicy : null;
                if (policy && typeof policy.evaluateGrade === 'function') {
                    const outcome = policy.evaluateGrade(course && course.grade, course && course.gradingBasis);
                    return !!(outcome.earnsCredit || outcome.pending || outcome.countsInGpa || outcome.needsReview);
                }
            } catch (_) {}
            return true;
        };
        const membership = computeMinorAllocation(curriculum, minorCode, {
            ...opts,
            calculateProgramGpa: false,
            isEligible: candidate,
        });
        membershipAllocationByCode = (membership && membership.allocationByCode) || {};
        const isMember = (course) => {
            const record = membershipAllocationByCode[normalizeCode(course && course.code)];
            return !!record && ['required', 'core', 'area', 'free', 'university']
                .includes(String(record.allocatedCat || '').toLowerCase());
        };
        if (curriculum && typeof curriculum.calculateGpaForMembership === 'function') {
            pgpaResult = curriculum.calculateGpaForMembership(isMember, undefined, false);
            projectedPgpaResult = curriculum.calculateGpaForMembership(isMember, undefined, true);
        }
    }

    // Minor certificates require both the overall CGPA and this minor's PGPA.
    const gpaResult = computeCgpa();
    const { cgpa } = gpaResult;
    const gpaThreshold = gpaThresholdForMinor(minorCode);
    const cgpaOk = gpaResult.resolved !== false && isFinite(cgpa) && cgpa >= gpaThreshold;
    const pgpa = Number(pgpaResult.value);
    const pgpaOk = opts.calculateProgramGpa === false
        ? true
        : pgpaResult.resolved !== false && pgpaResult.credits > 0
            && isFinite(pgpa) && pgpa >= gpaThreshold;
    if (!cgpaOk || !pgpaOk) allOk = false;

    return {
        ok: allOk,
        title: req.name || minorCode,
        req,
        categories,
        totals,
        perCatOk,
        pools,
        courseByCode,
        allocationByCode,
        membershipAllocationByCode,
        termCode,
        cgpa,
        gpaResolved: gpaResult.resolved !== false,
        gpaIssues: gpaResult.issues,
        gpaThreshold,
        gpaOk: cgpaOk,
        cgpaOk,
        pgpa,
        pgpaCredits: Number(pgpaResult.credits) || 0,
        pgpaResolved: pgpaResult.resolved !== false,
        pgpaIssues: Array.isArray(pgpaResult.issues) ? pgpaResult.issues : [],
        pgpaOk,
        projectedPgpa: projectedPgpaResult,
        averagesOk: cgpaOk && pgpaOk,
    };
}

// Display graduation check results in a modal
function displayGraduationResults(curriculum) {
    if(!document.querySelector('.graduation_modal')) {
        const overlay = document.createElement("div");
        overlay.classList.add('graduation_modal_overlay');
        const modal = document.createElement("div");
        modal.classList.add('graduation_modal');
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        const esc = (value) => {
            try {
                if (typeof escapeHtml === 'function') return escapeHtml(value);
            } catch (_) {}
            return String(value ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        };

        const renderMetaList = (items) => {
            const rows = Array.isArray(items) ? items.filter(Boolean) : [];
            if (!rows.length) return '';
            return `<div class="graduation_meta_list">${rows.map((item) => {
                const tone = item && item.tone ? ` graduation_meta_item--${esc(item.tone)}` : '';
                return `<div class="graduation_meta_item${tone}">${item.html ? item.html : esc(item.text || '')}</div>`;
            }).join('')}</div>`;
        };

        const renderStatusCard = ({ label, title, state = 'incomplete', message, details, compact = false }) => {
            const normalizedState = ['complete', 'projected', 'unavailable'].includes(state) ? state : 'incomplete';
            const stateClass = 'is-' + normalizedState;
            const badgeText = normalizedState === 'complete' ? 'Complete'
                : (normalizedState === 'projected' ? 'Projected complete'
                    : (normalizedState === 'unavailable' ? 'Unavailable' : 'Incomplete'));
            const cardClass = compact ? ' graduation_card--compact' : '';
            const messageClass = ` graduation_card_message--${normalizedState}`;
            const messageHtml = message
                ? `<div class="graduation_card_message${messageClass}">${esc(message)}</div>`
                : '';
            return `
                <div class="graduation_card ${stateClass}${cardClass}">
                    <div class="graduation_card_head">
                        <div class="graduation_card_title_wrap">
                            <div class="graduation_card_label">${esc(label)}</div>
                            <div class="graduation_card_title">${esc(title)}</div>
                        </div>
                        <div class="graduation_status_badge ${stateClass}">${badgeText}</div>
                    </div>
                    ${messageHtml}
                    ${renderMetaList(details)}
                </div>
            `;
        };

        const majorCards = [];
        const requirementsUnavailableFlag = (typeof globalThis !== 'undefined' && globalThis.REQUIREMENTS_UNAVAILABLE_FLAG)
            ? globalThis.REQUIREMENTS_UNAVAILABLE_FLAG
            : 99;
        const progressMain = (typeof curriculum.getGraduationProgress === 'function')
            ? curriculum.getGraduationProgress('main') : null;
        const flagMain = progressMain ? progressMain.projectedFlag : curriculum.canGraduate();
        const msgMain = buildFlagMessages(curriculum.major) || {};
        const mainState = progressMain ? progressMain.status
            : (flagMain === requirementsUnavailableFlag ? 'unavailable' : (flagMain === 0 ? 'complete' : 'incomplete'));
        const mainMsg = mainState === 'complete'
            ? 'All earned graduation checks pass.'
            : (mainState === 'projected'
                ? 'Your current plan satisfies the graduation requirements; some credit is not earned yet.'
            : ((msgMain[flagMain] ? msgMain[flagMain]() : `Error code ${flagMain}`) || 'Graduation requirements are incomplete.'));
        const progressDetails = (progress) => {
            if (!progress || !progress.breakdown || !progress.breakdown.total) return [];
            const b = progress.breakdown.total;
            const parts = [`${b.earned} earned`];
            if (b.current) parts.push(`${b.current} current`);
            if (b.future) parts.push(`${b.future} future`);
            if (b.unverified) parts.push(`${b.unverified} needs grade verification`);
            const details = [{ text: `SU credits: ${parts.join(' + ')} = ${b.projected} projected`, tone: 'muted' }];
            const standing = progress.estimatedClassLevel;
            if (progress.view === 'main' && standing && standing.label) {
                const earned = Number(standing.earnedCredits) || 0;
                const earnedText = Math.abs(earned - Math.round(earned)) < 1e-9
                    ? String(Math.round(earned)) : earned.toFixed(1);
                details.push({
                    text: `Estimated class level: ${standing.label} (${earnedText} earned SU overall; based on the undergraduate 34/64/94-credit thresholds; unfinished current-term, future, needs-grade, and unsuccessful courses excluded).`,
                    tone: 'muted',
                });
            }
            const threshold = Number(progress.averageThreshold) || (progress.view === 'dm' ? 3.20 : 2.00);
            const pushAverage = (label, result) => {
                const value = result && Number(result.value);
                const resolved = result && result.resolved !== false;
                const hasValue = result && Number(result.credits) > 0 && isFinite(value);
                if (!resolved) {
                    const codes = (result.issues || []).map((issue) => issue.courseCode).filter(Boolean);
                    details.push({ text: `${label} needs review${codes.length ? ` (${codes.join(', ')})` : ''}.`, tone: 'danger' });
                    return;
                }
                if (!hasValue) {
                    details.push({ text: `${label}: N/A (required ≥ ${threshold.toFixed(2)})`, tone: 'danger' });
                    return;
                }
                details.push({
                    text: `${label}: ${value.toFixed(3)} (required ≥ ${threshold.toFixed(2)})`,
                    tone: value >= threshold ? 'success' : 'danger',
                });
            };
            pushAverage('CGPA', progress.gpa);
            if (progress.view === 'dm') pushAverage('Main PGPA', progress.mainPgpa);
            pushAverage(progress.view === 'dm' ? 'Double-major PGPA' : 'PGPA', progress.pgpa);
            const projectedPgpa = progress.projectedPgpa;
            if (projectedPgpa && (Number(projectedPgpa.credits) > 0 || Number(projectedPgpa.missingCredits) > 0)) {
                const projectedValue = Number(projectedPgpa.value);
                const valueText = isFinite(projectedValue) ? projectedValue.toFixed(3) : 'N/A';
                const missing = Number(projectedPgpa.missingCredits) || 0;
                details.push({
                    text: `Projected PGPA from entered grades: ${valueText}${missing ? ` • ${missing} SU still need a grade estimate` : ''}`,
                    tone: 'muted',
                });
            }
            return details;
        };
        majorCards.push(renderStatusCard({
            label: 'Major',
            title: curriculum.major,
            state: mainState,
            message: mainMsg,
            details: progressDetails(progressMain),
        }));

        if (curriculum.doubleMajor) {
            const progressDM = (typeof curriculum.getGraduationProgress === 'function')
                ? curriculum.getGraduationProgress('dm') : null;
            const flagDM = progressDM ? progressDM.projectedFlag : curriculum.canGraduateDouble();
            const msgDM = buildFlagMessages(curriculum.doubleMajor) || {};
            const dmState = progressDM ? progressDM.status
                : (flagDM === requirementsUnavailableFlag ? 'unavailable' : (flagDM === 0 ? 'complete' : 'incomplete'));
            const dmMsg = dmState === 'complete'
                ? 'All earned graduation checks pass.'
                : (dmState === 'projected'
                    ? 'Your current plan satisfies the double-major requirements; some credit is not earned yet.'
                : ((msgDM[flagDM] ? msgDM[flagDM]() : `Error code ${flagDM}`) || 'Graduation requirements are incomplete.'));
            majorCards.push(renderStatusCard({
                label: 'Double Major',
                title: curriculum.doubleMajor,
                state: dmState,
                message: dmMsg,
                details: progressDetails(progressDM),
            }));
        }

        // Show minor completion status (does not affect major graduation).
        function evaluateMinor(minorCode) {
            const stateOf = (course, sem) => (typeof curriculum.getCourseProgressState === 'function')
                ? curriculum.getCourseProgressState(course, sem) : (courseCountsTowardDegreePlan(curriculum, course) ? 'earned' : 'unsuccessful');
            const earned = computeMinorAllocation(curriculum, minorCode, {
                progressGpa: progressMain && progressMain.gpa,
                isEligible: (course, sem) => stateOf(course, sem) === 'earned',
            });
            const projected = computeMinorAllocation(curriculum, minorCode, {
                progressGpa: progressMain && progressMain.gpa,
                isEligible: (course, sem) => stateOf(course, sem) !== 'unsuccessful',
            });
            const res = projected;
            if (res.error) return { state: 'unavailable', title: minorCode, message: 'Minor data is unavailable.', details: [{ text: res.error, tone: 'danger' }] };

            const req = res.req || {};
            const cats = req.categories || {};
            const order = ['required', 'core', 'area', 'free'];
            const missing = [];
            for (const cat of order) {
                if (!cats[cat]) continue;
                if (res.perCatOk && res.perCatOk[cat] === false) {
                    missing.push(cat.toUpperCase());
                }
            }

            const details = [];
            if (missing.length) {
                details.push({ text: `Missing pools: ${missing.join(', ')}`, tone: 'danger' });
            }
            try {
                const thr = (String(minorCode || '').toUpperCase() === 'ENTREP-MINOR') ? 2.50 : 2.72;
                if (res.gpaResolved === false) {
                    details.push({ text: 'CGPA is unavailable until the unresolved grade basis is reviewed.', tone: 'danger' });
                } else if (isFinite(res.cgpa)) {
                    const cgpaStr = Number(res.cgpa).toFixed(3);
                    if (res.gpaOk === false) {
                        details.push({ text: `CGPA: ${cgpaStr} (required ≥ ${thr.toFixed(2)})`, tone: 'danger' });
                    }
                } else {
                    details.push({ text: `CGPA requirement: ≥ ${thr.toFixed(2)}`, tone: 'danger' });
                }
                if (res.pgpaResolved === false) {
                    details.push({ text: 'Minor PGPA is unavailable until the program-course grades are reviewed.', tone: 'danger' });
                } else if (isFinite(res.pgpa)) {
                    const pgpaStr = Number(res.pgpa).toFixed(3);
                    details.push({
                        text: `Minor PGPA: ${pgpaStr} (required ≥ ${thr.toFixed(2)})`,
                        tone: res.pgpaOk === false ? 'danger' : 'success',
                    });
                } else {
                    details.push({ text: `Minor PGPA requirement: ≥ ${thr.toFixed(2)}`, tone: 'danger' });
                }
                const estimate = res.projectedPgpa;
                if (estimate) {
                    const value = Number(estimate.value);
                    const missing = Number(estimate.missingCredits) || 0;
                    const differs = Number(estimate.credits) !== Number(res.pgpaCredits || 0);
                    if (differs || missing) {
                        details.push({
                            text: `Projected minor PGPA from entered grades: ${isFinite(value) ? value.toFixed(3) : 'N/A'}${missing ? ` • ${missing} SU still need a grade estimate` : ''}`,
                            tone: 'muted',
                        });
                    }
                }
            } catch (_) {}
            return {
                state: earned.ok ? 'complete' : (projected.ok ? 'projected' : 'incomplete'),
                title: res.title || minorCode,
                message: earned.ok ? 'Earned minor requirements are satisfied.'
                    : (projected.ok ? 'The planned courses satisfy the minor requirements.' : 'Minor requirements are not yet satisfied.'),
                details,
            };
        }

        let html = '<div class="graduation_layout">';
        html += '<div class="graduation_section">';
        html += '<div class="graduation_section_title">Programs</div>';
        html += '<div class="graduation_card_list">' + majorCards.join('') + '</div>';
        html += '</div>';

        if (Array.isArray(curriculum.minors) && curriculum.minors.length) {
            const minorCards = curriculum.minors
                .filter(Boolean)
                .map((minorCode) => {
                    const res = evaluateMinor(minorCode);
                    return renderStatusCard({
                        label: 'Minor',
                        title: res.title || minorCode,
                        state: res.state,
                        message: res.message || '',
                        details: res.details || [],
                        compact: true,
                    });
                });
            html += '<div class="graduation_section">';
            html += '<div class="graduation_section_title">Minors</div>';
            html += '<div class="graduation_card_list graduation_card_list--compact">' + minorCards.join('') + '</div>';
            html += '</div>';
        }
        html += '</div>';
        modal.innerHTML = html;
    }
}

// Function to display summary of credits
function displaySummary(curriculum, major_chosen_by_user) {
    // Do not create more than one set of summary modals. If any exist, abort.
    if (document.querySelector('.summary_modal')) return;

    const esc = (value) => {
        try {
            if (typeof escapeHtml === 'function') return escapeHtml(value);
        } catch (_) {}
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    };

    const isMobileSummaryAdapter = !!(document.body && document.body.classList.contains('is-mobile'));
    const previouslyFocused = document.activeElement instanceof HTMLElement
        ? document.activeElement : null;

    // Ensure the shared overlay exists.
    let overlayEl = document.querySelector('.summary_modal_overlay');
    if (!overlayEl) {
        overlayEl = document.createElement('div');
        overlayEl.classList.add('summary_modal_overlay');
        document.body.appendChild(overlayEl);
    }
    overlayEl.setAttribute('role', 'dialog');
    overlayEl.setAttribute('aria-modal', 'true');
    overlayEl.setAttribute('aria-labelledby', 'summary-program-progress-title');

    // Build a stable layout container so we can place minor controls close to
    // the major summary cards and switch between views.
    let contentEl = overlayEl.querySelector('.summary_overlay_content');
    if (!contentEl) {
        contentEl = document.createElement('div');
        contentEl.className = 'summary_overlay_content';
        overlayEl.appendChild(contentEl);
    } else {
        contentEl.innerHTML = '';
    }

    let summaryKeydownHandler = null;
    let summaryResizeHandler = null;
    let summaryClosed = false;
    const closeSummary = () => {
        if (summaryClosed) return;
        summaryClosed = true;
        try {
            if (summaryKeydownHandler) {
                document.removeEventListener('keydown', summaryKeydownHandler, true);
            }
            if (summaryResizeHandler) {
                window.removeEventListener('resize', summaryResizeHandler);
            }
        } catch (_) {}
        try { overlayEl.remove(); } catch (_) {}
        try {
            if (!isMobileSummaryAdapter) {
                const mobileFallback = document.body && document.body.classList.contains('is-mobile')
                    ? document.querySelector('.m-nav-item[aria-current="page"]') : null;
                const restoreTarget = mobileFallback || previouslyFocused;
                if (restoreTarget && restoreTarget.isConnected) {
                    restoreTarget.focus({ preventScroll: true });
                }
            }
        } catch (_) {}
    };
    overlayEl._closeSummary = closeSummary;

    const headerRowEl = document.createElement('div');
    headerRowEl.className = 'summary_header_row';
    contentEl.appendChild(headerRowEl);

    const headerCopyEl = document.createElement('div');
    headerCopyEl.className = 'summary_surface_header_copy';
    const overviewTitleEl = document.createElement('h2');
    overviewTitleEl.id = 'summary-program-progress-title';
    overviewTitleEl.className = 'summary_surface_title';
    overviewTitleEl.textContent = 'Program progress';
    const overviewSubtitleEl = document.createElement('p');
    overviewSubtitleEl.className = 'summary_surface_subtitle';
    overviewSubtitleEl.textContent = 'Earned and projected progress for selected programs.';
    headerCopyEl.appendChild(overviewTitleEl);
    headerCopyEl.appendChild(overviewSubtitleEl);
    headerRowEl.appendChild(headerCopyEl);

    const closeButtonEl = document.createElement('button');
    closeButtonEl.type = 'button';
    closeButtonEl.className = 'summary_surface_close';
    closeButtonEl.setAttribute('aria-label', 'Close program progress');
    closeButtonEl.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
    closeButtonEl.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        closeSummary();
    });
    headerRowEl.appendChild(closeButtonEl);

    const programTabsEl = document.createElement('div');
    programTabsEl.className = 'summary_program_tabs';
    programTabsEl.setAttribute('role', 'tablist');
    programTabsEl.setAttribute('aria-label', 'Selected programs');
    contentEl.appendChild(programTabsEl);

    const cardsRowEl = document.createElement('div');
    cardsRowEl.className = 'summary_cards_row summary_scroll_region';
    cardsRowEl.tabIndex = 0;
    cardsRowEl.setAttribute('role', 'region');
    cardsRowEl.setAttribute('aria-label', 'Program progress overview');
    cardsRowEl.dataset.summaryScrollRegion = 'overview';
    contentEl.appendChild(cardsRowEl);

    const degreeSectionEl = document.createElement('section');
    degreeSectionEl.className = 'summary_program_section is-degree';
    const degreeSectionTitleEl = document.createElement('h3');
    degreeSectionTitleEl.className = 'summary_program_section_title';
    degreeSectionTitleEl.textContent = 'Degree programs';
    const degreeGridEl = document.createElement('div');
    degreeGridEl.className = 'summary_program_grid summary_degree_grid';
    degreeSectionEl.appendChild(degreeSectionTitleEl);
    degreeSectionEl.appendChild(degreeGridEl);
    cardsRowEl.appendChild(degreeSectionEl);

    const minorSectionEl = document.createElement('section');
    minorSectionEl.className = 'summary_program_section is-minor is-hidden';
    const minorSectionTitleEl = document.createElement('h3');
    minorSectionTitleEl.className = 'summary_program_section_title';
    minorSectionTitleEl.textContent = 'Minors';
    const minorGridEl = document.createElement('div');
    minorGridEl.className = 'summary_program_grid summary_minor_grid';
    minorSectionEl.appendChild(minorSectionTitleEl);
    minorSectionEl.appendChild(minorGridEl);
    cardsRowEl.appendChild(minorSectionEl);

    const programTabRecords = [];
    let activeProgramKey = '';
    const programKey = (kind, code) => `${String(kind || '').toLowerCase()}:${String(code || '').toUpperCase()}`;
    const focusProgramAnchor = (record) => {
        if (!record || isMobileSummaryAdapter) return;
        const target = contentEl.classList.contains('is-multiple')
            ? record.tab : record.card.querySelector('.summary_modal_title');
        if (!target) return;
        if (target !== record.tab) target.tabIndex = -1;
        try {
            target.focus({ preventScroll: true });
            target.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'nearest' });
        } catch (_) {}
    };
    const activateProgramCard = (kind, code, options = {}) => {
        const key = programKey(kind, code);
        const record = programTabRecords.find((candidate) => candidate.key === key);
        if (!record) return false;
        activeProgramKey = key;
        contentEl.dataset.activeProgramKind = record.kind;
        contentEl.dataset.activeProgramCode = record.code;
        programTabRecords.forEach((candidate) => {
            const active = candidate === record;
            candidate.card.classList.toggle('is-active', active);
            candidate.card.setAttribute('aria-hidden', active ? 'false' : 'true');
            candidate.tab.classList.toggle('is-active', active);
            candidate.tab.setAttribute('aria-selected', active ? 'true' : 'false');
            candidate.tab.tabIndex = active ? 0 : -1;
        });
        if (!isMobileSummaryAdapter) {
            try { cardsRowEl.scrollTo({ top: 0, behavior: 'auto' }); } catch (_) { cardsRowEl.scrollTop = 0; }
        }
        if (options.focus) {
            focusProgramAnchor(record);
        }
        return true;
    };

    const registerProgramTab = (card, kind, code, title, titleId) => {
        const normalizedKind = String(kind || 'program').toLowerCase();
        const normalizedCode = String(code || '').toUpperCase();
        const key = programKey(normalizedKind, normalizedCode);
        const index = programTabRecords.length;
        const tabId = `summary-program-tab-${index + 1}`;
        const panelId = `summary-program-panel-${index + 1}`;
        const tab = document.createElement('button');
        tab.type = 'button';
        tab.id = tabId;
        tab.className = 'summary_program_tab';
        tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-controls', panelId);
        tab.setAttribute('aria-selected', 'false');
        tab.tabIndex = -1;
        tab.dataset.programKind = normalizedKind;
        tab.dataset.programCode = normalizedCode;
        const roleText = normalizedKind === 'main' ? 'Main major'
            : normalizedKind === 'dm' ? 'Double major' : 'Minor';
        tab.innerHTML = `
            <span class="summary_program_tab_role">${esc(roleText)}</span>
            <span class="summary_program_tab_identity">
                <strong>${esc(normalizedCode)}</strong>
                <span>${esc(title || normalizedCode)}</span>
            </span>
            <span class="summary_program_tab_status" aria-hidden="true"></span>`;
        card.id = panelId;
        card.setAttribute('role', 'tabpanel');
        card.setAttribute('aria-labelledby', tabId);
        card.setAttribute('aria-hidden', 'true');
        card.dataset.summaryTitleId = titleId;
        const record = { key, kind: normalizedKind, code: normalizedCode,
            title: String(title || normalizedCode), roleText, card, tab,
            overviewPanelId: panelId };
        programTabRecords.push(record);
        programTabsEl.appendChild(tab);
        tab.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (contentEl.dataset.summaryView === 'detail') showOverview();
            activateProgramCard(normalizedKind, normalizedCode, { focus: true });
        });
        tab.addEventListener('keydown', (event) => {
            const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
            if (!keys.includes(event.key)) return;
            event.preventDefault();
            event.stopPropagation();
            let nextIndex = index;
            if (event.key === 'Home') nextIndex = 0;
            else if (event.key === 'End') nextIndex = programTabRecords.length - 1;
            else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index - 1 + programTabRecords.length) % programTabRecords.length;
            else nextIndex = (index + 1) % programTabRecords.length;
            const next = programTabRecords[nextIndex];
            if (next) {
                if (contentEl.dataset.summaryView === 'detail') showOverview();
                activateProgramCard(next.kind, next.code, { focus: true });
            }
        });
        if (!activeProgramKey) activateProgramCard(normalizedKind, normalizedCode);
    };

    const updateProgramSurfaceState = () => {
        const cards = contentEl.querySelectorAll('.summary_program_card');
        const count = cards.length;
        contentEl.dataset.programCount = String(count);
        contentEl.classList.toggle('is-multiple', count > 1);
        programTabsEl.classList.toggle('is-single', count <= 1);
        programTabsEl.setAttribute('aria-hidden', count > 1 ? 'false' : 'true');
        programTabsEl.setAttribute('aria-orientation', count > 1
            && window.matchMedia('(min-width: 1180px) and (min-height: 620px)').matches
            ? 'vertical' : 'horizontal');
        degreeGridEl.classList.toggle('is-multiple', degreeGridEl.children.length > 1);
        minorGridEl.dataset.cardCount = String(minorGridEl.children.length);
        programTabRecords.forEach((record) => {
            if (count <= 1) {
                record.tab.tabIndex = -1;
                record.card.setAttribute('role', 'region');
                record.card.setAttribute('aria-labelledby', record.card.dataset.summaryTitleId || record.tab.id);
            } else {
                record.card.setAttribute('role', 'tabpanel');
                record.card.setAttribute('aria-labelledby', record.tab.id);
            }
            const status = String(record.card.dataset.summaryStatus || 'in-progress');
            const statusEl = record.tab.querySelector('.summary_program_tab_status');
            if (!statusEl) return;
            statusEl.className = `summary_program_tab_status is-${status}`;
            statusEl.textContent = status === 'complete' ? 'Complete'
                : status === 'projected' ? 'Projected'
                    : status === 'unavailable' ? 'Unavailable' : 'In progress';
            record.tab.setAttribute('aria-label', `${record.roleText}: ${record.code}, ${record.title}. ${statusEl.textContent}.`);
        });
        overviewSubtitleEl.textContent = count > 1
            ? `Earned and projected progress across ${count} selected programs.`
            : 'Earned and projected progress for your selected program.';
    };

    const minorPanelEl = document.createElement('div');
    minorPanelEl.className = 'summary_minor_panel summary_scroll_region is-hidden';
    minorPanelEl.dataset.summaryScrollRegion = 'minor-detail';
    contentEl.appendChild(minorPanelEl);

    const majorPanelEl = document.createElement('div');
    majorPanelEl.className = 'summary_major_panel summary_scroll_region is-hidden';
    majorPanelEl.dataset.summaryScrollRegion = 'major-detail';
    contentEl.appendChild(majorPanelEl);

    const activeProgramRecord = () => programTabRecords.find((record) => record.key === activeProgramKey) || null;
    const connectActiveTabToDetail = (panelEl) => {
        const record = activeProgramRecord();
        if (!record || !panelEl) return;
        minorPanelEl.removeAttribute('role');
        minorPanelEl.removeAttribute('aria-labelledby');
        majorPanelEl.removeAttribute('role');
        majorPanelEl.removeAttribute('aria-labelledby');
        panelEl.id = panelEl === majorPanelEl ? 'summary-major-detail-panel' : 'summary-minor-detail-panel';
        if (contentEl.classList.contains('is-multiple')) {
            panelEl.setAttribute('role', 'tabpanel');
            panelEl.setAttribute('aria-labelledby', record.tab.id);
            record.tab.setAttribute('aria-controls', panelEl.id);
        } else {
            const title = panelEl.querySelector('.summary_minor_panel_title');
            if (title) {
                title.id = `${panelEl.id}-title`;
                panelEl.setAttribute('aria-labelledby', title.id);
            }
            panelEl.setAttribute('role', 'region');
        }
    };
    const focusDetailBackButton = (panelEl) => {
        if (isMobileSummaryAdapter || !panelEl) return;
        setTimeout(() => {
            try {
                const back = panelEl.querySelector('.summary_back_btn');
                if (back && back.getClientRects().length) back.focus({ preventScroll: true });
            } catch (_) {}
        }, 0);
    };
    let detailSectionSequence = 0;
    const wireDetailSectionNavigation = (panelEl) => {
        if (!panelEl) return;
        try {
            if (typeof panelEl._summaryDetailNavCleanup === 'function') {
                panelEl._summaryDetailNavCleanup();
            }
        } catch (_) {}
        panelEl._summaryDetailNavReset = null;
        const body = panelEl.querySelector('.summary_minor_panel_body');
        const sections = body ? Array.from(body.querySelectorAll('.ms-section')) : [];
        if (!body || sections.length < 2) return;

        const nav = document.createElement('nav');
        nav.className = 'summary_detail_section_nav';
        nav.setAttribute('aria-label', 'Requirement sections');
        const records = sections.map((section) => {
            const source = section.querySelector('.ms-title') || section.querySelector('.ms-header');
            const rawLabel = String(source && source.textContent || 'Requirement')
                .trim().replace(/\s+/g, ' ');
            const label = rawLabel.toLowerCase().replace(/(^|\s)\S/g, (letter) => letter.toUpperCase());
            if (!section.id) section.id = `summary-detail-section-${++detailSectionSequence}`;
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'summary_detail_section_link';
            button.textContent = label;
            button.setAttribute('aria-controls', section.id);
            nav.appendChild(button);
            return { section, button };
        });
        panelEl.insertBefore(nav, body);

        const setActive = (record) => {
            records.forEach((candidate) => {
                const active = candidate === record;
                candidate.button.classList.toggle('is-active', active);
                if (active) candidate.button.setAttribute('aria-current', 'true');
                else candidate.button.removeAttribute('aria-current');
            });
        };
        const scrollToRecord = (record) => {
            const panelBox = panelEl.getBoundingClientRect();
            const header = panelEl.querySelector('.summary_minor_panel_header');
            const stickyHeight = (header ? header.getBoundingClientRect().height : 0)
                + nav.getBoundingClientRect().height + 12;
            const sectionTop = panelEl.scrollTop
                + record.section.getBoundingClientRect().top - panelBox.top - stickyHeight;
            panelEl.scrollTo({ top: Math.max(0, sectionTop), behavior: 'auto' });
            setActive(record);
        };
        records.forEach((record) => {
            record.button.addEventListener('click', () => scrollToRecord(record));
        });
        const syncFromScroll = () => {
            const navBottom = nav.getBoundingClientRect().bottom + 28;
            let current = records[0];
            records.forEach((record) => {
                if (record.section.getBoundingClientRect().top <= navBottom) current = record;
            });
            setActive(current);
        };
        panelEl.addEventListener('scroll', syncFromScroll, { passive: true });
        panelEl._summaryDetailNavCleanup = () => {
            panelEl.removeEventListener('scroll', syncFromScroll);
        };
        panelEl._summaryDetailNavReset = () => {
            panelEl.scrollTop = 0;
            setActive(records[0]);
        };
        setActive(records[0]);
    };
    const resetVisibleDetailPosition = (panelEl) => {
        if (!panelEl) return;
        const reset = () => {
            if (panelEl.classList.contains('is-hidden')) return;
            panelEl.scrollTop = 0;
            try {
                if (typeof panelEl._summaryDetailNavReset === 'function') {
                    panelEl._summaryDetailNavReset();
                }
            } catch (_) {}
        };
        reset();
        // Chromium can restore a scroll anchor as display:none panels re-enter
        // layout. Reassert on the next frame, after their geometry is resolved.
        try { window.requestAnimationFrame(reset); } catch (_) {}
    };

    const showOverview = (options = {}) => {
        try {
            contentEl.dataset.summaryView = 'overview';
            delete contentEl.dataset.detailProgramKind;
            delete contentEl.dataset.detailProgramCode;
            minorPanelEl.classList.add('is-hidden');
            majorPanelEl.classList.add('is-hidden');
            minorPanelEl.removeAttribute('role');
            minorPanelEl.removeAttribute('aria-labelledby');
            majorPanelEl.removeAttribute('role');
            majorPanelEl.removeAttribute('aria-labelledby');
            programTabRecords.forEach((record) => {
                record.tab.setAttribute('aria-controls', record.overviewPanelId);
            });
            cardsRowEl.classList.remove('is-hidden');
            overviewSubtitleEl.textContent = contentEl.classList.contains('is-multiple')
                ? `Earned and projected progress across ${contentEl.dataset.programCount || 'multiple'} selected programs.`
                : 'Earned and projected progress for your selected program.';
        } catch (_) {}
        if (options.focusTab && !isMobileSummaryAdapter) {
            setTimeout(() => {
                try {
                    const record = activeProgramRecord();
                    if (record) focusProgramAnchor(record);
                } catch (_) {}
            }, 0);
        }
    };
    contentEl.dataset.summaryView = 'overview';

    if (!isMobileSummaryAdapter) {
        const getSummaryFocusable = () => Array.from(contentEl.querySelectorAll(
            'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"]), select:not([disabled]), input:not([disabled])'
        )).filter((element) => element.getAttribute('aria-hidden') !== 'true'
            && !element.closest('[hidden], .is-hidden')
            && element.getClientRects().length > 0);
        summaryKeydownHandler = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                closeSummary();
                return;
            }
            if (event.key !== 'Tab') return;
            const focusable = getSummaryFocusable();
            if (!focusable.length) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && (document.activeElement === first || !contentEl.contains(document.activeElement))) {
                event.preventDefault();
                last.focus({ preventScroll: true });
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus({ preventScroll: true });
            }
        };
        document.addEventListener('keydown', summaryKeydownHandler, true);
        setTimeout(() => {
            try { closeButtonEl.focus({ preventScroll: true }); } catch (_) {}
        }, 0);
    }

    function getTakenCourseCodes() {
        const taken = new Set();
        try {
            for (let i = 0; i < curriculum.semesters.length; i++) {
                const sem = curriculum.semesters[i];
                for (let j = 0; j < sem.courses.length; j++) {
                    const c = sem.courses[j];
                    if (!c || !c.code) continue;
                    const progressState = (typeof curriculum.getCourseProgressState === 'function')
                        ? curriculum.getCourseProgressState(c, sem) : 'earned';
                    if (progressState === 'unsuccessful') continue;
                    taken.add(String(c.code).toUpperCase().replace(/\s+/g, ''));
                }
            }
        } catch (_) {}
        return taken;
    }

    // Keep attempts separate from requirement allocation. Unsuccessful courses
    // intentionally do not enter allocation/GPA-credit totals, but the summary
    // must not make a real attempt look identical to a course never taken.
    const courseAttemptByCode = (() => {
        const attempts = new Map();
        const normalizeAttemptCode = (value) => String(value || '').toUpperCase().replace(/\s+/g, '');
        try {
            for (let i = 0; i < curriculum.semesters.length; i++) {
                const sem = curriculum.semesters[i];
                for (let j = 0; j < sem.courses.length; j++) {
                    const course = sem.courses[j];
                    const code = normalizeAttemptCode(course && course.code);
                    if (!code) continue;
                    const state = (typeof curriculum.getCourseProgressState === 'function')
                        ? curriculum.getCourseProgressState(course, sem) : 'earned';
                    const candidate = {
                        state,
                        grade: String((course && course.grade) || '').trim().toUpperCase(),
                    };
                    const previous = attempts.get(code);
                    // If historical/imported data ever contains multiple
                    // attempts, a non-failed attempt wins over an older failure.
                    if (!previous || (previous.state === 'unsuccessful' && state !== 'unsuccessful')) {
                        attempts.set(code, candidate);
                    }
                }
            }
        } catch (_) {}
        return attempts;
    })();
    const getUnsuccessfulAttempt = (code) => {
        const normalized = String(code || '').toUpperCase().replace(/\s+/g, '');
        const attempt = courseAttemptByCode.get(normalized);
        return attempt && attempt.state === 'unsuccessful' ? attempt : null;
    };

    let programCardSequence = 0;
    const appendProgramCardHeading = (card, kind, code, title) => {
        const normalizedKind = String(kind || 'program');
        const normalizedCode = String(code || '').toUpperCase();
        const titleId = `summary-program-card-title-${++programCardSequence}`;
        card.classList.add('summary_program_card');
        card.dataset.programKind = normalizedKind;
        card.dataset.programCode = normalizedCode;

        const heading = document.createElement('div');
        heading.className = 'summary_program_card_heading';
        const eyebrow = document.createElement('span');
        eyebrow.className = 'summary_program_role';
        eyebrow.textContent = normalizedKind === 'main' ? 'Main major'
            : normalizedKind === 'dm' ? 'Double major' : 'Minor';
        const titleEl = document.createElement('h4');
        titleEl.id = titleId;
        titleEl.className = 'summary_modal_title';
        titleEl.textContent = title || normalizedCode;
        const codeEl = document.createElement('span');
        codeEl.className = 'summary_program_code';
        codeEl.textContent = normalizedCode;
        heading.appendChild(eyebrow);
        heading.appendChild(titleEl);
        heading.appendChild(codeEl);
        card.appendChild(heading);
        registerProgramTab(card, normalizedKind, normalizedCode, title || normalizedCode, titleId);
        return titleEl;
    };

    const organizeProgramOverviewCard = (card, options = {}) => {
        if (!card || card.dataset.summaryOrganized === 'true') return;
        card.dataset.summaryOrganized = 'true';

        const kind = String(options.kind || card.dataset.programKind || 'program').toLowerCase();
        const directChildren = () => Array.from(card.children);
        const takeDirect = (selector) => directChildren().find((child) => child.matches(selector)) || null;
        const takeDirectAll = (selector) => directChildren().filter((child) => child.matches(selector));
        const makeSectionCopy = (title, description) => {
            const copy = document.createElement('div');
            copy.className = 'summary_overview_section_copy';
            const heading = document.createElement('h5');
            heading.textContent = title;
            const body = document.createElement('p');
            body.textContent = description;
            copy.appendChild(heading);
            copy.appendChild(body);
            return copy;
        };
        const markProgressMetric = (metric) => {
            if (!metric) return;
            const projected = Number(metric.dataset.projected);
            const earned = Number(metric.dataset.earned);
            const limit = Number(metric.dataset.limit);
            if (!Number.isFinite(limit) || limit <= 0) return;
            metric.classList.toggle('is-earned-complete', Number.isFinite(earned) && earned >= limit);
            metric.classList.toggle('is-projected-complete', Number.isFinite(projected)
                && projected >= limit && !(Number.isFinite(earned) && earned >= limit));
            metric.classList.toggle('is-incomplete', !Number.isFinite(projected) || projected < limit);
        };

        const identity = document.createElement('header');
        identity.className = 'summary_overview_identity';
        const cardHeading = takeDirect('.summary_program_card_heading');
        const cardContext = takeDirect('.summary_program_card_context');
        const cardFooter = takeDirect('.summary_program_card_footer');
        const identityCopy = document.createElement('div');
        identityCopy.className = 'summary_program_identity_copy';
        if (cardHeading) {
            const meta = document.createElement('div');
            meta.className = 'summary_program_meta';
            const role = cardHeading.querySelector('.summary_program_role');
            const code = cardHeading.querySelector('.summary_program_code');
            let status = cardContext && cardContext.querySelector('.summary_program_status');
            if (!status && card.dataset.summaryStatus) {
                const statusValue = String(card.dataset.summaryStatus || 'in-progress');
                status = document.createElement('span');
                status.className = `summary_program_status ${statusValue === 'in-progress' ? 'is-progress' : `is-${statusValue}`}`;
                status.textContent = statusValue === 'complete' ? 'Requirements met'
                    : statusValue === 'projected' ? 'Projected complete'
                        : statusValue === 'unavailable' ? 'Requirements unavailable' : 'In progress';
            }
            if (role) meta.appendChild(role);
            if (code) meta.appendChild(code);
            if (status) meta.appendChild(status);
            if (meta.children.length) cardHeading.insertBefore(meta, cardHeading.firstChild);
            identityCopy.appendChild(cardHeading);
        }
        if (cardContext && cardContext.children.length) identityCopy.appendChild(cardContext);
        if (identityCopy.children.length) identity.appendChild(identityCopy);
        if (cardFooter) identity.appendChild(cardFooter);
        if (identity.children.length) card.appendChild(identity);

        const heroMetric = takeDirect('.summary_metric_hero');
        if (heroMetric) {
            markProgressMetric(heroMetric);
            const projected = Number(heroMetric.dataset.projected) || 0;
            const limit = Number(heroMetric.dataset.limit) || 0;
            const remaining = Math.max(0, limit - projected);
            const completion = document.createElement('div');
            completion.className = 'summary_metric_completion';
            completion.textContent = limit > 0
                ? (remaining > 0
                    ? `${Math.min(100, Math.round((projected / limit) * 100))}% planned • ${formatSummaryNumber(remaining)} remaining`
                    : 'Requirement reached in the current plan')
                : 'No overall credit target is configured';
            heroMetric.appendChild(completion);

            const hero = document.createElement('section');
            hero.className = 'summary_overview_hero';
            hero.appendChild(makeSectionCopy(
                kind === 'minor' ? 'Minor progress' : 'Overall progress',
                'Earned credit is shown separately from current, future, and needs-grade coursework.'
            ));
            hero.appendChild(heroMetric);
            card.appendChild(hero);
        }

        const snapshotKeys = kind === 'minor'
            ? new Set(['cgpa', 'pgpa', 'courses'])
            : new Set(['gpa', 'main_pgpa', 'pgpa', 'ects']);
        const snapshotMetrics = takeDirectAll('.summary_metric').filter((metric) => (
            snapshotKeys.has(String(metric.dataset.metric || '')) && metric !== heroMetric
        ));
        const standing = takeDirect('.summary_class_level');
        if (standing || snapshotMetrics.length) {
            const snapshot = document.createElement('section');
            snapshot.className = 'summary_overview_snapshot';
            snapshot.appendChild(makeSectionCopy(
                'Academic snapshot',
                kind === 'minor'
                    ? 'Current averages and planned course-count progress for this minor.'
                    : 'Standing and averages based on the grades currently available in your plan.'
            ));
            const grid = document.createElement('div');
            grid.className = 'summary_overview_snapshot_grid';
            if (standing) grid.appendChild(standing);
            snapshotMetrics.forEach((metric) => grid.appendChild(metric));
            snapshot.appendChild(grid);
            card.appendChild(snapshot);
        }

        const remainingMetrics = takeDirectAll('.summary_metric').filter((metric) => metric !== heroMetric);
        remainingMetrics.forEach(markProgressMetric);
        const categorySummary = takeDirect('.summary_minor_categories');
        if (remainingMetrics.length || categorySummary) {
            const requirements = document.createElement('section');
            requirements.className = 'summary_overview_requirements';
            requirements.appendChild(makeSectionCopy(
                'Requirement progress',
                kind === 'minor'
                    ? 'Category targets used by the selected minor.'
                    : 'How the current plan is distributed across degree-credit categories.'
            ));
            if (remainingMetrics.length) {
                const grid = document.createElement('div');
                grid.className = 'summary_overview_requirements_grid';
                remainingMetrics.forEach((metric) => grid.appendChild(metric));
                requirements.appendChild(grid);
            }
            if (categorySummary) requirements.appendChild(categorySummary);
            card.appendChild(requirements);
        }

        const notices = directChildren().filter((child) => (
            child.matches('.summary_minor_unavailable')
            || (child.matches('.summary_modal_child') && !child.matches('.summary_metric, .summary_class_level'))
        ));
        if (notices.length) {
            const noticeRegion = document.createElement('section');
            noticeRegion.className = 'summary_overview_notice';
            notices.forEach((notice) => noticeRegion.appendChild(notice));
            card.appendChild(noticeRegion);
        }

    };

    const formatSummaryNumber = (value) => {
        const number = Number(value || 0);
        if (!Number.isFinite(number)) return '0';
        return Math.abs(number - Math.round(number)) < 1e-9
            ? String(Math.round(number)) : number.toFixed(1);
    };

    let appendMinorOverviewCards = () => {};

    // Keep the existing hidden minor buttons as a compatibility adapter for
    // the mobile Progress screen, while desktop gets real compact minor cards.
    try {
        const minors = Array.from(new Set(
            (Array.isArray(curriculum.minors) ? curriculum.minors : [])
                .map(code => String(code || '').trim())
                .filter(Boolean)
        ));
        if (minors.length) {
            const minorRow = document.createElement('div');
            minorRow.className = 'summary_minor_row';
            minorRow.hidden = true;
            headerRowEl.appendChild(minorRow);

            const taken = getTakenCourseCodes();
            const getMinorReq = (code) => {
                const termCode = (() => {
                    try {
                        const map = curriculum && curriculum.minorTermsByCode ? curriculum.minorTermsByCode : {};
                        const t = map && map[code] ? String(map[code]) : '';
                        if (t) return t;
                    } catch (_) {}
                    try { return curriculum && curriculum.entryTermMinor ? String(curriculum.entryTermMinor) : ''; } catch (_) {}
                    return '';
                })();
                try {
                    if (typeof window !== 'undefined' && typeof window.loadMinorRequirementsForTerm === 'function') {
                        const m = window.loadMinorRequirementsForTerm(termCode);
                        if (m && typeof m === 'object' && m[code]) return m[code];
                    }
                } catch (_) {}
                try {
                    const fallback = (typeof window !== 'undefined' && window.minorRequirements) ? window.minorRequirements : {};
                    return fallback && fallback[code] ? fallback[code] : null;
                } catch (_) {
                    return null;
                }
            };

            const parseInt0 = (v) => {
                const n = parseInt(v || '0', 10);
                return isNaN(n) ? 0 : n;
            };

            const showMajors = () => {
                showOverview({ focusTab: true });
            };

            const showMinorSummary = (minorCode) => {
                try { majorPanelEl.classList.add('is-hidden'); } catch (_) {}
                activateProgramCard('minor', minorCode);
                const allocRes = computeMinorAllocation(curriculum, minorCode, {
                    progressGpa: progressMain && progressMain.gpa,
                });
                const earnedAllocRes = computeMinorAllocation(curriculum, minorCode, {
                    progressGpa: progressMain && progressMain.gpa,
                    isEligible: (course, sem) => (typeof curriculum.getCourseProgressState === 'function')
                        ? curriculum.getCourseProgressState(course, sem) === 'earned' : true,
                });
                if (allocRes.error) {
                    const ui = (typeof window !== 'undefined') ? window.uiModal : null;
                    if (ui && typeof ui.alert === 'function') {
                        ui.alert('Minor summary unavailable', `<p>${esc(allocRes.error)}</p>`);
                    }
                    return;
                }

                const req = allocRes.req || {};
                const title = `${minorCode} — ${req.name || 'Minor'}`;
                const categories = req.categories || {};
                const catOrder = ['required', 'core', 'area', 'free'];
                const totals = allocRes.totals || {};
                const allocationByCode = allocRes.allocationByCode || {};
                const courseByCode = allocRes.courseByCode || new Map();
                const pools = allocRes.pools || { required: [], core: [], area: [], free: [] };

                const termName = (() => {
                    if (req.term) return req.term;
                    const tc = allocRes.termCode ? String(allocRes.termCode) : (curriculum && curriculum.entryTermMinor ? String(curriculum.entryTermMinor) : '');
                    try {
                        const fn = (typeof window !== 'undefined' && typeof window.termCodeToName === 'function') ? window.termCodeToName : null;
                        return fn ? fn(tc) : tc;
                    } catch (_) {
                        return tc;
                    }
                })();

                const renderEq = (cfg) => {
                    const eq = cfg && Array.isArray(cfg.equivalents) ? cfg.equivalents : [];
                    if (!eq.length) return '';
                    const parts = eq.map(g => Array.isArray(g)
                        ? g.map(item => esc(item)).join(' / ')
                        : esc(g));
                    return `<div class="ms-rules"><strong>Rule:</strong> Choose 1 of: ${parts.join(' • ')}</div>`;
                };
                const minorProgressChip = (state) => {
                    const labels = { earned: 'Earned', current: 'Current', future: 'Future', unverified: 'Needs grade' };
                    return labels[state] ? `<span class="ms-state-chip is-${esc(state)}">${esc(labels[state])}</span>` : '';
                };

                const orderPoolCodes = (codes, sectionCat) => {
                    const arr = Array.isArray(codes) ? codes.slice() : [];
                    const rank = (code) => {
                        const alloc = allocationByCode[code];
                        if (!alloc) return getUnsuccessfulAttempt(code) ? 2 : 3;
                        if (alloc.allocatedCat === sectionCat) return 0; // taken + counts here
                        return 1; // taken + counts elsewhere
                    };
                    return arr.sort((a, b) => {
                        const ra = rank(a);
                        const rb = rank(b);
                        if (ra !== rb) return ra - rb;
                        return String(a).localeCompare(String(b));
                    });
                };

                const renderPoolCourse = (code, sectionCat) => {
                    const rec = courseByCode.get(code);
                    if (!rec) return '';
                    const name = rec.Course_Name || '';
                    const su = rec.SU_credit || '0';
                    const alloc = allocationByCode[code];
                    if (!alloc) {
                        const unsuccessful = getUnsuccessfulAttempt(code);
                        const statusClass = unsuccessful ? 'is-unsuccessful' : 'is-missing';
                        const status = unsuccessful ? 'unsuccessful' : 'not-taken';
                        const statusLabel = unsuccessful ? 'Unsuccessful' : 'Not taken';
                        return `
                          <div class="ms-course ${statusClass}" data-course-status="${status}">
                            <div class="ms-course-left">
                              <span class="ms-dot"></span>
                              <span class="ms-code">${esc(code)}</span>
                              <span class="ms-name">${esc(name)}</span>
                            </div>
                            <div class="ms-meta"><span class="ms-state-chip ${unsuccessful ? 'is-unsuccessful' : 'is-not-taken'}">${statusLabel}</span>${esc(su)} SU</div>
                          </div>
                        `;
                    }
                    const isHere = alloc.allocatedCat === sectionCat;
                    const statusClass = isHere ? 'is-taken' : 'is-overflow';
                    const countsAs = isHere ? '' : ` • Counts as ${esc(String(alloc.allocatedCat || '').toUpperCase())}`;
                    return `
                      <div class="ms-course ${statusClass}">
                        <div class="ms-course-left">
                          <span class="ms-dot"></span>
                          <span class="ms-code">${esc(code)}</span>
                          <span class="ms-name">${esc(name)}</span>
                        </div>
                        <div class="ms-meta">${minorProgressChip(alloc.progressState)}${esc(su)} SU${countsAs}</div>
                      </div>
                    `;
                };

                const renderOverflowHere = (code) => {
                    const rec = courseByCode.get(code);
                    const alloc = allocationByCode[code];
                    if (!rec || !alloc) return '';
                    const name = rec.Course_Name || '';
                    const su = rec.SU_credit || '0';
                    const fromTxt = ` • From ${esc(String(alloc.baseCat || '').toUpperCase())}`;
                    return `
                      <div class="ms-course is-overflow">
                        <div class="ms-course-left">
                          <span class="ms-dot"></span>
                          <span class="ms-code">${esc(code)}</span>
                          <span class="ms-name">${esc(name)}</span>
                        </div>
                        <div class="ms-meta">${minorProgressChip(alloc.progressState)}${esc(su)} SU${fromTxt}</div>
                      </div>
                    `;
                };

                let untakenToggleCounter = 0;
                const renderPoolWithUntakenToggle = (poolCodes, sectionCat) => {
                    const ordered = orderPoolCodes(poolCodes, sectionCat);
                    const takenCodes = [];
                    const unsuccessfulCodes = [];
                    const untakenCodes = [];
                    for (let i = 0; i < ordered.length; i++) {
                        const code = ordered[i];
                        if (allocationByCode[code]) takenCodes.push(code);
                        else if (getUnsuccessfulAttempt(code)) unsuccessfulCodes.push(code);
                        else untakenCodes.push(code);
                    }

                    if (!ordered.length) return `<div class="ms-empty">No courses listed in this pool.</div>`;

                    let html = '';
                    if (takenCodes.length) {
                        html += takenCodes.map(code => renderPoolCourse(code, sectionCat)).join('');
                    }
                    if (unsuccessfulCodes.length) {
                        html += unsuccessfulCodes.map(code => renderPoolCourse(code, sectionCat)).join('');
                    }
                    if (!takenCodes.length && !unsuccessfulCodes.length && untakenCodes.length) {
                        html += `<div class="ms-empty">No taken courses in this pool yet.</div>`;
                    }

                    if (untakenCodes.length) {
                        const count = untakenCodes.length;
                        const hid = `ms-untaken-minor-${sectionCat}-${++untakenToggleCounter}`;
                        html += `
                          <div class="ms-untaken-wrap">
                            <button type="button" class="btn btn-secondary btn-sm ms-untaken-toggle" data-target="${hid}" data-count="${count}">Show untaken (${count})</button>
                          </div>
                          <div id="${hid}" class="ms-untaken-list is-hidden">
                            ${untakenCodes.map(code => renderPoolCourse(code, sectionCat)).join('')}
                          </div>
                        `;
                    }
                    return html;
                };

                let body = `<div class="minor-summary">`;
                body += `<div class="ms-subtitle">Admit term: <strong>${esc(termName || 'Unknown')}</strong></div>`;
                try {
                    if (allocRes.gpaResolved === false) {
                        body += `<div class="ms-subtitle ms-subtitle--danger">CGPA unavailable: review the grading basis of the flagged NA course.</div>`;
                    } else if (isFinite(allocRes.cgpa) && allocRes.gpaThreshold) {
                        const cgpaStr = Number(allocRes.cgpa).toFixed(3);
                        const thrStr = Number(allocRes.gpaThreshold).toFixed(2);
                        const ok = allocRes.gpaOk !== false;
                        const toneClass = ok ? 'ms-subtitle--muted' : 'ms-subtitle--danger';
                        body += `<div class="ms-subtitle ${toneClass}">CGPA requirement: <strong>${thrStr}</strong> • Your CGPA: <strong>${cgpaStr}</strong></div>`;
                    } else {
                        body += `<div class="ms-subtitle">CGPA requirement: <strong>${(String(minorCode || '').toUpperCase() === 'ENTREP-MINOR') ? '2.50' : '2.72'}</strong></div>`;
                    }
                    const thrStr = Number(allocRes.gpaThreshold || 0).toFixed(2);
                    if (allocRes.pgpaResolved === false) {
                        body += `<div class="ms-subtitle ms-subtitle--danger">Minor PGPA unavailable: review the program-course grades.</div>`;
                    } else if (isFinite(allocRes.pgpa)) {
                        const pgpaStr = Number(allocRes.pgpa).toFixed(3);
                        const toneClass = allocRes.pgpaOk !== false ? 'ms-subtitle--muted' : 'ms-subtitle--danger';
                        body += `<div class="ms-subtitle ${toneClass}">Minor PGPA requirement: <strong>${thrStr}</strong> • Your PGPA: <strong>${pgpaStr}</strong></div>`;
                    } else {
                        body += `<div class="ms-subtitle">Minor PGPA requirement: <strong>${thrStr}</strong></div>`;
                    }
                    const estimate = allocRes.projectedPgpa;
                    if (estimate) {
                        const value = Number(estimate.value);
                        const missing = Number(estimate.missingCredits) || 0;
                        const differs = Number(estimate.credits) !== Number(allocRes.pgpaCredits || 0);
                        if (differs || missing) {
                            body += `<div class="ms-average-projection">Projected minor PGPA from entered grades: <strong>${isFinite(value) ? value.toFixed(3) : 'N/A'}</strong>${missing ? ` • ${missing} SU need estimates` : ''}</div>`;
                        }
                    }
                } catch (_) {}
                body += `<div class="ms-legend">
                    <div class="ms-legend-item"><span class="ms-dot ms-dot-green"></span>Counts in this pool</div>
                    <div class="ms-legend-item"><span class="ms-dot ms-dot-yellow"></span>Counts in a lower pool (overflow)</div>
                    <div class="ms-legend-item"><span class="ms-dot ms-dot-red"></span>Attempted, unsuccessful</div>
                    <div class="ms-legend-item"><span class="ms-dot ms-dot-gray"></span>Not taken</div>
                  </div>`;

                for (const cat of catOrder) {
                    const cfg = categories[cat];
                    const poolCodes = Array.isArray(pools[cat]) ? pools[cat].slice() : [];
                    const overflowHere = Object.keys(allocationByCode)
                        .filter(code => {
                            const a = allocationByCode[code];
                            return a && a.allocatedCat === cat && a.movedDown;
                        })
                        .sort((a, b) => String(a).localeCompare(String(b)));

                    if (!cfg && !poolCodes.length && !overflowHere.length) continue;

                    const needC = parseInt0(cfg && cfg.minCourses);
                    const needS = parseInt0(cfg && cfg.minSU);
                    const have = totals[cat] || { courses: 0, credits: 0 };
                    const earnedHave = earnedAllocRes && earnedAllocRes.totals
                        ? (earnedAllocRes.totals[cat] || { courses: 0, credits: 0 })
                        : { courses: 0, credits: 0 };

                    body += `<div class="ms-section">`;
                    body += `<div class="ms-header"><div class="ms-title">${cat.toUpperCase()}</div><div class="ms-req">${earnedHave.courses} earned courses • ${have.courses}/${needC || 0} projected • ${earnedHave.credits} earned / ${have.credits}/${needS || 0} projected SU</div></div>`;
                    if (cfg && cfg.allListedRequired && cat === 'required') {
                        body += `<div class="ms-rules"><strong>Rule:</strong> All listed courses are required (equivalence groups count as “choose one”).</div>`;
                    }
                    body += renderEq(cfg);

                    if (overflowHere.length) {
                        body += `<div class="ms-subheader">Overflow counting here</div>`;
                        body += `<div class="ms-list">`;
                        body += overflowHere.map(c => renderOverflowHere(c)).join('');
                        body += `</div>`;
                    }

                    body += `<div class="ms-subheader">Course pool</div>`;
                    body += `<div class="ms-list">`;
                    body += renderPoolWithUntakenToggle(poolCodes, cat);
                    body += `</div></div>`;
                }

                body += `</div>`;

                // Render inside overlay and hide majors.
                minorPanelEl.innerHTML = `
                  <div class="summary_minor_panel_header">
                    <button class="btn btn-secondary summary_back_btn" type="button">Back to program summary</button>
                    <div class="summary_minor_panel_title">${esc(title)}</div>
                  </div>
                  <div class="summary_minor_switch_row">
                    ${minors.map(code => {
                        const rec = getMinorReq(code);
                        const label = rec && rec.name ? rec.name : code;
                        const active = code === minorCode ? 'is-active' : '';
                        return `<button type="button" class="btn btn-secondary summary_minor_switch_btn ${active}" data-minor-code="${esc(code)}">${esc(label)}</button>`;
                    }).join('')}
                  </div>
                  <div class="summary_minor_panel_body">${body}</div>
                `;
                // A rebuilt detail view is a fresh navigation context. Keeping the
                // previous scroll offset would put the visible section out of sync
                // with the newly rebuilt section navigation's active item.
                minorPanelEl.scrollTop = 0;
                try {
                    const backBtn = minorPanelEl.querySelector('.summary_back_btn');
                    if (backBtn) {
                        backBtn.addEventListener('click', (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            showMajors();
                        });
                    }
                    minorPanelEl.querySelectorAll('.summary_minor_switch_btn').forEach(btn => {
                        btn.addEventListener('click', (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const code = btn.getAttribute('data-minor-code') || '';
                            if (code) showMinorSummary(code);
                        });
                    });
                    minorPanelEl.querySelectorAll('.ms-untaken-toggle').forEach(btn => {
                        btn.addEventListener('click', (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const targetId = btn.getAttribute('data-target') || '';
                            const count = btn.getAttribute('data-count') || '0';
                            const target = targetId ? minorPanelEl.querySelector(`#${targetId}`) : null;
                            if (!target) return;
                            const willShow = target.classList.contains('is-hidden');
                            target.classList.toggle('is-hidden', !willShow);
                            btn.textContent = willShow ? `Hide untaken (${count})` : `Show untaken (${count})`;
                        });
                    });
                    wireDetailSectionNavigation(minorPanelEl);
                } catch (_) {}

                try {
                    contentEl.dataset.summaryView = 'detail';
                    contentEl.dataset.detailProgramKind = 'minor';
                    contentEl.dataset.detailProgramCode = String(minorCode || '').toUpperCase();
                    minorPanelEl.classList.remove('is-hidden');
                    cardsRowEl.classList.add('is-hidden');
                    resetVisibleDetailPosition(minorPanelEl);
                    connectActiveTabToDetail(minorPanelEl);
                    focusDetailBackButton(minorPanelEl);
                    overviewSubtitleEl.textContent = `${minorCode} minor details`;
                } catch (_) {}
            };

            const formatMinorValue = (value) => {
                const n = Number(value || 0);
                if (!isFinite(n)) return '0';
                return Math.abs(n - Math.round(n)) < 1e-9 ? String(Math.round(n)) : n.toFixed(1);
            };

            const minorLayerTotals = (allocation) => {
                const layers = {
                    earned: { courses: 0, credits: 0 },
                    current: { courses: 0, credits: 0 },
                    future: { courses: 0, credits: 0 },
                    unverified: { courses: 0, credits: 0 },
                };
                const records = allocation && allocation.allocationByCode
                    ? allocation.allocationByCode : {};
                Object.keys(records).forEach((code) => {
                    const record = records[code] || {};
                    const state = Object.prototype.hasOwnProperty.call(layers, record.progressState)
                        ? record.progressState : 'unverified';
                    layers[state].courses += 1;
                    layers[state].credits += Number(record.credit) || 0;
                });
                return layers;
            };

            const appendMinorAverageMetric = (card, key, label, value, resolved, threshold, ok) => {
                const metric = document.createElement('div');
                metric.className = `summary_modal_child summary_metric summary_minor_metric ${ok ? 'is-met' : 'is-unmet'}`;
                metric.dataset.metric = key;
                metric.dataset.value = isFinite(Number(value)) ? String(Number(value)) : '';
                metric.dataset.limit = '4';
                metric.dataset.threshold = String(Number(threshold) || 0);
                metric.dataset.met = String(!!ok);
                const display = resolved && isFinite(Number(value)) ? Number(value).toFixed(3) : 'N/A';
                metric.innerHTML = `
                    <div class="summary_metric_head"><span>${label}</span><strong>${display} / 4.00</strong></div>
                    <div class="summary_metric_equation"><span>Required ≥ ${Number(threshold || 0).toFixed(2)}</span></div>`;
                card.appendChild(metric);
            };

            const appendMinorProgressMetric = (card, key, label, layers, unit, limit) => {
                const metric = document.createElement('div');
                metric.className = 'summary_modal_child summary_metric summary_minor_metric';
                metric.dataset.metric = key;
                const field = unit === 'courses' ? 'courses' : 'credits';
                const values = {
                    earned: Number(layers.earned[field]) || 0,
                    current: Number(layers.current[field]) || 0,
                    future: Number(layers.future[field]) || 0,
                    unverified: Number(layers.unverified[field]) || 0,
                };
                const projected = values.earned + values.current + values.future + values.unverified;
                const target = Number(limit) || 0;
                metric.dataset.earned = String(values.earned);
                metric.dataset.current = String(values.current);
                metric.dataset.future = String(values.future);
                metric.dataset.unverified = String(values.unverified);
                metric.dataset.projected = String(projected);
                metric.dataset.limit = String(target);
                metric.classList.toggle('summary_metric_hero', key === 'su');
                const parts = [
                    `<span class="summary_part is-earned"><strong>${formatMinorValue(values.earned)}</strong> earned</span>`,
                ];
                if (values.current) parts.push(`<span class="summary_part is-current"><strong>+ ${formatMinorValue(values.current)}</strong> current</span>`);
                if (values.future) parts.push(`<span class="summary_part is-future"><strong>+ ${formatMinorValue(values.future)}</strong> future</span>`);
                if (values.unverified) parts.push(`<span class="summary_part is-unverified"><strong>+ ${formatMinorValue(values.unverified)}</strong> needs grade</span>`);
                const denom = Math.max(projected, target, 1);
                const segment = (state, amount) => amount > 0
                    ? `<span class="summary_segment is-${state}" style="width:${Math.max(0, amount) / denom * 100}%"></span>` : '';
                metric.innerHTML = `
                    <div class="summary_metric_head"><span>${label}</span><strong>${formatMinorValue(projected)} / ${formatMinorValue(target)}</strong></div>
                    <div class="summary_metric_equation">${parts.join(' ')}</div>
                    <div class="summary_segment_track" role="progressbar" aria-label="${esc(label)} progress" aria-valuemin="0" aria-valuemax="${Math.max(1, target, projected)}" aria-valuenow="${Math.max(0, projected)}">
                        ${segment('earned', values.earned)}${segment('current', values.current)}${segment('future', values.future)}${segment('unverified', values.unverified)}
                    </div>`;
                card.appendChild(metric);
            };

            appendMinorOverviewCards = () => {
                for (const minorCode of minors) {
                    const card = document.createElement('div');
                    card.className = 'summary_minor_overview_card';
                    const progressGpa = progressMain && progressMain.gpa;
                    const allocRes = computeMinorAllocation(curriculum, minorCode, {
                        progressGpa,
                    });
                    const req = allocRes && !allocRes.error ? (allocRes.req || {}) : (getMinorReq(minorCode) || {});
                    const title = (allocRes && !allocRes.error && allocRes.title)
                        ? allocRes.title : (req.name || minorCode);
                    appendProgramCardHeading(card, 'minor', minorCode, title);

                    if (!allocRes || allocRes.error) {
                        card.classList.add('is-unavailable');
                        card.dataset.summaryStatus = 'unavailable';
                        const unavailable = document.createElement('div');
                        unavailable.className = 'summary_minor_unavailable';
                        unavailable.textContent = 'Requirements are unavailable for this minor and admit term.';
                        card.appendChild(unavailable);
                        const disabledFooter = document.createElement('div');
                        disabledFooter.className = 'summary_program_card_footer';
                        const disabledButton = document.createElement('button');
                        disabledButton.type = 'button';
                        disabledButton.className = 'btn btn-secondary summary_detail_btn';
                        disabledButton.disabled = true;
                        disabledButton.textContent = 'Requirement details unavailable';
                        disabledFooter.appendChild(disabledButton);
                        card.appendChild(disabledFooter);
                        organizeProgramOverviewCard(card, { kind: 'minor' });
                        minorGridEl.appendChild(card);
                        continue;
                    }

                    const earnedAllocRes = computeMinorAllocation(curriculum, minorCode, {
                        progressGpa,
                        isEligible: (course, semester) => {
                            try {
                                return curriculum
                                    && typeof curriculum.getCourseProgressState === 'function'
                                    && curriculum.getCourseProgressState(course, semester) === 'earned'
                                    && courseCountsTowardDegreePlan(curriculum, course, semester);
                            } catch (_) {
                                return false;
                            }
                        },
                    });
                    const summaryStatus = earnedAllocRes && !earnedAllocRes.error && earnedAllocRes.ok
                        ? 'complete' : allocRes.ok ? 'projected' : 'in-progress';
                    card.dataset.summaryStatus = summaryStatus;
                    const context = document.createElement('div');
                    context.className = 'summary_program_card_context';
                    const termLabel = req.term || termNameFromCode(allocRes.termCode) || 'Unknown term';
                    const status = document.createElement('span');
                    const statusClass = summaryStatus === 'complete' ? 'is-complete'
                        : summaryStatus === 'projected' ? 'is-projected' : 'is-progress';
                    status.className = `summary_program_status ${statusClass}`;
                    status.textContent = summaryStatus === 'complete' ? 'Requirements met'
                        : summaryStatus === 'projected' ? 'Projected complete' : 'In progress';
                    const term = document.createElement('span');
                    term.className = 'summary_program_term';
                    term.textContent = `Admit term: ${termLabel}`;
                    context.appendChild(status);
                    context.appendChild(term);
                    card.appendChild(context);

                    appendMinorAverageMetric(card, 'cgpa', 'CGPA', allocRes.cgpa,
                        allocRes.gpaResolved !== false, allocRes.gpaThreshold, allocRes.cgpaOk);
                    appendMinorAverageMetric(card, 'pgpa', 'Minor PGPA', allocRes.pgpa,
                        allocRes.pgpaResolved !== false && Number(allocRes.pgpaCredits) > 0,
                        allocRes.gpaThreshold, allocRes.pgpaOk);
                    const layers = minorLayerTotals(allocRes);
                    appendMinorProgressMetric(card, 'courses', 'Courses', layers, 'courses', req.minCourses);
                    appendMinorProgressMetric(card, 'su', 'SU Credits', layers, 'credits', req.minSU);

                    const categorySummary = document.createElement('div');
                    categorySummary.className = 'summary_minor_categories';
                    const categoryOrder = ['required', 'core', 'area', 'free'];
                    categoryOrder.forEach((category) => {
                        const cfg = req.categories && req.categories[category];
                        if (!cfg) return;
                        const needCourses = Number(cfg.minCourses) || 0;
                        const needCredits = Number(cfg.minSU) || 0;
                        if (!needCourses && !needCredits) return;
                        const have = allocRes.totals && allocRes.totals[category]
                            ? allocRes.totals[category] : { courses: 0, credits: 0 };
                        const item = document.createElement('div');
                        item.className = `summary_minor_category ${allocRes.perCatOk && allocRes.perCatOk[category] ? 'is-met' : 'is-unmet'}`;
                        item.dataset.category = category;
                        const label = document.createElement('span');
                        label.textContent = category.charAt(0).toUpperCase() + category.slice(1);
                        const value = document.createElement('strong');
                        const coursePart = needCourses ? `${formatMinorValue(have.courses)}/${formatMinorValue(needCourses)} courses` : '';
                        const creditPart = needCredits ? `${formatMinorValue(have.credits)}/${formatMinorValue(needCredits)} SU` : '';
                        value.textContent = [coursePart, creditPart].filter(Boolean).join(' • ');
                        item.appendChild(label);
                        item.appendChild(value);
                        categorySummary.appendChild(item);
                    });
                    if (categorySummary.children.length) card.appendChild(categorySummary);

                    const footer = document.createElement('div');
                    footer.className = 'summary_program_card_footer';
                    const detailsBtn = document.createElement('button');
                    detailsBtn.className = 'btn btn-secondary summary_detail_btn';
                    detailsBtn.type = 'button';
                    detailsBtn.textContent = 'View requirement details';
                    detailsBtn.setAttribute('aria-label', `View ${title} detailed summary`);
                    detailsBtn.addEventListener('click', (event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        showMinorSummary(minorCode);
                    });
                    footer.appendChild(detailsBtn);
                    card.appendChild(footer);
                    organizeProgramOverviewCard(card, { kind: 'minor' });
                    minorGridEl.appendChild(card);
                }
                if (minorGridEl.children.length) minorSectionEl.classList.remove('is-hidden');
            };

            for (const minorCode of minors) {
                const rec = getMinorReq(minorCode);
                const btn = document.createElement('button');
                btn.className = 'btn btn-secondary summary_minor_btn';
                btn.textContent = rec && rec.name ? rec.name : minorCode;
                btn.title = minorCode;
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    showMinorSummary(minorCode);
                });
                minorRow.appendChild(btn);
            }
        }
    } catch (_) {}
    const majorNames = {
        CS: 'Computer Science and Engineering',
        DSA: 'Data Science and Analytics',
        ECON: 'Economics',
        EE: 'Electronics Engineering',
        IE: 'Industrial Engineering',
        MAN: 'Management',
        MAT: 'Materials Science and Nano Engineering',
        ME: 'Mechatronics Engineering',
        BIO: 'Molecular Biology, Genetics and Bioengineering',
        PSIR: 'Political Science and International Relations',
        PSY: 'Psychology',
        VACD: 'Visual Arts and Visual Communications Design'
    };

    const normalizeCode = (v) => String(v || '').toUpperCase().replace(/\s+/g, '');
    const parseInt0 = (v) => {
        const n = parseInt(v || '0', 10);
        return isNaN(n) ? 0 : n;
    };
    const termNameFromCode = (termCode) => {
        const tc = String(termCode || '');
        try {
            const fn = (typeof window !== 'undefined' && typeof window.termCodeToName === 'function') ? window.termCodeToName : null;
            return fn ? fn(tc) : tc;
        } catch (_) {
            return tc;
        }
    };

    function computeMajorAllocation(view, progress) {
        const isDM = view === 'dm';
        const majorCode = isDM ? (curriculum.doubleMajor || '') : (major_chosen_by_user || curriculum.major || '');
        const entryTerm = isDM ? curriculum.entryTermDM : curriculum.entryTerm;
        const effField = isDM ? 'effective_type_dm' : 'effective_type';
        const catalog = isDM
            ? (Array.isArray(curriculum.doubleMajorCourseData) ? curriculum.doubleMajorCourseData : [])
            : ((typeof course_data !== 'undefined' && Array.isArray(course_data)) ? course_data : []);

        const courseByCode = new Map();
        const pools = { university: [], required: [], core: [], area: [], free: [] };
        try {
            for (let i = 0; i < catalog.length; i++) {
                const rec = catalog[i];
                if (!rec) continue;
                const code = normalizeCode((rec.Major || '') + (rec.Code || ''));
                if (!code) continue;
                const baseCat = String(rec.EL_Type || '').toLowerCase();
                courseByCode.set(code, { ...rec, __code: code, __baseCat: baseCat });
                if (pools[baseCat]) pools[baseCat].push(code);
            }
        } catch (_) {}

        const allocationByCode = {};
        const totals = {
            university: { courses: 0, credits: 0 },
            required: { courses: 0, credits: 0 },
            core: { courses: 0, credits: 0 },
            area: { courses: 0, credits: 0 },
            free: { courses: 0, credits: 0 },
        };

        try {
            const progressRecords = progress && progress.layers && progress.layers.projected
                ? progress.layers.projected.records : null;
            for (let i = 0; i < curriculum.semesters.length; i++) {
                const sem = curriculum.semesters[i];
                for (let j = 0; j < sem.courses.length; j++) {
                    const c = sem.courses[j];
                    if (!c || !c.code) continue;
                    const progressState = (typeof curriculum.getCourseProgressState === 'function')
                        ? curriculum.getCourseProgressState(c, sem) : 'earned';
                    if (progressState === 'unsuccessful') continue;

                    const code = normalizeCode(c.code);
                    const progressRecord = progressRecords && typeof progressRecords.get === 'function'
                        ? progressRecords.get(c) : null;
                    const eff = String((progressRecord && progressRecord.effective)
                        || (progressRecords ? 'none' : ((c && c[effField]) || ''))).toLowerCase();
                    if (!eff || eff === 'none') continue;

                    const rec = courseByCode.get(code);
                    const baseCat = rec ? String(rec.__baseCat || '').toLowerCase() : 'none';
                    const credit = progressRecord
                        ? (Number(progressRecord.credit) || 0)
                        : (rec ? parseInt0(rec.SU_credit) : parseInt0(c.SU_credit));

                    allocationByCode[code] = {
                        allocatedCat: eff,
                        baseCat,
                        movedDown: !!(baseCat && eff && baseCat !== eff),
                        credit,
                        progressState,
                        courseId: c.id || '',
                    };
                }
            }
        } catch (_) {}

        try {
            for (const code of Object.keys(allocationByCode)) {
                const a = allocationByCode[code];
                if (!a || !totals[a.allocatedCat]) continue;
                totals[a.allocatedCat].courses += 1;
                totals[a.allocatedCat].credits += a.credit || 0;
            }
        } catch (_) {}

        return { majorCode, entryTerm, courseByCode, pools, allocationByCode, totals };
    }

    const showMajorSummary = (view) => {
        const isDM = view === 'dm';
        const majorProgress = (typeof curriculum.getGraduationProgress === 'function')
            ? curriculum.getGraduationProgress(view) : null;
        const allocRes = computeMajorAllocation(view, majorProgress);
        const majorCode = allocRes.majorCode;
        activateProgramCard(view, majorCode);
        if (!majorCode) return;

        const reqRec = lookupReq(majorCode, allocRes.entryTerm) || {};
        const title = (majorNames[majorCode] || majorCode) + (isDM ? ' — Double Major' : '');
        const termName = termNameFromCode(allocRes.entryTerm);

        const catOrder = ['university', 'required', 'core', 'area', 'free'];
        const catOrderAlloc = ['required', 'core', 'area', 'free'];
        const allocationByCode = allocRes.allocationByCode || {};
        const courseByCode = allocRes.courseByCode || new Map();
        const pools = allocRes.pools || {};
        const totals = allocRes.totals || {};
        const formatNum = (v) => {
            const n = parseFloat(v || '0');
            if (!isFinite(n) || n <= 0) return null;
            return (Math.abs(n - Math.round(n)) < 1e-9) ? String(Math.round(n)) : n.toFixed(1);
        };
        const bsChip = (rec) => {
            if (!rec) return '';
            const bs = formatNum(rec.Basic_Science);
            return bs ? `<span class="ms-chip is-bs">BS ${esc(bs)}</span>` : '';
        };
        const engChip = (rec) => {
            if (!rec) return '';
            const eng = formatNum(rec.Engineering);
            return eng ? `<span class="ms-chip is-eng">ENG ${esc(eng)}</span>` : '';
        };
        const suChip = (su) => `<span class="ms-chip is-su">SU ${esc(su)}</span>`;
        const metaChips = (rec, su) => {
            const chips = [];
            const b = bsChip(rec);
            const e = engChip(rec);
            if (b) chips.push(b);
            if (e) chips.push(e);
            chips.push(suChip(su));
            return chips.join(' ');
        };
        const progressChip = (state) => {
            const labels = { earned: 'Earned', current: 'Current', future: 'Future', unverified: 'Needs grade' };
            const label = labels[state];
            return label ? `<span class="ms-state-chip is-${esc(state)}">${esc(label)}</span>` : '';
        };

        const orderPoolCodes = (codes, sectionCat) => {
            const arr = Array.isArray(codes) ? codes.slice() : [];
            const rank = (code) => {
                const alloc = allocationByCode[code];
                if (!alloc) return getUnsuccessfulAttempt(code) ? 2 : 3;
                if (alloc.allocatedCat === sectionCat) return 0; // taken + counts here
                return 1; // taken + counts elsewhere
            };
            return arr.sort((a, b) => {
                const ra = rank(a);
                const rb = rank(b);
                if (ra !== rb) return ra - rb;
                return String(a).localeCompare(String(b));
            });
        };

        const renderPoolCourse = (code, sectionCat) => {
            const rec = courseByCode.get(code);
            if (!rec) return '';
            const name = rec.Course_Name || '';
            const su = rec.SU_credit || '0';
            const chips = metaChips(rec, su);
            const alloc = allocationByCode[code];
            if (!alloc) {
                const unsuccessful = getUnsuccessfulAttempt(code);
                const statusClass = unsuccessful ? 'is-unsuccessful' : 'is-missing';
                const status = unsuccessful ? 'unsuccessful' : 'not-taken';
                const statusLabel = unsuccessful ? 'Unsuccessful' : 'Not taken';
                return `
                  <div class="ms-course ${statusClass}" data-course-status="${status}">
                    <div class="ms-course-left">
                      <span class="ms-dot"></span>
                      <span class="ms-code">${esc(code)}</span>
                      <span class="ms-name">${esc(name)}</span>
                    </div>
                    <div class="ms-meta"><span class="ms-state-chip ${unsuccessful ? 'is-unsuccessful' : 'is-not-taken'}">${statusLabel}</span>${chips}</div>
                  </div>
                `;
            }
            const isHere = alloc.allocatedCat === sectionCat;
            const statusClass = isHere ? 'is-taken' : 'is-overflow';
            const countsAs = isHere ? '' : ` <span class="ms-meta-note">• Counts as ${esc(String(alloc.allocatedCat || '').toUpperCase())}</span>`;
            const stateChip = progressChip(alloc.progressState);
            return `
              <div class="ms-course ${statusClass}">
                <div class="ms-course-left">
                  <span class="ms-dot"></span>
                  <span class="ms-code">${esc(code)}</span>
                  <span class="ms-name">${esc(name)}</span>
                </div>
                <div class="ms-meta">${stateChip}${chips}${countsAs}</div>
              </div>
            `;
        };

        const renderCountedCourse = (code) => {
            const rec = courseByCode.get(code);
            const alloc = allocationByCode[code];
            const name = rec ? (rec.Course_Name || '') : '';
            const su = rec ? (rec.SU_credit || '0') : String(alloc && alloc.credit ? alloc.credit : '0');
            const chips = metaChips(rec, su);
            if (!alloc) return '';
            const fromTxt = alloc.baseCat && alloc.baseCat !== 'free'
                ? ` <span class="ms-meta-note">• From ${esc(String(alloc.baseCat || '').toUpperCase())}</span>`
                : '';
            return `
              <div class="ms-course ${alloc.movedDown ? 'is-overflow' : 'is-taken'}">
                <div class="ms-course-left">
                  <span class="ms-dot"></span>
                  <span class="ms-code">${esc(code)}</span>
                  <span class="ms-name">${esc(name)}</span>
                </div>
                <div class="ms-meta">${progressChip(alloc.progressState)}${chips}${fromTxt}</div>
              </div>
            `;
        };

        let untakenToggleCounter = 0;
        const renderPoolWithUntakenToggle = (poolCodes, sectionCat) => {
            const ordered = orderPoolCodes(poolCodes, sectionCat);
            const takenCodes = [];
            const unsuccessfulCodes = [];
            const untakenCodes = [];
            for (let i = 0; i < ordered.length; i++) {
                const code = ordered[i];
                if (allocationByCode[code]) takenCodes.push(code);
                else if (getUnsuccessfulAttempt(code)) unsuccessfulCodes.push(code);
                else untakenCodes.push(code);
            }

            if (!ordered.length) return `<div class="ms-empty">No courses listed in this pool.</div>`;

            let html = '';
            if (takenCodes.length) {
                html += takenCodes.map(code => renderPoolCourse(code, sectionCat)).join('');
            }
            if (unsuccessfulCodes.length) {
                html += unsuccessfulCodes.map(code => renderPoolCourse(code, sectionCat)).join('');
            }
            if (!takenCodes.length && !unsuccessfulCodes.length && untakenCodes.length) {
                html += `<div class="ms-empty">No taken courses in this pool yet.</div>`;
            }

            if (untakenCodes.length) {
                const count = untakenCodes.length;
                const hid = `ms-untaken-major-${sectionCat}-${++untakenToggleCounter}`;
                html += `
                  <div class="ms-untaken-wrap">
                    <button type="button" class="btn btn-secondary btn-sm ms-untaken-toggle" data-target="${hid}" data-count="${count}">Show untaken (${count})</button>
                  </div>
                  <div id="${hid}" class="ms-untaken-list is-hidden">
                    ${untakenCodes.map(code => renderPoolCourse(code, sectionCat)).join('')}
                  </div>
                `;
            }
            return html;
        };

        let body = `<div class="major-summary">`;
        body += `<div class="ms-subtitle">Admit term: <strong>${esc(termName || 'Unknown')}</strong></div>`;
        if (majorProgress) {
            const threshold = Number(majorProgress.averageThreshold) || (isDM ? 3.20 : 2.00);
            const averageRow = (label, result) => {
                const value = result && Number(result.value);
                const available = result && result.resolved !== false
                    && Number(result.credits) > 0 && isFinite(value);
                const met = available && value >= threshold;
                const state = !available ? 'is-unavailable' : met ? 'is-met' : 'is-unmet';
                return `<div class="ms-average ${state}"><span>${esc(label)}</span><strong>${available ? value.toFixed(3) : '—'}</strong><small>${available ? '' : 'No graded courses • '}required ≥ ${threshold.toFixed(2)}</small></div>`;
            };
            body += `<div class="ms-average-grid">`;
            body += averageRow('CGPA', majorProgress.gpa);
            if (isDM) body += averageRow('Main PGPA', majorProgress.mainPgpa);
            body += averageRow(isDM ? 'Double-major PGPA' : 'PGPA', majorProgress.pgpa);
            body += `</div>`;
            const estimate = majorProgress.projectedPgpa;
            if (estimate && (Number(estimate.credits) > 0 || Number(estimate.missingCredits) > 0)) {
                const value = Number(estimate.value);
                const missing = Number(estimate.missingCredits) || 0;
                body += `<div class="ms-average-projection">Projected PGPA from entered grades: <strong>${isFinite(value) ? value.toFixed(3) : 'N/A'}</strong>${missing ? ` • ${missing} SU need estimates` : ''}</div>`;
            }
        }
        body += `<div class="ms-legend">
            <div class="ms-legend-item"><span class="ms-dot ms-dot-green"></span>Counts in this pool</div>
            <div class="ms-legend-item"><span class="ms-dot ms-dot-yellow"></span>Counts in a different/lower pool</div>
            <div class="ms-legend-item"><span class="ms-dot ms-dot-red"></span>Attempted, unsuccessful</div>
            <div class="ms-legend-item"><span class="ms-dot ms-dot-gray"></span>Not taken</div>
          </div>`;

        // Special requirements (requirement-groups model): each program's scraped
        // pools / tickers, shown as current/target progress. Empty for programs
        // that carry no groups (the section is simply omitted).
        let groupRows = [];
        let earnedGroupRows = [];
        try {
            if (typeof curriculum.requirementGroupProgress === 'function') {
                groupRows = curriculum.requirementGroupProgress(view, 'projected') || [];
                earnedGroupRows = curriculum.requirementGroupProgress(view, 'earned') || [];
            }
        } catch (_) { groupRows = []; earnedGroupRows = []; }
        const earnedGroupById = new Map(earnedGroupRows.map((g) => [g.id, g]));

        const unitLabel = (unit, n) => {
            if (unit === 'SU') return 'SU';
            if (unit === 'area') return n === 1 ? 'area' : 'areas';
            return n === 1 ? 'course' : 'courses';
        };
        const renderGroupRow = (g) => {
            const target = Number(g.target) || 0;
            const current = Number(g.current) || 0;
            const earnedRow = earnedGroupById.get(g.id) || {};
            const earnedCurrent = Number(earnedRow.current) || 0;
            const isCap = !!g.isCap;
            const ok = !!g.ok;
            const earnedOk = !!earnedRow.ok;
            const ratio = target > 0 ? Math.max(0, Math.min(1, current / target)) : (ok ? 1 : 0);
            const earnedRatio = target > 0 ? Math.max(0, Math.min(1, earnedCurrent / target)) : (earnedOk ? 1 : 0);
            const stateClass = isCap
                ? (!ok ? 'is-over' : (earnedOk ? 'is-met' : 'is-projected'))
                : (earnedOk ? 'is-met' : (ok ? 'is-projected' : 'is-unmet'));
            const badge = isCap ? (!ok ? 'Over limit' : (earnedOk ? 'OK' : 'Projected OK'))
                : (earnedOk ? 'Met' : (ok ? 'Projected' : 'Not met'));
            const capNote = isCap ? ' (max)' : '';
            const suis = g.suis ? `<div class="ms-group-suis">${esc(g.suis)}</div>` : '';
            const note = g.note ? `<div class="ms-group-suis">${esc(g.note)}</div>` : '';
            return `
              <div class="ms-group ${stateClass}">
                <div class="ms-group-top">
                  <div class="ms-group-labels">
                    <div class="ms-group-label">${esc(g.label || g.id || '')}</div>
                    ${suis}${note}
                  </div>
                  <div class="ms-group-count">
                    <span class="ms-group-nums">${esc(String(current))}/${esc(String(target))}</span>
                    <span class="ms-group-earned">${esc(String(earnedCurrent))} earned</span>
                    <span class="ms-group-unit">${esc(unitLabel(g.unit, target))}${capNote}</span>
                    <span class="ms-group-badge">${esc(badge)}</span>
                  </div>
                </div>
                <div class="ms-group-bar"><span class="ms-group-fill is-projected" style="width:${Math.round(ratio * 100)}%"></span><span class="ms-group-fill is-earned" style="width:${Math.round(earnedRatio * 100)}%"></span></div>
              </div>
            `;
        };

        if (groupRows.length) {
            const projectedMetCount = groupRows.filter(g => g.ok).length;
            const earnedMetCount = earnedGroupRows.filter(g => g.ok).length;
            const projectedText = projectedMetCount !== earnedMetCount
                ? ` · ${projectedMetCount}/${groupRows.length} projected` : '';
            body += `<div class="ms-section ms-groups-section">`;
            body += `<div class="ms-header"><div class="ms-title">SPECIAL REQUIREMENTS</div><div class="ms-req">${earnedMetCount}/${groupRows.length} earned${projectedText}</div></div>`;
            body += `<div class="ms-rules">Program-specific pools and faculty-course tickers from your SUIS degree page.</div>`;
            body += `<div class="ms-group-list">${groupRows.map(renderGroupRow).join('')}</div>`;
            body += `</div>`;
        }

        for (const cat of catOrder) {
            const needS = parseInt0(reqRec[cat] || 0);
            const have = totals[cat] || { courses: 0, credits: 0 };
            const poolCodes = Array.isArray(pools[cat]) ? pools[cat].slice() : [];
            const countedCodes = Object.keys(allocationByCode)
                .filter(code => allocationByCode[code] && allocationByCode[code].allocatedCat === cat)
                .sort((a, b) => {
                    const aa = allocationByCode[a];
                    const bb = allocationByCode[b];
                    const ra = (aa && aa.movedDown) ? 1 : 0;
                    const rb = (bb && bb.movedDown) ? 1 : 0;
                    if (ra !== rb) return ra - rb;
                    return String(a).localeCompare(String(b));
                });

            // Only show sections that exist in the requirements or have any counted courses.
            if (!needS && !countedCodes.length && cat !== 'free') continue;

            const showOverflowHere = (cat !== 'required' && cat !== 'university');
            const overflowHere = showOverflowHere
                ? countedCodes.filter(code => {
                    const a = allocationByCode[code];
                    if (!a || !a.movedDown) return false;
                    const baseIdx = catOrderAlloc.indexOf(String(a.baseCat || ''));
                    const catIdx = catOrderAlloc.indexOf(cat);
                    return baseIdx >= 0 && catIdx >= 0 && baseIdx < catIdx;
                })
                : [];

            const progressMetric = majorProgress && majorProgress.breakdown ? majorProgress.breakdown[cat] : null;
            const progressLabel = progressMetric
                ? `${progressMetric.earned} earned • ${progressMetric.projected}/${needS} projected SU`
                : `${have.courses} courses • ${have.credits}/${needS} SU`;
            body += `<div class="ms-section">`;
            body += `<div class="ms-header"><div class="ms-title">${esc(cat.toUpperCase())}</div><div class="ms-req">${esc(progressLabel)}</div></div>`;

            if (cat === 'free') {
                body += `<div class="ms-rules"><strong>Note:</strong> This section only lists courses currently counted as FREE.</div>`;
                body += `<div class="ms-list">`;
                body += countedCodes.length ? countedCodes.map(c => renderCountedCourse(c)).join('') : `<div class="ms-empty">No courses currently count as FREE.</div>`;
                body += `</div></div>`;
                continue;
            }

            if (overflowHere.length) {
                body += `<div class="ms-subheader">Overflow counting here</div>`;
                body += `<div class="ms-list">`;
                body += overflowHere.map(c => renderCountedCourse(c)).join('');
                body += `</div>`;
            }

            body += `<div class="ms-subheader">Course pool</div>`;
            body += `<div class="ms-list">`;
            body += renderPoolWithUntakenToggle(poolCodes, cat);
            body += `</div></div>`;
        }

        body += `</div>`;

        const availableViews = [];
        availableViews.push({ key: 'main', label: (majorNames[major_chosen_by_user] || major_chosen_by_user || 'Main major') });
        if (curriculum.doubleMajor) availableViews.push({ key: 'dm', label: (majorNames[curriculum.doubleMajor] || curriculum.doubleMajor) });

        majorPanelEl.innerHTML = `
          <div class="summary_minor_panel_header">
            <button class="btn btn-secondary summary_back_btn" type="button">Back to summary</button>
            <div class="summary_minor_panel_title">${esc(title)}</div>
          </div>
          <div class="summary_minor_switch_row">
            ${availableViews.map(v => {
                const active = v.key === view ? 'is-active' : '';
                return `<button type="button" class="btn btn-secondary summary_minor_switch_btn ${active}" data-major-view="${esc(v.key)}">${esc(v.label)}</button>`;
            }).join('')}
          </div>
          <div class="summary_minor_panel_body">${body}</div>
        `;
        // Major and double-major details share this panel, so never carry a prior
        // program/section scroll position into the freshly rendered view.
        majorPanelEl.scrollTop = 0;

        try {
            const backBtn = majorPanelEl.querySelector('.summary_back_btn');
            if (backBtn) {
                backBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    showOverview({ focusTab: true });
                });
            }
            majorPanelEl.querySelectorAll('.summary_minor_switch_btn').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const next = btn.getAttribute('data-major-view') || '';
                    if (next) showMajorSummary(next);
                });
            });
            majorPanelEl.querySelectorAll('.ms-untaken-toggle').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const targetId = btn.getAttribute('data-target') || '';
                    const count = btn.getAttribute('data-count') || '0';
                    const target = targetId ? majorPanelEl.querySelector(`#${targetId}`) : null;
                    if (!target) return;
                    const willShow = target.classList.contains('is-hidden');
                    target.classList.toggle('is-hidden', !willShow);
                    btn.textContent = willShow ? `Hide untaken (${count})` : `Show untaken (${count})`;
                });
            });
            wireDetailSectionNavigation(majorPanelEl);
        } catch (_) {}

        try {
            contentEl.dataset.summaryView = 'detail';
            contentEl.dataset.detailProgramKind = view;
            contentEl.dataset.detailProgramCode = String(majorCode || '').toUpperCase();
            majorPanelEl.classList.remove('is-hidden');
            minorPanelEl.classList.add('is-hidden');
            cardsRowEl.classList.add('is-hidden');
            resetVisibleDetailPosition(majorPanelEl);
            connectActiveTabToDetail(majorPanelEl);
            focusDetailBackButton(majorPanelEl);
            overviewSubtitleEl.textContent = `${majorCode} degree-program details`;
        } catch (_) {}
    };

    // Helper to build a summary modal for a given set of totals and limits.
    function buildSummaryModal(totals, limits, gpa, majorCode, view, requirementsAvailable = true, progress = null) {
        const formatValue = (value) => {
            const n = Number(value || 0);
            if (!isFinite(n)) return '0';
            return Math.abs(n - Math.round(n)) < 1e-9 ? String(Math.round(n)) : n.toFixed(1);
        };
        const modal = document.createElement('div');
        modal.classList.add('summary_modal', 'summary_degree_overview_card');
        degreeGridEl.appendChild(modal);
        if (majorCode) {
            appendProgramCardHeading(modal, view, majorCode, majorNames[majorCode] || majorCode);
        }
        const progressStatus = !requirementsAvailable || (progress && progress.available === false)
            ? 'unavailable' : progress && progress.status === 'complete'
                ? 'complete' : progress && progress.status === 'projected'
                    ? 'projected' : 'in-progress';
        modal.dataset.summaryStatus = progressStatus;
        const context = document.createElement('div');
        context.className = 'summary_program_card_context';
        const status = document.createElement('span');
        status.className = `summary_program_status ${progressStatus === 'in-progress' ? 'is-progress' : `is-${progressStatus}`}`;
        status.textContent = progressStatus === 'complete' ? 'Requirements met'
            : progressStatus === 'projected' ? 'Projected complete'
                : progressStatus === 'unavailable' ? 'Requirements unavailable' : 'In progress';
        const admitTermCode = view === 'dm' ? curriculum.entryTermDM : curriculum.entryTerm;
        const admitTerm = document.createElement('span');
        admitTerm.className = 'summary_program_term';
        const admitTermLabel = (() => {
            try { return termNameFromCode(admitTermCode) || String(admitTermCode || 'Unknown term'); } catch (_) {}
            return String(admitTermCode || 'Unknown term');
        })();
        admitTerm.textContent = `Admit term: ${admitTermLabel}`;
        context.appendChild(status);
        context.appendChild(admitTerm);
        modal.appendChild(context);
        const standing = progress && progress.estimatedClassLevel;
        if ((view === 'main' || view === 'dm') && standing && standing.label) {
            const standingRow = document.createElement('div');
            standingRow.className = 'summary_modal_child summary_class_level';
            standingRow.dataset.estimatedClassLevel = String(standing.label);
            standingRow.dataset.earnedSuCredits = String(Number(standing.earnedCredits) || 0);

            const head = document.createElement('div');
            head.className = 'summary_metric_head';
            const label = document.createElement('span');
            label.textContent = 'Estimated class level';
            const value = document.createElement('strong');
            value.textContent = String(standing.label);
            head.appendChild(label);
            head.appendChild(value);

            const explanation = document.createElement('div');
            explanation.className = 'summary_metric_equation';
            explanation.textContent = standing.nextLabel && Number(standing.creditsToNext) > 0
                ? `${formatValue(standing.earnedCredits)} earned SU • ${formatValue(standing.creditsToNext)} SU to ${standing.nextLabel}`
                : `${formatValue(standing.earnedCredits)} earned SU • Highest standing band`;
            explanation.title = 'Estimated from earned SU only. Current-term, future, needs-grade, and unsuccessful courses are excluded.';
            standingRow.appendChild(head);
            standingRow.appendChild(explanation);
            modal.appendChild(standingRow);
        }
        if (!requirementsAvailable) {
            const unavailable = document.createElement('div');
            unavailable.classList.add('summary_modal_child');
            unavailable.textContent = 'Graduation requirements are unavailable for this program and admit term. No completion result was calculated.';
            modal.appendChild(unavailable);
            organizeProgramOverviewCard(modal, { kind: view });
            return modal;
        }
        // Build content. Each metric keeps a machine-readable projected total
        // while visibly explaining which part is earned/current/future/unverified.
        const labels = ['CGPA: ', 'SU Credits: ', 'ECTS: ', 'University: ',  'Required: ', 'Core: ', 'Area: ', 'Free: ',  'Basic Science: ', 'Engineering: '];
        const metricKeys = ['gpa', 'total', 'ects', 'university', 'required', 'core', 'area', 'free', 'science', 'engineering'];
        const total_values = [gpa, totals.total, totals.ects, totals.university, totals.required, totals.core, totals.area, totals.free, totals.science, totals.engineering];
        const appendAverage = (key, label, result, fallbackValue, projectedResult) => {
            const child = document.createElement('div');
            child.classList.add('summary_modal_child');
            child.classList.add('summary_metric');
            child.dataset.metric = key;
            const resolved = !(result && result.resolved === false);
            const value = result && Number(result.credits) > 0 && isFinite(Number(result.value))
                ? Number(result.value) : Number(fallbackValue);
            const display = resolved && isFinite(value) ? value.toFixed(3) : 'N/A';
            const threshold = Number(progress && progress.averageThreshold)
                || (view === 'dm' ? 3.20 : 2.00);
            child.dataset.gpaResolved = String(resolved);
            child.dataset.value = isFinite(value) ? String(value) : '';
            child.dataset.limit = '4';
            child.dataset.threshold = String(threshold);
            child.dataset.met = String(resolved && isFinite(value) && value >= threshold);
            child.innerHTML = `
                <p class="summary_metric_legacy" aria-hidden="true">${label}: ${display} / 4.00</p>
                <div class="summary_metric_head"><span>${label}</span><strong>${display} / 4.00</strong></div>
                <div class="summary_metric_equation"><span>Required ≥ ${threshold.toFixed(2)}</span></div>`;
            if (!resolved) {
                const issues = Array.isArray(result && result.issues) ? result.issues : [];
                const codes = issues.map((issue) => issue.courseCode).filter(Boolean);
                const warning = document.createElement('div');
                warning.className = 'summary_gpa_warning';
                warning.textContent = `${label} unavailable until ${codes.length ? codes.join(', ') : 'the flagged course'} has a valid grade and grading basis.`;
                child.appendChild(warning);
            }
            if (projectedResult) {
                const projectedValue = Number(projectedResult.value);
                const missing = Number(projectedResult.missingCredits) || 0;
                const differs = Number(projectedResult.credits) !== Number(result && result.credits);
                if (differs || missing) {
                    const estimate = document.createElement('div');
                    estimate.className = 'summary_gpa_projection';
                    estimate.textContent = `Entered-grade projection: ${isFinite(projectedValue) ? projectedValue.toFixed(3) : 'N/A'}${missing ? ` • ${missing} SU need estimates` : ''}`;
                    child.appendChild(estimate);
                }
            }
            modal.appendChild(child);
        };
        appendAverage('gpa', 'CGPA', progress && progress.gpa, gpa, null);
        if (view === 'dm') {
            appendAverage('main_pgpa', 'Main PGPA', progress && progress.mainPgpa, NaN,
                progress && progress.projectedMainPgpa);
        }
        appendAverage('pgpa', view === 'dm' ? 'Double-major PGPA' : 'PGPA',
            progress && progress.pgpa, NaN,
            progress && progress.projectedPgpa);

        for (let i = 1; i < 10; i++) {
            const child = document.createElement('div');
            child.classList.add('summary_modal_child');
            child.classList.add('summary_metric');
            child.dataset.metric = metricKeys[i];
            const metric = metricKeys[i];
            const b = (progress && progress.breakdown && progress.breakdown[metric])
                ? progress.breakdown[metric]
                : { earned: total_values[i], current: 0, future: 0, unverified: 0, projected: total_values[i] };
            const earned = Number(b.earned || 0);
            const current = Number(b.current || 0);
            const future = Number(b.future || 0);
            const unverified = Number(b.unverified || 0);
            const projected = Number(b.projected || 0);
            const limit = Number(limits[i] || 0);
            child.dataset.earned = String(earned);
            child.dataset.current = String(current);
            child.dataset.future = String(future);
            child.dataset.unverified = String(unverified);
            child.dataset.projected = String(projected);
            child.dataset.limit = String(limit);
            child.classList.toggle('summary_metric_hero', metric === 'total');
            const label = labels[i].replace(/:\s*$/, '');
            const parts = [
                `<span class="summary_part is-earned"><strong>${formatValue(earned)}</strong> earned</span>`,
            ];
            if (current) parts.push(`<span class="summary_part is-current"><strong>+ ${formatValue(current)}</strong> current</span>`);
            if (future) parts.push(`<span class="summary_part is-future"><strong>+ ${formatValue(future)}</strong> future</span>`);
            if (unverified) parts.push(`<span class="summary_part is-unverified"><strong>+ ${formatValue(unverified)}</strong> needs grade</span>`);
            const denom = Math.max(projected, limit, 1);
            const segment = (state, amount) => amount > 0
                ? `<span class="summary_segment is-${state}" style="width:${Math.max(0, amount) / denom * 100}%"></span>` : '';
            child.innerHTML = `
                <p class="summary_metric_legacy" aria-hidden="true">${label}: ${formatValue(projected)} / ${formatValue(limit)}</p>
                <div class="summary_metric_head"><span>${label}</span><strong>${formatValue(projected)} / ${formatValue(limit)}</strong></div>
                <div class="summary_metric_equation">${parts.join(' ')}</div>
                <div class="summary_segment_track" role="progressbar" aria-label="${esc(label)} progress" aria-valuemin="0" aria-valuemax="${Math.max(1, limit, projected)}" aria-valuenow="${Math.max(0, projected)}">
                    ${segment('earned', earned)}${segment('current', current)}${segment('future', future)}${segment('unverified', unverified)}
                </div>`;
            modal.appendChild(child);
        }
        if (view === 'main' || view === 'dm') {
            const btnWrap = document.createElement('div');
            btnWrap.className = 'summary_program_card_footer';
            const detailsBtn = document.createElement('button');
            detailsBtn.className = 'btn btn-secondary summary_detail_btn';
            detailsBtn.type = 'button';
            detailsBtn.textContent = 'View requirement details';
            detailsBtn.setAttribute('aria-label', `View ${majorNames[majorCode] || majorCode} detailed summary`);
            detailsBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                showMajorSummary(view);
            });
            btnWrap.appendChild(detailsBtn);
            modal.appendChild(btnWrap);
        }
        organizeProgramOverviewCard(modal, { kind: view });
        return modal;
    }
    const formatActualGpa = (progress, legacyPoints, legacyCredits) => {
        // Presence of a progress GPA is authoritative, including the
        // no-actual-grades state. Only use the legacy aggregate for old
        // curriculum objects that do not expose the progress engine at all.
        if (progress && progress.gpa && typeof progress.gpa === 'object') {
            const credits = Number(progress.gpa.credits) || 0;
            const value = Number(progress.gpa.value);
            return progress.gpa.resolved !== false && credits > 0 && isFinite(value)
                ? value.toFixed(3) : 'N/A';
        }
        const credits = Number(legacyCredits) || 0;
        const points = Number(legacyPoints) || 0;
        return credits > 0 ? (points / credits).toFixed(3) : 'N/A';
    };

    // Compute overall GPA and totals for primary major
    let totalsMain = {
        area: 0, core: 0, free: 0, university: 0, required: 0,
        total: 0, science: 0, engineering: 0, ects: 0
    };
    let gpaCredits = 0;
    let gpaValue = 0.0;
    for (let i = 0; i < curriculum.semesters.length; i++) {
        const sem = curriculum.semesters[i];
        totalsMain.total += sem.totalCredit;
        totalsMain.area += sem.totalArea;
        totalsMain.core += sem.totalCore;
        totalsMain.free += sem.totalFree;
        totalsMain.university += sem.totalUniversity;
        totalsMain.required += sem.totalRequired;
        totalsMain.science += sem.totalScience;
        totalsMain.engineering += sem.totalEngineering;
        totalsMain.ects += sem.totalECTS;
        gpaCredits += sem.totalGPACredits;
        gpaValue += sem.totalGPA;
    }
    const progressMain = (typeof curriculum.getGraduationProgress === 'function')
        ? curriculum.getGraduationProgress('main') : null;
    if (progressMain && progressMain.breakdown) {
        Object.keys(totalsMain).forEach((key) => {
            if (progressMain.breakdown[key]) totalsMain[key] = progressMain.breakdown[key].projected;
        });
    }
    const gpaMain = formatActualGpa(progressMain, gpaValue, gpaCredits);
    // Determine limits from requirements for primary major
    // Access the requirements object via the global scope to avoid reference
    // errors when this script runs in environments without an imported
    // variable.
    const allReq = (typeof globalThis !== 'undefined' && globalThis.requirements)
        ? globalThis.requirements
        : {};

    function lookupReq(major, term) {
        if (typeof globalThis !== 'undefined' && typeof globalThis.getRequirementRecord === 'function') {
            return globalThis.getRequirementRecord(major, term);
        }
        if (term && allReq[term] && allReq[term][major]) return allReq[term][major];
        if (allReq[major]) return allReq[major];
        return null;
    }

    function requirementRecordAvailable(major, record) {
        if (typeof globalThis !== 'undefined' && typeof globalThis.isValidRequirementRecord === 'function') {
            return globalThis.isValidRequirementRecord(record, major);
        }
        if (!record || typeof record !== 'object' || Array.isArray(record)) return false;
        const fields = ['university', 'required', 'core', 'area', 'free', 'ects', 'total', 'humRequired'];
        return fields.every(field => Number.isInteger(record[field]) && record[field] >= 0);
    }

    const reqMain = lookupReq(major_chosen_by_user, curriculum.entryTerm);
    const reqMainAvailable = requirementRecordAvailable(major_chosen_by_user, reqMain);
    const safeReqMain = reqMain || {};
    const limitsMain = [
        '4.0',
        String(safeReqMain.total || 0),
        String(safeReqMain.ects || 0),
        String(safeReqMain.university || 0),
        String(safeReqMain.required || 0),
        String(safeReqMain.core || 0),
        String(safeReqMain.area || 0),
        String(safeReqMain.free || 0),
        String(safeReqMain.science || 0),
        String(safeReqMain.engineering || 0)
    ];
    // Build primary summary modal
    buildSummaryModal(totalsMain, limitsMain, gpaMain, major_chosen_by_user, 'main', reqMainAvailable, progressMain);
    // If a double major exists, compute totals for DM and show a second modal
    if (curriculum.doubleMajor) {
        let totalsDM = {
            area: 0, core: 0, free: 0, university: 0, required: 0,
            total: 0, science: 0, engineering: 0, ects: 0
        };
        let gpaCreditsDM = 0;
        let gpaValueDM = 0.0;
        for (let i = 0; i < curriculum.semesters.length; i++) {
            const sem = curriculum.semesters[i];
            // Total credits always sum all courses
            totalsDM.total += sem.totalCredit;
            // Use DM allocations for core/area/free
            totalsDM.core += sem.totalCoreDM || 0;
            totalsDM.area += sem.totalAreaDM || 0;
            totalsDM.free += sem.totalFreeDM || 0;
            // For required and university, use DM-specific totals if present.
            // Fall back to the primary totals if DM totals are undefined,
            // ensuring backward compatibility.
            totalsDM.university += (sem.totalUniversityDM !== undefined ? sem.totalUniversityDM : sem.totalUniversity);
            totalsDM.required += (sem.totalRequiredDM !== undefined ? sem.totalRequiredDM : sem.totalRequired);
            // Science, engineering and ECTS are inherent to the course and
            // counted the same for both majors.  They remain unchanged.
            totalsDM.science += sem.totalScience;
            totalsDM.engineering += sem.totalEngineering;
            totalsDM.ects += sem.totalECTS;
            gpaCreditsDM += sem.totalGPACredits;
            gpaValueDM += sem.totalGPA;
        }
        const progressDM = (typeof curriculum.getGraduationProgress === 'function')
            ? curriculum.getGraduationProgress('dm') : null;
        if (progressDM && progressDM.breakdown) {
            Object.keys(totalsDM).forEach((key) => {
                if (progressDM.breakdown[key]) totalsDM[key] = progressDM.breakdown[key].projected;
            });
        }
        const gpaDM = formatActualGpa(progressDM, gpaValueDM, gpaCreditsDM);
        // Determine limits for DM (SU +30, ECTS +60)
        const dmReq = lookupReq(curriculum.doubleMajor, curriculum.entryTermDM);
        const dmReqAvailable = requirementRecordAvailable(curriculum.doubleMajor, dmReq);
        const safeDmReq = dmReq || {};
        const limitsDM = [
            '4.0',
            String((safeDmReq.total || 0) + 30),
            String((safeDmReq.ects || 0) + 60),
            String(safeDmReq.university || 0),
            String(safeDmReq.required || 0),
            String(safeDmReq.core || 0),
            String(safeDmReq.area || 0),
            String(safeDmReq.free || 0),
            String(safeDmReq.science || 0),
            String(safeDmReq.engineering || 0)
        ];
        buildSummaryModal(totalsDM, limitsDM, gpaDM, curriculum.doubleMajor, 'dm', dmReqAvailable, progressDM);
    }
    try { appendMinorOverviewCards(); } catch (error) {
        try { console.error('Could not build minor overview cards:', error); } catch (_) {}
    }
    updateProgramSurfaceState();
    if (!isMobileSummaryAdapter) {
        summaryResizeHandler = () => {
            programTabsEl.setAttribute('aria-orientation',
                contentEl.classList.contains('is-multiple')
                    && window.matchMedia('(min-width: 1180px) and (min-height: 620px)').matches
                    ? 'vertical' : 'horizontal');
            const compact = !!(document.body && document.body.classList.contains('is-mobile'));
            contentEl.classList.toggle('is-mobile-viewport', compact);
            // A focused desktop program tab becomes hidden in the mobile
            // layout. Keep keyboard focus inside the still-open dialog without
            // changing the active program or the current overview/detail view.
            if (compact && programTabsEl.contains(document.activeElement)) {
                try { closeButtonEl.focus({ preventScroll: true }); } catch (_) {}
            }
        };
        window.addEventListener('resize', summaryResizeHandler, { passive: true });
        summaryResizeHandler();
    }
}

// Attach the functions to the global window so that other scripts can
// call them without using ES module syntax. This is important when
// running under file:// where module imports may fail.
if (typeof window !== 'undefined') {
    window.displayGraduationResults = displayGraduationResults;
    window.displaySummary = displaySummary;
}
