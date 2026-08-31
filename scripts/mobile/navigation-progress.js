// Focused mobile navigation/progress module. Initialized by mobile.js.
(function installMobileNavigationProgress(root) {
    'use strict';

    let initialized = false;
    function init() {
        if (initialized) return api;

        /*
         * Mobile shell — bottom tab bar + screen switching.
         *
         * The nav is injected once and hidden on desktop via CSS, so it survives
         * resizing between modes. Active screen is stored in the `data-mobile-tab`
         * attribute on <body>; CSS keys off it. Planner and Controls map to the
         * existing board and sidebar; Scheduler and Progress route to their
         * existing flows until they get their own full-screen sections.
         */
        (function () {
            'use strict';

            function setTab(tab) {
                try { document.body.setAttribute('data-mobile-tab', tab); } catch (e) {}
                // Remember the tab so a full-page reload (e.g. changing major from
                // Controls) restores it instead of dumping the user back on Planner.
                try { sessionStorage.setItem('m-tab', tab); } catch (e) {}
                var items = document.querySelectorAll('.m-nav-item');
                for (var i = 0; i < items.length; i++) {
                    var active = items[i].getAttribute('data-mtab') === tab;
                    items[i].classList.toggle('active', active);
                    if (active) items[i].setAttribute('aria-current', 'page');
                    else items[i].removeAttribute('aria-current');
                }
                if (tab === 'progress') { try { buildProgress(); } catch (e) {} }
            }

            function esc(s) {
                return String(s == null ? '' : s).replace(/[&<>"]/g, function (ch) {
                    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch];
                });
            }
            function fmt(n) { var r = Math.round(n * 100) / 100; return String(r); }

            function buildProgressScreen() {
                if (document.getElementById('mProgress')) return;
                var main = document.querySelector('.main-content');
                if (!main) return;
                var el = document.createElement('div');
                el.id = 'mProgress';
                el.className = 'm-progress';
                main.appendChild(el);
            }

            // Reuse the desktop summary computation: render it (off-screen), read the
            // per-program stats, then remove the overlay before it can paint.
            function readProgramSummaries() {
                var existing = document.querySelector('.summary_modal_overlay');
                if (existing) existing.remove();
                var programs = [];
                try {
                    var btn = document.querySelector('.summary');
                    if (btn) btn.click();
                    var cards = document.querySelectorAll('.summary_cards_row .summary_modal');
                    for (var i = 0; i < cards.length; i++) {
                        var card = cards[i];
                        var title = ((card.querySelector('.summary_modal_title') || {}).textContent || '').trim();
                        var stats = [];
                        var metrics = card.querySelectorAll('.summary_metric[data-metric]');
                        for (var j = 0; j < metrics.length; j++) {
                            var metric = metrics[j];
                            var head = metric.querySelector('.summary_metric_head span');
                            var legacy = metric.querySelector('p');
                            var legacyText = legacy ? (legacy.textContent || '').trim() : '';
                            var match = legacyText.match(/^(.*?):\s*([\d.]+)\s*\/\s*([\d.]+)/);
                            var unavailable = legacyText.match(/^(.*?):\s*N\/A\s*\/\s*([\d.]+)/i);
                            if (metric.dataset.metric === 'gpa' || metric.dataset.metric === 'pgpa'
                                || metric.dataset.metric === 'main_pgpa') {
                                var averageLabel = ((head || {}).textContent || (match && match[1])
                                    || (unavailable && unavailable[1]) || metric.dataset.metric).trim();
                                var threshold = parseFloat(metric.dataset.threshold || '0');
                                var averageValue = parseFloat(metric.dataset.value || '');
                                var averageMet = metric.dataset.met === 'true';
                                if (Number.isFinite(averageValue)) {
                                    stats.push({ label: averageLabel + ' (min)', value: averageValue,
                                        limit: threshold, met: averageMet });
                                } else {
                                    stats.push({ label: averageLabel + ' (min)', value: NaN,
                                        limit: threshold, met: false, displayValue: 'N/A' });
                                }
                                continue;
                            }
                            var projected = parseFloat(metric.dataset.projected || '0');
                            var limit = parseFloat(metric.dataset.limit || '0');
                            stats.push({
                                label: ((head || {}).textContent || (match && match[1]) || metric.dataset.metric).trim(),
                                value: projected,
                                limit: limit,
                                earned: parseFloat(metric.dataset.earned || '0'),
                                current: parseFloat(metric.dataset.current || '0'),
                                future: parseFloat(metric.dataset.future || '0'),
                                unverified: parseFloat(metric.dataset.unverified || '0')
                            });
                        }
                        programs.push({ title: title, stats: stats });
                    }
                } catch (e) {}
                var ov = document.querySelector('.summary_modal_overlay');
                if (ov) ov.remove();
                return programs;
            }

            // Minors: computeMinorAllocation() and curriculum are both top-level, so we
            // call them directly (minors aren't in the summary cards_row).
            function readMinorCards() {
                var cards = [];
                try {
                    var curr = window.curriculum || (typeof curriculum !== 'undefined' ? curriculum : null);
                    var cma = window.computeMinorAllocation || (typeof computeMinorAllocation !== 'undefined' ? computeMinorAllocation : null);
                    if (!curr || !cma || !curr.minors) return cards;
                    var minors = curr.minors.filter(Boolean);
                    var progressGpa = null;
                    if (minors.length && typeof curr.getGraduationProgress === 'function') {
                        try {
                            var mainProgress = curr.getGraduationProgress('main');
                            progressGpa = mainProgress && mainProgress.gpa;
                        } catch (e) {}
                    }
                    for (var i = 0; i < minors.length; i++) {
                        var r;
                        try {
                            r = cma(curr, minors[i], { progressGpa: progressGpa });
                        } catch (e) { continue; }
                        if (!r || r.error) continue;
                        var cats = (r.req && r.req.categories) || {};
                        var done = r.totals || {};
                        var allocatedByState = {};
                        var allocated = r.allocationByCode || {};
                        Object.keys(allocated).forEach(function (code) {
                            var rec = allocated[code] || {};
                            var cat = rec.allocatedCat;
                            var state = rec.progressState || 'earned';
                            if (['earned', 'current', 'future', 'unverified'].indexOf(state) === -1) return;
                            if (!allocatedByState[cat]) allocatedByState[cat] = { earned: 0, current: 0, future: 0, unverified: 0 };
                            allocatedByState[cat][state] += Number(rec.credit || 0);
                        });
                        var stats = [], sumHave = 0, sumNeed = 0;
                        var order = ['required', 'core', 'area', 'free'];
                        for (var k = 0; k < order.length; k++) {
                            var key = order[k];
                            if (!cats[key] || !cats[key].minSU) continue;
                            var need = cats[key].minSU;
                            var have = (done[key] && done[key].credits) || 0;
                            var split = allocatedByState[key] || { earned: 0, current: 0, future: 0, unverified: 0 };
                            sumHave += have; sumNeed += need;
                            stats.push({ label: key.charAt(0).toUpperCase() + key.slice(1), value: have, limit: need,
                                earned: split.earned, current: split.current,
                                future: split.future, unverified: split.unverified });
                        }
                        if (r.gpaThreshold) {
                            var hasCgpa = Number.isFinite(Number(r.cgpa));
                            stats.push({ label: 'CGPA (min)',
                                value: hasCgpa ? Math.round(Number(r.cgpa) * 100) / 100 : NaN,
                                limit: r.gpaThreshold, met: !!r.gpaOk,
                                displayValue: hasCgpa ? null : 'N/A' });
                            var hasPgpa = Number.isFinite(Number(r.pgpa));
                            stats.push({ label: 'PGPA (min)',
                                value: hasPgpa ? Math.round(Number(r.pgpa) * 100) / 100 : NaN,
                                limit: r.gpaThreshold, met: !!r.pgpaOk,
                                displayValue: hasPgpa ? null : 'N/A' });
                        }
                        cards.push({
                            code: minors[i],
                            title: r.title || (minors[i] + ' Minor'),
                            bar: sumNeed ? {
                                value: sumHave, limit: sumNeed, label: 'SU credits',
                                earned: stats.reduce(function (n, s) { return n + (s.earned || 0); }, 0),
                                current: stats.reduce(function (n, s) { return n + (s.current || 0); }, 0),
                                future: stats.reduce(function (n, s) { return n + (s.future || 0); }, 0),
                                unverified: stats.reduce(function (n, s) { return n + (s.unverified || 0); }, 0)
                            } : null,
                            stats: stats
                        });
                    }
                } catch (e) {}
                return cards;
            }

            function buildProgress() {
                var screen = document.getElementById('mProgress');
                if (!screen) return;
                var cards = [], descriptors = [];
                var majors = readProgramSummaries();
                for (var i = 0; i < majors.length; i++) {
                    var p = majors[i], su = null, rest = [];
                    for (var k = 0; k < p.stats.length; k++) {
                        if (p.stats[k].label === 'SU Credits') su = p.stats[k]; else rest.push(p.stats[k]);
                    }
                    cards.push({ title: p.title, bar: su ? Object.assign({}, su, { label: 'SU credits' }) : null, stats: rest });
                    descriptors.push({ type: 'major', domIndex: i });
                }
                var minorCards = readMinorCards();
                for (var mi = 0; mi < minorCards.length; mi++) {
                    cards.push(minorCards[mi]);
                    descriptors.push({ type: 'minor', code: minorCards[mi].code, minorIndex: mi });
                }
                if (!cards.length) {
                    screen.innerHTML = '<div class="m-prog-empty">Pick a program in Controls to see your progress.</div>';
                    return;
                }
                var html = '';
                for (var c = 0; c < cards.length; c++) {
                    var card = cards[c];
                    var pct = (card.bar && card.bar.limit) ? Math.min(100, Math.round(card.bar.value / card.bar.limit * 100)) : 0;
                    html += '<div class="m-prog-card" id="m-progress-program-' + c
                        + '" role="region" aria-label="' + esc(card.title) + '">';
                    html += '<div class="m-prog-title">' + esc(card.title) + '</div>';
                    if (card.bar) {
                        html += '<div class="m-prog-barrow"><span>' + fmt(card.bar.value) + ' / ' + fmt(card.bar.limit) + ' ' + esc(card.bar.label) + '</span><span>' + pct + '%</span></div>';
                        if (card.bar.earned !== undefined) {
                            var denom = Math.max(card.bar.value, card.bar.limit, 1);
                            var barLabel = fmt(card.bar.earned) + ' earned, ' + fmt(card.bar.current) + ' current, ' + fmt(card.bar.future) + ' future, ' + fmt(card.bar.unverified) + ' needs grade, ' + fmt(card.bar.value) + ' projected of ' + fmt(card.bar.limit);
                            html += '<div class="m-prog-bar is-segmented" role="img" aria-label="' + esc(barLabel) + '">';
                            html += '<div class="m-prog-fill is-earned" style="width:' + (Math.max(0, card.bar.earned) / denom * 100) + '%"></div>';
                            html += '<div class="m-prog-fill is-current" style="width:' + (Math.max(0, card.bar.current) / denom * 100) + '%"></div>';
                            html += '<div class="m-prog-fill is-future" style="width:' + (Math.max(0, card.bar.future) / denom * 100) + '%"></div>';
                            html += '<div class="m-prog-fill is-unverified" style="width:' + (Math.max(0, card.bar.unverified) / denom * 100) + '%"></div></div>';
                            html += '<div class="m-prog-breakdown"><span class="is-earned">' + fmt(card.bar.earned) + ' earned</span><span class="is-current">' + fmt(card.bar.current) + ' current</span><span class="is-future">' + fmt(card.bar.future) + ' future</span>' + (card.bar.unverified ? '<span class="is-unverified">' + fmt(card.bar.unverified) + ' needs grade</span>' : '') + '</div>';
                        } else {
                            html += '<div class="m-prog-bar"><div class="m-prog-fill" style="width:' + pct + '%"></div></div>';
                        }
                    }
                    html += '<div class="m-prog-grid">';
                    for (var j = 0; j < card.stats.length; j++) {
                        var s = card.stats[j];
                        var earnedMet = s.earned !== undefined && s.earned >= s.limit;
                        var met = (s.met !== undefined) ? s.met : (s.value >= s.limit);
                        var statClass = earnedMet ? ' is-met' : (met ? ' is-projected-met' : '');
                        var val = s.displayValue
                            ? esc(s.displayValue) + ' / ' + fmt(s.limit)
                            : s.earned !== undefined
                            ? '<span class="is-earned">' + fmt(s.earned) + ' earned</span><span>' + fmt(s.value) + ' projected / ' + fmt(s.limit) + '</span>'
                            : fmt(s.value) + ' / ' + fmt(s.limit);
                        html += '<div class="m-prog-stat' + statClass + '"><div class="m-prog-lbl">' + esc(s.label) + '</div><div class="m-prog-val">' + val + '</div></div>';
                    }
                    html += '</div></div>';
                }
                var multi = cards.length > 1;
                var dots = '';
                for (var d = 0; d < cards.length; d++) {
                    dots += '<button class="m-prog-dot' + (d === 0 ? ' active' : '')
                        + '" type="button" data-i="' + d + '" aria-label="Show ' + esc(cards[d].title)
                        + '" aria-controls="m-progress-program-' + d + '"'
                        + (d === 0 ? ' aria-current="true"' : '') + '></button>';
                }
                screen.innerHTML =
                    '<div class="m-prog-carousel' + (multi ? ' is-multi' : '') + '">' + html + '</div>' +
                    '<div class="m-prog-dots' + (multi ? '' : ' is-single') + '">' + dots + '</div>' +
                    '<div class="m-prog-detail"></div>';
                screen._mDescriptors = descriptors;
                wireProgressCarousel(screen);
                if (descriptors.length) loadDetailFor(descriptors[0]);
            }

            // Detail accordion: re-render the desktop detailed summary for one program,
            // relocate its .major-summary / .minor-summary out of the modal into the
            // Progress detail area, and make each .ms-section header collapse its list.
            function loadDetailFor(descriptor) {
                var area = document.querySelector('.m-prog-detail');
                if (!area || !descriptor) return;
                var ex = document.querySelector('.summary_modal_overlay');
                if (ex) ex.remove();
                var content = null;
                try {
                    var sumBtn = document.querySelector('.summary');
                    if (sumBtn) sumBtn.click();
                    if (descriptor.type === 'major') {
                        var mcards = document.querySelectorAll('.summary_cards_row .summary_modal');
                        var card = mcards[descriptor.domIndex];
                        var db = card ? card.querySelector('.summary_detail_btn') : null;
                        if (db) { db.click(); content = document.querySelector('.summary_major_panel .major-summary'); }
                    } else {
                        var mbtns = document.querySelectorAll('.summary_minor_row button');
                        var target = mbtns[descriptor.minorIndex] || null;
                        if (target) { target.click(); content = document.querySelector('.summary_minor_panel .minor-summary'); }
                    }
                } catch (e) {}
                area.innerHTML = '';
                if (content) {
                    area.appendChild(content);
                    wireAccordionSections(area);
                    wireUntakenToggles(area);
                }
                var cleanup = document.querySelector('.summary_modal_overlay');
                if (cleanup) cleanup.remove();
            }

            // The desktop "Show untaken" handler is bound to the (now-discarded) panel,
            // so re-bind fresh handlers scoped to the relocated detail area.
            function wireUntakenToggles(area) {
                var btns = area.querySelectorAll('.ms-untaken-toggle');
                for (var i = 0; i < btns.length; i++) {
                    var fresh = btns[i].cloneNode(true);
                    btns[i].parentNode.replaceChild(fresh, btns[i]);
                    (function (btn) {
                        var targetId = btn.getAttribute('data-target');
                        var count = btn.getAttribute('data-count') || '';
                        btn.addEventListener('click', function (e) {
                            e.preventDefault();
                            e.stopPropagation();
                            var target = targetId ? area.querySelector('[id="' + targetId + '"]') : null;
                            if (!target) return;
                            var hidden = target.classList.toggle('is-hidden');
                            btn.textContent = (hidden ? 'Show untaken (' : 'Hide untaken (') + count + ')';
                        });
                    })(fresh);
                }
            }

            function wireAccordionSections(area) {
                var sections = area.querySelectorAll('.ms-section');
                for (var i = 0; i < sections.length; i++) {
                    (function (sec, idx) {
                        var sourceHeader = sec.querySelector(':scope > .ms-header');
                        if (!sourceHeader) return;
                        var header = sourceHeader;
                        if (sourceHeader.tagName !== 'BUTTON') {
                            header = document.createElement('button');
                            header.type = 'button';
                            header.className = sourceHeader.className;
                            while (sourceHeader.firstChild) {
                                var child = sourceHeader.firstChild;
                                if (child.nodeType === 1 && child.tagName === 'DIV') {
                                    var span = document.createElement('span');
                                    span.className = child.className;
                                    while (child.firstChild) span.appendChild(child.firstChild);
                                    sourceHeader.removeChild(child);
                                    header.appendChild(span);
                                } else {
                                    header.appendChild(child);
                                }
                            }
                            sourceHeader.parentNode.replaceChild(header, sourceHeader);
                        }
                        var controlledIds = [];
                        var contentIndex = 0;
                        for (var content = header.nextElementSibling; content; content = content.nextElementSibling) {
                            if (!content.id) content.id = 'm-progress-section-' + idx + '-content-' + (++contentIndex);
                            controlledIds.push(content.id);
                        }
                        if (controlledIds.length) header.setAttribute('aria-controls', controlledIds.join(' '));
                        if (idx > 0) sec.classList.add('m-sec-collapsed');
                        else sec.classList.remove('m-sec-collapsed');
                        var syncExpanded = function () {
                            header.setAttribute('aria-expanded', sec.classList.contains('m-sec-collapsed') ? 'false' : 'true');
                        };
                        syncExpanded();
                        header.addEventListener('click', function () {
                            sec.classList.toggle('m-sec-collapsed');
                            syncExpanded();
                        });
                    })(sections[i], i);
                }
            }

            // Peek-carousel: cards swipe horizontally (scroll-snap); dots track the
            // active card and can be tapped to jump. Degrades to one full-width card.
            function wireProgressCarousel(screen) {
                var carousel = screen.querySelector('.m-prog-carousel');
                if (!carousel) return;
                var dots = screen.querySelectorAll('.m-prog-dot');
                var cardEls = carousel.querySelectorAll('.m-prog-card');
                function activeIndex() {
                    var cl = carousel.getBoundingClientRect().left, idx = 0, min = Infinity;
                    for (var i = 0; i < cardEls.length; i++) {
                        var dd = Math.abs(cardEls[i].getBoundingClientRect().left - cl);
                        if (dd < min) { min = dd; idx = i; }
                    }
                    return idx;
                }
                var detailTimer = null, lastDetailIdx = 0;
                function syncDots() {
                    var idx = activeIndex();
                    for (var j = 0; j < dots.length; j++) {
                        var active = j === idx;
                        dots[j].classList.toggle('active', active);
                        if (active) dots[j].setAttribute('aria-current', 'true');
                        else dots[j].removeAttribute('aria-current');
                    }
                    if (idx !== lastDetailIdx) {
                        clearTimeout(detailTimer);
                        detailTimer = setTimeout(function () {
                            lastDetailIdx = idx;
                            var descs = screen._mDescriptors || [];
                            if (descs[idx]) { try { loadDetailFor(descs[idx]); } catch (e) {} }
                        }, 180);
                    }
                }
                carousel.addEventListener('scroll', syncDots, { passive: true });
                for (var i = 0; i < dots.length; i++) {
                    (function (i) {
                        dots[i].addEventListener('click', function () {
                            if (!cardEls[i]) return;
                            carousel.scrollBy({ left: cardEls[i].getBoundingClientRect().left - carousel.getBoundingClientRect().left, behavior: 'smooth' });
                        });
                    })(i);
                }
            }

            function buildNav() {
                if (document.getElementById('mNav')) return;
                var app = document.querySelector('.app');
                if (!app) return;

                var nav = document.createElement('nav');
                nav.className = 'm-nav';
                nav.id = 'mNav';
                nav.setAttribute('role', 'navigation');
                nav.setAttribute('aria-label', 'Primary');
                nav.innerHTML =
                    '<button class="m-nav-item" type="button" data-mtab="planner"><i class="fa-solid fa-table-columns" aria-hidden="true"></i><span>Planner</span></button>' +
                    '<button class="m-nav-item" type="button" data-maction="scheduler"><i class="fa-solid fa-calendar-days" aria-hidden="true"></i><span>Scheduler</span></button>' +
                    '<button class="m-nav-item" type="button" data-mtab="progress"><i class="fa-solid fa-circle-check" aria-hidden="true"></i><span>Progress</span></button>' +
                    '<button class="m-nav-item" type="button" data-mtab="controls"><i class="fa-solid fa-sliders" aria-hidden="true"></i><span>Controls</span></button>';
                app.appendChild(nav);

                nav.addEventListener('click', function (e) {
                    var btn = e.target.closest ? e.target.closest('.m-nav-item') : null;
                    if (!btn) return;
                    var tab = btn.getAttribute('data-mtab');
                    var action = btn.getAttribute('data-maction');
                    if (tab) {
                        setTab(tab);
                    } else if (action === 'scheduler') {
                        try { if (typeof window.openSchedulerModal === 'function') window.openSchedulerModal(); } catch (e2) {}
                    } else if (action === 'progress') {
                        // Interim: reuse the existing graduation check until Progress
                        // gets its own merged full-screen section.
                        try { var c = document.querySelector('.check'); if (c) c.click(); } catch (e3) {}
                    }
                });
            }

            function initShell() {
                buildNav();
                buildProgressScreen();
                var current = document.body.getAttribute('data-mobile-tab');
                var saved = null;
                try { saved = sessionStorage.getItem('m-tab'); } catch (e) {}
                var initial = (current === 'controls' || current === 'progress' || current === 'planner')
                    ? current : ((saved === 'controls' || saved === 'progress') ? saved : 'planner');
                setTab(initial);
            }

            // Exposed for debugging / future in-app navigation.
            window.SUrriculumSetTab = setTab;

            if (document.body) initShell();
            else document.addEventListener('DOMContentLoaded', initShell);
        })();

        initialized = true;
        return api;
    }

    const api = Object.freeze({ init });
    const namespace = root.SurriculumMobileModules
        || (root.SurriculumMobileModules = {});
    namespace.navigationProgress = api;
})(typeof window !== 'undefined' ? window : globalThis);
