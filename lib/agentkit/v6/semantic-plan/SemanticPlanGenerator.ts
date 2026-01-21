/**
 * Semantic Plan Generator
 *
 * Generates a Semantic Plan from an Enhanced Prompt.
 * This is the UNDERSTANDING phase - the LLM reasons about user intent
 * WITHOUT being forced to produce precise, executable IR.
 *
 * Architecture:
 *   Enhanced Prompt → [THIS] → Semantic Plan
 *                                  ↓
 *                         [Grounding Engine]
 *                                  ↓
 *                      [Formalization] → IR
 */

import { OpenAI } from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { readFileSync } from 'fs'
import { join } from 'path'
import type {
  SemanticPlan,
  SemanticPlanGenerationResult
} from './schemas/semantic-plan-types'
import { SEMANTIC_PLAN_SCHEMA, SEMANTIC_PLAN_SCHEMA_STRICT } from './schemas/semantic-plan-schema'
import Ajv, { Ajv as AjvInstance } from 'ajv'
import { createLogger, Logger } from '@/lib/logger'

// Create module-scoped logger
const moduleLogger = createLogger({ module: 'V6', service: 'SemanticPlanGenerator' })

// ============================================================================
// Types
// ============================================================================

export interface EnhancedPrompt {
  sections: {
    data: string[]
    actions?: string[]
    output?: string[]
    delivery: string[]
    processing_steps?: string[]
  }
  user_context?: {
    original_request: string
    clarifications?: Record<string, string>
  }
  // Production format includes specifics with key resolved inputs like filter rules
  specifics?: {
    services_involved?: string[]
    user_inputs_required?: any[]
    resolved_user_inputs?: Array<{
      key: string
      value: any
    }>
  }
}

export interface SemanticPlanConfig {
  model_provider: 'openai' | 'anthropic'
  model_name?: string
  temperature?: number
  max_tokens?: number
}

// ============================================================================
// Semantic Plan Generator
// ============================================================================

export class SemanticPlanGenerator {
  private openai?: OpenAI
  private anthropic?: Anthropic
  private config: SemanticPlanConfig
  private systemPrompt: string
  private ajv: AjvInstance
  private validateSchema: any
  private logger: Logger

  constructor(config: SemanticPlanConfig) {
    this.logger = moduleLogger.child({ method: 'constructor' })
    this.logger.info({ provider: config.model_provider, model: config.model_name }, 'Initializing')

    this.config = {
      temperature: 0.3, // Higher than IR generation - we want reasoning, not just precision
      max_tokens: 6000, // More tokens for reasoning traces
      ...config
    }

    // Initialize LLM clients
    if (config.model_provider === 'openai') {
      this.openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY
      })
    } else if (config.model_provider === 'anthropic') {
      this.anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY
      })
    }

    // Load system prompt
    this.systemPrompt = this.loadSystemPrompt()
    this.logger.debug({ promptLength: this.systemPrompt.length }, 'System prompt loaded')

    // Initialize validator using strict schema to match OpenAI generation
    this.ajv = new Ajv({ allErrors: true })
    this.validateSchema = this.ajv.compile(SEMANTIC_PLAN_SCHEMA_STRICT)
  }

  /**
   * Load system prompt from markdown file
   * Use SEMANTIC_PLAN_PROMPT_VERSION env var to switch between versions:
   * - 'condensed' (default): ~6KB optimized prompt
   * - 'full': ~28KB full prompt with examples
   */
  private loadSystemPrompt(): string {
    try {
      const promptVersion = process.env.SEMANTIC_PLAN_PROMPT_VERSION || 'condensed'
      const promptFileName = promptVersion === 'full'
        ? 'semantic-plan-system-full.md'
        : 'semantic-plan-system.md'

      const promptPath = join(
        process.cwd(),
        'lib',
        'agentkit',
        'v6',
        'semantic-plan',
        'prompts',
        promptFileName
      )
      const prompt = readFileSync(promptPath, 'utf-8')
      this.logger.debug({ promptVersion, promptPath }, 'Loaded system prompt')
      return prompt
    } catch (error) {
      this.logger.error({ err: error }, 'Failed to load system prompt')
      throw new Error('Semantic plan system prompt is required but could not be loaded')
    }
  }

  /**
   * Generate semantic plan from enhanced prompt
   */
  async generate(enhancedPrompt: EnhancedPrompt): Promise<SemanticPlanGenerationResult> {
    const generateLogger = moduleLogger.child({ method: 'generate' })
    const sections = Object.keys(enhancedPrompt.sections)
    generateLogger.info({ sections }, 'Starting semantic plan generation')

    const startTime = Date.now()

    try {
      // Call LLM in understanding mode
      const llmResponse = await this.callLLM(enhancedPrompt)

      if (!llmResponse.success || !llmResponse.semantic_plan) {
        const duration = Date.now() - startTime
        generateLogger.warn({ duration, errors: llmResponse.errors }, 'LLM generation failed')
        return {
          success: false,
          errors: llmResponse.errors || ['Failed to generate semantic plan from LLM'],
          metadata: {
            model: this.getModelName(),
            tokens_used: llmResponse.tokens_used || 0,
            generation_time_ms: duration
          }
        }
      }

      const semanticPlan = llmResponse.semantic_plan

      // Validate structure (permissive validation)
      generateLogger.debug('Validating semantic plan structure')
      const validation = this.validateSemanticPlan(semanticPlan)

      if (!validation.valid) {
        const duration = Date.now() - startTime
        generateLogger.warn({ duration, validationErrors: validation.errors }, 'Semantic plan has structural issues')
        // Don't fail - just warn. Semantic plans are allowed to be imperfect.
        return {
          success: true,
          semantic_plan: semanticPlan,
          warnings: validation.errors.map(e => e.message),
          metadata: {
            model: this.getModelName(),
            tokens_used: llmResponse.tokens_used || 0,
            generation_time_ms: duration
          }
        }
      }

      const duration = Date.now() - startTime
      generateLogger.info({
        duration,
        assumptionsCount: semanticPlan.assumptions?.length || 0,
        ambiguitiesCount: semanticPlan.ambiguities?.length || 0,
        inferencesCount: semanticPlan.inferences?.length || 0,
        tokensUsed: llmResponse.tokens_used
      }, 'Semantic plan generated successfully')

      return {
        success: true,
        semantic_plan: semanticPlan,
        metadata: {
          model: this.getModelName(),
          tokens_used: llmResponse.tokens_used || 0,
          generation_time_ms: duration
        }
      }
    } catch (error) {
      const duration = Date.now() - startTime
      generateLogger.error({ err: error, duration }, 'Generation failed')

      return {
        success: false,
        errors: [error instanceof Error ? error.message : 'Unknown error'],
        metadata: {
          model: this.getModelName(),
          tokens_used: 0,
          generation_time_ms: duration
        }
      }
    }
  }

  /**
   * Call LLM to generate semantic plan
   */
  private async callLLM(enhancedPrompt: EnhancedPrompt): Promise<{
    success: boolean
    semantic_plan?: SemanticPlan
    errors?: string[]
    tokens_used?: number
  }> {
    if (this.config.model_provider === 'openai') {
      return this.callOpenAI(enhancedPrompt)
    } else if (this.config.model_provider === 'anthropic') {
      return this.callAnthropic(enhancedPrompt)
    }

    return {
      success: false,
      errors: ['No model provider configured']
    }
  }

  /**
   * Call LLM with timeout protection
   * Returns AbortController to allow cleanup
   */
  private async callWithTimeout<T>(
    apiCall: Promise<T>,
    timeoutMs: number
  ): Promise<T> {
    let timeoutId: NodeJS.Timeout | null = null

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`Request timeout after ${timeoutMs}ms`))
      }, timeoutMs)
    })

    try {
      const result = await Promise.race([apiCall, timeoutPromise])
      if (timeoutId) clearTimeout(timeoutId)
      return result
    } catch (error) {
      if (timeoutId) clearTimeout(timeoutId)
      throw error
    }
  }

  /**
   * Call OpenAI API with retry logic and timeout protection
   */
  private async callOpenAI(enhancedPrompt: EnhancedPrompt): Promise<{
    success: boolean
    semantic_plan?: SemanticPlan
    errors?: string[]
    tokens_used?: number
  }> {
    const openaiLogger = moduleLogger.child({ method: 'callOpenAI', model: this.getModelName() })

    if (!this.openai) {
      openaiLogger.error('OpenAI client not initialized')
      return { success: false, errors: ['OpenAI client not initialized'] }
    }

    const maxAttempts = 2
    let lastError: string | undefined
    let totalTokens = 0

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const attemptStartTime = Date.now()
      try {
        openaiLogger.info({ attempt, maxAttempts }, 'Calling OpenAI API')

        const userMessage = this.buildUserMessage(enhancedPrompt)

        // Add retry context to user message if this is a retry
        const finalUserMessage = attempt > 1 && lastError
          ? `${userMessage}\n\n---\n\nPREVIOUS ATTEMPT FAILED:\n${lastError}\n\nPlease fix these issues in your response.`
          : userMessage

        // Use OpenAI strict schema mode to guarantee structure compliance
        // This eliminates first-attempt validation failures by enforcing schema at generation time
        const apiCall = this.openai.chat.completions.create({
          model: this.getModelName(),
          messages: [
            { role: 'system', content: this.systemPrompt },
            { role: 'user', content: finalUserMessage }
          ],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'semantic_plan',
              strict: true,
              schema: SEMANTIC_PLAN_SCHEMA_STRICT
            }
          },
          temperature: this.config.temperature,
          max_completion_tokens: this.config.max_tokens
        })

        // Wrap with 180-second timeout (complex prompts with structured output need more time)
        const response = await this.callWithTimeout(apiCall, 180000)

        const content = response.choices[0]?.message?.content
        totalTokens += response.usage?.total_tokens || 0

        if (!content) {
          lastError = 'Empty response from OpenAI'
          openaiLogger.warn({ attempt, error: lastError }, 'Attempt failed - empty response')
          continue
        }

        openaiLogger.debug({ responseLength: content.length }, 'Received LLM response')

        // Try to parse JSON
        let semanticPlan: SemanticPlan
        try {
          semanticPlan = JSON.parse(content) as SemanticPlan
        } catch (parseError) {
          lastError = `JSON parse error: ${parseError instanceof Error ? parseError.message : 'Invalid JSON'}`
          openaiLogger.warn({ attempt, error: lastError }, 'Attempt failed - JSON parse error')
          continue
        }

        // Validate basic structure
        const validation = this.validateSemanticPlan(semanticPlan)
        if (!validation.valid) {
          lastError = `Schema validation failed: ${validation.errors.map(e => e.message).join(', ')}`
          openaiLogger.warn({ attempt, validationErrors: validation.errors }, 'Attempt failed - validation error')

          // CRITICAL FIX: If validation failed after max attempts, return success: false
          // Previously returned success: true which masked validation failures
          if (attempt === maxAttempts) {
            openaiLogger.warn({ totalTokens }, 'Max attempts reached with validation errors')
            return {
              success: false,  // FIXED: Was incorrectly returning success: true
              semantic_plan: semanticPlan,  // Still include plan for debugging
              errors: validation.errors.map(e => e.message),
              tokens_used: totalTokens
            }
          }
          continue
        }

        const attemptDuration = Date.now() - attemptStartTime
        openaiLogger.info({
          attempt,
          duration: attemptDuration,
          planVersion: semanticPlan.plan_version,
          tokensUsed: totalTokens
        }, 'Attempt succeeded')

        return {
          success: true,
          semantic_plan: semanticPlan,
          tokens_used: totalTokens
        }
      } catch (error) {
        lastError = error instanceof Error ? error.message : 'Unknown OpenAI error'
        openaiLogger.error({ err: error, attempt }, 'Attempt threw error')

        // If this is the last attempt or a non-retryable error, fail immediately
        if (attempt === maxAttempts || lastError.includes('API key') || lastError.includes('rate limit')) {
          break
        }
      }
    }

    openaiLogger.error({ totalTokens, lastError }, 'All attempts failed')
    return {
      success: false,
      errors: [lastError || 'Failed to generate semantic plan after retries'],
      tokens_used: totalTokens
    }
  }

  /**
   * Call Anthropic API
   */
  private async callAnthropic(enhancedPrompt: EnhancedPrompt): Promise<{
    success: boolean
    semantic_plan?: SemanticPlan
    errors?: string[]
    tokens_used?: number
  }> {
    const anthropicLogger = moduleLogger.child({ method: 'callAnthropic', model: this.getModelName() })

    if (!this.anthropic) {
      anthropicLogger.error('Anthropic client not initialized')
      return { success: false, errors: ['Anthropic client not initialized'] }
    }

    const startTime = Date.now()

    try {
      anthropicLogger.info('Calling Anthropic API')

      const userMessage = this.buildUserMessage(enhancedPrompt)

      const apiCall = this.anthropic.messages.create({
        model: this.getModelName(),
        max_tokens: this.config.max_tokens || 6000,
        temperature: this.config.temperature,
        system: this.systemPrompt,
        messages: [
          { role: 'user', content: userMessage }
        ]
      })

      // Wrap with 30-second timeout
      const response = await this.callWithTimeout(apiCall, 30000)

      const content = response.content[0]
      if (content.type !== 'text') {
        anthropicLogger.warn('Unexpected response type from Anthropic')
        return { success: false, errors: ['Unexpected response type from Anthropic'] }
      }

      anthropicLogger.debug({ responseLength: content.text.length }, 'Received LLM response')

      // Extract JSON from response (Anthropic sometimes wraps it in markdown)
      let jsonText = content.text.trim()
      if (jsonText.startsWith('```json')) {
        jsonText = jsonText.replace(/^```json\n/, '').replace(/\n```$/, '')
      } else if (jsonText.startsWith('```')) {
        jsonText = jsonText.replace(/^```\n/, '').replace(/\n```$/, '')
      }

      // Parse JSON with error handling
      let semanticPlan: SemanticPlan
      try {
        semanticPlan = JSON.parse(jsonText) as SemanticPlan
      } catch (parseError) {
        const tokensUsed = response.usage.input_tokens + response.usage.output_tokens
        anthropicLogger.error({
          err: parseError,
          tokensUsed,
          responsePreview: jsonText.substring(0, 500)
        }, 'JSON parse error')
        return {
          success: false,
          errors: [`JSON parse error: ${parseError instanceof Error ? parseError.message : 'Invalid JSON'}`],
          tokens_used: tokensUsed
        }
      }

      const duration = Date.now() - startTime
      const tokensUsed = response.usage.input_tokens + response.usage.output_tokens
      anthropicLogger.info({
        duration,
        planVersion: semanticPlan.plan_version,
        tokensUsed
      }, 'Anthropic call succeeded')

      return {
        success: true,
        semantic_plan: semanticPlan,
        tokens_used: tokensUsed
      }
    } catch (error) {
      const duration = Date.now() - startTime
      anthropicLogger.error({ err: error, duration }, 'Anthropic call failed')
      return { success: false, errors: [error instanceof Error ? error.message : 'Unknown Anthropic error'] }
    }
  }

  /**
   * Build user message from enhanced prompt
   */
  private buildUserMessage(enhancedPrompt: EnhancedPrompt): string {
    const sections = enhancedPrompt.sections
    const context = enhancedPrompt.user_context
    const specifics = enhancedPrompt.specifics

    let message = '# Enhanced Prompt\n\n'

    if (context?.original_request) {
      message += `## Original User Request\n${context.original_request}\n\n`
    }

    message += `## Data Sources\n${sections.data.join('\n')}\n\n`

    if (sections.actions && sections.actions.length > 0) {
      message += `## Actions\n${sections.actions.join('\n')}\n\n`
    }

    if (sections.output && sections.output.length > 0) {
      message += `## Output Format\n${sections.output.join('\n')}\n\n`
    }

    message += `## Delivery\n${sections.delivery.join('\n')}\n\n`

    if (sections.processing_steps && sections.processing_steps.length > 0) {
      message += `## Processing Steps\n${sections.processing_steps.join('\n')}\n\n`
    }

    if (context?.clarifications) {
      message += `## Clarifications\n`
      for (const [question, answer] of Object.entries(context.clarifications)) {
        message += `- ${question}: ${answer}\n`
      }
      message += '\n'
    }

    // Include resolved user inputs - critical for filter rules, column names, etc.
    if (specifics?.resolved_user_inputs && specifics.resolved_user_inputs.length > 0) {
      message += '## Resolved User Inputs (USE THESE EXACT VALUES)\n'
      message += 'These are pre-validated values from the user. Use them exactly as specified:\n\n'
      specifics.resolved_user_inputs.forEach(input => {
        message += `- **${input.key}**: ${input.value}\n`
      })
      message += '\n'
      message += 'IMPORTANT: For filter conditions, use the exact field names and values from above.\n'
      message += 'Example: If "high_qualified_rule" = "Stage = 4", the filter field must be "Stage" and value must be "4".\n'
      message += '\n'
    }

    message += `---\n\n`
    message += `Generate a Semantic Plan that captures your understanding of this workflow.\n`
    message += `Remember: Focus on understanding, not formalization. Make assumptions explicit, express uncertainty, explain reasoning.`

    return message
  }

  /**
   * Validate semantic plan (permissive validation)
   */
  private validateSemanticPlan(semanticPlan: any): {
    valid: boolean
    errors: Array<{ path: string; message: string }>
  } {
    const schemaValid = this.validateSchema(semanticPlan)

    if (schemaValid) {
      return { valid: true, errors: [] }
    }

    const errors = (this.validateSchema.errors || []).map((err: any) => ({
      path: err.instancePath || '$',
      message: `${err.instancePath || '$'} ${err.message || 'invalid'}`
    }))

    return { valid: false, errors }
  }

  /**
   * Get model name
   */
  private getModelName(): string {
    if (this.config.model_name) {
      return this.config.model_name
    }

    if (this.config.model_provider === 'openai') {
      return 'gpt-5.2'
    }

    if (this.config.model_provider === 'anthropic') {
      return 'claude-sonnet-4-20250514'
    }

    return 'unknown'
  }
}
