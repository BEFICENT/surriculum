// Remove ES module imports. Instead, rely on global functions and objects
// that are attached to the `window` (e.g., buildFlagMessages and
// requirements). This is necessary when running under the file:// scheme
// where ES module imports may not be available.

// Display graduation check results in a modal
function displayGraduationResults(curriculum) {
    if(!document.querySelector('.graduation_modal')) {
        // Create overlay with proper modal styling
        const overlay = document.createElement("div");
        overlay.classList.add('modal-overlay');
        overlay.style.zIndex = '1000';

        // Create modal with proper styling
        const modal = document.createElement("div");
        modal.classList.add('modal', 'graduation_modal');
        modal.style.cssText = `
            padding: 24px;
            min-width: 400px;
            max-width: 600px;
        `;

        // Compose results for primary major
        let html = '<h2 style="margin-bottom: 16px; color: var(--text-primary);">Graduation Check Results</h2>';
        const flagMain = curriculum.canGraduate();
        const msgMain = buildFlagMessages(curriculum.major) || {};
        html += '<div style="margin-bottom: 12px; padding: 12px; border-radius: var(--radius-md); background: var(--bg-surface);"><strong>' + curriculum.major + ':</strong> ';
        if (flagMain === 0) {
            html += '<span style="color: var(--accent);">🎉 Congrats! You can graduate!</span>';
        } else {
            const fcn = msgMain[flagMain];
            html += '<span style="color: #ef4444;">❌ You cannot graduate: ' + (fcn ? fcn() : `Error code ${flagMain}`) + '</span>';
        }
        html += '</div>';

        // If double major selected, compute second major result
        if (curriculum.doubleMajor) {
            const flagDM = curriculum.canGraduateDouble();
            const msgDM = buildFlagMessages(curriculum.doubleMajor) || {};
            html += '<div style="margin-bottom: 12px; padding: 12px; border-radius: var(--radius-md); background: var(--bg-surface);"><strong>' + curriculum.doubleMajor + ':</strong> ';
            if (flagDM === 0) {
                html += '<span style="color: var(--accent);">🎉 Congrats! You can graduate!</span>';
            } else {
                const fcn = msgDM[flagDM];
                html += '<span style="color: #ef4444;">❌ You cannot graduate: ' + (fcn ? fcn() : `Error code ${flagDM}`) + '</span>';
            }
            html += '</div>';
        }

        // Add close button
        html += '<div style="margin-top: 20px; text-align: right;"><button onclick="this.closest(\'.modal-overlay\').remove()" style="padding: 8px 16px; background: var(--primary); color: white; border: none; border-radius: var(--radius-md); cursor: pointer;">Close</button></div>';

        modal.innerHTML = html;
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        // Close on overlay click
        overlay.addEventListener('click', function(e) {
            if (e.target === overlay) {
                overlay.remove();
            }
        });
    }
}

// Function to display summary of credits
function displaySummary(curriculum, major_chosen_by_user) {
    // Do not create more than one set of summary modals. If any exist, abort.
    if (document.querySelector('.summary_modal')) return;

    // Create overlay with proper modal styling
    const overlay = document.createElement("div");
    overlay.classList.add('modal-overlay');
    overlay.style.zIndex = '1000';

    // Helper to build a summary modal for a given set of totals and limits.
    function buildSummaryModal(totals, limits, gpa, title, isSecondModal = false) {
        const modal = document.createElement("div");
        modal.classList.add('modal', 'summary_modal');
        modal.style.cssText = `
            padding: 24px;
            min-width: 350px;
            max-width: 500px;
            margin: ${isSecondModal ? '0 0 0 20px' : '0 20px 0 0'};
        `;

        // Build content with better styling
        let html = `<h2 style="margin-bottom: 16px; color: var(--text-primary);">${title} Summary</h2>`;

        const labels = ['GPA', 'SU Credits', 'ECTS', 'University', 'Required', 'Core', 'Area', 'Free', 'Basic Science', 'Engineering'];
        const total_values = [gpa, totals.total, totals.ects, totals.university, totals.required, totals.core, totals.area, totals.free, totals.science, totals.engineering];
        const limits_values = ['4.00', limits[1], limits[2], limits[3], limits[4], limits[5], limits[6], limits[7], limits[8], limits[9]];

        for (let i = 0; i < 10; i++) {
            const isGPA = i === 0;
            const current = total_values[i];
            const limit = limits_values[i];
            const percentage = isGPA ? (parseFloat(current) / 4.0 * 100) : (limit !== '0' ? (parseFloat(current) / parseFloat(limit) * 100) : 0);

            html += `
                <div style="margin-bottom: 12px; padding: 12px; border-radius: var(--radius-md); background: var(--bg-surface);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                        <span style="font-weight: 500;">${labels[i]}:</span>
                        <span style="font-weight: 600;">${current} / ${limit}</span>
                    </div>
                    ${!isGPA && limit !== '0' ? `
                        <div style="background: var(--border); border-radius: 4px; height: 6px; overflow: hidden;">
                            <div style="background: ${percentage >= 100 ? 'var(--accent)' : 'var(--primary)'}; height: 100%; width: ${Math.min(percentage, 100)}%; transition: width 0.3s ease;"></div>
                        </div>
                        <div style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 2px;">${percentage.toFixed(1)}%</div>
                    ` : ''}
                </div>
            `;
        }

        modal.innerHTML = html;
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

    // Create container for modals
    const modalContainer = document.createElement('div');
    modalContainer.style.cssText = `
        display: flex;
        align-items: flex-start;
        justify-content: center;
        max-width: 90vw;
        max-height: 90vh;
        overflow: auto;
    `;

    // Build primary summary modal
    const mainModal = buildSummaryModal(totalsMain, limitsMain, gpaMain, curriculum.major);
    modalContainer.appendChild(mainModal);

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
            totalsDM.total += sem.totalCredit;
            totalsDM.core += sem.totalCoreDM || 0;
            totalsDM.area += sem.totalAreaDM || 0;
            totalsDM.free += sem.totalFreeDM || 0;
            totalsDM.university += (sem.totalUniversityDM !== undefined ? sem.totalUniversityDM : sem.totalUniversity);
            totalsDM.required += (sem.totalRequiredDM !== undefined ? sem.totalRequiredDM : sem.totalRequired);
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

        const dmModal = buildSummaryModal(totalsDM, limitsDM, gpaDM, curriculum.doubleMajor, true);
        modalContainer.appendChild(dmModal);
    }

    // Add close button
    const closeButton = document.createElement('button');
    closeButton.innerHTML = 'Close';
    closeButton.style.cssText = `
        position: absolute;
        top: 16px;
        right: 16px;
        padding: 8px 16px;
        background: var(--primary);
        color: white;
        border: none;
        border-radius: var(--radius-md);
        cursor: pointer;
        font-size: 14px;
    `;
    closeButton.onclick = () => overlay.remove();

    overlay.appendChild(modalContainer);
    overlay.appendChild(closeButton);
    document.body.appendChild(overlay);

    // Close on overlay click
    overlay.addEventListener('click', function(e) {
        if (e.target === overlay) {
            overlay.remove();
        }
    });
}

// Make functions available globally
if (typeof window !== 'undefined') {
    window.displayGraduationResults = displayGraduationResults;
    window.displaySummary = displaySummary;
}
