// Scheduler dialog lifecycle, focus management, and modal builders.
(function (root) {
  'use strict';

  let schedulerDialogSequence = 0;

  function nextSchedulerDialogId(prefix) {
    schedulerDialogSequence += 1;
    return `${prefix || 'scheduler-dialog'}-${schedulerDialogSequence}`;
  }

  function getSchedulerDialogFocusables(overlay) {
    if (!overlay || typeof overlay.querySelectorAll !== 'function') return [];
    return Array.from(overlay.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
      'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter((element) => {
      if (!element || element.getAttribute('aria-hidden') === 'true') return false;
      if (element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
      try {
        const style = getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden';
      } catch (_) {
        return true;
      }
    });
  }

  function isTopModalDialog(overlay) {
    if (!overlay || !overlay.isConnected) return false;
    try {
      const dialogs = Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]'))
        .filter((dialog) => {
          if (!dialog || !dialog.isConnected || dialog.hidden) return false;
          try {
            const style = getComputedStyle(dialog);
            return style.display !== 'none' && style.visibility !== 'hidden';
          } catch (_) {
            return true;
          }
        });
      return dialogs.length ? dialogs[dialogs.length - 1] === overlay : true;
    } catch (_) {
      return true;
    }
  }

  function activateSchedulerDialog(overlay, options) {
    const opts = options || {};
    const previouslyFocused = opts.previouslyFocused || (
      typeof HTMLElement !== 'undefined' && document.activeElement instanceof HTMLElement
        ? document.activeElement : null
    );
    let active = true;

    const focusElement = (element) => {
      try {
        if (element && element.isConnected && typeof element.focus === 'function') {
          element.focus({ preventScroll: true });
          return true;
        }
      } catch (_) {}
      return false;
    };

    const resolveInitialFocus = () => {
      try {
        const requested = typeof opts.initialFocus === 'function'
          ? opts.initialFocus()
          : opts.initialFocus;
        if (focusElement(requested)) return;
        const focusables = getSchedulerDialogFocusables(overlay);
        if (focusElement(focusables[0])) return;
        if (overlay) {
          if (!overlay.hasAttribute('tabindex')) overlay.tabIndex = -1;
          focusElement(overlay);
        }
      } catch (_) {}
    };

    const onKeyDown = (event) => {
      if (!active || !isTopModalDialog(overlay)) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
        if (typeof opts.onEscape === 'function') opts.onEscape();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusables = getSchedulerDialogFocusables(overlay);
      if (!focusables.length) {
        event.preventDefault();
        if (!overlay.hasAttribute('tabindex')) overlay.tabIndex = -1;
        focusElement(overlay);
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const current = document.activeElement;
      if (event.shiftKey && (current === first || !overlay.contains(current))) {
        event.preventDefault();
        focusElement(last);
      } else if (!event.shiftKey && (current === last || !overlay.contains(current))) {
        event.preventDefault();
        focusElement(first);
      }
    };

    document.addEventListener('keydown', onKeyDown, true);
    try { setTimeout(resolveInitialFocus, 0); } catch (_) { resolveInitialFocus(); }

    return {
      release({ restoreFocus = true } = {}) {
        if (!active) return;
        active = false;
        try { document.removeEventListener('keydown', onKeyDown, true); } catch (_) {}
        if (restoreFocus) focusElement(previouslyFocused);
      },
      focusInitial: resolveInitialFocus,
    };
  }

  // A full-viewport backdrop-filter forces the browser to continuously
  // re-rasterize the entire planner while the Scheduler scrolls. Keep the
  // visual treatment, but restrict the expensive blur surfaces to the four
  // strips that are actually visible around the Scheduler modal. Tiny patches
  // behind its rounded corners cover the cutouts inside the modal's rectangular
  // bounds without extending a blur strip underneath the whole modal.
  function activateSchedulerEdgeBlur(overlay, modal) {
    if (!overlay || !modal) return { refresh() {}, release() {} };

    const bands = {};
    ['top', 'right', 'bottom', 'left'].forEach((side) => {
      const band = document.createElement('div');
      band.className = `scheduler-edge-blur scheduler-edge-blur--${side}`;
      band.setAttribute('aria-hidden', 'true');
      overlay.insertBefore(band, modal);
      bands[side] = band;
    });
    const corners = {};
    ['top-left', 'top-right', 'bottom-right', 'bottom-left'].forEach((corner) => {
      const patch = document.createElement('div');
      patch.className = `scheduler-edge-blur scheduler-corner-blur scheduler-corner-blur--${corner}`;
      patch.setAttribute('aria-hidden', 'true');
      patch.dataset.schedulerBlurCorner = corner;
      overlay.insertBefore(patch, modal);
      corners[corner] = patch;
    });
    overlay.classList.add('scheduler-edge-blur-ready');

    let disposed = false;
    let frame = 0;
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
    const px = (value) => `${Math.round(value * 100) / 100}px`;

    const place = (band, left, top, width, height) => {
      if (!band) return 0;
      const visible = width > 0.5 && height > 0.5;
      band.hidden = !visible;
      if (!visible) return 0;
      band.style.left = px(left);
      band.style.top = px(top);
      band.style.width = px(width);
      band.style.height = px(height);
      return width * height;
    };

    const readRadius = (style, property, maxWidth, maxHeight) => {
      const values = String(style && style[property] || '')
        .trim()
        .split(/\s+/)
        .map((value) => Number.parseFloat(value))
        .filter(Number.isFinite);
      const radiusX = values.length ? values[0] : 0;
      const radiusY = values.length > 1 ? values[1] : radiusX;
      return {
        x: clamp(radiusX, 0, Math.max(0, maxWidth / 2)),
        y: clamp(radiusY, 0, Math.max(0, maxHeight / 2)),
      };
    };

    const update = () => {
      frame = 0;
      if (disposed || !overlay.isConnected || !modal.isConnected) return;
      try {
        const overlayRect = overlay.getBoundingClientRect();
        const modalRect = modal.getBoundingClientRect();
        const width = Math.max(0, overlayRect.width);
        const height = Math.max(0, overlayRect.height);
        const left = clamp(modalRect.left - overlayRect.left, 0, width);
        const right = clamp(modalRect.right - overlayRect.left, left, width);
        const top = clamp(modalRect.top - overlayRect.top, 0, height);
        const bottom = clamp(modalRect.bottom - overlayRect.top, top, height);
        const modalWidth = right - left;
        const modalHeight = bottom - top;
        const modalStyle = getComputedStyle(modal);
        const radii = {
          'top-left': readRadius(modalStyle, 'borderTopLeftRadius', modalWidth, modalHeight),
          'top-right': readRadius(modalStyle, 'borderTopRightRadius', modalWidth, modalHeight),
          'bottom-right': readRadius(modalStyle, 'borderBottomRightRadius', modalWidth, modalHeight),
          'bottom-left': readRadius(modalStyle, 'borderBottomLeftRadius', modalWidth, modalHeight),
        };

        // Finish every geometry/style read before touching the blur surfaces.
        // Interleaving the band writes with the radius read forces a second
        // synchronous layout pass whenever the modal moves or resizes.
        place(bands.top, 0, 0, width, top);
        place(bands.bottom, 0, bottom, width, height - bottom);
        place(bands.left, 0, top, left, bottom - top);
        place(bands.right, right, top, width - right, bottom - top);

        let cornerArea = 0;
        cornerArea += place(corners['top-left'], left, top, radii['top-left'].x, radii['top-left'].y);
        cornerArea += place(
          corners['top-right'],
          right - radii['top-right'].x,
          top,
          radii['top-right'].x,
          radii['top-right'].y,
        );
        cornerArea += place(
          corners['bottom-right'],
          right - radii['bottom-right'].x,
          bottom - radii['bottom-right'].y,
          radii['bottom-right'].x,
          radii['bottom-right'].y,
        );
        cornerArea += place(
          corners['bottom-left'],
          left,
          bottom - radii['bottom-left'].y,
          radii['bottom-left'].x,
          radii['bottom-left'].y,
        );

        overlay.dataset.schedulerBlurArea = String(Math.round(
          (width * top) + (width * (height - bottom))
          + (left * (bottom - top)) + ((width - right) * (bottom - top))
          + cornerArea
        ));
        overlay.dataset.schedulerBlurCornerArea = String(Math.round(cornerArea));
      } catch (_) {}
    };

    const refresh = () => {
      if (disposed || frame) return;
      try {
        frame = requestAnimationFrame(update);
      } catch (_) {
        update();
      }
    };

    let resizeObserver = null;
    try {
      resizeObserver = new ResizeObserver(refresh);
      resizeObserver.observe(overlay);
      resizeObserver.observe(modal);
    } catch (_) {}
    try { window.addEventListener('resize', refresh, { passive: true }); } catch (_) {}
    try {
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', refresh, { passive: true });
        window.visualViewport.addEventListener('scroll', refresh, { passive: true });
      }
    } catch (_) {}
    refresh();

    return {
      refresh,
      release() {
        if (disposed) return;
        disposed = true;
        if (frame) {
          try { cancelAnimationFrame(frame); } catch (_) {}
          frame = 0;
        }
        try { if (resizeObserver) resizeObserver.disconnect(); } catch (_) {}
        try { window.removeEventListener('resize', refresh); } catch (_) {}
        try {
          if (window.visualViewport) {
            window.visualViewport.removeEventListener('resize', refresh);
            window.visualViewport.removeEventListener('scroll', refresh);
          }
        } catch (_) {}
        [...Object.values(bands), ...Object.values(corners)].forEach((surface) => {
          try { surface.remove(); } catch (_) {}
        });
        try {
          overlay.classList.remove('scheduler-edge-blur-ready');
          delete overlay.dataset.schedulerBlurArea;
          delete overlay.dataset.schedulerBlurCornerArea;
        } catch (_) {}
      },
    };
  }


  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function createPickerModal({ title, bodyHtml, listItems, buttons }) {
    return new Promise((resolve) => {
      const previouslyFocused = typeof HTMLElement !== 'undefined' && document.activeElement instanceof HTMLElement
        ? document.activeElement : null;
      const dialogId = nextSchedulerDialogId('scheduler-picker');
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay scheduler-picker-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-labelledby', `${dialogId}-title`);
      overlay.setAttribute('aria-describedby', `${dialogId}-body`);

      const modal = document.createElement('div');
      modal.className = 'modal app-modal scheduler-picker-modal';
      modal.id = dialogId;
      modal.tabIndex = -1;
      modal.addEventListener('click', (e) => e.stopPropagation());

      const header = document.createElement('div');
      header.className = 'app-modal-header';

      const h = document.createElement('h3');
      h.className = 'app-modal-title';
      h.id = `${dialogId}-title`;
      h.textContent = title || '';

      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'app-modal-close';
      close.innerHTML = '<i class="fa-solid fa-xmark"></i>';
      close.setAttribute('aria-label', `Close ${title || 'dialog'}`);

      const body = document.createElement('div');
      body.className = 'app-modal-body';
      body.id = `${dialogId}-body`;
      body.innerHTML = bodyHtml || '';

      if (Array.isArray(listItems) && listItems.length) {
        const list = document.createElement('div');
        list.className = 'scheduler-picker-list';
        for (let i = 0; i < listItems.length; i++) {
          const it = listItems[i] || {};
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'scheduler-picker-option' + (it.className ? ' ' + String(it.className) : '');
          btn.innerHTML =
            `<div class="scheduler-picker-option-title">${escapeHtml(it.label || '')}</div>` +
            (it.subLabel ? `<div class="scheduler-picker-option-meta">${escapeHtml(it.subLabel || '')}</div>` : '');
          btn.addEventListener('click', () => cleanup({ action: it.action || 'pick', value: it.value }));
          list.appendChild(btn);
        }
        body.appendChild(list);
      }

      const footer = document.createElement('div');
      footer.className = 'app-modal-footer';

      let settled = false;
      let dialogController = null;
      const cleanup = (payload) => {
        if (settled) return;
        settled = true;
        try { overlay.remove(); } catch (_) {}
        try { if (dialogController) dialogController.release(); } catch (_) {}
        resolve(payload);
      };

      close.addEventListener('click', () => cleanup({ action: 'close' }));
      overlay.addEventListener('click', () => cleanup({ action: 'cancel' }));

      header.appendChild(h);
      header.appendChild(close);

      (buttons || []).forEach((b) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        const variant = (b && b.variant) ? String(b.variant) : 'secondary';
        const cls = (variant === 'primary')
          ? 'btn-primary'
          : (variant === 'danger')
            ? 'btn-danger'
            : (variant === 'warning')
              ? 'btn-warning'
              : 'btn-secondary';
        btn.className = 'btn ' + cls + ' btn-sm';
        btn.textContent = b.label;
        if (b && b.ariaLabel) btn.setAttribute('aria-label', String(b.ariaLabel));
        btn.addEventListener('click', () => cleanup({ action: b.action, value: b.value }));
        footer.appendChild(btn);
      });

      modal.appendChild(header);
      modal.appendChild(body);
      modal.appendChild(footer);
      overlay.appendChild(modal);
      try {
        const root = document.fullscreenElement || document.body;
        root.appendChild(overlay);
      } catch (_) {
        document.body.appendChild(overlay);
      }

      dialogController = activateSchedulerDialog(overlay, {
        previouslyFocused,
        initialFocus: () => body.querySelector('.scheduler-picker-option') || footer.querySelector('button') || close,
        onEscape: () => cleanup({ action: 'cancel' }),
      });
    });
  }

  function createInfoModal({ title, bodyHtml, buttons, onMount }) {
    return new Promise((resolve) => {
      const previouslyFocused = typeof HTMLElement !== 'undefined' && document.activeElement instanceof HTMLElement
        ? document.activeElement : null;
      const dialogId = nextSchedulerDialogId('scheduler-info');
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay scheduler-picker-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-labelledby', `${dialogId}-title`);
      overlay.setAttribute('aria-describedby', `${dialogId}-body`);

      const modal = document.createElement('div');
      modal.className = 'modal app-modal scheduler-picker-modal scheduler-details-modal';
      modal.id = dialogId;
      modal.tabIndex = -1;
      modal.addEventListener('click', (e) => e.stopPropagation());

      const header = document.createElement('div');
      header.className = 'app-modal-header';

      const h = document.createElement('h3');
      h.className = 'app-modal-title';
      h.id = `${dialogId}-title`;
      h.textContent = title || '';

      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'app-modal-close';
      close.innerHTML = '<i class="fa-solid fa-xmark"></i>';
      close.setAttribute('aria-label', `Close ${title || 'dialog'}`);

      const body = document.createElement('div');
      body.className = 'app-modal-body';
      body.id = `${dialogId}-body`;
      body.innerHTML = bodyHtml || '';

      const footer = document.createElement('div');
      footer.className = 'app-modal-footer';

      let settled = false;
      let dialogController = null;
      const cleanup = (payload) => {
        if (settled) return;
        settled = true;
        try { overlay.remove(); } catch (_) {}
        try { if (dialogController) dialogController.release(); } catch (_) {}
        resolve(payload);
      };

      close.addEventListener('click', () => cleanup({ action: 'close' }));
      overlay.addEventListener('click', () => cleanup({ action: 'cancel' }));

      header.appendChild(h);
      header.appendChild(close);

      (buttons || []).forEach((b) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        const variant = (b && b.variant) ? String(b.variant) : 'secondary';
        const cls = (variant === 'primary')
          ? 'btn-primary'
          : (variant === 'danger')
            ? 'btn-danger'
            : (variant === 'warning')
              ? 'btn-warning'
              : 'btn-secondary';
        btn.className = 'btn ' + cls + ' btn-sm';
        btn.textContent = b.label;
        if (b && b.ariaLabel) btn.setAttribute('aria-label', String(b.ariaLabel));
        btn.addEventListener('click', () => cleanup({ action: b.action, value: b.value }));
        footer.appendChild(btn);
      });

      modal.appendChild(header);
      modal.appendChild(body);
      modal.appendChild(footer);
      overlay.appendChild(modal);
      try {
        const root = document.fullscreenElement || document.body;
        root.appendChild(overlay);
      } catch (_) {
        document.body.appendChild(overlay);
      }

      try {
        modal.scrollTop = 0;
        body.scrollTop = 0;
        close.focus({ preventScroll: true });
      } catch (_) {}

      try {
        if (typeof onMount === 'function') onMount({ overlay, modal, body, close: () => cleanup({ action: 'close' }) });
      } catch (_) {}

      dialogController = activateSchedulerDialog(overlay, {
        previouslyFocused,
        initialFocus: close,
        onEscape: () => cleanup({ action: 'cancel' }),
      });
    });
  }

  function createTextInputModal({ title, bodyHtml, initialValue, placeholder, okLabel }) {
    return new Promise((resolve) => {
      const previouslyFocused = typeof HTMLElement !== 'undefined' && document.activeElement instanceof HTMLElement
        ? document.activeElement : null;
      const dialogId = nextSchedulerDialogId('scheduler-input');
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay scheduler-picker-overlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-labelledby', `${dialogId}-title`);
      overlay.setAttribute('aria-describedby', `${dialogId}-body`);

      const modal = document.createElement('div');
      modal.className = 'modal app-modal scheduler-picker-modal';
      modal.id = dialogId;
      modal.tabIndex = -1;
      modal.addEventListener('click', (e) => e.stopPropagation());

      const header = document.createElement('div');
      header.className = 'app-modal-header';

      const h = document.createElement('h3');
      h.className = 'app-modal-title';
      h.id = `${dialogId}-title`;
      h.textContent = title || '';

      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'app-modal-close';
      close.innerHTML = '<i class="fa-solid fa-xmark"></i>';
      close.setAttribute('aria-label', `Close ${title || 'dialog'}`);

      const body = document.createElement('div');
      body.className = 'app-modal-body';
      body.id = `${dialogId}-body`;
      body.innerHTML = bodyHtml || '';

      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'select-control';
      input.placeholder = placeholder || '';
      input.value = String(initialValue || '');
      input.maxLength = 200;
      input.setAttribute('aria-label', title || 'Dialog input');
      input.style.width = '100%';
      input.style.marginTop = bodyHtml ? '10px' : '0';
      body.appendChild(input);

      const footer = document.createElement('div');
      footer.className = 'app-modal-footer';

      let settled = false;
      let dialogController = null;
      const cleanup = (payload) => {
        if (settled) return;
        settled = true;
        try { overlay.remove(); } catch (_) {}
        try { if (dialogController) dialogController.release(); } catch (_) {}
        resolve(payload);
      };

      const okBtn = document.createElement('button');
      okBtn.type = 'button';
      okBtn.className = 'btn btn-primary btn-sm';
      okBtn.textContent = okLabel || 'OK';
      okBtn.addEventListener('click', () => cleanup({ action: 'ok', value: input.value }));

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'btn btn-secondary btn-sm';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', () => cleanup({ action: 'cancel' }));

      close.addEventListener('click', () => cleanup({ action: 'close' }));
      overlay.addEventListener('click', () => cleanup({ action: 'cancel' }));

      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          okBtn.click();
        }
      });

      header.appendChild(h);
      header.appendChild(close);
      footer.appendChild(cancelBtn);
      footer.appendChild(okBtn);
      modal.appendChild(header);
      modal.appendChild(body);
      modal.appendChild(footer);
      overlay.appendChild(modal);

      try {
        const root = document.fullscreenElement || document.body;
        root.appendChild(overlay);
      } catch (_) {
        document.body.appendChild(overlay);
      }

      dialogController = activateSchedulerDialog(overlay, {
        previouslyFocused,
        initialFocus: input,
        onEscape: () => cleanup({ action: 'cancel' }),
      });
    });
  }

  const api = Object.freeze({
    nextSchedulerDialogId,
    activateSchedulerDialog,
    activateSchedulerEdgeBlur,
    createPickerModal,
    createInfoModal,
    createTextInputModal,
  });
  if (root) root.SurriculumSchedulerDialogs = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
