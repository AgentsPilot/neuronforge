/**
 * PdfToImage - Converts PDF pages to images for vision API processing
 *
 * Uses pdfjs-dist to render PDF pages as PNG images.
 * OpenAI Vision API doesn't support PDFs natively, so we need to
 * convert each page to an image format.
 */

import { createLogger } from '../../logger';

const logger = createLogger({ module: 'PdfToImage', service: 'workflow-pilot' });

export interface PdfPageImage {
  pageNumber: number;
  base64: string;
  mimeType: 'image/png';
  width: number;
  height: number;
}

export interface PdfConversionResult {
  success: boolean;
  pages: PdfPageImage[];
  totalPages: number;
  error?: string;
}

/**
 * Convert a PDF (base64) to an array of PNG images (one per page)
 *
 * @param pdfBase64 - Base64-encoded PDF content
 * @param options - Conversion options
 * @returns Array of base64 PNG images, one per page
 */
export async function convertPdfToImages(
  pdfBase64: string,
  options: {
    maxPages?: number;      // Limit pages to process (default: 3)
    scale?: number;         // Render scale (default: 1.0 for ~72 DPI)
    firstPageOnly?: boolean; // Only convert first page
  } = {}
): Promise<PdfConversionResult> {
  const { maxPages = 3, scale = 1.0, firstPageOnly = false } = options;

  try {
    // Dynamic import to avoid server-side issues
    const pdfjsLib = await import('pdfjs-dist');

    // Set up worker (required for pdfjs-dist)
    // Use fake worker for server-side rendering
    pdfjsLib.GlobalWorkerOptions.workerSrc = '';

    // Convert base64 to Uint8Array
    const pdfData = Buffer.from(pdfBase64, 'base64');

    // Load the PDF document
    const loadingTask = pdfjsLib.getDocument({
      data: pdfData,
      useSystemFonts: true,
      disableFontFace: true, // Server-side compatibility
    });

    const pdf = await loadingTask.promise;
    const totalPages = pdf.numPages;

    logger.info({ totalPages, maxPages, scale }, 'PdfToImage: Loading PDF');

    const pagesToProcess = firstPageOnly ? 1 : Math.min(totalPages, maxPages);
    const pages: PdfPageImage[] = [];

    for (let pageNum = 1; pageNum <= pagesToProcess; pageNum++) {
      try {
        const page = await pdf.getPage(pageNum);
        const viewport = page.getViewport({ scale });

        // Create a canvas to render the page
        // Using node-canvas compatible approach
        const { createCanvas } = await import('canvas');
        const canvas = createCanvas(viewport.width, viewport.height);
        const context = canvas.getContext('2d');

        // Render the page to canvas
        // pdfjs-dist v5+ requires canvas in RenderParameters
        await page.render({
          canvasContext: context as any,
          viewport: viewport,
          canvas: canvas as any, // Required for pdfjs-dist v5+
        } as any).promise;

        // Convert canvas to PNG base64
        const pngDataUrl = canvas.toDataURL('image/png');
        const pngBase64 = pngDataUrl.replace('data:image/png;base64,', '');

        pages.push({
          pageNumber: pageNum,
          base64: pngBase64,
          mimeType: 'image/png',
          width: viewport.width,
          height: viewport.height,
        });

        logger.debug({
          pageNum,
          width: viewport.width,
          height: viewport.height,
          base64Length: pngBase64.length
        }, 'PdfToImage: Page converted');

      } catch (pageError: any) {
        logger.error({ err: pageError, pageNum }, 'PdfToImage: Failed to convert page');
        // Continue with other pages
      }
    }

    logger.info({
      totalPages,
      pagesConverted: pages.length,
      totalBase64Size: pages.reduce((sum, p) => sum + p.base64.length, 0)
    }, 'PdfToImage: Conversion complete');

    return {
      success: pages.length > 0,
      pages,
      totalPages,
    };

  } catch (error: any) {
    logger.error({ err: error }, 'PdfToImage: Failed to convert PDF');
    return {
      success: false,
      pages: [],
      totalPages: 0,
      error: error.message,
    };
  }
}

/**
 * Check if PDF conversion is available
 * (depends on canvas being installed for server-side rendering)
 */
export async function isPdfConversionAvailable(): Promise<boolean> {
  try {
    await import('canvas');
    await import('pdfjs-dist');
    return true;
  } catch {
    return false;
  }
}
