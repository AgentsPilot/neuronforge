/**
 * Semantic Skeleton Generator
 *
 * Generates a semantic skeleton (business logic flow) from an Enhanced Prompt.
 * This is LLM #1 in the 2-stage approach: Structure → Details.
 */

import Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { SemanticSkeleton } from './types/semantic-skeleton-types'
import type { EnhancedPrompt } from './SemanticPlanGenerator'
import { createLogger, Logger } from '@/lib/logger'

const moduleLogger = createLogger({ module: 'V6', service: 'SemanticSkeletonGenerator' })

export interface SemanticSkeletonGeneratorConfig {
  model?: string
  temperature?: number
  max_tokens?: number
  anthropic_api_key?: string
  systemPrompt?: string // Optional: provide custom system prompt
}

export class SemanticSkeletonGenerator {
  private config: {
    model: string
    temperature: number
    max_tokens: number
    anthropic_api_key: string
  }
  private anthropic: Anthropic
  private systemPrompt: string
  private logger: Logger

  constructor(config: SemanticSkeletonGeneratorConfig = {}) {
    this.logger = moduleLogger.child({ method: 'constructor' })

    this.config = {
      model: config.model || 'claude-sonnet-4-5-20250929',
      temperature: config.temperature ?? 0.0, // Deterministic for structure generation
      max_tokens: config.max_tokens ?? 4000,
      anthropic_api_key: config.anthropic_api_key || process.env.ANTHROPIC_API_KEY || '',
    }

    if (!this.config.anthropic_api_key) {
      throw new Error('ANTHROPIC_API_KEY is required for SemanticSkeletonGenerator')
    }

    this.anthropic = new Anthropic({ apiKey: this.config.anthropic_api_key })

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
    }, 'Calling LLM for skeleton generation')

    // Call Anthropic API
    const response = await this.anthropic.messages.create({
      model: this.config.model,
      max_tokens: this.config.max_tokens,
      temperature: this.config.temperature,
      system: this.systemPrompt,
      messages: [
        {
          role: 'user',
          content: userMessage,
        },
      ],
    })

    // Extract text response
    const textContent = response.content.find(block => block.type === 'text')
    if (!textContent || textContent.type !== 'text') {
      generateLogger.error('LLM response does not contain text')
      throw new Error('Invalid LLM response: no text content')
    }

    const responseText = textContent.text

    generateLogger.debug({
      responseLength: responseText.length,
      responsePreview: responseText.substring(0, 200),
    }, 'Received LLM response')

    // Parse JSON response
    const skeleton = this.parseSkeletonFromResponse(responseText)

    const endTime = Date.now()

    generateLogger.info({
      latencyMs: endTime - startTime,
      goal: skeleton.goal,
      unitOfWork: skeleton.unit_of_work,
      flowLength: skeleton.flow.length,
      tokensUsed: response.usage.input_tokens + response.usage.output_tokens,
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
