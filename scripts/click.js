function dynamic_click(e, curriculum, course_data)
{
    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // Guard against early interaction before course data is available. If
    // the course list has not yet been loaded (e.g., the user clicked
    // "Add Course" while the data is still fetching), prevent
    // interaction and notify the user. This avoids an empty dropdown
    // and confusing "Course Not Found" errors.
    if (!Array.isArray(course_data) || course_data.length === 0) {
        // When no course data is available (either still fetching or failed
        // to load due to browser security constraints), disable
        // course-related actions and inform the user.  Accessing local
        // JSON files via file:// is blocked in many browsers.  Running
        // SUrriculum from a local web server or launching Chrome with
        // --allow-file-access-from-files will resolve this.
        if (e.target.classList.contains('addCourse') || e.target.classList.contains('enter')) {
            try {
                const ui = (typeof window !== 'undefined') ? window.uiModal : null;
                const body =
                    '<p>Course data is unavailable.</p>' +
                    '<p>If you opened the app via <code>file://</code>, your browser may block loading the course files.</p>' +
                    '<p>Please run SUrriculum via a local web server (recommended) or enable file access to load course lists.</p>';
                if (ui && typeof ui.alert === 'function') {
                    ui.alert('Course data unavailable', body);
                } else {
                    console.warn('Course data is unavailable.');
                }
            } catch (_) {}
            return;
        }
    }

    //CLICKED "+ Add Course":
    if(e.target.classList.contains("addCourse"))
    {
        const semesterContainer = (() => {
            try { return e.target.closest('.container_semester'); } catch (_) { return null; }
        })();
        const getSemesterTermName = () => {
            try {
                const p = semesterContainer ? semesterContainer.querySelector('.date p') : null;
                return p ? String(p.textContent || '').trim() : '';
            } catch (_) {
                return '';
            }
        };
        const targetSemesterElement = semesterContainer
            ? semesterContainer.querySelector('.semester') : null;
        const targetSemester = targetSemesterElement && curriculum
            && typeof curriculum.getSemester === 'function'
            ? curriculum.getSemester(targetSemesterElement.id) : null;
        const targetTermCode = (() => {
            try {
                if (typeof semesterTermCode === 'function') {
                    return String(semesterTermCode(targetSemester) || '');
                }
                if (typeof window !== 'undefined' && typeof window.semesterTermCode === 'function') {
                    return String(window.semesterTermCode(targetSemester) || '');
                }
            } catch (_) {}
            return '';
        })();
        const targetTermLabel = String(
            (targetSemester && (targetSemester.termName || targetSemester.date))
            || getSemesterTermName()
            || targetTermCode
            || 'this semester',
        );

        const readPreference = (key, fallback) => {
            try {
                const storage = (typeof window !== 'undefined') ? window.preferenceStorage : null;
                const value = storage && typeof storage.getItem === 'function'
                    ? storage.getItem(key) : null;
                return value === null ? fallback : String(value);
            } catch (_) {
                return fallback;
            }
        };
        const readBoolPreference = (key, fallback) => {
            const value = readPreference(key, fallback ? 'true' : 'false');
            return value === 'true';
        };
        const writePreference = (key, value) => {
            try {
                const storage = (typeof window !== 'undefined') ? window.preferenceStorage : null;
                if (storage && typeof storage.setItem === 'function') {
                    storage.setItem(key, String(value));
                }
            } catch (_) {}
        };

        let input_container =  document.createElement("div");
        input_container.classList.add("input_container");

        // Wrapper to position the custom dropdown relative to the input
        let wrapper = document.createElement('div');
        wrapper.classList.add('input-wrapper');

        const pickerId = 'planner_course_picker_' + Date.now() + '_'
            + Math.random().toString(16).slice(2);
        const listId = pickerId + '_list';
        const filterMenuId = pickerId + '_filters';

        let input = document.createElement("input");
        input.type = 'search';
        input.classList.add("course_select", "select-control");
        input.placeholder = 'Search courses';
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.setAttribute('role', 'combobox');
        input.setAttribute('aria-label', `Search courses for ${targetTermLabel}`);
        input.setAttribute('aria-autocomplete', 'list');
        input.setAttribute('aria-controls', listId);
        input.setAttribute('aria-expanded', 'false');

        const searchRow = document.createElement('div');
        searchRow.className = 'planner-course-search-row';

        const filterButton = document.createElement('button');
        filterButton.type = 'button';
        filterButton.className = 'btn btn-secondary btn-sm planner-course-filter-btn';
        filterButton.setAttribute('aria-label', 'Course filters');
        filterButton.setAttribute('aria-haspopup', 'dialog');
        filterButton.setAttribute('aria-expanded', 'false');
        filterButton.setAttribute('aria-controls', filterMenuId);
        filterButton.innerHTML = '<i class="fa-solid fa-filter" aria-hidden="true"></i>'
            + '<span class="planner-filter-btn-label">Filters</span>'
            + '<span class="planner-course-filter-count" hidden>0</span>';

        // Hidden datalist maintained for backwards compatibility but not used.
        let datalist = document.createElement('datalist');
        datalist.id = pickerId + '_legacy_list';
        datalist.classList.add('course_list');
        populateCourseDataList(datalist, course_data);

        // Custom dropdown container
        let dropdown = document.createElement('div');
        dropdown.classList.add('course-dropdown');
        dropdown.id = listId;
        dropdown.setAttribute('role', 'listbox');
        dropdown.setAttribute('aria-label', `Course suggestions for ${targetTermLabel}`);

        const filterMenu = document.createElement('div');
        filterMenu.className = 'planner-course-filter-menu';
        filterMenu.id = filterMenuId;
        filterMenu.hidden = true;
        filterMenu.setAttribute('role', 'dialog');
        filterMenu.setAttribute('aria-label', 'Course filter options');

        const hideTakenId = pickerId + '_hide_taken';
        const offeredId = pickerId + '_offered';
        const prerequisitesId = pickerId + '_prerequisites';
        const showUnmetId = pickerId + '_show_unmet';
        const programId = pickerId + '_program';
        const categoryId = pickerId + '_category';
        const levelId = pickerId + '_level';
        const minSuId = pickerId + '_min_su';
        const minEctsId = pickerId + '_min_ects';
        const minBsId = pickerId + '_min_bs';
        const minEngineeringId = pickerId + '_min_engineering';
        const detailsId = pickerId + '_details';
        const smartSortId = pickerId + '_smart_sort';
        filterMenu.innerHTML =
            '<div class="planner-course-filter-header">'
            + '  <div>'
            + '    <div class="planner-course-filter-title">Course filters</div>'
            + '    <div class="planner-course-filter-context"></div>'
            + '  </div>'
            + '</div>'
            + '<fieldset class="planner-course-filter-section">'
            + '  <legend>Eligibility</legend>'
            + `  <label class="planner-filter-toggle" for="${hideTakenId}"><span>Hide courses planned by this semester</span><input class="planner-filter-hide-taken" id="${hideTakenId}" type="checkbox"></label>`
            + `  <label class="planner-filter-toggle" for="${offeredId}"><span>Only offered in this semester</span><input class="planner-filter-offered" id="${offeredId}" type="checkbox"></label>`
            + `  <label class="planner-filter-toggle" for="${prerequisitesId}"><span>Check requirements</span><input class="planner-filter-prerequisites" id="${prerequisitesId}" type="checkbox"></label>`
            + `  <label class="planner-filter-toggle" for="${showUnmetId}"><span>Show courses with unmet requirements</span><input class="planner-filter-show-unmet" id="${showUnmetId}" type="checkbox"></label>`
            + '</fieldset>'
            + '<fieldset class="planner-course-filter-section">'
            + '  <legend>Curriculum</legend>'
            + '  <div class="planner-filter-grid">'
            + `    <label class="planner-filter-control is-wide" for="${programId}"><span>Program</span><select class="select-control planner-filter-program" id="${programId}"></select></label>`
            + `    <label class="planner-filter-control" for="${categoryId}"><span>Exact category</span><select class="select-control planner-filter-category" id="${categoryId}"><option value="">Any category</option><option value="required">Required</option><option value="university">University</option><option value="core">Core</option><option value="area">Area</option><option value="free">Free</option></select></label>`
            + `    <label class="planner-filter-control" for="${levelId}"><span>Course level</span><select class="select-control planner-filter-level" id="${levelId}"><option value="">Any level</option><option value="100">100-level</option><option value="200">200-level</option><option value="300">300-level</option><option value="400">400-level</option><option value="500">500-level</option><option value="600">600-level</option></select></label>`
            + '  </div>'
            + '</fieldset>'
            + '<fieldset class="planner-course-filter-section">'
            + '  <legend>Credits</legend>'
            + '  <div class="planner-filter-grid">'
            + `    <label class="planner-filter-control" for="${minSuId}"><span>Minimum SU</span><input class="select-control planner-filter-min-su" id="${minSuId}" type="number" min="0" step="0.5" placeholder="0"></label>`
            + `    <label class="planner-filter-control" for="${minEctsId}"><span>Minimum ECTS</span><input class="select-control planner-filter-min-ects" id="${minEctsId}" type="number" min="0" step="1" placeholder="0"></label>`
            + `    <label class="planner-filter-control" for="${minBsId}"><span>Minimum Basic Science</span><input class="select-control planner-filter-min-bs" id="${minBsId}" type="number" min="0" step="0.5" placeholder="0"></label>`
            + `    <label class="planner-filter-control" for="${minEngineeringId}"><span>Minimum Engineering</span><input class="select-control planner-filter-min-engineering" id="${minEngineeringId}" type="number" min="0" step="0.5" placeholder="0"></label>`
            + '  </div>'
            + '</fieldset>'
            + '<fieldset class="planner-course-filter-section">'
            + '  <legend>Display &amp; sorting</legend>'
            + `  <label class="planner-filter-toggle" for="${detailsId}"><span>Show course details</span><input class="planner-filter-details" id="${detailsId}" type="checkbox"></label>`
            + `  <label class="planner-filter-toggle" for="${smartSortId}"><span>Smart Sort</span><input class="planner-filter-smart-sort" id="${smartSortId}" type="checkbox"></label>`
            + '</fieldset>'
            + '<div class="planner-course-filter-footer">'
            + '  <div class="planner-filter-status" role="status" aria-live="polite"></div>'
            + '  <button class="btn btn-secondary btn-sm planner-filter-reset" type="button">Reset filters</button>'
            + '</div>';

        const filterContextText = filterMenu.querySelector('.planner-course-filter-context');
        if (filterContextText) {
            filterContextText.textContent = targetTermCode
                ? `Requirements and offerings are checked for ${targetTermLabel}.`
                : 'Semester identity is unavailable; term-based filters fail open.';
        }

        const programSelect = filterMenu.querySelector('.planner-filter-program');
        const appendProgramOption = (value, label) => {
            if (!programSelect || !value) return;
            if (Array.from(programSelect.options).some((option) => option.value === value)) return;
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            programSelect.appendChild(option);
        };
        if (programSelect) {
            const anyProgram = document.createElement('option');
            anyProgram.value = '';
            anyProgram.textContent = 'Any selected program';
            programSelect.appendChild(anyProgram);
            const mainProgram = String(curriculum && curriculum.major ? curriculum.major : '').trim().toUpperCase();
            const doubleMajor = String(curriculum && curriculum.doubleMajor ? curriculum.doubleMajor : '').trim().toUpperCase();
            appendProgramOption(mainProgram, mainProgram ? `${mainProgram} (Main major)` : '');
            if (doubleMajor && doubleMajor !== 'NONE') {
                appendProgramOption(doubleMajor, `${doubleMajor} (Double major)`);
            }
            const minors = curriculum && Array.isArray(curriculum.minors) ? curriculum.minors : [];
            minors.forEach((minor) => {
                const code = String(minor || '').trim().toUpperCase();
                if (code) appendProgramOption(code, `${code} (Minor)`);
            });
        }

        const controls = {
            hideTaken: filterMenu.querySelector('.planner-filter-hide-taken'),
            offeredOnly: filterMenu.querySelector('.planner-filter-offered'),
            checkPrerequisites: filterMenu.querySelector('.planner-filter-prerequisites'),
            showUnmetPrerequisites: filterMenu.querySelector('.planner-filter-show-unmet'),
            program: programSelect,
            category: filterMenu.querySelector('.planner-filter-category'),
            level: filterMenu.querySelector('.planner-filter-level'),
            minSu: filterMenu.querySelector('.planner-filter-min-su'),
            minEcts: filterMenu.querySelector('.planner-filter-min-ects'),
            minBasicScience: filterMenu.querySelector('.planner-filter-min-bs'),
            minEngineering: filterMenu.querySelector('.planner-filter-min-engineering'),
            details: filterMenu.querySelector('.planner-filter-details'),
            smartSort: filterMenu.querySelector('.planner-filter-smart-sort'),
            status: filterMenu.querySelector('.planner-filter-status'),
            count: filterButton.querySelector('.planner-course-filter-count'),
        };

        controls.hideTaken.checked = (typeof window.hideTakenCourses === 'boolean')
            ? window.hideTakenCourses : readBoolPreference('hideTakenCourses', true);
        controls.offeredOnly.checked = (typeof window.plannerFilterOfferedOnly === 'boolean')
            ? window.plannerFilterOfferedOnly
            : readBoolPreference('plannerFilterOfferedOnly', true);
        controls.checkPrerequisites.checked = readBoolPreference('plannerFilterCheckPrerequisites', true);
        controls.showUnmetPrerequisites.checked = readBoolPreference('plannerFilterShowUnmetPrerequisites', true);
        controls.program.value = readPreference('plannerFilterProgram', '');
        controls.category.value = readPreference('plannerFilterCategory', '');
        controls.level.value = readPreference('plannerFilterLevel', '');
        controls.minSu.value = readPreference('plannerFilterMinSu', '');
        controls.minEcts.value = readPreference('plannerFilterMinEcts', '');
        controls.minBasicScience.value = readPreference('plannerFilterMinBasicScience', '');
        controls.minEngineering.value = readPreference('plannerFilterMinEngineering', '');
        controls.details.checked = (typeof window.showCourseDetails === 'boolean')
            ? window.showCourseDetails : readBoolPreference('showCourseDetails', true);
        controls.smartSort.checked = (typeof window.sortBasedOnScore === 'boolean')
            ? window.sortBasedOnScore : readBoolPreference('sortBasedOnScore', true);

        const filterApi = (typeof window !== 'undefined') ? window.courseFilters : null;
        let candidates = filterApi && typeof filterApi.buildCandidates === 'function'
            ? filterApi.buildCandidates(course_data, curriculum)
            : getCoursesList(course_data);
        let courseInfoByCode = null;
        let offeredCourseCodes = null;
        let courseInfoLoaded = false;
        let offeringsLoaded = false;
        const requirementContext = filterApi && typeof filterApi.buildTargetContext === 'function'
            ? filterApi.buildTargetContext(curriculum, targetSemester)
            : null;

        const positionDropdown = () => {
            try {
                if (!dropdown || dropdown.style.display === 'none') return;
                const anchor = searchRow.getBoundingClientRect();
                const pane = targetSemesterElement
                    ? targetSemesterElement.getBoundingClientRect() : null;
                const card = semesterContainer
                    ? semesterContainer.getBoundingClientRect() : null;
                const boardEl = semesterContainer && semesterContainer.closest
                    ? semesterContainer.closest('.board') : null;
                const board = boardEl ? boardEl.getBoundingClientRect() : null;
                const visual = window.visualViewport || null;
                const viewportTop = visual ? Number(visual.offsetTop || 0) : 0;
                const viewportLeft = visual ? Number(visual.offsetLeft || 0) : 0;
                const viewportW = visual
                    ? Number(visual.width || 0)
                    : (window.innerWidth || document.documentElement.clientWidth || 0);
                const viewportH = visual
                    ? Number(visual.height || 0)
                    : (window.innerHeight || document.documentElement.clientHeight || 0);
                const layoutViewportH = window.innerHeight
                    || document.documentElement.clientHeight
                    || viewportH;
                const viewportRight = viewportLeft + viewportW;
                const viewportBottom = viewportTop + viewportH;
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

                // Use the semester's visible course pane as the natural upper
                // boundary. A tall card therefore exposes a taller suggestion
                // list, while its semester title/actions remain unobscured.
                const aboveTop = Math.max(safeTop, pane ? pane.top : safeTop);
                const belowBottom = Math.min(
                    safeBottom,
                    card ? card.bottom : safeBottom,
                );
                const naturalSpaceAbove = Math.max(0, anchor.top - gap - aboveTop);
                const naturalSpaceBelow = Math.max(0, belowBottom - anchor.bottom - gap);
                const boardSpaceAbove = Math.max(0, anchor.top - gap - safeTop);
                const boardSpaceBelow = Math.max(0, safeBottom - anchor.bottom - gap);
                const cardVisibleHeight = card
                    ? Math.max(0, Math.min(card.bottom, safeBottom) - Math.max(card.top, safeTop))
                    : Math.max(spaceAbove, spaceBelow);
                const desiredHeight = Math.min(
                    560,
                    Math.max(240, Math.round(cardVisibleHeight * 0.72)),
                    Math.max(1, Math.round(viewportH * 0.72)),
                );
                const preferredMinimum = Math.min(160, desiredHeight);
                // A short/empty card may not have enough natural course-pane
                // room for even one result. In that case use the containing
                // board's safe area rather than rendering a tiny, unusable list.
                const useBoardFallback = Math.max(naturalSpaceAbove, naturalSpaceBelow)
                    < preferredMinimum;
                const spaceAbove = useBoardFallback ? boardSpaceAbove : naturalSpaceAbove;
                const spaceBelow = useBoardFallback ? boardSpaceBelow : naturalSpaceBelow;
                const openAbove = spaceAbove >= preferredMinimum || spaceAbove >= spaceBelow;
                const availableHeight = openAbove ? spaceAbove : spaceBelow;
                const maxH = Math.max(1, Math.min(desiredHeight, availableHeight));

                dropdown.style.left = left + 'px';
                dropdown.style.width = width + 'px';
                dropdown.style.right = 'auto';
                dropdown.style.maxHeight = Math.floor(maxH) + 'px';
                dropdown.dataset.placement = openAbove ? 'above' : 'below';
                if (openAbove) {
                    dropdown.style.top = 'auto';
                    dropdown.style.bottom = Math.round(layoutViewportH - anchor.top + gap) + 'px';
                } else {
                    dropdown.style.top = Math.round(anchor.bottom + gap) + 'px';
                    dropdown.style.bottom = 'auto';
                }
            } catch (_) {}
        };

        const positionFilterMenu = () => {
            try {
                if (!filterMenu || filterMenu.hidden) return;
                const anchor = filterButton.getBoundingClientRect();
                const viewportW = window.innerWidth || document.documentElement.clientWidth || 0;
                const viewportH = window.innerHeight || document.documentElement.clientHeight || 0;
                const margin = 8;
                const desiredWidth = Math.min(430, Math.max(280, viewportW - margin * 2));
                const sideGap = 6;
                const roomRight = viewportW - anchor.right - sideGap - margin;
                const roomLeft = anchor.left - sideGap - margin;
                let left;
                if (roomRight >= desiredWidth) {
                    left = anchor.right + sideGap;
                } else if (roomLeft >= desiredWidth) {
                    left = anchor.left - desiredWidth - sideGap;
                } else {
                    left = Math.max(margin, Math.min(
                        Math.round(anchor.right - desiredWidth),
                        Math.max(margin, viewportW - desiredWidth - margin),
                    ));
                }
                const below = Math.max(0, viewportH - anchor.bottom - 6 - margin);
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
                    filterMenu.style.bottom = Math.round(viewportH - anchor.top + 6) + 'px';
                }
            } catch (_) {}
        };

        const cleanupDropdown = (() => {
            const ac = (typeof AbortController !== 'undefined') ? new AbortController() : null;
            let observer = null;
            let resizeObserver = null;
            let cleaned = false;
            const on = (target, evt, fn, opts) => {
                try {
                    if (ac && ac.signal) {
                        target.addEventListener(evt, fn, Object.assign({}, opts || {}, { signal: ac.signal }));
                    } else {
                        target.addEventListener(evt, fn, opts || false);
                    }
                } catch (_) {}
            };
            const cleanup = () => {
                if (cleaned) return;
                cleaned = true;
                try { dropdown.style.display = 'none'; } catch (_) {}
                try { filterMenu.hidden = true; } catch (_) {}
                try { if (observer) observer.disconnect(); } catch (_) {}
                try { if (resizeObserver) resizeObserver.disconnect(); } catch (_) {}
                try { if (ac) ac.abort(); } catch (_) {}
            };
            const watchRemoval = () => {
                try {
                    if (typeof MutationObserver === 'undefined' || !document.body) return;
                    observer = new MutationObserver(() => {
                        if (!input_container.isConnected) cleanup();
                    });
                    observer.observe(document.body, { childList: true, subtree: true });
                } catch (_) {}
            };
            const watchResize = (targets, callback) => {
                try {
                    if (typeof ResizeObserver === 'undefined' || resizeObserver) return;
                    resizeObserver = new ResizeObserver(() => callback());
                    (Array.isArray(targets) ? targets : [targets]).forEach((target) => {
                        if (target) resizeObserver.observe(target);
                    });
                } catch (_) {}
            };
            return { on, cleanup, watchRemoval, watchResize };
        })();

        const scoreOptions = (() => {
            const apply = () => {
                try {
                    const fn = (typeof window !== 'undefined') ? window.computeCourseSuggestionScore : null;
                    if (typeof fn !== 'function') return;
                    candidates.forEach((candidate) => {
                        if (candidate && candidate.code) candidate.score = fn(candidate.code);
                    });
                } catch (_) {}
            };
            return { apply };
        })();
        scoreOptions.apply();

        let courseInfoLoadPromise = null;
        let offeringsLoadPromise = null;
        const rerenderWhenReady = () => {
            try {
                if (input_container.isConnected) renderOptions(input.value);
            } catch (_) {}
        };
        const ensureCourseInfo = () => {
            // The same index powers both requirement checks and historical
            // offering advisories. Load it whenever the picker is used, even
            // when the user has disabled prerequisite checking.
            if (courseInfoLoaded || courseInfoLoadPromise) {
                return courseInfoLoadPromise;
            }
            const loader = (typeof window !== 'undefined') ? window.loadCoursePageInfoIndex : null;
            if (typeof loader !== 'function') {
                courseInfoLoaded = true;
                return null;
            }
            courseInfoLoadPromise = Promise.resolve()
                .then(() => loader())
                .then((index) => { courseInfoByCode = index || null; })
                .catch(() => { courseInfoByCode = null; })
                .finally(() => {
                    courseInfoLoaded = true;
                    courseInfoLoadPromise = null;
                    rerenderWhenReady();
                });
            return courseInfoLoadPromise;
        };
        const ensureOfferings = () => {
            // Exact target-term schedules outrank historical patterns even when
            // the user is not filtering the list to offered courses. Loading
            // this once on picker open prevents a contradictory seasonal badge
            // from flashing or remaining beside a known current offering.
            if (offeringsLoaded || offeringsLoadPromise) {
                return offeringsLoadPromise;
            }
            const loader = (typeof window !== 'undefined') ? window.loadTermScheduleIndex : null;
            if (!targetTermCode || typeof loader !== 'function') {
                offeringsLoaded = true;
                offeredCourseCodes = null;
                return null;
            }
            offeringsLoadPromise = Promise.resolve()
                .then(() => loader(targetTermCode))
                .then((index) => {
                    if (!index || typeof index.keys !== 'function') {
                        offeredCourseCodes = null;
                        return;
                    }
                    const normalize = filterApi && typeof filterApi.normalizeCourseCode === 'function'
                        ? filterApi.normalizeCourseCode : (value) => String(value || '').trim().toUpperCase();
                    offeredCourseCodes = new Set(
                        Array.from(index.keys()).map(normalize).filter(Boolean),
                    );
                })
                .catch(() => { offeredCourseCodes = null; })
                .finally(() => {
                    offeringsLoaded = true;
                    offeringsLoadPromise = null;
                    rerenderWhenReady();
                });
            return offeringsLoadPromise;
        };
        const ensureFilterData = () => {
            ensureCourseInfo();
            ensureOfferings();
        };

        function capitalizeFirst(str) {
            const value = String(str || '');
            return value.charAt(0).toUpperCase() + value.slice(1);
        }

        const filtersFromControls = () => {
            const raw = {
                query: input.value,
                program: controls.program.value,
                category: controls.category.value,
                level: controls.level.value,
                minSu: controls.minSu.value,
                minEcts: controls.minEcts.value,
                minBasicScience: controls.minBasicScience.value,
                minEngineering: controls.minEngineering.value,
                hideTaken: controls.hideTaken.checked,
                offeredOnly: controls.offeredOnly.checked,
                checkPrerequisites: controls.checkPrerequisites.checked,
                showUnmetPrerequisites: controls.showUnmetPrerequisites.checked,
            };
            return filterApi && typeof filterApi.normalizeFilters === 'function'
                ? filterApi.normalizeFilters(raw) : raw;
        };

        const filterEvaluationContext = () => ({
            // The plan can change while this picker is still open (for example,
            // through another semester picker or drag-and-drop). Rebuild the
            // term boundary so prerequisite and prior-SU results never use a
            // stale snapshot of the curriculum.
            requirementContext: filterApi && typeof filterApi.buildTargetContext === 'function'
                ? filterApi.buildTargetContext(curriculum, targetSemester)
                : requirementContext,
            courseInfoByCode,
            offeredCourseCodes,
            targetTermCode,
            referenceTermCode: (typeof window !== 'undefined')
                ? window.currentTermCode : '',
        });

        const formatPickerNumber = (value) => {
            const number = Number(value);
            if (!Number.isFinite(number)) return '0';
            return String(Math.round(number * 100) / 100);
        };

        const appendBadge = (parent, label, className, kind, description) => {
            const badge = document.createElement('span');
            badge.className = 'course-option-badge' + (className ? ` ${className}` : '');
            badge.textContent = String(label || '');
            if (kind) badge.dataset.badgeKind = String(kind);
            if (description) badge.title = String(description);
            parent.appendChild(badge);
        };

        const appendRequirementLine = (parent, kind, text) => {
            if (!text) return;
            const line = document.createElement('div');
            line.className = 'course-option-requisite';
            line.dataset.kind = kind;
            line.textContent = String(text);
            parent.appendChild(line);
        };

        function renderOptionContent(container, evaluation, filters) {
            const item = evaluation && evaluation.candidate ? evaluation.candidate : evaluation;
            const title = document.createElement('div');
            title.className = 'course-option-title';
            title.textContent = `${String(item.code || '')} ${String(item.name || '')}`;
            container.appendChild(title);
            if (controls.details.checked) {
                const parts = [
                    `SU: ${formatPickerNumber(item.su != null ? item.su : item.credit)}`,
                    `ECTS: ${formatPickerNumber(item.ects)}`,
                ];
                if (Number(item.basicScience != null ? item.basicScience : item.bs) > 0) {
                    parts.push(`BS: ${formatPickerNumber(item.basicScience != null ? item.basicScience : item.bs)}`);
                }
                if (Number(item.engineering != null ? item.engineering : item.eng) > 0) {
                    parts.push(`Engineering: ${formatPickerNumber(item.engineering != null ? item.engineering : item.eng)}`);
                }
                const memberships = filterApi && typeof filterApi.membershipsForProgram === 'function'
                    ? filterApi.membershipsForProgram(item, filters.program) : [];
                if (memberships.length) {
                    const labels = memberships.map((membership) => {
                        const program = membership && membership.program ? String(membership.program) : '';
                        const type = membership && membership.type ? capitalizeFirst(membership.type) : '';
                        return [program, type].filter(Boolean).join(': ');
                    }).filter(Boolean);
                    if (labels.length) parts.push(labels.join(' / '));
                }
                const details = document.createElement('div');
                details.className = 'course-option-details';
                parts.forEach((part) => {
                    const row = document.createElement('div');
                    row.textContent = String(part);
                    details.appendChild(row);
                });
                container.appendChild(details);
            }

            const badges = document.createElement('div');
            badges.className = 'course-option-badges';
            const requirements = evaluation && evaluation.requirements;
            if (filters.checkPrerequisites) {
                const state = requirements && requirements.status ? requirements.status : 'unknown';
                if (state === 'met') appendBadge(badges, 'Requirements met', 'is-met');
                else if (state === 'unmet') appendBadge(badges, 'Unmet requirements', 'is-unmet');
                else appendBadge(badges, 'Requirements unavailable', 'is-unknown');
            }
            const offering = evaluation && evaluation.offering ? evaluation.offering.state : 'unknown';
            if (filters.offeredOnly || offering === 'offered') {
                if (offering === 'offered') appendBadge(badges, 'Offered', 'is-met');
                else if (offering === 'unknown') appendBadge(badges, 'Offering unknown', 'is-unknown');
            }
            const history = evaluation && evaluation.offeringHistory
                ? evaluation.offeringHistory : null;
            const historyAdvisories = (() => {
                try {
                    if (!filterApi || typeof filterApi.contextualOfferingAdvisories !== 'function') {
                        return [];
                    }
                    return filterApi.contextualOfferingAdvisories(
                        history,
                        targetTermCode,
                        offering,
                    );
                } catch (_) {
                    return [];
                }
            })();
            historyAdvisories.forEach((advisory) => {
                if (!advisory || !advisory.label) return;
                const kind = advisory.key === 'irregular' || advisory.key === 'no-recent'
                    ? 'history-cadence' : 'history-season';
                appendBadge(
                    badges,
                    advisory.label,
                    'is-history',
                    kind,
                    advisory.description || advisory.title
                        || 'Based on recorded course history; future availability can change.',
                );
            });
            const planned = evaluation && evaluation.plannedState
                ? String(evaluation.plannedState.state || '') : '';
            const plannedLabels = {
                earlier: 'Planned earlier',
                'same-term': 'Already in this semester',
                later: 'Planned later',
                multiple: 'Multiple planned entries',
                unknown: 'Planned term unknown',
            };
            if (plannedLabels[planned]) appendBadge(badges, plannedLabels[planned], 'is-unknown');
            if (badges.children.length) container.appendChild(badges);

            if (filters.checkPrerequisites && requirements) {
                const requisiteLines = document.createElement('div');
                requisiteLines.className = 'course-option-requisites';
                if (requirements.status === 'unmet') {
                    const prerequisite = requirements.prerequisite;
                    if (prerequisite) {
                        const required = Array.isArray(prerequisite.required)
                            ? prerequisite.required : [];
                        const sameTermAllowed = new Set(
                            Array.isArray(prerequisite.concurrent) ? prerequisite.concurrent : [],
                        );
                        const earlierOnly = required.filter((code) => !sameTermAllowed.has(code));
                        const concurrent = required.filter((code) => sameTermAllowed.has(code));
                        if (earlierOnly.length) {
                            appendRequirementLine(
                                requisiteLines,
                                'prerequisite',
                                `Prerequisite: complete ${earlierOnly.join(', ')} in an earlier term.`,
                            );
                        }
                        if (concurrent.length) {
                            appendRequirementLine(
                                requisiteLines,
                                'prerequisite',
                                `Prerequisite: add ${concurrent.join(', ')} in this term or an earlier term.`,
                            );
                        }
                        const oneOf = Array.isArray(prerequisite.oneOf)
                            ? prerequisite.oneOf : [];
                        const oneOfConcurrent = Array.isArray(prerequisite.oneOfConcurrent)
                            ? prerequisite.oneOfConcurrent : [];
                        oneOf.forEach((group, groupIndex) => {
                            const choices = Array.isArray(group) ? group.filter(Boolean) : [];
                            if (choices.length) {
                                const flags = Array.isArray(oneOfConcurrent[groupIndex])
                                    ? oneOfConcurrent[groupIndex] : [];
                                const labels = choices.map((choice, choiceIndex) => (
                                    flags[choiceIndex] ? `${choice} (same term allowed)` : choice
                                ));
                                appendRequirementLine(
                                    requisiteLines,
                                    'prerequisite',
                                    `Prerequisite: complete one of ${labels.join(' or ')}.`,
                                );
                            }
                        });
                    }
                    if (requirements.priorSuRequirement) {
                        const prior = requirements.priorSuRequirement;
                        appendRequirementLine(
                            requisiteLines,
                            'prior-credits',
                            `Prior SU: ${formatPickerNumber(prior.actual)} of ${formatPickerNumber(prior.minimum)} SU planned/completed.`,
                        );
                    }
                    const corequisites = Array.isArray(requirements.missingCorequisites)
                        ? requirements.missingCorequisites
                        : (Array.isArray(requirements.corequisites) ? requirements.corequisites : []);
                    if (corequisites.length) {
                        appendRequirementLine(
                            requisiteLines,
                            'corequisite',
                            `Corequisite: also add ${corequisites.join(', ')} in this or an earlier term.`,
                        );
                    }
                } else if (requirements.status === 'unknown') {
                    const unavailable = document.createElement('div');
                    unavailable.className = 'course-option-requisite course-option-requisite-status';
                    unavailable.textContent = 'Requirements unavailable; this course remains visible.';
                    requisiteLines.appendChild(unavailable);
                }
                if (requisiteLines.children.length) container.appendChild(requisiteLines);
            }
        }

        function renderOptions(filter) {
            if (typeof filter === 'string' && filter !== input.value) input.value = filter;
            dropdown.replaceChildren();
            const filters = filtersFromControls();
            let evaluations = [];
            if (filterApi && typeof filterApi.filterCandidates === 'function') {
                evaluations = filterApi.filterCandidates(
                    candidates,
                    filters,
                    filterEvaluationContext(),
                );
            } else {
                const query = String(filters.query || '').trim().toUpperCase();
                evaluations = candidates.filter((candidate) => {
                    const hay = String(candidate.searchUpper || `${candidate.code} ${candidate.name}`).toUpperCase();
                    return !query || hay.includes(query);
                }).map((candidate) => ({
                    candidate,
                    plannedState: { state: 'unknown' },
                    offering: { state: 'unknown' },
                    requirements: filters.checkPrerequisites ? { status: 'unknown' } : null,
                }));
            }
            evaluations.sort((left, right) => {
                const a = left && left.candidate ? left.candidate : {};
                const b = right && right.candidate ? right.candidate : {};
                if (window.sortBasedOnScore) {
                    const scoreDifference = (Number(b.score) || 0) - (Number(a.score) || 0);
                    if (scoreDifference) return scoreDifference;
                }
                return String(a.code || '').localeCompare(String(b.code || ''));
            });
            const frag = document.createDocumentFragment();
            const maxToRender = 220;
            evaluations.slice(0, maxToRender).forEach((evaluation, index) => {
                const o = evaluation.candidate || {};
                const opt = document.createElement('div');
                opt.className = 'course-option';
                opt.id = `${pickerId}_option_${index}`;
                opt.setAttribute('role', 'option');
                opt.setAttribute('aria-selected', 'false');
                opt.dataset.code = o.code;
                opt.dataset.name = o.name || '';
                opt.dataset.requisiteState = evaluation.requirements
                    && evaluation.requirements.status ? evaluation.requirements.status : 'unknown';
                opt.dataset.offeringState = evaluation.offering
                    && evaluation.offering.state ? evaluation.offering.state : 'unknown';
                const history = evaluation.offeringHistory || null;
                const historyAdvisories = (() => {
                    try {
                        if (!filterApi || typeof filterApi.contextualOfferingAdvisories !== 'function') {
                            return [];
                        }
                        return filterApi.contextualOfferingAdvisories(
                            history,
                            targetTermCode,
                            evaluation.offering,
                        );
                    } catch (_) {
                        return [];
                    }
                })();
                const historyKeys = historyAdvisories
                    .map((advisory) => advisory && advisory.key)
                    .filter(Boolean);
                opt.dataset.offeringPattern = historyKeys.length
                    ? historyKeys.join(' ') : (history && history.status ? history.status : 'unknown');
                opt.dataset.offeringCadence = history && history.cadence && history.cadence.status
                    ? String(history.cadence.status) : 'unknown';
                opt.dataset.plannedState = evaluation.plannedState
                    && evaluation.plannedState.state ? evaluation.plannedState.state : 'unknown';
                renderOptionContent(opt, evaluation, filters);
                frag.appendChild(opt);
            });
            dropdown.appendChild(frag);
            if (!evaluations.length) {
                const empty = document.createElement('div');
                empty.className = 'course-option-empty';
                empty.textContent = 'No courses match your search and filters.';
                const reset = document.createElement('button');
                reset.type = 'button';
                reset.className = 'btn btn-secondary btn-sm planner-filter-reset';
                reset.textContent = 'Reset filters';
                empty.appendChild(document.createElement('br'));
                empty.appendChild(reset);
                dropdown.appendChild(empty);
            } else if (evaluations.length > maxToRender) {
                const more = document.createElement('div');
                more.className = 'course-option-empty';
                more.textContent = `Showing ${maxToRender} of ${evaluations.length}. Type more to narrow.`;
                dropdown.appendChild(more);
            }
            const activeCount = filterApi && typeof filterApi.countActiveFilters === 'function'
                ? filterApi.countActiveFilters(filters) : 0;
            if (controls.count) {
                controls.count.textContent = String(activeCount);
                controls.count.hidden = activeCount <= 0;
            }
            filterButton.classList.toggle('is-active', activeCount > 0);
            filterButton.setAttribute(
                'aria-label',
                activeCount > 0 ? `Course filters, ${activeCount} active` : 'Course filters',
            );
            if (controls.status) {
                let message = `${evaluations.length} courses shown`;
                if (evaluations.length !== candidates.length) message += ` of ${candidates.length}`;
                if (!courseInfoLoaded) {
                    message += filters.checkPrerequisites
                        ? ' • Loading requirements and offering history'
                        : ' • Loading offering history';
                } else if (courseInfoLoaded && !courseInfoByCode) {
                    message += filters.checkPrerequisites
                        ? ' • Requirement and course-history data unavailable; failing open'
                        : ' • Course-history data unavailable; failing open';
                }
                if (!offeringsLoaded && targetTermCode) {
                    message += filters.offeredOnly
                        ? ' • Loading offerings'
                        : ' • Checking exact offering data';
                }
                else if (offeringsLoaded && !offeredCourseCodes && filters.offeredOnly) {
                    message += ' • Offering data unavailable; failing open';
                }
                controls.status.textContent = message + '.';
            }
            const mobileFilterSheetOpen = !filterMenu.hidden
                && document.body && document.body.classList.contains('is-mobile');
            dropdown.style.display = mobileFilterSheetOpen ? 'none' : 'block';
            input.setAttribute('aria-expanded', mobileFilterSheetOpen ? 'false' : 'true');
            if (!mobileFilterSheetOpen) positionDropdown();
            positionFilterMenu();
            activeIndex = -1;
            input.removeAttribute('aria-activedescendant');
        }

        let activeIndex = -1;
        function updateActive(items) {
            items.forEach((el, idx) => {
                const active = idx === activeIndex;
                el.classList.toggle('active', active);
                el.setAttribute('aria-selected', active ? 'true' : 'false');
            });
            const active = activeIndex >= 0 ? items[activeIndex] : null;
            if (active && active.id) input.setAttribute('aria-activedescendant', active.id);
            else input.removeAttribute('aria-activedescendant');
        }

        const setFilterMenuOpen = (open, restoreFocus) => {
            const next = !!open;
            filterMenu.hidden = !next;
            filterButton.setAttribute('aria-expanded', next ? 'true' : 'false');
            if (next) {
                ensureFilterData();
                renderOptions(input.value);
                requestAnimationFrame(positionFilterMenu);
            } else if (restoreFocus) {
                try { filterButton.focus(); } catch (_) {}
            }
        };

        const syncSharedPreferenceControls = () => {
            controls.hideTaken.checked = typeof window.hideTakenCourses === 'boolean'
                ? window.hideTakenCourses : controls.hideTaken.checked;
            controls.details.checked = typeof window.showCourseDetails === 'boolean'
                ? window.showCourseDetails : controls.details.checked;
            controls.smartSort.checked = typeof window.sortBasedOnScore === 'boolean'
                ? window.sortBasedOnScore : controls.smartSort.checked;
        };

        const persistPickerControls = (changedControl) => {
            writePreference('plannerFilterProgram', controls.program.value);
            writePreference('plannerFilterCategory', controls.category.value);
            writePreference('plannerFilterLevel', controls.level.value);
            writePreference('plannerFilterMinSu', controls.minSu.value);
            writePreference('plannerFilterMinEcts', controls.minEcts.value);
            writePreference('plannerFilterMinBasicScience', controls.minBasicScience.value);
            writePreference('plannerFilterMinEngineering', controls.minEngineering.value);
            writePreference('plannerFilterCheckPrerequisites', controls.checkPrerequisites.checked ? 'true' : 'false');
            writePreference('plannerFilterShowUnmetPrerequisites', controls.showUnmetPrerequisites.checked ? 'true' : 'false');

            const syncCheckbox = (id, checked) => {
                try {
                    const checkbox = document.getElementById(id);
                    if (checkbox) checkbox.checked = checked;
                } catch (_) {}
            };
            if (changedControl === controls.hideTaken) {
                window.hideTakenCourses = controls.hideTaken.checked;
                writePreference('hideTakenCourses', controls.hideTaken.checked ? 'true' : 'false');
                syncCheckbox('hideTakenCoursesToggle', controls.hideTaken.checked);
                document.dispatchEvent(new Event('hideTakenCoursesToggleChanged'));
            } else if (changedControl === controls.details) {
                window.showCourseDetails = controls.details.checked;
                writePreference('showCourseDetails', controls.details.checked ? 'true' : 'false');
                syncCheckbox('courseDetailsToggle', controls.details.checked);
                document.dispatchEvent(new Event('courseDetailsToggleChanged'));
            } else if (changedControl === controls.smartSort) {
                window.sortBasedOnScore = controls.smartSort.checked;
                writePreference('sortBasedOnScore', controls.smartSort.checked ? 'true' : 'false');
                syncCheckbox('sortByScoreToggle', controls.smartSort.checked);
                document.dispatchEvent(new Event('sortByScoreToggleChanged'));
            }
        };

        const resetPickerFilters = () => {
            controls.program.value = '';
            controls.category.value = '';
            controls.level.value = '';
            controls.minSu.value = '';
            controls.minEcts.value = '';
            controls.minBasicScience.value = '';
            controls.minEngineering.value = '';
            controls.hideTaken.checked = false;
            controls.offeredOnly.checked = false;
            controls.checkPrerequisites.checked = true;
            controls.showUnmetPrerequisites.checked = true;
            controls.showUnmetPrerequisites.disabled = false;
            window.hideTakenCourses = false;
            writePreference('hideTakenCourses', 'false');
            const hideToggle = document.getElementById('hideTakenCoursesToggle');
            if (hideToggle) hideToggle.checked = false;
            persistPickerControls(null);
            document.dispatchEvent(new Event('hideTakenCoursesToggleChanged'));
            ensureFilterData();
            renderOptions(input.value);
        };

        controls.showUnmetPrerequisites.disabled = !controls.checkPrerequisites.checked;
        cleanupDropdown.on(input, 'input', () => renderOptions(input.value));
        cleanupDropdown.on(input, 'focus', () => {
            ensureFilterData();
            renderOptions(input.value);
        });
        cleanupDropdown.on(input, 'blur', () => {
            setTimeout(() => {
                const focusInside = input_container.contains(document.activeElement);
                if (!focusInside && filterMenu.hidden) {
                    dropdown.style.display = 'none';
                    input.setAttribute('aria-expanded', 'false');
                }
            }, 100);
        });
        cleanupDropdown.on(filterButton, 'click', () => {
            setFilterMenuOpen(filterMenu.hidden, false);
        });
        cleanupDropdown.on(input_container, 'click', (evt) => {
            const reset = evt.target && typeof evt.target.closest === 'function'
                ? evt.target.closest('.planner-filter-reset') : null;
            if (!reset || !input_container.contains(reset)) return;
            evt.preventDefault();
            evt.stopPropagation();
            resetPickerFilters();
        });
        cleanupDropdown.on(filterMenu, 'change', (evt) => {
            const control = evt.target;
            if (!control) return;
            if (control === controls.checkPrerequisites) {
                controls.showUnmetPrerequisites.disabled = !control.checked;
            }
            persistPickerControls(control);
            ensureFilterData();
            scoreOptions.apply();
            renderOptions(input.value);
        });
        cleanupDropdown.on(filterMenu, 'input', (evt) => {
            const control = evt.target;
            if (!control || control.type !== 'number') return;
            persistPickerControls(control);
            renderOptions(input.value);
        });

        // Keep dropdown anchored while the user scrolls/resizes (including
        // horizontal scrolling of the board).
        try {
            const scrollParent = targetSemesterElement || null;
            const boardScrollParent = (semesterContainer && semesterContainer.closest)
                ? semesterContainer.closest('.board')
                : (input.closest ? input.closest('.board') : null);
            const extraBoard = (!boardScrollParent && typeof document !== 'undefined')
                ? document.querySelector('.board')
                : null;
            const handler = () => {
                try { positionDropdown(); } catch (_) {}
                try { positionFilterMenu(); } catch (_) {}
            };
            cleanupDropdown.on(window, 'resize', handler);
            cleanupDropdown.on(window, 'scroll', handler, { passive: true });
            const visual = window.visualViewport || null;
            if (visual) {
                cleanupDropdown.on(visual, 'resize', handler);
                cleanupDropdown.on(visual, 'scroll', handler, { passive: true });
            }
            if (scrollParent) cleanupDropdown.on(scrollParent, 'scroll', handler, { passive: true });
            if (boardScrollParent) cleanupDropdown.on(boardScrollParent, 'scroll', handler, { passive: true });
            if (extraBoard) cleanupDropdown.on(extraBoard, 'scroll', handler, { passive: true });
            cleanupDropdown.watchResize(
                [searchRow, targetSemesterElement, semesterContainer, boardScrollParent || extraBoard],
                handler,
            );
        } catch (_) {}

        cleanupDropdown.on(input, 'keydown', function(evt){
            const items = Array.from(dropdown.querySelectorAll('.course-option')).filter(el => {
                try { return !!(el && el.dataset && el.dataset.code); } catch (_) { return false; }
            });
            if (evt.key === 'ArrowDown') {
                activeIndex = Math.min(activeIndex + 1, items.length - 1);
                updateActive(items);
                if (items[activeIndex]) items[activeIndex].scrollIntoView({ block: 'nearest' });
                evt.preventDefault();
            } else if (evt.key === 'ArrowUp') {
                activeIndex = Math.max(activeIndex - 1, 0);
                updateActive(items);
                if (items[activeIndex]) items[activeIndex].scrollIntoView({ block: 'nearest' });
                evt.preventDefault();
            } else if (evt.key === 'Enter') {
                if (activeIndex >= 0 && items[activeIndex]) {
                    input.value = items[activeIndex].dataset.code + ' ' + items[activeIndex].dataset.name;
                }
                evt.preventDefault();
                enter.click();
            } else if (evt.key === 'Escape') {
                evt.preventDefault();
                if (!filterMenu.hidden) {
                    evt.stopPropagation();
                    dropdown.style.display = 'none';
                    input.setAttribute('aria-expanded', 'false');
                    setFilterMenuOpen(false, true);
                } else {
                    dropdown.style.display = 'none';
                    input.setAttribute('aria-expanded', 'false');
                    input.removeAttribute('aria-activedescendant');
                    activeIndex = -1;
                }
            }
        });
        cleanupDropdown.on(document, 'keydown', (evt) => {
            if (evt.key !== 'Escape' || filterMenu.hidden) return;
            evt.preventDefault();
            dropdown.style.display = 'none';
            input.setAttribute('aria-expanded', 'false');
            setFilterMenuOpen(false, true);
        });
        cleanupDropdown.on(document, 'pointerdown', (evt) => {
            if (input_container.contains(evt.target)) return;
            setFilterMenuOpen(false, false);
            dropdown.style.display = 'none';
            input.setAttribute('aria-expanded', 'false');
        });
        cleanupDropdown.on(document, 'courseDetailsToggleChanged', () => {
            syncSharedPreferenceControls();
            renderOptions(input.value);
        });
        cleanupDropdown.on(document, 'hideTakenCoursesToggleChanged', () => {
            syncSharedPreferenceControls();
            renderOptions(input.value);
        });
        cleanupDropdown.on(document, 'sortByScoreToggleChanged', () => {
            syncSharedPreferenceControls();
            scoreOptions.apply();
            renderOptions(input.value);
        });

        let enter = document.createElement("button");
        enter.type = 'button';
        enter.classList.add("enter");
        enter.setAttribute('aria-label', 'Add selected course');
        enter.title = 'Add selected course';
        let delete_ac = document.createElement("button");
        delete_ac.type = 'button';
        delete_ac.classList.add("delete_add_course");
        delete_ac.setAttribute('aria-label', 'Cancel adding course');
        delete_ac.title = 'Cancel';

        try {
            cleanupDropdown.on(delete_ac, 'click', (evt) => {
                try { cleanupDropdown.cleanup(); } catch (_) {}
                try { input_container.remove(); } catch (_) {}
                evt.stopPropagation();
            });
        } catch (_) {}

        searchRow.appendChild(input);
        searchRow.appendChild(filterButton);
        wrapper.appendChild(searchRow);
        wrapper.appendChild(dropdown);
        wrapper.appendChild(datalist);
        wrapper.appendChild(filterMenu);
        input_container.appendChild(wrapper);
        input_container.appendChild(enter);
        input_container.appendChild(delete_ac);

        e.target.parentNode.insertBefore(input_container, e.target.parentNode.querySelector(".addCourse"));
        cleanupDropdown.watchRemoval();
        ensureFilterData();

        // Automatically focus so the user can start typing immediately
        setTimeout(() => { input.focus(); renderOptions(''); }, 0);

        // Single delegated handler instead of per-option listeners (faster to re-render).
        try {
            cleanupDropdown.on(dropdown, 'mousedown', (evt) => {
                const opt = (evt && evt.target && typeof evt.target.closest === 'function')
                    ? evt.target.closest('.course-option')
                    : null;
                if (!opt || !opt.dataset || !opt.dataset.code) return;
                input.value = String(opt.dataset.code) + ' ' + String(opt.dataset.name || '');
                dropdown.style.display = 'none';
                input.setAttribute('aria-expanded', 'false');
                evt.preventDefault();
            });
        } catch (_) {}
    }
    //CLICKED "OK" (for entering course input):
    else if(e.target.classList.contains("enter"))
    {
        const canonicalizeCourseCode = (c) => {
            const n = String(c || '').toUpperCase().replace(/\s+/g, '');
            if (n === 'CS210' || n === 'DSA210') return 'DSA210';
            return n;
        };
        // Retrieve the user's input and attempt to determine the course code.
        // Users may type either the full code+name (e.g., "CS101 Intro"), just
        // the course code, or the course name. We first take the first
        // token as the tentative code. If the resulting course is not
        // valid, we attempt to match the entire input against course names
        // in both the primary major and the double major. If a match is
        // found, we derive the code accordingly.
        let inputValue = e.target.parentNode.querySelector("input").value.trim();
        let tokens = inputValue.split(/\s+/);
        let tentativeCode = tokens[0] || '';
        if (tokens.length > 1 && /\d/.test(tokens[1])) {
            tentativeCode += tokens[1];
        }
        tentativeCode = tentativeCode.toUpperCase();
        let courseCode = tentativeCode;
        let originalCourseCode = courseCode;
        let courseObj = new s_course(courseCode, '');
        // Helper to search course by name in course_data and DM data
        function findCourseByName(name) {
            name = name.trim().toUpperCase();
            // search primary course_data
            for (let i = 0; i < course_data.length; i++) {
                if (course_data[i]['Course_Name'].toUpperCase() === name) {
                    return course_data[i];
                }
            }
            // search double major data if available
            try {
                const cur = (typeof window !== 'undefined') ? window.curriculum : null;
                if (cur && cur.doubleMajor && Array.isArray(cur.doubleMajorCourseData)) {
                    for (let i = 0; i < cur.doubleMajorCourseData.length; i++) {
                        if (cur.doubleMajorCourseData[i]['Course_Name'].toUpperCase() === name) {
                            return cur.doubleMajorCourseData[i];
                        }
                    }
                }
            } catch (_) {}
            return null;
        }
        // If tentative code is not valid, try matching by full input as name
        if (!isCourseValid(courseObj, course_data)) {
            // Attempt to find by full value (case-insensitive)
            const found = findCourseByName(inputValue);
            if (found) {
                // Derive code from found course
                courseCode = found.Major + found.Code;
                originalCourseCode = courseCode;
                courseObj = new s_course(courseCode, '');
            }
        }
        // Accept either the original code or the canonical code (CS210 -> DSA210).
        const canonicalCourseCode = canonicalizeCourseCode(courseCode);
        const originalValid = isCourseValid(courseObj, course_data);
        const canonicalValid = (canonicalCourseCode !== courseCode)
            ? isCourseValid(new s_course(canonicalCourseCode, ''), course_data)
            : originalValid;
        if (!originalValid && !canonicalValid) {
            try {
                const ui = (typeof window !== 'undefined') ? window.uiModal : null;
                const body = '<p>Course not found.</p><p>Please select a course from the dropdown list.</p>';
                if (ui && typeof ui.alert === 'function') ui.alert('Course not found', body);
                else console.warn('Course not found');
            } catch (_) {}
            e.target.parentNode.querySelector("input").value = '';
            return;
        }
        courseCode = canonicalCourseCode;
        // Now we have a valid courseCode. Only consume a course id once the
        // addition is actually committed; duplicate/retake prompts must not
        // leave gaps merely because they were cancelled.
        if(!curriculum.hasCourse(courseCode)) {
            curriculum.course_id = curriculum.course_id + 1;
            let course_id = 'c' + curriculum.course_id;
            let myCourse = new s_course(courseCode, course_id);
            let sem = curriculum.getSemester(e.target.parentNode.parentNode.querySelector('.semester').id);
            // Attach additional metadata from the course info to the s_course
            // instance.  This ensures that double-major courses retain
            // attributes like credit, category, faculty course, science and
            // engineering credits. These fields are required for proper
            // graduation logic and summary calculations, and they are
            // normally available via the info object returned by getInfo().
            const infoAdd = getInfo(courseCode, course_data) || getInfo(originalCourseCode, course_data);
            if (infoAdd) {
                // Course credit values
                myCourse.SU_credit = (typeof parseCreditValue === 'function')
                    ? parseCreditValue(infoAdd['SU_credit'] || '0')
                    : (parseFloat(infoAdd['SU_credit'] || '0') || 0);
                myCourse.Basic_Science = parseFloat(infoAdd['Basic_Science'] || '0');
                myCourse.Engineering = parseFloat(infoAdd['Engineering'] || '0');
                myCourse.ECTS = parseFloat(infoAdd['ECTS'] || '0');
                // Category and faculty course information.  Normalize the
                // category string so that the first letter is uppercase
                // (e.g., "Core", "Area", "Free", "Required", "University").
                const elType = (infoAdd['EL_Type'] || '').toString();
                if (elType) {
                    myCourse.category = elType.charAt(0).toUpperCase() + elType.slice(1).toLowerCase();
                }
                myCourse.Faculty_Course = infoAdd['Faculty_Course'] || 'No';
            }
            sem.addCourse(myCourse);
            let c_container = document.createElement("div");
            c_container.classList.add("course_container");
            let c_label = document.createElement("div");
            c_label.classList.add("course_label");
            const codeDiv = document.createElement('div');
            codeDiv.className = 'course_code';
            codeDiv.textContent = String(myCourse.code || '');
            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'course_actions';
            const detailsButton = document.createElement('button');
            detailsButton.className = 'details_course';
            detailsButton.type = 'button';
            detailsButton.title = `Details for ${myCourse.code}`;
            detailsButton.setAttribute('aria-label', `Details for ${myCourse.code}`);
            const detailsIcon = document.createElement('i');
            detailsIcon.className = 'fa-solid fa-circle-info';
            detailsIcon.setAttribute('aria-hidden', 'true');
            detailsButton.appendChild(detailsIcon);
            const deleteButton = document.createElement('button');
            deleteButton.className = 'delete_course';
            deleteButton.type = 'button';
            deleteButton.title = `Delete ${myCourse.code}`;
            deleteButton.setAttribute('aria-label', `Delete ${myCourse.code}`);
            actionsDiv.appendChild(detailsButton);
            actionsDiv.appendChild(deleteButton);
            c_label.appendChild(codeDiv);
            c_label.appendChild(actionsDiv);
            let c_info = document.createElement("div");
            c_info.classList.add("course_info");
            // Use getInfo to fetch course details (works for DM-only courses)
            const info = getInfo(courseCode, course_data) || getInfo(originalCourseCode, course_data);
            const nameDiv = document.createElement('div');
            nameDiv.className = 'course_name';
            nameDiv.textContent = String(info['Course_Name'] || '');
            c_info.appendChild(nameDiv);
            const typeDiv = document.createElement('div');
            typeDiv.className = 'course_type';
            typeDiv.textContent = String(info['EL_Type'] || '').toUpperCase();
            c_info.appendChild(typeDiv);
            const creditText = (typeof formatCreditValue === 'function')
                ? formatCreditValue(info['SU_credit'])
                : (Number(parseFloat(info['SU_credit'] || '0') || 0).toFixed(1));
            const creditDiv = document.createElement('div');
            creditDiv.className = 'course_credit';
            creditDiv.textContent = String(creditText) + ' credits';
            c_info.appendChild(creditDiv);
            const bsDiv = document.createElement('div');
            bsDiv.classList.add('course_bs_credit');
            bsDiv.textContent = 'BS: ' + (info['Basic_Science'] || '0') + ' credits';
            if (!window.showCourseDetails) {
                bsDiv.style.display = 'none';
            }
            c_info.appendChild(bsDiv);
            let grade = document.createElement('button');
            grade.classList.add('grade');
            grade.type = 'button';
            grade.setAttribute('aria-haspopup', 'listbox');
            grade.setAttribute('aria-expanded', 'false');
            grade.setAttribute('aria-label', `Grade for ${myCourse.code}: not entered`);
            grade.textContent = 'Add grade';
            c_container.appendChild(c_label);
            c_container.appendChild(c_info);
            c_container.appendChild(grade);
            let course = document.createElement("div");
            course.classList.add("course");
            course.id = course_id;
            course.appendChild(c_container);
            e.target.parentNode.parentNode.querySelector('.semester').appendChild(course);
            // changing total credits element in DOM:
            let dom_tc = e.target.parentNode.parentNode.parentNode.querySelector('span');
            if (typeof updateSemesterCreditIndicator === 'function') {
                updateSemesterCreditIndicator(dom_tc, sem);
            } else {
                const totalText = (typeof formatCreditValue === 'function')
                    ? formatCreditValue(sem.totalCredit)
                    : (Number(sem.totalCredit || 0).toFixed(1));
                dom_tc.textContent = totalText + ' SU';
            }
            // Remove input container after adding course
            e.target.parentNode.remove();
            // Recalculate categories for main (and DM via recalc) after adding
            try {
                if (typeof curriculum.recalcEffectiveTypes === 'function') {
                    curriculum.recalcEffectiveTypes(course_data);
                }
            } catch(err) {}
        } else {
            const inputContainer = e.target.parentNode;
            const targetSemesterEl = inputContainer && inputContainer.parentNode
                ? inputContainer.parentNode.querySelector('.semester') : null;
            const targetSemester = targetSemesterEl ? curriculum.getSemester(targetSemesterEl.id) : null;
            const retakes = (typeof window !== 'undefined') ? window.courseRetakes : null;
            const assessment = retakes && typeof retakes.assessRetakeCandidate === 'function'
                ? retakes.assessRetakeCandidate(curriculum.semesters, courseCode, targetSemester)
                : null;
            const ui = (typeof window !== 'undefined') ? window.uiModal : null;

            const unavailableReason = (reason) => {
                const messages = {
                    'target-not-later': 'A retake must be placed in a later semester than the existing attempt.',
                    'no-prior-occurrence': 'The existing entry is in the same or a later semester.',
                    'unfinished-grade': 'The existing attempt does not yet have a final grade. Move or finish that entry before planning a retake.',
                    'transfer-requires-substitution-review': 'Courses recorded with T use the university\'s separate substitution process.',
                    'passing-retake-window-expired': 'The passing-grade repeat window cannot be confirmed from the selected terms.',
                    'multiple-prior-occurrences': 'This plan already contains multiple attempts, so SUrriculum cannot safely choose one to replace.',
                    'multiple-existing-occurrences': 'This plan already contains multiple attempts, so SUrriculum cannot safely choose one to replace.',
                    'unknown-source-term': 'The existing attempt has no valid semester, so retake eligibility cannot be checked.',
                    'unknown-target-term': 'The target semester is not valid, so retake eligibility cannot be checked.',
                    'source-term-not-completed': 'A future-semester attempt cannot establish retake eligibility.',
                    'unsupported-grade': 'The existing grade is not supported for automatic retake planning.',
                };
                return messages[reason] || 'This duplicate does not meet the automatic retake checks.';
            };

            if (!assessment || !assessment.eligible || !assessment.occurrence) {
                const body = `<p>You have already added <strong>${escapeHtml(courseCode)}</strong>.</p>`
                    + `<p>${escapeHtml(unavailableReason(assessment && assessment.reason))}</p>`;
                try {
                    if (ui && typeof ui.alert === 'function') ui.alert('Already added', body);
                    else console.warn('Already added', courseCode);
                } catch (_) {}
                inputContainer.querySelector("input").value = '';
                return;
            }

            // The confirmation is asynchronous while the delegated click
            // handler is intentionally synchronous. Guard the row against a
            // double activation and complete the replacement in one task.
            if (inputContainer.dataset.retakeInProgress === 'true') return;
            inputContainer.dataset.retakeInProgress = 'true';
            (async () => {
                const occurrence = assessment.occurrence;
                const sourceLabel = occurrence.semester && (occurrence.semester.termName || occurrence.termCode)
                    ? String(occurrence.semester.termName || occurrence.termCode) : 'the earlier semester';
                const targetLabel = targetSemester && (targetSemester.termName || targetSemester.termCode)
                    ? String(targetSemester.termName || targetSemester.termCode) : 'the selected semester';
                const plannerImpact = '<p><strong>This temporarily removes the earlier attempt\'s credit, GPA, and prerequisite effect from the planner until you enter the new result.</strong></p>';
                const body = `<p><strong>${escapeHtml(courseCode)}</strong> already appears in <strong>${escapeHtml(sourceLabel)}</strong> with grade <strong>${escapeHtml(occurrence.course.grade || '')}</strong>.</p>`
                    + `<p>Plan it again in <strong>${escapeHtml(targetLabel)}</strong>? SUrriculum will remove the earlier planner entry and add a new ungraded attempt.</p>`
                    + plannerImpact
                    + '<p>The university transcript retains both registrations; this replacement is only a simplified planning view. The newest repeat grade can replace the earlier grade even when it is lower, and university rules do not allow withdrawal from a repeated course.</p>'
                    + '<p>SUrriculum cannot verify approved leave or first-offering/program exceptions; confirm the registration with your advisor or SUIS.</p>';
                let confirmed = false;
                try {
                    confirmed = !!(ui && typeof ui.confirm === 'function'
                        ? await ui.confirm('Plan this course as a retake?', body, {
                            confirmText: 'Replace earlier entry',
                            danger: true,
                        })
                        : false);
                } catch (_) {
                    confirmed = false;
                }
                if (!confirmed) {
                    inputContainer.dataset.retakeInProgress = 'false';
                    return;
                }

                const storage = (typeof window !== 'undefined') ? window.planStorage : null;
                const canSave = storage && typeof storage.requestSave === 'function'
                    && typeof storage.flushSaves === 'function';
                // Persist a known-good checkpoint before removing anything.
                if (!canSave || storage.requestSave() === false || storage.flushSaves() === false) {
                    if (ui && typeof ui.alert === 'function') {
                        await ui.alert('Retake not added', '<p>Your current planner could not be saved, so no course was changed.</p>');
                    }
                    inputContainer.dataset.retakeInProgress = 'false';
                    return;
                }

                const oldCourseEl = occurrence.course && occurrence.course.id
                    ? document.getElementById(occurrence.course.id) : null;
                const deleteButton = oldCourseEl ? oldCourseEl.querySelector('.delete_course') : null;
                if (!deleteButton) {
                    if (ui && typeof ui.alert === 'function') {
                        await ui.alert('Retake not added', '<p>The earlier planner entry could not be identified. No course was changed.</p>');
                    }
                    inputContainer.dataset.retakeInProgress = 'false';
                    return;
                }

                try {
                    // Delegated planner deletion and addition are synchronous.
                    // The final explicit flush below is the transaction boundary.
                    deleteButton.click();
                    e.target.click();
                    const targetHasNewAttempt = !!(targetSemester && Array.isArray(targetSemester.courses)
                        && targetSemester.courses.some((course) => retakes.normalizeCourseCode(course && course.code) === retakes.normalizeCourseCode(courseCode)));
                    if (!targetHasNewAttempt || storage.requestSave() === false || storage.flushSaves() === false) {
                        throw new Error('The replacement could not be saved.');
                    }
                } catch (error) {
                    // setSnapshot restores its previous parallel arrays on a
                    // partial storage failure. Reload that known-good checkpoint
                    // so the destructive half of the UI operation cannot linger.
                    // Stop the queued add/delete autosave before yielding to the
                    // failure dialog; otherwise the 2-second fallback could
                    // persist the failed replacement while the dialog is open.
                    try {
                        if (storage && typeof storage.suspendSaves === 'function') {
                            storage.suspendSaves();
                        }
                    } catch (_) {}
                    try {
                        if (ui && typeof ui.alert === 'function') {
                            await ui.alert('Retake not added', '<p>The earlier course will be restored because the replacement could not be saved.</p>');
                        }
                    } finally {
                        location.reload();
                    }
                }
            })();
        }
    }
    //CLICKED "<semester delete>"
    else if(e.target.classList.contains("delete_semester"))
    {
        let id = extractNumericValue(e.target.parentNode.parentNode.parentNode.parentNode.id);


        curriculum.deleteSemester(e.target.parentNode.parentNode.parentNode.querySelector('.semester').id);
        e.target.parentNode.parentNode.parentNode.parentNode.remove();

        try {
            if (typeof renumberSemesterContainers === 'function') {
                renumberSemesterContainers(curriculum);
            } else {
                const containers = document.querySelectorAll('.container_semester');
                containers.forEach((element, index) => { element.id = 'con' + (index + 1); });
                curriculum.container_id = containers.length;
            }
        } catch (_) {
            curriculum.container_id = document.querySelectorAll('.container_semester').length;
        }

        // Deleting an edge card changes which remaining semester is allowed to
        // move toward that edge. Refresh immediately so the mobile Up/Down (and
        // desktop Left/Right) disabled states never lag behind the model.
        try {
            if (typeof refreshSemesterAccessibility === 'function') {
                refreshSemesterAccessibility();
            }
        } catch (_) {}

        // After deleting a semester, recalculate effective types in case
        // category allocation changes due to the removal. Guard for
        // recalcExisting undefined.
        try {
            if (typeof curriculum.recalcEffectiveTypes === 'function') {
                curriculum.recalcEffectiveTypes(course_data);
            }
        } catch(err) {
            // ignore
        }
    }
    //CLICKED "<course delete>"

    else if(
        e.target.classList.contains("details_course") ||
        (e.target.closest && e.target.closest("button.details_course"))
    )
    {
        const btn = (() => {
            try { return e.target.closest ? e.target.closest('button.details_course') : null; } catch (_) { return null; }
        })() || e.target;
        const container = (() => {
            try { return btn.closest('.course_container'); } catch (_) { return null; }
        })();
        const codeEl = (() => {
            try { return container ? container.querySelector('.course_code') : null; } catch (_) { return null; }
        })();
        const courseCode = codeEl ? String(codeEl.textContent || '').trim() : '';
        if (!courseCode) return;

        const buildCourseUrl = (code) => {
            const m = String(code || '').toUpperCase().replace(/\s+/g, '').match(/^([A-Z]+)([0-9A-Z]+)$/);
            if (!m) return '';
            const subj = m[1];
            const num = m[2];
            return (
                'https://suis.sabanciuniv.edu/prod/sabanci_www.p_get_courses' +
                '?levl_code=UG' +
                '&subj_code=' + encodeURIComponent(subj) +
                '&crse_numb=' + encodeURIComponent(num) +
                '&lang=eng'
            );
        };

        (async () => {
            try {
                const ui = (typeof window !== 'undefined') ? window.uiModal : null;
                const load = (typeof window !== 'undefined') ? window.loadCoursePageInfoIndex : null;
                const loadInstructorHistory = (typeof window !== 'undefined') ? window.loadCourseInstructorHistoryIndex : null;
                const loadSectionHistory = (typeof window !== 'undefined') ? window.loadCourseSectionHistoryIndex : null;
                if (!ui || typeof ui.alert !== 'function') return;
                if (typeof load !== 'function') {
                    ui.alert('Details unavailable', '<p>Course details index is not available.</p>');
                    return;
                }

                const idx = await load();
                const info = idx && typeof idx.get === 'function' ? idx.get(courseCode) : null;
                const instructorHistoryIdx = (typeof loadInstructorHistory === 'function') ? await loadInstructorHistory() : null;
                const sectionHistoryIdx = (typeof loadSectionHistory === 'function') ? await loadSectionHistory() : null;
                const instructorHistoryInfo = (
                    instructorHistoryIdx && typeof instructorHistoryIdx.get === 'function'
                        ? instructorHistoryIdx.get(courseCode)
                        : null
                );
                const sectionHistoryInfo = (
                    sectionHistoryIdx && typeof sectionHistoryIdx.get === 'function'
                        ? sectionHistoryIdx.get(courseCode)
                        : null
                );
                if (!info) {
                    ui.alert(
                        'Details unavailable',
                        `<p>No details found for <strong>${escapeHtml(courseCode)}</strong>.</p>` +
                        `<p>This may be a custom course, or the scrape index is missing this course.</p>`
                    );
                    return;
                }

                const title = info.title || info.header_text || '';
                const su = (typeof info.su_credits !== 'undefined' && info.su_credits !== null) ? info.su_credits : info.su_credit;
                const ects = info.ects;
                const bs = info.basic_science;
                const eng = info.engineering;
                const prereq = info.prerequisites;
                const coreq = info.corequisites;
                const generalPrereq = info.general_requirement_prerequisites;
                const minimumPriorSu = info.minimum_earned_su_credits;
                const generalRequirements = info.general_requirements;
                const desc = (info.description || '').toString();
                const offered = Array.isArray(info.last_offered_terms) ? info.last_offered_terms : [];
                const url = info.source_url || buildCourseUrl(courseCode);

                const formatDescription = (value) => {
                    const raw = String(value || '').trim();
                    if (!raw) return '';
                    return raw
                        .replace(/\r\n/g, '\n')
                        .replace(/\n{2,}/g, '\u0000')
                        .replace(/[ \t]*\n[ \t]*/g, ' ')
                        .replace(/\u0000/g, '\n\n')
                        .replace(/[ \t]{2,}/g, ' ')
                        .trim();
                };

                const fmt = (v) => {
                    try {
                        if (typeof window !== 'undefined' && typeof window.formatCreditValue === 'function') {
                            return window.formatCreditValue(v);
                        }
                    } catch (_) {}
                    const n = parseFloat(v || '0');
                    return (isFinite(n) ? n : 0).toFixed(1);
                };

                const formattedDesc = formatDescription(desc);
                const descHtml = formattedDesc
                    ? `<div class="course-details-section"><h4>Description</h4><p>${escapeHtml(formattedDesc).replace(/\n\n/g, '<br><br>')}</p></div>`
                    : '';
                const prereqHtml = prereq || !generalPrereq
                    ? '<div class="course-details-section"><h4>Prerequisites</h4><p>'
                        + (prereq ? escapeHtml(prereq) : 'None') + '</p></div>'
                    : '';
                const generalRequirementsText = generalRequirements || (
                    minimumPriorSu != null && String(minimumPriorSu).trim()
                        ? `Minimum ${fmt(minimumPriorSu)} prior SU credits.` : ''
                );
                const generalRequirementsHtml = generalRequirementsText
                    ? '<div class="course-details-section"><h4>General requirements</h4><p>'
                        + escapeHtml(generalRequirementsText) + '</p></div>'
                    : '';

                const instructorHistory = (
                    instructorHistoryInfo && Array.isArray(instructorHistoryInfo.history)
                        ? instructorHistoryInfo.history
                        : []
                );
                const sectionHistory = (
                    sectionHistoryInfo && Array.isArray(sectionHistoryInfo.history)
                        ? sectionHistoryInfo.history
                        : []
                );
                const normalizeTerm = (value) => {
                    try {
                        const fn = (typeof window !== 'undefined') ? window.normalizeTermIdentifier : null;
                        if (typeof fn === 'function') return fn(value);
                    } catch (_) {}
                    return String(value || '').trim();
                };
                const displayTerm = (value) => {
                    try {
                        const fn = (typeof window !== 'undefined') ? window.displayTermIdentifier : null;
                        if (typeof fn === 'function') return fn(value);
                    } catch (_) {}
                    return String(value || '').trim();
                };
                const termHistoryMap = new Map();
                offered.forEach((entry) => {
                    const term = normalizeTerm(entry && entry.term ? String(entry.term) : '');
                    if (!term) return;
                    const existing = termHistoryMap.get(term) || { term, instructors: [] };
                    termHistoryMap.set(term, existing);
                });
                instructorHistory.forEach((entry) => {
                    const term = normalizeTerm(entry && entry.term ? String(entry.term) : '');
                    if (!term) return;
                    const existing = termHistoryMap.get(term) || { term, instructors: [] };
                    const instructors = entry && Array.isArray(entry.instructors)
                        ? entry.instructors.filter(Boolean).map(name => String(name))
                        : [];
                    existing.instructors = Array.from(new Set([...(existing.instructors || []), ...instructors])).sort();
                    termHistoryMap.set(term, existing);
                });
                const sectionTerms = new Set();
                const sectionRows = sectionHistory
                    .map((entry) => {
                        const term = normalizeTerm(entry && entry.term ? String(entry.term) : '');
                        if (!term) return null;
                        sectionTerms.add(term);
                        return {
                            term,
                            termCode: term,
                            section: entry && entry.section ? String(entry.section) : '',
                            crn: entry && entry.crn ? String(entry.crn) : '',
                            instructors: entry && Array.isArray(entry.instructors)
                                ? entry.instructors.filter(Boolean).map(name => String(name))
                                : [],
                            capacity: entry ? entry.capacity : null,
                            actual: entry ? entry.actual : null,
                            remaining: entry ? entry.remaining : null,
                            showSeats: true,
                        };
                    })
                    .filter(Boolean);
                const fallbackRows = Array.from(termHistoryMap.values())
                    .filter(entry => entry && entry.term && !sectionTerms.has(entry.term))
                    .map(entry => ({
                        term: entry.term,
                        termCode: entry.term,
                        section: '',
                        crn: '',
                        instructors: entry && Array.isArray(entry.instructors)
                            ? entry.instructors.filter(Boolean).map(name => String(name))
                            : [],
                        capacity: null,
                        actual: null,
                        remaining: null,
                        showSeats: true,
                        summaryOnly: true,
                    }));
                const limitRowsByDistinctTerms = (rows, maxTerms) => {
                    const seenTerms = new Set();
                    return rows.filter((row) => {
                        const term = row && row.term ? String(row.term) : '';
                        if (!term) return false;
                        if (!seenTerms.has(term) && seenTerms.size >= maxTerms) return false;
                        seenTerms.add(term);
                        return true;
                    });
                };
                const sortedTermHistoryRows = [...sectionRows, ...fallbackRows]
                    .sort((a, b) => {
                        const termDiff = parseInt(String(b.term || '0'), 10) - parseInt(String(a.term || '0'), 10);
                        if (termDiff) return termDiff;
                        return String(a.section || '').localeCompare(String(b.section || '')) || String(a.crn || '').localeCompare(String(b.crn || ''));
                    });
                const termHistoryRows = limitRowsByDistinctTerms(sortedTermHistoryRows, 24);
                const fullTermCount = new Set(termHistoryRows.map(row => row && row.term).filter(Boolean)).size;
                const termHistoryHtml = termHistoryRows.length
                    ? (
                        '<div class="course-details-section">' +
                        `<h4>Offered Terms, Instructors & Seats (${fullTermCount || termHistoryMap.size})</h4>` +
                        '<div class="course-history-anchor" data-course-history-anchor="planner"></div>' +
                        '</div>'
                    )
                    : '<div class="course-details-section"><h4>Offered Terms, Instructors & Seats</h4><p>Not available.</p></div>';

                const termHistoryRowsForDom = termHistoryRows.map(entry => ({
                    term: entry && entry.term ? displayTerm(entry.term) : 'Unknown term',
                    termCode: entry && entry.termCode ? entry.termCode : (entry && entry.term ? entry.term : ''),
                    section: entry && entry.section ? entry.section : '',
                    crn: entry && entry.crn ? entry.crn : '',
                    instructors: entry && Array.isArray(entry.instructors)
                        ? entry.instructors.filter(Boolean).map(name => String(name))
                        : [],
                    capacity: entry ? entry.capacity : null,
                    actual: entry ? entry.actual : null,
                    remaining: entry ? entry.remaining : null,
                    showSeats: true,
                    summaryOnly: !!(entry && entry.summaryOnly),
                }));

                 const body =
                     '<div class="course-details-modal">' +
                     `<p><strong>${escapeHtml(courseCode)}</strong>${title ? ` — ${escapeHtml(title)}` : ''}</p>` +
                     '<div class="course-details-meta">' +
                     `<div><span class="muted">SU Credits:</span> ${escapeHtml(fmt(su))}</div>` +
                     `<div><span class="muted">ECTS:</span> ${escapeHtml(fmt(ects))}</div>` +
                     (bs != null ? `<div><span class="muted">Basic Science:</span> ${escapeHtml(fmt(bs))}</div>` : '') +
                     (eng != null ? `<div><span class="muted">Engineering:</span> ${escapeHtml(fmt(eng))}</div>` : '') +
                     '</div>' +
                     prereqHtml +
                     generalRequirementsHtml +
                     '<div class="course-details-section"><h4>Corequisites</h4><p>' + (coreq ? escapeHtml(coreq) : 'None') + '</p></div>' +
                     descHtml +
                     termHistoryHtml +
                     '</div>';

                ui.alert('Course Details', body, {
                    buttons: [
                        { action: 'close', label: 'Close', variant: 'secondary' },
                        ...(url ? [{
                            action: 'open-course-page',
                            label: 'Open course page',
                            variant: 'primary',
                            href: url,
                            closeOnClick: false,
                        }] : []),
                    ],
                    onMount: ({ body }) => {
                        try {
                            const anchor = body ? body.querySelector('[data-course-history-anchor="planner"]') : null;
                            const build = (typeof window !== 'undefined') ? window.buildCourseHistoryTableElement : null;
                            if (!anchor || typeof build !== 'function') return;
                            const node = build(termHistoryRowsForDom, { splitTerms: true, openOffered: true, openFuture: false });
                            if (node) anchor.appendChild(node);
                        } catch (_) {}
                    },
                });
            } catch (err) {
                try {
                    const ui = (typeof window !== 'undefined') ? window.uiModal : null;
                    if (ui && typeof ui.alert === 'function') {
                        ui.alert('Details unavailable', '<p>Failed to load course details.</p>');
                    }
                } catch (_) {}
            }
        })();
    }
    //CLICKED "<course delete>"

    else if(e.target.classList.contains("delete_course"))
    {
        const semElem = (() => {
            try { return e.target.closest('.semester'); } catch (_) { return null; }
        })();
        const courseElem = (() => {
            try { return e.target.closest('.course'); } catch (_) { return null; }
        })();
        const semObj = semElem ? curriculum.getSemester(semElem.id) : null;
        if (!semObj || !courseElem) return;
        let courseName = '';
        try {
            const container = e.target.closest('.course_container');
            const codeEl = container ? container.querySelector('.course_code') : null;
            courseName = codeEl ? String(codeEl.textContent || '').trim() : '';
        } catch (_) {}
        let credit = (typeof parseCreditValue === 'function')
            ? parseCreditValue(getInfo(courseName, course_data)['SU_credit'])
            : (parseFloat(getInfo(courseName, course_data)['SU_credit']) || 0);
        const courseObj = semObj.courses.find((course) => course.id === courseElem.id) || null;
        let grade = courseObj ? String(courseObj.grade || '') : '';
        if (!courseObj) {
            try {
                const gr = courseElem.querySelector('.grade');
                grade = gr ? String(gr.textContent || '').trim() : '';
            } catch (_) {}
        }

        // Ineligible attempts were already removed from totals. Restore their
        // static contribution before deleteCourse subtracts the course itself.
        const degreeEligible = typeof curriculum.isDegreeEligibleCourse !== 'function'
            || curriculum.isDegreeEligibleCourse(courseObj || { grade });
        if(!degreeEligible){
            let info = getInfo(courseName, course_data);
            if(info){
                adjustSemesterTotals(semObj, info, 1);
            }
        }

        semObj.deleteCourse(courseElem.id);
        //changing total credits element in dom:
        let dom_tc = null;
        try {
            const container = e.target.closest('.container_semester');
            dom_tc = container ? container.querySelector('.total_credit span') : null;
        } catch (_) {}
        if (!dom_tc) {
            try {
                dom_tc = semElem ? semElem.parentNode?.parentNode?.querySelector('span') : null;
            } catch (_) {}
        }
        if (typeof updateSemesterCreditIndicator === 'function') {
            updateSemesterCreditIndicator(dom_tc, semObj);
        } else {
            const totalText = (typeof formatCreditValue === 'function')
                ? formatCreditValue(semObj.totalCredit)
                : (Number(semObj.totalCredit || 0).toFixed(1));
            if (dom_tc) dom_tc.textContent = totalText + ' SU';
        }

        const gradeOutcome = (typeof evaluateGradeForLegacyTotals === 'function')
            ? evaluateGradeForLegacyTotals(grade, courseObj && courseObj.gradingBasis) : null;
        if (gradeOutcome && gradeOutcome.countsInGpa) {
            semObj.totalGPA -= gradeOutcome.gpaPoints * credit;
            semObj.totalGPACredits -= credit;
        }


        try { courseElem.remove(); } catch (_) {}

        // Re-run allocation after a course deletion to update effective types
        try {
            if (typeof curriculum.recalcEffectiveTypes === 'function') {
                curriculum.recalcEffectiveTypes(course_data);
            }
        } catch(err) {
            // ignore
        }
    }
    //CLICKED "<semester_date_edit>"
    else if(e.target.classList.contains("semester_date_edit"))
    {
        let date = e.target.parentNode.parentNode;
        const current = date.querySelector('p') ? date.querySelector('p').textContent : '';
        date.innerHTML = '';
        let select = document.createElement('select');
        select.classList.add('select-control');
        select.setAttribute('aria-label', current
            ? `Semester term for ${current}`
            : 'Semester term');
        select.innerHTML = terms.map(t => `<option value="${t}">${t}</option>`).join('');
        select.value = current;
        let tick = document.createElement("div");
        tick.classList.add("tick");
        date.appendChild(select);
        date.appendChild(tick);
        try {
            if (typeof refreshSemesterAccessibility === 'function') {
                refreshSemesterAccessibility();
            }
        } catch (_) {}
    }
    //CLICKED tick in date
    else if(e.target.classList.contains("tick"))
    {
        let date = e.target.parentNode;
        const selectedTerm = String(date.querySelector("select").value || '');
        const semElem = date.parentNode.querySelector('.semester');
        const semObj = semElem ? curriculum.getSemester(semElem.id) : null;
        let duplicateTerm = false;
        try {
            const duplicateFn = (typeof hasDuplicateSemesterTerm === 'function')
                ? hasDuplicateSemesterTerm
                : ((typeof window !== 'undefined' && typeof window.hasDuplicateSemesterTerm === 'function')
                    ? window.hasDuplicateSemesterTerm : null);
            duplicateTerm = !!(duplicateFn && duplicateFn(
                curriculum,
                selectedTerm,
                { excludeSemesterId: semObj && semObj.id },
            ));
        } catch (_) {
            // A failed identity check must not allow an ambiguous edit.
            duplicateTerm = true;
        }
        if (duplicateTerm) {
            try {
                const ui = (typeof window !== 'undefined') ? window.uiModal : null;
                const body = '<p>A semester card already uses this academic term. Choose a different term.</p>';
                if (ui && typeof ui.alert === 'function') {
                    ui.alert('Semester already exists', body);
                } else {
                    console.warn('Semester already exists');
                }
            } catch (_) {}
            // Keep the select and confirmation control in place so the user can
            // make another choice without reopening the editor.
            try { date.querySelector('select').focus(); } catch (_) {}
            return;
        }
        date.replaceChildren();
        const termLabel = document.createElement('p');
        termLabel.textContent = selectedTerm;
        date.appendChild(termLabel);
        let closebtn = document.createElement("button");
        closebtn.classList.add("delete_semester");
        let drag = document.createElement("div");
        drag.classList.add("semester_drag");
        let edit = document.createElement("div");
        edit.classList.add("semester_date_edit");
        let icons = document.createElement("div");
        icons.classList.add("icons");
        icons.appendChild(edit);
        icons.appendChild(drag);
        icons.appendChild(closebtn);
        date.appendChild(icons)    

        try {
            if (typeof refreshSemesterAccessibility === 'function') {
                refreshSemesterAccessibility();
            }
        } catch (_) {}

        // Update the semester's term index to reflect the new date and
        // recalculate effective categories. The date element sits inside
        // the subcontainer, which also contains the semester div.
        try {
            const newDateTextElem = date.querySelector('p');
            const newDateText = newDateTextElem ? newDateTextElem.textContent : '';
            // Locate the semester corresponding to this date element
            if (semElem) {
                if (semObj) {
                    semObj.termIndex = terms.indexOf(newDateText);
                    semObj.termName = newDateText;
                    semObj.termCode = (typeof termNameToCode === 'function') ? termNameToCode(newDateText) : '';
                }
            }
            if (typeof curriculum.recalcEffectiveTypes === 'function') {
                curriculum.recalcEffectiveTypes(course_data);
            }
        } catch(err) {
            // ignore
        }
        try {
            if (typeof window !== 'undefined' && typeof window.updateCurrentTermHighlights === 'function') {
                window.updateCurrentTermHighlights();
            }
        } catch (_) {}
        try {
            const storage = (typeof window !== 'undefined') ? window.planStorage : null;
            if (storage && typeof storage.requestSave === 'function') storage.requestSave();
        } catch (_) {}
    }
    //CLICKED trash in input:
    else if(e.target.classList.contains("delete_add_course"))
    {
        e.target.parentNode.remove();
    }
//CLICKED ADD GRADE:
    else if(e.target.classList.contains("grade"))
    {
        const gradeElement = e.target;
        if (gradeElement.classList.contains('grade-active')) return;
        const courseElem = gradeElement.closest('.course');
        const semElem = gradeElement.closest('.semester');
        const semObj = semElem ? curriculum.getSemester(semElem.id) : null;
        const courseObj = semObj && courseElem
            ? semObj.courses.find((course) => course.id === courseElem.id)
            : null;
        if (!semObj || !courseObj) return;

        const prevGrade = String(courseObj.grade || '');
        const prevBasis = String(courseObj.gradingBasis || 'unknown');
        const courseName = String(courseObj.code || '');
        const info = getInfo(courseName, course_data);
        const credit = (typeof parseCreditValue === 'function')
            ? parseCreditValue(info && info['SU_credit'])
            : (parseFloat((info && info['SU_credit']) || 0) || 0);
        const policy = (typeof window !== 'undefined') ? window.gradePolicy : null;

        const dropdown = document.createElement('div');
        dropdown.className = 'grade-dropdown-modern';
        dropdown.id = `grade-listbox-${String(courseObj.id || courseElem.id || Date.now())}`;
        dropdown.setAttribute('role', 'listbox');
        dropdown.setAttribute('aria-label', `Select grade for ${courseName}`);
        dropdown.tabIndex = 0;
        gradeElement.setAttribute('aria-controls', dropdown.id);
        gradeElement.setAttribute('aria-expanded', 'true');
        const optionsContainer = document.createElement('div');
        optionsContainer.className = 'grade-dropdown-options';

        const canonicalOptions = policy && Array.isArray(policy.GRADE_UI_OPTIONS)
            ? policy.GRADE_UI_OPTIONS : [
                { value: '', label: 'Registered / no grade' },
                ...['A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'F',
                    'P', 'S', 'U', 'I', 'T', 'NA', 'W'].map((value) => ({ value, label: value })),
            ];
        const gradeOptions = [];
        canonicalOptions.forEach((option) => {
            if (option.value === 'NA') {
                gradeOptions.push({ ...option, label: 'NA — letter-graded course', basis: 'letter' });
                gradeOptions.push({ ...option, label: 'NA — S/U-graded course', basis: 'satisfactory' });
            } else {
                gradeOptions.push(option);
            }
        });

        gradeOptions.forEach((option, optionIndex) => {
            const gradeOption = document.createElement('button');
            gradeOption.type = 'button';
            gradeOption.className = 'grade-option';
            gradeOption.id = `${dropdown.id}-option-${optionIndex + 1}`;
            if (!option.value || option.label !== option.value) gradeOption.classList.add('is-wide');
            gradeOption.dataset.value = option.value;
            if (option.basis) gradeOption.dataset.basis = option.basis;
            gradeOption.textContent = option.label;
            if (option.description) gradeOption.title = option.description;
            gradeOption.setAttribute('role', 'option');
            gradeOption.setAttribute('aria-selected', 'false');
            gradeOption.tabIndex = -1;
            optionsContainer.appendChild(gradeOption);
        });
        dropdown.appendChild(optionsContainer);
        document.body.appendChild(dropdown);
        const anchorRect = gradeElement.getBoundingClientRect();
        const menuWidth = dropdown.offsetWidth || 232;
        const menuHeight = dropdown.offsetHeight || 320;
        const viewportMargin = 8;
        dropdown.style.left = Math.max(viewportMargin,
            Math.min(anchorRect.right - menuWidth, window.innerWidth - menuWidth - viewportMargin)) + 'px';
        const belowTop = anchorRect.bottom + 6;
        dropdown.style.top = (belowTop + menuHeight <= window.innerHeight - viewportMargin)
            ? belowTop + 'px'
            : Math.max(viewportMargin, anchorRect.top - menuHeight - 6) + 'px';
        gradeElement.classList.add('grade-active');

        const optionElements = Array.from(optionsContainer.querySelectorAll('.grade-option'));
        let activeOptionIndex = optionElements.findIndex((option) => (
            String(option.dataset.value || '') === prevGrade
            && (!option.dataset.basis || option.dataset.basis === prevBasis)
        ));
        if (activeOptionIndex < 0) activeOptionIndex = 0;
        const setActiveOption = (index, scroll = true) => {
            if (!optionElements.length) return;
            activeOptionIndex = Math.max(0, Math.min(index, optionElements.length - 1));
            optionElements.forEach((option, optionIndex) => {
                const active = optionIndex === activeOptionIndex;
                option.classList.toggle('is-active', active);
                option.setAttribute('aria-selected', active ? 'true' : 'false');
            });
            const active = optionElements[activeOptionIndex];
            dropdown.setAttribute('aria-activedescendant', active.id);
            if (scroll) {
                try { active.scrollIntoView({ block: 'nearest' }); } catch (_) {}
            }
        };
        setActiveOption(activeOptionIndex, false);

        const recomputeViews = () => {
            try {
                if (typeof curriculum.recalcEffectiveTypes === 'function') {
                    curriculum.recalcEffectiveTypes(course_data);
                }
                if (typeof curriculum.recalcEffectiveTypesDouble === 'function' && curriculum.doubleMajor) {
                    curriculum.recalcEffectiveTypesDouble(curriculum.doubleMajorCourseData);
                }
            } catch (_) {}
        };

        const removeMenuListeners = () => {
            document.removeEventListener('click', closeDropdown, true);
            document.removeEventListener('scroll', closeDropdown, true);
            window.removeEventListener('resize', closeDropdown, true);
        };
        const closeGradeMenu = ({ restoreFocus = false } = {}) => {
            try { dropdown.remove(); } catch (_) {}
            gradeElement.classList.remove('grade-active');
            gradeElement.setAttribute('aria-expanded', 'false');
            removeMenuListeners();
            if (restoreFocus && gradeElement.isConnected) {
                try { gradeElement.focus({ preventScroll: true }); } catch (_) {}
            }
        };
        const closeDropdown = (evt) => {
            const target = evt && evt.target;
            const targetIsNode = typeof Node !== 'undefined' && target instanceof Node;
            if (!targetIsNode || (!gradeElement.contains(target) && !dropdown.contains(target))) {
                // Dismissing the menu is not an edit. Clearing a grade is an
                // explicit option, which prevents accidental data loss.
                closeGradeMenu();
            }
        };

        const selectGradeOption = (gradeOption) => {
            if (gradeOption && gradeOption.classList.contains('grade-option')) {
                const grade = gradeOption.dataset.value;
                const explicitBasis = gradeOption.dataset.basis || '';
                let nextBasis = prevBasis;
                if (explicitBasis) nextBasis = explicitBasis;
                else if (policy && typeof policy.inferGradingBasis === 'function') {
                    const inferred = policy.inferGradingBasis(grade);
                    if (inferred && inferred !== 'unknown') nextBasis = inferred;
                }
                if (!nextBasis) nextBasis = 'unknown';

                const previousOutcome = (typeof evaluateGradeForLegacyTotals === 'function')
                    ? evaluateGradeForLegacyTotals(prevGrade, prevBasis) : null;
                const nextOutcome = (typeof evaluateGradeForLegacyTotals === 'function')
                    ? evaluateGradeForLegacyTotals(grade, nextBasis) : null;
                if (previousOutcome && previousOutcome.countsInGpa) {
                    semObj.totalGPA -= previousOutcome.gpaPoints * credit;
                    semObj.totalGPACredits -= credit;
                }
                if (nextOutcome && nextOutcome.countsInGpa) {
                    semObj.totalGPA += nextOutcome.gpaPoints * credit;
                    semObj.totalGPACredits += credit;
                }

                const wasDegreeEligible = typeof curriculum.isDegreeEligibleCourse === 'function'
                    ? curriculum.isDegreeEligibleCourse({ grade: prevGrade, gradingBasis: prevBasis })
                    : prevGrade !== 'F';
                const isDegreeEligible = typeof curriculum.isDegreeEligibleCourse === 'function'
                    ? curriculum.isDegreeEligibleCourse({ grade, gradingBasis: nextBasis })
                    : grade !== 'F';
                if(!wasDegreeEligible && isDegreeEligible){
                    adjustSemesterTotals(semObj, info, 1);
                } else if(wasDegreeEligible && !isDegreeEligible){
                    adjustSemesterTotals(semObj, info, -1);
                }
                courseObj.grade = grade;
                courseObj.gradingBasis = nextBasis;

                gradeElement.textContent = grade || 'Add grade';
                gradeElement.setAttribute(
                    'aria-label',
                    `Grade for ${courseName}: ${grade || 'not entered'}`,
                );
                closeGradeMenu({ restoreFocus: true });
                recomputeViews();
                try {
                    const storage = (typeof window !== 'undefined') ? window.planStorage : null;
                    if (storage && typeof storage.requestSave === 'function') storage.requestSave();
                } catch (_) {}
            }
        };

        optionsContainer.addEventListener('click', (evt) => {
            const gradeOption = evt.target && evt.target.closest
                ? evt.target.closest('.grade-option') : null;
            if (gradeOption && optionsContainer.contains(gradeOption)) {
                evt.preventDefault();
                evt.stopPropagation();
                selectGradeOption(gradeOption);
            }
        });
        dropdown.addEventListener('keydown', (evt) => {
            if (!optionElements.length) return;
            if (evt.key === 'ArrowDown' || evt.key === 'ArrowRight') {
                evt.preventDefault();
                setActiveOption((activeOptionIndex + 1) % optionElements.length);
            } else if (evt.key === 'ArrowUp' || evt.key === 'ArrowLeft') {
                evt.preventDefault();
                setActiveOption((activeOptionIndex - 1 + optionElements.length) % optionElements.length);
            } else if (evt.key === 'Home') {
                evt.preventDefault();
                setActiveOption(0);
            } else if (evt.key === 'End') {
                evt.preventDefault();
                setActiveOption(optionElements.length - 1);
            } else if (evt.key === 'Enter' || evt.key === ' ') {
                evt.preventDefault();
                selectGradeOption(optionElements[activeOptionIndex]);
            } else if (evt.key === 'Escape') {
                evt.preventDefault();
                evt.stopPropagation();
                closeGradeMenu({ restoreFocus: true });
            }
        });
        document.addEventListener('click', closeDropdown, true);
        document.addEventListener('scroll', closeDropdown, true);
        window.addEventListener('resize', closeDropdown, true);
        try { dropdown.focus({ preventScroll: true }); } catch (_) { dropdown.focus(); }
    }
}
