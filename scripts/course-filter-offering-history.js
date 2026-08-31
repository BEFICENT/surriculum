// Course offering-history inference and contextual advisory policy.
(function (root) {
  'use strict';

  function createOfferingHistoryPolicy(options) {
    const config = options || {};
    const normalizeCourseCode = config.normalizeCourseCode;
    const rawRecordCourseCode = config.rawRecordCourseCode;
    const courseInfoFor = config.courseInfoFor;
    if (typeof normalizeCourseCode !== 'function' || typeof rawRecordCourseCode !== 'function'
        || typeof courseInfoFor !== 'function') {
      throw new TypeError('Course offering-history policy requires course-code and metadata helpers.');
    }

  const OFFERING_TERM_SUFFIXES = Object.freeze({ fall: '01', spring: '02', summer: '03' });
  const OFFERING_SEASONS_BY_SUFFIX = Object.freeze({ '01': 'fall', '02': 'spring', '03': 'summer' });

  function normalizeOfferingTermCode(value) {
    let raw = value;
    if (value && typeof value === 'object') {
      raw = value.termCode != null ? value.termCode
        : (value.term_code != null ? value.term_code
          : (value.term != null ? value.term : value.code));
    }
    const text = String(raw == null ? '' : raw).trim();
    if (/^\d{4}(01|02|03)$/.test(text)) return text;
    const match = text.match(/^(Fall|Spring|Summer)\s+(\d{4})-(\d{4})$/i);
    if (!match || Number(match[3]) !== Number(match[2]) + 1) return '';
    const suffix = OFFERING_TERM_SUFFIXES[match[1].toLowerCase()];
    return suffix ? match[2] + suffix : '';
  }

  function offeringSourceIsValid(source, assumedValid) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return !!assumedValid;
    const explicitlyFalse = (value) => value === false
      || String(value == null ? '' : value).trim().toLowerCase() === 'false';
    if (explicitlyFalse(source.scrape_ok) || explicitlyFalse(source.scrapeOk)
      || source.sourceValid === false || source.valid === false
      || source.status === 'unknown') return false;
    return true;
  }

  // Normalize either a course-page record, a direct history array, or a list
  // of alias records without mutating the caller's data. Failed sources do not
  // contribute terms to a negative historical inference: a schedule-restored
  // positive on such a record is useful elsewhere, but it does not make that
  // record's positive-only course-page history complete.
  function collectOfferingHistoryEvidence(input) {
    const termCodes = new Set();
    let sourceCount = 0;
    let validSourceCount = 0;
    let invalidSourceCount = 0;

    const addHistory = (history, valid) => {
      sourceCount++;
      if (valid) validSourceCount++;
      else invalidSourceCount++;
      if (!valid || !history || typeof history[Symbol.iterator] !== 'function') return;
      Array.from(history).forEach((entry) => {
        const code = normalizeOfferingTermCode(entry);
        if (code) termCodes.add(code);
      });
    };

    const visit = (source, directHistory) => {
      if (source == null) return;
      const isSet = Object.prototype.toString.call(source) === '[object Set]';
      if (Array.isArray(source) || isSet) {
        const values = Array.from(source);
        const containsSources = values.some((entry) => entry && typeof entry === 'object'
          && (Array.isArray(entry.last_offered_terms)
            || Array.isArray(entry.lastOfferedTerms)
            || Array.isArray(entry.history)
            || Array.isArray(entry.historyTerms)));
        if (containsSources && !directHistory) {
          values.forEach((entry) => visit(entry, false));
        } else {
          addHistory(values, true);
        }
        return;
      }
      if (typeof source !== 'object') {
        addHistory([source], true);
        return;
      }

      const history = Array.isArray(source.last_offered_terms) ? source.last_offered_terms
        : (Array.isArray(source.lastOfferedTerms) ? source.lastOfferedTerms
          : (Array.isArray(source.historyTerms) ? source.historyTerms
            : (Array.isArray(source.history) ? source.history : null)));
      if (history) {
        addHistory(history, offeringSourceIsValid(source, true));
        return;
      }
      if (source.term != null || source.termCode != null || source.term_code != null) {
        addHistory([source], offeringSourceIsValid(source, true));
      }
    };

    visit(input, false);
    return {
      historyTerms: Array.from(termCodes).sort(),
      sourceCount,
      validSourceCount,
      invalidSourceCount,
      sourceValid: validSourceCount > 0,
    };
  }

  function normalizedOfferingReference(value) {
    return normalizeOfferingTermCode(value);
  }

  function normalizedOfferingLookback(value) {
    const parsed = Number.parseInt(String(value == null ? '' : value), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return 6;
    return Math.min(50, parsed);
  }

  /**
   * Derive conservative offering-history signals from positive-only evidence.
   *
   * Seasonal signals require at least three distinct academic years of valid
   * evidence outside the target season and a recent positive observation.
   * Fall and Spring use the opposite regular semester; Summer uses the union
   * of Fall and Spring. Cadence considers only completed academic years, so
   * the current and all future years can add positive evidence but can never
   * be counted as missed.
   */
  function deriveOfferingPattern(infoOrHistory, options) {
    const opts = options && typeof options === 'object' ? options : {};
    const referenceTermCode = normalizedOfferingReference(opts.referenceTermCode);
    const lookbackYears = normalizedOfferingLookback(opts.lookbackYears);
    const evidence = collectOfferingHistoryEvidence(infoOrHistory);
    const historyTerms = evidence.historyTerms.slice();
    const referenceYear = referenceTermCode
      ? Number.parseInt(referenceTermCode.slice(0, 4), 10) : null;
    const completedEndYear = Number.isFinite(referenceYear) ? referenceYear - 1 : null;
    const completedStartYear = Number.isFinite(completedEndYear)
      ? completedEndYear - lookbackYears + 1 : null;

    const yearsBySeason = { fall: new Set(), spring: new Set(), summer: new Set() };
    const allAcademicYears = new Set();
    historyTerms.forEach((termCode) => {
      const year = Number.parseInt(termCode.slice(0, 4), 10);
      const season = OFFERING_SEASONS_BY_SUFFIX[termCode.slice(4)];
      if (!Number.isFinite(year) || !season) return;
      yearsBySeason[season].add(year);
      allAcademicYears.add(year);
    });

    const sortedYears = (values) => Array.from(values).sort((left, right) => left - right);
    const fallYears = sortedYears(yearsBySeason.fall);
    const springYears = sortedYears(yearsBySeason.spring);
    const summerYears = sortedYears(yearsBySeason.summer);
    const regularYears = sortedYears(new Set([...fallYears, ...springYears]));
    const observedYears = sortedYears(allAcademicYears);
    const firstObservedAcademicYear = observedYears.length ? observedYears[0] : null;
    const latestTermCode = historyTerms.length ? historyTerms[historyTerms.length - 1] : '';

    const hasRecentYear = (year) => Number.isFinite(completedStartYear) && year >= completedStartYear;
    const recentFallEvidence = fallYears.some(hasRecentYear);
    const recentSpringEvidence = springYears.some(hasRecentYear);
    const recentRegularEvidence = regularYears.some(hasRecentYear);
    const recentPositiveEvidence = observedYears.some(hasRecentYear);

    const sourceKnown = evidence.sourceValid && historyTerms.length > 0;
    const noFall = !!(
      sourceKnown
      && referenceTermCode
      && fallYears.length === 0
      && springYears.length >= 3
      && recentSpringEvidence
    );
    const noSpring = !!(
      sourceKnown
      && referenceTermCode
      && springYears.length === 0
      && fallYears.length >= 3
      && recentFallEvidence
    );
    const noSummer = !!(
      sourceKnown
      && referenceTermCode
      && summerYears.length === 0
      && regularYears.length >= 3
      && recentRegularEvidence
    );
    const noRecent = !!(
      sourceKnown
      && referenceTermCode
      && observedYears.length >= 3
      && !recentPositiveEvidence
    );

    const eligibleYears = [];
    if (sourceKnown && Number.isFinite(completedStartYear)
      && Number.isFinite(completedEndYear) && firstObservedAcademicYear !== null) {
      const eligibleStart = Math.max(completedStartYear, firstObservedAcademicYear);
      for (let year = eligibleStart; year <= completedEndYear; year++) eligibleYears.push(year);
    }
    const offeredYears = eligibleYears.filter((year) => allAcademicYears.has(year));
    const missedYears = eligibleYears.filter((year) => !allAcademicYears.has(year));
    let cadenceStatus = 'unknown';
    if (sourceKnown && referenceTermCode) {
      cadenceStatus = eligibleYears.length >= 4 && offeredYears.length >= 2
        ? (missedYears.length >= 2 ? 'irregular' : 'regular')
        : 'limited';
    }

    let status = 'unknown';
    let reason = !evidence.sourceValid ? 'invalid-source' : 'empty-history';
    if (sourceKnown) {
      status = referenceTermCode && observedYears.length >= 3 ? 'known' : 'limited';
      reason = !referenceTermCode ? 'invalid-reference-term'
        : (status === 'limited' ? 'sparse-history' : 'known');
    }

    const season = {
      fall: {
        count: fallYears.length,
        academicYears: fallYears,
        noOfferingsFound: noFall,
      },
      spring: {
        count: springYears.length,
        academicYears: springYears,
        noOfferingsFound: noSpring,
      },
      summer: {
        count: summerYears.length,
        academicYears: summerYears,
        noOfferingsFound: noSummer,
      },
    };
    const cadence = {
      status: cadenceStatus,
      offeredYears,
      missedYears,
      eligibleYears,
      offeredYearCount: offeredYears.length,
      missedYearCount: missedYears.length,
      eligibleYearCount: eligibleYears.length,
    };

    return {
      status,
      reason,
      sourceValid: evidence.sourceValid,
      sourceCount: evidence.sourceCount,
      validSourceCount: evidence.validSourceCount,
      invalidSourceCount: evidence.invalidSourceCount,
      referenceTermCode,
      lookbackYears,
      completedAcademicYearWindow: Number.isFinite(completedStartYear)
        ? { start: completedStartYear, end: completedEndYear } : null,
      historyTerms,
      firstObservedAcademicYear,
      latestTermCode,
      season,
      cadence,
      noFall,
      noSpring,
      noSummer,
      noRecent,
      irregular: cadenceStatus === 'irregular',
      flags: {
        noFall,
        noSpring,
        noSummer,
        noRecent,
        irregular: cadenceStatus === 'irregular',
      },
    };
  }

  function offeringHistoryForCandidate(candidate, infoByCode, options) {
    const rawCode = rawRecordCourseCode(
      candidate && typeof candidate === 'object' ? candidate : { code: candidate },
    );
    const canonicalCode = normalizeCourseCode(rawCode);
    const lookupCodes = canonicalCode === 'DSA210'
      ? ['DSA210', 'CS210'] : [canonicalCode || rawCode];
    const records = [];
    const seenRecords = new Set();
    for (let i = 0; i < lookupCodes.length; i++) {
      const record = courseInfoFor(infoByCode, lookupCodes[i]);
      if (!record || seenRecords.has(record)) continue;
      seenRecords.add(record);
      records.push(record);
    }
    return deriveOfferingPattern(records, options);
  }

  function exactOfferingStateName(exactOfferingState) {
    if (typeof exactOfferingState === 'string') return exactOfferingState.toLowerCase();
    if (!exactOfferingState || typeof exactOfferingState !== 'object') return 'unknown';
    if (exactOfferingState.state) return String(exactOfferingState.state).toLowerCase();
    if (exactOfferingState.offered === true) return 'offered';
    if (exactOfferingState.offered === false && exactOfferingState.known === true) return 'not-offered';
    return 'unknown';
  }

  function contextualOfferingAdvisories(pattern, targetTermCode, exactOfferingState) {
    if (!pattern || typeof pattern !== 'object' || pattern.status === 'unknown') return [];
    const target = normalizeOfferingTermCode(targetTermCode);
    const exactState = exactOfferingStateName(exactOfferingState);
    const exactOffered = exactState === 'offered';
    const flags = pattern.flags && typeof pattern.flags === 'object' ? pattern.flags : {};
    const noFall = pattern.noFall === true || flags.noFall === true
      || !!(pattern.season && pattern.season.fall && pattern.season.fall.noOfferingsFound);
    const noSpring = pattern.noSpring === true || flags.noSpring === true
      || !!(pattern.season && pattern.season.spring && pattern.season.spring.noOfferingsFound);
    const noSummer = pattern.noSummer === true || flags.noSummer === true
      || !!(pattern.season && pattern.season.summer && pattern.season.summer.noOfferingsFound);
    const noRecent = pattern.noRecent === true || flags.noRecent === true;
    const irregular = pattern.irregular === true || flags.irregular === true
      || !!(pattern.cadence && pattern.cadence.status === 'irregular');
    const advisories = [];

    // The selected semester's published schedule is stronger and more useful
    // than any historical pattern. If the course is offered there, no history
    // advisory should distract from that actionable result.
    if (exactOffered) return advisories;

    if (target.endsWith('01') && noFall) {
      advisories.push({ key: 'no-fall', label: 'No Fall offerings found', kind: 'season' });
    } else if (target.endsWith('02') && noSpring) {
      advisories.push({ key: 'no-spring', label: 'No Spring offerings found', kind: 'season' });
    } else if (target.endsWith('03') && noSummer) {
      advisories.push({ key: 'no-summer', label: 'No Summer offerings found', kind: 'season' });
    }
    if (noRecent) {
      advisories.push({ key: 'no-recent', label: 'No recent offering history', kind: 'recency' });
    }
    if (irregular) {
      advisories.push({ key: 'irregular', label: 'Not offered every year', kind: 'cadence' });
    }
    return advisories;
  }


    return Object.freeze({
      deriveOfferingPattern,
      offeringHistoryForCandidate,
      contextualOfferingAdvisories,
    });
  }

  const api = Object.freeze({ createOfferingHistoryPolicy });
  if (root) root.SurriculumCourseOfferingHistory = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
