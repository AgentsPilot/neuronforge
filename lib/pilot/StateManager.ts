/**
 * StateManager - Persist execution state to database
 *
 * Responsibilities:
 * - Create workflow_executions record at start
 * - Checkpoint after each step
 * - Support pause/resume
 * - Store sanitized execution trace (metadata only)
 *
 * @module lib/orchestrator/StateManager
 */

import { SupabaseClient } from '@supabase/supabase-js';
import type {
  ExecutionPlan,
  ExecutionContext,
  WorkflowExecutionRecord,
  Agent,
} from './types';

export class StateManager {
  private supabase: SupabaseClient;

  constructor(supabase: SupabaseClient) {
    this.supabase = supabase;
  }

  /**
   * Create new workflow execution record
   */
  async createExecution(
    agent: Agent,
    userId: string,
    sessionId: string,
    executionPlan: ExecutionPlan,
    inputValues: Record<string, any>
  ): Promise<string> {
    const { data, error } = await this.supabase
      .from('workflow_executions')
      .insert({
        agent_id: agent.id,
        user_id: userId,
        session_id: sessionId,
        status: 'running',
        total_steps: executionPlan.totalSteps,
        execution_plan: {
          steps: executionPlan.steps.map(s => ({
            stepId: s.stepId,
            name: s.stepDefinition.name,
            type: s.stepDefinition.type,
            dependencies: s.dependencies,
            level: s.level,
            canRunInParallel: s.canRunInParallel,
            parallelGroupId: s.parallelGroupId,
          })),
          parallelGroups: executionPlan.parallelGroups,
          totalSteps: executionPlan.totalSteps,
          estimatedDuration: executionPlan.estimatedDuration,
        },
        input_values: inputValues,
        started_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error) {
      console.error('[StateManager] Failed to create execution:', error);
      throw new Error(`Failed to create workflow execution: ${error.message}`);
    }

    console.log(`[StateManager] Created execution record: ${data.id}`);
    return data.id;
  }

  /**
   * Checkpoint execution state after each step
   */
  async checkpoint(context: ExecutionContext): Promise<void> {
    const summary = context.getSummary();
    const executionTrace = context.getExecutionTrace();

    try {
      const { error } = await this.supabase
        .from('workflow_executions')
        .update({
          status: summary.status,
          current_step: summary.currentStep,
          completed_steps_count: summary.stepCount.completed,
          failed_steps_count: summary.stepCount.failed,
          skipped_steps_count: summary.stepCount.skipped,
          execution_trace: executionTrace,
          total_tokens_used: summary.totalTokensUsed,
          total_execution_time_ms: summary.totalExecutionTime,
          updated_at: new Date().toISOString(),
        })
        .eq('id', context.executionId);

      if (error) {
        console.error('[StateManager] Checkpoint failed:', error);
        // Don't throw - checkpoint failures should not stop execution
      } else {
        console.log(`[StateManager] Checkpointed execution: ${context.executionId}`);
      }
    } catch (err) {
      console.error('[StateManager] Checkpoint error:', err);
      // Don't throw - checkpoint failures should not stop execution
    }
  }

  /**
   * Mark execution as completed
   */
  async completeExecution(
    executionId: string,
    finalOutput: any,
    context: ExecutionContext
  ): Promise<void> {
    const summary = context.getSummary();
    const executionTrace = context.getExecutionTrace();

    const { error } = await this.supabase
      .from('workflow_executions')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        final_output: finalOutput,
        completed_steps_count: summary.stepCount.completed,
        failed_steps_count: summary.stepCount.failed,
        skipped_steps_count: summary.stepCount.skipped,
        execution_trace: executionTrace,
        total_tokens_used: summary.totalTokensUsed,
        total_execution_time_ms: summary.totalExecutionTime,
        updated_at: new Date().toISOString(),
      })
      .eq('id', executionId);

    if (error) {
      console.error('[StateManager] Failed to mark execution as completed:', error);
      throw error;
    }

    console.log(`[StateManager] Marked execution as completed: ${executionId}`);
  }

  /**
   * Mark execution as failed
   */
  async failExecution(
    executionId: string,
    error: Error,
    context: ExecutionContext
  ): Promise<void> {
    const summary = context.getSummary();
    const executionTrace = context.getExecutionTrace();

    const { error: dbError } = await this.supabase
      .from('workflow_executions')
      .update({
        status: 'failed',
        error_message: error.message,
        error_stack: error.stack,
        failed_at: new Date().toISOString(),
        completed_steps_count: summary.stepCount.completed,
        failed_steps_count: summary.stepCount.failed,
        skipped_steps_count: summary.stepCount.skipped,
        execution_trace: executionTrace,
        total_tokens_used: summary.totalTokensUsed,
        total_execution_time_ms: summary.totalExecutionTime,
        updated_at: new Date().toISOString(),
      })
      .eq('id', executionId);

    if (dbError) {
      console.error('[StateManager] Failed to mark execution as failed:', dbError);
      // Don't throw - we're already handling an error
    } else {
      console.log(`[StateManager] Marked execution as failed: ${executionId}`);
    }
  }

  /**
   * Pause execution
   */
  async pauseExecution(executionId: string, context: ExecutionContext): Promise<void> {
    const summary = context.getSummary();
    const executionTrace = context.getExecutionTrace();

    const { error } = await this.supabase
      .from('workflow_executions')
      .update({
        status: 'paused',
        paused_at: new Date().toISOString(),
        current_step: summary.currentStep,
        completed_steps_count: summary.stepCount.completed,
        failed_steps_count: summary.stepCount.failed,
        skipped_steps_count: summary.stepCount.skipped,
        execution_trace: executionTrace,
        total_tokens_used: summary.totalTokensUsed,
        total_execution_time_ms: summary.totalExecutionTime,
        updated_at: new Date().toISOString(),
      })
      .eq('id', executionId);

    if (error) {
      console.error('[StateManager] Failed to pause execution:', error);
      throw error;
    }

    console.log(`[StateManager] Paused execution: ${executionId}`);
  }

  /**
   * Resume execution (restore context from checkpoint)
   */
  async resumeExecution(executionId: string): Promise<{
    context: ExecutionContext;
    agent: Agent;
  }> {
    const { data, error } = await this.supabase
      .from('workflow_executions')
      .select('*')
      .eq('id', executionId)
      .single();

    if (error || !data) {
      throw new Error(`Failed to fetch execution ${executionId}: ${error?.message}`);
    }

    if (data.status !== 'paused') {
      throw new Error(`Execution ${executionId} is not paused (status: ${data.status})`);
    }

    // Fetch agent
    const { data: agent, error: agentError } = await this.supabase
      .from('agents')
      .select('*')
      .eq('id', data.agent_id)
      .single();

    if (agentError || !agent) {
      throw new Error(`Failed to fetch agent ${data.agent_id}: ${agentError?.message}`);
    }

    // Reconstruct ExecutionContext from checkpoint
    const context = new ExecutionContext(
      data.id,
      agent,
      data.user_id,
      data.session_id,
      data.input_values || {}
    );

    // Restore state
    context.status = 'running';  // Resume to running
    context.currentStep = data.current_step;
    context.completedSteps = data.execution_trace?.completedSteps || [];
    context.failedSteps = data.execution_trace?.failedSteps || [];
    context.skippedSteps = data.execution_trace?.skippedSteps || [];
    context.totalTokensUsed = data.total_tokens_used || 0;
    context.totalExecutionTime = data.total_execution_time_ms || 0;
    context.startedAt = new Date(data.started_at);

    // Note: Actual step output data is NOT restored (ephemeral)
    // Only metadata is available from execution_trace
    // Workflow will need to re-execute from current checkpoint or skip completed steps

    // Update resumed_at timestamp
    await this.supabase
      .from('workflow_executions')
      .update({
        status: 'running',
        resumed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', executionId);

    console.log(`[StateManager] Resumed execution: ${executionId}`);

    return { context, agent };
  }

  /**
   * Cancel execution
   */
  async cancelExecution(executionId: string, context?: ExecutionContext): Promise<void> {
    const updateData: any = {
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (context) {
      const summary = context.getSummary();
      const executionTrace = context.getExecutionTrace();

      updateData.completed_steps_count = summary.stepCount.completed;
      updateData.failed_steps_count = summary.stepCount.failed;
      updateData.skipped_steps_count = summary.stepCount.skipped;
      updateData.execution_trace = executionTrace;
      updateData.total_tokens_used = summary.totalTokensUsed;
      updateData.total_execution_time_ms = summary.totalExecutionTime;
    }

    const { error } = await this.supabase
      .from('workflow_executions')
      .update(updateData)
      .eq('id', executionId);

    if (error) {
      console.error('[StateManager] Failed to cancel execution:', error);
      throw error;
    }

    console.log(`[StateManager] Cancelled execution: ${executionId}`);
  }

  /**
   * Get execution status
   */
  async getExecutionStatus(executionId: string): Promise<WorkflowExecutionRecord | null> {
    const { data, error } = await this.supabase
      .from('workflow_executions')
      .select('*')
      .eq('id', executionId)
      .single();

    if (error) {
      console.error('[StateManager] Failed to fetch execution status:', error);
      return null;
    }

    return data as WorkflowExecutionRecord;
  }

  /**
   * Get active executions for user
   */
  async getActiveExecutions(userId: string): Promise<WorkflowExecutionRecord[]> {
    const { data, error } = await this.supabase
      .from('workflow_executions')
      .select('*')
      .eq('user_id', userId)
      .in('status', ['running', 'paused'])
      .order('started_at', { ascending: false });

    if (error) {
      console.error('[StateManager] Failed to fetch active executions:', error);
      return [];
    }

    return (data as WorkflowExecutionRecord[]) || [];
  }

  /**
   * Get execution history for agent
   */
  async getExecutionHistory(
    agentId: string,
    limit: number = 10
  ): Promise<WorkflowExecutionRecord[]> {
    const { data, error } = await this.supabase
      .from('workflow_executions')
      .select('*')
      .eq('agent_id', agentId)
      .order('started_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('[StateManager] Failed to fetch execution history:', error);
      return [];
    }

    return (data as WorkflowExecutionRecord[]) || [];
  }

  /**
   * Log step execution (detailed step-level logging)
   */
  async logStepExecution(
    workflowExecutionId: string,
    stepId: string,
    stepName: string,
    stepType: string,
    status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped',
    metadata?: any
  ): Promise<void> {
    try {
      // Map step types to database-allowed values
      // Database constraint only allows: action, llm_decision, conditional, loop, transform, delay, parallel_group
      const normalizedStepType = this.normalizeStepType(stepType);

      const { error } = await this.supabase
        .from('workflow_step_executions')
        .insert({
          workflow_execution_id: workflowExecutionId,
          step_id: stepId,
          step_name: stepName,
          step_type: normalizedStepType,
          status,
          execution_metadata: metadata || {},
          created_at: new Date().toISOString(),
        });

      if (error) {
        console.error('[StateManager] Failed to log step execution:', error);
        // Don't throw - step logging failures should not stop execution
      }
    } catch (err) {
      console.error('[StateManager] Step logging error:', err);
      // Don't throw
    }
  }

  /**
   * Normalize step type to match database CHECK constraint
   * Database only allows: action, llm_decision, conditional, loop, transform, delay, parallel_group
   */
  private normalizeStepType(stepType: string): string {
    // Map TypeScript types to database-allowed values
    const typeMapping: Record<string, string> = {
      'ai_processing': 'llm_decision',        // Smart Agent Builder uses ai_processing
      'switch': 'conditional',                 // Phase 2: map switch to conditional
      'validation': 'transform',               // Phase 4: map validation to transform
      'enrichment': 'transform',               // Phase 4: map enrichment to transform
      'comparison': 'transform',               // Phase 4: map comparison to transform
      'sub_workflow': 'action',                // Phase 5: map sub_workflow to action
      'human_approval': 'action',              // Phase 6: map human_approval to action
      'scatter_gather': 'parallel_group',      // Phase 3: map scatter_gather to parallel_group
    };

    return typeMapping[stepType] || stepType;
  }

  /**
   * Update step execution status
   */
  async updateStepExecution(
    workflowExecutionId: string,
    stepId: string,
    status: 'completed' | 'failed' | 'skipped',
    metadata?: any,
    errorMessage?: string
  ): Promise<void> {
    try {
      const updateData: any = {
        status,
        execution_metadata: metadata || {},
      };

      if (status === 'completed') {
        updateData.completed_at = new Date().toISOString();
      } else if (status === 'failed') {
        updateData.failed_at = new Date().toISOString();
        updateData.error_message = errorMessage;
      }

      const { error } = await this.supabase
        .from('workflow_step_executions')
        .update(updateData)
        .eq('workflow_execution_id', workflowExecutionId)
        .eq('step_id', stepId);

      if (error) {
        console.error('[StateManager] Failed to update step execution:', error);
        // Don't throw
      }
    } catch (err) {
      console.error('[StateManager] Step update error:', err);
      // Don't throw
    }
  }

  /**
   * Clean up old executions (data retention)
   */
  async cleanupOldExecutions(retentionDays: number = 90): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

    const { error, count } = await this.supabase
      .from('workflow_executions')
      .delete()
      .in('status', ['completed', 'cancelled'])
      .lt('created_at', cutoffDate.toISOString());

    if (error) {
      console.error('[StateManager] Cleanup failed:', error);
      throw error;
    }

    console.log(`[StateManager] Cleaned up ${count || 0} old executions`);
    return count || 0;
  }
}

// Re-export ExecutionContext for convenience
export { ExecutionContext } from './ExecutionContext';
