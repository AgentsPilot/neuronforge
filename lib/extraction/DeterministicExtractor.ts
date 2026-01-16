/**
 * DeterministicExtractor
 *
 * Schema-driven document extraction that works across all file types.
 * No LLM - purely deterministic extraction based on:
 * 1. Structured data (CSV/Excel) → Direct column mapping
 * 2. Textract key-value pairs + tables (PDF/images with OCR)
 * 3. Generic text pattern matching
 *
 * Cost model:
 * - PDF (text-based): FREE (pdf-parse/pdfjs-dist)
 * - PDF (scanned): ~$0.0015/page (AWS Textract)
 * - Images: ~$0.0015/page (AWS Textract)
 * - Word/Excel/CSV/HTML: FREE
 */

import { createLogger } from '@/lib/logger';
import { PdfTypeDetector } from './PdfTypeDetector';
import { UniversalExtractor } from './UniversalExtractor';
import { SchemaFieldExtractor, ExtractionInput } from './SchemaFieldExtractor';
import type { OutputSchema } from './types';

const logger = createLogger({ module: 'DeterministicExtractor', service: 'extraction' });

export interface DeterministicExtractionInput {
  content: string; // Base64 encoded content
  mimeType: string;
  filename?: string;
  config?: {
    documentType?: string; // Ignored - we're schema-driven now
    outputSchema?: OutputSchema;
    ocrFallback?: boolean;
  };
  inputContext?: Record<string, any>; // Pass-through fields from workflow
}

export interface DeterministicExtractionResult {
  success: boolean;
  data: Record<string, any>;
  confidence: number;
  needsLlmFallback: false; // Always false - no LLM
  metadata: {
    extractionMethod: 'pdf-parse' | 'textract' | 'structured' | 'text';
    processingTimeMs: number;
    textLength: number;
    fieldsExtracted: number;
    fieldsRequested: number;
    missingFields: string[];
    uncertainFields: string[];
  };
  rawText?: string;
  errors?: string[];
}

export class DeterministicExtractor {
  private pdfDetector: PdfTypeDetector;
  private universalExtractor: UniversalExtractor;
  private schemaExtractor: SchemaFieldExtractor;

  constructor(ocrEnabled: boolean = true) {
    this.pdfDetector = new PdfTypeDetector({}, ocrEnabled);
    this.universalExtractor = new UniversalExtractor();
    this.schemaExtractor = new SchemaFieldExtractor();
  }

  /**
   * Extract structured data from a document based on output_schema
   */
  async extract(input: DeterministicExtractionInput): Promise<DeterministicExtractionResult> {
    const startTime = Date.now();
    const config = input.config || {};

    logger.info({
      mimeType: input.mimeType,
      filename: input.filename,
      hasOutputSchema: !!config.outputSchema,
      hasInputContext: !!input.inputContext,
      ocrEnabled: config.ocrFallback !== false,
    }, 'DeterministicExtractor: Starting schema-driven extraction');

    try {
      // Build extraction input based on file type
      const extractionInput = await this.buildExtractionInput(input);

      // If no schema provided, return raw text only
      if (!config.outputSchema || config.outputSchema.fields.length === 0) {
        return this.createRawTextResult(extractionInput, startTime);
      }

      // Run schema-driven extraction
      const result = this.schemaExtractor.extract(extractionInput, config.outputSchema);

      const processingTime = Date.now() - startTime;

      logger.info({
        success: result.success,
        extractionMethod: extractionInput.keyValuePairs?.length ? 'textract' :
                         extractionInput.structuredData ? 'structured' : 'text',
        fieldsExtracted: Object.keys(result.fields).length,
        fieldsRequested: config.outputSchema.fields.length,
        confidence: result.confidence,
        processingTimeMs: processingTime,
      }, 'DeterministicExtractor: Extraction complete');

      return {
        success: result.success,
        data: result.data,
        confidence: result.confidence,
        needsLlmFallback: false,
        metadata: {
          extractionMethod: extractionInput.keyValuePairs?.length ? 'textract' :
                           extractionInput.structuredData ? 'structured' : 'text',
          processingTimeMs: processingTime,
          textLength: extractionInput.text?.length || 0,
          fieldsExtracted: Object.keys(result.fields).length,
          fieldsRequested: config.outputSchema.fields.length,
          missingFields: result.missingFields,
          uncertainFields: result.uncertainFields,
        },
        rawText: extractionInput.text,
        errors: result.missingFields.length > 0
          ? [`Missing required fields: ${result.missingFields.join(', ')}`]
          : undefined,
      };
    } catch (error: any) {
      logger.error({ err: error }, 'DeterministicExtractor: Extraction failed');
      return this.createFailureResult(error.message, startTime, config.outputSchema);
    }
  }

  /**
   * Build extraction input based on file type
   */
  private async buildExtractionInput(input: DeterministicExtractionInput): Promise<ExtractionInput> {
    const config = input.config || {};
    const ocrEnabled = config.ocrFallback !== false;

    // Start with input context (pass-through fields)
    const extractionInput: ExtractionInput = {
      text: '',
      inputContext: input.inputContext,
    };

    // Handle based on MIME type
    if (input.mimeType === 'application/pdf') {
      return this.handlePdf(input, extractionInput, ocrEnabled);
    }

    if (input.mimeType.startsWith('image/')) {
      return this.handleImage(input, extractionInput, ocrEnabled);
    }

    if (this.isStructuredFormat(input.mimeType)) {
      return this.handleStructured(input, extractionInput);
    }

    if (this.universalExtractor.isSupported(input.mimeType, input.filename)) {
      return this.handleUniversal(input, extractionInput);
    }

    if (input.mimeType === 'text/plain') {
      extractionInput.text = Buffer.from(input.content, 'base64').toString('utf-8');
      return extractionInput;
    }

    throw new Error(`Unsupported MIME type: ${input.mimeType}`);
  }

  /**
   * Handle PDF extraction
   */
  private async handlePdf(
    input: DeterministicExtractionInput,
    extractionInput: ExtractionInput,
    ocrEnabled: boolean
  ): Promise<ExtractionInput> {
    // First try free text extraction
    const pdfResult = await this.pdfDetector.analyze(input.content);
    extractionInput.text = pdfResult.textContent;

    // If text extraction failed or low quality, try Textract for structured data
    if (ocrEnabled && (pdfResult.type === 'scanned' || pdfResult.confidence < 0.5)) {
      const textractResult = await this.tryTextract(input.content);
      if (textractResult) {
        extractionInput.text = textractResult.text || extractionInput.text;
        extractionInput.keyValuePairs = textractResult.keyValuePairs;
        extractionInput.tables = textractResult.tables;
      }
    } else if (ocrEnabled && pdfResult.textContent.length > 50) {
      // Even for text-based PDFs, try Textract's analyzeDocument for better structured extraction
      // But only if we have valid text (not scanned gibberish)
      const textractResult = await this.tryTextract(input.content);
      if (textractResult && textractResult.keyValuePairs?.length) {
        extractionInput.keyValuePairs = textractResult.keyValuePairs;
        extractionInput.tables = textractResult.tables;
      }
    }

    return extractionInput;
  }

  /**
   * Handle image extraction (always requires OCR)
   */
  private async handleImage(
    input: DeterministicExtractionInput,
    extractionInput: ExtractionInput,
    ocrEnabled: boolean
  ): Promise<ExtractionInput> {
    if (!ocrEnabled) {
      throw new Error('Image extraction requires OCR - enable ocr_fallback');
    }

    const textractResult = await this.tryTextract(input.content);
    if (!textractResult || !textractResult.text) {
      throw new Error('OCR extraction failed - check AWS Textract configuration');
    }

    extractionInput.text = textractResult.text;
    extractionInput.keyValuePairs = textractResult.keyValuePairs;
    extractionInput.tables = textractResult.tables;

    return extractionInput;
  }

  /**
   * Handle structured formats (CSV, Excel)
   */
  private async handleStructured(
    input: DeterministicExtractionInput,
    extractionInput: ExtractionInput
  ): Promise<ExtractionInput> {
    const buffer = Buffer.from(input.content, 'base64');

    if (input.mimeType === 'text/csv') {
      // Parse CSV
      const csvText = buffer.toString('utf-8');
      extractionInput.text = csvText;
      extractionInput.structuredData = this.parseCsv(csvText);
    } else if (input.mimeType.includes('spreadsheet') || input.mimeType.includes('excel')) {
      // Parse Excel
      const xlsx = await import('xlsx');
      const workbook = xlsx.read(buffer, { type: 'buffer' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = xlsx.utils.sheet_to_json(firstSheet);
      extractionInput.structuredData = jsonData;
      extractionInput.text = xlsx.utils.sheet_to_csv(firstSheet);
    } else if (input.mimeType === 'application/json') {
      // Parse JSON
      const jsonText = buffer.toString('utf-8');
      extractionInput.text = jsonText;
      try {
        extractionInput.structuredData = JSON.parse(jsonText);
      } catch {
        // Invalid JSON - use as text
      }
    }

    return extractionInput;
  }

  /**
   * Handle other universal formats (Word, PowerPoint, HTML)
   */
  private async handleUniversal(
    input: DeterministicExtractionInput,
    extractionInput: ExtractionInput
  ): Promise<ExtractionInput> {
    const result = await this.universalExtractor.extract({
      content: input.content,
      mimeType: input.mimeType,
      filename: input.filename,
    });

    if (!result.success) {
      throw new Error(result.error || 'UniversalExtractor failed');
    }

    extractionInput.text = result.text || '';
    return extractionInput;
  }

  /**
   * Try Textract for structured extraction
   */
  private async tryTextract(content: string): Promise<{
    text: string;
    keyValuePairs: Array<{ key: string; value: string; confidence: number }>;
    tables: Array<{ rows: string[][]; confidence: number }>;
  } | null> {
    try {
      const { TextractClient } = await import('./TextractClient');
      const textractClient = new TextractClient();

      if (!await textractClient.isAvailable()) {
        logger.debug('DeterministicExtractor: Textract not available');
        return null;
      }

      // Use analyzeDocument for structured extraction
      const result = await textractClient.analyzeDocument(content);

      if (!result.success) {
        logger.warn({ error: result.error }, 'DeterministicExtractor: Textract failed');
        return null;
      }

      return {
        text: result.text,
        keyValuePairs: result.keyValuePairs || [],
        tables: result.tables || [],
      };
    } catch (error: any) {
      logger.warn({ err: error }, 'DeterministicExtractor: Textract error');
      return null;
    }
  }

  /**
   * Check if MIME type is a structured format
   */
  private isStructuredFormat(mimeType: string): boolean {
    return [
      'text/csv',
      'application/json',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
    ].includes(mimeType);
  }

  /**
   * Simple CSV parser
   */
  private parseCsv(csvText: string): Record<string, any>[] {
    const lines = csvText.trim().split('\n');
    if (lines.length < 2) return [];

    const headers = this.parseCsvLine(lines[0]);
    const rows: Record<string, any>[] = [];

    for (let i = 1; i < lines.length; i++) {
      const values = this.parseCsvLine(lines[i]);
      const row: Record<string, any> = {};
      headers.forEach((header, idx) => {
        row[header] = values[idx] || '';
      });
      rows.push(row);
    }

    return rows;
  }

  /**
   * Parse a single CSV line handling quotes
   */
  private parseCsvLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    result.push(current.trim());

    return result;
  }

  /**
   * Create result when no schema provided - returns raw text and any structured data
   * This is useful for "analyze this file" scenarios where no specific fields are needed
   */
  private createRawTextResult(
    extractionInput: ExtractionInput,
    startTime: number
  ): DeterministicExtractionResult {
    const processingTime = Date.now() - startTime;

    // Build data object with everything we extracted
    const data: Record<string, any> = {
      rawText: extractionInput.text,
    };

    // Include structured data if available (CSV/Excel rows, JSON)
    if (extractionInput.structuredData) {
      data.structuredData = extractionInput.structuredData;
    }

    // Include Textract key-value pairs if available (useful for forms)
    if (extractionInput.keyValuePairs?.length) {
      data.keyValuePairs = extractionInput.keyValuePairs.reduce((acc, kv) => {
        acc[kv.key] = kv.value;
        return acc;
      }, {} as Record<string, string>);
    }

    // Include tables if available
    if (extractionInput.tables?.length) {
      data.tables = extractionInput.tables.map(t => t.rows);
    }

    // Include any input context that was passed through
    if (extractionInput.inputContext) {
      data.inputContext = extractionInput.inputContext;
    }

    return {
      success: true,
      data,
      confidence: 1,
      needsLlmFallback: false,
      metadata: {
        extractionMethod: extractionInput.keyValuePairs?.length ? 'textract' :
                         extractionInput.structuredData ? 'structured' : 'text',
        processingTimeMs: processingTime,
        textLength: extractionInput.text?.length || 0,
        fieldsExtracted: 0,
        fieldsRequested: 0,
        missingFields: [],
        uncertainFields: [],
      },
      rawText: extractionInput.text,
    };
  }

  /**
   * Create failure result
   */
  private createFailureResult(
    error: string,
    startTime: number,
    outputSchema?: OutputSchema
  ): DeterministicExtractionResult {
    const processingTime = Date.now() - startTime;
    return {
      success: false,
      data: {},
      confidence: 0,
      needsLlmFallback: false,
      metadata: {
        extractionMethod: 'text',
        processingTimeMs: processingTime,
        textLength: 0,
        fieldsExtracted: 0,
        fieldsRequested: outputSchema?.fields.length || 0,
        missingFields: outputSchema?.fields.map(f => f.name) || [],
        uncertainFields: [],
      },
      errors: [error],
    };
  }

  /**
   * Quick check if extraction is supported for a file type
   */
  canExtract(mimeType: string, filename?: string): boolean {
    return (
      mimeType === 'application/pdf' ||
      mimeType.startsWith('image/') ||
      mimeType === 'text/plain' ||
      this.isStructuredFormat(mimeType) ||
      this.universalExtractor.isSupported(mimeType, filename)
    );
  }
}
