/**
 * CheckpointManager — In-memory execution state snapshots
 *
 * Captures lightweight metadata-only snapshots of execution state at
 * checkpoint boundaries. Used by the ResumeOrchestrator to understand
 * execution progress when deciding how to handle failures.
 *
 * Checkpoint levels (from shadow-critic-architecture.md):
 * - step: after each step completion
 * - batch: after parallel batch completion
 * - validation: before expensive operations
 *
 * PRIVACY CONSTRAINT: NO client data is ever stored in checkpoints.
 * Only step IDs, timestamps, and aggregate counts.
 *
 * @module lib/pilot/shadow/CheckpointManager
 */

import type { ExecutionContext } from '../ExecutionContext';
import type { InMemoryCheckpoint, CheckpointLevel } from './types';

export class CheckpointManager {
  private checkpoints: InMemoryCheckpoint[] = [];
  private nextId = 0;

  constructor(private executionId: string) {}

  // ─── Create Checkpoints ──────────────────────────────────

  /**
   * Create a checkpoint after a step completes successfully.
   */
  createStepCheckpoint(
    context: ExecutionContext,
    stepId: string
  ): InMemoryCheckpoint {
    return this.createCheckpoint(context, 'step', stepId);
  }

  /**
   * Create a checkpoint after a parallel batch completes.
   * Uses the first step ID in the batch as the trigger.
   */
  createBatchCheckpoint(
    context: ExecutionContext,
    batchStepIds: string[]
  ): InMemoryCheckpoint {
    const triggerStepId = batchStepIds[0] || 'batch_unknown';
    return this.createCheckpoint(context, 'batch', triggerStepId);
  }

  /**
   * Create a validation checkpoint before an expensive operation.
   */
  createValidationCheckpoint(
    context: ExecutionContext,
    stepId: string
  ): InMemoryCheckpoint {
    return this.createCheckpoint(context, 'validation', stepId);
  }

  // ─── Query Checkpoints ───────────────────────────────────

  /**
   * Get the last checkpoint created before a given step failed.
   * Finds the most recent checkpoint whose triggerStepId is NOT the given stepId.
   */
  getCheckpointBefore(stepId: string): InMemoryCheckpoint | null {
    // Walk backwards to find the most recent checkpoint that isn't for this step
    for (let i = this.checkpoints.length - 1; i >= 0; i--) {
      if (this.checkpoints[i].triggerStepId !== stepId) {
        return this.checkpoints[i];
      }
    }
    return null;
  }

  /**
   * Get the most recent checkpoint regardless of step.
   */
  getLatestCheckpoint(): InMemoryCheckpoint | null {
    if (this.checkpoints.length === 0) return null;
    return this.checkpoints[this.checkpoints.length - 1];
  }

  /**
   * Get total number of checkpoints created.
   */
  getCheckpointCount(): number {
    return this.checkpoints.length;
  }

  /**
   * Clear all checkpoints (called when execution finishes).
   */
  clear(): void {
    this.checkpoints = [];
    this.nextId = 0;
  }

  // ─── Private ─────────────────────────────────────────────

  private createCheckpoint(
    context: ExecutionContext,
    level: CheckpointLevel,
    triggerStepId: string
  ): InMemoryCheckpoint {
    const checkpoint: InMemoryCheckpoint = {
      checkpointId: `cp_${this.executionId}_${this.nextId++}`,
      executionId: this.executionId,
      timestamp: Date.now(),
      level,
      // Snapshot metadata — copy arrays so mutations don't affect checkpoint
      completedStepIds: [...context.completedSteps],
      failedStepIds: [...context.failedSteps],
      skippedStepIds: [...context.skippedSteps],
      currentStepId: context.currentStep,
      tokensUsed: context.totalTokensUsed,
      executionTimeMs: context.totalExecutionTime,
      triggerStepId,
    };

    this.checkpoints.push(checkpoint);
    return checkpoint;
  }
}
