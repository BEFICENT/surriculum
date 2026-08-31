// Mobile portrait notice kept separate from planner orchestration.
// Loaded as a deferred classic script before main.js.
(function (global) {
    'use strict';

    let initialized = false;

    function init() {
        if (initialized) return api;
        initialized = true;
    const notice = document.getElementById('mobileNotice');
    const dismiss = document.getElementById('mobileNoticeDismiss');
    if (!notice || !dismiss) return;

    const KEY = 'mobileNoticeDismissed';
    const shouldShow = () => {
        try {
            if (preferenceGetItem(KEY) === 'true') return false;
        } catch (_) {}
        try {
            const mq = window.matchMedia('(max-width: 820px) and (orientation: portrait)');
            return !!mq.matches;
        } catch (_) {
            return (window.innerWidth || 9999) <= 820 && (window.innerHeight || 0) > (window.innerWidth || 0);
        }
    };

    const apply = () => {
        try { notice.classList.toggle('is-hidden', !shouldShow()); } catch (_) {}
    };

    dismiss.addEventListener('click', () => {
        preferenceSetItem(KEY, 'true');
        try { notice.classList.add('is-hidden'); } catch (_) {}
    });

    try {
        const mq = window.matchMedia('(max-width: 820px) and (orientation: portrait)');
        if (mq && typeof mq.addEventListener === 'function') mq.addEventListener('change', apply);
    } catch (_) {}
    window.addEventListener('resize', apply, { passive: true });
    window.addEventListener('orientationchange', apply, { passive: true });
    apply();
        return api;
    }

    const api = Object.freeze({ init });
    global.surriculumMobileNotice = api;
})(typeof window !== 'undefined' ? window : globalThis);
