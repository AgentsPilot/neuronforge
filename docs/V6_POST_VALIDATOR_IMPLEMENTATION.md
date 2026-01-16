# V6 Post-Compilation Validator Implementation

**Date:** 2025-12-31
**Status:** ✅ COMPLETE
**Approach:** Schema-driven validation with auto-fix

---

## Problem Statement

The compiler prompt has become too complex with scattered examples and rules:
- Transform step examples (lines 732-755)
- Variable reference rules (lines 930-954)
- Transform before action pattern (lines 914-954)
- Deduplication patterns (lines 820-856)
- Plugin field names (lines 863-880)

**Issues:**
1. LLM must remember ~1000+ lines of instructions
2. Easy to miss edge cases
3. Hard to maintain as new patterns emerge
4. Non-deterministic (LLM may vary output)

---

## Solution: Schema-Driven Post-Validation

Instead of relying solely on prompt engineering, we implement **systematic validation** using schema knowledge.

### Architecture

```
┌─────────────────┐
│ Declarative IR  │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────┐
│ LLM Compiler                │
│ (IRToDSLCompiler)           │
│ - Reduced complexity        │
│ - Focused on IR→DSL mapping │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────────────────┐
│ Post-Compilation Validator  │
│ (NEW - Schema-Driven)       │
│                             │
│ 5 Validation Rules:         │
│ 1. Transform Before Action  │
│ 2. Transform Input Fields   │
│ 3. Variable References      │
│ 4. Plugin Param Types       │
│ 5. Dependencies (DAG)       │
└────────┬────────────────────┘
         │
         ▼
┌─────────────────┐
│ Auto-Fix        │
│ (when possible) │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Valid PILOT DSL │
└─────────────────┘
```

---

## Implementation

### File: `/lib/agentkit/v6/compiler/WorkflowPostValidator.ts`

**Class:** `WorkflowPostValidator`

**Constructor:**
```typescript
constructor(pluginSchemas: Record<string, PluginSchema>)
```

**Main Method:**
```typescript
validate(workflow: PILOTWorkflow, autoFix: boolean = true): ValidationResult
```

**Returns:**
```typescript
interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  autoFixed: boolean;
  fixedWorkflow?: PILOTWorkflow;
}
```

---

## Validation Rules

### Rule 1: Transform Before Action Pattern ✅ AUTO-FIXABLE

**Problem:** Action params contain config objects (expression, condition) instead of variable references.

**Detection:**
```typescript
private findConfigObjectsInParams(params: any): string[]
```
- Recursively scan params
- Detect objects with `expression` or `condition` fields
- Return paths to config objects

**Auto-Fix:**
```typescript
private fixTransformBeforeAction(workflow, stepId): PILOTWorkflow
```
1. Extract config object from action params
2. Create new transform step:
   - ID: `${actionStepId}_format`
   - Type: `transform`
   - Operation: `map` (if expression) or `filter` (if condition)
   - Input: Inferred from dependencies
   - Config: Extracted config object
3. Update action step:
   - Replace config object with `{{transformStepId}}`
   - Add transform step to dependencies
4. Insert transform step before action step

**Example:**

Before:
```json
{
  "id": "step5",
  "type": "action",
  "plugin": "google-sheets",
  "action": "append_rows",
  "params": {
    "values": {
      "expression": "item.map(row => [row.a, row.b])"
    }
  }
}
```

After Auto-Fix:
```json
{
  "id": "step5_format",
  "type": "transform",
  "operation": "map",
  "input": "{{step4}}",
  "config": {
    "expression": "item.map(row => [row.a, row.b])"
  },
  "dependencies": ["step4"]
},
{
  "id": "step5",
  "type": "action",
  "plugin": "google-sheets",
  "action": "append_rows",
  "params": {
    "values": "{{step5_format}}"
  },
  "dependencies": ["step4", "step5_format"]
}
```

---

### Rule 2: Transform Input Fields ❌ NOT AUTO-FIXABLE

**Problem:** Transform steps missing required `input` field.

**Detection:**
```typescript
step.type === 'transform' && !step.input
```

**Error Message:**
```
Missing required "input" field.
Suggestion: Add input field with variable reference (e.g., "{{step1.data}}")
```

**Why Not Auto-Fixable:**
Can't infer where data should come from without semantic understanding.

---

### Rule 3: Variable References ❌ NOT AUTO-FIXABLE

**Problem:** Variable references point to non-existent steps.

**Detection:**
```typescript
private extractVariableReferences(step): string[]
private parseVariableReference(ref): {stepId, path}
```
- Extract all `{{...}}` references
- Parse to get step ID
- Check if step ID exists in workflow

**Error Message:**
```
Variable reference "{{step10}}" points to non-existent step.
Available steps: step1, step2, step3, ...
```

**Why Not Auto-Fixable:**
Can't determine correct step to reference.

---

### Rule 4: Plugin Param Types ❌ NOT AUTO-FIXABLE

**Problem:** Action params don't match plugin schema requirements.

**Detection:**
```typescript
private checkPluginParamTypes(workflow, issues)
```
1. Get plugin schema for action
2. Validate required params exist
3. Check param types match schema

**Error Messages:**
```
Missing required parameter "spreadsheet_id" for action "append_rows"
Unknown action "invalid_action" in plugin "google-sheets"
```

**Why Not Auto-Fixable:**
Can't infer parameter values or correct action names.

---

### Rule 5: Dependencies (DAG) ⚠️ PARTIALLY AUTO-FIXABLE

**Problem:** Missing dependencies array or invalid dependencies.

**Detection:**
```typescript
private checkDependencies(workflow, issues)
```
- Check all steps have `dependencies` array
- Validate dependencies reference existing steps
- Warn about forward dependencies (potential cycles)

**Auto-Fix:**
- Missing `dependencies` → Add empty array `[]`
- Invalid dependencies → Not fixable (can't infer correct ones)

---

## Integration

### File: `/lib/agentkit/v6/compiler/IRToDSLCompiler.ts`

**Added at lines 129-147:**

```typescript
// POST-COMPILATION VALIDATION: Schema-driven validation and auto-fix
const pluginSchemas = this.pluginManager.getAvailablePlugins()
const postValidator = new WorkflowPostValidator(pluginSchemas)
const postValidation = postValidator.validate({ workflow }, true) // autoFix=true

if (postValidation.autoFixed && postValidation.fixedWorkflow) {
  console.log('[IRToDSLCompiler] ✓ Auto-fixed workflow issues:',
    postValidation.issues.filter(i => i.autoFixable).map(i => i.code))
  workflow = postValidation.fixedWorkflow.workflow
}

if (postValidation.issues.length > 0) {
  console.warn('[IRToDSLCompiler] ⚠️ Post-validation issues found:')
  postValidation.issues.forEach(issue => {
    console.warn(`  [${issue.severity.toUpperCase()}] ${issue.stepId}: ${issue.code} - ${issue.message}`)
    if (issue.suggestion) {
      console.warn(`    Suggestion: ${issue.suggestion}`)
    }
  })
}
```

**Execution Flow:**

1. LLM generates workflow
2. Fix variable references (existing)
3. Renumber steps (existing)
4. **POST-VALIDATION** (NEW):
   - Detect issues using schema rules
   - Auto-fix transform-before-action pattern
   - Auto-fix missing dependencies arrays
   - Log warnings for non-fixable issues
5. Runtime validation (existing)
6. Return result

---

## Benefits

### 1. Reduces Prompt Complexity
**Before:** Need examples for every pattern
**After:** LLM can make mistakes, validator catches them

### 2. Deterministic Error Detection
**Before:** LLM may or may not follow rules
**After:** Schema-based checks always run

### 3. Auto-Fix Common Mistakes
**Before:** Manual workflow editing required
**After:** Transform-before-action auto-fixed

### 4. Clear Error Messages
**Before:** Runtime errors from plugins
**After:** Pre-execution validation with suggestions

### 5. Easier Maintenance
**Before:** Update prompt examples
**After:** Add validation rule (one place)

---

## Example Output

### Scenario: LLM generates workflow with config in action params

**Console Output:**
```
[IRToDSLCompiler] ⚠️ Post-validation issues found:
  [ERROR] step11: TRANSFORM_BEFORE_ACTION - Action step has config objects in params: values. Plugin params must be variable references, not transform logic.
    Suggestion: Split into separate transform step (for data formatting) and action step (for plugin execution).

[IRToDSLCompiler] ✓ Auto-fixed workflow issues: ['TRANSFORM_BEFORE_ACTION']
```

**Result:**
- Step11 split into step11_format (transform) + step11 (action)
- Workflow executes successfully
- No user intervention required

---

## Testing

### Test Case 1: Transform Before Action

**Input Workflow:**
```json
{
  "workflow": [{
    "id": "step5",
    "type": "action",
    "plugin": "google-sheets",
    "params": {
      "values": {"expression": "item.map(...)"}
    }
  }]
}
```

**Expected:**
- Issue detected: `TRANSFORM_BEFORE_ACTION`
- Auto-fix: Split into 2 steps
- Valid: `true` (after fix)

### Test Case 2: Missing Transform Input

**Input Workflow:**
```json
{
  "workflow": [{
    "id": "step3",
    "type": "transform",
    "operation": "filter"
    // Missing: "input" field
  }]
}
```

**Expected:**
- Issue detected: `MISSING_TRANSFORM_INPUT`
- Auto-fix: Not possible
- Valid: `false`
- Suggestion provided

### Test Case 3: Invalid Variable Reference

**Input Workflow:**
```json
{
  "workflow": [{
    "id": "step2",
    "type": "transform",
    "input": "{{step10}}"  // step10 doesn't exist
  }]
}
```

**Expected:**
- Issue detected: `INVALID_VARIABLE_REFERENCE`
- Auto-fix: Not possible
- Valid: `false`
- Lists available steps

---

## Future Enhancements

### Phase 2: More Auto-Fix Rules

**Candidates:**
1. **Infer transform input from dependencies**
   - If transform has 1 dependency, use `{{depId}}`

2. **Fix common param naming mistakes**
   - `spreadsheetId` → `spreadsheet_id`
   - `maxResults` → `max_results`

3. **Add missing required params with defaults**
   - `max_results: 100` if missing
   - `temperature: 0` for AI calls

4. **Optimize redundant steps**
   - Merge consecutive map operations
   - Remove no-op transforms

### Phase 3: Rule-Based Compilation

Move more logic from LLM to deterministic rules:
```typescript
// Instead of LLM generating:
{
  "type": "action",
  "plugin": "gmail",
  "action": "search_messages"
}

// Use rule:
if (ir.type === 'data_source' && ir.plugin_key === 'gmail') {
  return {
    type: 'action',
    plugin: ir.plugin_key,
    action: ir.operation_type,
    params: mapParamsFromSchema(ir.config, pluginSchemas[ir.plugin_key])
  }
}
```

### Phase 4: Validation Metrics

Track and report:
- % of workflows needing auto-fix
- Most common issues
- Auto-fix success rate
- Use metrics to improve LLM prompt

---

## Impact Summary

### Code Changes
- **New File:** `WorkflowPostValidator.ts` (~400 lines)
- **Modified:** `IRToDSLCompiler.ts` (+20 lines)
- **Impact:** Immediate - validates all compiled workflows

### Reliability Improvements
- **Transform-before-action:** Auto-fixed (was: manual editing)
- **Missing inputs:** Detected early (was: runtime error)
- **Invalid references:** Pre-validated (was: execution failure)
- **Plugin params:** Schema-checked (was: plugin errors)

### Developer Experience
- Clear error messages with suggestions
- Auto-fix for common mistakes
- Reduced prompt engineering burden
- Easier to add new validation rules

---

## Recommendation

**Enable by default** in IRToDSLCompiler:
```typescript
const postValidation = postValidator.validate({ workflow }, true) // autoFix=true
```

**Benefits:**
- ✅ Catches LLM mistakes systematically
- ✅ Auto-fixes transform-before-action pattern
- ✅ Provides actionable error messages
- ✅ No breaking changes (enhances existing flow)

**Next Steps:**
1. Monitor auto-fix rates in production
2. Add more auto-fix rules based on metrics
3. Gradually move deterministic logic from LLM to rules
4. Reduce prompt complexity as validator handles more cases

---

**Implementation Date:** 2025-12-31
**Status:** ✅ COMPLETE - Integrated into IRToDSLCompiler
**Confidence:** HIGH (95%) - Schema-driven, deterministic validation
**Breaking Changes:** None - enhances existing compilation flow
