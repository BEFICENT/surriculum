// Transactional Scheduler-to-Planner synchronization.
(function (root) {
  'use strict';

  function createPlannerSyncController(options) {
    const config = options || {};
    const foundation = config.foundation;
    const session = config.session;
    if (!foundation || !session) throw new TypeError('Planner sync requires foundation and session.');
    const { escapeHtml, loadTermScheduleIndex, displayTermNameSafe } = foundation;
    const termCode = String(config.termCode || '');
    const termName = String(config.termName || termCode);
    const ui = config.ui || null;
    const pickPlanBtn = config.pickPlanBtn;
    const planListEl = config.planListEl;
    const plannedCourses = config.plannedCourses;
    const normalizePlannerCode = config.normalizePlannerCode;
    const getPlannerInfo = config.getPlannerInfo;
    const formatCredit = config.formatCredit;
    const renderResults = config.renderResults;
    const renderGrid = config.renderGrid;
    const getLastQuery = typeof config.getLastQuery === 'function'
      ? config.getLastQuery : () => '';
    if (!pickPlanBtn || !planListEl || !Array.isArray(plannedCourses)
        || typeof normalizePlannerCode !== 'function'
        || typeof getPlannerInfo !== 'function'
        || typeof formatCredit !== 'function') {
      throw new TypeError('Planner sync requires its controls and planned-course list.');
    }

    const findPlannerSemester = (targetTermCode) => {
      const cur = (typeof window !== 'undefined') ? window.curriculum : null;
      if (!cur) return null;
      const targetTermName = displayTermNameSafe(targetTermCode);
      if (!targetTermName) return null;
      // Prefer stable model identity. A term picker temporarily replaces the
      // rendered <p>, so DOM text alone can incorrectly create a duplicate.
      const targetCode = String(targetTermCode || '').trim();
      const modelMatches = (Array.isArray(cur.semesters) ? cur.semesters : []).filter((semester) => {
        const code = typeof window.semesterTermCode === 'function'
          ? String(window.semesterTermCode(semester) || '')
          : String((semester && semester.termCode) || '').trim();
        return code === targetCode;
      });
      if (modelMatches.length > 1) {
        throw new Error(`The planner contains multiple semester cards for ${targetTermName}. Resolve the duplicate terms before syncing the scheduler.`);
      }
      const modelSemester = modelMatches.length === 1 ? modelMatches[0] : null;
      if (modelSemester && modelSemester.id) {
        const semesterEl = document.getElementById(modelSemester.id);
        const container = semesterEl && semesterEl.closest
          ? semesterEl.closest('.container_semester') : null;
        if (semesterEl && container) {
          return { container, semesterEl, semesterObj: modelSemester };
        }
      }
      return null;
    };

    const createPlannerSemester = (targetTermCode) => {
      const cur = (typeof window !== 'undefined') ? window.curriculum : null;
      const targetTermName = displayTermNameSafe(targetTermCode);
      if (!cur || !targetTermName || typeof createSemeter !== 'function') {
        throw new Error('The planner semester could not be created.');
      }
      const board = document.querySelector('.board');
      const ghost = board ? board.querySelector('.add-semester-ghost') : null;
      const created = createSemeter(true, [], cur, course_data, [], targetTermName);
      if (created && board && ghost) {
        // Keep the "+ New Semester" ghost at the end like the normal flow.
        board.insertBefore(created, ghost);
      }
      const semEl = created ? created.querySelector('.semester') : null;
      const semObj = semEl ? cur.getSemester(semEl.id) : null;
      if (!created || !semEl || !semObj) {
        throw new Error('The planner semester could not be created.');
      }
      return { container: created, semesterEl: semEl, semesterObj: semObj };
    };

    const refreshPlannerTotalsForContainer = (container, semesterObj) => {
      try {
        const span = container ? container.querySelector('.total_credit_text span') : null;
        if (!span) return;
        const computedLoad = semesterObj && semesterObj.totalLoadCredit;
        const load = computedLoad !== null && computedLoad !== undefined
          ? computedLoad : (semesterObj ? (semesterObj.totalCredit || 0) : 0);
        if (typeof window !== 'undefined' && typeof window.updateSemesterCreditIndicator === 'function') {
          // The indicator reads the independently recomputed workload fields.
          // Passing the degree-oriented totalCredit here used to bypass them.
          window.updateSemesterCreditIndicator(span, semesterObj);
        } else {
          const totalText = (typeof window !== 'undefined' && typeof window.formatCreditValue === 'function')
            ? window.formatCreditValue(load)
            : (Number(load).toFixed(1));
          span.textContent = totalText + ' SU';
        }
      } catch (_) {}
    };

    const createPlannerCourseDom = (course, info) => {
      const courseCode = normalizePlannerCode(course && course.code);
      const courseId = String((course && course.id) || '');
      const domCourse = document.createElement('div');
      domCourse.classList.add('course');
      domCourse.id = courseId;

      const cContainer = document.createElement('div');
      cContainer.classList.add('course_container');

      const cLabel = document.createElement('div');
      cLabel.classList.add('course_label');
      cLabel.innerHTML =
        '<div class="course_code">' + escapeHtml(courseCode) + '</div>' +
        '<div class="course_actions">' +
        '<button class="details_course" type="button" title="Details" aria-label="Course details">' +
        '<i class="fa-solid fa-circle-info"></i>' +
        '</button>' +
        '<button class="delete_course" type="button" title="Delete" aria-label="Delete course"></button>' +
        '</div>';

      const cInfo = document.createElement('div');
      cInfo.classList.add('course_info');
      const name = info ? (info.Course_Name || info.course_name || info.title || '') : '';
      const elType = info ? (info.EL_Type || '') : '';
      const su = info ? (info.SU_credit || info.su_credits || 0) : 0;
      const bs = info ? (info.Basic_Science || info.basic_science || 0) : 0;
      cInfo.innerHTML = '<div class="course_name">' + escapeHtml(name || '') + '</div>';
      cInfo.innerHTML += '<div class="course_type">' + escapeHtml(String(elType || 'N/A').toUpperCase()) + '</div>';
      cInfo.innerHTML += '<div class="course_credit">' + escapeHtml(formatCredit(su)) + ' credits </div>';

      const bsDiv = document.createElement('div');
      bsDiv.classList.add('course_bs_credit');
      bsDiv.textContent = 'BS: ' + String(bs || 0) + ' credits';
      try {
        if (typeof window !== 'undefined' && window.showCourseDetails === false) bsDiv.style.display = 'none';
      } catch (_) {}
      cInfo.appendChild(bsDiv);

      const grade = document.createElement('div');
      grade.classList.add('grade');
      grade.textContent = course && course.grade ? String(course.grade) : 'Add grade';

      cContainer.appendChild(cLabel);
      cContainer.appendChild(cInfo);
      cContainer.appendChild(grade);
      domCourse.appendChild(cContainer);
      return domCourse;
    };

    const plannerCourseResolutionFromPage = (code, entry, section) => {
      let info = null;
      try { info = getPlannerInfo(code); } catch (_) {}
      // A selected-program or user-custom row is a complete planner
      // definition. Internal global rows remain external identity fallbacks and
      // must stay plan-scoped/N/A when a scheduler selection reuses them.
      const catalogBacked = !!(info && !info.__globalCourseDefinition);
      if (!catalogBacked && session.coursePageInfoMap && typeof session.coursePageInfoMap.get === 'function') {
        const pi = session.coursePageInfoMap.get(code);
        if (pi) {
          info = {
            ...(info || {}),
            Course_Name: pi.title || pi.header_text || (info && info.Course_Name) || '',
            EL_Type: 'unknown',
            SU_credit: (pi.su_credits != null)
              ? pi.su_credits : ((info && info.SU_credit != null) ? info.SU_credit : 0),
            Basic_Science: (pi.basic_science != null)
              ? pi.basic_science : ((info && info.Basic_Science != null) ? info.Basic_Science : 0),
            Engineering: (pi.engineering != null)
              ? pi.engineering : ((info && info.Engineering != null) ? info.Engineering : 0),
            ECTS: (pi.ects != null)
              ? pi.ects : ((info && info.ECTS != null) ? info.ECTS : 0),
            Faculty_Course: 'No',
            Faculty: pi.faculty || (info && info.Faculty) || '',
          };
        }
      }
      if (!catalogBacked && entry) {
        // The selected schedule row repairs stale/zero-credit placeholders on
        // repeat sync. Preserve fields the schedule does not publish (notably
        // ECTS) while refreshing its current title and section-specific SU.
        info = {
          ...(info || {}),
          Course_Name: entry.title || (info && info.Course_Name) || code,
          EL_Type: 'unknown',
          // The schedule index aggregates course entries; credits remain on
          // the individual section selected by the user.
          SU_credit: (section && section.credits != null)
            ? section.credits : ((info && info.SU_credit != null) ? info.SU_credit : 0),
          Basic_Science: (info && info.Basic_Science != null) ? info.Basic_Science : 0,
          Engineering: (info && info.Engineering != null) ? info.Engineering : 0,
          ECTS: (info && info.ECTS != null) ? info.ECTS : 0,
          Faculty_Course: 'No',
          Faculty: (info && info.Faculty) || '',
        };
      }
      return { info, catalogBacked };
    };

    const plannerCourseInfoFromPage = (code, entry, section) => (
      plannerCourseResolutionFromPage(code, entry, section).info
    );

    const plannerGlobalDefinition = (code, info) => {
      const normalized = normalizePlannerCode(code);
      const match = normalized.match(/^([A-Z]{1,12})(\d[A-Z0-9]*)$/);
      if (!match || !info) return null;
      const number = (value) => {
        const parsed = Number(String(value == null ? '' : value).trim().replace(',', '.'));
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
      };
      return {
        Major: match[1],
        Code: match[2],
        Course_Name: String(info.Course_Name || info.course_name || info.title || normalized),
        ECTS: String(number(info.ECTS != null ? info.ECTS : info.ects)),
        Engineering: number(info.Engineering != null ? info.Engineering : info.engineering),
        Basic_Science: number(info.Basic_Science != null ? info.Basic_Science : info.basic_science),
        SU_credit: String(number(info.SU_credit != null ? info.SU_credit : info.su_credits)),
        Faculty: String(info.Faculty || info.faculty || '').trim().toUpperCase(),
        // Scheduler/global identity cannot claim membership in a selected
        // undergraduate program. A separate explicit program classification is
        // required for that; the safe default is N/A.
        Faculty_Course: 'No',
        EL_Type: 'unknown',
        __globalCourseDefinition: true,
      };
    };

    const plannerGlobalMetadataSnapshot = (rawValue, definitions) => {
      let rows = [];
      if (rawValue) {
        rows = JSON.parse(rawValue);
        if (!Array.isArray(rows)) throw new Error('Saved external course metadata is invalid.');
      }
      const byCode = new Map();
      rows.forEach((row) => {
        const code = normalizePlannerCode(row && row.code);
        if (code && !byCode.has(code)) byCode.set(code, row);
      });
      (Array.isArray(definitions) ? definitions : []).forEach((definition) => {
        const code = normalizePlannerCode(String(definition.Major || '') + String(definition.Code || ''));
        if (!code) return;
        const previous = byCode.get(code) || {};
        const title = String(definition.Course_Name || '').trim();
        const suCredits = Number(definition.SU_credit);
        const nextEcts = Number(definition.ECTS);
        const previousEcts = Number(previous.ects);
        byCode.set(code, {
          code,
          title: title && title !== code ? title : String(previous.title || title || code),
          // Section credit is the scheduler's term-specific source of truth;
          // zero-credit seminars are valid and must not inherit stale credit.
          suCredits: Number.isFinite(suCredits) && suCredits >= 0 ? suCredits : 0,
          // Schedule rows do not currently carry ECTS. Preserve a known value
          // instead of replacing it with that absence-derived zero.
          ects: Number.isFinite(nextEcts) && nextEcts > 0
            ? nextEcts : (Number.isFinite(previousEcts) && previousEcts >= 0 ? previousEcts : 0),
        });
      });
      return JSON.stringify(Array.from(byCode.values()).sort((a, b) => a.code.localeCompare(b.code)));
    };

    const applyPlannerMetadata = (course, info) => {
      if (!course || !info) return;
      const credit = (typeof window !== 'undefined' && typeof window.parseCreditValue === 'function')
        ? window.parseCreditValue(info.SU_credit || 0)
        : (parseFloat(info.SU_credit || 0) || 0);
      course.SU_credit = credit;
      course.Basic_Science = parseFloat(info.Basic_Science || 0) || 0;
      course.Engineering = parseFloat(info.Engineering || 0) || 0;
      course.ECTS = parseFloat(info.ECTS || 0) || 0;
      course.Faculty_Course = info.Faculty_Course || 'No';
      course.Faculty = info.Faculty || '';
    };

    const refreshPlannerCourseDomMetadata = (domCourse, course, info) => {
      if (!domCourse || !course || !info) return;
      try {
        const nameNode = domCourse.querySelector('.course_name');
        const creditNode = domCourse.querySelector('.course_credit');
        const scienceNode = domCourse.querySelector('.course_bs_credit');
        if (nameNode) {
          nameNode.textContent = String(info.Course_Name || info.course_name || info.title || course.code || '');
        }
        if (creditNode) creditNode.textContent = formatCredit(course.SU_credit) + ' credits';
        if (scienceNode) scienceNode.textContent = 'BS: ' + String(course.Basic_Science || 0) + ' credits';
      } catch (_) {}
    };

    const isPlannerComponent = (section) => {
      const component = String(section && section.component ? section.component : '').trim().toLowerCase();
      return !(component.includes('rec') || component.includes('lab'));
    };

    const captureOwnState = (value) => Object.getOwnPropertyDescriptors(value);
    const restoreOwnState = (value, descriptors) => {
      Object.keys(value).forEach((key) => {
        if (!Object.prototype.hasOwnProperty.call(descriptors, key)) {
          try { delete value[key]; } catch (_) {}
        }
      });
      Object.defineProperties(value, descriptors);
    };

    const capturePlannerRollback = (cur) => {
      const semesters = Array.isArray(cur.semesters) ? cur.semesters.slice() : [];
      const courseDataRows = Array.isArray(course_data) ? course_data.slice() : null;
      const curState = captureOwnState(cur);
      const semesterStates = semesters.map((semester) => ({
        semester,
        state: captureOwnState(semester),
      }));
      const courseStates = [];
      semesters.forEach((semester) => {
        (Array.isArray(semester.courses) ? semester.courses : []).forEach((course) => {
          if (course) courseStates.push({ course, state: captureOwnState(course) });
        });
      });

      const board = document.querySelector('.board');
      const boardChildren = board ? Array.from(board.childNodes) : [];
      const semesterDomStates = Array.from(document.querySelectorAll('.semester')).map((element) => ({
        element,
        children: Array.from(element.childNodes),
      }));
      const subcontainerDomStates = Array.from(document.querySelectorAll('.subcontainer_semester')).map((element) => ({
        element,
        children: Array.from(element.childNodes),
      }));
      const visualStates = Array.from(document.querySelectorAll(
        '.container_semester, .course_type, .total_credit_text span'
      )).map((element) => ({
        element,
        className: element.className,
        html: element.matches('.course_type, .total_credit_text span') ? element.innerHTML : null,
        // The semester-credit indicator now carries its workload split,
        // threshold, and accessible explanation in attributes. A failed
        // transactional replacement must restore those alongside its text and
        // class instead of leaving metadata from the rolled-back schedule.
        attributes: element.matches('.total_credit_text span')
          ? Array.from(element.attributes).map((attribute) => [attribute.name, attribute.value])
          : null,
      }));

      return () => {
        courseStates.forEach(({ course, state }) => restoreOwnState(course, state));
        semesterStates.forEach(({ semester, state }) => restoreOwnState(semester, state));
        restoreOwnState(cur, curState);
        cur.semesters = semesters.slice();
        if (courseDataRows && Array.isArray(course_data)) {
          course_data.splice(0, course_data.length, ...courseDataRows);
        }
        semesterDomStates.forEach(({ element, children }) => element.replaceChildren(...children));
        subcontainerDomStates.forEach(({ element, children }) => element.replaceChildren(...children));
        if (board) board.replaceChildren(...boardChildren);
        visualStates.forEach(({ element, className, html, attributes }) => {
          if (attributes) {
            Array.from(element.attributes).forEach((attribute) => {
              element.removeAttribute(attribute.name);
            });
            attributes.forEach(([name, value]) => element.setAttribute(name, value));
          } else {
            element.className = className;
          }
          if (html !== null) element.innerHTML = html;
        });
      };
    };

    const recomputePlannerSemesterGpa = (semester) => {
      let totalGPA = 0;
      let totalGPACredits = 0;
      (Array.isArray(semester && semester.courses) ? semester.courses : []).forEach((course) => {
        let outcome = null;
        if (typeof evaluateGradeForLegacyTotals === 'function') {
          outcome = evaluateGradeForLegacyTotals(course && course.grade, course && course.gradingBasis);
        } else {
          const policy = (typeof window !== 'undefined') ? window.gradePolicy : null;
          if (policy && typeof policy.evaluateGrade === 'function') {
            outcome = policy.evaluateGrade(course && course.grade, course && course.gradingBasis);
          }
        }
        if (!outcome || !outcome.countsInGpa) return;
        const info = plannerCourseInfoFromPage(normalizePlannerCode(course && course.code), null);
        const rawCredit = course && course.SU_credit != null
          ? course.SU_credit : (info ? info.SU_credit : 0);
        const credit = (typeof window !== 'undefined' && typeof window.parseCreditValue === 'function')
          ? window.parseCreditValue(rawCredit || 0)
          : (parseFloat(rawCredit || 0) || 0);
        totalGPA += credit * outcome.gpaPoints;
        totalGPACredits += credit;
      });
      semester.totalGPA = totalGPA;
      semester.totalGPACredits = totalGPACredits;
    };

    const preparePlannerReplacement = (selectionSnapshot, idx, cur) => {
      const retakePolicy = (typeof window !== 'undefined') ? window.courseRetakes : null;

      const retakeFailureMessage = (code, reason) => {
        const messages = {
          'target-not-later': 'the existing attempt is not in an earlier semester',
          'no-prior-occurrence': 'the existing attempt is not in an earlier semester',
          'unfinished-grade': 'the existing attempt does not yet have a final grade',
          'transfer-requires-substitution-review': 'a T grade uses the separate university substitution process',
          'passing-retake-window-expired': 'the passing-grade repeat window cannot be confirmed from the selected terms',
          'multiple-prior-occurrences': 'the plan contains multiple earlier attempts',
          'multiple-existing-occurrences': 'the plan contains multiple attempts',
          'unknown-source-term': 'the existing attempt has no valid semester',
          'unknown-target-term': 'the target semester is not valid',
          'source-term-not-completed': 'the existing attempt is in a future semester',
          'code-alias-requires-review': 'an older or renamed course code matches it and requires manual review',
          'unsupported-grade': 'the existing grade is not supported for automatic retake planning',
        };
        return `${code} cannot be moved into ${termName} because ${messages[reason] || 'its retake eligibility could not be confirmed'}.`;
      };

      let nextCourseId = Number(cur.course_id || 0);
      const seen = new Set();
      const rows = [];
      const retakes = [];
      const globalDefinitions = [];
      selectionSnapshot.forEach(({ raw, crn }) => {
        const entry = idx && idx.get ? idx.get(raw) : null;
        const section = entry && Array.isArray(entry.sections)
          ? entry.sections.find((candidate) => String(candidate && candidate.crn) === String(crn || ''))
          : null;
        if (!entry || !section) {
          throw new Error(`The selected section for ${raw} is no longer available. Re-pick it and try again.`);
        }
        // Component-only sections never belong in the planner. Filter them
        // before deciding which existing course occurrences must move.
        if (!isPlannerComponent(section)) return;
        const code = normalizePlannerCode(raw);
        if (!code || seen.has(code)) return;
        seen.add(code);

        const resolution = plannerCourseResolutionFromPage(code, entry, section);
        const info = resolution.info;
        const globalDefinition = resolution.catalogBacked
          ? null : plannerGlobalDefinition(code, info);
        if (globalDefinition) globalDefinitions.push(globalDefinition);
        const occurrences = retakePolicy && typeof retakePolicy.findCourseOccurrences === 'function'
          ? retakePolicy.findCourseOccurrences(cur, code) : [];
        // The planner has one legacy canonical alias (CS210/DSA210). It blocks
        // duplicates, but a renamed/different code is not an automatic
        // same-code retake under the university rules. Detect it before the
        // replacement commit's canonical filtering could silently remove it.
        const canonicalOccurrences = [];
        (Array.isArray(cur.semesters) ? cur.semesters : []).forEach((semester) => {
          (Array.isArray(semester && semester.courses) ? semester.courses : []).forEach((candidate) => {
            if (normalizePlannerCode(candidate && candidate.code) === code) {
              canonicalOccurrences.push({ semester, course: candidate });
            }
          });
        });
        if (canonicalOccurrences.length !== occurrences.length) {
          throw new Error(retakeFailureMessage(code, 'code-alias-requires-review'));
        }
        if (occurrences.length > 1) {
          throw new Error(retakeFailureMessage(code, 'multiple-existing-occurrences'));
        }

        const existing = occurrences.length ? occurrences[0] : null;
        const existingTermCode = existing && existing.termCode
          ? String(existing.termCode) : '';
        let course = null;
        let retake = null;

        if (existing && existingTermCode === String(termCode || '')) {
          // Replacing sections in the same planner semester is not a retake.
          course = existing.course;
        } else if (existing) {
          const rawGrade = String((existing.course && existing.course.grade) || '').trim().toUpperCase();
          if (!rawGrade || rawGrade === 'REGISTERED') {
            // Preserve the scheduler's established rescheduling behavior for an
            // ungraded placeholder. Completed/in-progress attempts are handled
            // only by the explicit retake policy below.
            course = existing.course;
          } else {
            if (!retakePolicy || typeof retakePolicy.classifyRetake !== 'function') {
              throw new Error(retakeFailureMessage(code, 'unsupported-grade'));
            }
            const classification = retakePolicy.classifyRetake(
              existing.semester,
              existing.course,
              { termCode },
            );
            if (!classification.eligible) {
              throw new Error(retakeFailureMessage(code, classification.reason));
            }
            nextCourseId += 1;
            course = new s_course(code, 'c' + nextCourseId);
            applyPlannerMetadata(course, info);
            retake = { code, occurrence: existing, classification };
            retakes.push(retake);
          }
        }

        let domCourse = course && course.id ? document.getElementById(course.id) : null;
        if (!course) {
          nextCourseId += 1;
          course = new s_course(code, 'c' + nextCourseId);
          applyPlannerMetadata(course, info);
        }
        if (!domCourse) domCourse = createPlannerCourseDom(course, info);
        // Keep preflight side-effect-free for reused live objects/DOM. Their
        // scheduler metadata is applied only after commit rollback is armed.
        rows.push({ code, course, domCourse, crn: String(crn || ''), retake, info });
      });
      return { rows, nextCourseId, retakes, globalDefinitions };
    };

    const commitPlannerReplacement = (prepared, cur) => {
      const rollback = capturePlannerRollback(cur);
      const storage = (typeof window !== 'undefined') ? window.planStorage : null;
      const hasGlobalDefinitions = Array.isArray(prepared.globalDefinitions)
        && prepared.globalDefinitions.length > 0;
      const planId = storage && typeof storage.getSessionPlanId === 'function'
        ? storage.getSessionPlanId() : null;
      let previousGlobalMetadataRaw = null;
      let nextGlobalMetadataRaw = null;
      let globalMetadataWritten = false;
      let loc = null;
      try {
        if (!storage || typeof storage.requestSave !== 'function'
            || typeof storage.flushSaves !== 'function') {
          throw new Error('Planner saving is unavailable.');
        }
        if (hasGlobalDefinitions) {
          if (typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function'
              || typeof storage.removeItem !== 'function') {
            throw new Error('External course metadata saving is unavailable.');
          }
          previousGlobalMetadataRaw = storage.getItem('globalCourseMetadata', planId || undefined);
          nextGlobalMetadataRaw = plannerGlobalMetadataSnapshot(
            previousGlobalMetadataRaw,
            prepared.globalDefinitions,
          );
        }

        loc = findPlannerSemester(termCode) || createPlannerSemester(termCode);
        if (!loc || !loc.container || !loc.semesterEl || !loc.semesterObj) {
          throw new Error(`The planner semester for ${termName} could not be prepared.`);
        }

        const desiredCodes = new Set(prepared.rows.map((row) => row.code));
        const desiredCourses = prepared.rows.map((row) => row.course);
        cur.course_id = prepared.nextCourseId;

        // Refresh reused stale placeholders only inside the transaction, after
        // capturePlannerRollback has snapshotted their previous model state.
        prepared.rows.forEach((row) => applyPlannerMetadata(row.course, row.info));

        // Apply every model mutation synchronously. Same-term and ungraded
        // rescheduled course objects are reused. Confirmed retakes use a fresh,
        // ungraded object so an earlier result is never carried into the repeat.
        (Array.isArray(cur.semesters) ? cur.semesters : []).forEach((semester) => {
          if (semester === loc.semesterObj) {
            semester.courses = desiredCourses.slice();
            return;
          }
          semester.courses = (Array.isArray(semester.courses) ? semester.courses : [])
            .filter((course) => !desiredCodes.has(normalizePlannerCode(course && course.code)));
        });
        prepared.rows.forEach((row) => {
          row.course.scheduler_crn = row.crn;
        });

        // Mirror the already-committed model in the DOM without any await gap.
        loc.semesterEl.querySelectorAll('.course').forEach((element) => element.remove());
        loc.container.querySelectorAll('.input_container').forEach((element) => element.remove());
        document.querySelectorAll('.container_semester .course').forEach((element) => {
          if (element.closest('.container_semester') === loc.container) return;
          const codeNode = element.querySelector('.course_code');
          const code = normalizePlannerCode(codeNode ? codeNode.textContent : '');
          if (desiredCodes.has(code)) element.remove();
        });
        prepared.rows.forEach((row) => loc.semesterEl.appendChild(row.domCourse));

        // Make scheduler-only university courses resolvable before allocation.
        // These internal rows remain excluded from Add Course and use unknown/N/A
        // classification until a program supplies an authoritative definition.
        prepared.globalDefinitions.forEach((definition) => {
          const code = normalizePlannerCode(String(definition.Major || '') + String(definition.Code || ''));
          const existingIndex = course_data.findIndex((record) => (
            normalizePlannerCode(String((record && record.Major) || '') + String((record && record.Code) || '')) === code
          ));
          if (existingIndex < 0) course_data.push(definition);
          else if (course_data[existingIndex] && course_data[existingIndex].__globalCourseDefinition) {
            course_data[existingIndex] = definition;
          }
        });

        if (typeof cur.recalcEffectiveTypes === 'function') cur.recalcEffectiveTypes(course_data);
        (Array.isArray(cur.semesters) ? cur.semesters : []).forEach((semester) => {
          recomputePlannerSemesterGpa(semester);
          const semesterEl = document.getElementById(semester.id);
          const container = semesterEl && semesterEl.closest
            ? semesterEl.closest('.container_semester') : null;
          refreshPlannerTotalsForContainer(container, semester);
        });
        if (typeof window !== 'undefined' && typeof window.updateCurrentTermHighlights === 'function') {
          window.updateCurrentTermHighlights();
        }

        if (nextGlobalMetadataRaw !== null) {
          if (storage.setItem('globalCourseMetadata', nextGlobalMetadataRaw, planId || undefined) === false) {
            throw new Error('External course metadata could not be saved.');
          }
          globalMetadataWritten = true;
        }
        if (storage.requestSave() === false || storage.flushSaves() === false) {
          throw new Error('The updated planner could not be saved.');
        }
        // No failure boundary remains after persistence succeeds. Updating
        // attached name/credit nodes here keeps failed commits and cancelled
        // preflights from leaking scheduler metadata into the visible plan.
        prepared.rows.forEach((row) => refreshPlannerCourseDomMetadata(row.domCourse, row.course, row.info));
        return loc;
      } catch (error) {
        try { rollback(); } catch (rollbackError) {
          try { console.error('Failed to roll back scheduler planner update:', rollbackError); } catch (_) {}
        }
        if (globalMetadataWritten) {
          try {
            if (previousGlobalMetadataRaw === null) {
              storage.removeItem('globalCourseMetadata', planId || undefined);
            } else {
              storage.setItem('globalCourseMetadata', previousGlobalMetadataRaw, planId || undefined);
            }
          } catch (metadataRollbackError) {
            try { console.error('Failed to roll back external course metadata:', metadataRollbackError); } catch (_) {}
          }
        }
        // A semester creation may have queued a save. Flush the restored model
        // so an autosave cannot later persist the failed intermediate state.
        try {
          const storage = (typeof window !== 'undefined') ? window.planStorage : null;
          if (storage && typeof storage.requestSave === 'function') storage.requestSave();
          if (storage && typeof storage.flushSaves === 'function') storage.flushSaves();
        } catch (_) {}
        throw error;
      }
    };

    let plannerUpdateInProgress = false;
    const replacePlannerSemester = async () => {
      if (plannerUpdateInProgress) return;
      const keys = Object.keys(session.selected);
      if (!keys.length) {
        if (ui && typeof ui.alert === 'function') ui.alert('Nothing selected', '<p>Select at least one section first.</p>');
        return;
      }
      plannerUpdateInProgress = true;
      pickPlanBtn.disabled = true;
      try {
        const selectionSnapshot = keys.map((raw) => ({
          raw,
          crn: session.selected[raw] && session.selected[raw].crn ? String(session.selected[raw].crn) : '',
        }));
        const ok = (ui && typeof ui.confirm === 'function')
          ? await ui.confirm(
              `Update ${termName}`,
              `<p>This will <strong>replace</strong> the courses in your planner semester for <strong>${escapeHtml(termName)}</strong> with the scheduler’s selected sections.</p>`,
              { confirmText: 'Replace', danger: true }
            )
          : true;
        if (!ok) return;

        // Complete every asynchronous load before the first planner mutation.
        const idx = session.scheduleIndex || await loadTermScheduleIndex(termCode);
        if (!idx) throw new Error(`Schedule data for ${termName} could not be loaded.`);
        session.scheduleIndex = idx;
        try {
          const loadInfo = (typeof window !== 'undefined') ? window.loadCoursePageInfoIndex : null;
          if (typeof loadInfo === 'function') session.coursePageInfoMap = await loadInfo();
        } catch (_) {
          // Planner catalog and schedule metadata remain valid fallbacks.
        }
        const cur = (typeof window !== 'undefined') ? window.curriculum : null;
        if (!cur || !Array.isArray(cur.semesters)) throw new Error('The planner is not ready yet.');
        const prepared = preparePlannerReplacement(selectionSnapshot, idx, cur);
        if (!prepared.rows.length) {
          throw new Error('Only lab or recitation sections are selected; there are no planner courses to add.');
        }
        if (prepared.retakes && prepared.retakes.length) {
          const items = prepared.retakes.map((item) => {
            const occurrence = item.occurrence || {};
            const source = occurrence.semester && (occurrence.semester.termName || occurrence.termCode)
              ? String(occurrence.semester.termName || occurrence.termCode) : 'an earlier semester';
            const grade = occurrence.course ? String(occurrence.course.grade || '') : '';
            return `<li><strong>${escapeHtml(item.code)}</strong> — ${escapeHtml(source)}, grade <strong>${escapeHtml(grade)}</strong></li>`;
          }).join('');
          const plannerImpact = '<p><strong>This temporarily removes each earlier attempt\'s credit, GPA, and prerequisite effect from the planner until a new result is entered.</strong></p>';
          const retakeOk = (ui && typeof ui.confirm === 'function')
            ? await ui.confirm(
                'Confirm planned retake',
                `<p>The scheduler selection repeats course(s) already recorded in an earlier semester:</p><ul>${items}</ul>`
                  + `<p>Continue by removing each earlier planner entry and adding a new ungraded attempt in <strong>${escapeHtml(termName)}</strong>?</p>`
                  + plannerImpact
                  + '<p>The university transcript retains all registrations; this is only a simplified planning view. The newest repeat grade can replace the earlier grade even when it is lower, and university rules do not allow withdrawal from a repeated course.</p>'
                  + '<p>SUrriculum cannot verify approved leave or first-offering/program exceptions; confirm the registration with your advisor or SUIS.</p>',
                { confirmText: 'Replace earlier entries', danger: true },
              )
            : false;
          if (!retakeOk) return;
        }
        // Establish a known-good persisted checkpoint immediately before the
        // synchronous commit. If current edits cannot be saved, leave both the
        // planner model and DOM completely untouched.
        const storage = (typeof window !== 'undefined') ? window.planStorage : null;
        if (!storage || typeof storage.requestSave !== 'function'
            || typeof storage.flushSaves !== 'function'
            || storage.requestSave() === false
            || storage.flushSaves() === false) {
          throw new Error('Your current planner changes could not be saved, so the update was cancelled.');
        }
        const loc = commitPlannerReplacement(prepared, cur);

        // Refresh scheduler planner-semester pills.
        try {
          const nextCourses = (loc.semesterObj && Array.isArray(loc.semesterObj.courses))
            ? loc.semesterObj.courses.map(x => normalizePlannerCode(x && x.code)).filter(Boolean)
            : [];
          plannedCourses.splice(0, plannedCourses.length, ...nextCourses);
          planListEl.innerHTML = plannedCourses.length
            ? plannedCourses.map(c => (
                `<button type="button" class="scheduler-pill scheduler-plan-pick" data-course="${escapeHtml(c)}" title="Pick a section" aria-label="Pick a section for ${escapeHtml(c)}">${escapeHtml(c)}</button>`
              )).join('')
            : `<div class="scheduler-muted">No courses in your planner semester for <strong>${escapeHtml(termName)}</strong> yet.</div>`;
        } catch (_) {}

        // Re-render results/grid (hide-taken & sorting can depend on plan state).
        try {
          if (session.scheduleIndex) renderResults(session.scheduleIndex, getLastQuery());
          if (session.scheduleIndex) renderGrid(session.scheduleIndex);
        } catch (_) {}
      } catch (error) {
        if (ui && typeof ui.alert === 'function') {
          const message = error && error.message ? error.message : 'The planner was left unchanged.';
          ui.alert('Update failed', `<p>${escapeHtml(message)}</p><p>Your previous planner courses were kept.</p>`);
        }
      } finally {
        plannerUpdateInProgress = false;
        pickPlanBtn.disabled = false;
      }
    };

    pickPlanBtn.addEventListener('click', replacePlannerSemester);
    return Object.freeze({
      findPlannerSemester,
      createPlannerSemester,
      preparePlannerReplacement,
      commitPlannerReplacement,
      replacePlannerSemester,
      dispose() {
        pickPlanBtn.removeEventListener('click', replacePlannerSemester);
      },
    });
  }

  const api = Object.freeze({ createPlannerSyncController });
  if (root) root.SurriculumSchedulerPlannerSync = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
