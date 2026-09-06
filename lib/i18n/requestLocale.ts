/**
 * The visitor's language, when we do not know whose page they wanted.
 *
 * Public pages normally speak the BUSINESS's language, which is the right
 * default — a client of an Israeli clinic should read Hebrew whatever their
 * phone is set to. But a 404 means we could not work out which business the
 * link belonged to, so there is no business language to use, and falling back
 * to English for everyone leaves a Hebrew-speaking client reading an error
 * message they cannot act on.
 *
 * `Accept-Language` is the only signal available at that point.
 *
 * @module lib/i18n/requestLocale
 */

import { headers } from 'next/headers';

import { isValidLocale, defaultLocale, type Locale } from '@/lib/i18n/config';

/** The best supported match for the visitor's `Accept-Language`. */
export async function getRequestLocale(): Promise<Locale> {
  try {
    const header = (await headers()).get('accept-language');
    if (!header) return defaultLocale;

    // `he-IL,he;q=0.9,en-US;q=0.8` — take the tags in the order offered and
    // return the first one the platform actually speaks.
    for (const part of header.split(',')) {
      const tag = part.split(';')[0]?.trim().split('-')[0]?.toLowerCase();
      if (tag && isValidLocale(tag)) return tag;
    }
  } catch {
    // `headers()` is unavailable in a statically rendered context. English is
    // the right answer there, not a crash.
  }

  return defaultLocale;
}
