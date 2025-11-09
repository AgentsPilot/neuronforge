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
  private options: PilotOptions;

  constructor(supabase: SupabaseClient, options?: PilotOptions) {
    this.supabase = supabase;
    this.options = {
      maxParallelSteps: 3,
      defaultTimeout: 300000, // 5 minutes
      enableCaching: false,
      continueOnError: false,
      enableProgressTracking: true,
      enableRealTimeUpdates: false,
      enableOptimizations: true,
      cacheStepResults: false,
      ...options,
    };

    // Initialize components
    this.parser = new WorkflowParser();
    this.stateManager = new StateManager(supabase);
    this.stepExecutor = new StepExecutor(supabase, this.stateManager); // Pass StateManager for step logging
    this.parallelExecutor = new ParallelExecutor(this.stepExecutor, this.options.maxParallelSteps);
    this.conditionalEvaluator = new ConditionalEvaluator();
    this.errorRecovery = new ErrorRecovery();
    this.outputValidator = new OutputValidator();
    this.auditTrail = AuditTrailService.getInstance();
    this.approvalTracker = new ApprovalTracker(supabase);
    this.notificationService = new NotificationService();
  }

  /**
   * Execute workflow
   */
  async execute(
    agent: Agent,
    userId: string,
    userInput: string,
    inputValues: Record<string, any>,
    sessionId: string
  ): Promise<WorkflowExecutionResult> {
    console.log(`🚀 [WorkflowPilot] Starting execution for agent ${agent.id}: ${agent.agent_name}`);

    // 0. Check if pilot is enabled (safeguard)
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
    const workflowSteps = (agent.workflow_steps as WorkflowStep[]) || [];

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
      sessionId,
      executionPlan,
      inputValues
    );

    const context = new ExecutionContext(
      executionId,
      agent,
      userId,
      sessionId,
      inputValues
    );

    // 3. Load memory context
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

    // 4. Audit: Execution started
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

    try {
      // 5. Execute steps
      await this.executeSteps(executionPlan, context);

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

      // 8. Mark as completed
      await this.stateManager.completeExecution(executionId, finalOutput, context);

      // 9. Audit: Execution completed
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
          total_tokens_used: context.totalTokensUsed,
        },
        severity: 'info',
      });

      // 10. Update AIS metrics (async)
      this.updateAISMetrics(agent.id, context).catch(err =>
        console.error('❌ AIS update failed (non-critical):', err)
      );

      // 11. Summarize for memory (async)
      this.summarizeForMemory(agent.id, userId, executionId, context).catch(err =>
        console.error('❌ Memory summarization failed (non-critical):', err)
      );

      console.log(`✅ [WorkflowPilot] Execution completed successfully: ${executionId}`);

      return {
        success: true,
        executionId,
        output: finalOutput,
        stepsCompleted: context.completedSteps.length,
        stepsFailed: context.failedSteps.length,
        stepsSkipped: context.skippedSteps.length,
        totalExecutionTime: context.totalExecutionTime,
        totalTokensUsed: context.totalTokensUsed,
      };
    } catch (error: any) {
      console.error(`❌ [WorkflowPilot] Execution failed:`, error);

      // Mark as failed
      await this.stateManager.failExecution(executionId, error, context);

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

    // Check executeIf condition
    if (stepDef.executeIf) {
      const shouldExecute = this.conditionalEvaluator.evaluate(
        stepDef.executeIf,
        context
      );

      if (!shouldExecute) {
        console.log(`  ⏭  Skipping step ${stepDef.id} - condition not met`);
        context.markStepSkipped(stepDef.id);
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
          throw new ExecutionError(
            `Sub-workflow ${stepDef.id} failed: ${result.error}`,
            'SUB_WORKFLOW_FAILED',
            stepDef.id
          );
        } else if (onError === 'continue') {
          console.log(`  ⚠️  Sub-workflow failed but continuing: ${result.error}`);
        }
        // 'return_error' - error is already in result.data
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

      // If rejected, throw error to halt workflow
      if (!result.approved) {
        throw new ExecutionError(
          `Approval rejected for step ${stepDef.id}`,
          'APPROVAL_REJECTED',
          stepDef.id,
          { approvalId: result.approvalId, responses: result.responses }
        );
      }

      return;
    }

    // Execute step with retry policy
    context.currentStep = stepDef.id;

    const output = await this.errorRecovery.executeWithRetry(
      () => this.stepExecutor.execute(stepDef, context),
      stepDef.retryPolicy,
      stepDef.id
    );

    // Store output
    context.setStepOutput(stepDef.id, output);

    // Checkpoint
    await this.stateManager.checkpoint(context);

    if (output.metadata.success) {
      console.log(`  ✓ Completed in ${output.metadata.executionTime}ms`);
    } else {
      console.error(`  ✗ Failed: ${output.metadata.error}`);

      // Check if we should continue on error
      if (!stepDef.continueOnError && !this.options.continueOnError) {
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
        {} // Empty input values - we'll map them manually
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
  private buildFinalOutput(
    context: ExecutionContext,
    outputSchema: any
  ): any {
    // If output schema specifies sources
    if (outputSchema && Array.isArray(outputSchema) && outputSchema.length > 0) {
      const output: any = {};

      outputSchema.forEach((schema: any) => {
        if (schema.source) {
          // Get data from specific step
          try {
            const value = context.resolveVariable(`{{${schema.source}}}`);
            output[schema.name] = value;
          } catch (error) {
            console.warn(`Failed to resolve output field ${schema.name} from ${schema.source}:`, error);
          }
        }
      });

      return output;
    }

    // Default: return all step outputs
    const output: any = {};
    context.getAllStepOutputs().forEach((stepOutput, stepId) => {
      output[stepId] = stepOutput.data;
    });

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
   */
  private async summarizeForMemory(
    agentId: string,
    userId: string,
    executionId: string,
    context: ExecutionContext
  ): Promise<void> {
    console.log(`🧠 [WorkflowPilot] Summarizing execution for memory`);

    // Get run number from database
    const { data: runData } = await this.supabase
      .from('workflow_executions')
      .select('id')
      .eq('agent_id', agentId)
      .eq('user_id', userId)
      .order('started_at', { ascending: true });

    const runNumber = (runData?.length || 0) + 1;

    // Create instance and call method
    const memorySummarizer = new MemorySummarizer(this.supabase);

    // Calculate credits using database-driven token-to-credit conversion
    const creditsConsumed = await tokensToPilotCredits(context.totalTokensUsed, this.supabase);

    await memorySummarizer.summarizeExecution({
      execution_id: executionId,
      agent_id: agentId,
      user_id: userId,
      run_number: runNumber,
      agent_name: context.agent.agent_name,
      agent_description: context.agent.system_prompt || context.agent.user_prompt || '',
      agent_mode: 'workflow_orchestrator',
      input: context.inputValues,
      output: this.buildFinalOutput(context, context.agent.output_schema),
      status: context.failedSteps.length > 0 ? 'failed' : 'success',
      model_used: 'workflow_orchestrator',
      credits_consumed: creditsConsumed,
      execution_time_ms: context.totalExecutionTime,
    });

    console.log(`✅ [WorkflowPilot] Memory summarization complete`);
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
        context.totalTokensUsed += result.metadata?.tokensUsed || 0;

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

      // 11. Audit: Execution completed
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

      // 12. Update AIS metrics (async)
      this.updateAISMetrics(agent.id, context).catch(err =>
        console.error('❌ AIS update failed (non-critical):', err)
      );

      // 13. Summarize for memory (async)
      this.summarizeForMemory(agent.id, context.userId, executionId, context).catch(err =>
        console.error('❌ Memory summarization failed (non-critical):', err)
      );

      console.log(`✅ [WorkflowPilot] Resumed execution completed successfully: ${executionId}`);

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
