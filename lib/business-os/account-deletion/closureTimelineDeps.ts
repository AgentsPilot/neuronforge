/**
 * The production ports of the pre-check's "What happens next" read (account
 * deletion lifecycle DL-2b; workplan
 * docs/workplans/BUSINESS_OS_DELETION_DL2_WORKPLAN.md §6.1, §11 "Shared
 * registry"; SA W-15).
 *
 * The ONLY file in DL-2b that imports from `lib/business-os/entitlements/`:
 * `readPlanEndingView` (what the account is on after its paid period) and
 * `resolveAccountId` (the account seam). It reads for DISPLAY only, refuses
 * nothing, writes nothing and calls no `check()` / `decide()`. Registered in
 * `KNOWN_NON_GATE_IMPORTERS` (enforcementPoints.test.ts). The deletion-check
 * route imports this file, never the module.
 *
 * What runs as the service role here, and why it is safe
 * (tenant-isolation-guard): the timezone and the bookings count are read
 * through their repositories on the service-role client. Both are READS, and
 * the one id they are ever given is the SESSION user the route read with
 * `readSessionSubject()`; nothing here takes a request value. Both
 * repository methods filter `user_id`. `lang` (the only request input,
 * Zod-checked) picks the plan name's language and nothing else.
 *
 * @module lib/business-os/account-deletion/closureTimelineDeps
 */

import 'server-only';

import { resolveAccountId } from '@/lib/business-os/entitlements/account';
import { readPlanEndingView } from '@/lib/business-os/entitlements/planEndingView';
import { isPlanPriceRecognitionEnabled } from '@/lib/business-os/billing/planPricesFlag';
import { schedulingBookingRepository } from '@/lib/repositories/SchedulingRepository';
import { userPreferencesRepository } from '@/lib/repositories/UserPreferencesRepository';
import type { ClosureTimelinePorts } from './closureTimeline';

export function closureTimelineDeps(): ClosureTimelinePorts {
  return {
    pricesEnabled: isPlanPriceRecognitionEnabled,
    readTimezone: async (userId) => {
      try {
        const read = await userPreferencesRepository.findTimezone(userId);
        return read.error ? { ok: false } : { ok: true, stored: read.data };
      } catch {
        return { ok: false };
      }
    },
    readPlanEnding: async ({ userId, endsAt, locale }) => {
      const view = await readPlanEndingView({ accountId: resolveAccountId(userId), endsAt, locale });
      if (!view) return null;
      return { kind: view.kind, planName: view.kind === 'unknown' ? null : view.planName };
    },
    countUpcomingBookings: (userId, fromIso) => schedulingBookingRepository.countUpcomingBookings(userId, fromIso),
  };
}
