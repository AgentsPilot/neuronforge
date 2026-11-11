/**
 * The client's copy of a quote, as a PDF.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE TOKEN IS THE AUTHORISATION
 *
 * The same rule `lib/business-os/proposalToken.ts` sets for every route that
 * accepts one: the proposal id is read out of the VERIFIED payload and never
 * out of the URL or the body. There is no session here — the reader is a client
 * who followed a link from an email.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * GENERATED, NEVER STORED
 *
 * Rendered on demand, exactly as `app/api/payments/invoices/[id]/pdf` does it.
 * A stored file would go on describing the version it was made from, and a
 * quote can be superseded.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OFFERED ON EVERY QUOTE, NOT ONLY ONES WITH A BREAKDOWN
 *
 * A quote priced as a single figure still produces a real document: the same
 * letterhead, title, description, total, stages and terms the client reads on
 * the page. That is most of the value for an owner who never opens the builder.
 */

import { NextRequest, NextResponse } from 'next/server';
import { verifyProposalToken } from '@/lib/business-os/proposalToken';
import { proposalRepository } from '@/lib/repositories/ProposalRepository';
import { splitTotal } from '@/lib/services/ProposalAcceptanceService';
import { supabaseServer } from '@/lib/supabaseServer';
import { createLogger } from '@/lib/logger';
import { resolveEmailBranding } from '@/lib/email/branding';

const logger = createLogger({ module: 'proposal-pdf' });

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  const { token } = await params;
  const payload = verifyProposalToken(token);
  if (!payload) {
    return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  }

  /*
   * The quote that stands now, for the same reason the page follows the chain:
   * an old email is the link a client is likeliest to still have, and it must
   * not hand them a PDF of an offer that has been replaced.
   */
  const { data: proposal } = await proposalRepository.currentInChain(payload.proposalId);
  if (!proposal || proposal.status === 'draft') {
    return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  }

  try {
    const [{ data: contact }, { data: profile }] = await Promise.all([
      supabaseServer
        .from('crm_contacts')
        .select('first_name, last_name, email')
        .eq('id', proposal.contact_id)
        .maybeSingle(),
      supabaseServer
        .from('business_profiles')
        /* Every column verified against the live table — a name that does not
           exist makes PostgREST reject the whole select. */
        .select(
          'invoice_payment_terms_days, invoice_company_name, invoice_address, invoice_tax_id, invoice_footer_text, invoice_bank_name, invoice_bank_account, invoice_bank_routing, invoice_payment_instructions, company_name, address, phone, email, logo_url, language'
        )
        .eq('user_id', proposal.user_id)
        .maybeSingle(),
    ]);

    /*
     * The stages, derived the same way the page derives them — `splitTotal`,
     * so the PDF cannot print a schedule that differs from the one the client
     * is looking at on screen.
     */
    const shape = proposal.payment_shape;
    let stages: Array<{ label: string; amount: number }> = [];
    if (shape?.kind === 'milestones' && shape.stages?.length) {
      const amounts = splitTotal(proposal.total, shape.stages.map(s => s.percent));
      stages = shape.stages.map((stage, i) => ({ label: stage.label, amount: amounts[i] ?? 0 }));
    }

    /*
     * The CLIENT's language, which is the business's — the same source
     * `ProposalSendService` resolves the quote email's locale from, so the PDF
     * and the mail carrying it are never written in different languages.
     *
     * Not `user_preferences`: that table has no `language` column, and naming
     * one would make PostgREST reject the whole select.
     */
    const language = (profile?.language || 'en') as 'en' | 'es' | 'he';

    /* The same palette the invoice PDF and the emails resolve, so a quote
       and the invoice that follows it look like one business. */
    const branding = await resolveEmailBranding(proposal.user_id, language);

    /*
     * The signature, if this version carries one.
     *
     * Read only for an ACCEPTED quote: the row cannot exist otherwise, and
     * asking for it on every render would be a query per download to find
     * nothing. Failure is silent — a PDF without the signature block is worth
     * far more than no PDF.
     */
    const { data: signatureRow } =
      proposal.status === 'accepted'
        ? await supabaseServer
            .from('proposal_signatures')
            .select('signed_name, signed_at, signature_image')
            .eq('proposal_id', proposal.id)
            .maybeSingle()
        : { data: null };

    /*
     * Dynamic import: React-PDF registers fonts as a side effect of being
     * imported and Jest cannot transform it. See the generator's header.
     */
    const { generateProposalPDFAsync } = await import('@/lib/pdf/ProposalPDFGenerator');

    const buffer = await generateProposalPDFAsync({
      number: proposal.id.slice(0, 8).toUpperCase(),
      title: proposal.title,
      description: proposal.description,
      total: proposal.total,
      currency: proposal.currency,
      validUntil: proposal.valid_until,
      termsDays: proposal.payment_terms_days ?? profile?.invoice_payment_terms_days ?? null,
      content: proposal.content ?? null,
      stages,
      clientName: [contact?.first_name, contact?.last_name].filter(Boolean).join(' ') || null,
      clientEmail: contact?.email ?? null,
      letterhead: {
        name: profile?.invoice_company_name || profile?.company_name || null,
        /* The jsonb object, formatted by the generator — not interpolated.
           A string here rendered as `[object Object]` on a live quote. */
        address: profile?.invoice_address || profile?.address || null,
        taxId: profile?.invoice_tax_id || null,
        phone: profile?.phone || null,
        email: profile?.email || null,
        logoUrl: profile?.logo_url || null,
      },
      /*
       * The bank details the invoice already prints. A quote with a deposit
       * due on acceptance is exactly where a client needs them, and taking
       * them from the same row means the two documents cannot disagree.
       */
      payment: {
        bankName: profile?.invoice_bank_name || null,
        bankAccount: profile?.invoice_bank_account || null,
        bankRouting: profile?.invoice_bank_routing || null,
        instructions: profile?.invoice_payment_instructions || null,
      },
      signature: signatureRow
        ? {
            name: signatureRow.signed_name,
            signedAt: String(signatureRow.signed_at).slice(0, 10),
            image: signatureRow.signature_image,
          }
        : null,
      footerText: profile?.invoice_footer_text || null,
      language,
      /*
       * THE BUSINESS'S OWN COLOURS.
       *
       * Declared on `ProposalPDFData` from the start and passed by nobody, so
       * `accent` fell back to #1F2937 and every quote came out slate grey while
       * the invoice behind it wore the business's green. Two documents, one
       * business, two identities.
       *
       * `resolveEmailBranding` is the resolver the invoice PDF and every
       * transactional email already use — named for email, but it resolves the
       * website theme, which is the business's real palette.
       */
      branding: {
        primaryColor: branding.primaryColor,
        headingFont: branding.headingFont,
        bodyFont: branding.bodyFont,
      },
    });

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        'Content-Type': 'application/pdf',
        /* `inline`, so a client who taps the link reads it rather than finding
           it in a downloads folder they then have to go looking through. */
        'Content-Disposition': `inline; filename="proposal-${proposal.id.slice(0, 8)}.pdf"`,
        /* Never cached: the quote behind it can be superseded at any moment. */
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    requestLogger.error({ err: error, proposalId: proposal.id }, 'Proposal PDF failed');
    return NextResponse.json(
      {
        success: false,
        error: 'Could not produce the PDF',
        details: process.env.NODE_ENV === 'development' ? String(error) : undefined,
      },
      { status: 500 }
    );
  }
}
