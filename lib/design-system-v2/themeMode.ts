// lib/design-system-v2/themeMode.ts

/**
 * The localStorage key holding the owner's light/dark choice.
 *
 * Shared by `V2ThemeProvider` (which reads and writes it) and `V2ThemeScript`
 * (which reads it before first paint), so the two can never look in different
 * places. The literal appears nowhere else (TH-1 guard G-4).
 */
export const V2_THEME_STORAGE_KEY = 'v2-theme-mode';
