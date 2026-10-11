/**
 * The server switch for the harness's test credit tools (TEST ONLY, slice TC-1,
 * docs/requirements/BUSINESS_OS_TEST_TAKE_CREDITS_REQUIREMENT.md, TC-3).
 *
 * While it is off, `POST /api/admin/business-os/test/take-credits` answers 404
 * `not_enabled` and reads nothing after the admin gate.
 *
 * **Default: off** (unset, blank or anything unrecognised). Set only in a
 * developer's `.env.local`, never on Vercel. A "not production" check is not
 * used instead: the developer environment points at the one live database.
 *
 * Server-only: no `NEXT_PUBLIC_` prefix. Read on every call. Imports only the
 * zero-import flag parser (the `planCheckoutFlag.ts` precedent).
 *
 * TEST ONLY: remove with the harness tab.
 *
 * @module lib/business-os/credits/testCreditToolsFlag
 */

import { parseBooleanFlag } from '@/lib/utils/parseBooleanFlag';

/** True when the harness may take credits from an account. Off by default. */
export function isTestCreditToolsEnabled(): boolean {
  return parseBooleanFlag(process.env.BUSINESS_OS_TEST_CREDIT_TOOLS_ENABLED, false);
}
