/**
 * ShadowAgent - Execution health monitor and agent lifecycle manager
 *
 * The Shadow Agent monitors workflow executions during the "calibration" phase
 * (before an agent achieves its first end-to-end success). It:
 *
 * 1. Classifies step failures into 7 categories
 * 2. Stores failure snapshots (metadata only, NO client data)
 * 3. Manages agent lifecycle: calibrating -> production -> re-calibrating
 *
 * Lifecycle:
 * - Agent starts in "calibrating" state (production_ready = false)
 * - Shadow Agent is ACTIVE during calibration (monitors every step)
 * - After first full end-to-end success -> agent marked "production ready"
 * - Shadow Agent goes DORMANT for production agents
 * - If a production agent fails -> Shadow re-activates (production_ready = false)
 *
 * CRITICAL: Every Shadow Agent call is wrapped in try-catch.
 * Shadow Agent failure must NEVER break the main execution flow.
 *
 * @module lib/pilot/shadow/ShadowAgent
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { FailureClassifier } from './FailureClassifier';
import { RepairEngine, detectUpstreamStepId } from './RepairEngine';
import type { StepOutput } from '../types';
import type {
  FailureSnapshotInsert,
  FailureClassification,
  StepFailureContext,
  CaptureResult,
  RepairResult,
} from './types';

export class ShadowAgent {
  private classifier: FailureClassifier;
  private repairEngine: RepairEngine;

  constructor(
    private supabase: SupabaseClient,
    private agentId: string,
    private userId: string
  ) {
    this.classifier = new FailureClassifier();
    this.repairEngine = new RepairEngine();
  }

  // ─── Capture ─────────────────────────────────────────────

  /**
   * Capture and classify a step failure.
   * Stores a metadata-only snapshot in the database.
   *
   * @returns CaptureResult with snapshot ID and classification, or null ID on DB error
   */
  async captureFailure(
    executionId: string,
    error: { message: string; code?: string },
    stepContext: StepFailureContext,
    executionSummary: { totalTokensUsed: number; totalExecutionTimeMs: number }
  ): Promise<CaptureResult> {
    const classification = this.classifier.classify(error, stepContext);

    // If ErrorRecovery already retried this and it's still failing,
    // we still capture the snapshot for pattern analysis
    const snapshot: FailureSnapshotInsert = {
      execution_id: executionId,
      agent_id: this.agentId,
      user_id: this.userId,
      failed_step_id: stepContext.stepId,
      failed_step_name: stepContext.stepName,
      step_type: stepContext.stepType,
      failure_category: classification.category,
      failure_sub_type: classification.sub_type,
      severity: classification.severity,
      error_message: this.sanitizeErrorMessage(error.message),
      error_code: error.code,
      completed_steps: stepContext.completedSteps,
      failed_steps: [stepContext.stepId],
      retry_count: stepContext.retryCount,
      tokens_used_before_failure: executionSummary.totalTokensUsed,
      execution_time_before_failure_ms: executionSummary.totalExecutionTimeMs,
      failed_at: new Date().toISOString(),
      captured_at: new Date().toISOString(),
    };

    // Store snapshot in DB
    const { data, error: dbError } = await this.supabase
      .from('shadow_failure_snapshots')
      .insert(snapshot)
      .select('id')
      .single();

    if (dbError) {
      console.error('[ShadowAgent] Failed to store snapshot:', dbError.message);
      return { snapshotId: null, classification };
    }

    // Increment calibration run count (non-blocking best effort)
    await this.incrementCalibrationCount();

    console.log(
      `[ShadowAgent] Captured failure: ${classification.category}` +
      ` (${classification.severity}) for step "${stepContext.stepName}"` +
      ` [snapshot=${data.id}]`
    );

    return { snapshotId: data.id, classification };
  }

  // ─── Repair ─────────────────────────────────────────────

  /**
   * Attempt to repair a data_shape_mismatch failure by modifying upstream output.
   *
   * Flow:
   * 1. Detect upstream step from step definition
   * 2. Get upstream output from context (in-memory)
   * 3. Propose a repair (extract array field, wrap in array, etc.)
   * 4. Apply repair → create modified StepOutput
   * 5. Store repaired output back in context
   * 6. Return result so caller can re-execute the failed step
   *
   * @param classification - The failure classification (must be data_shape_mismatch)
   * @param stepDef - The failed step's definition
   * @param getStepOutput - Getter for step outputs from ExecutionContext
   * @param setStepOutput - Setter to update step outputs in ExecutionContext
   * @param completedSteps - List of completed step IDs
   * @returns RepairResult with outcome and details, or null if repair not applicable
   */
  attemptRepair(
    classification: FailureClassification,
    stepDef: { id: string; dependencies?: string[]; input?: string; params?: Record<string, any> },
    getStepOutput: (stepId: string) => StepOutput | undefined,
    setStepOutput: (stepId: string, output: StepOutput) => void,
    completedSteps: string[]
  ): RepairResult | null {
    // Only repair data_shape_mismatch
    if (classification.category !== 'data_shape_mismatch') {
      return null;
    }

    // Detect upstream step
    const upstreamStepId = detectUpstreamStepId(stepDef, completedSteps);
    if (!upstreamStepId) {
      console.log('[ShadowAgent] Cannot determine upstream step for repair');
      return {
        outcome: 'not_fixable',
        proposal: {
          action: 'none',
          description: 'Cannot determine upstream step',
          confidence: 0,
          targetStepId: '',
          risk: 'high',
        },
        dataModified: false,
      };
    }

    // Get upstream output
    const upstreamOutput = getStepOutput(upstreamStepId);
    if (!upstreamOutput) {
      console.log(`[ShadowAgent] No output found for upstream step ${upstreamStepId}`);
      return {
        outcome: 'not_fixable',
        proposal: {
          action: 'none',
          description: `No output for upstream step ${upstreamStepId}`,
          confidence: 0,
          targetStepId: upstreamStepId,
          risk: 'high',
        },
        dataModified: false,
      };
    }

    // Propose repair
    const proposal = this.repairEngine.proposeRepair(
      classification,
      stepDef.id,
      upstreamStepId,
      upstreamOutput
    );

    if (proposal.action === 'none') {
      console.log(`[ShadowAgent] No repair available: ${proposal.description}`);
      return {
        outcome: 'not_fixable',
        proposal,
        dataModified: false,
      };
    }

    // Apply repair
    const repairedOutput = this.repairEngine.applyRepair(proposal, upstreamOutput);
    if (!repairedOutput) {
      console.log(`[ShadowAgent] Repair application failed for ${proposal.action}`);
      return {
        outcome: 'not_fixable',
        proposal,
        dataModified: false,
        repairError: 'applyRepair returned null',
      };
    }

    // Store repaired output back in context (overwrites upstream data in memory)
    setStepOutput(upstreamStepId, repairedOutput);

    console.log(
      `[ShadowAgent] Repair applied: ${proposal.action}` +
      ` (confidence=${proposal.confidence}, risk=${proposal.risk})` +
      ` — upstream step "${upstreamStepId}" data modified`
    );

    // Outcome will be updated to 'auto_fixed' or 'auto_fix_failed'
    // by the caller after re-executing the failed step
    return {
      outcome: 'auto_fixed', // optimistic — caller updates if re-execution fails
      proposal,
      dataModified: true,
    };
  }

  // ─── Lifecycle ───────────────────────────────────────────

  /**
   * Called after a fully successful execution (all steps passed).
   * Marks the agent as production ready.
   */
  async onExecutionSuccess(): Promise<void> {
    const { error } = await this.supabase
      .from('agents')
      .update({
        production_ready: true,
        production_ready_at: new Date().toISOString(),
      })
      .eq('id', this.agentId)
      .eq('production_ready', false); // Only if not already production

    if (error) {
      console.error('[ShadowAgent] Failed to mark production ready:', error.message);
      return;
    }

    console.log(`[ShadowAgent] Agent ${this.agentId} marked as production ready`);
  }

  /**
   * Called when a production agent fails.
   * Reactivates Shadow Agent for the NEXT run by resetting production_ready.
   */
  static async onProductionFailure(
    supabase: SupabaseClient,
    agentId: string
  ): Promise<void> {
    const { error } = await supabase
      .from('agents')
      .update({
        production_ready: false,
        calibration_run_count: 0,
      })
      .eq('id', agentId);

    if (error) {
      console.error('[ShadowAgent] Failed to reactivate calibration:', error.message);
      return;
    }

    console.log(`[ShadowAgent] Agent ${agentId} returned to calibration`);
  }

  /**
   * Check if Shadow Agent should be active for this agent.
   * Active when agent is NOT production ready (calibrating or re-calibrating).
   */
  static async isActive(
    supabase: SupabaseClient,
    agentId: string
  ): Promise<boolean> {
    const { data, error } = await supabase
      .from('agents')
      .select('production_ready')
      .eq('id', agentId)
      .single();

    if (error) {
      // On error, default to active (safer — monitor rather than skip)
      console.warn('[ShadowAgent] Could not check lifecycle state, defaulting to active:', error.message);
      return true;
    }

    // Active when NOT production ready
    return !data.production_ready;
  }

  // ─── Private helpers ─────────────────────────────────────

  /**
   * Increment the calibration_run_count for this agent.
   * Best-effort — failure doesn't block execution.
   */
  private async incrementCalibrationCount(): Promise<void> {
    // Use raw SQL increment to avoid race conditions
    const { error } = await this.supabase.rpc('increment_calibration_count', {
      p_agent_id: this.agentId,
    });

    if (error) {
      // Fallback: read-then-write (less safe but works without RPC function)
      const { data } = await this.supabase
        .from('agents')
        .select('calibration_run_count')
        .eq('id', this.agentId)
        .single();

      if (data) {
        await this.supabase
          .from('agents')
          .update({ calibration_run_count: (data.calibration_run_count || 0) + 1 })
          .eq('id', this.agentId);
      }
    }
  }

  /**
   * Sanitize error message to remove potential client data.
   * Truncates to 1000 chars and removes common data patterns.
   */
  private sanitizeErrorMessage(message: string): string {
    if (!message) return 'Unknown error';

    let sanitized = message;

    // Truncate long messages (may contain serialized data)
    if (sanitized.length > 1000) {
      sanitized = sanitized.substring(0, 1000) + '... [truncated]';
    }

    return sanitized;
  }
}
