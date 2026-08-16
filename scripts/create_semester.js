function createSemeter(aslastelement=true, courseList=[], curriculum, course_data, grade_list=[], date_custom="", grading_basis_list=[])
{
    const interactiveDefault = !date_custom && arguments.length <= 4;
    if (interactiveDefault) {
        const canonicalCode = (term) => {
            try {
                const fn = (typeof semesterTermCode === 'function')
                    ? semesterTermCode
                    : ((typeof window !== 'undefined' && typeof window.semesterTermCode === 'function')
                        ? window.semesterTermCode : null);
                if (fn) return String(fn(term) || '');
            } catch (_) {}
            try {
                return typeof termNameToCode === 'function' ? String(termNameToCode(term) || '') : '';
            } catch (_) {
                return '';
            }
        };
        const existing = curriculum && Array.isArray(curriculum.semesters)
            ? curriculum.semesters : [];
        const usedCodes = new Set(existing.map(canonicalCode).filter(Boolean));
        const isUnused = (termName) => {
            const code = canonicalCode(termName);
            return !!code && !usedCodes.has(code);
        };

        let startIndex = -1;
        existing.forEach((semester) => {
            const code = canonicalCode(semester);
            const label = code && typeof termCodeToName === 'function'
                ? termCodeToName(code) : '';
            const index = terms.indexOf(label);
            if (index >= 0 && (startIndex < 0 || index < startIndex)) startIndex = index;
        });

        if (startIndex < 0) {
            let entryTerm = '';
            try {
                const storage = (typeof window !== 'undefined') ? window.planStorage : null;
                const planId = storage && typeof storage.getSessionPlanId === 'function'
                    ? storage.getSessionPlanId() : null;
                entryTerm = storage && planId && typeof storage.getItem === 'function'
                    ? String(storage.getItem('entryTerm', planId) || '') : '';
            } catch (_) {}
            if (!entryTerm && typeof window !== 'undefined') entryTerm = window.currentTermName || '';
            startIndex = terms.indexOf(entryTerm);
            if (startIndex < 0) startIndex = 0;
        }

        let chosenIndex = -1;
        if (!existing.length && isUnused(terms[startIndex])) {
            chosenIndex = startIndex;
        } else {
            // Search every generated term across the wrap boundary. Summer is
            // still opt-in through the term editor; automatic additions retain
            // the established Fall/Spring behavior.
            for (let distance = 1; distance <= terms.length; distance++) {
                const index = (startIndex - distance + terms.length) % terms.length;
                const candidate = terms[index];
                if (!String(candidate || '').includes('Summer') && isUnused(candidate)) {
                    chosenIndex = index;
                    break;
                }
            }
        }

        if (chosenIndex < 0) {
            try {
                const ui = (typeof window !== 'undefined') ? window.uiModal : null;
                if (ui && typeof ui.alert === 'function') {
                    ui.alert(
                        'No semester term available',
                        '<p>Every available Fall and Spring term is already in this plan. Edit an existing semester or remove one before adding another.</p>',
                    );
                }
            } catch (_) {}
            return null;
        }
        date_custom = String(terms[chosenIndex] || '');
    }

    const board = document.querySelector(".board");

    let container = document.createElement("div");
    container.classList.add("container_semester");
    if(aslastelement) 
    {
        curriculum.container_id++;
        container.id = 'con' + curriculum.container_id;
    }
    else 
    {
        let containers = document.querySelectorAll(".container_semester");
        containers.forEach((element)=>{
            element.id = 'con' + (extractNumericValue(element.id) + 1);
            curriculum.container_id = extractNumericValue(element.id);
        })
        container.id = 'con' + 1;
    }

    let total_credit = document.createElement("div");
    total_credit.classList.add("total_credit");
    let total_credit_line_l = document.createElement("div");
    total_credit_line_l.classList.add("total_credit_line");
    let total_credit_line_r = document.createElement("div");
    total_credit_line_r.classList.add("total_credit_line");
    let total_credit_text = document.createElement("div");
    total_credit_text.classList.add("total_credit_text");
    total_credit_text.innerHTML = "<span>0 SU</span>"
    total_credit.appendChild(total_credit_line_l);
    total_credit.appendChild(total_credit_text);
    total_credit.appendChild(total_credit_line_r);

    container.appendChild(total_credit);

    let subcontainer = document.createElement("div");
    subcontainer.classList.add("subcontainer_semester");
    
    let date = document.createElement("div");
    date.classList.add("date");

    const dateText = document.createElement('p');
    //DATE DEFAULT:
    if(!date_custom) {
        // Find next logical semester to add
        let nextTermIndex = 0;

        // Get all existing semesters to determine the next logical one
        const existingSemesters = document.querySelectorAll('.date p');
        if (existingSemesters.length > 0) {
            // Determine the chronologically latest semester using the
            // ordering of the global `terms` array (latest term has the
            // smallest index).
            let latestIdx = terms.length;
            existingSemesters.forEach(semElem => {
                const semText = semElem.textContent;
                const idx = terms.indexOf(semText);
                if (idx !== -1 && idx < latestIdx) {
                    latestIdx = idx;
                }
            });

            const currentIndex = latestIdx;

            if (currentIndex !== terms.length) {
                // Determine the next logical term index in descending list
                for (let i = 1; i < terms.length; i++) {
                    const idx = (currentIndex - i + terms.length) % terms.length;
                    const nextCandidate = terms[idx];
                    if (!nextCandidate.includes("Summer")) {
                        nextTermIndex = idx;
                        break;
                    }
                }
            } else {
                // If we can't find the current term, use a fallback
                // Prefer the device-based current term from helper_functions.js
                let termToUse = '';
                try {
                    if (typeof window !== 'undefined' && window.currentTermName) {
                        termToUse = window.currentTermName;
                    } else if (typeof window !== 'undefined' && typeof window.getCurrentTermNameFromDate === 'function') {
                        termToUse = window.getCurrentTermNameFromDate(new Date());
                    }
                } catch (_) {}
                if (!termToUse) {
                    // Last-resort fallback (legacy month-based heuristic)
                    const currentDate = new Date();
                    const currentMonth = currentDate.getMonth();
                    const currentYear = currentDate.getFullYear();
                    if (currentMonth >= 7) termToUse = 'Fall ' + currentYear + '-' + (currentYear + 1);
                    else if (currentMonth >= 0 && currentMonth < 5) termToUse = 'Spring ' + (currentYear - 1) + '-' + currentYear;
                    else termToUse = 'Summer ' + (currentYear - 1) + '-' + currentYear;
                }

                nextTermIndex = terms.indexOf(termToUse) !== -1 ? terms.indexOf(termToUse) : 0;
            }
        }
        else {
            // No semesters yet; start from the user's entry term if available
            let entryTermName = '';
            try {
                const ps = (typeof window !== 'undefined') ? window.planStorage : null;
                const planId = (ps && typeof ps.getSessionPlanId === 'function')
                    ? ps.getSessionPlanId() : null;
                const get = (k) => {
                    if (ps && typeof ps.getItem === 'function') {
                        if (!planId) return null;
                        try { return ps.getItem(k, planId); } catch (_) { return null; }
                    }
                    try { return localStorage.getItem(k); } catch (_) {}
                    return null;
                };
                entryTermName = get('entryTerm') || entryTerms[0];
            } catch (_) {
                entryTermName = entryTerms[0];
            }
            const idx = terms.indexOf(entryTermName);
            nextTermIndex = (idx !== -1) ? idx : terms.length - 1;
        }

        dateText.textContent = String(terms[nextTermIndex] || '');
    }
    //DATE CUSTOM:
    else 
    {
        dateText.textContent = String(date_custom);
    }
    date.appendChild(dateText);

    let closebtn = document.createElement("button");
    closebtn.classList.add("delete_semester");
    closebtn.type = "button";
    let drag = document.createElement("div");
    drag.classList.add("semester_drag");
    drag.setAttribute('aria-hidden', 'true');
    let edit = document.createElement("button");
    edit.classList.add("semester_date_edit");
    edit.type = "button";
    let icons = document.createElement("div");
    icons.classList.add("icons");
    icons.appendChild(edit);
    icons.appendChild(drag);
    icons.appendChild(closebtn);
    date.appendChild(icons)

    subcontainer.appendChild(date);

    let semester = document.createElement("div");
    semester.classList.add("semester");
    curriculum.semester_id++;
    semester.id = 's' + curriculum.semester_id;
    let newsem = new s_semester(semester.id, course_data);
    // Attach this new semester to the curriculum list
    if(aslastelement){
        curriculum.semesters.push(newsem);
    } 
    else{
        curriculum.semesters.unshift(newsem);
    }
    // Retain the generated-list index for legacy UI compatibility, while the
    // canonical termCode below is the sole academic chronology identity.
    try {
        const dateTextElem = date.querySelector('p');
        const semesterLabel = dateTextElem ? dateTextElem.textContent : '';
        newsem.termIndex = terms.indexOf(semesterLabel);
        newsem.termName = semesterLabel;
        newsem.termCode = (typeof termNameToCode === 'function') ? termNameToCode(semesterLabel) : '';
    } catch (err) {
        // If date or terms are unavailable, leave termIndex as null
        newsem.termIndex = null;
        newsem.termName = '';
        newsem.termCode = '';
    }

    // Ghost course placeholder similar to the ghost semester container
    let addCourse = document.createElement("button");
    addCourse.classList.add("addCourse");
    addCourse.type = "button";
    addCourse.textContent = "+ Add course";


    subcontainer.appendChild(semester);
    subcontainer.appendChild(addCourse);
    container.appendChild(subcontainer);
    
    if(aslastelement)
    {
        board.appendChild(container);
    }
    else
    {
        board.insertBefore(container, board.firstChild);
    }
    try {
        if (typeof window !== 'undefined' && typeof window.updateCurrentTermHighlights === 'function') {
            window.updateCurrentTermHighlights();
        }
    } catch (_) {}

    //adding courses:
    for(let i = 0; i < courseList.length; i++)
    {
        curriculum.course_id++;
        let myCourse = new s_course(
            courseList[i],
            'c' + curriculum.course_id,
            grade_list && grade_list[i] !== undefined && grade_list[i] !== null
                ? grade_list[i] : '',
            grading_basis_list && grading_basis_list[i] !== undefined && grading_basis_list[i] !== null
                ? grading_basis_list[i] : 'unknown',
        );
        let courseCode = myCourse.code;
        try
        {
            getInfo(courseCode, course_data)['EL_Type'].toUpperCase();
        }
        catch
        {
            continue
        }
        if(!curriculum.hasCourse(myCourse.code)) 
        {
            const courseInfo = getInfo(courseCode, course_data);
            let courseCredit = (typeof parseCreditValue === 'function')
                ? parseCreditValue(courseInfo['SU_credit'])
                : (parseFloat(courseInfo['SU_credit']) || 0);
            // GPA and status checks can run before the graduation allocation
            // pass. Seed inherent catalog metadata as the course is loaded so
            // an F/letter-NA attempt still contributes its real denominator.
            myCourse.SU_credit = courseCredit;
            myCourse.Basic_Science = parseFloat(courseInfo['Basic_Science'] || '0') || 0;
            myCourse.Engineering = parseFloat(courseInfo['Engineering'] || '0') || 0;
            myCourse.ECTS = parseFloat(courseInfo['ECTS'] || '0') || 0;
            myCourse.Faculty_Course = courseInfo['Faculty_Course'] || 'No';
            myCourse.Faculty = courseInfo['Faculty'] || '';
            curriculum.getSemester(semester.id).addCourse(myCourse);
            let dom_course = document.createElement('div');
            dom_course.classList.add('course');
            dom_course.id = 'c' + curriculum.course_id;
            //dom_course.setAttribute('draggable','true');


            //dom_course.innerHTML = '<button class="delete_course"></button>';
            //creating course container in course dom:
            let c_container = document.createElement("div")
            c_container.classList.add("course_container");
            let c_label = document.createElement("div");
            c_label.classList.add("course_label");
            const codeDiv = document.createElement('div');
            codeDiv.className = 'course_code';
            codeDiv.textContent = String(courseList[i] || '');
            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'course_actions';
            const detailsButton = document.createElement('button');
            detailsButton.className = 'details_course';
            detailsButton.type = 'button';
            detailsButton.title = `Details for ${courseCode}`;
            detailsButton.setAttribute('aria-label', `Details for ${courseCode}`);
            const detailsIcon = document.createElement('i');
            detailsIcon.className = 'fa-solid fa-circle-info';
            detailsIcon.setAttribute('aria-hidden', 'true');
            detailsButton.appendChild(detailsIcon);
            const deleteButton = document.createElement('button');
            deleteButton.className = 'delete_course';
            deleteButton.type = 'button';
            deleteButton.title = `Delete ${courseCode}`;
            deleteButton.setAttribute('aria-label', `Delete ${courseCode}`);
            actionsDiv.appendChild(detailsButton);
            actionsDiv.appendChild(deleteButton);
            c_label.appendChild(codeDiv);
            c_label.appendChild(actionsDiv);
            let c_info = document.createElement("div");
            c_info.classList.add("course_info");
            const nameDiv = document.createElement('div');
            nameDiv.className = 'course_name';
            nameDiv.textContent = String(courseInfo['Course_Name'] || '');
            c_info.appendChild(nameDiv);
            const typeDiv = document.createElement('div');
            typeDiv.className = 'course_type';
            typeDiv.textContent = String(courseInfo['EL_Type'] || '').toUpperCase();
            c_info.appendChild(typeDiv);

            //let gr_container = document.createElement('div');
            //gr_container.classList.add('grade_container');

            const creditText = (typeof formatCreditValue === 'function')
                ? formatCreditValue(courseCredit)
                : (Number(courseCredit).toFixed(1));
            const creditDiv = document.createElement('div');
            creditDiv.className = 'course_credit';
            creditDiv.textContent = String(creditText) + ' credits';
            c_info.appendChild(creditDiv);
            const bsDiv = document.createElement('div');
            bsDiv.classList.add('course_bs_credit');
            bsDiv.textContent = 'BS: ' + (getInfo(courseCode, course_data)['Basic_Science'] || '0') + ' credits';
            if (!window.showCourseDetails) {
                bsDiv.style.display = 'none';
            }
            c_info.appendChild(bsDiv);
            //gr_container.innerHTML += '<div class="grade">Add grade</div>';
            //c_info.appendChild(gr_container);
            var grade = document.createElement('button');
            grade.classList.add('grade');
            grade.type = 'button';
            grade.setAttribute('aria-haspopup', 'listbox');
            grade.setAttribute('aria-expanded', 'false');
            if(!myCourse.grade)
            {
                grade.textContent = 'Add grade';
            }
            else
            {
                grade.textContent = myCourse.grade;
                const gradeOutcome = (typeof evaluateGradeForLegacyTotals === 'function')
                    ? evaluateGradeForLegacyTotals(myCourse.grade, myCourse.gradingBasis) : null;
                if (gradeOutcome && gradeOutcome.countsInGpa) {
                    curriculum.getSemester(semester.id).totalGPA += courseCredit * gradeOutcome.gpaPoints;
                    curriculum.getSemester(semester.id).totalGPACredits += courseCredit;
                }
                // Explicitly unsuccessful attempts do not count toward the
                // degree plan. The full allocation pass below recomputes these
                // totals too; this keeps the pre-allocation display consistent.
                const degreeEligible = typeof curriculum.isDegreeEligibleCourse !== 'function'
                    || curriculum.isDegreeEligibleCourse(myCourse);
                if (!degreeEligible) {
                    let info = getInfo(courseCode, course_data);
                    if (info) {
                        adjustSemesterTotals(curriculum.getSemester(semester.id), info, -1);
                    }
                }
            }
            grade.setAttribute(
                'aria-label',
                `Grade for ${courseCode}: ${myCourse.grade || 'not entered'}`,
            );
            c_container.appendChild(c_label)
            c_container.appendChild(c_info);
            c_container.appendChild(grade);
            
            dom_course.appendChild(c_container);


            let dom_semester = document.querySelector('#' + semester.id)
            dom_semester.insertBefore(dom_course, dom_semester.querySelector(".addCourse"));

            let dom_tc = dom_course.parentNode.parentNode.parentNode.querySelector('span');
            const semesterObj = curriculum.getSemester(semester.id);
            if (typeof updateSemesterCreditIndicator === 'function') {
                updateSemesterCreditIndicator(dom_tc, semesterObj);
            } else {
                const totalText = (typeof formatCreditValue === 'function')
                    ? formatCreditValue(semesterObj.totalCredit)
                    : (Number(semesterObj.totalCredit || 0).toFixed(1));
                dom_tc.textContent = totalText + ' SU';
            }
        }
    }

    // Once the semester has been created and all initial courses added, re-run
    // the category allocation to compute each course's effective type. This
    // ensures that newly inserted semesters (especially those added at the
    // beginning) are considered in chronological order when allocating core
    // and area credits. If the recalc function is not present (e.g., during
    // testing), this call is ignored.
    try {
        if (typeof curriculum.recalcEffectiveTypes === 'function') {
            curriculum.recalcEffectiveTypes(course_data);
        }
    } catch (err) {
        // Silent failure if curriculum or recalc is undefined
    }
    try {
        const storage = (typeof window !== 'undefined') ? window.planStorage : null;
        if (storage && typeof storage.requestSave === 'function') storage.requestSave();
    } catch (_) {}
    try {
        if (typeof refreshSemesterAccessibility === 'function') refreshSemesterAccessibility();
    } catch (_) {}
    return container;
}
