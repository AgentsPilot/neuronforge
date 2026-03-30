/**
 * Test script for PDF extraction using the document-extractor plugin
 *
 * Usage:
 * 1. Place your PDF file at: /Users/yaelomer/Documents/neuronforge/test-files/test-document.pdf
 * 2. Run: npx tsx scripts/test-document-extractor-plugin.ts
 *
 * This script will:
 * - Load the PDF file
 * - Extract text using pdf-parse (free)
 * - Try AWS Textract for structured extraction (if configured)
 * - Show what fields were found and what's missing
 * - Display the raw text extracted
 */

import fs from 'fs';
import path from 'path';
import { createLogger } from '@/lib/logger';
import { DocumentExtractorPluginExecutor } from '@/lib/server/document-extractor-plugin-executor';
import { UserPluginConnections } from '@/lib/server/user-plugin-connections';
import { PluginManagerV2 } from '@/lib/server/plugin-manager-v2';

const logger = createLogger({ module: 'PDFExtractionTest' });

// Test PDF file location - PUT YOUR PDF HERE
const TEST_PDF_PATH = path.join(process.cwd(), 'test-files', 'Invoice-ZYVUTAKJ-0003 (1) (1).pdf');

// Define what fields you want to extract
// Fields requested: Invoice number, Address, Vendor, Date, Amount
const FIELDS_TO_EXTRACT = [
  {
    name: 'invoice_number',
    type: 'string',
    description: 'Invoice number or document number',
    required: true,
  },
  {
    name: 'vendor',
    type: 'string',
    description: 'Vendor name or company name',
    required: true,
  },
  {
    name: 'address',
    type: 'string',
    description: 'Address (vendor address, billing address, or shipping address)',
    required: true,
  },
  {
    name: 'date',
    type: 'date',
    description: 'Invoice date or document date',
    required: true,
  },
  {
    name: 'amount',
    type: 'currency',
    description: 'Total amount, invoice total, or amount due',
    required: true,
  },
];

async function testPdfExtraction() {
  console.log('='.repeat(80));
  console.log('PDF EXTRACTION TEST');
  console.log('='.repeat(80));
  console.log();

  // Check if test file exists
  if (!fs.existsSync(TEST_PDF_PATH)) {
    console.error(`❌ Test PDF not found at: ${TEST_PDF_PATH}`);
    console.log();
    console.log('📁 Please place your PDF file at:');
    console.log(`   ${TEST_PDF_PATH}`);
    console.log();
    console.log('💡 Or create the test-files directory first:');
    console.log(`   mkdir -p ${path.dirname(TEST_PDF_PATH)}`);
    process.exit(1);
  }

  console.log(`✅ Found PDF file: ${TEST_PDF_PATH}`);
  const stats = fs.statSync(TEST_PDF_PATH);
  console.log(`📊 File size: ${(stats.size / 1024).toFixed(2)} KB`);
  console.log();

  try {
    // Read and encode PDF file
    console.log('📖 Reading PDF file...');
    const fileBuffer = fs.readFileSync(TEST_PDF_PATH);
    const base64Content = fileBuffer.toString('base64');
    console.log(`✅ Encoded to base64 (${base64Content.length} characters)`);
    console.log();

    // Initialize plugin executor
    console.log('🔧 Initializing document extractor plugin...');
    const userConnections = new UserPluginConnections('test-user-id');
    const pluginManager = new PluginManagerV2();
    const executor = new DocumentExtractorPluginExecutor(userConnections, pluginManager);
    console.log('✅ Plugin initialized');
    console.log();

    // Prepare extraction parameters
    console.log('🎯 Fields to extract:');
    FIELDS_TO_EXTRACT.forEach((field, idx) => {
      console.log(`   ${idx + 1}. ${field.name} (${field.type})${field.required ? ' [REQUIRED]' : ''}`);
      if (field.description) {
        console.log(`      → ${field.description}`);
      }
    });
    console.log();

    // Test 1: Extract with OCR disabled (PDF text extraction only)
    console.log('━'.repeat(80));
    console.log('TEST 1: PDF Text Extraction (Free, no OCR)');
    console.log('━'.repeat(80));
    console.log();

    const startTime1 = Date.now();
    const result1 = await executor.executeAction({
      user_id: 'test-user-id',
      plugin_key: 'document-extractor',
      action_name: 'extract_structured_data',
      parameters: {
        file_content: base64Content,
        mime_type: 'application/pdf',
        filename: path.basename(TEST_PDF_PATH),
        fields: FIELDS_TO_EXTRACT,
        use_ai: false, // No AI, just deterministic extraction
      },
    });
    const elapsed1 = Date.now() - startTime1;

    console.log(`⏱️  Extraction took ${elapsed1}ms`);
    console.log();

    if (result1.success) {
      console.log('✅ Extraction succeeded!');
      console.log();

      // Show extracted fields
      console.log('📋 Extracted Fields:');
      const metadata = result1.data._extraction_metadata;
      delete result1.data._extraction_metadata; // Remove metadata for clean display

      Object.entries(result1.data).forEach(([key, value]) => {
        console.log(`   ${key}: ${value}`);
      });
      console.log();

      // Show metadata
      if (metadata) {
        console.log('📊 Extraction Metadata:');
        console.log(`   Method: ${metadata.method}`);
        console.log(`   Confidence: ${(metadata.confidence * 100).toFixed(1)}%`);
        console.log(`   Processing time: ${metadata.processing_time_ms}ms`);
        console.log(`   Success: ${metadata.success}`);

        if (metadata.missing_fields && metadata.missing_fields.length > 0) {
          console.log(`   ⚠️  Missing fields: ${metadata.missing_fields.join(', ')}`);
        }

        if (metadata.uncertain_fields && metadata.uncertain_fields.length > 0) {
          console.log(`   ⚠️  Uncertain fields: ${metadata.uncertain_fields.join(', ')}`);
        }
        console.log();

        // Show raw text (first 1000 chars)
        if (metadata.raw_text) {
          console.log('📄 Raw Text Extracted (first 1000 characters):');
          console.log('─'.repeat(80));
          console.log(metadata.raw_text.substring(0, 1000));
          if (metadata.raw_text.length > 1000) {
            console.log(`\n... (${metadata.raw_text.length - 1000} more characters)`);
          }
          console.log('─'.repeat(80));
          console.log();

          // Save full raw text to file for inspection
          const rawTextPath = TEST_PDF_PATH.replace('.pdf', '-raw-text.txt');
          fs.writeFileSync(rawTextPath, metadata.raw_text, 'utf-8');
          console.log(`💾 Full raw text saved to: ${rawTextPath}`);
          console.log();
        }
      }
    } else {
      console.log('❌ Extraction failed!');
      console.log(`   Error: ${result1.error || 'Unknown error'}`);
      console.log();
    }

    // Test 2: Try with OCR enabled (AWS Textract)
    console.log('━'.repeat(80));
    console.log('TEST 2: OCR Extraction with AWS Textract (if configured)');
    console.log('━'.repeat(80));
    console.log();

    // Check if AWS credentials are configured
    const hasAwsCredentials = process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY;

    if (!hasAwsCredentials) {
      console.log('⚠️  AWS credentials not configured - skipping Textract test');
      console.log('   To enable Textract OCR, set these environment variables:');
      console.log('   - AWS_ACCESS_KEY_ID');
      console.log('   - AWS_SECRET_ACCESS_KEY');
      console.log('   - AWS_REGION (optional, defaults to us-east-1)');
      console.log();
    } else {
      console.log('✅ AWS credentials found - testing with Textract OCR...');
      console.log();

      const startTime2 = Date.now();
      const result2 = await executor.executeAction({
        user_id: 'test-user-id',
        plugin_key: 'document-extractor',
        action_name: 'extract_structured_data',
        parameters: {
          file_content: base64Content,
          mime_type: 'application/pdf',
          filename: path.basename(TEST_PDF_PATH),
          fields: FIELDS_TO_EXTRACT,
          use_ai: false, // Still deterministic, but will use Textract OCR
        },
      });
      const elapsed2 = Date.now() - startTime2;

      console.log(`⏱️  Extraction took ${elapsed2}ms`);
      console.log();

      if (result2.success) {
        console.log('✅ Textract extraction succeeded!');
        console.log();

        const metadata2 = result2.data._extraction_metadata;
        delete result2.data._extraction_metadata;

        console.log('📋 Extracted Fields (with Textract):');
        Object.entries(result2.data).forEach(([key, value]) => {
          console.log(`   ${key}: ${value}`);
        });
        console.log();

        if (metadata2) {
          console.log('📊 Textract Metadata:');
          console.log(`   Method: ${metadata2.method}`);
          console.log(`   Confidence: ${(metadata2.confidence * 100).toFixed(1)}%`);
          console.log(`   Processing time: ${metadata2.processing_time_ms}ms`);

          if (metadata2.missing_fields && metadata2.missing_fields.length > 0) {
            console.log(`   ⚠️  Missing fields: ${metadata2.missing_fields.join(', ')}`);
          }
          console.log();
        }

        // Compare results
        console.log('🔍 Comparison:');
        console.log(`   Text extraction: ${elapsed1}ms`);
        console.log(`   Textract extraction: ${elapsed2}ms`);
        console.log(`   Speed difference: ${((elapsed2 / elapsed1) * 100).toFixed(0)}% of text-only time`);
        console.log();
      } else {
        console.log('❌ Textract extraction failed!');
        console.log(`   Error: ${result2.error || 'Unknown error'}`);
        console.log();
      }
    }

    console.log('='.repeat(80));
    console.log('TEST COMPLETE');
    console.log('='.repeat(80));
    console.log();
    console.log('💡 Tips for better extraction:');
    console.log('   1. Review the raw text output to see what was actually extracted');
    console.log('   2. Check if field names in your FIELDS_TO_EXTRACT match the document');
    console.log('   3. For scanned PDFs, Textract (OCR) is required');
    console.log('   4. Field descriptions help the extractor find the right values');
    console.log();

  } catch (error: any) {
    console.error('❌ Test failed with error:');
    console.error(error);
    console.log();
    logger.error({ err: error }, 'PDF extraction test failed');
    process.exit(1);
  }
}

// Run the test
testPdfExtraction().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
