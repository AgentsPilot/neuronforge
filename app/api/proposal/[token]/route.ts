/**
 * The proposal, as the client reads and answers it.
 *
 * Public and unauthenticated: a quote is often a business's first contact with
 * someone, and asking them to make an account before they can read a price
 * loses the job. The signed token IS the authorisation, and it names exactly
 * one proposal — so the id is taken from the verified payload and never from
 * the URL or the body.
 *
 * Every failure is a CODE, not a sentence. The page renders in three languages
 * and an English string here cannot be translated there.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { verifyProposalToken } from '@/lib/business-os/proposalToken';
import { proposalRepository } from '@/lib/repositories/ProposalRepository';
import { applyAcceptance, splitTotal } from '@/lib/services/ProposalAcceptanceService';
import { sendInvoice } from '@/lib/services/InvoiceDeliveryService';
import type { Proposal } from '@/lib/repositories/ProposalRepository';

const logger = createLogger({ module: 'PublicProposalAPI' });

/** The six states the page has to be able to explain. */
type ProposalPageCode =
  | 'not_found'
  | 'accepted'
  | 'declined'
  | 'expired'
  | 'withdrawn'
  | 'superseded';

/**
 * Why this proposal cannot be answered, if it cannot.
 *
 * Expiry is computed rather than stored: a proposal whose `valid_until` has
 * passed is expired whether or not a job has got round to marking it, and the
 * client must not be able to accept terms that lapsed on Sunday because the
 * cron runs on Monday.
 */
function blockingState(proposal: Proposal): ProposalPageCode | null {
  if (proposal.status === 'accepted') return 'accepted';
  if (proposal.status === 'declined') return 'declined';
  if (proposal.status === 'withdrawn') return 'withdrawn';
  if (proposal.status === 'superseded') return 'superseded';
  if (proposal.status === 'expired') return 'expired';

  if (proposal.valid_until) {
    // Compared at end of day in UTC: a quote valid "until the 30th" is valid
    // for all of the 30th, wherever the client is reading it.
    const lapsed = new Date(`${proposal.valid_until}T23:59:59Z`).getTime() < Date.now();
    if (lapsed) return 'expired';
  }

  return null;
}

/**
 * The attached proposal document, signed for reading.
 *
 * Null whenever there is no document, the row is gone, or the signature could
 * not be produced — and the page treats all three the same way: it simply shows
 * no document and does not gate acceptance on one. A quote must never become
 * unacceptable because a file failed to sign.
 */
async function presentDocument(documentId: string | null, userId: string) {
  if (!documentId) return null;

  const { data: doc } = await supabaseServer
    .from('contact_documents')
    .select('file_name, file_size, mime_type, storage_path, storage_bucket')
    .eq('id', documentId)
    .eq('user_id', userId)
    .maybeSingle();

  if (!doc?.storage_path) return null;

  const { data: signed } = await supabaseServer.storage
    .from(doc.storage_bucket || 'contact-documents')
    .createSignedUrl(doc.storage_path, 60 * 60);

  if (!signed?.signedUrl) return null;

  return {
    name: doc.file_name,
    size: doc.file_size,
    mimeType: doc.mime_type,
    url: signed.signedUrl,
  };
}

/** What the client is shown — never the internal columns. */
async function present(proposal: Proposal) {
  /*
   * No branding here.
   *
   * It used to be assembled and returned alongside the quote, which meant the
   * page could only know what colour it should be AFTER this request — one
   * unstyled paint, then a repaint. The segment layout now resolves the same
   * brand on the server and the page reads it from context, so this endpoint
   * answers only for the quote itself.
   */
  const { data: contact } = await supabaseServer
    .from('crm_contacts')
    .select('first_name')
    .eq('id', proposal.contact_id)
    .maybeSingle();

  const shape = proposal.payment_shape;
  let stages: Array<{ label: string; amount: number }> = [];

  if (shape.kind === 'milestones') {
    const amounts = splitTotal(proposal.total, shape.stages.map(s => s.percent));
    stages = shape.stages.map((s, i) => ({ label: s.label, amount: amounts[i] }));
  } else if (shape.kind === 'installments') {
    const amounts = splitTotal(
      proposal.total,
      Array.from({ length: shape.count }, () => 100 / shape.count)
    );
    stages = amounts.map((amount, i) => ({ label: `${i + 1}/${shape.count}`, amount }));
  }

  return {
    title: proposal.title,
    description: proposal.description,
    total: proposal.total,
    currency: proposal.currency,
    validUntil: proposal.valid_until,
    stages,
    dueOnAccept: stages.length ? stages[0].amount : proposal.total,
    clientFirstName: contact?.first_name ?? null,
    /*
     * The proposal document, as a short-lived signed link.
     *
     * Signed rather than public: the bucket holds every client's paperwork, and
     * a guessable path would expose one client's contract to another. One hour
     * is long enough to read a proposal and short enough that a forwarded link
     * stops working.
     */
    document: await presentDocument(proposal.document_id, proposal.user_id),
    /*
     * Which version this is.
     *
     * Sent back with the answer so the POST acts on the offer the client
     * actually read. Without it, a revision landing between their opening the
     * page and pressing accept would be accepted sight unseen.
     */
    id: proposal.id,
    isRevision: Boolean(proposal.supersedes_id),
  };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const payload = verifyProposalToken(token);
  if (!payload) {
    return NextResponse.json({ success: false, code: 'not_found' as ProposalPageCode }, { status: 404 });
  }

  /*
   * The quote that stands now, which is not always the one the token names.
   *
   * A client who declined and then got a revision holds TWO links, and the
   * older email is the one they are likelier to still have. Following the
   * supersession chain forward means either link opens the current offer —
   * rather than the first one dead-ending at "this has been replaced" with no
   * way to reach what replaced it.
   */
  const { data: proposal } = await proposalRepository.currentInChain(payload.proposalId);
  if (!proposal || proposal.status === 'draft') {
    // A draft was never sent. Whoever holds this link should not see it.
    return NextResponse.json({ success: false, code: 'not_found' as ProposalPageCode }, { status: 404 });
  }

  const blocked = blockingState(proposal);

  // First open marks it viewed — a signal the owner can act on, and one of the
  // two detectors planned for the dashboard.
  if (!blocked) await proposalRepository.markViewed(proposal.id);

  /*
   * An accepted quote still has somewhere to go.
   *
   * Reopening the link after accepting used to end at a card saying "accepted"
   * and nothing else — including for a client who accepted, closed the tab
   * before paying, and came back to the only link they have. The deposit is
   * still owed; the page has to be able to reach it.
   */
  let invoiceUrl: string | null = null;
  let invoicePaid = false;

  if (proposal.status === 'accepted' && proposal.created_invoice_id) {
    const { data: invoice } = await supabaseServer
      .from('payment_invoices')
      .select('status')
      .eq('id', proposal.created_invoice_id)
      .maybeSingle();

    invoiceUrl = `/invoice/${proposal.created_invoice_id}`;
    invoicePaid = invoice?.status === 'paid';
  }

  return NextResponse.json({
    success: !blocked,
    code: blocked,
    invoiceUrl,
    invoicePaid,
    proposal: await present(proposal),
  });
}

const answerSchema = z.discriminatedUnion('answer', [
  z.object({
    answer: z.literal('accept'),
    /*
     * The version the client was looking at when they pressed accept.
     *
     * The token names a proposal, but the page shows whatever currently stands
     * in that chain — so between opening the page and answering, a revision
     * could arrive and be accepted sight unseen. Sent back and checked below.
     * Optional so an older cached page still works; it just loses the guard.
     */
    proposal_id: z.string().uuid().optional(),
  }),
  z.object({
    answer: z.literal('decline'),
    // One tap from a short list. The reason is what turns a lost quote into a
    // second attempt, so it is asked for rather than inferred.
    reason: z.enum(['too_expensive', 'timing', 'scope', 'chose_other', 'other']),
    note: z.string().max(1000).optional(),
  }),
]);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });
  const { token } = await params;

  try {
    const payload = verifyProposalToken(token);
    if (!payload) {
      return NextResponse.json({ success: false, code: 'not_found' }, { status: 404 });
    }

    const body = await request.json();
    const parsed = answerSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ success: false, error: 'Invalid answer' }, { status: 400 });
    }

    // The same forward walk the GET does, so an old link answers the live offer.
    const { data: existing } = await proposalRepository.currentInChain(payload.proposalId);
    if (!existing || existing.status === 'draft') {
      return NextResponse.json({ success: false, code: 'not_found' }, { status: 404 });
    }

    /*
     * What they saw is what they answer.
     *
     * A mismatch means a revision arrived while the page was open. Answered as
     * 'superseded', which the page already knows how to render — and the client
     * reloads onto the offer that now stands rather than having silently
     * accepted terms they never read.
     */
    if (
      parsed.data.answer === 'accept' &&
      parsed.data.proposal_id &&
      parsed.data.proposal_id !== existing.id
    ) {
      return NextResponse.json({ success: false, code: 'superseded' });
    }

    const blocked = blockingState(existing);
    if (blocked) {
      /*
       * Already answered, or no longer answerable.
       *
       * 200, not an error: a client who double-clicked, or opened the link on
       * a second device, has done nothing wrong and should see the same
       * finished result rather than a failure.
       */
      return NextResponse.json({ success: false, code: blocked });
    }

    if (parsed.data.answer === 'decline') {
      const declined = await proposalRepository.decline(
        existing.id,
        parsed.data.reason,
        parsed.data.note
      );

      if (!declined.data) {
        // Someone else answered between our read and our write.
        const { data: now } = await proposalRepository.findByIdForToken(existing.id);
        return NextResponse.json({ success: false, code: now ? blockingState(now) : 'not_found' });
      }

      await logActivity(existing, 'proposal_declined');
      requestLogger.info({ proposalId: existing.id, reason: parsed.data.reason }, 'Proposal declined');

      return NextResponse.json({ success: true, code: 'declined' });
    }

    /*
     * ACCEPTANCE. The one place in this feature where doing the work twice
     * costs the client real money.
     *
     * The claim is a conditional update: sent/viewed → accepted, which the
     * database permits exactly once. Only the winner creates the plan, the
     * stages and the invoice. Everyone else falls into the branch below and is
     * shown the same finished result.
     */
    const claimed = await proposalRepository.claimForAcceptance(existing.id);
    if (!claimed.data) {
      const { data: now } = await proposalRepository.findByIdForToken(existing.id);
      return NextResponse.json({ success: false, code: now ? blockingState(now) : 'not_found' });
    }

    const proposal = claimed.data;
    const created = await applyAcceptance(proposal);

    /*
     * The snapshot is written AFTER the money exists, and records the terms
     * exactly as agreed. A later edit to the proposal cannot rewrite it, which
     * is what makes it the document that settles a dispute.
     */
    await proposalRepository.recordAcceptance(
      proposal.id,
      {
        title: proposal.title,
        description: proposal.description,
        total: proposal.total,
        currency: proposal.currency,
        payment_shape: proposal.payment_shape,
        tax_rate: proposal.tax_rate,
        tax_label: proposal.tax_label,
        prices_include_tax: proposal.prices_include_tax,
        accepted_at: new Date().toISOString(),
      },
      { invoiceId: created.invoiceId, planId: created.planId }
    );

    await logActivity(proposal, 'proposal_accepted');

    /*
     * The invoice, emailed as well as linked.
     *
     * Accepting used to end at "thank you", with the first payment existing
     * only as a row nobody had been told about — the client had agreed to pay a
     * deposit and been given no way to pay it. They are sent to the invoice
     * immediately (below), and it is ALSO emailed, because the tab gets closed
     * and "I accepted but never got a bill" is how a signed job stalls.
     *
     * Non-blocking on purpose: the acceptance is already committed, and a mail
     * failure must not tell the client their acceptance did not happen. The
     * owner can resend from the invoice.
     */
    /*
     * ONE way to pay, never two.
     *
     * The client is redirected to the invoice the moment they accept. Emailing
     * the same invoice with its own Pay button opens a SECOND door to the same
     * money: two tabs, two checkouts, and the guard on the pay route reads the
     * invoice's status at request time — so two concurrent attempts can both
     * pass the check before either settles. Narrowing that window is not
     * closing it.
     *
     * So the email is sent only when there is nothing to redirect to: a quote
     * with nothing due on acceptance, or one whose invoice could not be raised.
     * A client who is redirected already has the payment page in front of them,
     * and if they close it the accepted quote page still carries a link to it —
     * the same page, not a second one.
     */
    const willRedirect = Boolean(created.invoiceId) && created.dueNow > 0;

    if (created.invoiceId && !willRedirect) {
      sendInvoice({ invoiceId: created.invoiceId, userId: proposal.user_id, request })
        .then(result => {
          // Reported, not thrown — see the milestone endpoint for the same note.
          if (result.error) {
            requestLogger.error(
              { err: result.error, invoiceId: created.invoiceId, proposalId: proposal.id },
              'Accepted, but the invoice email did not go out'
            );
          }
        })
        .catch(err =>
          requestLogger.error(
            { err, invoiceId: created.invoiceId, proposalId: proposal.id },
            'Acceptance invoice send threw'
          )
        );
    }

    requestLogger.info(
      { proposalId: proposal.id, invoiceId: created.invoiceId, planId: created.planId },
      'Proposal accepted'
    );

    return NextResponse.json({
      success: true,
      code: 'accepted',
      data: {
        dueNow: created.dueNow,
        currency: proposal.currency,
        /*
         * Where to pay. Null when nothing falls due on acceptance — a quote
         * billed entirely on completion is accepted and simply has nothing to
         * pay yet, which is not a failure and must not look like one.
         */
        invoiceUrl: willRedirect ? `/invoice/${created.invoiceId}` : null,
      },
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Proposal answer failed');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

async function logActivity(proposal: Proposal, type: string): Promise<void> {
  try {
    await supabaseServer.from('crm_activities').insert({
      user_id: proposal.user_id,
      contact_id: proposal.contact_id,
      activity_type: type,
      title: proposal.title,
      description: proposal.title,
      auto_logged: true,
      source_capability: 'payments',
      source_entity_id: proposal.id,
      activity_date: new Date().toISOString(),
    });
  } catch (error) {
    // The decision is recorded on the proposal itself; a missing timeline entry
    // must not fail the client's answer.
    logger.warn({ err: error, proposalId: proposal.id, type }, 'Could not log the decision');
  }
}
