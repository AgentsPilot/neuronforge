/**
 * V4 Step Plan Extractor (OpenAI Stage 1)
 *
 * LLM outputs a SIMPLE, TEXT-BASED step plan.
 * NOT JSON. NOT DSL. Just plain numbered steps.
 *
 * Example output:
 * 1. Fetch emails using gmail.fetch_recent_emails(limit=10)
 * 2. Summarize the emails using ai_processing
 * 3. Create a HubSpot contact using hubspot.contacts.create()
 * 4. Send an email using gmail.send_email()
 *
 * No JSON. No transforms. No loops. No nested structures.
 * Just a clean, simple list that humans can read.
 */

import { IPluginContext } from '@/lib/types/plugin-definition-context';
import { AnthropicProvider, ANTHROPIC_MODELS } from '@/lib/ai/providers/anthropicProvider';
import { buildPluginContextForLLM } from '../utils/plugin-helpers';
import { createLogger } from '@/lib/logger';
import { PromptLoader } from '@/app/api/types/PromptLoader';

const logger = createLogger({ module: 'AgentKit', service: 'StepPlanExtractor' });

// Prompt template file names
const STEP_PLAN_SYSTEM_PROMPT_TEMPLATE = 'Step-Plan-Executer-SystemPrompt-v1';
const STEP_PLAN_USER_PROMPT_TEMPLATE = 'Step-Plan-Executer-UserPrompt-v1';

export interface StepPlanLine {
  stepNumber: number;
  description: string;
  suggestedPlugin?: string;
  suggestedAction?: string;
  rawLine: string;
  // New fields for conditional/loop support
  indentLevel: number;
  controlFlowKeyword?: 'if' | 'otherwise' | 'for_each' | 'loop';
  isCondition?: boolean;
  isLoop?: boolean;
  // Control-flow markers (e.g., "Otherwise:") that aren't real steps
  isControlMarker?: boolean;
  // Original step ID from technical workflow for debugging/traceability
  stepId?: string;
}

export interface StepPlan {
  goal: string; // Kept for backward compatibility (will be set to agentName)
  agentName: string;
  description: string;
  steps: StepPlanLine[];
  rawOutput: string;
  // Token metrics from LLM call
  tokensUsed?: {
    input: number;
    output: number;
    total: number;
  };
  cost?: number;
  // Resolved inputs from enhanced prompt (e.g., slack_channel, google_sheet_id)
  resolvedInputs?: Record<string, string>;
  // Validation warnings from conversion (semantic loss detection)
  validationWarnings?: string[];
}

export interface StepPlanExtractorOptions {
  connectedPlugins: IPluginContext[];
  userId?: string;
  anthropicApiKey: string;
  aiAnalytics?: any;
}

export class StepPlanExtractor {
  private connectedPlugins: IPluginContext[];
  private anthropicProvider: AnthropicProvider;
  private userId?: string;

  constructor(options: StepPlanExtractorOptions) {
    this.connectedPlugins = options.connectedPlugins;
    this.userId = options.userId;
    this.anthropicProvider = new AnthropicProvider(
      options.anthropicApiKey,
      options.aiAnalytics
    );
  }

  /**
   * Extract simple text-based step plan from enhanced prompt
   * Stage 1: LLM outputs plain text list with conditional/loop support
   */
  async extractStepPlan(enhancedPrompt: string): Promise<StepPlan> {
    // Validate input
    if (!enhancedPrompt || enhancedPrompt.trim().length === 0) {
      throw new Error('Enhanced prompt is empty or invalid');
    }

    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildUserPrompt(enhancedPrompt);

    logger.info('Calling Claude Sonnet for step plan extraction');

    let response;
    try {
      response = await this.anthropicProvider.chatCompletion(
        {
          model: ANTHROPIC_MODELS.CLAUDE_4_SONNET,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.1,
          max_tokens: 2000,
        },
        {
          userId: this.userId || 'system',
          feature: 'step_plan_extraction',
          component: 'v4-step-plan-extractor',
          workflow_step: 'extract_step_plan',
        }
      );
    } catch (error: any) {
      logger.error({ err: error }, 'LLM API call failed');
      throw new Error(`Failed to call Claude API: ${error.message || 'Unknown error'}`);
    }

    const content = response.choices[0]?.message?.content;
    if (!content || content.trim().length === 0) {
      throw new Error('Empty response from LLM step plan extraction');
    }

    logger.debug({ rawOutput: content }, 'Raw Claude output received');

    // Capture token metrics from response
    const tokensUsed = {
      input: response.usage?.prompt_tokens || 0,
      output: response.usage?.completion_tokens || 0,
      total: response.usage?.total_tokens || 0,
    };

    const cost = (response as any)._cost || 0;

    logger.info({ tokensUsed, cost }, 'LLM call completed');

    try {
      const stepPlan = this.parseStepPlan(content);

      // Add token metrics to step plan
      stepPlan.tokensUsed = tokensUsed;
      stepPlan.cost = cost;

      // Extract resolved inputs from enhanced prompt
      stepPlan.resolvedInputs = this.extractResolvedInputs(enhancedPrompt);

      return stepPlan;
    } catch (error: any) {
      logger.error({ err: error, rawOutputPreview: content.substring(0, 200) }, 'Failed to parse LLM output');
      throw new Error(`Failed to parse step plan: ${error.message}. Raw output: ${content.substring(0, 200)}...`);
    }
  }

  /**
   * Build system prompt for LLM using PromptLoader
   */
  private buildSystemPrompt(): string {
    const pluginContext = buildPluginContextForLLM(this.connectedPlugins);

    const promptLoader = new PromptLoader(STEP_PLAN_SYSTEM_PROMPT_TEMPLATE);
    return promptLoader.replaceKeywords({ pluginContext });
  }

  /**
   * Build user prompt with enhanced prompt content using PromptLoader
   */
  private buildUserPrompt(enhancedPrompt: string): string {
    const promptLoader = new PromptLoader(STEP_PLAN_USER_PROMPT_TEMPLATE);
    return promptLoader.replaceKeywords({ enhancedPrompt });
  }

  /**
   * Parse LLM output into structured StepPlan with conditional/loop detection
   */
  private parseStepPlan(rawOutput: string): StepPlan {
    // DEBUG: Log first 500 chars of raw output to verify indentation is present
    logger.debug({ rawOutputPreview: rawOutput.substring(0, 500) }, 'Parsing step plan - raw output preview');

    const lines = rawOutput.trim().split('\n');
    const steps: StepPlanLine[] = [];
    let agentName = '';
    let agentDescription = '';

    for (const line of lines) {
      if (!line || line.trim() === '') continue;

      const trimmed = line.trim();

      // Match numbered steps: "1. " or "1) "
      const stepMatch = trimmed.match(/^(\d+)[\.)]\s+(.+)$/);

      if (stepMatch) {
        const stepNumber = parseInt(stepMatch[1], 10);
        let description = stepMatch[2];

        // Calculate indentation level by counting LEADING spaces from the original line
        // The LLM puts spaces BEFORE the step number, not after the period
        // Example: "1. Read contacts" → 0 leading spaces → indent 0
        // Example: "  3. Look up contact" → 2 leading spaces → indent 1
        // Example: "    5. If contact exists" → 4 leading spaces → indent 2
        const leadingSpaces = line.length - trimmed.length;
        const indentLevel = Math.floor(leadingSpaces / 2); // 2 spaces per indent

        // DEBUG: Log indentation calculation for first 10 steps
        if (stepNumber <= 10) {
          logger.debug({
            stepNumber,
            originalLine: line,
            leadingSpaces,
            indentLevel,
            descriptionPreview: description.substring(0, 50),
          }, 'Step indentation parsed');
        }

        // Detect control flow keywords
        let controlFlowKeyword: 'if' | 'otherwise' | 'for_each' | 'loop' | undefined;
        let isCondition = false;
        let isLoop = false;

        const lowerDesc = description.toLowerCase();

        // Check for "If [condition]:"
        if (lowerDesc.startsWith('if ') && description.endsWith(':')) {
          controlFlowKeyword = 'if';
          isCondition = true;
          // Remove the colon from description
          description = description.slice(0, -1);
        }
        // Check for "Otherwise:"
        else if (lowerDesc === 'otherwise:') {
          controlFlowKeyword = 'otherwise';
          isCondition = true;
          description = 'Otherwise';
        }
        // Check for "For each [item]:"
        else if (lowerDesc.startsWith('for each ') && description.endsWith(':')) {
          controlFlowKeyword = 'for_each';
          isLoop = true;
          // Remove the colon from description
          description = description.slice(0, -1);
        }

        // Try to extract plugin.action if mentioned
        const actionMatch = description.match(/using\s+([a-z0-9_-]+)\.([a-z0-9_]+)/i);
        let suggestedPlugin: string | undefined;
        let suggestedAction: string | undefined;

        if (actionMatch) {
          suggestedPlugin = actionMatch[1];
          suggestedAction = actionMatch[2];
        } else {
          // Try simpler format: "using service_name" or "using ai_processing"
          const serviceMatch = description.match(/using\s+([a-z0-9_-]+)/i);
          if (serviceMatch) {
            const service = serviceMatch[1];
            if (service === 'ai_processing') {
              suggestedPlugin = 'ai_processing';
            } else {
              suggestedPlugin = service;
            }
          }
        }

        steps.push({
          stepNumber,
          description,
          suggestedPlugin,
          suggestedAction,
          rawLine: line, // Keep original line with indentation
          indentLevel,
          controlFlowKeyword,
          isCondition,
          isLoop,
        });
      } else if (steps.length === 0) {
        // Before steps start, look for Name: and Description: lines
        if (trimmed.startsWith('Name:')) {
          agentName = trimmed.substring(5).trim();
        } else if (trimmed.startsWith('Description:')) {
          agentDescription = trimmed.substring(12).trim();
        }
      }
    }

    if (steps.length === 0) {
      throw new Error('No valid steps found in LLM output');
    }

    // Use defaults if LLM didn't provide name/description
    if (!agentName) {
      agentName = 'Workflow Agent';
      logger.warn('No agent name found in LLM output, using default');
    }
    if (!agentDescription) {
      agentDescription = 'Executes a workflow to automate tasks';
      logger.warn('No agent description found in LLM output, using default');
    }

    logger.info({
      agentName,
      descriptionLength: agentDescription.length,
    }, 'Agent metadata parsed');

    logger.debug({
      steps: steps.map(s => ({
        stepNum: s.stepNumber,
        indent: s.indentLevel,
        keyword: s.controlFlowKeyword,
        desc: s.description.substring(0, 50),
      })),
    }, 'Steps parsed with control flow');

    return {
      goal: agentName, // For backward compatibility
      agentName,
      description: agentDescription,
      steps,
      rawOutput,
    };
  }

  /**
   * Extract resolved user inputs from enhanced prompt
   * Enhanced prompt format: { "specifics": { "resolved_user_inputs": [{ "key": "...", "value": "..." }] } }
   */
  private extractResolvedInputs(enhancedPrompt: string): Record<string, string> {
    const resolvedInputs: Record<string, string> = {};

    try {
      // Try to parse as JSON
      const promptJson = JSON.parse(enhancedPrompt);

      // Extract from specifics.resolved_user_inputs array
      const resolved = promptJson?.specifics?.resolved_user_inputs;
      if (Array.isArray(resolved)) {
        for (const item of resolved) {
          if (item.key && item.value) {
            resolvedInputs[item.key] = item.value;
          }
        }
      }

      logger.debug({ resolvedInputs }, 'Extracted resolved inputs from enhanced prompt');
    } catch (error) {
      // Not JSON format, ignore
      logger.debug('Enhanced prompt is not JSON, skipping resolved inputs extraction');
    }

    return resolvedInputs;
  }
}
