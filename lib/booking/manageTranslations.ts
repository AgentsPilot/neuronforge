/**
 * Compatibility shim over the public-pages catalogue.
 *
 * This module used to hold its own copy of the booking-management strings. It
 * was one of five tables covering overlapping copy across the public pages —
 * `questionsContact` alone existed in three of them — so they were merged into
 * `lib/i18n/public-pages`, which also carries the date, time and money
 * formatters that have to agree with them.
 *
 * The exports here are kept so callers can be migrated one at a time rather
 * than in a single sweep. Delete this file once nothing imports it.
 *
 * @deprecated Import from `@/lib/i18n/public-pages` instead.
 */

import {
  publicMessages,
  publicT,
  localeCode,
  timeZoneLabel as publicTimeZoneLabel,
  toLocale,
} from '@/lib/i18n/public-pages';

export type BookingLocale = 'en' | 'es' | 'he';

/** @deprecated Use `publicMessages`. */
export const bookingManageTranslations: Record<string, Record<string, string>> = publicMessages;

/** @deprecated Use `createPublicT(locale)`. */
export function bookingManageT(locale: string) {
  const resolved = toLocale(locale);
  return (key: string, params?: Record<string, string>): string =>
    publicT(resolved, key, params);
}

/** @deprecated Use `localeCode(locale)`. */
export function bookingLocaleCode(locale: string): string {
  return localeCode(toLocale(locale));
}

/** @deprecated Use `isRTL` from `@/lib/i18n/config`. */
export const isBookingRTL = (locale: string) => locale === 'he';

/** @deprecated Use `timeZoneLabel` from `@/lib/i18n/public-pages`. */
export function timeZoneLabel(timeZone: string, locale: string): string {
  return publicTimeZoneLabel(timeZone, toLocale(locale));
}
