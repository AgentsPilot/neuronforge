/**
 * WP-57 end-to-end chain: google-drive.download_file → document-extractor.
 *
 * Proves the fix works on a real PDF without external creds: the Drive download
 * (HTTP mocked) produces base64 bytes in `content`, and feeding that exact base64 to
 * the real DeterministicExtractor extracts real invoice fields. This closes the loop
 * the WP-57 compiler auto-insert wires up at generation time
 * (list_files → download_file → document-extractor, with
 * document-extractor.file_content = {{download.content}}).
 */

import * as fs from 'fs';
import * as path from 'path';
import { GoogleDrivePluginExecutor } from '@/lib/server/google-drive-plugin-executor';
import { createTestExecutor } from '../common/test-helpers';
import { mockFetchSequence, restoreFetch } from '../common/mock-fetch';
import { DeterministicExtractor } from '@/lib/extraction/DeterministicExtractor';
import type { OutputSchema } from '@/lib/extraction/types';

// Keep extraction deterministic — no real LLM calls (same as the all-invoices test).
jest.mock('@/lib/extraction/LLMFieldMapper', () => ({
  LLMFieldMapper: jest.fn().mockImplementation(() => ({
    mapFields: jest.fn().mockResolvedValue({ mappedFields: {}, unmappedFields: [], confidence: 0 }),
  })),
}));

const FIXTURES_DIR = path.join(process.cwd(), 'tests', 'plugins', 'fixtures');
const USER_ID = 'test-user-id';

const SCHEMA: OutputSchema = {
  fields: [
    { name: 'invoice_number', type: 'string', description: 'Invoice/receipt/document number', required: true },
    { name: 'vendor', type: 'string', description: 'Vendor, company, or merchant name', required: true },
    { name: 'total_amount', type: 'string', description: 'Total amount or amount due', required: true },
  ],
};

describe('[integration] WP-57 chain: google-drive.download_file → document-extractor', () => {
  let drive: any;

  beforeAll(async () => {
    const ctx = await createTestExecutor(GoogleDrivePluginExecutor, 'google-drive');
    drive = ctx.executor;
  });

  afterEach(() => restoreFetch());

  const fixture = 'Invoice677931.pdf';
  const fullPath = path.join(FIXTURES_DIR, fixture);
  const run = fs.existsSync(fullPath) ? it : it.skip;

  run('downloads a Drive PDF as base64 and document-extractor extracts its fields', async () => {
    const pdfBytes = fs.readFileSync(fullPath);

    // 1) Mock the Drive HTTP: the metadata call, then the alt=media binary download.
    mockFetchSequence([
      { body: { id: 'drive-pdf-1', name: fixture, mimeType: 'application/pdf', size: String(pdfBytes.length) } },
      { body: pdfBytes },
    ]);

    // 2) Drive download_file → base64 in `content` (the WP-57 output shape).
    const dl = await drive.executeAction(USER_ID, 'download_file', { file_id: 'drive-pdf-1' });
    expect(dl.success).toBe(true);
    expect(dl.data.mimeType).toBe('application/pdf');
    expect(typeof dl.data.content).toBe('string');
    // The downloaded base64 round-trips to the original PDF bytes (no .text() corruption).
    expect(Buffer.from(dl.data.content, 'base64').equals(pdfBytes)).toBe(true);

    // 3) Feed download_file's `content` straight into the real extractor — the exact wiring
    //    the auto-insert emits as document-extractor.file_content = {{download.content}}.
    const extractor = new DeterministicExtractor(true);
    const result = await extractor.extract({
      content: dl.data.content,
      mimeType: dl.data.mimeType,
      filename: dl.data.filename,
      config: { outputSchema: SCHEMA, ocrFallback: true },
    });

    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data.invoice_number).toContain('677931');
    expect(result.metadata.fieldsExtracted).toBeGreaterThanOrEqual(1);
  }, 30000);
});
