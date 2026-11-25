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

import { rateLimit, tooManyRequests, RATE_LIMITS } from '@/lib/security/rateLimit';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { DECLINE_REASONS } from '@/lib/business-os/cancellationReasons';
import { createLogger } from '@/lib/logger';
import { invoicePayLink } from '@/lib/payments/invoicePayLink';
import { raiseInvoiceForPayment } from '@/lib/payments/raiseInvoiceForPayment';
import { platformOrigin } from '@/lib/utils/origins';
import { supabaseServer } from '@/lib/supabaseServer';
import { verifyProposalToken } from '@/lib/business-os/proposalToken';
import { resolveTermsDays } from '@/lib/payments/paymentTerms';
import { safeTimezone } from '@/lib/scheduling/businessTime';
import { proposalRepository } from '@/lib/repositories/ProposalRepository';
import { applyAcceptance, splitTotal } from '@/lib/services/ProposalAcceptanceService';
import { sendInvoice } from '@/lib/services/InvoiceDeliveryService';
import { sendProposalAcceptedEmail } from '@/lib/services/ProposalSendService';
import type { Proposal } from '@/lib/repositories/ProposalRepository';
import { attachmentsFor } from '@/lib/business-os/proposals/attachmentsFor';
import { formatAddressLines } from '@/lib/geo/address';
import { signatureStatement } from '@/lib/business-os/proposals/signatureStatement';
/* `hashIP` and `getClientIP` from the attribution util — the same pair
   `lib/consent` uses, so a signature's evidence is produced the way every
   other piece of evidence in this product is. */
import { getClientIP, hashIP } from '@/lib/utils/attribution';

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
  /*
   * A job that was agreed and then ended early.
   *
   * MUST be listed, not left to fall through: an unhandled status returns null
   * here and the page renders the quote as live and acceptable. A client holding
   * an old link could then "accept" a job the business has already written off.
   *
   * Reported as `withdrawn` rather than as a new page code. The page's withdrawn
   * copy — this quote is no longer available — is true of a stopped job, and it
   * is what the client needs to know. A separate public code would mean new copy
   * in three languages to tell them something they cannot act on either way.
   * The distinction between "never agreed" and "agreed then stopped" matters to
   * the BUSINESS, and that is where `stop_reason` records it.
   */
  if (proposal.status === 'stopped') return 'withdrawn';
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
 * The attached proposal documents, signed for reading.
 *
 * Empty whenever there are none, a row is gone, or a signature could not be
 * produced — and the page treats all three the same way: it shows no document
 * and does not gate acceptance on one. A quote must never become unacceptable
 * because a file failed to sign.
 */
async function presentDocuments(proposal: Proposal) {
  /*
   * BOTH ERAS, through the one reader.
   *
   * This took `proposal.document_id` alone, which is the only place a quote
   * written before 2026-11-10 keeps its file. A quote written after can carry
   * several, in `proposal_attachments`. `attachmentsFor` returns them in the
   * owner's order with the legacy column first, so this function no longer has
   * to know which kind of quote it is looking at.
   */
  const files = await attachmentsFor(proposal);
  if (files.length === 0) return [];

  const signed = await Promise.all(
    files.map(async file => {
      if (!file.storagePath) return null;

      const { data } = await supabaseServer.storage
        .from(file.storageBucket || 'contact-documents')
        .createSignedUrl(file.storagePath, 60 * 60);

      if (!data?.signedUrl) return null;

      return {
        name: file.fileName,
        size: file.fileSize,
        mimeType: file.mimeType,
        url: data.signedUrl,
      };
    })
  );

  /* One file failing to sign drops that file, never the quote: a page the
     client cannot open is worse than a page missing an attachment. */
  return signed.filter((file): file is NonNullable<typeof file> => file !== null);
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
  const [{ data: contact }, { data: profile }] = await Promise.all([
    supabaseServer
      .from('crm_contacts')
      .select('first_name')
      .eq('id', proposal.contact_id)
      .maybeSingle(),
    // Only for the default terms, when this quote does not name its own.
    supabaseServer
      .from('business_profiles')
      /*
       * The letterhead is read LIVE, not stored on the quote.
       *
       * A business that moves office should not have to reissue open quotes to
       * show the right address, and none of this is a term the client agreed
       * to — the terms are frozen in `accepted_snapshot`, and the letterhead is
       * not among them.
       *
       * The invoice fields first, falling back to the general ones, which is
       * the same order `InvoicePDFGenerator` resolves them in: a business that
       * has filled in its billing identity means that one.
       *
       * Every column here was checked against the live table. A name that does
       * not exist makes PostgREST reject the WHOLE select, which would take the
       * payment terms down with it and expire quotes that are perfectly valid.
       */
      .select(
        'invoice_payment_terms_days, invoice_company_name, invoice_address, invoice_tax_id, company_name, address, phone, email, logo_url, language'
      )
      .eq('user_id', proposal.user_id)
      .maybeSingle(),
  ]);

  /** Every file on this quote, from both places they can live. */
  const documents = await presentDocuments(proposal);

  /** Billed after each meeting: see `PackageSessions.bill_per_session`. */
  const perSession = Boolean(proposal.sessions?.bill_per_session);

  const { data: ownerPrefs } = await supabaseServer
    .from('user_preferences')
    .select('timezone')
    .eq('user_id', proposal.user_id)
    .maybeSingle();

  /*
   * THE DATES THE OWNER ALREADY SEES.
   *
   * ───────────────────────────────────────────────────────────────────────────
   * The drawer shows "לתשלום עד 29 בנוב׳ 2026" against each period, because an
   * ACCEPTED quote has real `payment_plan_installments` rows and it reads them.
   * The client's own page and the email they were sent showed the same three
   * amounts with no dates at all — the one surface where the schedule is being
   * agreed to was the one that could not state it.
   *
   * Read rather than recomputed. The rows are what will actually be billed, and
   * a second derivation here would eventually disagree with them: the anchor is
   * the acceptance plus the payment terms, which is knowable only after the
   * client has pressed accept.
   *
   * Empty before acceptance, which is correct — there is no schedule yet. The
   * first date is the acceptance plus the payment terms (here, 15 October plus
   * 45 days, which is the 29 November the drawer shows), and nothing can know
   * that until the client has pressed accept. The rows render without a date
   * until then rather than carrying a guess into an email the client keeps.
   * ───────────────────────────────────────────────────────────────────────────
   */
  const dueByPeriod = new Map<number, string>();

  if (proposal.booking_id) {
    const { data: periods } = await supabaseServer
      .from('payment_plan_installments')
      .select('installment_number, due_date')
      .eq('user_id', proposal.user_id)
      .eq('booking_id', proposal.booking_id);

    for (const row of periods ?? []) {
      if (row.due_date) dueByPeriod.set(Number(row.installment_number), String(row.due_date));
    }
  }

  const shape = proposal.payment_shape;
  let stages: Array<{ label: string; amount: number; dueDate?: string | null }> = [];

  if (shape.kind === 'milestones') {
    const amounts = splitTotal(proposal.total, shape.stages.map(s => s.percent));
    /*
     * No date, ever, and that is not an omission. A milestone falls due when
     * the work is done, so it HAS no date until the owner marks it — which is
     * why `payment_plan_installments.due_date` is null for these and why the
     * trigger is 'manual' rather than 'date'.
     */
    stages = shape.stages.map((s, i) => ({ label: s.label, amount: amounts[i] }));
  } else if (shape.kind === 'installments') {
    const amounts = splitTotal(
      proposal.total,
      Array.from({ length: shape.count }, () => 100 / shape.count)
    );
    stages = amounts.map((amount, i) => ({
      label: `${i + 1}/${shape.count}`,
      amount,
      /* `i + 1` because the rows are numbered from one, as the labels are. */
      dueDate: dueByPeriod.get(i + 1) ?? null,
    }));
  }

  return {
    title: proposal.title,
    description: proposal.description,
    total: proposal.total,
    currency: proposal.currency,
    validUntil: proposal.valid_until,
    stages,
    /*
     * WHAT THE CLIENT PAYS WHEN THEY PRESS ACCEPT.
     *
     * Zero for a package billed after each meeting: the stages are the
     * meetings, and none of them has happened. The button read "Accept —
     * ₪83.33 due now" for a quote whose own terms say nothing is due until the
     * first session is held, which is the page contradicting the offer.
     */
    dueOnAccept: perSession ? 0 : stages.length ? stages[0].amount : proposal.total,
    clientFirstName: contact?.first_name ?? null,
    /*
     * The terms, on the page as well as in the email.
     *
     * The page is where they press accept and the copy they come back to — an
     * offer whose payment date lives only in an email they may have lost is an
     * offer they cannot fully read.
     */
    termsDays: resolveTermsDays(proposal.payment_terms_days, profile?.invoice_payment_terms_days),
    /*
     * The proposal document, as a short-lived signed link.
     *
     * Signed rather than public: the bucket holds every client's paperwork, and
     * a guessable path would expose one client's contract to another. One hour
     * is long enough to read a proposal and short enough that a forwarded link
     * stops working.
     */
    /*
     * `document` is kept as the FIRST attachment so every existing reader —
     * the accept gate, the card, the guard tests — goes on working unchanged.
     * `documents` carries the full list beside it.
     */
    document: documents[0] ?? null,
    documents,
    /* Whether Approve is gated. False on every quote written before this. */
    requiresSignature: Boolean(proposal.requires_signature),
    /*
     * THE BREAKDOWN, and the letterhead it is printed on.
     *
     * `breakdown`, not `document` — that key is taken by the file the owner
     * uploaded, and the two are different things: this is JSON the owner built
     * here, that is a file they attached. Giving them one name is how a client
     * ends up being shown one and told about the other.
     *
     * Null for every quote priced as a single figure, which is all 46 written
     * before this existed. The page renders nothing at all for null rather
     * than an empty section.
     *
     * The items are sent as they were stored: already rounded, already summing
     * to `total`. The page formats, it does not re-add.
     */
    breakdown: proposal.content?.items?.length
      ? {
          items: proposal.content.items,
          tax: proposal.content.tax,
          letterhead: {
            name: profile?.invoice_company_name || profile?.company_name || null,
            /*
             * LINES, not an object.
             *
             * `invoice_address` is jsonb — `{line1, city, state, postal_code,
             * country}` — and the page interpolated it straight into a joined
             * string, so a live quote's letterhead read
             * `[object Object] · +1201… · …`.
             *
             * Formatted HERE rather than on the page so this and the PDF use
             * the one formatter and the one locale: `formatAddressLines`
             * renders `US` as ארצות הברית for a Hebrew reader, which a join
             * could never do.
             */
            addressLines: formatAddressLines(
              (profile?.invoice_address || profile?.address || null) as Parameters<
                typeof formatAddressLines
              >[0],
              (profile?.language === 'he' || profile?.language === 'es'
                ? profile.language
                : 'en') as 'en' | 'es' | 'he'
            ),
            taxId: profile?.invoice_tax_id || null,
            phone: profile?.phone || null,
            email: profile?.email || null,
            logoUrl: profile?.logo_url || null,
          },
        }
      : null,
    /*
     * Which version this is.
     *
     * Sent back with the answer so the POST acts on the offer the client
     * actually read. Without it, a revision landing between their opening the
     * page and pressing accept would be accepted sight unseen.
     */
    id: proposal.id,
    isRevision: Boolean(proposal.supersedes_id),
    /*
     * THE MEETINGS, for a package.
     *
     * The client is agreeing to six specific hours of their own life, so the
     * dates belong on the page they press accept on — not only in the email,
     * and certainly not discovered afterwards in a confirmation. Sent as
     * instants; the page formats them on the READER's clock, which is the one
     * they will turn up by.
     *
     * Null for every ordinary quote.
     */
    sessions: proposal.sessions?.dates?.length
      ? {
          dates: proposal.sessions.dates,
          durationMinutes: proposal.sessions.duration_minutes,
          /*
           * Billed after each meeting, so the page can say so instead of
           * showing a schedule of stages that duplicates the dates.
           */
          billPerSession: perSession,
          /*
           * THE BUSINESS'S CLOCK, named.
           *
           * The page formatted these on the READER's clock, which for a page
           * that server-renders its first paint is the server's: an Israeli
           * business's 16:30 sessions were listed as 09:30, every one of them,
           * because the host runs in New York. The hour a client turns up at is
           * the business's, so it is resolved here and the page is told which
           * zone it is showing.
           */
          timezone: safeTimezone(ownerPrefs?.timezone),
        }
      : null,
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

    /*
     * Through `invoicePayLink`, not hand-built.
     *
     * A quote that created an invoice created it against a BOOKING, so the
     * client belongs in the portal — the appointment they just agreed to, the
     * amount, and the card fields on one page. This sent them to the invoice
     * document instead, which is the fallback for invoices with no booking
     * behind them.
     */
    invoiceUrl = await invoicePayLink({
      invoiceId: proposal.created_invoice_id,
      bookingId: proposal.booking_id ?? null,
      userId: proposal.user_id,
      baseUrl: platformOrigin(),
    });
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
    /*
     * The signature, when the quote asks for one.
     *
     * Optional HERE and required BELOW, against the proposal's own
     * `requires_signature` — the schema cannot see the row, and a quote that
     * does not ask for a signature must not be refused for lacking one.
     *
     * `statement` is what the PAGE displayed. It is not what gets recorded:
     * the server resolves its own wording and keeps this as the client's echo,
     * so a stale page cannot decide what was agreed to.
     */
    signature: z
      .object({
        name: z.string().trim().min(2).max(200),
        agreed: z.literal(true),
        statement: z.string().max(500).optional(),
        /*
         * The drawn mark, as a PNG data URI.
         *
         * Bounded and shape-checked HERE as well as by the column's CHECK: this
         * is a public, unauthenticated endpoint, and the row it writes to can
         * never be edited or deleted afterwards. 350k of base64 is ~256KB —
         * far above a real signature (5-20KB) and far below what an unbounded
         * field would accept.
         */
        image: z
          .string()
          .regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/, 'A signature must be a PNG')
          .max(350000)
          .nullable()
          .optional(),
      })
      .optional(),
  }),
  z.object({
    answer: z.literal('decline'),
    // One tap from a short list. The reason is what turns a lost quote into a
    // second attempt, so it is asked for rather than inferred.
    /*
     * From the shared list, not a literal. Two copies of the same five codes in
     * two files is how the client and the server come to disagree about which
     * are valid — and the page that offers them now imports the same constant.
     */
    reason: z.enum(DECLINE_REASONS),
    note: z.string().max(1000).optional(),
  }),
]);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  /*
   * Accepting or declining a quote commits a client to money. Gated like any other unauthenticated write.
   */
  const throttle = await rateLimit(request, 'proposal-answer', RATE_LIMITS.write);
  if (!throttle.allowed) return tooManyRequests(RATE_LIMITS.write.windowSeconds);
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
    /*
     * Never accept a revision of a quote the client ALREADY accepted.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * The claim below guards its own row and nothing else, so a revision of an
     * accepted quote could be accepted too — raising a SECOND invoice and a
     * second payment plan for one job, and leaving two signed documents where
     * there should be one.
     *
     * Creating such a revision is now refused when the quote is written, so this
     * exists for chains that already exist: a `sent` revision whose parent was
     * accepted before that guard landed.
     *
     * Scoped to the PARENT in the chain, deliberately — not to everything
     * sharing a booking. A business may quote the same appointment twice for
     * genuinely separate work, and refusing that would block a sale nobody
     * asked us to block. `accepted` is the code the page already has wording
     * for: what the client needs to read is that this is settled.
     * ─────────────────────────────────────────────────────────────────────────
     */
    if (existing.supersedes_id) {
      const { data: parent } = await proposalRepository.findByIdForToken(existing.supersedes_id);

      if (parent?.status === 'accepted') {
        requestLogger.warn(
          { proposalId: existing.id, parentId: existing.supersedes_id },
          'Refused: this revises a quote the client already accepted'
        );
        return NextResponse.json({ success: false, code: 'accepted' });
      }
    }

    /*
     * ─────────────────────────────────────────────────────────────────────────
     * THE SIGNATURE IS CHECKED BEFORE THE CLAIM. THE ORDER IS THE DESIGN.
     *
     * `claimForAcceptance` is a ONE-SHOT conditional update, `sent|viewed →
     * accepted`. It is what guarantees a single acceptance, and it cannot be
     * taken back: there is no path in this product that returns an accepted
     * quote to `sent`.
     *
     * So a signature validated AFTER it would leave a quote permanently
     * accepted, with no money raised and no way for the client to try again —
     * every retry would hit `blockingState` and be told it was already
     * accepted. The client would be locked out of a purchase they were trying
     * to make, by a typo.
     *
     * Validated here, a refusal costs nothing: the quote is still `sent`, the
     * page re-renders, and they correct it.
     * ─────────────────────────────────────────────────────────────────────────
     */
    if (existing.requires_signature) {
      const signature = parsed.data.signature;
      if (!signature?.name?.trim() || signature.agreed !== true || !signature.image) {
        requestLogger.warn(
          { proposalId: existing.id },
          'Refused: this quote needs a signature and none was given'
        );
        return NextResponse.json(
          { success: false, code: 'signature_required' as const },
          { status: 400 }
        );
      }
    }

    const claimed = await proposalRepository.claimForAcceptance(existing.id);
    if (!claimed.data) {
      const { data: now } = await proposalRepository.findByIdForToken(existing.id);
      return NextResponse.json({ success: false, code: now ? blockingState(now) : 'not_found' });
    }

    const proposal = claimed.data;

    /*
     * Written after the claim and BEFORE the money.
     *
     * After the claim, because only one request wins it and the signature must
     * belong to that one. Before `applyAcceptance`, because an invoice raised
     * against an unrecorded signature is the one combination that cannot be
     * explained afterwards — and a failure here leaves a quote accepted with no
     * money raised, which is the same window that already exists between the
     * claim and the invoice today. No new class of failure, and the smaller
     * half of the two.
     */
    if (proposal.requires_signature && parsed.data.signature) {
      /*
       * The BUSINESS's language, which is the client's: the quote, its email
       * and the page they signed on were all written in it. Read here rather
       * than taken from the request, because the statement that gets recorded
       * must not be chosen by the browser sending it.
       */
      const { data: signingProfile } = await supabaseServer
        .from('business_profiles')
        .select('language')
        .eq('user_id', proposal.user_id)
        .maybeSingle();

      const statement = signatureStatement(signingProfile?.language);
      const clientEcho = parsed.data.signature.statement?.trim();
      if (clientEcho && clientEcho !== statement.text) {
        /* Not a refusal — the server's wording is what is recorded either way.
           Logged so a page shipping stale copy is visible. */
        requestLogger.warn(
          { proposalId: proposal.id },
          'Signature statement echoed by the client differs from the server wording'
        );
      }

      const ip = getClientIP(request.headers);
      /* The salt is stored WITH the hash: `hashIP` salts with the calendar day,
         which is unverifiable later unless the day is kept. */
      const salt = ip ? new Date().toDateString() : null;

      const { error: signatureError } = await supabaseServer.from('proposal_signatures').insert({
        proposal_id: proposal.id,
        user_id: proposal.user_id,
        signed_name: parsed.data.signature.name.trim(),
        statement_text: statement.text,
        statement_locale: statement.locale,
        statement_version: statement.version,
        ip_hash: ip ? hashIP(ip, salt ?? undefined) : null,
        ip_hash_salt: salt,
        user_agent: request.headers.get('user-agent'),
        /* Named by what the client actually did, not by what the flow asked
           for — a row that says `drawn` carries a mark, always. */
        method: parsed.data.signature.image ? 'drawn' : 'typed_name',
        signature_image: parsed.data.signature.image ?? null,
        ...(clientEcho ? { evidence: { client_statement: clientEcho } } : {}),
      });

      if (signatureError) {
        requestLogger.error(
          { err: signatureError, proposalId: proposal.id },
          'Signature could not be recorded — acceptance stopped before any money was raised'
        );
        return NextResponse.json(
          { success: false, code: 'signature_failed' as const },
          { status: 500 }
        );
      }
    }

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
        // Frozen with the rest: changing the business default next month must
        // not retroactively shorten terms somebody already agreed to.
        payment_terms_days: proposal.payment_terms_days,
        tax_rate: proposal.tax_rate,
        tax_label: proposal.tax_label,
        prices_include_tax: proposal.prices_include_tax,
        /*
         * The breakdown, frozen with the rest.
         *
         * It is part of what was agreed — a client approved these items at
         * these prices — and the row's `content` can be superseded by a
         * revision. Without it the snapshot would record a total with nothing
         * explaining it, which is the dispute it exists to settle.
         */
        ...(proposal.content ? { content: proposal.content } : {}),
        /*
         * A POINTER, not the evidence.
         *
         * The signature lives in its own append-only table where it cannot be
         * edited; copying it here would make a second, editable copy of the
         * one record whose value is that it cannot be edited.
         *
         * Additive: the 28 snapshots written before this have neither key, and
         * every reader must go on working without them.
         */
        ...(proposal.requires_signature ? { signed: true } : {}),
        accepted_at: new Date().toISOString(),
      },
      {
        invoiceId: created.invoiceId,
        planId: created.planId,
        // The package, for a quote that sold several meetings. Null otherwise,
        // which is every quote written before packages existed.
        packageBookingId: created.package?.container ?? null,
      }
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
     * That was once settled by sending the email only when there was nothing to
     * redirect to. The email now goes on BOTH branches — a client with money
     * due used to receive nothing at all, not even the document they had just
     * signed — so the second door has to be closed by the WORDING instead.
     *
     * `payCta` is "View your invoice", never "Pay now". The link still goes to
     * the same invoice page, which is the recovery path for a client who closed
     * the payment tab, and which shows the invoice as PAID once it is. What it
     * no longer does is ask a client who has just paid on the redirect to pay
     * again, which is what an owner reported.
     *
     * The narrow case the paragraph above describes is not fully closed: a
     * client who opens the email while the payment tab is still live can still
     * start a second checkout. Neutral wording makes that far less inviting; it
     * does not make it impossible, and the atomic fix belongs on the pay route.
     */
    const willRedirect = Boolean(created.invoiceId) && created.dueNow > 0;

    /*
     * Hoisted: signing reads the contact address, so it cannot sit inside the
     * response object literal below.
     *
     * Null when nothing falls due on acceptance — a quote billed entirely on
     * completion is accepted and simply has nothing to pay yet, which is not a
     * failure and must not look like one.
     */
    const acceptedInvoiceUrl =
      willRedirect && created.invoiceId
        ? await invoicePayLink({
            invoiceId: created.invoiceId,
            bookingId: proposal.booking_id ?? null,
            userId: proposal.user_id,
            baseUrl: platformOrigin(),
          })
        : null;

    /*
     * Redirecting IS issuing.
     *
     * `sendInvoice` is what normally moves an invoice out of `draft`, and this
     * path deliberately does not call it — so the client was being sent to an
     * invoice the pay route refuses with "this invoice has not been sent yet".
     * From the client's side it plainly has been issued: they are looking at it.
     *
     * `sent_at` stays NULL on purpose. It records when the invoice was EMAILED,
     * and it is the key the abandonment sweep uses to find quotes nobody
     * followed through on. Setting it here would mark this one as already
     * chased and the client who wandered off would never hear from us again.
     */
    if (created.invoiceId && willRedirect) {
      /*
       * RAISE IT AT STRIPE, so the client can actually pay when they land.
       *
       * This branch marks the row `sent` and sends the client off to pay —
       * and until now that was all it did. Stripe was never told, so the
       * invoice had no PaymentIntent and no `confirmation_secret`, and the
       * portal's card had nothing to confirm.
       *
       * It worked before the portal because the Pay button went to
       * `/api/public/invoice/[id]/pay`, which built a Checkout Session on the
       * spot. The embedded card cannot do that: it needs the invoice itself.
       *
       * Awaited, not floated: a serverless function freezes the moment it
       * responds, and a floating promise dies with it — the same reason the
       * no-money-due branch below awaits its send.
       *
       * Non-blocking in effect. It never throws, and a business with no
       * processor simply gets `cannot_collect` and keeps its bank details.
       * Acceptance has already happened and must not be undone by a Stripe
       * hiccup.
       */
      const raised = await raiseInvoiceForPayment(created.invoiceId, proposal.user_id);

      if (!raised.ok) {
        requestLogger.warn(
          { invoiceId: created.invoiceId, reason: raised.reason },
          'Accepted, but the invoice could not be raised at Stripe; card payment will be unavailable'
        );
      }

      const { error: issueError } = await supabaseServer
        .from('payment_invoices')
        .update({ status: 'sent' })
        .eq('id', created.invoiceId)
        .eq('status', 'draft');

      if (issueError) {
        requestLogger.error(
          { err: issueError, invoiceId: created.invoiceId },
          'Accepted but the invoice could not be marked issued — the client cannot pay it'
        );
      }
    }

    if (created.invoiceId && !willRedirect) {
      /*
       * AWAITED, for the reason the milestone endpoint records at length.
       *
       * A floating promise does not survive a serverless response: the function
       * freezes, and the send dies with it. This is the FIRST invoice of a
       * quoted job — the one the client is waiting for the moment they accept —
       * so it is the worst one to lose.
       *
       * Still non-fatal. The quote is accepted, the plan and the invoice exist,
       * and nothing below depends on the mail having left; a failure is logged
       * and the owner can resend.
       */
      try {
        // Reported, not thrown — see the milestone endpoint for the same note.
        const sent = await sendInvoice({
          invoiceId: created.invoiceId,
          userId: proposal.user_id,
          request,
        });

        if (sent.error) {
          requestLogger.error(
            { err: sent.error, invoiceId: created.invoiceId, proposalId: proposal.id },
            'Accepted, but the invoice email did not go out'
          );
        }
      } catch (err) {
        requestLogger.error(
          { err, invoiceId: created.invoiceId, proposalId: proposal.id },
          'Acceptance invoice send threw'
        );
      }
    }

    requestLogger.info(
      { proposalId: proposal.id, invoiceId: created.invoiceId, planId: created.planId },
      'Proposal accepted'
    );

    /*
     * ───────────────────────────────────────────────────────────────────────
     * A PACKAGE DATE THAT WAS TAKEN WHILE THE QUOTE SAT UNANSWERED.
     *
     * Acceptance never refuses the whole package over one slot — the client has
     * agreed, and possibly paid — so it creates what it can and reports the
     * rest. Until now that report went only to the log, which means the owner
     * learns about it by counting meetings.
     *
     * Written to the CONTACT'S TIMELINE, because that is where the owner is
     * already looking when they open this client: beside the acceptance itself,
     * naming the dates to re-offer. Non-blocking for the same reason every
     * other write here is — the client's answer must not fail over a note.
     * ───────────────────────────────────────────────────────────────────────
     */
    if (created.package?.clashed?.length) {
      const dates = created.package.clashed;

      requestLogger.warn(
        { proposalId: proposal.id, clashed: dates },
        'A package was accepted with dates that were no longer free'
      );

      await supabaseServer
        .from('crm_activities')
        .insert({
          user_id: proposal.user_id,
          contact_id: proposal.contact_id,
          activity_type: 'note',
          title: `${dates.length} session ${dates.length === 1 ? 'time' : 'times'} were already taken`,
          description:
            `These times were no longer free when the quote was accepted, so they were not booked: ` +
            `${dates.join(', ')}. Offer the client another time for each.`,
          auto_logged: true,
          source_capability: 'payments',
          source_entity_id: proposal.id,
          activity_date: new Date().toISOString(),
        })
        .then(({ error }) => {
          if (error) {
            requestLogger.error(
              { err: error, proposalId: proposal.id },
              'Could not record the clashed package dates on the timeline'
            );
          }
        });
    }

    /*
     * ─────────────────────────────────────────────────────────────────────────
     * THE CLIENT'S COPY OF WHAT THEY JUST AGREED TO.
     *
     * BOTH branches, which is the point. Until now a quote with money due sent
     * the client nothing at all — they were redirected to a payment page — and
     * one with nothing due sent an INVOICE. Either way they held a bill and no
     * record of the agreement, nor of the signature they had just drawn.
     *
     * AWAITED, not fired and forgotten. On the redirect branch the browser
     * leaves for the payment page the moment this response returns, and a
     * serverless host is free to freeze the function with the mail half-sent.
     * The cost is a second or two on a page the client is leaving anyway.
     *
     * It cannot throw: `sendProposalAcceptedEmail` swallows everything. The
     * quote is claimed, the invoice is raised and the meetings are booked by
     * this point — a client who cannot be emailed has still bought the work,
     * and failing the response would tell them otherwise.
     * ─────────────────────────────────────────────────────────────────────────
     */
    await sendProposalAcceptedEmail(proposal.id, proposal.user_id, acceptedInvoiceUrl);

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
        invoiceUrl: acceptedInvoiceUrl,
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
