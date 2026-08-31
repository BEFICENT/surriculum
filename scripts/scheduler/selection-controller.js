// Scheduler section selection, corequisite graph, and selection UI controller.
(function installSchedulerSelectionController(root) {
  'use strict';

  function createSelectionController(options) {
    const config = options || {};
    const foundation = config.foundation;
    const session = config.session;
    const meeting = config.meeting;
    const grid = config.grid;
    const selectedEl = config.selectedElement;
    const resultsEl = config.resultsElement;
    const clearBtn = config.clearButton;
    if (!foundation || !session || !meeting || !grid
        || !selectedEl || !resultsEl || !clearBtn) {
      throw new TypeError('Scheduler selection controller dependencies are incomplete.');
    }

    const window = config.window || root;
    const {
      normalizeCourseId,
      extractCoreqCourseIdsFromCoursePageInfoField,
      createPickerModal,
      loadTermScheduleIndex,
      saveSchedulerState,
      escapeHtml,
      hslFromString,
    } = foundation;
    const {
      getSectionIntervals,
      sectionHasIncompleteMeetingData,
    } = meeting;
    const termCode = String(config.termCode || '');
    const sectionMeetingPreview = config.sectionMeetingPreview;
    const sectionInstructorPreview = config.sectionInstructorPreview;
    const buildDetailUrl = config.buildDetailUrl;
    const openCourseDetailsModal = config.openCourseDetailsModal;
    const getCourseDetails = config.getCourseDetails;
    const fmtCredit = config.formatCredit;
    const shouldShowDetails = config.shouldShowDetails;
    const renderResults = (...args) => config.renderResults(...args);
    const getLastQuery = () => config.getLastQuery();
    const renderGrid = (...args) => grid.renderGrid(...args);
    const clearHoverHighlights = (...args) => grid.clearHoverHighlights(...args);
    const isGridRenderableInterval = (...args) => grid.isGridRenderableInterval(...args);
    const sectionAvailabilityClasses = (...args) => grid.sectionAvailabilityClasses(...args);
    const getOccupiedByDayFromSelected = (...args) => grid.getOccupiedByDayFromSelected(...args);
    const expandedResultSections = config.expandedResultSections;
    const resultsReconciler = config.resultsReconciler;
    if (typeof sectionMeetingPreview !== 'function'
        || typeof sectionInstructorPreview !== 'function'
        || typeof openCourseDetailsModal !== 'function'
        || typeof renderResults !== 'function'
        || !(expandedResultSections instanceof Set)
        || !resultsReconciler) {
      throw new TypeError('Scheduler selection UI dependencies are incomplete.');
    }

    const getSelectedSection = (courseId) => {
      const scheduleIndex = session.scheduleIndex;
      const selected = session.selected || {};
      try {
        if (!scheduleIndex) return null;
        const entry = scheduleIndex.get(courseId);
        if (!entry) return null;
        const pick = selected[courseId];
        const crn = pick && pick.crn ? String(pick.crn) : '';
        return entry.sections.find(s => String(s.crn) === crn) || null;
      } catch (_) {
        return null;
      }
    };

    const buildReverseCoreqIndex = (idx) => {
      const coursePageInfoMap = session.coursePageInfoMap;
      const map = new Map(); // coreq -> Set(base)
      try {
        if (!idx || !coursePageInfoMap) return map;
        for (const entry of idx.values()) {
          const courseId = entry && entry.course_id ? normalizeCourseId(entry.course_id) : '';
          if (!courseId) continue;
          const coreqs = getCoreqsFor(courseId)
            .map(c => normalizeCourseId(c))
            .filter(Boolean)
            .filter(c => idx.get(c));
          for (let i = 0; i < coreqs.length; i++) {
            const c = coreqs[i];
            const set = map.get(c) || new Set();
            set.add(courseId);
            map.set(c, set);
          }
        }
      } catch (_) {}
      return map;
    };

    const getCoreqsFor = (courseId) => {
      const coursePageInfoMap = session.coursePageInfoMap;
      try {
        const cid = normalizeCourseId(courseId);
        if (!cid) return [];
        const registry = (typeof window !== 'undefined') ? window.registrationRules : null;
        const componentMetadata = registry && typeof registry.getComponentMetadata === 'function'
          ? registry.getComponentMetadata(cid) : null;
        // Child records such as ENS491R often contain the reverse corequisite
        // text.  Treating that as another forward edge creates a parent/child
        // cycle, so the reviewed component metadata is authoritative here.
        if (componentMetadata && componentMetadata.plannerCourse === false) return [];

        const out = new Set();
        const info = coursePageInfoMap && typeof coursePageInfoMap.get === 'function'
          ? coursePageInfoMap.get(cid) : null;
        if (info && info.corequisites) {
          extractCoreqCourseIdsFromCoursePageInfoField(info.corequisites)
            .map(c => normalizeCourseId(c))
            .filter(Boolean)
            .forEach((code) => out.add(code));
        }
        if (registry && typeof registry.describeRule === 'function') {
          const described = registry.describeRule(cid);
          const components = described && Array.isArray(described.components)
            ? described.components : [];
          components.forEach((component) => {
            const code = normalizeCourseId(
              component && (component.courseCode || component.course || component.code || component.id),
            );
            if (code && code !== cid) out.add(code);
          });
        }
        return Array.from(out);
      } catch (_) {
        return [];
      }
    };

    const computeBundleClosure = (courseId) => {
      const selected = session.selected || {};
      const start = normalizeCourseId(courseId);
      const set = new Set();
      const stack = [];
      if (!start) return set;
      set.add(start);
      stack.push(start);

      const keys = Object.keys(selected);
      while (stack.length) {
        const curId = stack.pop();
        // Forward edges: cur -> its selected coreqs
        const coreqs = getCoreqsFor(curId);
        for (let i = 0; i < coreqs.length; i++) {
          const c = coreqs[i];
          if (!selected[c]) continue;
          if (set.has(c)) continue;
          set.add(c);
          stack.push(c);
        }
        // Reverse edges: other selected course requires cur
        for (let i = 0; i < keys.length; i++) {
          const other = keys[i];
          if (!other || set.has(other)) continue;
          const reqs = getCoreqsFor(other);
          if (reqs.includes(curId)) {
            set.add(other);
            stack.push(other);
          }
        }
      }
      return set;
    };

    const renderSelected = () => {
      const selected = session.selected || {};
      const scheduleIndex = session.scheduleIndex;
      const reverseCoreqIndex = session.reverseCoreqIndex;
      const missingByCourse = session.missingByCourse || {};
      const orphanByCourse = session.orphanByCourse || {};
      const keys = Object.keys(selected);
      if (!keys.length) {
        selectedEl.innerHTML = '<div class="scheduler-muted">No sections selected.</div>';
        clearHoverHighlights();
        return;
      }

      // Bundle corequisite sections under their main course so users don't end
      // up with "lecture without recitation" (or vice-versa) hidden in the list.
      const selectedKeys = keys.map(k => normalizeCourseId(k)).filter(Boolean);
      const selectedSet = new Set(selectedKeys);
      const parentsFor = (cid) => {
        try {
          const set = reverseCoreqIndex ? reverseCoreqIndex.get(cid) : null;
          return set ? Array.from(set) : [];
        } catch (_) {
          return [];
        }
      };
      const hasSelectedParent = (cid) => {
        try {
          const parents = parentsFor(cid);
          for (let i = 0; i < parents.length; i++) {
            const p = parents[i];
            if (!selectedSet.has(p)) continue;
            const coreqs = getCoreqsFor(p).map(x => normalizeCourseId(x)).filter(Boolean);
            if (coreqs.includes(cid)) return true;
          }
        } catch (_) {}
        return false;
      };

      const roots = selectedKeys
        .filter(cid => !(reverseCoreqIndex && reverseCoreqIndex.has(cid) && hasSelectedParent(cid)))
        .sort((a, b) => String(a).localeCompare(String(b)));

      selectedEl.innerHTML = roots.map((courseId) => {
        const s = selected[courseId] || selected[normalizeCourseId(courseId)] || null;
        const sec = getSelectedSection(courseId);
        const sectionLabel = sec && sec.section ? `-${sec.section}` : '';
        const comp = sec && sec.component ? ` • ${String(sec.component)}` : '';
        const label = `${courseId}${sectionLabel}${comp}`;

        const miss = Array.isArray(missingByCourse[courseId]) ? missingByCourse[courseId] : [];
        const orphan = Array.isArray(orphanByCourse[courseId]) ? orphanByCourse[courseId] : [];

        const instr = sectionInstructorPreview(sec);
        const url = (s && s.crn) ? buildDetailUrl(s.crn) : '';
        const scheduleWarningHtml = (() => {
          try {
            if (!sec) return '<div class="scheduler-selected-warning"><span class="muted">Schedule:</span> Section details are unavailable.</div>';
            const warnings = [];
            if (sectionHasIncompleteMeetingData(sec)) warnings.push('Some meeting times or dates are unavailable; conflict checks are incomplete.');
            const hiddenIntervals = getSectionIntervals(sec).filter(it => !isGridRenderableInterval(it));
            if (hiddenIntervals.length) warnings.push('Some meetings fall outside the supported 08:40–24:00 time grid; their conflicts are still checked.');
            return warnings.length
              ? `<div class="scheduler-selected-warning"><span class="muted">Schedule:</span> ${escapeHtml(warnings.join(' '))}</div>`
              : '';
          } catch (_) {
            return '';
          }
        })();

        const showDetails = shouldShowDetails();
        const d = showDetails ? getCourseDetails(courseId) : null;
        const typeParts = [];
        try {
          if (d && d.mainType) typeParts.push(`Major: ${String(d.mainType).toUpperCase()}`);
          if (d && d.dmType) typeParts.push(`DM: ${String(d.dmType).toUpperCase()}`);
          if (d && Array.isArray(d.minorTypes) && d.minorTypes.length) {
            d.minorTypes.slice(0, 2).forEach(mt => {
              if (!mt || !mt.type) return;
              typeParts.push(`Minor: ${String(mt.type).toUpperCase()}`);
            });
          }
        } catch (_) {}

        const detailLine = (showDetails && d)
          ? (
            (() => {
              const parts = [];
              parts.push(`<span class="muted">Credits:</span> ${escapeHtml(fmtCredit(d.su))} SU`);
              if ((d.bs || 0) > 0) parts.push(`<span class="scheduler-meta-bs">BS</span>: ${escapeHtml(fmtCredit(d.bs))}`);
              if ((d.eng || 0) > 0) parts.push(`<span class="scheduler-meta-eng">ENG</span>: ${escapeHtml(fmtCredit(d.eng))}`);
              if (typeParts.length) parts.push(`<span class="muted">Type:</span> ${escapeHtml(typeParts.join(' / '))}`);
              return `<div class="scheduler-selected-meta">${parts.join(' • ')}</div>`;
            })()
          )
          : '';

        const coreqs = (() => {
          try {
            return getCoreqsFor(courseId)
              .map(c => normalizeCourseId(c))
              .filter(Boolean)
              .filter(c => scheduleIndex && scheduleIndex.get(c));
          } catch (_) {
            return [];
          }
        })();

        const coreqHtml = coreqs.length
          ? (
            `<div class="scheduler-course-coreqs">` +
            `<div class="scheduler-course-coreqs-title">Linked recitation/lab</div>` +
            coreqs.map((cid) => {
              const sel = selected[cid];
              const sec2 = sel ? getSelectedSection(cid) : null;
              const comp2 = sec2 && sec2.component ? String(sec2.component) : '';
              const secLabel2 = sel && sec2 && sec2.section ? `-${sec2.section}` : '';
              const meta = sel ? `${cid}${secLabel2}${comp2 ? ` • ${escapeHtml(comp2)}` : ''}` : cid;
              const missing = miss.includes(cid);
              const btnText = sel ? 'Change' : 'Pick';
              return (
                `<div class="scheduler-coreq-row${missing ? ' is-missing' : ''}">` +
                `<div class="scheduler-coreq-label">${missing ? '<span class="scheduler-coreq-badge">Required</span>' : ''}${escapeHtml(meta)}</div>` +
                `<div class="scheduler-coreq-actions">` +
                `<button class="btn btn-secondary btn-sm scheduler-details" type="button" data-course="${escapeHtml(cid)}" aria-label="Details for ${escapeHtml(cid)}">Details</button>` +
                `<button class="btn btn-secondary btn-sm scheduler-pick" type="button" data-course="${escapeHtml(cid)}" aria-label="${sel ? 'Change section' : 'Pick section'} for ${escapeHtml(cid)}">${btnText}</button>` +
                (sel ? `<button class="scheduler-remove btn btn-secondary btn-sm" type="button" data-course="${escapeHtml(cid)}" aria-label="Remove ${escapeHtml(cid)}">Remove</button>` : '') +
                `</div>` +
                `</div>`
              );
            }).join('') +
            `</div>`
          )
          : '';

        return (
          `<div class="scheduler-selected-item${(miss.length || orphan.length) ? ' is-missing-coreq' : ''}" data-course="${escapeHtml(courseId)}">` +
          `<div class="scheduler-selected-label"><span class="scheduler-color-dot" style="background:${escapeHtml(hslFromString(courseId))}"></span>${escapeHtml(label)}</div>` +
          (instr ? `<div class="scheduler-selected-meta"><span class="muted">Instructor:</span> ${escapeHtml(instr)}</div>` : '') +
          detailLine +
          scheduleWarningHtml +
          (miss.length ? `<div class="scheduler-selected-warning"><span class="muted">Missing coreq:</span> ${escapeHtml(miss.join(', '))}</div>` : '') +
          (orphan.length ? `<div class="scheduler-selected-warning"><span class="muted">Looks like a coreq for:</span> ${escapeHtml(orphan.join(', '))}</div>` : '') +
          `<div class="scheduler-selected-actions-row">` +
          `<button type="button" class="btn btn-secondary btn-sm scheduler-details" data-course="${escapeHtml(courseId)}" aria-label="Details for ${escapeHtml(courseId)}">Details</button>` +
          `<button type="button" class="btn btn-secondary btn-sm scheduler-pick" data-course="${escapeHtml(courseId)}" aria-label="Change section for ${escapeHtml(courseId)}">Change</button>` +
          ((miss.length || orphan.length) ? `<button type="button" class="btn btn-warning btn-sm scheduler-fix-coreq" data-course="${escapeHtml(courseId)}" aria-label="Fix corequisites for ${escapeHtml(courseId)}">Fix</button>` : '') +
          `<button type="button" class="scheduler-remove btn btn-secondary btn-sm" data-course="${escapeHtml(courseId)}" aria-label="Remove ${escapeHtml(courseId)}">Remove</button>` +
          `</div>` +
          coreqHtml +
          `</div>`
        );
      }).join('');

      grid.reconcileRenderedSelected();
    };

    const recomputeMissingCoreqs = async () => {
      const missingByCourse = {};
      const orphanByCourse = {};
      session.missingByCourse = missingByCourse;
      session.orphanByCourse = orphanByCourse;
      let coursePageInfoMap = session.coursePageInfoMap;
      const scheduleIndex = session.scheduleIndex;
      let reverseCoreqIndex = session.reverseCoreqIndex;
      const selected = session.selected || {};
      try {
        const loadInfo = (typeof window !== 'undefined') ? window.loadCoursePageInfoIndex : null;
        if (!coursePageInfoMap && typeof loadInfo === 'function') {
          coursePageInfoMap = await loadInfo();
          session.coursePageInfoMap = coursePageInfoMap;
        }
        if (!coursePageInfoMap || !scheduleIndex) return;
        if (!reverseCoreqIndex) {
          reverseCoreqIndex = buildReverseCoreqIndex(scheduleIndex);
          session.reverseCoreqIndex = reverseCoreqIndex;
        }

        const selectedKeys = Object.keys(selected);
        for (let i = 0; i < selectedKeys.length; i++) {
          const courseId = selectedKeys[i];
          const coreqs = getCoreqsFor(courseId);
          if (!coreqs.length) continue;
          const missing = coreqs
            .map(c => normalizeCourseId(c))
            .filter(c => c && scheduleIndex.get(c))
            .filter(c => !selected[c]);
          if (missing.length) {
            missingByCourse[courseId] = Array.from(new Set(missing));
          }
        }

        // Orphan detection: if a selected course is a known coreq for another course
        // but none of those "main" courses are selected, warn and allow quick-fix.
        try {
          if (reverseCoreqIndex && reverseCoreqIndex.size) {
            const selectedSet = new Set(selectedKeys.map(c => normalizeCourseId(c)));
            selectedKeys.forEach((cidRaw) => {
              const cid = normalizeCourseId(cidRaw);
              const parents = reverseCoreqIndex.get(cid);
              if (!parents || !parents.size) return;
              const missingParents = Array.from(parents).filter(p => !selectedSet.has(p));
              if (missingParents.length) orphanByCourse[cid] = missingParents.slice(0, 4);
            });
          }
        } catch (_) {}
      } catch (_) {}
    };

    const ensureCoreqsSelected = async (scheduleIndex, baseCourseId) => {
      const selected = session.selected || {};
      try {
        const loadInfo = (typeof window !== 'undefined') ? window.loadCoursePageInfoIndex : null;
        if (typeof loadInfo !== 'function') return;
        const map = await loadInfo();
        session.coursePageInfoMap = map;
        const coreqs = getCoreqsFor(baseCourseId);
        for (let i = 0; i < coreqs.length; i++) {
          const cid = normalizeCourseId(coreqs[i]);
          if (!cid) continue;
          if (selected[cid]) continue;
          const entry = scheduleIndex.get(cid);
          if (!entry || !entry.sections || !entry.sections.length) continue;
          const res = await createPickerModal({
            title: `Select corequisite for ${baseCourseId}`,
            bodyHtml: `<p><strong>${escapeHtml(baseCourseId)}</strong> requires <strong>${escapeHtml(cid)}</strong>.</p><p>Select a section to add:</p>`,
            listItems: entry.sections.slice(0, 80).map(sec => {
              const meetingSummary = sectionMeetingPreview(sec, 3);
              const instr = sectionInstructorPreview(sec);
              const sub = [meetingSummary, instr ? `Instructor: ${instr}` : ''].filter(Boolean).join(' — ');
              const label = `${cid}${sec.section ? `-${sec.section}` : ''}${sec.component ? ` • ${sec.component}` : ''}${sec.crn ? ` (CRN ${sec.crn})` : ''}`;
              return { action: 'pick', label, subLabel: sub, value: { course_id: cid, crn: sec.crn }, className: sectionAvailabilityClasses(cid, sec, getOccupiedByDayFromSelected(scheduleIndex, { includeBlocked: true })).join(' ') };
            }),
            buttons: [{ action: 'cancel', label: 'Skip', variant: 'secondary' }],
          });
          if (res.action === 'pick' && res.value) {
            selected[cid] = { course_id: cid, crn: String(res.value.crn || '') };
            saveSchedulerState(termCode, { selected });
          }
        }
      } catch (_) {}
    };

    const pickSectionForCourse = async (scheduleIndex, courseId) => {
      const selected = session.selected || {};
      const entry = scheduleIndex.get(courseId);
      if (!entry || !entry.sections || !entry.sections.length) return;

      // Prefer Lecture sections first if present
      const sections = entry.sections.slice();
      sections.sort((a, b) => {
        const aL = /lec/i.test(a.component || '') ? 0 : 1;
        const bL = /lec/i.test(b.component || '') ? 0 : 1;
        if (aL !== bL) return aL - bL;
        return (a.section || '').localeCompare(b.section || '');
      });

      const res = await createPickerModal({
        title: `Pick a section — ${courseId}`,
        bodyHtml: `<p>${escapeHtml(entry.title || '')}</p>`,
        listItems: sections.slice(0, 120).map(sec => {
          const meetingSummary = sectionMeetingPreview(sec, 3);
          const instr = sectionInstructorPreview(sec);
          const sub = [meetingSummary, instr ? `Instructor: ${instr}` : ''].filter(Boolean).join(' — ');
          const label = `${courseId}${sec.section ? `-${sec.section}` : ''}${sec.component ? ` • ${sec.component}` : ''}${sec.crn ? ` (CRN ${sec.crn})` : ''}`;
          return { action: 'pick', label, subLabel: sub, value: { course_id: courseId, crn: sec.crn }, className: sectionAvailabilityClasses(courseId, sec, getOccupiedByDayFromSelected(scheduleIndex, { includeBlocked: true })).join(' ') };
        }),
        buttons: [{ action: 'cancel', label: 'Cancel', variant: 'secondary' }],
      });
      if (res.action !== 'pick' || !res.value) return;

      selected[courseId] = { course_id: courseId, crn: String(res.value.crn || '') };
      saveSchedulerState(termCode, { selected });
      await ensureCoreqsSelected(scheduleIndex, courseId);
      await recomputeMissingCoreqs();
      renderSelected();
      renderGrid(scheduleIndex);
      try { renderResults(scheduleIndex, getLastQuery()); } catch (_) {}
    };

    const pickSpecificSection = async (scheduleIndex, courseId, crn) => {
      const selected = session.selected || {};
      const cid = normalizeCourseId(courseId);
      const crnText = String(crn || '').trim();
      if (!scheduleIndex || !cid || !crnText) return;
      const entry = scheduleIndex.get(cid);
      if (!entry || !Array.isArray(entry.sections)) return;
      const section = entry.sections.find(sec => String(sec && sec.crn ? sec.crn : '') === crnText) || null;
      if (!section) return;
      selected[cid] = { course_id: cid, crn: crnText };
      saveSchedulerState(termCode, { selected });
      await ensureCoreqsSelected(scheduleIndex, cid);
      await recomputeMissingCoreqs();
      renderSelected();
      renderGrid(scheduleIndex);
      try { renderResults(scheduleIndex, getLastQuery()); } catch (_) {}
    };

    const removeSelectionFromGrid = async (courseId, scheduleIndex) => {
      const selected = session.selected || {};
      const cid = normalizeCourseId(courseId);
      if (!cid) return;
      const bundle = computeBundleClosure(cid);
      if (bundle && bundle.size > 1) {
        bundle.forEach((code) => { delete selected[code]; });
      } else {
        delete selected[cid];
      }
      saveSchedulerState(termCode, { selected });
      await recomputeMissingCoreqs();
      renderSelected();
      if (scheduleIndex) grid.renderGrid(scheduleIndex);
      try { if (scheduleIndex) renderResults(scheduleIndex, getLastQuery()); } catch (_) {}
    };

    clearBtn.addEventListener('click', () => {
      const selected = session.selected || {};
      const scheduleIndex = session.scheduleIndex;
      for (const k of Object.keys(selected)) delete selected[k];
      saveSchedulerState(termCode, { selected });
      session.missingByCourse = {};
      renderSelected();
      if (scheduleIndex) grid.renderGrid(scheduleIndex);
      else {
        grid.clearGridBlocks();
        grid.clearPreviewBlocks();
      }
      resultsReconciler.renderHtml('<div class="scheduler-muted">Cleared. Search to add courses.</div>');
    });

    selectedEl.addEventListener('click', async (e) => {
      const selected = session.selected || {};
      const scheduleIndex = session.scheduleIndex;
      const missingByCourse = session.missingByCourse || {};
      const orphanByCourse = session.orphanByCourse || {};
      const btn = e.target && e.target.closest ? e.target.closest('.scheduler-remove') : null;
      const pick = e.target && e.target.closest ? e.target.closest('.scheduler-pick') : null;
      const fix = e.target && e.target.closest ? e.target.closest('.scheduler-fix-coreq') : null;
      const details = e.target && e.target.closest ? e.target.closest('.scheduler-details') : null;
      if (details) {
        const courseId = normalizeCourseId(details.getAttribute('data-course') || '');
        if (courseId) await openCourseDetailsModal(courseId);
        return;
      }
      if (pick) {
        try {
          const courseId = normalizeCourseId(pick.getAttribute('data-course') || '');
          if (!courseId) return;
          const idx = scheduleIndex || await loadTermScheduleIndex(termCode);
          if (!idx) return;
          session.scheduleIndex = idx;
          await pickSectionForCourse(idx, courseId);
        } catch (_) {}
        return;
      }
      if (fix) {
        try {
          const courseId = normalizeCourseId(fix.getAttribute('data-course') || '');
          if (!courseId) return;
          const idx = scheduleIndex || await loadTermScheduleIndex(termCode);
          if (!idx) return;
          session.scheduleIndex = idx;
          const miss = Array.isArray(missingByCourse[courseId]) ? missingByCourse[courseId] : [];
          const orphan = Array.isArray(orphanByCourse[courseId]) ? orphanByCourse[courseId] : [];
          if (miss.length) {
            if (miss.length === 1) {
              await pickSectionForCourse(idx, miss[0]);
              return;
            }
            const res = await createPickerModal({
              title: `Fix corequisite for ${courseId}`,
              bodyHtml: `<p>Select a missing corequisite to add:</p>`,
              listItems: miss.slice(0, 10).map(c => ({ action: 'pick', label: c, value: { course_id: c } })),
              buttons: [{ action: 'cancel', label: 'Cancel', variant: 'secondary' }],
            });
            if (res.action === 'pick' && res.value && res.value.course_id) {
              await pickSectionForCourse(idx, res.value.course_id);
            }
            return;
          }
          if (orphan.length) {
            const parents = orphan.filter(p => idx.get(p));
            if (parents.length === 1) {
              await pickSectionForCourse(idx, parents[0]);
              return;
            }
            const res = await createPickerModal({
              title: `Add main course for ${courseId}`,
              bodyHtml: `<p><strong>${courseId}</strong> looks like a corequisite. Select the main course to add:</p>`,
              listItems: parents.slice(0, 10).map(c => ({ action: 'pick', label: c, value: { course_id: c } })),
              buttons: [{ action: 'cancel', label: 'Cancel', variant: 'secondary' }],
            });
            if (res.action === 'pick' && res.value && res.value.course_id) {
              await pickSectionForCourse(idx, res.value.course_id);
            }
          }
        } catch (_) {}
        return;
      }
      if (btn) {
        const c = btn.getAttribute('data-course') || '';
        if (!c) return;
        const courseId = normalizeCourseId(c);
        const bundle = computeBundleClosure(courseId);
        if (bundle && bundle.size > 1) {
          const res = await createPickerModal({
            title: 'Remove sections',
            bodyHtml:
              `<p><strong>${escapeHtml(courseId)}</strong> is linked with corequisites.</p>` +
              `<p>What would you like to remove?</p>`,
            buttons: [
              { action: 'bundle', label: `Remove ${bundle.size} linked sections`, variant: 'primary', value: 'bundle' },
              { action: 'single', label: 'Remove only this section', variant: 'secondary', value: 'single' },
              { action: 'cancel', label: 'Cancel', variant: 'secondary' },
            ],
          });
          if (res.action === 'cancel') return;
          if (res.action === 'bundle') {
            bundle.forEach(x => { delete selected[x]; });
          } else if (res.action === 'single') {
            delete selected[courseId];
          }
        } else {
          delete selected[courseId];
        }
        saveSchedulerState(termCode, { selected });
        await recomputeMissingCoreqs();
        renderSelected();
        try {
          const idx = scheduleIndex || await loadTermScheduleIndex(termCode);
          if (idx) {
            session.scheduleIndex = idx;
            grid.renderGrid(idx);
            renderResults(idx, getLastQuery());
          }
        } catch (_) {}
      }
    });

    resultsEl.addEventListener('click', async (e) => {
      const toggleSections = e.target && e.target.closest ? e.target.closest('.scheduler-sections-toggle') : null;
      if (toggleSections) {
        const courseId = normalizeCourseId(toggleSections.getAttribute('data-course') || '');
        if (!courseId) return;
        if (expandedResultSections.has(courseId)) expandedResultSections.delete(courseId);
        else expandedResultSections.add(courseId);
        try {
          const scheduleIndex = session.scheduleIndex;
          const idx = scheduleIndex || await loadTermScheduleIndex(termCode);
          if (idx) {
            session.scheduleIndex = idx;
            renderResults(idx, getLastQuery());
          }
        } catch (_) {}
        return;
      }
      const sectionPick = e.target && e.target.closest ? e.target.closest('.scheduler-section-pick') : null;
      if (sectionPick) {
        const courseId = normalizeCourseId(sectionPick.getAttribute('data-course') || '');
        const crn = String(sectionPick.getAttribute('data-crn') || '').trim();
        if (!courseId || !crn) return;
        const idx = await loadTermScheduleIndex(termCode);
        if (!idx) return;
        session.scheduleIndex = idx;
        await pickSpecificSection(idx, courseId, crn);
        return;
      }
      const btn = e.target && e.target.closest ? e.target.closest('.scheduler-pick') : null;
      const details = e.target && e.target.closest ? e.target.closest('.scheduler-details') : null;
      if (details) {
        const courseId = normalizeCourseId(details.getAttribute('data-course') || '');
        if (courseId) await openCourseDetailsModal(courseId);
        return;
      }
      if (!btn) return;
      const courseId = normalizeCourseId(btn.getAttribute('data-course') || '');
      if (!courseId) return;
      const idx = await loadTermScheduleIndex(termCode);
      if (!idx) return;
      session.scheduleIndex = idx;
      await pickSectionForCourse(idx, courseId);
    });

    return Object.freeze({
      getSelectedSection,
      buildReverseCoreqIndex,
      getCoreqsFor,
      computeBundleClosure,
      renderSelected,
      recomputeMissingCoreqs,
      ensureCoreqsSelected,
      pickSectionForCourse,
      pickSpecificSection,
      removeSelectionFromGrid,
    });
  }

  const api = Object.freeze({ createSelectionController });
  if (root) root.SurriculumSchedulerSelection = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
