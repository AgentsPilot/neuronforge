/**
 * The server switch for the upgrade modal demo page (TEST ONLY, upgrade modal
 * UM-2, docs/workplans/BUSINESS_OS_UPGRADE_MODAL_UM2_WORKPLAN.md §7, SA X-1).
 *
 * While it is off, `/business-os/upgrade-modal-demo` answers 404 (`notFound()`
 * before anything renders).
 *
 * **Default: off** (unset, blank or anything unrecognised). Set only in a
 * developer's `.env.local`, never on Vercel. A "not production" check is not
 * used instead: the developer environment points at the one live database.
 *
 * Server-only: no `NEXT_PUBLIC_` prefix, so the client bundle carries no switch
 * logic. Read on every request. Imports only the zero-import flag parser (the
 * `testCreditToolsFlag.ts` precedent). Pinned by
 * `app/business-os/upgrade-modal-demo/__tests__/upgradeModalDemo.guard.test.ts`.
 *
 * TEST ONLY: remove with the demo, at the latest when UM-F2 wires a real caller.
 *
 * @module lib/business-os/upgradeModalDemoFlag
 */

import { parseBooleanFlag } from '@/lib/utils/parseBooleanFlag';

/** True when the upgrade modal demo page may render. Off by default. */
export function isUpgradeModalDemoEnabled(): boolean {
  return parseBooleanFlag(process.env.BUSINESS_OS_UPGRADE_MODAL_DEMO_ENABLED, false);
}
