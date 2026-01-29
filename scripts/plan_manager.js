// plan_manager.js
// Adds multi-plan support by namespacing localStorage keys under an active plan.

(function () {
  const INDEX_KEY = 'surriculum.plans.v1';
  const MIGRATED_KEY = 'surriculum.plans.migrated.v1';
  const PLAN_PREFIX = 'surriculum.plan.';
  const MAX_PLANS = 10;
  const DEFAULT_PLAN_NAME = 'Default Plan';
  const LEGACY_KEYS = [
    'major', 'doubleMajor',
    'entryTerm', 'entryTermDM',
    // Minor terms: `entryTermMinor` is legacy (single term); keep for migration.
    'entryTermMinor', 'entryTermMinor1', 'entryTermMinor2', 'entryTermMinor3',
    'minor1', 'minor2', 'minor3',
    'curriculum', 'grades', 'dates'
  ];

  function createModal({ title, bodyHtml, input, buttons }) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');

      const modal = document.createElement('div');
      modal.className = 'modal app-modal';
      modal.addEventListener('click', (e) => e.stopPropagation());

      const header = document.createElement('div');
      header.className = 'app-modal-header';

      const h = document.createElement('h3');
      h.className = 'app-modal-title';
      h.textContent = title || '';

      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'app-modal-close';
      close.innerHTML = '<i class="fa-solid fa-xmark"></i>';
      const cleanupAndResolve = (payload) => {
        try { document.removeEventListener('keydown', onKeyDown); } catch (_) {}
        try { overlay.remove(); } catch (_) {}
        resolve(payload);
      };
      close.addEventListener('click', () => cleanupAndResolve({ action: 'close', value: null }));

      header.appendChild(h);
      header.appendChild(close);

      const body = document.createElement('div');
      body.className = 'app-modal-body';
      body.innerHTML = bodyHtml || '';

      let inputEl = null;
      if (input) {
        inputEl = document.createElement('input');
        inputEl.className = 'app-modal-input';
        inputEl.type = 'text';
        inputEl.value = input.value || '';
        inputEl.placeholder = input.placeholder || '';
        body.appendChild(inputEl);
      }

      const footer = document.createElement('div');
      footer.className = 'app-modal-footer';

      const btns = Array.isArray(buttons) && buttons.length
        ? buttons
        : [{ action: 'ok', label: 'OK', variant: 'primary' }];

      btns.forEach((b) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        const variant = b.variant || (b.action === 'cancel' ? 'secondary' : 'primary');
        btn.className = `btn btn-${variant} btn-sm`;
        btn.textContent = b.label || b.action;
        if (b.danger) btn.style.backgroundColor = '#DC2626';
        btn.addEventListener('click', () => {
          const val = inputEl ? inputEl.value : null;
          cleanupAndResolve({ action: b.action, value: val });
        });
        footer.appendChild(btn);
      });

      modal.appendChild(header);
      modal.appendChild(body);
      modal.appendChild(footer);
      overlay.appendChild(modal);

      overlay.addEventListener('click', () => {
        cleanupAndResolve({ action: 'cancel', value: null });
      });

      document.body.appendChild(overlay);

      setTimeout(() => {
        try {
          if (inputEl) {
            inputEl.focus();
            inputEl.select();
          } else {
            footer.querySelector('button')?.focus();
          }
        } catch (_) {}
      }, 0);

      const onKeyDown = (e) => {
        if (e.key === 'Escape') {
          cleanupAndResolve({ action: 'cancel', value: null });
        }
        if (e.key === 'Enter' && inputEl) {
          const primary = footer.querySelector('.btn-primary');
          if (primary) primary.click();
        }
      };
      document.addEventListener('keydown', onKeyDown, { once: false });
    });
  }

  const uiModal = {
    alert(title, bodyHtml) {
      return createModal({ title, bodyHtml, buttons: [{ action: 'ok', label: 'OK', variant: 'primary' }] });
    },
    async confirm(title, bodyHtml, options) {
      const opts = options || {};
      const res = await createModal({
        title,
        bodyHtml,
        buttons: [
          { action: 'cancel', label: opts.cancelText || 'Cancel', variant: 'secondary' },
          { action: 'confirm', label: opts.confirmText || 'Confirm', variant: 'primary', danger: !!opts.danger },
        ],
      });
      return res.action === 'confirm';
    },
    async prompt(title, bodyHtml, options) {
      const opts = options || {};
      const res = await createModal({
        title,
        bodyHtml,
        input: { value: opts.value || '', placeholder: opts.placeholder || '' },
        buttons: [
          { action: 'cancel', label: opts.cancelText || 'Cancel', variant: 'secondary' },
          { action: 'confirm', label: opts.confirmText || 'Save', variant: 'primary' },
        ],
      });
      if (res.action !== 'confirm') return null;
      return res.value;
    },
  };

  function nowIso() {
    return new Date().toISOString();
  }

  function safeJsonParse(value, fallback) {
    try {
      return JSON.parse(value);
    } catch (_) {
      return fallback;
    }
  }

  function loadIndex() {
    const raw = localStorage.getItem(INDEX_KEY);
    const parsed = safeJsonParse(raw, null);
    if (!parsed || typeof parsed !== 'object') return null;
    if (!Array.isArray(parsed.plans)) return null;
    return parsed;
  }

  function saveIndex(idx) {
    localStorage.setItem(INDEX_KEY, JSON.stringify(idx));
  }

  function createId() {
    return 'p_' + Math.random().toString(36).slice(2, 10);
  }

  function ensureIndex() {
    let idx = loadIndex();
    if (!idx) {
      const id = createId();
      idx = {
        version: 1,
        activeId: id,
        plans: [{ id, name: DEFAULT_PLAN_NAME, createdAt: nowIso(), updatedAt: nowIso() }],
      };
      saveIndex(idx);
      return idx;
    }
    if (!idx.activeId || !idx.plans.some(p => p && p.id === idx.activeId)) {
      idx.activeId = idx.plans[0]?.id || null;
    }
    if (!idx.activeId) {
      const id = createId();
      idx.activeId = id;
      idx.plans = [{ id, name: DEFAULT_PLAN_NAME, createdAt: nowIso(), updatedAt: nowIso() }];
    }
    if (idx.plans.length === 0) {
      const id = createId();
      idx.activeId = id;
      idx.plans.push({ id, name: DEFAULT_PLAN_NAME, createdAt: nowIso(), updatedAt: nowIso() });
    }
    saveIndex(idx);
    return idx;
  }

  function planKey(planId, key) {
    return PLAN_PREFIX + planId + '.' + key;
  }

  function touchUpdated(planId) {
    const idx = ensureIndex();
    const p = idx.plans.find(x => x.id === planId);
    if (p) {
      p.updatedAt = nowIso();
      saveIndex(idx);
    }
  }

  function getActivePlanId() {
    return ensureIndex().activeId;
  }

  function getPlanMeta(id) {
    const idx = ensureIndex();
    return idx.plans.find(p => p.id === id) || null;
  }

  function listLocalStorageKeys() {
    const keys = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k) keys.push(k);
      }
    } catch (_) {}
    return keys;
  }

  function migrateLegacyIfNeeded() {
    if (localStorage.getItem(MIGRATED_KEY)) return;
    const idx = ensureIndex();
    const pid = idx.activeId;

    let didAnything = false;

    // Basic legacy keys
    for (const k of LEGACY_KEYS) {
      const legacy = localStorage.getItem(k);
      const destKey = planKey(pid, k);
      if (legacy != null && localStorage.getItem(destKey) == null) {
        localStorage.setItem(destKey, legacy);
        didAnything = true;
      }
    }

    // Derive per-minor admit terms from the legacy single term if needed.
    try {
      const legacy = localStorage.getItem(planKey(pid, 'entryTermMinor')) || localStorage.getItem('entryTermMinor');
      if (legacy) {
        const k1 = planKey(pid, 'entryTermMinor1');
        const k2 = planKey(pid, 'entryTermMinor2');
        const k3 = planKey(pid, 'entryTermMinor3');
        if (localStorage.getItem(k1) == null) { localStorage.setItem(k1, legacy); didAnything = true; }
        if (localStorage.getItem(k2) == null) { localStorage.setItem(k2, legacy); didAnything = true; }
        if (localStorage.getItem(k3) == null) { localStorage.setItem(k3, legacy); didAnything = true; }
      }
    } catch (_) {}

    // Legacy custom courses (customCourses_<major>)
    const keys = listLocalStorageKeys();
    for (const k of keys) {
      if (!k.startsWith('customCourses_')) continue;
      const destKey = planKey(pid, k);
      if (localStorage.getItem(destKey) == null) {
        const val = localStorage.getItem(k);
        if (val != null) {
          localStorage.setItem(destKey, val);
          didAnything = true;
        }
      }
    }

    localStorage.setItem(MIGRATED_KEY, didAnything ? nowIso() : 'noop');
  }

  const saveHooks = [];

  function normalizePlanName(name) {
    const trimmed = String(name || '').trim().replace(/\s+/g, ' ');
    if (!trimmed) return null;
    return trimmed.slice(0, 60);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function downloadJson(filename, obj) {
    const text = JSON.stringify(obj, null, 2);
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function sanitizeFilename(name) {
    return String(name || 'plan')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'plan';
  }

  function readPlanState(planId) {
    const get = (k) => localStorage.getItem(planKey(planId, k));
    const state = {
      major: get('major') || null,
      doubleMajor: get('doubleMajor') || null,
      entryTerm: get('entryTerm') || null,
      entryTermDM: get('entryTermDM') || null,
      entryTermMinor: get('entryTermMinor') || null,
      entryTermMinor1: get('entryTermMinor1') || null,
      entryTermMinor2: get('entryTermMinor2') || null,
      entryTermMinor3: get('entryTermMinor3') || null,
      minor1: get('minor1') || null,
      minor2: get('minor2') || null,
      minor3: get('minor3') || null,
      curriculum: safeJsonParse(get('curriculum') || 'null', null),
      grades: safeJsonParse(get('grades') || 'null', null),
      dates: safeJsonParse(get('dates') || 'null', null),
      customCourses: {},
    };

    const prefix = planKey(planId, 'customCourses_');
    const keys = listLocalStorageKeys();
    for (const k of keys) {
      if (!k.startsWith(prefix)) continue;
      const majorKey = k.slice(planKey(planId, '').length);
      const raw = localStorage.getItem(k);
      const parsed = safeJsonParse(raw || 'null', null);
      if (Array.isArray(parsed)) {
        state.customCourses[majorKey.replace(/^customCourses_/, '')] = parsed;
      }
    }

    return state;
  }

  function writePlanState(planId, state) {
    if (!state || typeof state !== 'object') return;
    const setRaw = (k, v) => localStorage.setItem(planKey(planId, k), v);
    const setJson = (k, v) => setRaw(k, JSON.stringify(v));

    if (state.major != null) setRaw('major', String(state.major));
    if (state.doubleMajor != null) setRaw('doubleMajor', String(state.doubleMajor));
    if (state.entryTerm != null) setRaw('entryTerm', String(state.entryTerm));
    if (state.entryTermDM != null) setRaw('entryTermDM', String(state.entryTermDM));
    if (state.entryTermMinor != null) setRaw('entryTermMinor', String(state.entryTermMinor));
    if (state.entryTermMinor1 != null) setRaw('entryTermMinor1', String(state.entryTermMinor1));
    if (state.entryTermMinor2 != null) setRaw('entryTermMinor2', String(state.entryTermMinor2));
    if (state.entryTermMinor3 != null) setRaw('entryTermMinor3', String(state.entryTermMinor3));
    if (state.minor1 != null) setRaw('minor1', String(state.minor1));
    if (state.minor2 != null) setRaw('minor2', String(state.minor2));
    if (state.minor3 != null) setRaw('minor3', String(state.minor3));

    if (state.curriculum != null) setJson('curriculum', state.curriculum);
    if (state.grades != null) setJson('grades', state.grades);
    if (state.dates != null) setJson('dates', state.dates);

    if (state.customCourses && typeof state.customCourses === 'object') {
      for (const maj of Object.keys(state.customCourses)) {
        const list = state.customCourses[maj];
        if (!Array.isArray(list)) continue;
        setJson('customCourses_' + maj, list);
      }
    }

    touchUpdated(planId);
  }

  function buildExportObject(planId) {
    const idx = ensureIndex();
    const meta = getPlanMeta(planId);
    const order = idx.plans.findIndex(p => p.id === planId);
    const state = readPlanState(planId);
    return {
      type: 'surriculum_plan',
      version: 1,
      exportedAt: nowIso(),
      plan: {
        id: meta?.id || planId,
        name: meta?.name || DEFAULT_PLAN_NAME,
        order,
        createdAt: meta?.createdAt || null,
        updatedAt: meta?.updatedAt || null,
        state,
      },
    };
  }

  function importExportObject(obj, opts) {
    const options = opts || {};
    if (!obj || typeof obj !== 'object') throw new Error('Invalid file');
    if (obj.type !== 'surriculum_plan' || obj.version !== 1 || !obj.plan) throw new Error('Unsupported file');

    const name = normalizePlanName(obj.plan.name) || 'Imported Plan';
    const idx = ensureIndex();
    if (idx.plans.length >= MAX_PLANS) throw new Error(`Plan limit reached (${MAX_PLANS}).`);

    const id = createId();
    idx.plans.push({ id, name, createdAt: nowIso(), updatedAt: nowIso() });
    if (options.activate) idx.activeId = id;
    saveIndex(idx);

    writePlanState(id, obj.plan.state || {});
    return id;
  }

  function initPlanUi() {
    const toggle = document.getElementById('planToggle');
    const dropdown = document.getElementById('planDropdown');
    const nameSpan = document.getElementById('activePlanName');
    if (!toggle || !dropdown || !nameSpan) return;

    const closeDropdown = () => dropdown.classList.remove('active');
    const openDropdown = () => dropdown.classList.add('active');

    const setHeaderName = () => {
      const active = getPlanMeta(getActivePlanId());
      nameSpan.textContent = active?.name || DEFAULT_PLAN_NAME;
    };

    function render() {
      const idx = ensureIndex();
      const activeId = idx.activeId;
      setHeaderName();

      const list = dropdown.querySelector('.plan-list');
      if (!list) return;
      list.innerHTML = '';

      idx.plans.forEach((p) => {
        const row = document.createElement('div');
        row.className = 'plan-item' + (p.id === activeId ? ' active' : '');
        row.dataset.id = p.id;
        row.draggable = true;

        const grip = document.createElement('span');
        grip.className = 'plan-grip';
        grip.innerHTML = '<i class="fa-solid fa-grip-vertical"></i>';

        const select = document.createElement('button');
        select.className = 'plan-select';
        select.type = 'button';
        select.textContent = p.name;
        select.addEventListener('click', (e) => {
          e.stopPropagation();
          if (p.id === getActivePlanId()) {
            closeDropdown();
            return;
          }
          try {
            for (const fn of saveHooks) {
              try { fn(); } catch (_) {}
            }
          } catch (_) {}
          const ok = planStorage.setActivePlanId(p.id);
          if (ok) location.reload();
        });

        const actions = document.createElement('div');
        actions.className = 'plan-actions';

        const mkAction = (title, iconHtml, onClick, extraClass) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'btn-icon plan-action' + (extraClass ? ' ' + extraClass : '');
          b.title = title;
          b.innerHTML = iconHtml;
          b.addEventListener('click', (e) => {
            e.stopPropagation();
            onClick();
          });
          return b;
        };

        actions.appendChild(
          mkAction('Rename', '<i class="fa-solid fa-pen"></i>', () => {
            uiModal
              .prompt('Rename plan', '<p>Enter a new name for this plan.</p>', { value: p.name, confirmText: 'Rename' })
              .then((val) => {
                const next = normalizePlanName(val);
                if (!next) {
                  uiModal.alert('Invalid name', '<p>Plan name cannot be empty.</p>');
                  return;
                }
                planStorage.renamePlan(p.id, next);
                render();
              })
              .catch(() => {});
          })
        );
        actions.appendChild(
          mkAction('Export', '<i class="fa-solid fa-file-arrow-down"></i>', () => {
            planStorage.exportPlan(p.id);
          })
        );
        actions.appendChild(
          mkAction('Delete', '<i class="fa-solid fa-trash"></i>', () => {
            uiModal
              .confirm(
                'Delete plan?',
                `<p>Delete <strong>${escapeHtml(p.name)}</strong>?</p><p>This cannot be undone.</p>`,
                { confirmText: 'Delete', danger: true }
              )
              .then((ok) => {
                if (!ok) return;
                const res = planStorage.deletePlan(p.id);
                if (!res.ok) {
                  uiModal.alert('Cannot delete plan', `<p>${escapeHtml(res.message || 'At least one plan must exist.')}</p>`);
                  return;
                }
                if (res.reloaded) return;
                render();
              })
              .catch(() => {});
          }, 'danger')
        );

        row.appendChild(grip);
        row.appendChild(select);
        row.appendChild(actions);
        list.appendChild(row);
      });
    }

    // Drag and drop ordering
    let draggingId = null;
    dropdown.addEventListener('dragstart', (e) => {
      const target = e.target && e.target.closest ? e.target.closest('.plan-item') : null;
      if (!target) return;
      draggingId = target.dataset.id;
      target.classList.add('dragging');
      try {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', draggingId);
      } catch (_) {}
    });
    dropdown.addEventListener('dragend', (e) => {
      const target = e.target && e.target.closest ? e.target.closest('.plan-item') : null;
      if (target) target.classList.remove('dragging');
      draggingId = null;
      const ids = Array.from(dropdown.querySelectorAll('.plan-item')).map(el => el.dataset.id).filter(Boolean);
      if (ids.length) planStorage.reorder(ids);
    });
    dropdown.addEventListener('dragover', (e) => {
      const over = e.target && e.target.closest ? e.target.closest('.plan-item') : null;
      if (!over || !draggingId) return;
      e.preventDefault();
      const list = dropdown.querySelector('.plan-list');
      const draggingEl = list.querySelector(`.plan-item[data-id="${draggingId}"]`);
      if (!draggingEl || over === draggingEl) return;
      const rect = over.getBoundingClientRect();
      const after = e.clientY > rect.top + rect.height / 2;
      list.insertBefore(draggingEl, after ? over.nextSibling : over);
    });

    // Add / Import controls
    const addBtn = document.getElementById('addPlanBtn');
    const importBtn = document.getElementById('importPlanBtn2');
    const importInput = document.getElementById('planImportInput2');

    if (addBtn) {
      addBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = ensureIndex();
        if (idx.plans.length >= MAX_PLANS) {
          uiModal.alert('Plan limit reached', `<p>You can have up to <strong>${MAX_PLANS}</strong> plans.</p>`);
          return;
        }
        // Flush the current plan before creating/switching. This avoids the
        // autosave loop writing the current plan into the newly active plan.
        try {
          for (const fn of saveHooks) {
            try { fn(); } catch (_) {}
          }
        } catch (_) {}

        const currentId = getActivePlanId();
        uiModal
          .prompt('New plan', '<p>Name your new plan.</p>', { value: `Plan ${idx.plans.length + 1}`, confirmText: 'Continue' })
          .then((val) => {
            const baseName = normalizePlanName(val);
            if (!baseName) {
              uiModal.alert('Invalid name', '<p>Plan name cannot be empty.</p>');
              return null;
            }
            return uiModal.confirm(
              'Copy semesters?',
              '<p>Copy current semesters/courses into the new plan?</p><p><small>(Major + terms will be kept either way.)</small></p>',
              { confirmText: 'Copy', cancelText: 'Start empty' }
            ).then((copySemesters) => ({ baseName, copySemesters }));
          })
          .then((res) => {
            if (!res) return;
            const { baseName, copySemesters } = res;
            let newId = null;
            if (copySemesters) {
              newId = planStorage.duplicatePlan(currentId, baseName);
            } else {
              newId = planStorage.createPlan(baseName);
              if (newId) {
                const keys = ['major', 'doubleMajor', 'entryTerm', 'entryTermDM', 'entryTermMinor', 'entryTermMinor1', 'entryTermMinor2', 'entryTermMinor3'];
                for (const k of keys) {
                  const v = planStorage.getItem(k, currentId);
                  if (v != null) planStorage.setItem(k, v, newId);
                }
              }
            }
            if (newId) {
              planStorage.setActivePlanId(newId);
              location.reload();
            }
          })
          .catch(() => {});
      });
    }

    if (importBtn && importInput) {
      importBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        importInput.value = '';
        importInput.click();
      });
      importInput.addEventListener('change', () => {
        const file = importInput.files && importInput.files[0];
        if (!file) return;
        planStorage.importPlanFile(file, { activate: true })
          .then(() => location.reload())
          .catch((err) => uiModal.alert('Import failed', `<p>${escapeHtml(err && err.message ? err.message : 'Failed to import plan.')}</p>`));
      });
    }

    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      if (dropdown.classList.contains('active')) closeDropdown();
      else openDropdown();
    });

    document.addEventListener('click', (e) => {
      if (!dropdown.classList.contains('active')) return;
      if (dropdown.contains(e.target) || toggle.contains(e.target)) return;
      closeDropdown();
    });

    render();
  }

  const planStorage = {
    maxPlans: MAX_PLANS,
    ensureIndex,
    getActivePlanId,
    getPlans() {
      return ensureIndex().plans.slice();
    },
    getActivePlan() {
      const idx = ensureIndex();
      return idx.plans.find(p => p.id === idx.activeId) || idx.plans[0];
    },
    setActivePlanId(id) {
      const idx = ensureIndex();
      if (!idx.plans.some(p => p.id === id)) return false;
      idx.activeId = id;
      saveIndex(idx);
      return true;
    },
    registerSaveHook(fn) {
      if (typeof fn === 'function') saveHooks.push(fn);
    },
    getItem(key, planId) {
      const pid = planId || getActivePlanId();
      return localStorage.getItem(planKey(pid, key));
    },
    setItem(key, value, planId) {
      const pid = planId || getActivePlanId();
      localStorage.setItem(planKey(pid, key), value);
      touchUpdated(pid);
    },
    removeItem(key, planId) {
      const pid = planId || getActivePlanId();
      localStorage.removeItem(planKey(pid, key));
      touchUpdated(pid);
    },
    createPlan(name) {
      const n = normalizePlanName(name) || 'New Plan';
      const idx = ensureIndex();
      if (idx.plans.length >= MAX_PLANS) return null;
      const id = createId();
      idx.plans.push({ id, name: n, createdAt: nowIso(), updatedAt: nowIso() });
      saveIndex(idx);
      return id;
    },
    duplicatePlan(sourceId, name) {
      const idx = ensureIndex();
      if (idx.plans.length >= MAX_PLANS) return null;
      const src = sourceId || idx.activeId;
      const n = normalizePlanName(name) || 'Copy of Plan';
      const id = createId();
      idx.plans.push({ id, name: n, createdAt: nowIso(), updatedAt: nowIso() });
      saveIndex(idx);
      const srcPrefix = planKey(src, '');
      const dstPrefix = planKey(id, '');
      const keys = listLocalStorageKeys();
      for (const k of keys) {
        if (!k.startsWith(srcPrefix)) continue;
        const rest = k.slice(srcPrefix.length);
        const val = localStorage.getItem(k);
        if (val != null) localStorage.setItem(dstPrefix + rest, val);
      }
      touchUpdated(id);
      return id;
    },
    renamePlan(id, name) {
      const n = normalizePlanName(name);
      if (!n) return false;
      const idx = ensureIndex();
      const p = idx.plans.find(x => x.id === id);
      if (!p) return false;
      p.name = n;
      p.updatedAt = nowIso();
      saveIndex(idx);
      return true;
    },
    deletePlan(id) {
      const idx = ensureIndex();
      if (idx.plans.length <= 1) {
        return { ok: false, message: 'At least one plan must exist.' };
      }
      const exists = idx.plans.some(p => p.id === id);
      if (!exists) return { ok: false, message: 'Plan not found.' };

      // Remove all plan-scoped keys for this plan id
      const prefix = planKey(id, '');
      const keys = listLocalStorageKeys();
      for (const k of keys) {
        if (k.startsWith(prefix)) localStorage.removeItem(k);
      }

      idx.plans = idx.plans.filter(p => p.id !== id);
      let reloaded = false;
      if (idx.activeId === id) {
        idx.activeId = idx.plans[0].id;
        saveIndex(idx);
        try {
          for (const fn of saveHooks) {
            try { fn(); } catch (_) {}
          }
        } catch (_) {}
        location.reload();
        reloaded = true;
      } else {
        saveIndex(idx);
      }
      return { ok: true, reloaded };
    },
    reorder(idsInOrder) {
      const idx = ensureIndex();
      const order = Array.isArray(idsInOrder) ? idsInOrder.filter(Boolean) : [];
      if (order.length !== idx.plans.length) return false;
      const map = new Map(idx.plans.map(p => [p.id, p]));
      const next = [];
      for (const id of order) {
        const p = map.get(id);
        if (!p) return false;
        next.push(p);
      }
      idx.plans = next;
      saveIndex(idx);
      return true;
    },
    exportPlan(id) {
      const pid = id || getActivePlanId();
      if (pid === getActivePlanId()) {
        for (const fn of saveHooks) {
          try { fn(); } catch (_) {}
        }
      }
      const obj = buildExportObject(pid);
      const meta = getPlanMeta(pid);
      const fname = `surriculum-plan_${sanitizeFilename(meta?.name || 'plan')}_${nowIso().slice(0, 10)}.json`;
      downloadJson(fname, obj);
      return true;
    },
    async importPlanFile(file, options) {
      const text = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsText(file);
      });
      const obj = safeJsonParse(text, null);
      const id = importExportObject(obj, options || { activate: true });
      return id;
    },
    importPlanObject: importExportObject,
  };

  // Boot
  ensureIndex();
  migrateLegacyIfNeeded();
  window.planStorage = planStorage;
  window.uiModal = window.uiModal || uiModal;

  if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', initPlanUi);
  }
})();
