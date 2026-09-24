/**
 * Revenue Sitting In The Pipeline
 *
 * One number for money the business has earned or been promised and has not
 * received. Every part of it is already reported somewhere — invoices on the
 * payments page, instalments on the plan, proposals in their own list — which
 * is exactly the problem: an owner has to open three screens and add up, and
 * nobody does that, so the total is never known.
 *
 * Two kinds of money, deliberately counted separately and then together:
 *
 *  - OWED. Work that has been priced and billed: issued invoices, and plan
 *    instalments still to come. The client has agreed; the cash has not moved.
 *  - QUOTED. Proposals sent and not yet answered. Nobody has agreed to this
 *    money yet, so it is softer — but it is the half that disappears silently
 *    if nobody follows up, and it is real enough to chase.
 *
 * It does NOT double-count an accepted proposal that has become an invoice:
 * only undecided proposals are quoted revenue, and once one is accepted its
 * invoice picks it up on the owed side.
 *
 * @see docs/architecture/BUSINESS_OS_INSIGHTS_MODULE.md
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseDetector } from './BaseDetector';
import { ISSUED_INVOICE_STATUSES } from '@/lib/repositories/PaymentRepository';
import type { DetectorDefinition, DetectionResult, InsightSeverity } from '../types';

/** Instalment states that still owe money. */
const INSTALMENT_OUTSTANDING = new Set(['pending', 'scheduled', 'overdue', 'failed']);

/**
 * Proposal states where the client has not answered.
 *
 * `superseded` is excluded: a replaced quote is not a second opportunity, and
 * counting it would inflate the pipeline every time a price was revised.
 */
const PROPOSAL_OPEN = new Set(['sent', 'pending', 'viewed']);

/**
 * How long money must have been sitting before it counts as AT RISK.
 *
 * Nothing is at risk the moment it is raised. This detector had no age filter
 * at all, so an invoice created at 03:10 and paid at 03:56 produced a card
 * reading "$500 needs attention" — money that was never late, for a business
 * that already has `chase_overdue_invoices` to chase late invoices.
 *
 * Seven days matches `cash_ar_overdue`, so the two agree about when money
 * stops being simply outstanding and starts being a problem.
 */
const AT_RISK_AFTER_DAYS = 7;

/**
 * How many separate things must be sitting there.
 *
 * The advisor is for patterns, not for facts already visible on the payments
 * page and already handled by a chaser. One aged invoice is a row in a list;
 * three are a cash-flow shape the owner has not looked at as a total — which is
 * the whole reason this detector exists.
 */
const MIN_ITEMS = 3;

/** Below this the total is not worth a card of its own. */
const MIN_REPORTABLE = 1;

export class CashRevenueAtRiskDetector extends BaseDetector {
  definition: DetectorDefinition = {
    id: 'cash_revenue_at_risk',
    name: 'Revenue In The Pipeline',
    category: 'cash_flow',
    description: 'Totals money that has been billed or quoted and has not arrived',

    watchedMetrics: ['cashflow.ar_total'],
    eventTypes: [],

    baselineWindow: 'month',
    thresholdType: 'absolute',
    threshold: 0,
    direction: 'above',
    minSamples: MIN_ITEMS,

    severityFn: (total: number, owedShare: number): InsightSeverity => {
      /*
       * Severity follows what is OWED rather than the headline total. Quoted
       * money not yet answered is an ordinary state of business; money already
       * billed and not paid is the part that should raise a voice, so a large
       * pipeline made mostly of fresh quotes does not read as a crisis.
       */
      if (owedShare >= 5000) return 'high';
      if (owedShare >= 1000 || total >= 10000) return 'medium';
      return 'low';
    },

    // Chasing what is owed is the action; the existing process does it.
    pairedProcessId: 'chase_overdue_invoices',
    /*
     * Runs even while this category's vector is dark, because money owed is a sum of documents that exist, not a movement against a
     * baseline — the first unpaid invoice is as real as the fiftieth.
     */
    ignoresVectorMaturity: true,

    consentTier: 'automate',
    eligibleForAutomation: false,
    ownerParameters: [],
    guardrails: [],
    cooldownHours: 72,
  };

  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  async evaluate(userId: string): Promise<DetectionResult | null> {
    if (await this.isOnCooldown(userId)) {
      this.logDetection(userId, null);
      return null;
    }

    const agedBefore = new Date(Date.now() - AT_RISK_AFTER_DAYS * 86_400_000).toISOString();

    const [invoicesResult, instalmentsResult, proposalsResult] = await Promise.all([
      this.supabase
        .from('payment_invoices')
        .select('id, amount, refunded_amount, currency, contact_id')
        .eq('user_id', userId)
        .in('status', [...ISSUED_INVOICE_STATUSES])
        // Raised long enough ago to be a concern rather than a recent bill.
        .lt('created_at', agedBefore),

      this.supabase
        .from('payment_plan_installments')
        .select('id, amount, currency, status, contact_id')
        .eq('user_id', userId)
        .lt('created_at', agedBefore),

      this.supabase
        .from('proposals')
        .select('id, total, currency, status, contact_id')
        .eq('user_id', userId)
        .lt('created_at', agedBefore),
    ]);

    /*
     * A failed read here would understate the total, and an understated total
     * is worse than none: the owner would be told a smaller, confident-looking
     * figure and act on it. Nothing is reported unless every source answered.
     */
    for (const [source, error] of [
      ['payment_invoices', invoicesResult.error],
      ['payment_plan_installments', instalmentsResult.error],
      ['proposals', proposalsResult.error],
    ] as const) {
      if (error) throw new Error(`revenue_at_risk: ${source} unreadable — ${error.message}`);
    }

    const contacts = new Set<string>();
    const entityIds: string[] = [];
    /*
     * The invoices alone, kept apart from the rest.
     *
     * `entityIds` is a mixed bag — invoice ids, instalment ids and proposal ids
     * in one array — and the detection reported it as `affectedEntityType:
     * 'contact'`, which was none of the three. The chaser paired with this
     * detector acts on invoices, so it refused every run with a 400 the owner
     * saw as a button that did nothing.
     *
     * The finding is still about all three (that is the point of this
     * detector: everything billed or quoted and not arrived). Only the ACTION
     * is narrower, so only the invoices travel as the entity ids.
     */
    const invoiceIds: string[] = [];

    let invoiceOwed = 0;
    for (const row of invoicesResult.data ?? []) {
      const outstanding = toNumber(row.amount) - toNumber(row.refunded_amount);
      if (outstanding <= 0) continue;
      invoiceOwed += outstanding;
      entityIds.push(String(row.id));
      invoiceIds.push(String(row.id));
      if (row.contact_id) contacts.add(String(row.contact_id));
    }

    let instalmentOwed = 0;
    for (const row of instalmentsResult.data ?? []) {
      if (!INSTALMENT_OUTSTANDING.has(String(row.status ?? '').toLowerCase())) continue;
      const amount = toNumber(row.amount);
      if (amount <= 0) continue;
      instalmentOwed += amount;
      entityIds.push(String(row.id));
      if (row.contact_id) contacts.add(String(row.contact_id));
    }

    let quoted = 0;
    let openProposals = 0;
    for (const row of proposalsResult.data ?? []) {
      if (!PROPOSAL_OPEN.has(String(row.status ?? '').toLowerCase())) continue;
      const amount = toNumber(row.total);
      if (amount <= 0) continue;
      quoted += amount;
      openProposals += 1;
      entityIds.push(String(row.id));
      if (row.contact_id) contacts.add(String(row.contact_id));
    }

    const owed = invoiceOwed + instalmentOwed;
    const total = owed + quoted;

    /*
     * A pattern, or nothing.
     *
     * One aged invoice is already on the payments page and already being chased;
     * saying it again here is noise dressed as insight. Three or more is a shape
     * the owner has not seen totalled, which is what this card is for.
     */
    if (total < MIN_REPORTABLE || contacts.size === 0 || entityIds.length < MIN_ITEMS) {
      this.logDetection(userId, null);
      return null;
    }

    const currency =
      (invoicesResult.data ?? [])[0]?.currency ??
      (instalmentsResult.data ?? [])[0]?.currency ??
      (proposalsResult.data ?? [])[0]?.currency ??
      undefined;

    const severity = this.definition.severityFn(total, owed);

    const result = this.createDetectionResult({
      severity,
      metricKey: 'cashflow.ar_total',
      currentValue: Math.round(total * 100) / 100,
      baselineValue: 0,
      thresholdValue: MIN_REPORTABLE,
      /*
       * Nothing changed by a hundred per cent.
       *
       * This detector counts: there is no baseline to have moved from, and a
       * hardcoded 100 reached the narrator as a real measurement. It produced
       * sentences like "a 100% increase in risk compared to your usual client
       * retention" and "a 100% increase in your expected cash flow" — arithmetic
       * presented as a trend, about a base of zero.
       *
       * `hasRealBaseline` now keeps the figure out of the prompt, but that guard
       * reads `baselineValue`, so it is the second line of defence. This is the
       * first: a count reports no change, because none was measured.
       */
      percentChange: 0,
      direction: 'above',
      /*
       * What the chase can actually act on. The card still counts everything
       * outstanding; `process_parameters.entity_ids` below carries the full
       * mixed list for the narrative.
       */
      /*
       * No invoices this run, no button this run.
       *
       * What is outstanding can be entirely instalments and proposals, and the
       * invoice chase can touch neither — so offering it would render a control
       * that enqueues nothing. The FINDING still stands and is still worth
       * showing; only the action is withheld.
       */
      pairedProcessId: invoiceIds.length > 0 ? this.definition.pairedProcessId : undefined,
      affectedEntityType: 'invoice',
      affectedEntityIds: invoiceIds,
      // The number the owner acts on is how many PEOPLE to chase, not how many
      // documents exist — one client with three unpaid instalments is one call.
      affectedCount: contacts.size,
      estimatedImpactUsd: Math.round(total * 100) / 100,
      impactDirection: 'opportunity',
      impactPeriod: 'monthly',
      processParameters: {
        currency,
        // Everything outstanding, of all three kinds. `affectedEntityIds` above
        // is the invoices alone, because that is all the chase can act on.
        entity_ids: entityIds,
        chaseable_invoices: invoiceIds.length,
        owed_total: Math.round(owed * 100) / 100,
        quoted_total: Math.round(quoted * 100) / 100,
        invoice_owed: Math.round(invoiceOwed * 100) / 100,
        instalment_owed: Math.round(instalmentOwed * 100) / 100,
        open_proposals: openProposals,
        people_to_chase: contacts.size,
      },
    });

    this.logDetection(userId, result);
    return result;
  }
}

function toNumber(value: number | string | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}
