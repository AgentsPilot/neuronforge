/**
 * May the owner remove or disconnect their Stripe Connect account right now?
 * (self-service exit SX-5 / D5; SA-14 "D-2 via runAccountDeletionCheck";
 * BQ-12 = block; SA workplan review W-1, W-2, W-10.)
 *
 *   Disconnect   refused while client payment plans are running (C1), read
 *                from the local mirror: the same `LOCAL_BLOCKING_CONDITIONS`
 *                the deletion guard G-9 is generated from (W-2).
 *   Delete       refused while client money is in flight: the G-9 rows of
 *                `runAccountDeletionCheck` (plans, pending payments and
 *                refunds). Only when the check is UNAVAILABLE (no email, no
 *                cleanup secret, function out of date) does it fall back to
 *                the same local conditions, C1 + C2. A check that FAILED is
 *                not a missing one: it refuses (W-2).
 *
 * This is the BUTTON's filter, G-9 only. It is deliberately not the XC-5
 * filter of the account-deletion request (G-4, G-8, G-9, a failed payment):
 * G-8 is always present while an account is linked, and the plan or admin
 * guards are not this button's business. Do not "align" the two.
 *
 * A failed read is never a "no": every unreadable answer is `unreadable`, and
 * the routes answer 503 with nothing changed.
 *
 * @module lib/business-os/account-deletion/connectExitGuard
 */

import 'server-only';
import { createLogger } from '@/lib/logger';
import { toBlockerViews, type BlockerView, type GuardRowLike } from '@/lib/business-os/account-deletion/blockerCopy';
import {
  runAccountDeletionCheck,
  type AccountDeletionCheckOutcome,
  type SelfDeletionSubject,
} from '@/lib/business-os/account-deletion/selfServiceDeletion';
import { decideLocalPrecondition, type LocalBlockingCondition } from '@/lib/business-os/purge/localPrecondition';
import { businessPurgeRepository } from '@/lib/repositories/BusinessPurgeRepository';
import { stripeConnectRepository } from '@/lib/repositories/PaymentRepository';
import { pluginConnectionRepository } from '@/lib/repositories/PluginConnectionRepository';

const logger = createLogger({ module: 'ConnectExitGuard' });

export type ConnectExitAction = 'disconnect' | 'delete';

export type ConnectExitVerdict =
  | { kind: 'clear'; source: 'check' | 'local' }
  | { kind: 'blocked'; blockers: BlockerView[]; source: 'check' | 'local' }
  | { kind: 'unreadable'; reason: string };

export type LocalCount = LocalBlockingCondition & { count: number | null };

export interface ConnectExitDeps {
  check(subject: SelfDeletionSubject): Promise<AccountDeletionCheckOutcome>;
  countLocal(userId: string): Promise<LocalCount[]>;
}

/** The session user: id always, email when the login has one. */
export interface ConnectExitSubject {
  id: string;
  email: string | null;
}

const CONDITIONS_FOR: Record<ConnectExitAction, ReadonlySet<LocalBlockingCondition['condition']>> = {
  // BQ-12 (user, 2026-10-30): the soft disconnect blocks on running client plans only.
  disconnect: new Set(['C1']),
  // C3 (sent / overdue invoices) never blocks, as in the anonymise modes (TL-6).
  delete: new Set(['C1', 'C2']),
};

/**
 * The check's blocker rows → this button's verdict. Pure.
 *
 * W-1: `[{ guard: 'unknown' }]` alone means the engine saw a block it could
 * not parse. While an account is linked G-8 is always present, so that is a
 * parse failure, and it must refuse rather than read as clear. A G-9 row the
 * copy cannot name maps to `contact_support` and still blocks.
 */
export function verdictFromCheckRows(rows: readonly GuardRowLike[]): ConnectExitVerdict {
  if (rows.length > 0 && rows.every((row) => row.guard === 'unknown')) {
    return { kind: 'unreadable', reason: 'check_unparsed' };
  }
  const g9 = rows.filter((row) => row.guard === 'G-9');
  if (g9.length === 0) return { kind: 'clear', source: 'check' };
  return { kind: 'blocked', blockers: toBlockerViews(g9), source: 'check' };
}

/** The local counts → this button's verdict, through the shared `decideLocalPrecondition`. Pure. */
export function verdictFromLocalCounts(counts: readonly LocalCount[], action: ConnectExitAction): ConnectExitVerdict {
  const relevant = counts.filter((count) => CONDITIONS_FOR[action].has(count.condition));
  if (relevant.length === 0) return { kind: 'unreadable', reason: 'no_conditions_read' };
  const decided = decideLocalPrecondition(relevant);
  if (decided.outcome === 'refused') return { kind: 'unreadable', reason: 'local_unreadable' };
  if (decided.outcome === 'clear') return { kind: 'clear', source: 'local' };

  const counted = new Map<'client_plans_running' | 'client_payments_pending', number>();
  for (const hit of decided.hits) {
    const code = hit.condition === 'C1' ? 'client_plans_running' : 'client_payments_pending';
    counted.set(code, (counted.get(code) ?? 0) + hit.count);
  }
  const order = ['client_plans_running', 'client_payments_pending'] as const;
  return {
    kind: 'blocked',
    blockers: order.filter((code) => counted.has(code)).map((code) => ({ code, count: counted.get(code) })),
    source: 'local',
  };
}

export function defaultConnectExitDeps(): ConnectExitDeps {
  return {
    check: (subject) => runAccountDeletionCheck(subject),
    countLocal: (userId) => businessPurgeRepository.countLocalBlockingState(userId),
  };
}

export async function checkConnectExit(
  subject: ConnectExitSubject,
  action: ConnectExitAction,
  deps: ConnectExitDeps = defaultConnectExitDeps()
): Promise<ConnectExitVerdict> {
  try {
    if (action === 'delete') {
      let unavailableReason: string | null = subject.email === null ? 'no_login_email' : null;
      if (subject.email !== null) {
        const outcome = await deps.check({ email: subject.email, subject: subject.id });
        if (outcome.kind === 'checked') return outcome.canDelete ? { kind: 'clear', source: 'check' } : verdictFromCheckRows(outcome.blockers);
        // W-2: a broken engine is not a missing one.
        if (outcome.kind === 'failed') return { kind: 'unreadable', reason: 'check_failed' };
        unavailableReason = outcome.reason;
      }
      logger.warn({ userId: subject.id, reason: unavailableReason }, 'Connect delete: deletion check unavailable, using the local money conditions');
    }
    return verdictFromLocalCounts(await deps.countLocal(subject.id), action);
  } catch (error) {
    logger.error({ err: error, userId: subject.id, action }, 'Connect exit check threw');
    return { kind: 'unreadable', reason: 'threw' };
  }
}

// ── W-10: is this Stripe account named by another business? ────────────────

export type SharedAccountAnswer = 'not_shared' | 'shared' | 'unreadable';

export interface SharedAccountDeps {
  connectOwner(accountId: string): Promise<{ data: { user_id: string } | null; error: unknown }>;
  pluginOthers(accountId: string, userId: string): Promise<{ data: number | null; error: unknown }>;
}

export function defaultSharedAccountDeps(): SharedAccountDeps {
  return {
    // Cross-user by design (rule 4): the account id is unique in this table, and only the owner id is read, compared, and dropped.
    connectOwner: (accountId) => stripeConnectRepository.findOwnerIdByStripeAccountId(accountId),
    pluginOthers: (accountId, userId) => pluginConnectionRepository.countOtherUsersNamingStripeAccount(accountId, userId),
  };
}

/**
 * Releasing an account at Stripe cuts it off for every business that names it
 * (W-10), so the delete refuses when another user's row in either table names
 * it. Nothing about the other business leaves this function.
 */
export async function isStripeAccountShared(
  accountId: string,
  userId: string,
  deps: SharedAccountDeps = defaultSharedAccountDeps()
): Promise<SharedAccountAnswer> {
  try {
    const owner = await deps.connectOwner(accountId);
    if (owner.error) return 'unreadable';
    if (owner.data && owner.data.user_id !== userId) return 'shared';
    const others = await deps.pluginOthers(accountId, userId);
    if (others.error || others.data === null) return 'unreadable';
    return others.data > 0 ? 'shared' : 'not_shared';
  } catch {
    return 'unreadable';
  }
}
