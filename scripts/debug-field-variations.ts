/**
 * Debug script to see what field variations are generated
 */

import { SchemaFieldExtractor } from '@/lib/extraction/SchemaFieldExtractor';
import type { OutputSchemaField } from '@/lib/extraction/types';

const amountField: OutputSchemaField = {
  name: 'amount',
  type: 'string',
  description: 'Total amount, invoice total, or amount due',
  required: true,
};

const dateField: OutputSchemaField = {
  name: 'date',
  type: 'string',
  description: 'Invoice date or document date',
  required: true,
};

// Access private method via reflection for debugging
const extractor = new SchemaFieldExtractor();
const getVariations = (extractor as any).getFieldNameVariations.bind(extractor);

console.log('='.repeat(80));
console.log('FIELD VARIATIONS DEBUG');
console.log('='.repeat(80));
console.log();

console.log('Amount field variations:');
console.log('─'.repeat(80));
const amountVariations = getVariations(amountField);
amountVariations.forEach((v: string, idx: number) => {
  console.log(`${idx + 1}. "${v}" (length: ${v.length})`);
});
console.log();

console.log('Date field variations:');
console.log('─'.repeat(80));
const dateVariations = getVariations(dateField);
dateVariations.forEach((v: string, idx: number) => {
  console.log(`${idx + 1}. "${v}" (length: ${v.length})`);
});
console.log();

// Test key normalization
const normalizeKey = (extractor as any).normalizeKey.bind(extractor);

console.log('Key normalization test:');
console.log('─'.repeat(80));
console.log(`"Amount due" → "${normalizeKey('Amount due')}"`);
console.log(`"amount due" → "${normalizeKey('amount due')}"`);
console.log(`"Date of issue" → "${normalizeKey('Date of issue')}"`);
console.log(`"Invoice number" → "${normalizeKey('Invoice number')}"`);
console.log();

console.log('='.repeat(80));
console.log('DEBUG COMPLETE');
console.log('='.repeat(80));
