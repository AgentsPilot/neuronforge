/**
 * Test LLM-based extraction to verify it can extract correct amounts
 */

import fs from 'fs';
import path from 'path';
import { LLMFieldMapper } from '@/lib/extraction/LLMFieldMapper';
import { PdfTypeDetector } from '@/lib/extraction/PdfTypeDetector';

async function main() {
  console.log('🤖 LLM Extraction Test\n');

  const filename = 'Invoice677931.pdf';

  const fieldsToExtract = [
    { name: 'invoice_number', type: 'string', description: 'Invoice or receipt number', required: true },
    { name: 'vendor', type: 'string', description: 'Vendor or company name', required: true },
    { name: 'date', type: 'date', description: 'Invoice date', required: true },
    { name: 'amount', type: 'currency', description: 'Total amount due, invoice total, grand total', required: true },
    { name: 'currency', type: 'string', description: 'Currency code (USD, EUR, etc)', required: false },
  ];

  console.log('━'.repeat(80));
  console.log(`📋 Testing: ${filename}`);
  console.log('━'.repeat(80));

  // Read file
  const filePath = path.join(process.cwd(), 'test-files', filename);
  const fileBuffer = fs.readFileSync(filePath);
  const base64Content = fileBuffer.toString('base64');

  console.log(`✅ Loaded file (${(fileBuffer.length / 1024).toFixed(2)} KB)\n`);

  // Extract PDF text
  const pdfDetector = new PdfTypeDetector({}, true);
  const pdfResult = await pdfDetector.detect(base64Content);

  console.log(`📄 Extracted text (${pdfResult.textContent.length} chars):\n`);
  console.log(pdfResult.textContent.substring(0, 800));
  console.log('\n...\n');

  // Use LLM to extract
  console.log('🤖 Using LLM to extract fields...\n');
  const llmMapper = new LLMFieldMapper();

  const startTime = Date.now();
  const result = await llmMapper.mapFields({
    text: pdfResult.textContent,
    outputSchema: { fields: fieldsToExtract },
  });
  const duration = Date.now() - startTime;

  console.log(`⏱️  LLM extraction completed in ${duration}ms`);
  console.log(`📊 Confidence: ${(result.confidence * 100).toFixed(1)}%\n`);

  console.log('📝 Extracted Fields:');
  for (const [key, value] of Object.entries(result.mappedFields)) {
    const fieldDef = fieldsToExtract.find(f => f.name === key);
    const required = fieldDef?.required ? '[REQUIRED]' : '[OPTIONAL]';
    console.log(`   ✅ ${key}: ${value} ${required}`);
  }

  if (result.unmappedFields.length > 0) {
    console.log(`\n⚠️  Unmapped fields: ${result.unmappedFields.join(', ')}`);
  }

  console.log('\n' + '━'.repeat(80));
  console.log('Expected values:');
  console.log('  invoice_number: #677931');
  console.log('  vendor: SCOOTERSOFTWARE.COM');
  console.log('  date: 17-Mar-2026');
  console.log('  amount: $31.50');
  console.log('  currency: US or USD');
  console.log('━'.repeat(80));
}

main().catch(console.error);
