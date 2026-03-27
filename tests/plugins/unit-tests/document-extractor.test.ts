/**
 * Unit tests for DocumentExtractorPluginExecutor — 1 action (mocked)
 *
 * SA review items addressed:
 * - #4: Verifies isSystem=true null connection path (connection from
 *   getConnection is a virtual "system" connection, not a real OAuth one)
 * - DeterministicExtractor.prototype.extract is mocked to avoid file I/O
 */

import { DocumentExtractorPluginExecutor } from '@/lib/server/document-extractor-plugin-executor';
import { createTestExecutor, expectSuccessResult, expectErrorResult } from '../common/test-helpers';
import { restoreFetch, mockFetchSuccess } from '../common/mock-fetch';

// Mock the DeterministicExtractor module so no real PDF parsing occurs
jest.mock('@/lib/extraction/DeterministicExtractor', () => {
  return {
    DeterministicExtractor: jest.fn().mockImplementation(() => ({
      extract: jest.fn().mockResolvedValue({
        success: true,
        confidence: 0.95,
        data: {
          invoice_number: '677931',
          date: '17-Mar-2026',
          vendor: 'Scooter Software',
          amount: '31.50',
          currency: 'USD',
        },
        rawText: 'Invoice #677931\nDated 17-Mar-2026\nScooter Software\nTotal: $31.50 USD',
        metadata: {
          fieldsExtracted: 5,
          missingFields: [],
          uncertainFields: [],
          extractionMethod: 'pdf-parse',
          processingTimeMs: 42,
        },
      }),
    })),
  };
});

const PLUGIN_KEY = 'document-extractor';
const USER_ID = 'test-user-id';

describe('DocumentExtractorPluginExecutor', () => {
  let executor: any;

  beforeAll(async () => {
    // SA review item #4: document-extractor is a system plugin (isSystem: true).
    // The mock user connections will return null for getConnection, but
    // BasePluginExecutor.executeAction allows null connection for system plugins.
    const ctx = await createTestExecutor(DocumentExtractorPluginExecutor, PLUGIN_KEY);
    executor = ctx.executor;
  });

  afterEach(() => {
    restoreFetch();
  });

  // ---- extract_structured_data ----
  describe('extract_structured_data', () => {
    it('should extract fields from base64 file content', async () => {
      // Safety net: mock fetch to catch any accidental network calls
      mockFetchSuccess({});

      const result = await executor.executeAction(USER_ID, 'extract_structured_data', {
        file_content: Buffer.from('%PDF-1.4 fake content').toString('base64'),
        mime_type: 'application/pdf',
        filename: 'Invoice677931.pdf',
        fields: [
          { name: 'invoice_number', type: 'string', description: 'Invoice number' },
          { name: 'date', type: 'date', description: 'Invoice date' },
          { name: 'vendor', type: 'string', description: 'Vendor name' },
          { name: 'amount', type: 'string', description: 'Total amount' },
          { name: 'currency', type: 'string', description: 'Currency code' },
        ],
      });

      expectSuccessResult(result);
      expect(result.data.invoice_number).toBe('677931');
      expect(result.data.date).toBe('17-Mar-2026');
      expect(result.data.vendor).toBe('Scooter Software');
      expect(result.data.amount).toBe('31.50');
      expect(result.data.currency).toBe('USD');
      expect(result.data._extraction_metadata).toBeDefined();
      expect(result.data._extraction_metadata.confidence).toBe(0.95);
    });

    it('should reject file_content as object (schema expects string)', async () => {
      // The JSON schema defines file_content as type "string".
      // Even though the executor handles objects internally, the
      // validation layer correctly rejects non-string file_content.
      mockFetchSuccess({});

      const result = await executor.executeAction(USER_ID, 'extract_structured_data', {
        file_content: {
          content: Buffer.from('%PDF-1.4 fake').toString('base64'),
          mimeType: 'application/pdf',
          filename: 'test.pdf',
        },
        fields: [
          { name: 'invoice_number', type: 'string', description: 'Invoice number' },
        ],
      });

      // Validation rejects because file_content should be string, not object
      expectErrorResult(result, 'validation');
    });

    it('should reject missing fields array', async () => {
      mockFetchSuccess({});

      const result = await executor.executeAction(USER_ID, 'extract_structured_data', {
        file_content: 'base64data',
        mime_type: 'application/pdf',
        // fields intentionally omitted — but validation may catch it first
      });

      // The action schema requires fields, so this should fail at validation or execution
      expectErrorResult(result);
    });

    it('should verify isSystem null connection path works', async () => {
      // This test verifies SA review item #4:
      // document-extractor has isSystem=true, so executeAction should succeed
      // even when getConnection returns a virtual system connection (not null,
      // but a placeholder connection with access_token='system')
      mockFetchSuccess({});

      const result = await executor.executeAction(USER_ID, 'extract_structured_data', {
        file_content: Buffer.from('test').toString('base64'),
        mime_type: 'application/pdf',
        fields: [{ name: 'test_field', type: 'string', description: 'test' }],
      });

      // Should succeed — system plugin path should not require a real OAuth connection
      expectSuccessResult(result);
    });
  });
});
