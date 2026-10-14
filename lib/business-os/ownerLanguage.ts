// lib/business-os/ownerLanguage.ts

/**
 * The owner's interface language, shared by the server and the browser.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS MODULE EXISTS (performance business round, BR-1a)
 *
 * Three pieces have to agree on what a language is: the server helper that reads
 * the saved one (`readInitialLanguage`, `server-only`), the pre-paint script that
 * puts it on `<html>` (`OwnerDirScript`), and the client `LanguageProvider`. If
 * each kept its own list, one would eventually accept a value another rejects,
 * and the first frame would disagree with the language the page settles on.
 *
 * It has no imports on purpose: the client provider imports it, so it must not
 * pull anything server-side (`userLanguage.ts` reaches the repositories) into the
 * browser bundle.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const OWNER_LANGUAGES = ['en', 'es', 'he'] as const;

export type OwnerLanguage = (typeof OWNER_LANGUAGES)[number];

/**
 * Where the first-frame language came from.
 *
 *   saved    the owner's stored `user_preferences.preferred_language`
 *   none     read fine, nothing usable stored
 *   unknown  could not read (no session, a failed or throwing read)
 *
 * The client treats `none` and `unknown` the same way: start in English and let
 * this browser's last pick apply after mount, exactly as before BR-1a.
 */
export type OwnerLanguageSource = 'saved' | 'none' | 'unknown';

export interface InitialLanguage {
  language: OwnerLanguage;
  source: OwnerLanguageSource;
}

/** What a provider without a server-supplied language starts with: today's behaviour. */
export const INITIAL_LANGUAGE_DEFAULT: InitialLanguage = { language: 'en', source: 'none' };

/**
 * EXACT match, deliberately not `normalizeLanguage` (trim + lowercase).
 *
 * The client settles on a stored value only when it is exactly one of these
 * (`LanguageContext` mount effect). A normalising check here would draw `'HE'` as
 * Hebrew on the first frame while the client treats the same row as "nothing
 * saved" and backfills this browser's pick: two different answers for one row
 * (SA ruling M-6).
 */
export function isOwnerLanguage(value: unknown): value is OwnerLanguage {
  return typeof value === 'string' && (OWNER_LANGUAGES as readonly string[]).includes(value);
}

export function ownerDir(language: OwnerLanguage): 'rtl' | 'ltr' {
  return language === 'he' ? 'rtl' : 'ltr';
}
