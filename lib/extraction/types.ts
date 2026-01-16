/**
 * Deterministic Extraction Types
 *
 * Type definitions for the deterministic document extraction pipeline.
 * This system extracts structured data from PDFs and images without LLM calls.
 */

// ============================================================================
// PDF Detection Types
// ============================================================================

export type PdfType = 'text-based' | 'scanned' | 'mixed' | 'unknown';

export interface PdfAnalysisResult {
  type: PdfType;
  textContent: string;
  metrics: {
    textLength: number;
    wordCount: number;
    charDensity: number;  // chars per byte ratio
    pageCount: number;
  };
  confidence: number;  // 0-1
  source: 'pdf-parse' | 'textract' | 'none';
}

export interface PdfDetectionThresholds {
  minTextLength: number;      // Minimum chars to consider "has text"
  minWordCount: number;       // Minimum words for valid extraction
  minCharDensity: number;     // chars per byte ratio
}

// ============================================================================
// Document Classification Types
// ============================================================================

export type DocumentType = 'invoice' | 'receipt' | 'form' | 'contract' | 'generic';

export interface DocumentClassification {
  type: DocumentType;
  confidence: number;  // 0-1
  matchedPatterns: string[];
}

// ============================================================================
// Extraction Types
// ============================================================================

export type ExtractionSource =
  | 'pattern'           // Generic regex pattern matching
  | 'textract'          // AWS Textract OCR
  | 'inference'         // Inferred from context
  | 'input_context'     // Pass-through from workflow input
  | 'structured_data'   // CSV/Excel column mapping
  | 'textract_kv'       // Textract key-value pairs
  | 'textract_table'    // Textract table extraction
  | 'text_pattern'      // Text "FieldName: value" pattern
  | 'universal_pattern'; // Universal type patterns (date, email, etc.)

export interface ExtractedField {
  name: string;
  value: string | number | boolean | any[] | Record<string, any> | null;
  confidence: number;  // 0-1
  source: ExtractionSource;
  rawMatch?: string;  // Original matched text
}

export interface ExtractionResult {
  success: boolean;
  documentType: DocumentType;
  fields: Record<string, ExtractedField>;
  confidence: number;  // Overall confidence
  metadata: {
    extractionMethod: 'pdf-parse' | 'textract' | 'hybrid';
    processingTimeMs: number;
    pageCount: number;
    textLength: number;
  };
  rawText?: string;  // For debugging/fallback
  errors?: string[];
}

// ============================================================================
// Schema Mapping Types
// ============================================================================

export interface OutputSchemaField {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'array' | 'object';
  required?: boolean;
  description?: string;
}

export interface OutputSchema {
  fields: OutputSchemaField[];
}

export interface SchemaMappingResult {
  data: Record<string, any>;
  unmappedFields: string[];
  missingRequiredFields: string[];
  confidence: number;
}

// ============================================================================
// Extractor Configuration Types
// ============================================================================

export interface ExtractorConfig {
  documentType?: DocumentType | 'auto';
  ocrFallback?: boolean;
  outputSchema?: OutputSchema;
  confidenceThreshold?: number;  // Below this, trigger LLM fallback
}

export interface DeterministicExtractionInput {
  content: string;  // Base64 encoded content
  mimeType: string;
  filename?: string;
  config?: ExtractorConfig;
}

// ============================================================================
// AWS Textract Types
// ============================================================================

export interface TextractBlock {
  blockType: 'PAGE' | 'LINE' | 'WORD' | 'TABLE' | 'CELL' | 'KEY_VALUE_SET';
  text?: string;
  confidence: number;
  geometry?: {
    boundingBox: {
      width: number;
      height: number;
      left: number;
      top: number;
    };
  };
  relationships?: Array<{
    type: 'CHILD' | 'VALUE';
    ids: string[];
  }>;
}

export interface TextractResult {
  success: boolean;
  text: string;
  blocks: TextractBlock[];
  keyValuePairs: Array<{
    key: string;
    value: string;
    confidence: number;
  }>;
  tables: Array<{
    rows: string[][];
    confidence: number;
  }>;
  error?: string;
}

// ============================================================================
// Pattern Definitions
// ============================================================================

export interface FieldPattern {
  name: string;
  patterns: RegExp[];
  type: 'string' | 'number' | 'date' | 'currency';
  required?: boolean;
  postProcess?: (value: string) => any;
}

export interface DocumentPatterns {
  documentType: DocumentType;
  identificationPatterns: RegExp[];  // Used to classify document type
  fieldPatterns: FieldPattern[];
}
