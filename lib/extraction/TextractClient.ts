/**
 * AWS Textract Client
 * Provides OCR and document structure analysis using AWS Textract
 */

import { createLogger } from '@/lib/logger';

const logger = createLogger({ module: 'TextractClient' });

export interface TextractAnalyzeResult {
  text: string;
  keyValuePairs: Array<{ key: string; value: string; confidence: number }>;
  tables: Array<{ rows: string[][]; confidence: number }>;
}

export class TextractClient {
  private awsConfigured: boolean = false;

  constructor() {
    // Check if AWS credentials are configured
    this.awsConfigured = !!(
      process.env.AWS_ACCESS_KEY_ID &&
      process.env.AWS_SECRET_ACCESS_KEY &&
      process.env.AWS_REGION
    );

    if (!this.awsConfigured) {
      logger.debug('AWS Textract not configured - credentials missing');
    }
  }

  /**
   * Check if Textract is available and properly configured
   */
  async isAvailable(): Promise<boolean> {
    return this.awsConfigured;
  }

  /**
   * Analyze document using AWS Textract
   * Extracts text, key-value pairs, and tables
   */
  async analyzeDocument(base64Content: string): Promise<TextractAnalyzeResult> {
    if (!this.awsConfigured) {
      logger.warn('Textract called but AWS not configured');
      return { text: '', keyValuePairs: [], tables: [] };
    }

    try {
      // Import AWS SDK dynamically (only when needed)
      const { TextractClient: AWSTextractClient, AnalyzeDocumentCommand } = await import('@aws-sdk/client-textract');

      const client = new AWSTextractClient({
        region: process.env.AWS_REGION || 'us-east-1',
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
        },
      });

      // Convert base64 to buffer
      const base64Data = base64Content.replace(/^data:application\/pdf;base64,/, '');
      const buffer = Buffer.from(base64Data, 'base64');

      // Call Textract
      const command = new AnalyzeDocumentCommand({
        Document: {
          Bytes: buffer,
        },
        FeatureTypes: ['FORMS', 'TABLES'], // Extract forms (key-value) and tables
      });

      logger.info({ documentSize: buffer.length }, 'Calling AWS Textract');
      const response = await client.send(command);

      // Parse response
      const blocks = response.Blocks || [];
      const text = this.extractText(blocks);
      const keyValuePairs = this.extractKeyValuePairs(blocks);
      const tables = this.extractTables(blocks);

      logger.info({
        textLength: text.length,
        keyValuePairsCount: keyValuePairs.length,
        tablesCount: tables.length,
      }, 'Textract analysis complete');

      return { text, keyValuePairs, tables };
    } catch (error: any) {
      logger.error({ err: error }, 'Textract analysis failed');
      return { text: '', keyValuePairs: [], tables: [] };
    }
  }

  /**
   * Extract plain text from Textract blocks
   */
  private extractText(blocks: any[]): string {
    return blocks
      .filter((block) => block.BlockType === 'LINE' && block.Text)
      .map((block) => block.Text)
      .join('\n');
  }

  /**
   * Extract key-value pairs from Textract FORM blocks
   */
  private extractKeyValuePairs(blocks: any[]): Array<{ key: string; value: string; confidence: number }> {
    const keyValuePairs: Array<{ key: string; value: string; confidence: number }> = [];
    const blockMap = new Map(blocks.map((b) => [b.Id, b]));

    // Find KEY_VALUE_SET blocks
    const keyBlocks = blocks.filter((b) => b.BlockType === 'KEY_VALUE_SET' && b.EntityTypes?.includes('KEY'));

    for (const keyBlock of keyBlocks) {
      try {
        // Get key text
        const keyText = this.getBlockText(keyBlock, blockMap);
        if (!keyText) continue;

        // Find associated VALUE block
        const valueRelationship = keyBlock.Relationships?.find((r: any) => r.Type === 'VALUE');
        if (!valueRelationship || !valueRelationship.Ids?.length) continue;

        const valueBlock = blockMap.get(valueRelationship.Ids[0]);
        if (!valueBlock) continue;

        // Get value text
        const valueText = this.getBlockText(valueBlock, blockMap);
        if (!valueText) continue;

        // Calculate confidence (average of key and value confidence)
        const confidence = ((keyBlock.Confidence || 0) + (valueBlock.Confidence || 0)) / 2;

        keyValuePairs.push({
          key: keyText.trim(),
          value: valueText.trim(),
          confidence,
        });
      } catch (error) {
        logger.debug({ err: error }, 'Failed to extract key-value pair');
      }
    }

    return keyValuePairs;
  }

  /**
   * Extract tables from Textract TABLE blocks
   */
  private extractTables(blocks: any[]): Array<{ rows: string[][]; confidence: number }> {
    const tables: Array<{ rows: string[][]; confidence: number }> = [];
    const blockMap = new Map(blocks.map((b) => [b.Id, b]));

    // Find TABLE blocks
    const tableBlocks = blocks.filter((b) => b.BlockType === 'TABLE');

    for (const tableBlock of tableBlocks) {
      try {
        const rows = this.extractTableRows(tableBlock, blockMap);
        if (rows.length > 0) {
          tables.push({
            rows,
            confidence: tableBlock.Confidence || 0,
          });
        }
      } catch (error) {
        logger.debug({ err: error }, 'Failed to extract table');
      }
    }

    return tables;
  }

  /**
   * Extract rows from a TABLE block
   */
  private extractTableRows(tableBlock: any, blockMap: Map<string, any>): string[][] {
    const cells: Array<{ row: number; col: number; text: string }> = [];

    // Get CELL blocks
    const cellRelationship = tableBlock.Relationships?.find((r: any) => r.Type === 'CHILD');
    if (!cellRelationship || !cellRelationship.Ids) return [];

    for (const cellId of cellRelationship.Ids) {
      const cellBlock = blockMap.get(cellId);
      if (!cellBlock || cellBlock.BlockType !== 'CELL') continue;

      const rowIndex = (cellBlock.RowIndex || 1) - 1; // 1-indexed
      const colIndex = (cellBlock.ColumnIndex || 1) - 1; // 1-indexed
      const text = this.getBlockText(cellBlock, blockMap);

      cells.push({ row: rowIndex, col: colIndex, text });
    }

    // Convert cells to 2D array
    const maxRow = Math.max(...cells.map((c) => c.row), 0);
    const maxCol = Math.max(...cells.map((c) => c.col), 0);

    const rows: string[][] = Array.from({ length: maxRow + 1 }, () =>
      Array.from({ length: maxCol + 1 }, () => '')
    );

    for (const cell of cells) {
      rows[cell.row][cell.col] = cell.text;
    }

    return rows;
  }

  /**
   * Get text content from a block by following CHILD relationships
   */
  private getBlockText(block: any, blockMap: Map<string, any>): string {
    // If block has direct text, return it
    if (block.Text) return block.Text;

    // Otherwise, get text from CHILD blocks
    const childRelationship = block.Relationships?.find((r: any) => r.Type === 'CHILD');
    if (!childRelationship || !childRelationship.Ids) return '';

    const childTexts = childRelationship.Ids
      .map((id: string) => blockMap.get(id))
      .filter((b: any) => b && b.Text)
      .map((b: any) => b.Text);

    return childTexts.join(' ');
  }
}
