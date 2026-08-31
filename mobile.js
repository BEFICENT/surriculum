// Mobile UI composition entry point. Focused modules install their frozen APIs
// first; this file preserves their historical initialization order and timing.
(function initializeSurriculumMobile(root) {
    'use strict';

    const MODULE_ORDER = Object.freeze([
        'viewportMode',
        'navigationProgress',
        'plannerAccordion',
        'schedulerAdaptation',
    ]);
    let initialized = false;

    function init() {
        if (initialized) return api;
        const modules = root.SurriculumMobileModules || {};
        MODULE_ORDER.forEach((name) => {
            const moduleApi = modules[name];
            if (!moduleApi || typeof moduleApi.init !== 'function') {
                throw new Error(`scripts/mobile module "${name}" must load before mobile.js`);
            }
            moduleApi.init();
        });
        initialized = true;
        return api;
    }

    const api = Object.freeze({ init });
    root.SurriculumMobile = api;
    init();
})(typeof window !== 'undefined' ? window : globalThis);
