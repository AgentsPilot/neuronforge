/**
 * Test script for ambiguous number extraction fix
 *
 * Tests Invoice677931.pdf which contains:
 * - Address: "625 Main Street"
 * - Amount: "$31.50"
 *
 * Should extract 31.50, NOT 625
 */

import * as fs from 'fs';
import * as path from 'path';
import { DeterministicExtractor } from '@/lib/extraction/DeterministicExtractor';
import type { OutputSchema } from '@/lib/extraction/types';

const FIXTURES_DIR = path.join(process.cwd(), 'tests', 'plugins', 'fixtures');

async function testAmbiguousExtraction() {
  console.log('🧪 Testing Ambiguous Number Extraction Fix');
  console.log('='.repeat(80));
  console.log('Invoice: Invoice677931.pdf (Scooter Software)');
  console.log('Expected: amount = $31.50');
  console.log('Wrong:    amount = 625 (from street address)');
  console.log('='.repeat(80));
  console.log('');

  // Read invoice
  const invoicePath = path.join(FIXTURES_DIR, 'Invoice677931.pdf');
  if (!fs.existsSync(invoicePath)) {
    throw new Error(`Invoice not found: ${invoicePath}`);
  }

  const base64Content = fs.readFileSync(invoicePath).toString('base64');

  // Define schema
  const schema: OutputSchema = {
    fields: [
      { name: 'invoice_number', type: 'string', description: 'Invoice or receipt number', required: true },
      { name: 'vendor', type: 'string', description: 'Vendor or company name', required: true },
      { name: 'date', type: 'string', description: 'Invoice date', required: true },
      { name: 'amount', type: 'number', description: 'Total amount or amount due', required: true },
      { name: 'currency', type: 'string', description: 'Currency code like USD', required: false },
    ]
  };

  // Extract
  console.log('📄 Running extraction...\n');
  const extractor = new DeterministicExtractor(true);

  const result = await extractor.extract({
    content: base64Content,
    mimeType: 'application/pdf',
    filename: 'Invoice677931.pdf',
    config: {
      outputSchema: schema,
      ocrFallback: true,
    }
  });

  // Display results
  console.log('📊 Extraction Results:');
  console.log('─'.repeat(80));
  console.log(`Success:    ${result.success ? '✅ Yes' : '❌ No'}`);
  console.log(`Confidence: ${(result.confidence * 100).toFixed(1)}%`);
  console.log(`Method:     ${result.metadata.extractionMethod}`);
  console.log(`Fields:     ${result.metadata.fieldsExtracted}/${result.metadata.fieldsRequested} extracted`);
  console.log('');

  console.log('Extracted Fields:');
  console.log('─'.repeat(80));

  const fields = ['invoice_number', 'vendor', 'date', 'amount', 'currency'];
  for (const field of fields) {
    const value = result.data[field];
    const status = value !== null && value !== undefined ? '✅' : '❌';
    console.log(`  ${status} ${field.padEnd(15)}: ${value ?? '(not extracted)'}`);
  }
  console.log('');

  // Show uncertain fields
  if (result.metadata.uncertainFields && result.metadata.uncertainFields.length > 0) {
    console.log('⚠️  Uncertain Fields (triggered ambiguity detection):');
    console.log('─'.repeat(80));
    for (const field of result.metadata.uncertainFields) {
      console.log(`  - ${field}`);
    }
    console.log('');
  }

  if (result.metadata.missingFields && result.metadata.missingFields.length > 0) {
    console.log('❌ Missing Fields:');
    console.log('─'.repeat(80));
    for (const field of result.metadata.missingFields) {
      console.log(`  - ${field}`);
    }
    console.log('');
  }

  // Verify fix
  console.log('🔍 Fix Verification:');
  console.log('─'.repeat(80));

  const extractedAmount = result.data.amount;
  const isCorrectAmount =
    extractedAmount === 31.5 ||
    extractedAmount === '31.5' ||
    extractedAmount === '31.50' ||
    String(extractedAmount).includes('31.5');

  console.log(`Amount extracted: ${extractedAmount}`);

  if (isCorrectAmount) {
    console.log('✅ CORRECT: Amount is 31.5 (or 31.50)');
  } else if (extractedAmount === 625 || extractedAmount === '625') {
    console.log('❌ WRONG: Extracted 625 from street address!');
    console.log('   This means ambiguity detection did NOT work');
  } else {
    console.log(`⚠️  UNEXPECTED: Got ${extractedAmount}, expected 31.5`);
  }

  console.log('');

  // Check if ambiguity was detected
  const triggeredAmbiguity =
    result.confidence < 0.5 ||
    (result.metadata.uncertainFields && result.metadata.uncertainFields.includes('amount'));

  if (triggeredAmbiguity) {
    console.log('✅ Ambiguity detection TRIGGERED');
    console.log(`   Confidence: ${result.confidence.toFixed(3)} (< 0.5 threshold)`);
  } else {
    console.log('❌ Ambiguity detection did NOT trigger');
    console.log(`   Confidence: ${result.confidence.toFixed(3)} (>= 0.5)`);
    console.log('   Fix may not be working correctly');
  }

  console.log('');

  // Check LLM usage
  const usedLLM = result.metadata.extractionMethod.includes('llm');
  if (usedLLM) {
    console.log('✅ LLM validation was used');
  } else {
    console.log('⚠️  LLM validation was NOT used');
    console.log(`   Method: ${result.metadata.extractionMethod}`);
  }

  console.log('');
  console.log('='.repeat(80));

  const testPassed = isCorrectAmount && triggeredAmbiguity;
  if (testPassed) {
    console.log('✅✅✅ TEST PASSED - Fix is working! ✅✅✅');
  } else {
    console.log('⚠️⚠️⚠️  TEST NEEDS REVIEW ⚠️⚠️⚠️');
    if (!isCorrectAmount) {
      console.log('   - Wrong amount extracted');
    }
    if (!triggeredAmbiguity) {
      console.log('   - Ambiguity detection did not trigger');
    }
  }

  console.log('='.repeat(80));
  console.log('');

  return testPassed;
}

// Run test
testAmbiguousExtraction()
  .then((passed) => {
    process.exit(passed ? 0 : 1);
  })
  .catch((error) => {
    console.error('\n❌ Test failed with error:');
    console.error(error);
    process.exit(1);
  });
