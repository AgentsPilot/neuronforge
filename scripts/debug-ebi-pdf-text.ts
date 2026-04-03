/**
 * Debug PDF text extraction for EBI9603683859_00_M_00_N_EB_0213595080.PDF
 */

import fs from 'fs';
import path from 'path';
import pdf from 'pdf-parse';

async function main() {
  console.log('\n🔍 Debug PDF Text Extraction for EBI invoice\n');

  const filename = 'EBI9603683859_00_M_00_N_EB_0213595080.PDF';
  const filePath = path.join(process.cwd(), 'test-files', filename);

  const fileBuffer = fs.readFileSync(filePath);

  try {
    const data = await pdf(fileBuffer);

    console.log('📄 PDF Metadata:');
    console.log(`  Pages: ${data.numpages}`);
    console.log(`  Text length: ${data.text.length} chars\n`);

    console.log('📝 Full extracted text:\n');
    console.log('━'.repeat(80));
    console.log(data.text);
    console.log('━'.repeat(80));

    // Look for invoice number patterns
    console.log('\n🔍 Looking for invoice number patterns:');
    const invoicePatterns = [
      /invoice\s*#?\s*:?\s*([A-Z0-9-]+)/gi,
      /ref\s*#?\s*:?\s*([A-Z0-9-]+)/gi,
      /number\s*:?\s*([A-Z0-9-]+)/gi,
    ];

    invoicePatterns.forEach(pattern => {
      const matches = data.text.matchAll(pattern);
      for (const match of matches) {
        console.log(`  Found: "${match[0]}" → value: "${match[1]}"`);
      }
    });

    // Look for dates
    console.log('\n📅 Looking for date patterns:');
    const datePatterns = [
      /\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}/g,
      /\d{4}-\d{2}-\d{2}/g,
      /(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}/gi,
    ];

    datePatterns.forEach(pattern => {
      const matches = data.text.matchAll(pattern);
      for (const match of matches) {
        console.log(`  Found: "${match[0]}"`);
      }
    });

    // Look for amounts
    console.log('\n💰 Looking for amount patterns:');
    const amountPatterns = [
      /\$\s*[\d,]+\.\d{2}/g,
      /€\s*[\d,]+\.\d{2}/g,
      /EUR\s*[\d,]+\.\d{2}/g,
      /USD\s*[\d,]+\.\d{2}/g,
      /[\d,]+\.\d{2}\s*(EUR|USD|GBP)/g,
    ];

    amountPatterns.forEach(pattern => {
      const matches = data.text.matchAll(pattern);
      for (const match of matches) {
        console.log(`  Found: "${match[0]}"`);
      }
    });

  } catch (error: any) {
    console.error('❌ Error parsing PDF:', error.message);
  }
}

main().catch(console.error);
