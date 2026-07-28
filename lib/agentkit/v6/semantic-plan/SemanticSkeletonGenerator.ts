/**
 * Semantic Skeleton Generator
 *
 * Generates a semantic skeleton (business logic flow) from an Enhanced Prompt.
 * This is LLM #1 in the 2-stage approach: Structure → Details.
 *
 * Uses ProviderFactory for centralized token tracking.
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import type { SemanticSkeleton } from './types/semantic-skeleton-types'
import type { EnhancedPrompt } from './SemanticPlanGenerator'
import { createLogger, Logger } from '@/lib/logger'
import { ProviderFactory, PROVIDERS } from '@/lib/ai/providerFactory'
import { ANTHROPIC_MODELS } from '@/lib/ai/providers/anthropicProvider'
import type { CallContext } from '@/lib/ai/providers/baseProvider'

const moduleLogger = createLogger({ module: 'V6', service: 'SemanticSkeletonGenerator' })

export interface SemanticSkeletonGeneratorConfig {
  model?: string
  temperature?: number
  max_tokens?: number
  systemPrompt?: string // Optional: provide custom system prompt
}

export class SemanticSkeletonGenerator {
  private config: {
    model: string
    temperature: number
    max_tokens: number
  }
  private systemPrompt: string
  private logger: Logger

  constructor(config: SemanticSkeletonGeneratorConfig = {}) {
    this.logger = moduleLogger.child({ method: 'constructor' })

    this.config = {
      model: config.model || ANTHROPIC_MODELS.SONNET_4_5,
      temperature: config.temperature ?? 0.0, // Deterministic for structure generation
      max_tokens: config.max_tokens ?? 4000,
    }

    // ProviderFactory handles API key validation and client initialization

    // Load system prompt
    if (config.systemPrompt) {
      this.systemPrompt = config.systemPrompt
    } else {
      const promptPath = join(
        process.cwd(),
        'lib',
        'agentkit',
        'v6',
        'semantic-plan',
        'prompts',
        'semantic-skeleton-system.md'
      )
      this.systemPrompt = readFileSync(promptPath, 'utf-8')
    }

    this.logger.info({
      model: this.config.model,
      systemPromptLength: this.systemPrompt.length,
    }, 'Initialized')
  }

  /**
   * Generate semantic skeleton from Enhanced Prompt
   *
   * Calls LLM to analyze Enhanced Prompt and generate a simplified
   * business logic skeleton (structure only, no implementation details).
   * Uses ProviderFactory for centralized token tracking.
   *
   * @param enhancedPrompt - Enhanced Prompt with structured sections
   * @returns Semantic skeleton with goal, unit_of_work, and flow
   */
  async generate(enhancedPrompt: EnhancedPrompt): Promise<SemanticSkeleton> {
    const generateLogger = this.logger.child({ method: 'generate' })
    const startTime = Date.now()

    generateLogger.info('Generating semantic skeleton from Enhanced Prompt')

    // Build user message with Enhanced Prompt
    const userMessage = this.buildUserMessage(enhancedPrompt)

    generateLogger.debug({
      userMessageLength: userMessage.length,
      enhancedPromptSections: Object.keys(enhancedPrompt.sections || {}),
    }, 'Calling LLM for skeleton generation via ProviderFactory')

    // Get provider from factory for centralized token tracking
    const provider = ProviderFactory.getProvider(PROVIDERS.ANTHROPIC)
    const context: CallContext = {
      userId: 'system',
      feature: 'v6_pipeline',
      component: 'SemanticSkeletonGenerator',
      category: 'agent_generation',
      activity_type: 'semantic_skeleton_generation',
      activity_name: 'generate_semantic_skeleton',
    }

    // Call Anthropic API via ProviderFactory (returns OpenAI-compatible format)
    const response = await provider.chatCompletion({
      model: this.config.model,
      max_tokens: this.config.max_tokens,
      temperature: this.config.temperature,
      messages: [
        { role: 'system', content: this.systemPrompt },
        { role: 'user', content: userMessage },
      ],
    }, context)

    // Extract text response (ProviderFactory returns OpenAI-compatible format)
    const responseText = response.choices?.[0]?.message?.content
    if (!responseText) {
      generateLogger.error('LLM response does not contain text')
      throw new Error('Invalid LLM response: no text content')
    }

    generateLogger.debug({
      responseLength: responseText.length,
      responsePreview: responseText.substring(0, 200),
    }, 'Received LLM response')

    // Parse JSON response
    const skeleton = this.parseSkeletonFromResponse(responseText)

    const endTime = Date.now()

    // ProviderFactory uses OpenAI-compatible usage format
    const tokensUsed = (response.usage?.prompt_tokens || 0) + (response.usage?.completion_tokens || 0)
    generateLogger.info({
      latencyMs: endTime - startTime,
      goal: skeleton.goal,
      unitOfWork: skeleton.unit_of_work,
      flowLength: skeleton.flow.length,
      tokensUsed,
    }, 'Semantic skeleton generated successfully')

    return skeleton
  }

  /**
   * Build user message for LLM
   *
   * Formats Enhanced Prompt into user message for skeleton generation.
   */
  private buildUserMessage(enhancedPrompt: EnhancedPrompt): string {
    const sections = enhancedPrompt.sections
    const specifics = (enhancedPrompt as any).specifics || {}

    let message = '# Enhanced Prompt\n\n'
    message += '## Data Requirements\n\n'
    message += (sections?.data || []).map(item => item).join('\n') + '\n\n'

    message += '## Actions to Perform\n\n'
    message += (sections?.actions || []).map(item => item).join('\n') + '\n\n'

    message += '## Output Requirements\n\n'
    message += (sections?.output || []).map(item => item).join('\n') + '\n\n'

    message += '## Delivery Requirements\n\n'
    message += (sections?.delivery || []).map(item => item).join('\n') + '\n\n'

    if (sections?.processing_steps && sections.processing_steps.length > 0) {
      message += '## Processing Steps\n\n'
      message += sections.processing_steps.map(item => item).join('\n') + '\n\n'
    }

    if (specifics.resolved_user_inputs && specifics.resolved_user_inputs.length > 0) {
      message += '## Resolved User Inputs\n\n'
      message += specifics.resolved_user_inputs
        .map((input: any) => `- ${input.key}: ${input.value}`)
        .join('\n') + '\n\n'
    }

    message += '---\n\n'
    message += 'Generate a semantic skeleton for this workflow. Output ONLY the JSON skeleton, no markdown formatting.\n'

    return message
  }

  /**
   * Parse skeleton from LLM response
   *
   * Handles various response formats:
   * - Raw JSON
   * - JSON wrapped in markdown code blocks
   * - JSON with extra whitespace
   */
  private parseSkeletonFromResponse(responseText: string): SemanticSkeleton {
    const parseLogger = this.logger.child({ method: 'parseSkeletonFromResponse' })

    let jsonText = responseText.trim()

    // Remove markdown code blocks if present
    if (jsonText.startsWith('```')) {
      const match = jsonText.match(/```(?:json)?\s*\n([\s\S]*?)\n```/)
      if (match) {
        jsonText = match[1].trim()
      } else {
        // Try to extract JSON between first { and last }
        const startIdx = jsonText.indexOf('{')
        const endIdx = jsonText.lastIndexOf('}')
        if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
          jsonText = jsonText.substring(startIdx, endIdx + 1)
        }
      }
    }

    // Parse JSON
    let skeleton: SemanticSkeleton
    try {
      skeleton = JSON.parse(jsonText)
    } catch (error) {
      parseLogger.error({
        error: (error as Error).message,
        responsePreview: jsonText.substring(0, 500),
      }, 'Failed to parse skeleton JSON')
      throw new Error(`Failed to parse skeleton JSON: ${(error as Error).message}`)
    }

    // Basic validation
    if (!skeleton.goal || !skeleton.unit_of_work || !skeleton.flow) {
      parseLogger.error({
        hasGoal: !!skeleton.goal,
        hasUnitOfWork: !!skeleton.unit_of_work,
        hasFlow: !!skeleton.flow,
      }, 'Skeleton missing required fields')
      throw new Error('Skeleton missing required fields: goal, unit_of_work, or flow')
    }

    parseLogger.debug({
      goal: skeleton.goal,
      unitOfWork: skeleton.unit_of_work,
      flowLength: skeleton.flow.length,
    }, 'Skeleton parsed successfully')

    return skeleton
  }
}
