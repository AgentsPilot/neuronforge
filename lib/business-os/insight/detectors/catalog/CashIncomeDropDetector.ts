/**
 * Income Down On The Previous Period
 *
 * What actually arrived in the last four weeks, against what arrived in the
 * four before it. Not what was billed, not what is owed: money in the account.
 *
 * Nothing else on the dashboard watches this. `cash_revenue_at_risk` totals what
 * has NOT arrived, `cash_ar_overdue` finds debts past their date, and both can
 * be perfectly quiet while takings halve. A business can have no overdue
 * invoices at all and still be earning half what it did, because the work
 * stopped rather than the paying.
 *
 * TWO THINGS MAKE THIS HARD, and both have bitten this codebase already:
 *
 *  1. DOUBLE COUNTING. A card payment and the invoice it settles are the same
 *     money in two tables. Summing both reports £500 as £1,000, which would
 *     turn a flat month into a boom and a real fall into a modest one. An
 *     invoice already referenced by a transaction is dropped, the same rule
 *     `BriefingFactsService.takingsFor` applies to the same pair.
 *
 *  2. TOO LITTLE HISTORY. Every business has a first month with no month before
 *     it, and comparing anything to zero yields a 100% change that means
 *     nothing. The floor here is on PAYMENTS in the baseline window rather than
 *     on days: a business trading for a year but taking three payments a
 *     quarter has no meaningful four-week comparison either.
 *
 * Advisory only. A fall in income is not something an email can fix, and
 * attaching an automation to it would offer the owner a button that cannot help.
 *
 * @see docs/architecture/BUSINESS_OS_INSIGHTS_MODULE.md
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseDetector } from './BaseDetector';
import type { DetectorDefinition, DetectionResult, InsightSeverity } from '../types';

/** The window, and the one it is compared against. */
const WINDOW_DAYS = 28;

/**
 * Payments needed in the BASELINE window before a comparison means anything.
 *
 * Five, deliberately. With two payments a single late invoice looks like a
 * collapse, and a detector that cries collapse at every quiet fortnight gets
 * ignored for the month that matters.
 */
const MIN_BASELINE_PAYMENTS = 5;

/** How far income must fall before it is worth saying. */
const DROP_THRESHOLD_PERCENT = 25;

interface SettledRow {
  id: string;
  amount: number | string | null;
  refunded_amount: number | string | null;
  currency: string | null;
  invoice_id?: string | null;
}

interface Period {
  total: number;
  count: number;
  currency?: string;
}

export class CashIncomeDropDetector extends BaseDetector {
  definition: DetectorDefinition = {
    id: 'cash_income_drop',
    name: 'Income Down On The Previous Period',
    category: 'cash_flow',
    description: 'Finds money received over four weeks falling well below the four weeks before',

    watchedMetrics: ['cashflow.income_received'],
    eventTypes: [],

    baselineWindow: 'month',
    thresholdType: 'percent_change',
    threshold: DROP_THRESHOLD_PERCENT,
    direction: 'below',
    minSamples: MIN_BASELINE_PAYMENTS,

    severityFn: (dropPercent: number, lostValue: number): InsightSeverity => {
      if (dropPercent >= 60 || lostValue >= 5000) return 'critical';
      if (dropPercent >= 40 || lostValue >= 1500) return 'high';
      return 'medium';
    },

    /*
     * No automation. An email cannot reverse a fall in income, and the honest
     * response is for the owner to look at why, not for the platform to send
     * something.
     */
    pairedProcessId: undefined,

    /*
     * Respects vector maturity, unlike the unbilled-work detector.
     *
     * That one reports a complete fact about one named session. This one is a
     * comparison of two periods, and a comparison needs history to be worth
     * anything — which is exactly what the maturity gate exists to establish.
     */
    ignoresVectorMaturity: false,

    consentTier: 'suggest',
    eligibleForAutomation: false,
    ownerParameters: [],
    guardrails: [],
    cooldownHours: 168,
  };

  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  async evaluate(userId: string): Promise<DetectionResult | null> {
    if (await this.isOnCooldown(userId)) {
      this.logDetection(userId, null);
      return null;
    }

    const now = Date.now();
    const recentFrom = new Date(now - WINDOW_DAYS * 86_400_000).toISOString();
    const baselineFrom = new Date(now - 2 * WINDOW_DAYS * 86_400_000).toISOString();

    const [recent, baseline] = await Promise.all([
      this.takings(userId, recentFrom, new Date(now).toISOString()),
      this.takings(userId, baselineFrom, recentFrom),
    ]);

    // Not enough trading in the period being compared against.
    if (baseline.count < MIN_BASELINE_PAYMENTS || baseline.total <= 0) {
      this.logDetection(userId, null);
      return null;
    }

    const dropPercent = Math.round(((baseline.total - recent.total) / baseline.total) * 100);
    if (dropPercent < DROP_THRESHOLD_PERCENT) {
      this.logDetection(userId, null);
      return null;
    }

    const lostValue = Math.round((baseline.total - recent.total) * 100) / 100;
    const severity = this.definition.severityFn(dropPercent, lostValue);

    const result = this.createDetectionResult({
      severity,
      metricKey: 'cashflow.income_received',
      currentValue: Math.round(recent.total * 100) / 100,
      baselineValue: Math.round(baseline.total * 100) / 100,
      thresholdValue: DROP_THRESHOLD_PERCENT,
      percentChange: -dropPercent,
      direction: 'below',
      affectedEntityType: 'payment',
      affectedEntityIds: [],
      affectedCount: recent.count,
      /*
       * The shortfall, not the takings.
       *
       * Impact is what the change is worth, and reporting the whole period's
       * income here would put money the business DID earn under a heading that
       * reads as loss everywhere else on the dashboard.
       */
      estimatedImpactUsd: lostValue,
      impactDirection: 'loss',
      impactPeriod: 'monthly',
      processParameters: {
        window_days: WINDOW_DAYS,
        drop_percent: dropPercent,
        received_recent: Math.round(recent.total * 100) / 100,
        received_baseline: Math.round(baseline.total * 100) / 100,
        payments_recent: recent.count,
        payments_baseline: baseline.count,
        currency: recent.currency ?? baseline.currency,
      },
    });

    this.logDetection(userId, result);
    return result;
  }

  /**
   * Money that actually arrived between two instants, counted once.
   *
   * Invoices are dated by `paid_at` and transactions by `created_at`, matching
   * what the daily briefing does with the same two tables — the columns each
   * one reliably carries.
   */
  private async takings(userId: string, from: string, to: string): Promise<Period> {
    const [txResult, invResult] = await Promise.all([
      this.supabase
        .from('payment_transactions')
        .select('id, amount, refunded_amount, currency, invoice_id')
        .eq('user_id', userId)
        .in('status', ['succeeded', 'refunded'])
        .gte('created_at', from)
        .lt('created_at', to),
      this.supabase
        .from('payment_invoices')
        .select('id, amount, refunded_amount, currency')
        .eq('user_id', userId)
        .in('status', ['paid', 'refunded', 'partially_refunded'])
        .gte('paid_at', from)
        .lt('paid_at', to),
    ]);

    if (txResult.error) throw txResult.error;
    if (invResult.error) throw invResult.error;

    const transactions = (txResult.data ?? []) as unknown as SettledRow[];
    const invoices = (invResult.data ?? []) as unknown as SettledRow[];

    // An invoice already settled by one of these transactions is the same money.
    const settledByTransaction = new Set(
      transactions.map(t => (t.invoice_id ? String(t.invoice_id) : '')).filter(Boolean)
    );

    const counted = [
      ...transactions,
      ...invoices.filter(i => !settledByTransaction.has(String(i.id))),
    ];

    let total = 0;
    let count = 0;
    for (const row of counted) {
      // Net of refunds: money that came and went was never income.
      const net = toNumber(row.amount) - toNumber(row.refunded_amount);
      if (net <= 0) continue;
      total += net;
      count += 1;
    }

    return { total, count, currency: counted.find(r => r.currency)?.currency ?? undefined };
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
