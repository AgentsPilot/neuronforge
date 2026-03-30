/**
 * Test extraction with improved field descriptions
 */

import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';
import { DeterministicExtractor } from '@/lib/extraction/DeterministicExtractor';
import type { OutputSchema } from '@/lib/extraction/types';

// Load environment variables
config({ path: path.join(process.cwd(), '.env.local') });

const TEST_PDFS = [
  'Invoice677931.pdf',
  'Receipt-HMGRLQ-00003.pdf'
];

// Improved schema with comprehensive field descriptions
const OUTPUT_SCHEMA: OutputSchema = {
  fields: [
    {
      name: 'invoice_number',
      type: 'string',
      description: 'Invoice number, receipt number, document number, invoice, receipt, or number',
      required: true,
    },
    {
      name: 'vendor',
      type: 'string',
      // Add EVERYTHING we see in the documents
      description: 'Vendor name, company name, supplier name, seller, merchant, from, billed by, business name, organization, or any company identifier at the top of the document',
      required: true,
    },
    {
      name: 'date',
      type: 'string',
      description: 'Invoice date, receipt date, document date, dated, payment date, or transaction date',
      required: true,
    },
    {
      name: 'total_amount',
      type: 'string',
      // Add "amount paid" which appears in the ngrok receipt
      description: 'Total amount, grand total, amount due, balance, invoice total, amount paid, subtotal, or total',
      required: true,
    },
    {
      name: 'customer_info',
      type: 'string',
      description: 'Customer name, bill to, sold to, customer information, or deliver to',
      required: false,
    },
  ],
};

async function testPdf(filename: string) {
  const pdfPath = path.join(process.cwd(), 'test-files', filename);

  console.log('━'.repeat(100));
  console.log(`TESTING: ${filename}`);
  console.log('━'.repeat(100));
  console.log();

  if (!fs.existsSync(pdfPath)) {
    console.error(`❌ File not found: ${pdfPath}`);
    return;
  }

  const fileBuffer = fs.readFileSync(pdfPath);
  const base64Content = fileBuffer.toString('base64');

  const extractor = new DeterministicExtractor(true);
  const startTime = Date.now();
  const result = await extractor.extract({
    content: base64Content,
    mimeType: 'application/pdf',
    filename: filename,
    config: {
      outputSchema: OUTPUT_SCHEMA,
      ocrFallback: true,
    },
  });
  const elapsed = Date.now() - startTime;

  console.log('📊 EXTRACTION RESULTS:');
  console.log('─'.repeat(100));
  OUTPUT_SCHEMA.fields.forEach(field => {
    const value = result.data[field.name];
    const status = value && !value.startsWith('Unknown ') ? '✅' : '❌';
    console.log(`${status} ${field.name}: ${value || '(null)'}`);
  });
  console.log();
  console.log(`⏱️  Extraction took ${elapsed}ms`);
  console.log(`📊 Confidence: ${(result.confidence * 100).toFixed(1)}%`);
  console.log(`📋 Method: ${result.metadata.extractionMethod}`);
  console.log(`📋 Fields extracted: ${result.metadata.fieldsExtracted}/${result.metadata.fieldsRequested}`);
  if (result.metadata.missingFields.length > 0) {
    console.log(`⚠️  Missing: ${result.metadata.missingFields.join(', ')}`);
  }
  console.log();

  return result;
}

async function main() {
  console.log('='.repeat(100));
  console.log('TESTING EXTRACTION WITH IMPROVED FIELD DESCRIPTIONS');
  console.log('='.repeat(100));
  console.log();

  const results = [];

  for (const filename of TEST_PDFS) {
    const result = await testPdf(filename);
    results.push({ filename, result });
  }

  console.log('='.repeat(100));
  console.log('SUMMARY');
  console.log('='.repeat(100));
  console.log();

  results.forEach(({ filename, result }) => {
    const allFieldsExtracted = result.metadata.missingFields.length === 0;
    const status = allFieldsExtracted ? '✅ SUCCESS' : '❌ FAILED';
    console.log(`${status} ${filename}: ${result.metadata.fieldsExtracted}/${result.metadata.fieldsRequested} fields (${(result.confidence * 100).toFixed(1)}%)`);
    if (result.metadata.missingFields.length > 0) {
      console.log(`   Missing: ${result.metadata.missingFields.join(', ')}`);
    }
  });
  console.log();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
