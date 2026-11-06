/**
 * The Stripe-side Keep's production wiring (DL-1b / D6; workplan
 * docs/workplans/BUSINESS_OS_DELETION_DL1B_WORKPLAN.md §7). Wired in ONE place,
 * `planBillingHandler.ts`'s production ports, next to `afterPlanMove`.
 *
 * Service role through the closure repository (no policy on the table, by
 * design). The account id is OUR billing row's, resolved by the mirror; it
 * never comes from Stripe metadata or a request (tenant-isolation-guard).
 *
 * The audit row has no `user_id` and no `actor_id`: the platform acted on
 * Stripe's word (system actor), and the row survives stage E (XC-13, W-14).
 *
 * @module lib/business-os/account-deletion/closureStripeKeepDeps
 */

import 'server-only';

import { AUDIT_EVENTS } from '@/lib/audit/events';
import { logAndFlush } from '@/lib/audit/boundedAuditFlush';
import { AccountClosureRepository, type ClosurePatch } from '@/lib/repositories/AccountClosureRepository';
import {
  keepClosureAfterStripeReactivation,
  type ClosureStripeKeepDeps,
  type ClosureStripeKeepInput,
  type ClosureStripeKeepLogger,
  type ClosureStripeKeepPort,
} from './closureStripeKeep';

export function closureStripeKeepDeps(repo: AccountClosureRepository = new AccountClosureRepository()): ClosureStripeKeepDeps {
  return {
    closures: {
      findOpenForUser: (userId) => repo.findOpenForUser(userId),
      // The repository re-validates every key and value against `pending>kept`'s allow-list.
      transition: (id, userId, from, to, patch) => repo.transition(id, userId, from, to, patch as ClosurePatch),
    },
    recordKept: (facts, log) =>
      logAndFlush(
        {
          action: AUDIT_EVENTS.ACCOUNT_DELETION_KEPT,
          entityType: 'user',
          entityId: facts.accountId,
          details: {
            closure_id: facts.closureId,
            source: 'stripe',
            from: 'pending',
            subscription_id: facts.subscriptionId,
            stripe_event_id: facts.stripeEventId,
            livemode: facts.livemode,
          },
        },
        log,
        { reason: 'account kept by a Stripe reactivation', continues: 'the webhook continues' }
      ),
    now: () => new Date(),
  };
}

/** The mirror's `closureStripeKeep` port, wired for production. */
export const closureStripeKeep: ClosureStripeKeepPort = (input: ClosureStripeKeepInput, log: ClosureStripeKeepLogger) =>
  keepClosureAfterStripeReactivation(input, log, closureStripeKeepDeps());
