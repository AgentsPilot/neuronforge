# PDF Extraction Test Files

This directory is for testing the document-extractor plugin with PDF files.

## Quick Start

1. **Place your PDF file here:**
   ```
   cp /path/to/your/invoice.pdf test-document.pdf
   ```

2. **Edit the test script** to define what fields you want to extract:
   - Open: `scripts/test-document-extractor-plugin.ts`
   - Edit the `FIELDS_TO_EXTRACT` array around line 21
   - Customize field names, types, and descriptions based on your document

3. **Run the test:**
   ```bash
   cd /Users/yaelomer/Documents/neuronforge
   npx tsx scripts/test-document-extractor-plugin.ts
   ```

## Field Types

When defining `FIELDS_TO_EXTRACT`, you can use these types:

- **string** - Any text (names, descriptions, notes)
- **number** - Numeric values without currency
- **date** - Dates in various formats
- **currency** - Monetary amounts (e.g., $123.45)
- **boolean** - True/false values

## Example Field Definitions

### For Invoices:
```typescript
const FIELDS_TO_EXTRACT = [
  {
    name: 'vendor_name',
    type: 'string',
    description: 'Name of the vendor or company',
    required: true,
  },
  {
    name: 'invoice_number',
    type: 'string',
    description: 'Invoice or document number',
    required: true,
  },
  {
    name: 'invoice_date',
    type: 'date',
    description: 'Invoice date',
    required: true,
  },
  {
    name: 'total_amount',
    type: 'currency',
    description: 'Total amount due',
    required: true,
  },
  {
    name: 'due_date',
    type: 'date',
    description: 'Payment due date',
    required: false,
  },
];
```

### For Receipts:
```typescript
const FIELDS_TO_EXTRACT = [
  {
    name: 'merchant',
    type: 'string',
    description: 'Store or merchant name',
    required: true,
  },
  {
    name: 'date',
    type: 'date',
    description: 'Purchase date',
    required: true,
  },
  {
    name: 'total',
    type: 'currency',
    description: 'Total amount paid',
    required: true,
  },
  {
    name: 'payment_method',
    type: 'string',
    description: 'Credit card type or payment method',
    required: false,
  },
];
```

### For Contracts:
```typescript
const FIELDS_TO_EXTRACT = [
  {
    name: 'party_a',
    type: 'string',
    description: 'First party name',
    required: true,
  },
  {
    name: 'party_b',
    type: 'string',
    description: 'Second party name',
    required: true,
  },
  {
    name: 'effective_date',
    type: 'date',
    description: 'Contract effective date',
    required: true,
  },
  {
    name: 'termination_date',
    type: 'date',
    description: 'Contract end date',
    required: false,
  },
  {
    name: 'contract_value',
    type: 'currency',
    description: 'Total contract value',
    required: false,
  },
];
```

## What the Test Script Does

1. **Loads your PDF** from `test-files/test-document.pdf`
2. **Extracts text** using free PDF parsing (no OCR)
3. **Attempts structured extraction** to find the fields you defined
4. **Saves raw text** to `test-document-raw-text.txt` for inspection
5. **Tests AWS Textract** if you have AWS credentials configured (optional)

## Understanding the Results

### Success Indicators:
- ✅ All required fields found
- High confidence score (>80%)
- Raw text looks correct

### Common Issues:

#### Issue: Missing fields
**Symptom:** `⚠️ Missing fields: vendor_name, date`

**Solutions:**
1. Check the raw text output - is the field actually in the document?
2. Adjust field names to match what's in the document
3. Add better field descriptions to help the extractor
4. Try different field names in aliases

#### Issue: Low confidence
**Symptom:** `Confidence: 45%`

**Solutions:**
1. Field values are ambiguous or in unexpected formats
2. Document is scanned (not text-based) - enable AWS Textract
3. Add more specific field descriptions

#### Issue: Scanned PDF (no text)
**Symptom:** `Raw Text Extracted: (empty)`

**Solutions:**
1. Your PDF is an image/scan and needs OCR
2. Configure AWS Textract credentials:
   ```bash
   export AWS_ACCESS_KEY_ID=your_key
   export AWS_SECRET_ACCESS_KEY=your_secret
   export AWS_REGION=us-east-1
   ```
3. Re-run the test

## Debugging Tips

1. **Always check the raw text file first**
   - Look at `test-document-raw-text.txt`
   - Does it contain the information you're looking for?
   - If not, the PDF might be scanned or poorly formatted

2. **Match field names to actual document text**
   - If the document says "Vendor:" but you're extracting "company_name", it might not find it
   - Use field descriptions that match the document's terminology

3. **Test with simple fields first**
   - Start with obvious fields like dates or totals
   - Add more complex fields once those work

4. **Review extraction method**
   - `pdf-parse`: Free, fast, works for text-based PDFs
   - `textract`: Paid (~$0.0015/page), works for scanned PDFs and provides key-value pairs

## AWS Textract Setup (Optional)

If your PDFs are scanned or you need better structured extraction:

1. **Get AWS credentials:**
   - Go to AWS Console → IAM → Create Access Key
   - Need `textract:DetectDocumentText` and `textract:AnalyzeDocument` permissions

2. **Set environment variables:**
   ```bash
   export AWS_ACCESS_KEY_ID=AKIA...
   export AWS_SECRET_ACCESS_KEY=...
   export AWS_REGION=us-east-1
   ```

3. **Cost:** ~$0.0015 per page (detectDocumentText) or ~$0.015 per page (analyzeDocument)

## Need Help?

If extraction isn't working as expected:
1. Check the raw text output file
2. Review the field definitions
3. Look at the console output for hints about what was found
4. Try adjusting field descriptions to be more specific
