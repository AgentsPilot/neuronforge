/**
 * InvoiceExtractor
 *
 * Extracts structured data from invoices and receipts.
 *
 * IMPORTANT: This extractor uses a HYBRID approach:
 * 1. Built-in patterns for COMMON invoice fields (date, total, vendor, etc.)
 * 2. Schema-driven extraction for USER-DEFINED fields from output_schema
 *
 * The output_schema from the workflow determines what fields to extract.
 * Built-in patterns are helpers, not requirements.
 */

import { BaseExtractor } from './BaseExtractor.deprecated';
import type { DocumentType, FieldPattern, ExtractionResult, OutputSchema, ExtractedField } from '../types';
import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'InvoiceExtractor', service: 'extraction' });

// Blacklist patterns - these indicate bad extractions (headers, footers, etc.)
const BLACKLIST_PATTERNS = [
  /^page\s+\d+/i,
  /^\d+\s+of\s+\d+$/i,
  /^receipt$/i,
  /^invoice$/i,
  /^order$/i,
  /^thank\s+you/i,
  /^powered\s+by/i,
];

// Common invoice field patterns - used as helpers for schema-driven extraction
// NOTE: Patterns use [:\s]* (zero or more) to handle PDFs where labels and values have no space
const COMMON_INVOICE_PATTERNS: Record<string, FieldPattern> = {
  // Invoice identifiers
  invoiceNumber: {
    name: 'invoiceNumber',
    patterns: [
      // Match explicit invoice number patterns like INV-2026-0042
      /\b(INV[-\s]?\d{4}[-\s]?\d{4,})\b/i,
      // "Invoice Number:" followed by value (possibly multiple lines down in PDF)
      /invoice\s*number[:\s]*(?:[\s\S]{0,50}?)(INV[-\s]?\d+[-\s]?\d+|[A-Z]{2,4}[-\s]?\d{4,})/i,
      /(?:#|no\.?|number|id)[:\s]+([A-Z0-9][\w\-]{5,25})/i,
      /(?:receipt|invoice|order)\s*#\s*([A-Z0-9]{5,})/i,
    ],
    type: 'string',
  },
  invoice_number: { name: 'invoice_number', patterns: [], type: 'string' }, // Alias

  // Dates - improved patterns to handle newlines between label and value
  date: {
    name: 'date',
    patterns: [
      // Match common date formats anywhere (Month Day, Year)
      /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/i,
      // "Invoice Date:" followed by value (possibly multiple lines down)
      /invoice\s*date[:\s]*(?:[\s\S]{0,100}?)(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i,
      /(?:date|dated)[:\s]+(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i,
      // ISO format anywhere
      /\b(\d{4}-\d{2}-\d{2})\b/,
      // Common formats at start of line or after newline
      /(?:^|\n)\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\b/m,
    ],
    type: 'date',
  },
  invoice_date: { name: 'invoice_date', patterns: [], type: 'date' }, // Alias
  dueDate: {
    name: 'dueDate',
    patterns: [
      // Handle "Due Date:" followed by value on next line
      /(?:due\s*date|payment\s*due|pay\s*by|due\s*on)[:\s]*\n?\s*(\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/i,
      /(?:due\s*date|payment\s*due|pay\s*by)[:\s]*\n?\s*([A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})/i,
    ],
    type: 'date',
  },
  due_date: { name: 'due_date', patterns: [], type: 'date' }, // Alias

  // Amounts - handle no-space formats like "Total:$4498.17"
  total: {
    name: 'total',
    patterns: [
      // Handle "Total:$4498.17" (no space) - most specific first
      /(?:^|[\n\s])(?:total|grand\s*total)[:\s]*\$\s*([\d,]+\.\d{2})/im,
      /(?:^|[\n\s])(?:total|grand\s*total)[:\s]*[\$€£]?\s*([\d,]+\.\d{2})/im,
      // Explicit total labels with amounts (with optional space)
      /(?:total|grand\s*total|amount\s*due|balance\s*due|amount\s*paid|charged?)[:\s]*[\$€£]?\s*([\d,]+\.\d{2})/i,
      /(?:total|grand\s*total|amount\s*due|balance\s*due)[:\s]*[\$€£]?\s*([\d,]+)/i,
      // Currency symbol followed by amount at end of line (common in receipts)
      /[\$€£]\s*([\d,]+\.\d{2})\s*$/m,
      // Amount after "paid" or "charged"
      /(?:paid|charged?)\s*[\$€£]?\s*([\d,]+\.\d{2})/i,
    ],
    type: 'currency',
  },
  amount: { name: 'amount', patterns: [], type: 'currency' }, // Alias
  total_amount: { name: 'total_amount', patterns: [], type: 'currency' }, // Alias
  subtotal: {
    name: 'subtotal',
    patterns: [
      // Handle "Subtotal:$4164.97" (no space)
      /(?:subtotal|sub\s*total|net\s*amount)[:\s]*\$\s*([\d,]+\.\d{2})/i,
      /(?:subtotal|sub\s*total|net\s*amount)[:\s]*[\$€£]?\s*([\d,]+\.\d{2})/i,
      /(?:subtotal|sub\s*total|net\s*amount)[:\s]*[\$€£]?\s*([\d,]+)/i,
    ],
    type: 'currency',
  },
  tax: {
    name: 'tax',
    patterns: [
      // Handle "Tax (8%):$333.20" (no space)
      /(?:tax|vat|gst|hst|sales\s*tax)(?:\s*\([^)]+\))?[:\s]*\$\s*([\d,]+\.\d{2})/i,
      /(?:tax|vat|gst|hst|sales\s*tax)(?:\s*\([^)]+\))?[:\s]*[\$€£]?\s*([\d,]+\.\d{2})/i,
      /(?:tax|vat|gst|hst|sales\s*tax)[:\s]*[\$€£]?\s*([\d,]+)/i,
    ],
    type: 'currency',
  },

  // Vendor info - look for company name near top of document
  vendor: {
    name: 'vendor',
    patterns: [
      // Explicit vendor labels
      /(?:from|seller|vendor|merchant|store|company|billed?\s*by)[:\s]+([A-Za-z][A-Za-z0-9\s&.,'-]{2,40})/i,
      // Company names with business suffixes (more specific)
      /\b([A-Z][A-Za-z0-9\s&.,'-]{2,40}(?:\s+(?:Inc\.?|LLC|Ltd\.?|Corp\.?|Co\.?|GmbH|SA|BV|PLC)))\b/,
      // Look for company name pattern near INVOICE header (first line after INVOICE)
      /INVOICE\n([A-Z][A-Za-z\s]+(?:Corporation|Company|Inc|LLC)?)/,
    ],
    type: 'string',
  },
  vendor_name: { name: 'vendor_name', patterns: [], type: 'string' }, // Alias
  merchant: { name: 'merchant', patterns: [], type: 'string' }, // Alias

  // Customer info
  customerName: {
    name: 'customerName',
    patterns: [
      /(?:bill\s*to|customer|client|sold\s*to|ship\s*to)[:\s]+([A-Za-z][A-Za-z\s]{2,40})/i,
    ],
    type: 'string',
  },
  customer: { name: 'customer', patterns: [], type: 'string' }, // Alias

  // Other common fields
  currency: {
    name: 'currency',
    patterns: [
      /(?:currency|paid\s*in)[:\s]+(USD|EUR|GBP|CAD|AUD|JPY|CHF)/i,
      /\b(USD|EUR|GBP|CAD|AUD)\s+[\d,]+/,
    ],
    type: 'string',
  },
  description: {
    name: 'description',
    patterns: [
      /(?:description|memo|notes?|for|item)[:\s]+([^\n]{10,200})/i,
      /(?:product|service|plan)[:\s]+([^\n]{5,100})/i,
    ],
    type: 'string',
  },

  // Additional receipt fields
  payment_method: {
    name: 'payment_method',
    patterns: [
      /(?:payment\s*method|paid\s*(?:with|by|via)|card)[:\s]+([A-Za-z\s\*\d]{3,30})/i,
      /\b(visa|mastercard|amex|discover|paypal|apple\s*pay|google\s*pay)\b/i,
    ],
    type: 'string',
  },
  card_last4: {
    name: 'card_last4',
    patterns: [
      /(?:card|ending\s*in|last\s*4)[:\s*]+(\*{0,4}\d{4})/i,
      /\*{4,}(\d{4})/,
    ],
    type: 'string',
  },
};

export class InvoiceExtractor extends BaseExtractor {
  documentType: DocumentType = 'invoice';
  fieldPatterns: FieldPattern[] = []; // Will be built from output_schema

  /**
   * Extract fields based on output_schema
   * The schema defines what fields the user wants, not us
   */
  extractWithSchema(text: string, outputSchema: OutputSchema): ExtractionResult {
    const startTime = Date.now();
    const fields: Record<string, ExtractedField> = {};
    const errors: string[] = [];

    logger.info({
      schemaFields: outputSchema.fields.map(f => f.name),
      textLength: text.length,
    }, 'InvoiceExtractor: Schema-driven extraction');

    // For each field in the output_schema, try to extract it
    for (const schemaField of outputSchema.fields) {
      const fieldName = schemaField.name.toLowerCase();
      const normalizedName = this.normalizeFieldName(fieldName);

      // 1. Try to find a matching built-in pattern
      const builtInPattern = COMMON_INVOICE_PATTERNS[normalizedName] ||
                            COMMON_INVOICE_PATTERNS[fieldName];

      if (builtInPattern && builtInPattern.patterns.length > 0) {
        const extracted = this.extractField(text, builtInPattern);
        if (extracted) {
          fields[schemaField.name] = {
            ...extracted,
            name: schemaField.name, // Use original schema field name
          };
          continue;
        }
      }

      // 2. Try generic pattern based on field name
      const genericExtracted = this.extractWithGenericPattern(text, schemaField.name);
      if (genericExtracted) {
        fields[schemaField.name] = genericExtracted;
        continue;
      }

      // 3. Field not found
      if (schemaField.required) {
        errors.push(`Required field '${schemaField.name}' not found`);
      }
    }

    // Calculate confidence
    const extractedCount = Object.keys(fields).length;
    const totalFields = outputSchema.fields.length;
    const confidence = totalFields > 0 ? extractedCount / totalFields : 0;

    const processingTime = Date.now() - startTime;

    return {
      success: extractedCount > 0,
      documentType: this.documentType,
      fields,
      confidence,
      metadata: {
        extractionMethod: 'pdf-parse',
        processingTimeMs: processingTime,
        pageCount: 1,
        textLength: text.length,
      },
      rawText: text,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Normalize field name to match common patterns
   * e.g., "invoice_number" -> "invoiceNumber", "Invoice Number" -> "invoiceNumber"
   */
  private normalizeFieldName(fieldName: string): string {
    // Remove common prefixes/suffixes and normalize
    return fieldName
      .toLowerCase()
      .replace(/[_\s]+(.)/g, (_, c) => c.toUpperCase()) // snake_case to camelCase
      .replace(/^./, c => c.toLowerCase()); // ensure starts lowercase
  }

  /**
   * Try to extract field using generic "fieldName: value" pattern
   */
  private extractWithGenericPattern(text: string, fieldName: string): ExtractedField | null {
    // Create variations of the field name for matching
    const variations = this.getFieldNameVariations(fieldName);

    for (const variation of variations) {
      // Pattern: "Field Name: value" or "Field Name  value"
      const pattern = new RegExp(
        `${this.escapeRegex(variation)}[:\\s]+([^\\n]{1,100})`,
        'i'
      );
      const match = text.match(pattern);

      if (match && match[1]) {
        return {
          name: fieldName,
          value: match[1].trim(),
          confidence: 0.6, // Lower confidence for generic pattern
          source: 'pattern',
          rawMatch: match[0],
        };
      }
    }

    return null;
  }

  /**
   * Generate variations of field name for pattern matching
   */
  private getFieldNameVariations(fieldName: string): string[] {
    const variations = new Set<string>();

    // Original
    variations.add(fieldName);

    // camelCase to words: "invoiceNumber" -> "invoice number"
    variations.add(fieldName.replace(/([A-Z])/g, ' $1').toLowerCase().trim());

    // snake_case to words: "invoice_number" -> "invoice number"
    variations.add(fieldName.replace(/_/g, ' '));

    // Remove common suffixes
    variations.add(fieldName.replace(/(_?number|_?date|_?amount|_?name)$/i, ''));

    return Array.from(variations);
  }

  /**
   * Escape special regex characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Default extract without schema - extracts common invoice fields
   */
  extract(text: string): ExtractionResult {
    // When no schema provided, extract common invoice fields
    const defaultSchema: OutputSchema = {
      fields: [
        { name: 'invoiceNumber', type: 'string' },
        { name: 'date', type: 'date' },
        { name: 'total', type: 'number' },
        { name: 'vendor', type: 'string' },
        { name: 'tax', type: 'number' },
        { name: 'subtotal', type: 'number' },
      ],
    };
    return this.extractWithSchema(text, defaultSchema);
  }
}
