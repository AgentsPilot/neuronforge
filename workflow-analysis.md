# Workflow Analysis: Invoice/Expense Processing

## Overview
Analyzing the Gmail → Extract → Drive → Sheets workflow for potential issues.

## Issues Identified

### ✅ FIXED: Issue 1 - Base64url to Base64 Conversion
**Status:** FIXED in gmail-plugin-executor.ts
- Gmail returns base64url format (- and _ instead of + and /)
- Google Drive expects standard base64
- Fix: Added convertBase64UrlToBase64() method

---

### ⚠️ Issue 2 - Missing Email Metadata in Step 2
**Location:** Step 2 (transform/flatten)
**Problem:**
- Step 2's `custom_code` says "Extract attachments array from each email, preserving email metadata (sender, subject, message_id)"
- But the actual output schema only includes attachment fields, NOT email metadata
- This causes sender/subject/date to be LOST

**Current Flow:**
```
step1 (emails with from/subject/date)
  → step2 (supposed to preserve metadata)
  → step2a (flatten attachments)  ❌ METADATA LOST HERE
  → step5 (download attachment)
```

**Impact:**
- Step 10 tries to use `{{sender}}`, `{{subject}}`, `{{received_date}}`
- These variables don't exist because they were lost in step2a
- The final record will have null/undefined for these fields

**Fix Needed:**
Step 2's transform needs to actually preserve email metadata in the output structure:
```json
{
  "attachment_id": "...",
  "filename": "...",
  "sender": "{{email.from}}",
  "subject": "{{email.subject}}",
  "received_date": "{{email.date}}"
}
```

---

### ⚠️ Issue 3 - Wrong Parameter Name in Step 6
**Location:** Step 6 (extract_structured_data)
**Problem:**
```json
"params": {
  "file_url": "{{attachment_content.data}}"  ❌ WRONG PARAMETER
}
```

**Should be:**
```json
"params": {
  "file_content": "{{attachment_content.data}}",  ✅ CORRECT
  "mime_type": "{{attachment_content.mimeType}}",
  "filename": "{{attachment_content.filename}}"
}
```

**Impact:**
- document-extractor expects `file_content`, not `file_url`
- Has fallback logic to detect base64, but this is inefficient
- Missing mime_type means auto-detection runs

---

### ⚠️ Issue 4 - Step 9 Wrong Parameter
**Location:** Step 9 (share_file)
**Problem:**
```json
"params": {
  "file_id": "{{drive_file}}"  ❌ WRONG - passing entire object
}
```

**Should be:**
```json
"params": {
  "file_id": "{{drive_file.file_id}}"  ✅ CORRECT - extract file_id field
}
```

**Impact:**
- Passing entire drive_file object instead of just the file_id string
- Google Drive API will reject this

---

### ⚠️ Issue 5 - Step 14 Field Mapping Issues
**Location:** Step 14 (append_rows)
**Problem:**
```json
"params": {
  "fields": {
    "Date": "high_value_items.date",          ❌ Missing {{}}
    "Type": "high_value_items.type",
    "Amount": "high_value_items.amount",
    ...
  }
}
```

**Should be:**
```json
"params": {
  "fields": {
    "Date": "{{item.date}}",                  ✅ CORRECT
    "Type": "{{item.type}}",
    "Amount": "{{item.amount}}",
    ...
  }
}
```

**Impact:**
- Inside scatter-gather loop, items are accessed via `{{item.field}}`
- Using array name will try to insert the entire array instead of individual items

---

### ⚠️ Issue 6 - Step 12 Conditional Dependencies Missing
**Location:** Step 12 (conditional)
**Problem:**
```json
{
  "id": "step12",
  "type": "conditional",
  "dependencies": []  ❌ EMPTY - should depend on step11
}
```

**Should be:**
```json
{
  "id": "step12",
  "type": "conditional",
  "dependencies": ["step11"]  ✅ Depends on high_value_items
}
```

**Impact:**
- Step 12 might execute before step 11 completes
- Race condition on `high_value_items` availability

---

## Priority Fixes

### High Priority (Breaks workflow)
1. ✅ Issue 1 - Base64 conversion (FIXED)
2. ⚠️ Issue 4 - Step 9 file_id parameter
3. ⚠️ Issue 6 - Step 12 dependencies

### Medium Priority (Data quality issues)
4. ⚠️ Issue 2 - Email metadata preservation
5. ⚠️ Issue 5 - Step 14 field mappings

### Low Priority (Performance/best practices)
6. ⚠️ Issue 3 - Step 6 parameter naming

---

## Recommendations

### Immediate Actions
1. ✅ Apply base64 fix to gmail-plugin-executor.ts (DONE)
2. Fix step 9 parameter mapping in workflow DSL
3. Fix step 12 dependencies
4. Fix step 14 field references

### Workflow Generation Improvements
- Ensure metadata preservation in flatten operations
- Validate parameter names against plugin schemas
- Check variable scoping in loops (item vs array)
- Verify dependency chains are complete
