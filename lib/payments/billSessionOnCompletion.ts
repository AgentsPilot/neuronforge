/**
 * The hour is spent, so the client is billed for it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TWO OUTCOMES REACH HERE, NOT ONE.
 *
 * A session marked HELD, and a session marked MISSED that the owner did not
 * waive. The money question is the same for both: the hour was held and will
 * not be held again, so the stage bound to it falls due. What differs is only
 * what the row says happened, which is not this function's business.
 *
 * Nothing in here keys on `meeting_status` — the claim is the stage's own
 * (`pending`, `manual`, bound to this meeting) — so the no-show path needed no
 * change. This note exists because the name says "onCompletion" and the
 * comments below say "held", and both now undersell it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS IS FOR
 *
 * A package sold "after each meeting" is approved with nothing due: ten
 * meetings, ten stages of a tenth each, every one `manual` and bound to its own
 * meeting. Nothing bills itself — which is the point, because a session that
 * has not happened is not owed for.
 *
 * This is the trigger. Marking a meeting as held bills the stage bound to that
 * meeting, through the SAME `billStage` the stages button in the drawer uses,
 * so there is one way a stage becomes an invoice however it was asked for.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY IT IS SAFE ON EVERY OTHER BOOKING
 *
 * It finds nothing unless a stage is bound to this exact booking AND is still
 * `pending` AND is `manual`:
 *
 *   · an ordinary booking has no stage bound to it;
 *   · a quoted job's stages are bound to the consultation, not to a session,
 *     and the owner bills those deliberately from the drawer — if one happens
 *     to be bound to this booking and waiting, billing it when the meeting is
 *     held is exactly what that stage means anyway;
 *   · a stage already billed is `billed` or `paid`, so pressing complete twice
 *     raises one invoice, not two. That is the whole of the idempotency, and it
 *     is enforced inside `billStage` by its own claim.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NEVER FATAL
 *
 * The meeting is already marked held when this runs. A failure here leaves a
 * stage unbilled — visible in the drawer, one button away — where throwing
 * would make the owner think the meeting had not been recorded. Same decision
 * the invoice voiding and the calendar sync already make on the cancel path.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { billStage } from '@/lib/services/PaymentStageBillingService';

const logger = createLogger({ module: 'billSessionOnCompletion' });

export interface BilledSession {
  stageId: string;
  invoiceId: string | null;
  amount: number | null;
}

/**
 * @returns what was billed, or null when this booking has no session stage
 *          waiting — which is almost every booking in the product.
 */
export async function billSessionOnCompletion(
  bookingId: string,
  userId: string,
  /**
   * WHICH session happened, when the job has several.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * A package is now one booking with N meetings, so N stages share one
   * `booking_id` and it can no longer say which of them is owed. Passing the
   * meeting makes it exact.
   *
   * Optional, and absent is not a legacy shim: it is the ordinary case. A
   * consultation, a milestone plan, a package from before the change — all
   * have one appointment per booking, and the booking key is unambiguous for
   * them. The lookup below refuses rather than guesses in the one case where
   * it would have to.
   * ───────────────────────────────────────────────────────────────────────────
   */
  meetingId?: string | null
): Promise<BilledSession | null> {
  try {
    /*
     * Service role, scoped by `user_id` (CLAUDE.md rule 4). One row: a meeting
     * bills one stage, and `installment_number` decides which if a hand-edited
     * plan ever bound two.
     */
    /*
     * ─────────────────────────────────────────────────────────────────────────
     * THE MEETING WHEN WE HAVE ONE, THE BOOKING WHEN WE DO NOT
     *
     * This was keyed on `booking_id` alone, on reasoning that was true and is
     * no longer: a per-session plan bound its stages to package CHILD
     * bookings, each with exactly one appointment, so the booking said which
     * session unambiguously. Measured then: of 81 stages bound to a booking,
     * zero belonged to a booking with more than one attempt.
     *
     * A package is now ONE booking with N meetings. Six stages share one
     * `booking_id`, and a lookup keyed on it takes the lowest
     * `installment_number` — which means marking session FOUR as held bills
     * session ONE, and the sixth press bills a stage that was already settled
     * by the first. On a path that raises real invoices.
     *
     * So `meeting_id` (20261074) is the key when the caller names a meeting.
     * It is exact: one stage, one session, whichever order they happen in.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const query = supabaseServer
      .from('payment_plan_installments')
      /*
       * `meeting_id` is selected even where it is not filtered on, because the
       * ambiguity check below reads it. A column absent from a select is
       * `undefined`, not null, and PostgREST rejects the whole query for one
       * unknown name — so this has to be asked for, not assumed.
       */
      .select('id, installment_number, amount, label, meeting_id')
      .eq('user_id', userId)
      .eq('status', 'pending')
      .eq('trigger', 'manual')
      .order('installment_number', { ascending: true });

    const { data: candidates, error } = meetingId
      ? await query.eq('meeting_id', meetingId).limit(1)
      : /*
         * TWO, not one, so the next line can tell "the only stage on this job"
         * apart from "one of several sessions, and nobody said which".
         */
        await query.eq('booking_id', bookingId).limit(2);

    if (error) {
      logger.error({ err: error, bookingId, meetingId }, 'Could not look for a session stage to bill');
      return null;
    }

    const stage = candidates?.[0];
    if (!stage) return null;

    /*
     * ─────────────────────────────────────────────────────────────────────────
     * REFUSE RATHER THAN GUESS, IN THE ONE CASE WHERE IT WOULD HAVE TO.
     *
     * Several pending manual stages on one booking is ORDINARY: a milestone
     * plan on a consultation is exactly that, and billing the lowest-numbered
     * one is right, because the stages are a sequence of payments against one
     * job.
     *
     * It stops being right when those stages are SESSIONS — each bound to its
     * own meeting — because then the order they are billed in is decided by
     * which meeting happened, not by their number. If that is the shape and
     * the caller did not say which session, the honest answer is not to bill.
     *
     * Unbilled is recoverable: the stage sits pending in the drawer, one
     * button away, and this logs which booking to look at. An invoice raised
     * against the wrong session is not — it has reached the client.
     * ─────────────────────────────────────────────────────────────────────────
     */
    if (!meetingId && stage.meeting_id && candidates && candidates.length > 1) {
      logger.error(
        { bookingId, stageId: stage.id, stages: candidates.length },
        'Several session stages share this booking and no meeting was named; billed nothing'
      );
      return null;
    }

    /*
     * `expectTrigger: 'manual'` so this can never bill a DATED stage, which the
     * reminder cron owns and which would then be billed twice. `billStage`'s own
     * claim — `status = pending AND invoice_id IS NULL` — is what makes pressing
     * complete twice raise one invoice rather than two.
     */
    const result = await billStage(stage.id as string, userId, {
      expectTrigger: 'manual',
      auditAction: 'PAYMENT_SESSION_BILLED',
    });

    if (result.failure) {
      /*
       * `already_done` is not a fault. Pressing complete twice, or a chat and a
       * button racing, both land here — and the right answer is that one
       * invoice exists. Logging it at error would make the normal case look
       * like a defect in the logs.
       */
      if (result.failure === 'already_done') {
        logger.debug({ bookingId, stageId: stage.id }, 'Session stage was already billed');
      } else {
        logger.error(
          { bookingId, stageId: stage.id, failure: result.failure },
          'A held session could not be billed'
        );
      }
      return null;
    }

    logger.info(
      { bookingId, stageId: stage.id, invoiceId: result.invoiceId, amount: result.amount },
      'Held session billed'
    );

    return {
      stageId: stage.id as string,
      invoiceId: result.invoiceId,
      amount: result.amount,
    };
  } catch (err) {
    logger.error({ err, bookingId }, 'Billing a held session threw');
    return null;
  }
}
