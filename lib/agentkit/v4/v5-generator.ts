/**
 * V5 Workflow Generator - OpenAI 3-Stage Architecture with LLM Review
 *
 * Stage 1: LLM → Simple text-based step plan (NOT JSON, NOT DSL)
 * Stage 2: Deterministic DSL Builder → PILOT_DSL_SCHEMA (fixes everything)
 * Stage 3: LLM Repair Loop → Fix ambiguities (if needed)
 *
 * This follows OpenAI's recommended architecture for 95%+ success rate.
 *
 * Supports two input paths:
 * - Enhanced Prompt: Stage 1 (LLM extraction) + Stage 2 (DSL)
 * - Technical Workflow: LLM Review + Stage 2 (skips Stage 1 extraction)
 *
 * V5 Enhancement: Technical workflow path now includes LLM-based review
 * and repair before converting to StepPlan for DSL building.
 */

import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';
import { IPluginContext } from '@/lib/types/plugin-definition-context';
import { createLogger } from '@/lib/logger';
import { PromptLoader } from '@/app/api/types/PromptLoader';
import { ProviderFactory, ProviderName } from '@/lib/ai/providerFactory';
import type { TechnicalWorkflowStep, TechnicalInputRequired } from '@/lib/validation/phase4-schema';
import { jsonrepair } from 'jsonrepair';
import {
  validateTechnicalReviewerResponse,
  type ReviewerSummary,
  type TechnicalReviewerFeasibility,
} from '@/lib/validation/technical-reviewer-schema';

import { StepPlan, StepPlanExtractor } from './core/step-plan-extractor';
import { DSLBuilder, TechnicalWorkflowBuildInput } from './core/dsl-builder';
import {
  Phase4DSLBuilder,
  Phase4Response,
  Phase4DSLBuilderResult,
} from './core/phase4-dsl-builder';

// Session tracking
import {
  WorkflowSessionTracker,
  type SessionTrackerConfig,
} from './utils/workflow-session-tracker';

/**
 * Input structure for technical workflow (moved from adapter)
 */
export interface TechnicalWorkflowInput {
  technical_workflow: TechnicalWorkflowStep[];
  enhanced_prompt?: {
    plan_title?: string;
    plan_description?: string;
    specifics?: {
      services_involved?: string[];
      resolved_user_inputs?: Array<{ key: string; value: string }>;
    };
  };
  analysis?: {
    agent_name?: string;
    description?: string;
  };
  /** Required services/plugins for the workflow */
  requiredServices?: string[];
  /** Technical inputs required from user at runtime */
  technical_inputs_required?: TechnicalInputRequired[];
}

const logger = createLogger({ module: 'AgentKit', service: 'V5WorkflowGenerator' });

// Prompt template file names for technical workflow reviewer
//const TECHNICAL_REVIEWER_SYSTEM_PROMPT = 'Workflow-Agent-Technical-Reviewer-SystemPrompt-v2';
const TECHNICAL_REVIEWER_SYSTEM_PROMPT = 'Workflow-Agent-Technical-Reviewer-SystemPrompt-v3';
const TECHNICAL_REVIEWER_USER_PROMPT = 'Workflow-Agent-Technical-Reviewer-UserPrompt-v1';

// Re-export types from schema for backwards compatibility
export type { ReviewerSummary, TechnicalReviewerFeasibility as Feasibility } from '@/lib/validation/technical-reviewer-schema';

/**
 * Extended TechnicalWorkflowInput with reviewer fields
 */
export interface ReviewedTechnicalWorkflowInput extends TechnicalWorkflowInput {
  reviewer_summary?: ReviewerSummary;
  feasibility?: TechnicalReviewerFeasibility;
}

// Re-export SessionTrackerConfig for backwards compatibility
export type { SessionTrackerConfig };

export interface V5GeneratorOptions {
  connectedPlugins?: IPluginContext[];
  userId?: string;
  aiAnalytics?: any;
  /** Session tracking configuration (optional) */
  sessionTracking?: SessionTrackerConfig;
}

/**
 * Unified input for workflow generation
 * Supports two paths:
 * - enhancedPrompt: Traditional Stage 1 (LLM extraction) + Stage 2 (DSL)
 * - technicalWorkflow: LLM Review + Stage 2 (skips Stage 1 extraction)
 */
export interface WorkflowGenerationInput {
  /** Enhanced prompt string - triggers Stage 1 LLM extraction */
  enhancedPrompt?: string;
  /** Pre-built technical workflow - triggers LLM review before DSL building */
  technicalWorkflow?: TechnicalWorkflowInput;
  /** AI provider to use for technical workflow review (required when technicalWorkflow is provided) */
  provider?: ProviderName;
  /** Model to use for technical workflow review (required when technicalWorkflow is provided) */
  model?: string;
  /** Plugin names to include in schema_services for LLM review context */
  required_services?: string[];
  /** Skip DSL building and return only reviewed workflow (for testing/debugging) */
  skipDslBuilder?: boolean;
}

export interface V5GenerationResult {
  success: boolean;
  workflow?: any;
  /** Reviewed technical workflow (only populated when skipDslBuilder=true) */
  reviewedWorkflow?: ReviewedTechnicalWorkflowInput;
  intent?: any;
  errors?: string[];
  warnings?: string[];
  /** Indicates if technical workflow path was used (Stage 1 skipped) */
  technicalWorkflowUsed?: boolean;
  /** Indicates if DSL building was skipped (only LLM review performed) */
  dslBuilderSkipped?: boolean;
  /** Session ID from workflow generation diary (if session tracking enabled) */
  sessionId?: string;
  metadata?: {
    actionsResolved: number;
    parametersMapping: number;
    patternsDetected: string[];
    totalSteps: number;
    autoFixApplied?: boolean;
  };
  tokensUsed?: {
    stage1: {
      input: number;
      output: number;
      total: number;
    };
    total: {
      input: number;
      output: number;
      total: number;
    };
  };
  cost?: {
    stage1: number;
    total: number;
  };
}

export class V5WorkflowGenerator {
  private pluginManager: PluginManagerV2;
  private stepPlanExtractor: StepPlanExtractor;
  private dslBuilder: DSLBuilder;
  private phase4DslBuilder: Phase4DSLBuilder;

  // Session tracking (optional) - uses helper class for diary functionality
  private sessionTracker?: WorkflowSessionTracker;

  constructor(pluginManager: PluginManagerV2, options?: V5GeneratorOptions) {
    this.pluginManager = pluginManager;

    // Stage 1: Step Plan Extractor (Claude Sonnet)
    this.stepPlanExtractor = new StepPlanExtractor({
      connectedPlugins: options?.connectedPlugins || [],
      userId: options?.userId,
      anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
      aiAnalytics: options?.aiAnalytics,
    });

    // Stage 2: DSL Builder (Deterministic) - legacy path
    this.dslBuilder = new DSLBuilder(
      pluginManager,
      options?.connectedPlugins || []
    );

    // Phase4 DSL Builder - new deterministic converter for technical workflow
    this.phase4DslBuilder = new Phase4DSLBuilder();

    // Session tracking - use helper class for diary functionality
    if (options?.sessionTracking) {
      this.sessionTracker = new WorkflowSessionTracker(options.sessionTracking);
    }
  }

  // ============================================================================
  // Main Generation Methods
  // ============================================================================

  /**
   * Generate workflow from enhanced prompt or technical workflow
   *
   * Two input paths:
   * - enhancedPrompt: Stage 1 LLM extraction → Stage 2 DSL building
   * - technicalWorkflow: LLM review/repair → Stage 2 DSL building
   *
   * @param input - WorkflowGenerationInput with either enhancedPrompt or technicalWorkflow
   * @returns V5GenerationResult with complete PILOT_DSL_SCHEMA workflow
   */
  async generateWorkflow(
    input: WorkflowGenerationInput
  ): Promise<V5GenerationResult> {
    try {
      let stepPlan: StepPlan;
      let tokensUsed = {
        stage1: { input: 0, output: 0, total: 0 },
        total: { input: 0, output: 0, total: 0 },
      };
      let cost = { stage1: 0, total: 0 };
      let technicalWorkflowUsed = false;

      // Determine which path to use
      const hasTechnicalWorkflow = (input.technicalWorkflow?.technical_workflow?.length ?? 0) > 0;
      const inputPath = hasTechnicalWorkflow ? 'technical_workflow' : 'enhanced_prompt';

      // Start session for tracking (if enabled)
      const sessionId = await this.sessionTracker?.start({
        technicalWorkflow: input.technicalWorkflow,
        enhancedPrompt: input.enhancedPrompt,
        provider: input.provider,
        model: input.model,
      }, inputPath);

      if (!hasTechnicalWorkflow) {
        logger.warn(
          { hasEnhancedPrompt: !!input.enhancedPrompt },
          'No technical workflow provided - V5 generator will use Stage 1 LLM extraction (less efficient path)'
        );
      }

      if (hasTechnicalWorkflow) {
        // TECHNICAL WORKFLOW PATH: Skip Stage 1, use pre-built workflow
        logger.info(
          { stepsCount: input.technicalWorkflow!.technical_workflow.length },
          'Using technical workflow path (skipping Stage 1 LLM)'
        );

        // Track technical_reviewer stage
        await this.sessionTracker?.addStage({
          stage_name: 'technical_reviewer',
          input_data: input.technicalWorkflow,
          input_summary: `TechnicalWorkflow with ${input.technicalWorkflow!.technical_workflow.length} steps`,
        });

        // Review technical workflow via LLM before converting to DSL
        const reviewedWorkflow = await this.reviewTechnicalWorkflow(input);

        // Complete technical_reviewer stage
        await this.sessionTracker?.completeStage({
          output_data: reviewedWorkflow,
          output_summary: `Reviewed workflow: ${reviewedWorkflow.reviewer_summary?.status || 'unknown'}, can_execute: ${reviewedWorkflow.feasibility?.can_execute}`,
          llm_call: {
            prompt_template: TECHNICAL_REVIEWER_SYSTEM_PROMPT,
            input_tokens: 0, // TODO: Capture from reviewTechnicalWorkflow
            output_tokens: 0,
            finish_reason: 'stop',
            model: input.model || 'unknown',
            provider: input.provider || 'anthropic',
          },
        });

        logger.info({
          reviewerStatus: reviewedWorkflow.reviewer_summary?.status,
          canExecute: reviewedWorkflow.feasibility?.can_execute,
          reviewedStepsCount: reviewedWorkflow.technical_workflow.length,
        }, 'Technical workflow reviewed by LLM');

        // If skipDslBuilder is true, return reviewed workflow without DSL building
        if (input.skipDslBuilder) {
          logger.info('Skipping DSL builder (skipDslBuilder=true) - returning reviewed workflow only');

          // Complete session without DSL output
          await this.sessionTracker?.complete({});

          return {
            success: true,
            workflow: undefined,
            reviewedWorkflow,
            technicalWorkflowUsed: true,
            dslBuilderSkipped: true,
            sessionId,
            tokensUsed,
            cost,
          };
        }

        // DIRECT PATH: Build DSL directly from technical workflow using Phase4DSLBuilder
        logger.info('Building DSL directly from technical workflow (using Phase4DSLBuilder)');

        // Track phase4_dsl_builder stage
        await this.sessionTracker?.addStage({
          stage_name: 'phase4_dsl_builder',
          input_data: reviewedWorkflow,
          input_summary: `Reviewed workflow with ${reviewedWorkflow.technical_workflow.length} steps`,
        });

        // Convert reviewer feasibility (strings) to Phase4Response format (objects)
        const convertedFeasibility = reviewedWorkflow.feasibility ? {
          can_execute: reviewedWorkflow.feasibility.can_execute,
          blocking_issues: reviewedWorkflow.feasibility.blocking_issues?.map(s => ({
            type: 'reviewer',
            description: s,
          })),
          warnings: reviewedWorkflow.feasibility.warnings?.map(s => ({
            type: 'reviewer',
            description: s,
          })),
        } : undefined;

        // Merge data from reviewer output AND original Phase 4 input
        // The reviewer only returns technical_workflow, reviewer_summary, and feasibility
        // We need to preserve enhanced_prompt, technical_inputs_required, and requiredServices from original input
        const originalInput = input.technicalWorkflow!;

        const phase4Input: Phase4Response = {
          // From reviewer output (the validated/repaired workflow)
          technical_workflow: reviewedWorkflow.technical_workflow,
          feasibility: convertedFeasibility,

          // From original Phase 4 input (preserved, not returned by reviewer)
          enhanced_prompt: originalInput.enhanced_prompt,
          technical_inputs_required: originalInput.technical_inputs_required || [],
          requiredServices: originalInput.requiredServices,
        };

        logger.debug({
          hasEnhancedPrompt: !!phase4Input.enhanced_prompt,
          technicalInputsCount: phase4Input.technical_inputs_required?.length || 0,
          requiredServicesCount: phase4Input.requiredServices?.length || 0,
          servicesInvolved: phase4Input.enhanced_prompt?.specifics?.services_involved,
        }, 'Phase4Input merged from reviewer output and original input');

        const dslResult: Phase4DSLBuilderResult = this.phase4DslBuilder.build(phase4Input);

        // Complete phase4_dsl_builder stage
        await this.sessionTracker?.completeStage({
          output_data: dslResult.workflow,
          output_summary: dslResult.success
            ? `PILOT_DSL with ${dslResult.workflow?.workflow_steps?.length || 0} steps`
            : `Failed: ${dslResult.errors.length} errors`,
          validation: {
            valid: dslResult.success,
            schema_name: 'PILOT_DSL_SCHEMA',
            errors: dslResult.errors.map(e => `[${e.stepId}] ${e.message}`),
          },
        });

        // Log conversion stats and warnings
        logger.info({
          success: dslResult.success,
          stats: dslResult.stats,
          warningsCount: dslResult.warnings.length,
          errorsCount: dslResult.errors.length,
        }, 'Phase4DSLBuilder conversion complete');

        if (dslResult.warnings.length > 0) {
          logger.warn({
            warnings: dslResult.warnings.map(w => ({
              stepId: w.stepId,
              type: w.type,
              message: w.message,
            })),
          }, 'Phase4DSLBuilder conversion warnings');
        }

        if (!dslResult.success || !dslResult.workflow) {
          logger.error({
            errors: dslResult.errors,
          }, 'Phase4DSLBuilder conversion failed');

          // Fail the session
          await this.sessionTracker?.fail(dslResult.errors.map(e => `[${e.stepId}] ${e.message}`).join('; '));

          return {
            success: false,
            errors: dslResult.errors.map(e => `[${e.stepId}] ${e.message}`),
            warnings: dslResult.warnings.map(w => `[${w.stepId}] ${w.message}`),
            sessionId,
          };
        }

        logger.info({
          agentName: dslResult.workflow.agent_name,
          workflowType: dslResult.workflow.workflow_type,
          workflowStepsCount: dslResult.workflow.workflow_steps?.length,
          stepTypes: dslResult.workflow.workflow_steps?.map(s => s.type),
          pluginsUsed: dslResult.workflow.suggested_plugins,
          requiredInputsCount: dslResult.workflow.required_inputs?.length,
          confidence: dslResult.workflow.confidence,
          conversionStats: dslResult.stats,
        }, 'Phase4DSLBuilder: PILOT_DSL_SCHEMA generated');

        // Complete the session with the generated DSL
        await this.sessionTracker?.complete(dslResult.workflow);

        // Return directly - no need for Stage 2 buildDSL
        return {
          success: true,
          workflow: dslResult.workflow,
          warnings: dslResult.warnings.map(w => `[${w.stepId}] ${w.message}`),
          technicalWorkflowUsed: true,
          sessionId,
          tokensUsed,
          cost,
        };

      } else if (input.enhancedPrompt) {
        // TRADITIONAL PATH: Stage 1 LLM extraction
        logger.info('Stage 1: LLM Step Plan extraction starting');

        stepPlan = await this.stepPlanExtractor.extractStepPlan(input.enhancedPrompt);

        // Capture token metrics from Stage 1
        tokensUsed.stage1 = stepPlan.tokensUsed || { input: 0, output: 0, total: 0 };
        tokensUsed.total = tokensUsed.stage1;
        cost.stage1 = stepPlan.cost || 0;
        cost.total = cost.stage1;

        logger.info({
          goal: stepPlan.goal,
          stepsCount: stepPlan.steps.length,
          steps: stepPlan.steps.map(s => `${s.stepNumber}. ${s.description}`),
          tokensUsed: stepPlan.tokensUsed,
          cost: stepPlan.cost,
        }, 'Stage 1 complete: Step plan extracted');

      } else {
        // No valid input provided
        await this.sessionTracker?.fail('Either enhancedPrompt or technicalWorkflow is required');
        return {
          success: false,
          errors: ['Either enhancedPrompt or technicalWorkflow is required'],
          sessionId,
        };
      }

      // STAGE 2: Deterministic DSL Builder (same for both paths)
      logger.info('Stage 2: Deterministic DSL Builder starting');

      const dslResult = await this.dslBuilder.buildDSL(stepPlan);

      if (!dslResult.success && !dslResult.ambiguities) {
        await this.sessionTracker?.fail(dslResult.errors?.join('; ') || 'DSL building failed');
        return {
          success: false,
          errors: dslResult.errors,
          warnings: dslResult.warnings,
          sessionId,
        };
      }

      // STAGE 3: If there are ambiguities, we'd ask LLM to clarify
      // For now, we'll return the workflow with warnings
      if (dslResult.ambiguities && dslResult.ambiguities.length > 0) {
        logger.warn({
          ambiguities: dslResult.ambiguities.map(a => a.question),
        }, 'Stage 3: Ambiguities detected');

        // TODO: Implement LLM repair loop
        // For now, return with warnings
        const warnings = [
          ...(dslResult.warnings || []),
          ...dslResult.ambiguities.map(a => `Step ${a.stepNumber}: ${a.question}`),
        ];

        // Complete session even with ambiguities (workflow was generated)
        if (dslResult.workflow) {
          await this.sessionTracker?.complete(dslResult.workflow);
        }

        return {
          success: true,
          workflow: dslResult.workflow,
          warnings,
          technicalWorkflowUsed,
          sessionId,
          metadata: {
            actionsResolved: dslResult.workflow?.steps?.length || 0,
            parametersMapping: 0,
            patternsDetected: [],
            totalSteps: dslResult.workflow?.steps?.length || 0,
          },
          tokensUsed,
          cost,
        };
      }

      logger.info({
        technicalWorkflowUsed,
        stepsCount: dslResult.workflow?.workflow_steps?.length || 0,
      }, 'PILOT_DSL_SCHEMA generated successfully');

      // Complete the session with the generated DSL
      if (dslResult.workflow) {
        await this.sessionTracker?.complete(dslResult.workflow);
      }

      return {
        success: true,
        workflow: dslResult.workflow,
        warnings: dslResult.warnings,
        technicalWorkflowUsed,
        sessionId,
        metadata: {
          actionsResolved: dslResult.workflow?.workflow_steps?.length || 0,
          parametersMapping: 0,
          patternsDetected: [],
          totalSteps: dslResult.workflow?.workflow_steps?.length || 0,
        },
        tokensUsed,
        cost,
      };
    } catch (error: any) {
      logger.error({ err: error }, 'Workflow generation failed');

      // Fail the session on error
      await this.sessionTracker?.fail(error.message || 'Unknown error during workflow generation');

      return {
        success: false,
        errors: [error.message || 'Unknown error during workflow generation'],
        sessionId: this.sessionTracker?.sessionId,
      };
    }
  }

  /**
   * Validate a generated workflow against PILOT_DSL_SCHEMA
   * (Placeholder for now - would integrate with existing validator)
   */
  async validateWorkflow(workflow: any): Promise<{ valid: boolean; errors: string[] }> {
    // TODO: Integrate with lib/pilot/schema/runtime-validator.ts
    const errors: string[] = [];

    // Basic validation
    if (!workflow || !workflow.steps) {
      errors.push('Workflow must have steps array');
    }

    if (workflow.steps && workflow.steps.length === 0) {
      errors.push('Workflow must have at least one step');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Load system prompt for technical workflow reviewer from template file
   */
  private buildTechnicalReviewerSystemPrompt(): string {
    const promptLoader = new PromptLoader(TECHNICAL_REVIEWER_SYSTEM_PROMPT);
    return promptLoader.getPrompt();
  }

  /**
   * Build user prompt for technical workflow reviewer
   *
   * Loads template and replaces placeholders with:
   * - ENHANCED_PROMPT: The original enhanced prompt (source of truth for intent)
   * - TECHNICAL_WORKFLOW: JSON stringified workflow steps to review
   * - SERVICES_SCHEMA: JSON stringified plugin schemas (allowed actions + params)
   */
  private buildTechnicalReviewerUserPrompt(
    enhancedPrompt: string,
    technicalWorkflow: TechnicalWorkflowStep[],
    schemaServices: string
  ): string {
    const promptLoader = new PromptLoader(TECHNICAL_REVIEWER_USER_PROMPT);
    return promptLoader.replaceKeywords({
      ENHANCED_PROMPT: enhancedPrompt,
      TECHNICAL_WORKFLOW: JSON.stringify(technicalWorkflow, null, 2),
      SERVICES_SCHEMA: schemaServices,
    });
  }

  /**
   * Strip markdown code fences from LLM response content
   *
   * LLMs often wrap JSON responses in ```json ... ``` markdown fences.
   * This method removes those fences to allow proper JSON parsing.
   */
  private stripMarkdownCodeFences(content: string): string {
    let cleaned = content.trim();

    // Remove opening fence (```json or ```)
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.slice(7);
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.slice(3);
    }

    // Remove closing fence
    if (cleaned.endsWith('```')) {
      cleaned = cleaned.slice(0, -3);
    }

    return cleaned.trim();
  }

  /**
   * Review and repair technical workflow using LLM
   *
   * Sends the technical workflow to the configured LLM provider for validation
   * and repair. The LLM returns a reviewed workflow with reviewer_summary and
   * feasibility assessment.
   *
   * @throws Error if provider or model is not specified in input
   */
  private async reviewTechnicalWorkflow(
    input: WorkflowGenerationInput
  ): Promise<ReviewedTechnicalWorkflowInput> {
    // Validate required provider and model
    if (!input.provider) {
      throw new Error('provider is required for technical workflow review');
    }
    if (!input.model) {
      throw new Error('model is required for technical workflow review');
    }

    logger.info({ provider: input.provider, model: input.model }, 'Starting technical workflow review via LLM');

    // Build schema_services from required_services plugin definitions
    const pluginContexts = this.pluginManager.getPluginsDefinitionContext(
      input.required_services || []
    );
    const schemaServices = JSON.stringify(
      pluginContexts.map(p => p.toLongLLMContext()),
      null,
      2
    );

    logger.debug({
      pluginCount: pluginContexts.length,
      schemaServicesLength: schemaServices.length,
    }, 'Built schema_services from plugin definitions');

    // Build system and user prompts from templates
    const systemPrompt = this.buildTechnicalReviewerSystemPrompt();
    const userPrompt = this.buildTechnicalReviewerUserPrompt(
      input.enhancedPrompt || '',
      input.technicalWorkflow!.technical_workflow,
      schemaServices
    );

    logger.debug({
      systemPromptLength: systemPrompt.length,
      userPromptLength: userPrompt.length,
    }, 'Built reviewer prompts from templates');

    // Get provider instance and model's max output tokens
    const provider = ProviderFactory.getProvider(input.provider);
    const maxTokens = provider.getMaxOutputTokens(input.model);

    logger.info({ provider: input.provider, model: input.model, maxTokens }, 'Calling LLM for technical workflow review');

    const response = await provider.chatCompletion(
      {
        model: input.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens: maxTokens,
      },
      {
        userId: 'system',
        feature: 'technical_workflow_review',
        component: 'v5-generator',
        workflow_step: 'review_technical_workflow',
      }
    );

    // Extract response content and metadata
    const choice = response.choices?.[0];
    const content = choice?.message?.content;
    // finish_reason (OpenAI) or stop_reason (Anthropic) - normalize to one field
    const finishReason = choice?.finish_reason || (response as any).stop_reason;
    const usage = response.usage;

    // Log response metadata for diagnostics
    logger.info({
      finishReason,
      contentLength: content?.length || 0,
      inputTokens: usage?.prompt_tokens || usage?.input_tokens,
      outputTokens: usage?.completion_tokens || usage?.output_tokens,
    }, 'LLM response received');

    // Log raw response for debugging
    logger.debug({ rawResponse: content }, 'Raw LLM response content');

    if (!content) {
      throw new Error('Empty response from LLM technical workflow review');
    }

    // Parse and validate JSON response from LLM (strip markdown fences if present)
    let rawParsed: unknown;
    const cleanedContent = this.stripMarkdownCodeFences(content);

    try {
      rawParsed = JSON.parse(cleanedContent);
    } catch (parseError) {
      // Attempt to repair malformed/truncated JSON using jsonrepair
      logger.warn({
        parseError: String(parseError),
        contentLength: cleanedContent.length,
        contentTail: cleanedContent.substring(cleanedContent.length - 200),
      }, 'JSON parse failed, attempting repair with jsonrepair');

      try {
        const repairedJson = jsonrepair(cleanedContent);
        rawParsed = JSON.parse(repairedJson);
        logger.info({
          originalLength: cleanedContent.length,
          repairedLength: repairedJson.length,
        }, 'JSON repaired successfully');
      } catch (repairError) {
        logger.error({
          content: content.substring(0, 500),
          repairError: String(repairError),
        }, 'Failed to parse and repair LLM response as JSON');
        throw new Error(`Failed to parse technical workflow review response: ${parseError}`);
      }
    }

    // Validate response against schema
    const validationResult = validateTechnicalReviewerResponse(rawParsed);
    if (!validationResult.success) {
      logger.error({
        errors: validationResult.errors,
        rawResponse: JSON.stringify(rawParsed).substring(0, 1000),
      }, 'Technical reviewer response failed schema validation');
      throw new Error(`Technical reviewer response validation failed: ${validationResult.errors?.join(', ')}`);
    }

    const parsed = validationResult.data!;

    logger.info({
      reviewerStatus: parsed.reviewer_summary?.status,
      canExecute: parsed.feasibility?.can_execute,
      stepsCount: parsed.technical_workflow?.length,
    }, 'Technical workflow review complete');

    // Return reviewed workflow with reviewer fields added
    // NOTE: The reviewer only returns technical_workflow, reviewer_summary, and feasibility
    // We preserve the original input fields (enhanced_prompt, requiredServices, technical_inputs_required)
    // by spreading input.technicalWorkflow. The caller (generateWorkflow) also explicitly
    // pulls these from the original input to ensure they're not lost.
    const originalInput = input.technicalWorkflow!;

    return {
      // Preserve original fields that reviewer doesn't return
      enhanced_prompt: originalInput.enhanced_prompt,
      analysis: originalInput.analysis,
      requiredServices: originalInput.requiredServices,
      technical_inputs_required: originalInput.technical_inputs_required,

      // From reviewer output (validated/repaired)
      technical_workflow: parsed.technical_workflow,
      reviewer_summary: parsed.reviewer_summary,
      feasibility: parsed.feasibility,
    };
  }
}
