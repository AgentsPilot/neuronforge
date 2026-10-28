/**
 * The first plan payments the admin Finance page needs, in the CURRENT Stripe
 * mode: "Converted this month" (Money MK-5b; KPI restructure review §5.1,
 * Q-12 / G-1, SA-10, BD-37) and MK-9's trial-to-paid "Paid" (SA-Q-MK9-1,
 * option 1). One rule for both: the view `business_os_first_plan_payments`.
 *
 * MK5B-FU-1 (SA-WP-M5F): two BOUNDED questions instead of "every plan-row
 * account's whole history":
 *   - `firstPaymentIn` (Q1): every account whose first payment falls in that
 *     range (the caller passes this UTC month, all businesses only). A
 *     cross-account read (M5F-C5).
 *   - `accountIds` (Q2): the first payment of exactly these accounts (the
 *     trials MK-9 looks up, or the one business picked).
 * The two answers are joined by account. They come from the same view, so an
 * account in both has the same date; a difference is an ERROR, never a guess.
 * Either part failing fails the whole read (M5F-7): the figures that share it
 * are Unknown together, as before.
 *
 * Why here: the finance tree may never name the Stripe mode (finance source
 * guard, BD-14), so the mode is decided here, once, as for R4 and MK-4, and the
 * finance wiring (`financeHealthDeps.ts`) calls this function by its own name.
 * The mode never travels on: the result is the account and the date only.
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

/** What the caller asks: accounts by id, and/or every account whose first payment is in a range. */
export interface FirstPlanPaymentsQuery {
  accountIds: readonly string[];
  /** Half-open ISO range, or null for "by id only" (one business picked). */
  firstPaymentIn: { from: string; to: string } | null;
}

export interface FirstPlanPaymentsDeps {
  reader?: Pick<BusinessOsBillingAdminReadRepository, 'listFirstPlanPaymentsForAccounts' | 'listFirstPlanPaymentsInRangeAllAccounts'>;
  mode?: () => StripeMode;
}

type Result = { data: FirstPlanPayment[] | null; error: Error | null };

/** The first plan payments asked for, current mode only. */
export async function listCurrentModeFirstPlanPayments(query: FirstPlanPaymentsQuery, deps: FirstPlanPaymentsDeps = {}): Promise<Result> {
  let livemode: boolean;
  try {
    livemode = isLiveMode((deps.mode ?? currentStripeMode)());
  } catch (error) {
    return { data: null, error: error instanceof Error ? error : new Error(String(error)) };
  }
  const reader = deps.reader ?? businessOsBillingAdminReadRepository;

  const parts: Array<Array<{ user_id: string; paid_at: string }>> = [];
  if (query.firstPaymentIn !== null) {
    const inRange = await reader.listFirstPlanPaymentsInRangeAllAccounts(query.firstPaymentIn, livemode);
    if (inRange.error || !inRange.data) return { data: null, error: inRange.error ?? new Error('First plan payment range read returned no data') };
    parts.push(inRange.data);
  }
  if (query.accountIds.length > 0) {
    const byId = await reader.listFirstPlanPaymentsForAccounts(query.accountIds, livemode);
    if (byId.error || !byId.data) return { data: null, error: byId.error ?? new Error('First plan payment read returned no data') };
    parts.push(byId.data);
  }

  const joined = new Map<string, string>();
  for (const part of parts) {
    for (const row of part) {
      const seen = joined.get(row.user_id);
      if (seen !== undefined && Date.parse(seen) !== Date.parse(row.paid_at)) {
        return { data: null, error: new Error('The two first plan payment reads disagree for one account') };
      }
      if (seen === undefined) joined.set(row.user_id, row.paid_at);
    }
  }
  // Field by field: only the account and the date cross this line. Sorted by account, as MK-5b's read was.
  const rows = [...joined.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([user_id, paid_at]) => ({ user_id, paid_at }));
  return { data: rows.map((row) => ({ accountId: row.user_id, paidAt: row.paid_at })), error: null };
}
