/**
 * Test PDF extraction comparing pdf-parse vs pdfjs-dist
 *
 * Usage:
 *   npx tsx scripts/test-pdf-extraction.ts <path-to-pdf>
 */

import * as fs from 'fs';
import * as path from 'path';

async function testPdfExtraction() {
  const pdfPath = process.argv[2];

  if (!pdfPath) {
    console.log('Usage: npx tsx scripts/test-pdf-extraction.ts <path-to-pdf>');
    return;
  }

  const fullPath = path.resolve(pdfPath);
  if (!fs.existsSync(fullPath)) {
    console.error(`File not found: ${fullPath}`);
    return;
  }

  const buffer = fs.readFileSync(fullPath);
  console.log('PDF Buffer size:', buffer.length, 'bytes\n');

  // Test 1: pdf-parse
  console.log('=' .repeat(60));
  console.log('TEST 1: pdf-parse (legacy)');
  console.log('=' .repeat(60));
  try {
    const pdfParse = require('pdf-parse');
    const result = await pdfParse(buffer);

    console.log('Pages:', result.numpages);
    console.log('Text length:', result.text?.length || 0);
    console.log('\n--- Extracted Text (first 500 chars) ---');
    console.log(result.text?.substring(0, 500) || '(empty)');
    console.log('\n--- Pattern Detection ---');
    analyzePatterns(result.text || '');
  } catch (error: any) {
    console.error('pdf-parse ERROR:', error.message);
  }

  // Test 2: pdfjs-dist
  console.log('\n' + '=' .repeat(60));
  console.log('TEST 2: pdfjs-dist (Mozilla PDF.js)');
  console.log('=' .repeat(60));
  try {
    const pdfjsLib = await import('pdfjs-dist');
    const uint8Array = new Uint8Array(buffer);

    const loadingTask = pdfjsLib.getDocument({
      data: uint8Array,
      useSystemFonts: true,
      disableFontFace: true,
    });

    const pdfDocument = await loadingTask.promise;
    const numPages = pdfDocument.numPages;

    const textParts: string[] = [];
    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      const page = await pdfDocument.getPage(pageNum);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: any) => ('str' in item ? item.str : ''))
        .join(' ');
      textParts.push(pageText);
    }

    const fullText = textParts.join('\n').trim();

    console.log('Pages:', numPages);
    console.log('Text length:', fullText.length);
    console.log('\n--- Extracted Text (first 500 chars) ---');
    console.log(fullText.substring(0, 500) || '(empty)');
    console.log('\n--- Pattern Detection ---');
    analyzePatterns(fullText);
  } catch (error: any) {
    console.error('pdfjs-dist ERROR:', error.message);
  }
}

function analyzePatterns(text: string) {
  const wordCount = text.split(/\s+/).filter(w => w.length > 1).length;

  console.log('Word count:', wordCount);
  console.log('Quality thresholds:');
  console.log('  - minTextLength (200):', text.length >= 200 ? '✓ PASS' : '✗ FAIL', `(got ${text.length})`);
  console.log('  - minWordCount (40):', wordCount >= 40 ? '✓ PASS' : '✗ FAIL', `(got ${wordCount})`);

  const patterns = {
    'Invoice/Receipt': /invoice|receipt/i.test(text),
    'Date pattern': /\d{1,2}\/\d{1,2}\/\d{2,4}|\w+\s+\d{1,2},?\s+\d{4}/i.test(text),
    'Currency ($)': /\$\d+(\.\d{2})?/.test(text),
    'Total/Amount': /total|amount/i.test(text),
  };

  console.log('\nContent patterns:');
  for (const [name, found] of Object.entries(patterns)) {
    console.log(`  - ${name}: ${found ? '✓ FOUND' : '✗ NOT FOUND'}`);
  }
}

testPdfExtraction();
