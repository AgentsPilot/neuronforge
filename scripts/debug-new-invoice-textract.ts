/**
 * Debug Textract extraction for Invoice-LXSH1WEU-0006.pdf
 */

import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';
import { TextractClient } from '@/lib/extraction/TextractClient';

// Load environment variables
const envPath = path.join(process.cwd(), '.env.local');
config({ path: envPath });

async function main() {
  console.log('\n🔍 Debug Textract Extraction for Invoice-LXSH1WEU-0006.pdf\n');

  const filename = 'Invoice-LXSH1WEU-0006.pdf';
  const filePath = path.join(process.cwd(), 'test-files', filename);

  const fileBuffer = fs.readFileSync(filePath);
  const base64Content = fileBuffer.toString('base64');

  const textractClient = new TextractClient();
  const result = await textractClient.analyzeDocument(base64Content);

  console.log('📝 ALL Key-Value Pairs extracted by Textract:\n');
  result.keyValuePairs.forEach((kv, idx) => {
    console.log(`${idx + 1}. "${kv.key}" → "${kv.value}"`);
  });

  console.log('\n🔍 Looking for currency-related keys:\n');
  const currencyKeys = result.keyValuePairs.filter(kv => {
    const key = kv.key.toLowerCase();
    return key.includes('currency') ||
      key.includes('usd') ||
      key.includes('eur') ||
      key.includes('$') ||
      key.includes('code');
  });

  if (currencyKeys.length > 0) {
    currencyKeys.forEach(kv => {
      console.log(`  - "${kv.key}" → "${kv.value}"`);
    });
  } else {
    console.log('  ❌ No currency-related keys found');
  }

  console.log('\n📄 Raw text:\n');
  console.log(result.text.substring(0, 800));
}

main().catch(console.error);
