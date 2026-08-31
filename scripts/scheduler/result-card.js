// Scheduler keyed result-card markup renderer.
(function (root) {
  'use strict';

  function createResultCardRenderer(options) {
    const config = options || {};
    const window = config.window || root;
    const {
      coursePreviewInstructor, buildDetailUrl, shouldShowDetails, getCourseDetails,
      normalizeCourseId, getCoreqsFor, sectionMeetingPreview, sectionInstructorPreview,
      sectionAvailabilityClasses, escapeHtml, getSelectedSection, expandedResultSections,
      shouldHighlightAvailability, getRequiredBundleCourseIds, pickBestBundleSections,
      shouldShowBlockedCourses, normalizePlannerCode, canFitWithBlockedHours, formatCredit: fmtCredit,
    } = config;
    if (!window || typeof normalizeCourseId !== 'function' || typeof escapeHtml !== 'function'
        || !(expandedResultSections instanceof Set)) {
      throw new TypeError('Scheduler result-card dependencies are incomplete.');
    }

    const renderCard = (context) => {
      const {
        entry: e, selected, missingByCourse, scheduleIndex, unmetPrereqById,
        requirementEvaluationById, takenBeforeSetForHighlight, occForAvailability,
        blocked, keepVisible,
      } = context || {};
          const already = !!selected[e.course_id];
          const miss = Array.isArray(missingByCourse[e.course_id]) ? missingByCourse[e.course_id] : [];
          const instr = coursePreviewInstructor(e);
          const pick = selected[e.course_id];
          const url = pick && pick.crn ? buildDetailUrl(pick.crn) : '';
          const showDetails = shouldShowDetails();
          const d = showDetails ? getCourseDetails(e.course_id) : null;
          const unmetPrereq = (() => {
            try {
              const cid = normalizeCourseId(e.course_id);
              return cid ? unmetPrereqById.get(cid) : null;
            } catch (_) {
              return null;
            }
          })();
          const requirementEvaluation = (() => {
            try {
              const cid = normalizeCourseId(e.course_id);
              return cid ? requirementEvaluationById.get(cid) || null : null;
            } catch (_) {
              return null;
            }
          })();
          const supplemental = requirementEvaluation && requirementEvaluation.supplemental
            ? requirementEvaluation.supplemental
            : (unmetPrereq && unmetPrereq.supplemental ? unmetPrereq.supplemental : null);
          const hasSupplemental = !!(supplemental && supplemental.hasRule);
          const legacyEvaluation = hasSupplemental && requirementEvaluation
            && requirementEvaluation.legacy ? requirementEvaluation.legacy : null;
          const ordinaryUnmetPrereq = hasSupplemental
            ? (legacyEvaluation && legacyEvaluation.status === 'unmet'
              ? Object.assign(
                {
                  mode: 'expr', required: [], concurrent: [], oneOf: [], oneOfConcurrent: [],
                },
                legacyEvaluation.prerequisite || {},
                { priorSuRequirement: legacyEvaluation.priorSuRequirement || null },
              )
              : null)
            : unmetPrereq;
          const unmetRequired = (ordinaryUnmetPrereq && ordinaryUnmetPrereq.mode === 'expr' && Array.isArray(ordinaryUnmetPrereq.required)) ? ordinaryUnmetPrereq.required.slice() : [];
          const unmetOneOf = (ordinaryUnmetPrereq && ordinaryUnmetPrereq.mode === 'expr' && Array.isArray(ordinaryUnmetPrereq.oneOf)) ? ordinaryUnmetPrereq.oneOf.slice() : [];
          const unmetList = (ordinaryUnmetPrereq && Array.isArray(ordinaryUnmetPrereq.missing)) ? ordinaryUnmetPrereq.missing.slice() : [];
          const priorSuRequirement = ordinaryUnmetPrereq && ordinaryUnmetPrereq.priorSuRequirement
            ? ordinaryUnmetPrereq.priorSuRequirement : null;
          const hasOrdinaryUnmetPrereq = !!(
            (ordinaryUnmetPrereq && ordinaryUnmetPrereq.mode === 'expr'
              && (unmetRequired.length || unmetOneOf.length))
            || (unmetList && unmetList.length)
            || priorSuRequirement
          );
          const hasUnmetPrereq = hasOrdinaryUnmetPrereq
            || !!(hasSupplemental && supplemental.status === 'unmet');
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

          const coreqs = (() => {
            try {
              return getCoreqsFor(e.course_id)
                .map(c => normalizeCourseId(c))
                .filter(Boolean)
                .filter(c => scheduleIndex.get(c));
            } catch (_) {
              return [];
            }
          })();

          const renderInlineSectionsForEntry = (courseId, entry) => {
            const cid = normalizeCourseId(courseId);
            const sections = Array.isArray(entry && entry.sections) ? entry.sections.slice() : [];
            sections.sort((a, b) => {
              const aL = /lec/i.test(a.component || '') ? 0 : 1;
              const bL = /lec/i.test(b.component || '') ? 0 : 1;
              if (aL !== bL) return aL - bL;
              const ac = String(a.component || '').localeCompare(String(b.component || ''));
              if (ac) return ac;
              return String(a.section || '').localeCompare(String(b.section || ''));
            });
            const groups = new Map();
            sections.forEach((sec) => {
              const component = String(sec && sec.component ? sec.component : 'Other').trim() || 'Other';
              if (!groups.has(component)) groups.set(component, []);
              groups.get(component).push(sec);
            });
            const groupHtml = Array.from(groups.entries()).map(([component, list]) => {
              const rows = list.map((sec) => {
                const crn = sec && sec.crn ? String(sec.crn) : '';
                const sectionLabel = sec && sec.section ? String(sec.section) : '';
                const meetingSummary = sectionMeetingPreview(sec, 3);
                const instr = sectionInstructorPreview(sec);
                const meta = [meetingSummary, instr ? `Instructor: ${instr}` : ''].filter(Boolean).join(' — ');
                const isSelected = !!(selected[cid] && String(selected[cid].crn || '') === crn);
                const rowClasses = ['scheduler-inline-section-row', ...sectionAvailabilityClasses(cid, sec, occForAvailability)];
                return (
                  `<div class="${rowClasses.join(' ')}" data-course="${escapeHtml(cid)}" data-crn="${escapeHtml(crn)}" tabindex="0">` +
                  `<div class="scheduler-inline-section-main">` +
                  `<div class="scheduler-inline-section-title">${escapeHtml(cid)}${sectionLabel ? `-${escapeHtml(sectionLabel)}` : ''}${crn ? ` <span class="muted">(CRN ${escapeHtml(crn)})</span>` : ''}${isSelected ? ' <span class="scheduler-details-badge">Selected</span>' : ''}</div>` +
                  (meta ? `<div class="scheduler-inline-section-meta">${escapeHtml(meta)}</div>` : '') +
                  `</div>` +
                  `<div class="scheduler-inline-section-actions">` +
                  `<button class="btn btn-secondary btn-sm scheduler-section-pick" type="button" data-course="${escapeHtml(cid)}" data-crn="${escapeHtml(crn)}" aria-label="${isSelected ? 'Selected' : 'Pick'} ${escapeHtml(cid)}${sectionLabel ? ` section ${escapeHtml(sectionLabel)}` : ' section'}${crn ? ` CRN ${escapeHtml(crn)}` : ''}">${isSelected ? 'Selected' : 'Pick'}</button>` +
                  `</div>` +
                  `</div>`
                );
              }).join('');
              return (
                `<div class="scheduler-inline-section-group">` +
                `<div class="scheduler-inline-section-group-title">${escapeHtml(component)} (${list.length})</div>` +
                rows +
                `</div>`
              );
            }).join('');
            return groupHtml
              ? `<div class="scheduler-inline-sections">${groupHtml}</div>`
              : `<div class="scheduler-inline-sections"><div class="scheduler-muted">No sections listed.</div></div>`;
          };

          const coreqHtml = coreqs.length
            ? (
              `<div class="scheduler-course-coreqs">` +
              `<div class="scheduler-course-coreqs-title">Linked recitation/lab</div>` +
              coreqs.map((cid) => {
                const sel = selected[cid];
                const sec = sel ? getSelectedSection(cid) : null;
                const comp = sec && sec.component ? String(sec.component) : '';
                const secLabel = sel && sec && sec.section ? `-${sec.section}` : '';
                const meta = sel ? `${cid}${secLabel}${comp ? ` • ${escapeHtml(comp)}` : ''}` : cid;
                const missing = (Array.isArray(missingByCourse[e.course_id]) ? missingByCourse[e.course_id] : []).includes(cid);
                const btnText = sel ? 'Change' : 'Pick';
                const expanded = expandedResultSections.has(cid);
                const entry = scheduleIndex.get(cid);
                return (
                  `<div class="scheduler-coreq-row${missing ? ' is-missing' : ''}">` +
                  `<div class="scheduler-coreq-label">${missing ? '<span class="scheduler-coreq-badge">Required</span>' : ''}${escapeHtml(meta)}</div>` +
                  `<div class="scheduler-coreq-actions">` +
                  `<button class="btn btn-secondary btn-sm scheduler-details" type="button" data-course="${escapeHtml(cid)}" aria-label="Details for ${escapeHtml(cid)}">Details</button>` +
                  `<button class="btn btn-secondary btn-sm scheduler-sections-toggle${expanded ? ' is-expanded' : ''}" type="button" data-course="${escapeHtml(cid)}" aria-expanded="${expanded ? 'true' : 'false'}" title="${expanded ? 'Hide sections' : 'Show sections'}" aria-label="${expanded ? 'Hide sections' : 'Show sections'} for ${escapeHtml(cid)}">` +
                  `<i class="fa-solid fa-list-ul" aria-hidden="true"></i>` +
                  (entry && Array.isArray(entry.sections) ? `<span class="scheduler-section-count">${entry.sections.length}</span>` : '') +
                  `</button>` +
                  `<button class="btn btn-secondary btn-sm scheduler-pick" type="button" data-course="${escapeHtml(cid)}" aria-label="${sel ? 'Change section' : 'Pick section'} for ${escapeHtml(cid)}">${btnText}</button>` +
                  `</div>` +
                  (expanded && entry ? renderInlineSectionsForEntry(cid, entry) : '') +
                  `</div>`
                );
              }).join('') +
              `</div>`
            )
            : '';
          const sectionsExpanded = expandedResultSections.has(normalizeCourseId(e.course_id));
          const inlineSectionsHtml = sectionsExpanded
            ? renderInlineSectionsForEntry(e.course_id, e)
            : '';
          return {
            key: `course:${normalizeCourseId(e.course_id)}`,
            html: (() => {
              const classes = ['scheduler-course'];
              if (miss.length) classes.push('is-missing-coreq');
              if (hasUnmetPrereq) classes.push('is-unmet-prereq');
              try {
                if (shouldHighlightAvailability()) {
                  const cid = normalizeCourseId(e.course_id);
                  const isCompleted = !!(cid && takenBeforeSetForHighlight instanceof Set && takenBeforeSetForHighlight.has(cid));
                  if (isCompleted) {
                    classes.push('is-taken');
                  } else if (!already) {
                    const bundle = getRequiredBundleCourseIds(scheduleIndex, e.course_id);
                    const best = pickBestBundleSections(scheduleIndex, bundle, occForAvailability || {});
                    if (best && typeof best.conflicts === 'number') {
                      if (best.conflicts > 0) classes.push('is-available-conflict');
                      else if (best.unknowns > 0) classes.push('is-time-unknown');
                      else classes.push('is-available');
                    }
                  }
                }
              } catch (_) {}
              try {
                if (Array.isArray(blocked) && blocked.length && shouldShowBlockedCourses()) {
                  const cid = normalizeCourseId(e.course_id);
                  if (cid && !keepVisible.has(normalizePlannerCode(cid))) {
                    if (!canFitWithBlockedHours(scheduleIndex, cid)) classes.push('is-blocked-hours');
                  }
                }
              } catch (_) {}
              const prereqHtml = (() => {
                try {
                  if (!hasOrdinaryUnmetPrereq) return '';
                  const lines = [];
                  if (ordinaryUnmetPrereq && ordinaryUnmetPrereq.mode === 'expr') {
                    if (unmetRequired.length) {
                      const missing = unmetRequired.slice(0, 6).join(', ') + (unmetRequired.length > 6 ? '…' : '');
                      lines.push(`<div class="scheduler-course-meta"><span class="scheduler-badge-prereq">Prereq</span> Missing: ${escapeHtml(missing)}</div>`);
                    }
                    (unmetOneOf || []).slice(0, 2).forEach((opts) => {
                      const arr = Array.isArray(opts) ? opts : [];
                      const text = arr.slice(0, 6).join(' / ') + (arr.length > 6 ? ' / …' : '');
                      if (text) lines.push(`<div class="scheduler-course-meta"><span class="scheduler-badge-prereq">Prereq</span> Needs one of: ${escapeHtml(text)}</div>`);
                    });
                    if (priorSuRequirement) {
                      const compactSu = (value) => String(
                        Math.round((Number(value) || 0) * 100) / 100,
                      );
                      const actual = compactSu(priorSuRequirement.actual);
                      const minimum = compactSu(priorSuRequirement.minimum);
                      lines.push(`<div class="scheduler-course-meta"><span class="scheduler-badge-prereq">Prereq</span> Prior SU: ${escapeHtml(actual)} of ${escapeHtml(minimum)} planned/completed</div>`);
                    }
                    return lines.join('');
                  }

                  const mode = ordinaryUnmetPrereq && ordinaryUnmetPrereq.mode
                    ? String(ordinaryUnmetPrereq.mode) : 'and';
                  const label = mode === 'or' ? 'Needs one of:' : 'Missing:';
                  const missing = unmetList.slice(0, 6).join(', ') + (unmetList.length > 6 ? '…' : '');
                  return `<div class="scheduler-course-meta"><span class="scheduler-badge-prereq">Prereq</span> ${escapeHtml(label)} ${escapeHtml(missing)}</div>`;
                } catch (_) {
                  return '';
                }
              })();
              const registrationGuidanceHtml = (() => {
                try {
                  if (!hasSupplemental) return '';
                  const state = String(
                    supplemental.status
                    || (requirementEvaluation && requirementEvaluation.status)
                    || 'review',
                  ).toLowerCase();
                  const label = state === 'met' ? 'Registration guidance met'
                    : (state === 'unmet'
                      ? 'Unmet registration guidance'
                      : 'Review registration guidance');
                  const seen = new Set();
                  const guidanceApi = (typeof window !== 'undefined')
                    ? window.courseFilters : null;
                  const guidance = guidanceApi
                    && typeof guidanceApi.supplementalGuidanceItems === 'function'
                    ? guidanceApi.supplementalGuidanceItems(supplemental, {
                      includeMet: false,
                      includeComponents: false,
                    })
                    : (Array.isArray(supplemental.guidance) ? supplemental.guidance : []);
                  const lines = state === 'met' ? [] : guidance.map((item) => (
                    String(item && item.text ? item.text : item || '').trim()
                  )).filter((text) => {
                    if (!text || seen.has(text)) return false;
                    seen.add(text);
                    return true;
                  });
                  return `<div class="scheduler-course-registration is-${escapeHtml(state)}">`
                    + `<div class="scheduler-course-meta"><span class="scheduler-badge-registration">${escapeHtml(label)}</span></div>`
                    + lines.map((text) => (
                      `<div class="scheduler-course-meta scheduler-registration-line">${escapeHtml(text)}</div>`
                    )).join('')
                    + (state === 'review'
                      ? '<div class="scheduler-course-meta scheduler-registration-line">This course remains available; confirm the rule before registration.</div>'
                      : '')
                    + '</div>';
                } catch (_) {
                  return '';
                }
              })();
              return (
                `<div class="${classes.join(' ')}" data-course="${escapeHtml(e.course_id)}">` +
            `<div class="scheduler-course-head">` +
            `<div class="scheduler-course-id">${escapeHtml(e.course_id)}</div>` +
            `<div class="scheduler-course-title">${escapeHtml(e.title || '')}</div>` +
            `</div>` +
            prereqHtml +
            registrationGuidanceHtml +
            (classes.includes('is-blocked-hours') ? `<div class="scheduler-course-meta"><span class="scheduler-badge-blocked">Blocked hours</span> No section combination fits your blocked time.</div>` : '') +
            (instr ? `<div class="scheduler-course-meta"><span class="muted">Instructor:</span> ${escapeHtml(instr)}</div>` : '') +
            (showDetails && d
              ? (
                (() => {
                  const parts = [];
                  parts.push(`<span class="muted">Credits:</span> ${escapeHtml(fmtCredit(d.su))} SU`);
                  if ((d.bs || 0) > 0) parts.push(`<span class="scheduler-meta-bs">BS</span>: ${escapeHtml(fmtCredit(d.bs))}`);
                  if ((d.eng || 0) > 0) parts.push(`<span class="scheduler-meta-eng">ENG</span>: ${escapeHtml(fmtCredit(d.eng))}`);
                  if (typeParts.length) parts.push(`<span class="muted">Type:</span> ${escapeHtml(typeParts.join(' / '))}`);
                  return `<div class="scheduler-course-meta">${parts.join(' • ')}</div>`;
                })()
              )
              : '') +
            `<div class="scheduler-course-actions">` +
            `<button class="btn btn-secondary btn-sm scheduler-details" type="button" data-course="${escapeHtml(e.course_id)}" aria-label="Details for ${escapeHtml(e.course_id)}">Details</button>` +
            `<button class="btn btn-secondary btn-sm scheduler-sections-toggle${sectionsExpanded ? ' is-expanded' : ''}" type="button" data-course="${escapeHtml(e.course_id)}" aria-expanded="${sectionsExpanded ? 'true' : 'false'}" title="${sectionsExpanded ? 'Hide sections' : 'Show sections'}" aria-label="${sectionsExpanded ? 'Hide sections' : 'Show sections'} for ${escapeHtml(e.course_id)}">` +
            `<i class="fa-solid fa-list-ul" aria-hidden="true"></i>` +
            (Array.isArray(e.sections) ? `<span class="scheduler-section-count">${e.sections.length}</span>` : '') +
            `</button>` +
            `<button class="btn btn-secondary btn-sm scheduler-pick" type="button" data-course="${escapeHtml(e.course_id)}" aria-label="${already ? 'Change section' : 'Pick section'} for ${escapeHtml(e.course_id)}">${already ? 'Change section' : 'Pick section'}</button>` +
            `</div>` +
            inlineSectionsHtml +
            coreqHtml +
            `</div>`
              );
            })(),
          };
    };

    return Object.freeze({ renderCard });
  }

  const api = Object.freeze({ createResultCardRenderer });
  if (root) root.SurriculumSchedulerResultCard = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
