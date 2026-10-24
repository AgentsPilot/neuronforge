/**
 * Where the money stands on one booking, in the words `bookingNextStep` uses.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS NOT A `paid` BOOLEAN
 *
 * "Nothing was ever owed", "you have not asked for it yet" and "it is sitting
 * with the client" are three different answers and only ONE of them is a task.
 * Collapsing them is how a free intro meeting ends up in a chase list: an
 * account whose `פגישת היכרות` is priced at zero would be told, forever, that
 * it is awaiting payment.
 *
 * The distinction that earns its keep is `needs_invoice`. Work done and nobody
 * asked for the money is the most recoverable thing on the dashboard — the
 * client does not know they owe anything, so it is not late, it is missing —
 * and it is invisible unless something says it out loud.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE ASSUMPTION, STATED
 *
 * A pending payment with nothing sent is read as the OWNER's move. For an
 * invoiced service that is plainly right. For a card service the client was
 * given a link at booking, so it is arguably theirs — but a booking that is
 * still pending after the link was offered is one nobody is chasing, and
 * putting it in front of the owner is the safer error of the two.
 *
 * `refunded` counts as PAID. The question is whether money ever arrived, and
 * for a refunded job the answer is yes: it arrived and then went back. Reading
 * it as unpaid once invited an owner to chase a client for money already
 * returned.
 */

import type { MoneyState } from '@/lib/business-os/bookingNextStep';
import type { SessionPayment } from './types';

/** A plan stage is settled once its money is in, however it arrived. */
/*
 * A stage nobody will collect for.
 *
 * `cancelled` belongs here with the money that arrived and the money that went
 * back: all three mean the stage is finished with. Without it a cancelled stage
 * counted as OUTSTANDING, and because a milestone carries `trigger: 'manual'`
 * with no invoice, the card asked the owner to bill a stage that had just been
 * cancelled.
 */
const STAGE_SETTLED = ['paid', 'refunded', 'cancelled'];

/**
 * Has money arrived and stayed?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY `MoneyState` COULD NOT ANSWER THIS
 *
 * The card needed to know, on a job the owner has just stopped, whether there
 * is anything to give back. `MoneyState` cannot say: it reports `'paid'` for
 * "every stage is settled", and after a stop that is true of BOTH a quote whose
 * deposit was collected and the rest cancelled, AND a quote where nothing was
 * ever collected and every stage was cancelled. One owes the client ₪4,750 and
 * the other owes nothing, and they arrive here as the same word.
 *
 * So this is a separate question with a separate answer, derived from the
 * amounts rather than from the state machine.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT ERRS TOWARD SILENCE
 *
 * A stage marked `refunded` with no `refundedAmount` recorded is read as fully
 * returned. The figure is derived onto the invoice by trigger and a row written
 * before that existed carries none, so the alternative reading would tell an
 * owner to refund money they had already sent back — the one mistake worth
 * avoiding here, because the reminder is advice and a false one teaches them to
 * stop reading the banner.
 */
export function moneyInHand(payment: SessionPayment | null | undefined): boolean {
  if (!payment) return false;
  if (payment.status === 'free') return false;

  const kept = (amount: number | null | undefined, refunded: number | null | undefined, isRefunded: boolean) => {
    const paid = Number(amount ?? 0);
    const back = refunded != null ? Number(refunded) : isRefunded ? paid : 0;
    return paid - back > 0;
  };

  /* The stages are the money wherever there are any, same as above. */
  const stages = payment.plan?.stages;
  if (stages && stages.length > 0) {
    return stages.some(
      stage =>
        (stage.status === 'paid' || stage.status === 'refunded') &&
        kept(stage.amount, stage.refundedAmount, stage.status === 'refunded')
    );
  }

  /*
   * A uniform schedule with no named stages collects on dates, so the count of
   * periods already taken is the only record that anything arrived — its
   * `status` can still read `pending` with two instalments banked.
   */
  if (payment.plan && (payment.plan.periodsPaid ?? 0) > 0) return true;

  if (payment.status !== 'paid' && payment.status !== 'refunded') return false;

  return kept(payment.amount, payment.refundedAmount, payment.status === 'refunded');
}

export function moneyStateFrom(payment: SessionPayment | null | undefined): MoneyState {
  /*
   * No payment record at all. Nothing was ever owed on this booking — a free
   * service, or one whose price is zero. The alternative reading, "we have not
   * loaded it yet", would turn every slow fetch into a false task.
   */
  if (!payment) return 'nothing_to_collect';

  if (payment.status === 'free') return 'nothing_to_collect';

  /*
   * ── THE STAGES ANSWER BEFORE THE INVOICE DOES ───────────────────────────
   *
   * `payment.status` describes ONE invoice. On a staged quote that is the
   * first milestone, and it says nothing about the rest.
   *
   * This check sat below the `paid` line, so a deposit being paid returned
   * `'paid'` for the whole job and the card said "all done" over a quote with
   * half its money unbilled. Seen on an accepted 9,500 quote: מקדמה 4,750 paid,
   * "on completion" 4,750 still pending and waiting for the owner to bill it.
   *
   * Where a plan has stages, the stages are the money. The single-payment
   * reading below is for the bookings that have no plan at all.
   */
  const stages = payment.plan?.stages;
  if (stages && stages.length > 0) {
    const outstanding = stages.filter(stage => !STAGE_SETTLED.includes(stage.status));
    if (outstanding.length === 0) return 'paid';

    /*
     * A `manual` stage with no invoice raised is the owner's move: it falls due
     * when they say the work happened, and until they bill it nobody has asked
     * the client for anything. A `date` stage bills itself.
     */
    const owed = outstanding.some(stage => stage.trigger === 'manual' && !stage.invoiceId);
    return owed ? 'plan_needs_billing' : 'plan_auto';
  }

  /* No stages: one invoice decides it, which is what `status` describes. */
  if (payment.status === 'paid' || payment.status === 'refunded') return 'paid';

  if (payment.plan) {
    /*
     * A uniform instalment schedule with no named stages. It collects on dates,
     * so it asks nothing of the owner until it finishes or fails.
     */
    const { periodsPaid, installmentCount } = payment.plan;
    return periodsPaid !== undefined && periodsPaid >= installmentCount ? 'paid' : 'plan_auto';
  }

  /* ── A single payment ── */

  // Out with the client: they are holding a document that asks for the money.
  if (payment.invoiceStatus === 'sent' || payment.invoiceStatus === 'overdue') {
    return 'with_client';
  }

  /*
   * A DRAFT invoice is not an ask. It exists, which is why this cannot test
   * `invoiceId` alone, and the client has never seen it.
   */
  return 'needs_invoice';
}
