"use client";

const THEME_STORAGE_KEY = "humanctl-theme";

export function ThemeToggle() {
  return (
    <button
      aria-label="Toggle light and dark mode"
      className="theme-toggle"
      onClick={() => {
        const nextTheme = document.documentElement.dataset.theme === "light" ? "dark" : "light";

        document.documentElement.dataset.theme = nextTheme;
        document.documentElement.style.colorScheme = nextTheme;

        try {
          window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
        } catch {}
      }}
      type="button"
    >
      <span className="theme-toggle-label" aria-hidden="true">
        <span className="theme-toggle-mode theme-toggle-mode-dark">dark</span>
        <span className="theme-toggle-mode theme-toggle-mode-light">light</span>
      </span>
      <span aria-hidden="true" className="theme-toggle-track">
        <span className="theme-toggle-thumb" />
      </span>
    </button>
  );
}
