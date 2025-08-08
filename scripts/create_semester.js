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
                // Find the current academic year in terms array
                const currentDate = new Date();
                const currentMonth = currentDate.getMonth();
                let termToUse;

                if (currentMonth >= 7) { // August-December: Fall semester
                    const currentYear = currentDate.getFullYear();
                    termToUse = 'Fall ' + currentYear + '-' + (currentYear + 1);
                } else if (currentMonth >= 0 && currentMonth < 5) { // January-May: Spring semester
                    const currentYear = currentDate.getFullYear();
                    termToUse = 'Spring ' + (currentYear - 1) + '-' + currentYear;
                } else { // June-July: Summer
                    const currentYear = currentDate.getFullYear();
                    termToUse = 'Summer ' + (currentYear - 1) + '-' + currentYear;
                }

                nextTermIndex = terms.indexOf(termToUse) !== -1 ? terms.indexOf(termToUse) : 0;
            }
        }
        else {
            // No semesters yet; start from the user's entry term if available
            let entryTermName = '';
            try {
                entryTermName = localStorage.getItem('entryTerm') || entryTerms[0];
            } catch (_) {
                entryTermName = entryTerms[0];
            }
            const idx = terms.indexOf(entryTermName);
            nextTermIndex = (idx !== -1) ? idx : terms.length - 1;
        }

        date.innerHTML = '<p>' + terms[nextTermIndex] + '</p>';
    }
    //DATE CUSTOM:
    else 
    {
        date.innerHTML = '<p>' + date_custom + '</p>';
    }

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
        const dateText = dateTextElem ? dateTextElem.innerHTML : '';
        newsem.termIndex = terms.indexOf(dateText);
    } catch (err) {
        // If date or terms are unavailable, leave termIndex as null
        newsem.termIndex = null;
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

    //adding courses:
    for(let i = 0; i < courseList.length; i++)
    {
        curriculum.course_id++;
        let myCourse = new s_course(courseList[i], 'c' + curriculum.course_id);
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
            let courseCredit = parseInt(getInfo(courseCode, course_data)['SU_credit']);
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
            c_label.innerHTML = '<div>'+courseList[i]+'</div>' + '<button class="delete_course"></button>';
            let c_info = document.createElement("div");
            c_info.classList.add("course_info");
            c_info.innerHTML = '<div class="course_name">'+ getInfo(courseCode, course_data)['Course_Name'] +'</div>';
            //console.log(getInfo(courseCode, course_data)['EL_Type']);
            c_info.innerHTML += '<div class="course_type">'+getInfo(courseCode, course_data)['EL_Type'].toUpperCase() + '</div>';

            //let gr_container = document.createElement('div');
            //gr_container.classList.add('grade_container');

            c_info.innerHTML += '<div class="course_credit">' +courseCredit+ '.0 credits </div>';
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
            if(!grade_list.length || !grade_list[i].length)
            {
                grade.innerHTML = 'Add grade';
            }
            else
            {
                grade.innerHTML = grade_list[i];
                const gradeValue = letter_grades_global_dic[grade_list[i]];
                if (gradeValue !== undefined) {
                    // GPA is affected by all letter grades except transfers (T)
                    curriculum.getSemester(semester.id).totalGPA += courseCredit * gradeValue;
                    if (grade_list[i] !== 'T') {
                        curriculum.getSemester(semester.id).totalGPACredits += courseCredit;
                    }
                    // If grade is F, the course should not count towards earned credits
                    if (grade_list[i] === 'F') {
                        let info = getInfo(courseCode, course_data);
                        if (info) {
                            adjustSemesterTotals(curriculum.getSemester(semester.id), info, -1);
                        }
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
            dom_tc.innerHTML = 'Total: ' + curriculum.getSemester(semester.id).totalCredit + ' credits';
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