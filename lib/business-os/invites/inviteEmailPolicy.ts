/**
 * The invitation email's vocabulary and limits (invite-only signup Slice 2a;
 * workplan §3.1, D-4, D-7).
 *
 * The SQL checks LENGTHS only (`business_os_invites_email_lengths`); the words
 * live here, so adding one is a code change with no migration.
 *
 * Slice 2b adds the per-invite send window here (FR-14: 3 emails per invite
 * per 24 h, a fixed window opened by the first send, SA R-5), and Slice 2c the
 * delivery problems a webhook can report.
 */

/**
 * What `email_problem` may hold. 2a writes only `not_sent`; `bounced`,
 * `complained`, `failed` and `suppressed` are the webhook's (2c), listed now so
 * the one status derivation knows every word the column can carry.
 */
export const INVITE_EMAIL_PROBLEMS = ['not_sent', 'bounced', 'complained', 'failed', 'suppressed'] as const;
export type InviteEmailProblem = (typeof INVITE_EMAIL_PROBLEMS)[number];

/** The one problem Slice 2a writes: the send did not go out. */
export const INVITE_EMAIL_NOT_SENT: InviteEmailProblem = 'not_sent';

/** Why a send was `not_sent`: the start of `email_problem_detail`, and the audit reason. */
export const INVITE_EMAIL_NOT_SENT_REASONS = {
  /** `RESEND_FROM_EMAIL` unset or unparseable: nothing was sent (SA R-2). */
  senderNotConfigured: 'sender_not_configured',
  /** Every configured transport refused or failed. */
  transportFailed: 'transport_failed',
  /**
   * QA2a-1: the provider did not answer within `sendTimeoutMs`. The mail MAY
   * still go out, so nothing is recorded on the row (it reads "Unknown") and
   * the admin copies the link. Audit reason only; never stored as a problem.
   */
  sendTimeout: 'send_timeout',
} as const;
export type InviteEmailNotSentReason = (typeof INVITE_EMAIL_NOT_SENT_REASONS)[keyof typeof INVITE_EMAIL_NOT_SENT_REASONS];

export const INVITE_EMAIL_POLICY = {
  /** `email_problem_detail` cap, in code points; mirrors the database CHECK. */
  problemDetailMax: 300,
  /**
   * QA2a-1: the longest the create route waits for the provider, in ms. MUST
   * sit well below the route's `maxDuration` (30 s) so a hanging provider still
   * leaves time to answer 201 with the link; a test pins the margin.
   */
  sendTimeoutMs: 20_000,
  /**
   * QA2a-2: this many leading characters of the raw token are redacted too, so
   * a provider error that echoes a truncated link cannot carry the token's start.
   */
  tokenPrefixRedactLength: 12,
} as const;

/**
 * N-1: the inviter's "your invitation was accepted" email (workplan §2.2; SA
 * Q-1, C-1). It is sent INLINE, awaited, inside the signup request, so the
 * whole of it (the recipient and language lookups, the template and the send)
 * runs under one deadline. A late send is left to finish; its result is
 * ignored. 4 s keeps the worst-case extra wait on a signup click small and far
 * inside the signup routes' `maxDuration` (60 s), which must also cover account
 * creation and the finalise retry. A test pins the value and the margin.
 */
export const INVITER_NOTIFICATION_POLICY = {
  deadlineMs: 4_000,
} as const;

/** Why the inviter was not emailed. A reason class only: never an address. */
export const INVITER_NOT_NOTIFIED_REASONS = {
  /** `RESEND_FROM_EMAIL` unset or unparseable: nothing composed or sent. */
  senderNotConfigured: 'sender_not_configured',
  /** The invite row names no issuer id for its kind (cannot happen under the CHECK; defended anyway). */
  noIssuer: 'no_issuer',
  /** The issuing admin is no longer an active admin (`admin_users`, SA Q-3). */
  recipientNotAdmin: 'recipient_not_admin',
  /** The issuer's account no longer exists, or has no email. */
  recipientNotFound: 'recipient_not_found',
  /** The recipient lookup failed: no email is guessed. */
  recipientLookupFailed: 'recipient_lookup_failed',
  /** Every configured transport refused or failed, or the send threw. */
  transportFailed: 'transport_failed',
  /** The whole notification did not finish within `deadlineMs`; a send may still land. */
  deadlineExceeded: 'deadline_exceeded',
} as const;
export type InviterNotNotifiedReason = (typeof INVITER_NOT_NOTIFIED_REASONS)[keyof typeof INVITER_NOT_NOTIFIED_REASONS];
