/**
 * ExtractHandler
 *
 * Handler for data extraction intents
 * Optimized for extracting structured data from unstructured sources
 */

import { BaseHandler } from './BaseHandler';
import type { HandlerContext, HandlerResult, IntentType } from '../types';
import { getModelMaxOutputTokens, modelSupportsTemperature } from '@/lib/ai/context-limits';
import { jsonrepair } from 'jsonrepair';

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

      // Apply preprocessing to clean data and extract metadata
      const { data: cleanedData, metadata } = await this.applyPreprocessing(resolvedInput);

      // Prepare input for LLM
      const input = this.safeStringify(cleanedData);

      // Estimate token usage
      const inputTokens = this.estimateTokenCount(input);
      const estimatedTokens = inputTokens + 500; // Add buffer for output

      // TO FIX: Remove this development bypass once budget allocation is fixed
      // The budget system allocates too few tokens for extract intent (800 base)
      const isDevelopment = process.env.NODE_ENV === 'development';
      if (!isDevelopment && !this.checkBudget(context, estimatedTokens)) {
        return this.createErrorResult('Insufficient budget for extraction');
      }

      // Extract step's custom prompt if available (from ai_processing step config)
      const stepPrompt = context.input?.params?.prompt || context.input?.step?.prompt;
      console.log(`[ExtractHandler] Step prompt: ${stepPrompt ? `"${stepPrompt.substring(0, 200)}..."` : 'none (using default extraction)'}`);

      // Prepare prompts - use step's custom prompt if available
      const { system, user } = this.formatPrompt(
        this.buildSystemPrompt(stepPrompt),
        input,
        context
      );

      // Calculate dataset size for smart metadata filtering
      const dataSize = Array.isArray(cleanedData) ? cleanedData.length : 0;

      // Inject preprocessing metadata facts into user prompt
      const enrichedUser = this.injectPreprocessingFacts(user, metadata, dataSize);

      // Sanitize model name - remove any quotes that may have been added by JSON serialization
      const sanitizedModel = context.routingDecision.model
        .trim()
        .replace(/^["']|["']$/g, '');  // Remove leading/trailing quotes

      // Use the model's actual max output token limit
      console.log(`[ExtractHandler] Looking up max output tokens for model: "${sanitizedModel}" (raw: "${context.routingDecision.model}")`);
      const modelMaxOutputTokens = getModelMaxOutputTokens(sanitizedModel);

      // TO FIX: Remove this development bypass once budget allocation is fixed
      // The budget system allocates too few tokens for extract intent (800 base),
      // causing truncation when processing arrays. Need to either:
      // 1. Increase default extract budget, or
      // 2. Make budget allocation consider input data size
      const isDev = process.env.NODE_ENV === 'development';
      const maxTokens = isDev
        ? modelMaxOutputTokens
        : Math.min(context.budget.remaining, modelMaxOutputTokens);

      console.log(`[ExtractHandler] max_tokens: model=${sanitizedModel}, modelMax=${modelMaxOutputTokens}, budget=${context.budget.remaining}, isDev=${isDev}, final=${maxTokens}`);

      // Check if model supports custom temperature
      const supportsTemp = modelSupportsTemperature(sanitizedModel);
      const temperature = supportsTemp ? 0.3 : undefined; // Use 0.3 for consistent extraction, or undefined for models that don't support it

      if (!supportsTemp) {
        console.warn(`⚠️ [ExtractHandler] Model "${sanitizedModel}" does not support custom temperature. Using model default. Consider using a different model for better extraction control.`);
      }
      console.log(`[ExtractHandler] temperature: model=${sanitizedModel}, supportsTemperature=${supportsTemp}, using=${temperature ?? 'default'}`);

      // Log what we're sending to the LLM
      console.log(`[ExtractHandler] Calling LLM with:\n--- CONTEXT ---\nModel: ${context.routingDecision.model}\nProvider: ${context.routingDecision.provider}\nTemperature: ${temperature ?? 'default'}\nMax Tokens: ${maxTokens}\nBudget Remaining: ${context.budget.remaining}\n--- SYSTEM PROMPT ---\n${system}\n--- USER PROMPT ---\n${enrichedUser}\n--- END PROMPTS ---`);

      // Execute extraction using provider-agnostic method
      const llmResponse = await this.callLLM(
        context,
        system,
        enrichedUser, // Use enriched prompt with metadata facts
        temperature, // Lower temperature for more consistent extraction (if supported)
        maxTokens
      );

      // Parse response
      const output = llmResponse.text;

      // Log raw LLM response for debugging ai_processing transforms
      console.log(`[ExtractHandler] Raw LLM response:\n${output}`);

      // Calculate actual token usage
      const tokensUsed = {
        input: llmResponse.inputTokens,
        output: llmResponse.outputTokens,
      };

      // Use cost from provider
      const cost = llmResponse.cost;

      // Get declared output key from step outputs (e.g., "rows" from outputs: { rows: {...} })
      // This allows us to use the correct key name instead of always using "items"
      const stepOutputs = context.input?.step?.outputs || {};
      const declaredOutputKey = Object.keys(stepOutputs)
        .find(k => k !== 'next_step' && k !== 'is_last_step');

      // Create success result
      const result = this.createSuccessResult(
        this.parseExtractedData(output, declaredOutputKey),
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
    } catch (error) {
      console.error('[ExtractHandler] Execution error:', error);
      return this.createErrorResult(error instanceof Error ? error : 'Unknown error');
    }
  }

  /**
   * Build system prompt for extraction
   * @param stepPrompt - Optional custom prompt from the ai_processing step configuration
   */
  private buildSystemPrompt(stepPrompt?: string): string {
    const basePrompt = `You are a data extraction and transformation specialist. Your task is to process the provided content according to the instructions.`;

    // If step has custom prompt, use it as the primary instructions
    if (stepPrompt) {
      return `${basePrompt}

TASK:
${stepPrompt}

IMPORTANT:
- Process ALL items in the input array
- For each item, preserve all original fields AND add any computed fields specified in the task
- Return data as valid JSON with an "items" array containing all processed items
- Do not skip any items from the input

OUTPUT FORMAT:
Return ONLY valid JSON. No explanations, no markdown code blocks, just the raw JSON.
Example: {"items": [{...all original fields plus computed fields...}, ...]}`;
    }

    // Default extraction prompt (for steps without custom prompt)
    return `${basePrompt}

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
   *
   * Handles multiple JSON formats:
   * 1. Object with "items" array: {"items": [...]} - standard array output
   * 2. Object with "result": {"result": ...} - standard single output
   * 3. Raw JSON array: [...] - legacy/direct array output
   * 4. Raw JSON object: {...} - legacy/direct object output
   *
   * @param output - Raw LLM output string
   * @param declaredOutputKey - Optional output key declared in step's outputs (e.g., "rows")
   */
  private parseExtractedData(output: string, declaredOutputKey?: string): any {
    try {
      // First, try to parse the entire output as JSON (handles clean LLM responses)
      const trimmed = output.trim();

      // Check if it starts with { or [ (valid JSON start)
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          const parsed = JSON.parse(trimmed);
          return this.normalizeExtractedObject(parsed, declaredOutputKey);
        } catch (directParseError) {
          // Direct parse failed, try to repair malformed JSON
          try {
            console.log('[ExtractHandler] JSON parse failed, attempting repair with jsonrepair');
            const repairedJson = jsonrepair(trimmed);
            const parsed = JSON.parse(repairedJson);
            console.log('[ExtractHandler] JSON repaired successfully');
            return this.normalizeExtractedObject(parsed, declaredOutputKey);
          } catch (repairError) {
            // Repair failed, continue with extraction methods below
            console.warn('[ExtractHandler] JSON repair failed:', repairError);
          }
        }
      }

      // Try to extract JSON object from text (handles markdown code blocks, etc.)
      const jsonObjectMatch = output.match(/\{[\s\S]*\}/);
      if (jsonObjectMatch) {
        try {
          const parsed = JSON.parse(jsonObjectMatch[0]);
          return this.normalizeExtractedObject(parsed, declaredOutputKey);
        } catch (extractParseError) {
          // Try to repair extracted JSON
          try {
            console.log('[ExtractHandler] Extracted JSON parse failed, attempting repair');
            const repairedJson = jsonrepair(jsonObjectMatch[0]);
            const parsed = JSON.parse(repairedJson);
            console.log('[ExtractHandler] Extracted JSON repaired successfully');
            return this.normalizeExtractedObject(parsed, declaredOutputKey);
          } catch (repairError) {
            console.warn('[ExtractHandler] Extracted JSON repair failed:', repairError);
          }
        }
      }

      // Try to extract JSON array from text
      const jsonArrayMatch = output.match(/\[[\s\S]*\]/);
      if (jsonArrayMatch) {
        try {
          const parsed = JSON.parse(jsonArrayMatch[0]);
          // Wrap array using declared key (or "items" as fallback)
          return this.normalizeExtractedObject(parsed, declaredOutputKey);
        } catch (arrayParseError) {
          // Try to repair extracted array
          try {
            console.log('[ExtractHandler] Extracted array parse failed, attempting repair');
            const repairedJson = jsonrepair(jsonArrayMatch[0]);
            const parsed = JSON.parse(repairedJson);
            console.log('[ExtractHandler] Extracted array repaired successfully');
            return this.normalizeExtractedObject(parsed, declaredOutputKey);
          } catch (repairError) {
            console.warn('[ExtractHandler] Extracted array repair failed:', repairError);
          }
        }
      }

      // If not JSON, return as structured text
      console.warn('[ExtractHandler] No JSON found in output, returning raw text');
      return {
        raw: output,
        format: 'text',
      };
    } catch (error) {
      console.warn('[ExtractHandler] Failed to parse JSON, returning raw output:', error);
      return {
        raw: output,
        format: 'text',
        parseError: true,
      };
    }
  }

  /**
   * Normalize extracted object to ensure consistent structure
   *
   * Handles various LLM output formats:
   * 1. {"items": [...]} - standard array output, return as-is (with declared key alias if provided)
   * 2. {"result": ...} - standard single output, return as-is
   * 3. [...] - raw array, wrap using declared key (or "items" as fallback)
   * 4. {"some_key": [...]} - object with array property, add declared key alias if different
   * 5. Other objects - return as-is (might have multiple properties)
   *
   * @param parsed - Parsed JSON object or array from LLM
   * @param declaredOutputKey - Optional output key declared in step's outputs (e.g., "rows")
   */
  private normalizeExtractedObject(parsed: any, declaredOutputKey?: string): any {
    // Log the structure of what LLM returned
    const keys = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.keys(parsed) : [];
    console.log(`[ExtractHandler] LLM returned object with keys: [${keys.join(', ')}]`);
    console.log(`[ExtractHandler] Declared output key: ${declaredOutputKey || '(none)'}`);
    console.log(`[ExtractHandler] LLM response structure:`, JSON.stringify(parsed, null, 2).substring(0, 1000));

    // If it's already in our expected format with 'items' or 'result', add declared key alias if needed
    if (parsed && typeof parsed === 'object' && ('items' in parsed || 'result' in parsed)) {
      console.log('[ExtractHandler] Output already has items/result key');
      // Add declared key alias if it's different from existing keys
      if (declaredOutputKey && !(declaredOutputKey in parsed)) {
        const arrayValue = parsed.items || parsed.result;
        if (Array.isArray(arrayValue)) {
          console.log(`[ExtractHandler] Adding declared key '${declaredOutputKey}' as alias`);
          return { ...parsed, [declaredOutputKey]: arrayValue };
        }
      }
      return parsed;
    }

    // If it's a raw array, wrap it using declared key (with items alias for backward compatibility)
    if (Array.isArray(parsed)) {
      if (declaredOutputKey) {
        console.log(`[ExtractHandler] Wrapping raw array in {${declaredOutputKey}: [...], items: [...]}`);
        return { [declaredOutputKey]: parsed, items: parsed };
      } else {
        console.log('[ExtractHandler] Wrapping raw array in {items: [...]}');
        return { items: parsed };
      }
    }

    // Find the first array property, regardless of how many keys exist
    // This handles cases where LLM returns {"emails": [...], "metadata": {...}}
    // Preserve the original key name AND add 'items' alias for backward compatibility
    if (parsed && typeof parsed === 'object') {
      const keys = Object.keys(parsed);
      for (const key of keys) {
        if (Array.isArray(parsed[key])) {
          console.log(`[ExtractHandler] Found array in property '${key}', preserving key and adding 'items' alias`);
          // Return object with original key, items alias, AND declared key alias if different
          const result: any = { [key]: parsed[key], items: parsed[key] };
          if (declaredOutputKey && declaredOutputKey !== key) {
            console.log(`[ExtractHandler] Also adding declared key '${declaredOutputKey}' as alias`);
            result[declaredOutputKey] = parsed[key];
          }
          return result;
        }
      }
    }

    // Return object as-is if no array property found
    console.log('[ExtractHandler] Returning object as-is (no array property found)');
    return parsed;
  }
}
