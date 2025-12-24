/**
 * V4 Workflow Generator - OpenAI 3-Stage Architecture
 *
 * Stage 1: LLM → Simple text-based step plan (NOT JSON, NOT DSL)
 * Stage 2: Deterministic DSL Builder → PILOT_DSL_SCHEMA (fixes everything)
 * Stage 3: LLM Repair Loop → Fix ambiguities (if needed)
 *
 * This follows OpenAI's recommended architecture for 95%+ success rate.
 *
 * Supports two input paths:
 * - Enhanced Prompt: Stage 1 (LLM) + Stage 2 (DSL)
 * - Technical Workflow: Stage 2 only (skips LLM extraction)
 */

import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';
import { IPluginContext } from '@/lib/types/plugin-definition-context';
import { createLogger } from '@/lib/logger';

import { StepPlan, StepPlanExtractor } from './core/step-plan-extractor';
import { DSLBuilder, TechnicalWorkflowBuildInput } from './core/dsl-builder';
import type { TechnicalWorkflowStep } from '@/lib/validation/phase4-schema';

/**
 * Input structure for technical workflow
 */
export interface TechnicalWorkflowInput {
  technical_workflow: TechnicalWorkflowStep[];
  enhanced_prompt?: {
    plan_title?: string;
    plan_description?: string;
    specifics?: {
      resolved_user_inputs?: Array<{ key: string; value: string }>;
    };
  };
  analysis?: {
    agent_name?: string;
    description?: string;
  };
}

const logger = createLogger({ module: 'AgentKit', service: 'V4WorkflowGenerator' });

export interface V4GeneratorOptions {
  connectedPlugins?: IPluginContext[];
  userId?: string;
  anthropicApiKey?: string;
  aiAnalytics?: any;
}

/**
 * Unified input for workflow generation
 * Supports two paths:
 * - enhancedPrompt: Traditional Stage 1 (LLM) + Stage 2 (DSL)
 * - technicalWorkflow: Stage 2 only (skips LLM, uses pre-built workflow)
 */
export interface WorkflowGenerationInput {
  /** Enhanced prompt string - triggers Stage 1 LLM extraction */
  enhancedPrompt?: string;
  /** Pre-built technical workflow - skips Stage 1, goes directly to DSL building */
  technicalWorkflow?: TechnicalWorkflowInput;
}

export interface V4GenerationResult {
  success: boolean;
  workflow?: any;
  intent?: any;
  errors?: string[];
  warnings?: string[];
  /** Indicates if technical workflow path was used (Stage 1 skipped) */
  technicalWorkflowUsed?: boolean;
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

export class V4WorkflowGenerator {
  private pluginManager: PluginManagerV2;
  private stepPlanExtractor: StepPlanExtractor;
  private dslBuilder: DSLBuilder;

  constructor(pluginManager: PluginManagerV2, options?: V4GeneratorOptions) {
    this.pluginManager = pluginManager;

    // Stage 1: Step Plan Extractor (Claude Sonnet)
    this.stepPlanExtractor = new StepPlanExtractor({
      connectedPlugins: options?.connectedPlugins || [],
      userId: options?.userId,
      anthropicApiKey: options?.anthropicApiKey || process.env.ANTHROPIC_API_KEY || '',
      aiAnalytics: options?.aiAnalytics,
    });

    // Stage 2: DSL Builder (Deterministic)
    this.dslBuilder = new DSLBuilder(
      pluginManager,
      options?.connectedPlugins || []
    );
  }

  /**
   * Generate workflow from enhanced prompt or technical workflow
   * Implements OpenAI's 3-stage architecture with two input paths
   *
   * @param input - Either enhancedPrompt (string) or technicalWorkflow
   * @param options - Generation options
   * @returns Complete PILOT_DSL_SCHEMA workflow
   */
  async generateWorkflow(
    input: WorkflowGenerationInput,
    options?: V4GeneratorOptions
  ): Promise<V4GenerationResult> {
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

      if (hasTechnicalWorkflow) {
        // TECHNICAL WORKFLOW PATH: Skip Stage 1, build DSL directly
        logger.info(
          { stepsCount: input.technicalWorkflow!.technical_workflow.length },
          'Using technical workflow path (skipping Stage 1 LLM)'
        );

        // DIRECT PATH: Build DSL directly from technical workflow (no adapter needed)
        logger.info('Building DSL directly from technical workflow (bypassing adapter)');

        const technicalInput: TechnicalWorkflowBuildInput = {
          technical_workflow: input.technicalWorkflow!.technical_workflow,
          enhanced_prompt: input.technicalWorkflow!.enhanced_prompt,
          analysis: input.technicalWorkflow!.analysis,
        };

        const dslResult = await this.dslBuilder.buildFromTechnicalWorkflow(technicalInput);

        if (!dslResult.success) {
          return {
            success: false,
            errors: dslResult.errors,
            warnings: dslResult.warnings,
          };
        }

        logger.info({
          workflowStepsCount: dslResult.workflow?.workflow_steps?.length,
          pluginsUsed: dslResult.workflow?.suggested_plugins,
        }, 'DSL built directly from technical workflow');

        // Return directly - no need for Stage 2 buildDSL
        return {
          success: true,
          workflow: dslResult.workflow,
          warnings: dslResult.warnings,
          technicalWorkflowUsed: true,
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
        return {
          success: false,
          errors: ['Either enhancedPrompt or technicalWorkflow is required'],
        };
      }

      // STAGE 2: Deterministic DSL Builder (same for both paths)
      logger.info('Stage 2: Deterministic DSL Builder starting');

      const dslResult = await this.dslBuilder.buildDSL(stepPlan);

      if (!dslResult.success && !dslResult.ambiguities) {
        return {
          success: false,
          errors: dslResult.errors,
          warnings: dslResult.warnings,
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

        return {
          success: true,
          workflow: dslResult.workflow,
          warnings,
          technicalWorkflowUsed,
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

      return {
        success: true,
        workflow: dslResult.workflow,
        warnings: dslResult.warnings,
        technicalWorkflowUsed,
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
      return {
        success: false,
        errors: [error.message || 'Unknown error during workflow generation'],
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
}
