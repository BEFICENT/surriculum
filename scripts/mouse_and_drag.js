function mouseover(e)
{
    if(e.target.classList.contains("semester_drag"))
    {
        e.target.parentNode.parentNode.parentNode.parentNode.setAttribute('draggable','true');
    }
    else if(e.target.classList.contains("tick"))
    {
        e.target.style.backgroundImage = "url('./assets/tickb.png')";
    }
    else if(e.target.classList.contains("addCourse"))
    {
        e.target.style.textDecoration = "underline";
    }
    else if(e.target.classList.contains("grade"))
    {
        e.target.style.textDecoration = "underline";
    }
    else if(e.target.classList.contains("delete_add_course") || e.target.classList.contains("delete_course"))
    {
        e.target.style.backgroundImage = "url('./assets/open.png')";
        e.target.style.filter = "invert(18%) sepia(98%) saturate(7492%) hue-rotate(357deg) brightness(97%) contrast(119%)";
    }
    else if(e.target.classList.contains("enter"))
    {
        e.target.classList.add('shake');
    }
}

function mouseout(e)
{
    if(e.target.classList.contains("semester_drag"))
    {
        e.target.parentNode.parentNode.parentNode.parentNode.setAttribute('draggable','false');
    }
    else if(e.target.classList.contains("tick"))
    {
        e.target.style.backgroundImage = "url('./assets/tickw.png')";
    }
    else if(e.target.classList.contains("addCourse"))
    {
        e.target.style.textDecoration = "none";
    }
    else if(e.target.classList.contains("grade"))
    {
        e.target.style.textDecoration = "none";
    }
    else if(e.target.classList.contains("delete_add_course") || e.target.classList.contains("delete_course"))
    {
        // Restore the original delete icon color when the pointer leaves
        // the element. Previously this used `closed.png`, which left the
        // icon black after the first hover. Matching the default
        // `closedb.png` ensures the icon returns to its initial blue tint.
        e.target.style.backgroundImage = "url('./assets/closedb.png')";
        e.target.style.filter = "";

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

// Keep the numbered container slots stable and move their contents in lockstep
// with the curriculum array. This is the same operation used by pointer drag,
// exposed as an explicit one-step action for keyboard and switch users.
function reorderSemesterSlots(curriculum, fromPosition, toPosition)
{
    if (!curriculum || !Array.isArray(curriculum.semesters)) return false;
    const from = Number(fromPosition);
    const to = Number(toPosition);
    if (!Number.isInteger(from) || !Number.isInteger(to) || from === to) return false;
    if (from < 1 || to < 1 || from > curriculum.semesters.length || to > curriculum.semesters.length) return false;
    for (let id = Math.min(from, to); id <= Math.max(from, to); id++) {
        if (!document.querySelector('#con' + id)) return false;
    }

    if(from < to)
    {
        for(let id = from; id < to; id++)
        {
            const drag = document.querySelector('#con' + id);
            const target = document.querySelector('#con' + (id + 1));
            if (!drag || !target) return false;
            const temp = target.innerHTML;
            target.innerHTML = drag.innerHTML;
            drag.innerHTML = temp;

            const semester = curriculum.semesters[id - 1];
            curriculum.semesters[id - 1] = curriculum.semesters[id];
            curriculum.semesters[id] = semester;
        }
    }
    else
    {
        for(let id = from; id > to; id--)
        {
            const drag = document.querySelector('#con' + id);
            const target = document.querySelector('#con' + (id - 1));
            if (!drag || !target) return false;
            const temp = target.innerHTML;
            target.innerHTML = drag.innerHTML;
            drag.innerHTML = temp;

            const semester = curriculum.semesters[id - 2];
            curriculum.semesters[id - 2] = curriculum.semesters[id - 1];
            curriculum.semesters[id - 1] = semester;
        }
    }
    return true;
}

function finishSemesterReorder(curriculum, courseData)
{
    try {
        if (curriculum && typeof curriculum.recalcEffectiveTypes === 'function') {
            curriculum.recalcEffectiveTypes(courseData);
        }
    } catch (_) {}
    try {
        const storage = (typeof window !== 'undefined') ? window.planStorage : null;
        if (storage && typeof storage.requestSave === 'function') storage.requestSave();
    } catch (_) {}
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
            const up = document.createElement('button');
            up.type = 'button';
            up.className = 'semester_move semester_move_up';
            up.innerHTML = '<i class="fa-solid fa-arrow-up" aria-hidden="true"></i>';
            const down = document.createElement('button');
            down.type = 'button';
            down.className = 'semester_move semester_move_down';
            down.innerHTML = '<i class="fa-solid fa-arrow-down" aria-hidden="true"></i>';
            controls.appendChild(up);
            controls.appendChild(down);
            icons.insertBefore(controls, drag || remove || null);
        }
        const up = controls.querySelector('.semester_move_up');
        const down = controls.querySelector('.semester_move_down');
        if (up) {
            up.disabled = index === 0;
            up.setAttribute('aria-label', `Move ${term} up`);
            up.setAttribute('title', `Move ${term} up`);
        }
        if (down) {
            down.disabled = index === containers.length - 1;
            down.setAttribute('aria-label', `Move ${term} down`);
            down.setAttribute('title', `Move ${term} down`);
        }
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
    let container = getAncestor(targetElement, "container_semester");
    let reordered = false;
    if(container && dragged_item)
    {
        let target_id = extractNumericValue(container.id);
        let dragged_id = extractNumericValue(dragged_item.id);
        reordered = Number.isFinite(target_id) && Number.isFinite(dragged_id) && target_id !== dragged_id;
        if (reordered) reordered = reorderSemesterSlots(curriculum, dragged_id, target_id);
    }

    // After reordering semesters via drag-and-drop, recalculate effective types
    // so that category allocation reflects the new chronological order. If
    // recalcEffectiveTypes is not defined, silently skip.
    try {
        if (typeof curriculum.recalcEffectiveTypes === 'function') {
            curriculum.recalcEffectiveTypes(course_data);
        }
    } catch(err) {
        // ignore
    }
    if (reordered) {
        try { refreshSemesterAccessibility(); } catch (_) {}
        try {
            const storage = (typeof window !== 'undefined') ? window.planStorage : null;
            if (storage && typeof storage.requestSave === 'function') storage.requestSave();
        } catch (_) {}
    }
}

if (typeof document !== 'undefined') {
    document.addEventListener('click', function(event) {
        const button = event.target && event.target.closest
            ? event.target.closest('.semester_move_up, .semester_move_down') : null;
        if (!button) return;
        event.preventDefault();
        event.stopPropagation();
        const container = button.closest('.container_semester');
        const containers = Array.from(document.querySelectorAll('.container_semester'));
        const fromIndex = containers.indexOf(container);
        const offset = button.classList.contains('semester_move_up') ? -1 : 1;
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
        announcePlannerChange(
            `Moved ${term} ${offset < 0 ? 'up' : 'down'} to position ${toIndex + 1} of ${containers.length}.`
        );
        const destination = document.querySelector('#con' + (toIndex + 1));
        const focusTarget = destination ? destination.querySelector(
            offset < 0 ? '.semester_move_up' : '.semester_move_down'
        ) : null;
        try { if (focusTarget) focusTarget.focus({ preventScroll: true }); } catch (_) {}
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
