/**
 * ExtractHandler
 *
 * Handler for data extraction intents
 * Optimized for extracting structured data from unstructured sources
 *
 * Supports:
 * - Text extraction from structured/unstructured data
 * - Vision extraction from images (PDFs, receipts, photos) via GPT-4o vision
 */

import { BaseHandler } from './BaseHandler';
import type { HandlerContext, HandlerResult, IntentType } from '../types';
import { VisionContentBuilder } from '@/lib/pilot/utils/VisionContentBuilder';

export class ExtractHandler extends BaseHandler {
  intent: IntentType = 'extract';

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

      // Check if input contains images for vision mode
      const hasImages = VisionContentBuilder.hasImageContent(resolvedInput);

      if (hasImages) {
        // Vision mode: Extract from images using GPT-4o vision
        return await this.handleVisionExtraction(context, resolvedInput, startTime);
      }

      // Standard text extraction mode
      return await this.handleTextExtraction(context, resolvedInput, startTime);

    } catch (error) {
      console.error('[ExtractHandler] Execution error:', error);
      return this.createErrorResult(error instanceof Error ? error : 'Unknown error');
    }
  }

  /**
   * Handle standard text-based extraction
   */
  private async handleTextExtraction(
    context: HandlerContext,
    resolvedInput: any,
    startTime: number
  ): Promise<HandlerResult> {
    // Apply preprocessing to clean data and extract metadata
    const { data: cleanedData, metadata } = await this.applyPreprocessing(resolvedInput);

    // Prepare input for LLM
    const input = this.safeStringify(cleanedData);

    // Estimate token usage
    const inputTokens = this.estimateTokenCount(input);
    const estimatedTokens = inputTokens + 500; // Add buffer for output
    if (!this.checkBudget(context, estimatedTokens)) {
      return this.createErrorResult('Insufficient budget for extraction');
    }

    // Prepare prompts
    const { system, user } = this.formatPrompt(
      this.buildSystemPrompt(),
      input,
      context
    );

    // Calculate dataset size for smart metadata filtering
    const dataSize = Array.isArray(cleanedData) ? cleanedData.length : 0;

    // Inject preprocessing metadata facts into user prompt
    const enrichedUser = this.injectPreprocessingFacts(user, metadata, dataSize);

    // Execute extraction using provider-agnostic method
    const llmResponse = await this.callLLM(
      context,
      system,
      enrichedUser, // Use enriched prompt with metadata facts
      0.3, // Lower temperature for more consistent extraction
      Math.min(context.budget.remaining, context.routingDecision.estimatedLatency > 3000 ? 2048 : 1024)
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

    // Create success result
    const result = this.createSuccessResult(
      this.parseExtractedData(output),
      tokensUsed,
      cost,
      Date.now() - startTime,
      {
        model: context.routingDecision.model,
        provider: context.routingDecision.provider,
      }
    );

    this.logExecution(context, result, Date.now() - startTime);

    return result;
  }

  /**
   * Handle vision-based extraction (images, PDFs)
   * Uses GPT-4o vision capabilities for document analysis
   */
  private async handleVisionExtraction(
    context: HandlerContext,
    resolvedInput: any,
    startTime: number
  ): Promise<HandlerResult> {
    console.log('[ExtractHandler] Vision mode: Extracting from images');

    // Extract images and metadata (use async version for PDF conversion support)
    const imageContent = await VisionContentBuilder.extractImageContentAsync(resolvedInput);
    const textData = VisionContentBuilder.extractNonImageData(resolvedInput);

    console.log(`[ExtractHandler] Found ${imageContent.length} image(s) for vision extraction`);

    // Build vision-specific system prompt
    const systemPrompt = this.buildVisionSystemPrompt();

    // Build user prompt with metadata
    const userTextPrompt = `
Extract structured data from the image(s) provided.

## Item Metadata:
${this.safeStringify(textData)}

## Extraction Instructions:
${context.input?.step?.prompt || context.input?.step?.description || 'Extract all relevant information'}

Return the extracted data as valid JSON.
    `.trim();

    // Build multimodal content
    const visionContent = VisionContentBuilder.buildVisionContent(userTextPrompt, imageContent, 'high');

    // Execute vision extraction
    const llmResponse = await this.callLLM(
      context,
      systemPrompt,
      visionContent,  // Multimodal content array
      0.2, // Lower temperature for accurate extraction
      Math.min(context.budget.remaining, 4096)  // Vision needs more tokens
    );

    // Parse response
    const output = llmResponse.text;

    // Calculate actual token usage
    const tokensUsed = {
      input: llmResponse.inputTokens,
      output: llmResponse.outputTokens,
    };

    // Create success result
    const result = this.createSuccessResult(
      this.parseExtractedData(output),
      tokensUsed,
      llmResponse.cost,
      Date.now() - startTime,
      {
        model: context.routingDecision.model,
        provider: context.routingDecision.provider,
        visionMode: true,
        imageCount: imageContent.length,
      }
    );

    this.logExecution(context, result, Date.now() - startTime);

    return result;
  }

  /**
   * Build system prompt for vision extraction
   */
  private buildVisionSystemPrompt(): string {
    return `You are a document analysis specialist with vision capabilities.
Your task is to extract structured information from images of documents, receipts, invoices, etc.

INSTRUCTIONS:
- Carefully analyze the image(s) provided
- Extract all relevant data points visible in the image
- For receipts/invoices: extract date, vendor, amounts, line items
- Maintain accuracy - only extract what you can clearly see
- Use "need review" for any values that are unclear or ambiguous
- Return data in structured JSON format

OUTPUT FORMAT:
Return extracted data as valid JSON with clear field names.
For uncertain values, use the literal string "need review".`;
  }

  /**
   * Build system prompt for text extraction
   */
  private buildSystemPrompt(): string {
    return `You are a data extraction specialist. Your task is to extract structured information from the provided content.

INSTRUCTIONS:
- Extract all relevant data points
- Maintain accuracy and precision
- Return data in a structured format (JSON preferred)
- If data is unclear or missing, indicate with null values
- Do not infer or guess data that is not present

OUTPUT FORMAT:
Return extracted data as valid JSON with clear field names.`;
  }

  /**
   * Parse extracted data from LLM response
   */
  private parseExtractedData(output: string): any {
    try {
      // Try to parse as JSON first
      const jsonMatch = output.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }

      // If not JSON, return as structured text
      return {
        raw: output,
        format: 'text',
      };
    } catch (error) {
      console.warn('[ExtractHandler] Failed to parse JSON, returning raw output');
      return {
        raw: output,
        format: 'text',
        parseError: true,
      };
    }
  }
}
