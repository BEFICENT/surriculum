// Planner course-picker/filter controller.
(function installPlannerCoursePicker(root) {
    'use strict';

    function openCoursePicker(context) {
        const deps = context || {};
        const e = deps.event;
        const curriculum = deps.curriculum;
        const course_data = deps.courseData;
        if (!e || !e.target || !curriculum || !Array.isArray(course_data)) return false;

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
            + '  <div class="planner-course-filter-heading">'
            + '    <div class="planner-course-filter-title">Course filters</div>'
            + '    <div class="planner-course-filter-context"></div>'
            + '  </div>'
            + '  <button class="btn-icon planner-course-filter-close" type="button" aria-label="Close course filters" title="Close course filters">'
            + '    <i class="fa-solid fa-xmark" aria-hidden="true"></i>'
            + '  </button>'
            + '</div>'
            + '<fieldset class="planner-course-filter-section">'
            + '  <legend>Eligibility</legend>'
            + `  <label class="planner-filter-toggle" for="${hideTakenId}"><span>Hide courses planned in this or earlier semesters</span><input class="planner-filter-hide-taken" id="${hideTakenId}" type="checkbox"></label>`
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
        const filterCloseButton = filterMenu.querySelector('.planner-course-filter-close');
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

        const layoutFactory = typeof window !== 'undefined'
            && window.SurriculumModules
            && window.SurriculumModules.plannerCoursePickerLayout;
        if (!layoutFactory || typeof layoutFactory.createLayoutController !== 'function') {
            throw new Error('Planner course-picker layout module is unavailable.');
        }
        const cleanupDropdown = layoutFactory.createLayoutController({
            document,
            dropdown,
            filterMenu,
            filterButton,
            searchRow,
            targetSemesterElement,
            semesterContainer,
            inputContainer: input_container,
        });
        const positionDropdown = cleanupDropdown.positionDropdown;
        const positionFilterMenu = cleanupDropdown.positionFilterMenu;

        const scoreOptions = (() => {
            const options = {
                progressPolicy: 'before-target',
                targetTermCode,
            };
            let scorer = null;
            let scorerKey = '';
            let appliedKey = '';
            const getScorer = () => {
                try {
                    const keyFor = (typeof window !== 'undefined')
                        ? window.getCourseSuggestionScorerKey : null;
                    const nextKey = typeof keyFor === 'function' ? keyFor(options) : '';
                    if (scorer && scorer.available !== false
                        && (!nextKey || scorerKey === nextKey)) return scorer;
                    const build = (typeof window !== 'undefined')
                        ? window.buildCourseSuggestionScorer : null;
                    if (typeof build === 'function') {
                        scorer = build(options);
                        scorerKey = scorer && scorer.key ? scorer.key : nextKey;
                    }
                } catch (_) {}
                return scorer;
            };
            const apply = () => {
                try {
                    const fn = (typeof window !== 'undefined') ? window.computeCourseSuggestionScore : null;
                    const ranker = getScorer();
                    if ((!ranker || typeof ranker.score !== 'function') && typeof fn !== 'function') return;
                    const nextAppliedKey = ranker && ranker.key ? ranker.key : scorerKey;
                    if (nextAppliedKey && appliedKey === nextAppliedKey) return;
                    candidates.forEach((candidate) => {
                        if (candidate && candidate.code) {
                            candidate.score = ranker && typeof ranker.score === 'function'
                                ? ranker.score(candidate.code)
                                : fn(candidate.code, options);
                        }
                    });
                    appliedKey = nextAppliedKey;
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

        const optionRendererFactory = typeof window !== 'undefined'
            && window.SurriculumModules
            && window.SurriculumModules.plannerCoursePickerOptionRenderer;
        if (!optionRendererFactory
            || typeof optionRendererFactory.createOptionRenderer !== 'function') {
            throw new Error('Planner course-picker option renderer is unavailable.');
        }
        const optionRenderer = optionRendererFactory.createOptionRenderer({
            document,
            filterApi,
            controls,
            targetTermCode,
        });
        const renderOptionContent = optionRenderer.renderOptionContent;

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
                    if (filterApi && typeof filterApi.compareCandidateActionability === 'function') {
                        const actionabilityDifference = filterApi.compareCandidateActionability(
                            left,
                            right,
                            filters,
                        );
                        if (actionabilityDifference) return actionabilityDifference;
                    }
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

        const closeFilterMenu = (restoreFocus) => {
            dropdown.style.display = 'none';
            input.setAttribute('aria-expanded', 'false');
            setFilterMenuOpen(false, restoreFocus);
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
            if (filterMenu.hidden) setFilterMenuOpen(true, false);
            else closeFilterMenu(false);
        });
        if (filterCloseButton) {
            cleanupDropdown.on(filterCloseButton, 'click', (evt) => {
                evt.preventDefault();
                evt.stopPropagation();
                closeFilterMenu(true);
            });
        }
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
                    closeFilterMenu(true);
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
            closeFilterMenu(true);
        });
        cleanupDropdown.on(document, 'pointerdown', (evt) => {
            if (input_container.contains(evt.target)) return;
            closeFilterMenu(false);
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
        let scoreRefreshQueued = false;
        const queueScoreRefresh = () => {
            if (scoreRefreshQueued) return;
            scoreRefreshQueued = true;
            const refresh = () => {
                scoreRefreshQueued = false;
                if (!input_container.isConnected) return;
                scoreOptions.apply();
                renderOptions(input.value);
            };
            try {
                if (typeof queueMicrotask === 'function') queueMicrotask(refresh);
                else if (typeof Promise !== 'undefined') Promise.resolve().then(refresh);
                else setTimeout(refresh, 0);
            } catch (_) {
                setTimeout(refresh, 0);
            }
        };
        cleanupDropdown.on(document, 'surriculum:planchange', () => {
            queueScoreRefresh();
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

        return true;
    }

    const namespace = root.SurriculumModules || (root.SurriculumModules = {});
    namespace.plannerCoursePicker = Object.freeze({ open: openCoursePicker });
})(typeof window !== 'undefined' ? window : globalThis);
