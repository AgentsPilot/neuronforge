/**
 * The deletion request's production ports (DL-1b / D6; workplan
 * docs/workplans/BUSINESS_OS_DELETION_DL1B_WORKPLAN.md §4, D-1).
 *
 * What runs as the service role here, and why it is safe
 * (tenant-isolation-guard): the closure table has no policy by design, and
 * the billing row and the timezone are read through their repositories. Every
 * id they are given is the SESSION user the request route read with
 * `readSessionSubject()`; nothing here takes a request value. The closure
 * repository filters `user_id` on every method this file calls.
 *
 * The ONE Stripe path is `managePlanSubscription` (oneDontRenewPath guard):
 * this file never names a Stripe method.
 *
 * @module lib/business-os/account-deletion/closureRequestDeps
 */

import 'server-only';

import { AccountClosureRepository, type ClosurePatch } from '@/lib/repositories/AccountClosureRepository';
import { businessOsBillingAccountRepository } from '@/lib/repositories/BusinessOsBillingAccountRepository';
import { userPreferencesRepository } from '@/lib/repositories/UserPreferencesRepository';
import { isPlanPriceRecognitionEnabled } from '@/lib/business-os/billing/planPricesFlag';
import { managePlanSubscription, type PlanManageLogger } from '@/lib/business-os/billing/planSubscriptionManage';
import { currentStripeMode, isLiveMode } from '@/lib/business-os/billing/stripeMode';
import type { BillingRowLike, ClosureRequestDeps } from './closureRequest';
import { runAccountDeletionCheck } from './selfServiceDeletion';

/** The closure repository, as the request and Keep modules' structural port. */
export function closureStore(repo: AccountClosureRepository = new AccountClosureRepository()) {
  return {
    findOpenForUser: (userId: string) => repo.findOpenForUser(userId),
    findById: (id: string, userId: string) => repo.findById(id, userId),
    insertRequesting: (input: Parameters<AccountClosureRepository['insertRequesting']>[0]) => repo.insertRequesting(input),
    // The repository re-validates every key and value against the transition's allow-list.
    transition: (id: string, userId: string, from: Parameters<AccountClosureRepository['transition']>[2], to: Parameters<AccountClosureRepository['transition']>[3], patch: Record<string, string | boolean | null>) =>
      repo.transition(id, userId, from, to, patch as ClosurePatch),
    deleteRequesting: (id: string, userId: string) => repo.deleteRequesting(id, userId),
  };
}

/**
 * The pre-check's billing read (Q-15): the session user's row in the server
 * key's mode. `mode_unknown` when the key's mode cannot be read.
 */
export async function readDeletionBillingRow(
  userId: string
): Promise<{ kind: 'row'; row: BillingRowLike | null } | { kind: 'mode_unknown' } | { kind: 'unreadable' }> {
  let livemode: boolean;
  try {
    livemode = isLiveMode(currentStripeMode());
  } catch {
    return { kind: 'mode_unknown' };
  }
  const read = await businessOsBillingAccountRepository.findByUser(userId, livemode);
  if (read.error) return { kind: 'unreadable' };
  return { kind: 'row', row: read.data };
}

export function closureRequestDeps(logger: PlanManageLogger): ClosureRequestDeps {
  return {
    closures: closureStore(),
    billingRow: (userId, livemode) => businessOsBillingAccountRepository.findByUser(userId, livemode),
    livemode: () => isLiveMode(currentStripeMode()),
    pricesEnabled: isPlanPriceRecognitionEnabled,
    runCheck: (input) => runAccountDeletionCheck(input),
    readTimezone: (userId) => userPreferencesRepository.findTimezone(userId),
    manage: (input) => managePlanSubscription(input, { logger }),
    now: () => new Date(),
    logger,
  };
}
