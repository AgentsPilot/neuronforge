# Issue #4: Hardcoded spreadsheet_id - FIXED ✅

**Date**: 2026-03-03
**Issue**: Step 16 hardcodes spreadsheet_id instead of using config reference
**Status**: FIXED in ExecutionGraphCompiler

---

## The Problem

**Step 14** correctly uses:
```json
{
  "spreadsheet_id": "{{config.google_sheet_id}}"
}
```

But **Step 16** was hardcoding:
```json
{
  "spreadsheet_id": "1pM8WbXtPgaYqokHn_spgQAfR7SBuql3JUtE1ugDtOpc"
}
```

This broke config-driven design - changing `config.google_sheet_id` would only affect Step 14, not Step 16.

---

## Root Cause

**Phase**: 4 (ExecutionGraphCompiler)
**File**: [ExecutionGraphCompiler.ts](lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts:3384-3388)

The compiler's `normalizeActionConfigWithSchema()` function reads `x-context-binding` from plugin schemas and injects the **actual config value** instead of a **config reference**.

### Before (Line 3386):
```typescript
if (configVal !== undefined) {
  // Inject value from workflow config
  normalized[paramName] = configVal  // ❌ HARDCODES THE VALUE!
  this.log(ctx, `  → Injected '${paramName}' from workflow config: ${matchedKey} = ${configVal}`)
  continue
}
```

This took the default value `"1pM8WbXtPgaYqokHn_spgQAfR7SBuql3JUtE1ugDtOpc"` from `config.google_sheet_id` and hardcoded it directly.

---

## The Fix

### After (Line 3386):
```typescript
if (configVal !== undefined) {
  // CRITICAL FIX: Create a config REFERENCE, not a hardcoded value
  // This ensures workflows remain config-driven and reusable
  normalized[paramName] = `{{config.${matchedKey}}}`
  this.log(ctx, `  → Bound '${paramName}' to config reference: {{config.${matchedKey}}}`)
  continue
}
```

Now it generates `"{{config.google_sheet_id}}"` instead of the hardcoded value.

---

## Impact

**Before Fix:**
```json
// Step 16
{
  "spreadsheet_id": "1pM8WbXtPgaYqokHn_spgQAfR7SBuql3JUtE1ugDtOpc"  // Hardcoded!
}
```

**After Fix:**
```json
// Step 16
{
  "spreadsheet_id": "{{config.google_sheet_id}}"  // Config reference ✅
}
```

**Benefits:**
1. ✅ Workflows are now truly config-driven
2. ✅ Users can change `google_sheet_id` in one place
3. ✅ Workflows are reusable across different spreadsheets
4. ✅ No deployment-specific values embedded in PILOT DSL

---

## Why This Scales

This fix works for ANY parameter with `x-context-binding` in ANY plugin schema:

- `google-sheets.append_rows.spreadsheet_id` → `{{config.google_sheet_id}}`
- `google-drive.upload_file.folder_id` (if it had x-context-binding) → `{{config.default_folder_id}}`
- Custom plugins with config bindings → always generate references

The compiler now correctly treats `x-context-binding` as a **reference mechanism**, not a **value injection mechanism**.

---

## Testing

Run the complete pipeline test to verify:

```bash
npx tsx scripts/test-complete-pipeline-with-vocabulary.ts
```

**Expected Result:**
```json
// output/vocabulary-pipeline/pilot-dsl-steps.json - Step 16
{
  "step_id": "step16",
  "plugin": "google-sheets",
  "operation": "append_rows",
  "config": {
    "spreadsheet_id": "{{config.google_sheet_id}}",  // ✅ Not hardcoded!
    "fields": {...}
  }
}
```

---

## Remaining Issues to Address

This fix resolves **Issue #4** from the OpenAI feedback. Remaining issues:

### Priority 1 (CRITICAL - Requires IntentContract Prompt Fix)
- **Issue #1**: Step 2 flatten output must guarantee `message_id`, `attachment_id`, `filename` fields
- **Issue #3**: Step 8 map output must guarantee `email_sender`, `email_subject`, `drive_link` fields

**Fix Required**: Update IntentContract generation system prompt to require `output_schema` for transforms when downstream steps reference fields.

### Priority 2 (MEDIUM - Validation Enhancement)
- **Issue #2**: Validate that `drive_file.web_view_link` exists in Drive plugin output schema

**Fix Required**: Add field existence validation in IntentToIRConverter when creating field references.

### Priority 3 (LOW - Optimization)
- **Issue #5**: Include `total_count` and `total_amount` in Step 17 AI inputs

**Fix Required**: Either use `transaction_metrics` object or list aggregate outputs explicitly in inputs.

---

## Files Modified

**1 file changed, 4 insertions(+), 2 deletions(-)**

```diff
lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts | 6 ++++--
```

**Changes:**
- Line 3385-3387: Changed from value injection to config reference generation
- Added comment explaining why this is critical for config-driven workflows

---

## Architecture Principle Alignment

✅ **No Hardcoding**: Generates references, not hardcoded values
✅ **Config-Driven**: Preserves workflow configurability
✅ **Schema-Driven**: Uses `x-context-binding` correctly as reference mechanism
✅ **Scalable**: Works for any plugin parameter with context bindings
✅ **Fix at Root Cause**: Fixed in the compiler phase that was responsible

---

## Summary

Issue #4 is now **FIXED**. The compiler no longer hardcodes config values when processing `x-context-binding` in plugin schemas. All config parameters now generate proper `{{config.key}}` references, making workflows fully config-driven and reusable.

**Next Steps**: Address Issues #1 and #3 by updating the IntentContract generation system prompt to require `output_schema` for transform steps.
