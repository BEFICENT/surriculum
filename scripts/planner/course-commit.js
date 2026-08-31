// Planner add-course and retake commit policy.
(function installPlannerCourseCommit(root) {
    'use strict';

    function canonicalizeCourseCode(value) {
        const normalized = String(value || '').toUpperCase().replace(/\s+/g, '');
        return normalized === 'CS210' || normalized === 'DSA210' ? 'DSA210' : normalized;
    }

    function parseCreditFallback(value) {
        try {
            const raw = String(value ?? '').trim();
            if (!raw) return 0;
            const parsed = parseFloat(raw.replace(',', '.'));
            return Number.isFinite(parsed) ? parsed : 0;
        } catch (_) {
            return 0;
        }
    }

    function formatCreditFallback(value) {
        return parseCreditFallback(value).toFixed(1);
    }

    function escapeHtmlFallback(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function finiteNumber(value) {
        const parsed = parseFloat(value || '0');
        return Number.isFinite(parsed) ? parsed : 0;
    }

    function createBrowserDependencies(host) {
        const global = host || root;
        const getDocument = () => global && global.document;
        return {
            createCourse(code, id) {
                if (!global || typeof global.s_course !== 'function') return null;
                return new global.s_course(code, id);
            },
            isCourseValid(course, courseData) {
                return !!(global && typeof global.isCourseValid === 'function'
                    && global.isCourseValid(course, courseData));
            },
            getInfo(code, courseData) {
                return global && typeof global.getInfo === 'function'
                    ? global.getInfo(code, courseData) : null;
            },
            parseCreditValue(value) {
                return global && typeof global.parseCreditValue === 'function'
                    ? global.parseCreditValue(value) : parseCreditFallback(value);
            },
            formatCreditValue(value) {
                return global && typeof global.formatCreditValue === 'function'
                    ? global.formatCreditValue(value) : formatCreditFallback(value);
            },
            getInputContainer(event) {
                return event && event.target ? event.target.parentNode : null;
            },
            readInputValue(_event, inputContainer) {
                const input = inputContainer && inputContainer.querySelector
                    ? inputContainer.querySelector('input') : null;
                return input ? String(input.value || '').trim() : '';
            },
            clearInput(inputContainer) {
                const input = inputContainer && inputContainer.querySelector
                    ? inputContainer.querySelector('input') : null;
                if (input) input.value = '';
            },
            resolveTargetSemester(_event, curriculum, inputContainer) {
                const semesterElement = inputContainer && inputContainer.parentNode
                    && inputContainer.parentNode.querySelector
                    ? inputContainer.parentNode.querySelector('.semester') : null;
                return semesterElement && curriculum && typeof curriculum.getSemester === 'function'
                    ? curriculum.getSemester(semesterElement.id) : null;
            },
            renderAddedCourse(payload) {
                const documentRef = getDocument();
                const inputContainer = payload.inputContainer;
                const myCourse = payload.course;
                const info = payload.info;
                const semester = payload.semester;
                if (!documentRef || !inputContainer || !inputContainer.parentNode) return false;

                const courseContainer = documentRef.createElement('div');
                courseContainer.classList.add('course_container');
                const courseLabel = documentRef.createElement('div');
                courseLabel.classList.add('course_label');
                const codeDiv = documentRef.createElement('div');
                codeDiv.className = 'course_code';
                codeDiv.textContent = String(myCourse.code || '');
                const actionsDiv = documentRef.createElement('div');
                actionsDiv.className = 'course_actions';
                const detailsButton = documentRef.createElement('button');
                detailsButton.className = 'details_course';
                detailsButton.type = 'button';
                detailsButton.title = `Details for ${myCourse.code}`;
                detailsButton.setAttribute('aria-label', `Details for ${myCourse.code}`);
                const detailsIcon = documentRef.createElement('i');
                detailsIcon.className = 'fa-solid fa-circle-info';
                detailsIcon.setAttribute('aria-hidden', 'true');
                detailsButton.appendChild(detailsIcon);
                const deleteButton = documentRef.createElement('button');
                deleteButton.className = 'delete_course';
                deleteButton.type = 'button';
                deleteButton.title = `Delete ${myCourse.code}`;
                deleteButton.setAttribute('aria-label', `Delete ${myCourse.code}`);
                actionsDiv.appendChild(detailsButton);
                actionsDiv.appendChild(deleteButton);
                courseLabel.appendChild(codeDiv);
                courseLabel.appendChild(actionsDiv);

                const courseInfo = documentRef.createElement('div');
                courseInfo.classList.add('course_info');
                const nameDiv = documentRef.createElement('div');
                nameDiv.className = 'course_name';
                nameDiv.textContent = String(info.Course_Name || '');
                courseInfo.appendChild(nameDiv);
                const typeDiv = documentRef.createElement('div');
                typeDiv.className = 'course_type';
                typeDiv.textContent = String(info.EL_Type || '').toUpperCase();
                courseInfo.appendChild(typeDiv);
                const creditDiv = documentRef.createElement('div');
                creditDiv.className = 'course_credit';
                creditDiv.textContent = String(payload.formatCredit(info.SU_credit)) + ' credits';
                courseInfo.appendChild(creditDiv);
                const scienceDiv = documentRef.createElement('div');
                scienceDiv.classList.add('course_bs_credit');
                scienceDiv.textContent = 'BS: ' + (info.Basic_Science || '0') + ' credits';
                if (!global.showCourseDetails) scienceDiv.style.display = 'none';
                courseInfo.appendChild(scienceDiv);

                const grade = documentRef.createElement('button');
                grade.classList.add('grade');
                grade.type = 'button';
                grade.setAttribute('aria-haspopup', 'listbox');
                grade.setAttribute('aria-expanded', 'false');
                grade.setAttribute('aria-label', `Grade for ${myCourse.code}: not entered`);
                grade.textContent = 'Add grade';
                courseContainer.appendChild(courseLabel);
                courseContainer.appendChild(courseInfo);
                courseContainer.appendChild(grade);

                const courseElement = documentRef.createElement('div');
                courseElement.classList.add('course');
                courseElement.id = myCourse.id;
                courseElement.appendChild(courseContainer);
                const semesterElement = inputContainer.parentNode.querySelector('.semester');
                if (!semesterElement) return false;
                semesterElement.appendChild(courseElement);

                const totalElement = inputContainer.parentNode.parentNode
                    && inputContainer.parentNode.parentNode.querySelector
                    ? inputContainer.parentNode.parentNode.querySelector('span') : null;
                if (totalElement) {
                    if (global && typeof global.updateSemesterCreditIndicator === 'function') {
                        global.updateSemesterCreditIndicator(totalElement, semester);
                    } else {
                        totalElement.textContent = payload.formatCredit(semester.totalCredit) + ' SU';
                    }
                }
                inputContainer.remove();
                return true;
            },
            getUi() { return global ? global.uiModal : null; },
            getRetakes() { return global ? global.courseRetakes : null; },
            getStorage() { return global ? global.planStorage : null; },
            replaceRetake(payload) {
                const documentRef = getDocument();
                const occurrence = payload.occurrence;
                const oldCourseElement = documentRef && occurrence.course && occurrence.course.id
                    ? documentRef.getElementById(occurrence.course.id) : null;
                const deleteButton = oldCourseElement
                    ? oldCourseElement.querySelector('.delete_course') : null;
                if (!deleteButton) return false;
                deleteButton.click();
                payload.event.target.click();
                return true;
            },
            reload() {
                if (global && global.location && typeof global.location.reload === 'function') {
                    global.location.reload();
                }
            },
            warn() {
                if (global && global.console && typeof global.console.warn === 'function') {
                    global.console.warn.apply(global.console, arguments);
                }
            },
        };
    }

    function createCourseCommitPolicy(dependencies) {
        const services = dependencies || {};
        const parseCredit = typeof services.parseCreditValue === 'function'
            ? services.parseCreditValue : parseCreditFallback;
        const formatCredit = typeof services.formatCreditValue === 'function'
            ? services.formatCreditValue : formatCreditFallback;

        function uiService() {
            return typeof services.getUi === 'function' ? services.getUi() : services.ui;
        }

        function warn() {
            if (typeof services.warn === 'function') services.warn.apply(null, arguments);
        }

        function unavailableReason(reason) {
            const messages = {
                'target-not-later': 'A retake must be placed in a later semester than the existing attempt.',
                'no-prior-occurrence': 'The existing entry is in the same or a later semester.',
                'unfinished-grade': 'The existing attempt does not yet have a final grade. Move or finish that entry before planning a retake.',
                'transfer-requires-substitution-review': 'Courses recorded with T use the university\'s separate substitution process.',
                'passing-retake-window-expired': 'The passing-grade repeat window cannot be confirmed from the selected terms.',
                'multiple-prior-occurrences': 'This plan already contains multiple attempts, so SUrriculum cannot safely choose one to replace.',
                'multiple-existing-occurrences': 'This plan already contains multiple attempts, so SUrriculum cannot safely choose one to replace.',
                'unknown-source-term': 'The existing attempt has no valid semester, so retake eligibility cannot be checked.',
                'unknown-target-term': 'The target semester is not valid, so retake eligibility cannot be checked.',
                'source-term-not-completed': 'A future-semester attempt cannot establish retake eligibility.',
                'unsupported-grade': 'The existing grade is not supported for automatic retake planning.',
            };
            return messages[reason] || 'This duplicate does not meet the automatic retake checks.';
        }

        async function finishRetake(payload) {
            const {
                assessment, courseCode, event, inputContainer,
                targetSemester, escapeHtml,
            } = payload;
            const ui = uiService();
            const occurrence = assessment.occurrence;
            const sourceLabel = occurrence.semester && (occurrence.semester.termName || occurrence.termCode)
                ? String(occurrence.semester.termName || occurrence.termCode) : 'the earlier semester';
            const targetLabel = targetSemester && (targetSemester.termName || targetSemester.termCode)
                ? String(targetSemester.termName || targetSemester.termCode) : 'the selected semester';
            const plannerImpact = '<p><strong>This temporarily removes the earlier attempt\'s credit, GPA, and prerequisite effect from the planner until you enter the new result.</strong></p>';
            const body = `<p><strong>${escapeHtml(courseCode)}</strong> already appears in <strong>${escapeHtml(sourceLabel)}</strong> with grade <strong>${escapeHtml(occurrence.course.grade || '')}</strong>.</p>`
                + `<p>Plan it again in <strong>${escapeHtml(targetLabel)}</strong>? SUrriculum will remove the earlier planner entry and add a new ungraded attempt.</p>`
                + plannerImpact
                + '<p>The university transcript retains both registrations; this replacement is only a simplified planning view. The newest repeat grade can replace the earlier grade even when it is lower, and university rules do not allow withdrawal from a repeated course.</p>'
                + '<p>SUrriculum cannot verify approved leave or first-offering/program exceptions; confirm the registration with your advisor or SUIS.</p>';
            let confirmed = false;
            try {
                confirmed = !!(ui && typeof ui.confirm === 'function'
                    ? await ui.confirm('Plan this course as a retake?', body, {
                        confirmText: 'Replace earlier entry',
                        danger: true,
                    }) : false);
            } catch (_) {}
            if (!confirmed) {
                inputContainer.dataset.retakeInProgress = 'false';
                return;
            }

            const storage = typeof services.getStorage === 'function'
                ? services.getStorage() : services.storage;
            const canSave = storage && typeof storage.requestSave === 'function'
                && typeof storage.flushSaves === 'function';
            if (!canSave || storage.requestSave() === false || storage.flushSaves() === false) {
                if (ui && typeof ui.alert === 'function') {
                    await ui.alert('Retake not added', '<p>Your current planner could not be saved, so no course was changed.</p>');
                }
                inputContainer.dataset.retakeInProgress = 'false';
                return;
            }

            try {
                const replaced = typeof services.replaceRetake === 'function'
                    && services.replaceRetake({ occurrence, event, targetSemester, courseCode });
                if (!replaced) {
                    if (ui && typeof ui.alert === 'function') {
                        await ui.alert('Retake not added', '<p>The earlier planner entry could not be identified. No course was changed.</p>');
                    }
                    inputContainer.dataset.retakeInProgress = 'false';
                    return;
                }
                const retakes = typeof services.getRetakes === 'function'
                    ? services.getRetakes() : services.retakes;
                const normalize = retakes && typeof retakes.normalizeCourseCode === 'function'
                    ? retakes.normalizeCourseCode : canonicalizeCourseCode;
                const targetHasNewAttempt = !!(targetSemester && Array.isArray(targetSemester.courses)
                    && targetSemester.courses.some((course) => (
                        normalize(course && course.code) === normalize(courseCode)
                    )));
                if (!targetHasNewAttempt || storage.requestSave() === false || storage.flushSaves() === false) {
                    throw new Error('The replacement could not be saved.');
                }
            } catch (_) {
                try {
                    if (storage && typeof storage.suspendSaves === 'function') storage.suspendSaves();
                } catch (_) {}
                try {
                    if (ui && typeof ui.alert === 'function') {
                        await ui.alert('Retake not added', '<p>The earlier course will be restored because the replacement could not be saved.</p>');
                    }
                } finally {
                    if (typeof services.reload === 'function') services.reload();
                }
            }
        }

        function commitSelectedCourse(context) {
            const deps = context || {};
            const event = deps.event;
            const curriculum = deps.curriculum;
            const courseData = deps.courseData;
            const escapeHtml = typeof deps.escapeHtml === 'function'
                ? deps.escapeHtml : escapeHtmlFallback;
            if (!event || !event.target || !curriculum || !Array.isArray(courseData)
                || typeof services.createCourse !== 'function'
                || typeof services.isCourseValid !== 'function'
                || typeof services.getInfo !== 'function'
                || typeof services.renderAddedCourse !== 'function') return false;

            const inputContainer = deps.inputContainer
                || (typeof services.getInputContainer === 'function'
                    ? services.getInputContainer(event) : null);
            const inputValue = deps.inputValue !== undefined
                ? String(deps.inputValue || '').trim()
                : (typeof services.readInputValue === 'function'
                    ? services.readInputValue(event, inputContainer) : '');
            if (!inputContainer || !inputValue) return false;

            const tokens = inputValue.split(/\s+/);
            let tentativeCode = tokens[0] || '';
            if (tokens.length > 1 && /\d/.test(tokens[1])) tentativeCode += tokens[1];
            tentativeCode = tentativeCode.toUpperCase();
            let courseCode = tentativeCode;
            let originalCourseCode = courseCode;
            let courseObject = services.createCourse(courseCode, '');
            if (!courseObject) return false;

            const findCourseByName = (name) => {
                const wanted = String(name || '').trim().toUpperCase();
                const catalogs = [courseData];
                if (curriculum.doubleMajor && Array.isArray(curriculum.doubleMajorCourseData)) {
                    catalogs.push(curriculum.doubleMajorCourseData);
                }
                for (const catalog of catalogs) {
                    const found = catalog.find((record) => (
                        String(record && record.Course_Name || '').toUpperCase() === wanted
                    ));
                    if (found) return found;
                }
                return null;
            };

            if (!services.isCourseValid(courseObject, courseData)) {
                const found = findCourseByName(inputValue);
                if (found) {
                    courseCode = String(found.Major || '') + String(found.Code || '');
                    originalCourseCode = courseCode;
                    courseObject = services.createCourse(courseCode, '');
                }
            }
            const canonicalCourseCode = canonicalizeCourseCode(courseCode);
            const originalValid = services.isCourseValid(courseObject, courseData);
            const canonicalObject = canonicalCourseCode !== courseCode
                ? services.createCourse(canonicalCourseCode, '') : courseObject;
            const canonicalValid = canonicalObject
                ? services.isCourseValid(canonicalObject, courseData) : false;
            if (!originalValid && !canonicalValid) {
                const ui = uiService();
                const body = '<p>Course not found.</p><p>Please select a course from the dropdown list.</p>';
                if (ui && typeof ui.alert === 'function') ui.alert('Course not found', body);
                else warn('Course not found');
                if (typeof services.clearInput === 'function') services.clearInput(inputContainer);
                return;
            }
            courseCode = canonicalCourseCode;

            const targetSemester = deps.targetSemester
                || (typeof services.resolveTargetSemester === 'function'
                    ? services.resolveTargetSemester(event, curriculum, inputContainer) : null);
            if (!targetSemester) return false;

            if (!curriculum.hasCourse(courseCode)) {
                const info = services.getInfo(courseCode, courseData)
                    || services.getInfo(originalCourseCode, courseData);
                if (!info) return false;
                curriculum.course_id += 1;
                const course = services.createCourse(courseCode, 'c' + curriculum.course_id);
                if (!course) return false;
                course.SU_credit = parseCredit(info.SU_credit || '0');
                course.Basic_Science = finiteNumber(info.Basic_Science);
                course.Engineering = finiteNumber(info.Engineering);
                course.ECTS = finiteNumber(info.ECTS);
                const type = String(info.EL_Type || '');
                if (type) course.category = type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
                course.Faculty_Course = info.Faculty_Course || 'No';
                targetSemester.addCourse(course);
                services.renderAddedCourse({
                    event,
                    inputContainer,
                    course,
                    info,
                    semester: targetSemester,
                    formatCredit,
                });
                try {
                    if (typeof curriculum.recalcEffectiveTypes === 'function') {
                        curriculum.recalcEffectiveTypes(courseData);
                    }
                } catch (_) {}
                return true;
            }

            const retakes = typeof services.getRetakes === 'function'
                ? services.getRetakes() : services.retakes;
            const assessment = retakes && typeof retakes.assessRetakeCandidate === 'function'
                ? retakes.assessRetakeCandidate(curriculum.semesters, courseCode, targetSemester)
                : null;
            const ui = uiService();
            if (!assessment || !assessment.eligible || !assessment.occurrence) {
                const body = `<p>You have already added <strong>${escapeHtml(courseCode)}</strong>.</p>`
                    + `<p>${escapeHtml(unavailableReason(assessment && assessment.reason))}</p>`;
                if (ui && typeof ui.alert === 'function') ui.alert('Already added', body);
                else warn('Already added', courseCode);
                if (typeof services.clearInput === 'function') services.clearInput(inputContainer);
                return;
            }

            if (!inputContainer.dataset) inputContainer.dataset = {};
            if (inputContainer.dataset.retakeInProgress === 'true') return;
            inputContainer.dataset.retakeInProgress = 'true';
            finishRetake({
                assessment,
                courseCode,
                event,
                inputContainer,
                targetSemester,
                escapeHtml,
            });
            return true;
        }

        return Object.freeze({ commit: commitSelectedCourse });
    }

    let defaultBrowserPolicy = null;
    function getDefaultBrowserPolicy() {
        if (!defaultBrowserPolicy) {
            defaultBrowserPolicy = createCourseCommitPolicy(createBrowserDependencies(root));
        }
        return defaultBrowserPolicy;
    }

    const namespace = root.SurriculumModules || (root.SurriculumModules = {});
    namespace.plannerCourseCommit = Object.freeze({
        create: createCourseCommitPolicy,
        createBrowser(host) {
            return createCourseCommitPolicy(createBrowserDependencies(host || root));
        },
        commit(context) {
            return getDefaultBrowserPolicy().commit(context);
        },
    });
})(typeof window !== 'undefined' ? window : globalThis);
