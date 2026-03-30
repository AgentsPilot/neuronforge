# Extraction Completeness Analysis

## Investigation Results

### Question 1: Does the system capture ALL requested data (if it exists)?

**Answer: YES, with important caveats**

#### Current Extraction Strategy (Cascading Approach)

The system uses a **cascading extraction strategy** that tries multiple methods in order until it finds data:

```
For each field requested by the user:
  1. Check input context (pass-through fields)          ← 100% confidence
  2. Check structured data (CSV/Excel columns)          ← 95% confidence
  3. Check Textract key-value pairs                     ← 70-95% confidence
  4. Check tables (for array fields)                    ← Variable confidence
  5. Check invoice header tables (vendor/company)       ← 80-85% confidence
  6. Generic text pattern matching                      ← 50-70% confidence

  If found in ANY strategy → use that value
  If NOT found in ANY strategy → mark as missing, set to null
```

**Key Point**: The system DOES try every available strategy for each field. It will find the data IF:
- ✅ The data exists in the document
- ✅ The data matches one of the extraction patterns
- ✅ The field description/variations align with how the data appears in the document

#### What Could Cause Data to Be Missed?

1. **Field Description Mismatch**
   - User defines field as "vendor" with description "Vendor name"
   - Document has "Supplier: Acme Corp" instead
   - Solution: User needs to add "supplier" to field description or aliases

2. **Complex Layouts**
   - Data is in unusual table structures
   - Multi-column complex forms
   - Current fix handles 2-column invoice headers, but not all layouts

3. **Scanned PDFs with Poor OCR**
   - If Textract OCR quality is low, text extraction may be incomplete
   - System will still return what it found, but confidence will be low

4. **Overly Generic Field Names**
   - Field name "date" could match "Date of issue", "Date due", "Date shipped", etc.
   - System now prioritizes more specific matches, but ambiguity can still occur

5. **Data in Images/Charts**
   - If data is embedded in images, charts, or graphs
   - Textract can extract some structured visual data, but not all

#### Completeness Guarantees

✅ **Will capture**:
- Text-based PDFs (via pdfjs-dist)
- Scanned PDFs (via AWS Textract OCR)
- Textract key-value pairs
- Tables (line items, invoice headers)
- Structured data (CSV, Excel)
- Common patterns (dates, amounts, emails, phones, URLs)

⚠️ **May miss**:
- Data with completely unexpected labels (e.g., user asks for "vendor" but document uses obscure synonym)
- Data in complex multi-page tables spanning pages
- Data embedded in images/charts
- Handwritten text (even with OCR)
- Data requiring contextual understanding (e.g., "the company mentioned in paragraph 3")

❌ **Will NOT capture**:
- Data that doesn't exist in the document
- Data requiring reasoning/inference
- Data requiring cross-referencing with external sources

---

### Question 2: Is there an LLM step after extraction?

**Answer: NO - Currently there is NO LLM fallback**

#### Current System Architecture

```
User uploads PDF → pdfjs-dist extracts text → Pattern matching + Textract
                                                      ↓
                                               Returns structured data
                                                      ↓
                                          NO LLM PROCESSING
```

#### Evidence from Code

1. **DeterministicExtractor.ts** (line 5):
```typescript
/**
 * Schema-driven document extraction that works across all file types.
 * No LLM - purely deterministic extraction based on:
 * 1. Structured data (CSV/Excel) → Direct column mapping
 * 2. Textract key-value pairs + tables (PDF/images with OCR)
 * 3. Generic text pattern matching
 */
```

2. **Result Interface** (line 41):
```typescript
export interface DeterministicExtractionResult {
  success: boolean;
  data: Record<string, any>;
  confidence: number;
  needsLlmFallback: false; // Always false - no LLM
  // ...
}
```

3. **Plugin Executor** (line 125):
```typescript
const result = await this.extractor.extract({
  content,
  mimeType,
  filename: name,
  config: {
    outputSchema,
    ocrFallback: !use_ai, // If use_ai=false, use OCR. If use_ai=true, we'd use LLM fallback (not implemented yet)
  },
});
```

**Important Comment on line 125**:
> "If use_ai=true, we'd use LLM fallback **(not implemented yet)**"

---

## Recommendations

### 1. LLM Fallback Implementation (Future Enhancement)

The system has a `use_ai` parameter that is currently not implemented. Here's how it SHOULD work:

```typescript
// Proposed LLM Fallback Flow
if (result.confidence < 0.7 || result.metadata.missingFields.length > 0) {
  // Trigger LLM fallback
  const llmResult = await this.llmExtractor.extract({
    text: result.rawText,
    outputSchema: outputSchema,
    missingFields: result.metadata.missingFields,
    currentData: result.data,
  });

  // Merge deterministic + LLM results
  const finalData = {
    ...result.data,
    ...llmResult.data,
  };
}
```

**Benefits of LLM Fallback**:
- ✅ Can handle ambiguous field names
- ✅ Can infer data from context
- ✅ Can handle complex layouts
- ✅ Better for unusual document formats

**Costs of LLM Fallback**:
- ❌ ~$0.01-0.05 per page (depends on model)
- ❌ Slower processing time (2-5 seconds vs 0.5 seconds)
- ❌ Non-deterministic results
- ❌ May hallucinate data that doesn't exist

### 2. Current Fallback Chain Should Be Extended

Right now:
```
pdfjs-dist → (if insufficient) → Textract → Done
```

Should be:
```
pdfjs-dist → (if insufficient) → Textract → (if insufficient) → LLM
```

### 3. Implement Confidence-Based LLM Triggering

```typescript
// Smart LLM fallback decision
if (use_ai && shouldUseLlmFallback(result)) {
  // Only use LLM for specific fields that failed
  const fieldsNeedingLlm = result.metadata.missingFields.concat(
    result.metadata.uncertainFields
  );

  // Extract only missing/uncertain fields with LLM
  const llmResult = await extractWithLlm(result.rawText, fieldsNeedingLlm);

  // Merge results
  return mergeResults(result, llmResult);
}

function shouldUseLlmFallback(result) {
  return (
    result.confidence < 0.6 ||                           // Low overall confidence
    result.metadata.missingFields.length > 0 ||          // Required fields missing
    result.metadata.uncertainFields.length > 2           // Multiple uncertain fields
  );
}
```

---

## Current System Strengths

1. **Fast**: ~500ms for pdfjs-dist, ~3-4s for Textract
2. **Cost-Effective**: Free for text PDFs, ~$0.0015/page for Textract
3. **Deterministic**: Same input → same output (no hallucinations)
4. **Smart Fallback**: Automatically uses Textract when needed
5. **Comprehensive Pattern Matching**: Multiple extraction strategies

---

## Current System Limitations

### 1. No Semantic Understanding

**Example Problem**:
- User asks for "company name"
- Document says "Acme Corporation (dba Acme Corp)"
- System extracts: "Acme Corporation (dba Acme Corp)"
- User wanted: "Acme Corporation"

**Why**: No LLM to understand "dba" means "doing business as" and extract the main name.

**Workaround**: User can add post-processing step to clean up extracted data.

### 2. No Context-Based Inference

**Example Problem**:
- User asks for "total amount"
- Document has:
  - Line item 1: $100
  - Line item 2: $50
  - Subtotal: $150
  - Tax: $15
  - **Total: $165**
- If "Total" label is missing, system might extract subtotal instead

**Why**: No LLM to understand document structure and infer which amount is the final total.

**Workaround**: Improve field description to include all possible labels: "Total amount, grand total, final amount, amount due"

### 3. Limited Table Intelligence

**Example Problem**:
- User asks for "line_items" (array)
- Table has merged cells, complex structure
- Current system may not parse correctly

**Why**: Textract provides basic table structure, but no LLM to understand complex layouts.

**Workaround**: Works well for simple tables; complex tables may need LLM fallback.

### 4. No Cross-Document Reasoning

**Example Problem**:
- User asks for "customer name"
- Document references "See contract #12345 for customer details"
- Customer name is not in this document

**Why**: No LLM to understand references or look up external data.

**Workaround**: None - system only extracts from the provided document.

---

## Fallback Value Behavior

When a required field is missing, the system has a fallback mechanism:

**Code** (document-extractor-plugin-executor.ts, lines 145-151):
```typescript
// Ensure required fields have fallback values if missing
for (const fieldDef of outputSchema.fields) {
  if (fieldDef.required && (extractedData[fieldDef.name] === null || extractedData[fieldDef.name] === undefined || extractedData[fieldDef.name] === '')) {
    // Use a sensible default based on field name
    const fieldName = fieldDef.name;
    extractedData[fieldDef.name] = `Unknown ${fieldName.charAt(0).toUpperCase() + fieldName.slice(1)}`;
    this.logger.info({ field: fieldDef.name, fallback: extractedData[fieldDef.name] }, 'Applied fallback for missing required field');
  }
}
```

**Behavior**:
- If `vendor` is missing → returns `"Unknown Vendor"`
- If `date` is missing → returns `"Unknown Date"`
- If `amount` is missing → returns `"Unknown Amount"`

**Pros**:
- ✅ Prevents downstream errors (no null/undefined fields)
- ✅ Clear indicator that extraction failed for that field
- ✅ Workflow can continue executing

**Cons**:
- ⚠️ User might not realize extraction failed
- ⚠️ "Unknown Vendor" might look like valid data to automated systems

**Recommendation**: Add a flag to the output indicating which fields used fallback values:

```typescript
return {
  ...extractedData,
  _extraction_metadata: {
    // ... existing metadata
    fallback_fields: fieldsWithFallback, // NEW: list of fields that used fallback
  }
};
```

---

## Testing Completeness

To verify the system captures all data, test with:

1. **Simple invoices** (like the current test) - ✅ Working
2. **Multi-page documents** - ⚠️ Need to test
3. **Complex tables** (merged cells, nested headers) - ⚠️ Need to test
4. **Scanned documents** (poor OCR quality) - ⚠️ Need to test
5. **Non-English documents** - ⚠️ Need to test
6. **Handwritten receipts** - ⚠️ Need to test

### Test Cases to Add

```typescript
// Test 1: Multi-page invoice with line items spanning pages
test('extract line items from multi-page invoice', async () => {
  // Expected: All line items from all pages
});

// Test 2: Invoice with missing required field
test('handle missing vendor name gracefully', async () => {
  // Expected: fallback value + metadata flag
});

// Test 3: Ambiguous field matching
test('extract correct total when multiple amounts exist', async () => {
  // Expected: Final total, not subtotal
});

// Test 4: Poor OCR quality
test('extract data from low-quality scanned PDF', async () => {
  // Expected: Best effort extraction + low confidence score
});
```

---

## Conclusion

### Question 1: Does it capture ALL data?
**Answer**: It captures data IF:
- ✅ Data exists in the document
- ✅ Field descriptions match document labels
- ✅ Data is in extractable format (text, tables, key-value pairs)
- ⚠️ May miss data requiring inference, context, or complex reasoning

### Question 2: Is there an LLM step?
**Answer**: **NO** - Currently there is NO LLM fallback. The system is purely deterministic:
- Uses pdfjs-dist (free text extraction)
- Falls back to AWS Textract (OCR + key-value pairs)
- Uses pattern matching and table parsing
- **NO LLM processing at any stage**

### Recommended Next Steps

1. **Implement LLM Fallback** for missing/uncertain fields
2. **Add confidence thresholds** to trigger LLM fallback
3. **Test with complex documents** to identify edge cases
4. **Add metadata flag** for fallback values
5. **Create test suite** for various document types
