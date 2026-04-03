/**
 * Debug Textract extraction for all receipt files
 */

import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';
import { TextractClient } from '@/lib/extraction/TextractClient';

// Load environment variables
const envPath = path.join(process.cwd(), '.env.local');
config({ path: envPath });

async function main() {
  const files = [
    'Invoice677931.pdf',
    'Receipt-2667-7775-2451.pdf',
    'Receipt-HMGRLQ-00003.pdf',
  ];

  const textractClient = new TextractClient();

  for (const filename of files) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`📄 ${filename}`);
    console.log('='.repeat(80));

    const filePath = path.join(process.cwd(), 'test-files', filename);
    const fileBuffer = fs.readFileSync(filePath);
    const base64Content = fileBuffer.toString('base64');

    const result = await textractClient.analyzeDocument(base64Content);

    console.log('\n📝 All Key-Value Pairs:\n');
    result.keyValuePairs.forEach((kv, idx) => {
      console.log(`${idx + 1}. "${kv.key}" → "${kv.value}"`);
    });

    console.log('\n🔍 Looking for currency/amount/total:\n');
    const relevantKeys = result.keyValuePairs.filter(kv => {
      const key = kv.key.toLowerCase();
      return key.includes('currency') ||
        key.includes('amount') ||
        key.includes('total') ||
        key.includes('usd') ||
        key.includes('eur') ||
        key.includes('$');
    });

    relevantKeys.forEach(kv => {
      console.log(`  - "${kv.key}" → "${kv.value}"`);
    });

    if (relevantKeys.length === 0) {
      console.log('  ❌ No currency-related keys found');
    }
  }
}

main().catch(console.error);
