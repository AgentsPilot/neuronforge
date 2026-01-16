/**
 * GenericExtractor
 *
 * Fallback extractor for documents that don't match specific types.
 * Uses schema-driven extraction with generic patterns.
 *
 * Strategies:
 * 1. Label:Value pattern matching
 * 2. Field name proximity search
 * 3. Common data type patterns (dates, amounts, etc.)
 */

import { BaseExtractor } from './BaseExtractor.deprecated';
import type { DocumentType, FieldPattern, ExtractionResult, OutputSchema, ExtractedField, OutputSchemaField } from '../types';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'GenericExtractor', service: 'extraction' });

export class GenericExtractor extends BaseExtractor {
  documentType: DocumentType = 'generic';
  fieldPatterns: FieldPattern[] = [];

  /**
   * Extract fields based on output_schema using generic patterns
   */
  extractWithSchema(text: string, outputSchema: OutputSchema): ExtractionResult {
    const startTime = Date.now();
    const fields: Record<string, ExtractedField> = {};
    const errors: string[] = [];

    logger.info({
      schemaFields: outputSchema.fields.map(f => f.name),
      textLength: text.length,
    }, 'GenericExtractor: Schema-driven extraction');

    for (const schemaField of outputSchema.fields) {
      let extracted: ExtractedField | null = null;

      // 1. Try label:value pattern
      extracted = this.extractLabelValue(text, schemaField.name);

      // 2. Try type-specific patterns
      if (!extracted) {
        extracted = this.extractByType(text, schemaField);
      }

      // 3. Try proximity-based extraction
      if (!extracted) {
        extracted = this.extractByProximity(text, schemaField.name);
      }

      if (extracted) {
        fields[schemaField.name] = extracted;
      } else if (schemaField.required) {
        errors.push(`Required field '${schemaField.name}' not found`);
      }
    }

    const extractedCount = Object.keys(fields).length;
    const totalFields = outputSchema.fields.length;
    const confidence = totalFields > 0 ? extractedCount / totalFields : 0;

    return {
      success: extractedCount > 0,
      documentType: this.documentType,
      fields,
      confidence,
      metadata: {
        extractionMethod: 'pdf-parse',
        processingTimeMs: Date.now() - startTime,
        pageCount: 1,
        textLength: text.length,
      },
      rawText: text,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Extract using label:value pattern
   */
  private extractLabelValue(text: string, fieldName: string): ExtractedField | null {
    const variations = this.getFieldNameVariations(fieldName);

    for (const variation of variations) {
      const patterns = [
        // Standard "Label: Value"
        new RegExp(`${this.escapeRegex(variation)}[:\\s]+([^\\n]{1,200})`, 'i'),
        // "Label\nValue"
        new RegExp(`${this.escapeRegex(variation)}\\s*\\n\\s*([^\\n]{1,200})`, 'i'),
        // "Label = Value"
        new RegExp(`${this.escapeRegex(variation)}\\s*=\\s*([^\\n]{1,200})`, 'i'),
      ];

      for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match && match[1]) {
          const value = match[1].trim();
          if (value && !this.looksLikeLabel(value)) {
            return {
              name: fieldName,
              value,
              confidence: 0.7,
              source: 'pattern',
              rawMatch: match[0],
            };
          }
        }
      }
    }

    return null;
  }

  /**
   * Extract based on field type using type-specific patterns
   */
  private extractByType(text: string, schemaField: OutputSchemaField): ExtractedField | null {
    const fieldName = schemaField.name;
    const fieldType = schemaField.type;

    // Type-specific extraction patterns
    switch (fieldType) {
      case 'date':
        return this.extractDate(text, fieldName);
      case 'number':
        return this.extractNumber(text, fieldName);
      default:
        return null;
    }
  }

  /**
   * Extract date near field name
   */
  private extractDate(text: string, fieldName: string): ExtractedField | null {
    const variations = this.getFieldNameVariations(fieldName);

    // Date patterns
    const datePatterns = [
      /(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/,
      /(\d{4}-\d{2}-\d{2})/,
      /([A-Za-z]+\s+\d{1,2},?\s+\d{4})/,
    ];

    for (const variation of variations) {
      // Find field name in text
      const fieldIndex = text.toLowerCase().indexOf(variation.toLowerCase());
      if (fieldIndex === -1) continue;

      // Look for date in surrounding context (300 chars after field name)
      const context = text.substring(fieldIndex, fieldIndex + 300);

      for (const datePattern of datePatterns) {
        const match = context.match(datePattern);
        if (match && match[1]) {
          return {
            name: fieldName,
            value: match[1],
            confidence: 0.6,
            source: 'pattern',
            rawMatch: match[0],
          };
        }
      }
    }

    return null;
  }

  /**
   * Extract number near field name
   */
  private extractNumber(text: string, fieldName: string): ExtractedField | null {
    const variations = this.getFieldNameVariations(fieldName);

    for (const variation of variations) {
      // Find field name and look for number nearby
      const pattern = new RegExp(
        `${this.escapeRegex(variation)}[:\\s]*\\$?\\s*([\\d,]+\\.?\\d*)`,
        'i'
      );
      const match = text.match(pattern);

      if (match && match[1]) {
        const numValue = parseFloat(match[1].replace(/,/g, ''));
        if (!isNaN(numValue)) {
          return {
            name: fieldName,
            value: numValue,
            confidence: 0.65,
            source: 'pattern',
            rawMatch: match[0],
          };
        }
      }
    }

    return null;
  }

  /**
   * Extract by finding field name and taking nearby content
   */
  private extractByProximity(text: string, fieldName: string): ExtractedField | null {
    const variations = this.getFieldNameVariations(fieldName);
    const lines = text.split('\n');

    for (const variation of variations) {
      // Find line containing field name
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lowerLine = line.toLowerCase();
        const lowerVariation = variation.toLowerCase();

        if (lowerLine.includes(lowerVariation)) {
          // Try to extract value from same line
          const colonIndex = line.indexOf(':');
          if (colonIndex > -1) {
            const value = line.substring(colonIndex + 1).trim();
            if (value && value.length > 0 && value.length < 200) {
              return {
                name: fieldName,
                value,
                confidence: 0.5,
                source: 'pattern',
                rawMatch: line,
              };
            }
          }

          // Try next line if current line ends with the field name
          if (line.trim().toLowerCase().endsWith(lowerVariation) && i + 1 < lines.length) {
            const nextLine = lines[i + 1].trim();
            if (nextLine && nextLine.length > 0 && nextLine.length < 200) {
              return {
                name: fieldName,
                value: nextLine,
                confidence: 0.45,
                source: 'pattern',
                rawMatch: `${line}\n${nextLine}`,
              };
            }
          }
        }
      }
    }

    return null;
  }

  /**
   * Check if a value looks like a label (contains : or ends with common label patterns)
   */
  private looksLikeLabel(value: string): boolean {
    return value.includes(':') || /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*$/.test(value.trim());
  }

  /**
   * Generate field name variations for matching
   */
  private getFieldNameVariations(fieldName: string): string[] {
    const variations = new Set<string>();

    // Original
    variations.add(fieldName);

    // camelCase to words
    variations.add(fieldName.replace(/([A-Z])/g, ' $1').toLowerCase().trim());

    // snake_case to words
    variations.add(fieldName.replace(/_/g, ' '));

    // Title Case
    variations.add(
      fieldName
        .replace(/([A-Z])/g, ' $1')
        .replace(/_/g, ' ')
        .trim()
        .replace(/\b\w/g, c => c.toUpperCase())
    );

    // ALL CAPS
    variations.add(fieldName.replace(/([A-Z])/g, ' $1').toUpperCase().trim());

    return Array.from(variations);
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Default extract - extract all recognizable key:value pairs
   */
  extract(text: string): ExtractionResult {
    const startTime = Date.now();
    const fields: Record<string, ExtractedField> = {};

    // Extract all key:value patterns found in text
    const kvPatterns = [
      /^([A-Za-z][A-Za-z\s_]{1,40})[:\s]+([^\n]{1,200})$/gm,
      /^([A-Z][A-Z\s_]{1,40})[:\s]+([^\n]{1,200})$/gm,
    ];

    for (const pattern of kvPatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        const key = match[1].trim();
        const value = match[2].trim();

        // Normalize key
        const normalizedKey = key
          .toLowerCase()
          .replace(/\s+/g, '_')
          .replace(/[^a-z0-9_]/g, '');

        if (normalizedKey && value && !fields[normalizedKey] && value.length < 200) {
          fields[normalizedKey] = {
            name: normalizedKey,
            value,
            confidence: 0.5,
            source: 'pattern',
            rawMatch: match[0],
          };
        }
      }
    }

    return {
      success: Object.keys(fields).length > 0,
      documentType: this.documentType,
      fields,
      confidence: Object.keys(fields).length > 0 ? 0.4 : 0,
      metadata: {
        extractionMethod: 'pdf-parse',
        processingTimeMs: Date.now() - startTime,
        pageCount: 1,
        textLength: text.length,
      },
      rawText: text,
    };
  }
}
