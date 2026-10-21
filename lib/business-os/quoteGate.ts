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
  /** `scheduling_bookings.status`. Still read for the clock states below. */
  bookingStatus: string | null | undefined;
  /**
   * The job was called off, whatever the appointment's status says.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * THE BUG THIS PARAMETER EXISTS FOR
   *
   * This used to be inferred here as `bookingStatus === 'cancelled'`, which
   * worked only while cancelling always wrote that status. It no longer does:
   * `SchedulingRepository.cancel` preserves a recorded attendance, so a
   * consultation that was held and whose job was then cancelled keeps
   * `completed` and the cancellation lands in `cancel_reason` / `cancelled_by`.
   *
   * The branch below therefore became UNREACHABLE for every held booking: the
   * gate fell through to `'open'` and the "send a quote" button survived a
   * cancellation. Reported as the create-quote button staying on screen after
   * the owner cancelled a consultation they had just marked held.
   *
   * `jobIsOver` in the drawer was given this same input for this same reason.
   * This is its sibling finally getting it. Supply it from
   * `jobCalledOff(booking)` in `lib/business-os/bookingStatus.ts`.
   * ───────────────────────────────────────────────────────────────────────────
   */
  calledOff: boolean;
  /**
   * `scheduling_bookings.meeting_status` — what happened at the APPOINTMENT.
   *
   * Its own column since 20261072, so it no longer has to share one with the
   * job's state. `null` means nobody has said yet, which the clock states below
   * are for.
   */
  meetingStatus: string | null | undefined;
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
  const { bookingStatus, calledOff, meetingStatus, startTime, isUnscheduled, proposalStatus } = input;
  const now = input.now ?? new Date();

  /*
   * Closed wins over everything, including a live proposal: the work is not
   * happening.
   *
   * `calledOff` rather than `bookingStatus === 'cancelled'` — see the note on
   * the parameter. The status cannot answer this for a held booking, which is
   * the whole of the reported bug.
   *
   * NOTE for whoever reads this next: a live quote is NOT withdrawn
   * server-side when the booking is cancelled. The comment here used to claim
   * it was; `cancel()` and the cancel route never mention proposals, and there
   * is no `withdraw` anywhere in that path. Closing the gate hides the button,
   * and the client's quote link keeps working until that is fixed separately.
   */
  if (calledOff || proposalStatus === 'stopped') return 'closed';

  /*
   * Once a quote exists, its own status drives the step — sent, viewed,
   * accepted, declined — and the meeting it came out of stops being the
   * question. Checked before the marks below so a quote sent from the van is
   * not re-gated on a meeting nobody ticked.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * NOT A TRUTHINESS TEST, AND IT USED TO BE.
   *
   * `'none'` is a real value in this system: the journey step carries
   * `proposal?.status ?? 'none'`, a word meaning there is no quote. Written as
   * `if (proposalStatus)` that word passed, the gate returned `'open'` without
   * ever reaching the meeting checks below, and the card told an owner to send
   * a price for a consultation nobody had marked as held.
   *
   * So the question is asked properly: is there a quote, not is this truthy.
   * A caller that normalises `'none'` to null is still right; this makes it
   * unnecessary rather than load-bearing.
   * ───────────────────────────────────────────────────────────────────────────
   */
  if (proposalStatus && proposalStatus !== 'none') return 'open';

  /*
   * The MEETING's own answers, read from the meeting's own column.
   *
   * These two were `bookingStatus === 'no_show'` and `=== 'completed'`, which
   * is the compression this change undoes: the appointment's outcome and the
   * job's state were the same field, so neither could be recorded without
   * overwriting the other.
   *
   * A meeting CANCELLED in advance now means the opposite of a closed job.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * This used to fall through to the clock states, where a cancelled meeting
   * with no new time read as `unmarked` — the step that ASKS what happened.
   * That was right while cancelling a meeting and cancelling the job were the
   * same gesture.
   *
   * They are not any more. "Cancel the meeting" exists as its own action
   * precisely because the owner and the client can agree to proceed WITHOUT
   * meeting: the site visit is off, the quote still gets written. Asking "what
   * happened at this meeting?" about an appointment both parties called off is
   * a question with no answer, and it blocked the one move that was left.
   *
   * The JOB being called off is a different fact entirely, and it is already
   * handled above by `calledOff`.
   * ───────────────────────────────────────────────────────────────────────────
   */
  // A missed meeting is NOT a closed job. See the module note.
  if (meetingStatus === 'no_show') return 'missed';

  // Held: the owner has said so.
  if (meetingStatus === 'held') return 'open';

  /* Called off by agreement, with the work continuing: the quote is the owner's
     move, exactly as it is after a held meeting. */
  if (meetingStatus === 'cancelled') return 'open';

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

/** What `isMeetingPastDue` needs to answer. */
export interface MeetingPastDueInput {
  /** `scheduling_bookings.status`. */
  status: string | null | undefined;
  /**
   * `scheduling_bookings.meeting_status` — the column the three marks moved to.
   *
   * Optional only so the existing callers that hold no booking row keep
   * compiling. Where it IS given it settles the question on its own: a meeting
   * marked `held` is not awaiting an answer, and without this the badge went on
   * saying "nobody has said what happened" about a meeting the owner had just
   * marked, because `complete()` leaves `status` at `confirmed`.
   */
  meetingStatus?: string | null;
  /** The meeting's start. Null for a service that is bought, not booked. */
  startTime: Date | null | undefined;
  /** Injected so the rule is testable without faking the clock. */
  now?: Date;
}

/**
 * Has this meeting's time passed with nobody saying what happened?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BUG THIS FIXES
 *
 * `'crm.booking.status.confirmed'` reads "Upcoming", and that label is chosen by
 * the STATUS alone. Nothing marks a booking past, so a confirmed meeting from
 * three weeks ago still said "Upcoming" — on the one screen an owner uses to
 * decide what needs doing. The card was telling them a thing that had already
 * happened was still ahead.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY NOT JUST CALL `quoteGate` AND CHECK FOR `'unmarked'`
 *
 * It looks like the same question and is not. `quoteGate` returns `'open'` the
 * moment a proposal exists, deliberately — once a quote is out, the meeting it
 * came from stops being what the journey is waiting on (see the note at the
 * `proposalStatus` branch). That is right for "may the owner quote?" and wrong
 * here: a meeting nobody marked is still unmarked whether or not a price was
 * sent from the van afterwards.
 *
 * Routing the badge through the gate would therefore hide this note on exactly
 * the bookings furthest along. Same module, because the clock reasoning belongs
 * in one place; separate function, because they answer different questions.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT COUNTS AS SAID
 *
 * `completed`, `cancelled` and `no_show` are the three marks an owner can
 * apply, and each one settles the question. The two statuses that leave it open
 * are `confirmed` and `pending`, and those are NAMED rather than inferred from
 * "not one of the marks".
 *
 * That distinction is load-bearing. A catch-all would make this note the
 * default for any status added later, and the sibling badge in the drawer
 * already records what that costs: `stopped` was added to the proposal set
 * without a branch, fell through, and told an owner a job they had just
 * stopped was "awaiting a quote" — the badge asking for the one thing they had
 * decided not to do. A new booking status should render no claim here until
 * somebody decides what it means, so an unknown or missing status returns
 * false.
 *
 * NO START TIME IS NEVER PAST DUE. A quoted service sold without an
 * appointment has no meeting to be late for, and the badge already says
 * `unscheduled_confirmed` for those.
 *
 * Instants are compared, never calendar days: `start_time` is a `timestamptz`,
 * so "has it passed" needs no timezone and cannot drift the way a formatted
 * DATE does.
 * ─────────────────────────────────────────────────────────────────────────────
 */
/** The statuses that leave "did this happen" open. Named, never inferred. */
const UNMARKED_STATUSES = ['confirmed', 'pending'];

export function isMeetingPastDue(input: MeetingPastDueInput): boolean {
  const { status, startTime, meetingStatus } = input;

  /* Already answered, on the column that now carries the answer. */
  if (meetingStatus != null) return false;

  /*
   * Only a status we understand to be open. `completed`, `cancelled` and
   * `no_show` are answers; anything else is a status this function has no
   * opinion about, and silence is the correct opinion to have.
   */
  if (!status || !UNMARKED_STATUSES.includes(status)) return false;

  // Nothing was scheduled, so nothing is late.
  if (!startTime || Number.isNaN(startTime.getTime())) return false;

  const now = input.now ?? new Date();
  return startTime.getTime() <= now.getTime();
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
