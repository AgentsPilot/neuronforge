# Vendor Name Null Issue - Data Quality Problem

## Issue Summary
After fixing `file_url` → `file_content`, the workflow now fails at **step7** with:
```
google-drive get_or_create_folder failed: folder_name is required
```

## Root Cause
**Step7 config:** `"folder_name": "{{extracted_fields.vendor}}"`

**Problem:** Some PDFs don't contain vendor information, so `extracted_fields.vendor` is `null`/`undefined`. When this gets passed to the Google Drive plugin, it treats it as a missing required parameter.

## Why This Happens
1. Step6 (document-extractor) extracts fields from PDF: `{ vendor, date, amount, ... }`
2. If the PDF doesn't contain vendor info, `vendor` field is `null` or missing
3. Step7 tries to use `{{extracted_fields.vendor}}` as folder name
4. Variable resolves to empty string or `undefined`
5. Google Drive plugin rejects it: "folder_name is required"

## This Is NOT a Calibration Issue
This is a **workflow design issue**. The IntentContract generation or IR compilation should have:

1. **Recognized the data dependency:** "Create folder named after vendor" requires vendor to exist
2. **Added conditional logic:** Only create vendor-specific folder if vendor exists
3. **Added fallback value:** Use "Unknown Vendor" or "Unnamed" when vendor is missing
4. **Added validation step:** Check if required fields are present before using them

## Per CLAUDE.md Principles
> **Fix Issues at the Root Cause**
> When you identify an issue in the pipeline output (e.g., PILOT DSL), trace it back to its root cause.

This should be fixed in:
- **IntentContract generation** (Phase 1) - LLM should recognize this pattern and add conditional logic
- **IR compilation** (Phase 3) - Compiler should detect required field usage without validation
- **NOT in calibration** - Calibration fixes execution bugs, not design flaws

## Current Workaround Options

### Option 1: Add Transform Step (Best for now)
Add a step between step6 and step7 to ensure vendor is never null:

```json
{
  "id": "step6b",
  "type": "transform",
  "operation": "map",
  "input": "{{extracted_fields}}",
  "config": {
    "mapping": {
      "vendor": {
        "source": "vendor",
        "fallback": "Unknown Vendor"
      }
    }
  }
}
```

### Option 2: Modify Document Extraction Prompt
Update step6's extraction instruction to always return a vendor:
```
"If vendor name is not found, use 'Unknown Vendor' as the value"
```

### Option 3: Use Conditional Step
Wrap step7-9 in a conditional that only runs if vendor exists:
```json
{
  "type": "conditional",
  "condition": {
    "field": "extracted_fields.vendor",
    "operator": "exists"
  },
  "then": [/* steps 7-9 */],
  "else": [/* alternative: use default folder */]
}
```

### Option 4: Enhance Variable Resolution (Long-term)
Add fallback syntax support to the variable resolver:
```json
"folder_name": "{{extracted_fields.vendor || 'Unknown Vendor'}}"
```

## Calibration Enhancement
I've added detection for "X is required" errors that will:
1. Detect when a required parameter's variable resolved to null/empty
2. Create an issue marked `requiresUserInput: true`
3. Suggest adding a fallback value
4. **NOT auto-fix** because we don't know what fallback value the user wants

## Immediate Action Needed

**For this specific workflow**, the quickest fix is to modify the document extraction prompt in step6 to ensure vendor is never null. Let me create that fix:

```typescript
// In step6 config
{
  "instruction": "Extract invoice/expense fields. For vendor: extract merchant/company name. If not found in document, use 'Unknown Vendor'."
}
```

This ensures `extracted_fields.vendor` is always a string, never null.

## Files Modified
- `app/api/v2/calibrate/batch/route.ts` - Added detection for "X is required" pattern (lines 584-693)

## Next Steps
1. **Short-term:** Modify step6 extraction to never return null vendor
2. **Medium-term:** Add transform step to sanitize extracted fields
3. **Long-term:** Fix IntentContract generation to handle null field values properly
