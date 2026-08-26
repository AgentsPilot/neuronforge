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
import { getCorrelationEngine } from '../correlation';
import type { CorrelationSummary } from '../correlation/types';

// Import detector catalog - Original 6
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
import { WebPageUnderperformDetector } from './catalog/WebPageUnderperformDetector';
import { WebMobileIssuesDetector } from './catalog/WebMobileIssuesDetector';

// Phase 5: Cash Flow Deep Detectors
import { CashCardsExpiringDetector } from './catalog/CashCardsExpiringDetector';
import { CashArAgingDetector } from './catalog/CashArAgingDetector';
import { CashRefundPatternDetector } from './catalog/CashRefundPatternDetector';
import { CashPayoutBlockedDetector } from './catalog/CashPayoutBlockedDetector';

// Phase 6: Pricing Detectors
import { PricingDiscountAbuseDetector } from './catalog/PricingDiscountAbuseDetector';
import { PricingIntroOfferStuckDetector } from './catalog/PricingIntroOfferStuckDetector';

const logger = createLogger({ module: 'DetectorEngine' });

/**
 * Engine that runs all detectors
 */
export class DetectorEngine {
  private supabase: SupabaseClient;
  private detectors: Detector[];

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;

    // Initialize all detectors
    this.detectors = [
      // Original 6 detectors
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
      new WebPageUnderperformDetector(supabase),
      new WebMobileIssuesDetector(supabase),

      // Phase 5: Cash Flow Deep
      new CashCardsExpiringDetector(supabase),
      new CashArAgingDetector(supabase),
      new CashRefundPatternDetector(supabase),
      new CashPayoutBlockedDetector(supabase),

      // Phase 6: Pricing
      new PricingDiscountAbuseDetector(supabase),
      new PricingIntroOfferStuckDetector(supabase),
    ];
  }

  /**
   * Get all registered detectors
   */
  getDetectors(): Detector[] {
    return this.detectors;
  }

  /**
   * Run all detectors for a single user
   */
  async runForUser(userId: string): Promise<DetectionResult[]> {
    const results: DetectionResult[] = [];

    for (const detector of this.detectors) {
      try {
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
          run.detectorsRun += this.detectors.length;
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
