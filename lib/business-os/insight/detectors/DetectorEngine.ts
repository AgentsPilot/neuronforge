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

// Import detector catalog
import { CashArOverdueDetector } from './catalog/CashArOverdueDetector';
import { RetNoShowSpikeDetector } from './catalog/RetNoShowSpikeDetector';
import { SalesStalledDetector } from './catalog/SalesStalledDetector';
import { SalesReplySlowDetector } from './catalog/SalesReplySlowDetector';
import { OpsUtilizationLowDetector } from './catalog/OpsUtilizationLowDetector';

const logger = createLogger({ module: 'DetectorEngine' });

/**
 * Engine that runs all detectors
 */
export class DetectorEngine {
  private supabase: SupabaseClient;
  private detectors: Detector[];

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;

    // Initialize all MVP detectors
    this.detectors = [
      new CashArOverdueDetector(supabase),
      new RetNoShowSpikeDetector(supabase),
      new SalesStalledDetector(supabase),
      new SalesReplySlowDetector(supabase),
      new OpsUtilizationLowDetector(supabase),
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
}
