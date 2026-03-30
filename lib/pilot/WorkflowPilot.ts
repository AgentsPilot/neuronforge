/**
 * WorkflowPilot - Main execution engine
 *
 * The Pilot is the intelligent execution engine at the heart of AgentsPilot.
 * It orchestrates complex multi-step workflows with precision, reliability, and intelligence.
 *
 * Responsibilities:
 * - Coordinate all pilot components
 * - Execute workflow steps in correct order
 * - Handle parallel execution
 * - Manage state and checkpointing
 * - Integrate with AgentKit, AIS, Memory systems
 *
 * @module lib/pilot/WorkflowPilot
 */

import { SupabaseClient } from '@supabase/supabase-js';
import type {
  Agent,
  WorkflowStep,
  WorkflowExecutionResult,
  PilotOptions,
  ExecutionStep,
  SubWorkflowStep,
  HumanApprovalStep,
} from './types';
import { ExecutionError, ValidationError } from './types';
import { WorkflowParser } from './WorkflowParser';
import { ExecutionContext } from './ExecutionContext';
import { StateManager } from './StateManager';
import { tokensToPilotCredits } from '@/lib/utils/pricingConfig';
import { StepExecutor } from './StepExecutor';
import { ParallelExecutor } from './ParallelExecutor';
import { ConditionalEvaluator } from './ConditionalEvaluator';
import { ErrorRecovery } from './ErrorRecovery';
import { OutputValidator } from './OutputValidator';
import { ApprovalTracker } from './ApprovalTracker';
import { NotificationService } from './NotificationService';
import { MemoryInjector } from '@/lib/memory/MemoryInjector';
import { MemorySummarizer } from '@/lib/memory/MemorySummarizer';
import { updateAgentIntensityMetrics } from '@/lib/utils/updateAgentIntensity';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { SystemConfigService } from '@/lib/services/SystemConfigService';
import { ExecutionEventEmitter } from '@/lib/execution/ExecutionEventEmitter';
import { WorkflowOrchestrator } from '@/lib/orchestration';
import { PilotConfigService } from './PilotConfigService';
import { StepCache } from './StepCache';

export class WorkflowPilot {
  private supabase: SupabaseClient;
  private parser: WorkflowParser;
  private stateManager: StateManager;
  private stepExecutor: StepExecutor;
  private parallelExecutor: ParallelExecutor;
  private conditionalEvaluator: ConditionalEvaluator;
  private errorRecovery: ErrorRecovery;
  private outputValidator: OutputValidator;
  private auditTrail: AuditTrailService;
  private approvalTracker: ApprovalTracker;
  private notificationService: NotificationService;
  private stepCache: StepCache;
  private options: PilotOptions | null = null;
  private optionsOverride: PilotOptions | undefined;
  private optimizationsEnabled: boolean = false;

  constructor(supabase: SupabaseClient, options?: PilotOptions) {
    this.supabase = supabase;
    this.optionsOverride = options; // Store for later merge with DB config

    // Initialize components (parallelExecutor will be initialized after loading config)
    this.parser = new WorkflowParser();
    this.stateManager = new StateManager(supabase);
    this.stepCache = new StepCache(false); // Will be configured after loading config
    this.stepExecutor = new StepExecutor(supabase, this.stateManager, this.stepCache); // Pass StateManager and StepCache
    this.parallelExecutor = new ParallelExecutor(this.stepExecutor, 3); // Temporary, will be reinitialized
    this.conditionalEvaluator = new ConditionalEvaluator();
    this.errorRecovery = new ErrorRecovery();
    this.outputValidator = new OutputValidator();
    this.auditTrail = AuditTrailService.getInstance();
    this.approvalTracker = new ApprovalTracker(supabase);
    this.notificationService = new NotificationService();
  }

  /**
   * Load Pilot configuration from database
   * Called once at the start of execution
   *
   * @private
   */
  private async loadConfig(): Promise<PilotOptions> {
    if (this.options !== null) {
      return this.options;
    }

    // Load from database
    const dbConfig = await PilotConfigService.loadPilotConfig(this.supabase);

    // Merge with any constructor overrides
    this.options = {
      ...dbConfig,
      ...this.optionsOverride,
    };

    // Reinitialize parallel executor with correct maxParallelSteps
    this.parallelExecutor = new ParallelExecutor(this.stepExecutor, this.options.maxParallelSteps);

    // Reinitialize state manager with progress tracking and real-time settings
    this.stateManager = new StateManager(
      this.supabase,
      this.options.enableProgressTracking !== false,
      this.options.enableRealTimeUpdates === true
    );

    // Configure step cache
    const cacheEnabled = this.options.enableCaching === true || this.options.cacheStepResults === true;
    this.stepCache.setEnabled(cacheEnabled);

    // Configure optimizations
    this.optimizationsEnabled = this.options.enableOptimizations !== false;
    if (this.optimizationsEnabled) {
      console.log('[WorkflowPilot] Performance optimizations enabled');
    }

    console.log('[WorkflowPilot] Configuration loaded:', this.options);
    return this.options;
  }

  /**
   * Extract workflow configuration from agent
   * Converts config array from IntentContract to a key-value object
   *
   * Config format in agent (from V6 pipeline):
   * [
   *   { "key": "amount_threshold_usd", "type": "number", "default": 50 }
   * ]
   *
   * Returns:
   * {
   *   "amount_threshold_usd": 50
   * }
   */
  private extractWorkflowConfig(agent: Agent): Record<string, any> {
    const config: Record<string, any> = {};

    // Extract config from input_schema (default_value fields)
    if (agent.input_schema && Array.isArray(agent.input_schema)) {
      console.log('[WorkflowPilot] Extracting config from input_schema:', agent.input_schema.length, 'fields');
      for (const field of agent.input_schema) {
        if (field.default_value !== undefined && field.default_value !== null && field.default_value !== '') {
          console.log('[WorkflowPilot] Found config value:', field.name, '=', field.default_value);
          config[field.name] = field.default_value;
        }
      }
    }

    // Fallback: Check if agent has legacy workflow_config field
    if ((agent as any).workflow_config) {
      const wfConfig = (agent as any).workflow_config;
      console.log('[WorkflowPilot] Found legacy workflow_config:', wfConfig);

      // If it's already a key-value object, use it directly
      if (typeof wfConfig === 'object' && !Array.isArray(wfConfig)) {
        return { ...config, ...wfConfig };
      }

      // If it's an array of config items (IntentContract format)
      if (Array.isArray(wfConfig)) {
        for (const item of wfConfig) {
          if (item.key && item.default !== undefined) {
            config[item.key] = item.default;
          }
        }
      }
    }

    console.log('[WorkflowPilot] Final extracted config:', config);
    return config;
  }

  /**
   * Execute workflow
   */
  async execute(
    agent: Agent,
    userId: string,
    userInput: string,
    inputValues: Record<string, any>,
    sessionId?: string,
    stepEmitter?: {
      onStepStarted?: (stepId: string, stepName: string) => void;
      onStepCompleted?: (stepId: string, stepName: string) => void;
      onStepFailed?: (stepId: string, stepName: string, error: string) => void;
    }
  ): Promise<WorkflowExecutionResult> {
    console.log(`🚀 [WorkflowPilot] Starting execution for agent ${agent.id}: ${agent.agent_name}`);

    // Generate sessionId if not provided (must be UUID format for database)
    const finalSessionId = sessionId || crypto.randomUUID();

    // Store stepEmitter in instance for use during execution
    (this as any).stepEmitter = stepEmitter;

    // 0a. Load Pilot configuration from database (with 5-min cache)
    const options = await this.loadConfig();
    console.log(`⚙️  [WorkflowPilot] Configuration: maxParallelSteps=${options.maxParallelSteps}, timeout=${options.defaultTimeout}ms, caching=${options.enableCaching}`);

    // 0b. Check if pilot is enabled (safeguard)
    const pilotEnabled = await SystemConfigService.getBoolean(
      this.supabase,
      'pilot_enabled',
      false // Default: disabled for safety
    );

    if (!pilotEnabled) {
      const errorMessage = 'Workflow pilot is disabled in system configuration';
      console.error(`❌ [WorkflowPilot] ${errorMessage}`);

      // Log audit event
      await this.auditTrail.log({
        action: AUDIT_EVENTS.PILOT_DISABLED,
        entityType: 'agent',
        entityId: agent.id,
        userId,
        resourceName: agent.agent_name,
        details: {
          workflow_steps_count: (agent.workflow_steps as WorkflowStep[])?.length || 0,
          reason: 'pilot_disabled_in_config',
        },
        severity: 'warning',
      });

      throw new ExecutionError(
        errorMessage,
        undefined,
        {
          agent_id: agent.id,
          reason: 'pilot_disabled',
          suggestion: 'Contact your administrator to enable the workflow pilot in system settings',
        }
      );
    }

    console.log('✅ [WorkflowPilot] Pilot is enabled, proceeding with execution');

    // 1. Parse workflow
    // Pilot orchestration system prefers pilot_steps (normalized format)
    // Falls back to workflow_steps for backward compatibility with old agents
    const workflowSteps = (agent.pilot_steps as WorkflowStep[]) ||
                         (agent.workflow_steps as WorkflowStep[]) ||
                         [];

    const usingPilotSteps = !!agent.pilot_steps;
    console.log(`📋 [WorkflowPilot] Using ${usingPilotSteps ? 'pilot_steps (normalized)' : 'workflow_steps (legacy fallback)'} for execution`);

    if (workflowSteps.length === 0) {
      throw new ValidationError(
        'Agent has no workflow steps defined',
        undefined,
        { agent_id: agent.id }
      );
    }

    const executionPlan = this.parser.parse(workflowSteps);

    console.log(`📋 [WorkflowPilot] Execution plan:\n${this.parser.visualize(executionPlan)}`);

    // 2. Initialize execution context
    const executionId = await this.stateManager.createExecution(
      agent,
      userId,
      finalSessionId,
      executionPlan,
      inputValues
    );

<<<<<<< Updated upstream
    const context = new ExecutionContext(
=======
    // Determine if this is batch calibration mode
    const isBatchCalibration = runMode === 'batch_calibration';

    // Extract workflow configuration from agent (if stored)
    // Config is used for {{config.key}} variable references in workflow steps
    const workflowConfig = this.extractWorkflowConfig(agent);

    context = new ExecutionContext(
>>>>>>> Stashed changes
      executionId,
      agent,
      userId,
      finalSessionId,
<<<<<<< Updated upstream
      inputValues
=======
      inputValues,
      isBatchCalibration,
      workflowConfig
>>>>>>> Stashed changes
    );

    // 3. Load memory context (skip if optimizations enabled for faster execution)
    if (!this.optimizationsEnabled) {
      try {
        const memoryInjector = new MemoryInjector(this.supabase);
        const memoryContext = await memoryInjector.buildMemoryContext(
          agent.id,
          userId,
          { userInput, inputValues }
        );
        context.memoryContext = memoryContext;

        console.log(`🧠 [WorkflowPilot] Loaded memory context: ${memoryContext.token_count} tokens`);
      } catch (error: any) {
        console.warn(`⚠️  [WorkflowPilot] Failed to load memory (non-critical):`, error.message);
      }
    } else {
      console.log(`⚡ [WorkflowPilot] Optimizations enabled: Skipping memory context loading`);
    }

    // 3b. Initialize orchestration (Phase 4)
    try {
      const orchestrator = new WorkflowOrchestrator(this.supabase);
      const orchestrationEnabled = await orchestrator.initialize(
        executionId,  // Use executionId as workflowId
        agent.id,
        userId,
        workflowSteps
      );

      if (orchestrationEnabled) {
        console.log('🎯 [WorkflowPilot] Orchestration enabled for this execution');
        context.orchestrator = orchestrator;
      } else {
        console.log('ℹ️  [WorkflowPilot] Orchestration disabled, using normal execution');
      }
    } catch (error: any) {
      console.warn('⚠️  [WorkflowPilot] Orchestration initialization failed (non-critical):', error.message);
      // Continue with normal execution
    }

    // 4. Audit: Execution started (skip detailed logging if optimizations enabled)
    if (!this.optimizationsEnabled) {
      await this.auditTrail.log({
        action: AUDIT_EVENTS.PILOT_EXECUTION_STARTED,
        entityType: 'agent',
        entityId: executionId,
        userId: userId,
        resourceName: agent.agent_name,
        details: {
          agent_id: agent.id,
          total_steps: executionPlan.totalSteps,
          estimated_duration: executionPlan.estimatedDuration,
          parallel_groups: executionPlan.parallelGroups.length,
        },
        severity: 'info',
      });
    }

    try {
      // 5. Execute steps with optional timeout
      if (options.defaultTimeout && options.defaultTimeout > 0) {
        await this.executeWithTimeout(
          () => this.executeSteps(executionPlan, context),
          options.defaultTimeout,
          executionId
        );
      } else {
        await this.executeSteps(executionPlan, context);
      }

      // 6. Build final output
      const finalOutput = this.buildFinalOutput(context, agent.output_schema);

      // 7. Validate output
      const validationResult = await this.outputValidator.validate(
        finalOutput,
        agent.output_schema
      );

      if (!validationResult.valid) {
        console.warn(`⚠️  [WorkflowPilot] Output validation failed:`, validationResult.errors);
        // Don't fail execution, just log warning
      }

      // 8. Summarize for memory (SYNCHRONOUS - must wait to get token count)
      // ✅ CRITICAL: Calculate memory tokens BEFORE marking as completed
      let memoryTokens = 0;
      try {
        memoryTokens = await this.summarizeForMemory(agent.id, userId, executionId, context);
        console.log(`✅ Memory summarization complete (${memoryTokens} tokens)`);
      } catch (err) {
        console.error('❌ Memory summarization failed (non-critical):', err);
      }

      // 9. Complete orchestration and collect metrics (Phase 4)
      // ✅ CRITICAL: Calculate orchestration tokens BEFORE marking as completed
      let orchestrationMetrics: any = null;
      let orchestrationTokens = 0;  // ✅ Track orchestration overhead tokens (classification, etc.)

      if (context.orchestrator) {
        try {
          orchestrationMetrics = await context.orchestrator.complete();
          if (orchestrationMetrics) {
            orchestrationTokens = orchestrationMetrics.totalTokensUsed || 0;
            console.log('🎯 [WorkflowPilot] Orchestration metrics:');
            console.log(`   💰 Total tokens saved: ${orchestrationMetrics.totalTokensSaved}`);
            console.log(`   💵 Total cost: $${orchestrationMetrics.totalCost.toFixed(4)}`);
            console.log(`   📊 Budget utilization: ${(orchestrationMetrics.budgetUtilization * 100).toFixed(1)}%`);
          }
        } catch (error: any) {
          console.warn('⚠️  [WorkflowPilot] Orchestration completion failed (non-critical):', error.message);
        }
      }

      // 10. Calculate final token count with all components
      // ✅ FIXED: orchestrationMetrics.totalTokensUsed ALREADY includes all step tokens
      // It's not "classification overhead" - it's the total from all orchestrated steps
      // We should NOT add it to context.totalTokensUsed because that would double-count
      const stepTokens = context.totalTokensUsed;  // All step execution tokens
      const totalTokensWithMemory = stepTokens + memoryTokens;  // Steps + memory only

      // Log orchestration metrics separately (for transparency)
      if (orchestrationTokens > 0 && orchestrationMetrics) {
        console.log('🎯 [WorkflowPilot] Orchestration metrics breakdown:');
        console.log(`   📊 Steps tracked by orchestration: ${orchestrationTokens} tokens`);
        console.log(`   📊 Steps tracked by pilot: ${stepTokens} tokens`);
        if (orchestrationTokens !== stepTokens) {
          console.warn(`   ⚠️  Discrepancy detected: ${Math.abs(orchestrationTokens - stepTokens)} tokens difference`);
        }
      }

      console.log(`📊 [WorkflowPilot] Final token count: ${stepTokens} (steps) + ${memoryTokens} (memory) = ${totalTokensWithMemory}`);

      // ✅ CRITICAL: Update context with final total BEFORE saving to database
      context.totalTokensUsed = totalTokensWithMemory;

      // 11. Mark as completed (now with correct total tokens in context)
      await this.stateManager.completeExecution(executionId, finalOutput, context);

      // 12. Audit: Execution completed (skip detailed logging if optimizations enabled)
      if (!this.optimizationsEnabled) {
        await this.auditTrail.log({
          action: AUDIT_EVENTS.PILOT_EXECUTION_COMPLETED,
          entityType: 'agent',
          entityId: executionId,
          userId: userId,
          resourceName: agent.agent_name,
          details: {
            steps_completed: context.completedSteps.length,
            steps_failed: context.failedSteps.length,
            steps_skipped: context.skippedSteps.length,
            total_execution_time: context.totalExecutionTime,
            total_tokens_used: context.totalTokensUsed,  // Now includes all tokens
          },
          severity: 'info',
        });
      }

      // 13. ✅ P0 FIX: Reconcile token counts (verify accuracy)
      // This ensures token_usage table matches agent_executions.logs.tokensUsed
      // Critical for revenue integrity
      // Run async with delay to ensure database transaction completes
      setTimeout(async () => {
        try {
          const { TokenReconciliationService } = await import('@/lib/services/TokenReconciliationService');
          const reconciliationService = new TokenReconciliationService(this.supabase);
          const reconciliationResult = await reconciliationService.reconcileExecution(executionId);

          if (!reconciliationResult.isReconciled) {
            console.error(`⚠️  [WorkflowPilot] Token discrepancy detected: ${reconciliationResult.discrepancy} tokens (${reconciliationResult.discrepancyPercentage.toFixed(2)}%)`);
          } else {
            console.log(`✅ [WorkflowPilot] Token reconciliation passed`);
          }
        } catch (reconciliationError: any) {
          // Non-critical - log but don't fail execution
          console.warn(`⚠️  [WorkflowPilot] Token reconciliation failed (non-critical):`, reconciliationError.message);
        }
      }, 1000); // Wait 1 second for DB transaction to complete

      // 14. Update AIS metrics (async)
      this.updateAISMetrics(agent.id, context).catch(err =>
        console.error('❌ AIS update failed (non-critical):', err)
      );

      console.log(`✅ [WorkflowPilot] Execution completed successfully: ${executionId}`);

<<<<<<< Updated upstream
=======
      // NOTE: We do NOT automatically mark agent as production_ready here
      // User must explicitly click "Approve for Production" button in the calibration UI
      // This ensures user reviews all calibration results (including hardcoded values) before approving
      console.log(`🔍 [WorkflowPilot] Agent will remain in calibration mode until user approves via UI`);

      // Cleanup debug session
      if (debugRunId) {
        DebugSessionManager.cleanup(debugRunId);
        console.log(`🐛 [WorkflowPilot] Debug session cleaned up: ${debugRunId}`);
      }

      // Cleanup in-memory checkpoints
      const cpManager = (this as any)._checkpointManager as CheckpointManager | null;
      if (cpManager) {
        cpManager.clear();
      }

      // Batch calibration: collect hardcoded values and workflow structure issues after successful execution
      if (isBatchCalibration) {
        console.log('🔍 [WorkflowPilot] Batch calibration mode - collecting hardcoded values and workflow structure issues');
        try {
          const issueCollector = new IssueCollector();

          // Collect hardcoded values
          const hardcodeIssues = issueCollector.collectHardcodedValues(agent);
          context.collectedIssues.push(...hardcodeIssues);
          console.log(`🔍 [WorkflowPilot] Detected ${hardcodeIssues.length} hardcoded values`);

          // Collect workflow structure issues (missing fields, wrong field names, etc.)
          const structureIssues = issueCollector.collectWorkflowStructureIssues(agent, context);
          context.collectedIssues.push(...structureIssues);
          console.log(`🔍 [WorkflowPilot] Detected ${structureIssues.length} workflow structure issues`);
        } catch (hardcodeErr) {
          console.error('❌ [WorkflowPilot] Issue detection failed (non-critical):', hardcodeErr);
        }
      }

>>>>>>> Stashed changes
      // Emit execution complete event globally
      ExecutionEventEmitter.emitExecutionComplete(executionId, agent.id, {
        success: true,
        results: finalOutput,
        total_duration_ms: context.totalExecutionTime,
      });

<<<<<<< Updated upstream
=======
      // Collect execution summary for calibration
      const executionSummary = executionSummaryCollector ? executionSummaryCollector.getSummary() : undefined;
      if (executionSummary) {
        console.log(`📊 [WorkflowPilot] Execution summary collected:`, {
          data_sources: executionSummary.data_sources_accessed.length,
          data_written: executionSummary.data_written.length,
          items_processed: executionSummary.items_processed,
          full_summary: JSON.stringify(executionSummary, null, 2)
        });
      } else {
        console.log(`📊 [WorkflowPilot] No execution summary collected (collector: ${!!executionSummaryCollector})`);
      }

      // CRITICAL: For batch calibration, include ALL step outputs for error detection
      // The finalOutput is schema-filtered and may not include intermediate steps
      // Scatter-gather error detection needs to scan ALL step outputs, not just final output
      const allStepOutputs: any = {};
      if (isBatchCalibration) {
        context.getAllStepOutputs().forEach((stepOutput, stepId) => {
          allStepOutputs[stepId] = stepOutput.data;
        });
        console.log(`🔍 [WorkflowPilot] Batch calibration mode: included all ${Object.keys(allStepOutputs).length} step outputs for error detection`);
      }

>>>>>>> Stashed changes
      return {
        success: true,
        executionId,
        output: isBatchCalibration ? allStepOutputs : finalOutput,  // Use all outputs in calibration mode
        stepsCompleted: context.completedSteps.length,
        stepsFailed: context.failedSteps.length,
        stepsSkipped: context.skippedSteps.length,
        totalExecutionTime: context.totalExecutionTime,
        totalTokensUsed: totalTokensWithMemory,
        // Include step details for frontend visualization
        completedStepIds: context.completedSteps,
        failedStepIds: context.failedSteps,
        skippedStepIds: context.skippedSteps,
        // Orchestration metrics (Phase 4)
        orchestrationMetrics: orchestrationMetrics ? {
          totalTokensUsed: orchestrationMetrics.totalTokensUsed,
          totalTokensSaved: orchestrationMetrics.totalTokensSaved,
          savingsPercent: orchestrationMetrics.totalTokensUsed > 0
            ? ((orchestrationMetrics.totalTokensSaved / orchestrationMetrics.totalTokensUsed) * 100).toFixed(1) + '%'
            : '0%',
          totalCost: orchestrationMetrics.totalCost,
          budgetUtilization: (orchestrationMetrics.budgetUtilization * 100).toFixed(1) + '%',
        } : undefined,
      };
    } catch (error: any) {
      console.error(`❌ [WorkflowPilot] Execution failed:`, error);

      // Mark as failed
      await this.stateManager.failExecution(executionId, error, context);

      // Emit execution error event globally
      ExecutionEventEmitter.emitExecutionError(executionId, agent.id, {
        error: error.message,
        step_index: context.completedSteps.length,
      });

      // Audit: Execution failed
      await this.auditTrail.log({
        action: AUDIT_EVENTS.PILOT_EXECUTION_FAILED,
        entityType: 'agent',
        entityId: executionId,
        userId: userId,
        resourceName: agent.agent_name,
        details: {
          error: error.message,
          error_code: error.code,
          failed_step: context.currentStep,
          steps_completed: context.completedSteps.length,
        },
        severity: 'critical',
      });

<<<<<<< Updated upstream
=======
      // In batch calibration mode, collect issues from the execution error
      // AND collect hardcoded values even if execution failed
      // This ensures we show ALL improvements, not just the first error
      // Allows users to fix both execution errors AND hardcode issues in one go
      if (isBatchCalibration && context) {
        try {
          console.log('🔍 [WorkflowPilot] Batch calibration mode - collecting issues after failure');
          const { IssueCollector } = await import('./shadow/IssueCollector');
          const issueCollector = new IssueCollector();

          // CRITICAL: Convert execution error to CollectedIssue with auto-repair proposal
          // This enables auto-fix for data shape mismatches, filter bugs, etc.
          const failedStepId = error.stepId || context.currentStep || 'unknown';
          const pilotSteps = agent.pilot_steps || agent.workflow_steps || [];
          const failedStepDef = pilotSteps.find(s => s.id === failedStepId || s.step_id === failedStepId);
          const failedStepName = failedStepDef?.name || failedStepId;
          const failedStepType = failedStepDef?.type || 'unknown';

          const executionIssue = issueCollector.collectFromError(
            error,
            failedStepId,
            failedStepName,
            failedStepType,
            context
          );
          context.collectedIssues.push(executionIssue);
          console.log(`🔍 [WorkflowPilot] Collected execution error issue: ${executionIssue.category}, auto-repair: ${executionIssue.autoRepairAvailable}`);

          // Also collect hardcoded values and workflow structure issues
          const hardcodeIssues = issueCollector.collectHardcodedValues(agent);
          context.collectedIssues.push(...hardcodeIssues);
          console.log(`🔍 [WorkflowPilot] Detected ${hardcodeIssues.length} hardcoded values (after failure)`);

          // Collect workflow structure issues
          const structureIssues = issueCollector.collectWorkflowStructureIssues(agent, context);
          context.collectedIssues.push(...structureIssues);
          console.log(`🔍 [WorkflowPilot] Detected ${structureIssues.length} workflow structure issues (after failure)`);
        } catch (issueCollectionErr: any) {
          // Non-critical - issue collection is best-effort
          console.error('❌ [WorkflowPilot] Issue collection failed (non-critical):', issueCollectionErr.message);
        }
      }

>>>>>>> Stashed changes
      return {
        success: false,
        executionId,
        output: null,
        stepsCompleted: context.completedSteps.length,
        stepsFailed: context.failedSteps.length,
        stepsSkipped: context.skippedSteps.length,
        totalExecutionTime: context.totalExecutionTime,
        totalTokensUsed: context.totalTokensUsed,
        error: error.message,
        errorStack: error.stack,
        failedStep: context.currentStep || undefined,
        // Include step details for frontend visualization
        completedStepIds: context.completedSteps,
        failedStepIds: context.failedSteps,
        skippedStepIds: context.skippedSteps,
      };
    }
  }

  /**
   * Execute all steps in execution plan
   */
  private async executeSteps(
    plan: any,
    context: ExecutionContext
  ): Promise<void> {
    const stepsByLevel = this.groupStepsByLevel(plan.steps);

    console.log(`📊 [WorkflowPilot] Executing ${stepsByLevel.size} levels`);

    // Execute each level sequentially
    for (const [level, steps] of stepsByLevel.entries()) {
      console.log(`\n🔹 [WorkflowPilot] Level ${level}: ${steps.length} step(s)`);

      // Group steps by parallel groups
      const parallelGroups = this.groupByParallelGroup(steps);

      for (const group of parallelGroups) {
        if (group.length === 1) {
          // Single step - execute directly
          await this.executeSingleStep(group[0], context);
        } else {
          // Parallel group - execute concurrently
          console.log(`⚡ [WorkflowPilot] Executing ${group.length} steps in parallel`);
          await this.executeParallelGroup(group, context);
        }
      }
    }

    console.log(`\n✅ [WorkflowPilot] All steps completed`);
  }

  /**
   * Execute single step with conditional check
   */
  private async executeSingleStep(
    step: ExecutionStep,
    context: ExecutionContext
  ): Promise<void> {
    const stepDef = step.stepDefinition;

    console.log(`  → Executing: ${stepDef.id} (${stepDef.name})`);

    // Get step emitter reference once at the beginning
    const stepEmitter = (this as any).stepEmitter;

    // Emit step started event (both local and global)
    if (stepEmitter?.onStepStarted) {
      stepEmitter.onStepStarted(stepDef.id, stepDef.name);
    }
    ExecutionEventEmitter.emitStepStarted(context.executionId, context.agentId, {
      step_index: context.completedSteps.length,
      step_name: stepDef.name,
      step_id: stepDef.id,
      operation: stepDef.name,
      plugin: stepDef.type === 'action' ? (stepDef as any).plugin : undefined,
      action: stepDef.type === 'action' ? (stepDef as any).action : undefined,
    });

    // Check executeIf condition
    if (stepDef.executeIf) {
      const shouldExecute = this.conditionalEvaluator.evaluate(
        stepDef.executeIf,
        context
      );

      if (!shouldExecute) {
        console.log(`  ⏭  Skipping step ${stepDef.id} - condition not met`);
        context.markStepSkipped(stepDef.id);
        // Emit step completed even for skipped steps (both local and global)
        if (stepEmitter?.onStepCompleted) {
          stepEmitter.onStepCompleted(stepDef.id, stepDef.name);
        }
        ExecutionEventEmitter.emitStepCompleted(context.executionId, context.agentId, {
          step_index: context.completedSteps.length,
          step_name: stepDef.name,
          step_id: stepDef.id,
          result: { skipped: true },
          duration_ms: 0,
        });
        return;
      }
    }

    // Handle conditional type
    if (stepDef.type === 'conditional') {
      const result = this.conditionalEvaluator.evaluate(
        stepDef.condition!,
        context
      );

      // Store condition result
      context.setStepOutput(stepDef.id, {
        stepId: stepDef.id,
        plugin: 'system',
        action: 'conditional',
        data: { result },
        metadata: {
          success: true,
          executedAt: new Date().toISOString(),
          executionTime: 0,
        },
      });

      console.log(`  ✓ Condition evaluated: ${result}`);
      await this.stateManager.checkpoint(context);
      // Emit step completed event
      if (stepEmitter?.onStepCompleted) {
        stepEmitter.onStepCompleted(stepDef.id, stepDef.name);
      }
      return;
    }

    // Handle loop type
    if (stepDef.type === 'loop') {
      const results = await this.parallelExecutor.executeLoop(stepDef, context);

      context.setStepOutput(stepDef.id, {
        stepId: stepDef.id,
        plugin: 'system',
        action: 'loop',
        data: results,
        metadata: {
          success: true,
          executedAt: new Date().toISOString(),
          executionTime: 0,
          itemCount: results.length,
        },
      });

      console.log(`  ✓ Loop completed: ${results.length} iterations`);
      await this.stateManager.checkpoint(context);
      // Emit step completed event
      if (stepEmitter?.onStepCompleted) {
        stepEmitter.onStepCompleted(stepDef.id, stepDef.name);
      }
      return;
    }

    // Handle scatter-gather type
    // Phase 3: Advanced Parallel Patterns
    if (stepDef.type === 'scatter_gather') {
      const startTime = Date.now();
      const results = await this.parallelExecutor.executeScatterGather(stepDef, context);

      context.setStepOutput(stepDef.id, {
        stepId: stepDef.id,
        plugin: 'system',
        action: 'scatter_gather',
        data: results,
        metadata: {
          success: true,
          executedAt: new Date().toISOString(),
          executionTime: Date.now() - startTime,
          itemCount: Array.isArray(results) ? results.length : undefined,
        },
      });

      console.log(`  ✓ Scatter-gather completed in ${Date.now() - startTime}ms`);
      await this.stateManager.checkpoint(context);
      // Emit step completed event
      if (stepEmitter?.onStepCompleted) {
        stepEmitter.onStepCompleted(stepDef.id, stepDef.name);
      }
      return;
    }

    // Handle sub-workflow type
    // Phase 5: Sub-Workflows
    if (stepDef.type === 'sub_workflow') {
      const startTime = Date.now();
      const result = await this.executeSubWorkflow(stepDef, context);

      context.setStepOutput(stepDef.id, {
        stepId: stepDef.id,
        plugin: 'system',
        action: 'sub_workflow',
        data: result.data,
        metadata: {
          success: result.success,
          executedAt: new Date().toISOString(),
          executionTime: Date.now() - startTime,
          subWorkflowStepCount: result.stepCount,
          error: result.error,
        },
      });

      console.log(`  ✓ Sub-workflow completed in ${Date.now() - startTime}ms`);
      await this.stateManager.checkpoint(context);

      // Handle errors based on onError setting
      if (!result.success) {
        const onError = stepDef.onError || 'throw';
        if (onError === 'throw') {
          // Emit step failed event
          if (stepEmitter?.onStepFailed) {
            stepEmitter.onStepFailed(stepDef.id, stepDef.name, result.error || 'Unknown error');
          }
          throw new ExecutionError(
            `Sub-workflow ${stepDef.id} failed: ${result.error}`,
            'SUB_WORKFLOW_FAILED',
            stepDef.id
          );
        } else if (onError === 'continue') {
          console.log(`  ⚠️  Sub-workflow failed but continuing: ${result.error}`);
          // Emit step completed event even for failed sub-workflows that continue
          if (stepEmitter?.onStepCompleted) {
            stepEmitter.onStepCompleted(stepDef.id, stepDef.name);
          }
        }
        // 'return_error' - error is already in result.data
      } else {
        // Emit step completed event
        if (stepEmitter?.onStepCompleted) {
          stepEmitter.onStepCompleted(stepDef.id, stepDef.name);
        }
      }

      return;
    }

    // Handle human approval type
    // Phase 6: Human-in-the-Loop
    if (stepDef.type === 'human_approval') {
      const startTime = Date.now();
      const result = await this.executeHumanApproval(stepDef, context);

      context.setStepOutput(stepDef.id, {
        stepId: stepDef.id,
        plugin: 'system',
        action: 'human_approval',
        data: result.data,
        metadata: {
          success: result.approved,
          executedAt: new Date().toISOString(),
          executionTime: Date.now() - startTime,
          error: result.error,
        },
      });

      console.log(`  ✓ Human approval completed in ${Date.now() - startTime}ms: ${result.approved ? 'APPROVED' : 'REJECTED'}`);
      await this.stateManager.checkpoint(context);

      // Emit appropriate event
      if (!result.approved) {
        // Emit step failed event
        if (stepEmitter?.onStepFailed) {
          stepEmitter.onStepFailed(stepDef.id, stepDef.name, 'Approval rejected');
        }
        throw new ExecutionError(
          `Approval rejected for step ${stepDef.id}`,
          'APPROVAL_REJECTED',
          stepDef.id,
          { approvalId: result.approvalId, responses: result.responses }
        );
      } else {
        // Emit step completed event
        if (stepEmitter?.onStepCompleted) {
          stepEmitter.onStepCompleted(stepDef.id, stepDef.name);
        }
      }

      return;
    }

    // Execute step with retry policy (use step-level or default from config)
    context.currentStep = stepDef.id;

    const retryPolicy = stepDef.retryPolicy || this.options?.defaultRetryPolicy;
    const output = await this.errorRecovery.executeWithRetry(
      () => this.stepExecutor.execute(stepDef, context),
      retryPolicy,
      stepDef.id
    );

    // Store output
    context.setStepOutput(stepDef.id, output);

    // Checkpoint
    await this.stateManager.checkpoint(context);

    // Emit appropriate event (both local and global)
    if (output.metadata.success) {
      console.log(`  ✓ Completed in ${output.metadata.executionTime}ms`);
      // Emit step completed event
      if (stepEmitter?.onStepCompleted) {
        stepEmitter.onStepCompleted(stepDef.id, stepDef.name);
      }
      ExecutionEventEmitter.emitStepCompleted(context.executionId, context.agentId, {
        step_index: context.completedSteps.length,
        step_name: stepDef.name,
        step_id: stepDef.id,
        result: output.data,
        duration_ms: output.metadata.executionTime || 0,
      });
    } else {
      console.error(`  ✗ Failed: ${output.metadata.error}`);
      // Emit step failed event
      if (stepEmitter?.onStepFailed) {
        stepEmitter.onStepFailed(stepDef.id, stepDef.name, output.metadata.error || 'Unknown error');
      }
      ExecutionEventEmitter.emitStepFailed(context.executionId, context.agentId, {
        step_index: context.completedSteps.length,
        step_name: stepDef.name,
        step_id: stepDef.id,
        error: output.metadata.error || 'Unknown error',
        duration_ms: output.metadata.executionTime || 0,
      });

      // Check if we should continue on error
      if (!stepDef.continueOnError && !options.continueOnError) {
        throw new ExecutionError(
          `Step ${stepDef.id} failed: ${output.metadata.error}`,
          output.metadata.errorCode || 'STEP_EXECUTION_FAILED',
          stepDef.id
        );
      }
    }
  }

  /**
   * Execute parallel group
   */
  private async executeParallelGroup(
    steps: ExecutionStep[],
    context: ExecutionContext
  ): Promise<void> {
    const stepDefs = steps.map(s => s.stepDefinition);

    const results = await this.parallelExecutor.executeParallel(stepDefs, context);

    // Store all results
    results.forEach((output, stepId) => {
      context.setStepOutput(stepId, output);
    });

    // Checkpoint
    await this.stateManager.checkpoint(context);

    const successCount = Array.from(results.values()).filter(o => o.metadata.success).length;
    console.log(`  ✓ Parallel group completed: ${successCount}/${results.size} successful`);
  }

  /**
   * Execute sub-workflow
   * Phase 5: Sub-Workflows
   */
  private async executeSubWorkflow(
    step: SubWorkflowStep,
    parentContext: ExecutionContext
  ): Promise<{
    success: boolean;
    data: any;
    error?: string;
    stepCount: number;
  }> {
    console.log(`🔄 [WorkflowPilot] Executing sub-workflow: ${step.id}`);

    try {
      // 1. Resolve workflow steps
      let subWorkflowSteps: WorkflowStep[];

      if (step.workflowSteps) {
        // Inline workflow definition
        subWorkflowSteps = step.workflowSteps;
        console.log(`  → Using inline workflow (${subWorkflowSteps.length} steps)`);
      } else if (step.workflowId) {
        // Load workflow from database
        console.log(`  → Loading workflow from database: ${step.workflowId}`);
        const { data: workflow, error } = await this.supabase
          .from('agents')
          .select('workflow_steps')
          .eq('id', step.workflowId)
          .single();

        if (error || !workflow) {
          throw new ExecutionError(
            `Failed to load workflow ${step.workflowId}: ${error?.message}`,
            'WORKFLOW_NOT_FOUND',
            step.id
          );
        }

        subWorkflowSteps = (workflow.workflow_steps as WorkflowStep[]) || [];
      } else {
        throw new ExecutionError(
          'Sub-workflow step must have either workflowSteps or workflowId',
          'MISSING_WORKFLOW_DEFINITION',
          step.id
        );
      }

      if (subWorkflowSteps.length === 0) {
        console.log(`  ⚠️  Sub-workflow has no steps, returning empty result`);
        return {
          success: true,
          data: {},
          stepCount: 0,
        };
      }

      // 2. Create nested execution context
      // Create a minimal agent object for the sub-workflow
      const subAgent: Agent = {
        ...parentContext.agent,
        id: parentContext.agentId + '_sub_' + step.id,
        agent_name: `${parentContext.agent.agent_name} > ${step.name}`,
        workflow_steps: subWorkflowSteps,
      };

      const subContext = new ExecutionContext(
        parentContext.executionId + '_' + step.id,
        subAgent,
        parentContext.userId,
        parentContext.sessionId,
<<<<<<< Updated upstream
        {} // Empty input values - we'll map them manually
=======
        {}, // Empty input values - we'll map them manually
        parentContext.batchCalibrationMode, // Inherit batch calibration mode
        parentContext.workflowConfig // Inherit workflow config from parent
>>>>>>> Stashed changes
      );

      // 3. Map inputs from parent context to sub-workflow context
      console.log(`  → Mapping inputs to sub-workflow context`);
      for (const [key, variableRef] of Object.entries(step.inputs)) {
        const value = parentContext.resolveVariable?.(variableRef) ?? variableRef;
        subContext.setVariable?.(key, value);
        console.log(`    • ${key} = ${typeof value === 'object' ? JSON.stringify(value).substring(0, 50) + '...' : value}`);
      }

      // 4. Inherit parent context variables if specified
      if (step.inheritContext) {
        console.log(`  → Inheriting parent context variables`);
        // Note: This requires access to parent context variables
        // We'll implement this by copying all variables from parent
        const parentVars = (parentContext as any).variables || {};
        for (const [key, value] of Object.entries(parentVars)) {
          if (!step.inputs[key]) {
            // Only inherit if not already mapped
            subContext.setVariable?.(key, value);
          }
        }
      }

      // 5. Parse and execute sub-workflow
      console.log(`  → Parsing sub-workflow (${subWorkflowSteps.length} steps)`);
      const executionPlan = this.parser.parse(subWorkflowSteps);

      console.log(`  → Executing sub-workflow execution plan`);
      const startTime = Date.now();

      // Execute with timeout if specified
      let executionPromise = this.executeWorkflowSteps(executionPlan, subContext);

      if (step.timeout) {
        executionPromise = Promise.race([
          executionPromise,
          new Promise<void>((_, reject) =>
            setTimeout(() => reject(new ExecutionError(
              `Sub-workflow timeout after ${step.timeout}ms`,
              'SUB_WORKFLOW_TIMEOUT',
              step.id
            )), step.timeout)
          ),
        ]);
      }

      await executionPromise;

      const executionTime = Date.now() - startTime;
      console.log(`  ✓ Sub-workflow completed successfully in ${executionTime}ms`);

      // 6. Map outputs from sub-workflow back to parent context
      const outputData: Record<string, any> = {};

      if (step.outputMapping) {
        console.log(`  → Mapping outputs back to parent context`);
        for (const [parentKey, subKey] of Object.entries(step.outputMapping)) {
          const value = subContext.resolveVariable?.(subKey) ?? null;
          outputData[parentKey] = value;
          parentContext.setVariable?.(parentKey, value);
          console.log(`    • ${parentKey} ← ${subKey}`);
        }
      } else {
        // No mapping specified - return all sub-workflow outputs
        console.log(`  → Returning all sub-workflow outputs`);
        const allOutputs = subContext.getAllStepOutputs?.() || {};
        Object.assign(outputData, allOutputs);
      }

      return {
        success: true,
        data: outputData,
        stepCount: subWorkflowSteps.length,
      };

    } catch (error: any) {
      console.error(`  ✗ Sub-workflow failed: ${error.message}`);

      return {
        success: false,
        data: { error: error.message },
        error: error.message,
        stepCount: 0,
      };
    }
  }

  /**
   * Execute workflow steps (internal helper for sub-workflows)
   * Phase 5: Sub-Workflows
   */
  private async executeWorkflowSteps(
    executionPlan: any,
    context: ExecutionContext
  ): Promise<void> {
    // Execute each phase in the execution plan
    for (const phase of executionPlan.phases) {
      console.log(`  📋 Phase ${phase.phaseNumber}: ${phase.steps.length} step(s)`);

      if (phase.isParallel) {
        // Execute parallel group
        await this.executeParallelGroup(phase.steps, context);
      } else {
        // Execute sequential steps
        for (const step of phase.steps) {
          await this.executeSingleStep(step, context);
        }
      }
    }
  }

  /**
   * Execute human approval step
   * Phase 6: Human-in-the-Loop
   */
  private async executeHumanApproval(
    step: HumanApprovalStep,
    context: ExecutionContext
  ): Promise<{
    approved: boolean;
    approvalId: string;
    data: any;
    responses?: any[];
    error?: string;
  }> {
    console.log(`✋ [WorkflowPilot] Executing human approval step: ${step.id}`);

    try {
      // Resolve context variables for notification
      const resolvedContext: Record<string, any> = {};
      if (step.context) {
        for (const [key, variableRef] of Object.entries(step.context)) {
          resolvedContext[key] = context.resolveVariable?.(variableRef) ?? variableRef;
        }
      }

      // Create approval request
      const approvalRequest = await this.approvalTracker.createApprovalRequest(
        context.executionId,
        step.id,
        {
          approvers: step.approvers,
          approvalType: step.approvalType,
          title: step.title,
          message: step.message,
          context: resolvedContext,
          timeout: step.timeout,
          timeoutAction: step.onTimeout,
          escalateTo: step.escalateTo,
        }
      );

      console.log(`✋ [WorkflowPilot] Approval request created: ${approvalRequest.id}`);

      // Send notifications
      await this.notificationService.sendApprovalNotifications(approvalRequest, step);

      // Mark workflow as paused
      context.status = 'paused';
      await this.stateManager.checkpoint(context);

      // Wait for approval
      console.log(`⏳ [WorkflowPilot] Waiting for approval...`);
      const result = await this.approvalTracker.waitForApproval(approvalRequest.id);

      // Mark workflow as running again
      context.status = 'running';
      await this.stateManager.checkpoint(context);

      // Get final approval request with all responses
      const finalApproval = await this.approvalTracker.getApprovalRequest(approvalRequest.id);

      const approved = result === 'approved';
      console.log(`✋ [WorkflowPilot] Approval ${approved ? 'APPROVED' : 'REJECTED'}`);

      return {
        approved,
        approvalId: approvalRequest.id,
        data: {
          approvalId: approvalRequest.id,
          status: finalApproval?.status || result,
          responses: finalApproval?.responses || [],
          resolvedAt: new Date().toISOString(),
        },
        responses: finalApproval?.responses,
      };
    } catch (error: any) {
      console.error(`❌ [WorkflowPilot] Human approval failed: ${error.message}`);

      return {
        approved: false,
        approvalId: '',
        data: { error: error.message },
        error: error.message,
      };
    }
  }

  /**
   * Build final output from context
   */
  /**
   * Execute function with timeout
   * @private
   */
  private async executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeoutMs: number,
    executionId: string
  ): Promise<T> {
    return Promise.race([
      fn(),
      new Promise<T>((_, reject) =>
        setTimeout(() => {
          reject(new ExecutionError(
            `Workflow execution timeout after ${timeoutMs}ms`,
            'EXECUTION_TIMEOUT',
            executionId
          ));
        }, timeoutMs)
      ),
    ]);
  }

  private buildFinalOutput(
    context: ExecutionContext,
    outputSchema: any
  ): any {
    console.log('🔍 [buildFinalOutput] Starting output build');
    console.log('🔍 [buildFinalOutput] outputSchema:', JSON.stringify(outputSchema, null, 2));

    // Get all step outputs for debugging
    const allStepOutputs = context.getAllStepOutputs();
    console.log('🔍 [buildFinalOutput] All step outputs:', Array.from(allStepOutputs.entries()).map(([stepId, output]) => ({
      stepId,
      data: output.data
    })));

    // If output schema specifies sources
    if (outputSchema && Array.isArray(outputSchema) && outputSchema.length > 0) {
      console.log('🔍 [buildFinalOutput] Using outputSchema with', outputSchema.length, 'fields');
      const output: any = {};

      outputSchema.forEach((schema: any) => {
        if (schema.source) {
          // Get data from specific step
          try {
            console.log(`🔍 [buildFinalOutput] Resolving field "${schema.name}" from source "${schema.source}"`);
            const value = context.resolveVariable(`{{${schema.source}}}`);
            console.log(`🔍 [buildFinalOutput] Resolved value for "${schema.name}":`, value);
            output[schema.name] = value;
          } catch (error) {
            console.warn(`Failed to resolve output field ${schema.name} from ${schema.source}:`, error);
          }
        } else {
          // If no source is specified, try to find the last relevant step output
          console.log(`🔍 [buildFinalOutput] No source specified for "${schema.name}", finding last relevant output`);

          // For PluginAction type outputs, use the last step's output
          const allOutputs = context.getAllStepOutputs();
          const outputsArray = Array.from(allOutputs.entries());

          if (outputsArray.length > 0) {
            // Use the last step's output as the final result
            const [lastStepId, lastOutput] = outputsArray[outputsArray.length - 1];
            console.log(`🔍 [buildFinalOutput] Using output from last step "${lastStepId}"`);
            output[schema.name] = lastOutput.data;
          } else {
            console.warn(`🔍 [buildFinalOutput] No step outputs available for "${schema.name}"`);
          }
        }
      });

      console.log('🔍 [buildFinalOutput] Final output (schema-based):', JSON.stringify(output, null, 2));
      return output;
    }

    // Default: return all step outputs
    console.log('🔍 [buildFinalOutput] No output schema, returning all step outputs');
    const output: any = {};
    context.getAllStepOutputs().forEach((stepOutput, stepId) => {
      output[stepId] = stepOutput.data;
    });

    console.log('🔍 [buildFinalOutput] Final output (all steps):', JSON.stringify(output, null, 2));
    return output;
  }

  /**
   * Group steps by execution level
   */
  private groupStepsByLevel(steps: ExecutionStep[]): Map<number, ExecutionStep[]> {
    const levels = new Map<number, ExecutionStep[]>();

    steps.forEach(step => {
      if (!levels.has(step.level)) {
        levels.set(step.level, []);
      }
      levels.get(step.level)!.push(step);
    });

    // Sort by level
    return new Map([...levels.entries()].sort((a, b) => a[0] - b[0]));
  }

  /**
   * Group steps by parallel group
   */
  private groupByParallelGroup(steps: ExecutionStep[]): ExecutionStep[][] {
    const groups: Map<string, ExecutionStep[]> = new Map();
    const ungrouped: ExecutionStep[] = [];

    steps.forEach(step => {
      if (step.parallelGroupId) {
        if (!groups.has(step.parallelGroupId)) {
          groups.set(step.parallelGroupId, []);
        }
        groups.get(step.parallelGroupId)!.push(step);
      } else {
        ungrouped.push(step);
      }
    });

    return [
      ...Array.from(groups.values()),
      ...ungrouped.map(s => [s]),
    ];
  }

  /**
   * Update AIS metrics after execution
   */
  private async updateAISMetrics(
    agentId: string,
    context: ExecutionContext
  ): Promise<void> {
    console.log(`📊 [WorkflowPilot] Updating AIS metrics for agent ${agentId}`);

    const executionData = {
      agent_id: agentId,
      execution_id: context.executionId,
      status: 'success',
      duration_ms: context.totalExecutionTime,
      tokens_used: context.totalTokensUsed,
      plugin_calls: Array.from(context.getAllStepOutputs().values()).filter(
        o => o.plugin !== 'system'
      ).length,
      workflow_steps_executed: context.completedSteps.length,
      iterations: 1,
      model_used: 'workflow',
      provider: 'orchestrator',
    };

    await updateAgentIntensityMetrics(this.supabase, executionData);

    console.log(`✅ [WorkflowPilot] AIS metrics updated`);
  }

  /**
   * Summarize execution for memory
   * @returns Number of tokens used for memory summarization
   */
  private async summarizeForMemory(
    agentId: string,
    userId: string,
    executionId: string,
    context: ExecutionContext
  ): Promise<number> {
    console.log(`🧠 [WorkflowPilot] Summarizing execution for memory`);

    // Create instance and call method (uses service role client internally)
    const memorySummarizer = new MemorySummarizer();

    // Call memory summarization and capture token usage
    // NOTE: run_number is calculated atomically inside MemorySummarizer to avoid race conditions
    let memoryTokens = 0;
    try {
      const memoryResult = await memorySummarizer.summarizeExecution({
        execution_id: executionId,
        agent_id: agentId,
        user_id: userId,
        run_number: 0, // Placeholder - MemorySummarizer will calculate atomically
        agent_name: context.agent.agent_name,
        agent_description: context.agent.system_prompt || context.agent.user_prompt || '',
        agent_mode: 'workflow_orchestrator',
        input: context.inputValues,
        output: this.buildFinalOutput(context, context.agent.output_schema),
        status: context.failedSteps.length > 0 ? 'failed' : 'success',
        model_used: 'workflow_orchestrator',
        credits_consumed: 0, // Will be calculated after adding memory tokens
        execution_time_ms: context.totalExecutionTime,
      });

      memoryTokens = memoryResult.tokensUsed.total;
      console.log(`✅ [WorkflowPilot] Memory summarization complete (${memoryTokens} tokens)`);
    } catch (error: any) {
      console.error(`⚠️  [WorkflowPilot] Memory summarization failed (non-critical):`, error.message);
      // Don't throw - memory summarization is non-critical to workflow execution
    }

    // Return memory tokens so caller can add to total
    return memoryTokens;
  }

  /**
   * Resume paused execution from checkpoint
   */
  async resume(executionId: string): Promise<WorkflowExecutionResult> {
    console.log(`▶️  [WorkflowPilot] Resuming execution ${executionId}`);

    // 1. Load execution state and context from database
    const { context, agent } = await this.stateManager.resumeExecution(executionId);

    console.log(`📋 [WorkflowPilot] Loaded execution state:`, {
      completedSteps: context.completedSteps.length,
      failedSteps: context.failedSteps.length,
      currentStep: context.currentStep,
    });

    // 2. Parse workflow to get execution plan
    const workflowSteps = (agent.workflow_steps as WorkflowStep[]) || [];
    if (workflowSteps.length === 0) {
      throw new ValidationError(
        'Agent has no workflow steps defined',
        undefined,
        { agent_id: agent.id }
      );
    }

    const executionPlan = this.parser.parse(workflowSteps);

    // 3. Filter to only incomplete steps (skip completed and failed)
    const remainingSteps = executionPlan.steps.filter(step =>
      !context.completedSteps.includes(step.stepId) &&
      !context.failedSteps.includes(step.stepId)
    );

    console.log(`📊 [WorkflowPilot] Resume analysis:`, {
      totalSteps: executionPlan.totalSteps,
      completedSteps: context.completedSteps.length,
      failedSteps: context.failedSteps.length,
      remainingSteps: remainingSteps.length,
    });

    if (remainingSteps.length === 0) {
      console.log(`✅ [WorkflowPilot] No remaining steps - execution already complete`);

      // Build final output from context
      const finalOutput = this.buildFinalOutput(context, agent.output_schema);

      return {
        success: true,
        executionId: executionId,
        output: finalOutput,
        stepsCompleted: context.completedSteps.length,
        stepsFailed: context.failedSteps.length,
        stepsSkipped: context.skippedSteps.length,
        totalExecutionTime: context.totalExecutionTime,
        totalTokensUsed: context.totalTokensUsed,
      };
    }

    // 4. Update status to running
    await this.stateManager.updateWorkflowStatus(executionId, 'running');

    // 5. Audit: Execution resumed
    await this.auditTrail.log({
      action: AUDIT_EVENTS.PILOT_EXECUTION_RESUMED,
      entityType: 'agent',
      entityId: executionId,
      userId: context.userId,
      resourceName: agent.agent_name,
      details: {
        agent_id: agent.id,
        remaining_steps: remainingSteps.length,
        completed_steps: context.completedSteps.length,
        current_step: context.currentStep,
      },
      severity: 'info',
    });

    try {
      // 6. Continue execution from remaining steps
      const startTime = Date.now();

      // Execute remaining steps using the same logic as normal execution
      for (const executionStep of remainingSteps) {
        const step = executionStep.stepDefinition;

        // Check if dependencies are met (completed steps)
        const depsMet = (step.dependencies || []).every(depId =>
          context.completedSteps.includes(depId)
        );

        if (!depsMet) {
          console.log(`⏭️  [WorkflowPilot] Skipping ${step.id} - dependencies not met`);
          context.skippedSteps.push(step.id);
          continue;
        }

        // Check conditional execution
        if (step.executeIf) {
          const shouldExecute = this.conditionalEvaluator.evaluate(
            step.executeIf,
            context
          );

          if (!shouldExecute) {
            console.log(`⏭️  [WorkflowPilot] Skipping ${step.id} - condition not met`);
            context.skippedSteps.push(step.id);
            continue;
          }
        }

        // Execute step
        console.log(`▶️  [WorkflowPilot] Executing resumed step: ${step.id} - ${step.name}`);
        const result = await this.stepExecutor.execute(step, context);

        // Update context
        context.setStepOutput(step.id, result);
        context.completedSteps.push(step.id);

        // Handle both number and object formats for tokensUsed
        const tokens = result.metadata?.tokensUsed;
        if (typeof tokens === 'number') {
          context.totalTokensUsed += tokens;
        } else if (tokens && typeof tokens === 'object' && 'total' in tokens) {
          context.totalTokensUsed += tokens.total;
        }

        // Checkpoint after each step
        await this.stateManager.checkpoint(context);
      }

      // 7. Calculate total execution time
      const resumeExecutionTime = Date.now() - startTime;
      context.totalExecutionTime += resumeExecutionTime;

      // 8. Build final output
      const finalOutput = this.buildFinalOutput(context, agent.output_schema);

      // 9. Validate output
      const validationResult = await this.outputValidator.validate(
        finalOutput,
        agent.output_schema
      );

      if (!validationResult.valid) {
        console.warn(`⚠️  [WorkflowPilot] Output validation failed:`, validationResult.errors);
      }

      // 10. Mark as completed
      await this.stateManager.completeExecution(executionId, finalOutput, context);

      // 11. Audit: Execution completed (skip detailed logging if optimizations enabled)
      if (!this.optimizationsEnabled) {
        await this.auditTrail.log({
          action: AUDIT_EVENTS.PILOT_EXECUTION_COMPLETED,
          entityType: 'agent',
          entityId: executionId,
          userId: context.userId,
          resourceName: agent.agent_name,
          details: {
            steps_completed: context.completedSteps.length,
            steps_failed: context.failedSteps.length,
            steps_skipped: context.skippedSteps.length,
            total_execution_time: context.totalExecutionTime,
            total_tokens_used: context.totalTokensUsed,
            resumed: true,
          },
          severity: 'info',
        });
      }

      // 12. Update AIS metrics (async)
      this.updateAISMetrics(agent.id, context).catch(err =>
        console.error('❌ AIS update failed (non-critical):', err)
      );

      // 13. Summarize for memory (SYNCHRONOUS - must wait to get token count)
      let memoryTokens = 0;
      try {
        memoryTokens = await this.summarizeForMemory(agent.id, context.userId, executionId, context);
        console.log(`✅ Memory summarization complete (${memoryTokens} tokens)`);
      } catch (err) {
        console.error('❌ Memory summarization failed (non-critical):', err);
      }

      // Add memory tokens to total
      const totalTokensWithMemory = context.totalTokensUsed + memoryTokens;
      console.log(`📊 [WorkflowPilot] Final token count: ${context.totalTokensUsed} (steps) + ${memoryTokens} (memory) = ${totalTokensWithMemory}`);

      console.log(`✅ [WorkflowPilot] Resumed execution completed successfully: ${executionId}`);

      return {
        success: true,
        executionId: executionId,
        output: finalOutput,
        stepsCompleted: context.completedSteps.length,
        stepsFailed: context.failedSteps.length,
        stepsSkipped: context.skippedSteps.length,
        totalExecutionTime: context.totalExecutionTime,
        totalTokensUsed: totalTokensWithMemory,
      };

    } catch (error: any) {
      console.error(`❌ [WorkflowPilot] Resume execution failed:`, error);

      // Mark as failed
      await this.stateManager.failExecution(executionId, error.message);

      // Audit: Execution failed
      await this.auditTrail.log({
        action: AUDIT_EVENTS.PILOT_EXECUTION_FAILED,
        entityType: 'agent',
        entityId: executionId,
        userId: context.userId,
        resourceName: agent.agent_name,
        details: {
          error: error.message,
          steps_completed: context.completedSteps.length,
          steps_failed: context.failedSteps.length,
          resumed: true,
        },
        severity: 'error',
      });

      throw error;
    }
  }

  /**
   * Cancel running execution
   */
  async cancel(executionId: string): Promise<void> {
    console.log(`⏹  [WorkflowPilot] Cancelling execution ${executionId}`);

    await this.stateManager.cancelExecution(executionId);

    console.log(`✅ [WorkflowPilot] Execution cancelled`);
  }
}
