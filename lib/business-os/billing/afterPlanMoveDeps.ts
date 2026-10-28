/**
 * The after-plan move's production wiring (account-deletion lifecycle SX-2b,
 * D3.1; workplan docs/workplans/BUSINESS_OS_D3_1_FREE_COHORT_AFTER_CANCEL_WORKPLAN.md
 * §6.2, §6.3; SA S-9, DR-5, DR-8).
 *
 * The ONE file outside the repository layer that may call the plan
 * repository's system write `applyAfterPlanMove`. It is declared on the plan
 * repository's referrer guard (RC-15, `businessOsEntitlements.imports.guard`),
 * which pins that it calls `findAfterPlanMoveInputs` and `applyAfterPlanMove`
 * and NO other plan-state write.
 *
 * What runs as the service role here, and why it is safe: the plan table has
 * no policy by design (service role only). The account id is OUR billing
 * row's, resolved by the plan subscription mirror; it never comes from Stripe
 * metadata or a request.
 *
 * `afterPlanMove` is the port the mirror takes (`PlanSubscriptionMirrorDeps.afterPlanMove`).
 * Wiring it is ONE line in `planBillingHandler.ts`'s production ports (T-8).
 *
 * @module lib/business-os/billing/afterPlanMoveDeps
 */

import 'server-only';

import type { Logger } from '@/lib/logger';
import { businessOsAccountPlanRepository } from '@/lib/repositories/BusinessOsAccountPlanRepository';
import { recordPlanChange } from '@/lib/business-os/entitlements/recordPlanChange';
import { getEntitlementConfig } from '@/lib/business-os/entitlements/source';
import {
  moveToFreeCohortAfterPlan,
  type AfterPlanMoveDeps,
  type AfterPlanMoveInput,
  type AfterPlanMovePort,
} from './afterPlanMove';

/** The production ports. */
export function afterPlanMoveDeps(): AfterPlanMoveDeps {
  return {
    readMoveInputs: (accountId) => businessOsAccountPlanRepository.findAfterPlanMoveInputs(accountId),
    writeMove: (input) => businessOsAccountPlanRepository.applyAfterPlanMove(input),
    config: () => getEntitlementConfig(),
    recordPlanChange,
    now: () => new Date(),
  };
}

/** The mirror's `afterPlanMove` port, wired for production. */
export const afterPlanMove: AfterPlanMovePort = (input: AfterPlanMoveInput, log: Logger) =>
  moveToFreeCohortAfterPlan(input, log, afterPlanMoveDeps());
