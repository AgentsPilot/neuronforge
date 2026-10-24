/**
 * What state a booking can be in — declared once.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `pending` IS A REAL STATUS, AND FOR YEARS NOTHING SAID SO.
 *
 * Eleven files declared this union as four values, the creating migration's
 * comment listed the same four, and both Zod schemas accepted only those four.
 * Meanwhile `app/api/website/booking/create/route.ts` writes a FIFTH:
 *
 *     status: requiresPayment || isQuoteRequest ? 'pending' : 'confirmed'
 *
 * The column is `TEXT NOT NULL DEFAULT 'confirmed'` with no CHECK, so the
 * database accepted the undeclared value without complaint, and the four-value
 * types were simply wrong about the data they described.
 *
 * What that cost:
 *
 *   - a free intro booking rendered "Awaiting payment", because the one place
 *     that DID handle `pending` assumed it could only mean unpaid;
 *   - `PATCH /bookings/[id]` and `POST /bookings` rejected `pending`, so a
 *     booking in that state could not be moved out of it through the app;
 *   - reading any of those types told you something untrue.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT `pending` MEANS: NOT CONFIRMED YET. NOT "UNPAID".
 *
 * The route writes it for two unrelated reasons, and conflating them is what
 * produced the bad label:
 *
 *   - a payment is genuinely owed and has not arrived;
 *   - the service is QUOTED, so nobody has said what the work costs yet —
 *     there is no price to be awaiting.
 *
 * An owner can also set it by hand. To find out whether money is actually
 * outstanding, read `payment_status`: it is written 'paid' whenever the price
 * is zero or there is nothing to collect, so anything else is a real debt.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DEPENDENCY-FREE ON PURPOSE.
 *
 * Client components need this type. The obvious home was
 * `lib/repositories/SchedulingRepository`, but that imports `supabaseServer` —
 * and a value import of a server module from a client component bundles a
 * service-role key that is not there, which took down every public page in this
 * app once already. This file imports nothing, so it cannot.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const BOOKING_STATUSES = [
  /** Booked, and either paid for or free. The ordinary case. */
  'confirmed',
  /**
   * Not confirmed yet: a payment is owed, or the work has yet to be quoted.
   * NOT a statement about money on its own — see the note above.
   */
  'pending',
  'cancelled',
  'completed',
  'no_show',
] as const;

export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/** Whether a value off the wire is a status this system recognises. */
export function isBookingStatus(value: unknown): value is BookingStatus {
  return typeof value === 'string' && (BOOKING_STATUSES as readonly string[]).includes(value);
}

/**
 * WHAT HAPPENED AT THE APPOINTMENT — a different question from the one above.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `status` answers three things at once: is the time reserved, did the meeting
 * happen, and is the job on. They are independent in reality, so the
 * compression leaks. The reported symptom was a quoted consultation marked
 * "הפגישה התקיימה" and then cancelled, where the create-quote button stayed up
 * because `cancel()` preserves a recorded attendance and so never writes
 * `cancelled`, while `quoteGate` tests for exactly that value.
 *
 * This is the meeting's own answer. The money layer and the proposal layer
 * already have one; the meeting was the only layer without.
 *
 * `null` IS THE VALUE THAT DID NOT EXIST: nobody has said yet. Not "it did not
 * happen" — a past meeting nobody marked is the ordinary case, because owners
 * quote from the van and rarely tick an appointment first.
 *
 * `no_show` IS NOT `cancelled`. One is unplanned and may carry a fee; the other
 * is known in advance and usually does not. Both free the slot, only one is the
 * client's doing, and today the card cannot tell them apart.
 *
 * Column added in `supabase/migrations/20261072_booking_meeting_status.sql`.
 * Plan: docs/workplans/BOOKING_MEETING_SEPARATION_WORKPLAN.md
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const MEETING_STATUSES = [
  /** The meeting took place. */
  'held',
  /** The time passed and they did not come. Unplanned. */
  'no_show',
  /** Known in advance: this meeting will not take place. */
  'cancelled',
  /**
   * SUPERSEDED: this appointment was moved, and a later attempt carries the
   * new time. System-written — never an owner's answer. `syncMeeting` stamps
   * it on the attempt it supersedes, and it exists on `scheduling_meetings`
   * only; the booking mirror's own check constraint (20261072) does not accept
   * it, because a booking shows its CURRENT appointment and that is never a
   * superseded one.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * IT FREES THE HOUR, WHICH IS THE WHOLE POINT.
   *
   * Without it the abandoned time keeps `meeting_status: null`,
   * `MEETING_HOLDS_SLOT_FILTER` reads null as holding, and the hour the client
   * just gave back can never be sold again. Measured before the fix: 14
   * superseded attempts were blocking hours nobody had booked, and 8 of them
   * overlapped a real appointment — which is also what refused the exclusion
   * constraint this value was added to make possible.
   *
   * Distinct from `cancelled` deliberately. Both free the hour, but a
   * reschedule is not a cancellation: the moment a reader counts cancellations
   * off the meetings table rather than the booking mirror, collapsing the two
   * reports every moved appointment as a lost one.
   * ───────────────────────────────────────────────────────────────────────────
   */
  'moved',
] as const;

/** `null` is a real value and means "nobody has said yet" — see the note above. */
export type MeetingStatus = (typeof MEETING_STATUSES)[number] | null;

/** Whether a value off the wire is a meeting outcome this system recognises. */
export function isMeetingStatus(value: unknown): value is MeetingStatus {
  return value === null || (typeof value === 'string' && (MEETING_STATUSES as readonly string[]).includes(value));
}

/**
 * The columns these predicates read. Structural, so a detector's narrow
 * `.select()` and the drawer's full row both satisfy it without a cast.
 */
export interface BookingFacts {
  status?: string | null;
  meeting_status?: string | null;
  cancel_reason?: string | null;
  cancelled_by?: string | null;
}

/** The meeting took place. */
export function meetingHeld(booking: BookingFacts): boolean {
  return booking.meeting_status === 'held';
}

/** Its time passed and nobody came. */
export function meetingMissed(booking: BookingFacts): boolean {
  return booking.meeting_status === 'no_show';
}

/** It was called off in advance and will not take place. */
export function meetingOff(booking: BookingFacts): boolean {
  return booking.meeting_status === 'cancelled';
}

/**
 * Nobody has said what happened yet.
 *
 * The ordinary state of a past meeting, not an error: owners quote from the van
 * and rarely tick an appointment first. Readers that must only act BEFORE a
 * meeting is settled — the reminder, the intake chase — are the ones that want
 * this.
 */
export function meetingUnmarked(booking: BookingFacts): boolean {
  return booking.meeting_status == null;
}

/**
 * IS THE JOB OFF? Ask this, never `status === 'cancelled'`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE STATUS ALONE STOPPED ANSWERING IT
 *
 * `SchedulingRepository.cancel` preserves a recorded attendance: a consultation
 * that was held and whose job was then cancelled keeps `status = 'completed'`,
 * because overwriting it erased the fact that the meeting happened. The
 * cancellation goes to `cancel_reason` and `cancelled_by` instead.
 *
 * So a job can be thoroughly called off while its status says `completed`.
 * Five rows in production are in exactly that state, and every query filtering
 * `status = 'cancelled'` misses all five — including
 * `CashCancelledUnrefundedDetector`, whose whole purpose is money held on a
 * stopped job.
 *
 * `status === 'cancelled'` stays in the union rather than being replaced by it:
 * rows cancelled by older code paths carry no `cancel_reason`, and a booking
 * cancelled before it was ever held still writes the status.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS DELIBERATELY NOT HERE
 *
 * A STOPPED QUOTE also ends a job, and stopping one touches no booking — a
 * bookingless quote has no appointment to cancel — so no column here can see
 * it. That clause belongs to whichever caller holds the proposal, and
 * `quoteGate` has it as `proposalStatus === 'stopped'`. Folding it in would
 * mean every caller had to supply a proposal just to ask about a booking.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function jobCalledOff(booking: BookingFacts): boolean {
  return (
    booking.status === 'cancelled' ||
    Boolean(booking.cancel_reason) ||
    Boolean(booking.cancelled_by)
  );
}

/**
 * The statuses that still occupy their time.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A booking that WILL NOT HAPPEN does not hold a slot. Two statuses mean
 * exactly that — `cancelled` and `no_show` — and only the first was ever
 * released.
 *
 * So marking a client as a no-show left their appointment sitting on the
 * calendar. The owner had just decided that meeting is not taking place, and
 * invited the person to pick another time, while the original slot stayed shut
 * to everyone including them.
 *
 * `completed` stays in the list. It is necessarily in the past, so it is never
 * offered anyway, and keeping it means the calendar cannot be double-booked
 * retrospectively.
 *
 * `pending` stays too, and for the opposite reason: a payment or a quote is
 * outstanding, the client is still expecting that time, and releasing it sells
 * their slot to somebody else.
 *
 * NOTHING IS DELETED by releasing a slot. The booking row keeps its status and
 * its history; it simply stops blocking the calendar.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const SLOT_HOLDING_STATUSES = ['confirmed', 'pending', 'completed'] as const;

/**
 * The same rule as `holdsSlot`, for a PostgREST query.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `.in('status', SLOT_HOLDING_STATUSES)` is no longer the whole question. Held
 * and no-show write `meeting_status` and leave the job's status alone, so a
 * missed appointment stays `confirmed` and a status filter alone would go on
 * blocking its time — against everyone, including the client being invited to
 * rebook.
 *
 * Chain it after the status filter:
 *
 *     .in('status', SLOT_HOLDING_STATUSES)
 *     .or(MEETING_HOLDS_SLOT_FILTER)
 *
 * Written as `is null OR eq held` rather than `not in (no_show, cancelled)`
 * deliberately: in SQL, `NULL NOT IN (…)` is NULL, not true, so the negated
 * form would silently drop every unmarked meeting — which is almost all of
 * them — and free slots that are genuinely taken.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const MEETING_HOLDS_SLOT_FILTER = 'meeting_status.is.null,meeting_status.eq.held';

/**
 * Whether a booking in this state still occupies its time.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TAKES THE MEETING'S OUTCOME TOO, AND HAS TO.
 *
 * This read `status` alone, which worked only while every meeting outcome
 * overwrote it. Marking a no-show wrote `status = 'no_show'`, that value is
 * absent from the list above, and the slot was freed as a side effect.
 *
 * Held and no-show now write `meeting_status` and leave the job's status
 * alone — so a missed appointment stays `confirmed`, and without this it would
 * go on blocking the calendar against everyone including the client being
 * invited to rebook. That is the exact bug the no-show release was added to
 * fix, and it would have come straight back.
 *
 * Still accepts a bare status string, because several callers hold nothing
 * else: an availability query selecting one column, a slot check on a row it
 * never fetched in full. Those keep the old behaviour, which is correct for
 * every row written before this column existed.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function holdsSlot(booking: unknown): boolean {
  if (typeof booking === 'string') {
    return (SLOT_HOLDING_STATUSES as readonly string[]).includes(booking);
  }
  if (!booking || typeof booking !== 'object') return false;

  const { status, meeting_status: meetingStatus } = booking as BookingFacts;

  /*
   * A meeting that will not happen does not hold its time, whatever the job
   * says. `moved` is in the list for the same reason: the appointment is now
   * at a different hour, so this one is an abandoned time that must go back on
   * sale. Falling through instead returned true off the job's `confirmed`
   * status and kept the old hour blocked forever.
   */
  if (meetingStatus === 'no_show' || meetingStatus === 'cancelled' || meetingStatus === 'moved') {
    return false;
  }

  /*
   * `held` keeps its slot: it is necessarily in the past, so it is never
   * offered anyway, and keeping it means the calendar cannot be double-booked
   * retrospectively — the same reason `completed` is in the list above.
   */
  if (meetingStatus === 'held') return true;

  return typeof status === 'string' && (SLOT_HOLDING_STATUSES as readonly string[]).includes(status);
}

/**
 * The statuses that mean the appointment's outcome is already on record.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The three ways a booking ends. Whichever one it is, there is nothing left for
 * the CLIENT to do about that appointment — which is the question the public
 * manage-link routes need answered, and the one they were not asking.
 *
 * All three intake routes tested `=== 'cancelled'` alone, so a client whose
 * meeting had been marked `no_show` could still open the form, submit it and
 * upload files to it. The answers landed on a booking nobody was going to look
 * at again, and the owner's card had already stopped asking for them.
 *
 * Deliberately NOT the same question as `holdsSlot`. That one asks whether the
 * calendar is blocked, and `completed` is in it precisely because a past
 * meeting must not be double-booked retrospectively. This asks whether the
 * story is over, and for a finished meeting it is.
 *
 * The same split the booking card draws between `attendanceRecorded` — has this
 * appointment been dealt with — and `jobIsOver`, which is about the work. This
 * is the first question, and it lives here because this file imports nothing
 * and can therefore be reached from a public route with no service-role key.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const SETTLED_BOOKING_STATUSES = ['cancelled', 'completed', 'no_show'] as const;

/** Has this appointment already ended, one way or another? */
export function outcomeRecorded(status: unknown): boolean {
  return (
    typeof status === 'string' && (SETTLED_BOOKING_STATUSES as readonly string[]).includes(status)
  );
}

/**
 * Did the DATABASE refuse this write because the slot was taken?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `scheduling_bookings_no_overlap` (20261001) is an exclusion constraint, and it
 * exists because every overlap check in the platform is SELECT-then-INSERT with
 * no lock: two requests arriving together both read a free slot and both write.
 * The constraint is the one check that cannot be raced.
 *
 * So a `23P01` here is not a defect — it is the race actually happening, and the
 * client must be told their time has gone rather than shown an internal error.
 * Callers map it onto the same `BookingSlotUnavailableError` the pre-check
 * raises, so every surface that already handles a clash handles this too.
 *
 * Matched on the code, with the constraint name as a fallback: PostgREST
 * surfaces `code`, but a driver that only carries a message must still be
 * readable.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export function isSlotTakenError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const code = (error as { code?: unknown }).code;
  if (code === '23P01') return true;

  /*
   * Both overlap constraints, for a driver that surfaces a message and no
   * code. `scheduling_meetings_no_overlap` (20261085) is the one that refuses
   * a raced package session, whose booking carries no time of its own and is
   * therefore invisible to the bookings constraint. Named explicitly rather
   * than matched loosely, so an exclusion violation from some other table is
   * still reported as the fault it is.
   */
  const message = (error as { message?: unknown }).message;
  return (
    typeof message === 'string' &&
    (message.includes('scheduling_bookings_no_overlap') ||
      message.includes('scheduling_meetings_no_overlap'))
  );
}
