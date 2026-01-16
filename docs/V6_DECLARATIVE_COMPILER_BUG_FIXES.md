# V6 DeclarativeCompiler Comprehensive Bug Fixes

**Date:** 2026-01-06
**Status:** In Progress
**Goal:** Fix all identified bugs to enable production-ready deterministic compilation

## Critical Bugs Identified

### Bug 1: Invalid Filter Operator `not_in_array`

**Location:** `DeclarativeCompiler.ts:388`

**Problem:**
```typescript
config: {
  condition: {
    field: identifierField,
    operator: 'not_in_array',  // ❌ NOT supported by ConditionalEvaluator
    value: `{{${existingIdsVariable}}}`
  }
}
```

The ConditionalEvaluator does NOT support `not_in_array` operator. Looking at [ConditionalEvaluator.ts:416-490](/Users/yaelomer/Documents/neuronforge/lib/pilot/ConditionalEvaluator.ts#L416-L490), supported operators are:
- equals, not_equals
- greater_than, less_than, etc.
- contains, not_contains
- **`in`** - checks if left is IN right array
- **`not_in`** - checks if left is NOT IN right array
- exists, not_exists, is_empty, matches, starts_with, ends_with

**Correct operator:** Should use `not_in` OR use pre-computed boolean pattern.

**Impact:** Runtime error "Unknown operator: not_in_array"

**Fix Strategy:** Use pre-computed boolean pattern (safer, handles null):
```typescript
// Step 1: Map - Pre-compute membership test
{
  type: 'transform',
  operation: 'map',
  input: `{{${primaryDataVariable}}}`,
  config: {
    expression: `[item, !{{${existingIdsVariable}}}.includes(item.${identifierField})]`
  }
}

// Step 2: Filter - Simple boolean check
{
  type: 'transform',
  operation: 'filter',
  input: `{{step_prev}}`,
  config: {
    condition: `item[1] == true`
  }
}

// Step 3: Map - Extract original item
{
  type: 'transform',
  operation: 'map',
  input: `{{step_prev}}`,
  config: {
    expression: `item[0]`
  }
}
```

---

### Bug 2: Variable Reference Format Issues

**Location:** `DeclarativeCompiler.ts:1514-1520`

**Problem:**
```typescript
if (referencedStep && referencedStep.type === 'action') {
  transformStep.input = `{{${referencedStepId}.data}}`  // ✅ This is correct
}
```

This logic assumes ALL action steps output to `.data`. However, looking at execution context:
- Plugin action steps return `StepOutput` object with `.data` property
- This part is actually CORRECT

**But there's a missing case:**
- The logic doesn't handle when existing IDs array is NULL (empty lookup sheet)
- Need null safety for `.includes()` operations

**Impact:** Runtime error "Cannot read properties of null (reading 'includes')"

**Fix Strategy:** Add null safety in expression generation:
```typescript
// Instead of:
expression: `!{{${existingIdsVariable}}}.includes(item.${identifierField})`

// Use:
expression: `!({{${existingIdsVariable}}} || []).includes(item.${identifierField})`
```

---

### Bug 3: Missing Error Handling in PluginResolver Calls

**Location:** `DeclarativeCompiler.ts:199, 330`

**Problem:**
```typescript
const resolution = this.pluginResolver.resolveDataSource(pluginKey, operationType)
// ❌ No try-catch - throws uncaught exception if plugin not found
```

**Impact:** Silent compilation failure with unclear error message

**Fix Strategy:**
```typescript
try {
  const resolution = this.pluginResolver.resolveDataSource(pluginKey, operationType)
} catch (error) {
  const errorMsg = `Failed to resolve plugin: ${pluginKey}.${operationType}`
  this.log(ctx, `✗ ${errorMsg}`)
  throw new Error(`${errorMsg}: ${error.message}`)
}
```

---

### Bug 4: Filter Condition Format Inconsistency

**Location:** `DeclarativeCompiler.ts:422-428, 443-450`

**Problem:**
The compiler generates TWO different filter condition formats:

**Format 1: Object format (Simple condition)**
```typescript
config: {
  condition: {
    field: condition.field,
    operator: condition.operator,
    value: condition.value
  }
}
```

**Format 2: Array format (OR conditions)**
```typescript
config: {
  combineWith: 'OR',
  conditions: [...]
}
```

**BUT** ConditionalEvaluator expects:
- String expressions: `"item.field > 70"`
- Simple condition objects: `{ field, operator, value }`
- Complex condition objects: `{ conditionType: 'complex_or', conditions: [...] }`

The `combineWith` format is NOT standard!

**Impact:** ConditionalEvaluator may not handle `combineWith` correctly

**Fix Strategy:** Use standard complex condition format:
```typescript
// For OR logic:
config: {
  condition: {
    conditionType: 'complex_or',
    conditions: filterGroup.conditions.map(c => ({
      conditionType: 'simple',
      field: c.field,
      operator: c.operator,
      value: c.value
    }))
  }
}
```

---

### Bug 5: Parameter Resolution Ignores IR Config

**Location:** `DeclarativeCompiler.ts:1051-1132` (buildDataSourceParams method)

**Problem:**
```typescript
// Use schema default if available
if (paramSchema.default !== undefined) {
  params[paramName] = paramSchema.default
  continue
}

// Common optional parameters with reasonable defaults
if (paramNameLower.includes('limit') || paramNameLower.includes('max')) {
  params[paramName] = 100  // ❌ HARDCODED - ignores IR config
}
```

**Impact:** If IR specifies `max_results: 50`, compiler ignores it and uses 100

**Fix Strategy:** Check IR config FIRST:
```typescript
// PRIORITY 1: Check IR config object
if (dataSource.config && paramName in dataSource.config && dataSource.config[paramName] !== null) {
  params[paramName] = dataSource.config[paramName]
  continue
}

// PRIORITY 2: Check IR top-level fields
if (paramName in dataSource && dataSource[paramName] !== null) {
  params[paramName] = dataSource[paramName]
  continue
}

// PRIORITY 3: Use schema defaults
if (paramSchema.default !== undefined) {
  params[paramName] = paramSchema.default
  continue
}

// PRIORITY 4: Intelligent defaults (with warning)
if (paramNameLower.includes('limit') || paramNameLower.includes('max')) {
  this.log(ctx, `⚠ Using default limit of 100 for ${paramName} - not found in IR`)
  params[paramName] = 100
}
```

---

### Bug 6: Scatter-Gather Format Compatibility

**Location:** Need to check scatter-gather generation (if exists)

**Problem:** Old V6 format vs execution layer format mismatch

**Status:** Need to search for scatter-gather generation code

---

## Additional Improvements

### Improvement 1: Null Safety for Empty Lookup Sheets

**Problem:** When lookup sheet is empty, step returns `null`, causing `.includes()` to fail

**Solution:** Wrap all array operations with null coalescing:
```typescript
expression: `!({{${existingIdsVariable}}} || []).includes(item.${identifierField})`
```

### Improvement 2: Comprehensive Logging

Add detailed logging at each compilation stage:
- Plugin resolution attempts
- Variable reference transformations
- Filter condition generation
- Step dependencies

### Improvement 3: Validation Pipeline

Add post-compilation validation:
- Check all variable references are valid
- Verify step dependencies exist
- Validate filter condition syntax
- Check plugin+action combinations exist

---

## Implementation Plan

### Phase 2.1: Fix Critical Bugs (4 hours)

1. **Fix Bug 1: Filter operators** (1 hour)
   - Replace `not_in_array` with pre-computed boolean pattern
   - Add null safety with `|| []`
   - Test with empty lookup sheet

2. **Fix Bug 3: Error handling** (30 mins)
   - Wrap all plugin resolver calls in try-catch
   - Provide detailed error messages
   - Add context to errors

3. **Fix Bug 4: Filter condition format** (1 hour)
   - Standardize to ConditionalEvaluator format
   - Use `conditionType` discriminator
   - Test OR/AND logic

4. **Fix Bug 5: Parameter resolution** (1 hour)
   - Respect IR config priority
   - Add warning logs for defaults
   - Test with various IR formats

5. **Add Improvement 1: Null safety** (30 mins)
   - Audit all array operations
   - Add `|| []` wrapping
   - Test with null data sources

### Phase 2.2: Testing (2 hours)

1. Create regression test for original failure
2. Test each bug fix independently
3. Integration test with Gmail complaints workflow
4. Edge case testing (empty sheets, missing plugins)

---

## Test Cases

### Test 1: Empty Lookup Sheet Deduplication
```typescript
const ir = {
  data_sources: [
    { role: 'primary', plugin_key: 'google-mail', operation_type: 'search_emails' },
    { role: 'reference', plugin_key: 'google-sheets', operation_type: 'read_range' }  // Empty sheet
  ],
  filters: { conditions: [{ field: 'subject', operator: 'contains', value: 'complaint' }] }
}

// Expected: Should handle empty sheet gracefully, not crash
```

### Test 2: OR Filter Logic
```typescript
const ir = {
  filters: {
    combineWith: 'OR',
    conditions: [
      { field: 'status', operator: 'equals', value: 'urgent' },
      { field: 'priority', operator: 'equals', value: 'high' }
    ]
  }
}

// Expected: Generate complex_or condition, not combineWith
```

### Test 3: Parameter Resolution Priority
```typescript
const ir = {
  data_sources: [{
    plugin_key: 'google-mail',
    operation_type: 'search_emails',
    config: {
      max_results: 50  // Should use this, not default 100
    }
  }]
}

// Expected: params.max_results === 50
```

---

## Success Criteria

- ✅ All 5 identified bugs fixed
- ✅ 3+ regression tests passing
- ✅ No runtime errors with empty lookup sheets
- ✅ Filter conditions use standard format
- ✅ Plugin resolution has proper error handling
- ✅ Parameter resolution respects IR config
- ✅ Comprehensive logging added
- ✅ Code ready for Phase 3 (pattern support)

---

## Files to Modify

1. `/lib/agentkit/v6/compiler/DeclarativeCompiler.ts` - Main compiler
2. `/lib/agentkit/v6/compiler/__tests__/DeclarativeCompiler.test.ts` - Test suite (create if missing)
3. `/docs/V6_DECLARATIVE_COMPILER_COMPREHENSIVE_FIX.md` - Final documentation

---

## Related Documentation

- [V6_CONDITIONAL_EVALUATOR_FIX.md](/Users/yaelomer/Documents/neuronforge/docs/V6_CONDITIONAL_EVALUATOR_FIX.md) - Filter pattern constraints
- [V6_WORKFLOW_PATTERN_CATALOG.md](/Users/yaelomer/Documents/neuronforge/docs/V6_WORKFLOW_PATTERN_CATALOG.md) - Business patterns to support
- [ConditionalEvaluator.ts](/Users/yaelomer/Documents/neuronforge/lib/pilot/ConditionalEvaluator.ts) - Supported operators
