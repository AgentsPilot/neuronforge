/**
 * Comprehensive test of all invoice PDFs in test-files directory
 * Tests extraction and provides success/failure ranking
 */

import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';
import { DeterministicExtractor } from '@/lib/extraction/DeterministicExtractor';

// Load environment variables
const envPath = path.join(process.cwd(), '.env.local');
config({ path: envPath });

// Fields to extract (standard invoice fields)
const fieldsToExtract = [
  { name: 'invoice_number', type: 'string', description: 'Invoice or receipt number', required: true },
  { name: 'vendor', type: 'string', description: 'Company name, business name, seller', required: true },
  { name: 'date', type: 'date', description: 'Invoice or receipt date', required: true },
  { name: 'amount', type: 'currency', description: 'Total amount, invoice total, amount due', required: true },
  { name: 'currency', type: 'string', description: 'Currency code (USD, EUR, etc)', required: false },
];

interface TestResult {
  filename: string;
  success: boolean;
  confidence: number;
  method: string;
  duration: number;
  fieldsExtracted: number;
  totalFields: number;
  extractedData: Record<string, any>;
  missingFields: string[];
  llmTokens?: { input: number; output: number; total: number };
  error?: string;
}

async function testInvoice(filename: string): Promise<TestResult> {
  const filePath = path.join(process.cwd(), 'test-files', filename);
  const extractor = new DeterministicExtractor(true);

  try {
    const fileBuffer = fs.readFileSync(filePath);
    const base64Content = fileBuffer.toString('base64');

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

    const fieldsExtracted = Object.values(result.data).filter(v => v !== null && v !== undefined).length;
    const allRequiredFieldsPresent = fieldsToExtract
      .filter(f => f.required)
      .every(f => result.data[f.name] !== null && result.data[f.name] !== undefined);

    return {
      filename,
      success: allRequiredFieldsPresent,
      confidence: result.confidence,
      method: result.metadata.extractionMethod,
      duration,
      fieldsExtracted,
      totalFields: fieldsToExtract.length,
      extractedData: result.data,
      missingFields: result.metadata.missingFields || [],
      llmTokens: result.metadata.llmTokens ? {
        input: result.metadata.llmTokens.input,
        output: result.metadata.llmTokens.output,
        total: result.metadata.llmTokens.input + result.metadata.llmTokens.output
      } : undefined,
    };
  } catch (error: any) {
    return {
      filename,
      success: false,
      confidence: 0,
      method: 'error',
      duration: 0,
      fieldsExtracted: 0,
      totalFields: fieldsToExtract.length,
      extractedData: {},
      missingFields: fieldsToExtract.map(f => f.name),
      error: error.message,
    };
  }
}

async function main() {
  console.log('\n📊 COMPREHENSIVE INVOICE EXTRACTION TEST');
  console.log('━'.repeat(100));
  console.log('Testing all PDF files in test-files directory\n');

  // Find all PDF files
  const testFilesDir = path.join(process.cwd(), 'test-files');
  const allFiles = fs.readdirSync(testFilesDir);
  const pdfFiles = allFiles.filter(f => f.toLowerCase().endsWith('.pdf'));

  console.log(`Found ${pdfFiles.length} PDF files to test\n`);

  const results: TestResult[] = [];

  // Test each file
  for (let i = 0; i < pdfFiles.length; i++) {
    const filename = pdfFiles[i];
    console.log(`[${i + 1}/${pdfFiles.length}] Testing: ${filename}...`);

    const result = await testInvoice(filename);
    results.push(result);

    const status = result.success ? '✅ SUCCESS' : '❌ FAILURE';
    console.log(`    ${status} - ${result.fieldsExtracted}/${result.totalFields} fields - ${(result.confidence * 100).toFixed(1)}% confidence - ${result.duration}ms\n`);
  }

  // Sort results: successes first (by confidence desc), then failures (by fields extracted desc)
  const sortedResults = results.sort((a, b) => {
    if (a.success !== b.success) return a.success ? -1 : 1;
    if (a.success) return b.confidence - a.confidence;
    return b.fieldsExtracted - a.fieldsExtracted;
  });

  // Print detailed results
  console.log('\n' + '━'.repeat(100));
  console.log('📋 DETAILED RESULTS (Ranked by Success/Confidence)');
  console.log('━'.repeat(100));

  sortedResults.forEach((result, index) => {
    const rank = index + 1;
    const statusIcon = result.success ? '✅' : '❌';
    const gradeIcon = result.confidence >= 0.9 ? '🏆' : result.confidence >= 0.7 ? '👍' : '⚠️';

    console.log(`\n${rank}. ${statusIcon} ${gradeIcon} ${result.filename}`);
    console.log('   ' + '─'.repeat(95));
    console.log(`   Status: ${result.success ? 'SUCCESS' : 'FAILURE'} | Confidence: ${(result.confidence * 100).toFixed(1)}% | Method: ${result.method} | Duration: ${result.duration}ms`);
    console.log(`   Fields: ${result.fieldsExtracted}/${result.totalFields} extracted`);

    if (result.llmTokens) {
      console.log(`   LLM Tokens: ${result.llmTokens.total} (${result.llmTokens.input} in + ${result.llmTokens.output} out)`);
    }

    console.log(`\n   Extracted Data:`);
    fieldsToExtract.forEach(field => {
      const value = result.extractedData[field.name];
      const icon = value ? '✅' : '❌';
      const req = field.required ? '[REQ]' : '[OPT]';
      const displayValue = value || '(not found)';
      console.log(`      ${icon} ${field.name}: ${displayValue} ${req}`);
    });

    if (result.missingFields.length > 0) {
      console.log(`\n   ⚠️  Missing: ${result.missingFields.join(', ')}`);
    }

    if (result.error) {
      console.log(`\n   ❌ Error: ${result.error}`);
    }
  });

  // Print summary statistics
  console.log('\n' + '━'.repeat(100));
  console.log('📊 SUMMARY STATISTICS');
  console.log('━'.repeat(100));

  const successCount = results.filter(r => r.success).length;
  const failureCount = results.length - successCount;
  const avgConfidence = results.reduce((sum, r) => sum + r.confidence, 0) / results.length;
  const totalFieldsExpected = results.length * fieldsToExtract.length;
  const totalFieldsExtracted = results.reduce((sum, r) => sum + r.fieldsExtracted, 0);
  const avgDuration = results.reduce((sum, r) => sum + r.duration, 0) / results.length;
  const totalLlmTokens = results.reduce((sum, r) => sum + (r.llmTokens?.total || 0), 0);

  console.log(`\nTotal Files Tested: ${results.length}`);
  console.log(`✅ Successes: ${successCount} (${((successCount / results.length) * 100).toFixed(1)}%)`);
  console.log(`❌ Failures: ${failureCount} (${((failureCount / results.length) * 100).toFixed(1)}%)`);
  console.log(`\nField Extraction Rate: ${totalFieldsExtracted}/${totalFieldsExpected} (${((totalFieldsExtracted / totalFieldsExpected) * 100).toFixed(1)}%)`);
  console.log(`Average Confidence: ${(avgConfidence * 100).toFixed(1)}%`);
  console.log(`Average Duration: ${avgDuration.toFixed(0)}ms`);
  console.log(`Total LLM Tokens Used: ${totalLlmTokens}`);

  // Method breakdown
  const methodCounts: Record<string, number> = {};
  results.forEach(r => {
    methodCounts[r.method] = (methodCounts[r.method] || 0) + 1;
  });

  console.log(`\nExtraction Methods Used:`);
  Object.entries(methodCounts).forEach(([method, count]) => {
    console.log(`  - ${method}: ${count} files`);
  });

  console.log('\n' + '━'.repeat(100));
  console.log('✨ Test Complete!\n');
}

main().catch(console.error);
