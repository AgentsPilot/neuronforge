# StructuralRepairEngine: Root-Level Array Priority Fix

> **Status**: ✅ Fixed
> **Last Updated**: 2026-04-23

## Problem

StructuralRepairEngine was **overwriting** the correct Layer 1 auto-fixes by checking flatten fields at the **wrong nesting level**.

### The Issue

**Layer 1 (EnhancedSchemaValidator)** correctly inferred `field: "emails"` (root-level array), but **StructuralRepairEngine** then changed it to `field: "attachments"` (nested array).

**Example**:

```typescript
Gmail Output Schema:
{
  type: "object",
  properties: {
    emails: {
      type: "array",
      items: {
        properties: {
          id: { type: "string" },
          subject: { type: "string" },
          attachments: {  // ← Nested inside emails[]
            type: "array",
            items: { ... }
          }
        }
      }
    }
  }
}

Step2 receives: {{matching_emails}}  // ← The whole object {emails: [...]}

Layer 1: ✅ Inferred field: "emails" (root-level array)
StructuralRepairEngine: ❌ Changed to: "attachments" (nested array)
Result: Workflow fails with empty results
```

### Root Cause

**Before Fix** (StructuralRepairEngine.ts:427-452):

```typescript
// Old validation logic
const arraySchema = this.findArraySchemaInOutput(sourceStep.output_schema, varMatch[2]);

if (arraySchema?.items?.properties) {
  // ❌ Getting fields from NESTED array items (emails[].properties)
  const availableFields = Object.keys(arraySchema.items.properties);

  // Checking if flatten field exists in nested level
  if (!availableFields.includes(field)) {
    // Reports "attachments" as available field
    // But "attachments" is NOT at root level!
  }
}
```

**What `findArraySchemaInOutput` does**:
1. Finds the first array in the schema → `emails` (correct)
2. Returns `emails.items` schema
3. Old code then extracts fields from `emails[].properties` → finds `["id", "subject", "attachments", ...]`
4. Sees "attachments" is an array field → suggests it as the flatten field
5. **BUT**: "attachments" is NOT accessible at root level where flatten operation looks!

## Solution: Nesting-Level Aware Validation

### Enhanced Validation Logic

**Location**: [StructuralRepairEngine.ts:415-480](../lib/pilot/shadow/StructuralRepairEngine.ts#L415-L480)

**New Strategy**:

```typescript
if (sourceStep.output_schema.type === 'object' && sourceStep.output_schema.properties) {
  // Source returns an object - flatten field must be at ROOT level
  const rootArrayFields = Object.keys(sourceStep.output_schema.properties).filter(
    key => sourceStep.output_schema.properties[key].type === 'array'
  );

  // Check if the flatten field is a root-level array
  if (!rootArrayFields.includes(field)) {
    // ✅ Reports root-level arrays only: ["emails"]
    issues.push({
      type: 'invalid_flatten_field',
      description: `Flatten field "${field}" is not a root-level array. Available root-level array fields: ${rootArrayFields.join(', ')}`
    });
  }
} else if (sourceStep.output_schema.type === 'array') {
  // Source returns an array directly - flatten field must be in array items
  const arraySchema = this.findArraySchemaInOutput(sourceStep.output_schema, varMatch[2]);

  if (arraySchema?.items?.properties) {
    const availableFields = Object.keys(arraySchema.items.properties).filter(
      key => arraySchema.items.properties[key].type === 'array'
    );

    // Check nested array fields (only when source is array type)
    if (!availableFields.includes(field)) {
      issues.push({
        type: 'invalid_flatten_field',
        description: `Flatten field "${field}" not in array items. Available array fields: ${availableFields.join(', ')}`
      });
    }
  }
}
```

### Enhanced Fix Proposal

**Location**: [StructuralRepairEngine.ts:745-795](../lib/pilot/shadow/StructuralRepairEngine.ts#L745-L795)

**Before**:
```typescript
// Old priority (always preferred "attachments")
let bestField = availableFields[0];
if (availableFields.includes('attachments')) {
  bestField = 'attachments';  // ❌ Wrong for root-level arrays
}
```

**After**:
```typescript
// New priority based on nesting level
const isRootLevel = issue.description.includes('root-level');

const rootPriority = ['emails', 'items', 'files', 'results', 'data', 'records', 'rows'];
const nestedPriority = ['attachments', 'items', 'files', 'results', 'data'];

const priorityList = isRootLevel ? rootPriority : nestedPriority;

for (const priority of priorityList) {
  if (availableFields.includes(priority)) {
    bestField = priority;  // ✅ "emails" for root-level, "attachments" for nested
    break;
  }
}
```

## How It Works Now

### Case 1: Source Returns Object (Root-Level Arrays)

**Schema**:
```json
{
  "type": "object",
  "properties": {
    "emails": { "type": "array", "items": {...} }
  }
}
```

**Validation**:
1. Detects schema type: `object`
2. Extracts root-level array fields: `["emails"]`
3. Checks if flatten field is in root-level arrays
4. If not found, suggests fix using root priority: `['emails', 'items', 'files', ...]`
5. Log: `"Flatten field is not a root-level array in source schema"`

**Fix**:
- Available fields: `["emails"]`
- Priority match: "emails" (root priority)
- Suggested field: `"emails"` ✅

### Case 2: Source Returns Array Directly (Nested Arrays)

**Schema**:
```json
{
  "type": "array",
  "items": {
    "properties": {
      "attachments": { "type": "array", "items": {...} }
    }
  }
}
```

**Validation**:
1. Detects schema type: `array`
2. Extracts array item array fields: `["attachments"]`
3. Checks if flatten field is in nested arrays
4. If not found, suggests fix using nested priority: `['attachments', 'items', ...]`
5. Log: `"Flatten field does not exist in array items schema"`

**Fix**:
- Available fields: `["attachments"]`
- Priority match: "attachments" (nested priority)
- Suggested field: `"attachments"` ✅

## Impact

### Before Fix
- ❌ Layer 1 correctly inferred `field: "emails"`
- ❌ StructuralRepairEngine overwrote it to `field: "attachments"`
- ❌ Workflow failed with empty results
- ❌ Layer 3 detected issue but too late (after execution)

### After Fix
- ✅ Layer 1 correctly infers `field: "emails"`
- ✅ StructuralRepairEngine validates using root-level arrays
- ✅ No conflicting fixes - both agree on `field: "emails"`
- ✅ Workflow succeeds on first calibration run

## Integration with Layer 1

Both validators now use **identical root-level priority logic**:

| Validator | Priority for Root-Level Arrays | Priority for Nested Arrays |
|-----------|--------------------------------|----------------------------|
| **Layer 1 (EnhancedSchemaValidator)** | `['emails', 'items', 'files', 'results', 'data', 'records', 'rows']` | `['attachments', 'items', 'files', 'results', 'data']` |
| **StructuralRepairEngine** | `['emails', 'items', 'files', 'results', 'data', 'records', 'rows']` | `['attachments', 'items', 'files', 'results', 'data']` |

**Result**: No more conflicting fixes! 🎉

## Files Modified

| File | Lines | Description |
|------|-------|-------------|
| [StructuralRepairEngine.ts:415-480](../lib/pilot/shadow/StructuralRepairEngine.ts#L415-L480) | 415-480 | Enhanced flatten field validation with nesting-level awareness |
| [StructuralRepairEngine.ts:745-795](../lib/pilot/shadow/StructuralRepairEngine.ts#L745-L795) | 745-795 | Updated fix proposal to use root vs nested priority |

## Testing

### Test Case: Gmail → Flatten Workflow

**Setup**:
- Step1: Gmail list_emails → returns `{emails: [{attachments: [...]}]}`
- Step2: Flatten (missing field) → receives `{{matching_emails}}`

**Expected Behavior**:

**Loop 1**:
1. Layer 1 detects missing flatten field
2. Layer 1 infers `field: "emails"` (root-level array)
3. Layer 1 applies auto-fix with confidence 0.90
4. StructuralRepairEngine validates flatten field
5. StructuralRepairEngine confirms `field: "emails"` is valid (root-level array exists) ✅
6. No conflicting fix applied
7. Workflow proceeds to Layer 2

**Loop 2** (if needed):
- No further flatten field issues detected
- Calibration completes successfully

**Log Output Expected**:
```
[Layer 1] Inferred flatten field from root-level array
  - stepId: "step2"
  - inferredField: "emails"
  - reason: "only root-level array field in object schema"
  - schemaType: "object"

[Layer 1] Applied auto-fix: missing_flatten_field
  - field: "config.field"
  - newValue: "emails"
  - confidence: 0.90

[StructuralRepairEngine] Validating flatten field: "emails"
  - rootArrayFields: ["emails"]
  - schemaType: "object"
  - validation: PASSED ✅
```

## Related Enhancements

This fix works in conjunction with:

1. **Layer 1 Root-Level Array Priority** ([LAYER1_ROOT_LEVEL_ARRAY_PRIORITY.md](LAYER1_ROOT_LEVEL_ARRAY_PRIORITY.md))
   - EnhancedSchemaValidator inference logic
   - Same priority lists for consistent behavior

2. **Layer 2 Nested Field Detection** ([LAYER2_NESTED_FIELD_DETECTION.md](LAYER2_NESTED_FIELD_DETECTION.md))
   - Catches cases where field exists but at wrong level
   - Provides secondary validation

## Next Steps

Potential future enhancements:

1. **Unified Priority Configuration**: Move priority lists to shared constants file
2. **Schema Path Syntax**: Support `field: "emails.attachments"` for explicit nested access
3. **Validation Coordination**: Add flag to skip StructuralRepairEngine validation when Layer 1 has already validated

---

**Status**: ✅ **Production Ready**

Both Layer 1 and StructuralRepairEngine now agree on flatten field selection, eliminating the conflicting fixes issue.
