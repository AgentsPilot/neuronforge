/**
 * SchemaFieldExtractor
 *
 * Schema-driven field extraction that works across all file types.
 * No document-type-specific logic - extracts based solely on output_schema.
 *
 * Extraction strategies (in order of priority):
 * 1. Structured data (CSV/Excel columns) → Direct column mapping
 * 2. Textract key-value pairs → Match keys to schema field names
 * 3. Generic pattern matching → "FieldName: value" patterns
 * 4. Common patterns → Dates, amounts, emails, etc.
 * 5. LLM-based intelligent mapping → Semantic understanding as final fallback
 */

import { createLogger } from '@/lib/logger';
import { LLMFieldMapper } from './LLMFieldMapper';
import type {
  ExtractedField,
  OutputSchema,
  OutputSchemaField,
} from './types';

const logger = createLogger({ module: 'SchemaFieldExtractor', service: 'extraction' });

// Universal format patterns - ONLY for validating field types
// These patterns are used ONLY when the schema explicitly sets type: 'date' or type: 'number'
const UNIVERSAL_FORMAT_PATTERNS: Record<string, RegExp[]> = {
  // Date format patterns - used when schema type is 'date'
  date: [
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/i,
    /\b(\d{4}-\d{2}-\d{2})\b/,
    /\b(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})\b/,
    /\b(\d{1,2}[-\/]\w{3}[-\/]\d{4})\b/i,  // 17-Mar-2026
  ],
  // Number format patterns - used when schema type is 'number'
  number: [
    /\b(\d+[,\d]*\.?\d+)\b/,
  ],
};

export interface SchemaExtractionResult {
  success: boolean;
  data: Record<string, any>;
  fields: Record<string, ExtractedField>;
  confidence: number;
  missingFields: string[];
  uncertainFields: string[];
}

export interface ExtractionInput {
  text: string;
  structuredData?: Record<string, any>[] | Record<string, any>;
  keyValuePairs?: Array<{ key: string; value: string; confidence: number }>;
  tables?: Array<{ rows: string[][]; confidence: number }>;
  inputContext?: Record<string, any>; // Pass-through fields from workflow input
}

export class SchemaFieldExtractor {
  /**
   * Extract fields based on output_schema
   */
  async extract(input: ExtractionInput, outputSchema: OutputSchema): Promise<SchemaExtractionResult> {
    const startTime = Date.now();
    const fields: Record<string, ExtractedField> = {};
    const data: Record<string, any> = {};
    const missingFields: string[] = [];
    const uncertainFields: string[] = [];

    // Track which key-value pairs have been used to prevent reuse
    const usedKeyValuePairs = new Set<string>();

    logger.info({
      schemaFields: outputSchema.fields.map(f => f.name),
      hasStructuredData: !!input.structuredData,
      hasKeyValuePairs: !!input.keyValuePairs?.length,
      hasTables: !!input.tables?.length,
      hasInputContext: !!input.inputContext,
      textLength: input.text?.length || 0,
    }, 'SchemaFieldExtractor: Starting schema-driven extraction');

    for (const schemaField of outputSchema.fields) {
      let extracted: ExtractedField | null = null;

      // Strategy 1: Check input context for pass-through fields
      if (input.inputContext && schemaField.name in input.inputContext) {
        const value = input.inputContext[schemaField.name];
        extracted = {
          name: schemaField.name,
          value,
          confidence: 1.0,
          source: 'input_context',
        };
      }

      // Strategy 2: Check structured data (CSV/Excel)
      if (!extracted && input.structuredData) {
        extracted = this.extractFromStructuredData(schemaField, input.structuredData);
      }

      // Strategy 3: Check Textract key-value pairs (with reuse prevention)
      // This is the PRIMARY extraction method - Textract labels are the most reliable
      if (!extracted && input.keyValuePairs?.length) {
        // Filter out already-used key-value pairs
        const availableKvPairs = input.keyValuePairs.filter(kv =>
          !usedKeyValuePairs.has(`${kv.key}:${kv.value}`)
        );

        extracted = this.extractFromKeyValuePairs(schemaField, availableKvPairs);

        // Mark this key-value pair as used
        if (extracted && extracted.source === 'textract_kv' && extracted.rawMatch) {
          usedKeyValuePairs.add(extracted.rawMatch);
        }
      }

      // Strategy 4: Check tables for array fields
      if (!extracted && schemaField.type === 'array' && input.tables?.length) {
        extracted = this.extractFromTables(schemaField, input.tables);
      }

      // Strategy 4.5: Check tables for string fields (generic approach)
      if (!extracted && input.tables?.length && schemaField.type === 'string') {
        extracted = this.extractFromTableCells(schemaField, input.tables);
      }

      // Strategy 5: Generic text pattern matching
      if (!extracted && input.text) {
        extracted = this.extractFromText(schemaField, input.text);
      }

      // Store result
      if (extracted) {
        fields[schemaField.name] = extracted;
        data[schemaField.name] = extracted.value;

        if (extracted.confidence < 0.5) {
          uncertainFields.push(schemaField.name);
        }
      } else {
        data[schemaField.name] = null;
        // Add ALL missing fields (required AND optional) to trigger LLM fallback
        // The LLM might be able to infer optional fields from context
        missingFields.push(schemaField.name);
      }
    }

    // Post-extraction validation: Re-check extracted values for validity
    // This catches cases where Tier 1 (PDF) extracted invalid data that Tier 2 (Textract) couldn't improve
    for (const schemaField of outputSchema.fields) {
      const extractedValue = data[schemaField.name];
      if (extractedValue !== null && !this.isValueValidForField(String(extractedValue), schemaField)) {
        // Value is invalid - mark as missing so LLM can fix it
        data[schemaField.name] = null;
        delete fields[schemaField.name];
        if (!missingFields.includes(schemaField.name)) {
          missingFields.push(schemaField.name);
        }
      }
    }

    // Add uncertain fields to missing fields so LLM can re-evaluate them
    // When there are ambiguous matches (e.g., "Specials Total" vs "Grocery Total Due"),
    // the LLM can intelligently choose the correct one
    for (const uncertainField of uncertainFields) {
      if (!missingFields.includes(uncertainField)) {
        missingFields.push(uncertainField);
      }
    }

    // Strategy 6: LLM-based intelligent mapping (FINAL FALLBACK)
    // Use if we have missing fields AND (Textract data OR PDF text is available)
    // This ensures proper tier ordering: PDF → Textract → LLM
    // LLM can work with either Textract's structured data OR raw PDF text when Textract fails
    if (missingFields.length > 0 && (input.keyValuePairs?.length || input.text?.trim())) {
      logger.info({
        missingFieldsCount: missingFields.length,
        hasKeyValuePairs: !!input.keyValuePairs?.length,
      }, 'SchemaFieldExtractor: Triggering LLM fallback for missing fields (after Textract)');

      try {
        const llmMapper = new LLMFieldMapper();

        // Only pass successfully extracted fields (filter out nulls)
        const successfullyExtractedFields = Object.fromEntries(
          Object.entries(data).filter(([_, value]) => value !== null)
        );

        // Create a schema with ONLY the missing fields
        // This prevents the LLM from re-extracting fields we already have
        const missingFieldsSchema = {
          fields: outputSchema.fields.filter(f => missingFields.includes(f.name))
        };

        const llmResult = await llmMapper.mapFields({
          text: input.text || '', // Pass Textract OCR text so LLM can find unlabeled data
          keyValuePairs: input.keyValuePairs,
          outputSchema: missingFieldsSchema,
          partiallyExtractedFields: successfullyExtractedFields,
        });

        // Apply LLM-mapped fields (only for currently missing fields)
        for (const [fieldName, value] of Object.entries(llmResult.mappedFields)) {
          if (missingFields.includes(fieldName) && value) {
            fields[fieldName] = {
              name: fieldName,
              value: value,
              confidence: llmResult.confidence,
              source: 'llm_mapping',
            };
            data[fieldName] = value;

            // Remove from missing fields
            const index = missingFields.indexOf(fieldName);
            if (index > -1) {
              missingFields.splice(index, 1);
            }
          }
        }

        logger.info({
          mappedByLLM: Object.keys(llmResult.mappedFields).length,
          remainingMissing: missingFields.length,
        }, 'SchemaFieldExtractor: LLM fallback complete');

      } catch (error) {
        logger.error({ err: error }, 'SchemaFieldExtractor: LLM fallback failed (non-blocking)');
      }
    }

    // Calculate overall confidence
    const extractedCount = Object.values(fields).filter(f => f.value !== null).length;
    const totalFields = outputSchema.fields.length;
    const avgConfidence = extractedCount > 0
      ? Object.values(fields).reduce((sum, f) => sum + f.confidence, 0) / extractedCount
      : 0;
    const confidence = totalFields > 0
      ? (extractedCount / totalFields) * avgConfidence
      : 0;

    const processingTime = Date.now() - startTime;

    logger.info({
      extractedCount,
      totalFields,
      confidence,
      missingFields,
      uncertainFields,
      processingTimeMs: processingTime,
    }, 'SchemaFieldExtractor: Extraction complete');

    return {
      success: extractedCount > 0,
      data,
      fields,
      confidence,
      missingFields,
      uncertainFields,
    };
  }

  /**
   * Extract field from structured data (CSV/Excel rows)
   */
  private extractFromStructuredData(
    schemaField: OutputSchemaField,
    structuredData: Record<string, any>[] | Record<string, any>
  ): ExtractedField | null {
    const variations = this.getFieldNameVariations(schemaField);

    // Handle array of objects (CSV rows)
    if (Array.isArray(structuredData)) {
      // For array type fields, return the whole column
      if (schemaField.type === 'array' && structuredData.length > 0) {
        const firstRow = structuredData[0];
        for (const variation of variations) {
          const matchingKey = Object.keys(firstRow).find(
            k => k.toLowerCase() === variation.toLowerCase()
          );
          if (matchingKey) {
            return {
              name: schemaField.name,
              value: structuredData.map(row => row[matchingKey]),
              confidence: 0.95,
              source: 'structured_data',
            };
          }
        }
      }

      // For single value, take from first row
      if (structuredData.length > 0) {
        const firstRow = structuredData[0];
        for (const variation of variations) {
          const matchingKey = Object.keys(firstRow).find(
            k => k.toLowerCase() === variation.toLowerCase()
          );
          if (matchingKey && firstRow[matchingKey] !== undefined) {
            return {
              name: schemaField.name,
              value: firstRow[matchingKey],
              confidence: 0.95,
              source: 'structured_data',
            };
          }
        }
      }
    } else {
      // Single object
      for (const variation of variations) {
        const matchingKey = Object.keys(structuredData).find(
          k => k.toLowerCase() === variation.toLowerCase()
        );
        if (matchingKey && structuredData[matchingKey] !== undefined) {
          return {
            name: schemaField.name,
            value: structuredData[matchingKey],
            confidence: 0.95,
            source: 'structured_data',
          };
        }
      }
    }

    return null;
  }

  /**
   * Extract field from Textract key-value pairs
   */
  private extractFromKeyValuePairs(
    schemaField: OutputSchemaField,
    keyValuePairs: Array<{ key: string; value: string; confidence: number }>
  ): ExtractedField | null {
    const variations = this.getFieldNameVariations(schemaField);

    // Sort variations by length (longest first) to prioritize more specific matches
    // Example: "amount due" should be checked before "amount"
    const sortedVariations = variations.sort((a, b) => b.length - a.length);

    // Collect ALL potential matches (exact and partial) instead of returning first match
    const allMatches: Array<{ kv: typeof keyValuePairs[0], matchScore: number, isExact: boolean }> = [];

    // First pass: Find exact matches
    for (const variation of sortedVariations) {
      const normalizedVariation = this.normalizeKey(variation);

      const exactMatches = keyValuePairs.filter(
        kv => this.normalizeKey(kv.key) === normalizedVariation
      );

      exactMatches.forEach(kv => {
        allMatches.push({
          kv,
          matchScore: normalizedVariation.length, // Longer variations score higher
          isExact: true
        });
      });
    }

    // Second pass: Find partial matches if no exact match found
    if (allMatches.length === 0) {
      for (const variation of sortedVariations) {
        const normalizedVariation = this.normalizeKey(variation);

        // Avoid matching when variation is too short
        if (normalizedVariation.length < 4) continue;

        const partialMatches = keyValuePairs.filter(kv => {
          const normalizedKey = this.normalizeKey(kv.key);

          // Check if the variation is at the start of the key
          if (normalizedKey.startsWith(normalizedVariation)) return true;

          // Check if the variation is at the end of the key
          if (normalizedKey.endsWith(normalizedVariation)) return true;

          // Check if the key is at the start of the variation
          if (normalizedVariation.startsWith(normalizedKey) && normalizedKey.length >= 4) return true;

          return false;
        });

        partialMatches.forEach(kv => {
          // Validate that the extracted value makes sense for this field
          if (this.isValueValidForField(kv.value, schemaField)) {
            // Score based on how many description keywords the key contains
            const keyLower = kv.key.toLowerCase();
            const descWords = (schemaField.description || '').toLowerCase().split(/\s+/);
            const matchingWords = descWords.filter(word =>
              word.length > 2 && keyLower.includes(word)
            ).length;

            allMatches.push({
              kv,
              matchScore: matchingWords, // More description keywords = higher score
              isExact: false
            });
          }
        });
      }
    }

    // No matches found
    if (allMatches.length === 0) return null;

    // Sort by score (highest first), then by exact match, then by Textract confidence
    allMatches.sort((a, b) => {
      if (a.matchScore !== b.matchScore) return b.matchScore - a.matchScore;
      if (a.isExact !== b.isExact) return a.isExact ? -1 : 1;
      return b.kv.confidence - a.kv.confidence;
    });

    // Pick the best match
    const bestMatch = allMatches[0];

    // Special handling: Extract currency code from amount values
    let extractedValue = bestMatch.kv.value.trim();
    if (this.isCurrencyCodeField(schemaField)) {
      const currencyCode = this.extractCurrencyCode(extractedValue);
      if (currencyCode) {
        extractedValue = currencyCode;
      }
    }

    // If there are multiple similar matches, reduce confidence so LLM can re-evaluate
    const hasCompetingMatches = allMatches.length > 1 &&
      allMatches[0].matchScore === allMatches[1].matchScore;

    const confidenceMultiplier = bestMatch.isExact ? 1.0 : 0.8;
    const finalConfidence = hasCompetingMatches
      ? (bestMatch.kv.confidence / 100) * confidenceMultiplier * 0.4  // Very low confidence if ambiguous
      : (bestMatch.kv.confidence / 100) * confidenceMultiplier;

    return {
      name: schemaField.name,
      value: extractedValue,
      confidence: finalConfidence,
      source: 'textract_kv',
      rawMatch: `${bestMatch.kv.key}: ${bestMatch.kv.value}`,
    };
  }

  /**
   * Extract array field from tables
   */
  private extractFromTables(
    schemaField: OutputSchemaField,
    tables: Array<{ rows: string[][]; confidence: number }>
  ): ExtractedField | null {
    // For array fields, try to extract rows from tables
    if (tables.length === 0) return null;

    const table = tables[0]; // Use first table
    if (table.rows.length < 2) return null; // Need header + at least one data row

    // Try to convert table to array of objects using first row as headers
    const headers = table.rows[0];
    const dataRows = table.rows.slice(1);

    const items = dataRows.map(row => {
      const item: Record<string, string> = {};
      headers.forEach((header, idx) => {
        if (row[idx] !== undefined) {
          item[header] = row[idx];
        }
      });
      return item;
    });

    if (items.length > 0) {
      return {
        name: schemaField.name,
        value: items,
        confidence: table.confidence / 100,
        source: 'textract_table',
      };
    }

    return null;
  }

  /**
   * Extract field value from table cells (generic, works for any field type)
   * Searches all table cells for values matching field name variations
   */
  private extractFromTableCells(
    schemaField: OutputSchemaField,
    tables: Array<{ rows: string[][]; confidence: number }>
  ): ExtractedField | null {
    const variations = this.getFieldNameVariations(schemaField);

    // Search through all tables
    for (const table of tables) {
      // Search through all cells
      for (let rowIdx = 0; rowIdx < table.rows.length; rowIdx++) {
        const row = table.rows[rowIdx];

        for (let colIdx = 0; colIdx < row.length; colIdx++) {
          const cell = row[colIdx]?.trim();
          if (!cell || cell.length === 0) continue;

          // Check if this cell matches any variation as a label
          for (const variation of variations) {
            const labelPattern = new RegExp(`^${this.escapeRegex(variation)}[:\\s]*$`, 'i');

            if (labelPattern.test(cell)) {
              // Found a label cell - check adjacent cells for value

              // Try right cell (same row, next column)
              if (colIdx + 1 < row.length) {
                const valueCell = row[colIdx + 1]?.trim();
                if (valueCell && valueCell.length > 0) {
                  return {
                    name: schemaField.name,
                    value: this.cleanValue(valueCell, schemaField.type),
                    confidence: 0.8,
                    source: 'textract_table',
                    rawMatch: `${cell}: ${valueCell}`,
                  };
                }
              }

              // Try cell below (next row, same column)
              if (rowIdx + 1 < table.rows.length) {
                const nextRow = table.rows[rowIdx + 1];
                if (colIdx < nextRow.length) {
                  const valueCell = nextRow[colIdx]?.trim();
                  if (valueCell && valueCell.length > 0) {
                    return {
                      name: schemaField.name,
                      value: this.cleanValue(valueCell, schemaField.type),
                      confidence: 0.75,
                      source: 'textract_table',
                      rawMatch: `${cell} (below): ${valueCell}`,
                    };
                  }
                }
              }
            }
          }
        }
      }
    }

    return null;
  }

  /**
   * Extract field from raw text using patterns
   */
  private extractFromText(
    schemaField: OutputSchemaField,
    text: string
  ): ExtractedField | null {
    const variations = this.getFieldNameVariations(schemaField);
    const candidates: Array<{ value: string; confidence: number; source: string; rawMatch: string }> = [];

    // Strategy 1: Try "FieldName: value" pattern for each variation
    for (const variation of variations) {
      const labelPattern = new RegExp(
        `${this.escapeRegex(variation)}[:\\s]*\\n?\\s*([^\\n]{1,200})`,
        'i'
      );
      const match = text.match(labelPattern);
      if (match && match[1] && match[1].trim().length > 0) {
        candidates.push({
          value: this.cleanValue(match[1].trim(), schemaField.type),
          confidence: 0.9, // High confidence for labeled fields
          source: 'text_pattern',
          rawMatch: match[0],
        });
      }
    }

    // Strategy 2: Try universal format patterns based on field type
    const typeHint = this.inferFieldType(schemaField);
    if (typeHint && UNIVERSAL_FORMAT_PATTERNS[typeHint]) {
      for (const pattern of UNIVERSAL_FORMAT_PATTERNS[typeHint]) {
        const matches = text.matchAll(new RegExp(pattern, 'g'));
        for (const match of matches) {
          if (match) {
            const value = this.cleanValue(match[1] || match[0], schemaField.type);
            // Only add if not already found
            if (!candidates.some(c => c.value === value)) {
              candidates.push({
                value,
                confidence: 0.7, // Medium confidence for type-based matching
                source: 'universal_pattern',
                rawMatch: match[0],
              });
            }
          }
        }
      }
    }

    // Strategy 3: For string fields without patterns, try contextual extraction
    if (candidates.length === 0 && schemaField.type === 'string' && schemaField.description) {
      const contextResult = this.extractFromContext(text, schemaField);
      if (contextResult) {
        candidates.push(contextResult);
      }
    }

    // Pick best candidate (highest confidence)
    if (candidates.length > 0) {
      const best = candidates.sort((a, b) => b.confidence - a.confidence)[0];
      return {
        name: schemaField.name,
        value: best.value,
        confidence: best.confidence,
        source: best.source as any,
        rawMatch: best.rawMatch,
      };
    }

    return null;
  }

  /**
   * Extract value based on contextual clues from description
   * Uses field description to understand document structure and locate relevant data
   */
  private extractFromContext(text: string, schemaField: OutputSchemaField): { value: string; confidence: number; source: string; rawMatch: string } | null {
    const description = schemaField.description?.toLowerCase() || '';
    const fieldName = schemaField.name.toLowerCase();

    // Generic patterns based on field description hints
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    // If description mentions "top" or "header", search first 10 lines
    const searchTop = description.includes('top') || description.includes('header') || description.includes('first');
    const searchLines = searchTop ? lines.slice(0, 10) : lines;

    // If description mentions "bottom" or "footer", search last 10 lines
    if (description.includes('bottom') || description.includes('footer') || description.includes('last')) {
      const bottomLines = lines.slice(-10);
      // Search for any non-empty line matching field variations
      const variations = this.getFieldNameVariations(schemaField);
      for (const line of bottomLines) {
        for (const variation of variations) {
          if (line.toLowerCase().includes(variation.toLowerCase())) {
            return {
              value: line,
              confidence: 0.7,
              source: 'context_bottom',
              rawMatch: line
            };
          }
        }
      }
    }

    // Generic pattern: Look for lines with specific structural patterns
    // Domain names (for any field mentioning "website", "url", "email", etc.)
    if (description.includes('domain') || description.includes('website') || description.includes('url')) {
      for (const line of searchLines) {
        const domainMatch = line.match(/([a-zA-Z0-9-]+\.(com|net|org|io|co|edu|gov))/i);
        if (domainMatch) {
          return {
            value: domainMatch[1],
            confidence: 0.9,
            source: 'context_pattern',
            rawMatch: line
          };
        }
      }
    }

    // Business entity suffixes (for fields mentioning "company", "organization", "business")
    if (description.includes('company') || description.includes('organization') || description.includes('business')) {
      for (const line of searchLines) {
        if (/\b(Inc\.?|LLC|Corp\.?|Ltd\.?|Limited|PBC|GmbH|SA|SAS|BV)\b/i.test(line)) {
          return {
            value: line,
            confidence: 0.85,
            source: 'context_pattern',
            rawMatch: line
          };
        }
      }
    }

    return null;
  }

  /**
   * Get variations of a field name for matching
   * Uses field description to extract relevant keywords dynamically
   */
  private getFieldNameVariations(schemaField: OutputSchemaField): string[] {
    const fieldName = schemaField.name;
    const variations = new Set<string>();

    // 1. Original field name
    variations.add(fieldName);

    // 2. camelCase to words: "invoiceNumber" -> "invoice number"
    variations.add(fieldName.replace(/([A-Z])/g, ' $1').toLowerCase().trim());

    // 3. snake_case to words: "invoice_number" -> "invoice number"
    variations.add(fieldName.replace(/_/g, ' '));

    // 4. Individual words from field name
    const words = fieldName.replace(/[_\s&]+/g, ' ').trim().split(' ');
    words.forEach(word => {
      if (word.length > 2) {
        variations.add(word.toLowerCase());
      }
    });

    // 5. Extract keywords from description (uses agent's schema!)
    if (schemaField.description) {
      const descKeywords = this.extractKeywordsFromDescription(schemaField.description);
      descKeywords.forEach(keyword => variations.add(keyword));
    }

    return Array.from(variations);
  }

  /**
   * Extract meaningful keywords from field description
   * Example: "Merchant/vendor name; if unclear..." → ["merchant", "vendor", "name"]
   * Also extracts multi-word phrases: "Total amount, invoice total, or amount due" → ["total amount", "invoice total", "amount due", "total", "invoice", "amount", "due"]
   * This allows the system to work with ANY field the agent defines!
   */
  private extractKeywordsFromDescription(description: string): string[] {
    const keywords = new Set<string>();

    // Common stop words to filter out
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'if', 'to', 'for', 'of', 'in', 'on', 'at', 'by',
      'from', 'with', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
      'this', 'that', 'these', 'those', 'it', 'its', 'should', 'would', 'could',
      'unclear', 'set', 'literal', 'need', 'review', 'required', 'optional',
      'internal', 'traceability', 'not', 'included', 'final', 'table', 'flag',
      'indicating', 'whether', 'any', 'row', 'use', 'normalized', 'consistent',
    ]);

    // Extract multi-word phrases (2-3 words) from description
    // This captures phrases like "amount due", "invoice total", "date of issue", etc.
    const normalized = description.toLowerCase().replace(/[^\w\s]/g, ' ');
    const allWords = normalized.split(/\s+/).filter(w => w.length > 0);

    // Extract 2-word phrases
    for (let i = 0; i < allWords.length - 1; i++) {
      const word1 = allWords[i];
      const word2 = allWords[i + 1];

      // Skip if either word is a stop word
      if (stopWords.has(word1) || stopWords.has(word2)) continue;

      // Skip if either word is too short
      if (word1.length < 3 || word2.length < 3) continue;

      const phrase = `${word1} ${word2}`;
      keywords.add(phrase);
    }

    // Extract 3-word phrases for more specific matches
    for (let i = 0; i < allWords.length - 2; i++) {
      const word1 = allWords[i];
      const word2 = allWords[i + 1];
      const word3 = allWords[i + 2];

      // Skip if middle word is a stop word or any word is too short
      if (stopWords.has(word2)) continue;
      if (word1.length < 3 || word2.length < 3 || word3.length < 3) continue;

      const phrase = `${word1} ${word2} ${word3}`;
      keywords.add(phrase);
    }

    // Also extract individual meaningful words
    // But filter out generic document words that cause false matches
    // Example: "invoice" from "Invoice or receipt date" would match "INVOICE" → "#677931" incorrectly
    const genericDocumentWords = new Set([
      'invoice', 'receipt', 'document', 'file', 'record', 'form', 'statement', 'report'
    ]);

    const words = normalized
      .split(/\s+/)
      .filter(word =>
        word.length > 2 &&
        !stopWords.has(word) &&
        !genericDocumentWords.has(word)
      );

    words.forEach(word => {
      keywords.add(word);
    });

    return Array.from(keywords);
  }

  /**
   * Normalize key for comparison
   */
  private normalizeKey(key: string): string {
    return key.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  /**
   * Validate that extracted value makes sense for the field type
   * This prevents false matches like extracting "27, 2026" (a date) for a currency field
   */
  private isValueValidForField(value: string, field: OutputSchemaField): boolean {
    const trimmedValue = value.trim();

    // For date fields, reject values that don't look like dates
    if (field.type === 'date') {
      // Must contain at least one digit and either a separator or month name
      const hasDatePattern = /\d/.test(trimmedValue) &&
        (/[-\/]/.test(trimmedValue) || /jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i.test(trimmedValue));
      if (!hasDatePattern) return false;
    }

    // For number fields, reject values that aren't numeric
    if (field.type === 'number' || field.type === 'currency') {
      // Must contain at least one digit
      if (!/\d/.test(trimmedValue)) return false;
      // Reject if it looks like a date (contains month names or date separators with year)
      if (/\d{4}/.test(trimmedValue) && (/jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i.test(trimmedValue) || /\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}/.test(trimmedValue))) {
        return false;
      }
    }

    // For currency code fields (typically 3-letter codes like USD, EUR)
    // Check if description suggests this is a currency code field
    const descLower = (field.description || '').toLowerCase();
    if (descLower.includes('currency') && (descLower.includes('code') || descLower.includes('usd') || descLower.includes('eur'))) {
      // Value should be a short string (3-4 chars) or extracted from a longer string
      // Reject if value looks like a date
      if (/\d{1,2}[,\s]\d{4}/.test(trimmedValue)) return false; // "27, 2026" pattern
      if (/\d{4}/.test(trimmedValue)) return false; // Contains a year
    }

    return true;
  }

  /**
   * Check if field is requesting a currency code (e.g., USD, EUR)
   */
  private isCurrencyCodeField(field: OutputSchemaField): boolean {
    const descLower = (field.description || '').toLowerCase();
    return descLower.includes('currency') &&
      (descLower.includes('code') || descLower.includes('usd') || descLower.includes('eur') || descLower.includes('gbp'));
  }

  /**
   * Extract currency code from a value like "$26.65 USD" → "USD"
   */
  private extractCurrencyCode(value: string): string | null {
    // Common currency codes (3-letter ISO codes)
    const currencyPattern = /\b([A-Z]{3})\b/;
    const match = value.match(currencyPattern);
    if (match) {
      return match[1];
    }

    // Extract from currency symbols
    const symbolMap: Record<string, string> = {
      '$': 'USD',
      '€': 'EUR',
      '£': 'GBP',
      '¥': 'JPY',
      '₹': 'INR',
    };

    for (const [symbol, code] of Object.entries(symbolMap)) {
      if (value.includes(symbol)) {
        return code;
      }
    }

    return null;
  }

  /**
   * Escape regex special characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Infer field format type from schema type ONLY
   * Completely generic - uses ONLY the schema type field, NO field names or descriptions
   */
  private inferFieldType(field: OutputSchemaField): string | null {
    // Return the schema type directly - that's the source of truth
    // Valid schema types: 'string' | 'number' | 'boolean' | 'date' | 'array' | 'object'

    // Only 'date' and 'number' have specific format patterns
    if (field.type === 'date') return 'date';
    if (field.type === 'number') return 'number';

    // For all other types (string, boolean, array, object), no pattern matching
    // They will be extracted via Textract key-value pairs or LLM
    return null;
  }

  /**
   * Clean extracted value based on schema type
   * Uses ONLY the schema type, no hardcoded assumptions
   */
  private cleanValue(value: string, type?: string): string | number | boolean | any[] {
    // Remove common artifacts (generic across all document types)
    let cleaned = value
      .replace(/^\s*[:\-]\s*/, '') // Leading colons/dashes
      .replace(/\s+/g, ' ')        // Multiple spaces
      .trim();

    // Type-specific cleaning based on schema type
    if (type === 'number') {
      const num = parseFloat(cleaned.replace(/[,\s$€£¥]/g, ''));
      return isNaN(num) ? cleaned : num;
    }

    if (type === 'boolean') {
      const lower = cleaned.toLowerCase();
      if (['true', 'yes', '1', 'y', 'on', 'enabled'].includes(lower)) return true;
      if (['false', 'no', '0', 'n', 'off', 'disabled'].includes(lower)) return false;
    }

    if (type === 'date') {
      // Generic date cleaning: find the actual date pattern and extract it
      // This works for any prefix without hardcoding specific words

      // Common date patterns (matches most date formats)
      const datePatterns = [
        /(\d{1,2}[-\/]\w{3}[-\/]\d{4})/i,           // 17-Mar-2026
        /(\w+\s+\d{1,2},?\s+\d{4})/i,               // March 16, 2026
        /(\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4})/,        // 03/16/2026 or 03-16-26
        /(\d{4}[-\/]\d{1,2}[-\/]\d{1,2})/,          // 2026-03-16
      ];

      for (const pattern of datePatterns) {
        const match = cleaned.match(pattern);
        if (match && match[1]) {
          return match[1].trim();
        }
      }

      // If no date pattern found, just remove leading single letters/short words
      // This handles "d 17-Mar-2026" → "17-Mar-2026" without hardcoding "d"
      cleaned = cleaned.replace(/^[a-z]\s+/i, '');
    }

    return cleaned;
  }
}
