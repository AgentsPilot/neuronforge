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
// reads and writes the session user's own row for `LanguageContext`. Every
// query filters on the `user_id` it is given; nothing here reads another user
// by omission.
//
// One writer: `upsertPreferredLanguage`, called only by
// `PATCH /api/business-os/preferences`, which writes it together with
// `business_profiles.language`. Keep it the only one, or the "both columns
// together" rule (see `lib/business-os/userLanguage.ts`) gets a second home.
//
// `findTimezone` was added for the package-acceptance wire, which creates
// bookings off-request and so has no browser zone to fall back on.
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
