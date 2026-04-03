/**
 * PDF Type Detector
 * Detects if PDF is text-based or scanned and extracts text
 */

export interface PdfDetectionResult {
  type: 'text' | 'scanned' | 'hybrid';
  textContent: string;
  pageCount?: number;
  isScanned: boolean;
}

export class PdfTypeDetector {
  constructor(_config?: any, private ocrEnabled: boolean = true) {}

  async detect(base64Content: string): Promise<PdfDetectionResult> {
    try {
      // Use pdf-parse to extract text
      const pdfParse = eval('require')('pdf-parse');

      const base64Data = base64Content.replace(/^data:application\/pdf;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');

      const result = await pdfParse(buffer);
      const text = result.text?.trim() || '';
      const pageCount = result.numpages || 0;

      // Determine if PDF is scanned based on text content
      const isScanned = text.length < 50; // Less than 50 chars suggests scanned
      const type = isScanned ? 'scanned' : text.length < 500 ? 'hybrid' : 'text';

      return {
        type,
        textContent: text,
        pageCount,
        isScanned
      };
    } catch (error: any) {
      // If PDF parsing fails, assume it's scanned
      return {
        type: 'scanned',
        textContent: '',
        isScanned: true
      };
    }
  }
}
