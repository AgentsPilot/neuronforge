/**
 * Debug why Textract key-value pairs aren't matching schema fields
 */

import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';
import { TextractClient } from '@/lib/extraction/TextractClient';

// Load environment variables
const envPath = path.join(process.cwd(), '.env.local');
config({ path: envPath });

// Simulate the field variation generation
function getFieldNameVariations(fieldName: string, description: string): string[] {
  const variations = new Set<string>();

  // 1. Original field name
  variations.add(fieldName);

  // 2. camelCase to words
  variations.add(fieldName.replace(/([A-Z])/g, ' $1').toLowerCase().trim());

  // 3. snake_case to words
  variations.add(fieldName.replace(/_/g, ' '));

  // 4. Individual words
  const words = fieldName.replace(/[_\s&]+/g, ' ').trim().split(' ');
  words.forEach(word => {
    if (word.length > 2) {
      variations.add(word.toLowerCase());
    }
  });

  // 5. Keywords from description
  const descWords = description.toLowerCase().split(/[^\w]+/);
  descWords.forEach(word => {
    if (word.length > 2) {
      variations.add(word);
    }
  });

  return Array.from(variations);
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function main() {
  console.log('\n🔍 Debug Field Matching\n');

  const filename = 'Invoice677931.pdf';
  const filePath = path.join(process.cwd(), 'test-files', filename);

  const fileBuffer = fs.readFileSync(filePath);
  const base64Content = fileBuffer.toString('base64');

  const textractClient = new TextractClient();
  const result = await textractClient.analyzeDocument(base64Content);

  // Test field: date
  const fieldName = 'date';
  const fieldDescription = 'Invoice or receipt date';

  console.log(`Field: "${fieldName}"`);
  console.log(`Description: "${fieldDescription}"\n`);

  const variations = getFieldNameVariations(fieldName, fieldDescription);
  console.log('Generated variations:');
  variations.forEach(v => console.log(`  - "${v}" → normalized: "${normalizeKey(v)}"`));

  console.log('\nTextract keys that contain "date" or "invoice":');
  result.keyValuePairs.forEach(kv => {
    const keyLower = kv.key.toLowerCase();
    if (keyLower.includes('date') || keyLower.includes('invoice')) {
      const normalized = normalizeKey(kv.key);
      console.log(`  - "${kv.key}" → normalized: "${normalized}" → value: "${kv.value}"`);

      // Check if any variation matches
      const exactMatch = variations.find(v => normalizeKey(v) === normalized);
      const partialMatch = variations.find(v => {
        const normVar = normalizeKey(v);
        if (normVar.length < 4) return false;
        return normalized.startsWith(normVar) || normalized.endsWith(normVar);
      });

      if (exactMatch) {
        console.log(`    ✅ EXACT MATCH with variation: "${exactMatch}"`);
      } else if (partialMatch) {
        console.log(`    ⚠️  PARTIAL MATCH with variation: "${partialMatch}"`);
      } else {
        console.log(`    ❌ NO MATCH`);
      }
    }
  });
}

main().catch(console.error);
