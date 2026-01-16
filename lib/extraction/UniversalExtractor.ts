/**
 * UniversalExtractor
 *
 * Unified file extraction system supporting multiple file formats.
 * Routes files to the appropriate extractor based on MIME type.
 *
 * Extraction Strategy:
 * - PDF: pdf-parse (free) first, AWS Textract fallback for scanned
 * - Images: AWS Textract (best OCR accuracy)
 * - DOCX: mammoth (free)
 * - XLSX: xlsx/SheetJS (free)
 * - PPTX: officeparser (free)
 * - HTML: cheerio (free)
 * - TXT/CSV: Direct read (free)
 */

import { createLogger } from '@/lib/logger';
import type { OutputSchema } from './types';
import { PdfTypeDetector } from './PdfTypeDetector';
import { TextractClient } from './TextractClient';

const logger = createLogger({ module: 'UniversalExtractor', service: 'extraction' });

// ============================================================================
// Types
// ============================================================================

export interface UniversalExtractionInput {
  content: string;  // Base64 encoded content
  mimeType: string;
  filename?: string;
  outputSchema?: OutputSchema;
}

export interface UniversalExtractionResult {
  success: boolean;
  text: string;
  metadata: {
    mimeType: string;
    filename?: string;
    extractionMethod: string;
    processingTimeMs: number;
    pageCount?: number;
  };
  structuredData?: Record<string, any>;  // For formats with structure (Excel, tables)
  error?: string;
}

// Supported MIME types and their extractors
const MIME_TYPE_MAP: Record<string, string> = {
  // PDFs
  'application/pdf': 'pdf',

  // Images (OCR via Textract)
  'image/png': 'image',
  'image/jpeg': 'image',
  'image/jpg': 'image',
  'image/tiff': 'image',
  'image/bmp': 'image',
  'image/gif': 'image',
  'image/webp': 'image',

  // Word documents
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/msword': 'doc',

  // Excel spreadsheets
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xls',

  // PowerPoint presentations
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.ms-powerpoint': 'ppt',

  // Text formats
  'text/plain': 'text',
  'text/csv': 'csv',
  'text/html': 'html',
  'application/json': 'json',
  'application/xml': 'xml',
  'text/xml': 'xml',
};

// ============================================================================
// UniversalExtractor Class
// ============================================================================

export class UniversalExtractor {
  private pdfDetector: PdfTypeDetector;
  private textractClient: TextractClient;

  constructor() {
    this.pdfDetector = new PdfTypeDetector();
    this.textractClient = new TextractClient();
  }

  /**
   * Extract text and structured data from any supported file
   */
  async extract(input: UniversalExtractionInput): Promise<UniversalExtractionResult> {
    const startTime = Date.now();
    const { content, mimeType, filename } = input;

    logger.info({ mimeType, filename, contentLength: content.length }, 'UniversalExtractor: Starting extraction');

    // Determine extractor type
    const extractorType = this.getExtractorType(mimeType, filename);

    if (!extractorType) {
      return {
        success: false,
        text: '',
        metadata: {
          mimeType,
          filename,
          extractionMethod: 'none',
          processingTimeMs: Date.now() - startTime,
        },
        error: `Unsupported file type: ${mimeType}`,
      };
    }

    try {
      let result: UniversalExtractionResult;

      switch (extractorType) {
        case 'pdf':
          result = await this.extractPdf(content);
          break;
        case 'image':
          result = await this.extractImage(content);
          break;
        case 'docx':
        case 'doc':
          result = await this.extractWord(content);
          break;
        case 'xlsx':
        case 'xls':
          result = await this.extractExcel(content);
          break;
        case 'pptx':
        case 'ppt':
          result = await this.extractPowerPoint(content);
          break;
        case 'html':
          result = await this.extractHtml(content);
          break;
        case 'csv':
          result = await this.extractCsv(content);
          break;
        case 'json':
          result = await this.extractJson(content);
          break;
        case 'xml':
          result = await this.extractXml(content);
          break;
        case 'text':
        default:
          result = await this.extractText(content);
          break;
      }

      result.metadata.mimeType = mimeType;
      result.metadata.filename = filename;
      result.metadata.processingTimeMs = Date.now() - startTime;

      logger.info({
        success: result.success,
        textLength: result.text.length,
        method: result.metadata.extractionMethod,
        processingTimeMs: result.metadata.processingTimeMs,
      }, 'UniversalExtractor: Extraction complete');

      return result;
    } catch (error: any) {
      logger.error({ err: error, mimeType, filename }, 'UniversalExtractor: Extraction failed');
      return {
        success: false,
        text: '',
        metadata: {
          mimeType,
          filename,
          extractionMethod: 'error',
          processingTimeMs: Date.now() - startTime,
        },
        error: error.message,
      };
    }
  }

  /**
   * Determine extractor type from MIME type or filename extension
   */
  private getExtractorType(mimeType: string, filename?: string): string | null {
    // First check MIME type
    const normalized = mimeType.toLowerCase();
    if (MIME_TYPE_MAP[normalized]) {
      return MIME_TYPE_MAP[normalized];
    }

    // Fallback to filename extension
    if (filename) {
      const ext = filename.split('.').pop()?.toLowerCase();
      const extensionMap: Record<string, string> = {
        pdf: 'pdf',
        png: 'image',
        jpg: 'image',
        jpeg: 'image',
        tiff: 'image',
        tif: 'image',
        bmp: 'image',
        gif: 'image',
        webp: 'image',
        docx: 'docx',
        doc: 'doc',
        xlsx: 'xlsx',
        xls: 'xls',
        pptx: 'pptx',
        ppt: 'ppt',
        txt: 'text',
        csv: 'csv',
        html: 'html',
        htm: 'html',
        json: 'json',
        xml: 'xml',
      };
      if (ext && extensionMap[ext]) {
        return extensionMap[ext];
      }
    }

    return null;
  }

  /**
   * Get list of supported MIME types
   */
  getSupportedMimeTypes(): string[] {
    return Object.keys(MIME_TYPE_MAP);
  }

  /**
   * Check if a MIME type is supported
   */
  isSupported(mimeType: string, filename?: string): boolean {
    return this.getExtractorType(mimeType, filename) !== null;
  }

  // ============================================================================
  // Individual Extractors
  // ============================================================================

  /**
   * Extract from PDF - uses PdfTypeDetector for smart routing
   */
  private async extractPdf(content: string): Promise<UniversalExtractionResult> {
    const result = await this.pdfDetector.analyze(content);

    return {
      success: result.confidence > 0,
      text: result.textContent,
      metadata: {
        mimeType: 'application/pdf',
        extractionMethod: result.source === 'textract' ? 'pdf-textract' : 'pdf-parse',
        processingTimeMs: 0,
        pageCount: result.metrics.pageCount,
      },
    };
  }

  /**
   * Extract from images using AWS Textract OCR
   */
  private async extractImage(content: string): Promise<UniversalExtractionResult> {
    const result = await this.textractClient.analyzeDocument(content);

    return {
      success: result.success,
      text: result.text,
      metadata: {
        mimeType: 'image/*',
        extractionMethod: 'textract-ocr',
        processingTimeMs: 0,
      },
      structuredData: {
        keyValuePairs: result.keyValuePairs,
        tables: result.tables,
      },
      error: result.error,
    };
  }

  /**
   * Extract from Word documents using mammoth
   */
  private async extractWord(content: string): Promise<UniversalExtractionResult> {
    try {
      const mammoth = await import('mammoth');
      const buffer = Buffer.from(content, 'base64');

      const result = await mammoth.extractRawText({ buffer });

      return {
        success: true,
        text: result.value,
        metadata: {
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          extractionMethod: 'mammoth',
          processingTimeMs: 0,
        },
      };
    } catch (error: any) {
      logger.error({ err: error }, 'UniversalExtractor: Word extraction failed');
      return {
        success: false,
        text: '',
        metadata: {
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          extractionMethod: 'mammoth',
          processingTimeMs: 0,
        },
        error: error.message,
      };
    }
  }

  /**
   * Extract from Excel spreadsheets using xlsx
   */
  private async extractExcel(content: string): Promise<UniversalExtractionResult> {
    try {
      const XLSX = await import('xlsx');
      const buffer = Buffer.from(content, 'base64');

      const workbook = XLSX.read(buffer, { type: 'buffer' });
      const textParts: string[] = [];
      const sheets: Record<string, any[][]> = {};

      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];

        // Convert to array of arrays for structured data
        const data = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];
        sheets[sheetName] = data;

        // Convert to text for text extraction
        const text = XLSX.utils.sheet_to_txt(sheet);
        textParts.push(`=== Sheet: ${sheetName} ===\n${text}`);
      }

      return {
        success: true,
        text: textParts.join('\n\n'),
        metadata: {
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          extractionMethod: 'xlsx',
          processingTimeMs: 0,
        },
        structuredData: {
          sheets,
          sheetNames: workbook.SheetNames,
        },
      };
    } catch (error: any) {
      logger.error({ err: error }, 'UniversalExtractor: Excel extraction failed');
      return {
        success: false,
        text: '',
        metadata: {
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          extractionMethod: 'xlsx',
          processingTimeMs: 0,
        },
        error: error.message,
      };
    }
  }

  /**
   * Extract from PowerPoint presentations using officeparser
   */
  private async extractPowerPoint(content: string): Promise<UniversalExtractionResult> {
    try {
      const { parseOffice } = await import('officeparser');
      const buffer = Buffer.from(content, 'base64');

      // officeparser returns an AST with toText() method
      const ast = await parseOffice(buffer);
      const text = ast.toText();

      return {
        success: true,
        text,
        metadata: {
          mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          extractionMethod: 'officeparser',
          processingTimeMs: 0,
        },
        structuredData: {
          metadata: ast.metadata,
        },
      };
    } catch (error: any) {
      logger.error({ err: error }, 'UniversalExtractor: PowerPoint extraction failed');
      return {
        success: false,
        text: '',
        metadata: {
          mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          extractionMethod: 'officeparser',
          processingTimeMs: 0,
        },
        error: error.message,
      };
    }
  }

  /**
   * Extract from HTML using cheerio
   */
  private async extractHtml(content: string): Promise<UniversalExtractionResult> {
    try {
      const cheerio = await import('cheerio');
      const html = Buffer.from(content, 'base64').toString('utf-8');

      const $ = cheerio.load(html);

      // Remove script and style elements
      $('script, style, noscript').remove();

      // Get text content
      const text = $('body').text().replace(/\s+/g, ' ').trim();

      // Extract structured data
      const title = $('title').text();
      const headings = $('h1, h2, h3, h4, h5, h6').map((_, el) => $(el).text()).get();
      const links = $('a[href]').map((_, el) => ({
        text: $(el).text(),
        href: $(el).attr('href'),
      })).get();

      return {
        success: true,
        text,
        metadata: {
          mimeType: 'text/html',
          extractionMethod: 'cheerio',
          processingTimeMs: 0,
        },
        structuredData: {
          title,
          headings,
          links,
        },
      };
    } catch (error: any) {
      logger.error({ err: error }, 'UniversalExtractor: HTML extraction failed');
      return {
        success: false,
        text: '',
        metadata: {
          mimeType: 'text/html',
          extractionMethod: 'cheerio',
          processingTimeMs: 0,
        },
        error: error.message,
      };
    }
  }

  /**
   * Extract from CSV files
   */
  private async extractCsv(content: string): Promise<UniversalExtractionResult> {
    try {
      const text = Buffer.from(content, 'base64').toString('utf-8');

      // Parse CSV into structured data
      const lines = text.split('\n').filter(line => line.trim());
      const rows = lines.map(line => {
        // Simple CSV parsing (handles basic cases)
        const values: string[] = [];
        let current = '';
        let inQuotes = false;

        for (const char of line) {
          if (char === '"') {
            inQuotes = !inQuotes;
          } else if (char === ',' && !inQuotes) {
            values.push(current.trim());
            current = '';
          } else {
            current += char;
          }
        }
        values.push(current.trim());
        return values;
      });

      return {
        success: true,
        text,
        metadata: {
          mimeType: 'text/csv',
          extractionMethod: 'csv-parse',
          processingTimeMs: 0,
        },
        structuredData: {
          rows,
          headers: rows[0] || [],
          data: rows.slice(1),
        },
      };
    } catch (error: any) {
      logger.error({ err: error }, 'UniversalExtractor: CSV extraction failed');
      return {
        success: false,
        text: '',
        metadata: {
          mimeType: 'text/csv',
          extractionMethod: 'csv-parse',
          processingTimeMs: 0,
        },
        error: error.message,
      };
    }
  }

  /**
   * Extract from JSON files
   */
  private async extractJson(content: string): Promise<UniversalExtractionResult> {
    try {
      const text = Buffer.from(content, 'base64').toString('utf-8');
      const parsed = JSON.parse(text);

      // Create readable text representation
      const readableText = JSON.stringify(parsed, null, 2);

      return {
        success: true,
        text: readableText,
        metadata: {
          mimeType: 'application/json',
          extractionMethod: 'json-parse',
          processingTimeMs: 0,
        },
        structuredData: parsed,
      };
    } catch (error: any) {
      logger.error({ err: error }, 'UniversalExtractor: JSON extraction failed');
      return {
        success: false,
        text: '',
        metadata: {
          mimeType: 'application/json',
          extractionMethod: 'json-parse',
          processingTimeMs: 0,
        },
        error: error.message,
      };
    }
  }

  /**
   * Extract from XML files
   */
  private async extractXml(content: string): Promise<UniversalExtractionResult> {
    try {
      const cheerio = await import('cheerio');
      const xml = Buffer.from(content, 'base64').toString('utf-8');

      const $ = cheerio.load(xml, { xmlMode: true });

      // Get text content from all elements
      const text = $.root().text().replace(/\s+/g, ' ').trim();

      return {
        success: true,
        text,
        metadata: {
          mimeType: 'application/xml',
          extractionMethod: 'cheerio-xml',
          processingTimeMs: 0,
        },
        structuredData: {
          rawXml: xml,
        },
      };
    } catch (error: any) {
      logger.error({ err: error }, 'UniversalExtractor: XML extraction failed');
      return {
        success: false,
        text: '',
        metadata: {
          mimeType: 'application/xml',
          extractionMethod: 'cheerio-xml',
          processingTimeMs: 0,
        },
        error: error.message,
      };
    }
  }

  /**
   * Extract from plain text files
   */
  private async extractText(content: string): Promise<UniversalExtractionResult> {
    try {
      const text = Buffer.from(content, 'base64').toString('utf-8');

      return {
        success: true,
        text,
        metadata: {
          mimeType: 'text/plain',
          extractionMethod: 'text-decode',
          processingTimeMs: 0,
        },
      };
    } catch (error: any) {
      logger.error({ err: error }, 'UniversalExtractor: Text extraction failed');
      return {
        success: false,
        text: '',
        metadata: {
          mimeType: 'text/plain',
          extractionMethod: 'text-decode',
          processingTimeMs: 0,
        },
        error: error.message,
      };
    }
  }
}

// Export singleton instance
export const universalExtractor = new UniversalExtractor();
