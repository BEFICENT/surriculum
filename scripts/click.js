function dynamic_click(e, curriculum, course_data)
{
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
            alert('Course data is unavailable. Please serve SUrriculum via a local web server or enable file access to load course lists.');
            return;
        }
    }

    //CLICKED "+ Add Course":
    if(e.target.classList.contains("addCourse"))
    {
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
            const normalized = filter ? filter.toUpperCase() : '';
            const filtered = options.filter(o => (o.code + ' ' + o.name).toUpperCase().includes(normalized));
            filtered.forEach(data => {
                const opt = document.createElement('div');
                opt.classList.add('course-option');
                opt.dataset.code = data.code;
                opt.dataset.name = data.name;
                opt.innerHTML = formatOption(data);
                opt.addEventListener('mousedown', () => {
                    input.value = data.code + ' ' + data.name;
                    dropdown.style.display = 'none';
                });
                dropdown.appendChild(opt);
            });
            dropdown.style.display = filtered.length ? 'block' : 'none';
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

        input.addEventListener('keydown', function(evt){
            const items = dropdown.querySelectorAll('.course-option');
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
            renderOptions(input.value);
        });

        let enter = document.createElement("div");
        enter.classList.add("enter");
        let delete_ac = document.createElement("div");
        delete_ac.classList.add("delete_add_course");

        wrapper.appendChild(input);
        wrapper.appendChild(dropdown);
        wrapper.appendChild(datalist);
        input_container.appendChild(wrapper);
        input_container.appendChild(enter);
        input_container.appendChild(delete_ac);

        e.target.parentNode.insertBefore(input_container, e.target.parentNode.querySelector(".addCourse"));

        // Automatically focus so the user can start typing immediately
        setTimeout(() => { input.focus(); renderOptions(''); }, 0);
    }
    //CLICKED "OK" (for entering course input):
    else if(e.target.classList.contains("enter"))
    {
        // Retrieve the user's input and attempt to determine the course code.
        // Users may type either the full code+name (e.g., "CS101 Intro"), just
        // the course code, or the course name. We first take the first
        // token as the tentative code. If the resulting course is not
        // valid, we attempt to match the entire input against course names
        // in both the primary major and the double major. If a match is
        // found, we derive the code accordingly.
        let inputValue = e.target.parentNode.querySelector("input").value.trim();
        let tentativeCode = inputValue.split(' ')[0].toUpperCase();
        let courseCode = tentativeCode;
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
                courseObj = new s_course(courseCode, '');
            }
        }
        // If still invalid after name search, show error
        if (!isCourseValid(courseObj, course_data)) {
            alert("ERROR: Course Not Found!");
            e.target.parentNode.querySelector("input").value = '';
            return;
        }
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
            const infoAdd = getInfo(courseCode, course_data);
            if (infoAdd) {
                // Course credit values
                myCourse.SU_credit = parseInt(infoAdd['SU_credit'] || '0');
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
            c_label.innerHTML = '<div>'+myCourse.code+'</div>' + '<button class="delete_course"></button>';
            let c_info = document.createElement("div");
            c_info.classList.add("course_info");
            // Use getInfo to fetch course details (works for DM-only courses)
            const info = getInfo(courseCode, course_data);
            c_info.innerHTML = '<div class="course_name">'+ info['Course_Name'] +'</div>';
            c_info.innerHTML += '<div class="course_type">'+ info['EL_Type'].toUpperCase() + '</div>';
            c_info.innerHTML += '<div class="course_credit">' + info['SU_credit']+ '.0 credits </div>';
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
            dom_tc.innerHTML = 'Total: ' + sem.totalCredit + ' credits';
            // Remove input container after adding course
            e.target.parentNode.remove();
            // Recalculate categories for main (and DM via recalc) after adding
            try {
                if (typeof curriculum.recalcEffectiveTypes === 'function') {
                    curriculum.recalcEffectiveTypes(course_data);
                }
            } catch(err) {}
        } else {
            alert("You have already added " + myCourse.code);
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

    else if(e.target.classList.contains("delete_course"))
    {
        let sem = e.target.parentNode.parentNode.parentNode.parentNode;
        let semObj = curriculum.getSemester(sem.id);
        let courseName = e.target.parentNode.firstChild.innerHTML;
        let credit = parseInt(getInfo(courseName, course_data)['SU_credit']);
        let grade = e.target.parentNode.parentNode.querySelector('.grade').innerHTML;

        // If this course had grade F we previously removed its credits. Add them back before deletion
        if(grade == 'F'){
            let info = getInfo(courseName, course_data);
            if(info){
                adjustSemesterTotals(semObj, info, 1);
            }
        }

        semObj.deleteCourse(e.target.parentNode.parentNode.parentNode.id);
        //changing total credits element in dom:
        let dom_tc = e.target.parentNode.parentNode.parentNode.parentNode.parentNode.parentNode.querySelector('span');
        dom_tc.innerHTML = 'Total: ' + semObj.totalCredit + ' credits';

        const gradeValue = letter_grades_global_dic[grade];
        if (gradeValue !== undefined) {
            semObj.totalGPA -= gradeValue * credit;
            if (grade !== 'T') {
                semObj.totalGPACredits -= credit;
            }
        }


        e.target.parentNode.parentNode.parentNode.remove();

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
            let credit = parseInt(getInfo(courseName, course_data)['SU_credit']);

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
        const commonGrades = ['S', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'F'];

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
                let credit = parseInt(getInfo(courseName, course_data)['SU_credit']);
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