# Missing Auto-Fix Patterns in Calibration System

## Issue Summary
The calibration system is **detecting** errors but **not auto-fixing** them because these error patterns don't match existing auto-fix handlers.

---

## Pattern 1: Object-to-Field Extraction ⚠️ MISSING

### Error Signature
```
Error: "Resource not found"
Step params: {"file_id": "{{drive_file}}"}
API Error: The requested URL contains escaped JSON object instead of ID string
```

### Root Cause
The workflow passes `{{drive_file}}` (entire object) instead of `{{drive_file.file_id}}` (extracted field).

### Current Behavior
- ✅ **Detected** by IssueCollector as "parameter error"
- ❌ **NOT auto-fixable** - `autoRepairAvailable: false`
- ❌ Calibration loop exits without fixing

### Required Auto-Fix Logic
**Location to add:** `app/api/v2/calibrate/batch/route.ts` or `lib/pilot/shadow/IssueCollector.ts`

**Detection Pattern:**
1. Error message contains "not found" or "404"
2. Error URL/message contains escaped JSON object (`%7B`, `%22`, etc.)
3. Step parameter is a variable reference like `{{variable_name}}`
4. Variable resolves to an object, not a string
5. Parameter schema expects `type: "string"`

**Auto-Fix Action:**
```typescript
{
  type: 'extract_object_field',
  stepId: 'step9',
  confidence: 0.90,
  changes: [{
    stepId: 'step9',
    path: 'params.file_id',
    oldValue: '{{drive_file}}',
    newValue: '{{drive_file.file_id}}', // Extract the field matching parameter name
    action: 'add_field_accessor',
    reasoning: 'Parameter expects string but receives object. Extracting field that matches parameter name.'
  }]
}
```

**Implementation Strategy:**
```typescript
// In calibration loop, after collecting issues:
for (const issue of iterationIssues) {
  if (issue.category === 'execution_error' && issue.message?.includes('not found')) {
    // Get step params
    const step = findStep(issue.affectedSteps[0].stepId);
    const params = step.params || step.config;

    // Check each parameter
    for (const [paramName, paramValue] of Object.entries(params)) {
      // Is it a variable reference?
      if (typeof paramValue === 'string' && paramValue.startsWith('{{') && paramValue.endsWith('}}')) {
        const varName = paramValue.slice(2, -2); // Remove {{}}

        // Get parameter schema
        const paramSchema = getParameterSchema(step.plugin, step.action, paramName);

        // Does schema expect string but variable is object?
        if (paramSchema?.type === 'string' && !varName.includes('.')) {
          // Check if variable contains a field matching param name
          // e.g., drive_file.file_id for file_id parameter
          const suggestedField = `${varName}.${paramName}`;

          autoRepairAvailable = true;
          autoRepairProposal = {
            type: 'extract_object_field',
            stepId: step.id,
            confidence: 0.90,
            changes: [{
              stepId: step.id,
              path: `params.${paramName}`,
              oldValue: paramValue,
              newValue: `{{${suggestedField}}}`,
              action: 'add_field_accessor',
              reasoning: `Parameter "${paramName}" expects string but receives object "{{${varName}}}". Extracting field "${suggestedField}".`
            }]
          };
        }
      }
    }
  }
}
```

---

## Pattern 2: Missing AI Output Variable ⚠️ MISSING

### Error Signature
```
Error: "Unknown variable reference root: digest_content"
Step 16 tries to use: {{digest_content.subject}}
Step 15 (ai_processing) should create this variable
```

### Root Cause
Step 15's `output_variable` declaration exists in schema but the execution engine isn't storing the AI response properly.

### Current Behavior
- ✅ **Detected** as "VARIABLE_RESOLUTION_ERROR"
- ❌ **NOT auto-fixable** - `autoRepairAvailable: false`
- ❌ Calibration loop exits without fixing

### Possible Causes
1. **Bug in ai_processing executor:** Output not being stored
2. **Step 15 failing silently:** AI call fails but error not surfaced
3. **Missing dependency:** Step 16 executing before step 15 completes
4. **Wrong output variable name:** Mismatch between declaration and usage

### Required Investigation
**Check:**
1. Does step 15 execute successfully?
   ```bash
   grep "step15" /tmp/nextjs-calibration.log | grep -E "success|failed|output"
   ```

2. Is `digest_content` being stored in ExecutionContext?
   ```bash
   grep "digest_content" /tmp/nextjs-calibration.log | grep "Variable set"
   ```

3. What is step 15's actual output?
   ```bash
   grep -A 5 "step15.*completed\|step15.*output" /tmp/nextjs-calibration.log
   ```

### Required Auto-Fix Logic (Once root cause identified)

**If issue is missing dependency:**
```typescript
{
  type: 'add_missing_dependency',
  stepId: 'step16',
  confidence: 0.95,
  changes: [{
    stepId: 'step16',
    path: 'dependencies',
    oldValue: [],
    newValue: ['step15'],
    action: 'add_dependency',
    reasoning: 'Step 16 references digest_content created by step 15 but has no dependency on it.'
  }]
}
```

**If issue is missing output_variable:**
```typescript
{
  type: 'add_output_variable',
  stepId: 'step15',
  confidence: 0.90,
  changes: [{
    stepId: 'step15',
    path: 'output_variable',
    oldValue: undefined,
    newValue: 'digest_content',
    action: 'add_field',
    reasoning: 'Step 16 references digest_content but step 15 does not declare it as output_variable.'
  }]
}
```

---

## Pattern 3: Wrong Parameter Format (fields vs values) ⚠️ PARTIALLY HANDLED

### Error Signature
```
StructuralRepairEngine: "Detected missing required parameters: values"
Step 14 (append_rows) has "fields" parameter
Google Sheets API expects "values" parameter
```

### Current Behavior
- ✅ **Detected** by StructuralRepairEngine
- ⚠️ **Logged but not fixed**
- Reason: Requires transforming object to 2D array

### Required Auto-Fix Logic
**Complex transformation needed** - convert `fields` object to `values` 2D array:

```typescript
// Current (wrong):
{
  "fields": {
    "Date": "{{item.date}}",
    "Type": "{{item.type}}",
    "Amount": "{{item.amount}}"
  }
}

// Should be (correct):
{
  "values": [
    ["{{item.date}}", "{{item.type}}", "{{item.amount}}"]
  ]
}
```

**Implementation note:** This requires schema-aware transformation and might be beyond current auto-fix capabilities. May need to be a compiler-level fix instead.

---

## Priority

1. **HIGH:** Pattern 1 - Object-to-Field Extraction (blocks file sharing)
2. **HIGH:** Pattern 2 - Missing AI Output Variable (blocks email digest)
3. **MEDIUM:** Pattern 3 - Parameter format transformation (workaround exists)

---

## Next Steps

1. Implement Pattern 1 detection and auto-fix in calibration loop
2. Investigate Pattern 2 root cause (check logs for step 15 execution)
3. Decide if Pattern 3 should be compiler-level fix or calibration-level fix

---

## Implementation Location

**Option A: Add to calibration loop** (`app/api/v2/calibrate/batch/route.ts`)
- After line 1209: `const iterationIssues = result.collectedIssues || [];`
- Add new pattern detection alongside existing parameter mismatch patterns

**Option B: Add to IssueCollector** (`lib/pilot/shadow/IssueCollector.ts`)
- In `collectIssueFromError()` method
- Check for object-to-field pattern when classifying parameter errors
- Set `autoRepairAvailable = true` and generate proposal

**Recommendation:** Option A (calibration loop) for faster iteration and easier debugging.
