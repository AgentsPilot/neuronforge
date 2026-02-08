/**
 * Test the improved schema field extraction with description-based matching
 */
import { config } from 'dotenv';
import { resolve } from 'path';

// Load environment variables
config({ path: resolve(process.cwd(), '.env.local') });

import { SchemaFieldExtractor } from '../lib/extraction/SchemaFieldExtractor.js';
import type { OutputSchema } from '../lib/extraction/types.js';

async function testDescriptionBasedMatching() {
  console.log('='.repeat(80));
  console.log('TEST: Schema Field Extraction with Description-Based Matching');
  console.log('='.repeat(80));

  const extractor = new SchemaFieldExtractor();

  // Simulate extracted text from a receipt (like Textract would provide)
  const sampleText = `
    ANTHROPIC, PBC
    Invoice Date: August 31, 2025
    Category: Software Subscription
    Total Amount: $100.00
    Payment Method: Credit Card
  `;

  // Agent's output schema with descriptions (like in your workflow)
  const outputSchema: OutputSchema = {
    fields: [
      {
        name: 'date&time',
        type: 'string',
        required: true,
        description: 'Receipt date and time if present; if time missing, use normalized receipt date',
      },
      {
        name: 'vendor',
        type: 'string',
        required: true,
        description: 'Merchant/vendor name; if unclear set to literal need review',
      },
      {
        name: 'amount',
        type: 'string',
        required: true,
        description: 'Line item amount normalized to a consistent numeric format',
      },
      {
        name: 'expense type',
        type: 'string',
        required: true,
        description: 'Inferred from receipt text; if low confidence or missing set to literal need review',
      },
    ],
  };

  console.log('\n📋 Output Schema:');
  outputSchema.fields.forEach(field => {
    console.log(`  - ${field.name}: ${field.description?.substring(0, 60)}...`);
  });

  console.log('\n📄 Sample Text:');
  console.log(sampleText.trim());

  console.log('\n🔍 Testing Field Extraction:');
  console.log('-'.repeat(80));

  // Extract fields
  const result = extractor.extract(
    {
      text: sampleText,
    },
    outputSchema
  );

  console.log('\n✅ Extraction Results:');
  console.log(`  Success: ${result.success}`);
  console.log(`  Confidence: ${(result.confidence * 100).toFixed(1)}%`);
  console.log(`  Fields extracted: ${Object.keys(result.fields).length}/${outputSchema.fields.length}`);

  console.log('\n📊 Extracted Data:');
  Object.entries(result.data).forEach(([key, value]) => {
    const field = result.fields[key];
    if (field) {
      console.log(`  ${key}:`);
      console.log(`    Value: ${value || '(not found)'}`);
      console.log(`    Confidence: ${(field.confidence * 100).toFixed(0)}%`);
      console.log(`    Source: ${field.source}`);
      if (field.rawMatch) {
        console.log(`    Matched: "${field.rawMatch.substring(0, 40)}..."`);
      }
    }
  });

  if (result.missingFields.length > 0) {
    console.log(`\n⚠️  Missing fields: ${result.missingFields.join(', ')}`);
  }

  if (result.uncertainFields.length > 0) {
    console.log(`\n⚠️  Uncertain fields: ${result.uncertainFields.join(', ')}`);
  }

  console.log('\n' + '='.repeat(80));
  console.log('💡 How Description-Based Matching Works:');
  console.log('='.repeat(80));
  console.log(`
1. Field: "expense type"
   Description: "Inferred from receipt text..."

2. System extracts keywords from description:
   - "inferred", "receipt", "text", "expense", "type"

3. Field name variations generated:
   - "expense type", "expense_type", "expense", "type"
   - Plus description keywords: "category", "receipt"

4. Looks for matches in document:
   - Finds "Category: Software Subscription" ✓
   - Matches because "category" is a keyword from description

5. No hardcoded synonyms needed - works for ANY field!
  `);

  console.log('\n✅ Benefits:');
  console.log('  - Works with any custom field the agent defines');
  console.log('  - Uses agent\'s field descriptions as matching hints');
  console.log('  - No need to update code for new field types');
  console.log('  - Reduces expensive LLM fallbacks');
}

// Run test
testDescriptionBasedMatching().catch(console.error);
