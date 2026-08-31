// Focused mobile Scheduler-adaptation module. Initialized by mobile.js.
(function installMobileSchedulerAdaptation(root) {
    'use strict';

    let initialized = false;
    function init() {
        if (initialized) return api;

        /*
         * Mobile scheduler — reshape the desktop scheduler modal (built on demand by
         * scheduler.js, whose internals are closured and not callable from here).
         * Portrait: day-at-a-time — an injected day selector drives `data-m-day`, and
         * CSS shows only that day's .scheduler-day-col. Landscape: the full week grid.
         * All block rendering + interactions remain the scheduler's own.
         */
        (function () {
            'use strict';
            var DAYS = [
                { k: 'M', label: 'Mon' }, { k: 'T', label: 'Tue' }, { k: 'W', label: 'Wed' },
                { k: 'R', label: 'Thu' }, { k: 'F', label: 'Fri' }, { k: 'S', label: 'Sat' },
                { k: 'U', label: 'Sun' }
            ];
            // Landscape "tall" mode px-per-minute — matches the portrait/desktop default
            // (1.05px) so a block reads the same height there; the week overflows and the
            // grid scrolls instead of being squeezed to fit. See landscapeTargetPpm().
            var TALL_PPM = 1.05;
            var GRID_START_MIN = 8 * 60 + 40;

            function defaultDay() {
                var map = { 0: 'U', 1: 'M', 2: 'T', 3: 'W', 4: 'R', 5: 'F', 6: 'S' };
                try { return map[new Date().getDay()] || 'M'; } catch (e) { return 'M'; }
            }

            function setDay(modal, day) {
                modal.setAttribute('data-m-day', day);
                var btns = modal.querySelectorAll('.m-sched-day');
                for (var i = 0; i < btns.length; i++) {
                    btns[i].classList.toggle('active', btns[i].getAttribute('data-day') === day);
                }
            }

            function syncDaySelector(modal) {
                var sel = modal.querySelector('.m-sched-days');
                if (!sel) return;
                var visible = [];
                for (var i = 0; i < DAYS.length; i++) {
                    var col = modal.querySelector('.scheduler-day-col[data-day="' + DAYS[i].k + '"]');
                    if (col && !col.hidden) visible.push(DAYS[i]);
                }
                sel.innerHTML = visible.map(function (d) {
                    return '<button type="button" class="m-sched-day" data-day="' + d.k + '">' + d.label + '</button>';
                }).join('');
                var current = modal.getAttribute('data-m-day');
                var keys = visible.map(function (d) { return d.k; });
                if (keys.indexOf(current) < 0) {
                    var preferred = defaultDay();
                    current = keys.indexOf(preferred) >= 0 ? preferred : (keys[0] || 'M');
                }
                setDay(modal, current);
            }

            // Tap-to-preview: touch has no hover, so a tap on a course's body drives the
            // scheduler's own (closured) preview via an explicit request, then we
            // drop the sheet to reveal the grid. Back clears it; Add runs the card's pick.
            function previewLabel(el) {
                // A specific section row → show its section id + meeting time (drop the
                // trailing "@ location").
                if (el.classList && el.classList.contains('scheduler-inline-section-row')) {
                    var main = el.querySelector('.scheduler-inline-section-main') || el;
                    var txt = (main.textContent || '').replace(/\s+/g, ' ').trim().replace(/\)(?=\S)/g, ') ');
                    var at = txt.indexOf(' @ ');
                    return at > 0 ? txt.slice(0, at) : txt;
                }
                var head = el.querySelector('.scheduler-course-head');
                if (head) {
                    // The code and title are adjacent nodes with no whitespace between
                    // them; join each node's text with a space so it reads "NS101 …".
                    var parts = [];
                    [].forEach.call(head.childNodes, function (n) {
                        var s = (n.textContent || '').trim();
                        if (s) parts.push(s);
                    });
                    if (parts.length) return parts.join(' ').replace(/\s+/g, ' ');
                }
                return el.getAttribute('data-course') || 'Course';
            }
            // `target` is either a .scheduler-course card (default section) or a specific
            // .scheduler-inline-section-row. The explicit request remains available even
            // when the desktop-only hover-preview preference is disabled.
            function startPreview(modal, target) {
                var isSection = target.classList && target.classList.contains('scheduler-inline-section-row');
                var card = target.closest ? target.closest('.scheduler-course') : null;
                var courseId = target.getAttribute('data-course') || (card ? card.getAttribute('data-course') : '');
                var crn = isSection ? target.getAttribute('data-crn') : '';
                try {
                    modal.dispatchEvent(new CustomEvent('schedulerpreviewrequest', {
                        detail: { courseId: courseId || '', crn: crn || '' }
                    }));
                } catch (e) {}
                // Stay in the results sheet when the section has no renderable meeting
                // time; an empty preview screen would imply that something was shown.
                if (!modal.querySelector('.scheduler-block.is-preview')) return;
                modal.__mPreviewSectionRow = isSection ? target : null;
                modal.__mPreviewCard = card;
                var lbl = modal.querySelector('.m-prev-label');
                if (lbl) lbl.textContent = previewLabel(target);
                // Mark every day this section touches on the day selector, then jump to
                // the first one so the user sees the section (not an unrelated day).
                try {
                    var order = ['M', 'T', 'W', 'R', 'F', 'S', 'U'];
                    var firstDay = null;
                    for (var d = 0; d < order.length; d++) {
                        var dcol = modal.querySelector('.scheduler-day-col[data-day="' + order[d] + '"]');
                        var affected = !!(dcol && dcol.querySelector('.scheduler-block.is-preview'));
                        var btn = modal.querySelector('.m-sched-day[data-day="' + order[d] + '"]');
                        if (btn) btn.classList.toggle('m-day-affected', affected);
                        if (affected && !firstDay) firstDay = order[d];
                    }
                    if (firstDay) setDay(modal, firstDay);
                } catch (e2) {}
                setCourseSheetOpen(modal, false);
                modal.classList.add('m-preview');
                try {
                    requestAnimationFrame(function () {
                        var back = modal.querySelector('.m-prev-back');
                        if (back) back.focus({ preventScroll: true });
                    });
                } catch (e3) {}
            }
            function clearAffectedDays(modal) {
                var marks = modal.querySelectorAll('.m-sched-day.m-day-affected');
                for (var i = 0; i < marks.length; i++) marks[i].classList.remove('m-day-affected');
            }
            function endPreview(modal) {
                var results = modal.querySelector('.scheduler-results');
                if (results) {
                    // Let this intentional clear through the mouseleave guard below.
                    modal.__allowPreviewClear = true;
                    try { results.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false, view: window })); } catch (e) {}
                    modal.__allowPreviewClear = false;
                }
                clearAffectedDays(modal);
                modal.classList.remove('m-preview');
                modal.__mPreviewCard = null;
                modal.__mPreviewSectionRow = null;
            }

            // The course browser is visually off-canvas while closed, so its interactive
            // descendants must leave the accessibility tree and tab order at the same
            // time. This is the single state transition for every sheet entry/exit path.
            function setCourseSheetOpen(modal, open, opener) {
                if (!modal) return;
                var sidebar = modal.querySelector('.scheduler-sidebar');
                if (!sidebar) return;
                var nextOpen = !!open;
                var wasOpen = modal.classList.contains('m-sheet-open');

                if (nextOpen && opener && opener.nodeType === 1) modal.__mSheetOpener = opener;
                modal.__mSheetFocusToken = (modal.__mSheetFocusToken || 0) + 1;
                var focusToken = modal.__mSheetFocusToken;
                modal.classList.toggle('m-sheet-open', nextOpen);

                try {
                    sidebar.inert = !nextOpen;
                    if (nextOpen) sidebar.removeAttribute('inert');
                    else sidebar.setAttribute('inert', '');
                } catch (e) {
                    if (nextOpen) sidebar.removeAttribute('inert');
                    else sidebar.setAttribute('inert', '');
                }
                sidebar.setAttribute('aria-hidden', nextOpen ? 'false' : 'true');

                if (!nextOpen) {
                    var restore = (opener && opener.nodeType === 1) ? opener : modal.__mSheetOpener;
                    if ((wasOpen || !!opener) && restore && restore.isConnected && typeof restore.focus === 'function') {
                        try { restore.focus({ preventScroll: true }); } catch (e2) {}
                    }
                    return;
                }

                // Landscape uses a side panel whose close control is the safest first
                // target. Portrait lands directly in course search, matching the action
                // the user requested. Wait until the transform has been applied.
                try {
                    requestAnimationFrame(function () {
                        requestAnimationFrame(function () {
                            if (modal.__mSheetFocusToken !== focusToken || !modal.classList.contains('m-sheet-open')) return;
                            var landscape = window.matchMedia('(orientation: landscape)').matches;
                            var initial = landscape
                                ? sidebar.querySelector('.m-sched-sheet-close')
                                : sidebar.querySelector('.scheduler-search');
                            if (!initial) initial = sidebar.querySelector('.m-sched-sheet-close, .scheduler-search, button, input, select');
                            try { if (initial) initial.focus({ preventScroll: landscape }); } catch (e3) {}

                            // The landscape search row follows saved-selection panels in
                            // DOM order. Keep it near the top while the sticky close bar
                            // remains available and focused.
                            if (!landscape) return;
                            var resultsHead = sidebar.querySelector('.scheduler-results-head');
                            var sheetBar = sidebar.querySelector('.m-sched-sheet-bar');
                            if (!resultsHead) return;
                            var panelRect = sidebar.getBoundingClientRect();
                            var headRect = resultsHead.getBoundingClientRect();
                            var stickyClearance = sheetBar ? sheetBar.offsetHeight : 0;
                            sidebar.scrollTop += headRect.top - panelRect.top - stickyClearance - 8;
                        });
                    });
                } catch (e4) {}
            }
            // First visible day that a committed (non-preview) course block sits on.
            function firstDayForCourse(modal, courseId) {
                var order = ['M', 'T', 'W', 'R', 'F', 'S', 'U'];
                var days = {};
                var blocks = modal.querySelectorAll('.scheduler-day-col .scheduler-block');
                for (var i = 0; i < blocks.length; i++) {
                    var b = blocks[i];
                    if (b.classList.contains('is-preview')) continue;
                    if (b.getAttribute('data-course') !== courseId) continue;
                    var d = b.getAttribute('data-day');
                    if (d) days[d] = true;
                }
                for (var j = 0; j < order.length; j++) if (days[order[j]]) return order[j];
                return null;
            }
            // After a section is picked, wait for its committed block(s) to render, then
            // (portrait only) switch to the first day it meets so the add lands on a
            // relevant day. Polls briefly, self-clears, and is superseded by a newer pick.
            function scheduleJumpToCourse(modal, courseId) {
                if (!courseId) return;
                modal.__mJumpCourse = courseId;
                var tries = 0;
                var iv = setInterval(function () {
                    if (modal.__mJumpCourse !== courseId) { clearInterval(iv); return; }
                    var day = firstDayForCourse(modal, courseId);
                    if (day) {
                        if (window.matchMedia('(orientation: portrait)').matches) setDay(modal, day);
                        modal.__mJumpCourse = null;
                        clearInterval(iv);
                    } else if (++tries > 80) { // ~12s, covers the section-chooser detour
                        if (modal.__mJumpCourse === courseId) modal.__mJumpCourse = null;
                        clearInterval(iv);
                    }
                }, 150);
            }

            function mobilize(modal) {
                if (modal.__mSched) return;
                modal.__mSched = true;
                modal.classList.add('m-scheduler');
                updateFitPpm(); // ensure the landscape px-per-minute var is current
                // Once the grid (and its blocks) have rendered, correct the landscape fit
                // from the real grid height so the week fills the whole area exactly.
                try { setTimeout(refitLandscapeInPlace, 350); } catch (e00) {}
                // Enable the sheet's slide transition only after the initial hide has
                // painted, so opening the scheduler doesn't animate the sidebar away
                // (it would look like the Add-courses panel flashing open then closing).
                try {
                    requestAnimationFrame(function () {
                        requestAnimationFrame(function () { modal.classList.add('m-sheet-ready'); });
                    });
                } catch (e0) { modal.classList.add('m-sheet-ready'); }

                // Landscape-only compact/tall toggle for the week grid. Compact (default)
                // fits the whole day on one screen; tall gives portrait-sized cards and
                // scrolls the week instead. Injected into the header actions (before the ⋮),
                // shown only in landscape via CSS. Drives .m-sched-tall + a live rescale.
                var hActions = modal.querySelector('.scheduler-header-actions');
                if (hActions && !hActions.querySelector('.m-sched-tall-toggle')) {
                    var tallBtn = document.createElement('button');
                    tallBtn.type = 'button';
                    tallBtn.className = 'scheduler-header-btn m-sched-tall-toggle';
                    tallBtn.setAttribute('title', 'Taller rows');
                    tallBtn.setAttribute('aria-label', 'Toggle taller rows');
                    tallBtn.setAttribute('aria-pressed', 'false');
                    tallBtn.innerHTML = '<i class="fa-solid fa-arrows-up-down" aria-hidden="true"></i>';
                    var moreBtnEl = hActions.querySelector('.scheduler-more');
                    if (moreBtnEl) hActions.insertBefore(tallBtn, moreBtnEl);
                    else hActions.appendChild(tallBtn);
                    tallBtn.addEventListener('click', function () {
                        var tall = modal.classList.toggle('m-sched-tall');
                        tallBtn.classList.toggle('is-active', tall);
                        tallBtn.setAttribute('title', tall ? 'Fit week to screen' : 'Taller rows');
                        tallBtn.setAttribute('aria-pressed', tall ? 'true' : 'false');
                        try { refitLandscapeInPlace(); } catch (e) {}
                    });
                }

                var wrap = modal.querySelector('.scheduler-grid-wrap');
                if (!wrap) return;
                var sel = document.createElement('div');
                sel.className = 'm-sched-days';
                wrap.insertBefore(sel, wrap.firstChild);
                sel.addEventListener('click', function (e) {
                    var btn = e.target.closest ? e.target.closest('.m-sched-day') : null;
                    if (btn) setDay(modal, btn.getAttribute('data-day'));
                });
                syncDaySelector(modal);
                modal.addEventListener('schedulergridchange', function () {
                    syncDaySelector(modal);
                    try { setTimeout(refitLandscapeInPlace, 0); } catch (e) {}
                });

                // Portrait: the desktop left sidebar (search / filters / course list /
                // selected sections / blocked hours) is hidden inline — there's no room.
                // Surface the scheduler's own sidebar as a slide-up sheet, opened by a
                // floating button, so all its wiring keeps working untouched.
                var sidebar = modal.querySelector('.scheduler-sidebar');
                if (sidebar && !sidebar.querySelector('.m-sched-sheet-bar')) {
                    var bar = document.createElement('div');
                    bar.className = 'm-sched-sheet-bar';
                    bar.innerHTML = '<span class="m-sched-sheet-title">Add courses</span>';
                    sidebar.insertBefore(bar, sidebar.firstChild);
                }
                // Bottom-right floating button toggles the sheet: "Add courses" while
                // closed, "Done" while open — same corner so it's always thumb-reachable
                // (the sheet's own title bar sits far up-screen when scrolled).
                if (!modal.querySelector('.m-sched-fab')) {
                    var fab = document.createElement('button');
                    fab.type = 'button';
                    fab.className = 'm-sched-fab';
                    fab.innerHTML = '<i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i><span>Add courses</span>';
                    fab.addEventListener('click', function () { setCourseSheetOpen(modal, true, fab); });
                    modal.appendChild(fab);
                }
                if (!modal.querySelector('.m-sched-done-fab')) {
                    var doneFab = document.createElement('button');
                    doneFab.type = 'button';
                    doneFab.className = 'm-sched-done-fab';
                    doneFab.innerHTML = '<i class="fa-solid fa-check" aria-hidden="true"></i><span>Done</span>';
                    doneFab.addEventListener('click', function () { setCourseSheetOpen(modal, false); });
                    modal.appendChild(doneFab);
                }

                // Landscape trigger: repurpose the top-left grid corner as the "add
                // courses" search button — the desktop sidebar-toggle there is a no-op
                // once the sidebar is a sheet. The corner only exists while the week
                // header shows (landscape), so this is landscape's trigger and the FAB is
                // portrait's. Landscape closes via the × injected into the sheet header.
                var corner = modal.querySelector('.scheduler-grid-corner');
                if (corner && !corner.querySelector('.m-sched-corner-search')) {
                    var deskToggle = corner.querySelector('.scheduler-sidebar-toggle');
                    if (deskToggle) deskToggle.style.display = 'none';
                    var cSearch = document.createElement('button');
                    cSearch.type = 'button';
                    cSearch.className = 'm-sched-corner-search';
                    cSearch.setAttribute('aria-label', 'Add courses');
                    cSearch.innerHTML = '<i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>';
                    cSearch.addEventListener('click', function () { setCourseSheetOpen(modal, true, cSearch); });
                    corner.appendChild(cSearch);
                }
                var sBar = modal.querySelector('.m-sched-sheet-bar');
                if (sBar && !sBar.querySelector('.m-sched-sheet-close')) {
                    var sClose = document.createElement('button');
                    sClose.type = 'button';
                    sClose.className = 'm-sched-sheet-close';
                    sClose.setAttribute('aria-label', 'Close');
                    sClose.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
                    sClose.addEventListener('click', function () { setCourseSheetOpen(modal, false); });
                    sBar.appendChild(sClose);
                }

                // "Hover preview" is a no-op on touch — drop that toggle from the sheet's
                // filter menu (matched by label so it survives any reordering).
                var labels = modal.querySelectorAll('.scheduler-filter-menu .toggle-text');
                for (var li = 0; li < labels.length; li++) {
                    if ((labels[li].textContent || '').trim() === 'Hover preview') {
                        var trow = labels[li].closest('.scheduler-control');
                        if (trow) trow.classList.add('m-sched-hidden-row');
                        break;
                    }
                }

                // Block-hours drag is wired to mouse events only (mousedown/move on each
                // .scheduler-day-col, mouseup on document); a touch-drag pans instead, so
                // it can't work on a phone. Bridge touch→mouse, but only while block mode
                // is active so normal scrolling/tapping is untouched. Delegating on the
                // modal survives grid re-renders (the day columns are reused, not rebuilt).
                if (!modal.__mBlockTouch) {
                    modal.__mBlockTouch = true;
                    var bridgeCol = null;
                    var fireMouse = function (type, target, pt) {
                        try {
                            target.dispatchEvent(new MouseEvent(type, {
                                bubbles: true, cancelable: true, view: window,
                                clientX: pt ? pt.clientX : 0, clientY: pt ? pt.clientY : 0
                            }));
                        } catch (e) {}
                    };
                    modal.addEventListener('touchstart', function (e) {
                        if (!modal.classList.contains('is-block-mode')) return;
                        var target = e.target;
                        // Tapping an existing blocked block should remove it — let the
                        // native tap/click reach the scheduler's "Unblock hours" handler
                        // instead of us preventDefault-ing it into a (no-op) drag.
                        if (target && target.closest && target.closest('.scheduler-block-bg')) return;
                        var col = (target && target.closest) ? target.closest('.scheduler-day-col') : null;
                        if (!col) return;
                        var t = e.touches[0];
                        if (!t) return;
                        bridgeCol = col;
                        e.preventDefault(); // suppress scroll + the browser's compat mouse events
                        fireMouse('mousedown', target, t);
                    }, { passive: false });
                    modal.addEventListener('touchmove', function (e) {
                        if (!bridgeCol || !modal.classList.contains('is-block-mode')) return;
                        var t = e.touches[0];
                        if (!t) return;
                        e.preventDefault(); // stop the grid scrolling while dragging a block
                        fireMouse('mousemove', bridgeCol, t);
                    }, { passive: false });
                    var endBridge = function (e) {
                        if (!bridgeCol) return;
                        var t = (e.changedTouches && e.changedTouches[0]) || null;
                        fireMouse('mouseup', document, t);
                        bridgeCol = null;
                    };
                    modal.addEventListener('touchend', endBridge);
                    modal.addEventListener('touchcancel', endBridge);
                }

                // Tap-to-preview bar + the tap handler that drives it.
                if (!modal.querySelector('.m-sched-preview-bar')) {
                    var pbar = document.createElement('div');
                    pbar.className = 'm-sched-preview-bar';
                    pbar.innerHTML =
                        '<button type="button" class="m-prev-back"><i class="fa-solid fa-chevron-left" aria-hidden="true"></i> List</button>' +
                        '<span class="m-prev-label"></span>' +
                        '<button type="button" class="m-prev-add">Add <i class="fa-solid fa-chevron-right" aria-hidden="true"></i></button>';
                    modal.appendChild(pbar);
                    pbar.querySelector('.m-prev-back').addEventListener('click', function () {
                        endPreview(modal);
                        setCourseSheetOpen(modal, true);
                    });
                    pbar.querySelector('.m-prev-add').addEventListener('click', function () {
                        // Add the exact previewed section when a section row was tapped,
                        // otherwise the card's default Pick-section flow.
                        var row = modal.__mPreviewSectionRow;
                        var card = modal.__mPreviewCard;
                        var pick = row ? row.querySelector('.scheduler-section-pick')
                            : (card ? card.querySelector('.scheduler-pick') : null);
                        endPreview(modal);
                        // The preview controls are hidden by endPreview(). Put focus on
                        // the original sheet trigger before the section picker captures
                        // its opener, so closing that picker never returns to hidden UI.
                        setCourseSheetOpen(modal, false, modal.__mSheetOpener);
                        if (pick) pick.click();
                    });
                }
                if (!modal.__mPreviewClick) {
                    modal.__mPreviewClick = true;
                    modal.addEventListener('click', function (e) {
                        // Only from the open sheet; ignore taps on controls (let them work).
                        if (!modal.classList.contains('m-sheet-open')) return;
                        var t = e.target;
                        if (!t || !t.closest) return;
                        if (t.closest('button, a, input, select, label, .toggle-switch')) return;
                        if (!t.closest('.scheduler-results')) return;
                        // A specific section row wins over the whole card, so tapping one
                        // recitation previews that recitation's hours (not the default).
                        var sectionRow = t.closest('.scheduler-inline-section-row');
                        if (sectionRow) { startPreview(modal, sectionRow); return; }
                        var card = t.closest('.scheduler-course');
                        if (card) startPreview(modal, card);
                    });
                }
                if (!modal.__mPickJump) {
                    modal.__mPickJump = true;
                    // Picking a section (directly, or via the preview bar's Add which
                    // clicks the same button) should land the portrait view on a day the
                    // course meets. Non-stopping: scheduler.js still handles the pick.
                    modal.addEventListener('click', function (e) {
                        var pick = e.target && e.target.closest
                            ? e.target.closest('.scheduler-pick, .scheduler-section-pick') : null;
                        if (pick) scheduleJumpToCourse(modal, pick.getAttribute('data-course'));
                    });
                }
                if (!modal.__mPreviewGuard) {
                    modal.__mPreviewGuard = true;
                    // A touch tap fires a trailing mouseleave on .scheduler-results, whose
                    // own handler wipes the preview we just showed. Swallow that leave (in
                    // capture, before the target handler) while previewing — except the
                    // intentional clear from endPreview, flagged by __allowPreviewClear.
                    modal.addEventListener('mouseleave', function (e) {
                        var t = e.target;
                        var onResults = t && ((t.classList && t.classList.contains('scheduler-results')) ||
                            (t.closest && t.closest('.scheduler-results')));
                        if (!onResults) return;
                        if (modal.__allowPreviewClear) return;
                        if (modal.classList.contains('m-preview')) {
                            e.stopPropagation();
                            if (e.stopImmediatePropagation) e.stopImmediatePropagation();
                        }
                    }, true);
                }
                modal.__setCourseSheetOpen = function (open, opener) {
                    setCourseSheetOpen(modal, open, opener);
                };
                setCourseSheetOpen(modal, false);
            }

            function invalidateOpenSchedulerLayout() {
                try {
                    var modal = document.querySelector('.scheduler-modal');
                    if (modal && typeof modal.__invalidateSchedulerLayout === 'function') {
                        modal.__invalidateSchedulerLayout();
                    }
                } catch (e) {}
            }

            // Landscape "whole visible schedule fits": seed the standard 660-minute
            // day scale before the grid exists. A schedulergridchange event refits this
            // value when a selected section or preview exposes later hours.
            function updateFitPpm() {
                try {
                    if (document.body.classList.contains('is-mobile') && window.matchMedia('(orientation: landscape)').matches) {
                        // Pre-render estimate for the first paint (no grid to measure yet):
                        // overhead ≈ compact modal header + week header + top gap (~90); 660 =
                        // day length. refitLandscapeInPlace() corrects this exactly from the
                        // real grid height once it exists.
                        var ppm = (window.innerHeight - 90) / 660;
                        ppm = Math.max(0.26, Math.min(1.0, ppm));
                        var nextPpm = ppm.toFixed(3) + 'px';
                        var rootStyle = document.documentElement.style;
                        if (rootStyle.getPropertyValue('--m-fit-ppm') !== nextPpm) {
                            rootStyle.setProperty('--m-fit-ppm', nextPpm);
                            invalidateOpenSchedulerLayout();
                        }
                    } else {
                        var style = document.documentElement.style;
                        if (style.getPropertyValue('--m-fit-ppm')) {
                            style.removeProperty('--m-fit-ppm');
                            invalidateOpenSchedulerLayout();
                        }
                    }
                } catch (e) {}
            }

            // Blocks are positioned in px at render time, so a rotation needs a re-render
            // to pick up the new scale. There's no public re-render hook, so re-open the
            // modal (its state is persisted); its fresh grid reads the updated scale.
            function reRenderOpenScheduler() {
                var modal = document.querySelector('.scheduler-modal');
                if (!modal) return;
                try {
                    if (typeof modal.__setCourseSheetOpen === 'function') modal.__setCourseSheetOpen(false);
                } catch (e0) {}
                var closeBtn = modal.querySelector('.scheduler-close');
                try { if (closeBtn) closeBtn.click(); } catch (e) {}
                setTimeout(function () {
                    try { if (typeof window.openSchedulerModal === 'function') window.openSchedulerModal(); } catch (e2) {}
                }, 50);
            }

            // Target px-per-minute for the landscape week. Tall mode uses a fixed,
            // portrait-comparable scale (the week overflows and the grid scrolls);
            // compact mode fits the currently visible minute span into the *actual* grid
            // area (not a guessed viewport overhead — otherwise the last hour sits short
            // of the bottom). clientHeight is stable across ppm changes (it's the flex
            // area = modal minus its two headers). Returns null if it is not measurable.
            function landscapeTargetPpm(modal, grid, topGap) {
                if (modal.classList.contains('m-sched-tall')) return TALL_PPM;
                var avail = grid.clientHeight;
                if (!(avail > 60)) return null;
                var totalMinutes = parseFloat(modal.getAttribute('data-grid-minutes')) || 660;
                var p = (avail - topGap - 2) / totalMinutes;
                return Math.max(0.26, Math.min(1.0, p));
            }

            // Landscape only: entering fullscreen (or the URL bar hiding) grows the
            // available height AFTER the grid baked its px positions, leaving the week
            // crammed at the old scale; likewise the compact/tall toggle changes the
            // target scale. Recompute the scale and rescale the inline hour lines +
            // blocks in place — the gutter and day columns are CSS-var-driven and follow
            // --m-fit-ppm automatically. No re-render, so fullscreen is preserved.
            function refitLandscapeInPlace() {
                if (!document.body.classList.contains('is-mobile')) return;
                if (!window.matchMedia('(orientation: landscape)').matches) return;
                var modal = document.querySelector('.scheduler-modal.m-scheduler');
                var grid = modal ? modal.querySelector('.scheduler-grid') : null;
                if (!grid) return;
                try {
                    var cs = getComputedStyle(grid);
                    var oldPpm = parseFloat(cs.getPropertyValue('--scheduler-minute'));
                    var topGap = parseFloat(cs.getPropertyValue('--scheduler-top-gap')) || 14;
                    var blockGap = parseFloat(cs.getPropertyValue('--scheduler-block-gap')) || 6;
                    if (!(oldPpm > 0)) return;
                    var newPpm = landscapeTargetPpm(modal, grid, topGap);
                    if (newPpm == null) return;
                    var ratio = newPpm / oldPpm;
                    if (!(ratio > 0) || Math.abs(ratio - 1) < 0.01) return; // no meaningful change
                    document.documentElement.style.setProperty('--m-fit-ppm', newPpm.toFixed(3) + 'px');
                    invalidateOpenSchedulerLayout();
                    var lines = modal.querySelectorAll('.scheduler-hour-line'); // top = topGap + min*ppm
                    for (var i = 0; i < lines.length; i++) {
                        var lt = parseFloat(lines[i].style.top);
                        if (!isNaN(lt)) lines[i].style.top = (topGap + (lt - topGap) * ratio) + 'px';
                    }
                    var blocks = modal.querySelectorAll('.scheduler-day-col .scheduler-block'); // top adds blockGap; height = dur*ppm - 2*blockGap
                    for (var j = 0; j < blocks.length; j++) {
                        var displayStart = parseFloat(blocks[j].getAttribute('data-display-start'));
                        var displayEnd = parseFloat(blocks[j].getAttribute('data-display-end'));
                        if (!isNaN(displayStart) && !isNaN(displayEnd) && displayEnd > displayStart) {
                            blocks[j].style.top = (topGap + blockGap + ((displayStart - GRID_START_MIN) * newPpm)) + 'px';
                            blocks[j].style.height = Math.max(8, ((displayEnd - displayStart) * newPpm) - (2 * blockGap)) + 'px';
                            continue;
                        }
                        // A transient drag ghost has no meeting metadata; proportional
                        // scaling is sufficient until the scheduler replaces it.
                        var bt = parseFloat(blocks[j].style.top), bh = parseFloat(blocks[j].style.height);
                        if (!isNaN(bt)) blocks[j].style.top = (topGap + blockGap + (bt - topGap - blockGap) * ratio) + 'px';
                        if (!isNaN(bh)) blocks[j].style.height = Math.max(8, (bh + 2 * blockGap) * ratio - 2 * blockGap) + 'px';
                    }
                } catch (e) {}
            }

            function init() {
                try {
                    new MutationObserver(function (muts) {
                        if (!document.body.classList.contains('is-mobile')) return;
                        for (var i = 0; i < muts.length; i++) {
                            var added = muts[i].addedNodes;
                            for (var j = 0; j < added.length; j++) {
                                var n = added[j];
                                if (n.nodeType !== 1) continue;
                                var modal = (n.classList && n.classList.contains('scheduler-modal')) ? n :
                                    (n.querySelector ? n.querySelector('.scheduler-modal') : null);
                                if (modal) mobilize(modal);
                            }
                        }
                    }).observe(document.body, { childList: true, subtree: true });
                } catch (e) {}

                // is-mobile is applied on DOMContentLoaded (after this deferred script
                // runs), so re-run once it's set — and whenever it's re-asserted.
                updateFitPpm();
                try { window.addEventListener('DOMContentLoaded', updateFitPpm); } catch (e) {}
                try { window.addEventListener('load', updateFitPpm); } catch (e) {}
                try { document.addEventListener('themeChanged', updateFitPpm); } catch (e) {}
                try {
                    document.addEventListener('mobileModeChanged', function () {
                        updateFitPpm();
                        reRenderOpenScheduler();
                    });
                } catch (e) {}
                try {
                    var mq = window.matchMedia('(orientation: landscape)');
                    var onOrient = function () {
                        updateFitPpm();
                        if (document.body.classList.contains('is-mobile')) reRenderOpenScheduler();
                    };
                    if (mq.addEventListener) mq.addEventListener('change', onOrient);
                    else if (mq.addListener) mq.addListener(onOrient);
                } catch (e) {}
                // Height changes within landscape (fullscreen enter/exit, URL bar) re-fit
                // the week in place so it fills the freed space instead of staying crammed.
                try {
                    var refitTimer = null;
                    window.addEventListener('resize', function () {
                        if (refitTimer) clearTimeout(refitTimer);
                        refitTimer = setTimeout(refitLandscapeInPlace, 180);
                    });
                    document.addEventListener('fullscreenchange', function () {
                        setTimeout(refitLandscapeInPlace, 120);
                    });
                } catch (e) {}
            }

            if (document.body) init();
            else document.addEventListener('DOMContentLoaded', init);
        })();

        initialized = true;
        return api;
    }

    const api = Object.freeze({ init });
    const namespace = root.SurriculumMobileModules
        || (root.SurriculumMobileModules = {});
    namespace.schedulerAdaptation = api;
})(typeof window !== 'undefined' ? window : globalThis);
