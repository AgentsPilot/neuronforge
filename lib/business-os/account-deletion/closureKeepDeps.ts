/**
 * The Keep route's production ports (DL-1b / D6; workplan
 * docs/workplans/BUSINESS_OS_DELETION_DL1B_WORKPLAN.md §5).
 *
 * Service role through the closure repository (no policy on the table, by
 * design); every id is the SESSION user's, and the repository filters
 * `user_id` on each call (tenant-isolation-guard). The ONE Stripe path is
 * `managePlanSubscription` (oneDontRenewPath guard).
 *
 * @module lib/business-os/account-deletion/closureKeepDeps
 */

import 'server-only';

import { AccountClosureRepository } from '@/lib/repositories/AccountClosureRepository';
import { managePlanSubscription, type PlanManageLogger } from '@/lib/business-os/billing/planSubscriptionManage';
import type { ClosureKeepDeps } from './closureKeep';
import { closureStore } from './closureRequestDeps';

export function closureKeepDeps(logger: PlanManageLogger): ClosureKeepDeps {
  return {
    closures: closureStore(new AccountClosureRepository()),
    manage: (input) => managePlanSubscription(input, { logger }),
    now: () => new Date(),
    logger,
  };
}
