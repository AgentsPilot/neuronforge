/**
 * Mark a milestone done, and bill it.
 *
 * The one action that moves a quoted job forward after acceptance. A milestone
 * stage carries `trigger: 'manual'` precisely because no date can decide it —
 * the money falls due when the owner says the work happened, and until someone
 * says so there is nothing to invoice.
 *
 * Marking and billing are the same operation on purpose. Two buttons would let
 * an owner mark five stages complete and bill none of them, and the client
 * would owe money nobody had asked for.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { paymentInvoiceRepository } from '@/lib/repositories/PaymentRepository';
import { sendInvoice } from '@/lib/services/InvoiceDeliveryService';

const logger = createLogger({ module: 'PaymentStageCompleteAPI' });
const auditTrail = AuditTrailService.getInstance();

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });
  const { id } = await params;

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    /*
     * The claim.
     *
     * Conditional on the stage still being pending and unbilled, which the
     * database permits exactly once. Two clicks — or two tabs — would otherwise
     * raise the client two invoices for the same milestone, and the second is
     * money they do not owe.
     */
    const { data: stage, error: claimError } = await supabaseServer
      .from('payment_plan_installments')
      .update({ status: 'billed', completed_at: new Date().toISOString() })
      .eq('id', id)
      .eq('user_id', user.id)
      .eq('status', 'pending')
      .is('invoice_id', null)
      .select('*')
      .maybeSingle();

    if (claimError) {
      requestLogger.error({ err: claimError, stageId: id }, 'Could not claim the stage');
      return NextResponse.json({ success: false, error: 'Could not update the milestone' }, { status: 500 });
    }

    if (!stage) {
      // Already billed, already paid, or not this user's. All the same answer:
      // there is nothing here to do, and saying so is not an error.
      return NextResponse.json({ success: false, code: 'already_done' }, { status: 409 });
    }

    // The client's details, for the invoice. Read from the proposal's contact
    // rather than the booking, because the money belongs to the quote.
    const { data: contact } = await supabaseServer
      .from('crm_contacts')
      .select('first_name, last_name, email')
      .eq('id', stage.contact_id)
      .eq('user_id', user.id)
      .maybeSingle();

    const { data: proposal } = await supabaseServer
      .from('proposals')
      .select('title, currency')
      .eq('id', stage.proposal_id)
      .maybeSingle();

    const numberResult = await paymentInvoiceRepository.getNextInvoiceNumber(user.id);
    const description = stage.label
      ? `${proposal?.title ?? 'Work'} — ${stage.label}`
      : `${proposal?.title ?? 'Work'} (${stage.installment_number})`;

    const amount = Number(stage.amount);

    const { data: invoice, error: invoiceError } = await paymentInvoiceRepository.create({
      user_id: user.id,
      contact_id: stage.contact_id,
      booking_id: stage.booking_id,
      invoice_number: numberResult.data || `INV-${Date.now()}`,
      amount,
      currency: stage.currency,
      // 'draft' — never 'pending', which the table's status check rejects.
      // `sendInvoice` moves it to 'sent'.
      status: 'draft',
      line_items: [{ description, quantity: 1, unit_price: amount, amount }],
      due_date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      payment_terms: null,
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
       * The milestone is marked done and nothing bills it — the exact state
       * this endpoint exists to prevent, and one the owner cannot escape,
       * because the claim above will not fire twice.
       */
      await supabaseServer
        .from('payment_plan_installments')
        .update({ status: 'pending', completed_at: null })
        .eq('id', stage.id);

      requestLogger.error({ err: invoiceError, stageId: id }, 'Could not raise the milestone invoice');
      return NextResponse.json({ success: false, error: 'Could not raise the invoice' }, { status: 500 });
    }

    const invoiceId = (invoice as { id: string }).id;

    // The link `settleInvoice` follows to move this stage to paid.
    await supabaseServer
      .from('payment_plan_installments')
      .update({ invoice_id: invoiceId })
      .eq('id', stage.id);

    /*
     * Non-blocking. The milestone is billed and the invoice exists either way;
     * a transport failure is something the owner resends, not a reason to
     * unwind a completed milestone.
     */
    sendInvoice({ invoiceId, userId: user.id, request })
      .then(result => {
        /*
         * `sendInvoice` REPORTS failure, it does not throw it.
         *
         * A bare `.catch()` here caught nothing: a client with no email address,
         * or a transport error, resolved successfully and the milestone looked
         * billed-and-sent when nothing had left. The returned error is the only
         * thing that knows.
         */
        if (result.error) {
          requestLogger.error(
            { err: result.error, invoiceId, stageId: stage.id },
            'Milestone billed but the invoice email did not go out'
          );
        }
      })
      .catch(err =>
        requestLogger.error({ err, invoiceId }, 'Milestone invoice send threw')
      );

    auditTrail
      .log({
        action: 'PAYMENT_MILESTONE_COMPLETED',
        userId: user.id,
        entityType: 'payment_plan_installment',
        entityId: stage.id,
        resourceName: description,
        request,
      })
      .catch(err => requestLogger.error({ err }, 'Audit failed'));

    requestLogger.info({ stageId: stage.id, invoiceId, amount }, 'Milestone completed and billed');

    return NextResponse.json({ success: true, invoiceId, amount, currency: stage.currency });
  } catch (error) {
    requestLogger.error({ err: error }, 'Milestone completion failed');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
