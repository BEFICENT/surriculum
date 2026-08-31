// Selected-catalog picker projection, course-page metadata, offering history,
// global-definition hydration, and derived instructor/section indexes. Kept
// together so course metadata and the large JSONL promise caches remain shared.
(function installCourseMetadata(root) {
    'use strict';

    // Build the selected-program course candidates consumed by the Planner's
    // Add Course controls. Global catalog definitions are recovery metadata,
    // not planning choices, so they must never appear here.
    function getCoursesList(course_data) {
        let combined = Array.isArray(course_data)
            ? course_data
                .filter(c => !(c && c.__globalCourseDefinition))
                .map(record => ({ record, source: 'main' }))
            : [];
        const mainSet = new Set(combined.map(candidate => (
            candidate.record.Major + candidate.record.Code
        )));
        try {
            const cur = root && root.curriculum ? root.curriculum : null;
            if (cur && cur.doubleMajor && Array.isArray(cur.doubleMajorCourseData)) {
                cur.doubleMajorCourseData.forEach(dm => {
                    if (dm && dm.__globalCourseDefinition) return;
                    const key = dm.Major + dm.Code;
                    if (!mainSet.has(key)) {
                        combined.push({ record: dm, source: 'doubleMajor' });
                        mainSet.add(key);
                    }
                });
            }
            if (cur && Array.isArray(cur.minors) && cur.minors.length
                && cur.minorCourseDataByCode) {
                cur.minors.forEach(minorCode => {
                    const list = cur.minorCourseDataByCode[minorCode];
                    if (!Array.isArray(list)) return;
                    list.forEach(mc => {
                        if (mc && mc.__globalCourseDefinition) return;
                        const key = mc.Major + mc.Code;
                        if (!mainSet.has(key)) {
                            combined.push({ record: mc, source: 'minor' });
                            mainSet.add(key);
                        }
                    });
                });
            }
            if (root && root.hideTakenCourses && cur
                && typeof cur.hasCourse === 'function') {
                combined = combined.filter(candidate => (
                    !cur.hasCourse(candidate.record.Major + candidate.record.Code)
                ));
            }
            // DSA210 and the former CS210 are equivalent for picker purposes.
            if (cur && typeof cur.hasCourse === 'function' && cur.hasCourse('DSA210')) {
                const norm = (value) => String(value || '').toUpperCase().replace(/\s+/g, '');
                combined = combined.filter(candidate => (
                    norm(candidate.record.Major + candidate.record.Code) !== 'CS210'
                ));
            }
        } catch (_) {}

        return combined.map(candidate => {
            const item = candidate.record;
            const code = item.Major + item.Code;
            const name = item.Course_Name;
            const mainType = candidate.source === 'main' ? (item.EL_Type || '') : '';
            let dmType = '';
            try {
                const cur = root && root.curriculum ? root.curriculum : null;
                if (cur && cur.doubleMajor && Array.isArray(cur.doubleMajorCourseData)) {
                    const dmEntry = cur.doubleMajorCourseData.find(dm => (
                        dm.Major + dm.Code
                    ) === code);
                    if (dmEntry) dmType = dmEntry.EL_Type || '';
                }
            } catch (_) {}
            return {
                code,
                name,
                // Precompute search helpers once rather than on every keystroke.
                searchUpper: (code + ' ' + name).toUpperCase(),
                searchNoSpace: (code + name).toUpperCase().replace(/\s+/g, ''),
                credit: item.SU_credit || '0',
                bs: item.Basic_Science || '0',
                type: mainType,
                dmType,
            };
        });
    }

    // Lazy-load the cumulative course info index so we can check whether a course
    // has been offered in the current term. Current/future entries are reconciled
    // from the authoritative term schedules after every schedule refresh.
    function loadCurrentTermScheduleOfferings() {
        try {
            if (typeof window === 'undefined') return Promise.resolve(null);
            if (window.__currentTermScheduleOfferingsPromise) return window.__currentTermScheduleOfferingsPromise;
            window.__currentTermScheduleOfferingsPromise = (async () => {
                try {
                    const termCode = String(window.currentTermCode || '').trim();
                    if (!termCode || typeof window.loadTermScheduleIndex !== 'function') return null;
                    const scheduleIndex = await window.loadTermScheduleIndex(termCode);
                    if (!scheduleIndex || typeof scheduleIndex.keys !== 'function') return null;
                    if (typeof scheduleIndex.size === 'number' && scheduleIndex.size === 0) return null;
                    const offered = new Set(Array.from(scheduleIndex.keys(), code => String(code || '').replace(/\s+/g, '').toUpperCase()));
                    window.currentTermScheduledCourseIds = offered;
                    return offered;
                } catch (_) {
                    return null;
                }
            })();
            return window.__currentTermScheduleOfferingsPromise;
        } catch (_) {
            return Promise.resolve(null);
        }
    }

    // Datalist renderer. User-defined course names remain plain text and never
    // pass through the HTML parser.
    function populateCourseDataList(datalist, course_data)
    {
        if (!datalist || typeof document === 'undefined') return;
        datalist.replaceChildren();
        const fragment = document.createDocumentFragment();
        const options = getCoursesList(course_data);
        for (let i = 0; i < options.length; i++) {
            const item = options[i] || {};
            const text = String(item.code || '') + ' ' + String(item.name || '');
            const option = document.createElement('option');
            option.value = text;
            option.textContent = text;
            fragment.appendChild(option);
        }
        datalist.appendChild(fragment);
    }

    function loadCourseOfferingsIndex() {
        try {
            if (typeof window === 'undefined') return Promise.resolve(null);
            if (window.__courseOfferingsPromise) return window.__courseOfferingsPromise;

            window.__courseOfferingsPromise = (async () => {
                const schedulePromise = loadCurrentTermScheduleOfferings();
                const tryReadText = async () => {
                    const isFile = (() => {
                        try { return typeof location !== 'undefined' && location && location.protocol === 'file:'; } catch (_) { return false; }
                    })();

                    // Prefer async fetch for http/https (sync XHR blocks the UI thread).
                    try {
                        const res = await fetch('./courses/all_coursepage_info.jsonl');
                        if (res.ok) return await res.text();
                    } catch (_) {}

                    // Fall back to synchronous XHR under file:// where fetch may be blocked.
                    if (isFile) {
                        try {
                            const xhr = new XMLHttpRequest();
                            xhr.open('GET', './courses/all_coursepage_info.jsonl', false);
                            xhr.overrideMimeType('application/json');
                            xhr.send(null);
                            if (xhr.status === 200 || xhr.status === 0) return xhr.responseText;
                        } catch (_) {}
                    }
                    try {
                        // One more async attempt in case the first fetch was blocked by transient errors.
                        const res = await fetch('./courses/all_coursepage_info.jsonl', { cache: 'no-store' });
                        if (res.ok) return await res.text();
                    } catch (_) {}
                    return '';
                };

                const text = await tryReadText();
                try { window.__courseOfferingsJsonlText = text; } catch (_) {}
                const byCode = new Map();
                if (!text) {
                    window.courseOfferingsByCode = byCode;
                    await schedulePromise;
                    return byCode;
                }
                const lines = text.split(/\r?\n/);
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i] && lines[i].trim();
                    if (!line) continue;
                    try {
                        const obj = JSON.parse(line);
                        const id = obj && obj.course_id ? String(obj.course_id).replace(/\s+/g, '').toUpperCase() : '';
                        if (!id) continue;
                        const termsArr = Array.isArray(obj.last_offered_terms) ? obj.last_offered_terms : [];
                        const set = new Set();
                        for (let j = 0; j < termsArr.length; j++) {
                            const t = termsArr[j] && termsArr[j].term ? String(termsArr[j].term) : '';
                            if (t) set.add(t);
                        }
                        byCode.set(id, set);
                    } catch (_) {
                        // ignore malformed line
                    }
                }
                window.courseOfferingsByCode = byCode;
                await schedulePromise;
                return byCode;
            })();

            return window.__courseOfferingsPromise;
        } catch (_) {
            return Promise.resolve(null);
        }
    }
    if (typeof window !== 'undefined') {
        window.loadCourseOfferingsIndex = loadCourseOfferingsIndex;
        window.isCourseOfferedInCurrentTerm = function(code) {
            try {
                const ctName = window.currentTermName || '';
                const ctCode = window.currentTermCode || '';
                const normalizedCode = String(code || '').replace(/\s+/g, '').toUpperCase();
                const scheduled = window.currentTermScheduledCourseIds;
                if (scheduled && typeof scheduled.has === 'function') {
                    return scheduled.has(normalizedCode);
                }
                const idx = window.courseOfferingsByCode;
                if ((!ctName && !ctCode) || !idx) return true; // if unknown/unloaded, don't filter out
                const set = idx.get(normalizedCode) || null;
                if (!set) return true;
                return (ctCode && set.has(ctCode)) || (ctName && set.has(ctName));
            } catch (_) {
                return true;
            }
        };
    }

    // Normalize course codes at the boundary shared by the global course-page
    // index, transcript imports, and stored curricula. Keep this helper private so
    // it cannot collide with the plan importer's stricter code validator.
    function normalizeGlobalCourseDefinitionCode(value) {
        try {
            let raw = value;
            if (raw && typeof raw === 'object') {
                if (raw.code != null) raw = raw.code;
                else if (raw.course_id != null) raw = raw.course_id;
                else raw = String(raw.Major || '') + String(raw.Code || '');
            }
            return String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
        } catch (_) {
            return '';
        }
    }

    function globalCourseDefinitionNumber(value) {
        if (value === null || value === undefined || value === '') return null;
        const normalized = (typeof value === 'string') ? value.trim().replace(',', '.') : value;
        if (normalized === '') return null;
        const number = Number(normalized);
        return Number.isFinite(number) && number >= 0 ? number : null;
    }

    function globalCourseDefinitionText(value) {
        return (typeof value === 'string') ? value.trim().replace(/\s+/g, ' ') : '';
    }

    function globalCourseDefinitionOverrideValue(overrides, keys) {
        if (!overrides || typeof overrides !== 'object') return undefined;
        for (let i = 0; i < keys.length; i++) {
            const key = keys[i];
            if (Object.prototype.hasOwnProperty.call(overrides, key)) return overrides[key];
        }
        return undefined;
    }

    // Convert one all_coursepage_info row into the same shape used by program
    // catalogs. The marker deliberately distinguishes this internal fallback from
    // a real catalog/custom-course row, and `unknown` keeps it out of every
    // program requirement pool until a selected catalog supplies a real type.
    function catalogRecordFromGlobalCoursePageInfo(info, overrides) {
        if (!info || typeof info !== 'object') return null;

        const sourceCode = info.course_id ||
            (String(info.subj_code || info.parsed_subj_code || '') +
                String(info.crse_numb || info.parsed_crse_numb || ''));
        const normalizedCode = normalizeGlobalCourseDefinitionCode(sourceCode);
        const codeMatch = normalizedCode.match(/^([A-Z]{1,12})(\d[A-Z0-9]*)$/);
        if (!codeMatch) return null;

        const offered = Array.isArray(info.last_offered_terms) ? info.last_offered_terms : [];
        let offeredTitle = '';
        let offeredSuCredit = null;
        for (let i = 0; i < offered.length; i++) {
            const row = offered[i] || {};
            if (!offeredTitle) offeredTitle = globalCourseDefinitionText(row.course_name);
            if (offeredSuCredit === null) offeredSuCredit = globalCourseDefinitionNumber(row.su_credit);
            if (offeredTitle && offeredSuCredit !== null) break;
        }

        const overrideTitle = globalCourseDefinitionText(globalCourseDefinitionOverrideValue(
            overrides, ['title', 'Course_Name', 'courseName', 'course_name', 'name']
        ));
        const title = globalCourseDefinitionText(info.title) || offeredTitle || overrideTitle || normalizedCode;

        const pageSuCredit = globalCourseDefinitionNumber(info.su_credits);
        const overrideSuCredit = globalCourseDefinitionNumber(globalCourseDefinitionOverrideValue(
            overrides, ['suCredits', 'SU_credit', 'suCredit', 'su_credits']
        ));
        const suCredit = pageSuCredit !== null
            ? pageSuCredit : (offeredSuCredit !== null ? offeredSuCredit : (overrideSuCredit !== null ? overrideSuCredit : 0));

        const pageEcts = globalCourseDefinitionNumber(info.ects);
        const overrideEcts = globalCourseDefinitionNumber(globalCourseDefinitionOverrideValue(
            overrides, ['ects', 'ECTS']
        ));
        const ects = pageEcts !== null ? pageEcts : (overrideEcts !== null ? overrideEcts : 0);
        const engineering = globalCourseDefinitionNumber(info.engineering);
        const basicScience = globalCourseDefinitionNumber(info.basic_science);
        // `faculty` is catalog identity metadata from the hydrated scrape. It is
        // safe to carry across program contexts, unlike Faculty_Course membership,
        // which intentionally remains contextual and therefore defaults to No.
        const faculty = globalCourseDefinitionText(info.faculty).toUpperCase();

        return {
            Major: codeMatch[1],
            Code: codeMatch[2],
            Course_Name: title,
            ECTS: String(ects),
            Engineering: engineering !== null ? engineering : 0,
            Basic_Science: basicScience !== null ? basicScience : 0,
            SU_credit: String(suCredit),
            Faculty: faculty,
            Faculty_Course: 'No',
            EL_Type: 'unknown',
            __globalCourseDefinition: true
        };
    }

    // Synchronous by design: callers which already loaded the index can resolve a
    // single definition without another promise boundary. Use
    // appendGlobalCourseDefinitions for the lazy-loading batch path.
    function resolveGlobalCourseDefinition(code, overrides) {
        try {
            if (typeof window === 'undefined') return null;
            const normalizedCode = normalizeGlobalCourseDefinitionCode(code);
            if (!normalizedCode) return null;
            const index = window.coursePageInfoByCode;
            if (!index || typeof index.get !== 'function') return null;
            return catalogRecordFromGlobalCoursePageInfo(index.get(normalizedCode), overrides);
        } catch (_) {
            return null;
        }
    }

    const GLOBAL_COURSE_METADATA_STORAGE_KEY = 'globalCourseMetadata';

    function getPlanStorageSessionId(storage) {
        try {
            if (storage && typeof storage.getSessionPlanId === 'function') {
                return storage.getSessionPlanId() || null;
            }
        } catch (_) {}
        return null;
    }

    function globalCourseMetadataFromRecord(record) {
        if (!record || typeof record !== 'object') return null;
        const code = normalizeGlobalCourseDefinitionCode(record);
        if (!/^([A-Z]{1,12})(\d[A-Z0-9]*)$/.test(code)) return null;
        const title = globalCourseDefinitionText(globalCourseDefinitionOverrideValue(
            record, ['title', 'Course_Name', 'courseName', 'course_name', 'name']
        )) || code;
        const suCredits = globalCourseDefinitionNumber(globalCourseDefinitionOverrideValue(
            record, ['suCredits', 'SU_credit', 'suCredit', 'su_credits']
        ));
        const ects = globalCourseDefinitionNumber(globalCourseDefinitionOverrideValue(
            record, ['ects', 'ECTS']
        ));
        return {
            code,
            title,
            suCredits: suCredits !== null ? suCredits : 0,
            ects: ects !== null ? ects : 0
        };
    }

    // Keep a small, plan-scoped metadata snapshot for globally resolved transcript
    // courses. The shipped index remains authoritative; this snapshot only fills
    // missing fields and prevents a transient index failure from changing credits
    // or erasing the saved occurrence on the next reload.
    function getStoredGlobalCourseMetadata() {
        const byCode = new Map();
        try {
            const ps = (typeof window !== 'undefined') ? window.planStorage : null;
            let raw = null;
            if (ps && typeof ps.getItem === 'function') {
                const planId = getPlanStorageSessionId(ps);
                if (!planId) return byCode;
                try { raw = ps.getItem(GLOBAL_COURSE_METADATA_STORAGE_KEY, planId); } catch (_) { return byCode; }
            } else {
                try { raw = localStorage.getItem(GLOBAL_COURSE_METADATA_STORAGE_KEY); } catch (_) {}
            }
            const parsed = JSON.parse(raw || '[]');
            if (!Array.isArray(parsed)) return byCode;
            for (let i = 0; i < parsed.length && i < 2000; i++) {
                const metadata = globalCourseMetadataFromRecord(parsed[i]);
                if (metadata) byCode.set(metadata.code, metadata);
            }
        } catch (_) {}
        return byCode;
    }

    function rememberGlobalCourseDefinition(record) {
        const metadata = globalCourseMetadataFromRecord(record);
        if (!metadata) return null;
        try {
            const byCode = getStoredGlobalCourseMetadata();
            byCode.set(metadata.code, metadata);
            const rows = Array.from(byCode.values()).sort(function(a, b) {
                return a.code.localeCompare(b.code);
            });
            const value = JSON.stringify(rows);
            const ps = (typeof window !== 'undefined') ? window.planStorage : null;
            if (ps && typeof ps.setItem === 'function') {
                const planId = getPlanStorageSessionId(ps);
                if (!planId) return metadata;
                ps.setItem(GLOBAL_COURSE_METADATA_STORAGE_KEY, value, planId);
            } else if (typeof localStorage !== 'undefined') {
                localStorage.setItem(GLOBAL_COURSE_METADATA_STORAGE_KEY, value);
            }
        } catch (_) {}
        return metadata;
    }

    function findLoadedCatalogDefinition(courseData, normalizedCode) {
        try {
            if (typeof window !== 'undefined' && typeof window.getInfo === 'function') {
                const resolved = window.getInfo(normalizedCode, Array.isArray(courseData) ? courseData : []);
                if (resolved) return resolved;
            }
        } catch (_) {}

        // The module bridge may not have executed yet. Mirror its precedence so
        // callers still cannot insert a global fallback ahead of a real record.
        let internalFallback = null;
        const lists = [Array.isArray(courseData) ? courseData : []];
        try {
            const cur = (typeof window !== 'undefined') ? window.curriculum : null;
            if (cur && cur.doubleMajor && Array.isArray(cur.doubleMajorCourseData)) {
                lists.push(cur.doubleMajorCourseData);
            }
            if (cur && Array.isArray(cur.minors) && cur.minorCourseDataByCode) {
                for (let i = 0; i < cur.minors.length; i++) {
                    const list = cur.minorCourseDataByCode[cur.minors[i]];
                    if (Array.isArray(list)) lists.push(list);
                }
            }
        } catch (_) {}

        for (let li = 0; li < lists.length; li++) {
            const list = lists[li];
            for (let i = 0; i < list.length; i++) {
                const record = list[i];
                if (!record || normalizeGlobalCourseDefinitionCode(record) !== normalizedCode) continue;
                if (record.__globalCourseDefinition) {
                    if (!internalFallback) internalFallback = record;
                    continue;
                }
                return record;
            }
        }
        return internalFallback;
    }

    function normalizedGlobalOverrides(overridesByCode) {
        const normalized = new Map();
        if (!overridesByCode || typeof overridesByCode !== 'object') return normalized;
        try {
            if (typeof overridesByCode.forEach === 'function' && typeof overridesByCode.get === 'function') {
                overridesByCode.forEach(function(value, key) {
                    const code = normalizeGlobalCourseDefinitionCode(key);
                    if (code) normalized.set(code, value);
                });
                return normalized;
            }
            Object.keys(overridesByCode).forEach(function(key) {
                const code = normalizeGlobalCourseDefinitionCode(key);
                if (code) normalized.set(code, overridesByCode[key]);
            });
        } catch (_) {}
        return normalized;
    }

    // Lazily load the global index once, then append definitions only for the
    // explicitly requested codes. Existing primary/DM/minor/user-custom records
    // always win, and no index-wide list is ever merged into courseData.
    async function appendGlobalCourseDefinitions(courseData, codes, overridesByCode) {
        const added = [];
        const missing = [];
        if (!Array.isArray(courseData)) return { added, missing };

        let requested;
        if (typeof codes === 'string' || !codes || typeof codes[Symbol.iterator] !== 'function') {
            requested = [codes];
        } else {
            requested = Array.from(codes);
        }
        const normalizedCodes = [];
        const seen = new Set();
        for (let i = 0; i < requested.length; i++) {
            const code = normalizeGlobalCourseDefinitionCode(requested[i]);
            if (!code || seen.has(code)) continue;
            seen.add(code);
            normalizedCodes.push(code);
        }
        if (!normalizedCodes.length) return { added, missing };

        try { await loadCoursePageInfoIndex(); } catch (_) {}
        const overrides = normalizedGlobalOverrides(overridesByCode);
        for (let i = 0; i < normalizedCodes.length; i++) {
            const code = normalizedCodes[i];
            if (findLoadedCatalogDefinition(courseData, code)) continue;
            const definition = resolveGlobalCourseDefinition(code, overrides.get(code));
            if (!definition) {
                missing.push(code);
                continue;
            }
            courseData.push(definition);
            added.push(definition);
        }
        return { added, missing };
    }

    // Load the full course-page scrape info (courses/all_coursepage_info.jsonl) and
    // index it by normalized course_id. This powers course-card details and the
    // contained global-definition fallback above.
    function loadCoursePageInfoIndex() {
        try {
            if (typeof window === 'undefined') return Promise.resolve(null);
            if (window.__coursePageInfoPromise) return window.__coursePageInfoPromise;

            window.__coursePageInfoPromise = (async () => {
                const tryReadText = async () => {
                    try {
                        if (window.__courseOfferingsJsonlText) return window.__courseOfferingsJsonlText;
                    } catch (_) {}

                    const isFile = (() => {
                        try { return typeof location !== 'undefined' && location && location.protocol === 'file:'; } catch (_) { return false; }
                    })();

                    // The cumulative file is large, so never block the main thread
                    // with synchronous XHR on http(s).
                    try {
                        const res = await fetch('./courses/all_coursepage_info.jsonl');
                        if (res.ok) return await res.text();
                    } catch (_) {}

                    // Browsers commonly block fetch for local file:// pages. Keep
                    // the legacy synchronous fallback narrowly scoped to that mode.
                    if (isFile) {
                        try {
                            const xhr = new XMLHttpRequest();
                            xhr.open('GET', './courses/all_coursepage_info.jsonl', false);
                            xhr.overrideMimeType('application/json');
                            xhr.send(null);
                            if (xhr.status === 200 || xhr.status === 0) return xhr.responseText;
                        } catch (_) {}
                    }

                    try {
                        const res = await fetch('./courses/all_coursepage_info.jsonl', { cache: 'no-store' });
                        if (res.ok) return await res.text();
                    } catch (_) {}
                    return '';
                };

                const text = await tryReadText();
                const byCode = new Map();
                if (!text) {
                    window.coursePageInfoByCode = byCode;
                    // Do not permanently memoize a transient network/file failure.
                    window.__coursePageInfoPromise = null;
                    return byCode;
                }
                const lines = text.split(/\r?\n/);
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i] && lines[i].trim();
                    if (!line) continue;
                    try {
                        const obj = JSON.parse(line);
                        const id = obj && obj.course_id
                            ? normalizeGlobalCourseDefinitionCode(obj.course_id) : '';
                        if (!id) continue;
                        if (!byCode.has(id)) byCode.set(id, obj);
                    } catch (_) {
                        // ignore malformed line
                    }
                }
                window.coursePageInfoByCode = byCode;
                if (!byCode.size) window.__coursePageInfoPromise = null;
                return byCode;
            })();

            return window.__coursePageInfoPromise;
        } catch (_) {
            return Promise.resolve(null);
        }
    }

    if (typeof window !== 'undefined') {
        window.loadCoursePageInfoIndex = loadCoursePageInfoIndex;
        window.resolveGlobalCourseDefinition = resolveGlobalCourseDefinition;
        window.appendGlobalCourseDefinitions = appendGlobalCourseDefinitions;
        window.getStoredGlobalCourseMetadata = getStoredGlobalCourseMetadata;
        window.rememberGlobalCourseDefinition = rememberGlobalCourseDefinition;
    }

    // Load the derived course instructor history index
    // (courses/course_instructor_history.jsonl) lazily so it only affects course
    // details views that actually need it.
    async function readDerivedHistoryText(path) {
        const isFile = (() => {
            try { return !!(root.location && root.location.protocol === 'file:'); } catch (_) { return false; }
        })();

        // Keep the normal web path non-blocking. A second uncached request lets
        // a later details-open recover from a transient cache or network error.
        try {
            if (typeof root.fetch === 'function') {
                const response = await root.fetch(path);
                if (response && response.ok) return await response.text();
            }
        } catch (_) {}

        // Local file pages often cannot fetch sibling files. This is the only
        // protocol under which the compatibility synchronous read may run.
        if (isFile && typeof root.XMLHttpRequest === 'function') {
            try {
                const xhr = new root.XMLHttpRequest();
                xhr.open('GET', path, false);
                xhr.overrideMimeType('application/json');
                xhr.send(null);
                if (xhr.status === 200 || xhr.status === 0) return xhr.responseText;
            } catch (_) {}
        }

        try {
            if (typeof root.fetch === 'function') {
                const response = await root.fetch(path, { cache: 'no-store' });
                if (response && response.ok) return await response.text();
            }
        } catch (_) {}
        return '';
    }

    function loadCourseInstructorHistoryIndex() {
        try {
            if (typeof window === 'undefined') return Promise.resolve(null);
            if (window.__courseInstructorHistoryPromise) return window.__courseInstructorHistoryPromise;

            window.__courseInstructorHistoryPromise = (async () => {
                const text = await readDerivedHistoryText('./courses/course_instructor_history.jsonl');
                const byCode = new Map();
                if (!text) {
                    window.courseInstructorHistoryByCode = byCode;
                    window.__courseInstructorHistoryPromise = null;
                    return byCode;
                }
                const lines = text.split(/\r?\n/);
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i] && lines[i].trim();
                    if (!line) continue;
                    try {
                        const obj = JSON.parse(line);
                        const id = obj && obj.course_id ? String(obj.course_id) : '';
                        if (!id) continue;
                        if (!byCode.has(id)) byCode.set(id, obj);
                    } catch (_) {}
                }
                window.courseInstructorHistoryByCode = byCode;
                if (!byCode.size) window.__courseInstructorHistoryPromise = null;
                return byCode;
            })();

            return window.__courseInstructorHistoryPromise;
        } catch (_) {
            return Promise.resolve(null);
        }
    }

    if (typeof window !== 'undefined') {
        window.loadCourseInstructorHistoryIndex = loadCourseInstructorHistoryIndex;
    }

    function loadCourseSectionHistoryIndex() {
        try {
            if (typeof window === 'undefined') return Promise.resolve(null);
            if (window.__courseSectionHistoryPromise) return window.__courseSectionHistoryPromise;

            window.__courseSectionHistoryPromise = (async () => {
                const text = await readDerivedHistoryText('./courses/course_section_history.jsonl');
                const byCode = new Map();
                if (!text) {
                    window.courseSectionHistoryByCode = byCode;
                    window.__courseSectionHistoryPromise = null;
                    return byCode;
                }
                const lines = text.split(/\r?\n/);
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i] && lines[i].trim();
                    if (!line) continue;
                    try {
                        const obj = JSON.parse(line);
                        const id = obj && obj.course_id ? String(obj.course_id) : '';
                        if (!id) continue;
                        if (!byCode.has(id)) byCode.set(id, obj);
                    } catch (_) {}
                }
                window.courseSectionHistoryByCode = byCode;
                if (!byCode.size) window.__courseSectionHistoryPromise = null;
                return byCode;
            })();

            return window.__courseSectionHistoryPromise;
        } catch (_) {
            return Promise.resolve(null);
        }
    }

    if (typeof window !== 'undefined') {
        window.loadCourseSectionHistoryIndex = loadCourseSectionHistoryIndex;
    }

    const namespace = root.SurriculumModules || (root.SurriculumModules = {});
    namespace.courseMetadata = Object.freeze({
        getCoursesList,
        loadCourseOfferingsIndex,
        populateCourseDataList,
        loadCoursePageInfoIndex,
        resolveGlobalCourseDefinition,
        appendGlobalCourseDefinitions,
        getStoredGlobalCourseMetadata,
        rememberGlobalCourseDefinition,
        loadCourseInstructorHistoryIndex,
        loadCourseSectionHistoryIndex,
        getPlanStorageSessionId,
    });

    // This was an implicit classic-script global; preserve it explicitly now
    // that the implementation is scoped to this module.
    root.getCoursesList = getCoursesList;
    root.populateCourseDataList = populateCourseDataList;
})(typeof window !== 'undefined' ? window : globalThis);
