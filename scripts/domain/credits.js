// credits.js
// Pure credit/number helpers used to size every course pool in the engine.
// A bug here mis-counts credits everywhere, so these are among the most
// load-bearing functions in the app — and the safest to migrate first because
// they touch nothing but their arguments (no DOM, no globals).
//
// Shipped as a real ES module (<script type="module"> in index.html) with a
// window bridge at the bottom, following cases/flagMessages.js: classic
// (non-module) scripts still read window.parseCreditValue etc. at call time,
// while new module code can `import` these directly. The bridge is removed once
// the last classic consumer is migrated.

export function extractNumericValue(string) {
  const matches = String(string ?? '').match(/\d+/); // Match one or more digits
  if (matches) {
    return parseInt(matches[0], 10); // Parse the matched value as an integer
  }
  return null; // No numeric value found
}

// Allow half-credits (e.g., 2.5) for custom/imported courses, and tolerate the
// comma decimal separator that occasionally appears in scraped catalogs.
// Absent / non-numeric values (''/'-'/null/undefined/…) collapse to 0, never
// NaN — every consumer adds the result to a running total.
export function parseCreditValue(v) {
  try {
    const raw = String(v ?? '').trim();
    if (!raw) return 0;
    const n = parseFloat(raw.replace(',', '.'));
    return isFinite(n) ? n : 0;
  } catch (_) {
    return 0;
  }
}

export function formatCreditValue(v) {
  const n = parseCreditValue(v);
  return n.toFixed(1);
}

// Bridge for classic scripts that still consume these as globals.
if (typeof window !== 'undefined') {
  window.extractNumericValue = extractNumericValue;
  window.parseCreditValue = parseCreditValue;
  window.formatCreditValue = formatCreditValue;
}
