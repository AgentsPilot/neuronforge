/**
 * The closure status route's production ports (account deletion lifecycle
 * DL-2a; workplan docs/workplans/BUSINESS_OS_DELETION_DL2_WORKPLAN.md §5.1).
 *
 * What runs as the service role here, and why it is safe
 * (tenant-isolation-guard): `business_os_account_closures` has no policy by
 * design, so only the service role reads it. This file READS only, and the
 * one id it is ever given is the SESSION user the route read with
 * `readSessionSubject()`; nothing here takes a request value. Both
 * repositories filter `user_id` on the methods called here. Allow-listed in
 * `accountClosureRepositories.callers.guard.test.ts`.
 *
 * @module lib/business-os/account-deletion/closureStatusDeps
 */

import 'server-only';

import { AccountClosureRepository } from '@/lib/repositories/AccountClosureRepository';
import { userPreferencesRepository } from '@/lib/repositories/UserPreferencesRepository';
import type { ClosureStatusRow, TimezoneRead } from './closureStatusView';

export interface ClosureStatusDeps {
  /** The session user's open closure, or null. A read error is `{ error }`. */
  readOpen: (userId: string) => Promise<{ data: ClosureStatusRow | null; error: Error | null }>;
  /** The session user's stored timezone; never throws. */
  readTimezone: (userId: string) => Promise<TimezoneRead>;
}

export function closureStatusDeps(): ClosureStatusDeps {
  const closures = new AccountClosureRepository();
  return {
    readOpen: async (userId) => {
      const read = await closures.findOpenForUser(userId);
      if (read.error) return { data: null, error: read.error };
      const row = read.data;
      if (!row || row.status === 'kept') return { data: null, error: null };
      return {
        data: {
          status: row.status,
          renewal_was_on: row.renewal_was_on,
          plan_ends_at: row.plan_ends_at,
          lock_at: row.lock_at,
          lock_timezone: row.lock_timezone,
        },
        error: null,
      };
    },
    readTimezone: async (userId) => {
      try {
        const read = await userPreferencesRepository.findTimezone(userId);
        return read.error ? { ok: false } : { ok: true, stored: read.data };
      } catch {
        return { ok: false };
      }
    },
  };
}
