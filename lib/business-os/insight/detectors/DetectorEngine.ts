/**
 * Detector Engine
 *
 * Orchestrates running all detectors for users and collecting results.
 * Called by the insight-detect cron job.
 *
 * @see docs/INSIGHT_SYSTEM_PLAN.md Section 3
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';
import type { Detector, DetectionResult, DetectionRun } from './types';
import { effectiveClaimType } from './types';
import { getCorrelationEngine } from '../correlation';
import type { CorrelationSummary } from '../correlation/types';
import { InsightRepository, type VectorKey, type VectorState } from '../repository/InsightRepository';
import type { BusinessEventCategory } from '../events/types';

// Import detector catalog - Original 6
import { ToilManualBookingEntryDetector } from './catalog/ToilManualBookingEntryDetector';
import { SysAutomationUnadoptedDetector } from './catalog/SysAutomationUnadoptedDetector';
import { CashArOverdueDetector } from './catalog/CashArOverdueDetector';
import { PaymentIssuesDetector } from './catalog/PaymentIssuesDetector';
import { RetNoShowSpikeDetector } from './catalog/RetNoShowSpikeDetector';
import { SalesStalledDetector } from './catalog/SalesStalledDetector';
import { SalesReplySlowDetector } from './catalog/SalesReplySlowDetector';
import { OpsUtilizationLowDetector } from './catalog/OpsUtilizationLowDetector';

// Phase 1: High Impact Detectors
import { CrmColdLeadsDetector } from './catalog/CrmColdLeadsDetector';
import { AcqTrafficDropDetector } from './catalog/AcqTrafficDropDetector';
import { AcqLowConversionDetector } from './catalog/AcqLowConversionDetector';
import { RetCancellationSpikeDetector } from './catalog/RetCancellationSpikeDetector';

// Phase 2: CRM/Pipeline Detectors
import { ConvPipelineStuckDetector } from './catalog/ConvPipelineStuckDetector';
import { ConvFollowupOverdueDetector } from './catalog/ConvFollowupOverdueDetector';
import { ConvSourceUnderperformDetector } from './catalog/ConvSourceUnderperformDetector';
import { CrmEngagementDecayDetector } from './catalog/CrmEngagementDecayDetector';

// Phase 3: Booking/Operations Detectors
import { RetRepeatBookingLowDetector } from './catalog/RetRepeatBookingLowDetector';
import { OpsLastMinuteCancelsDetector } from './catalog/OpsLastMinuteCancelsDetector';
import { OpsServicePerformanceDetector } from './catalog/OpsServicePerformanceDetector';
import { OpsPeakUnutilizedDetector } from './catalog/OpsPeakUnutilizedDetector';

// Phase 4: Website Content Detectors
import { WebMissingCtaDetector } from './catalog/WebMissingCtaDetector';
import { WebIncompleteContentDetector } from './catalog/WebIncompleteContentDetector';

// Phase 5: Cash Flow Deep Detectors
import { CashArAgingDetector } from './catalog/CashArAgingDetector';
import { CashRefundPatternDetector } from './catalog/CashRefundPatternDetector';
import { CashPayoutBlockedDetector } from './catalog/CashPayoutBlockedDetector';

// Phase 6: Pricing Detectors
import { PricingIntroOfferStuckDetector } from './catalog/PricingIntroOfferStuckDetector';
import { CashBookingUnpaidDetector } from './catalog/CashBookingUnpaidDetector';
import { CashWorkUnbilledDetector } from './catalog/CashWorkUnbilledDetector';
import { CashCancelledUnrefundedDetector } from './catalog/CashCancelledUnrefundedDetector';
import { ConvDeclineReasonDetector } from './catalog/ConvDeclineReasonDetector';
import { RetCancelPatternDetector } from './catalog/RetCancelPatternDetector';
import { CashIncomeDropDetector } from './catalog/CashIncomeDropDetector';
import { CashClientConcentrationDetector } from './catalog/CashClientConcentrationDetector';
import { ConvQuoteAcceptanceDropDetector } from './catalog/ConvQuoteAcceptanceDropDetector';
import { WebMobileConversionGapDetector } from './catalog/WebMobileConversionGapDetector';
import { WebPageNoConversionsDetector } from './catalog/WebPageNoConversionsDetector';
import { RetPackageEndingDetector } from './catalog/RetPackageEndingDetector';
import { RetRescheduleChurnDetector } from './catalog/RetRescheduleChurnDetector';
import { CashCardsExpiringDetector } from './catalog/CashCardsExpiringDetector';
import { PricingDiscountAbuseDetector } from './catalog/PricingDiscountAbuseDetector';
import { WebLinkNotConvertingDetector } from './catalog/WebLinkNotConvertingDetector';
import { WebLinkDeadDestinationDetector } from './catalog/WebLinkDeadDestinationDetector';
import { ConvNoNextStepDetector } from './catalog/ConvNoNextStepDetector';
import { CashRevenueAtRiskDetector } from './catalog/CashRevenueAtRiskDetector';
import { ConvStageDropoffDetector } from './catalog/ConvStageDropoffDetector';
import { ConvServiceRateDropDetector } from './catalog/ConvServiceRateDropDetector';

const logger = createLogger({ module: 'DetectorEngine' });

/**
 * Which of the seven vectors each detector's category belongs to.
 *
 * A vector is `dark` until the business has enough of the thing it watches to
 * say anything honest about it. Telling a one-day-old account its calendar is
 * 0% filled is not advice — the calendar is empty by definition — so detectors
 * whose vector is dark do not run at all.
 *
 * `wins` has no detector category: win insights are recorded from events, not
 * detected, so nothing here maps to it.
 */
const CATEGORY_VECTOR: Record<BusinessEventCategory, VectorKey> = {
  acquisition: 'conv',   // traffic — gated on visitors, like conversion
  conversion: 'conv',
  sales: 'leads',
  cash_flow: 'cash',
  retention: 'ret',
  operations: 'ops',
  pricing: 'price',
};

/**
 * Engine that runs all detectors
 */
export class DetectorEngine {
  private supabase: SupabaseClient;
  private detectors: Detector[];
  /**
   * How many detectors the last runForUser() actually evaluated, rather than
   * skipped as dark. Read straight after that call — callers process users one
   * at a time, so there is nothing to interleave with.
   */
  private lastEvaluatedCount = 0;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;

    // Initialize all detectors
    this.detectors = [
      // Original 6 detectors
      /*
       * Behaviour detectors: what the OWNER does, not what happened to the
       * business. Everything above this line reasons about outcomes.
       */
      new ToilManualBookingEntryDetector(supabase),
      new SysAutomationUnadoptedDetector(supabase),

      new CashArOverdueDetector(supabase),
      new PaymentIssuesDetector(supabase),
      new RetNoShowSpikeDetector(supabase),
      new SalesStalledDetector(supabase),
      new SalesReplySlowDetector(supabase),
      new OpsUtilizationLowDetector(supabase),

      // Phase 1: High Impact
      new CrmColdLeadsDetector(supabase),
      new AcqTrafficDropDetector(supabase),
      new AcqLowConversionDetector(supabase),
      new RetCancellationSpikeDetector(supabase),

      // Phase 2: CRM/Pipeline
      new ConvPipelineStuckDetector(supabase),
      new ConvFollowupOverdueDetector(supabase),
      new ConvSourceUnderperformDetector(supabase),
      new CrmEngagementDecayDetector(supabase),

      // Phase 3: Booking/Operations
      new RetRepeatBookingLowDetector(supabase),
      new OpsLastMinuteCancelsDetector(supabase),
      new OpsServicePerformanceDetector(supabase),
      new OpsPeakUnutilizedDetector(supabase),

      // Phase 4: Website Content
      new WebMissingCtaDetector(supabase),
      new WebIncompleteContentDetector(supabase),

      // Phase 5: Cash Flow Deep
      new CashArAgingDetector(supabase),
      new CashRefundPatternDetector(supabase),
      new CashPayoutBlockedDetector(supabase),

      // Phase 6: Pricing
      new PricingIntroOfferStuckDetector(supabase),

      /*
       * MVP0: the three journey gaps.
       *
       * Each answers a question the brief asks and nothing else here could:
       * money owed against a dated appointment, a client finishing a package,
       * and the catch-all for people with no future at all.
       */
      new CashBookingUnpaidDetector(supabase),
      new CashWorkUnbilledDetector(supabase),
      new CashCancelledUnrefundedDetector(supabase),
      new ConvDeclineReasonDetector(supabase),
      new RetCancelPatternDetector(supabase),
      new CashIncomeDropDetector(supabase),
      new CashClientConcentrationDetector(supabase),
      new ConvQuoteAcceptanceDropDetector(supabase),
      new WebMobileConversionGapDetector(supabase),
      new WebPageNoConversionsDetector(supabase),
      new RetPackageEndingDetector(supabase),
      new RetRescheduleChurnDetector(supabase),
      /*
       * Silent until their data exists, and registered anyway.
       *
       * `cash_cards_expiring` needs card expiry synced from Stripe Connect;
       * `pricing_discount_abuse` needs a discount to be recorded anywhere. Both
       * read an empty source and return, which costs one cheap query. They are
       * here rather than deleted so the capability is not lost to git
       * archaeology a second time — each file's header says exactly what would
       * light it.
       */
      new CashCardsExpiringDetector(supabase),
      new PricingDiscountAbuseDetector(supabase),
      new WebLinkNotConvertingDetector(supabase),
      new WebLinkDeadDestinationDetector(supabase),
      new ConvNoNextStepDetector(supabase),
      new CashRevenueAtRiskDetector(supabase),
      new ConvStageDropoffDetector(supabase),
      new ConvServiceRateDropDetector(supabase),
    ];
  }

  /**
   * Get all registered detectors
   */
  getDetectors(): Detector[] {
    return this.detectors;
  }

  /**
   * Detectors actually evaluated for the user most recently passed to
   * runForUser() — the registered count minus those skipped as dark.
   */
  getLastEvaluatedCount(): number {
    return this.lastEvaluatedCount;
  }

  /**
   * How much evidence each vector actually has, by name.
   *
   * This read `state === 'dark'` into a Set and threw the rest away, which
   * reduced a three-state machine to two states at the only place that gates
   * anything. `learn` means ONE ROW of data:
   *
   *   if (dataPoints >= threshold && alsoMet) state = 'lit';
   *   else if (dataPoints > 0)                state = 'learn';
   *   else                                    state = 'dark';
   *
   * So `learn` was treated exactly like `lit`, and `journeyTimeline` -- reading
   * the same data properly, including the `also` volume clause -- drew the
   * pricing node locked and promised it for day 52 while a pricing card was
   * already on the owner's dashboard. The timeline honoured the threshold; the
   * engine honoured `> 0`.
   *
   * Returning null, rather than an empty map, is how an unreadable lookup is
   * told apart from a genuinely empty one. See `shouldRun`.
   */
  private async getVectorStates(userId: string): Promise<Map<VectorKey, VectorState> | null> {
    const repository = new InsightRepository(this.supabase);
    const { data, error } = await repository.getVectorMaturity(userId);

    if (error || !data) {
      logger.warn({ err: error, userId }, 'Vector maturity unavailable; instance claims only');
      return null;
    }

    return new Map(data.vectors.map(v => [v.key, v.state]));
  }

  /**
   * May this detector speak, given what its vector actually knows?
   *
   * An `instance` claim names specific things and is true however little
   * history exists: "three people wrote to you and got no reply" needs no
   * baseline, and the businesses a strict gate silences are exactly the small
   * ones that can least afford to lose an enquiry. That reasoning was already
   * in this file, applied one hand-set boolean at a time; it is now the
   * definition of a claim type.
   *
   * A rate, trend or pattern is an inference over a population and is only as
   * good as the population behind it, so it waits for `lit`.
   *
   * Unreadable maturity FAILS CLOSED for inference. If we cannot establish how
   * much evidence there is, we cannot establish the claim either -- the old
   * behaviour here was to run all 44 detectors on a failed lookup, which is the
   * most confident the engine could possibly be at the moment it knows least.
   */
  private shouldRun(
    detector: Detector,
    states: Map<VectorKey, VectorState> | null
  ): boolean {
    const vector = CATEGORY_VECTOR[detector.definition.category];
    if (!vector) return true;

    const claim = effectiveClaimType(detector.definition);

    if (states === null) return claim === 'instance';

    const state = states.get(vector);
    if (!state) return true;

    return claim === 'instance' ? state !== 'dark' : state === 'lit';
  }

  /**
   * Run all detectors for a single user
   */
  async runForUser(userId: string): Promise<DetectionResult[]> {
    const results: DetectionResult[] = [];
    const vectorStates = await this.getVectorStates(userId);
    let evaluated = 0;

    for (const detector of this.detectors) {
      if (!this.shouldRun(detector, vectorStates)) {
        const vector = CATEGORY_VECTOR[detector.definition.category];
        logger.debug(
          {
            userId,
            detectorId: detector.definition.id,
            vector,
            state: vectorStates?.get(vector) ?? 'unknown',
            claim: effectiveClaimType(detector.definition),
          },
          'Detector skipped: its claim needs more evidence than its vector has'
        );
        continue;
      }

      try {
        evaluated++;
        const result = await detector.evaluate(userId);
        if (result) {
          results.push(result);
          logger.debug(
            { userId, detectorId: detector.definition.id },
            'Detector fired'
          );
        }
      } catch (error) {
        logger.error(
          { err: error, userId, detectorId: detector.definition.id },
          'Detector evaluation failed'
        );
      }
    }

    this.lastEvaluatedCount = evaluated;
    logger.info({
      userId,
      evaluated,
      skipped: this.detectors.length - evaluated,
      fired: results.length,
      vectorStates: vectorStates ? Object.fromEntries(vectorStates) : 'unavailable',
    }, 'Detector run complete');

    return results;
  }

  /**
   * Run all detectors for all active users
   */
  async runForAllUsers(): Promise<DetectionRun> {
    const runId = crypto.randomUUID();
    const startedAt = new Date();

    const run: DetectionRun = {
      id: runId,
      startedAt,
      usersProcessed: 0,
      detectorsRun: 0,
      insightsGenerated: 0,
      errors: 0,
    };

    logger.info({ runId }, 'Starting detection run');

    try {
      // Get active users (those with recent business events)
      const { data: activeUsers, error: usersError } = await this.supabase
        .from('business_events')
        .select('user_id')
        .gte('created_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
        .limit(1000);

      if (usersError) {
        throw usersError;
      }

      // Get unique user IDs
      const userIds = [...new Set(activeUsers?.map((u) => u.user_id) || [])];

      logger.info({ runId, userCount: userIds.length }, 'Processing users');

      // Process each user
      for (const userId of userIds) {
        try {
          const results = await this.runForUser(userId);
          run.usersProcessed++;
          run.detectorsRun += this.lastEvaluatedCount;
          run.insightsGenerated += results.length;
        } catch (error) {
          logger.error({ err: error, userId, runId }, 'Failed to process user');
          run.errors++;
        }
      }

      run.completedAt = new Date();

      logger.info(
        {
          runId,
          duration: run.completedAt.getTime() - startedAt.getTime(),
          ...run,
        },
        'Detection run completed'
      );

      return run;

    } catch (error) {
      logger.error({ err: error, runId }, 'Detection run failed');
      run.completedAt = new Date();
      run.errors++;
      return run;
    }
  }

  /**
   * Run a specific detector for a user
   */
  async runDetector(detectorId: string, userId: string): Promise<DetectionResult | null> {
    const detector = this.detectors.find((d) => d.definition.id === detectorId);

    if (!detector) {
      logger.warn({ detectorId }, 'Detector not found');
      return null;
    }

    return detector.evaluate(userId);
  }

  /**
   * Check if a detector exists
   */
  hasDetector(detectorId: string): boolean {
    return this.detectors.some((d) => d.definition.id === detectorId);
  }

  /**
   * Get detector definition by ID
   */
  getDetectorDefinition(detectorId: string) {
    const detector = this.detectors.find((d) => d.definition.id === detectorId);
    return detector?.definition;
  }

  /**
   * Run all detectors for a user AND correlate results into unified insights
   *
   * This is the main method for getting the full insight picture.
   * It runs all detectors, then uses the correlation engine to connect
   * related signals into story-driven insights.
   */
  async runWithCorrelation(userId: string): Promise<CorrelationSummary> {
    // First, run all individual detectors
    const detectionResults = await this.runForUser(userId);

    // Then, correlate the results
    const correlationEngine = getCorrelationEngine();
    const correlationSummary = correlationEngine.correlate(detectionResults);

    logger.info(
      {
        userId,
        totalDetections: detectionResults.length,
        correlatedInsights: correlationSummary.correlatedInsights.length,
        standaloneInsights: correlationSummary.standaloneInsights.length,
        totalImpactUsd: correlationSummary.totalImpactUsd,
      },
      'Detection with correlation complete'
    );

    return correlationSummary;
  }

  /**
   * Get total detector count
   */
  getDetectorCount(): number {
    return this.detectors.length;
  }

  /**
   * Get detectors by category
   */
  getDetectorsByCategory(category: string): Detector[] {
    return this.detectors.filter((d) => d.definition.category === category);
  }
}
