import 'server-only';

/**
 * Send one invitation email, record how it ended, and say what the admin list
 * shows (invite-only signup Slice 2a; requirement FR-14 to FR-16, T-7, T-11;
 * workplan D-1a, D-4 to D-7; SA R-2, R-9, R-12).
 *
 * ── Never throws, never loses the invite ────────────────────────────────────
 * The invite row already exists when this runs, and the admin is about to be
 * shown its link. Anything that goes wrong here, including a transport or a
 * template that throws, ends as "not sent" (or "unknown" if even the record
 * fails), and the create still answers 201 with the link (FR-16).
 *
 * ── Fails closed on the sender (R-2) ────────────────────────────────────────
 * No `RESEND_FROM_EMAIL`, or one that does not parse: `sendEmail` is NOT
 * called, the row records `not_sent` with `sender_not_configured`, and a
 * warning is logged. The transport's own NeuronForge default is never used for
 * an invitation.
 *
 * ── The link (D-4, R-9) ─────────────────────────────────────────────────────
 * Built ONLY by `buildInviteLink(token)`, so the emailed link is byte for byte
 * the one the admin is shown. It is never logged, never stored and never
 * audited. The transport gets `redactInLogs: [token, link]` (the raw token
 * too: an escaped or URL-encoded copy of the link still carries the token
 * verbatim) and `redactRecipientInLogs: true`. The stored problem detail is
 * scrubbed a second time here (token, link, hash, email-shaped text) and capped.
 *
 * ── Sender (T-11) ───────────────────────────────────────────────────────────
 * Explicit `from` and `replyTo`, `kind: 'transactional'`, and NO `ownerUserId`:
 * with no owner the transport sends `from` as given and never swaps in a
 * business name.
 *
 * ── Entitlements (R-12) ─────────────────────────────────────────────────────
 * Imports nothing from `lib/business-os/entitlements/**`. The plan's display
 * name arrives as `planName`, computed by `adminInviteOps.ts` (already a
 * registered importer), so this file is not an importer and needs no entry.
 */

import { generateInviteInvitationEmail, type InvitationOffer } from '@/lib/email/templates/invite-invitation';
import { defaultLocale, isValidLocale, type Locale } from '@/lib/i18n/config';
import type { SendEmailParams, SendEmailResult } from '@/lib/notifications/emailTransport';
import type { BusinessOsInviteRepository } from '@/lib/repositories/BusinessOsInviteRepository';
import type { BusinessOsInvite } from '@/lib/repositories/types';

import {
  INVITE_EMAIL_NOT_SENT,
  INVITE_EMAIL_NOT_SENT_REASONS,
  INVITE_EMAIL_POLICY,
  type InviteEmailNotSentReason,
} from './inviteEmailPolicy';
import { buildInviteFromHeader, isPlatformFallbackName } from './inviteSender';
import { buildInviteLink, hashInviteToken } from './inviteToken';

/** What the admin list and the create response say about the email (D-7). */
export type InviteEmailStatus = 'not_emailed' | 'sent' | 'sent_untracked' | 'not_sent' | 'unknown';

/** The row fields the send reads. The admin view of the row carries them all. */
export type InvitationEmailRow = Pick<
  BusinessOsInvite,
  | 'id'
  | 'email'
  | 'grant_kind'
  | 'access_open_ended'
  | 'access_months'
  | 'inviter_display_name'
  | 'language'
  | 'personal_note'
  | 'link_expires_at'
>;

export interface InvitationEmailLogger {
  info: (context: Record<string, unknown>, message: string) => void;
  warn: (context: Record<string, unknown>, message: string) => void;
}

export interface InvitationEmailDeps {
  sendEmail: (params: SendEmailParams) => Promise<SendEmailResult>;
  /** `platformSenderAddress` in production: `undefined` when not configured (R-2). */
  senderAddress: () => string | undefined;
  repository: Pick<BusinessOsInviteRepository, 'recordInviteEmailOutcome'>;
  now: () => Date;
  logger: InvitationEmailLogger;
  /** Tests only: overrides `INVITE_EMAIL_POLICY.sendTimeoutMs`. */
  sendTimeoutMs?: number;
}

export interface SendInvitationInput {
  row: InvitationEmailRow;
  /** The raw token of the link being emailed. Never logged, never stored. */
  token: string;
  /** The plan's display name, from `planLabel` in `adminInviteOps.ts` (R-12). */
  planName: string;
  /** The `inviter_reply_to` snapshot, or `null` (no Reply-To, D-2). */
  replyTo: string | null;
}

/** How one send ended. Carries no address, link, token, hash or error text. */
export type InvitationEmailOutcome =
  | {
      status: 'sent' | 'sent_untracked';
      provider: SendEmailResult['provider'];
      providerMessageId: string | null;
      /** `false` when the outcome could not be written; the list then shows "Unknown". */
      recorded: boolean;
    }
  | {
      status: 'not_sent';
      reason: InviteEmailNotSentReason;
      recorded: boolean;
    }
  | {
      /**
       * QA2a-1: the provider did not answer in time. The mail may or may not
       * go out, so nothing is written: the row keeps its attempt stamp with no
       * outcome, which the list shows as "Unknown".
       */
      status: 'unknown';
      reason: typeof INVITE_EMAIL_NOT_SENT_REASONS.sendTimeout;
      recorded: false;
    };

/** Resolves to `timedOut` after `ms`, unless `cancel` is called first. */
function timeoutAfter(ms: number): { promise: Promise<'timedOut'>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<'timedOut'>((resolve) => {
    timer = setTimeout(() => resolve('timedOut'), ms);
  });
  return { promise, cancel: () => clearTimeout(timer) };
}

/** Email-shaped text, as the transport masks it. */
const EMAIL_SHAPED = /[^\s@<>()"',;:]+@[^\s@<>()"',;:]+/g;

/**
 * The problem detail as it may be stored (D-4): the secrets and email-shaped
 * text replaced, then capped at `problemDetailMax` code points.
 */
export function scrubProblemDetail(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const secret of [...secrets].filter((value) => value.length > 0).sort((a, b) => b.length - a.length)) {
    out = out.split(secret).join('[redacted]');
  }
  out = out.replace(EMAIL_SHAPED, '[email]');
  return Array.from(out).slice(0, INVITE_EMAIL_POLICY.problemDetailMax).join('');
}

function offerFor(row: InvitationEmailRow): InvitationOffer {
  if (row.grant_kind === 'tier') return { kind: 'payment_required' };
  return { kind: 'free', accessOpenEnded: row.access_open_ended === true, accessMonths: row.access_months };
}

function localeFor(language: string): Locale {
  return isValidLocale(language) ? (language as Locale) : defaultLocale;
}

/**
 * Send the invitation for the link whose raw token is `token`, then record the
 * outcome on the row by a compare-and-swap on (id, token hash). See the file
 * header for every rule. Never throws.
 */
export async function sendInvitationEmail(input: SendInvitationInput, deps: InvitationEmailDeps): Promise<InvitationEmailOutcome> {
  const { row, token } = input;
  const tokenHash = hashInviteToken(token);
  const link = buildInviteLink(token);
  // QA2a-2: a fixed prefix of the token too, for a provider that echoes a truncated link.
  const tokenPrefix = token.slice(0, INVITE_EMAIL_POLICY.tokenPrefixRedactLength);
  const secrets = [token, link, tokenHash, tokenPrefix];

  const record = async (outcome: Parameters<InvitationEmailDeps['repository']['recordInviteEmailOutcome']>[0]['outcome']) => {
    try {
      const written = await deps.repository.recordInviteEmailOutcome({ id: row.id, tokenHash, now: deps.now(), outcome });
      if (written.error || written.data !== true) {
        deps.logger.warn(
          { inviteId: row.id, lostRace: !written.error },
          'Could not record the invitation email outcome; the list will show it as unknown'
        );
        return false;
      }
      return true;
    } catch {
      deps.logger.warn({ inviteId: row.id }, 'Could not record the invitation email outcome; the list will show it as unknown');
      return false;
    }
  };

  const notSent = async (reason: InviteEmailNotSentReason, detail: string): Promise<InvitationEmailOutcome> => {
    const recorded = await record({ kind: 'problem', problem: INVITE_EMAIL_NOT_SENT, detail: scrubProblemDetail(detail, secrets) });
    return { status: 'not_sent', reason, recorded };
  };

  // R-2: fail closed before anything is composed or sent.
  let address: string | undefined;
  try {
    address = deps.senderAddress();
  } catch {
    address = undefined;
  }
  if (!address) {
    deps.logger.warn(
      { inviteId: row.id, reason: INVITE_EMAIL_NOT_SENT_REASONS.senderNotConfigured },
      'Invitation email not sent: RESEND_FROM_EMAIL is not configured, and invitations never use the default sender'
    );
    return notSent(INVITE_EMAIL_NOT_SENT_REASONS.senderNotConfigured, INVITE_EMAIL_NOT_SENT_REASONS.senderNotConfigured);
  }

  let result: SendEmailResult;
  const timeout = timeoutAfter(deps.sendTimeoutMs ?? INVITE_EMAIL_POLICY.sendTimeoutMs);
  try {
    const email = generateInviteInvitationEmail({
      inviterName: isPlatformFallbackName(row.inviter_display_name) ? null : row.inviter_display_name,
      personalNote: row.personal_note,
      planName: input.planName,
      offer: offerFor(row),
      linkUrl: link,
      linkExpiresAt: new Date(row.link_expires_at),
      locale: localeFor(row.language),
    });

    if (!input.replyTo) {
      deps.logger.warn({ inviteId: row.id }, 'Invitation email has no Reply-To: the issuing admin has no email on record');
    }

    const sending = deps.sendEmail({
      kind: 'transactional',
      to: [row.email],
      subject: email.subject,
      html: email.html,
      text: email.text,
      from: buildInviteFromHeader(row.inviter_display_name, address),
      ...(input.replyTo ? { replyTo: input.replyTo } : {}),
      // L-9 / SA MF-1: the invitee is not a customer yet; never log the address.
      redactRecipientInLogs: true,
      // R-9: the raw token as well as the link (QA2a-2: and the token's prefix).
      redactInLogs: [token, link, tokenPrefix],
    });

    // QA2a-1: a hanging provider must not outlive the route's maxDuration. The
    // send is left to finish on its own; its late result is ignored.
    const first = await Promise.race([sending, timeout.promise]);
    if (first === 'timedOut') {
      sending.catch(() => undefined);
      deps.logger.warn(
        { inviteId: row.id, reason: INVITE_EMAIL_NOT_SENT_REASONS.sendTimeout },
        'Invitation email not confirmed in time; the admin is shown the link and the list will show it as unknown'
      );
      return { status: 'unknown', reason: INVITE_EMAIL_NOT_SENT_REASONS.sendTimeout, recorded: false };
    }
    result = first;
  } catch (error) {
    // The transport promises not to throw; if it (or the template) ever does,
    // the invite still stands and the admin still gets the link.
    const message = error instanceof Error ? error.message : String(error);
    deps.logger.warn(
      { inviteId: row.id, err: scrubProblemDetail(message, secrets) },
      'Invitation email not sent: the send threw'
    );
    return notSent(INVITE_EMAIL_NOT_SENT_REASONS.transportFailed, `${INVITE_EMAIL_NOT_SENT_REASONS.transportFailed}: ${message}`);
  } finally {
    timeout.cancel();
  }

  if (!result.sent) {
    deps.logger.warn(
      { inviteId: row.id, provider: result.provider, reason: INVITE_EMAIL_NOT_SENT_REASONS.transportFailed },
      'Invitation email not sent'
    );
    return notSent(
      INVITE_EMAIL_NOT_SENT_REASONS.transportFailed,
      `${INVITE_EMAIL_NOT_SENT_REASONS.transportFailed}: ${result.error ?? result.blocked ?? 'not sent'}`
    );
  }

  const providerMessageId = typeof result.providerMessageId === 'string' && result.providerMessageId.length > 0 ? result.providerMessageId : null;
  const recorded = await record({ kind: 'sent', providerMessageId });
  deps.logger.info({ inviteId: row.id, provider: result.provider, providerMessageId, recorded }, 'Invitation email sent');
  return {
    status: providerMessageId ? 'sent' : 'sent_untracked',
    provider: result.provider,
    providerMessageId,
    recorded,
  };
}

/** The email facts the status derivation reads. */
export type InviteEmailStatusRow = Pick<
  BusinessOsInvite,
  'email_attempted_at' | 'email_sent_at' | 'email_provider_message_id' | 'email_problem' | 'email_problem_at'
>;

/**
 * The one derivation of the list's email status (D-7, the C-11 rule), with the
 * time it refers to.
 *
 *   no attempt                    → not_emailed
 *   problem `not_sent`            → not_sent
 *   sent, with a provider id      → sent
 *   sent, no id (SMTP / Gmail)    → sent_untracked
 *   attempted, nothing recorded   → unknown (a function killed mid-send, or a
 *                                   failed outcome write)
 *
 * A delivery problem (`bounced` … `suppressed`) is only ever written by Slice
 * 2c's webhook, which adds its own statuses; until then such a row is
 * `unknown` rather than a status this slice cannot vouch for.
 */
export function deriveInviteEmailStatus(row: InviteEmailStatusRow): { status: InviteEmailStatus; at: string | null } {
  if (!row.email_attempted_at) return { status: 'not_emailed', at: null };
  if (row.email_problem) {
    if (row.email_problem === INVITE_EMAIL_NOT_SENT) return { status: 'not_sent', at: row.email_problem_at };
    return { status: 'unknown', at: row.email_problem_at };
  }
  if (row.email_sent_at) {
    return { status: row.email_provider_message_id ? 'sent' : 'sent_untracked', at: row.email_sent_at };
  }
  return { status: 'unknown', at: row.email_attempted_at };
}
