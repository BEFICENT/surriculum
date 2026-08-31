// Minor overview cards and requirement-detail navigation for Graduation Summary.
(function installGraduationMinorSummary(root) {
    'use strict';

    const namespace = root.SurriculumModules || (root.SurriculumModules = {});
    const defaultMinorAllocation = namespace.minorAllocation;
    const summaryShellApi = root.SurriculumGraduationSummaryShell;
    if (!defaultMinorAllocation
        || typeof defaultMinorAllocation.computeMinorAllocation !== 'function'
        || typeof defaultMinorAllocation.courseCountsTowardDegreePlan !== 'function') {
        throw new Error('graduation-minor-summary.js requires SurriculumModules.minorAllocation');
    }
    if (!summaryShellApi || typeof summaryShellApi.create !== 'function') {
        throw new Error('graduation-minor-summary.js requires SurriculumGraduationSummaryShell');
    }

    function createGraduationMinorSummary(options) {
        const config = options || {};
        const curriculum = config.curriculum;
        const window = config.window || root;
        const document = config.document || window.document;
        const summaryShell = config.summaryShell;
        const minorAllocation = config.minorAllocation || defaultMinorAllocation;
        const getProgressMain = typeof config.getProgressMain === 'function'
            ? config.getProgressMain : () => null;
        const formatTermName = typeof config.formatTermName === 'function'
            ? config.formatTermName : (termCode) => String(termCode || '');
        if (!summaryShell || typeof summaryShell.esc !== 'function') {
            throw new Error('graduation minor summary requires a configured summaryShell');
        }
        if (!minorAllocation
            || typeof minorAllocation.computeMinorAllocation !== 'function'
            || typeof minorAllocation.courseCountsTowardDegreePlan !== 'function') {
            throw new Error('graduation minor summary requires minorAllocation');
        }

        const computeMinorAllocation = minorAllocation.computeMinorAllocation;
        const courseCountsTowardDegreePlan = minorAllocation.courseCountsTowardDegreePlan;
        const currentProgressGpa = () => {
            const progress = getProgressMain();
            return progress && progress.gpa;
        };
        const {
            esc,
            contentEl,
            headerRowEl,
            overviewSubtitleEl,
            cardsRowEl,
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
                    progressGpa: currentProgressGpa(),
                });
                const earnedAllocRes = computeMinorAllocation(curriculum, minorCode, {
                    progressGpa: currentProgressGpa(),
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
                    const progressGpa = currentProgressGpa();
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
                    const termLabel = req.term || formatTermName(allocRes.termCode) || 'Unknown term';
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

        return Object.freeze({ appendMinorOverviewCards });
    }

    root.SurriculumGraduationMinorSummary = Object.freeze({
        create: createGraduationMinorSummary,
    });
})(typeof window !== 'undefined' ? window : globalThis);
