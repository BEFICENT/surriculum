
/**
 * =================================================================
 * Core Curriculum Management Logic
 * =================================================================
 * This file centralizes the logic for adding, removing, and updating
 * courses and grades within the curriculum. It ensures that any change
 * to the curriculum data is consistently reflected in the UI.
 */

// This is a private helper function, not exposed globally.
// It now accepts course_data to pass to its event listeners.
function createCourseCard(course, courseInfo, curriculum, course_data) {
    const courseElement = document.createElement('div');
    courseElement.classList.add('course-card');
    courseElement.id = course.id;

    const courseHeader = document.createElement('div');
    courseHeader.classList.add('course-header');

    const courseCodeElem = document.createElement('span');
    courseCodeElem.classList.add('course-code');
    courseCodeElem.textContent = course.code;

    const courseActions = document.createElement('div');
    courseActions.classList.add('course-actions');

    const gradeElement = document.createElement('select');
    gradeElement.classList.add('grade');
    const gradeOptions = ['', 'S', 'A+', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'F', 'T'];
    gradeOptions.forEach(grade => {
        let option = document.createElement('option');
        option.value = grade;
        option.textContent = grade || 'Grade';
        gradeElement.appendChild(option);
    });
    gradeElement.value = course.grade || '';
    gradeElement.addEventListener('change', (e) => {
        // Pass course_data to the update function
        CurriculumManager.updateCourseGrade(course.id, e.target.value, curriculum, course_data);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.classList.add('course-delete', 'delete_course');
    deleteBtn.innerHTML = '×';
    deleteBtn.title = 'Remove course';
    deleteBtn.addEventListener('click', () => {
        const { semester } = curriculum.findCourseAndSemester(course.id);
        if (semester) {
            const courseIndex = semester.courses.findIndex(c => c.id === course.id);
            if (courseIndex > -1) {
                semester.courses.splice(courseIndex, 1);
            }
            courseElement.remove();
            // Pass course_data to the update function
            CurriculumManager.updateSemesterTotalsDisplay(semester.id, curriculum, course_data);
        }
    });

    courseActions.appendChild(gradeElement);
    courseActions.appendChild(deleteBtn);
    courseHeader.appendChild(courseCodeElem);
    courseHeader.appendChild(courseActions);

    const courseBody = document.createElement('div');
    courseBody.classList.add('course-body');

    const courseName = document.createElement('div');
    courseName.classList.add('course-name');
    courseName.textContent = courseInfo.Course_Name;

    const courseDetails = document.createElement('div');
    courseDetails.classList.add('course-details');

    const courseMeta = document.createElement('div');
    courseMeta.classList.add('course-meta');

    const typeSpan = document.createElement('span');
    typeSpan.textContent = courseInfo.EL_Type.toUpperCase();

    const creditSpan = document.createElement('span');
    creditSpan.textContent = courseInfo.SU_credit + ' SU';

    const ectsSpan = document.createElement('span');
    ectsSpan.textContent = courseInfo.ECTS + ' ECTS';

    courseMeta.appendChild(typeSpan);
    courseMeta.appendChild(creditSpan);
    courseMeta.appendChild(ectsSpan);
    courseDetails.appendChild(courseMeta);

    courseBody.appendChild(courseName);
    courseBody.appendChild(courseDetails);

    courseElement.appendChild(courseHeader);
    courseElement.appendChild(courseBody);

    return courseElement;
}

// New private helper for calculations
function recalculateAndApplyTotals(semester, course_data) {
    if (!semester) return;

    // Assuming these are globally available from other scripts
    const letter_grades_global_dic = {
        'S': 0.0, 'A+': 4.0, 'A': 4.0, 'A-': 3.7, 'B+': 3.3, 'B': 3.0, 'B-': 2.7,
        'C+': 2.3, 'C': 2.0, 'C-': 1.7, 'D+': 1.3, 'D': 1.0, 'F': 0.0
    };

    let totalCredits = 0;
    let totalCore = 0;
    let totalArea = 0;
    let totalFree = 0;
    let totalUniversity = 0;
    let gpaPoints = 0;
    let gpaCredits = 0;

    semester.courses.forEach(course => {
        const courseInfo = getInfo(course.code, course_data);
        if (!courseInfo) return;

        const credits = parseFloat(courseInfo.SU_credit);
        totalCredits += credits;

        switch (courseInfo.EL_Type) {
            case 'C': totalCore += credits; break;
            case 'A': totalArea += credits; break;
            case 'F': totalFree += credits; break;
            case 'U': totalUniversity += credits; break;
        }

        const gradeValue = letter_grades_global_dic[course.grade];
        if (gradeValue !== undefined && course.grade !== 'S' && course.grade !== 'T') {
            gpaPoints += gradeValue * credits;
            gpaCredits += credits;
        }
    });

    // Store totals using both the new property names (e.g. totalCredits)
    // and the legacy ones (e.g. totalCredit) so that older parts of the
    // codebase that still expect the singular form continue to work.
    // GPA information is also exposed via the historic totalGPA and
    // totalGPACredits fields in addition to the computed gpa value.
    semester.totalCredits = totalCredits;
    semester.totalCredit = totalCredits;
    semester.totalCore = totalCore;
    semester.totalArea = totalArea;
    semester.totalFree = totalFree;
    semester.totalUniversity = totalUniversity;
    semester.totalGPA = gpaPoints;
    semester.totalGPACredits = gpaCredits;
    semester.gpa = gpaCredits > 0 ? gpaPoints / gpaCredits : 0;
}


// The global object that exposes the public API
const CurriculumManager = {
    /**
     * Updates the display of semester totals (Credits, GPA, etc.).
     * @param {string} semesterId - The ID of the semester to update.
     * @param {object} curriculum - The global curriculum object.
     * @param {Array} course_data - The global course data array.
     */
    updateSemesterTotalsDisplay: function(semesterId, curriculum, course_data) {
        const semester = curriculum.getSemester(semesterId);
        const semesterEl = document.getElementById(semesterId);

        if (!semester || !semesterEl) {
            return;
        }

        // Recalculate all semester totals using the new helper
        recalculateAndApplyTotals(semester, course_data);

        // Update the UI
        const updateTotal = (className, value) => {
            const el = semesterEl.querySelector(className);
            if (el) {
                el.textContent = value;
            }
        };

        // Use the legacy property name (totalCredit) when updating the UI so
        // that the displayed numbers stay in sync with parts of the code that
        // still rely on the singular form.
        updateTotal('.total-totalcredit', semester.totalCredit);
        updateTotal('.total-totalgpa', semester.gpa.toFixed(2));
        updateTotal('.total-totalcore', semester.totalCore);
        updateTotal('.total-totalarea', semester.totalArea);
        updateTotal('.total-totalfree', semester.totalFree);
        updateTotal('.total-totaluniversity', semester.totalUniversity);
    },

    /**
     * Creates and adds a new course to a semester.
     * @param {string} semesterId - The ID of the semester to add the course to.
     * @param {string} courseCode - The code of the course to add (e.g., "CS101").
     * @param {object} curriculum - The global curriculum object.
     * @param {Array} course_data - The global course data array.
     * @returns {string|null} The ID of the new course, or null if creation failed.
     */
    addCourse: function(semesterId, courseCode, curriculum, course_data) {
        const semester = curriculum.getSemester(semesterId);
        const semesterEl = document.getElementById(semesterId);

        if (!semester || !semesterEl || !courseCode) {
            return null;
        }

        const courseInfo = getInfo(courseCode, course_data);
        if (!courseInfo) {
            alert(`Course "${courseCode}" not found.`);
            return null;
        }

        if (curriculum.hasCourse(courseCode)) {
            alert(`Course "${courseCode}" is already in the curriculum.`);
            return null;
        }

        curriculum.course_id++;
        const courseId = 'c' + curriculum.course_id;
        const newCourse = new s_course(courseCode, courseId);

        semester.courses.push(newCourse);

        // Create and append the course card element
        const coursesContainer = semesterEl.querySelector('.courses');
        const courseCard = createCourseCard(newCourse, courseInfo, curriculum, course_data);
        coursesContainer.appendChild(courseCard);

        // Update totals
        this.updateSemesterTotalsDisplay(semesterId, curriculum, course_data);

        return courseId;
    },

    /**
     * Updates the grade for a specific course and recalculates totals.
     * @param {string} courseId - The ID of the course to update.
     * @param {string} newGrade - The new grade to assign.
     * @param {object} curriculum - The global curriculum object.
     * @param {Array} course_data - The global course data array.
     */
    updateCourseGrade: function(courseId, newGrade, curriculum, course_data) {
        const { semester, course } = curriculum.findCourseAndSemester(courseId);

        if (semester && course) {
            course.grade = newGrade;
            this.updateSemesterTotalsDisplay(semester.id, curriculum, course_data);
        }
    }
};

// Expose the CurriculumManager to the global scope
window.CurriculumManager = CurriculumManager;
