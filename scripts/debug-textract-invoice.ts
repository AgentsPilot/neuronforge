/**
 * Debug Textract extraction for Invoice677931.pdf
 */

import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';
import { TextractClient } from '@/lib/extraction/TextractClient';

// Load environment variables
const envPath = path.join(process.cwd(), '.env.local');
config({ path: envPath });

async function main() {
  console.log('\n🔍 Debug Textract Extraction for Invoice677931.pdf\n');

  const filename = 'Invoice677931.pdf';
  const filePath = path.join(process.cwd(), 'test-files', filename);

  const fileBuffer = fs.readFileSync(filePath);
  const base64Content = fileBuffer.toString('base64');

  const textractClient = new TextractClient();
  const result = await textractClient.analyzeDocument(base64Content);

  console.log('📝 Key-Value Pairs extracted by Textract:\n');
  result.keyValuePairs.forEach((kv, idx) => {
    console.log(`${idx + 1}. "${kv.key}" → "${kv.value}"`);
  });

  console.log('\n🔍 Looking for date-related keys:\n');
  const dateKeys = result.keyValuePairs.filter(kv =>
    kv.key.toLowerCase().includes('date') ||
    kv.key.toLowerCase().includes('invoice')
  );

  dateKeys.forEach(kv => {
    console.log(`  - "${kv.key}" → "${kv.value}"`);
  });
}

main().catch(console.error);
