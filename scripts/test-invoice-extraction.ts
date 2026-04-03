/**
 * Test invoice extraction using document-extractor plugin
 *
 * This script extracts structured data from invoice PDFs
 */

import fs from 'fs';
import path from 'path';
import { DeterministicExtractor } from '@/lib/extraction/DeterministicExtractor';

async function main() {
  console.log('📄 Invoice Extraction Test\n');

  // Invoice files to test
  const invoiceFiles = [
    'Invoice677931.pdf',
    'Receipt-2667-7775-2451.pdf',
    'Receipt-HMGRLQ-00003.pdf'
  ];

  // Fields to extract from invoices
  const fieldsToExtract = [
    { name: 'invoice_number', type: 'string', description: 'Invoice or receipt number', required: true },
    { name: 'vendor', type: 'string', description: 'Vendor or company name', required: true },
    { name: 'date', type: 'date', description: 'Invoice date', required: true },
    { name: 'amount', type: 'currency', description: 'Total amount', required: true },
    { name: 'currency', type: 'string', description: 'Currency code (USD, EUR, etc)', required: false },
  ];

  const extractor = new DeterministicExtractor(true); // Enable OCR

  for (const filename of invoiceFiles) {
    console.log('━'.repeat(80));
    console.log(`📋 Processing: ${filename}`);
    console.log('━'.repeat(80));

    try {
      // Read file
      const filePath = path.join(process.cwd(), 'test-files', filename);
      if (!fs.existsSync(filePath)) {
        console.log(`❌ File not found: ${filePath}\n`);
        continue;
      }

      const fileBuffer = fs.readFileSync(filePath);
      const base64Content = fileBuffer.toString('base64');

      console.log(`✅ Loaded file (${(fileBuffer.length / 1024).toFixed(2)} KB)`);

      // Extract data
      const startTime = Date.now();
      const result = await extractor.extract({
        content: base64Content,
        mimeType: 'application/pdf',
        filename,
        config: {
          outputSchema: { fields: fieldsToExtract },
          ocrFallback: true
        }
      });
      const duration = Date.now() - startTime;

      // Display results
      console.log(`\n⏱️  Extraction completed in ${duration}ms`);
      console.log(`📊 Confidence: ${(result.confidence * 100).toFixed(1)}%`);
      console.log(`🔧 Method: ${result.metadata.extractionMethod}`);

      console.log('\n📝 Extracted Fields:');
      if (result.data) {
        for (const [key, value] of Object.entries(result.data)) {
          const fieldDef = fieldsToExtract.find(f => f.name === key);
          const required = fieldDef?.required ? '[REQUIRED]' : '[OPTIONAL]';
          console.log(`   ${key}: ${value || '(not found)'} ${required}`);
        }
      }

      if (result.metadata.missingFields && result.metadata.missingFields.length > 0) {
        console.log(`\n⚠️  Missing required fields: ${result.metadata.missingFields.join(', ')}`);
      }

      if (result.metadata.uncertainFields && result.metadata.uncertainFields.length > 0) {
        console.log(`\n⚡ Uncertain fields: ${result.metadata.uncertainFields.join(', ')}`);
      }

      // Show raw text sample
      if (result.rawText) {
        console.log(`\n📄 Raw Text (first 300 chars):`);
        console.log(result.rawText.substring(0, 300).replace(/\n/g, ' ') + '...');
      }

      console.log();

    } catch (error: any) {
      console.error(`❌ Error processing ${filename}:`, error.message);
      console.log();
    }
  }

  console.log('━'.repeat(80));
  console.log('✅ Extraction test complete');
  console.log('━'.repeat(80));
}

main().catch(console.error);
