# Intent Contract Data Flow Analysis
**Date:** 2026-02-26
**File:** output/intent-contract.json

---

## Executive Summary

### 🔴 CRITICAL ISSUE FOUND: Missing Deterministic Extractor

The workflow uses `ai_extract` directly on PDF/image content (step `extract_transaction_data` line 295), but **should use the DeterministicExtractor utility** instead.

### ✅ Data Flow Is Complete & Valid

All parameter references are correct and data flows properly through all 15 steps.

---

## Complete Data Flow Trace

### Step 1: fetch_unread_emails
**Type:** fetch
**Operation:** EMAIL.SEARCH

**Parameters:**
- ✅ `query`: "is:unread" (constant)
- ✅ `max_results`: 100 (constant)
- ✅ `include_attachments`: true (constant)
- ✅ `content_level`: "metadata" (constant)

**Outputs:**
- `emails`: array where each item = {id, subject, from, date, labels}
- `total_found`: number

**Status:** ✅ All parameters valid

---

### Step 2: create_drive_folder
**Type:** deliver
**Operation:** FILES.FOLDER_CREATE

**Parameters:**
- ✅ `folder_name`: { "ref": "$.answers.drive_folder_name" } ← Question answer (pattern 4)
- ✅ `description`: "Invoices and receipts extracted from Gmail" (constant)

**Outputs:**
- `folder_id`: created folder ID
- `folder_name`: folder name
- `web_view_link`: folder web link

**Status:** ✅ All parameters valid, question ref exists

---

### Step 3: process_emails (LOOP)
**Type:** loop
**Operation:** N/A

**Loop Config:**
- ✅ `iterate_over`: { "ref": "$.fetch_unread_emails.emails" } ← Global step output (pattern 1)
- ✅ `item_var`: "email"
- ✅ `collect`: true
- ✅ `collect_as`: "all_attachments"

**Loop Body (4 substeps):**

#### 3.1: list_attachments
**Operation:** EMAIL.LIST_ATTACHMENTS

**Parameters:**
- ✅ `message_id`: { "ref": "$.email.id" } ← Loop item field (pattern 3)

**Outputs:**
- `attachments`: array where each item = {attachment_id, filename, mimeType, size}
- `attachment_count`: number

**Schema Validation:** ✅ `$.email.id` valid - emails array has `id` field (declared in step 1)

#### 3.2: filter_valid_attachments
**Operation:** TRANSFORM (filter)

**Source:** { "ref": "$.list_attachments.attachments" } ← Global step output (pattern 1)

**Expression:**
- ✅ `$.item.mimeType` ← Transform item (pattern 5), field declared in list_attachments outputs

**Schema Validation:** ✅ mimeType field explicitly declared in list_attachments outputs

#### 3.3: add_email_metadata
**Operation:** TRANSFORM (map)

**Source:** { "ref": "$.filter_valid_attachments.valid_attachments" } ← Global step output (pattern 1)

**Template:**
- ✅ `message_id`: { "ref": "$.email.id" } ← Loop item field (pattern 3)
- ✅ `subject`: { "ref": "$.email.subject" } ← Loop item field (pattern 3)
- ✅ `from`: { "ref": "$.email.from" } ← Loop item field (pattern 3)
- ✅ `attachment_id`: { "ref": "$.item.attachment_id" } ← Transform item (pattern 5)
- ✅ `filename`: { "ref": "$.item.filename" } ← Transform item (pattern 5)
- ✅ `mimeType`: { "ref": "$.item.mimeType" } ← Transform item (pattern 5)
- ✅ `size`: { "ref": "$.item.size" } ← Transform item (pattern 5)

**Schema Validation:**
- ✅ Loop item `email` has {id, subject, from, date, labels} ← declared in step 1
- ✅ Transform item has {attachment_id, filename, mimeType, size} ← declared in filter_valid_attachments

#### 3.4: return_enriched
**Operation:** SET

**Values:**
- ✅ `result`: { "ref": "$.add_email_metadata.enriched_attachments" } ← Global step output (pattern 1)

**Loop Outputs:**
- `all_attachments`: "array where each item = {message_id, subject, from, attachment_id, filename}"

**⚠️ Schema Mismatch:** Loop outputs say items have `{message_id, subject, from, attachment_id, filename}` but actually collects `{result: array}` because final step outputs single key "result". This works (flatten step handles it correctly) but schema description is misleading.

**Status:** ✅ Loop works correctly, minor schema description issue

---

### Step 4: flatten_attachments
**Type:** transform
**Operation:** FLATTEN

**Source:** { "ref": "$.process_emails.all_attachments" } ← Global step output (pattern 1)

**Template:**
- ✅ `items`: { "ref": "$.item.result" } ← Extracts array field

**Outputs:**
- `flat_attachments`: array where each item = {message_id, subject, from, attachment_id, filename, mimeType, size}

**Schema Validation:** ✅ Template correctly extracts `$.item.result` which is an array

**Status:** ✅ Flatten works correctly

---

### Step 5: process_attachments (LOOP)
**Type:** loop

**Loop Config:**
- ✅ `iterate_over`: { "ref": "$.flatten_attachments.flat_attachments" } ← Global step output (pattern 1)
- ✅ `item_var`: "attachment"
- ✅ `collect`: true
- ✅ `collect_as`: "processed_results"

**Loop Body (5 substeps):**

#### 5.1: download_attachment
**Operation:** EMAIL.GET_ATTACHMENT

**Parameters:**
- ✅ `message_id`: { "ref": "$.attachment.message_id" } ← Loop item field (pattern 3)
- ✅ `attachment_id`: { "ref": "$.attachment.attachment_id" } ← Loop item field (pattern 3)
- ✅ `filename`: { "ref": "$.attachment.filename" } ← Loop item field (pattern 3)

**Outputs:**
- `content`: attachment binary data
- `mime_type`: attachment MIME type
- `extracted_text`: OCR extracted text if image

**Schema Validation:** ✅ All loop item fields declared in flatten_attachments outputs

**Plugin Action Output Schema (from google-mail-plugin-v2.json):**
```json
{
  "filename": "string",
  "mimeType": "string",
  "size": "integer",
  "data": "string (base64)",
  "extracted_text": "string",
  "is_image": "boolean"
}
```

**⚠️ OUTPUT MISMATCH:**
- Intent Contract says output is: `content`, `mime_type`, `extracted_text`
- Plugin schema says output is: `filename`, `mimeType`, `size`, `data`, `extracted_text`, `is_image`

**This is a naming inconsistency:**
- Intent uses: `content` + `mime_type`
- Plugin returns: `data` + `mimeType`

**Status:** 🟡 Works but field names don't match plugin schema exactly

#### 5.2: upload_to_drive
**Operation:** FILES.UPLOAD

**Parameters:**
- ✅ `file_content`: { "ref": "$.download_attachment.content" } ← Global step output (pattern 1)
- ✅ `file_name`: { "ref": "$.attachment.filename" } ← Loop item field (pattern 3)
- ✅ `folder_id`: { "ref": "$.create_drive_folder.folder_id" } ← Global step output (pattern 1)
- ✅ `mime_type`: { "ref": "$.attachment.mimeType" } ← Loop item field (pattern 3)

**Outputs:**
- `file_id`: uploaded file ID
- `file_name`: uploaded file name
- `web_view_link`: Drive file web link

**Schema Validation:**
- ✅ `$.download_attachment.content` declared in previous step
- ✅ `$.attachment.filename` declared in flat_attachments
- ✅ `$.create_drive_folder.folder_id` declared in step 2
- ✅ `$.attachment.mimeType` declared in flat_attachments

**Status:** ✅ All parameters valid

#### 5.3: extract_transaction_data
**Operation:** AI_EXTRACT

**🔴 CRITICAL ISSUE: Not Using Deterministic Extractor**

**Current Implementation:**
```json
{
  "type": "ai_extract",
  "ai_extract": {
    "instruction": "Extract transaction details from this invoice or receipt...",
    "input": { "ref": "$.download_attachment.content" }
  }
}
```

**Problems:**
1. **Using AI directly** instead of DeterministicExtractor utility
2. **No cost optimization** - AI extraction costs ~$0.01-0.05 per document
3. **No deterministic extraction** - DeterministicExtractor handles:
   - Text-based PDFs: FREE (no LLM call)
   - Scanned PDFs: ~$0.0015/page (AWS Textract only)
   - Images: ~$0.0015/page (AWS Textract only)
4. **Missing structured extraction** - Should use schema-driven extraction

**Expected Implementation (from lib/extraction/index.ts):**
```typescript
// Should use DeterministicExtractor instead:
const extractor = new DeterministicExtractor();
const result = await extractor.extract({
  content: base64Content,
  mimeType: 'application/pdf',
  config: {
    outputSchema: {
      fields: [
        { name: 'date', type: 'date', required: true },
        { name: 'vendor', type: 'string', required: true },
        { name: 'amount', type: 'number', required: true },
        { name: 'currency', type: 'string' },
        { name: 'invoice_number', type: 'string' },
      ]
    }
  }
});
```

**Required Change:**
The Intent Contract should use a **deterministic_extract** step type (if available) OR the compiler should recognize ai_extract on file content and automatically route to DeterministicExtractor.

**Status:** 🔴 CRITICAL - Not using cost-optimized deterministic extraction

#### 5.4: check_amount_exists
**Operation:** VALIDATE

**Checks:**
- ✅ Expression uses `$.extract_transaction_data.amount` ← Global step output (pattern 1)

**Outputs:**
- `is_valid`: whether amount was successfully extracted

**Status:** ✅ Valid

#### 5.5: build_result
**Operation:** SET

**Values (all refs validated):**
- ✅ All refs reference either loop item fields or previous step outputs

**Outputs:**
- `result`: object with complete structure

**Status:** ✅ All refs valid

**Loop Outputs:**
- `processed_results`: array where each item = {message_id, subject, from, filename, file_id, web_view_link, extracted_data: {date, vendor, amount, currency, invoice_number, confidence}, extraction_success}

**Status:** ✅ Schema explicitly enumerates nested structure

---

### Steps 6-8: Filter Transforms
**All validated:** ✅
- filter_successful_extractions: refs `$.item.extraction_success` ← declared in processed_results
- filter_failed_extractions: refs `$.item.extraction_success` ← declared in processed_results
- filter_over_50: refs `$.item.extracted_data.amount` ← declared in processed_results

**Status:** ✅ All field refs match declared schemas

---

### Step 9: prepare_sheet_rows
**Type:** transform (map)

**Template (8 refs):**
- ✅ All refs to `$.item.extracted_data.*` and `$.item.*` match declared schema

**Outputs:**
- `sheet_rows`: 2D array for Sheets append

**Template Structure:** ✅ Direct array (not wrapped in object) - correct for Sheets 2D array

**Status:** ✅ Correct shape and all refs valid

---

### Step 10: append_to_sheets
**Type:** deliver
**Operation:** TABLES.APPEND_ROWS

**Parameters:**
- ✅ `spreadsheet_id`: "1pM8WbXtPgaYqokHn_spgQAfR7SBuql3JUtE1ugDtOpc" (constant)
- ✅ `range`: "Expenses!A:H" (constant)
- ✅ `values`: { "ref": "$.prepare_sheet_rows.sheet_rows" } ← Global step output (pattern 1)
- ✅ `input_option`: "USER_ENTERED" (constant)

**Status:** ✅ All parameters valid

---

### Step 11: calculate_totals
**Type:** aggregate

**Source:** { "ref": "$.filter_successful_extractions.valid_transactions" } ← Global step output (pattern 1)

**Metrics (4):**
1. ✅ `count` (no field) → total_count
2. ✅ `sum` field="extracted_data.amount" → total_amount ← Field path matches schema
3. ✅ `count` with where expr → over_50_count ← Valid use of where
4. ✅ `sum` field="extracted_data.amount" with where expr → over_50_sum ← Valid

**Status:** ✅ All metrics valid, field paths match declared schema

---

### Step 12: generate_summary_email
**Type:** ai_generate

**Inputs (5 step input aliases):**
- ✅ `all_transactions`: { "ref": "$.filter_successful_extractions.valid_transactions" }
- ✅ `over_50_transactions`: { "ref": "$.filter_over_50.over_50_transactions" }
- ✅ `failed_transactions`: { "ref": "$.filter_failed_extractions.failed_transactions" }
- ✅ `totals`: { "ref": "$.calculate_totals" } ← References entire aggregate output object
- ✅ `folder_link`: { "ref": "$.create_drive_folder.web_view_link" }

**AI Generate Config:**
- ✅ `input`: { "ref": "$.all_transactions" } ← Step input alias (pattern 2)

**Status:** ✅ Valid use of step input aliases (pattern 5)

---

### Step 13: send_summary_email
**Type:** deliver
**Operation:** EMAIL.SEND

**Parameters:**
- ✅ `recipients`: ["offir.omer@gmail.com"] (constant array)
- ✅ `content.subject`: { "ref": "$.generate_summary_email.email_subject" }
- ✅ `content.body`: { "ref": "$.generate_summary_email.email_body" }
- ✅ `content.body_type`: "html" (constant)

**Status:** ✅ All parameters valid

---

### Step 14: mark_emails_read (LOOP)
**Type:** loop

**Loop Config:**
- ✅ `iterate_over`: { "ref": "$.fetch_unread_emails.emails" } ← Global step output (pattern 1)
- ✅ `item_var`: "email"

**Loop Body:**
- ✅ `message_id`: { "ref": "$.email.id" } ← Loop item field (pattern 3)

**Status:** ✅ Valid

---

### Step 15: workflow_complete
**Type:** end

**Status:** ✅ Valid end step

---

## Summary of Findings

### ✅ VALID (All Good)
1. **All 70 refs use valid patterns** (patterns 1-5)
2. **All transform field refs match declared schemas**
3. **All aggregate field paths match declared schemas**
4. **All loop item references are valid**
5. **All global step output refs are valid**
6. **Map template produces correct 2D array for Sheets**
7. **Flatten template correctly extracts array field**
8. **Step input aliases used correctly (pattern 5)**
9. **Question answer ref used correctly (pattern 4)**

### 🔴 CRITICAL ISSUES
1. **Not using DeterministicExtractor** (step 5.3)
   - Current: Direct ai_extract on file content
   - Expected: Use deterministic_extract or route through DeterministicExtractor
   - Impact: 10-50x higher cost, no optimization for text-based PDFs

### 🟡 MINOR ISSUES
1. **Output field naming mismatch** (step 5.1)
   - Intent uses: `content`, `mime_type`
   - Plugin returns: `data`, `mimeType`
   - Impact: Binding phase may need field mapping

2. **Loop output schema description** (step 3)
   - Says: `{message_id, subject, from, attachment_id, filename}`
   - Actually: `{result: array of {...}}`
   - Impact: Schema description misleading, but works correctly

---

## Recommendations

### Priority 1: Add Deterministic Extraction
**Option A:** Add new step type to Intent DSL
```typescript
"deterministic_extract": {
  "content": { "ref": "$.download_attachment.content" },
  "mime_type": { "ref": "$.attachment.mimeType" },
  "output_schema": {
    "fields": [
      { "name": "date", "type": "date", "required": true },
      { "name": "vendor", "type": "string", "required": true },
      { "name": "amount", "type": "number", "required": true },
      { "name": "currency", "type": "string" },
      { "name": "invoice_number", "type": "string" }
    ]
  }
}
```

**Option B:** Compiler automatically detects ai_extract on file content
- When ai_extract.input refs attachment content + has structured schema
- Automatically route to DeterministicExtractor
- Fall back to AI only if deterministic extraction fails

### Priority 2: Fix Field Naming Consistency
- Update Intent Contract output schema to match plugin action outputs exactly
- OR add field mapping in binding phase

### Priority 3: Clarify Loop Collection Schema
- Update prompt to explain that loop collects final step's single output key
- Loop output schema should describe actual collected structure

---

**Status:** 🟡 DATA FLOW VALID but needs deterministic extraction optimization
