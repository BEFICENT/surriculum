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

function makeParsedCourse(details, gradeRecord) {
    const parsed = Object.assign({}, details, { grade: gradeRecord.grade });
    if (gradeRecord.gradingBasis) parsed.gradingBasis = gradeRecord.gradingBasis;
    return parsed;
}

function canonicalTranscriptCourseCode(rawCode) {
    const code = String(rawCode || '').trim().toUpperCase().replace(/\s+/g, '');
    return code === 'CS210' ? 'DSA210' : code;
}

function transcriptSemesterOrder(rawSemester) {
    const match = String(rawSemester || '').match(/(Fall|Spring|Summer)\s+(\d{4})-\d{4}/i);
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
                if (skipReason) {
                    addTranscriptSkip(result, courseCode, rawGrade, semester, skipReason);
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

                // Correct the condition to skip courses with ELAE code
                if (courseCode.includes('ELAE')) {
                    return; // Skip this iteration
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
    const semesterRegex = /\((\d{4}-\d{4}) (Fall|Spring|Summer) (Term|School)\)/;
    const result = newTranscriptResult();
    const candidates = [];
    let sourceOrder = 0;
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
    const semesterRegex = /^(Fall|Spring|Summer)\s+\d{4}-\d{4}$/;
    // PDF transcripts include a "level" column such as UG/GR which we ignore.
    const levelTokens = new Set(['UG', 'GR', 'FDY', 'PG', 'PR', 'SA', 'SR', 'MS', 'MD', 'DR']);
    const result = newTranscriptResult();
    const candidates = [];
    let sourceOrder = 0;
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
        const isGradeToken = (tok) => {
            if (!String(tok || '').trim()) return false;
            return normalizeTranscriptGrade(tok) !== null;
        };
        const readGradeAt = (idx) => {
            const a = tokens[idx] || '';
            const aU = upper(a);
            const bU = upper(tokens[idx + 1] || '');
            if ((aU === 'A' || aU === 'B' || aU === 'C' || aU === 'D') && (bU === '+' || bU === '-')) {
                const g = aU + bU;
                const gradeRecord = normalizeTranscriptGradeRecord(g);
                return gradeRecord
                    ? { gradeRecord: gradeRecord, next: idx + 2 }
                    : { invalidGrade: g, next: idx + 2 };
            }
            const gradeRecord = normalizeTranscriptGradeRecord(a);
            if (String(a).trim() && gradeRecord) return { gradeRecord: gradeRecord, next: idx + 1 };
            // At this point the cursor is immediately after the level/title.
            // A non-numeric token is therefore a grade candidate; reject it
            // explicitly instead of silently importing the course as ungraded.
            if (String(a).trim() && isNaN(parseFloat(a))) {
                return { invalidGrade: a, next: idx + 1 };
            }
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

        const out = newTranscriptResult();
        const tokenCandidates = [];
        let tokenSourceOrder = 0;
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

            let gradeRecord = normalizeTranscriptGradeRecord('');
            let invalidGrade = null;
            const g = readGradeAt(cursor);
            if (g) {
                if (g.gradeRecord) gradeRecord = g.gradeRecord;
                else invalidGrade = g.invalidGrade;
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
            const skipReason = statusText.includes('excluded')
                ? 'excluded' : (statusText.includes('repeated') && !statusText.includes('regardless of whether the course is repeated later')
                    ? 'repeated' : '');
            if (skipReason) {
                addTranscriptSkip(out, code,
                    invalidGrade !== null ? invalidGrade : (gradeRecord ? gradeRecord.grade : ''),
                    sem, skipReason);
                i = j;
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

            i = j;
        }

        return finalizeTranscriptResult(out, tokenCandidates);
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

            let gradeRecord = normalizeTranscriptGradeRecord('');
            let invalidGrade = null;
            if (i < lines.length && isNaN(parseFloat(lines[i]))) {
                const candidate = normalizeTranscriptGradeRecord(lines[i]);
                if (candidate) gradeRecord = candidate;
                else invalidGrade = lines[i];
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
            const skipReason = statusText.includes('excluded')
                ? 'excluded' : (statusText.includes('repeated') && !statusText.includes('regardless of whether the course is repeated later')
                    ? 'repeated' : '');
            if (skipReason) {
                addTranscriptSkip(result, code,
                    invalidGrade !== null ? invalidGrade : (gradeRecord ? gradeRecord.grade : ''),
                    currentSemester, skipReason);
                continue;
            }

            // Correct the condition to skip courses with ELAE code
            if (code.includes('ELAE')) {
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
    const match = value.match(/(Fall|Spring|Summer)\s+(\d{4}-\d{4})/i);
    if (!match) return value;
    const term = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
    return term + ' ' + match[2];
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
    try {
        if (typeof document !== 'undefined' && semester.id) {
            const node = document.getElementById(semester.id);
            const label = node && node.closest('.container_semester')
                ? node.closest('.container_semester').querySelector('.date p') : null;
            if (label) return formatTranscriptSemester(label.textContent);
        }
    } catch (_) {}
    return '';
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
    const importCandidates = inputCourses.map((course, sourceOrder) => makeTranscriptCandidate(
        Object.assign({}, course, { code: canonicalTranscriptCourseCode(course && course.code) }),
        course && course.grade,
        course && course.gradingBasis,
        { sourceOrder }
    ));
    const reconciled = reconcileTranscriptCandidates(importCandidates);
    const uniqueCodes = new Set(importCandidates.map(candidate => candidate.code).filter(Boolean));

    const stats = {
        totalRecords: inputCourses.length,
        totalCourses: uniqueCodes.size,
        importedCourses: 0,
        updatedCourses: [],
        addedCourses: [],
        alreadyPresentCourses: [],
        supersededCourses: reconciled.supersededCourses.slice(),
        skippedCourses: [],
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
            if (existingSemester && importedSemester && existingSemester === importedSemester) {
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

        // A course that is real but absent from the selected program/admit-term
        // catalogs must not be confused with an invalid course. The cumulative
        // course-page index is the catalog-independent identity layer. Main
        // loads it before import; the resolver returns a catalog-shaped record
        // with static type `unknown`, which deliberately yields effective N/A:
        // it can carry transcript credits into CGPA without claiming PGPA or
        // graduation-pool membership.
        if (globalRecord) {
            stats.retainedUnallocatedCourses.push({
                code: course.code,
                semester: importedSemester,
                grade: gradeRecord.grade,
                suCredits: Number(globalRecord.SU_credit || 0),
                source: resolution.source,
            });
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
                        if (ps) {
                            try { return ps.setItem(k, v); } catch (_) { return null; }
                        }
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
            const formattedSemester = formatTranscriptSemester(course.semester);

            // Group by semester
            if (!courseBySemester[formattedSemester]) {
                courseBySemester[formattedSemester] = {
                    name: formattedSemester,
                    order: getSemesterOrder(course.semester),
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
            const createFn = typeof createSemeter === 'function'
                ? createSemeter
                : ((typeof window !== 'undefined' && typeof window.createSemeter === 'function')
                    ? window.createSemeter : null);
            let createSucceeded = false;
            if (createFn) {
                try {
                    createFn(false, semesterData.courses, curriculum, courseData, gradeList, semesterData.name, gradingBasisList);
                    createSucceeded = true;
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

    stats.updatedCourseCount = stats.updatedCourses.length;
    stats.alreadyPresentCourseCount = stats.alreadyPresentCourses.length;
    stats.supersededCourseCount = stats.supersededCourses.length;
    stats.skippedCourseCount = stats.skippedCourses.length;
    stats.changedCourses = stats.importedCourses + stats.updatedCourseCount;

    // Imports may update only grades/bases or remove an empty temporary term,
    // so semester/course creation hooks alone do not cover every mutation.
    try {
        const storage = (typeof window !== 'undefined') ? window.planStorage : null;
        if (storage && typeof storage.requestSave === 'function') storage.requestSave();
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
