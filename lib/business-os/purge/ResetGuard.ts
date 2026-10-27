// lib/business-os/purge/ResetGuard.ts
//
// Slice 2 — the controls that must all clear before a Reset may proceed.
// Plan payments P-7a.3 (PF-14) adds control 3, which runs FIRST.
//
// Neither subsumes the other, and the workplan says so explicitly because the
// redundancy is only apparent:
//
//   Control 1 (SA-S5)  refuses when ANY Stripe Connect account exists, which
//                      removes the entire provider-state class — including the
//                      residual nothing local can see: dashboard-created
//                      schedules and refunds with no local row.
//
//   Control 2          refuses on locally-originated blocking state, which
//                      exists WITH NO STRIPE ACCOUNT AT ALL: a manually-issued
//                      invoice sitting `sent`/`overdue`, a manual payment left
//                      `pending`. Control 1 never fires for such a business,
//                      and its books are still mid-flight.
//
// ── Why control 1 is a runtime refusal and not a release note ──────────────
// The alternative was documentation: "if the test business ever holds live
// Stripe state, slice 4 becomes a prerequisite." That fails three ways — it
// must be evaluated on EVERY run, a human CANNOT evaluate it (dashboard state
// has no local signal), and violating it produces silently wrong books rather
// than an error. A control that must be remembered is not a control.
//
// It also makes slice 4 a MECHANICAL prerequisite rather than a remembered
// one: slice 2 is honestly describable as "Reset, available only in the
// skip-cleanly case", which is FR-8's own semantics.
//
// ── Control 3: a live platform plan subscription (plan payments P-7a.3) ───
// PF-14: a customer is never charged for an account whose data is gone. A
// Reset or Purge never deletes the billing record or the plan row (both are
// `never` in `descriptors.ts`), but it would leave Stripe charging a business
// whose books were wiped. So while the account holds a plan subscription
// Stripe may still bill, in EITHER mode, the run is refused.
//
// "Live" is ONE rule on the platform (SA TQ-11, C-9): `hasLivePlanSubscription`
// is the same reads and the same `isPlanSubscriptionLive` predicate as admin
// delete's R-3, and the SQL guard G-6 of the account-cleanup function carries
// the same status list (`planSubscriptionLive.paths.test.ts` pins all three).
// A cancelling subscription is still `active`, so it still refuses until
// Stripe ends it on the paid-through date (BQ-2, user 2026-10-26).
//
// It runs FIRST: two cheap reads that name the real blocker, before the
// Connect resolver. A failed read is not a "no": `subscription_unreadable`.
// It is commit-time only, before the snapshot, like controls 1 and 2 (the
// preview never runs this guard). The admin surface passes through it too,
// which agrees with R-3.

import { createLogger } from '@/lib/logger';
import {
  decideLocalPrecondition,
  type LocalPreconditionResult,
} from './localPrecondition';
import { businessPurgeRepository } from '@/lib/repositories/BusinessPurgeRepository';
import { withDevDetail } from './devDetail';
import { hasLivePlanSubscription } from './adminDeletionFacts';

const logger = createLogger({ module: 'PurgeResetGuard' });

export type ResetGuardResult =
  | { outcome: 'clear' }
  | {
      outcome: 'refused';
      control:
        | 'subscription_live'
        | 'subscription_unreadable'
        | 'stripe_connected'
        | 'stripe_unreadable'
        | 'local_blocking'
        | 'local_unreadable';
      message: string;
      detail?: unknown;
      /** Server-side only: recorded in the audit row, never returned to the client (SA G-3). */
      auditDetail?: unknown;
    };

export async function evaluateResetGuard(params: {
  userId: string;
  correlationId: string;
}): Promise<ResetGuardResult> {
  const { userId, correlationId } = params;
  const log = logger.child({ correlationId });

  // ── Control 3 (P-7a.3, PF-14) — a live plan subscription, either mode ────
  // First, by design (SA TQ-11). `hasLivePlanSubscription` never throws on a
  // failed read (it answers `null`); the catch is for a throw it does not
  // expect, which is a refusal all the same.
  let subscribed: boolean | null;
  try {
    subscribed = await hasLivePlanSubscription(userId);
  } catch (error) {
    log.warn({ err: error, userId }, 'Reset refused — plan subscription read threw');
    subscribed = null;
  }

  if (subscribed === null) {
    log.warn({ userId }, 'Reset refused — could not read the plan subscription');
    return {
      outcome: 'refused',
      control: 'subscription_unreadable',
      message:
        'Could not determine whether this business has a live plan subscription. Refusing rather than assuming it does not.',
    };
  }

  if (subscribed) {
    log.info({ userId }, 'Reset refused — a live plan subscription is present (PF-14)');
    return {
      outcome: 'refused',
      control: 'subscription_live',
      message:
        'This business has a live plan subscription. Cancel it in Settings → Plan, and reset once it has ended.',
    };
  }

  // ── Control 1 — any Stripe Connect account at all ───────────────────────
  let accounts;
  try {
    accounts = await businessPurgeRepository.resolveConnectAccounts(userId);
  } catch (error) {
    // A failed read is not a "no". Refuse.
    log.warn({ err: error, userId }, 'Reset refused — could not resolve Connect accounts');
    return {
      outcome: 'refused',
      control: 'stripe_unreadable',
      message:
        'Could not determine whether this business has a Stripe account connected. Refusing rather than assuming it does not.',
    };
  }

  if (accounts.length > 0) {
    log.info(
      { userId, accountCount: accounts.length },
      'Reset refused — a Stripe Connect account is present (slice 2 covers the skip-cleanly case only)',
    );
    return {
      outcome: 'refused',
      control: 'stripe_connected',
      message:
        'This business has a Stripe account connected. Reset is currently available only for businesses with no Stripe connection, because the checks that prove no money is in flight are not built yet. Deleting the local payment records while Stripe keeps charging and settling would leave the books silently wrong.',
      detail: { accounts: accounts.map((a) => ({ source: a.source, accountId: a.accountId })) },
    };
  }

  // ── Control 2 — locally-visible blocking state ──────────────────────────
  const counts = await businessPurgeRepository.countLocalBlockingState(userId);
  const local: LocalPreconditionResult = decideLocalPrecondition(counts);

  if (local.outcome === 'refused') {
    log.warn({ userId, reason: local.reason }, 'Reset refused — local blocking state unreadable');
    return {
      outcome: 'refused',
      control: 'local_unreadable',
      // SA G-3: `local.reason` can carry raw read-error text, so it reaches the
      // client only in development; Pino (above) and the audit row keep it.
      message: withDevDetail(
        'Could not check for payments still in flight. Refusing rather than assuming there are none.',
        local.reason,
      ),
      auditDetail: { reason: local.reason },
    };
  }

  if (local.outcome === 'blocked') {
    log.info({ userId, hits: local.hits }, 'Reset refused — local blocking state present');
    return {
      outcome: 'refused',
      control: 'local_blocking',
      message: `This business still has money in flight: ${local.hits
        .map((h) => `${h.count} ${h.label}`)
        .join('; ')}. Resolve these first.`,
      detail: { hits: local.hits },
    };
  }

  log.info({ userId }, 'Reset guard clear — no live plan subscription, no Stripe account, no local blocking state');
  return { outcome: 'clear' };
}
