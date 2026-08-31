// Geometry and listener lifecycle for the planner's course-picker surfaces.
(function installPlannerCoursePickerLayout(root) {
    'use strict';

    function createLayoutController(options) {
        const config = options || {};
        const document = config.document;
        const dropdown = config.dropdown;
        const filterMenu = config.filterMenu;
        const filterButton = config.filterButton;
        const searchRow = config.searchRow;
        const targetSemesterElement = config.targetSemesterElement;
        const semesterContainer = config.semesterContainer;
        const inputContainer = config.inputContainer;
        if (!document || !dropdown || !filterMenu || !filterButton || !searchRow || !inputContainer) {
            throw new TypeError('Course-picker layout dependencies are required.');
        }

        const positionDropdown = () => {
            try {
                if (dropdown.style.display === 'none') return;
                const anchor = searchRow.getBoundingClientRect();
                const pane = targetSemesterElement
                    ? targetSemesterElement.getBoundingClientRect() : null;
                const card = semesterContainer
                    ? semesterContainer.getBoundingClientRect() : null;
                const boardElement = semesterContainer && semesterContainer.closest
                    ? semesterContainer.closest('.board') : null;
                const board = boardElement ? boardElement.getBoundingClientRect() : null;
                const visual = root.visualViewport || null;
                const viewportTop = visual ? Number(visual.offsetTop || 0) : 0;
                const viewportLeft = visual ? Number(visual.offsetLeft || 0) : 0;
                const viewportWidth = visual
                    ? Number(visual.width || 0)
                    : (root.innerWidth || document.documentElement.clientWidth || 0);
                const viewportHeight = visual
                    ? Number(visual.height || 0)
                    : (root.innerHeight || document.documentElement.clientHeight || 0);
                const layoutViewportHeight = root.innerHeight
                    || document.documentElement.clientHeight
                    || viewportHeight;
                const viewportRight = viewportLeft + viewportWidth;
                const viewportBottom = viewportTop + viewportHeight;
                const edge = 8;
                const gap = 6;
                const safeTop = Math.max(
                    viewportTop + edge,
                    board ? board.top + edge : viewportTop + edge,
                );
                const safeBottom = Math.min(
                    viewportBottom - edge,
                    board ? board.bottom - edge : viewportBottom - edge,
                );
                const safeLeft = viewportLeft + edge;
                const safeRight = viewportRight - edge;
                const widthAvailable = Math.max(1, safeRight - safeLeft);
                const width = Math.min(
                    widthAvailable,
                    Math.max(160, Math.round(anchor.width || 0)),
                );
                const left = Math.max(
                    safeLeft,
                    Math.min(Math.round(anchor.left || 0), safeRight - width),
                );

                const aboveTop = Math.max(safeTop, pane ? pane.top : safeTop);
                const belowBottom = Math.min(safeBottom, card ? card.bottom : safeBottom);
                const naturalSpaceAbove = Math.max(0, anchor.top - gap - aboveTop);
                const naturalSpaceBelow = Math.max(0, belowBottom - anchor.bottom - gap);
                const boardSpaceAbove = Math.max(0, anchor.top - gap - safeTop);
                const boardSpaceBelow = Math.max(0, safeBottom - anchor.bottom - gap);
                const cardVisibleHeight = card
                    ? Math.max(0, Math.min(card.bottom, safeBottom) - Math.max(card.top, safeTop))
                    : Math.max(boardSpaceAbove, boardSpaceBelow);
                const desiredHeight = Math.min(
                    560,
                    Math.max(240, Math.round(cardVisibleHeight * 0.72)),
                    Math.max(1, Math.round(viewportHeight * 0.72)),
                );
                const preferredMinimum = Math.min(160, desiredHeight);
                const useBoardFallback = Math.max(naturalSpaceAbove, naturalSpaceBelow)
                    < preferredMinimum;
                const spaceAbove = useBoardFallback ? boardSpaceAbove : naturalSpaceAbove;
                const spaceBelow = useBoardFallback ? boardSpaceBelow : naturalSpaceBelow;
                const openAbove = spaceAbove >= preferredMinimum || spaceAbove >= spaceBelow;
                const availableHeight = openAbove ? spaceAbove : spaceBelow;
                const maxHeight = Math.max(1, Math.min(desiredHeight, availableHeight));

                dropdown.style.left = left + 'px';
                dropdown.style.width = width + 'px';
                dropdown.style.right = 'auto';
                dropdown.style.maxHeight = Math.floor(maxHeight) + 'px';
                dropdown.dataset.placement = openAbove ? 'above' : 'below';
                if (openAbove) {
                    dropdown.style.top = 'auto';
                    dropdown.style.bottom = Math.round(layoutViewportHeight - anchor.top + gap) + 'px';
                } else {
                    dropdown.style.top = Math.round(anchor.bottom + gap) + 'px';
                    dropdown.style.bottom = 'auto';
                }
            } catch (_) {}
        };

        const positionFilterMenu = () => {
            try {
                if (filterMenu.hidden) return;
                const anchor = filterButton.getBoundingClientRect();
                const viewportWidth = root.innerWidth || document.documentElement.clientWidth || 0;
                const viewportHeight = root.innerHeight || document.documentElement.clientHeight || 0;
                const margin = 8;
                const desiredWidth = Math.min(430, Math.max(280, viewportWidth - margin * 2));
                const sideGap = 6;
                const roomRight = viewportWidth - anchor.right - sideGap - margin;
                const roomLeft = anchor.left - sideGap - margin;
                let left;
                if (roomRight >= desiredWidth) {
                    left = anchor.right + sideGap;
                } else if (roomLeft >= desiredWidth) {
                    left = anchor.left - desiredWidth - sideGap;
                } else {
                    left = Math.max(margin, Math.min(
                        Math.round(anchor.right - desiredWidth),
                        Math.max(margin, viewportWidth - desiredWidth - margin),
                    ));
                }
                const below = Math.max(0, viewportHeight - anchor.bottom - 6 - margin);
                const above = Math.max(0, anchor.top - 6 - margin);
                const useBelow = below >= Math.min(300, above);
                const available = Math.max(180, Math.min(580, useBelow ? below : above));
                filterMenu.style.width = desiredWidth + 'px';
                filterMenu.style.left = left + 'px';
                filterMenu.style.right = 'auto';
                filterMenu.style.maxHeight = available + 'px';
                if (useBelow) {
                    filterMenu.style.top = Math.round(anchor.bottom + 6) + 'px';
                    filterMenu.style.bottom = 'auto';
                } else {
                    filterMenu.style.top = 'auto';
                    filterMenu.style.bottom = Math.round(viewportHeight - anchor.top + 6) + 'px';
                }
            } catch (_) {}
        };

        const AbortControllerClass = root.AbortController
            || (typeof AbortController !== 'undefined' ? AbortController : null);
        const MutationObserverClass = root.MutationObserver
            || (typeof MutationObserver !== 'undefined' ? MutationObserver : null);
        const ResizeObserverClass = root.ResizeObserver
            || (typeof ResizeObserver !== 'undefined' ? ResizeObserver : null);
        const abortController = AbortControllerClass ? new AbortControllerClass() : null;
        let removalObserver = null;
        let resizeObserver = null;
        let cleaned = false;

        const on = (target, eventName, listener, options) => {
            try {
                if (abortController && abortController.signal) {
                    target.addEventListener(
                        eventName,
                        listener,
                        Object.assign({}, options || {}, { signal: abortController.signal }),
                    );
                } else {
                    target.addEventListener(eventName, listener, options || false);
                }
            } catch (_) {}
        };
        const cleanup = () => {
            if (cleaned) return;
            cleaned = true;
            try { dropdown.style.display = 'none'; } catch (_) {}
            try { filterMenu.hidden = true; } catch (_) {}
            try { if (removalObserver) removalObserver.disconnect(); } catch (_) {}
            try { if (resizeObserver) resizeObserver.disconnect(); } catch (_) {}
            try { if (abortController) abortController.abort(); } catch (_) {}
        };
        const watchRemoval = () => {
            try {
                if (!MutationObserverClass || !document.body) return;
                removalObserver = new MutationObserverClass(() => {
                    if (!inputContainer.isConnected) cleanup();
                });
                removalObserver.observe(document.body, { childList: true, subtree: true });
            } catch (_) {}
        };
        const watchResize = (targets, callback) => {
            try {
                if (!ResizeObserverClass || resizeObserver) return;
                resizeObserver = new ResizeObserverClass(() => callback());
                (Array.isArray(targets) ? targets : [targets]).forEach((target) => {
                    if (target) resizeObserver.observe(target);
                });
            } catch (_) {}
        };

        return Object.freeze({ positionDropdown, positionFilterMenu, on, cleanup, watchRemoval, watchResize });
    }

    const namespace = root.SurriculumModules || (root.SurriculumModules = {});
    namespace.plannerCoursePickerLayout = Object.freeze({ createLayoutController });
})(typeof window !== 'undefined' ? window : globalThis);
