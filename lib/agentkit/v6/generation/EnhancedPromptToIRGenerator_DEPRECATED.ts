/**
 * Enhanced Prompt to Logical IR Generator
 *
 * This component uses an LLM (GPT-4o or Claude Sonnet 4) to convert
 * the Enhanced Prompt (from Phase 3) into a Logical IR representation.
 *
 * Key Responsibilities:
 * 1. Take Enhanced Prompt as input
 * 2. Call LLM with structured output schema
 * 3. Validate generated IR
 * 4. Return validated IR or errors
 *
 * This is the ONLY LLM stage in V6 architecture.
 * Everything after this is deterministic compilation.
 */

import { OpenAI } from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import { getExtendedIRSchema } from '../logical-ir/schemas/extended-ir-schema'
import { validateIR, normalizeIR } from '../logical-ir/schemas/extended-ir-validation'
import type { ExtendedLogicalIR, IRValidationResult } from '../logical-ir/schemas/extended-ir-types'
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
    edge_cases?: string[]
  }
  user_context?: {
    original_request: string
    clarifications?: Record<string, string>
  }
}

export interface IRGenerationResult {
  success: boolean
  ir?: ExtendedLogicalIR
  errors?: string[]
  warnings?: string[]
  raw_response?: any
  metadata?: {
    model: string
    tokens_used: number
    generation_time_ms: number
  }
}

export interface GeneratorConfig {
  model_provider: 'openai' | 'anthropic'
  model_name?: string
  temperature?: number
  max_tokens?: number
  enable_repair?: boolean
  max_repair_attempts?: number
}

// ============================================================================
// Main Generator Class
// ============================================================================

export class EnhancedPromptToIRGenerator {
  private openai?: OpenAI
  private anthropic?: Anthropic
  private config: GeneratorConfig
  private systemPrompt: string

  constructor(config: GeneratorConfig) {
    console.log('[IRGenerator] Initializing with config:', config)
    this.config = {
      temperature: 0.1, // Low temperature for consistency
      max_tokens: 4000,
      enable_repair: true,
      max_repair_attempts: 2,
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
    console.log('[IRGenerator] System prompt loaded, length:', this.systemPrompt.length)
  }

  /**
   * Load system prompt from markdown file
   */
  private loadSystemPrompt(): string {
    try {
      const promptPath = join(__dirname, 'prompts', 'enhanced-to-ir-system_DEPRECATED.md')
      const prompt = readFileSync(promptPath, 'utf-8')
      console.log('[IRGenerator] Loaded system prompt from:', promptPath)
      return prompt
    } catch (error) {
      console.error('[IRGenerator] Failed to load system prompt:', error)
      // Fallback to inline prompt
      return this.getFallbackSystemPrompt()
    }
  }

  /**
   * Fallback system prompt if file not found
   */
  private getFallbackSystemPrompt(): string {
    return `You are a workflow intent analyzer. Convert Enhanced Prompts into Logical IR.

Your task:
1. Read the Enhanced Prompt sections (data, actions, output, delivery)
2. Categorize each action into the correct IR field
3. Generate valid Logical IR JSON

Categorization rules:
- Data section → data_sources
- "filter", "where", "only" → filters
- "sort", "group", "transform" → transforms
- "summarize", "classify", "extract" → ai_operations
- "if", "when", "condition" → conditionals
- "for each", "loop" → loops
- Output section → rendering
- Delivery section → delivery

CRITICAL: Only express INTENT, never execution details.
NO: plugin, action, step_id, workflow_steps
YES: what to do, not how to do it`
  }

  /**
   * Main generation method
   */
  async generate(enhancedPrompt: EnhancedPrompt): Promise<IRGenerationResult> {
    console.log('[IRGenerator] Starting IR generation...')
    console.log('[IRGenerator] Enhanced prompt sections:', Object.keys(enhancedPrompt.sections))

    const startTime = Date.now()

    try {
      // Generate IR using LLM
      const rawIR = await this.callLLM(enhancedPrompt)
      console.log('[IRGenerator] Raw IR generated')

      // Normalize IR (fix common quirks)
      console.log('[IRGenerator] Normalizing IR...')
      const normalized = normalizeIR(rawIR)

      // Validate IR
      console.log('[IRGenerator] Validating IR...')
      const validation = validateIR(normalized)

      if (validation.valid) {
        console.log('[IRGenerator] ✓ IR generation successful')
        return {
          success: true,
          ir: validation.normalizedIR,
          warnings: validation.warnings,
          metadata: {
            model: this.getModelName(),
            tokens_used: 0, // TODO: extract from response
            generation_time_ms: Date.now() - startTime
          }
        }
      }

      // Validation failed - try repair if enabled
      if (this.config.enable_repair) {
        console.log('[IRGenerator] Validation failed, attempting repair...')
        return await this.repairIR(normalized, validation, enhancedPrompt)
      }

      console.log('[IRGenerator] ✗ IR generation failed:', validation.errors)
      return {
        success: false,
        errors: validation.errors,
        raw_response: rawIR
      }
    } catch (error) {
      console.error('[IRGenerator] ✗ IR generation error:', error)
      return {
        success: false,
        errors: [error instanceof Error ? error.message : 'Unknown error']
      }
    }
  }

  /**
   * Call LLM to generate IR
   */
  private async callLLM(enhancedPrompt: EnhancedPrompt): Promise<any> {
    console.log('[IRGenerator] Calling LLM:', this.config.model_provider)

    const userPrompt = this.formatUserPrompt(enhancedPrompt)

    if (this.config.model_provider === 'openai') {
      return await this.callOpenAI(userPrompt)
    } else {
      return await this.callAnthropic(userPrompt)
    }
  }

  /**
   * Call OpenAI with structured outputs
   */
  private async callOpenAI(userPrompt: string): Promise<any> {
    if (!this.openai) {
      throw new Error('OpenAI client not initialized')
    }

    console.log('[IRGenerator] Calling OpenAI structured outputs...')

    const response = await this.openai.chat.completions.create({
      model: this.config.model_name || 'gpt-4o-2024-08-06',
      messages: [
        { role: 'system', content: this.systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'extended_logical_ir',
          strict: true,
          schema: getExtendedIRSchema()
        }
      },
      temperature: this.config.temperature,
      max_tokens: this.config.max_tokens
    })

    console.log('[IRGenerator] OpenAI response received')
    const content = response.choices[0]?.message?.content

    if (!content) {
      throw new Error('OpenAI returned empty response')
    }

    return JSON.parse(content)
  }

  /**
   * Call Anthropic (Claude)
   */
  private async callAnthropic(userPrompt: string): Promise<any> {
    if (!this.anthropic) {
      throw new Error('Anthropic client not initialized')
    }

    console.log('[IRGenerator] Calling Anthropic (Claude)...')

    // Note: Anthropic doesn't support strict JSON schema like OpenAI
    // We'll use prompt engineering + JSON mode
    const response = await this.anthropic.messages.create({
      model: this.config.model_name || 'claude-sonnet-4-20250514',
      max_tokens: this.config.max_tokens || 4000,
      temperature: this.config.temperature,
      system: this.systemPrompt + '\n\nRespond ONLY with valid JSON matching the ExtendedLogicalIR schema.',
      messages: [
        {
          role: 'user',
          content: userPrompt + '\n\nGenerate Logical IR as JSON:'
        }
      ]
    })

    console.log('[IRGenerator] Anthropic response received')
    const content = response.content[0]

    if (content.type !== 'text') {
      throw new Error('Anthropic returned non-text response')
    }

    // Extract JSON from response (Claude might wrap in markdown)
    const text = content.text
    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/\{[\s\S]*\}/)

    if (!jsonMatch) {
      throw new Error('Failed to extract JSON from Anthropic response')
    }

    return JSON.parse(jsonMatch[1] || jsonMatch[0])
  }

  /**
   * Format user prompt from Enhanced Prompt
   */
  private formatUserPrompt(enhancedPrompt: EnhancedPrompt): string {
    console.log('[IRGenerator] Formatting user prompt...')

    let prompt = '# Enhanced Prompt\n\n'

    // Add user context if available
    if (enhancedPrompt.user_context?.original_request) {
      prompt += `## Original User Request\n${enhancedPrompt.user_context.original_request}\n\n`
    }

    // Add sections
    prompt += '## Data Sources\n'
    prompt += enhancedPrompt.sections.data.map(item => `- ${item}`).join('\n')
    prompt += '\n\n'

    prompt += '## Actions to Perform\n'
    prompt += enhancedPrompt.sections.actions.map(item => `- ${item}`).join('\n')
    prompt += '\n\n'

    prompt += '## Output Format\n'
    prompt += enhancedPrompt.sections.output.map(item => `- ${item}`).join('\n')
    prompt += '\n\n'

    prompt += '## Delivery Method\n'
    prompt += enhancedPrompt.sections.delivery.map(item => `- ${item}`).join('\n')
    prompt += '\n\n'

    if (enhancedPrompt.sections.edge_cases && enhancedPrompt.sections.edge_cases.length > 0) {
      prompt += '## Edge Cases\n'
      prompt += enhancedPrompt.sections.edge_cases.map(item => `- ${item}`).join('\n')
      prompt += '\n\n'
    }

    prompt += 'Generate the Logical IR for this workflow.'

    console.log('[IRGenerator] User prompt length:', prompt.length)
    return prompt
  }

  /**
   * Attempt to repair invalid IR
   */
  private async repairIR(
    invalidIR: any,
    validation: IRValidationResult,
    enhancedPrompt: EnhancedPrompt
  ): Promise<IRGenerationResult> {
    console.log('[IRGenerator] Attempting IR repair...')

    for (let attempt = 1; attempt <= (this.config.max_repair_attempts || 2); attempt++) {
      console.log(`[IRGenerator] Repair attempt ${attempt}/${this.config.max_repair_attempts}`)

      try {
        const repairedIR = await this.callRepairLLM(invalidIR, validation.errors || [], enhancedPrompt)
        const normalized = normalizeIR(repairedIR)
        const newValidation = validateIR(normalized)

        if (newValidation.valid) {
          console.log('[IRGenerator] ✓ Repair successful')
          return {
            success: true,
            ir: newValidation.normalizedIR,
            warnings: [
              `IR was repaired after ${attempt} attempt(s)`,
              ...(newValidation.warnings || [])
            ]
          }
        }

        console.log(`[IRGenerator] Repair attempt ${attempt} failed:`, newValidation.errors)
      } catch (error) {
        console.error(`[IRGenerator] Repair attempt ${attempt} error:`, error)
      }
    }

    console.log('[IRGenerator] ✗ Repair failed after all attempts')
    return {
      success: false,
      errors: [
        'IR validation failed and repair attempts exhausted',
        ...(validation.errors || [])
      ],
      raw_response: invalidIR
    }
  }

  /**
   * Call LLM to repair invalid IR
   */
  private async callRepairLLM(
    invalidIR: any,
    errors: string[],
    enhancedPrompt: EnhancedPrompt
  ): Promise<any> {
    console.log('[IRGenerator] Calling repair LLM...')

    const repairPrompt = `The following Logical IR has validation errors. Please fix them.

# Original Enhanced Prompt
${this.formatUserPrompt(enhancedPrompt)}

# Generated IR (with errors)
\`\`\`json
${JSON.stringify(invalidIR, null, 2)}
\`\`\`

# Validation Errors
${errors.map((e, i) => `${i + 1}. ${e}`).join('\n')}

Generate a corrected Logical IR that fixes these errors.`

    if (this.config.model_provider === 'openai') {
      return await this.callOpenAI(repairPrompt)
    } else {
      return await this.callAnthropic(repairPrompt)
    }
  }

  /**
   * Get model name for metadata
   */
  private getModelName(): string {
    if (this.config.model_name) {
      return this.config.model_name
    }
    return this.config.model_provider === 'openai' ? 'gpt-4o-2024-08-06' : 'claude-sonnet-4-20250514'
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create generator with default config
 */
export function createIRGenerator(provider: 'openai' | 'anthropic' = 'openai'): EnhancedPromptToIRGenerator {
  console.log('[IRGenerator] Creating generator with provider:', provider)
  return new EnhancedPromptToIRGenerator({
    model_provider: provider,
    temperature: 0.1,
    enable_repair: true,
    max_repair_attempts: 2
  })
}

/**
 * Quick generation function
 */
export async function generateIRFromEnhancedPrompt(
  enhancedPrompt: EnhancedPrompt,
  provider: 'openai' | 'anthropic' = 'openai'
): Promise<IRGenerationResult> {
  const generator = createIRGenerator(provider)
  return await generator.generate(enhancedPrompt)
}
