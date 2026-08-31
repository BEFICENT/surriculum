// Pure custom-course identity, storage, language, and credit primitives.
// Stateful planner/catalog coordination remains in main.js.
(function (global) {
    'use strict';

    const LANGUAGE_PREFIXES = new Set([
        'ARA', 'CHI', 'FRE', 'GER', 'ITA', 'JAP', 'LANG', 'LAT', 'PERS',
        'RUS', 'SPA', 'TUR',
    ]);

    function create(options) {
        const opts = options || {};
        const canonicalize = typeof opts.canonicalize === 'function'
            ? opts.canonicalize
            : (value) => {
                try {
                    return typeof global.canonicalCourseCode === 'function'
                        ? global.canonicalCourseCode(value) : value;
                } catch (_) { return value; }
            };
        const getPlanItem = typeof opts.getPlanItem === 'function'
            ? opts.getPlanItem : () => null;
        const normalizeList = typeof opts.normalizeList === 'function'
            ? opts.normalizeList : (_program, list) => Array.isArray(list) ? list : [];

        function normalizeCombinedCode(value) {
            return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
        }

        function getCombinedCode(course) {
            try {
                if (!course || typeof course !== 'object') return '';
                return normalizeCombinedCode(String((course.Major || '') + (course.Code || '')));
            } catch (_) { return ''; }
        }

        function getOccurrenceCode(course) {
            if (typeof course === 'string') return normalizeCombinedCode(course);
            if (!course || typeof course !== 'object') return '';
            if (course.code != null) return normalizeCombinedCode(course.code);
            return getCombinedCode(course);
        }

        function splitCombinedCode(value) {
            const combined = normalizeCombinedCode(value);
            const match = combined.match(/^([A-Z]{1,12})(\d[A-Z0-9]*)$/);
            return match ? { combined, major: match[1], code: match[2] } : null;
        }

        function titleExplicitlySaysBasicLanguage(value) {
            return /\b(?:basic|beginning)\b/i.test(String(value || ''));
        }

        function isLanguageCandidate(code, name, faculty, languageLevel) {
            const parsed = splitCombinedCode(code);
            const prefix = parsed ? parsed.major : '';
            if (languageLevel === 'basic' || languageLevel === 'other') return true;
            if (LANGUAGE_PREFIXES.has(prefix)) return true;
            return String(faculty || '').toUpperCase() === 'SL'
                && titleExplicitlySaysBasicLanguage(name);
        }

        function identity(combinedCode) {
            const normalized = normalizeCombinedCode(combinedCode);
            if (!normalized) return '';
            try { return normalizeCombinedCode(canonicalize(normalized)) || normalized; }
            catch (_) { return normalized; }
        }

        function identitySet(codes) {
            const identities = new Set();
            if (!codes || typeof codes.forEach !== 'function') return identities;
            codes.forEach((code) => {
                const value = identity(code);
                if (value) identities.add(value);
            });
            return identities;
        }

        function activeRecords(records, officialCodes) {
            const source = Array.isArray(records) ? records : [];
            const officialIdentities = identitySet(officialCodes);
            const counts = new Map();
            source.forEach((record) => {
                const value = identity(getCombinedCode(record));
                if (value) counts.set(value, (counts.get(value) || 0) + 1);
            });
            return source.filter((record) => {
                const value = identity(getCombinedCode(record));
                return !!value && !officialIdentities.has(value) && counts.get(value) === 1;
            });
        }

        function findStorageIndex(list, combinedCode, preferredIndex) {
            const target = identity(combinedCode);
            if (Number.isInteger(preferredIndex) && preferredIndex >= 0 && preferredIndex < list.length
                && identity(getCombinedCode(list[preferredIndex])) === target) {
                return preferredIndex;
            }
            const matches = [];
            for (let index = 0; index < list.length; index++) {
                if (identity(getCombinedCode(list[index])) === target) matches.push(index);
            }
            return matches.length === 1 ? matches[0] : -1;
        }

        function creditNumber(value) {
            const raw = value === null || value === undefined ? '' : String(value).trim();
            if (!raw) return 0;
            const number = parseFloat(raw.replace(',', '.'));
            return Number.isFinite(number) ? number : 0;
        }

        function hasAnyNonZeroCredits(course) {
            if (!course || typeof course !== 'object') return false;
            return creditNumber(course.ECTS) !== 0
                || creditNumber(course.SU_credit) !== 0
                || creditNumber(course.Engineering) !== 0
                || creditNumber(course.Basic_Science) !== 0;
        }

        function fillCreditsFromSource(target, source) {
            if (!target || typeof target !== 'object' || !source || typeof source !== 'object') return false;
            let changed = false;
            const fields = [
                ['ECTS', true],
                ['SU_credit', true],
                ['Engineering', false],
                ['Basic_Science', false],
            ];
            fields.forEach(([field, preserveText]) => {
                const sourceValue = creditNumber(source[field]);
                if (creditNumber(target[field]) !== 0 || sourceValue === 0) return;
                target[field] = preserveText ? String(source[field] ?? '0') : sourceValue;
                changed = true;
            });
            return changed;
        }

        function findCourseByCombinedCode(list, combinedCode) {
            try {
                if (!combinedCode || !Array.isArray(list)) return null;
                for (let index = 0; index < list.length; index++) {
                    const course = list[index];
                    if (course && (course.Major + course.Code) === combinedCode) return course;
                }
            } catch (_) {}
            return null;
        }

        function loadStoredCourses(program) {
            try {
                const code = String(program || '').toUpperCase();
                const parsed = JSON.parse(getPlanItem('customCourses_' + code) || '[]');
                return Array.isArray(parsed) ? normalizeList(program, parsed) : [];
            } catch (_) { return []; }
        }

        return Object.freeze({
            normalizeCombinedCode,
            getCombinedCode,
            getOccurrenceCode,
            splitCombinedCode,
            titleExplicitlySaysBasicLanguage,
            isLanguageCandidate,
            identity,
            identitySet,
            activeRecords,
            findStorageIndex,
            creditNumber,
            hasAnyNonZeroCredits,
            fillCreditsFromSource,
            findCourseByCombinedCode,
            loadStoredCourses,
        });
    }

    global.surriculumCustomCourseModel = Object.freeze({ create });
})(typeof window !== 'undefined' ? window : globalThis);
