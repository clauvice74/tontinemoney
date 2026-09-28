'use client';

import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import {
  LOCALE_COOKIE,
  type Locale,
  THEME_COOKIE,
  type ThemePreference,
  writePreferenceCookie,
} from './config';
import { en } from './en';
import { type Dictionary, fr } from './fr';

export { LOCALES, THEMES, type Locale, type ThemePreference } from './config';
export type { Dictionary } from './fr';

const DICTIONARIES: Record<Locale, Dictionary> = { fr, en };

/** Clés « a.b.c » des chaînes du dictionnaire. */
type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];
export type MessageKey = Leaves<Dictionary>;

export function translate(
  dict: Dictionary,
  key: MessageKey,
  vars?: Record<string, string | number>,
): string {
  let node: unknown = dict;
  for (const part of key.split('.')) node = (node as Record<string, unknown>)?.[part];
  const text = typeof node === 'string' ? node : key;
  return vars ? text.replace(/\{(\w+)\}/g, (m, k: string) => String(vars[k] ?? m)) : text;
}

interface I18nValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  theme: ThemePreference;
  setTheme: (t: ThemePreference) => void;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  /** Locale Intl complète (formats de dates et montants). */
  intlLocale: string;
}

const I18nContext = createContext<I18nValue | null>(null);

function applyTheme(theme: ThemePreference) {
  const html = document.documentElement;
  if (theme === 'system') html.removeAttribute('data-theme');
  else html.setAttribute('data-theme', theme);
}

export function I18nProvider({
  initialLocale,
  initialTheme,
  children,
}: {
  initialLocale: Locale;
  initialTheme: ThemePreference;
  children: ReactNode;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const [theme, setThemeState] = useState<ThemePreference>(initialTheme);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    writePreferenceCookie(LOCALE_COOKIE, l);
    document.documentElement.lang = l;
  }, []);

  const setTheme = useCallback((t: ThemePreference) => {
    setThemeState(t);
    writePreferenceCookie(THEME_COOKIE, t);
    applyTheme(t);
  }, []);

  const value = useMemo<I18nValue>(() => {
    const dict = DICTIONARIES[locale];
    return {
      locale,
      setLocale,
      theme,
      setTheme,
      t: (key, vars) => translate(dict, key, vars),
      intlLocale: locale === 'en' ? 'en-GB' : 'fr-FR',
    };
  }, [locale, setLocale, theme, setTheme]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n : I18nProvider absent');
  return ctx;
}
