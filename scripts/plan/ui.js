// Shared application modal plus plan-picker/disclosure UI.
(function installPlanUi(root) {
  'use strict';

  let modalSequence = 0;

  function createModal({ title, bodyHtml, input, buttons, onMount }) {
    return new Promise((resolve) => {
      const previouslyFocused = document.activeElement instanceof HTMLElement
        ? document.activeElement : null;
      const modalId = `app-modal-${++modalSequence}`;
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-labelledby', `${modalId}-title`);
      overlay.setAttribute('aria-describedby', `${modalId}-body`);

      const modal = document.createElement('div');
      modal.className = 'modal app-modal';
      modal.id = modalId;
      modal.tabIndex = -1;
      modal.addEventListener('click', (e) => e.stopPropagation());

      const header = document.createElement('div');
      header.className = 'app-modal-header';

      const h = document.createElement('h3');
      h.className = 'app-modal-title';
      h.id = `${modalId}-title`;
      h.textContent = title || '';

      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'app-modal-close';
      close.innerHTML = '<i class="fa-solid fa-xmark"></i>';
      close.setAttribute('aria-label', `Close ${title || 'dialog'}`);
      let onKeyDown = null;
      let settled = false;
      const cleanupAndResolve = (payload) => {
        if (settled) return;
        settled = true;
        try {
          if (onKeyDown) document.removeEventListener('keydown', onKeyDown, true);
        } catch (_) {}
        try { overlay.remove(); } catch (_) {}
        try {
          if (previouslyFocused && previouslyFocused.isConnected) {
            previouslyFocused.focus({ preventScroll: true });
          }
        } catch (_) {}
        resolve(payload);
      };
      close.addEventListener('click', () => cleanupAndResolve({ action: 'close', value: null }));

      header.appendChild(h);
      header.appendChild(close);

      const body = document.createElement('div');
      body.className = 'app-modal-body';
      body.id = `${modalId}-body`;
      body.innerHTML = bodyHtml || '';

      let inputEl = null;
      if (input) {
        inputEl = document.createElement('input');
        inputEl.className = 'app-modal-input';
        inputEl.type = 'text';
        inputEl.value = input.value || '';
        inputEl.placeholder = input.placeholder || '';
        inputEl.setAttribute('aria-label', input.ariaLabel || title || 'Dialog input');
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
        if (b.danger) btn.classList.add('btn-danger');
        btn.addEventListener('click', () => {
          try {
            if (typeof b.onClick === 'function') b.onClick({ overlay, modal, body, button: btn });
          } catch (_) {}
          if (b.href) {
            try {
              window.open(String(b.href), b.target || '_blank', b.features || 'noopener');
            } catch (_) {}
          }
          if (b.closeOnClick === false) return;
          const val = inputEl ? inputEl.value : null;
          cleanupAndResolve({ action: b.action, value: val });
        });
        footer.appendChild(btn);
      });

      modal.appendChild(header);
      modal.appendChild(body);
      modal.appendChild(footer);
      overlay.appendChild(modal);

      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) {
          cleanupAndResolve({ action: 'cancel', value: null });
        }
      });

      // If the user is currently in browser fullscreen (e.g., the scheduler),
      // DOM elements outside the fullscreen element may appear behind it.
      // Attach modals to the fullscreen root so they always render on top.
      const root = document.fullscreenElement || document.body;
      root.appendChild(overlay);

      try {
        if (typeof onMount === 'function') onMount({ overlay, modal, body, close });
      } catch (_) {}

      setTimeout(() => {
        try {
          if (modal) modal.scrollTop = 0;
          if (body) body.scrollTop = 0;
          if (inputEl) {
            inputEl.focus({ preventScroll: true });
            inputEl.select();
          } else {
            close.focus({ preventScroll: true });
          }
        } catch (_) {}
      }, 0);

      const getFocusableElements = () => Array.from(modal.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
        'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )).filter((element) => element.getAttribute('aria-hidden') !== 'true');

      onKeyDown = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          cleanupAndResolve({ action: 'cancel', value: null });
          return;
        }
        if (e.key === 'Tab') {
          const focusable = getFocusableElements();
          if (!focusable.length) {
            e.preventDefault();
            modal.focus({ preventScroll: true });
            return;
          }
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          const active = document.activeElement;
          if (e.shiftKey && (active === first || !modal.contains(active))) {
            e.preventDefault();
            last.focus({ preventScroll: true });
          } else if (!e.shiftKey && active === last) {
            e.preventDefault();
            first.focus({ preventScroll: true });
          }
        }
        if (e.key === 'Enter' && inputEl) {
          const primary = footer.querySelector('.btn-primary');
          if (primary && document.activeElement === inputEl) {
            e.preventDefault();
            primary.click();
          }
        }
      };
      document.addEventListener('keydown', onKeyDown, true);
    });
  }

  const uiModal = {
    alert(title, bodyHtml, options) {
      const opts = options || {};
      return createModal({
        title,
        bodyHtml,
        onMount: opts.onMount,
        buttons: Array.isArray(opts.buttons) && opts.buttons.length
          ? opts.buttons
          : [{ action: 'ok', label: 'OK', variant: 'primary' }],
      });
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

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function initPlanUi(context) {
    const deps = context || {};
    const {
      ensureIndex,
      getPlanMeta,
      sessionPlanId,
      planStorage,
      maxPlans: MAX_PLANS,
      flushSaves,
      showSaveFailure,
      normalizePlanName,
      suspendSaves,
    } = deps;
    const toggle = document.getElementById('planToggle');
    const dropdown = document.getElementById('planDropdown');
    const nameSpan = document.getElementById('activePlanName');
    if (!toggle || !dropdown || !nameSpan) return;

    const announce = (message) => {
      const region = document.getElementById('a11yStatus');
      if (region) region.textContent = String(message || '');
    };
    const closeDropdown = () => {
      dropdown.classList.remove('active');
      toggle.setAttribute('aria-expanded', 'false');
    };
    const openDropdown = () => {
      dropdown.classList.add('active');
      toggle.setAttribute('aria-expanded', 'true');
    };

    const setHeaderName = () => {
      const active = getPlanMeta(sessionPlanId);
      nameSpan.textContent = active?.name || DEFAULT_PLAN_NAME;
    };

    function render() {
      const idx = ensureIndex();
      const activeId = sessionPlanId;
      setHeaderName();

      const list = dropdown.querySelector('.plan-list');
      if (!list) return;
      list.innerHTML = '';

      const updatePlanMoveButtons = () => {
        const rows = Array.from(list.querySelectorAll('.plan-item'));
        rows.forEach((planRow, index) => {
          const name = String(planRow.querySelector('.plan-select')?.textContent || 'plan').trim();
          const up = planRow.querySelector('.plan-move-up');
          const down = planRow.querySelector('.plan-move-down');
          if (up) {
            up.disabled = index === 0;
            up.setAttribute('aria-label', `Move ${name} up`);
          }
          if (down) {
            down.disabled = index === rows.length - 1;
            down.setAttribute('aria-label', `Move ${name} down`);
          }
        });
      };

      idx.plans.forEach((p) => {
        const row = document.createElement('div');
        row.className = 'plan-item' + (p.id === activeId ? ' active' : '');
        row.dataset.id = p.id;
        row.draggable = true;
        row.setAttribute('role', 'listitem');

        const grip = document.createElement('span');
        grip.className = 'plan-grip';
        grip.innerHTML = '<i class="fa-solid fa-grip-vertical"></i>';
        grip.setAttribute('aria-hidden', 'true');

        const moveControls = document.createElement('span');
        moveControls.className = 'plan-move-controls';
        const makeMoveButton = (direction, offset) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = `btn-icon plan-move plan-move-${direction}`;
          button.title = `Move ${p.name} ${direction}`;
          button.setAttribute('aria-label', `Move ${p.name} ${direction}`);
          button.innerHTML = `<i class="fa-solid fa-arrow-${direction}" aria-hidden="true"></i>`;
          button.addEventListener('click', (event) => {
            event.stopPropagation();
            const rows = Array.from(list.querySelectorAll('.plan-item'));
            const fromIndex = rows.indexOf(row);
            const toIndex = fromIndex + offset;
            if (fromIndex < 0 || toIndex < 0 || toIndex >= rows.length) return;
            const reference = offset < 0 ? rows[toIndex] : rows[toIndex].nextSibling;
            const reorderedRows = rows.slice();
            reorderedRows.splice(fromIndex, 1);
            reorderedRows.splice(toIndex, 0, row);
            const ids = reorderedRows.map((element) => element.dataset.id).filter(Boolean);
            if (!planStorage.reorder(ids)) return;
            list.insertBefore(row, reference);
            updatePlanMoveButtons();
            announce(`Moved ${p.name} ${direction} to position ${toIndex + 1} of ${rows.length}.`);
            button.focus({ preventScroll: true });
          });
          return button;
        };
        moveControls.appendChild(makeMoveButton('up', -1));
        moveControls.appendChild(makeMoveButton('down', 1));

        const select = document.createElement('button');
        select.className = 'plan-select';
        select.type = 'button';
        select.textContent = p.name;
        if (p.id === activeId) select.setAttribute('aria-current', 'true');
        select.addEventListener('click', (e) => {
          e.stopPropagation();
          if (p.id === sessionPlanId) {
            closeDropdown();
            return;
          }
          if (!flushSaves()) {
            showSaveFailure();
            return;
          }
          const ok = planStorage.setActivePlanId(p.id);
          if (ok) {
            suspendSaves();
            location.reload();
          }
        });

        const actions = document.createElement('div');
        actions.className = 'plan-actions';

        const mkAction = (title, iconHtml, onClick, extraClass) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.className = 'btn-icon plan-action' + (extraClass ? ' ' + extraClass : '');
          b.title = title;
          b.setAttribute('aria-label', `${title} ${p.name}`);
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
                if (val === null) return;
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
        row.appendChild(moveControls);
        row.appendChild(select);
        row.appendChild(actions);
        list.appendChild(row);
      });
      updatePlanMoveButtons();
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
        if (!flushSaves()) {
          showSaveFailure();
          return;
        }

        const currentId = sessionPlanId;
        uiModal
          .prompt('New plan', '<p>Name your new plan.</p>', { value: `Plan ${idx.plans.length + 1}`, confirmText: 'Continue' })
          .then((val) => {
            if (val === null) return null;
            const baseName = normalizePlanName(val);
            if (!baseName) {
              uiModal.alert('Invalid name', '<p>Plan name cannot be empty.</p>');
              return null;
            }
            return uiModal.confirm(
              'Copy semesters?',
              '<p>Copy current semesters/courses into the new plan?</p><p><small>(Start empty resets major/minor/double-major and admit terms to defaults.)</small></p>',
              { confirmText: 'Copy', cancelText: 'Start empty' }
            ).then((copySemesters) => ({ baseName, copySemesters }));
          })
          .then((res) => {
            if (!res) return;
            const { baseName, copySemesters } = res;
            // The prompt is asynchronous. Flush again immediately before a
            // duplicate reads storage so the copy includes the latest state.
            if (!flushSaves()) {
              showSaveFailure();
              return;
            }
            let newId = null;
            if (copySemesters) {
              newId = planStorage.duplicatePlan(currentId, baseName);
            } else {
              newId = planStorage.createPlan(baseName);
            }
            if (newId) {
              if (planStorage.setActivePlanId(newId)) {
                suspendSaves();
                location.reload();
              }
            }
          })
          .catch((err) => uiModal.alert(
            'Could not create plan',
            `<p>${escapeHtml(err && err.message ? err.message : 'The new plan could not be created.')}</p>`
          ));
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
        if (!flushSaves()) {
          showSaveFailure();
          return;
        }
        planStorage.importPlanFile(file, { activate: false })
          .then((importedId) => {
            // FileReader is asynchronous; capture any edits made while it was
            // reading before switching away from the current plan.
            if (!flushSaves()) {
              planStorage.deletePlan(importedId);
              showSaveFailure();
              return;
            }
            if (planStorage.setActivePlanId(importedId)) {
              suspendSaves();
              location.reload();
            }
          })
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
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !dropdown.classList.contains('active')) return;
      e.preventDefault();
      closeDropdown();
      try { toggle.focus({ preventScroll: true }); } catch (_) {}
    });

    render();
  }

  function initStaticDisclosureA11y() {
    const observeClass = (element, update) => {
      if (!element || typeof MutationObserver === 'undefined') return;
      update();
      new MutationObserver(update).observe(element, { attributes: true, attributeFilter: ['class'] });
    };

    const sidebar = document.querySelector('.sidebar');
    const sidebarToggle = document.querySelector('.sidebar-toggle');
    if (sidebar && sidebarToggle) {
      observeClass(sidebar, () => {
        const expanded = !sidebar.classList.contains('collapsed');
        sidebarToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        sidebarToggle.setAttribute('aria-label', expanded ? 'Collapse planner controls' : 'Expand planner controls');
      });
    }

    const importDropdown = document.getElementById('importDropdown');
    const importToggle = document.querySelector('.import-toggle');
    if (importDropdown && importToggle) {
      observeClass(importDropdown, () => {
        importToggle.setAttribute(
          'aria-expanded',
          importDropdown.classList.contains('active') ? 'true' : 'false'
        );
      });
    }
  }

  const api = Object.freeze({
    createModal,
    uiModal,
    initPlanUi,
    initStaticDisclosureA11y,
  });
  const namespace = root.SurriculumModules || (root.SurriculumModules = {});
  namespace.planUi = api;

  // Preserve the public modal API for existing callers.
  root.uiModal = root.uiModal || uiModal;
})(typeof window !== 'undefined' ? window : globalThis);
