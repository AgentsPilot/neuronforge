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
 */

import { createLogger } from '@/lib/logger';
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
  extract(input: ExtractionInput, outputSchema: OutputSchema): SchemaExtractionResult {
    const startTime = Date.now();
    const fields: Record<string, ExtractedField> = {};
    const data: Record<string, any> = {};
    const missingFields: string[] = [];
    const uncertainFields: string[] = [];

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

      // Strategy 3: Check Textract key-value pairs
      if (!extracted && input.keyValuePairs?.length) {
        extracted = this.extractFromKeyValuePairs(schemaField, input.keyValuePairs);
      }

      // Strategy 4: Check tables for array fields
      if (!extracted && schemaField.type === 'array' && input.tables?.length) {
        extracted = this.extractFromTables(schemaField, input.tables);
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
    const variations = this.getFieldNameVariations(schemaField.name);

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
    const variations = this.getFieldNameVariations(schemaField.name);

    for (const variation of variations) {
      const normalizedVariation = this.normalizeKey(variation);

      // Try exact match
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

      // Try partial match (key contains variation)
      const partialMatch = keyValuePairs.find(kv => {
        const normalizedKey = this.normalizeKey(kv.key);
        return normalizedKey.includes(normalizedVariation) ||
               normalizedVariation.includes(normalizedKey);
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
   * Extract field from raw text using patterns
   */
  private extractFromText(
    schemaField: OutputSchemaField,
    text: string
  ): ExtractedField | null {
    const variations = this.getFieldNameVariations(schemaField.name);

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
   */
  private getFieldNameVariations(fieldName: string): string[] {
    const variations = new Set<string>();

    // Original
    variations.add(fieldName);

    // camelCase to words: "invoiceNumber" -> "invoice number"
    variations.add(fieldName.replace(/([A-Z])/g, ' $1').toLowerCase().trim());

    // snake_case to words: "invoice_number" -> "invoice number"
    variations.add(fieldName.replace(/_/g, ' '));

    // Words to camelCase
    const words = fieldName.replace(/[_\s]+/g, ' ').trim().split(' ');
    if (words.length > 1) {
      variations.add(words[0].toLowerCase() + words.slice(1).map(w =>
        w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
      ).join(''));
    }

    // Common synonyms
    const synonyms: Record<string, string[]> = {
      'date': ['date', 'dated', 'date_time', 'datetime', 'timestamp'],
      'amount': ['amount', 'total', 'total_amount', 'sum', 'price', 'cost'],
      'vendor': ['vendor', 'merchant', 'seller', 'company', 'from', 'store'],
      'customer': ['customer', 'client', 'buyer', 'bill to', 'sold to'],
      'email': ['email', 'e-mail', 'email_address', 'mail'],
      'phone': ['phone', 'telephone', 'tel', 'mobile', 'phone_number'],
      'address': ['address', 'location', 'street', 'addr'],
      'name': ['name', 'full_name', 'fullname'],
    };

    const lowerName = fieldName.toLowerCase().replace(/[_\s]/g, '');
    for (const [key, aliasList] of Object.entries(synonyms)) {
      if (lowerName.includes(key) || aliasList.some(a => lowerName.includes(a.replace(/[_\s]/g, '')))) {
        aliasList.forEach(a => variations.add(a));
      }
    }

    return Array.from(variations);
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
