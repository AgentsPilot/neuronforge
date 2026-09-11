/**
 * Send a proposal to the client, and freeze its terms.
 *
 * `send()` in the repository is a conditional update from `draft`, so pressing
 * send twice sends one email. After this, edits create a NEW version rather
 * than changing what the client was shown — the whole point of a quote is that
 * the number does not move after it leaves.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { proposalRepository } from '@/lib/repositories/ProposalRepository';
import { splitTotal } from '@/lib/services/ProposalAcceptanceService';
import { generateProposalToken } from '@/lib/business-os/proposalToken';
import { generateProposalEmail } from '@/lib/email/templates/proposal';
import { resolveEmailBranding } from '@/lib/email/branding';
import { sendEmail } from '@/lib/notifications/emailTransport';
import { resolveUserLanguage } from '@/lib/business-os/userLanguage';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import type { Locale } from '@/lib/i18n/config';

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

    const existing = await proposalRepository.findById(id, user.id);
    if (!existing.data) {
      return NextResponse.json({ success: false, error: 'Proposal not found' }, { status: 404 });
    }

    const { data: contact } = await supabaseServer
      .from('crm_contacts')
      .select('first_name, last_name, email')
      .eq('id', existing.data.contact_id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!contact?.email) {
      return NextResponse.json(
        { success: false, error: 'That client has no email address', code: 'no_client_email' },
        { status: 400 }
      );
    }

    /*
     * Claim the send before doing anything visible.
     *
     * Null means it was already sent — by another tab, or a retried request.
     * That is not an error; it just must not produce a second email, so the
     * route returns the proposal unchanged.
     */
    const sent = await proposalRepository.send(id, user.id);
    if (!sent.data) {
      requestLogger.info({ proposalId: id }, 'Proposal was already sent');
      return NextResponse.json({ success: true, proposal: existing.data, alreadySent: true });
    }

    const proposal = sent.data;

    /*
     * The attached document's record, if this version carries one.
     *
     * Read per VERSION: a revision that changed the scope has its own file, and
     * this send must carry that one rather than whatever the first version was
     * agreed against.
     */
    const { data: document } = proposal.document_id
      ? await supabaseServer
          .from('contact_documents')
          .select('file_name, mime_type, storage_path, storage_bucket')
          .eq('id', proposal.document_id)
          .eq('user_id', user.id)
          .maybeSingle()
      : { data: null };

    // A revision retires the version it replaces, so the old link stops
    // accepting and the client cannot agree to superseded terms.
    if (proposal.supersedes_id) {
      await proposalRepository.markSuperseded(proposal.supersedes_id, user.id);
    }

    /*
     * The CLIENT's language, resolved the way every other outbound mail does:
     * their stored preference first, the business's language second. Not the
     * owner's interface language — a Hebrew-speaking business with an
     * English-speaking client must send English.
     */
    const { data: langRow } = await supabaseServer
      .from('business_profiles')
      .select('language')
      .eq('user_id', user.id)
      .maybeSingle();

    const locale = resolveUserLanguage({
      profileLanguage: langRow?.language ?? null,
    }).language as Locale;
    const branding = await resolveEmailBranding(user.id, locale);

    const token = generateProposalToken(proposal.id, contact.email);
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || '';
    const viewUrl = `${appUrl}/proposal/${token}`;

    // The stages as money, so the email states a schedule rather than a count.
    const shape = proposal.payment_shape;
    let stages: Array<{ label: string; amount: number }> = [];
    let dueOnAccept: number | null = proposal.total;

    if (shape.kind === 'milestones') {
      const amounts = splitTotal(proposal.total, shape.stages.map(s => s.percent));
      stages = shape.stages.map((s, i) => ({ label: s.label, amount: amounts[i] }));
      dueOnAccept = amounts[0];
    } else if (shape.kind === 'installments') {
      const amounts = splitTotal(proposal.total, Array.from({ length: shape.count }, () => 100 / shape.count));
      stages = amounts.map((amount, i) => ({ label: `${i + 1}/${shape.count}`, amount }));
      dueOnAccept = amounts[0];
    }

    /*
     * The proposal document, fetched and attached.
     *
     * Attached, not linked. The client forwards this to a partner, prints it,
     * holds it against a competitor's — and a link that needs the original
     * email to work survives none of that. The body says it is attached, so a
     * missing file would read as a broken promise.
     *
     * A failure here does NOT stop the send: the quote's numbers are in the
     * body and the document is also on the client's record. It is logged loud
     * enough to notice, because an owner who ticked "attach" believes it went.
     */
    let attachment: { filename: string; content: Buffer; type?: string } | null = null;

    if (document?.storage_path) {
      try {
        const { data: fileData, error: downloadError } = await supabaseServer.storage
          .from(document.storage_bucket || 'contact-documents')
          .download(document.storage_path);

        if (downloadError || !fileData) throw downloadError ?? new Error('No file returned');

        attachment = {
          filename: document.file_name,
          content: Buffer.from(await fileData.arrayBuffer()),
          type: document.mime_type || undefined,
        };
      } catch (err) {
        requestLogger.error(
          { err, proposalId: proposal.id, documentId: proposal.document_id },
          'Proposal document could not be attached — the quote was sent without it'
        );
      }
    }

    const { subject, html } = generateProposalEmail({
      title: proposal.title,
      description: proposal.description,
      total: proposal.total,
      currency: proposal.currency,
      stages,
      dueOnAccept,
      validUntil: proposal.valid_until,
      viewUrl,
      clientFirstName: contact.first_name,
      branding,
      locale,
      isRevision: Boolean(proposal.supersedes_id),
      hasDocument: Boolean(document),
      documentName: document?.file_name ?? null,
    });

    await sendEmail({
      to: [contact.email],
      subject,
      html,
      // Presents the business as the sender rather than the platform.
      ownerUserId: user.id,
      ...(attachment ? { attachments: [attachment] } : {}),
    });

    await supabaseServer.from('crm_activities').insert({
      user_id: user.id,
      contact_id: proposal.contact_id,
      activity_type: 'proposal_sent',
      title: proposal.title,
      description: proposal.title,
      auto_logged: true,
      source_capability: 'payments',
      source_entity_id: proposal.id,
      activity_date: new Date().toISOString(),
    });

    auditTrail
      .log({
        action: 'PROPOSAL_SENT',
        userId: user.id,
        entityType: 'proposal',
        entityId: proposal.id,
        resourceName: proposal.title,
        request,
      })
      .catch(err => requestLogger.error({ err }, 'Audit failed'));

    requestLogger.info({ proposalId: proposal.id, userId: user.id }, 'Proposal sent');

    return NextResponse.json({ success: true, proposal });
  } catch (error) {
    requestLogger.error({ err: error, proposalId: id }, 'Failed to send proposal');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
