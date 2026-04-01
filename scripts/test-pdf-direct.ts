/**
 * Direct PDF extraction test - bypasses plugin infrastructure
 * Tests the DeterministicExtractor directly
 */

import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';
import { DeterministicExtractor } from '@/lib/extraction/DeterministicExtractor';
import type { OutputSchema } from '@/lib/extraction/types';

// Load environment variables from .env.local
config({ path: path.join(process.cwd(), '.env.local') });

const TEST_PDF_PATH = path.join(process.cwd(), 'tests', 'plugins', 'fixtures', 'Invoice-ZYVUTAKJ-0003 (1) (1).pdf');

// Fields to extract: Invoice number, Address, Vendor, Date, Amount
const OUTPUT_SCHEMA: OutputSchema = {
  fields: [
    {
      name: 'invoice_number',
      type: 'string',
      description: 'Invoice number or document number',
      required: true,
      aliases: ['invoice #', 'invoice no', 'inv #', 'inv no', 'invoice', 'number'],
    },
    {
      name: 'vendor',
      type: 'string',
      description: 'Vendor name or company name',
      required: true,
      aliases: ['vendor name', 'company', 'from', 'supplier', 'seller'],
    },
    {
      name: 'address',
      type: 'string',
      description: 'Address (vendor address, billing address, or shipping address)',
      required: true,
      aliases: ['billing address', 'vendor address', 'address', 'location', 'ship to', 'bill to'],
    },
    {
      name: 'date',
      type: 'date',
      description: 'Invoice date or document date',
      required: true,
      aliases: ['invoice date', 'date', 'issued', 'created'],
    },
    {
      name: 'amount',
      type: 'currency',
      description: 'Total amount, invoice total, or amount due',
      required: true,
      aliases: ['total', 'amount', 'amount due', 'total amount', 'grand total', 'balance due'],
    },
  ],
};

async function testPdfExtraction() {
  console.log('='.repeat(80));
  console.log('PDF EXTRACTION TEST - DIRECT');
  console.log('='.repeat(80));
  console.log();

  // Check if file exists
  if (!fs.existsSync(TEST_PDF_PATH)) {
    console.error(`❌ File not found: ${TEST_PDF_PATH}`);
    process.exit(1);
  }

  console.log(`✅ Found PDF: ${path.basename(TEST_PDF_PATH)}`);
  const stats = fs.statSync(TEST_PDF_PATH);
  console.log(`📊 Size: ${(stats.size / 1024).toFixed(2)} KB`);
  console.log();

  try {
    // Read and encode PDF
    console.log('📖 Reading PDF file...');
    const fileBuffer = fs.readFileSync(TEST_PDF_PATH);
    const base64Content = fileBuffer.toString('base64');
    console.log(`✅ Encoded to base64 (${base64Content.length} characters)`);
    console.log();

    // Initialize extractor
    console.log('🔧 Initializing DeterministicExtractor...');
    const extractor = new DeterministicExtractor(true); // OCR enabled
    console.log('✅ Extractor initialized');
    console.log();

    // Show what we're extracting
    console.log('🎯 Fields to extract:');
    OUTPUT_SCHEMA.fields.forEach((field, idx) => {
      console.log(`   ${idx + 1}. ${field.name} (${field.type})${field.required ? ' [REQUIRED]' : ''}`);
      console.log(`      → ${field.description}`);
      if (field.aliases && field.aliases.length > 0) {
        console.log(`      → Aliases: ${field.aliases.join(', ')}`);
      }
    });
    console.log();

    // Run extraction
    console.log('━'.repeat(80));
    console.log('EXTRACTING...');
    console.log('━'.repeat(80));
    console.log();

    const startTime = Date.now();
    const result = await extractor.extract({
      content: base64Content,
      mimeType: 'application/pdf',
      filename: path.basename(TEST_PDF_PATH),
      config: {
        outputSchema: OUTPUT_SCHEMA,
        ocrFallback: true,
      },
    });
    const elapsed = Date.now() - startTime;

    console.log(`⏱️  Extraction took ${elapsed}ms`);
    console.log();

    // Show results
    if (result.success) {
      console.log('✅ EXTRACTION SUCCESSFUL!');
      console.log();

      console.log('📋 Extracted Fields:');
      console.log('─'.repeat(80));
      Object.entries(result.data).forEach(([key, value]) => {
        console.log(`${key.toUpperCase()}:`);
        console.log(`  ${value}`);
        console.log();
      });
      console.log('─'.repeat(80));
      console.log();

      // Metadata
      console.log('📊 Extraction Metadata:');
      console.log(`   Method: ${result.metadata.extractionMethod}`);
      console.log(`   Confidence: ${(result.confidence * 100).toFixed(1)}%`);
      console.log(`   Processing time: ${result.metadata.processingTimeMs}ms`);
      console.log(`   Text length: ${result.metadata.textLength} characters`);
      console.log(`   Fields extracted: ${result.metadata.fieldsExtracted}/${result.metadata.fieldsRequested}`);

      if (result.metadata.missingFields.length > 0) {
        console.log(`   ⚠️  Missing fields: ${result.metadata.missingFields.join(', ')}`);
      }

      if (result.metadata.uncertainFields.length > 0) {
        console.log(`   ⚠️  Uncertain fields: ${result.metadata.uncertainFields.join(', ')}`);
      }
      console.log();

      // Raw text preview
      if (result.rawText) {
        console.log('📄 Raw Text Extracted (first 1500 characters):');
        console.log('─'.repeat(80));
        console.log(result.rawText.substring(0, 1500));
        if (result.rawText.length > 1500) {
          console.log(`\n... (${result.rawText.length - 1500} more characters)`);
        }
        console.log('─'.repeat(80));
        console.log();

        // Save full raw text
        const rawTextPath = TEST_PDF_PATH.replace('.pdf', '-raw-text.txt');
        fs.writeFileSync(rawTextPath, result.rawText, 'utf-8');
        console.log(`💾 Full raw text saved to: ${rawTextPath}`);
        console.log();
      }
    } else {
      console.log('❌ EXTRACTION FAILED!');
      console.log();

      if (result.errors && result.errors.length > 0) {
        console.log('Errors:');
        result.errors.forEach(err => console.log(`   - ${err}`));
        console.log();
      }

      if (result.metadata.missingFields.length > 0) {
        console.log(`Missing fields: ${result.metadata.missingFields.join(', ')}`);
        console.log();
      }

      // Still show raw text for debugging
      if (result.rawText) {
        console.log('📄 Raw Text Extracted (first 1000 characters):');
        console.log('─'.repeat(80));
        console.log(result.rawText.substring(0, 1000));
        console.log('─'.repeat(80));
        console.log();

        const rawTextPath = TEST_PDF_PATH.replace('.pdf', '-raw-text.txt');
        fs.writeFileSync(rawTextPath, result.rawText, 'utf-8');
        console.log(`💾 Full raw text saved to: ${rawTextPath}`);
        console.log();
      }
    }

    console.log('='.repeat(80));
    console.log('TEST COMPLETE');
    console.log('='.repeat(80));
    console.log();

    // Analysis and recommendations
    if (result.metadata.missingFields.length > 0) {
      console.log('💡 TIPS FOR MISSING FIELDS:');
      console.log();
      console.log('1. Review the raw text file to see if the field is actually in the document');
      console.log('2. Check if the field name/label in the PDF matches your extraction fields');
      console.log('3. Add more aliases to the field definition to match variations');
      console.log('4. If text is empty, the PDF might be scanned - enable AWS Textract');
      console.log();

      // Check if text is too short (might be scanned)
      if (result.metadata.textLength < 100) {
        console.log('⚠️  WARNING: Very little text extracted!');
        console.log('   This PDF might be a scanned image. Consider:');
        console.log('   - Enabling AWS Textract for OCR');
        console.log('   - Checking if the PDF is corrupted');
        console.log();
      }
    }

    if (result.confidence < 0.7) {
      console.log('⚠️  LOW CONFIDENCE (<70%)');
      console.log('   Some field values might be incorrect or guessed.');
      console.log('   Review the extracted fields manually.');
      console.log();
    }

  } catch (error: any) {
    console.error('❌ FATAL ERROR:');
    console.error(error);
    console.log();
    process.exit(1);
  }
}

// Run the test
testPdfExtraction().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
