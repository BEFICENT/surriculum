// Shared (not per-plan) UI preferences.
//
// GitHub Pages can host several applications on one origin, so generic keys
// such as `theme` must not be written directly to origin-wide localStorage.
// Keep these settings shared between SUrriculum plans/tabs while giving them an
// app-owned namespace. Existing unscoped values are copied once on read. The
// ambiguous generic key is deliberately retained because another Pages app on
// the same origin may own it.
(function () {
  const PREFIX = 'surriculum.preference.';
  const KNOWN_KEYS = Object.freeze([
    'theme',
    'showCourseDetails',
    'hideTakenCourses',
    // Legacy source for the pre-3.1 current-term-only offering toggle. Keep it
    // readable so it can be migrated into the target-semester picker default.
    'offeredThisTermOnly',
    'sortBasedOnScore',
    'mobileNoticeDismissed',
    'schedulerHoverPreview',
    'schedulerHighlightAvailability',
    'schedulerShowBlockedCourses',
    'schedulerMinMajorType',
    'schedulerMinDmType',
    'schedulerMinMinorType',
    'schedulerMinSuCredits',
    'schedulerMinEcts',
    'schedulerMinBasicScience',
    'schedulerMinEngineering',
    'schedulerCheckPrereqs',
    'schedulerShowUnmetPrereqs',
    'plannerFilterProgram',
    'plannerFilterCategory',
    'plannerFilterLevel',
    'plannerFilterOfferedOnly',
    'plannerFilterMinSu',
    'plannerFilterMinEcts',
    'plannerFilterMinBasicScience',
    'plannerFilterMinEngineering',
    'plannerFilterCheckPrerequisites',
    'plannerFilterShowUnmetPrerequisites',
    'plannerFilterMigrationVersion',
    'onboardingCohort',
    'onboardingHelpSeen',
    'onboardingLastSeenRelease',
  ]);
  const KNOWN_KEY_SET = new Set(KNOWN_KEYS);

  function normalizeKey(key) {
    const normalized = String(key == null ? '' : key).trim();
    return KNOWN_KEY_SET.has(normalized) ? normalized : '';
  }

  function storageKey(key) {
    const normalized = normalizeKey(key);
    return normalized ? PREFIX + normalized : '';
  }

  function getItem(key) {
    const normalized = normalizeKey(key);
    if (!normalized) return null;

    try {
      const scoped = localStorage.getItem(PREFIX + normalized);
      if (scoped !== null) return scoped;

      const legacy = localStorage.getItem(normalized);
      if (legacy === null) return null;

      // Copy, but never delete or overwrite, the ambiguous generic key.
      localStorage.setItem(PREFIX + normalized, legacy);
      return legacy;
    } catch (_) {
      // A storage denial/quota failure must not create a new unscoped write.
      // A readable legacy value may still be returned for this page load.
      try { return localStorage.getItem(normalized); } catch (_) { return null; }
    }
  }

  function setItem(key, value) {
    const normalized = normalizeKey(key);
    if (!normalized) return false;
    try {
      localStorage.setItem(PREFIX + normalized, String(value));
      return true;
    } catch (_) {
      return false;
    }
  }

  function removeItem(key) {
    const normalized = normalizeKey(key);
    if (!normalized) return false;
    try {
      localStorage.removeItem(PREFIX + normalized);
      return true;
    } catch (_) {
      return false;
    }
  }

  // Copy known values during boot so the app can stop reading generic keys
  // after a successful namespaced write. Failures are retried on next load.
  for (const key of KNOWN_KEYS) getItem(key);

  // Planner and Scheduler filters used to share storage keys even though they
  // operate in different contexts. Seed the new planner defaults once from
  // the previous values, then let each surface evolve independently.
  const PLANNER_PREFERENCE_MIGRATIONS = Object.freeze([
    ['plannerFilterOfferedOnly', 'offeredThisTermOnly', 'true'],
    ['plannerFilterMinSu', 'schedulerMinSuCredits', ''],
    ['plannerFilterMinEcts', 'schedulerMinEcts', ''],
    ['plannerFilterMinBasicScience', 'schedulerMinBasicScience', ''],
    ['plannerFilterMinEngineering', 'schedulerMinEngineering', ''],
    ['plannerFilterCheckPrerequisites', 'schedulerCheckPrereqs', 'true'],
    ['plannerFilterShowUnmetPrerequisites', 'schedulerShowUnmetPrereqs', 'true'],
  ]);
  if (getItem('plannerFilterMigrationVersion') !== '1') {
    let migrationComplete = true;
    for (const [plannerKey, legacyKey, fallback] of PLANNER_PREFERENCE_MIGRATIONS) {
      if (getItem(plannerKey) !== null) continue;
      const legacyValue = getItem(legacyKey);
      if (!setItem(plannerKey, legacyValue === null ? fallback : legacyValue)) {
        migrationComplete = false;
      }
    }
    if (migrationComplete) setItem('plannerFilterMigrationVersion', '1');
  }

  window.preferenceStorage = Object.freeze({
    prefix: PREFIX,
    knownKeys: KNOWN_KEYS,
    storageKey,
    getItem,
    setItem,
    removeItem,
  });
})();
