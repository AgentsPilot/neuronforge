/**
 * Work that started and stopped.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A REGISTRY AND NOT FIVE MORE QUERIES
 *
 * Every one of these began life as a one-off: the dashboard grew a query for
 * unanswered enquiries, the briefing grew another for unreturned intake forms,
 * and a third was about to be written for unanswered quotes. Each one then had
 * to be taught separately how stale is stale, whose fault it is, and what the
 * owner does about it — and each got it slightly differently, which is how a
 * briefing ends up nagging about work that was finished a week ago.
 *
 * They are all the same shape: SOMETHING ENTERED A STATE AND DID NOT ADVANCE.
 * Declaring that shape once means the dashboard, the briefing and the insight
 * read one list, and adding the next one — a quote accepted with no invoice
 * raised, a payment taken with nothing booked — is an entry rather than a
 * fourth place to remember to change.
 *
 * WHO IS BLOCKED IS THE MOST IMPORTANT FIELD
 *
 * It decides whether something is an ERRAND or merely NEWS, and the two belong
 * on different surfaces at different cadences. A quote nobody has written is
 * the owner's to do today. A quote sent and not yet answered is the client's,
 * and telling the owner about it every morning teaches them to stop reading.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/business-os/gaps/types
 */

/** Everything currently tracked. Adding one is an entry in `GAP_DEFINITIONS`. */
export type GapId =
  | 'enquiry_unanswered'
  /**
   * A confirmed appointment coming up.
   *
   * A gap in the registry's mechanical sense — something the platform can act
   * on, with a count the card can show — rather than something stuck. Nobody is
   * waiting on anybody; the work is reminding both sides before it happens.
   */
  | 'meeting_upcoming'
  | 'quote_unwritten'
  | 'quote_unsent'
  | 'quote_awaiting_client'
  | 'intake_outstanding'
  | 'invoice_unpaid';

/**
 * What the owner can do about a gap, if anything.
 *
 * `null` means there is nothing to press — the gap is reported and that is all.
 * Never invent an action for a gap whose fix is not a single step.
 */
export type GapAction =
  | 'send_booking_link'
  | 'write_quote'
  | 'send_quote'
  | 'chase_intake'
  | 'chase_payment'
  | null;

/** One stuck thing, named the way a person would refer to it. */
export interface GapItem {
  /** Always present: every gap is ultimately about a person. */
  contactId: string;
  name: string;
  /** What it is about — the service, the amount, the appointment. */
  note?: string;
  /** When it became stuck, so "how long" can be shown rather than a date. */
  since: string;
  /** The proposal, booking or invoice this is about, for the action. */
  entityId?: string;
  /**
   * What this one is worth, where money is involved.
   *
   * Typed rather than folded into `note` as text. `invoice_unpaid` used to put
   * "250 ILS" into the note, which reads as a raw database value and cannot be
   * totalled — so the morning briefing could say five people were waiting and
   * never say what they were worth, which is the figure that decides which one
   * the owner starts with.
   */
  value?: number;
  currency?: string;
  /**
   * When the thing this is about actually HAPPENS, where it is in the future.
   *
   * Every other gap is something already stuck, and its timing runs forward
   * from `since` — an invoice raised three days ago is chased today. An
   * appointment runs the other way: the reminder is due a chosen number of
   * hours BEFORE it, so the only date that can schedule it is the appointment's
   * own.
   *
   * Set only by `meeting_upcoming`. Absent everywhere else, where `since` is
   * the whole story.
   */
  eventAt?: string;
}

export interface GapDefinition {
  id: GapId;

  /**
   * Who everyone is waiting on.
   *
   * `owner` gaps are errands and belong on the dashboard. `client` gaps are
   * news and belong in the briefing at most — the owner has already done their
   * part, and a card telling them to do it again is wrong.
   */
  blocksOn: 'owner' | 'client';

  /**
   * How long before it counts as stuck.
   *
   * Zero for the ones that are stuck the moment they exist: a quote nobody has
   * written is overdue immediately, because the client is already waiting.
   */
  staleAfterHours: number;

  action: GapAction;

  /** Find them. Always scoped to this owner; never throws. */
  find(userId: string, now: Date): Promise<GapItem[]>;
}

/** A gap and what is currently in it. */
export interface GapResult {
  id: GapId;
  blocksOn: 'owner' | 'client';
  action: GapAction;
  count: number;
  /** A few, for naming. `count` is the truth about how many. */
  items: GapItem[];
}
