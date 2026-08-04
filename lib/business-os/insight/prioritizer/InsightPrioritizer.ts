/**
 * Insight Prioritizer
 *
 * Scores and ranks insights for surfacing to users.
 * Uses a weighted formula considering severity, money impact, recency, actionability, and user preferences.
 *
 * @see docs/INSIGHT_SYSTEM_PLAN.md Section 4
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';
import type { DetectionResult, InsightSeverity, SEVERITY_WEIGHTS } from '../detectors/types';

const logger = createLogger({ module: 'InsightPrioritizer' });

// ===========================
// Types
// ===========================

export interface OwnerHistory {
  /** Detector ID -> action counts */
  detectorActions: Map<string, { acted: number; dismissed: number; snoozed: number }>;
  /** Average monthly revenue for normalization */
  monthlyRevenue: number;
}

export interface BusinessContext {
  /** User's average monthly revenue */
  monthlyRevenue: number;
  /** User's timezone for recency calculations */
  timezone?: string;
}

export interface PrioritizedInsight {
  /** Original detection result */
  detection: DetectionResult;
  /** Computed priority score (0-100) */
  score: number;
  /** Score breakdown */
  breakdown: {
    severityScore: number;
    moneyScore: number;
    recencyScore: number;
    actionScore: number;
    preferenceScore: number;
  };
}

// ===========================
// Constants
// ===========================

const SEVERITY_WEIGHTS_MAP: Record<InsightSeverity, number> = {
  critical: 1.0,
  high: 0.75,
  medium: 0.5,
  low: 0.25,
};

/**
 * Score weights (must sum to 100)
 */
const SCORE_WEIGHTS = {
  severity: 30,      // 30% - How severe is the issue
  money: 25,         // 25% - How much money is at stake
  recency: 20,       // 20% - How recent is the detection
  actionability: 15, // 15% - Can we do something about it
  preference: 10,    // 10% - User's historical preferences
};

/**
 * Cooldown hours by detector category
 */
const CATEGORY_COOLDOWNS: Record<string, number> = {
  cash_flow: 24,
  retention: 168,
  sales: 24,
  operations: 168,
  acquisition: 72,
  conversion: 72,
  pricing: 168,
};

// ===========================
// InsightPrioritizer
// ===========================

export class InsightPrioritizer {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /**
   * Calculate priority score for a single detection
   */
  calculateScore(
    detection: DetectionResult,
    history: OwnerHistory,
    context: BusinessContext
  ): number {
    const breakdown = this.getScoreBreakdown(detection, history, context);

    return (
      breakdown.severityScore +
      breakdown.moneyScore +
      breakdown.recencyScore +
      breakdown.actionScore +
      breakdown.preferenceScore
    );
  }

  /**
   * Get detailed score breakdown
   */
  getScoreBreakdown(
    detection: DetectionResult,
    history: OwnerHistory,
    context: BusinessContext
  ): PrioritizedInsight['breakdown'] {
    // Severity score (30%)
    const severityScore = SEVERITY_WEIGHTS_MAP[detection.severity] * SCORE_WEIGHTS.severity;

    // Money impact score (25%)
    const moneyScore = this.calculateMoneyScore(detection, context) * SCORE_WEIGHTS.money;

    // Recency score (20%)
    const recencyScore = this.calculateRecencyScore(detection.detectedAt) * SCORE_WEIGHTS.recency;

    // Actionability score (15%)
    const actionScore = detection.pairedProcessId
      ? SCORE_WEIGHTS.actionability
      : SCORE_WEIGHTS.actionability * 0.33;

    // Preference score (10%)
    const preferenceScore = this.calculatePreferenceScore(detection.detectorId, history) * SCORE_WEIGHTS.preference;

    return {
      severityScore,
      moneyScore,
      recencyScore,
      actionScore,
      preferenceScore,
    };
  }

  /**
   * Calculate money impact score (0-1)
   */
  private calculateMoneyScore(detection: DetectionResult, context: BusinessContext): number {
    if (!detection.estimatedImpactUsd || !context.monthlyRevenue) {
      return 0.5; // Neutral if no data
    }

    // Normalize impact relative to monthly revenue
    const impactRatio = detection.estimatedImpactUsd / context.monthlyRevenue;

    // Use a logarithmic scale to prevent outliers from dominating
    // 1% of revenue = 0.5, 10% = 0.8, 50%+ = 1.0
    if (impactRatio >= 0.5) return 1.0;
    if (impactRatio >= 0.1) return 0.8;
    if (impactRatio >= 0.05) return 0.7;
    if (impactRatio >= 0.01) return 0.5;
    if (impactRatio >= 0.001) return 0.3;
    return 0.1;
  }

  /**
   * Calculate recency score (0-1)
   * More recent detections score higher
   */
  private calculateRecencyScore(detectedAt: Date): number {
    const hoursSince = (Date.now() - detectedAt.getTime()) / (1000 * 60 * 60);

    // Last hour = 1.0, 6 hours = 0.8, 24 hours = 0.5, 72+ hours = 0.1
    if (hoursSince <= 1) return 1.0;
    if (hoursSince <= 6) return 0.8;
    if (hoursSince <= 24) return 0.5;
    if (hoursSince <= 72) return 0.3;
    return 0.1;
  }

  /**
   * Calculate preference score based on user history (0-1)
   */
  private calculatePreferenceScore(detectorId: string, history: OwnerHistory): number {
    const actions = history.detectorActions.get(detectorId);

    if (!actions) {
      return 0.5; // Neutral for new detectors
    }

    const total = actions.acted + actions.dismissed + actions.snoozed;
    if (total === 0) {
      return 0.5;
    }

    // Higher score if user typically acts on this detector
    const actRate = actions.acted / total;
    const dismissRate = actions.dismissed / total;

    // Act rate increases score, dismiss rate decreases it
    return Math.max(0, Math.min(1, 0.5 + actRate * 0.5 - dismissRate * 0.3));
  }

  /**
   * Prioritize and rank a list of detections
   */
  async prioritize(
    userId: string,
    detections: DetectionResult[]
  ): Promise<PrioritizedInsight[]> {
    if (detections.length === 0) {
      return [];
    }

    // Load user context
    const context = await this.loadBusinessContext(userId);
    const history = await this.loadOwnerHistory(userId);

    // Score all detections
    const scored: PrioritizedInsight[] = detections.map((detection) => ({
      detection,
      score: this.calculateScore(detection, history, context),
      breakdown: this.getScoreBreakdown(detection, history, context),
    }));

    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    // Apply deduplication (keep highest scored per category/entity)
    const deduplicated = this.deduplicate(scored);

    // Apply cooldowns
    const cooledDown = await this.applyCooldowns(userId, deduplicated);

    logger.info(
      {
        userId,
        inputCount: detections.length,
        outputCount: cooledDown.length,
        topScore: cooledDown[0]?.score,
      },
      'Prioritization complete'
    );

    return cooledDown;
  }

  /**
   * Load business context for a user
   */
  private async loadBusinessContext(userId: string): Promise<BusinessContext> {
    // Get average monthly revenue from derived_metrics
    const { data } = await this.supabase
      .from('derived_metrics')
      .select('value')
      .eq('user_id', userId)
      .eq('metric_key', 'cashflow.revenue_mtd')
      .order('period_end', { ascending: false })
      .limit(3);

    const avgRevenue = data && data.length > 0
      ? data.reduce((sum, d) => sum + parseFloat(d.value), 0) / data.length
      : 5000; // Default assumption

    return {
      monthlyRevenue: avgRevenue,
    };
  }

  /**
   * Load user's insight interaction history
   */
  private async loadOwnerHistory(userId: string): Promise<OwnerHistory> {
    const { data } = await this.supabase
      .from('owner_insight_history')
      .select('detector_id, action')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(100);

    const detectorActions = new Map<string, { acted: number; dismissed: number; snoozed: number }>();

    if (data) {
      for (const row of data) {
        const current = detectorActions.get(row.detector_id) || { acted: 0, dismissed: 0, snoozed: 0 };

        if (row.action === 'acted') current.acted++;
        else if (row.action === 'dismissed') current.dismissed++;
        else if (row.action === 'snoozed') current.snoozed++;

        detectorActions.set(row.detector_id, current);
      }
    }

    // Get monthly revenue
    const context = await this.loadBusinessContext(userId);

    return {
      detectorActions,
      monthlyRevenue: context.monthlyRevenue,
    };
  }

  /**
   * Deduplicate insights - keep highest scored per category/entity combination
   */
  private deduplicate(insights: PrioritizedInsight[]): PrioritizedInsight[] {
    const seen = new Map<string, PrioritizedInsight>();

    for (const insight of insights) {
      // Create a dedup key based on category and affected entity type
      const key = `${insight.detection.category}:${insight.detection.affectedEntityType || 'none'}`;

      const existing = seen.get(key);
      if (!existing || insight.score > existing.score) {
        seen.set(key, insight);
      }
    }

    return Array.from(seen.values()).sort((a, b) => b.score - a.score);
  }

  /**
   * Apply cooldowns - remove insights that were surfaced recently
   */
  private async applyCooldowns(
    userId: string,
    insights: PrioritizedInsight[]
  ): Promise<PrioritizedInsight[]> {
    const result: PrioritizedInsight[] = [];

    for (const insight of insights) {
      const cooldownHours = CATEGORY_COOLDOWNS[insight.detection.category] || 24;
      const cooldownCutoff = new Date(Date.now() - cooldownHours * 60 * 60 * 1000);

      // Check if this detector was surfaced within cooldown period
      const { data } = await this.supabase
        .from('insights')
        .select('last_surfaced_at')
        .eq('user_id', userId)
        .eq('detector_id', insight.detection.detectorId)
        .gte('last_surfaced_at', cooldownCutoff.toISOString())
        .limit(1);

      if (!data || data.length === 0) {
        result.push(insight);
      } else {
        logger.debug(
          { userId, detectorId: insight.detection.detectorId },
          'Insight on cooldown'
        );
      }
    }

    return result;
  }

  /**
   * Get top N insights for immediate surfacing
   */
  async getTopInsights(
    userId: string,
    detections: DetectionResult[],
    count: number = 2
  ): Promise<PrioritizedInsight[]> {
    const prioritized = await this.prioritize(userId, detections);
    return prioritized.slice(0, count);
  }

  /**
   * Get insights for weekly digest
   */
  async getDigestInsights(
    userId: string,
    detections: DetectionResult[],
    count: number = 5
  ): Promise<PrioritizedInsight[]> {
    const prioritized = await this.prioritize(userId, detections);
    return prioritized.slice(0, count);
  }
}
