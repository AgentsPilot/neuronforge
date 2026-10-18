import 'server-only';

/**
 * The admin Subscriptions page's production wiring (plan payments P-8a.1,
 * workplan §5.1 and §5.3; SA-WP-P8a P8A-R1 and P8A-R2).
 *
 * Every method it exposes is a READ:
 *   - the plan repository: `pagePlans` and nothing else (pinned by the RC-15
 *     guard), walked by the Finance page's own `walkPlans` (one walk, never a
 *     copy; at most 1,000 rows per request);
 *   - the admin billing read: one Stripe mode, all accounts (R-p);
 *   - the entitlement config, read once and passed to the pure builder.
 * Business names are not here: the route reads them through the admin-only
 * identity read, which may be called from `app/api/admin/**` only.
 *
 * Service role underneath (both repositories document it): an admin-only,
 * cross-account read reached only after `requireAdmin`.
 *
 * @module lib/admin/billing/subscriptionsDeps
 */

import { businessOsAccountPlanRepository } from '@/lib/repositories/BusinessOsAccountPlanRepository';
import type { BusinessOsAccountPlan } from '@/lib/repositories/BusinessOsAccountPlanRepository';
import {
  businessOsBillingAdminReadRepository,
  type AdminBillingRow,
} from '@/lib/repositories/BusinessOsBillingAdminReadRepository';
import { getEntitlementConfig } from '@/lib/business-os/entitlements/source';
import type { EntitlementConfig } from '@/lib/business-os/entitlements/source';
import { walkPlans } from '@/lib/business-os/finance/financeHealth';

type Result<T> = { data: T; error: null } | { data: null; error: Error };

export interface SubscriptionsDeps {
  readBillingRows: (livemode: boolean) => Promise<Result<AdminBillingRow[]>>;
  /** Every plan row. Reaching the plan ceiling is an ERROR here: a cut walk would hide comps. */
  readPlanRows: () => Promise<Result<BusinessOsAccountPlan[]>>;
  readConfig: () => EntitlementConfig;
}

export function subscriptionsDeps(): SubscriptionsDeps {
  return {
    readBillingRows: async (livemode) => {
      const result = await businessOsBillingAdminReadRepository.listBillingRowsForModeAllAccounts(livemode);
      return result.error || !result.data
        ? { data: null, error: result.error ?? new Error('Billing read returned no data') }
        : { data: result.data, error: null };
    },
    readPlanRows: async () => {
      const walk = await walkPlans({ pagePlans: (options) => businessOsAccountPlanRepository.pagePlans(options) });
      if (walk.error || !walk.data) return { data: null, error: walk.error ?? new Error('Plan walk returned no data') };
      if (walk.data.capped) return { data: null, error: new Error('Plan rows reached the read ceiling') };
      return { data: walk.data.rows, error: null };
    },
    readConfig: () => getEntitlementConfig(),
  };
}
