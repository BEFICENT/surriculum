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
        const isCurrentTermSemester = () => {
            try {
                const ct = (typeof window !== 'undefined' && window.currentTermName) ? String(window.currentTermName) : '';
                if (!ct) return false;
                return getSemesterTermName() === ct;
            } catch (_) {
                return false;
            }
        };

        let input_container =  document.createElement("div");
        input_container.classList.add("input_container");

        // Wrapper to position the custom dropdown relative to the input
        let wrapper = document.createElement('div');
        wrapper.classList.add('input-wrapper');

        let input = document.createElement("input");
        // Use same styling as other dropdowns for a consistent UI
        input.classList.add("course_select", "select-control");

        // Hidden datalist maintained for backwards compatibility but not used
        const listId = 'course_list_' + Date.now();
        let datalist = document.createElement('datalist');
        datalist.id = listId;
        datalist.classList.add('course_list');
        datalist.innerHTML = getCoursesDataList(course_data);

        // Custom dropdown container
        let dropdown = document.createElement('div');
        dropdown.classList.add('course-dropdown');

        // Build array of course options for filtering
        let options = getCoursesList(course_data);
        let optionsSortedByScore = false;
        let offeringsLoadInFlight = false;

        // Floating dropdown positioning (fixed) so it can render above the input
        // without being clipped by scroll containers or hidden under headers.
        const positionDropdown = () => {
            try {
                if (!dropdown || dropdown.style.display === 'none') return;
                const r = input.getBoundingClientRect();
                const margin = 6;
                const viewportW = window.innerWidth || document.documentElement.clientWidth || 0;
                const viewportH = window.innerHeight || document.documentElement.clientHeight || 0;

                const width = Math.max(160, Math.round(r.width || 0));
                const left = Math.max(8, Math.min(Math.round(r.left || 0), Math.max(8, viewportW - width - 8)));

                // Always prefer above (as requested).
                const spaceAbove = Math.max(0, Math.round(r.top || 0) - margin);
                const maxH = Math.max(120, Math.min(320, spaceAbove));

                dropdown.style.left = left + 'px';
                dropdown.style.width = width + 'px';
                dropdown.style.right = 'auto';
                dropdown.style.top = 'auto';
                dropdown.style.bottom = Math.max(8, Math.round(viewportH - (r.top || 0) + margin)) + 'px';
                dropdown.style.maxHeight = maxH + 'px';
            } catch (_) {}
        };

        const cleanupDropdown = (() => {
            const ac = (typeof AbortController !== 'undefined') ? new AbortController() : null;
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
                try { dropdown.style.display = 'none'; } catch (_) {}
                try { if (ac) ac.abort(); } catch (_) {}
            };
            return { on, cleanup };
        })();

        // Optional scoring model for sorting course suggestions.
        // Uses the shared helper so the scheduler and planner stay in sync.
        const scoreOptions = (() => {
            const apply = () => {
                try {
                    const fn = (typeof window !== 'undefined') ? window.computeCourseSuggestionScore : null;
                    if (typeof fn !== 'function') return;
                    for (let i = 0; i < options.length; i++) {
                        const o = options[i];
                        if (!o || !o.code) continue;
                        o.score = fn(o.code);
                    }
                } catch (_) {}
            };
            return { apply };
        })();
        try { scoreOptions.apply(); } catch (_) {}

        const ensureOptionsSortedIfNeeded = () => {
            try {
                if (!(typeof window !== 'undefined' && window.sortBasedOnScore)) {
                    optionsSortedByScore = false;
                    return;
                }
                if (optionsSortedByScore) return;
                options.sort((a, b) => {
                    const as = (a && typeof a.score === 'number') ? a.score : 0;
                    const bs = (b && typeof b.score === 'number') ? b.score : 0;
                    if (bs !== as) return bs - as;
                    const ac = (a && a.code) ? String(a.code) : '';
                    const bc = (b && b.code) ? String(b.code) : '';
                    return ac.localeCompare(bc);
                });
                optionsSortedByScore = true;
            } catch (_) {
                optionsSortedByScore = false;
            }
        };

        function capitalizeFirst(str) {
            return str.charAt(0).toUpperCase() + str.slice(1);
        }

        function formatOption(item) {
            const title = `<div class="course-option-title">${item.code} ${item.name}</div>`;
            if (window.showCourseDetails) {
                const parts = [
                    `SU Credits: ${item.credit}`,
                    `Basic Science: ${item.bs}`
                ];
                if (item.type) parts.push(`Course Type: ${capitalizeFirst(item.type)}`);
                if (item.dmType) parts.push(`CT for DM: ${capitalizeFirst(item.dmType)}`);
                const details = parts.map(p => `<div>${p}</div>`).join('');
                return title + `<div class="course-option-details">${details}</div>`;
            }
            return title;
        }

        function renderOptions(filter) {
            dropdown.innerHTML = '';
            const normalized = filter ? String(filter).toUpperCase() : '';
            const normalizedNoSpace = normalized.replace(/\s+/g, '');

            // Only apply "offered this term" filtering when the user is adding
            // courses to the CURRENT TERM semester. Other semesters should not
            // be constrained by current offerings.
            const offeredFilterActive = (() => {
                try { return (typeof window !== 'undefined' && window.offeredThisTermOnly && isCurrentTermSemester()); } catch (_) { return false; }
            })();

            if (offeredFilterActive && !window.courseOfferingsByCode && typeof window.loadCourseOfferingsIndex === 'function') {
                // Avoid scheduling hundreds of rerenders while the offerings index loads.
                if (!offeringsLoadInFlight) {
                    offeringsLoadInFlight = true;
                    window.loadCourseOfferingsIndex()
                        .then(() => { offeringsLoadInFlight = false; try { renderOptions(input.value); } catch (_) {} })
                        .catch(() => { offeringsLoadInFlight = false; });
                }
                const loading = document.createElement('div');
                loading.className = 'course-option';
                loading.innerHTML = '<div class="course-option-title">Loading current-term offerings…</div>';
                dropdown.appendChild(loading);
                dropdown.style.display = 'block';
                positionDropdown();
                activeIndex = -1;
                return;
            }

            ensureOptionsSortedIfNeeded();

            const frag = document.createDocumentFragment();
            let count = 0;
            const maxToRender = 220;
            let totalMatches = 0;

            for (let i = 0; i < options.length; i++) {
                const o = options[i];
                if (!o || !o.code) continue;
                const searchUpper = o.searchUpper || (String(o.code + ' ' + (o.name || '')).toUpperCase());
                const searchNoSpace = o.searchNoSpace || (String(o.code + (o.name || '')).toUpperCase().replace(/\s+/g, ''));
                const textMatch = !normalized || searchUpper.includes(normalized) || searchNoSpace.includes(normalizedNoSpace);
                if (!textMatch) continue;

                if (offeredFilterActive && typeof window.isCourseOfferedInCurrentTerm === 'function') {
                    if (!window.isCourseOfferedInCurrentTerm(o.code)) continue;
                }

                totalMatches++;
                if (count >= maxToRender) continue;

                const opt = document.createElement('div');
                opt.className = 'course-option';
                opt.dataset.code = o.code;
                opt.dataset.name = o.name || '';
                opt.innerHTML = formatOption(o);
                frag.appendChild(opt);
                count++;
            }

            dropdown.appendChild(frag);
            if (totalMatches > maxToRender) {
                const more = document.createElement('div');
                more.className = 'course-option';
                more.innerHTML = `<div class="course-option-title">Showing ${maxToRender} of ${totalMatches}. Type more to narrow.</div>`;
                dropdown.appendChild(more);
            }

            dropdown.style.display = totalMatches ? 'block' : 'none';
            positionDropdown();
            activeIndex = -1;
        }

        let activeIndex = -1;
        function updateActive(items) {
            items.forEach((el, idx) => {
                if (idx === activeIndex) el.classList.add('active');
                else el.classList.remove('active');
            });
        }

        input.addEventListener('input', () => renderOptions(input.value));
        input.addEventListener('focus', () => renderOptions(input.value));
        input.addEventListener('blur', () => {
            setTimeout(() => { dropdown.style.display = 'none'; }, 100);
        });

        // Keep dropdown anchored while the user scrolls/resizes (including
        // horizontal scrolling of the board).
        try {
            const scrollParent = input.closest('.semester') || null;
            const boardScrollParent = (semesterContainer && semesterContainer.closest)
                ? semesterContainer.closest('.board')
                : (input.closest ? input.closest('.board') : null);
            const extraBoard = (!boardScrollParent && typeof document !== 'undefined')
                ? document.querySelector('.board')
                : null;
            const handler = () => { try { positionDropdown(); } catch (_) {} };
            cleanupDropdown.on(window, 'resize', handler);
            cleanupDropdown.on(window, 'scroll', handler, { passive: true });
            if (scrollParent) cleanupDropdown.on(scrollParent, 'scroll', handler, { passive: true });
            if (boardScrollParent) cleanupDropdown.on(boardScrollParent, 'scroll', handler, { passive: true });
            if (extraBoard) cleanupDropdown.on(extraBoard, 'scroll', handler, { passive: true });
        } catch (_) {}

        input.addEventListener('keydown', function(evt){
            const items = Array.from(dropdown.querySelectorAll('.course-option')).filter(el => {
                try { return !!(el && el.dataset && el.dataset.code); } catch (_) { return false; }
            });
            if (evt.key === 'ArrowDown') {
                activeIndex = Math.min(activeIndex + 1, items.length - 1);
                updateActive(items);
                evt.preventDefault();
            } else if (evt.key === 'ArrowUp') {
                activeIndex = Math.max(activeIndex - 1, 0);
                updateActive(items);
                evt.preventDefault();
            } else if (evt.key === 'Enter') {
                if (activeIndex >= 0 && items[activeIndex]) {
                    input.value = items[activeIndex].dataset.code + ' ' + items[activeIndex].dataset.name;
                }
                enter.click();
            }
        });

        document.addEventListener('courseDetailsToggleChanged', () => {
            renderOptions(input.value);
        });
        document.addEventListener('hideTakenCoursesToggleChanged', () => {
            options = getCoursesList(course_data);
            datalist.innerHTML = getCoursesDataList(course_data);
            try { scoreOptions.apply(); } catch (_) {}
            optionsSortedByScore = false;
            renderOptions(input.value);
        });
        document.addEventListener('offeredThisTermToggleChanged', () => {
            renderOptions(input.value);
        });
        document.addEventListener('sortByScoreToggleChanged', () => {
            optionsSortedByScore = false;
            renderOptions(input.value);
        });

        let enter = document.createElement("div");
        enter.classList.add("enter");
        let delete_ac = document.createElement("div");
        delete_ac.classList.add("delete_add_course");

        // Ensure we remove the floating dropdown listeners even if the global
        // click handler removes the input container.
        try { cleanupDropdown.on(enter, 'click', () => cleanupDropdown.cleanup()); } catch (_) {}
        try {
            delete_ac.addEventListener('click', (evt) => {
                try { cleanupDropdown.cleanup(); } catch (_) {}
                try { input_container.remove(); } catch (_) {}
                evt.stopPropagation();
            });
        } catch (_) {}

        wrapper.appendChild(input);
        wrapper.appendChild(dropdown);
        wrapper.appendChild(datalist);
        input_container.appendChild(wrapper);
        input_container.appendChild(enter);
        input_container.appendChild(delete_ac);

        e.target.parentNode.insertBefore(input_container, e.target.parentNode.querySelector(".addCourse"));

        // Automatically focus so the user can start typing immediately
        setTimeout(() => { input.focus(); renderOptions(''); }, 0);

        // Single delegated handler instead of per-option listeners (faster to re-render).
        try {
            dropdown.addEventListener('mousedown', (evt) => {
                const opt = (evt && evt.target && typeof evt.target.closest === 'function')
                    ? evt.target.closest('.course-option')
                    : null;
                if (!opt || !opt.dataset || !opt.dataset.code) return;
                input.value = String(opt.dataset.code) + ' ' + String(opt.dataset.name || '');
                dropdown.style.display = 'none';
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
        // Now we have a valid courseCode. Generate a unique id for the new
        // course and proceed with addition.
        curriculum.course_id = curriculum.course_id + 1;
        let course_id = 'c' + curriculum.course_id;
        let myCourse = new s_course(courseCode, course_id);
        if(!curriculum.hasCourse(courseCode)) {
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
            c_label.innerHTML =
                '<div class="course_code">' + myCourse.code + '</div>' +
                '<div class="course_actions">' +
                '<button class="details_course" type="button" title="Details" aria-label="Course details">' +
                '<i class="fa-solid fa-circle-info"></i>' +
                '</button>' +
                '<button class="delete_course" type="button" title="Delete" aria-label="Delete course"></button>' +
                '</div>';
            let c_info = document.createElement("div");
            c_info.classList.add("course_info");
            // Use getInfo to fetch course details (works for DM-only courses)
            const info = getInfo(courseCode, course_data) || getInfo(originalCourseCode, course_data);
            c_info.innerHTML = '<div class="course_name">'+ info['Course_Name'] +'</div>';
            c_info.innerHTML += '<div class="course_type">'+ info['EL_Type'].toUpperCase() + '</div>';
            const creditText = (typeof formatCreditValue === 'function')
                ? formatCreditValue(info['SU_credit'])
                : (Number(parseFloat(info['SU_credit'] || '0') || 0).toFixed(1));
            c_info.innerHTML += '<div class="course_credit">' + creditText + ' credits </div>';
            const bsDiv = document.createElement('div');
            bsDiv.classList.add('course_bs_credit');
            bsDiv.textContent = 'BS: ' + (info['Basic_Science'] || '0') + ' credits';
            if (!window.showCourseDetails) {
                bsDiv.style.display = 'none';
            }
            c_info.appendChild(bsDiv);
            let grade = document.createElement('div');
            grade.classList.add('grade');
            grade.innerHTML = 'Add grade';
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
            const totalText = (typeof formatCreditValue === 'function')
                ? formatCreditValue(sem.totalCredit)
                : (Number(sem.totalCredit || 0).toFixed(1));
            dom_tc.innerHTML = 'Total: ' + totalText + ' credits';
            try {
                dom_tc.classList.toggle('is-overlimit', (sem.totalCredit || 0) > 20);
            } catch (_) {}
            // Remove input container after adding course
            e.target.parentNode.remove();
            // Recalculate categories for main (and DM via recalc) after adding
            try {
                if (typeof curriculum.recalcEffectiveTypes === 'function') {
                    curriculum.recalcEffectiveTypes(course_data);
                }
            } catch(err) {}
        } else {
            try {
                const ui = (typeof window !== 'undefined') ? window.uiModal : null;
                const body = `<p>You have already added <strong>${escapeHtml(myCourse.code || '')}</strong>.</p>`;
                if (ui && typeof ui.alert === 'function') ui.alert('Already added', body);
                else console.warn('Already added', myCourse.code);
            } catch (_) {}
            e.target.parentNode.querySelector("input").value = '';
        }
    }
    //CLICKED "<semester delete>"
    else if(e.target.classList.contains("delete_semester"))
    {
        let id = extractNumericValue(e.target.parentNode.parentNode.parentNode.parentNode.id);


        curriculum.deleteSemester(e.target.parentNode.parentNode.parentNode.querySelector('.semester').id);
        e.target.parentNode.parentNode.parentNode.parentNode.remove();

        let containers = document.querySelectorAll(".container_semester");
        containers.forEach((element)=>{
            if(extractNumericValue(element.id) > id)
            {
                element.id = 'con' + (extractNumericValue(element.id) - 1);
                curriculum.container_id = extractNumericValue(element.id);
            }
        })

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
                if (!ui || typeof ui.alert !== 'function') return;
                if (typeof load !== 'function') {
                    ui.alert('Details unavailable', '<p>Course details index is not available.</p>');
                    return;
                }

                const idx = await load();
                const info = idx && typeof idx.get === 'function' ? idx.get(courseCode) : null;
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
                const desc = (info.description || '').toString();
                const offered = Array.isArray(info.last_offered_terms) ? info.last_offered_terms : [];
                const url = info.source_url || buildCourseUrl(courseCode);

                const fmt = (v) => {
                    try {
                        if (typeof window !== 'undefined' && typeof window.formatCreditValue === 'function') {
                            return window.formatCreditValue(v);
                        }
                    } catch (_) {}
                    const n = parseFloat(v || '0');
                    return (isFinite(n) ? n : 0).toFixed(1);
                };

                const descHtml = desc
                    ? `<div class="course-details-section"><h4>Description</h4><p>${escapeHtml(desc).replace(/\n/g, '<br>')}</p></div>`
                    : '';

                const offeredPreview = offered.slice(0, 12);
                const offeredHtml = offeredPreview.length
                    ? (
                        '<div class="course-details-section">' +
                        `<h4>Last Offered (${offered.length})</h4>` +
                        '<ul class="course-details-list">' +
                        offeredPreview.map(o => {
                            const term = o && o.term ? String(o.term) : '';
                            const name = o && o.course_name ? String(o.course_name) : '';
                            const cr = (o && (o.su_credit ?? o.su_credits) != null) ? (o.su_credit ?? o.su_credits) : su;
                            const label = term ? term : 'Unknown term';
                            const suffix = name ? ` — ${name}` : '';
                            return `<li><strong>${escapeHtml(label)}</strong>${escapeHtml(suffix)} <span class="muted">(${escapeHtml(fmt(cr))} cr)</span></li>`;
                        }).join('') +
                        '</ul>' +
                        '</div>'
                    )
                    : '<div class="course-details-section"><h4>Last Offered</h4><p>Not available.</p></div>';

                 const body =
                     '<div class="course-details-modal">' +
                     `<p><strong>${escapeHtml(courseCode)}</strong>${title ? ` — ${escapeHtml(title)}` : ''}</p>` +
                     '<div class="course-details-meta">' +
                     `<div><span class="muted">SU Credits:</span> ${escapeHtml(fmt(su))}</div>` +
                     `<div><span class="muted">ECTS:</span> ${escapeHtml(fmt(ects))}</div>` +
                     (bs != null ? `<div><span class="muted">Basic Science:</span> ${escapeHtml(fmt(bs))}</div>` : '') +
                     (eng != null ? `<div><span class="muted">Engineering:</span> ${escapeHtml(fmt(eng))}</div>` : '') +
                     '</div>' +
                     '<div class="course-details-section"><h4>Prerequisites</h4><p>' + (prereq ? escapeHtml(prereq) : 'None') + '</p></div>' +
                     '<div class="course-details-section"><h4>Corequisites</h4><p>' + (coreq ? escapeHtml(coreq) : 'None') + '</p></div>' +
                     offeredHtml +
                     descHtml +
                     (url ? `<div class="course-details-actions"><a class="btn btn-primary" href="${escapeHtml(url)}" target="_blank" rel="noopener">Open course page</a></div>` : '') +
                     '</div>';

                ui.alert('Course Details', body);
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
        let grade = '';
        try {
            const gr = courseElem.querySelector('.grade');
            grade = gr ? gr.innerHTML : '';
        } catch (_) {}

        // If this course had grade F we previously removed its credits. Add them back before deletion
        if(grade == 'F'){
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
        {
            const totalText = (typeof formatCreditValue === 'function')
                ? formatCreditValue(semObj.totalCredit)
                : (Number(semObj.totalCredit || 0).toFixed(1));
            if (dom_tc) dom_tc.innerHTML = 'Total: ' + totalText + ' credits';
        }
        try {
            if (dom_tc) dom_tc.classList.toggle('is-overlimit', (semObj.totalCredit || 0) > 20);
        } catch (_) {}

        const gradeValue = letter_grades_global_dic[grade];
        if (gradeValue !== undefined) {
            semObj.totalGPA -= gradeValue * credit;
            if (grade !== 'T') {
                semObj.totalGPACredits -= credit;
            }
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
        select.innerHTML = terms.map(t => `<option value="${t}">${t}</option>`).join('');
        select.value = current;
        let tick = document.createElement("div");
        tick.classList.add("tick");
        tick.style.backgroundImage = "url('./assets/tickw.png')";
        date.appendChild(select);
        date.appendChild(tick);
    }
    //CLICKED tick in date
    else if(e.target.classList.contains("tick"))
    {
        let date = e.target.parentNode;
        date.innerHTML = '<p>' + date.querySelector("select").value + '</p>';
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

        // Update the semester's term index to reflect the new date and
        // recalculate effective categories. The date element sits inside
        // the subcontainer, which also contains the semester div.
        try {
            const newDateTextElem = date.querySelector('p');
            const newDateText = newDateTextElem ? newDateTextElem.innerHTML : '';
            // Locate the semester corresponding to this date element
            const semElem = date.parentNode.querySelector('.semester');
            if (semElem) {
                const semObj = curriculum.getSemester(semElem.id);
                if (semObj) {
                    semObj.termIndex = terms.indexOf(newDateText);
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
    }
    //CLICKED trash in input:
    else if(e.target.classList.contains("delete_add_course"))
    {
        e.target.parentNode.remove();
    }
//CLICKED ADD GRADE:
    else if(e.target.classList.contains("grade"))
    {
        var prevGrade;
        var gradeElement = e.target; // Store reference to the grade element

        if(e.target.innerHTML.length <= 2)
        {
            prevGrade = e.target.innerHTML;

            let sem = e.target.parentNode.parentNode.parentNode;
            let courseName = e.target.parentNode.querySelector('.course_label').firstChild.innerHTML;
            let credit = (typeof parseCreditValue === 'function')
                ? parseCreditValue(getInfo(courseName, course_data)['SU_credit'])
                : (parseFloat(getInfo(courseName, course_data)['SU_credit']) || 0);

            const prevGradeValue = letter_grades_global_dic[prevGrade];
            if (prevGradeValue !== undefined) {
                curriculum.getSemester(sem.id).totalGPA -= prevGradeValue * credit;
                if (prevGrade !== 'T') {
                    curriculum.getSemester(sem.id).totalGPACredits -= credit;
                }
            }
        }

        // Create modern dropdown
        const dropdown = document.createElement('div');
        dropdown.className = 'grade-dropdown-modern';

        // Create options container (removed header to save space)
        const optionsContainer = document.createElement('div');
        optionsContainer.className = 'grade-dropdown-options';

        // Most common grades in order of frequency
        const commonGrades = ['S', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-','D+', 'D', 'F'];

        commonGrades.forEach(grade => {
            const gradeOption = document.createElement('div');
            gradeOption.className = 'grade-option';
            gradeOption.dataset.value = grade;
            gradeOption.textContent = grade;
            optionsContainer.appendChild(gradeOption);
        });

        dropdown.appendChild(optionsContainer);

        gradeElement.innerHTML = '';
        gradeElement.appendChild(dropdown);
        gradeElement.classList.add('grade-active');

        // Handle grade selection
        optionsContainer.addEventListener('click', (evt) => {
            if(evt.target.classList.contains('grade-option')) {
                evt.stopPropagation();
                const grade = evt.target.dataset.value;

                // Use stored reference instead of e.target
                let sem = gradeElement.parentNode.parentNode.parentNode;
                let courseName = gradeElement.parentNode.querySelector('.course_label').firstChild.innerHTML;
                let credit = (typeof parseCreditValue === 'function')
                    ? parseCreditValue(getInfo(courseName, course_data)['SU_credit'])
                    : (parseFloat(getInfo(courseName, course_data)['SU_credit']) || 0);
                let semObj = curriculum.getSemester(sem.id);
                const gradeValue = letter_grades_global_dic[grade];
                if (gradeValue !== undefined) {
                    semObj.totalGPA += gradeValue * credit;
                    if (grade !== 'T') {
                        semObj.totalGPACredits += credit;
                    }
                }

                // Adjust earned credits
                let info = getInfo(courseName, course_data);
                if(prevGrade === 'F' && grade !== 'F'){
                    adjustSemesterTotals(semObj, info, 1);
                } else if(prevGrade !== 'F' && grade === 'F'){
                    adjustSemesterTotals(semObj, info, -1);
                }

                // Update display
                gradeElement.innerHTML = grade;
                gradeElement.classList.remove('grade-active');

                // Remove the outside click listener
                document.removeEventListener('click', closeDropdown);

                // Recalculate effective categories
                try {
                    if (typeof curriculum.recalcEffectiveTypes === 'function') {
                        curriculum.recalcEffectiveTypes(course_data);
                    }
                    if (typeof curriculum.recalcEffectiveTypesDouble === 'function' && curriculum.doubleMajor) {
                        curriculum.recalcEffectiveTypesDouble(curriculum.doubleMajorCourseData);
                    }
                } catch (_) {}
            }
        });

        // Handle clicking outside to close (with longer delay)
        const closeDropdown = (evt) => {
            if (!gradeElement.contains(evt.target)) {
                // Handle empty selection
                let sem = gradeElement.parentNode.parentNode.parentNode;
                let courseName = gradeElement.parentNode.querySelector('.course_label').firstChild.innerHTML;
                let semObj = curriculum.getSemester(sem.id);

                if(prevGrade === 'F'){
                    let info = getInfo(courseName, course_data);
                    adjustSemesterTotals(semObj, info, 1);
                }

                gradeElement.innerHTML = 'Add grade';
                gradeElement.classList.remove('grade-active');

                document.removeEventListener('click', closeDropdown);

                try{
                    if (typeof curriculum.recalcEffectiveTypes === 'function') {
                        curriculum.recalcEffectiveTypes(course_data);
                    }
                    if (typeof curriculum.recalcEffectiveTypesDouble === 'function' && curriculum.doubleMajor) {
                        curriculum.recalcEffectiveTypesDouble(curriculum.doubleMajorCourseData);
                    }
                }catch(_){}
            }
        };

        // Longer delay before enabling outside click
        setTimeout(() => document.addEventListener('click', closeDropdown), 200);
    }
}
