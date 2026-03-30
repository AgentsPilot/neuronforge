# Nested Input Path Resolution Fix - Complete

## Problem Summary

The calibration system was suggesting **incorrect field names** when flatten operations used nested input paths like `{{matching_emails.emails}}`.

### Example Issue:
```json
{
  "input": "{{matching_emails.emails}}",  // Already drills down to emails array
  "config": {
    "field": "emails.attachments"         // WRONG - validator suggested this
  }
}
```

**What should have been suggested**: `"attachments"` (relative to the input context)

**What was suggested**: `"emails.attachments"` (absolute path from root schema)

## Root Cause

**File**: [lib/pilot/WorkflowValidator.ts:336-344](lib/pilot/WorkflowValidator.ts#L336-L344)

The validator only extracted the **variable name** from input references, not the full path:

```typescript
// OLD CODE (BROKEN)
const inputMatch = step.input?.match(/\{\{([a-zA-Z_][a-zA-Z0-9_]*)\}\}/);
//                                        ^^^^^^^^^^^^^^^^^^^^^^^^
//                                        Only captures variable name!

const upstreamStepId = inputMatch[1]; // Gets "matching_emails" only
const upstreamSchema = stepOutputs.get(upstreamStepId);
const arrayFields = this.extractArrayFields(upstreamSchema);
// Returns ["emails", "emails.labels", "emails.attachments"]
```

### What This Missed:

When input is `{{matching_emails.emails}}`:
1. Regex only captured `matching_emails` (ignores `.emails` part)
2. Retrieved root schema for `matching_emails`
3. Extracted array fields from root: `["emails", "emails.labels", "emails.attachments"]`
4. Suggested `"emails.attachments"` (wrong - this assumes we're starting from root)

### What It Should Have Done:

1. Parse full path: `matching_emails.emails`
2. Get `matching_emails` schema
3. **Navigate to `.emails` property**
4. **Get the `.items` schema** (what's inside the emails array)
5. Extract array fields from that level: `["labels", "attachments"]`
6. Suggest `"attachments"` (correct - relative to input context)

## The Solution

### Fix: Parse Full Input Path and Resolve Schema

**File**: [lib/pilot/WorkflowValidator.ts:335-357](lib/pilot/WorkflowValidator.ts#L335-L357)

```typescript
const currentField = step.config.field;
// Parse full input path including nested navigation (e.g., {{matching_emails.emails}})
const inputMatch = step.input?.match(/\{\{([a-zA-Z_][a-zA-Z0-9_.]*)\}\}/);
//                                        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
//                                        Now captures FULL path with dots!
if (!inputMatch) return;

const fullPath = inputMatch[1]; // e.g., "matching_emails.emails"
const pathParts = fullPath.split('.');
const rootVariable = pathParts[0]; // "matching_emails"
const nestedPath = pathParts.slice(1); // ["emails"]

// Get root schema and navigate nested path
let targetSchema = stepOutputs.get(rootVariable);
if (!targetSchema) return;

// Navigate through nested path to get the actual schema we're working with
for (const pathPart of nestedPath) {
  if (targetSchema?.properties?.[pathPart]) {
    targetSchema = targetSchema.properties[pathPart];
  }
  // Handle arrays - get items schema (what's inside the array)
  if (targetSchema?.type === 'array' && targetSchema.items) {
    targetSchema = targetSchema.items;
  }
}

// Get all array fields from the RESOLVED schema (not the root)
const arrayFields = this.extractArrayFields(targetSchema);
```

### How It Works:

**Example 1: `{{matching_emails.emails}}`**

```typescript
fullPath = "matching_emails.emails"
rootVariable = "matching_emails"
nestedPath = ["emails"]

// Step 1: Get matching_emails schema
targetSchema = {
  properties: {
    emails: {
      type: "array",
      items: {
        properties: {
          labels: { type: "array" },
          attachments: { type: "array" }
        }
      }
    }
  }
}

// Step 2: Navigate to .emails
targetSchema = targetSchema.properties["emails"]
// = { type: "array", items: {...} }

// Step 3: Get array items schema
targetSchema = targetSchema.items
// = { properties: { labels: {...}, attachments: {...} } }

// Step 4: Extract array fields from THIS level
arrayFields = ["labels", "attachments"]  // ✅ CORRECT!
```

**Example 2: `{{matching_emails}}` (no nesting)**

```typescript
fullPath = "matching_emails"
rootVariable = "matching_emails"
nestedPath = []  // Empty - no navigation needed

// Get root schema
targetSchema = { properties: { emails: {...} } }

// No navigation needed (nestedPath is empty)

// Extract array fields from root
arrayFields = ["emails", "emails.labels", "emails.attachments"]  // ✅ CORRECT!
```

## Test Results

### Test Script: [scripts/test-nested-input-path-validation.ts](scripts/test-nested-input-path-validation.ts)

```typescript
const workflow = [
  {
    id: 'step1',
    output_variable: 'matching_emails',
    output_schema: {
      properties: {
        emails: {
          type: 'array',
          items: {
            properties: {
              labels: { type: 'array' },
              attachments: { type: 'array' }
            }
          }
        }
      }
    }
  },
  {
    id: 'step2',
    type: 'transform',
    operation: 'flatten',
    input: '{{matching_emails.emails}}',  // Nested path
    config: {
      field: 'emails.attachments'         // WRONG
    }
  }
];

const issues = validator.validateFlattenFields(workflow);
```

**Output**:
```
Found 1 issue(s):

Issue 1:
  Step: step2
  Current field: "emails.attachments"
  Suggested field: "attachments"  ✅ CORRECT!
  Confidence: 0.9
  Upstream step: matching_emails
  Reason: Flatten field "emails.attachments" does not exist in matching_emails.emails output.
          Available array fields: labels, attachments

✅ VALIDATION WORKING - Correctly suggests "attachments" (not "emails.attachments")
   The validator properly resolved {{matching_emails.emails}} to the email items schema
```

## Impact on Real Workflow

### Before Fix:
```json
{
  "step_id": "step2",
  "input": "{{matching_emails.emails}}",
  "config": {
    "field": "emails.attachments"  // ❌ Validator suggested this (WRONG)
  }
}
```

**Result**:
- Flatten tries to extract `emails.attachments` from email items
- Email items don't have `emails` property (they ARE the emails)
- Empty array returned
- Workflow continues with 0 data
- User gets empty results

### After Fix:
```json
{
  "step_id": "step2",
  "input": "{{matching_emails.emails}}",
  "config": {
    "field": "attachments"  // ✅ Validator now suggests this (CORRECT)
  }
}
```

**Result**:
- Flatten extracts `attachments` from email items
- Correct nested arrays extracted
- Workflow continues with actual data
- User gets expected results

## Files Modified

1. **[lib/pilot/WorkflowValidator.ts](lib/pilot/WorkflowValidator.ts)**
   - Enhanced input path parsing to capture full nested paths (line 336)
   - Added schema navigation logic to resolve nested input contexts (lines 339-357)
   - Updated error messages to reference full input path (lines 431, 432, 509)

2. **[scripts/test-nested-input-path-validation.ts](scripts/test-nested-input-path-validation.ts)** (NEW)
   - Test script to validate nested input path resolution

## Related Fixes

This fix builds on the previous nested array field detection work documented in:
- [NESTED-ARRAY-FIELD-FIXES-COMPLETE.md](NESTED-ARRAY-FIELD-FIXES-COMPLETE.md)

Together, these fixes ensure:
1. ✅ Validator detects nested array paths like `emails.attachments` (previous fix)
2. ✅ Validator suggests fields **relative to input context** (this fix)
3. ✅ Calibration loop applies correct fixes automatically

## Key Principles Applied

From [CLAUDE.md](CLAUDE.md):

1. **Fix at Root Cause**: Fixed the validator's input path parsing (responsible for schema resolution) rather than adding workarounds in downstream phases
2. **Schema-Driven**: Solution uses schema structure to navigate nested paths generically
3. **Scalable**: Works for ANY nested input path pattern, not just emails/attachments

## Success Criteria

✅ Validator parses full input paths including nested navigation (e.g., `{{var.nested.path}}`)
✅ Schema resolution navigates to the correct level (handles both objects and arrays)
✅ Field suggestions are relative to input context, not root schema
✅ Test confirms `{{matching_emails.emails}}` → suggests `"attachments"`, not `"emails.attachments"`
✅ Build succeeds with no TypeScript errors

## Next Steps

With this fix complete, the calibration system should now:
1. Detect that `field: "emails.attachments"` is wrong (doesn't exist at input context level)
2. Suggest `field: "attachments"` (exists at email items level)
3. Apply the fix automatically
4. Re-run workflow with correct configuration
5. Produce non-empty results

**To test the complete end-to-end flow**: Re-run calibration on the original workflow with correct input values.
