/**
 * Comprehensive test of Textract extraction system
 * Tests all extraction layers with sample documents
 */
import { config } from 'dotenv';
import { resolve } from 'path';

// Load environment variables
config({ path: resolve(process.cwd(), '.env.local') });

import { TextractClient } from '../lib/extraction/TextractClient.js';
import { DeterministicExtractor } from '../lib/extraction/DeterministicExtractor.js';
import type { OutputSchema } from '../lib/extraction/types.js';

// Sample test image (1x1 PNG for basic testing)
const SAMPLE_IMAGE = `iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==`;

async function testTextractClient() {
  console.log('='.repeat(80));
  console.log('TEST 1: TextractClient - Basic OCR');
  console.log('='.repeat(80));

  const client = new TextractClient();

  // Check if available
  const available = await client.isAvailable();
  console.log(`\nTextract available: ${available ? '✅' : '❌'}`);

  if (!available) {
    console.log('⚠️  Textract not configured - skipping tests');
    return false;
  }

  // Test text extraction
  console.log('\nTesting extractText()...');
  const result = await client.extractText(SAMPLE_IMAGE);
  console.log(`  Success: ${result.success ? '✅' : '❌'}`);
  console.log(`  Text length: ${result.text.length} chars`);
  console.log(`  Blocks: ${result.blocks.length}`);
  if (result.error) {
    console.log(`  Error: ${result.error}`);
  }

  // Test document analysis (forms + tables)
  console.log('\nTesting analyzeDocument()...');
  const analysisResult = await client.analyzeDocument(SAMPLE_IMAGE);
  console.log(`  Success: ${analysisResult.success ? '✅' : '❌'}`);
  console.log(`  Key-value pairs: ${analysisResult.keyValuePairs.length}`);
  console.log(`  Tables: ${analysisResult.tables.length}`);

  if (analysisResult.keyValuePairs.length > 0) {
    console.log('\n  Sample key-value pairs:');
    analysisResult.keyValuePairs.slice(0, 3).forEach(kv => {
      console.log(`    ${kv.key}: ${kv.value} (${(kv.confidence).toFixed(0)}% confidence)`);
    });
  }

  return true;
}

async function testDeterministicExtractor() {
  console.log('\n' + '='.repeat(80));
  console.log('TEST 2: DeterministicExtractor - Schema-driven extraction');
  console.log('='.repeat(80));

  const extractor = new DeterministicExtractor(true); // OCR enabled

  // Define expected fields
  const outputSchema: OutputSchema = {
    fields: [
      { name: 'invoiceNumber', type: 'string', required: true },
      { name: 'total', type: 'number', required: true },
      { name: 'date', type: 'date', required: true },
      { name: 'vendor', type: 'string', required: false },
    ],
  };

  console.log('\nExtracting with schema:');
  outputSchema.fields.forEach(f => {
    console.log(`  - ${f.name} (${f.type}${f.required ? ', required' : ''})`);
  });

  // Test extraction
  const result = await extractor.extract({
    content: SAMPLE_IMAGE,
    mimeType: 'image/png',
    filename: 'test-invoice.png',
    config: {
      outputSchema,
      ocrFallback: true,
    },
  });

  console.log('\nExtraction Results:');
  console.log(`  Success: ${result.success ? '✅' : '❌'}`);
  console.log(`  Confidence: ${(result.confidence * 100).toFixed(1)}%`);
  console.log(`  Extraction method: ${result.metadata.extractionMethod}`);
  console.log(`  Fields extracted: ${result.metadata.fieldsExtracted}/${result.metadata.fieldsRequested}`);
  console.log(`  Processing time: ${result.metadata.processingTimeMs}ms`);

  if (result.metadata.missingFields.length > 0) {
    console.log(`  Missing fields: ${result.metadata.missingFields.join(', ')}`);
  }

  if (result.metadata.uncertainFields.length > 0) {
    console.log(`  Uncertain fields: ${result.metadata.uncertainFields.join(', ')}`);
  }

  console.log('\nExtracted Data:');
  Object.entries(result.data).forEach(([key, value]) => {
    console.log(`  ${key}: ${value !== null ? value : '(not found)'}`);
  });

  if (result.rawText && result.rawText.length > 0) {
    console.log(`\nRaw text: "${result.rawText}"`);
  }
}

async function showIntegrationInfo() {
  console.log('\n' + '='.repeat(80));
  console.log('TEST 3: Integration Information');
  console.log('='.repeat(80));

  console.log('\n📖 How to use in your workflows:');
  console.log('\nIn your agent workflow, use the "file_extract" step:');
  console.log(`
  {
    "step_id": "extract_invoice",
    "type": "file_extract",
    "input": {
      "file_url": "{{previous_step.file_url}}",
      "output_schema": {
        "fields": [
          { "name": "invoiceNumber", "type": "string", "required": true },
          { "name": "total", "type": "number", "required": true },
          { "name": "date", "type": "date", "required": true }
        ]
      }
    }
  }
  `);

  console.log('\n💰 Cost Information:');
  console.log('  - Text-based PDFs: FREE (uses pdf-parse)');
  console.log('  - Scanned PDFs: ~$0.0015 per page (Textract)');
  console.log('  - Images: ~$0.0015 per page (Textract)');
  console.log('  - Word/Excel/CSV: FREE');
  console.log('\n  Your system automatically uses FREE methods first!');

  console.log('\n🎯 Supported File Types:');
  console.log('  - PDF (text-based and scanned)');
  console.log('  - Images (PNG, JPEG, TIFF, BMP, GIF, WebP)');
  console.log('  - Word documents (DOCX, DOC)');
  console.log('  - Excel spreadsheets (XLSX, XLS)');
  console.log('  - PowerPoint (PPTX, PPT)');
  console.log('  - HTML, CSV, JSON, XML, TXT');

  console.log('\n🔍 Extraction Features:');
  console.log('  ✅ OCR text extraction');
  console.log('  ✅ Form field detection (key-value pairs)');
  console.log('  ✅ Table extraction');
  console.log('  ✅ Schema-driven field matching');
  console.log('  ✅ Intelligent field name variations');
  console.log('  ✅ Automatic cost optimization');
}

async function runAllTests() {
  console.log('\n🧪 AWS TEXTRACT EXTRACTION SYSTEM - COMPREHENSIVE TEST\n');

  try {
    // Test 1: Basic Textract client
    const textractAvailable = await testTextractClient();

    if (textractAvailable) {
      // Test 2: Schema-driven extraction
      await testDeterministicExtractor();
    }

    // Test 3: Integration info
    await showIntegrationInfo();

    console.log('\n' + '='.repeat(80));
    console.log('✅ ALL TESTS COMPLETED');
    console.log('='.repeat(80));
    console.log('\n📝 Next steps:');
    console.log('  1. Test with real documents in your workflow');
    console.log('  2. Try different output schemas for your use case');
    console.log('  3. Monitor AWS costs in CloudWatch console');
    console.log('  4. Check extraction logs for quality metrics');

  } catch (error: any) {
    console.error('\n❌ TEST FAILED:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

// Run tests
runAllTests();
