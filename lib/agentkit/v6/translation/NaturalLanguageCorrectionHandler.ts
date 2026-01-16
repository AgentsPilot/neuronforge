/**
 * Natural Language Correction Handler
 *
 * Handles user corrections to workflows using natural language.
 *
 * Examples:
 * - "Actually filter by 'stage' column, not 'status'"
 * - "Change email recipient to john@example.com"
 * - "Add CC to meiribarak@gmail.com"
 * - "Remove the AI classification step"
 *
 * This uses a small LLM to extract correction intent and update the IR.
 */

import { OpenAI } from 'openai'
import Anthropic from '@anthropic-ai/sdk'
import type { ExtendedLogicalIR } from '../logical-ir/schemas/extended-ir-types'
import { validateIR, normalizeIR } from '../logical-ir/schemas/extended-ir-validation'

// ============================================================================
// Types
// ============================================================================

export interface CorrectionRequest {
  userMessage: string
  currentIR: ExtendedLogicalIR
}

export interface CorrectionResult {
  success: boolean
  updatedIR?: ExtendedLogicalIR
  changes?: string[]
  errors?: string[]
  clarificationNeeded?: string
}

export interface CorrectionIntent {
  type: 'modify_filter' | 'modify_delivery' | 'modify_ai_operation' | 'add_step' | 'remove_step' | 'modify_general'
  target?: string
  changes: Record<string, any>
}

// ============================================================================
// Correction Handler
// ============================================================================

export class NaturalLanguageCorrectionHandler {
  private openai?: OpenAI
  private anthropic?: Anthropic
  private modelProvider: 'openai' | 'anthropic'

  constructor(modelProvider: 'openai' | 'anthropic' = 'openai') {
    console.log('[CorrectionHandler] Initializing with provider:', modelProvider)
    this.modelProvider = modelProvider

    if (modelProvider === 'openai') {
      this.openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY
      })
    } else {
      this.anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY
      })
    }
  }

  /**
   * Handle user correction
   */
  async handleCorrection(request: CorrectionRequest): Promise<CorrectionResult> {
    console.log('[CorrectionHandler] Processing correction:', request.userMessage)

    try {
      // Extract correction intent using LLM
      const intent = await this.extractCorrectionIntent(request)
      console.log('[CorrectionHandler] Intent extracted:', intent.type)

      // Apply correction to IR
      const updatedIR = this.applyCorrection(request.currentIR, intent)

      // Validate updated IR
      const validation = validateIR(updatedIR)

      if (!validation.valid) {
        console.log('[CorrectionHandler] ✗ Updated IR is invalid:', validation.errors)
        return {
          success: false,
          errors: validation.errors
        }
      }

      // Generate change summary
      const changes = this.describeChanges(request.currentIR, updatedIR, intent)

      console.log('[CorrectionHandler] ✓ Correction applied successfully')
      return {
        success: true,
        updatedIR: validation.normalizedIR,
        changes
      }
    } catch (error) {
      console.error('[CorrectionHandler] ✗ Error:', error)
      return {
        success: false,
        errors: [error instanceof Error ? error.message : 'Unknown error']
      }
    }
  }

  /**
   * Extract correction intent using LLM
   */
  private async extractCorrectionIntent(request: CorrectionRequest): Promise<CorrectionIntent> {
    const systemPrompt = `You are a workflow correction analyzer. Extract the user's intended changes to a workflow.

The user will provide a correction message like:
- "Change filter to use 'stage' column instead of 'status'"
- "Update email recipient to john@example.com"
- "Add CC to meiribarak@gmail.com"

Respond with JSON containing:
{
  "type": "modify_filter" | "modify_delivery" | "modify_ai_operation" | "add_step" | "remove_step" | "modify_general",
  "target": "which part to modify (e.g., 'filter', 'email delivery')",
  "changes": {
    // Field-level changes as key-value pairs
  }
}

Examples:

User: "Change filter to use 'stage' column instead of 'status'"
Response: {
  "type": "modify_filter",
  "target": "filter",
  "changes": {
    "field": "stage"
  }
}

User: "Update email recipient to john@example.com"
Response: {
  "type": "modify_delivery",
  "target": "email",
  "changes": {
    "recipient": "john@example.com"
  }
}

User: "Add CC to meiribarak@gmail.com"
Response: {
  "type": "modify_delivery",
  "target": "email",
  "changes": {
    "cc": ["meiribarak@gmail.com"]
  }
}

Extract the correction intent from the user's message.`

    const userPrompt = `Current IR:
\`\`\`json
${JSON.stringify(request.currentIR, null, 2)}
\`\`\`

User's correction: "${request.userMessage}"

What is the correction intent?`

    if (this.modelProvider === 'openai') {
      const response = await this.openai!.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 500
      })

      const content = response.choices[0]?.message?.content
      if (!content) {
        throw new Error('LLM returned empty response')
      }

      return JSON.parse(content)
    } else {
      const response = await this.anthropic!.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        temperature: 0.1,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: userPrompt
          }
        ]
      })

      const content = response.content[0]
      if (content.type !== 'text') {
        throw new Error('Anthropic returned non-text response')
      }

      const jsonMatch = content.text.match(/\{[\s\S]*\}/)
      if (!jsonMatch) {
        throw new Error('Failed to extract JSON from response')
      }

      return JSON.parse(jsonMatch[0])
    }
  }

  /**
   * Apply correction to IR
   */
  private applyCorrection(ir: ExtendedLogicalIR, intent: CorrectionIntent): ExtendedLogicalIR {
    console.log('[CorrectionHandler] Applying correction...')

    const updatedIR = JSON.parse(JSON.stringify(ir)) // Deep clone

    switch (intent.type) {
      case 'modify_filter':
        this.modifyFilter(updatedIR, intent.changes)
        break
      case 'modify_delivery':
        this.modifyDelivery(updatedIR, intent.changes, intent.target)
        break
      case 'modify_ai_operation':
        this.modifyAIOperation(updatedIR, intent.changes)
        break
      case 'add_step':
        this.addStep(updatedIR, intent.changes)
        break
      case 'remove_step':
        this.removeStep(updatedIR, intent.target)
        break
      case 'modify_general':
        this.modifyGeneral(updatedIR, intent.changes)
        break
    }

    return updatedIR
  }

  /**
   * Modify filter
   */
  private modifyFilter(ir: ExtendedLogicalIR, changes: Record<string, any>): void {
    if (!ir.filters || ir.filters.length === 0) {
      // Add new filter if none exist
      ir.filters = [{
        id: '',
        field: changes.field || 'unknown',
        operator: changes.operator || 'equals',
        value: changes.value,
        description: ''
      }]
      return
    }

    // Modify first filter (or could be more sophisticated)
    const filter = ir.filters[0]
    Object.assign(filter, changes)
  }

  /**
   * Modify delivery
   */
  private modifyDelivery(ir: ExtendedLogicalIR, changes: Record<string, any>, target?: string): void {
    // Find delivery method (email, slack, etc.)
    const deliveryIndex = target === 'email'
      ? ir.delivery.findIndex(d => d.method === 'email')
      : target === 'slack'
      ? ir.delivery.findIndex(d => d.method === 'slack')
      : 0

    if (deliveryIndex === -1) {
      console.warn('[CorrectionHandler] Delivery method not found, modifying first delivery')
    }

    const delivery = ir.delivery[deliveryIndex >= 0 ? deliveryIndex : 0]

    // Apply changes to config
    Object.assign(delivery.config, changes)
  }

  /**
   * Modify AI operation
   */
  private modifyAIOperation(ir: ExtendedLogicalIR, changes: Record<string, any>): void {
    if (!ir.ai_operations || ir.ai_operations.length === 0) {
      console.warn('[CorrectionHandler] No AI operations to modify')
      return
    }

    const aiOp = ir.ai_operations[0]
    Object.assign(aiOp, changes)
  }

  /**
   * Add step (simplified)
   */
  private addStep(ir: ExtendedLogicalIR, changes: Record<string, any>): void {
    // This would need more sophisticated logic based on step type
    console.warn('[CorrectionHandler] Add step not fully implemented')
  }

  /**
   * Remove step (simplified)
   */
  private removeStep(ir: ExtendedLogicalIR, target?: string): void {
    if (target === 'ai' || target === 'ai_operation') {
      ir.ai_operations = undefined
    } else if (target === 'filter') {
      ir.filters = undefined
    }
  }

  /**
   * Modify general fields
   */
  private modifyGeneral(ir: ExtendedLogicalIR, changes: Record<string, any>): void {
    Object.assign(ir, changes)
  }

  /**
   * Describe changes made
   */
  private describeChanges(
    originalIR: ExtendedLogicalIR,
    updatedIR: ExtendedLogicalIR,
    intent: CorrectionIntent
  ): string[] {
    const changes: string[] = []

    switch (intent.type) {
      case 'modify_filter':
        if (intent.changes.field) {
          changes.push(`Changed filter field to: ${intent.changes.field}`)
        }
        if (intent.changes.operator) {
          changes.push(`Changed filter operator to: ${intent.changes.operator}`)
        }
        if (intent.changes.value !== undefined) {
          changes.push(`Changed filter value to: ${intent.changes.value}`)
        }
        break

      case 'modify_delivery':
        if (intent.changes.recipient) {
          changes.push(`Changed recipient to: ${intent.changes.recipient}`)
        }
        if (intent.changes.cc) {
          changes.push(`Added CC: ${Array.isArray(intent.changes.cc) ? intent.changes.cc.join(', ') : intent.changes.cc}`)
        }
        if (intent.changes.subject) {
          changes.push(`Changed subject to: ${intent.changes.subject}`)
        }
        break

      case 'modify_ai_operation':
        if (intent.changes.instruction) {
          changes.push(`Updated AI instruction: ${intent.changes.instruction}`)
        }
        break

      case 'remove_step':
        changes.push(`Removed ${intent.target || 'step'}`)
        break
    }

    if (changes.length === 0) {
      changes.push('Updated workflow configuration')
    }

    return changes
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create correction handler
 */
export function createCorrectionHandler(provider: 'openai' | 'anthropic' = 'openai'): NaturalLanguageCorrectionHandler {
  return new NaturalLanguageCorrectionHandler(provider)
}

/**
 * Quick correction function
 */
export async function handleCorrection(
  userMessage: string,
  currentIR: ExtendedLogicalIR,
  provider: 'openai' | 'anthropic' = 'openai'
): Promise<CorrectionResult> {
  const handler = new NaturalLanguageCorrectionHandler(provider)
  return await handler.handleCorrection({ userMessage, currentIR })
}
