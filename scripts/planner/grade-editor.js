// Planner grade listbox, model mutation, and persistence coordination.
(function installPlannerGradeEditor(root) {
    'use strict';

    const FALLBACK_GRADE_OPTIONS = Object.freeze([
        Object.freeze({ value: '', label: 'Registered / no grade' }),
        ...['A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'F',
            'P', 'S', 'U', 'I', 'T', 'NA', 'W']
            .map(value => Object.freeze({ value, label: value })),
    ]);

    function buildGradeOptions(policy) {
        const canonicalOptions = policy && Array.isArray(policy.GRADE_UI_OPTIONS)
            ? policy.GRADE_UI_OPTIONS : FALLBACK_GRADE_OPTIONS;
        const options = [];
        canonicalOptions.forEach((option) => {
            if (option.value === 'NA') {
                options.push({ ...option, label: 'NA — letter-graded course', basis: 'letter' });
                options.push({ ...option, label: 'NA — S/U-graded course', basis: 'satisfactory' });
            } else {
                options.push({ ...option });
            }
        });
        return options;
    }

    function create(host) {
        const global = host || {};

        function open(context) {
            const input = context || {};
            const event = input.event;
            const gradeElement = event && event.target;
            const curriculum = input.curriculum;
            const courseData = input.courseData;
            const document = global.document;
            if (!gradeElement || !gradeElement.classList || !document) return false;
            if (gradeElement.classList.contains('grade-active')) return false;

            const courseElem = gradeElement.closest('.course');
            const semElem = gradeElement.closest('.semester');
            const semObj = semElem && curriculum && typeof curriculum.getSemester === 'function'
                ? curriculum.getSemester(semElem.id) : null;
            const courseObj = semObj && courseElem
                ? semObj.courses.find(course => course.id === courseElem.id)
                : null;
            if (!semObj || !courseObj) return false;

            const prevGrade = String(courseObj.grade || '');
            const prevBasis = String(courseObj.gradingBasis || 'unknown');
            const courseName = String(courseObj.code || '');
            const info = typeof global.getInfo === 'function'
                ? global.getInfo(courseName, courseData) : null;
            const credit = typeof global.parseCreditValue === 'function'
                ? global.parseCreditValue(info && info.SU_credit)
                : (parseFloat((info && info.SU_credit) || 0) || 0);
            const policy = global.gradePolicy;

            const dropdown = document.createElement('div');
            dropdown.className = 'grade-dropdown-modern';
            dropdown.id = `grade-listbox-${String(courseObj.id || courseElem.id || Date.now())}`;
            dropdown.setAttribute('role', 'listbox');
            dropdown.setAttribute('aria-label', `Select grade for ${courseName}`);
            dropdown.tabIndex = 0;
            gradeElement.setAttribute('aria-controls', dropdown.id);
            gradeElement.setAttribute('aria-expanded', 'true');
            const optionsContainer = document.createElement('div');
            optionsContainer.className = 'grade-dropdown-options';

            const gradeOptions = buildGradeOptions(policy);
            gradeOptions.forEach((option, optionIndex) => {
                const gradeOption = document.createElement('button');
                gradeOption.type = 'button';
                gradeOption.className = 'grade-option';
                gradeOption.id = `${dropdown.id}-option-${optionIndex + 1}`;
                if (!option.value || option.label !== option.value) {
                    gradeOption.classList.add('is-wide');
                }
                gradeOption.dataset.value = option.value;
                if (option.basis) gradeOption.dataset.basis = option.basis;
                gradeOption.textContent = option.label;
                if (option.description) gradeOption.title = option.description;
                gradeOption.setAttribute('role', 'option');
                gradeOption.setAttribute('aria-selected', 'false');
                gradeOption.tabIndex = -1;
                optionsContainer.appendChild(gradeOption);
            });
            dropdown.appendChild(optionsContainer);
            document.body.appendChild(dropdown);
            const anchorRect = gradeElement.getBoundingClientRect();
            const menuWidth = dropdown.offsetWidth || 232;
            const menuHeight = dropdown.offsetHeight || 320;
            const viewportMargin = 8;
            dropdown.style.left = Math.max(
                viewportMargin,
                Math.min(
                    anchorRect.right - menuWidth,
                    global.innerWidth - menuWidth - viewportMargin,
                ),
            ) + 'px';
            const belowTop = anchorRect.bottom + 6;
            dropdown.style.top = (belowTop + menuHeight <= global.innerHeight - viewportMargin)
                ? belowTop + 'px'
                : Math.max(viewportMargin, anchorRect.top - menuHeight - 6) + 'px';
            gradeElement.classList.add('grade-active');

            const optionElements = Array.from(
                optionsContainer.querySelectorAll('.grade-option'),
            );
            let activeOptionIndex = optionElements.findIndex(option => (
                String(option.dataset.value || '') === prevGrade
                && (!option.dataset.basis || option.dataset.basis === prevBasis)
            ));
            if (activeOptionIndex < 0) activeOptionIndex = 0;
            const setActiveOption = (index, scroll = true) => {
                if (!optionElements.length) return;
                activeOptionIndex = Math.max(0, Math.min(index, optionElements.length - 1));
                optionElements.forEach((option, optionIndex) => {
                    const active = optionIndex === activeOptionIndex;
                    option.classList.toggle('is-active', active);
                    option.setAttribute('aria-selected', active ? 'true' : 'false');
                });
                const active = optionElements[activeOptionIndex];
                dropdown.setAttribute('aria-activedescendant', active.id);
                if (scroll) {
                    try { active.scrollIntoView({ block: 'nearest' }); } catch (_) {}
                }
            };
            setActiveOption(activeOptionIndex, false);

            const recomputeViews = () => {
                try {
                    if (typeof curriculum.recalcEffectiveTypes === 'function') {
                        curriculum.recalcEffectiveTypes(courseData);
                    }
                    if (typeof curriculum.recalcEffectiveTypesDouble === 'function'
                        && curriculum.doubleMajor) {
                        curriculum.recalcEffectiveTypesDouble(curriculum.doubleMajorCourseData);
                    }
                } catch (_) {}
            };

            const removeMenuListeners = () => {
                document.removeEventListener('click', closeDropdown, true);
                document.removeEventListener('scroll', closeDropdown, true);
                global.removeEventListener('resize', closeDropdown, true);
            };
            const closeGradeMenu = ({ restoreFocus = false } = {}) => {
                try { dropdown.remove(); } catch (_) {}
                gradeElement.classList.remove('grade-active');
                gradeElement.setAttribute('aria-expanded', 'false');
                removeMenuListeners();
                if (restoreFocus && gradeElement.isConnected) {
                    try { gradeElement.focus({ preventScroll: true }); } catch (_) {}
                }
            };
            const closeDropdown = (closeEvent) => {
                const target = closeEvent && closeEvent.target;
                const targetIsNode = typeof global.Node !== 'undefined'
                    && target instanceof global.Node;
                if (!targetIsNode
                    || (!gradeElement.contains(target) && !dropdown.contains(target))) {
                    // Dismissing the menu is not an edit. Clearing a grade is an
                    // explicit option, which prevents accidental data loss.
                    closeGradeMenu();
                }
            };

            const selectGradeOption = (gradeOption) => {
                if (!gradeOption || !gradeOption.classList.contains('grade-option')) return;
                const grade = gradeOption.dataset.value;
                const explicitBasis = gradeOption.dataset.basis || '';
                let nextBasis = prevBasis;
                if (explicitBasis) nextBasis = explicitBasis;
                else if (policy && typeof policy.inferGradingBasis === 'function') {
                    const inferred = policy.inferGradingBasis(grade);
                    if (inferred && inferred !== 'unknown') nextBasis = inferred;
                }
                if (!nextBasis) nextBasis = 'unknown';

                const previousOutcome = typeof global.evaluateGradeForLegacyTotals === 'function'
                    ? global.evaluateGradeForLegacyTotals(prevGrade, prevBasis) : null;
                const nextOutcome = typeof global.evaluateGradeForLegacyTotals === 'function'
                    ? global.evaluateGradeForLegacyTotals(grade, nextBasis) : null;
                if (previousOutcome && previousOutcome.countsInGpa) {
                    semObj.totalGPA -= previousOutcome.gpaPoints * credit;
                    semObj.totalGPACredits -= credit;
                }
                if (nextOutcome && nextOutcome.countsInGpa) {
                    semObj.totalGPA += nextOutcome.gpaPoints * credit;
                    semObj.totalGPACredits += credit;
                }

                const wasDegreeEligible = typeof curriculum.isDegreeEligibleCourse === 'function'
                    ? curriculum.isDegreeEligibleCourse({
                        grade: prevGrade,
                        gradingBasis: prevBasis,
                    })
                    : prevGrade !== 'F';
                const isDegreeEligible = typeof curriculum.isDegreeEligibleCourse === 'function'
                    ? curriculum.isDegreeEligibleCourse({ grade, gradingBasis: nextBasis })
                    : grade !== 'F';
                if (!wasDegreeEligible && isDegreeEligible
                    && typeof global.adjustSemesterTotals === 'function') {
                    global.adjustSemesterTotals(semObj, info, 1);
                } else if (wasDegreeEligible && !isDegreeEligible
                    && typeof global.adjustSemesterTotals === 'function') {
                    global.adjustSemesterTotals(semObj, info, -1);
                }
                courseObj.grade = grade;
                courseObj.gradingBasis = nextBasis;

                gradeElement.textContent = grade || 'Add grade';
                gradeElement.setAttribute(
                    'aria-label',
                    `Grade for ${courseName}: ${grade || 'not entered'}`,
                );
                closeGradeMenu({ restoreFocus: true });
                recomputeViews();
                try {
                    const storage = global.planStorage;
                    if (storage && typeof storage.requestSave === 'function') {
                        storage.requestSave();
                    }
                } catch (_) {}
            };

            optionsContainer.addEventListener('click', (optionEvent) => {
                const gradeOption = optionEvent.target && optionEvent.target.closest
                    ? optionEvent.target.closest('.grade-option') : null;
                if (gradeOption && optionsContainer.contains(gradeOption)) {
                    optionEvent.preventDefault();
                    optionEvent.stopPropagation();
                    selectGradeOption(gradeOption);
                }
            });
            dropdown.addEventListener('keydown', (keyEvent) => {
                if (!optionElements.length) return;
                if (keyEvent.key === 'ArrowDown' || keyEvent.key === 'ArrowRight') {
                    keyEvent.preventDefault();
                    setActiveOption((activeOptionIndex + 1) % optionElements.length);
                } else if (keyEvent.key === 'ArrowUp' || keyEvent.key === 'ArrowLeft') {
                    keyEvent.preventDefault();
                    setActiveOption((activeOptionIndex - 1 + optionElements.length)
                        % optionElements.length);
                } else if (keyEvent.key === 'Home') {
                    keyEvent.preventDefault();
                    setActiveOption(0);
                } else if (keyEvent.key === 'End') {
                    keyEvent.preventDefault();
                    setActiveOption(optionElements.length - 1);
                } else if (keyEvent.key === 'Enter' || keyEvent.key === ' ') {
                    keyEvent.preventDefault();
                    selectGradeOption(optionElements[activeOptionIndex]);
                } else if (keyEvent.key === 'Escape') {
                    keyEvent.preventDefault();
                    keyEvent.stopPropagation();
                    closeGradeMenu({ restoreFocus: true });
                }
            });
            document.addEventListener('click', closeDropdown, true);
            document.addEventListener('scroll', closeDropdown, true);
            global.addEventListener('resize', closeDropdown, true);
            try { dropdown.focus({ preventScroll: true }); } catch (_) { dropdown.focus(); }
            return true;
        }

        return Object.freeze({ open });
    }

    const browser = create(root);
    root.SurriculumModules = root.SurriculumModules || {};
    root.SurriculumModules.plannerGradeEditor = Object.freeze({
        buildGradeOptions,
        create,
        open: browser.open,
    });
})(typeof window !== 'undefined' ? window : globalThis);
