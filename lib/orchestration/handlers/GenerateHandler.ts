/**
 * GenerateHandler
 *
 * Handler for content generation intents
 * Optimized for creating new content, reports, and creative outputs
 */

import { BaseHandler } from './BaseHandler';
import type { HandlerContext, HandlerResult, IntentType } from '../types';

export class GenerateHandler extends BaseHandler {
  intent: IntentType = 'generate';

  constructor() {
    super();
  }

  async handle(context: HandlerContext): Promise<HandlerResult> {
    const startTime = Date.now();

    try {
      // Validate context
      const isValid = await this.validate(context);
      if (!isValid) {
        return this.createErrorResult('Invalid handler context');
      }

      // Resolve variables in input
      const resolvedInput = this.resolveInputVariables(context);

      // Prepare input for LLM
      const input = this.safeStringify(resolvedInput);

      // Estimate token usage - generation typically needs more output tokens
      const inputTokens = this.estimateTokenCount(input);
      const estimatedTokens = inputTokens + 1500;
      if (!this.checkBudget(context, estimatedTokens)) {
        return this.createErrorResult('Insufficient budget for generation');
      }

      // Check if this step has an output_schema (from data_schema system)
      // When present, we must instruct the LLM to return structured JSON
      const outputSchema = context.input?.step?.output_schema
        || context.input?.step?.config?.output_schema;

      // Prepare prompts
      const { system, user } = this.formatPrompt(
        this.buildSystemPrompt(context, outputSchema),
        input,
        context
      );

      // Execute generation using provider-agnostic method
      const temperature = outputSchema ? 0.2 : this.getTemperature(context);
      const llmResponse = await this.callLLM(
        context,
        system,
        user,
        temperature,
        Math.min(context.budget.remaining, 4096), // Generation needs more tokens
        outputSchema ? { type: 'json_object' as const } : undefined
      );

      // Parse response
      const output = llmResponse.text;

      // Calculate actual token usage
      const tokensUsed = {
        input: llmResponse.inputTokens,
        output: llmResponse.outputTokens,
      };

      // Use cost from provider
      const cost = llmResponse.cost;

      // Assess quality if possible
      const quality = this.assessGenerationQuality(output, context);

      // Create success result
      const result = this.createSuccessResult(
        {
          result: output,           // PRIMARY field - matches StepExecutor and Stage 1 expectations
          response: output,         // Alias for compatibility
          output: output,           // Alias for compatibility
          generated: output,        // Keep for backwards compatibility
          quality,
          tokensGenerated: tokensUsed.output,
        },
        tokensUsed,
        cost,
        Date.now() - startTime,
        {
          model: context.routingDecision.model,
          provider: context.routingDecision.provider,
          temperature,
        }
      );

      result.quality = quality;

      this.logExecution(context, result, Date.now() - startTime);

      return result;
    } catch (error) {
      console.error('[GenerateHandler] Execution error:', error);
      return this.createErrorResult(error instanceof Error ? error : 'Unknown error');
    }
  }

  /**
   * Build system prompt for generation
   */
  private buildSystemPrompt(context: HandlerContext, outputSchema?: any): string {
    // When output_schema is present, use a structured-output prompt instead of generic content prompt
    if (outputSchema) {
      return this.buildStructuredOutputPrompt(outputSchema);
    }

    // Extract generation type from input
    const genType = this.extractGenerationType(context.input);

    const basePrompt = `You are a content generation specialist. Your task is to create high-quality ${genType} content.

INSTRUCTIONS:
- Create original, engaging content
- Follow any specific requirements or constraints provided
- Maintain consistency in tone and style
- Ensure accuracy and factual correctness
- Structure content logically and clearly`;

    // Add specific guidance based on generation type
    if (genType === 'report' || genType === 'document') {
      return basePrompt + `\n- Use professional formatting
- Include relevant sections and headings
- Provide clear conclusions or recommendations`;
    } else if (genType === 'code') {
      return basePrompt + `\n- Write clean, maintainable code
- Include comments for complex logic
- Follow best practices and conventions`;
    } else if (genType === 'creative') {
      return basePrompt + `\n- Be creative and original
- Engage the reader
- Use vivid language and imagery`;
    }

    return basePrompt;
  }

  /**
   * Build a structured-output system prompt when output_schema is present.
   * Instructs the LLM to return JSON matching the schema exactly.
   */
  private buildStructuredOutputPrompt(outputSchema: any): string {
    const schemaJson = JSON.stringify(outputSchema, null, 2);

    return `You are a data processing specialist. Your task is to process the provided input and return structured JSON data.

CRITICAL RULES:
- You MUST respond with ONLY valid JSON — no markdown, no code blocks, no explanation, no prose.
- Do NOT wrap your response in \`\`\`json or any code fence.
- Do NOT return code (JavaScript, Python, etc.) — return the actual DATA.
- Your response must be a single JSON object that matches the schema below exactly.

OUTPUT SCHEMA:
${schemaJson}

FIELD RULES:
${this.formatFieldRules(outputSchema)}
- Every field marked as required MUST be present in your response.
- Use the exact field names shown in the schema.
- Arrays must contain items of the specified type.
- If the schema specifies nested objects, include all their required fields.

Remember: respond with raw JSON only. No wrapping, no explanation.`;
  }

  /**
   * Format field-level rules from the output_schema for the prompt.
   */
  private formatFieldRules(schema: any): string {
    if (!schema?.fields && !schema?.properties) {
      return '- Follow the schema structure above.';
    }

    const fields = schema.fields || schema.properties || [];
    if (!Array.isArray(fields)) return '- Follow the schema structure above.';

    return fields.map((f: any) => {
      const req = f.required ? '(required)' : '(optional)';
      const desc = f.description ? ` — ${f.description}` : '';
      return `- "${f.name}": ${f.type} ${req}${desc}`;
    }).join('\n');
  }

  /**
   * Extract generation type from input
   */
  private extractGenerationType(input: any): string {
    const inputStr = this.safeStringify(input).toLowerCase();

    if (inputStr.includes('report') || inputStr.includes('analysis')) {
      return 'report';
    } else if (inputStr.includes('code') || inputStr.includes('function') || inputStr.includes('script')) {
      return 'code';
    } else if (inputStr.includes('story') || inputStr.includes('creative') || inputStr.includes('narrative')) {
      return 'creative';
    } else if (inputStr.includes('email') || inputStr.includes('message')) {
      return 'communication';
    } else if (inputStr.includes('document') || inputStr.includes('article')) {
      return 'document';
    }

    return 'general';
  }

  /**
   * Get temperature based on generation type
   */
  private getTemperature(context: HandlerContext): number {
    const inputStr = this.safeStringify(context.input).toLowerCase();

    // Lower temperature for technical/factual content
    if (inputStr.includes('code') || inputStr.includes('technical') || inputStr.includes('formal')) {
      return 0.3;
    }

    // Medium temperature for reports and documents
    if (inputStr.includes('report') || inputStr.includes('analysis') || inputStr.includes('document')) {
      return 0.5;
    }

    // Higher temperature for creative content
    if (inputStr.includes('creative') || inputStr.includes('story') || inputStr.includes('narrative')) {
      return 0.8;
    }

    // Default: moderate temperature
    return 0.7;
  }

  /**
   * Assess generation quality
   */
  private assessGenerationQuality(output: string, context: HandlerContext): number {
    // Simple heuristic-based quality assessment
    let quality = 0.8; // Base quality

    // Check length (too short or too long might indicate issues)
    const outputLength = output.length;
    if (outputLength < 50) {
      quality -= 0.2; // Too short
    } else if (outputLength > 10000) {
      quality -= 0.1; // Very long, might be verbose
    }

    // Check for structured content (headings, bullets, etc.)
    if (output.includes('\n\n') || output.includes('# ') || output.includes('- ')) {
      quality += 0.1; // Well-structured
    }

    // Check for code blocks if code generation
    const inputStr = this.safeStringify(context.input).toLowerCase();
    if (inputStr.includes('code')) {
      if (output.includes('```')) {
        quality += 0.1; // Proper code formatting
      }
    }

    return Math.max(0, Math.min(1, quality));
  }
}
