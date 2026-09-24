/**
 * Discounting More Than It Looks
 *
 * A large share of what the business takes is being charged below list price.
 * Individually each one is a favour; together they are the real price list, and
 * the owner is usually the last to see that.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS SILENT TODAY, AND WHAT WOULD LIGHT IT
 *
 * There is no discount feature. No `discounts` or `coupons` table exists, and
 * `payment_transactions.metadata` carries only Stripe session ids and
 * manual-payment notes — nothing writes a discount anywhere, so nothing can
 * read one.
 *
 * The denominator half is real and correct: bookings and transactions over
 * thirty days are counted from columns that exist. Only the numerator has no
 * source.
 *
 * It is kept rather than deleted because the capability is wanted and only the
 * feature behind it is missing. TO LIGHT IT: record what was actually charged
 * against what was listed — either a discount amount on the transaction, or the
 * list price alongside the charged price — and compare them here.
 *
 * Until then it reports nothing, which is the correct answer to "how much are
 * you discounting" when nothing records a discount.
 *
 * One earlier fault is already fixed and worth not reintroducing: this read
 * `scheduling_bookings.metadata`, a column that does not exist, so PostgREST
 * rejected the whole select, `bookings` came back null, and bookings silently
 * vanished from the DENOMINATOR — inflating the discount rate for every
 * business that takes bookings.
 * ---------------------------------------------------------------------------
 *
 * @see docs/architecture/BUSINESS_OS_INSIGHTS_MODULE.md
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseDetector } from './BaseDetector';
import { createLogger } from '@/lib/logger';
import type { DetectorDefinition, DetectionResult, InsightSeverity } from '../types';

const logger = createLogger({ module: 'PricingDiscountAbuseDetector' });

export class PricingDiscountAbuseDetector extends BaseDetector {
  definition: DetectorDefinition = {
    id: 'pricing_discount_abuse',
    name: 'Excessive Discounts',
    category: 'pricing',
    description: 'Detects too many discounts eroding margins',

    watchedMetrics: ['pricing.discount_rate'],
    eventTypes: ['discount.applied', 'payment.completed'],

    baselineWindow: 'month',
    thresholdType: 'absolute',
    threshold: 20, // >20% of transactions discounted OR >$500 total
    direction: 'above',
    minSamples: 10, // Need at least 10 transactions

    severityFn: (discountRate: number, totalDiscounted: number): InsightSeverity => {
      if (discountRate >= 40 || totalDiscounted >= 2000) return 'critical';
      if (discountRate >= 30 || totalDiscounted >= 1000) return 'high';
      if (discountRate >= 20 || totalDiscounted >= 500) return 'medium';
      return 'low';
    },

    pairedProcessId: undefined, // Advisory only
    consentTier: 'observe',
    eligibleForAutomation: false,
    ownerParameters: [],
    guardrails: [],
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

    // Get all transactions from last 30 days
    // Note: discount info is stored in metadata since there's no discount_amount column
    const { data: transactions, error } = await this.supabase
      .from('payment_transactions')
      .select('id, amount, metadata, contact_id, created_at')
      .eq('user_id', userId)
      .eq('status', 'succeeded')
      .gte('created_at', thirtyDaysAgo.toISOString());

    if (error) {
      throw error;
    }

    if (!transactions || transactions.length < this.definition.minSamples) {
      this.logDetection(userId, null);
      return null;
    }

    // Calculate discount metrics from metadata
    let discountedTransactions = 0;
    let totalDiscountAmount = 0;
    let totalTransactionAmount = 0;
    const discountBreakdown: Record<string, { count: number; amount: number }> = {};

    transactions.forEach((t) => {
      const amount = parseFloat(t.amount || '0');
      totalTransactionAmount += amount;

      // Check for discount info in metadata
      const metadata = t.metadata as Record<string, unknown> | null;
      const discountAmount = parseFloat((metadata?.discount_amount as string) || '0');

      if (discountAmount > 0) {
        discountedTransactions++;
        totalDiscountAmount += discountAmount;

        const discountType = (metadata?.discount_type as string) || (metadata?.discount_code as string) || 'standard';

        if (!discountBreakdown[discountType]) {
          discountBreakdown[discountType] = { count: 0, amount: 0 };
        }
        discountBreakdown[discountType].count++;
        discountBreakdown[discountType].amount += discountAmount;
      }
    });

    /*
     * Bookings count toward the denominator, and cannot carry a discount.
     *
     * This pass used to read `scheduling_bookings.metadata` for discount fields.
     * That column does not exist, so PostgREST rejected the select whole, the
     * error went into an ignored destructure, and `bookings` was always null —
     * which silently removed bookings from `totalTransactions` as well, inflating
     * the discount RATE for every business that takes bookings. Counting them is
     * the half that was always meant to work; discounts on bookings are simply
     * not recorded anywhere in this schema, so nothing is read for them.
     */
    const { data: bookings, error: bookingsError } = await this.supabase
      .from('scheduling_bookings')
      .select('id, payment_amount')
      .eq('user_id', userId)
      .gte('created_at', thirtyDaysAgo.toISOString())
      .in('status', ['confirmed', 'completed']);

    if (bookingsError) {
      logger.warn(
        { err: bookingsError, userId },
        'Could not read bookings; discount rate is computed over transactions alone'
      );
    }

    const totalTransactions = transactions.length + (bookings?.length || 0);
    const discountRate = (discountedTransactions / totalTransactions) * 100;

    // Check thresholds
    if (discountRate < this.definition.threshold && totalDiscountAmount < 500) {
      this.logDetection(userId, null);
      return null;
    }

    // Calculate severity
    const severity = this.definition.severityFn(discountRate, totalDiscountAmount);

    // Calculate margin impact
    const grossRevenue = totalTransactionAmount + totalDiscountAmount; // What could have been
    const marginImpact = totalDiscountAmount / grossRevenue * 100;

    // Top discount codes/types
    const topDiscounts = Object.entries(discountBreakdown)
      .map(([type, data]) => ({
        type,
        count: data.count,
        amount: Math.round(data.amount),
      }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5);

    const result = this.createDetectionResult({
      severity,
      metricKey: 'pricing.discount_rate',
      currentValue: Math.round(discountRate),
      baselineValue: this.definition.threshold,
      thresholdValue: this.definition.threshold,
      percentChange: Math.round(((discountRate - this.definition.threshold) / this.definition.threshold) * 100),
      direction: 'above',
      affectedEntityType: 'transaction',
      affectedEntityIds: transactions
        .filter((t) => {
          const metadata = t.metadata as Record<string, unknown> | null;
          return parseFloat((metadata?.discount_amount as string) || '0') > 0;
        })
        .map((t) => t.id),
      affectedCount: discountedTransactions,
      estimatedImpactUsd: Math.round(totalDiscountAmount),
      impactDirection: 'loss',
      impactPeriod: 'monthly',
      processParameters: {
        total_transactions: totalTransactions,
        discounted_transactions: discountedTransactions,
        discount_rate: Math.round(discountRate * 10) / 10,
        total_discounted: Math.round(totalDiscountAmount),
        gross_revenue: Math.round(grossRevenue),
        net_revenue: Math.round(totalTransactionAmount),
        margin_impact_percent: Math.round(marginImpact * 10) / 10,
        top_discount_types: topDiscounts,
      },
    });

    this.logDetection(userId, result);
    return result;
  }
}
