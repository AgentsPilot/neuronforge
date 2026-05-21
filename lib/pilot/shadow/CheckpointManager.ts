/**
 * CheckpointManager — in-memory checkpoint store for in-process resume
 *
 * Status (Phase 6 — Post-audit cleanup):
 *   • Stores per-step checkpoints in an in-memory Map for the lifetime of
 *     one execution. Cleared when the execution finishes (success or fail).
 *   • The previous version of this file was a pure no-op stub. ResumeOrchestrator
 *     only ever calls `createStepCheckpoint(...)` (a write path); no caller
 *     reads checkpoints back today, so even with this real implementation,
 *     end-to-end resume-from-checkpoint is **not yet wired**.
 *   • This module provides the storage so the read path can be implemented
 *     separately without further plumbing — but until that happens, treat
 *     the data as write-only telemetry.
 *
 * Audit finding (G-CAL-2 / formerly H-10 risk):
 *   • `CheckpointManager` was previously a 35-line stub with all methods
 *     returning null/no-op. Combined with `ResumeOrchestrator` only writing
 *     (never reading), the entire "Phase 2: Repair & Resume" feature claim
 *     was aspirational. This file is the first step toward closing the gap.
 *
 * Out-of-scope for this file:
 *   • Persistence to Supabase (would survive process restarts). Today's
 *     in-memory Map is sufficient for in-process Pilot retries.
 *   • A real "resume-from-step-N" code path in ResumeOrchestrator. The
 *     write side now produces valid data; the read side is a follow-up.
 *
 * @module lib/pilot/shadow/CheckpointManager
 */

import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'CheckpointManager', service: 'shadow-agent' });

/**
 * A serializable snapshot of execution state at a single checkpoint.
 * Kept minimal so the in-memory cost is bounded for long workflows.
 */
export interface ExecutionCheckpoint {
  /** Step id immediately following the snapshot (the "next step to run"). */
  afterStepId: string;
  /** Wall-clock time the checkpoint was captured. */
  capturedAt: string;
  /** Shallow snapshot of context.completedSteps so the resume path can pick up where we left off. */
  completedSteps: string[];
  /** Shallow snapshot of context.failedSteps. */
  failedSteps: string[];
  /** Step output map keys at the time of checkpoint (not the values — kept light). */
  stepOutputKeys: string[];
  /** Snapshot of context.variables keys (not values). */
  variableKeys: string[];
}

export class CheckpointManager {
  private readonly executionId: string | null;

  /**
   * In-memory checkpoint storage. Keyed by step id (the LAST successfully-completed
   * step). Cleared via `clear()` at execution end.
   */
  private checkpoints: Map<string, ExecutionCheckpoint> = new Map();

  constructor(executionId?: string) {
    this.executionId = executionId ?? null;
  }

  /**
   * Capture a checkpoint after a step completes successfully.
   *
   * Called by `ResumeOrchestrator.handleStepFailure` and by step-completion
   * paths in WorkflowPilot. We intentionally store only KEYS for stepOutputs
   * and variables — not values — so the in-memory cost stays bounded even
   * for long-running workflows. The actual values live in `context.stepOutputs`
   * and `context.variables` and are recoverable from there at resume time.
   */
  createStepCheckpoint(context: any, stepId: string): void {
    try {
      const checkpoint: ExecutionCheckpoint = {
        afterStepId: stepId,
        capturedAt: new Date().toISOString(),
        completedSteps: Array.isArray(context?.completedSteps)
          ? [...context.completedSteps]
          : [],
        failedSteps: Array.isArray(context?.failedSteps)
          ? [...context.failedSteps]
          : [],
        stepOutputKeys: context?.stepOutputs instanceof Map
          ? Array.from(context.stepOutputs.keys())
          : [],
        variableKeys: context?.variables && typeof context.variables === 'object'
          ? Object.keys(context.variables)
          : [],
      };
      this.checkpoints.set(stepId, checkpoint);
      logger.debug(
        {
          executionId: this.executionId,
          stepId,
          completedCount: checkpoint.completedSteps.length,
          outputKeyCount: checkpoint.stepOutputKeys.length,
        },
        'Step checkpoint captured',
      );
    } catch (err) {
      // Checkpoint failures must never block execution.
      logger.warn(
        { err, executionId: this.executionId, stepId },
        'createStepCheckpoint failed (non-blocking)',
      );
    }
  }

  /**
   * Batch-checkpoint stub. Currently no caller (the call site in WorkflowPilot
   * is commented out as of D-B25). Kept for API parity with the previous stub.
   */
  createBatchCheckpoint(_context: any, _batchStepIds: string[]): void {
    // Intentionally no-op. If/when batch-checkpoint semantics are decided,
    // implement here. Today the per-step path covers the only active caller.
  }

  /**
   * Retrieve the checkpoint captured after a specific step. Returns `null`
   * if no checkpoint exists for that step id.
   *
   * NOTE: this is currently UNCALLED by any production code path. Provided
   * so that a future `resumeFromCheckpoint()` implementation can read back
   * the data this manager has been collecting.
   */
  getCheckpoint(stepId: string): ExecutionCheckpoint | null {
    return this.checkpoints.get(stepId) ?? null;
  }

  /**
   * Return the most-recently-captured checkpoint, or null if none captured.
   * Convenient entry point for "resume from the last good state."
   */
  getLatestCheckpoint(): ExecutionCheckpoint | null {
    if (this.checkpoints.size === 0) return null;
    let latest: ExecutionCheckpoint | null = null;
    for (const cp of this.checkpoints.values()) {
      if (!latest || cp.capturedAt > latest.capturedAt) {
        latest = cp;
      }
    }
    return latest;
  }

  /**
   * Return all captured checkpoints, ordered by capture time (oldest first).
   * Useful for diagnostic dumps; not on the hot path.
   */
  listCheckpoints(): ExecutionCheckpoint[] {
    return Array.from(this.checkpoints.values()).sort(
      (a, b) => a.capturedAt.localeCompare(b.capturedAt),
    );
  }

  /**
   * How many checkpoints are currently held. Useful for tests and for
   * observability of the per-execution memory footprint.
   */
  size(): number {
    return this.checkpoints.size;
  }

  /**
   * Clear all captured checkpoints. Called by WorkflowPilot at the end of an
   * execution (success or failure) to free memory. Safe to call multiple times.
   */
  clear(): void {
    if (this.checkpoints.size > 0) {
      logger.debug(
        { executionId: this.executionId, cleared: this.checkpoints.size },
        'Clearing in-memory checkpoints',
      );
    }
    this.checkpoints.clear();
  }
}
