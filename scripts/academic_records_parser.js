// Academic Records Parser
// This module parses Academic Records Summary HTML files to extract course information

/**
 * Parses an Academic Records Summary HTML file and extracts course information
 * @param {string} htmlContent - The HTML content of the Academic Records file
 * @returns {Object} An object containing parsed course data and any issues found
 */
function parseAcademicRecords(htmlContent) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlContent, 'text/html');

    // Get all course tables (each semester has its own table)
    const courseTables = doc.querySelectorAll('.courseTable');

    // Store parsed courses and issues
    const result = {
        courses: [],
        notFoundCourses: []
    };

    // Track the most recent entry for each course code. As we parse the tables
    // in the order they appear in the transcript, later occurrences will
    // overwrite earlier ones so that repeated attempts keep only the latest
    // grade.
    const latestMap = {};

    // Extract courses from each table (semester)
    courseTables.forEach(table => {
        // Get semester information from the header
        const semesterHeader = table.querySelector('thead tr th:first-child b');
        let semester = semesterHeader ? semesterHeader.textContent.trim() : "Unknown Semester";


        // Get all course rows (skip header rows and special rows)
        const courseRows = Array.from(table.querySelectorAll('tbody tr')).filter(row => {
            // Skip header rows and special rows like "Transfer Courses"
            const firstCell = row.querySelector('td:first-child');
            if (!firstCell) return false;

            // Skip rows that are course type headers or course code headers
            if (firstCell.classList.contains('course_type') ||
                firstCell.textContent.includes("COURSE CODE") ||
                row.classList.contains('course_type')) {
                return false;
            }

            const courseCode = firstCell.textContent.trim();
            // More flexible regex to match course codes
            return courseCode.match(/^[A-Z]+\s*\d{3,}[A-Z0-9]*$/) !== null;
        });

        // Extract course information from each row
        courseRows.forEach(row => {
            const cells = row.querySelectorAll('td');
            if (cells.length >= 4) {
                let courseCode = cells[0].textContent.trim().replace(/\s/g, '');
                const courseTitle = cells[1].textContent.trim();
                const grade = cells[3].textContent.trim();

                // Determine status if available by scanning remaining cells. If
                // the row marks the course as "Repeated" or "Excluded", we skip
                // it as it should not affect credits or categories.
                const statusText = Array.from(cells)
                    .slice(4)
                    .map(c => c.textContent.trim().toLowerCase())
                    .join(' ');
                if (statusText.includes('repeated') || statusText.includes('excluded')) {
                    return;
                }
                // Extract SU credit and ECTS values if available. The transcript
                // table uses the fourth and fifth columns (zero-indexed) for
                // credit and ECTS, respectively. Parse them as floats and
                // default to 0 when not present. Leading/trailing whitespace
                // and zero-padding are stripped.
                let suCredits = 0;
                let ects = 0;
                try {
                    if (cells.length > 4) {
                        const creditText = cells[4].textContent.trim();
                        suCredits = creditText ? parseFloat(creditText) : 0;
                    }
                    if (cells.length > 5) {
                        const ectsText = cells[5].textContent.trim();
                        ects = ectsText ? parseFloat(ectsText) : 0;
                    }
                } catch (_) {
                    suCredits = 0;
                    ects = 0;
                }

                // Replace CS210 with DSA210
                if (courseCode === 'CS210') {
                    courseCode = 'DSA210';
                }

                // Correct the condition to skip courses with ELAE code
                if (courseCode.includes('ELAE')) {
                    return; // Skip this iteration
                }

                // Skip withdrawn or not attended courses
                if (['W', 'NA'].includes(grade)) {
                    return;
                }

                // Include the course, using blank grade for "Registered"
                latestMap[courseCode] = {
                    code: courseCode,
                    title: courseTitle,
                    grade: grade === 'Registered' ? '' : grade,
                    semester: semester,
                    suCredits: suCredits,
                    ects: ects
                };
            }
        });
    });

    // Finalize the result courses from the latestMap values
    result.courses = Object.values(latestMap);
    return result;
}

/**
 * Parses a YÖK (Higher Education Council) style transcript and extracts course information
 * @param {string} pdfText - Text content extracted from the YÖK transcript PDF
 * @returns {Object} An object containing parsed course data
 */
function parseYokTranscript(pdfText) {
    const lines = pdfText.replace(/\r/g, '').split('\n').map(l => l.trim());
    const courseCodeRegex = /^\*?\s*[A-Z]+\s*\d{3,}[A-Z0-9]*\s*$/;
    const semesterRegex = /\((\d{4}-\d{4}) (Fall|Spring|Summer) (Term|School)\)/;
    const result = { courses: [], notFoundCourses: [] };
    let currentSemester = 'Unknown Semester';

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        const semMatch = line.match(semesterRegex);
        if (semMatch) {
            // semMatch[1]: year range, semMatch[2]: term, semMatch[3]: "Term" or "School"
            const term = semMatch[2];
            // Always use "Term" in the output
            currentSemester = `${term} ${semMatch[1]}`;
            continue;
        }

        if (!courseCodeRegex.test(line)) {
            continue;
        }

        let code = line.replace(/^\*/, '').replace(/\s+/g, '');

        let j = i;
        const next = () => {
            j++;
            while (j < lines.length && !lines[j]) {
                j++;
            }
            return lines[j] || '';
        };

        const turkishTitle = next();
        let englishTitle = next();
        if (englishTitle.startsWith('(') && englishTitle.endsWith(')')) {
            englishTitle = englishTitle.slice(1, -1);
        }
        next(); // course status - not used
        next(); // language - not used

        next(); // T hours
        next(); // U hours
        const suCredits = parseFloat(next()) || 0;
        const ects = parseFloat(next()) || 0;

        let token = next();
        if (/^[0-9.]+$/.test(token)) {
            token = next();
        }
        let grade = token;

        if(!token.includes('--')){
            next(); // comment - ignored
        }
        else{
            grade = '';
        }
        i = j;

        if (code === 'CS210') {
            code = 'DSA210';
        }
        if (code.includes('ELAE') || ['W', 'NA'].includes(grade)) {
            continue;
        }

        result.courses.push({
            code: code,
            title: englishTitle || turkishTitle,
            grade: grade,
            semester: currentSemester,
            suCredits: suCredits,
            ects: ects
        });
    }

    return result;
}

/**
 * Parses text extracted from an Academic Records Summary PDF and extracts course information
 * @param {string} pdfText - Text content extracted from the PDF
 * @returns {Object} An object containing parsed course data
 */
function parseAcademicRecordsPdf(pdfText) {
    // Detect YÖK-style transcripts which use a completely different layout
    if (pdfText.includes('NOT DÖKÜM BELGESİ') || pdfText.includes('NOT DOKUM BELGESI')) {
        return parseYokTranscript(pdfText);
    }

    const lines = pdfText.replace(/\r/g, '').split('\n').map(l => l.trim()).filter(Boolean);
    const courseCodeRegex = /^[A-Z]+\s*\d{3,}[A-Z0-9]*$/;
    const semesterRegex = /^(Fall|Spring|Summer)\s+\d{4}-\d{4}$/;
    // PDF transcripts include a "level" column such as UG/GR which we ignore.
    const levelTokens = new Set(['UG', 'GR', 'FDY', 'PG', 'PR', 'SA', 'SR', 'MS', 'MD', 'DR']);
    // Grades mirror the options used elsewhere in the app (helper_functions.js)
    // and include special entries for transfer and in-progress courses.
    const gradeRegex = /^(S|A|A-|B\+|B|B-|C\+|C|C-|D\+|D|F|T|P|I|W|NA|U|Registered)$/;

    const result = { courses: [], notFoundCourses: [] };
    let currentSemester = 'Unknown Semester';

    function parseAcademicRecordsPdfTokenStream(text) {
        const tokens = String(text || '').replace(/\r/g, ' ').split(/\s+/).map(t => t.trim()).filter(Boolean);
        const semesterTerms = new Set(['Fall', 'Spring', 'Summer']);
        const yearRangeRegex = /^\d{4}-\d{4}$/;
        const upper = (t) => String(t || '').toUpperCase();
        const normalizeDigitish = (s) => {
            const t = String(s || '');
            // OCR often confuses these in course numbers.
            return t.replace(/[Il]/g, '1').replace(/O/g, '0');
        };
        const gradeTokenRegexUpper = /^(S|A|A-|B\+|B|B-|C\+|C|C-|D\+|D|F|T|P|I|W|NA|U|REGISTERED)$/;
        const isGradeToken = (tok) => gradeTokenRegexUpper.test(upper(tok));
        const normalizeGrade = (tok) => {
            const u = upper(tok);
            return u === 'REGISTERED' ? 'Registered' : u;
        };
        const readGradeAt = (idx) => {
            const a = tokens[idx] || '';
            const aU = upper(a);
            const bU = upper(tokens[idx + 1] || '');
            if ((aU === 'A' || aU === 'B' || aU === 'C' || aU === 'D') && (bU === '+' || bU === '-')) {
                const g = aU + bU;
                if (isGradeToken(g)) return { grade: normalizeGrade(g), next: idx + 2 };
            }
            if (isGradeToken(a)) return { grade: normalizeGrade(a), next: idx + 1 };
            return null;
        };
        const isNumberToken = (t) => {
            if (!t) return false;
            return !isNaN(parseFloat(t));
        };
        const isSemesterAt = (idx) => {
            const t = tokens[idx];
            const y = tokens[idx + 1];
            if (!t || !y) return null;
            const cap = t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
            if (!semesterTerms.has(cap)) return null;
            if (!yearRangeRegex.test(y)) return null;
            return cap + ' ' + y;
        };
        const isCourseStartAt = (idx) => {
            const tRaw = tokens[idx] || '';
            const t2Raw = tokens[idx + 1] || '';
            const t = upper(tRaw);
            const t2 = upper(t2Raw);
            const t2Num = normalizeDigitish(t2);

            if (/^[A-Z]{2,6}\d{3,}[A-Z0-9]*$/.test(normalizeDigitish(t))) {
                return { code: normalizeDigitish(t), next: idx + 1 };
            }
            if (/^[A-Z]{2,6}$/.test(t) && /^\d{3,}[A-Z0-9]*$/.test(t2Num)) {
                return { code: t + t2Num, next: idx + 2 };
            }
            // Microsoft Print to PDF sometimes yields character-level tokens like:
            // "C", "S", "1", "0", "1" or "C", "S", "101". Stitch those back together.
            if (/^[A-Z]$/.test(t)) {
                let j = idx;
                let subj = '';
                while (j < tokens.length && /^[A-Z]$/.test(upper(tokens[j])) && subj.length < 6) {
                    subj += upper(tokens[j]);
                    j++;
                }
                if (subj.length < 2) return null;

                // Case A: next token already contains the full number (e.g. "101")
                const nTok = normalizeDigitish(upper(tokens[j] || ''));
                if (/^\d{3,}[A-Z0-9]*$/.test(nTok)) {
                    return { code: subj + nTok, next: j + 1 };
                }

                // Case B: number is split across multiple digit tokens (e.g. "1","0","1")
                let k = j;
                let num = '';
                while (k < tokens.length && /^\d$/.test(normalizeDigitish(tokens[k])) && num.length < 6) {
                    num += normalizeDigitish(tokens[k]);
                    k++;
                }
                if (num.length >= 3) {
                    // Optional suffix token immediately after digits (e.g. "A")
                    const suf = upper(tokens[k] || '');
                    if (/^[A-Z0-9]{1,3}$/.test(suf) && !levelTokens.has(suf) && !isGradeToken(suf)) {
                        return { code: subj + num + suf, next: k + 1 };
                    }
                    return { code: subj + num, next: k };
                }
            }
            return null;
        };

        const out = { courses: [], notFoundCourses: [] };
        let sem = 'Unknown Semester';

        for (let i = 0; i < tokens.length;) {
            const semAt = isSemesterAt(i);
            if (semAt) {
                sem = semAt;
                i += 2;
                continue;
            }

            const start = isCourseStartAt(i);
            if (!start) {
                i++;
                continue;
            }

            let code = start.code.replace(/\s+/g, '');
            i = start.next;

            // Skip ELAE entries (legacy behavior) without terminating parsing.
            if (code.includes('ELAE')) {
                continue;
            }

            // Find the "level" token (UG/GR/...) nearby; Microsoft Print to PDF
            // often flattens rows into a single token stream.
            let levelIdx = -1;
            for (let j = i; j < Math.min(tokens.length, i + 40); j++) {
                if (levelTokens.has(upper(tokens[j]))) {
                    levelIdx = j;
                    break;
                }
                // Stop early if we obviously reached the next record.
                if (isSemesterAt(j) || isCourseStartAt(j)) break;
            }

            const titleTokens = [];
            let cursor = i;
            if (levelIdx !== -1 && levelIdx > i) {
                for (let j = i; j < levelIdx; j++) {
                    const tok = tokens[j];
                    // Avoid accidentally slurping grade/credit tokens as title.
                    if (isGradeToken(tok) || isNumberToken(tok)) break;
                    titleTokens.push(tok);
                }
                cursor = levelIdx + 1;
            } else {
                // Fallback: collect title tokens until we hit grade/credits.
                while (cursor < tokens.length) {
                    const tok = tokens[cursor];
                    if (levelTokens.has(upper(tok)) || isGradeToken(tok) || isNumberToken(tok) || isSemesterAt(cursor) || isCourseStartAt(cursor)) break;
                    titleTokens.push(tok);
                    cursor++;
                    if (titleTokens.length > 30) break;
                }
                if (levelTokens.has(upper(tokens[cursor]))) cursor++;
            }

            const courseTitle = titleTokens.join(' ').trim();

            let grade = '';
            const g = readGradeAt(cursor);
            if (g) {
                grade = g.grade;
                cursor = g.next;
            }

            let suCredits = 0;
            if (cursor < tokens.length && isNumberToken(tokens[cursor])) {
                suCredits = parseFloat(tokens[cursor]) || 0;
                cursor++;
            }

            let ects = 0;
            if (cursor < tokens.length && isNumberToken(tokens[cursor])) {
                ects = parseFloat(tokens[cursor]) || 0;
                cursor++;
            }

            // Scan status tokens until the next course/semester header to detect
            // "repeated/excluded" rows.
            const statusTokens = [];
            let j = cursor;
            while (j < tokens.length && !isSemesterAt(j) && !isCourseStartAt(j)) {
                statusTokens.push(tokens[j]);
                j++;
                if (statusTokens.length > 60) break;
            }
            const statusText = statusTokens.join(' ').toLowerCase();
            if ((statusText.includes('repeated') || statusText.includes('excluded')) && !statusText.includes('regardless of whether the course is repeated later')) {
                i = j;
                continue;
            }

            if (code === 'CS210') {
                code = 'DSA210';
            }

            if (['W', 'NA'].includes(grade)) {
                i = j;
                continue;
            }

            out.courses.push({
                code: code,
                title: courseTitle,
                grade: grade === 'Registered' ? '' : grade,
                semester: sem,
                suCredits: suCredits,
                ects: ects
            });

            i = j;
        }

        return out;
    }

    for (let i = 0; i < lines.length;) {
        const line = lines[i];

        if (semesterRegex.test(line)) {
            currentSemester = line;
            i++;
            continue;
        }

        if (courseCodeRegex.test(line)) {
            let code = line.replace(/\s+/g, '');
            i++;
            const titleTokens = [];
            while (i < lines.length &&
                   !levelTokens.has(lines[i]) &&
                   !courseCodeRegex.test(lines[i]) &&
                   !semesterRegex.test(lines[i])) {
                titleTokens.push(lines[i]);
                i++;
            }
            const courseTitle = titleTokens.join(' ').trim();

            if (i >= lines.length) break;

            if (levelTokens.has(lines[i])) {
                i++;
            }

            let grade = '';
            if (i < lines.length && gradeRegex.test(lines[i])) {
                grade = lines[i];
                i++;
            }

            let suCredits = 0;
            if (i < lines.length && !isNaN(parseFloat(lines[i]))) {
                suCredits = parseFloat(lines[i]);
                i++;
            }

            let ects = 0;
            if (i < lines.length && !isNaN(parseFloat(lines[i]))) {
                ects = parseFloat(lines[i]);
                i++;
            }

            const statusTokens = [];
            while (i < lines.length &&
                   !courseCodeRegex.test(lines[i]) &&
                   !semesterRegex.test(lines[i]) && lines[i] !== 'SABANCI UNIVERSITY ACADEMIC RECORDS GUIDE')
            {
                statusTokens.push(lines[i]);
                i++;
            }
            const statusText = statusTokens.join(' ').toLowerCase();
            if ((statusText.includes('repeated') || statusText.includes('excluded')) && !statusText.includes('regardless of whether the course is repeated later')) {
                continue;
            }

            // Replace CS210 with DSA210
            if (code === 'CS210') {
                code = 'DSA210';
            }

            // Correct the condition to skip courses with ELAE code
            if (code.includes('ELAE')) {
                continue; // Skip this iteration
            }

            if (['W', 'NA'].includes(grade)) {
                continue;
            }

            result.courses.push({
                code: code,
                title: courseTitle,
                grade: grade === 'Registered' ? '' : grade,
                semester: currentSemester,
                suCredits: suCredits,
                ects: ects
            });
            continue;
        }

        i++;
    }

    // Fallback parser for PDFs produced by "Microsoft Print to PDF" which may
    // flatten rows into a different token ordering.
    if (result.courses.length === 0) {
        return parseAcademicRecordsPdfTokenStream(pdfText);
    }

    return result;
}

/**
 * Checks if parsed courses exist in the course data and creates semesters with valid courses
 * @param {Array} parsedCourses - Array of course objects parsed from the HTML
 * @param {Object} courseData - Course data from the program JSON
 * @param {Object} curriculum - The curriculum object to add courses to
 * @returns {Object} Statistics about the import process
 */
function importParsedCourses(parsedCourses, courseData, curriculum) {
    // Build statistics object up front.  The `notFoundCourses` array will
    // accumulate codes that are neither present in the program nor match
    // the special prefixes.  These will be reported back to the user.
    const stats = {
        totalCourses: parsedCourses.length,
        importedCourses: 0,
        notFoundCourses: []
    };
    // When we encounter courses that need to be created as custom courses
    // (based on their prefix), we'll push them into this array.  The
    // consuming code in main.js can then prompt the user to fill in
    // additional fields (e.g. engineering/basic science credits) for each
    // pending course.  Each entry will hold a reference to the newCourse
    // object that was inserted into courseData so it can be updated later.
    const pendingCustomCourses = [];

    // Group courses by semester
    const courseBySemester = {};

    // Format semesters to be more user-friendly
    const formatSemester = (semester) => {
        // Extract the semester pattern like "Fall 2022-2023" from the header
        let match = semester.match(/(Fall|Spring|Summer)\s+(\d{4}-\d{4})/);
        if (match) {
            // Reformat it to the expected format: "Fall 2022-2023"
            const term = match[1];
            const yearRange = match[2];
            return term + " " + yearRange;
        }
        return semester;
    };

    // Parse the semester order to allow for correct sorting
    const getSemesterOrder = (semester) => {
        const formattedSemester = formatSemester(semester);
        const parts = formattedSemester.split(' ');
        if (parts.length < 2) return 0;

        const term = parts[0];
        const yearRange = parts[1];

        let order = 0;
        if (yearRange) {
            const yearParts = yearRange.split('-');
            if (yearParts.length === 2) {
                const year = parseInt(yearParts[0]);
                order = year * 10; // Base score from year

                // Add term-specific values (Fall=0, Spring=1, Summer=2)
                if (term === 'Spring') order += 1;
                else if (term === 'Summer') order += 2;
            }
        }
        return order;
    };

    parsedCourses.forEach(course => {
        // Extract course code prefix and number for better matching
        const codePrefix = course.code.match(/^[A-Z]+/)[0];
        const codeNumber = course.code.match(/\d+[A-Z0-9]*/)[0];

        // Check if course exists in course data using both combined and split formats.
        // Also check the selected double major's course list if available.
        const existsInList = (list) => list.some(c => {
            // Try direct match first
            if (c.code === course.code) return true;

            // Try matching based on prefix and code parts
            if (c.Major === codePrefix && c.Code === codeNumber) return true;

            // Try matching with combined code
            if ((c.Major + c.Code) === course.code) return true;

            return false;
        });

        let courseExists = existsInList(courseData);
        if (!courseExists) {
            try {
                if (curriculum && curriculum.doubleMajor &&
                    Array.isArray(curriculum.doubleMajorCourseData)) {
                    courseExists = existsInList(curriculum.doubleMajorCourseData);
                }
            } catch (_) {
                /* ignore */
            }
        }

        // If course does not exist, attempt to automatically add it as a
        // custom course for certain special prefixes.  For non-engineering
        // majors we also consider LANG* courses as free electives.  We use
        // both short and full prefixes (e.g., COR/CORE, ARE/AREA) to match
        // variations in the transcript.  If a match is found we create a
        // placeholder course using the known credit information and queue it
        // for user confirmation via the custom course modal.
        if (!courseExists) {
            const code = course.code || '';
            const engineeringMajors = ['CS','EE','IE','ME','BIO','MAT','DSA'];
            const nonEngineering = engineeringMajors.indexOf(curriculum.major) === -1;
            let prefix = '';
            let elType = '';
            // Determine elective type based on prefix.  Accept both the
            // minimal three-letter form (COR, ARE, FEL, LANG) and their
            // longer forms (CORE, AREA, etc.).
            if (/^COR(E)?/.test(code)) {
                prefix = code.match(/^([A-Z]+)/)[0];
                elType = 'core';
            } else if (/^ARE(A)?/.test(code)) {
                prefix = code.match(/^([A-Z]+)/)[0];
                elType = 'area';
            } else if (/^FEL/.test(code)) {
                prefix = code.match(/^([A-Z]+)/)[0];
                elType = 'free';
            } else if (/^LANG/.test(code) && nonEngineering) {
                prefix = code.match(/^([A-Z]+)/)[0];
                elType = 'free';
            }
            if (elType) {
                const numMatch = code.match(/\d+[A-Z0-9]*/);
                const num = numMatch ? numMatch[0] : '';
                // Use the credit information from the parsed course when
                // available. Default to zero if missing.
                const su = (typeof course.suCredits === 'number' && !isNaN(course.suCredits)) ? course.suCredits : 0;
                const ectsVal = (typeof course.ects === 'number' && !isNaN(course.ects)) ? course.ects : 0;
                const newCourse = {
                    Major: prefix,
                    Code: num,
                    Course_Name: course.title || code,
                    ECTS: ectsVal.toString(),
                    Engineering: 0,
                    Basic_Science: 0,
                    SU_credit: su.toString(),
                    Faculty: '',
                    EL_Type: elType,
                    Faculty_Course: 'No'
                };
                // Append to course data so future imports recognize it
                courseData.push(newCourse);
                // Persist to storage under the current major (plan-scoped when available)
                try {
                    const key = 'customCourses_' + curriculum.major;
                    const ps = (typeof window !== 'undefined') ? window.planStorage : null;
                    const get = (k) => {
                        try { return ps ? ps.getItem(k) : localStorage.getItem(k); } catch (_) {}
                        try { return localStorage.getItem(k); } catch (_) {}
                        return null;
                    };
                    const set = (k, v) => {
                        try { return ps ? ps.setItem(k, v) : localStorage.setItem(k, v); } catch (_) {}
                        try { return localStorage.setItem(k, v); } catch (_) {}
                        return null;
                    };
                    const existingList = JSON.parse(get(key) || '[]');
                    existingList.push(newCourse);
                    set(key, JSON.stringify(existingList));
                } catch (e) {
                    // ignore storage errors
                }
                // Queue this course for user confirmation.  We capture the
                // reference to the inserted course object and the parsed
                // information to prefill the form later.
                pendingCustomCourses.push({
                    course: newCourse,
                    parsedInfo: {
                        code: course.code,
                        title: course.title,
                        suCredits: su,
                        ects: ectsVal,
                        elType: elType
                    }
                });
                courseExists = true;
            }
        }

        if (courseExists) {
            // Get formatted semester name
            const formattedSemester = formatSemester(course.semester);

            // Group by semester
            if (!courseBySemester[formattedSemester]) {
                courseBySemester[formattedSemester] = {
                    name: formattedSemester,
                    order: getSemesterOrder(course.semester),
                    courses: [],
                    grades: {} // Store grades for each course
                };
            }
            // Store course and its grade
            courseBySemester[formattedSemester].courses.push(course.code);
            courseBySemester[formattedSemester].grades[course.code] = course.grade;
            stats.importedCourses++;
        } else {
            stats.notFoundCourses.push(course.code);
        }
    });

    // Sort semesters by their order (chronologically)
    const sortedSemesters = Object.values(courseBySemester)
        .sort((a, b) => a.order - b.order);  // Ascending order (oldest first)

    // Process in reverse order so oldest appears on the left.  When each
    // semester is inserted at the beginning, the oldest needs to be
    // inserted last.  We collect any courses with grades in the same
    // order as they appear in `sortedSemesters`.
    for (let i = sortedSemesters.length - 1; i >= 0; i--) {
        const semesterData = sortedSemesters[i];
        // Only create a semester if there is at least one course to add.
        if (semesterData.courses && semesterData.courses.length > 0) {
            const gradeList = semesterData.courses.map(courseCode => {
                return semesterData.grades[courseCode] || '';
            });
            // Create the semester using whichever global function is available.
            if (typeof createSemeter === 'function') {
                createSemeter(false, semesterData.courses, curriculum, courseData, gradeList, semesterData.name);
            } else if (typeof window.createSemeter === 'function') {
                window.createSemeter(false, semesterData.courses, curriculum, courseData, gradeList, semesterData.name);
            } else {
                console.error('createSemeter function not found');
            }
        }
    }

    // After creating all semesters from the transcript import, update the
    // effective categories so that courses are allocated correctly.  We
    // specifically pass the provided courseData so the recalc function can
    // look up static course types.  Guard against missing recalc.
    try {
        if (typeof curriculum.recalcEffectiveTypes === 'function') {
            curriculum.recalcEffectiveTypes(courseData);
        }
    } catch (err) {
        // ignore
    }

    // Finally, return both the import statistics and any pending custom
    // courses.  Do not return prematurely inside loops; returning here
    // ensures we process all semesters and recalc credits before
    // prompting the user for missing information.
    return {
        stats: stats,
        pendingCustomCourses: pendingCustomCourses
    };
}

// Export functions for use in main.js
window.academicRecordsParser = {
    parseAcademicRecords,
    parseAcademicRecordsPdf,
    importParsedCourses
};
