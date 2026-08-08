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

    const parseInt0 = (v) => {
        const n = parseInt(v || '0', 10);
        return isNaN(n) ? 0 : n;
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
        const baseCat = fullOrder.includes(rec.__baseCat) ? rec.__baseCat : 'free';
        const credit = parseInt0(rec.SU_credit);
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
            const poolCodes = pools.required || [];
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

        const isDarkTheme = (() => {
            try { return !!document.body && document.body.classList.contains('dark-theme'); } catch (_) { return false; }
        })();
        const PASS_COLOR = '#16A34A';
        const FAIL_COLOR = '#DC2626';
        const MUTED_COLOR = isDarkTheme ? '#94A3B8' : '#64748B';
        const PROJECTED_COLOR = isDarkTheme ? '#C4B5FD' : '#7C3AED';
        const badgeStyleFor = (state) => {
            const color = state === 'complete' ? PASS_COLOR
                : (state === 'projected' ? PROJECTED_COLOR : (state === 'unavailable' ? MUTED_COLOR : FAIL_COLOR));
            const bg = state === 'complete' ? 'rgba(22, 163, 74, 0.18)'
                : (state === 'projected' ? 'rgba(124, 58, 237, 0.16)'
                    : (state === 'unavailable' ? 'rgba(100, 116, 139, 0.14)' : 'rgba(220, 38, 38, 0.18)'));
            return `color:${color};border-color:${color};background:${bg};`;
        };
        const messageStyleFor = (state) => {
            const color = state === 'complete' ? PASS_COLOR
                : (state === 'projected' ? PROJECTED_COLOR : (state === 'unavailable' ? MUTED_COLOR : FAIL_COLOR));
            return `color:${color};font-weight:700;`;
        };
        const detailStyleForTone = (tone) => {
            if (tone === 'danger') return `color:${FAIL_COLOR};font-weight:700;`;
            if (tone === 'success') return `color:${PASS_COLOR};font-weight:700;`;
            if (tone === 'muted') return `color:${MUTED_COLOR};`;
            return '';
        };

        const renderMetaList = (items) => {
            const rows = Array.isArray(items) ? items.filter(Boolean) : [];
            if (!rows.length) return '';
            return `<div class="graduation_meta_list">${rows.map((item) => {
                const tone = item && item.tone ? ` graduation_meta_item--${esc(item.tone)}` : '';
                const style = detailStyleForTone(item && item.tone ? String(item.tone) : '');
                const styleAttr = style ? ` style="${esc(style)}"` : '';
                return `<div class="graduation_meta_item${tone}"${styleAttr}>${item.html ? item.html : esc(item.text || '')}</div>`;
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
            const badgeStyle = badgeStyleFor(normalizedState);
            const messageStyle = messageStyleFor(normalizedState);
            const messageHtml = message
                ? `<div class="graduation_card_message${messageClass}" style="${esc(messageStyle)}">${esc(message)}</div>`
                : '';
            return `
                <div class="graduation_card ${stateClass}${cardClass}">
                    <div class="graduation_card_head">
                        <div class="graduation_card_title_wrap">
                            <div class="graduation_card_label">${esc(label)}</div>
                            <div class="graduation_card_title">${esc(title)}</div>
                        </div>
                        <div class="graduation_status_badge ${stateClass}" style="${esc(badgeStyle)}">${badgeText}</div>
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
                    text: `Estimated class level: ${standing.label} (${earnedText} earned SU overall; SUrriculum 30/60/90-credit estimate, not an official university classification; unfinished current-term, future, needs-grade, and unsuccessful courses excluded).`,
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

    // Ensure the shared overlay exists.
    let overlayEl = document.querySelector('.summary_modal_overlay');
    if (!overlayEl) {
        overlayEl = document.createElement('div');
        overlayEl.classList.add('summary_modal_overlay');
        document.body.appendChild(overlayEl);
    }

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

    const headerRowEl = document.createElement('div');
    headerRowEl.className = 'summary_header_row';
    contentEl.appendChild(headerRowEl);

    const cardsRowEl = document.createElement('div');
    cardsRowEl.className = 'summary_cards_row';
    contentEl.appendChild(cardsRowEl);

    const minorPanelEl = document.createElement('div');
    minorPanelEl.className = 'summary_minor_panel is-hidden';
    contentEl.appendChild(minorPanelEl);

    const majorPanelEl = document.createElement('div');
    majorPanelEl.className = 'summary_major_panel is-hidden';
    contentEl.appendChild(majorPanelEl);

    const showOverview = () => {
        try {
            minorPanelEl.classList.add('is-hidden');
            majorPanelEl.classList.add('is-hidden');
            cardsRowEl.classList.remove('is-hidden');
            headerRowEl.classList.remove('is-hidden');
        } catch (_) {}
    };

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

    // Minor buttons: show a compact, visual guide for each selected minor,
    // and render the minor summary inside the same overlay (hiding majors).
    try {
        const minors = Array.isArray(curriculum.minors) ? curriculum.minors.filter(Boolean) : [];
        if (minors.length) {
            const minorRow = document.createElement('div');
            minorRow.className = 'summary_minor_row';
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
                showOverview();
            };

            const showMinorSummary = (minorCode) => {
                try { majorPanelEl.classList.add('is-hidden'); } catch (_) {}
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
                        body += `<div class="ms-subtitle" style="color: #DC2626; font-weight: 700;">CGPA unavailable: review the grading basis of the flagged NA course.</div>`;
                    } else if (isFinite(allocRes.cgpa) && allocRes.gpaThreshold) {
                        const cgpaStr = Number(allocRes.cgpa).toFixed(3);
                        const thrStr = Number(allocRes.gpaThreshold).toFixed(2);
                        const ok = allocRes.gpaOk !== false;
                        const color = ok ? 'color: var(--text-secondary);' : 'color: #DC2626; font-weight: 700;';
                        body += `<div class="ms-subtitle" style="${color}">CGPA requirement: <strong>${thrStr}</strong> • Your CGPA: <strong>${cgpaStr}</strong></div>`;
                    } else {
                        body += `<div class="ms-subtitle">CGPA requirement: <strong>${(String(minorCode || '').toUpperCase() === 'ENTREP-MINOR') ? '2.50' : '2.72'}</strong></div>`;
                    }
                    const thrStr = Number(allocRes.gpaThreshold || 0).toFixed(2);
                    if (allocRes.pgpaResolved === false) {
                        body += `<div class="ms-subtitle" style="color: #DC2626; font-weight: 700;">Minor PGPA unavailable: review the program-course grades.</div>`;
                    } else if (isFinite(allocRes.pgpa)) {
                        const pgpaStr = Number(allocRes.pgpa).toFixed(3);
                        const color = allocRes.pgpaOk !== false
                            ? 'color: var(--text-secondary);' : 'color: #DC2626; font-weight: 700;';
                        body += `<div class="ms-subtitle" style="${color}">Minor PGPA requirement: <strong>${thrStr}</strong> • Your PGPA: <strong>${pgpaStr}</strong></div>`;
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
                    <button class="btn btn-secondary summary_back_btn" type="button">Back to majors</button>
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
                } catch (_) {}

                try {
                    minorPanelEl.classList.remove('is-hidden');
                    cardsRowEl.classList.add('is-hidden');
                    headerRowEl.classList.add('is-hidden');
                } catch (_) {}
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
                return `<div class="ms-average ${met ? 'is-met' : 'is-unmet'}"><span>${esc(label)}</span><strong>${available ? value.toFixed(3) : 'N/A'}</strong><small>required ≥ ${threshold.toFixed(2)}</small></div>`;
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

        try {
            const backBtn = majorPanelEl.querySelector('.summary_back_btn');
            if (backBtn) {
                backBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    showOverview();
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
        } catch (_) {}

        try {
            majorPanelEl.classList.remove('is-hidden');
            minorPanelEl.classList.add('is-hidden');
            cardsRowEl.classList.add('is-hidden');
            headerRowEl.classList.add('is-hidden');
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
        modal.classList.add('summary_modal');
        cardsRowEl.appendChild(modal);
        if (majorCode) {
            const header = document.createElement('div');
            header.classList.add('summary_modal_title');
            header.textContent = majorNames[majorCode] || majorCode;
            modal.appendChild(header);
        }
        const standing = progress && progress.estimatedClassLevel;
        if (view === 'main' && standing && standing.label) {
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
            explanation.textContent = `SUrriculum 30/60/90-credit estimate based on ${formatValue(standing.earnedCredits)} earned SU credits overall; not an official university classification. Unfinished current-term, future, needs-grade, and unsuccessful courses are excluded.`;
            standingRow.appendChild(head);
            standingRow.appendChild(explanation);
            modal.appendChild(standingRow);
        }
        if (!requirementsAvailable) {
            const unavailable = document.createElement('div');
            unavailable.classList.add('summary_modal_child');
            unavailable.textContent = 'Graduation requirements are unavailable for this program and admit term. No completion result was calculated.';
            modal.appendChild(unavailable);
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
                <div class="summary_segment_track" aria-hidden="true">
                    ${segment('earned', earned)}${segment('current', current)}${segment('future', future)}${segment('unverified', unverified)}
                </div>`;
            modal.appendChild(child);
        }
        if (view === 'main' || view === 'dm') {
            const btnWrap = document.createElement('div');
            btnWrap.style.marginTop = '6px';
            const detailsBtn = document.createElement('button');
            detailsBtn.className = 'btn btn-secondary summary_detail_btn';
            detailsBtn.type = 'button';
            detailsBtn.textContent = 'View detailed summary';
            detailsBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                showMajorSummary(view);
            });
            btnWrap.appendChild(detailsBtn);
            modal.appendChild(btnWrap);
        }
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
}

// Attach the functions to the global window so that other scripts can
// call them without using ES module syntax. This is important when
// running under file:// where module imports may fail.
if (typeof window !== 'undefined') {
    window.displayGraduationResults = displayGraduationResults;
    window.displaySummary = displaySummary;
}
