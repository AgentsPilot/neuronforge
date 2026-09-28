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
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE BILLING ITSELF LIVES IN `PaymentStageBillingService`.
 *
 * It was inlined here until the dated half of the same job needed it: an
 * instalment stage falls due on a date the client already agreed to, and nothing
 * billed it. Rather than a second copy in the cron, the claim-invoice-link-send
 * sequence moved to one function both triggers call.
 *
 * `expectTrigger: 'manual'` is new, and deliberate: this endpoint could
 * previously have billed a DATED stage, since it never looked at the column. The
 * button is only rendered for a milestone, so nothing exercised it — but the
 * guard belongs on the server, not on whether a component happens to be correct.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { billStage } from '@/lib/services/PaymentStageBillingService';

const logger = createLogger({ module: 'PaymentStageCompleteAPI' });

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

    const result = await billStage(id, user.id, {
      request,
      expectTrigger: 'manual',
      auditAction: 'PAYMENT_MILESTONE_COMPLETED',
    });

    if (result.failure === 'already_done') {
      // Already billed, already paid, or not this user's. All the same answer:
      // there is nothing here to do, and saying so is not an error.
      return NextResponse.json({ success: false, code: 'already_done' }, { status: 409 });
    }

    if (result.failure === 'invoice_failed') {
      return NextResponse.json({ success: false, error: 'Could not raise the invoice' }, { status: 500 });
    }

    if (result.failure) {
      return NextResponse.json({ success: false, error: 'Could not update the milestone' }, { status: 500 });
    }

    requestLogger.info(
      { stageId: id, invoiceId: result.invoiceId, amount: result.amount },
      'Milestone completed and billed'
    );

    return NextResponse.json({
      success: true,
      invoiceId: result.invoiceId,
      amount: result.amount,
      currency: result.currency,
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Milestone completion failed');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
