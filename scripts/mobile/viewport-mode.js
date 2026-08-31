// Focused mobile viewport-mode module. Composed by mobile.js.
(function installMobileViewportMode(root) {
    'use strict';

    let initialized = false;
    function init() {
        if (initialized) return api;

        /*
         * viewport-mode.js — activates SUrriculum's mobile UI layer.
         *
         * Adds/removes the `is-mobile` class on <body> based on viewport width.
         * ALL mobile styling and behavior is gated on this class, so when it is
         * absent the app renders exactly like the frozen desktop build
         * (SUrriculum 3.1). Mobile styles live in mobile.css, scoped under
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
            var lastMobileMode = null;

            function apply() {
                var isMobile = mq
                    ? mq.matches
                    : ((window.innerWidth || 9999) <= MOBILE_MAX_WIDTH);
                try {
                    var modeChanged = lastMobileMode !== null && lastMobileMode !== isMobile;
                    document.body.classList.toggle('is-mobile', isMobile);
                    lastMobileMode = isMobile;
                    // An already-open scheduler was built for the previous layout mode.
                    // Let its adapter rebuild it when a resize crosses the mobile boundary;
                    // CSS alone cannot add/remove the injected day picker and course sheet.
                    if (modeChanged) {
                        document.dispatchEvent(new CustomEvent('mobileModeChanged', {
                            detail: { isMobile: isMobile }
                        }));
                    }
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

            // Re-assert once the DOM is ready and on load, for ordering safety.
            document.addEventListener('DOMContentLoaded', apply);
            window.addEventListener('load', apply);

            // Run as soon as the body exists.
            if (document.body) apply();

            // Tiny helper for JS that needs to branch on mode.
            window.isMobileUI = function () {
                return !!document.body && document.body.classList.contains('is-mobile');
            };
        })();

        initialized = true;
        return api;
    }

    const api = Object.freeze({ init });
    const namespace = root.SurriculumMobileModules
        || (root.SurriculumMobileModules = {});
    namespace.viewportMode = api;
})(typeof window !== 'undefined' ? window : globalThis);
