/**
 * V4 Workflow Generator - OpenAI 3-Stage Architecture
 *
 * Stage 1: LLM → Simple text-based step plan (NOT JSON, NOT DSL)
 * Stage 2: Deterministic DSL Builder → PILOT_DSL_SCHEMA (fixes everything)
 * Stage 3: LLM Repair Loop → Fix ambiguities (if needed)
 *
 * This follows OpenAI's recommended architecture for 95%+ success rate.
 */

import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';
import { IPluginContext } from '@/lib/types/plugin-definition-context';

import { StepPlanExtractor } from './core/step-plan-extractor';
import { DSLBuilder } from './core/dsl-builder';

export interface V4GeneratorOptions {
  connectedPlugins?: IPluginContext[];
  userId?: string;
  anthropicApiKey?: string;
  aiAnalytics?: any;
}

export interface V4GenerationResult {
  success: boolean;
  workflow?: any;
  intent?: any;
  errors?: string[];
  warnings?: string[];
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
   * Generate workflow from enhanced prompt
   * Implements OpenAI's 3-stage architecture
   *
   * @param enhancedPrompt - Structured prompt from enhance-prompt API
   * @param options - Generation options
   * @returns Complete PILOT_DSL_SCHEMA workflow
   */
  async generateWorkflow(
    enhancedPrompt: string,
    options?: V4GeneratorOptions
  ): Promise<V4GenerationResult> {
    try {
      console.log('[V4 Generator] ===== STAGE 1: LLM STEP PLAN =====');

      // STAGE 1: LLM outputs simple text-based step plan (NOT JSON, NOT DSL)
      const stepPlan = await this.stepPlanExtractor.extractStepPlan(enhancedPrompt);

      console.log('[V4 Generator] Step plan extracted:', {
        goal: stepPlan.goal,
        stepsCount: stepPlan.steps.length,
        steps: stepPlan.steps.map(s => `${s.stepNumber}. ${s.description}`),
        tokensUsed: stepPlan.tokensUsed,
        cost: stepPlan.cost,
      });

      console.log('[V4 Generator] ===== STAGE 2: DETERMINISTIC DSL BUILDER =====');

      // STAGE 2: Deterministic engine builds PILOT_DSL_SCHEMA
      const dslResult = await this.dslBuilder.buildDSL(stepPlan);

      if (!dslResult.success && !dslResult.ambiguities) {
        return {
          success: false,
          errors: dslResult.errors,
          warnings: dslResult.warnings,
        };
      }

      // Build token metrics
      const tokensUsed = {
        stage1: stepPlan.tokensUsed || { input: 0, output: 0, total: 0 },
        total: stepPlan.tokensUsed || { input: 0, output: 0, total: 0 },
      };

      const cost = {
        stage1: stepPlan.cost || 0,
        total: stepPlan.cost || 0,
      };

      // STAGE 3: If there are ambiguities, we'd ask LLM to clarify
      // For now, we'll return the workflow with warnings
      if (dslResult.ambiguities && dslResult.ambiguities.length > 0) {
        console.log('[V4 Generator] ===== STAGE 3: AMBIGUITIES DETECTED =====');
        console.log('Ambiguities:', dslResult.ambiguities.map(a => a.question));

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

      console.log('[V4 Generator] ===== SUCCESS: PILOT_DSL_SCHEMA GENERATED =====');

      return {
        success: true,
        workflow: dslResult.workflow,
        warnings: dslResult.warnings,
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
      console.error('[V4 Generator] Error:', error);
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
