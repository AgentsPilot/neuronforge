// lib/repositories/UserPreferencesRepository.ts
// Access to `user_preferences` (Business OS invite-only signup, Slice 2a;
// requirement C-8 as amended, T-12; workplan D-8; later the language picker).
//
// `user_preferences` has no DDL in this repo: it was created in the Supabase
// dashboard. Its shape here comes from the live readers and writers (one row
// per user, written with `upsert(..., { onConflict: 'user_id' })`), recorded in
// the Slice 2 workplan §10.3 (R-11). Several services still read the table
// directly (`BookingEmailService`, `DailyBriefingDispatchService`,
// `InvoiceDeliveryService`, `LeadAlertService`, `InsightRepository`); they are
// not moved here by this slice.
//
// SERVICE-ROLE CLIENT, scoped by `user_id` (CLAUDE.md rules 1 and 4). Callers:
// the admin invite form, which reads the signed-in admin's OWN preference to
// pre-select the invitee language, and `/api/business-os/preferences`, which
// reads and writes the session user's own row for `LanguageContext` and the
// settings page's timezone save. Every
// query filters on the `user_id` it is given; nothing here reads another user
// by omission.
//
// Two writers in this repository, each with one caller,
// `PATCH /api/business-os/preferences`:
//
//   `upsertPreferredLanguage`  the language, always written together with
//                              `business_profiles.language` (`{ language }`).
//                              Keep it the only language writer, or the "both
//                              columns together" rule (see
//                              `lib/business-os/userLanguage.ts`) gets a second
//                              home.
//
//   `saveConfirmedTimezone`    the timezone and `timezone_confirmed_at`
//                              (`{ timezone }`, settings drawer D-1). UPDATE
//                              first, INSERT only when no row exists, never an
//                              upsert: an upsert would either overwrite an
//                              existing row's `preferred_language` (if sent) or
//                              create the row on the `en` default (if not). The
//                              language for a NEW row comes from the server
//                              (`business_profiles.language`), never from the
//                              browser.
//
// Known debt, not moved by D-1: `user_preferences.timezone` is still written
// directly, outside this repository, by `app/api/onboarding/build/route.ts`,
// `app/api/user/profile/route.ts`, `app/(protected)/settings/page.tsx` and
// `components/onboarding/hooks/useOnboarding.ts`.
//
// `findTimezone` was added for the package-acceptance wire, which creates
// bookings off-request and so has no browser zone to fall back on. It was
// lost once in a merge conflict with `findLocale` and restored (F-13): keep
// both when resolving a conflict here.
//
// Methods never throw: they return `{ data, error }`, with a database error
// reduced to `{ code, message }` before it is logged or returned (the invite
// repository's `safeDbError`, SA M-1).

import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, type Logger } from '@/lib/logger';
import { normalizeLanguage, type SupportedLanguage } from '@/lib/business-os/userLanguage';
import { safeDbError } from './BusinessOsInviteRepository';
import type { AgentRepositoryResult as RepositoryResult } from './types';

const USER_PREFERENCES = 'user_preferences';

export class UserPreferencesRepository {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(supabaseClient?: SupabaseClient) {
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'UserPreferencesRepository' });
  }

  /**
   * The user's saved language, normalised to one the product speaks, or `null`
   * when there is no row, the value is blank, or it names a language the
   * product does not speak.
   *
   * `null` is "nothing usable", never "English": the caller chooses the
   * fallback. Note the F-3 caveat in `userLanguage.ts`: a row created by a
   * timezone save carries the column's `en` default, so `en` here may not be a
   * choice anyone made. For a form pre-select that costs one click (SA F-3).
   */
  async findPreferredLanguage(userId: string): Promise<RepositoryResult<SupportedLanguage>> {
    const methodLogger = this.logger.child({ method: 'findPreferredLanguage', userId });
    try {
      const { data, error } = await this.supabase
        .from(USER_PREFERENCES)
        .select('preferred_language')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) throw error;
      const stored = (data as { preferred_language?: unknown } | null)?.preferred_language;
      return { data: normalizeLanguage(typeof stored === 'string' ? stored : null), error: null };
    } catch (error) {
      const safe = safeDbError(error);
      methodLogger.error({ dbError: safe }, 'Failed to read the preferred language');
      const out = new Error(safe.message) as Error & { code?: string };
      if (safe.code) out.code = safe.code;
      return { data: null, error: out };
    }
  }

  /**
   * The business's own clock, or `null` when nothing usable is stored.
   *
   * `user_preferences.timezone` is the authority for every hour the platform
   * shows a client (CLAUDE.md § Currency & Timezone;
   * `business_profiles.timezone` does not exist). The caller is package
   * acceptance, which runs on the client's click with no owner browser to
   * infer a zone from.
   *
   * `null` is "not asked", kept distinguishable from a stored `'UTC'`, which is
   * a choice somebody made — never default it here. Validate it with
   * `safeTimezone` before formatting: a stored zone can be an old IANA name or
   * a hand-edited row.
   *
   * Restored (F-13): the 2026-10-05 merge f66cae67 resolved a conflict with
   * `findLocale` by keeping one side's method and the other side's header
   * line, so this method vanished and package acceptance threw after the
   * proposal was already claimed.
   */
  async findTimezone(userId: string): Promise<RepositoryResult<string>> {
    const methodLogger = this.logger.child({ method: 'findTimezone', userId });
    try {
      const { data, error } = await this.supabase
        .from(USER_PREFERENCES)
        .select('timezone')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) throw error;
      const stored = (data as { timezone?: unknown } | null)?.timezone;
      const zone = typeof stored === 'string' ? stored.trim() : '';
      return { data: zone || null, error: null };
    } catch (error) {
      const safe = safeDbError(error);
      methodLogger.error({ dbError: safe }, 'Failed to read the timezone');
      const out = new Error(safe.message) as Error & { code?: string };
      if (safe.code) out.code = safe.code;
      return { data: null, error: out };
    }
  }

  /**
   * The stored language and timezone, raw, for the interface to apply.
   *
   * Unlike `findPreferredLanguage`, nothing is normalised: the client validates
   * both values itself (a language it speaks, a zone `Intl` accepts). No row is
   * `{ preferredLanguage: null, timezone: null }`, not an error.
   */
  async findLocale(
    userId: string
  ): Promise<RepositoryResult<{ preferredLanguage: string | null; timezone: string | null }>> {
    const methodLogger = this.logger.child({ method: 'findLocale', userId });
    try {
      const { data, error } = await this.supabase
        .from(USER_PREFERENCES)
        .select('preferred_language, timezone')
        .eq('user_id', userId)
        .maybeSingle();

      if (error) throw error;
      const row = data as { preferred_language?: unknown; timezone?: unknown } | null;
      return {
        data: {
          preferredLanguage: typeof row?.preferred_language === 'string' ? row.preferred_language : null,
          timezone: typeof row?.timezone === 'string' ? row.timezone : null,
        },
        error: null,
      };
    } catch (error) {
      const safe = safeDbError(error);
      methodLogger.error({ dbError: safe }, 'Failed to read the locale preferences');
      const out = new Error(safe.message) as Error & { code?: string };
      if (safe.code) out.code = safe.code;
      return { data: null, error: out };
    }
  }

  /**
   * Save the business timezone the owner just picked, and stamp that a human
   * answered (`timezone_confirmed_at`), creating the row only if there is none.
   *
   * The caller has already validated `zone` (`isValidTimezone`); it is written
   * exactly as given: no trim, no default. `null` ("not asked") is never
   * written here.
   *
   *   A. UPDATE the user's row (`{ count: 'exact' }`, no `.select()`: the
   *      PostgREST update + select 42703 hazard). `preferred_language` is not
   *      sent, so an existing row keeps its language.
   *   B. Count 0: INSERT a new row, with `languageForNewRow` when the caller
   *      has one (the business's language, resolved server-side) and otherwise
   *      no language at all, so the column default applies (logged).
   *   C. The insert hit `23505` (a concurrent save created the row first):
   *      the UPDATE once more. No second retry.
   *
   * A `null` count is treated as a failure, not as "no row" (SA Q-3): an
   * insert on an unknown count could race a real row. One `confirmedAt` stamp
   * is used for both `timezone_confirmed_at` and `updated_at`, and the caller
   * passes the same stamp to the `profiles` mirror. Never upserts, never throws.
   */
  async saveConfirmedTimezone(
    userId: string,
    zone: string,
    options: { languageForNewRow: SupportedLanguage | null; confirmedAt: string }
  ): Promise<RepositoryResult<true>> {
    const methodLogger = this.logger.child({ method: 'saveConfirmedTimezone', userId });
    const { languageForNewRow, confirmedAt } = options;
    const changes = { timezone: zone, timezone_confirmed_at: confirmedAt, updated_at: confirmedAt };

    const updateExisting = async (): Promise<number> => {
      const { error, count } = await this.supabase
        .from(USER_PREFERENCES)
        .update(changes, { count: 'exact' })
        .eq('user_id', userId);
      if (error) throw error;
      if (count === null || count === undefined) {
        throw Object.assign(new Error('Update count unavailable'), { code: 'COUNT_UNAVAILABLE' });
      }
      if (count > 1) {
        // The only production signal of duplicate rows for one user.
        methodLogger.warn({ count }, 'More than one preferences row updated for one user');
      }
      return count;
    };

    try {
      if ((await updateExisting()) >= 1) return { data: true, error: null };

      // `user_id` last, so nothing spread before it can replace it.
      const row = {
        ...changes,
        ...(languageForNewRow ? { preferred_language: languageForNewRow } : {}),
        user_id: userId,
      };
      const { error: insertError } = await this.supabase.from(USER_PREFERENCES).insert(row);

      if (!insertError) {
        if (!languageForNewRow) {
          methodLogger.warn('Created the preferences row without a language; the column default applies');
        }
        return { data: true, error: null };
      }

      if ((insertError as { code?: string }).code !== '23505') throw insertError;

      methodLogger.info('Preferences row created concurrently; updating it instead');
      if ((await updateExisting()) >= 1) return { data: true, error: null };
      throw Object.assign(new Error('No preferences row to update after a duplicate-key insert'), {
        code: 'NO_ROW_AFTER_RETRY',
      });
    } catch (error) {
      const safe = safeDbError(error);
      methodLogger.error({ dbError: safe }, 'Failed to save the timezone');
      const out = new Error(safe.message) as Error & { code?: string };
      if (safe.code) out.code = safe.code;
      return { data: null, error: out };
    }
  }

  /**
   * Save the user's language, creating the row if there is none.
   *
   * Callers must also write `business_profiles.language` in the same action
   * (see the header). Only `preferred_language` and `updated_at` are sent, so an
   * existing row's other columns, such as `timezone`, are left alone.
   */
  async upsertPreferredLanguage(
    userId: string,
    language: SupportedLanguage
  ): Promise<RepositoryResult<true>> {
    const methodLogger = this.logger.child({ method: 'upsertPreferredLanguage', userId });
    try {
      const { error } = await this.supabase
        .from(USER_PREFERENCES)
        .upsert(
          { user_id: userId, preferred_language: language, updated_at: new Date().toISOString() },
          { onConflict: 'user_id' }
        );

      if (error) throw error;
      return { data: true, error: null };
    } catch (error) {
      const safe = safeDbError(error);
      methodLogger.error({ dbError: safe }, 'Failed to save the preferred language');
      const out = new Error(safe.message) as Error & { code?: string };
      if (safe.code) out.code = safe.code;
      return { data: null, error: out };
    }
  }
}

export const userPreferencesRepository = new UserPreferencesRepository();
