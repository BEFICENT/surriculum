// Theme management for SUrriculum
document.addEventListener('DOMContentLoaded', function() {
    // Get the current theme from localStorage or default to 'light-theme'
    const currentTheme = localStorage.getItem('theme') || 'light-theme';

    // Apply the theme to the body
    document.body.className = currentTheme;

    // Function to toggle theme
    function toggleTheme() {
        const body = document.body;
        const currentTheme = body.className;
        const newTheme = currentTheme === 'light-theme' ? 'dark-theme' : 'light-theme';

        body.className = newTheme;
        localStorage.setItem('theme', newTheme);

        // Update button text
        const themeButton = document.getElementById('themeToggle');
        if (themeButton) {
            themeButton.innerHTML = newTheme === 'dark-theme' ? '☀️ Light' : '🌙 Dark';
        }

        // Dispatch custom event for theme change
        window.dispatchEvent(new CustomEvent('themeChanged', {
            detail: { theme: newTheme }
        }));
    }

    // Connect theme button
    const themeButton = document.getElementById('themeToggle');
    if (themeButton) {
        // Set initial button text
        themeButton.innerHTML = currentTheme === 'dark-theme' ? '☀️ Light' : '🌙 Dark';

        // Add click handler
        themeButton.addEventListener('click', toggleTheme);
    }

    // Listen for theme changes from other scripts
    window.addEventListener('themeChanged', function(event) {
        console.log('Theme changed to:', event.detail.theme);
    });
});
