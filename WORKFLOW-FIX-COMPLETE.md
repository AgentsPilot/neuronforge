# Workflow Generation Fix - Complete ✅

## Problem Identified

The IntentContract generation (Phase 1) was producing workflows where the document extraction step used the wrong input variable:

**WRONG** (before fix):
```json
{
  "id": "extract_transaction_fields",
  "inputs": ["drive_file"],   // ❌ Upload output (has URLs, no bytes)
  "extract": {
    "input": "drive_file"      // ❌ Wrong!
  }
}
```

**CORRECT** (after fix):
```json
{
  "id": "extract_transaction_fields",
  "inputs": ["attachment_content"],  // ✅ Download output (has bytes)
  "extract": {
    "input": "attachment_content"     // ✅ Correct!
  }
}
```

## Root Cause

In [lib/agentkit/v6/intent/intent-system-prompt-v2.ts](lib/agentkit/v6/intent/intent-system-prompt-v2.ts:1159-1167), there was guidance that said:

> **Rule**: Always use the output from the step that produces the format needed by the next operation. If an extraction service expects a URL/link, use the upload output (which has URLs), not the download output (which has bytes).

This was **misleading** because it assumed extraction services can work with URLs, but our `document-extractor` plugin requires file bytes, not URLs.

## The Fix

Updated the prompt guidance to be more nuanced:

### Before:
```
**CRITICAL: Use the MOST RECENT output in the data flow chain:**
- Extract should use: the representation that the extraction service expects
- Rule: If an extraction service expects a URL/link, use the upload output
```

### After (lines 1159-1177):
```
**CRITICAL: Match the input format to what the next operation requires:**

**Rule for extraction/processing operations:**
Check what format the extraction/processing capability requires:

1. **If extraction requires file bytes/content** (most document extraction):
   - Use the download output (which has raw bytes/content)
   - Do NOT use upload output (which only has URLs/IDs)
   - Example: extract_structured_data from document domain typically needs bytes

2. **If extraction can work with URL/link** (some web-based services):
   - Use the upload output (which has URLs)

**When in doubt:** Default to using the output that contains the actual
content/bytes for extraction operations, not just metadata/references.
Storage outputs (from upload) typically lose the raw content.
```

## Why This Fix Is Correct (Following CLAUDE.md Principles)

✅ **Plugin-Agnostic**: Doesn't hardcode "document-extractor" or "Google Drive"

✅ **Generic Pattern**: Applies to ANY workflow with download → upload → extract pattern

✅ **Teaches Principle**: Explains the concept that storage outputs lose raw content

✅ **No Execution Logic**: Doesn't add deterministic rules to compiler - fixed at LLM generation phase

❌ **NOT Hardcoded**: Doesn't say "for document-extractor, use X" or "for Google Drive, use Y"

## Verification

After the fix, regenerating the workflow produces:

### Step8 Config (Correct):
```json
{
  "step_id": "step8",
  "plugin": "document-extractor",
  "action": "extract_structured_data",
  "config": {
    "file_content": "{{attachment_content}}",  // ✅ Download output (has bytes)
    "fields": [...]
  }
}
```

### Data Flow:
```
Step6 (download_attachment)
  → outputs: attachment_content { content: base64, filename, mime_type }

Step7 (upload_to_drive)
  → inputs: attachment_content
  → outputs: drive_file { file_id, web_view_link, name }

Step8 (extract_structured_data)
  → inputs: attachment_content  ✅ CORRECT (has bytes)
  → NOT drive_file  ❌ (only has URLs)
```

## Workflow Ready for Testing

The generated workflow in [output/vocabulary-pipeline/pilot-dsl-steps.json](output/vocabulary-pipeline/pilot-dsl-steps.json) is now correct and ready for execution.

### Both Fixes Confirmed:

1. ✅ **Step2 Flatten**: Has `"field": "attachments"` (line 58)
2. ✅ **Step8 Extract**: Has `"file_content": "{{attachment_content}}"` (line 189)

### Test Instructions:

Navigate to: http://localhost:3000/v2/sandbox/43ffbc8a-406d-4a43-9f3f-4e7554160eda

Click: "Start Test" or "Run Workflow"

### Expected Success Indicators:

- ✅ Step6: Downloads attachment with base64 content (thousands of chars)
- ✅ Step7: Uploads to Drive (file size > 0 B)
- ✅ Step8: Extracts invoice fields using DeterministicExtractor
  - Look for: "Document extraction complete"
  - Check: extractionMethod = "pdf-parse" or "textract"
  - Verify: fieldsExtracted > 0, confidence > 0
- ✅ Step16: Appends rows to Google Sheets
- ✅ Step18: Sends summary email

## Files Changed

1. **[lib/agentkit/v6/intent/intent-system-prompt-v2.ts](lib/agentkit/v6/intent/intent-system-prompt-v2.ts:1159-1177)**
   - Updated "Use the MOST RECENT output" guidance
   - Added nuanced rules for extraction/processing operations
   - Explains when to use download output vs upload output

2. **[lib/server/document-extractor-plugin-executor.ts](lib/server/document-extractor-plugin-executor.ts)** (already created)
   - Smart parameter handling: accepts base64 OR file object
   - Uses real DeterministicExtractor (not mock data)

3. **[lib/server/plugin-executer-v2.ts](lib/server/plugin-executer-v2.ts:45)** (already modified)
   - Registered document-extractor executor

4. **[lib/plugins/definitions/document-extractor-plugin-v2.json](lib/plugins/definitions/document-extractor-plugin-v2.json)** (already modified)
   - Added rules field
   - Updated parameter schema

5. **[lib/server/google-drive-plugin-executor.ts](lib/server/google-drive-plugin-executor.ts:629-654)** (already modified)
   - Fixed base64 encoding for file uploads

6. **[lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts](lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts:602-619)** (already modified)
   - Added flatten field extraction

## Next Steps

The workflow is now automatically generated correctly. No manual fixes needed!

Future pipeline runs will produce correct workflows thanks to the improved LLM prompt guidance.
