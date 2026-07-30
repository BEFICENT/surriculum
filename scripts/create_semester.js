function createSemeter(aslastelement=true, courseList=[], curriculum, course_data, grade_list=[], date_custom="")
{
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
    total_credit_text.innerHTML = "<span> Total: 0 credits </span>"
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
                const get = (k) => {
                    try { return ps ? ps.getItem(k) : localStorage.getItem(k); } catch (_) {}
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
    // Record the term index for chronological ordering. The date element
    // contains a <p> with the term string. Use it to compute the index
    // within the global `terms` array (defined in helper_functions.js).
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
    let addCourse = document.createElement("div");
    addCourse.classList.add("addCourse");
    addCourse.innerHTML = "+ Add course";


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
            (grade_list && grade_list[i]) || '',
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
            let courseCredit = (typeof parseCreditValue === 'function')
                ? parseCreditValue(getInfo(courseCode, course_data)['SU_credit'])
                : (parseFloat(getInfo(courseCode, course_data)['SU_credit']) || 0);
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
            detailsButton.title = 'Details';
            detailsButton.setAttribute('aria-label', 'Course details');
            const detailsIcon = document.createElement('i');
            detailsIcon.className = 'fa-solid fa-circle-info';
            detailsButton.appendChild(detailsIcon);
            const deleteButton = document.createElement('button');
            deleteButton.className = 'delete_course';
            deleteButton.type = 'button';
            deleteButton.title = 'Delete';
            deleteButton.setAttribute('aria-label', 'Delete course');
            actionsDiv.appendChild(detailsButton);
            actionsDiv.appendChild(deleteButton);
            c_label.appendChild(codeDiv);
            c_label.appendChild(actionsDiv);
            let c_info = document.createElement("div");
            c_info.classList.add("course_info");
            const courseInfo = getInfo(courseCode, course_data);
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
            var grade = document.createElement('div');
            grade.classList.add('grade');
            if(!myCourse.grade)
            {
                grade.textContent = 'Add grade';
            }
            else
            {
                grade.textContent = myCourse.grade;
                const gradeValue = letter_grades_global_dic[myCourse.grade];
                if (gradeValue !== undefined) {
                    // GPA is affected by all letter grades except transfers (T)
                    curriculum.getSemester(semester.id).totalGPA += courseCredit * gradeValue;
                    if (myCourse.grade !== 'T') {
                        curriculum.getSemester(semester.id).totalGPACredits += courseCredit;
                    }
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
            c_container.appendChild(c_label)
            c_container.appendChild(c_info);
            c_container.appendChild(grade);
            
            dom_course.appendChild(c_container);


            let dom_semester = document.querySelector('#' + semester.id)
            dom_semester.insertBefore(dom_course, dom_semester.querySelector(".addCourse"));

            let dom_tc = dom_course.parentNode.parentNode.parentNode.querySelector('span');
            const totalText = (typeof formatCreditValue === 'function')
                ? formatCreditValue(curriculum.getSemester(semester.id).totalCredit)
                : (Number(curriculum.getSemester(semester.id).totalCredit || 0).toFixed(1));
            dom_tc.textContent = 'Total: ' + totalText + ' credits';
            try {
                const tc = curriculum.getSemester(semester.id).totalCredit || 0;
                dom_tc.classList.toggle('is-overlimit', tc > 20);
            } catch (_) {}
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
    return container;
}
