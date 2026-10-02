/**
 * The credit history's server-side switch (credit deduction slice 7a; parked
 * by the user's decision of 2026-10-02 — shipped dark behind a flag).
 *
 * `GET /api/business-os/credits/history` asks this before anything else and
 * answers 404 while it is off. **Default: off** — unset, blank or anything
 * unrecognised.
 *
 * Its own read of the variable, on purpose: the client reader
 * `isBusinessOsCreditHistoryEnabled()` in `lib/utils/featureFlags.ts` decides
 * only what the card DRAWS, and that module imports the client logger. This
 * file imports only the zero-import `parseBooleanFlag`, so the route never
 * depends on the client bundle's graph. The access is the LITERAL
 * `process.env.NEXT_PUBLIC_BUSINESS_OS_CREDIT_HISTORY` (a computed key would be
 * invisible to Next's substitution).
 *
 * @module lib/business-os/credits/creditHistoryFlag
 */

import { parseBooleanFlag } from '@/lib/utils/parseBooleanFlag';

/** True when the credit history route may answer. Off by default. */
export function isCreditHistoryRouteEnabled(): boolean {
  return parseBooleanFlag(process.env.NEXT_PUBLIC_BUSINESS_OS_CREDIT_HISTORY, false);
}
