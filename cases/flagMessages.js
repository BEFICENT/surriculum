// flagMessages.js
// This module defines the messages associated with graduation check flags.
// It relies on a global `requirements` object that must be defined by
// `requirements.js`. When loaded via a <script> tag, the `buildFlagMessages`
// function will be attached to the global window for other scripts to call.

export function buildFlagMessages(major) {
  // Retrieve the requirements object from the global scope when running in
  // the browser. This avoids reference errors when this module is parsed by
  // Node or other environments where "requirements" isn't a top-level
  // variable.
  const allReq = (typeof globalThis !== 'undefined' && globalThis.requirements)
    ? globalThis.requirements
    : {};
  let req = allReq[major];
  if (!req) {
    // When requirements are organized by term code, determine the correct
    // term using the global curriculum object.
    const curr = (typeof globalThis !== 'undefined' && globalThis.curriculum)
      ? globalThis.curriculum
      : {};
    let term = '';
    if (curr.major === major) term = curr.entryTerm;
    else if (curr.doubleMajor === major) term = curr.entryTermDM;
    if (term && allReq[term] && allReq[term][major]) {
      req = allReq[term][major];
    } else {
      // Fallback: search all term groups
      for (const t of Object.keys(allReq)) {
        if (allReq[t] && allReq[t][major]) { req = allReq[t][major]; break; }
      }
    }
  }
  req = req || {};

  return {
      1: () => `Your University SU credit is less than ${req.university}.`,
      2: () => `Your Required SU credit is less than ${req.required}.`,
      3: () => `Your Core Elective SU credit is less than ${req.core}.`,
      4: () => `You have not taken ${req.internshipCourse}.`,
      5: () => `Your Total SU credit is less than sufficient.`,
      6: () => `Your Area Elective SU credit is less than ${req.area}.`,
      7: () => `Your Free Elective SU credit is less than ${req.free}.`,
      8: () => `Your Basic Science SU credit is less than ${req.science}.`,
      9: () => `Your Engineering SU credit is less than ${req.engineering}.`,
      10: () => `Your ECTS is less than sufficient.`,
      38: () => `You don't have enough GPA!`,

      //Major-specific messages

      11: () => `You have not taken SPS303!`,
      12: () => `You have not taken a HUM2XX class!`,
      13: () => `You have not taken a HUM3XX class!`,
      14: () => `You need at least 5 faculty courses!`,
      15: () => `You need at least 3 FASS faculty courses!`,
      16: () => `You need at least 3 FENS faculty courses!`,
      17: () => `You need at least 3 SBS faculty courses!`,
      18: () => `Your faculty courses must span at least 3 different areas!`,
      19: () => `You need at least 2 MATH courses!`,
      20: () => `You need at least 1 FENS faculty course!`,
      21: () => `You need at least 1 FASS faculty course!`,
      22: () => `You need at least 1 SBS faculty course!`,
      23: () => `You need at least 9 credits from 400-level EE courses!`,
      24: () => `You need at least one course from CS300, CS401, CS412, ME303, PHYS302, PHYS303, or EE48XXX special topics!`,
      25: () => `You need to complete your Mathematics requirement (MATH201, MATH202, or MATH204)!`,
      26: () => `You need to complete your Physics requirement (PHYS201, PHYS202, or PHYS204)!`,
      27: () => `You need at least 3 FENS courses in your core electives!`,
      28: () => `You need at least 3 FASS courses in your core electives!`,
      29: () => `You need at least 3 SBS courses in your core electives!`,
      30: () => `You need at least 9 Core I elective credits, beware of mutually exclusive courses!`,
      31: () => `You need at least 12 Core II elective credits, beware of mutually exclusive courses!`,
      32: () => `You need at least 15 Required credits, beware of mutually exclusive courses!`,
      33: () => `You need at least 12 Core I elective credits!`,
      34: () => `You need at least 12 Core II elective credits!`,
      35: () => `Your Core courses must span at least 6 different areas!`,
      36: () => `Your Area courses must span at least 5 different areas!`,
      37: () => `You need at least 9 credits from FASS & FENS courses in your Free electives!`,

  };
}

// Attach to global `window` so other non-module scripts can call this
// function when ES module imports are unavailable.
if (typeof window !== 'undefined') {
  window.buildFlagMessages = buildFlagMessages;
}
