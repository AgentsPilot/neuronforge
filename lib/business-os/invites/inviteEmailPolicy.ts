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
