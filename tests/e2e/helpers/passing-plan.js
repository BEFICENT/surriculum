'use strict';

const { seedPlan } = require('./plan');

// A COMPLETE CS degree plan for the frozen entry term 202401 (Fall 2024-2025):
// with all-A grades it satisfies every graduation requirement, so canGraduate()
// returns 0. It was generated from courses/202401/CS.jsonl to clear each
// threshold with buffer (university 41, required 29, core 31, area 9, free 15,
// science 60, engineering 90, ects 240, total 125, internship CS395, SPS303,
// HUM, faculty/fens/math counts). The generous free/science buffer is
// deliberate: it keeps the plan robust to minor data drift and lets tests drop
// a single course to isolate one requirement. NB MATH212 is intentionally
// excluded — it's the mutually-exclusive alternative of MATH201, and including
// both would waste MATH201's required slot (dropping required below 29).
const CS_PASSING_PLAN = ['ACC201','ACC301','ACC401','ACC402','ACC403','ACC404','ACC405','ACC406','ACC450','ACC451','AL102','ANTH214','ANTH255','ANTH321','ANTH326','ANTH340','ANTH468','BIO301','BIO310','CIP101N','CS201','CS204','CS300','CS301','CS302','CS303','CS305','CS306','CS307','CS308','CS310','CS395','CS400','CS401','CS403','CS404','CS414','CS415','CS435','CS438','ENS491','ENS492','HIST191','HIST192','HUM201','HUM202','IF100','MATH101','MATH102','MATH201','MATH203','MATH204','NS101','NS102','PROJ201','SPS101','SPS102','SPS303','TLL101','TLL102'];

// Seed the passing plan, optionally dropping courses and/or forcing a grade,
// to isolate individual graduation checks.
async function seedGradPlan(page, { drop = [], grade = 'A' } = {}) {
  const dropSet = new Set(drop);
  const courses = CS_PASSING_PLAN.filter((c) => !dropSet.has(c));
  await seedPlan(page, {
    major: 'CS',
    entryTerm: 'Fall 2024-2025',
    curriculum: [courses],
    grades: [courses.map(() => grade)],
    dates: ['Fall 2024-2025'],
  });
}

module.exports = { CS_PASSING_PLAN, seedGradPlan };
