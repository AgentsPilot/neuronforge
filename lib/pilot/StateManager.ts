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

import { SupabaseClient, createClient } from '@supabase/supabase-js';
import type {
  ExecutionPlan,
  WorkflowExecutionRecord,
  Agent,
} from './types';
import { ExecutionContext } from './ExecutionContext';
import { SystemConfigService } from '@/lib/services/SystemConfigService';
import { ExecutionService } from '@/lib/services/ExecutionService';
import { ExecutionResultsBuilder } from './ExecutionResultsBuilder';
import { MetricsCollector } from './MetricsCollector';
import { SLAEvaluator } from '@/lib/services/SLAEvaluator';
import { createLogger } from '@/lib/logger';

// Create admin client inline to avoid module initialization issues
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

const logger = createLogger({ module: 'StateManager', service: 'workflow-pilot' });

export class StateManager {
  private supabase: SupabaseClient;
  private progressTrackingEnabled: boolean;
  private realTimeUpdatesEnabled: boolean;
  private realTimeChannel: any | null = null;

  constructor(
    supabase: SupabaseClient,
    progressTrackingEnabled: boolean = true,
    realTimeUpdatesEnabled: boolean = false
  ) {
    this.supabase = supabase;
    this.progressTrackingEnabled = progressTrackingEnabled;
    this.realTimeUpdatesEnabled = realTimeUpdatesEnabled;
  }

  /**
   * Setup real-time broadcasting channel for execution updates
   * @private
   */
  private setupRealTimeChannel(executionId: string): void {
    if (!this.realTimeUpdatesEnabled) {
      return;
    }

    try {
      // Create a broadcast channel for this execution
      this.realTimeChannel = this.supabase.channel(`workflow:${executionId}`, {
        config: {
          broadcast: { self: true },
        },
      });

      // Subscribe to the channel
      this.realTimeChannel.subscribe((status: string) => {
        if (status === 'SUBSCRIBED') {
          logger.debug({ executionId }, 'Real-time channel subscribed for execution');
        }
      });
    } catch (error) {
      logger.error({ err: error }, 'Failed to setup real-time channel');
      // Don't fail execution if real-time setup fails
    }
  }

  /**
   * Broadcast progress update via real-time channel
   * @private
   */
  private async broadcastProgress(executionId: string, update: any): Promise<void> {
    if (!this.realTimeUpdatesEnabled || !this.realTimeChannel) {
      return;
    }

    try {
      await this.realTimeChannel.send({
        type: 'broadcast',
        event: 'workflow:progress',
        payload: {
          execution_id: executionId,
          timestamp: new Date().toISOString(),
          ...update,
        },
      });
      logger.debug({ executionId }, 'Broadcasted progress update for execution');
    } catch (error) {
      logger.error({ err: error }, 'Failed to broadcast progress');
      // Don't fail execution if broadcast fails
    }
  }

  /**
   * Cleanup real-time channel
   * @private
   */
  private async cleanupRealTimeChannel(): Promise<void> {
    if (this.realTimeChannel) {
      try {
        await this.supabase.removeChannel(this.realTimeChannel);
        this.realTimeChannel = null;
        logger.debug('Real-time channel cleaned up');
      } catch (error) {
        logger.error({ err: error }, 'Failed to cleanup real-time channel');
      }
    }
  }

  /**
   * Create new workflow execution record
   */
  async createExecution(
    agent: Agent,
    userId: string,
    sessionId: string,
    executionPlan: ExecutionPlan,
    inputValues: Record<string, any>,
    providedExecutionId?: string,
    runMode?: 'calibration' | 'production'  // Separate from execution_type (manual/scheduled)
  ): Promise<string> {
    // Check execution quota before creating the execution.
    // P0-FT-RLS (SA RC9-8): `this.supabase` is whatever the caller passed —
    // usually the *user-cookie* client (run-agent, run-agent-sandbox, calibrate).
    // `user_subscriptions` no longer accepts writes from `anon`/`authenticated`
    // (supabase/migrations/20261001_user_subscriptions_write_lockdown.sql), so only
    // ExecutionService methods that read, or that write through the SECURITY
    // DEFINER `increment_executions_used` RPC (recordExecution), may be called
    // here. Never call the quota-writing methods (applyExecutionQuotaBasedOnTokens,
    // updateExecutionQuota) from this instance — they issue a plain UPDATE and
    // would fail 42501.
    const executionService = new ExecutionService(this.supabase);

    try {
      const { available, quota } = await executionService.checkExecutionAvailable(userId);

      if (!available) {
        const quotaDisplay = quota.quota === null ? 'unlimited' : quota.quota.toLocaleString();
        throw new Error(
          `You've reached your execution limit (${quota.used.toLocaleString()} of ${quotaDisplay} runs used). Upgrade your plan to continue running agents.`
        );
      }

      // Log quota status
      const remaining = quota.remaining === null ? '∞' : quota.remaining.toLocaleString();
      logger.debug({ used: quota.used, quota: quota.quota ?? '∞', remaining }, 'Execution quota check');

      if (quota.isNearLimit) {
        logger.warn({ userId, percentageUsed: Number((quota.percentageUsed * 100).toFixed(1)) }, 'User is near execution limit');
      }
    } catch (error: any) {
      logger.error({ err: error }, 'Execution quota check failed');
      throw error;
    }

    const insertPayload: Record<string, any> = {
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
      run_mode: runMode || 'production', // Default to production for backward compatibility
    };

    // Use frontend-provided execution ID if available (for calibration polling)
    if (providedExecutionId) {
      insertPayload.id = providedExecutionId;
      logger.debug({ providedExecutionId }, 'Using frontend-provided execution ID');
    }

    logger.debug({
      agent_id: agent.id,
      user_id: userId,
      run_mode: insertPayload.run_mode,
      has_custom_id: !!providedExecutionId,
      total_steps: insertPayload.total_steps
    }, 'Attempting to insert execution record with payload');

    const { data, error } = await supabaseAdmin
      .from('workflow_executions')
      .insert(insertPayload)
      .select('id')
      .single();

    if (error) {
      logger.error({
        err: error,
        providedExecutionId,
        payload: {
          agent_id: agent.id,
          user_id: userId,
          run_mode: insertPayload.run_mode
        }
      }, 'Failed to create execution');
      throw new Error(`Failed to create workflow execution: ${error.message}`);
    }

    logger.info({ dataId: data.id }, 'Created execution record');

    // Record the execution to increment quota usage
    try {
      await executionService.recordExecution(userId);
      logger.info({ userId }, 'Recorded execution usage for user');
    } catch (error: any) {
      logger.error({ err: error }, 'Failed to record execution usage (non-critical)');
      // Don't fail the execution if quota recording fails - it's already started
    }

    // Setup real-time channel if enabled
    this.setupRealTimeChannel(data.id);

    // Broadcast initial status
    await this.broadcastProgress(data.id, {
      status: 'running',
      total_steps: executionPlan.totalSteps,
      completed_steps: 0,
    });

    return data.id;
  }

  /**
   * Checkpoint execution state after each step
   */
  async checkpoint(context: ExecutionContext): Promise<void> {
    // Skip checkpointing if progress tracking is disabled
    if (!this.progressTrackingEnabled) {
      logger.debug('Progress tracking disabled, skipping checkpoint');
      return;
    }

    const summary = context.getSummary();
    const executionTrace = context.getExecutionTrace();

    try {
      // CRITICAL: Preserve cached_outputs from database before updating execution_trace
      // ExecutionOutputCache writes directly to DB, but we have in-memory executionTrace
      logger.debug('Reading current execution_trace to preserve cached_outputs...');
      const { data: currentExecution } = await supabaseAdmin
        .from('workflow_executions')
        .select('execution_trace')
        .eq('id', context.executionId)
        .single();

      const currentTrace = currentExecution?.execution_trace || {};
      const cachedOutputs = currentTrace.cached_outputs || {};
      const cachedCount = Object.keys(cachedOutputs).length;

      logger.debug({ cachedCount }, 'Found cached outputs to preserve in checkpoint');

      // Merge cached_outputs from database into the trace we're about to save
      const mergedTrace = {
        ...executionTrace,
        cached_outputs: cachedOutputs, // ← PRESERVE cached outputs!
      };

      // Use supabaseAdmin to bypass RLS policies
      const { error } = await supabaseAdmin
        .from('workflow_executions')
        .update({
          status: summary.status,
          current_step: summary.currentStep,
          completed_steps_count: summary.stepCount.completed,
          failed_steps_count: summary.stepCount.failed,
          skipped_steps_count: summary.stepCount.skipped,
          execution_trace: mergedTrace, // ← Use merged trace with cached_outputs!
          total_tokens_used: summary.totalTokensUsed,
          total_execution_time_ms: summary.totalExecutionTime,
          updated_at: new Date().toISOString(),
        })
        .eq('id', context.executionId);

      if (error) {
        logger.error({ err: error }, 'Checkpoint failed');
        // Don't throw - checkpoint failures should not stop execution
      } else {
        logger.debug({ executionId: context.executionId }, 'Checkpointed execution');

        // Broadcast progress update if real-time updates enabled
        await this.broadcastProgress(context.executionId, {
          status: summary.status,
          current_step: summary.currentStep,
          completed_steps: summary.stepCount.completed,
          failed_steps: summary.stepCount.failed,
          skipped_steps: summary.stepCount.skipped,
          total_steps: summary.stepCount.total,
          total_tokens_used: summary.totalTokensUsed,
          total_execution_time: summary.totalExecutionTime,
        });
      }
    } catch (err) {
      logger.error({ err }, 'Checkpoint error');
      // Don't throw - checkpoint failures should not stop execution
    }
  }

  /**
   * Sanitize final output to remove sensitive client data
   * Only keeps metadata like counts, status, types
   */
  private sanitizeOutputForStorage(finalOutput: any): any {
    if (!finalOutput || typeof finalOutput !== 'object') {
      return finalOutput;
    }

    const sanitized: any = {};

    Object.keys(finalOutput).forEach(stepKey => {
      const stepData = finalOutput[stepKey];

      if (!stepData || typeof stepData !== 'object') {
        sanitized[stepKey] = stepData;
        return;
      }

      // Extract only metadata, not actual data
      const stepMetadata: any = {};

      Object.keys(stepData).forEach(key => {
        const value = stepData[key];

        // If it's an array, store count and type info, not actual data
        if (Array.isArray(value)) {
          stepMetadata[key] = {
            count: value.length,
            type: 'array',
            sample_keys: value.length > 0 && typeof value[0] === 'object'
              ? Object.keys(value[0]).slice(0, 5)  // First 5 keys for structure info
              : []
          };
        }
        // If it's a primitive value or small object, keep it
        else if (typeof value !== 'object' || value === null) {
          stepMetadata[key] = value;
        }
        // If it's an object, store only its structure
        else {
          stepMetadata[key] = {
            type: 'object',
            keys: Object.keys(value).slice(0, 10)  // First 10 keys
          };
        }
      });

      sanitized[stepKey] = stepMetadata;
    });

    return sanitized;
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

    // CRITICAL: Sanitize final_output to remove client data
    // Only store metadata (counts, types, structure) for UI display
    const sanitizedOutput = this.sanitizeOutputForStorage(finalOutput);

    // Build structured execution results (counts and metadata only, no client data)
    // Pass sanitizedOutput since it already has the count metadata we need
    const executionResults = ExecutionResultsBuilder.build(context, sanitizedOutput);

    logger.debug({
      original_keys: Object.keys(finalOutput || {}),
      sanitized_keys: Object.keys(sanitizedOutput || {}),
      example_before: finalOutput ? JSON.stringify(finalOutput).substring(0, 200) : 'null',
      example_after: JSON.stringify(sanitizedOutput).substring(0, 200)
    }, 'Sanitized final_output for storage');

    logger.debug({
      summary: executionResults.summary,
      totalItems: executionResults.totalItems,
      totalSteps: executionResults.totalSteps,
      itemsPreview: executionResults.items.slice(0, 3).map(i => ({
        stepName: i.stepName,
        plugin: i.plugin,
        itemCount: i.itemCount,
        dataType: i.dataType
      }))
    }, 'Generated execution results');

    // CRITICAL: Collect business intelligence metrics BEFORE output is discarded
    // This enables privacy-first business intelligence by storing only metadata
    // (counts, field names, timing - NEVER actual customer data)
    try {
      const metricsCollector = new MetricsCollector(supabaseAdmin);
      await metricsCollector.collectMetrics(
        executionId,
        context.agentId,
        context
      );
      logger.debug('Business intelligence metrics collected (privacy-safe)');
    } catch (metricsError) {
      // Non-fatal - don't fail execution if metrics collection fails
      logger.error({ err: metricsError }, 'Failed to collect metrics (non-fatal)');
    }

    // Evaluate SLAs after metrics are collected
    // This updates current_value on SLA records and detects violations
    try {
      const slaEvaluator = new SLAEvaluator(supabaseAdmin);
      const evalResult = await slaEvaluator.evaluateAfterExecution(
        executionId,
        context.agentId,
        context.userId
      );
      if (evalResult.evaluatedCount > 0) {
        logger.debug({ evaluatedCount: evalResult.evaluatedCount, violationsCount: evalResult.violationsCount, recoveriesCount: evalResult.recoveriesCount }, 'SLA evaluation complete: SLAs checked, violations, recoveries');
      }
    } catch (slaError) {
      // Non-fatal - don't fail execution if SLA evaluation fails
      logger.error({ err: slaError }, 'Failed to evaluate SLAs (non-fatal)');
    }

    // Update workflow_executions table (internal tracking)
    // Use supabaseAdmin to bypass RLS policies
    const { error } = await supabaseAdmin
      .from('workflow_executions')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        final_output: sanitizedOutput,  // ← Store sanitized metadata only
        execution_results: executionResults,  // ← NEW: Store structured execution summary
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
      logger.error({ err: error }, 'Failed to mark execution as completed');
      throw error;
    }

    logger.info({ executionId }, 'Marked execution as completed');

    // Broadcast final completion update
    await this.broadcastProgress(executionId, {
      status: 'completed',
      completed_steps: summary.stepCount.completed,
      failed_steps: summary.stepCount.failed,
      skipped_steps: summary.stepCount.skipped,
      total_steps: summary.stepCount.total,
      total_tokens_used: summary.totalTokensUsed,
      total_execution_time: summary.totalExecutionTime,
    });

    // Cleanup real-time channel
    await this.cleanupRealTimeChannel();

    /*
     * ───────────────────────────────────────────────────────────────────────
     * THE SECOND ROW IS DELIBERATE, AND `'manual'` ON IT IS LOAD-BEARING.
     *
     * A scheduled run produces TWO `agent_executions` rows: the scheduler's,
     * created before the work starts, and this one, written after the workflow
     * finishes and carrying the logs, duration and token totals the UI reads.
     * They look like an accident and are not.
     *
     * `agent_executions` IS THE QUEUE. The lease added in migration 20261101
     * claims rows scoped to `execution_type = 'scheduled'`, so writing the
     * honest trigger type here would make the pilot's own COMPLETION record
     * claimable as queued work and the scheduler would run the agent again off
     * the record that it already ran. `'manual'` is what keeps this row out of
     * the queue. See the note at the `pilot.execute` call in
     * `lib/execution/scheduledAgentRunner.ts`, which depends on it.
     *
     * THE REAL COST, so nobody has to rediscover it: anything COUNTING runs
     * from this table double-counts a scheduled one. Readers that matter filter
     * by `execution_type` — `deadLetteredRuns` takes `'scheduled'` only — but a
     * naive `count(*)` per agent is roughly twice the truth.
     *
     * Fixing that properly means one row per run, which means threading the
     * trigger from the scheduler through `runAgentWithContext` into the pilot.
     * That is a cross-cutting change to every execution path and wants review,
     * not a quiet edit here.
     * ───────────────────────────────────────────────────────────────────────
     */
    try {
      const now = new Date().toISOString();
      const startTime = new Date(Date.now() - summary.totalExecutionTime).toISOString();

      // Get run_mode from workflow_executions
      const { data: workflowExec } = await this.supabase
        .from('workflow_executions')
        .select('run_mode')
        .eq('id', executionId)
        .single();

      const runMode = workflowExec?.run_mode || 'production';

      const { error: agentExecError } = await this.supabase.from('agent_executions').insert({
        id: executionId, // Use the same execution ID from workflow_executions
        agent_id: context.agentId,
        user_id: context.userId,
        execution_type: 'manual',  // This field means manual vs scheduled
        run_mode: runMode,  // NEW: This field means calibration vs production
        status: 'completed',
        scheduled_at: now,
        started_at: startTime,
        completed_at: now,
        execution_duration_ms: summary.totalExecutionTime,
        logs: {
          success: true,
          executionTime: summary.totalExecutionTime,
          tokensUsed: { total: summary.totalTokensUsed, prompt: 0, completion: 0 }, // Pilot aggregates tokens
          iterations: 1,
          response: finalOutput?.message || 'Workflow completed',
          model: 'workflow_orchestrator',
          provider: 'pilot',
          pilot: true, // UI checks this flag to display "Workflow Pilot"
          workflowExecution: true,
          stepsCompleted: summary.stepCount.completed,
          stepsFailed: summary.stepCount.failed,
          stepsSkipped: summary.stepCount.skipped,
          executionId: executionId
        }
      });

      if (agentExecError) {
        logger.error({ err: agentExecError }, 'Failed to log to agent_executions');
        // Non-fatal - don't throw, just log the error
      } else {
        logger.debug('Logged execution to agent_executions for UI display');

        // Aggregate model usage from token_usage table to populate cost/model fields
        try {
          const { data: aggregateResult, error: aggregateError } = await supabaseAdmin
            .rpc('aggregate_execution_model_usage', { p_execution_id: executionId });

          if (aggregateError) {
            logger.error({ err: aggregateError }, 'Failed to aggregate model usage');
          } else if (aggregateResult) {
            logger.debug({
              total_cost_usd: aggregateResult.total_cost_usd,
              primary_model: aggregateResult.primary_model,
              primary_provider: aggregateResult.primary_provider,
              models_count: aggregateResult.models_used?.length || 0
            }, 'Aggregated model usage');
          }
        } catch (aggregateErr) {
          logger.error({ err: aggregateErr }, 'Error aggregating model usage');
          // Non-fatal - continue
        }
      }
    } catch (logError) {
      logger.error({ err: logError }, 'Error logging to agent_executions');
      // Non-fatal - continue execution
    }
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

    // CRITICAL: Preserve cached_outputs from database before updating execution_trace
    // The in-memory executionTrace doesn't have cached_outputs (those are written directly to DB by ExecutionOutputCache)

    // Retry logic to wait for cache writes to complete (up to 1 second total)
    // This prevents a race condition where failExecution() reads before cache writes complete
    let cachedOutputs: Record<string, any> = {};
    let currentTrace: any = {};
    const expectedCacheCount = summary.stepCount.completed;
    const maxRetries = 10;
    let retryCount = 0;

    logger.debug({ expectedCacheCount }, 'Waiting for cached outputs to be available...');

    while (retryCount < maxRetries) {
      const { data: currentExecution } = await supabaseAdmin
        .from('workflow_executions')
        .select('execution_trace')
        .eq('id', executionId)
        .single();

      currentTrace = currentExecution?.execution_trace || {};
      cachedOutputs = currentTrace.cached_outputs || {};
      const cachedCount = Object.keys(cachedOutputs).length;

      logger.debug({ retryCount: retryCount + 1, maxRetries, cachedCount, expectedCacheCount }, 'Retrying for cached outputs');

      if (cachedCount >= expectedCacheCount) {
        logger.debug({ cachedCount }, 'All cached outputs found!');
        break;
      }

      retryCount++;
      if (retryCount < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 100)); // Wait 100ms between retries
      }
    }

    if (Object.keys(cachedOutputs).length < expectedCacheCount) {
      logger.warn({ maxRetries, cachedOutputsLength: Object.keys(cachedOutputs).length, expectedCacheCount }, 'Cache still incomplete after the final retry');
    }

    logger.debug({
      executionId,
      hasCachedOutputs: !!currentTrace.cached_outputs,
      cachedOutputsKeys: Object.keys(cachedOutputs),
      completedStepsCount: summary.stepCount.completed,
    }, 'Read from database before failExecution');

    // Merge cached_outputs from database into the trace we're about to save
    const mergedTrace = {
      ...executionTrace,
      cached_outputs: cachedOutputs, // ← PRESERVE cached outputs!
    };

    logger.debug({ executionId }, 'Updating execution to failed status...');
    logger.debug({ cachedOutputsLength: Object.keys(cachedOutputs).length }, 'Preserving cached outputs in execution_trace');

    const { data: updateData, error: dbError } = await supabaseAdmin
      .from('workflow_executions')
      .update({
        status: 'failed',
        error_message: error.message,
        error_stack: error.stack,
        failed_at: new Date().toISOString(),
        completed_steps_count: summary.stepCount.completed,
        failed_steps_count: summary.stepCount.failed,
        skipped_steps_count: summary.stepCount.skipped,
        execution_trace: mergedTrace, // ← Use merged trace with cached_outputs!
        total_tokens_used: summary.totalTokensUsed,
        total_execution_time_ms: summary.totalExecutionTime,
        updated_at: new Date().toISOString(),
      })
      .eq('id', executionId)
      .select(); // ← Add select() to return the updated row

    if (dbError) {
      logger.error({
        executionId,
        error: dbError.message,
        code: dbError.code,
        details: dbError.details,
        hint: dbError.hint,
      }, 'Failed to mark execution as failed');
      // Don't throw - we're already handling an error
    } else {
      logger.info({ executionId }, 'Marked execution as failed');
      logger.debug({ updateDataStatus: updateData?.[0]?.status }, 'Verification - updated row status');

      // CRITICAL: Verify the update actually happened
      const { data: verifyData } = await supabaseAdmin
        .from('workflow_executions')
        .select('status')
        .eq('id', executionId)
        .single();
      logger.debug({ verifyDataStatus: verifyData?.status }, 'Verification - database now shows status');
    }

    // Also log to agent_executions table for UI display
    try {
      const now = new Date().toISOString();
      const startTime = new Date(Date.now() - summary.totalExecutionTime).toISOString();

      // Get run_mode from workflow_executions
      const { data: workflowExec } = await this.supabase
        .from('workflow_executions')
        .select('run_mode')
        .eq('id', executionId)
        .single();

      const runMode = workflowExec?.run_mode || 'production';

      const { error: agentExecError } = await this.supabase.from('agent_executions').insert({
        id: executionId, // Use the same execution ID from workflow_executions
        agent_id: context.agentId,
        user_id: context.userId,
        execution_type: 'manual',  // This field means manual vs scheduled
        run_mode: runMode,  // NEW: This field means calibration vs production
        status: 'failed',
        scheduled_at: now,
        started_at: startTime,
        completed_at: now,
        execution_duration_ms: summary.totalExecutionTime,
        error_message: error.message,
        logs: {
          success: false,
          error: error.message,
          executionTime: summary.totalExecutionTime,
          tokensUsed: { total: summary.totalTokensUsed, prompt: 0, completion: 0 }, // Pilot aggregates tokens
          iterations: 1,
          model: 'workflow_orchestrator',
          provider: 'pilot',
          pilot: true, // UI checks this flag to display "Workflow Pilot"
          workflowExecution: true,
          stepsCompleted: summary.stepCount.completed,
          stepsFailed: summary.stepCount.failed,
          stepsSkipped: summary.stepCount.skipped,
          executionId: executionId
        }
      });

      if (agentExecError) {
        logger.error({ err: agentExecError }, 'Failed to log to agent_executions');
        // Non-fatal - don't throw
      } else {
        logger.debug('Logged failed execution to agent_executions for UI display');

        // Aggregate model usage from token_usage table to populate cost/model fields
        try {
          const { data: aggregateResult, error: aggregateError } = await supabaseAdmin
            .rpc('aggregate_execution_model_usage', { p_execution_id: executionId });

          if (aggregateError) {
            logger.error({ err: aggregateError }, 'Failed to aggregate model usage');
          } else if (aggregateResult) {
            logger.debug({
              total_cost_usd: aggregateResult.total_cost_usd,
              primary_model: aggregateResult.primary_model,
              primary_provider: aggregateResult.primary_provider
            }, 'Aggregated model usage for failed execution');
          }
        } catch (aggregateErr) {
          logger.error({ err: aggregateErr }, 'Error aggregating model usage');
          // Non-fatal - continue
        }
      }
    } catch (logError) {
      logger.error({ err: logError }, 'Error logging failed execution to agent_executions');
      // Non-fatal - continue
    }
  }

  /**
   * Pause execution
   */
  async pauseExecution(executionId: string, context: ExecutionContext): Promise<void> {
    const summary = context.getSummary();
    const executionTrace = context.getExecutionTrace();

    // Use supabaseAdmin to bypass RLS policies
    const { error } = await supabaseAdmin
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
      logger.error({ err: error }, 'Failed to pause execution');
      throw error;
    }

    logger.info({ executionId }, 'Paused execution');
  }

  /**
   * Resume execution (restore context from checkpoint)
   */
  async resumeExecution(executionId: string): Promise<{
    context: ExecutionContext;
    agent: Agent;
    runMode: 'calibration' | 'batch_calibration' | 'production';
  }> {
    const { data, error } = await this.supabase
      .from('workflow_executions')
      .select('*')
      .eq('id', executionId)
      .single();

    if (error || !data) {
      throw new Error(`Failed to fetch execution ${executionId}: ${error?.message}`);
    }

    if (data.status !== 'paused' && data.status !== 'running') {
      throw new Error(`Execution ${executionId} is not paused or running (status: ${data.status})`);
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

    // Extract run_mode from execution record
    const runMode = (data.run_mode as 'calibration' | 'batch_calibration' | 'production') || 'production';
    const isBatchCalibration = runMode === 'batch_calibration';

    // Phase 6 — Tier 1 Fix #2 + Tier 2 Fixes #1, #2 & #3: re-derive runtime
    // behavior flags on resume so resumed executions continue with the same
    // gating as the original. SystemConfig is the source of truth — flags
    // aren't persisted per execution.
    const [
      strictVariableResolution,
      loopInnerOverwriteDisabled,
      conditionalCoercionEnabled,
      scatterExplicitShapeRequired,
    ] = await Promise.all([
      SystemConfigService.getBoolean(
        this.supabase,
        'pilot_strict_variable_resolution_enabled',
        false
      ),
      SystemConfigService.getBoolean(
        this.supabase,
        'pilot_loop_inner_step_overwrite_disabled',
        false
      ),
      SystemConfigService.getBoolean(
        this.supabase,
        'pilot_conditional_type_coercion_enabled',
        false
      ),
      SystemConfigService.getBoolean(
        this.supabase,
        'pilot_scatter_explicit_shape_required',
        false
      ),
    ]);
    const isStrictResolution = strictVariableResolution && runMode === 'production';

    // Reconstruct ExecutionContext from checkpoint
    const context = new ExecutionContext(
      data.id,
      agent,
      data.user_id,
      data.session_id,
      data.input_values || {},
      isBatchCalibration,
      isStrictResolution,
      loopInnerOverwriteDisabled, // Phase 6 — Tier 2 Fix #1
      conditionalCoercionEnabled, // Phase 6 — Tier 2 Fix #2
      scatterExplicitShapeRequired, // Phase 6 — Tier 2 Fix #3
      runMode // Phase 6 — Tier 2 Fix #4: resumed exec keeps its original runMode
    );

    // Restore state
    context.status = 'running';

    // Check if this is a fresh restart (all arrays empty = user fixed workflow and wants full retry)
    const isFreshRestart =
      (!data.execution_trace?.completedSteps || data.execution_trace.completedSteps.length === 0) &&
      (!data.execution_trace?.failedSteps || data.execution_trace.failedSteps.length === 0);

    if (isFreshRestart) {
      // Fresh restart - start from beginning with empty state
      // This happens when user fixes hardcoded values and retries
      logger.debug('Fresh restart detected - re-executing entire workflow from step 1');
      context.currentStep = null;
      context.completedSteps = [];
      context.failedSteps = [];
      context.skippedSteps = [];
      context.totalTokensUsed = 0;
      context.totalExecutionTime = 0;
      // Keep original startedAt to track total time including retries
    } else {
      // Partial resume - restore checkpoint state
      logger.debug('Partial resume - continuing from checkpoint');
      context.currentStep = data.current_step;
      context.completedSteps = data.execution_trace?.completedSteps || [];
      context.failedSteps = data.execution_trace?.failedSteps || [];
      context.skippedSteps = data.execution_trace?.skippedSteps || [];
      context.totalTokensUsed = data.total_tokens_used || 0;
      context.totalExecutionTime = data.total_execution_time_ms || 0;
    }

    context.startedAt = new Date(data.started_at);

    // Restore step outputs from execution_trace.cached_outputs (temporary database storage)
    // This allows partial resume to work correctly when user fixes hardcoded values
    if (!isFreshRestart && context.completedSteps.length > 0) {
      logger.debug({ completedStepsLength: context.completedSteps.length }, 'Restoring step outputs from cache for completed steps');

      const { executionOutputCache } = await import('./ExecutionOutputCache');
      const cachedOutputs = await executionOutputCache.getAllOutputs(executionId);

      if (cachedOutputs && cachedOutputs.size > 0) {
        let restoredCount = 0;
        for (const stepId of context.completedSteps) {
          const cached = cachedOutputs.get(stepId);
          if (cached) {
            context.setStepOutput(stepId, {
              stepId,
              plugin: cached.metadata.plugin,
              action: cached.metadata.action,
              data: cached.data,
              metadata: cached.metadata,
            });
            restoredCount++;
          } else {
            logger.warn({ stepId }, 'No cached output found for - will need to re-execute');
          }
        }
        logger.debug({ restoredCount, completedStepsLength: context.completedSteps.length }, 'Restored step outputs from cache');
      } else {
        // CRITICAL: Cache miss - execution_trace.cached_outputs is empty
        // FALLBACK: Convert to fresh restart mode to re-execute entire workflow
        logger.warn({ executionId }, 'Cache miss for - no cached outputs available');
        logger.warn('FALLBACK: Converting to fresh restart mode (will re-execute all steps from step 1)');

        // Convert to fresh restart to rebuild data flow
        context.currentStep = null;
        context.completedSteps = [];
        context.failedSteps = [];
        context.skippedSteps = [];
        context.totalTokensUsed = 0;
        context.totalExecutionTime = 0;

        logger.debug('Converted to fresh restart mode - will re-execute entire workflow');
      }
    }

    // Update resumed_at timestamp
    // Use supabaseAdmin to bypass RLS policies
    await supabaseAdmin
      .from('workflow_executions')
      .update({
        status: 'running',
        resumed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', executionId);

    logger.info({ executionId }, 'Resumed execution');

    return { context, agent, runMode };
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

    // Use supabaseAdmin to bypass RLS policies
    const { error } = await supabaseAdmin
      .from('workflow_executions')
      .update(updateData)
      .eq('id', executionId);

    if (error) {
      logger.error({ err: error }, 'Failed to cancel execution');
      throw error;
    }

    logger.info({ executionId }, 'Cancelled execution');
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
      logger.error({ err: error }, 'Failed to fetch execution status');
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
      logger.error({ err: error }, 'Failed to fetch active executions');
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
      logger.error({ err: error }, 'Failed to fetch execution history');
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

      /*
       * ───────────────────────────────────────────────────────────────────────
       * `maybeSingle` AFTER A `limit(1)`, AND THE DIFFERENCE IS NOT COSMETIC.
       *
       * This was `.single()`, which FAILS when the query matches more than one
       * row. A step inside a scatter runs once per item under the same
       * `step_id`, so from the second item onward this read errored, `existing`
       * came back undefined, and the branch below inserted ANOTHER row. One
       * agent accumulated 225 rows for a single step across six runs, every one
       * of them stranded at `running`.
       *
       * One row per (execution, step) is also what `updateStepExecution`
       * already assumes — it updates by those two columns and no third — so the
       * read and the write finally agree about how many rows exist.
       *
       * WHAT THIS DELIBERATELY DOES NOT DO: give each scatter item its own row.
       * That would need an item index on the table and a matching key on every
       * read, and it is a real feature — per-item visibility — rather than this
       * bug. The honest answer for now is one row per step, reset as each item
       * starts and closed as it finishes, which answers "did this step work"
       * without pretending to answer "which item failed".
       * ───────────────────────────────────────────────────────────────────────
       */
      const { data: existing } = await supabaseAdmin
        .from('workflow_step_executions')
        .select('id')
        .eq('workflow_execution_id', workflowExecutionId)
        .eq('step_id', stepId)
        .limit(1)
        .maybeSingle();

      if (existing) {
        logger.debug({ stepId }, 'Step execution record already exists; resetting it for re-execution');

        // CRITICAL FIX: Reset the existing record completely when re-executing
        // This ensures status API returns correct state, not stale "failed" status
        const resetData: any = {
          status: 'running',
          started_at: new Date().toISOString(),
          completed_at: null,
          failed_at: null,
          error_message: null,
          execution_metadata: metadata || {},
          tokens_used: null,
          execution_time_ms: null,
        };

        // Preserve plugin/action from metadata if available
        if (metadata?.plugin) {
          resetData.plugin = metadata.plugin;
        }
        if (metadata?.action) {
          resetData.action = metadata.action;
        }

        const { error: updateError } = await supabaseAdmin
          .from('workflow_step_executions')
          .update(resetData)
          .eq('id', existing.id);

        if (updateError) {
          logger.error({ err: updateError, stepId }, 'Failed to reset step execution record');
          // Don't throw - best effort reset
        } else {
          logger.debug({ stepId }, 'Reset step execution record to running, clearing the previous failure state');
        }
        return;
      }

      // Build insert data with all available fields
      const insertData: any = {
        workflow_execution_id: workflowExecutionId,
        step_id: stepId,
        step_name: stepName,
        step_type: normalizedStepType,
        status,
        execution_metadata: metadata || {},
        created_at: new Date().toISOString(),
      };

      // Extract started_at from metadata to dedicated column if available
      if (metadata?.started_at) {
        insertData.started_at = metadata.started_at;
      }

      // Extract plugin info from metadata if available
      if (metadata?.plugin) {
        insertData.plugin = metadata.plugin;
      }
      if (metadata?.action) {
        insertData.action = metadata.action;
      }

      // Use supabaseAdmin to bypass RLS policies for INSERT operations
      const { error} = await supabaseAdmin
        .from('workflow_step_executions')
        .insert(insertData);

      if (error) {
        logger.error({ err: error }, 'Failed to log step execution');
        // Don't throw - step logging failures should not stop execution
      } else {
        logger.debug({ stepId }, 'Created step execution record for (using service role)');
      }
    } catch (err) {
      logger.error({ err }, 'Step logging error');
      // Don't throw
    }
  }

  /**
   * Normalize step type to match database CHECK constraint
   * Database only allows: action, llm_decision, conditional, loop, transform, delay, parallel_group
   */
  private normalizeStepType(stepType: string): string {
    // Map TypeScript types to database-allowed values
    // Database only allows: action, llm_decision, conditional, loop, transform, delay, parallel_group
    const typeMapping: Record<string, string> = {
      'ai_processing': 'llm_decision',        // Smart Agent Builder uses ai_processing
      'switch': 'conditional',                 // Phase 2: map switch to conditional
      'validation': 'transform',               // Phase 4: map validation to transform
      'enrichment': 'transform',               // Phase 4: map enrichment to transform
      'comparison': 'transform',               // Phase 4: map comparison to transform
      'sub_workflow': 'action',                // Phase 5: map sub_workflow to action
      'human_approval': 'action',              // Phase 6: map human_approval to action
      'scatter_gather': 'parallel_group',      // Phase 3: map scatter_gather to parallel_group
      // Orchestration step types (LLM-based operations)
      'summarize': 'llm_decision',             // Content summarization via LLM
      'extract': 'llm_decision',               // Information extraction via LLM
      'generate': 'llm_decision',              // Content generation via LLM
      // Note: 'transform' is already allowed in database, no mapping needed
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
      // 🔍 DIAGNOSTIC: Log what metadata we receive
      if (metadata?.field_names) {
        logger.debug({ stepId, field_names: metadata.field_names }, 'Received metadata with field_names for step');
      } else if (metadata?.itemCount > 0) {
        logger.warn({ stepId, itemCount: metadata.itemCount }, 'Step has itemCount but NO field_names in metadata');
      }

      const updateData: any = {
        status,
        execution_metadata: metadata || {},
      };

      // 🔍 DIAGNOSTIC: Log what we're about to store
      logger.debug({ stepId, execution_metadataSlice: JSON.stringify(updateData.execution_metadata).slice(0, 200) }, 'Storing execution_metadata for step');

      if (status === 'completed') {
        updateData.completed_at = new Date().toISOString();

        // Extract metrics from metadata to dedicated columns
        if (metadata?.tokens_used) {
          // Convert token object to integer for database storage
          const tokensUsed = typeof metadata.tokens_used === 'object'
            ? (metadata.tokens_used.total || 0)
            : metadata.tokens_used;
          updateData.tokens_used = tokensUsed;
        }
        if (metadata?.execution_time) {
          updateData.execution_time_ms = metadata.execution_time;
        }
        // ✅ NEW: Store item count for business intelligence
        if (metadata?.itemCount !== undefined) {
          updateData.item_count = metadata.itemCount;
        }
      } else if (status === 'failed') {
        updateData.failed_at = new Date().toISOString();
        updateData.error_message = errorMessage;
      }

      // Use supabaseAdmin to bypass RLS policies for UPDATE operations
      const { error } = await supabaseAdmin
        .from('workflow_step_executions')
        .update(updateData)
        .eq('workflow_execution_id', workflowExecutionId)
        .eq('step_id', stepId);

      if (error) {
        logger.error({ err: error }, 'Failed to update step execution');
        // Don't throw
      } else {
        // 🔍 DIAGNOSTIC: Confirm successful storage
        if (metadata?.field_names) {
          logger.debug({ stepId }, 'Successfully stored metadata with field_names for step');
        }
      }
    } catch (err) {
      logger.error({ err }, 'Step update error');
      // Don't throw
    }
  }

  /**
   * Get step execution record for verification
   * Used to verify that metadata updates persisted correctly
   */
  async getStepExecution(
    workflowExecutionId: string,
    stepId: string
  ): Promise<any | null> {
    try {
      const { data, error } = await supabaseAdmin
        .from('workflow_step_executions')
        .select('*')
        .eq('workflow_execution_id', workflowExecutionId)
        .eq('step_id', stepId)
        .single();

      if (error) {
        logger.error({ err: error, stepId }, 'Failed to get step execution');
        return null;
      }

      return data;
    } catch (err) {
      logger.error({ err }, 'Error getting step execution');
      return null;
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
      logger.error({ err: error }, 'Cleanup failed');
      throw error;
    }

    logger.info({ count: count || 0 }, 'Cleaned up old executions');
    return count || 0;
  }
}

// Re-export ExecutionContext for convenience
export { ExecutionContext } from './ExecutionContext';
