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
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { proposalRepository } from '@/lib/repositories/ProposalRepository';
import { isCompleteSplit } from '@/lib/services/ProposalAcceptanceService';
import { AuditTrailService } from '@/lib/services/AuditTrailService';

const logger = createLogger({ module: 'ProposalsAPI' });
const auditTrail = AuditTrailService.getInstance();

const paymentShapeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('single') }),
  z.object({
    kind: z.literal('installments'),
    count: z.number().int().min(2).max(24),
    frequency: z.enum(['weekly', 'biweekly', 'monthly', 'quarterly']),
  }),
  z.object({
    kind: z.literal('milestones'),
    stages: z
      .array(
        z.object({
          label: z.string().min(1).max(120),
          percent: z.number().min(0.01).max(100),
        })
      )
      .min(2)
      .max(12),
  }),
]);

const createSchema = z.object({
  contact_id: z.string().uuid(),
  service_id: z.string().uuid().nullable().optional(),
  /** The booking this quote answers — how the drawer knows which request it belongs to. */
  booking_id: z.string().uuid().nullable().optional(),
  /** An uploaded proposal document, which the client must open before accepting. */
  document_id: z.string().uuid().nullable().optional(),
  title: z.string().min(1).max(200),
  description: z.string().max(5000).nullable().optional(),
  currency: z.enum(['USD', 'EUR', 'ILS', 'GBP']).optional(),
  total: z.number().min(0),
  valid_until: z.string().nullable().optional(),
  payment_shape: paymentShapeSchema.optional(),
  /** Set when this replaces a declined or sent version. */
  supersedes_id: z.string().uuid().nullable().optional(),
});

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
    const invoiceIds = proposals
      .map(p => p.created_invoice_id)
      .filter((id): id is string => Boolean(id));

    let invoicesById: Record<string, { status: string; amount: number; currency: string; due_date: string | null }> = {};

    if (invoiceIds.length > 0) {
      const { data: invoices } = await supabaseServer
        .from('payment_invoices')
        .select('id, status, amount, currency, due_date')
        .eq('user_id', user.id)
        .in('id', invoiceIds);

      invoicesById = Object.fromEntries(
        (invoices ?? []).map(i => [
          i.id,
          { status: i.status, amount: i.amount, currency: i.currency, due_date: i.due_date },
        ])
      );
    }

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
        stages: p.created_plan_id ? (stagesByPlan[p.created_plan_id] ?? []) : [],
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
      title: validated.title,
      description: validated.description ?? null,
      currency: validated.currency || 'USD',
      total: validated.total,
      prices_include_tax: profile?.invoice_prices_include_tax ?? true,
      tax_rate: profile?.invoice_tax_rate ?? null,
      tax_label: profile?.invoice_tax_label ?? null,
      valid_until: validated.valid_until ?? null,
      payment_shape: validated.payment_shape || { kind: 'single' },
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
