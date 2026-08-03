'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { loadScriptGlobals } = require('./helpers/load-script.js');

const h = loadScriptGlobals('scripts/helper_functions.js');
let catalog;

test.before(async () => {
  catalog = await import('../../scripts/data/catalog.js');
});

function installIndex(entries) {
  const index = new Map(entries);
  h.coursePageInfoByCode = index;
  // Keep the batch API on its already-loaded path: parsing/fetch behavior is
  // integration-tested elsewhere; these tests cover the contained resolver.
  h.__coursePageInfoPromise = Promise.resolve(index);
  return index;
}

test('global definition has catalog shape, is internal, and keeps scrape metadata over overrides', () => {
  installIndex([['ACC201', {
    course_id: 'ACC201',
    title: 'Introduction to Accounting',
    su_credits: 3,
    ects: 6,
    engineering: null,
    basic_science: 0,
    faculty: 'fens',
    last_offered_terms: [],
  }]]);

  const result = h.resolveGlobalCourseDefinition(' acc 201 ', {
    title: 'Transcript title',
    suCredits: 4,
    ects: 8,
  });

  assert.equal(result.Major, 'ACC');
  assert.equal(result.Code, '201');
  assert.equal(result.Course_Name, 'Introduction to Accounting');
  assert.equal(result.SU_credit, '3');
  assert.equal(result.ECTS, '6');
  assert.equal(result.EL_Type, 'unknown');
  assert.equal(result.Faculty, 'FENS');
  assert.equal(result.Faculty_Course, 'No');
  assert.equal(result.__globalCourseDefinition, true);
});

test('transcript metadata fills only missing title, SU credit, and ECTS', () => {
  installIndex([
    ['SOC301', {
      course_id: 'SOC301',
      title: null,
      su_credits: '   ',
      ects: null,
      engineering: null,
      basic_science: null,
      last_offered_terms: [],
    }],
    ['CIP101N', {
      course_id: 'CIP101N',
      title: 'Civic Involvement Projects I-N',
      su_credits: 0,
      ects: 1,
      last_offered_terms: [],
    }],
  ]);

  const filled = h.resolveGlobalCourseDefinition('SOC 301', {
    Course_Name: 'Political Sociology',
    SU_credit: '3',
    ECTS: '5',
  });
  assert.equal(filled.Course_Name, 'Political Sociology');
  assert.equal(filled.SU_credit, '3');
  assert.equal(filled.ECTS, '5');

  const zeroCredit = h.resolveGlobalCourseDefinition('CIP101N', {
    title: 'Wrong title',
    suCredits: 3,
    ects: 9,
  });
  assert.equal(zeroCredit.Course_Name, 'Civic Involvement Projects I-N');
  assert.equal(zeroCredit.SU_credit, '0', 'a real zero is not missing');
  assert.equal(zeroCredit.ECTS, '1');
});

test('batch append requests only named codes, de-duplicates them, and reports misses', async () => {
  installIndex([
    ['ACC201', { course_id: 'ACC201', title: 'Global ACC', su_credits: 3, ects: 6 }],
    ['SOC301', { course_id: 'SOC301', title: null, su_credits: null, ects: null }],
    ['UNREQUESTED999', { course_id: 'UNREQUESTED999', title: 'Hidden', su_credits: 3, ects: 6 }],
  ]);
  const realAcc = {
    Major: 'ACC', Code: '201', Course_Name: 'Selected catalog ACC',
    SU_credit: '3', ECTS: '6', EL_Type: 'free',
  };
  const courseData = [realAcc];

  const result = await h.appendGlobalCourseDefinitions(
    courseData,
    [' acc 201 ', 'SOC301', 'soc 301', 'MISSING404'],
    new Map([['soc 301', { title: 'Political Sociology', suCredits: 3, ects: 5 }]]),
  );

  assert.equal(result.added.length, 1);
  assert.equal(result.added[0].Major + result.added[0].Code, 'SOC301');
  assert.equal(result.added[0].Course_Name, 'Political Sociology');
  assert.equal(result.missing.length, 1);
  assert.equal(result.missing[0], 'MISSING404');
  assert.equal(courseData.length, 2);
  assert.equal(courseData[0], realAcc, 'a selected-catalog record keeps precedence');
  assert.equal(courseData.some((row) => row.Major + row.Code === 'UNREQUESTED999'), false);
});

test('plan-scoped metadata snapshots preserve resolver backfills', () => {
  const stored = new Map();
  h.planStorage = {
    getItem(key) { return stored.has(key) ? stored.get(key) : null; },
    setItem(key, value) { stored.set(key, value); },
  };
  try {
    h.rememberGlobalCourseDefinition({
      Major: 'SOC', Code: '301', Course_Name: 'Political Sociology',
      SU_credit: '2.5', ECTS: '5', __globalCourseDefinition: true,
    });
    const parsed = JSON.parse(stored.get('globalCourseMetadata'));
    assert.deepEqual(parsed, [{
      code: 'SOC301', title: 'Political Sociology', suCredits: 2.5, ects: 5,
    }]);
    const restored = h.getStoredGlobalCourseMetadata().get('SOC301');
    assert.equal(restored.title, 'Political Sociology');
    assert.equal(restored.suCredits, 2.5);
    assert.equal(restored.ects, 5);
  } finally {
    delete h.planStorage;
  }
});

test('internal definitions are hidden from both course dropdown builders', () => {
  const internal = {
    Major: 'SOC', Code: '301', Course_Name: 'Political Sociology',
    SU_credit: '3', EL_Type: 'unknown', __globalCourseDefinition: true,
  };
  const real = {
    Major: 'CS', Code: '201', Course_Name: 'Data Structures',
    SU_credit: '3', EL_Type: 'required',
  };

  const list = h.getCoursesList([internal, real]);
  assert.equal(list.length, 1);
  assert.equal(list[0].code, 'CS201');
  const html = h.getCoursesDataList([internal, real]);
  assert.match(html, /CS201/);
  assert.doesNotMatch(html, /SOC301/);
});

test('real primary and secondary catalog records outrank an internal fallback', () => {
  const fallback = {
    Major: 'CS', Code: '201', Course_Name: 'Global fallback',
    EL_Type: 'unknown', __globalCourseDefinition: true,
  };
  const primary = { Major: 'CS', Code: '201', Course_Name: 'Primary', EL_Type: 'required' };
  assert.equal(catalog.getInfo('cs 201', [fallback, primary]), primary);

  const previousWindow = global.window;
  const doubleMajor = { Major: 'CS', Code: '201', Course_Name: 'Double major', EL_Type: 'core' };
  try {
    global.window = {
      curriculum: {
        doubleMajor: true,
        doubleMajorCourseData: [doubleMajor],
        minors: [],
      },
    };
    assert.equal(catalog.getInfo('CS201', [fallback]), doubleMajor);
    assert.equal(catalog.isCourseValid({ code: 'CS 201' }, [fallback]), true);
    global.window.curriculum.doubleMajorCourseData = [];
    assert.equal(catalog.getInfo('CS201', [fallback]), fallback);
    assert.equal(catalog.isCourseValid({ code: 'CS 201' }, [fallback]), false,
      'an internal reload fallback cannot be manually added by typing its code');
  } finally {
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
  }
});
