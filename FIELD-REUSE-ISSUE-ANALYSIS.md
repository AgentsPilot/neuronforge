# Field Extraction Reuse Issue

## Problem Identified

When requesting different fields, the system sometimes returns the **same value for multiple different fields**.

### Example from Test Results

**Test 2**: Contact Information
```json
{
  "email": "Anthropic, PBC 104477 Pasadena, CA 91189-4477",           ← PAYMENT ADDRESS
  "customer_name": "offir.omer@gmail.com's Organization...",           ← Correct
  "customer_address": "Anthropic, PBC 104477 Pasadena, CA 91189-4477" ← PAYMENT ADDRESS (duplicate!)
}
```

The `email` and `customer_address` fields both extracted the **payment address**, which is clearly wrong.

---

## Root Cause

### Why This Happens

1. **Textract key-value pairs** are extracted:
   ```
   "PAYMENT ADDRESS:" → "Anthropic, PBC 104477 Pasadena, CA 91189-4477"
   "Bill to" → "offir.omer@gmail.com's Organization..."
   ```

2. **Field variations** are generated:
   - `email` → variations: ["email", "address", "contact"]
   - `customer_address` → variations: ["customer address", "billing address", "address"]

3. **Both fields match "PAYMENT ADDRESS:"**:
   - `email` variations include "address" → matches "PAYMENT ADDRESS" (partial match)
   - `customer_address` variations include "address" → matches "PAYMENT ADDRESS" (partial match)

4. **Current logic**: First field extracts it, second field also extracts it (no deduplication)

---

## Current Code Behavior

**File**: `lib/extraction/SchemaFieldExtractor.ts`

The extraction loop processes each field independently:

```typescript
for (const schemaField of outputSchema.fields) {
  let extracted: ExtractedField | null = null;

  // Try strategies 1-7
  // If found → store in result
  // If not found → continue to next strategy

  if (extracted) {
    fields[schemaField.name] = extracted;  ← Stores the result
    data[schemaField.name] = extracted.value;
  }
}
```

**Issue**: No tracking of which key-value pairs or data sources have already been used.

---

## Impact

### Low Impact Cases
- When fields are truly ambiguous and the document doesn't distinguish them
- When requesting very similar fields (e.g., "address" and "mailing_address")

### High Impact Cases
- When requesting semantically different fields (e.g., "email" vs "address")
- When a high-confidence key-value pair matches multiple field variations
- When fields that don't exist in the document get assigned wrong values

---

## Solution Options

### Option 1: Track Used Key-Value Pairs (Prevent Reuse)

```typescript
const usedKeyValuePairs = new Set<number>(); // Track by index

for (const schemaField of outputSchema.fields) {
  let extracted: ExtractedField | null = null;

  // Strategy 3: Check Textract key-value pairs
  if (!extracted && input.keyValuePairs?.length) {
    extracted = this.extractFromKeyValuePairs(
      schemaField,
      input.keyValuePairs.filter((kv, idx) => !usedKeyValuePairs.has(idx)) // Filter out used pairs
    );

    if (extracted && extracted.source === 'textract_kv') {
      // Mark this key-value pair as used
      const kvIndex = input.keyValuePairs.findIndex(
        kv => kv.key === extracted.rawMatch?.split(':')[0]
      );
      if (kvIndex >= 0) usedKeyValuePairs.add(kvIndex);
    }
  }

  // ... other strategies
}
```

**Pros**:
- ✅ Prevents duplicate extraction
- ✅ Forces system to find different sources for each field
- ✅ More accurate field mapping

**Cons**:
- ⚠️ May miss valid data if user requests the same field with different names
- ⚠️ Doesn't prevent reuse from text patterns (only key-value pairs)
- ⚠️ Increases complexity

### Option 2: Semantic Similarity Check

Before accepting an extraction, check if it's semantically similar to already extracted values:

```typescript
function isTooSimilarToExisting(newValue: string, existingValues: string[]): boolean {
  return existingValues.some(existing =>
    existing === newValue || // Exact duplicate
    levenshteinDistance(existing, newValue) < 5 // Very similar strings
  );
}

if (extracted && !isTooSimilarToExisting(extracted.value, Object.values(data))) {
  // Accept this extraction
} else {
  // Skip and try next strategy
}
```

**Pros**:
- ✅ Catches duplicates regardless of source
- ✅ Works across all extraction strategies
- ✅ Allows intentional duplicates (e.g., billing address = shipping address)

**Cons**:
- ⚠️ May incorrectly reject legitimate duplicate values
- ⚠️ Computationally expensive for large documents
- ⚠️ Hard to tune similarity threshold

### Option 3: Improve Field Variation Specificity (Current Approach Enhancement)

Make field variations MORE specific to avoid false matches:

**Current Problem**:
- `email` → variations include "address" (too generic)
- `customer_address` → variations include "address" (too generic)

**Solution**:
```typescript
private getFieldNameVariations(schemaField: OutputSchemaField): string[] {
  const variations = new Set<string>();

  // 1. Original field name (always specific)
  variations.add(fieldName); // "email", "customer_address"

  // 2. Don't break down into overly generic single words
  // SKIP: "address" from "customer_address"
  // KEEP: Multi-word phrases

  // 3. Extract from description, but filter out ultra-generic words
  const ultraGenericWords = new Set(['address', 'name', 'number', 'date', 'amount']);

  // Only add if NOT in ultra-generic list
  descKeywords.forEach(keyword => {
    if (!ultraGenericWords.has(keyword)) {
      variations.add(keyword);
    }
  });

  return Array.from(variations);
}
```

**Pros**:
- ✅ Prevents false matches at the source
- ✅ Doesn't require tracking or deduplication logic
- ✅ Improves overall extraction quality

**Cons**:
- ⚠️ May make some fields harder to extract if field names don't match document labels
- ⚠️ Requires careful tuning of "ultra-generic" word list

### Option 4: Universal Pattern Priority

Use universal patterns (email regex, date regex, etc.) BEFORE key-value pairs for specific field types:

```typescript
// Current order:
// 1. Input context
// 2. Structured data
// 3. Textract KV pairs
// 4. Tables
// 5. Text patterns
// 6. Universal patterns

// New order for specific types:
if (schemaField.type === 'email' || schemaField.name.includes('email')) {
  // Try email regex pattern FIRST
  extracted = this.extractUniversalPattern(text, 'email');
}

if (!extracted && input.keyValuePairs) {
  extracted = this.extractFromKeyValuePairs(...);
}
```

**Pros**:
- ✅ More accurate for well-defined types (email, phone, URL)
- ✅ Avoids ambiguous key-value pair matches

**Cons**:
- ⚠️ Only works for fields with clear patterns
- ⚠️ May miss emails embedded in larger text strings

---

## Recommended Solution

**Combination of Option 1 + Option 3**:

1. **Track used key-value pairs** to prevent obvious duplicates
2. **Improve variation specificity** by filtering ultra-generic words
3. **Add confidence penalty** for reused values

### Implementation

```typescript
private extract(input: ExtractionInput, outputSchema: OutputSchema): SchemaExtractionResult {
  const fields: Record<string, ExtractedField> = {};
  const data: Record<string, any> = {};
  const usedKeyValuePairs = new Set<string>(); // Track by "key:value" string

  for (const schemaField of outputSchema.fields) {
    let extracted: ExtractedField | null = null;

    // ... input context, structured data ...

    // Strategy 3: Textract key-value pairs (with reuse prevention)
    if (!extracted && input.keyValuePairs?.length) {
      const availableKvPairs = input.keyValuePairs.filter(kv =>
        !usedKeyValuePairs.has(`${kv.key}:${kv.value}`)
      );

      extracted = this.extractFromKeyValuePairs(schemaField, availableKvPairs);

      if (extracted && extracted.source === 'textract_kv' && extracted.rawMatch) {
        usedKeyValuePairs.add(extracted.rawMatch);
      }
    }

    // ... rest of strategies ...

    if (extracted) {
      fields[schemaField.name] = extracted;
      data[schemaField.name] = extracted.value;
    }
  }

  return { success: true, data, fields, /* ... */ };
}
```

---

## Test Case Expectations After Fix

### Test 2: Contact Information
**Before**:
```json
{
  "email": "Anthropic, PBC 104477 Pasadena, CA 91189-4477",  ← WRONG
  "customer_address": "Anthropic, PBC 104477 Pasadena, CA 91189-4477"  ← Duplicate
}
```

**After** (Expected):
```json
{
  "email": "support@anthropic.com",  ← Correct (universal email pattern)
  "customer_address": "14 Venus Drive, Closter, New Jersey 07624"  ← Correct (from "Bill to" KV)
}
```

### Test 4: Unusual Fields (Don't Exist)
**Before**:
```json
{
  "tax_amount": "$100.00",  ← WRONG (field doesn't exist)
  "discount": "$100.00",  ← WRONG
  "payment_method": "Anthropic, PBC 104477..."  ← WRONG
}
```

**After** (Expected):
```json
{
  "tax_amount": null,  ← Correct (or "Unknown Tax Amount" fallback)
  "discount": "-$19.28",  ← Correct (if we add negative amount pattern support)
  "payment_method": null  ← Correct (doesn't exist in document)
}
```

---

## Conclusion

The current system DOES extract ANY requested field, but has a **reuse issue** where high-confidence key-value pairs are incorrectly matched to multiple semantically different fields.

**Solution**: Implement key-value pair tracking + improve variation specificity to prevent false matches.
