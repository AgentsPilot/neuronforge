/**
 * One Client Carries Too Much Of The Income
 *
 * Over six months, the share of everything received that came from a single
 * client. When that share is large, losing one relationship is not a bad month,
 * it is most of the business.
 *
 * This is the only detector here that reports something which is not going
 * wrong. Nothing is late, nothing is unbilled, nobody has gone quiet. It is
 * exposure: a fact about the shape of the income that an owner deep in the work
 * rarely stops to total up, and which is only cheap to fix while the money is
 * still coming in.
 *
 * THE FLOOR IS ON CLIENTS, NOT MONEY, and that is the whole design. With three
 * paying clients somebody is always over a third, and with two somebody is
 * always over half — so a share-based threshold alone would fire on every new
 * business permanently, for a situation none of them can do anything about. A
 * concentration finding only means something once there are enough clients that
 * the spread could have been otherwise.
 *
 * Advisory. There is no automation for "win more clients", and attaching one
 * would hand the owner a button that cannot help — the mistake that made the
 * package-ending detector worthless.
 *
 * @see docs/architecture/BUSINESS_OS_INSIGHTS_MODULE.md
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseDetector } from './BaseDetector';
import type { DetectorDefinition, DetectionResult, InsightSeverity } from '../types';

/** Long enough that one large job does not define the picture. */
const WINDOW_DAYS = 180;

/**
 * Paying clients needed before a share is worth reporting.
 *
 * Five. Below that the arithmetic guarantees a finding: with four clients
 * someone is over 25% by definition, and telling a business with four clients
 * that it depends on one of them is not news, it is a description of having
 * four clients.
 */
const MIN_CLIENTS = 5;

/** The share at which one client stops being a client and becomes a risk. */
const SHARE_THRESHOLD_PERCENT = 40;

interface SettledRow {
  id: string;
  contact_id: string | null;
  amount: number | string | null;
  refunded_amount: number | string | null;
  currency: string | null;
  invoice_id?: string | null;
}

export class CashClientConcentrationDetector extends BaseDetector {
  definition: DetectorDefinition = {
    id: 'cash_client_concentration',
    name: 'One Client Carries Too Much Of The Income',
    category: 'cash_flow',
    description: 'Finds a single client accounting for an outsized share of money received',

    watchedMetrics: ['cashflow.client_concentration'],
    eventTypes: [],

    baselineWindow: 'month',
    thresholdType: 'absolute',
    threshold: SHARE_THRESHOLD_PERCENT,
    direction: 'above',
    minSamples: MIN_CLIENTS,

    severityFn: (sharePercent: number, value: number): InsightSeverity => {
      // Share outranks value. £2,000 from one of six clients is a different
      // situation from £20,000 that happens to be 15% of a larger business.
      if (sharePercent >= 70) return 'high';
      if (sharePercent >= 55 || value >= 10_000) return 'medium';
      return 'low';
    },

    pairedProcessId: undefined,

    /*
     * Respects vector maturity. Like the income comparison and unlike the
     * unbilled-session finding, this is a statement about a PATTERN across
     * months, and a pattern needs enough history to be one.
     */
    ignoresVectorMaturity: false,

    consentTier: 'suggest',
    eligibleForAutomation: false,
    ownerParameters: [],
    guardrails: [],
    cooldownHours: 720,
  };

  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  async evaluate(userId: string): Promise<DetectionResult | null> {
    if (await this.isOnCooldown(userId)) {
      this.logDetection(userId, null);
      return null;
    }

    const from = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString();

    const [txResult, invResult] = await Promise.all([
      this.supabase
        .from('payment_transactions')
        .select('id, contact_id, amount, refunded_amount, currency, invoice_id')
        .eq('user_id', userId)
        .in('status', ['succeeded', 'refunded'])
        .gte('created_at', from),
      this.supabase
        .from('payment_invoices')
        .select('id, contact_id, amount, refunded_amount, currency')
        .eq('user_id', userId)
        .in('status', ['paid', 'refunded', 'partially_refunded'])
        .gte('paid_at', from),
    ]);

    if (txResult.error) throw txResult.error;
    if (invResult.error) throw invResult.error;

    const transactions = (txResult.data ?? []) as unknown as SettledRow[];
    const invoices = (invResult.data ?? []) as unknown as SettledRow[];

    // Same money in two tables, counted once — see CashIncomeDropDetector.
    const settledByTransaction = new Set(
      transactions.map(t => (t.invoice_id ? String(t.invoice_id) : '')).filter(Boolean)
    );
    const counted = [
      ...transactions,
      ...invoices.filter(i => !settledByTransaction.has(String(i.id))),
    ];

    const byClient = new Map<string, number>();
    let total = 0;
    let currency: string | undefined;

    for (const row of counted) {
      const net = toNumber(row.amount) - toNumber(row.refunded_amount);
      if (net <= 0) continue;
      // Money with no client attached cannot be attributed, and adding it to
      // the denominator alone would understate every real client's share.
      if (!row.contact_id) continue;

      const key = String(row.contact_id);
      byClient.set(key, (byClient.get(key) ?? 0) + net);
      total += net;
      currency = currency ?? row.currency ?? undefined;
    }

    if (byClient.size < MIN_CLIENTS || total <= 0) {
      this.logDetection(userId, null);
      return null;
    }

    const [topId, topValue] = [...byClient.entries()].sort((a, b) => b[1] - a[1])[0];
    const sharePercent = Math.round((topValue / total) * 100);

    if (sharePercent < SHARE_THRESHOLD_PERCENT) {
      this.logDetection(userId, null);
      return null;
    }

    const severity = this.definition.severityFn(sharePercent, topValue);

    const result = this.createDetectionResult({
      severity,
      metricKey: 'cashflow.client_concentration',
      currentValue: sharePercent,
      baselineValue: Math.round((100 / byClient.size) * 10) / 10,
      thresholdValue: SHARE_THRESHOLD_PERCENT,
      percentChange: sharePercent,
      direction: 'above',
      affectedEntityType: 'contact',
      affectedEntityIds: [topId],
      affectedCount: 1,
      /*
       * What is exposed, not what is lost.
       *
       * `impactDirection` is left unset on purpose. Its three values are
       * 'loss', 'opportunity' and 'savings', and none of them describes
       * exposure: this money was received, so calling it a loss would tell an
       * owner they are down an amount they have in fact been paid. An absent
       * label is honest where every available label is wrong.
       */
      estimatedImpactUsd: Math.round(topValue * 100) / 100,
      impactPeriod: 'monthly',
      processParameters: {
        share_percent: sharePercent,
        client_count: byClient.size,
        window_days: WINDOW_DAYS,
        top_client_value: Math.round(topValue * 100) / 100,
        total_received: Math.round(total * 100) / 100,
        currency,
        contact_id: topId,
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
