/**
 * What state a sent email can be in — declared once.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `complained` IS A REAL STATUS, AND NOTHING SAID SO.
 *
 * `app/api/webhooks/resend/route.ts` writes it when a recipient marks mail as
 * spam. Meanwhile the creating migration's comment listed seven values and
 * omitted it, and four separate inline unions declared their own subsets. The
 * column is `TEXT DEFAULT 'pending'` with no CHECK, so the database accepted the
 * undeclared value without complaint.
 *
 * What that cost — all of it live before this file existed:
 *
 *   - `crm.email.status.complained` had no translation in any of the three
 *     locales, and `t()` returns the KEY on a miss. The idiom guarding it,
 *     `t(…) || email.status`, cannot fire because a key is a truthy string, so
 *     the first spam complaint rendered a badge reading the raw key.
 *   - `buildJourneySteps` in `CRMContactDrawerV2` matched `complained` against
 *     no branch and fell through to a `: 'completed'` default, painting a spam
 *     complaint as a green tick on the booking journey.
 *   - `BookingConfirmationEmail.status` omitted it, which is exactly why the
 *     compiler could not catch the line above.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY `delivered`, `opened` AND `clicked` ARE HERE BUT NEVER WRITTEN.
 *
 * The webhook records those three as TIMESTAMPS (`delivered_at`, `opened_at`,
 * `clicked_at`) and deliberately leaves `status` alone — a delivered email is
 * still, accurately, one that was sent. So no code path writes these three
 * today.
 *
 * They stay in the roster because the repository type and three UI unions
 * declare them, and removing them would make those types wrong in the other
 * direction. A CHECK constraint that excluded them would also reject any future
 * decision to promote a status without a migration.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DEPENDENCY-FREE ON PURPOSE.
 *
 * Client components need this type — the CRM drawer renders these badges. The
 * obvious home was `lib/repositories/EmailAutomationRepository`, but that
 * imports `supabaseServer`, and a value import of a server module from a client
 * component bundles a service-role key that is not there. This file imports
 * nothing, so it cannot. Same rule, and same reason, as `bookingStatus.ts`.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const EMAIL_SEND_STATUSES = [
  /** Queued by a sequence, not yet handed to a provider. */
  'pending',
  /** Handed to the provider and accepted. The ordinary case. */
  'sent',
  /**
   * Accepted by the recipient's mail server. Recorded as `delivered_at`; the
   * status is left at `sent`, so nothing writes this today. See the note above.
   */
  'delivered',
  /** Recorded as `opened_at`. Requires open tracking, which is off. */
  'opened',
  /** Recorded as `clicked_at`. Requires click tracking, which is off. */
  'clicked',
  /** Permanently rejected by the recipient's mail server. Terminal. */
  'bounced',
  /**
   * Delivered, then reported as spam by the recipient. Terminal, and NOT the
   * same as a bounce: the address works, the person did not want the mail.
   */
  'complained',
  /** Never left the platform, or the provider could not send it. Terminal. */
  'failed',
] as const;

export type EmailSendStatus = (typeof EMAIL_SEND_STATUSES)[number];

/** Whether a value off the wire is a status this system recognises. */
export function isEmailSendStatus(value: unknown): value is EmailSendStatus {
  return typeof value === 'string' && (EMAIL_SEND_STATUSES as readonly string[]).includes(value);
}

/**
 * The statuses that mean the mail LEFT THE PLATFORM.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Bounced and complained mail WAS sent. Counting "emails sent" as
 * `status = 'sent'` exactly — which is what `app/api/business-os/stats/route.ts`
 * did — means a row silently leaves the total the moment a delivery event
 * arrives, days later. An owner watches a figure that has only ever gone up
 * start going down, with nothing on the screen accounting for it.
 *
 * `failed` is excluded because it never went out. `pending` is excluded because
 * it has not gone out yet.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const DISPATCHED_EMAIL_STATUSES = [
  'sent',
  'delivered',
  'opened',
  'clicked',
  'bounced',
  'complained',
] as const;

/** Whether mail in this state actually left the platform. */
export function wasDispatched(status: unknown): boolean {
  return typeof status === 'string' && (DISPATCHED_EMAIL_STATUSES as readonly string[]).includes(status);
}

/**
 * The statuses that mean the mail did not, and will not, arrive.
 *
 * Both are terminal and both need saying out loud in the CRM: the send activity
 * was already logged when the row was created, and the trigger that wrote it
 * does not fire again on the transition — so without an explicit outcome row a
 * bounced email shows a timeline claiming it was sent and nothing anywhere
 * saying it never arrived.
 */
export const UNDELIVERABLE_EMAIL_STATUSES = ['bounced', 'complained', 'failed'] as const;

/** Whether this state means the recipient never got it. */
export function isUndeliverable(status: unknown): boolean {
  return typeof status === 'string' && (UNDELIVERABLE_EMAIL_STATUSES as readonly string[]).includes(status);
}
