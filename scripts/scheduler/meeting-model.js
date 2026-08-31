// Scheduler meeting/date normalization model.
(function (root) {
  'use strict';

  function createMeetingModelTools(options) {
    const parseDaysToKeys = options && options.parseDaysToKeys;
    const parseTimeRangeToMinutes = options && options.parseTimeRangeToMinutes;
    if (typeof parseDaysToKeys !== 'function' || typeof parseTimeRangeToMinutes !== 'function') {
      throw new TypeError('Scheduler meeting model requires day and time parsers.');
    }
    const configuredGridEnd = Number(options && options.gridMaxEndMin);
    const gridMaxEndMin = Number.isFinite(configuredGridEnd) && configuredGridEnd > 0
      ? configuredGridEnd : 24 * 60;
    const DATE_DAY_MS = 24 * 60 * 60 * 1000;
    const DATE_MONTHS = {
      Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
      Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
    };
    const DAY_KEY_TO_UTC_DAY = { U: 0, M: 1, T: 2, W: 3, R: 4, F: 5, S: 6 };

    const parseMeetingDateRange = (value) => {
      try {
        const label = String(value || '').trim().replace(/\s+/g, ' ');
        const match = label.match(/^([A-Z][a-z]{2}) (\d{1,2}), (\d{4}) - ([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/);
        if (!match) return null;
        const startMonth = DATE_MONTHS[match[1]];
        const endMonth = DATE_MONTHS[match[4]];
        if (!Number.isInteger(startMonth) || !Number.isInteger(endMonth)) return null;
        const startYear = Number(match[3]);
        const startDate = Number(match[2]);
        const endYear = Number(match[6]);
        const endDate = Number(match[5]);
        const startMs = Date.UTC(startYear, startMonth, startDate);
        const endMs = Date.UTC(endYear, endMonth, endDate);
        const startCheck = new Date(startMs);
        const endCheck = new Date(endMs);
        if (startCheck.getUTCFullYear() !== startYear || startCheck.getUTCMonth() !== startMonth || startCheck.getUTCDate() !== startDate) return null;
        if (endCheck.getUTCFullYear() !== endYear || endCheck.getUTCMonth() !== endMonth || endCheck.getUTCDate() !== endDate) return null;
        const startDay = Math.floor(startMs / DATE_DAY_MS);
        const endDay = Math.floor(endMs / DATE_DAY_MS);
        if (endDay < startDay) return null;
        return { startDay, endDay, label };
      } catch (_) {
        return null;
      }
    };

    const dateWindowContainsDay = (windowRange, dayKey) => {
      try {
        if (!windowRange) return false;
        const wantedDay = DAY_KEY_TO_UTC_DAY[dayKey];
        if (!Number.isInteger(wantedDay)) return false;
        const firstWeekday = new Date(windowRange.startDay * DATE_DAY_MS).getUTCDay();
        const firstOccurrence = windowRange.startDay + ((wantedDay - firstWeekday + 7) % 7);
        return firstOccurrence <= windowRange.endDay;
      } catch (_) {
        return false;
      }
    };

    const mergeDateWindows = (windows) => {
      const sorted = (Array.isArray(windows) ? windows : [])
        .filter(w => w && Number.isInteger(w.startDay) && Number.isInteger(w.endDay) && w.endDay >= w.startDay)
        .map(w => ({ startDay: w.startDay, endDay: w.endDay }))
        .sort((a, b) => (a.startDay - b.startDay) || (a.endDay - b.endDay));
      const merged = [];
      for (let i = 0; i < sorted.length; i++) {
        const next = sorted[i];
        const last = merged[merged.length - 1];
        if (last && next.startDay <= last.endDay + 1) {
          if (next.endDay > last.endDay) last.endDay = next.endDay;
        } else {
          merged.push(next);
        }
      }
      return merged;
    };

    const dateWindowsOverlapOnDay = (dayKey, aWindows, bWindows) => {
      // A missing/invalid date range is treated conservatively as recurring for
      // the whole term so unknown data can never produce a false "available".
      if (!Array.isArray(aWindows) || !aWindows.length) return true;
      if (!Array.isArray(bWindows) || !bWindows.length) return true;
      for (let ai = 0; ai < aWindows.length; ai++) {
        for (let bi = 0; bi < bWindows.length; bi++) {
          const startDay = Math.max(aWindows[ai].startDay, bWindows[bi].startDay);
          const endDay = Math.min(aWindows[ai].endDay, bWindows[bi].endDay);
          if (endDay < startDay) continue;
          if (dateWindowContainsDay({ startDay, endDay }, dayKey)) return true;
        }
      }
      return false;
    };

    const sectionMeetingModelCache = new WeakMap();
    const getSectionMeetingModel = (sec) => {
      if (!sec || typeof sec !== 'object') return { intervals: [], incomplete: true };
      try {
        const cached = sectionMeetingModelCache.get(sec);
        if (cached) return cached;
      } catch (_) {}

      const bySlot = new Map();
      let incomplete = false;
      try {
        const meetings = Array.isArray(sec.meetings) ? sec.meetings : [];
        if (!meetings.length) incomplete = true;
        for (let i = 0; i < meetings.length; i++) {
          const m = meetings[i] || {};
          const days = parseDaysToKeys(m.days || m.Days || '');
          let start = m.start_min;
          let end = m.end_min;
          if (start == null || end == null) {
            const tr = parseTimeRangeToMinutes(m.time || m.Time || '');
            if (tr) {
              start = tr.start;
              end = tr.end;
            } else {
              // Do not let Number(null) turn a partially missing endpoint into
              // midnight and admit a plausible-looking but bogus interval.
              start = Number.NaN;
              end = Number.NaN;
            }
          }
          start = Number(start);
          end = Number(end);
          const rawDateRange = m.date_range || m.dateRange || '';
          const dateWindow = parseMeetingDateRange(rawDateRange);
          const validTime = Number.isFinite(start) && Number.isFinite(end)
            && start >= 0 && end > start && end <= gridMaxEndMin;
          if (!days.length || !validTime || !dateWindow) incomplete = true;
          if (!days.length || !validTime) continue;

          for (let di = 0; di < days.length; di++) {
            const dayKey = days[di];
            const windowMatchesDay = !!(dateWindow && dateWindowContainsDay(dateWindow, dayKey));
            if (dateWindow && !windowMatchesDay) incomplete = true;
            const key = `${dayKey}|${start}|${end}`;
            let slot = bySlot.get(key);
            if (!slot) {
              slot = {
                dayKey,
                start,
                end,
                dateWindows: [],
                dateLabels: new Set(),
                locations: new Set(),
                instructors: new Set(),
                unknownDates: false,
              };
              bySlot.set(key, slot);
            }
            if (windowMatchesDay) {
              slot.dateWindows.push(dateWindow);
              slot.dateLabels.add(dateWindow.label);
            } else {
              slot.unknownDates = true;
            }
            const where = String(m.where || m.Where || '').trim();
            const instructors = String(m.instructors || m.Instructors || '').trim();
            if (where) slot.locations.add(where);
            if (instructors) slot.instructors.add(instructors);
          }
        }
      } catch (_) {
        incomplete = true;
      }

      const intervals = Array.from(bySlot.values()).map(slot => ({
        dayKey: slot.dayKey,
        start: slot.start,
        end: slot.end,
        dateWindows: slot.unknownDates ? null : mergeDateWindows(slot.dateWindows),
        dateLabels: Array.from(slot.dateLabels),
        where: Array.from(slot.locations).join(' / '),
        instructors: Array.from(slot.instructors).join(' / '),
      }));
      const model = { intervals, incomplete };
      try { sectionMeetingModelCache.set(sec, model); } catch (_) {}
      return model;
    };

    const getSectionIntervals = (sec) => getSectionMeetingModel(sec).intervals;

    const sectionHasIncompleteMeetingData = (sec) => getSectionMeetingModel(sec).incomplete;


    return Object.freeze({
      parseMeetingDateRange,
      dateWindowContainsDay,
      mergeDateWindows,
      dateWindowsOverlapOnDay,
      getSectionMeetingModel,
      getSectionIntervals,
      sectionHasIncompleteMeetingData,
    });
  }

  const api = Object.freeze({ createMeetingModelTools });
  if (root) root.SurriculumSchedulerMeetingModel = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
