// lib/business-os/data-export/ownerClock.ts
//
// The owner's clock for an export's file name and README (DE-4, user
// 2026-10-15). Moved out of app/api/user/data-export/route.ts by DE-8b
// (BUSINESS_OS_DATA_EXPORT_DE8B_WORKPLAN.md §4; SA Q-1: a pure move, the JSON
// route's characterization test is the proof) so the JSON route and the zip
// routes read the clock the same way.
//
// `user_preferences.timezone` is the authority (CLAUDE.md § Currency &
// Timezone; `business_profiles.timezone` does not exist). NULL (never set),
// blank, invalid or unreadable all give FALLBACK_TIMEZONE ('UTC'): the name is
// a label, so it never fails the export. The repository logs its own read
// error; this line says what the export did about it.
//
// Server-only: it imports a repository.

import 'server-only';
import { userPreferencesRepository } from '@/lib/repositories/UserPreferencesRepository';
import { FALLBACK_TIMEZONE, safeTimezone } from '@/lib/scheduling/businessTime';

/** Only the level ownerTimezone uses, typed structurally so the Pino child satisfies it. */
export interface WarnLogger {
  warn: (context: Record<string, unknown>, message: string) => void;
}

export async function ownerTimezone(userId: string, log: WarnLogger): Promise<string> {
  return (await ownerClock(userId, log)).timezone;
}

/**
 * The zone, and whether the owner set one (NULL means "not asked": the README
 * then says the times are UTC because none was set). An unreadable or invalid
 * zone reads as not set.
 */
export async function ownerClock(userId: string, log: WarnLogger): Promise<{ timezone: string; isSet: boolean }> {
  try {
    const { data, error } = await userPreferencesRepository.findTimezone(userId);
    if (error) {
      log.warn({ userId }, 'Data export: timezone unreadable, file name in UTC');
      return { timezone: FALLBACK_TIMEZONE, isSet: false };
    }
    const timezone = safeTimezone(data);
    // `safeTimezone` only falls back for a missing or invalid zone; 'UTC' chosen on purpose is set.
    const isSet = typeof data === 'string' && data.trim() !== '' && (timezone !== FALLBACK_TIMEZONE || data.trim() === FALLBACK_TIMEZONE);
    return { timezone, isSet };
  } catch (err) {
    // findTimezone never throws by contract; a throw must still not fail the export.
    log.warn({ err, userId }, 'Data export: timezone unreadable, file name in UTC');
    return { timezone: FALLBACK_TIMEZONE, isSet: false };
  }
}
