// version.js
// Single source of truth for the APPLICATION (code / UI) version.
//
// There used to be three version numbers that drifted independently: the
// `<title>` in index.html, the header text in index.html, and the service-worker
// cache key in sw.js. They are now derived from this one value:
//   - the header/title display it (reflected below, so the markup cannot drift);
//   - the service-worker cache key is `surriculum-<APP_VERSION>-<dataVersion>`
//     (see main.js registration + sw.js), so a release no longer needs a manual
//     cache bump.
// The DATA (scrape) version lives separately in data/manifest.json — app and
// data version independently.
//
// Bump APP_VERSION here on a code/UI release.
(function () {
  var APP_VERSION = '3.1';

  if (typeof window === 'undefined') return;
  window.APP_VERSION = APP_VERSION;

  // Reflect the canonical version into the UI so the displayed value can never
  // drift from it. No-ops safely if the elements aren't present.
  function applyVersionToUi() {
    try {
      var label = 'SUrriculum v' + APP_VERSION;
      document.title = label;
      var headerTitle = document.querySelector('.header-title');
      if (headerTitle) headerTitle.textContent = label;
    } catch (_) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyVersionToUi);
  } else {
    applyVersionToUi();
  }
})();
