// Planner course-detail loading and modal presentation.
(function installPlannerCourseDetailsController(root) {
    'use strict';

    function escapeHtmlFallback(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function create(host) {
        const global = host || {};

        async function open(context) {
            const input = context || {};
            const event = input.event;
            const eventTarget = event && event.target;
            const escapeHtml = typeof input.escapeHtml === 'function'
                ? input.escapeHtml : escapeHtmlFallback;
            const btn = (() => {
                try {
                    return eventTarget && eventTarget.closest
                        ? eventTarget.closest('button.details_course') : null;
                } catch (_) {
                    return null;
                }
            })() || eventTarget;
            const container = (() => {
                try { return btn && btn.closest ? btn.closest('.course_container') : null; } catch (_) { return null; }
            })();
            const codeEl = (() => {
                try { return container ? container.querySelector('.course_code') : null; } catch (_) { return null; }
            })();
            const courseCode = codeEl ? String(codeEl.textContent || '').trim() : '';
            if (!courseCode) return false;

            const buildCourseUrl = (code) => {
                const match = String(code || '').toUpperCase().replace(/\s+/g, '').match(/^([A-Z]+)([0-9A-Z]+)$/);
                if (!match) return '';
                return (
                    'https://suis.sabanciuniv.edu/prod/sabanci_www.p_get_courses' +
                    '?levl_code=UG' +
                    '&subj_code=' + encodeURIComponent(match[1]) +
                    '&crse_numb=' + encodeURIComponent(match[2]) +
                    '&lang=eng'
                );
            };

            try {
                const ui = global.uiModal;
                const load = global.loadCoursePageInfoIndex;
                const loadInstructorHistory = global.loadCourseInstructorHistoryIndex;
                const loadSectionHistory = global.loadCourseSectionHistoryIndex;
                if (!ui || typeof ui.alert !== 'function') return false;
                if (typeof load !== 'function') {
                    ui.alert('Details unavailable', '<p>Course details index is not available.</p>');
                    return false;
                }

                const loadIndexSafely = (loader) => {
                    if (typeof loader !== 'function') return Promise.resolve(null);
                    try {
                        return Promise.resolve(loader()).catch(() => null);
                    } catch (_) {
                        return Promise.resolve(null);
                    }
                };
                const [idx, instructorHistoryIdx, sectionHistoryIdx] = await Promise.all([
                    loadIndexSafely(load),
                    loadIndexSafely(loadInstructorHistory),
                    loadIndexSafely(loadSectionHistory),
                ]);
                const info = idx && typeof idx.get === 'function' ? idx.get(courseCode) : null;
                const instructorHistoryInfo = (
                    instructorHistoryIdx && typeof instructorHistoryIdx.get === 'function'
                        ? instructorHistoryIdx.get(courseCode)
                        : null
                );
                const sectionHistoryInfo = (
                    sectionHistoryIdx && typeof sectionHistoryIdx.get === 'function'
                        ? sectionHistoryIdx.get(courseCode)
                        : null
                );
                if (!info) {
                    ui.alert(
                        'Details unavailable',
                        `<p>No details found for <strong>${escapeHtml(courseCode)}</strong>.</p>` +
                        '<p>This may be a custom course, or the scrape index is missing this course.</p>'
                    );
                    return false;
                }

                const title = info.title || info.header_text || '';
                const su = (typeof info.su_credits !== 'undefined' && info.su_credits !== null)
                    ? info.su_credits : info.su_credit;
                const ects = info.ects;
                const bs = info.basic_science;
                const eng = info.engineering;
                const prereq = info.prerequisites;
                const coreq = info.corequisites;
                const generalPrereq = info.general_requirement_prerequisites;
                const minimumPriorSu = info.minimum_earned_su_credits;
                const generalRequirements = info.general_requirements;
                const desc = (info.description || '').toString();
                const offered = Array.isArray(info.last_offered_terms) ? info.last_offered_terms : [];
                const url = info.source_url || buildCourseUrl(courseCode);
                const registrationDescription = (() => {
                    try {
                        const registry = global.registrationRules;
                        return registry && typeof registry.describeRule === 'function'
                            ? registry.describeRule(courseCode) : null;
                    } catch (_) {
                        return null;
                    }
                })();
                const registrationEvaluation = (() => {
                    try {
                        const shared = global.courseRequisites;
                        const filters = global.courseFilters;
                        const curriculum = global.curriculum;
                        const semesterElement = container && container.closest
                            ? container.closest('.semester') : null;
                        const semester = curriculum && semesterElement
                            && typeof curriculum.getSemester === 'function'
                            ? curriculum.getSemester(semesterElement.id) : null;
                        const targetContext = filters && typeof filters.buildTargetContext === 'function'
                            ? filters.buildTargetContext(curriculum, semester) : null;
                        if (!shared || typeof shared.evaluateCandidateForTerm !== 'function') return null;
                        const result = shared.evaluateCandidateForTerm(info, courseCode, targetContext);
                        return result && result.supplemental ? result.supplemental : null;
                    } catch (_) {
                        return null;
                    }
                })();
                const supplementalGuidance = registrationEvaluation || registrationDescription;
                const hasSupplementalGuidance = !!(
                    supplementalGuidance
                    && (
                        supplementalGuidance.hasRule
                        || supplementalGuidance.ruleId
                        || (Array.isArray(supplementalGuidance.guidance)
                            && supplementalGuidance.guidance.length)
                    )
                );
                const supplementalSource = hasSupplementalGuidance
                    && supplementalGuidance.source && typeof supplementalGuidance.source === 'object'
                    ? supplementalGuidance.source : {};

                const formatDescription = (value) => {
                    const raw = String(value || '').trim();
                    if (!raw) return '';
                    return raw
                        .replace(/\r\n/g, '\n')
                        .replace(/\n{2,}/g, '\u0000')
                        .replace(/[ \t]*\n[ \t]*/g, ' ')
                        .replace(/\u0000/g, '\n\n')
                        .replace(/[ \t]{2,}/g, ' ')
                        .trim();
                };

                const fmt = (value) => {
                    try {
                        if (typeof global.formatCreditValue === 'function') {
                            return global.formatCreditValue(value);
                        }
                    } catch (_) {}
                    const parsed = parseFloat(value || '0');
                    return (Number.isFinite(parsed) ? parsed : 0).toFixed(1);
                };

                const formattedDesc = formatDescription(desc);
                const descHtml = formattedDesc && supplementalSource.supersedesDescription !== true
                    ? `<div class="course-details-section"><h4>Description</h4><p>${escapeHtml(formattedDesc).replace(/\n\n/g, '<br><br>')}</p></div>`
                    : '';
                const prereqHtml = prereq || (!generalPrereq && !hasSupplementalGuidance)
                    ? '<div class="course-details-section"><h4>Prerequisites</h4><p>'
                        + (prereq ? escapeHtml(prereq) : 'None') + '</p></div>'
                    : '';
                const generalRequirementsText = generalRequirements || (
                    minimumPriorSu != null && String(minimumPriorSu).trim()
                        ? `Minimum ${fmt(minimumPriorSu)} prior SU credits.` : ''
                );
                const generalRequirementsHtml = generalRequirementsText
                    ? '<div class="course-details-section"><h4>General requirements</h4><p>'
                        + escapeHtml(generalRequirementsText) + '</p></div>'
                    : '';
                const supplementalGuidanceHtml = (() => {
                    if (!hasSupplementalGuidance) return '';
                    const guidanceApi = global.courseFilters;
                    const guidance = guidanceApi
                        && typeof guidanceApi.supplementalGuidanceItems === 'function'
                        ? guidanceApi.supplementalGuidanceItems(supplementalGuidance, {
                            includeMet: true,
                            includeComponents: true,
                            includeAllBranches: !registrationEvaluation,
                        })
                        : (Array.isArray(supplementalGuidance.guidance)
                            ? supplementalGuidance.guidance : []);
                    const seen = new Set();
                    const items = guidance.map((item) => (
                        String(item && item.text ? item.text : item || '').trim()
                    )).filter((text) => {
                        if (!text || seen.has(text)) return false;
                        seen.add(text);
                        return true;
                    });
                    if (!items.length && supplementalSource.summary) {
                        items.push(String(supplementalSource.summary));
                    }
                    const state = String(supplementalGuidance.status || 'review').toLowerCase();
                    const stateLabel = state === 'met' ? 'Met'
                        : (state === 'unmet' ? 'Needs attention' : 'Review');
                    const sourceUrl = supplementalSource.url || url;
                    const authority = supplementalSource.authority || 'SUIS';
                    const reviewedAt = supplementalSource.reviewedAt
                        ? `, reviewed ${String(supplementalSource.reviewedAt)}` : '';
                    const sourceLine = sourceUrl
                        ? `<a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(authority)} course page</a>${escapeHtml(reviewedAt)}`
                        : `${escapeHtml(authority)}${escapeHtml(reviewedAt)}`;
                    return '<div class="course-details-section course-registration-guidance">'
                        + '<div class="course-registration-guidance-heading">'
                        + '<h4>Registration guidance</h4>'
                        + `<span class="course-registration-state is-${escapeHtml(state)}">${escapeHtml(stateLabel)}</span>`
                        + '</div>'
                        + (items.length
                            ? '<ul class="course-details-list">'
                                + items.map((text) => `<li>${escapeHtml(text)}</li>`).join('')
                                + '</ul>'
                            : '<p>Review the linked course page before registration.</p>')
                        + `<p class="course-registration-source">Source: ${sourceLine}.</p>`
                        + '<p class="course-registration-advisory">Advisory only—confirm eligibility and any exceptions in SUIS or with your advisor.</p>'
                        + '</div>';
                })();

                const instructorHistory = (
                    instructorHistoryInfo && Array.isArray(instructorHistoryInfo.history)
                        ? instructorHistoryInfo.history
                        : []
                );
                const sectionHistory = (
                    sectionHistoryInfo && Array.isArray(sectionHistoryInfo.history)
                        ? sectionHistoryInfo.history
                        : []
                );
                const normalizeTerm = (value) => {
                    try {
                        if (typeof global.normalizeTermIdentifier === 'function') {
                            return global.normalizeTermIdentifier(value);
                        }
                    } catch (_) {}
                    return String(value || '').trim();
                };
                const displayTerm = (value) => {
                    try {
                        if (typeof global.displayTermIdentifier === 'function') {
                            return global.displayTermIdentifier(value);
                        }
                    } catch (_) {}
                    return String(value || '').trim();
                };
                const termHistoryMap = new Map();
                offered.forEach((entry) => {
                    const term = normalizeTerm(entry && entry.term ? String(entry.term) : '');
                    if (!term) return;
                    const existing = termHistoryMap.get(term) || { term, instructors: [] };
                    termHistoryMap.set(term, existing);
                });
                instructorHistory.forEach((entry) => {
                    const term = normalizeTerm(entry && entry.term ? String(entry.term) : '');
                    if (!term) return;
                    const existing = termHistoryMap.get(term) || { term, instructors: [] };
                    const instructors = entry && Array.isArray(entry.instructors)
                        ? entry.instructors.filter(Boolean).map(name => String(name))
                        : [];
                    existing.instructors = Array.from(new Set([
                        ...(existing.instructors || []),
                        ...instructors,
                    ])).sort();
                    termHistoryMap.set(term, existing);
                });
                const sectionTerms = new Set();
                const sectionRows = sectionHistory
                    .map((entry) => {
                        const term = normalizeTerm(entry && entry.term ? String(entry.term) : '');
                        if (!term) return null;
                        sectionTerms.add(term);
                        return {
                            term,
                            termCode: term,
                            section: entry && entry.section ? String(entry.section) : '',
                            crn: entry && entry.crn ? String(entry.crn) : '',
                            instructors: entry && Array.isArray(entry.instructors)
                                ? entry.instructors.filter(Boolean).map(name => String(name))
                                : [],
                            capacity: entry ? entry.capacity : null,
                            actual: entry ? entry.actual : null,
                            remaining: entry ? entry.remaining : null,
                            showSeats: true,
                        };
                    })
                    .filter(Boolean);
                const fallbackRows = Array.from(termHistoryMap.values())
                    .filter(entry => entry && entry.term && !sectionTerms.has(entry.term))
                    .map(entry => ({
                        term: entry.term,
                        termCode: entry.term,
                        section: '',
                        crn: '',
                        instructors: entry && Array.isArray(entry.instructors)
                            ? entry.instructors.filter(Boolean).map(name => String(name))
                            : [],
                        capacity: null,
                        actual: null,
                        remaining: null,
                        showSeats: true,
                        summaryOnly: true,
                    }));
                const limitRowsByDistinctTerms = (rows, maxTerms) => {
                    const seenTerms = new Set();
                    return rows.filter((row) => {
                        const term = row && row.term ? String(row.term) : '';
                        if (!term) return false;
                        if (!seenTerms.has(term) && seenTerms.size >= maxTerms) return false;
                        seenTerms.add(term);
                        return true;
                    });
                };
                const sortedTermHistoryRows = [...sectionRows, ...fallbackRows]
                    .sort((left, right) => {
                        const termDiff = parseInt(String(right.term || '0'), 10)
                            - parseInt(String(left.term || '0'), 10);
                        if (termDiff) return termDiff;
                        return String(left.section || '').localeCompare(String(right.section || ''))
                            || String(left.crn || '').localeCompare(String(right.crn || ''));
                    });
                const termHistoryRows = limitRowsByDistinctTerms(sortedTermHistoryRows, 24);
                const fullTermCount = new Set(
                    termHistoryRows.map(row => row && row.term).filter(Boolean),
                ).size;
                const termHistoryHtml = termHistoryRows.length
                    ? (
                        '<div class="course-details-section">' +
                        `<h4>Offered Terms, Instructors & Seats (${fullTermCount || termHistoryMap.size})</h4>` +
                        '<div class="course-history-anchor" data-course-history-anchor="planner"></div>' +
                        '</div>'
                    )
                    : '<div class="course-details-section"><h4>Offered Terms, Instructors & Seats</h4><p>Not available.</p></div>';

                const termHistoryRowsForDom = termHistoryRows.map(entry => ({
                    term: entry && entry.term ? displayTerm(entry.term) : 'Unknown term',
                    termCode: entry && entry.termCode
                        ? entry.termCode : (entry && entry.term ? entry.term : ''),
                    section: entry && entry.section ? entry.section : '',
                    crn: entry && entry.crn ? entry.crn : '',
                    instructors: entry && Array.isArray(entry.instructors)
                        ? entry.instructors.filter(Boolean).map(name => String(name))
                        : [],
                    capacity: entry ? entry.capacity : null,
                    actual: entry ? entry.actual : null,
                    remaining: entry ? entry.remaining : null,
                    showSeats: true,
                    summaryOnly: !!(entry && entry.summaryOnly),
                }));

                const body =
                    '<div class="course-details-modal">' +
                    `<p><strong>${escapeHtml(courseCode)}</strong>${title ? ` — ${escapeHtml(title)}` : ''}</p>` +
                    '<div class="course-details-meta">' +
                    `<div><span class="muted">SU Credits:</span> ${escapeHtml(fmt(su))}</div>` +
                    `<div><span class="muted">ECTS:</span> ${escapeHtml(fmt(ects))}</div>` +
                    (bs != null ? `<div><span class="muted">Basic Science:</span> ${escapeHtml(fmt(bs))}</div>` : '') +
                    (eng != null ? `<div><span class="muted">Engineering:</span> ${escapeHtml(fmt(eng))}</div>` : '') +
                    '</div>' +
                    prereqHtml +
                    generalRequirementsHtml +
                    supplementalGuidanceHtml +
                    '<div class="course-details-section"><h4>Corequisites</h4><p>'
                        + (coreq ? escapeHtml(coreq) : 'None') + '</p></div>' +
                    descHtml +
                    termHistoryHtml +
                    '</div>';

                ui.alert('Course Details', body, {
                    buttons: [
                        { action: 'close', label: 'Close', variant: 'secondary' },
                        ...(url ? [{
                            action: 'open-course-page',
                            label: 'Open course page',
                            variant: 'primary',
                            href: url,
                            closeOnClick: false,
                        }] : []),
                    ],
                    onMount: ({ body: modalBody }) => {
                        try {
                            const anchor = modalBody
                                ? modalBody.querySelector('[data-course-history-anchor="planner"]')
                                : null;
                            const build = global.buildCourseHistoryTableElement;
                            if (!anchor || typeof build !== 'function') return;
                            const node = build(termHistoryRowsForDom, {
                                splitTerms: true,
                                openOffered: true,
                                openFuture: false,
                            });
                            if (node) anchor.appendChild(node);
                        } catch (_) {}
                    },
                });
                return true;
            } catch (_) {
                try {
                    const ui = global.uiModal;
                    if (ui && typeof ui.alert === 'function') {
                        ui.alert('Details unavailable', '<p>Failed to load course details.</p>');
                    }
                } catch (_) {}
                return false;
            }
        }

        return Object.freeze({ open });
    }

    const browser = create(root);
    root.SurriculumModules = root.SurriculumModules || {};
    root.SurriculumModules.plannerCourseDetails = Object.freeze({
        create,
        open: browser.open,
    });
})(typeof window !== 'undefined' ? window : globalThis);
