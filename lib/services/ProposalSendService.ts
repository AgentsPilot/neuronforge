/**
 * Send a quote to the client, and freeze its terms.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A SERVICE AND NOT A ROUTE
 *
 * This sequence used to live inside `POST /api/business-os/proposals/[id]/send`,
 * which was fine while the quote builder was the only way to send one. The chat
 * can now send a quote too, and there are exactly two ways to give it that
 * capability: copy the sequence, or lift it out. Copying loses — the send does
 * eight things in a required order (claim, retire the version it replaces,
 * resolve the CLIENT's language, build the schedule, attach the document, mail
 * it, log the activity), and a second copy would drift on the first of them
 * that anyone changed.
 *
 * THE CLAIM COMES FIRST, AND THAT IS THE WHOLE SAFETY ARGUMENT
 *
 * `proposalRepository.send` is a conditional update from `draft`, so two tabs,
 * a retried request, or the chat and the builder racing each other produce ONE
 * email. Everything visible happens after that claim succeeds. A second call
 * returns `alreadySent` rather than an error, because sending twice is not a
 * failure the user needs to hear about — it is a thing that must simply not
 * happen.
 *
 * @module lib/services
 */

import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { safeTimezone } from '@/lib/scheduling/businessTime';
import { proposalRepository, type Proposal } from '@/lib/repositories/ProposalRepository';
import { splitTotal } from '@/lib/services/ProposalAcceptanceService';
import { generateProposalToken } from '@/lib/business-os/proposalToken';
import { generateProposalEmail, generateQuoteStoppedEmail } from '@/lib/email/templates/proposal';
import { resolveEmailBranding } from '@/lib/email/branding';
import { sendEmail } from '@/lib/notifications/emailTransport';
import { resolveUserLanguage } from '@/lib/business-os/userLanguage';
import { resolveTermsDays } from '@/lib/payments/paymentTerms';
import type { Locale } from '@/lib/i18n/config';
import { recordEmailSend } from '@/lib/notifications/recordEmailSend';

const logger = createLogger({ service: 'ProposalSendService' });

export type SendProposalOutcome =
  | { ok: true; proposal: Proposal; alreadySent: boolean }
  /** The quote exists but cannot be sent — say which, so the caller can explain. */
  | { ok: false; reason: 'not_found' | 'no_client_email'; proposal?: Proposal };

/**
 * Send one quote.
 *
 * @param proposalId the quote to send
 * @param userId     the owner. Every read here is scoped to it — the contact,
 *                   the document and the branding all belong to the business,
 *                   and a quote for someone else's client must not be sendable
 *                   by naming its id.
 */
export async function sendProposal(
  proposalId: string,
  userId: string
): Promise<SendProposalOutcome> {
  const log = logger.child({ proposalId, userId });

  const existing = await proposalRepository.findById(proposalId, userId);
  if (!existing.data) return { ok: false, reason: 'not_found' };

  const { data: contact } = await supabaseServer
    .from('crm_contacts')
    .select('first_name, last_name, email')
    .eq('id', existing.data.contact_id)
    .eq('user_id', userId)
    .maybeSingle();

  if (!contact?.email) {
    return { ok: false, reason: 'no_client_email', proposal: existing.data };
  }

  /*
   * Claim the send before doing anything visible.
   *
   * Null means it was already sent — by another tab, by the chat while the
   * builder was open, or by a retried request. Not an error; it just must not
   * produce a second email.
   */
  const sent = await proposalRepository.send(proposalId, userId);
  if (!sent.data) {
    log.info('Proposal was already sent');
    return { ok: true, proposal: existing.data, alreadySent: true };
  }

  const proposal = sent.data;

  /*
   * The attached document's record, if this VERSION carries one.
   *
   * Read per version: a revision that changed the scope has its own file, and
   * this send must carry that one rather than whatever the first version was
   * agreed against.
   */
  /* The business default, for a quote that does not name its own terms. */
  const { data: profile } = await supabaseServer
    .from('business_profiles')
    .select('invoice_payment_terms_days')
    .eq('user_id', userId)
    .maybeSingle();

  const { data: document } = proposal.document_id
    ? await supabaseServer
        .from('contact_documents')
        .select('file_name, mime_type, storage_path, storage_bucket')
        .eq('id', proposal.document_id)
        .eq('user_id', userId)
        .maybeSingle()
    : { data: null };

  // A revision retires the version it replaces, so the old link stops accepting
  // and the client cannot agree to superseded terms.
  if (proposal.supersedes_id) {
    await proposalRepository.markSuperseded(proposal.supersedes_id, userId);
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
    .eq('user_id', userId)
    .maybeSingle();

  const locale = resolveUserLanguage({
    profileLanguage: langRow?.language ?? null,
  }).language as Locale;
  const branding = await resolveEmailBranding(userId, locale);

  const token = generateProposalToken(proposal.id, contact.email);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || '';
  const viewUrl = `${appUrl}/proposal/${token}`;

  // The stages as money, so the email states a schedule rather than a count.
  const shape = proposal.payment_shape;
  let stages: Array<{ label: string; amount: number }> = [];
  let dueOnAccept: number | null = proposal.total;

  /*
   * A package billed after each meeting owes NOTHING on approval: the stages
   * are the meetings, and none of them has happened. The email said
   * "₪83.33 due on approval" beside terms that promise the opposite.
   */
  const perSession = Boolean(proposal.sessions?.bill_per_session);

  if (shape.kind === 'milestones') {
    const amounts = splitTotal(proposal.total, shape.stages.map((s) => s.percent));
    stages = shape.stages.map((s, i) => ({ label: s.label, amount: amounts[i] }));
    dueOnAccept = amounts[0];
  } else if (shape.kind === 'installments') {
    const amounts = splitTotal(
      proposal.total,
      Array.from({ length: shape.count }, () => 100 / shape.count)
    );
    stages = amounts.map((amount, i) => ({ label: `${i + 1}/${shape.count}`, amount }));
    dueOnAccept = amounts[0];
  }

  /*
   * The proposal document, fetched and attached.
   *
   * Attached, not linked. The client forwards this to a partner, prints it,
   * holds it against a competitor's — and a link that needs the original email
   * to work survives none of that. The body says it is attached, so a missing
   * file would read as a broken promise.
   *
   * A failure here does NOT stop the send: the quote's numbers are in the body
   * and the document is also on the client's record. It is logged loud enough
   * to notice, because an owner who ticked "attach" believes it went.
   */
  let attachment: { filename: string; content: Buffer; contentType: string } | null = null;

  if (document?.storage_path) {
    try {
      const { data: fileData, error: downloadError } = await supabaseServer.storage
        .from(document.storage_bucket || 'contact-documents')
        .download(document.storage_path);

      if (downloadError || !fileData) throw downloadError ?? new Error('No file returned');

      attachment = {
        filename: document.file_name,
        content: Buffer.from(await fileData.arrayBuffer()),
        /*
         * `contentType`, not `type` — which is what this said before it moved
         * here, and the field the transport actually reads is the former. It
         * typechecked nowhere and shipped anyway because the build ignores type
         * errors, so every proposal document went out with no MIME type
         * declared and the client's mail app had to guess from the filename.
         */
        contentType: document.mime_type || 'application/octet-stream',
      };
    } catch (err) {
      log.error(
        { err, documentId: proposal.document_id },
        'Proposal document could not be attached — the quote was sent without it'
      );
    }
  }

  /*
   * The business's clock, for the meeting times. The email is composed on a
   * server whose own zone means nothing to the client or the owner — an
   * Israeli business's 16:30 sessions rendered as 09:30 on a host in New York.
   */
  const { data: ownerPrefs } = await supabaseServer
    .from('user_preferences')
    .select('timezone')
    .eq('user_id', proposal.user_id)
    .maybeSingle();

  const { subject, html } = generateProposalEmail({
    title: proposal.title,
    description: proposal.description,
    total: proposal.total,
    currency: proposal.currency,
    stages,
    dueOnAccept: perSession ? null : dueOnAccept,
    sessions: proposal.sessions?.dates?.length
      ? {
          dates: proposal.sessions.dates,
          durationMinutes: proposal.sessions.duration_minutes,
          billPerSession: perSession,
          timezone: safeTimezone(ownerPrefs?.timezone),
        }
      : null,
    validUntil: proposal.valid_until,
    viewUrl,
    clientFirstName: contact.first_name,
    branding,
    locale,
    isRevision: Boolean(proposal.supersedes_id),
    /*
     * The terms the client is agreeing to, resolved NOW.
     *
     * The invoice that enforces them may not exist for weeks — a milestone job
     * bills its last stage months later — and by then the business default
     * could have changed. What the client agreed to is what the quote said on
     * the day they read it.
     */
    termsDays: resolveTermsDays(proposal.payment_terms_days, profile?.invoice_payment_terms_days),
    hasDocument: Boolean(document),
    documentName: document?.file_name ?? null,
  });

  const result = await sendEmail({
    kind: 'transactional',
    to: [contact.email],
    subject,
    html,
    // Presents the business as the sender rather than the platform.
    ownerUserId: userId,
    ...(attachment ? { attachments: [attachment] } : {}),
  });

  /*
   * Recorded BEFORE the throw below, deliberately.
   *
   * A proposal that failed to send is exactly what someone will come looking
   * for, and `recordEmailSend` writes it as `status: 'failed'` with the
   * transport's own error. Recording after the throw would keep a record of
   * successes only — which is the half nobody needs to investigate.
   *
   * Its `sent_at` is null on failure, so it stays out of the "emails sent"
   * count, and the activity trigger ignores it.
   */
  await recordEmailSend({
    userId,
    contactId: proposal.contact_id,
    toEmail: contact.email,
    subject,
    bodyHtml: html,
    result,
  });

  /*
   * Nothing downstream may claim this was sent unless it was.
   *
   * `sendEmail` returns rather than throws when no transport delivers, so the
   * discarded result meant a failed proposal still wrote a `proposal_sent`
   * activity to the client's timeline and logged "Proposal sent". The owner
   * would then be waiting on a reply to something the client never received.
   */
  if (!result.sent) {
    log.error({ error: result.error ?? result.blocked }, 'Proposal not sent');
    throw new Error(result.error ?? 'Proposal email could not be sent');
  }

  await supabaseServer.from('crm_activities').insert({
    user_id: userId,
    contact_id: proposal.contact_id,
    activity_type: 'proposal_sent',
    title: proposal.title,
    description: proposal.title,
    auto_logged: true,
    source_capability: 'payments',
    source_entity_id: proposal.id,
    activity_date: new Date().toISOString(),
  });

  log.info('Proposal sent');

  return { ok: true, proposal, alreadySent: false };
}

/**
 * Tell the client the job has been stopped.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HERE rather than in `cancelQuoteStages`, for the reason the prefix module
 * exists: this file already resolves the client's language, the business's
 * branding and the transport, and `lib/payments` should not acquire the email
 * stack to send one notice. `cancelQuoteStages` reaches it through a lazy
 * `await import()`, which also keeps the email transport out of the Jest graph
 * of every test that touches money.
 *
 * BEST EFFORT, ALWAYS. The caller must not fail a stop because an email did not
 * go: the invoices are already voided and the stages already closed, and a retry
 * would find nothing left to do while the owner believed nothing had happened.
 * It returns whether it sent, and says so in the log either way.
 *
 * The client was TOLD ABOUT THIS WORK before, which is why silence is not an
 * option: they hold a quote they signed and invoices in their inbox that no
 * longer stand.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export async function sendQuoteStoppedEmail(
  proposalId: string,
  userId: string,
  facts: {
    paidAmount: number;
    refundedAmount: number;
    invoicesVoided: number;
    stagesClosed: number;
    /** The owner's own sentence — already withheld by the caller if not shared. */
    note?: string | null;
    /** The reason code; the template renders its client-safe phrasing, never the code. */
    reasonCode?: string | null;
  }
): Promise<{ sent: boolean }> {
  try {
    const { data: proposal } = await supabaseServer
      .from('proposals')
      .select('id, title, total, currency, contact_id')
      .eq('id', proposalId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!proposal) {
      logger.warn({ proposalId }, 'Cannot tell the client the job stopped: quote not found');
      return { sent: false };
    }

    const { data: contact } = await supabaseServer
      .from('crm_contacts')
      .select('email, first_name')
      .eq('id', proposal.contact_id)
      .eq('user_id', userId)
      .maybeSingle();

    if (!contact?.email) {
      // Not an error. A quote can be raised against a contact with no email, and
      // the stop itself has already happened correctly.
      logger.info({ proposalId }, 'Job stopped, but the contact has no email address');
      return { sent: false };
    }

    /*
     * The CLIENT's language, not the owner's interface language — a Hebrew
     * business with an English-speaking client must send English. Same resolution
     * `sendProposal` uses above.
     */
    const { data: langRow } = await supabaseServer
      .from('business_profiles')
      .select('language')
      .eq('user_id', userId)
      .maybeSingle();

    const locale = resolveUserLanguage({
      profileLanguage: langRow?.language ?? null,
    }).language as Locale;
    const branding = await resolveEmailBranding(userId, locale);

    const { subject, html } = generateQuoteStoppedEmail({
      title: proposal.title,
      total: Number(proposal.total) || 0,
      currency: proposal.currency,
      paidAmount: facts.paidAmount,
      refundedAmount: facts.refundedAmount,
      invoicesVoided: facts.invoicesVoided,
      stagesClosed: facts.stagesClosed,
      note: facts.note ?? null,
      reasonCode: facts.reasonCode ?? null,
      clientFirstName: contact.first_name ?? null,
      branding,
      locale,
    });

    const result = await sendEmail({
      kind: 'transactional',
      to: [contact.email],
      subject,
      html,
      // The business as sender, not the platform.
      ownerUserId: userId,
    });

    /*
     * Recorded whether it sent or not, exactly as `sendProposal` does.
     *
     * `recordEmailSend` writes a failure as `status: 'failed'` with the
     * transport's own error, and leaves `sent_at` null so it stays out of the
     * "emails sent" count. Recording successes only would keep a record of the
     * half nobody needs to investigate.
     */
    await recordEmailSend({
      userId,
      contactId: proposal.contact_id,
      toEmail: contact.email,
      subject,
      bodyHtml: html,
      result,
    });

    /*
     * `result.sent`, NOT `result.success` — the transport returns rather than
     * throws when nothing delivers, and there is no `success` field on it. An
     * optional-chained check against a field that does not exist is always falsy,
     * so this would have logged a failure on every successful send.
     */
    if (!result.sent) {
      logger.warn(
        { proposalId, error: result.error ?? result.blocked },
        'Could not email the client that the job stopped'
      );
      return { sent: false };
    }

    logger.info({ proposalId, to: contact.email }, 'Told the client the job has been stopped');
    return { sent: true };
  } catch (err) {
    logger.error({ err, proposalId }, 'Could not email the client that the job stopped');
    return { sent: false };
  }
}
