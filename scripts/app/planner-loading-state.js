// Accessible visual state for planner hydration and startup failures.
(function installPlannerLoadingState(root) {
    'use strict';

    const DEFAULT_LOADING_MESSAGE = 'Loading your semesters…';
    const DEFAULT_FAILURE_MESSAGE = "Couldn't load your semesters. Refresh the page to try again.";

    function normalizedMessage(value, fallback) {
        const message = value === undefined || value === null ? '' : String(value).trim();
        return message || fallback;
    }

    function createController(options) {
        const config = options || {};
        const document = config.document;
        if (!document || typeof document.getElementById !== 'function') {
            throw new TypeError('Planner loading-state document is required.');
        }

        const board = document.getElementById('board');
        const state = document.getElementById('plannerLoadingState');
        const message = state && typeof state.querySelector === 'function'
            ? state.querySelector('.planner-loading-message') : null;
        if (!board || !state || !message) {
            throw new TypeError('Planner loading-state elements are required.');
        }

        function show() {
            state.hidden = false;
            state.removeAttribute('hidden');
        }

        function start(value) {
            board.setAttribute('aria-busy', 'true');
            state.dataset.state = 'loading';
            state.setAttribute('role', 'status');
            state.setAttribute('aria-live', 'polite');
            message.textContent = normalizedMessage(value, DEFAULT_LOADING_MESSAGE);
            show();
            return true;
        }

        function finish() {
            state.dataset.state = 'ready';
            state.hidden = true;
            state.setAttribute('hidden', '');
            board.setAttribute('aria-busy', 'false');
            return true;
        }

        function fail(value) {
            message.textContent = normalizedMessage(value, DEFAULT_FAILURE_MESSAGE);
            state.dataset.state = 'error';
            state.setAttribute('role', 'alert');
            state.setAttribute('aria-live', 'assertive');
            board.setAttribute('aria-busy', 'false');
            show();
            return true;
        }

        return Object.freeze({ start, finish, fail });
    }

    root.surriculumPlannerLoadingState = Object.freeze({ createController });
})(typeof window !== 'undefined' ? window : globalThis);
