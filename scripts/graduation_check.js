// Remove ES module imports. Instead, rely on global functions and objects
// that are attached to the `window` (e.g., buildFlagMessages and
// requirements). This is necessary when running under the file:// scheme
// where ES module imports may not be available.

// Display graduation check results in a modal
function displayGraduationResults(curriculum) {
    if(!document.querySelector('.graduation_modal')) {
        const overlay = document.createElement("div");
        overlay.classList.add('graduation_modal_overlay');
        const modal = document.createElement("div");
        modal.classList.add('graduation_modal');
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        // Compose results for primary major
        let html = '';
        const flagMain = curriculum.canGraduate();
        const msgMain = buildFlagMessages(curriculum.major) || {};
        html += '<div><strong>' + curriculum.major + ':</strong> ';
        if (flagMain === 0) {
            html += 'Congrats! You can graduate!!!';
        } else {
            const fcn = msgMain[flagMain];
            html += 'You cannot graduate: ' + (fcn ? fcn() : `Error code ${flagMain}`);
        }
        html += '</div>';
        // If double major selected, compute second major result
        if (curriculum.doubleMajor) {
            // Compose results for double major
            const flagMain = curriculum.canGraduateDouble();
            const msgMain = buildFlagMessages(curriculum.doubleMajor) || {};
            html += '<div><strong>' + curriculum.doubleMajor + ':</strong> ';
            if (flagMain === 0) {
                html += 'Congrats! You can graduate!!!';
            } else {
                const fcn = msgMain[flagMain];
                html += 'You cannot graduate: ' + (fcn ? fcn() : `Error code ${flagMain}`);
            }
        }

        // Optional: show minor completion status (does not affect graduation).
        function getGradeTextForCourseId(courseId) {
            try {
                const elem = document.getElementById(courseId);
                if (!elem) return '';
                const gr = elem.querySelector('.grade');
                return gr ? gr.textContent.trim() : '';
            } catch (_) {
                return '';
            }
        }

        function evaluateMinor(minorCode) {
            const reqMap = (typeof window !== 'undefined' && window.minorRequirements) ? window.minorRequirements : {};
            const req = reqMap ? reqMap[minorCode] : null;
            const dataByCode = curriculum && curriculum.minorCourseDataByCode ? curriculum.minorCourseDataByCode : {};
            const courseData = dataByCode ? dataByCode[minorCode] : null;
            if (!req || !Array.isArray(courseData)) {
                return { ok: false, title: minorCode, lines: ['Missing minor data files.'] };
            }

            // Collect passed/planned courses (ignore grade F).
            const taken = new Set();
            try {
                for (let i = 0; i < curriculum.semesters.length; i++) {
                    const sem = curriculum.semesters[i];
                    for (let j = 0; j < sem.courses.length; j++) {
                        const c = sem.courses[j];
                        if (!c || !c.code) continue;
                        const grade = getGradeTextForCourseId(c.id);
                        if (grade === 'F') continue;
                        taken.add(String(c.code).toUpperCase().replace(/\s+/g, ''));
                    }
                }
            } catch (_) {}

            const parseInt0 = (v) => {
                const n = parseInt(v || '0', 10);
                return isNaN(n) ? 0 : n;
            };

            const normalizeCode = (rec) => {
                try {
                    return String((rec.Major || '') + (rec.Code || '')).toUpperCase().replace(/\s+/g, '');
                } catch (_) {
                    return '';
                }
            };

            const courseByCode = new Map();
            const pools = {};
            for (let i = 0; i < courseData.length; i++) {
                const c = courseData[i];
                const code = normalizeCode(c);
                if (!code) continue;
                courseByCode.set(code, c);
                const cat = (c.EL_Type || '').toLowerCase();
                if (!cat) continue;
                if (!pools[cat]) pools[cat] = [];
                pools[cat].push(code);
            }

            const categories = req.categories || {};
            const lines = [];

            // Build equivalence lookup per category.
            const eqGroupByCat = {};
            const eqGroupLookup = {};
            for (const catKey of ['required', 'core', 'area', 'free']) {
                const cfg = categories[catKey] || {};
                const eq = Array.isArray(cfg.equivalents) ? cfg.equivalents : [];
                eqGroupByCat[catKey] = eq;
                const lookup = new Map();
                for (let i = 0; i < eq.length; i++) {
                    const group = Array.isArray(eq[i]) ? eq[i] : [];
                    for (let j = 0; j < group.length; j++) {
                        lookup.set(String(group[j]).toUpperCase().replace(/\s+/g, ''), i);
                    }
                }
                eqGroupLookup[catKey] = lookup;
            }

            // Allocate taken minor courses similar to how majors work:
            // - Required fills required first, then can overflow to Core/Area/Free
            // - Core fills core first, then can overflow to Area/Free
            // - Area fills area first, then can overflow to Free
            // - Free always stays free
            // This allows "extra core courses" to count towards area, etc.
            const fullOrder = ['required', 'core', 'area', 'free'];
            const nextInOrder = (cat) => {
                const idx = fullOrder.indexOf(cat);
                return idx >= 0 && idx < fullOrder.length - 1 ? fullOrder[idx + 1] : null;
            };
            const cfgFor = (cat) => categories[cat] || { minSU: 0, minCourses: 0, equivalents: [], allListedRequired: false };
            const needsMet = (cat, totals) => {
                const cfg = cfgFor(cat);
                const needC = parseInt0(cfg.minCourses);
                const needS = parseInt0(cfg.minSU);
                const have = totals[cat] || { courses: 0, credits: 0 };
                return (have.courses >= needC) && (have.credits >= needS);
            };

            const totals = {
                required: { courses: 0, credits: 0 },
                core: { courses: 0, credits: 0 },
                area: { courses: 0, credits: 0 },
                free: { courses: 0, credits: 0 }
            };
            const usedEqGroup = {
                required: new Set(),
                core: new Set(),
                area: new Set(),
                free: new Set()
            };

            const takenMinorCourses = [];
            for (const code of taken) {
                const rec = courseByCode.get(code);
                if (!rec) continue;
                const baseCat = String(rec.EL_Type || '').toLowerCase();
                const credit = parseInt0(rec.SU_credit);
                takenMinorCourses.push({ code, baseCat, credit });
            }
            const catSortIdx = (cat) => {
                const idx = fullOrder.indexOf(cat);
                return idx === -1 ? 999 : idx;
            };
            takenMinorCourses.sort((a, b) => {
                const ai = catSortIdx(a.baseCat);
                const bi = catSortIdx(b.baseCat);
                if (ai !== bi) return ai - bi;
                return String(a.code).localeCompare(String(b.code));
            });

            const canCountEquivalenceIn = (cat, code) => {
                const lookup = eqGroupLookup[cat];
                if (!lookup) return true;
                const groupId = lookup.get(code);
                if (groupId === undefined) return true;
                return !usedEqGroup[cat].has(groupId);
            };
            const markEquivalenceUsed = (cat, code) => {
                const lookup = eqGroupLookup[cat];
                if (!lookup) return;
                const groupId = lookup.get(code);
                if (groupId === undefined) return;
                usedEqGroup[cat].add(groupId);
            };

            for (let i = 0; i < takenMinorCourses.length; i++) {
                const c = takenMinorCourses[i];
                let cat = fullOrder.includes(c.baseCat) ? c.baseCat : 'free';
                while (cat) {
                    // Equivalent-group rule: at most 1 from each group can count
                    // for that category. If already used, overflow to next.
                    if (!canCountEquivalenceIn(cat, c.code)) {
                        cat = nextInOrder(cat);
                        continue;
                    }
                    // Overflow to help satisfy later pools when current is full.
                    const next = nextInOrder(cat);
                    if (next && needsMet(cat, totals)) {
                        cat = next;
                        continue;
                    }
                    totals[cat].courses += 1;
                    totals[cat].credits += c.credit;
                    markEquivalenceUsed(cat, c.code);
                    break;
                }
            }

            // Validate and render per-category status, including "all courses
            // below are required" enforcement where present.
            let allOk = true;
            const toLabel = (catKey) => catKey.charAt(0).toUpperCase() + catKey.slice(1);
            for (const catKey of fullOrder) {
                const cfg = categories[catKey];
                const needC = parseInt0(cfg && cfg.minCourses);
                const needS = parseInt0(cfg && cfg.minSU);
                const have = totals[catKey];
                const shouldShow = !!cfg || needC > 0 || needS > 0;
                if (!shouldShow) continue;

                let ok = true;
                if (needC) ok = ok && (have.courses >= needC);
                if (needS) ok = ok && (have.credits >= needS);

                // If the page stated "all courses below are required", enforce that
                // all non-equivalent required courses are taken and each equivalent
                // group has at least one taken.
                if (catKey === 'required' && cfg && cfg.allListedRequired) {
                    const eq = Array.isArray(cfg.equivalents) ? cfg.equivalents : [];
                    const eqFlat = new Set(eq.flat().map(x => String(x).toUpperCase().replace(/\s+/g, '')));
                    const poolCodes = pools.required || [];
                    // Non-equivalent required courses
                    for (let i = 0; i < poolCodes.length; i++) {
                        const code = poolCodes[i];
                        if (eqFlat.has(code)) continue;
                        if (!taken.has(code)) ok = false;
                    }
                    // Each equivalent group
                    for (let i = 0; i < eq.length; i++) {
                        const group = Array.isArray(eq[i]) ? eq[i].map(x => String(x).toUpperCase().replace(/\s+/g, '')) : [];
                        if (group.length && !group.some(c => taken.has(c))) ok = false;
                    }
                }

                lines.push(`${toLabel(catKey)}: ${have.courses}/${needC || 0} course(s), ${have.credits}/${needS || 0} SU credits`);
                if (!ok) allOk = false;
            }

            // Overall minimums (if present on the summary table).
            const totalCourses = totals.required.courses + totals.core.courses + totals.area.courses + totals.free.courses;
            const totalCredits = totals.required.credits + totals.core.credits + totals.area.credits + totals.free.credits;
            const minAllC = parseInt0(req.minCourses);
            const minAllS = parseInt0(req.minSU);
            if (minAllC || minAllS) {
                lines.push(`Total: ${totalCourses}/${minAllC || 0} course(s), ${totalCredits}/${minAllS || 0} SU credits`);
                if (minAllC && totalCourses < minAllC) allOk = false;
                if (minAllS && totalCredits < minAllS) allOk = false;
            }

            if (!Object.keys(categories).length) allOk = false;
            return { ok: allOk, title: req.name || minorCode, lines };
        }

        if (Array.isArray(curriculum.minors) && curriculum.minors.length) {
            html += '<hr style="margin:12px 0; border:none; border-top:1px solid rgba(0,0,0,0.15);">';
            html += '<div><strong>Minors:</strong></div>';
            curriculum.minors.forEach((minorCode) => {
                const res = evaluateMinor(minorCode);
                html += `<div style="margin-top:6px;"><strong>${minorCode}:</strong> ${res.ok ? 'Completed' : 'Not complete'}</div>`;
                if (Array.isArray(res.lines)) {
                    html += '<div style="margin-left:12px; font-size:0.92em;">' + res.lines.map(l => `<div>${l}</div>`).join('') + '</div>';
                }
            });
        }
        modal.innerHTML = html;
    }
}

// Function to display summary of credits
function displaySummary(curriculum, major_chosen_by_user) {
    // Do not create more than one set of summary modals. If any exist, abort.
    if (document.querySelector('.summary_modal')) return;
    const majorNames = {
        CS: 'Computer Science and Engineering',
        DSA: 'Data Science and Analytics',
        ECON: 'Economics',
        EE: 'Electronics Engineering',
        IE: 'Industrial Engineering',
        MAN: 'Management',
        MAT: 'Materials Science and Nano Engineering',
        ME: 'Mechatronics Engineering',
        BIO: 'Molecular Biology, Genetics and Bioengineering',
        PSIR: 'Political Science and International Relations',
        PSY: 'Psychology',
        VACD: 'Visual Arts and Visual Communications Design'
    };
    // Helper to build a summary modal for a given set of totals and limits.
    function buildSummaryModal(totals, limits, gpa, majorCode) {
        // Overlay is shared by all summary modals. Create it on demand and
        // append to the body so it covers the full viewport. The overlay uses
        // flexbox centering so modals appear in the middle of the screen.
        let overlay = document.querySelector('.summary_modal_overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.classList.add('summary_modal_overlay');
            document.body.appendChild(overlay);
        }
        const modal = document.createElement('div');
        modal.classList.add('summary_modal');
        overlay.appendChild(modal);
        if (majorCode) {
            const header = document.createElement('div');
            header.classList.add('summary_modal_title');
            header.textContent = majorNames[majorCode] || majorCode;
            modal.appendChild(header);
        }
        // Build content
        const labels = ['GPA: ', 'SU Credits: ', 'ECTS: ', 'University: ',  'Required: ', 'Core: ', 'Area: ', 'Free: ',  'Basic Science: ', 'Engineering: '];
        const total_values = [gpa, totals.total, totals.ects, totals.university, totals.required, totals.core, totals.area, totals.free, totals.science, totals.engineering];
        for (let i = 0; i < 10; i++) {
            const child = document.createElement('div');
            child.classList.add('summary_modal_child');
            if (i === 0) {
                child.innerHTML = '<p>GPA: ' + gpa + ' / 4.00</p>';
            } else {
                child.innerHTML = '<p>' + labels[i] + total_values[i] + ' / ' + limits[i] + '</p>';
            }
            modal.appendChild(child);
        }
        return modal;
    }
    // Compute overall GPA and totals for primary major
    let totalsMain = {
        area: 0, core: 0, free: 0, university: 0, required: 0,
        total: 0, science: 0, engineering: 0, ects: 0
    };
    let gpaCredits = 0;
    let gpaValue = 0.0;
    for (let i = 0; i < curriculum.semesters.length; i++) {
        const sem = curriculum.semesters[i];
        totalsMain.total += sem.totalCredit;
        totalsMain.area += sem.totalArea;
        totalsMain.core += sem.totalCore;
        totalsMain.free += sem.totalFree;
        totalsMain.university += sem.totalUniversity;
        totalsMain.required += sem.totalRequired;
        totalsMain.science += sem.totalScience;
        totalsMain.engineering += sem.totalEngineering;
        totalsMain.ects += sem.totalECTS;
        gpaCredits += sem.totalGPACredits;
        gpaValue += sem.totalGPA;
    }
    const gpaMain = gpaCredits ? (gpaValue / gpaCredits).toFixed(3) : '0.000';
    // Determine limits from requirements for primary major
    // Access the requirements object via the global scope to avoid reference
    // errors when this script runs in environments without an imported
    // variable.
    const allReq = (typeof globalThis !== 'undefined' && globalThis.requirements)
        ? globalThis.requirements
        : {};

    function lookupReq(major, term) {
        if (allReq[major]) return allReq[major];
        if (term && allReq[term] && allReq[term][major]) return allReq[term][major];
        for (const t of Object.keys(allReq)) {
            if (allReq[t] && allReq[t][major]) return allReq[t][major];
        }
        return {};
    }

    const reqMain = lookupReq(major_chosen_by_user, curriculum.entryTerm);
    const limitsMain = [
        '4.0',
        String(reqMain.total || 0),
        String(reqMain.ects || 0),
        String(reqMain.university || 0),
        String(reqMain.required || 0),
        String(reqMain.core || 0),
        String(reqMain.area || 0),
        String(reqMain.free || 0),
        String(reqMain.science || 0),
        String(reqMain.engineering || 0)
    ];
    // Build primary summary modal
    buildSummaryModal(totalsMain, limitsMain, gpaMain, major_chosen_by_user);
    // If a double major exists, compute totals for DM and show a second modal
    if (curriculum.doubleMajor) {
        let totalsDM = {
            area: 0, core: 0, free: 0, university: 0, required: 0,
            total: 0, science: 0, engineering: 0, ects: 0
        };
        let gpaCreditsDM = 0;
        let gpaValueDM = 0.0;
        for (let i = 0; i < curriculum.semesters.length; i++) {
            const sem = curriculum.semesters[i];
            // Total credits always sum all courses
            totalsDM.total += sem.totalCredit;
            // Use DM allocations for core/area/free
            totalsDM.core += sem.totalCoreDM || 0;
            totalsDM.area += sem.totalAreaDM || 0;
            totalsDM.free += sem.totalFreeDM || 0;
            // For required and university, use DM-specific totals if present.
            // Fall back to the primary totals if DM totals are undefined,
            // ensuring backward compatibility.
            totalsDM.university += (sem.totalUniversityDM !== undefined ? sem.totalUniversityDM : sem.totalUniversity);
            totalsDM.required += (sem.totalRequiredDM !== undefined ? sem.totalRequiredDM : sem.totalRequired);
            // Science, engineering and ECTS are inherent to the course and
            // counted the same for both majors.  They remain unchanged.
            totalsDM.science += sem.totalScience;
            totalsDM.engineering += sem.totalEngineering;
            totalsDM.ects += sem.totalECTS;
            gpaCreditsDM += sem.totalGPACredits;
            gpaValueDM += sem.totalGPA;
        }
        const gpaDM = gpaCreditsDM ? (gpaValueDM / gpaCreditsDM).toFixed(3) : '0.000';
        // Determine limits for DM (SU +30, ECTS +60)
        const dmReq = lookupReq(curriculum.doubleMajor, curriculum.entryTermDM);
        const limitsDM = [
            '4.0',
            String((dmReq.total || 0) + 30),
            String((dmReq.ects || 0) + 60),
            String(dmReq.university || 0),
            String(dmReq.required || 0),
            String(dmReq.core || 0),
            String(dmReq.area || 0),
            String(dmReq.free || 0),
            String(dmReq.science || 0),
            String(dmReq.engineering || 0)
        ];
        buildSummaryModal(totalsDM, limitsDM, gpaDM, curriculum.doubleMajor);
    }
}

// Attach the functions to the global window so that other scripts can
// call them without using ES module syntax. This is important when
// running under file:// where module imports may fail.
if (typeof window !== 'undefined') {
    window.displayGraduationResults = displayGraduationResults;
    window.displaySummary = displaySummary;
}
