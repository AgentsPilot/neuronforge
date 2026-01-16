/**
 * FormExtractor
 *
 * Extracts key-value pairs from forms using pattern matching.
 * Schema-driven: extracts fields defined in output_schema.
 *
 * Forms typically have:
 * - Label: Value pairs
 * - Checkbox fields [X] or [ ]
 * - Table-like structures
 */

import { BaseExtractor } from './BaseExtractor.deprecated';
import type { DocumentType, FieldPattern, ExtractionResult, OutputSchema, ExtractedField } from '../types';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'FormExtractor', service: 'extraction' });

export class FormExtractor extends BaseExtractor {
  documentType: DocumentType = 'form';
  fieldPatterns: FieldPattern[] = [];

  /**
   * Extract fields based on output_schema
   */
  extractWithSchema(text: string, outputSchema: OutputSchema): ExtractionResult {
    const startTime = Date.now();
    const fields: Record<string, ExtractedField> = {};
    const errors: string[] = [];

    logger.info({
      schemaFields: outputSchema.fields.map(f => f.name),
      textLength: text.length,
    }, 'FormExtractor: Schema-driven extraction');

    // For each field in the output_schema, try to extract it
    for (const schemaField of outputSchema.fields) {
      // Try multiple extraction strategies
      let extracted: ExtractedField | null = null;

      // 1. Try label:value pattern
      extracted = this.extractLabelValue(text, schemaField.name);

      // 2. Try checkbox pattern for boolean fields
      if (!extracted && schemaField.type === 'boolean') {
        extracted = this.extractCheckbox(text, schemaField.name);
      }

      // 3. Try field name as exact match
      if (!extracted) {
        extracted = this.extractExactMatch(text, schemaField.name);
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
   * Extract label:value pairs
   * Handles: "Field Name: Value", "Field Name   Value", "Field Name\nValue"
   */
  private extractLabelValue(text: string, fieldName: string): ExtractedField | null {
    const variations = this.getFieldNameVariations(fieldName);

    for (const variation of variations) {
      // Pattern: "Label: Value" or "Label  Value" (multiple spaces)
      const patterns = [
        new RegExp(`${this.escapeRegex(variation)}[:\\s]+([^\\n]{1,200})`, 'i'),
        new RegExp(`${this.escapeRegex(variation)}\\n([^\\n]{1,200})`, 'i'),
      ];

      for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match && match[1]) {
          const value = match[1].trim();
          // Skip if value looks like another label
          if (!value.includes(':') || value.length < 50) {
            return {
              name: fieldName,
              value,
              confidence: 0.75,
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
   * Extract checkbox fields
   * Handles: [X] Label, [x] Label, [ ] Label, ☑ Label, ☐ Label
   */
  private extractCheckbox(text: string, fieldName: string): ExtractedField | null {
    const variations = this.getFieldNameVariations(fieldName);

    for (const variation of variations) {
      // Pattern: [X] or [x] or [✓] before/after field name
      const patterns = [
        new RegExp(`\\[([xX✓✔])\\]\\s*${this.escapeRegex(variation)}`, 'i'),
        new RegExp(`${this.escapeRegex(variation)}\\s*\\[([xX✓✔])\\]`, 'i'),
        new RegExp(`\\[\\s*\\]\\s*${this.escapeRegex(variation)}`, 'i'),
        new RegExp(`${this.escapeRegex(variation)}\\s*\\[\\s*\\]`, 'i'),
      ];

      // Check for checked checkbox
      for (let i = 0; i < 2; i++) {
        const match = text.match(patterns[i]);
        if (match) {
          return {
            name: fieldName,
            value: true,
            confidence: 0.85,
            source: 'pattern',
            rawMatch: match[0],
          };
        }
      }

      // Check for unchecked checkbox
      for (let i = 2; i < 4; i++) {
        const match = text.match(patterns[i]);
        if (match) {
          return {
            name: fieldName,
            value: false,
            confidence: 0.85,
            source: 'pattern',
            rawMatch: match[0],
          };
        }
      }
    }

    return null;
  }

  /**
   * Extract exact field name match (for when value follows field name directly)
   */
  private extractExactMatch(text: string, fieldName: string): ExtractedField | null {
    // Split text into lines and look for field name followed by value
    const lines = text.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const variations = this.getFieldNameVariations(fieldName);

      for (const variation of variations) {
        if (line.toLowerCase().startsWith(variation.toLowerCase())) {
          // Value might be on same line after the label
          const afterLabel = line.substring(variation.length).trim();
          if (afterLabel && afterLabel.length > 0) {
            // Remove leading : or = if present
            const value = afterLabel.replace(/^[:\s=]+/, '').trim();
            if (value) {
              return {
                name: fieldName,
                value,
                confidence: 0.65,
                source: 'pattern',
                rawMatch: line,
              };
            }
          }

          // Value might be on next line
          if (i + 1 < lines.length) {
            const nextLine = lines[i + 1].trim();
            if (nextLine && !nextLine.includes(':') && nextLine.length < 100) {
              return {
                name: fieldName,
                value: nextLine,
                confidence: 0.55,
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
   * Generate variations of field name for pattern matching
   */
  private getFieldNameVariations(fieldName: string): string[] {
    const variations = new Set<string>();

    variations.add(fieldName);
    variations.add(fieldName.replace(/([A-Z])/g, ' $1').toLowerCase().trim());
    variations.add(fieldName.replace(/_/g, ' '));
    variations.add(fieldName.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()));

    return Array.from(variations);
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Default extract - extract all key:value pairs found
   */
  extract(text: string): ExtractionResult {
    const startTime = Date.now();
    const fields: Record<string, ExtractedField> = {};

    // Extract all key:value patterns
    const kvPattern = /^([A-Za-z][A-Za-z\s]{1,50})[:\s]+([^\n]{1,200})$/gm;
    let match;

    while ((match = kvPattern.exec(text)) !== null) {
      const key = match[1].trim();
      const value = match[2].trim();

      if (key && value && !fields[key]) {
        fields[key] = {
          name: key,
          value,
          confidence: 0.7,
          source: 'pattern',
          rawMatch: match[0],
        };
      }
    }

    return {
      success: Object.keys(fields).length > 0,
      documentType: this.documentType,
      fields,
      confidence: Object.keys(fields).length > 0 ? 0.6 : 0,
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
