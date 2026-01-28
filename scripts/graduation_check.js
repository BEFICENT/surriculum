// Remove ES module imports. Instead, rely on global functions and objects
// that are attached to the `window` (e.g., buildFlagMessages and
// requirements). This is necessary when running under the file:// scheme
// where ES module imports may not be available.

// Compute how taken courses are allocated for a minor, including the
// "overflow" behavior (Core → Area → Free) and equivalence rules.
function computeMinorAllocation(curriculum, minorCode) {
    const reqMap = (typeof window !== 'undefined' && window.minorRequirements) ? window.minorRequirements : {};
    const req = reqMap ? reqMap[minorCode] : null;
    const dataByCode = curriculum && curriculum.minorCourseDataByCode ? curriculum.minorCourseDataByCode : {};
    const courseData = dataByCode ? dataByCode[minorCode] : null;

    const parseInt0 = (v) => {
        const n = parseInt(v || '0', 10);
        return isNaN(n) ? 0 : n;
    };
    const normalizeCode = (v) => String(v || '').toUpperCase().replace(/\s+/g, '');

    if (!req || !Array.isArray(courseData)) {
        return { ok: false, title: minorCode, error: 'Missing minor data files.' };
    }

    // Collect passed/planned courses (ignore grade F).
    const taken = new Set();
    try {
        for (let i = 0; i < curriculum.semesters.length; i++) {
            const sem = curriculum.semesters[i];
            for (let j = 0; j < sem.courses.length; j++) {
                const c = sem.courses[j];
                if (!c || !c.code) continue;
                let gradeText = '';
                try {
                    const elem = document.getElementById(c.id);
                    const gr = elem ? elem.querySelector('.grade') : null;
                    gradeText = gr ? gr.textContent.trim() : '';
                } catch (_) {}
                if (gradeText === 'F') continue;
                taken.add(normalizeCode(c.code));
            }
        }
    } catch (_) {}

    const categories = req.categories || {};
    const fullOrder = ['required', 'core', 'area', 'free'];
    const nextInOrder = (cat) => {
        const idx = fullOrder.indexOf(cat);
        return idx >= 0 && idx < fullOrder.length - 1 ? fullOrder[idx + 1] : null;
    };

    // Course metadata + pools
    const courseByCode = new Map();
    const pools = { required: [], core: [], area: [], free: [], university: [] };
    for (let i = 0; i < courseData.length; i++) {
        const c = courseData[i];
        const code = normalizeCode((c.Major || '') + (c.Code || ''));
        if (!code) continue;
        const baseCat = String(c.EL_Type || '').toLowerCase();
        courseByCode.set(code, { ...c, __code: code, __baseCat: baseCat });
        if (pools[baseCat]) pools[baseCat].push(code);
    }

    // Equivalence lookup per category.
    const eqGroupLookup = {};
    for (const catKey of fullOrder) {
        const cfg = categories[catKey] || {};
        const eq = Array.isArray(cfg.equivalents) ? cfg.equivalents : [];
        const lookup = new Map();
        for (let i = 0; i < eq.length; i++) {
            const group = Array.isArray(eq[i]) ? eq[i] : [];
            for (let j = 0; j < group.length; j++) {
                lookup.set(normalizeCode(group[j]), i);
            }
        }
        eqGroupLookup[catKey] = lookup;
    }

    const totals = {
        required: { courses: 0, credits: 0 },
        core: { courses: 0, credits: 0 },
        area: { courses: 0, credits: 0 },
        free: { courses: 0, credits: 0 },
    };
    const usedEqGroup = {
        required: new Set(),
        core: new Set(),
        area: new Set(),
        free: new Set(),
    };

    const needsMet = (cat) => {
        const cfg = categories[cat] || {};
        const needC = parseInt0(cfg.minCourses);
        const needS = parseInt0(cfg.minSU);
        if (!needC && !needS) return false; // do not auto-overflow categories with no requirements
        const have = totals[cat] || { courses: 0, credits: 0 };
        return (have.courses >= needC) && (have.credits >= needS);
    };

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

    // Build list of taken minor courses (only those present in this minor).
    const takenMinorCourses = [];
    for (const code of taken) {
        const rec = courseByCode.get(code);
        if (!rec) continue;
        const baseCat = fullOrder.includes(rec.__baseCat) ? rec.__baseCat : 'free';
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

    const allocationByCode = {};
    for (let i = 0; i < takenMinorCourses.length; i++) {
        const c = takenMinorCourses[i];
        let cat = c.baseCat;
        while (cat) {
            if (!canCountEquivalenceIn(cat, c.code)) {
                cat = nextInOrder(cat);
                continue;
            }
            const next = nextInOrder(cat);
            if (next && needsMet(cat)) {
                cat = next;
                continue;
            }
            totals[cat].courses += 1;
            totals[cat].credits += c.credit;
            markEquivalenceUsed(cat, c.code);
            allocationByCode[c.code] = { allocatedCat: cat, baseCat: c.baseCat, movedDown: cat !== c.baseCat, credit: c.credit };
            break;
        }
    }

    // Validate completion.
    let allOk = true;
    const perCatOk = {};
    for (const catKey of fullOrder) {
        const cfg = categories[catKey] || {};
        const needC = parseInt0(cfg.minCourses);
        const needS = parseInt0(cfg.minSU);
        const have = totals[catKey];
        let ok = true;
        if (needC) ok = ok && (have.courses >= needC);
        if (needS) ok = ok && (have.credits >= needS);
        if (catKey === 'required' && cfg.allListedRequired) {
            const eq = Array.isArray(cfg.equivalents) ? cfg.equivalents : [];
            const eqFlat = new Set(eq.flat().map(x => normalizeCode(x)));
            const poolCodes = pools.required || [];
            for (let i = 0; i < poolCodes.length; i++) {
                const code = poolCodes[i];
                if (eqFlat.has(code)) continue;
                if (!taken.has(code)) ok = false;
            }
            for (let i = 0; i < eq.length; i++) {
                const group = Array.isArray(eq[i]) ? eq[i].map(x => normalizeCode(x)) : [];
                if (group.length && !group.some(c => taken.has(c))) ok = false;
            }
        }
        perCatOk[catKey] = ok;
        if ((categories[catKey] && typeof categories[catKey] === 'object') && !ok) allOk = false;
    }

    const totalCourses = totals.required.courses + totals.core.courses + totals.area.courses + totals.free.courses;
    const totalCredits = totals.required.credits + totals.core.credits + totals.area.credits + totals.free.credits;
    const minAllC = parseInt0(req.minCourses);
    const minAllS = parseInt0(req.minSU);
    if (minAllC && totalCourses < minAllC) allOk = false;
    if (minAllS && totalCredits < minAllS) allOk = false;
    if (!Object.keys(categories).length) allOk = false;

    return {
        ok: allOk,
        title: req.name || minorCode,
        req,
        categories,
        totals,
        perCatOk,
        pools,
        courseByCode,
        allocationByCode,
    };
}

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
        function evaluateMinor(minorCode) {
            const res = computeMinorAllocation(curriculum, minorCode);
            if (res.error) return { ok: false, title: minorCode, lines: [res.error] };

            // Keep the graduation modal compact: show only status + missing pools.
            const req = res.req || {};
            const cats = req.categories || {};
            const order = ['required', 'core', 'area', 'free'];
            const missing = [];
            for (const cat of order) {
                if (!cats[cat]) continue;
                if (res.perCatOk && res.perCatOk[cat] === false) {
                    missing.push(cat.toUpperCase());
                }
            }

            const lines = [];
            if (missing.length) {
                lines.push(`Missing: ${missing.join(', ')}`);
            }
            lines.push('See Summary → Minor for details.');
            return { ok: res.ok, title: res.title || minorCode, lines };
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

    // Ensure the shared overlay exists.
    let overlayEl = document.querySelector('.summary_modal_overlay');
    if (!overlayEl) {
        overlayEl = document.createElement('div');
        overlayEl.classList.add('summary_modal_overlay');
        document.body.appendChild(overlayEl);
    }

    // Build a stable layout container so we can place minor controls close to
    // the major summary cards and switch between views.
    let contentEl = overlayEl.querySelector('.summary_overlay_content');
    if (!contentEl) {
        contentEl = document.createElement('div');
        contentEl.className = 'summary_overlay_content';
        overlayEl.appendChild(contentEl);
    } else {
        contentEl.innerHTML = '';
    }

    const headerRowEl = document.createElement('div');
    headerRowEl.className = 'summary_header_row';
    contentEl.appendChild(headerRowEl);

    const cardsRowEl = document.createElement('div');
    cardsRowEl.className = 'summary_cards_row';
    contentEl.appendChild(cardsRowEl);

    const minorPanelEl = document.createElement('div');
    minorPanelEl.className = 'summary_minor_panel is-hidden';
    contentEl.appendChild(minorPanelEl);

    function getTakenCourseCodes() {
        const taken = new Set();
        try {
            for (let i = 0; i < curriculum.semesters.length; i++) {
                const sem = curriculum.semesters[i];
                for (let j = 0; j < sem.courses.length; j++) {
                    const c = sem.courses[j];
                    if (!c || !c.code) continue;
                    let gradeText = '';
                    try {
                        const elem = document.getElementById(c.id);
                        const gr = elem ? elem.querySelector('.grade') : null;
                        gradeText = gr ? gr.textContent.trim() : '';
                    } catch (_) {}
                    if (gradeText === 'F') continue;
                    taken.add(String(c.code).toUpperCase().replace(/\s+/g, ''));
                }
            }
        } catch (_) {}
        return taken;
    }

    // Minor buttons: show a compact, visual guide for each selected minor,
    // and render the minor summary inside the same overlay (hiding majors).
    try {
        const minors = Array.isArray(curriculum.minors) ? curriculum.minors.filter(Boolean) : [];
        if (minors.length) {
            const minorRow = document.createElement('div');
            minorRow.className = 'summary_minor_row';
            headerRowEl.appendChild(minorRow);

            const taken = getTakenCourseCodes();
            const reqMap = (typeof window !== 'undefined' && window.minorRequirements) ? window.minorRequirements : {};

            const parseInt0 = (v) => {
                const n = parseInt(v || '0', 10);
                return isNaN(n) ? 0 : n;
            };

            const showMajors = () => {
                try {
                    minorPanelEl.classList.add('is-hidden');
                    cardsRowEl.classList.remove('is-hidden');
                    headerRowEl.classList.remove('is-hidden');
                } catch (_) {}
            };

            const showMinorSummary = (minorCode) => {
                const allocRes = computeMinorAllocation(curriculum, minorCode);
                if (allocRes.error) {
                    const ui = (typeof window !== 'undefined') ? window.uiModal : null;
                    if (ui && typeof ui.alert === 'function') {
                        ui.alert('Minor summary unavailable', `<p>${allocRes.error}</p>`);
                    }
                    return;
                }

                const req = allocRes.req || {};
                const title = `${minorCode} — ${req.name || 'Minor'}`;
                const categories = req.categories || {};
                const catOrder = ['required', 'core', 'area', 'free'];
                const totals = allocRes.totals || {};
                const allocationByCode = allocRes.allocationByCode || {};
                const courseByCode = allocRes.courseByCode || new Map();
                const pools = allocRes.pools || { required: [], core: [], area: [], free: [] };

                const termName = (() => {
                    if (req.term) return req.term;
                    const tc = curriculum && curriculum.entryTermMinor ? String(curriculum.entryTermMinor) : '';
                    try {
                        const fn = (typeof window !== 'undefined' && typeof window.termCodeToName === 'function') ? window.termCodeToName : null;
                        return fn ? fn(tc) : tc;
                    } catch (_) {
                        return tc;
                    }
                })();

                const renderEq = (cfg) => {
                    const eq = cfg && Array.isArray(cfg.equivalents) ? cfg.equivalents : [];
                    if (!eq.length) return '';
                    const parts = eq.map(g => Array.isArray(g) ? g.join(' / ') : String(g));
                    return `<div class="ms-rules"><strong>Rule:</strong> Choose 1 of: ${parts.join(' • ')}</div>`;
                };

                const renderPoolCourse = (code, sectionCat) => {
                    const rec = courseByCode.get(code);
                    if (!rec) return '';
                    const name = rec.Course_Name || '';
                    const su = rec.SU_credit || '0';
                    const alloc = allocationByCode[code];
                    if (!alloc) {
                        return `
                          <div class="ms-course is-missing">
                            <div class="ms-course-left">
                              <span class="ms-dot"></span>
                              <span class="ms-code">${code}</span>
                              <span class="ms-name">${name}</span>
                            </div>
                            <div class="ms-meta">${su} SU</div>
                          </div>
                        `;
                    }
                    const isHere = alloc.allocatedCat === sectionCat;
                    const statusClass = isHere ? 'is-taken' : 'is-overflow';
                    const countsAs = isHere ? '' : ` • Counts as ${String(alloc.allocatedCat || '').toUpperCase()}`;
                    return `
                      <div class="ms-course ${statusClass}">
                        <div class="ms-course-left">
                          <span class="ms-dot"></span>
                          <span class="ms-code">${code}</span>
                          <span class="ms-name">${name}</span>
                        </div>
                        <div class="ms-meta">${su} SU${countsAs}</div>
                      </div>
                    `;
                };

                const renderOverflowHere = (code) => {
                    const rec = courseByCode.get(code);
                    const alloc = allocationByCode[code];
                    if (!rec || !alloc) return '';
                    const name = rec.Course_Name || '';
                    const su = rec.SU_credit || '0';
                    const fromTxt = ` • From ${String(alloc.baseCat || '').toUpperCase()}`;
                    return `
                      <div class="ms-course is-overflow">
                        <div class="ms-course-left">
                          <span class="ms-dot"></span>
                          <span class="ms-code">${code}</span>
                          <span class="ms-name">${name}</span>
                        </div>
                        <div class="ms-meta">${su} SU${fromTxt}</div>
                      </div>
                    `;
                };

                let body = `<div class="minor-summary">`;
                body += `<div class="ms-subtitle">Admit term: <strong>${termName || 'Unknown'}</strong></div>`;
                body += `<div class="ms-legend">
                    <div class="ms-legend-item"><span class="ms-dot ms-dot-green"></span>Counts in this pool</div>
                    <div class="ms-legend-item"><span class="ms-dot ms-dot-yellow"></span>Counts in a lower pool (overflow)</div>
                    <div class="ms-legend-item"><span class="ms-dot ms-dot-gray"></span>Not taken</div>
                  </div>`;

                for (const cat of catOrder) {
                    const cfg = categories[cat];
                    const poolCodes = Array.isArray(pools[cat]) ? pools[cat].slice() : [];
                    const overflowHere = Object.keys(allocationByCode)
                        .filter(code => {
                            const a = allocationByCode[code];
                            return a && a.allocatedCat === cat && a.movedDown;
                        })
                        .sort((a, b) => String(a).localeCompare(String(b)));

                    if (!cfg && !poolCodes.length && !overflowHere.length) continue;

                    const needC = parseInt0(cfg && cfg.minCourses);
                    const needS = parseInt0(cfg && cfg.minSU);
                    const have = totals[cat] || { courses: 0, credits: 0 };

                    body += `<div class="ms-section">`;
                    body += `<div class="ms-header"><div class="ms-title">${cat.toUpperCase()}</div><div class="ms-req">${have.courses}/${needC || 0} courses • ${have.credits}/${needS || 0} SU</div></div>`;
                    if (cfg && cfg.allListedRequired && cat === 'required') {
                        body += `<div class="ms-rules"><strong>Rule:</strong> All listed courses are required (equivalence groups count as “choose one”).</div>`;
                    }
                    body += renderEq(cfg);

                    if (overflowHere.length) {
                        body += `<div class="ms-subheader">Overflow counting here</div>`;
                        body += `<div class="ms-list">`;
                        body += overflowHere.map(c => renderOverflowHere(c)).join('');
                        body += `</div>`;
                    }

                    body += `<div class="ms-subheader">Course pool</div>`;
                    body += `<div class="ms-list">`;
                    body += poolCodes.length ? poolCodes.sort((a,b)=>String(a).localeCompare(String(b))).map(code => renderPoolCourse(code, cat)).join('') : `<div class="ms-empty">No courses listed in this pool.</div>`;
                    body += `</div></div>`;
                }

                body += `</div>`;

                // Render inside overlay and hide majors.
                minorPanelEl.innerHTML = `
                  <div class="summary_minor_panel_header">
                    <button class="btn btn-secondary summary_back_btn" type="button">Back to majors</button>
                    <div class="summary_minor_panel_title">${title}</div>
                  </div>
                  <div class="summary_minor_switch_row">
                    ${minors.map(code => {
                        const rec = reqMap ? reqMap[code] : null;
                        const label = rec && rec.name ? rec.name : code;
                        const active = code === minorCode ? 'is-active' : '';
                        return `<button type="button" class="btn btn-secondary summary_minor_switch_btn ${active}" data-minor-code="${code}">${label}</button>`;
                    }).join('')}
                  </div>
                  <div class="summary_minor_panel_body">${body}</div>
                `;
                try {
                    const backBtn = minorPanelEl.querySelector('.summary_back_btn');
                    if (backBtn) {
                        backBtn.addEventListener('click', (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            showMajors();
                        });
                    }
                    minorPanelEl.querySelectorAll('.summary_minor_switch_btn').forEach(btn => {
                        btn.addEventListener('click', (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const code = btn.getAttribute('data-minor-code') || '';
                            if (code) showMinorSummary(code);
                        });
                    });
                } catch (_) {}

                try {
                    minorPanelEl.classList.remove('is-hidden');
                    cardsRowEl.classList.add('is-hidden');
                    headerRowEl.classList.add('is-hidden');
                } catch (_) {}
            };

            for (const minorCode of minors) {
                const rec = reqMap ? reqMap[minorCode] : null;
                const btn = document.createElement('button');
                btn.className = 'btn btn-secondary summary_minor_btn';
                btn.textContent = rec && rec.name ? rec.name : minorCode;
                btn.title = minorCode;
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    showMinorSummary(minorCode);
                });
                minorRow.appendChild(btn);
            }
        }
    } catch (_) {}
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
        const modal = document.createElement('div');
        modal.classList.add('summary_modal');
        cardsRowEl.appendChild(modal);
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
