// lib/business-os/purge/ResetGuard.ts
//
// Slice 2 — the two controls that must both clear before a Reset may proceed.
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

import { createLogger } from '@/lib/logger';
import {
  decideLocalPrecondition,
  type LocalPreconditionResult,
} from './localPrecondition';
import { businessPurgeRepository } from '@/lib/repositories/BusinessPurgeRepository';

const logger = createLogger({ module: 'PurgeResetGuard' });

export type ResetGuardResult =
  | { outcome: 'clear' }
  | {
      outcome: 'refused';
      control: 'stripe_connected' | 'stripe_unreadable' | 'local_blocking' | 'local_unreadable';
      message: string;
      detail?: unknown;
    };

export async function evaluateResetGuard(params: {
  userId: string;
  correlationId: string;
}): Promise<ResetGuardResult> {
  const { userId, correlationId } = params;
  const log = logger.child({ correlationId });

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
      message: `Could not check for payments still in flight (${local.reason}). Refusing rather than assuming there are none.`,
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

  log.info({ userId }, 'Reset guard clear — no Stripe account, no local blocking state');
  return { outcome: 'clear' };
}
