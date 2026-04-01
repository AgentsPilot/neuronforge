/**
 * Inspect Textract key-value pairs from failing PDFs
 */

import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';
import { TextractClient } from '@/lib/extraction/TextractClient';

// Load environment variables
config({ path: path.join(process.cwd(), '.env.local') });

const FAILING_PDFS = [
  'Invoice677931.pdf',
  'Receipt-HMGRLQ-00003.pdf'
];

async function inspectPdf(filename: string) {
  const pdfPath = path.join(process.cwd(), 'tests', 'plugins', 'fixtures', filename);

  console.log('━'.repeat(100));
  console.log(`INSPECTING TEXTRACT DATA: ${filename}`);
  console.log('━'.repeat(100));
  console.log();

  if (!fs.existsSync(pdfPath)) {
    console.error(`❌ File not found: ${pdfPath}`);
    return;
  }

  const fileBuffer = fs.readFileSync(pdfPath);
  const base64Content = fileBuffer.toString('base64');

  const textractClient = new TextractClient();
  const result = await textractClient.analyzeDocument(base64Content);

  if (!result) {
    console.error('❌ Textract analysis failed');
    return;
  }

  console.log('📄 FULL TEXT:');
  console.log('─'.repeat(100));
  console.log(result.text);
  console.log();

  console.log('🔑 KEY-VALUE PAIRS EXTRACTED BY TEXTRACT:');
  console.log('─'.repeat(100));
  if (result.keyValuePairs && result.keyValuePairs.length > 0) {
    result.keyValuePairs.forEach((kv, idx) => {
      console.log(`${idx + 1}. "${kv.key}" → "${kv.value}" (confidence: ${kv.confidence}%)`);
    });
  } else {
    console.log('(no key-value pairs extracted)');
  }
  console.log();

  console.log('📊 TABLES EXTRACTED BY TEXTRACT:');
  console.log('─'.repeat(100));
  if (result.tables && result.tables.length > 0) {
    result.tables.forEach((table, idx) => {
      console.log(`Table ${idx + 1} (${table.rows.length} rows, confidence: ${table.confidence}%):`);
      table.rows.forEach((row, rowIdx) => {
        console.log(`  Row ${rowIdx + 1}: [${row.map(cell => `"${cell}"`).join(', ')}]`);
      });
      console.log();
    });
  } else {
    console.log('(no tables extracted)');
  }
  console.log();

  // Save detailed output
  const outputPath = path.join(process.cwd(), 'tests', 'plugins', 'fixtures', filename.replace('.pdf', '-TEXTRACT-ANALYSIS.json'));
  fs.writeFileSync(outputPath, JSON.stringify({
    filename,
    text: result.text,
    keyValuePairs: result.keyValuePairs,
    tables: result.tables,
  }, null, 2), 'utf-8');
  console.log(`💾 Detailed Textract analysis saved to: ${outputPath}`);
  console.log();
}

async function main() {
  console.log('='.repeat(100));
  console.log('INSPECTING TEXTRACT KEY-VALUE PAIRS AND TABLES');
  console.log('='.repeat(100));
  console.log();

  for (const filename of FAILING_PDFS) {
    await inspectPdf(filename);
  }

  console.log('='.repeat(100));
  console.log('INSPECTION COMPLETE');
  console.log('='.repeat(100));
  console.log();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
