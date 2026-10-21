import 'server-only';

/**
 * MRR now for the admin Finance payload (Money MK-4; KPI restructure review
 * SA-2, SA-4, BD-37, BQ-P8a-4).
 *
 * WHY HERE: the Finance tree may never name the Stripe mode (finance source
 * guard, BD-14) and the billing module may not read data (routerPlacement,
 * R4 lesson). `lib/admin/billing` is where the mode is decided and the
 * one-mode rows are read, as for the Subscriptions page and R4.
 *
 * ONE RULE, ONE FIGURE: the MRR is `subscriptionsMrr` (the Subscriptions
 * list's own function: the current-mode rows with a status, `computeMrr`,
 * the catalog price), so Finance and the list show the same MRR for the same
 * rows by construction.
 *
 * READS: no new repository method. All businesses: `listBillingRowsForModeAllAccounts`
 * (keyset ≤ 1,000 per request, the ceiling is an error). One business:
 * `findBillingRowForAccount`. The payload carries the mode as a VALUE only.
 *
 * FAILS CLOSED, NEVER THROWS: an unknown key mode or a failed read gives
 * `status: 'unknown'` and no figure; the rest of the Finance payload is
 * unaffected.
 *
 * Server-only: the reader holds the service-role client. The one caller is
 * the admin finance route, after `requireAdmin`.
 *
 * @module lib/admin/billing/financeMrr
 */

import {
  businessOsBillingAdminReadRepository,
  type AdminBillingRow,
  type BusinessOsBillingAdminReadRepository,
} from '@/lib/repositories/BusinessOsBillingAdminReadRepository';
import { getEntitlementConfig, type EntitlementConfig } from '@/lib/business-os/entitlements/source';
import { currentStripeMode, type StripeMode } from '@/lib/business-os/billing/stripeMode';
import type { FinanceMrrSection } from '@/lib/business-os/finance/financeTypes';
import { createLogger } from '@/lib/logger';
import { subscriptionsMrr } from './subscriptionsView';

const logger = createLogger({ module: 'AdminFinanceMrr' });

export interface FinanceMrrRead {
  /** The mode the MRR was read in; null when the key's mode could not be read. */
  stripeMode: StripeMode | null;
  mrr: FinanceMrrSection;
}

/** For tests; production uses P-8a's reader, the server key and the entitlement config. */
export interface FinanceMrrDeps {
  reader?: Pick<BusinessOsBillingAdminReadRepository, 'listBillingRowsForModeAllAccounts' | 'findBillingRowForAccount'>;
  mode?: () => StripeMode;
  config?: () => EntitlementConfig;
}

/** No figure: the mode or a read failed. Counts at 0 are never shown as figures (status says unknown). */
const UNKNOWN_MRR: FinanceMrrSection = { status: 'unknown', lines: [], unpriced: 0, discountUnknown: 0, pastDueCounted: true };

async function rowsFor(
  accountId: string | null,
  mode: StripeMode,
  reader: NonNullable<FinanceMrrDeps['reader']>
): Promise<AdminBillingRow[] | null> {
  const livemode = mode === 'live';
  if (accountId === null) {
    const all = await reader.listBillingRowsForModeAllAccounts(livemode);
    return all.error || !all.data ? null : all.data;
  }
  const one = await reader.findBillingRowForAccount(accountId, livemode);
  if (one.error) return null;
  return one.data ? [one.data] : [];
}

/** MRR now: all businesses (`accountId` null) or the picked one. */
export async function readFinanceMrr(accountId: string | null, deps: FinanceMrrDeps = {}): Promise<FinanceMrrRead> {
  let mode: StripeMode;
  try {
    mode = (deps.mode ?? currentStripeMode)();
  } catch (err) {
    logger.warn({ err, reason: 'stripe_mode_unknown' }, 'Finance MRR not read: Stripe key mode unknown');
    return { stripeMode: null, mrr: UNKNOWN_MRR };
  }
  try {
    const rows = await rowsFor(accountId, mode, deps.reader ?? businessOsBillingAdminReadRepository);
    if (rows === null) {
      logger.warn({ mode, scope: accountId === null ? 'all' : 'one' }, 'Finance MRR not read: billing read failed');
      return { stripeMode: mode, mrr: UNKNOWN_MRR };
    }
    const result = subscriptionsMrr(rows, (deps.config ?? getEntitlementConfig)(), mode);
    return {
      stripeMode: mode,
      mrr: {
        status: 'ok',
        lines: result.lines.map((line) => ({
          currency: line.currency,
          totalHundredths: line.totalHundredths,
          cancellingHundredths: line.cancellingHundredths,
          pastDueHundredths: line.pastDueHundredths,
          subscriptions: line.subscriptions,
          overflow: line.overflow,
        })),
        unpriced: result.unpriced,
        discountUnknown: result.discountUnknown,
        pastDueCounted: result.pastDueCounted,
      },
    };
  } catch (err) {
    logger.error({ err, mode }, 'Finance MRR failed');
    return { stripeMode: mode, mrr: UNKNOWN_MRR };
  }
}
