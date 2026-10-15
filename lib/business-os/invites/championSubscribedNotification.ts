import 'server-only';

/**
 * N-2: "{email} has subscribed", to the champion, once, when a friend they
 * invited pays their first invoice (plan payments P-5b.1; requirement FR-43;
 * workplan BUSINESS_OS_PLAN_PAYMENTS_P5B_WORKPLAN.md §3.2; SA S5-4, S5-5 c/d,
 * P5-C8, Q-1, Q-5, C-2, C-6, C-7, C-8).
 *
 * The production implementation of `FirstPaymentNotifier`, the port that
 * `planPaymentApply.ts` calls after a stamped first payment's audit is flushed.
 * Built ONLY in `planBillingHandler.ts` (C-5). Never throws.
 *
 * ── Who is told: found only through OUR records (S5-5 c) ────────────────────
 *   the paying account   from our billing row (SR-8), handed in by the apply
 *   → its lineage row    `invite_id` (read by the apply, under the same clock)
 *   → that invite        `issuer_account_id`, the champion
 * and the invite must be a FRIEND invite (`issuer_kind = 'account'`) that was
 * redeemed by THIS account (`redeemed_account_id`): otherwise the lineage and
 * the invite disagree, nobody is emailed, and it is alerted as
 * `invite_mismatch` (tenant-isolation-guard step 2; Q-5). Stripe metadata is
 * never read.
 *
 * ── One clock (O-4) ─────────────────────────────────────────────────────────
 * `remainingMs` is what the apply's lineage read left of N-1's 4 s. The invite
 * read and the whole of `notifyInviter` (lookups, template, send) share it.
 *
 * ── The email and its audit are N-1's (S5-4) ────────────────────────────────
 * `notifyInviter` with `event: 'subscribed'`: the champion's LIVE auth email,
 * the champion's language, the platform sender with no Reply-To, both
 * addresses redacted from transport logs, fail closed without a sender. One
 * entry per outcome, `BOS_INVITE_INVITER_NOTIFIED` / `_NOT_NOTIFIED`.
 *
 * ── N-6 (SA Q-1, C-2) ───────────────────────────────────────────────────────
 * Every entry is written on `business_os_invite` with `userId: null` and
 * `actorId: null`, never on the lineage entity. No owner policy and no owner
 * reader can return a row whose `user_id` is not the reader, so neither the
 * friend nor the champion ever sees the "not notified" outcome. (The stored
 * `user_id` is NULL, or the platform account when `SYSTEM_ADMIN_USER_ID` is
 * set; never either of them.) `details.accountId` (the friend) and
 * `details.recipientAccountId` (the champion) let an admin find it.
 *
 * ── The audit is flushed here, bounded (SA Q-3) ─────────────────────────────
 * A webhook has no later flush, so each entry goes out through `logAndFlush`
 * (2 s) after the deadline race, as N-1's audit runs after its race.
 *
 * ── To the issuing ADMIN (plan payments P-9.2, T10, BQ-P11, SA Q-10) ──────
 * When the payer's lineage `source` is `admin_invite`, the same chain finds
 * the admin instead:
 *   the paying account → its lineage row `invite_id` → that invite's
 *   `issuer_admin_id`,
 * and the invite must be ADMIN-issued (`issuer_kind = 'admin'`) and redeemed
 * by THIS account, or nobody is emailed and it is alerted as `invite_mismatch`
 * (as for a friend). A champion's own first payment (an admin COHORT invite)
 * owes nobody this email: an info line, no audit. Then `notifyInviter` with
 * `issuerKind: 'admin'`: N-1's active-admin check (`admin_users`, never
 * `profiles.role`) and the admin's LIVE auth email, N-1's admin button, the
 * same clock, the same audit shape (`recipientKind: 'admin'`). Exactly once
 * for the same reason as a friend's: only a newly stamped first payment gets
 * here, and a replay is `already_applied`.
 *
 * Imports nothing from `lib/business-os/entitlements/**` and must not (C-8).
 * No address of anyone in a log line or an audit entry.
 */

import { logAndFlush, type AuditFlushLogger } from '@/lib/audit/boundedAuditFlush';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import type { AuditLogInput } from '@/lib/audit/types';
import type { FirstPaymentNotifier, FirstPaymentNotifyInput } from '@/lib/business-os/billing/planPaymentApply';
import type { BusinessOsInviteRepository } from '@/lib/repositories/BusinessOsInviteRepository';
import type { BusinessOsInviteNotificationFacts } from '@/lib/repositories/types';
import { AuditTrailService } from '@/lib/services/AuditTrailService';

import { INVITER_NOT_NOTIFIED_REASONS, INVITER_NOTIFICATION_POLICY, type InviterNotNotifiedReason } from './inviteEmailPolicy';
import {
  notifyInviter,
  type InviterNotificationAuditEntry,
  type InviterNotificationDeps,
  type InviterNotificationLogger,
} from './inviterNotification';

/** The logger the notifier writes to: the delivery's own (Pino child in production). */
type ChampionNotifierLogger = InviterNotificationLogger & AuditFlushLogger;

export interface ChampionSubscribedNotifierDeps {
  /** The four facts of ONE invite. Production: `businessOsInviteRepository`. */
  invites: Pick<BusinessOsInviteRepository, 'findInviterNotificationFactsById'>;
  /** N-1's lookups, sender and transport. Production: `buildInviterNotificationDeps`. */
  inviterDeps: (context: { logger: InviterNotificationDeps['logger']; audit: InviterNotificationDeps['audit'] }) => InviterNotificationDeps;
  /** Write one entry and flush it, bounded; never rejects. Production: `writeChampionNotificationAudit`. */
  writeAudit: (entry: AuditLogInput, log: AuditFlushLogger) => Promise<void>;
  /** Tests only: overrides N-1's 4 s clock. */
  deadlineMs?: number;
}

/** The production audit writer: one entry, one bounded flush (SA Q-3). Never rejects. */
export async function writeChampionNotificationAudit(entry: AuditLogInput, log: AuditFlushLogger): Promise<void> {
  await logAndFlush(entry, log, { reason: 'the friend subscribed notification', continues: 'the payment is unaffected' }, AuditTrailService.getInstance());
}

type BoundedRead<T> = { kind: 'ok'; value: T } | { kind: 'timed_out' } | { kind: 'threw' };

/** Race one read against what is left of the clock. Never rejects. */
async function within<T>(read: () => Promise<T>, ms: number): Promise<BoundedRead<T>> {
  if (ms <= 0) return { kind: 'timed_out' };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timedOut = new Promise<{ kind: 'timed_out' }>((resolve) => {
      timer = setTimeout(() => resolve({ kind: 'timed_out' }), ms);
    });
    const reading = Promise.resolve().then(read);
    reading.catch(() => undefined);
    return await Promise.race([reading.then((value): BoundedRead<T> => ({ kind: 'ok', value })), timedOut]);
  } catch {
    return { kind: 'threw' };
  } finally {
    clearTimeout(timer);
  }
}

/** Why the invite does not lead to a champion this account may notify, or null when it does. */
function mismatchOf(facts: BusinessOsInviteNotificationFacts, accountId: string): string | null {
  if (facts.issuer_kind !== 'account') return 'not_a_friend_invite';
  if (!facts.issuer_account_id) return 'no_issuing_account';
  if (facts.redeemed_account_id !== accountId) return 'redeemed_by_another_account';
  return null;
}

/** P-9.2 (T10): why the invite does not lead to an admin this account may notify, or null. */
function adminMismatchOf(facts: BusinessOsInviteNotificationFacts, accountId: string): string | null {
  if (facts.issuer_kind !== 'admin') return 'not_an_admin_invite';
  if (!facts.issuer_admin_id) return 'no_issuing_admin';
  if (facts.redeemed_account_id !== accountId) return 'redeemed_by_another_account';
  return null;
}

export function createFirstPaymentNotifier(deps: ChampionSubscribedNotifierDeps): FirstPaymentNotifier {
  const deadlineMs = deps.deadlineMs ?? INVITER_NOTIFICATION_POLICY.deadlineMs;

  async function notifyChampion(input: FirstPaymentNotifyInput): Promise<void> {
    const startedAt = Date.now();
    const log: ChampionNotifierLogger = input.log;
    const ids = { accountId: input.accountId, stripeEventId: input.stripeEventId, livemode: input.livemode };
    // P-9.2 (T10): whom the lineage says to look for. Absent → a friend (P-5b.1).
    const recipientKind: 'champion' | 'admin' = input.lineageSource === 'admin_invite' ? 'admin' : 'champion';
    let audited = false;

    /** C-2: the only shape an N-2 entry is ever written in. */
    const toAuditInput = (action: InviterNotificationAuditEntry['action'], inviteId: string | null, details: Record<string, unknown>): AuditLogInput => ({
      action: AUDIT_EVENTS[action],
      entityType: 'business_os_invite',
      entityId: inviteId,
      userId: null,
      actorId: null,
      details: { ...details, ...ids, lineageRead: input.lineageRead },
    });

    const write = async (entry: AuditLogInput): Promise<void> => {
      audited = true;
      try {
        await deps.writeAudit(entry, log);
      } catch {
        // Never rejects by contract; defended anyway (CLAUDE.md § Audit Trail).
      }
    };

    /** A "not notified" entry in N-1's detail shape, for the steps before `notifyInviter`. */
    const notNotified = (inviteId: string | null, reason: InviterNotNotifiedReason, extra: { recipientAccountId?: string | null; inviteRead?: string } = {}) =>
      write(
        toAuditInput('BOS_INVITE_INVITER_NOT_NOTIFIED', inviteId, {
          event: 'subscribed',
          recipientKind,
          recipientAccountId: extra.recipientAccountId ?? null,
          status: 'subscribed',
          outcome: 'not_sent',
          language: null,
          reason,
          ...(extra.inviteRead ? { inviteRead: extra.inviteRead } : {}),
        })
      );

    const mismatch = async (inviteId: string | null, mismatchKind: string, recipientAccountId: string | null) => {
      log.error(
        { event: 'bos_invite_subscribed_invite_mismatch', inviteId, mismatch: mismatchKind, ...ids, alert: true },
        'N-2 not sent: the paying account\'s lineage and its invite disagree'
      );
      await notNotified(inviteId, INVITER_NOT_NOTIFIED_REASONS.inviteMismatch, { recipientAccountId });
    };

    const remaining = () => input.remainingMs - (Date.now() - startedAt);

    try {
      // 1. No invite id. C-6: an unread lineage may still have been a friend.
      const inviteId = input.inviteId;
      if (!inviteId) {
        if (input.lineageRead === 'ok') {
          await mismatch(null, recipientKind === 'admin' ? 'admin_lineage_without_invite' : 'friend_lineage_without_invite', null);
          return;
        }
        log.warn(
          { event: 'bos_invite_subscribed_source_unknown', lineageRead: input.lineageRead, ...ids },
          'First payment\'s lineage could not be read: the source is unknown and a friend may have been owed an N-2 email; nobody was emailed'
        );
        await notNotified(null, INVITER_NOT_NOTIFIED_REASONS.recipientLookupFailed);
        return;
      }

      // 2. The invite, bounded by what is left of the clock.
      const read = await within(() => deps.invites.findInviterNotificationFactsById(inviteId), remaining());
      if (read.kind !== 'ok' || read.value.error) {
        const inviteRead = read.kind === 'timed_out' ? 'timed_out' : 'failed';
        log.warn({ event: 'bos_invite_subscribed_invite_unread', inviteId, inviteRead, ...ids }, 'N-2 not sent: the invite could not be read');
        await notNotified(inviteId, INVITER_NOT_NOTIFIED_REASONS.recipientLookupFailed, { inviteRead });
        return;
      }
      const facts = read.value.data;
      if (!facts) {
        await mismatch(inviteId, 'invite_not_found', null);
        return;
      }

      // 3. Cross-checks (tenant-isolation-guard step 2, Q-5): the invite must be
      // of the kind the payer's own lineage names, and redeemed by the payer.
      let issuer:
        | { issuerKind: 'account'; issuerAccountId: string; issuerAdminId: null }
        | { issuerKind: 'admin'; issuerAccountId: null; issuerAdminId: string };
      if (recipientKind === 'admin') {
        const adminMismatch = adminMismatchOf(facts, input.accountId);
        if (adminMismatch !== null || !facts.issuer_admin_id) {
          await mismatch(inviteId, adminMismatch ?? 'no_issuing_admin', facts.issuer_admin_id ?? null);
          return;
        }
        // A champion paying for themself (an admin COHORT invite): no admin sold
        // this plan, so nothing was owed and nothing is audited (as P-5b.1).
        if (facts.grant_kind !== 'tier') {
          log.info(
            { event: 'bos_invite_subscribed_not_applicable', source: 'admin_invite', grantKind: facts.grant_kind, inviteId, ...ids },
            'First payment is from a champion invite, not an admin Paid invite; no N-2 email'
          );
          return;
        }
        issuer = { issuerKind: 'admin', issuerAccountId: null, issuerAdminId: facts.issuer_admin_id };
      } else {
        const mismatchKind = mismatchOf(facts, input.accountId);
        if (mismatchKind !== null || !facts.issuer_account_id) {
          await mismatch(inviteId, mismatchKind ?? 'no_issuing_account', facts.issuer_account_id ?? null);
          return;
        }
        issuer = { issuerKind: 'account', issuerAccountId: facts.issuer_account_id, issuerAdminId: null };
      }
      const recipientId = issuer.issuerKind === 'admin' ? issuer.issuerAdminId : issuer.issuerAccountId;

      // 4. Nothing is started that cannot finish inside the clock.
      const left = remaining();
      if (left <= 0) {
        await notNotified(inviteId, INVITER_NOT_NOTIFIED_REASONS.deadlineExceeded, { recipientAccountId: recipientId });
        return;
      }

      // 5. From here everything is N-1's, with N-2's audit shape (C-2). For an
      // admin, N-1's active-admin check and live auth email (T10, SA Q-10).
      const inviterDeps = deps.inviterDeps({
        logger: log,
        audit: async (entry) => write(toAuditInput(entry.action, entry.inviteId, entry.details)),
      });
      await notifyInviter(
        {
          event: 'subscribed',
          inviteId,
          ...issuer,
          inviteeEmail: facts.email,
        },
        { ...inviterDeps, deadlineMs: left }
      );
    } catch (err) {
      // By error class only: the text could carry an address.
      log.warn(
        { event: 'bos_invite_subscribed_failed', errName: err instanceof Error ? err.name : typeof err, ...ids },
        'N-2 failed; the payment is unaffected'
      );
      if (!audited) await notNotified(input.inviteId, INVITER_NOT_NOTIFIED_REASONS.transportFailed);
    }
  }

  return { deadlineMs, notifyChampion };
}
