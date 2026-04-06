# Complete Workflow Analysis - Invoice Processing Pipeline

## Issues Found

### 🔴 CRITICAL ISSUE #1: Step 9 - Unknown Plugin/Operation

**Location**: [step9](line 171-181)
```json
{
  "step_id": "step9",
  "type": "action",
  "description": "Retrieve source email metadata (sender, subject)",
  "plugin": "unknown",
  "operation": "unknown",
  "config": {
    "input_ref": "{{attachment}}"
  }
}
```

**Problem**: This step tries to get email metadata (sender, subject) from `attachment`, but there's no such action.

**Why it exists**: The LLM generated a `get_email_metadata` transform in the IntentContract that was supposed to find the email matching `attachment.message_id` and extract sender/subject. The IntentToIRConverter doesn't know how to handle this custom transform, so it creates an "unknown" action.

**Impact**: 
- Step 9 will FAIL at runtime
- Step 10 depends on `source_email` output, which won't exist
- `transaction_record.sender` and `transaction_record.subject` will be missing/null

**Solution**: This data is already available! The `unread_emails` from step 1 has all email metadata. We need to either:
1. Pass `unread_emails` into the loop and lookup the matching email by `message_id`
2. OR better: Include sender/subject in the flatten step (step 2) so each attachment already has this metadata

### 🔴 CRITICAL ISSUE #2: Step 16 - Incorrect append_rows usage

**Location**: [step16](line 324-345)
```json
{
  "step_id": "step16",
  "operation": "append_rows",
  "config": {
    "fields": {
      "Date": "{{high_value_transactions.date}}",
      "Vendor": "{{high_value_transactions.vendor}}",
      ...
    }
  }
}
```

**Problem**: `append_rows` expects an array of rows, but this is referencing fields from the entire `high_value_transactions` array as if it's a single object.

**What should happen**: Loop over `high_value_transactions` and append each transaction as a row.

**Impact**: This will likely append a single malformed row or fail entirely.

**Expected from IntentContract**: There was a nested loop `append_to_sheets` that loops over `high_value_transactions` and calls `append_rows` for each transaction. This got flattened incorrectly.

### 🟡 WARNING #3: Step 14 - Wrong operation for sheet tab creation

**Location**: [step14](line 302-312)
```json
{
  "description": "Get or create Google Sheets spreadsheet",
  "operation": "read_range",
  "config": {
    "spreadsheet_id": "{{config.google_sheet_id}}"
  }
}
```

**Problem**: The IntentContract wanted to create/get a sheet TAB (using `get_or_create_sheet_tab`), but this is using `read_range` which just reads data.

**Why**: The binding was correct (`get_or_create_sheet_tab`), but the compiler changed it to `read_range` for some reason.

**Impact**: 
- Sheet tab might not exist
- Reading empty sheet returns no data
- Step 15 (`rows_to_objects`) operates on potentially empty data

### 🟡 WARNING #4: Missing outer loop variable access

**Location**: [step5 scatter_gather](line 98-243)

**Problem**: Inside the loop, we reference `{{drive_folder.folder_id}}` (step 7), but `drive_folder` is created OUTSIDE the loop (step 4). 

**Status**: This SHOULD work - outer loop variables should be accessible inside the loop body. Need to verify the runtime supports this.

### 🟢 CORRECT: Schema validator fixed field names

**Location**: [step2](line 16-56) and [step6](line 104-116)

✅ Flatten output has correct fields: `attachment_id`, `message_id`, `filename`, `mimeType`, `size`
✅ Step 6 correctly references `{{attachment.message_id}}`, `{{attachment.attachment_id}}`, `{{attachment.filename}}`

This was auto-fixed by SchemaCompatibilityValidator!

### 🟢 CORRECT: Filter conditions normalized

**Location**: [step3](line 58-82)

✅ Filter uses `item.mimeType` (correct for iteration context)
✅ Operator is `in` (correct for array matching)

### 🟢 CORRECT: Config references

All config references use `{{config.key}}` format:
- ✅ `{{config.amount_threshold_usd}}` (steps 12, 13)
- ✅ `{{config.google_sheet_id}}` (steps 14, 16)
- ✅ `{{config.sheet_tab_name}}` (step 16)
- ✅ `{{config.user_email}}` (step 20)

## Data Flow Validation

### Step-by-Step Variable Dependencies

| Step | Output | Depends On | Status |
|------|--------|------------|--------|
| 1 | unread_emails | - | ✅ OK |
| 2 | all_attachments | unread_emails | ✅ OK |
| 3 | candidate_attachments | all_attachments | ✅ OK |
| 4 | drive_folder | - | ✅ OK |
| 5-6 | attachment_content | attachment (loop item) | ✅ OK |
| 5-7 | drive_file | attachment_content, drive_folder | ✅ OK (outer var) |
| 5-8 | extracted_fields | drive_file | ✅ OK |
| 5-9 | source_email | attachment | ❌ FAILS - unknown op |
| 5-10 | transaction_record | extracted_fields, source_email, drive_file, attachment | ❌ FAILS - missing source_email |
| 5 | processed_transactions | - | ❌ INCOMPLETE |
| 11 | valid_transactions | processed_transactions | ❌ INCOMPLETE |
| 12 | high_value_transactions | valid_transactions | ❌ INCOMPLETE |
| 13 | low_value_transactions | valid_transactions | ❌ INCOMPLETE |
| 14 | expense_sheet | config | ⚠️ WRONG OP |
| 15 | expense_sheet_objects | expense_sheet | ⚠️ DEPENDS ON 14 |
| 16 | sheet_append_result | high_value_transactions | ❌ WRONG USAGE |
| 17 | total_count | valid_transactions | ❌ INCOMPLETE |
| 18 | total_amount | valid_transactions | ❌ INCOMPLETE |
| 19 | summary_content | valid_transactions, high_value_transactions, total_count, total_amount | ❌ ALL INCOMPLETE |
| 20 | - | summary_content, config | ❌ INCOMPLETE |

## Root Cause Analysis

All the critical issues trace back to **Phase 3: Intent → IR Conversion**:

1. **Unknown operation (step 9)**: IntentToIRConverter doesn't know how to handle the `get_email_metadata` custom transform from IntentContract
2. **Wrong append_rows usage (step 16)**: The nested loop structure in IntentContract (`append_to_sheets` → `write_transaction_row`) was NOT preserved
3. **Wrong sheet operation (step 14)**: The bound action was `get_or_create_sheet_tab` but compiler changed it to `read_range`

## Recommendations

### Fix #1: Handle email metadata in flatten (step 2)

The flatten step should include sender and subject from the parent email:

```json
{
  "output_schema": {
    "items": {
      "properties": {
        "attachment_id": {"type": "string"},
        "message_id": {"type": "string"},
        "filename": {"type": "string"},
        "mimeType": {"type": "string"},
        "size": {"type": "number"},
        "sender": {"type": "string"},        // FROM PARENT EMAIL
        "subject": {"type": "string"}        // FROM PARENT EMAIL
      }
    }
  }
}
```

**Where to fix**: IntentToIRConverter flatten handling OR prompt guidance for LLM to include parent fields

### Fix #2: Preserve nested loop structure (step 16)

The `append_to_sheets` loop should be preserved as a scatter_gather:

```json
{
  "step_id": "step16",
  "type": "scatter_gather",
  "scatter": {
    "input": "{{high_value_transactions}}",
    "steps": [
      {
        "step_id": "step16_1",
        "operation": "append_rows",
        "config": {
          "spreadsheet_id": "{{config.google_sheet_id}}",
          "range": "{{config.sheet_tab_name}}",
          "fields": {
            "Date": "{{transaction.date}}",
            "Vendor": "{{transaction.vendor}}",
            ...
          }
        }
      }
    ],
    "itemVariable": "transaction"
  }
}
```

**Where to fix**: IntentToIRConverter loop handling - nested loops in IntentContract must be preserved

### Fix #3: Preserve bound action (step 14)

```json
{
  "step_id": "step14",
  "operation": "get_or_create_sheet_tab",  // NOT read_range
  "config": {
    "spreadsheet_id": "{{config.google_sheet_id}}",
    "tab_name": "{{config.sheet_tab_name}}"
  }
}
```

**Where to fix**: IntentToIRConverter artifact handling OR ExecutionGraphCompiler

## Execution Prediction

If this workflow runs AS-IS:

1. ✅ Steps 1-4: Will succeed
2. ✅ Steps 5-8 (in loop): Will succeed for each attachment
3. ❌ Step 9: **FAILS** - unknown operation
4. ❌ Step 10: **FAILS** - missing `source_email` dependency
5. ❌ Step 5 gather: **FAILS** - loop didn't complete successfully
6. ❌ Steps 11-20: **ALL FAIL** - depend on `processed_transactions` which is incomplete

**Result**: Workflow will partially execute (download and upload files to Drive), then fail. No transaction data will be logged to Sheets, no summary email will be sent.

## Priority Fixes

1. 🔴 **HIGH**: Fix step 9 email metadata retrieval
2. 🔴 **HIGH**: Fix step 16 nested loop for append_rows
3. 🟡 **MEDIUM**: Fix step 14 to use correct sheet tab operation
4. 🟢 **LOW**: Verify outer loop variable access works at runtime

