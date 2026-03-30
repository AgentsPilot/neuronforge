/**
 * Debug script to see what Textract extracts from the invoice
 * Shows all key-value pairs and tables
 */

import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';
import { TextractClient } from '@/lib/extraction/TextractClient';

// Load environment variables
config({ path: path.join(process.cwd(), '.env.local') });

const TEST_PDF_PATH = path.join(process.cwd(), 'test-files', 'Invoice-ZYVUTAKJ-0003 (1) (1).pdf');

async function debugTextract() {
  console.log('='.repeat(80));
  console.log('TEXTRACT OUTPUT DEBUGGER');
  console.log('='.repeat(80));
  console.log();

  if (!fs.existsSync(TEST_PDF_PATH)) {
    console.error(`❌ File not found: ${TEST_PDF_PATH}`);
    process.exit(1);
  }

  console.log(`✅ Found PDF: ${path.basename(TEST_PDF_PATH)}`);
  console.log();

  try {
    // Read and encode PDF
    const fileBuffer = fs.readFileSync(TEST_PDF_PATH);
    const base64Content = fileBuffer.toString('base64');

    // Initialize Textract client
    console.log('🔧 Initializing Textract client...');
    const textractClient = new TextractClient();
    console.log('✅ Textract client initialized');
    console.log();

    // Analyze document
    console.log('📄 Analyzing document with Textract...');
    const startTime = Date.now();
    const result = await textractClient.analyzeDocument(base64Content);
    const elapsed = Date.now() - startTime;

    if (!result) {
      console.error('❌ Textract analysis failed');
      process.exit(1);
    }

    console.log(`✅ Analysis complete (${elapsed}ms)`);
    console.log();

    // Show extracted text
    console.log('━'.repeat(80));
    console.log('EXTRACTED TEXT');
    console.log('━'.repeat(80));
    console.log(result.text);
    console.log();

    // Show key-value pairs
    console.log('━'.repeat(80));
    console.log(`KEY-VALUE PAIRS (${result.keyValuePairs?.length || 0} found)`);
    console.log('━'.repeat(80));
    if (result.keyValuePairs && result.keyValuePairs.length > 0) {
      result.keyValuePairs.forEach((kv, idx) => {
        console.log(`${idx + 1}. "${kv.key}" → "${kv.value}" (confidence: ${(kv.confidence * 100).toFixed(1)}%)`);
      });
    } else {
      console.log('(no key-value pairs found)');
    }
    console.log();

    // Show tables
    console.log('━'.repeat(80));
    console.log(`TABLES (${result.tables?.length || 0} found)`);
    console.log('━'.repeat(80));
    if (result.tables && result.tables.length > 0) {
      result.tables.forEach((table, tableIdx) => {
        console.log(`\nTable ${tableIdx + 1} (${table.rows.length} rows, confidence: ${(table.confidence * 100).toFixed(1)}%):`);
        console.log('─'.repeat(80));
        table.rows.forEach((row, rowIdx) => {
          console.log(`  Row ${rowIdx + 1}: ${row.map(cell => `"${cell}"`).join(' | ')}`);
        });
      });
    } else {
      console.log('(no tables found)');
    }
    console.log();

    console.log('='.repeat(80));
    console.log('DEBUG COMPLETE');
    console.log('='.repeat(80));

  } catch (error: any) {
    console.error('❌ Error:', error.message);
    console.error(error);
    process.exit(1);
  }
}

debugTextract().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
