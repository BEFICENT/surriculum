// Shared application runtime for storage, dialogs, and service-worker warmup.
// Loaded as a deferred classic script before main.js.
(function (global) {
    'use strict';

    let serviceWorkerRegistration = null;
    let serviceWorkerWarmTimer = null;
    let planWriteFailed = false;
    let dialogSequence = 0;
    let getInitialMajor = () => 'CS';

    const sessionPlanId = (() => {
        try {
            if (global.planStorage && typeof global.planStorage.getSessionPlanId === 'function') {
                return global.planStorage.getSessionPlanId();
            }
        } catch (_) {}
        return null;
    })();

    function configure(options) {
        const opts = options || {};
        if (typeof opts.getInitialMajor === 'function') getInitialMajor = opts.getInitialMajor;
        return api;
    }

    // The application is pinned to the plan that was active when this document
    // loaded. A plan switch/delete/reset schedules a reload, but asynchronous
    // startup work from the outgoing document can still settle first. Treat a
    // missing pinned plan as a cancelled document rather than falling through
    // to the new active plan (or reporting an expected write as a storage
    // failure).
    function isSessionPlanAvailable() {
        const storage = global.planStorage || null;
        if (!storage || !sessionPlanId || typeof storage.hasPlan !== 'function') return true;
        try {
            return storage.hasPlan(sessionPlanId) === true;
        } catch (_) {
            // Let the actual read/write surface genuine storage failures. A
            // failed liveness probe alone is not proof that the plan vanished.
            return true;
        }
    }

    function planGetItem(key) {
        if (global.planStorage && typeof global.planStorage.getItem === 'function') {
            if (!isSessionPlanAvailable()) return null;
            try {
                return global.planStorage.getItem(key, sessionPlanId || undefined);
            } catch (err) {
                try { console.error('Failed to read plan data:', err); } catch (_) {}
                return null;
            }
        }
        try { return global.localStorage.getItem(key); } catch (_) {}
        return null;
    }

    function planSetItem(key, value) {
        if (global.planStorage && typeof global.planStorage.setItem === 'function') {
            if (!isSessionPlanAvailable()) return false;
            try {
                if (global.planStorage.setItem(key, value, sessionPlanId || undefined) === false) {
                    planWriteFailed = true;
                    return false;
                }
                queueServiceWorkerPlanWarmup(key);
                return true;
            } catch (err) {
                planWriteFailed = true;
                try { console.error('Failed to save plan data:', err); } catch (_) {}
                return false;
            }
        }
        try {
            global.localStorage.setItem(key, value);
            queueServiceWorkerPlanWarmup(key);
            return true;
        } catch (_) {
            planWriteFailed = true;
            return false;
        }
    }

    function planRemoveItem(key) {
        try {
            if (global.planStorage && typeof global.planStorage.removeItem === 'function') {
                if (!isSessionPlanAvailable()) return false;
                if (global.planStorage.removeItem(key, sessionPlanId || undefined) === false) {
                    planWriteFailed = true;
                    return false;
                }
                return true;
            }
        } catch (_) {
            planWriteFailed = true;
            return false;
        }
        try {
            global.localStorage.removeItem(key);
            return true;
        } catch (_) {
            planWriteFailed = true;
            return false;
        }
    }

    function preferenceGetItem(key) {
        try {
            const preferences = global.preferenceStorage || null;
            if (preferences && typeof preferences.getItem === 'function') return preferences.getItem(key);
        } catch (_) {}
        return null;
    }

    function preferenceSetItem(key, value) {
        try {
            const preferences = global.preferenceStorage || null;
            if (preferences && typeof preferences.setItem === 'function') {
                return preferences.setItem(key, value) !== false;
            }
        } catch (_) {}
        return false;
    }

    function requestPlanSave() {
        try {
            const storage = global.planStorage || null;
            return !!(storage && typeof storage.requestSave === 'function' && storage.requestSave());
        } catch (_) {}
        return false;
    }

    function flushPlanSaves() {
        try {
            const storage = global.planStorage || null;
            if (!storage || typeof storage.flushSaves !== 'function') return true;
            return storage.flushSaves() !== false;
        } catch (_) {
            return false;
        }
    }

    function reloadAfterPlanFlush() {
        if (planWriteFailed || !flushPlanSaves()) {
            try {
                uiAlert(
                    'Could not save changes',
                    '<p>Your latest planner changes could not be saved in this browser. The requested change was cancelled.</p>'
                );
            } catch (_) {}
            return false;
        }
        global.location.reload();
        return true;
    }

    function termCodeForServiceWorker(value) {
        const raw = String(value || '').trim();
        if (/^\d{6}$/.test(raw)) return raw;
        try {
            if (typeof global.termNameToCode === 'function') {
                const code = String(global.termNameToCode(raw) || '').trim();
                if (/^\d{6}$/.test(code)) return code;
            }
        } catch (_) {}
        return '';
    }

    function selectedPlanDataPaths() {
        const paths = new Set();
        const liveCurriculum = global.curriculum || null;
        const addDegree = (programValue, termValue) => {
            const program = String(programValue || '').trim().toUpperCase();
            const term = termCodeForServiceWorker(termValue);
            if (!/^[A-Z]{2,5}$/.test(program) || !term) return;
            paths.add(`requirements/${term}.jsonl`);
            paths.add(`courses/${term}/${program}.jsonl`);
        };
        const addMinor = (programValue, termValue) => {
            const program = String(programValue || '').trim().toUpperCase();
            const term = termCodeForServiceWorker(termValue);
            if (!/^[A-Z0-9-]{2,24}$/.test(program) || !term) return;
            paths.add(`requirements/minors/${term}.jsonl`);
            paths.add(`courses/minors/${term}/${program}.jsonl`);
        };

        addDegree(
            (liveCurriculum && liveCurriculum.major) || planGetItem('major') || getInitialMajor(),
            (liveCurriculum && liveCurriculum.entryTerm) || planGetItem('entryTerm'),
        );
        addDegree(
            (liveCurriculum && liveCurriculum.doubleMajor) || planGetItem('doubleMajor'),
            (liveCurriculum && liveCurriculum.entryTermDM)
                || planGetItem('entryTermDM')
                || planGetItem('entryTerm'),
        );

        const liveMinors = liveCurriculum && Array.isArray(liveCurriculum.minors)
            ? liveCurriculum.minors
            : null;
        if (liveMinors) {
            for (const minor of liveMinors) {
                const liveTerm = liveCurriculum.minorTermsByCode
                    && liveCurriculum.minorTermsByCode[minor];
                addMinor(minor, liveTerm || liveCurriculum.entryTermMinor);
            }
        } else {
            addMinor(planGetItem('minor1'), planGetItem('entryTermMinor1') || planGetItem('entryTermMinor'));
            addMinor(planGetItem('minor2'), planGetItem('entryTermMinor2') || planGetItem('entryTermMinor'));
            addMinor(planGetItem('minor3'), planGetItem('entryTermMinor3') || planGetItem('entryTermMinor'));
        }
        return Array.from(paths);
    }

    function sendServiceWorkerPlanWarmup() {
        const urls = selectedPlanDataPaths();
        if (!urls.length) return;

        const workers = new Set();
        if (serviceWorkerRegistration) {
            workers.add(serviceWorkerRegistration.installing);
            workers.add(serviceWorkerRegistration.waiting);
            workers.add(serviceWorkerRegistration.active);
        }
        try { workers.add(global.navigator.serviceWorker.controller); } catch (_) {}
        workers.delete(null);
        workers.delete(undefined);
        for (const worker of workers) {
            try { worker.postMessage({ type: 'CACHE_PLAN_URLS', urls }); } catch (_) {}
        }
    }

    function queueServiceWorkerPlanWarmup(changedKey) {
        const selectionKeys = [
            'major', 'entryTerm', 'doubleMajor', 'entryTermDM',
            'minor1', 'minor2', 'minor3', 'entryTermMinor',
            'entryTermMinor1', 'entryTermMinor2', 'entryTermMinor3',
        ];
        if (changedKey && !selectionKeys.includes(String(changedKey))) return;
        if (!serviceWorkerRegistration) return;
        if (serviceWorkerWarmTimer) global.clearTimeout(serviceWorkerWarmTimer);
        serviceWorkerWarmTimer = global.setTimeout(() => {
            serviceWorkerWarmTimer = null;
            sendServiceWorkerPlanWarmup();
        }, 100);
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    const admitTermPolicyListHtml =
        '<ul class="admit-term-policy-list">' +
        '<li><strong>Main major / minor:</strong> usually use your <strong>first term at Sabancı</strong> (your initial university entry term), even if you declared the program later or completed a prep/English year first. For most students, this means every minor uses the same admit term as the main major.</li>' +
        '<li><strong>Double major:</strong> if it started <strong>before Fall 2026-2027</strong>, use the <strong>first term after</strong> your double-major application was accepted. If it started in <strong>Fall 2026-2027 or later</strong>, use your <strong>initial university entry term</strong>.</li>' +
        '</ul>';
    const admitTermVerificationHtml =
        '<p class="admit-term-verification"><strong>Verify the relevant dates in SUIS → Student Records → General Student Information</strong> before relying on the planner.</p>';
    const admitTermGuidanceHtml =
        '<p>Your <strong>admit term</strong> tells SUrriculum which catalog and graduation requirements to use for each selected program. It is not necessarily the term when you declared that program.</p>' +
        admitTermPolicyListHtml +
        admitTermVerificationHtml;

    function normalizeCustomCourseForStorage(course) {
        const storage = global.planStorage || null;
        if (!storage || typeof storage.normalizeCustomCourse !== 'function') {
            throw new Error('Custom-course validation is unavailable.');
        }
        return storage.normalizeCustomCourse(course);
    }

    function normalizeCustomCourseListForStorage(program, list) {
        const storage = global.planStorage || null;
        if (!storage || typeof storage.normalizeCustomCourseList !== 'function') {
            throw new Error('Custom-course validation is unavailable.');
        }
        return storage.normalizeCustomCourseList(program, list);
    }

    async function uiAlert(title, bodyHtml) {
        try {
            const ui = global.uiModal || null;
            if (ui && typeof ui.alert === 'function') {
                await ui.alert(title || 'Notice', bodyHtml || '');
                return;
            }
        } catch (_) {}
        try { console.warn('[uiAlert]', title, bodyHtml); } catch (_) {}
    }

    async function uiConfirm(title, bodyHtml, options) {
        try {
            const ui = global.uiModal || null;
            if (ui && typeof ui.confirm === 'function') {
                return await ui.confirm(title || 'Confirm', bodyHtml || '', options || {});
            }
        } catch (_) {}
        try { console.warn('[uiConfirm]', title, bodyHtml); } catch (_) {}
        return false;
    }

    function activateAccessibleDialog(overlay, modal, titleElement, options) {
        const opts = options || {};
        const document = global.document;
        const previouslyFocused = document.activeElement instanceof global.HTMLElement
            ? document.activeElement : null;
        const dialogId = `surriculum-dialog-${++dialogSequence}`;
        if (titleElement) {
            titleElement.id = `${dialogId}-title`;
            overlay.setAttribute('aria-labelledby', titleElement.id);
        } else {
            overlay.setAttribute('aria-label', String(opts.label || 'Dialog'));
        }
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        modal.id = dialogId;
        modal.tabIndex = -1;

        let closed = false;
        const getFocusable = () => Array.from(modal.querySelectorAll(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
            'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )).filter((element) => (
            element.getAttribute('aria-hidden') !== 'true'
            && !element.closest('[hidden], .is-hidden')
        ));
        const isTopmost = () => {
            const dialogs = Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]'))
                .filter((dialog) => dialog.isConnected);
            return dialogs[dialogs.length - 1] === overlay;
        };
        const close = (closeOptions) => {
            if (closed) return;
            closed = true;
            document.removeEventListener('keydown', onKeyDown, true);
            try { overlay.remove(); } catch (_) {}
            if (!closeOptions || closeOptions.restoreFocus !== false) {
                global.setTimeout(() => {
                    try {
                        if (previouslyFocused && previouslyFocused.isConnected) {
                            previouslyFocused.focus({ preventScroll: true });
                            return;
                        }
                        const remaining = Array.from(document.querySelectorAll(
                            '[role="dialog"][aria-modal="true"]'
                        )).filter((dialog) => dialog.isConnected);
                        const parent = remaining[remaining.length - 1];
                        if (!parent) return;
                        const fallback = parent.querySelector(
                            'button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
                            'a[href], textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
                        ) || parent;
                        fallback.focus({ preventScroll: true });
                    } catch (_) {}
                }, 0);
            }
        };
        const onKeyDown = (event) => {
            if (!isTopmost()) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopImmediatePropagation();
                if (typeof opts.onEscape === 'function') opts.onEscape();
                else close();
                return;
            }
            if (event.key !== 'Tab') return;
            const focusable = getFocusable();
            if (!focusable.length) {
                event.preventDefault();
                modal.focus({ preventScroll: true });
                return;
            }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            const active = document.activeElement;
            if (event.shiftKey && (active === first || !modal.contains(active))) {
                event.preventDefault();
                last.focus({ preventScroll: true });
            } else if (!event.shiftKey && (active === last || !modal.contains(active))) {
                event.preventDefault();
                first.focus({ preventScroll: true });
            }
        };
        document.addEventListener('keydown', onKeyDown, true);
        global.setTimeout(() => {
            if (closed) return;
            const initial = typeof opts.initialFocus === 'function'
                ? opts.initialFocus() : opts.initialFocus;
            const target = initial && initial.isConnected ? initial : (getFocusable()[0] || modal);
            try { target.focus({ preventScroll: true }); } catch (_) {}
        }, 0);
        return { close, dialogId };
    }

    function startServiceWorkerBootstrap() {
        if (!global.navigator || !('serviceWorker' in global.navigator)) return;
        global.navigator.serviceWorker.addEventListener('controllerchange', () => {
            sendServiceWorkerPlanWarmup();
        });
        global.addEventListener('load', async () => {
            let dataVersion = '';
            try {
                const response = await global.fetch('data/manifest.json', { cache: 'no-store' });
                if (response.ok) dataVersion = String((await response.json()).dataVersion || '');
            } catch (_) {}
            const appVersion = typeof global.APP_VERSION === 'string' ? global.APP_VERSION : '';
            const version = [appVersion, dataVersion].filter(Boolean).join('-');
            const url = version ? ('sw.js?v=' + encodeURIComponent(version)) : 'sw.js';
            try {
                await global.navigator.serviceWorker.register(url);
                serviceWorkerRegistration = await global.navigator.serviceWorker.ready;
                sendServiceWorkerPlanWarmup();
            } catch (_) {}
        });
    }

    const api = Object.freeze({
        configure,
        isSessionPlanAvailable,
        planGetItem,
        planSetItem,
        planRemoveItem,
        preferenceGetItem,
        preferenceSetItem,
        requestPlanSave,
        flushPlanSaves,
        reloadAfterPlanFlush,
        termCodeForServiceWorker,
        selectedPlanDataPaths,
        sendServiceWorkerPlanWarmup,
        queueServiceWorkerPlanWarmup,
        escapeHtml,
        normalizeCustomCourseForStorage,
        normalizeCustomCourseListForStorage,
        uiAlert,
        uiConfirm,
        activateAccessibleDialog,
        sessionPlanId,
        guidance: Object.freeze({
            policyListHtml: admitTermPolicyListHtml,
            verificationHtml: admitTermVerificationHtml,
            html: admitTermGuidanceHtml,
        }),
        get planWriteFailed() { return planWriteFailed; },
    });

    global.surriculumAppRuntime = api;
    Object.assign(global, {
        planGetItem,
        planSetItem,
        planRemoveItem,
        preferenceGetItem,
        preferenceSetItem,
        requestPlanSave,
        flushPlanSaves,
        reloadAfterPlanFlush,
        escapeHtml,
        normalizeCustomCourseForStorage,
        normalizeCustomCourseListForStorage,
        uiAlert,
        uiConfirm,
        activateAccessibleDialog,
        admitTermPolicyListHtml,
        admitTermVerificationHtml,
        admitTermGuidanceHtml,
        _planIdForSession: sessionPlanId,
    });
    startServiceWorkerBootstrap();
})(typeof window !== 'undefined' ? window : globalThis);
