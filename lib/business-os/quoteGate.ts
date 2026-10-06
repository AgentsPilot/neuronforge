/**
 * When may an owner send the quote?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BUG THIS FIXES
 *
 * The contact drawer had two answers — "waiting on the meeting" and "your move"
 * — and flipped between them on the clock alone: the moment a consultation's
 * start time passed, the journey said the owner owed the client a price. For a
 * site visit nobody attended that is simply false, and it read as an overdue
 * task in the one list an owner uses to decide what to do today.
 *
 * The clock was chosen deliberately over the completion flag, and that reasoning
 * still holds: owners quote from the van on the way back and rarely mark an
 * appointment done first, so gating on `status === 'completed'` would have held
 * the button shut for the whole population it was meant to serve.
 *
 * So the fix is not a different assumption. It is a third state that ASKS —
 * `unmarked` — leaving the quote one tap away while the journey stops claiming
 * a meeting took place.
 *
 * SECOND BUG, in the same place: `no_show` was folded in with `cancelled`, so a
 * client who missed a site visit closed the job and the owner lost the route to
 * send a price at all. The drawer's own comment said the opposite — that only
 * cancelling means the business is not doing this work — so the code and its
 * stated intent disagreed. Here they are the same thing: a missed meeting keeps
 * the job alive.
 *
 * Pure, and its own module, because five states inside a three-thousand-line
 * component is how the first version of this came to contradict itself.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/business-os/quoteGate
 */

export type QuoteGateState =
  /** The consultation is still ahead. Nobody owes anybody anything yet. */
  | 'ahead'
  /** Its time has passed and nobody has said what happened. The step ASKS. */
  | 'unmarked'
  /** The meeting was missed. The job is alive; the client needs a new time. */
  | 'missed'
  /** The owner may quote: the meeting was held, or there was never one. */
  | 'open'
  /** Cancelled, or the quote was stopped. Nothing more to send. */
  | 'closed';

export interface QuoteGateInput {
  /** `scheduling_bookings.status`. */
  bookingStatus: string | null | undefined;
  /** The consultation's start, or null where the service books no time. */
  startTime: Date | null;
  /** A service that is bought rather than booked has no meeting to wait for. */
  isUnscheduled: boolean;
  /**
   * The live proposal's status, or null when none has been sent.
   *
   * `stopped` closes the job on its own: stopping a quote touches no booking —
   * a bookingless quote has no appointment to cancel — so the booking status
   * can never see it.
   */
  proposalStatus?: string | null;
  /** Injected so the states are testable without faking the clock. */
  now?: Date;
}

export function quoteGate(input: QuoteGateInput): QuoteGateState {
  const { bookingStatus, startTime, isUnscheduled, proposalStatus } = input;
  const now = input.now ?? new Date();

  /*
   * Closed wins over everything, including a live proposal: the work is not
   * happening, and any offer still outstanding was withdrawn server-side when
   * the booking was cancelled.
   */
  if (bookingStatus === 'cancelled' || proposalStatus === 'stopped') return 'closed';

  /*
   * Once a quote exists, its own status drives the step — sent, viewed,
   * accepted, declined — and the meeting it came out of stops being the
   * question. Checked before the marks below so a quote sent from the van is
   * not re-gated on a meeting nobody ticked.
   */
  if (proposalStatus) return 'open';

  // A missed meeting is NOT a closed job. See the module note.
  if (bookingStatus === 'no_show') return 'missed';

  // Held: the owner has said so.
  if (bookingStatus === 'completed') return 'open';

  /*
   * No meeting to wait for.
   *
   * A quoted service sold without an appointment, or a quote sent cold with no
   * booking behind it at all — `proposals.booking_id` is nullable and the create
   * route defaults it to null. Either way the owner's move is immediate.
   */
  if (isUnscheduled || !startTime || Number.isNaN(startTime.getTime())) return 'open';

  if (startTime.getTime() > now.getTime()) return 'ahead';

  /*
   * Its time has passed and the booking still reads pending or confirmed.
   *
   * This is the state that did not exist: the journey used to call it "your
   * move" and name a price the owner might owe for work that never happened.
   */
  return 'unmarked';
}

/**
 * Which side the ball is on, for the drawer's `waitingOn` metadata.
 *
 * Kept beside the gate so the label and the button cannot disagree about a
 * state — the strip reads exactly this, and the "Send a quote" button is gated
 * on the same value.
 */
export function quoteWaitingOn(
  state: QuoteGateState,
  proposalStatus?: string | null
): 'meeting' | 'unmarked' | 'noshow' | 'owner' | 'client' | 'closed' {
  switch (state) {
    case 'closed':
      return 'closed';
    case 'ahead':
      return 'meeting';
    case 'unmarked':
      return 'unmarked';
    case 'missed':
      return 'noshow';
    default:
      /*
       * A declined quote is the owner's move again: a rejected price is the
       * start of a negotiation, not the end of the job.
       */
      return !proposalStatus || proposalStatus === 'declined' ? 'owner' : 'client';
  }
}
