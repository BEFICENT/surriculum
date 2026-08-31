// Scheduler course-detail modal and external detail/syllabus pickers.
(function (root) {
  'use strict';

  function createCourseDetailsController(options) {
    const config = options || {};
    const foundation = config.foundation;
    const session = config.session;
    if (!foundation || !session) throw new TypeError('Course details require foundation and session.');
    const {
      escapeHtml,
      normalizeCourseId,
      parseDaysToKeys,
      parseTimeRangeToMinutes,
      minutesToLabel,
      loadTermScheduleIndex,
      createPickerModal,
      createInfoModal,
    } = foundation;
    const termCode = String(config.termCode || '');
    const getSectionIntervals = config.getSectionIntervals;
    const sectionInstructorPreview = config.sectionInstructorPreview;
    const buildReverseCoreqIndex = config.buildReverseCoreqIndex;

    const buildDetailUrl = (crn) => {
      const c = String(crn || '').trim();
      if (!c) return '';
      return `https://suis.sabanciuniv.edu/prod/bwckschd.p_disp_detail_sched?term_in=${encodeURIComponent(termCode)}&crn_in=${encodeURIComponent(c)}`;
    };

    const buildSyllabusUrl = (courseId, section) => {
      try {
        const cid = normalizeCourseId(courseId);
        const sec = String(section || '').trim();
        if (!cid || !sec) return '';
        const m = cid.match(/^([A-Z]{2,5})([0-9]+)/);
        const sc = m ? String(m[1] || '').toUpperCase() : '';
        const cn = m ? String(m[2] || '') : '';
        if (!sc || !cn) return '';
        return `https://apps.sabanciuniv.edu/courses/syllabus/view.php?term=${encodeURIComponent(termCode)}&sc=${encodeURIComponent(sc)}&cn=${encodeURIComponent(cn)}&section=${encodeURIComponent(sec)}&view=su`;
      } catch (_) {
        return '';
      }
    };

    const sectionMeetingPreview = (sec, maxMeetings = 3) => {
      try {
        const intervals = getSectionIntervals(sec);
        return intervals.slice(0, maxMeetings).map(it => {
          const base = `${it.dayKey} ${minutesToLabel(it.start)}–${minutesToLabel(it.end)}`;
          const where = it.where && it.where.includes(' / ') ? 'Multiple locations' : it.where;
          let dateHint = '';
          if (Array.isArray(it.dateLabels) && it.dateLabels.length > 1) {
            dateHint = `${it.dateLabels.length} date ranges`;
          } else if (Array.isArray(it.dateWindows) && it.dateWindows.length === 1 && it.dateWindows[0].startDay === it.dateWindows[0].endDay) {
            dateHint = String((it.dateLabels && it.dateLabels[0]) || '').split(' - ')[0];
          }
          return `${base}${where ? ` @ ${where}` : ''}${dateHint ? ` (${dateHint})` : ''}`;
        }).filter(Boolean).join(' • ');
      } catch (_) {
        return '';
      }
    };

    // Stable key for "same timing" comparisons (ignores classroom/instructor,
    // but preserves date windows so separate intensive offerings are not listed
    // as interchangeable CRNs).
    // Expands multi-day strings ("MW") into per-day slots so equivalent schedules
    // normalize the same even if meetings are represented differently.
    const sectionTimeKey = (sec) => {
      try {
        const comp = String(sec && sec.component ? sec.component : '').trim().toLowerCase();
        const parts = [];
        const meetings = (sec && Array.isArray(sec.meetings)) ? sec.meetings : [];
        for (let i = 0; i < meetings.length; i++) {
          const m = meetings[i] || {};
          const daysArr = parseDaysToKeys(m.days || m.Days || '');
          if (!daysArr.length) continue;
          let start = m.start_min;
          let end = m.end_min;
          if (start == null || end == null) {
            const tr = parseTimeRangeToMinutes(m.time || m.Time || '');
            if (tr) {
              start = tr.start;
              end = tr.end;
            }
          }
          if (start == null || end == null) continue;
          const dateRange = String(m.date_range || m.dateRange || '').trim().replace(/\s+/g, ' ');
          for (let di = 0; di < daysArr.length; di++) {
            parts.push(`${daysArr[di]}|${start}|${end}|${dateRange || 'DATE-TBA'}`);
          }
        }
        parts.sort();
        return `${comp}|${parts.length ? parts.join('||') : 'TBA'}`;
      } catch (_) {
        return 'tba|TBA';
      }
    };

    const openDetailPickerForCourse = async (courseId) => {
      try {
        const cid = normalizeCourseId(courseId);
        if (!cid) return;
        const idx = session.scheduleIndex || await loadTermScheduleIndex(termCode);
        if (!idx) return;
        session.scheduleIndex = idx;
        const entry = idx.get(cid);
        if (!entry || !Array.isArray(entry.sections) || !entry.sections.length) return;

        const sections = entry.sections.slice();
        sections.sort((a, b) => {
          const aL = /lec/i.test(a.component || '') ? 0 : 1;
          const bL = /lec/i.test(b.component || '') ? 0 : 1;
          if (aL !== bL) return aL - bL;
          return (String(a.section || '')).localeCompare(String(b.section || ''));
        });

        const res = await createPickerModal({
          title: `Open section — ${cid}`,
          bodyHtml: `<p>${escapeHtml(entry.title || '')}</p><p>Select a section to open its detail page:</p>`,
          listItems: sections.slice(0, 140).map(sec => {
            const meetingSummary = sectionMeetingPreview(sec, 3);
            const instr = sectionInstructorPreview(sec);
            const sub = [meetingSummary, instr ? `Instructor: ${instr}` : ''].filter(Boolean).join(' — ');
            const label = `${cid}${sec.section ? `-${sec.section}` : ''}${sec.component ? ` • ${sec.component}` : ''}${sec.crn ? ` (CRN ${sec.crn})` : ''}`;
            return { action: 'open', label, subLabel: sub, value: { crn: String(sec.crn || '') } };
          }),
          buttons: [{ action: 'cancel', label: 'Close', variant: 'secondary' }],
        });
        if (res && res.action === 'open' && res.value && res.value.crn) {
          const url = buildDetailUrl(res.value.crn);
          if (url) {
            try { window.open(url, '_blank', 'noopener'); } catch (_) {}
          }
        }
      } catch (_) {}
    };

    const openSyllabusPickerForCourse = async (courseId) => {
      try {
        const cid = normalizeCourseId(courseId);
        if (!cid) return;
        const idx = session.scheduleIndex || await loadTermScheduleIndex(termCode);
        if (!idx) return;
        session.scheduleIndex = idx;
        const entry = idx.get(cid);
        if (!entry || !Array.isArray(entry.sections) || !entry.sections.length) return;

        const sections = entry.sections.slice();
        sections.sort((a, b) => {
          const aL = /lec/i.test(a.component || '') ? 0 : 1;
          const bL = /lec/i.test(b.component || '') ? 0 : 1;
          if (aL !== bL) return aL - bL;
          return (String(a.section || '')).localeCompare(String(b.section || ''));
        });

        const res = await createPickerModal({
          title: `Open syllabus — ${cid}`,
          bodyHtml: `<p>${escapeHtml(entry.title || '')}</p><p>Select a section to open its syllabus:</p>`,
          listItems: sections.slice(0, 140).map(sec => {
            const meetingSummary = sectionMeetingPreview(sec, 3);
            const instr = sectionInstructorPreview(sec);
            const sub = [meetingSummary, instr ? `Instructor: ${instr}` : ''].filter(Boolean).join(' — ');
            const label = `${cid}${sec.section ? `-${sec.section}` : ''}${sec.component ? ` • ${sec.component}` : ''}${sec.crn ? ` (CRN ${sec.crn})` : ''}`;
            return { action: 'open', label, subLabel: sub, value: { courseId: cid, section: String(sec.section || '') } };
          }),
          buttons: [{ action: 'cancel', label: 'Close', variant: 'secondary' }],
        });
        if (res && res.action === 'open' && res.value && res.value.courseId && res.value.section) {
          const url = buildSyllabusUrl(res.value.courseId, res.value.section);
          if (url) {
            try { window.open(url, '_blank', 'noopener'); } catch (_) {}
          }
        }
      } catch (_) {}
    };

    const openCourseDetailsModal = async (courseId) => {
      try {
        const cid = normalizeCourseId(courseId);
        if (!cid) return;
        const idx = session.scheduleIndex || await loadTermScheduleIndex(termCode);
        if (!idx) return;
        session.scheduleIndex = idx;
        const entry = idx.get(cid);
        if (!entry) return;

        // Load course-page (catalog) info if available so we can show additional
        // details such as description/prereqs/last-offered terms.
        try {
          const loadInfo = (typeof window !== 'undefined') ? window.loadCoursePageInfoIndex : null;
          if (!session.coursePageInfoMap && typeof loadInfo === 'function') {
            session.coursePageInfoMap = await loadInfo();
          }
        } catch (_) {}
        try {
          const loadInstructorHistory = (typeof window !== 'undefined') ? window.loadCourseInstructorHistoryIndex : null;
          if (!session.courseInstructorHistoryMap && typeof loadInstructorHistory === 'function') {
            session.courseInstructorHistoryMap = await loadInstructorHistory();
          }
        } catch (_) {}
        try {
          const loadSectionHistory = (typeof window !== 'undefined') ? window.loadCourseSectionHistoryIndex : null;
          if (!session.courseSectionHistoryMap && typeof loadSectionHistory === 'function') {
            session.courseSectionHistoryMap = await loadSectionHistory();
          }
        } catch (_) {}
        const pi = (() => {
          try { return session.coursePageInfoMap && typeof session.coursePageInfoMap.get === 'function' ? session.coursePageInfoMap.get(cid) : null; } catch (_) { return null; }
        })();
        const registrationDescription = (() => {
          try {
            const registry = (typeof window !== 'undefined') ? window.registrationRules : null;
            return registry && typeof registry.describeRule === 'function'
              ? registry.describeRule(cid) : null;
          } catch (_) {
            return null;
          }
        })();
        const registrationEvaluation = (() => {
          try {
            const shared = (typeof window !== 'undefined') ? window.courseRequisites : null;
            const context = buildSchedulerRequirementContext();
            if (!pi || !shared || typeof shared.evaluateCandidateForTerm !== 'function') return null;
            const result = shared.evaluateCandidateForTerm(pi, cid, context);
            return result && result.supplemental ? result.supplemental : null;
          } catch (_) {
            return null;
          }
        })();
        const supplementalGuidance = registrationEvaluation || registrationDescription;
        const hasSupplementalGuidance = !!(
          supplementalGuidance
          && (
            supplementalGuidance.hasRule
            || supplementalGuidance.ruleId
            || (Array.isArray(supplementalGuidance.guidance)
              && supplementalGuidance.guidance.length)
          )
        );
        const supplementalSource = hasSupplementalGuidance
          && supplementalGuidance.source && typeof supplementalGuidance.source === 'object'
          ? supplementalGuidance.source : {};
        const instructorHistoryInfo = (() => {
          try {
            return session.courseInstructorHistoryMap && typeof session.courseInstructorHistoryMap.get === 'function'
              ? session.courseInstructorHistoryMap.get(cid)
              : null;
          } catch (_) {
            return null;
          }
        })();
        const sectionHistoryInfo = (() => {
          try {
            return session.courseSectionHistoryMap && typeof session.courseSectionHistoryMap.get === 'function'
              ? session.courseSectionHistoryMap.get(cid)
              : null;
          } catch (_) {
            return null;
          }
        })();

        // If this course is a linked recitation/lab (coreq-only), don't show
        // syllabus buttons (syllabi are for the main course).
        let isCoreqOnly = false;
        try {
          if (!session.reverseCoreqIndex && session.coursePageInfoMap) {
            session.reverseCoreqIndex = buildReverseCoreqIndex(idx);
          }
          const parents = session.reverseCoreqIndex ? session.reverseCoreqIndex.get(cid) : null;
          isCoreqOnly = !!(parents && parents.size);
        } catch (_) {}

        const currentSelected = session.selected;
        const pick = currentSelected && currentSelected[cid] ? currentSelected[cid] : null;
        const pickCrn = pick && pick.crn ? String(pick.crn) : '';
        const selectedSec = (pickCrn && Array.isArray(entry.sections))
          ? (entry.sections.find(s => String(s && s.crn ? s.crn : '') === pickCrn) || null)
          : null;

        const renderMeetingRows = (sec) => {
          const ms = (sec && Array.isArray(sec.meetings)) ? sec.meetings : [];
          if (!ms.length) return '<div class="scheduler-details-muted">No meeting times listed.</div>';
          return ms.map(m => {
            const days = (m && m.days ? String(m.days) : '').trim();
            const tr = (m && m.time ? String(m.time) : '').trim();
            const where = (m && m.where ? String(m.where) : '').trim();
            const dr = (m && m.date_range ? String(m.date_range) : '').trim();
            const instr = (m && m.instructors ? String(m.instructors) : '').trim();
            const left = [days, tr].filter(Boolean).join(' ');
            const right = [where, dr].filter(Boolean).join(' — ');
            const iLine = instr ? `<div class="scheduler-details-meeting-instr"><span class="muted">Instructor:</span> ${escapeHtml(instr)}</div>` : '';
            return (
              `<div class="scheduler-details-meeting">` +
              `<div class="scheduler-details-meeting-top">` +
              `<div class="scheduler-details-meeting-when">${escapeHtml(left || 'TBA')}</div>` +
              (right ? `<div class="scheduler-details-meeting-where">${escapeHtml(right)}</div>` : '') +
              `</div>` +
              iLine +
              `</div>`
            );
          }).join('');
        };

        const coursePageUrl = (() => {
          try {
            const u = pi && pi.source_url ? String(pi.source_url) : '';
            return u;
          } catch (_) {
            return '';
          }
        })();

        const actionRow = (() => {
          const openSuisBtn = pickCrn
            ? `<button type="button" class="btn btn-primary btn-sm scheduler-details-open" data-crn="${escapeHtml(pickCrn)}">Open selected on SUIS</button>`
            : `<button type="button" class="btn btn-primary btn-sm scheduler-details-open-picker" data-course="${escapeHtml(cid)}">Open a section on SUIS</button>`;
          const syllabusBtn = isCoreqOnly
            ? ''
            : (
              (selectedSec && selectedSec.section)
                ? `<button type="button" class="btn btn-secondary btn-sm scheduler-details-syllabus" data-course="${escapeHtml(cid)}" data-section="${escapeHtml(String(selectedSec.section))}">Syllabus</button>`
                : `<button type="button" class="btn btn-secondary btn-sm scheduler-details-syllabus-picker" data-course="${escapeHtml(cid)}">Syllabus</button>`
            );
          const openCoursePageBtn = coursePageUrl
            ? `<a class="btn btn-secondary btn-sm" href="${escapeHtml(coursePageUrl)}" target="_blank" rel="noopener">Open course page</a>`
            : '';
          return `<div class="scheduler-details-actions">${openCoursePageBtn}${syllabusBtn}${openSuisBtn}</div>`;
        })();

        const fmtNum = (v) => {
          const n = Number(v);
          if (!Number.isFinite(n)) return '';
          return (Math.round(n * 10) / 10).toFixed(1);
        };

        let termHistoryRowsForDom = [];
        const catalogCard = (() => {
          if (!pi) {
            return (
              `<div class="scheduler-details-card">` +
              `<div class="scheduler-details-card-title">Catalog info</div>` +
              `<div class="scheduler-details-muted">Catalog details are not available for this course.</div>` +
              `</div>`
            );
          }
          const su = (pi.su_credits != null) ? fmtNum(pi.su_credits) : '';
          const ects = (pi.ects != null) ? fmtNum(pi.ects) : '';
          const bs = (pi.basic_science != null) ? fmtNum(pi.basic_science) : '';
          const eng = (pi.engineering != null) ? fmtNum(pi.engineering) : '';
          const prereq = (pi.prerequisites != null) ? String(pi.prerequisites) : '';
          const coreq = (pi.corequisites != null) ? String(pi.corequisites) : '';
          const generalPrereq = (pi.general_requirement_prerequisites != null)
            ? String(pi.general_requirement_prerequisites) : '';
          const minimumPriorSu = (pi.minimum_earned_su_credits != null)
            ? fmtNum(pi.minimum_earned_su_credits) : '';
          const generalRequirements = (pi.general_requirements != null)
            ? String(pi.general_requirements) : '';
          const desc = (pi.description != null) ? String(pi.description) : '';
          const offered = Array.isArray(pi.last_offered_terms) ? pi.last_offered_terms : [];
          const formatDescription = (value) => {
            const raw = String(value || '').trim();
            if (!raw) return '';
            return raw
              .replace(/\r\n/g, '\n')
              .replace(/\n{2,}/g, '\u0000')
              .replace(/[ \t]*\n[ \t]*/g, ' ')
              .replace(/\u0000/g, '\n\n')
              .replace(/[ \t]{2,}/g, ' ')
              .trim();
          };

          const metaParts = [];
          if (su) metaParts.push(`<div><span class="muted">SU:</span> ${escapeHtml(su)}</div>`);
          if (ects) metaParts.push(`<div><span class="muted">ECTS:</span> ${escapeHtml(ects)}</div>`);
          if (bs && bs !== '0.0') metaParts.push(`<div><span class="muted">BS:</span> ${escapeHtml(bs)}</div>`);
          if (eng && eng !== '0.0') metaParts.push(`<div><span class="muted">ENG:</span> ${escapeHtml(eng)}</div>`);

          const instructorHistory = (
            instructorHistoryInfo && Array.isArray(instructorHistoryInfo.history)
              ? instructorHistoryInfo.history
              : []
          );
          const sectionHistory = (
            sectionHistoryInfo && Array.isArray(sectionHistoryInfo.history)
              ? sectionHistoryInfo.history
              : []
          );
          const normalizeTerm = (value) => {
            try {
              const fn = (typeof window !== 'undefined') ? window.normalizeTermIdentifier : null;
              if (typeof fn === 'function') return fn(value);
            } catch (_) {}
            return String(value || '').trim();
          };
          const displayTerm = (value) => {
            try {
              const fn = (typeof window !== 'undefined') ? window.displayTermIdentifier : null;
              if (typeof fn === 'function') return fn(value);
            } catch (_) {}
            return String(value || '').trim();
          };
          const termHistoryMap = new Map();
          offered.forEach((entry) => {
            const term = normalizeTerm(entry && entry.term ? String(entry.term) : '');
            if (!term) return;
            const existing = termHistoryMap.get(term) || { term, instructors: [] };
            termHistoryMap.set(term, existing);
          });
          instructorHistory.forEach((entry) => {
            const term = normalizeTerm(entry && entry.term ? String(entry.term) : '');
            if (!term) return;
            const existing = termHistoryMap.get(term) || { term, instructors: [] };
            const instructors = entry && Array.isArray(entry.instructors)
              ? entry.instructors.filter(Boolean).map(name => String(name))
              : [];
            existing.instructors = Array.from(new Set([...(existing.instructors || []), ...instructors])).sort();
            termHistoryMap.set(term, existing);
          });
          const sectionTerms = new Set();
          const sectionRows = sectionHistory
            .map((entry) => {
              const term = normalizeTerm(entry && entry.term ? String(entry.term) : '');
              if (!term) return null;
              sectionTerms.add(term);
              return {
                term,
                termCode: term,
                section: entry && entry.section ? String(entry.section) : '',
                crn: entry && entry.crn ? String(entry.crn) : '',
                instructors: entry && Array.isArray(entry.instructors)
                  ? entry.instructors.filter(Boolean).map(name => String(name))
                  : [],
                capacity: entry ? entry.capacity : null,
                actual: entry ? entry.actual : null,
                remaining: entry ? entry.remaining : null,
                showSeats: true,
              };
            })
            .filter(Boolean);
          const fallbackRows = Array.from(termHistoryMap.values())
            .filter(entry => entry && entry.term && !sectionTerms.has(entry.term))
            .map(entry => ({
              term: entry.term,
              termCode: entry.term,
              section: '',
              crn: '',
              instructors: entry && Array.isArray(entry.instructors)
                ? entry.instructors.filter(Boolean).map(name => String(name))
                : [],
              capacity: null,
              actual: null,
              remaining: null,
              showSeats: true,
              summaryOnly: true,
            }));
          const limitRowsByDistinctTerms = (rows, maxTerms) => {
            const seenTerms = new Set();
            return rows.filter((row) => {
              const term = row && row.term ? String(row.term) : '';
              if (!term) return false;
              if (!seenTerms.has(term) && seenTerms.size >= maxTerms) return false;
              seenTerms.add(term);
              return true;
            });
          };
          const sortedTermHistoryRows = [...sectionRows, ...fallbackRows]
            .sort((a, b) => {
              const termDiff = parseInt(String(b.term || '0'), 10) - parseInt(String(a.term || '0'), 10);
              if (termDiff) return termDiff;
              return String(a.section || '').localeCompare(String(b.section || '')) || String(a.crn || '').localeCompare(String(b.crn || ''));
            });
          const termHistoryRows = limitRowsByDistinctTerms(sortedTermHistoryRows, 24);
          const fullTermCount = new Set(termHistoryRows.map(row => row && row.term).filter(Boolean)).size;
          const termHistoryHtml = termHistoryRows.length
            ? (
              `<div class="scheduler-details-subsection">` +
              `<div class="scheduler-details-subtitle">Offered Terms, Instructors & Seats (${fullTermCount || termHistoryMap.size})</div>` +
              `<div class="course-history-anchor" data-course-history-anchor="scheduler"></div>` +
              `</div>`
            )
            : '';

          termHistoryRowsForDom = termHistoryRows.map(entry => ({
            term: entry && entry.term ? displayTerm(entry.term) : 'Unknown term',
            termCode: entry && entry.termCode ? entry.termCode : (entry && entry.term ? entry.term : ''),
            section: entry && entry.section ? entry.section : '',
            crn: entry && entry.crn ? entry.crn : '',
            instructors: entry && Array.isArray(entry.instructors)
              ? entry.instructors.filter(Boolean).map(name => String(name))
              : [],
            capacity: entry ? entry.capacity : null,
            actual: entry ? entry.actual : null,
            remaining: entry ? entry.remaining : null,
            showSeats: true,
            summaryOnly: !!(entry && entry.summaryOnly),
          }));

          const formattedDesc = formatDescription(desc);
          const descHtml = formattedDesc && supplementalSource.supersedesDescription !== true
            ? (
              `<div class="scheduler-details-subsection">` +
              `<div class="scheduler-details-subtitle">Description</div>` +
              `<div class="scheduler-details-paragraph">${escapeHtml(formattedDesc).replace(/\n\n/g, '<br><br>')}</div>` +
              `</div>`
            )
            : '';
          const prereqHtml = prereq || (!generalPrereq && !hasSupplementalGuidance)
            ? (
              `<div class="scheduler-details-subsection">` +
              `<div class="scheduler-details-subtitle">Prerequisites</div>` +
              `<div class="scheduler-details-paragraph">${prereq ? escapeHtml(prereq) : 'None'}</div>` +
              `</div>`
            )
            : '';
          const generalRequirementsText = generalRequirements || (minimumPriorSu
            ? `Minimum ${minimumPriorSu} prior SU credits.` : '');
          const generalRequirementsHtml = generalRequirementsText
            ? (
              `<div class="scheduler-details-subsection">` +
              `<div class="scheduler-details-subtitle">General requirements</div>` +
              `<div class="scheduler-details-paragraph">${escapeHtml(generalRequirementsText)}</div>` +
              `</div>`
            )
            : '';
          const supplementalGuidanceHtml = (() => {
            if (!hasSupplementalGuidance) return '';
            const guidanceApi = (typeof window !== 'undefined')
              ? window.courseFilters : null;
            const guidance = guidanceApi
              && typeof guidanceApi.supplementalGuidanceItems === 'function'
              ? guidanceApi.supplementalGuidanceItems(supplementalGuidance, {
                includeMet: true,
                includeComponents: true,
                includeAllBranches: !registrationEvaluation,
              })
              : (Array.isArray(supplementalGuidance.guidance)
                ? supplementalGuidance.guidance : []);
            const seen = new Set();
            const items = guidance.map((item) => (
              String(item && item.text ? item.text : item || '').trim()
            )).filter((text) => {
              if (!text || seen.has(text)) return false;
              seen.add(text);
              return true;
            });
            if (!items.length && supplementalSource.summary) {
              items.push(String(supplementalSource.summary));
            }
            const state = String(supplementalGuidance.status || 'review').toLowerCase();
            const stateLabel = state === 'met' ? 'Met'
              : (state === 'unmet' ? 'Needs attention' : 'Review');
            const sourceUrl = supplementalSource.url || coursePageUrl;
            const authority = supplementalSource.authority || 'SUIS';
            const reviewedAt = supplementalSource.reviewedAt
              ? `, reviewed ${String(supplementalSource.reviewedAt)}` : '';
            const sourceLine = sourceUrl
              ? `<a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(authority)} course page</a>${escapeHtml(reviewedAt)}`
              : `${escapeHtml(authority)}${escapeHtml(reviewedAt)}`;
            return '<div class="scheduler-details-subsection scheduler-registration-guidance">'
              + '<div class="scheduler-registration-guidance-heading">'
              + '<div class="scheduler-details-subtitle">Registration guidance</div>'
              + `<span class="course-registration-state is-${escapeHtml(state)}">${escapeHtml(stateLabel)}</span>`
              + '</div>'
              + (items.length
                ? '<ul class="scheduler-details-list">'
                  + items.map((text) => `<li>${escapeHtml(text)}</li>`).join('')
                  + '</ul>'
                : '<div class="scheduler-details-paragraph">Review the linked course page before registration.</div>')
              + `<div class="course-registration-source">Source: ${sourceLine}.</div>`
              + '<div class="course-registration-advisory">Advisory only—confirm eligibility and any exceptions in SUIS or with your advisor.</div>'
              + '</div>';
          })();

          return (
            `<div class="scheduler-details-card">` +
            `<div class="scheduler-details-card-title">Catalog info</div>` +
            (metaParts.length ? `<div class="scheduler-details-meta">${metaParts.join('')}</div>` : '') +
            prereqHtml +
            generalRequirementsHtml +
            supplementalGuidanceHtml +
            `<div class="scheduler-details-subsection">` +
            `<div class="scheduler-details-subtitle">Corequisites</div>` +
            `<div class="scheduler-details-paragraph">${coreq ? escapeHtml(coreq) : 'None'}</div>` +
            `</div>` +
            descHtml +
            (termHistoryRows.length
              ? (
                `<details class="scheduler-details-disclosure">` +
                `<summary class="scheduler-details-disclosure-summary">Offered Terms, Instructors & Seats (${fullTermCount || termHistoryMap.size})</summary>` +
                `<div class="scheduler-details-disclosure-body">` +
                `<div class="course-history-anchor" data-course-history-anchor="scheduler"></div>` +
                `</div>` +
                `</details>`
              )
              : termHistoryHtml) +
            `</div>`
          );
        })();

        const secRows = (() => {
          const list = Array.isArray(entry.sections) ? entry.sections.slice() : [];
          list.sort((a, b) => {
            const aL = /lec/i.test(a.component || '') ? 0 : 1;
            const bL = /lec/i.test(b.component || '') ? 0 : 1;
            if (aL !== bL) return aL - bL;
            return (String(a.section || '')).localeCompare(String(b.section || ''));
          });
          const limited = list.slice(0, 120);
          const rows = limited.map(sec => {
            const crn = sec && sec.crn ? String(sec.crn) : '';
            const label = `${cid}${sec.section ? `-${sec.section}` : ''}${sec.component ? ` • ${sec.component}` : ''}${crn ? ` (CRN ${crn})` : ''}`;
            const meetingSummary = sectionMeetingPreview(sec, 3);
            const instr = sectionInstructorPreview(sec);
            const meta = [meetingSummary, instr ? `Instructor: ${instr}` : ''].filter(Boolean).join(' — ');
            const selectedBadge = (pickCrn && crn === pickCrn) ? `<span class="scheduler-details-badge">Selected</span>` : '';
            const openBtn = crn
              ? `<button type="button" class="btn btn-secondary btn-sm scheduler-details-open" data-crn="${escapeHtml(crn)}">Open</button>`
              : '';
            const syllabusBtn = (!isCoreqOnly && sec && sec.section)
              ? `<button type="button" class="btn btn-secondary btn-sm scheduler-details-syllabus" data-course="${escapeHtml(cid)}" data-section="${escapeHtml(String(sec.section))}">Syllabus</button>`
              : '';
            return (
              `<div class="scheduler-details-section-row">` +
              `<div class="scheduler-details-section-main">` +
              `<div class="scheduler-details-section-title">${escapeHtml(label)} ${selectedBadge}</div>` +
              (meta ? `<div class="scheduler-details-section-meta">${escapeHtml(meta)}</div>` : '') +
              `</div>` +
              `<div class="scheduler-details-section-actions">${syllabusBtn}${openBtn}</div>` +
              `</div>`
            );
          }).join('');
          const note = list.length > limited.length
            ? `<div class="scheduler-details-muted">Showing ${limited.length} of ${list.length} sections.</div>`
            : '';
          return `<div class="scheduler-details-sections">${rows}${note}</div>`;
        })();

        const bodyHtml =
          `<div class="scheduler-details">` +
          `<div class="scheduler-details-title"><strong>${escapeHtml(cid)}</strong>${entry.title ? ` — ${escapeHtml(entry.title)}` : ''}</div>` +
          actionRow +
          catalogCard +
          (selectedSec
            ? (
              `<div class="scheduler-details-card">` +
              `<div class="scheduler-details-card-title">Selected section</div>` +
              `<div class="scheduler-details-meetings">${renderMeetingRows(selectedSec)}</div>` +
              `</div>`
            )
            : '') +
          `<div class="scheduler-details-card">` +
          `<div class="scheduler-details-card-title">All sections</div>` +
          secRows +
          `</div>` +
          `</div>`;

        await createInfoModal({
          title: `Details — ${cid}`,
          bodyHtml,
          buttons: [{ action: 'close', label: 'Close', variant: 'secondary' }],
          onMount: ({ modal, body }) => {
            try {
              const anchor = body ? body.querySelector('[data-course-history-anchor="scheduler"]') : null;
              const build = (typeof window !== 'undefined') ? window.buildCourseHistoryTableElement : null;
              if (anchor && typeof build === 'function') {
                const node = build(termHistoryRowsForDom, { splitTerms: true, openOffered: true, openFuture: false });
                if (node) anchor.appendChild(node);
              }
            } catch (_) {}
            modal.addEventListener('click', async (e) => {
              const openBtn = e.target && e.target.closest ? e.target.closest('.scheduler-details-open') : null;
              if (openBtn) {
                const crn = String(openBtn.getAttribute('data-crn') || '').trim();
                if (crn) {
                  const url = buildDetailUrl(crn);
                  if (url) {
                    try { window.open(url, '_blank', 'noopener'); } catch (_) {}
                  }
                }
                return;
              }
              const syllabusBtn = e.target && e.target.closest ? e.target.closest('.scheduler-details-syllabus') : null;
              if (syllabusBtn) {
                const c = normalizeCourseId(syllabusBtn.getAttribute('data-course') || '');
                const sec = String(syllabusBtn.getAttribute('data-section') || '').trim();
                if (c && sec) {
                  const url = buildSyllabusUrl(c, sec);
                  if (url) {
                    try { window.open(url, '_blank', 'noopener'); } catch (_) {}
                  }
                }
                return;
              }
              const openPicker = e.target && e.target.closest ? e.target.closest('.scheduler-details-open-picker') : null;
              if (openPicker) {
                const c = normalizeCourseId(openPicker.getAttribute('data-course') || '');
                if (c) await openDetailPickerForCourse(c);
                return;
              }
              const syllabusPicker = e.target && e.target.closest ? e.target.closest('.scheduler-details-syllabus-picker') : null;
              if (syllabusPicker) {
                const c = normalizeCourseId(syllabusPicker.getAttribute('data-course') || '');
                if (c) await openSyllabusPickerForCourse(c);
              }
            });
          },
        });
      } catch (_) {}
    };


    return Object.freeze({
      buildDetailUrl,
      buildSyllabusUrl,
      sectionMeetingPreview,
      sectionTimeKey,
      openDetailPickerForCourse,
      openSyllabusPickerForCourse,
      openCourseDetailsModal,
    });
  }

  const api = Object.freeze({ createCourseDetailsController });
  if (root) root.SurriculumSchedulerCourseDetails = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
