// Planner sidebar defaults and their shared picker-facing browser state.
(function installPlannerPreferences(root) {
    'use strict';

    function createController(options) {
        const config = options || {};
        const document = config.document;
        const getItem = config.preferenceGetItem;
        const setItem = config.preferenceSetItem;
        if (!document || typeof getItem !== 'function' || typeof setItem !== 'function') {
            throw new TypeError('Planner preference dependencies are required.');
        }
        let initialized = false;

        const readBoolean = (key, fallback) => {
            try {
                const stored = getItem(key);
                return stored === null ? fallback : stored === 'true';
            } catch (_) {
                return fallback;
            }
        };
        const publish = (globalName, key, enabled, eventName) => {
            root[globalName] = enabled;
            setItem(key, enabled ? 'true' : 'false');
            if (eventName) document.dispatchEvent(new root.Event(eventName));
        };
        const bindToggle = (definition) => {
            const initial = readBoolean(definition.key, definition.fallback);
            root[definition.globalName] = initial;
            const toggle = document.getElementById(definition.id);
            if (toggle) {
                toggle.checked = initial;
                toggle.addEventListener('change', (event) => {
                    publish(
                        definition.globalName,
                        definition.key,
                        !!event.target.checked,
                        definition.eventName,
                    );
                });
            }
            if (definition.eventName && definition.sync !== false) {
                document.addEventListener(definition.eventName, () => {
                    if (toggle && typeof root[definition.globalName] === 'boolean') {
                        toggle.checked = root[definition.globalName];
                    }
                });
            }
            return toggle;
        };

        function initialize() {
            if (initialized) return false;
            initialized = true;
            const detailsToggle = bindToggle({
                id: 'courseDetailsToggle',
                key: 'showCourseDetails',
                globalName: 'showCourseDetails',
                eventName: 'courseDetailsToggleChanged',
                fallback: true,
            });
            const updateCourseDetailVisibility = () => {
                const show = root.showCourseDetails;
                if (detailsToggle) detailsToggle.checked = show !== false;
                document.querySelectorAll('.course_bs_credit').forEach((element) => {
                    element.style.display = show ? '' : 'none';
                });
            };
            document.addEventListener('courseDetailsToggleChanged', updateCourseDetailVisibility);
            updateCourseDetailVisibility();

            bindToggle({
                id: 'hideTakenCoursesToggle',
                key: 'hideTakenCourses',
                globalName: 'hideTakenCourses',
                eventName: 'hideTakenCoursesToggleChanged',
                fallback: true,
            });
            bindToggle({
                id: 'plannerOfferedOnlyToggle',
                key: 'plannerFilterOfferedOnly',
                globalName: 'plannerFilterOfferedOnly',
                eventName: '',
                fallback: true,
            });
            bindToggle({
                id: 'sortByScoreToggle',
                key: 'sortBasedOnScore',
                globalName: 'sortBasedOnScore',
                eventName: 'sortByScoreToggleChanged',
                fallback: true,
            });
            return true;
        }

        return Object.freeze({ initialize });
    }

    root.surriculumPlannerPreferences = Object.freeze({ createController });
})(typeof window !== 'undefined' ? window : globalThis);
