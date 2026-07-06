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
            '<button class="m-nav-item" type="button" data-maction="progress"><i class="fa-solid fa-circle-check" aria-hidden="true"></i><span>Progress</span></button>' +
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
        if (!document.body.getAttribute('data-mobile-tab')) setTab('planner');
    }

    // Exposed for debugging / future in-app navigation.
    window.SUrriculumSetTab = setTab;

    if (document.body) initShell();
    else document.addEventListener('DOMContentLoaded', initShell);
})();
