/**
 * Base Detector
 *
 * Abstract base class for all detectors with common functionality.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';
import { BaselineCalculator } from '../../metrics/BaselineCalculator';
import type { Detector, DetectorDefinition, DetectionResult, InsightSeverity } from '../types';
import type { MetricKey } from '../../metrics/types';

const logger = createLogger({ module: 'BaseDetector' });

/**
 * Abstract base class for detectors
 */
export abstract class BaseDetector implements Detector {
  protected supabase: SupabaseClient;
  protected baselineCalculator: BaselineCalculator;
  abstract definition: DetectorDefinition;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
    this.baselineCalculator = new BaselineCalculator(supabase);
  }

  /**
   * Main evaluation method - must be implemented by subclasses
   */
  abstract evaluate(userId: string): Promise<DetectionResult | null>;

  /**
   * Check if detector is on cooldown for this user
   */
  protected async isOnCooldown(userId: string): Promise<boolean> {
    const cooldownHours = this.definition.cooldownHours;

    const { data } = await this.supabase
      .from('insights')
      .select('last_surfaced_at')
      .eq('user_id', userId)
      .eq('detector_id', this.definition.id)
      .order('last_surfaced_at', { ascending: false })
      .limit(1)
      .single();

    if (!data?.last_surfaced_at) {
      return false;
    }

    const lastSurfaced = new Date(data.last_surfaced_at);
    const cooldownEnd = new Date(lastSurfaced.getTime() + cooldownHours * 60 * 60 * 1000);

    return new Date() < cooldownEnd;
  }

  /**
   * Get the latest metric value for a user
   */
  protected async getLatestMetricValue(
    userId: string,
    metricKey: MetricKey
  ): Promise<{ value: number; periodStart: Date; periodEnd: Date } | null> {
    const { data } = await this.supabase
      .from('derived_metrics')
      .select('value, period_start, period_end')
      .eq('user_id', userId)
      .eq('metric_key', metricKey)
      .order('period_end', { ascending: false })
      .limit(1)
      .single();

    if (!data) {
      return null;
    }

    return {
      value: parseFloat(data.value),
      periodStart: new Date(data.period_start),
      periodEnd: new Date(data.period_end),
    };
  }

  /**
   * Calculate baseline lookback days from window
   */
  protected getBaselineLookbackDays(): number {
    switch (this.definition.baselineWindow) {
      case 'week':
        return 7;
      case 'month':
        return 30;
      case '90days':
        return 90;
      default:
        return 30;
    }
  }

  /**
   * Calculate severity from percent change
   */
  protected calculateSeverityFromPercentChange(percentChange: number): InsightSeverity {
    const absChange = Math.abs(percentChange);

    if (absChange >= 100) return 'critical';
    if (absChange >= 50) return 'high';
    if (absChange >= 25) return 'medium';
    return 'low';
  }

  /**
   * Calculate severity from absolute value thresholds
   */
  protected calculateSeverityFromAbsolute(
    value: number,
    thresholds: { low: number; medium: number; high: number; critical: number }
  ): InsightSeverity {
    if (value >= thresholds.critical) return 'critical';
    if (value >= thresholds.high) return 'high';
    if (value >= thresholds.medium) return 'medium';
    return 'low';
  }

  /**
   * Create a detection result with common fields.
   *
   * `pairedProcessId` may be overridden per run, and the override is how a
   * detector says "not this time". The card renders "Handle it for me" from
   * this field, and an action with nothing to act on is a button that appears
   * to work and quietly does nothing — `cash_revenue_at_risk` can be entirely
   * made of instalments and proposals, neither of which the invoice chase can
   * touch. A detector in that position passes `pairedProcessId: undefined` and
   * no button is offered.
   *
   * Everything else stays derived from the definition, so opting out has to be
   * deliberate rather than accidental.
   */
  protected createDetectionResult(
    params: Omit<DetectionResult, 'detectorId' | 'detectedAt' | 'category' | 'eligibleForAutomation'>
      & {
        pairedProcessId?: string;
        /**
         * How many things this finding was computed from.
         *
         * Optional, and checked against `minSamples` when given. Supply it from
         * any detector whose claim is a RATE or a TREND — those are the ones
         * that stop being true on a small denominator. A detector counting
         * specific things ("three invoices are overdue") has nothing to declare:
         * one overdue invoice is one overdue invoice at any sample size.
         */
        sampleSize?: number;
      }
  ): DetectionResult | null {
    const { sampleSize, ...rest } = params;

    /*
     * `minSamples` finally does something.
     *
     * It is declared by all 40 detectors and was read by none — `BaseDetector`
     * never looked at it and neither did the engine. `ops_utilization_low`
     * declared `minSamples: 28 // 4 weeks of data` and fired on one booking for
     * months. A field that looks like a guard and is not is worse than no field,
     * because everyone who reads it believes it is enforced.
     */
    if (typeof sampleSize === 'number' && sampleSize < this.definition.minSamples) {
      logger.debug(
        { detectorId: this.definition.id, sampleSize, minSamples: this.definition.minSamples },
        'Detection withheld: below its own minimum sample size'
      );
      return null;
    }

    return {
      detectorId: this.definition.id,
      detectedAt: new Date(),
      category: this.definition.category,
      pairedProcessId: this.definition.pairedProcessId,
      eligibleForAutomation: this.definition.eligibleForAutomation,
      ...rest,
      ...this.honest(rest),
    };
  }

  /**
   * Correct the two claims that have been wrong most often, rather than trust
   * each detector to get them right.
   *
   * Corrected rather than thrown: this runs inside a cron loop over every
   * business, and a throw would cost one business its whole detection run over
   * a cosmetic figure. Logged at error so the detector gets fixed, degraded to
   * silence so the owner is never told something invented.
   */
  private honest(
    params: Omit<DetectionResult, 'detectorId' | 'detectedAt' | 'category' | 'eligibleForAutomation'>
  ): Partial<DetectionResult> {
    const corrections: Partial<DetectionResult> = {};

    /*
     * A change needs something to have changed FROM.
     *
     * Sixteen detectors wrote `percentChange: 100` against `baselineValue: 0`,
     * and the narrator turned it into "a 100% increase in risk compared to your
     * usual client retention" — a trend measured from nothing.
     */
    if (params.percentChange !== 0 && !params.baselineValue) {
      logger.error(
        { detectorId: this.definition.id, percentChange: params.percentChange },
        'Detector reported a percentage change with no baseline; dropping the figure'
      );
      corrections.percentChange = 0;
    }

    /*
     * Money has to be a number somebody could check.
     *
     * NaN and Infinity both arrive from a division by an empty set, and both
     * render as text beside a currency symbol.
     */
    const money = params.estimatedImpactUsd;
    if (money !== undefined && money !== null && (!Number.isFinite(money) || money <= 0)) {
      logger.error(
        { detectorId: this.definition.id, estimatedImpactUsd: money },
        'Detector reported an impossible money figure; dropping it'
      );
      corrections.estimatedImpactUsd = undefined;
    }

    return corrections;
  }

  /**
   * What this business typically earns per converted client.
   *
   * Real collected revenue first, then the average price of the services on
   * offer. NULL when neither exists — and null means the detector must report
   * no money at all, not a number someone picked.
   *
   * Lives here because five detectors each hardcoded `const avgDealValue = 300`
   * and multiplied it by a count to produce a figure shown to the owner as
   * their own money. £300 is wrong for a £40 barber and wrong for a £6,000
   * programme, and being wrong identically in five places made it look
   * deliberate. There is no generic fallback: a business we know nothing about
   * is one we should say nothing about, because "worth approximately £1,200" is
   * read as a measurement and there is no honest default for it.
   */
  protected async resolveAverageDealValue(userId: string): Promise<number | null> {
    try {
      const { data: transactions } = await this.supabase
        .from('payment_transactions')
        .select('amount')
        .eq('user_id', userId)
        .eq('status', 'succeeded')
        .limit(200);

      const amounts = (transactions || [])
        .map((t: { amount: number | string | null }) => Number(t.amount) || 0)
        .filter((n: number) => n > 0);

      // Three is enough to average and few enough that a new business qualifies.
      if (amounts.length >= 3) {
        return amounts.reduce((sum: number, n: number) => sum + n, 0) / amounts.length;
      }

      // Too little history to average — use what the business charges instead.
      const { data: services } = await this.supabase
        .from('scheduling_services')
        .select('price')
        .eq('user_id', userId)
        .eq('is_active', true);

      const prices = (services || [])
        .map((s: { price: number | string | null }) => Number(s.price) || 0)
        .filter((n: number) => n > 0);

      if (prices.length > 0) {
        return prices.reduce((sum: number, n: number) => sum + n, 0) / prices.length;
      }
    } catch (error) {
      logger.warn({ err: error, userId }, 'Deal-value lookup failed; no money will be reported');
    }

    return null;
  }

  /**
   * How often this business's people actually end up paying.
   *
   * The companion to `resolveAverageDealValue`: value per client answers "how
   * much", this answers "how many of them". Five detectors multiplied a real
   * count by a real-ish value and then by a CONSTANT — 0.10, 0.15 — to produce
   * the money shown to the owner. The constant was the last invented number in
   * the chain, and it is the one that decides whether "5 cold leads" is worth
   * £60 or £600.
   *
   * Measured the only way that needs no new data: of the people this business
   * has taken on, how many ever paid it anything. Contacts rather than visitors,
   * because contacts are the population every one of these detectors counts.
   *
   * NULL when there is too little history to divide — a business with four
   * contacts has a "conversion rate" of 0%, 25%, 50% or 75% and none of those
   * is a fact about the business.
   */
  protected async resolveLeadConversionRate(userId: string): Promise<number | null> {
    /** Below this, the fraction is an accident of a small denominator. */
    const MIN_CONTACTS = 20;

    try {
      const [{ count: contactCount }, { data: payers }] = await Promise.all([
        this.supabase
          .from('crm_contacts')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId),

        // Everyone who has ever paid, de-duplicated: a client with nine
        // invoices converted once, not nine times.
        this.supabase
          .from('payment_invoices')
          .select('contact_id')
          .eq('user_id', userId)
          .not('paid_at', 'is', null)
          .not('contact_id', 'is', null)
          .limit(2000),
      ]);

      if (!contactCount || contactCount < MIN_CONTACTS) return null;

      const converted = new Set(
        (payers || []).map((row: { contact_id: unknown }) => String(row.contact_id))
      ).size;

      if (converted === 0) return null;

      // Capped at 1: more payers than contacts means a payer without a contact
      // row, which is a data question rather than a conversion above 100%.
      return Math.min(1, converted / contactCount);
    } catch (error) {
      logger.warn({ err: error, userId }, 'Conversion-rate lookup failed; no money will be reported');
      return null;
    }
  }

  /**
   * How often a visitor becomes someone in the CRM.
   *
   * The missing link in any money figure that starts from TRAFFIC. Multiplying
   * lost visitors by the lead-to-paid rate treats a passer-by and a person who
   * already made contact as the same population, which implies a large share of
   * a website's visitors become paying clients and overstates the figure by
   * whatever the real enquiry rate is.
   *
   * Unique people, not page views — see the `conv` vector, which had the same
   * fault and reported one owner reloading their own site twenty times as
   * twenty visitors.
   *
   * NULL when there is too little traffic to divide by.
   */
  protected async resolveVisitorToLeadRate(userId: string, days = 30): Promise<number | null> {
    /** Below this, the fraction is an accident of a small denominator. */
    const MIN_VISITORS = 50;
    const since = new Date(Date.now() - days * 86_400_000).toISOString();

    try {
      const [{ data: views }, { count: contacts }] = await Promise.all([
        this.supabase
          .from('website_page_views')
          .select('session_id, ip_hash, is_owner_view')
          .eq('user_id', userId)
          .gte('viewed_at', since)
          .limit(5000),

        this.supabase
          .from('crm_contacts')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .gte('created_at', since),
      ]);

      const identities = new Set<string>();
      let anonymous = 0;
      for (const row of views || []) {
        const r = row as { session_id?: string | null; ip_hash?: string | null; is_owner_view?: boolean | null };
        if (r.is_owner_view === true) continue;
        const id = r.session_id || r.ip_hash;
        if (id) identities.add(id);
        else anonymous += 1;
      }

      const visitors = identities.size + anonymous;
      if (visitors < MIN_VISITORS || !contacts) return null;

      // Capped: more new contacts than visitors means people arriving by a
      // route the website never saw, which is not a conversion above 100%.
      return Math.min(1, contacts / visitors);
    } catch (error) {
      logger.warn({ err: error, userId }, 'Visitor-to-lead lookup failed; no money will be reported');
      return null;
    }
  }

  /**
   * Log detection for debugging
   */
  protected logDetection(userId: string, result: DetectionResult | null): void {
    if (result) {
      logger.info(
        {
          userId,
          detectorId: this.definition.id,
          severity: result.severity,
          currentValue: result.currentValue,
          baselineValue: result.baselineValue,
        },
        'Detection triggered'
      );
    } else {
      logger.debug(
        { userId, detectorId: this.definition.id },
        'No detection'
      );
    }
  }
}
