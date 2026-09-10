/**
 * What happens the moment a client accepts.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE RISK THIS FILE EXISTS TO CONTAIN
 *
 * Accepting creates a plan, its stages, and an invoice. That button fires twice
 * more often than it looks: a double click, the email link opened on a phone
 * and then a laptop, a slow network the browser silently retries, a refresh
 * mid-request. Twice means the client is billed twice for one agreement, which
 * is a phone call and a lost client rather than a bug report.
 *
 * The guard is a conditional update in ProposalRepository.claimForAcceptance —
 * the database allows sent/viewed → accepted exactly once. Whoever wins does
 * the work here; everyone else is shown the same finished result. Nothing in
 * this file may be called without that claim first.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * The three payment shapes settle here, in one place, so a future surface
 * cannot invent a fourth interpretation:
 *
 *   single       one invoice for the whole total
 *   installments a plan whose stages carry due dates
 *   milestones   a plan whose stages carry NAMES and no dates, each billed when
 *                the owner marks that stage complete
 */

import { createLogger } from '@/lib/logger';
import { supabaseServer } from '@/lib/supabaseServer';
import { paymentInvoiceRepository } from '@/lib/repositories/PaymentRepository';
import type { Proposal, PaymentShape } from '@/lib/repositories/ProposalRepository';

const logger = createLogger({ service: 'ProposalAcceptanceService' });

export interface AcceptanceResult {
  invoiceId: string | null;
  planId: string | null;
  /** What the client owes right now, if anything. */
  dueNow: number;
}

/**
 * Split a total into stage amounts whose sum is EXACTLY the total.
 *
 * Percentages are what the owner types; money is what the client pays. 30/40/30
 * of ₪60,000 is exact, but 33/33/34 of ₪1,000 is not — and a split that loses
 * an agora means the invoices never add up to what was accepted, which is the
 * one arithmetic error nobody forgives.
 *
 * The remainder lands on the FINAL stage, the same convention `planPhases()`
 * already uses for Stripe subscription phases.
 */
export function splitTotal(total: number, percents: number[]): number[] {
  const minorTotal = Math.round(total * 100);
  const amounts = percents.map(p => Math.floor((minorTotal * p) / 100));
  const remainder = minorTotal - amounts.reduce((sum, a) => sum + a, 0);
  amounts[amounts.length - 1] += remainder;
  return amounts.map(minor => minor / 100);
}

/** Does this split describe the whole job? */
export function isCompleteSplit(percents: number[]): boolean {
  const sum = percents.reduce((a, b) => a + b, 0);
  // Tolerance for a typed 33.33 × 3; anything looser would let a real mistake
  // through, and anything tighter would reject a legitimate thirds split.
  return Math.abs(sum - 100) < 0.01;
}

/**
 * Turn an accepted proposal into money owed.
 *
 * Never called except by the winner of `claimForAcceptance`.
 */
export async function applyAcceptance(proposal: Proposal): Promise<AcceptanceResult> {
  const shape = (proposal.payment_shape || { kind: 'single' }) as PaymentShape;

  if (shape.kind === 'single') {
    const invoiceId = await raiseInvoice(proposal, proposal.total, proposal.title);
    return { invoiceId, planId: null, dueNow: proposal.total };
  }

  const stages =
    shape.kind === 'milestones'
      ? shape.stages
      : // An instalment plan is an equal split by another name, which is why it
        // shares this path rather than owning a second one.
        Array.from({ length: shape.count }, (_, i) => ({
          label: '',
          percent: 100 / shape.count,
          index: i,
        }));

  const amounts = splitTotal(proposal.total, stages.map(s => s.percent));

  const planId = await createPlan(proposal, stages.length, amounts);
  if (!planId) {
    /*
     * No plan means no stages to bill against. Falling back to one invoice for
     * the whole total would charge a client the entire amount they had agreed
     * to pay in three parts — worse than the failure. The proposal stays
     * accepted with nothing created, which is visible and recoverable.
     */
    logger.error({ proposalId: proposal.id }, 'Accepted but the payment plan could not be created');
    return { invoiceId: null, planId: null, dueNow: 0 };
  }

  const isMilestones = shape.kind === 'milestones';
  const firstDue = new Date().toISOString().slice(0, 10);

  const rows = stages.map((stage, index) => ({
    user_id: proposal.user_id,
    payment_plan_id: planId,
    contact_id: proposal.contact_id,
    proposal_id: proposal.id,
    /*
     * The job these stages belong to.
     *
     * Set alongside `contact_id` and `proposal_id`, which were — this one was
     * simply missed. Every query that asks "what does this booking still owe"
     * goes through `booking_id`, so without it the stages were reachable only
     * from the proposal, and the booking they bill knew nothing about them.
     */
    booking_id: proposal.booking_id,
    installment_number: index + 1,
    amount: amounts[index],
    currency: proposal.currency,
    label: 'label' in stage && stage.label ? stage.label : null,
    /*
     * The first stage of a milestone plan is billed on acceptance — it is the
     * deposit, and the work it pays for is "agreeing". Every later stage waits
     * for the owner to say the work happened, so it has no date at all.
     */
    trigger: isMilestones && index > 0 ? 'manual' : 'date',
    due_date: isMilestones && index > 0 ? null : dueDateFor(shape, index, firstDue),
    status: 'pending',
  }));

  const { data: stageRows, error: stageError } = await supabaseServer
    .from('payment_plan_installments')
    .insert(rows)
    .select('id, installment_number');
  if (stageError) {
    logger.error({ err: stageError, proposalId: proposal.id, planId }, 'Could not create the stages');
    return { invoiceId: null, planId, dueNow: 0 };
  }

  // Only the first stage is billed now. The rest are raised as they fall due,
  // or as the owner marks them complete.
  const firstLabel =
    'label' in stages[0] && stages[0].label
      ? `${proposal.title} — ${stages[0].label}`
      : `${proposal.title} (1/${stages.length})`;

  const invoiceId = await raiseInvoice(proposal, amounts[0], firstLabel);

  /*
   * Link the invoice to the stage it bills.
   *
   * The two were created and never introduced, so nothing could answer "how
   * much of this job has been collected": the invoice knew it was paid and the
   * stage still said pending. `settleInvoice` moves the stage by this link, so
   * without it a two-stage job read as finished the moment the deposit cleared.
   */
  if (invoiceId && stageRows?.length) {
    const first = [...stageRows].sort(
      (a, b) => (a.installment_number ?? 0) - (b.installment_number ?? 0)
    )[0];

    const { error: linkError } = await supabaseServer
      .from('payment_plan_installments')
      .update({ invoice_id: invoiceId })
      .eq('id', first.id);

    if (linkError) {
      logger.error(
        { err: linkError, proposalId: proposal.id, invoiceId, stageId: first.id },
        'The deposit invoice could not be linked to its stage'
      );
    }
  }

  if (!invoiceId) {
    // Loud, because the acceptance has already been committed and the client
    // has been told they owe a deposit. Silence here is what let a constraint
    // violation look like a quote with nothing to pay.
    logger.error(
      { proposalId: proposal.id, planId, amount: amounts[0] },
      'Accepted with no invoice raised — the client owes money that was never billed'
    );
  }

  return { invoiceId, planId, dueNow: amounts[0] };
}

/* ------------------------------------------------------------------ helpers */

function dueDateFor(shape: PaymentShape, index: number, from: string): string {
  if (index === 0 || shape.kind !== 'installments') return from;

  const date = new Date(`${from}T12:00:00Z`);
  const step = { weekly: 7, biweekly: 14, monthly: 30, quarterly: 91 }[shape.frequency] ?? 30;
  date.setUTCDate(date.getUTCDate() + step * index);
  return date.toISOString().slice(0, 10);
}

async function createPlan(
  proposal: Proposal,
  count: number,
  amounts: number[]
): Promise<string | null> {
  try {
    const { data, error } = await supabaseServer
      .from('payment_plans')
      .insert({
        user_id: proposal.user_id,
        service_id: proposal.service_id,
        name: proposal.title,
        total_amount: proposal.total,
        currency: proposal.currency,
        installment_count: count,
        // The first stage's amount. The column is a single number and the
        // stages carry their own; this is the headline, not the source of truth.
        installment_amount: amounts[0],
        installment_frequency: 'monthly',
      })
      .select('id')
      .single();

    if (error) throw error;
    return data.id as string;
  } catch (error) {
    logger.error({ err: error, proposalId: proposal.id }, 'Failed to create the payment plan');
    return null;
  }
}

/**
 * Raise one invoice.
 *
 * Deliberately does NOT send it or touch Stripe. Sending is a separate step
 * with its own failure handling in `InvoiceDeliveryService`, which already
 * decides between a Stripe hosted page and a branded PDF by email — and
 * already falls back to email when Stripe is unavailable. Re-deciding that here
 * would give a proposal-raised invoice different behaviour from every other one.
 */
async function raiseInvoice(
  proposal: Proposal,
  amount: number,
  description: string
): Promise<string | null> {
  try {
    const { data: contact } = await supabaseServer
      .from('crm_contacts')
      .select('first_name, last_name, email')
      .eq('id', proposal.contact_id)
      .eq('user_id', proposal.user_id)
      .maybeSingle();

    const numberResult = await paymentInvoiceRepository.getNextInvoiceNumber(proposal.user_id);

    const { data, error } = await paymentInvoiceRepository.create({
      user_id: proposal.user_id,
      contact_id: proposal.contact_id,
      invoice_number: numberResult.data || `INV-${Date.now()}`,
      amount,
      currency: proposal.currency,
      /*
       * 'draft', not 'pending'.
       *
       * `payment_invoices_status_check` admits draft | sent | paid | overdue |
       * cancelled | refunded | partially_refunded, and 'pending' is not among
       * them — so EVERY invoice raised on acceptance was rejected by Postgres.
       * The client accepted, a payment plan was written, and no invoice ever
       * existed: nothing to pay, nothing to email, and no payment step in the
       * drawer. `sendInvoice` moves it to 'sent' when the mail goes out.
       */
      status: 'draft',
      line_items: [{ description, quantity: 1, unit_price: amount, amount }],
      due_date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      payment_terms: null,
      notes: null,
      internal_notes: null,
      sent_at: null,
      paid_at: null,
      client_name: contact
        ? [contact.first_name, contact.last_name].filter(Boolean).join(' ') || null
        : null,
      client_email: contact?.email || null,
      service_id: proposal.service_id,
      /*
       * The booking this money belongs to.
       *
       * Left null, the invoice floated free of the job: the refund flow looks
       * a transaction up by `booking_id`, the webhook updates the booking's
       * payment status by it, and the payments section groups by it. A quoted
       * job's deposit was invisible to all three — the money was real and none
       * of the machinery that handles money could see it.
       */
      booking_id: proposal.booking_id,
      /*
       * This cast is why the failure was silent for so long.
       *
       * `as never` tells the compiler to stop checking the payload entirely, so
       * a status the database rejects looked fine at build time and failed only
       * at runtime — inside a try/catch that logged and returned null, which
       * the caller treated as "no invoice was needed".
       */
    } as never);

    if (error) throw error;
    return (data as { id: string }).id;
  } catch (error) {
    logger.error({ err: error, proposalId: proposal.id }, 'Failed to raise the invoice');
    return null;
  }
}
