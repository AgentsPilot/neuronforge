/**
 * Deterministic Extraction Module
 *
 * Schema-driven document extraction without LLM calls.
 * Works across all file types: PDF, images (OCR), Word, Excel, CSV, HTML, etc.
 *
 * Usage:
 * ```typescript
 * import { DeterministicExtractor } from '@/lib/extraction';
 *
 * const extractor = new DeterministicExtractor();
 * const result = await extractor.extract({
 *   content: base64Content,
 *   mimeType: 'application/pdf',
 *   config: {
 *     outputSchema: {
 *       fields: [
 *         { name: 'total', type: 'number', required: true },
 *         { name: 'date', type: 'date' },
 *         { name: 'vendor', type: 'string' },
 *       ]
 *     }
 *   },
 *   inputContext: {
 *     email_subject: 'Receipt from Acme', // Pass-through fields
 *   }
 * });
 * ```
 *
 * Cost model:
 * - PDF (text-based): FREE
 * - PDF (scanned): ~$0.0015/page (AWS Textract)
 * - Images: ~$0.0015/page (AWS Textract)
 * - Word/Excel/CSV/HTML: FREE
 */

// Main orchestrator - schema-driven extraction
export { DeterministicExtractor } from './DeterministicExtractor';
export type {
  DeterministicExtractionInput,
  DeterministicExtractionResult,
} from './DeterministicExtractor';

// Schema-driven field extractor
export { SchemaFieldExtractor } from './SchemaFieldExtractor';
export type {
  SchemaExtractionResult,
  ExtractionInput,
} from './SchemaFieldExtractor';

// Core components
export { PdfTypeDetector } from './PdfTypeDetector';
export { TextractClient } from './TextractClient';
export { UniversalExtractor, universalExtractor } from './UniversalExtractor';
export type { UniversalExtractionInput, UniversalExtractionResult } from './UniversalExtractor';

// Types
export type {
  PdfType,
  PdfAnalysisResult,
  PdfDetectionThresholds,
  DocumentType,
  ExtractionSource,
  ExtractedField,
  ExtractionResult,
  OutputSchemaField,
  OutputSchema,
  TextractResult,
  TextractBlock,
  FieldPattern,
} from './types';

// =============================================================================
// DEPRECATED - The following are kept for backwards compatibility only
// These document-type-specific extractors are replaced by SchemaFieldExtractor
// =============================================================================

/** @deprecated Use SchemaFieldExtractor instead - schema-driven extraction */
export { DocumentTypeClassifier } from './DocumentTypeClassifier.deprecated';

/** @deprecated Use SchemaFieldExtractor instead - schema-driven extraction */
export { SchemaMapper } from './SchemaMapper.deprecated';

/** @deprecated Use SchemaFieldExtractor instead - schema-driven extraction */
export {
  BaseExtractor,
  InvoiceExtractor,
  FormExtractor,
  ContractExtractor,
  GenericExtractor,
} from './extractors';

/** @deprecated Types for deprecated extractors */
export type {
  DocumentClassification,
  SchemaMappingResult,
  ExtractorConfig,
  DocumentPatterns,
} from './types';
