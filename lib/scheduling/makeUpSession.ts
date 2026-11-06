/**
 * Booking a replacement for a session that was missed.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO MECHANISMS MEANT THE SAME THING AND RECORDED IT DIFFERENTLY
 *
 * "Rebook the session they missed" had two implementations:
 *
 *   · the OWNER's drawer added a MAKE-UP — a new `session_number`, its first
 *     occurrence, carrying `replaces_meeting_id` back to the hour it stands in
 *     for. The missed row survives, keeps `no_show`, and keeps its fee.
 *
 *   · the CLIENT's portal MOVED the session — same `session_number`, the next
 *     `occurrence_number` — on the assumption that the superseded row would be
 *     stamped `moved`.
 *
 * That assumption does not hold for a missed session. `move_meeting`
 * (20261087) stamps `moved` only `IF v_old.meeting_status IS NULL`, which is
 * right — it refuses to erase a recorded outcome — so a client rebooking a
 * no-show left TWO live rows on one `session_number`.
 *
 * Nothing is built for that. Every reader de-duplicates by
 * `booking_id#session_number` and keeps the highest occurrence, so the missed
 * row — the one holding the money — simply disappeared: from the client's list,
 * from the money lines in emails, from the job's mirrored status, and from the
 * owner's drawer. `moveMeeting` then re-pointed its pending stage at the new
 * attempt, so the fee for an hour nobody attended moved to one nobody had
 * attended YET.
 *
 * Four packages reached that state in production. In every one the first
 * occurrence was `no_show`, which is the signature of this path and not a
 * coincidence.
 *
 * So there is one mechanism now, and it is the owner's: rebooking a missed
 * session APPENDS a session and points it back at what it replaces. The missed
 * hour stays missed, which is the true record and the thing the money hangs on.
 *
 * ── THE MONEY, WHICH THE CLIENT IS NEVER ASKED ABOUT ────────────────────────
 *
 * The owner's dialog has a `charge` toggle. The client's has nothing, and is
 * not going to: "should this session be billed" is not their decision. But the
 * answer cannot be "no" by default either, which is what happened until now —
 * the replacement was created with no stage at all, so holding it billed
 * NOTHING and the owner gave away a session without deciding to. All four
 * packages found in this state had exactly that shape: a cancelled stage on the
 * missed hour and no stage on its replacement.
 *
 * So it is derived from two facts, neither of which is the client's to decide.
 *
 * First, how the package is SOLD — the rule the owner's route already states:
 *
 *   · UPFRONT block — the money is already in. The replacement takes the missed
 *     session's portion and is never billed again. No stage.
 *   · PER-SESSION block — nothing has been paid for the hour that was missed;
 *     a session is billed when it is HELD. So the replacement carries a stage
 *     of its own, priced exactly like the ones beside it, or the client
 *     receives a session nobody ever invoices.
 *
 * Second, and added later, what the OWNER already decided about the missed
 * hour. The sale rule alone double-billed: a no-show the owner chose to CHARGE
 * still produced a stage on the replacement, so the client paid twice for one
 * delivered hour the moment they picked their new date. The owner's own dialog
 * had mirrored this since it was caught giving sessions away; this path had
 * not.
 *
 *   · missed stage BILLED — the hour is paid for. The make-up carries no stage.
 *   · missed stage VOIDED — nothing was charged. The replacement is billed, if
 *     the package bills per session at all.
 *
 * Both must hold. The sale rule says whether a stage is POSSIBLE; the owner's
 * decision says whether this replacement should carry one.
 *
 * The missed session's own stage is left exactly as the owner left it. That is
 * the other half of the fix: today `moveMeeting` silently re-points it at the
 * replacement, so a fee raised for an hour nobody attended quietly becomes a
 * charge for one nobody has attended yet.
 *
 * @module lib/scheduling/makeUpSession
 */

import { schedulingBookingRepository } from '@/lib/repositories/SchedulingRepository';
import { supabaseServer } from '@/lib/supabaseServer';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'MakeUpSession' });

/**
 * The next session number in a package.
 *
 * The HIGHEST so far, not the count: a package whose third session was deleted
 * still has a sixth, and reusing its number would put two sessions in the same
 * place in the series. Lifted out of the owner's add-session route so the two
 * callers cannot drift apart on it.
 */
export function nextSessionNumber(
  rows: ReadonlyArray<{ session_number?: number | string | null }>
): number {
  return Math.max(0, ...rows.map(row => Number(row.session_number ?? 0))) + 1;
}

export interface MakeUpRequest {
  userId: string;
  /** The purchase the sessions hang off — a session has no booking of its own. */
  containerId: string;
  /** The missed session this one stands in for. */
  missedMeetingId: string;
  startTime: string;
  endTime: string;
  timezone?: string | null;
  /**
   * Every session row of this package, used only to pick the next number.
   * Passed in rather than re-queried: both callers already hold it.
   */
  siblings: ReadonlyArray<{ session_number?: number | string | null }>;
}

/**
 * Add the replacement session. Returns the new meeting's id.
 *
 * `isSlotTakenError` on the returned error means the hour is genuinely somebody
 * else's and nothing was written — the caller answers 409 and the missed
 * session is untouched, exactly as before the attempt.
 */
export async function bookMakeUpSession(
  request: MakeUpRequest
): Promise<{ id: string | null; error: Error | null; charged?: boolean }> {
  const sessionNumber = nextSessionNumber(request.siblings);

  const created = await schedulingBookingRepository.createMeeting({
    user_id: request.userId,
    booking_id: request.containerId,
    start_time: request.startTime,
    end_time: request.endTime,
    timezone: request.timezone ?? null,
    session_number: sessionNumber,
    /* The first attempt at a NEW session. A make-up is not another go at the
       missed one — that is the distinction this whole module exists to keep. */
    occurrence_number: 1,
    replaces_meeting_id: request.missedMeetingId,
  });

  if (created.error || !created.data) {
    return { id: null, error: (created.error as Error) ?? new Error('Could not add the session') };
  }

  logger.info(
    {
      containerId: request.containerId,
      replaces: request.missedMeetingId,
      sessionNumber,
      startTime: request.startTime,
    },
    'Replacement session booked for a missed hour'
  );

  const charged = await chargeIfSoldPerSession({
    userId: request.userId,
    containerId: request.containerId,
    meetingId: created.data.id,
    sessionNumber,
    missedMeetingId: request.missedMeetingId,
  });

  return { id: created.data.id, error: null, charged };
}

/**
 * What the stage a newly added session bills is called.
 *
 * Follows the wording already on the plan — "פגישה 6" becomes "פגישה 9" —
 * because a client reads these as one list, and the same thing named two ways
 * is the shape that gets misread. `sessionNumber` is the SESSION this bills,
 * not the stage's own place in the plan: the two diverge the moment a session
 * is added without a charge.
 *
 * The suffix group is not cosmetic — a label ending in a bracket, "Package
 * (13)", matches nothing if the pattern is anchored on digits alone, and the
 * previous label would then be reused verbatim, putting one name on two stages.
 */
function nextStageLabel(
  previousLabel: string | null,
  sessionNumber: number,
  quoteTitle: string
): string {
  if (!previousLabel) return `${quoteTitle} (${sessionNumber})`;

  const trailing = previousLabel.match(/^(.*?)(\d+)(\D*)$/);
  if (trailing) return `${trailing[1]}${sessionNumber}${trailing[3]}`;

  /* Named without a number — "On completion" — so numbering it would invent a
     sequence that is not there. */
  return previousLabel;
}

/**
 * Give the replacement a stage, but only where the package is billed per session.
 *
 * Never fatal: the session exists and the client has been told about it. A
 * stage that failed to write is money not yet billed, which the owner can see
 * and raise; refusing the booking over it would leave the client with no hour
 * at all. Returns whether one was created, so the caller can say so.
 */
async function chargeIfSoldPerSession(args: {
  userId: string;
  containerId: string;
  meetingId: string;
  sessionNumber: number;
  /** The hour this replaces, so its stage can be read. */
  missedMeetingId: string;
}): Promise<boolean> {
  try {
    /*
     * ───────────────────────────────────────────────────────────────────────
     * ONE PAYMENT PER HOUR THE CLIENT ACTUALLY GETS.
     *
     * How the package is sold decides whether a replacement CAN carry a stage.
     * It does not decide whether this one SHOULD, and that distinction was
     * missing: the owner has already answered the money question on the
     * no-show dialog, and the answer lives on the missed session's own stage.
     *
     *   missed stage BILLED  →  the client has paid for this hour already.
     *                           The make-up is the owner's gift and carries
     *                           no stage.
     *   missed stage VOIDED  →  nothing was charged for the missed hour, so
     *                           the replacement is what gets billed.
     *
     * The owner's drawer has mirrored the waiver since it was found giving
     * sessions away — see `missedHourWasWaived` in `CRMContactDrawerV2`. The
     * CLIENT's path did not, so a no-show the owner chose to CHARGE produced a
     * second stage the moment the client picked their new date: two charges,
     * one delivered hour, and nothing on either screen saying so.
     *
     * Read from the stage rather than passed in, because this path has no
     * dialog to ask: the client is never shown the money question and is not
     * going to be. The owner's decision is already recorded, and this is where
     * it is honoured.
     * ───────────────────────────────────────────────────────────────────────
     */
    const { data: missedStages, error: missedError } = await supabaseServer
      .from('payment_plan_installments')
      .select('id, status')
      .eq('meeting_id', args.missedMeetingId)
      .eq('user_id', args.userId);

    if (missedError) {
      /*
       * Could not read it. Bill nothing rather than risk billing twice: an
       * unbilled make-up is money the owner can still raise, where a duplicate
       * charge has already reached the client.
       */
      logger.error(
        { err: missedError, missedMeetingId: args.missedMeetingId },
        'Could not read the missed session’s stage; leaving the make-up unbilled'
      );
      return false;
    }

    /* `cancelled` is how a waiver is recorded. Anything else — pending, sent,
       paid — is money the client already owes or has paid for that hour. */
    const missedWasCharged = (missedStages ?? []).some(
      stage => String((stage as { status?: unknown }).status) !== 'cancelled'
    );

    if (missedWasCharged) {
      logger.info(
        { containerId: args.containerId, missedMeetingId: args.missedMeetingId },
        'The missed hour was charged, so its make-up carries no stage'
      );
      return false;
    }

    const { data: proposal } = await supabaseServer
      .from('proposals')
      .select('id, title, currency, created_plan_id, sessions, contact_id')
      .eq('package_booking_id', args.containerId)
      .eq('user_id', args.userId)
      .maybeSingle();

    const perSession = Boolean(
      (proposal?.sessions as { bill_per_session?: boolean } | null)?.bill_per_session
    );

    /* Upfront, or sold without a plan: the hour is already paid for. */
    if (!perSession || !proposal?.created_plan_id) return false;

    /*
     * The amount is COPIED from the stages already on this plan rather than
     * recomputed from the total: it is what the client has been paying per
     * session, and one priced differently from the rest would be a change to
     * the deal nobody mentioned.
     */
    const { data: existing } = await supabaseServer
      .from('payment_plan_installments')
      .select('amount, currency, installment_number, label')
      .eq('payment_plan_id', proposal.created_plan_id)
      .eq('user_id', args.userId)
      .order('installment_number', { ascending: false })
      .limit(1)
      .maybeSingle();

    const amount = Number(existing?.amount ?? 0);
    if (!(amount > 0)) return false;

    const { paymentPlanRepository } = await import('@/lib/repositories/PaymentPlanRepository');

    const { error } = await paymentPlanRepository.createInstallments([
      {
        user_id: args.userId,
        payment_plan_id: proposal.created_plan_id,
        contact_id: proposal.contact_id,
        proposal_id: proposal.id,
        /*
         * The job the money belongs to, and WHICH session it bills. A session
         * has no booking of its own, so the stage points at the purchase and
         * names the meeting — otherwise every added session's stage would share
         * one `booking_id` and `billSessionOnCompletion` could not tell them
         * apart.
         */
        booking_id: args.containerId,
        meeting_id: args.meetingId,
        installment_number: Number(existing?.installment_number ?? 0) + 1,
        amount,
        currency: String(existing?.currency ?? proposal.currency ?? 'USD'),
        label: nextStageLabel(
          (existing?.label as string | null) ?? null,
          args.sessionNumber,
          String(proposal.title ?? '')
        ),
        trigger: 'manual',
        due_date: null,
        status: 'pending',
      },
    ] as Parameters<typeof paymentPlanRepository.createInstallments>[0]);

    if (error) {
      logger.error(
        { err: error, containerId: args.containerId, meetingId: args.meetingId },
        'Replacement session booked but its stage could not be created'
      );
      return false;
    }

    logger.info(
      { containerId: args.containerId, meetingId: args.meetingId, amount },
      'Replacement session carries its own stage (package is billed per session)'
    );

    return true;
  } catch (err) {
    logger.error({ err, containerId: args.containerId }, 'Could not price the replacement session');
    return false;
  }
}
