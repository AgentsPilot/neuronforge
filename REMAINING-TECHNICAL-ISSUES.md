# Remaining Technical Issues to Fix

**Date**: 2026-03-09
**Context**: Narrative prompts don't fix the real technical issues - here's what actually needs fixing

---

## TL;DR: The 5 Critical Gaps

Based on the plan file and actual test results:

1. ❌ **`fields` object not converted to `values` array** (Google Sheets append_rows)
2. ❌ **`tab_name` not transformed to `range` with A1 notation** (Google Sheets operations)
3. ❌ **Fuzzy matching causes false positives** (0.15 threshold too permissive)
4. ❌ **`x-context-binding` injection happens too late** (Phase 4 instead of Phase 3)
5. ❌ **No final PILOT DSL validation** (workflows pass validation but aren't executable)

---

## Issue #1: Fields Object Not Converted to Values Array

### The Problem

**Google Sheets `append_rows` expects**:
```json
{
  "values": [
    ["value1", "value2", "value3"]  // 2D array
  ]
}
```

**What we're generating**:
```json
{
  "fields": {
    "date_time": "{{record.date_time}}",
    "vendor": "{{record.vendor}}",
    "amount": "{{record.amount}}"
  }
}
```

**Result**: API error at runtime - "Expected values array, got fields object"

### Where to Fix

**File**: `lib/agentkit/v6/compiler/IntentToIRConverter.ts`
**Method**: `mapParamsToSchema()` (lines 1309-1413)

**Solution**:
```typescript
// FIFTH PASS: Convert fields mapping to values array if needed
if (genericParams.fields && paramSchema.properties.values) {
  const valuesParam = paramSchema.properties.values

  // Check if values parameter expects 2D array
  if (valuesParam.type === 'array' && valuesParam.items?.type === 'array') {
    // Convert fields object to single row array
    const fieldValues = Object.values(genericParams.fields)
    mappedParams.values = [fieldValues]

    this.log(`Converted fields object to values array (${fieldValues.length} columns)`)

    // Remove fields from output
    delete genericParams.fields
  }
}
```

### Impact

**Affected Workflows**: ALL workflows that append to Google Sheets
- Expense extraction
- Complaint logger
- Any data collection workflow

**Severity**: 🔴 **CRITICAL** - 100% runtime failure

---

## Issue #2: Tab Name Not Transformed to Range with A1 Notation

### The Problem

**Google Sheets `read_range` expects**:
```json
{
  "range": "SheetName!A:Z"  // A1 notation with sheet name
}
```

**What we're generating**:
```json
{
  "spreadsheet_id": "{{config.expense_sheet_id}}",
  // Missing: range parameter
}
```

**OR sometimes**:
```json
{
  "spreadsheet_id": "{{config.expense_sheet_id}}",
  "tab_name": "{{config.sheet_tab_name}}"  // Wrong parameter name
}
```

**Result**: API error - "Missing required parameter: range"

### Where to Fix

**File**: `lib/agentkit/v6/compiler/IntentToIRConverter.ts`
**Method**: `mapParamsToSchema()` (lines 1309-1413)

**Solution**:
```typescript
// FOURTH PASS: Apply format transformations
for (const [paramName, paramDef] of Object.entries(paramSchema.properties)) {
  const artifactField = paramDef['x-artifact-field']

  // If parameter needs value from artifact field, apply transformation
  if (artifactField && !mappedParams[paramName]) {
    // Look for source parameter with artifact field name
    const sourceParam = Object.entries(mappedParams).find(([k, v]) =>
      k === artifactField || k.includes(artifactField)
    )

    if (sourceParam) {
      const [_, sourceValue] = sourceParam

      // For Google Sheets range parameter, add A1 notation
      if (paramName === 'range' && typeof sourceValue === 'string') {
        // If value is config reference, keep it as reference with A1 notation
        if (sourceValue.includes('{{config.')) {
          mappedParams[paramName] = sourceValue // Already correct format
        } else {
          mappedParams[paramName] = `${sourceValue}!A:Z`
        }
        this.log(`Transformed ${artifactField} → ${paramName} with A1 notation`)
      }
    }
  }
}
```

### Impact

**Affected Workflows**: ALL workflows that read from Google Sheets
- Lead sales follow-up
- Expense extraction
- Any workflow reading sheet data

**Severity**: 🔴 **CRITICAL** - 100% runtime failure

---

## Issue #3: Fuzzy Matching Causes False Positives

### The Problem

**File**: `ExecutionGraphCompiler.ts` (line 3485)
```typescript
const fuzzyMatch = this.findBestConfigMatch(configKey, ctx.workflowConfig, 0.15, ctx)
//                                                                         ^^^^ TOO LOW
```

**Result**:
- `insert_data_option` (optional param) matched to `data_time_window` (config key)
- Score: 0.15 (15% similarity)
- Causes incorrect parameter injection

### Where to Fix

**File**: `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts`
**Lines**: 3457-3502 (third pass auto-injection)

**Solution**: Remove third pass entirely OR increase threshold to 0.5

```typescript
// Option 1: Remove third pass (recommended)
// REMOVE lines 3457-3502
// Reason: IntentToIRConverter should handle all parameter mapping

// Option 2: Increase threshold (if keeping third pass)
const fuzzyMatch = this.findBestConfigMatch(configKey, ctx.workflowConfig, 0.5, ctx)
//                                                                         ^^^^ Changed from 0.15
```

### Impact

**Affected Workflows**: Any workflow with optional parameters
- Creates confusing/wrong parameter mappings
- Hard to debug (why is this parameter set?)

**Severity**: 🟡 **MEDIUM** - Workflows may work but with unexpected behavior

---

## Issue #4: x-context-binding Injection Happens Too Late

### The Problem

**Current Flow**:
1. Phase 3 (IntentToIRConverter): Does NOT apply x-context-binding
2. Phase 4 (ExecutionGraphCompiler): Applies x-context-binding with fuzzy matching

**Why This Is Bad**:
- Fuzzy matching causes false positives (Issue #3)
- Config injection should be deterministic, not fuzzy
- Phase 3 already has the plugin schema - should do it there

### Where to Fix

**File**: `lib/agentkit/v6/compiler/IntentToIRConverter.ts`
**Method**: `mapParamsToSchema()` (lines 1309-1413)

**Solution**:
```typescript
// THIRD PASS: Inject workflow config parameters via x-context-binding
for (const [paramName, paramDef] of Object.entries(paramSchema.properties)) {
  if (mappedParams[paramName]) continue // Already set

  if (paramDef['x-context-binding']) {
    const binding = paramDef['x-context-binding']
    const configKey = binding.key

    // Look up in workflow config (from IntentContract.config)
    const configParam = ctx.config?.find(c => c.key === configKey)
    if (configParam) {
      mappedParams[paramName] = `{{config.${configKey}}}`
      this.log(`Injected ${paramName} from config: {{config.${configKey}}}`)
    }
  }
}
```

**Then remove fuzzy matching from ExecutionGraphCompiler** (line 3436)

### Impact

**Affected Workflows**: ALL workflows using config parameters
- Currently works but with unreliable fuzzy matching
- Fix makes it deterministic and reliable

**Severity**: 🟡 **MEDIUM** - Improves reliability and debuggability

---

## Issue #5: No Final PILOT DSL Validation

### The Problem

**Current Validation** (`validate-narrative-workflow.ts`):
- Checks data flow (variables declared before use)
- Checks loop structure
- Checks conditionals
- Checks parameter presence
- **Does NOT check parameter values against plugin schemas**

**Result**:
- Workflow passes validation with "0 errors"
- But has wrong parameter formats (fields vs values)
- Runtime failure when executed

### Example

**Validation says**: ✅ `append_rows` has required parameters: `spreadsheet_id`, `range`, `values`

**Reality**: ❌ `values` has wrong format (object instead of 2D array)

### Where to Fix

**File**: `scripts/validate-narrative-workflow.ts` (or create new validator)

**Solution**: Add Phase 7 - PILOT DSL Schema Validation

```typescript
async validatePilotDslAgainstSchemas(steps: any[], pluginManager: any): Promise<ValidationIssue[]> {
  const errors: ValidationIssue[] = []

  for (const step of steps) {
    if (step.type === 'action') {
      const plugin = pluginManager.getPlugin(step.plugin)
      const action = plugin?.actions?.[step.operation]

      if (!action) continue

      // Check all required parameters present AND have correct types
      const required = action.parameters?.required || []
      for (const paramName of required) {
        const paramValue = step.config[paramName]
        const paramSchema = action.parameters.properties[paramName]

        if (!paramValue) {
          errors.push({
            severity: 'error',
            category: 'missing_parameter',
            step_id: step.step_id,
            message: `Missing required parameter '${paramName}'`
          })
        } else {
          // Validate parameter type matches schema
          const typeValid = this.validateParameterType(paramValue, paramSchema)
          if (!typeValid) {
            errors.push({
              severity: 'error',
              category: 'parameter_type_mismatch',
              step_id: step.step_id,
              message: `Parameter '${paramName}' has wrong type/format. Expected: ${JSON.stringify(paramSchema.type)}`
            })
          }
        }
      }
    }
  }

  return errors
}
```

### Impact

**Affected Workflows**: ALL workflows
- Catches issues before runtime
- Prevents declaring "0 errors" when workflow is broken

**Severity**: 🟡 **MEDIUM** - Improves confidence in validation

---

## Prioritized Fix Order

### Priority 1: Critical Runtime Failures (Fix First)

1. **Issue #1**: Fields → Values conversion (Google Sheets append)
   - **Impact**: 100% runtime failure for append operations
   - **Effort**: 2-3 hours
   - **File**: `IntentToIRConverter.ts`

2. **Issue #2**: Tab name → Range transformation (Google Sheets read)
   - **Impact**: 100% runtime failure for read operations
   - **Effort**: 2-3 hours
   - **File**: `IntentToIRConverter.ts`

**Total Effort**: 4-6 hours
**Benefit**: Makes ALL Google Sheets workflows executable

### Priority 2: Reliability Improvements (Fix Second)

3. **Issue #4**: Move x-context-binding to IntentToIRConverter
   - **Impact**: More reliable config injection
   - **Effort**: 3-4 hours
   - **File**: `IntentToIRConverter.ts` + `ExecutionGraphCompiler.ts`

4. **Issue #3**: Remove/fix fuzzy matching
   - **Impact**: No more false positive parameter matches
   - **Effort**: 1-2 hours
   - **File**: `ExecutionGraphCompiler.ts`

**Total Effort**: 4-6 hours
**Benefit**: Deterministic parameter mapping, easier debugging

### Priority 3: Validation Enhancement (Fix Third)

5. **Issue #5**: Add final PILOT DSL validation
   - **Impact**: Catch issues before declaring success
   - **Effort**: 4-6 hours
   - **File**: New validator or enhance existing

**Total Effort**: 4-6 hours
**Benefit**: No more false confidence in broken workflows

---

## Total Effort Estimate

**All 5 Issues**: 12-18 hours (~2-3 days of focused work)

**Quick Win** (Priority 1 only): 4-6 hours (~1 day)

---

## Testing Plan After Fixes

### Test Suite

1. **Lead Sales Follow-up** (currently passing)
   - Should still pass with 0 errors
   - Verify Google Sheets read works

2. **Expense Extraction** (currently 1 error - config key)
   - Should pass with 0 errors after fixes
   - Verify Google Sheets read + append work

3. **Expense Summary** (currently passing)
   - Should still pass with 0 errors
   - Verify document extraction + email work

4. **Complaint Logger** (from plan file - had issues)
   - Should now pass with 0 errors
   - Test all parameter transformations

### Runtime Execution Tests

**After validation passes**:
- Test with REAL Google Sheets
- Test with REAL Gmail data
- Test with REAL document extraction

**Goal**: 100% of validated workflows execute successfully at runtime

---

## Bottom Line

**The narrative approach helps with UX, but these 5 technical issues need fixing regardless of prompt format.**

**Recommendation**:
1. ✅ Keep narrative approach (good UX)
2. ✅ Fix Priority 1 issues (4-6 hours) → makes workflows executable
3. ✅ Fix Priority 2 issues (4-6 hours) → makes workflows reliable
4. ✅ Fix Priority 3 issues (4-6 hours) → makes validation trustworthy

**Total**: 12-18 hours to complete the V6 pipeline parameter mapping system.
