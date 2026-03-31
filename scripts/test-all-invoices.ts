/**
 * Test PDF extraction across multiple invoice formats
 * Tests the system with different invoice layouts and structures
 */

import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';
import { DeterministicExtractor } from '@/lib/extraction/DeterministicExtractor';
import type { OutputSchema } from '@/lib/extraction/types';

// Load environment variables
config({ path: path.join(process.cwd(), '.env.local') });

const TEST_FILES_DIR = path.join(process.cwd(), 'test-files');

// Standard fields to extract from all invoices/receipts
const STANDARD_SCHEMA: OutputSchema = {
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
      description: 'Vendor name, company name, merchant name, or seller',
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
      description: 'Total amount, amount due, grand total, or balance',
      required: true,
    },
    {
      name: 'customer_info',
      type: 'string',
      description: 'Customer name, bill to, or recipient name',
      required: false,
    },
  ],
};

interface TestResult {
  filename: string;
  success: boolean;
  confidence: number;
  extractionMethod: string;
  processingTime: number;
  fieldsExtracted: number;
  fieldsRequested: number;
  missingFields: string[];
  data: Record<string, any>;
  error?: string;
}

async function testSingleInvoice(filename: string): Promise<TestResult> {
  const filePath = path.join(TEST_FILES_DIR, filename);

  try {
    // Read PDF
    const fileBuffer = fs.readFileSync(filePath);
    const base64Content = fileBuffer.toString('base64');
    const fileSize = (fileBuffer.length / 1024).toFixed(2);

    console.log(`\n${'━'.repeat(80)}`);
    console.log(`Testing: ${filename}`);
    console.log(`Size: ${fileSize} KB`);
    console.log('━'.repeat(80));

    // Extract
    const extractor = new DeterministicExtractor(true);
    const startTime = Date.now();

    const result = await extractor.extract({
      content: base64Content,
      mimeType: 'application/pdf',
      filename: filename,
      config: {
        outputSchema: STANDARD_SCHEMA,
        ocrFallback: true,
      },
    });

    const processingTime = Date.now() - startTime;

    // Display results
    console.log(`⏱️  Processing time: ${processingTime}ms`);
    console.log(`📊 Confidence: ${(result.confidence * 100).toFixed(1)}%`);
    console.log(`📋 Fields: ${result.metadata.fieldsExtracted}/${result.metadata.fieldsRequested}`);
    console.log(`🔧 Method: ${result.metadata.extractionMethod}`);

    if (result.metadata.missingFields.length > 0) {
      console.log(`⚠️  Missing: ${result.metadata.missingFields.join(', ')}`);
    }

    console.log('\nExtracted Data:');
    console.log('─'.repeat(80));
    for (const [key, value] of Object.entries(result.data)) {
      const displayValue = value ? String(value).substring(0, 100) : '(null)';
      const status = value && !String(value).startsWith('Unknown ') ? '✅' : '❌';
      console.log(`${status} ${key}: ${displayValue}`);
    }

    return {
      filename,
      success: result.success,
      confidence: result.confidence,
      extractionMethod: result.metadata.extractionMethod,
      processingTime,
      fieldsExtracted: result.metadata.fieldsExtracted,
      fieldsRequested: result.metadata.fieldsRequested,
      missingFields: result.metadata.missingFields,
      data: result.data,
    };

  } catch (error: any) {
    console.log(`\n${'━'.repeat(80)}`);
    console.log(`Testing: ${filename}`);
    console.log(`❌ ERROR: ${error.message}`);

    return {
      filename,
      success: false,
      confidence: 0,
      extractionMethod: 'error',
      processingTime: 0,
      fieldsExtracted: 0,
      fieldsRequested: STANDARD_SCHEMA.fields.length,
      missingFields: STANDARD_SCHEMA.fields.map(f => f.name),
      data: {},
      error: error.message,
    };
  }
}

async function runAllTests() {
  console.log('='.repeat(80));
  console.log('MULTI-INVOICE EXTRACTION TEST');
  console.log('='.repeat(80));
  console.log();

  // Get all PDF files
  const pdfFiles = fs.readdirSync(TEST_FILES_DIR)
    .filter(f => f.endsWith('.pdf'))
    .sort();

  if (pdfFiles.length === 0) {
    console.error('❌ No PDF files found in test-files directory');
    process.exit(1);
  }

  console.log(`Found ${pdfFiles.length} PDF files to test:\n`);
  pdfFiles.forEach((file, idx) => {
    console.log(`  ${idx + 1}. ${file}`);
  });

  // Test each invoice
  const results: TestResult[] = [];

  for (const filename of pdfFiles) {
    const result = await testSingleInvoice(filename);
    results.push(result);
  }

  // Summary
  console.log('\n\n' + '='.repeat(80));
  console.log('SUMMARY');
  console.log('='.repeat(80));
  console.log();

  const successCount = results.filter(r => r.success).length;
  const avgConfidence = results.reduce((sum, r) => sum + r.confidence, 0) / results.length;
  const avgProcessingTime = results.reduce((sum, r) => sum + r.processingTime, 0) / results.length;
  const totalFields = results.reduce((sum, r) => sum + r.fieldsExtracted, 0);
  const totalRequested = results.reduce((sum, r) => sum + r.fieldsRequested, 0);

  console.log(`📊 Overall Statistics:`);
  console.log(`   Success rate: ${successCount}/${results.length} (${(successCount/results.length*100).toFixed(1)}%)`);
  console.log(`   Average confidence: ${(avgConfidence * 100).toFixed(1)}%`);
  console.log(`   Average processing time: ${avgProcessingTime.toFixed(0)}ms`);
  console.log(`   Total fields extracted: ${totalFields}/${totalRequested} (${(totalFields/totalRequested*100).toFixed(1)}%)`);
  console.log();

  console.log('📋 Per-File Results:');
  console.log('─'.repeat(80));
  results.forEach((result, idx) => {
    const status = result.success ? '✅' : '❌';
    const fieldsStatus = `${result.fieldsExtracted}/${result.fieldsRequested}`;
    const confStatus = `${(result.confidence * 100).toFixed(0)}%`;
    const timeStatus = `${result.processingTime}ms`;

    console.log(`${status} ${result.filename}`);
    console.log(`   Fields: ${fieldsStatus} | Confidence: ${confStatus} | Time: ${timeStatus} | Method: ${result.extractionMethod}`);

    if (result.missingFields.length > 0) {
      console.log(`   Missing: ${result.missingFields.join(', ')}`);
    }

    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }

    console.log();
  });

  console.log('='.repeat(80));
  console.log('KEY FINDINGS:');
  console.log('='.repeat(80));
  console.log();

  // Group by extraction method
  const methodGroups = results.reduce((acc, r) => {
    acc[r.extractionMethod] = (acc[r.extractionMethod] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  console.log('Extraction methods used:');
  Object.entries(methodGroups).forEach(([method, count]) => {
    console.log(`  - ${method}: ${count} file(s)`);
  });
  console.log();

  // Identify common missing fields
  const allMissingFields = results.flatMap(r => r.missingFields);
  const missingFieldCounts = allMissingFields.reduce((acc, field) => {
    acc[field] = (acc[field] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  if (Object.keys(missingFieldCounts).length > 0) {
    console.log('Most commonly missing fields:');
    Object.entries(missingFieldCounts)
      .sort((a, b) => b[1] - a[1])
      .forEach(([field, count]) => {
        console.log(`  - ${field}: missing in ${count}/${results.length} files`);
      });
    console.log();
  }

  // Performance analysis
  const fastExtractions = results.filter(r => r.processingTime < 1000);
  const slowExtractions = results.filter(r => r.processingTime >= 3000);

  if (fastExtractions.length > 0) {
    console.log(`⚡ Fast extractions (<1s): ${fastExtractions.length} files`);
    console.log(`   These used pdfjs-dist without Textract fallback`);
    console.log();
  }

  if (slowExtractions.length > 0) {
    console.log(`🐌 Slow extractions (>3s): ${slowExtractions.length} files`);
    console.log(`   These required Textract OCR processing`);
    console.log();
  }

  console.log('='.repeat(80));
  console.log('TEST COMPLETE');
  console.log('='.repeat(80));
}

runAllTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
