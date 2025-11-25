/**
 * ExecutionController - Advanced execution state management
 *
 * Phase 6: Execution Controls
 * Provides checkpoint management, pause/resume, and rollback capabilities
 * for long-running multi-step workflows
 */

import type { WorkflowStep, StepResult } from './types';

export interface ExecutionCheckpoint {
  /**
   * Unique checkpoint ID
   */
  id: string;

  /**
   * Workflow execution ID
   */
  workflowId: string;

  /**
   * Timestamp of checkpoint creation
   */
  timestamp: string;

  /**
   * Step that was just completed
   */
  completedStep: string;

  /**
   * All completed steps up to this point
   */
  completedSteps: string[];

  /**
   * Results of completed steps
   */
  stepResults: Record<string, StepResult>;

  /**
   * Current execution context
   */
  context: Record<string, any>;

  /**
   * Remaining steps to execute
   */
  remainingSteps: string[];

  /**
   * Execution metadata
   */
  metadata: {
    startedAt: string;
    duration: number; // milliseconds
    stepCount: number;
    errorCount: number;
  };
}

export interface ExecutionState {
  /**
   * Current status
   */
  status: 'running' | 'paused' | 'completed' | 'failed' | 'rolled_back';

  /**
   * Current step being executed (if any)
   */
  currentStep?: string;

  /**
   * Completed steps
   */
  completedSteps: string[];

  /**
   * Failed steps
   */
  failedSteps: string[];

  /**
   * Available checkpoints
   */
  checkpoints: ExecutionCheckpoint[];

  /**
   * Execution start time
   */
  startedAt: string;

  /**
   * Execution end time (if completed/failed)
   */
  endedAt?: string;

  /**
   * Total execution duration (milliseconds)
   */
  duration?: number;
}

export interface RollbackResult {
  success: boolean;
  rolledBackToCheckpoint: string;
  stepsReverted: string[];
  error?: string;
}

export class ExecutionController {
  private workflowId: string;
  private checkpoints: Map<string, ExecutionCheckpoint> = new Map();
  private state: ExecutionState;
  private pauseRequested: boolean = false;
  private stopRequested: boolean = false;

  constructor(workflowId: string) {
    this.workflowId = workflowId;
    this.state = {
      status: 'running',
      completedSteps: [],
      failedSteps: [],
      checkpoints: [],
      startedAt: new Date().toISOString(),
    };
  }

  /**
   * Create a checkpoint at the current execution state
   */
  createCheckpoint(
    completedStep: string,
    stepResults: Record<string, StepResult>,
    context: Record<string, any>,
    remainingSteps: string[]
  ): ExecutionCheckpoint {
    const checkpointId = this.generateCheckpointId();

    const checkpoint: ExecutionCheckpoint = {
      id: checkpointId,
      workflowId: this.workflowId,
      timestamp: new Date().toISOString(),
      completedStep,
      completedSteps: [...this.state.completedSteps, completedStep],
      stepResults: JSON.parse(JSON.stringify(stepResults)), // Deep clone
      context: JSON.parse(JSON.stringify(context)), // Deep clone
      remainingSteps: [...remainingSteps],
      metadata: {
        startedAt: this.state.startedAt,
        duration: Date.now() - new Date(this.state.startedAt).getTime(),
        stepCount: this.state.completedSteps.length + 1,
        errorCount: this.state.failedSteps.length,
      },
    };

    this.checkpoints.set(checkpointId, checkpoint);
    this.state.checkpoints.push(checkpoint);

    console.log(`[ExecutionController] Checkpoint created: ${checkpointId} after step ${completedStep}`);

    return checkpoint;
  }

  /**
   * Mark step as completed
   */
  markStepCompleted(stepId: string): void {
    if (!this.state.completedSteps.includes(stepId)) {
      this.state.completedSteps.push(stepId);
    }
    this.state.currentStep = undefined;
  }

  /**
   * Mark step as failed
   */
  markStepFailed(stepId: string): void {
    if (!this.state.failedSteps.includes(stepId)) {
      this.state.failedSteps.push(stepId);
    }
    this.state.currentStep = undefined;
    this.state.status = 'failed';
  }

  /**
   * Mark step as started
   */
  markStepStarted(stepId: string): void {
    this.state.currentStep = stepId;
  }

  /**
   * Request pause at next checkpoint
   */
  requestPause(): void {
    console.log('[ExecutionController] Pause requested');
    this.pauseRequested = true;
    this.state.status = 'paused';
  }

  /**
   * Resume execution from paused state
   */
  resume(): void {
    console.log('[ExecutionController] Resuming execution');
    this.pauseRequested = false;
    this.state.status = 'running';
  }

  /**
   * Request stop at next checkpoint
   */
  requestStop(): void {
    console.log('[ExecutionController] Stop requested');
    this.stopRequested = true;
  }

  /**
   * Check if pause was requested
   */
  isPauseRequested(): boolean {
    return this.pauseRequested;
  }

  /**
   * Check if stop was requested
   */
  isStopRequested(): boolean {
    return this.stopRequested;
  }

  /**
   * Check if execution should continue
   */
  shouldContinue(): boolean {
    return !this.pauseRequested && !this.stopRequested && this.state.status === 'running';
  }

  /**
   * Rollback to a specific checkpoint
   */
  async rollbackToCheckpoint(checkpointId: string): Promise<RollbackResult> {
    const checkpoint = this.checkpoints.get(checkpointId);

    if (!checkpoint) {
      return {
        success: false,
        rolledBackToCheckpoint: checkpointId,
        stepsReverted: [],
        error: `Checkpoint ${checkpointId} not found`,
      };
    }

    console.log(`[ExecutionController] Rolling back to checkpoint ${checkpointId}`);

    // Determine steps to revert (steps completed after this checkpoint)
    const stepsToRevert = this.state.completedSteps.filter(
      stepId => !checkpoint.completedSteps.includes(stepId)
    );

    // Clear state for reverted steps
    this.state.completedSteps = [...checkpoint.completedSteps];
    this.state.failedSteps = [];
    this.state.status = 'running';
    this.state.currentStep = undefined;

    // Remove checkpoints created after this one
    const checkpointsToKeep = this.state.checkpoints.filter(
      cp => new Date(cp.timestamp) <= new Date(checkpoint.timestamp)
    );
    this.state.checkpoints = checkpointsToKeep;

    // Rebuild checkpoints map
    this.checkpoints.clear();
    for (const cp of checkpointsToKeep) {
      this.checkpoints.set(cp.id, cp);
    }

    console.log(
      `[ExecutionController] Rolled back ${stepsToRevert.length} steps: ${stepsToRevert.join(', ')}`
    );

    return {
      success: true,
      rolledBackToCheckpoint: checkpointId,
      stepsReverted,
    };
  }

  /**
   * Rollback to last successful checkpoint
   */
  async rollbackToLastCheckpoint(): Promise<RollbackResult> {
    if (this.state.checkpoints.length === 0) {
      return {
        success: false,
        rolledBackToCheckpoint: '',
        stepsReverted: [],
        error: 'No checkpoints available',
      };
    }

    const lastCheckpoint = this.state.checkpoints[this.state.checkpoints.length - 1];
    return this.rollbackToCheckpoint(lastCheckpoint.id);
  }

  /**
   * Rollback N checkpoints back
   */
  async rollbackSteps(count: number): Promise<RollbackResult> {
    if (count <= 0) {
      return {
        success: false,
        rolledBackToCheckpoint: '',
        stepsReverted: [],
        error: 'Count must be positive',
      };
    }

    if (this.state.checkpoints.length === 0) {
      return {
        success: false,
        rolledBackToCheckpoint: '',
        stepsReverted: [],
        error: 'No checkpoints available',
      };
    }

    const targetIndex = Math.max(0, this.state.checkpoints.length - count);
    const targetCheckpoint = this.state.checkpoints[targetIndex];

    return this.rollbackToCheckpoint(targetCheckpoint.id);
  }

  /**
   * Get checkpoint by ID
   */
  getCheckpoint(checkpointId: string): ExecutionCheckpoint | undefined {
    return this.checkpoints.get(checkpointId);
  }

  /**
   * Get all checkpoints
   */
  getAllCheckpoints(): ExecutionCheckpoint[] {
    return this.state.checkpoints;
  }

  /**
   * Get latest checkpoint
   */
  getLatestCheckpoint(): ExecutionCheckpoint | undefined {
    if (this.state.checkpoints.length === 0) {
      return undefined;
    }
    return this.state.checkpoints[this.state.checkpoints.length - 1];
  }

  /**
   * Get current execution state
   */
  getState(): ExecutionState {
    return {
      ...this.state,
      duration: this.state.endedAt
        ? new Date(this.state.endedAt).getTime() - new Date(this.state.startedAt).getTime()
        : Date.now() - new Date(this.state.startedAt).getTime(),
    };
  }

  /**
   * Mark execution as completed
   */
  markCompleted(): void {
    this.state.status = 'completed';
    this.state.endedAt = new Date().toISOString();
    this.state.duration = new Date(this.state.endedAt).getTime() - new Date(this.state.startedAt).getTime();

    console.log(
      `[ExecutionController] Execution completed: ${this.state.completedSteps.length} steps in ${this.state.duration}ms`
    );
  }

  /**
   * Mark execution as failed
   */
  markFailed(error?: string): void {
    this.state.status = 'failed';
    this.state.endedAt = new Date().toISOString();
    this.state.duration = new Date(this.state.endedAt).getTime() - new Date(this.state.startedAt).getTime();

    console.error(`[ExecutionController] Execution failed: ${error || 'Unknown error'}`);
  }

  /**
   * Generate unique checkpoint ID
   */
  private generateCheckpointId(): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 9);
    return `checkpoint_${timestamp}_${random}`;
  }

  /**
   * Export execution state for persistence
   */
  exportState(): string {
    return JSON.stringify({
      workflowId: this.workflowId,
      state: this.state,
      checkpoints: Array.from(this.checkpoints.entries()),
    });
  }

  /**
   * Import execution state from persistence
   */
  static importState(serialized: string): ExecutionController {
    const data = JSON.parse(serialized);
    const controller = new ExecutionController(data.workflowId);

    controller.state = data.state;
    controller.checkpoints = new Map(data.checkpoints);

    return controller;
  }

  /**
   * Get execution summary
   */
  getSummary(): {
    workflowId: string;
    status: string;
    completedSteps: number;
    failedSteps: number;
    checkpoints: number;
    duration: number;
    currentStep?: string;
  } {
    return {
      workflowId: this.workflowId,
      status: this.state.status,
      completedSteps: this.state.completedSteps.length,
      failedSteps: this.state.failedSteps.length,
      checkpoints: this.state.checkpoints.length,
      duration: this.state.duration || Date.now() - new Date(this.state.startedAt).getTime(),
      currentStep: this.state.currentStep,
    };
  }

  /**
   * Clear all checkpoints (free memory for very long workflows)
   */
  clearOldCheckpoints(keepLast: number = 5): void {
    if (this.state.checkpoints.length <= keepLast) {
      return;
    }

    const checkpointsToKeep = this.state.checkpoints.slice(-keepLast);
    const checkpointsToRemove = this.state.checkpoints.slice(0, -keepLast);

    // Remove from map
    for (const cp of checkpointsToRemove) {
      this.checkpoints.delete(cp.id);
    }

    // Update state
    this.state.checkpoints = checkpointsToKeep;

    console.log(
      `[ExecutionController] Cleared ${checkpointsToRemove.length} old checkpoints, keeping ${keepLast}`
    );
  }

  /**
   * Check if can rollback to a specific step
   */
  canRollbackToStep(stepId: string): boolean {
    return this.state.checkpoints.some(cp => cp.completedStep === stepId);
  }

  /**
   * Get checkpoint for specific step
   */
  getCheckpointForStep(stepId: string): ExecutionCheckpoint | undefined {
    return this.state.checkpoints.find(cp => cp.completedStep === stepId);
  }
}
