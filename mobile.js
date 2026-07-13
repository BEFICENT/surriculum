/*
 * mobile.js — activates SUrriculum's mobile UI layer.
 *
 * Adds/removes the `is-mobile` class on <body> based on viewport width.
 * ALL mobile styling and behavior is gated on this class, so when it is
 * absent the app renders exactly like the frozen desktop build
 * (surriculum-3.0). Mobile styles live in mobile.css, scoped under
 * `body.is-mobile`.
 *
 * The breakpoint lives here as the single source of truth so it can be
 * tuned in one place.
 */
(function () {
    'use strict';

    // Phones use the mobile UI in BOTH orientations: narrow (portrait) OR
    // short-and-touch (a phone rotated to landscape is wide but short; the
    // pointer:coarse guard keeps short desktop windows on the desktop UI).
    var MOBILE_MAX_WIDTH = 820;
    var MOBILE_MAX_HEIGHT = 540;

    var query = '(max-width: ' + MOBILE_MAX_WIDTH + 'px), ' +
        '((max-height: ' + MOBILE_MAX_HEIGHT + 'px) and (pointer: coarse))';
    var mq = window.matchMedia ? window.matchMedia(query) : null;

    function apply() {
        var isMobile = mq
            ? mq.matches
            : ((window.innerWidth || 9999) <= MOBILE_MAX_WIDTH);
        try {
            document.body.classList.toggle('is-mobile', isMobile);
        } catch (e) {
            // body not ready yet; DOMContentLoaded will re-run apply().
        }
    }

    // Keep in sync with viewport / orientation changes.
    if (mq) {
        if (typeof mq.addEventListener === 'function') mq.addEventListener('change', apply);
        else if (typeof mq.addListener === 'function') mq.addListener(apply);
    }
    window.addEventListener('resize', apply, { passive: true });
    window.addEventListener('orientationchange', apply, { passive: true });

    // theme.js assigns document.body.className wholesale, which drops the
    // is-mobile class. It dispatches 'themeChanged' after every change
    // (initial apply and manual toggles), so re-assert on that. Also
    // re-assert once the DOM is ready and on load, for ordering safety.
    window.addEventListener('themeChanged', apply);
    document.addEventListener('DOMContentLoaded', apply);
    window.addEventListener('load', apply);

    // theme.js's toggle checks `document.body.className === 'light-theme'`
    // exactly, which our added is-mobile class breaks (it becomes a no-op).
    // Strip is-mobile in the capture phase — before theme.js's click handler
    // (bubble) reads className — so its comparison is correct; the resulting
    // themeChanged re-adds is-mobile synchronously, so nothing repaints.
    document.addEventListener('click', function (e) {
        try {
            if (e.target && e.target.closest && e.target.closest('#themeToggle')) {
                document.body.classList.remove('is-mobile');
            }
        } catch (_) {}
    }, true);

    // Run as soon as the body exists.
    if (document.body) apply();

    // Tiny helper for JS that needs to branch on mode.
    window.isMobileUI = function () {
        return !!document.body && document.body.classList.contains('is-mobile');
    };
})();

/*
 * Mobile shell — bottom tab bar + screen switching.
 *
 * The nav is injected once and hidden on desktop via CSS, so it survives
 * resizing between modes. Active screen is stored in the `data-mobile-tab`
 * attribute on <body>; CSS keys off it. Planner and Controls map to the
 * existing board and sidebar; Scheduler and Progress route to their
 * existing flows until they get their own full-screen sections.
 */
(function () {
    'use strict';

    function setTab(tab) {
        try { document.body.setAttribute('data-mobile-tab', tab); } catch (e) {}
        // Remember the tab so a full-page reload (e.g. changing major from
        // Controls) restores it instead of dumping the user back on Planner.
        try { sessionStorage.setItem('m-tab', tab); } catch (e) {}
        var items = document.querySelectorAll('.m-nav-item');
        for (var i = 0; i < items.length; i++) {
            items[i].classList.toggle('active', items[i].getAttribute('data-mtab') === tab);
        }
        if (tab === 'progress') { try { buildProgress(); } catch (e) {} }
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"]/g, function (ch) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch];
        });
    }
    function fmt(n) { var r = Math.round(n * 100) / 100; return String(r); }

    function buildProgressScreen() {
        if (document.getElementById('mProgress')) return;
        var main = document.querySelector('.main-content');
        if (!main) return;
        var el = document.createElement('div');
        el.id = 'mProgress';
        el.className = 'm-progress';
        main.appendChild(el);
    }

    // Reuse the desktop summary computation: render it (off-screen), read the
    // per-program stats, then remove the overlay before it can paint.
    function readProgramSummaries() {
        var existing = document.querySelector('.summary_modal_overlay');
        if (existing) existing.remove();
        var programs = [];
        try {
            var btn = document.querySelector('.summary');
            if (btn) btn.click();
            var cards = document.querySelectorAll('.summary_cards_row .summary_modal');
            for (var i = 0; i < cards.length; i++) {
                var card = cards[i];
                var title = ((card.querySelector('.summary_modal_title') || {}).textContent || '').trim();
                var stats = [];
                var ps = card.querySelectorAll('.summary_modal_child p');
                for (var j = 0; j < ps.length; j++) {
                    var m = (ps[j].textContent || '').trim().match(/^(.*?):\s*([\d.]+)\s*\/\s*([\d.]+)/);
                    if (m) stats.push({ label: m[1].trim(), value: parseFloat(m[2]), limit: parseFloat(m[3]) });
                }
                programs.push({ title: title, stats: stats });
            }
        } catch (e) {}
        var ov = document.querySelector('.summary_modal_overlay');
        if (ov) ov.remove();
        return programs;
    }

    // Minors: computeMinorAllocation() and curriculum are both top-level, so we
    // call them directly (minors aren't in the summary cards_row).
    function readMinorCards() {
        var cards = [];
        try {
            var curr = window.curriculum || (typeof curriculum !== 'undefined' ? curriculum : null);
            var cma = window.computeMinorAllocation || (typeof computeMinorAllocation !== 'undefined' ? computeMinorAllocation : null);
            if (!curr || !cma || !curr.minors) return cards;
            var minors = curr.minors.filter(Boolean);
            for (var i = 0; i < minors.length; i++) {
                var r;
                try { r = cma(curr, minors[i]); } catch (e) { continue; }
                if (!r || r.error) continue;
                var cats = (r.req && r.req.categories) || {};
                var done = r.totals || {};
                var stats = [], sumHave = 0, sumNeed = 0;
                var order = ['required', 'core', 'area', 'free'];
                for (var k = 0; k < order.length; k++) {
                    var key = order[k];
                    if (!cats[key] || !cats[key].minSU) continue;
                    var need = cats[key].minSU;
                    var have = (done[key] && done[key].credits) || 0;
                    sumHave += have; sumNeed += need;
                    stats.push({ label: key.charAt(0).toUpperCase() + key.slice(1), value: have, limit: need });
                }
                if (r.gpaThreshold) {
                    stats.push({ label: 'CGPA (min)', value: Math.round((r.cgpa || 0) * 100) / 100, limit: r.gpaThreshold, met: !!r.gpaOk });
                }
                cards.push({
                    code: minors[i],
                    title: r.title || (minors[i] + ' Minor'),
                    bar: sumNeed ? { value: sumHave, limit: sumNeed, label: 'SU credits' } : null,
                    stats: stats
                });
            }
        } catch (e) {}
        return cards;
    }

    function buildProgress() {
        var screen = document.getElementById('mProgress');
        if (!screen) return;
        var cards = [], descriptors = [];
        var majors = readProgramSummaries();
        for (var i = 0; i < majors.length; i++) {
            var p = majors[i], su = null, rest = [];
            for (var k = 0; k < p.stats.length; k++) {
                if (p.stats[k].label === 'SU Credits') su = p.stats[k]; else rest.push(p.stats[k]);
            }
            cards.push({ title: p.title, bar: su ? { value: su.value, limit: su.limit, label: 'SU credits' } : null, stats: rest });
            descriptors.push({ type: 'major', domIndex: i });
        }
        var minorCards = readMinorCards();
        for (var mi = 0; mi < minorCards.length; mi++) {
            cards.push(minorCards[mi]);
            descriptors.push({ type: 'minor', code: minorCards[mi].code, minorIndex: mi });
        }
        if (!cards.length) {
            screen.innerHTML = '<div class="m-prog-empty">Pick a program in Controls to see your progress.</div>';
            return;
        }
        var html = '';
        for (var c = 0; c < cards.length; c++) {
            var card = cards[c];
            var pct = (card.bar && card.bar.limit) ? Math.min(100, Math.round(card.bar.value / card.bar.limit * 100)) : 0;
            html += '<div class="m-prog-card">';
            html += '<div class="m-prog-title">' + esc(card.title) + '</div>';
            if (card.bar) {
                html += '<div class="m-prog-barrow"><span>' + fmt(card.bar.value) + ' / ' + fmt(card.bar.limit) + ' ' + esc(card.bar.label) + '</span><span>' + pct + '%</span></div>';
                html += '<div class="m-prog-bar"><div class="m-prog-fill" style="width:' + pct + '%"></div></div>';
            }
            html += '<div class="m-prog-grid">';
            for (var j = 0; j < card.stats.length; j++) {
                var s = card.stats[j];
                var met = (s.met !== undefined) ? s.met : (s.value >= s.limit);
                html += '<div class="m-prog-stat' + (met ? ' is-met' : '') + '"><div class="m-prog-lbl">' + esc(s.label) + '</div><div class="m-prog-val">' + fmt(s.value) + ' / ' + fmt(s.limit) + '</div></div>';
            }
            html += '</div></div>';
        }
        var multi = cards.length > 1;
        var dots = '';
        for (var d = 0; d < cards.length; d++) {
            dots += '<button class="m-prog-dot' + (d === 0 ? ' active' : '') + '" type="button" data-i="' + d + '" aria-label="Program ' + (d + 1) + '"></button>';
        }
        screen.innerHTML =
            '<div class="m-prog-carousel' + (multi ? ' is-multi' : '') + '">' + html + '</div>' +
            '<div class="m-prog-dots' + (multi ? '' : ' is-single') + '">' + dots + '</div>' +
            '<div class="m-prog-detail"></div>';
        screen._mDescriptors = descriptors;
        wireProgressCarousel(screen);
        if (descriptors.length) loadDetailFor(descriptors[0]);
    }

    // Detail accordion: re-render the desktop detailed summary for one program,
    // relocate its .major-summary / .minor-summary out of the modal into the
    // Progress detail area, and make each .ms-section header collapse its list.
    function loadDetailFor(descriptor) {
        var area = document.querySelector('.m-prog-detail');
        if (!area || !descriptor) return;
        var ex = document.querySelector('.summary_modal_overlay');
        if (ex) ex.remove();
        var content = null;
        try {
            var sumBtn = document.querySelector('.summary');
            if (sumBtn) sumBtn.click();
            if (descriptor.type === 'major') {
                var mcards = document.querySelectorAll('.summary_cards_row .summary_modal');
                var card = mcards[descriptor.domIndex];
                var db = card ? card.querySelector('.summary_detail_btn') : null;
                if (db) { db.click(); content = document.querySelector('.summary_major_panel .major-summary'); }
            } else {
                var mbtns = document.querySelectorAll('.summary_minor_row button');
                var target = mbtns[descriptor.minorIndex] || null;
                if (target) { target.click(); content = document.querySelector('.summary_minor_panel .minor-summary'); }
            }
        } catch (e) {}
        area.innerHTML = '';
        if (content) {
            area.appendChild(content);
            wireAccordionSections(area);
            wireUntakenToggles(area);
        }
        var cleanup = document.querySelector('.summary_modal_overlay');
        if (cleanup) cleanup.remove();
    }

    // The desktop "Show untaken" handler is bound to the (now-discarded) panel,
    // so re-bind fresh handlers scoped to the relocated detail area.
    function wireUntakenToggles(area) {
        var btns = area.querySelectorAll('.ms-untaken-toggle');
        for (var i = 0; i < btns.length; i++) {
            var fresh = btns[i].cloneNode(true);
            btns[i].parentNode.replaceChild(fresh, btns[i]);
            (function (btn) {
                var targetId = btn.getAttribute('data-target');
                var count = btn.getAttribute('data-count') || '';
                btn.addEventListener('click', function (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    var target = targetId ? area.querySelector('[id="' + targetId + '"]') : null;
                    if (!target) return;
                    var hidden = target.classList.toggle('is-hidden');
                    btn.textContent = (hidden ? 'Show untaken (' : 'Hide untaken (') + count + ')';
                });
            })(fresh);
        }
    }

    function wireAccordionSections(area) {
        var sections = area.querySelectorAll('.ms-section');
        for (var i = 0; i < sections.length; i++) {
            (function (sec, idx) {
                var header = sec.querySelector('.ms-header');
                if (!header) return;
                if (idx > 0) sec.classList.add('m-sec-collapsed');
                header.addEventListener('click', function () { sec.classList.toggle('m-sec-collapsed'); });
            })(sections[i], i);
        }
    }

    // Peek-carousel: cards swipe horizontally (scroll-snap); dots track the
    // active card and can be tapped to jump. Degrades to one full-width card.
    function wireProgressCarousel(screen) {
        var carousel = screen.querySelector('.m-prog-carousel');
        if (!carousel) return;
        var dots = screen.querySelectorAll('.m-prog-dot');
        var cardEls = carousel.querySelectorAll('.m-prog-card');
        function activeIndex() {
            var cl = carousel.getBoundingClientRect().left, idx = 0, min = Infinity;
            for (var i = 0; i < cardEls.length; i++) {
                var dd = Math.abs(cardEls[i].getBoundingClientRect().left - cl);
                if (dd < min) { min = dd; idx = i; }
            }
            return idx;
        }
        var detailTimer = null, lastDetailIdx = 0;
        function syncDots() {
            var idx = activeIndex();
            for (var j = 0; j < dots.length; j++) dots[j].classList.toggle('active', j === idx);
            if (idx !== lastDetailIdx) {
                clearTimeout(detailTimer);
                detailTimer = setTimeout(function () {
                    lastDetailIdx = idx;
                    var descs = screen._mDescriptors || [];
                    if (descs[idx]) { try { loadDetailFor(descs[idx]); } catch (e) {} }
                }, 180);
            }
        }
        carousel.addEventListener('scroll', syncDots, { passive: true });
        for (var i = 0; i < dots.length; i++) {
            (function (i) {
                dots[i].addEventListener('click', function () {
                    if (!cardEls[i]) return;
                    carousel.scrollBy({ left: cardEls[i].getBoundingClientRect().left - carousel.getBoundingClientRect().left, behavior: 'smooth' });
                });
            })(i);
        }
    }

    function buildNav() {
        if (document.getElementById('mNav')) return;
        var app = document.querySelector('.app');
        if (!app) return;

        var nav = document.createElement('nav');
        nav.className = 'm-nav';
        nav.id = 'mNav';
        nav.setAttribute('role', 'navigation');
        nav.setAttribute('aria-label', 'Primary');
        nav.innerHTML =
            '<button class="m-nav-item" type="button" data-mtab="planner"><i class="fa-solid fa-table-columns" aria-hidden="true"></i><span>Planner</span></button>' +
            '<button class="m-nav-item" type="button" data-maction="scheduler"><i class="fa-solid fa-calendar-days" aria-hidden="true"></i><span>Scheduler</span></button>' +
            '<button class="m-nav-item" type="button" data-mtab="progress"><i class="fa-solid fa-circle-check" aria-hidden="true"></i><span>Progress</span></button>' +
            '<button class="m-nav-item" type="button" data-mtab="controls"><i class="fa-solid fa-sliders" aria-hidden="true"></i><span>Controls</span></button>';
        app.appendChild(nav);

        nav.addEventListener('click', function (e) {
            var btn = e.target.closest ? e.target.closest('.m-nav-item') : null;
            if (!btn) return;
            var tab = btn.getAttribute('data-mtab');
            var action = btn.getAttribute('data-maction');
            if (tab) {
                setTab(tab);
            } else if (action === 'scheduler') {
                try { if (typeof window.openSchedulerModal === 'function') window.openSchedulerModal(); } catch (e2) {}
            } else if (action === 'progress') {
                // Interim: reuse the existing graduation check until Progress
                // gets its own merged full-screen section.
                try { var c = document.querySelector('.check'); if (c) c.click(); } catch (e3) {}
            }
        });
    }

    function initShell() {
        buildNav();
        buildProgressScreen();
        if (!document.body.getAttribute('data-mobile-tab')) {
            var saved = null;
            try { saved = sessionStorage.getItem('m-tab'); } catch (e) {}
            setTab((saved === 'controls' || saved === 'progress') ? saved : 'planner');
        }
    }

    // Exposed for debugging / future in-app navigation.
    window.SUrriculumSetTab = setTab;

    if (document.body) initShell();
    else document.addEventListener('DOMContentLoaded', initShell);
})();

/*
 * Mobile planner — vertical accordion of semesters.
 *
 * Injects a chevron affordance, collapses non-current semesters by
 * default, and toggles a semester open/closed when its name row is
 * tapped. All visual effects are gated on body.is-mobile in mobile.css,
 * so adding the classes/chevron is a no-op on desktop.
 */
(function () {
    'use strict';

    function ensureChevron(cont) {
        var icons = cont.querySelector('.subcontainer_semester .date .icons');
        if (icons && !icons.querySelector('.m-sem-chevron')) {
            var chev = document.createElement('i');
            chev.className = 'fa-solid fa-chevron-down m-sem-chevron';
            chev.setAttribute('aria-hidden', 'true');
            icons.appendChild(chev);
        }
    }

    function syncSemesters() {
        var conts = document.querySelectorAll('.board .container_semester');
        for (var i = 0; i < conts.length; i++) {
            var c = conts[i];
            ensureChevron(c);
            // Visual-only reversal (recent terms on top). Negated DOM index;
            // consumed by `order: var(--m-order)` in mobile.css, mobile-only.
            c.style.setProperty('--m-order', String(-i));
            if (!c.hasAttribute('data-m-init')) {
                c.setAttribute('data-m-init', '1');
                // Collapse by default unless it's the current term.
                if (!c.classList.contains('current-term')) c.classList.add('m-collapsed');
            }
        }
        // Guarantee at least one open semester when there's no current term.
        if (conts.length && !document.querySelector('.board .container_semester:not(.m-collapsed)')) {
            conts[0].classList.remove('m-collapsed');
        }
    }

    function onBoardClick(e) {
        if (!document.body.classList.contains('is-mobile')) return;
        if (!e.target.closest) return;
        // Leave the semester action icons (edit date / delete) to their own handlers.
        if (e.target.closest('.semester_date_edit, .semester_drag, .delete_semester')) return;
        // The header is the colored credits bar + the name row.
        var header = e.target.closest('.date') || e.target.closest('.total_credit');
        if (!header) return;
        var cont = header.closest('.container_semester');
        if (cont) cont.classList.toggle('m-collapsed');
    }

    function init() {
        var board = document.querySelector('.board');
        if (!board || board.__mPlannerInit) return;
        board.__mPlannerInit = true;
        syncSemesters();
        board.addEventListener('click', onBoardClick);
        // The board is populated asynchronously (and rebuilt on plan switch),
        // so re-sync whenever its children change.
        try {
            new MutationObserver(function () { syncSemesters(); }).observe(board, { childList: true });
        } catch (e) {}
    }

    if (document.body) {
        init();
        window.addEventListener('load', init);
    } else {
        document.addEventListener('DOMContentLoaded', init);
    }
})();

/*
 * Mobile scheduler — reshape the desktop scheduler modal (built on demand by
 * scheduler.js, whose internals are closured and not callable from here).
 * Portrait: day-at-a-time — an injected day selector drives `data-m-day`, and
 * CSS shows only that day's .scheduler-day-col. Landscape: the full week grid.
 * All block rendering + interactions remain the scheduler's own.
 */
(function () {
    'use strict';
    var DAYS = [
        { k: 'M', label: 'Mon' }, { k: 'T', label: 'Tue' }, { k: 'W', label: 'Wed' },
        { k: 'R', label: 'Thu' }, { k: 'F', label: 'Fri' }
    ];
    // Landscape "tall" mode px-per-minute — matches the portrait/desktop default
    // (1.05px) so a block reads the same height there; the week overflows and the
    // grid scrolls instead of being squeezed to fit. See landscapeTargetPpm().
    var TALL_PPM = 1.05;

    function defaultDay() {
        var map = { 1: 'M', 2: 'T', 3: 'W', 4: 'R', 5: 'F' };
        try { return map[new Date().getDay()] || 'M'; } catch (e) { return 'M'; }
    }

    function setDay(modal, day) {
        modal.setAttribute('data-m-day', day);
        var btns = modal.querySelectorAll('.m-sched-day');
        for (var i = 0; i < btns.length; i++) {
            btns[i].classList.toggle('active', btns[i].getAttribute('data-day') === day);
        }
    }

    // Tap-to-preview: touch has no hover, so a tap on a course's body drives the
    // scheduler's own (closured) hover preview via a synthetic mouseover, then we
    // drop the sheet to reveal the grid. Back clears it; Add runs the card's pick.
    function previewLabel(el) {
        // A specific section row → show its section id + meeting time (drop the
        // trailing "@ location").
        if (el.classList && el.classList.contains('scheduler-inline-section-row')) {
            var main = el.querySelector('.scheduler-inline-section-main') || el;
            var txt = (main.textContent || '').replace(/\s+/g, ' ').trim().replace(/\)(?=\S)/g, ') ');
            var at = txt.indexOf(' @ ');
            return at > 0 ? txt.slice(0, at) : txt;
        }
        var head = el.querySelector('.scheduler-course-head');
        if (head) {
            // The code and title are adjacent nodes with no whitespace between
            // them; join each node's text with a space so it reads "NS101 …".
            var parts = [];
            [].forEach.call(head.childNodes, function (n) {
                var s = (n.textContent || '').trim();
                if (s) parts.push(s);
            });
            if (parts.length) return parts.join(' ').replace(/\s+/g, ' ');
        }
        return el.getAttribute('data-course') || 'Course';
    }
    // `target` is either a .scheduler-course card (default section) or a specific
    // .scheduler-inline-section-row — dispatching mouseover on it drives the
    // scheduler's own section-aware hover preview, so we respect the tapped section.
    function startPreview(modal, target) {
        try { target.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, cancelable: true, view: window })); } catch (e) {}
        var isSection = target.classList && target.classList.contains('scheduler-inline-section-row');
        modal.__mPreviewSectionRow = isSection ? target : null;
        modal.__mPreviewCard = target.closest ? target.closest('.scheduler-course') : null;
        var lbl = modal.querySelector('.m-prev-label');
        if (lbl) lbl.textContent = previewLabel(target);
        // Mark every day this section touches on the day selector, then jump to
        // the first one so the user sees the section (not an unrelated day).
        try {
            var order = ['M', 'T', 'W', 'R', 'F'];
            var firstDay = null;
            for (var d = 0; d < order.length; d++) {
                var dcol = modal.querySelector('.scheduler-day-col[data-day="' + order[d] + '"]');
                var affected = !!(dcol && dcol.querySelector('.scheduler-block.is-preview'));
                var btn = modal.querySelector('.m-sched-day[data-day="' + order[d] + '"]');
                if (btn) btn.classList.toggle('m-day-affected', affected);
                if (affected && !firstDay) firstDay = order[d];
            }
            if (firstDay) setDay(modal, firstDay);
        } catch (e2) {}
        modal.classList.remove('m-sheet-open');
        modal.classList.add('m-preview');
    }
    function clearAffectedDays(modal) {
        var marks = modal.querySelectorAll('.m-sched-day.m-day-affected');
        for (var i = 0; i < marks.length; i++) marks[i].classList.remove('m-day-affected');
    }
    function endPreview(modal) {
        var results = modal.querySelector('.scheduler-results');
        if (results) {
            // Let this intentional clear through the mouseleave guard below.
            modal.__allowPreviewClear = true;
            try { results.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false, view: window })); } catch (e) {}
            modal.__allowPreviewClear = false;
        }
        clearAffectedDays(modal);
        modal.classList.remove('m-preview');
        modal.__mPreviewCard = null;
        modal.__mPreviewSectionRow = null;
    }
    // First day (Mon→Fri) that a committed (non-preview) course block sits on.
    function firstDayForCourse(modal, courseId) {
        var order = ['M', 'T', 'W', 'R', 'F'];
        var days = {};
        var blocks = modal.querySelectorAll('.scheduler-day-col .scheduler-block');
        for (var i = 0; i < blocks.length; i++) {
            var b = blocks[i];
            if (b.classList.contains('is-preview')) continue;
            if (b.getAttribute('data-course') !== courseId) continue;
            var d = b.getAttribute('data-day');
            if (d) days[d] = true;
        }
        for (var j = 0; j < order.length; j++) if (days[order[j]]) return order[j];
        return null;
    }
    // After a section is picked, wait for its committed block(s) to render, then
    // (portrait only) switch to the first day it meets so the add lands on a
    // relevant day. Polls briefly, self-clears, and is superseded by a newer pick.
    function scheduleJumpToCourse(modal, courseId) {
        if (!courseId) return;
        modal.__mJumpCourse = courseId;
        var tries = 0;
        var iv = setInterval(function () {
            if (modal.__mJumpCourse !== courseId) { clearInterval(iv); return; }
            var day = firstDayForCourse(modal, courseId);
            if (day) {
                if (window.matchMedia('(orientation: portrait)').matches) setDay(modal, day);
                modal.__mJumpCourse = null;
                clearInterval(iv);
            } else if (++tries > 80) { // ~12s, covers the section-chooser detour
                if (modal.__mJumpCourse === courseId) modal.__mJumpCourse = null;
                clearInterval(iv);
            }
        }, 150);
    }

    function mobilize(modal) {
        if (modal.__mSched) return;
        modal.__mSched = true;
        modal.classList.add('m-scheduler');
        updateFitPpm(); // ensure the landscape px-per-minute var is current
        // Once the grid (and its blocks) have rendered, correct the landscape fit
        // from the real grid height so the week fills the whole area exactly.
        try { setTimeout(refitLandscapeInPlace, 350); } catch (e00) {}
        // Enable the sheet's slide transition only after the initial hide has
        // painted, so opening the scheduler doesn't animate the sidebar away
        // (it would look like the Add-courses panel flashing open then closing).
        try {
            requestAnimationFrame(function () {
                requestAnimationFrame(function () { modal.classList.add('m-sheet-ready'); });
            });
        } catch (e0) { modal.classList.add('m-sheet-ready'); }

        // Landscape-only compact/tall toggle for the week grid. Compact (default)
        // fits the whole day on one screen; tall gives portrait-sized cards and
        // scrolls the week instead. Injected into the header actions (before the ⋮),
        // shown only in landscape via CSS. Drives .m-sched-tall + a live rescale.
        var hActions = modal.querySelector('.scheduler-header-actions');
        if (hActions && !hActions.querySelector('.m-sched-tall-toggle')) {
            var tallBtn = document.createElement('button');
            tallBtn.type = 'button';
            tallBtn.className = 'scheduler-header-btn m-sched-tall-toggle';
            tallBtn.setAttribute('title', 'Taller rows');
            tallBtn.setAttribute('aria-label', 'Toggle taller rows');
            tallBtn.setAttribute('aria-pressed', 'false');
            tallBtn.innerHTML = '<i class="fa-solid fa-arrows-up-down" aria-hidden="true"></i>';
            var moreBtnEl = hActions.querySelector('.scheduler-more');
            if (moreBtnEl) hActions.insertBefore(tallBtn, moreBtnEl);
            else hActions.appendChild(tallBtn);
            tallBtn.addEventListener('click', function () {
                var tall = modal.classList.toggle('m-sched-tall');
                tallBtn.classList.toggle('is-active', tall);
                tallBtn.setAttribute('title', tall ? 'Fit week to screen' : 'Taller rows');
                tallBtn.setAttribute('aria-pressed', tall ? 'true' : 'false');
                try { refitLandscapeInPlace(); } catch (e) {}
            });
        }

        var wrap = modal.querySelector('.scheduler-grid-wrap');
        if (!wrap) return;
        var sel = document.createElement('div');
        sel.className = 'm-sched-days';
        var html = '';
        for (var i = 0; i < DAYS.length; i++) {
            html += '<button type="button" class="m-sched-day" data-day="' + DAYS[i].k + '">' + DAYS[i].label + '</button>';
        }
        sel.innerHTML = html;
        wrap.insertBefore(sel, wrap.firstChild);
        sel.addEventListener('click', function (e) {
            var btn = e.target.closest ? e.target.closest('.m-sched-day') : null;
            if (btn) setDay(modal, btn.getAttribute('data-day'));
        });
        setDay(modal, defaultDay());

        // Portrait: the desktop left sidebar (search / filters / course list /
        // selected sections / blocked hours) is hidden inline — there's no room.
        // Surface the scheduler's own sidebar as a slide-up sheet, opened by a
        // floating button, so all its wiring keeps working untouched.
        var sidebar = modal.querySelector('.scheduler-sidebar');
        if (sidebar && !sidebar.querySelector('.m-sched-sheet-bar')) {
            var bar = document.createElement('div');
            bar.className = 'm-sched-sheet-bar';
            bar.innerHTML = '<span class="m-sched-sheet-title">Add courses</span>';
            sidebar.insertBefore(bar, sidebar.firstChild);
        }
        // Bottom-right floating button toggles the sheet: "Add courses" while
        // closed, "Done" while open — same corner so it's always thumb-reachable
        // (the sheet's own title bar sits far up-screen when scrolled).
        if (!modal.querySelector('.m-sched-fab')) {
            var fab = document.createElement('button');
            fab.type = 'button';
            fab.className = 'm-sched-fab';
            fab.innerHTML = '<i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i><span>Add courses</span>';
            fab.addEventListener('click', function () { modal.classList.add('m-sheet-open'); });
            modal.appendChild(fab);
        }
        if (!modal.querySelector('.m-sched-done-fab')) {
            var doneFab = document.createElement('button');
            doneFab.type = 'button';
            doneFab.className = 'm-sched-done-fab';
            doneFab.innerHTML = '<i class="fa-solid fa-check" aria-hidden="true"></i><span>Done</span>';
            doneFab.addEventListener('click', function () { modal.classList.remove('m-sheet-open'); });
            modal.appendChild(doneFab);
        }

        // Landscape trigger: repurpose the top-left grid corner as the "add
        // courses" search button — the desktop sidebar-toggle there is a no-op
        // once the sidebar is a sheet. The corner only exists while the week
        // header shows (landscape), so this is landscape's trigger and the FAB is
        // portrait's. Landscape closes via the × injected into the sheet header.
        var corner = modal.querySelector('.scheduler-grid-corner');
        if (corner && !corner.querySelector('.m-sched-corner-search')) {
            var deskToggle = corner.querySelector('.scheduler-sidebar-toggle');
            if (deskToggle) deskToggle.style.display = 'none';
            var cSearch = document.createElement('button');
            cSearch.type = 'button';
            cSearch.className = 'm-sched-corner-search';
            cSearch.setAttribute('aria-label', 'Add courses');
            cSearch.innerHTML = '<i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>';
            cSearch.addEventListener('click', function () { modal.classList.add('m-sheet-open'); });
            corner.appendChild(cSearch);
        }
        var sBar = modal.querySelector('.m-sched-sheet-bar');
        if (sBar && !sBar.querySelector('.m-sched-sheet-close')) {
            var sClose = document.createElement('button');
            sClose.type = 'button';
            sClose.className = 'm-sched-sheet-close';
            sClose.setAttribute('aria-label', 'Close');
            sClose.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
            sClose.addEventListener('click', function () { modal.classList.remove('m-sheet-open'); });
            sBar.appendChild(sClose);
        }

        // "Hover preview" is a no-op on touch — drop that toggle from the sheet's
        // filter menu (matched by label so it survives any reordering).
        var labels = modal.querySelectorAll('.scheduler-filter-menu .toggle-text');
        for (var li = 0; li < labels.length; li++) {
            if ((labels[li].textContent || '').trim() === 'Hover preview') {
                var trow = labels[li].closest('.scheduler-control');
                if (trow) trow.classList.add('m-sched-hidden-row');
                break;
            }
        }

        // Block-hours drag is wired to mouse events only (mousedown/move on each
        // .scheduler-day-col, mouseup on document); a touch-drag pans instead, so
        // it can't work on a phone. Bridge touch→mouse, but only while block mode
        // is active so normal scrolling/tapping is untouched. Delegating on the
        // modal survives grid re-renders (the day columns are reused, not rebuilt).
        if (!modal.__mBlockTouch) {
            modal.__mBlockTouch = true;
            var bridgeCol = null;
            var fireMouse = function (type, target, pt) {
                try {
                    target.dispatchEvent(new MouseEvent(type, {
                        bubbles: true, cancelable: true, view: window,
                        clientX: pt ? pt.clientX : 0, clientY: pt ? pt.clientY : 0
                    }));
                } catch (e) {}
            };
            modal.addEventListener('touchstart', function (e) {
                if (!modal.classList.contains('is-block-mode')) return;
                var target = e.target;
                // Tapping an existing blocked block should remove it — let the
                // native tap/click reach the scheduler's "Unblock hours" handler
                // instead of us preventDefault-ing it into a (no-op) drag.
                if (target && target.closest && target.closest('.scheduler-block-bg')) return;
                var col = (target && target.closest) ? target.closest('.scheduler-day-col') : null;
                if (!col) return;
                var t = e.touches[0];
                if (!t) return;
                bridgeCol = col;
                e.preventDefault(); // suppress scroll + the browser's compat mouse events
                fireMouse('mousedown', target, t);
            }, { passive: false });
            modal.addEventListener('touchmove', function (e) {
                if (!bridgeCol || !modal.classList.contains('is-block-mode')) return;
                var t = e.touches[0];
                if (!t) return;
                e.preventDefault(); // stop the grid scrolling while dragging a block
                fireMouse('mousemove', bridgeCol, t);
            }, { passive: false });
            var endBridge = function (e) {
                if (!bridgeCol) return;
                var t = (e.changedTouches && e.changedTouches[0]) || null;
                fireMouse('mouseup', document, t);
                bridgeCol = null;
            };
            modal.addEventListener('touchend', endBridge);
            modal.addEventListener('touchcancel', endBridge);
        }

        // Tap-to-preview bar + the tap handler that drives it.
        if (!modal.querySelector('.m-sched-preview-bar')) {
            var pbar = document.createElement('div');
            pbar.className = 'm-sched-preview-bar';
            pbar.innerHTML =
                '<button type="button" class="m-prev-back"><i class="fa-solid fa-chevron-left" aria-hidden="true"></i> List</button>' +
                '<span class="m-prev-label"></span>' +
                '<button type="button" class="m-prev-add">Add <i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>';
            modal.appendChild(pbar);
            pbar.querySelector('.m-prev-back').addEventListener('click', function () {
                endPreview(modal);
                modal.classList.add('m-sheet-open');
            });
            pbar.querySelector('.m-prev-add').addEventListener('click', function () {
                // Add the exact previewed section when a section row was tapped,
                // otherwise the card's default Pick-section flow.
                var row = modal.__mPreviewSectionRow;
                var card = modal.__mPreviewCard;
                var pick = row ? row.querySelector('.scheduler-section-pick')
                    : (card ? card.querySelector('.scheduler-pick') : null);
                endPreview(modal);
                if (pick) pick.click();
            });
        }
        if (!modal.__mPreviewClick) {
            modal.__mPreviewClick = true;
            modal.addEventListener('click', function (e) {
                // Only from the open sheet; ignore taps on controls (let them work).
                if (!modal.classList.contains('m-sheet-open')) return;
                var t = e.target;
                if (!t || !t.closest) return;
                if (t.closest('button, a, input, select, label, .toggle-switch')) return;
                if (!t.closest('.scheduler-results')) return;
                // A specific section row wins over the whole card, so tapping one
                // recitation previews that recitation's hours (not the default).
                var sectionRow = t.closest('.scheduler-inline-section-row');
                if (sectionRow) { startPreview(modal, sectionRow); return; }
                var card = t.closest('.scheduler-course');
                if (card) startPreview(modal, card);
            });
        }
        if (!modal.__mPickJump) {
            modal.__mPickJump = true;
            // Picking a section (directly, or via the preview bar's Add which
            // clicks the same button) should land the portrait view on a day the
            // course meets. Non-stopping: scheduler.js still handles the pick.
            modal.addEventListener('click', function (e) {
                var pick = e.target && e.target.closest
                    ? e.target.closest('.scheduler-pick, .scheduler-section-pick') : null;
                if (pick) scheduleJumpToCourse(modal, pick.getAttribute('data-course'));
            });
        }
        if (!modal.__mPreviewGuard) {
            modal.__mPreviewGuard = true;
            // A touch tap fires a trailing mouseleave on .scheduler-results, whose
            // own handler wipes the preview we just showed. Swallow that leave (in
            // capture, before the target handler) while previewing — except the
            // intentional clear from endPreview, flagged by __allowPreviewClear.
            modal.addEventListener('mouseleave', function (e) {
                var t = e.target;
                var onResults = t && ((t.classList && t.classList.contains('scheduler-results')) ||
                    (t.closest && t.closest('.scheduler-results')));
                if (!onResults) return;
                if (modal.__allowPreviewClear) return;
                if (modal.classList.contains('m-preview')) {
                    e.stopPropagation();
                    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
                }
            }, true);
        }
    }

    // Landscape "whole week fits": maintain a px-per-minute value from the
    // viewport height so the ~660-min day (08:40–19:40) fills the grid without
    // scrolling. The scheduler reads --scheduler-minute (→ --m-fit-ppm) live when
    // it renders, so opening in landscape fits automatically.
    function updateFitPpm() {
        try {
            if (document.body.classList.contains('is-mobile') && window.matchMedia('(orientation: landscape)').matches) {
                // Pre-render estimate for the first paint (no grid to measure yet):
                // overhead ≈ modal header + week header (~93) + topGap (14); 660 =
                // day length. refitLandscapeInPlace() corrects this exactly from the
                // real grid height once it exists.
                var ppm = (window.innerHeight - 107) / 660;
                ppm = Math.max(0.26, Math.min(1.0, ppm));
                document.documentElement.style.setProperty('--m-fit-ppm', ppm.toFixed(3) + 'px');
            } else {
                document.documentElement.style.removeProperty('--m-fit-ppm');
            }
        } catch (e) {}
    }

    // Blocks are positioned in px at render time, so a rotation needs a re-render
    // to pick up the new scale. There's no public re-render hook, so re-open the
    // modal (its state is persisted); its fresh grid reads the updated scale.
    function reRenderOpenScheduler() {
        var modal = document.querySelector('.scheduler-modal');
        if (!modal) return;
        var closeBtn = modal.querySelector('.scheduler-close');
        try { if (closeBtn) closeBtn.click(); } catch (e) {}
        setTimeout(function () {
            try { if (typeof window.openSchedulerModal === 'function') window.openSchedulerModal(); } catch (e2) {}
        }, 50);
    }

    // Target px-per-minute for the landscape week. Tall mode uses a fixed,
    // portrait-comparable scale (the week overflows and the grid scrolls);
    // compact mode fits the whole ~660-min day into the *actual* grid area (not a
    // guessed viewport overhead — otherwise the last hour sits short of the
    // bottom). clientHeight is stable across ppm changes (it's the flex area,
    // = modal minus its two headers). Returns null if the area isn't measurable.
    function landscapeTargetPpm(modal, grid, topGap) {
        if (modal.classList.contains('m-sched-tall')) return TALL_PPM;
        var avail = grid.clientHeight;
        if (!(avail > 60)) return null;
        var p = (avail - topGap - 2) / 660;
        return Math.max(0.26, Math.min(1.0, p));
    }

    // Landscape only: entering fullscreen (or the URL bar hiding) grows the
    // available height AFTER the grid baked its px positions, leaving the week
    // crammed at the old scale; likewise the compact/tall toggle changes the
    // target scale. Recompute the scale and rescale the inline hour lines +
    // blocks in place — the gutter and day columns are CSS-var-driven and follow
    // --m-fit-ppm automatically. No re-render, so fullscreen is preserved.
    function refitLandscapeInPlace() {
        if (!document.body.classList.contains('is-mobile')) return;
        if (!window.matchMedia('(orientation: landscape)').matches) return;
        var modal = document.querySelector('.scheduler-modal.m-scheduler');
        var grid = modal ? modal.querySelector('.scheduler-grid') : null;
        if (!grid) return;
        try {
            var cs = getComputedStyle(grid);
            var oldPpm = parseFloat(cs.getPropertyValue('--scheduler-minute'));
            var topGap = parseFloat(cs.getPropertyValue('--scheduler-top-gap')) || 14;
            var blockGap = parseFloat(cs.getPropertyValue('--scheduler-block-gap')) || 6;
            if (!(oldPpm > 0)) return;
            var newPpm = landscapeTargetPpm(modal, grid, topGap);
            if (newPpm == null) return;
            var ratio = newPpm / oldPpm;
            if (!(ratio > 0) || Math.abs(ratio - 1) < 0.01) return; // no meaningful change
            document.documentElement.style.setProperty('--m-fit-ppm', newPpm.toFixed(3) + 'px');
            var lines = modal.querySelectorAll('.scheduler-hour-line'); // top = topGap + min*ppm
            for (var i = 0; i < lines.length; i++) {
                var lt = parseFloat(lines[i].style.top);
                if (!isNaN(lt)) lines[i].style.top = (topGap + (lt - topGap) * ratio) + 'px';
            }
            var blocks = modal.querySelectorAll('.scheduler-day-col .scheduler-block'); // top adds blockGap; height = dur*ppm - 2*blockGap
            for (var j = 0; j < blocks.length; j++) {
                var bt = parseFloat(blocks[j].style.top), bh = parseFloat(blocks[j].style.height);
                if (!isNaN(bt)) blocks[j].style.top = (topGap + blockGap + (bt - topGap - blockGap) * ratio) + 'px';
                if (!isNaN(bh)) blocks[j].style.height = Math.max(8, (bh + 2 * blockGap) * ratio - 2 * blockGap) + 'px';
            }
        } catch (e) {}
    }

    function init() {
        try {
            new MutationObserver(function (muts) {
                if (!document.body.classList.contains('is-mobile')) return;
                for (var i = 0; i < muts.length; i++) {
                    var added = muts[i].addedNodes;
                    for (var j = 0; j < added.length; j++) {
                        var n = added[j];
                        if (n.nodeType !== 1) continue;
                        var modal = (n.classList && n.classList.contains('scheduler-modal')) ? n :
                            (n.querySelector ? n.querySelector('.scheduler-modal') : null);
                        if (modal) mobilize(modal);
                    }
                }
            }).observe(document.body, { childList: true, subtree: true });
        } catch (e) {}

        // is-mobile is applied on DOMContentLoaded (after this deferred script
        // runs), so re-run once it's set — and whenever it's re-asserted.
        updateFitPpm();
        try { window.addEventListener('DOMContentLoaded', updateFitPpm); } catch (e) {}
        try { window.addEventListener('load', updateFitPpm); } catch (e) {}
        try { document.addEventListener('themeChanged', updateFitPpm); } catch (e) {}
        try {
            var mq = window.matchMedia('(orientation: landscape)');
            var onOrient = function () {
                updateFitPpm();
                if (document.body.classList.contains('is-mobile')) reRenderOpenScheduler();
            };
            if (mq.addEventListener) mq.addEventListener('change', onOrient);
            else if (mq.addListener) mq.addListener(onOrient);
        } catch (e) {}
        // Height changes within landscape (fullscreen enter/exit, URL bar) re-fit
        // the week in place so it fills the freed space instead of staying crammed.
        try {
            var refitTimer = null;
            window.addEventListener('resize', function () {
                if (refitTimer) clearTimeout(refitTimer);
                refitTimer = setTimeout(refitLandscapeInPlace, 180);
            });
            document.addEventListener('fullscreenchange', function () {
                setTimeout(refitLandscapeInPlace, 120);
            });
        } catch (e) {}
    }

    if (document.body) init();
    else document.addEventListener('DOMContentLoaded', init);
})();
