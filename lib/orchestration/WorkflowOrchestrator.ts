/**
 * WorkflowOrchestrator
 *
 * Integration layer between OrchestrationService and WorkflowPilot
 * Manages orchestration for complete workflow executions
 *
 * This is different from OrchestrationExecutor which handles API-based step execution.
 * WorkflowOrchestrator handles server-side handler-based execution with full orchestration.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { OrchestrationService, handlerRegistry } from './index';
import type {
  OrchestrationMetadata,
  HandlerContext,
  HandlerResult,
  StepMetadata,
} from './types';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { AUDIT_EVENTS } from '@/lib/audit/events';

export interface WorkflowOrchestrationResult {
  output: any;
  tokensUsed: {
    input: number;
    output: number;
    total: number;
  };
  tokensSaved: number;
  cost: number;
  compressionApplied: boolean;
  routedModel: string;
  executionTime: number;
}

export class WorkflowOrchestrator {
  private supabase: SupabaseClient;
  private auditTrail: AuditTrailService;
  private orchestrationService: OrchestrationService;
  private orchestrationMetadata: OrchestrationMetadata | null = null;

  constructor(supabaseClient: SupabaseClient) {
    this.supabase = supabaseClient;
    this.auditTrail = AuditTrailService.getInstance();
    this.orchestrationService = new OrchestrationService(supabaseClient);
  }

  /**
   * Initialize orchestration for a workflow execution
   * Returns true if orchestration is active, false if disabled
   */
  async initialize(
    workflowId: string,
    agentId: string,
    userId: string,
    steps: any[]
  ): Promise<boolean> {
    console.log('[WorkflowOrchestrator] Initializing orchestration');

    try {
      // Initialize orchestration service
      this.orchestrationMetadata = await this.orchestrationService.initialize(
        workflowId,
        agentId,
        userId,
        steps
      );

      if (!this.orchestrationMetadata) {
        console.log('[WorkflowOrchestrator] Orchestration disabled or initialization failed');
        return false;
      }

      console.log(`[WorkflowOrchestrator] Orchestration initialized: ${this.orchestrationMetadata.executionId}`);

      // Audit: Orchestration initialized
      await this.auditTrail.log({
        action: 'ORCHESTRATION_INITIALIZED',
        entityType: 'workflow',
        entityId: workflowId,
        userId,
        details: {
          executionId: this.orchestrationMetadata.executionId,
          totalSteps: this.orchestrationMetadata.steps.length,
          totalBudget: this.orchestrationMetadata.totalBudget.allocated,
          compressionEnabled: this.orchestrationMetadata.featureFlags.compressionEnabled,
          routingEnabled: this.orchestrationMetadata.featureFlags.aisRoutingEnabled,
        },
        severity: 'info',
      });

      return true;
    } catch (error) {
      console.error('[WorkflowOrchestrator] Initialization error:', error);
      return false;
    }
  }

  /**
   * Execute a single step using orchestration handlers
   * Returns null if orchestration is not initialized (fallback to normal execution)
   */
  async executeStep(
    stepId: string,
    stepInput: any,
    memoryContext?: any,
    plugins?: any
  ): Promise<WorkflowOrchestrationResult | null> {
    // Check if orchestration is initialized
    if (!this.orchestrationMetadata) {
      return null; // Fallback to normal execution
    }

    const startTime = Date.now();

    try {
      // Find step metadata
      const stepMeta = this.orchestrationMetadata.steps.find(s => s.stepId === stepId);
      if (!stepMeta) {
        console.warn(`[WorkflowOrchestrator] Step ${stepId} not found in orchestration metadata`);
        return null;
      }

      console.log(`[WorkflowOrchestrator] Executing step ${stepId} with intent: ${stepMeta.intent}`);

      // ✅ Create workflow_step_executions row BEFORE execution
      // This must happen BEFORE logStepRouting() tries to UPDATE the row
      // RLS policies now allow anon role to INSERT/UPDATE workflow_step_executions
      const { StateManager } = await import('../pilot/StateManager');
      const sm = new StateManager(this.supabase);
      await sm.logStepExecution(
        this.orchestrationMetadata.executionId,
        stepId,
        stepMeta.name || stepId,
        stepInput.step?.type || stepMeta.intent,
        'running',
        {
          started_at: new Date().toISOString(),
          intent: stepMeta.intent,
          orchestrated: true,
        }
      );
      console.log(`✅ [WorkflowOrchestrator] Created step execution record for ${stepId}`);

      // Check budget before execution
      const canProceed = await this.orchestrationService.canStepProceed(
        stepId,
        stepMeta.budget.remaining
      );

      if (!canProceed) {
        console.warn(`[WorkflowOrchestrator] Insufficient budget for step ${stepId}`);

        // Audit: Budget exceeded
        await this.auditTrail.log({
          action: 'ORCHESTRATION_BUDGET_EXCEEDED',
          entityType: 'workflow_step',
          entityId: stepId,
          userId: this.orchestrationMetadata.userId,
          details: {
            budget: stepMeta.budget,
            intent: stepMeta.intent,
          },
          severity: 'warning',
        });

        throw new Error(`Budget exceeded for step ${stepId}`);
      }

      // Re-route with step complexity analysis (enhanced routing)
      // This overrides the initialization-time routing with actual step data
      let finalRoutingDecision = stepMeta.routingDecision;
      let stepAnalysis: any = null;
      let effectiveComplexity: number | undefined;

      if (stepInput.step && this.orchestrationMetadata.featureFlags.aisRoutingEnabled) {
        try {
          // Use the routing service instance from orchestrationService (with correct Supabase client)
          const routingService = this.orchestrationService.getRoutingService();

          // Analyze step complexity FIRST (needed for logging)
          stepAnalysis = await routingService.analyzeStepComplexity(
            stepInput.step,
            stepInput.executionContext
          );

          // Calculate effective complexity (60% agent + 40% step)
          const agentAIS = this.orchestrationMetadata.agentAIS?.combined_score || 5.0;
          effectiveComplexity = (agentAIS * 0.6) + (stepAnalysis.complexityScore * 0.4);

          // Route to appropriate model
          const enhancedRouting = await routingService.route(
            {
              agentId: this.orchestrationMetadata.agentId,
              intent: stepMeta.intent,
              budgetRemaining: stepMeta.budget.remaining,
              previousFailures: 0,
              agentAIS: this.orchestrationMetadata.agentAIS,
            },
            stepInput.step,  // Pass actual step for complexity analysis
            stepInput.context  // Pass execution context
          );

          finalRoutingDecision = enhancedRouting;
          console.log(
            `[WorkflowOrchestrator] Enhanced routing: ${enhancedRouting.tier} tier (${enhancedRouting.model}) - ${enhancedRouting.reason}`
          );

          // ✅ NEW: Log routing decision to database (per-step AIS tracking)
          if (stepAnalysis && effectiveComplexity !== undefined) {
            const stepIndex = this.orchestrationMetadata.steps.findIndex(s => s.stepId === stepId);
            await routingService.logStepRouting(
              this.orchestrationMetadata.executionId,
              stepId,
              stepMeta.name || stepId,
              stepInput.step.type || stepMeta.intent,
              stepIndex,
              stepAnalysis,
              this.orchestrationMetadata.agentAIS?.combined_score || 5.0,
              effectiveComplexity,
              finalRoutingDecision
            );
            console.log(`✅ [WorkflowOrchestrator] Logged per-step routing for ${stepId}`);

            // ✅ NEW: Audit trail for routing decision
            const { logStepRoutingDecision } = await import('@/lib/audit/ais-helpers');
            const { data: agentData } = await this.supabase
              .from('agents')
              .select('agent_name')
              .eq('id', this.orchestrationMetadata.agentId)
              .single();

            await logStepRoutingDecision(
              this.orchestrationMetadata.agentId,
              agentData?.agent_name || 'Unknown Agent',
              this.orchestrationMetadata.userId,
              this.orchestrationMetadata.executionId,
              stepId,
              stepMeta.name || stepId,
              stepInput.step.type || stepMeta.intent,
              stepAnalysis.complexityScore,
              this.orchestrationMetadata.agentAIS?.combined_score || 5.0,
              effectiveComplexity,
              finalRoutingDecision.tier,
              finalRoutingDecision.model,
              finalRoutingDecision.provider,
              finalRoutingDecision.reason
            );
          }
        } catch (routingError) {
          console.warn(`[WorkflowOrchestrator] Enhanced routing failed, using default:`, routingError);
          // Keep original routing decision
        }
      }

      // Build handler context
      const handlerContext: HandlerContext = {
        stepId,
        agentId: this.orchestrationMetadata.agentId,
        userId: this.orchestrationMetadata.userId,  // ✅ Add userId for token tracking
        executionId: this.orchestrationMetadata.executionId,  // ✅ Add executionId for token correlation
        intent: stepMeta.intent,
        input: stepInput,
        budget: stepMeta.budget,
        compressionPolicy: stepMeta.compressionPolicy,
        routingDecision: finalRoutingDecision,  // Use enhanced routing
        metadata: this.orchestrationMetadata,
        memory: memoryContext,
        plugins,
        executionContext: stepInput.executionContext,  // ✅ Pass ExecutionContext for variable resolution (from StepExecutor)
      };

      // Execute handler
      console.log(`[WorkflowOrchestrator] Routing to ${stepMeta.intent} handler`);
      const result: HandlerResult = await handlerRegistry.execute(handlerContext);

      if (!result.success) {
        throw new Error(result.error || 'Handler execution failed');
      }

      // Track token usage
      await this.orchestrationService.trackStepExecution(
        this.orchestrationMetadata,
        stepId,
        result.tokensUsed.total,
        result.success
      );

      // Track compression if applied
      if (result.compressed) {
        const tokensSaved = stepMeta.budget.compressed || 0;
        this.orchestrationService.recordCompression(stepId, tokensSaved);
      }

      // Audit: Step executed with orchestration
      await this.auditTrail.log({
        action: 'ORCHESTRATION_STEP_EXECUTED',
        entityType: 'workflow_step',
        entityId: stepId,
        userId: this.orchestrationMetadata.userId,
        details: {
          intent: stepMeta.intent,
          tokensUsed: result.tokensUsed.total,
          tokensBudgeted: stepMeta.budget.allocated,
          cost: result.cost,
          compressionApplied: result.compressed || false,
          model: finalRoutingDecision.model,  // Use final routing decision
          tier: finalRoutingDecision.tier,
          routingReason: finalRoutingDecision.reason,
          executionTime: Date.now() - startTime,
        },
        severity: 'info',
      });

      const executionResult: WorkflowOrchestrationResult = {
        output: result.output,
        tokensUsed: result.tokensUsed,
        tokensSaved: result.compressed ? (stepMeta.budget.compressed || 0) : 0,
        cost: result.cost,
        compressionApplied: result.compressed || false,
        routedModel: finalRoutingDecision.model,  // Use final routing decision
        executionTime: Date.now() - startTime,
      };

      console.log(
        `[WorkflowOrchestrator] Step ${stepId} completed: ` +
        `${result.tokensUsed.total} tokens, $${result.cost.toFixed(4)}, ` +
        `${executionResult.executionTime}ms`
      );

      return executionResult;
    } catch (error) {
      console.error(`[WorkflowOrchestrator] Error executing step ${stepId}:`, error);

      // Audit: Execution error
      await this.auditTrail.log({
        action: 'ORCHESTRATION_STEP_FAILED',
        entityType: 'workflow_step',
        entityId: stepId,
        userId: this.orchestrationMetadata.userId,
        details: {
          error: error instanceof Error ? error.message : 'Unknown error',
          executionTime: Date.now() - startTime,
        },
        severity: 'critical',  // ✅ Changed from 'error' to 'critical' (valid constraint value)
      });

      throw error;
    }
  }

  /**
   * Complete orchestration and get final metrics
   * Call this once at the end of workflow execution
   */
  async complete(): Promise<{
    totalTokensUsed: number;
    totalTokensSaved: number;
    totalCost: number;
    budgetUtilization: number;
  } | null> {
    if (!this.orchestrationMetadata) {
      return null;
    }

    console.log('[WorkflowOrchestrator] Completing orchestration');

    try {
      // Complete orchestration
      const metrics = await this.orchestrationService.complete(this.orchestrationMetadata);

      // Audit: Orchestration completed
      await this.auditTrail.log({
        action: 'ORCHESTRATION_COMPLETED',
        entityType: 'workflow',
        entityId: this.orchestrationMetadata.workflowId,
        userId: this.orchestrationMetadata.userId,
        details: {
          executionId: this.orchestrationMetadata.executionId,
          stepsCompleted: metrics.performance.stepsCompleted,
          stepsFailed: metrics.performance.stepsFailed,
          totalTokensUsed: metrics.cost.totalTokensUsed,
          totalTokensSaved: metrics.cost.totalTokensSaved,
          budgetUtilization: metrics.cost.budgetUtilization,
          totalCost: metrics.cost.totalCost,
          totalExecutionTime: metrics.performance.totalExecutionTime,
        },
        severity: 'info',
      });

      const summary = {
        totalTokensUsed: metrics.cost.totalTokensUsed,
        totalTokensSaved: metrics.cost.totalTokensSaved,
        totalCost: metrics.cost.totalCost,
        budgetUtilization: metrics.cost.budgetUtilization,
      };

      console.log('[WorkflowOrchestrator] Orchestration summary:', summary);

      return summary;
    } catch (error) {
      console.error('[WorkflowOrchestrator] Error completing orchestration:', error);
      return null;
    }
  }

  /**
   * Check if orchestration is active for this execution
   */
  isActive(): boolean {
    return this.orchestrationMetadata !== null;
  }

  /**
   * Get orchestration metadata
   */
  getMetadata(): OrchestrationMetadata | null {
    return this.orchestrationMetadata;
  }

  /**
   * Reset orchestration state (for testing or new execution)
   */
  reset(): void {
    this.orchestrationMetadata = null;
  }
}
