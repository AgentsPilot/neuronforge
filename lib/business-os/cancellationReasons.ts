/**
 * Why something was called off — ONE code namespace, three lists.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS MODULE EXISTS
 *
 * Five surfaces cancel something, and until now only two of them recorded a
 * reason you could count:
 *
 *   public quote page, decline   `decline_reason`  structured
 *   quote stopped part-way       `stop_reason`     structured
 *   client's own cancel page     free textarea     prose
 *   owner cancels a booking      free text         prose
 *   `cancelPlan`                 free string       prose
 *
 * Worse, "did the CLIENT cancel or the BUSINESS?" was encoded as a string
 * PREFIX on that prose — `CLIENT_CANCELLED_PREFIX`, whose own module says "THE
 * ONLY RECORD OF WHO CANCELLED. There is no column for it." A gap definition and
 * two detectors parse that prefix, and it has already broken once when two files
 * spelled the same sentence differently.
 *
 * So the reasons are prose that cannot be grouped, and the one fact that IS
 * structured is structured as a substring.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE NAMESPACE, TWO AUDIENCES
 *
 * A client and an owner do not describe the same cancellation the same way. A
 * client says "I'm ill" or "something came up"; an owner says "they stopped
 * answering" or "they won't pay the rest". One list serving both goes vague at
 * exactly the point it should be specific.
 *
 * So: two lists, and every code drawn from ONE namespace. A report can group
 * `client_not_paying` without caring which screen recorded it, and each screen
 * only ever offers what its user can honestly answer.
 *
 * The owner's list is deliberately the longer one. The owner sees things a client
 * never reports — a no-show, a double booking, a duplicate, a job that changed
 * shape — and those are the rows that make the analytics worth having.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RULES FOR CHANGING THIS
 *
 * ADD freely. There is no CHECK constraint behind these, on purpose, so product
 * vocabulary does not need a migration.
 *
 * NEVER RENAME a code. Stored rows keep the old spelling, so a rename silently
 * splits one reason into two and every comparison across the rename is wrong.
 *
 * A code means the same thing on every list it appears on. That is the whole
 * point of one namespace, and it is the thing to check before adding one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE REASON IS MANDATORY — on every surface, for the client as well as the owner.
 *
 * A product decision, and it has a known cost: forced pickers get the first item
 * clicked. Two things blunt that, and both are requirements rather than polish:
 *
 *   1. NOTHING IS PRESELECTED. The control opens on a placeholder and the
 *      confirm button stays disabled until a code is chosen, so there is no
 *      default to accept by accident. A list that opened on its first item would
 *      make that item the most common reason in the data, permanently.
 *   2. `'other'` IS ALWAYS LAST and always available. A mandatory list with no
 *      escape hatch does not get honest answers, it gets the nearest wrong one.
 *
 * The COLUMNS stay nullable. Rows cancelled before this shipped have no code and
 * never will; backfilling a default would invent data, and NOT NULL would need
 * exactly that. Unknown is a real state and it stays representable — enforcement
 * is at the API and the UI, where a person is present to answer.
 *
 * @module lib/business-os/cancellationReasons
 */

/**
 * What a CLIENT can honestly say about their own cancellation.
 *
 * Short on purpose. This is shown to somebody who came to cancel an appointment,
 * not to fill in a form — a long list gets the first item clicked.
 */
export const CLIENT_CANCEL_REASONS = [
  /** Something came up; they cannot make this time. */
  'client_unavailable',
  /** Ill. */
  'client_unwell',
  /** They want a different time rather than to drop it. */
  'client_rescheduling',
  /** They no longer need the service at all. */
  'client_no_longer_needed',
  /** Price. */
  'client_cost',
  'other',
] as const;

/**
 * What an OWNER can say — the longer list, because they see more.
 *
 * Grouped in reading order: what the client did, what the business could not do,
 * then the administrative cases that are not really cancellations at all and
 * badly distort a rate if they are counted as ones.
 */
export const OWNER_CANCEL_REASONS = [
  // ── The client's doing, as the owner observed it ──────────────────────────
  /** The client asked to cancel. */
  'client_cancelled',
  /** They did not turn up. Distinct from cancelling: nobody was told. */
  'client_no_show',
  /** They went quiet and stopped answering. */
  'client_unresponsive',
  /** They will not or cannot pay. */
  'client_not_paying',
  /** Price, as the reason the client gave. */
  'client_cost',

  // ── The business's own side ───────────────────────────────────────────────
  /** The business could not make the time. */
  'owner_unavailable',
  /** Two things booked into one slot. */
  'owner_double_booked',
  /** The business could not deliver the work. */
  'owner_cannot_deliver',
  /** The service is no longer offered. */
  'service_discontinued',
  /**
   * The money was given back, so the booking is being closed out.
   *
   * Its own code because it is the one cancellation a card can honestly make in
   * ONE CLICK: the `booking_refunded` gap finds a booking that was fully refunded
   * and is still on the books, and the owner pressing "cancel it" there is
   * confirming exactly this. Every other one-click would have to invent a reason.
   */
  'refunded',

  // ── Not really cancellations ──────────────────────────────────────────────
  /*
   * These three matter MORE than they look. A cancellation rate that counts
   * duplicates, test bookings and moved appointments is not a cancellation rate,
   * and it is the figure an owner would act on. Giving them their own codes is
   * what lets a report exclude them.
   */
  /** The same booking twice. */
  'duplicate',
  /** Made while trying the product out. */
  'test_booking',
  /** Moved to another slot — the work is still happening. */
  'rescheduled',

  /** The job changed enough that what was agreed no longer describes it. */
  'scope_changed',
  'other',
] as const;

/**
 * Why an accepted job stopped part-way through.
 *
 * Its own list because stopping a part-paid job is not cancelling an
 * appointment: there is no slot to free, work has been delivered, and money has
 * moved. Every code here also appears on the owner's list above, by design — a
 * report counting `client_not_paying` should find the stopped jobs and the
 * cancelled bookings together.
 */
export const STOP_REASONS = [
  /** The client decided not to carry on. */
  'client_stopped',
  'client_unresponsive',
  'client_not_paying',
  'scope_changed',
  'owner_cannot_deliver',
  'other',
] as const;

/**
 * Why a client refused a quote BEFORE agreeing to it — already live, already
 * stored, and deliberately left spelled as it is.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THESE FOUR PREDATE THIS MODULE and there are rows carrying them. Three overlap
 * in meaning with codes above and are spelled differently:
 *
 *   'too_expensive'  ==  'client_cost'
 *   'timing'         ~=  'client_rescheduling'   (a quote's timing, not a slot's)
 *   'scope'          ==  'scope_changed'
 *   'chose_other'        no equivalent — they went to a competitor
 *
 * RENAMING THEM IS NOT AN OPTION. The rule above is not a style preference: a
 * rename splits one stored reason into two and makes every comparison across the
 * rename wrong. So the namespace ABSORBS them, and a report that wants "lost on
 * price" unions `too_expensive` with `client_cost` using the map below.
 *
 * A declined quote is also not a cancellation — nothing was agreed, no slot was
 * held, no money moved. It is listed here because it answers the same business
 * question, not because it is the same event.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const DECLINE_REASONS = ['too_expensive', 'timing', 'scope', 'chose_other', 'other'] as const;
export type DeclineReason = (typeof DECLINE_REASONS)[number];

/**
 * Codes that mean the same thing under different spellings.
 *
 * For reports, never for writing: resolving a code on the way IN would rewrite
 * what the client actually answered. Group on the way out.
 */
/*
 * Not exported: `canonicalReason` is the way to use this. An exported map invites
 * a caller to look codes up itself and miss the `?? code` fallback, which is what
 * makes an unmapped code pass through unchanged instead of becoming undefined.
 */
const EQUIVALENT_REASONS: Record<string, string> = {
  too_expensive: 'client_cost',
  scope: 'scope_changed',
};

/** The canonical code to group a stored one under. */
export function canonicalReason(code: string): string {
  return EQUIVALENT_REASONS[code] ?? code;
}

/*
 * There is deliberately no ALL_CANCEL_REASONS.
 *
 * One was written and nothing used it. Each surface validates against the list it
 * OFFERS — the client page against `CLIENT_CANCEL_REASONS`, the owner dialog
 * against `OWNER_CANCEL_REASONS` — which is strictly better: a union would have
 * let the client page accept `owner_double_booked`, a code it never showed.
 */

export type ClientCancelReason = (typeof CLIENT_CANCEL_REASONS)[number];
export type OwnerCancelReason = (typeof OWNER_CANCEL_REASONS)[number];
export type StopReason = (typeof STOP_REASONS)[number];
/*
 * No combined `CancelReason` union either, for the reason there is no
 * ALL_CANCEL_REASONS: nothing should accept "any reason". Every signature names
 * the list its surface actually offers, so the type rejects a code that screen
 * never showed.
 */

/**
 * Who called it off — the column that replaces the string prefix.
 *
 * `'system'` is not decoration: a booking cancelled by an automated rule is
 * neither party's decision, and counting it against either one is a lie about
 * both. Nothing writes it yet; it exists so the first automation that needs it
 * does not reach for `'owner'`.
 */
export const CANCELLED_BY = ['client', 'owner', 'system'] as const;
export type CancelledBy = (typeof CANCELLED_BY)[number];

/**
 * Reasons that make "book again" a contradiction.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE EMAIL THAT PROMPTED THIS said, in one message: we no longer offer this
 * service, and — would you like to book it again? With a button pointing at a
 * page for the thing just withdrawn.
 *
 * The cancellation email has always ended with a rebooking invitation, and
 * `offerRebooking` existed to suppress it only for a business that was closing
 * down. The reason code now knows better than the caller does:
 *
 *   service_discontinued  the link points at something not offered
 *   rescheduled           the work IS still happening, at another time; booking
 *                         again would create a second appointment
 *   duplicate             they already hold the real booking; this invites a third
 *   test_booking          not a real client, and certainly not an invitation
 *
 * Everything else still invites them back, including the awkward ones. A client
 * who did not pay or did not turn up is someone a business may well want to see
 * again, and that is the owner's call rather than this list's.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const REASONS_WITHOUT_REBOOKING = new Set<string>([
  'service_discontinued',
  'rescheduled',
  'duplicate',
  'test_booking',
]);

/**
 * Which bucket a cancelled row belongs in, for a reason breakdown.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE FUNCTION, because two detectors need the identical three-line rule and a
 * copy each is how they come to disagree. `RetCancellationSpikeDetector` and
 * `OpsLastMinuteCancelsDetector` both call this.
 *
 * Each line is a decision:
 *
 *   prefer the code    Grouping on the free-text `cancellation_reason` made the
 *                      KEY the whole sentence: "Client is ill", "client ill",
 *                      "ill" and "sick" were four reasons in the report and one
 *                      reason in life. Worse, once the cancel surfaces became
 *                      structured, a client who picks a reason and types nothing
 *                      leaves only the bare `CLIENT_CANCELLED_PREFIX` — so every
 *                      client cancellation collapsed into one bucket reading
 *                      "Cancelled by client".
 *
 *   fold equivalents   `too_expensive` and `client_cost` are one reason split
 *                      across a rename that could not happen, because rows
 *                      already carried the old spelling.
 *
 *   fall back to prose Rows cancelled before the code existed still say
 *                      something. Dropping it erases what they say, and folding
 *                      them into a code nobody chose would be worse.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @param fallbackLabel what an empty row is called — the two detectors word this
 *   differently ('No reason provided' / 'No reason'), so it is theirs to pass.
 */
export function cancelReasonBucket(
  row: { cancel_reason?: string | null; cancellation_reason?: string | null },
  fallbackLabel: string
): string {
  if (row.cancel_reason) return canonicalReason(row.cancel_reason);
  return row.cancellation_reason || fallbackLabel;
}

/** The translation key for a reason code, in one place so callers cannot drift. */
export function cancelReasonKey(code: string): string {
  return `cancel.reason.${code}`;
}
