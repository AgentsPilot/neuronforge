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

    let prompt = `You are an intelligent document data extraction assistant. Your task is to map extracted data to the user's requested fields.

# EXTRACTED DATA (from AWS Textract OCR):
`;

    if (keyValuePairs && keyValuePairs.length > 0) {
      prompt += `\n## Key-Value Pairs (labeled fields found by Textract):\n`;
      keyValuePairs.forEach((kv, idx) => {
        prompt += `${idx + 1}. "${kv.key}" → "${kv.value}"\n`;
      });
    }

    if (text && text.trim()) {
      prompt += `\n## Full Document Text (from Textract OCR - search here if field not in key-value pairs):\n\`\`\`\n${text.substring(0, 1500)}\n\`\`\`\n`;
    }

    if (!keyValuePairs?.length && !text?.trim()) {
      prompt += `\n(No structured data available - cannot extract)\n`;
    }

    if (partiallyExtractedFields && Object.keys(partiallyExtractedFields).length > 0) {
      prompt += `\n## Already Extracted Fields:\n`;
      Object.entries(partiallyExtractedFields).forEach(([key, value]) => {
        prompt += `- ${key}: "${value}"\n`;
      });
    }

    prompt += `\n# WHAT THE USER WANTS TO EXTRACT:\n\n`;
    outputSchema.fields.forEach((field, idx) => {
      prompt += `${idx + 1}. **${field.name}** (${field.type}${field.required ? ', REQUIRED' : ''})\n`;
      if (field.description) {
        prompt += `   User's description: "${field.description}"\n`;
      }
      prompt += `\n`;
    });

    prompt += `# YOUR TASK:

Map the extracted data to the user's requested fields using intelligent matching.

**Mapping Rules:**

1. **Try key-value pairs first** (most reliable):
   - Look for exact or semantic matches to the user's field descriptions
   - Example: Field "vendor" with description "Company name" → Look for keys like "Company", "Seller", "From"

2. **If not in key-value pairs, search the full document text**:
   - For fields like company names, vendor names, addresses that may appear unlabeled
   - Look for capitalized text, company suffixes (INC, LLC, Corp), contextual placement

3. **Match field types correctly**:
   - date fields need date values (e.g., "17-Mar-2026", "March 16, 2026")
   - string fields need text values (e.g., company names, invoice numbers)
   - number fields need numeric values (e.g., 50.00)

4. **Semantic understanding**:
   - "Amount paid" = "total_amount" = "amount" = "invoice total"
   - "Invoice #" = "invoice_number" = "receipt number"
   - Currency codes: If you see "$" → USD, "€" → EUR, "£" → GBP

5. **If a field was already extracted, SKIP it** (don't re-extract)

# OUTPUT FORMAT:

Return ONLY a valid JSON object:
\`\`\`json
{
  "mapped_fields": {
    "field_name": "exact_value_from_document"
  },
  "unmapped_fields": ["field_name"],
  "confidence": 0.95
}
\`\`\`

**Output Rules:**
- Map ONLY from the provided key-value pairs (do NOT invent data)
- Match field types correctly
- Clean values (remove labels, extra punctuation)
- Confidence 0-1 (be honest about certainty)
- Return ONLY the JSON, no markdown or explanation

Map the fields now:`;

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
