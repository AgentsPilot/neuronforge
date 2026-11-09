/**
 * One payment per hour the client actually gets.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS EXISTS TO STOP
 *
 * Measured on a live account (package 83e8460c, proposal "Quotation Offering
 * time", billed per session at about 400):
 *
 *   session 1        no_show, CHARGED. Client paid 399.99, invoice raised
 *   session 5 occ 1  the make-up, replaces session 1, carries NO stage
 *                    (correct: that hour's money is already in)
 *   session 5 occ 2  written by a MOVE, and before 20261109 a move dropped
 *                    `replaces_meeting_id` — so this row looks like an
 *                    ordinary session
 *   session 6        booked to replace occ 2, and billed 400.02
 *
 * Two charges, one delivered hour, and every guard that should have caught it
 * was reading one hop back: `chargeIfSoldPerSession` asks whether the hour
 * being replaced was charged, and occ 2 had no stage of its own because the
 * money sat on session 1, two hops up.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT JUDGES ANCESTORS AND NEVER THE REPLACED HOUR ITSELF
 *
 * This is the whole correctness argument, so it is written out.
 *
 * Both dialogs book the replacement BEFORE they post the outcome, so that the
 * one email the client receives lists the new session. The consequence is that
 * when this runs, the hour being replaced still carries whatever stage it had
 * a moment ago, and what becomes of that stage has NOT been decided yet:
 *
 *   · cancel a session      its stage is about to be VOIDED, so its
 *                           replacement must be billed
 *   · no-show, waived       same, and the owner chose it
 *   · no-show, charged      the stage stays live, and the owner's dialog
 *                           already passes `charge: false`
 *
 * A rule that read the replaced hour's own stage would see `pending` in all
 * three and refuse to bill in all three. The first two would then hand the
 * client a session nobody invoices, which is the defect this product was
 * caught in before (four packages, every one with a cancelled stage on the
 * missed hour and no stage on its replacement).
 *
 * ANCESTORS are different. An ancestor's outcome was recorded in an earlier
 * action, so its stage has settled: `cancelled` means that hour was waived and
 * nothing was collected for it, anything else means the client owes or has
 * paid. That is a fact, not a decision in flight, and it is the only thing
 * safe to judge here.
 *
 * So:
 *
 *   an ancestor hour holds a live stage  →  this hour is already paid for,
 *                                           and its replacement carries no
 *                                           charge, whatever the caller asked
 *   every ancestor stage is cancelled    →  nothing was collected up the
 *   (or there are no ancestors)              chain. The caller's own answer
 *                                            about THIS hour decides, which is
 *                                            how the waiver still bills its
 *                                            make-up
 *
 * The second line is what keeps the documented behaviour intact: waiving a
 * no-show and booking a make-up still moves the charge onto the make-up, as
 * the dialog promises in three languages.
 *
 * @module lib/scheduling/replacementCharge
 */

import { supabaseServer } from '@/lib/supabaseServer';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'ReplacementCharge' });

/**
 * How far up a chain of replacements to walk.
 *
 * A chain grows by one every time a make-up is itself missed and made up
 * again. Ten is far beyond anything a real package does and is here only so a
 * cycle — which `replaces_meeting_id` has no constraint against — cannot spin
 * for ever. Hitting the limit is reported, never silently treated as "nothing
 * found": that would bill the client.
 */
const MAX_CHAIN = 10;

/** A stage that was voided. Every other status is money owed or collected. */
const WAIVED = 'cancelled';

export interface ReplacedHourVerdict {
  /**
   * An ancestor hour is already charged or paid, so this replacement must not
   * carry a stage of its own.
   */
  alreadyPaid: boolean;
  /** The ancestor holding the money, for the log and the audit detail. */
  paidMeetingId: string | null;
  /** How many hops were walked, so a long chain is visible in the logs. */
  hops: number;
  /**
   * The read failed, or the chain was longer than `MAX_CHAIN`.
   *
   * `alreadyPaid` is TRUE whenever this is set. Billing nothing is the safe
   * side of this question: an unbilled make-up is money the owner can still
   * raise and can see on the plan, where a duplicate charge has already
   * reached the client.
   */
  uncertain: boolean;
}

/**
 * Has the hour this replacement stands in for already been paid for?
 *
 * Walks `replaces_meeting_id` strictly UPWARD from `replacedMeetingId` — that
 * row's own stage is deliberately not read, see the note above — and answers on
 * the first ancestor holding a stage that is not `cancelled`.
 */
export async function replacedHourAlreadyPaid(args: {
  userId: string;
  /** The hour being replaced. Its ANCESTORS are what get judged. */
  replacedMeetingId: string;
  /** Injectable for tests; the service-role client by default. */
  client?: typeof supabaseServer;
}): Promise<ReplacedHourVerdict> {
  const db = args.client ?? supabaseServer;

  const seen = new Set<string>([args.replacedMeetingId]);
  let current = args.replacedMeetingId;
  let hops = 0;

  try {
    while (hops < MAX_CHAIN) {
      const { data: row, error } = await db
        .from('scheduling_meetings')
        .select('id, replaces_meeting_id')
        .eq('id', current)
        .eq('user_id', args.userId)
        .maybeSingle();

      if (error) {
        logger.error(
          { err: error, meetingId: current, hops },
          'Could not read the replacement chain; treating the hour as paid'
        );
        return { alreadyPaid: true, paidMeetingId: null, hops, uncertain: true };
      }

      const ancestorId = (row as { replaces_meeting_id?: string | null } | null)
        ?.replaces_meeting_id;

      /* The top of the chain: an ordinary session, which nothing above has
         paid for. The caller's own answer about this hour decides. */
      if (!ancestorId) {
        return { alreadyPaid: false, paidMeetingId: null, hops, uncertain: false };
      }

      /* `replaces_meeting_id` has no constraint stopping a cycle, and a cycle
         here would be an endless loop in a money path. */
      if (seen.has(ancestorId)) {
        logger.error(
          { meetingId: ancestorId, hops },
          'The replacement chain loops; treating the hour as paid'
        );
        return { alreadyPaid: true, paidMeetingId: null, hops, uncertain: true };
      }

      seen.add(ancestorId);
      hops += 1;

      const { data: stages, error: stageError } = await db
        .from('payment_plan_installments')
        .select('id, status')
        .eq('meeting_id', ancestorId)
        .eq('user_id', args.userId);

      if (stageError) {
        logger.error(
          { err: stageError, meetingId: ancestorId, hops },
          'Could not read an ancestor hour’s stage; treating the hour as paid'
        );
        return { alreadyPaid: true, paidMeetingId: null, hops, uncertain: true };
      }

      const charged = (stages ?? []).some(
        stage => String((stage as { status?: unknown }).status) !== WAIVED
      );

      if (charged) {
        logger.info(
          { replacedMeetingId: args.replacedMeetingId, paidMeetingId: ancestorId, hops },
          'An hour up the chain is already charged, so this replacement carries no stage'
        );
        return { alreadyPaid: true, paidMeetingId: ancestorId, hops, uncertain: false };
      }

      current = ancestorId;
    }

    logger.error(
      { replacedMeetingId: args.replacedMeetingId, hops },
      'The replacement chain is longer than the walk allows; treating the hour as paid'
    );
    return { alreadyPaid: true, paidMeetingId: null, hops, uncertain: true };
  } catch (err) {
    logger.error(
      { err, replacedMeetingId: args.replacedMeetingId },
      'Could not decide whether the replaced hour was paid; treating it as paid'
    );
    return { alreadyPaid: true, paidMeetingId: null, hops, uncertain: true };
  }
}
