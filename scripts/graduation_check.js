// Graduation summary orchestration. Domain policy and reusable presentation
// controllers are installed by the preceding classic scripts.
(function installGraduationCheck(root) {
'use strict';

const window = root;
const document = root.document;
const globalThis = root;
const allocationApi = root.SurriculumModules && root.SurriculumModules.minorAllocation;
const graduationResultsApi = root.SurriculumGraduationResults;
const graduationSummaryShellApi = root.SurriculumGraduationSummaryShell;
const graduationMinorSummaryApi = root.SurriculumGraduationMinorSummary;
if (!allocationApi
    || typeof allocationApi.computeMinorAllocation !== 'function'
    || typeof allocationApi.courseCountsTowardDegreePlan !== 'function') {
    throw new Error('graduation_check.js requires SurriculumModules.minorAllocation');
}
if (!graduationResultsApi || typeof graduationResultsApi.displayGraduationResults !== 'function') {
    throw new Error('graduation_check.js requires SurriculumGraduationResults');
}
if (!graduationSummaryShellApi || typeof graduationSummaryShellApi.create !== 'function') {
    throw new Error('graduation_check.js requires SurriculumGraduationSummaryShell');
}
if (!graduationMinorSummaryApi || typeof graduationMinorSummaryApi.create !== 'function') {
    throw new Error('graduation_check.js requires SurriculumGraduationMinorSummary');
}

// Function to display summary of credits
function displaySummary(curriculum, major_chosen_by_user) {
    const summaryShell = graduationSummaryShellApi.create({
        curriculum,
        window,
        document,
        HTMLElement: root.HTMLElement,
    });
    if (!summaryShell) return;
    const {
        esc,
        contentEl,
        headerRowEl,
        overviewSubtitleEl,
        cardsRowEl,
        degreeGridEl,
        minorSectionEl,
        minorGridEl,
        activateProgramCard,
        minorPanelEl,
        majorPanelEl,
        connectActiveTabToDetail,
        focusDetailBackButton,
        wireDetailSectionNavigation,
        resetVisibleDetailPosition,
        showOverview,
        getTakenCourseCodes,
        getUnsuccessfulAttempt,
        appendProgramCardHeading,
        organizeProgramOverviewCard,
    } = summaryShell;


    const minorSummaryController = graduationMinorSummaryApi.create({
        curriculum,
        window,
        document,
        summaryShell,
        minorAllocation: allocationApi,
        getProgressMain: () => progressMain,
        formatTermName: (termCode) => termNameFromCode(termCode),
    });
    const appendMinorOverviewCards = minorSummaryController.appendMinorOverviewCards;
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
    summaryShell.finalize();

}

// Retain the Summary compatibility global consumed by main.js. The graduation
// results presenter publishes its own compatibility global before this script.
root.displaySummary = displaySummary;
})(typeof window !== 'undefined' ? window : globalThis);
