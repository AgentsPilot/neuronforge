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

import { SupabaseClient, createClient } from '@supabase/supabase-js';
import type {
  Agent,
  WorkflowStep,
  WorkflowExecutionResult,
  PilotOptions,
  ExecutionStep,
  SubWorkflowStep,
  HumanApprovalStep,
  StepOutput,
  ActionStep,
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
import { MemoryConfigService } from '@/lib/memory/MemoryConfigService';
import { updateAgentIntensityMetrics } from '@/lib/utils/updateAgentIntensity';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { SystemConfigService } from '@/lib/services/SystemConfigService';
import { ExecutionEventEmitter } from '@/lib/execution/ExecutionEventEmitter';
import { WorkflowOrchestrator } from '@/lib/orchestration';
import { PilotConfigService } from './PilotConfigService';
import { StepCache } from './StepCache';
import { DebugSessionManager } from '@/lib/debug/DebugSessionManager';
import { WorkflowValidator } from './WorkflowValidator';
import { ShadowAgent } from './shadow/ShadowAgent';
import { CheckpointManager } from './shadow/CheckpointManager';
import { ResumeOrchestrator } from './shadow/ResumeOrchestrator';
import { IssueCollector } from './shadow/IssueCollector';
import { ExecutionSummaryCollector } from './shadow/ExecutionSummaryCollector';

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
  private workflowValidator: WorkflowValidator;
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
    this.stepExecutor.setParallelExecutor(this.parallelExecutor); // Inject ParallelExecutor for nested scatter-gather support
    this.conditionalEvaluator = new ConditionalEvaluator();
    this.errorRecovery = new ErrorRecovery();
    this.outputValidator = new OutputValidator();
    this.workflowValidator = new WorkflowValidator(); // PHASE 5: Pre-flight validation
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
    this.stepExecutor.setParallelExecutor(this.parallelExecutor); // Re-inject after reinitialization

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
    },
    debugMode?: boolean,
    providedDebugRunId?: string,
    providedExecutionId?: string,
    runMode?: 'calibration' | 'production' | 'batch_calibration'  // Separate from execution_type (manual/scheduled)
  ): Promise<WorkflowExecutionResult> {
    console.log(`🚀 [WorkflowPilot] Starting execution for agent ${agent.id}: ${agent.agent_name}`);

    // Generate sessionId if not provided (must be UUID format for database)
    const finalSessionId = sessionId || crypto.randomUUID();

    // Create debug session if debug mode is enabled
    let debugRunId: string | null = null;
    if (debugMode) {
      console.log(`🐛 [WorkflowPilot] Debug mode enabled, providedDebugRunId: ${providedDebugRunId}`);

      // Use provided debugRunId if available, otherwise generate new one
      debugRunId = providedDebugRunId || crypto.randomUUID();
      console.log(`🐛 [WorkflowPilot] Using debugRunId: ${debugRunId} ${providedDebugRunId ? '(from frontend)' : '(generated)'}`);

      // Create or get the session (idempotent)
      const existingSession = DebugSessionManager.getSession(debugRunId);
      if (!existingSession) {
        DebugSessionManager.createSession(debugRunId, agent.id, userId);
        console.log(`🐛 [WorkflowPilot] Created debug session: ${debugRunId}`);
      } else {
        console.log(`🐛 [WorkflowPilot] Using existing debug session: ${debugRunId}`);
      }
    } else {
      console.log(`🐛 [WorkflowPilot] Debug mode is NOT enabled (debugMode=${debugMode})`);
    }

    // Store stepEmitter and debugRunId in instance for use during execution
    (this as any).stepEmitter = stepEmitter;
    (this as any).debugRunId = debugRunId;

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

    // PHASE 5: Pre-flight validation before execution
    console.log('🔍 [WorkflowPilot] Running pre-flight validation...');
    const validation = this.workflowValidator.validatePreFlight(workflowSteps);

    if (!validation.valid) {
      const errorMessage = `Workflow pre-flight validation failed: ${validation.errors.join(', ')}`;
      console.error(`❌ [WorkflowPilot] ${errorMessage}`);

      throw new ValidationError(
        errorMessage,
        undefined,
        {
          agent_id: agent.id,
          validation_errors: validation.errors,
          step_count: workflowSteps.length
        }
      );
    }

    if (validation.warnings && validation.warnings.length > 0) {
      console.warn(`⚠️  [WorkflowPilot] Pre-flight warnings: ${validation.warnings.join(', ')}`);
    }

    console.log('✅ [WorkflowPilot] Pre-flight validation passed');

    // 2. Initialize execution context
    // Declare variables outside so catch block can access them
    let executionId: string;
    let context: ExecutionContext;

    executionId = await this.stateManager.createExecution(
      agent,
      userId,
      finalSessionId,
      executionPlan,
      inputValues,
      providedExecutionId,
      runMode === 'batch_calibration' ? 'calibration' : runMode
    );

    // Determine if this is batch calibration mode
    const isBatchCalibration = runMode === 'batch_calibration';

    // Extract workflow configuration from agent (if stored)
    // Config is used for {{config.key}} variable references in workflow steps
    const workflowConfig = this.extractWorkflowConfig(agent);

    context = new ExecutionContext(
      executionId,
      agent,
      userId,
      finalSessionId,
      inputValues,
      isBatchCalibration,
      workflowConfig
    );

    // Initialize execution summary collector for calibration runs
    let executionSummaryCollector: ExecutionSummaryCollector | null = null;
    if (runMode === 'calibration' || runMode === 'batch_calibration') {
      executionSummaryCollector = new ExecutionSummaryCollector();
      (this as any).executionSummaryCollector = executionSummaryCollector;
      // Attach to context so StepExecutor can access it for nested steps
      (context as any).executionSummaryCollector = executionSummaryCollector;
      console.log(`📊 [WorkflowPilot] Execution summary collector initialized for ${runMode} mode`);
    }

    // 2b. Shadow Agent: lifecycle-aware initialization
    let shadowAgent: ShadowAgent | null = null;
    try {
      // Force Shadow Agent active in calibration mode, regardless of production_ready status
      const shadowActive = runMode === 'calibration' || await ShadowAgent.isActive(this.supabase, agent.id);
      if (shadowActive) {
        // Use admin client for ShadowAgent to bypass RLS policies
        shadowAgent = new ShadowAgent(supabaseAdmin, agent.id, userId);
        console.log(`[ShadowAgent] Active for agent ${agent.id} (${runMode === 'calibration' ? 'forced by calibration mode' : 'calibrating'})`);
      } else {
        console.log(`[ShadowAgent] Dormant for agent ${agent.id} (production ready)`);
      }
    } catch (shadowInitErr) {
      // Shadow init failure must NEVER block execution
      console.error('[ShadowAgent] Init failed (non-blocking):', shadowInitErr);
    }
    // Store on instance for use in executeSingleStep
    (this as any)._shadowAgent = shadowAgent;

    // 2c. Execution Protection: calibration guard rails (only when Shadow Agent is active)
    let executionProtection: import('./shadow/ExecutionProtection').ExecutionProtection | null = null;
    if (shadowAgent) {
      try {
        const { ExecutionProtection } = await import('./shadow/ExecutionProtection');
        executionProtection = new ExecutionProtection(this.supabase, agent.id);
      } catch (protErr) {
        console.error('[ExecutionProtection] Init failed (non-blocking):', protErr);
      }
    }
    (this as any)._executionProtection = executionProtection;

    // 2d. CheckpointManager + ResumeOrchestrator (Phase 2: Repair & Resume)
    if (shadowAgent) {
      try {
        const checkpointManager = new CheckpointManager(executionId);
        const resumeOrchestrator = new ResumeOrchestrator(
          shadowAgent,
          checkpointManager,
          executionProtection
        );
        (this as any)._checkpointManager = checkpointManager;
        (this as any)._resumeOrchestrator = resumeOrchestrator;
        console.log(`[ResumeOrchestrator] Initialized for execution ${executionId}`);
      } catch (resumeErr) {
        console.error('[ResumeOrchestrator] Init failed (non-blocking):', resumeErr);
        (this as any)._checkpointManager = null;
        (this as any)._resumeOrchestrator = null;
      }
    } else {
      (this as any)._checkpointManager = null;
      (this as any)._resumeOrchestrator = null;
    }

    // 3. Load memory context and initialize orchestration IN PARALLEL
    const memoryConfig = await MemoryConfigService.getGlobalConfig(this.supabase);

    // Helper function for memory loading with timeout
    const loadMemoryWithTimeout = async (): Promise<void> => {
      if (!memoryConfig.enabled) {
        console.log(`🔇 [WorkflowPilot] Memory disabled via config`);
        return;
      }

      try {
        const memoryInjector = new MemoryInjector(this.supabase);

        // Race between memory loading and configurable timeout
        // Default: 10s (allows for cold starts and database queries on Vercel)
        const memoryTimeout = this.options.memoryLoadTimeoutMs || 10000;
        const memoryContext = await Promise.race([
          memoryInjector.buildMemoryContext(agent.id, userId, { userInput, inputValues }),
          new Promise<null>((_, reject) =>
            setTimeout(() => reject(new Error(`Memory loading timeout (${memoryTimeout}ms)`)), memoryTimeout)
          )
        ]);

        if (memoryContext) {
          context.memoryContext = memoryContext;
          if (memoryConfig.debug_mode) {
            console.log(`🧠 [WorkflowPilot] Loaded memory context: ${memoryContext.token_count} tokens`);
          }
        }
      } catch (error: any) {
        if (error.message.includes('timeout')) {
          console.warn(`⏱️  [WorkflowPilot] Memory loading timed out - proceeding without memory`);
        } else {
          console.warn(`⚠️  [WorkflowPilot] Failed to load memory (non-critical):`, error.message);
        }
      }
    };

    // Helper function for orchestration initialization
    const initializeOrchestration = async (): Promise<void> => {
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
    };

    // Run memory loading and orchestration initialization in parallel
    await Promise.all([
      loadMemoryWithTimeout(),
      initializeOrchestration()
    ]);

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

      // 8. Summarize for memory (ASYNC - fire and forget, don't block response)
      let memoryTokens = 0;

      // Fire-and-forget: Don't await, let it run in background
      this.summarizeForMemory(agent.id, userId, executionId, context)
        .then((tokens) => {
          memoryTokens = tokens;
          console.log(`✅ Memory summarization complete (${tokens} tokens)`);
        })
        .catch((err) => {
          console.error('❌ Memory summarization failed (non-critical):', err);
        });

      // Extract user memories (preferences, context) - also fire-and-forget
      import('@/lib/memory/UserMemoryService').then(({ UserMemoryService }) => {
        const userMemoryService = new UserMemoryService(this.supabase, process.env.OPENAI_API_KEY!);
        userMemoryService.extractMemoriesFromExecution(
          userId,
          agent.id,
          JSON.stringify({ userInput, inputValues }),
          JSON.stringify(context.finalOutput),
          agent.user_prompt || agent.system_prompt || ''
        ).then(() => {
          console.log(`✅ User memory extraction complete for execution ${executionId}`);
        }).catch((err) => {
          console.error('❌ User memory extraction failed (non-critical):', err);
        });
      });

      // Clear database cache for this execution (calibration complete - no longer needed)
      import('./ExecutionOutputCache').then(({ executionOutputCache }) => {
        executionOutputCache.clearExecution(executionId).catch((err) => {
          console.warn(`[WorkflowPilot] Failed to clear database cache (non-critical):`, err);
        });
      });

      // Note: memoryTokens will be 0 in execution record since summarization runs async
      // This is acceptable - memory summarization shouldn't block user response

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
          // Silently ignore "not found" errors (race condition - DB transaction still completing)
          if (!reconciliationError.message?.includes('not found')) {
            console.warn(`⚠️  [WorkflowPilot] Token reconciliation failed (non-critical):`, reconciliationError.message);
          }
        }
      }, 5000); // Wait 5 seconds for DB transaction to complete (increased from 2s to handle load)

      // 14. Update AIS metrics (async)
      this.updateAISMetrics(agent.id, context).catch(err =>
        console.error('❌ AIS update failed (non-critical):', err)
      );

      // 15. Collect Business Insights (async, production-only, if enabled)
      // IMPORTANT: Collect insights even when there are failures - that's when they're most valuable!
      console.log(`💡 [WorkflowPilot] Checking insights: production_ready=${agent.production_ready}, insights_enabled=${agent.insights_enabled}, failedSteps=${context.failedSteps.length}`);
      if (agent.production_ready && agent.insights_enabled) {
        console.log(`💡 [WorkflowPilot] Insights enabled - collecting business insights for execution ${executionId}`);
        this.collectInsights(executionId, agent.id, context.userId).catch(err =>
          console.error('❌ Insight collection failed (non-critical):', err)
        );
      } else {
        console.log(`💡 [WorkflowPilot] Insights NOT collected. Reasons: production_ready=${!agent.production_ready ? 'false' : 'true'}, insights_enabled=${!agent.insights_enabled ? 'false/undefined' : 'true'}`);
      }

      console.log(`✅ [WorkflowPilot] Execution completed successfully: ${executionId}`);

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

      // Emit execution complete event globally
      ExecutionEventEmitter.emitExecutionComplete(executionId, agent.id, {
        success: true,
        results: finalOutput,
        total_duration_ms: context.totalExecutionTime,
      });

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
        // Include debugRunId if debug mode was enabled
        debugRunId: debugRunId || undefined,
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
        // Batch calibration: include collected issues
        collectedIssues: isBatchCalibration ? context.collectedIssues : undefined,
        // Calibration: include execution summary (aggregated metadata only, no client data)
        execution_summary: executionSummary,
      };
    } catch (error: any) {
      console.error(`❌ [WorkflowPilot] Execution failed:`, error);

      // If execution failed before createExecution completed, throw the error
      // because we don't have an executionId to work with
      if (!executionId) {
        console.error('[WorkflowPilot] Execution failed before executionId was created');
        throw error;
      }

      // Shadow Agent: capture execution-level failure (only if context exists)
      if (shadowAgent && context) {
        try {
          // Use error.stepId if available (from ExecutionError), fallback to context.currentStep
          const failedStepId = error.stepId || context.currentStep || 'unknown';

          await shadowAgent.captureFailure(
            executionId,
            { message: error.message || 'Unknown error', code: error.code },
            {
              stepId: failedStepId,
              stepName: failedStepId,
              stepType: 'unknown',
              availableVariableKeys: [],
              completedSteps: [...context.completedSteps],
              retryCount: 0,
            },
            {
              totalTokensUsed: context.totalTokensUsed,
              totalExecutionTimeMs: context.totalExecutionTime,
            }
          );
        } catch (shadowCaptureErr) {
          console.error('[ShadowAgent] Capture failed (non-blocking):', shadowCaptureErr);
        }
      } else if (!shadowAgent) {
        // Production agent failed — reactivate Shadow for NEXT run
        try {
          await ShadowAgent.onProductionFailure(this.supabase, agent.id);
        } catch (shadowReactivateErr) {
          console.error('[ShadowAgent] Reactivation failed (non-blocking):', shadowReactivateErr);
        }
      }

      // Cleanup debug session
      if (debugRunId) {
        DebugSessionManager.cleanup(debugRunId);
        console.log(`🐛 [WorkflowPilot] Debug session cleaned up after failure: ${debugRunId}`);
      }

      // Cleanup in-memory checkpoints
      const failCpManager = (this as any)._checkpointManager as CheckpointManager | null;
      if (failCpManager) {
        failCpManager.clear();
      }

      // Mark as failed (only if context exists)
      if (context) {
        // CRITICAL: In calibration mode, if it's a parameter error, pause instead of fail
        // This allows the user to fix the parameter and retry
        const isParameterError = error.message && error.message.includes('Parameter error');
        const shouldPause = runMode === 'calibration' && isParameterError;

        if (shouldPause) {
          console.log(`⏸️  [WorkflowPilot] Parameter error in calibration - pausing execution for user fix`);
          await this.stateManager.pauseExecution(executionId, context);
        } else {
          await this.stateManager.failExecution(executionId, error, context);
        }
      }

      // Emit execution error event globally
      ExecutionEventEmitter.emitExecutionError(executionId, agent.id, {
        error: error.message,
        step_index: context ? context.completedSteps.length : 0,
      });

      // Audit: Execution failed
      // Use error.stepId if available (from ExecutionError), fallback to context.currentStep
      const failedStepId = error.stepId || (context ? context.currentStep : undefined);

      await this.auditTrail.log({
        action: AUDIT_EVENTS.PILOT_EXECUTION_FAILED,
        entityType: 'agent',
        entityId: executionId,
        userId: userId,
        resourceName: agent.agent_name,
        details: {
          error: error.message,
          error_code: error.code,
          failed_step: failedStepId,
          steps_completed: context ? context.completedSteps.length : 0,
        },
        severity: 'critical',
      });

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

      return {
        success: false,
        executionId,
        output: null,
        stepsCompleted: context ? context.completedSteps.length : 0,
        stepsFailed: context ? context.failedSteps.length : 0,
        stepsSkipped: context ? context.skippedSteps.length : 0,
        totalExecutionTime: context ? context.totalExecutionTime : 0,
        totalTokensUsed: context ? context.totalTokensUsed : 0,
        error: error.message,
        errorStack: error.stack,
        failedStep: failedStepId || undefined,
        // Include step details for frontend visualization
        completedStepIds: context ? context.completedSteps : [],
        failedStepIds: context ? context.failedSteps : [],
        skippedStepIds: context ? context.skippedSteps : [],
        // CRITICAL: Include collected issues even when execution fails
        // In batch calibration mode, we want to show ALL issues collected before the fatal error
        collectedIssues: isBatchCalibration && context ? context.collectedIssues : undefined,
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
   * Collect execution metadata from step output for calibration summaries
   * Fully dynamic - uses plugin metadata with NO hardcoded logic
   */
  private async collectStepMetadata(
    collector: ExecutionSummaryCollector,
    step: WorkflowStep,
    output: StepOutput
  ): Promise<void> {
    // Only collect from action steps (plugin executions)
    if (step.type !== 'action') {
      return;
    }

    const actionStep = step as ActionStep;
    const pluginName = actionStep.plugin;
    const actionName = actionStep.action;

    // Load plugin metadata to understand operation type and count fields
    try {
      // Load plugin definition directly from file system
      const fs = await import('fs');
      const path = await import('path');
      const definitionsDir = path.join(process.cwd(), 'lib', 'plugins', 'definitions');
      const fileName = `${pluginName}-plugin-v2.json`;
      const filePath = path.join(definitionsDir, fileName);
      const fileContent = await fs.promises.readFile(filePath, 'utf-8');
      const pluginDef = JSON.parse(fileContent);
      const actionDef = pluginDef?.actions?.[actionName];

      if (!actionDef) {
        console.warn(`[WorkflowPilot] No action definition found for ${pluginName}.${actionName}`);
        return;
      }

      // Use output_schema to dynamically find count field
      const itemCount = this.extractCountFromSchema(output.data, actionDef.output_schema);

      // Determine operation type from usage_context metadata
      const usageContext = actionDef.usage_context || '';
      const isWriteOperation = usageContext.toLowerCase().includes('add') ||
                               usageContext.toLowerCase().includes('create') ||
                               usageContext.toLowerCase().includes('send');

      // Record the data access
      if (isWriteOperation) {
        console.log(`📊 [WorkflowPilot] Recording data write: ${pluginName}.${actionName} (count: ${itemCount})`);
        await collector.recordDataWrite(pluginName, actionName, itemCount);
      } else {
        console.log(`📊 [WorkflowPilot] Recording data read: ${pluginName}.${actionName} (count: ${itemCount})`);
        await collector.recordDataRead(pluginName, actionName, itemCount);
        collector.recordItemsProcessed(itemCount);
      }
    } catch (error) {
      console.warn(`[WorkflowPilot] Could not collect metadata for ${pluginName}.${actionName}:`, error);
    }
  }

  /**
   * Extract count from data using output_schema as a guide
   * Completely dynamic - walks the schema to find array/count fields
   */
  private extractCountFromSchema(data: any, schema: any): number {
    if (!data || !schema) return 0;

    // If data is an array, return length
    if (Array.isArray(data)) {
      return data.length;
    }

    // Walk the schema to find fields that indicate counts
    if (schema.properties) {
      for (const [fieldName, fieldSchema] of Object.entries(schema.properties)) {
        const field = fieldSchema as any;

        // If schema says this field is an array and we have it in data
        if (field.type === 'array' && data[fieldName]) {
          if (Array.isArray(data[fieldName])) {
            return data[fieldName].length;
          }
        }

        // If schema says this field is a count and we have it in data
        if (field.type === 'integer' && data[fieldName] !== undefined) {
          const desc = field.description?.toLowerCase() || '';
          if (desc.includes('count') || desc.includes('number of') || fieldName.includes('count')) {
            return data[fieldName];
          }
        }
      }
    }

    // If we got data but can't determine count from schema, default to 1
    return typeof data === 'object' ? 1 : 0;
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

    // Get step emitter and debug runId references once at the beginning
    const stepEmitter = (this as any).stepEmitter;
    const debugRunId = (this as any).debugRunId;

    // Emit debug step_start event
    if (debugRunId) {
      console.log(`🐛 [DEBUG] debugRunId is set: ${debugRunId}, emitting step_start for ${stepDef.name}`);
      DebugSessionManager.emitEvent(debugRunId, {
        type: 'step_start',
        stepId: stepDef.id,
        stepName: stepDef.name,
        data: {
          stepType: stepDef.type,
          config: stepDef,
          stepIndex: context.completedSteps.length
        }
      });

      // Add delay to give time to click pause
      console.log(`⏱️  [DEBUG] Waiting 5 seconds before step execution to allow pause testing...`);
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Check if paused before executing
      console.log(`🔍 [DEBUG] Checking pause state before executing step ${stepDef.name}...`);
      await DebugSessionManager.checkPause(debugRunId);
      console.log(`✅ [DEBUG] Pause check complete, proceeding with step execution`);
    } else {
      console.log(`⚠️  [DEBUG] debugRunId is NOT set, skipping pause checkpoints`);
    }

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

      // Register output_variable if specified (allows referencing by name instead of step ID)
      const outputVariable = (stepDef as any).output_variable;
      if (outputVariable) {
        context.setVariable(outputVariable, results);
        console.log(`  ✓ Registered output variable: ${outputVariable}`);
      }

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

      // Register output_variable if specified (allows referencing by name instead of step ID)
      const outputVariable = (stepDef as any).output_variable;
      if (outputVariable) {
        context.setVariable(outputVariable, results);
        console.log(`  ✓ Registered output variable: ${outputVariable}`);
      }

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
            stepDef.id,
            { errorCode: 'SUB_WORKFLOW_FAILED' }
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
          stepDef.id,
          { errorCode: 'APPROVAL_REJECTED', approvalId: result.approvalId, responses: result.responses }
        );
      } else {
        // Emit step completed event
        if (stepEmitter?.onStepCompleted) {
          stepEmitter.onStepCompleted(stepDef.id, stepDef.name);
        }
      }

      return;
    }

    // CRITICAL: Create or reset step execution record BEFORE execution
    // This ensures status API shows the step as "running" even before it completes
    await this.stateManager.logStepExecution(
      context.executionId,
      stepDef.id,
      stepDef.name,
      stepDef.type,
      'running',
      {
        plugin: (stepDef as any).plugin,
        action: (stepDef as any).action,
        started_at: new Date().toISOString()
      }
    );

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

    // Register output_variable if specified (allows referencing by name instead of step ID)
    const outputVariable = (stepDef as any).output_variable;
    if (outputVariable) {
      context.setVariable(outputVariable, output.data);
      console.log(`  ✓ Registered output variable: ${outputVariable}`);
    }

    // Collect execution metadata for calibration summaries
    const summaryCollector = (this as any).executionSummaryCollector as ExecutionSummaryCollector | null;
    if (summaryCollector) {
      console.log(`📊 [WorkflowPilot] Step ${stepDef.id} completed - success: ${output.metadata.success}, type: ${stepDef.type}`);
      if (output.metadata.success) {
        try {
          await this.collectStepMetadata(summaryCollector, stepDef, output);
        } catch (collectorErr) {
          console.warn(`[WorkflowPilot] Failed to collect step metadata (non-critical):`, collectorErr);
        }
      }
    }

    // Checkpoint (metadata to DB + in-memory snapshot)
    await this.stateManager.checkpoint(context);
    const checkpointManager = (this as any)._checkpointManager as CheckpointManager | null;
    if (checkpointManager && output.metadata.success) {
      checkpointManager.createStepCheckpoint(context, stepDef.id);
    }

    // Emit appropriate event (both local and global)
    if (output.metadata.success) {
      console.log(`  ✓ Completed in ${output.metadata.executionTime}ms`);

      // CRITICAL: Update step execution record to 'completed' status
      // This ensures status API shows the step as completed
      await this.stateManager.updateStepExecution(
        context.executionId,
        stepDef.id,
        'completed',
        output.metadata
      );

      // Emit debug step_complete event with real data
      if (debugRunId) {
        DebugSessionManager.emitEvent(debugRunId, {
          type: 'step_complete',
          stepId: stepDef.id,
          stepName: stepDef.name,
          data: {
            output: output.data,
            duration: output.metadata.executionTime || 0,
            plugin: output.plugin,
            action: output.action,
            metadata: output.metadata
          }
        });
      }

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

      // Emit debug step_failed event
      if (debugRunId) {
        DebugSessionManager.emitEvent(debugRunId, {
          type: 'step_failed',
          stepId: stepDef.id,
          stepName: stepDef.name,
          error: output.metadata.error || 'Unknown error',
          data: {
            duration: output.metadata.executionTime || 0,
            plugin: output.plugin,
            action: output.action,
            errorCode: output.metadata.errorCode
          }
        });
      }

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

      // ─── ResumeOrchestrator: capture + classify + repair + resume ───
      // Skip ResumeOrchestrator in batch calibration mode - StepExecutor handles issue collection
      const resumeOrchestrator = (this as any)._resumeOrchestrator as ResumeOrchestrator | null;
      let repairSucceeded = false;

      if (resumeOrchestrator && !context.batchCalibrationMode) {
        try {
          const decision = await resumeOrchestrator.handleStepFailure(
            context.executionId,
            stepDef,
            {
              message: output.metadata.error || 'Unknown error',
              code: output.metadata.errorCode,
            },
            context,
            output
          );

          // CRITICAL: Persist metadata changes with retry and verification
          // Parameter error details MUST be saved for frontend repair UI
          console.log('[WorkflowPilot] 📝 Persisting updated metadata to database...');
          console.log('[WorkflowPilot] Metadata being persisted:', JSON.stringify(output.metadata, null, 2));

          const maxRetries = 3;
          let persistSuccess = false;

          for (let retryCount = 0; retryCount < maxRetries; retryCount++) {
            try {
              // Attempt to persist metadata
              await this.stateManager.updateStepExecution(
                context.executionId,
                stepDef.id,
                'failed',
                output.metadata,
                output.metadata.error
              );

              // Verify that parameter_error_details persisted (if present)
              if (output.metadata.parameter_error_details) {
                const verification = await this.stateManager.getStepExecution(
                  context.executionId,
                  stepDef.id
                );

                if (verification?.execution_metadata?.parameter_error_details) {
                  console.log('[WorkflowPilot] ✅ Parameter error metadata verified in database');
                  persistSuccess = true;
                  break;
                } else {
                  console.warn(`[WorkflowPilot] ⚠️  Metadata persistence verification failed (attempt ${retryCount + 1}/${maxRetries})`);
                  if (retryCount < maxRetries - 1) {
                    // Exponential backoff: 100ms, 200ms, 400ms
                    await new Promise(resolve => setTimeout(resolve, 100 * Math.pow(2, retryCount)));
                  }
                }
              } else {
                // No parameter error details to verify
                persistSuccess = true;
                break;
              }
            } catch (err) {
              console.error(`[WorkflowPilot] ❌ Metadata persistence error (attempt ${retryCount + 1}/${maxRetries}):`, err);
              if (retryCount === maxRetries - 1) {
                throw err;
              }
              await new Promise(resolve => setTimeout(resolve, 100 * Math.pow(2, retryCount)));
            }
          }

          if (!persistSuccess) {
            console.error('[WorkflowPilot] ❌ Failed to persist parameter error metadata after retries');
            // Don't fail execution, but log prominently
          } else {
            console.log('[WorkflowPilot] ✅ Metadata persisted and verified successfully');
          }

          switch (decision.action) {
            case 'retry_step': {
              // Repair was applied to in-memory data — re-execute the failed step
              console.log(`[ResumeOrchestrator] Re-executing step "${stepDef.name}" after repair...`);
              try {
                const retryPolicy = stepDef.retryPolicy || this.options?.defaultRetryPolicy;
                const reOutput = await this.errorRecovery.executeWithRetry(
                  () => this.stepExecutor.execute(stepDef, context),
                  retryPolicy,
                  stepDef.id
                );

                context.setStepOutput(stepDef.id, reOutput);

                if (reOutput.metadata.success) {
                  repairSucceeded = true;

                  // Mark step output as auto-repaired (for calibration UI badge)
                  reOutput.metadata.auto_repaired = true;
                  if (decision.repairDetails?.proposal) {
                    reOutput.metadata.repair_action = decision.repairDetails.proposal.action;
                    reOutput.metadata.repair_description = decision.repairDetails.proposal.description;
                  }

                  console.log(
                    `[ResumeOrchestrator] Repair successful! Step "${stepDef.name}" completed after repair`
                  );

                  // Emit success events for the repaired step
                  if (debugRunId) {
                    DebugSessionManager.emitEvent(debugRunId, {
                      type: 'step_complete',
                      stepId: stepDef.id,
                      stepName: stepDef.name,
                      data: {
                        output: reOutput.data,
                        duration: reOutput.metadata.executionTime || 0,
                        plugin: reOutput.plugin,
                        action: reOutput.action,
                        metadata: reOutput.metadata,
                        repaired: true
                      }
                    });
                  }
                  if (stepEmitter?.onStepCompleted) {
                    stepEmitter.onStepCompleted(stepDef.id, stepDef.name);
                  }
                  ExecutionEventEmitter.emitStepCompleted(context.executionId, context.agentId, {
                    step_index: context.completedSteps.length,
                    step_name: stepDef.name,
                    step_id: stepDef.id,
                    result: reOutput.data,
                    duration_ms: reOutput.metadata.executionTime || 0,
                  });

                  // Register output_variable if specified
                  const outputVariable = (stepDef as any).output_variable;
                  if (outputVariable) {
                    context.setVariable(outputVariable, reOutput.data);
                  }

                  await this.stateManager.checkpoint(context);
                } else {
                  console.log(`[ResumeOrchestrator] Repair failed — step still failing after repair`);
                  // Mark step as failed and throw to stop execution
                  throw new ExecutionError(
                    `Step ${stepDef.id} failed even after repair attempt: ${output.metadata.error}`,
                    stepDef.id,
                    { errorCode: output.metadata.errorCode || 'REPAIR_FAILED' }
                  );
                }
              } catch (reExecErr) {
                console.error('[ResumeOrchestrator] Re-execution after repair threw:', reExecErr);
                // If repair execution threw an error, stop execution
                throw new ExecutionError(
                  `Step ${stepDef.id} failed during repair execution: ${reExecErr instanceof Error ? reExecErr.message : 'Unknown error'}`,
                  stepDef.id,
                  { errorCode: 'REPAIR_EXECUTION_FAILED' }
                );
              }
              break;
            }

            case 'stop_execution': {
              // Non-recoverable or non-repairable — throw to stop execution
              throw new ExecutionError(
                `Calibration stop: ${decision.reason}`,
                stepDef.id,  // stepId parameter
                { errorCode: output.metadata.errorCode || 'CALIBRATION_STOP' }  // details parameter
              );
            }

            case 'skip_step': {
              // Skip this step and continue
              console.log(`[ResumeOrchestrator] Skipping step "${stepDef.name}": ${decision.reason}`);
              context.skippedSteps.push(stepDef.id);
              return;
            }

            case 'continue_with_fallback': {
              // Continue with empty/default output
              console.log(`[ResumeOrchestrator] Continuing with fallback for "${stepDef.name}": ${decision.reason}`);
              return;
            }
          }
        } catch (resumeErr) {
          // If the error is an ExecutionError (from stop_execution), re-throw it
          if (resumeErr instanceof ExecutionError) {
            throw resumeErr;
          }
          console.error('[ResumeOrchestrator] Flow failed (non-blocking):', resumeErr);
        }
      }

      // If repair succeeded, skip the normal failure path — step is now completed
      if (repairSucceeded) {
        return;
      }

      // In batch calibration mode, StepExecutor already decided whether to continue or stop
      // If we got here, it means we should continue (issue was collected)
      if (context.batchCalibrationMode) {
        console.log(`[WorkflowPilot] 📊 Batch calibration mode: Step failed, continuing to collect more issues`);
        return; // Continue to next step
      }

      // Normal failure path: check if we should continue on error
      if (!stepDef.continueOnError && !this.options?.continueOnError) {
        throw new ExecutionError(
          `Step ${stepDef.id} failed: ${output.metadata.error}`,
          stepDef.id,
          { errorCode: output.metadata.errorCode || 'STEP_EXECUTION_FAILED' }
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

    // Checkpoint (metadata to DB + in-memory batch snapshot)
    await this.stateManager.checkpoint(context);
    const batchCheckpointManager = (this as any)._checkpointManager as CheckpointManager | null;
    if (batchCheckpointManager) {
      const batchStepIds = steps.map(s => s.stepDefinition.id);
      batchCheckpointManager.createBatchCheckpoint(context, batchStepIds);
    }

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
            step.id,
            { errorCode: 'WORKFLOW_NOT_FOUND' }
          );
        }

        subWorkflowSteps = (workflow.workflow_steps as WorkflowStep[]) || [];
      } else {
        throw new ExecutionError(
          'Sub-workflow step must have either workflowSteps or workflowId',
          step.id,
          { errorCode: 'MISSING_WORKFLOW_DEFINITION' }
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
        {}, // Empty input values - we'll map them manually
        parentContext.batchCalibrationMode, // Inherit batch calibration mode
        parentContext.workflowConfig // Inherit workflow config from parent
      );

      // Inherit executionSummaryCollector reference from parent for nested metadata collection
      if ((parentContext as any).executionSummaryCollector) {
        (subContext as any).executionSummaryCollector = (parentContext as any).executionSummaryCollector;
        console.log(`  → Inherited executionSummaryCollector from parent context`);
      }

      // 3. Map inputs from parent context to sub-workflow context
      console.log(`  → Mapping inputs to sub-workflow context`);
      for (const [key, variableRef] of Object.entries(step.inputs)) {
        const value = parentContext.resolveVariable?.(variableRef) ?? variableRef;
        subContext.setVariable?.(key, value);
        console.log(`    • ${key} = ${typeof value === 'object' ? JSON.stringify(this.sanitizeForLogging(value, 50)).substring(0, 100) : value}`);
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

  /**
   * Sanitize data for logging by truncating large base64 strings and file content
   */
  private sanitizeForLogging(data: any, maxLength: number = 200): any {
    if (!data) return data;

    if (typeof data === 'string') {
      // Truncate long strings (likely base64 data)
      if (data.length > maxLength) {
        return `[String truncated - ${data.length} chars]`;
      }
      return data;
    }

    if (Array.isArray(data)) {
      return data.map(item => this.sanitizeForLogging(item, maxLength));
    }

    if (typeof data === 'object') {
      const sanitized: any = {};

      for (const [key, value] of Object.entries(data)) {
        // Detect file content fields
        if (key === '_content' && value && typeof value === 'object') {
          const content = value as any;
          sanitized[key] = {
            filename: content.filename,
            mimeType: content.mimeType,
            size: content.size,
            is_image: content.is_image,
            data: content.data ? `[Base64 data - ${content.data.length} bytes - truncated]` : undefined,
            extracted_text: content.extracted_text ?
              (content.extracted_text.length > 100 ? content.extracted_text.substring(0, 100) + '...' : content.extracted_text)
              : undefined
          };
        } else if (key === 'data' && typeof value === 'string' && value.length > 1000) {
          // Detect large base64 strings in data fields
          sanitized[key] = `[Data truncated - ${value.length} chars]`;
        } else if (key === 'content' && typeof value === 'string' && value.length > 1000) {
          // Detect large content strings
          sanitized[key] = `[Content truncated - ${value.length} chars]`;
        } else {
          sanitized[key] = this.sanitizeForLogging(value, maxLength);
        }
      }

      return sanitized;
    }

    return data;
  }

  private buildFinalOutput(
    context: ExecutionContext,
    outputSchema: any
  ): any {
    console.log('🔍 [buildFinalOutput] Starting output build');
    console.log('🔍 [buildFinalOutput] outputSchema:', JSON.stringify(outputSchema, null, 2));

    // Get all step outputs for debugging (sanitized to prevent massive logs)
    const allStepOutputs = context.getAllStepOutputs();
    console.log('🔍 [buildFinalOutput] All step outputs:', Array.from(allStepOutputs.entries()).map(([stepId, output]) => ({
      stepId,
      data: this.sanitizeForLogging(output.data)
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

      console.log('🔍 [buildFinalOutput] Final output (schema-based):', JSON.stringify(this.sanitizeForLogging(output), null, 2));
      return output;
    }

    // Default: return all step outputs
    console.log('🔍 [buildFinalOutput] No output schema, returning all step outputs');
    const output: any = {};
    context.getAllStepOutputs().forEach((stepOutput, stepId) => {
      output[stepId] = stepOutput.data;
    });

    console.log('🔍 [buildFinalOutput] Final output (all steps):', JSON.stringify(this.sanitizeForLogging(output), null, 2));
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
      user_id: context.userId,
      execution_duration_ms: context.totalExecutionTime,
      tokens_used: context.totalTokensUsed,
      iterations_count: 1,
      was_successful: true,
      plugins_used: Array.from(new Set(
        Array.from(context.getAllStepOutputs().values())
          .map(o => o.plugin)
          .filter(p => p && p !== 'system')
      )),
      tool_calls_count: Array.from(context.getAllStepOutputs().values()).filter(
        o => o.plugin !== 'system'
      ).length,
      workflow_steps: context.completedSteps.length,
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
   * Collect Business Insights from execution patterns
   * Runs asynchronously after execution completes (non-critical)
   * Includes failure detection to alert users about issues like changed spreadsheet names
   */
  private async collectInsights(
    executionId: string,
    agentId: string,
    userId: string
  ): Promise<void> {
    try {
      console.log(`💡 [WorkflowPilot] Starting unified insight collection for execution ${executionId}`);

      // Import dependencies (removed InsightGenerator - using only BusinessInsightGenerator via InsightAnalyzer)
      const { InsightAnalyzer } = await import('@/lib/pilot/insight/InsightAnalyzer');
      const { InsightRepository } = await import('@/lib/repositories/InsightRepository');

      const repository = new InsightRepository(this.supabase);
      const analyzer = new InsightAnalyzer(this.supabase);

      // Run unified analysis (detects patterns + generates insights via BusinessInsightGenerator)
      console.log(`💡 [WorkflowPilot] Running unified analysis for agent ${agentId}...`);
      const analysisResult = await analyzer.analyze(agentId, 20);

      console.log(`💡 [WorkflowPilot] Analysis completed:`);
      console.log(`   - Technical patterns detected: ${analysisResult.patterns.length}`);
      console.log(`   - Business insights generated: ${analysisResult.businessInsights.length}`);
      console.log(`   - Confidence mode: ${analysisResult.confidence_mode}`);
      console.log(`   - Executions analyzed: ${analysisResult.execution_count}`);

      if (analysisResult.patterns.length === 0 && analysisResult.businessInsights.length === 0) {
        console.log(`💡 [WorkflowPilot] No insights generated - system working normally or insufficient data`);
        return;
      }

      // Store technical patterns as data_quality insights
      for (const pattern of analysisResult.patterns) {
        try {
          // Check if this pattern type already exists
          const existing = await repository.findExistingInsight(
            agentId,
            pattern.insight_type,
            7 // Look for insights created in last 7 days
          );

          if (existing) {
            console.log(`💡 [WorkflowPilot] Skipping duplicate technical pattern: "${pattern.insight_type}"`);
            await repository.addExecutionToInsight(existing.id, executionId);
            continue;
          }

          // Convert pattern to insight format with human-readable text
          const insightText = this.formatPatternAsInsight(pattern);

          console.log(`💡 [WorkflowPilot] Saving technical pattern: "${pattern.insight_type}"`);
          const createResult = await repository.create({
            user_id: userId,
            agent_id: agentId,
            execution_ids: pattern.execution_ids.length > 0 ? pattern.execution_ids : [executionId],
            insight_type: pattern.insight_type,
            category: 'data_quality', // Technical patterns are data_quality
            severity: pattern.severity,
            confidence: analysisResult.confidence_mode,
            title: insightText.title,
            description: insightText.description,
            business_impact: insightText.business_impact,
            recommendation: insightText.recommendation,
            pattern_data: pattern.pattern_data,
            metrics: pattern.metrics,
            status: 'new',
          });

          if (createResult) {
            console.log(`✅ [WorkflowPilot] Successfully saved technical pattern: "${pattern.insight_type}"`);
          }
        } catch (err) {
          console.error(`⚠️  [WorkflowPilot] Failed to save technical pattern "${pattern.insight_type}":`, err);
          // Continue with other patterns
        }
      }

      // Store business insights (generated by LLM)
      for (const insight of analysisResult.businessInsights) {
        try {
          // Check for duplicate by title (insights are now context-aware and unique)
          const existing = await repository.findExistingByTitle(
            agentId,
            insight.title,
            7 // Look for insights created in last 7 days
          );

          if (existing) {
            console.log(`💡 [WorkflowPilot] Skipping duplicate insight: "${insight.title}"`);
            await repository.addExecutionToInsight(existing.id, executionId);
            continue;
          }

          // Map BusinessInsight to database format
          const insightType = insight.type as any;  // Type already matches InsightType

          console.log(`💡 [WorkflowPilot] Saving insight: "${insight.title}"`);
          const createResult = await repository.create({
            user_id: userId,
            agent_id: agentId,
            execution_ids: [executionId],  // Current execution
            insight_type: insightType,
            category: 'growth',  // All unified insights are growth category
            severity: insight.severity,
            confidence: analysisResult.confidence_mode,
            title: insight.title,
            description: insight.description,
            business_impact: insight.business_impact,
            recommendation: insight.recommendation,
            pattern_data: {},  // Patterns already processed by BusinessInsightGenerator
            metrics: {},
            status: 'new',
          });

          if (createResult) {
            console.log(`✅ [WorkflowPilot] Successfully saved insight: "${insight.title}"`);
          } else {
            console.error(`❌ [WorkflowPilot] Failed to save insight (no result returned)`);
          }
        } catch (err) {
          console.error(`⚠️  [WorkflowPilot] Failed to save insight "${insight.title}":`, err);
          // Continue with other insights
        }
      }

      console.log(`✅ [WorkflowPilot] Unified insight collection completed (1 LLM call, ${analysisResult.businessInsights.length} insights)`);
    } catch (error) {
      console.error(`❌ [WorkflowPilot] Insight collection failed:`, error);
      // Non-critical failure - don't throw
    }
  }

  /**
   * Format technical pattern as human-readable insight
   */
  private formatPatternAsInsight(pattern: any): {
    title: string;
    description: string;
    business_impact: string;
    recommendation: string;
  } {
    const affectedCount = pattern.execution_ids?.length || 0;
    const frequency = pattern.metrics?.pattern_frequency
      ? `${(pattern.metrics.pattern_frequency * 100).toFixed(0)}%`
      : 'multiple';

    switch (pattern.insight_type) {
      case 'data_unavailable':
        return {
          title: 'Workflow returning empty results',
          description: `The workflow is consistently returning no data in ${frequency} of recent executions. This could indicate: (1) no data available from the source, (2) filters are too restrictive, or (3) source system changes.`,
          business_impact: 'Empty results may mean missing important data or indicate the workflow needs adjustment to match current data patterns.',
          recommendation: 'Review your data source and filters. Check if this is expected (e.g., no complaints is good) or if the workflow configuration needs updating.',
        };

      case 'performance_degradation':
        return {
          title: 'Processing time increased',
          description: `Workflow execution time has increased compared to historical baseline, affecting ${affectedCount} recent run(s).`,
          business_impact: 'Slower processing may delay time-sensitive workflows and increase operational costs.',
          recommendation: 'Review recent changes to the workflow. Check for slow data sources or added complexity in processing steps.',
        };

      case 'cost_optimization':
        return {
          title: 'High token usage detected',
          description: `Token consumption is higher than expected in ${frequency} of executions, indicating potential for cost optimization.`,
          business_impact: 'Higher token usage directly increases operational costs without necessarily improving results.',
          recommendation: 'Review LLM calls for caching opportunities, prompt optimization, or reduce unnecessary context being sent.',
        };

      case 'reliability_risk':
        return {
          title: 'Reliability issue detected',
          description: `Workflow has reliability concerns affecting ${affectedCount} execution(s). This may include missing fallbacks or single points of failure.`,
          business_impact: 'Reliability issues can cause workflow failures and require manual intervention.',
          recommendation: 'Add error handling, fallback mechanisms, or retry logic to improve workflow resilience.',
        };

      case 'automation_opportunity':
        return {
          title: 'Automation opportunity identified',
          description: `Pattern detected in ${frequency} of executions suggesting potential for improved automation or reduced manual intervention.`,
          business_impact: 'Manual steps reduce efficiency and may cause delays in workflow completion.',
          recommendation: 'Review manual approval steps or conditional logic that could be automated based on patterns.',
        };

      case 'schedule_optimization':
        const peakHours = pattern.pattern_data?.sample_data?.peak_hours || [];
        const peakHoursStr = peakHours.length > 0
          ? peakHours.map((h: number) => {
              const period = h >= 12 ? 'PM' : 'AM';
              const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
              return `${hour12}${period}`;
            }).join(', ')
          : 'peak activity times';
        return {
          title: 'Schedule optimization opportunity',
          description: `Workflow runs are concentrated during ${peakHoursStr}. Analysis of ${affectedCount} execution(s) shows ${frequency} occur during peak hours.`,
          business_impact: 'Running workflows during off-peak hours could reduce costs and improve performance by avoiding high-traffic periods.',
          recommendation: `Consider scheduling this workflow during off-peak hours if timing is flexible, or ensure it runs during peak activity (${peakHoursStr}) if real-time processing is important.`,
        };

      default:
        return {
          title: `${pattern.insight_type.replace(/_/g, ' ')} detected`,
          description: `Technical pattern "${pattern.insight_type}" was detected in ${frequency} of recent executions.`,
          business_impact: 'This pattern may affect workflow performance or data quality.',
          recommendation: 'Review the affected executions to understand the root cause and determine if action is needed.',
        };
    }
  }

  /**
   * Resume paused execution from checkpoint
   */
  async resume(executionId: string): Promise<WorkflowExecutionResult> {
    console.log(`▶️  [WorkflowPilot] Resuming execution ${executionId}`);

    // 1. Load execution state and context from database
    const { context, agent, runMode } = await this.stateManager.resumeExecution(executionId);

    console.log(`📋 [WorkflowPilot] Loaded execution state:`, {
      completedSteps: context.completedSteps.length,
      failedSteps: context.failedSteps.length,
      currentStep: context.currentStep,
    });

    // 1b. Initialize ResumeOrchestrator for parameter error detection
    // This ensures step failures during resume get proper parameter error detection
    // IMPORTANT: Force ShadowAgent active during calibration mode, just like execute() does
    try {
      const shadowActive = runMode === 'calibration' || await ShadowAgent.isActive(this.supabase, agent.id);
      if (shadowActive) {
        const { ExecutionProtection } = await import('./shadow/ExecutionProtection');

        const shadowAgent = new ShadowAgent(supabaseAdmin, agent.id, context.userId);
        const checkpointManager = new CheckpointManager(supabaseAdmin);
        const executionProtection = new ExecutionProtection(supabaseAdmin);

        const resumeOrchestrator = new ResumeOrchestrator(
          shadowAgent,
          checkpointManager,
          executionProtection
        );
        (this as any)._checkpointManager = checkpointManager;
        (this as any)._resumeOrchestrator = resumeOrchestrator;
        console.log(`[ResumeOrchestrator] Initialized for resumed execution ${executionId} (${runMode === 'calibration' ? 'forced by calibration mode' : 'calibrating'})`);
      } else {
        (this as any)._checkpointManager = null;
        (this as any)._resumeOrchestrator = null;
        console.log(`[ResumeOrchestrator] Not initialized - Shadow Agent is dormant (production ready)`);
      }
    } catch (resumeErr) {
      console.error('[ResumeOrchestrator] Init failed (non-blocking):', resumeErr);
      (this as any)._checkpointManager = null;
      (this as any)._resumeOrchestrator = null;
    }

    // 2. Parse workflow to get execution plan
    // CRITICAL: Use pilot_steps (normalized format) just like execute() does
    // This ensures we load the UPDATED workflow after user fixes hardcoded values
    const workflowSteps = (agent.pilot_steps as WorkflowStep[]) ||
                         (agent.workflow_steps as WorkflowStep[]) ||
                         [];
    const usingPilotSteps = !!agent.pilot_steps;
    console.log(`📋 [WorkflowPilot] Resume using ${usingPilotSteps ? 'pilot_steps (normalized)' : 'workflow_steps (legacy fallback)'} for execution`);

    if (workflowSteps.length === 0) {
      throw new ValidationError(
        'Agent has no workflow steps defined',
        undefined,
        { agent_id: agent.id }
      );
    }

    const executionPlan = this.parser.parse(workflowSteps);

    // 3. Determine which steps to execute
    let stepsToExecute: ExecutionStep[];

    if (context.completedSteps.length === 0 && context.failedSteps.length === 0) {
      // Fresh restart - execute ALL steps (happens after fixing hardcoded values)
      console.log('🔄 [WorkflowPilot] Fresh restart - executing entire workflow from step 1');
      stepsToExecute = executionPlan.steps;
    } else {
      // Partial resume - filter to only incomplete steps
      console.log('⏭️  [WorkflowPilot] Partial resume - skipping completed steps');
      stepsToExecute = executionPlan.steps.filter(step =>
        !context.completedSteps.includes(step.stepId) &&
        !context.failedSteps.includes(step.stepId)
      );
    }

    const remainingSteps = stepsToExecute;

    console.log(`📊 [WorkflowPilot] Resume analysis:`, {
      totalSteps: executionPlan.totalSteps,
      completedSteps: context.completedSteps.length,
      failedSteps: context.failedSteps.length,
      remainingSteps: remainingSteps.length,
      mode: stepsToExecute.length === executionPlan.totalSteps ? 'fresh_restart' : 'partial_resume'
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

    // 4. Status is already updated to 'running' by resumeExecution() in StateManager

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

        // CRITICAL: Create or reset step execution record BEFORE execution
        // This ensures status API shows the step as "running" even before it completes
        await this.stateManager.logStepExecution(
          context.executionId,
          step.id,
          step.name,
          step.type,
          'running',
          {
            plugin: (step as any).plugin,
            action: (step as any).action,
            started_at: new Date().toISOString()
          }
        );

        // Execute step
        console.log(`▶️  [WorkflowPilot] Executing resumed step: ${step.id} - ${step.name}`);
        const result = await this.stepExecutor.execute(step, context);

        // Check if step failed
        if (!result.metadata?.success) {
          // In batch calibration mode, StepExecutor already handled issue collection
          // Skip ResumeOrchestrator logic to avoid stopping execution prematurely
          if (context.batchCalibrationMode) {
            console.log('[WorkflowPilot] 📊 Batch calibration mode: Step failed, issue already collected by StepExecutor');
            // Continue to next step - don't throw error
          } else {
            // Handle failure - call ResumeOrchestrator for parameter error detection
            const resumeOrchestrator = (this as any)._resumeOrchestrator as any;
            if (resumeOrchestrator) {
              try {
                const decision = await resumeOrchestrator.handleStepFailure(
                  context.executionId,
                  step,
                  {
                    message: result.metadata?.error || 'Unknown error',
                    code: result.metadata?.errorCode,
                  },
                  context,
                  result
                );

                // Persist metadata changes (e.g., parameter_error_details)
                console.log('[WorkflowPilot] 📝 Persisting updated metadata to database...');
                console.log('[WorkflowPilot] Metadata being persisted:', JSON.stringify(result.metadata, null, 2));
                await this.stateManager.updateStepExecution(
                  context.executionId,
                  step.id,
                  'failed',
                  result.metadata,
                  result.metadata?.error
                );
                console.log('[WorkflowPilot] ✅ Metadata persisted successfully');

                // For resume flow, we don't auto-retry - just detect and stop
                // This allows frontend to show repair UI
                if (decision.action === 'stop_execution') {
                  throw new ExecutionError(
                    decision.message || 'Calibration stop: Parameter error detected',
                    step.id,
                    { errorCode: result.metadata?.errorCode }
                  );
                }
              } catch (orchErr: any) {
                console.error('[WorkflowPilot] ResumeOrchestrator error:', orchErr);
                // If it's already an ExecutionError, re-throw it
                if (orchErr.name === 'ExecutionError') {
                  throw orchErr;
                }
                // Otherwise throw a new ExecutionError
                throw new ExecutionError(
                  result.metadata?.error || 'Step execution failed',
                  step.id,
                  { errorCode: result.metadata?.errorCode }
                );
              }
            } else {
              // No ResumeOrchestrator - just throw error
              throw new ExecutionError(
                result.metadata?.error || 'Step execution failed',
                step.id,
                { errorCode: result.metadata?.errorCode }
              );
            }
          }
        }

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

        // CRITICAL: Update step execution record to 'completed' status
        // This ensures status API shows the step as completed
        await this.stateManager.updateStepExecution(
          context.executionId,
          step.id,
          'completed',
          result.metadata
        );

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

      // 13. Summarize for memory (ASYNC - fire and forget, don't block response)
      let memoryTokens = 0;

      // Fire-and-forget: Don't await, let it run in background
      this.summarizeForMemory(agent.id, context.userId, executionId, context)
        .then((tokens) => {
          memoryTokens = tokens;
          console.log(`✅ Memory summarization complete (${tokens} tokens)`);
        })
        .catch((err) => {
          console.error('❌ Memory summarization failed (non-critical):', err);
        });

      // Add memory tokens to total
      const totalTokensWithMemory = context.totalTokensUsed + memoryTokens;
      console.log(`📊 [WorkflowPilot] Final token count: ${context.totalTokensUsed} (steps) + ${memoryTokens} (memory) = ${totalTokensWithMemory}`);

      // Clear database cache for this execution (calibration complete - no longer needed)
      try {
        const { executionOutputCache } = await import('./ExecutionOutputCache');
        await executionOutputCache.clearExecution(executionId);
      } catch (cleanupErr) {
        console.warn(`[WorkflowPilot] Failed to clear database cache (non-critical):`, cleanupErr);
      }

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

      // CRITICAL: In calibration mode, if it's a parameter error, pause instead of fail
      // This allows the user to fix the parameter and retry
      const isParameterError = error.message && error.message.includes('Parameter error');
      const shouldPause = runMode === 'calibration' && isParameterError;

      if (shouldPause) {
        console.log(`⏸️  [WorkflowPilot] Parameter error in calibration - pausing execution for user fix`);
        // Set status to paused instead of failed
        await this.stateManager.pauseExecution(executionId, context);
      } else {
        // Normal failure - mark as failed
        await this.stateManager.failExecution(executionId, error, context);
      }

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
          paused_for_parameter_fix: shouldPause,
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
