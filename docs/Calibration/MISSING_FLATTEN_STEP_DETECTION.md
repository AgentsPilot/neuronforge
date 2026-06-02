# Missing Flatten Step Detection & Auto-Insertion

> **Status**: ✅ Implemented (logic lives in `MultiStepStructuralDetector`)
> **Last Updated**: 2026-06-02

## Problem

The current calibration system detects **field name errors** but not **missing structural steps**.

### Example: Gmail → Flatten Attachments Workflow

**Current Workflow**:
```
Step1 (Gmail): Returns {emails: [{attachments: [...]}]}
Step2 (Flatten): field: "emails" → Returns [{id, subject, attachments: [...]}]
  ❌ Output schema expects: [{attachment_id, filename, ...}]
  ❌ Actual output: [{id, subject, attachments: [...]}]
  ❌ Result: Empty array (schema mismatch)
```

**What's Missing**: A second flatten step to extract attachments from each email.

**Correct Workflow**:
```
Step1 (Gmail): Returns {emails: [{attachments: [...]}]}
Step2 (Flatten "emails"): Returns [{id, subject, attachments: [...]}]
Step2a (Flatten "attachments"): Returns [{attachment_id, filename, ...}] ✅
Step3 (Filter PDFs): ...
```

## Root Cause

The workflow was **originally designed** to flatten nested `attachments` directly, but this is structurally impossible when attachments are nested inside emails. Layer 1 correctly fixed the field name to `"emails"` (the only accessible array), but the output schema still describes attachment properties.

**Key Indicators**:
1. ✅ Flatten field is correct (`"emails"`)
2. ❌ Output schema describes fields that don't exist in flattened result
3. ❌ Output schema describes fields that exist in **nested array** (`emails[].attachments[]`)
4. ⚠️ `custom_code` description mentions extracting nested data ("attachments")

## Solution: Multi-Step Structural Repair

### Detection Logic (Layer 2 Enhancement)

**New Issue Type**: `missing_intermediate_flatten_step`

**Detection Criteria**:
1. Step is a flatten operation with valid field
2. Step's output schema expects fields that don't exist at current nesting level
3. Those fields exist in a **nested array** within the flattened items
4. Step description/custom_code mentions the nested field

**Example Detection**:
```typescript
Step2:
  - operation: "flatten"
  - field: "emails" ✅ (valid root-level array)
  - output_schema.items.properties: {attachment_id, filename, message_id}
  - source_schema: emails[].properties: {id, subject, attachments: [{attachment_id, filename}]}

Detection:
  ✅ Field "emails" is accessible at root level
  ❌ Output field "attachment_id" not in flattened result (exists in emails[].attachments[])
  ❌ Output field "filename" not in flattened result (exists in emails[].attachments[])
  ⚠️ custom_code mentions "Extract attachments array"

Issue: missing_intermediate_flatten_step
  - currentField: "emails"
  - targetField: "attachments" (detected from output schema + nested location)
  - insertAfter: "step2"
```

### Auto-Fix: Insert Intermediate Step

**Fix Action**: `insert_flatten_step`

```typescript
{
  action: 'insert_flatten_step',
  targetStepId: 'step2',
  insertPosition: 'after',
  newStep: {
    id: 'step2a', // Generate unique ID
    type: 'transform',
    operation: 'flatten',
    input: '{{all_attachments}}', // Use step2's output_variable
    config: {
      type: 'flatten',
      field: 'attachments', // The nested array field
      input: 'all_attachments'
    },
    description: 'Extract attachments from each email (auto-inserted by calibration)',
    output_variable: 'flattened_attachments',
    output_schema: {
      // Copy from step2's current output_schema (which describes attachments)
      type: 'array',
      items: {
        type: 'object',
        properties: {
          attachment_id: {...},
          filename: {...},
          message_id: {...}
        }
      }
    }
  },
  updateOriginalStep: {
    stepId: 'step2',
    changes: {
      // Update step2's output_schema to match what flattening "emails" actually produces
      output_schema: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: {type: 'string'},
            subject: {type: 'string'},
            from: {type: 'string'},
            attachments: {type: 'array', items: {...}}
          }
        }
      }
    }
  },
  updateDownstreamStep: {
    stepId: 'step3', // The step that uses step2's output
    changes: {
      // Update input reference from step2 to new step2a
      input: '{{flattened_attachments}}' // was '{{all_attachments}}'
    }
  },
  confidence: 0.85,
  reasoning: 'Flatten "emails" returns email objects, but output schema expects attachment properties. Detected "attachments" as nested array field. Inserting intermediate flatten step to extract attachments from emails.'
}
```

### Implementation Plan

#### Phase 1: Detection in ConstrainedSemanticValidator

**File**: `/lib/pilot/shadow/ConstrainedSemanticValidator.ts`

**New Method**: `detectMissingIntermediateFlatten()`

```typescript
private detectMissingIntermediateFlatten(
  step: WorkflowStep,
  agent: Agent
): DetectedIssue | null {
  // Only check flatten operations
  if (step.operation !== 'flatten' && step.config?.type !== 'flatten') {
    return null;
  }

  const field = step.config?.field;
  if (!field) return null; // Already handled by Layer 1

  const sourceStep = this.findSourceStep(step, agent.pilot_steps || []);
  if (!sourceStep?.output_schema) return null;

  // Check if field is accessible (Layer 1 validation)
  const isAccessible = this.isFieldAccessibleAtCorrectLevel(
    sourceStep.output_schema,
    field,
    step
  );

  if (!isAccessible) return null; // Field issues handled separately

  // Now check if output schema matches what flatten will actually produce
  const actualOutputFields = this.getActualFlattenOutputFields(
    sourceStep.output_schema,
    field
  );

  const declaredOutputFields = Object.keys(
    step.output_schema?.items?.properties || {}
  );

  // Find fields in declared output that don't exist in actual output
  const missingFields = declaredOutputFields.filter(
    f => !actualOutputFields.includes(f)
  );

  if (missingFields.length === 0) return null; // Output schema matches reality

  // Check if missing fields exist in a nested array
  const nestedArrayField = this.findNestedArrayWithFields(
    sourceStep.output_schema,
    field,
    missingFields
  );

  if (!nestedArrayField) return null; // Missing fields not in nested array

  return {
    stepId: step.step_id || step.id,
    issueType: 'missing_intermediate_flatten_step',
    problematicField: nestedArrayField,
    description: `Flatten "${field}" returns objects with "${nestedArrayField}" array, but output schema expects fields from inside that nested array (${missingFields.join(', ')}). Need intermediate flatten step for "${nestedArrayField}".`,
    confidence: 0.85
  };
}

private getActualFlattenOutputFields(
  sourceSchema: any,
  field: string
): string[] {
  // If source is object, get properties of the array field
  if (sourceSchema.type === 'object' && sourceSchema.properties?.[field]) {
    const arraySchema = sourceSchema.properties[field];
    if (arraySchema.items?.properties) {
      return Object.keys(arraySchema.items.properties);
    }
  }

  // If source is array, get properties of array items
  if (sourceSchema.type === 'array' && sourceSchema.items?.properties) {
    return Object.keys(sourceSchema.items.properties);
  }

  return [];
}

private findNestedArrayWithFields(
  sourceSchema: any,
  field: string,
  missingFields: string[]
): string | null {
  // Get the flattened result schema
  let resultItemSchema: any;

  if (sourceSchema.type === 'object' && sourceSchema.properties?.[field]) {
    resultItemSchema = sourceSchema.properties[field].items;
  } else if (sourceSchema.type === 'array') {
    resultItemSchema = sourceSchema.items;
  } else {
    return null;
  }

  if (!resultItemSchema?.properties) return null;

  // Look for array fields in the result that contain the missing fields
  for (const [propName, propSchema] of Object.entries(resultItemSchema.properties)) {
    const prop = propSchema as any;

    if (prop.type === 'array' && prop.items?.properties) {
      // Check if this nested array contains the missing fields
      const nestedFields = Object.keys(prop.items.properties);
      const matchCount = missingFields.filter(f => nestedFields.includes(f)).length;

      // If most missing fields exist in this nested array, it's likely the target
      if (matchCount >= missingFields.length * 0.7) {
        return propName;
      }
    }
  }

  return null;
}
```

#### Phase 2: Fix Generation

**New Method**: `generateIntermediateFlattenStepFix()`

```typescript
private async generateIntermediateFlattenStepFix(
  issue: DetectedIssue,
  agent: Agent
): Promise<MultiStepFix | null> {
  const step = this.findStep(agent.pilot_steps || [], issue.stepId);
  if (!step) return null;

  const sourceStep = this.findSourceStep(step, agent.pilot_steps || []);
  if (!sourceStep) return null;

  // Generate new step ID (insert after current step)
  const newStepId = this.generateStepId(agent.pilot_steps, step.id);

  // Find the downstream step that uses current step's output
  const downstreamStep = this.findDownstreamStep(step, agent.pilot_steps || []);

  return {
    action: 'insert_flatten_step',
    targetStepId: issue.stepId,
    newStep: {
      id: newStepId,
      type: 'transform',
      operation: 'flatten',
      input: `{{${step.output_variable}}}`,
      config: {
        type: 'flatten',
        field: issue.problematicField, // The nested array field
        input: step.output_variable
      },
      description: `Extract ${issue.problematicField} from each item (auto-inserted by calibration)`,
      output_variable: `flattened_${issue.problematicField}`,
      output_schema: step.output_schema, // Transfer declared schema to new step
      dependencies: [issue.stepId]
    },
    updateSteps: [
      {
        stepId: issue.stepId,
        changes: {
          // Update original step's output schema to match reality
          output_schema: this.inferActualOutputSchema(sourceStep.output_schema, step.config.field)
        }
      },
      ...(downstreamStep ? [{
        stepId: downstreamStep.step_id || downstreamStep.id,
        changes: {
          // Update downstream input reference
          input: `{{flattened_${issue.problematicField}}}`
        }
      }] : [])
    ],
    verified: true,
    confidence: 0.85,
    reasoning: `Flatten "${step.config.field}" produces objects with nested "${issue.problematicField}" array. Output schema expects fields from inside that array. Inserting intermediate flatten step.`
  };
}
```

#### Phase 3: Fix Application

**Modify**: `applyFix()` method to handle `insert_flatten_step` action

```typescript
case 'insert_flatten_step': {
  const { newStep, updateSteps, targetStepId } = fix;

  // Find insertion index
  const targetIndex = agent.pilot_steps.findIndex(
    s => (s.step_id || s.id) === targetStepId
  );

  if (targetIndex === -1) return false;

  // Insert new step after target
  agent.pilot_steps.splice(targetIndex + 1, 0, newStep);

  // Update affected steps
  for (const update of updateSteps) {
    const stepToUpdate = agent.pilot_steps.find(
      s => (s.step_id || s.id) === update.stepId
    );

    if (stepToUpdate) {
      Object.assign(stepToUpdate, update.changes);
    }
  }

  logger.info({
    newStepId: newStep.id,
    insertedAfter: targetStepId,
    updatedSteps: updateSteps.map(u => u.stepId)
  }, 'Inserted intermediate flatten step');

  return true;
}
```

## Expected Behavior

### Before Enhancement

```
Calibration detects:
  ✅ Layer 1: field "emails" is correct
  ⚠️ Execution: Returns empty results
  ❌ No structural fix suggested

Result: Workflow "succeeds" but produces no output
```

### After Enhancement

```
Calibration detects:
  ✅ Layer 1: field "emails" is correct
  ✅ Layer 2: Output schema mismatch - missing intermediate flatten

Layer 2 proposes:
  - Insert step2a: Flatten "attachments" from emails
  - Update step2 output_schema to match email objects
  - Update step3 input reference to use step2a output

Auto-fix applied:
  Step2: Flatten "emails" → [{id, subject, attachments: [...]}]
  Step2a (NEW): Flatten "attachments" → [{attachment_id, filename, ...}] ✅
  Step3: Filter PDFs from flattened_attachments ✅

Result: Workflow produces expected results
```

## Confidence & Risk

**Confidence**: 0.85 (high)
- Deterministic detection (schema analysis)
- Clear structural pattern (nested array)
- Safe insertion (no data loss)

**Risk**: Low
- New step is idempotent
- Original data preserved in intermediate variable
- Downstream updates are traceable

**User Notification**: Medium-confidence fix (0.70-0.84 range)
- Notify user: "Added intermediate flatten step for 'attachments'"
- Show before/after workflow structure
- Allow review before production deployment

## Testing

### Test Case 1: Gmail → Flatten Attachments

**Input Workflow**:
```json
[
  {
    "id": "step1",
    "output_schema": {
      "type": "object",
      "properties": {
        "emails": {
          "type": "array",
          "items": {
            "properties": {
              "attachments": {"type": "array", "items": {...}}
            }
          }
        }
      }
    }
  },
  {
    "id": "step2",
    "operation": "flatten",
    "config": {"field": "emails"},
    "output_schema": {
      "type": "array",
      "items": {
        "properties": {
          "attachment_id": {...},
          "filename": {...}
        }
      }
    }
  }
]
```

**Expected Detection**:
```
Issue: missing_intermediate_flatten_step
  - stepId: "step2"
  - problematicField: "attachments"
  - confidence: 0.85
```

**Expected Fix**:
```json
[
  {"id": "step1", ...},
  {
    "id": "step2",
    "config": {"field": "emails"},
    "output_schema": {
      "items": {
        "properties": {"id": ..., "attachments": [...]}
      }
    }
  },
  {
    "id": "step2a",
    "operation": "flatten",
    "config": {"field": "attachments"},
    "output_schema": {
      "items": {
        "properties": {"attachment_id": ..., "filename": ...}
      }
    }
  }
]
```

## Limitations

**Cases NOT handled**:
1. **Triple-nested arrays**: `{a: [{b: [{c: [...]}]}]}` - would need multiple insertions
2. **Ambiguous nesting**: Multiple nested arrays with similar fields
3. **Cross-step dependencies**: When multiple steps need restructuring

**Mitigation**:
- Return `null` for ambiguous cases (no auto-fix)
- Log warning for complex nesting structures
- Suggest manual review for triple-nested scenarios

## Future Enhancements

1. **Multi-level insertion**: Detect and insert multiple flatten steps for deeply nested data
2. **Alternative patterns**: Suggest scatter-gather instead of multiple flattens
3. **UI visualization**: Show before/after workflow graph
4. **Rollback support**: Allow reverting structural changes

---

**Status**: 📋 **Planned for Implementation**

This enhancement would make the calibration system truly intelligent - not just fixing field names, but restructuring workflows to match their intended semantic behavior.
