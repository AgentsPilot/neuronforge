/**
 * Turn one payment-plan stage into an invoice.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE PATH, TWO TRIGGERS.
 *
 * A quoted job's money arrives stage by stage, and a stage becomes billable in
 * one of two ways:
 *
 *   `trigger: 'manual'`  a MILESTONE. No date can decide it — the money falls
 *                        due when the owner says the work happened. Triggered by
 *                        `POST /api/business-os/payment-stages/[id]/complete`.
 *   `trigger: 'date'`    an INSTALMENT. The quote named a count and a period, so
 *                        the date was fixed the moment the client accepted.
 *                        Triggered by the payment-reminders cron.
 *
 * This function is the whole of what happens after either trigger, and it was
 * extracted from the manual route rather than written fresh. The dated half had
 * NOTHING: `ProposalAcceptanceService` raises one invoice for stage 1 and the
 * comment claiming "the rest are raised as they fall due" was describing code
 * that did not exist. The client was instead chased for a stage with no invoice,
 * which produced a dunning email with a blank invoice number and no way to pay.
 *
 * Extracted rather than copied so the two triggers cannot drift: a change to how
 * a stage is priced, dated or described has one place to land.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * BILLING TWICE IS THE FAILURE THAT MATTERS.
 *
 * Everything else here is recoverable; an extra invoice is money the client does
 * not owe, in their inbox, with the business's name on it. The claim below is
 * the guard: a conditional UPDATE the database permits exactly once, so two
 * clicks, two tabs, or a cron overlapping itself all reach the same row and only
 * the first wins. That is why the status moves BEFORE the invoice is created and
 * is rolled back if it cannot be.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * @module lib/services/PaymentStageBillingService
 */

import type { NextRequest } from 'next/server';

import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { auditLog } from '@/lib/services/AuditTrailService';
import { paymentInvoiceRepository } from '@/lib/repositories/PaymentRepository';
import { sendInvoice } from '@/lib/services/InvoiceDeliveryService';
import {
  dueDateFromTerms,
  resolveTermsDays,
  termsValueForDays,
} from '@/lib/payments/paymentTerms';

const logger = createLogger({ service: 'PaymentStageBilling' });

export interface BillStageOptions {
  /** Passed to `sendInvoice` and the audit entry. Absent for the cron. */
  request?: NextRequest;
  /**
   * The invoice's due date, where the caller knows better than the terms.
   *
   * The dated path passes the STAGE's own `due_date`: the quote promised the
   * money on that day, and re-deriving it from the terms at billing time would
   * quietly move the date the client agreed to. The manual path passes nothing,
   * because a milestone has no date until it is billed and the terms are the
   * only answer.
   */
  dueDate?: string | null;
  /**
   * Only bill a stage of this kind.
   *
   * The manual route never set this and so could bill a dated stage if the UI
   * ever offered the button; the cron sets `'date'` so it can never reach a
   * milestone that is waiting on the owner. Absent means either.
   */
  expectTrigger?: 'date' | 'manual';
  /** The audit action to record. Milestones and instalments are not the same event. */
  auditAction?: string;
}

export type BillStageFailure =
  /** Already billed, already paid, the wrong trigger, or not this user's. */
  | 'already_done'
  | 'claim_failed'
  | 'invoice_failed';

export interface BillStageResult {
  invoiceId: string | null;
  amount: number | null;
  currency: string | null;
  /** The line description, which the caller may want for its own audit trail. */
  description: string | null;
  failure: BillStageFailure | null;
}

/**
 * Claim one stage and raise its invoice.
 *
 * Never throws: every caller is either an HTTP handler that owes the client a
 * status code or a cron row that must not take its batch down with it.
 */
export async function billStage(
  stageId: string,
  userId: string,
  options: BillStageOptions = {}
): Promise<BillStageResult> {
  const log = logger.child({ stageId, userId });
  const empty: BillStageResult = {
    invoiceId: null,
    amount: null,
    currency: null,
    description: null,
    failure: null,
  };

  try {
    /*
     * The claim. Conditional on the stage still being pending and unbilled,
     * which the database permits exactly once — see the note at the top of this
     * file for why that is the only thing standing between a client and a
     * duplicate invoice.
     *
     * `completed_at` is stamped only for a milestone: it records that the OWNER
     * said the work happened. A dated stage was never completed by anyone, and
     * writing the column there would invent an event.
     */
    const claim: Record<string, unknown> = { status: 'billed' };
    if (options.expectTrigger !== 'date') {
      claim.completed_at = new Date().toISOString();
    }

    let claimQuery = supabaseServer
      .from('payment_plan_installments')
      .update(claim)
      .eq('id', stageId)
      .eq('user_id', userId)
      .eq('status', 'pending')
      .is('invoice_id', null);

    if (options.expectTrigger) {
      claimQuery = claimQuery.eq('trigger', options.expectTrigger);
    }

    const { data: stage, error: claimError } = await claimQuery.select('*').maybeSingle();

    if (claimError) {
      log.error({ err: claimError }, 'Could not claim the stage');
      return { ...empty, failure: 'claim_failed' };
    }

    if (!stage) {
      // Already billed, already paid, the wrong trigger, or not this user's.
      // All the same answer: there is nothing here to do, and saying so is not
      // an error.
      return { ...empty, failure: 'already_done' };
    }

    // The client's details, for the invoice. Read from the proposal's contact
    // rather than the booking, because the money belongs to the quote.
    const { data: contact } = await supabaseServer
      .from('crm_contacts')
      .select('first_name, last_name, email')
      .eq('id', stage.contact_id)
      .eq('user_id', userId)
      .maybeSingle();

    const { data: proposal } = await supabaseServer
      .from('proposals')
      .select('title, currency, payment_terms_days')
      .eq('id', stage.proposal_id)
      .maybeSingle();

    /*
     * The same terms the deposit got.
     *
     * A stage billed six weeks after acceptance still belongs to the job that
     * was agreed — so it inherits the quote's terms, not whatever the business
     * default happens to be by then.
     */
    const { data: profile } = await supabaseServer
      .from('business_profiles')
      .select('invoice_payment_terms_days')
      .eq('user_id', userId)
      .maybeSingle();

    const termsDays = resolveTermsDays(
      proposal?.payment_terms_days,
      profile?.invoice_payment_terms_days
    );

    const numberResult = await paymentInvoiceRepository.getNextInvoiceNumber(userId);
    const description = stage.label
      ? `${proposal?.title ?? 'Work'}: ${stage.label}`
      : `${proposal?.title ?? 'Work'} (${stage.installment_number})`;

    const amount = Number(stage.amount);

    const { data: invoice, error: invoiceError } = await paymentInvoiceRepository.create({
      user_id: userId,
      contact_id: stage.contact_id,
      booking_id: stage.booking_id,
      invoice_number: numberResult.data || `INV-${Date.now()}`,
      amount,
      currency: stage.currency,
      // 'draft' — never 'pending', which the table's status check rejects.
      // `sendInvoice` moves it to 'sent'.
      status: 'draft',
      line_items: [{ description, quantity: 1, unit_price: amount, amount }],
      due_date: options.dueDate || dueDateFromTerms(termsDays),
      payment_terms: termsValueForDays(termsDays),
      notes: null,
      internal_notes: null,
      sent_at: null,
      paid_at: null,
      client_name: contact
        ? [contact.first_name, contact.last_name].filter(Boolean).join(' ') || null
        : null,
      client_email: contact?.email || null,
      service_id: null,
    } as never);

    if (invoiceError || !invoice) {
      /*
       * Roll the claim back.
       *
       * Otherwise the stage is marked billed and nothing bills it — the exact
       * state this function exists to prevent, and one nobody can escape,
       * because the claim above will not fire twice.
       */
      await supabaseServer
        .from('payment_plan_installments')
        .update({ status: 'pending', completed_at: null })
        .eq('id', stage.id)
        .eq('user_id', userId);

      log.error({ err: invoiceError }, 'Could not raise the stage invoice');
      return { ...empty, failure: 'invoice_failed' };
    }

    const invoiceId = (invoice as { id: string }).id;

    /*
     * The link `settleInvoice` follows to move this stage to paid.
     *
     * Scoped to the owner: an id is not a permission, and this runs as the
     * service role, so RLS will not catch a stray one either.
     */
    await supabaseServer
      .from('payment_plan_installments')
      .update({ invoice_id: invoiceId })
      .eq('id', stage.id)
      .eq('user_id', userId);

    /*
     * AWAITED — and that is the whole fix.
     *
     * ───────────────────────────────────────────────────────────────────────────
     * This was a floating promise, on the reasoning that a transport failure is
     * something the owner resends rather than a reason to unwind a billed stage.
     * The reasoning is right and the mechanism was not: this runs in a Vercel
     * serverless function, and once the route returns its response the instance
     * is frozen. A send still in flight is killed with it.
     *
     * So the stage was billed, the invoice existed, and the client was never
     * told. The owner then pressed "send invoice" by hand and it arrived —
     * because THAT route awaits the same call. Every path that works awaits it;
     * this one and the proposal-acceptance route were the two that did not.
     *
     * Intermittent, not absent: a fast send sometimes finished before the
     * freeze, which is exactly what makes it hard to report.
     *
     * Failure is still non-fatal. Nothing is rethrown, the stage stays billed
     * and the caller still gets its success — the only change is that the send
     * is given time to happen.
     * ───────────────────────────────────────────────────────────────────────────
     */
    try {
      /*
       * `sendInvoice` REPORTS failure, it does not throw it.
       *
       * A bare `catch` caught nothing: a client with no email address, or a
       * transport error, resolved successfully and the stage looked
       * billed-and-sent when nothing had left. The returned error is the only
       * thing that knows.
       */
      const sent = await sendInvoice({ invoiceId, userId, request: options.request });

      if (sent.error) {
        log.error(
          { err: sent.error, invoiceId },
          'Stage billed but the invoice email did not go out'
        );
      }
    } catch (err) {
      log.error({ err, invoiceId }, 'Stage invoice send threw');
    }

    auditLog({
      action: options.auditAction ?? 'PAYMENT_MILESTONE_COMPLETED',
      userId,
      entityType: 'payment_plan_installment',
      entityId: stage.id,
      resourceName: description,
      request: options.request,
    }).catch(err => log.error({ err }, 'Audit failed'));

    log.info({ invoiceId, amount, trigger: stage.trigger }, 'Stage billed');

    return {
      invoiceId,
      amount,
      currency: stage.currency,
      description,
      failure: null,
    };
  } catch (error) {
    log.error({ err: error }, 'Stage billing failed');
    return { ...empty, failure: 'claim_failed' };
  }
}
