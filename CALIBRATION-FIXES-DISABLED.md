# Calibration Auto-Fixes Disabled

**Date**: 2026-03-23
**Reason**: Execution layer now handles these issues automatically with schema-aware resolution

---

## Summary

After implementing schema-aware execution fixes, **most calibration auto-fixes are now redundant**. Execution can handle data flow automatically using output_schema + parameter schema.

## Disabled Auto-Fixes

### ❌ fix_flatten_field (DISABLED)

**What It Did**: Corrected flatten field paths
**Example**: Changed `field: "emails.attachments"` to `field: "attachments"`

**Why Disabled**:
- WorkflowValidator now generates correct paths from the start (includePathPrefixes=false)
- transformFlatten() has runtime detection for dot-notation fields
- Execution automatically uses last path segment if dots detected

**File Modified**: `/app/api/v2/calibrate/batch/route.ts:378-387`

**New Behavior**: Logs "SKIPPED: fix_flatten_field (execution handles this)"

---

### ❌ fix_operation_field (MOSTLY DISABLED)

**What It Did**: Corrected field paths in operations (filter, map, transform, flatten)

**Contexts Disabled**:
- ✅ **flatten** - Execution handles with runtime correction
- ✅ **filter** - Execution uses schema-aware resolution for condition fields
- ✅ **map** - Execution uses schema-aware resolution for source fields
- ✅ **transform** - Execution handles field extraction automatically

**Context Still Active**:
- ⚠️ **action_param** - ONLY for genuine parameter NAME mismatches (e.g., `file_url` → `file_content`)
  - Field paths still handled by execution
  - Parameter name validation kept because execution can't fix wrong names

**File Modified**: `/app/api/v2/calibrate/batch/route.ts:388-450`

**New Behavior**:
- Flatten/filter/map/transform: Logs "SKIPPED: fix_operation_field (execution handles this)"
- action_param: Only fixes parameter NAME mismatches (not field paths)

---

### ❌ Final Validation Fixes for Field Paths (DISABLED)

**What It Did**: Applied field path corrections in final validation stage

**Why Disabled**: Same reason - execution handles field paths automatically

**File Modified**: `/app/api/v2/calibrate/batch/route.ts:1189-1197`

**New Behavior**: Logs "SKIPPED: final validation fix for field path (execution handles this)"

---

## Auto-Fixes Still ACTIVE

### ✅ fix_parameter_reference (ACTIVE)

**What It Does**: Corrects variable references (e.g., `{{step1.data}}` → `{{step1.emails}}`)

**Why Still Needed**: Execution can't fix incorrect step references

**Stays Active**: YES

---

### ✅ parameter_rename (ACTIVE)

**What It Does**: Renames parameter keys (e.g., `file_url` → `file_content`)

**Why Still Needed**: Execution can't fix incorrect parameter names in plugin calls

**Stays Active**: YES (for parameter NAME validation only)

---

### ✅ Nullable Field Warnings (ACTIVE)

**What It Does**: Detects when nullable fields are used in required parameters

**Why Still Needed**: Execution can't invent values for null fields

**Stays Active**: YES

---

## Impact

### Before (Heavy Calibration):
- 50+ auto-fixes per workflow
- Fixing field extraction, flatten paths, filter conditions, etc.
- Many iterations to apply all fixes

### After (Light Calibration):
- 5-10 auto-fixes per workflow
- Only fixing parameter names and variable references
- Execution handles all field path resolution

### Benefits:
✅ Faster workflow execution (fewer calibration iterations)
✅ Simpler calibration logic (fewer fix types)
✅ Clearer separation: calibration = catch generation errors, execution = handle data flow
✅ More robust: execution uses schemas, not heuristics

---

## How Execution Now Handles These

### Field Path Resolution:
```typescript
// Flatten with dot-notation field
config.field = "emails.attachments"

// Execution detects dots and uses last segment
field = field.split('.').pop() // "attachments"
```

### Schema-Aware Extraction:
```typescript
// Variable reference to object
file_id: "{{drive_file}}"  // drive_file = {file_id: "123", ...}

// Execution checks:
// 1. Parameter expects: string
// 2. Variable resolves to: object
// 3. Object has field matching parameter name: file_id ✓
// 4. Auto-extracts: "123"
```

### Filter Field Resolution:
```typescript
// Filter condition with nested field
condition: {
  field: "extracted_fields.amount",  // Full nested path
  operator: ">=",
  value: "10"
}

// Execution resolves using schema to find field
// No calibration fix needed
```

---

## Testing

### Verify Calibration Skips Fixes:
1. Run calibration on Invoice Extraction workflow
2. Check logs for "SKIPPED: fix_flatten_field" messages
3. Check logs for "SKIPPED: fix_operation_field" messages
4. Verify workflow still executes successfully

### Verify Execution Handles Data Flow:
1. Run workflow execution
2. Check logs for "Schema-aware extraction" messages
3. Check logs for flatten field path warnings (if any)
4. Verify all steps complete successfully

---

## Rollback Plan

If execution fixes don't work as expected, re-enable calibration fixes by removing the new conditional checks:

**File**: `/app/api/v2/calibrate/batch/route.ts`
**Lines to Revert**: 378-450, 1189-1197

Simply replace the new skip logic with the original fix application logic.

---

## Related Documentation

- [EXECUTION-LAYER-FIXES-COMPLETE.md](EXECUTION-LAYER-FIXES-COMPLETE.md) - Details of execution fixes
- [CALIBRATION-VS-EXECUTION-ANALYSIS.md](CALIBRATION-VS-EXECUTION-ANALYSIS.md) - Analysis of what calibration should do

---

**Status**: ✅ Calibration fixes disabled
**Next Step**: Test workflow execution without calibration auto-fixes
