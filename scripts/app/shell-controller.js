// Idempotent application-shell listeners for sidebar and header menus.
(function (root) {
  'use strict';

  const controllersByDocument = new WeakMap();

  function createController(options) {
    const config = options || {};
    const window = config.window || root;
    const document = config.document || (window && window.document);
    if (!window || !document) throw new TypeError('App shell requires window and document.');
    if (controllersByDocument.has(document)) return controllersByDocument.get(document);

    let sidebarBound = false;
    let headerMenusBound = false;
    let touchStartX = null;
    let touchStartY = null;
    const sidebarDisposers = [];
    const headerDisposers = [];

    const listen = (bucket, target, type, listener, options) => {
      if (!target || typeof target.addEventListener !== 'function') return;
      target.addEventListener(type, listener, options);
      bucket.push(() => target.removeEventListener(type, listener, options));
    };

    const bindSidebar = () => {
      if (sidebarBound) return;
      sidebarBound = true;
      const sidebar = document.querySelector('.sidebar');
      const sidebarToggle = document.querySelector('.sidebar-toggle');
      if (sidebar && sidebarToggle) {
        listen(sidebarDisposers, sidebarToggle, 'click', () => {
          sidebar.classList.toggle('collapsed');
        });
      }
      if (!sidebar) return;

      listen(sidebarDisposers, document, 'touchstart', (event) => {
        if (event.touches.length !== 1) return;
        touchStartX = event.touches[0].clientX;
        touchStartY = event.touches[0].clientY;
      }, { passive: true });

      listen(sidebarDisposers, document, 'touchend', (event) => {
        if (touchStartX === null || touchStartY === null) return;
        const touchEndX = event.changedTouches[0].clientX;
        const touchEndY = event.changedTouches[0].clientY;
        const diffX = touchEndX - touchStartX;
        const diffY = touchEndY - touchStartY;

        if (Math.abs(diffX) > Math.abs(diffY) && Math.abs(diffX) > 50) {
          if (diffX > 0 && touchStartX < 30 && sidebar.classList.contains('collapsed')) {
            sidebar.classList.remove('collapsed');
          } else if (diffX < 0 && touchStartX < sidebar.offsetWidth
              && !sidebar.classList.contains('collapsed')) {
            sidebar.classList.add('collapsed');
          }
        }
        touchStartX = null;
        touchStartY = null;
      }, { passive: true });
    };

    const bindHeaderAndImportMenus = () => {
      if (headerMenusBound) return;
      headerMenusBound = true;

      const importToggle = document.querySelector('.import-toggle');
      if (!importToggle) throw new Error('Import toggle is unavailable.');
      const importDropdown = () => document.getElementById('importDropdown');
      listen(headerDisposers, importToggle, 'click', () => {
        const dropdown = importDropdown();
        if (dropdown) dropdown.classList.toggle('active');
      });

      const controls = document.getElementById('headerControls');
      const more = document.getElementById('headerMore');
      if (controls && more) {
        const closeHeaderMenu = () => {
          try { controls.classList.remove('is-open'); } catch (_) {}
          try { more.setAttribute('aria-expanded', 'false'); } catch (_) {}
        };
        const toggleHeaderMenu = (event) => {
          try {
            if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
          } catch (_) {}
          if (controls.classList.contains('is-open')) closeHeaderMenu();
          else {
            try { controls.classList.add('is-open'); } catch (_) {}
            try { more.setAttribute('aria-expanded', 'true'); } catch (_) {}
          }
        };

        listen(headerDisposers, more, 'click', toggleHeaderMenu);
        listen(headerDisposers, document, 'click', (event) => {
          try {
            if (!controls.contains(event.target)) closeHeaderMenu();
          } catch (_) {
            closeHeaderMenu();
          }
        });
        listen(headerDisposers, document, 'keydown', (event) => {
          if (event && event.key === 'Escape') closeHeaderMenu();
        });
        listen(headerDisposers, window, 'resize', () => {
          try {
            if ((window.innerWidth || 9999) > 640) closeHeaderMenu();
          } catch (_) {}
        }, { passive: true });
      }

      listen(headerDisposers, document, 'click', (event) => {
        const dropdown = importDropdown();
        if (dropdown && dropdown.classList.contains('active')
            && !dropdown.contains(event.target)
            && !importToggle.contains(event.target)) {
          dropdown.classList.remove('active');
        }
      });
      listen(headerDisposers, document, 'keydown', (event) => {
        const dropdown = importDropdown();
        if (!dropdown || event.key !== 'Escape' || !dropdown.classList.contains('active')) return;
        event.preventDefault();
        dropdown.classList.remove('active');
        try { importToggle.focus({ preventScroll: true }); } catch (_) {}
      });
    };

    const dispose = () => {
      sidebarDisposers.splice(0).forEach((remove) => { try { remove(); } catch (_) {} });
      headerDisposers.splice(0).forEach((remove) => { try { remove(); } catch (_) {} });
      touchStartX = null;
      touchStartY = null;
      sidebarBound = false;
      headerMenusBound = false;
    };

    const controller = Object.freeze({ bindSidebar, bindHeaderAndImportMenus, dispose });
    controllersByDocument.set(document, controller);
    return controller;
  }

  const api = Object.freeze({ createController });
  if (root) root.surriculumAppShell = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
