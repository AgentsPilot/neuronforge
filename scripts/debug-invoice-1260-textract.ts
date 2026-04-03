/**
 * Debug Textract extraction for Invoice amount 1260 09252025.pdf
 */

import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';
import { TextractClient } from '@/lib/extraction/TextractClient';

// Load environment variables
const envPath = path.join(process.cwd(), '.env.local');
config({ path: envPath });

async function main() {
  console.log('\n🔍 Debug Textract Extraction for Invoice amount 1260 09252025.pdf\n');

  const filename = 'Invoice amount 1260 09252025.pdf';
  const filePath = path.join(process.cwd(), 'test-files', filename);

  const fileBuffer = fs.readFileSync(filePath);
  const base64Content = fileBuffer.toString('base64');

  const textractClient = new TextractClient();
  const result = await textractClient.analyzeDocument(base64Content);

  console.log('📝 ALL Key-Value Pairs extracted by Textract:\n');
  result.keyValuePairs.forEach((kv, idx) => {
    console.log(`${idx + 1}. "${kv.key}" → "${kv.value}"`);
  });

  console.log('\n🔍 Looking for vendor-related keys:\n');
  const vendorKeys = result.keyValuePairs.filter(kv => {
    const key = kv.key.toLowerCase();
    const value = kv.value.toLowerCase();
    return key.includes('vendor') ||
      key.includes('company') ||
      key.includes('seller') ||
      key.includes('business') ||
      key.includes('from') ||
      key.includes('bill from') ||
      value.includes('inc') ||
      value.includes('llc') ||
      value.includes('corp');
  });

  if (vendorKeys.length > 0) {
    vendorKeys.forEach(kv => {
      console.log(`  - "${kv.key}" → "${kv.value}"`);
    });
  } else {
    console.log('  ❌ No vendor-related keys found');
  }

  console.log('\n📄 Raw text (first 1000 chars):\n');
  console.log(result.text.substring(0, 1000));
}

main().catch(console.error);
