/**
 * Debug script to see raw Textract data from failing PDFs
 */

import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';
import { DeterministicExtractor } from '@/lib/extraction/DeterministicExtractor';
import type { OutputSchema } from '@/lib/extraction/types';

// Load environment variables
config({ path: path.join(process.cwd(), '.env.local') });

// Test the two failing invoices
const FAILING_PDFS = [
  'Invoice677931.pdf',
  'Receipt-HMGRLQ-00003.pdf'
];

const OUTPUT_SCHEMA: OutputSchema = {
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
      description: 'Vendor name, company name, supplier name, seller, merchant, or billed by',
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
      description: 'Total amount, grand total, amount due, balance, or invoice total',
      required: true,
    },
    {
      name: 'customer_info',
      type: 'string',
      description: 'Customer name, bill to, sold to, or customer information',
      required: false,
    },
  ],
};

async function debugPdf(filename: string) {
  const pdfPath = path.join(process.cwd(), 'test-files', filename);

  console.log('━'.repeat(100));
  console.log(`DEBUGGING: ${filename}`);
  console.log('━'.repeat(100));
  console.log();

  if (!fs.existsSync(pdfPath)) {
    console.error(`❌ File not found: ${pdfPath}`);
    return;
  }

  const fileBuffer = fs.readFileSync(pdfPath);
  const base64Content = fileBuffer.toString('base64');

  const extractor = new DeterministicExtractor(true);
  const result = await extractor.extract({
    content: base64Content,
    mimeType: 'application/pdf',
    filename: filename,
    config: {
      outputSchema: OUTPUT_SCHEMA,
      ocrFallback: true,
    },
  });

  console.log('📊 EXTRACTION RESULTS:');
  console.log('─'.repeat(100));
  OUTPUT_SCHEMA.fields.forEach(field => {
    const value = result.data[field.name];
    const status = value && !value.startsWith('Unknown ') ? '✅' : '❌';
    console.log(`${status} ${field.name}: ${value || '(null)'}`);
  });
  console.log();
  console.log(`Confidence: ${(result.confidence * 100).toFixed(1)}%`);
  console.log(`Method: ${result.metadata.extractionMethod}`);
  console.log();

  // Show raw text
  console.log('📄 RAW TEXT EXTRACTED:');
  console.log('─'.repeat(100));
  console.log(result.rawText?.substring(0, 2000) || '(no text)');
  if (result.rawText && result.rawText.length > 2000) {
    console.log(`\n... (${result.rawText.length - 2000} more characters)`);
  }
  console.log();

  // Save full raw text for manual inspection
  const outputPath = path.join(process.cwd(), 'test-files', filename.replace('.pdf', '-DEBUG-raw-text.txt'));
  if (result.rawText) {
    fs.writeFileSync(outputPath, result.rawText, 'utf-8');
    console.log(`💾 Full raw text saved to: ${outputPath}`);
  }
  console.log();

  // Get detailed extraction info
  const detailedPath = path.join(process.cwd(), 'test-files', filename.replace('.pdf', '-DEBUG-detailed.json'));
  fs.writeFileSync(detailedPath, JSON.stringify({
    filename,
    extractionResult: result,
    metadata: result.metadata,
    fields: result.data,
  }, null, 2), 'utf-8');
  console.log(`💾 Detailed extraction info saved to: ${detailedPath}`);
  console.log();
}

async function main() {
  console.log('='.repeat(100));
  console.log('DEBUGGING FAILING PDF EXTRACTIONS');
  console.log('='.repeat(100));
  console.log();
  console.log('This script will extract raw text and detailed info from PDFs that failed to extract all fields.');
  console.log();

  for (const filename of FAILING_PDFS) {
    await debugPdf(filename);
  }

  console.log('='.repeat(100));
  console.log('DEBUG COMPLETE');
  console.log('='.repeat(100));
  console.log();
  console.log('Next steps:');
  console.log('1. Review the *-DEBUG-raw-text.txt files to see if vendor/amount are in the text');
  console.log('2. Check *-DEBUG-detailed.json for extraction details');
  console.log('3. Identify what patterns/labels the PDFs use for missing fields');
  console.log('4. Update extraction logic to handle those patterns');
  console.log();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
