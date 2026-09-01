/**
 * Which language to write to a user in, resolved from what the database knows.
 *
 * Server-side features — insight copy, emails — cannot read the interface
 * language, so they ask the database. Two columns hold it and they are not
 * equally trustworthy:
 *
 *   business_profiles.language        written by onboarding, and again whenever
 *                                     the user picks a language. Never touched
 *                                     by anything else.
 *
 *   user_preferences.preferred_language
 *                                     written by the same language picker — but
 *                                     the row is also created as a side effect
 *                                     of saving a timezone, which supplies no
 *                                     language at all and leaves the column on
 *                                     its `en` default.
 *
 * That side effect is how a Hebrew business ended up generating English
 * insights while its own profile said `he`: a defaulted preference outranked a
 * language somebody had actually chosen. The profile is preferred here for that
 * reason, and the resolution reports which column it believed so a wrong
 * language is traceable from the logs rather than guessed at.
 */

export const SUPPORTED_LANGUAGES = ['en', 'es', 'he'] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

export const DEFAULT_LANGUAGE: SupportedLanguage = 'en';

/** Where the answer came from. Logged at generation. */
export type LanguageSource = 'business_profiles' | 'user_preferences' | 'default';

export interface ResolvedLanguage {
  language: SupportedLanguage;
  source: LanguageSource;
}

/**
 * A stored value only counts if it names a language this product speaks.
 *
 * Blank strings and unknown codes are treated as absent rather than passed
 * through: an unrecognised code reaching the LLM prompt would ask it to write
 * in a language nobody selected, and reaching the template lookup would miss
 * every key and fall back to English anyway.
 */
export function normalizeLanguage(value: string | null | undefined): SupportedLanguage | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  return (SUPPORTED_LANGUAGES as readonly string[]).includes(trimmed)
    ? (trimmed as SupportedLanguage)
    : null;
}

export function resolveUserLanguage(input: {
  /** business_profiles.language */
  profileLanguage?: string | null;
  /** user_preferences.preferred_language */
  preferredLanguage?: string | null;
}): ResolvedLanguage {
  const profile = normalizeLanguage(input.profileLanguage);
  if (profile) return { language: profile, source: 'business_profiles' };

  const preferred = normalizeLanguage(input.preferredLanguage);
  if (preferred) return { language: preferred, source: 'user_preferences' };

  return { language: DEFAULT_LANGUAGE, source: 'default' };
}
