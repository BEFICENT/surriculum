// Academic Records Parser
// This module parses Academic Records Summary HTML files to extract course information

// Keep transcript ingestion conservative even if this classic script is used in
// isolation (for example, by a parser test that does not load the domain modules).
// In the application, window.gradePolicy is the source of truth; this fallback
// mirrors only its accepted input vocabulary and basis inference.
const TRANSCRIPT_GRADE_TOKENS = new Set([
    '',
    'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'F',
    'P', 'S', 'U', 'I', 'T', 'NA', 'W'
]);
const TRANSCRIPT_LETTER_GRADES = new Set([
    'A', 'A-', 'B+', 'B', 'B-', 'C+', 'C', 'C-', 'D+', 'D', 'F'
]);
const TRANSCRIPT_SEMESTER_SKIP_REASON = 'missing-or-unrecognized-semester';
const TRANSCRIPT_SEMESTER_BOUNDARY_TERMS = new Set([
    'fall', 'spring', 'summer', 'autumn', 'winter'
]);
const TRANSCRIPT_FENS_PROGRAMS = new Set([
    'BIO', 'CS', 'DSA', 'EE', 'IE', 'MAT', 'ME'
]);

function getTranscriptGradePolicy() {
    try {
        if (typeof window !== 'undefined' && window.gradePolicy) {
            return window.gradePolicy;
        }
    } catch (_) {
        // Fall through to the conservative parser-local policy.
    }
    return null;
}

function normalizeTranscriptGrade(rawGrade) {
    if (String(rawGrade === null || rawGrade === undefined ? '' : rawGrade).trim() === '--') {
        return '';
    }
    const policy = getTranscriptGradePolicy();
    if (policy && typeof policy.normalizeGrade === 'function') {
        try {
            return policy.normalizeGrade(rawGrade);
        } catch (_) {
            return null;
        }
    }

    if (rawGrade === null || rawGrade === undefined) return '';
    const normalized = String(rawGrade).trim().toUpperCase();
    if (!normalized || normalized === 'REGISTERED' || normalized === '--') return '';
    return TRANSCRIPT_GRADE_TOKENS.has(normalized) ? normalized : null;
}

function inferTranscriptGradingBasis(rawGrade, explicitBasis) {
    const policy = getTranscriptGradePolicy();
    if (policy && typeof policy.inferGradingBasis === 'function') {
        try {
            const inferred = policy.inferGradingBasis(rawGrade, explicitBasis);
            return inferred === 'letter' || inferred === 'satisfactory' ? inferred : '';
        } catch (_) {
            return '';
        }
    }

    const grade = normalizeTranscriptGrade(rawGrade);
    if (TRANSCRIPT_LETTER_GRADES.has(grade)) return 'letter';
    if (grade === 'S' || grade === 'U') return 'satisfactory';

    const normalizedBasis = String(explicitBasis || '').trim().toLowerCase();
    if (['letter', 'gpa', 'gpa-bearing', 'letter-grade'].includes(normalizedBasis)) {
        return 'letter';
    }
    if (['satisfactory', 'non-gpa', 's/u', 'su'].includes(normalizedBasis)) {
        return 'satisfactory';
    }
    return '';
}

function normalizeTranscriptGradeRecord(rawGrade, explicitBasis) {
    const grade = normalizeTranscriptGrade(rawGrade);
    if (grade === null) return null;
    return {
        grade: grade,
        gradingBasis: inferTranscriptGradingBasis(grade, explicitBasis)
    };
}

// PDF text extraction can omit an empty column, but it does not tell us that
// the column was omitted.  Only short, grade-shaped values may therefore be
// treated as unsupported grades.  This deliberately excludes arbitrary title
// and status words while still surfacing tokens such as A+ (not a supported SU
// undergraduate grade) for review.  Canonical aliases such as "Registered"
// and "--" are accepted through normalizeTranscriptGrade first.
function isTranscriptGradeLikeToken(rawToken) {
    const token = String(rawToken === null || rawToken === undefined ? '' : rawToken).trim();
    if (!token) return false;
    if (normalizeTranscriptGrade(token) !== null) return true;
    // Unsupported SU letter-grade shapes are deliberately much narrower than
    // "one to three letters": Art, Law, The, AI, A, and I are all plausible
    // title fragments. Supported administrative tokens still come from the
    // canonical policy above.
    return /^[A-F][+-]$/.test(token.toUpperCase());
}

function isTranscriptNumberToken(rawToken) {
    const token = String(rawToken === null || rawToken === undefined ? '' : rawToken).trim();
    return !!token && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(token);
}

function findTranscriptCreditPair(values, start, end) {
    const limit = Math.min(values.length, Math.max(0, Number(end)));
    let lastPlausible = -1;
    let lastGradeAnchored = -1;
    for (let index = Math.max(0, Number(start) || 0); index + 1 < limit; index++) {
        if (!isTranscriptNumberToken(values[index]) || !isTranscriptNumberToken(values[index + 1])) continue;
        const suCredits = Number(values[index]);
        const ects = Number(values[index + 1]);
        // Catalogued SU courses currently top out at 4/10. The wider bounds
        // leave room for unusual records while rejecting years, page counts,
        // and other obviously non-credit numeric pairs.
        if (suCredits < 0 || suCredits > 10 || ects < 0 || ects > 30) continue;
        lastPlausible = index;
        if (readTranscriptGradeBeforeCredits(values, index, start)) lastGradeAnchored = index;
    }
    // A supported/grade-shaped token immediately before a plausible pair is
    // the strongest column signal. With an omitted grade, use the final pair so
    // an earlier numeric title fragment (for example "Studio 1 2") cannot win.
    return lastGradeAnchored !== -1 ? lastGradeAnchored : lastPlausible;
}

// A grade is inferred only from the token immediately before the two numeric
// SU-credit/ECTS columns. This row-local anchor is what distinguishes a genuine
// A or I grade from the same short token inside a course title.
function readTranscriptGradeBeforeCredits(values, creditIndex, rowStart) {
    if (creditIndex <= rowStart || creditIndex > values.length) return null;

    let gradeIndex = creditIndex - 1;
    let raw = String(values[gradeIndex] || '').trim();
    const upper = raw.toUpperCase();
    if ((upper === '+' || upper === '-') && gradeIndex - 1 >= rowStart) {
        const letter = String(values[gradeIndex - 1] || '').trim().toUpperCase();
        if (!/^[A-Z]$/.test(letter)) return null;
        gradeIndex--;
        raw = letter + upper;
    }

    if (!isTranscriptGradeLikeToken(raw)) return null;
    const gradeRecord = normalizeTranscriptGradeRecord(raw);
    if (gradeRecord) {
        return { gradeRecord: gradeRecord, start: gradeIndex };
    }
    return { invalidGrade: raw, start: gradeIndex };
}

function isTranscriptRowStatusToken(rawToken) {
    const token = String(rawToken || '').trim().toLowerCase().replace(/[.:]+$/, '');
    return token === 'completed' || token === 'repeated' || token === 'excluded';
}

function makeParsedCourse(details, gradeRecord) {
    const parsed = Object.assign({}, details, { grade: gradeRecord.grade });
    if (gradeRecord.gradingBasis) parsed.gradingBasis = gradeRecord.gradingBasis;
    return parsed;
}

function canonicalTranscriptCourseCode(rawCode) {
    const code = String(rawCode || '').trim().toUpperCase().replace(/\s+/g, '');
    return code === 'CS210' ? 'DSA210' : code;
}

function isExactTranscriptLangCourseCode(rawCode) {
    const code = canonicalTranscriptCourseCode(rawCode);
    const match = code.match(/^([A-Z]+)(\d[A-Z0-9]*)$/);
    return !!match && match[1] === 'LANG';
}

function suggestedTranscriptLanguageLevel(rawTitle) {
    const title = String(rawTitle || '').trim();
    return /\b(?:basic|beginning)\b/i.test(title) ? 'basic' : '';
}

function transcriptSelectedDegreePrograms(curriculum) {
    const programs = [];
    const seen = new Set();
    const selected = [curriculum && curriculum.major, curriculum && curriculum.doubleMajor];
    if (curriculum && Array.isArray(curriculum.minors)) {
        curriculum.minors.forEach((minorCode) => selected.push(minorCode));
    }
    selected.forEach((rawProgram) => {
        const program = String(rawProgram || '').trim().toUpperCase();
        if (!program || seen.has(program)) return;
        seen.add(program);
        programs.push(program);
    });
    return programs;
}

function transcriptLanguageTypeForProgram(program) {
    const code = String(program || '').trim().toUpperCase();
    // A minor classification must be explicit in the review form; minor
    // requirements are too program-specific to infer a free-elective role.
    if (/-MINOR$/.test(code)) return 'unknown';
    return TRANSCRIPT_FENS_PROGRAMS.has(code)
        ? 'unknown' : 'free';
}

function normalizeTranscriptSemester(rawSemester) {
    const value = String(rawSemester || '').trim();
    const match = value.match(/^(Fall|Spring|Summer)\s+(\d{4})-(\d{4})$/i);
    if (!match) return '';
    const startYear = parseInt(match[2], 10);
    const endYear = parseInt(match[3], 10);
    if (endYear !== startYear + 1) return '';
    const term = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
    return `${term} ${startYear}-${endYear}`;
}

function inspectTranscriptSemesterBoundary(rawSemester) {
    const value = String(rawSemester || '').trim().replace(/\s+/g, ' ');
    const match = value.match(/^([A-Za-z]+)\s+(\d{4}(?:\s*[-/]\s*\d{2,4})?)$/);
    if (!match || !TRANSCRIPT_SEMESTER_BOUNDARY_TERMS.has(match[1].toLowerCase())) {
        return null;
    }
    return {
        label: value,
        semester: normalizeTranscriptSemester(value)
    };
}

function transcriptSemesterIssueLabel(rawSemester) {
    return String(rawSemester || '').trim() || 'Unknown Semester';
}

function transcriptSemesterOrder(rawSemester) {
    const normalized = normalizeTranscriptSemester(rawSemester);
    const match = normalized.match(/^(Fall|Spring|Summer)\s+(\d{4})-\d{4}$/);
    if (!match) return null;
    const term = match[1].toLowerCase();
    const offset = term === 'spring' ? 1 : (term === 'summer' ? 2 : 0);
    return (parseInt(match[2], 10) * 10) + offset;
}

function makeTranscriptCandidate(details, rawGrade, explicitBasis, metadata) {
    const gradeRecord = normalizeTranscriptGradeRecord(rawGrade, explicitBasis);
    return Object.assign({}, details, {
        code: canonicalTranscriptCourseCode(details && details.code),
        _gradeRecord: gradeRecord,
        _invalidGrade: gradeRecord ? null : String(rawGrade === null || rawGrade === undefined ? '' : rawGrade).trim(),
        _attempt: metadata && Number.isFinite(Number(metadata.attempt)) ? Number(metadata.attempt) : null,
        _sourceOrder: metadata && Number.isFinite(Number(metadata.sourceOrder)) ? Number(metadata.sourceOrder) : 0
    });
}

function transcriptCandidateGrade(candidate) {
    return candidate && candidate._gradeRecord
        ? candidate._gradeRecord.grade
        : String((candidate && candidate._invalidGrade) || '').trim();
}

function compareTranscriptCandidates(left, right) {
    const leftSemester = transcriptSemesterOrder(left && left.semester);
    const rightSemester = transcriptSemesterOrder(right && right.semester);
    if (leftSemester !== null && rightSemester !== null && leftSemester !== rightSemester) {
        return leftSemester - rightSemester;
    }
    if (leftSemester !== null && rightSemester === null) return 1;
    if (leftSemester === null && rightSemester !== null) return -1;

    const leftAttempt = left && left._attempt;
    const rightAttempt = right && right._attempt;
    if (leftAttempt !== null && rightAttempt !== null && leftAttempt !== rightAttempt) {
        return leftAttempt - rightAttempt;
    }
    return Number((left && left._sourceOrder) || 0) - Number((right && right._sourceOrder) || 0);
}

// The planner currently stores one occurrence per course code. Reconcile every
// transcript format in one place so that document order cannot decide which
// attempt survives. The latest chronological semester wins; attempt number and
// source order are deterministic tie-breakers within a semester.
function reconcileTranscriptCandidates(candidates) {
    const winners = new Map();
    const superseded = [];
    const list = Array.isArray(candidates) ? candidates : [];

    list.forEach((candidate, index) => {
        if (!candidate || !candidate.code) return;
        if (!Number.isFinite(Number(candidate._sourceOrder))) candidate._sourceOrder = index;
        const code = canonicalTranscriptCourseCode(candidate.code);
        candidate.code = code;
        const previous = winners.get(code);
        if (!previous) {
            winners.set(code, candidate);
            return;
        }
        if (compareTranscriptCandidates(candidate, previous) >= 0) {
            superseded.push({ dropped: previous, kept: candidate });
            winners.set(code, candidate);
        } else {
            superseded.push({ dropped: candidate, kept: previous });
        }
    });

    const selected = Array.from(winners.values()).sort((a, b) => a._sourceOrder - b._sourceOrder);
    const courses = [];
    selected.forEach((candidate) => {
        if (!candidate._gradeRecord) return;
        const details = Object.assign({}, candidate);
        delete details._gradeRecord;
        delete details._invalidGrade;
        delete details._attempt;
        delete details._sourceOrder;
        courses.push(makeParsedCourse(details, candidate._gradeRecord));
    });

    const invalidGradeCourses = list
        .filter(candidate => candidate && !candidate._gradeRecord)
        .map(candidate => ({
            code: canonicalTranscriptCourseCode(candidate.code),
            grade: String(candidate._invalidGrade || '').trim(),
            semester: candidate.semester
        }));
    const supersededCourses = superseded.map((entry) => ({
        code: canonicalTranscriptCourseCode(entry.dropped.code),
        semester: entry.dropped.semester,
        grade: transcriptCandidateGrade(entry.dropped),
        keptSemester: entry.kept.semester,
        keptGrade: transcriptCandidateGrade(entry.kept),
        reason: 'older-attempt'
    }));

    return { courses, invalidGradeCourses, supersededCourses };
}

function newTranscriptResult() {
    return {
        courses: [],
        notFoundCourses: [],
        invalidGradeCourses: [],
        supersededCourses: [],
        skippedCourses: [],
        detectedRecords: 0
    };
}

function addTranscriptSkip(result, code, rawGrade, semester, reason) {
    if (!Array.isArray(result.skippedCourses)) result.skippedCourses = [];
    result.skippedCourses.push({
        code: canonicalTranscriptCourseCode(code),
        grade: String(rawGrade === null || rawGrade === undefined ? '' : rawGrade).trim(),
        semester: semester,
        reason: reason
    });
}

function finalizeTranscriptResult(result, candidates) {
    const reconciled = reconcileTranscriptCandidates(candidates);
    result.courses = reconciled.courses;
    result.invalidGradeCourses = reconciled.invalidGradeCourses;
    result.supersededCourses = reconciled.supersededCourses;
    result.skippedCourses = Array.isArray(result.skippedCourses) ? result.skippedCourses : [];
    result.detectedRecords = (Array.isArray(candidates) ? candidates.length : 0) + result.skippedCourses.length;
    return result;
}

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

    const result = newTranscriptResult();
    const candidates = [];
    let sourceOrder = 0;

    // Extract courses from each table (semester)
    courseTables.forEach(table => {
        // Get semester information from the header
        const semesterHeader = table.querySelector('thead tr th:first-child b');
        const rawSemester = semesterHeader ? semesterHeader.textContent.trim() : '';
        const semester = normalizeTranscriptSemester(rawSemester);


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
                const rawGrade = cells[3].textContent.trim();
                const attempt = cells.length > 2 ? parseFloat(cells[2].textContent.trim()) : null;

                // Determine status if available by scanning remaining cells. If
                // the row marks the course as "Repeated" or "Excluded", we skip
                // it as it should not affect credits or categories.
                const statusText = Array.from(cells)
                    .slice(4)
                    .map(c => c.textContent.trim().toLowerCase())
                    .join(' ');
                const skipReason = statusText.includes('excluded')
                    ? 'excluded' : (statusText.includes('repeated') ? 'repeated' : '');
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

                // Correct the condition to skip courses with ELAE code
                if (courseCode.includes('ELAE')) {
                    return; // Skip this iteration
                }

                if (!semester) {
                    addTranscriptSkip(
                        result, courseCode, rawGrade,
                        transcriptSemesterIssueLabel(rawSemester),
                        TRANSCRIPT_SEMESTER_SKIP_REASON
                    );
                    return;
                }

                if (skipReason) {
                    addTranscriptSkip(result, courseCode, rawGrade, semester, skipReason);
                    return;
                }

                candidates.push(makeTranscriptCandidate({
                    code: courseCode,
                    title: courseTitle,
                    semester: semester,
                    suCredits: suCredits,
                    ects: ects
                }, rawGrade, '', { attempt, sourceOrder: sourceOrder++ }));
            }
        });
    });

    return finalizeTranscriptResult(result, candidates);
}

/**
 * Parses a YÖK (Higher Education Council) style transcript and extracts course information
 * @param {string} pdfText - Text content extracted from the YÖK transcript PDF
 * @returns {Object} An object containing parsed course data
 */
function parseYokTranscript(pdfText) {
    const lines = pdfText.replace(/\r/g, '').split('\n').map(l => l.trim());
    const courseCodeRegex = /^\*?\s*[A-Z]+\s*\d{3,}[A-Z0-9]*\s*$/;
    const semesterBoundaryRegex = /\((\d{4}(?:\s*[-/]\s*\d{2,4})?)\s+([A-Za-z]+)\s+(Term|School)\)/i;
    const result = newTranscriptResult();
    const candidates = [];
    let sourceOrder = 0;
    let currentSemester = '';
    let currentSemesterIssue = '';

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        const semMatch = line.match(semesterBoundaryRegex);
        if (semMatch) {
            // A malformed or unsupported semester-looking header is still a
            // boundary. Clear the previous semester so its following courses
            // cannot be silently assigned to an earlier valid term.
            currentSemesterIssue = `${semMatch[2]} ${semMatch[1]}`;
            currentSemester = normalizeTranscriptSemester(currentSemesterIssue);
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
        const courseStatus = next();
        next(); // language - not used

        next(); // T hours
        next(); // U hours
        const suCredits = parseFloat(next()) || 0;
        const ects = parseFloat(next()) || 0;

        let token = next();
        if (/^[0-9.]+$/.test(token)) {
            token = next();
        }
        let rawGrade = token;

        if(!token.includes('--')){
            next(); // comment - ignored
        }
        else{
            rawGrade = '';
        }
        i = j;

        if (code.includes('ELAE')) {
            continue;
        }

        if (!currentSemester) {
            addTranscriptSkip(
                result, code, rawGrade,
                transcriptSemesterIssueLabel(currentSemesterIssue),
                TRANSCRIPT_SEMESTER_SKIP_REASON
            );
            continue;
        }

        const normalizedStatus = String(courseStatus || '').toLowerCase();
        const skipReason = normalizedStatus.includes('excluded')
            ? 'excluded' : (normalizedStatus.includes('repeated') ? 'repeated' : '');
        if (skipReason) {
            addTranscriptSkip(result, code, rawGrade, currentSemester, skipReason);
            continue;
        }

        candidates.push(makeTranscriptCandidate({
            code: code,
            title: englishTitle || turkishTitle,
            semester: currentSemester,
            suCredits: suCredits,
            ects: ects
        }, rawGrade, '', { sourceOrder: sourceOrder++ }));
    }

    return finalizeTranscriptResult(result, candidates);
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
    // PDF transcripts include a "level" column such as UG/GR which we ignore.
    const levelTokens = new Set(['UG', 'GR', 'FDY', 'PG', 'PR', 'SA', 'SR', 'MS', 'MD', 'DR']);
    const result = newTranscriptResult();
    const candidates = [];
    let sourceOrder = 0;
    let currentSemester = '';
    let currentSemesterIssue = '';

    function parseAcademicRecordsPdfTokenStream(text) {
        const tokens = String(text || '').replace(/\r/g, ' ').split(/\s+/).map(t => t.trim()).filter(Boolean);
        const semesterBoundaryTerms = new Set(['Fall', 'Spring', 'Summer', 'Autumn', 'Winter']);
        const yearRangeRegex = /^\d{4}(?:[-/]\d{2,4})?$/;
        const upper = (t) => String(t || '').toUpperCase();
        const normalizeDigitish = (s) => {
            const t = String(s || '');
            // OCR often confuses these in course numbers.
            return t.replace(/[Il]/g, '1').replace(/O/g, '0');
        };
        const isGradeToken = (tok) => {
            if (!String(tok || '').trim()) return false;
            return normalizeTranscriptGrade(tok) !== null;
        };
        const semesterBoundaryAt = (idx) => {
            const t = tokens[idx];
            const y = tokens[idx + 1];
            if (!t || !y) return null;
            const cap = t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
            if (!semesterBoundaryTerms.has(cap)) return null;
            if (!yearRangeRegex.test(y)) return null;
            const label = cap + ' ' + y;
            return { label, semester: normalizeTranscriptSemester(label) };
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

        const out = newTranscriptResult();
        const tokenCandidates = [];
        let tokenSourceOrder = 0;
        let sem = '';
        let semIssue = '';

        for (let i = 0; i < tokens.length;) {
            const semBoundary = semesterBoundaryAt(i);
            if (semBoundary) {
                sem = semBoundary.semester;
                semIssue = semBoundary.label;
                i += 2;
                continue;
            }

            const start = isCourseStartAt(i);
            if (!start) {
                i++;
                continue;
            }

            let code = start.code.replace(/\s+/g, '');
            const rowStart = start.next;
            let rowEnd = rowStart;
            while (rowEnd < tokens.length && !semesterBoundaryAt(rowEnd) && !isCourseStartAt(rowEnd)) {
                rowEnd++;
            }

            // Skip ELAE entries (legacy behavior) without terminating parsing.
            if (code.includes('ELAE')) {
                i = rowEnd;
                continue;
            }

            // Find the structural columns inside this row only. A grade is not
            // inferred until the two adjacent numeric credit columns are known.
            let levelIdx = -1;
            for (let j = rowStart; j < rowEnd; j++) {
                if (levelTokens.has(upper(tokens[j]))) {
                    levelIdx = j;
                    break;
                }
            }
            const creditIdx = findTranscriptCreditPair(
                tokens, levelIdx === -1 ? rowStart : levelIdx + 1, rowEnd
            );
            const gradeToken = creditIdx === -1
                ? null : readTranscriptGradeBeforeCredits(tokens, creditIdx, rowStart);
            const titleEnd = gradeToken ? gradeToken.start : (creditIdx === -1 ? rowEnd : creditIdx);

            const titleTokens = [];
            const leadingStatusTokens = [];
            if (levelIdx !== -1) {
                for (let j = rowStart; j < levelIdx; j++) titleTokens.push(tokens[j]);
                for (let j = levelIdx + 1; j < titleEnd; j++) {
                    if (isTranscriptRowStatusToken(tokens[j])) leadingStatusTokens.push(tokens[j]);
                    else titleTokens.push(tokens[j]);
                }
            } else {
                for (let j = rowStart; j < titleEnd; j++) {
                    if (isTranscriptRowStatusToken(tokens[j])) leadingStatusTokens.push(tokens[j]);
                    else titleTokens.push(tokens[j]);
                }
            }

            const courseTitle = titleTokens.join(' ').trim();

            let gradeRecord = normalizeTranscriptGradeRecord('');
            let invalidGrade = null;
            if (gradeToken) {
                if (gradeToken.gradeRecord) gradeRecord = gradeToken.gradeRecord;
                else invalidGrade = gradeToken.invalidGrade;
            }

            const suCredits = creditIdx === -1 ? 0 : (parseFloat(tokens[creditIdx]) || 0);
            const ects = creditIdx === -1 ? 0 : (parseFloat(tokens[creditIdx + 1]) || 0);

            // Scan status tokens until the next course/semester header to detect
            // "repeated/excluded" rows.
            const statusTokens = leadingStatusTokens.slice();
            let j = creditIdx === -1 ? titleEnd : creditIdx + 2;
            while (j < rowEnd) {
                statusTokens.push(tokens[j]);
                j++;
            }
            const statusText = statusTokens.join(' ').toLowerCase();
            const skipReason = statusText.includes('excluded')
                ? 'excluded' : (statusText.includes('repeated') && !statusText.includes('regardless of whether the course is repeated later')
                    ? 'repeated' : '');
            if (!normalizeTranscriptSemester(sem)) {
                addTranscriptSkip(out, code,
                    invalidGrade !== null ? invalidGrade : (gradeRecord ? gradeRecord.grade : ''),
                    transcriptSemesterIssueLabel(semIssue), TRANSCRIPT_SEMESTER_SKIP_REASON);
                i = rowEnd;
                continue;
            }
            if (skipReason) {
                addTranscriptSkip(out, code,
                    invalidGrade !== null ? invalidGrade : (gradeRecord ? gradeRecord.grade : ''),
                    sem, skipReason);
                i = rowEnd;
                continue;
            }

            tokenCandidates.push(makeTranscriptCandidate({
                code: code,
                title: courseTitle,
                semester: sem,
                suCredits: suCredits,
                ects: ects
            }, invalidGrade !== null ? invalidGrade : gradeRecord.grade,
            gradeRecord && gradeRecord.gradingBasis,
            { sourceOrder: tokenSourceOrder++ }));

            i = rowEnd;
        }

        return finalizeTranscriptResult(out, tokenCandidates);
    }

    for (let i = 0; i < lines.length;) {
        const line = lines[i];
        const semesterBoundary = inspectTranscriptSemesterBoundary(line);

        if (semesterBoundary) {
            currentSemester = semesterBoundary.semester;
            currentSemesterIssue = semesterBoundary.label;
            i++;
            continue;
        }

        if (courseCodeRegex.test(line)) {
            let code = line.replace(/\s+/g, '');
            const rowStart = i + 1;
            let rowEnd = rowStart;
            while (rowEnd < lines.length &&
                   !courseCodeRegex.test(lines[rowEnd]) &&
                   !inspectTranscriptSemesterBoundary(lines[rowEnd]) &&
                   lines[rowEnd] !== 'SABANCI UNIVERSITY ACADEMIC RECORDS GUIDE') {
                rowEnd++;
            }

            let levelIdx = -1;
            for (let j = rowStart; j < rowEnd; j++) {
                if (levelTokens.has(String(lines[j] || '').toUpperCase())) {
                    levelIdx = j;
                    break;
                }
            }
            const creditIdx = findTranscriptCreditPair(
                lines, levelIdx === -1 ? rowStart : levelIdx + 1, rowEnd
            );
            const gradeToken = creditIdx === -1
                ? null : readTranscriptGradeBeforeCredits(lines, creditIdx, rowStart);
            const titleEnd = gradeToken ? gradeToken.start : (creditIdx === -1 ? rowEnd : creditIdx);

            const titleTokens = [];
            const leadingStatusTokens = [];
            if (levelIdx !== -1) {
                for (let j = rowStart; j < levelIdx; j++) titleTokens.push(lines[j]);
                for (let j = levelIdx + 1; j < titleEnd; j++) {
                    if (isTranscriptRowStatusToken(lines[j])) leadingStatusTokens.push(lines[j]);
                    else titleTokens.push(lines[j]);
                }
            } else {
                for (let j = rowStart; j < titleEnd; j++) {
                    if (isTranscriptRowStatusToken(lines[j])) leadingStatusTokens.push(lines[j]);
                    else titleTokens.push(lines[j]);
                }
            }

            const courseTitle = titleTokens.join(' ').trim();

            let gradeRecord = normalizeTranscriptGradeRecord('');
            let invalidGrade = null;
            if (gradeToken) {
                if (gradeToken.gradeRecord) gradeRecord = gradeToken.gradeRecord;
                else invalidGrade = gradeToken.invalidGrade;
            }

            const suCredits = creditIdx === -1 ? 0 : (parseFloat(lines[creditIdx]) || 0);
            const ects = creditIdx === -1 ? 0 : (parseFloat(lines[creditIdx + 1]) || 0);

            const statusTokens = leadingStatusTokens.slice();
            for (let j = creditIdx === -1 ? titleEnd : creditIdx + 2; j < rowEnd; j++) {
                statusTokens.push(lines[j]);
            }
            const statusText = statusTokens.join(' ').toLowerCase();
            const skipReason = statusText.includes('excluded')
                ? 'excluded' : (statusText.includes('repeated') && !statusText.includes('regardless of whether the course is repeated later')
                    ? 'repeated' : '');
            if (!currentSemester) {
                addTranscriptSkip(result, code,
                    invalidGrade !== null ? invalidGrade : (gradeRecord ? gradeRecord.grade : ''),
                    transcriptSemesterIssueLabel(currentSemesterIssue),
                    TRANSCRIPT_SEMESTER_SKIP_REASON);
                i = rowEnd;
                continue;
            }
            if (skipReason) {
                addTranscriptSkip(result, code,
                    invalidGrade !== null ? invalidGrade : (gradeRecord ? gradeRecord.grade : ''),
                    currentSemester, skipReason);
                i = rowEnd;
                continue;
            }

            // Correct the condition to skip courses with ELAE code
            if (code.includes('ELAE')) {
                i = rowEnd;
                continue; // Skip this iteration
            }

            candidates.push(makeTranscriptCandidate({
                code: code,
                title: courseTitle,
                semester: currentSemester,
                suCredits: suCredits,
                ects: ects
            }, invalidGrade !== null ? invalidGrade : gradeRecord.grade,
            gradeRecord && gradeRecord.gradingBasis,
            { sourceOrder: sourceOrder++ }));
            i = rowEnd;
            continue;
        }

        i++;
    }

    const finalized = finalizeTranscriptResult(result, candidates);

    // Fallback parser for PDFs produced by "Microsoft Print to PDF" which may
    // flatten rows into a different token ordering.
    if (finalized.detectedRecords === 0) {
        return parseAcademicRecordsPdfTokenStream(pdfText);
    }

    return finalized;
}

function formatTranscriptSemester(semester) {
    const value = String(semester || '').trim();
    return normalizeTranscriptSemester(value) || value;
}

function curriculumCourseOccurrences(curriculum, rawCode) {
    const code = canonicalTranscriptCourseCode(rawCode);
    const occurrences = [];
    const semesters = curriculum && Array.isArray(curriculum.semesters) ? curriculum.semesters : [];
    semesters.forEach((semester) => {
        const courses = semester && Array.isArray(semester.courses) ? semester.courses : [];
        courses.forEach((course) => {
            if (canonicalTranscriptCourseCode(course && course.code) === code) {
                occurrences.push({ semester, course });
            }
        });
    });
    return occurrences;
}

function curriculumSemesterName(semester) {
    if (!semester) return '';
    if (semester.termName) return formatTranscriptSemester(semester.termName);
    return '';
}

function transcriptTermCode(value) {
    const normalized = normalizeTranscriptSemester(value && typeof value === 'object'
        ? (value.termName || value.date || value.term || '') : value);
    const match = normalized.match(/^(Fall|Spring|Summer)\s+(\d{4})-\d{4}$/);
    if (!match) return '';
    const suffix = { Fall: '01', Spring: '02', Summer: '03' }[match[1]];
    return match[2] + suffix;
}

function curriculumSemesterTermCode(semester) {
    try {
        const shared = (typeof window !== 'undefined') ? window.semesterTermCode : null;
        if (typeof shared === 'function') return String(shared(semester) || '');
    } catch (_) {
        return '';
    }
    const stored = String((semester && semester.termCode) || '').trim();
    const named = transcriptTermCode(semester);
    if (stored && !/^\d{4}(01|02|03)$/.test(stored)) return '';
    if (stored && named && stored !== named) return '';
    return stored || named;
}

function curriculumSemestersForTranscriptTerm(curriculum, termName) {
    const targetCode = transcriptTermCode(termName);
    if (!targetCode) return [];
    const semesters = curriculum && Array.isArray(curriculum.semesters)
        ? curriculum.semesters : [];
    return semesters.filter((semester) => curriculumSemesterTermCode(semester) === targetCode);
}

function mergeImportedSemesterIntoExisting(curriculum, createdContainer, targetSemester, courseData, previousContainerId) {
    if (!curriculum || !createdContainer || !targetSemester) return false;
    const createdElement = createdContainer.querySelector('.semester');
    const createdSemester = createdElement && typeof curriculum.getSemester === 'function'
        ? curriculum.getSemester(createdElement.id) : null;
    const targetElement = targetSemester.id && typeof document !== 'undefined'
        ? document.getElementById(targetSemester.id) : null;
    if (!createdElement || !createdSemester || !targetElement || createdSemester === targetSemester) return false;

    const createdIndex = curriculum.semesters.indexOf(createdSemester);
    const targetCourses = Array.isArray(targetSemester.courses)
        ? targetSemester.courses.slice() : [];
    const incomingCourses = Array.isArray(createdSemester.courses)
        ? createdSemester.courses.slice() : [];
    const incomingNodes = Array.from(createdElement.querySelectorAll('.course'));
    if (createdIndex < 0 || incomingCourses.length !== incomingNodes.length) return false;

    try {
        targetSemester.courses = targetCourses.concat(incomingCourses);
        incomingNodes.forEach((node) => targetElement.appendChild(node));
        curriculum.semesters.splice(createdIndex, 1);
        createdContainer.remove();
        if (Number.isInteger(previousContainerId)) curriculum.container_id = previousContainerId;
        try {
            if (typeof renumberSemesterContainers === 'function') {
                renumberSemesterContainers(curriculum);
            }
        } catch (_) {}
        recomputeSemesterTranscriptGpa(targetSemester, curriculum, courseData);
        try {
            if (typeof refreshSemesterAccessibility === 'function') refreshSemesterAccessibility();
        } catch (_) {}
        return true;
    } catch (_) {
        targetSemester.courses = targetCourses;
        incomingNodes.forEach((node) => {
            try { createdElement.appendChild(node); } catch (_) {}
        });
        if (curriculum.semesters.indexOf(createdSemester) < 0) {
            curriculum.semesters.splice(Math.max(0, createdIndex), 0, createdSemester);
        }
        if (Number.isInteger(previousContainerId)) curriculum.container_id = previousContainerId + 1;
        return false;
    }
}

function discardCreatedTranscriptSemester(curriculum, createdContainer, previousContainerId) {
    if (!curriculum || !createdContainer) return;
    try {
        const createdElement = createdContainer.querySelector('.semester');
        const createdSemester = createdElement && typeof curriculum.getSemester === 'function'
            ? curriculum.getSemester(createdElement.id) : null;
        const index = createdSemester && Array.isArray(curriculum.semesters)
            ? curriculum.semesters.indexOf(createdSemester) : -1;
        if (index >= 0) curriculum.semesters.splice(index, 1);
    } catch (_) {}
    try { createdContainer.remove(); } catch (_) {}
    if (Number.isInteger(previousContainerId)) curriculum.container_id = previousContainerId;
    try {
        if (typeof renumberSemesterContainers === 'function') {
            renumberSemesterContainers(curriculum);
        }
    } catch (_) {}
    try {
        if (typeof refreshSemesterAccessibility === 'function') refreshSemesterAccessibility();
    } catch (_) {}
}

function courseCatalogRecord(courseData, curriculum, rawCode) {
    const code = canonicalTranscriptCourseCode(rawCode);
    const lists = [courseData];
    if (curriculum && curriculum.doubleMajor && Array.isArray(curriculum.doubleMajorCourseData)) {
        lists.push(curriculum.doubleMajorCourseData);
    }
    if (curriculum && Array.isArray(curriculum.minors) && curriculum.minorCourseDataByCode) {
        curriculum.minors.forEach((minorCode) => {
            const list = curriculum.minorCourseDataByCode[minorCode];
            if (Array.isArray(list)) lists.push(list);
        });
    }
    let globalFallback = null;
    for (const list of lists) {
        if (!Array.isArray(list)) continue;
        for (const record of list) {
            const recordCode = canonicalTranscriptCourseCode(
                record && record.code ? record.code : String((record && record.Major) || '') + String((record && record.Code) || '')
            );
            if (recordCode !== code) continue;
            if (record && record.__globalCourseDefinition) {
                if (!globalFallback) globalFallback = record;
                continue;
            }
            return record;
        }
    }
    return globalFallback;
}

function transcriptCatalogRecordCode(record) {
    return canonicalTranscriptCourseCode(
        record && record.code
            ? record.code
            : String((record && record.Major) || '') + String((record && record.Code) || '')
    );
}

function resolveTranscriptCourseRecord(course, courseData, curriculum) {
    const catalogRecord = courseCatalogRecord(courseData, curriculum, course && course.code);
    if (catalogRecord && !catalogRecord.__globalCourseDefinition) {
        return { record: catalogRecord, isGlobal: false, changed: false, source: 'selected-catalog' };
    }

    const code = canonicalTranscriptCourseCode(course && course.code);
    let globalRecord = catalogRecord && catalogRecord.__globalCourseDefinition
        ? catalogRecord : null;
    const wasStoredPlaceholder = !!(globalRecord && globalRecord.__storedCoursePlaceholder);
    const existingTitle = String((globalRecord && globalRecord.Course_Name) || '').trim();
    const transcriptTitle = String((course && course.title) || '').trim();
    const fallbackTitle = existingTitle && existingTitle !== code
        ? existingTitle : (transcriptTitle || existingTitle || code);
    const existingSu = Number(globalRecord && globalRecord.SU_credit);
    const existingEcts = Number(globalRecord && globalRecord.ECTS);
    const transcriptSu = Number(course && course.suCredits);
    const transcriptEcts = Number(course && course.ects);
    // Parser defaults use zero when a credit cell could not be extracted.
    // Preserve a known nonzero snapshot; otherwise a positive transcript value
    // can fill a genuinely empty fallback. A verified current index value still
    // wins inside resolveGlobalCourseDefinition.
    const fallbackSu = Number.isFinite(existingSu) && existingSu > 0
        ? existingSu : (Number.isFinite(transcriptSu) && transcriptSu > 0
            ? transcriptSu : (Number.isFinite(existingSu) ? existingSu : 0));
    const fallbackEcts = Number.isFinite(existingEcts) && existingEcts > 0
        ? existingEcts : (Number.isFinite(transcriptEcts) && transcriptEcts > 0
            ? transcriptEcts : (Number.isFinite(existingEcts) ? existingEcts : 0));
    let resolvedFromIndex = false;
    try {
        const resolver = (typeof window !== 'undefined'
            && typeof window.resolveGlobalCourseDefinition === 'function')
            ? window.resolveGlobalCourseDefinition : null;
        if (resolver) {
            const resolved = resolver(course && course.code, {
                title: fallbackTitle,
                suCredits: fallbackSu,
                ects: fallbackEcts,
            });
            if (resolved) {
                globalRecord = resolved;
                resolvedFromIndex = true;
            }
        }
    } catch (_) {}

    // A plan restored while the cumulative index is unavailable has an
    // internal marker, possibly carrying a saved metadata snapshot. A later
    // transcript import fills only what that fallback does not already know.
    if (globalRecord && wasStoredPlaceholder) {
        globalRecord = Object.assign({}, globalRecord, {
            Course_Name: resolvedFromIndex
                ? (globalRecord.Course_Name || fallbackTitle) : fallbackTitle,
            SU_credit: String(resolvedFromIndex ? Number(globalRecord.SU_credit || 0) : fallbackSu),
            ECTS: String(resolvedFromIndex ? Number(globalRecord.ECTS || 0) : fallbackEcts),
            __storedCoursePlaceholder: false,
        });
    }
    if (!globalRecord) {
        return { record: null, isGlobal: false, changed: false, source: 'unresolved' };
    }

    const existingIndex = Array.isArray(courseData)
        ? courseData.findIndex(record => transcriptCatalogRecordCode(record) === code)
        : -1;
    const previousRecord = existingIndex >= 0 ? courseData[existingIndex] : null;
    const comparedFields = [
        'Course_Name', 'SU_credit', 'ECTS', 'Engineering', 'Basic_Science',
        'Faculty', 'Faculty_Course', 'EL_Type', '__storedCoursePlaceholder'
    ];
    const changed = !previousRecord || comparedFields.some(field =>
        String(previousRecord[field] ?? '') !== String(globalRecord[field] ?? '')
    );
    if (existingIndex < 0 && Array.isArray(courseData)) courseData.push(globalRecord);
    else if (existingIndex >= 0 && previousRecord.__globalCourseDefinition) {
        courseData[existingIndex] = globalRecord;
    }

    try {
        if (typeof window !== 'undefined'
            && typeof window.rememberGlobalCourseDefinition === 'function') {
            window.rememberGlobalCourseDefinition(globalRecord);
        }
    } catch (_) {}
    return {
        record: globalRecord,
        isGlobal: true,
        changed,
        source: resolvedFromIndex
            ? 'global-course-index'
            : (wasStoredPlaceholder ? 'saved-transcript-fallback' : 'existing-global-definition'),
    };
}

function applyTranscriptCatalogRecordToOccurrence(occurrence, record) {
    if (!occurrence || !occurrence.course || !record) return false;
    const course = occurrence.course;
    const numericFields = ['SU_credit', 'ECTS', 'Engineering', 'Basic_Science'];
    const textFields = ['Faculty', 'Faculty_Course'];
    let changed = false;
    numericFields.forEach((field) => {
        const next = Number(record[field] || 0);
        const normalized = Number.isFinite(next) ? next : 0;
        if (Number(course[field] || 0) !== normalized) changed = true;
        course[field] = normalized;
    });
    textFields.forEach((field) => {
        const next = String(record[field] || (field === 'Faculty_Course' ? 'No' : ''));
        if (String(course[field] || '') !== next) changed = true;
        course[field] = next;
    });

    try {
        if (typeof document !== 'undefined' && course.id) {
            const node = document.getElementById(course.id);
            const nameNode = node && node.querySelector('.course_name');
            const creditNode = node && node.querySelector('.course_credit');
            const scienceNode = node && node.querySelector('.course_bs_credit');
            if (nameNode) nameNode.textContent = String(record.Course_Name || course.code || '');
            if (creditNode) {
                const creditText = typeof formatCreditValue === 'function'
                    ? formatCreditValue(course.SU_credit) : String(course.SU_credit);
                creditNode.textContent = creditText + ' credits';
            }
            if (scienceNode) scienceNode.textContent = 'BS: ' + course.Basic_Science + ' credits';
        }
    } catch (_) {}
    return changed;
}

function evaluateTranscriptGpaOutcome(grade, basis) {
    if (typeof evaluateGradeForLegacyTotals === 'function') {
        return evaluateGradeForLegacyTotals(grade, basis);
    }
    const policy = getTranscriptGradePolicy();
    return policy && typeof policy.evaluateGrade === 'function'
        ? policy.evaluateGrade(grade, basis) : null;
}

function recomputeSemesterTranscriptGpa(semester, curriculum, courseData) {
    if (!semester || !Array.isArray(semester.courses)) return;
    let totalGPA = 0;
    let totalGPACredits = 0;
    semester.courses.forEach((course) => {
        const record = courseCatalogRecord(courseData, curriculum, course && course.code);
        const creditValue = record ? record.SU_credit : course && course.SU_credit;
        const credit = typeof parseCreditValue === 'function'
            ? parseCreditValue(creditValue || 0) : (parseFloat(creditValue || 0) || 0);
        const canonicalGrade = normalizeTranscriptGrade(course && course.grade);
        const grade = canonicalGrade === null
            ? String((course && course.grade) || '').trim().toUpperCase() : canonicalGrade;
        const basis = inferTranscriptGradingBasis(grade, course && course.gradingBasis) || 'unknown';
        const outcome = evaluateTranscriptGpaOutcome(grade, basis);
        if (!outcome || !outcome.countsInGpa) return;
        totalGPA += credit * outcome.gpaPoints;
        totalGPACredits += credit;
    });
    semester.totalGPA = totalGPA;
    semester.totalGPACredits = totalGPACredits;
}

function updateExistingTranscriptCourse(occurrence, gradeRecord, curriculum, courseData) {
    if (!occurrence || !occurrence.course || !occurrence.semester || !gradeRecord) return false;
    const course = occurrence.course;
    const semester = occurrence.semester;
    const oldGrade = normalizeTranscriptGrade(course.grade);
    const oldCanonicalGrade = oldGrade === null ? String(course.grade || '').trim().toUpperCase() : oldGrade;
    const oldBasis = inferTranscriptGradingBasis(oldCanonicalGrade, course.gradingBasis) || 'unknown';
    const nextBasis = gradeRecord.gradingBasis || oldBasis || 'unknown';
    if (oldCanonicalGrade === gradeRecord.grade && oldBasis === nextBasis) return false;

    const record = courseCatalogRecord(courseData, curriculum, course.code);
    const creditValue = record ? record.SU_credit : course.SU_credit;
    const credit = typeof parseCreditValue === 'function'
        ? parseCreditValue(creditValue || 0) : (parseFloat(creditValue || 0) || 0);
    const oldOutcome = evaluateTranscriptGpaOutcome(oldCanonicalGrade, oldBasis);
    const nextOutcome = evaluateTranscriptGpaOutcome(gradeRecord.grade, nextBasis);
    if (oldOutcome && oldOutcome.countsInGpa) {
        semester.totalGPA = Number(semester.totalGPA || 0) - (credit * oldOutcome.gpaPoints);
        semester.totalGPACredits = Number(semester.totalGPACredits || 0) - credit;
    }
    if (nextOutcome && nextOutcome.countsInGpa) {
        semester.totalGPA = Number(semester.totalGPA || 0) + (credit * nextOutcome.gpaPoints);
        semester.totalGPACredits = Number(semester.totalGPACredits || 0) + credit;
    }

    course.grade = gradeRecord.grade;
    course.gradingBasis = nextBasis;
    try {
        if (typeof document !== 'undefined' && course.id) {
            const node = document.getElementById(course.id);
            const gradeNode = node && node.querySelector('.grade');
            if (gradeNode) gradeNode.textContent = gradeRecord.grade || 'Add grade';
        }
    } catch (_) {}
    return true;
}

function removeEmptySemestersCreatedAfter(curriculum, priorSemesterIds) {
    if (!curriculum || !Array.isArray(curriculum.semesters)) return;
    const prior = priorSemesterIds instanceof Set ? priorSemesterIds : new Set();
    for (let i = curriculum.semesters.length - 1; i >= 0; i--) {
        const semester = curriculum.semesters[i];
        if (!semester || prior.has(semester.id) || (Array.isArray(semester.courses) && semester.courses.length)) continue;
        try {
            if (typeof document !== 'undefined' && semester.id) {
                const node = document.getElementById(semester.id);
                const container = node && node.closest('.container_semester');
                if (container) container.remove();
            }
        } catch (_) {}
        curriculum.semesters.splice(i, 1);
    }
}

/**
 * Checks if parsed courses exist in the course data and creates semesters with valid courses
 * @param {Array} parsedCourses - Array of course objects parsed from the HTML
 * @param {Object} courseData - Course data from the program JSON
 * @param {Object} curriculum - The curriculum object to add courses to
 * @returns {Object} Statistics about the import process
 */
function importParsedCourses(parsedCourses, courseData, curriculum) {
    const inputCourses = Array.isArray(parsedCourses) ? parsedCourses : [];
    const invalidSemesterRecords = [];
    const importCandidates = [];
    inputCourses.forEach((course, sourceOrder) => {
        const code = canonicalTranscriptCourseCode(course && course.code);
        const semester = normalizeTranscriptSemester(course && course.semester);
        if (!semester) {
            invalidSemesterRecords.push({
                code: code,
                grade: String((course && course.grade) || '').trim(),
                semester: transcriptSemesterIssueLabel(course && course.semester),
                reason: TRANSCRIPT_SEMESTER_SKIP_REASON
            });
            return;
        }
        importCandidates.push(makeTranscriptCandidate(
            Object.assign({}, course, { code: code, semester: semester }),
            course && course.grade,
            course && course.gradingBasis,
            { sourceOrder }
        ));
    });
    const reconciled = reconcileTranscriptCandidates(importCandidates);
    const uniqueCodes = new Set(inputCourses
        .map(course => canonicalTranscriptCourseCode(course && course.code))
        .filter(Boolean));

    const stats = {
        totalRecords: inputCourses.length,
        totalCourses: uniqueCodes.size,
        importedCourses: 0,
        updatedCourses: [],
        addedCourses: [],
        alreadyPresentCourses: [],
        supersededCourses: reconciled.supersededCourses.slice(),
        skippedCourses: invalidSemesterRecords,
        notFoundCourses: [],
        retainedUnallocatedCourses: [],
        invalidGradeCourses: reconciled.invalidGradeCourses.slice()
    };
    // When we encounter courses that need to be created as custom courses
    // (based on their prefix), we'll push them into this array.  The
    // consuming code in main.js can then prompt the user to fill in
    // additional fields (e.g. engineering/basic science credits) for each
    // pending course.  Each entry will hold a reference to the newCourse
    // object that was inserted into courseData so it can be updated later.
    const pendingCustomCourses = [];

    // LANG definitions are persisted before semester creation so the planner
    // can resolve the imported occurrence. If creation later fails, undo only
    // this course's contextual definitions (preserving any other LANG courses
    // queued by the same import) and restore the exact runtime catalog entry.
    const rollbackPendingTranscriptLanguageCourse = (entry) => {
        if (!entry || !Array.isArray(entry.programCourses)) return false;
        const normalizedCode = canonicalTranscriptCourseCode(
            entry.parsedInfo && entry.parsedInfo.code
        );
        const storage = (typeof window !== 'undefined') ? window.planStorage : null;
        const sessionPlanId = storage && typeof storage.getSessionPlanId === 'function'
            ? storage.getSessionPlanId() : null;
        if (!normalizedCode || !storage || !sessionPlanId
            || typeof storage.getItem !== 'function'
            || typeof storage.setItem !== 'function') return false;

        const writes = [];
        try {
            entry.programCourses.forEach((link) => {
                const program = String((link && link.program) || '').trim().toUpperCase();
                if (!program) throw new Error('Missing language-course program context.');
                const key = 'customCourses_' + program;
                const previousRaw = storage.getItem(key, sessionPlanId);
                const current = JSON.parse(previousRaw || '[]');
                if (!Array.isArray(current)) throw new Error('Invalid saved custom-course list.');
                const currentIndex = current.findIndex(record =>
                    transcriptCatalogRecordCode(record) === normalizedCode
                );
                if (currentIndex < 0) throw new Error('Imported language-course definition is missing.');
                const next = current.slice();
                if (link.previousCourse && typeof link.previousCourse === 'object') {
                    next[currentIndex] = link.previousCourse;
                } else {
                    next.splice(currentIndex, 1);
                }
                const shouldRemoveMissingKey = !next.length
                    && (link.previousRaw === null || link.previousRaw === undefined);
                if (shouldRemoveMissingKey && typeof storage.removeItem === 'function') {
                    if (storage.removeItem(key, sessionPlanId) === false) {
                        throw new Error('Plan-scoped language-course rollback was rejected.');
                    }
                } else if (storage.setItem(key, JSON.stringify(next), sessionPlanId) === false) {
                    throw new Error('Plan-scoped language-course rollback was rejected.');
                }
                writes.push({ key, previousRaw });
            });
        } catch (rollbackError) {
            // Restore any program lists already changed by this rollback. The
            // original import definitions remain available for explicit user
            // recovery if browser storage itself rejects the transaction.
            for (let i = writes.length - 1; i >= 0; i--) {
                const write = writes[i];
                try {
                    if (write.previousRaw === null || write.previousRaw === undefined) {
                        if (typeof storage.removeItem === 'function') {
                            storage.removeItem(write.key, sessionPlanId);
                        }
                    } else {
                        storage.setItem(write.key, write.previousRaw, sessionPlanId);
                    }
                } catch (_) {}
            }
            return false;
        }

        const mutation = entry.courseDataMutation;
        if (mutation && mutation.kind === 'replaced'
            && mutation.previousCourse && typeof mutation.previousCourse === 'object') {
            let index = Array.isArray(courseData) ? courseData.indexOf(entry.course) : -1;
            if (index < 0 && Array.isArray(courseData) && Number.isInteger(mutation.index)
                && mutation.index >= 0 && mutation.index < courseData.length
                && transcriptCatalogRecordCode(courseData[mutation.index]) === normalizedCode) {
                index = mutation.index;
            }
            if (index >= 0) courseData[index] = mutation.previousCourse;
        } else if (mutation && mutation.kind === 'inserted' && Array.isArray(courseData)) {
            const index = courseData.lastIndexOf(entry.course);
            if (index >= 0) courseData.splice(index, 1);
        }

        const pendingIndex = pendingCustomCourses.indexOf(entry);
        if (pendingIndex >= 0) pendingCustomCourses.splice(pendingIndex, 1);
        return true;
    };

    // Group courses by semester
    const courseBySemester = {};

    // Parse the semester order to allow for correct sorting
    const getSemesterOrder = (semester) => {
        const order = transcriptSemesterOrder(semester);
        return order === null ? 0 : order;
    };

    reconciled.courses.forEach(course => {
        const gradeRecord = normalizeTranscriptGradeRecord(course.grade, course.gradingBasis);
        if (!gradeRecord) return;

        const importedSemester = formatTranscriptSemester(course.semester);
        const existingOccurrences = curriculumCourseOccurrences(curriculum, course.code);
        if (existingOccurrences.length === 1) {
            const occurrence = existingOccurrences[0];
            const existingSemester = curriculumSemesterName(occurrence.semester);
            const sameTerm = curriculumSemesterTermCode(occurrence.semester)
                && curriculumSemesterTermCode(occurrence.semester) === transcriptTermCode(importedSemester);
            if (sameTerm) {
                const resolution = resolveTranscriptCourseRecord(course, courseData, curriculum);
                const occurrenceChanged = resolution.isGlobal
                    ? applyTranscriptCatalogRecordToOccurrence(occurrence, resolution.record) : false;
                const gradeChanged = updateExistingTranscriptCourse(
                    occurrence, gradeRecord, curriculum, courseData
                );
                if (resolution.isGlobal) {
                    stats.retainedUnallocatedCourses.push({
                        code: course.code,
                        semester: importedSemester,
                        grade: gradeRecord.grade,
                        suCredits: Number(resolution.record.SU_credit || 0),
                        source: resolution.source,
                    });
                }
                if (resolution.changed || occurrenceChanged) {
                    recomputeSemesterTranscriptGpa(occurrence.semester, curriculum, courseData);
                }
                if (gradeChanged || resolution.changed || occurrenceChanged) {
                    stats.updatedCourses.push({ code: course.code, semester: importedSemester, grade: gradeRecord.grade });
                } else {
                    stats.alreadyPresentCourses.push({
                        code: course.code,
                        semester: importedSemester,
                        grade: gradeRecord.grade,
                        reason: 'unchanged'
                    });
                }
            } else {
                stats.alreadyPresentCourses.push({
                    code: course.code,
                    semester: existingSemester,
                    importedSemester: importedSemester,
                    grade: gradeRecord.grade,
                    reason: 'different-semester'
                });
            }
            return;
        }

        const matchingTermSemesters = curriculumSemestersForTranscriptTerm(curriculum, importedSemester);
        if (matchingTermSemesters.length > 1) {
            stats.skippedCourses.push({
                code: course.code,
                semester: importedSemester,
                grade: gradeRecord.grade,
                reason: 'ambiguous-existing-semester'
            });
            return;
        }
        if (existingOccurrences.length > 1) {
            stats.skippedCourses.push({
                code: course.code,
                semester: importedSemester,
                grade: gradeRecord.grade,
                reason: 'ambiguous-existing-occurrence'
            });
            return;
        }

        // Extract course code prefix and number for better matching
        const prefixMatch = course.code.match(/^[A-Z]+/);
        const numberMatch = course.code.match(/\d+[A-Z0-9]*/);
        if (!prefixMatch || !numberMatch) {
            stats.skippedCourses.push({
                code: course.code,
                semester: importedSemester,
                grade: gradeRecord.grade,
                reason: 'invalid-course-code'
            });
            return;
        }
        // Resolve against every selected program context. Program membership is
        // contextual: the same real course can be absent from the primary
        // catalog while belonging to a selected double major or minor.
        const resolution = resolveTranscriptCourseRecord(course, courseData, curriculum);
        const globalRecord = resolution.isGlobal ? resolution.record : null;
        let courseExists = !!resolution.record;
        const isTranscriptLanguage = isExactTranscriptLangCourseCode(course.code);

        // A course that is real but absent from the selected program/admit-term
        // catalogs must not be confused with an invalid course. The cumulative
        // course-page index is the catalog-independent identity layer. Main
        // loads it before import; the resolver returns a catalog-shaped record
        // with static type `unknown`, which deliberately yields effective N/A:
        // it can carry transcript credits into CGPA without claiming PGPA or
        // graduation-pool membership.
        if (globalRecord && !isTranscriptLanguage) {
            stats.retainedUnallocatedCourses.push({
                code: course.code,
                semester: importedSemester,
                grade: gradeRecord.grade,
                suCredits: Number(globalRecord.SU_credit || 0),
                source: resolution.source,
            });
        }

        // LANG is the exact synthetic subject used for exchange/Erasmus
        // language courses. It is not a transfer-grade marker: retain the
        // transcript's real grade and create a contextual course definition for
        // every selected degree. Language courses are free electives outside
        // FENS, while FENS keeps them visible/GPA-bearing but deliberately
        // unallocated (`unknown`) so they cannot inflate graduation totals.
        //
        // Persist every selected-program definition before exposing the main
        // definition to courseData. This prevents a partially classified double
        // major course from appearing imported when one of the writes fails.
        if (isTranscriptLanguage) {
            const programs = transcriptSelectedDegreePrograms(curriculum);
            const normalizedCode = canonicalTranscriptCourseCode(course.code);
            const identity = normalizedCode.match(/^([A-Z]+)(\d[A-Z0-9]*)$/);
            const languageLevelSuggestion = suggestedTranscriptLanguageLevel(course.title);
            const storage = (typeof window !== 'undefined') ? window.planStorage : null;
            const sessionPlanId = storage && typeof storage.getSessionPlanId === 'function'
                ? storage.getSessionPlanId() : null;
            const prepared = [];

            try {
                if (!programs.length || !identity || !storage || !sessionPlanId
                    || typeof storage.normalizeCustomCourse !== 'function'
                    || typeof storage.getItem !== 'function'
                    || typeof storage.setItem !== 'function') {
                    throw new Error('Plan-scoped language-course storage is unavailable.');
                }

                programs.forEach((program) => {
                    const key = 'customCourses_' + program;
                    const previousRaw = storage.getItem(key, sessionPlanId);
                    const parsed = JSON.parse(previousRaw || '[]');
                    if (!Array.isArray(parsed)) throw new Error('Invalid saved custom-course list.');
                    const existingIndex = parsed.findIndex(record =>
                        transcriptCatalogRecordCode(record) === normalizedCode
                    );
                    const existing = existingIndex >= 0 ? parsed[existingIndex] : null;
                    const existingLevel = existing
                        && ['basic', 'other', ''].includes(String(existing.Language_Level || '').toLowerCase())
                        ? String(existing.Language_Level || '').toLowerCase() : '';
                    const transcriptSu = Number(course.suCredits);
                    const transcriptEcts = Number(course.ects);
                    const existingSu = Number(existing && existing.SU_credit);
                    const existingEcts = Number(existing && existing.ECTS);
                    const su = Number.isFinite(transcriptSu) && transcriptSu > 0
                        ? transcriptSu : (Number.isFinite(existingSu) ? existingSu : 0);
                    const ects = Number.isFinite(transcriptEcts) && transcriptEcts > 0
                        ? transcriptEcts : (Number.isFinite(existingEcts) ? existingEcts : 0);
                    // Re-import refreshes transcript-authoritative identity/name/
                    // credit fields, but an existing program definition owns its
                    // classification. In particular, do not turn MAN Area, CS
                    // Core, or a minor Required choice back into an inferred
                    // default just because the same transcript was imported
                    // again.
                    const definition = storage.normalizeCustomCourse({
                        Major: identity[1],
                        Code: identity[2],
                        Course_Name: String(course.title || (existing && existing.Course_Name) || normalizedCode),
                        ECTS: String(ects),
                        Engineering: existing ? existing.Engineering : 0,
                        Basic_Science: existing ? existing.Basic_Science : 0,
                        SU_credit: String(su),
                        Faculty: existing ? existing.Faculty : '',
                        EL_Type: existing ? existing.EL_Type : transcriptLanguageTypeForProgram(program),
                        Faculty_Course: 'No',
                        // A title suggestion is only a review-form prefill. It
                        // must not become durable until the user explicitly
                        // saves the review, because reloading with the modal
                        // open must leave an unreviewed LANG course fail-closed.
                        // Preserve a level that the user reviewed previously.
                        Language_Level: existingLevel,
                    });
                    const nextList = parsed.slice();
                    if (existingIndex >= 0) nextList[existingIndex] = definition;
                    else nextList.push(definition);
                    prepared.push({
                        program,
                        key,
                        previousRaw,
                        // Keep the exact record that existed before this
                        // transcript import. The review UI uses this per-course
                        // backup instead of restoring the whole list, because a
                        // single import can queue several LANG courses at once.
                        // Restoring an older whole-list snapshot would erase
                        // later queued courses.
                        previousCourse: existingIndex >= 0
                            ? JSON.parse(JSON.stringify(existing)) : null,
                        previousIndex: existingIndex,
                        definition,
                        nextList,
                    });
                });

                const written = [];
                try {
                    prepared.forEach((entry) => {
                        if (storage.setItem(
                            entry.key,
                            JSON.stringify(entry.nextList),
                            sessionPlanId
                        ) === false) {
                            throw new Error('Plan-scoped language-course storage rejected the write.');
                        }
                        written.push(entry);
                    });
                } catch (storageError) {
                    // Best-effort rollback to the exact prior values. A missing
                    // key must remain missing rather than becoming an empty list.
                    for (let rollbackIndex = written.length - 1; rollbackIndex >= 0; rollbackIndex--) {
                        const entry = written[rollbackIndex];
                        try {
                            if (entry.previousRaw === null || entry.previousRaw === undefined) {
                                if (typeof storage.removeItem === 'function') {
                                    storage.removeItem(entry.key, sessionPlanId);
                                }
                            } else {
                                storage.setItem(entry.key, entry.previousRaw, sessionPlanId);
                            }
                        } catch (_) {}
                    }
                    throw storageError;
                }

                const mainProgram = String((curriculum && curriculum.major) || '').trim().toUpperCase();
                const mainEntry = prepared.find(entry => entry.program === mainProgram) || prepared[0];
                const mainDefinition = mainEntry && mainEntry.definition;
                if (!mainDefinition) throw new Error('No main language-course definition was created.');

                let courseDataMutation = { kind: 'none', index: -1, previousCourse: null };
                if (Array.isArray(courseData)) {
                    const dataIndex = courseData.findIndex(record =>
                        transcriptCatalogRecordCode(record) === normalizedCode
                    );
                    if (dataIndex < 0) {
                        courseData.push(mainDefinition);
                        courseDataMutation = {
                            kind: 'inserted',
                            index: courseData.length - 1,
                            previousCourse: null,
                        };
                    } else if (courseData[dataIndex] && courseData[dataIndex].__globalCourseDefinition) {
                        courseDataMutation = {
                            kind: 'replaced',
                            index: dataIndex,
                            previousCourse: courseData[dataIndex],
                        };
                        courseData[dataIndex] = mainDefinition;
                    }
                }
                pendingCustomCourses.push({
                    course: mainDefinition,
                    programCourses: prepared.map(entry => ({
                        program: entry.program,
                        course: entry.definition,
                        previousRaw: entry.previousRaw,
                        previousCourse: entry.previousCourse,
                        previousIndex: entry.previousIndex,
                    })),
                    courseDataMutation,
                    parsedInfo: {
                        code: normalizedCode,
                        title: course.title,
                        suCredits: Number(mainDefinition.SU_credit || 0),
                        ects: Number(mainDefinition.ECTS || 0),
                        elType: mainDefinition.EL_Type,
                        // Explicit prior review wins; otherwise seed only the
                        // pending form. The stored/runtime definition remains
                        // unreviewed until the form is saved.
                        Language_Level: mainDefinition.Language_Level || languageLevelSuggestion,
                    },
                });
                courseExists = true;
            } catch (languageCourseError) {
                stats.skippedCourses.push({
                    code: course.code,
                    semester: importedSemester,
                    grade: gradeRecord.grade,
                    reason: 'custom-course-storage-failed'
                });
                return;
            }
        }

        // If a non-LANG course does not exist, attempt to automatically add it
        // as a custom course for the legacy special elective prefixes. We use
        // both short and full prefixes (e.g., COR/CORE, ARE/AREA) to match
        // variations in the transcript. If a match is found we create a
        // placeholder course using the known credit information and queue it
        // for user confirmation via the custom course modal.
        if (!courseExists) {
            const code = course.code || '';
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
            }
            if (elType) {
                const numMatch = code.match(/\d+[A-Z0-9]*/);
                const num = numMatch ? numMatch[0] : '';
                // Use the credit information from the parsed course when
                // available. Default to zero if missing.
                const su = (typeof course.suCredits === 'number' && !isNaN(course.suCredits)) ? course.suCredits : 0;
                const ectsVal = (typeof course.ects === 'number' && !isNaN(course.ects)) ? course.ects : 0;
                let newCourse = {
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
                try {
                    const storage = (typeof window !== 'undefined') ? window.planStorage : null;
                    if (!storage || typeof storage.normalizeCustomCourse !== 'function') {
                        throw new Error('Custom-course validation is unavailable.');
                    }
                    newCourse = storage.normalizeCustomCourse(newCourse);
                } catch (validationError) {
                    stats.notFoundCourses.push(course.code);
                    return;
                }
                // Persist the placeholder before exposing it to the live
                // catalog or planner. Otherwise a storage failure can create a
                // course that appears imported but disappears after reload.
                try {
                    const key = 'customCourses_' + curriculum.major;
                    const ps = (typeof window !== 'undefined') ? window.planStorage : null;
                    let existingRaw = null;
                    let sessionPlanId = null;
                    if (ps) {
                        sessionPlanId = ps.getSessionPlanId();
                        existingRaw = ps.getItem(key, sessionPlanId);
                    } else {
                        existingRaw = localStorage.getItem(key);
                    }
                    const existingList = JSON.parse(existingRaw || '[]');
                    existingList.push(newCourse);
                    if (ps) {
                        if (ps.setItem(key, JSON.stringify(existingList), sessionPlanId) === false) {
                            throw new Error('Plan-scoped custom-course storage rejected the write.');
                        }
                    } else {
                        localStorage.setItem(key, JSON.stringify(existingList));
                    }
                } catch (e) {
                    // A plan-scoped storage error must fail closed. Falling back
                    // to a legacy unscoped key could leak this course into a
                    // different plan after another tab changes the active plan.
                    stats.skippedCourses.push({
                        code: course.code,
                        semester: importedSemester,
                        grade: gradeRecord.grade,
                        reason: 'custom-course-storage-failed'
                    });
                    return;
                }
                // Only a durable placeholder may participate in this import.
                courseData.push(newCourse);
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
            const formattedSemester = formatTranscriptSemester(course.semester);

            // Group by semester
            if (!courseBySemester[formattedSemester]) {
                courseBySemester[formattedSemester] = {
                    name: formattedSemester,
                    order: getSemesterOrder(course.semester),
                    existingSemesterId: matchingTermSemesters.length === 1
                        ? matchingTermSemesters[0].id : '',
                    courses: [],
                    grades: {}, // Store grades for each course
                    gradingBases: {}
                };
            }
            // Store course and its canonical grade metadata.
            courseBySemester[formattedSemester].courses.push(course.code);
            courseBySemester[formattedSemester].grades[course.code] = gradeRecord.grade;
            courseBySemester[formattedSemester].gradingBases[course.code] = gradeRecord.gradingBasis;
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
            const gradingBasisList = semesterData.courses.map(courseCode => {
                return semesterData.gradingBases[courseCode] || '';
            });
            const inspectableCurriculum = curriculum && Array.isArray(curriculum.semesters);
            const priorSemesterIds = new Set(inspectableCurriculum
                ? curriculum.semesters.map(semester => semester && semester.id) : []);
            const existingTarget = inspectableCurriculum && semesterData.existingSemesterId
                ? curriculum.semesters.find(semester => (
                    semester && semester.id === semesterData.existingSemesterId
                    && curriculumSemesterTermCode(semester) === transcriptTermCode(semesterData.name)
                )) : null;
            const createFn = typeof createSemeter === 'function'
                ? createSemeter
                : ((typeof window !== 'undefined' && typeof window.createSemeter === 'function')
                    ? window.createSemeter : null);
            let createSucceeded = false;
            if (createFn) {
                try {
                    const previousContainerId = Number(curriculum && curriculum.container_id);
                    const created = createFn(
                        existingTarget ? true : false,
                        semesterData.courses,
                        curriculum,
                        courseData,
                        gradeList,
                        semesterData.name,
                        gradingBasisList,
                    );
                    // Browser production is inspectable and requires the
                    // created container. Parser-only consumers historically
                    // inject a void creation callback, where a non-throwing
                    // call is the only available success signal.
                    createSucceeded = inspectableCurriculum ? !!created : true;
                    if (createSucceeded && existingTarget) {
                        createSucceeded = mergeImportedSemesterIntoExisting(
                            curriculum,
                            created,
                            existingTarget,
                            courseData,
                            Number.isInteger(previousContainerId) ? previousContainerId : null,
                        );
                        if (!createSucceeded) {
                            discardCreatedTranscriptSemester(
                                curriculum,
                                created,
                                Number.isInteger(previousContainerId) ? previousContainerId : null,
                            );
                        }
                    }
                } catch (error) {
                    console.error('Failed to create imported semester:', error);
                }
            }

            semesterData.courses.forEach((courseCode) => {
                const added = inspectableCurriculum
                    ? curriculumCourseOccurrences(curriculum, courseCode).length > 0
                    : createSucceeded;
                if (added) {
                    stats.importedCourses++;
                    stats.addedCourses.push({
                        code: courseCode,
                        semester: semesterData.name,
                        grade: semesterData.grades[courseCode] || ''
                    });
                } else {
                    const pendingLanguageEntry = pendingCustomCourses.find(entry =>
                        entry && Array.isArray(entry.programCourses)
                        && canonicalTranscriptCourseCode(entry.parsedInfo && entry.parsedInfo.code)
                            === canonicalTranscriptCourseCode(courseCode)
                    );
                    if (pendingLanguageEntry) {
                        rollbackPendingTranscriptLanguageCourse(pendingLanguageEntry);
                    }
                    stats.skippedCourses.push({
                        code: courseCode,
                        semester: semesterData.name,
                        grade: semesterData.grades[courseCode] || '',
                        reason: createFn ? 'create-failed' : 'create-unavailable'
                    });
                }
            });
            if (inspectableCurriculum) {
                removeEmptySemestersCreatedAfter(curriculum, priorSemesterIds);
            }
        }
    }

    stats.updatedCourseCount = stats.updatedCourses.length;
    stats.alreadyPresentCourseCount = stats.alreadyPresentCourses.length;
    stats.supersededCourseCount = stats.supersededCourses.length;
    stats.skippedCourseCount = stats.skippedCourses.length;
    stats.changedCourses = stats.importedCourses + stats.updatedCourseCount;

    // Only a real planner change needs a recalculation. In particular, a file
    // whose records all have invalid semesters must leave the live plan wholly
    // untouched rather than causing an unrelated allocation pass.
    if (stats.changedCourses > 0) {
        try {
            if (typeof curriculum.recalcEffectiveTypes === 'function') {
                curriculum.recalcEffectiveTypes(courseData);
            }
        } catch (err) {
            // Preserve the import result; the normal planner render path will
            // recalculate again after the next successful mutation/reload.
        }
    }

    // Imports may update only grades/bases or remove an empty temporary term,
    // so semester/course creation hooks alone do not cover every mutation.
    try {
        const storage = (typeof window !== 'undefined') ? window.planStorage : null;
        if (stats.changedCourses > 0 && storage && typeof storage.requestSave === 'function') {
            storage.requestSave(storage.getSessionPlanId());
        }
    } catch (_) {}

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
