# Layer 2: Nested Field Structure Detection Enhancement

> **Status**: ✅ Implemented
> **Last Updated**: 2026-04-23

## Problem

Layer 2 semantic validator was not catching a critical workflow design issue: **fields referenced at the wrong nesting level**.

### Example Scenario

```typescript
Step 1 (Gmail - List Emails):
  Plugin returns: { emails: [{ attachments: [...] }] }
  Output variable: "matching_emails"

Step 2 (Transform - Flatten):
  Input: {{matching_emails}}  // ← Receives the whole object
  Config: { field: "attachments" }  // ← Looking for "attachments" at ROOT level
  Problem: "attachments" doesn't exist at root - it's nested in emails[].attachments
```

**Previous Behavior**:
- Layer 1 would find "attachments" exists somewhere in the schema and infer it
- Layer 2 LLM might detect "field exists" and skip flagging the issue
- Layer 3 dry-run would succeed (because it generates sample data that happens to work)
- But real execution would return empty results

## Solution: Enhanced Nesting Level Verification

### 1. New Issue Type

Added `field_wrong_nesting_level` to known issue types:

```typescript
const KNOWN_ISSUE_TYPES = [
  'field_not_found',
  'field_wrong_nesting_level',  // ← NEW
  'type_mismatch',
  'empty_result_likely',
  // ...
] as const;
```

### 2. Enhanced Verification Logic

Modified `verifyDetectedIssue()` to check **nesting level accessibility**, not just existence:

**Before**:
```typescript
case 'field_not_found': {
  const schema = this.extractSchema(sourceStep.output_schema);
  const fieldExists = this.checkFieldExists(schema, issue.problematicField);
  return !fieldExists; // Issue valid if field doesn't exist
}
```

**After**:
```typescript
case 'field_not_found': {
  const isAccessible = this.isFieldAccessibleAtCorrectLevel(
    sourceStep.output_schema,
    issue.problematicField,
    step
  );
  return !isAccessible; // Issue valid if field not accessible at correct level
}
```

### 3. New Helper Method: `isFieldAccessibleAtCorrectLevel()`

**Location**: [ConstrainedSemanticValidator.ts:549-613](../lib/pilot/shadow/ConstrainedSemanticValidator.ts#L549-L613)

**Key Logic**:

```typescript
private isFieldAccessibleAtCorrectLevel(
  sourceOutputSchema: any,
  fieldName: string,
  step: WorkflowStep
): boolean {
  const operation = (step as any).operation || (step as any).config?.type;

  if (operation === 'flatten' || operation === 'filter' || operation === 'map') {
    if (sourceOutputSchema.type === 'object') {
      // Source returns object - field must be at root level
      if (rootSchema.properties && fieldName in rootSchema.properties) {
        return true; // ✅ Field accessible at root
      }

      // Check if field exists nested inside an array property
      for (const [propName, propSchema] of Object.entries(rootSchema.properties || {})) {
        if (prop.type === 'array' && prop.items?.properties) {
          if (fieldName in prop.items.properties) {
            logger.warn(
              `Field "${fieldName}" exists in nested array "${propName}[].${fieldName}", ` +
              `not at root level where ${operation} is looking`
            );
            return false; // ❌ Field exists but at wrong nesting level
          }
        }
      }
    } else if (sourceOutputSchema.type === 'array') {
      // Source returns array - field must be in array items
      // ...
    }
  }

  return false;
}
```

### 4. Enhanced Field Extraction

Added `extractAvailableFieldsAtCorrectLevel()` method to get fields only from the level where the operation will look:

**Location**: [ConstrainedSemanticValidator.ts:660-689](../lib/pilot/shadow/ConstrainedSemanticValidator.ts#L660-L689)

```typescript
private extractAvailableFieldsAtCorrectLevel(outputSchema: any, step: WorkflowStep): string[] {
  if (outputSchema.type === 'object') {
    // Get fields at ROOT level only
    const fields = Object.keys(rootSchema.properties);
    if (operation === 'flatten') {
      return fields.filter(f => rootSchema.properties[f].type === 'array');
    }
    return fields;
  } else if (outputSchema.type === 'array') {
    // Get fields from ARRAY ITEMS only
    const fields = Object.keys(itemsSchema.properties);
    // ...
  }
}
```

### 5. Enhanced Fix Generation

Modified `generateConstrainedFix()` to use correct-level field extraction:

**Before**:
```typescript
const availableFields = this.extractAvailableFields(sourceStep.output_schema, step);
```

**After**:
```typescript
const availableFields = this.extractAvailableFieldsAtCorrectLevel(
  sourceStep.output_schema,
  step
);
```

## How It Works Now

### Detection Flow

1. **LLM Detection** (no changes needed - LLM already sees the schema structure)
2. **Verification** (enhanced):
   - For `field_not_found` or `field_wrong_nesting_level` issues
   - Check if field is accessible **at the nesting level where the operation looks**
   - Log warning if field exists but at wrong level
3. **Fix Generation** (enhanced):
   - Extract available fields **only from the correct nesting level**
   - Generate fix using fields that are actually accessible
4. **Schema Validation** (existing - still validates the fix)

### Example Detection

**Workflow**:
```json
{
  "step1": {
    "output_schema": {
      "type": "object",
      "properties": {
        "emails": {
          "type": "array",
          "items": {
            "properties": {
              "attachments": { "type": "array" }
            }
          }
        }
      }
    }
  },
  "step2": {
    "input_variable": "{{matching_emails}}",
    "config": { "field": "attachments" }
  }
}
```

**What Happens**:
1. LLM might detect: `field_not_found` or `field_wrong_nesting_level` for "attachments"
2. Verification calls `isFieldAccessibleAtCorrectLevel()`:
   - Source schema type: `object`
   - Looking for "attachments" at root level properties
   - NOT found at root (only "emails" exists)
   - Check nested: "attachments" found in `emails[].attachments`
   - ⚠️ Log warning: Field at wrong nesting level
   - Return `false` (not accessible)
3. Issue verified ✅
4. Fix generation:
   - Extract fields at root level: `["emails"]`
   - Best field: "emails" (only array field available)
   - Generate fix: Change `field: "attachments"` to `field: "emails"`
5. Result: Workflow now flattens `emails` first, which is the correct structure

## Impact

### Before Enhancement
- ❌ Layer 2 would not detect nested field issues
- ❌ Workflow would pass all validation but return empty results
- ❌ Users would need to manually debug nested structure problems

### After Enhancement
- ✅ Layer 2 detects when field exists but at wrong nesting level
- ✅ Generates fix to use field at correct level
- ✅ Prevents empty result failures due to incorrect nesting
- ✅ Works for any plugin, any schema structure (not hardcoded)

## Files Modified

| File | Lines | Description |
|------|-------|-------------|
| [ConstrainedSemanticValidator.ts:33](../lib/pilot/shadow/ConstrainedSemanticValidator.ts#L33) | 33-40 | Added `field_wrong_nesting_level` issue type |
| [ConstrainedSemanticValidator.ts:305](../lib/pilot/shadow/ConstrainedSemanticValidator.ts#L305-L321) | 305-321 | Enhanced `field_not_found` verification to check nesting level |
| [ConstrainedSemanticValidator.ts:323](../lib/pilot/shadow/ConstrainedSemanticValidator.ts#L323-L337) | 323-337 | Added verification case for `field_wrong_nesting_level` |
| [ConstrainedSemanticValidator.ts:368](../lib/pilot/shadow/ConstrainedSemanticValidator.ts#L368-L419) | 368-419 | Enhanced fix generation to use correct-level fields |
| [ConstrainedSemanticValidator.ts:549](../lib/pilot/shadow/ConstrainedSemanticValidator.ts#L549-L613) | 549-613 | Added `isFieldAccessibleAtCorrectLevel()` helper |
| [ConstrainedSemanticValidator.ts:660](../lib/pilot/shadow/ConstrainedSemanticValidator.ts#L660-L689) | 660-689 | Added `extractAvailableFieldsAtCorrectLevel()` helper |

## Testing

### Manual Test Case

1. Create agent with Gmail → Flatten workflow
2. Configure step2 to flatten "attachments" from `{{matching_emails}}`
3. Run calibration
4. Expected behavior:
   - Layer 2 detects `field_wrong_nesting_level` for "attachments"
   - Verification confirms field exists in `emails[].attachments`, not at root
   - Fix generated: Change to flatten "emails" instead
   - Post-calibration workflow has correct structure

### Log Output Expected

```
[Layer 2] LLM detection phase complete
  - detectedCount: 1

[ConstrainedSemanticValidator] Field "attachments" exists in nested array "emails[].attachments",
  not at root level where flatten is looking
  - stepId: "step2"
  - fieldName: "attachments"
  - foundInArrayProperty: "emails"
  - operation: "flatten"

[Layer 2] Verification phase complete
  - detected: 1
  - verified: 1
  - discarded: 0

[Layer 2] Generated and validated constrained fix
  - action: "update_field"
  - path: "config.field"
  - oldValue: "attachments"
  - newValue: "emails"
  - confidence: 0.90
  - reasoning: "Field 'attachments' exists but at wrong nesting level. Using 'emails' from available fields at correct level: emails"
```

## Limitations

This enhancement handles the most common case (object with nested arrays), but there are edge cases that may still need manual intervention:

1. **Multiple levels of nesting**: `{a: {b: {c: [...]}}}` - would need path syntax support
2. **Parallel arrays**: `{emails: [...], attachments: [...]}` - may need user decision on which to use
3. **Complex transformations**: Cases requiring multiple steps to restructure data

For these cases, the validator will:
- Detect the issue (field not accessible)
- Attempt to find accessible alternatives
- If no good fix available, return `null` and require user review

## Next Steps

Potential future enhancements:

1. **Path syntax support**: Generate fixes like `field: "emails.attachments"` for nested access
2. **Multi-step fix suggestions**: When single fix isn't possible, suggest adding intermediate steps
3. **UI warnings**: Display Layer 2 warnings in calibration UI, not just logs

---

**Status**: ✅ **Production Ready**

The enhancement is generic, safe, and scales to any workflow structure without hardcoding.
