/**
 * VisionContentBuilder - Handles multimodal content for LLM vision calls
 *
 * This utility helps build vision-compatible prompts when AI operations
 * need to process images or visual documents (PDFs, images, etc.).
 *
 * Supports:
 * - Detecting if input data contains images
 * - Extracting image content (base64) from enriched items
 * - Converting PDFs to images for vision API processing
 * - Building multimodal message content for OpenAI vision API
 */

import { createLogger } from '@/lib/logger';
import { convertPdfToImages } from './PdfToImage';

const logger = createLogger({ module: 'VisionContentBuilder', service: 'workflow-pilot' });

export interface ImageContent {
  base64: string;
  mimeType: string;
  filename?: string;
}

export interface VisionMessage {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: {
    url: string;
    detail?: 'auto' | 'low' | 'high';
  };
}

export class VisionContentBuilder {
  /**
   * Check if the data contains images that need vision processing
   * Includes PDFs which will be converted to images asynchronously
   */
  static hasImageContent(data: any): boolean {
    // First check for standard images via sync extraction
    const images = this.extractImageContent(data);
    if (images.length > 0) return true;

    // Also check for PDFs (which need async conversion)
    // PDFs are skipped in sync extraction but should trigger vision mode
    return this.hasPdfContent(data);
  }

  /**
   * Check if data contains PDF content (without extraction)
   * Used to detect PDFs for vision mode routing before async conversion
   */
  private static hasPdfContent(data: any): boolean {
    if (!data) return false;

    // Handle arrays
    if (Array.isArray(data)) {
      return data.some(item => this.hasPdfContent(item));
    }

    // Handle objects
    if (typeof data === 'object') {
      const mimeType = data.mimeType || data.contentType;
      if (mimeType === 'application/pdf') return true;

      // Check nested structures (common data patterns)
      if (data.data) return this.hasPdfContent(data.data);
      if (data.items) return this.hasPdfContent(data.items);
      if (data.content && typeof data.content === 'object') {
        return this.hasPdfContent(data.content);
      }
      // Check attachments array (common in email data)
      if (data.attachments && Array.isArray(data.attachments)) {
        return this.hasPdfContent(data.attachments);
      }
    }

    return false;
  }

  /**
   * Extract image content from enriched params (sync version - no PDF conversion)
   * Looks for items with isImage flag or image mimeTypes
   * @deprecated Use extractImageContentAsync for PDF support
   */
  static extractImageContent(data: any): ImageContent[] {
    const images: ImageContent[] = [];

    // Handle array of items
    if (Array.isArray(data)) {
      for (const item of data) {
        const extracted = this.extractSingleImage(item);
        if (extracted) {
          images.push(extracted);
        }
      }
      return images;
    }

    // Handle single item
    const singleImage = this.extractSingleImage(data);
    if (singleImage) {
      images.push(singleImage);
      return images;
    }

    // Handle nested data structures
    if (typeof data === 'object' && data !== null) {
      // Check for data property (common pattern)
      if (data.data) {
        return this.extractImageContent(data.data);
      }

      // Check for items property
      if (data.items) {
        return this.extractImageContent(data.items);
      }

      // Check for content property
      if (data.content) {
        const content = this.extractSingleImage({ content: data.content, mimeType: data.mimeType, contentType: data.contentType });
        if (content) {
          images.push(content);
        }
      }
    }

    return images;
  }

  /**
   * Extract image content from enriched params (async version with PDF conversion)
   * Converts PDFs to PNG images for vision API compatibility
   */
  static async extractImageContentAsync(data: any): Promise<ImageContent[]> {
    const images: ImageContent[] = [];

    // Handle array of items
    if (Array.isArray(data)) {
      for (const item of data) {
        const extracted = await this.extractSingleImageAsync(item);
        if (extracted) {
          images.push(...extracted);
        }
      }
      return images;
    }

    // Handle single item
    const singleImages = await this.extractSingleImageAsync(data);
    if (singleImages && singleImages.length > 0) {
      images.push(...singleImages);
      return images;
    }

    // Handle nested data structures
    if (typeof data === 'object' && data !== null) {
      // Check for data property (common pattern)
      if (data.data) {
        return this.extractImageContentAsync(data.data);
      }

      // Check for items property
      if (data.items) {
        return this.extractImageContentAsync(data.items);
      }

      // Check for attachments array (common in email data)
      if (data.attachments && Array.isArray(data.attachments)) {
        const attachmentImages = await this.extractImageContentAsync(data.attachments);
        if (attachmentImages.length > 0) {
          images.push(...attachmentImages);
        }
      }

      // Check for content property
      if (data.content) {
        const content = await this.extractSingleImageAsync({ content: data.content, mimeType: data.mimeType, contentType: data.contentType });
        if (content) {
          images.push(...content);
        }
      }
    }

    return images;
  }

  // Maximum base64 size for vision processing
  // With 'low' detail: ~85 tokens per image regardless of size
  // With 'high' detail: can be thousands of tokens based on image dimensions
  // PDFs are problematic because they render at full resolution
  // 100KB base64 ≈ 75KB file - reasonable for receipts/small documents
  private static MAX_BASE64_SIZE = 100 * 1024; // 100KB base64

  /**
   * Extract a single image from an item (sync version - skips PDFs)
   */
  private static extractSingleImage(item: any): ImageContent | null {
    if (!item || typeof item !== 'object') return null;

    const mimeType = item.mimeType || item.contentType;

    // Check if item is flagged as image
    const isImage = item.isImage ||
                    this.isImageMimeType(mimeType);

    if (!isImage) return null;

    // Skip PDFs in sync mode - they need async conversion
    if (mimeType === 'application/pdf') {
      logger.debug({ filename: item.filename }, 'VisionContentBuilder: Skipping PDF in sync mode - use extractImageContentAsync');
      return null;
    }

    // Get the base64 content
    let base64 = null;

    // Content might be in various locations
    if (item.content && typeof item.content === 'string') {
      base64 = item.content;
    } else if (item._content?.data && typeof item._content.data === 'string') {
      base64 = item._content.data;
    } else if (item.data && typeof item.data === 'string') {
      base64 = item.data;
    }

    if (!base64) {
      logger.debug({ item: item.filename }, 'VisionContentBuilder: No base64 content found for image item');
      return null;
    }

    // Clean base64 string (remove data URL prefix if present)
    if (base64.startsWith('data:')) {
      const parts = base64.split(',');
      base64 = parts[1] || base64;
    }

    // Check file size - skip files that are too large for efficient vision processing
    if (base64.length > this.MAX_BASE64_SIZE) {
      logger.warn({
        filename: item.filename,
        mimeType: mimeType,
        base64Length: base64.length,
        maxSize: this.MAX_BASE64_SIZE
      }, 'VisionContentBuilder: Skipping large file - exceeds vision processing size limit');
      return null;
    }

    return {
      base64,
      mimeType: mimeType || 'image/png',
      filename: item.filename
    };
  }

  /**
   * Extract images from an item (async version - converts PDFs to PNG)
   * Returns array because PDFs can have multiple pages
   */
  private static async extractSingleImageAsync(item: any): Promise<ImageContent[] | null> {
    if (!item || typeof item !== 'object') return null;

    const mimeType = item.mimeType || item.contentType;

    // Check if item is flagged as image
    const isImage = item.isImage ||
                    this.isImageMimeType(mimeType);

    if (!isImage) return null;

    // Get the base64 content
    let base64 = null;

    // Content might be in various locations
    if (item.content && typeof item.content === 'string') {
      base64 = item.content;
    } else if (item._content?.data && typeof item._content.data === 'string') {
      base64 = item._content.data;
    } else if (item.data && typeof item.data === 'string') {
      base64 = item.data;
    }

    if (!base64) {
      logger.debug({ item: item.filename }, 'VisionContentBuilder: No base64 content found for image item');
      return null;
    }

    // Clean base64 string (remove data URL prefix if present)
    if (base64.startsWith('data:')) {
      const parts = base64.split(',');
      base64 = parts[1] || base64;
    }

    // Handle PDF conversion
    if (mimeType === 'application/pdf') {
      logger.info({ filename: item.filename, base64Length: base64.length }, 'VisionContentBuilder: Converting PDF to images');

      try {
        const result = await convertPdfToImages(base64, {
          maxPages: 2,        // Limit to first 2 pages for receipts
          scale: 1.0,         // Standard resolution
          firstPageOnly: false
        });

        if (!result.success || result.pages.length === 0) {
          logger.warn({ filename: item.filename, error: result.error }, 'VisionContentBuilder: PDF conversion failed');
          return null;
        }

        // Convert PDF pages to ImageContent array
        const images: ImageContent[] = result.pages.map((page, idx) => ({
          base64: page.base64,
          mimeType: 'image/png' as const,
          filename: `${item.filename || 'document'}_page${page.pageNumber}.png`
        }));

        logger.info({
          filename: item.filename,
          pagesConverted: images.length,
          totalSize: images.reduce((sum, img) => sum + img.base64.length, 0)
        }, 'VisionContentBuilder: PDF converted to images');

        return images;

      } catch (error: any) {
        logger.error({ err: error, filename: item.filename }, 'VisionContentBuilder: PDF conversion error');
        return null;
      }
    }

    // Regular image - check size limit
    if (base64.length > this.MAX_BASE64_SIZE) {
      logger.warn({
        filename: item.filename,
        mimeType: mimeType,
        base64Length: base64.length,
        maxSize: this.MAX_BASE64_SIZE
      }, 'VisionContentBuilder: Skipping large file - exceeds vision processing size limit');
      return null;
    }

    return [{
      base64,
      mimeType: mimeType || 'image/png',
      filename: item.filename
    }];
  }

  /**
   * Check if a MIME type is an image type
   */
  static isImageMimeType(mimeType: string | undefined): boolean {
    if (!mimeType) return false;
    return mimeType.startsWith('image/') ||
           mimeType === 'application/pdf'; // PDFs are often processed visually
  }

  /**
   * Extract non-image data (metadata) from params for text context
   */
  static extractNonImageData(data: any): any {
    if (Array.isArray(data)) {
      return data.map(item => this.stripImageData(item));
    }

    return this.stripImageData(data);
  }

  /**
   * Strip image data from an item, keeping only metadata
   */
  private static stripImageData(item: any): any {
    if (!item || typeof item !== 'object') return item;

    const cleaned: any = {};

    for (const [key, value] of Object.entries(item)) {
      // Skip large binary data fields
      if (key === 'content' || key === '_content' || key === 'data') {
        // Keep a placeholder to indicate content was fetched
        if (item._contentFetched) {
          cleaned[key] = '[content fetched - see image]';
        }
        continue;
      }

      // Keep metadata fields
      cleaned[key] = value;
    }

    return cleaned;
  }

  /**
   * Build a multimodal message content array for vision API
   *
   * @param textPrompt - The text portion of the prompt
   * @param images - Array of image content to include
   * @param detail - Image detail level (auto, low, high)
   * @returns Array of vision message content blocks
   */
  static buildVisionContent(
    textPrompt: string,
    images: ImageContent[],
    detail: 'auto' | 'low' | 'high' = 'high'
  ): VisionMessage[] {
    const content: VisionMessage[] = [];

    // Add images first (GPT-4o processes images before text in multimodal)
    for (const img of images) {
      content.push({
        type: 'image_url',
        image_url: {
          url: `data:${img.mimeType};base64,${img.base64}`,
          detail
        }
      });
    }

    // Add text prompt
    content.push({
      type: 'text',
      text: textPrompt
    });

    logger.info({
      imageCount: images.length,
      textLength: textPrompt.length,
      detail
    }, 'VisionContentBuilder: Built multimodal content');

    return content;
  }

  /**
   * Check if the model supports vision
   * GPT-4o and GPT-4-turbo support vision natively
   */
  static modelSupportsVision(model: string): boolean {
    const visionModels = [
      'gpt-4o',
      'gpt-4o-mini',
      'gpt-4-turbo',
      'gpt-4-vision',
      'gpt-5',
      'gpt-5.1',
      'gpt-5.2'
    ];

    return visionModels.some(vm => model.toLowerCase().includes(vm.toLowerCase()));
  }
}
