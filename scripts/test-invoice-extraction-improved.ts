/**
 * Test invoice extraction with improved field descriptions
 * to help pattern matching find vendor names
 */

import fs from 'fs';
import path from 'path';
import { DeterministicExtractor } from '@/lib/extraction/DeterministicExtractor';

async function main() {
  console.log('📄 Invoice Extraction Test (Improved Descriptions)\n');

  const filename = 'Invoice677931.pdf';

  // Improved field descriptions with more keywords and context
  const fieldsToExtract = [
    {
      name: 'invoice_number',
      type: 'string',
      description: 'Invoice number, invoice #, invoice ID, receipt number, document number',
      required: true
    },
    {
      name: 'vendor',
      type: 'string',
      // Add many variations and context clues
      description: 'Company name, business name, vendor name, seller name, from company, merchant, supplier, organization name. Usually appears at the top of the invoice before customer details or "Bill to" section. May include website domain (.com). Examples: "Acme Corp", "Amazon.com", "SCOOTERSOFTWARE.COM"',
      required: true
    },
    {
      name: 'date',
      type: 'date',
      description: 'Invoice date, billing date, dated, issue date, transaction date',
      required: true
    },
    {
      name: 'amount',
      type: 'currency',
      description: 'Total amount, total due, amount due, invoice total, grand total, balance due, total price',
      required: true
    },
    {
      name: 'currency',
      type: 'string',
      description: 'Currency code: USD, EUR, GBP, CAD. May be written as US, $ symbol context',
      required: false
    },
  ];

  const extractor = new DeterministicExtractor(true);

  console.log('━'.repeat(80));
  console.log(`📋 Testing: ${filename}`);
  console.log('━'.repeat(80));

  const filePath = path.join(process.cwd(), 'test-files', filename);
  const fileBuffer = fs.readFileSync(filePath);
  const base64Content = fileBuffer.toString('base64');

  console.log(`✅ Loaded file (${(fileBuffer.length / 1024).toFixed(2)} KB)\n`);

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

  console.log(`⏱️  Extraction completed in ${duration}ms`);
  console.log(`📊 Confidence: ${(result.confidence * 100).toFixed(1)}%`);
  console.log(`🔧 Method: ${result.metadata.extractionMethod}`);

  console.log('\n📝 Extracted Fields:');
  if (result.data) {
    for (const [key, value] of Object.entries(result.data)) {
      const fieldDef = fieldsToExtract.find(f => f.name === key);
      const required = fieldDef?.required ? '[REQUIRED]' : '[OPTIONAL]';
      const status = value ? '✅' : '❌';
      console.log(`   ${status} ${key}: ${value || '(not found)'} ${required}`);
    }
  }

  if (result.metadata.missingFields && result.metadata.missingFields.length > 0) {
    console.log(`\n⚠️  Missing required fields: ${result.metadata.missingFields.join(', ')}`);
  }

  console.log(`\n📄 Full extracted text:\n`);
  console.log(result.rawText);

  console.log('\n' + '━'.repeat(80));
  console.log('Analysis:');
  console.log('━'.repeat(80));
  console.log('Looking for "SCOOTERSOFTWARE.COM" in text...');
  if (result.rawText?.includes('SCOOTERSOFTWARE')) {
    console.log('✅ Found! But pattern matching didn\'t extract it as vendor.');
    console.log('   Reason: No "Vendor:" or "Company:" label before it.');
    console.log('   Solution: Need AWS Textract (tables) or LLM fallback for label-free extraction.');
  }
}

main().catch(console.error);
