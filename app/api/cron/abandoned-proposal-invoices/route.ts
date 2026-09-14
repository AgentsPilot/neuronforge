/**
 * The client accepted, was taken to the invoice, and stopped.
 *
 * Accepting a quote redirects straight to the invoice, and no email is sent —
 * two payment surfaces for the same money let a client pay twice, because the
 * guard on the pay route reads the invoice's status at request time and two
 * concurrent checkouts can both pass it.
 *
 * That is right for the client who pays. It leaves nothing at all for the one
 * who closes the tab: no invoice, no reference, no way back except the original
 * quote email. So an invoice that has been sitting unpaid and unsent for a
 * while is emailed here — one door at a time rather than two at once.
 *
 * A client who PAID never reaches this: `status = 'paid'` excludes them, and
 * they get a receipt from `settleInvoicePaid` instead.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { sendInvoice } from '@/lib/services/InvoiceDeliveryService';

const logger = createLogger({ module: 'AbandonedProposalInvoicesCron' });

/**
 * How long a client gets before we assume they are not coming back.
 *
 * Long enough that nobody is emailed an invoice while they are still typing
 * their card number, short enough that the reference arrives the same hour they
 * agreed to pay it.
 */
const ABANDONED_AFTER_MINUTES = 30;

/** Copied from payment-reminders: fails CLOSED, never open. */
function verifyCronSecret(request: NextRequest): boolean {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (process.env.NODE_ENV === 'development') return true;

  if (!cronSecret) {
    logger.error('CRON_SECRET not configured - refusing cron request (fail-closed)');
    return false;
  }

  return authHeader === `Bearer ${cronSecret}`;
}

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  if (!verifyCronSecret(request)) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const cutoff = new Date(Date.now() - ABANDONED_AFTER_MINUTES * 60 * 1000).toISOString();

    /*
     * Only invoices a proposal acceptance raised.
     *
     * Every other invoice in the system was emailed by whatever created it;
     * this job exists for the one flow that deliberately does not.
     */
    const { data: accepted, error: proposalError } = await supabaseServer
      .from('proposals')
      .select('created_invoice_id')
      .eq('status', 'accepted')
      .not('created_invoice_id', 'is', null);

    if (proposalError) throw proposalError;

    const invoiceIds = (accepted ?? [])
      .map(p => p.created_invoice_id as string)
      .filter(Boolean);

    if (invoiceIds.length === 0) {
      return NextResponse.json({ success: true, considered: 0, sent: 0 });
    }

    /*
     * `sent_at IS NULL` is the idempotency key, and it is not a flag this job
     * maintains — `sendInvoice` sets it as part of sending. So an invoice can
     * be picked up here exactly once, and a job that dies mid-run resumes
     * without re-emailing anyone it already reached.
     */
    const { data: abandoned, error: invoiceError } = await supabaseServer
      .from('payment_invoices')
      .select('id, user_id, invoice_number')
      .in('id', invoiceIds)
      .in('status', ['draft', 'sent'])
      .is('sent_at', null)
      .lt('created_at', cutoff)
      .limit(100);

    if (invoiceError) throw invoiceError;

    let sent = 0;

    for (const invoice of abandoned ?? []) {
      try {
        const result = await sendInvoice({ invoiceId: invoice.id, userId: invoice.user_id });

        // Reported, not thrown — a client with no email address is a permanent
        // condition, not a transient one, and must not stall the rest.
        if (result.error) {
          requestLogger.warn(
            { err: result.error, invoiceId: invoice.id },
            'Abandoned invoice could not be emailed'
          );
          continue;
        }
        sent++;
      } catch (err) {
        requestLogger.error({ err, invoiceId: invoice.id }, 'Abandoned invoice send threw');
      }
    }

    requestLogger.info({ considered: abandoned?.length ?? 0, sent }, 'Abandoned proposal invoices swept');

    return NextResponse.json({ success: true, considered: abandoned?.length ?? 0, sent });
  } catch (error) {
    requestLogger.error({ err: error }, 'Abandoned invoice sweep failed');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
