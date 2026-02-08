/**
 * ExecutionProtection - Guard rails during calibration
 *
 * Enforces limits and safety checks during the calibration phase:
 *
 * 1. Early stop: Non-recoverable + non-fixable failure → stop workflow immediately
 * 2. Per-step repair limit: Max N repair attempts on same step
 * 3. Total repair limit: Max N repair attempts across entire execution
 * 4. Identical failure detection: Same step+category from previous run → skip repair
 *
 * All state is in-memory for the current execution.
 * Previous failure data is lazy-loaded from shadow_failure_snapshots on first access.
 *
 * ExecutionProtection NEVER throws — all errors are caught internally.
 *
 * @module lib/pilot/shadow/ExecutionProtection
 */

import { SupabaseClient } from '@supabase/supabase-js';
import type {
  FailureCategory,
  FailureClassification,
  ExecutionProtectionConfig,
} from './types';

const DEFAULT_CONFIG: ExecutionProtectionConfig = {
  earlyStopOnNonRecoverable: true,
  maxRepairsPerStep: 2,
  maxTotalRepairs: 5,
  checkIdenticalFailures: true,
};

/** Non-recoverable failure categories that trigger early stop */
const NON_RECOVERABLE_CATEGORIES = new Set<FailureCategory>([
  'missing_step',
  'capability_mismatch',
  'invalid_step_order',
]);

export class ExecutionProtection {
  private config: ExecutionProtectionConfig;

  /** Per-step repair attempt counts for this execution */
  private stepRepairCounts: Map<string, number> = new Map();

  /** Total repair attempts for this execution */
  private totalRepairCount: number = 0;

  /** Lazy-loaded cache: stepId → Set<FailureCategory> from previous runs */
  private previousFailures: Map<string, Set<FailureCategory>> | null = null;
  private previousFailuresLoaded: boolean = false;

  constructor(
    private supabase: SupabaseClient,
    private agentId: string,
    config?: Partial<ExecutionProtectionConfig>
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check if the workflow should stop immediately (early stop).
   * Returns true if the failure is non-recoverable AND not auto-fixable.
   */
  shouldEarlyStop(classification: FailureClassification): boolean {
    if (!this.config.earlyStopOnNonRecoverable) return false;

    // Non-recoverable category + not auto-retryable = stop
    return (
      NON_RECOVERABLE_CATEGORIES.has(classification.category) &&
      !classification.is_auto_retryable
    );
  }

  /**
   * Check if a repair attempt is allowed for this step.
   * Considers per-step limits, total limits, and identical failure history.
   *
   * @returns true if repair can be attempted, false if limits are exceeded
   */
  async canAttemptRepair(
    stepId: string,
    classification: FailureClassification
  ): Promise<boolean> {
    // Check per-step limit
    const stepCount = this.stepRepairCounts.get(stepId) || 0;
    if (stepCount >= this.config.maxRepairsPerStep) {
      console.log(
        `[ExecutionProtection] Per-step repair limit reached for ${stepId}` +
        ` (${stepCount}/${this.config.maxRepairsPerStep})`
      );
      return false;
    }

    // Check total limit
    if (this.totalRepairCount >= this.config.maxTotalRepairs) {
      console.log(
        `[ExecutionProtection] Total repair limit reached` +
        ` (${this.totalRepairCount}/${this.config.maxTotalRepairs})`
      );
      return false;
    }

    // Check identical failure from previous run
    if (this.config.checkIdenticalFailures) {
      const isIdentical = await this.hasIdenticalPreviousFailure(
        stepId,
        classification.category
      );
      if (isIdentical) {
        console.log(
          `[ExecutionProtection] Identical failure detected for ${stepId}` +
          ` (${classification.category}) — skipping repair`
        );
        return false;
      }
    }

    return true;
  }

  /**
   * Record that a repair attempt was made for a step.
   * Call this after attempting a repair (regardless of outcome).
   */
  recordRepairAttempt(stepId: string): void {
    const current = this.stepRepairCounts.get(stepId) || 0;
    this.stepRepairCounts.set(stepId, current + 1);
    this.totalRepairCount++;
  }

  /**
   * Check if the same step+category combination failed in a previous run.
   * Lazy-loads previous failure data on first call.
   */
  async hasIdenticalPreviousFailure(
    stepId: string,
    category: FailureCategory
  ): Promise<boolean> {
    await this.ensurePreviousFailuresLoaded();

    if (!this.previousFailures) return false;

    const categories = this.previousFailures.get(stepId);
    return categories?.has(category) || false;
  }

  // ─── Private helpers ─────────────────────────────────────

  /**
   * Lazy-load previous failure data from shadow_failure_snapshots.
   * Only queries the DB once per execution — subsequent calls use cache.
   */
  private async ensurePreviousFailuresLoaded(): Promise<void> {
    if (this.previousFailuresLoaded) return;
    this.previousFailuresLoaded = true;

    try {
      const { data, error } = await this.supabase
        .from('shadow_failure_snapshots')
        .select('failed_step_id, failure_category')
        .eq('agent_id', this.agentId)
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) {
        console.warn('[ExecutionProtection] Failed to load previous failures:', error.message);
        return;
      }

      if (!data || data.length === 0) return;

      this.previousFailures = new Map();
      for (const row of data) {
        const stepId = row.failed_step_id;
        const category = row.failure_category as FailureCategory;

        if (!this.previousFailures.has(stepId)) {
          this.previousFailures.set(stepId, new Set());
        }
        this.previousFailures.get(stepId)!.add(category);
      }

      console.log(
        `[ExecutionProtection] Loaded ${data.length} previous failures` +
        ` for ${this.previousFailures.size} steps`
      );
    } catch (err) {
      console.warn('[ExecutionProtection] Error loading previous failures:', err);
    }
  }
}
