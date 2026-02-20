# Drive Upload Filename Bug - February 19, 2026

## Problem Statement

**Observed Behavior:**
Files uploaded to Google Drive are all named "attachment" without the actual filename (invoice.pdf, receipt.pdf, etc.)

**Screenshot Evidence:**
All files show as:
- Name: "attachment" (no extension)
- Icon: Google Docs (blue) instead of PDF
- Sizes vary (226 KB, 11.5 MB, 5.1 MB, etc.) - content IS uploading
- All have generic name despite having different original filenames

**Expected Behavior:**
Files should be uploaded with their original filenames from the email attachments.

---

## Root Cause Analysis

### Step-by-Step Flow:

**Step 3:** Search emails with attachments
```json
{
  "action": "search_messages",
  "params": {
    "query": "has:attachment",
    "include_attachments": true  // Returns attachment metadata
  }
}
```
Returns: `emails_result.emails[]` where each email has `attachments[]` with:
- `filename` ✅
- `mimeType` ✅
- `attachment_id` ✅
- `message_id` ✅

**Step 4:** Loop over `current_email.attachments`
```json
{
  "type": "scatter_gather",
  "scatter": {
    "input": "{{current_email.attachments}}"  // Each iteration = current_attachment
  }
}
```
Loop variable `current_attachment` contains:
- `current_attachment.filename` ✅ (e.g., "invoice.pdf")
- `current_attachment.mimeType` ✅ (e.g., "application/pdf")
- `current_attachment.attachment_id` ✅

**Step 5:** Get attachment content (BUGGY)
```json
{
  "action": "get_email_attachment",
  "params": {
    "message_id": "{{current_email.id}}",
    "attachment_id": "{{current_attachment.attachment_id}}"
    // ❌ MISSING: "filename": "{{current_attachment.filename}}"
  },
  "output_variable": "attachment_content"
}
```

**Gmail Plugin Definition says:**
```json
{
  "filename": {
    "type": "string",
    "description": "Original filename for reference (optional but recommended)"
  }
}
```

When `filename` is NOT provided, the Gmail handler likely:
- Downloads the attachment by ID
- Returns generic metadata
- Doesn't include the original filename in the response

**Step 7:** Upload to Drive (tries to use missing filename)
```json
{
  "action": "upload_file",
  "params": {
    "file_name": "{{attachment_content.filename}}",  // ❌ EMPTY/NULL
    "mime_type": "{{attachment_content.mimeType}}",   // ❌ EMPTY/NULL
    "file_content": "{{attachment_content.data}}"     // ✅ Has data
  }
}
```

Result: File uploads with default name "attachment" and no MIME type.

---

## The Bug

**Location:** Workflow generation (IR compiler or formalization)

**Issue:** When generating `get_email_attachment` action inside a loop over attachments, the compiler/IR generator is NOT passing the `filename` parameter even though it's available from `current_attachment.filename`.

**Should Generate:**
```json
{
  "action": "get_email_attachment",
  "params": {
    "message_id": "{{current_email.id}}",
    "attachment_id": "{{current_attachment.attachment_id}}",
    "filename": "{{current_attachment.filename}}"  // ← ADD THIS
  }
}
```

---

## Fix Options

### Option 1: Fix Compiler to Add Filename Parameter ⭐ RECOMMENDED

**File:** `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts`

**Logic:** When compiling `get_email_attachment` action:
1. Check if it's inside a loop over email attachments
2. If loop variable contains `filename` field
3. Auto-add `filename` parameter to the action params

**Pros:**
- Fixes all workflows automatically
- Follows "optional but recommended" guidance
- No prompt changes needed

**Cons:**
- Requires compiler logic update
- Need to detect loop context

---

### Option 2: Update Formalization Prompt

**File:** `lib/agentkit/v6/semantic-plan/prompts/formalization-system-v4.md`

**Add guidance:**
```markdown
#### Gmail Attachment Processing Pattern

When looping over email attachments:

**Step 1: Get attachment metadata** (from search_messages with include_attachments:true)
**Step 2: Download attachment content**

ALWAYS include the filename parameter for context preservation:

```json
{
  "operation_type": "fetch",
  "fetch": {
    "plugin_key": "google-mail",
    "action": "get_email_attachment",
    "config": {
      "message_id": "{{current_email.id}}",
      "attachment_id": "{{current_attachment.attachment_id}}",
      "filename": "{{current_attachment.filename}}"  // ✅ REQUIRED for metadata preservation
    }
  }
}
```
```

**Pros:**
- LLM learns the pattern
- Applies to future workflows

**Cons:**
- Doesn't fix existing workflows
- Relies on LLM following instructions

---

### Option 3: Fix Gmail Handler to Preserve Filename

**File:** Wherever Gmail `get_email_attachment` is implemented

**Logic:** When downloading attachment:
1. If `filename` param is provided → include in response
2. If NOT provided → try to get filename from Gmail API metadata

**Pros:**
- Defensive coding
- Works even without compiler fix

**Cons:**
- Extra API call to get filename
- Band-aid solution

---

### Option 4: Use current_attachment Directly in Drive Upload

**Change Step 7:**
```json
{
  "action": "upload_file",
  "params": {
    "file_name": "{{current_attachment.filename}}",     // ← Use loop variable directly
    "mime_type": "{{current_attachment.mimeType}}",     // ← Use loop variable directly
    "file_content": "{{attachment_content.data}}"
  }
}
```

**Pros:**
- Simple workaround
- Uses data we already have

**Cons:**
- Relies on loop variable being in scope (our fix!)
- Doesn't fix the root cause
- Attachment metadata might not match downloaded content

---

## Recommended Solution: Combination Approach

### Phase 1: Immediate Fix (Compiler)

Add logic to `ExecutionGraphCompiler.ts` when compiling Gmail `get_email_attachment`:

```typescript
// In compileActionOperation or similar
if (operation.fetch?.action === 'get_email_attachment') {
  // Check if we're in a loop over attachments
  const loopContext = this.getLoopContext(ctx)
  if (loopContext?.iterationVariable && loopContext.input.includes('attachments')) {
    // Auto-add filename if not present
    if (!resolvedConfig.fetch?.config?.filename) {
      resolvedConfig.fetch.config.filename = `{{${loopContext.iterationVariable}.filename}}`
    }
  }
}
```

### Phase 2: Update Prompt (Long-term)

Add pattern documentation to formalization system prompt showing:
- ALWAYS pass filename to `get_email_attachment`
- Preserves metadata through the workflow
- Required for proper Drive uploads

### Phase 3: Handler Improvement (Defensive)

Update Gmail handler to:
- Include filename in response even if not in params
- Get from Gmail API metadata if needed
- Fallback to "attachment" only as last resort

---

## Testing Checklist

After fix:

- [ ] Regenerate workflow with same prompt
- [ ] Check step5 includes `filename` parameter
- [ ] Run workflow end-to-end
- [ ] Verify files upload with correct names (invoice.pdf, receipt.pdf)
- [ ] Verify MIME types are set correctly (shows PDF icon, not Docs)
- [ ] Verify file content is intact (files open correctly)
- [ ] Test with different file types (PDF, PNG, DOCX)

---

## Related Issues

This bug is related to (but separate from):
1. PDF extraction bug - AI processing binary instead of text
2. Variable scope bug in conditionals (FIXED)

All three issues stem from workflow generation not properly handling file/attachment processing patterns.

---

## Impact

**Severity:** 🟡 MEDIUM
- Files ARE uploading (content is there)
- But metadata is lost (filename, MIME type)
- User has to manually rename files
- Files may not open correctly without MIME type

**Frequency:** HIGH
- Affects ALL email attachment processing workflows
- Any workflow that uploads attachments to Drive

---

## Files to Modify

1. `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts` - Add filename auto-fill logic
2. `lib/agentkit/v6/semantic-plan/prompts/formalization-system-v4.md` - Add pattern documentation
3. Gmail handler (wherever it's implemented) - Defensive filename handling

---

## Next Steps

1. Locate Gmail `get_email_attachment` handler implementation
2. Implement compiler fix to auto-add filename parameter
3. Test with current workflow
4. Update formalization prompt with pattern
5. Regenerate workflow to verify fix
