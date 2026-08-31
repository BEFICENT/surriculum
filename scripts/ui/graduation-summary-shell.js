// Shared shell, navigation, and accessibility behavior for the graduation summary.
(function installGraduationSummaryShell(root) {
    'use strict';

    function createGraduationSummaryShell(options) {
        const config = options || {};
        const curriculum = config.curriculum;
        const window = config.window || root;
        const document = config.document || window.document;
        const HTMLElement = config.HTMLElement || window.HTMLElement;
        // Resolve the ES-module bridge lazily because classic deferred scripts can
        // execute before module evaluation on hosted and file:// entry points.
        const escapeHtml = (...args) => {
            const helper = typeof config.escapeHtml === 'function'
                ? config.escapeHtml : window.escapeHtml;
            if (typeof helper !== 'function') throw new Error('escapeHtml is unavailable');
            return helper(...args);
        };

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

        const finalize = () => {
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
        };

        return Object.freeze({
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
            finalize,
        });
    }

    root.SurriculumGraduationSummaryShell = Object.freeze({
        create: createGraduationSummaryShell,
    });
})(typeof window !== 'undefined' ? window : globalThis);
