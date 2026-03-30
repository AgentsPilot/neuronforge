/**
 * LLM-based field mapping for document extraction
 *
 * This is used as a FINAL fallback when Textract has extracted data but
 * field names don't match what the user requested. A small/fast LLM reviews
 * the extracted text and key-value pairs and intelligently maps them to the
 * requested output schema.
 *
 * Benefits:
 * - Handles ANY document format without hardcoding
 * - Can understand semantic relationships (e.g., "Amount paid" = "total_amount")
 * - Cost-effective: Only processes structured data, not the full PDF
 * - Flexible: Works with user-defined schemas
 */

import { createLogger } from '@/lib/logger';
import { ProviderFactory } from '@/lib/ai/providerFactory';
import type { OutputSchema } from './types';

const logger = createLogger({ module: 'LLMFieldMapper' });

export interface LLMFieldMapperInput {
  /** Raw text extracted from document */
  text: string;
  /** Textract key-value pairs (if available) */
  keyValuePairs?: Array<{ key: string; value: string; confidence: number }>;
  /** User's requested output schema */
  outputSchema: OutputSchema;
  /** Already extracted fields (from deterministic strategies) */
  partiallyExtractedFields?: Record<string, any>;
}

export interface LLMFieldMapperResult {
  /** Successfully mapped fields */
  mappedFields: Record<string, string>;
  /** Fields that couldn't be mapped */
  unmappedFields: string[];
  /** Confidence in the mapping (0-1) */
  confidence: number;
}

export class LLMFieldMapper {
  /**
   * Use LLM to intelligently map extracted data to requested fields
   */
  async mapFields(input: LLMFieldMapperInput): Promise<LLMFieldMapperResult> {
    logger.info({
      requestedFields: input.outputSchema.fields.map(f => f.name),
      hasKeyValuePairs: !!input.keyValuePairs?.length,
      textLength: input.text?.length || 0,
    }, 'LLMFieldMapper: Starting intelligent field mapping');

    try {
      const provider = ProviderFactory.getProvider('anthropic'); // Use fast Haiku model

      const prompt = this.buildMappingPrompt(input);

      const response = await provider.chatCompletion({
        model: 'claude-haiku-4-5-20251001', // Fast and cost-effective (Claude 4.5 Haiku)
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        temperature: 0, // Deterministic
        max_tokens: 2000,
      }, {
        userId: 'system', // System-level extraction task
        feature: 'document-extraction',
        component: 'LLMFieldMapper',
      });

      const responseContent = response.choices?.[0]?.message?.content || '';
      const result = this.parseLLMResponse(responseContent, input.outputSchema);

      logger.info({
        mappedCount: Object.keys(result.mappedFields).length,
        unmappedCount: result.unmappedFields.length,
        confidence: result.confidence,
      }, 'LLMFieldMapper: Mapping complete');

      return result;

    } catch (error) {
      logger.error({ err: error }, 'LLMFieldMapper: Mapping failed');

      // Return empty result on error
      return {
        mappedFields: {},
        unmappedFields: input.outputSchema.fields.map(f => f.name),
        confidence: 0,
      };
    }
  }

  /**
   * Build the LLM prompt for field mapping
   */
  private buildMappingPrompt(input: LLMFieldMapperInput): string {
    const { text, keyValuePairs, outputSchema, partiallyExtractedFields } = input;

    let prompt = `You are a document data extraction assistant. Your task is to map extracted document data to the requested output fields.

# EXTRACTED DATA FROM DOCUMENT:

## Full Text (first 1500 characters):
\`\`\`
${text.substring(0, 1500)}
\`\`\`
`;

    if (keyValuePairs && keyValuePairs.length > 0) {
      prompt += `\n## Key-Value Pairs Extracted by OCR:\n`;
      keyValuePairs.forEach((kv, idx) => {
        prompt += `${idx + 1}. "${kv.key}" → "${kv.value}" (confidence: ${kv.confidence.toFixed(0)}%)\n`;
      });
    }

    if (partiallyExtractedFields && Object.keys(partiallyExtractedFields).length > 0) {
      prompt += `\n## Already Extracted Fields (from deterministic matching):\n`;
      Object.entries(partiallyExtractedFields).forEach(([key, value]) => {
        prompt += `- ${key}: "${value}"\n`;
      });
    }

    prompt += `\n# REQUESTED OUTPUT FIELDS:\n\n`;
    outputSchema.fields.forEach((field, idx) => {
      prompt += `${idx + 1}. Field Name: "${field.name}"\n`;
      prompt += `   Type: ${field.type}\n`;
      prompt += `   Description: ${field.description || '(none)'}\n`;
      prompt += `   Required: ${field.required ? 'yes' : 'no'}\n`;
      prompt += `\n`;
    });

    prompt += `# YOUR TASK:

1. Review the extracted data (text and key-value pairs)
2. For each requested field, find the BEST matching value from the extracted data
3. Use semantic understanding - for example:
   - "Amount paid" matches "total_amount"
   - Company name at top of document matches "vendor"
   - "Receipt date" matches "date"
4. ONLY return fields where you found a confident match
5. If a field was already extracted (listed above), SKIP it - don't override

# OUTPUT FORMAT:

Return ONLY a JSON object with this structure:
\`\`\`json
{
  "mapped_fields": {
    "field_name": "extracted_value",
    ...
  },
  "unmapped_fields": ["field_name", ...],
  "confidence": 0.85
}
\`\`\`

Rules:
- Only include fields you successfully mapped in "mapped_fields"
- List fields you couldn't find in "unmapped_fields"
- Confidence should be 0-1 (your overall confidence in the mappings)
- Return ONLY the JSON, no explanation or markdown

Begin:`;

    return prompt;
  }

  /**
   * Parse LLM response and extract mapped fields
   */
  private parseLLMResponse(content: string, outputSchema: OutputSchema): LLMFieldMapperResult {
    try {
      // Extract JSON from response (in case LLM added markdown code blocks)
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in LLM response');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      return {
        mappedFields: parsed.mapped_fields || {},
        unmappedFields: parsed.unmapped_fields || [],
        confidence: parsed.confidence || 0.5,
      };
    } catch (error) {
      logger.error({ err: error, content }, 'LLMFieldMapper: Failed to parse LLM response');

      return {
        mappedFields: {},
        unmappedFields: outputSchema.fields.map(f => f.name),
        confidence: 0,
      };
    }
  }
}
