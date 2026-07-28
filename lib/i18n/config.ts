/**
 * i18n Configuration for AI Business OS
 * Supports English, Spanish, and Hebrew (with RTL)
 */

export const locales = ['en', 'es', 'he'] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'en';

export const localeNames: Record<Locale, string> = {
  en: 'English',
  es: 'Español',
  he: 'עברית'
};

export const localeFlags: Record<Locale, string> = {
  en: '🇺🇸',
  es: '🇪🇸',
  he: '🇮🇱'
};

/**
 * Check if a locale uses RTL (right-to-left) text direction
 */
export function isRTL(locale: Locale): boolean {
  return locale === 'he';
}

/**
 * Get text direction for a locale
 */
export function getDirection(locale: Locale): 'ltr' | 'rtl' {
  return isRTL(locale) ? 'rtl' : 'ltr';
}

/**
 * Validate if a string is a supported locale
 */
export function isValidLocale(locale: string): locale is Locale {
  return locales.includes(locale as Locale);
}

/**
 * Get locale from navigator language or default
 */
export function getDefaultLocaleFromBrowser(): Locale {
  if (typeof window === 'undefined') return defaultLocale;

  const browserLang = navigator.language.split('-')[0];
  return isValidLocale(browserLang) ? browserLang : defaultLocale;
}
