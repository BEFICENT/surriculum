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

    // Viewport at or below this width (px) uses the mobile UI.
    var MOBILE_MAX_WIDTH = 820;

    var query = '(max-width: ' + MOBILE_MAX_WIDTH + 'px)';
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
        if (!document.body.getAttribute('data-mobile-tab')) setTab('planner');
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
