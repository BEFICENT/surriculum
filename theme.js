// Theme management for SUrriculum
// Detect the user's preferred color scheme on first load and persist
// manual selections across sessions. Works on desktop and mobile browsers.

document.addEventListener('DOMContentLoaded', function () {
    const preferences = window.preferenceStorage;
    const readTheme = () => {
        try {
            return preferences && typeof preferences.getItem === 'function'
                ? preferences.getItem('theme')
                : null;
        } catch (_) {
            return null;
        }
    };
    const storedTheme = readTheme();
    const mediaQuery = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

    // Apply the theme to the document and optionally persist it
    function applyTheme(theme, persist) {
        document.body.className = theme;

        const themeButton = document.getElementById('themeToggle');
        if (themeButton) {
            themeButton.innerHTML = theme === 'dark-theme' ? '<i class="fa-solid fa-sun"></i>&nbsp;Light' : '<i class="fa-solid fa-moon"></i>&nbsp;Dark';
        }

        if (persist) {
            try {
                if (preferences && typeof preferences.setItem === 'function') {
                    preferences.setItem('theme', theme);
                }
            } catch (_) {}
        }

        window.dispatchEvent(new CustomEvent('themeChanged', {
            detail: { theme: theme }
        }));
    }

    // Initial theme selection
    if (storedTheme) {
        applyTheme(storedTheme, false);
    } else {
        const preferred = mediaQuery && mediaQuery.matches ? 'dark-theme' : 'light-theme';
        applyTheme(preferred, false);

        // Update automatically if the system preference changes and the
        // user has not chosen a theme yet.
        if (mediaQuery) {
            const updateFromSystem = function (e) {
                if (!readTheme()) {
                    applyTheme(e.matches ? 'dark-theme' : 'light-theme', false);
                }
            };

            if (typeof mediaQuery.addEventListener === 'function') {
                mediaQuery.addEventListener('change', updateFromSystem);
            } else if (typeof mediaQuery.addListener === 'function') {
                mediaQuery.addListener(updateFromSystem);
            }
        }
    }

    // Toggle theme on button click and persist user choice
    const themeButton = document.getElementById('themeToggle');
    if (themeButton) {
        themeButton.addEventListener('click', function () {
            const current = document.body.className;
            const next = current === 'light-theme' ? 'dark-theme' : 'light-theme';
            applyTheme(next, true);
        });
    }
});

