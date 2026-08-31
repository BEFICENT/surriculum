// Planner click dispatcher and local semester/course actions.
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
        // course-related actions and inform the user. Accessing local
        // JSON files via file:// is blocked in many browsers. Running
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

    // CLICKED "+ Add Course":
    if (e.target.classList.contains('addCourse'))
    {
        const picker = window.SurriculumModules
            && window.SurriculumModules.plannerCoursePicker;
        if (!picker || typeof picker.open !== 'function') {
            throw new Error('scripts/planner/course-picker.js must load before click.js');
        }
        picker.open({
            event: e,
            curriculum,
            courseData: course_data,
        });
        return;
    }
    // CLICKED "OK" for the course picker.
    else if (e.target.classList.contains('enter'))
    {
        const commitPolicy = window.SurriculumModules
            && window.SurriculumModules.plannerCourseCommit;
        if (!commitPolicy || typeof commitPolicy.createBrowser !== 'function') {
            throw new Error('scripts/planner/course-commit.js must load before click.js');
        }
        const commitController = commitPolicy.createBrowser(window);
        commitController.commit({
            event: e,
            curriculum,
            courseData: course_data,
            escapeHtml,
        });
        return;
    }
    // CLICKED "<semester delete>"
    else if (e.target.classList.contains('delete_semester'))
    {
        curriculum.deleteSemester(
            e.target.parentNode.parentNode.parentNode.querySelector('.semester').id,
        );
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
        // category allocation changes due to the removal.
        try {
            if (typeof curriculum.recalcEffectiveTypes === 'function') {
                curriculum.recalcEffectiveTypes(course_data);
            }
        } catch (_) {}
    }
    // CLICKED planner course details.
    else if (
        e.target.classList.contains('details_course')
        || (e.target.closest && e.target.closest('button.details_course'))
    )
    {
        const detailsController = window.SurriculumModules
            && window.SurriculumModules.plannerCourseDetails;
        if (!detailsController || typeof detailsController.open !== 'function') {
            throw new Error(
                'scripts/planner/course-details-controller.js must load before click.js',
            );
        }
        detailsController.open({ event: e, escapeHtml });
        return;
    }
    // CLICKED "<course delete>"
    else if (e.target.classList.contains('delete_course'))
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
        const credit = (typeof parseCreditValue === 'function')
            ? parseCreditValue(getInfo(courseName, course_data).SU_credit)
            : (parseFloat(getInfo(courseName, course_data).SU_credit) || 0);
        const courseObj = semObj.courses.find(course => course.id === courseElem.id) || null;
        let grade = courseObj ? String(courseObj.grade || '') : '';
        if (!courseObj) {
            try {
                const gradeNode = courseElem.querySelector('.grade');
                grade = gradeNode ? String(gradeNode.textContent || '').trim() : '';
            } catch (_) {}
        }

        // Ineligible attempts were already removed from totals. Restore their
        // static contribution before deleteCourse subtracts the course itself.
        const degreeEligible = typeof curriculum.isDegreeEligibleCourse !== 'function'
            || curriculum.isDegreeEligibleCourse(courseObj || { grade });
        if (!degreeEligible) {
            const info = getInfo(courseName, course_data);
            if (info) adjustSemesterTotals(semObj, info, 1);
        }

        semObj.deleteCourse(courseElem.id);
        // Change the total credits element in the DOM.
        let domTotalCredit = null;
        try {
            const container = e.target.closest('.container_semester');
            domTotalCredit = container ? container.querySelector('.total_credit span') : null;
        } catch (_) {}
        if (!domTotalCredit) {
            try {
                domTotalCredit = semElem
                    ? semElem.parentNode?.parentNode?.querySelector('span') : null;
            } catch (_) {}
        }
        if (typeof updateSemesterCreditIndicator === 'function') {
            updateSemesterCreditIndicator(domTotalCredit, semObj);
        } else {
            const totalText = (typeof formatCreditValue === 'function')
                ? formatCreditValue(semObj.totalCredit)
                : Number(semObj.totalCredit || 0).toFixed(1);
            if (domTotalCredit) domTotalCredit.textContent = totalText + ' SU';
        }

        const gradeOutcome = (typeof evaluateGradeForLegacyTotals === 'function')
            ? evaluateGradeForLegacyTotals(grade, courseObj && courseObj.gradingBasis) : null;
        if (gradeOutcome && gradeOutcome.countsInGpa) {
            semObj.totalGPA -= gradeOutcome.gpaPoints * credit;
            semObj.totalGPACredits -= credit;
        }

        try { courseElem.remove(); } catch (_) {}

        // Re-run allocation after a course deletion to update effective types.
        try {
            if (typeof curriculum.recalcEffectiveTypes === 'function') {
                curriculum.recalcEffectiveTypes(course_data);
            }
        } catch (_) {}
    }
    // CLICKED "<semester_date_edit>"
    else if (e.target.classList.contains('semester_date_edit'))
    {
        const date = e.target.parentNode.parentNode;
        const current = date.querySelector('p') ? date.querySelector('p').textContent : '';
        date.innerHTML = '';
        const select = document.createElement('select');
        select.classList.add('select-control');
        select.setAttribute('aria-label', current
            ? `Semester term for ${current}`
            : 'Semester term');
        select.innerHTML = terms.map(term => `<option value="${term}">${term}</option>`).join('');
        select.value = current;
        const tick = document.createElement('div');
        tick.classList.add('tick');
        date.appendChild(select);
        date.appendChild(tick);
        try {
            if (typeof refreshSemesterAccessibility === 'function') {
                refreshSemesterAccessibility();
            }
        } catch (_) {}
    }
    // CLICKED tick in date.
    else if (e.target.classList.contains('tick'))
    {
        const date = e.target.parentNode;
        const selectedTerm = String(date.querySelector('select').value || '');
        const semElem = date.parentNode.querySelector('.semester');
        const semObj = semElem ? curriculum.getSemester(semElem.id) : null;
        let duplicateTerm = false;
        try {
            const duplicateFn = (typeof hasDuplicateSemesterTerm === 'function')
                ? hasDuplicateSemesterTerm
                : ((typeof window !== 'undefined'
                    && typeof window.hasDuplicateSemesterTerm === 'function')
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
        const closeButton = document.createElement('button');
        closeButton.classList.add('delete_semester');
        const drag = document.createElement('div');
        drag.classList.add('semester_drag');
        const edit = document.createElement('div');
        edit.classList.add('semester_date_edit');
        const icons = document.createElement('div');
        icons.classList.add('icons');
        icons.appendChild(edit);
        icons.appendChild(drag);
        icons.appendChild(closeButton);
        date.appendChild(icons);

        try {
            if (typeof refreshSemesterAccessibility === 'function') {
                refreshSemesterAccessibility();
            }
        } catch (_) {}

        // Update the semester's term identity and recalculate categories.
        try {
            const newDateTextElem = date.querySelector('p');
            const newDateText = newDateTextElem ? newDateTextElem.textContent : '';
            if (semElem && semObj) {
                semObj.termIndex = terms.indexOf(newDateText);
                semObj.termName = newDateText;
                semObj.termCode = (typeof termNameToCode === 'function')
                    ? termNameToCode(newDateText) : '';
            }
            if (typeof curriculum.recalcEffectiveTypes === 'function') {
                curriculum.recalcEffectiveTypes(course_data);
            }
        } catch (_) {}
        try {
            if (typeof window !== 'undefined'
                && typeof window.updateCurrentTermHighlights === 'function') {
                window.updateCurrentTermHighlights();
            }
        } catch (_) {}
        try {
            const storage = (typeof window !== 'undefined') ? window.planStorage : null;
            if (storage && typeof storage.requestSave === 'function') storage.requestSave();
        } catch (_) {}
    }
    // CLICKED trash in input.
    else if (e.target.classList.contains('delete_add_course'))
    {
        e.target.parentNode.remove();
    }
    // CLICKED add/edit grade.
    else if (e.target.classList.contains('grade'))
    {
        const gradeEditor = window.SurriculumModules
            && window.SurriculumModules.plannerGradeEditor;
        if (!gradeEditor || typeof gradeEditor.open !== 'function') {
            throw new Error('scripts/planner/grade-editor.js must load before click.js');
        }
        gradeEditor.open({
            event: e,
            curriculum,
            courseData: course_data,
        });
    }
}
