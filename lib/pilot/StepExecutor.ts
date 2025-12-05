/**
 * StepExecutor - Execute individual workflow steps
 *
 * Responsibilities:
 * - Route step execution based on type (action, llm_decision, transform, etc.)
 * - Execute plugin actions via PluginExecuterV2
 * - Execute LLM decisions via AgentKit
 * - Handle data transformations
 * - Track execution metrics
 *
 * @module lib/orchestrator/StepExecutor
 */

import { SupabaseClient } from '@supabase/supabase-js';
import type {
  WorkflowStep,
  ExecutionContext,
  StepOutput,
  ActionStep,
  LLMDecisionStep,
  AIProcessingStep,
  TransformStep,
  DelayStep,
  SwitchStep,
  EnrichmentStep,
  ValidationStep,
  ComparisonStep,
} from './types';
import { ExecutionError } from './types';
import { PluginExecuterV2 } from '@/lib/server/plugin-executer-v2';
import { runAgentKit } from '@/lib/agentkit/runAgentKit';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { ConditionalEvaluator } from './ConditionalEvaluator';
import { DataOperations } from './DataOperations';
import { StepCache } from './StepCache';
import { AISConfigService } from '@/lib/services/AISConfigService';
// TODO: Implement these classes for per-step routing
// import { TaskComplexityAnalyzer } from './TaskComplexityAnalyzer';
// import { PerStepModelRouter } from './PerStepModelRouter';

export class StepExecutor {
  private supabase: SupabaseClient;
  private auditTrail: AuditTrailService;
  private conditionalEvaluator: ConditionalEvaluator;
  private stateManager: any; // StateManager (avoiding circular dependency)
  private stepCache: StepCache;
  // private complexityAnalyzer: TaskComplexityAnalyzer;
  // private modelRouter: PerStepModelRouter;

  constructor(supabase: SupabaseClient, stateManager?: any, stepCache?: StepCache) {
    this.supabase = supabase;
    this.auditTrail = AuditTrailService.getInstance();
    this.conditionalEvaluator = new ConditionalEvaluator();
    this.stateManager = stateManager;
    this.stepCache = stepCache || new StepCache(false);
    // this.complexityAnalyzer = new TaskComplexityAnalyzer();
    // this.modelRouter = new PerStepModelRouter();
  }

  /**
   * Execute a single workflow step
   */
  async execute(
    step: WorkflowStep,
    context: ExecutionContext
  ): Promise<StepOutput> {
    const startTime = Date.now();

    console.log(`[StepExecutor] Executing step ${step.id}: ${step.name} (type: ${step.type})`);

    // === CACHING CHECK ===
    // Check cache before execution (for deterministic steps only)
    const cacheableTypes = ['action', 'transform', 'validation', 'comparison'];
    if (cacheableTypes.includes(step.type)) {
      const stepParams = (step as any).params || {};
      const cachedOutput = this.stepCache.get(step.id, step.type, stepParams);
      if (cachedOutput) {
        console.log(`💾 [StepExecutor] Cache hit for step ${step.id}, skipping execution`);
        return cachedOutput;
      }
    }

    // === ORCHESTRATION INTEGRATION (Phase 4) ===
    // Check if step should use orchestration (only AI tasks, not deterministic plugin actions)
    const shouldUseOrchestration = this.shouldUseOrchestration(step);

    if (shouldUseOrchestration && context.orchestrator && context.orchestrator.isActive()) {
      console.log(`🎯 [StepExecutor] Using orchestration for AI task: ${step.id} (type: ${step.type})`);

      try {
        // ✅ CRITICAL: Resolve variables BEFORE passing to orchestration
        // This ensures {{step1.data.emails}} is resolved to actual data for Step 2
        // For AI processing steps, check BOTH params AND input fields
        const stepAny = step as any;
        const stepParams = stepAny.params || {};

        // ✅ FIX: Include 'input' field if present (used by ai_processing steps)
        if (stepAny.input !== undefined) {
          stepParams.input = stepAny.input;
        }
        // Include 'prompt' field if present
        if (stepAny.prompt !== undefined) {
          stepParams.prompt = stepAny.prompt;
        }

        const resolvedParams = context.resolveAllVariables(stepParams);

        console.log(`🔍 [StepExecutor] Orchestration step ${step.id} params BEFORE resolution:`, JSON.stringify(stepParams, null, 2));
        console.log(`🔍 [StepExecutor] Orchestration step ${step.id} params AFTER resolution:`, JSON.stringify(resolvedParams, null, 2));

        // Execute via orchestration handlers
        const orchestrationResult = await context.orchestrator.executeStep(
          step.id,
          {
            step,
            params: resolvedParams,  // ✅ Use resolved params instead of raw params
            context: context.variables,  // Keep for backward compatibility
            executionContext: context,  // ✅ Pass full ExecutionContext for variable resolution
          },
          context.memoryContext,
          context.agent.plugins_required
        );

        if (orchestrationResult) {
          // Return orchestrated result
          console.log(`✅ [StepExecutor] Orchestration executed step ${step.id} successfully`);
          console.log(`   Tokens: ${orchestrationResult.tokensUsed.total}, Saved: ${orchestrationResult.tokensSaved}`);

          return {
            stepId: step.id,
            plugin: (step as any).plugin || 'system',
            action: (step as any).action || step.type,
            data: orchestrationResult.output,
            metadata: {
              success: true,
              executedAt: new Date().toISOString(),
              executionTime: orchestrationResult.executionTime,
              tokensUsed: orchestrationResult.tokensUsed,
              // Orchestration-specific metadata
              compressionApplied: orchestrationResult.compressionApplied,
              tokensSaved: orchestrationResult.tokensSaved,
              routedModel: orchestrationResult.routedModel,
              orchestrated: true,
            },
          };
        }
      } catch (orchestrationError: any) {
        console.warn(`⚠️  [StepExecutor] Orchestration failed for step ${step.id}, falling back to normal execution:`, orchestrationError.message);
        // Fall through to normal execution
      }
    } else if (!shouldUseOrchestration && context.orchestrator?.isActive()) {
      console.log(`⚡ [StepExecutor] Skipping orchestration for deterministic step: ${step.id} (type: ${step.type}) - executing plugin directly`);
    }

    // === NORMAL EXECUTION (Fallback or when orchestration is disabled) ===

    // Log step execution start to workflow_step_executions table
    if (this.stateManager) {
      const metadata: any = {
        started_at: new Date().toISOString(),
        step_description: step.description,
      };

      // Include plugin info for action steps
      if (step.type === 'action') {
        if ((step as any).plugin) {
          metadata.plugin = (step as any).plugin;
        }
        if ((step as any).action) {
          metadata.action = (step as any).action;
        }
      }

      await this.stateManager.logStepExecution(
        context.executionId,
        step.id,
        step.name,
        step.type,
        'running',
        metadata
      );
    }

    try {
      // Resolve parameters with variable substitution
      // For action steps: resolve step.params
      // For other step types (transform, loop, etc.): resolve top-level fields
      let resolvedParams: any;

      if (step.type === 'action') {
        resolvedParams = context.resolveAllVariables(step.params || {});
      } else {
        // For non-action steps, only include fields that actually exist on the step
        const fieldsToResolve: any = {};
        const stepAny = step as any;

        if ('operation' in stepAny) fieldsToResolve.operation = stepAny.operation;
        if ('input' in stepAny) fieldsToResolve.input = stepAny.input;
        if ('config' in stepAny) fieldsToResolve.config = stepAny.config;
        if ('condition' in stepAny) fieldsToResolve.condition = stepAny.condition;
        if ('iterateOver' in stepAny) fieldsToResolve.iterateOver = stepAny.iterateOver;
        if ('maxIterations' in stepAny) fieldsToResolve.maxIterations = stepAny.maxIterations;
        if ('left' in stepAny) fieldsToResolve.left = stepAny.left;
        if ('right' in stepAny) fieldsToResolve.right = stepAny.right;
        if ('scatter' in stepAny) fieldsToResolve.scatter = stepAny.scatter;
        if ('gather' in stepAny) fieldsToResolve.gather = stepAny.gather;

        resolvedParams = context.resolveAllVariables(fieldsToResolve);
      }

      // 🔍 DEBUG: Log variable resolution
      console.log(`🔍 [StepExecutor] Step ${step.id} params BEFORE resolution:`, JSON.stringify(step.type === 'action' ? step.params : step, null, 2));
      console.log(`🔍 [StepExecutor] Step ${step.id} params AFTER resolution:`, JSON.stringify(resolvedParams, null, 2));

      let result: any;
      let tokensUsed: number | { total: number; prompt: number; completion: number } = 0;

      // Route to appropriate executor based on step type
      switch (step.type) {
        case 'action':
          // ✅ P0 FIX: Capture plugin tokens from executeAction return value
          const actionResult = await this.executeAction(step as ActionStep, resolvedParams, context);
          result = actionResult.data;
          tokensUsed = actionResult.pluginTokens || 0;
          console.log(`📊 [StepExecutor] Plugin action returned ${tokensUsed} tokens`);
          break;

        case 'ai_processing':  // Smart Agent Builder uses this type
        case 'llm_decision':
          const llmResult = await this.executeLLMDecision(step as LLMDecisionStep | AIProcessingStep, resolvedParams, context);
          result = llmResult.data;
          tokensUsed = llmResult.tokensUsed;
          break;

        case 'conditional':
          result = await this.executeConditional(step, context);
          break;

        case 'loop':
          // Loop execution is handled by ParallelExecutor
          throw new ExecutionError(
            'Loop steps should be executed by ParallelExecutor',
            'INVALID_STEP_TYPE',
            step.id
          );

        case 'transform':
          result = await this.executeTransform(step as TransformStep, resolvedParams, context);
          break;

        case 'delay':
          await this.executeDelay(step as DelayStep, resolvedParams);
          result = { delayed: true };
          break;

        case 'parallel_group':
          // Parallel groups are handled by ParallelExecutor
          throw new ExecutionError(
            'Parallel group steps should be executed by ParallelExecutor',
            'INVALID_STEP_TYPE',
            step.id
          );

        case 'switch':
          result = await this.executeSwitch(step as SwitchStep, context);
          break;

        case 'scatter_gather':
          // Scatter-gather is handled by ParallelExecutor
          throw new ExecutionError(
            'Scatter-gather steps should be executed by ParallelExecutor',
            'INVALID_STEP_TYPE',
            step.id
          );

        case 'enrichment':
          result = await this.executeEnrichment(step as EnrichmentStep, context);
          break;

        case 'validation':
          result = await this.executeValidation(step as ValidationStep, context);
          break;

        case 'comparison':
          result = await this.executeComparison(step as ComparisonStep, context);
          break;

        default:
          throw new ExecutionError(
            `Unknown step type: ${(step as any).type}`,
            'UNKNOWN_STEP_TYPE',
            step.id
          );
      }

      const executionTime = Date.now() - startTime;

      // Build step output
      const output: StepOutput = {
        stepId: step.id,
        plugin: (step as any).plugin || 'system',
        action: (step as any).action || step.type,
        data: result,
        metadata: {
          success: true,
          executedAt: new Date().toISOString(),
          executionTime,
          itemCount: Array.isArray(result) ? result.length : undefined,
          tokensUsed: tokensUsed || undefined,
        },
      };

      // Update step execution to completed in workflow_step_executions table
      if (this.stateManager) {
        await this.stateManager.updateStepExecution(
          context.executionId,
          step.id,
          'completed',
          {
            success: true,
            execution_time: executionTime,
            tokens_used: tokensUsed || undefined,
            item_count: Array.isArray(result) ? result.length : undefined,
            completed_at: new Date().toISOString(),
          }
        );
      }

      // Audit trail
      await this.auditTrail.log({
        action: AUDIT_EVENTS.PILOT_STEP_EXECUTED,
        entityType: 'agent',
        entityId: context.executionId,
        userId: context.userId,
        resourceName: step.name,
        details: {
          stepId: step.id,
          stepType: step.type,
          executionTime,
          itemCount: output.metadata.itemCount,
          tokensUsed: output.metadata.tokensUsed,
        },
        severity: 'info',
      });

      console.log(`[StepExecutor] Step ${step.id} completed successfully in ${executionTime}ms`);

      // === CACHE STORAGE ===
      // Store in cache if step type is cacheable
      if (cacheableTypes.includes(step.type)) {
        const stepParams = (step as any).params || {};
        this.stepCache.set(step.id, step.type, stepParams, output);
        console.log(`💾 [StepExecutor] Cached result for step ${step.id}`);
      }

      return output;
    } catch (error: any) {
      const executionTime = Date.now() - startTime;

      console.error(`[StepExecutor] Step ${step.id} failed:`, error);

      // Update step execution to failed in workflow_step_executions table
      if (this.stateManager) {
        await this.stateManager.updateStepExecution(
          context.executionId,
          step.id,
          'failed',
          {
            success: false,
            execution_time: executionTime,
            error: error.message,
            failed_at: new Date().toISOString(),
          },
          error.message
        );
      }

      // Audit trail
      await this.auditTrail.log({
        action: AUDIT_EVENTS.PILOT_STEP_FAILED,
        entityType: 'agent',
        entityId: context.executionId,
        userId: context.userId,
        resourceName: step.name,
        details: {
          stepId: step.id,
          stepType: step.type,
          error: error.message,
          errorCode: error.code,
          executionTime,
        },
        severity: 'warning',
      });

      // Build error output
      return {
        stepId: step.id,
        plugin: (step as any).plugin || 'system',
        action: (step as any).action || step.type,
        data: null,
        metadata: {
          success: false,
          executedAt: new Date().toISOString(),
          executionTime,
          error: error.message,
          errorCode: error.code,
        },
      };
    }
  }

  /**
   * Execute plugin action
   *
   * ✅ P0 FIX: Track execution time and cost for direct plugin actions
   * Even though plugins don't consume LLM tokens, we track execution metadata
   * for complete platform usage analytics and cost attribution
   */
  private async executeAction(
    step: ActionStep,
    params: any,
    context: ExecutionContext
  ): Promise<any> {
    if (!step.plugin || !step.action) {
      throw new ExecutionError(
        `Action step ${step.id} missing plugin or action`,
        'MISSING_PLUGIN_ACTION',
        step.id
      );
    }

    console.log(`[StepExecutor] Executing plugin: ${step.plugin}.${step.action}`);

    const actionStartTime = Date.now();

    // Execute via PluginExecuterV2 (use getInstance for singleton)
    const pluginExecuter = await PluginExecuterV2.getInstance();
    const result = await pluginExecuter.execute(
      context.userId,
      step.plugin,
      step.action,
      params
    );

    const actionDuration = Date.now() - actionStartTime;

    if (!result.success) {
      throw new ExecutionError(
        result.error || `Plugin execution failed: ${step.plugin}.${step.action}`,
        'PLUGIN_EXECUTION_FAILED',
        step.id,
        { plugin: step.plugin, action: step.action, error: result.error }
      );
    }

    // ✅ P0 FIX: Track plugin action execution in token_usage table
    // Plugin actions don't consume LLM tokens directly, but we track equivalent token cost
    // Fetches token pricing from ais_system_config.calculator_tokens_per_plugin (default: 400)
    let pluginTokens = 0;
    try {
      // Fetch plugin token cost from database
      pluginTokens = await AISConfigService.getSystemConfig(
        this.supabase,
        'calculator_tokens_per_plugin',
        400 // Fallback default
      );

      await this.supabase.from('token_usage').insert({
        user_id: context.userId,
        agent_id: context.agentId,
        execution_id: context.executionId,
        session_id: context.sessionId,
        input_tokens: pluginTokens,  // Plugin equivalent token cost
        output_tokens: 0,  // All cost attributed to input for simplicity
        cost_usd: 0,  // Cost calculated from tokens using model pricing
        feature: 'pilot',
        component: 'plugin_action',
        activity_type: 'plugin_call',
        model_name: `${step.plugin}.${step.action}`,
        provider: 'plugin_registry_v2',
        metadata: {
          plugin: step.plugin,
          action: step.action,
          execution_time_ms: actionDuration,
          step_id: step.id,
          step_name: step.name,
          success: true,
          plugin_tokens: pluginTokens,
        }
      });

      console.log(`✅ [StepExecutor] Tracked plugin action: ${step.plugin}.${step.action} (${actionDuration}ms, ${pluginTokens} tokens)`);
    } catch (trackingError) {
      // Token tracking failures should NOT fail plugin execution
      console.warn(`⚠️  [StepExecutor] Failed to track plugin action (non-critical):`, trackingError);
    }

    // ✅ P0 FIX: Return plugin tokens so they flow through StepOutput → ExecutionContext
    // This ensures tokens are properly tracked via setStepOutput() which handles retries correctly
    return {
      data: result.data,
      pluginTokens: pluginTokens
    };
  }

  /**
   * Determine if a step should use orchestration
   * Only AI tasks (summarize, analyze, decide) need orchestration
   * Deterministic plugin actions should execute directly
   */
  private shouldUseOrchestration(step: WorkflowStep): boolean {
    // LLM-based steps that need intelligent routing through orchestration
    // These steps require:
    // - Token budgeting per intent
    // - Model routing based on AIS + complexity scores
    // - Per-step execution tracking
    // - Compression policies
    const llmStepTypes = [
      'ai_processing',   // AI processing tasks
      'llm_decision',    // LLM-based decisions
      'summarize',       // Content summarization
      'extract',         // Information extraction
      'generate'         // Content generation
      // NOTE: 'transform' removed - most transforms are deterministic (map, filter, group, etc.)
      // Only complex transforms with AI analysis should use ai_processing type
    ];

    if (llmStepTypes.includes(step.type)) {
      return true;
    }

    // Plugin action steps should NOT use orchestration
    // These are direct API calls to external services - no LLM needed
    if (step.type === 'action') {
      return false;
    }

    // Enrich, validation, comparison - default to false for efficiency
    // These are typically deterministic operations
    return false;
  }

  /**
   * Execute LLM decision step (uses AgentKit)
   * Also handles ai_processing steps from Smart Agent Builder
   */
  private async executeLLMDecision(
    step: LLMDecisionStep | AIProcessingStep,
    params: any,
    context: ExecutionContext
  ): Promise<{ data: any; tokensUsed: { total: number; prompt: number; completion: number } }> {
    console.log(`[StepExecutor] Executing LLM decision: ${step.name}`);

    const stepStartTime = Date.now();
    let selectedModel: string | undefined;
    let routingDecision: any;

    // === PER-STEP INTELLIGENT ROUTING ===
    // TODO: Re-enable once TaskComplexityAnalyzer and PerStepModelRouter are implemented
    // Analyze step complexity and route to optimal model
    try {
      // Check if per-step routing is enabled in orchestrator config (admin UI)
      const isRoutingEnabled = context.orchestrator?.config?.aisRoutingEnabled || false;

      if (isRoutingEnabled) {
        console.log(`🎯 [StepExecutor] Per-step routing enabled - analyzing complexity...`);

        // // Analyze step complexity
        // const complexityAnalysis = await this.complexityAnalyzer.analyzeStep(step, context);
        // console.log(`📊 [StepExecutor] Complexity: ${complexityAnalysis.complexityScore.toFixed(1)}/10`);

        // // Get agent AIS (Agent Intensity Score)
        // const agentAIS = (context.agent as any).agent_intensity_score || 5.0;

        // // Route to optimal model (with memory-based learning)
        // routingDecision = await this.modelRouter.routeStep(
        //   complexityAnalysis,
        //   agentAIS,
        //   (context.agent as any).model_preference,
        //   context.agentId  // Pass agentId for memory lookup
        // );

        // // Format model for AgentKit (provider:model)
        // selectedModel = `${routingDecision.selectedModel.provider}:${routingDecision.selectedModel.model}`;

        // console.log(`✅ [StepExecutor] Selected model: ${selectedModel}`);
        // console.log(`   ${routingDecision.explanation}`);

        // // Record routing decision to audit trail
        // const stepIndex = context.completedSteps.length;
        // await this.modelRouter.recordRoutingDecision(
        //   context.agentId,
        //   context.userId,
        //   context.executionId,
        //   stepIndex,
        //   step.name,
        //   step.type,
        //   complexityAnalysis,
        //   routingDecision
        // );
      } else {
        console.log(`ℹ️ [StepExecutor] Per-step routing disabled - using agent default model`);
      }
    } catch (routingError) {
      console.error('❌ [StepExecutor] Routing failed, falling back to agent default:', routingError);
      // Continue with agent default model
    }

    // Build prompt with context
    const prompt = step.prompt || step.description || step.name;

    // FIX: Extract variable references from prompt and resolve them into params
    // This handles cases where Smart Agent Builder creates prompts like:
    // "Analyze the following emails: {{step1.data}}"
    // We need to extract step1.data and add it to params
    console.log('🔍 [StepExecutor] Original params:', JSON.stringify(params, null, 2));
    console.log('🔍 [StepExecutor] Prompt:', prompt);

    const enrichedParams = { ...params };

    // Extract all {{variable}} references from the prompt
    const variablePattern = /\{\{([^}]+)\}\}/g;
    const matches = prompt.match(variablePattern);

    if (matches && matches.length > 0) {
      console.log('🔍 [StepExecutor] Found variable references in prompt:', matches);

      for (const match of matches) {
        try {
          const resolved = context.resolveVariable(match);

          // Extract the variable name for use as a key
          // e.g., "{{step1.data}}" -> "step1_data"
          const varName = match.replace(/\{\{|\}\}/g, '').replace(/\./g, '_');

          // Only add to params if it's not already there
          if (!enrichedParams[varName]) {
            enrichedParams[varName] = resolved;
            console.log(`🔍 [StepExecutor] Added "${varName}" to params from prompt variable "${match}"`);
          }
        } catch (error: any) {
          console.warn(`🔍 [StepExecutor] Could not resolve variable "${match}" from prompt:`, error.message);
        }
      }
    }

    // If params are still empty after enrichment, try to get data from previous step
    if (Object.keys(enrichedParams).length === 0) {
      console.log('🔍 [StepExecutor] Params still empty, checking for previous step outputs...');

      const allOutputs = context.getAllStepOutputs();
      if (allOutputs.size > 0) {
        // Get the last step's output
        const outputsArray = Array.from(allOutputs.entries());
        const [lastStepId, lastOutput] = outputsArray[outputsArray.length - 1];

        console.log(`🔍 [StepExecutor] Using output from previous step "${lastStepId}" as default params`);
        enrichedParams.data = lastOutput.data;
      }
    }

    console.log('🔍 [StepExecutor] Enriched params:', JSON.stringify(enrichedParams, null, 2));

    const contextSummary = this.buildContextSummary(context);

    const fullPrompt = `
${prompt}

## Current Context:
${contextSummary}

## Data for Analysis:
${JSON.stringify(enrichedParams, null, 2)}

Please analyze the above and provide your decision/response.
    `.trim();

    // Use AgentKit for intelligent decision (with optional model override)
    // If a model was selected by routing, temporarily override the agent's model preference

    // IMPORTANT: For ai_processing steps, don't pass plugins
    // ai_processing = text analysis/summarization (no tool use)
    // llm_decision = intelligent decision-making with tools (has plugin access)
    const isAIProcessing = step.type === 'ai_processing';

    const agentForExecution: any = {
      ...context.agent,
      // Filter out plugins for ai_processing to prevent LLM from calling tools
      plugins_required: isAIProcessing ? [] : context.agent.plugins_required
    };

    // Override model if selected by routing
    if (selectedModel) {
      agentForExecution.model_preference = selectedModel;
    }

    const result = await runAgentKit(
      context.userId,
      agentForExecution,
      fullPrompt,
      {},
      context.sessionId
    );

    if (!result.success) {
      throw new ExecutionError(
        result.error || 'LLM decision failed',
        'LLM_DECISION_FAILED',
        step.id
      );
    }

    // Update routing metrics if routing was used
    // TODO: Re-enable once PerStepModelRouter and RoutingMemoryService are implemented
    if (routingDecision) {
      const executionTimeMs = Date.now() - stepStartTime;
      const stepIndex = context.completedSteps.length;

      // await this.modelRouter.updateRoutingMetrics(
      //   context.executionId,
      //   stepIndex,
      //   result.tokensUsed.total,
      //   executionTimeMs,
      //   true,
      //   undefined  // Cost calculation can be added later
      // );

      // // === LEARN FROM THIS EXECUTION ===
      // // Feed the outcome back into routing memory for future optimization
      // const RoutingMemoryService = (await import('./RoutingMemoryService')).RoutingMemoryService;
      // const routingMemory = RoutingMemoryService.getInstance();

      // await routingMemory.learnFromExecution(
      //   context.agentId,
      //   context.userId,
      //   context.executionId,
      //   stepIndex,
      //   step.type,
      //   routingDecision.selectedModel.tier,
      //   true, // success (since we got here without error)
      //   result.tokensUsed.total,
      //   executionTimeMs,
      //   undefined // cost will be calculated in future
      // );
    }

    // Return AI processing result with multiple field aliases for flexibility
    // This allows users to reference the output semantically based on their use case:
    // - {{stepX.data.result}} - generic, always works
    // - {{stepX.data.summary}} - for summarization tasks
    // - {{stepX.data.analysis}} - for analysis tasks
    // - {{stepX.data.decision}} - for decision-making tasks
    // - {{stepX.data.response}} - raw response
    const aiResponse = result.response;

    // ✅ FIX: Clean summarization output to remove meta-commentary and narrative
    // Apply cleaning for summarization steps to prevent duplicate content in emails
    const shouldClean = step.name?.toLowerCase().includes('summarize') ||
                       step.prompt?.toLowerCase().includes('summarize') ||
                       step.description?.toLowerCase().includes('summarize');

    const cleanedResponse = shouldClean ? this.cleanSummaryOutput(aiResponse) : aiResponse;

    return {
      data: {
        // Generic aliases (always available)
        result: cleanedResponse,
        response: cleanedResponse,
        output: cleanedResponse,

        // Semantic aliases for common use cases
        summary: cleanedResponse,
        analysis: cleanedResponse,
        decision: cleanedResponse,
        reasoning: cleanedResponse,
        classification: cleanedResponse,

        // Additional metadata
        toolCalls: result.toolCalls,
      },
      tokensUsed: result.tokensUsed, // Return full breakdown {total, prompt, completion}
    };
  }

  /**
   * Execute conditional step
   */
  private async executeConditional(
    step: WorkflowStep,
    context: ExecutionContext
  ): Promise<any> {
    const stepCondition = (step as any).condition;
    if (!stepCondition) {
      throw new ExecutionError(
        `Conditional step ${step.id} missing condition`,
        'MISSING_CONDITION',
        step.id
      );
    }

    console.log(`[StepExecutor] Evaluating condition for step ${step.id}`);

    const result = this.conditionalEvaluator.evaluate(stepCondition, context);

    return {
      result,
      condition: stepCondition,
    };
  }

  /**
   * Execute switch/case conditional
   * Phase 2: Enhanced Conditionals
   */
  private async executeSwitch(
    step: SwitchStep,
    context: ExecutionContext
  ): Promise<any> {
    console.log(`🔀 [StepExecutor] Executing switch step ${step.id}`);

    // Evaluate the switch expression
    const evaluatedValue = context.resolveVariable?.(step.evaluate) ?? step.evaluate;
    const valueStr = String(evaluatedValue);

    console.log(`🔀 [StepExecutor] Switch on "${step.evaluate}" = "${valueStr}"`);

    // Find matching case
    let matchedSteps: string[] | undefined;

    if (step.cases[valueStr]) {
      matchedSteps = step.cases[valueStr];
      console.log(`✅ [StepExecutor] Matched case "${valueStr}" → steps: ${matchedSteps.join(', ')}`);
    } else if (step.default) {
      matchedSteps = step.default;
      console.log(`⚠️  [StepExecutor] No match, using default → steps: ${matchedSteps.join(', ')}`);
    } else {
      console.log(`❌ [StepExecutor] No match and no default case`);
      matchedSteps = [];
    }

    // Store matched branch in context for routing
    context.setVariable?.(`${step.id}_branch`, matchedSteps);

    return {
      matchedCase: valueStr,
      matchedSteps,
      totalCases: Object.keys(step.cases).length,
      hasDefault: !!step.default,
    };
  }

  /**
   * Execute enrichment step
   * Phase 4: Data Operations
   */
  private async executeEnrichment(
    step: EnrichmentStep,
    context: ExecutionContext
  ): Promise<any> {
    console.log(`📊 [StepExecutor] Executing enrichment step ${step.id}`);

    // Resolve all sources
    const sources: Record<string, any> = {};
    for (const source of step.sources) {
      const value = context.resolveVariable?.(source.from) ?? null;
      sources[source.key] = value;
      console.log(`📊 [StepExecutor] Source "${source.key}" resolved from ${source.from}`);
    }

    // Enrich data using DataOperations
    const result = DataOperations.enrich(sources, step.strategy, {
      joinOn: step.joinOn,
      mergeArrays: step.mergeArrays,
    });

    console.log(`✅ [StepExecutor] Enrichment complete for ${step.id}`);

    return result;
  }

  /**
   * Execute validation step
   * Phase 4: Data Operations
   */
  private async executeValidation(
    step: ValidationStep,
    context: ExecutionContext
  ): Promise<any> {
    console.log(`✅ [StepExecutor] Executing validation step ${step.id}`);

    // Resolve input data
    const data = context.resolveVariable?.(step.input);

    // Validate using DataOperations
    const validationResult = DataOperations.validate(data, step.schema, step.rules);

    console.log(`✅ [StepExecutor] Validation ${validationResult.valid ? 'passed' : 'failed'} for ${step.id}`);

    // Handle validation failure
    if (!validationResult.valid) {
      const onFail = step.onValidationFail || 'throw';

      if (onFail === 'throw') {
        throw new ExecutionError(
          `Validation failed: ${validationResult.errors.join(', ')}`,
          'VALIDATION_FAILED',
          step.id,
          { errors: validationResult.errors }
        );
      } else if (onFail === 'skip') {
        console.log(`⏭  [StepExecutor] Validation failed, skipping step ${step.id}`);
      }
      // If 'continue', just log and return result
    }

    return {
      valid: validationResult.valid,
      errors: validationResult.errors,
      data,
    };
  }

  /**
   * Execute comparison step
   * Phase 4: Data Operations
   */
  private async executeComparison(
    step: ComparisonStep,
    context: ExecutionContext
  ): Promise<any> {
    console.log(`🔍 [StepExecutor] Executing comparison step ${step.id}`);

    // Resolve left and right values
    const leftValue = context.resolveVariable?.(step.left);
    const rightValue = context.resolveVariable?.(step.right);

    console.log(`🔍 [StepExecutor] Comparing "${step.left}" vs "${step.right}" with operation: ${step.operation}`);

    // Compare using DataOperations
    const result = DataOperations.compare(
      leftValue,
      rightValue,
      step.operation,
      step.outputFormat || 'boolean'
    );

    console.log(`✅ [StepExecutor] Comparison complete for ${step.id}`);

    return result;
  }

  /**
   * Execute data transformation
   */
  private async executeTransform(
    step: TransformStep,
    params: any,
    context: ExecutionContext
  ): Promise<any> {
    const { operation, input, config } = params;

    if (!operation) {
      throw new ExecutionError(
        `Transform step ${step.id} missing operation`,
        'MISSING_OPERATION',
        step.id
      );
    }

    console.log(`[StepExecutor] Executing transform: ${operation}`);

    // ✅ FIX: Input has already been resolved by resolveAllVariables (line 175-188)
    // Don't try to resolve again, just use it directly
    const data = input !== undefined ? input : params.data;

    if (!data) {
      throw new ExecutionError(
        `Transform step ${step.id} has no input data`,
        'MISSING_INPUT_DATA',
        step.id
      );
    }

    switch (operation) {
      case 'set':
        // Simple assignment - just return the input data as-is
        return data;

      case 'map':
        return this.transformMap(data, config, context);

      case 'filter':
        return this.transformFilter(data, config, context);

      case 'reduce':
        return this.transformReduce(data, config);

      case 'sort':
        return this.transformSort(data, config);

      case 'group':
        return this.transformGroup(data, config);

      case 'aggregate':
        return this.transformAggregate(data, config);

      case 'deduplicate':
        return this.transformDeduplicate(data, config);

      default:
        throw new ExecutionError(
          `Unknown transform operation: ${operation}`,
          'UNKNOWN_TRANSFORM_OPERATION',
          step.id
        );
    }
  }

  /**
   * Map transformation
   */
  private transformMap(data: any[], mapping: Record<string, string>, context: ExecutionContext): any[] {
    if (!Array.isArray(data)) {
      throw new ExecutionError('Map operation requires array input', 'INVALID_INPUT_TYPE');
    }

    return data.map(item => {
      const mapped: any = {};

      // Create temporary context with current item
      const tempContext = context.clone();
      tempContext.setVariable('item', item);

      for (const [key, valueExpr] of Object.entries(mapping)) {
        if (typeof valueExpr === 'string' && valueExpr.includes('{{')) {
          mapped[key] = tempContext.resolveVariable(valueExpr);
        } else {
          mapped[key] = valueExpr;
        }
      }

      return mapped;
    });
  }

  /**
   * Filter transformation
   *
   * Returns a structured object with backward compatibility:
   * - New workflows: use {{stepX.data.items}} or {{stepX.data.filtered}}
   * - Legacy workflows: array-like object with [index] access
   */
  private transformFilter(data: any[], config: any, context: ExecutionContext): any {
    if (!Array.isArray(data)) {
      throw new ExecutionError('Filter operation requires array input', 'INVALID_INPUT_TYPE');
    }

    const originalCount = data.length;
    const filtered = data.filter(item => {
      // Create temporary context with current item
      const tempContext = context.clone();
      tempContext.setVariable('item', item);

      return this.conditionalEvaluator.evaluate(config.condition, tempContext);
    });

    // Return in format compatible with FilterHandler (orchestration)
    // This ensures consistent output whether using deterministic or AI-based filtering
    // PLUS backward compatibility for array-like access
    const result: any = {
      items: filtered,
      filtered: filtered,  // For compatibility with FilterHandler output
      removed: originalCount - filtered.length,
      originalCount: originalCount,
      count: filtered.length,

      // ✅ BACKWARD COMPATIBILITY: Make object behave like array
      // Allow {{stepX.data.length}}, {{stepX.data[0]}}, etc.
      length: filtered.length,

      // Array method proxies for backward compatibility
      map: filtered.map.bind(filtered),
      filter: filtered.filter.bind(filtered),
      reduce: filtered.reduce.bind(filtered),
      forEach: filtered.forEach.bind(filtered),
      find: filtered.find.bind(filtered),
      some: filtered.some.bind(filtered),
      every: filtered.every.bind(filtered),
      slice: filtered.slice.bind(filtered),
    };

    // Add numeric index accessors for backward compatibility
    filtered.forEach((item, index) => {
      result[index] = item;
    });

    return result;
  }

  /**
   * Reduce transformation
   */
  private transformReduce(data: any[], config: any): any {
    if (!Array.isArray(data)) {
      throw new ExecutionError('Reduce operation requires array input', 'INVALID_INPUT_TYPE');
    }

    const { reducer, initialValue } = config;

    // Simple reducers
    switch (reducer) {
      case 'sum':
        return data.reduce((acc, item) => acc + (Number(item) || 0), initialValue || 0);

      case 'count':
        return data.length;

      case 'concat':
        return data.reduce((acc, item) => acc.concat(item), initialValue || []);

      case 'merge':
        return data.reduce((acc, item) => ({ ...acc, ...item }), initialValue || {});

      default:
        throw new ExecutionError(`Unknown reducer: ${reducer}`, 'UNKNOWN_REDUCER');
    }
  }

  /**
   * Sort transformation
   */
  private transformSort(data: any[], config: any): any[] {
    if (!Array.isArray(data)) {
      throw new ExecutionError('Sort operation requires array input', 'INVALID_INPUT_TYPE');
    }

    const { field, order = 'asc' } = config;

    return [...data].sort((a, b) => {
      const aVal = field ? a[field] : a;
      const bVal = field ? b[field] : b;

      if (order === 'desc') {
        return bVal > aVal ? 1 : bVal < aVal ? -1 : 0;
      } else {
        return aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
      }
    });
  }

  /**
   * Group transformation
   *
   * Returns a structured object with backward compatibility:
   * - New workflows: use {{stepX.data.groups}}, {{stepX.data.keys}}, or {{stepX.data.grouped}}
   * - Legacy workflows: direct key access via {{stepX.data['key']}} still works
   */
  /**
   * Group transformation - GENERIC for ALL data structure patterns
   *
   * Supports:
   * - 2D arrays: group by column name
   * - Arrays of objects: group by field name (including nested like "fields.Status")
   * - Arrays of primitives: group by value
   */
  private transformGroup(data: any[], config: any): any {
    // CRITICAL: Unwrap structured output from previous steps
    const unwrappedData = this.unwrapStructuredOutput(data);

    if (!Array.isArray(unwrappedData)) {
      throw new ExecutionError(
        `Group operation requires array input. Received: ${typeof unwrappedData}. ` +
        `If this is from a previous step, make sure to reference the array field (e.g., step1.values, step1.items, step1.records)`,
        'INVALID_INPUT_TYPE'
      );
    }

    const { field, groupBy, column } = config;
    const groupKey = column || field || groupBy; // Support 'column', 'field', and 'groupBy'

    // Detect if 2D array pattern
    const is2DArray = Array.isArray(unwrappedData[0]);

    // Build grouped object using generic extractValueByKey
    const grouped = unwrappedData.reduce((acc, item, index) => {
      // Skip header row for 2D arrays
      if (is2DArray && index === 0) {
        return acc;
      }

      const key = groupKey
        ? String(this.extractValueByKey(item, groupKey, unwrappedData))
        : String(item);

      if (!acc[key]) {
        acc[key] = [];
      }
      acc[key].push(item);
      return acc;
    }, {} as Record<string, any[]>);

    console.log(`[Group] Grouped ${is2DArray ? 'rows' : 'items'} by "${groupKey || 'value'}" into ${Object.keys(grouped).length} groups`);

    // Return both grouped object and array of groups for iteration
    const groups = Object.entries(grouped).map(([key, items]) => ({
      key,
      items: items as any[],
      count: (items as any[]).length
    }));

    const result: any = {
      grouped,        // Original grouped object: { "Offir Omer": [...], "David Mor": [...] }
      groups,         // Array of groups for iteration: [{key: "Offir Omer", items: [...], count: 3}, ...]
      keys: Object.keys(grouped),  // Array of unique keys: ["Offir Omer", "David Mor"]
      count: groups.length         // Number of unique groups
    };

    // ✅ BACKWARD COMPATIBILITY: Add grouped keys directly to result
    // Allows {{stepX.data['key']}} to work like before
    Object.keys(grouped).forEach(key => {
      result[key] = grouped[key];
    });

    return result;
  }

  /**
   * Aggregate transformation
   */
  private transformAggregate(data: any[], config: any): any {
    if (!Array.isArray(data)) {
      throw new ExecutionError('Aggregate operation requires array input', 'INVALID_INPUT_TYPE');
    }

    const { aggregations } = config;

    if (!aggregations || !Array.isArray(aggregations)) {
      throw new ExecutionError('Aggregate operation requires aggregations config', 'MISSING_AGGREGATIONS');
    }

    const result: any = {};

    aggregations.forEach((agg: any) => {
      const { field, operation, alias } = agg;
      const key = alias || `${field}_${operation}`;

      const values = data.map(item => item[field]).filter(v => v !== undefined && v !== null);

      switch (operation) {
        case 'sum':
          result[key] = values.reduce((acc, val) => acc + Number(val), 0);
          break;

        case 'avg':
          result[key] = values.length > 0
            ? values.reduce((acc, val) => acc + Number(val), 0) / values.length
            : 0;
          break;

        case 'min':
          result[key] = values.length > 0 ? Math.min(...values.map(Number)) : null;
          break;

        case 'max':
          result[key] = values.length > 0 ? Math.max(...values.map(Number)) : null;
          break;

        case 'count':
          result[key] = values.length;
          break;

        default:
          throw new ExecutionError(`Unknown aggregation operation: ${operation}`, 'UNKNOWN_AGGREGATION');
      }
    });

    return result;
  }

  /**
   * Helper: Unwrap structured output from previous steps
   * Many transform operations return {items: [...], count: N, ...} format
   * This helper extracts the actual data array for chaining
   */
  private unwrapStructuredOutput(data: any): any {
    // If it's already an array, return as-is
    if (Array.isArray(data)) {
      return data;
    }

    // If it's an object with 'items', 'filtered', 'deduplicated', or 'groups' property
    if (data && typeof data === 'object') {
      if (Array.isArray(data.items)) {
        return data.items;
      }
      if (Array.isArray(data.filtered)) {
        return data.filtered;
      }
      if (Array.isArray(data.deduplicated)) {
        return data.deduplicated;
      }
      if (Array.isArray(data.groups)) {
        return data.groups;
      }
      // For action step outputs, check common array field names
      if (Array.isArray(data.values)) {  // Google Sheets
        return data.values;
      }
      if (Array.isArray(data.records)) {  // Airtable
        return data.records;
      }
      if (Array.isArray(data.emails)) {  // Gmail
        return data.emails;
      }
      if (Array.isArray(data.files)) {  // Google Drive
        return data.files;
      }
      if (Array.isArray(data.rows)) {  // Database-like outputs
        return data.rows;
      }
    }

    // If we can't unwrap, return the data as-is (might be a single object)
    return data;
  }

  /**
   * GENERIC Helper: Get value from item based on key, supporting multiple data structure patterns
   * Works with: 2D arrays, arrays of objects, nested objects, primitives
   *
   * @param item - The item to extract value from (can be array, object, or primitive)
   * @param key - The key to access (can be column name, field name, or index)
   * @param allData - Optional full dataset for header row detection (2D array pattern)
   * @returns The extracted value
   */
  private extractValueByKey(item: any, key: string | number, allData?: any[]): any {
    // Pattern 1: If item is an array (row in 2D array or tuple)
    if (Array.isArray(item)) {
      // Check if key is numeric (direct index access)
      if (typeof key === 'number') {
        return item[key];
      }

      // Check if key is string number (convert to index)
      const numericKey = parseInt(String(key), 10);
      if (!isNaN(numericKey)) {
        return item[numericKey];
      }

      // Key is a column name - need to find index from header row
      if (allData && Array.isArray(allData) && allData.length > 0) {
        const headerRow = allData[0];
        if (Array.isArray(headerRow)) {
          // Case-sensitive exact match
          const exactIndex = headerRow.indexOf(key);
          if (exactIndex !== -1) {
            return item[exactIndex];
          }

          // Case-insensitive match
          const lowerKey = String(key).toLowerCase();
          const caseInsensitiveIndex = headerRow.findIndex(
            (h: any) => String(h).toLowerCase() === lowerKey
          );
          if (caseInsensitiveIndex !== -1) {
            return item[caseInsensitiveIndex];
          }
        }
      }

      // If no header found or not 2D array, return undefined
      return undefined;
    }

    // Pattern 2: If item is an object (record from CRM, API, etc.)
    if (typeof item === 'object' && item !== null) {
      // Direct property access
      if (key in item) {
        return item[key];
      }

      // Nested property access (e.g., "fields.Name" for Airtable)
      const keyParts = String(key).split('.');
      let value = item;
      for (const part of keyParts) {
        if (value && typeof value === 'object' && part in value) {
          value = value[part];
        } else {
          return undefined;
        }
      }
      return value;
    }

    // Pattern 3: Primitive value (string, number, etc.)
    // Can't extract a field from a primitive, return the value itself
    return item;
  }

  /**
   * Deduplicate transformation - GENERIC for ALL data structure patterns
   *
   * Supports:
   * - 2D arrays (Google Sheets): column name → finds header, deduplicates by column
   * - Arrays of objects (Airtable, CRMs): field name → deduplicates by field
   * - Arrays of primitives: deduplicates entire values
   * - Nested objects: supports dot notation (e.g., "fields.Name")
   *
   * Returns structured output compatible with filter and other transforms
   */
  private transformDeduplicate(data: any[], config: any): any {
    // CRITICAL: Unwrap structured output from previous steps
    // Previous steps may return {items: [...], count: N} or {values: [...]} format
    const unwrappedData = this.unwrapStructuredOutput(data);

    if (!Array.isArray(unwrappedData)) {
      throw new ExecutionError(
        `Deduplicate operation requires array input. Received: ${typeof unwrappedData}. ` +
        `If this is from a previous step, make sure to reference the array field (e.g., step1.values, step1.items, step1.records)`,
        'INVALID_INPUT_TYPE'
      );
    }

    const { field, key, column } = config || {};
    const deduplicateKey = column || field || key; // Support 'column', 'field', and 'key'
    const originalCount = unwrappedData.length;

    let deduplicated: any[];

    if (deduplicateKey) {
      // Deduplicate based on extracted value using generic helper
      const seen = new Set();

      // Detect if 2D array pattern (array of arrays)
      const is2DArray = Array.isArray(unwrappedData[0]);

      if (is2DArray) {
        // For 2D arrays, preserve header row and deduplicate data rows
        const headerRow = unwrappedData[0];
        const dataRows = unwrappedData.slice(1);

        const uniqueRows = dataRows.filter((row: any) => {
          const value = this.extractValueByKey(row, deduplicateKey, unwrappedData);
          if (seen.has(value)) {
            return false;
          }
          seen.add(value);
          return true;
        });

        deduplicated = [headerRow, ...uniqueRows];
        console.log(`[Deduplicate] 2D array pattern: preserved header, deduplicated ${dataRows.length - uniqueRows.length} rows by "${deduplicateKey}"`);
      } else {
        // For objects or other patterns, deduplicate all items
        deduplicated = unwrappedData.filter(item => {
          const value = this.extractValueByKey(item, deduplicateKey, unwrappedData);
          if (seen.has(value)) {
            return false;
          }
          seen.add(value);
          return true;
        });
        console.log(`[Deduplicate] Object/item pattern: deduplicated ${unwrappedData.length - deduplicated.length} items by "${deduplicateKey}"`);
      }
    } else {
      // Deduplicate based on entire object (using JSON stringification)
      const seen = new Set();
      deduplicated = unwrappedData.filter(item => {
        const serialized = JSON.stringify(item);
        if (seen.has(serialized)) {
          return false;
        }
        seen.add(serialized);
        return true;
      });
      console.log(`[Deduplicate] No key specified: deduplicated ${unwrappedData.length - deduplicated.length} items by entire value`);
    }

    // Return in structured format compatible with filter and other transforms
    const result: any = {
      items: deduplicated,
      deduplicated: deduplicated,  // Alias for clarity
      removed: originalCount - deduplicated.length,
      originalCount: originalCount,
      count: deduplicated.length,
      length: deduplicated.length,

      // Array method proxies for backward compatibility
      map: deduplicated.map.bind(deduplicated),
      filter: deduplicated.filter.bind(deduplicated),
      reduce: deduplicated.reduce.bind(deduplicated),
      forEach: deduplicated.forEach.bind(deduplicated),
      find: deduplicated.find.bind(deduplicated),
      some: deduplicated.some.bind(deduplicated),
      every: deduplicated.every.bind(deduplicated),
      slice: deduplicated.slice.bind(deduplicated),
    };

    // Add numeric index accessors for array-like access
    deduplicated.forEach((item, index) => {
      result[index] = item;
    });

    return result;
  }

  /**
   * Execute delay step
   */
  private async executeDelay(step: DelayStep, params: any): Promise<void> {
    const { duration } = params;

    if (!duration || duration <= 0) {
      throw new ExecutionError(
        `Delay step ${step.id} has invalid duration: ${duration}`,
        'INVALID_DURATION',
        step.id
      );
    }

    console.log(`[StepExecutor] Delaying for ${duration}ms`);

    await new Promise(resolve => setTimeout(resolve, duration));
  }

  /**
   * Build context summary for LLM
   */
  private buildContextSummary(context: ExecutionContext): string {
    const completedSteps = context.completedSteps
      .map(stepId => {
        const output = context.getStepOutput(stepId);
        if (!output) return null;

        return `- ${stepId}: ${output.plugin}.${output.action} (${output.metadata.itemCount || 0} items)`;
      })
      .filter(Boolean)
      .join('\n');

    const inputValues = Object.entries(context.inputValues)
      .map(([key, value]) => `- ${key}: ${JSON.stringify(value)}`)
      .join('\n');

    return `
### Completed Steps:
${completedSteps || 'None'}

### Input Values:
${inputValues || 'None'}

### Progress:
- Completed: ${context.completedSteps.length}
- Failed: ${context.failedSteps.length}
- Skipped: ${context.skippedSteps.length}
    `.trim();
  }

  /**
   * Clean summary output by removing meta-commentary and narrative
   * Same logic as SummarizeHandler to ensure consistency across orchestrated and fallback paths
   * @private
   */
  private cleanSummaryOutput(output: string): string {
    let cleaned = output;

    // Remove leading meta-commentary patterns (from start of text)
    const leadingPatterns = [
      /^I will (now )?analyze[^\n]*(\n\n|\n)/i,
      /^I will (now )?summarize[^\n]*(\n\n|\n)/i,
      /^Let me (now )?analyze[^\n]*(\n\n|\n)/i,
      /^Let me (now )?summarize[^\n]*(\n\n|\n)/i,
      /^Now,? I will send[^\n]*(\n\n|\n)/i,
      /^I will (now )?send[^\n]*(\n\n|\n)/i,
      /^Executing[^\n]*(\n\n|\n)/i,
      /^Processing[^\n]*(\n\n|\n)/i,
    ];

    for (const pattern of leadingPatterns) {
      cleaned = cleaned.replace(pattern, '');
    }

    // Remove trailing meta-commentary patterns (from end of text)
    const sections = cleaned.split(/\n\n+/);
    const cleanedSections = sections.filter(section => {
      const lower = section.toLowerCase().trim();
      // Remove sections that are purely narrative about sending
      if (lower.startsWith('now,') && lower.includes('send')) return false;
      if (lower.startsWith('i will') && lower.includes('send')) return false;
      if (lower.startsWith('let me send')) return false;
      if (lower.startsWith('### sending')) return false;
      if (lower.startsWith('---') && lower.includes('send')) return false;
      return true;
    });

    cleaned = cleanedSections.join('\n\n');
    cleaned = cleaned.trim();

    // If the cleaning removed too much (less than 50 chars), return original
    if (cleaned.length < 50) {
      console.warn('[StepExecutor] Clean summary too short, using original output');
      return output;
    }

    console.log(`[StepExecutor] Cleaned summary: ${cleaned.length} chars (was ${output.length} chars)`);
    return cleaned;
  }
}
