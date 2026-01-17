# V6 DSL Critical Issues - Expense Workflow

## ❌ CRITICAL ISSUES FOUND

### Issue 1: Filter Logic is Wrong (AND instead of OR)

**Requirement:**
```
"Search Gmail for emails where subject contains 'expenses' OR 'receipt'"
```

**Generated DSL:**
```javascript
// Step 2
{
  "step_id": "filter_1",
  "type": "transform",
  "operation": "filter",
  "input": "{{emails}}",
  "config": {
    "field": "subject",
    "operator": "contains",
    "value": "expenses"
  },
  "output_variable": "filtered_1"
}

// Step 3
{
  "step_id": "filter_2",
  "type": "transform",
  "operation": "filter",
  "input": "{{filtered_1}}",  // ❌ WRONG! This chains filters with AND
  "config": {
    "field": "subject",
    "operator": "contains",
    "value": "receipt"
  },
  "output_variable": "filtered_2"
}
```

**Problem:**
- Sequential filters create AND logic: `(contains "expenses") AND (contains "receipt")`
- This means subject must contain BOTH words
- Requirement was OR logic: `(contains "expenses") OR (contains "receipt")`

**Expected Result:**
- Email with subject "Expense Report" → ❌ Rejected (doesn't contain "receipt")
- Email with subject "Receipt from Vendor" → ❌ Rejected (doesn't contain "expenses")
- Email with subject "Expense Receipt" → ✅ Accepted (contains both)

**Actual Requirement:**
- Email with subject "Expense Report" → ✅ Should Accept
- Email with subject "Receipt from Vendor" → ✅ Should Accept
- Email with subject "Expense Receipt" → ✅ Should Accept

### Issue 2: Attachment Extraction Placement is Wrong

**Generated DSL:**
```javascript
// Step 4 - Filter by date
{
  "step_id": "filter_3",
  "type": "transform",
  "operation": "filter",
  "input": "{{filtered_2}}",  // This is EMAIL objects
  "config": {
    "field": "date",
    "operator": "within_last_days",
    "value": 7
  },
  "output_variable": "filtered_emails"
}

// Step 5 - Extract PDFs
{
  "step_id": "extract_pdfs_1",
  "type": "transform",
  "operation": "map",
  "input": "{{filtered_emails}}",  // Email objects
  "config": {
    "extract": "attachments",
    "filter": {
      "field": "type",  // ❌ Filtering on EMAIL.type (doesn't exist)
      "operator": "equals",
      "value": "application/pdf"
    }
  },
  "output_variable": "pdf_attachments"
}
```

**Problem:**
The filter `{ "field": "type", "operator": "equals", "value": "application/pdf" }` is nested inside the map config, but it's unclear if this filters:
1. Email objects (which don't have a "type" field) ❌
2. Attachment objects (which do have "type" field) ✅

**Likely Outcome:**
The filter won't work because emails don't have a "type" field.

### Issue 3: Missing Initial Filter for "has:attachment"

**Generated DSL - Step 1:**
```javascript
{
  "step_id": "fetch_emails_1",
  "type": "action",
  "plugin": "gmail",
  "operation": "fetch_emails",
  "config": {
    "query": "has:attachment"  // ✅ This is correct
  },
  "output_variable": "emails"
}
```

**Status:** ✅ This is actually correct - using Gmail search syntax

## Root Cause Analysis

### Why Did the Compiler Make These Mistakes?

1. **OR Logic Not Supported in Current DSL**
   - The declarative IR has multiple filter objects in an array
   - The compiler doesn't know how to combine them (AND vs OR)
   - It defaults to sequential chaining (AND logic)

2. **Attachment Extraction Pattern Not Recognized**
   - The compiler auto-injected PDF extraction
   - But it didn't understand the data flow: emails → attachments → PDFs
   - It treated it as a single-level filter

3. **Missing Transform Pattern for OR Filters**
   - Need a `filter` operation with `conditions: []` and `combineWith: "OR"`
   - Current implementation only supports single field filters

## Correct DSL Should Be

### Option A: Fix with Single Combined Filter

```javascript
// Step 2 - Combined OR filter
{
  "step_id": "filter_1",
  "type": "transform",
  "operation": "filter",
  "input": "{{emails}}",
  "config": {
    "conditions": [
      {
        "field": "subject",
        "operator": "contains",
        "value": "expenses"
      },
      {
        "field": "subject",
        "operator": "contains",
        "value": "receipt"
      }
    ],
    "combineWith": "OR"  // ✅ OR logic
  },
  "output_variable": "filtered_subject"
}

// Step 3 - Filter by date
{
  "step_id": "filter_2",
  "type": "transform",
  "operation": "filter",
  "input": "{{filtered_subject}}",
  "config": {
    "field": "date",
    "operator": "within_last_days",
    "value": 7
  },
  "output_variable": "filtered_emails"
}

// Step 4 - Extract all attachments from filtered emails
{
  "step_id": "extract_attachments_1",
  "type": "transform",
  "operation": "map",
  "input": "{{filtered_emails}}",
  "config": {
    "extract": "attachments",
    "flatten": true  // Flatten array of arrays
  },
  "output_variable": "all_attachments"
}

// Step 5 - Filter attachments to only PDFs
{
  "step_id": "filter_pdfs_1",
  "type": "transform",
  "operation": "filter",
  "input": "{{all_attachments}}",
  "config": {
    "field": "type",  // Now filtering ATTACHMENT objects
    "operator": "equals",
    "value": "application/pdf"
  },
  "output_variable": "pdf_attachments"
}
```

### Option B: Use Gmail Search Syntax (Better)

```javascript
// Step 1 - Use Gmail search with OR
{
  "step_id": "fetch_emails_1",
  "type": "action",
  "plugin": "gmail",
  "operation": "fetch_emails",
  "config": {
    // ✅ Gmail supports complex queries
    "query": "has:attachment (subject:expenses OR subject:receipt) newer_than:7d"
  },
  "output_variable": "emails"
}

// Step 2 - Extract all attachments
{
  "step_id": "extract_attachments_1",
  "type": "transform",
  "operation": "map",
  "input": "{{emails}}",
  "config": {
    "extract": "attachments",
    "flatten": true
  },
  "output_variable": "all_attachments"
}

// Step 3 - Filter to PDFs only
{
  "step_id": "filter_pdfs_1",
  "type": "transform",
  "operation": "filter",
  "input": "{{all_attachments}}",
  "config": {
    "field": "mimeType",  // or "type" depending on Gmail API
    "operator": "equals",
    "value": "application/pdf"
  },
  "output_variable": "pdf_attachments"
}
```

## Impact Assessment

### Current DSL Execution Outcome

**If we execute the current DSL:**

1. ✅ Fetch emails with attachments
2. ❌ Filter 1: Keep only emails with "expenses" in subject
3. ❌ Filter 2: Keep only emails that ALSO have "receipt" in subject
   - Result: Very few emails (only those with both words)
4. ✅ Filter 3: Keep only last 7 days
5. ❌ Extract PDFs: Likely fails or returns empty
   - Filter on email.type doesn't make sense
6. ❌ Scatter-gather: May process nothing
7. ❌ Final result: Empty or incorrect

**Success Rate:** ~10% (only catches emails with both "expenses" AND "receipt")

## Required Fixes

### 1. Compiler Must Support OR Filters

**Declarative IR Input:**
```json
{
  "filters": [
    { "field": "subject", "operator": "contains", "value": "expenses" },
    { "field": "subject", "operator": "contains", "value": "receipt" }
  ]
}
```

**Compiler Should Recognize:**
- Multiple filters on the same field → OR logic
- Generate single filter step with `conditions` and `combineWith: "OR"`

### 2. Compiler Must Understand Multi-Level Data Flow

**Pattern:**
- emails (objects with attachments field)
  → extract attachments
  → attachments (array of attachment objects)
  → filter by type
  → pdfs

**Compiler Should:**
1. Detect "PDF attachments" context in AI operation
2. Generate extraction transform
3. Generate filter transform on ATTACHMENTS (not emails)
4. Properly chain the variable flow

### 3. Use Plugin-Specific Intelligence

**Gmail Plugin:**
- Supports advanced search syntax
- Can handle OR, AND, date ranges in query string
- Better to push filter logic to plugin than create transform steps

**Compiler Should:**
- Detect Gmail as data source
- Combine filters into Gmail search query
- Simplify DSL by reducing transform steps

## Next Steps

1. **Fix DeclarativeCompiler.ts** to handle OR filters
2. **Fix DeclarativeCompiler.ts** to properly extract multi-level data (emails → attachments → PDFs)
3. **Add plugin-specific optimizations** (Gmail search syntax)
4. **Update validation script** to catch these logical errors

## Conclusion

**Current DSL Status:** ❌ INVALID for production

**Reason:**
- Filter logic is incorrect (AND instead of OR)
- Attachment extraction likely won't work
- Will produce empty or wrong results

**The V6 architecture validation passed for STRUCTURE but failed for LOGIC.**

We need to fix the **Compiler's pattern recognition** before this is production-ready.
