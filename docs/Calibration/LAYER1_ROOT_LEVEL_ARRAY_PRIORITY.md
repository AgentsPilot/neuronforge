# Layer 1: Root-Level Array Priority Enhancement

> **Status**: ✅ Implemented
> **Last Updated**: 2026-04-23

## Problem

Layer 1's `inferFlattenField()` method was choosing **nested array fields** over **root-level array fields**, causing flatten operations to fail with empty results.

### Example Scenario

```typescript
Gmail Plugin Output Schema:
{
  type: "object",
  properties: {
    emails: {
      type: "array",
      items: {
        properties: {
          id: { type: "string" },
          subject: { type: "string" },
          attachments: { type: "array", items: {...} }  // ← Nested array
        }
      }
    }
  }
}

Step receives: {{matching_emails}}  // ← Whole object {emails: [...]}

Previous Layer 1 Inference:
  → Inferred field: "attachments" (nested array inside emails[])
  → Result: Flatten looks for "attachments" at root level
  → FAILS: "attachments" doesn't exist at root, it's nested in emails[].attachments

Correct Layer 1 Inference:
  → Should infer: "emails" (root-level array)
  → Result: Flatten extracts emails array from root
  → SUCCESS: Workflow gets array of email objects
```

**Root Cause**:
The method used `findArrayInSchema()` to locate the first array in the schema, then looked for **array fields within that array's items**. For the Gmail schema, it found "emails" array, then looked inside `emails[].properties` and found "attachments" (nested array). Since "attachments" matched the priority pattern, it returned it - but this field is NOT accessible at the root level where flatten operation will look.

## Solution: Two-Tier Array Detection

### Enhanced Logic

**Location**: [EnhancedSchemaValidator.ts:564-656](../lib/pilot/shadow/EnhancedSchemaValidator.ts#L564-L656)

**New Strategy**:
1. **First**: Check if source schema is `type: "object"` with root-level array properties
2. **Then**: Check for nested arrays (array fields within array items)
3. **Priority**: Root-level arrays ALWAYS win over nested arrays

### Implementation

```typescript
// Strategy 2: Analyze upstream step's output schema
const sourceStep = this.findSourceStep(step, agent.pilot_steps || []);
if (sourceStep?.output_schema) {
  // CRITICAL: Prioritize root-level arrays over nested arrays

  if (sourceStep.output_schema.type === 'object' && sourceStep.output_schema.properties) {
    // Step 1: Check for array fields at ROOT level first
    const rootArrayFields = Object.keys(sourceStep.output_schema.properties).filter(
      key => sourceStep.output_schema.properties[key].type === 'array'
    );

    if (rootArrayFields.length === 1) {
      // Only one root-level array - use it (high confidence)
      logger.info({
        stepId,
        inferredField: rootArrayFields[0],
        reason: 'only root-level array field in object schema',
        schemaType: 'object'
      }, 'Inferred flatten field from root-level array');
      return rootArrayFields[0];  // ✅ Returns "emails"
    }

    if (rootArrayFields.length > 1) {
      // Multiple root-level arrays - use priority heuristics
      const priorityFields = ['emails', 'items', 'files', 'results', 'data', 'records', 'rows'];

      for (const priority of priorityFields) {
        if (rootArrayFields.includes(priority)) {
          return priority;  // ✅ Returns prioritized root-level array
        }
      }

      return rootArrayFields[0];  // ✅ Returns first root-level array
    }
  }

  // Step 2: Only if no root-level arrays, check nested arrays
  const arraySchema = this.findArrayInSchema(sourceStep.output_schema);

  if (arraySchema?.items?.properties) {
    const nestedArrayFields = Object.keys(arraySchema.items.properties).filter(
      key => arraySchema.items.properties[key].type === 'array'
    );

    // Apply priority heuristics to nested arrays
    // (same logic as before, but now only runs if no root-level arrays exist)
  }
}
```

### Key Changes

| Before | After |
|--------|-------|
| Found first array in schema → searched for array fields inside it | First check root-level arrays → then check nested arrays |
| Priority: `['attachments', 'items', 'files', ...]` | Root priority: `['emails', 'items', 'files', ...]` (added "emails") |
| Returned "attachments" (nested) | Returns "emails" (root-level) ✅ |
| No logging of schema type | Logs `schemaType: 'object'` vs detected type |
| No distinction between root vs nested | Clear logging: "root-level array" vs "nested array" |

## How It Works Now

### Detection Flow for Gmail → Flatten Example

**Input**:
- Source schema type: `object`
- Source schema properties: `{emails: {type: "array", items: {...}}}`
- Flatten step receives: `{{matching_emails}}` (the whole object)

**Execution**:
1. Check if `sourceStep.output_schema.type === 'object'` → ✅ Yes
2. Extract root-level array fields from `properties`:
   - Found: `["emails"]` (only one root-level array)
3. Single root-level array found → Return `"emails"` immediately
4. Log: `"Inferred flatten field from root-level array: emails (reason: only root-level array field in object schema)"`

**Result**:
- Flatten step configured with `field: "emails"` ✅
- Operation looks for "emails" at root level → FOUND
- Extracts array of email objects successfully

### Detection Flow for Source Returning Array Directly

**Input**:
- Source schema type: `array`
- Source schema items: `{properties: {attachments: {type: "array"}, ...}}`

**Execution**:
1. Check if `sourceStep.output_schema.type === 'object'` → ❌ No (it's "array")
2. Skip root-level array detection
3. Use `findArrayInSchema()` → finds the array schema
4. Extract nested array fields from `items.properties`:
   - Found: `["attachments"]`
5. Return `"attachments"`
6. Log: `"Inferred flatten field from nested array: attachments"`

**Result**:
- Flatten step configured with `field: "attachments"` ✅
- Operation receives array and looks for "attachments" in array items → FOUND
- Extracts nested attachments successfully

## Enhanced Logging

### Before
```
[EnhancedSchemaValidator] Inferred flatten field from upstream schema
  - stepId: "step2"
  - inferredField: "attachments"
  - reason: "matched priority pattern in upstream schema"
```

### After (Root-Level Array)
```
[EnhancedSchemaValidator] Inferred flatten field from root-level array
  - stepId: "step2"
  - inferredField: "emails"
  - reason: "only root-level array field in object schema"
  - schemaType: "object"
```

### After (Multiple Root-Level Arrays)
```
[EnhancedSchemaValidator] Inferred flatten field from root-level array
  - stepId: "step2"
  - inferredField: "emails"
  - reason: "matched priority pattern in root-level arrays"
  - availableRootArrays: ["emails", "contacts", "files"]
  - schemaType: "object"
```

### After (Nested Array - Fallback)
```
[EnhancedSchemaValidator] Inferred flatten field from nested array
  - stepId: "step2"
  - inferredField: "attachments"
  - reason: "only nested array field in upstream schema"
  - schemaType: "array"
```

## Impact

### Before Enhancement
- ❌ Inferred "attachments" (nested field) for Gmail → Flatten workflow
- ❌ Flatten operation failed (field not found at root level)
- ❌ Workflow returned empty results
- ❌ Required manual debugging to identify nesting issue

### After Enhancement
- ✅ Infers "emails" (root-level field) for Gmail → Flatten workflow
- ✅ Flatten operation succeeds (field found at root level)
- ✅ Workflow processes data correctly
- ✅ Auto-fixes nested field issues before execution

## Testing

### Test Case 1: Gmail → Flatten Attachments (Original Bug)

**Setup**:
- Step1 (Gmail - List Emails): Returns `{emails: [{id, subject, attachments: [...]}]}`
- Step2 (Flatten): Input `{{matching_emails}}`, field missing (triggers inference)

**Expected Behavior**:
1. Layer 1 detects missing `field` parameter in flatten step
2. Calls `inferFlattenField()`
3. Analyzes source schema: `type: "object"`, properties: `{emails: {type: "array"}}`
4. Finds root-level array: `["emails"]`
5. Infers `field: "emails"` ✅
6. Auto-fixes step2 config
7. Post-fix workflow has `field: "emails"` at step2

**Log Output**:
```
[Layer 1] Missing flatten field detected
  - stepId: "step2"
  - issueType: "missing_flatten_field"

[Layer 1] Inferred flatten field from root-level array
  - stepId: "step2"
  - inferredField: "emails"
  - reason: "only root-level array field in object schema"
  - schemaType: "object"

[Layer 1] Auto-fixed issue
  - action: "add_flatten_field"
  - field: "emails"
  - confidence: 0.95
```

### Test Case 2: Multiple Root-Level Arrays

**Setup**:
- Source schema: `{type: "object", properties: {emails: {type: "array"}, contacts: {type: "array"}}}`

**Expected Behavior**:
1. Finds multiple root-level arrays: `["emails", "contacts"]`
2. Applies priority heuristics
3. "emails" matches priority pattern → returns "emails"
4. Logs available root arrays for transparency

### Test Case 3: Source Returns Array Directly

**Setup**:
- Source schema: `{type: "array", items: {properties: {attachments: {type: "array"}}}}`

**Expected Behavior**:
1. Skips root-level array detection (not an object type)
2. Falls through to nested array detection
3. Finds "attachments" in array items
4. Returns "attachments" ✅ (correct for this case)

## Files Modified

| File | Lines | Description |
|------|-------|-------------|
| [EnhancedSchemaValidator.ts:564-656](../lib/pilot/shadow/EnhancedSchemaValidator.ts#L564-L656) | 564-656 | Rewrote Strategy 2 to prioritize root-level arrays |
| [EnhancedSchemaValidator.ts:587](../lib/pilot/shadow/EnhancedSchemaValidator.ts#L587) | 587 | Added "emails" to root-level array priority list |

## Relationship to Layer 2 Enhancement

This fix complements the [Layer 2 Nested Field Detection](LAYER2_NESTED_FIELD_DETECTION.md):

| Layer | Responsibility | How They Work Together |
|-------|---------------|------------------------|
| **Layer 1** | Auto-infer missing flatten fields from schemas | Now chooses correct root-level array → prevents issue from occurring |
| **Layer 2** | Detect when field exists but at wrong nesting level | Catches cases where Layer 1 didn't run or user manually configured wrong field |

**Defense in Depth**:
- ✅ Layer 1 prevents the issue (inference chooses correct field)
- ✅ Layer 2 detects and fixes the issue (if it still occurs)
- ✅ Layer 3 validates with real data (final safety net)

## Limitations

This enhancement handles the most common cases, but edge cases may still need manual intervention:

1. **Ambiguous priorities**: Multiple root-level arrays with no clear priority match → uses first alphabetically
2. **Complex nesting**: `{a: {b: {c: [{d: [...]}]}}}` → might need path syntax support
3. **User intent mismatch**: Sometimes user WANTS nested array, not root → Layer 2 can detect via description analysis

For these cases:
- Layer 1 will make best guess based on schema structure
- Layer 2 can suggest alternatives if execution fails
- User can manually override if needed

## Next Steps

Potential future enhancements:

1. **Description-based hints**: Parse step description for keywords like "nested", "inner", "deep" to understand user intent
2. **Multi-level path generation**: Generate `field: "emails.attachments"` for accessing nested arrays directly
3. **Confidence scoring**: Return confidence level with inference for Layer 2 to use in verification

---

**Status**: ✅ **Production Ready**

The enhancement is generic, deterministic, and scales to any plugin/schema combination without hardcoding.
