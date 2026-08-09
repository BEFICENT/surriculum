//semester struct:
function s_semester(id, course_data)
{
    this.courses = [];
    this.id = id;
    // Workload is independent of degree allocation: every positive-SU course
    // card contributes even when its grade or category makes it N/A for the
    // primary program. `totalCredit` below retains its historical graduation-
    // total meaning.
    this.totalLoadCredit = null;
    this.primaryAllocatedCredit = null;
    this.primaryUnallocatedCredit = null;
    this.primaryProgramCode = '';
    this.totalCredit = 0;
    this.totalArea = 0;
    this.totalCore = 0;
    this.totalFree = 0;
    this.totalUniversity = 0;
    this.totalRequired = 0;
    this.totalScience = 0.0;
    this.totalEngineering = 0.0;
    this.totalECTS = 0.0;
    // Track the chronological order of this semester in the academic calendar. This index
    // corresponds to the position of the semester's term string within the global
    // `terms` array defined in helper_functions.js. The array lists the most
    // recent term first, so a larger index represents an earlier semester.
    // `termIndex` is set when the semester is created and whenever the user edits
    // the term via the UI.
    this.termIndex = null;
    // Stable identity used by progress/graduation audits. Unlike termIndex this
    // remains meaningful when the generated `terms` window moves over time.
    this.termCode = '';
    this.termName = '';

    this.totalGPA = 0.0;
    this.totalGPACredits = 0.0;
    this.addCourse = function(course)
    {
        for(let i = 0; i < course_data.length; i++)
        {
            if (( (course_data[i]['Major'] + course_data[i]['Code']) == course.code ))
            {
                let credit = (typeof parseCreditValue === 'function')
                    ? parseCreditValue(course_data[i]['SU_credit'])
                    : (parseFloat(course_data[i]['SU_credit']) || 0);
                this.totalCredit += credit;
                this.totalEngineering += parseFloat(course_data[i]['Engineering']);
                this.totalScience += parseFloat(course_data[i]['Basic_Science']);
                this.totalECTS += parseFloat(course_data[i]['ECTS']);
                if (course_data[i]['EL_Type'] == "free") {this.totalFree = this.totalFree + credit;}
                else if (course_data[i]['EL_Type'] == "area") {this.totalArea = this.totalArea + credit;}
                else if (course_data[i]['EL_Type'] == "core") {this.totalCore = this.totalCore + credit;}
                else if (course_data[i]['EL_Type'] == "university") {this.totalUniversity = this.totalUniversity + credit;}
                else if (course_data[i]['EL_Type'] == "required") {this.totalRequired = this.totalRequired + credit;}
            }
        }
        this.courses.push(course);
        try {
            const storage = (typeof window !== 'undefined') ? window.planStorage : null;
            if (storage && typeof storage.requestSave === 'function') storage.requestSave();
        } catch (_) {}
    }
    this.deleteCourse = function(id_c)
    {
        for(let a = 0; a < this.courses.length; a++)
        {
            if(this.courses[a].id == id_c)
            {
                let info = null;
                for(let i = 0; i < course_data.length; i++)
                {
                    if ( (course_data[i]['Major'] + course_data[i]['Code']) == (this.courses[a].code) )
                    {
                        info = course_data[i];
                        break;
                    }
                }

                let credit = 0;
                let science = 0;
                let engineering = 0;
                let ects = 0;

                if(info)
                {
                    science = parseFloat(info['Basic_Science'] || 0);
                    engineering = parseFloat(info['Engineering'] || 0);
                    ects = parseFloat(info['ECTS'] || 0);
                    credit = (typeof parseCreditValue === 'function')
                        ? parseCreditValue(info['SU_credit'] || 0)
                        : (parseFloat(info['SU_credit'] || 0) || 0);
                    if (info['EL_Type'] == "free") {this.totalFree -= credit;}
                    else if (info['EL_Type'] == "area") {this.totalArea -= credit;}
                    else if (info['EL_Type'] == "core") {this.totalCore -= credit;}
                    else if (info['EL_Type'] == "university") {this.totalUniversity -= credit;}
                    else if (info['EL_Type'] == "required") {this.totalRequired -= credit;}
                }
                else
                {
                    const course = this.courses[a];
                    science = parseFloat(course.Basic_Science || 0);
                    engineering = parseFloat(course.Engineering || 0);
                    ects = parseFloat(course.ECTS || 0);
                    credit = (typeof parseCreditValue === 'function')
                        ? parseCreditValue(course.SU_credit || 0)
                        : (parseFloat(course.SU_credit || 0) || 0);
                    if (course.effective_type == "free") {this.totalFree -= credit;}
                    else if (course.effective_type == "area") {this.totalArea -= credit;}
                    else if (course.effective_type == "core") {this.totalCore -= credit;}
                    else if (course.effective_type == "university") {this.totalUniversity -= credit;}
                    else if (course.effective_type == "required") {this.totalRequired -= credit;}
                }

                this.totalScience -= science;
                this.totalEngineering -= engineering;
                this.totalECTS -= ects;
                this.totalCredit -= credit;
                this.courses.splice(a,1);
                try {
                    const storage = (typeof window !== 'undefined') ? window.planStorage : null;
                    if (storage && typeof storage.requestSave === 'function') storage.requestSave();
                } catch (_) {}
                return;
            }
        }

    }
}

//struct representing course:
function s_course(code, id = 0, grade = '', gradingBasis = 'unknown')
{
    this.code = code.toUpperCase().trim();
    this.id = id
    // Keep the grade on the model as well as in the UI. Graduation and
    // allocation rules must not depend on reading rendered DOM text, and the
    // model value also prevents an open grade picker from being autosaved as a
    // blank grade. "Registered" is the persisted label for a planned course.
    const rawGrade = String(grade ?? '').trim().toUpperCase();
    const policy = (typeof window !== 'undefined' && window.gradePolicy)
        ? window.gradePolicy : null;
    const normalizedGrade = policy && typeof policy.normalizeGrade === 'function'
        ? policy.normalizeGrade(rawGrade)
        : (rawGrade === 'REGISTERED' ? '' : rawGrade);
    // Keep an unsupported token visible on the model. The policy then treats
    // it as needing review and awards neither credit nor GPA, instead of
    // quietly turning bad imported data into an ungraded projected course.
    this.grade = normalizedGrade === null ? rawGrade : normalizedGrade;
    if (policy && typeof policy.inferGradingBasis === 'function') {
        this.gradingBasis = policy.inferGradingBasis(this.grade, gradingBasis);
    } else {
        const explicit = String(gradingBasis || '').trim().toLowerCase();
        if (/^(?:A|A-|B\+|B|B-|C\+|C|C-|D\+|D|F)$/.test(this.grade)) this.gradingBasis = 'letter';
        else if (/^(?:S|U)$/.test(this.grade)) this.gradingBasis = 'satisfactory';
        else if (explicit === 'letter' || explicit === 'satisfactory') this.gradingBasis = explicit;
        else this.gradingBasis = 'unknown';
    }
    // Effective type of the course after category reallocation. Initially null and
    // will be set by curriculum.recalcEffectiveTypes().
    this.effective_type = null;
}
