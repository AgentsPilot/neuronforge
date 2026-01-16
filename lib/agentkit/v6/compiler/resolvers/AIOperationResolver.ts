/**
 * AI Operation Resolver
 *
 * Maps IR ai_operations to PILOT_DSL ai_processing steps.
 *
 * Responsibilities:
 * 1. Convert AI operations to ai_processing steps with contracts
 * 2. Generate structured LLM prompts from instructions
 * 3. Map output schemas to response contracts
 * 4. Select appropriate model based on constraints
 */

import type { AIOperation, AIOperationType } from '../../logical-ir/schemas/extended-ir-types'
import type { WorkflowStep } from '../../../../pilot/types/pilot-dsl-types'

// ============================================================================
// AI Operation Resolver
// ============================================================================

export class AIOperationResolver {
  /**
   * Resolve AI operations to ai_processing steps
   */
  async resolve(
    aiOperations: AIOperation[],
    inputVariable: string,
    stepIdPrefix: string = 'ai'
  ): Promise<WorkflowStep[]> {
    if (!aiOperations || aiOperations.length === 0) {
      return []
    }

    console.log('[AIOperationResolver] Resolving', aiOperations.length, 'AI operation(s)...')

    const steps: WorkflowStep[] = []

    for (let i = 0; i < aiOperations.length; i++) {
      const aiOp = aiOperations[i]
      console.log(`[AIOperationResolver] Processing AI operation ${i + 1}:`, aiOp.type)

      const step = await this.createAIProcessingStep(aiOp, inputVariable, `${stepIdPrefix}_${i + 1}`)
      steps.push(step)

      // Update input variable for chaining AI operations
      inputVariable = step.output_variable!
    }

    console.log('[AIOperationResolver] ✓ Resolved', steps.length, 'AI processing step(s)')
    return steps
  }

  /**
   * Create an AI processing step
   */
  private async createAIProcessingStep(
    aiOp: AIOperation,
    inputVariable: string,
    stepId: string
  ): Promise<WorkflowStep> {
    // Generate prompt template based on operation type
    const promptTemplate = this.generatePromptTemplate(aiOp)

    // Map output schema to response contract
    const responseContract = this.mapOutputSchemaToContract(aiOp.output_schema)

    // Select model based on constraints
    const modelConfig = this.selectModel(aiOp.constraints)

    return {
      step_id: stepId,
      type: 'ai_processing',
      operation: this.mapAIOperationType(aiOp.type),
      // Top-level prompt for StepExecutor.executeLLMDecision() compatibility
      prompt: promptTemplate,
      config: {
        input: aiOp.input_source,
        prompt_template: promptTemplate,
        response_contract: responseContract,
        model: modelConfig.model,
        temperature: modelConfig.temperature,
        max_tokens: aiOp.constraints?.max_tokens || modelConfig.max_tokens
      },
      output_variable: `${stepId}_output`,
      description: aiOp.instruction
    }
  }

  /**
   * Generate prompt template based on AI operation type
   */
  private generatePromptTemplate(aiOp: AIOperation): string {
    switch (aiOp.type) {
      case 'summarize':
        return this.generateSummarizePrompt(aiOp)
      case 'extract':
        return this.generateExtractPrompt(aiOp)
      case 'classify':
        return this.generateClassifyPrompt(aiOp)
      case 'sentiment':
        return this.generateSentimentPrompt(aiOp)
      case 'generate':
        return this.generateGeneratePrompt(aiOp)
      case 'decide':
        return this.generateDecidePrompt(aiOp)
      default:
        throw new Error(`Unsupported AI operation type: ${aiOp.type}`)
    }
  }

  /**
   * Generate summarize prompt
   */
  private generateSummarizePrompt(aiOp: AIOperation): string {
    return `Task: Summarize the following content.

Instruction: ${aiOp.instruction}

Content:
{{${this.extractVariableName(aiOp.input_source)}}}

Provide a concise summary.`
  }

  /**
   * Generate extract prompt
   */
  private generateExtractPrompt(aiOp: AIOperation): string {
    const fields = aiOp.output_schema.fields || []
    const fieldDescriptions = fields
      .map(f => `- ${f.name}${f.required ? ' (required)' : ' (optional)'}: ${f.description || f.type}`)
      .join('\n')

    return `Task: Extract structured information from the following content.

Instruction: ${aiOp.instruction}

Extract these fields:
${fieldDescriptions}

Content:
{{${this.extractVariableName(aiOp.input_source)}}}

Respond with JSON containing the extracted fields.`
  }

  /**
   * Generate classify prompt
   */
  private generateClassifyPrompt(aiOp: AIOperation): string {
    const validClasses = aiOp.output_schema.enum || []
    const classesText = validClasses.length > 0
      ? `Valid categories: ${validClasses.join(', ')}`
      : ''

    return `Task: Classify the following content into a category.

Instruction: ${aiOp.instruction}

${classesText}

Content:
{{${this.extractVariableName(aiOp.input_source)}}}

Respond with the classification category.`
  }

  /**
   * Generate sentiment prompt
   */
  private generateSentimentPrompt(aiOp: AIOperation): string {
    const validSentiments = aiOp.output_schema.enum || ['positive', 'negative', 'neutral']

    return `Task: Analyze the sentiment of the following content.

Instruction: ${aiOp.instruction}

Valid sentiments: ${validSentiments.join(', ')}

Content:
{{${this.extractVariableName(aiOp.input_source)}}}

Respond with the sentiment.`
  }

  /**
   * Generate generate prompt
   */
  private generateGeneratePrompt(aiOp: AIOperation): string {
    return `Task: Generate content based on the following input.

Instruction: ${aiOp.instruction}

Input:
{{${this.extractVariableName(aiOp.input_source)}}}

Generate the requested content.`
  }

  /**
   * Generate decide prompt
   */
  private generateDecidePrompt(aiOp: AIOperation): string {
    const options = aiOp.output_schema.enum || ['yes', 'no']

    return `Task: Make a decision based on the following information.

Instruction: ${aiOp.instruction}

Valid decisions: ${options.join(', ')}

Information:
{{${this.extractVariableName(aiOp.input_source)}}}

Respond with your decision.`
  }

  /**
   * Extract variable name from {{variable}} syntax
   */
  private extractVariableName(inputSource: string): string {
    const match = inputSource.match(/\{\{([^}]+)\}\}/)
    return match ? match[1] : inputSource
  }

  /**
   * Map output schema to response contract
   */
  private mapOutputSchemaToContract(outputSchema: any): any {
    if (outputSchema.type === 'string' && outputSchema.enum) {
      // Classification/decision - enum response
      return {
        type: 'enum',
        values: outputSchema.enum
      }
    }

    if (outputSchema.type === 'object' && outputSchema.fields) {
      // Extraction - structured response
      return {
        type: 'object',
        properties: outputSchema.fields.reduce((acc: any, field: any) => {
          acc[field.name] = {
            type: field.type,
            required: field.required !== false,
            description: field.description
          }
          return acc
        }, {})
      }
    }

    if (outputSchema.type === 'string') {
      // Simple text response
      return {
        type: 'text'
      }
    }

    if (outputSchema.type === 'number' || outputSchema.type === 'boolean') {
      return {
        type: outputSchema.type
      }
    }

    // Default to flexible JSON
    return {
      type: 'json'
    }
  }

  /**
   * Map AI operation type to PILOT_DSL operation
   */
  private mapAIOperationType(type: AIOperationType): string {
    const operationMap: Record<AIOperationType, string> = {
      summarize: 'summarize',
      extract: 'extract_structured',
      classify: 'classify',
      sentiment: 'sentiment_analysis',
      generate: 'generate_text',
      decide: 'decision_making'
    }

    return operationMap[type] || type
  }

  /**
   * Select model based on constraints
   */
  private selectModel(constraints?: { model_preference?: string; temperature?: number; max_tokens?: number }): {
    model: string
    temperature: number
    max_tokens: number
  } {
    const preference = constraints?.model_preference || 'balanced'

    // Model selection based on preference
    const modelConfig: Record<string, { model: string; temperature: number; max_tokens: number }> = {
      fast: {
        model: 'gpt-4o-mini',
        temperature: 0.3,
        max_tokens: 500
      },
      accurate: {
        model: 'gpt-4o',
        temperature: 0.1,
        max_tokens: 2000
      },
      balanced: {
        model: 'gpt-4o',
        temperature: 0.3,
        max_tokens: 1000
      }
    }

    const config = modelConfig[preference] || modelConfig.balanced

    // Override with explicit constraints
    return {
      model: config.model,
      temperature: constraints?.temperature !== undefined ? constraints.temperature : config.temperature,
      max_tokens: constraints?.max_tokens || config.max_tokens
    }
  }

  /**
   * Estimate tokens for an AI operation
   */
  estimateTokens(aiOp: AIOperation): number {
    // Rough estimation
    const instructionTokens = Math.ceil(aiOp.instruction.length / 4)
    const maxTokens = aiOp.constraints?.max_tokens || 1000

    return instructionTokens + maxTokens
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Create an AI operation resolver
 */
export function createAIOperationResolver(): AIOperationResolver {
  return new AIOperationResolver()
}

/**
 * Quick resolve AI operations
 */
export async function resolveAIOperations(
  aiOperations: AIOperation[],
  inputVariable: string
): Promise<WorkflowStep[]> {
  const resolver = new AIOperationResolver()
  return await resolver.resolve(aiOperations, inputVariable)
}
