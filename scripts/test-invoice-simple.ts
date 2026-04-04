/**
 * Test extraction on invoice.pdf
 * Loads environment variables from .env.local
 */

import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';
import { DeterministicExtractor } from '@/lib/extraction/DeterministicExtractor';

// Load environment variables
const envPath = path.join(process.cwd(), '.env.local');
config({ path: envPath });

console.log('\n🔧 Environment Check:');
console.log(`  AWS_ACCESS_KEY_ID: ${process.env.AWS_ACCESS_KEY_ID ? '✅ Set' : '❌ Not set'}`);
console.log(`  AWS_SECRET_ACCESS_KEY: ${process.env.AWS_SECRET_ACCESS_KEY ? '✅ Set' : '❌ Not set'}`);
console.log(`  AWS_REGION: ${process.env.AWS_REGION || '❌ Not set'}`);
console.log(`  ANTHROPIC_API_KEY: ${process.env.ANTHROPIC_API_KEY ? '✅ Set' : '❌ Not set'}`);

async function main() {
  console.log('\n📄 Testing invoice.pdf\n');

  const filename = 'invoice.pdf';

  // Fields to extract
  const fieldsToExtract = [
    { name: 'invoice_number', type: 'string', description: 'Invoice or receipt number', required: true },
    { name: 'vendor', type: 'string', description: 'Company name, business name, seller', required: true },
    { name: 'date', type: 'date', description: 'Invoice or receipt date', required: true },
    { name: 'amount', type: 'currency', description: 'Total amount, invoice total, amount due', required: true },
    { name: 'currency', type: 'string', description: 'Currency code (USD, EUR, etc)', required: false },
  ];

  const extractor = new DeterministicExtractor(true); // Enable OCR

  console.log('━'.repeat(80));
  console.log(`📋 Processing: ${filename}`);
  console.log('━'.repeat(80));

  try {
    // Read file
    const filePath = path.join(process.cwd(), 'test-files', filename);
    if (!fs.existsSync(filePath)) {
      console.log(`❌ File not found: ${filePath}\n`);
      return;
    }

    const fileBuffer = fs.readFileSync(filePath);
    const base64Content = fileBuffer.toString('base64');

    console.log(`✅ Loaded file (${(fileBuffer.length / 1024).toFixed(2)} KB)`);

    // Extract data
    const startTime = Date.now();
    const result = await extractor.extract({
      content: base64Content,
      mimeType: 'application/pdf',
      filename,
      config: {
        outputSchema: { fields: fieldsToExtract },
        ocrFallback: true // Enable Textract + LLM
      }
    });
    const duration = Date.now() - startTime;

    console.log(`\n⏱️  Extraction completed in ${duration}ms`);
    console.log(`📊 Confidence: ${(result.confidence * 100).toFixed(1)}%`);
    console.log(`🔧 Method: ${result.metadata.extractionMethod}`);

    // Token usage if LLM was used
    if (result.metadata.llmTokens) {
      console.log(`\n💰 Token Usage:`);
      console.log(`   Input: ${result.metadata.llmTokens.input} tokens`);
      console.log(`   Output: ${result.metadata.llmTokens.output} tokens`);
      console.log(`   Total: ${result.metadata.llmTokens.input + result.metadata.llmTokens.output} tokens`);
    }

    console.log('\n📝 Extracted Fields:');
    for (const field of fieldsToExtract) {
      const value = result.data[field.name];
      const required = field.required ? '[REQUIRED]' : '[OPTIONAL]';
      const status = value ? '✅' : '❌';
      console.log(`   ${status} ${field.name}: ${value || '(not found)'} ${required}`);
    }

    if (result.metadata.missingFields && result.metadata.missingFields.length > 0) {
      console.log(`\n⚠️  Missing required fields: ${result.metadata.missingFields.join(', ')}`);
    } else {
      console.log(`\n✅ All fields extracted successfully!`);
    }

    console.log('');
  } catch (error: any) {
    console.error(`❌ Error processing ${filename}:`, error.message);
    console.error(error.stack);
  }
}

main().catch(console.error);
