/**
 * BaseExtractor
 *
 * Abstract base class for document-specific extractors.
 * Provides common functionality for pattern-based field extraction.
 */

import { createLogger } from '@/lib/logger';
import type {
  DocumentType,
  ExtractedField,
  ExtractionResult,
  FieldPattern,
  OutputSchema,
} from '../types';

const logger = createLogger({ module: 'BaseExtractor', service: 'extraction' });

export abstract class BaseExtractor {
  abstract documentType: DocumentType;
  abstract fieldPatterns: FieldPattern[];

  /**
   * Extract fields from text using defined patterns
   */
  extract(text: string, outputSchema?: OutputSchema): ExtractionResult {
    const startTime = Date.now();
    const fields: Record<string, ExtractedField> = {};
    const errors: string[] = [];

    logger.debug({
      documentType: this.documentType,
      textLength: text.length,
      patternCount: this.fieldPatterns.length,
    }, 'BaseExtractor: Starting extraction');

    // Try each field pattern
    for (const fieldPattern of this.fieldPatterns) {
      const extracted = this.extractField(text, fieldPattern);

      if (extracted) {
        fields[fieldPattern.name] = extracted;
      } else if (fieldPattern.required) {
        errors.push(`Required field '${fieldPattern.name}' not found`);
      }
    }

    // Calculate overall confidence
    const extractedCount = Object.keys(fields).length;
    const totalPatterns = this.fieldPatterns.length;
    const requiredPatterns = this.fieldPatterns.filter(p => p.required).length;
    const requiredExtracted = this.fieldPatterns
      .filter(p => p.required && fields[p.name])
      .length;

    // Confidence based on:
    // - 50%: Required fields extracted
    // - 30%: Optional fields extracted
    // - 20%: Average field confidence
    let confidence = 0;

    if (requiredPatterns > 0) {
      confidence += 0.5 * (requiredExtracted / requiredPatterns);
    } else {
      confidence += 0.5; // No required fields = full score for that portion
    }

    if (totalPatterns > 0) {
      confidence += 0.3 * (extractedCount / totalPatterns);
    }

    const avgFieldConfidence = extractedCount > 0
      ? Object.values(fields).reduce((sum, f) => sum + f.confidence, 0) / extractedCount
      : 0;
    confidence += 0.2 * avgFieldConfidence;

    const processingTime = Date.now() - startTime;

    logger.info({
      documentType: this.documentType,
      fieldsExtracted: extractedCount,
      totalPatterns,
      confidence,
      processingTimeMs: processingTime,
    }, 'BaseExtractor: Extraction complete');

    return {
      success: errors.length === 0 || extractedCount > 0,
      documentType: this.documentType,
      fields,
      confidence,
      metadata: {
        extractionMethod: 'pdf-parse', // Will be overridden by caller if Textract was used
        processingTimeMs: processingTime,
        pageCount: 1,
        textLength: text.length,
      },
      rawText: text,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Extract a single field using its patterns
   */
  protected extractField(text: string, fieldPattern: FieldPattern): ExtractedField | null {
    for (const pattern of fieldPattern.patterns) {
      const match = text.match(pattern);

      if (match && match[1]) {
        let value: string | number | boolean = match[1].trim();
        const rawMatch = match[0];

        // Apply post-processing if defined
        if (fieldPattern.postProcess) {
          try {
            value = fieldPattern.postProcess(value);
          } catch (error) {
            logger.warn({
              field: fieldPattern.name,
              value,
            }, 'BaseExtractor: Post-processing failed');
          }
        }

        // Type conversion based on field type
        value = this.convertFieldType(value, fieldPattern.type);

        // Calculate confidence based on pattern specificity and match quality
        const confidence = this.calculateMatchConfidence(match, pattern, text);

        return {
          name: fieldPattern.name,
          value,
          confidence,
          source: 'pattern',
          rawMatch,
        };
      }
    }

    return null;
  }

  /**
   * Convert extracted value to specified type
   */
  protected convertFieldType(
    value: string | number | boolean,
    type: 'string' | 'number' | 'date' | 'currency'
  ): string | number | boolean {
    // If already the right type, return as-is
    if (typeof value === 'number' && (type === 'number' || type === 'currency')) {
      return value;
    }
    if (typeof value === 'boolean') {
      return value;
    }

    const strValue = String(value);

    switch (type) {
      case 'number':
        const num = parseFloat(strValue.replace(/[,\s]/g, ''));
        return isNaN(num) ? strValue : num;

      case 'currency':
        // Remove currency symbols and convert to number
        const currencyNum = parseFloat(
          strValue.replace(/[$€£¥,\s]/g, '').replace(/[^\d.-]/g, '')
        );
        return isNaN(currencyNum) ? strValue : currencyNum;

      case 'date':
        // Keep as string but normalize format if possible
        return this.normalizeDate(strValue);

      default:
        return strValue;
    }
  }

  /**
   * Normalize date to ISO format if possible
   */
  protected normalizeDate(dateStr: string): string {
    // Common date formats: MM/DD/YYYY, DD/MM/YYYY, YYYY-MM-DD, Month DD, YYYY
    const patterns: Array<{ regex: RegExp; format: string }> = [
      // ISO format: YYYY-MM-DD
      { regex: /^(\d{4})-(\d{1,2})-(\d{1,2})$/, format: 'ISO' },
      // US format: MM/DD/YYYY or MM-DD-YYYY
      { regex: /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/, format: 'US' },
      // US format: MM/DD/YY or MM-DD-YY
      { regex: /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})$/, format: 'US_SHORT' },
      // Written: Month DD, YYYY
      { regex: /^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/, format: 'WRITTEN' },
    ];

    for (const { regex, format } of patterns) {
      const match = dateStr.trim().match(regex);
      if (match) {
        try {
          let year: number, month: number, day: number;

          switch (format) {
            case 'ISO':
              [, year, month, day] = match.map(Number);
              break;
            case 'US':
              [, month, day, year] = match.map(Number);
              break;
            case 'US_SHORT':
              [, month, day] = match.map(Number);
              year = parseInt(match[3]) + 2000;
              break;
            case 'WRITTEN':
              month = this.monthNameToNumber(match[1]);
              day = parseInt(match[2]);
              year = parseInt(match[3]);
              break;
            default:
              return dateStr;
          }

          // Validate and return ISO format
          if (year > 1900 && year < 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          }
        } catch {
          // Return original if parsing fails
        }
      }
    }

    return dateStr;
  }

  /**
   * Convert month name to number
   */
  protected monthNameToNumber(monthName: string): number {
    const months: Record<string, number> = {
      january: 1, jan: 1,
      february: 2, feb: 2,
      march: 3, mar: 3,
      april: 4, apr: 4,
      may: 5,
      june: 6, jun: 6,
      july: 7, jul: 7,
      august: 8, aug: 8,
      september: 9, sep: 9, sept: 9,
      october: 10, oct: 10,
      november: 11, nov: 11,
      december: 12, dec: 12,
    };
    return months[monthName.toLowerCase()] || 0;
  }

  /**
   * Calculate confidence score for a pattern match
   */
  protected calculateMatchConfidence(
    match: RegExpMatchArray,
    pattern: RegExp,
    fullText: string
  ): number {
    let confidence = 0.7; // Base confidence for a match

    // Boost for longer matches (more context)
    if (match[0].length > 20) confidence += 0.1;

    // Boost for exact case match if pattern is case-sensitive
    if (!pattern.flags.includes('i')) confidence += 0.05;

    // Reduce confidence if match is very short
    if (match[1] && match[1].length < 3) confidence -= 0.1;

    // Boost if match appears in expected location (first 30% of document)
    const matchPosition = fullText.indexOf(match[0]);
    if (matchPosition < fullText.length * 0.3) confidence += 0.1;

    return Math.min(Math.max(confidence, 0), 1);
  }

  /**
   * Extract all matches for a pattern (for line items, etc.)
   */
  protected extractAllMatches(text: string, pattern: RegExp): string[] {
    const matches: string[] = [];
    let match;

    // Create a new regex with global flag if not present
    const globalPattern = pattern.global
      ? pattern
      : new RegExp(pattern.source, pattern.flags + 'g');

    while ((match = globalPattern.exec(text)) !== null) {
      if (match[1]) {
        matches.push(match[1].trim());
      }
    }

    return matches;
  }
}
