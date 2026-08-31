// Scheduler blocked-time, availability, and bundle-fit model.
(function (root) {
  'use strict';

  function createGridAvailability(options) {
    const config = options || {};
    const {
      DAYS, DAY_START_MIN, DISPLAY_END_MIN, GRID_MAX_END_MIN, body, modal, schedulerGridElement,
      blockedListElement, blockedToggleButton, blockModeButton, session, termCode,
      normalizeCourseId, minutesToLabel, escapeHtml, saveSchedulerState,
      getBlocked, getSelected, getSectionIntervals, sectionHasIncompleteMeetingData,
      shouldHighlightAvailability, shouldShowBlockedCourses, dateWindowsOverlapOnDay,
      getCoreqsFor, renderTimeGrid, CustomEvent, getActivePreviewIntervals,
      getBlockMode, setBlockModeState,
    } = config;
    const schedulerGridEl = schedulerGridElement;
    const blockedListEl = blockedListElement;
    const blockedToggleBtn = blockedToggleButton;
    const blockModeBtn = blockModeButton;
    if (!Array.isArray(DAYS) || !body || !modal || !session
        || typeof normalizeCourseId !== 'function' || typeof getBlocked !== 'function'
        || typeof getSelected !== 'function' || typeof getSectionIntervals !== 'function'
        || typeof getBlockMode !== 'function' || typeof setBlockModeState !== 'function') {
      throw new TypeError('Scheduler grid availability dependencies are incomplete.');
    }

    const getBlockedByDay = () => {
      const out = {};
      DAYS.forEach(d => { out[d.key] = []; });
      try {
        const current = getBlocked();
        const list = Array.isArray(current) ? current : [];
        for (let i = 0; i < list.length; i++) {
          const b = list[i] || {};
          const dayKey = String(b.dayKey || '').trim();
          const start = Number(b.start);
          const end = Number(b.end);
          if (!out[dayKey]) continue;
          if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
          if (end <= start) continue;
          out[dayKey].push({ id: String(b.id || ''), start, end });
        }
        for (const k of Object.keys(out)) out[k].sort((a, b) => a.start - b.start);
      } catch (_) {}
      return out;
    };

    const mergeBlockedIntervalsForDay = (dayKey, list) => {
      try {
        const items = (Array.isArray(list) ? list : [])
          .map(x => ({ start: Number(x.start), end: Number(x.end), id: String(x.id || '') }))
          .filter(x => Number.isFinite(x.start) && Number.isFinite(x.end) && x.end > x.start)
          .sort((a, b) => a.start - b.start);
        const merged = [];
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          const last = merged[merged.length - 1];
          if (!last || it.start > last.end) {
            merged.push({ id: it.id || `${Date.now()}_${Math.random().toString(16).slice(2)}`, start: it.start, end: it.end });
            continue;
          }
          last.end = Math.max(last.end, it.end);
        }
        return merged.map(x => ({ id: x.id, dayKey, start: x.start, end: x.end }));
      } catch (_) {
        return [];
      }
    };

    const setBlocked = (next) => {
      const value = Array.isArray(next) ? next : [];
      session.blocked = value;
      saveSchedulerState(termCode, { blocked: value });
    };

    const renderBlocked = () => {
      if (!blockedListEl) return;
      const current = getBlocked();
      const list = Array.isArray(current) ? current.slice() : [];
      list.sort((a, b) => {
        const da = String(a.dayKey || '');
        const db = String(b.dayKey || '');
        if (da !== db) return da.localeCompare(db);
        return (Number(a.start) || 0) - (Number(b.start) || 0);
      });
      if (!list.length) {
        blockedListEl.innerHTML = '<div class="scheduler-muted">No blocked hours.</div>';
        return;
      }
      blockedListEl.innerHTML = list.map((b) => {
        const day = String(b.dayKey || '');
        const start = Number(b.start);
        const end = Number(b.end);
        const label = `${day} ${minutesToLabel(start)}–${minutesToLabel(end)}`;
        return (
          `<div class="scheduler-blocked-item" data-block-id="${escapeHtml(String(b.id || ''))}">` +
          `<div class="scheduler-blocked-label">${escapeHtml(label)}</div>` +
          `<div class="scheduler-blocked-actions-row">` +
          `<button type="button" class="btn btn-secondary btn-sm scheduler-blocked-remove" data-block-id="${escapeHtml(String(b.id || ''))}" aria-label="Remove blocked time ${escapeHtml(label)}">Remove</button>` +
          `</div>` +
          `</div>`
        );
      }).join('');
    };

    const setBlockMode = (enabled) => {
      setBlockModeState(!!enabled);
      const blockMode = getBlockMode();
      try { modal.classList.toggle('is-block-mode', blockMode); } catch (_) {}
      try { if (blockModeBtn) blockModeBtn.classList.toggle('is-active', blockMode); } catch (_) {}
      try { if (blockedToggleBtn) blockedToggleBtn.textContent = blockMode ? 'Exit block mode' : 'Block hours'; } catch (_) {}
      try { if (blockModeBtn) blockModeBtn.title = blockMode ? 'Exit block mode' : 'Block hours'; } catch (_) {}
    };

    const computeBlockedFitCache = { sig: '', map: new Map() };
    const blockedSig = () => {
      try {
        const current = getBlocked();
        const list = Array.isArray(current) ? current.slice() : [];
        list.sort((a, b) => {
          const da = String(a.dayKey || '');
          const db = String(b.dayKey || '');
          if (da !== db) return da.localeCompare(db);
          return (Number(a.start) || 0) - (Number(b.start) || 0);
        });
        return list.map(b => `${b.dayKey}:${b.start}-${b.end}`).join('|');
      } catch (_) {
        return '';
      }
    };

    const canFitWithBlockedHours = (idx, courseId) => {
      try {
        const sig = blockedSig();
        if (computeBlockedFitCache.sig !== sig) {
          computeBlockedFitCache.sig = sig;
          computeBlockedFitCache.map = new Map();
        }
        const cid = normalizeCourseId(courseId);
        if (!cid) return true;
        if (computeBlockedFitCache.map.has(cid)) return computeBlockedFitCache.map.get(cid);
        const byDay = getBlockedByDay();
        const bundle = getRequiredBundleCourseIds(idx, cid);
        const best = pickBestBundleSections(idx, bundle, byDay);
        const ok = !!(best && typeof best.conflicts === 'number' && best.conflicts === 0);
        computeBlockedFitCache.map.set(cid, ok);
        return ok;
      } catch (_) {
        return true;
      }
    };

    const isGridRenderableInterval = (it) => {
      try {
        if (!it || !DAYS.some(d => d.key === it.dayKey)) return false;
        return Number.isFinite(it.start) && Number.isFinite(it.end) &&
          it.start >= DAY_START_MIN && it.end > it.start && it.end <= GRID_MAX_END_MIN;
      } catch (_) {
        return false;
      }
    };

    const getSelectedIntervals = (idx) => {
      const selected = getSelected();
      const out = [];
      try {
        if (!idx) return out;
        for (const rawCourseId of Object.keys(selected)) {
          const courseId = normalizeCourseId(rawCourseId);
          const pick = selected[rawCourseId] || selected[courseId] || {};
          const entry = courseId ? idx.get(courseId) : null;
          const crn = String(pick && pick.crn ? pick.crn : '');
          const sec = entry && Array.isArray(entry.sections)
            ? (entry.sections.find(s => String(s && s.crn ? s.crn : '') === crn) || null)
            : null;
          if (sec) out.push(...getSectionIntervals(sec));
        }
      } catch (_) {}
      return out;
    };

    const updateGridExtent = (idx) => {
      try {
        const intervals = getSelectedIntervals(idx)
          .concat(Array.isArray(getActivePreviewIntervals()) ? getActivePreviewIntervals() : [])
          .filter(isGridRenderableInterval);
        const optionalDays = new Set(
          intervals.map(it => it.dayKey).filter(dayKey => dayKey === 'S' || dayKey === 'U')
        );

        let requiredEnd = DISPLAY_END_MIN;
        for (let i = 0; i < intervals.length; i++) {
          if (intervals[i].end > requiredEnd) requiredEnd = intervals[i].end;
        }
        const slotCount = Math.max(1, Math.ceil((requiredEnd - DAY_START_MIN) / 60));
        const nextEnd = Math.min(GRID_MAX_END_MIN, DAY_START_MIN + slotCount * 60);
        const visibleDays = DAYS.filter(d => !d.optional || optionalDays.has(d.key));
        const signature = `${visibleDays.map(d => d.key).join('')}:${nextEnd}`;
        if (body.getAttribute('data-grid-layout') === signature) return;

        DAYS.forEach((d) => {
          if (!d.optional) return;
          const visible = optionalDays.has(d.key);
          const head = body.querySelector(`.scheduler-grid-day[data-day="${d.key}"]`);
          const col = body.querySelector(`.scheduler-day-col[data-day="${d.key}"]`);
          if (head) head.hidden = !visible;
          if (col) col.hidden = !visible;
        });

        const dayCount = visibleDays.length;
        const headerEl = body.querySelector('.scheduler-grid-header');
        if (headerEl) headerEl.style.setProperty('--scheduler-day-count', String(dayCount));
        if (schedulerGridEl) schedulerGridEl.style.setProperty('--scheduler-day-count', String(dayCount));
        renderTimeGrid(nextEnd);

        body.setAttribute('data-grid-layout', signature);
        modal.setAttribute('data-grid-days', visibleDays.map(d => d.key).join(''));
        modal.setAttribute('data-grid-minutes', String(nextEnd - DAY_START_MIN));
        try {
          modal.dispatchEvent(new CustomEvent('schedulergridchange', {
            detail: { days: visibleDays.map(d => d.key), endMin: nextEnd },
          }));
        } catch (_) {}
      } catch (_) {}
    };

    const intervalsOverlap = (a, b) => {
      try {
        if (!a || !b) return false;
        if (a.end <= b.start || a.start >= b.end) return false;
        const dayKey = a.dayKey || b.dayKey || '';
        if (a.dayKey && b.dayKey && a.dayKey !== b.dayKey) return false;
        return dateWindowsOverlapOnDay(dayKey, a.dateWindows, b.dateWindows);
      } catch (_) {
        return false;
      }
    };

    const countIntervalOverlaps = (interval, existingIntervals) => {
      let c = 0;
      try {
        const list = Array.isArray(existingIntervals) ? existingIntervals : [];
        for (let i = 0; i < list.length; i++) {
          const it = list[i];
          if (!it) continue;
          if (intervalsOverlap(interval, it)) c += 1;
        }
      } catch (_) {}
      return c;
    };

    const getOccupiedByDayFromSelected = (idx, opts) => {
      const selected = getSelected();
      const occ = {};
      DAYS.forEach(d => { occ[d.key] = []; });
      try {
        if (!idx) return occ;
        const includeBlocked = !!(opts && opts.includeBlocked);
        if (includeBlocked) {
          const byDay = getBlockedByDay();
          for (const dayKey of Object.keys(byDay)) {
            const list = byDay[dayKey] || [];
            for (let i = 0; i < list.length; i++) {
              const b = list[i];
              occ[dayKey].push({ dayKey, start: b.start, end: b.end, dateWindows: null, course_id: '__blocked__' });
            }
          }
        }
        const keys = Object.keys(selected);
        for (let i = 0; i < keys.length; i++) {
          const courseId = normalizeCourseId(keys[i]);
          if (!courseId) continue;
          const entry = idx.get(courseId);
          if (!entry) continue;
          const pick = selected[courseId];
          const crn = pick && pick.crn ? String(pick.crn) : '';
          const sec = entry.sections.find(s => String(s.crn) === crn) || null;
          if (!sec) continue;
          const intervals = getSectionIntervals(sec);
          for (let j = 0; j < intervals.length; j++) {
            const it = intervals[j];
            if (!occ[it.dayKey]) occ[it.dayKey] = [];
            occ[it.dayKey].push({
              dayKey: it.dayKey,
              start: it.start,
              end: it.end,
              dateWindows: it.dateWindows,
              course_id: courseId,
            });
          }
        }
      } catch (_) {}
      return occ;
    };

    const sectionAvailabilityClasses = (courseId, sec, occForAvailability) => {
      const selected = getSelected();
      const blocked = getBlocked();
      const classes = [];
      try {
        const cid = normalizeCourseId(courseId);
        const crn = String(sec && sec.crn ? sec.crn : '').trim();
        const isSelected = !!(cid && crn && selected[cid] && String(selected[cid].crn || '') === crn);
        if (isSelected) {
          classes.push('is-selected');
          return classes;
        }
        if (shouldHighlightAvailability()) {
          const intervals = getSectionIntervals(sec);
          const conflict = intervals.some((it) => countIntervalOverlaps(it, (occForAvailability && occForAvailability[it.dayKey]) || []) > 0);
          if (conflict) classes.push('is-available-conflict');
          else if (sectionHasIncompleteMeetingData(sec)) classes.push('is-time-unknown');
          else classes.push('is-available');
        }
        if (Array.isArray(blocked) && blocked.length && shouldShowBlockedCourses()) {
          const blockedByDay = getBlockedByDay();
          const blockedHit = getSectionIntervals(sec).some((it) => countIntervalOverlaps(it, blockedByDay[it.dayKey] || []) > 0);
          if (blockedHit) classes.push('is-blocked-hours');
        }
      } catch (_) {}
      return classes;
    };

    const getRequiredBundleCourseIds = (idx, baseCourseId) => {
      const start = normalizeCourseId(baseCourseId);
      if (!start || !idx) return [];
      const out = [];
      const seen = new Set();
      const stack = [start];
      while (stack.length) {
        const cid = normalizeCourseId(stack.pop());
        if (!cid || seen.has(cid)) continue;
        seen.add(cid);
        if (!idx.get(cid)) continue;
        out.push(cid);
        try {
          const coreqs = getCoreqsFor(cid)
            .map(x => normalizeCourseId(x))
            .filter(Boolean)
            .filter(x => idx.get(x));
          for (let i = 0; i < coreqs.length; i++) stack.push(coreqs[i]);
        } catch (_) {}
      }
      // Ensure base is first.
      if (out.length > 1) {
        const idx = out.indexOf(start);
        if (idx > 0) {
          out.splice(idx, 1);
          out.unshift(start);
        }
      }
      return out;
    };

    const pickBestBundleSections = (idx, bundleCourseIds, baseOccByDay) => {
      try {
        if (!idx || !bundleCourseIds || !bundleCourseIds.length) return null;
        const candidatesByCourse = {};
        for (let i = 0; i < bundleCourseIds.length; i++) {
          const cid = bundleCourseIds[i];
          const entry = idx.get(cid);
          if (!entry || !Array.isArray(entry.sections) || !entry.sections.length) return null;
          const secs = entry.sections.slice();
          secs.sort((a, b) => {
            const aL = /lec/i.test(a.component || '') ? 0 : 1;
            const bL = /lec/i.test(b.component || '') ? 0 : 1;
            if (aL !== bL) return aL - bL;
            const as = String(a.section || '');
            const bs = String(b.section || '');
            if (as !== bs) return as.localeCompare(bs);
            return String(a.component || '').localeCompare(String(b.component || ''));
          });
          candidatesByCourse[cid] = secs.slice(0, 80);
        }

        const occ = {};
        DAYS.forEach(d => { occ[d.key] = (baseOccByDay && Array.isArray(baseOccByDay[d.key])) ? baseOccByDay[d.key].slice() : []; });

        let best = { score: Infinity, conflicts: Infinity, unknowns: Infinity, picked: null };
        const picked = {};

        const dfs = (i, conflicts, unknowns) => {
          const partialScore = conflicts * 1000 + unknowns;
          if (partialScore >= best.score) return;
          if (best.score === 0) return;
          if (i >= bundleCourseIds.length) {
            best = { score: partialScore, conflicts, unknowns, picked: Object.assign({}, picked) };
            return;
          }
          const cid = bundleCourseIds[i];
          const secs = candidatesByCourse[cid] || [];
          for (let si = 0; si < secs.length; si++) {
            const sec = secs[si];
            const intervals = getSectionIntervals(sec);
            let extra = 0;
            const addedByDay = {};
            // A section's own date-specific rows are one schedule choice, not
            // competing choices. Score every row against the already occupied
            // schedule first, then add the section as a unit.
            for (let j = 0; j < intervals.length; j++) {
              const it = intervals[j];
              if (!occ[it.dayKey]) occ[it.dayKey] = [];
              extra += countIntervalOverlaps(it, occ[it.dayKey]);
            }
            for (let j = 0; j < intervals.length; j++) {
              const it = intervals[j];
              occ[it.dayKey].push({
                dayKey: it.dayKey,
                start: it.start,
                end: it.end,
                dateWindows: it.dateWindows,
                course_id: cid,
              });
              addedByDay[it.dayKey] = (addedByDay[it.dayKey] || 0) + 1;
            }
            picked[cid] = sec;
            dfs(i + 1, conflicts + extra, unknowns + (sectionHasIncompleteMeetingData(sec) ? 1 : 0));
            delete picked[cid];
            for (const dayKey of Object.keys(addedByDay)) {
              const n = addedByDay[dayKey] || 0;
              if (n > 0 && occ[dayKey] && occ[dayKey].length >= n) occ[dayKey].splice(-n, n);
            }
            if (best.score === 0) return;
          }
        };

        dfs(0, 0, 0);
        return best && best.picked ? best : null;
      } catch (_) {
        return null;
      }
    };


    return Object.freeze({
      getBlockedByDay,
      mergeBlockedIntervalsForDay,
      setBlocked,
      renderBlocked,
      setBlockMode,
      isBlockMode: getBlockMode,
      canFitWithBlockedHours,
      isGridRenderableInterval,
      updateGridExtent,
      intervalsOverlap,
      countIntervalOverlaps,
      getOccupiedByDayFromSelected,
      sectionAvailabilityClasses,
      getRequiredBundleCourseIds,
      pickBestBundleSections,
    });
  }

  const api = Object.freeze({ createGridAvailability });
  if (root) root.SurriculumSchedulerGridAvailability = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
