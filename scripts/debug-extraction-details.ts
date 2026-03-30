/**
 * Debug script to see which key-value pairs matched for each field
 */

import fs from 'fs';
import path from 'path';
import { config } from 'dotenv';
import { TextractClient } from '@/lib/extraction/TextractClient';
import { SchemaFieldExtractor } from '@/lib/extraction/SchemaFieldExtractor';
import type { OutputSchema, ExtractionInput } from '@/lib/extraction/types';

// Load environment variables
config({ path: path.join(process.cwd(), '.env.local') });

const TEST_PDF_PATH = path.join(process.cwd(), 'test-files', 'Invoice-ZYVUTAKJ-0003 (1) (1).pdf');

const OUTPUT_SCHEMA: OutputSchema = {
  fields: [
    {
      name: 'invoice_number',
      type: 'string',
      description: 'Invoice number or document number',
      required: true,
    },
    {
      name: 'vendor',
      type: 'string',
      description: 'Vendor name or company name',
      required: true,
    },
    {
      name: 'address',
      type: 'string',
      description: 'Address (vendor address, billing address, or shipping address)',
      required: true,
    },
    {
      name: 'date',
      type: 'string',
      description: 'Invoice date or document date',
      required: true,
    },
    {
      name: 'amount',
      type: 'string',
      description: 'Total amount, invoice total, or amount due',
      required: true,
    },
  ],
};

async function debugExtractionDetails() {
  console.log('='.repeat(80));
  console.log('EXTRACTION DETAILS DEBUGGER');
  console.log('='.repeat(80));
  console.log();

  // Read PDF and get Textract results
  const fileBuffer = fs.readFileSync(TEST_PDF_PATH);
  const base64Content = fileBuffer.toString('base64');

  const textractClient = new TextractClient();
  const textractResult = await textractClient.analyzeDocument(base64Content);

  if (!textractResult) {
    console.error('❌ Textract analysis failed');
    process.exit(1);
  }

  console.log(`✅ Textract extracted ${textractResult.keyValuePairs?.length} key-value pairs`);
  console.log();

  // Run extraction
  const extractionInput: ExtractionInput = {
    text: textractResult.text || '',
    keyValuePairs: textractResult.keyValuePairs,
    tables: textractResult.tables,
  };

  const extractor = new SchemaFieldExtractor();
  const result = extractor.extract(extractionInput, OUTPUT_SCHEMA);

  console.log('━'.repeat(80));
  console.log('EXTRACTION RESULTS WITH DETAILS');
  console.log('━'.repeat(80));
  console.log();

  for (const schemaField of OUTPUT_SCHEMA.fields) {
    const field = result.fields[schemaField.name];

    console.log(`Field: ${schemaField.name}`);
    console.log(`  Value: ${field?.value || '(null)'}`);
    console.log(`  Source: ${field?.source || '(not extracted)'}`);
    console.log(`  Confidence: ${field ? (field.confidence * 100).toFixed(1) : '0'}%`);
    if (field?.rawMatch) {
      console.log(`  Raw match: ${field.rawMatch}`);
    }
    console.log();
  }

  console.log('='.repeat(80));
  console.log('DEBUG COMPLETE');
  console.log('='.repeat(80));
}

debugExtractionDetails().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
