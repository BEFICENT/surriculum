function dynamic_click(e, curriculum, course_data)
{
    //CLICKED "+ Add Course":
    if(e.target.classList.contains("addCourse"))
    {
        // Create modern course input interface
        let input_container = document.createElement("div");
        input_container.classList.add("course-input-container");
        input_container.style.cssText = `
            background: var(--bg-surface);
            border: 2px solid var(--accent);
            border-radius: var(--radius-md);
            padding: 12px;
            margin: 8px 0;
            display: flex;
            align-items: center;
            gap: 8px;
            box-shadow: var(--shadow-sm);
        `;

        let input1 = document.createElement("input");
        input1.placeholder = "Search for a course...";
        input1.setAttribute("list", 'datalist');
        input1.style.cssText = `
            flex: 1;
            border: 1px solid var(--border);
            border-radius: var(--radius-sm);
            padding: 8px 12px;
            font-size: 14px;
            background: var(--bg-primary);
            color: var(--text-primary);
        `;

        let datalist = document.createElement("datalist");
        datalist.innerHTML = getCoursesDataList(course_data);
        datalist.id = 'datalist';

        // Create modern action buttons
        let addBtn = document.createElement("button");
        addBtn.classList.add("btn", "btn-primary", "btn-sm", "enter");
        addBtn.innerHTML = "✓ Add";
        addBtn.style.minWidth = "60px";

        let cancelBtn = document.createElement("button");
        cancelBtn.classList.add("btn", "btn-secondary", "btn-sm", "delete_add_course");
        cancelBtn.innerHTML = "✕ Cancel";
        cancelBtn.style.minWidth = "60px";

        input_container.appendChild(input1);
        input_container.appendChild(datalist);
        input_container.appendChild(addBtn);
        input_container.appendChild(cancelBtn);

        // Allow pressing Enter in the input to trigger add
        input1.addEventListener('keydown', function(evt) {
            if (evt.key === 'Enter') {
                evt.preventDefault();
                const btn = this.parentNode.querySelector('.enter');
                if (btn) btn.click();
            }
        });

        // Insert before the Add Course button
        e.target.parentNode.insertBefore(input_container, e.target);

        // Focus the input for better UX
        input1.focus();
    }
    //CLICKED "OK" (for entering course input):
    else if(e.target.classList.contains("enter"))
    {
        const semesterElement = e.target.closest('.semester');
        if (!semesterElement) {
            alert("ERROR: Could not find semester!");
            return;
        }
        const semesterId = semesterElement.id;

        const inputValue = e.target.parentNode.querySelector("input").value.trim();
        const courseCode = inputValue.split(' ')[0].toUpperCase();

        // Use the centralized addCourse function
        CurriculumManager.addCourse(semesterId, courseCode, curriculum, course_data);

        // Remove the input container
        e.target.parentNode.remove();
    }
    //CLICKED "<semester delete>"
    else if(e.target.classList.contains("delete_semester"))
    {
        let semesterContainer = e.target.closest('.semester-container');
        if (!semesterContainer) {
            return;
        }

        let semesterElement = semesterContainer.querySelector('.semester');
        if (!semesterElement) {
            return;
        }

        curriculum.deleteSemester(semesterElement.id);
        semesterContainer.remove();

        try {
            if (typeof curriculum.recalcEffectiveTypes === 'function') {
                curriculum.recalcEffectiveTypes(course_data);
            }
        } catch(err) {}
    }
    //CLICKED "<course delete>"
    else if(e.target.classList.contains("delete_course"))
    {
        // This handler is now only for courses created with the old system.
        // New courses have their own delete listeners.
        let courseElement = e.target.closest('.course-card');
        if (!courseElement) return;

        let semesterElement = courseElement.closest('.semester');
        if (!semesterElement) return;

        let semObj = curriculum.getSemester(semesterElement.id);
        if (!semObj) return;

        semObj.deleteCourse(courseElement.id);
        courseElement.remove();
        CurriculumManager.updateSemesterTotalsDisplay(semesterElement.id, curriculum);
    }
    //CLICKED "<semester_date_edit>"
    else if(e.target.classList.contains("semester_date_edit"))
    {
        let semesterHeader = e.target.closest('.semester-header');
        if (!semesterHeader) return;

        let titleInput = semesterHeader.querySelector('.semester-title');
        if (!titleInput) return;

        let datalist = document.createElement("datalist");
        datalist.innerHTML = date_list_InnerHTML;
        datalist.id = 'date_list_' + Date.now();

        semesterHeader.appendChild(datalist);

        titleInput.setAttribute("list", datalist.id);
        titleInput.placeholder = 'choose term...';
        titleInput.focus();
        titleInput.select();

        const cleanup = () => {
            datalist.remove();
            titleInput.removeEventListener('blur', cleanup);
            titleInput.removeEventListener('change', handleChange);
        };

        const handleChange = () => {
            try {
                const newDateText = titleInput.value;
                const semesterElement = titleInput.closest('.semester');
                if (semesterElement) {
                    const semObj = curriculum.getSemester(semesterElement.id);
                    if (semObj) {
                        semObj.termIndex = terms.indexOf(newDateText);
                    }
                }
                if (typeof curriculum.recalcEffectiveTypes === 'function') {
                    curriculum.recalcEffectiveTypes(course_data);
                }
            } catch(err) {}
            cleanup();
        };

        titleInput.addEventListener('blur', cleanup);
        titleInput.addEventListener('change', handleChange);
    }
    //CLICKED trash in input:
    else if(e.target.classList.contains("delete_add_course"))
    {
        e.target.parentNode.remove();
    }
    //CLICKED "toggle_summary"
    else if(e.target.classList.contains("toggle_summary"))
    {
        const semester = e.target.closest('.semester');
        if (semester) {
            const summaryWrapper = semester.querySelector('.semester-summary-wrapper');
            if (summaryWrapper) {
                summaryWrapper.classList.toggle('active');
            }
        }
    }
}
