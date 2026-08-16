function mouseover(e)
{
    const courseDragHandle = e.target && e.target.closest ? e.target.closest('.course_drag') : null;
    if(e.target.classList.contains("semester_drag"))
    {
        e.target.parentNode.parentNode.parentNode.parentNode.setAttribute('draggable','true');
    }
    else if(courseDragHandle && isDesktopPlannerDrag())
    {
        const course = courseDragHandle.closest('.course');
        if (course) course.setAttribute('draggable', 'true');
    }
    else if(e.target.classList.contains("addCourse"))
    {
        e.target.style.textDecoration = "underline";
    }
    else if(e.target.classList.contains("grade"))
    {
        e.target.style.textDecoration = "underline";
    }
    else if(e.target.classList.contains("enter"))
    {
        e.target.classList.add('shake');
    }
}

function mouseout(e)
{
    const courseDragHandle = e.target && e.target.closest ? e.target.closest('.course_drag') : null;
    if(e.target.classList.contains("semester_drag"))
    {
        e.target.parentNode.parentNode.parentNode.parentNode.setAttribute('draggable','false');
    }
    else if(courseDragHandle)
    {
        const course = courseDragHandle.closest('.course');
        if (course && !course.classList.contains('course-dragging')) course.setAttribute('draggable', 'false');
    }
    else if(e.target.classList.contains("addCourse"))
    {
        e.target.style.textDecoration = "none";
    }
    else if(e.target.classList.contains("grade"))
    {
        e.target.style.textDecoration = "none";
    }
    else if(e.target.classList.contains("enter"))
    {
        e.target.classList.remove('shake');
    }
}

function semesterTermLabel(container)
{
    try {
        const label = container ? container.querySelector('.date p') : null;
        return String(label ? label.textContent : '').trim() || 'semester';
    } catch (_) {
        return 'semester';
    }
}

function announcePlannerChange(message)
{
    try {
        const region = document.getElementById('a11yStatus');
        if (region) region.textContent = String(message || '');
    } catch (_) {}
}

function semesterContainerNodes()
{
    const board = document.querySelector('.board');
    if (!board) return [];
    return Array.from(board.children).filter((node) => (
        node && node.classList && node.classList.contains('container_semester')
    ));
}

function renumberSemesterContainers(curriculum)
{
    const containers = semesterContainerNodes();
    containers.forEach((container, index) => {
        container.id = 'con' + (index + 1);
    });
    if (curriculum) curriculum.container_id = containers.length;
    return containers;
}

// Move the complete semester node, rather than exchanging innerHTML between
// fixed slots. The term-specific classes, focus, disclosure state and any
// transient controls therefore travel with the semester they belong to.
function reorderSemesterSlots(curriculum, fromPosition, toPosition)
{
    if (!curriculum || !Array.isArray(curriculum.semesters)) return false;
    const from = Number(fromPosition);
    const to = Number(toPosition);
    if (!Number.isInteger(from) || !Number.isInteger(to) || from === to) return false;
    if (from < 1 || to < 1 || from > curriculum.semesters.length || to > curriculum.semesters.length) return false;

    const containers = semesterContainerNodes();
    if (containers.length !== curriculum.semesters.length) return false;
    const dragged = containers[from - 1];
    const target = containers[to - 1];
    const board = dragged && dragged.parentNode;
    if (!dragged || !target || !board || target.parentNode !== board) return false;

    if (from < to) board.insertBefore(dragged, target.nextSibling);
    else board.insertBefore(dragged, target);

    const movedSemester = curriculum.semesters.splice(from - 1, 1)[0];
    curriculum.semesters.splice(to - 1, 0, movedSemester);
    renumberSemesterContainers(curriculum);
    return true;
}

function compareSemesterDisplayOrder(a, b)
{
    try {
        if (typeof compareSemesterTerms === 'function') return compareSemesterTerms(a, b);
    } catch (_) {}
    const codeFor = (semester) => {
        try {
            if (typeof semesterTermCode === 'function') return semesterTermCode(semester);
        } catch (_) {}
        const direct = String(semester && semester.termCode || '').trim();
        if (/^\d{4}(01|02|03)$/.test(direct)) return direct;
        try { return termNameToCode(String(semester && semester.termName || '').trim()); } catch (_) { return ''; }
    };
    const ac = codeFor(a);
    const bc = codeFor(b);
    if (ac && bc && ac !== bc) return ac.localeCompare(bc);
    if (ac && !bc) return -1;
    if (!ac && bc) return 1;
    return 0;
}

function sortSemesterSlotsChronologically(curriculum)
{
    if (!curriculum || !Array.isArray(curriculum.semesters) || curriculum.semesters.length < 2) return false;
    const containers = semesterContainerNodes();
    if (containers.length !== curriculum.semesters.length) return false;

    const pairs = curriculum.semesters.map((semester, index) => ({ semester, node: containers[index], index }));
    pairs.sort((left, right) => {
        const result = compareSemesterDisplayOrder(left.semester, right.semester);
        return result || (left.index - right.index);
    });
    if (pairs.every((pair, index) => pair.index === index)) return false;

    const board = containers[0].parentNode;
    const ghost = Array.from(board.children).find((node) => (
        node && node.classList && node.classList.contains('add-semester-ghost')
    )) || null;
    pairs.forEach((pair) => board.insertBefore(pair.node, ghost));
    curriculum.semesters.splice(0, curriculum.semesters.length, ...pairs.map(pair => pair.semester));
    renumberSemesterContainers(curriculum);
    return true;
}

function finishSemesterReorder(curriculum, courseData)
{
    // Reordering is presentation-only. Every academic consumer derives its
    // chronology from canonical term codes, so moving cards must not mutate or
    // recompute allocation, prerequisite, GPA, progress, or retake state.
    try {
        if (typeof window !== 'undefined' && typeof window.updateCurrentTermHighlights === 'function') {
            window.updateCurrentTermHighlights();
        }
    } catch (_) {}
    try {
        const storage = (typeof window !== 'undefined') ? window.planStorage : null;
        if (storage && typeof storage.requestSave === 'function') storage.requestSave();
    } catch (_) {}
}

function isDesktopPlannerDrag()
{
    return !!(typeof document !== 'undefined' && document.body
        && !document.body.classList.contains('is-mobile'));
}

function courseCodeLabel(courseElement)
{
    try {
        const code = courseElement ? courseElement.querySelector('.course_code') : null;
        return String(code ? code.textContent : '').trim() || 'course';
    } catch (_) {
        return 'course';
    }
}

function ensureCourseDragHandles()
{
    const desktop = isDesktopPlannerDrag();
    document.querySelectorAll('.container_semester .course').forEach((course) => {
        let handle = course.querySelector('.course_drag');
        const actions = course.querySelector('.course_actions');
        if (!handle && actions) {
            handle = document.createElement('button');
            handle.type = 'button';
            handle.className = 'course_drag';
            handle.innerHTML = '<i class="fa-solid fa-grip-vertical" aria-hidden="true"></i>';
            actions.insertBefore(handle, actions.firstChild || null);
        }
        if (handle) {
            const code = courseCodeLabel(course);
            handle.setAttribute('aria-label', `Move ${code} to another semester`);
            handle.setAttribute('title', `Drag or choose where to move ${code}`);
            handle.hidden = !desktop;
            handle.draggable = desktop;
        }
        // The handle arms the card on pointer hover; never leave native course
        // dragging enabled when the mobile layout is active.
        if (!desktop) course.draggable = false;
    });
}

async function chooseCourseMoveDestination(courseElement)
{
    if (!isDesktopPlannerDrag() || !courseElement) return false;
    const sourceContainer = courseElement.closest('.container_semester');
    const destinations = semesterContainerNodes().filter((container) => container !== sourceContainer);
    const ui = typeof window !== 'undefined' ? window.uiModal : null;
    if (!destinations.length || !ui || typeof ui.alert !== 'function') return false;
    const courseCode = courseCodeLabel(courseElement);
    const safeHtml = (value) => {
        try { return typeof escapeHtml === 'function' ? escapeHtml(value) : String(value || ''); }
        catch (_) { return String(value || ''); }
    };
    const optionsHtml = destinations.map((container, index) => (
        `<button type="button" class="btn btn-secondary course-move-destination" `
        + `data-course-move-destination="${index}">${safeHtml(semesterTermLabel(container))}</button>`
    )).join('');
    let selected = null;
    await ui.alert(
        `Move ${safeHtml(courseCode)}`,
        `<p>Choose the destination semester. The course will be placed at the end.</p>`
            + `<div class="course-move-destinations">${optionsHtml}</div>`,
        {
            onMount: ({ body }) => {
                body.querySelectorAll('.course-move-destination').forEach((button) => {
                    button.addEventListener('click', () => {
                        const index = Number(button.dataset.courseMoveDestination);
                        selected = Number.isInteger(index) ? destinations[index] : null;
                        const close = body.closest('.app-modal').querySelector('.app-modal-close');
                        if (close) close.click();
                    });
                });
                const first = body.querySelector('.course-move-destination');
                // The shared modal applies its default close-button focus after
                // onMount. Queue one turn later so keyboard activation lands on
                // the first meaningful destination instead.
                setTimeout(() => setTimeout(() => {
                    try { if (first) first.focus({ preventScroll: true }); } catch (_) {}
                }, 0), 0);
            },
        },
    );
    if (!selected) return false;
    const targetSemesterElement = selected.querySelector('.semester');
    if (!targetSemesterElement) return false;
    const placeholder = document.createElement('div');
    placeholder.className = 'course-drop-placeholder';
    placeholder.setAttribute('aria-hidden', 'true');
    targetSemesterElement.appendChild(placeholder);
    selected.classList.add('course-drop-target');
    let moved = false;
    try {
        moved = commitPlannerCourseMove(
            typeof window !== 'undefined' ? window.curriculum : null,
            typeof course_data !== 'undefined' ? course_data : [],
            courseElement,
            { targetContainer: selected, targetSemesterElement, placeholder },
        );
    } finally {
        clearPlannerDragPreview();
    }
    if (moved) {
        // The modal restores focus to the original grip, but moving that grip
        // between semester containers can make Chromium drop focus to <body>.
        // Restore it explicitly after the modal/DOM work has settled.
        setTimeout(() => {
            try {
                const handle = courseElement.querySelector('.course_drag');
                if (handle && handle.isConnected) handle.focus({ preventScroll: true });
            } catch (_) {}
        }, 0);
    }
    return moved;
}

function clearPlannerDragPreview()
{
    document.querySelectorAll('.course-drop-placeholder').forEach((node) => node.remove());
    clearSemesterDropDestination();
    document.querySelectorAll('.course-dragging, .course-drop-target, .semester-dragging, .semester-drop-target')
        .forEach((node) => node.classList.remove(
            'course-dragging', 'course-drop-target', 'semester-dragging', 'semester-drop-target'
        ));
    document.querySelectorAll('[data-semester-drop-edge]').forEach((node) => {
        node.removeAttribute('data-semester-drop-edge');
    });
}

function clearSemesterDropDestination()
{
    document.querySelectorAll('.semester-drop-placeholder').forEach((node) => node.remove());
    document.querySelectorAll('.semester-drop-target').forEach((container) => {
        container.classList.remove('semester-drop-target');
        container.removeAttribute('data-semester-drop-edge');
    });
}

function plannerSemesterDropTarget(targetElement)
{
    if (!targetElement || typeof targetElement.closest !== 'function') return null;
    const placeholder = targetElement.closest('.semester-drop-placeholder');
    if (placeholder) {
        const targetId = String(placeholder.dataset.semesterDropTargetId || '');
        const storedTarget = targetId ? document.getElementById(targetId) : null;
        if (storedTarget && storedTarget.classList.contains('container_semester')) return storedTarget;
    }
    return targetElement.closest('.container_semester');
}

// Show the exact card slot that the current semester reorder will occupy without
// moving a real semester or touching the curriculum model. The placeholder is a
// valid drop surface itself: inserting a full-width slot before a target moves
// that target out from under the pointer, so subsequent drag events resolve its
// stored target id instead of flickering the preview on and off.
function plannerSemesterInsertionPreview(event, draggedSemester)
{
    if (!isDesktopPlannerDrag() || !draggedSemester) {
        clearSemesterDropDestination();
        return null;
    }
    const target = plannerSemesterDropTarget(event && event.target);
    const containers = semesterContainerNodes();
    const sourceIndex = containers.indexOf(draggedSemester);
    const targetIndex = containers.indexOf(target);
    if (!target || target === draggedSemester || sourceIndex < 0 || targetIndex < 0) {
        clearSemesterDropDestination();
        return null;
    }
    const board = draggedSemester.parentNode;
    if (!board || target.parentNode !== board) {
        clearSemesterDropDestination();
        return null;
    }

    const edge = sourceIndex > targetIndex ? 'before' : 'after';
    document.querySelectorAll('.semester-drop-target').forEach((container) => {
        if (container !== target) {
            container.classList.remove('semester-drop-target');
            container.removeAttribute('data-semester-drop-edge');
        }
    });
    target.classList.add('semester-drop-target');
    target.setAttribute('data-semester-drop-edge', edge);

    let placeholder = board.querySelector(':scope > .semester-drop-placeholder');
    if (!placeholder) {
        placeholder = document.createElement('div');
        placeholder.className = 'semester-drop-placeholder';
        placeholder.setAttribute('aria-hidden', 'true');
        placeholder.draggable = false;
        const label = document.createElement('span');
        label.className = 'semester-drop-placeholder-label';
        placeholder.appendChild(label);
    }
    placeholder.dataset.semesterDropTargetId = target.id;
    placeholder.dataset.semesterDropEdge = edge;
    const label = placeholder.querySelector('.semester-drop-placeholder-label');
    if (label) label.textContent = `Move ${semesterTermLabel(draggedSemester)} here`;

    if (edge === 'before') {
        if (placeholder.nextSibling !== target) board.insertBefore(placeholder, target);
    } else if (target.nextSibling !== placeholder) {
        board.insertBefore(placeholder, target.nextSibling);
    }
    return { targetContainer: target, placeholder, edge };
}

function plannerSemesterFromContainer(curriculum, container)
{
    if (!curriculum || !container || typeof curriculum.getSemester !== 'function') return null;
    const semesterElement = container.querySelector('.semester');
    return semesterElement ? curriculum.getSemester(semesterElement.id) : null;
}

function plannerCourseFromElement(semester, courseElement)
{
    if (!semester || !courseElement || !Array.isArray(semester.courses)) return null;
    return semester.courses.find((course) => course && course.id === courseElement.id) || null;
}

function canonicalPlannerCourseCode(course)
{
    const raw = String((course && course.code) || '').toUpperCase().replace(/\s+/g, '');
    try {
        if (typeof canonicalCourseCode === 'function') return canonicalCourseCode(raw);
    } catch (_) {}
    return raw === 'CS210' ? 'DSA210' : raw;
}

function hasAmbiguousCourseMoveTarget(curriculum, targetSemester, movingCourse)
{
    if (!curriculum || !targetSemester || !movingCourse) return true;
    const targetTerm = (() => {
        try {
            if (typeof semesterTermCode === 'function') return semesterTermCode(targetSemester);
            const direct = String(targetSemester.termCode || '').trim();
            return /^\d{4}(01|02|03)$/.test(direct) ? direct : '';
        }
        catch (_) { return ''; }
    })();
    if (!targetTerm) return true;
    const termMatches = (curriculum.semesters || []).filter((semester) => {
        try {
            if (typeof semesterTermCode === 'function') return semesterTermCode(semester) === targetTerm;
            return String(semester && semester.termCode || '').trim() === targetTerm;
        } catch (_) { return false; }
    });
    if (termMatches.length !== 1) return true;
    const code = canonicalPlannerCourseCode(movingCourse);
    return (targetSemester.courses || []).some((course) => (
        course !== movingCourse && canonicalPlannerCourseCode(course) === code
    ));
}

function schedulerMoveStatePatch(storage, sourceSemester, movingCourse)
{
    if (!storage || !sourceSemester || !movingCourse) return null;
    let sourceTerm = '';
    try { sourceTerm = typeof semesterTermCode === 'function' ? semesterTermCode(sourceSemester) : ''; }
    catch (_) { return null; }
    if (!sourceTerm) return null;
    const key = `schedulerState_${sourceTerm}`;
    let raw = null;
    try { raw = storage.getItem(key); } catch (_) { return null; }
    if (raw == null) return { key, raw, changed: false, nextRaw: null };
    let state = null;
    try { state = JSON.parse(raw); } catch (_) { return { key, raw, changed: false, nextRaw: raw }; }
    if (!state || typeof state !== 'object') return { key, raw, changed: false, nextRaw: raw };
    const courseCode = canonicalPlannerCourseCode(movingCourse);
    const prune = (selected) => {
        if (!selected || typeof selected !== 'object') return false;
        let changed = false;
        Object.keys(selected).forEach((keyName) => {
            if (canonicalPlannerCourseCode({ code: keyName }) === courseCode) {
                delete selected[keyName];
                changed = true;
            }
        });
        return changed;
    };
    let changed = prune(state.selected);
    const schedules = state.schedules && state.schedules.items;
    if (schedules && typeof schedules === 'object') {
        Object.keys(schedules).forEach((id) => {
            const item = schedules[id];
            if (item && prune(item.selected)) changed = true;
        });
        const activeId = state.schedules && String(state.schedules.activeId || '');
        const active = activeId && schedules[activeId];
        if (active && active.selected && typeof active.selected === 'object') {
            state.selected = active.selected;
        }
    }
    return { key, raw, changed, nextRaw: changed ? JSON.stringify(state) : raw };
}

function plannerCourseInsertionPreview(event, draggedCourse)
{
    if (!isDesktopPlannerDrag() || !draggedCourse) return null;
    const clearCourseTarget = () => {
        document.querySelectorAll('.course-drop-placeholder').forEach((node) => node.remove());
        document.querySelectorAll('.course-drop-target').forEach((node) => node.classList.remove('course-drop-target'));
    };
    const targetContainer = event.target && event.target.closest
        ? event.target.closest('.container_semester') : null;
    const targetSemesterElement = targetContainer ? targetContainer.querySelector('.semester') : null;
    if (!targetSemesterElement) {
        clearCourseTarget();
        return null;
    }
    const sourceSemesterElement = draggedCourse.closest('.semester');
    if (!sourceSemesterElement || sourceSemesterElement === targetSemesterElement) {
        clearCourseTarget();
        return null;
    }

    document.querySelectorAll('.course-drop-target').forEach((node) => {
        if (node !== targetContainer) node.classList.remove('course-drop-target');
    });
    targetContainer.classList.add('course-drop-target');
    let placeholder = document.querySelector('.course-drop-placeholder');
    if (!placeholder) {
        placeholder = document.createElement('div');
        placeholder.className = 'course-drop-placeholder';
        placeholder.setAttribute('aria-hidden', 'true');
    }
    const hoveredCourse = event.target.closest('.course');
    if (hoveredCourse && hoveredCourse !== draggedCourse) {
        const rect = hoveredCourse.getBoundingClientRect();
        const before = Number(event.clientY) < rect.top + rect.height / 2;
        targetSemesterElement.insertBefore(placeholder, before ? hoveredCourse : hoveredCourse.nextSibling);
    } else {
        const addCourse = targetSemesterElement.querySelector('.addCourse');
        targetSemesterElement.insertBefore(placeholder, addCourse || null);
    }
    return { targetContainer, targetSemesterElement, placeholder };
}

function captureCourseMoveRollback(curriculum, courseData)
{
    const semesters = (curriculum && Array.isArray(curriculum.semesters))
        ? curriculum.semesters.slice() : [];
    const semesterStates = semesters.map((semester) => ({
        semester,
        descriptors: Object.getOwnPropertyDescriptors(semester),
        courses: Array.isArray(semester.courses) ? semester.courses.slice() : [],
    }));
    const courseStates = [];
    semesterStates.forEach(({ courses }) => courses.forEach((course) => {
        if (course) courseStates.push({ course, descriptors: Object.getOwnPropertyDescriptors(course) });
    }));
    const semesterDom = Array.from(document.querySelectorAll('.container_semester .semester')).map((element) => ({
        element,
        children: Array.from(element.childNodes),
    }));
    const restoreDescriptors = (object, descriptors) => {
        Object.keys(object).forEach((key) => {
            if (!Object.prototype.hasOwnProperty.call(descriptors, key)) {
                try { delete object[key]; } catch (_) {}
            }
        });
        Object.defineProperties(object, descriptors);
    };
    return function restoreCourseMove() {
        courseStates.forEach(({ course, descriptors }) => restoreDescriptors(course, descriptors));
        semesterStates.forEach(({ semester, descriptors, courses }) => {
            restoreDescriptors(semester, descriptors);
            semester.courses = courses.slice();
        });
        semesterDom.forEach(({ element, children }) => element.replaceChildren(...children));
        try {
            if (curriculum && typeof curriculum.recalcEffectiveTypes === 'function') {
                curriculum.recalcEffectiveTypes(Array.isArray(courseData) ? courseData : []);
            }
        } catch (_) {}
        recomputePlannerCourseMoveGpa(curriculum, courseData);
        ensureCourseDragHandles();
    };
}

function recomputePlannerCourseMoveGpa(curriculum, courseData)
{
    (curriculum && Array.isArray(curriculum.semesters) ? curriculum.semesters : []).forEach((semester) => {
        let totalGPA = 0;
        let totalGPACredits = 0;
        (semester.courses || []).forEach((course) => {
            let outcome = null;
            try {
                if (typeof evaluateGradeForLegacyTotals === 'function') {
                    outcome = evaluateGradeForLegacyTotals(course.grade, course.gradingBasis);
                } else if (window.gradePolicy && typeof window.gradePolicy.evaluateGrade === 'function') {
                    outcome = window.gradePolicy.evaluateGrade(course.grade, course.gradingBasis);
                }
            } catch (_) {}
            if (!outcome || !outcome.countsInGpa) return;
            let credit = Number(course.SU_credit || 0);
            try {
                const info = typeof getInfo === 'function' ? getInfo(course.code, courseData) : null;
                if (info && typeof parseCreditValue === 'function') credit = parseCreditValue(info.SU_credit || 0);
            } catch (_) {}
            if (!Number.isFinite(credit)) credit = 0;
            totalGPA += credit * Number(outcome.gpaPoints || 0);
            totalGPACredits += credit;
        });
        semester.totalGPA = totalGPA;
        semester.totalGPACredits = totalGPACredits;
    });
}

function commitPlannerCourseMove(curriculum, courseData, draggedCourse, preview)
{
    if (!curriculum || !draggedCourse || !preview) return false;
    const sourceElement = draggedCourse.closest('.semester');
    const sourceSemester = sourceElement && typeof curriculum.getSemester === 'function'
        ? curriculum.getSemester(sourceElement.id) : null;
    const targetSemester = plannerSemesterFromContainer(curriculum, preview.targetContainer);
    const movingCourse = plannerCourseFromElement(sourceSemester, draggedCourse);
    if (!sourceSemester || !targetSemester || !movingCourse) return false;
    if (sourceSemester === targetSemester) return false;
    if (hasAmbiguousCourseMoveTarget(curriculum, targetSemester, movingCourse)) {
        try {
            const ui = window.uiModal;
            if (ui && typeof ui.alert === 'function') {
                ui.alert('Course not moved', '<p>The destination semester is ambiguous or already contains this course. Repair duplicate semesters or course entries before moving it.</p>');
            }
        } catch (_) {}
        return false;
    }

    const storage = typeof window !== 'undefined' ? window.planStorage : null;
    if (!storage || typeof storage.requestSave !== 'function' || typeof storage.flushSaves !== 'function') return false;
    // Establish a durable checkpoint before touching the authoritative model.
    if (storage.requestSave() === false || storage.flushSaves() === false) return false;
    const rollback = captureCourseMoveRollback(curriculum, courseData);
    const schedulerPatch = schedulerMoveStatePatch(storage, sourceSemester, movingCourse);
    try {
        const sourceIndex = sourceSemester.courses.indexOf(movingCourse);
        if (sourceIndex < 0) throw new Error('Course source is no longer available.');
        sourceSemester.courses.splice(sourceIndex, 1);

        const nextCourseElement = preview.placeholder.nextElementSibling;
        let targetIndex = (targetSemester.courses || []).length;
        if (nextCourseElement && nextCourseElement.classList.contains('course')) {
            const nextCourse = plannerCourseFromElement(targetSemester, nextCourseElement);
            const found = targetSemester.courses.indexOf(nextCourse);
            if (found >= 0) targetIndex = found;
        }
        if (sourceSemester === targetSemester && sourceIndex < targetIndex) targetIndex -= 1;
        targetIndex = Math.max(0, Math.min(targetSemester.courses.length, targetIndex));
        targetSemester.courses.splice(targetIndex, 0, movingCourse);
        preview.targetSemesterElement.insertBefore(draggedCourse, preview.placeholder);
        if (sourceSemester !== targetSemester && Object.prototype.hasOwnProperty.call(movingCourse, 'scheduler_crn')) {
            delete movingCourse.scheduler_crn;
        }
        if (schedulerPatch && schedulerPatch.changed
            && storage.setItem(schedulerPatch.key, schedulerPatch.nextRaw) === false) {
            throw new Error('The source schedule could not be updated.');
        }

        if (typeof curriculum.recalcEffectiveTypes === 'function') curriculum.recalcEffectiveTypes(courseData);
        recomputePlannerCourseMoveGpa(curriculum, courseData);
        if (typeof window.updateCurrentTermHighlights === 'function') window.updateCurrentTermHighlights();
        if (storage.requestSave() === false || storage.flushSaves() === false) {
            throw new Error('The moved course could not be saved.');
        }
        announcePlannerChange(
            `Moved ${courseCodeLabel(draggedCourse)} to ${semesterTermLabel(preview.targetContainer)}.`
        );
        return true;
    } catch (error) {
        try { rollback(); } catch (_) {}
        try {
            if (schedulerPatch && schedulerPatch.changed) {
                if (schedulerPatch.raw == null && typeof storage.removeItem === 'function') {
                    storage.removeItem(schedulerPatch.key);
                } else {
                    storage.setItem(schedulerPatch.key, schedulerPatch.raw);
                }
            }
        } catch (_) {}
        try {
            storage.requestSave();
            storage.flushSaves();
        } catch (_) {}
        try {
            const ui = window.uiModal;
            if (ui && typeof ui.alert === 'function') {
                ui.alert('Course not moved', '<p>The course was restored because the planner update could not be saved.</p>');
            }
        } catch (_) {}
        return false;
    }
}

function semesterMovePresentation(offset)
{
    const vertical = !!(typeof document !== 'undefined' && document.body
        && document.body.classList.contains('is-mobile'));
    const movesPrevious = Number(offset) < 0;
    // Mobile deliberately projects the persisted oldest-to-newest sequence in
    // reverse, with the newest semester at the top. Moving to the previous DOM
    // slot therefore moves down visually, while moving to the next slot moves
    // up. Desktop keeps its natural left/right mapping.
    const direction = vertical
        ? (movesPrevious ? 'down' : 'up')
        : (movesPrevious ? 'left' : 'right');
    return {
        direction,
        iconClass: `fa-arrow-${direction}`
    };
}

function refreshSemesterMoveButton(button, term, offset, disabled)
{
    if (!button) return;
    const movesPrevious = Number(offset) < 0;
    button.classList.remove('semester_move_previous', 'semester_move_next');
    button.classList.add(movesPrevious ? 'semester_move_previous' : 'semester_move_next');
    // The previous/next classes are the stable model semantics. Directional
    // aliases follow the current visual axis so CSS, tests and integrations do
    // not describe a mobile Down action as Up.
    button.classList.remove(
        'semester_move_up', 'semester_move_down',
        'semester_move_left', 'semester_move_right'
    );
    button.disabled = !!disabled;

    let icon = button.querySelector('i');
    if (!icon) {
        icon = document.createElement('i');
        button.appendChild(icon);
    }
    const presentation = semesterMovePresentation(offset);
    button.classList.add(`semester_move_${presentation.direction}`);
    icon.className = `fa-solid ${presentation.iconClass}`;
    icon.setAttribute('aria-hidden', 'true');
    const label = `Move ${term} ${presentation.direction}`;
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);
}

function refreshSemesterAccessibility()
{
    const containers = Array.from(document.querySelectorAll('.container_semester'));
    containers.forEach((container, index) => {
        const term = semesterTermLabel(container);
        const label = container.querySelector('.date p');
        if (label) {
            label.id = `semester-label-${container.id || index + 1}`;
            container.setAttribute('role', 'group');
            container.setAttribute('aria-labelledby', label.id);
            container.removeAttribute('aria-label');
        } else {
            const termSelect = container.querySelector('.date select');
            if (termSelect) {
                if (!termSelect.getAttribute('aria-label')) {
                    termSelect.setAttribute('aria-label', term
                        ? `Semester term for ${term}`
                        : 'Semester term');
                }
                container.setAttribute('role', 'group');
                container.removeAttribute('aria-labelledby');
                container.setAttribute('aria-label', term && term !== 'semester'
                    ? `Editing ${term} semester`
                    : 'Editing semester');
            }
        }

        const icons = container.querySelector('.date .icons');
        if (!icons) return;

        const edit = icons.querySelector('.semester_date_edit');
        if (edit) {
            edit.setAttribute('aria-label', `Edit ${term} term`);
            edit.setAttribute('title', `Edit ${term} term`);
            if (edit.tagName !== 'BUTTON') {
                edit.setAttribute('role', 'button');
                edit.setAttribute('tabindex', '0');
            }
        }
        const drag = icons.querySelector('.semester_drag');
        if (drag) {
            drag.setAttribute('aria-hidden', 'true');
            drag.setAttribute('title', `Drag ${term} to reorder`);
        }
        const remove = icons.querySelector('.delete_semester');
        if (remove) {
            if (remove.tagName === 'BUTTON') remove.type = 'button';
            remove.setAttribute('aria-label', `Delete ${term}`);
            remove.setAttribute('title', `Delete ${term}`);
        }

        let controls = icons.querySelector('.semester-move-controls');
        if (!controls) {
            controls = document.createElement('span');
            controls.className = 'semester-move-controls';
            const previous = document.createElement('button');
            previous.type = 'button';
            previous.className = 'semester_move semester_move_previous semester_move_up';
            previous.innerHTML = '<i class="fa-solid" aria-hidden="true"></i>';
            const next = document.createElement('button');
            next.type = 'button';
            next.className = 'semester_move semester_move_next semester_move_down';
            next.innerHTML = '<i class="fa-solid" aria-hidden="true"></i>';
            controls.appendChild(previous);
            controls.appendChild(next);
            icons.insertBefore(controls, drag || remove || null);
        }
        // Prefer the stable model-semantic classes. Directional aliases change
        // across the responsive axis and must never cause the opposite control
        // to be selected during a refresh.
        const previous = controls.querySelector('.semester_move_previous')
            || controls.querySelector('.semester_move_up');
        const next = controls.querySelector('.semester_move_next')
            || controls.querySelector('.semester_move_down');
        refreshSemesterMoveButton(previous, term, -1, index === 0);
        refreshSemesterMoveButton(next, term, 1, index === containers.length - 1);
    });

    document.querySelectorAll('.tick').forEach((tick) => {
        if (tick.tagName === 'BUTTON') tick.type = 'button';
        else {
            tick.setAttribute('role', 'button');
            tick.setAttribute('tabindex', '0');
        }
        tick.setAttribute('aria-label', 'Save semester term');
        tick.setAttribute('title', 'Save semester term');
    });

    document.querySelectorAll('.add-semester-ghost').forEach((button) => {
        if (button.tagName !== 'BUTTON') {
            button.setAttribute('role', 'button');
            button.setAttribute('tabindex', '0');
        }
        button.setAttribute('aria-label', 'New semester');
    });
    ensureCourseDragHandles();
}

function drop(e, curriculum, dragged_item, course_data, touchPos)
{
    // Prevent default browser behavior (such as scrolling) during a drop
    if(e && typeof e.preventDefault === 'function'){
        e.preventDefault();
    }

    // Determine the drop target. For mouse events we use e.target directly.
    // For touch interactions we resolve the element at the touch coordinates
    // supplied via touchPos.
    let targetElement = e.target;
    if(touchPos && typeof document !== 'undefined' && document.elementFromPoint){
        targetElement = document.elementFromPoint(touchPos.x, touchPos.y);
    }
    let container = targetElement && targetElement.closest
        ? plannerSemesterDropTarget(targetElement)
        : getAncestor(targetElement, "container_semester");
    let reordered = false;
    if(container && dragged_item)
    {
        let target_id = extractNumericValue(container.id);
        let dragged_id = extractNumericValue(dragged_item.id);
        reordered = Number.isFinite(target_id) && Number.isFinite(dragged_id) && target_id !== dragged_id;
        if (reordered) reordered = reorderSemesterSlots(curriculum, dragged_id, target_id);
    }

    if (reordered) {
        finishSemesterReorder(curriculum, course_data);
        try { refreshSemesterAccessibility(); } catch (_) {}
    }
}

if (typeof document !== 'undefined') {
    document.addEventListener('click', function(event) {
        const courseDrag = event.target && event.target.closest
            ? event.target.closest('.course_drag') : null;
        if (courseDrag && isDesktopPlannerDrag()) {
            event.preventDefault();
            event.stopPropagation();
            const course = courseDrag.closest('.course');
            if (course) chooseCourseMoveDestination(course);
            return;
        }
        const sortButton = event.target && event.target.closest
            ? event.target.closest('#sortSemestersChronologically') : null;
        if (sortButton) {
            event.preventDefault();
            const liveCurriculum = (typeof window !== 'undefined') ? window.curriculum : null;
            const changed = sortSemesterSlotsChronologically(liveCurriculum);
            if (changed) {
                let liveCourseData = [];
                try {
                    if (typeof course_data !== 'undefined' && Array.isArray(course_data)) liveCourseData = course_data;
                } catch (_) {}
                finishSemesterReorder(liveCurriculum, liveCourseData);
                refreshSemesterAccessibility();
                announcePlannerChange('Sorted semesters chronologically from oldest to newest.');
            } else {
                announcePlannerChange('Semesters are already in chronological order.');
            }
            return;
        }

        const button = event.target && event.target.closest
            ? event.target.closest('.semester_move_previous, .semester_move_next, .semester_move_up, .semester_move_down') : null;
        if (!button) return;
        event.preventDefault();
        event.stopPropagation();
        const container = button.closest('.container_semester');
        const containers = Array.from(document.querySelectorAll('.container_semester'));
        const fromIndex = containers.indexOf(container);
        const movesPrevious = button.classList.contains('semester_move_previous')
            || (!button.classList.contains('semester_move_next')
                && (button.classList.contains('semester_move_up')
                    || button.classList.contains('semester_move_left')));
        const offset = movesPrevious ? -1 : 1;
        const toIndex = fromIndex + offset;
        if (fromIndex < 0 || toIndex < 0 || toIndex >= containers.length) return;

        const term = semesterTermLabel(container);
        const liveCurriculum = (typeof window !== 'undefined') ? window.curriculum : null;
        if (!reorderSemesterSlots(liveCurriculum, fromIndex + 1, toIndex + 1)) return;
        let liveCourseData = [];
        try {
            if (typeof course_data !== 'undefined' && Array.isArray(course_data)) liveCourseData = course_data;
        } catch (_) {}
        finishSemesterReorder(liveCurriculum, liveCourseData);
        refreshSemesterAccessibility();
        const presentation = semesterMovePresentation(offset);
        const visualPosition = document.body.classList.contains('is-mobile')
            ? containers.length - toIndex
            : toIndex + 1;
        announcePlannerChange(
            `Moved ${term} ${presentation.direction} to position ${visualPosition} of ${containers.length}.`
        );
        const destination = document.querySelector('#con' + (toIndex + 1));
        let focusTarget = destination ? destination.querySelector(
            offset < 0 ? '.semester_move_previous' : '.semester_move_next'
        ) : null;
        // At the first/last boundary the activated control becomes disabled.
        // Keep keyboard focus on the remaining enabled move action instead of
        // dropping it back to the document body.
        if (focusTarget && focusTarget.disabled && destination) {
            focusTarget = destination.querySelector(
                offset < 0 ? '.semester_move_next' : '.semester_move_previous'
            );
        }
        try { if (focusTarget) focusTarget.focus({ preventScroll: true }); } catch (_) {}
    });

    document.addEventListener('mobileModeChanged', function() {
        // mobile.js toggles body.is-mobile before dispatching this event. Update
        // the same focused controls in place so their icons and spoken direction
        // always match the board's current axis after a live resize.
        clearPlannerDragPreview();
        refreshSemesterAccessibility();
    });

    document.addEventListener('keydown', function(event) {
        if (event.key !== 'Escape') return;
        clearPlannerDragPreview();
        document.querySelectorAll('.container_semester .course').forEach((course) => {
            course.setAttribute('draggable', 'false');
        });
    }, true);

    document.addEventListener('visibilitychange', function() {
        if (!document.hidden) return;
        clearPlannerDragPreview();
    });

    document.addEventListener('keydown', function(event) {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const control = event.target && event.target.closest
            ? event.target.closest('[role="button"].semester_date_edit, [role="button"].tick, [role="button"].add-semester-ghost')
            : null;
        if (!control || control.tagName === 'BUTTON') return;
        event.preventDefault();
        control.click();
    });

    document.addEventListener('DOMContentLoaded', function() {
        refreshSemesterAccessibility();
        const board = document.getElementById('board');
        if (!board || typeof MutationObserver === 'undefined') return;
        let refreshQueued = false;
        new MutationObserver(function() {
            if (refreshQueued) return;
            refreshQueued = true;
            Promise.resolve().then(function() {
                refreshQueued = false;
                refreshSemesterAccessibility();
            });
        }).observe(board, { childList: true, subtree: true });
    });
}
