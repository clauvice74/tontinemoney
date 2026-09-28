/** Langues et apparence : valeurs, cookies (lus côté serveur pour éviter tout flash). */
export const LOCALES = ['fr', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'fr';
export const LOCALE_COOKIE = 'tm_locale';

export const THEMES = ['system', 'light', 'dark'] as const;
export type ThemePreference = (typeof THEMES)[number];
export const THEME_COOKIE = 'tm_theme';

export function asLocale(v: string | undefined | null): Locale {
  return (LOCALES as readonly string[]).includes(v ?? '') ? (v as Locale) : DEFAULT_LOCALE;
}

export function asTheme(v: string | undefined | null): ThemePreference {
  return (THEMES as readonly string[]).includes(v ?? '') ? (v as ThemePreference) : 'system';
}

/** Écrit un cookie de préférence (1 an, tout le site, SameSite=Lax). */
export function writePreferenceCookie(name: string, value: string): void {
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=31536000; SameSite=Lax`;
}
