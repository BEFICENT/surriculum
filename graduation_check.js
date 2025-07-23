// Graduation check functionality
function checkGraduation(curriculum) {
    let flag = curriculum.canGraduate();
    let message;

    if(flag == 0){message = ("Congrats! You can graduate!!!");}
    else if (flag == 1){message = ("You cannot graduate: Your total credit is less than 125!");}
    else if (flag == 2){message = ("You cannot graduate: Your university courses credit is less than 41!");}
    else if (flag == 3){message = ("You cannot graduate: Your required courses credit is less than 29!");}
    else if (flag == 4){message = ("You cannot graduate: You have not taken CIP101!");}
    else if (flag == 5){message = ("You cannot graduate: You have not taken CS395!");}
    else if (flag == 6){message = ("You cannot graduate: Your core electives credit is less than 31!");}
    else if (flag == 7){message = ("You cannot graduate: Your area electives credit is less than 9!");}
    else if (flag == 8){message = ("You cannot graduate: Your free electives credit is less than 15!");}
    else if (flag == 9){message = ("You cannot graduate: You have not taken SPS303!");}
    else if (flag == 10){message = ("You cannot graduate: You have not taken a HUM2XX class!");}
    else if (flag == 11){message = ("You cannot graduate: Your total Basic Science ECTS is less than 60!");}
    else if (flag == 12){message = ("You cannot graduate: Your total Engineering ECTS is less than 90!");}
    else if (flag == 13){message = ("You cannot graduate: Your total ECTS credit is less than 240!");}
    else if (flag == 14){message = ("You cannot graduate: Your required courses credit is less than 31!");}
    else if (flag == 15){message = ("You cannot graduate: You have not taken IE395!");}
    else if (flag == 16){message = ("You cannot graduate: Your core electives credit is less than 29!");}
    else if (flag == 17){message = ("You cannot graduate: Your required courses credit is less than 35!");}
    else if (flag == 18){message = ("You cannot graduate: You have not taken EE395!");}
    else if (flag == 19){message = ("You cannot graduate: Your core electives credit is less than 25!");}
    else if (flag == 20){message = ("You cannot graduate: Your required courses credit is less than 26!");}
    else if (flag == 21){message = ("You cannot graduate: You have not taken EE395!");}
    else if (flag == 22){message = ("You cannot graduate: Your core electives credit is less than 34!");}
    else if (flag == 23){message = ("You cannot graduate: You have not taken BIO395!");}
    else if (flag == 24){message = ("You cannot graduate: Your required courses credit is less than 39!");}
    else if (flag == 25){message = ("You cannot graduate: You have not taken ME395!");}
    else if (flag == 26){message = ("You cannot graduate: Your core electives credit is less than 21!");}
    else if (flag == 27){message = ("You cannot graduate: Your required courses credit is less than 18!");}
    else if (flag == 28){message = ("You cannot graduate: You have not taken ECON300!");}
    else if (flag == 29){message = ("You cannot graduate: Your core electives credit is less than 12!");}
    else if (flag == 30){message = ("You cannot graduate: Your area electives credit is less than 18!");}
    else if (flag == 31){message = ("You cannot graduate: Your free electives credit is less than 30!");}
    else if (flag == 32){message = ("You cannot graduate: You have not taken a HUM3XX class!");}
    else if (flag == 33){message = ("You cannot graduate: Your required courses credit is less than 30!");}
    else if (flag == 34){message = ("You cannot graduate: Your core electives credit is less than 27!");}
    else if (flag == 35){message = ("You cannot graduate: Your area electives credit is less than 12!");}
    else if (flag == 36){message = ("You cannot graduate: Your free electives credit is less than 15!");}
    else if (flag == 37){message = ("You cannot graduate: You need at least 5 faculty courses!");}
    else if (flag == 38){message = ("You cannot graduate: You need at least 9 credits from 400-level EE courses!");}
    else if (flag == 39){message = ("You cannot graduate: You need at least one course from CS300, CS401, CS412, ME303, PHYS302, PHYS303, or EE48XXX special topics!");}
    else if (flag == 40){message = ("You cannot graduate: You need to complete your Mathematics requirement (MATH201, MATH202, or MATH204)!");}
    else if (flag == 41){message = ("You cannot graduate: You need at least 5 faculty courses!");}
    else if (flag == 42){message = ("You cannot graduate: You need at least 3 FASS faculty courses!");}
    else if (flag == 43){message = ("You cannot graduate: Your faculty courses must span at least 3 different areas!");}
    else if (flag == 44){message = ("You cannot graduate: You need at least 5 faculty courses!");}
    else if (flag == 45){message = ("You cannot graduate: You need at least 2 MATH courses!");}
    else if (flag == 46){message = ("You cannot graduate: You need at least 3 FENS faculty courses!");}
    else if (flag == 47){message = ("You cannot graduate: You have not taken DSA395!");}
    else if (flag == 48){message = ("You cannot graduate: You need at least 1 FENS faculty course!");}
    else if (flag == 49){message = ("You cannot graduate: You need at least 1 FASS faculty course!");}
    else if (flag == 50){message = ("You cannot graduate: You need at least 1 SBS faculty course!");}
    else if (flag == 51){message = ("You cannot graduate: You need at least 3 FENS courses in your core electives!");}
    else if (flag == 52){message = ("You cannot graduate: You need at least 3 FASS courses in your core electives!");}
    else if (flag == 53){message = ("You cannot graduate: You need at least 3 SBS courses in your core electives!");}

    return message;
}

// Display graduation check results in a modal
function displayGraduationResults(curriculum) {
    if(!document.querySelector('.graduation_modal')) {
        const board_dom = document.querySelector(".board");
        let graduation_modal = document.createElement("div");
        graduation_modal.classList.add('graduation_modal');
        let graduation_modal_overlay = document.createElement("div");
        graduation_modal_overlay.classList.add('graduation_modal_overlay');
        board_dom.appendChild(graduation_modal_overlay);
        board_dom.appendChild(graduation_modal);

        const leftPosition = ((board_dom.offsetWidth) / 2) + board_dom.scrollLeft;
        graduation_modal.style.left = leftPosition + 'px';

        let message = checkGraduation(curriculum);
        graduation_modal.innerHTML = '<div>'+ message +'</div>';
    }
}

// Function to display summary of credits
function displaySummary(curriculum, major_chosen_by_user) {
    if(document.querySelector('.summary_modal')) return;

    let area = 0;
    let core = 0;
    let free = 0;
    let university = 0;
    let required = 0;
    let total = 0;
    let science = 0;
    let engineering = 0;
    let ects = 0;
    let gpa_credits = 0;
    let gpa_value = 0.0;

    for(let i = 0; i < curriculum.semesters.length; i++) {
        total = total + curriculum.semesters[i].totalCredit;
        area = area + curriculum.semesters[i].totalArea;
        core = core + curriculum.semesters[i].totalCore;
        free = free + curriculum.semesters[i].totalFree;
        university = university + curriculum.semesters[i].totalUniversity;
        required = required + curriculum.semesters[i].totalRequired;
        science += curriculum.semesters[i].totalScience;
        engineering += curriculum.semesters[i].totalEngineering;
        ects += curriculum.semesters[i].totalECTS;
        gpa_credits += curriculum.semesters[i].totalGPACredits;
        gpa_value += curriculum.semesters[i].totalGPA;
    }

    const board_dom = document.querySelector(".board");
    let summary_modal = document.createElement("div");
    summary_modal.classList.add('summary_modal');
    let summary_modal_overlay = document.createElement("div");
    summary_modal_overlay.classList.add('summary_modal_overlay');
    board_dom.appendChild(summary_modal_overlay);
    board_dom.appendChild(summary_modal);

    const leftPosition = ((board_dom.offsetWidth) / 2) + board_dom.scrollLeft;
    summary_modal.style.left = leftPosition + 'px';

    let labels = ['GPA: ', 'SU Credits: ', 'ECTS: ', 'University: ',  'Required: ', 'Core: ', 'Area: ', 'Free: ',  'Basic Science: ', 'Engineering: '];
    let total_values = [(gpa_value/gpa_credits).toFixed(3), total, ects, university, required, core, area, free, science, engineering]
    let limits = [];

    if(major_chosen_by_user == 'CS') {
        limits = ["4.0", "125", "240","41","29", "31", "9","15","60","90"];
    } else if(major_chosen_by_user == 'IE') {
        limits = ["4.0", "125", "240","41","31", "29", "9","15","60","90"];
    } else if(major_chosen_by_user == 'ECON') {
        limits = ["4.0", "125", "240","41","18", "12", "18","30","0","0"];
    } else if(major_chosen_by_user == 'EE') {
        limits = ["4.0", "125", "240","41","35", "25", "9","15","60","90"];
    } else if(major_chosen_by_user == 'MAT') {
        limits = ["4.0", "125", "240","41","26", "34", "9","15","60","90"];
    } else if(major_chosen_by_user == 'BIO') {
        limits = ["4.0", "127", "240","41","33", "29", "9","15","0","0"];
    } else if(major_chosen_by_user == 'ME') {
        limits = ["4.0", "125", "240","41","39", "21", "9","15","60","90"];
    } else if(major_chosen_by_user == 'DSA') {
        limits = ["4.0", "125", "240","41","30", "27", "12","15","60","90"];
    } else if(major_chosen_by_user == 'MAN') {
        limits = ["4.0", "125", "240","41","18", "12", "18","30","0","0"];
    } else if(major_chosen_by_user == 'PSIR') {
        limits = ["4.0", "125", "240","41","18", "12", "18","30","0","0"];
    } else if(major_chosen_by_user == 'PSY') {
        limits = ["4.0", "125", "240","41","18", "12", "18","30","0","0"];
    } else if(major_chosen_by_user == 'VACD') {
        limits = ["4.0", "125", "240","41","18", "12", "18","30","0","0"];
    }

    for (let i = 0; i < 10; i++) {
        let child_summary = document.createElement("div");
        child_summary.classList.add('summary_modal_child');
        if(i==0) child_summary.innerHTML = '<p>GPA: ' + total_values[i]  + '</p>';
        else child_summary.innerHTML = '<p>' + labels[i] + total_values[i] + ' / ' + limits[i] + '</p>';
        summary_modal.appendChild(child_summary);
    }
}
