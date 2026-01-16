/**
 * TextractClient
 *
 * AWS Textract wrapper for OCR extraction from scanned documents.
 * Used as fallback when pdf-parse cannot extract text from PDFs.
 *
 * Features:
 * - Text extraction from scanned PDFs and images
 * - Key-value pair detection (forms)
 * - Table extraction
 * - Cost: ~$0.0015 per page
 */

import { createLogger } from '@/lib/logger';
import type { TextractResult, TextractBlock } from './types';

const logger = createLogger({ module: 'TextractClient', service: 'extraction' });

export class TextractClient {
  private client: any = null;
  private initialized: boolean = false;

  constructor() {
    this.initClient();
  }

  /**
   * Initialize AWS Textract client lazily
   */
  private async initClient(): Promise<boolean> {
    if (this.initialized) return this.client !== null;

    try {
      // Check for required environment variables
      const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
      const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
      const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

      if (!region || !accessKeyId || !secretAccessKey) {
        logger.warn('TextractClient: AWS credentials not configured, OCR disabled');
        this.initialized = true;
        return false;
      }

      // Dynamic import to avoid bundling AWS SDK if not used
      const { TextractClient: AwsTextractClient } = await import('@aws-sdk/client-textract');

      this.client = new AwsTextractClient({
        region,
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
      });

      this.initialized = true;
      logger.info({ region }, 'TextractClient: Initialized successfully');
      return true;
    } catch (error: any) {
      logger.error({ err: error }, 'TextractClient: Failed to initialize');
      this.initialized = true;
      return false;
    }
  }

  /**
   * Check if Textract is available
   */
  async isAvailable(): Promise<boolean> {
    await this.initClient();
    return this.client !== null;
  }

  /**
   * Extract text from a document (PDF or image)
   */
  async extractText(documentBase64: string): Promise<TextractResult> {
    const startTime = Date.now();

    if (!await this.isAvailable()) {
      return {
        success: false,
        text: '',
        blocks: [],
        keyValuePairs: [],
        tables: [],
        error: 'Textract client not available - check AWS credentials',
      };
    }

    try {
      const { DetectDocumentTextCommand } = await import('@aws-sdk/client-textract');

      const documentBytes = Buffer.from(documentBase64, 'base64');

      logger.info({ documentSize: documentBytes.length }, 'TextractClient: Starting text detection');

      const command = new DetectDocumentTextCommand({
        Document: {
          Bytes: documentBytes,
        },
      });

      const response = await this.client.send(command);

      // Process blocks to extract text
      const blocks: TextractBlock[] = (response.Blocks || []).map((block: any) => ({
        blockType: block.BlockType,
        text: block.Text,
        confidence: block.Confidence || 0,
        geometry: block.Geometry ? {
          boundingBox: {
            width: block.Geometry.BoundingBox?.Width || 0,
            height: block.Geometry.BoundingBox?.Height || 0,
            left: block.Geometry.BoundingBox?.Left || 0,
            top: block.Geometry.BoundingBox?.Top || 0,
          },
        } : undefined,
        relationships: block.Relationships?.map((rel: any) => ({
          type: rel.Type,
          ids: rel.Ids || [],
        })),
      }));

      // Extract full text from LINE blocks (in order)
      const lines = blocks
        .filter(b => b.blockType === 'LINE')
        .sort((a, b) => {
          // Sort by vertical position (top), then horizontal (left)
          const aTop = a.geometry?.boundingBox.top || 0;
          const bTop = b.geometry?.boundingBox.top || 0;
          if (Math.abs(aTop - bTop) > 0.01) return aTop - bTop;
          const aLeft = a.geometry?.boundingBox.left || 0;
          const bLeft = b.geometry?.boundingBox.left || 0;
          return aLeft - bLeft;
        })
        .map(b => b.text || '')
        .filter(t => t.length > 0);

      const text = lines.join('\n');

      const processingTime = Date.now() - startTime;
      logger.info({
        textLength: text.length,
        blockCount: blocks.length,
        processingTimeMs: processingTime,
      }, 'TextractClient: Text detection complete');

      return {
        success: true,
        text,
        blocks,
        keyValuePairs: [], // Basic DetectDocumentText doesn't extract key-values
        tables: [],
      };
    } catch (error: any) {
      logger.error({ err: error }, 'TextractClient: Text detection failed');
      return {
        success: false,
        text: '',
        blocks: [],
        keyValuePairs: [],
        tables: [],
        error: error.message,
      };
    }
  }

  /**
   * Analyze document for forms (key-value pairs) and tables
   * Uses AnalyzeDocument API - more expensive but extracts structure
   */
  async analyzeDocument(documentBase64: string): Promise<TextractResult> {
    const startTime = Date.now();

    if (!await this.isAvailable()) {
      return {
        success: false,
        text: '',
        blocks: [],
        keyValuePairs: [],
        tables: [],
        error: 'Textract client not available - check AWS credentials',
      };
    }

    try {
      const { AnalyzeDocumentCommand } = await import('@aws-sdk/client-textract');

      const documentBytes = Buffer.from(documentBase64, 'base64');

      logger.info({ documentSize: documentBytes.length }, 'TextractClient: Starting document analysis');

      const command = new AnalyzeDocumentCommand({
        Document: {
          Bytes: documentBytes,
        },
        FeatureTypes: ['FORMS', 'TABLES'],
      });

      const response = await this.client.send(command);

      // Build block map for relationship lookups
      const blockMap = new Map<string, any>();
      for (const block of response.Blocks || []) {
        if (block.Id) {
          blockMap.set(block.Id, block);
        }
      }

      // Process blocks
      const blocks: TextractBlock[] = (response.Blocks || []).map((block: any) => ({
        blockType: block.BlockType,
        text: block.Text,
        confidence: block.Confidence || 0,
        geometry: block.Geometry ? {
          boundingBox: {
            width: block.Geometry.BoundingBox?.Width || 0,
            height: block.Geometry.BoundingBox?.Height || 0,
            left: block.Geometry.BoundingBox?.Left || 0,
            top: block.Geometry.BoundingBox?.Top || 0,
          },
        } : undefined,
        relationships: block.Relationships?.map((rel: any) => ({
          type: rel.Type,
          ids: rel.Ids || [],
        })),
      }));

      // Extract key-value pairs
      const keyValuePairs = this.extractKeyValuePairs(response.Blocks || [], blockMap);

      // Extract tables
      const tables = this.extractTables(response.Blocks || [], blockMap);

      // Extract full text from LINE blocks
      const lines = blocks
        .filter(b => b.blockType === 'LINE')
        .map(b => b.text || '')
        .filter(t => t.length > 0);

      const text = lines.join('\n');

      const processingTime = Date.now() - startTime;
      logger.info({
        textLength: text.length,
        blockCount: blocks.length,
        keyValuePairCount: keyValuePairs.length,
        tableCount: tables.length,
        processingTimeMs: processingTime,
      }, 'TextractClient: Document analysis complete');

      return {
        success: true,
        text,
        blocks,
        keyValuePairs,
        tables,
      };
    } catch (error: any) {
      logger.error({ err: error }, 'TextractClient: Document analysis failed');
      return {
        success: false,
        text: '',
        blocks: [],
        keyValuePairs: [],
        tables: [],
        error: error.message,
      };
    }
  }

  /**
   * Extract key-value pairs from Textract blocks
   */
  private extractKeyValuePairs(
    blocks: any[],
    blockMap: Map<string, any>
  ): Array<{ key: string; value: string; confidence: number }> {
    const keyValuePairs: Array<{ key: string; value: string; confidence: number }> = [];

    for (const block of blocks) {
      if (block.BlockType === 'KEY_VALUE_SET' && block.EntityTypes?.includes('KEY')) {
        const keyText = this.getTextFromBlock(block, blockMap);
        const valueBlock = this.getValueBlock(block, blockMap);
        const valueText = valueBlock ? this.getTextFromBlock(valueBlock, blockMap) : '';

        if (keyText) {
          keyValuePairs.push({
            key: keyText.trim(),
            value: valueText.trim(),
            confidence: (block.Confidence + (valueBlock?.Confidence || 0)) / 2,
          });
        }
      }
    }

    return keyValuePairs;
  }

  /**
   * Extract tables from Textract blocks
   */
  private extractTables(
    blocks: any[],
    blockMap: Map<string, any>
  ): Array<{ rows: string[][]; confidence: number }> {
    const tables: Array<{ rows: string[][]; confidence: number }> = [];

    for (const block of blocks) {
      if (block.BlockType === 'TABLE') {
        const table = this.processTable(block, blockMap);
        if (table.rows.length > 0) {
          tables.push(table);
        }
      }
    }

    return tables;
  }

  /**
   * Process a table block into rows and columns
   */
  private processTable(
    tableBlock: any,
    blockMap: Map<string, any>
  ): { rows: string[][]; confidence: number } {
    const cells: Array<{
      rowIndex: number;
      columnIndex: number;
      text: string;
      confidence: number;
    }> = [];

    // Get cell blocks
    const cellIds = tableBlock.Relationships?.find((r: any) => r.Type === 'CHILD')?.Ids || [];

    for (const cellId of cellIds) {
      const cellBlock = blockMap.get(cellId);
      if (cellBlock && cellBlock.BlockType === 'CELL') {
        const text = this.getTextFromBlock(cellBlock, blockMap);
        cells.push({
          rowIndex: cellBlock.RowIndex || 0,
          columnIndex: cellBlock.ColumnIndex || 0,
          text: text.trim(),
          confidence: cellBlock.Confidence || 0,
        });
      }
    }

    // Convert to 2D array
    const maxRow = Math.max(...cells.map(c => c.rowIndex), 0);
    const maxCol = Math.max(...cells.map(c => c.columnIndex), 0);

    const rows: string[][] = [];
    for (let row = 1; row <= maxRow; row++) {
      const rowData: string[] = [];
      for (let col = 1; col <= maxCol; col++) {
        const cell = cells.find(c => c.rowIndex === row && c.columnIndex === col);
        rowData.push(cell?.text || '');
      }
      rows.push(rowData);
    }

    const avgConfidence = cells.length > 0
      ? cells.reduce((sum, c) => sum + c.confidence, 0) / cells.length
      : 0;

    return { rows, confidence: avgConfidence };
  }

  /**
   * Get text content from a block by following CHILD relationships
   */
  private getTextFromBlock(block: any, blockMap: Map<string, any>): string {
    if (block.Text) return block.Text;

    const childIds = block.Relationships?.find((r: any) => r.Type === 'CHILD')?.Ids || [];
    const texts: string[] = [];

    for (const childId of childIds) {
      const childBlock = blockMap.get(childId);
      if (childBlock) {
        if (childBlock.Text) {
          texts.push(childBlock.Text);
        } else {
          texts.push(this.getTextFromBlock(childBlock, blockMap));
        }
      }
    }

    return texts.join(' ');
  }

  /**
   * Get the VALUE block associated with a KEY block
   */
  private getValueBlock(keyBlock: any, blockMap: Map<string, any>): any | null {
    const valueId = keyBlock.Relationships?.find((r: any) => r.Type === 'VALUE')?.Ids?.[0];
    return valueId ? blockMap.get(valueId) : null;
  }
}
