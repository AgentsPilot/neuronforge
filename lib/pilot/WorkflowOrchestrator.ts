/**
 * WorkflowOrchestrator - Hybrid AI workflow generation
 *
 * Uses GPT-4o Mini as primary generator with Claude Sonnet 4 fallback
 * for cost-efficient workflow generation with quality assurance.
 *
 * Cost savings: ~97% (GPT-4o Mini: $0.001 vs Claude Sonnet: $0.03 per agent)
 */

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { SupabaseClient } from '@supabase/supabase-js';
import { SystemConfigService } from '@/lib/services/SystemConfigService';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { AUDIT_EVENTS } from '@/lib/audit/events';

export interface PilotStep {
  id: string;
  operation: string;
  step_type: 'llm_decision' | 'transform' | 'conditional' | 'api_call';
  inputs?: Record<string, any>;
  outputs?: Record<string, any>;
  required_tools?: string[];
  [key: string]: any;
}

export interface WorkflowGenerationResult {
  pilot_steps: PilotStep[];
  generator_used: 'gpt-4o-mini' | 'claude-sonnet-4';
  validation_passed: boolean;
  generation_time_ms: number;
  tokens_used: {
    input: number;
    output: number;
    total: number;
  };
  cost_usd: number;
  fallback_reason?: string;
}

export class WorkflowOrchestrator {
  private openai: OpenAI;
  private anthropic: Anthropic;
  private auditTrail: AuditTrailService;

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    this.auditTrail = AuditTrailService.getInstance();
  }

  /**
   * Generate workflow using hybrid approach
   */
  async generateWorkflow(
    supabase: SupabaseClient,
    userId: string,
    agentId: string,
    userGoal: string,
    availablePlugins: string[]
  ): Promise<WorkflowGenerationResult> {
    const startTime = Date.now();

    // Check which orchestrator model to use from system config
    const primaryModel = await SystemConfigService.getString(
      supabase,
      'orchestrator_primary_model',
      'gpt-4o-mini' // Default to cost-efficient option
    );

    const fallbackModel = await SystemConfigService.getString(
      supabase,
      'orchestrator_fallback_model',
      'claude-sonnet-4'
    );

    const enableFallback = await SystemConfigService.getBoolean(
      supabase,
      'orchestrator_enable_fallback',
      true // Default: enabled
    );

    console.log(`🎯 [Orchestrator] Primary: ${primaryModel}, Fallback: ${enableFallback ? fallbackModel : 'disabled'}`);

    try {
      // Try primary model first
      if (primaryModel === 'gpt-4o-mini') {
        return await this.generateWithGPT4oMini(
          supabase,
          userId,
          agentId,
          userGoal,
          availablePlugins,
          enableFallback ? fallbackModel : undefined
        );
      } else if (primaryModel === 'claude-sonnet-4') {
        return await this.generateWithClaudeSonnet(
          supabase,
          userId,
          agentId,
          userGoal,
          availablePlugins
        );
      } else {
        throw new Error(`Unknown orchestrator model: ${primaryModel}`);
      }
    } catch (error) {
      console.error(`❌ [Orchestrator] Generation failed:`, error);
      throw error;
    }
  }

  /**
   * Generate workflow using GPT-4o Mini with optional fallback
   */
  private async generateWithGPT4oMini(
    supabase: SupabaseClient,
    userId: string,
    agentId: string,
    userGoal: string,
    availablePlugins: string[],
    fallbackModel?: string
  ): Promise<WorkflowGenerationResult> {
    const startTime = Date.now();

    try {
      console.log(`🚀 [Orchestrator] Generating with GPT-4o Mini...`);

      const systemPrompt = this.buildSystemPrompt(availablePlugins);
      const userPrompt = this.buildUserPrompt(userGoal);

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.3,
      });

      const generationTime = Date.now() - startTime;
      const usage = response.usage!;

      // Parse and validate response
      const result = JSON.parse(response.choices[0].message.content!);
      const pilotSteps = result.pilot_steps || result.workflow_steps || [];

      // Validate workflow structure
      const validationResult = this.validateWorkflow(pilotSteps);

      if (!validationResult.valid && fallbackModel) {
        console.warn(`⚠️ [Orchestrator] GPT-4o Mini validation failed: ${validationResult.error}`);
        console.log(`🔄 [Orchestrator] Falling back to ${fallbackModel}...`);

        // Log fallback event
        await this.auditTrail.log({
          action: AUDIT_EVENTS.WORKFLOW_GENERATION_FALLBACK,
          entityType: 'agent',
          entityId: agentId,
          userId,
          resourceName: 'Workflow Generation',
          details: {
            primary_model: 'gpt-4o-mini',
            fallback_model: fallbackModel,
            reason: validationResult.error,
            tokens_wasted: usage.total_tokens,
          },
          severity: 'warning',
        });

        // Fallback to Claude Sonnet 4
        return await this.generateWithClaudeSonnet(
          supabase,
          userId,
          agentId,
          userGoal,
          availablePlugins,
          validationResult.error
        );
      }

      if (!validationResult.valid) {
        throw new Error(`Workflow validation failed: ${validationResult.error}`);
      }

      // Calculate cost (GPT-4o Mini pricing)
      const costUsd =
        (usage.prompt_tokens / 1_000_000) * 0.15 + // $0.15 per 1M input tokens
        (usage.completion_tokens / 1_000_000) * 0.60; // $0.60 per 1M output tokens

      // Log successful generation
      await this.auditTrail.log({
        action: AUDIT_EVENTS.WORKFLOW_GENERATED,
        entityType: 'agent',
        entityId: agentId,
        userId,
        resourceName: 'Workflow Generation',
        details: {
          generator: 'gpt-4o-mini',
          steps_generated: pilotSteps.length,
          tokens_used: usage.total_tokens,
          cost_usd: costUsd,
          generation_time_ms: generationTime,
        },
        severity: 'info',
      });

      return {
        pilot_steps: pilotSteps,
        generator_used: 'gpt-4o-mini',
        validation_passed: true,
        generation_time_ms: generationTime,
        tokens_used: {
          input: usage.prompt_tokens,
          output: usage.completion_tokens,
          total: usage.total_tokens,
        },
        cost_usd: costUsd,
      };
    } catch (error) {
      console.error(`❌ [Orchestrator] GPT-4o Mini generation failed:`, error);

      if (fallbackModel) {
        console.log(`🔄 [Orchestrator] Falling back to ${fallbackModel}...`);

        return await this.generateWithClaudeSonnet(
          supabase,
          userId,
          agentId,
          userGoal,
          availablePlugins,
          `GPT-4o Mini error: ${error.message}`
        );
      }

      throw error;
    }
  }

  /**
   * Generate workflow using Claude Sonnet 4
   */
  private async generateWithClaudeSonnet(
    supabase: SupabaseClient,
    userId: string,
    agentId: string,
    userGoal: string,
    availablePlugins: string[],
    fallbackReason?: string
  ): Promise<WorkflowGenerationResult> {
    const startTime = Date.now();

    console.log(`🚀 [Orchestrator] Generating with Claude Sonnet 4...`);

    const systemPrompt = this.buildSystemPrompt(availablePlugins);
    const userPrompt = this.buildUserPrompt(userGoal);

    const response = await this.anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      temperature: 0.3,
      system: systemPrompt,
      messages: [
        { role: 'user', content: userPrompt },
      ],
    });

    const generationTime = Date.now() - startTime;
    const usage = response.usage;

    // Parse response
    const textContent = response.content.find(c => c.type === 'text')?.text || '';
    const result = JSON.parse(textContent);
    const pilotSteps = result.pilot_steps || result.workflow_steps || [];

    // Validate workflow structure
    const validationResult = this.validateWorkflow(pilotSteps);

    if (!validationResult.valid) {
      throw new Error(`Workflow validation failed: ${validationResult.error}`);
    }

    // Calculate cost (Claude Sonnet 4 pricing)
    const costUsd =
      (usage.input_tokens / 1_000_000) * 3.0 + // $3 per 1M input tokens
      (usage.output_tokens / 1_000_000) * 15.0; // $15 per 1M output tokens

    // Log successful generation
    await this.auditTrail.log({
      action: AUDIT_EVENTS.WORKFLOW_GENERATED,
      entityType: 'agent',
      entityId: agentId,
      userId,
      resourceName: 'Workflow Generation',
      details: {
        generator: 'claude-sonnet-4',
        steps_generated: pilotSteps.length,
        tokens_used: usage.input_tokens + usage.output_tokens,
        cost_usd: costUsd,
        generation_time_ms: generationTime,
        fallback_reason: fallbackReason,
      },
      severity: 'info',
    });

    return {
      pilot_steps: pilotSteps,
      generator_used: 'claude-sonnet-4',
      validation_passed: true,
      generation_time_ms: generationTime,
      tokens_used: {
        input: usage.input_tokens,
        output: usage.output_tokens,
        total: usage.input_tokens + usage.output_tokens,
      },
      cost_usd: costUsd,
      fallback_reason,
    };
  }

  /**
   * Build system prompt for workflow generation
   */
  private buildSystemPrompt(availablePlugins: string[]): string {
    return `You are an intelligent workflow orchestrator. Your job is to analyze a user's goal and generate a multi-step Pilot workflow.

# Available Plugins:
${availablePlugins.join(', ') || 'None'}

# Workflow Step Types:
1. **llm_decision**: AI reasoning and decision-making
2. **transform**: Data manipulation and formatting
3. **conditional**: Branching logic (if/else)
4. **api_call**: External API integration

# Output Format (JSON):
{
  "pilot_steps": [
    {
      "id": "step_1",
      "operation": "Descriptive step name",
      "step_type": "llm_decision" | "transform" | "conditional" | "api_call",
      "inputs": { "field_name": "source_field" },
      "outputs": { "field_name": "destination_field" },
      "required_tools": ["plugin_name"]
    }
  ]
}

# Requirements:
1. Generate 3-15 steps for most workflows
2. Map inputs/outputs between steps clearly
3. Only use plugins that are explicitly needed
4. Validate all steps have required fields
5. Return valid JSON only`;
  }

  /**
   * Build user prompt
   */
  private buildUserPrompt(userGoal: string): string {
    return `Generate a Pilot workflow for this goal:

${userGoal}

Return a complete workflow with well-defined steps, input/output mappings, and tool requirements.`;
  }

  /**
   * Validate workflow structure
   */
  private validateWorkflow(steps: any[]): { valid: boolean; error?: string } {
    if (!Array.isArray(steps)) {
      return { valid: false, error: 'pilot_steps must be an array' };
    }

    if (steps.length === 0) {
      return { valid: false, error: 'Workflow must have at least one step' };
    }

    if (steps.length > 50) {
      return { valid: false, error: 'Workflow has too many steps (max 50)' };
    }

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      if (!step.id || typeof step.id !== 'string') {
        return { valid: false, error: `Step ${i}: Missing or invalid id` };
      }

      if (!step.operation || typeof step.operation !== 'string') {
        return { valid: false, error: `Step ${i}: Missing or invalid operation` };
      }

      if (!step.step_type || !['llm_decision', 'transform', 'conditional', 'api_call'].includes(step.step_type)) {
        return { valid: false, error: `Step ${i}: Invalid step_type: ${step.step_type}` };
      }
    }

    return { valid: true };
  }
}
