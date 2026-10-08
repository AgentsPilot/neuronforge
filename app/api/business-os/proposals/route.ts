/**
 * The owner's proposals: list what is open, and draft a new one.
 *
 * A proposal holds ONE total and a description. There is no line-item editor
 * here and there should not be — the platform does not model what the carpentry
 * cost, and adding that is the first step toward becoming a project-management
 * tool this deliberately is not.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { isIsoCalendarDate } from '@/lib/business-os/bizql/types';
// Shared with the chat's write path — one definition of the three shapes.
import { paymentShapeSchema } from '@/lib/business-os/proposalShape';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { proposalRepository } from '@/lib/repositories/ProposalRepository';
import { isCompleteSplit } from '@/lib/services/ProposalAcceptanceService';
import { AuditTrailService } from '@/lib/services/AuditTrailService';

const logger = createLogger({ module: 'ProposalsAPI' });
const auditTrail = AuditTrailService.getInstance();

const createSchema = z.object({
  contact_id: z.string().uuid(),
  service_id: z.string().uuid().nullable().optional(),
  /** The booking this quote answers — how the drawer knows which request it belongs to. */
  booking_id: z.string().uuid().nullable().optional(),
  /** An uploaded proposal document, which the client must open before accepting. */
  document_id: z.string().uuid().nullable().optional(),
  /** Days to pay for this quote. Null inherits the business default. */
  payment_terms_days: z.coerce.number().int().min(0).max(365).nullable().optional(),
  title: z.string().min(1).max(200),
  description: z.string().max(5000).nullable().optional(),
  currency: z.enum(['USD', 'EUR', 'ILS', 'GBP']).optional(),
  total: z.number().min(0),
  /**
   * A real calendar day, not any string.
   *
   * This was `z.string()`, and a native date input will happily hand you a
   * five-digit year if someone types one — three quotes in production carry
   * `62026-09-10`, which Postgres accepts (DATE goes to year 5874897) and which
   * renders as "10 בספט׳ 62026" everywhere it is shown. Nothing downstream can
   * repair that; the only place to stop it is here.
   */
  valid_until: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'valid_until must be YYYY-MM-DD')
    .refine(isIsoCalendarDate, 'valid_until is not a real date')
    .refine(
      (value) => Number(value.slice(0, 4)) <= new Date().getUTCFullYear() + 10,
      'valid_until is implausibly far in the future'
    )
    .nullable()
    .optional(),
  payment_shape: paymentShapeSchema.optional(),
  /**
   * A PACKAGE: the meetings this quote sells, as explicit instants.
   *
   * Validated rather than waved through, because acceptance turns each date
   * into a real appointment in a client's diary:
   *
   *   · a real instant, so nothing lands at the epoch;
   *   · at most 52, which is a year of weekly sessions — the cap exists so a
   *     malformed caller cannot create a thousand bookings in one accept;
   *   · a length, because every meeting needs an end. Capped at a day.
   *
   * `service_id` is required alongside it (refined below): the meetings are
   * bookings and `scheduling_bookings.service_id` is NOT NULL, so a package
   * without one is a quote acceptance can only refuse.
   */
  sessions: z
    .object({
      dates: z
        .array(z.string().refine(value => !Number.isNaN(Date.parse(value)), 'not a real date'))
        .min(1)
        .max(52),
      duration_minutes: z.coerce.number().int().min(5).max(1440),
      /*
       * Billed after each meeting rather than up front. See `PackageSessions`:
       * the payment shape stays `milestones`, and this is what says its stages
       * are the meetings.
       */
      bill_per_session: z.boolean().optional(),
    })
    .nullable()
    .optional(),
  /** Set when this replaces a declined or sent version. */
  supersedes_id: z.string().uuid().nullable().optional(),
}).refine(
  data => !data.sessions || Boolean(data.service_id),
  { path: ['service_id'], message: 'A package needs a service: its meetings are bookings.' }
);

export async function GET(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const contactId = new URL(request.url).searchParams.get('contact_id');

    const result = contactId
      ? await proposalRepository.listByContact(contactId, user.id)
      : await proposalRepository.listOpen(user.id);

    if (result.error) {
      requestLogger.error({ err: result.error, userId: user.id }, 'Failed to list proposals');
      return NextResponse.json({ success: false, error: 'Failed to list proposals' }, { status: 500 });
    }

    /*
     * The invoice an accepted quote raised, attached to it.
     *
     * The drawer draws the client journey from these rows, and a quote that has
     * been accepted has money owed against it — but the invoice hangs off the
     * PROPOSAL, not off the booking the journey is built around, so the payment
     * step had nothing to render and simply vanished. An owner looking at a
     * signed job saw the quote accepted and no payment anywhere.
     *
     * Fetched explicitly rather than embedded: a PostgREST join on a nullable
     * FK fails the ENTIRE select when the relationship name is wrong, and this
     * endpoint is the drawer's only source of quotes.
     */
    const proposals = result.data ?? [];

    /*
     * The plan's stages, so the drawer can tell half-paid from finished.
     *
     * Reading only `created_invoice_id` told it about the DEPOSIT and nothing
     * else — so a two-stage job was "paid" the moment the first ₪1,250 of
     * ₪2,500 cleared, and the card retired with half the money outstanding.
     * The stages are the only place the whole agreement is written down.
     */
    const planIds = proposals
      .map(p => p.created_plan_id)
      .filter((id): id is string => Boolean(id));

    let stagesByPlan: Record<string, Array<Record<string, unknown>>> = {};

    if (planIds.length > 0) {
      const { data: stages } = await supabaseServer
        .from('payment_plan_installments')
        .select('id, payment_plan_id, installment_number, amount, currency, status, label, trigger, due_date, invoice_id, completed_at, paid_at')
        .eq('user_id', user.id)
        .in('payment_plan_id', planIds)
        .order('installment_number', { ascending: true });

      stagesByPlan = (stages ?? []).reduce<Record<string, Array<Record<string, unknown>>>>(
        (acc, s) => {
          const key = s.payment_plan_id as string;
          (acc[key] ||= []).push(s);
          return acc;
        },
        {}
      );
    }

    /*
     * ONE invoice fetch, covering the proposal's AND every stage's.
     *
     * It read `created_invoice_id` alone, which is the deposit's invoice. Each
     * milestone raises its OWN invoice when it is billed, and a refund attaches
     * to whichever one was paid — so a refund taken against the second stage was
     * not in this payload under any column, and the drawer could not have shown
     * it however hard it looked.
     *
     * Moved below the stages for that reason: their invoice ids are not known
     * until they are read.
     */
    const stageInvoiceIds = Object.values(stagesByPlan)
      .flat()
      .map(stage => stage.invoice_id)
      .filter((id): id is string => typeof id === 'string' && Boolean(id));

    const invoiceIds = Array.from(
      new Set([
        ...proposals.map(p => p.created_invoice_id).filter((id): id is string => Boolean(id)),
        ...stageInvoiceIds,
      ])
    );

    /*
     * `refunded_amount` and `refund_status` are DERIVED by trigger from the
     * `payment_refunds` ledger — see `20260828d_invoice_refund_state.sql`. They
     * are the only record of money that came back, and selecting neither is why
     * a refunded quote looked untouched on the booking card while the payments
     * list showed it correctly.
     */
    type InvoiceSummary = {
      status: string;
      amount: number;
      currency: string;
      due_date: string | null;
      refunded_amount: number | null;
      refund_status: string | null;
      refunded_at: string | null;
    };

    let invoicesById: Record<string, InvoiceSummary> = {};

    if (invoiceIds.length > 0) {
      const { data: invoices } = await supabaseServer
        .from('payment_invoices')
        .select('id, status, amount, currency, due_date, refunded_amount, refund_status, refunded_at')
        .eq('user_id', user.id)
        .in('id', invoiceIds);

      invoicesById = Object.fromEntries(
        (invoices ?? []).map(i => [
          i.id,
          {
            status: i.status,
            amount: i.amount,
            currency: i.currency,
            due_date: i.due_date,
            refunded_amount: i.refunded_amount ?? null,
            refund_status: i.refund_status ?? null,
            refunded_at: i.refunded_at ?? null,
          },
        ])
      );
    }

    /*
     * Each version's document, so the drawer can show what was actually sent
     * with it. A revision that changed the scope carries a different file, and
     * the history is only honest if it says which.
     */
    const documentIds = proposals
      .map(p => p.document_id)
      .filter((id): id is string => Boolean(id));

    let documentsById: Record<string, { name: string; size: number | null }> = {};

    if (documentIds.length > 0) {
      const { data: docs } = await supabaseServer
        .from('contact_documents')
        .select('id, file_name, file_size')
        .eq('user_id', user.id)
        .in('id', documentIds);

      documentsById = Object.fromEntries(
        (docs ?? []).map(d => [d.id, { name: d.file_name, size: d.file_size }])
      );
    }

    return NextResponse.json({
      success: true,
      proposals: proposals.map(p => ({
        ...p,
        invoice: p.created_invoice_id ? (invoicesById[p.created_invoice_id] ?? null) : null,
        stages: p.created_plan_id
          ? (stagesByPlan[p.created_plan_id] ?? []).map(stage => {
              const stageInvoice =
                typeof stage.invoice_id === 'string' ? invoicesById[stage.invoice_id] : undefined;

              return {
                ...stage,
                /* Flattened onto the stage because that is where the drawer
                   reads it: a refund belongs to the milestone whose money came
                   back, not to the job as a whole. */
                refunded_amount: stageInvoice?.refunded_amount ?? null,
                refund_status: stageInvoice?.refund_status ?? null,
                refunded_at: stageInvoice?.refunded_at ?? null,
              };
            })
          : [],
        document: p.document_id ? (documentsById[p.document_id] ?? null) : null,
      })),
    });
  } catch (error) {
    requestLogger.error({ err: error }, 'Proposals request failed');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    const user = await getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const validated = createSchema.parse(body);

    /*
     * A split that does not cover the job cannot be saved.
     *
     * Checked here as well as in the form, because the form is not the only
     * caller — the chat capability will write proposals too, and a 30/40 split
     * would bill the client 70% of what they agreed and leave the rest
     * unbillable with no way to notice.
     */
    if (validated.payment_shape?.kind === 'milestones') {
      const percents = validated.payment_shape.stages.map(s => s.percent);
      if (!isCompleteSplit(percents)) {
        return NextResponse.json(
          { success: false, error: 'The stages must add up to 100%', code: 'incomplete_split' },
          { status: 400 }
        );
      }
    }

    // The contact must be this business's. A proposal addressed to someone
    // else's client would be visible to them through the CRM drawer.
    const { data: contact } = await supabaseServer
      .from('crm_contacts')
      .select('id')
      .eq('id', validated.contact_id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!contact) {
      return NextResponse.json({ success: false, error: 'Contact not found' }, { status: 404 });
    }

    /*
     * A quote the client has ACCEPTED cannot be replaced.
     *
     * ─────────────────────────────────────────────────────────────────────────
     * Acceptance is not a status, it is a set of consequences: an invoice was
     * raised, a payment plan and its stages were created, and the snapshot of
     * the agreed terms became the document that settles a dispute.
     *
     * Superseding it left BOTH standing. `markSuperseded` deliberately refuses
     * to retire an accepted quote — its status filter is `sent | viewed |
     * declined` — so the old one kept accepting while the new one went out, and
     * a client who accepted the second got a SECOND invoice and a second plan
     * for one job. Nothing further down noticed: acceptance only guards its own
     * row, never a sibling.
     *
     * Refused here rather than only in the dialog, because the dialog is not the
     * only caller — the chat writes proposals too.
     *
     * Ownership is checked in the same read. `supersedes_id` was accepted
     * unvalidated, so a caller could point their own quote at another
     * business's row.
     * ─────────────────────────────────────────────────────────────────────────
     */
    if (validated.supersedes_id) {
      const { data: superseded } = await supabaseServer
        .from('proposals')
        .select('id, status')
        .eq('id', validated.supersedes_id)
        .eq('user_id', user.id)
        .maybeSingle();

      if (!superseded) {
        return NextResponse.json(
          { success: false, error: 'The quote being revised could not be found', code: 'supersedes_not_found' },
          { status: 404 }
        );
      }

      if (superseded.status === 'accepted') {
        requestLogger.warn(
          { supersedesId: validated.supersedes_id },
          'Refused: a quote the client accepted cannot be revised'
        );
        return NextResponse.json(
          {
            success: false,
            code: 'already_accepted',
            error:
              'Your client has already accepted this quote, so it cannot be changed. Cancel the invoice and any payment plan first, then send a new quote.',
          },
          { status: 409 }
        );
      }
    }

    /*
     * Tax copied from the profile at DRAFT time and frozen thereafter, so a
     * business that changes its VAT rate does not re-price quotes already out.
     */
    const { data: profile } = await supabaseServer
      .from('business_profiles')
      .select('invoice_prices_include_tax, invoice_tax_rate, invoice_tax_label')
      .eq('user_id', user.id)
      .maybeSingle();

    const result = await proposalRepository.create({
      user_id: user.id,
      contact_id: validated.contact_id,
      service_id: validated.service_id ?? null,
      booking_id: validated.booking_id ?? null,
      document_id: validated.document_id ?? null,
      payment_terms_days: validated.payment_terms_days ?? null,
      title: validated.title,
      description: validated.description ?? null,
      currency: validated.currency || 'USD',
      total: validated.total,
      prices_include_tax: profile?.invoice_prices_include_tax ?? true,
      tax_rate: profile?.invoice_tax_rate ?? null,
      tax_label: profile?.invoice_tax_label ?? null,
      valid_until: validated.valid_until ?? null,
      payment_shape: validated.payment_shape || { kind: 'single' },
      /*
       * The meetings sold, for a package. Null for every ordinary quote, which
       * is what every quote written before this was.
       */
      sessions: validated.sessions ?? null,
      supersedes_id: validated.supersedes_id ?? null,
    });

    if (result.error || !result.data) {
      return NextResponse.json({ success: false, error: 'Failed to create proposal' }, { status: 500 });
    }

    auditTrail
      .log({
        action: 'PROPOSAL_CREATED',
        userId: user.id,
        entityType: 'proposal',
        entityId: result.data.id,
        resourceName: result.data.title,
        request,
      })
      .catch(err => requestLogger.error({ err }, 'Audit failed'));

    return NextResponse.json({ success: true, proposal: result.data });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid proposal', details: error.errors },
        { status: 400 }
      );
    }
    requestLogger.error({ err: error }, 'Failed to create proposal');
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
