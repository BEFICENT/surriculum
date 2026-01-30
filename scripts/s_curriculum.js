// Curriculum constructor. In a non-module environment this function will
// be attached to the global window so that other scripts can instantiate
// curricula without using ES module imports.


// Expose s_curriculum constructor globally when running in a browser.
if (typeof window !== 'undefined') {
    window.s_curriculum = s_curriculum;
}
function s_curriculum()
{
    this.semester_id = 0;
    this.course_id = 0;
    this.container_id = 0;
    this.semesters = [];
    this.major = '';

    // Academic entry term codes (e.g., "202301") for the main major and
    // optional double major. These control which requirement set is used
    // when evaluating graduation status.
    this.entryTerm = '';

    // When the user chooses a double major via the UI, this property is
    // assigned the second major's code (e.g., "EE").  When set, the
    // curriculum will compute a second set of effective course categories
    // (core, area, free) for the double major using the
    // recalcEffectiveTypesDouble method.  If undefined or empty, no
    // double major processing occurs.
    this.doubleMajor = '';
    this.entryTermDM = '';

    // Helper to retrieve requirement object for a given major and term code.
    // The global `requirements` may either be a flat object keyed by major or
    // a nested object keyed by term then major. This function abstracts the
    // lookup so both formats are supported during the transition to
    // term-based data.
    const getReq = (major, term) => {
        if (typeof requirements === 'undefined') return {};
        if (requirements[term] && requirements[term][major]) {
            return requirements[term][major];
        }
        if (requirements[major]) return requirements[major];
        return {};
    };

    this.getTotalCredits = function ()
    {};
    this.getSemester = function(id)
    {
        for(let i = 0; i < this.semesters.length; i++)
        {
            if(this.semesters[i].id == id)
            {
                return this.semesters[i];
            }
        }
        try {
            console.warn('Semester not found:', id);
        } catch (_) {}
        return null;
    };
    this.deleteSemester = function(id)
    {
        for(let i = 0; i < this.semesters.length; i++)
        {
            if(this.semesters[i].id == id)
            {
                this.semesters.splice(i,1)
            }
        }
    }
    this.print = function()
    {
        for(let i = 0; i < this.semesters.length; i++)
        {
            for(let a = 0; a < this.semesters[i].courses.length; a++)
            {
                console.log(this.semesters[i].courses[a].code)
            }
        }
    }
    this.hasCourse = function(course)
    {
        // Use a strict normalizer (strip anything that's not A-Z/0-9). This
        // prevents subtle mismatches from PDFs/HTMLs that may contain
        // non-standard whitespace or punctuation in extracted course codes.
        const normalize = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        const canonicalize = (c) => {
            const n = normalize(c);
            // CS210 was renamed to DSA210; treat them as the same course.
            if (n === 'CS210' || n === 'DSA210') return 'DSA210';
            return n;
        };
        const target = canonicalize(course);
        for(let i = 0; i < this.semesters.length; i++)
        {
            for(let a = 0; a < this.semesters[i].courses.length; a++)
            {
                if(canonicalize(this.semesters[i].courses[a].code) === target)
                {return true;}
            }
        }
        return false;
    }
    this.canGraduate = function()
    {
        let area = 0;
        let core = 0;
        let free = 0;
        let university = 0;
        let required = 0;
        let total = 0;
        let science = 0;
        let engineering = 0;
        let ects = 0;
        let gpaCredits = 0;
        let gpaValue = 0.0;

        for(let i = 0; i < this.semesters.length; i++)
        {
            total = total + this.semesters[i].totalCredit;
            area = area + this.semesters[i].totalArea;
            core = core + this.semesters[i].totalCore;
            free = free + this.semesters[i].totalFree;
            university = university + this.semesters[i].totalUniversity;
            required = required + this.semesters[i].totalRequired;
            science += this.semesters[i].totalScience;
            engineering += this.semesters[i].totalEngineering;
            ects += this.semesters[i].totalECTS;
            gpaCredits += this.semesters[i].totalGPACredits;
            gpaValue += this.semesters[i].totalGPA;
        }
        // Generic requirement checks
        const req = getReq(this.major, this.entryTerm);
        if (university < req.university) return 1;
        if (req.internshipCourse && !this.hasCourse(req.internshipCourse)) return 4;
        if (total < req.total) return 5;
        if (science < req.science) return 8;
        if (engineering < req.engineering) return 9;
        if (ects < req.ects) return 10;
        if (required < req.required) return 2;
        // Check core, area and free credits against requirements directly.
        // Do not perform dynamic reallocation here because the effective
        // categories have already been computed via recalcEffectiveTypes().
        // Flag codes must align with flagMessages.js:
        // 3=core, 6=area, 7=free, 8=science.
        if (core < req.core) return 3;
        if (area < req.area) return 6;
        if (free < req.free) return 7;
        // GPA check for graduation
        const gpaThresholdMainMajor = 2.00;
        let GPA = gpaCredits ? (gpaValue / gpaCredits).toFixed(3) : NaN;
        if (!isNaN(GPA)){
            if (GPA < gpaThresholdMainMajor) return 38; // Flag for main major
        }
        // Major-specific CS checks (only additional flags beyond generic)
        if(this.major == 'CS')
        {
            // Check CS internship and special courses handled generically, now check SPS303, HUM2XX/HUM3XX
            if (!this.hasCourse("SPS303")) return 11;
            if (!(this.hasCourse("HUM201") || this.hasCourse("HUM202") || this.hasCourse("HUM207"))) return 12;
            {
                // Check faculty course requirements for CS
                let facultyCoursesCount = 0;
                let fensCoursesCount = 0;
                let mathCoursesCount = 0;

                for(let i = 0; i < this.semesters.length; i++) {
                    for(let a = 0; a < this.semesters[i].courses.length; a++) {
                        let course = this.semesters[i].courses[a];
                        if (course && course.effective_type === 'none') continue;
                        // Count faculty courses using the new Faculty_Course attribute
                        if(course.Faculty_Course && course.Faculty_Course !== 'No') {
                            facultyCoursesCount++;

                            // Count FENS courses
                            if(course.Faculty_Course === "FENS") {
                                fensCoursesCount++;
                            }

                            // Count MATH courses from FENS faculty courses
                            if(course.Faculty_Course === "FENS" && course.code.startsWith("MATH")) {
                                mathCoursesCount++;
                            }
                        }
                    }
                }

                if(facultyCoursesCount < 5) return 14;
                if(mathCoursesCount < 2) return 19;
                if(fensCoursesCount < 3) return 16;
            }
        }
        else if(this.major == 'IE')
        {
            // Generic checks apply
            // Additional IE-specific logic can be added here if needed
            {
                // Check faculty course requirements for IE (same as CS, EE, MAT)
                let facultyCoursesCount = 0;
                let fensCoursesCount = 0;
                let mathCoursesCount = 0;

                for(let i = 0; i < this.semesters.length; i++) {
                    for(let a = 0; a < this.semesters[i].courses.length; a++) {
                        let course = this.semesters[i].courses[a];
                        // Count faculty courses using the new Faculty_Course attribute
                        if(course.Faculty_Course && course.Faculty_Course !== 'No') {
                            facultyCoursesCount++;

                            // Count FENS courses
                            if(course.Faculty_Course === "FENS") {
                                fensCoursesCount++;
                            }

                            // Count MATH courses from FENS faculty courses
                            if(course.Faculty_Course === "FENS" && course.code.startsWith("MATH")) {
                                mathCoursesCount++;
                            }
                        }
                    }
                }

                if(facultyCoursesCount < 5) return 14;
                if(mathCoursesCount < 2) return 19;
                if(fensCoursesCount < 3) return 16;
            }
        }
        else if(this.major == 'EE')
        {
            // Generic checks apply
            {
                // Check for minimum 400-level EE courses requirement (9 credits)
                let ee400LevelCredits = 0;
                for(let i = 0; i < this.semesters.length; i++) {
                    for(let a = 0; a < this.semesters[i].courses.length; a++) {
                        let course = this.semesters[i].courses[a];
                        // Check if it's a 400-level EE course in core electives
                        if(course.code.startsWith("EE4") && course.category === "Core") {
                            ee400LevelCredits += (typeof parseCreditValue === 'function')
                                ? parseCreditValue(course.SU_credit || '0')
                                : (parseFloat(course.SU_credit || '0') || 0);
                        }
                    }
                }

                if (ee400LevelCredits < 9) return 23;

                else
                {

                    // Check for minimum one course from specific area electives
                    let hasSpecificAreaCourse = false;
                    const specificAreaCourses = ["CS300", "CS401", "CS412", "ME303", "PHYS302", "PHYS303"];

                    for(let i = 0; i < this.semesters.length; i++) {
                        for(let a = 0; a < this.semesters[i].courses.length; a++) {
                            let course = this.semesters[i].courses[a];
                            // Check for specific area courses
                            if(specificAreaCourses.includes(course.code) ||
                                (course.code.startsWith("EE48") && course.category === "Area")) {
                                hasSpecificAreaCourse = true;
                                break;
                            }
                        }
                        if(hasSpecificAreaCourse) break;
                    }

                    if(!hasSpecificAreaCourse) return 24;

                }
            }
        }
        else if(this.major == 'MAT')
        {
            // Generic checks apply
            {
                // Check if student has at least 5 faculty courses with special requirements
                let facultyCoursesCount = 0;
                let fensCoursesCount = 0;
                let mathCoursesCount = 0;

                for(let i = 0; i < this.semesters.length; i++) {
                    for(let a = 0; a < this.semesters[i].courses.length; a++) {
                        let course = this.semesters[i].courses[a];
                        // Count faculty courses using the new Faculty_Course attribute
                        if(course.Faculty_Course && course.Faculty_Course !== 'No') {
                            facultyCoursesCount++;

                            // Count FENS courses
                            if(course.Faculty_Course === "FENS") {
                                fensCoursesCount++;
                            }

                            // Count MATH courses from FENS faculty courses
                            if(course.Faculty_Course === "FENS" && course.code.startsWith("MATH")) {
                                mathCoursesCount++;
                            }
                        }
                    }
                }

                if(facultyCoursesCount < 5) return 14;
                if(mathCoursesCount < 2) return 19;
                if(fensCoursesCount < 3) return 16;

            }
        }
        else if(this.major == 'BIO')
        {
            // Generic checks apply
            {
                // Check faculty course requirements for BIO
                let facultyCoursesCount = 0;
                let fensCoursesCount = 0;
                let mathCoursesCount = 0;

                for(let i = 0; i < this.semesters.length; i++) {
                    for(let a = 0; a < this.semesters[i].courses.length; a++) {
                        let course = this.semesters[i].courses[a];
                        // Count faculty courses using the new Faculty_Course attribute
                        if(course.Faculty_Course && course.Faculty_Course !== 'No') {
                            facultyCoursesCount++;

                            // Count FENS courses
                            if(course.Faculty_Course === "FENS") {
                                fensCoursesCount++;
                            }

                            // Count MATH courses from FENS faculty courses
                            if(course.Faculty_Course === "FENS" && course.code.startsWith("MATH")) {
                                mathCoursesCount++;
                            }
                        }
                    }
                }

                if(facultyCoursesCount < 5) return 14;
                if(mathCoursesCount < 2) return 19;
                if(fensCoursesCount < 3) return 16;

            }
        }
        else if(this.major == 'ME')
        {
            // Generic checks apply
            {
                // Check faculty course requirements for ME (same as CS, EE, MAT, IE)
                let facultyCoursesCount = 0;
                let fensCoursesCount = 0;
                let mathCoursesCount = 0;

                for(let i = 0; i < this.semesters.length; i++) {
                    for(let a = 0; a < this.semesters[i].courses.length; a++) {
                        let course = this.semesters[i].courses[a];
                        // Count faculty courses using the new Faculty_Course attribute
                        if(course.Faculty_Course && course.Faculty_Course !== 'No') {
                            facultyCoursesCount++;

                            // Count FENS courses
                            if(course.Faculty_Course === "FENS") {
                                fensCoursesCount++;
                            }

                            // Count MATH courses from FENS faculty courses
                            if(course.Faculty_Course === "FENS" && course.code.startsWith("MATH")) {
                                mathCoursesCount++;
                            }
                        }
                    }
                }

                if(facultyCoursesCount < 5) return 14;
                if(mathCoursesCount < 2) return 19;
                if(fensCoursesCount < 3) return 16;
            }
        }
        else if(this.major == 'ECON')
        {
            // Generic checks apply
            {
                // Check if Math requirement (3 credits) is fulfilled
                let hasMathRequirement = this.hasCourse("MATH201") || this.hasCourse("MATH202") || this.hasCourse("MATH204");
                if (!hasMathRequirement) return 25;

                // Check if at least 5 faculty courses requirement is met
                let facultyCoursesCount = 0;
                let fassCount = 0;
                let areasCount = new Set();

                for(let i = 0; i < this.semesters.length; i++) {
                    for(let a = 0; a < this.semesters[i].courses.length; a++) {
                        let course = this.semesters[i].courses[a];
                        // Count faculty courses using the new Faculty_Course attribute
                        if(course.Faculty_Course && course.Faculty_Course !== 'No') {
                            facultyCoursesCount++;

                            // Count FASS courses
                            if(course.Faculty_Course === "FASS") {
                                fassCount++;
                            }

                            // Track areas (simplified check)
                            if(course.code.startsWith("CULT")) areasCount.add("CULT");
                            else if(course.code.startsWith("ECON")) areasCount.add("ECON");
                            else if(course.code.startsWith("HART")) areasCount.add("HART");
                            else if(course.code.startsWith("PSYCH")) areasCount.add("PSYCH");
                            else if(course.code.startsWith("SPS") || course.code.startsWith("POLS") || course.code.startsWith("IR")) areasCount.add("SPS/POLS/IR");
                            else if(course.code.startsWith("VA")) areasCount.add("VA");
                            else if(course.Faculty_Course === "FENS") areasCount.add("FENS");
                            else if(course.Faculty_Course === "SBS") areasCount.add("SBS");
                        }
                    }
                }

                if(facultyCoursesCount < 5) return 14;
                if(fassCount < 3) return 15;
                if(areasCount.size < 3) return 18;
            }
        }
        else if(this.major == 'MAN') {
            // Generic checks apply
            {
                // Check faculty course requirements for MAN
                let facultyCoursesCount = 0;
                let sbsCoursesCount = 0;

                for (let i = 0; i < this.semesters.length; i++) {
                    for (let a = 0; a < this.semesters[i].courses.length; a++) {
                        let course = this.semesters[i].courses[a];
                        // Count faculty courses using the new Faculty_Course attribute
                        if (course.Faculty_Course && course.Faculty_Course !== 'No') {
                            facultyCoursesCount++;

                            // Count SBS courses
                            if (course.Faculty_Course === "SBS") {
                                sbsCoursesCount++;
                            }
                        }
                    }
                }

                if (facultyCoursesCount < 5) return 14;
                if (sbsCoursesCount < 2) return 22;

                // Core electives requirement: 6 courses from 6 different areas
                let coreAreas = new Set();
                let coreCount = 0;
                for (let i = 0; i < this.semesters.length; i++) {
                    for (let a = 0; a < this.semesters[i].courses.length; a++) {
                        const course = this.semesters[i].courses[a];
                        const eff = (course.effective_type || (course.category && course.category.toLowerCase()) || '').toLowerCase();
                        if (eff === 'core') {
                            coreCount++;
                            if (course.code.startsWith('ACC')) coreAreas.add('ACC');
                            else if (course.code.startsWith('FIN')) coreAreas.add('FIN');
                            else if (course.code.startsWith('MGMT')) coreAreas.add('MGMT');
                            else if (course.code.startsWith('MKTG')) coreAreas.add('MKTG');
                            else if (course.code.startsWith('OPIM')) coreAreas.add('OPIM');
                            else if (course.code.startsWith('ORG')) coreAreas.add('ORG');
                        }
                    }
                }
                if (coreAreas.size < 6) return 35;

                // Area electives requirement: 5 courses from 5 different areas
                let areaAreas = new Set();
                let areaCount = 0;
                for (let i = 0; i < this.semesters.length; i++) {
                    for (let a = 0; a < this.semesters[i].courses.length; a++) {
                        const course = this.semesters[i].courses[a];
                        const eff = (course.effective_type || (course.category && course.category.toLowerCase()) || '').toLowerCase();
                        if (eff === 'area') {
                            areaCount++;
                            if (course.code.startsWith('ACC')) areaAreas.add('ACC');
                            else if (course.code.startsWith('FIN')) areaAreas.add('FIN');
                            else if (course.code.startsWith('MKTG')) areaAreas.add('MKTG');
                            else if (course.code.startsWith('OPIM')) areaAreas.add('OPIM');
                            else if (course.code.startsWith('ORG')) areaAreas.add('ORG');
                        }
                    }
                }
                if (areaAreas.size < 5) return 36;

                // Free Electives requirement for MAN
                let freeElectivesCount = 0;
                let fassFensCredits = 0;
                let basicLanguageCoursesCount = 0;
                const basicLanguageCourses = ['LANG101', 'LANG102', 'LANG103', 'LANG104']; // Example codes for basic language courses

                for (let i = 0; i < this.semesters.length; i++) {
                    for (let a = 0; a < this.semesters[i].courses.length; a++) {
                        const course = this.semesters[i].courses[a];
                        const eff = (course.effective_type || (course.category && course.category.toLowerCase()) || '').toLowerCase();
                        if (eff === 'free') {
                            const c = (typeof parseCreditValue === 'function')
                                ? parseCreditValue(course.SU_credit || '0')
                                : (parseFloat(course.SU_credit || '0') || 0);
                            freeElectivesCount += c;
                            if (course.Faculty_Course === 'FASS' || course.Faculty_Course === 'FENS') {
                                fassFensCredits += c;
                            }
                            if (basicLanguageCourses.includes(course.code)) {
                                basicLanguageCoursesCount++;
                            }
                        }
                    }
                }

                // Check Free Electives requirements
                if (freeElectivesCount < 26) return 37;
                if (fassFensCredits < 9) return 37;
                if (basicLanguageCoursesCount > 2) return 37;
            }
        }
        else if(this.major == 'PSIR')
        {
            // Generic checks apply
            {
                // Check faculty course requirements for PSIR
                let facultyCoursesCount = 0;
                let fassCoursesCount = 0;
                let areasCount = new Set();

                for(let i = 0; i < this.semesters.length; i++) {
                    for(let a = 0; a < this.semesters[i].courses.length; a++) {
                        let course = this.semesters[i].courses[a];
                        // Count faculty courses using the new Faculty_Course attribute
                        if(course.Faculty_Course && course.Faculty_Course !== 'No') {
                            facultyCoursesCount++;

                            // Count FASS courses
                            if(course.Faculty_Course === "FASS") {
                                fassCoursesCount++;
                            }

                            // Track areas for PSIR
                            if(course.code.startsWith("CULT")) areasCount.add("CULT");
                            else if(course.code.startsWith("ECON")) areasCount.add("ECON");
                            else if(course.code.startsWith("HART")) areasCount.add("HART");
                            else if(course.code.startsWith("PSY")) areasCount.add("PSYCH");
                            else if(course.code.startsWith("SPS") || course.code.startsWith("POLS") || course.code.startsWith("IR")) areasCount.add("SPS/POLS/IR");
                            else if(course.code.startsWith("VA")) areasCount.add("VA");
                            else if(course.Faculty_Course === "FENS") areasCount.add("FENS");
                            else if(course.Faculty_Course === "SBS") areasCount.add("SBS");
                        }
                    }
                }

                if(facultyCoursesCount < 5) return 14;
                if(fassCoursesCount < 3) return 15;
                if(areasCount.size < 3) return 18;

                // Core Electives I (Political Science)
                let coreElectivesICount = 0;
                const coreElectivesIPool = ['LAW312', 'POLS251', 'POLS353', 'POLS404', 'POLS455', 'POLS483', 'POLS493', 'SOC201'];
                for (let i = 0; i < this.semesters.length; i++) {
                    for (let a = 0; a < this.semesters[i].courses.length; a++) {
                        const course = this.semesters[i].courses[a];
                        const courseCode = course.code || ((course.Major || '') + (course.Code || ''));
                        if (coreElectivesIPool.includes(courseCode)) {
                            coreElectivesICount += (typeof parseCreditValue === 'function')
                                ? parseCreditValue(course.SU_credit || '0')
                                : (parseFloat(course.SU_credit || '0') || 0);
                        }
                    }
                }
                if (coreElectivesICount < 12) return 33;

                // Core Electives II (International Relations)
                let coreElectivesIICount = 0;
                const coreElectivesIIPool = ['CONF400', 'IR301', 'IR342', 'IR391', 'IR394', 'IR405', 'IR489', 'LAW311', 'POLS492'];
                for (let i = 0; i < this.semesters.length; i++) {
                    for (let a = 0; a < this.semesters[i].courses.length; a++) {
                        const course = this.semesters[i].courses[a];
                        const courseCode = course.code || ((course.Major || '') + (course.Code || ''));
                        if (coreElectivesIIPool.includes(courseCode)) {
                            coreElectivesIICount += (typeof parseCreditValue === 'function')
                                ? parseCreditValue(course.SU_credit || '0')
                                : (parseFloat(course.SU_credit || '0') || 0);
                        }
                    }
                }
                if (coreElectivesIICount < 12) return 34;
            }
        }
        else if(this.major == 'PSY')
        {
            // Generic checks apply
            {
                // Check Philosophy requirement
                let hasPhilosophy = this.hasCourse("PHIL300") || this.hasCourse("PHIL301");
                if (!hasPhilosophy) return 26;

                // Check faculty course requirements for PSY
                let facultyCoursesCount = 0;
                let fassCoursesCount = 0;
                let areasCount = new Set();

                for(let i = 0; i < this.semesters.length; i++) {
                    for(let a = 0; a < this.semesters[i].courses.length; a++) {
                        let course = this.semesters[i].courses[a];
                        // Count faculty courses using the new Faculty_Course attribute
                        if(course.Faculty_Course && course.Faculty_Course !== 'No') {
                            facultyCoursesCount++;

                            // Count FASS courses
                            if(course.Faculty_Course === "FASS") {
                                fassCoursesCount++;
                            }

                            // Track areas for PSY
                            if(course.code.startsWith("CULT")) areasCount.add("CULT");
                            else if(course.code.startsWith("ECON")) areasCount.add("ECON");
                            else if(course.code.startsWith("HART")) areasCount.add("HART");
                            else if(course.code.startsWith("PSY")) areasCount.add("PSYCH");
                            else if(course.code.startsWith("SPS") || course.code.startsWith("POLS") || course.code.startsWith("IR")) areasCount.add("SPS/POLS/IR");
                            else if(course.code.startsWith("VA")) areasCount.add("VA");
                            else if(course.Faculty_Course === "FENS") areasCount.add("FENS");
                            else if(course.Faculty_Course === "SBS") areasCount.add("SBS");
                        }
                    }
                }

                if(facultyCoursesCount < 5) return 14;
                if(fassCoursesCount < 3) return 15;
                if(areasCount.size < 3) return 18;
            }
        }
        else if(this.major == 'VACD')
        {
            // Generic checks apply
            {
                // Check faculty course requirements for VACD
                let facultyCoursesCount = 0;
                let fassCoursesCount = 0;
                let areasCount = new Set();

                for(let i = 0; i < this.semesters.length; i++) {
                    for(let a = 0; a < this.semesters[i].courses.length; a++) {
                        let course = this.semesters[i].courses[a];
                        // Count faculty courses using the new Faculty_Course attribute
                        if(course.Faculty_Course && course.Faculty_Course !== 'No') {
                            facultyCoursesCount++;

                            // Count FASS courses
                            if(course.Faculty_Course === "FASS") {
                                fassCoursesCount++;
                            }

                            // Track areas for VACD
                            if(course.code.startsWith("CULT")) areasCount.add("CULT");
                            else if(course.code.startsWith("ECON")) areasCount.add("ECON");
                            else if(course.code.startsWith("HART")) areasCount.add("HART");
                            else if(course.code.startsWith("PSY")) areasCount.add("PSYCH");
                            else if(course.code.startsWith("SPS") || course.code.startsWith("POLS") || course.code.startsWith("IR")) areasCount.add("SPS/POLS/IR");
                            else if(course.code.startsWith("VA")) areasCount.add("VA");
                            else if(course.Faculty_Course === "FENS") areasCount.add("FENS");
                            else if(course.Faculty_Course === "SBS") areasCount.add("SBS");
                        }
                    }
                }

                if(facultyCoursesCount < 5) return 14;
                if(fassCoursesCount < 3) return 15;
                if(areasCount.size < 3) return 18;

                // Core Electives I (Art/Design History Courses) for VACD
                let coreElectivesICount = 0;
                const coreElectivesIPool = ['HART292', 'HART293', 'HART380', 'HART413', 'HART426', 'VA315', 'VA420', 'VA430'];
                for (let i = 0; i < this.semesters.length; i++) {
                    for (let a = 0; a < this.semesters[i].courses.length; a++) {
                        const course = this.semesters[i].courses[a];
                        const courseCode = course.code || ((course.Major || '') + (course.Code || ''));
                        const eff = (course.effective_type || (course.category && course.category.toLowerCase()) || '').toLowerCase();
                        if (eff === 'core' && coreElectivesIPool.includes(courseCode)) {
                            coreElectivesICount += (typeof parseCreditValue === 'function')
                                ? parseCreditValue(course.SU_credit || '0')
                                : (parseFloat(course.SU_credit || '0') || 0);
                        }
                    }
                }
                if (coreElectivesICount < 9) return 30;

                // Core Electives II (Skill Courses) for VACD
                let coreElectivesIICount = 0;
                const coreElectivesIIPool = ['VA202', 'VA204', 'VA234', 'VA302', 'VA304', 'VA402', 'VA404'];
                const pairKeyByCode = {
                    VA302: 'VA302|VA304',
                    VA304: 'VA302|VA304',
                    VA402: 'VA402|VA404',
                    VA404: 'VA402|VA404',
                };
                const seenPairKeys = new Set();
                for (let i = 0; i < this.semesters.length; i++) {
                    for (let a = 0; a < this.semesters[i].courses.length; a++) {
                        const course = this.semesters[i].courses[a];
                        const courseCode = course.code || ((course.Major || '') + (course.Code || ''));
                        const eff = (course.effective_type || (course.category && course.category.toLowerCase()) || '').toLowerCase();
                        if (eff === 'core' && coreElectivesIIPool.includes(courseCode)) {
                            const pairKey = pairKeyByCode[courseCode];
                            if (pairKey) {
                                if (seenPairKeys.has(pairKey)) continue;
                                seenPairKeys.add(pairKey);
                            }
                            coreElectivesIICount += (typeof parseCreditValue === 'function')
                                ? parseCreditValue(course.SU_credit || '0')
                                : (parseFloat(course.SU_credit || '0') || 0);
                        }
                    }
                }
                if (coreElectivesIICount < 12) return 31;
            }
        }
        else if(this.major == 'DSA')
        {
            // Generic checks apply
            {
                // Check faculty course requirements for DSA
                let facultyCoursesCount = 0;
                let fensCoursesCount = 0;
                let fassCoursesCount = 0;
                let sbsCoursesCount = 0;

                for(let i = 0; i < this.semesters.length; i++) {
                    for(let a = 0; a < this.semesters[i].courses.length; a++) {
                        let course = this.semesters[i].courses[a];
                        // Count faculty courses using the new Faculty_Course attribute
                        if(course.Faculty_Course && course.Faculty_Course !== 'No') {
                            facultyCoursesCount++;

                            // Count courses by faculty
                            if(course.Faculty_Course === "FENS") {
                                fensCoursesCount++;
                            } else if(course.Faculty_Course === "FASS") {
                                fassCoursesCount++;
                            } else if(course.Faculty_Course === "SBS") {
                                sbsCoursesCount++;
                            }
                        }
                    }
                }

                if(facultyCoursesCount < 5) return 14;
                if(fensCoursesCount < 1) return 20;
                if(fassCoursesCount < 1) return 21;
                if(sbsCoursesCount < 1) return 22;

                // Check core electives requirements
                // At least 27 SU credits with at least 3 courses from each faculty
                let fensCoreCount = 0;
                let fassCoreCount = 0;
                let sbsCoreCount = 0;

                for(let i = 0; i < this.semesters.length; i++) {
                    for(let a = 0; a < this.semesters[i].courses.length; a++) {
                        let course = this.semesters[i].courses[a];
                        if(course.category === "Core") {
                            if(course.Faculty_Course === "FENS") {
                                fensCoreCount++;
                            } else if(course.Faculty_Course === "FASS") {
                                fassCoreCount++;
                            } else if(course.Faculty_Course === "SBS") {
                                sbsCoreCount++;
                            }
                        }
                    }
                }

                if(fensCoreCount < 3) return 27;
                if(fassCoreCount < 3) return 28;
                if(sbsCoreCount < 3) return 29;
            }
        }
        return 0; // No issues found, return 0
    }

    /**
     * Recalculate the effective category (core/area/free) for every course
     * across all semesters based on chronological order. The `terms` array
     * lists the most recent term first, so larger `termIndex` values represent
     * earlier semesters. This method therefore sorts semesters in descending
     * order of `termIndex` and then
     * allocates course credits to required, core, area and free categories
     * according to the major requirements. If the required requirement is
     * filled, additional required courses count toward the core requirement.
     * If the core requirement is then satisfied, overflow continues to the
     * area requirement and finally to free electives. Courses with static
     * type "university" are not reallocated. After reallocation, the semester
     * totals for required, core, area and free are updated accordingly and
     * each course's `.effective_type` field is set. The displayed course type
     * in the DOM (the `.course_type` element) is also updated to reflect the
     * effective category.
     *
     * @param {Array} course_data The full course data array for the current major.
     */
    this.recalcEffectiveTypes = function (course_data) {
        // Determine requirement thresholds for this major. If a requirement is
        // undefined (e.g., for non-engineering majors without a science
        // requirement), default to 0 so no credits are allocated to that
        // category.
        const req = getReq(this.major, this.entryTerm);
        const reqCore = req.core || 0;
        const reqArea = req.area || 0;
        const reqRequired = req.required || 0;

        // Before performing any lookups, attempt to find the `getInfo` helper
        // function. In a browser environment `getInfo` is declared in
        // helper_functions.js and becomes a property of the global `window`.
        // In the unlikely event that it cannot be found, we skip
        // reallocation since course information will be unavailable.
        const getInfoFn = (typeof getInfo === 'function') ? getInfo :
            ((typeof window !== 'undefined' && typeof window.getInfo === 'function') ? window.getInfo : null);
        if (!getInfoFn) {
            return;
        }


        // First reset totals for each semester. We will accumulate fresh values
        // below. Note: totalCredit is recomputed to avoid stale values.
        for (let i = 0; i < this.semesters.length; i++) {
            const sem = this.semesters[i];
            sem.totalCredit = 0;
            sem.totalArea = 0;
            sem.totalCore = 0;
            sem.totalFree = 0;
            sem.totalUniversity = 0;
            sem.totalRequired = 0;
            sem.totalScience = 0.0;
            sem.totalEngineering = 0.0;
            sem.totalECTS = 0.0;
            // We leave totalGPA and totalGPACredits untouched because they
            // depend on the user's recorded grades rather than the static type.
        }

        // Sort a copy of semesters chronologically based on the stored
        // `termIndex` property. The `terms` array is ordered most-recent
        // first, so larger indices represent earlier (older) semesters.
        // If `termIndex` is null/undefined (e.g., a semester without a valid
        // date), treat it as very small so it will be allocated last.
        const sortedSemesters = this.semesters.slice().sort((a, b) => {
            const idxA = (a.termIndex !== null && a.termIndex !== undefined) ? a.termIndex : -1;
            const idxB = (b.termIndex !== null && b.termIndex !== undefined) ? b.termIndex : -1;
            return idxB - idxA; // larger index = earlier term
        });

        // Running counters for how many credits have been allocated to required,
        // core and area so far. Once these exceed their requirements, we
        // allocate additional courses to the next category.
        let currentRequiredCredits = 0;
        let currentCoreCredits = 0;
        let currentAreaCredits = 0;
        // Special-case: for IE majors, if both DSA201 and CS201 are taken,
        // CS201 must always count towards core regardless of when it is
        // taken. Record the condition once so it can be applied inside the
        // allocation loop without repeated lookups.
        const forceCSCore = (
            this.major === 'IE' &&
            this.hasCourse('CS201') &&
            this.hasCourse('DSA201')
        );

        // Iterate semesters in chronological order
        for (let i = 0; i < sortedSemesters.length; i++) {
            const sem = sortedSemesters[i];
            // Iterate courses in the order they appear within the semester.
            for (let j = 0; j < sem.courses.length; j++) {
                const course = sem.courses[j];
                // Skip credit calculations for courses with grade F
                let gradeText = '';
                try {
                    const elem = document.getElementById(course.id);
                    if (elem) {
                        const gr = elem.querySelector('.grade');
                        gradeText = gr ? gr.textContent.trim() : '';
                    }
                } catch (_) {}
                if (gradeText === 'F') {
                    course.effective_type = 'none';
                    try {
                        const courseElem = document.getElementById(course.id);
                        if (courseElem) {
                            const typeElem = courseElem.querySelector('.course_type');
                            if (typeElem) typeElem.textContent = 'N/A';
                        }
                    } catch (_) {}
                    continue;
                }
                // Attempt to find course information in the primary major's
                // course_data.  We do this search ourselves rather than
                // relying on getInfo() because getInfo has been extended to
                // return details from the double major's catalog as well. If
                // the course is not found in the primary dataset, we treat
                // it as unknown for the main major (excluded from core/area
                // allocations) even if getInfo returns a valid object from
                // the double major.
                let infoMain = null;
                for (let ii = 0; ii < course_data.length; ii++) {
                    if ((course_data[ii]['Major'] + course_data[ii]['Code']) === course.code) {
                        infoMain = course_data[ii];
                        break;
                    }
                }
                // If the course was not found in the provided course_data, it
                // may be a custom course stored in localStorage.  Attempt to
                // retrieve the custom course list for the current major and
                // search for the matching code.
                if (!infoMain) {
                    try {
                        if (typeof localStorage !== 'undefined') {
                            const key = 'customCourses_' + this.major;
                            const ps = (typeof window !== 'undefined') ? window.planStorage : null;
                            const get = (k) => {
                                try { return ps ? ps.getItem(k) : localStorage.getItem(k); } catch (_) {}
                                try { return localStorage.getItem(k); } catch (_) {}
                                return null;
                            };
                            const stored = get(key);
                            if (stored) {
                                const parsed = JSON.parse(stored);
                                if (Array.isArray(parsed)) {
                                    for (let ci = 0; ci < parsed.length; ci++) {
                                        const cc = parsed[ci];
                                        if ((cc['Major'] + cc['Code']) === course.code) {
                                            infoMain = cc;
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                    } catch (_) {}
                }
                let credit, scienceVal, engVal, ectsVal, staticType;
                if (!infoMain) {
                    // Course does not exist in the main major's catalog.  Use
                    // properties from the course object (if set) or fall
                    // back to the double major's catalog to derive credit
                    // information.  These courses count towards total
                    // credits, science, engineering and ECTS but are not
                    // allocated to core/area/free categories for the main
                    // major.
                    // Attempt to find the course in the double major's
                    // catalog to obtain SU_credit, Basic_Science, etc.
                    let dmInfo = null;
                    try {
                        if (this.doubleMajor && Array.isArray(this.doubleMajorCourseData)) {
                            for (let di = 0; di < this.doubleMajorCourseData.length; di++) {
                                const dm = this.doubleMajorCourseData[di];
                                if ((dm['Major'] + dm['Code']) === course.code) {
                                    dmInfo = dm;
                                    break;
                                }
                            }
                        }
                    } catch (_) {}
                    // Determine credit values from dmInfo or course object
                    credit = 0;
                    scienceVal = 0;
                    engVal = 0;
                    ectsVal = 0;
                    if (dmInfo) {
                        credit = (typeof parseCreditValue === 'function')
                            ? parseCreditValue(dmInfo['SU_credit'] || '0')
                            : (parseFloat(dmInfo['SU_credit'] || '0') || 0);
                        scienceVal = parseFloat(dmInfo['Basic_Science'] || '0');
                        engVal = parseFloat(dmInfo['Engineering'] || '0');
                        ectsVal = parseFloat(dmInfo['ECTS'] || '0');
                    } else {
                        credit = (typeof parseCreditValue === 'function')
                            ? parseCreditValue(course.SU_credit || course.SU_credit || '0')
                            : (parseFloat(course.SU_credit || course.SU_credit || '0') || 0);
                        scienceVal = parseFloat(course.Basic_Science || '0');
                        engVal = parseFloat(course.Engineering || '0');
                        ectsVal = parseFloat(course.ECTS || '0');
                    }
                    sem.totalCredit += credit;
                    sem.totalScience += scienceVal;
                    sem.totalEngineering += engVal;
                    sem.totalECTS += ectsVal;
                    course.effective_type = 'none';
                    // Populate course attributes for unknown courses from dmInfo or course
                    // This ensures faculty and science/engineering credits persist
                    course.Basic_Science = scienceVal;
                    course.Engineering = engVal;
                    course.SU_credit = credit;
                    course.ECTS = ectsVal;
                    course.Faculty_Course = (dmInfo && dmInfo['Faculty_Course']) ? dmInfo['Faculty_Course'] : (course.Faculty_Course || 'No');
                    // Update DOM label to N/A
                    try {
                        const courseElem = document.getElementById(course.id);
                        if (courseElem) {
                            const typeElem = courseElem.querySelector('.course_type');
                            if (typeElem) {
                                typeElem.textContent = 'N/A';
                            }
                        }
                    } catch (_) {}
                    continue;
                }
                // Use information from the main major catalog
                staticType = (infoMain['EL_Type'] || '').toLowerCase();
                credit = (typeof parseCreditValue === 'function')
                    ? parseCreditValue(infoMain['SU_credit'] || '0')
                    : (parseFloat(infoMain['SU_credit'] || '0') || 0);
                scienceVal = parseFloat(infoMain['Basic_Science'] || '0');
                engVal = parseFloat(infoMain['Engineering'] || '0');
                ectsVal = parseFloat(infoMain['ECTS'] || '0');

                // Populate course attributes from main catalog.  Assign
                // these fields directly so that faculty course counts
                // and science/engineering credits persist across reloads.
                course.Basic_Science = scienceVal;
                course.Engineering = engVal;
                course.SU_credit = credit;
                course.ECTS = ectsVal;
                course.Faculty_Course = infoMain['Faculty_Course'] || 'No';

                // Update generic totals (credits, science, engineering, ECTS)
                sem.totalCredit += credit;
                sem.totalScience += scienceVal;
                sem.totalEngineering += engVal;
                sem.totalECTS += ectsVal;

                // Assign category to the course for major-specific checks.  Use
                // capitalized form (e.g., "Core", "Area", etc.).  This
                // property is consumed by checks such as EE 400-level core
                // requirements in canGraduate() and canGraduateDouble().
                if (staticType) {
                    course.category = staticType.charAt(0).toUpperCase() + staticType.slice(1);
                }

                let effectiveType = staticType;
                // Core, area and required types may be reallocated based on
                // remaining credit needs. University types remain unchanged.
                if (forceCSCore && course.code === 'CS201') {
                    // Always allocate CS201 to core when the special IE
                    // condition is met.
                    effectiveType = 'core';
                    currentCoreCredits += credit;
                } else if (staticType === 'core') {
                    if (currentCoreCredits < reqCore) {
                        effectiveType = 'core';
                        currentCoreCredits += credit;
                    } else if (currentAreaCredits < reqArea) {
                        effectiveType = 'area';
                        currentAreaCredits += credit;
                    } else {
                        effectiveType = 'free';
                    }
                } else if (staticType === 'area') {
                    if (currentAreaCredits < reqArea) {
                        effectiveType = 'area';
                        currentAreaCredits += credit;
                    } else {
                        effectiveType = 'free';
                    }
                } else if (staticType === 'required') {
                    if (currentRequiredCredits < reqRequired) {
                        effectiveType = 'required';
                        currentRequiredCredits += credit;
                    } else if (currentCoreCredits < reqCore) {
                        effectiveType = 'core';
                        currentCoreCredits += credit;
                    } else if (currentAreaCredits < reqArea) {
                        effectiveType = 'area';
                        currentAreaCredits += credit;
                    } else {
                        effectiveType = 'free';
                    }
                } else if (staticType === 'free') {
                    effectiveType = 'free';
                } else {
                    // Types like 'university' remain unchanged and are not
                    // reallocated.
                    effectiveType = staticType;
                }
                // Persist the effective type on the course object
                course.effective_type = effectiveType;

                // Update semester category totals based on the effective type.
                if (effectiveType === 'core') {
                    sem.totalCore += credit;
                } else if (effectiveType === 'area') {
                    sem.totalArea += credit;
                } else if (effectiveType === 'free') {
                    sem.totalFree += credit;
                } else if (effectiveType === 'university') {
                    sem.totalUniversity += credit;
                } else if (effectiveType === 'required') {
                    sem.totalRequired += credit;
                }

                // Update the course type displayed in the DOM if possible. The
                // course element has id equal to course.id (e.g., 'c3'). It
                // contains a child with class 'course_type' that shows the
                // static type. We update its text content to reflect the
                // effective type. If the element does not exist (e.g., during
                // server-side tests), this call will silently fail.
                try {
                    const courseElem = document.getElementById(course.id);
                    if (courseElem) {
                        const typeElem = courseElem.querySelector('.course_type');
                        if (typeElem) {
                            typeElem.textContent = effectiveType.toUpperCase();
                            try {
                                const base = (staticType || '').toLowerCase();
                                const eff = (effectiveType || '').toLowerCase();
                                const movedDown = !!(base && eff && base !== eff && eff !== 'none');
                                typeElem.classList.toggle('is-overflow-type', movedDown);
                            } catch (_) {}
                        }
                    }
                } catch (err) {
                    // Ignore DOM errors in non-browser contexts
                }
            }
        }

        // Special-case CS: math course exclusions/alternatives.
        // - Pre-2025 admits: only ONE of MATH212 or MATH201 counts toward any pool.
        //   If both are completed, the extra one should not be included in core/area/free pools.
        // - 2025–2026 admits and later: MATH201 and MATH202 are not included in any course pool.
        if (this.major === 'CS') {
            const entry = parseInt(this.entryTerm || '0', 10);
            const is2025Plus = !isNaN(entry) && entry >= 202501;

            const clamp0 = (n) => (n < 0 ? 0 : n);
            const parseInt0 = (v) => {
                const n = parseInt(v || '0', 10);
                return isNaN(n) ? 0 : n;
            };
            const parseFloat0 = (v) => {
                const n = parseFloat(v || '0');
                return isNaN(n) ? 0 : n;
            };
            const setCourseTypeLabel = (course, label) => {
                try {
                    const courseElem = document.getElementById(course.id);
                    if (!courseElem) return;
                    const typeElem = courseElem.querySelector('.course_type');
                    if (typeElem) typeElem.textContent = label;
                } catch (_) {}
            };
            const excludeCourse = (sem, course) => {
                if (!sem || !course) return;
                const credit = parseInt0(course.SU_credit);
                const scienceVal = parseFloat0(course.Basic_Science);
                const engVal = parseFloat0(course.Engineering);
                const ectsVal = parseFloat0(course.ECTS);

                // Remove previously-counted contributions (the allocation loop already added these).
                sem.totalCredit = clamp0(sem.totalCredit - credit);
                sem.totalScience = clamp0(sem.totalScience - scienceVal);
                sem.totalEngineering = clamp0(sem.totalEngineering - engVal);
                sem.totalECTS = clamp0(sem.totalECTS - ectsVal);

                const et = course.effective_type;
                if (et === 'core') sem.totalCore = clamp0(sem.totalCore - credit);
                else if (et === 'area') sem.totalArea = clamp0(sem.totalArea - credit);
                else if (et === 'free') sem.totalFree = clamp0(sem.totalFree - credit);
                else if (et === 'required') sem.totalRequired = clamp0(sem.totalRequired - credit);
                else if (et === 'university') sem.totalUniversity = clamp0(sem.totalUniversity - credit);

                course.effective_type = 'none';
                setCourseTypeLabel(course, 'N/A');
            };

            const math201 = [];
            const math202 = [];
            const math212 = [];
            for (let i = 0; i < sortedSemesters.length; i++) {
                const sem = sortedSemesters[i];
                for (let j = 0; j < sem.courses.length; j++) {
                    const course = sem.courses[j];
                    if (!course) continue;
                    if (course.effective_type === 'none') continue;
                    if (course.code === 'MATH201') math201.push({ sem, course });
                    else if (course.code === 'MATH202') math202.push({ sem, course });
                    else if (course.code === 'MATH212') math212.push({ sem, course });
                }
            }

            if (is2025Plus) {
                for (let i = 0; i < math201.length; i++) excludeCourse(math201[i].sem, math201[i].course);
                for (let i = 0; i < math202.length; i++) excludeCourse(math202[i].sem, math202[i].course);
            } else {
                // If both are present, exclude MATH201 (MATH212 is the primary path).
                if (math201.length > 0 && math212.length > 0) {
                    for (let i = 0; i < math201.length; i++) excludeCourse(math201[i].sem, math201[i].course);
                }
            }
        }

        // Special-case VACD: enforce mutually-exclusive pairs and pool spillover
        // rules. Some VACD course pools have the constraint that only one of a
        // course pair counts toward the minimum pool requirement. Extra courses
        // taken from the pool should spill into area electives, and then free
        // electives once area is satisfied.
        if (this.major === 'VACD') {
            const reqPairs = [['VA301', 'VA303'], ['VA401', 'VA403'], ['VA300', 'PROJ300']];
            const corePool1 = ['HART292', 'HART293', 'HART380', 'HART413', 'HART426', 'VA315', 'VA420', 'VA430'];
            const corePool1Min = 9;
            const corePool2 = ['VA202', 'VA204', 'VA234', 'VA302', 'VA304', 'VA402', 'VA404'];
            const corePool2Min = 12;
            const corePool2Pairs = [['VA302', 'VA304'], ['VA402', 'VA404']];

            const corePool1Set = new Set(corePool1);
            const corePool2Set = new Set(corePool2);
            const reqPairKeyByCode = {};
            for (let i = 0; i < reqPairs.length; i++) {
                const key = reqPairs[i].join('|');
                reqPairKeyByCode[reqPairs[i][0]] = key;
                reqPairKeyByCode[reqPairs[i][1]] = key;
            }
            const corePairKeyByCode = {};
            for (let i = 0; i < corePool2Pairs.length; i++) {
                const key = corePool2Pairs[i].join('|');
                corePairKeyByCode[corePool2Pairs[i][0]] = key;
                corePairKeyByCode[corePool2Pairs[i][1]] = key;
            }

            function creditOf(course) {
                return (typeof parseCreditValue === 'function')
                    ? parseCreditValue(course.SU_credit || '0')
                    : (parseFloat(course.SU_credit || '0') || 0);
            }

            // Choose a single course from each required pair to count as required.
            // If both are taken, the extra counts as free elective (it should not
            // double-count toward the required pool).
            const chosenRequiredPairKeys = new Set();
            for (let i = 0; i < sortedSemesters.length; i++) {
                const sem = sortedSemesters[i];
                for (let j = 0; j < sem.courses.length; j++) {
                    const course = sem.courses[j];
                    if (!course || !course.id) continue;
                    if (course.effective_type === 'none') continue;
                    const key = reqPairKeyByCode[course.code];
                    if (!key) continue;
                    if (!chosenRequiredPairKeys.has(key)) {
                        chosenRequiredPairKeys.add(key);
                        course.effective_type = 'required';
                    } else {
                        course.effective_type = 'free';
                    }
                }
            }

            // Select core courses for the two core elective pools, respecting
            // mutually-exclusive pairs in corePool2.
            const selectedCoreIds = new Set();
            const selectedCorePool2PairKeys = new Set();
            let pool1Credits = 0;
            let pool2Credits = 0;
            const overflowPoolCourses = [];

            for (let i = 0; i < sortedSemesters.length; i++) {
                const sem = sortedSemesters[i];
                for (let j = 0; j < sem.courses.length; j++) {
                    const course = sem.courses[j];
                    if (!course || !course.id) continue;
                    if (course.effective_type === 'none') continue;
                    const code = course.code;
                    if (corePool1Set.has(code)) {
                        if (pool1Credits < corePool1Min) {
                            selectedCoreIds.add(course.id);
                            pool1Credits += creditOf(course);
                        } else {
                            overflowPoolCourses.push(course);
                        }
                    } else if (corePool2Set.has(code)) {
                        const pairKey = corePairKeyByCode[code] || null;
                        if (pool2Credits < corePool2Min && (!pairKey || !selectedCorePool2PairKeys.has(pairKey))) {
                            selectedCoreIds.add(course.id);
                            pool2Credits += creditOf(course);
                            if (pairKey) selectedCorePool2PairKeys.add(pairKey);
                        } else {
                            overflowPoolCourses.push(course);
                        }
                    }
                }
            }

            // Compute how many area credits are still needed, excluding pool
            // overflow courses which will fill area first.
            let baseAreaCredits = 0;
            for (let i = 0; i < this.semesters.length; i++) {
                const sem = this.semesters[i];
                for (let j = 0; j < sem.courses.length; j++) {
                    const course = sem.courses[j];
                    if (!course || course.effective_type === 'none') continue;
                    const code = course.code;
                    if (corePool1Set.has(code) || corePool2Set.has(code)) continue;
                    if (course.effective_type === 'area') {
                        baseAreaCredits += creditOf(course);
                    }
                }
            }
            let areaRemaining = Math.max(0, reqArea - baseAreaCredits);

            // Apply the VACD pool allocation: selected pool courses count as core;
            // pool overflow counts as area then free.
            for (let i = 0; i < this.semesters.length; i++) {
                const sem = this.semesters[i];
                for (let j = 0; j < sem.courses.length; j++) {
                    const course = sem.courses[j];
                    if (!course || !course.id) continue;
                    if (course.effective_type === 'none') continue;
                    const code = course.code;
                    if (!corePool1Set.has(code) && !corePool2Set.has(code)) continue;
                    if (selectedCoreIds.has(course.id)) {
                        course.effective_type = 'core';
                    }
                }
            }
            for (let i = 0; i < overflowPoolCourses.length; i++) {
                const course = overflowPoolCourses[i];
                if (!course || course.effective_type === 'none') continue;
                if (areaRemaining > 0) {
                    course.effective_type = 'area';
                    areaRemaining -= creditOf(course);
                } else {
                    course.effective_type = 'free';
                }
            }

            // Recompute semester category totals to match VACD normalized effective types.
            for (let i = 0; i < this.semesters.length; i++) {
                const sem = this.semesters[i];
                sem.totalArea = 0;
                sem.totalCore = 0;
                sem.totalFree = 0;
                sem.totalUniversity = 0;
                sem.totalRequired = 0;
                for (let j = 0; j < sem.courses.length; j++) {
                    const course = sem.courses[j];
                    if (!course) continue;
                    const et = course.effective_type;
                    if (!et || et === 'none') continue;
                    const c = creditOf(course);
                    if (et === 'core') sem.totalCore += c;
                    else if (et === 'area') sem.totalArea += c;
                    else if (et === 'free') sem.totalFree += c;
                    else if (et === 'required') sem.totalRequired += c;
                    else if (et === 'university') sem.totalUniversity += c;
                }
            }

            // Update DOM type labels for VACD normalization.
            try {
                for (let i = 0; i < this.semesters.length; i++) {
                    const sem = this.semesters[i];
                    for (let j = 0; j < sem.courses.length; j++) {
                        const course = sem.courses[j];
                        if (!course || !course.id) continue;
                        const courseElem = document.getElementById(course.id);
                        if (!courseElem) continue;
                        const typeElem = courseElem.querySelector('.course_type');
                        if (typeElem && course.effective_type) {
                            typeElem.textContent = course.effective_type.toUpperCase();
                            try {
                                const base = (course.category || '').toString().toLowerCase();
                                const eff = (course.effective_type || '').toString().toLowerCase();
                                const movedDown = !!(base && eff && base !== eff && eff !== 'none');
                                typeElem.classList.toggle('is-overflow-type', movedDown);
                            } catch (_) {}
                        }
                    }
                }
            } catch (_) {}
        }

        // Special-case MAN: core/area electives have additional "at least one
        // from each area" constraints, and extra core electives can be counted
        // as area electives. The generic credit-threshold allocator may place
        // a required area-prefix core elective into area/free, causing the
        // MAN-specific checks to fail even though a feasible assignment exists.
        //
        // Normalize MAN elective effective types after the generic pass by
        // selecting a subset of static core electives to count as core that
        // covers all required prefixes, and pushing duplicates/overflow into
        // area/free to satisfy area elective rules.
        if (this.major === 'MAN') {
            const corePrefixes = ['ACC', 'FIN', 'MGMT', 'MKTG', 'OPIM', 'ORG'];
            const areaPrefixes = ['ACC', 'FIN', 'MKTG', 'OPIM', 'ORG'];

            function firstMatchingPrefix(code, prefixes) {
                for (let i = 0; i < prefixes.length; i++) {
                    if (code.startsWith(prefixes[i])) return prefixes[i];
                }
                return null;
            }

            // Gather elective candidates in chronological order (sortedSemesters
            // is already chronological as used in the allocation loop).
            const electiveItems = [];
            for (let i = 0; i < sortedSemesters.length; i++) {
                const sem = sortedSemesters[i];
                for (let j = 0; j < sem.courses.length; j++) {
                    const course = sem.courses[j];
                    if (!course || !course.id) continue;
                    if (course.effective_type === 'none') continue;
                    if (course.category !== 'Core' && course.category !== 'Area') continue;
                    const credit = (typeof parseCreditValue === 'function')
                        ? parseCreditValue(course.SU_credit || '0')
                        : (parseFloat(course.SU_credit || '0') || 0);
                    electiveItems.push({
                        id: course.id,
                        code: course.code,
                        staticType: (course.category || '').toLowerCase(),
                        credit: isNaN(credit) ? 0 : credit,
                        courseRef: course,
                    });
                }
            }

            const reqCoreMan = reqCore;
            const reqAreaMan = reqArea;

            const coreCandidates = electiveItems.filter(it => it.staticType === 'core');
            const selectedCore = new Set();
            const coreByPrefix = {};
            for (let i = 0; i < coreCandidates.length; i++) {
                const it = coreCandidates[i];
                const prefix = firstMatchingPrefix(it.code, corePrefixes);
                if (!prefix) continue;
                if (!coreByPrefix[prefix]) coreByPrefix[prefix] = [];
                coreByPrefix[prefix].push(it);
            }
            let coreCredits = 0;
            for (let i = 0; i < corePrefixes.length; i++) {
                const p = corePrefixes[i];
                const bucket = coreByPrefix[p] || [];
                if (bucket.length) {
                    const pick = bucket[0];
                    if (!selectedCore.has(pick.id)) {
                        selectedCore.add(pick.id);
                        coreCredits += pick.credit;
                    }
                }
            }
            for (let i = 0; i < coreCandidates.length && coreCredits < reqCoreMan; i++) {
                const it = coreCandidates[i];
                if (selectedCore.has(it.id)) continue;
                selectedCore.add(it.id);
                coreCredits += it.credit;
            }

            // Area candidates include static area electives plus overflow core
            // electives not selected as core.
            const areaCandidates = electiveItems
                .filter(it => it.staticType === 'area')
                .concat(coreCandidates.filter(it => !selectedCore.has(it.id)));

            const selectedArea = new Set();
            const areaByPrefix = {};
            for (let i = 0; i < areaCandidates.length; i++) {
                const it = areaCandidates[i];
                const prefix = firstMatchingPrefix(it.code, areaPrefixes);
                if (!prefix) continue;
                if (!areaByPrefix[prefix]) areaByPrefix[prefix] = [];
                areaByPrefix[prefix].push(it);
            }
            let areaCredits = 0;
            for (let i = 0; i < areaPrefixes.length; i++) {
                const p = areaPrefixes[i];
                const bucket = areaByPrefix[p] || [];
                if (bucket.length) {
                    const pick = bucket[0];
                    if (!selectedArea.has(pick.id) && !selectedCore.has(pick.id)) {
                        selectedArea.add(pick.id);
                        areaCredits += pick.credit;
                    }
                }
            }
            for (let i = 0; i < areaCandidates.length && areaCredits < reqAreaMan; i++) {
                const it = areaCandidates[i];
                if (selectedCore.has(it.id) || selectedArea.has(it.id)) continue;
                selectedArea.add(it.id);
                areaCredits += it.credit;
            }

            // Apply normalized effective types for elective items only.
            for (let i = 0; i < electiveItems.length; i++) {
                const it = electiveItems[i];
                if (selectedCore.has(it.id)) {
                    it.courseRef.effective_type = 'core';
                } else if (selectedArea.has(it.id)) {
                    it.courseRef.effective_type = 'area';
                } else {
                    it.courseRef.effective_type = 'free';
                }
            }

            // Recompute semester category totals (core/area/free/required/university)
            // to match normalized MAN effective types. totalCredit/science/eng/ECTS
            // remain correct and are not recomputed here.
            for (let i = 0; i < this.semesters.length; i++) {
                const sem = this.semesters[i];
                sem.totalArea = 0;
                sem.totalCore = 0;
                sem.totalFree = 0;
                sem.totalUniversity = 0;
                sem.totalRequired = 0;
                for (let j = 0; j < sem.courses.length; j++) {
                    const course = sem.courses[j];
                    if (!course) continue;
                    const et = course.effective_type;
                    if (!et || et === 'none') continue;
                    const c = (typeof parseCreditValue === 'function')
                        ? parseCreditValue(course.SU_credit || '0')
                        : (parseFloat(course.SU_credit || '0') || 0);
                    if (et === 'core') sem.totalCore += c;
                    else if (et === 'area') sem.totalArea += c;
                    else if (et === 'free') sem.totalFree += c;
                    else if (et === 'required') sem.totalRequired += c;
                    else if (et === 'university') sem.totalUniversity += c;
                }
            }

            // Update DOM type label for MAN elective normalization (skip if not present).
            try {
                for (let i = 0; i < this.semesters.length; i++) {
                    const sem = this.semesters[i];
                    for (let j = 0; j < sem.courses.length; j++) {
                        const course = sem.courses[j];
                        if (!course || !course.id) continue;
                        const courseElem = document.getElementById(course.id);
                        if (!courseElem) continue;
                        const typeElem = courseElem.querySelector('.course_type');
                        if (typeElem && course.effective_type) {
                            typeElem.textContent = course.effective_type.toUpperCase();
                            try {
                                const base = (course.category || '').toString().toLowerCase();
                                const eff = (course.effective_type || '').toString().toLowerCase();
                                const movedDown = !!(base && eff && base !== eff && eff !== 'none');
                                typeElem.classList.toggle('is-overflow-type', movedDown);
                            } catch (_) {}
                        }
                    }
                }
            } catch (_) {}
        }
        // After reallocation, update the displayed total credits for each
        // semester in the user interface. Each semester element has an id
        // (e.g., 's1') and resides within a container with class
        // 'container_semester' which contains a span showing the total.
        try {
            for (let i = 0; i < this.semesters.length; i++) {
                const sem = this.semesters[i];
                const semElem = document.getElementById(sem.id);
                if (semElem) {
                    // Traverse up to the nearest container_semester
                    let containerElem = semElem.closest && semElem.closest('.container_semester');
                    if (!containerElem) {
                        // Fallback manual traversal if closest isn't available
                        let parent = semElem.parentNode;
                        while (parent && !parent.classList.contains('container_semester')) {
                            parent = parent.parentNode;
                        }
                        containerElem = parent;
                    }
                    if (containerElem) {
                        const span = containerElem.querySelector('.total_credit_text span');
                        if (span) {
                            span.innerHTML = 'Total: ' + sem.totalCredit + ' credits';
                            try {
                                span.classList.toggle('is-overlimit', (sem.totalCredit || 0) > 20);
                            } catch (_) {}
                        }
                    }
                }
            }
        } catch (err) {
            // Ignore DOM errors in non-browser contexts
        }

        // If a double major is active on this curriculum, trigger
        // recalculation of effective types for the second major using
        // whatever course data array has been stored on the
        // curriculum instance.  This ensures that DM categories are
        // updated whenever the primary allocation runs (e.g., after
        // adding or removing courses/semesters).
        try {
            if (this.doubleMajor && Array.isArray(this.doubleMajorCourseData)) {
                this.recalcEffectiveTypesDouble(this.doubleMajorCourseData);
            }
        } catch (ex) {
            // ignore errors if DM recalc fails
        }

        // After DM recalculation, update the course selection datalist to
        // include any DM-only courses.  This requires a global helper
        // exposed on window.  We wrap in try to avoid errors when the
        // helper is not defined.
        try {
            if (typeof window !== 'undefined' && typeof window.updateDatalistForDoubleMajor === 'function') {
                window.updateDatalistForDoubleMajor();
            }
        } catch (_) {}
    };

    /**
     * Recalculate the effective category for every course across all
     * semesters for the selected double major. This mirrors
     * recalcEffectiveTypes() but uses the second major's requirements and
     * its own course catalog (provided via course_data_dm) to determine
     * whether a course counts toward required, core, area, or free credits.
     * Surplus required courses spill over to core, then area, then free.
     * The results are stored on each course object under the
     * `.effective_type_dm` property, and per-semester totals are kept in
     * `sem.totalCoreDM`, `sem.totalAreaDM`, `sem.totalFreeDM` and
     * `sem.totalRequiredDM`.
     *
     * If no double major is selected (this.doubleMajor is falsy), the
     * function returns immediately without making changes.
     *
     * @param {Array} course_data_dm The course catalog for the double major
     */
    this.recalcEffectiveTypesDouble = function(course_data_dm) {
        if (!this.doubleMajor) return;
        // Determine requirement thresholds for the double major. Required,
        // core and area requirements are drawn from the second major's
        // requirements.
        const dmReq = getReq(this.doubleMajor, this.entryTermDM);
        const dmCoreReq = dmReq.core || 0;
        const dmAreaReq = dmReq.area || 0;
        const dmReqRequired = dmReq.required || 0;
        // Acquire the getInfo helper.  If unavailable, skip processing.
        const getInfoFnDM = (typeof getInfo === 'function') ? getInfo :
            ((typeof window !== 'undefined' && typeof window.getInfo === 'function') ? window.getInfo : null);
        if (!getInfoFnDM) return;
        // Initialize running counters for DM allocations.
        let currentDMRequired = 0;
        let currentDMCores = 0;
        let currentDMAreas = 0;
        // For IE as a double major, ensure CS201 always counts as core when
        // both CS201 and DSA201 are present. Capture the condition once here
        // so the allocation loop can enforce it deterministically regardless
        // of course order.
        const dmForceCSCore = (
            this.doubleMajor === 'IE' &&
            this.hasCourse('CS201') &&
            this.hasCourse('DSA201')
        );
        // Reset per-semester DM totals.  In addition to core/area/free, we
        // maintain separate totals for required and university courses for
        // the double major so that summary and graduation checks can
        // correctly count these categories even when the course does not
        // exist in the primary major.  We also initialize DM science,
        // engineering and ECTS totals although those are currently reused
        // from the primary allocation.
        for (let i = 0; i < this.semesters.length; i++) {
            const sem = this.semesters[i];
            sem.totalCoreDM = 0;
            sem.totalAreaDM = 0;
            sem.totalFreeDM = 0;
            // Required and university totals for DM
            sem.totalRequiredDM = 0;
            sem.totalUniversityDM = 0;
            // Science/engineering/ECTS DM totals can be derived from main totals,
            // but initialize them here in case future logic requires separate
            // tracking.
            sem.totalScienceDM = 0;
            sem.totalEngineeringDM = 0;
            sem.totalECTSDM = 0;
        }
        // Sort semesters chronologically by termIndex (larger index = earlier).
        // If a semester has no valid termIndex, allocate it last.
        const sorted = this.semesters.slice().sort((a, b) => {
            const aIdx = (a.termIndex !== null && a.termIndex !== undefined) ? a.termIndex : -1;
            const bIdx = (b.termIndex !== null && b.termIndex !== undefined) ? b.termIndex : -1;
            return bIdx - aIdx;
        });
        // Walk semesters and courses allocating DM categories
        for (let i = 0; i < sorted.length; i++) {
            const sem = sorted[i];
            for (let j = 0; j < sem.courses.length; j++) {
                const course = sem.courses[j];
                let gradeText = '';
                try {
                    const elem = document.getElementById(course.id);
                    if (elem) {
                        const gr = elem.querySelector('.grade');
                        gradeText = gr ? gr.textContent.trim() : '';
                    }
                } catch (_) {}
                if (gradeText === 'F') {
                    course.effective_type_dm = 'none';
                    continue;
                }
                let info = getInfoFnDM(course.code, course_data_dm);
                // If the course is not present in the fetched double major
                // catalog, check localStorage for a custom course definition
                // under `customCourses_<doubleMajor>`.
                if (!info) {
                    try {
                        if (typeof localStorage !== 'undefined') {
                            const keyDM = 'customCourses_' + this.doubleMajor;
                            const ps = (typeof window !== 'undefined') ? window.planStorage : null;
                            const get = (k) => {
                                try { return ps ? ps.getItem(k) : localStorage.getItem(k); } catch (_) {}
                                try { return localStorage.getItem(k); } catch (_) {}
                                return null;
                            };
                            const storedDM = get(keyDM);
                            if (storedDM) {
                                const parsedDM = JSON.parse(storedDM);
                                if (Array.isArray(parsedDM)) {
                                    for (let ci = 0; ci < parsedDM.length; ci++) {
                                        const cc = parsedDM[ci];
                                        if ((cc['Major'] + cc['Code']) === course.code) {
                                            info = cc;
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                    } catch (_) {}
                }
                let dmType = 'free';
                let credit = 0;
                let dmStaticType = '';
                // Clear previously cached DM category before recalculating.
                delete course.categoryDM;
                if (info) {
                    dmStaticType = (info['EL_Type'] || '').toLowerCase();
                    if (dmStaticType) {
                        course.categoryDM = dmStaticType.charAt(0).toUpperCase() + dmStaticType.slice(1);
                    }
                    credit = (typeof parseCreditValue === 'function')
                        ? parseCreditValue(info['SU_credit'] || '0')
                        : (parseFloat(info['SU_credit'] || '0') || 0);
                    dmType = dmStaticType;
                    if (dmForceCSCore && course.code === 'CS201') {
                        dmType = 'core';
                        currentDMCores += credit;
                    } else if (dmStaticType === 'core') {
                        if (currentDMCores < dmCoreReq) {
                            dmType = 'core';
                            currentDMCores += credit;
                        } else if (currentDMAreas < dmAreaReq) {
                            dmType = 'area';
                            currentDMAreas += credit;
                        } else {
                            dmType = 'free';
                        }
                    } else if (dmStaticType === 'area') {
                        if (currentDMAreas < dmAreaReq) {
                            dmType = 'area';
                            currentDMAreas += credit;
                        } else {
                            dmType = 'free';
                        }
                    } else if (dmStaticType === 'required') {
                        if (currentDMRequired < dmReqRequired) {
                            dmType = 'required';
                            currentDMRequired += credit;
                        } else if (currentDMCores < dmCoreReq) {
                            dmType = 'core';
                            currentDMCores += credit;
                        } else if (currentDMAreas < dmAreaReq) {
                            dmType = 'area';
                            currentDMAreas += credit;
                        } else {
                            dmType = 'free';
                        }
                    } else if (dmStaticType === 'free') {
                        dmType = 'free';
                    } else if (dmStaticType === 'university') {
                        // University courses remain as is.
                        dmType = 'university';
                    }
                } else {
                    // Unknown course in the double major catalog: do not
                    // allocate it to any DM category. Still count its credit
                    // values for science/engineering/ECTS tracking.
                    credit = (typeof parseCreditValue === 'function')
                        ? parseCreditValue(course.SU_credit || course.SU_credit || '0')
                        : (parseFloat(course.SU_credit || course.SU_credit || '0') || 0);
                    dmType = 'none';
                    dmStaticType = 'none';
                    delete course.categoryDM;
                }
                // Assign DM effective type
                course.effective_type_dm = dmType;
                // Accumulate per-semester DM totals.  Include required
                // and university categories.
                if (dmType === 'core') {
                    sem.totalCoreDM += credit;
                } else if (dmType === 'area') {
                    sem.totalAreaDM += credit;
                } else if (dmType === 'free') {
                    sem.totalFreeDM += credit;
                } else if (dmType === 'required') {
                    sem.totalRequiredDM += credit;
                } else if (dmType === 'university') {
                    sem.totalUniversityDM += credit;
                }
                // Science/engineering/ECTS totals for DM reuse the same values
                // as the main major because they are inherent course
                // attributes.  Accumulate them so that DM summary can
                // optionally display separate DM science/engineering/ECTS.
                if (info) {
                    sem.totalScienceDM += parseFloat(info['Basic_Science'] || '0');
                    sem.totalEngineeringDM += parseFloat(info['Engineering'] || '0');
                    sem.totalECTSDM += parseFloat(info['ECTS'] || '0');
                } else {
                    sem.totalScienceDM += parseFloat(course.Basic_Science || '0');
                    sem.totalEngineeringDM += parseFloat(course.Engineering || '0');
                    sem.totalECTSDM += parseFloat(course.ECTS || '0');
                }
            }
        }

        // Special-case MAN double major: normalize core/area elective effective
        // types to satisfy the per-area constraints while still allowing extra
        // core electives to count as area electives.
        if (this.doubleMajor === 'MAN') {
            const corePrefixes = ['ACC', 'FIN', 'MGMT', 'MKTG', 'OPIM', 'ORG'];
            const areaPrefixes = ['ACC', 'FIN', 'MKTG', 'OPIM', 'ORG'];
            function firstMatchingPrefix(code, prefixes) {
                for (let i = 0; i < prefixes.length; i++) {
                    if (code.startsWith(prefixes[i])) return prefixes[i];
                }
                return null;
            }

            const dmElectiveItems = [];
            for (let i = 0; i < sorted.length; i++) {
                const sem = sorted[i];
                for (let j = 0; j < sem.courses.length; j++) {
                    const course = sem.courses[j];
                    if (!course || !course.id) continue;
                    if (course.effective_type_dm === 'none') continue;
                    if (course.categoryDM !== 'Core' && course.categoryDM !== 'Area') continue;
                    const credit = (typeof parseCreditValue === 'function')
                        ? parseCreditValue(course.SU_credit || '0')
                        : (parseFloat(course.SU_credit || '0') || 0);
                    dmElectiveItems.push({
                        id: course.id,
                        code: course.code,
                        staticType: (course.categoryDM || '').toLowerCase(),
                        credit: isNaN(credit) ? 0 : credit,
                        courseRef: course,
                    });
                }
            }

            const dmCoreCandidates = dmElectiveItems.filter(it => it.staticType === 'core');
            const dmSelectedCore = new Set();
            const dmCoreByPrefix = {};
            for (let i = 0; i < dmCoreCandidates.length; i++) {
                const it = dmCoreCandidates[i];
                const prefix = firstMatchingPrefix(it.code, corePrefixes);
                if (!prefix) continue;
                if (!dmCoreByPrefix[prefix]) dmCoreByPrefix[prefix] = [];
                dmCoreByPrefix[prefix].push(it);
            }
            let dmCoreCredits = 0;
            for (let i = 0; i < corePrefixes.length; i++) {
                const p = corePrefixes[i];
                const bucket = dmCoreByPrefix[p] || [];
                if (bucket.length) {
                    const pick = bucket[0];
                    if (!dmSelectedCore.has(pick.id)) {
                        dmSelectedCore.add(pick.id);
                        dmCoreCredits += pick.credit;
                    }
                }
            }
            for (let i = 0; i < dmCoreCandidates.length && dmCoreCredits < dmCoreReq; i++) {
                const it = dmCoreCandidates[i];
                if (dmSelectedCore.has(it.id)) continue;
                dmSelectedCore.add(it.id);
                dmCoreCredits += it.credit;
            }

            const dmAreaCandidates = dmElectiveItems
                .filter(it => it.staticType === 'area')
                .concat(dmCoreCandidates.filter(it => !dmSelectedCore.has(it.id)));

            const dmSelectedArea = new Set();
            const dmAreaByPrefix = {};
            for (let i = 0; i < dmAreaCandidates.length; i++) {
                const it = dmAreaCandidates[i];
                const prefix = firstMatchingPrefix(it.code, areaPrefixes);
                if (!prefix) continue;
                if (!dmAreaByPrefix[prefix]) dmAreaByPrefix[prefix] = [];
                dmAreaByPrefix[prefix].push(it);
            }
            let dmAreaCredits = 0;
            for (let i = 0; i < areaPrefixes.length; i++) {
                const p = areaPrefixes[i];
                const bucket = dmAreaByPrefix[p] || [];
                if (bucket.length) {
                    const pick = bucket[0];
                    if (!dmSelectedArea.has(pick.id) && !dmSelectedCore.has(pick.id)) {
                        dmSelectedArea.add(pick.id);
                        dmAreaCredits += pick.credit;
                    }
                }
            }
            for (let i = 0; i < dmAreaCandidates.length && dmAreaCredits < dmAreaReq; i++) {
                const it = dmAreaCandidates[i];
                if (dmSelectedCore.has(it.id) || dmSelectedArea.has(it.id)) continue;
                dmSelectedArea.add(it.id);
                dmAreaCredits += it.credit;
            }

            for (let i = 0; i < dmElectiveItems.length; i++) {
                const it = dmElectiveItems[i];
                if (dmSelectedCore.has(it.id)) it.courseRef.effective_type_dm = 'core';
                else if (dmSelectedArea.has(it.id)) it.courseRef.effective_type_dm = 'area';
                else it.courseRef.effective_type_dm = 'free';
            }

            // Recompute DM category totals to match normalized effective types.
            for (let i = 0; i < this.semesters.length; i++) {
                const sem = this.semesters[i];
                sem.totalCoreDM = 0;
                sem.totalAreaDM = 0;
                sem.totalFreeDM = 0;
                sem.totalRequiredDM = 0;
                sem.totalUniversityDM = 0;
                for (let j = 0; j < sem.courses.length; j++) {
                    const course = sem.courses[j];
                    if (!course) continue;
                    const et = course.effective_type_dm;
                    if (!et || et === 'none') continue;
                    const c = (typeof parseCreditValue === 'function')
                        ? parseCreditValue(course.SU_credit || '0')
                        : (parseFloat(course.SU_credit || '0') || 0);
                    if (et === 'core') sem.totalCoreDM += c;
                    else if (et === 'area') sem.totalAreaDM += c;
                    else if (et === 'free') sem.totalFreeDM += c;
                    else if (et === 'required') sem.totalRequiredDM += c;
                    else if (et === 'university') sem.totalUniversityDM += c;
                }
            }
        }

        // Special-case CS double major: math course exclusions/alternatives.
        // - Pre-2025 admits: only ONE of MATH212 or MATH201 counts toward CS pools.
        // - 2025–2026 admits and later: MATH201 and MATH202 are not included in any CS pool.
        if (this.doubleMajor === 'CS') {
            const entryDM = parseInt(this.entryTermDM || '0', 10);
            const is2025PlusDM = !isNaN(entryDM) && entryDM >= 202501;

            const parseCredit0 = (v) => {
                const n = (typeof parseCreditValue === 'function')
                    ? parseCreditValue(v || '0')
                    : (parseFloat(v || '0') || 0);
                return isNaN(n) ? 0 : n;
            };
            const excludeCourseDM = (sem, course) => {
                if (!sem || !course) return;
                const credit = parseCredit0(course.SU_credit);
                const et = course.effective_type_dm;
                if (et === 'core') sem.totalCoreDM = Math.max(0, sem.totalCoreDM - credit);
                else if (et === 'area') sem.totalAreaDM = Math.max(0, sem.totalAreaDM - credit);
                else if (et === 'free') sem.totalFreeDM = Math.max(0, sem.totalFreeDM - credit);
                else if (et === 'required') sem.totalRequiredDM = Math.max(0, sem.totalRequiredDM - credit);
                else if (et === 'university') sem.totalUniversityDM = Math.max(0, sem.totalUniversityDM - credit);
                course.effective_type_dm = 'none';
            };

            const math201 = [];
            const math202 = [];
            const math212 = [];
            for (let i = 0; i < sorted.length; i++) {
                const sem = sorted[i];
                for (let j = 0; j < sem.courses.length; j++) {
                    const course = sem.courses[j];
                    if (!course) continue;
                    if (course.effective_type_dm === 'none') continue;
                    if (course.code === 'MATH201') math201.push({ sem, course });
                    else if (course.code === 'MATH202') math202.push({ sem, course });
                    else if (course.code === 'MATH212') math212.push({ sem, course });
                }
            }

            if (is2025PlusDM) {
                for (let i = 0; i < math201.length; i++) excludeCourseDM(math201[i].sem, math201[i].course);
                for (let i = 0; i < math202.length; i++) excludeCourseDM(math202[i].sem, math202[i].course);
            } else {
                if (math201.length > 0 && math212.length > 0) {
                    for (let i = 0; i < math201.length; i++) excludeCourseDM(math201[i].sem, math201[i].course);
                }
            }
        }

        // Special-case VACD double major: enforce mutually-exclusive pair rules
        // for required and core elective pools and spill extra pool courses into
        // area/free as specified by VACD requirements.
        if (this.doubleMajor === 'VACD') {
            const reqPairs = [['VA301', 'VA303'], ['VA401', 'VA403'], ['VA300', 'PROJ300']];
            const corePool1 = ['HART292', 'HART293', 'HART380', 'HART413', 'HART426', 'VA315', 'VA420', 'VA430'];
            const corePool1Min = 9;
            const corePool2 = ['VA202', 'VA204', 'VA234', 'VA302', 'VA304', 'VA402', 'VA404'];
            const corePool2Min = 12;
            const corePool2Pairs = [['VA302', 'VA304'], ['VA402', 'VA404']];

            const corePool1Set = new Set(corePool1);
            const corePool2Set = new Set(corePool2);
            const reqPairKeyByCode = {};
            for (let i = 0; i < reqPairs.length; i++) {
                const key = reqPairs[i].join('|');
                reqPairKeyByCode[reqPairs[i][0]] = key;
                reqPairKeyByCode[reqPairs[i][1]] = key;
            }
            const corePairKeyByCode = {};
            for (let i = 0; i < corePool2Pairs.length; i++) {
                const key = corePool2Pairs[i].join('|');
                corePairKeyByCode[corePool2Pairs[i][0]] = key;
                corePairKeyByCode[corePool2Pairs[i][1]] = key;
            }
            function creditOf(course) {
                return (typeof parseCreditValue === 'function')
                    ? parseCreditValue(course.SU_credit || '0')
                    : (parseFloat(course.SU_credit || '0') || 0);
            }

            // Required pairs: only one counts as required. Extras become free.
            const chosenReqPairKeys = new Set();
            for (let i = 0; i < sorted.length; i++) {
                const sem = sorted[i];
                for (let j = 0; j < sem.courses.length; j++) {
                    const course = sem.courses[j];
                    if (!course || !course.id) continue;
                    if (course.effective_type_dm === 'none') continue;
                    const key = reqPairKeyByCode[course.code];
                    if (!key) continue;
                    if (!chosenReqPairKeys.has(key)) {
                        chosenReqPairKeys.add(key);
                        course.effective_type_dm = 'required';
                    } else {
                        course.effective_type_dm = 'free';
                    }
                }
            }

            // Core pools: pick minimum credits from each pool, respecting the
            // mutually-exclusive pairs in corePool2. Pool overflow fills area
            // then free.
            const selectedCoreIds = new Set();
            const selectedCorePool2PairKeys = new Set();
            let pool1Credits = 0;
            let pool2Credits = 0;
            const overflowPoolCourses = [];

            for (let i = 0; i < sorted.length; i++) {
                const sem = sorted[i];
                for (let j = 0; j < sem.courses.length; j++) {
                    const course = sem.courses[j];
                    if (!course || !course.id) continue;
                    if (course.effective_type_dm === 'none') continue;
                    const code = course.code;
                    if (corePool1Set.has(code)) {
                        if (pool1Credits < corePool1Min) {
                            selectedCoreIds.add(course.id);
                            pool1Credits += creditOf(course);
                        } else {
                            overflowPoolCourses.push(course);
                        }
                    } else if (corePool2Set.has(code)) {
                        const pairKey = corePairKeyByCode[code] || null;
                        if (pool2Credits < corePool2Min && (!pairKey || !selectedCorePool2PairKeys.has(pairKey))) {
                            selectedCoreIds.add(course.id);
                            pool2Credits += creditOf(course);
                            if (pairKey) selectedCorePool2PairKeys.add(pairKey);
                        } else {
                            overflowPoolCourses.push(course);
                        }
                    }
                }
            }

            let baseAreaCredits = 0;
            for (let i = 0; i < this.semesters.length; i++) {
                const sem = this.semesters[i];
                for (let j = 0; j < sem.courses.length; j++) {
                    const course = sem.courses[j];
                    if (!course || course.effective_type_dm === 'none') continue;
                    const code = course.code;
                    if (corePool1Set.has(code) || corePool2Set.has(code)) continue;
                    if (course.effective_type_dm === 'area') {
                        baseAreaCredits += creditOf(course);
                    }
                }
            }
            let areaRemaining = Math.max(0, dmAreaReq - baseAreaCredits);

            for (let i = 0; i < this.semesters.length; i++) {
                const sem = this.semesters[i];
                for (let j = 0; j < sem.courses.length; j++) {
                    const course = sem.courses[j];
                    if (!course || !course.id) continue;
                    if (course.effective_type_dm === 'none') continue;
                    const code = course.code;
                    if (!corePool1Set.has(code) && !corePool2Set.has(code)) continue;
                    if (selectedCoreIds.has(course.id)) {
                        course.effective_type_dm = 'core';
                    }
                }
            }
            for (let i = 0; i < overflowPoolCourses.length; i++) {
                const course = overflowPoolCourses[i];
                if (!course || course.effective_type_dm === 'none') continue;
                if (areaRemaining > 0) {
                    course.effective_type_dm = 'area';
                    areaRemaining -= creditOf(course);
                } else {
                    course.effective_type_dm = 'free';
                }
            }

            // Recompute DM category totals after VACD normalization.
            for (let i = 0; i < this.semesters.length; i++) {
                const sem = this.semesters[i];
                sem.totalCoreDM = 0;
                sem.totalAreaDM = 0;
                sem.totalFreeDM = 0;
                sem.totalRequiredDM = 0;
                sem.totalUniversityDM = 0;
                for (let j = 0; j < sem.courses.length; j++) {
                    const course = sem.courses[j];
                    if (!course) continue;
                    const et = course.effective_type_dm;
                    if (!et || et === 'none') continue;
                    const c = creditOf(course);
                    if (et === 'core') sem.totalCoreDM += c;
                    else if (et === 'area') sem.totalAreaDM += c;
                    else if (et === 'free') sem.totalFreeDM += c;
                    else if (et === 'required') sem.totalRequiredDM += c;
                    else if (et === 'university') sem.totalUniversityDM += c;
                }
            }
        }
        // Update DOM to show both primary and double major types
        try {
            for (let i = 0; i < this.semesters.length; i++) {
                const sem = this.semesters[i];
                for (let j = 0; j < sem.courses.length; j++) {
                    const course = sem.courses[j];
                    if (!course || !course.id) continue;
                    const elem = document.getElementById(course.id);
                    if (!elem) continue;
                    const typeSpan = elem.querySelector('.course_type');
                    if (!typeSpan) continue;
                    const mainType = course.effective_type || (typeSpan.textContent && typeSpan.textContent.trim().toLowerCase());
                    const dmTypeLabel = course.effective_type_dm;
                    if (this.doubleMajor && dmTypeLabel) {
                        // Compose both types, capitalize each
                        const mt = (mainType === 'none' ? 'N/A' : (mainType || '').toString().toUpperCase());
                        const dt = (dmTypeLabel === 'none' ? 'N/A' : dmTypeLabel.toUpperCase());
                        try {
                            const baseMain = (course.category || '').toString().toLowerCase();
                            const effMain = (course.effective_type || '').toString().toLowerCase();
                            const movedDownMain = !!(baseMain && effMain && baseMain !== effMain && effMain !== 'none');
                            const baseDM = (course.categoryDM || '').toString().toLowerCase();
                            const effDM = (course.effective_type_dm || '').toString().toLowerCase();
                            const movedDownDM = !!(baseDM && effDM && baseDM !== effDM && effDM !== 'none');

                            const mainCls = movedDownMain ? 'is-overflow-type' : '';
                            const dmCls = movedDownDM ? 'is-overflow-type' : '';
                            // Types are controlled values (CORE/AREA/FREE/etc.). Render as spans so
                            // overflow coloring can be applied per-major independently.
                            typeSpan.innerHTML =
                                `<span class="course_type_part ct-main ${mainCls}">${mt}</span>` +
                                `<span class="ct-sep"> / </span>` +
                                `<span class="course_type_part ct-dm ${dmCls}">${dt}</span>`;
                        } catch (_) {
                            typeSpan.textContent = mt + ' / ' + dt;
                        }
                    } else {
                        // Only main type
                        typeSpan.textContent = (mainType === 'none' ? 'N/A' : (mainType || '').toString().toUpperCase());
                    }
                    // When showing combined main/DM types we color per-part; do not
                    // apply a single overflow class to the whole label.
                    try { typeSpan.classList.remove('is-overflow-type'); } catch (_) {}
                }
            }
        } catch (err) {
            // Ignore DOM errors
        }
    };

    /**
     * Determine if the student can graduate from the selected double major.
     * This function mirrors canGraduate() but applies the double major
     * thresholds (SU credits +30, ECTS +60) and uses the double major
     * effective category totals (CoreDM, AreaDM, FreeDM) for core/area/free
     * checks. Major-specific logic is preserved to ensure that special
     * requirements (e.g., internships, faculty course counts) remain in
     * effect for the double major.
     *
     * Returns 0 if the student can graduate; otherwise returns a code
     * corresponding to the missing requirement. Codes align with those in
     * canGraduate().
     */
    this.canGraduateDouble = function() {
        if (!this.doubleMajor) return 0;
        // Accumulate totals for the double major
        let area = 0;
        let core = 0;
        let free = 0;
        let university = 0;
        let required = 0;
        let total = 0;
        let science = 0;
        let engineering = 0;
        let ects = 0;
        let gpaCreditsDM = 0;
        let gpaValueDM = 0;
        for (let i = 0; i < this.semesters.length; i++) {
            const sem = this.semesters[i];
            total += sem.totalCredit;
            area += (sem.totalAreaDM || 0);
            core += (sem.totalCoreDM || 0);
            free += (sem.totalFreeDM || 0);
            // Use DM-specific university/required totals if available, otherwise
            // fall back to the primary totals.  This ensures courses that are
            // classified as university or required in the second major are
            // properly counted even when absent in the primary major.
            university += (sem.totalUniversityDM !== undefined ? sem.totalUniversityDM : sem.totalUniversity);
            required += (sem.totalRequiredDM !== undefined ? sem.totalRequiredDM : sem.totalRequired);
            science += sem.totalScience;
            engineering += sem.totalEngineering;
            ects += sem.totalECTS;
            gpaCreditsDM += sem.totalGPACredits;
            gpaValueDM += sem.totalGPA;
        }
        // Fetch requirements for double major and adjust SU/ECTS thresholds
        const req = getReq(this.doubleMajor, this.entryTermDM);
        const totalReq = (req.total || 0) + 30;
        const ectsReq = (req.ects || 0) + 60;
        // Generic checks
        if (university < (req.university || 0)) return 1;
        if (req.internshipCourse && !this.hasCourse(req.internshipCourse)) return 4;
        if (total < totalReq) return 5;
        if (science < (req.science || 0)) return 8;
        if (engineering < (req.engineering || 0)) return 9;
        if (ects < ectsReq) return 10;
        if (required < (req.required || 0)) return 2;
        // Core/area/free requirements. Flag codes mirror flagMessages.js
        // where 3=core, 6=area, 7=free and 8=science.
        if (core < (req.core || 0)) return 3;
        if (area < (req.area || 0)) return 6;
        if (free < (req.free || 0)) return 7;
        // GPA check for graduation
        const gpaThresholdDoubleMajor = 3.20;
        let GPA = gpaCreditsDM ? (gpaValueDM / gpaCreditsDM).toFixed(3) : NaN;
        if (!isNaN(GPA)){
            if (this.doubleMajor && GPA < gpaThresholdDoubleMajor) return 38; // Flag for double major
        }
        // Major-specific checks for double major
        const maj = this.doubleMajor;
        if (maj === 'CS') {
            // Check CS-specific requirements
            if (!this.hasCourse("SPS303")) return 11;
            if (!(this.hasCourse("HUM201") || this.hasCourse("HUM202") || this.hasCourse("HUM207"))) return 12;
            {
                let facultyCoursesCount = 0;
                let fensCoursesCount = 0;
                let mathCoursesCount = 0;
                for (let i = 0; i < this.semesters.length; i++) {
                    for (let a = 0; a < this.semesters[i].courses.length; a++) {
                        const course = this.semesters[i].courses[a];
                        if (course && course.effective_type_dm === 'none') continue;
                        if (course.Faculty_Course && course.Faculty_Course !== 'No') {
                            facultyCoursesCount++;
                            if (course.Faculty_Course === 'FENS') fensCoursesCount++;
                            if (course.Faculty_Course === 'FENS' && course.code.startsWith('MATH')) mathCoursesCount++;
                        }
                    }
                }
                if (facultyCoursesCount < 5) return 14;
                if (mathCoursesCount < 2) return 19;
                if (fensCoursesCount < 3) return 16;
            }
        } else if (maj === 'IE') {
            {
                let facultyCoursesCount = 0;
                let fensCoursesCount = 0;
                let mathCoursesCount = 0;
                for (let i = 0; i < this.semesters.length; i++) {
                    for (let a = 0; a < this.semesters[i].courses.length; a++) {
                        const course = this.semesters[i].courses[a];
                        if (course.Faculty_Course && course.Faculty_Course !== 'No') {
                            facultyCoursesCount++;
                            if (course.Faculty_Course === 'FENS') fensCoursesCount++;
                            if (course.Faculty_Course === 'FENS' && course.code.startsWith('MATH')) mathCoursesCount++;
                        }
                    }
                }
                if (facultyCoursesCount < 5) return 14;
                if (mathCoursesCount < 2) return 19;
                if (fensCoursesCount < 3) return 16;
            }
        } else if (maj === 'EE') {
            {
                let ee400LevelCredits = 0;
                for (let i = 0; i < this.semesters.length; i++) {
                    for (let a = 0; a < this.semesters[i].courses.length; a++) {
                        const course = this.semesters[i].courses[a];
                        if (course.code.startsWith('EE4') && course.categoryDM === 'Core') {
                            ee400LevelCredits += (typeof parseCreditValue === 'function')
                                ? parseCreditValue(course.SU_credit || '0')
                                : (parseFloat(course.SU_credit || '0') || 0);
                        }
                    }
                }
                if (ee400LevelCredits < 9) return 23;
                else {
                    let hasSpecificAreaCourse = false;
                    const specificAreaCourses = ['CS300','CS401','CS412','ME303','PHYS302','PHYS303'];
                    for (let i = 0; i < this.semesters.length && !hasSpecificAreaCourse; i++) {
                        for (let a = 0; a < this.semesters[i].courses.length; a++) {
                            const course = this.semesters[i].courses[a];
                            if (specificAreaCourses.includes(course.code) || (course.code.startsWith('EE48') && course.categoryDM === 'Area')) {
                                hasSpecificAreaCourse = true;
                                break;
                            }
                        }
                    }
                    if (!hasSpecificAreaCourse) return 24;
                }
            }
        } else if (maj === 'MAT') {
            {
                let facultyCoursesCount = 0;
                let fensCoursesCount = 0;
                let mathCoursesCount = 0;
                for (let i = 0; i < this.semesters.length; i++) {
                    for (let a = 0; a < this.semesters[i].courses.length; a++) {
                        const course = this.semesters[i].courses[a];
                        if (course.Faculty_Course && course.Faculty_Course !== 'No') {
                            facultyCoursesCount++;
                            if (course.Faculty_Course === 'FENS') fensCoursesCount++;
                            if (course.Faculty_Course === 'FENS' && course.code.startsWith('MATH')) mathCoursesCount++;
                        }
                    }
                }
                if (facultyCoursesCount < 5) return 14;
                if (mathCoursesCount < 2) return 19;
                if (fensCoursesCount < 3) return 16;
            }
        } else if (maj === 'BIO') {
            {
                let facultyCoursesCount = 0;
                let fensCoursesCount = 0;
                let mathCoursesCount = 0;
                for (let i = 0; i < this.semesters.length; i++) {
                    for (let a = 0; a < this.semesters[i].courses.length; a++) {
                        const course = this.semesters[i].courses[a];
                        if (course.Faculty_Course && course.Faculty_Course !== 'No') {
                            facultyCoursesCount++;
                            if (course.Faculty_Course === 'FENS') fensCoursesCount++;
                            if (course.Faculty_Course === 'FENS' && course.code.startsWith('MATH')) mathCoursesCount++;
                        }
                    }
                }
                if (facultyCoursesCount < 5) return 14;
                if (mathCoursesCount < 2) return 19;
                if (fensCoursesCount < 3) return 16;
            }
        } else if (maj === 'ME') {
            {
                let facultyCoursesCount = 0;
                let fensCoursesCount = 0;
                let mathCoursesCount = 0;
                for (let i = 0; i < this.semesters.length; i++) {
                    for (let a = 0; a < this.semesters[i].courses.length; a++) {
                        const course = this.semesters[i].courses[a];
                        if (course.Faculty_Course && course.Faculty_Course !== 'No') {
                            facultyCoursesCount++;
                            if (course.Faculty_Course === 'FENS') fensCoursesCount++;
                            if (course.Faculty_Course === 'FENS' && course.code.startsWith('MATH')) mathCoursesCount++;
                        }
                    }
                }
                if (facultyCoursesCount < 5) return 14;
                if (mathCoursesCount < 2) return 19;
                if (fensCoursesCount < 3) return 16;
            }
        } else if (maj === 'ECON') {
            {
                let hasMathRequirement = this.hasCourse('MATH201') || this.hasCourse('MATH202') || this.hasCourse('MATH204');
                if (!hasMathRequirement) return 25;
                let facultyCoursesCount = 0;
                let fassCount = 0;
                let areasCount = new Set();
                for (let i = 0; i < this.semesters.length; i++) {
                    for (let a = 0; a < this.semesters[i].courses.length; a++) {
                        const course = this.semesters[i].courses[a];
                        if (course.Faculty_Course && course.Faculty_Course !== 'No') {
                            facultyCoursesCount++;
                            if (course.Faculty_Course === 'FASS') fassCount++;
                            if (course.code.startsWith('CULT')) areasCount.add('CULT');
                            else if (course.code.startsWith('ECON')) areasCount.add('ECON');
                            else if (course.code.startsWith('HART')) areasCount.add('HART');
                            else if (course.code.startsWith('PSYCH')) areasCount.add('PSYCH');
                            else if (course.code.startsWith('SPS') || course.code.startsWith('POLS') || course.code.startsWith('IR')) areasCount.add('SPS/POLS/IR');
                            else if (course.code.startsWith('VA')) areasCount.add('VA');
                            else if (course.Faculty_Course === 'FENS') areasCount.add('FENS');
                            else if (course.Faculty_Course === 'SBS') areasCount.add('SBS');
                        }
                    }
                }
                if (facultyCoursesCount < 5) return 14;
                if (fassCount < 3) return 15;
                if (areasCount.size < 3) return 18;
            }
        } else if (maj === 'MAN') {
            {
                let facultyCoursesCount = 0;
                let sbsCoursesCount = 0;
                for (let i = 0; i < this.semesters.length; i++) {
                    for (let a = 0; a < this.semesters[i].courses.length; a++) {
                        const course = this.semesters[i].courses[a];
                        if (course.Faculty_Course && course.Faculty_Course !== 'No') {
                            facultyCoursesCount++;
                            if (course.Faculty_Course === 'SBS') sbsCoursesCount++;
                        }
                    }
                }
                if (facultyCoursesCount < 5) return 14;
                if (sbsCoursesCount < 2) return 22;
                // Core electives requirement: 6 courses from 6 different areas
                let coreAreas = new Set();
                let coreCount = 0;
                for (let i = 0; i < this.semesters.length; i++) {
                    for (let a = 0; a < this.semesters[i].courses.length; a++) {
                        const course = this.semesters[i].courses[a];
                        const eff = (course.effective_type_dm || (course.categoryDM && course.categoryDM.toLowerCase()) || '').toLowerCase();
                        if (eff === 'core') {
                            coreCount++;
                            if (course.code.startsWith('ACC')) coreAreas.add('ACC');
                            else if (course.code.startsWith('FIN')) coreAreas.add('FIN');
                            else if (course.code.startsWith('MGMT')) coreAreas.add('MGMT');
                            else if (course.code.startsWith('MKTG')) coreAreas.add('MKTG');
                            else if (course.code.startsWith('OPIM')) coreAreas.add('OPIM');
                            else if (course.code.startsWith('ORG')) coreAreas.add('ORG');
                        }
                    }
                }
                if (coreAreas.size < 6) return 35;

                // Area electives requirement: 5 courses from 5 different areas
                let areaAreas = new Set();
                let areaCount = 0;
                for (let i = 0; i < this.semesters.length; i++) {
                    for (let a = 0; a < this.semesters[i].courses.length; a++) {
                        const course = this.semesters[i].courses[a];
                        const eff = (course.effective_type_dm || (course.categoryDM && course.categoryDM.toLowerCase()) || '').toLowerCase();
                        if (eff === 'area') {
                            areaCount++;
                            if (course.code.startsWith('ACC')) areaAreas.add('ACC');
                            else if (course.code.startsWith('FIN')) areaAreas.add('FIN');
                            else if (course.code.startsWith('MKTG')) areaAreas.add('MKTG');
                            else if (course.code.startsWith('OPIM')) areaAreas.add('OPIM');
                            else if (course.code.startsWith('ORG')) areaAreas.add('ORG');
                        }
                    }
                }
                if (areaAreas.size < 5) return 36;

                // Free Electives requirement for MAN
                let freeElectivesCount = 0;
                let fassFensCredits = 0;
                let basicLanguageCoursesCount = 0;
                const basicLanguageCourses = ['LANG101', 'LANG102', 'LANG103', 'LANG104']; // Example codes for basic language courses

                for (let i = 0; i < this.semesters.length; i++) {
                    for (let a = 0; a < this.semesters[i].courses.length; a++) {
                        const course = this.semesters[i].courses[a];
                        const eff = (course.effective_type_dm || (course.categoryDM && course.categoryDM.toLowerCase()) || '').toLowerCase();
                        if (eff === 'free') {
                            const c = (typeof parseCreditValue === 'function')
                                ? parseCreditValue(course.SU_credit || '0')
                                : (parseFloat(course.SU_credit || '0') || 0);
                            freeElectivesCount += c;
                            if (course.Faculty_Course === 'FASS' || course.Faculty_Course === 'FENS') {
                                fassFensCredits += c;
                            }
                            if (basicLanguageCourses.includes(course.code)) {
                                basicLanguageCoursesCount++;
                            }
                        }
                    }
                }

                // Check Free Electives requirements
                if (freeElectivesCount < 26) return 37;
                if (fassFensCredits < 9) return 37;
                if (basicLanguageCoursesCount > 2) return 37;
            }
        } else if (maj === 'PSIR') {
            {
                let facultyCoursesCount = 0;
                let fassCoursesCount = 0;
                let areasCount = new Set();
                for (let i = 0; i < this.semesters.length; i++) {
                    for (let a = 0; a < this.semesters[i].courses.length; a++) {
                        const course = this.semesters[i].courses[a];
                        if (course.Faculty_Course && course.Faculty_Course !== 'No') {
                            facultyCoursesCount++;
                            if (course.Faculty_Course === 'FASS') fassCoursesCount++;
                            if (course.code.startsWith('CULT')) areasCount.add('CULT');
                            else if (course.code.startsWith('ECON')) areasCount.add('ECON');
                            else if (course.code.startsWith('HART')) areasCount.add('HART');
                            else if (course.code.startsWith('PSY')) areasCount.add('PSYCH');
                            else if (course.code.startsWith('SPS') || course.code.startsWith('POLS') || course.code.startsWith('IR')) areasCount.add('SPS/POLS/IR');
                            else if (course.code.startsWith('VA')) areasCount.add('VA');
                            else if (course.Faculty_Course === 'FENS') areasCount.add('FENS');
                            else if (course.Faculty_Course === 'SBS') areasCount.add('SBS');
                        }
                    }
                }
                if (facultyCoursesCount < 5) return 14;
                if (fassCoursesCount < 3) return 15;
                if (areasCount.size < 3) return 18;

                // Core Electives I (Political Science)
                let coreElectivesICount = 0;
                const coreElectivesIPool = ['LAW312', 'POLS251', 'POLS353', 'POLS404', 'POLS455', 'POLS483', 'POLS493', 'SOC201'];
                for (let i = 0; i < this.semesters.length; i++) {
                    for (let a = 0; a < this.semesters[i].courses.length; a++) {
                        const course = this.semesters[i].courses[a];
                        const courseCode = course.code || ((course.Major || '') + (course.Code || ''));
                        if (coreElectivesIPool.includes(courseCode)) {
                            coreElectivesICount += (typeof parseCreditValue === 'function')
                                ? parseCreditValue(course.SU_credit || '0')
                                : (parseFloat(course.SU_credit || '0') || 0);
                        }
                    }
                }
                if (coreElectivesICount < 12) return 33;

                // Core Electives II (International Relations)
                let coreElectivesIICount = 0;
                const coreElectivesIIPool = ['CONF400', 'IR301', 'IR342', 'IR391', 'IR394', 'IR405', 'IR489', 'LAW311', 'POLS492'];
                for (let i = 0; i < this.semesters.length; i++) {
                    for (let a = 0; a < this.semesters[i].courses.length; a++) {
                        const course = this.semesters[i].courses[a];
                        const courseCode = course.code || ((course.Major || '') + (course.Code || ''));
                        if (coreElectivesIIPool.includes(courseCode)) {
                            coreElectivesIICount += (typeof parseCreditValue === 'function')
                                ? parseCreditValue(course.SU_credit || '0')
                                : (parseFloat(course.SU_credit || '0') || 0);
                        }
                    }
                }
                if (coreElectivesIICount < 12) return 34;
            }
        } else if (maj === 'PSY') {
            {
                let hasPhilosophy = this.hasCourse('PHIL300') || this.hasCourse('PHIL301');
                if (!hasPhilosophy) return 26;
                let facultyCoursesCount = 0;
                let fassCoursesCount = 0;
                let areasCount = new Set();
                for (let i = 0; i < this.semesters.length; i++) {
                    for (let a = 0; a < this.semesters[i].courses.length; a++) {
                        const course = this.semesters[i].courses[a];
                        if (course.Faculty_Course && course.Faculty_Course !== 'No') {
                            facultyCoursesCount++;
                            if (course.Faculty_Course === 'FASS') fassCoursesCount++;
                            if (course.code.startsWith('CULT')) areasCount.add('CULT');
                            else if (course.code.startsWith('ECON')) areasCount.add('ECON');
                            else if (course.code.startsWith('HART')) areasCount.add('HART');
                            else if (course.code.startsWith('PSY')) areasCount.add('PSYCH');
                            else if (course.code.startsWith('SPS') || course.code.startsWith('POLS') || course.code.startsWith('IR')) areasCount.add('SPS/POLS/IR');
                            else if (course.code.startsWith('VA')) areasCount.add('VA');
                            else if (course.Faculty_Course === 'FENS') areasCount.add('FENS');
                            else if (course.Faculty_Course === 'SBS') areasCount.add('SBS');
                        }
                    }
                }
                if (facultyCoursesCount < 5) return 14;
                if (fassCoursesCount < 3) return 15;
                if (areasCount.size < 3) return 18;
                // Core electives requirement: 7 courses
                let psyCoreCount = 0;
                for (let i = 0; i < this.semesters.length; i++) {
                    for (let a = 0; a < this.semesters[i].courses.length; a++) {
                        const course = this.semesters[i].courses[a];
                        if (course.categoryDM === 'Core') {
                            psyCoreCount++;
                        }
                    }
                }
                if (psyCoreCount < 7) return 77;
            }
        } else if (maj === 'VACD') {
            {
                let facultyCoursesCount = 0;
                let fassCoursesCount = 0;
                let areasCount = new Set();
                for (let i = 0; i < this.semesters.length; i++) {
                    for (let a = 0; a < this.semesters[i].courses.length; a++) {
                        const course = this.semesters[i].courses[a];
                        if (course.Faculty_Course && course.Faculty_Course !== 'No') {
                            facultyCoursesCount++;
                            if (course.Faculty_Course === 'FASS') fassCoursesCount++;
                            if (course.code.startsWith('CULT')) areasCount.add('CULT');
                            else if (course.code.startsWith('ECON')) areasCount.add('ECON');
                            else if (course.code.startsWith('HART')) areasCount.add('HART');
                            else if (course.code.startsWith('PSY')) areasCount.add('PSYCH');
                            else if (course.code.startsWith('SPS') || course.code.startsWith('POLS') || course.code.startsWith('IR')) areasCount.add('SPS/POLS/IR');
                            else if (course.code.startsWith('VA')) areasCount.add('VA');
                            else if (course.Faculty_Course === 'FENS') areasCount.add('FENS');
                            else if (course.Faculty_Course === 'SBS') areasCount.add('SBS');
                        }
                    }
                }
                if (facultyCoursesCount < 5) return 14;
                if (fassCoursesCount < 3) return 15;
                if (areasCount.size < 3) return 18;

                // Core Electives I (Art/Design History Courses) for VACD
                let coreElectivesICount = 0;
                const coreElectivesIPool = ['HART292', 'HART293', 'HART380', 'HART413', 'HART426', 'VA315', 'VA420', 'VA430'];
                for (let i = 0; i < this.semesters.length; i++) {
                    for (let a = 0; a < this.semesters[i].courses.length; a++) {
                        const course = this.semesters[i].courses[a];
                        const courseCode = course.code || ((course.Major || '') + (course.Code || ''));
                        const eff = (course.effective_type_dm || (course.categoryDM && course.categoryDM.toLowerCase()) || '').toLowerCase();
                        if (eff === 'core' && coreElectivesIPool.includes(courseCode)) {
                            coreElectivesICount += (typeof parseCreditValue === 'function')
                                ? parseCreditValue(course.SU_credit || '0')
                                : (parseFloat(course.SU_credit || '0') || 0);
                        }
                    }
                }
                if (coreElectivesICount < 9) return 30;

                // Core Electives II (Skill Courses) for VACD
                let coreElectivesIICount = 0;
                const coreElectivesIIPool = ['VA202', 'VA204', 'VA234', 'VA302', 'VA304', 'VA402', 'VA404'];
                const pairKeyByCode = {
                    VA302: 'VA302|VA304',
                    VA304: 'VA302|VA304',
                    VA402: 'VA402|VA404',
                    VA404: 'VA402|VA404',
                };
                const seenPairKeys = new Set();
                for (let i = 0; i < this.semesters.length; i++) {
                    for (let a = 0; a < this.semesters[i].courses.length; a++) {
                        const course = this.semesters[i].courses[a];
                        const courseCode = course.code || ((course.Major || '') + (course.Code || ''));
                        const eff = (course.effective_type_dm || (course.categoryDM && course.categoryDM.toLowerCase()) || '').toLowerCase();
                        if (eff === 'core' && coreElectivesIIPool.includes(courseCode)) {
                            const pairKey = pairKeyByCode[courseCode];
                            if (pairKey) {
                                if (seenPairKeys.has(pairKey)) continue;
                                seenPairKeys.add(pairKey);
                            }
                            coreElectivesIICount += (typeof parseCreditValue === 'function')
                                ? parseCreditValue(course.SU_credit || '0')
                                : (parseFloat(course.SU_credit || '0') || 0);
                        }
                    }
                }
                if (coreElectivesIICount < 12) return 31;
            }
        } else if (maj === 'DSA') {
            {
                let facultyCoursesCount = 0;
                let fensCoursesCount = 0;
                let fassCoursesCount = 0;
                let sbsCoursesCount = 0;
                for (let i = 0; i < this.semesters.length; i++) {
                    for (let a = 0; a < this.semesters[i].courses.length; a++) {
                        const course = this.semesters[i].courses[a];
                        if (course.Faculty_Course && course.Faculty_Course !== 'No') {
                            facultyCoursesCount++;
                            if (course.Faculty_Course === 'FENS') fensCoursesCount++;
                            else if (course.Faculty_Course === 'FASS') fassCoursesCount++;
                            else if (course.Faculty_Course === 'SBS') sbsCoursesCount++;
                        }
                    }
                }
                if (facultyCoursesCount < 5) return 14;
                if (fensCoursesCount < 1) return 20;
                if (fassCoursesCount < 1) return 21;
                if (sbsCoursesCount < 1) return 22;
                // Core electives requirements: at least 27 SU credits with at least 3 courses from each faculty
                let fensCoreCount = 0;
                let fassCoreCount = 0;
                let sbsCoreCount = 0;
                for (let i = 0; i < this.semesters.length; i++) {
                    for (let a = 0; a < this.semesters[i].courses.length; a++) {
                        const course = this.semesters[i].courses[a];
                        if (course.categoryDM === 'Core') {
                            if (course.Faculty_Course === 'FENS') fensCoreCount++;
                            else if (course.Faculty_Course === 'FASS') fassCoreCount++;
                            else if (course.Faculty_Course === 'SBS') sbsCoreCount++;
                        }
                    }
                }
                // Each faculty must have at least 3 core courses
                if (fensCoreCount < 3 || fassCoreCount < 3 || sbsCoreCount < 3) return 18;
                // Sum of SU credits from core courses for DSA must be at least 27
                let coreSUCredits = 0;
                for (let i = 0; i < this.semesters.length; i++) {
                    for (let a = 0; a < this.semesters[i].courses.length; a++) {
                        const course = this.semesters[i].courses[a];
                        if (course.categoryDM === 'Core') {
                            coreSUCredits += (typeof parseCreditValue === 'function')
                                ? parseCreditValue(course.SU_credit || '0')
                                : (parseFloat(course.SU_credit || '0') || 0);
                        }
                    }
                }
                if (coreSUCredits < 27) return 18;
            }
        }
        return 0;
    };

    // end of s_curriculum constructor
}

