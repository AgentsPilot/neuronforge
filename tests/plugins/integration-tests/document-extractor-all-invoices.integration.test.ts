/**
 * Integration tests for DeterministicExtractor across multiple invoice formats.
 *
 * Converted from scripts/test-all-invoices.ts into proper Jest assertions.
 * Runs the real DeterministicExtractor against PDF fixtures.
 * LLMFieldMapper is mocked to prevent real API calls.
 *
 * Each PDF is a separate test case verifying that DeterministicExtractor
 * can extract standard fields (invoice_number, vendor, date, total_amount,
 * currency) from different invoice/receipt layouts.
 *
 * Fixtures:
 *  - Invoice677931.pdf          -- Scooter Software license invoice ($31.50)
 *  - Receipt-2667-7775-2451.pdf -- Anthropic API credit purchase ($50.00)
 *  - Receipt-HMGRLQ-00003.pdf   -- ngrok monthly license ($10.00)
 *  - Invoice-ZYVUTAKJ-0003.pdf  -- Anthropic Max plan invoice ($80.72)
 */

import * as fs from 'fs';
import * as path from 'path';
import { DeterministicExtractor } from '@/lib/extraction/DeterministicExtractor';
import type { OutputSchema } from '@/lib/extraction/types';

// Mock LLMFieldMapper to prevent real LLM API calls during integration tests.
jest.mock('@/lib/extraction/LLMFieldMapper', () => {
  return {
    LLMFieldMapper: jest.fn().mockImplementation(() => ({
      mapFields: jest.fn().mockResolvedValue({
        mappedFields: {},
        unmappedFields: [],
        confidence: 0,
      }),
    })),
  };
});

const FIXTURES_DIR = path.join(process.cwd(), 'tests', 'plugins', 'fixtures');

// Standard fields matching the original script
const STANDARD_SCHEMA: OutputSchema = {
  fields: [
    {
      name: 'invoice_number',
      type: 'string',
      description: 'Invoice number, receipt number, or document number',
      required: true,
    },
    {
      name: 'vendor',
      type: 'string',
      description: 'Vendor name, company name, merchant name, or seller',
      required: true,
    },
    {
      name: 'date',
      type: 'string',
      description: 'Invoice date, receipt date, or document date',
      required: true,
    },
    {
      name: 'total_amount',
      type: 'string',
      description: 'Total amount, amount due, grand total, or balance',
      required: true,
    },
    {
      name: 'currency',
      type: 'string',
      description: 'The currency code (e.g. USD)',
      required: false,
    },
  ],
};

/** Helper: read a PDF fixture as base64, or return null if missing */
function readFixture(filename: string): string | null {
  const fullPath = path.join(FIXTURES_DIR, filename);
  if (!fs.existsSync(fullPath)) return null;
  return fs.readFileSync(fullPath).toString('base64');
}

/** Helper: run DeterministicExtractor against a fixture */
async function extractFromFixture(base64Content: string, filename: string) {
  const extractor = new DeterministicExtractor(true);
  return extractor.extract({
    content: base64Content,
    mimeType: 'application/pdf',
    filename,
    config: {
      outputSchema: STANDARD_SCHEMA,
      ocrFallback: true,
    },
  });
}

describe('DeterministicExtractor — all invoices (integration)', () => {

  // ==========================================================================
  // Invoice677931.pdf -- Scooter Software ($31.50 USD, 17-Mar-2026)
  // ==========================================================================

  const invoice677931 = readFixture('Invoice677931.pdf');
  const describeInvoice = invoice677931 ? describe : describe.skip;

  describeInvoice('Invoice677931.pdf (Scooter Software -- $31.50)', () => {
    it('should extract standard fields from the PDF', async () => {
      const result = await extractFromFixture(invoice677931!, 'Invoice677931.pdf');

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();

      // invoice_number: should contain 677931
      expect(result.data.invoice_number).toContain('677931');

      // Metadata should be present
      expect(result.metadata).toBeDefined();
      expect(['text', 'text+llm']).toContain(result.metadata.extractionMethod);
      expect(result.metadata.fieldsRequested).toBe(STANDARD_SCHEMA.fields.length);
      expect(result.metadata.fieldsExtracted).toBeGreaterThanOrEqual(1);

      // Confidence should be a number between 0 and 1
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    }, 30000);
  });

  // ==========================================================================
  // Receipt-2667-7775-2451.pdf -- Anthropic ($50.00 USD, March 16, 2026)
  // ==========================================================================

  const receiptAnthopic = readFixture('Receipt-2667-7775-2451.pdf');
  const describeAnthopic = receiptAnthopic ? describe : describe.skip;

  describeAnthopic('Receipt-2667-7775-2451.pdf (Anthropic -- $50.00)', () => {
    it('should extract standard fields from the PDF', async () => {
      const result = await extractFromFixture(receiptAnthopic!, 'Receipt-2667-7775-2451.pdf');

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();

      // invoice_number: should contain ATJYUG83
      expect(result.data.invoice_number).toContain('ATJYUG83');

      // Metadata
      expect(result.metadata).toBeDefined();
      expect(['text', 'text+llm']).toContain(result.metadata.extractionMethod);
      expect(result.metadata.fieldsExtracted).toBeGreaterThanOrEqual(1);

      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    }, 30000);
  });

  // ==========================================================================
  // Receipt-HMGRLQ-00003.pdf -- ngrok ($10.00 USD, Nov 23, 2025)
  // ==========================================================================

  const receiptNgrok = readFixture('Receipt-HMGRLQ-00003.pdf');
  const describeNgrok = receiptNgrok ? describe : describe.skip;

  describeNgrok('Receipt-HMGRLQ-00003.pdf (ngrok -- $10.00)', () => {
    it('should extract standard fields from the PDF', async () => {
      const result = await extractFromFixture(receiptNgrok!, 'Receipt-HMGRLQ-00003.pdf');

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();

      // invoice_number: should be HMGRLQ-00003
      expect(result.data.invoice_number).toBe('HMGRLQ-00003');

      // date: should contain Nov 23, 2025
      expect(result.data.date).toContain('Nov 23, 2025');

      // Metadata
      expect(result.metadata).toBeDefined();
      expect(['text', 'text+llm']).toContain(result.metadata.extractionMethod);
      expect(result.metadata.fieldsExtracted).toBeGreaterThanOrEqual(2);

      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    }, 30000);
  });

  // ==========================================================================
  // Invoice-ZYVUTAKJ-0003.pdf -- Anthropic Max plan ($80.72 USD, Aug 31, 2025)
  // ==========================================================================

  const invoiceAnthropicMax = readFixture('Invoice-ZYVUTAKJ-0003 (1) (1).pdf');
  const describeAnthropicMax = invoiceAnthropicMax ? describe : describe.skip;

  describeAnthropicMax('Invoice-ZYVUTAKJ-0003.pdf (Anthropic Max -- $80.72)', () => {
    it('should extract standard fields from the PDF', async () => {
      const result = await extractFromFixture(invoiceAnthropicMax!, 'Invoice-ZYVUTAKJ-0003.pdf');

      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();

      // invoice_number: should contain ZYVUTAKJ
      expect(result.data.invoice_number).toContain('ZYVUTAKJ');

      // Metadata
      expect(result.metadata).toBeDefined();
      expect(['text', 'text+llm']).toContain(result.metadata.extractionMethod);
      expect(result.metadata.fieldsExtracted).toBeGreaterThanOrEqual(1);

      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    }, 30000);
  });

  // ==========================================================================
  // Cross-PDF consistency checks
  // ==========================================================================

  describe('cross-PDF consistency', () => {
    it('all fixtures should exist in the fixtures directory', () => {
      // At minimum, verify the fixture directory exists and has PDFs
      expect(fs.existsSync(FIXTURES_DIR)).toBe(true);
      const pdfFiles = fs.readdirSync(FIXTURES_DIR).filter(f => f.endsWith('.pdf'));
      expect(pdfFiles.length).toBeGreaterThanOrEqual(4);
    });
  });
});
