// Scheduler live-session wiring and selected-section change snapshots.
(function (root) {
  'use strict';

  function createLiveSession(bindings) {
    const source = bindings && typeof bindings === 'object' ? bindings : {};
    const session = {};
    Object.keys(source).forEach((key) => {
      const binding = source[key] || {};
      if (typeof binding.get !== 'function' || typeof binding.set !== 'function') {
        throw new TypeError(`Scheduler session binding ${key} requires get and set accessors.`);
      }
      Object.defineProperty(session, key, { get: binding.get, set: binding.set });
    });
    return session;
  }

    const getActiveSchedule = (root) => {
      try {
        const s = root && root.schedules && typeof root.schedules === 'object' ? root.schedules : null;
        const items = s && s.items && typeof s.items === 'object' ? s.items : null;
        const activeId = s && s.activeId ? String(s.activeId) : '';
        const it = items && activeId && items[activeId] ? items[activeId] : null;
        if (it && typeof it === 'object') return it;
      } catch (_) {}
      return { id: 'default', name: 'Default schedule', selected: {}, blocked: [], ui: {} };
    };

  function createSectionChangeTools(options) {
    const config = options || {};
    const normalizeCourseId = config.normalizeCourseId;
    const parseTimeRangeToMinutes = config.parseTimeRangeToMinutes;
    const sectionMeetingPreview = config.sectionMeetingPreview;
    if (typeof normalizeCourseId !== 'function' || typeof parseTimeRangeToMinutes !== 'function'
        || typeof sectionMeetingPreview !== 'function') {
      throw new TypeError('Scheduler section change tools dependencies are incomplete.');
    }

    const sectionInstructorPreview = (sec) => {
      try {
        const set = new Set();
        const meetings = Array.isArray(sec && sec.meetings) ? sec.meetings : [];
        for (let i = 0; i < meetings.length; i++) {
          const mi = meetings[i] || {};
          const s = String(mi.instructors || mi.Instructors || mi.instructor || mi.Instructor || '').trim();
          if (s) set.add(s.replace(/\s+/g, ' '));
        }
        const arr = Array.from(set);
        return arr.slice(0, 2).join(' / ');
      } catch (_) {
        return '';
      }
    };

    const snapshotForSection = (sec) => {
      try {
        const meetings = (sec && Array.isArray(sec.meetings)) ? sec.meetings : [];
        const meetingBits = [];
        const instrSet = new Set();
        for (let i = 0; i < meetings.length; i++) {
          const m = meetings[i] || {};
          const days = String(m.days || m.Days || '').toUpperCase().replace(/\s+/g, '');
          let start = m.start_min;
          let end = m.end_min;
          if (start == null || end == null) {
            const tr = parseTimeRangeToMinutes(m.time || m.Time || '');
            if (tr) {
              start = tr.start;
              end = tr.end;
            }
          }
          const where = String(m.where || m.Where || '').trim();
          const dateRange = String(m.date_range || m.dateRange || '').trim().replace(/\s+/g, ' ');
          if (days && start != null && end != null) {
            meetingBits.push(`${days}|${start}|${end}|${dateRange || 'DATE-TBA'}|${where}`);
          }
          const instr = String(m.instructors || m.Instructors || m.instructor || m.Instructor || '').trim();
          if (instr) instrSet.add(instr.replace(/\s+/g, ' '));
        }
        meetingBits.sort();
        const meetingKey = meetingBits.length ? meetingBits.join('||') : 'TBA';
        const instrKey = Array.from(instrSet).sort().join('|');
        const meetingSummary = sectionMeetingPreview(sec, 10) || '';
        const instrSummary = sectionInstructorPreview(sec) || '';
        return { meetingKey, instrKey, meetingSummary, instrSummary };
      } catch (_) {
        return { meetingKey: 'TBA', instrKey: '', meetingSummary: '', instrSummary: '' };
      }
    };

    const computeSelectedSectionChangeReport = (idx, root) => {
      const changes = [];
      const seen = {};
      try {
        if (!idx || !root) return { changes, seen };
        const prevSeen = (root.lastSeenScheduleSnapshots && typeof root.lastSeenScheduleSnapshots === 'object')
          ? root.lastSeenScheduleSnapshots
          : {};
        const schedules = root.schedules && typeof root.schedules === 'object' ? root.schedules : null;
        const order = Array.isArray(schedules && schedules.order) ? schedules.order.map(String) : [];
        const items = schedules && schedules.items && typeof schedules.items === 'object' ? schedules.items : {};

        for (let si = 0; si < order.length; si++) {
          const sid = order[si];
          const sch = items[sid] || {};
          const schName = String(sch.name || (sid === 'default' ? 'Default schedule' : 'Schedule'));
          const selectedMap = (sch.selected && typeof sch.selected === 'object') ? sch.selected : {};
          const prevForSchedule = (prevSeen && prevSeen[sid] && typeof prevSeen[sid] === 'object') ? prevSeen[sid] : {};
          const nextForSchedule = {};

          for (const courseIdRaw of Object.keys(selectedMap)) {
            const courseId = normalizeCourseId(courseIdRaw);
            if (!courseId) continue;
            const pick = selectedMap[courseIdRaw] || selectedMap[courseId] || {};
            const crn = String(pick && pick.crn ? pick.crn : '').trim();
            if (!crn) continue;
            const entry = idx.get(courseId);
            if (!entry || !Array.isArray(entry.sections)) continue;
            const sec = entry.sections.find(s => String(s && s.crn ? s.crn : '') === crn) || null;
            if (!sec) continue;

            const snap = snapshotForSection(sec);
            nextForSchedule[courseId] = Object.assign({ crn }, snap);

            const prev = prevForSchedule && prevForSchedule[courseId] ? prevForSchedule[courseId] : null;
            if (!prev) continue; // first time seeing this selection: don't notify
            if (String(prev.crn || '') !== crn) continue; // user changed CRN: don't notify as "update"

            const hoursChanged = String(prev.meetingKey || '') !== String(snap.meetingKey || '');
            const instrChanged = String(prev.instrKey || '') !== String(snap.instrKey || '');
            if (!hoursChanged && !instrChanged) continue;

            changes.push({
              scheduleId: sid,
              scheduleName: schName,
              courseId,
              crn,
              hoursChanged,
              instrChanged,
              prev: {
                meetingSummary: String(prev.meetingSummary || ''),
                instrSummary: String(prev.instrSummary || ''),
              },
              cur: {
                meetingSummary: String(snap.meetingSummary || ''),
                instrSummary: String(snap.instrSummary || ''),
              },
            });
          }

          if (Object.keys(nextForSchedule).length) {
            seen[sid] = nextForSchedule;
          }
        }
      } catch (_) {}
      return { changes, seen };
    };

    return Object.freeze({
      sectionInstructorPreview,
      snapshotForSection,
      computeSelectedSectionChangeReport,
    });
  }

  const api = Object.freeze({ createLiveSession, getActiveSchedule, createSectionChangeTools });
  if (root) root.SurriculumSchedulerSession = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
