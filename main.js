let course_data;
//can only be CS, BIO, MAT, EE, ME, IE, ECON, DSA, MAN, PSIR, PSY, VACD:
let initial_major_chosen = 'CS'

function SUrriculum(major_chosen_by_user)
{
    fetch('./' + major_chosen_by_user + '.json')
    .then(response => response.json())
    .then(json => {
    //START OF PROGRAM
    change_major_element = document.querySelector('.change_major');
    change_major_element.innerHTML = '<p>Major: ' + major_chosen_by_user + '</p>';

    course_data = json;
    let curriculum = new s_curriculum();
    curriculum.major = major_chosen_by_user;

    //************************************************

    //Targetting dynamically created elements:
    document.addEventListener('click', function(e){
        dynamic_click(e, curriculum, course_data)
        //CLICKED outside of summary_modal:
        if(!(e.target.parentNode.classList.contains('summary_modal_child')) && !e.target.classList.contains('summary_modal_child') && !e.target.classList.contains('summary_modal') && !e.target.classList.contains('summary') && !e.target.classList.contains('summary_p'))
        {
            try{document.querySelector('.summary_modal').remove();} catch{}
            try{document.querySelector('.summary_modal_overlay').remove();} catch{}
        }
        if(!(e.target.parentNode.classList.contains('graduation_modal'))  && !e.target.classList.contains('graduation_modal') && !e.target.classList.contains('check') && !e.target.parentNode.classList.contains('check'))
        {
            try{document.querySelector('.graduation_modal').remove();} catch{}
            try{document.querySelector('.graduation_modal_overlay').remove();} catch{}
        }
        //NON-dynamic Click:
        let major_change_element = document.querySelector('.change_major');
        try
        {
            if(!(e.target.classList.contains('change_major') || e.target.parentNode.classList.contains('change_major')))
            {
                major_change_element.innerHTML = '<p>Major: ' + major_chosen_by_user + '</p>';
            }
        }
        catch
        {
                major_change_element.innerHTML = '<p>Major: ' + major_chosen_by_user + '</p>';
        }
        let element = e.target;
        try
        {
            if(element.parentNode.classList.contains('change_major'))
            {
                element = element.parentNode;
            }
        } catch{}
        //Targetting major change:
        if(element.classList.contains('change_major'))
        {
            if(!change_major_element.querySelector('input'))
            {
                change_major_element.innerHTML = '';
                let input_major = document.createElement('input');
                input_major.placeholder = 'choose a major';
                input_major.setAttribute("list", 'datalist_majors');
                let datalist = document.createElement("datalist");
                datalist.innerHTML +=  "<option value='" + 'BIO' + "'>";
                datalist.innerHTML +=  "<option value='" + 'CS' + "'>";
                datalist.innerHTML +=  "<option value='" + 'EE' + "'>";
                datalist.innerHTML +=  "<option value='" + 'IE' + "'>";
                datalist.innerHTML +=  "<option value='" + 'MAT' + "'>";
                datalist.innerHTML +=  "<option value='" + 'ME' + "'>";
                datalist.innerHTML +=  "<option value='" + 'ECON' + "'>";
                datalist.innerHTML +=  "<option value='" + 'DSA' + "'>";
                datalist.innerHTML +=  "<option value='" + 'MAN' + "'>";
                datalist.innerHTML +=  "<option value='" + 'PSIR' + "'>";
                datalist.innerHTML +=  "<option value='" + 'PSY' + "'>";
                datalist.innerHTML +=  "<option value='" + 'VACD' + "'>";
                datalist.id = 'datalist_majors';
                change_major_element.appendChild(input_major);
                change_major_element.appendChild(datalist);

                input_major.addEventListener('input', function(e) {
                    let datalist_options = document.getElementById('datalist_majors').children;
                    let major_chosen_new = (e.target.value).toUpperCase();

                    let majorIsValid = false;
                    for(let i = 0; i < datalist_options.length; i++)
                    {
                        if(datalist_options[i].value == major_chosen_new) majorIsValid = true;
                    }
                    if(majorIsValid)
                    {
                        change_major_element.innerHTML = '<p>Major: ' + major_chosen_new + '</p>';
                        localStorage.removeItem("major");
                        localStorage.setItem("major", major_chosen_new);
                        location.reload();
                    }
                    else
                    {
                        e.target.parentNode.innerHTML = '<p>Major: ' + major_chosen_by_user + '</p>';
                    }
                });
            }
        }
    })
    document.addEventListener('mouseover', function(e){
        mouseover(e);
        if (e.target.classList.contains('btn'))
        {e.target.style.backgroundColor = '#7a9dc9';}
        else if(e.target.parentNode.classList.contains('btn'))
        {e.target.parentNode.style.backgroundColor = '#7a9dc9';}
        else
        {
            document.querySelectorAll('.btn').forEach( element => {element.style.backgroundColor = '#526e8f'});
            if(!e.target.classList.contains('semester_drag'))
            {document.querySelectorAll('.semester_drag').forEach( element => {element.style.backgroundImage = 'url("./assets/dragw.png")'});}
        }
    })
    document.addEventListener('mouseout', function(e){
        mouseout(e);
        if (e.target.classList.contains('btn'))
        {e.target.style.backgroundColor = '#526e8f';}
    })

    let dragged_item = null;
    document.addEventListener('dragstart', function(e){
        if(e.target.classList.contains("container_semester"))
        {dragged_item = e.target;}
    })
    document.addEventListener('dragover', function(e){
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
    })

    document.addEventListener('drop', function(e){
        drop(e, curriculum, dragged_item);
    })
    /*
    document.addEventListener("input", function(e){
        if(e.target.classList.contains())
    })*/

    //************************************************************** 

    //NON-DYNAMIC BUTTONS:
    const addSemester = document.querySelector(".addSemester");
    addSemester.addEventListener('click', function(){
        createSemeter(true, [], curriculum, course_data)
    });

    const auto_add = document.querySelector('.autoAdd');
    auto_add.addEventListener('click', function(){
        let fs_courses = ["MATH101","NS101","SPS101","IF100","TLL101","HIST191","CIP101N"];
        let ss_courses = ["MATH102","NS102","SPS102","AL102","TLL102","HIST192","PROJ201"];
        createSemeter(false, ss_courses, curriculum, course_data);
        createSemeter(false, fs_courses, curriculum, course_data);
    })

    document.querySelector('.check>p').addEventListener('click', function(){document.querySelector('.check').click();})
    const check_graduation = document.querySelector('.check');
    check_graduation.addEventListener('click', function(){
        displayGraduationResults(curriculum);
    })

    const summary = document.querySelector('.summary');
    summary.addEventListener('click', function(){
        displaySummary(curriculum, major_chosen_by_user);
    })

    //************************************************************** 

    //Reload items from local storage:
    reload(curriculum, course_data);
    //Save:
    setInterval(function() {
        localStorage.removeItem("curriculum");
        localStorage.setItem("curriculum", serializator(curriculum));
        localStorage.removeItem("grades");
        localStorage.setItem("grades", grades_serializator());
        localStorage.removeItem("dates");
        localStorage.setItem("dates", dates_serializator());
    }, 2000);

    //createSemeter(false, ["MATH101","MATH102","MATH201","MATH203","IF100","TLL101"], curriculum, course_data)
    //createSemeter(false, ["NS101","SPS101","SPS102","AL102","TLL102","HIST192","PROJ201", "NS102", "HIST191", "CIP101N", "CS210", "MATH306", "CS201", "CS204", "MATH204"], curriculum, course_data)

    // Get from transcript:
    function handleAcademicRecordsImport() {
        const fileInput = document.getElementById('academicRecordsInput');

        if (fileInput.files.length > 0) {
            const file = fileInput.files[0];
            const reader = new FileReader();

            reader.onload = function(e) {
                const htmlContent = e.target.result;

                // Parse the HTML content
                const parsedData = window.academicRecordsParser.parseAcademicRecords(htmlContent);

                // Import courses to curriculum
                const importStats = window.academicRecordsParser.importParsedCourses(
                    parsedData.courses,
                    course_data,
                    curriculum
                );

                // Show import results to user
                let message = `Successfully imported ${importStats.importedCourses} of ${importStats.totalCourses} courses.`;

                if (importStats.notFoundCourses.length > 0) {
                    message += `\n\nThe following ${importStats.notFoundCourses.length} courses were not found in the current program and were not imported:\n${importStats.notFoundCourses.join(', ')}`;
                }

                alert(message);
            };

            reader.readAsText(file);
        } else {
            alert('Please select an Academic Records HTML file.');
        }
    }
    document.getElementById('importAcademicRecords').onclick = handleAcademicRecordsImport;

    // Add event listener for the import toggle button
    document.querySelector('.import-toggle').addEventListener('click', function() {
        const importSection = document.querySelector('.import-section');
        if (importSection.style.display === 'none' || !importSection.style.display) {
            importSection.style.display = 'block';
        } else {
            importSection.style.display = 'none';
        }
    });

    // Close import panel when clicking outside
    document.addEventListener('click', function(e) {
        const importSection = document.querySelector('.import-section');
        const importToggle = document.querySelector('.import-toggle');

        if (importSection && importSection.style.display === 'block' &&
            !importSection.contains(e.target) &&
            !importToggle.contains(e.target)) {
            importSection.style.display = 'none';
        }
    });


    //END OF PROGRAM
    })
    .catch(error => {
        console.error(error);
    });
}

let major_existing = localStorage.getItem("major");
if (major_existing) {SUrriculum(major_existing);}
else {SUrriculum(initial_major_chosen);}