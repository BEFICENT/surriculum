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
    if(container)
    {
        let target_id = extractNumericValue(container.id);
        let dragged_id = extractNumericValue(dragged_item.id);
        reordered = Number.isFinite(target_id) && Number.isFinite(dragged_id) && target_id !== dragged_id;

        if(target_id > dragged_id)
        {
            for(let id = dragged_id; id < target_id; id++)
            {
                let drag = document.querySelector(('#con' + id));
                let tar = document.querySelector(('#con' + (id+1)));
                let temp = tar.innerHTML;
                tar.innerHTML = drag.innerHTML;
                drag.innerHTML = temp;

                //id-1 bc semester index range starts from 0 but container id starts from 1:
                let s_temp = curriculum.semesters[id-1];
                curriculum.semesters[id-1]=curriculum.semesters[id];
                curriculum.semesters[id] = s_temp;
            }
        }
        else
        {
            for(let id = dragged_id; id > target_id; id--)
            {
                let drag = document.querySelector(('#con' + id));
                let tar = document.querySelector(('#con' + (id-1)));
                let temp = tar.innerHTML;
                tar.innerHTML = drag.innerHTML;
                drag.innerHTML = temp;

                let s_temp = curriculum.semesters[id-2];
                curriculum.semesters[id-2]=curriculum.semesters[id-1];
                curriculum.semesters[id-1] = s_temp;
            }
        }
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
        try {
            const storage = (typeof window !== 'undefined') ? window.planStorage : null;
            if (storage && typeof storage.requestSave === 'function') storage.requestSave();
        } catch (_) {}
    }
}
