// lib/repositories/UserPreferencesRepository.ts
// Read access to `user_preferences` (Business OS invite-only signup, Slice 2a;
// requirement C-8 as amended, T-12; workplan D-8).
//
// `user_preferences` has no DDL in this repo: it was created in the Supabase
// dashboard. Its shape here comes from the live readers and writers (one row
// per user, written with `upsert(..., { onConflict: 'user_id' })`), recorded in
// the Slice 2 workplan §10.3 (R-11). Several services still read the table
// directly (`BookingEmailService`, `DailyBriefingDispatchService`,
// `InvoiceDeliveryService`, `LeadAlertService`, `InsightRepository`); they are
// not moved here by this slice.
//
// SERVICE-ROLE CLIENT, scoped by `user_id` (CLAUDE.md rules 1 and 4). The only
// caller today is the admin invite form, which reads the signed-in admin's OWN
// preference to pre-select the invitee language. Every query filters on the
// `user_id` it is given; nothing here reads another user by omission.
//
// Read-only on purpose: the language picker (`LanguageContext`) owns the
// writes, and a second writer would be a second place the "both columns
// together" rule lives (see `lib/business-os/userLanguage.ts`).
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
   * The business's own clock, or `null` when nothing usable is stored.
   *
   * `user_preferences.timezone` is the authority for every hour the platform
   * shows a client (CLAUDE.md § Currency & Timezone;
   * `business_profiles.timezone` does not exist). Every caller so far has read
   * it inline — eight routes do — and the one that forgot stamped bookings with
   * an empty zone, so the same appointment read 12:00 AM in the drawer, 4:00 AM
   * in the email and 7:00 AM where the work happens.
   *
   * `null` is "not asked", kept distinguishable from a stored `'UTC'`, which is
   * a choice somebody made. Validate it with `safeTimezone` before formatting:
   * a stored zone can be an old IANA name or a hand-edited row.
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
}

export const userPreferencesRepository = new UserPreferencesRepository();
