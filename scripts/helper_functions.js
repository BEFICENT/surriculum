//checks wheter the course exists:
function isCourseValid(course, course_data)
{
    const code = course && course.code ? course.code.replace(/\s+/g, '') : '';
    // First check within the main major's course data
    for (let i = 0; i < course_data.length; i++) {
        if (((course_data[i]['Major'] + course_data[i]['Code']) === code)) return true;
    }
    // If not found and a double major is active, check the double major's
    // course catalog for this course code. The global curriculum object
    // exposes doubleMajorCourseData when a second major is selected.
    try {
        const cur = (typeof window !== 'undefined') ? window.curriculum : null;
        if (cur && cur.doubleMajor && Array.isArray(cur.doubleMajorCourseData)) {
            const dmList = cur.doubleMajorCourseData;
            for (let i = 0; i < dmList.length; i++) {
                if (((dmList[i]['Major'] + dmList[i]['Code']) === code)) {
                    return true;
                }
            }
        }
    } catch (_) {
        // ignore errors
    }
    return false;
}

//returns info's of the course:
function getInfo(course, course_data)
{
    const code = (course || '').replace(/\s+/g, '');
    // First search within the primary course data
    for (let i = 0; i < course_data.length; i++) {
        if ((course_data[i]['Major'] + course_data[i]['Code']) === code) return course_data[i];
    }
    // If not found and a double major is active, search within the double
    // major's catalog so that course details (name, credits) can be
    // retrieved for DM-only courses.  This allows unknown courses to
    // provide their metadata while still being ignored for the main
    // major's allocations.
    try {
        const cur = (typeof window !== 'undefined') ? window.curriculum : null;
        if (cur && cur.doubleMajor && Array.isArray(cur.doubleMajorCourseData)) {
            const dmList = cur.doubleMajorCourseData;
            for (let i = 0; i < dmList.length; i++) {
                if (((dmList[i]['Major'] + dmList[i]['Code']) === code)) {
                    return dmList[i];
                }
            }
        }
    } catch (_) {
        // ignore errors
    }
    return 0;
}

function extractNumericValue(string) {
    const matches = string.match(/\d+/); // Match one or more digits
    if (matches) {
      return parseInt(matches[0], 10); // Parse the matched value as an integer
    }
    return null; // No numeric value found
}

// Terms list & date_list_InnerHTML:
// Determine the current term based on the device date.
// Rules:
// - Before Jan 20: Fall of (year-1)-(year)
// - Before June 20: Spring of (year-1)-(year)
// - Before September: Summer of (year-1)-(year)
// - Otherwise: Fall of (year)-(year+1)
let currentDate = new Date();
let currentYear = currentDate.getFullYear();
let currentMonth = currentDate.getMonth(); // 0-11
let currentDay = currentDate.getDate(); // 1-31

function getCurrentTermNameFromDate(d) {
    try {
        const y = d.getFullYear();
        const m = d.getMonth();
        const day = d.getDate();
        // Jan 1-19
        if (m === 0 && day < 20) {
            const start = y - 1;
            return `Fall ${start}-${start + 1}`;
        }
        // Jan 20 -> Jun 19
        if (m < 5 || (m === 5 && day < 20)) {
            const start = y - 1;
            return `Spring ${start}-${start + 1}`;
        }
        // Jun 20 -> Aug 31
        if (m < 8) {
            const start = y - 1;
            return `Summer ${start}-${start + 1}`;
        }
        // Sep -> Dec
        const start = y;
        return `Fall ${start}-${start + 1}`;
    } catch (_) {
        return '';
    }
}
if (typeof window !== 'undefined') {
    window.getCurrentTermNameFromDate = getCurrentTermNameFromDate;
}

var date_list_InnerHTML = '';
var terms = [];
var entry_date_list_InnerHTML = '';
var entryTerms = [];

// Determine the current academic year start based on the current term name.
let academicYear = currentYear - 1;
try {
    const t = getCurrentTermNameFromDate(currentDate);
    const m = t.match(/(Fall|Spring|Summer)\s+(\d{4})-(\d{4})/);
    if (m) {
        academicYear = parseInt(m[2], 10);
    }
    if (typeof window !== 'undefined') {
        window.currentTermName = t;
        window.currentAcademicYearStart = academicYear;
    }
} catch (_) {}

// Generate terms from 2019 onwards. We still keep a window of 6 years in the
// past and future relative to the current academic year but never go earlier
// than 2019 so that the earliest selectable term matches the scraped data. The
// dataset currently ends at Fall 2025, however for planning purposes we allow
// selecting terms up to 2030.
const startYear = Math.max(2019, academicYear - 6);
const endYear = Math.min(2030, academicYear + 6);
for (let i = endYear; i >= startYear; i--) {
    // Create academic year string (e.g., "2022-2023")
    let yearRange = i + "-" + (i + 1);

    // Provide all three terms for each academic year. Previously the
    // 2025-2026 year exposed only the Fall term which prevented users from
    // selecting Spring 2025-2026.
    date_list_InnerHTML += "<option value='Summer " + yearRange + "'>";
    date_list_InnerHTML += "<option value='Spring " + yearRange + "'>";
    date_list_InnerHTML += "<option value='Fall " + yearRange + "'>";

    terms.push("Summer " + yearRange);
    terms.push("Spring " + yearRange);
    terms.push("Fall " + yearRange);
}

// Entry term options are capped dynamically (minimum is fixed) and are
// tightened further in main.js based on the scraped term manifest.
const entryStartYear = startYear;
const entryEndYear = academicYear;
for (let i = entryEndYear; i >= entryStartYear; i--) {
    const yearRange = i + '-' + (i + 1);
    entry_date_list_InnerHTML += "<option value='Summer " + yearRange + "'>";
    entry_date_list_InnerHTML += "<option value='Spring " + yearRange + "'>";
    entry_date_list_InnerHTML += "<option value='Fall " + yearRange + "'>";
    entryTerms.push("Summer " + yearRange);
    entryTerms.push("Spring " + yearRange);
    entryTerms.push('Fall ' + yearRange);
}

// Utility: convert a term name like "Fall 2023-2024" to its numeric code
// (e.g. "202301"). This is used to map user selections to the folders
// produced by the scraper.
function termNameToCode(name) {
    const m = name && name.match(/(Fall|Spring|Summer)\s+(\d{4})-(\d{4})/);
    if (!m) return '';
    const year = m[2];
    const suffix = { 'Fall': '01', 'Spring': '02', 'Summer': '03' }[m[1]] || '01';
    return year + suffix;
}

// Reverse of termNameToCode. Converts numeric term code to display string
// like "Fall 2023-2024".
function termCodeToName(code) {
    if (!code || code.length !== 6) return '';
    const year = code.slice(0, 4);
    const termNum = code.slice(4);
    const term = { '01': 'Fall', '02': 'Spring', '03': 'Summer' }[termNum] || '';
    const nextYear = String(parseInt(year, 10) + 1);
    return term + ' ' + year + '-' + nextYear;
}

// Expose current term code once conversion helpers exist.
try {
    if (typeof window !== 'undefined' && window.currentTermName) {
        window.currentTermCode = termNameToCode(window.currentTermName);
    }
} catch (_) {}

// Apply "current term" styling to semester columns.
function updateCurrentTermHighlights() {
    try {
        const ct = (typeof window !== 'undefined') ? window.currentTermName : '';
        if (!ct) return;
        document.querySelectorAll('.container_semester').forEach(container => {
            const p = container.querySelector('.date p');
            const t = p ? p.textContent.trim() : '';
            if (t && t === ct) container.classList.add('current-term');
            else container.classList.remove('current-term');
        });
    } catch (_) {}
}
if (typeof window !== 'undefined') {
    window.updateCurrentTermHighlights = updateCurrentTermHighlights;
}

var grade_list_InnerHTML = '';
let letter_grades_global = ['S', 'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'F'];
let letter_grades_global_dic = {'S':4.0, 'A':4.0, 'A-':3.7, 'B+':3.3, 'B':3.0, 'B-':2.7, 'C+':2.3, 'C':2.0, 'C-':1.7, 'D+':1.3, 'D':1.0, 'F':0.0}
for(let i = 0; i < letter_grades_global.length; i++)
{
    grade_list_InnerHTML += "<option value='" + letter_grades_global[i] + "'>";
}


function getCoursesDataList(course_data)
{
    // Build a combined list of courses. If a double major is selected,
    // merge courses unique to the double major into the primary list so
    // that users can select DM-only courses from the dropdown.  We
    // construct a copy of course_data and append unique DM courses.
    let combined = Array.isArray(course_data) ? course_data.slice() : [];
    try {
        const cur = (typeof window !== 'undefined') ? window.curriculum : null;
        if (cur && cur.doubleMajor && Array.isArray(cur.doubleMajorCourseData)) {
            // Create a set of primary courses for quick lookup
            const mainSet = new Set(combined.map(function(c) {
                return (c.Major + c.Code);
            }));
            cur.doubleMajorCourseData.forEach(function(dm) {
                const key = dm.Major + dm.Code;
                if (!mainSet.has(key)) {
                    combined.push(dm);
                }
            });
        }
        if (typeof window !== 'undefined' && window.hideTakenCourses && cur && typeof cur.hasCourse === 'function') {
            combined = combined.filter(c => !cur.hasCourse(c.Major + c.Code));
        }
    } catch (ex) {
        // ignore any errors in DM detection or filtering
    }
    // Build the option list HTML using the combined courses. Each option
    // displays the course code followed by the course name and uses the
    // same text as its value so it can populate both datalists and select
    // dropdowns.
    let datalistInnerHTML = '';
    for (let i = 0; i < combined.length; i++) {
        const item = combined[i];
        const text = item['Major'] + item['Code'] + ' ' + item['Course_Name'];
        datalistInnerHTML += `<option value='${text}'>${text}</option>`;
    }
    return datalistInnerHTML;
}

// Return an array of course strings ("MAJORCODE Course Name") used to
// populate custom dropdowns for course selection. This mirrors the data
// returned by getCoursesDataList but in array form so it can be rendered
// manually instead of relying on the browser's default datalist styling.
function getCoursesList(course_data) {
    let combined = Array.isArray(course_data) ? course_data.slice() : [];
    let mainSet = new Set(combined.map(c => c.Major + c.Code));
    try {
        const cur = (typeof window !== 'undefined') ? window.curriculum : null;
        if (cur && cur.doubleMajor && Array.isArray(cur.doubleMajorCourseData)) {
            cur.doubleMajorCourseData.forEach(dm => {
                const key = dm.Major + dm.Code;
                if (!mainSet.has(key)) {
                    dm.__fromDoubleMajor = true;
                    combined.push(dm);
                }
            });
        }
        if (typeof window !== 'undefined' && window.hideTakenCourses && cur && typeof cur.hasCourse === 'function') {
            combined = combined.filter(c => !cur.hasCourse(c.Major + c.Code));
        }
    } catch (_) {}

    return combined.map(item => {
        const code = item.Major + item.Code;
        const name = item.Course_Name;
        let mainType = item.__fromDoubleMajor ? '' : (item.EL_Type || '');
        let dmType = '';
        try {
            const cur = (typeof window !== 'undefined') ? window.curriculum : null;
            if (cur && cur.doubleMajor && Array.isArray(cur.doubleMajorCourseData)) {
                const dmEntry = cur.doubleMajorCourseData.find(dm => (dm.Major + dm.Code) === code);
                if (dmEntry) dmType = dmEntry.EL_Type || '';
            }
        } catch (_) {}
        return {
            code: code,
            name: name,
            credit: item.SU_credit || '0',
            bs: item.Basic_Science || '0',
            type: mainType,
            dmType: dmType
        };
    });
}

// Lazy-load the course page scrape index so we can check whether a course has
// been offered in the current term. This is used for optional filtering in the
// course dropdown (Add Course).
function loadCourseOfferingsIndex() {
    try {
        if (typeof window === 'undefined') return Promise.resolve(null);
        if (window.__courseOfferingsPromise) return window.__courseOfferingsPromise;

        window.__courseOfferingsPromise = (async () => {
            const tryReadText = async () => {
                // Prefer synchronous XHR under file:// where fetch can be blocked.
                try {
                    const xhr = new XMLHttpRequest();
                    xhr.open('GET', './courses/all_coursepage_info.jsonl', false);
                    xhr.overrideMimeType('application/json');
                    xhr.send(null);
                    if (xhr.status === 200 || xhr.status === 0) return xhr.responseText;
                } catch (_) {}
                try {
                    const res = await fetch('./courses/all_coursepage_info.jsonl');
                    if (res.ok) return await res.text();
                } catch (_) {}
                return '';
            };

            const text = await tryReadText();
            const byCode = new Map();
            if (!text) {
                window.courseOfferingsByCode = byCode;
                return byCode;
            }
            const lines = text.split(/\r?\n/);
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i] && lines[i].trim();
                if (!line) continue;
                try {
                    const obj = JSON.parse(line);
                    const id = obj && obj.course_id ? String(obj.course_id) : '';
                    if (!id) continue;
                    const termsArr = Array.isArray(obj.last_offered_terms) ? obj.last_offered_terms : [];
                    const set = new Set();
                    for (let j = 0; j < termsArr.length; j++) {
                        const t = termsArr[j] && termsArr[j].term ? String(termsArr[j].term) : '';
                        if (t) set.add(t);
                    }
                    byCode.set(id, set);
                } catch (_) {
                    // ignore malformed line
                }
            }
            window.courseOfferingsByCode = byCode;
            return byCode;
        })();

        return window.__courseOfferingsPromise;
    } catch (_) {
        return Promise.resolve(null);
    }
}
if (typeof window !== 'undefined') {
    window.loadCourseOfferingsIndex = loadCourseOfferingsIndex;
    window.isCourseOfferedInCurrentTerm = function(code) {
        try {
            const ct = window.currentTermName || '';
            const idx = window.courseOfferingsByCode;
            if (!ct || !idx) return true; // if unknown/unloaded, don't filter out
            const set = idx.get(String(code)) || null;
            if (!set) return true;
            return set.has(ct);
        } catch (_) {
            return true;
        }
    };
}

// Adjust semester totals by adding or subtracting the specified course's
// credit, science/engineering values and category totals. `multiplier`
// should be +1 to add credits or -1 to remove them.
function adjustSemesterTotals(semesterObj, courseInfo, multiplier) {
    if (!semesterObj || !courseInfo) return;
    multiplier = multiplier || 1;
    const credit = parseInt(courseInfo['SU_credit'] || '0');
    const bs = parseFloat(courseInfo['Basic_Science'] || '0');
    const eng = parseFloat(courseInfo['Engineering'] || '0');
    const ects = parseFloat(courseInfo['ECTS'] || '0');
    semesterObj.totalCredit += multiplier * credit;
    semesterObj.totalScience += multiplier * bs;
    semesterObj.totalEngineering += multiplier * eng;
    semesterObj.totalECTS += multiplier * ects;
    const el = (courseInfo['EL_Type'] || '').toLowerCase();
    if (el === 'free') semesterObj.totalFree += multiplier * credit;
    else if (el === 'area') semesterObj.totalArea += multiplier * credit;
    else if (el === 'core') semesterObj.totalCore += multiplier * credit;
    else if (el === 'university') semesterObj.totalUniversity += multiplier * credit;
    else if (el === 'required') semesterObj.totalRequired += multiplier * credit;
}

function serializator(curriculum)
{
    let result = '[';
    for (let i = 0; i < curriculum.semesters.length; i++)
    {
        result = result + '[';
        for (let n = 0; n < curriculum.semesters[i].courses.length; n++)
        {
            result = result + '"' + curriculum.semesters[i].courses[n].code + '"';
            if((n+1) !=curriculum.semesters[i].courses.length) result = result + ','
        }
        result = result + ']';
        if((i+1) != curriculum.semesters.length) result = result + ",";
    }
    result = result + ']';
    return result;
}

function grades_serializator()
{
    let containers = document.querySelectorAll('.container_semester');


    let result = '[';
    containers.forEach((container)=>{
        result = result + '[';
        container.querySelectorAll(".grade").forEach((grade)=>{
            if(grade.innerHTML.length <= 2){result = result + '"' + grade.innerHTML + '"';}
            else {result = result + '""'}
            result = result + ','
        })
        if(result[result.length-1] == ',') result = result.slice(0,-1)
        result = result + ']';
        result = result + ",";
    })
    if(result[result.length-1] == ',') result = result.slice(0,-1)
    result = result + ']';
    return result;
}

function dates_serializator()
{
    let result = '[';
    let dates = document.querySelectorAll('.date');
    dates.forEach((date)=>{
        try
        {
            let date_val = date.querySelector('p').innerHTML;
            result = result + '"' + date_val + '"' + ',';
        }
        catch
        {
            result = result + '"' + '...' + '"' + ',';
        }
    })
    if(result[result.length-1] == ',') result = result.slice(0,-1)
    result = result + ']';
    return result;
}

function reload(curriculum, course_data)
{
    let data, grades, dates;
    const ps = (typeof window !== 'undefined') ? window.planStorage : null;
    const get = (k) => {
        try { return ps ? ps.getItem(k) : localStorage.getItem(k); } catch (_) {}
        try { return localStorage.getItem(k); } catch (_) {}
        return null;
    };
    try{data = JSON.parse(get("curriculum"));} catch{}
    try{grades = JSON.parse(get("grades"));}   catch{}
    try{dates = JSON.parse(get("dates"))}      catch{}
    if(data)
    {
        for(let i = 0; i < data.length; i++)
        {
            if(grades && dates)
                createSemeter(true, data[i], curriculum, course_data, grades[i], dates[i]);
            else
                createSemeter(true, data[i], curriculum, course_data);

        }
    }
}

function getAncestor(element, ancestor_class)
{
    let parent = element.parentNode;
    while(parent)
    {
        if(parent.classList.contains(ancestor_class))
        {return parent;}
        else{parent = parent.parentNode;}
    }
    return null;
}
