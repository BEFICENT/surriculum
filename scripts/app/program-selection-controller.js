// Program/admit-term controls for the planner sidebar.
(function (root) {
  'use strict';

  function createController(options) {
    const config = options || {};
    const document = config.document || (root && root.document);
    if (!document) throw new TypeError('Program selection requires a document.');

    const planGetItem = config.planGetItem;
    const planSetItem = config.planSetItem;
    const planRemoveItem = config.planRemoveItem;
    const reloadAfterPlanFlush = config.reloadAfterPlanFlush;
    const escapeHtml = config.escapeHtml;
    const getMajorsForTerm = config.getMajorsForTerm;
    const entryTerms = Array.isArray(config.entryTerms) ? config.entryTerms : [];
    const minorEntryTerms = Array.isArray(config.minorEntryTerms) ? config.minorEntryTerms : [];
    const entryTermName = config.entryTermName || '';
    const entryTermDMName = config.entryTermDMName || '';
    const entryTermMinor1Name = config.entryTermMinor1Name || '';
    const entryTermMinor2Name = config.entryTermMinor2Name || '';
    const entryTermMinor3Name = config.entryTermMinor3Name || '';
    const minorDefaultTermName = config.minorDefaultTermName || '';
    const entryTermCode = config.entryTermCode || '';
    const entryTermDMCode = config.entryTermDMCode || '';
    const primaryProgram = config.primaryProgram || '';
    let initialized = false;

    function initialize() {
      if (initialized) return;
      initialized = true;

      const changeMajorElement = document.querySelector('.change_major');
      const entryTermElement = document.querySelector('.entryTerm');
      const entryTermDMElement = document.querySelector('.entryTermDM');
      const entryTermMinor1Element = document.getElementById('minorTerm1');
      const entryTermMinor2Element = document.getElementById('minorTerm2');
      const entryTermMinor3Element = document.getElementById('minorTerm3');
      const doubleMajorElement = document.querySelector('.doubleMajor');
      const doubleMajorControlsRow = document.getElementById('doubleMajorControlsRow');
      const doubleMajorButtonRow = document.getElementById('doubleMajorButtonRow');
      const addDoubleMajorButton = document.getElementById('addDoubleMajorBtn');
      const minor1Row = document.getElementById('minor1Row');
      const minor2Row = document.getElementById('minor2Row');
      const minor3Row = document.getElementById('minor3Row');
      const addMinorRow = document.getElementById('addMinorRow');
      const addMinorButton = document.getElementById('addMinorBtn');
      const minor1Select = document.getElementById('minor1');
      const minor2Select = document.getElementById('minor2');
      const minor3Select = document.getElementById('minor3');

      const setDoubleMajorUiVisible = (visible) => {
        try {
          if (visible) {
            if (doubleMajorControlsRow) doubleMajorControlsRow.classList.remove('is-hidden');
            if (doubleMajorButtonRow) doubleMajorButtonRow.classList.add('is-hidden');
          } else {
            if (doubleMajorControlsRow) doubleMajorControlsRow.classList.add('is-hidden');
            if (doubleMajorButtonRow) doubleMajorButtonRow.classList.remove('is-hidden');
          }
        } catch (_) {}
      };

      const setMinorRowVisible = (row, visible) => {
        try {
          if (!row) return;
          if (visible) row.classList.remove('is-hidden');
          else row.classList.add('is-hidden');
        } catch (_) {}
      };

      if (changeMajorElement && changeMajorElement.tagName === 'SELECT') {
        const majorsList = getMajorsForTerm(entryTermCode);
        changeMajorElement.innerHTML = majorsList.map((major) => (
          `<option value="${major}">${major}</option>`
        )).join('');
        changeMajorElement.value = primaryProgram;
        changeMajorElement.addEventListener('change', function (event) {
          planSetItem('major', event.target.value);
          reloadAfterPlanFlush();
        });
      }
      if (entryTermElement && entryTermElement.tagName === 'SELECT') {
        entryTermElement.innerHTML = entryTerms.map((term) => (
          `<option value="${term}">${term}</option>`
        )).join('');
        entryTermElement.value = entryTermName;
        entryTermElement.addEventListener('change', function (event) {
          planSetItem('entryTerm', event.target.value);
          reloadAfterPlanFlush();
        });
      }
      if (doubleMajorElement && doubleMajorElement.tagName === 'SELECT') {
        const doubleMajorList = ['None'].concat(getMajorsForTerm(entryTermDMCode));
        doubleMajorElement.innerHTML = doubleMajorList.map((major) => (
          `<option value="${major === 'None' ? '' : major}">${major}</option>`
        )).join('');
        doubleMajorElement.value = planGetItem('doubleMajor') || '';
        doubleMajorElement.addEventListener('change', function (event) {
          const value = event.target.value;
          if (value) {
            planSetItem('doubleMajor', value);
            planSetItem('showDoubleMajorControls', 'true');
          } else {
            planRemoveItem('doubleMajor');
            planSetItem('showDoubleMajorControls', 'false');
          }
          reloadAfterPlanFlush();
        });
      }
      if (entryTermDMElement && entryTermDMElement.tagName === 'SELECT') {
        entryTermDMElement.innerHTML = entryTerms.map((term) => (
          `<option value="${term}">${term}</option>`
        )).join('');
        entryTermDMElement.value = entryTermDMName;
        entryTermDMElement.addEventListener('change', function (event) {
          planSetItem('entryTermDM', event.target.value);
          reloadAfterPlanFlush();
        });
      }

      const bindMinorTermSelect = (element, key, value) => {
        if (!element || element.tagName !== 'SELECT') return;
        element.innerHTML = minorEntryTerms.map((term) => (
          `<option value="${term}">${term}</option>`
        )).join('');
        element.value = value || '';
        element.addEventListener('change', function (event) {
          planSetItem(key, event.target.value);
          if (key === 'entryTermMinor1') planSetItem('entryTermMinor', event.target.value);
          reloadAfterPlanFlush();
        });
      };
      bindMinorTermSelect(entryTermMinor1Element, 'entryTermMinor1', entryTermMinor1Name);
      bindMinorTermSelect(entryTermMinor2Element, 'entryTermMinor2', entryTermMinor2Name);
      bindMinorTermSelect(entryTermMinor3Element, 'entryTermMinor3', entryTermMinor3Name);

      try {
        const hasDoubleMajor = !!(planGetItem('doubleMajor') || '');
        let showPreference = false;
        try {
          const stored = planGetItem('showDoubleMajorControls');
          if (stored !== null) showPreference = stored === 'true';
        } catch (_) {}
        if (hasDoubleMajor) {
          setDoubleMajorUiVisible(true);
          planSetItem('showDoubleMajorControls', 'true');
        } else {
          setDoubleMajorUiVisible(showPreference);
        }
        if (addDoubleMajorButton) {
          addDoubleMajorButton.addEventListener('click', function () {
            setDoubleMajorUiVisible(true);
            planSetItem('showDoubleMajorControls', 'true');
            try { if (doubleMajorElement) doubleMajorElement.focus(); } catch (_) {}
          });
        }
      } catch (_) {}

      try {
        const minorRequirements = root && root.minorRequirements ? root.minorRequirements : {};
        const minorList = Object.values(minorRequirements).filter(Boolean).sort((left, right) => {
          const leftName = String(left.name || left.minor || '');
          const rightName = String(right.name || right.minor || '');
          return leftName.localeCompare(rightName);
        });
        const shortenMinorLabel = (fullName) => {
          const raw = String(fullName || '').trim();
          if (!raw) return '';
          const maxLength = 44;
          if (raw.length <= maxLength) return raw;
          let shortened = raw;
          shortened = shortened.replace(/\bMinor Program\b/ig, '')
            .replace(/\bProgram\b/ig, '')
            .replace(/\bMinor\b/ig, '');
          shortened = shortened.replace(/\bin\b/ig, ' ').replace(/\s{2,}/g, ' ').trim();
          shortened = shortened.replace(/\band\b/ig, '&');
          if (shortened.length <= maxLength) return shortened;
          if (shortened.includes('(')) {
            const beforeParenthesis = shortened.split('(')[0].trim();
            if (beforeParenthesis.length >= 10 && beforeParenthesis.length < shortened.length) {
              shortened = beforeParenthesis;
            }
          }
          if (shortened.length <= maxLength) return shortened;
          return `${shortened.slice(0, maxLength - 3).trimEnd()}...`;
        };

        const optionsHtml = ['<option value="">None</option>'].concat(
          minorList.map((record) => {
            const fullName = String(record.name || record.minor || '').trim()
              || String(record.minor || '');
            const shortName = shortenMinorLabel(fullName) || fullName;
            return `<option value="${escapeHtml(record.minor)}" title="${escapeHtml(fullName)}">${escapeHtml(shortName)}</option>`;
          }),
        ).join('');

        const getMinor = (key) => {
          try { return planGetItem(key) || ''; } catch (_) {}
          return '';
        };
        const setMinor = (key, value) => {
          try {
            if (value) planSetItem(key, value);
            else planRemoveItem(key);
          } catch (_) {}
        };
        const getMinorTerm = (slot) => {
          try {
            const key = `entryTermMinor${slot}`;
            const value = planGetItem(key) || '';
            if (value) return value;
          } catch (_) {}
          if (slot === 1) return entryTermMinor1Name;
          if (slot === 2) return entryTermMinor2Name;
          if (slot === 3) return entryTermMinor3Name;
          return minorDefaultTermName;
        };
        const setMinorTerm = (slot, value) => {
          try {
            const key = `entryTermMinor${slot}`;
            planSetItem(key, value || minorDefaultTermName);
            if (slot === 1) planSetItem('entryTermMinor', value || minorDefaultTermName);
          } catch (_) {}
        };

        const savedMinor1 = getMinor('minor1');
        const savedMinor2 = getMinor('minor2');
        const savedMinor3 = getMinor('minor3');
        const hasAnyMinor = !!(savedMinor1 || savedMinor2 || savedMinor3);

        let showPreference = false;
        try {
          const stored = planGetItem('showMinorControls');
          if (stored !== null) showPreference = stored === 'true';
        } catch (_) {}

        const ensureSelect = (select, value) => {
          if (!select || select.tagName !== 'SELECT') return;
          select.innerHTML = optionsHtml;
          select.value = value || '';
        };
        ensureSelect(minor1Select, savedMinor1);
        ensureSelect(minor2Select, savedMinor2);
        ensureSelect(minor3Select, savedMinor3);

        const updateMinorOptionAvailability = () => {
          const selects = [minor1Select, minor2Select, minor3Select].filter(Boolean);
          selects.forEach((select) => {
            const selectedElsewhere = new Set(selects
              .filter((other) => other !== select)
              .map((other) => String(other.value || ''))
              .filter(Boolean));
            Array.from(select.options).forEach((option) => {
              option.disabled = !!option.value
                && option.value !== select.value
                && selectedElsewhere.has(option.value);
            });
          });
        };
        updateMinorOptionAvailability();

        if (!hasAnyMinor && !showPreference) {
          setMinorRowVisible(minor1Row, false);
          setMinorRowVisible(minor2Row, false);
          setMinorRowVisible(minor3Row, false);
        } else {
          setMinorRowVisible(minor1Row, true);
          setMinorRowVisible(minor2Row, !!savedMinor2);
          setMinorRowVisible(minor3Row, !!savedMinor3);
        }

        const updateAddMinorButton = () => {
          try {
            if (!addMinorButton) return;
            const row1Visible = minor1Row && !minor1Row.classList.contains('is-hidden');
            const row2Visible = minor2Row && !minor2Row.classList.contains('is-hidden');
            const row3Visible = minor3Row && !minor3Row.classList.contains('is-hidden');
            const atMaximum = !!(row1Visible && row2Visible && row3Visible);
            addMinorButton.disabled = atMaximum;
            if (addMinorRow) {
              if (atMaximum) addMinorRow.classList.add('is-hidden');
              else addMinorRow.classList.remove('is-hidden');
            }
          } catch (_) {}
        };
        updateAddMinorButton();

        const onMinorChange = (slot, value) => {
          const selected = value || '';
          if (slot === 1) {
            if (!selected) {
              const nextMinor1 = savedMinor2 || '';
              const nextMinor2 = savedMinor3 || '';
              setMinor('minor1', nextMinor1);
              setMinor('minor2', nextMinor2);
              setMinor('minor3', '');
              setMinorTerm(1, getMinorTerm(2));
              setMinorTerm(2, getMinorTerm(3));
              setMinorTerm(3, minorDefaultTermName);
              planSetItem('showMinorControls', (nextMinor1 || nextMinor2) ? 'true' : 'false');
            } else {
              setMinor('minor1', selected);
              planSetItem('showMinorControls', 'true');
            }
          } else if (slot === 2) {
            if (!selected) {
              setMinor('minor2', savedMinor3 || '');
              setMinor('minor3', '');
              setMinorTerm(2, getMinorTerm(3));
              setMinorTerm(3, minorDefaultTermName);
            } else {
              setMinor('minor2', selected);
            }
            planSetItem('showMinorControls', 'true');
          } else if (slot === 3) {
            setMinor('minor3', selected);
            planSetItem('showMinorControls', 'true');
          }
          reloadAfterPlanFlush();
        };

        if (minor1Select) {
          minor1Select.addEventListener('change', (event) => onMinorChange(1, event.target.value));
        }
        if (minor2Select) {
          minor2Select.addEventListener('change', (event) => onMinorChange(2, event.target.value));
        }
        if (minor3Select) {
          minor3Select.addEventListener('change', (event) => onMinorChange(3, event.target.value));
        }

        if (addMinorButton) {
          addMinorButton.addEventListener('click', (event) => {
            event.preventDefault();
            planSetItem('showMinorControls', 'true');
            if (minor1Row && minor1Row.classList.contains('is-hidden')) {
              setMinorRowVisible(minor1Row, true);
            } else if (minor2Row && minor2Row.classList.contains('is-hidden')) {
              setMinorRowVisible(minor2Row, true);
            } else if (minor3Row && minor3Row.classList.contains('is-hidden')) {
              setMinorRowVisible(minor3Row, true);
            }
            updateAddMinorButton();
            try {
              if (minor1Row && !minor1Row.classList.contains('is-hidden')
                  && minor1Select && !minor1Select.value) minor1Select.focus();
              else if (minor2Row && !minor2Row.classList.contains('is-hidden')
                  && minor2Select && !minor2Select.value) minor2Select.focus();
              else if (minor3Row && !minor3Row.classList.contains('is-hidden')
                  && minor3Select && !minor3Select.value) minor3Select.focus();
            } catch (_) {}
          });
        }
      } catch (_) {}
    }

    return Object.freeze({ initialize });
  }

  const api = Object.freeze({ createController });
  if (root) root.surriculumProgramSelection = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
