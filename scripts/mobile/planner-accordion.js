// Focused mobile planner-semester accordion module. Initialized by mobile.js.
(function installMobilePlannerAccordion(root) {
    'use strict';

    let initialized = false;
    function init() {
        if (initialized) return api;

        /*
         * Mobile planner — vertical accordion of semesters.
         *
         * Injects a chevron affordance, collapses non-current semesters by
         * default, and toggles a semester open/closed when its name row is
         * tapped. All visual effects are gated on body.is-mobile in mobile.css,
         * so adding the classes/chevron is a no-op on desktop.
         */
        (function () {
            'use strict';

            function ensureChevron(cont) {
                var icons = cont.querySelector('.subcontainer_semester .date .icons');
                if (!icons) return null;
                var chev = icons.querySelector('.m-sem-chevron');
                if (!chev || chev.tagName !== 'BUTTON') {
                    var button = document.createElement('button');
                    button.type = 'button';
                    button.className = 'm-sem-chevron';
                    button.innerHTML = '<i class="fa-solid fa-chevron-down" aria-hidden="true"></i>';
                    if (chev) chev.parentNode.replaceChild(button, chev);
                    else icons.appendChild(button);
                    chev = button;
                }
                return chev;
            }

            function syncDisclosure(cont) {
                var toggle = ensureChevron(cont);
                if (!toggle) return;
                var semester = cont.querySelector('.semester');
                var term = String(((cont.querySelector('.date p') || {}).textContent) || 'semester').trim();
                var expanded = !cont.classList.contains('m-collapsed');
                if (semester && semester.id) toggle.setAttribute('aria-controls', semester.id);
                toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
                toggle.setAttribute('aria-label', (expanded ? 'Collapse ' : 'Expand ') + term);
                toggle.title = (expanded ? 'Collapse ' : 'Expand ') + term;
            }

            function syncSemesters() {
                var conts = document.querySelectorAll('.board .container_semester');
                for (var i = 0; i < conts.length; i++) {
                    var c = conts[i];
                    ensureChevron(c);
                    // The persisted/desktop presentation runs oldest-to-newest from
                    // left to right. Mobile reads the same sequence vertically in the
                    // opposite direction so the newest semester is nearest the top.
                    // This is presentation-only: DOM/model alignment and term-code
                    // based academic calculations stay untouched.
                    c.style.setProperty('--m-order', String(-i));
                    if (!c.hasAttribute('data-m-init')) {
                        c.setAttribute('data-m-init', '1');
                        // Collapse by default unless it's the current term.
                        if (!c.classList.contains('current-term')) c.classList.add('m-collapsed');
                    }
                }
                // Guarantee at least one open semester when there's no current term.
                if (conts.length && !document.querySelector('.board .container_semester:not(.m-collapsed)')) {
                    var latest = conts[0];
                    var latestCode = '';
                    for (var j = 0; j < conts.length; j++) {
                        var semesterEl = conts[j].querySelector('.semester');
                        var semesterObj = null;
                        try {
                            semesterObj = window.curriculum && semesterEl
                                && typeof window.curriculum.getSemester === 'function'
                                ? window.curriculum.getSemester(semesterEl.id) : null;
                        } catch (e) {}
                        var code = '';
                        try {
                            code = typeof window.semesterTermCode === 'function'
                                ? String(window.semesterTermCode(semesterObj) || '') : '';
                        } catch (e) {}
                        if (code && (!latestCode || code > latestCode)) {
                            latest = conts[j];
                            latestCode = code;
                        }
                    }
                    latest.classList.remove('m-collapsed');
                }
                for (var k = 0; k < conts.length; k++) syncDisclosure(conts[k]);
            }

            function onBoardClick(e) {
                if (!document.body.classList.contains('is-mobile')) return;
                if (!e.target.closest) return;
                // Leave semester actions to their own handlers; none of them should
                // accidentally toggle the surrounding accordion card.
                if (e.target.closest('.semester_date_edit, .semester_drag, .semester_move, .delete_semester')) return;
                // The header is the colored credits bar + the name row.
                var header = e.target.closest('.date') || e.target.closest('.total_credit');
                if (!header) return;
                var cont = header.closest('.container_semester');
                if (cont) {
                    cont.classList.toggle('m-collapsed');
                    syncDisclosure(cont);
                }
            }

            function init() {
                var board = document.querySelector('.board');
                if (!board || board.__mPlannerInit) return;
                board.__mPlannerInit = true;
                syncSemesters();
                board.addEventListener('click', onBoardClick);
                // The board is populated asynchronously (and rebuilt on plan switch),
                // so re-sync whenever its children change.
                try {
                    new MutationObserver(function () { syncSemesters(); }).observe(board, { childList: true });
                } catch (e) {}
            }

            if (document.body) {
                init();
                window.addEventListener('load', init);
            } else {
                document.addEventListener('DOMContentLoaded', init);
            }
        })();

        initialized = true;
        return api;
    }

    const api = Object.freeze({ init });
    const namespace = root.SurriculumMobileModules
        || (root.SurriculumMobileModules = {});
    namespace.plannerAccordion = api;
})(typeof window !== 'undefined' ? window : globalThis);
