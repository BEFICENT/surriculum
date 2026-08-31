// Help, admit-term guidance, and startup release information.
// Loaded as a deferred classic script before main.js.
(function (global) {
    'use strict';

    let initialized = false;

    function init() {
        if (initialized) return api;
        initialized = true;
    const opener = document.getElementById('openHelpInfoButton');
    const admitTermOpener = document.getElementById('openAdmitTermHelpButton');
    if (!opener && !admitTermOpener) return;

    const releaseVersion = String(
        (typeof window !== 'undefined' && window.APP_VERSION) || '3.1'
    ).trim() || '3.1';
    const onboardingKeys = Object.freeze({
        cohort: 'onboardingCohort',
        helpSeen: 'onboardingHelpSeen',
        lastSeenRelease: 'onboardingLastSeenRelease',
    });
    const sessionPrefix = 'surriculum.session.';
    let startupPromptHandled = false;

    const readOnboardingValue = (key) => {
        const stored = preferenceGetItem(key);
        if (stored !== null) return stored;
        try { return sessionStorage.getItem(sessionPrefix + key); } catch (_) {}
        return null;
    };

    const writeOnboardingValue = (key, value) => {
        if (preferenceSetItem(key, value)) {
            try { sessionStorage.removeItem(sessionPrefix + key); } catch (_) {}
            return true;
        }
        try {
            sessionStorage.setItem(sessionPrefix + key, String(value));
            return true;
        } catch (_) {}
        return false;
    };

    const parseReleaseVersion = (value) => {
        const match = String(value || '').trim().match(/^(\d+)\.(\d+)(?:\.(\d+))?$/);
        if (!match) return null;
        return [Number(match[1]), Number(match[2]), Number(match[3] || 0)];
    };

    const compareReleaseVersions = (left, right) => {
        const a = parseReleaseVersion(left);
        const b = parseReleaseVersion(right);
        if (!a || !b) return null;
        for (let index = 0; index < 3; index++) {
            if (a[index] > b[index]) return 1;
            if (a[index] < b[index]) return -1;
        }
        return 0;
    };

    const initializeOnboardingCohort = () => {
        const existing = String(readOnboardingValue(onboardingKeys.cohort) || '').trim();
        if (/^(?:pre-)?\d+\.\d+(?:\.\d+)?$/.test(existing)) return existing;

        let firstRunEver = false;
        try {
            firstRunEver = !!(
                window.storageSchemaInfo && window.storageSchemaInfo.firstRunEver === true
            );
        } catch (_) {}
        const cohort = firstRunEver ? releaseVersion : `pre-${releaseVersion}`;
        writeOnboardingValue(onboardingKeys.cohort, cohort);
        return cohort;
    };

    const onboardingCohort = initializeOnboardingCohort();
    const releaseAlreadySeen = () => {
        const comparison = compareReleaseVersions(
            readOnboardingValue(onboardingKeys.lastSeenRelease),
            releaseVersion,
        );
        return comparison !== null && comparison >= 0;
    };
    const acknowledgeRelease = () => {
        // A cached older app can run after a newer tab has already recorded a
        // later release. Never let that older build move the shared marker
        // backwards (and repair malformed markers with the current version).
        if (!parseReleaseVersion(releaseVersion)) return false;
        const comparison = compareReleaseVersions(
            readOnboardingValue(onboardingKeys.lastSeenRelease),
            releaseVersion,
        );
        if (comparison !== null && comparison >= 0) return true;
        return writeOnboardingValue(onboardingKeys.lastSeenRelease, releaseVersion);
    };
    const acknowledgeHelp = () => {
        writeOnboardingValue(onboardingKeys.helpSeen, 'true');
        acknowledgeRelease();
    };

    const helpGuideHtml = `
        <div class="help-info-guide" id="helpInfoGuide">
            <div class="help-info-disclaimer" id="helpInfoDisclaimer" role="note" aria-label="Important disclaimer">
                <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
                <div>
                    <strong>Always verify the graduation requirements yourself using official sources.</strong>
                    SUrriculum is a planning aid, not an official university record or a guarantee of
                    course eligibility, availability, substitution approval, or graduation. Confirm your
                    program and admit-term requirements in official sources and verify the relevant dates in
                    SUIS → Student Records → General Student Information. Verify the final result in SUIS as well.
                </div>
            </div>

            <div class="help-info-layout">
                <nav class="help-info-nav" aria-label="Help topics">
                    <a class="help-info-nav-link" href="#help-getting-started">Getting started</a>
                    <a class="help-info-nav-link" href="#help-planner">Using the planner</a>
                    <a class="help-info-nav-link" href="#help-scheduler">Building a schedule</a>
                    <a class="help-info-nav-link" href="#help-progress">Progress &amp; credits</a>
                    <a class="help-info-nav-link" href="#help-data">Plans, imports &amp; privacy</a>
                    <a class="help-info-nav-link" href="#help-about">Contact &amp; credits</a>
                </nav>

                <div class="help-info-content">
                    <section class="help-info-section" id="help-getting-started" aria-labelledby="help-getting-started-title">
                        <h4 id="help-getting-started-title" tabindex="-1">Getting started</h4>
                        <ol>
                            <li><strong>Choose your programs and admit terms</strong> in Controls. Select a main major, then add a double major or up to three minors if needed. Each program has its own admit term because its catalog rules can differ.</li>
                            <li><strong>Add your academic record.</strong> You can import an Academic Records Summary from the header, or create semesters and add courses manually. Review imported courses, grades, terms, and any requested custom classifications.</li>
                            <li><strong>Build the rest of your plan.</strong> Add a semester, choose its academic term, and use Add course on that semester. Open Progress or Summary as you make changes.</li>
                            <li><strong>Back up the plan.</strong> Use the plan menu's Export action after important edits, especially before clearing browser data or moving to another device.</li>
                        </ol>
                        <div class="help-info-tip admit-term-help-summary">
                            <strong>Admit-term reminder</strong>
                            ${admitTermGuidanceHtml}
                        </div>
                        <h5>Mobile use</h5>
                        <p>Use the bottom Planner, Scheduler, Progress, and Controls tabs. The Planner shows the newest term first and keeps New Semester at the top. It works best in portrait, while the weekly Scheduler has more room in landscape. Course drag and move actions are desktop-only; on mobile, remove and re-add a course in its destination term or replace that term from the Scheduler.</p>
                    </section>

                    <section class="help-info-section" id="help-planner" aria-labelledby="help-planner-title">
                        <h4 id="help-planner-title" tabindex="-1">Using the planner</h4>
                        <h5>Add and find courses</h5>
                        <p>Use Add course inside the destination semester and search by code or title. Open Filters beside the search field to narrow by program, category, level, credits, exact-semester offering, already-planned status, or course requirements. Controls → Course picker defaults sets the initial detail, planned-course, offered-only, and sorting choices for newly opened pickers. In the Planner, Hide courses planned in this or earlier semesters removes courses present in the destination semester or an academically earlier semester; courses planned only later remain visible. Offered-only can then be changed for one semester without changing the default or another open picker. “The semester” means the destination card's saved academic term, not the current date or visual card order.</p>

                        <h5>Understand chronology</h5>
                        <p>A semester's saved academic term code is the source of truth for prerequisite checks, retakes, current-term state, and progress calculations. Dragging semester cards only changes their visual order. Sort Semesters restores chronological display.</p>

                        <h5>Read planning warnings</h5>
                        <p>Prerequisite and prior-SU checks look at academically earlier semesters, with same-term work used only when a rule explicitly allows concurrency. Offering-history labels such as No Fall offerings found or Not offered every year describe recorded history. Workload, prerequisite, and offering warnings are advisory: they do not block an approved exception and do not prove future availability or enrollment eligibility.</p>

                        <h5>Move, retake, and classify courses</h5>
                        <p>On desktop, drag courses between semesters or use the move action. On mobile, remove the course and add it to the destination term, or replace that term from the Scheduler. If you add an existing course to a later eligible term, the planner can ask whether you are planning a retake before replacing its earlier planned entry. This is a simplified plan representation: it removes the earlier planner card, while an official transcript continues to retain recorded attempts. Use a custom course only for a missing course or placeholder. Any category you assign to a custom course is a planning assumption and should match an approved substitution or official classification.</p>
                    </section>

                    <section class="help-info-section" id="help-scheduler" aria-labelledby="help-scheduler-title">
                        <h4 id="help-scheduler-title" tabindex="-1">Building a schedule</h4>
                        <ol>
                            <li>Open Scheduler and choose the academic term you want to arrange.</li>
                            <li>Search for courses, expand a course, and select a section bundle. Labs and recitations stay bundled with their main course where the schedule data identifies that relationship.</li>
                            <li>Use prerequisite checks, the Hide courses planned before the selected term filter, Smart Sort, availability highlighting, and blocked-hour controls as needed. Inspect the weekly grid for highlighted conflicts.</li>
                            <li>Copy CRNs when you are ready to register. The scheduler does not register courses for you.</li>
                            <li><strong>Update planner semester replaces the matching term's planned main courses</strong> with the scheduler selection. Lab and recitation rows are not added as separate planner courses, so review the confirmation before applying it.</li>
                        </ol>
                        <p>A scheduler course that is not listed in your selected undergraduate catalogs is kept in the plan as unallocated N/A. It remains visible and contributes to semester workload, but it does not satisfy a graduation category. Any approved substitution must be represented and verified separately.</p>
                    </section>

                    <section class="help-info-section" id="help-progress" aria-labelledby="help-progress-title">
                        <h4 id="help-progress-title" tabindex="-1">Progress &amp; credits</h4>
                        <h5>Check versus Summary</h5>
                        <p>Check Graduation gives a high-level result. Summary shows how each selected major or minor is calculated, including earned work, the current term, future plans, courses needing a grade, unsuccessful attempts, and unmet requirements. Planned courses can make a program Projected complete; only earned results can be Complete.</p>

                        <h5>SU, ECTS, and requirement credits</h5>
                        <p><strong>SU credits</strong> drive semester workload and the SU-credit requirements named by a curriculum. <strong>ECTS</strong> is tracked separately for requirements and mobility contexts that use it. Basic Science and Engineering values describe how part of a course can count toward those requirement pools; they are not extra SU credits. A course marked N/A can still appear in overall workload and, with a valid letter grade, overall CGPA, while contributing nothing to that program's graduation categories or PGPA.</p>

                        <h5>How allocation works</h5>
                        <p>Courses are allocated using the selected program, its admit-term catalog, requirement groups, grades, and the course's effective category. Main-major, double-major, and minor summaries can therefore count the same course differently. Estimated class level uses earned SU credits only. Treat every result as an explanation of the current plan—not an official degree evaluation.</p>
                    </section>

                    <section class="help-info-section" id="help-data" aria-labelledby="help-data-title">
                        <h4 id="help-data-title" tabindex="-1">Plans, imports &amp; privacy</h4>
                        <h5>Saved plans</h5>
                        <p>The plan menu supports multiple named plans and their Export and Import actions. Exported plan files are the portable backup: data does not automatically sync between browsers or devices.</p>

                        <h5>Transcript imports</h5>
                        <p>For the most reliable import, open SUIS Academic Records Summary and save it as Webpage, Complete; a readable browser-generated PDF is also supported. A YÖK transcript is available as a less-preferred alternative. Always review the detected terms, grades, and unresolved courses before relying on the result.</p>

                        <h5>Where your data lives</h5>
                        <p>Transcript files are parsed in your browser and are not uploaded by SUrriculum. Plans, grades, custom courses, preferences, and scheduler selections are stored in this site's browser storage. SUrriculum has no account, runtime analytics, telemetry, or server-side plan storage. The service worker may cache the application and public catalog data for offline use.</p>
                        <p class="help-info-tip"><strong>Before resetting:</strong> export every plan you need. Reset Local Data removes SUrriculum's saved plans and settings from this browser and cannot sync them back from another device.</p>
                    </section>

                    <section class="help-info-section" id="help-about" aria-labelledby="help-about-title">
                        <h4 id="help-about-title" tabindex="-1">Contact &amp; project credits</h4>
                        <p>For issues you spot, send an e-mail to <a href="mailto:bilal.gebenoglu@sabanciuniv.edu">bilal.gebenoglu@sabanciuniv.edu</a>.</p>
                        <p>This repository started as a fork of the <a href="https://github.com/melih-kiziltoprak/surriculum" target="_blank" rel="noopener noreferrer">original Surriculum project<span class="sr-only"> (opens in a new tab)</span></a>.</p>
                        <p>Maintained by <strong>BEFICENT (Bilal M. G.)</strong> with major additions including double major support, Data Science and Analytics and several FASS programs, a large UI overhaul, updated course lists, improved requirement checks, multi-plan support, minor support, and the term-selectable scheduler.</p>
                        <p>View the <a href="https://github.com/BEFICENT/surriculum" target="_blank" rel="noopener noreferrer">current source code<span class="sr-only"> (opens in a new tab)</span></a>. SUrriculum is licensed under the <a href="https://github.com/BEFICENT/surriculum/blob/main/LICENSE" target="_blank" rel="noopener noreferrer">GNU General Public License v3.0<span class="sr-only"> (opens in a new tab)</span></a>.</p>
                    </section>
                </div>
            </div>
        </div>`;

    const openHelpInformation = (options) => {
        const opts = options || {};
        const ui = (typeof window !== 'undefined') ? window.uiModal : null;
        if (!ui || typeof ui.alert !== 'function') return Promise.resolve(null);

        startupPromptHandled = true;
        acknowledgeHelp();

        return ui.alert('Help & information', helpGuideHtml, {
            buttons: [{ action: 'close', label: 'Close', variant: 'primary' }],
            onMount: ({ overlay, modal, body }) => {
                overlay.classList.add('help-info-overlay');
                modal.classList.add('help-info-modal');
                body.classList.add('help-info-modal-body');
                if (opts.firstRun === true) {
                    overlay.classList.add('help-info-first-run');
                    modal.classList.add('help-info-first-run');
                }
                // Describing a dialog with this entire long guide would make
                // screen readers announce every section as soon as it opens.
                if (opts.firstRun === true) {
                    overlay.setAttribute('aria-describedby', 'helpInfoDisclaimer');
                } else {
                    overlay.removeAttribute('aria-describedby');
                }

                body.querySelectorAll('.help-info-nav-link').forEach((link) => {
                    link.addEventListener('click', (event) => {
                        const targetId = link.getAttribute('href');
                        const target = targetId ? body.querySelector(targetId) : null;
                        if (!target) return;
                        event.preventDefault();
                        const heading = target.querySelector('h4');
                        let behavior = 'smooth';
                        try {
                            if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) behavior = 'auto';
                        } catch (_) {}
                        target.scrollIntoView({ behavior, block: 'start' });
                        try { if (heading) heading.focus({ preventScroll: true }); } catch (_) {}
                    });
                });
            }
        });
    };

    const openAdmitTermInformation = () => {
        const ui = (typeof window !== 'undefined') ? window.uiModal : null;
        if (!ui || typeof ui.alert !== 'function') return Promise.resolve(null);
        return ui.alert(
            'What is an admit term?',
            `<div class="admit-term-help-guide" id="admitTermHelpGuide">${admitTermGuidanceHtml}</div>`,
            {
                buttons: [{ action: 'close', label: 'Close', variant: 'primary' }],
                onMount: ({ overlay, modal, body }) => {
                    overlay.classList.add('admit-term-help-overlay');
                    modal.classList.add('admit-term-help-modal');
                    body.classList.add('admit-term-help-modal-body');
                },
            }
        );
    };

    if (opener) opener.addEventListener('click', () => { openHelpInformation(); });
    if (admitTermOpener) {
        admitTermOpener.addEventListener('click', () => { openAdmitTermInformation(); });
    }
    window.openHelpInformation = openHelpInformation;
    window.openAdmitTermInformation = openAdmitTermInformation;

    // Release copy is deliberately registered by its exact app version. A
    // version bump without a matching entry must stay quiet instead of putting
    // the previous release's notes under a new, misleading heading.
    const releaseAnnouncements = Object.freeze({
        '3.1': Object.freeze({
            title: 'What’s new in SUrriculum 3.1',
            html: `
                <div class="release-update-guide">
                    <p class="release-update-lead">Version 3.1 focuses on clearer progress and safer planning.</p>
                    <ul class="release-update-list">
                        <li><strong>Progress and Summary are clearer.</strong> Earned, current, and future work are separated, with better degree, CGPA/PGPA, and class-level explanations.</li>
                        <li><strong>Planner and Scheduler checks are term-aware.</strong> Offerings, prerequisites, prior-credit guidance, filters, and warnings follow each semester's saved academic term.</li>
                        <li><strong>Everyday planning is more reliable.</strong> Imports, custom and external courses, retakes, saved plans, offline use, and course or semester movement have stronger safeguards.</li>
                    </ul>
                    <p class="release-update-note"><strong>Reminder:</strong> SUrriculum remains a planning aid. Verify requirements, eligibility, substitutions, and course availability in official sources.</p>
                </div>`,
        }),
    });
    const releaseAnnouncement = Object.prototype.hasOwnProperty.call(
        releaseAnnouncements,
        releaseVersion,
    ) ? releaseAnnouncements[releaseVersion] : null;

    const openReleaseUpdate = async () => {
        const ui = (typeof window !== 'undefined') ? window.uiModal : null;
        if (!releaseAnnouncement || !ui || typeof ui.alert !== 'function') return;

        startupPromptHandled = true;
        // Showing the dialog counts as delivery even when it is dismissed with
        // Escape, the close button, or the backdrop. This prevents a startup
        // notice from becoming a recurring obstacle.
        acknowledgeRelease();
        const result = await ui.alert(releaseAnnouncement.title, releaseAnnouncement.html, {
            buttons: [
                { action: 'help', label: 'Open Help', variant: 'secondary' },
                { action: 'continue', label: 'Continue', variant: 'primary' },
            ],
            onMount: ({ overlay, modal, body }) => {
                overlay.classList.add('release-update-overlay');
                modal.classList.add('release-update-modal');
                body.classList.add('release-update-modal-body');
            },
        });
        if (result && result.action === 'help') {
            setTimeout(() => { openHelpInformation(); }, 0);
        }
    };

    const showStartupInformation = () => {
        if (startupPromptHandled) return;
        if (releaseAlreadySeen()) {
            startupPromptHandled = true;
            return;
        }

        const isFreshCohort = onboardingCohort === releaseVersion;
        const helpSeen = readOnboardingValue(onboardingKeys.helpSeen) === 'true';
        if (isFreshCohort) {
            if (!helpSeen) {
                openHelpInformation({ firstRun: true });
            } else {
                // A partially written first-run acknowledgement should not turn
                // into a misleading upgrade announcement on the next load.
                startupPromptHandled = true;
                acknowledgeRelease();
            }
            return;
        }
        if (!releaseAnnouncement) {
            startupPromptHandled = true;
            return;
        }
        openReleaseUpdate();
    };

    const queueStartupInformation = () => {
        const tryOpen = () => {
            if (startupPromptHandled) return;
            // A migration, custom-course review, or critical error dialog gets
            // priority. The startup message waits until the modal stack clears.
            if (document.querySelector('[role="dialog"][aria-modal="true"]')) {
                setTimeout(tryOpen, 250);
                return;
            }
            showStartupInformation();
        };
        setTimeout(tryOpen, 0);
    };

    document.addEventListener('surriculum:ready', queueStartupInformation, { once: true });
    if (window.__surriculumReady === true) queueStartupInformation();
        return api;
    }

    const api = Object.freeze({
        init,
        openHelpInformation(options) {
            return typeof global.openHelpInformation === 'function'
                ? global.openHelpInformation(options)
                : Promise.resolve(null);
        },
        openAdmitTermInformation() {
            return typeof global.openAdmitTermInformation === 'function'
                ? global.openAdmitTermInformation()
                : Promise.resolve(null);
        },
    });
    global.surriculumOnboarding = api;
})(typeof window !== 'undefined' ? window : globalThis);
