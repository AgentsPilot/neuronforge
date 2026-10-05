/**
 * The meeting happened, so the client is billed for it.
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
  userId: string
): Promise<BilledSession | null> {
  try {
    /*
     * Service role, scoped by `user_id` (CLAUDE.md rule 4). One row: a meeting
     * bills one stage, and `installment_number` decides which if a hand-edited
     * plan ever bound two.
     */
    const { data: stage, error } = await supabaseServer
      .from('payment_plan_installments')
      .select('id, installment_number, amount, label')
      .eq('booking_id', bookingId)
      .eq('user_id', userId)
      .eq('status', 'pending')
      .eq('trigger', 'manual')
      .order('installment_number', { ascending: true })
      .limit(1)
      .maybeSingle();

    if (error) {
      logger.error({ err: error, bookingId }, 'Could not look for a session stage to bill');
      return null;
    }

    if (!stage) return null;

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
