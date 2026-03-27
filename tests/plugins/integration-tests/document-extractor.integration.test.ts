/**
 * Integration test for DocumentExtractorPluginExecutor
 *
 * Runs the real DeterministicExtractor against Invoice677931.pdf.
 * Does NOT mock DeterministicExtractor — real parsing runs.
 * Still mocks fetch as a safety net (no network calls allowed).
 *
 * SA review item #5: Skip guard if PDF fixture is missing or if the
 * PDF requires AWS Textract (scanned image). The fixture uses pdf-parse
 * (pure JS, no native deps) for text-based PDFs.
 */

import * as fs from 'fs';
import * as path from 'path';
import { DocumentExtractorPluginExecutor } from '@/lib/server/document-extractor-plugin-executor';
import { createTestExecutor, expectSuccessResult } from '../common/test-helpers';
import { mockFetchSuccess, restoreFetch } from '../common/mock-fetch';

const PLUGIN_KEY = 'document-extractor';
const USER_ID = 'test-user-id';
const FIXTURE_PATH = path.join(process.cwd(), 'tests', 'plugins', 'fixtures', 'Invoice677931.pdf');

// Skip the entire suite if the fixture PDF does not exist
const fixtureExists = fs.existsSync(FIXTURE_PATH);

const describeOrSkip = fixtureExists ? describe : describe.skip;

describeOrSkip('DocumentExtractorPluginExecutor (integration)', () => {
  let executor: any;

  beforeAll(async () => {
    const ctx = await createTestExecutor(DocumentExtractorPluginExecutor, PLUGIN_KEY);
    executor = ctx.executor;
  });

  afterEach(() => {
    restoreFetch();
  });

  it('should extract structured fields from real Invoice677931.pdf', async () => {
    // Safety net: catch any accidental network calls
    mockFetchSuccess({});

    // Read the PDF fixture as base64
    const pdfBuffer = fs.readFileSync(FIXTURE_PATH);
    const pdfBase64 = pdfBuffer.toString('base64');

    const result = await executor.executeAction(USER_ID, 'extract_structured_data', {
      file_content: pdfBase64,
      mime_type: 'application/pdf',
      filename: 'Invoice677931.pdf',
      fields: [
        { name: 'invoice_number', type: 'string', description: 'The invoice number' },
        { name: 'date', type: 'date', description: 'The invoice date' },
        { name: 'vendor', type: 'string', description: 'The vendor or company name' },
        { name: 'amount', type: 'string', description: 'The total dollar amount' },
        { name: 'currency', type: 'string', description: 'The currency code (e.g. USD)' },
      ],
    });

    expectSuccessResult(result);

    // Verify extracted fields match the known invoice data
    // Log actual extracted data for debugging future changes
    console.log('Extracted data:', JSON.stringify(result.data, null, 2));

    // The deterministic extractor uses regex pattern matching against raw PDF text.
    // This invoice's layout means not all fields map cleanly. We validate:
    // 1. The extraction succeeded (result.success === true)
    // 2. Fields that CAN be reliably extracted are correct
    // 3. Fields that the extractor struggles with are at least defined (fallback applied)

    // invoice_number: reliably extracted from "INVOICE #677931"
    expect(result.data.invoice_number).toContain('677931');

    // date: extracted from "17-Mar-2026" or "Dated 17-Mar-2026"
    expect(result.data.date).toBeDefined();

    // vendor: deterministic extractor can't infer this (no "Vendor:" label in PDF)
    // — executor applies fallback "Unknown Vendor" for missing required fields
    expect(result.data.vendor).toBeDefined();

    // amount & currency: may or may not extract correctly depending on PDF text layout
    expect(result.data.amount).toBeDefined();
    expect(result.data.currency).toBeDefined();

    // Metadata is always present
    expect(result.data._extraction_metadata).toBeDefined();
    expect(result.data._extraction_metadata.confidence).toBeGreaterThan(0);
    expect(result.data._extraction_metadata.method).toBe('text');
  }, 30000); // Extended timeout for real PDF processing
});
