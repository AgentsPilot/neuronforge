/**
 * ContractExtractor
 *
 * Extracts structured data from contracts and legal documents.
 * Schema-driven: extracts fields defined in output_schema.
 *
 * Contracts typically have:
 * - Parties (names, roles)
 * - Dates (effective date, expiration date)
 * - Terms and conditions
 * - Signatures
 */

import { BaseExtractor } from './BaseExtractor.deprecated';
import type { DocumentType, FieldPattern, ExtractionResult, OutputSchema, ExtractedField } from '../types';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'ContractExtractor', service: 'extraction' });

// Common contract field patterns
const COMMON_CONTRACT_PATTERNS: Record<string, FieldPattern> = {
  // Parties
  party: {
    name: 'party',
    patterns: [
      /(?:between|party\s*[a-z]?)[:\s]+([A-Za-z][A-Za-z\s&.,'-]{2,100})/gi,
      /(?:seller|buyer|lessor|lessee|employer|employee|contractor|client)[:\s]+([A-Za-z][A-Za-z\s&.,'-]{2,100})/gi,
    ],
    type: 'string',
  },
  partyA: {
    name: 'partyA',
    patterns: [
      /(?:party\s*a|first\s*party|seller|lessor|employer)[:\s]+([A-Za-z][A-Za-z\s&.,'-]{2,100})/i,
    ],
    type: 'string',
  },
  partyB: {
    name: 'partyB',
    patterns: [
      /(?:party\s*b|second\s*party|buyer|lessee|employee|contractor)[:\s]+([A-Za-z][A-Za-z\s&.,'-]{2,100})/i,
    ],
    type: 'string',
  },

  // Dates
  effectiveDate: {
    name: 'effectiveDate',
    patterns: [
      /(?:effective\s*date|commencement\s*date|start\s*date)[:\s]*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i,
      /(?:effective|commencing)[:\s]*(?:on\s*)?([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i,
      /(?:as\s*of|dated)[:\s]*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i,
    ],
    type: 'date',
  },
  expirationDate: {
    name: 'expirationDate',
    patterns: [
      /(?:expiration\s*date|end\s*date|termination\s*date)[:\s]*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i,
      /(?:expires?|terminates?|ending)[:\s]*(?:on\s*)?([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i,
    ],
    type: 'date',
  },
  term: {
    name: 'term',
    patterns: [
      /(?:term|duration|period)[:\s]*(\d+\s*(?:year|month|week|day)s?)/i,
      /(?:for\s*a\s*(?:period|term)\s*of)[:\s]*(\d+\s*(?:year|month|week|day)s?)/i,
    ],
    type: 'string',
  },

  // Financial terms
  contractValue: {
    name: 'contractValue',
    patterns: [
      /(?:contract\s*value|total\s*value|consideration)[:\s]*\$?\s*([\d,]+\.?\d{0,2})/i,
      /(?:sum\s*of|amount\s*of)[:\s]*\$?\s*([\d,]+\.?\d{0,2})/i,
    ],
    type: 'currency',
  },
  paymentTerms: {
    name: 'paymentTerms',
    patterns: [
      /(?:payment\s*terms?)[:\s]*([^\n]{10,200})/i,
      /(?:net\s*\d+|due\s*(?:on|upon|within)\s*[^\n]{10,100})/i,
    ],
    type: 'string',
  },

  // Contract identifiers
  contractNumber: {
    name: 'contractNumber',
    patterns: [
      /(?:contract\s*(?:#|no\.?|number))[:\s]*([A-Z0-9][\w\-]{2,20})/i,
      /(?:agreement\s*(?:#|no\.?|number))[:\s]*([A-Z0-9][\w\-]{2,20})/i,
    ],
    type: 'string',
  },

  // Jurisdiction
  jurisdiction: {
    name: 'jurisdiction',
    patterns: [
      /(?:governing\s*law|jurisdiction)[:\s]*([A-Za-z\s]{2,50})/i,
      /(?:laws?\s*of\s*(?:the\s*)?(?:state\s*of\s*)?)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s*(?:shall\s*)?govern/i,
    ],
    type: 'string',
  },
};

export class ContractExtractor extends BaseExtractor {
  documentType: DocumentType = 'contract';
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
    }, 'ContractExtractor: Schema-driven extraction');

    for (const schemaField of outputSchema.fields) {
      const fieldName = schemaField.name.toLowerCase();
      const normalizedName = this.normalizeFieldName(fieldName);

      // 1. Try built-in contract patterns
      const builtInPattern = COMMON_CONTRACT_PATTERNS[normalizedName] ||
                            COMMON_CONTRACT_PATTERNS[fieldName];

      if (builtInPattern && builtInPattern.patterns.length > 0) {
        const extracted = this.extractField(text, builtInPattern);
        if (extracted) {
          fields[schemaField.name] = {
            ...extracted,
            name: schemaField.name,
          };
          continue;
        }
      }

      // 2. Try generic label:value pattern
      const genericExtracted = this.extractLabelValue(text, schemaField.name);
      if (genericExtracted) {
        fields[schemaField.name] = genericExtracted;
        continue;
      }

      // 3. Try to extract from section headers
      const sectionExtracted = this.extractFromSection(text, schemaField.name);
      if (sectionExtracted) {
        fields[schemaField.name] = sectionExtracted;
        continue;
      }

      if (schemaField.required) {
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

  private normalizeFieldName(fieldName: string): string {
    return fieldName
      .toLowerCase()
      .replace(/[_\s]+(.)/g, (_, c) => c.toUpperCase())
      .replace(/^./, c => c.toLowerCase());
  }

  /**
   * Extract label:value pairs
   */
  private extractLabelValue(text: string, fieldName: string): ExtractedField | null {
    const variations = this.getFieldNameVariations(fieldName);

    for (const variation of variations) {
      const pattern = new RegExp(
        `${this.escapeRegex(variation)}[:\\s]+([^\\n]{1,200})`,
        'i'
      );
      const match = text.match(pattern);

      if (match && match[1]) {
        return {
          name: fieldName,
          value: match[1].trim(),
          confidence: 0.7,
          source: 'pattern',
          rawMatch: match[0],
        };
      }
    }

    return null;
  }

  /**
   * Extract content from a section by header
   * e.g., "TERM AND TERMINATION\n..." extracts content after the header
   */
  private extractFromSection(text: string, fieldName: string): ExtractedField | null {
    const variations = this.getFieldNameVariations(fieldName);

    for (const variation of variations) {
      // Look for section header followed by content
      const pattern = new RegExp(
        `(?:^|\\n)(?:\\d+\\.?\\s*)?${this.escapeRegex(variation)}[:\\s]*\\n([^\\n]{20,500})`,
        'im'
      );
      const match = text.match(pattern);

      if (match && match[1]) {
        return {
          name: fieldName,
          value: match[1].trim(),
          confidence: 0.55,
          source: 'pattern',
          rawMatch: match[0],
        };
      }
    }

    return null;
  }

  private getFieldNameVariations(fieldName: string): string[] {
    const variations = new Set<string>();
    variations.add(fieldName);
    variations.add(fieldName.replace(/([A-Z])/g, ' $1').toLowerCase().trim());
    variations.add(fieldName.replace(/_/g, ' '));
    variations.add(fieldName.toUpperCase());
    return Array.from(variations);
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Default extract without schema
   */
  extract(text: string): ExtractionResult {
    const defaultSchema: OutputSchema = {
      fields: [
        { name: 'effectiveDate', type: 'date' },
        { name: 'partyA', type: 'string' },
        { name: 'partyB', type: 'string' },
        { name: 'term', type: 'string' },
        { name: 'contractValue', type: 'number' },
      ],
    };
    return this.extractWithSchema(text, defaultSchema);
  }
}
