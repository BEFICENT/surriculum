// Theme management for SUrriculum.
//
// The theme id lives on <html data-theme="…"> so theme state is independent
// from responsive and feature classes on <body>. Legacy body classes and
// stored values remain supported while existing selectors migrate to tokens.

(function () {
    'use strict';

    const THEME_REGISTRY = Object.freeze({
        light: Object.freeze({
            id: 'light',
            legacyClass: 'light-theme',
            label: 'Light',
            iconClass: 'fa-solid fa-sun',
            next: 'dark',
        }),
        dark: Object.freeze({
            id: 'dark',
            legacyClass: 'dark-theme',
            label: 'Dark',
            iconClass: 'fa-solid fa-moon',
            next: 'light',
        }),
    });

    const THEME_ALIASES = Object.freeze(Object.values(THEME_REGISTRY).reduce((aliases, theme) => {
        aliases[theme.id] = theme.id;
        aliases[theme.legacyClass] = theme.id;
        return aliases;
    }, Object.create(null)));
    const LEGACY_THEME_CLASSES = Object.freeze(
        Object.values(THEME_REGISTRY).map((theme) => theme.legacyClass)
    );

    // Exposed for theme pickers and future themes without duplicating labels,
    // icons, legacy-class mappings, or traversal order elsewhere in the app.
    window.SURRICULUM_THEMES = THEME_REGISTRY;

    function normalizeTheme(value) {
        const key = String(value == null ? '' : value).trim();
        return Object.prototype.hasOwnProperty.call(THEME_ALIASES, key)
            ? THEME_ALIASES[key]
            : '';
    }

    function preferredThemeId(mediaQuery) {
        return mediaQuery && mediaQuery.matches ? 'dark' : 'light';
    }

    function initTheme() {
        const preferences = window.preferenceStorage;
        const mediaQuery = window.matchMedia
            ? window.matchMedia('(prefers-color-scheme: dark)')
            : null;

        const readStoredTheme = () => {
            try {
                return preferences && typeof preferences.getItem === 'function'
                    ? preferences.getItem('theme')
                    : null;
            } catch (_) {
                return null;
            }
        };

        const storedThemeId = () => normalizeTheme(readStoredTheme());

        function currentThemeId() {
            const rootTheme = normalizeTheme(document.documentElement.dataset.theme);
            if (rootTheme) return rootTheme;

            if (document.body) {
                for (const theme of Object.values(THEME_REGISTRY)) {
                    if (document.body.classList.contains(theme.legacyClass)) return theme.id;
                }
            }
            return 'light';
        }

        function updateThemeButton(themeId) {
            const theme = THEME_REGISTRY[themeId];
            const nextTheme = theme && THEME_REGISTRY[theme.next];
            const themeButton = document.getElementById('themeToggle');
            if (!themeButton || !nextTheme) return;

            themeButton.innerHTML = `<i class="${nextTheme.iconClass}"></i>&nbsp;${nextTheme.label}`;
            themeButton.dataset.nextTheme = nextTheme.id;
            themeButton.setAttribute('aria-label', `Switch to ${nextTheme.label.toLowerCase()} theme`);
        }

        function applyTheme(value, persist) {
            const themeId = normalizeTheme(value) || 'light';
            const theme = THEME_REGISTRY[themeId];

            document.documentElement.dataset.theme = theme.id;
            if (document.body) {
                document.body.classList.remove(...LEGACY_THEME_CLASSES);
                document.body.classList.add(theme.legacyClass);
            }
            updateThemeButton(theme.id);

            if (persist) {
                try {
                    if (preferences && typeof preferences.setItem === 'function') {
                        preferences.setItem('theme', theme.id);
                    }
                } catch (_) {}
            }

            document.dispatchEvent(new CustomEvent('themeChanged', {
                bubbles: true,
                detail: {
                    theme: theme.id,
                },
            }));
            return theme.id;
        }

        const initialStoredTheme = storedThemeId();
        applyTheme(initialStoredTheme || preferredThemeId(mediaQuery), false);

        // Follow system preference changes only while no valid manual choice is
        // stored. Invalid or stale values are deliberately treated as unset.
        if (mediaQuery) {
            const updateFromSystem = (event) => {
                if (!storedThemeId()) {
                    applyTheme(event.matches ? 'dark' : 'light', false);
                }
            };

            if (typeof mediaQuery.addEventListener === 'function') {
                mediaQuery.addEventListener('change', updateFromSystem);
            } else if (typeof mediaQuery.addListener === 'function') {
                mediaQuery.addListener(updateFromSystem);
            }
        }

        const themeButton = document.getElementById('themeToggle');
        if (themeButton) {
            themeButton.addEventListener('click', () => {
                const current = THEME_REGISTRY[currentThemeId()] || THEME_REGISTRY.light;
                const next = THEME_REGISTRY[current.next] || THEME_REGISTRY.light;
                applyTheme(next.id, true);
            });
        }

        window.surriculumTheme = Object.freeze({
            registry: THEME_REGISTRY,
            normalize: normalizeTheme,
            current: currentThemeId,
            apply: (value, persist = false) => applyTheme(value, !!persist),
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initTheme, { once: true });
    } else {
        initTheme();
    }
})();
