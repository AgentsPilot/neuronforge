// lib/server/document-extractor-plugin-executor.ts

import { UserPluginConnections } from './user-plugin-connections';
import { PluginManagerV2 } from './plugin-manager-v2';
import { BasePluginExecutor } from './base-plugin-executor';
import { DeterministicExtractor } from '@/lib/extraction/DeterministicExtractor';
import type { OutputSchema } from '@/lib/extraction/types';

const pluginName = 'document-extractor';

/**
 * Executor for Document Extractor plugin actions
 * Provides deterministic document data extraction using OCR and parsing
 */
export class DocumentExtractorPluginExecutor extends BasePluginExecutor {
  private extractor: DeterministicExtractor;

  constructor(userConnections: UserPluginConnections, pluginManager: PluginManagerV2) {
    super(pluginName, userConnections, pluginManager);
    this.extractor = new DeterministicExtractor(true); // Enable OCR
  }

  // Execute Document Extractor action
  protected async executeSpecificAction(
    _connection: any,
    actionName: string,
    parameters: any
  ): Promise<any> {
    switch (actionName) {
      case 'extract_structured_data':
        return await this.extractStructuredData(parameters);
      default:
        throw new Error(`Action ${actionName} not supported by document-extractor`);
    }
  }

  /**
   * Extract structured fields from document files (PDF, images, invoices, receipts)
   */
  private async extractStructuredData(parameters: any): Promise<any> {
    this.logger.debug({
      parameters: {
        ...parameters,
        file_content: parameters.file_content ? `[${parameters.file_content.length} chars]` : undefined
      }
    }, 'Extracting structured data from document');

    const { file_content, file_url, mime_type, filename, fields, use_ai = false } = parameters;

    if (!fields || !Array.isArray(fields) || fields.length === 0) {
      throw new Error('fields array is required for document extraction');
    }

    // Get file content - handle multiple input formats
    let content: string;
    let mimeType: string;
    let name: string;

    // Check if file_content is actually a file object (common mistake in workflows)
    // File objects typically have: { content, mime_type, filename } or { data, mimeType, name }
    if (file_content && typeof file_content === 'object') {
      this.logger.debug({ fileContentType: typeof file_content, keys: Object.keys(file_content) },
        'file_content is an object, extracting content fields');

      // Try common field names for content
      content = (file_content as any).content || (file_content as any).data || (file_content as any).file_content

      // ✅ FIX: Extract mimeType from file_content object first, THEN fall back to mime_type parameter
      // This ensures when step5 returns {data: "...", mimeType: "application/pdf"}, we use the correct MIME type
      mimeType = (file_content as any).mime_type || (file_content as any).mimeType || mime_type || 'application/octet-stream'
      name = filename || (file_content as any).filename || (file_content as any).name || (file_content as any).file_name || 'document'

      if (!content) {
        this.logger.error({ fileContent: file_content }, 'file_content is object but has no content/data field')
        throw new Error('file_content is an object but missing content/data field. Expected base64 string or object with content field.')
      }

      this.logger.info({ contentLength: content.length, mimeType, filename: name },
        'Extracted content from file object')
    } else if (file_content && typeof file_content === 'string') {
      // Direct base64 content provided (preferred method)
      content = file_content

      // ✅ FIX: If mime_type not provided, try to detect it from base64 content
      // This handles cases where workflow passes {{attachment_content.data}} without mimeType
      if (!mime_type) {
        mimeType = this.detectMimeTypeFromBase64(content);
        this.logger.info({ detectedMimeType: mimeType }, 'Auto-detected MIME type from base64 content');
      } else {
        mimeType = mime_type;
      }

      name = filename || 'document'
      this.logger.debug({ contentLength: content.length, mimeType, filename: name }, 'Using provided file content string')
    } else if (file_url) {
      // Fallback to fetching from URL
      this.logger.warn({ file_url }, 'file_content not provided, falling back to fetching from URL (less efficient)')
      const fetched = await this.fetchFileContent(file_url)
      content = fetched.content
      mimeType = fetched.mimeType
      name = fetched.filename
    } else {
      throw new Error('Either file_content (string or object with content field) or file_url is required for document extraction')
    }

    // Convert fields array to OutputSchema format
    const outputSchema: OutputSchema = {
      fields: fields.map((field: any) => ({
        name: field.name,
        type: field.type || 'string',
        description: field.description || '',
        required: field.required !== false,
        pattern: field.pattern,
        aliases: field.aliases || [],
      })),
    };

    // Run deterministic extraction
    const result = await this.extractor.extract({
      content,
      mimeType,
      filename: name,
      config: {
        outputSchema,
        ocrFallback: !use_ai, // If use_ai=false, use OCR. If use_ai=true, we'd use LLM fallback (not implemented yet)
      },
    });

    this.logger.info({
      success: result.success,
      confidence: result.confidence,
      fieldsExtracted: result.metadata.fieldsExtracted,
      missingFields: result.metadata.missingFields,
      extractionMethod: result.metadata.extractionMethod,
    }, 'Document extraction complete');

    // ✅ FIX: Return extracted fields directly, not wrapped
    // Downstream steps expect {{extracted_fields.vendor}}, not {{extracted_fields.extracted_fields.vendor}}
    // Metadata should be in step output metadata, not in data payload
    // Apply defaults for missing required fields to prevent null/undefined errors
    const extractedData = result.data || {};

    // Ensure required fields have fallback values if missing
    // This prevents downstream "field is required" errors when extraction fails
    for (const fieldDef of outputSchema.fields) {
      if (fieldDef.required && (extractedData[fieldDef.name] === null || extractedData[fieldDef.name] === undefined || extractedData[fieldDef.name] === '')) {
        // Use a sensible default based on field name
        const fieldName = fieldDef.name;
        extractedData[fieldDef.name] = `Unknown ${fieldName.charAt(0).toUpperCase() + fieldName.slice(1)}`;
        this.logger.info({ field: fieldDef.name, fallback: extractedData[fieldDef.name] }, 'Applied fallback for missing required field');
      }
    }

    // Attach metadata as plugin metadata (will be in step output metadata, not data)
    (extractedData as any)._extraction_metadata = {
      confidence: result.confidence,
      raw_text: result.rawText,
      method: result.metadata.extractionMethod,
      processing_time_ms: result.metadata.processingTimeMs,
      success: result.success,
      missing_fields: result.metadata.missingFields,
      uncertain_fields: result.metadata.uncertainFields,
    };

    return extractedData;
  }

  /**
   * Detect MIME type from base64 content by checking magic bytes
   * This is a scalable solution for workflows that pass {{attachment.data}} without mimeType
   */
  private detectMimeTypeFromBase64(base64Content: string): string {
    try {
      // Decode first few bytes to check magic signatures
      const buffer = Buffer.from(base64Content.substring(0, 100), 'base64');
      const bytes = Array.from(buffer);

      // PDF: starts with "%PDF-"
      if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
        return 'application/pdf';
      }

      // PNG: starts with 0x89504E47
      if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
        return 'image/png';
      }

      // JPEG: starts with 0xFFD8FF
      if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
        return 'image/jpeg';
      }

      // GIF: starts with "GIF89a" or "GIF87a"
      if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
        return 'image/gif';
      }

      this.logger.warn({ firstBytes: bytes.slice(0, 10) }, 'Could not detect MIME type from magic bytes');
      return 'application/octet-stream';
    } catch (error) {
      this.logger.error({ error }, 'Failed to detect MIME type from base64 content');
      return 'application/octet-stream';
    }
  }

  /**
   * Fetch file content from URL (generic fallback)
   * This is a fallback method - workflows should pass file_content directly for efficiency
   */
  private async fetchFileContent(_fileUrl: string): Promise<{
    content: string;
    mimeType: string;
    filename: string;
  }> {
    // TODO: Implement generic file fetching if needed
    // For now, we expect workflows to pass file_content directly
    throw new Error('Fetching from file_url not implemented. Please pass file_content parameter directly for better performance and plugin-agnosticism.');
  }
}
