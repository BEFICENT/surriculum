// Graduation-check result modal presentation.
(function installGraduationResults(root) {
    'use strict';

    function createGraduationResultsPresenter(dependencies) {
        const config = dependencies || {};
        const window = config.window || root;
        const document = config.document || window.document;
        const globalThis = window;
        const allocation = config.minorAllocation
            || (window.SurriculumModules && window.SurriculumModules.minorAllocation);
        if (!allocation
            || typeof allocation.computeMinorAllocation !== 'function'
            || typeof allocation.courseCountsTowardDegreePlan !== 'function') {
            throw new Error('Graduation results require SurriculumModules.minorAllocation');
        }
        const computeMinorAllocation = allocation.computeMinorAllocation;
        const courseCountsTowardDegreePlan = allocation.courseCountsTowardDegreePlan;
        // These ES-module bridges can install after deferred classic scripts, so
        // the wrappers intentionally resolve their implementation at call time.
        const escapeHtml = (...args) => {
            const helper = typeof config.escapeHtml === 'function'
                ? config.escapeHtml : window.escapeHtml;
            if (typeof helper !== 'function') throw new Error('escapeHtml is unavailable');
            return helper(...args);
        };
        const buildFlagMessages = (...args) => {
            const builder = typeof config.buildFlagMessages === 'function'
                ? config.buildFlagMessages : window.buildFlagMessages;
            if (typeof builder !== 'function') {
                throw new Error('buildFlagMessages is unavailable');
            }
            return builder(...args);
        };

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

        return Object.freeze({ displayGraduationResults });
    }

    const presenter = createGraduationResultsPresenter({ window: root });
    const api = Object.freeze({
        create: createGraduationResultsPresenter,
        displayGraduationResults: presenter.displayGraduationResults,
    });
    root.SurriculumGraduationResults = api;
    root.displayGraduationResults = api.displayGraduationResults;
})(typeof window !== 'undefined' ? window : globalThis);
