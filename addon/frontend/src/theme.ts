export const THEMES = ["material-light", "ios-dark"] as const;

export type ThemeId = (typeof THEMES)[number];

const STORAGE_KEY = "heat-steward-theme";
const DEFAULT_THEME: ThemeId = "material-light";

function isTheme(value: string | null): value is ThemeId {
  return value !== null && THEMES.includes(value as ThemeId);
}

export function storedTheme(): ThemeId {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return isTheme(value) ? value : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

export function applyTheme(theme: ThemeId, persist = true): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme === "ios-dark" ? "dark" : "light";
  if (!persist) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Theme selection still applies when browser storage is unavailable.
  }
}

export function initializeTheme(): ThemeId {
  const theme = storedTheme();
  applyTheme(theme, false);
  return theme;
}
