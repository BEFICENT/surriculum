// Scheduler planner/program metadata and credit presentation helpers.
(function (root) {
  'use strict';

  function createProgramDetailTools(options) {
    const config = options || {};
    const window = config.window || root;
    const normalizeCourseId = config.normalizeCourseId;
    const getCoursePageInfoMap = config.getCoursePageInfoMap;
    const getCourseData = config.getCourseData;
    const getInfoFn = config.getInfo;
    if (!window || typeof normalizeCourseId !== 'function' || typeof getCoursePageInfoMap !== 'function'
        || typeof getCourseData !== 'function') {
      throw new TypeError('Scheduler program detail dependencies are incomplete.');
    }

    const normalizePlannerCode = (code) => {
      const n = normalizeCourseId(code);
      if (n === 'CS210' || n === 'DSA210') return 'DSA210';
      return n;
    };

    const getPlannerInfo = (code) => {
      try {
        const lookup = typeof getInfoFn === 'function' ? getInfoFn : window.getInfo;
        if (typeof lookup === 'function') return lookup(code, getCourseData());
      } catch (_) {}
      return null;
    };

    const fmtCredit = (v) => {
      try {
        if (typeof window !== 'undefined' && typeof window.formatCreditValue === 'function') return window.formatCreditValue(v);
      } catch (_) {}
      const n = parseFloat(v || '0') || 0;
      return n.toFixed(1);
    };

    const buildTypeMaps = () => {
      const maps = { dm: new Map(), minors: [] };
      try {
        const cur = (typeof window !== 'undefined') ? window.curriculum : null;
        if (cur && cur.doubleMajor && Array.isArray(cur.doubleMajorCourseData)) {
          for (let i = 0; i < cur.doubleMajorCourseData.length; i++) {
            const r = cur.doubleMajorCourseData[i];
            if (!r) continue;
            const code = normalizeCourseId((r.Major || '') + (r.Code || ''));
            if (!code) continue;
            if (!maps.dm.has(code)) maps.dm.set(code, String(r.EL_Type || '').toLowerCase());
          }
        }
        if (cur && Array.isArray(cur.minors) && cur.minors.length && cur.minorCourseDataByCode) {
          cur.minors.forEach(minorCode => {
            const list = cur.minorCourseDataByCode[minorCode];
            if (!Array.isArray(list)) return;
            const m = new Map();
            for (let i = 0; i < list.length; i++) {
              const r = list[i];
              if (!r) continue;
              const code = normalizeCourseId((r.Major || '') + (r.Code || ''));
              if (!code) continue;
              if (!m.has(code)) m.set(code, String(r.EL_Type || '').toLowerCase());
            }
            maps.minors.push({ code: minorCode, map: m });
          });
        }
      } catch (_) {}
      return maps;
    };

    let typeMapsCache = null;
    let typeMapsCacheKey = '';
    const getTypeMaps = () => {
      try {
        const cur = (typeof window !== 'undefined') ? window.curriculum : null;
        const dm = cur ? String(cur.doubleMajor || '') : '';
        const dmLen = (cur && Array.isArray(cur.doubleMajorCourseData)) ? cur.doubleMajorCourseData.length : 0;
        const minors = (cur && Array.isArray(cur.minors)) ? cur.minors.slice().sort() : [];
        const minorLens = [];
        try {
          if (cur && cur.minorCourseDataByCode) {
            minors.forEach(m => {
              const list = cur.minorCourseDataByCode[m];
              minorLens.push(Array.isArray(list) ? list.length : 0);
            });
          }
        } catch (_) {}
        const key = [dm, dmLen, minors.join(','), minorLens.join(':')].join('|');
        if (typeMapsCache && typeMapsCacheKey === key) return typeMapsCache;
        typeMapsCache = buildTypeMaps();
        typeMapsCacheKey = key;
        return typeMapsCache;
      } catch (_) {
        return buildTypeMaps();
      }
    };

    const getCourseDetails = (courseId) => {
      const cid = normalizePlannerCode(courseId);
      const out = { title: '', su: 0, ects: 0, bs: 0, eng: 0, mainType: '', dmType: '', minorTypes: [] };
      try {
        const info = getPlannerInfo(cid);
        if (info) {
          out.title = String(info.Course_Name || info.course_name || info.title || '').trim();
          out.su = (typeof window !== 'undefined' && typeof window.parseCreditValue === 'function')
            ? window.parseCreditValue(info.SU_credit || '0')
            : (parseFloat(info.SU_credit || '0') || 0);
          out.ects = parseFloat(info.ECTS || '0') || 0;
          out.bs = parseFloat(info.Basic_Science || '0') || 0;
          out.eng = parseFloat(info.Engineering || '0') || 0;
          out.mainType = String(info.EL_Type || '').toLowerCase();
        }
      } catch (_) {}
      try {
        const coursePageInfoMap = getCoursePageInfoMap();
        if ((!out.title || !out.su || !out.ects) && coursePageInfoMap && typeof coursePageInfoMap.get === 'function') {
          const pi = coursePageInfoMap.get(cid);
          if (pi) {
            if (!out.title) out.title = String(pi.title || pi.header_text || '').trim();
            if (!out.su && pi.su_credits != null) out.su = parseFloat(pi.su_credits) || 0;
            if (!out.ects && pi.ects != null) out.ects = parseFloat(pi.ects) || 0;
            if (!out.bs && pi.basic_science != null) out.bs = parseFloat(pi.basic_science) || 0;
            if (!out.eng && pi.engineering != null) out.eng = parseFloat(pi.engineering) || 0;
          }
        }
      } catch (_) {}
      try {
        const maps = getTypeMaps();
        if (maps && maps.dm && maps.dm.has(cid)) out.dmType = maps.dm.get(cid) || '';
      } catch (_) {}
      try {
        const maps = getTypeMaps();
        const arr = (maps && maps.minors) ? maps.minors : [];
        for (let i = 0; i < arr.length; i++) {
          const m = arr[i];
          if (!m || !m.map) continue;
          if (m.map.has(cid)) out.minorTypes.push({ code: m.code, type: m.map.get(cid) || '' });
        }
      } catch (_) {}
      // Extra fallback: if a double major is selected but the dm map misses this
      // course for any reason, try direct lookup in the DM catalog list.
      try {
        if (!out.dmType) {
          const cur = (typeof window !== 'undefined') ? window.curriculum : null;
          if (cur && cur.doubleMajor && Array.isArray(cur.doubleMajorCourseData)) {
            for (let i = 0; i < cur.doubleMajorCourseData.length; i++) {
              const r = cur.doubleMajorCourseData[i];
              if (!r) continue;
              const code = normalizeCourseId((r.Major || '') + (r.Code || ''));
              if (code === cid) {
                out.dmType = String(r.EL_Type || '').toLowerCase();
                break;
              }
            }
          }
        }
      } catch (_) {}
      return out;
    };

    return Object.freeze({
      normalizePlannerCode,
      getPlannerInfo,
      formatCredit: fmtCredit,
      getCourseDetails,
    });
  }

  const api = Object.freeze({ createProgramDetailTools });
  if (root) root.SurriculumSchedulerProgramDetails = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
