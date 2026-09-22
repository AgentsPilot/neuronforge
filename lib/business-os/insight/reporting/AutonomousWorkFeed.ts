/**
 * Autonomous Work Feed
 *
 * Fetches recent kernel actions triggered by Insight/Automations
 * for display in MyDaySection storyBeats.
 *
 * @see docs/INSIGHT_SYSTEM_PLAN.md Section 5
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { createLogger } from '@/lib/logger';
import { TRIGGERABLE_PROCESSES } from '../kernel/TriggerableProcesses';

const logger = createLogger({ module: 'AutonomousWorkFeed' });

// ===========================
// Types
// ===========================

export interface AutonomousWorkEntry {
  /** Execution ID */
  executionId: string;

  /** Process name (human-readable) */
  processName: string;

  /** Process ID */
  processId: string;

  /** Summary of what was done (e.g., "Chased 7 invoices — 2 paid ($680)") */
  summary: string;

  /** What triggered this action */
  triggeredBy: 'insight' | 'automation' | 'user_command';

  /** When this happened */
  timestamp: string;

  /** Outcome details */
  outcome: {
    itemsProcessed: number;
    itemsSucceeded: number;
    itemsFailed: number;
    valueImpact?: number;
  };

  /** Link to original insight if applicable */
  insightId?: string;
}

export interface PendingInsightEntry {
  /** Insight ID */
  insightId: string;

  /** Detector ID */
  detectorId: string;

  /** Title */
  title: string;

  /** Description */
  description: string;

  /** Severity */
  severity: 'low' | 'medium' | 'high' | 'critical';

  /** Category */
  category: string;

  /** Estimated impact */
  estimatedImpactUsd?: number;

  /** Impact direction */
  impactDirection?: 'loss' | 'opportunity' | 'savings';

  /** Whether there's a paired action */
  hasAction: boolean;

  /** Process ID if actionable */
  pairedProcessId?: string;

  /** Priority score */
  priorityScore: number;

  /** When detected */
  detectedAt: string;

  /** Affected count */
  affectedCount: number;
}

export interface MyDayInsightData {
  /** Completed autonomous work entries */
  completedWork: AutonomousWorkEntry[];

  /** Pending insights to surface */
  pendingInsights: PendingInsightEntry[];

  /** Summary stats */
  stats: {
    totalActionsToday: number;
    totalValueImpact: number;
    pendingInsightCount: number;
    criticalInsightCount: number;
  };
}

// ===========================
// AutonomousWorkFeed
// ===========================

export class AutonomousWorkFeed {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /**
   * Get autonomous work feed for a user
   */
  async getWorkFeed(
    userId: string,
    since: Date = new Date(Date.now() - 24 * 60 * 60 * 1000)
  ): Promise<AutonomousWorkEntry[]> {
    try {
      const { data, error } = await this.supabase
        .from('kernel_action_log')
        .select('*')
        .eq('user_id', userId)
        .gte('created_at', since.toISOString())
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) {
        // Table might not exist yet
        logger.warn({ err: error }, 'Failed to fetch work feed (table may not exist)');
        return [];
      }

      return (data || []).map((row) => this.mapToWorkEntry(row));

    } catch (error) {
      logger.error({ err: error }, 'Failed to get work feed');
      return [];
    }
  }

  /**
   * Get pending insights for a user
   */
  async getPendingInsights(
    userId: string,
    limit: number = 5
  ): Promise<PendingInsightEntry[]> {
    try {
      const { data, error } = await this.supabase
        .from('insights')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'new')
        .or(`snoozed_until.is.null,snoozed_until.lt.${new Date().toISOString()}`)
        .order('priority_score', { ascending: false })
        .limit(limit);

      if (error) {
        logger.warn({ err: error }, 'Failed to fetch pending insights');
        return [];
      }

      return (data || []).map((row) => this.mapToPendingInsight(row));

    } catch (error) {
      logger.error({ err: error }, 'Failed to get pending insights');
      return [];
    }
  }

  /**
   * Get complete MyDay insight data
   */
  async getMyDayData(userId: string): Promise<MyDayInsightData> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [completedWork, pendingInsights] = await Promise.all([
      this.getWorkFeed(userId, today),
      this.getPendingInsights(userId, 5),
    ]);

    // Calculate stats
    const totalActionsToday = completedWork.length;
    const totalValueImpact = completedWork.reduce(
      (sum, entry) => sum + (entry.outcome.valueImpact || 0),
      0
    );
    const criticalInsightCount = pendingInsights.filter(
      (i) => i.severity === 'critical'
    ).length;

    return {
      completedWork,
      pendingInsights,
      stats: {
        totalActionsToday,
        totalValueImpact,
        pendingInsightCount: pendingInsights.length,
        criticalInsightCount,
      },
    };
  }

  /**
   * Format work entry for display
   */
  formatWorkSummary(entry: AutonomousWorkEntry): string {
    const { processId, outcome } = entry;

    switch (processId) {
      case 'chase_overdue_invoices': {
        /*
         * Reports what was SENT, never what it earned.
         *
         * This used to multiply the successes by 0.3 — "Assume 30% paid" — and
         * print the result beside a money figure as though both were measured.
         * Nothing anywhere counts invoices paid because a reminder went out, so
         * the number was invented, and it was invented on the one card whose
         * whole purpose is to tell the owner what the platform did for them.
         *
         * A chase is a send. Whether it worked shows up where money is already
         * counted, and if that attribution is ever built it can be stated here
         * as a fact rather than a coefficient.
         */
        const n = outcome.itemsProcessed;
        return `Chased ${n} invoice${n !== 1 ? 's' : ''}`;
      }

      case 'send_reminder_sequence':
        return `Sent ${outcome.itemsProcessed} booking reminder${outcome.itemsProcessed !== 1 ? 's' : ''}`;

      case 'send_followup_nudge':
        return `Followed up with ${outcome.itemsProcessed} lead${outcome.itemsProcessed !== 1 ? 's' : ''}`;

      default:
        return entry.summary || `Processed ${outcome.itemsProcessed} item${outcome.itemsProcessed !== 1 ? 's' : ''}`;
    }
  }

  /**
   * Map database row to work entry
   */
  private mapToWorkEntry(row: Record<string, unknown>): AutonomousWorkEntry {
    const processId = row.process_id as string;
    const process = TRIGGERABLE_PROCESSES[processId];

    return {
      executionId: row.execution_id as string,
      processName: process?.processName || processId,
      processId,
      summary: row.summary as string,
      triggeredBy: row.triggered_by as 'insight' | 'automation' | 'user_command',
      timestamp: row.created_at as string,
      outcome: {
        itemsProcessed: (row.items_processed as number) || 0,
        itemsSucceeded: (row.items_succeeded as number) || 0,
        itemsFailed: (row.items_failed as number) || 0,
        valueImpact: row.value_impact as number | undefined,
      },
      insightId: row.insight_id as string | undefined,
    };
  }

  /**
   * Map database row to pending insight
   */
  private mapToPendingInsight(row: Record<string, unknown>): PendingInsightEntry {
    return {
      insightId: row.id as string,
      detectorId: row.detector_id as string,
      title: row.title as string,
      description: row.description as string,
      severity: row.severity as 'low' | 'medium' | 'high' | 'critical',
      category: row.category as string,
      estimatedImpactUsd: row.estimated_impact_usd as number | undefined,
      impactDirection: row.impact_direction as 'loss' | 'opportunity' | 'savings' | undefined,
      hasAction: !!(row.paired_process_id),
      pairedProcessId: row.paired_process_id as string | undefined,
      priorityScore: (row.priority_score as number) || 0,
      detectedAt: row.detected_at as string,
      affectedCount: (row.affected_count as number) || 0,
    };
  }
}
