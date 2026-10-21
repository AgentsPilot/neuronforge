/**
 * The first plan payment of each given account, in the CURRENT Stripe mode,
 * for the admin Finance "Converted this month" figure and list (Money MK-5b;
 * KPI restructure review §5.1, Q-12 / G-1, SA-10, BD-37).
 *
 * Why here: the finance tree may never name the Stripe mode (finance source
 * guard, BD-14), so the mode is decided here, as for R4 and MK-4, and the
 * finance wiring (`financeHealthDeps.ts`) calls this function by its own name.
 * The mode never travels on: the result is the account and the date only.
 *
 * Reads: `BusinessOsBillingAdminReadRepository.listFirstPlanPaymentsForAccounts`
 * (chunked at 100 ids, paged at 1,000 rows, the ceiling an error). It reads
 * exactly the ids it is given.
 *
 * Fails closed, never throws: an unknown or missing key mode returns an error
 * and reads nothing; a read error is passed on.
 *
 * Server-only: the reader holds the service-role client. The one caller is the
 * finance wiring, reached only from the admin finance route after `requireAdmin`.
 *
 * @module lib/admin/billing/firstPlanPayments
 */

import 'server-only';

import {
  businessOsBillingAdminReadRepository,
  type BusinessOsBillingAdminReadRepository,
} from '@/lib/repositories/BusinessOsBillingAdminReadRepository';
import { currentStripeMode, isLiveMode, type StripeMode } from '@/lib/business-os/billing/stripeMode';

/** One account's first plan payment above zero in the current mode. */
export interface FirstPlanPayment {
  accountId: string;
  /** ISO timestamptz. */
  paidAt: string;
}

export interface FirstPlanPaymentsDeps {
  reader?: Pick<BusinessOsBillingAdminReadRepository, 'listFirstPlanPaymentsForAccounts'>;
  mode?: () => StripeMode;
}

/** The first plan payment of each of `accountIds` that has one, current mode only. */
export async function listCurrentModeFirstPlanPayments(
  accountIds: readonly string[],
  deps: FirstPlanPaymentsDeps = {}
): Promise<{ data: FirstPlanPayment[] | null; error: Error | null }> {
  let livemode: boolean;
  try {
    livemode = isLiveMode((deps.mode ?? currentStripeMode)());
  } catch (error) {
    return { data: null, error: error instanceof Error ? error : new Error(String(error)) };
  }
  const reader = deps.reader ?? businessOsBillingAdminReadRepository;
  const result = await reader.listFirstPlanPaymentsForAccounts(accountIds, livemode);
  if (result.error || !result.data) return { data: null, error: result.error ?? new Error('First plan payment read returned no data') };
  // Field by field: only the account and the date cross this line.
  return { data: result.data.map((row) => ({ accountId: row.user_id, paidAt: row.paid_at })), error: null };
}
