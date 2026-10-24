/**
 * One booking card's next step, read off the data the drawer already holds.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The rules live in `lib/business-os/bookingNextStep`, which knows nothing
 * about this drawer. This is the adapter: it reads the card's own shape and
 * hands that module the facts, so four surfaces — the header badge, whether
 * the card opens itself, which stage is lit, and where the booking sorts — all
 * come from ONE answer.
 *
 * That is the point. Every bug this came out of is the same disease: one
 * question answered independently in several places, which then drift.
 */

import {
  bookingNextStep,
  type IntakeState,
  type NextStep,
  type PackageProgress,
} from '@/lib/business-os/bookingNextStep';
import { moneyInHand, moneyStateFrom } from './moneyState';
import type { SessionCardData } from './types';

/**
 * `is_scheduled`, never a guess from the timestamp.
 *
 * Reading "has no start time" once reclassified a SCHEDULED booking that was
 * missing its time, hiding the very thing that was wrong. The timestamp
 * survives only as a fallback for a row that did not carry the column.
 */
function isUnscheduled(booking: SessionCardData['booking']): boolean {
  return (
    booking.service?.is_scheduled === false ||
    (booking.service?.is_scheduled == null && !booking.start_time)
  );
}

/**
 * The form's state, and `not_used` is by far the common case.
 *
 * A form is only worth anything ANSWERED BEFORE the meeting, which is why
 * `bookingNextStep` lets it be owed while the meeting is still ahead and drops
 * it the moment the meeting's time passes.
 */
function intakeStateFrom(booking: SessionCardData['booking']): IntakeState {
  const answered = Object.keys(booking.intake_responses?.responses ?? {}).length > 0;
  if (answered || booking.intake_completed_at) return 'answered';
  // Nothing asked for, and nothing to ask: this service has no form.
  if (!booking.intake_sent_at) return 'not_used';
  return 'sent_unanswered';
}

/**
 * A package's meetings, counted by whether an outcome is on record.
 *
 * A package is ONE journey with many appointments, not many jobs — so the
 * container stays "running" until every child is settled, rather than
 * reporting itself finished because the first session was held.
 */
function packageProgressFrom(session: SessionCardData): PackageProgress | null {
  const meetings = session.meetings ?? [];
  if (meetings.length === 0) return null;

  const settled = meetings.filter(meeting => {
    const booking = meeting.booking;
    return (
      booking.meeting_status != null ||
      booking.status === 'completed' ||
      booking.status === 'cancelled' ||
      booking.status === 'no_show'
    );
  }).length;

  return { total: meetings.length, settled };
}

export function sessionNextStep(session: SessionCardData, now?: Date): NextStep {
  const booking = session.booking;

  /*
   * A package's MEETING is not a quoted job of its own: the quote that created
   * it was already accepted, so asking for a price again would be asking a
   * question that has an answer.
   */
  const isQuoted = booking.service?.sale_mode === 'proposal' && !booking.parent_booking_id;

  /*
   * `'none'` IS A STRING, AND THAT COST A BANNER.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * The journey step carries `proposalStatus: proposal?.status ?? 'none'` — a
   * literal word, not an absence. Passed through, it reached `quoteGate`'s
   * `if (proposalStatus) return 'open'`, which is a TRUTHINESS test: `'none'`
   * passes it, so the gate reported the quote step open without ever looking at
   * the meeting, and the card told an owner to send a price for a consultation
   * nobody had marked as held.
   *
   * Normalised here, at the boundary where the string comes in. The gate has
   * been hardened too, so neither alone is load-bearing.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const rawProposalStatus = isQuoted
    ? ((session.journeySteps?.find(step => step.key === 'proposal')?.metadata
        ?.proposalStatus as string | undefined) ?? null)
    : null;
  const proposalStatus =
    rawProposalStatus && rawProposalStatus !== 'none' ? rawProposalStatus : null;

  const latestAttempt = booking.attempts?.length
    ? booking.attempts[booking.attempts.length - 1]
    : null;

  return bookingNextStep({
    booking,
    startTime: booking.start_time ? new Date(booking.start_time) : null,
    isUnscheduled: isUnscheduled(booking),
    isQuoted,
    proposalStatus,
    money: moneyStateFrom(session.payment),
    /* Read from the amounts rather than the state machine, for the reason
       `moneyInHand` records: after a stop, "all stages settled" is the same
       word whether the deposit was banked or never taken. */
    moneyInHand: moneyInHand(session.payment),
    /*
     * A period CANCELLED rather than paid: the arrangement was stopped part
     * way. `moneyStateFrom` cannot report it — a cancelled period counts as
     * settled, deliberately, so a stopped plan and a finished one both read
     * `'paid'` — and the next move differs completely between the two.
     */
    planStopped: (session.payment?.plan?.stages ?? []).some(
      stage => stage.status === 'cancelled'
    ),
    intake: intakeStateFrom(booking),
    packageProgress: packageProgressFrom(session),
    /*
     * Who put the appointment on the time it has NOW.
     *
     * The last attempt is the current one, and `moved_by` is null on the first
     * — a booking that was never moved reports nothing, which is right.
     * Undefined when the fetch did not ask for attempts, and the card then
     * behaves exactly as it did before.
     */
    /*
     * Both read from the CURRENT attempt, which is the last one.
     *
     * `moved_by` says who put the appointment on the time it now has;
     * `outcome_by` says who recorded what became of it. The booking carries a
     * copy of the outcome, but the attempt is where both live together, so
     * reading one from each place would eventually let them describe different
     * appointments.
     *
     * Null when the fetch did not ask for attempts, and the card then behaves
     * exactly as it did before either field existed.
     */
    lastMoveBy: latestAttempt?.moved_by ?? null,
    outcomeBy: latestAttempt?.outcome_by ?? null,
    /* On the BOOKING, not the attempt: it is an answer about the job, and the
       job outlives any one appointment. */
    proposalContinues: booking.proposal_continues ?? null,
    now,
  });
}
