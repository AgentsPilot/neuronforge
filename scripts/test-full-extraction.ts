/**
 * Test full 3-tier extraction (PDF → Textract → LLM)
 * Loads environment variables from .env.local
 */

import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';
import { DeterministicExtractor } from '@/lib/extraction/DeterministicExtractor';

// Load environment variables
const envPath = path.join(process.cwd(), '.env.local');
config({ path: envPath });

console.log('\n🔧 Environment Check:');
console.log(`  AWS_ACCESS_KEY_ID: ${process.env.AWS_ACCESS_KEY_ID ? '✅ Set' : '❌ Not set'}`);
console.log(`  AWS_SECRET_ACCESS_KEY: ${process.env.AWS_SECRET_ACCESS_KEY ? '✅ Set' : '❌ Not set'}`);
console.log(`  AWS_REGION: ${process.env.AWS_REGION || '❌ Not set'}`);
console.log(`  ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? '✅ Set' : '❌ Not set'}`);

async function main() {
  console.log('\n📄 Full Extraction Test (3-Tier: PDF → Textract → LLM)\n');

  // Invoice files to test
  const invoiceFiles = [
    'Invoice677931.pdf',
    'Receipt-2667-7775-2451.pdf',
    'Receipt-HMGRLQ-00003.pdf'
  ];

  // Fields to extract
  const fieldsToExtract = [
    { name: 'invoice_number', type: 'string', description: 'Invoice or receipt number', required: true },
    { name: 'vendor', type: 'string', description: 'Company name, business name, seller', required: true },
    { name: 'date', type: 'date', description: 'Invoice or receipt date', required: true },
    { name: 'amount', type: 'currency', description: 'Total amount, invoice total, amount due', required: true },
    { name: 'currency', type: 'string', description: 'Currency code (USD, EUR, etc)', required: false },
  ];

  const extractor = new DeterministicExtractor(true); // Enable OCR

  const results: Array<{
    filename: string;
    success: boolean;
    confidence: number;
    method: string;
    fields: Record<string, any>;
    missingFields: string[];
  }> = [];

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
          ocrFallback: true // Enable Textract + LLM
        }
      });
      const duration = Date.now() - startTime;

      console.log(`\n⏱️  Extraction completed in ${duration}ms`);
      console.log(`📊 Confidence: ${(result.confidence * 100).toFixed(1)}%`);
      console.log(`🔧 Method: ${result.metadata.extractionMethod}`);

      console.log('\n📝 Extracted Fields:');
      for (const field of fieldsToExtract) {
        const value = result.data[field.name];
        const required = field.required ? '[REQUIRED]' : '[OPTIONAL]';
        const status = value ? '✅' : '❌';
        console.log(`   ${status} ${field.name}: ${value || '(not found)'} ${required}`);
      }

      if (result.metadata.missingFields && result.metadata.missingFields.length > 0) {
        console.log(`\n⚠️  Missing required fields: ${result.metadata.missingFields.join(', ')}`);
      }

      // Store results
      results.push({
        filename,
        success: result.success,
        confidence: result.confidence,
        method: result.metadata.extractionMethod,
        fields: result.data,
        missingFields: result.metadata.missingFields,
      });

      console.log('');
    } catch (error: any) {
      console.error(`❌ Error processing ${filename}:`, error.message);
    }
  }

  // Summary
  console.log('━'.repeat(80));
  console.log('📊 EXTRACTION SUMMARY');
  console.log('━'.repeat(80));

  for (const result of results) {
    console.log(`\n${result.filename}:`);
    console.log(`  Method: ${result.method}`);
    console.log(`  Confidence: ${(result.confidence * 100).toFixed(1)}%`);

    const extracted = Object.values(result.fields).filter(v => v !== null).length;
    const total = fieldsToExtract.length;
    console.log(`  Fields: ${extracted}/${total} extracted`);

    if (result.missingFields.length > 0) {
      console.log(`  Missing: ${result.missingFields.join(', ')}`);
    }
  }

  // Calculate overall stats
  const avgConfidence = results.reduce((sum, r) => sum + r.confidence, 0) / results.length;
  const totalFields = results.length * fieldsToExtract.length;
  const extractedFields = results.reduce((sum, r) => {
    return sum + Object.values(r.fields).filter(v => v !== null).length;
  }, 0);

  console.log('\n' + '━'.repeat(80));
  console.log('OVERALL STATISTICS:');
  console.log(`  Average Confidence: ${(avgConfidence * 100).toFixed(1)}%`);
  console.log(`  Fields Extracted: ${extractedFields}/${totalFields} (${((extractedFields / totalFields) * 100).toFixed(1)}%)`);
  console.log('━'.repeat(80));
}

main().catch(console.error);
