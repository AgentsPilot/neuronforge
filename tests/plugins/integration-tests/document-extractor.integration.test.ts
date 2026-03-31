/**
 * Integration tests for DocumentExtractorPluginExecutor
 *
 * Runs the real DeterministicExtractor against PDF fixtures.
 * Does NOT mock DeterministicExtractor — real parsing runs.
 * Still mocks fetch as a safety net (no network calls allowed).
 *
 * These tests serve as an ACCURACY BENCHMARK for the deterministic extractor.
 * Each assertion is categorized:
 *   - "Correctly extracted" — the extractor gets the right value
 *   - "Known limitation"   — the extractor returns wrong/fallback data
 *
 * When SchemaFieldExtractor is improved, "known limitation" assertions will
 * start failing — that's the signal to tighten them to real expected values.
 *
 * Fixtures:
 *  - Invoice677931.pdf          — Scooter Software license invoice ($31.50)
 *  - Receipt-2667-7775-2451.pdf — Anthropic API credit purchase ($50.00)
 *  - Receipt-HMGRLQ-00003.pdf   — ngrok monthly license ($10.00)
 *  - Invoice-ZYVUTAKJ-0003.pdf  — Anthropic Max plan invoice ($80.72)
 */

import * as fs from 'fs';
import * as path from 'path';
import { DocumentExtractorPluginExecutor } from '@/lib/server/document-extractor-plugin-executor';
import { createTestExecutor, expectSuccessResult } from '../common/test-helpers';
import { mockFetchSuccess, restoreFetch } from '../common/mock-fetch';

// Mock LLMFieldMapper to prevent real LLM API calls during integration tests.
// The real DeterministicExtractor and SchemaFieldExtractor run, but LLM fallback
// returns empty results so we only test deterministic extraction accuracy.
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

const PLUGIN_KEY = 'document-extractor';
const USER_ID = 'test-user-id';
const FIXTURES_DIR = path.join(process.cwd(), 'tests', 'plugins', 'fixtures');

// Common extraction fields used across all receipt/invoice tests
const EXTRACTION_FIELDS = [
  { name: 'invoice_number', type: 'string', description: 'The invoice or receipt number' },
  { name: 'date', type: 'date', description: 'The invoice/receipt date' },
  { name: 'vendor', type: 'string', description: 'The vendor or company name' },
  { name: 'amount', type: 'currency', description: 'The total amount paid' },
  { name: 'currency', type: 'string', description: 'The currency code (e.g. USD)' },
];

/** Helper: read a PDF fixture as base64, or return null if missing */
function readFixture(filename: string): string | null {
  const fullPath = path.join(FIXTURES_DIR, filename);
  if (!fs.existsSync(fullPath)) return null;
  return fs.readFileSync(fullPath).toString('base64');
}

/** Helper: run extraction against a fixture */
async function extractFromFixture(
  executor: any,
  base64Content: string,
  filename: string,
) {
  mockFetchSuccess({}); // safety net — catch accidental network calls
  return executor.executeAction(USER_ID, 'extract_structured_data', {
    file_content: base64Content,
    mime_type: 'application/pdf',
    filename,
    fields: EXTRACTION_FIELDS,
  });
}

describe('DocumentExtractorPluginExecutor (integration)', () => {
  let executor: any;

  beforeAll(async () => {
    const ctx = await createTestExecutor(DocumentExtractorPluginExecutor, PLUGIN_KEY);
    executor = ctx.executor;
  });

  afterEach(() => {
    restoreFetch();
  });

  // ==========================================================================
  // Invoice677931.pdf — Scooter Software ($31.50 USD, 17-Mar-2026)
  // ==========================================================================

  const invoice677931 = readFixture('Invoice677931.pdf');
  const describeInvoice = invoice677931 ? describe : describe.skip;

  describeInvoice('Invoice677931.pdf (Scooter Software — $31.50)', () => {
    it('should extract structured fields', async () => {
      const result = await extractFromFixture(executor, invoice677931!, 'Invoice677931.pdf');
      expectSuccessResult(result);
      console.log('[Invoice677931] Extracted:', JSON.stringify(result.data, null, 2));

      // --- Correctly extracted ---
      expect(result.data.invoice_number).toContain('677931');

      // --- Known limitations (update when extractor improves) ---
      // date: extracts "d 17-Mar-2026" — has leading artifact from "Dated" label
      expect(result.data.date).toBe('d 17-Mar-2026');
      // vendor: no "Vendor:" label in PDF — fallback applied
      expect(result.data.vendor).toBe('Unknown Vendor');
      // amount: picks up part number "1BC5S1" instead of "$31.50"
      expect(result.data.amount).toBe('1BC5S1');
      // currency: picks up "Ship Via" from table header instead of "USD"
      expect(result.data.currency).toBe('Ship Via');

      // Metadata
      expect(result.data._extraction_metadata.confidence).toBeCloseTo(0.56, 1);
      expect(result.data._extraction_metadata.method).toBe('text');
      expect(result.data._extraction_metadata.missing_fields).toContain('vendor');
    }, 30000);
  });

  // ==========================================================================
  // Receipt-2667-7775-2451.pdf — Anthropic ($50.00 USD, March 16, 2026)
  // ==========================================================================

  const receiptAnthopic = readFixture('Receipt-2667-7775-2451.pdf');
  const describeAnthopic = receiptAnthopic ? describe : describe.skip;

  describeAnthopic('Receipt-2667-7775-2451.pdf (Anthropic — $50.00)', () => {
    it('should extract structured fields', async () => {
      const result = await extractFromFixture(executor, receiptAnthopic!, 'Receipt-2667-7775-2451.pdf');
      expectSuccessResult(result);
      console.log('[Anthropic Receipt] Extracted:', JSON.stringify(result.data, null, 2));

      // --- Correctly extracted ---
      // invoice_number: "ATJYUG83-0001" (has null byte from PDF encoding)
      expect(result.data.invoice_number).toContain('ATJYUG83');

      // --- Known limitations (update when extractor improves) ---
      // date: extracts "paidMarch 16, 2026" — "Date paid" label runs into value
      expect(result.data.date).toBe('paidMarch 16, 2026');
      // vendor: no "Vendor:" label — "Anthropic, PBC" is in address block, not matched
      expect(result.data.vendor).toBe('Unknown Vendor');
      // amount: grabs entire table row instead of just "$50.00"
      expect(result.data.amount).toBe('One-time credit purchase1$50.00$50.00');
      // currency: no clear "Currency: USD" label — fallback applied
      expect(result.data.currency).toBe('Unknown Currency');

      // Metadata
      expect(result.data._extraction_metadata.confidence).toBeCloseTo(0.42, 1);
      expect(result.data._extraction_metadata.method).toBe('text');
      expect(result.data._extraction_metadata.missing_fields).toEqual(
        expect.arrayContaining(['vendor', 'currency'])
      );
    }, 30000);
  });

  // ==========================================================================
  // Receipt-HMGRLQ-00003.pdf — ngrok ($10.00 USD, Nov 23, 2025)
  // ==========================================================================

  const receiptNgrok = readFixture('Receipt-HMGRLQ-00003.pdf');
  const describeNgrok = receiptNgrok ? describe : describe.skip;

  describeNgrok('Receipt-HMGRLQ-00003.pdf (ngrok — $10.00)', () => {
    it('should extract structured fields', async () => {
      const result = await extractFromFixture(executor, receiptNgrok!, 'Receipt-HMGRLQ-00003.pdf');
      expectSuccessResult(result);
      console.log('[ngrok Receipt] Extracted:', JSON.stringify(result.data, null, 2));

      // --- Correctly extracted ---
      // invoice_number: cleanly extracted from "Invoice numberHMGRLQ-00003"
      expect(result.data.invoice_number).toBe('HMGRLQ-00003');
      // date: cleanly extracted from "Receipt dateNov 23, 2025"
      expect(result.data.date).toBe('Nov 23, 2025');

      // --- Known limitations (update when extractor improves) ---
      // vendor: "ngrok Inc." is in address block, not matched by pattern
      expect(result.data.vendor).toBe('Unknown Vendor');
      // amount: extracts "paid$10.00" — "Amount paid" label prefix leaks in
      expect(result.data.amount).toBe('paid$10.00');
      // currency: no "Currency:" label — fallback applied
      expect(result.data.currency).toBe('Unknown Currency');

      // Metadata
      expect(result.data._extraction_metadata.confidence).toBeCloseTo(0.42, 1);
      expect(result.data._extraction_metadata.method).toBe('text');
      expect(result.data._extraction_metadata.missing_fields).toEqual(
        expect.arrayContaining(['vendor', 'currency'])
      );
    }, 30000);
  });

  // ==========================================================================
  // Invoice-ZYVUTAKJ-0003.pdf — Anthropic Max plan ($80.72 USD, Aug 31, 2025)
  // ==========================================================================

  const invoiceAnthropicMax = readFixture('Invoice-ZYVUTAKJ-0003 (1) (1).pdf');
  const describeAnthropicMax = invoiceAnthropicMax ? describe : describe.skip;

  describeAnthropicMax('Invoice-ZYVUTAKJ-0003.pdf (Anthropic Max — $80.72)', () => {
    it('should extract structured fields', async () => {
      const result = await extractFromFixture(executor, invoiceAnthropicMax!, 'Invoice-ZYVUTAKJ-0003.pdf');
      expectSuccessResult(result);
      console.log('[Anthropic Max Invoice] Extracted:', JSON.stringify(result.data, null, 2));

      // --- Correctly extracted ---
      // invoice_number: extracted from "Invoice numberZYVUTAKJ-0003" (has null byte from PDF)
      expect(result.data.invoice_number).toContain('ZYVUTAKJ');

      // --- Known limitations (update when extractor improves) ---
      // date: "Date of issue" label leaks into value
      expect(result.data.date).toBe('of issueAugust 31, 2025');
      // vendor: "Anthropic, PBC" in address block, not matched
      expect(result.data.vendor).toBe('Unknown Vendor');
      // amount: grabs "Max plan - 5x" description instead of "$80.72"
      expect(result.data.amount).toBe('Max plan - 5x');
      // currency: grabs "due August 31, 2025" from "Date due" line
      expect(result.data.currency).toBe('due August 31, 2025');

      // Metadata
      expect(result.data._extraction_metadata.confidence).toBeCloseTo(0.56, 1);
      expect(result.data._extraction_metadata.method).toBe('text');
      expect(result.data._extraction_metadata.missing_fields).toContain('vendor');
    }, 30000);
  });
});
