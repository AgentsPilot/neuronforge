import 'server-only';

/**
 * Tell the person who issued an invite that it was accepted (invite-only
 * signup N-1; requirement FR-39 to FR-42 as recorded by T-0; workplan §2;
 * SA Q-1 to Q-6, C-1 to C-3).
 *
 * Called by the redemption (`inviteRedemption.ts`) after a successful
 * finalise, for both proofs (code and Google) and both kinds of invite.
 *
 * ── Never throws, never fails the signup (SA Q-1, C-1) ──────────────────────
 * Every dependency call is guarded, and the whole notification (lookups,
 * template, send) runs under ONE deadline, `INVITER_NOTIFICATION_POLICY`
 * (4 s). It is awaited inline, because an un-awaited promise can be frozen
 * with a serverless instance once the response is sent; a late send is left
 * to finish and its result is ignored. The redemption's outcome is computed
 * before this runs and is returned unchanged whatever happens here.
 *
 * ── Who is told (N4, SA Q-3) ────────────────────────────────────────────────
 *   friend invite (`issuer_kind = 'account'`)  → the champion
 *   admin invite  (`issuer_kind = 'admin'`)    → the ONE admin who issued it,
 *                                                 only while still an active
 *                                                 admin (`admin_users`, never
 *                                                 `profiles.role`)
 * The address is the issuer's LIVE auth email, never the `inviter_reply_to`
 * snapshot. A definite "no such account", an account with no email, a failed
 * lookup or a former admin: nothing is sent, and the reason is audited.
 *
 * ── Tenant isolation (`tenant-isolation-guard`, SA C-2) ─────────────────────
 * The service-role lookups are keyed ONLY on the issuer id of the invite row
 * the 256-bit token matched (`issuer_account_id` / `issuer_admin_id`), never on
 * anything in the request.
 *
 * ── Only what the inviter typed (N3, SA C-3) ────────────────────────────────
 * The email carries the invitee's address as stored on the invite and a
 * status. No address of anyone reaches a log, an audit entry or the subject:
 * the transport gets `redactRecipientInLogs: true` (the inviter's address) and
 * `redactInLogs: [inviteeEmail]`. No `from` (the transport uses
 * `RESEND_FROM_EMAIL` as configured), no `replyTo` (never the invitee), no
 * `ownerUserId`. Fails closed when the platform sender is not configured.
 *
 * ── Exactly once, without a stamp (SA Q-2) ──────────────────────────────────
 * The claim lease (120 s) outlives every signup request (`maxDuration` 60 s),
 * and finalise sets `redeemed_at` in the same transaction, so no two requests
 * reach the finish for one invite. A send lost to a crash is not retried; the
 * status stays visible in the inviter's list.
 *
 * ── Entitlements ────────────────────────────────────────────────────────────
 * Imports nothing from `lib/business-os/entitlements/**` and must not.
 */

import {
  generateInviteAcceptedEmail,
  type InviteAcceptedStatus,
  type InviterNotificationEvent,
  type InviterRecipientKind,
} from '@/lib/email/templates/invite-accepted';
import { resolveUserLanguage, type LanguageSource } from '@/lib/business-os/userLanguage';
import type { SendEmailParams, SendEmailResult } from '@/lib/notifications/emailTransport';
import type { AgentRepositoryResult as RepositoryResult } from '@/lib/repositories/types';

import { INVITER_NOT_NOTIFIED_REASONS, INVITER_NOTIFICATION_POLICY, type InviterNotNotifiedReason } from './inviteEmailPolicy';

/** Where the browser lands after the redemption. A held friend reads "not subscribed yet". */
export type InviterNotificationLanding = 'onboarding' | 'awaiting_payment';

export interface NotifyInviterInput {
  event: InviterNotificationEvent;
  inviteId: string;
  issuerKind: 'admin' | 'account';
  /** The champion, on a friend invite. From the matched invite row only. */
  issuerAccountId: string | null;
  /** The issuing admin's auth user id, on an admin invite. From the matched invite row only. */
  issuerAdminId: string | null;
  /** The address the inviter typed, as stored on the invite. */
  inviteeEmail: string;
  landing: InviterNotificationLanding;
}

/** One audit entry. The caller writes it with no owner (`userId`/`actorId` null, SA Q-4). */
export interface InviterNotificationAuditEntry {
  action: 'BOS_INVITE_INVITER_NOTIFIED' | 'BOS_INVITE_INVITER_NOT_NOTIFIED';
  inviteId: string;
  details: Record<string, string | number | boolean | null>;
}

export interface InviterNotificationLogger {
  info: (context: Record<string, unknown>, message: string) => void;
  warn: (context: Record<string, unknown>, message: string) => void;
}

export interface InviterNotificationDeps {
  /** The auth account `findUserIdentity` (wired in `redemptionDeps.ts`): `{ data: null }` only on a definite "no such user". */
  findUserIdentity: (id: string) => Promise<RepositoryResult<{ email: string | null } | null>>;
  /** `AdminAccessService.isAdminById`: `false` on any error (fails closed). */
  isActiveAdmin: (id: string) => Promise<boolean>;
  /** `business_profiles.language`, raw. */
  findProfileLanguage: (id: string) => Promise<RepositoryResult<string | null>>;
  /** `user_preferences.preferred_language`. */
  findPreferredLanguage: (id: string) => Promise<RepositoryResult<string | null>>;
  /** `platformSenderAddress` in production: `undefined` when not configured. */
  senderAddress: () => string | undefined;
  sendEmail: (params: SendEmailParams) => Promise<SendEmailResult>;
  /** Builds the button's absolute URL (`platformUrl`). */
  platformUrl: (path: string) => string;
  audit: (entry: InviterNotificationAuditEntry) => Promise<void>;
  logger: InviterNotificationLogger;
  /** Tests only: overrides `INVITER_NOTIFICATION_POLICY.deadlineMs`. */
  deadlineMs?: number;
}

export type InviterNotificationOutcome =
  | { outcome: 'sent'; recipientKind: InviterRecipientKind }
  | { outcome: 'not_sent'; recipientKind: InviterRecipientKind; reason: InviterNotNotifiedReason }
  | { outcome: 'unknown'; recipientKind: InviterRecipientKind; reason: typeof INVITER_NOT_NOTIFIED_REASONS.deadlineExceeded };

/** Where each recipient's button goes. */
export const INVITER_ACTION_PATHS: Readonly<Record<InviterRecipientKind, string>> = {
  champion: '/business-os/settings#settings-section-invite-friends',
  admin: '/admin/business-os-invites',
};

/** What the inner run settled on, before it is audited. */
interface RunResult {
  outcome: InviterNotificationOutcome;
  recipientAccountId: string | null;
  language: string | null;
  languageSource: LanguageSource | null;
  provider: SendEmailResult['provider'] | null;
}

/** A promise that never rejects: a rejection becomes `fallback`. */
async function settle<T>(promise: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise();
  } catch {
    return fallback;
  }
}

const LOOKUP_FAILED = { data: null, error: new Error('lookup threw') };

function statusFor(landing: InviterNotificationLanding): InviteAcceptedStatus {
  // Chosen from the landing, not the issuer kind: if an admin Paid invitee is
  // ever held (P-9), the wording follows with no change here.
  return landing === 'awaiting_payment' ? 'not_subscribed_yet' : 'joined';
}

async function run(input: NotifyInviterInput, deps: InviterNotificationDeps, recipientKind: InviterRecipientKind): Promise<RunResult> {
  const base: RunResult = {
    outcome: { outcome: 'not_sent', recipientKind, reason: INVITER_NOT_NOTIFIED_REASONS.noIssuer },
    recipientAccountId: null,
    language: null,
    languageSource: null,
    provider: null,
  };
  const notSent = (reason: InviterNotNotifiedReason, extra: Partial<RunResult> = {}): RunResult => ({
    ...base,
    ...extra,
    outcome: { outcome: 'not_sent', recipientKind, reason },
  });

  // C-2: the id comes from the matched invite row, for its own kind only.
  const recipientId = recipientKind === 'admin' ? input.issuerAdminId : input.issuerAccountId;
  if (!recipientId) return notSent(INVITER_NOT_NOTIFIED_REASONS.noIssuer);

  // Fail closed before anything is looked up, composed or sent.
  let address: string | undefined;
  try {
    address = deps.senderAddress();
  } catch {
    address = undefined;
  }
  if (!address) return notSent(INVITER_NOT_NOTIFIED_REASONS.senderNotConfigured, { recipientAccountId: recipientId });

  // C-1: the lookups are independent, so they run together.
  const [isAdmin, identity, profileLanguage, preferredLanguage] = await Promise.all([
    recipientKind === 'admin' ? settle(() => deps.isActiveAdmin(recipientId), false) : Promise.resolve(true),
    settle(() => deps.findUserIdentity(recipientId), LOOKUP_FAILED),
    settle(() => deps.findProfileLanguage(recipientId), LOOKUP_FAILED),
    settle(() => deps.findPreferredLanguage(recipientId), LOOKUP_FAILED),
  ]);

  const extra = { recipientAccountId: recipientId };
  if (!isAdmin) return notSent(INVITER_NOT_NOTIFIED_REASONS.recipientNotAdmin, extra);
  if (identity.error) return notSent(INVITER_NOT_NOTIFIED_REASONS.recipientLookupFailed, extra);
  const to = identity.data?.email?.trim();
  if (!to) return notSent(INVITER_NOT_NOTIFIED_REASONS.recipientNotFound, extra);

  // N7: the RECIPIENT's language; a failed read counts as absent.
  const resolved = resolveUserLanguage({
    profileLanguage: profileLanguage.error ? null : profileLanguage.data,
    preferredLanguage: preferredLanguage.error ? null : preferredLanguage.data,
  });
  const withLanguage = { ...extra, language: resolved.language, languageSource: resolved.source };

  let result: SendEmailResult;
  try {
    const email = generateInviteAcceptedEmail({
      event: input.event,
      inviteeEmail: input.inviteeEmail,
      status: statusFor(input.landing),
      recipientKind,
      actionUrl: deps.platformUrl(INVITER_ACTION_PATHS[recipientKind]),
      locale: resolved.language,
    });
    result = await deps.sendEmail({
      kind: 'transactional',
      to: [to],
      subject: email.subject,
      html: email.html,
      text: email.text,
      // C-3: neither address may reach a transport log line.
      redactRecipientInLogs: true,
      redactInLogs: [input.inviteeEmail],
    });
  } catch {
    return notSent(INVITER_NOT_NOTIFIED_REASONS.transportFailed, withLanguage);
  }

  if (!result.sent) return notSent(INVITER_NOT_NOTIFIED_REASONS.transportFailed, { ...withLanguage, provider: result.provider });
  return { ...withLanguage, provider: result.provider, outcome: { outcome: 'sent', recipientKind } };
}

/**
 * Email the issuer of an accepted invite. See the file header for every rule.
 * Never throws; resolves within the deadline.
 */
export async function notifyInviter(input: NotifyInviterInput, deps: InviterNotificationDeps): Promise<InviterNotificationOutcome> {
  const recipientKind: InviterRecipientKind = input.issuerKind === 'admin' ? 'admin' : 'champion';
  const status = statusFor(input.landing);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<'timedOut'>((resolve) => {
    timer = setTimeout(() => resolve('timedOut'), deps.deadlineMs ?? INVITER_NOTIFICATION_POLICY.deadlineMs);
  });

  const running = run(input, deps, recipientKind).catch(
    (): RunResult => ({
      outcome: { outcome: 'not_sent', recipientKind, reason: INVITER_NOT_NOTIFIED_REASONS.transportFailed },
      recipientAccountId: null,
      language: null,
      languageSource: null,
      provider: null,
    })
  );

  let settled: RunResult;
  try {
    const first = await Promise.race([running, deadline]);
    settled =
      first === 'timedOut'
        ? {
            outcome: { outcome: 'unknown', recipientKind, reason: INVITER_NOT_NOTIFIED_REASONS.deadlineExceeded },
            recipientAccountId: (recipientKind === 'admin' ? input.issuerAdminId : input.issuerAccountId) ?? null,
            language: null,
            languageSource: null,
            provider: null,
          }
        : first;
  } finally {
    clearTimeout(timer);
  }

  const { outcome } = settled;
  const reason = outcome.outcome === 'sent' ? null : outcome.reason;

  // C-3: ids and reason classes only. Never the invitee's or the inviter's address.
  const logContext = {
    inviteId: input.inviteId,
    recipientKind,
    outcome: outcome.outcome,
    reason,
    languageSource: settled.languageSource,
    provider: settled.provider,
  };
  try {
    if (outcome.outcome === 'sent') deps.logger.info(logContext, 'Inviter notified that their invite was accepted');
    else if (reason === INVITER_NOT_NOTIFIED_REASONS.recipientNotAdmin || reason === INVITER_NOT_NOTIFIED_REASONS.recipientNotFound) {
      deps.logger.info(logContext, 'Inviter not notified: no current recipient');
    } else deps.logger.warn(logContext, 'Inviter not notified that their invite was accepted');
  } catch {
    // A logger that throws must not fail the signup either.
  }

  try {
    await deps.audit({
      action: outcome.outcome === 'sent' ? 'BOS_INVITE_INVITER_NOTIFIED' : 'BOS_INVITE_INVITER_NOT_NOTIFIED',
      inviteId: input.inviteId,
      details: {
        event: input.event,
        recipientKind,
        recipientAccountId: settled.recipientAccountId,
        status,
        outcome: outcome.outcome,
        language: settled.language,
        reason,
      },
    });
  } catch {
    // Non-blocking by contract (CLAUDE.md § Audit Trail).
  }

  return outcome;
}
