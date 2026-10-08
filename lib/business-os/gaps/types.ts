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
  /**
   * A booking the CLIENT cancelled.
   *
   * The owner has something to do either way, which is why this is here rather
   * than only in the briefing: if money was paid it is owed back, and if it was
   * not, an hour just came free that could still be filled.
   *
   * Before this, a client cancellation reached the owner through one email that
   * never mentioned money and can be switched off, or a daily briefing covering
   * a single day that has never sent. A cancellation three weeks out reached
   * them through nothing at all.
   */
  | 'booking_cancelled'
  /**
   * A booking refunded in full that is STILL in the diary.
   *
   * Almost always a refund taken in the Stripe dashboard: the money side lands
   * correctly, and the appointment carries on as if nothing happened — so the
   * client is still sent "see you tomorrow" for a session they were refunded
   * for, and the owner is never told the two are out of step.
   *
   * Never resolved automatically. A refund is not a cancellation: money goes
   * back as goodwill while the session still happens, or a deposit is returned
   * while the job continues on new terms. The owner answers, either way.
   */
  | 'booking_refunded'
  /**
   * A meeting whose time has passed and which nobody has marked.
   *
   * The owner has to say what happened — it was held, they did not turn up, or
   * it was called off — and until they do, three separate things are stuck: a
   * quoted job cannot move to its price (the drawer's quote step now ASKS
   * rather than assuming the consultation happened), the no-show rate is
   * unknowable, and under per-session billing the session is never invoiced.
   *
   * It is the owner's move by definition: nobody else can know. The card is
   * what carries the question to an owner who has not opened the contact.
   */
  | 'meeting_unmarked'
  | 'intake_outstanding'
  | 'invoice_unpaid'
  /**
   * A phase of a quoted job, waiting on the owner to say the work happened.
   *
   * Has no due date and never will: `trigger: 'manual'` exists because no clock
   * can decide when a phase is done. See the definition for why nothing surfaced
   * it before.
   */
  | 'stage_awaiting_completion';

/**
 * What the owner can do about a gap, if anything.
 *
 * `null` means there is nothing to press — the gap is reported and that is all.
 * Never invent an action for a gap whose fix is not a single step.
 */
export type GapAction =
  | 'send_booking_link'
  /** Call off an appointment the money has already left. */
  | 'cancel_booking'
  /** Give back money held for a booking that is not happening. */
  | 'refund'
  | 'write_quote'
  | 'send_quote'
  | 'chase_intake'
  | 'chase_payment'
  /**
   * Mark a phase done so it can be invoiced.
   *
   * NAVIGATES rather than posts, like `write_quote`: the owner has to decide the
   * work happened, and a one-click button would be deciding it for them.
   */
  | 'bill_stage'
  /**
   * Say what happened to a meeting whose time has passed.
   *
   * NAVIGATES, like `bill_stage` and `write_quote`, and for a stronger reason
   * than either: the answer is one of three — held, no-show, called off — and a
   * single button cannot offer three answers. It opens the booking where all
   * three marks already are.
   */
  | 'mark_meeting'
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
  /**
   * When the question became ANSWERABLE, where that is not when it arose.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * The staleness window measures from here; `since` stays what the row SAYS,
   * and for almost every gap they are the same instant, so this is omitted.
   *
   * A meeting is the exception, and it is why this exists. `since` is the START
   * time, because that is what an owner recognises: "the 10am on Tuesday". But
   * the question "did it happen" cannot be answered until the meeting has
   * ENDED, so measuring the wait from the start charges the delay to the wrong
   * moment — a long session is asked about while it is still running, and a
   * late-afternoon one is held back until the small hours.
   * ───────────────────────────────────────────────────────────────────────────
   */
  staleFrom?: string;
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
   * A payment plan that is STILL CHARGING this client.
   *
   * Only `booking_cancelled` sets it. It is not a detail on the row so much as
   * the reason the row exists: the appointment is off and the card is still
   * being debited on schedule, and it stays that way until a person decides
   * otherwise — the platform deliberately does not end a payment arrangement
   * because an appointment was cancelled.
   *
   * Two consequences the surfaces must honour: a row carrying this NEVER ages
   * off, and it is worth saying out loud even when nothing is held right now.
   */
  planLive?: boolean;
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
