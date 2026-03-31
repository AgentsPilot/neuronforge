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

// Common patterns for universal field types (not document-specific)
const UNIVERSAL_PATTERNS: Record<string, RegExp[]> = {
  // Date patterns
  date: [
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/i,
    /\b(\d{4}-\d{2}-\d{2})\b/,
    /\b(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})\b/,
  ],
  // Currency/amount patterns
  amount: [
    /[\$€£]\s*([\d,]+\.\d{2})/,
    /\b([\d,]+\.\d{2})\s*(?:USD|EUR|GBP)/i,
  ],
  // Email patterns
  email: [
    /\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/,
  ],
  // Phone patterns
  phone: [
    /\b(\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})\b/,
  ],
  // URL patterns
  url: [
    /\b(https?:\/\/[^\s]+)\b/,
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

      // Strategy 2.5: For well-defined types (email, phone, URL), try universal patterns FIRST
      // This prevents ambiguous key-value pair matches (e.g., "address" matching payment address instead of email)
      if (!extracted && input.text) {
        const fieldNameLower = schemaField.name.toLowerCase();
        const descriptionLower = schemaField.description?.toLowerCase() || '';

        // Check if this is an email field
        if (fieldNameLower.includes('email') || descriptionLower.includes('email')) {
          const emailPattern = UNIVERSAL_PATTERNS.email?.[0];
          if (emailPattern) {
            const match = input.text.match(emailPattern);
            if (match && match[1]) {
              extracted = {
                name: schemaField.name,
                value: match[1].trim(),
                confidence: 0.9,
                source: 'universal_pattern',
                rawMatch: match[0],
              };
            }
          }
        }

        // Check if this is a phone field
        if (!extracted && (fieldNameLower.includes('phone') || descriptionLower.includes('phone'))) {
          const phonePattern = UNIVERSAL_PATTERNS.phone?.[0];
          if (phonePattern) {
            const match = input.text.match(phonePattern);
            if (match && match[0]) {
              extracted = {
                name: schemaField.name,
                value: match[0].trim(),
                confidence: 0.85,
                source: 'universal_pattern',
                rawMatch: match[0],
              };
            }
          }
        }

        // Check if this is a URL field
        if (!extracted && (fieldNameLower.includes('url') || fieldNameLower.includes('link') || descriptionLower.includes('url'))) {
          const urlPattern = UNIVERSAL_PATTERNS.url?.[0];
          if (urlPattern) {
            const match = input.text.match(urlPattern);
            if (match && match[1]) {
              extracted = {
                name: schemaField.name,
                value: match[1].trim(),
                confidence: 0.9,
                source: 'universal_pattern',
                rawMatch: match[0],
              };
            }
          }
        }
      }

      // Strategy 3: Check Textract key-value pairs (with reuse prevention)
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

      // Strategy 4.5: Check tables for vendor/company info in invoice header tables
      if (!extracted && input.tables?.length && schemaField.type === 'string') {
        extracted = this.extractFromInvoiceHeaderTable(schemaField, input.tables);
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
        if (schemaField.required) {
          missingFields.push(schemaField.name);
        }
      }
    }

    // Strategy 6: LLM-based intelligent mapping (FINAL FALLBACK)
    // Only use if we have missing fields AND we have Textract data available
    if (missingFields.length > 0 && (input.keyValuePairs?.length || input.text)) {
      logger.info({
        missingFieldsCount: missingFields.length,
        hasKeyValuePairs: !!input.keyValuePairs?.length,
      }, 'SchemaFieldExtractor: Triggering LLM fallback for missing fields');

      try {
        const llmMapper = new LLMFieldMapper();

        // Only pass successfully extracted fields (filter out nulls)
        const successfullyExtractedFields = Object.fromEntries(
          Object.entries(data).filter(([_, value]) => value !== null)
        );

        const llmResult = await llmMapper.mapFields({
          text: input.text || '',
          keyValuePairs: input.keyValuePairs,
          outputSchema: outputSchema,
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

    // First pass: Try exact matches only
    for (const variation of sortedVariations) {
      const normalizedVariation = this.normalizeKey(variation);

      const exactMatch = keyValuePairs.find(
        kv => this.normalizeKey(kv.key) === normalizedVariation
      );
      if (exactMatch) {
        return {
          name: schemaField.name,
          value: exactMatch.value.trim(),
          confidence: exactMatch.confidence / 100,
          source: 'textract_kv',
          rawMatch: `${exactMatch.key}: ${exactMatch.value}`,
        };
      }
    }

    // Second pass: Try partial matches if no exact match found
    // Use more intelligent partial matching that avoids false positives
    for (const variation of sortedVariations) {
      const normalizedVariation = this.normalizeKey(variation);

      const partialMatch = keyValuePairs.find(kv => {
        const normalizedKey = this.normalizeKey(kv.key);

        // Avoid matching when variation is too short (e.g., "due" matching "overdue")
        if (normalizedVariation.length < 4) return false;

        // Check if the variation is at the start of the key (e.g., "date" in "date of issue")
        if (normalizedKey.startsWith(normalizedVariation)) return true;

        // Check if the variation is at the end of the key (e.g., "date" in "invoice date")
        if (normalizedKey.endsWith(normalizedVariation)) return true;

        // Check if the key is at the start of the variation (for longer variations)
        // e.g., "date" key matches "date issued" variation
        if (normalizedVariation.startsWith(normalizedKey) && normalizedKey.length >= 4) return true;

        return false;
      });
      if (partialMatch) {
        return {
          name: schemaField.name,
          value: partialMatch.value.trim(),
          confidence: (partialMatch.confidence / 100) * 0.8, // Lower confidence for partial
          source: 'textract_kv',
          rawMatch: `${partialMatch.key}: ${partialMatch.value}`,
        };
      }
    }

    return null;
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
   * Extract vendor/company info from invoice header tables
   *
   * In invoice PDFs, vendor info is often in a 2-column table with:
   * - Left column: Vendor name, vendor address
   * - Right column: "Bill to", customer name, customer address
   *
   * Example from Textract:
   * Row 1: "Anthropic, PBC" | "Bill to"
   * Row 2: "548 Market Street" | "offir.omer@gmail.com's Organization"
   */
  private extractFromInvoiceHeaderTable(
    schemaField: OutputSchemaField,
    tables: Array<{ rows: string[][]; confidence: number }>
  ): ExtractedField | null {
    const variations = this.getFieldNameVariations(schemaField);

    // Check if this field is vendor/company related
    const isVendorField = variations.some(v =>
      ['vendor', 'company', 'seller', 'supplier', 'from'].includes(v.toLowerCase())
    );

    if (!isVendorField) return null;

    // Look through tables for invoice header structure
    for (const table of tables) {
      if (table.rows.length < 2) continue;

      // Check if this looks like an invoice header table
      // Typically has "Bill to" or "Bill To" in the right column
      const hasBillTo = table.rows.some(row =>
        row.some(cell => /bill\s*to/i.test(cell))
      );

      if (hasBillTo) {
        // The vendor info is typically in the first row, left column
        // before the "Bill to" label
        const firstRow = table.rows[0];
        if (firstRow.length >= 2) {
          const leftCell = firstRow[0]?.trim();
          const rightCell = firstRow[1]?.trim();

          // If right cell contains "Bill to", left cell is likely the vendor
          if (/bill\s*to/i.test(rightCell) && leftCell && leftCell.length > 0) {
            return {
              name: schemaField.name,
              value: leftCell,
              confidence: 0.85,
              source: 'textract_table',
              rawMatch: `Table row: ${leftCell} | ${rightCell}`,
            };
          }
        }

        // Alternative: Check if vendor name appears in first column, any row before "Bill to"
        for (let i = 0; i < table.rows.length; i++) {
          const row = table.rows[i];
          if (row.length >= 2) {
            const leftCell = row[0]?.trim();
            const rightCell = row[1]?.trim();

            // Stop if we hit the "Bill to" row
            if (/bill\s*to/i.test(leftCell) || /bill\s*to/i.test(rightCell)) {
              break;
            }

            // Look for company-like patterns in left column
            // Companies often have suffixes like LLC, Inc, PBC, Corp, Ltd
            if (leftCell && /\b(LLC|Inc|PBC|Corp|Ltd|Limited|Corporation|Company)\b/i.test(leftCell)) {
              return {
                name: schemaField.name,
                value: leftCell,
                confidence: 0.8,
                source: 'textract_table',
                rawMatch: `Table cell: ${leftCell}`,
              };
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

    // Strategy 1: Try "FieldName: value" pattern for each variation
    for (const variation of variations) {
      const labelPattern = new RegExp(
        `${this.escapeRegex(variation)}[:\\s]*\\n?\\s*([^\\n]{1,200})`,
        'i'
      );
      const match = text.match(labelPattern);
      if (match && match[1] && match[1].trim().length > 0) {
        return {
          name: schemaField.name,
          value: this.cleanValue(match[1].trim(), schemaField.type),
          confidence: 0.7,
          source: 'text_pattern',
          rawMatch: match[0],
        };
      }
    }

    // Strategy 2: Try universal patterns based on field type hints
    const typeHint = this.inferFieldType(schemaField);
    if (typeHint && UNIVERSAL_PATTERNS[typeHint]) {
      for (const pattern of UNIVERSAL_PATTERNS[typeHint]) {
        const match = text.match(pattern);
        if (match) {
          return {
            name: schemaField.name,
            value: this.cleanValue(match[1] || match[0], schemaField.type),
            confidence: 0.5, // Lower confidence for type-based matching
            source: 'universal_pattern',
            rawMatch: match[0],
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

    // Also extract individual meaningful words (as before)
    // But filter out overly generic words that might cause false matches
    const genericWords = new Set(['invoice', 'document', 'file', 'record', 'item', 'field']);

    const words = normalized
      .split(/\s+/)
      .filter(word => word.length > 2 && !stopWords.has(word) && !genericWords.has(word));

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
   * Escape regex special characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Infer field type from name and schema type
   */
  private inferFieldType(field: OutputSchemaField): string | null {
    const name = field.name.toLowerCase();

    if (name.includes('date') || name.includes('time')) return 'date';
    if (name.includes('amount') || name.includes('total') || name.includes('price') || name.includes('cost')) return 'amount';
    if (name.includes('email') || name.includes('mail')) return 'email';
    if (name.includes('phone') || name.includes('tel') || name.includes('mobile')) return 'phone';
    if (name.includes('url') || name.includes('link') || name.includes('website')) return 'url';

    return null;
  }

  /**
   * Clean extracted value based on expected type
   */
  private cleanValue(value: string, type?: string): string | number | boolean | any[] {
    // Remove common artifacts
    let cleaned = value
      .replace(/^\s*[:\-]\s*/, '') // Leading colons/dashes
      .replace(/\s+/g, ' ')        // Multiple spaces
      .trim();

    // Type-specific cleaning
    if (type === 'number') {
      const num = parseFloat(cleaned.replace(/[,\s]/g, ''));
      return isNaN(num) ? cleaned : num;
    }

    if (type === 'boolean') {
      const lower = cleaned.toLowerCase();
      if (['true', 'yes', '1', 'y'].includes(lower)) return true;
      if (['false', 'no', '0', 'n'].includes(lower)) return false;
    }

    return cleaned;
  }
}
