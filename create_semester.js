function createSemeter(aslastelement=true, courseList=[], curriculum, course_data, grade_list=[], date_custom="")
{
    const board = document.querySelector(".board");

    // Create main semester container with correct CSS class
    let container = document.createElement("div");
    container.classList.add("semester-container"); // Changed from "container_semester"
    container.setAttribute("draggable", "true"); // Make draggable

    if(aslastelement)
    {
        curriculum.container_id++;
        container.id = 'con' + curriculum.container_id;
    }
    else 
    {
        let containers = document.querySelectorAll(".semester-container"); // Updated selector
        containers.forEach((element)=>{
            element.id = 'con' + (extractNumericValue(element.id) + 1);
            curriculum.container_id = extractNumericValue(element.id);
        })
        container.id = 'con' + 1;
    }

    // Create semester div with proper structure
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

    // Create semester header with proper structure
    let semesterHeader = document.createElement("div");
    semesterHeader.classList.add("semester-header");

    // Create date input element
    let dateInput = document.createElement("input");
    dateInput.type = "text";
    dateInput.classList.add("semester-title");

    //DATE DEFAULT:
    if(!date_custom) {
        // Find next logical semester to add
        let nextTermIndex = 0;

        // Get all existing semesters to determine the next logical one
        const existingSemesters = document.querySelectorAll('.semester-title');
        if (existingSemesters.length > 0) {
            // Determine the chronologically latest semester using the
            // ordering of the global `terms` array (latest term has the
            // smallest index).
            let latestIdx = terms.length;
            existingSemesters.forEach(semElem => {
                const semText = semElem.value;
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

        dateInput.value = terms[nextTermIndex];
    }
    //DATE CUSTOM:
    else 
    {
        dateInput.value = date_custom;
    }

    // Create semester actions container
    let semesterActions = document.createElement("div");
    semesterActions.classList.add("semester-actions");

    // Create action buttons with proper classes and icons
    let editBtn = document.createElement("button");
    editBtn.classList.add("semester-action-btn", "semester_date_edit");
    editBtn.title = "Edit";
    editBtn.innerHTML = "✏️";

    let dragBtn = document.createElement("button");
    dragBtn.classList.add("semester-action-btn", "semester_drag");
    dragBtn.title = "Drag";
    dragBtn.innerHTML = "↔️";

    let summaryBtn = document.createElement("button");
    summaryBtn.classList.add("semester-action-btn", "toggle_summary");
    summaryBtn.title = "Toggle Summary";
    summaryBtn.innerHTML = "📊";

    let deleteBtn = document.createElement("button");
    deleteBtn.classList.add("semester-action-btn", "delete_semester");
    deleteBtn.title = "Delete";
    deleteBtn.innerHTML = "🗑️";

    // Append buttons to actions container
    semesterActions.appendChild(editBtn);
    semesterActions.appendChild(dragBtn);
    semesterActions.appendChild(summaryBtn);
    semesterActions.appendChild(deleteBtn);

    // Append elements to header
    semesterHeader.appendChild(dateInput);
    semesterHeader.appendChild(semesterActions);

    // Create semester content
    let semesterCourses = document.createElement("div");
    semesterCourses.classList.add("semester-courses");

    // Create a dedicated container for course cards
    let coursesContainer = document.createElement("div");
    coursesContainer.classList.add("courses");

    // Create add course button
    let addCourseBtn = document.createElement("div");
    addCourseBtn.classList.add("add-course", "addCourse");
    addCourseBtn.innerHTML = "➕ Add Course";

    // Create semester totals section with better styling
    let semesterTotals = document.createElement("div");
    semesterTotals.classList.add("semester-totals");

    let totalsGrid = document.createElement("div");
    totalsGrid.classList.add("semester-totals-grid");

    // Create total items for different credit types
    const totalTypes = [
        { key: 'totalCredit', label: 'Total Credits' },
        { key: 'totalGPA', label: 'GPA' },
        { key: 'totalCore', label: 'Core' },
        { key: 'totalArea', label: 'Area' },
        { key: 'totalFree', label: 'Free' },
        { key: 'totalUniversity', label: 'University' }
    ];

    totalTypes.forEach(type => {
        let totalItem = document.createElement("div");
        totalItem.classList.add("semester-total-item");

        let label = document.createElement("span");
        label.classList.add("semester-total-label");
        label.textContent = type.label + ":";

        let value = document.createElement("span");
        value.classList.add("semester-total-value");
        value.classList.add(`total-${type.key.toLowerCase()}`);
        value.textContent = "0";

        totalItem.appendChild(label);
        totalItem.appendChild(value);
        totalsGrid.appendChild(totalItem);
    });

    semesterTotals.appendChild(totalsGrid);

    let summaryWrapper = document.createElement("div");
    summaryWrapper.classList.add("semester-summary-wrapper");
    summaryWrapper.appendChild(semesterTotals);

    // Assemble the semester structure
    semesterCourses.appendChild(coursesContainer);
    semesterCourses.appendChild(addCourseBtn);
    semester.appendChild(semesterHeader);
    semester.appendChild(semesterCourses);
    semester.appendChild(summaryWrapper);

    // Add semester to container
    container.appendChild(semester);

    // Record the term index for chronological ordering
    try {
        const dateText = dateInput.value;
        newsem.termIndex = terms.indexOf(dateText);
    } catch (err) {
        // If date or terms are unavailable, leave termIndex as null
        newsem.termIndex = null;
    }

    // Insert into board with safety checks
    if(aslastelement)
    {
        // Safely insert before the button's container, with fallback
        const addSemesterBtn = document.querySelector(".addSemester");
        const buttonContainer = addSemesterBtn ? addSemesterBtn.closest('.sidebar') : null;

        // Since we want to add to the board, just append
        board.appendChild(container);
    }
    else 
    {
        // Safely insert at the beginning, with fallback
        const firstChild = board.firstChild;
        if (firstChild) {
            board.insertBefore(container, firstChild);
        } else {
            // Fallback: append if no first child
            board.appendChild(container);
        }
    }

    //adding courses:
    for(let i = 0; i < courseList.length; i++)
    {
        const courseCode = courseList[i];
        const courseId = CurriculumManager.addCourse(semester.id, courseCode, curriculum, course_data);
        if (courseId && grade_list.length && grade_list[i] && grade_list[i].length) {
            CurriculumManager.updateCourseGrade(courseId, grade_list[i], curriculum);
        }
    }

    // Update semester totals display
    CurriculumManager.updateSemesterTotalsDisplay(semester.id, curriculum);
}