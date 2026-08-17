// Import statements removed. `s_curriculum` is expected to be defined
// globally by s_curriculum.js when loaded as a non-module script.

// Remove ES module imports for graduation_check. The functions
// displayGraduationResults and displaySummary will be attached to the
// global window object by graduation_check.js when loaded as a
// non-module script.

let course_data;
//can only be CS, BIO, MAT, EE, ME, IE, ECON, DSA, MAN, PSIR, PSY, VACD:
let initial_major_chosen = 'CS'
let saveInterval;
let _serviceWorkerRegistration = null;
let _serviceWorkerWarmTimer = null;
let _planWriteFailed = false;

const _planIdForSession = (() => {
    try {
        if (typeof window !== 'undefined' && window.planStorage && typeof window.planStorage.getSessionPlanId === 'function') {
            return window.planStorage.getSessionPlanId();
        }
    } catch (_) {}
    return null;
})();

function planGetItem(key) {
    if (typeof window !== 'undefined' && window.planStorage && typeof window.planStorage.getItem === 'function') {
        try {
            return window.planStorage.getItem(key, _planIdForSession || undefined);
        } catch (err) {
            try { console.error('Failed to read plan data:', err); } catch (_) {}
            return null;
        }
    }
    try { return localStorage.getItem(key); } catch (_) {}
    return null;
}

function planSetItem(key, value) {
    if (typeof window !== 'undefined' && window.planStorage && typeof window.planStorage.setItem === 'function') {
        try {
            if (window.planStorage.setItem(key, value, _planIdForSession || undefined) === false) {
                _planWriteFailed = true;
                return false;
            }
            queueServiceWorkerPlanWarmup(key);
            return true;
        } catch (err) {
            _planWriteFailed = true;
            try { console.error('Failed to save plan data:', err); } catch (_) {}
            return false;
        }
    }
    try {
        localStorage.setItem(key, value);
        queueServiceWorkerPlanWarmup(key);
        return true;
    } catch (_) {
        _planWriteFailed = true;
        return false;
    }
}

function planRemoveItem(key) {
    try {
        if (typeof window !== 'undefined' && window.planStorage && typeof window.planStorage.removeItem === 'function') {
            if (window.planStorage.removeItem(key, _planIdForSession || undefined) === false) {
                _planWriteFailed = true;
                return false;
            }
            return true;
        }
    } catch (_) {
        _planWriteFailed = true;
        return false;
    }
    try {
        localStorage.removeItem(key);
        return true;
    } catch (_) {
        _planWriteFailed = true;
        return false;
    }
}

function preferenceGetItem(key) {
    try {
        const preferences = (typeof window !== 'undefined') ? window.preferenceStorage : null;
        if (preferences && typeof preferences.getItem === 'function') {
            return preferences.getItem(key);
        }
    } catch (_) {}
    return null;
}

function preferenceSetItem(key, value) {
    try {
        const preferences = (typeof window !== 'undefined') ? window.preferenceStorage : null;
        if (preferences && typeof preferences.setItem === 'function') {
            return preferences.setItem(key, value) !== false;
        }
    } catch (_) {}
    return false;
}

function requestPlanSave() {
    try {
        const storage = (typeof window !== 'undefined') ? window.planStorage : null;
        return !!(storage && typeof storage.requestSave === 'function' && storage.requestSave());
    } catch (_) {}
    return false;
}

function flushPlanSaves() {
    try {
        const storage = (typeof window !== 'undefined') ? window.planStorage : null;
        if (!storage || typeof storage.flushSaves !== 'function') return true;
        return storage.flushSaves() !== false;
    } catch (_) {
        return false;
    }
}

function reloadAfterPlanFlush() {
    if (_planWriteFailed || !flushPlanSaves()) {
        try {
            uiAlert(
                'Could not save changes',
                '<p>Your latest planner changes could not be saved in this browser. The requested change was cancelled.</p>'
            );
        } catch (_) {}
        return false;
    }
    location.reload();
    return true;
}

function termCodeForServiceWorker(value) {
    const raw = String(value || '').trim();
    if (/^\d{6}$/.test(raw)) return raw;
    try {
        if (typeof termNameToCode === 'function') {
            const code = String(termNameToCode(raw) || '').trim();
            if (/^\d{6}$/.test(code)) return code;
        }
    } catch (_) {}
    return '';
}

function selectedPlanDataPaths() {
    const paths = new Set();
    const liveCurriculum = (typeof window !== 'undefined' && window.curriculum)
        ? window.curriculum
        : null;
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
        (liveCurriculum && liveCurriculum.major) || planGetItem('major') || initial_major_chosen,
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
    if (_serviceWorkerRegistration) {
        workers.add(_serviceWorkerRegistration.installing);
        workers.add(_serviceWorkerRegistration.waiting);
        workers.add(_serviceWorkerRegistration.active);
    }
    try { workers.add(navigator.serviceWorker.controller); } catch (_) {}
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
    if (!_serviceWorkerRegistration) return;
    if (_serviceWorkerWarmTimer) clearTimeout(_serviceWorkerWarmTimer);
    _serviceWorkerWarmTimer = setTimeout(() => {
        _serviceWorkerWarmTimer = null;
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

// Keep the user-facing admit-term policy in one place so the sidebar help,
// transcript reminder, and full Help guide cannot drift apart.
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
    const storage = (typeof window !== 'undefined') ? window.planStorage : null;
    if (!storage || typeof storage.normalizeCustomCourse !== 'function') {
        throw new Error('Custom-course validation is unavailable.');
    }
    return storage.normalizeCustomCourse(course);
}

function normalizeCustomCourseListForStorage(program, list) {
    const storage = (typeof window !== 'undefined') ? window.planStorage : null;
    if (!storage || typeof storage.normalizeCustomCourseList !== 'function') {
        throw new Error('Custom-course validation is unavailable.');
    }
    return storage.normalizeCustomCourseList(program, list);
}

async function uiAlert(title, bodyHtml) {
    try {
        const ui = (typeof window !== 'undefined') ? window.uiModal : null;
        if (ui && typeof ui.alert === 'function') {
            await ui.alert(title || 'Notice', bodyHtml || '');
            return;
        }
    } catch (_) {}
    // No browser alerts: fallback to console only.
    try { console.warn('[uiAlert]', title, bodyHtml); } catch (_) {}
}

async function uiConfirm(title, bodyHtml, options) {
    try {
        const ui = (typeof window !== 'undefined') ? window.uiModal : null;
        if (ui && typeof ui.confirm === 'function') {
            return await ui.confirm(title || 'Confirm', bodyHtml || '', options || {});
        }
    } catch (_) {}
    try { console.warn('[uiConfirm]', title, bodyHtml); } catch (_) {}
    return false;
}

let _appDialogSequence = 0;
function activateAccessibleDialog(overlay, modal, titleElement, options) {
    const opts = options || {};
    const previouslyFocused = document.activeElement instanceof HTMLElement
        ? document.activeElement : null;
    const dialogId = `surriculum-dialog-${++_appDialogSequence}`;
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
            // A parent dialog may rerender its action row in the close
            // callback. Restore on the next task so a disconnected opener can
            // fall back to the first control in that still-open parent.
            setTimeout(() => {
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
    setTimeout(() => {
        if (closed) return;
        const initial = typeof opts.initialFocus === 'function'
            ? opts.initialFocus() : opts.initialFocus;
        const target = initial && initial.isConnected ? initial : (getFocusable()[0] || modal);
        try { target.focus({ preventScroll: true }); } catch (_) {}
    }, 0);
    return { close, dialogId };
}

if ('serviceWorker' in navigator) {
    // During an upgrade, ready may initially refer to the old active worker.
    // Re-send after the newly installed worker takes control so the first 3.1
    // visit is warm for offline use without requiring a second online reload.
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        sendServiceWorkerPlanWarmup();
    });
    window.addEventListener('load', async () => {
        // Derive the service-worker cache key from the app version (version.js)
        // and the data version (data/manifest.json) so that a release OR a
        // re-scrape rotates the cache automatically — no manual cache bump. If the
        // manifest can't be read, fall back to app version alone, then to a
        // plain registration.
        let dataVersion = '';
        try {
            const res = await fetch('data/manifest.json', { cache: 'no-store' });
            if (res.ok) dataVersion = String((await res.json()).dataVersion || '');
        } catch (_) {}
        const appVersion = (typeof window.APP_VERSION === 'string') ? window.APP_VERSION : '';
        const v = [appVersion, dataVersion].filter(Boolean).join('-');
        const url = v ? ('sw.js?v=' + encodeURIComponent(v)) : 'sw.js';
        try {
            // Await the registration Promise so asynchronous failures are
            // contained. The existing active worker remains available; an
            // unversioned fallback would only create a second cache identity.
            await navigator.serviceWorker.register(url);
            _serviceWorkerRegistration = await navigator.serviceWorker.ready;
            sendServiceWorkerPlanWarmup();
        } catch (_) {}
    });
}


function SUrriculum(major_chosen_by_user) {
    function parseJsonOrJsonl(text) {
        const trimmed = (text || '').trim();
        if (!trimmed) return null;
        try {
            return JSON.parse(trimmed);
        } catch (_) {
            try {
                const lines = trimmed.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
                return lines.map(line => JSON.parse(line));
            } catch (_) {
                return null;
            }
        }
    }

    function parseMajorsByTerm(text) {
        const parsed = parseJsonOrJsonl(text);
        if (!parsed) return {};
        if (Array.isArray(parsed)) {
            const out = {};
            for (const rec of parsed) {
                if (!rec || typeof rec !== 'object') continue;
                const term = rec.term;
                const majors = rec.majors;
                if (!term || !Array.isArray(majors)) continue;
                out[String(term)] = majors;
            }
            return out;
        }
        if (typeof parsed === 'object') return parsed;
        return {};
    }

    /**
     * Attempt to fetch course data for the given major. By default the data
     * is expected to live under `./courses/${major}.jsonl`, but in some
     * deployments legacy `.json` files are present, or the files are present
     * at the root (e.g., `./CS.jsonl`).
     * This helper first tries the canonical location and falls back to the
     * root if the first fetch fails. It always returns a resolved Promise
     * with the parsed JSON or rejects if neither location is found.
     *
     * @param {string} major
     * @returns {Promise<Object[]>}
     */
    // Load mapping of available majors per term. Generated by the scraping
    // scripts and stored in courses/terms.jsonl. This allows the major
    // selector to display only the programs offered in the chosen year.
    let majorsByTerm = {};
    try {
        const termPaths = ['./courses/terms.jsonl', './courses/terms.json'];
        for (const p of termPaths) {
            const xhr = new XMLHttpRequest();
            xhr.open('GET', p, false);
            xhr.overrideMimeType('application/json');
            xhr.send(null);
            if (xhr.status === 200 || xhr.status === 0) {
                const parsed = parseMajorsByTerm(xhr.responseText);
                if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) {
                    majorsByTerm = parsed;
                    break;
                }
            }
        }
    } catch (_) {}
    const defaultMajors = majorsByTerm['default'] || ['BIO','CS','EE','IE','MAT','ME','ECON','DSA','MAN','PSIR','PSY','VACD'];
    function getMajorsForTerm(code) {
        return majorsByTerm[code] || defaultMajors;
    }

    // Build entry term options from the scraped term manifest so admit term
    // selectors only show terms for which data exists. Cap the upper bound
    // dynamically based on the device's current term.
    try {
        const termCodeKeys = Object.keys(majorsByTerm || {}).filter(k => /^\d{6}$/.test(k));
        const termCodes = termCodeKeys.map(k => parseInt(k, 10)).filter(n => !isNaN(n));
        termCodes.sort((a, b) => b - a);
        const minCode = 201901; // fixed minimum (Fall 2019-2020)
        const maxAvailable = termCodes.length ? termCodes[0] : minCode;
        let currentCode = 0;
        try {
            const ctName = (typeof window !== 'undefined' && window.currentTermName) ? window.currentTermName : '';
            currentCode = parseInt(termNameToCode(ctName), 10) || 0;
        } catch (_) {}
        const maxCode = Math.max(maxAvailable, currentCode);
        const entryCodes = termCodes.filter(c => c >= minCode && c <= maxCode);
        const entryNames = entryCodes.map(c => termCodeToName(String(c)));
        if (Array.isArray(entryNames) && entryNames.length) {
            entryTerms = entryNames;
        }
    } catch (_) {}

    // Load course list for a specific major and term code (e.g. "202301").
    // Files are stored under courses/<term>/<major>.jsonl. Fallback to the
    // root if the term-specific file is not found to preserve backward
    // compatibility with older deployments.
    function fetchCourseData(major, termCode) {
        // Build relative paths for the course JSON files. We avoid
        // computing absolute file URLs for file:// origins because
        // Chrome treats different file paths as different origins,
        // blocking cross-file requests. Using relative paths keeps
        // requests within the same origin (the directory of index.html).
        const primaryBase = `courses/${termCode}/${major}`;
        const fallbackBase = `courses/${major}`;
        const rootBase = `${major}`;

        // Helper to synchronously read JSON via XMLHttpRequest.  When
        // accessing resources under the file:// protocol many browsers
        // block fetch() due to CORS or security restrictions.  A
        // synchronous XHR is still permitted in these scenarios and
        // returns status 0 on success.  This helper returns a parsed
        // array of courses or null if the file could not be read.
        const tryRead = (path) => {
            try {
                const xhr = new XMLHttpRequest();
                xhr.open('GET', path, false);
                xhr.overrideMimeType('application/json');
                xhr.send(null);
                if (xhr.status === 200 || xhr.status === 0) {
                    const parsed = parseJsonOrJsonl(xhr.responseText);
                    if (parsed === null) return null;
                    return Array.isArray(parsed) ? parsed : [];
                }
            } catch (_) {
                // ignore errors and fall through
            }
            return null;
        };

        // Paths to attempt loading the course data.  We try the term
        // specific location first, followed by a fallback (no term) and
        // finally the root.  This preserves compatibility with older
        // deployments where the JSON files live in the top level.
        const paths = [
            `${primaryBase}.jsonl`,
            `${primaryBase}.json`,
            `${fallbackBase}.jsonl`,
            `${fallbackBase}.json`,
            `${rootBase}.jsonl`,
            `${rootBase}.json`,
        ];

        // If running under file://, prefer synchronous XHR to bypass
        // fetch() restrictions.  We iterate each candidate path and
        // return on the first successful read.  If all attempts
        // fail, return an empty array.  For http(s) origins we still
        // attempt fetch() but only after synchronous reads fail.
        return (async () => {
            for (const p of paths) {
                const read = tryRead(p);
                if (read) {
                    return read;
                }
            }
            // If synchronous reads failed (likely under http(s)), fall
            // back to fetch.  Check res.ok and parse JSON.  Note: fetch
            // does not reject on 404; we must inspect ok.  If the
            // parsed value is not an array, return an empty list.
            for (const p of paths) {
                try {
                    const res = await fetch(p);
                    if (res.ok) {
                        const text = await res.text();
                        const data = parseJsonOrJsonl(text);
                        if (data === null) continue;
                        return Array.isArray(data) ? data : [];
                    }
                } catch (_) {
                    // ignore errors and continue
                }
            }
            return [];
        })();
    }
    // Determine entry terms for main and double majors from localStorage. The
    // terms are stored as display strings (e.g. "Fall 2023-2024"). We convert
    // them to numeric codes to locate the scraped JSON files.
    let entryTermName = planGetItem('entryTerm') || '';
    if (!entryTermName || (Array.isArray(entryTerms) && entryTerms.length && !entryTerms.includes(entryTermName))) {
        entryTermName = entryTerms[0];
    }
    let entryTermDMName = planGetItem('entryTermDM') || entryTermName;
    if (!entryTermDMName || (Array.isArray(entryTerms) && entryTerms.length && !entryTerms.includes(entryTermDMName))) {
        entryTermDMName = entryTermName;
    }

    // Minor admit term options: prefer the scraped minor term manifest if
    // available; otherwise fall back to the general entry terms list.
    let minorEntryTerms = entryTerms;
    try {
        const codes = (typeof window !== 'undefined' && typeof window.loadMinorTermCodes === 'function')
            ? window.loadMinorTermCodes()
            : [];
        if (Array.isArray(codes) && codes.length) {
            const names = codes.map(c => termCodeToName(String(c))).filter(Boolean);
            if (names.length) minorEntryTerms = names;
        }
    } catch (_) {}

    const pickValidMinorTermName = (candidate, fallback) => {
        const c = String(candidate || '').trim();
        if (!c) return fallback;
        if (Array.isArray(minorEntryTerms) && minorEntryTerms.length && !minorEntryTerms.includes(c)) return fallback;
        return c;
    };
    const minorDefaultTermName = (() => {
        if (Array.isArray(minorEntryTerms) && minorEntryTerms.length) {
            if (minorEntryTerms.includes(entryTermName)) return entryTermName;
            return minorEntryTerms[0];
        }
        return entryTermName;
    })();
    const legacyMinorTermName = planGetItem('entryTermMinor') || '';
    const entryTermMinor1Name = pickValidMinorTermName(planGetItem('entryTermMinor1') || legacyMinorTermName, minorDefaultTermName);
    const entryTermMinor2Name = pickValidMinorTermName(planGetItem('entryTermMinor2') || legacyMinorTermName, minorDefaultTermName);
    const entryTermMinor3Name = pickValidMinorTermName(planGetItem('entryTermMinor3') || legacyMinorTermName, minorDefaultTermName);
    try {
        if (!planGetItem('major')) planSetItem('major', major_chosen_by_user);
        if (!planGetItem('entryTerm')) planSetItem('entryTerm', entryTermName);
        if (!planGetItem('entryTermDM')) planSetItem('entryTermDM', entryTermDMName);
        if (!planGetItem('entryTermMinor1')) planSetItem('entryTermMinor1', entryTermMinor1Name);
        if (!planGetItem('entryTermMinor2')) planSetItem('entryTermMinor2', entryTermMinor2Name);
        if (!planGetItem('entryTermMinor3')) planSetItem('entryTermMinor3', entryTermMinor3Name);
        // Keep the legacy key in sync (older exports/backwards compatibility).
        if (!planGetItem('entryTermMinor') || planGetItem('entryTermMinor') !== entryTermMinor1Name) {
            planSetItem('entryTermMinor', entryTermMinor1Name);
        }
    } catch (_) {}
    const entryTermCode = termNameToCode(entryTermName);
    const entryTermDMCode = termNameToCode(entryTermDMName);
    const entryTermMinor1Code = termNameToCode(entryTermMinor1Name);
    const entryTermMinor2Code = termNameToCode(entryTermMinor2Name);
    const entryTermMinor3Code = termNameToCode(entryTermMinor3Name);

    // requirements.js starts unavailable. Load the exact main/DM term files
    // only after the stored selections have been validated against the term
    // manifest, so graduation never observes a synthetic or wrong-term record.
    try {
        if (typeof window.initializeRequirements === 'function') {
            window.initializeRequirements(entryTermCode, entryTermDMCode);
        }
    } catch (error) {
        console.error('Unable to initialize graduation requirements:', error);
    }

    // Storage for the double major's course data.  It will be populated when
    // the user selects a double major via setDoubleMajor().
    let doubleMajorCourseData = [];
    let doubleMajorCatalogCodeSet = new Set();
    let doubleMajorCustomCourseRecords = [];

    fetchCourseData(major_chosen_by_user, entryTermCode)
    .then(async json => {
        // If the course list could not be loaded, log a warning instead of
        // blocking the UI with an alert.  In some environments the
        // synchronous XHR may fail to resolve file:// URLs even when
        // the JSON exists, producing a false negative.  Logging a
        // warning allows the app to continue and display whatever
        // information could be retrieved.
        if (!json || json.length === 0) {
            console.warn('No course data available for ' + major_chosen_by_user + ' in ' + entryTermName + '.');
        }
    //START OF PROGRAM
        let change_major_element = document.querySelector('.change_major');
        let etElem = document.querySelector('.entryTerm');
        let etDmElem = document.querySelector('.entryTermDM');
        const etMinor1Elem = document.getElementById('minorTerm1');
        const etMinor2Elem = document.getElementById('minorTerm2');
        const etMinor3Elem = document.getElementById('minorTerm3');
        let dmElem = document.querySelector('.doubleMajor');
        const dmControlsRow = document.getElementById('doubleMajorControlsRow');
        const dmButtonRow = document.getElementById('doubleMajorButtonRow');
        const addDmBtn = document.getElementById('addDoubleMajorBtn');
        const minor1Row = document.getElementById('minor1Row');
        const minor2Row = document.getElementById('minor2Row');
        const minor3Row = document.getElementById('minor3Row');
        const addMinorRow = document.getElementById('addMinorRow');
        const addMinorBtn = document.getElementById('addMinorBtn');
        const minor1Select = document.getElementById('minor1');
        const minor2Select = document.getElementById('minor2');
        const minor3Select = document.getElementById('minor3');

        const setDmUiVisible = (visible) => {
            try {
                if (visible) {
                    if (dmControlsRow) dmControlsRow.classList.remove('is-hidden');
                    if (dmButtonRow) dmButtonRow.classList.add('is-hidden');
                } else {
                    if (dmControlsRow) dmControlsRow.classList.add('is-hidden');
                    if (dmButtonRow) dmButtonRow.classList.remove('is-hidden');
                }
            } catch (_) {}
        };

        const setMinorRowVisible = (row, visible) => {
            try {
                if (!row) return;
                if (visible) row.classList.remove('is-hidden');
                else row.classList.add('is-hidden');
            } catch (_) {}
        };
        // Populate and bind dropdown controls for major and entry terms
        if (change_major_element && change_major_element.tagName === 'SELECT') {
            const majorsList = getMajorsForTerm(entryTermCode);
            change_major_element.innerHTML = majorsList.map(m => `<option value="${m}">${m}</option>`).join('');
            change_major_element.value = major_chosen_by_user;
            change_major_element.addEventListener('change', function(e) {
                planSetItem('major', e.target.value);
                reloadAfterPlanFlush();
            });
        }
        if (etElem && etElem.tagName === 'SELECT') {
            etElem.innerHTML = entryTerms.map(t => `<option value="${t}">${t}</option>`).join('');
            etElem.value = entryTermName;
            etElem.addEventListener('change', function(e) {
                planSetItem('entryTerm', e.target.value);
                reloadAfterPlanFlush();
            });
        }
        if (dmElem && dmElem.tagName === 'SELECT') {
            const dmList = ['None'].concat(getMajorsForTerm(entryTermDMCode));
            dmElem.innerHTML = dmList.map(m => `<option value="${m === 'None' ? '' : m}">${m}</option>`).join('');
            dmElem.value = planGetItem('doubleMajor') || '';
            dmElem.addEventListener('change', function(e) {
                const val = e.target.value;
                if (val) {
                    planSetItem('doubleMajor', val);
                    planSetItem('showDoubleMajorControls', 'true');
                } else {
                    planRemoveItem('doubleMajor');
                    // Collapse the DM controls after the user explicitly sets it to None.
                    planSetItem('showDoubleMajorControls', 'false');
                }
                reloadAfterPlanFlush();
            });
        }
        if (etDmElem && etDmElem.tagName === 'SELECT') {
            etDmElem.innerHTML = entryTerms.map(t => `<option value="${t}">${t}</option>`).join('');
            etDmElem.value = entryTermDMName;
            etDmElem.addEventListener('change', function(e) {
                planSetItem('entryTermDM', e.target.value);
                reloadAfterPlanFlush();
            });
        }
        const bindMinorTermSelect = (elem, key, value) => {
            if (!elem || elem.tagName !== 'SELECT') return;
            elem.innerHTML = (minorEntryTerms || []).map(t => `<option value="${t}">${t}</option>`).join('');
            elem.value = value || '';
            elem.addEventListener('change', function(e) {
                planSetItem(key, e.target.value);
                // Keep legacy key aligned to the first minor term.
                if (key === 'entryTermMinor1') planSetItem('entryTermMinor', e.target.value);
                reloadAfterPlanFlush();
            });
        };
        bindMinorTermSelect(etMinor1Elem, 'entryTermMinor1', entryTermMinor1Name);
        bindMinorTermSelect(etMinor2Elem, 'entryTermMinor2', entryTermMinor2Name);
        bindMinorTermSelect(etMinor3Elem, 'entryTermMinor3', entryTermMinor3Name);

        // Double major UI: show dropdowns by default on first visit, but allow
        // collapsing them into a single "Add Double Major" button when the DM
        // is None/empty.
        try {
            const hasDM = !!(planGetItem('doubleMajor') || '');
            let showPref = false;
            try {
                const stored = planGetItem('showDoubleMajorControls');
                if (stored !== null) showPref = stored === 'true';
            } catch (_) {}
            if (hasDM) {
                setDmUiVisible(true);
                planSetItem('showDoubleMajorControls', 'true');
            } else {
                setDmUiVisible(showPref);
            }
            if (addDmBtn) {
                addDmBtn.addEventListener('click', function() {
                    setDmUiVisible(true);
                    planSetItem('showDoubleMajorControls', 'true');
                    try { if (dmElem) dmElem.focus(); } catch (_) {}
                });
            }
        } catch (_) {}

        // Minor UI (up to 3): similar UX to double major, but allows multiple.
        try {
            // Load term-specific minor requirements if available.
            try {
                // Use the first minor term as the default catalog view for the dropdowns.
                if (typeof window !== 'undefined' && typeof window.loadMinorRequirementsForTerm === 'function' && entryTermMinor1Code) {
                    window.minorRequirements = window.loadMinorRequirementsForTerm(entryTermMinor1Code) || {};
                }
            } catch (_) {}
            const minorReq = (typeof window !== 'undefined' && window.minorRequirements) ? window.minorRequirements : {};
            const minorList = Object.values(minorReq || {}).filter(Boolean).sort((a, b) => {
                const an = String(a.name || a.minor || '');
                const bn = String(b.name || b.minor || '');
                return an.localeCompare(bn);
            });
            const shortenMinorLabel = (fullName) => {
                const raw = String(fullName || '').trim();
                if (!raw) return '';
                const MAX = 44;
                if (raw.length <= MAX) return raw;
                let s = raw;
                s = s.replace(/\bMinor Program\b/ig, '').replace(/\bProgram\b/ig, '').replace(/\bMinor\b/ig, '');
                s = s.replace(/\bin\b/ig, ' ').replace(/\s{2,}/g, ' ').trim();
                s = s.replace(/\band\b/ig, '&');
                if (s.length <= MAX) return s;
                if (s.includes('(')) {
                    const before = s.split('(')[0].trim();
                    if (before.length >= 10 && before.length < s.length) s = before;
                }
                if (s.length <= MAX) return s;
                return s.slice(0, MAX - 3).trimEnd() + '...';
            };

            const optionsHtml = ['<option value=\"\">None</option>'].concat(
                minorList.map(rec => {
                    const full = String(rec.name || rec.minor || '').trim() || String(rec.minor || '');
                    const short = shortenMinorLabel(full) || full;
                    return `<option value=\"${escapeHtml(rec.minor)}\" title=\"${escapeHtml(full)}\">${escapeHtml(short)}</option>`;
                })
            ).join('');

            const getMinor = (k) => {
                try { return planGetItem(k) || ''; } catch (_) {}
                return '';
            };
            const setMinor = (k, v) => {
                try {
                    if (v) planSetItem(k, v);
                    else planRemoveItem(k);
                } catch (_) {}
            };
            const getMinorTerm = (slot) => {
                try {
                    const k = `entryTermMinor${slot}`;
                    const v = planGetItem(k) || '';
                    if (v) return v;
                } catch (_) {}
                if (slot === 1) return entryTermMinor1Name;
                if (slot === 2) return entryTermMinor2Name;
                if (slot === 3) return entryTermMinor3Name;
                return minorDefaultTermName;
            };
            const setMinorTerm = (slot, value) => {
                try {
                    const k = `entryTermMinor${slot}`;
                    planSetItem(k, value || minorDefaultTermName);
                    if (slot === 1) planSetItem('entryTermMinor', value || minorDefaultTermName);
                } catch (_) {}
            };

            const saved1 = getMinor('minor1');
            const saved2 = getMinor('minor2');
            const saved3 = getMinor('minor3');
            const hasAny = !!(saved1 || saved2 || saved3);

            let showPref = false; // hide minor controls on first visit
            try {
                const stored = planGetItem('showMinorControls');
                if (stored !== null) showPref = stored === 'true';
            } catch (_) {}

            const ensureSelect = (sel, value) => {
                if (!sel || sel.tagName !== 'SELECT') return;
                sel.innerHTML = optionsHtml;
                sel.value = value || '';
            };
            ensureSelect(minor1Select, saved1);
            ensureSelect(minor2Select, saved2);
            ensureSelect(minor3Select, saved3);
            const updateMinorOptionAvailability = () => {
                const selects = [minor1Select, minor2Select, minor3Select].filter(Boolean);
                selects.forEach((select) => {
                    const selectedElsewhere = new Set(selects
                        .filter((other) => other !== select)
                        .map((other) => String(other.value || ''))
                        .filter(Boolean));
                    Array.from(select.options).forEach((option) => {
                        // Preserve an already-selected duplicate from an older
                        // plan, but prevent users from creating a new duplicate.
                        option.disabled = !!option.value
                            && option.value !== select.value
                            && selectedElsewhere.has(option.value);
                    });
                });
            };
            updateMinorOptionAvailability();

            // Visibility: if no minors selected, obey preference; otherwise show
            // the rows needed to display the selected minors.
            if (!hasAny && !showPref) {
                setMinorRowVisible(minor1Row, false);
                setMinorRowVisible(minor2Row, false);
                setMinorRowVisible(minor3Row, false);
            } else {
                setMinorRowVisible(minor1Row, true);
                setMinorRowVisible(minor2Row, !!saved2);
                setMinorRowVisible(minor3Row, !!saved3);
            }

            const updateAddMinorBtn = () => {
                try {
                    if (!addMinorBtn) return;
                    const r1 = minor1Row && !minor1Row.classList.contains('is-hidden');
                    const r2 = minor2Row && !minor2Row.classList.contains('is-hidden');
                    const r3 = minor3Row && !minor3Row.classList.contains('is-hidden');
                    const atMax = !!(r1 && r2 && r3);
                    addMinorBtn.disabled = atMax;
                    if (addMinorRow) {
                        if (atMax) addMinorRow.classList.add('is-hidden');
                        else addMinorRow.classList.remove('is-hidden');
                    }
                } catch (_) {}
            };
            updateAddMinorBtn();

            const onMinorChange = (slot, value) => {
                // Persist and keep minors compact: if an earlier slot is cleared,
                // shift later minors up.
                const v = value || '';
                if (slot === 1) {
                    if (!v) {
                        const next1 = saved2 || '';
                        const next2 = saved3 || '';
                        setMinor('minor1', next1);
                        setMinor('minor2', next2);
                        setMinor('minor3', '');
                        setMinorTerm(1, getMinorTerm(2));
                        setMinorTerm(2, getMinorTerm(3));
                        setMinorTerm(3, minorDefaultTermName);
                        const stillHasAny = !!(next1 || next2);
                        planSetItem('showMinorControls', stillHasAny ? 'true' : 'false');
                    } else {
                        setMinor('minor1', v);
                        planSetItem('showMinorControls', 'true');
                    }
                } else if (slot === 2) {
                    if (!v) {
                        setMinor('minor2', saved3 || '');
                        setMinor('minor3', '');
                        setMinorTerm(2, getMinorTerm(3));
                        setMinorTerm(3, minorDefaultTermName);
                    } else {
                        setMinor('minor2', v);
                    }
                    planSetItem('showMinorControls', 'true');
                } else if (slot === 3) {
                    if (!v) setMinor('minor3', '');
                    else setMinor('minor3', v);
                    planSetItem('showMinorControls', 'true');
                }
                reloadAfterPlanFlush();
            };

            if (minor1Select) {
                minor1Select.addEventListener('change', (e) => onMinorChange(1, e.target.value));
            }
            if (minor2Select) {
                minor2Select.addEventListener('change', (e) => onMinorChange(2, e.target.value));
            }
            if (minor3Select) {
                minor3Select.addEventListener('change', (e) => onMinorChange(3, e.target.value));
            }

            if (addMinorBtn) {
                addMinorBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    planSetItem('showMinorControls', 'true');
                    // Reveal the next hidden minor row.
                    if (minor1Row && minor1Row.classList.contains('is-hidden')) setMinorRowVisible(minor1Row, true);
                    else if (minor2Row && minor2Row.classList.contains('is-hidden')) setMinorRowVisible(minor2Row, true);
                    else if (minor3Row && minor3Row.classList.contains('is-hidden')) setMinorRowVisible(minor3Row, true);
                    updateAddMinorBtn();
                    try {
                        if (minor1Row && !minor1Row.classList.contains('is-hidden') && minor1Select && !minor1Select.value) minor1Select.focus();
                        else if (minor2Row && !minor2Row.classList.contains('is-hidden') && minor2Select && !minor2Select.value) minor2Select.focus();
                        else if (minor3Row && !minor3Row.classList.contains('is-hidden') && minor3Select && !minor3Select.value) minor3Select.focus();
                    } catch (_) {}
                });
            }
        } catch (_) {}

    const primaryProgramCatalogData = Array.isArray(json) ? json : [];
    const primaryCatalogCodeSet = new Set(primaryProgramCatalogData.map(function(record) {
        return String((record && record.Major) || '') + String((record && record.Code) || '');
    }).map(function(code) {
        return code.toUpperCase().replace(/\s+/g, '');
    }).filter(Boolean));
    const primaryCatalogIdentitySet = _customClassificationIdentitySet(primaryCatalogCodeSet);
    let primaryCustomCourseRecords = [];
    course_data = primaryProgramCatalogData;

    // ----------------------------------------------------------------------
    // Load any previously defined custom courses for this major from
    // localStorage. Custom courses are stored as an array of course
    // objects keyed by `customCourses_<major>`. These custom courses are
    // appended to the fetched course_data. This allows users to define
    // additional courses specific to a major without modifying the
    // underlying JSON files. On first use, the key may not exist so
    // JSON.parse on an empty string would throw; guard accordingly.
    try {
        const customKey = 'customCourses_' + major_chosen_by_user;
        const stored = planGetItem(customKey);
        if (stored) {
            const parsed = JSON.parse(stored);
            if (Array.isArray(parsed)) {
                primaryCustomCourseRecords = _activeCustomCourseRecords(
                    normalizeCustomCourseListForStorage(major_chosen_by_user, parsed),
                    primaryCatalogCodeSet
                );
                course_data = course_data.concat(primaryCustomCourseRecords);
            }
        }
    } catch (err) {
        console.error('Failed to load custom courses:', err);
    }

    // Preload double major data so that courses unique to the second major
    // are available when reloading semesters from localStorage.
    let savedDMPref = '';
    try {
        savedDMPref = planGetItem('doubleMajor') || '';
    } catch (_) {}
    if (savedDMPref) {
        const dmData = await fetchCourseData(savedDMPref, entryTermDMCode);
        if (Array.isArray(dmData)) {
            doubleMajorCourseData = dmData.slice();
        } else {
            doubleMajorCourseData = [];
        }
        doubleMajorCatalogCodeSet = new Set(doubleMajorCourseData.map(function(record) {
            return String((record && record.Major) || '') + String((record && record.Code) || '');
        }).map(function(code) {
            return code.toUpperCase().replace(/\s+/g, '');
        }).filter(Boolean));
        try {
            const keyDM = 'customCourses_' + savedDMPref;
            const storedDM = planGetItem(keyDM);
            if (storedDM) {
                const parsedDM = JSON.parse(storedDM);
                if (Array.isArray(parsedDM)) {
                    doubleMajorCustomCourseRecords = _activeCustomCourseRecords(
                        normalizeCustomCourseListForStorage(savedDMPref, parsedDM),
                        doubleMajorCatalogCodeSet
                    );
                    doubleMajorCourseData = doubleMajorCourseData.concat(doubleMajorCustomCourseRecords);
                }
            }
        } catch (_) {}
    }

    // Preload minor course lists (up to 3). Minor catalogs are stored under
    // courses/minors/<PROGRAM>.jsonl and are merged into the Add Course
    // dropdown similarly to double majors.
    function fetchMinorCourseData(minorProgram, termCode) {
        if (!minorProgram) return [];
        const tc = String(termCode || '').trim();
        const paths = [
            ...(tc ? [`courses/minors/${tc}/${minorProgram}.jsonl`, `courses/minors/${tc}/${minorProgram}.json`] : []),
            `courses/minors/${minorProgram}.jsonl`,
            `courses/minors/${minorProgram}.json`,
            `${minorProgram}.jsonl`,
            `${minorProgram}.json`,
        ];
        const tryRead = (path) => {
            try {
                const xhr = new XMLHttpRequest();
                xhr.open('GET', path, false);
                xhr.overrideMimeType('application/json');
                xhr.send(null);
                if (xhr.status === 200 || xhr.status === 0) {
                    const parsed = parseJsonOrJsonl(xhr.responseText);
                    if (parsed === null) return null;
                    return Array.isArray(parsed) ? parsed : [];
                }
            } catch (_) {}
            return null;
        };
        for (const p of paths) {
            const read = tryRead(p);
            if (read !== null) return read;
        }
        return [];
    }

    const minorProgramsSet = new Set();
    const minorTermsByCode = {};
    try {
        const m1 = planGetItem('minor1') || '';
        const m2 = planGetItem('minor2') || '';
        const m3 = planGetItem('minor3') || '';
        const t1 = termNameToCode(planGetItem('entryTermMinor1') || entryTermMinor1Name) || entryTermMinor1Code;
        const t2 = termNameToCode(planGetItem('entryTermMinor2') || entryTermMinor2Name) || entryTermMinor2Code;
        const t3 = termNameToCode(planGetItem('entryTermMinor3') || entryTermMinor3Name) || entryTermMinor3Code;
        if (m1) {
            minorProgramsSet.add(m1);
            if (!minorTermsByCode[m1]) minorTermsByCode[m1] = t1;
        }
        if (m2) {
            minorProgramsSet.add(m2);
            if (!minorTermsByCode[m2]) minorTermsByCode[m2] = t2;
        }
        if (m3) {
            minorProgramsSet.add(m3);
            if (!minorTermsByCode[m3]) minorTermsByCode[m3] = t3;
        }
    } catch (_) {}
    const minorPrograms = Array.from(minorProgramsSet);
    const minorCourseDataByCode = {};
    const minorCatalogCodeSetsByCode = {};
    const minorCustomCourseRecordsByCode = {};
    try {
        for (const mp of minorPrograms) {
            const data = fetchMinorCourseData(mp, minorTermsByCode[mp] || entryTermMinor1Code);
            const catalog = Array.isArray(data) ? data.slice() : [];
            const catalogCodes = new Set(catalog.map(function(record) {
                return String((record && record.Major) || '') + String((record && record.Code) || '');
            }).map(function(code) {
                return code.toUpperCase().replace(/\s+/g, '');
            }).filter(Boolean));
            minorCatalogCodeSetsByCode[mp] = catalogCodes;

            // The same durable program-scoped records used for main and double
            // majors also hold a selected minor's custom classification. Never
            // append an overlay that collides with an official catalog row: the
            // university's classification remains authoritative.
            const storedCustom = loadCustomCoursesForMajor(mp);
            const runtimeCustom = _activeCustomCourseRecords(storedCustom, catalogCodes);
            minorCustomCourseRecordsByCode[mp] = runtimeCustom;
            minorCourseDataByCode[mp] = catalog.concat(runtimeCustom);
        }
    } catch (_) {}
    let curriculum = new s_curriculum();
    curriculum.major = major_chosen_by_user;
    curriculum.entryTerm = entryTermCode;
    curriculum.entryTermDM = entryTermDMCode;
    // Backward-compatible field: use Minor 1 term as a "default minor term".
    curriculum.entryTermMinor = entryTermMinor1Code;
    if (savedDMPref) {
        curriculum.doubleMajorCourseData = doubleMajorCourseData;
        curriculum.doubleMajor = savedDMPref;
        curriculum.entryTermDM = entryTermDMCode;
    }
    if (minorPrograms.length) {
        curriculum.minors = minorPrograms.slice();
        curriculum.minorCourseDataByCode = { ...minorCourseDataByCode };
        curriculum.minorCatalogCodeSetsByCode = { ...minorCatalogCodeSetsByCode };
        curriculum.minorTermsByCode = { ...minorTermsByCode };
    } else {
        curriculum.minors = [];
        curriculum.minorCourseDataByCode = {};
        curriculum.minorCatalogCodeSetsByCode = {};
        curriculum.minorTermsByCode = {};
    }

    // Expose the curriculum object globally so that helper functions
    // (e.g., isCourseValid and getInfo) can access the double major
    // configuration. This is especially useful for validating courses
    // that belong solely to the double major. Without this, helper
    // functions cannot see doubleMajorCourseData and would reject
    // double-major-specific courses.
    if (typeof window !== 'undefined') {
        window.curriculum = curriculum;
    }

    // A saved transcript or scheduler selection can contain a real university
    // course that is absent from the selected program/admit-term catalogs.
    // Restore a small plan-scoped definition synchronously so one unresolved
    // code can never hold every semester behind the cumulative-index request.
    // These internal definitions stay out of Add Course and remain N/A until a
    // selected catalog supplies an authoritative program classification.
    const savedGlobalRecordCode = (record) => String(
        record && record.code
            ? record.code
            : String((record && record.Major) || '') + String((record && record.Code) || '')
    ).toUpperCase().replace(/\s+/g, '');

    function restoreGlobalDefinitionsForSavedCourses() {
        let saved = null;
        try {
            saved = JSON.parse(planGetItem('curriculum') || 'null');
        } catch (_) {
            saved = null;
        }
        if (!Array.isArray(saved)) return { added: [], missing: [] };

        const normalizedCodes = [];
        const seen = new Set();
        saved.forEach((semester) => {
            if (!Array.isArray(semester)) return;
            semester.forEach((rawCode) => {
                const code = String(rawCode || '').toUpperCase().replace(/\s+/g, '');
                if (!code || seen.has(code)) return;
                seen.add(code);
                normalizedCodes.push(code);
            });
        });
        if (!normalizedCodes.length) return { added: [], missing: [] };

        const selectedLists = [course_data, doubleMajorCourseData];
        try {
            if (curriculum.minorCourseDataByCode) {
                Object.values(curriculum.minorCourseDataByCode).forEach((list) => selectedLists.push(list));
            }
        } catch (_) {}
        const selectedCodes = new Set();
        selectedLists.forEach((list) => {
            if (!Array.isArray(list)) return;
            list.forEach((record) => {
                if (record && !record.__globalCourseDefinition) selectedCodes.add(savedGlobalRecordCode(record));
            });
        });
        const unresolved = normalizedCodes.filter((code) => !selectedCodes.has(code));
        if (!unresolved.length) return { added: [], missing: [] };

        const storedMetadata = (typeof window !== 'undefined'
            && typeof window.getStoredGlobalCourseMetadata === 'function')
            ? window.getStoredGlobalCourseMetadata() : new Map();
        const preserved = [];
        unresolved.forEach((code) => {
            if (course_data.some((record) => savedGlobalRecordCode(record) === code)) return;
            const match = code.match(/^([A-Z]{1,12})(\d[A-Z0-9]*)$/);
            if (!match) return;
            const metadata = storedMetadata.get(code) || {};
            const placeholder = {
                Major: match[1],
                Code: match[2],
                Course_Name: String(metadata.title || code),
                ECTS: String(Number.isFinite(Number(metadata.ects)) ? Number(metadata.ects) : 0),
                Engineering: 0,
                Basic_Science: 0,
                SU_credit: String(Number.isFinite(Number(metadata.suCredits)) ? Number(metadata.suCredits) : 0),
                Faculty: '',
                Faculty_Course: 'No',
                EL_Type: 'unknown',
                __globalCourseDefinition: true,
                __storedCoursePlaceholder: true,
            };
            course_data.push(placeholder);
            preserved.push(placeholder);
        });
        return { added: [], missing: unresolved.slice(), preserved };
    }

    // The stored snapshot is sufficient for immediate rendering. In the
    // background, let the shipped university index enrich older plan records
    // that predate metadata persistence. This must never gate planner startup.
    async function enrichRestoredGlobalDefinitions(restoration) {
        const pending = restoration && Array.isArray(restoration.preserved)
            ? restoration.preserved.slice() : [];
        if (!pending.length || typeof window === 'undefined'
            || typeof window.loadCoursePageInfoIndex !== 'function'
            || typeof window.resolveGlobalCourseDefinition !== 'function') return;

        try {
            await window.loadCoursePageInfoIndex();
        } catch (_) {
            return;
        }

        const storedMetadata = typeof window.getStoredGlobalCourseMetadata === 'function'
            ? window.getStoredGlobalCourseMetadata() : new Map();
        const resolvedByCode = new Map();
        pending.forEach((placeholder) => {
            const code = savedGlobalRecordCode(placeholder);
            if (!code) return;
            let resolved = null;
            try {
                resolved = window.resolveGlobalCourseDefinition(code, storedMetadata.get(code) || {});
            } catch (_) {}
            if (!resolved) return;
            const index = course_data.findIndex((record) => savedGlobalRecordCode(record) === code);
            if (index < 0 || (course_data[index] && !course_data[index].__globalCourseDefinition)) return;
            course_data[index] = resolved;
            resolvedByCode.set(code, resolved);
            try {
                if (typeof window.rememberGlobalCourseDefinition === 'function') {
                    window.rememberGlobalCourseDefinition(resolved);
                }
            } catch (_) {}
        });
        if (!resolvedByCode.size) return;

        (Array.isArray(curriculum.semesters) ? curriculum.semesters : []).forEach((semester) => {
            semester.totalGPA = 0;
            semester.totalGPACredits = 0;
            (Array.isArray(semester.courses) ? semester.courses : []).forEach((course) => {
                const definition = resolvedByCode.get(savedGlobalRecordCode(course));
                if (definition) {
                    course.SU_credit = parseCreditValue(definition.SU_credit || 0);
                    course.Basic_Science = Number(definition.Basic_Science || 0) || 0;
                    course.Engineering = Number(definition.Engineering || 0) || 0;
                    course.ECTS = Number(definition.ECTS || 0) || 0;
                    course.Faculty_Course = definition.Faculty_Course || 'No';
                    course.Faculty = definition.Faculty || '';
                    const node = course.id ? document.getElementById(course.id) : null;
                    const nameNode = node && node.querySelector('.course_name');
                    const creditNode = node && node.querySelector('.course_credit');
                    const scienceNode = node && node.querySelector('.course_bs_credit');
                    if (nameNode) nameNode.textContent = String(definition.Course_Name || course.code || '');
                    if (creditNode) creditNode.textContent = formatCreditValue(course.SU_credit) + ' credits';
                    if (scienceNode) scienceNode.textContent = 'BS: ' + course.Basic_Science + ' credits';
                }
                const outcome = typeof evaluateGradeForLegacyTotals === 'function'
                    ? evaluateGradeForLegacyTotals(course.grade, course.gradingBasis) : null;
                if (outcome && outcome.countsInGpa) {
                    const credit = Number(course.SU_credit || 0) || 0;
                    semester.totalGPA += credit * outcome.gpaPoints;
                    semester.totalGPACredits += credit;
                }
            });
        });
        try {
            if (typeof curriculum.recalcEffectiveTypes === 'function') {
                curriculum.recalcEffectiveTypes(course_data);
            }
        } catch (_) {}
    }
    // Initialize course details toggle state and event
    let showDetails = true;
    try {
        const stored = preferenceGetItem('showCourseDetails');
        if (stored !== null) {
            showDetails = stored === 'true';
        }
    } catch (_) {}
    if (typeof window !== 'undefined') {
        window.showCourseDetails = showDetails;
    }
    const detailsToggle = document.getElementById('courseDetailsToggle');
    if (detailsToggle) {
        detailsToggle.checked = showDetails;
        detailsToggle.addEventListener('change', function(e) {
            const enabled = e.target.checked;
            if (typeof window !== 'undefined') {
                window.showCourseDetails = enabled;
            }
            preferenceSetItem('showCourseDetails', enabled ? 'true' : 'false');
            document.dispatchEvent(new Event('courseDetailsToggleChanged'));
        });
    }

    const updateCourseDetailVisibility = () => {
        const show = window.showCourseDetails;
        if (detailsToggle) detailsToggle.checked = show !== false;
        document.querySelectorAll('.course_bs_credit').forEach(el => {
            el.style.display = show ? '' : 'none';
        });
    };
    document.addEventListener('courseDetailsToggleChanged', updateCourseDetailVisibility);
    updateCourseDetailVisibility();

    let hideTaken = true;
    try {
        const stored = preferenceGetItem('hideTakenCourses');
        if (stored !== null) {
            hideTaken = stored === 'true';
        }
    } catch (_) {}
    if (typeof window !== 'undefined') {
        window.hideTakenCourses = hideTaken;
    }
    const hideToggle = document.getElementById('hideTakenCoursesToggle');
    if (hideToggle) {
        hideToggle.checked = hideTaken;
        hideToggle.addEventListener('change', function(e) {
            const enabled = e.target.checked;
            if (typeof window !== 'undefined') {
                window.hideTakenCourses = enabled;
            }
            preferenceSetItem('hideTakenCourses', enabled ? 'true' : 'false');
            document.dispatchEvent(new Event('hideTakenCoursesToggleChanged'));
        });
    }
    document.addEventListener('hideTakenCoursesToggleChanged', () => {
        if (hideToggle && typeof window.hideTakenCourses === 'boolean') {
            hideToggle.checked = window.hideTakenCourses;
        }
    });

    // Course-offering filtering is a picker default evaluated against each
    // semester's own canonical term, not against one global "current term".
    let plannerOfferedOnly = true;
    try {
        const stored = preferenceGetItem('plannerFilterOfferedOnly');
        if (stored !== null) {
            plannerOfferedOnly = stored === 'true';
        }
    } catch (_) {}
    if (typeof window !== 'undefined') {
        window.plannerFilterOfferedOnly = plannerOfferedOnly;
    }
    const offeredToggle = document.getElementById('plannerOfferedOnlyToggle');
    if (offeredToggle) {
        offeredToggle.checked = plannerOfferedOnly;
        offeredToggle.addEventListener('change', function(e) {
            const enabled = e.target.checked;
            if (typeof window !== 'undefined') {
                window.plannerFilterOfferedOnly = enabled;
            }
            preferenceSetItem('plannerFilterOfferedOnly', enabled ? 'true' : 'false');
        });
    }

    let sortByScore = true;
    try {
        const stored = preferenceGetItem('sortBasedOnScore');
        if (stored !== null) {
            sortByScore = stored === 'true';
        }
    } catch (_) {}
    if (typeof window !== 'undefined') {
        window.sortBasedOnScore = sortByScore;
    }
    const sortToggle = document.getElementById('sortByScoreToggle');
    if (sortToggle) {
        sortToggle.checked = sortByScore;
        sortToggle.addEventListener('change', function(e) {
            const enabled = e.target.checked;
            if (typeof window !== 'undefined') {
                window.sortBasedOnScore = enabled;
            }
            preferenceSetItem('sortBasedOnScore', enabled ? 'true' : 'false');
            document.dispatchEvent(new Event('sortByScoreToggleChanged'));
        });
    }
    document.addEventListener('sortByScoreToggleChanged', () => {
        if (sortToggle && typeof window.sortBasedOnScore === 'boolean') {
            sortToggle.checked = window.sortBasedOnScore;
        }
    });

    //************************************************

    //Targetting dynamically created elements:
    document.addEventListener('click', function(e){
        dynamic_click(e, curriculum, course_data);
        // Summary/graduation overlays: clicking outside the cards/panels should close.
        try {
            if (e.target && typeof e.target.closest === 'function') {
                const summaryOverlay = e.target.closest('.summary_modal_overlay');
                if (summaryOverlay) {
                    // The content wrapper is the Summary surface. In compact
                    // view its cards row owns scrolling, so clicks on its blank
                    // space or scrollbar must not be mistaken for backdrop
                    // clicks. Only the actual dimmed backdrop dismisses it.
                    const insideSummarySurface = e.target.closest('.summary_overlay_content');
                    if (!insideSummarySurface) {
                        try {
                            document.querySelectorAll('.summary_modal_overlay').forEach(function(ov){
                                if (typeof ov._closeSummary === 'function') ov._closeSummary();
                                else ov.remove();
                            });
                        } catch {}
                    }
                    return;
                }
                const gradOverlay = e.target.closest('.graduation_modal_overlay');
                if (gradOverlay) {
                    const insideGrad = e.target.closest('.graduation_modal');
                    if (!insideGrad) {
                        try{document.querySelector('.graduation_modal').remove();} catch{}
                        try{document.querySelector('.graduation_modal_overlay').remove();} catch{}
                    }
                    return;
                }
            }
        } catch (_) {}
        const clickTarget = e.target && e.target.classList ? e.target : null;
        const summaryTrigger = clickTarget && typeof clickTarget.closest === 'function'
            ? clickTarget.closest('.summary') : null;
        const summaryModal = clickTarget && typeof clickTarget.closest === 'function'
            ? clickTarget.closest('.summary_modal') : null;
        if (!summaryModal && !summaryTrigger) {
            try {
                document.querySelectorAll('.summary_modal_overlay').forEach(function(ov){
                    if (typeof ov._closeSummary === 'function') ov._closeSummary();
                    else ov.remove();
                });
            } catch {}
        }
        const graduationTrigger = clickTarget && typeof clickTarget.closest === 'function'
            ? clickTarget.closest('.check') : null;
        const graduationModal = clickTarget && typeof clickTarget.closest === 'function'
            ? clickTarget.closest('.graduation_modal') : null;
        if (!graduationModal && !graduationTrigger) {
            try{document.querySelector('.graduation_modal').remove();} catch{}
            try{document.querySelector('.graduation_modal_overlay').remove();} catch{}
        }
    });
    document.addEventListener('mouseover', function(e){
        mouseover(e);
        if (e.target.classList.contains('btn'))
        {e.target.style.backgroundColor = '';}
        else if(e.target.parentNode.classList && e.target.parentNode.classList.contains('btn'))
        {e.target.parentNode.style.backgroundColor = '';}
        else
        {
            document.querySelectorAll('.btn').forEach( element => {element.style.backgroundColor = ''});
        }
    })
    document.addEventListener('mouseout', function(e){
        mouseout(e);
        if (e.target.classList.contains('btn'))
        {e.target.style.backgroundColor = '';}
    })

    try {
        if (typeof window !== 'undefined' && typeof window.updateCurrentTermHighlights === 'function') {
            window.updateCurrentTermHighlights();
        }
    } catch (_) {}

    let dragged_item = null;
    let dragged_course = null;
    let course_drop_preview = null;
    document.addEventListener('dragstart', function(e){
        if(e.target.classList.contains("container_semester")) {
            dragged_item = e.target;
            dragged_course = null;
            e.target.classList.add('semester-dragging');
            try {
                if (e.dataTransfer) {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', semesterTermLabel(e.target));
                }
            } catch (_) {}
        } else if ((e.target.classList.contains('course')
            || (e.target.closest && e.target.closest('.course_drag')))
            && typeof isDesktopPlannerDrag === 'function' && isDesktopPlannerDrag()) {
            dragged_course = e.target.classList.contains('course')
                ? e.target : e.target.closest('.course');
            dragged_item = null;
            dragged_course.classList.add('course-dragging');
            try {
                if (e.dataTransfer) {
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', courseCodeLabel(dragged_course));
                }
            } catch (_) {}
        }
    })
    document.addEventListener('dragend', function(e){
        try {
            if (dragged_course) {
                dragged_course.setAttribute('draggable', 'false');
            }
        } catch (_) {}
        dragged_item = null;
        dragged_course = null;
        course_drop_preview = null;
        try { clearPlannerDragPreview(); } catch (_) {}
    })
    document.addEventListener('dragover', function(e){
        if (dragged_course) {
            if (typeof isDesktopPlannerDrag !== 'function' || !isDesktopPlannerDrag()) return;
            const preview = plannerCourseInsertionPreview(e, dragged_course);
            if (!preview) {
                course_drop_preview = null;
                return;
            }
            course_drop_preview = preview;
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
            return;
        }
        if (!dragged_item) return;
        plannerSemesterInsertionPreview(e, dragged_item);
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    })

    document.addEventListener('drop', function(e){
        if (dragged_course) {
            e.preventDefault();
            try {
                commitPlannerCourseMove(curriculum, course_data, dragged_course, course_drop_preview);
            } finally {
                try { dragged_course.setAttribute('draggable', 'false'); } catch (_) {}
                dragged_course = null;
                course_drop_preview = null;
                clearPlannerDragPreview();
            }
            return;
        }
        drop(e, curriculum, dragged_item, course_data);
        dragged_item = null;
        clearPlannerDragPreview();
    })

    // Touch-based dragging support mirrors the desktop drag events so that
    // semesters can be reordered on touch devices.  We leverage touch
    // coordinates on touchend to determine the drop target and prevent the
    // page from scrolling while a semester is being dragged.
    document.addEventListener('touchstart', function(e){
        // Only begin dragging if the user taps the dedicated drag handle.
        const handle = e.target && e.target.closest
            ? e.target.closest('.semester_drag')
            : getAncestor(e.target, 'semester_drag');
        if(handle){
            dragged_item = handle.closest
                ? handle.closest('.container_semester')
                : getAncestor(handle, 'container_semester');
        }
    })
    document.addEventListener('touchmove', function(e){
        if(dragged_item){
            // Prevent viewport scrolling while dragging a semester
            e.preventDefault();
        }
    }, {passive:false})
    document.addEventListener('touchend', function(e){
        if(dragged_item){
            const touch = e.changedTouches && e.changedTouches[0];
            if (touch) {
                drop(e, curriculum, dragged_item, course_data, {x: touch.clientX, y: touch.clientY});
            }
            dragged_item = null;
        }
    })
    document.addEventListener('touchcancel', function(){
        dragged_item = null;
    })
    /*
    document.addEventListener("input", function(e){
        if(e.target.classList.contains())
    })*/

    //************************************************************** 

    //NON-DYNAMIC BUTTONS:
    const addSemester = document.querySelector(".addSemester");
    addSemester.addEventListener('click', function(){
        const board = document.querySelector('.board');
        const newContainer = createSemeter(true, [], curriculum, course_data);
        if (!newContainer) return;
        const ghost = document.querySelector('.add-semester-ghost');
        if (ghost && board) {
            board.insertBefore(newContainer, ghost);
            const style = getComputedStyle(newContainer);
            const width = newContainer.offsetWidth + parseInt(style.marginLeft) + parseInt(style.marginRight);
            board.scrollBy({ left: width, behavior: 'smooth' });
        }
    });

    function ensureGhostSemester() {
        const board = document.querySelector('.board');
        if (!board) return;
        let ghost = board.querySelector('.add-semester-ghost');
        if (!ghost) {
            ghost = document.createElement('div');
            ghost.classList.add('add-semester-ghost');
            ghost.textContent = '+ New Semester';
            ghost.addEventListener('click', function() {
                const newContainer = createSemeter(true, [], curriculum, course_data);
                if (!newContainer) return;
                const style = getComputedStyle(newContainer);
                const width = newContainer.offsetWidth + parseInt(style.marginLeft) + parseInt(style.marginRight);
                board.insertBefore(newContainer, ghost);
                board.scrollBy({ left: width, behavior: 'smooth' });
            });
            board.appendChild(ghost);
        }
    }

    // Sidebar collapse toggle
    const sidebar = document.querySelector('.sidebar');
    const sidebarToggle = document.querySelector('.sidebar-toggle');
    if (sidebar && sidebarToggle) {
        sidebarToggle.addEventListener('click', function() {
            sidebar.classList.toggle('collapsed');
        });
    }

    // Enable swipe gestures on touch devices to open/close the sidebar
    if (sidebar) {
        let touchStartX = null;
        let touchStartY = null;

        document.addEventListener('touchstart', function(e){
            if (e.touches.length !== 1) return;
            touchStartX = e.touches[0].clientX;
            touchStartY = e.touches[0].clientY;
        }, {passive: true});

        document.addEventListener('touchend', function(e){
            if (touchStartX === null || touchStartY === null) return;
            const touchEndX = e.changedTouches[0].clientX;
            const touchEndY = e.changedTouches[0].clientY;
            const diffX = touchEndX - touchStartX;
            const diffY = touchEndY - touchStartY;

            if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 50) {
                if (diffX > 0 && touchStartX < 30 && sidebar.classList.contains('collapsed')) {
                    sidebar.classList.remove('collapsed');
                } else if (diffX < 0 && touchStartX < sidebar.offsetWidth && !sidebar.classList.contains('collapsed')) {
                    sidebar.classList.add('collapsed');
                }
            }

            touchStartX = null;
            touchStartY = null;
        }, {passive: true});
    }

    const auto_add = document.querySelector('.autoAdd');
    auto_add.addEventListener('click', async function(){
        // Check if there are existing semesters
        const semesters = document.querySelectorAll('.semester');
        if (semesters.length > 0) {
            await uiAlert(
                'Cannot add first year courses',
                '<p><strong>Add First Year Courses</strong> only works when no semesters are present.</p><p>Create a new plan or delete existing semesters and try again.</p>'
            );
            return;
        }

        // Determine the user's entry term so that the automatically added
        // semesters start from that term rather than the earliest term in
        // the list (Fall 2019-2020).
        const entryTerm = planGetItem('entryTerm') || entryTerms[0];
        const entryCode = termNameToCode(entryTerm);

        // Helper to compute the next chronological term code
        function nextTermCode(code) {
            const term = code.slice(4);
            const year = parseInt(code.slice(0, 4), 10);
            if (term === '01') return String(year) + '02'; // Fall -> Spring
            // Summer -> Fall of next academic year
            return String(year + 1) + '01';
        }

        const nextCode = nextTermCode(entryCode);
        const nextTerm = termCodeToName(nextCode);

        // Automatically insert the typical first year courses into two semesters.
        let fs_courses = ["MATH101","NS101","SPS101","IF100","TLL101","HIST191","CIP101N"];
        let ss_courses = ["MATH102","NS102","SPS102","AL102","TLL102","HIST192","PROJ201"];

        // Insert the next term first so that the entry term ends up at the top
        // of the board. Pass explicit term names to createSemeter so that the
        // semesters use the correct dates.
        createSemeter(false, ss_courses, curriculum, course_data, [], nextTerm);
        createSemeter(false, fs_courses, curriculum, course_data, [], entryTerm);
    })

    // Older markup wrapped the text inside a <p> tag. Guard against that
    // structure to avoid errors when clicking the button in the new UI.
    const checkText = document.querySelector('.check>p');
    if (checkText) {
        checkText.addEventListener('click', function(){
            document.querySelector('.check').click();
        });
    }
    const check_graduation = document.querySelector('.check');
    check_graduation.addEventListener('click', function(){
        displayGraduationResults(curriculum);
    })

    const summary = document.querySelector('.summary');
    summary.addEventListener('click', function(){
        displaySummary(curriculum, major_chosen_by_user);
    })

    // ----------------------------------------------------------------------
    // Custom Course: create a modal form to let the user define a new
    // course. The new course is stored in localStorage under a key
    // specific to the current major (customCourses_<major>) and added to
    // course_data. Existing datalists are updated so the new course can
    // be selected immediately. Only one custom course modal can be open
    // at a time.
        function getCombinedCodeFromCourseObj(course) {
            try {
                if (!course || typeof course !== 'object') return '';
                return normalizeCombinedCourseCode(String((course.Major || '') + (course.Code || '')));
            } catch (_) {
                return '';
            }
        }

        function normalizeCombinedCourseCode(value) {
            return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
        }

        function getSemesterOccurrenceCode(course) {
            if (typeof course === 'string') return normalizeCombinedCourseCode(course);
            if (!course || typeof course !== 'object') return '';
            if (course.code != null) return normalizeCombinedCourseCode(course.code);
            return getCombinedCodeFromCourseObj(course);
        }

        function splitCombinedCourseCode(value) {
            const combined = normalizeCombinedCourseCode(value);
            const match = combined.match(/^([A-Z]{1,12})(\d[A-Z0-9]*)$/);
            return match ? { combined, major: match[1], code: match[2] } : null;
        }

        const CUSTOM_LANGUAGE_PREFIXES = new Set([
            'ARA', 'CHI', 'FRE', 'GER', 'ITA', 'JAP', 'LANG', 'LAT', 'PERS',
            'RUS', 'SPA', 'TUR',
        ]);

        function titleExplicitlySaysBasicLanguage(value) {
            return /\b(?:basic|beginning)\b/i.test(String(value || ''));
        }

        function isCustomLanguageCandidate(code, name, faculty, languageLevel) {
            const parsed = splitCombinedCourseCode(code);
            const prefix = parsed ? parsed.major : '';
            if (languageLevel === 'basic' || languageLevel === 'other') return true;
            if (CUSTOM_LANGUAGE_PREFIXES.has(prefix)) return true;
            // A School of Languages custom record with explicit wording is a
            // safe candidate too. Faculty alone is intentionally insufficient:
            // TLL, AL and professional ENG courses are also offered by SL but
            // are not part of the beginning-language cap.
            return String(faculty || '').toUpperCase() === 'SL'
                && titleExplicitlySaysBasicLanguage(name);
        }

        function findCustomCourseStorageIndex(list, combinedCode, preferredIndex) {
            const target = _customClassificationIdentity(combinedCode);
            if (Number.isInteger(preferredIndex) && preferredIndex >= 0 && preferredIndex < list.length
                && _customClassificationIdentity(getCombinedCodeFromCourseObj(list[preferredIndex])) === target) {
                return preferredIndex;
            }
            const matches = [];
            for (let i = 0; i < list.length; i++) {
                if (_customClassificationIdentity(getCombinedCodeFromCourseObj(list[i])) === target) matches.push(i);
            }
            return matches.length === 1 ? matches[0] : -1;
        }

        function customCourseIdentityConflict(list, combinedCode, excludedIndex) {
            const target = _customClassificationIdentity(combinedCode);
            const editingSameDormantOverlay = Number.isInteger(excludedIndex)
                && excludedIndex >= 0 && excludedIndex < list.length
                && _customClassificationIdentity(getCombinedCodeFromCourseObj(list[excludedIndex])) === target;
            if (primaryCatalogIdentitySet.has(target) && !editingSameDormantOverlay) return 'catalog';
            for (let i = 0; i < list.length; i++) {
                if (i === excludedIndex) continue;
                if (_customClassificationIdentity(getCombinedCodeFromCourseObj(list[i])) === target) return 'custom';
            }
            return '';
        }

        function updateCourseOccurrenceDom(semester, occurrence, previousCode, nextCode, definition) {
            const nodes = [];
            try {
                if (occurrence && typeof occurrence === 'object' && occurrence.id) {
                    const node = document.getElementById(occurrence.id);
                    if (node) nodes.push(node);
                }
                if (!nodes.length && semester && semester.id) {
                    const semesterNode = document.getElementById(semester.id);
                    if (semesterNode) {
                        semesterNode.querySelectorAll('.course').forEach(function(node) {
                            const label = node.querySelector('.course_code');
                            if (normalizeCombinedCourseCode(label && label.textContent) === previousCode) nodes.push(node);
                        });
                    }
                }
            } catch (_) {}
            nodes.forEach(function(node) {
                try {
                    const codeNode = node.querySelector('.course_code');
                    if (codeNode) codeNode.textContent = nextCode;
                    if (!definition) return;
                    const nameNode = node.querySelector('.course_name');
                    if (nameNode) nameNode.textContent = String(definition.Course_Name || nextCode);
                    const typeNode = node.querySelector('.course_type');
                    if (typeNode) typeNode.textContent = String(definition.EL_Type || 'none').toUpperCase();
                    const creditNode = node.querySelector('.course_credit');
                    if (creditNode) {
                        const credit = (typeof parseCreditValue === 'function')
                            ? parseCreditValue(definition.SU_credit || '0')
                            : (parseFloat(definition.SU_credit || '0') || 0);
                        const text = (typeof formatCreditValue === 'function')
                            ? formatCreditValue(credit) : Number(credit).toFixed(1);
                        creditNode.textContent = text + ' credits';
                    }
                    const bsNode = node.querySelector('.course_bs_credit');
                    if (bsNode) bsNode.textContent = 'BS: ' + (definition.Basic_Science || '0') + ' credits';
                } catch (_) {}
            });
        }

        function renameSemesterOccurrences(previousCode, nextCode, definition) {
            const oldCode = normalizeCombinedCourseCode(previousCode);
            const newCode = normalizeCombinedCourseCode(nextCode);
            const changed = [];
            if (!curriculum || !Array.isArray(curriculum.semesters)) return changed;
            curriculum.semesters.forEach(function(semester) {
                if (!semester || !Array.isArray(semester.courses)) return;
                for (let i = 0; i < semester.courses.length; i++) {
                    const occurrence = semester.courses[i];
                    if (getSemesterOccurrenceCode(occurrence) !== oldCode) continue;
                    changed.push({ semester, index: i, occurrence, wasString: typeof occurrence === 'string' });
                    if (typeof occurrence === 'string') semester.courses[i] = newCode;
                    else occurrence.code = newCode;
                    updateCourseOccurrenceDom(semester, occurrence, oldCode, newCode, definition);
                }
            });
            return changed;
        }

        function refreshSemesterOccurrenceDom(combinedCode, definition) {
            const target = normalizeCombinedCourseCode(combinedCode);
            if (!curriculum || !Array.isArray(curriculum.semesters)) return;
            curriculum.semesters.forEach(function(semester) {
                if (!semester || !Array.isArray(semester.courses)) return;
                semester.courses.forEach(function(occurrence) {
                    if (getSemesterOccurrenceCode(occurrence) === target) {
                        updateCourseOccurrenceDom(semester, occurrence, target, target, definition);
                    }
                });
            });
        }

        function removeSemesterOccurrencesByCode(combinedCode) {
            const target = normalizeCombinedCourseCode(combinedCode);
            let removed = 0;
            if (!curriculum || !Array.isArray(curriculum.semesters)) return removed;
            curriculum.semesters.forEach(function(semester) {
                if (!semester || !Array.isArray(semester.courses)) return;
                const matches = semester.courses.slice().filter(function(occurrence) {
                    return getSemesterOccurrenceCode(occurrence) === target;
                });
                matches.forEach(function(occurrence) {
                    const node = occurrence && typeof occurrence === 'object' && occurrence.id
                        ? document.getElementById(occurrence.id) : null;
                    const deleteButton = node ? node.querySelector('.delete_course') : null;
                    if (deleteButton) {
                        try { deleteButton.click(); } catch (_) {}
                    }
                    if (semester.courses.includes(occurrence)) {
                        try {
                            if (occurrence && typeof occurrence === 'object' && occurrence.id
                                && typeof semester.deleteCourse === 'function') {
                                semester.deleteCourse(occurrence.id);
                            } else {
                                semester.courses.splice(semester.courses.indexOf(occurrence), 1);
                            }
                        } catch (_) {}
                        try { if (node) node.remove(); } catch (_) {}
                    }
                    removed++;
                });
            });
            return removed;
        }

        function removeCourseDataRecord(record, combinedCode) {
            let index = record ? course_data.indexOf(record) : -1;
            if (index < 0) {
                const target = normalizeCombinedCourseCode(combinedCode);
                for (let i = course_data.length - 1; i >= 0; i--) {
                    if (getCombinedCodeFromCourseObj(course_data[i]) === target) {
                        index = i;
                        break;
                    }
                }
            }
            if (index >= 0) course_data.splice(index, 1);
        }

        function removeDoubleMajorCustomRecordAt(index) {
            if (!Number.isInteger(index) || index < 0 || index >= doubleMajorCustomCourseRecords.length) return null;
            const record = doubleMajorCustomCourseRecords[index];
            const runtimeIndex = doubleMajorCourseData.indexOf(record);
            if (runtimeIndex >= 0) doubleMajorCourseData.splice(runtimeIndex, 1);
            doubleMajorCustomCourseRecords.splice(index, 1);
            return record;
        }

        function removeDoubleMajorCustomRecordsAt(indexes) {
            Array.from(new Set(indexes || [])).sort(function(a, b) { return b - a; })
                .forEach(removeDoubleMajorCustomRecordAt);
        }

        function replaceDoubleMajorCustomRecordAt(index, record) {
            const previous = doubleMajorCustomCourseRecords[index];
            const runtimeIndex = previous ? doubleMajorCourseData.indexOf(previous) : -1;
            if (index >= 0 && index < doubleMajorCustomCourseRecords.length) {
                doubleMajorCustomCourseRecords[index] = record;
            } else {
                doubleMajorCustomCourseRecords.push(record);
            }
            if (runtimeIndex >= 0) doubleMajorCourseData[runtimeIndex] = record;
            else doubleMajorCourseData.push(record);
        }

        function getActiveContextProgramCodes() {
            const primary = String((curriculum && curriculum.major) || major_chosen_by_user || '').toUpperCase();
            const candidates = [];
            try { candidates.push(curriculum && curriculum.doubleMajor); } catch (_) {}
            try {
                if (curriculum && Array.isArray(curriculum.minors)) {
                    curriculum.minors.forEach(function(code) { candidates.push(code); });
                }
            } catch (_) {}
            const seen = new Set(primary ? [primary] : []);
            const programs = [];
            candidates.forEach(function(rawCode) {
                const code = String(rawCode || '').trim().toUpperCase();
                if (!code || seen.has(code)) return;
                seen.add(code);
                programs.push(code);
            });
            return programs;
        }

        function getContextCatalogCodeSet(programCode) {
            const program = String(programCode || '').toUpperCase();
            if (program && program === String((curriculum && curriculum.doubleMajor) || '').toUpperCase()) {
                return doubleMajorCatalogCodeSet;
            }
            return minorCatalogCodeSetsByCode[program] || new Set();
        }

        function getContextCourseData(programCode) {
            const program = String(programCode || '').toUpperCase();
            if (program && program === String((curriculum && curriculum.doubleMajor) || '').toUpperCase()) {
                return doubleMajorCourseData;
            }
            return minorCourseDataByCode[program] || [];
        }

        function findOfficialContextCourse(programCode, combinedCode) {
            const target = _customClassificationIdentity(combinedCode);
            const catalogIdentities = _customClassificationIdentitySet(getContextCatalogCodeSet(programCode));
            if (!target || !catalogIdentities.has(target)) return null;
            const data = getContextCourseData(programCode);
            for (let i = 0; i < data.length; i++) {
                if (_customClassificationIdentity(getCombinedCodeFromCourseObj(data[i])) === target
                    && !data[i].__globalCourseDefinition) return data[i];
            }
            return null;
        }

        function replaceContextRuntimeCustomCourses(programCode, storedList) {
            const program = String(programCode || '').toUpperCase();
            const catalogCodes = getContextCatalogCodeSet(program);
            const normalized = normalizeCustomCourseListForStorage(program, Array.isArray(storedList) ? storedList : []);
            // A stale imported overlay may collide with an official row. Keep it
            // durable until the user edits that course, but never activate it.
            const runtimeList = _activeCustomCourseRecords(normalized, catalogCodes);

            if (program && program === String((curriculum && curriculum.doubleMajor) || '').toUpperCase()) {
                const previous = new Set(doubleMajorCustomCourseRecords);
                for (let i = doubleMajorCourseData.length - 1; i >= 0; i--) {
                    if (previous.has(doubleMajorCourseData[i])) doubleMajorCourseData.splice(i, 1);
                }
                doubleMajorCustomCourseRecords = runtimeList;
                runtimeList.forEach(function(record) { doubleMajorCourseData.push(record); });
                curriculum.doubleMajorCourseData = doubleMajorCourseData;
                return;
            }

            const data = minorCourseDataByCode[program];
            if (!Array.isArray(data)) return;
            const previous = new Set(minorCustomCourseRecordsByCode[program] || []);
            for (let i = data.length - 1; i >= 0; i--) {
                if (previous.has(data[i])) data.splice(i, 1);
            }
            minorCustomCourseRecordsByCode[program] = runtimeList;
            runtimeList.forEach(function(record) { data.push(record); });
            if (curriculum && curriculum.minorCourseDataByCode) {
                curriculum.minorCourseDataByCode[program] = data;
            }
        }

        function replacePrimaryRuntimeCustomCourses(storedList) {
            const normalized = normalizeCustomCourseListForStorage(
                String((curriculum && curriculum.major) || major_chosen_by_user || '').toUpperCase(),
                Array.isArray(storedList) ? storedList : []
            );
            const runtimeList = _activeCustomCourseRecords(normalized, primaryCatalogCodeSet);
            const previous = new Set(primaryCustomCourseRecords);
            for (let i = course_data.length - 1; i >= 0; i--) {
                if (previous.has(course_data[i])) course_data.splice(i, 1);
            }
            primaryCustomCourseRecords = runtimeList;
            runtimeList.forEach(function(record) { course_data.push(record); });
        }

        function restoreStoredValue(key, rawValue) {
            return rawValue === null ? planRemoveItem(key) : planSetItem(key, rawValue);
        }

        function loadCustomCoursesForMajor(majorCode) {
            try {
                const key = 'customCourses_' + String(majorCode || '').toUpperCase();
                const parsed = JSON.parse(planGetItem(key) || '[]');
                return Array.isArray(parsed)
                    ? normalizeCustomCourseListForStorage(majorCode, parsed)
                    : [];
            } catch (_) {
                return [];
            }
        }

        function refreshCourseDatalistsAndTypes() {
            try {
                document.querySelectorAll('datalist.course_list').forEach(function(dl) {
                    populateCourseDataList(dl, course_data);
                });
            } catch (_) {}
            try {
                if (typeof curriculum.recalcEffectiveTypes === 'function') {
                    curriculum.recalcEffectiveTypes(course_data);
                }
            } catch (_) {}
            try {
                if (curriculum.doubleMajor && typeof curriculum.recalcEffectiveTypesDouble === 'function') {
                    curriculum.recalcEffectiveTypesDouble(doubleMajorCourseData);
                }
            } catch (_) {}
            try {
                if (curriculum.doubleMajor && typeof updateDatalistForDoubleMajor === 'function') {
                    updateDatalistForDoubleMajor();
                }
            } catch (_) {}
        }

        async function removeCustomCourseByCodeFromCurrentMajor(combinedCode, preferredIndex) {
            const target = normalizeCombinedCourseCode(combinedCode);
            const targetIdentity = _customClassificationIdentity(target);
            if (!target) return false;
            const majorKey = String(major_chosen_by_user || '').toUpperCase();
            const existing = loadCustomCoursesForMajor(majorKey);
            if (!existing.length) return false;
            const storageIndex = findCustomCourseStorageIndex(existing, target, preferredIndex);
            if (storageIndex < 0) {
                await uiAlert('Could not identify custom course', `<p><strong>${escapeHtml(target)}</strong> has duplicate saved definitions. Rename or remove the duplicates individually before continuing.</p>`);
                return false;
            }
            const key = 'customCourses_' + majorKey;
            const previousRaw = planGetItem(key);
            const next = existing.slice();
            next.splice(storageIndex, 1);
            const targetIdentityRemains = next.some(function(course) {
                return _customClassificationIdentity(getCombinedCodeFromCourseObj(course)) === targetIdentity;
            });
            const contextPlans = [];
            getActiveContextProgramCodes().forEach(function(programCode) {
                const contextKey = 'customCourses_' + programCode;
                const contextExisting = loadCustomCoursesForMajor(programCode);
                const contextNext = targetIdentityRemains
                    ? contextExisting.slice()
                    : contextExisting.filter(function(course) {
                        return _customClassificationIdentity(getCombinedCodeFromCourseObj(course)) !== targetIdentity;
                    });
                if (contextNext.length !== contextExisting.length) {
                    contextPlans.push({
                        programCode,
                        key: contextKey,
                        previousRaw: planGetItem(contextKey),
                        previousList: contextExisting,
                        nextList: contextNext,
                    });
                }
            });
            const storagePlans = [{ key, previousRaw, previousList: existing, nextList: next }]
                .concat(contextPlans);
            const completedWrites = [];
            let writeFailed = false;
            for (let i = 0; i < storagePlans.length; i++) {
                const plan = storagePlans[i];
                try {
                    if (planSetItem(plan.key, JSON.stringify(plan.nextList)) === false) {
                        writeFailed = true;
                        break;
                    }
                    completedWrites.push(plan);
                } catch (_) {
                    writeFailed = true;
                    break;
                }
            }
            if (writeFailed) {
                for (let i = completedWrites.length - 1; i >= 0; i--) {
                    restoreStoredValue(completedWrites[i].key, completedWrites[i].previousRaw);
                }
                await uiAlert('Could not delete custom course', `<p><strong>${escapeHtml(target)}</strong> was not changed because browser storage rejected a program update.</p>`);
                return false;
            }

            if (!primaryCatalogIdentitySet.has(targetIdentity)
                && !targetIdentityRemains) {
                removeSemesterOccurrencesByCode(target);
            }
            replacePrimaryRuntimeCustomCourses(next);
            contextPlans.forEach(function(plan) {
                replaceContextRuntimeCustomCourses(plan.programCode, plan.nextList);
            });
            refreshCourseDatalistsAndTypes();
            const saveRequested = requestPlanSave();
            if (!saveRequested || !flushPlanSaves()) {
                for (let i = completedWrites.length - 1; i >= 0; i--) {
                    restoreStoredValue(completedWrites[i].key, completedWrites[i].previousRaw);
                }
                await uiAlert('Could not delete custom course', `<p>The planner snapshot could not be saved. <strong>${escapeHtml(target)}</strong> will be restored now.</p>`);
                location.reload();
                return false;
            }
            return true;
        }

        function showManageCustomCoursesModal() {
            if (document.querySelector('.custom_course_manage_overlay')) return;
            const majorKey = String(major_chosen_by_user || '').toUpperCase();
            const readList = () => loadCustomCoursesForMajor(majorKey);
            if (!readList().length) {
                uiAlert('No custom courses', '<p>There are no custom courses to manage for this program.</p>');
                return;
            }

            const boardDom = document.body;
            const overlay = document.createElement('div');
            overlay.className = 'custom_course_manage_overlay';

            const modal = document.createElement('div');
            modal.className = 'custom_course_manage_modal';
            let manageDialog = null;

            const title = document.createElement('h3');
            title.innerText = 'Manage Custom Courses';
            modal.appendChild(title);

            const subtitle = document.createElement('p');
            subtitle.className = 'custom_course_manage_subtitle';
            subtitle.innerText = `${majorKey} custom courses`;
            modal.appendChild(subtitle);

            const listEl = document.createElement('div');
            listEl.className = 'custom_course_manage_list';
            modal.appendChild(listEl);

            const footer = document.createElement('div');
            footer.className = 'custom_course_manage_footer';
            const closeBtn = document.createElement('button');
            closeBtn.className = 'btn btn-secondary btn-sm';
            closeBtn.innerText = 'Close';
            closeBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                if (manageDialog) manageDialog.close();
            });
            footer.appendChild(closeBtn);
            modal.appendChild(footer);

            const renderList = () => {
                const courses = readList();
                if (!courses.length) {
                    if (manageDialog) manageDialog.close();
                    uiAlert('No custom courses', '<p>There are no custom courses left to manage.</p>');
                    return;
                }
                listEl.innerHTML = '';

                courses.forEach(function(course, courseIndex) {
                    const combined = getCombinedCodeFromCourseObj(course);
                    const item = document.createElement('div');
                    item.className = 'custom_course_manage_item';

                    const info = document.createElement('div');
                    info.className = 'custom_course_manage_info';

                    const line1 = document.createElement('div');
                    line1.className = 'custom_course_manage_line1';
                    line1.innerHTML = `<strong>${escapeHtml(combined)}</strong> — ${escapeHtml(course.Course_Name || combined)}`;
                    info.appendChild(line1);

                    const line2 = document.createElement('div');
                    line2.className = 'custom_course_manage_line2';
                    line2.textContent =
                        `SU ${course.SU_credit || '0'} • ECTS ${course.ECTS || '0'} • ` +
                        `BS ${course.Basic_Science || 0} • ENG ${course.Engineering || 0} • ` +
                        `Type ${String(course.EL_Type || 'none')}` +
                        (course.Language_Level
                            ? ` • Language ${course.Language_Level === 'basic' ? 'beginning/basic' : 'higher/other'}`
                            : '');
                    info.appendChild(line2);

                    const actions = document.createElement('div');
                    actions.className = 'custom_course_manage_actions';

                    const editBtn = document.createElement('button');
                    editBtn.className = 'btn btn-secondary btn-sm';
                    editBtn.innerHTML = '<i class="fa-solid fa-pen"></i>&nbsp;Edit';
                    editBtn.setAttribute('aria-label', `Edit ${combined}`);
                    editBtn.addEventListener('click', function(e) {
                        e.stopPropagation();
                        showCustomCourseForm(null, course, function() {
                            renderList();
                        }, null, courseIndex);
                    });
                    actions.appendChild(editBtn);

                    const deleteBtn = document.createElement('button');
                    deleteBtn.className = 'btn btn-danger btn-sm';
                    deleteBtn.innerHTML = '<i class="fa-solid fa-trash"></i>&nbsp;Delete';
                    deleteBtn.setAttribute('aria-label', `Delete ${combined}`);
                    deleteBtn.addEventListener('click', async function(e) {
                        e.stopPropagation();
                        const ok = await uiConfirm(
                            'Delete custom course?',
                            `<p>Delete <strong>${escapeHtml(combined)}</strong> from custom courses?</p><p>This cannot be undone.</p>`,
                            { confirmText: 'Delete', danger: true }
                        );
                        if (!ok) return;
                        if (await removeCustomCourseByCodeFromCurrentMajor(combined, courseIndex)) {
                            renderList();
                        }
                    });
                    actions.appendChild(deleteBtn);

                    item.appendChild(info);
                    item.appendChild(actions);
                    listEl.appendChild(item);
                });
            };

            renderList();

            modal.addEventListener('click', function(e) { e.stopPropagation(); });
            overlay.addEventListener('click', function(e) { e.stopPropagation(); });
            overlay.appendChild(modal);
            boardDom.appendChild(overlay);
            manageDialog = activateAccessibleDialog(overlay, modal, title, {
                initialFocus: closeBtn,
            });
        }

        let programCategoryHelpSequence = 0;
        const programCategoryHelpDescriptions = {
            required: ['Required', 'Starts in the required pool. A custom choice does not create a named or equivalent requirement, approve a substitution, or grant university approval.'],
            core: ['Core', 'Starts in the program\'s core-elective pool.'],
            area: ['Area', 'Starts in an area, concentration, or specialization pool.'],
            university: ['University', 'Stays in the university-course pool, but does not replace a specifically named university requirement.'],
            free: ['Free', 'Stays in the free-elective pool.'],
            none: ['None', 'Uses no category pool or program GPA (PGPA), although main-plan SU/ECTS may still count toward the overall degree total.'],
            unknown: ['N/A', 'Contributes nothing through this program. CGPA and treatment by other selected programs remain separate.'],
        };

        function createProgramCategoryHelp(programCode, availableTypes) {
            const code = String(programCode || 'program').trim().toUpperCase() || 'PROGRAM';
            const types = Array.isArray(availableTypes) ? availableTypes : [];
            const isMinor = !types.includes('university') && !types.includes('none');
            const panelId = `program-category-help-${++programCategoryHelpSequence}`;
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'program-category-help';
            button.textContent = '?';
            button.setAttribute('aria-label', `Explain ${code} course categories`);
            button.setAttribute('aria-controls', panelId);
            button.setAttribute('aria-expanded', 'false');

            const panel = document.createElement('div');
            panel.id = panelId;
            panel.className = 'program-category-help-text is-hidden';
            panel.setAttribute('role', 'note');

            const intro = document.createElement('p');
            intro.textContent = isMinor
                ? `For ${code}, this is the course's starting minor category. Each selected program is classified separately; the minor's requirements and equivalence rules decide where it actually counts. Check Summary for the result.`
                : `For ${code}, this is the course's starting program category. Each selected program is classified separately. As requirements fill, eligible credit may move down Required → Core → Area → Free; program-specific rules can also reassign or exclude it. Check Summary for where it actually counts.`;
            panel.appendChild(intro);

            const list = document.createElement('ul');
            types.forEach(function(type) {
                let definition = programCategoryHelpDescriptions[type];
                if (!definition) return;
                if (isMinor && type === 'required') {
                    definition = ['Required', 'Starts in the minor required pool. It does not replace a named or equivalent required course or grant approval for a substitution.'];
                } else if (isMinor && type === 'unknown') {
                    definition = ['N/A', 'Enters neither the minor total nor the minor program GPA. CGPA and treatment by other selected programs remain separate.'];
                }
                const item = document.createElement('li');
                item.dataset.category = type;
                const name = document.createElement('strong');
                name.textContent = definition[0] + ': ';
                item.appendChild(name);
                item.appendChild(document.createTextNode(definition[1]));
                list.appendChild(item);
            });
            panel.appendChild(list);

            const footer = document.createElement('p');
            footer.textContent = isMinor
                ? 'Main- and other-program treatment and CGPA remain separate. A disabled selector means the official catalog category for this minor and admit term applies. Custom classifications are planning assumptions, not university approval.'
                : 'Category never changes grade or CGPA treatment. A disabled selector means the official catalog category for this program and admit term applies; any saved custom choice is dormant. Custom classifications are planning assumptions, not university approval.';
            panel.appendChild(footer);

            button.addEventListener('click', function(event) {
                event.preventDefault();
                event.stopPropagation();
                const willShow = panel.classList.contains('is-hidden');
                if (willShow) {
                    const container = panel.closest('.custom_course_modal, .double_major_modal');
                    if (container) {
                        container.querySelectorAll('.program-category-help-text:not(.is-hidden)')
                            .forEach(function(otherPanel) {
                                if (otherPanel === panel) return;
                                otherPanel.classList.add('is-hidden');
                                const otherButton = container.querySelector(
                                    `.program-category-help[aria-controls="${otherPanel.id}"]`
                                );
                                if (otherButton) otherButton.setAttribute('aria-expanded', 'false');
                            });
                    }
                }
                panel.classList.toggle('is-hidden', !willShow);
                button.setAttribute('aria-expanded', willShow ? 'true' : 'false');
            });
            return { button, panel };
        }

        function showCustomCourseForm(prefill = null, courseObj = null, onSaveCallback = null, onCancelCallback = null, courseStorageIndex = null, linkedProgramCourses = null) {
            // Prevent multiple modals
            if (document.querySelector('.custom_course_modal')) return;

        const primaryProgramCode = String(major_chosen_by_user || '').trim().toUpperCase();

        // Append overlay to body so it covers the full viewport
        const boardDom = document.body;

        // Create overlay container
        const overlay = document.createElement('div');
        overlay.classList.add('custom_course_overlay');

        // Create modal container
        const modal = document.createElement('div');
        modal.classList.add('custom_course_modal');
        let customCourseDialog = null;
        let customCourseFieldSequence = 0;

        // Title
        const title = document.createElement('h3');
        const isTranscriptReview = typeof onCancelCallback === 'function';
        title.innerText = isTranscriptReview
            ? 'Review Imported Course'
            : (courseObj ? 'Edit Custom Course' : 'Add Custom Course');
        modal.appendChild(title);

        if (isTranscriptReview) {
            const importNote = document.createElement('p');
            importNote.className = 'cc-import-note';
            importNote.textContent = 'Save to keep this transcript course. Skip & Remove will undo its imported course, semester occurrence, and saved custom-course definition.';
            modal.appendChild(importNote);
        }

        // Helper to create input row
        function createInputRow(labelText, inputType = 'text', placeholder = '', defaultValue = '') {
            const row = document.createElement('div');
            row.classList.add('cc-row');

            const label = document.createElement('label');
            label.innerText = labelText;
            row.appendChild(label);

            const input = document.createElement('input');
            input.id = `custom-course-field-${++customCourseFieldSequence}`;
            label.htmlFor = input.id;
            input.type = inputType;
            input.placeholder = placeholder;
            input.value = defaultValue;
            row.appendChild(input);

            return { row, input };
        }

            // Course Code input (e.g., CS101)
            const { row: codeRow, input: codeInput } = createInputRow('Course Code:', 'text', 'e.g. CS300');
            codeInput.maxLength = 21;
            modal.appendChild(codeRow);

            // Course Name input
            const { row: nameRow, input: nameInput } = createInputRow('Course Name:', 'text', 'Course name');
            nameInput.maxLength = 200;
            modal.appendChild(nameRow);

            // SU Credits input
            const { row: suRow, input: suInput } = createInputRow('SU Credits:', 'number', 'e.g. 3');
            modal.appendChild(suRow);

            // ECTS input
            const { row: ectsRow, input: ectsInput } = createInputRow('ECTS:', 'number', 'e.g. 6');
            modal.appendChild(ectsRow);

            // Basic Science credits input
            const { row: bsRow, input: bsInput } = createInputRow('Basic Science credits:', 'number', 'e.g. 0');
            bsInput.value = '0';
            modal.appendChild(bsRow);

            // Engineering credits input
            const { row: engRow, input: engInput } = createInputRow('Engineering credits:', 'number', 'e.g. 0');
            engInput.value = '0';
            modal.appendChild(engRow);

            [suInput, ectsInput, bsInput, engInput].forEach(function(input) {
                input.min = '0';
                input.max = '100';
                input.step = 'any';
            });

            // EL Type dropdown
            const typeRow = document.createElement('div');
            typeRow.classList.add('cc-row');
            const typeLabel = document.createElement('label');
            typeLabel.innerText = `${primaryProgramCode} Category:`;
            typeLabel.htmlFor = 'cc-primary-program-category';
            const primaryCategoryOptions = ['core', 'area', 'university', 'free', 'required', 'none', 'unknown'];
            const primaryCategoryHelp = createProgramCategoryHelp(
                primaryProgramCode,
                primaryCategoryOptions
            );
            const typeLabelLine = document.createElement('div');
            typeLabelLine.className = 'program-category-label-line';
            typeLabelLine.appendChild(typeLabel);
            typeLabelLine.appendChild(primaryCategoryHelp.button);
            typeRow.appendChild(typeLabelLine);
            const typeSelect = document.createElement('select');
            typeSelect.id = 'cc-primary-program-category';
            typeSelect.className = 'cc-program-category cc-primary-program-category';
            primaryCategoryOptions.forEach(function(opt) {
                const option = document.createElement('option');
                option.value = opt;
                option.innerText = opt === 'unknown'
                    ? 'N/A (not allocated)'
                    : opt.charAt(0).toUpperCase() + opt.slice(1);
                typeSelect.appendChild(option);
            });
            typeRow.appendChild(typeSelect);
            typeRow.appendChild(primaryCategoryHelp.panel);

            // A stored custom definition can become dormant when the selected
            // admit term gains an official row with the same code. Show the
            // catalog category in that case, but retain the dormant custom
            // category underneath so switching back to another term restores
            // the user's program-scoped classification.
            const primaryOfficialNote = document.createElement('small');
            primaryOfficialNote.id = 'cc-primary-program-category-official-note';
            primaryOfficialNote.className = 'cc-program-category-note cc-language-note is-hidden';
            primaryOfficialNote.textContent = 'The official catalog category applies to this course.';
            typeRow.appendChild(primaryOfficialNote);
            const primaryDefaultType = typeSelect.value;
            let primaryEditableType = typeSelect.value;
            let primaryCategoryTouched = false;
            let primaryLastSyncedCode = null;
            const findPrimaryCustomType = function(combinedCode) {
                const target = _customClassificationIdentity(combinedCode);
                if (!target) return '';
                const stored = loadCustomCoursesForMajor(primaryProgramCode);
                const matches = stored.filter(function(record) {
                    return _customClassificationIdentity(getCombinedCodeFromCourseObj(record)) === target;
                });
                const match = matches.length === 1 ? matches[0] : null;
                return match ? String(match.EL_Type || '').toLowerCase() : '';
            };
            const findOfficialPrimaryCourse = function(combinedCode) {
                const target = _customClassificationIdentity(combinedCode);
                if (!target || !primaryCatalogIdentitySet.has(target)) return null;
                return primaryProgramCatalogData.find(function(record) {
                    return _customClassificationIdentity(getCombinedCodeFromCourseObj(record)) === target;
                }) || null;
            };
            const normalizePrimaryType = function(value) {
                const type = String(value || '').toLowerCase();
                return Array.from(typeSelect.options).some(function(option) {
                    return option.value === type;
                }) ? type : 'unknown';
            };
            const syncPrimaryOfficialCategory = function() {
                const currentCode = normalizeCombinedCourseCode(codeInput.value);
                if (!primaryCategoryTouched && currentCode !== primaryLastSyncedCode) {
                    const storedType = findPrimaryCustomType(currentCode);
                    if (storedType) primaryEditableType = normalizePrimaryType(storedType);
                    else if (!courseObj) primaryEditableType = primaryDefaultType;
                }
                primaryLastSyncedCode = currentCode;
                const official = findOfficialPrimaryCourse(currentCode);
                if (official) {
                    typeSelect.value = normalizePrimaryType(official.EL_Type);
                    typeSelect.disabled = true;
                    typeSelect.setAttribute('aria-describedby', primaryOfficialNote.id);
                    primaryOfficialNote.classList.remove('is-hidden');
                } else {
                    typeSelect.disabled = false;
                    typeSelect.removeAttribute('aria-describedby');
                    typeSelect.value = primaryEditableType;
                    primaryOfficialNote.classList.add('is-hidden');
                }
            };
            typeSelect.addEventListener('change', function() {
                if (!typeSelect.disabled) {
                    primaryEditableType = typeSelect.value;
                    primaryCategoryTouched = true;
                }
            });
            modal.appendChild(typeRow);

            // Faculty (optional). Several graduation rules count courses by the
            // faculty that OFFERS them, so a custom course needs to be able to
            // say — or to say nothing, which is the honest answer for a transfer
            // or exchange course that belongs to no Sabanci faculty. It used to
            // be hardcoded to FENS, which silently made every custom course
            // count toward FENS-specific rules.
            const facultyRow = document.createElement('div');
            facultyRow.classList.add('cc-row');
            const facultyLabel = document.createElement('label');
            facultyLabel.innerText = 'Faculty (optional):';
            const facultyHelpBtn = document.createElement('button');
            facultyHelpBtn.type = 'button';
            facultyHelpBtn.className = 'cc-help';
            facultyHelpBtn.textContent = '?';
            facultyHelpBtn.setAttribute('aria-label', 'What is Faculty, and when should I set it?');
            facultyHelpBtn.setAttribute('aria-expanded', 'false');
            const facultyLabelLine = document.createElement('div');
            facultyLabelLine.className = 'program-category-label-line';
            facultyLabelLine.appendChild(facultyLabel);
            facultyLabelLine.appendChild(facultyHelpBtn);
            facultyRow.appendChild(facultyLabelLine);

            const facultySelect = document.createElement('select');
            facultySelect.id = 'cc-faculty';
            facultyLabel.htmlFor = facultySelect.id;
            facultySelect.className = 'cc-faculty';
            [
                ['', 'None / not applicable'],
                ['FENS', 'FENS — Engineering and Natural Sciences'],
                ['FASS', 'FASS — Arts and Social Sciences'],
                ['SBS', 'SBS — School of Management (SOM)'],
                ['SL', 'SL — School of Languages'],
            ].forEach(function(pair) {
                const option = document.createElement('option');
                option.value = pair[0];
                option.innerText = pair[1];
                facultySelect.appendChild(option);
            });
            facultyRow.appendChild(facultySelect);

            const facultyHelp = document.createElement('p');
            facultyHelp.id = 'cc-faculty-help';
            facultyHelp.className = 'cc-help-text is-hidden';
            facultyHelp.innerText = [
                'The faculty that offers the course. Some graduation rules count courses by faculty '
                + '— for example DSA needs at least 3 core electives from each of FENS, FASS and SBS, '
                + 'and MAN needs 9 free-elective credits from FASS or FENS courses.',
                'Leave it as "None" for transfer or exchange courses that do not belong to a Sabancı '
                + 'faculty. They still count toward your credits, ECTS and category totals — they just '
                + 'will not count toward these faculty-specific rules.',
            ].join('\n\n');
            facultyRow.appendChild(facultyHelp);
            facultyHelpBtn.setAttribute('aria-controls', facultyHelp.id);

            facultyHelpBtn.addEventListener('click', function(e) {
                e.preventDefault();
                e.stopPropagation();
                const willShow = facultyHelp.classList.contains('is-hidden');
                facultyHelp.classList.toggle('is-hidden', !willShow);
                facultyHelpBtn.setAttribute('aria-expanded', willShow ? 'true' : 'false');
            });

            modal.appendChild(facultyRow);

            // Language courses need one piece of metadata that cannot be
            // inferred from an exchange transcript code: whether this is a
            // beginning/basic course subject to the two-course cap, or a
            // higher/other language course. Keep an unreviewed state distinct
            // from an explicit "other" classification.
            const languageLevelRow = document.createElement('div');
            languageLevelRow.classList.add('cc-row', 'cc-language-level-row');
            const languageLevelLabel = document.createElement('label');
            languageLevelLabel.innerText = 'Language level:';
            languageLevelLabel.htmlFor = 'cc-language-level';
            languageLevelRow.appendChild(languageLevelLabel);

            const languageLevelSelect = document.createElement('select');
            languageLevelSelect.id = 'cc-language-level';
            languageLevelSelect.className = 'cc-language-level';
            [
                ['', 'Choose after reviewing the course'],
                ['basic', 'Beginning / basic'],
                ['other', 'Higher level / other'],
            ].forEach(function(pair) {
                const option = document.createElement('option');
                option.value = pair[0];
                option.innerText = pair[1];
                languageLevelSelect.appendChild(option);
            });
            languageLevelRow.appendChild(languageLevelSelect);

            const languageLevelHelp = document.createElement('p');
            languageLevelHelp.id = 'cc-language-level-help';
            languageLevelHelp.className = 'cc-language-note';
            languageLevelHelp.textContent = 'Only beginning/basic language courses use the two-course free-elective limit. Higher-level language courses do not use that limit.';
            languageLevelSelect.setAttribute('aria-describedby', languageLevelHelp.id);
            languageLevelRow.appendChild(languageLevelHelp);
            modal.appendChild(languageLevelRow);

            const initialLanguageLevel = (() => {
                const raw = courseObj && courseObj.Language_Level !== undefined
                    ? courseObj.Language_Level
                    : (prefill && prefill.languageLevel !== undefined ? prefill.languageLevel : '');
                const normalized = String(raw || '').trim().toLowerCase();
                return normalized === 'basic' || normalized === 'other' ? normalized : '';
            })();
            let languageLevelTouched = !!initialLanguageLevel;
            languageLevelSelect.value = initialLanguageLevel;

            const updateLanguageLevelRow = function() {
                const candidate = isCustomLanguageCandidate(
                    codeInput.value,
                    nameInput.value,
                    facultySelect.value,
                    languageLevelSelect.value || initialLanguageLevel
                );
                languageLevelRow.hidden = !candidate;
                languageLevelRow.classList.toggle('is-hidden', !candidate);
                if (!candidate) {
                    languageLevelSelect.value = '';
                    languageLevelSelect.required = false;
                    return;
                }
                languageLevelSelect.required = true;
                if (!languageLevelTouched) {
                    languageLevelSelect.value = titleExplicitlySaysBasicLanguage(nameInput.value)
                        ? 'basic' : '';
                }
            };
            languageLevelSelect.addEventListener('change', function() {
                languageLevelTouched = true;
            });
            codeInput.addEventListener('input', updateLanguageLevelRow);
            nameInput.addEventListener('input', updateLanguageLevelRow);
            facultySelect.addEventListener('change', updateLanguageLevelRow);

            // Every selected program gets its own category. Definitions remain
            // scoped by program code, so changing a main/double-major/minor
            // selection cannot reuse an unrelated program's classification.
            const contextCategoryControls = new Map();
            const transcriptLinksByProgram = new Map();
            if (isTranscriptReview && Array.isArray(linkedProgramCourses)) {
                linkedProgramCourses.forEach(function(link) {
                    const program = String((link && link.program) || '').trim().toUpperCase();
                    if (program && !transcriptLinksByProgram.has(program)) {
                        transcriptLinksByProgram.set(program, link);
                    }
                });
            }
            const initialCombinedCode = (() => {
                try {
                    if (courseObj && courseObj.Major && courseObj.Code) return String(courseObj.Major + courseObj.Code).toUpperCase();
                    if (prefill && prefill.code) return String(prefill.code).toUpperCase().replace(/\s+/g, '');
                } catch (_) {}
                return '';
            })();
            const findContextCustomType = (programCode, combinedCode) => {
                try {
                    if (!programCode || !combinedCode) return '';
                    const existing = loadCustomCoursesForMajor(programCode);
                    const target = _customClassificationIdentity(combinedCode);
                    const matches = [];
                    for (let i = 0; i < existing.length; i++) {
                        const rec = existing[i];
                        if (!rec) continue;
                        const code = _customClassificationIdentity(getCombinedCodeFromCourseObj(rec));
                        if (code === target) matches.push(rec);
                    }
                    if (matches.length === 1) return String(matches[0].EL_Type || '').toLowerCase();
                } catch (_) {}
                return '';
            };
            getActiveContextProgramCodes().forEach(function(programCode, index) {
                const contextTypeRow = document.createElement('div');
                contextTypeRow.classList.add('cc-row', 'cc-program-category-row');
                contextTypeRow.dataset.program = programCode;
                const isDoubleMajorContext = programCode === String((curriculum && curriculum.doubleMajor) || '').toUpperCase();
                const contextOptions = isDoubleMajorContext
                    ? ['core', 'area', 'university', 'free', 'required', 'none', 'unknown']
                    : ['required', 'core', 'area', 'free', 'unknown'];
                const contextTypeLabel = document.createElement('label');
                const selectId = `cc-program-category-${index}`;
                contextTypeLabel.innerText = `${programCode} Category:`;
                contextTypeLabel.htmlFor = selectId;
                const contextCategoryHelp = createProgramCategoryHelp(programCode, contextOptions);
                const contextLabelLine = document.createElement('div');
                contextLabelLine.className = 'program-category-label-line';
                contextLabelLine.appendChild(contextTypeLabel);
                contextLabelLine.appendChild(contextCategoryHelp.button);
                contextTypeRow.appendChild(contextLabelLine);

                const contextTypeSelect = document.createElement('select');
                contextTypeSelect.id = selectId;
                contextTypeSelect.className = 'cc-program-category';
                contextOptions.forEach(function(opt) {
                    const option = document.createElement('option');
                    option.value = opt;
                    option.innerText = opt === 'unknown'
                        ? 'N/A (not allocated)'
                        : opt.charAt(0).toUpperCase() + opt.slice(1);
                    contextTypeSelect.appendChild(option);
                });
                const normalizeContextType = function(value) {
                    const type = String(value || '').toLowerCase();
                    return contextOptions.includes(type) ? type : 'unknown';
                };
                let editableValue = normalizeContextType(
                    findContextCustomType(programCode, initialCombinedCode)
                );
                let categoryTouched = false;
                let lastSyncedCode = null;
                contextTypeSelect.value = editableValue;
                contextTypeSelect.addEventListener('change', function() {
                    if (!contextTypeSelect.disabled) {
                        editableValue = contextTypeSelect.value;
                        categoryTouched = true;
                    }
                });
                contextTypeRow.appendChild(contextTypeSelect);
                contextTypeRow.appendChild(contextCategoryHelp.panel);

                const officialNote = document.createElement('small');
                officialNote.id = `${selectId}-official-note`;
                officialNote.className = 'cc-program-category-note cc-language-note is-hidden';
                officialNote.textContent = 'The official catalog category applies to this course.';
                contextTypeRow.appendChild(officialNote);

                const syncOfficialCategory = function() {
                    const currentCode = normalizeCombinedCourseCode(codeInput.value);
                    if (!categoryTouched && currentCode !== lastSyncedCode) {
                        const storedType = findContextCustomType(programCode, currentCode);
                        if (storedType) {
                            // A pre-existing target definition owns its category.
                            editableValue = normalizeContextType(storedType);
                        } else if (!courseObj) {
                            // A fresh Add form has no source definition whose
                            // category should follow the newly typed code.
                            editableValue = 'unknown';
                        }
                        // On edit/rename, an absent target inherits the source
                        // program's current category. This is still untouched
                        // UI state; an explicit selection below always wins.
                    }
                    lastSyncedCode = currentCode;
                    const official = findOfficialContextCourse(programCode, currentCode);
                    if (official) {
                        const officialType = String(official.EL_Type || '').toLowerCase();
                        contextTypeSelect.value = Array.from(contextTypeSelect.options).some(function(option) {
                            return option.value === officialType;
                        }) ? officialType : 'unknown';
                        contextTypeSelect.disabled = true;
                        contextTypeSelect.setAttribute('aria-describedby', officialNote.id);
                        officialNote.classList.remove('is-hidden');
                    } else {
                        contextTypeSelect.disabled = false;
                        contextTypeSelect.removeAttribute('aria-describedby');
                        contextTypeSelect.value = editableValue;
                        officialNote.classList.add('is-hidden');
                    }
                };
                contextCategoryControls.set(programCode, {
                    select: contextTypeSelect,
                    syncOfficialCategory,
                    getEditableValue: function() { return editableValue; },
                });
                modal.appendChild(contextTypeRow);
                syncOfficialCategory();
            });
            codeInput.addEventListener('input', function() {
                syncPrimaryOfficialCategory();
                contextCategoryControls.forEach(function(control) {
                    control.syncOfficialCategory();
                });
            });

            // If prefill data or an existing course object is provided,
            // populate the inputs and select accordingly.
            if (prefill || courseObj) {
                // Code may be provided as combined string or separate parts; if we
                // have courseObj (the actual course object), we can use its
                // Major and Code fields to reconstruct the code. Otherwise use
                // prefill.code.
                if (courseObj && courseObj.Major != null && courseObj.Code != null) {
                    codeInput.value = courseObj.Major + courseObj.Code;
                } else if (prefill.code) {
                    codeInput.value = prefill.code;
                }
                if (courseObj && courseObj.Course_Name) {
                    nameInput.value = courseObj.Course_Name;
                } else if (prefill.name) {
                    nameInput.value = prefill.name;
                }
                if (courseObj && courseObj.SU_credit !== undefined && courseObj.SU_credit !== null) {
                    suInput.value = courseObj.SU_credit;
                } else if (prefill.suCredits !== undefined) {
                    suInput.value = prefill.suCredits;
                }
                if (courseObj && courseObj.ECTS !== undefined && courseObj.ECTS !== null) {
                    ectsInput.value = courseObj.ECTS;
                } else if (prefill.ects !== undefined) {
                    ectsInput.value = prefill.ects;
                }
                if (courseObj && courseObj.Basic_Science !== undefined) {
                    bsInput.value = courseObj.Basic_Science;
                } else if (prefill.basicScience !== undefined) {
                    bsInput.value = prefill.basicScience;
                }
                if (courseObj && courseObj.Engineering !== undefined) {
                    engInput.value = courseObj.Engineering;
                } else if (prefill.engineering !== undefined) {
                    engInput.value = prefill.engineering;
                }
                // Set EL type dropdown
                if (courseObj && courseObj.EL_Type) {
                    typeSelect.value = courseObj.EL_Type;
                } else if (prefill.elType) {
                    typeSelect.value = prefill.elType;
                }
                primaryEditableType = normalizePrimaryType(typeSelect.value);
                // Set faculty dropdown ('' is a real, meaningful choice here,
                // so check for presence rather than truthiness.)
                if (courseObj && courseObj.Faculty !== undefined && courseObj.Faculty !== null) {
                    facultySelect.value = String(courseObj.Faculty);
                } else if (prefill.faculty !== undefined) {
                    facultySelect.value = String(prefill.faculty);
                }
            }

            contextCategoryControls.forEach(function(control) {
                control.syncOfficialCategory();
            });
            syncPrimaryOfficialCategory();

            updateLanguageLevelRow();

        // Buttons container
        const buttonsRow = document.createElement('div');
        buttonsRow.classList.add('cc-buttons');

        const cancelBtn = document.createElement('button');
        cancelBtn.innerText = isTranscriptReview ? 'Skip & Remove' : 'Cancel';
        cancelBtn.classList.add('btn', 'btn-secondary', 'btn-sm');
            cancelBtn.addEventListener('click', function(e) {
                e.stopPropagation();
                if (typeof onCancelCallback === 'function' && onCancelCallback() === false) {
                    return;
                }
                if (customCourseDialog) customCourseDialog.close();
                // Normal edit cancellation preserves its historical callback
                // behavior; transcript cancellation reaches here only after a
                // successful rollback.
                if (typeof onSaveCallback === 'function') {
                    onSaveCallback();
                }
            });
        buttonsRow.appendChild(cancelBtn);

        const saveBtn = document.createElement('button');
        saveBtn.innerText = isTranscriptReview ? 'Save & Keep' : 'Save';
        saveBtn.classList.add('btn', 'btn-primary', 'btn-sm');
            saveBtn.addEventListener('click', async function(e) {
                e.stopPropagation();
                // Read input values
                const rawCode = normalizeCombinedCourseCode(codeInput.value);
                if (!rawCode) {
                    await uiAlert('Missing course code', '<p>Course code is required.</p>');
                    return;
                }
                const parsedIdentity = splitCombinedCourseCode(rawCode);
                if (!parsedIdentity) {
                    await uiAlert('Invalid course code', '<p>Invalid course code format. Use e.g. <strong>CS300</strong>, <strong>MATH101</strong>, or <strong>ACC201R</strong>.</p>');
                    return;
                }
                const parsedMajor = parsedIdentity.major;
                const parsedCode = parsedIdentity.code;
                const originalCombinedCode = courseObj ? getCombinedCodeFromCourseObj(courseObj) : '';
                const combinedCodeNow = parsedIdentity.combined;
                const editingDormantPrimaryOverlay = !!originalCombinedCode
                    && primaryCatalogIdentitySet.has(
                        _customClassificationIdentity(originalCombinedCode)
                    );
                if (editingDormantPrimaryOverlay && originalCombinedCode !== combinedCodeNow) {
                    await uiAlert(
                        'Official catalog course code',
                        '<p>This saved classification is dormant because the current catalog already contains that course code. Its code cannot be renamed here.</p>'
                    );
                    return;
                }
                const languageLevel = languageLevelRow.hidden
                    ? '' : String(languageLevelSelect.value || '').toLowerCase();
                if (!languageLevelRow.hidden && languageLevel !== 'basic' && languageLevel !== 'other') {
                    await uiAlert(
                        'Choose the language level',
                        '<p>Select whether this is a <strong>Beginning / basic</strong> or <strong>Higher level / other</strong> language course. This determines whether the beginning-language limit applies.</p>'
                    );
                    languageLevelSelect.focus();
                    return;
                }
                let candidate;
                try {
                    const candidateInput = {
                        Major: parsedMajor,
                        Code: parsedCode,
                        Course_Name: nameInput.value.trim() || rawCode,
                        ECTS: ectsInput.value.toString() || '0',
                        Engineering: engInput.value.toString() || '0',
                        Basic_Science: bsInput.value.toString() || '0',
                        SU_credit: suInput.value.toString() || '0',
                        Faculty: facultySelect.value,
                        EL_Type: typeSelect.disabled ? primaryEditableType : typeSelect.value,
                        Faculty_Course: 'No'
                    };
                    if (languageLevel) candidateInput.Language_Level = languageLevel;
                    candidate = normalizeCustomCourseForStorage(candidateInput);
                } catch (validationError) {
                    await uiAlert(
                        'Invalid custom course',
                        `<p>${escapeHtml(validationError && validationError.message ? validationError.message : 'Please check the course fields.')}</p>`
                    );
                    return;
                }

                const majorKey = String(major_chosen_by_user || '').toUpperCase();
                const key = 'customCourses_' + majorKey;
                const previousRaw = planGetItem(key);
                const existing = loadCustomCoursesForMajor(majorKey);
                let storageIndex = -1;
                if (courseObj) {
                    storageIndex = findCustomCourseStorageIndex(existing, originalCombinedCode, courseStorageIndex);
                    if (storageIndex < 0) {
                        await uiAlert('Could not identify custom course', `<p><strong>${escapeHtml(originalCombinedCode)}</strong> has duplicate or missing saved definitions. No changes were made.</p>`);
                        return;
                    }
                }
                const conflict = customCourseIdentityConflict(existing, combinedCodeNow, storageIndex);
                if (conflict) {
                    const description = conflict === 'catalog'
                        ? 'already exists in the selected program catalog'
                        : 'is already used by another custom course';
                    await uiAlert('Course code already exists', `<p><strong>${escapeHtml(combinedCodeNow)}</strong> ${description}. Choose a different code.</p>`);
                    return;
                }

                const next = existing.slice();
                if (courseObj) next[storageIndex] = candidate;
                else next.push(candidate);

                // Prepare every active secondary-program definition before the
                // first write. Each program keeps a full course record with its
                // own EL_Type while course identity, credits, faculty and
                // language metadata stay synchronized with the primary record.
                const contextPlans = [];
                let contextPreparationError = '';
                try {
                    getActiveContextProgramCodes().forEach(function(programCode) {
                        if (contextPreparationError) return;
                        const contextKey = 'customCourses_' + programCode;
                        const contextPreviousRaw = planGetItem(contextKey);
                        const contextExisting = loadCustomCoursesForMajor(programCode);
                        const originalMatches = [];
                        const targetMatches = [];
                        const originalIdentity = _customClassificationIdentity(originalCombinedCode);
                        const targetIdentity = _customClassificationIdentity(combinedCodeNow);
                        contextExisting.forEach(function(record, index) {
                            const recordIdentity = _customClassificationIdentity(getCombinedCodeFromCourseObj(record));
                            if (originalIdentity && recordIdentity === originalIdentity) originalMatches.push(index);
                            if (recordIdentity === targetIdentity) targetMatches.push(index);
                        });
                        if (originalMatches.length > 1 || targetMatches.length > 1) {
                            contextPreparationError = `${programCode} has duplicate saved definitions for this course.`;
                            return;
                        }
                        const originalIndex = originalMatches.length ? originalMatches[0] : -1;
                        const targetIndex = targetMatches.length ? targetMatches[0] : -1;
                        const officialCourse = findOfficialContextCourse(programCode, combinedCodeNow);
                        // Renaming into an official code retires only the old
                        // contextual overlay. The target catalog row is
                        // authoritative, and no new dormant overlay is created.
                        if (officialCourse && originalCombinedCode
                            && originalCombinedCode !== combinedCodeNow) {
                            if (originalIndex >= 0) {
                                const contextNext = contextExisting.slice();
                                contextNext.splice(originalIndex, 1);
                                contextPlans.push({
                                    programCode,
                                    key: contextKey,
                                    previousRaw: contextPreviousRaw,
                                    previousList: contextExisting,
                                    nextList: contextNext,
                                });
                            }
                            return;
                        }

                        // When a rename targets a definition that this program
                        // already knows, merge into that target and retire the
                        // old-code overlay. The target's stored category remains
                        // the untouched default exposed by the control above.
                        const existingIndex = targetIndex >= 0 ? targetIndex : originalIndex;
                        // If the course is official in this admit term and has no
                        // overlay, the catalog is sufficient. A same-code dormant
                        // overlay is retained so switching terms can restore that
                        // program-scoped classification.
                        if (officialCourse && existingIndex < 0) return;

                        const control = contextCategoryControls.get(programCode);
                        const existingType = existingIndex >= 0
                            ? String(contextExisting[existingIndex].EL_Type || '').toLowerCase() : '';
                        const selectedType = control && typeof control.getEditableValue === 'function'
                            ? String(control.getEditableValue() || '').toLowerCase() : '';
                        const finalType = selectedType || existingType || 'unknown';
                        const contextInput = Object.assign({}, candidate, { EL_Type: finalType });
                        const transcriptLink = transcriptLinksByProgram.get(programCode);
                        if (existingIndex >= 0 && transcriptLink
                            && transcriptLink.previousCourse
                            && typeof transcriptLink.previousCourse === 'object') {
                            const existingContext = contextExisting[existingIndex];
                            // Save & Keep refreshes the transcript fields shared
                            // through `candidate`, but retains each program's
                            // non-transcript classification metadata. Language
                            // level intentionally remains candidate-owned so one
                            // reviewed choice is shared across every program.
                            contextInput.Engineering = existingContext.Engineering;
                            contextInput.Basic_Science = existingContext.Basic_Science;
                            contextInput.Faculty = existingContext.Faculty;
                            contextInput.Faculty_Course = 'No';
                        }
                        const contextCandidate = normalizeCustomCourseForStorage(contextInput);
                        const contextNext = contextExisting.slice();
                        let nextIndex = existingIndex;
                        if (originalCombinedCode && originalCombinedCode !== combinedCodeNow
                            && originalIndex >= 0 && originalIndex !== existingIndex) {
                            contextNext.splice(originalIndex, 1);
                            if (nextIndex > originalIndex) nextIndex -= 1;
                        }
                        if (nextIndex >= 0) contextNext[nextIndex] = contextCandidate;
                        else contextNext.push(contextCandidate);
                        contextPlans.push({
                            programCode,
                            key: contextKey,
                            previousRaw: contextPreviousRaw,
                            previousList: contextExisting,
                            nextList: contextNext,
                        });
                    });
                } catch (contextError) {
                    contextPreparationError = contextError && contextError.message
                        ? contextError.message : 'A selected program category is invalid.';
                }
                if (contextPreparationError) {
                    await uiAlert(
                        'Could not prepare program categories',
                        `<p>${escapeHtml(contextPreparationError)} No changes were made.</p>`
                    );
                    return;
                }

                const storagePlans = [{
                    programCode: majorKey,
                    key,
                    previousRaw,
                    previousList: existing,
                    nextList: next,
                    primary: true,
                }].concat(contextPlans);
                const completedWrites = [];
                const rollbackStoragePlans = function() {
                    let restored = true;
                    for (let i = completedWrites.length - 1; i >= 0; i--) {
                        if (restoreStoredValue(completedWrites[i].key, completedWrites[i].previousRaw) === false) {
                            restored = false;
                        }
                    }
                    return restored;
                };
                let storageWriteFailed = false;
                for (let i = 0; i < storagePlans.length; i++) {
                    const plan = storagePlans[i];
                    try {
                        if (planSetItem(plan.key, JSON.stringify(plan.nextList)) === false) {
                            storageWriteFailed = true;
                            break;
                        }
                        completedWrites.push(plan);
                    } catch (_) {
                        storageWriteFailed = true;
                        break;
                    }
                }
                if (storageWriteFailed) {
                    const restored = rollbackStoragePlans();
                    await uiAlert(
                        'Could not save custom course',
                        `<p><strong>${escapeHtml(combinedCodeNow)}</strong> was not changed because browser storage rejected a program category.${restored ? '' : ' Some saved data could not be restored; reload before continuing.'}</p>`
                    );
                    return;
                }

                let previousRecord = null;
                let previousCourseDataIndex = -1;
                if (editingDormantPrimaryOverlay) {
                    previousRecord = courseObj;
                } else if (courseObj) {
                    previousRecord = primaryCustomCourseRecords.find(function(record) {
                        return getCombinedCodeFromCourseObj(record) === originalCombinedCode;
                    }) || courseObj;
                    previousCourseDataIndex = course_data.indexOf(previousRecord);
                    if (previousCourseDataIndex < 0) previousCourseDataIndex = course_data.indexOf(courseObj);
                    const primaryRuntimeIndex = primaryCustomCourseRecords.indexOf(previousRecord);
                    if (primaryRuntimeIndex >= 0) primaryCustomCourseRecords.splice(primaryRuntimeIndex, 1, candidate);
                    else primaryCustomCourseRecords.push(candidate);
                    if (previousCourseDataIndex >= 0) course_data[previousCourseDataIndex] = candidate;
                    else course_data.push(candidate);
                } else {
                    primaryCustomCourseRecords.push(candidate);
                    course_data.push(candidate);
                }

                const codeChanged = !!courseObj && originalCombinedCode !== combinedCodeNow;
                if (!editingDormantPrimaryOverlay) {
                    if (codeChanged) renameSemesterOccurrences(originalCombinedCode, combinedCodeNow, candidate);
                    else refreshSemesterOccurrenceDom(combinedCodeNow, candidate);
                }

                contextPlans.forEach(function(plan) {
                    replaceContextRuntimeCustomCourses(plan.programCode, plan.nextList);
                });
                // Update any open dropdowns so the new or updated course appears as an option
                refreshCourseDatalistsAndTypes();
                const saveRequested = requestPlanSave();
                if (codeChanged && (!saveRequested || !flushPlanSaves())) {
                    const restored = rollbackStoragePlans();
                    contextPlans.forEach(function(plan) {
                        replaceContextRuntimeCustomCourses(plan.programCode, plan.previousList);
                    });
                    const candidateRuntimeIndex = primaryCustomCourseRecords.indexOf(candidate);
                    if (candidateRuntimeIndex >= 0 && previousRecord) {
                        primaryCustomCourseRecords.splice(candidateRuntimeIndex, 1, previousRecord);
                    }
                    if (previousCourseDataIndex >= 0 && previousRecord) course_data[previousCourseDataIndex] = previousRecord;
                    renameSemesterOccurrences(combinedCodeNow, originalCombinedCode, previousRecord || courseObj);
                    refreshCourseDatalistsAndTypes();
                    await uiAlert('Could not rename custom course', `<p>The planner snapshot could not be saved. <strong>${escapeHtml(originalCombinedCode)}</strong> was ${restored ? 'restored' : 'not fully restored; reload before continuing'}.</p>`);
                    return;
                }
                // Remove modal
                if (customCourseDialog) customCourseDialog.close();
                // Invoke callback to process next pending custom course
                if (typeof onSaveCallback === 'function') {
                    onSaveCallback();
                }
            });
        buttonsRow.appendChild(saveBtn);

        modal.appendChild(buttonsRow);

        // Prevent overlay clicks from triggering underlying events
        modal.addEventListener('click', function(e) {
            e.stopPropagation();
        });

        // Append modal to overlay and overlay to board
        overlay.appendChild(modal);
        // Do not allow closing the form by clicking outside the modal
        overlay.addEventListener('click', function(e) {
            e.stopPropagation();
        });
        boardDom.appendChild(overlay);
        customCourseDialog = activateAccessibleDialog(overlay, modal, title, {
            initialFocus: codeInput,
            onEscape: function() { cancelBtn.click(); },
        });
    }

    // Bind custom course button click
    const customCourseBtn = document.querySelector('.customCourse');
    if (customCourseBtn) {
        customCourseBtn.addEventListener('click', function() {
            showCustomCourseForm();
        });
    }
    const manageCustomCoursesBtn = document.querySelector('.manageCustomCourses');
    if (manageCustomCoursesBtn) {
        manageCustomCoursesBtn.addEventListener('click', function() {
            showManageCustomCoursesModal();
        });
    }

    // Bind delete custom courses button click
    const deleteCustomBtn = document.querySelector('.deleteCustom');
    if (deleteCustomBtn) {
        deleteCustomBtn.addEventListener('click', function() {
            // async modal inside handler; no need to await here
            handleDeleteCustomCourses();
        });
    }
    // Bind reset local data button click
    const resetLocalBtn = document.querySelector('.resetLocal');
    if (resetLocalBtn) {
        resetLocalBtn.addEventListener('click', async function() {
            const ok = await uiConfirm(
                'Reset local data?',
                '<p>Are you sure you want to reset <strong>all SUrriculum data</strong> stored in this browser?</p>' +
                '<p>This will remove saved semesters, custom courses, grades, and your saved plans.</p>',
                { confirmText: 'Reset', danger: true }
            );
            if (ok) {
                let resetComplete = false;
                try {
                    clearInterval(saveInterval);
                    const storage = (typeof window !== 'undefined') ? window.planStorage : null;
                    if (!storage || typeof storage.clearAllAppData !== 'function') {
                        throw new Error('SUrriculum storage management is unavailable.');
                    }
                    storage.clearAllAppData();
                    resetComplete = true;
                } catch (ex) {
                    console.error('Failed to reset SUrriculum data:', ex);
                    await uiAlert(
                        'Reset failed',
                        `<p>${escapeHtml(ex && ex.message ? ex.message : 'Could not reset SUrriculum data.')}</p>`
                    );
                }
                if (resetComplete) location.reload();
            }
        });
    }

    // The old 'Add Double Major' button functionality has been replaced
    // by a persistent dropdown created near the major display.  Any
    // unused event handlers referencing '.addDoubleMajor' are removed.

    //************************************************************** 

    // Restore catalog-independent definitions synchronously before reloading.
    // The optional cumulative-index enrichment starts only after the semester
    // cards have been rebuilt below.
    const restoredGlobalDefinitions = restoreGlobalDefinitionsForSavedCourses();

    //Reload items from local storage:
    reload(curriculum, course_data);
    // Enrichment is deliberately detached from startup. Saved metadata (or a
    // marker fallback for legacy plans) has already made every course renderable.
    void enrichRestoredGlobalDefinitions(restoredGlobalDefinitions);
    // After reloading existing semesters, recalculate effective categories
    // so that the allocation respects chronological order. Guard against
    // missing recalc function.
    try {
        if (typeof curriculum.recalcEffectiveTypes === 'function') {
            curriculum.recalcEffectiveTypes(course_data);
        }
    } catch(err) {
        // ignore
    }
    // Ensure the ghost semester container is appended after reloading existing semesters
    ensureGhostSemester();
    // Capture every parallel array before the first write, then save the whole
    // planner snapshot through one hook. This keeps debounce, lifecycle, plan
    // switching, and the 2-second fallback on the same persistence path.
    const savePlanSnapshot = function() {
        let snapshot;
        try {
            snapshot = {
                curriculum: serializator(curriculum),
                grades: grades_serializator(curriculum),
                gradingBases: grading_bases_serializator(curriculum),
                dates: dates_serializator(curriculum),
                termCodes: term_codes_serializator(curriculum),
            };
        } catch (err) {
            try { console.error('Failed to serialize planner state:', err); } catch (_) {}
            return false;
        }
        try {
            const storage = (typeof window !== 'undefined') ? window.planStorage : null;
            if (storage && typeof storage.setSnapshot === 'function') {
                return storage.setSnapshot(snapshot, _planIdForSession || undefined) !== false;
            }
        } catch (err) {
            try { console.error('Failed to save planner snapshot:', err); } catch (_) {}
            return false;
        }
        return [
            planSetItem('curriculum', snapshot.curriculum),
            planSetItem('grades', snapshot.grades),
            planSetItem('gradingBases', snapshot.gradingBases),
            planSetItem('dates', snapshot.dates),
            planSetItem('termCodes', snapshot.termCodes),
        ].every(Boolean);
    };

    try {
        if (typeof window !== 'undefined' && window.planStorage && typeof window.planStorage.registerSaveHook === 'function') {
            window.planStorage.registerSaveHook(savePlanSnapshot, { planId: _planIdForSession });
        }
    } catch (_) {}

    // Retain the existing polling save as a conservative fallback for any
    // mutation path that has not yet requested a debounced save explicitly.
    saveInterval = setInterval(function() {
        const storage = (typeof window !== 'undefined') ? window.planStorage : null;
        if (storage && typeof storage.flushSaves === 'function') storage.flushSaves();
        else savePlanSnapshot();
    }, 2000);

    //createSemeter(false, ["MATH101","MATH102","MATH201","MATH203","IF100","TLL101"], curriculum, course_data)
    //createSemeter(false, ["NS101","SPS101","SPS102","AL102","TLL102","HIST192","PROJ201", "NS102", "HIST191", "CIP101N", "CS210", "MATH306", "CS201", "CS204", "MATH204"], curriculum, course_data)

    // No debug alerts in production; remove for clean UI

        function rollbackPendingTranscriptCustomCourse(entry) {
            const pendingCourse = entry && entry.course;
            const targetCode = getCombinedCodeFromCourseObj(pendingCourse);
            if (!pendingCourse || !targetCode) return true;

            const majorKey = String((curriculum && curriculum.major) || major_chosen_by_user || '').toUpperCase();
            const linkedPrograms = Array.isArray(entry && entry.programCourses)
                && entry.programCourses.length
                ? entry.programCourses
                : [{ program: majorKey, course: pendingCourse }];
            const storageBackups = [];
            const seenPrograms = new Set();
            const restoreStorageBackups = function() {
                let restored = true;
                for (let i = storageBackups.length - 1; i >= 0; i--) {
                    if (restoreStoredValue(storageBackups[i].key, storageBackups[i].previousRaw) === false) {
                        restored = false;
                    }
                }
                return restored;
            };
            const rollbackStorageFailed = function() {
                restoreStorageBackups();
                uiAlert(
                    'Could not remove imported course',
                    `<p><strong>${escapeHtml(targetCode)}</strong> is still saved because browser storage rejected the rollback. The review form has been left open.</p>`
                );
                return false;
            };
            for (let linkIndex = 0; linkIndex < linkedPrograms.length; linkIndex++) {
                const link = linkedPrograms[linkIndex] || {};
                const program = String(link.program || majorKey).toUpperCase();
                if (!program || seenPrograms.has(program)) continue;
                seenPrograms.add(program);
                const linkedCode = getCombinedCodeFromCourseObj(link.course) || targetCode;
                const key = 'customCourses_' + program;
                const previousRaw = planGetItem(key);
                let stored;
                try {
                    stored = JSON.parse(previousRaw || '[]');
                    if (!Array.isArray(stored)) return rollbackStorageFailed();
                } catch (_) {
                    return rollbackStorageFailed();
                }
                let storedIndex = -1;
                for (let i = stored.length - 1; i >= 0; i--) {
                    if (getCombinedCodeFromCourseObj(stored[i]) === linkedCode) {
                        storedIndex = i;
                        break;
                    }
                }
                // The importer durably wrote every linked definition before it
                // opened this review. A missing one means storage changed under
                // us, so fail closed instead of dismissing the review with a
                // partially rolled-back plan.
                if (storedIndex < 0) return rollbackStorageFailed();
                const nextStored = stored.slice();
                if (link.previousCourse && typeof link.previousCourse === 'object') {
                    // Restore only this record, not the import-time whole-list
                    // snapshot. Other LANG courses may have been queued after
                    // this one and must remain available for their own review.
                    nextStored[storedIndex] = link.previousCourse;
                } else {
                    nextStored.splice(storedIndex, 1);
                }
                storageBackups.push({ key, previousRaw });
                if (planSetItem(key, JSON.stringify(nextStored)) === false) {
                    return rollbackStorageFailed();
                }
            }

            const affectedSemesters = [];
            try {
                const semesters = curriculum && Array.isArray(curriculum.semesters)
                    ? curriculum.semesters.slice() : [];
                semesters.forEach(function(semester) {
                    if (!semester || !Array.isArray(semester.courses)) return;
                    const matches = semester.courses.filter(function(course) {
                        return String((course && course.code) || '').toUpperCase().replace(/\s+/g, '') === targetCode;
                    });
                    if (!matches.length) return;
                    affectedSemesters.push(semester);
                    matches.forEach(function(course) {
                        const node = course && course.id ? document.getElementById(course.id) : null;
                        const deleteButton = node ? node.querySelector('.delete_course') : null;
                        if (deleteButton) {
                            try { deleteButton.click(); } catch (_) {}
                        }
                        if (semester.courses.includes(course)) {
                            try {
                                if (typeof semester.deleteCourse === 'function') semester.deleteCourse(course.id);
                                else semester.courses.splice(semester.courses.indexOf(course), 1);
                            } catch (_) {}
                            try { if (node) node.remove(); } catch (_) {}
                        }
                    });
                });
            } catch (_) {}

            affectedSemesters.forEach(function(semester) {
                if (!semester || !Array.isArray(semester.courses) || semester.courses.length) return;
                const semesterNode = semester.id ? document.getElementById(semester.id) : null;
                const container = semesterNode && semesterNode.closest
                    ? semesterNode.closest('.container_semester') : null;
                const deleteButton = container ? container.querySelector('.delete_semester') : null;
                if (deleteButton) {
                    try { deleteButton.click(); } catch (_) {}
                }
                if (curriculum && Array.isArray(curriculum.semesters) && curriculum.semesters.includes(semester)) {
                    try {
                        if (typeof curriculum.deleteSemester === 'function') curriculum.deleteSemester(semester.id);
                        else curriculum.semesters.splice(curriculum.semesters.indexOf(semester), 1);
                    } catch (_) {}
                    try { if (container) container.remove(); } catch (_) {}
                }
            });

            try {
                const dataMutation = entry && entry.courseDataMutation;
                if (dataMutation && dataMutation.kind === 'replaced'
                    && dataMutation.previousCourse && typeof dataMutation.previousCourse === 'object') {
                    let idx = course_data.indexOf(pendingCourse);
                    if (idx < 0 && Number.isInteger(dataMutation.index)
                        && dataMutation.index >= 0 && dataMutation.index < course_data.length
                        && getCombinedCodeFromCourseObj(course_data[dataMutation.index]) === targetCode) {
                        idx = dataMutation.index;
                    }
                    if (idx >= 0) course_data[idx] = dataMutation.previousCourse;
                } else if (!dataMutation || dataMutation.kind === 'inserted') {
                    // Remove only the exact runtime object inserted by this
                    // import. Falling back to a code match could delete a base
                    // catalog row when the imported definition was never added.
                    const idx = course_data.lastIndexOf(pendingCourse);
                    if (idx >= 0) course_data.splice(idx, 1);
                }
            } catch (_) {}

            // Restore the linked contextual definitions in the live custom
            // catalogs too. A re-import can temporarily replace an existing
            // definition, so simply removing the importer object would leave
            // storage and the running planner out of sync.
            linkedPrograms.forEach(function(link) {
                if (!link) return;
                const program = String(link.program || majorKey).toUpperCase();
                const linkedCode = getCombinedCodeFromCourseObj(link.course) || targetCode;
                const previousCourse = link.previousCourse && typeof link.previousCourse === 'object'
                    ? link.previousCourse : null;

                if (program === majorKey) {
                    let index = primaryCustomCourseRecords.indexOf(link.course);
                    if (index < 0) {
                        index = primaryCustomCourseRecords.findIndex(function(record) {
                            return getCombinedCodeFromCourseObj(record) === linkedCode;
                        });
                    }
                    if (previousCourse) {
                        if (index >= 0) {
                            const runtimeRecord = primaryCustomCourseRecords[index];
                            primaryCustomCourseRecords[index] = previousCourse;
                            const runtimeIndex = course_data.indexOf(runtimeRecord);
                            if (runtimeIndex >= 0) course_data[runtimeIndex] = previousCourse;
                        } else {
                            primaryCustomCourseRecords.push(previousCourse);
                            if (!course_data.some(function(record) {
                                return getCombinedCodeFromCourseObj(record) === linkedCode;
                            })) course_data.push(previousCourse);
                        }
                    } else if (index >= 0 && primaryCustomCourseRecords[index] === link.course) {
                        const runtimeRecord = primaryCustomCourseRecords[index];
                        primaryCustomCourseRecords.splice(index, 1);
                        const runtimeIndex = course_data.indexOf(runtimeRecord);
                        if (runtimeIndex >= 0) course_data.splice(runtimeIndex, 1);
                    }
                    return;
                }

                if (!getActiveContextProgramCodes().includes(program)) return;
                replaceContextRuntimeCustomCourses(program, loadCustomCoursesForMajor(program));
            });

            refreshCourseDatalistsAndTypes();
            requestPlanSave();
            return true;
        }

        // Helper to sequentially process a list of pending custom courses.
        // Each entry should contain a `course` (reference to the course object
        // already added to course_data) and optionally a `parsedInfo` object
        // containing raw code/title/credits extracted from the transcript. The
        // function will show the custom course modal prefilled with the known
        // information and allow the user to complete any missing fields. Once
        // the user saves or cancels, the next pending course is processed.
        function processPendingCustomCourses(list) {
            if (!Array.isArray(list) || list.length === 0) return;
            const next = list.shift();
            const prefill = {};
            if (next.parsedInfo && next.parsedInfo.code) {
                prefill.code = next.parsedInfo.code;
            } else if (next.course && next.course.Major && next.course.Code) {
                prefill.code = next.course.Major + next.course.Code;
            }
            if (next.parsedInfo && next.parsedInfo.title) {
                prefill.name = next.parsedInfo.title;
            } else if (next.course && next.course.Course_Name) {
                prefill.name = next.course.Course_Name;
            }
            if (next.course) {
                prefill.suCredits = next.course.SU_credit;
                prefill.ects = next.course.ECTS;
                prefill.basicScience = next.course.Basic_Science;
                prefill.engineering = next.course.Engineering;
                prefill.elType = next.course.EL_Type;
            }
            if (next.parsedInfo && next.parsedInfo.Language_Level !== undefined) {
                prefill.languageLevel = next.parsedInfo.Language_Level;
            } else if (next.course && next.course.Language_Level !== undefined) {
                prefill.languageLevel = next.course.Language_Level;
            }
            // Show the custom course form. Pass the existing course object so
            // that the save handler updates it instead of creating a new one.
            showCustomCourseForm(
                prefill,
                next.course,
                function() { processPendingCustomCourses(list); },
                function() { return rollbackPendingTranscriptCustomCourse(next); },
                null,
                next.programCourses
            );
        }

        function _creditNumber(value) {
            const raw = (value === null || value === undefined) ? '' : String(value).trim();
            if (!raw) return 0;
            const n = parseFloat(raw.replace(',', '.'));
            return Number.isFinite(n) ? n : 0;
        }

        function _hasAnyNonZeroCredits(course) {
            if (!course || typeof course !== 'object') return false;
            return (
                _creditNumber(course.ECTS) !== 0 ||
                _creditNumber(course.SU_credit) !== 0 ||
                _creditNumber(course.Engineering) !== 0 ||
                _creditNumber(course.Basic_Science) !== 0
            );
        }

        function _fillCreditsFromSource(target, source) {
            if (!target || typeof target !== 'object' || !source || typeof source !== 'object') return false;
            let changed = false;

            const srcECTS = _creditNumber(source.ECTS);
            const srcSU = _creditNumber(source.SU_credit);
            const srcENG = _creditNumber(source.Engineering);
            const srcBS = _creditNumber(source.Basic_Science);

            if (_creditNumber(target.ECTS) === 0 && srcECTS !== 0) {
                target.ECTS = String(source.ECTS ?? '0');
                changed = true;
            }
            if (_creditNumber(target.SU_credit) === 0 && srcSU !== 0) {
                target.SU_credit = String(source.SU_credit ?? '0');
                changed = true;
            }
            if (_creditNumber(target.Engineering) === 0 && srcENG !== 0) {
                target.Engineering = srcENG;
                changed = true;
            }
            if (_creditNumber(target.Basic_Science) === 0 && srcBS !== 0) {
                target.Basic_Science = srcBS;
                changed = true;
            }

            return changed;
        }

        function _findCourseByCombinedCodeInList(list, combinedCode) {
            try {
                if (!combinedCode || !Array.isArray(list)) return null;
                for (let i = 0; i < list.length; i++) {
                    const c = list[i];
                    if (c && (c.Major + c.Code) === combinedCode) return c;
                }
            } catch (_) {}
            return null;
        }

        function _findCourseCreditsSourceByCombinedCode(combinedCode, dmBaseList) {
            return (
                _findCourseByCombinedCodeInList(course_data, combinedCode) ||
                _findCourseByCombinedCodeInList(dmBaseList, combinedCode) ||
                null
            );
        }

        function _repairDmCustomCoursesCredits(dmCode, dmCustomCourses, dmBaseList) {
            if (!dmCode || !Array.isArray(dmCustomCourses) || dmCustomCourses.length === 0) return 0;
            const previousCourses = dmCustomCourses.map(function(course) {
                return course && typeof course === 'object' ? Object.assign({}, course) : course;
            });
            let changedCount = 0;
            for (let i = 0; i < dmCustomCourses.length; i++) {
                const dmCourse = dmCustomCourses[i];
                if (!dmCourse || typeof dmCourse !== 'object') continue;
                const combined = (dmCourse.Major || '') + (dmCourse.Code || '');
                if (!combined) continue;
                const source = _findCourseCreditsSourceByCombinedCode(combined, dmBaseList);
                if (!source || !_hasAnyNonZeroCredits(source)) continue;
                if (_fillCreditsFromSource(dmCourse, source)) changedCount++;
            }
            if (changedCount > 0) {
                try {
                    const keyDM = 'customCourses_' + dmCode;
                    if (!planSetItem(keyDM, JSON.stringify(dmCustomCourses))) {
                        dmCustomCourses.splice(0, dmCustomCourses.length, ...previousCourses);
                        return 0;
                    }
                } catch (_) {
                    dmCustomCourses.splice(0, dmCustomCourses.length, ...previousCourses);
                    return 0;
                }
            }
            return changedCount;
        }

        function _customClassificationIdentity(combinedCode) {
            const normalized = normalizeCombinedCourseCode(combinedCode);
            if (!normalized) return '';
            try {
                if (typeof canonicalCourseCode === 'function') {
                    return normalizeCombinedCourseCode(canonicalCourseCode(normalized)) || normalized;
                }
            } catch (_) {}
            return normalized;
        }

        function _customClassificationIdentitySet(codes) {
            const identities = new Set();
            if (!codes || typeof codes.forEach !== 'function') return identities;
            codes.forEach(function(code) {
                const identity = _customClassificationIdentity(code);
                if (identity) identities.add(identity);
            });
            return identities;
        }

        function _activeCustomCourseRecords(records, officialCodes) {
            const source = Array.isArray(records) ? records : [];
            const officialIdentities = _customClassificationIdentitySet(officialCodes);
            const counts = new Map();
            source.forEach(function(record) {
                const identity = _customClassificationIdentity(getCombinedCodeFromCourseObj(record));
                if (!identity) return;
                counts.set(identity, (counts.get(identity) || 0) + 1);
            });
            // Official rows are authoritative. Canonical duplicates from old
            // or hand-edited imports are ambiguous, so neither copy is allowed
            // into the live catalog until the user repairs storage.
            return source.filter(function(record) {
                const identity = _customClassificationIdentity(getCombinedCodeFromCourseObj(record));
                return !!identity
                    && !officialIdentities.has(identity)
                    && counts.get(identity) === 1;
            });
        }

        function _activePrimaryCustomCourseByCode(combinedCode, records) {
            const target = _customClassificationIdentity(combinedCode);
            if (!target) return null;
            const sourceRecords = Array.isArray(records) ? records : primaryCustomCourseRecords;
            const activeRecords = _activeCustomCourseRecords(sourceRecords, primaryCatalogCodeSet);
            const matches = activeRecords.filter(function(record) {
                return _customClassificationIdentity(getCombinedCodeFromCourseObj(record)) === target;
            });
            // Duplicate custom definitions are ambiguous. The custom-course
            // manager already asks the user to repair them, so this automatic
            // classification path must not silently pick one.
            return matches.length === 1 ? matches[0] : null;
        }

        function _storedActivePrimaryCustomCourseByCode(combinedCode) {
            const primaryProgram = String((curriculum && curriculum.major) || '').toUpperCase();
            if (!primaryProgram) return null;
            const parsed = JSON.parse(planGetItem('customCourses_' + primaryProgram) || '[]');
            if (!Array.isArray(parsed)) return null;
            const normalized = normalizeCustomCourseListForStorage(primaryProgram, parsed);
            return _activePrimaryCustomCourseByCode(combinedCode, normalized);
        }

        /**
         * Return active primary custom definitions that still need a category
         * for the selected double-major program.
         *
         * `course_data` is deliberately not consulted here. It is a runtime
         * catalog that also contains official primary rows and restored global
         * transcript definitions (which correctly remain N/A when absent from
         * the target catalog). Custom-course ownership comes only from the
         * validated, program-scoped primary custom records.
         */
        function _pendingDoubleMajorCustomCourses() {
            const targetCodes = new Set(doubleMajorCourseData.map(function(record) {
                return _customClassificationIdentity(getCombinedCodeFromCourseObj(record));
            }).filter(Boolean));
            try {
                loadCustomCoursesForMajor(curriculum && curriculum.doubleMajor).forEach(function(record) {
                    const identity = _customClassificationIdentity(getCombinedCodeFromCourseObj(record));
                    if (identity) targetCodes.add(identity);
                });
            } catch (_) {}
            const seen = new Set();
            const pending = [];

            primaryCustomCourseRecords.forEach(function(record) {
                const code = getCombinedCodeFromCourseObj(record);
                const identity = _customClassificationIdentity(code);
                if (!code || !identity || seen.has(identity) || targetCodes.has(identity)) return;
                seen.add(identity);

                // Fail closed when old/imported storage contains duplicate
                // definitions for the same custom code.
                if (!_activePrimaryCustomCourseByCode(code)) return;
                pending.push({
                    code,
                    title: record.Course_Name || code,
                });
            });
            return pending;
        }

        /**
         * Process a queue of courses that are missing a double major category.
         * For each course code in the list, we prompt the user to select
         * a category (core/area/free/university/required).  Once the user
         * selects a type, we create a new course object for the double
         * major and append it to the double major course data and
         * localStorage.  After all items have been processed, we
         * recalculate effective types for the double major.
         * @param {Array} list - Array of objects { code, title }
         * @param {function} [onComplete] - Called after every review dialog settles
         */
        function processPendingDoubleMajor(list, onComplete) {
            if (!Array.isArray(list) || list.length === 0) {
                // After processing all, recalc double major categories and
                // update the datalist to include any courses defined via
                // DM classification.  This ensures newly added DM
                // custom courses appear in the selection dropdown.
                try {
                    curriculum.recalcEffectiveTypesDouble(doubleMajorCourseData);
                } catch (ex) {}
                // Refresh datalist with DM uniques
                updateDatalistForDoubleMajor();
                if (typeof onComplete === 'function') onComplete();
                return;
            }
             const item = list.shift();
             const sourceCustomCourse = _activePrimaryCustomCourseByCode(item && item.code);
             const targetDoubleMajor = String((curriculum && curriculum.doubleMajor) || '').toUpperCase();
             let alreadyStoredForDoubleMajor = false;
             try {
                 const itemIdentity = _customClassificationIdentity(item && item.code);
                 alreadyStoredForDoubleMajor = loadCustomCoursesForMajor(targetDoubleMajor).some(function(record) {
                     return _customClassificationIdentity(getCombinedCodeFromCourseObj(record)) === itemIdentity;
                 });
             } catch (_) {}
             const alreadyDefinedForDoubleMajor = !!sourceCustomCourse
                 && doubleMajorCourseData.some(function(record) {
                     return _customClassificationIdentity(getCombinedCodeFromCourseObj(record))
                         === _customClassificationIdentity(item.code);
                 });
             // Revalidate provenance at the mutation boundary. This keeps an
             // ordinary catalog/global N/A row (or a stale queued item) from
             // ever becoming a customCourses_<DM> overlay.
             if (!sourceCustomCourse || alreadyDefinedForDoubleMajor || alreadyStoredForDoubleMajor) {
                 processPendingDoubleMajor(list, onComplete);
                 return;
             }
             if (!targetDoubleMajor) {
                 processPendingDoubleMajor(list, onComplete);
                 return;
             }
             showCourseTypeFormDM(item.code, item.title, async function(selectedType) {
                 if (selectedType) {
                    let source = null;
                    try { source = _storedActivePrimaryCustomCourseByCode(item.code); } catch (_) {}
                    if (!source) {
                        await uiAlert(
                            'Custom course changed',
                            `<p><strong>${escapeHtml(item.code)}</strong> is no longer an active custom course for the primary program. No ${escapeHtml(targetDoubleMajor)} category was saved.</p>`
                        );
                        processPendingDoubleMajor(list, onComplete);
                        return;
                    }
                    const sourceCode = getCombinedCodeFromCourseObj(source) || normalizeCombinedCourseCode(item.code);
                    const identity = splitCombinedCourseCode(sourceCode);
                    const maj = identity ? identity.major : '';
                    const num = identity ? identity.code : '';
                    const newCourseDM = {
                        Major: maj,
                        Code: num,
                        Course_Name: source.Course_Name || item.title || sourceCode,
                        ECTS: source ? String(source.ECTS ?? '0') : '0',
                        Engineering: source ? _creditNumber(source.Engineering) : 0,
                        Basic_Science: source ? _creditNumber(source.Basic_Science) : 0,
                        SU_credit: source ? String(source.SU_credit ?? '0') : '0',
                        // Program category is independent, but inherent course
                        // metadata must stay identical across program-scoped
                        // definitions. Faculty is used by requirement groups.
                        Faculty: source && source.Faculty ? String(source.Faculty) : '',
                        EL_Type: selectedType,
                        Faculty_Course: 'No'
                    };
                    if (source && source.Language_Level) {
                        newCourseDM.Language_Level = source.Language_Level;
                    }
                    // Persist the definition before changing the live DM model.
                    let persisted = false;
                    let persistedCourse = null;
                    try {
                        // If the selected program changed while this modal was
                        // open, discard the stale queue rather than writing its
                        // category under a different program key.
                        if (String((curriculum && curriculum.doubleMajor) || '').toUpperCase() !== targetDoubleMajor) {
                            throw new Error('Double-major selection changed');
                        }
                        const keyDM = 'customCourses_' + targetDoubleMajor;
                        const parsedDM = JSON.parse(planGetItem(keyDM) || '[]');
                        if (!Array.isArray(parsedDM)) throw new Error('Invalid double-major custom-course storage');
                        const existingDM = normalizeCustomCourseListForStorage(targetDoubleMajor, parsedDM);
                        const targetCode = _customClassificationIdentity(item.code);
                        const targetMatches = existingDM.filter(function(record) {
                            return _customClassificationIdentity(getCombinedCodeFromCourseObj(record)) === targetCode;
                        });
                        if (targetMatches.length > 1) {
                            throw new Error('Ambiguous double-major custom-course definitions');
                        }
                        persistedCourse = targetMatches.length === 1 ? targetMatches[0] : null;

                        // A concurrently created definition wins. Otherwise,
                        // validate the full next list before performing the one
                        // durable write, so corrupt legacy storage is never
                        // overwritten or partially repaired by this prompt.
                        if (persistedCourse) {
                            persisted = true;
                        } else {
                            const nextDM = normalizeCustomCourseListForStorage(
                                targetDoubleMajor,
                                existingDM.concat([newCourseDM])
                            );
                            persistedCourse = nextDM.find(function(record) {
                                return _customClassificationIdentity(getCombinedCodeFromCourseObj(record)) === targetCode;
                            }) || null;
                            persisted = !!persistedCourse && planSetItem(keyDM, JSON.stringify(nextDM));
                        }
                    } catch (_) {}
                    if (!persisted) {
                        await uiAlert(`Could not save ${escapeHtml(targetDoubleMajor)} category`, `<p>The category for <strong>${escapeHtml(item.code)}</strong> was not applied because browser storage rejected the update.</p>`);
                        processPendingDoubleMajor(list, onComplete);
                        return;
                    }
                    if (!doubleMajorCourseData.some(function(record) {
                        return _customClassificationIdentity(getCombinedCodeFromCourseObj(record))
                            === _customClassificationIdentity(getCombinedCodeFromCourseObj(persistedCourse));
                    })) {
                        doubleMajorCourseData.push(persistedCourse);
                        doubleMajorCustomCourseRecords.push(persistedCourse);
                    }
                }
                // Process next
                processPendingDoubleMajor(list, onComplete);
            });
        }

        /**
         * Show a modal to choose a category for a course under the double
         * major.  Only the category selector is presented; credits are
         * assumed to be zero by default.  On save, the callback is
         * invoked with the selected category; on cancel, callback is
         * invoked with null.
         * @param {string} code - The course code (e.g., CS101)
         * @param {string} title - The course name
         * @param {function} callback - Called with selected category or null
         */
        function showCourseTypeFormDM(code, title, callback) {
            // Avoid multiple modals
            if (document.querySelector('.double_major_modal')) return;
            const dmCode = String((curriculum && curriculum.doubleMajor) || 'Double Major').toUpperCase();
            const overlay = document.createElement('div');
            overlay.classList.add('double_major_overlay');
            const modal = document.createElement('div');
            modal.classList.add('double_major_modal');
            let doubleMajorDialog = null;
            // Title
            const h = document.createElement('h3');
            h.innerText = `Set ${dmCode} Category`;
            modal.appendChild(h);
            // Info text
            const info = document.createElement('p');
            info.innerText = code + ' - ' + title;
            modal.appendChild(info);
            // Select
            const selectLabel = document.createElement('label');
            selectLabel.htmlFor = 'dm-program-category';
            selectLabel.innerText = `${dmCode} Category:`;
            const dmCategoryOptions = ['core', 'area', 'required', 'university', 'free', 'none', 'unknown'];
            const dmCategoryHelp = createProgramCategoryHelp(dmCode, dmCategoryOptions);
            const dmLabelLine = document.createElement('div');
            dmLabelLine.className = 'program-category-label-line';
            dmLabelLine.appendChild(selectLabel);
            dmLabelLine.appendChild(dmCategoryHelp.button);
            modal.appendChild(dmLabelLine);
            const select = document.createElement('select');
            select.id = 'dm-program-category';
            dmCategoryOptions.forEach(function(opt) {
                const o = document.createElement('option');
                o.value = opt;
                o.innerText = opt === 'unknown'
                    ? 'N/A (not allocated)'
                    : opt.charAt(0).toUpperCase() + opt.slice(1);
                select.appendChild(o);
            });
            modal.appendChild(select);
            modal.appendChild(dmCategoryHelp.panel);
            // Buttons
            const buttons = document.createElement('div');
            buttons.classList.add('dm-buttons');
            const cancel = document.createElement('button');
            cancel.type = 'button';
            cancel.innerText = 'Cancel';
            cancel.classList.add('btn', 'btn-secondary', 'btn-sm');
            cancel.addEventListener('click', function(e) {
                e.stopPropagation();
                if (doubleMajorDialog) doubleMajorDialog.close();
                if (callback) callback(null);
            });
            buttons.appendChild(cancel);
            const save = document.createElement('button');
            save.type = 'button';
            save.innerText = 'Save';
            save.classList.add('btn', 'btn-primary', 'btn-sm');
            save.onclick = function(e) {
                e.stopPropagation();
                const chosen = select.value;
                if (doubleMajorDialog) doubleMajorDialog.close();
                if (callback) callback(chosen);
            };
            buttons.appendChild(save);
            modal.appendChild(buttons);
            overlay.appendChild(modal);
            // Prevent closing the modal by clicking outside
            overlay.addEventListener('click', function(e) {
                e.stopPropagation();
            });
            document.body.appendChild(overlay);
            doubleMajorDialog = activateAccessibleDialog(overlay, modal, h, {
                initialFocus: select,
                onEscape: function() { cancel.click(); },
            });
        }

        /**
         * Load and activate a double major.  This function fetches the course
         * data for the selected second major, loads any custom courses for
         * that major, and then recalculates effective types for the double
         * major.  It also scans existing courses in the curriculum to
         * identify any that do not yet exist in the double major course data
         * and prompts the user to classify them for the double major.
         * @param {string} dm - The double major code (e.g., EE)
         */
        function setDoubleMajor(dm) {
            curriculum.doubleMajor = dm;
            curriculum.entryTermDM = entryTermDMCode;
            // Attach the loaded DM course data to the curriculum so
            // recalcEffectiveTypes() can trigger DM recalculation automatically.
            // Fetch course data for second major
            return fetchCourseData(dm, entryTermDMCode).then(async function(jsonDM) {
                if (!jsonDM || jsonDM.length === 0) {
                    await uiAlert(
                        'No course data',
                        `<p>No course data available for <strong>${escapeHtml(dm)}</strong> in <strong>${escapeHtml(termCodeToName(entryTermDMCode))}</strong>.</p>`
                    );
                }
                // Important: keep `doubleMajorCourseData` as a single shared
                // array reference. Some UIs (e.g., detailed summaries) read
                // from `curriculum.doubleMajorCourseData`, so reassigning via
                // `.concat()` would desync that reference and hide custom DM
                // courses in lists while totals still compute correctly.
                doubleMajorCourseData = Array.isArray(jsonDM) ? jsonDM : [];
                doubleMajorCatalogCodeSet = new Set(doubleMajorCourseData.map(getCombinedCodeFromCourseObj).filter(Boolean));
                doubleMajorCustomCourseRecords = [];
                // Save DM course data on the curriculum instance so
                // recalcEffectiveTypes() can trigger DM recalculation.
                curriculum.doubleMajorCourseData = doubleMajorCourseData;
                // Load custom courses for second major
                let dmStoredCustomCourses = [];
                try {
                    const keyDM = 'customCourses_' + dm;
                    const storedDM = planGetItem(keyDM);
                    if (storedDM) {
                        const parsedDM = JSON.parse(storedDM);
                        if (Array.isArray(parsedDM)) {
                            dmStoredCustomCourses = normalizeCustomCourseListForStorage(dm, parsedDM);
                        }
                    }
                } catch (ex) {}

                // Repair legacy DM custom courses that were saved with missing
                // credits (ECTS / SU / ENG / BS) by copying credits from the
                // main course definition when available.
                const repaired = _repairDmCustomCoursesCredits(dm, dmStoredCustomCourses, doubleMajorCourseData);
                if (repaired > 0) {
                    try {
                        const shownKey = 'dmCustomCoursesCreditsRepairShown_' + dm;
                        if (!planGetItem(shownKey)) {
                            planSetItem(shownKey, '1');
                            await uiAlert(
                                'Repaired double major credits',
                                `<p>Fixed missing credit values for <strong>${repaired}</strong> saved double major course${repaired === 1 ? '' : 's'} (ECTS / SU / ENG / BS).</p>`
                            );
                        }
                    } catch (_) {}
                }
                const dmCustomCourses = _activeCustomCourseRecords(
                    dmStoredCustomCourses,
                    doubleMajorCatalogCodeSet
                );
                if (dmCustomCourses && dmCustomCourses.length) {
                    doubleMajorCustomCourseRecords = dmCustomCourses;
                    for (let i = 0; i < dmCustomCourses.length; i++) {
                        doubleMajorCourseData.push(dmCustomCourses[i]);
                    }
                }
                // Recalc categories for DM
                curriculum.recalcEffectiveTypesDouble(doubleMajorCourseData);
                // Only genuine, active primary custom definitions need a
                // program-specific planning classification. Ordinary catalog
                // courses and restored global transcript rows remain N/A when
                // they are absent from the target program catalog.
                const pending = _pendingDoubleMajorCustomCourses();
                if (pending.length > 0) {
                    await new Promise(function(resolve) {
                        processPendingDoubleMajor(pending, resolve);
                    });
                }

                // After loading the double major data, update the course
                // selection datalist to include courses unique to the
                // double major.  We combine the primary major's
                // course_data with any DM course whose Major+Code
                // combination is not present in the primary data.  This
                // ensures the user can add DM-only courses while
                // maintaining separate credit calculations for the main
                // major.  Updating the datalist at this point allows
                // immediate selection of DM courses before any
                // pending classifications complete.  We will update
                // again after pending courses are classified (see below).
                updateDatalistForDoubleMajor();
            });
        }

        /**
         * Update the datalist for course selection when a double major is
         * active.  This helper builds a combined course list consisting
         * of the main major's courses plus any courses unique to the
         * double major (i.e., those not present in the main major's
         * course_data).  It then rebuilds the datalist options so that
         * users can select courses from either major.  Courses unique
         * to the double major will still be ignored for the main
         * major's category allocations (handled in recalcEffectiveTypes).
         */
        function updateDatalistForDoubleMajor() {
            try {
                // If no double major is selected, reset to primary data
                if (!curriculum.doubleMajor) {
                    document.querySelectorAll('datalist.course_list').forEach(function(dl) {
                        populateCourseDataList(dl, course_data);
                    });
                    return;
                }
                // Build a set of main course codes for quick lookup
                const mainSet = new Set(course_data.map(function(c) {
                    return _customClassificationIdentity((c.Major || '') + (c.Code || ''));
                }).filter(Boolean));
                // Collect unique double major courses
                const dmUnique = [];
                doubleMajorCourseData.forEach(function(dm) {
                    const key = _customClassificationIdentity((dm.Major || '') + (dm.Code || ''));
                    if (!mainSet.has(key)) dmUnique.push(dm);
                });
                // Combine arrays
                const combined = course_data.concat(dmUnique);
                document.querySelectorAll('datalist.course_list').forEach(function(dl) {
                    populateCourseDataList(dl, combined);
                });
            } catch (ex) {
                // ignore errors
            }
        }
        // Expose the helper globally so that other modules (e.g., the
        // curriculum code) can trigger datalist updates after reallocations.
        if (typeof window !== 'undefined') {
            window.updateDatalistForDoubleMajor = updateDatalistForDoubleMajor;
        }

        /**
         * Deletes all custom courses defined for the current major. Custom
         * courses are stored under the localStorage key `customCourses_<major>`.
         * This function removes those entries from both localStorage and the
         * in-memory `course_data` array. It also removes any instances of
         * those courses from the current curriculum's semesters. Finally it
         * updates the stored curriculum in localStorage and reloads the page
         * so that the UI reflects the changes. A confirmation prompt guards
         * against accidental deletion.
         */
        async function handleDeleteCustomCourses() {
            const primaryProgram = String(major_chosen_by_user || '').toUpperCase();
            const primaryKey = 'customCourses_' + primaryProgram;
            const primaryList = loadCustomCoursesForMajor(primaryProgram);
            if (!primaryList.length) {
                await uiAlert('No custom courses', '<p>There are no primary-program custom courses to delete for this plan.</p>');
                return;
            }
            const deletedCodes = new Set(primaryList.map(function(record) {
                return _customClassificationIdentity(getCombinedCodeFromCourseObj(record));
            }).filter(Boolean));
            const primaryPlan = {
                programCode: primaryProgram,
                key: primaryKey,
                previousRaw: planGetItem(primaryKey),
                previousList: primaryList,
                nextList: [],
            };
            const contextPlans = getActiveContextProgramCodes().map(function(programCode) {
                const key = 'customCourses_' + programCode;
                const previousList = loadCustomCoursesForMajor(programCode);
                const nextList = previousList.filter(function(record) {
                    return !deletedCodes.has(
                        _customClassificationIdentity(getCombinedCodeFromCourseObj(record))
                    );
                });
                return {
                    programCode,
                    key,
                    previousRaw: planGetItem(key),
                    previousList,
                    nextList,
                };
            }).filter(function(plan) {
                return plan.nextList.length !== plan.previousList.length;
            });
            const plans = [primaryPlan].concat(contextPlans);

            const confirmMsg = `Are you sure you want to delete all ${primaryProgram} custom courses and their selected-program categories?`;
            if (!(await uiConfirm('Delete custom courses?', `<p>${escapeHtml(confirmMsg)}</p><p>This cannot be undone.</p>`, { confirmText: 'Delete', danger: true }))) {
                return;
            }

            const completed = [];
            let removalFailed = false;
            for (let i = 0; i < plans.length; i++) {
                try {
                    const plan = plans[i];
                    const persisted = plan.nextList.length
                        ? planSetItem(plan.key, JSON.stringify(plan.nextList))
                        : planRemoveItem(plan.key);
                    if (persisted === false) {
                        removalFailed = true;
                        break;
                    }
                    completed.push(plans[i]);
                } catch (_) {
                    removalFailed = true;
                    break;
                }
            }
            if (removalFailed) {
                for (let i = completed.length - 1; i >= 0; i--) {
                    restoreStoredValue(completed[i].key, completed[i].previousRaw);
                }
                await uiAlert('Could not delete custom courses', '<p>No planner courses were changed because browser storage rejected a program update.</p>');
                return;
            }

            // Only primary-program custom definitions own planner occurrences.
            // Secondary rows are classification overlays for the same real
            // courses and must never delete planner occurrences. A dormant main
            // overlay that collides with the official catalog does not own the
            // official course occurrence either.
            primaryPlan.previousList.map(getCombinedCodeFromCourseObj).filter(function(code) {
                return code && !primaryCatalogIdentitySet.has(_customClassificationIdentity(code));
            }).forEach(removeSemesterOccurrencesByCode);
            primaryCustomCourseRecords.forEach(function(record) {
                removeCourseDataRecord(record, getCombinedCodeFromCourseObj(record));
            });
            primaryCustomCourseRecords = [];

            contextPlans.forEach(function(plan) {
                replaceContextRuntimeCustomCourses(plan.programCode, plan.nextList);
            });
            // Recalculate effective types and update datalist
            try {
                if (typeof curriculum.recalcEffectiveTypes === 'function') {
                    curriculum.recalcEffectiveTypes(course_data);
                }
                if (curriculum.doubleMajor && typeof curriculum.recalcEffectiveTypesDouble === 'function') {
                    curriculum.recalcEffectiveTypesDouble(doubleMajorCourseData);
                }
                document.querySelectorAll('datalist.course_list').forEach(function(dl) {
                    populateCourseDataList(dl, course_data);
                });
                if (curriculum.doubleMajor && typeof updateDatalistForDoubleMajor === 'function') {
                    updateDatalistForDoubleMajor();
                }
            } catch (err) {
                // ignore
            }
            const saveRequested = requestPlanSave();
            if (!saveRequested || !flushPlanSaves()) {
                for (let i = completed.length - 1; i >= 0; i--) {
                    restoreStoredValue(completed[i].key, completed[i].previousRaw);
                }
                await uiAlert('Could not delete custom courses', '<p>The planner snapshot could not be saved. Your custom courses will be restored now.</p>');
                location.reload();
                return;
            }
            // Reload the page to ensure every derived panel reflects removal.
            location.reload();
        }

        // Get from transcript:
        async function handleAcademicRecordsImport() {
        const fileInput = document.getElementById('academicRecordsInput');

        if (fileInput.files.length > 0) {
            const file = fileInput.files[0];
            let parsedData;

            try {
                const ui = (typeof window !== 'undefined') ? window.uiModal : null;
                const mentionsDegreeEvaluation = (text) => {
                    try {
                        return /degree\s+evaluation/i.test(String(text || ''));
                    } catch (_) {
                        return false;
                    }
                };
                const isEngineeringCreditDistribution = (text) => {
                    try {
                        const t = String(text || '');
                        return /\bbasic\s+science\s+and\s+engineering\b/i.test(t) &&
                               /\bects\b/i.test(t) &&
                               /\bdistribution\b/i.test(t);
                    } catch (_) {
                        return false;
                    }
                };
                const isAcademicRecordsSummary = (text) => {
                    try {
                        return /academic\s+records\s+summary/i.test(String(text || ''));
                    } catch (_) {
                        return false;
                    }
                };
                const isYokTranscript = (text) => {
                    try {
                        const t = String(text || '');
                        return t.includes('NOT DÖKÜM BELGESİ') || t.includes('NOT DOKUM BELGESI');
                    } catch (_) {
                        return false;
                    }
                };
                const isNoPermissionHtml = (text) => {
                    try {
                        const t = String(text || '');
                        return t.includes('Sorry! You have no permission to access this page') ||
                               t.includes('You have no permission to access this page') ||
                               t.includes('Thanks for your patience') ||
                               t.includes('Information Technology</h3>');
                    } catch (_) {
                        return false;
                    }
                };
                const showDegreeEvalWarning = async () => {
                    const ui = (typeof window !== 'undefined') ? window.uiModal : null;
                    const title = 'Wrong file: Degree Evaluation';
                    const body = (
                        '<p>This looks like a <strong>Degree Evaluation</strong> document. SUrriculum can only import from your <strong>Academic Records Summary</strong>.</p>' +
                        '<p><strong>Please do not upload Degree Evaluation.</strong></p>' +
                        '<p>Please upload the correct file:</p>' +
                        '<ol>' +
                        '<li>Go to <strong>SUIS</strong> → <strong>Student</strong> → <strong>Student Records</strong> → <strong>Academic Transcript</strong></li>' +
                        '<li>Open your <strong>Academic Records Summary</strong></li>' +
                        '<li>Save it as <strong>HTML (preferred)</strong> or print to <strong>PDF</strong></li>' +
                        '<li>Upload that file here</li>' +
                        '</ol>' +
                        '<p>You can also upload your <strong>YÖK Transcript PDF</strong> (not preferred).</p>'
                    );
                    try { fileInput.value = ''; } catch (_) {}
                    try {
                        if (ui && typeof ui.alert === 'function') {
                            await ui.alert(title, body);
                        } else {
                            await uiAlert(title, body);
                        }
                    } catch (_) {}
                };
                const showCreditDistributionWarning = async () => {
                    const title = 'Wrong file: course credit-distribution list';
                    const body = (
                        '<p>This is a <strong>Basic Science and Engineering ECTS credit-distribution list</strong>, not a student transcript. SUrriculum can only import from your <strong>Academic Records Summary</strong>.</p>' +
                        '<p>Please upload the correct file:</p>' +
                        '<ol>' +
                        '<li>Go to <strong>SUIS</strong> → <strong>Student</strong> → <strong>Student Records</strong> → <strong>Academic Transcript</strong></li>' +
                        '<li>Open your <strong>Academic Records Summary</strong></li>' +
                        '<li>Save it as <strong>HTML (preferred)</strong> or print to <strong>PDF</strong></li>' +
                        '<li>Upload that file here</li>' +
                        '</ol>' +
                        '<p>You can also upload your <strong>YÖK Transcript PDF</strong> (not preferred).</p>'
                    );
                    try { fileInput.value = ''; } catch (_) {}
                    try {
                        if (ui && typeof ui.alert === 'function') {
                            await ui.alert(title, body);
                        } else {
                            await uiAlert(title, body);
                        }
                    } catch (_) {}
                };
                const showHtmlSaveWarning = async () => {
                    const title = 'Cannot import this HTML file';
                    const body =
                        '<p>This HTML file does not contain your transcript data. This usually happens when you save the page as <strong>HTML only</strong> or when the saved page is missing required content.</p>' +
                        '<p>Please re-save your <strong>Academic Records Summary</strong> as:</p>' +
                        '<ol>' +
                        '<li>Open <strong>Academic Records Summary</strong> in SUIS (make sure you are logged in)</li>' +
                        '<li>Press <strong>Ctrl+S</strong> / <strong>Save Page As…</strong></li>' +
                        '<li>Choose <strong>Webpage, Complete</strong> (not “HTML only”)</li>' +
                        '<li>Upload the saved <strong>.html</strong> file here</li>' +
                        '</ol>' +
                        '<p>Alternatively, print the same page to <strong>PDF</strong> and import that.</p>' +
                        '<p>You can also upload a <strong>YÖK Transcript PDF</strong> (not preferred).</p>';
                    try { fileInput.value = ''; } catch (_) {}
                    try {
                        if (ui && typeof ui.alert === 'function') await ui.alert(title, body);
                        else await uiAlert(title, body);
                    } catch (_) {}
                };

                if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
                    if (!window.pdfTranscriptReader || typeof window.pdfTranscriptReader.extractText !== 'function') {
                        throw new Error('The local PDF transcript reader is unavailable.');
                    }
                    const extraction = await window.pdfTranscriptReader.extractText(file);
                    const text = extraction.text;
                    // Academic Records PDFs may mention Degree Evaluation at the end.
                    // Classify known non-transcript documents before using that phrase
                    // as a Degree Evaluation signal. Never apply this to YÖK transcripts.
                    if (!isYokTranscript(text) && !isAcademicRecordsSummary(text)) {
                        if (isEngineeringCreditDistribution(text)) {
                            await showCreditDistributionWarning();
                            return;
                        }
                        if (mentionsDegreeEvaluation(text)) {
                            await showDegreeEvalWarning();
                            return;
                        }
                    }
                    parsedData = window.academicRecordsParser.parseAcademicRecordsPdf(text);
                } else {
                    const maxTranscriptFileBytes = 10 * 1024 * 1024;
                    if (Number.isFinite(file.size) && file.size > maxTranscriptFileBytes) {
                        const sizeError = new Error('Transcript file exceeds the 10 MB limit.');
                        sizeError.code = 'TRANSCRIPT_FILE_TOO_LARGE';
                        throw sizeError;
                    }
                    const htmlContent = await file.text();
                    // File.size is authoritative for normal browser File objects;
                    // keep a string-length backstop for synthetic/legacy objects.
                    if (htmlContent.length > maxTranscriptFileBytes) {
                        const sizeError = new Error('Transcript file exceeds the 10 MB limit.');
                        sizeError.code = 'TRANSCRIPT_FILE_TOO_LARGE';
                        throw sizeError;
                    }
                    if (isNoPermissionHtml(htmlContent)) {
                        await showHtmlSaveWarning();
                        return;
                    }
                    if (!isAcademicRecordsSummary(htmlContent)) {
                        if (isEngineeringCreditDistribution(htmlContent)) {
                            await showCreditDistributionWarning();
                            return;
                        }
                        if (mentionsDegreeEvaluation(htmlContent)) {
                            await showDegreeEvalWarning();
                            return;
                        }
                    }
                    parsedData = window.academicRecordsParser.parseAcademicRecords(htmlContent);
                }
            } catch (err) {
                const ui = (typeof window !== 'undefined') ? window.uiModal : null;
                const errorCode = err && typeof err.code === 'string' ? err.code : '';
                const showImportAlert = async (title, body) => {
                    if (ui && typeof ui.alert === 'function') await ui.alert(title, body);
                    else await uiAlert(title, body);
                };
                if (errorCode === 'PDF_NO_TEXT') {
                    try { fileInput.value = ''; } catch (_) {}
                    await showImportAlert(
                        'PDF has no readable text',
                        '<p>The PDF contains pages, but it has no selectable text for SUrriculum to read.</p>' +
                        '<p>This commonly happens with <strong>Microsoft Print to PDF</strong>. Open Academic Records Summary again and use your browser\'s <strong>Save as PDF</strong>, or save it as <strong>HTML (Webpage, Complete)</strong>.</p>' +
                        '<p>If the document was scanned, run OCR before importing it.</p>'
                    );
                    return;
                }
                if (['PDF_FILE_TOO_LARGE', 'PDF_TOO_MANY_PAGES', 'PDF_TOO_COMPLEX'].includes(errorCode)) {
                    try { fileInput.value = ''; } catch (_) {}
                    await showImportAlert(
                        'PDF is too large or complex',
                        '<p>For safe local processing, transcript imports are limited to <strong>10 MB</strong>, <strong>100 pages</strong>, 50,000 text fragments, and 1,000,000 extracted characters.</p>' +
                        '<p>Please export only Academic Records Summary, or save it as <strong>HTML (Webpage, Complete)</strong>.</p>'
                    );
                    return;
                }
                if (errorCode === 'TRANSCRIPT_FILE_TOO_LARGE') {
                    try { fileInput.value = ''; } catch (_) {}
                    await showImportAlert(
                        'Transcript file is too large',
                        '<p>For safe local processing, HTML transcript imports are limited to <strong>10 MB</strong>.</p>' +
                        '<p>Please save only Academic Records Summary as <strong>HTML (Webpage, Complete)</strong>, or import its PDF export.</p>'
                    );
                    return;
                }
                console.error(err);
                if (ui && typeof ui.alert === 'function') {
                    await ui.alert('Import failed', '<p>Failed to read the file.</p><p>Please try exporting again as HTML (preferred) or PDF.</p>');
                } else {
                    await uiAlert('Import failed', '<p>Failed to read the file.</p><p>Please try exporting again as HTML (preferred) or PDF.</p>');
                }
                return;
            }

            const parserInvalidGrades = parsedData && Array.isArray(parsedData.invalidGradeCourses)
                ? parsedData.invalidGradeCourses : [];
            const parserSuperseded = parsedData && Array.isArray(parsedData.supersededCourses)
                ? parsedData.supersededCourses : [];
            const parserSkipped = parsedData && Array.isArray(parsedData.skippedCourses)
                ? parsedData.skippedCourses : [];
            const importRecordCode = (item) => escapeHtml(
                item && typeof item === 'object' && item.code ? item.code : (item || 'Unknown course')
            );
            const importRecordContext = (item, semesterField = 'semester', gradeField = 'grade') => {
                if (!item || typeof item !== 'object') return '';
                const details = [];
                if (item[semesterField]) details.push(escapeHtml(item[semesterField]));
                if (item[gradeField] !== undefined && item[gradeField] !== null && String(item[gradeField]).trim()) {
                    details.push(`grade ${escapeHtml(String(item[gradeField]).trim())}`);
                }
                return details.length ? ` <small>(${details.join(', ')})</small>` : '';
            };
            const renderImportRecordList = (items, describe) => {
                if (!Array.isArray(items) || !items.length) return '';
                return `<ul>${items.map((item) => {
                    const detail = typeof describe === 'function'
                        ? describe(item)
                        : importRecordContext(item);
                    return `<li><strong>${importRecordCode(item)}</strong>${detail || ''}</li>`;
                }).join('')}</ul>`;
            };
            const describeSkippedImportRecord = (item) => {
                const context = importRecordContext(item);
                const reason = item && item.reason ? String(item.reason) : '';
                const descriptions = {
                    repeated: 'marked <strong>Repeated</strong> on the transcript. Sabancı uses this status for both repeated and substituted courses, so SUrriculum did not guess or import this record.',
                    excluded: 'marked <strong>Excluded</strong> on the transcript and was not imported.',
                    'ambiguous-existing-occurrence': 'multiple matching entries already exist in the plan, so no occurrence was changed.',
                    'invalid-course-code': 'the course code could not be interpreted.',
                    'missing-or-unrecognized-semester': 'the record has a <strong>missing or unrecognized semester</strong> (expected Fall, Spring, or Summer), so it was not imported.',
                    'custom-course-storage-failed': 'the custom-course definition could not be saved safely, so the course was not imported.',
                    'create-failed': 'the course could not be added to the plan.',
                    'create-unavailable': 'course creation was unavailable.'
                };
                const description = descriptions[reason]
                    || escapeHtml(reason ? reason.replace(/-/g, ' ') : 'not importable');
                return `${context}: ${description}`;
            };
            const renderImportChangeSections = (stats) => {
                const data = stats || {};
                const added = Array.isArray(data.addedCourses) ? data.addedCourses : [];
                const updated = Array.isArray(data.updatedCourses) ? data.updatedCourses : [];
                let html = '';
                if (added.length) {
                    html += `<p><strong>Added (${added.length}):</strong></p>${renderImportRecordList(added)}`;
                }
                if (updated.length) {
                    html += `<p><strong>Updated (${updated.length}):</strong></p>${renderImportRecordList(updated)}`;
                }
                return html;
            };
            const renderImportIssueSections = (stats) => {
                const data = stats || {};
                const notFound = Array.isArray(data.notFoundCourses) ? data.notFoundCourses : [];
                const retainedUnallocated = Array.isArray(data.retainedUnallocatedCourses)
                    ? data.retainedUnallocatedCourses : [];
                const invalid = Array.isArray(data.invalidGradeCourses) ? data.invalidGradeCourses : [];
                const alreadyPresent = Array.isArray(data.alreadyPresentCourses) ? data.alreadyPresentCourses : [];
                const superseded = Array.isArray(data.supersededCourses) ? data.supersededCourses : [];
                const skipped = Array.isArray(data.skippedCourses) ? data.skippedCourses : [];
                let html = '';
                if (retainedUnallocated.length) {
                    html += `<p><strong>Retained as N/A (${retainedUnallocated.length}):</strong> these courses were known to the cumulative course index or saved plan but were outside the selected program/admit-term catalogs.</p>${renderImportRecordList(retainedUnallocated)}`;
                    html += '<p><small>Their letter grades count toward CGPA, but they remain outside PGPA and graduation requirements until a matching major, double major, minor, and admit term is selected.</small></p>';
                }
                if (notFound.length) {
                    html += `<p><strong>Not found (${notFound.length}):</strong> these courses could not be verified in either the selected catalogs or the global course index and were not imported.</p>${renderImportRecordList(notFound, () => '')}`;
                }
                if (invalid.length) {
                    html += `<p><strong>Unsupported grades (${invalid.length}):</strong> these records were not imported.</p>${renderImportRecordList(invalid)}`;
                }
                if (alreadyPresent.length) {
                    html += `<p><strong>Already in the plan (${alreadyPresent.length}):</strong></p>${renderImportRecordList(alreadyPresent, (item) => {
                        if (item && item.reason === 'different-semester') {
                            const existing = item.semester ? escapeHtml(item.semester) : 'another semester';
                            const imported = item.importedSemester ? escapeHtml(item.importedSemester) : 'the transcript semester';
                            return `: already stored in ${existing}; the transcript places it in ${imported}, so SUrriculum left it unchanged.`;
                        }
                        return `${importRecordContext(item)}: already matched the imported record; no change was needed.`;
                    })}`;
                }
                if (superseded.length) {
                    html += `<p><strong>Older duplicate records (${superseded.length}):</strong> SUrriculum kept the latest record for each course:</p>${renderImportRecordList(superseded, (item) => {
                        const dropped = importRecordContext(item);
                        const kept = importRecordContext(item, 'keptSemester', 'keptGrade');
                        return `${dropped} → kept latest record${kept}`;
                    })}`;
                }
                if (skipped.length) {
                    html += `<p><strong>Skipped (${skipped.length}):</strong></p>${renderImportRecordList(skipped, describeSkippedImportRecord)}`;
                }
                return html;
            };
            if (!parsedData || !Array.isArray(parsedData.courses) || parsedData.courses.length === 0) {
                const ui = (typeof window !== 'undefined') ? window.uiModal : null;
                try {
                    if (parserInvalidGrades.length || parserSkipped.length || parserSuperseded.length) {
                        const body = '<p>The transcript was read, but it contained no importable latest course records.</p>'
                            + renderImportIssueSections({
                                invalidGradeCourses: parserInvalidGrades,
                                supersededCourses: parserSuperseded,
                                skippedCourses: parserSkipped
                            });
                        const title = parserInvalidGrades.length ? 'Grades need review' : 'No importable courses';
                        if (ui && typeof ui.alert === 'function') await ui.alert(title, body);
                        else await uiAlert(title, body);
                        return;
                    }
                    if (ui && typeof ui.alert === 'function') {
                        await ui.alert(
                            'No courses detected',
                            '<p>The file was read successfully, but no courses were detected.</p>' +
                            '<p>Make sure you upload the correct document:</p>' +
                            '<ol>' +
                            '<li>SUIS → Student → Student Records → Academic Transcript</li>' +
                            '<li>Open <strong>Academic Records Summary</strong> (not Degree Evaluation)</li>' +
                            '<li>Save as <strong>HTML</strong> (preferred) or print to <strong>PDF</strong></li>' +
                            '</ol>' +
                            '<p><strong>Important:</strong> Some PDFs created using <strong>Microsoft Print to PDF</strong> may not import correctly. If this happens, re-export the same page using <strong>Save as PDF</strong> (recommended) or save as <strong>HTML</strong> instead.</p>' +
                            '<p>If you are importing a <strong>YÖK Transcript PDF</strong>, ensure it is the “NOT DÖKÜM BELGESİ” format.</p>'
                        );
                    } else {
                        await uiAlert('No courses detected', '<p>No courses were detected in this file.</p>');
                    }
                } catch (_) {}
                return;
            }

            // Import courses to curriculum. The parser returns an object
            // containing both statistics and a list of pending custom
            // courses that need additional user input.
            // Load the catalog-independent identity index on demand. The
            // synchronous importer can then retain real courses that are only
            // missing because program/admit-term settings are incomplete.
            try {
                if (typeof window.loadCoursePageInfoIndex === 'function') {
                    await window.loadCoursePageInfoIndex();
                }
            } catch (_) {}
            const importStorage = (typeof window !== 'undefined') ? window.planStorage : null;
            let importCheckpoint = null;
            try {
                if (!importStorage
                    || typeof importStorage.captureCheckpoint !== 'function'
                    || typeof importStorage.restoreCheckpoint !== 'function'
                    || typeof importStorage.flushSaves !== 'function') {
                    throw new Error('Plan checkpoint storage is unavailable.');
                }
                // A transcript parse can begin while a grade/course/term edit
                // is still inside the autosave debounce. Make that live state
                // durable before capturing the rollback point; otherwise a
                // later import-save failure could restore an older snapshot
                // and silently discard the edit made just before importing.
                if (importStorage.flushSaves({ onlyIfPending: true }) === false) {
                    throw new Error('Pending planner changes could not be saved.');
                }
                importCheckpoint = importStorage.captureCheckpoint(_planIdForSession || undefined);
            } catch (checkpointError) {
                await uiAlert(
                    'Import could not start',
                    '<p>SUrriculum could not save and checkpoint your current plan. Nothing was imported.</p>'
                );
                return;
            }

            const importResult = window.academicRecordsParser.importParsedCourses(
                parsedData.courses,
                course_data,
                curriculum
            );

            const importStats = importResult.stats;
            const pendingList = importResult.pendingCustomCourses || [];

            if (importStats) {
                const mergeParserIssues = (field, issues) => {
                    if (!issues.length) return;
                    if (!Array.isArray(importStats[field])) importStats[field] = [];
                    importStats[field].push(...issues);
                };
                mergeParserIssues('invalidGradeCourses', parserInvalidGrades);
                mergeParserIssues('supersededCourses', parserSuperseded);
                mergeParserIssues('skippedCourses', parserSkipped);
                if (parsedData && Number.isFinite(Number(parsedData.detectedRecords))) {
                    importStats.totalRecords = Number(parsedData.detectedRecords);
                }
                importStats.updatedCourseCount = Array.isArray(importStats.updatedCourses)
                    ? importStats.updatedCourses.length : Number(importStats.updatedCourseCount || 0);
                importStats.changedCourses = Number(importStats.importedCourses || 0) + importStats.updatedCourseCount;
            }

            const ui = (typeof window !== 'undefined') ? window.uiModal : null;
            if (!importStats || typeof importStats.importedCourses !== 'number') {
                if (ui && typeof ui.alert === 'function') {
                    await ui.alert('Import failed', '<p>Import did not return results.</p>');
                } else {
                    await uiAlert('Import failed', '<p>Import did not return results.</p>');
                }
                return;
            }

            const changedCourses = Number(importStats.changedCourses || 0);
            const issueSections = renderImportIssueSections(importStats);
            const alreadyPresentCount = Array.isArray(importStats.alreadyPresentCourses)
                ? importStats.alreadyPresentCourses.length : 0;

            if (changedCourses > 0) {
                let saved = false;
                try {
                    const requested = typeof importStorage.requestSave === 'function'
                        && importStorage.requestSave();
                    saved = !!requested
                        && typeof importStorage.flushSaves === 'function'
                        && importStorage.flushSaves() !== false;
                } catch (_) {
                    saved = false;
                }
                if (!saved) {
                    let restored = false;
                    try {
                        // Prevent pagehide/visibility handlers from retrying a
                        // failed live snapshot after the known-good checkpoint
                        // has been put back.
                        if (typeof importStorage.suspendSaves === 'function') {
                            importStorage.suspendSaves();
                        }
                        restored = importStorage.restoreCheckpoint(importCheckpoint) !== false;
                    } catch (_) {
                        restored = false;
                    }
                    await uiAlert(
                        'Import was not saved',
                        restored
                            ? '<p>Browser storage rejected the imported changes. Your previous plan was restored and will now be reloaded.</p>'
                            : '<p>Browser storage rejected the imported changes and the previous checkpoint could not be fully restored. Reload the page before making more changes, then restore a recent plan export if anything is missing.</p>'
                    );
                    location.reload();
                    return;
                }
            }

            if (changedCourses === 0) {
                const body = (
                    `<p>${alreadyPresentCount ? 'No plan changes were needed.' : 'No courses were added or updated.'}</p>` +
                    `<p>Detected <strong>${importStats.totalRecords || importStats.totalCourses || 0}</strong> transcript record(s).</p>` +
                    issueSections +
                    (!alreadyPresentCount
                        ? '<p>Check that the selected major/double major and admit terms match this transcript. Verify the relevant dates in <strong>SUIS → Student Records → General Student Information</strong>.</p>'
                        : '')
                );
                const title = alreadyPresentCount ? 'Import complete' : 'No courses imported';
                if (ui && typeof ui.alert === 'function') await ui.alert(title, body);
                else await uiAlert(title, body);
                return;
            }

            const updatedCount = Number(importStats.updatedCourseCount || 0);
            const messageHtml = `<p>Added <strong>${importStats.importedCourses}</strong> new course(s) and updated <strong>${updatedCount}</strong> existing course(s).</p>${renderImportChangeSections(importStats)}${issueSections}`;
            if (ui && typeof ui.alert === 'function') await ui.alert('Import complete', messageHtml);
            else await uiAlert('Import complete', messageHtml);

            // Reminder: program/admit-term selections are not inferred from the transcript.
            try {
                const reminderTitle = 'Reminder: choose your programs & admit terms';
                const reminderBody =
                    '<p>SUrriculum does <strong>not</strong> automatically detect your <strong>major</strong>, <strong>double major</strong>, <strong>minor(s)</strong>, or their <strong>admit terms</strong> from the imported file.</p>' +
                    '<p>Please double-check the sidebar selections so the requirements match your catalog:</p>' +
                    admitTermPolicyListHtml +
                    admitTermVerificationHtml +
                    '<p>If these are wrong, your graduation/summary results can look incorrect.</p>';
                if (ui && typeof ui.alert === 'function') await ui.alert(reminderTitle, reminderBody);
                else await uiAlert(reminderTitle, reminderBody);
            } catch (_) {}

            // If there are pending custom courses, process them
            if (pendingList.length > 0) {
                const queue = pendingList.slice();
                processPendingCustomCourses(queue);
            }
            const importDropdown = document.getElementById('importDropdown');
            if (importDropdown) importDropdown.classList.remove('active');
        } else {
            const ui = (typeof window !== 'undefined') ? window.uiModal : null;
            if (ui && typeof ui.alert === 'function') {
                await ui.alert('Select a file', '<p>Please select an <strong>Academic Records Summary</strong> HTML/PDF file (or a YÖK Transcript PDF) and try again.</p>');
            } else {
                await uiAlert('Select a file', '<p>Please select a file and try again.</p>');
            }
        }
    }
    document.getElementById('importAcademicRecords').onclick = handleAcademicRecordsImport;

    // Add event listener for the import toggle button
    document.querySelector('.import-toggle').addEventListener('click', function() {
        const dropdown = document.getElementById('importDropdown');
        if (dropdown) dropdown.classList.toggle('active');
    });

    // Mobile header menu: collapse header actions into a single button.
    (() => {
        const controls = document.getElementById('headerControls');
        const more = document.getElementById('headerMore');
        if (!controls || !more) return;

        const close = () => {
            try { controls.classList.remove('is-open'); } catch (_) {}
            try { more.setAttribute('aria-expanded', 'false'); } catch (_) {}
        };
        const toggle = (e) => {
            try { if (e && typeof e.stopPropagation === 'function') e.stopPropagation(); } catch (_) {}
            const isOpen = controls.classList.contains('is-open');
            if (isOpen) close();
            else {
                try { controls.classList.add('is-open'); } catch (_) {}
                try { more.setAttribute('aria-expanded', 'true'); } catch (_) {}
            }
        };

        more.addEventListener('click', toggle);
        document.addEventListener('click', (e) => {
            try {
                if (!controls.contains(e.target)) close();
            } catch (_) {
                close();
            }
        });
        document.addEventListener('keydown', (e) => {
            if (e && e.key === 'Escape') close();
        });
        window.addEventListener('resize', () => {
            try {
                if ((window.innerWidth || 9999) > 640) close();
            } catch (_) {}
        }, { passive: true });
    })();

    // Close import panel when clicking outside
    document.addEventListener('click', function(e) {
        const dropdown = document.getElementById('importDropdown');
        const toggle = document.querySelector('.import-toggle');

        if (dropdown && dropdown.classList.contains('active') &&
            !dropdown.contains(e.target) &&
            !toggle.contains(e.target)) {
            dropdown.classList.remove('active');
        }
    });
    document.addEventListener('keydown', function(e) {
        const dropdown = document.getElementById('importDropdown');
        const toggle = document.querySelector('.import-toggle');
        if (!dropdown || !toggle || e.key !== 'Escape'
            || !dropdown.classList.contains('active')) return;
        e.preventDefault();
        dropdown.classList.remove('active');
        try { toggle.focus({ preventScroll: true }); } catch (_) {}
    });


    // At the end of initialization, if there is a saved double major in
    // localStorage, activate it.  This ensures the double major's
    // course categories are recalculated and displayed after the page
    // reloads.  We also update the select element's value to reflect
    // the stored double major choice.
    try {
        const savedDMInit = planGetItem('doubleMajor') || '';
        const dmSelect = document.querySelector('.doubleMajor');
        if (dmSelect && dmSelect.tagName === 'SELECT') {
            dmSelect.value = savedDMInit;
        }
        if (savedDMInit) {
            // setDoubleMajor expects uppercase codes
            await setDoubleMajor(savedDMInit.toUpperCase());
        }
    } catch (e) {
        // ignore
    }

    // Startup guidance waits for the visible plan and its program context to
    // finish loading. Consumers use a sticky flag as well as the event so a
    // listener registered late in this same script cannot miss readiness.
    try {
        window.__surriculumReady = true;
        document.dispatchEvent(new CustomEvent('surriculum:ready'));
    } catch (_) {}

    //END OF PROGRAM
    })
    .catch(error => {
        console.error(error);
    });
}

let major_existing = planGetItem("major");
if (major_existing) {SUrriculum(major_existing);}
else {SUrriculum(initial_major_chosen);}

// User-facing guide. This is initialized outside the curriculum data-loading
// promise so help remains available even if a catalog request fails.
(() => {
    const opener = document.getElementById('openHelpInfoButton');
    const admitTermOpener = document.getElementById('openAdmitTermHelpButton');
    if (!opener && !admitTermOpener) return;

    const releaseVersion = String(
        (typeof window !== 'undefined' && window.APP_VERSION) || '3.1'
    ).trim() || '3.1';
    const onboardingKeys = Object.freeze({
        cohort: 'onboardingCohort',
        helpSeen: 'onboardingHelpSeen',
        lastSeenRelease: 'onboardingLastSeenRelease',
    });
    const sessionPrefix = 'surriculum.session.';
    let startupPromptHandled = false;

    const readOnboardingValue = (key) => {
        const stored = preferenceGetItem(key);
        if (stored !== null) return stored;
        try { return sessionStorage.getItem(sessionPrefix + key); } catch (_) {}
        return null;
    };

    const writeOnboardingValue = (key, value) => {
        if (preferenceSetItem(key, value)) {
            try { sessionStorage.removeItem(sessionPrefix + key); } catch (_) {}
            return true;
        }
        try {
            sessionStorage.setItem(sessionPrefix + key, String(value));
            return true;
        } catch (_) {}
        return false;
    };

    const parseReleaseVersion = (value) => {
        const match = String(value || '').trim().match(/^(\d+)\.(\d+)(?:\.(\d+))?$/);
        if (!match) return null;
        return [Number(match[1]), Number(match[2]), Number(match[3] || 0)];
    };

    const compareReleaseVersions = (left, right) => {
        const a = parseReleaseVersion(left);
        const b = parseReleaseVersion(right);
        if (!a || !b) return null;
        for (let index = 0; index < 3; index++) {
            if (a[index] > b[index]) return 1;
            if (a[index] < b[index]) return -1;
        }
        return 0;
    };

    const initializeOnboardingCohort = () => {
        const existing = String(readOnboardingValue(onboardingKeys.cohort) || '').trim();
        if (/^(?:pre-)?\d+\.\d+(?:\.\d+)?$/.test(existing)) return existing;

        let firstRunEver = false;
        try {
            firstRunEver = !!(
                window.storageSchemaInfo && window.storageSchemaInfo.firstRunEver === true
            );
        } catch (_) {}
        const cohort = firstRunEver ? releaseVersion : `pre-${releaseVersion}`;
        writeOnboardingValue(onboardingKeys.cohort, cohort);
        return cohort;
    };

    const onboardingCohort = initializeOnboardingCohort();
    const releaseAlreadySeen = () => {
        const comparison = compareReleaseVersions(
            readOnboardingValue(onboardingKeys.lastSeenRelease),
            releaseVersion,
        );
        return comparison !== null && comparison >= 0;
    };
    const acknowledgeRelease = () => {
        // A cached older app can run after a newer tab has already recorded a
        // later release. Never let that older build move the shared marker
        // backwards (and repair malformed markers with the current version).
        if (!parseReleaseVersion(releaseVersion)) return false;
        const comparison = compareReleaseVersions(
            readOnboardingValue(onboardingKeys.lastSeenRelease),
            releaseVersion,
        );
        if (comparison !== null && comparison >= 0) return true;
        return writeOnboardingValue(onboardingKeys.lastSeenRelease, releaseVersion);
    };
    const acknowledgeHelp = () => {
        writeOnboardingValue(onboardingKeys.helpSeen, 'true');
        acknowledgeRelease();
    };

    const helpGuideHtml = `
        <div class="help-info-guide" id="helpInfoGuide">
            <div class="help-info-disclaimer" id="helpInfoDisclaimer" role="note" aria-label="Important disclaimer">
                <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                <div>
                    <strong>Always verify the graduation requirements yourself using official sources.</strong>
                    SUrriculum is a planning aid, not an official university record or a guarantee of
                    course eligibility, availability, substitution approval, or graduation. Confirm your
                    program and admit-term requirements in official sources and verify the relevant dates in
                    SUIS → Student Records → General Student Information. Verify the final result in SUIS as well.
                </div>
            </div>

            <div class="help-info-layout">
                <nav class="help-info-nav" aria-label="Help topics">
                    <a class="help-info-nav-link" href="#help-getting-started">Getting started</a>
                    <a class="help-info-nav-link" href="#help-planner">Using the planner</a>
                    <a class="help-info-nav-link" href="#help-scheduler">Building a schedule</a>
                    <a class="help-info-nav-link" href="#help-progress">Progress &amp; credits</a>
                    <a class="help-info-nav-link" href="#help-data">Plans, imports &amp; privacy</a>
                    <a class="help-info-nav-link" href="#help-about">Contact &amp; credits</a>
                </nav>

                <div class="help-info-content">
                    <section class="help-info-section" id="help-getting-started" aria-labelledby="help-getting-started-title">
                        <h4 id="help-getting-started-title" tabindex="-1">Getting started</h4>
                        <ol>
                            <li><strong>Choose your programs and admit terms</strong> in Controls. Select a main major, then add a double major or up to three minors if needed. Each program has its own admit term because its catalog rules can differ.</li>
                            <li><strong>Add your academic record.</strong> You can import an Academic Records Summary from the header, or create semesters and add courses manually. Review imported courses, grades, terms, and any requested custom classifications.</li>
                            <li><strong>Build the rest of your plan.</strong> Add a semester, choose its academic term, and use Add course on that semester. Open Progress or Summary as you make changes.</li>
                            <li><strong>Back up the plan.</strong> Use the plan menu's Export action after important edits, especially before clearing browser data or moving to another device.</li>
                        </ol>
                        <div class="help-info-tip admit-term-help-summary">
                            <strong>Admit-term reminder</strong>
                            ${admitTermGuidanceHtml}
                        </div>
                        <h5>Mobile use</h5>
                        <p>Use the bottom Planner, Scheduler, Progress, and Controls tabs. The Planner shows the newest term first and keeps New Semester at the top. It works best in portrait, while the weekly Scheduler has more room in landscape. Course drag and move actions are desktop-only; on mobile, remove and re-add a course in its destination term or replace that term from the Scheduler.</p>
                    </section>

                    <section class="help-info-section" id="help-planner" aria-labelledby="help-planner-title">
                        <h4 id="help-planner-title" tabindex="-1">Using the planner</h4>
                        <h5>Add and find courses</h5>
                        <p>Use Add course inside the destination semester and search by code or title. Open Filters beside the search field to narrow by program, category, level, credits, exact-semester offering, already-planned status, or course requirements. Controls → Course picker defaults sets the initial detail, planned-course, offered-only, and sorting choices for newly opened pickers. In the Planner, Hide courses planned in this or earlier semesters removes courses present in the destination semester or an academically earlier semester; courses planned only later remain visible. Offered-only can then be changed for one semester without changing the default or another open picker. “The semester” means the destination card's saved academic term, not the current date or visual card order.</p>

                        <h5>Understand chronology</h5>
                        <p>A semester's saved academic term code is the source of truth for prerequisite checks, retakes, current-term state, and progress calculations. Dragging semester cards only changes their visual order. Sort Semesters restores chronological display.</p>

                        <h5>Read planning warnings</h5>
                        <p>Prerequisite and prior-SU checks look at academically earlier semesters, with same-term work used only when a rule explicitly allows concurrency. Offering-history labels such as No Fall offerings found or Not offered every year describe recorded history. Workload, prerequisite, and offering warnings are advisory: they do not block an approved exception and do not prove future availability or enrollment eligibility.</p>

                        <h5>Move, retake, and classify courses</h5>
                        <p>On desktop, drag courses between semesters or use the move action. On mobile, remove the course and add it to the destination term, or replace that term from the Scheduler. If you add an existing course to a later eligible term, the planner can ask whether you are planning a retake before replacing its earlier planned entry. This is a simplified plan representation: it removes the earlier planner card, while an official transcript continues to retain recorded attempts. Use a custom course only for a missing course or placeholder. Any category you assign to a custom course is a planning assumption and should match an approved substitution or official classification.</p>
                    </section>

                    <section class="help-info-section" id="help-scheduler" aria-labelledby="help-scheduler-title">
                        <h4 id="help-scheduler-title" tabindex="-1">Building a schedule</h4>
                        <ol>
                            <li>Open Scheduler and choose the academic term you want to arrange.</li>
                            <li>Search for courses, expand a course, and select a section bundle. Labs and recitations stay bundled with their main course where the schedule data identifies that relationship.</li>
                            <li>Use prerequisite checks, the Hide courses planned before the selected term filter, Smart Sort, availability highlighting, and blocked-hour controls as needed. Inspect the weekly grid for highlighted conflicts.</li>
                            <li>Copy CRNs when you are ready to register. The scheduler does not register courses for you.</li>
                            <li><strong>Update planner semester replaces the matching term's planned main courses</strong> with the scheduler selection. Lab and recitation rows are not added as separate planner courses, so review the confirmation before applying it.</li>
                        </ol>
                        <p>A scheduler course that is not listed in your selected undergraduate catalogs is kept in the plan as unallocated N/A. It remains visible and contributes to semester workload, but it does not satisfy a graduation category. Any approved substitution must be represented and verified separately.</p>
                    </section>

                    <section class="help-info-section" id="help-progress" aria-labelledby="help-progress-title">
                        <h4 id="help-progress-title" tabindex="-1">Progress &amp; credits</h4>
                        <h5>Check versus Summary</h5>
                        <p>Check Graduation gives a high-level result. Summary shows how each selected major or minor is calculated, including earned work, the current term, future plans, courses needing a grade, unsuccessful attempts, and unmet requirements. Planned courses can make a program Projected complete; only earned results can be Complete.</p>

                        <h5>SU, ECTS, and requirement credits</h5>
                        <p><strong>SU credits</strong> drive semester workload and the SU-credit requirements named by a curriculum. <strong>ECTS</strong> is tracked separately for requirements and mobility contexts that use it. Basic Science and Engineering values describe how part of a course can count toward those requirement pools; they are not extra SU credits. A course marked N/A can still appear in overall workload and, with a valid letter grade, overall CGPA, while contributing nothing to that program's graduation categories or PGPA.</p>

                        <h5>How allocation works</h5>
                        <p>Courses are allocated using the selected program, its admit-term catalog, requirement groups, grades, and the course's effective category. Main-major, double-major, and minor summaries can therefore count the same course differently. Estimated class level uses earned SU credits only. Treat every result as an explanation of the current plan—not an official degree evaluation.</p>
                    </section>

                    <section class="help-info-section" id="help-data" aria-labelledby="help-data-title">
                        <h4 id="help-data-title" tabindex="-1">Plans, imports &amp; privacy</h4>
                        <h5>Saved plans</h5>
                        <p>The plan menu supports multiple named plans and their Export and Import actions. Exported plan files are the portable backup: data does not automatically sync between browsers or devices.</p>

                        <h5>Transcript imports</h5>
                        <p>For the most reliable import, open SUIS Academic Records Summary and save it as Webpage, Complete; a readable browser-generated PDF is also supported. A YÖK transcript is available as a less-preferred alternative. Always review the detected terms, grades, and unresolved courses before relying on the result.</p>

                        <h5>Where your data lives</h5>
                        <p>Transcript files are parsed in your browser and are not uploaded by SUrriculum. Plans, grades, custom courses, preferences, and scheduler selections are stored in this site's browser storage. SUrriculum has no account, runtime analytics, telemetry, or server-side plan storage. The service worker may cache the application and public catalog data for offline use.</p>
                        <p class="help-info-tip"><strong>Before resetting:</strong> export every plan you need. Reset Local Data removes SUrriculum's saved plans and settings from this browser and cannot sync them back from another device.</p>
                    </section>

                    <section class="help-info-section" id="help-about" aria-labelledby="help-about-title">
                        <h4 id="help-about-title" tabindex="-1">Contact &amp; project credits</h4>
                        <p>For issues you spot, send an e-mail to <a href="mailto:bilal.gebenoglu@sabanciuniv.edu">bilal.gebenoglu@sabanciuniv.edu</a>.</p>
                        <p>This repository started as a fork of the <a href="https://github.com/melih-kiziltoprak/surriculum" target="_blank" rel="noopener noreferrer">original Surriculum project<span class="sr-only"> (opens in a new tab)</span></a>.</p>
                        <p>Maintained by <strong>BEFICENT (Bilal M. G.)</strong> with major additions including double major support, Data Science and Analytics and several FASS programs, a large UI overhaul, updated course lists, improved requirement checks, multi-plan support, minor support, and the term-selectable scheduler.</p>
                        <p>View the <a href="https://github.com/BEFICENT/surriculum" target="_blank" rel="noopener noreferrer">current source code<span class="sr-only"> (opens in a new tab)</span></a>. SUrriculum is licensed under the <a href="https://github.com/BEFICENT/surriculum/blob/main/LICENSE" target="_blank" rel="noopener noreferrer">GNU General Public License v3.0<span class="sr-only"> (opens in a new tab)</span></a>.</p>
                    </section>
                </div>
            </div>
        </div>`;

    const openHelpInformation = (options) => {
        const opts = options || {};
        const ui = (typeof window !== 'undefined') ? window.uiModal : null;
        if (!ui || typeof ui.alert !== 'function') return Promise.resolve(null);

        startupPromptHandled = true;
        acknowledgeHelp();

        return ui.alert('Help & information', helpGuideHtml, {
            buttons: [{ action: 'close', label: 'Close', variant: 'primary' }],
            onMount: ({ overlay, modal, body }) => {
                overlay.classList.add('help-info-overlay');
                modal.classList.add('help-info-modal');
                body.classList.add('help-info-modal-body');
                if (opts.firstRun === true) {
                    overlay.classList.add('help-info-first-run');
                    modal.classList.add('help-info-first-run');
                }
                // Describing a dialog with this entire long guide would make
                // screen readers announce every section as soon as it opens.
                if (opts.firstRun === true) {
                    overlay.setAttribute('aria-describedby', 'helpInfoDisclaimer');
                } else {
                    overlay.removeAttribute('aria-describedby');
                }

                body.querySelectorAll('.help-info-nav-link').forEach((link) => {
                    link.addEventListener('click', (event) => {
                        const targetId = link.getAttribute('href');
                        const target = targetId ? body.querySelector(targetId) : null;
                        if (!target) return;
                        event.preventDefault();
                        const heading = target.querySelector('h4');
                        let behavior = 'smooth';
                        try {
                            if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) behavior = 'auto';
                        } catch (_) {}
                        target.scrollIntoView({ behavior, block: 'start' });
                        try { if (heading) heading.focus({ preventScroll: true }); } catch (_) {}
                    });
                });
            }
        });
    };

    const openAdmitTermInformation = () => {
        const ui = (typeof window !== 'undefined') ? window.uiModal : null;
        if (!ui || typeof ui.alert !== 'function') return Promise.resolve(null);
        return ui.alert(
            'What is an admit term?',
            `<div class="admit-term-help-guide" id="admitTermHelpGuide">${admitTermGuidanceHtml}</div>`,
            {
                buttons: [{ action: 'close', label: 'Close', variant: 'primary' }],
                onMount: ({ overlay, modal, body }) => {
                    overlay.classList.add('admit-term-help-overlay');
                    modal.classList.add('admit-term-help-modal');
                    body.classList.add('admit-term-help-modal-body');
                },
            }
        );
    };

    if (opener) opener.addEventListener('click', () => { openHelpInformation(); });
    if (admitTermOpener) {
        admitTermOpener.addEventListener('click', () => { openAdmitTermInformation(); });
    }
    window.openHelpInformation = openHelpInformation;
    window.openAdmitTermInformation = openAdmitTermInformation;

    // Release copy is deliberately registered by its exact app version. A
    // version bump without a matching entry must stay quiet instead of putting
    // the previous release's notes under a new, misleading heading.
    const releaseAnnouncements = Object.freeze({
        '3.1': Object.freeze({
            title: 'What’s new in SUrriculum 3.1',
            html: `
                <div class="release-update-guide">
                    <p class="release-update-lead">Version 3.1 focuses on clearer progress and safer planning.</p>
                    <ul class="release-update-list">
                        <li><strong>Progress and Summary are clearer.</strong> Earned, current, and future work are separated, with better degree, CGPA/PGPA, and class-level explanations.</li>
                        <li><strong>Planner and Scheduler checks are term-aware.</strong> Offerings, prerequisites, prior-credit guidance, filters, and warnings follow each semester's saved academic term.</li>
                        <li><strong>Everyday planning is more reliable.</strong> Imports, custom and external courses, retakes, saved plans, offline use, and course or semester movement have stronger safeguards.</li>
                    </ul>
                    <p class="release-update-note"><strong>Reminder:</strong> SUrriculum remains a planning aid. Verify requirements, eligibility, substitutions, and course availability in official sources.</p>
                </div>`,
        }),
    });
    const releaseAnnouncement = Object.prototype.hasOwnProperty.call(
        releaseAnnouncements,
        releaseVersion,
    ) ? releaseAnnouncements[releaseVersion] : null;

    const openReleaseUpdate = async () => {
        const ui = (typeof window !== 'undefined') ? window.uiModal : null;
        if (!releaseAnnouncement || !ui || typeof ui.alert !== 'function') return;

        startupPromptHandled = true;
        // Showing the dialog counts as delivery even when it is dismissed with
        // Escape, the close button, or the backdrop. This prevents a startup
        // notice from becoming a recurring obstacle.
        acknowledgeRelease();
        const result = await ui.alert(releaseAnnouncement.title, releaseAnnouncement.html, {
            buttons: [
                { action: 'help', label: 'Open Help', variant: 'secondary' },
                { action: 'continue', label: 'Continue', variant: 'primary' },
            ],
            onMount: ({ overlay, modal, body }) => {
                overlay.classList.add('release-update-overlay');
                modal.classList.add('release-update-modal');
                body.classList.add('release-update-modal-body');
            },
        });
        if (result && result.action === 'help') {
            setTimeout(() => { openHelpInformation(); }, 0);
        }
    };

    const showStartupInformation = () => {
        if (startupPromptHandled) return;
        if (releaseAlreadySeen()) {
            startupPromptHandled = true;
            return;
        }

        const isFreshCohort = onboardingCohort === releaseVersion;
        const helpSeen = readOnboardingValue(onboardingKeys.helpSeen) === 'true';
        if (isFreshCohort) {
            if (!helpSeen) {
                openHelpInformation({ firstRun: true });
            } else {
                // A partially written first-run acknowledgement should not turn
                // into a misleading upgrade announcement on the next load.
                startupPromptHandled = true;
                acknowledgeRelease();
            }
            return;
        }
        if (!releaseAnnouncement) {
            startupPromptHandled = true;
            return;
        }
        openReleaseUpdate();
    };

    const queueStartupInformation = () => {
        const tryOpen = () => {
            if (startupPromptHandled) return;
            // A migration, custom-course review, or critical error dialog gets
            // priority. The startup message waits until the modal stack clears.
            if (document.querySelector('[role="dialog"][aria-modal="true"]')) {
                setTimeout(tryOpen, 250);
                return;
            }
            showStartupInformation();
        };
        setTimeout(tryOpen, 0);
    };

    document.addEventListener('surriculum:ready', queueStartupInformation, { once: true });
    if (window.__surriculumReady === true) queueStartupInformation();
})();

// Mobile UX helper: show a small banner in portrait mode on small screens.
(() => {
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
})();
