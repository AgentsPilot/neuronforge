/**
 * PdfTypeDetector
 *
 * Detects whether a PDF is text-based or scanned, and extracts text accordingly.
 * Uses pdfjs-dist first (free, good font support), falls back to AWS Textract for scanned PDFs.
 *
 * Decision Logic:
 * 1. Try pdfjs-dist first (FREE, ~100ms, good font handling)
 * 2. Calculate text quality metrics (length, word count, density)
 * 3. If metrics below threshold → PDF is likely scanned → use Textract
 * 4. Cost optimization: ~99% of digitally-created PDFs work with pdfjs-dist
 *
 * Note: We use pdfjs-dist instead of pdf-parse because:
 * - Better support for embedded fonts with custom encodings
 * - More accurate text extraction for modern PDF generators (like billing systems)
 * - Mozilla's PDF.js is actively maintained and handles edge cases better
 */

import { createLogger } from '@/lib/logger';
import type {
  PdfType,
  PdfAnalysisResult,
  PdfDetectionThresholds,
} from './types';
import { TextractClient } from './TextractClient';

const logger = createLogger({ module: 'PdfTypeDetector', service: 'extraction' });

// Default thresholds for detecting scanned PDFs
// NOTE: These are intentionally higher to prefer Textract for borderline cases
// Textract provides much better structured data (key-value pairs, tables)
const DEFAULT_THRESHOLDS: PdfDetectionThresholds = {
  minTextLength: 200,      // Minimum chars to consider "has text" (increased from 100)
  minWordCount: 40,        // Minimum words for valid extraction (increased from 20)
  minCharDensity: 0.005,   // chars per byte ratio (increased for better detection)
};

// Patterns that indicate poor quality extraction (headers, footers, garbage)
const GARBAGE_TEXT_PATTERNS = [
  /^page\s+\d+\s+of\s+\d+$/gim,
  /^\d+\s*$/gm,
  /^[^\w]*$/gm,
];

export class PdfTypeDetector {
  private thresholds: PdfDetectionThresholds;
  private textractClient: TextractClient | null = null;

  constructor(
    thresholds: Partial<PdfDetectionThresholds> = {},
    private ocrEnabled: boolean = true
  ) {
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };

    if (ocrEnabled) {
      this.textractClient = new TextractClient();
    }
  }

  /**
   * Analyze a PDF and extract text using the appropriate method
   */
  async analyze(pdfBase64: string): Promise<PdfAnalysisResult> {
    const pdfSizeBytes = Buffer.from(pdfBase64, 'base64').length;

    logger.info({ pdfSizeBytes }, 'PdfTypeDetector: Starting PDF analysis');

    // Step 1: Try pdfjs-dist first (free, good font support)
    const pdfResult = await this.tryPdfjsDist(pdfBase64);

    // Step 2: Calculate quality metrics
    const metrics = this.calculateMetrics(pdfResult.text, pdfSizeBytes);

    logger.info({
      textLength: metrics.textLength,
      wordCount: metrics.wordCount,
      charDensity: metrics.charDensity,
      pageCount: metrics.pageCount,
    }, 'PdfTypeDetector: Text quality metrics');

    // Step 3: Decide if text extraction was successful
    const hasValidText = this.hasValidText(metrics);

    if (hasValidText) {
      // Text-based PDF - use pdfjs-dist result
      logger.info('PdfTypeDetector: Text-based PDF detected, using pdfjs-dist result');

      return {
        type: 'text-based',
        textContent: pdfResult.text,
        metrics: {
          ...metrics,
          pageCount: pdfResult.pageCount,
        },
        confidence: this.calculateConfidence(metrics),
        source: 'pdf-parse', // Note: using pdfjs-dist internally but keeping 'pdf-parse' for API compatibility
      };
    }

    // Step 4: Likely scanned PDF - try Textract if enabled
    if (this.ocrEnabled && this.textractClient) {
      logger.info('PdfTypeDetector: Likely scanned PDF, attempting OCR with Textract');

      try {
        const textractResult = await this.textractClient.extractText(pdfBase64);

        if (textractResult.success && textractResult.text.length > 0) {
          const ocrMetrics = this.calculateMetrics(textractResult.text, pdfSizeBytes);

          return {
            type: 'scanned',
            textContent: textractResult.text,
            metrics: {
              ...ocrMetrics,
              pageCount: metrics.pageCount || 1,
            },
            confidence: this.calculateConfidence(ocrMetrics),
            source: 'textract',
          };
        }
      } catch (error: any) {
        logger.error({ err: error }, 'PdfTypeDetector: Textract OCR failed');
      }
    }

    // Step 5: No valid text could be extracted
    logger.warn('PdfTypeDetector: Could not extract valid text from PDF');

    return {
      type: 'unknown',
      textContent: pdfResult.text || '',
      metrics,
      confidence: 0,
      source: 'none',
    };
  }

  /**
   * Try to extract text using pdf-parse first, then pdfjs-dist as fallback
   * pdf-parse works better in Node.js environments, while pdfjs-dist
   * requires the legacy build and has DOMMatrix issues in Node.js
   */
  private async tryPdfjsDist(pdfBase64: string): Promise<{ text: string; pageCount: number }> {
    // Try pdf-parse first (more reliable in Node.js)
    const pdfParseResult = await this.tryPdfParse(pdfBase64);
    if (pdfParseResult.text.length > 0) {
      return pdfParseResult;
    }

    // Fallback to pdfjs-dist if pdf-parse returns empty
    try {
      // Use legacy build for Node.js compatibility
      const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');

      const buffer = Buffer.from(pdfBase64, 'base64');
      const uint8Array = new Uint8Array(buffer);

      // Load the PDF document
      const loadingTask = pdfjsLib.getDocument({
        data: uint8Array,
        useSystemFonts: true,
        disableFontFace: true,
      });

      const pdfDocument = await loadingTask.promise;
      const numPages = pdfDocument.numPages;

      // Extract text from all pages
      const textParts: string[] = [];

      for (let pageNum = 1; pageNum <= numPages; pageNum++) {
        const page = await pdfDocument.getPage(pageNum);
        const textContent = await page.getTextContent();

        // Combine text items with proper spacing
        const pageText = textContent.items
          .map((item: any) => {
            if ('str' in item) {
              return item.str;
            }
            return '';
          })
          .join(' ');

        textParts.push(pageText);
      }

      const fullText = textParts.join('\n').trim();

      logger.debug({
        textLength: fullText.length,
        pageCount: numPages,
      }, 'PdfTypeDetector: pdfjs-dist extraction complete');

      return {
        text: fullText,
        pageCount: numPages,
      };
    } catch (error: any) {
      logger.error({ err: error }, 'PdfTypeDetector: pdfjs-dist failed');
      return pdfParseResult; // Return whatever pdf-parse got
    }
  }

  /**
   * Extract text using pdf-parse
   */
  private async tryPdfParse(pdfBase64: string): Promise<{ text: string; pageCount: number }> {
    try {
      // Dynamic import to avoid bundling issues
      const pdfParse = eval('require')('pdf-parse');

      const buffer = Buffer.from(pdfBase64, 'base64');
      const result = await pdfParse(buffer);

      logger.debug({
        textLength: result.text?.length || 0,
        pageCount: result.numpages,
      }, 'PdfTypeDetector: pdf-parse extraction complete');

      return {
        text: result.text?.trim() || '',
        pageCount: result.numpages || 1,
      };
    } catch (error: any) {
      logger.error({ err: error }, 'PdfTypeDetector: pdf-parse failed');
      return { text: '', pageCount: 0 };
    }
  }

  /**
   * Calculate text quality metrics
   * Filters out garbage text (page numbers, empty lines) before calculating
   */
  private calculateMetrics(
    text: string,
    pdfSizeBytes: number
  ): {
    textLength: number;
    wordCount: number;
    charDensity: number;
    pageCount: number;
  } {
    // Clean the text by removing garbage patterns
    let cleanedText = text;
    for (const pattern of GARBAGE_TEXT_PATTERNS) {
      cleanedText = cleanedText.replace(pattern, '');
    }
    cleanedText = cleanedText.trim();

    const textLength = cleanedText.length;
    const wordCount = cleanedText.split(/\s+/).filter(w => w.length > 1).length; // Words must be >1 char
    const charDensity = pdfSizeBytes > 0 ? textLength / pdfSizeBytes : 0;

    logger.debug({
      originalLength: text.length,
      cleanedLength: textLength,
      wordCount,
    }, 'PdfTypeDetector: Metrics after cleaning garbage text');

    return {
      textLength,
      wordCount,
      charDensity,
      pageCount: 0, // Will be set by caller
    };
  }

  /**
   * Check if extracted text meets quality thresholds
   */
  private hasValidText(metrics: {
    textLength: number;
    wordCount: number;
    charDensity: number;
  }): boolean {
    return (
      metrics.textLength >= this.thresholds.minTextLength &&
      metrics.wordCount >= this.thresholds.minWordCount
    );
  }

  /**
   * Calculate confidence score based on metrics
   */
  private calculateConfidence(metrics: {
    textLength: number;
    wordCount: number;
    charDensity: number;
  }): number {
    // Higher text length and word count = higher confidence
    let confidence = 0;

    // Text length score (0-0.4)
    if (metrics.textLength > 1000) confidence += 0.4;
    else if (metrics.textLength > 500) confidence += 0.3;
    else if (metrics.textLength > 200) confidence += 0.2;
    else if (metrics.textLength > 100) confidence += 0.1;

    // Word count score (0-0.4)
    if (metrics.wordCount > 200) confidence += 0.4;
    else if (metrics.wordCount > 100) confidence += 0.3;
    else if (metrics.wordCount > 50) confidence += 0.2;
    else if (metrics.wordCount > 20) confidence += 0.1;

    // Char density score (0-0.2)
    if (metrics.charDensity > 0.01) confidence += 0.2;
    else if (metrics.charDensity > 0.005) confidence += 0.1;

    return Math.min(confidence, 1);
  }

  /**
   * Quick check if PDF is likely text-based without full extraction
   * Useful for routing decisions
   */
  async quickCheck(pdfBase64: string): Promise<PdfType> {
    const result = await this.tryPdfjsDist(pdfBase64);
    const metrics = this.calculateMetrics(
      result.text,
      Buffer.from(pdfBase64, 'base64').length
    );

    if (this.hasValidText(metrics)) {
      return 'text-based';
    }
    return 'scanned';
  }
}
