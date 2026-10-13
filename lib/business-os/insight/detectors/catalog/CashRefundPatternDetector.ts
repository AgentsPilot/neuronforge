/**
 * Cash Refund Pattern Detector
 *
 * Detects high refund rates or frequent refunds that signal service issues.
 *
 * @see docs/INSIGHT_SYSTEM_PLAN.md
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseDetector } from './BaseDetector';
import type { DetectorDefinition, DetectionResult, InsightSeverity } from '../types';

export class CashRefundPatternDetector extends BaseDetector {
  definition: DetectorDefinition = {
    id: 'cash_refund_pattern',
    name: 'Refund Pattern Alert',
    category: 'cash_flow',
    description: 'Detects high refund rate (>5%) or frequent refunds',

    watchedMetrics: ['cashflow.refund_rate'],
    documentsEventTypes: ['refund.completed'],

    baselineWindow: 'month',
    thresholdType: 'absolute',
    threshold: 5, // 5% refund rate or 3+ refunds
    direction: 'above',
    minSamples: 10, // Need at least 10 transactions

    severityFn: (refundRate: number, refundCount: number): InsightSeverity => {
      if (refundRate >= 15 || refundCount >= 8) return 'critical';
      if (refundRate >= 10 || refundCount >= 5) return 'high';
      if (refundRate >= 5 || refundCount >= 3) return 'medium';
      return 'low';
    },

    /*

     * Advisory: nothing can run this yet.

     *

     * It used to name `refund_analysis_report`, a process that was never built — so the card

     * offered "handle it for me", the server answered 404 on the process, and the

     * insight was never marked acted. Whatever fixes this is a different KIND of

     * action from the four that exist, which all send a message.

     *

     * Declaring nothing is honest: the card shows the finding without a button

     * that cannot work.

     */
    eligibleForAutomation: false,
    cooldownHours: 168, // 1 week
  };

  constructor(supabase: SupabaseClient) {
    super(supabase);
  }

  async evaluate(userId: string): Promise<DetectionResult | null> {
    // Check cooldown
    if (await this.isOnCooldown(userId)) {
      this.logDetection(userId, null);
      return null;
    }

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Get all transactions in last 30 days
    const { data: transactions, error } = await this.supabase
      .from('payment_transactions')
      /*
       * `processor_fee` and `fee_currency` are what make a refund COST
       * something rather than net to zero. See the block that reads them.
       */
      .select('id, amount, status, refund_status, refunded_amount, refund_reason, contact_id, created_at, processor_fee, fee_currency')
      .eq('user_id', userId)
      .gte('created_at', thirtyDaysAgo.toISOString());

    if (error) {
      throw error;
    }

    if (!transactions || transactions.length < this.definition.minSamples) {
      this.logDetection(userId, null);
      return null;
    }

    /*
     * ─────────────────────────────────────────────────────────────────────────
     * THE TWO SETS OVERLAP, AND THE DENOMINATOR USED TO ADD THEM ANYWAY.
     *
     * `refund_status` is the authoritative field and `status` is a projection —
     * `invoiceSettlement` documents the same split for invoices, with live data
     * showing INV-00011 carrying `refund_status: 'full'` while its `status`
     * still read `sent`. A refunded transaction therefore stays `succeeded`,
     * so it appeared in BOTH sets and the old denominator
     *
     *     succeeded.length + refunded.length
     *
     * counted it twice. Three refunds out of fifteen payments reported 3/18 =
     * 16.7% instead of 20%.
     *
     * It erred towards silence, which is the quieter direction and the reason
     * nobody noticed: the rate read LOW, so an account genuinely at the 5%
     * threshold had to reach about 5.3% before this fired, and one at 15% was
     * reported as 12.5% — a severity step down from critical to high.
     *
     * The fix is a distinct set, not a different sum: every transaction where
     * money was actually taken, counted once, whether or not it later came
     * back.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const refundedTransactions = transactions.filter((t) =>
      t.refund_status === 'full' || t.refund_status === 'partial'
    );
    const refundedIds = new Set(refundedTransactions.map((t) => t.id));

    /*
     * Money taken: anything that succeeded, plus anything carrying a refund
     * whose `status` projection has not caught up. Deduped by id, which is what
     * makes the overlap harmless rather than double-counted.
     */
    const paidTransactions = transactions.filter(
      (t) => t.status === 'succeeded' || refundedIds.has(t.id)
    );

    if (paidTransactions.length === 0) {
      this.logDetection(userId, null);
      return null;
    }

    const refundCount = refundedTransactions.length;
    const totalTransactions = paidTransactions.length;
    const refundRate = (refundCount / totalTransactions) * 100;

    // Check thresholds
    if (refundRate < this.definition.threshold && refundCount < 3) {
      this.logDetection(userId, null);
      return null;
    }

    // Calculate total refunded amount
    const totalRefunded = refundedTransactions.reduce((sum, t) =>
      sum + parseFloat(t.refunded_amount || t.amount || '0'), 0);

    // Analyze refund reasons
    const reasons = refundedTransactions.reduce((acc, t) => {
      const reason = t.refund_reason || 'No reason provided';
      acc[reason] = (acc[reason] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    /*
     * ─────────────────────────────────────────────────────────────────────────
     * WHAT THE REFUNDS COST, WHICH IS NOT THE AMOUNT REFUNDED.
     *
     * Stripe does not give back the processing fee when a payment is refunded.
     * Return ₪200 and the business is down roughly ₪6.30 with nothing to show
     * for it — and because the sale and the refund cancel exactly on every
     * screen that does not subtract fees, a business with many refunds looks
     * flat while it is genuinely losing money. That is the migration's own
     * description of why the column exists, and it had no reader.
     *
     * This detector already fires on the right condition. What it said was a
     * RATIO — "18.8% refund rate" — which an owner reads as a service-quality
     * signal and can reasonably accept. The unrecoverable money is a different
     * sentence about the same month, and it is the actionable one.
     *
     * GROUPED BY FEE CURRENCY, NEVER SUMMED.
     *
     * Stripe charges the fee in the SETTLEMENT currency, so a business settling
     * in ILS that takes a USD payment has a USD amount and an ILS fee. Adding
     * them would be the kind of wrong that never gets found — the same reason
     * `fee_currency` is stored at all rather than assumed to match.
     *
     * NULL IS NOT ZERO. The column is null for "not fetched yet", so a figure
     * built over partial data understates the loss. The count of unknowns
     * travels with it and the sentence says so, rather than quietly reporting
     * the fees it happens to know about as the total.
     * ─────────────────────────────────────────────────────────────────────────
     */
    const feesByCurrency = new Map<string, number>();
    let feesUnknown = 0;

    for (const t of refundedTransactions) {
      const fee = t.processor_fee;
      if (fee === null || fee === undefined) {
        feesUnknown += 1;
        continue;
      }
      const amount = Number(fee);
      if (!Number.isFinite(amount) || amount <= 0) continue;

      const currency = String(t.fee_currency || '').toUpperCase() || 'UNKNOWN';
      feesByCurrency.set(currency, (feesByCurrency.get(currency) ?? 0) + amount);
    }

    const feesKept = [...feesByCurrency.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([currency, total]) => `${Math.round(total * 100) / 100} ${currency}`);

    // Calculate severity
    const severity = this.definition.severityFn(refundRate, refundCount);

    // Get contact info
    const contactIds = [...new Set(refundedTransactions.map((t) => t.contact_id).filter(Boolean))];
    let contactNames: Record<string, string> = {};

    if (contactIds.length > 0) {
      const { data: contacts } = await this.supabase
        .from('crm_contacts')
        .select('id, first_name, last_name, email')
        // Scoped: `.in('id', …)` alone is a cross-tenant read under the service
        // role. See CashCardsExpiringDetector for the same fix.
        .eq('user_id', userId)
        .in('id', contactIds);

      if (contacts) {
        contactNames = contacts.reduce((acc, c) => {
          acc[c.id] = `${c.first_name || ''} ${c.last_name || ''}`.trim() || c.email;
          return acc;
        }, {} as Record<string, string>);
      }
    }

    const result = this.createDetectionResult({
      severity,
      metricKey: 'cashflow.refund_rate',
      currentValue: Math.round(refundRate * 10) / 10,

      // A refund RATE. The card said "שיעור החזרות גבוה של 25 ₪" —

      // twenty-five per cent, written as twenty-five shekels.

      currentValueUnit: 'percent',

      /*
       * There is no baseline here, so none is claimed.
       *
       * This passed `baselineValue: this.definition.threshold` and a
       * `percentChange` measured against it, which produced the card the owner
       * reported: "שיעור החזר גבוה: 275% על 18.8" -- a 275% refund rate, which
       * is not a possible thing. 275 is the distance from the 5% POLICY
       * THRESHOLD to the measured 18.8%, and the narrator had no way to know
       * that, so it printed it as the rate.
       *
       * `hasRealBaseline` in InsightRepository already omits the change line
       * when the baseline is 0, which is how the sixteen absolute-count
       * detectors stay quiet. A configured constant defeated that guard by
       * being non-zero while measuring nothing. Zero is the honest answer: this
       * detector compares a rate to a policy limit, and a limit is not a
       * previous value.
       *
       * The 18.8% itself was CORRECT -- 3 refunds of 16 transactions in the
       * 30-day window. Only the comparison was invented.
       */
      baselineValue: 0,
      thresholdValue: this.definition.threshold,
      percentChange: 0,
      direction: 'above',
      affectedEntityType: 'transaction',
      affectedEntityIds: refundedTransactions.map((t) => t.id),
      affectedCount: refundCount,
      /*
       * Still the amount refunded, deliberately.
       *
       * The swallowed fee is the unrecoverable half and it is what the sentence
       * below is about — but this figure feeds impact RANKING across every
       * insight, and swapping a four-figure number for a two-figure one would
       * quietly drop refund problems down the dashboard. The fee is reported in
       * words, where it is read, rather than by moving a number other things
       * sort on.
       */
      estimatedImpactUsd: totalRefunded,
      /*
       * The sentence the owner actually reads. `processParameters` cannot
       * carry it — the card components declare that field and none of them
       * render it, which is the trap `narrationSubject` was added to close.
       */
      narrationSubject: feesKept.length
        ? `${refundCount} refunds in the last 30 days. The processing fees on them are not returned: ` +
          `${feesKept.join(', ')} kept by the processor and not recoverable` +
          (feesUnknown > 0 ? `, with ${feesUnknown} more whose fee is not known yet` : '')
        : undefined,
      impactDirection: 'loss',
      impactPeriod: 'monthly',
      processParameters: {
        refund_rate: Math.round(refundRate * 10) / 10,
        refund_count: refundCount,
        total_transactions: totalTransactions,
        total_refunded: Math.round(totalRefunded),
        /* Kept for the ledger and the export, not for the card: see the note
           on `narrationSubject` above for why nothing renders this. */
        refund_fees_kept: Object.fromEntries(feesByCurrency),
        refund_fees_unknown: feesUnknown,
        refund_reasons: reasons,
        refunds: refundedTransactions.slice(0, 10).map((t) => ({
          id: t.id,
          amount: parseFloat(t.refunded_amount || t.amount || '0'),
          reason: t.refund_reason,
          date: t.created_at,
          contact_name: t.contact_id ? contactNames[t.contact_id] : null,
        })),
      },
    });

    this.logDetection(userId, result);
    return result;
  }
}
