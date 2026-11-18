/**
 * Send a proposal to the client, and freeze its terms.
 *
 * The sequence itself lives in `ProposalSendService` — the chat can send a
 * quote too, and two copies of an eight-step ordered send would drift on the
 * first change either of them made. What stays here is what a route owns:
 * authentication, the audit entry, and the shape of the reply.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { sendProposal } from '@/lib/services/ProposalSendService';
import { supabaseServer } from '@/lib/supabaseServer';
import { missingInvoiceFields, type InvoiceFields } from '@/lib/business-os/setup/profileReadiness';
import { AuditTrailService } from '@/lib/services/AuditTrailService';

const logger = createLogger({ module: 'ProposalSendAPI' });
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
     * ─────────────────────────────────────────────────────────────────────────
     * A QUOTE ENDS IN AN INVOICE, SO THE BUSINESS HAS TO BE ABLE TO ISSUE ONE.
     *
     * `ProposalAcceptanceService.raiseInvoice` writes a `payment_invoices` row
     * the moment a client accepts, and the public proposal page builds that
     * document from `invoice_company_name`, `invoice_tax_id` and
     * `invoice_address`. On an account where those are blank the client gets a
     * bill with no issuer and nowhere to send the money — and nothing, at any
     * step, refused.
     *
     * Measured end to end on a quote-first account: the service published, the
     * quote was created, the send asked only whether the client had an email,
     * and acceptance would have billed a real person from an account that
     * cannot invoice.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * THIS IS THE BACKSTOP, NOT THE ASK.
     *
     * The service editor asks for these where the decision is made — choosing
     * "You quote first" or "You invoice them" puts the requirement on screen
     * with the control that clears it — and publishing refuses without them.
     * Both of those come first, by design: stopping somebody at SEND means
     * stopping them with a client waiting and the quote already written, which
     * is the worst moment to meet a form about tax ids, and the moment they are
     * least likely to fill it in honestly.
     *
     * So this should almost never fire. It exists for the routes that go round
     * the editor: a quote raised straight from a contact with no service at
     * all, a service created by onboarding that was never opened, and details
     * cleared after the fact.
     *
     * `missingInvoiceFields` rather than a check written here, so this, the
     * publish gate and the editor row all mean the same thing by "complete".
     * The missing field codes travel with the refusal, as the other gates do,
     * so the caller can name them rather than print a paragraph.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const { data: invoiceSettings } = await supabaseServer
      .from('business_profiles')
      /* One literal, not a concatenation: PostgREST's types are inferred from
         the string itself, and a `+` join defeats that — the row then comes
         back as `GenericStringError` and `missingInvoiceFields` cannot be
         handed it. */
      .select(`
        invoice_company_name,
        invoice_tax_id,
        invoice_address,
        invoice_bank_name,
        invoice_bank_account,
        invoice_payment_instructions,
        invoice_document_type,
        invoice_prices_include_tax
      `)
      .eq('user_id', user.id)
      .maybeSingle()
      /* Names the row's shape rather than trusting inference, which this
         query has already lost once: see the note on the select above. */
      .returns<InvoiceFields>();

    const missing = missingInvoiceFields(invoiceSettings);

    if (missing.length > 0) {
      requestLogger.warn(
        { userId: user.id, proposalId: id, missing },
        'Send refused: this quote would end in an invoice the business cannot issue'
      );
      return NextResponse.json(
        {
          success: false,
          code: 'invoice_details_required',
          error:
            'Accepting this quote raises an invoice, and yours is missing details a client needs to pay it.',
          missing,
        },
        { status: 400 }
      );
    }

    const outcome = await sendProposal(id, user.id);

    if (!outcome.ok) {
      return outcome.reason === 'not_found'
        ? NextResponse.json({ success: false, error: 'Proposal not found' }, { status: 404 })
        : NextResponse.json(
            { success: false, error: 'That client has no email address', code: 'no_client_email' },
            { status: 400 }
          );
    }

    if (outcome.alreadySent) {
      // Not an error: the claim is what guarantees one email, and a second
      // request simply returns the quote unchanged.
      return NextResponse.json({ success: true, proposal: outcome.proposal, alreadySent: true });
    }

    auditTrail
      .log({
        action: 'PROPOSAL_SENT',
        userId: user.id,
        entityType: 'proposal',
        entityId: outcome.proposal.id,
        resourceName: outcome.proposal.title,
        request,
      })
      .catch((err) => requestLogger.error({ err }, 'Audit failed'));

    return NextResponse.json({ success: true, proposal: outcome.proposal });
  } catch (error) {
    requestLogger.error({ err: error, proposalId: id }, 'Failed to send proposal');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
