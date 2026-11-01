/**
 * Stopping an accepted quote part-way through: the money AND the job.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE GAP THIS CLOSES
 *
 * A client accepts a three-phase quote, pays phase one, then stops the work.
 * Phases two and three must come off the books and stop chasing them. Until
 * this module there were two ways to do that and a quote could fall between
 * both:
 *
 *   `cancelBooking`  closes stages by `booking_id`   (BookingLifecycleService)
 *   `cancelPlan`     closes periods by `subscription_id`  (cancelPlan.ts)
 *
 * A milestone quote has NO subscription — live data confirms it: every
 * installment on this account carries `subscription_id: null`, which is exactly
 * why `cancelBooking` filters on `subscription_id IS NULL` to find them. And
 * `proposals.booking_id` is nullable, documented in
 * `20260914_proposal_booking_link.sql` as "Null for quotes created before this
 * column existed, and for any raised outside a booking."
 *
 * So a quote raised from the CRM rather than from an appointment had no stop
 * path at all. Its stages sat `pending` forever: counted as owed, and chased at
 * the client by the installment pass of `processOverdueItems` on days 1, 3 and 7
 * in the owner's name, for a job that ended months ago.
 *
 * This is the third path, scoped by `proposal_id` — the one thing those stages
 * always have.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * STOPPING IS NOT REFUNDING
 *
 * The same line `cancelPlan` draws. This stops what has not happened and leaves
 * every record of what has: a client who walks away after phase one is usually
 * not owed phase one.
 *
 * Handing money back is the STANDARD refund dialog's job, opened afterwards by
 * whoever called this — exactly as cancelling a booking does it. This function
 * briefly grew a refund of its own, which put a second money-moving path beside
 * the reviewed one: no partial allocation rules, no over-refund guard, no
 * notify-the-client toggle. What it returns instead is `collected`, so a caller
 * can offer the real dialog only when there is something to give back.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE PRESS, BOTH HALVES
 *
 * Stopping the money and saying the job ended are the same decision, so they are
 * one call. Splitting them produced the state nobody can read: stages
 * `cancelled` while the quote still says `accepted`, indistinguishable from a job
 * that finished and was paid in full.
 *
 * The status moves `accepted` -> `stopped`, conditionally, and the reason is
 * recorded from a fixed list so it can be COUNTED. That is the point of
 * collecting it: a column of prose answers nothing about why jobs are lost.
 *
 * WHAT IS DELIBERATELY LEFT ALONE
 *
 *   paid / billed stages   money that arrived, or an invoice that stands as a
 *                          record. Never rewritten.
 *   subscription periods   real money still arriving on a live plan. Cancelling
 *                          those rows would falsify the books — the identical
 *                          exclusion `cancelBooking` makes.
 *   the ACCEPTANCE itself  `decided_at`, `accepted_snapshot`, the frozen tax
 *                          fields and every invoice raised against the quote.
 *                          This records how the job ENDED, never that it was not
 *                          agreed.
 *
 * @module lib/payments/cancelQuoteStages
 */

import { createLogger } from '@/lib/logger';
/*
 * STILL IMPORTED, and not an oversight. `lowerPlansForCancelledStages` takes a
 * client as its first argument — it is shared with the booking and subscription
 * stop paths, which hand it their own — so this file passes one too. Every
 * QUERY in here goes through a repository; what stays is the hand-off.
 */
import { supabaseServer } from '@/lib/supabaseServer';
import { paymentPlanRepository } from '@/lib/repositories/PaymentPlanRepository';
import { paymentInvoiceRepository, LIVE_INVOICE_STATUSES } from '@/lib/repositories/PaymentRepository';
import { proposalRepository } from '@/lib/repositories/ProposalRepository';
import { voidInvoice } from '@/lib/payments/invoiceLifecycle';
import type { StopReason } from '@/lib/business-os/cancellationReasons';

const logger = createLogger({ module: 'CancelQuoteStages' });

/*
 * `LIVE_INVOICE_STATUSES` IS NOW DECLARED IN `PaymentRepository.ts`, and its
 * sibling below stayed here.
 *
 * It moved with the query that applies it as a FILTER
 * (`paymentInvoiceRepository.findOpenForBooking`), and it is declared there
 * beside `ISSUED_INVOICE_STATUSES` with the one word between them spelled out —
 * `draft` against `pending` — because that is the pair a reader can confuse.
 * This file imports it for the per-stage check below, where the same list is
 * asked of a row already in hand rather than of the database.
 *
 * `SETTLED_INVOICE_STATUSES` stays here deliberately. It is only ever a
 * predicate over a returned row — this call site deciding what counts as
 * collected — so there is no query for it to travel with.
 */

/**
 * Invoice states meaning money arrived.
 *
 * `refunded` and `partially_refunded` are in: both were PAID, and the status
 * moves by trigger once some of it goes back. Leaving them out would report a
 * part-refunded stage as never paid — the same trap the revenue queries in
 * `app/api/business-os/stats` document at length.
 */
const SETTLED_INVOICE_STATUSES = ['paid', 'refunded', 'partially_refunded'];

export interface CancelQuoteStagesResult {
  ok: boolean;
  code?: 'NOT_FOUND';
  message?: string;
  /** Unbilled stages taken off the books. */
  stagesClosed: number;
  /** Invoices already raised for a stage, and now voided so nothing chases them. */
  invoicesVoided: number;
  /** True when there was nothing left to stop — calling twice is not an error. */
  alreadyClosed?: boolean;
  /**
   * What the client has actually paid across every stage, net of prior refunds.
   *
   * Returned so the caller can open the standard refund dialog only when there is
   * money — the same test a booking cancellation makes.
   */
  collected: number;
  /** The currency `collected` is in. */
  currency: string | null;
  /**
   * True when this call is what moved the quote to `stopped`.
   *
   * False on a second press: the status update is conditional on `accepted`, so
   * only the first one changes anything. Distinguishing them lets a caller say
   * "already stopped" instead of reporting work it did not do.
   */
  proposalStopped?: boolean;
}

export async function cancelQuoteStages(input: {
  /** The `proposals` row whose remaining stages should stop. */
  proposalId: string;
  userId: string;
  /**
   * Why the job ended, from `STOP_REASONS`. REQUIRED.
   *
   * Mandatory on every cancellation surface — see `cancellationReasons`. The
   * column stays nullable for rows that predate this, but nothing new may be
   * written without one: an owner is present and can answer.
   */
  reason: StopReason;
  /** The owner's own sentence. Never a substitute for `reason`. */
  note?: string;
  /**
   * Whether the owner's note reaches the client's email.
   *
   * Defaults to true. Turned off, the client still gets a NEUTRAL phrasing of the
   * reason code, so the email explains itself rather than going silent — the note
   * is the only thing withheld.
   */
  shareNoteWithClient?: boolean;
  /**
   * Also call off an invoice this quote raised OUTSIDE its stages.
   *
   * Off by default, and that default is the point: stopping is not refunding,
   * and the owner may still want paying for what was done. Only ever acts on an
   * invoice that is `draft`, `sent` or `overdue` — never one that has been paid
   * or refunded, which `voidInvoice` refuses in any case.
   */
  cancelUnpaidInvoice?: boolean;
}): Promise<CancelQuoteStagesResult> {
  const { proposalId, userId, cancelUnpaidInvoice = false } = input;

  /*
   * Confirm the quote is this user's BEFORE touching anything.
   *
   * The stage update below is scoped by `user_id` too, so this is not the only
   * guard — but without it, naming a stranger's proposal id would silently
   * update nothing and report success, which reads as "there was nothing to
   * stop" rather than "that is not yours".
   */
  const { data: proposal, error: proposalError } = await proposalRepository.findStopTarget(
    proposalId,
    userId
  );

  if (proposalError) {
    logger.error({ err: proposalError, proposalId }, 'Could not read the quote');
    return {
      ok: false,
      code: 'NOT_FOUND',
      message: 'This quote could not be found.',
      stagesClosed: 0,
      invoicesVoided: 0,
      collected: 0,
      currency: null,
    };
  }

  if (!proposal) {
    return {
      ok: false,
      code: 'NOT_FOUND',
      message: 'This quote could not be found.',
      stagesClosed: 0,
      invoicesVoided: 0,
      collected: 0,
      currency: null,
    };
  }

  /*
   * Void the invoices of stages already billed, BEFORE closing the unbilled ones.
   *
   * Order matters for what a half-finished run leaves behind. Invoices first
   * means a crash leaves stages still `pending` — visibly unfinished, and safe
   * to run again. Stages first would leave a closed stage beside an invoice
   * still chasing the client, which looks finished and is not.
   *
   * Read separately rather than updated in bulk because `voidInvoice` also
   * voids at Stripe and writes the audit entry. Skipping it would leave a
   * hosted invoice page payable after the job was called off.
   */
  const { data: billedStages, error: billedError } =
    await paymentPlanRepository.findBilledStagesForProposal(proposalId, userId);

  if (billedError) {
    logger.error({ err: billedError, proposalId }, 'Could not read the billed stages of this quote');
  }

  let invoicesVoided = 0;
  /*
   * Every invoice raised for this quote, voided or not.
   *
   * The refund targets hang off these. A stage that was PAID is not voided above
   * — `voidInvoice` refuses a settled invoice and we skip it before asking — so
   * the paid ones would be missing from any list built only from what we voided,
   * and those are precisely the ones with money to give back.
   */
  const stageInvoiceIds: string[] = [];
  /*
   * What the client has actually paid across every stage, for the email.
   *
   * From the INVOICES' own settled amounts rather than re-summing transactions:
   * these rows are already being read, and `amount - refunded_amount` on a
   * settled invoice is the figure the invoice itself shows the client. An email
   * quoting a different total from the paperwork they are holding is worse than
   * one quoting none.
   */
  let collectedForEmail = 0;
  /* The currency that money is in — a business may invoice a quote in its own. */
  let collectedCurrency: string | null = null;

  for (const stage of billedStages ?? []) {
    if (!stage.invoice_id) continue;
    stageInvoiceIds.push(stage.invoice_id);

    /*
     * Only the ones still asking for money. `voidInvoice` refuses a settled
     * invoice anyway (`loadUnsettled`), but checking first keeps a paid phase
     * from producing a scary error line in the log for a case that is correct.
     */
    const { data: invoice } = await paymentInvoiceRepository.findSettlementStateById(
      stage.invoice_id,
      userId
    );

    if (!invoice) continue;

    /*
     * Count what the client has paid on the way past.
     *
     * The settled invoices are exactly the ones this loop SKIPS — a paid invoice
     * is not voided — so summing here rather than in a second query is the only
     * place both facts are already in hand. Net of refunds already recorded, so a
     * previously part-refunded stage does not overstate what they are out.
     */
    if (SETTLED_INVOICE_STATUSES.includes(invoice.status)) {
      collectedForEmail +=
        Math.max(0, Number(invoice.amount ?? 0) - Number(invoice.refunded_amount ?? 0));
      /* Typed by `findSettlementStateById`; this needed a cast while the read
         was inline and the row had no type. */
      collectedCurrency ??= invoice.currency ?? null;
    }

    /*
     * Asked of the row, not of the database: this is the per-stage decision
     * about one invoice already in hand, so it stays a predicate at the call
     * site. The one place the same list IS a filter — the booking sweep below —
     * now applies it inside `findOpenForBooking`.
     */
    if (!(LIVE_INVOICE_STATUSES as readonly string[]).includes(invoice.status)) continue;

    const { error: voidError } = await voidInvoice({ invoiceId: invoice.id, userId });

    if (voidError) {
      // Reported, not fatal. One invoice the processor would not void must not
      // leave the other stages of the job still chasing the client.
      logger.warn({ err: voidError, proposalId, invoiceId: invoice.id }, 'Could not void a stage invoice');
      continue;
    }

    invoicesVoided += 1;
  }

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * THE INVOICE NO STAGE POINTS AT, when the owner asks for it to go.
   *
   * The loop above reaches invoices THROUGH stages, and a single-payment quote
   * has none: one invoice raised straight against the booking, and nothing
   * linking it back here — `payment_invoices` has no `proposal_id`. So stopping
   * such a quote left the invoice `sent`: owed, chased by the overdue pass, and
   * still PAYABLE, because the public page refuses only invoices already
   * settled. Two live quotes are in that state, one of them ₪5,000.
   *
   * Opt-in, and off by default, because stopping is not refunding. The owner
   * may well still want paying for work done before the job ended, and voiding
   * the invoice for them would decide that nothing is owed. The toggle in the
   * stop dialog is where that decision is made; this only carries it out.
   *
   * Scoped to the quote's OWN booking and to invoices still asking for money.
   * `voidInvoice` refuses a settled one, and the stage ids are excluded so an
   * invoice already handled above is not counted twice.
   * ───────────────────────────────────────────────────────────────────────────
   */
  if (cancelUnpaidInvoice && proposal.booking_id) {
    const { data: loose, error: looseError } = await paymentInvoiceRepository.findOpenForBooking(
      proposal.booking_id,
      userId
    );

    if (looseError) {
      logger.warn({ err: looseError, proposalId }, 'Could not read the booking invoices of this quote');
    }

    for (const invoice of loose ?? []) {
      if (stageInvoiceIds.includes(invoice.id)) continue;

      const { error: voidError } = await voidInvoice({ invoiceId: invoice.id, userId });

      if (voidError) {
        logger.warn({ err: voidError, proposalId, invoiceId: invoice.id }, 'Could not void a booking invoice');
        continue;
      }

      invoicesVoided += 1;
    }
  }

  /*
   * Take the unbilled stages off the books.
   *
   * `cancelled` is in `SETTLED_PERIOD_STATUSES`, so this is what removes them
   * from what the business is owed — and what makes them show up as potential
   * money lost, via `cancelledPlanMoneyOf`. Left `pending` they are owed money
   * on a job that ended.
   */
  /*
   * EVERYTHING NOT SETTLED, which includes the billed ones — and the reason
   * travels with the write.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * The filter lives in `cancelOpenStagesForProposal` now; what belongs here is
   * why it is written the way it is. This update once said
   * `.eq('status', 'pending')`, on the reasoning that "a billed one is
   * represented by the invoice voided above". True of the MONEY — that invoice
   * cannot be paid and nobody is chased for it — and false of the RECORD, which
   * is what every reader sees.
   *
   * The quote for הצעת מחיר לשיפוץ is the case: both invoices voided, stage 1
   * closed because it happened to be `pending`, stage 2 left reading `billed`
   * on a job marked `stopped`. The drawer showed it as unpaid, the count said
   * "0/2 paid" with nothing left to pay, and `unpaidPeriods` still treats it as
   * owed because only `paid` and `cancelled` are settled.
   *
   * `reason` is passed because one namespace with every other cancellation
   * surface is what lets a single report union them. The owner is standing
   * there and has already answered; writing `cancelled` without it throws the
   * answer away.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const { data: closed, error: closeError } =
    await paymentPlanRepository.cancelOpenStagesForProposal(proposalId, userId, {
      reason: input.reason,
      note: input.note?.trim() || null,
    });

  if (closeError) {
    logger.error(
      { err: closeError, proposalId },
      'Quote invoices voided but its remaining stages are still on the books'
    );
    return {
      ok: false,
      message: 'The remaining stages could not be taken off the books.',
      stagesClosed: 0,
      invoicesVoided,
      collected: collectedForEmail,
      currency: collectedCurrency,
    };
  }

  const stagesClosed = closed?.length ?? 0;

  /*
   * ───────────────────────────────────────────────────────────────────────────
   * AND THE PLAN STOPS CLAIMING WHAT WAS JUST CANCELLED.
   *
   * The third of the three ways work is called off, and the comment above the
   * status filter already names the other two. All three now leave the same
   * state behind, which was the point of writing that filter the same way: a
   * plan is `total_amount` and `installment_count`, both STORED, and closing
   * stages without touching them leaves the plan claiming money nobody can
   * collect.
   *
   * Never fatal. The helper logs and returns, and the stages above are the
   * fact that matters.
   * ───────────────────────────────────────────────────────────────────────────
   */
  if (closed?.length) {
    const { lowerPlansForCancelledStages } = await import('./planFollowsItsStages');
    await lowerPlansForCancelledStages(supabaseServer, userId, closed);
  }

  /*
   * Say the job ended — the second half of the one press.
   *
   * LAST, and conditional on `accepted`.
   *
   * Last, because the status is the thing a person reads. If the process dies
   * before this, the quote still says `accepted` with its stages closed: wrong,
   * but visibly wrong and safe to run again. Marking it `stopped` first and then
   * failing to close the stages would leave a quote that LOOKS finished while its
   * stages go on being chased at the client — the failure nobody investigates.
   *
   * Conditional on `accepted`, which does three things at once:
   *   - makes a second press a no-op instead of rewriting `stopped_at`
   *   - refuses a quote that was never agreed; `withdraw` owns those, and it is
   *     scoped to draft | sent | viewed for exactly that reason
   *   - cannot clobber `declined`, `expired`, `withdrawn` or `superseded`
   */
  const { data: stoppedRows, error: statusError } = await proposalRepository.stopAccepted(
    [proposalId],
    userId,
    /* Trimming is the repository's; it writes `stop_note: note?.trim() || null`
       so an empty textarea cannot store '' and read as a note that says
       nothing. */
    { reason: input.reason, note: input.note }
  );

  if (statusError) {
    /*
     * Loud, and NOT a failure of the whole call.
     *
     * The money is already stopped, which is the part that reaches the client.
     * Reporting failure here would invite a retry that finds nothing left to
     * close and reports "already stopped" — hiding the one thing that did go
     * wrong. So: ok, with `proposalStopped` false, and a log line naming it.
     */
    logger.error(
      { err: statusError, proposalId },
      'Money stopped but the quote still reads accepted; it needs marking stopped by hand'
    );
  }

  const proposalStopped = (stoppedRows?.length ?? 0) > 0;

  /*
   * Tell the client — LAST, and best effort.
   *
   * ─────────────────────────────────────────────────────────────────────────
   * Last, so the email states what actually happened rather than what was about
   * to.
   *
   * Best effort, and deliberately not allowed to fail the call. The invoices are
   * already voided and the stages already closed; throwing here would report a
   * failure for work that completed, and a retry would find nothing left to do
   * while the owner believed nothing had happened.
   *
   * Silence is not an option, which is why this exists: the client holds a quote
   * they signed and invoices in their inbox that no longer stand.
   *
   * Lazy `import`, for the reason `bookingCancellationReason` is its own module:
   * `ProposalSendService` pulls in the email transport, the branding resolver and
   * the PDF stack, and a static import would drag all of it into every Jest file
   * that touches money.
   *
   * The NOTE is passed only when the owner shared it; the reason CODE always is,
   * and the template renders its client-safe phrasing, never the code.
   * ─────────────────────────────────────────────────────────────────────────
   */
  let clientTold = false;

  try {
    const { sendQuoteStoppedEmail } = await import('@/lib/services/ProposalSendService');

    const outcome = await sendQuoteStoppedEmail(proposalId, userId, {
      paidAmount: collectedForEmail,
      /*
       * Always zero now: refunding moved out of this function to the standard
       * refund dialog, which sends its own email when money actually goes back.
       * Reporting a refund here that had not happened would be a promise.
       */
      refundedAmount: 0,
      invoicesVoided,
      stagesClosed,
      note: (input.shareNoteWithClient ?? true) ? input.note ?? null : null,
      reasonCode: input.reason,
    });

    clientTold = outcome.sent;
  } catch (err) {
    logger.error({ err, proposalId }, 'Job stopped, but the client could not be told');
  }

  logger.info(
    {
      proposalId,
      userId,
      stagesClosed,
      invoicesVoided,
      proposalStopped,
      clientTold,
      stopReason: input.reason,
      collected: collectedForEmail,
      hasBooking: Boolean(proposal.booking_id),
    },
    'Stopped an accepted quote part-way through'
  );

  return {
    ok: true,
    stagesClosed,
    invoicesVoided,
    proposalStopped,
    collected: collectedForEmail,
    currency: collectedCurrency,
    // Nothing to close AND nothing to mark: a genuine second press.
    alreadyClosed: stagesClosed === 0 && invoicesVoided === 0 && !proposalStopped,
  };
}
