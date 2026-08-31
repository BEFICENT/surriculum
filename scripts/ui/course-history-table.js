// Shared course-offering history presentation used by both Planner and
// Scheduler course-detail surfaces. Term normalization is provided by the
// preceding academic-terms compatibility bridge.
(function installCourseHistoryTable(root) {
    'use strict';

function buildCourseHistoryTableElement(rows, options) {
    try {
        const list = Array.isArray(rows) ? rows : [];
        const document = root && root.document;
        if (!list.length || !document) return null;
        const opts = options && typeof options === 'object' ? options : {};
        const splitTerms = opts.splitTerms !== false;
        const hasSectionSeats = list.some((entry) => {
            try {
                return !!(
                    entry &&
                    (
                        entry.showSeats ||
                        entry.section ||
                        entry.crn ||
                        Object.prototype.hasOwnProperty.call(entry, 'capacity') ||
                        Object.prototype.hasOwnProperty.call(entry, 'actual') ||
                        Object.prototype.hasOwnProperty.call(entry, 'remaining')
                    )
                );
            } catch (_) {
                return false;
            }
        });
        const seatPartText = (value) => {
            if (value === null || typeof value === 'undefined' || value === '') return 'N/A';
            const n = Number(value);
            return Number.isFinite(n) ? String(n) : 'N/A';
        };
        const isFutureTerm = (entry) => {
            try {
                const normalizeTerm = root && typeof root.normalizeTermIdentifier === 'function'
                    ? root.normalizeTermIdentifier : () => '';
                const code = entry && entry.termCode ? String(entry.termCode) : normalizeTerm(entry && entry.term ? entry.term : '');
                const current = root && root.currentTermCode ? String(root.currentTermCode) : '';
                return /^\d{6}$/.test(code) && /^\d{6}$/.test(current) && parseInt(code, 10) > parseInt(current, 10);
            } catch (_) {
                return false;
            }
        };
        const seatsText = (entry) => {
            const actual = isFutureTerm(entry) ? '-' : seatPartText(entry ? entry.actual : null);
            const capacity = seatPartText(entry ? entry.capacity : null);
            return `${actual} / ${capacity}`;
        };

        const buildTable = (tableRows) => {
            const wrap = document.createElement('div');
            wrap.className = 'course-history-table-wrap';

            const table = document.createElement('div');
            table.className = 'course-history-table' + (hasSectionSeats ? ' course-history-table--sections' : '');
            table.setAttribute('role', 'table');
            table.setAttribute('aria-label', hasSectionSeats ? 'Offered terms, sections, instructors, and seats' : 'Offered terms and instructors');

            const head = document.createElement('div');
            head.className = 'course-history-row course-history-row--head';
            if (hasSectionSeats) head.classList.add('course-history-row--group');
            head.setAttribute('role', 'row');

        const headTerm = document.createElement('div');
        headTerm.className = 'course-history-cell course-history-cell--term';
        headTerm.setAttribute('role', 'columnheader');
        headTerm.textContent = 'Term';

        const headInstructor = document.createElement('div');
        headInstructor.className = 'course-history-cell';
        headInstructor.setAttribute('role', 'columnheader');
        headInstructor.textContent = hasSectionSeats ? 'Section / Instructor(s)' : 'Instructor(s)';

        head.appendChild(headTerm);
        if (hasSectionSeats) {
            const headNested = document.createElement('div');
            headNested.className = 'course-history-section-rows';
            const headSectionRow = document.createElement('div');
            headSectionRow.className = 'course-history-section-row';
            headSectionRow.appendChild(headInstructor);

            const cell = document.createElement('div');
            cell.className = 'course-history-cell course-history-cell--number';
            cell.setAttribute('role', 'columnheader');
            cell.title = 'Actual / Capacity';
            cell.setAttribute('aria-label', 'Actual / Capacity');
            cell.textContent = 'A/C';
            headSectionRow.appendChild(cell);
            headNested.appendChild(headSectionRow);
            head.appendChild(headNested);
        } else {
            head.appendChild(headInstructor);
        }
            table.appendChild(head);

        const appendInstructorContent = (instructorCell, entry) => {
            instructorCell.className = 'course-history-cell';
            instructorCell.setAttribute('role', 'cell');

            if (hasSectionSeats) {
                const sectionLine = document.createElement('div');
                sectionLine.className = 'course-history-section-label';
                const section = entry && entry.section ? String(entry.section) : '';
                const crn = entry && entry.crn ? String(entry.crn) : '';
                const labelParts = [];
                if (section) labelParts.push(`Section ${section}`);
                if (crn) labelParts.push(`CRN ${crn}`);
                sectionLine.textContent = labelParts.join(' · ') || (entry && entry.summaryOnly ? 'Term summary' : 'Section not available');
                instructorCell.appendChild(sectionLine);
            }

            const instructors = entry && Array.isArray(entry.instructors) ? entry.instructors : [];
            if (instructors.length) {
                instructors.forEach((name) => {
                    const line = document.createElement('div');
                    if (hasSectionSeats) line.className = 'course-history-instructor-line';
                    line.textContent = String(name || '');
                    instructorCell.appendChild(line);
                });
            } else {
                const muted = document.createElement('div');
                muted.className = 'muted';
                muted.textContent = 'Not available';
                instructorCell.appendChild(muted);
            }
        };

            if (hasSectionSeats) {
            const groups = [];
            tableRows.forEach((entry) => {
                const termKey = entry && entry.termCode ? String(entry.termCode) : String(entry && entry.term ? entry.term : '');
                const last = groups.length ? groups[groups.length - 1] : null;
                if (last && last.termKey === termKey) {
                    last.items.push(entry);
                } else {
                    groups.push({ termKey, termLabel: entry && entry.term ? String(entry.term) : 'Unknown term', items: [entry] });
                }
            });

            groups.forEach((group) => {
                const row = document.createElement('div');
                row.className = 'course-history-row course-history-row--group';
                row.setAttribute('role', 'rowgroup');

                const termCell = document.createElement('div');
                termCell.className = 'course-history-cell course-history-cell--term';
                termCell.setAttribute('role', 'cell');
                termCell.textContent = group.termLabel || 'Unknown term';
                row.appendChild(termCell);

                const sectionRows = document.createElement('div');
                sectionRows.className = 'course-history-section-rows';

                group.items.forEach((entry) => {
                    const sectionRow = document.createElement('div');
                    sectionRow.className = 'course-history-section-row';
                    sectionRow.setAttribute('role', 'row');

                    const instructorCell = document.createElement('div');
                    appendInstructorContent(instructorCell, entry);

                    const seatCell = document.createElement('div');
                    seatCell.className = 'course-history-cell course-history-cell--number';
                    seatCell.setAttribute('role', 'cell');
                    seatCell.textContent = seatsText(entry || {});

                    sectionRow.appendChild(instructorCell);
                    sectionRow.appendChild(seatCell);
                    sectionRows.appendChild(sectionRow);
                });

                row.appendChild(sectionRows);
                table.appendChild(row);
            });
            } else {
            tableRows.forEach((entry) => {
                const row = document.createElement('div');
                row.className = 'course-history-row';
                row.setAttribute('role', 'row');

                const termCell = document.createElement('div');
                termCell.className = 'course-history-cell course-history-cell--term';
                termCell.setAttribute('role', 'cell');
                termCell.textContent = entry && entry.term ? String(entry.term) : 'Unknown term';

                const instructorCell = document.createElement('div');
                appendInstructorContent(instructorCell, entry);

                row.appendChild(termCell);
                row.appendChild(instructorCell);
                table.appendChild(row);
            });
            }

            wrap.appendChild(table);
            return wrap;
        };

        const isFutureRow = (entry) => isFutureTerm(entry);
        if (!splitTerms) {
            return buildTable(list);
        }

        const offeredRows = list.filter(entry => !isFutureRow(entry));
        const futureRows = list.filter(entry => isFutureRow(entry));

        const container = document.createElement('div');
        container.className = 'course-history-disclosure-list';

        const addDisclosure = (title, rowsForTable, open) => {
            if (!rowsForTable.length) return;
            const details = document.createElement('details');
            details.className = 'course-history-disclosure';
            if (open) details.open = true;
            const summary = document.createElement('summary');
            summary.className = 'course-history-disclosure-summary';
            const termCount = new Set(rowsForTable.map(row => row && (row.termCode || row.term)).filter(Boolean)).size;
            summary.textContent = `${title} (${termCount})`;
            details.appendChild(summary);
            details.appendChild(buildTable(rowsForTable));
            container.appendChild(details);
        };

        addDisclosure('To Be Offered Terms', futureRows, !!opts.openFuture);
        addDisclosure('Offered Terms', offeredRows, opts.openOffered !== false);
        return container;
    } catch (_) {
        return null;
    }
}

    const namespace = root.SurriculumModules || (root.SurriculumModules = {});
    const api = Object.freeze({ buildCourseHistoryTableElement });
    namespace.courseHistoryTable = api;
    root.buildCourseHistoryTableElement = api.buildCourseHistoryTableElement;
})(typeof window !== 'undefined' ? window : globalThis);
