/**
 * Enhanced Prompt to Declarative IR Generator
 *
 * This component uses an LLM to convert Enhanced Prompts into PURE Declarative IR.
 *
 * Key Differences from Extended IR Generator:
 * - Uses declarative-ir-system.md prompt (strict rules, no IDs, no loops)
 * - Outputs DeclarativeLogicalIR type (v3.0)
 * - Uses forbidden token validation
 * - No IR repair (if LLM leaks tokens, we reject immediately)
 *
 * Philosophy: LLM describes WHAT (intent), Compiler figures out HOW (execution)
 */

import { OpenAI } from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { validateDeclarativeIR } from '../logical-ir/validation/DeclarativeIRValidator'
import type { DeclarativeLogicalIR, IRValidationResult } from '../logical-ir/schemas/declarative-ir-types'
import { readFileSync } from 'fs'
import { join } from 'path'

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
}

export interface DeclarativeIRGenerationResult {
  success: boolean
  ir?: DeclarativeLogicalIR
  errors?: string[]
  warnings?: string[]
  validation?: IRValidationResult
  raw_response?: any
  metadata?: {
    model: string
    tokens_used: number
    generation_time_ms: number
    forbidden_tokens_found?: string[]
  }
}

export interface GeneratorConfig {
  model_provider: 'openai' | 'anthropic'
  model_name?: string
  temperature?: number
  max_tokens?: number
}

// ============================================================================
// Main Generator Class
// ============================================================================

export class EnhancedPromptToDeclarativeIRGenerator {
  private openai?: OpenAI
  private anthropic?: Anthropic
  private config: GeneratorConfig
  private systemPrompt: string

  constructor(config: GeneratorConfig) {
    console.log('[DeclarativeIRGenerator] Initializing with config:', config)
    this.config = {
      temperature: 0.1, // Low temperature for consistency
      max_tokens: 4000,
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

    // Load declarative system prompt
    this.systemPrompt = this.loadSystemPrompt()
    console.log('[DeclarativeIRGenerator] System prompt loaded, length:', this.systemPrompt.length)
  }

  /**
   * Load declarative system prompt from markdown file
   */
  private loadSystemPrompt(): string {
    try {
      // Use process.cwd() to get the project root in Next.js
      const promptPath = join(process.cwd(), 'lib', 'agentkit', 'v6', 'generation', 'prompts', 'declarative-ir-system.md')
      const prompt = readFileSync(promptPath, 'utf-8')
      console.log('[DeclarativeIRGenerator] Loaded declarative system prompt from:', promptPath)
      return prompt
    } catch (error) {
      console.error('[DeclarativeIRGenerator] Failed to load system prompt:', error)
      throw new Error('Declarative system prompt is required but could not be loaded')
    }
  }

  /**
   * Main generation method
   */
  async generate(enhancedPrompt: EnhancedPrompt): Promise<DeclarativeIRGenerationResult> {
    console.log('[DeclarativeIRGenerator] Starting IR generation...')
    console.log('[DeclarativeIRGenerator] Enhanced prompt sections:', Object.keys(enhancedPrompt.sections))

    const startTime = Date.now()

    try {
      // Step 1: Call LLM with enhanced prompt
      const llmResponse = await this.callLLM(enhancedPrompt)

      if (!llmResponse.success || !llmResponse.ir) {
        return {
          success: false,
          errors: llmResponse.errors || ['Failed to generate IR from LLM'],
          metadata: {
            model: this.getModelName(),
            tokens_used: llmResponse.tokens_used || 0,
            generation_time_ms: Date.now() - startTime
          }
        }
      }

      const ir = llmResponse.ir

      // Step 2: Validate declarative IR (forbidden token check + schema)
      console.log('[DeclarativeIRGenerator] Validating declarative IR...')
      console.log('[DeclarativeIRGenerator] IR to validate:', JSON.stringify(ir, null, 2))
      const validation = validateDeclarativeIR(ir)

      if (!validation.valid) {
        console.error('[DeclarativeIRGenerator] ✗ IR validation failed:', JSON.stringify(validation.errors, null, 2))

        // Extract forbidden tokens if any
        const forbiddenTokens = validation.errors
          .filter(e => e.error_code === 'FORBIDDEN_TOKEN')
          .map(e => e.leaked_token || '')
          .filter(Boolean)

        return {
          success: false,
          errors: validation.errors.map(e => e.message),
          validation,
          ir, // Return IR for debugging
          metadata: {
            model: this.getModelName(),
            tokens_used: llmResponse.tokens_used || 0,
            generation_time_ms: Date.now() - startTime,
            forbidden_tokens_found: forbiddenTokens
          }
        }
      }

      console.log('[DeclarativeIRGenerator] ✓ IR validation passed')

      // Success!
      return {
        success: true,
        ir,
        validation,
        warnings: validation.warnings,
        metadata: {
          model: this.getModelName(),
          tokens_used: llmResponse.tokens_used || 0,
          generation_time_ms: Date.now() - startTime
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      console.error('[DeclarativeIRGenerator] ✗ Generation failed:', errorMessage)

      return {
        success: false,
        errors: [errorMessage],
        metadata: {
          model: this.getModelName(),
          tokens_used: 0,
          generation_time_ms: Date.now() - startTime
        }
      }
    }
  }

  /**
   * Call LLM with enhanced prompt
   */
  private async callLLM(enhancedPrompt: EnhancedPrompt): Promise<{
    success: boolean
    ir?: DeclarativeLogicalIR
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
   * Call OpenAI API with structured output
   */
  private async callOpenAI(enhancedPrompt: EnhancedPrompt): Promise<{
    success: boolean
    ir?: DeclarativeLogicalIR
    errors?: string[]
    tokens_used?: number
  }> {
    if (!this.openai) {
      return { success: false, errors: ['OpenAI client not initialized'] }
    }

    try {
      console.log('[DeclarativeIRGenerator] Calling OpenAI with model:', this.getModelName())

      const userMessage = this.buildUserMessage(enhancedPrompt)

      // Dynamic import to avoid bundling large schema at module load time
      const { DECLARATIVE_IR_SCHEMA_STRICT } = await import('../logical-ir/schemas/declarative-ir-schema-strict')

      const response = await this.openai.chat.completions.create({
        model: this.getModelName(),
        messages: [
          { role: 'system', content: this.systemPrompt },
          { role: 'user', content: userMessage }
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'declarative_ir_v3',
            strict: true,
            schema: DECLARATIVE_IR_SCHEMA_STRICT
          }
        },
        temperature: this.config.temperature,
        max_completion_tokens: this.config.max_tokens
      })

      const content = response.choices[0]?.message?.content

      if (!content) {
        return { success: false, errors: ['Empty response from OpenAI'] }
      }

      console.log('[DeclarativeIRGenerator] Raw LLM response:', content.substring(0, 500))

      const ir = JSON.parse(content) as DeclarativeLogicalIR
      console.log('[DeclarativeIRGenerator] Parsed IR ir_version:', ir.ir_version)
      console.log('[DeclarativeIRGenerator] Parsed IR keys:', Object.keys(ir))

      return {
        success: true,
        ir,
        tokens_used: response.usage?.total_tokens || 0
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown OpenAI error'
      console.error('[DeclarativeIRGenerator] OpenAI call failed:', errorMessage)
      return { success: false, errors: [errorMessage] }
    }
  }

  /**
   * Call Anthropic API
   */
  private async callAnthropic(enhancedPrompt: EnhancedPrompt): Promise<{
    success: boolean
    ir?: DeclarativeLogicalIR
    errors?: string[]
    tokens_used?: number
  }> {
    if (!this.anthropic) {
      return { success: false, errors: ['Anthropic client not initialized'] }
    }

    try {
      console.log('[DeclarativeIRGenerator] Calling Anthropic with model:', this.getModelName())

      const userMessage = this.buildUserMessage(enhancedPrompt)

      const response = await this.anthropic.messages.create({
        model: this.getModelName(),
        max_tokens: this.config.max_tokens || 4000,
        temperature: this.config.temperature,
        system: this.systemPrompt,
        messages: [
          { role: 'user', content: userMessage }
        ]
      })

      const content = response.content[0]
      if (content.type !== 'text') {
        return { success: false, errors: ['Unexpected response type from Anthropic'] }
      }

      // Extract JSON from markdown code blocks if present
      let jsonText = content.text.trim()
      if (jsonText.startsWith('```json')) {
        jsonText = jsonText.replace(/```json\s*/, '').replace(/```\s*$/, '')
      } else if (jsonText.startsWith('```')) {
        jsonText = jsonText.replace(/```\s*/, '').replace(/```\s*$/, '')
      }

      const ir = JSON.parse(jsonText) as DeclarativeLogicalIR

      return {
        success: true,
        ir,
        tokens_used: response.usage.input_tokens + response.usage.output_tokens
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown Anthropic error'
      console.error('[DeclarativeIRGenerator] Anthropic call failed:', errorMessage)
      return { success: false, errors: [errorMessage] }
    }
  }

  /**
   * Build user message from enhanced prompt
   */
  private buildUserMessage(enhancedPrompt: EnhancedPrompt): string {
    const sections = enhancedPrompt.sections

    let message = '# Enhanced Prompt\n\n'

    if (sections.data) {
      message += '## Data Sources\n'
      sections.data.forEach(item => {
        message += `${item}\n`
      })
      message += '\n'
    }

    if (sections.actions) {
      message += '## Actions\n'
      sections.actions.forEach(item => {
        message += `${item}\n`
      })
      message += '\n'
    }

    if (sections.output) {
      message += '## Output\n'
      sections.output.forEach(item => {
        message += `${item}\n`
      })
      message += '\n'
    }

    if (sections.delivery) {
      message += '## Delivery\n'
      sections.delivery.forEach(item => {
        message += `${item}\n`
      })
      message += '\n'
    }

    if (sections.processing_steps) {
      message += '## Processing Steps\n'
      sections.processing_steps.forEach(item => {
        message += `${item}\n`
      })
      message += '\n'
    }

    message += '\n---\n\n'
    message += 'Generate the Declarative Logical IR (v3.0) for this workflow.\n'
    message += 'Remember: NO IDs, NO loops, NO execution tokens. Only business intent!'

    return message
  }

  /**
   * Get model name based on config
   */
  private getModelName(): string {
    if (this.config.model_name) {
      return this.config.model_name
    }

    if (this.config.model_provider === 'openai') {
      return 'gpt-5.2' // Latest GPT-5.2 with enhanced reasoning
    }

    if (this.config.model_provider === 'anthropic') {
      return 'claude-sonnet-4-20250514'
    }

    return 'unknown'
  }
}
