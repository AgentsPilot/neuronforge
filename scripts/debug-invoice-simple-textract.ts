/**
 * Debug Textract extraction for invoice.pdf
 */

import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';
import { TextractClient } from '@/lib/extraction/TextractClient';

// Load environment variables
const envPath = path.join(process.cwd(), '.env.local');
config({ path: envPath });

async function main() {
  console.log('\n🔍 Debug Textract Extraction for invoice.pdf\n');

  const filename = 'invoice.pdf';
  const filePath = path.join(process.cwd(), 'test-files', filename);

  const fileBuffer = fs.readFileSync(filePath);
  const base64Content = fileBuffer.toString('base64');

  const textractClient = new TextractClient();
  const result = await textractClient.analyzeDocument(base64Content);

  console.log('📝 ALL Key-Value Pairs extracted by Textract:\n');
  result.keyValuePairs.forEach((kv, idx) => {
    console.log(`${idx + 1}. "${kv.key}" → "${kv.value}"`);
  });

  console.log('\n🔍 Looking for amount/total-related keys:\n');
  const amountKeys = result.keyValuePairs.filter(kv => {
    const key = kv.key.toLowerCase();
    const value = kv.value.toLowerCase();
    return key.includes('amount') ||
      key.includes('total') ||
      key.includes('due') ||
      key.includes('balance') ||
      value.includes('$') ||
      /\d+\.\d{2}/.test(kv.value);
  });

  if (amountKeys.length > 0) {
    amountKeys.forEach(kv => {
      console.log(`  - "${kv.key}" → "${kv.value}"`);
    });
  } else {
    console.log('  ❌ No amount-related keys found');
  }

  console.log('\n📄 Raw text (first 1500 chars):\n');
  console.log(result.text.substring(0, 1500));
}

main().catch(console.error);
