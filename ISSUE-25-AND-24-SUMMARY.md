# Critical Issues #24 & #25 - Summary

**Date**: 2026-03-22
**Workflow**: Invoice Extraction (Agent ID: 43ffbc8a-406d-4a43-9f3f-4e7554160eda)
**Status**: Identified during calibration testing

---

## Issue #24: AI Steps Receive Entire Execution Context (Token Limit Exceeded)

### Symptom
```
Error: Iteration 1 exceeded token limit: 66437 tokens (limit: 50000)
Execution stopped to prevent credit exhaustion
```

### What Happened

**Step15** (AI email generation) failed because it received **ALL execution data** as context:

**Token Breakdown:**
- **Input tokens**: 65,725 tokens
- **Output tokens**: 712 tokens
- **Total**: 66,437 tokens
- **Limit**: 50,000 tokens
- **Cost**: $0.17 (for one failed attempt!)

### Root Cause

The workflow generator creates AI processing steps that receive the **entire execution trace** instead of just the variables they need.

**Current Behavior:**
```json
{
  "step15": {
    "action": "ai_process",
    "instruction": "Create HTML email digest with table..."
    // Receives: ALL 65k tokens of execution data
  }
}
```

**What Step15 Actually Needs:**
- Just the summarized item data (vendor, amount, date, etc.)
- ~5-10k tokens maximum

**What It's Getting:**
- All email search results
- All attachment content (base64 data!)
- All extracted fields
- All file upload metadata
- All share link results
- All spreadsheet update responses
- All intermediate processing steps
- = 65k+ tokens

### Example of Unnecessary Data

Step15 is receiving base64 PDF content like:
```
"attachment_content": {
  "data": "JVBERi0xLjQKJeLjz9MNCiU4MzQyMjIxNCAwIG9iago8PC9MZW5ndGggNTAyMy9GaWx0ZXIvRmxhdGVEZWNvZGU+PnN0cmVhbQp42u1dCVhTV9ru5JKEsASykB0SkrAEC..."  // 20,000+ tokens of base64!
}
```

It doesn't need this! It only needs:
```json
{
  "vendor": "ACME Corp",
  "amount": "100.00",
  "date": "2024-01-15",
  "drive_link": "https://..."
}
```

### Generation Fix Required

**When generating AI processing steps:**

1. **Parse the instruction** to identify which variables are referenced
2. **Only include those variables** in the AI context
3. **Never include the full execution trace** unless explicitly needed

**Implementation:**
```typescript
function generateAIStepContext(
  instruction: string,
  allVariables: Record<string, any>
): Record<string, any> {

  // Extract variable references from instruction
  const referencedVars = extractVariableReferences(instruction);
  // e.g., ["{{processed_items}}", "{{config.digest_recipient}}"]

  // Build minimal context with ONLY referenced variables
  const context: Record<string, any> = {};

  for (const varRef of referencedVars) {
    const varName = parseVariableName(varRef); // "processed_items"
    context[varName] = allVariables[varName];
  }

  return context; // Much smaller!
}
```

**Better: Add Summarization Step**

For workflows that process large data volumes, insert a summarization step:

```json
{
  "step14": {
    "action": "ai_process",
    "instruction": "Extract ONLY these fields from each item: vendor, date, amount, invoice_number, drive_link. Return as JSON array.",
    "input": "{{processed_items}}",
    "output_variable": "summarized_items"
  },
  "step15": {
    "action": "ai_process",
    "instruction": "Create HTML email digest from {{summarized_items}}",
    "input": "{{summarized_items}}"  // Small, clean data
  }
}
```

### LLM Prompt Enhancement

```
When generating AI processing steps:

CRITICAL: AI steps should receive ONLY the data they need, not the full execution context.

Rules:
1. Parse the instruction to find variable references
2. Include ONLY those variables in the AI context
3. If workflow has processed large data (files, base64, etc.), add a summarization step BEFORE the AI step
4. NEVER pass base64 file content to AI steps unless the instruction specifically asks to process file content

Example:
Instruction: "Create email digest from {{items}}"
✅ CORRECT: Only pass "items" variable
❌ WRONG:   Pass entire execution trace with all step outputs

If items contain large nested data:
✅ CORRECT: Add summarization step first to extract only needed fields
❌ WRONG:   Pass full nested objects with file content, metadata, etc.
```

### Priority
**P0 - CRITICAL**

**Why Critical:**
- Blocks workflow completion
- Wastes API credits on failed attempts
- Exponentially worse as data volume increases
- Will hit limits on ANY workflow processing multiple files/emails

### Affected Workflows
- Any workflow with AI steps after scatter-gather
- Any workflow processing files/attachments
- Any workflow with multi-step data transformations
- Estimated: 60-70% of generated workflows

---

## Issue #25: Filter Conditions Don't Use Full Nested Paths

### Symptom
```
Step11: system.transform (0 items)
Filter: amount >= 10
Input: 2 items (amounts: 100.00, 150.00)
Output: 0 items
```

Filter passes 0 items even though both items clearly match the condition.

### What Happened

**Step11** is supposed to filter items where amount >= 10 to send to spreadsheet.

**Input Data Structure:**
```json
{
  "processed_items": {
    "0": {
      "filename": "Receipt-2224.pdf",
      "extracted_fields": {
        "vendor": "ACME Corp",
        "amount": "100.00",  // ← Amount is HERE (nested 2 levels)
        "date": "2024-01-15"
      },
      "drive_file": {...},
      "shared_file": {...}
    },
    "1": {
      "filename": "Invoice-XYZ.pdf",
      "extracted_fields": {
        "amount": "150.00"  // ← And HERE
      }
    }
  }
}
```

**Generated Filter Config:**
```json
{
  "step11": {
    "action": "transform",
    "operation": "filter",
    "config": {
      "input": "{{processed_items}}",
      "condition": {
        "field": "amount",  // ❌ WRONG - looking for "amount" at root level
        "operator": ">=",
        "value": "10"
      }
    }
  }
}
```

**What the Filter Does:**
1. Loops through `processed_items` (2 items)
2. For each item, tries to find field `amount`
3. Looks at: `item.amount` → **undefined** (amount is at `item.extracted_fields.amount`)
4. Condition: `undefined >= 10` → **false**
5. Filters out all items
6. Returns: **empty array**

### Root Cause

**Workflow generator creates filter with shallow field paths, doesn't account for nested data structures.**

**Should Generate:**
```json
{
  "condition": {
    "field": "extracted_fields.amount",  // ✅ CORRECT - full nested path
    "operator": ">=",
    "value": "10"
  }
}
```

**Or even better, use item context:**
```json
{
  "condition": {
    "field": "item.extracted_fields.amount",  // ✅ EXPLICIT
    "operator": ">=",
    "value": "10"
  }
}
```

### Why This is Silent and Dangerous

1. **No error thrown** - Filter successfully returns empty array
2. **Workflow continues** - Next steps process empty data
3. **Appears successful** - Workflow status: "completed"
4. **User sees nothing** - Spreadsheet empty, email says "no items found"
5. **Hard to debug** - Logs just show "0 items" without explaining WHY

### Calibration Tried to Fix It (But Failed)

Calibration detected the issue and tried to fix:
```
Pre-flight auto-fix: fix_operation_field (filter - complex)
Changed: "item.amount" → "amount"
```

But this made it WORSE:
- Before: Looking for `item.amount` (wrong but closer)
- After: Looking for `amount` (even more wrong)

**Correct fix would be:**
```
Changed: "item.amount" → "item.extracted_fields.amount"
```

### Generation Fix Required

**When generating filter operations:**

1. **Analyze input schema** to understand data structure
2. **Find the actual field path** by traversing schema
3. **Generate full nested path** from item root to field

**Implementation:**
```typescript
function generateFilterCondition(
  userIntent: string,  // e.g., "filter items where amount > 10"
  inputVariable: VariableRef,
  inputSchema: OutputSchema
): FilterCondition {

  // Extract field name from intent
  const fieldName = extractFieldName(userIntent); // "amount"

  // Find where this field actually exists in schema
  const fieldPath = findFieldInSchema(inputSchema, fieldName);
  // e.g., finds "amount" at path: "extracted_fields.amount"

  return {
    field: fieldPath,  // "extracted_fields.amount" (full path)
    operator: extractOperator(userIntent),  // ">="
    value: extractValue(userIntent)  // "10"
  };
}

function findFieldInSchema(
  schema: OutputSchema,
  fieldName: string,
  currentPath: string = ""
): string | null {

  // Check if field exists at current level
  if (schema.properties?.[fieldName]) {
    return currentPath ? `${currentPath}.${fieldName}` : fieldName;
  }

  // Recursively search nested objects
  for (const [propName, propSchema] of Object.entries(schema.properties || {})) {
    if (propSchema.type === 'object') {
      const found = findFieldInSchema(
        propSchema,
        fieldName,
        currentPath ? `${currentPath}.${propName}` : propName
      );
      if (found) return found;
    }
  }

  return null;
}
```

**Validation at Generation Time:**
```typescript
function validateFilterField(
  field: string,
  inputSchema: OutputSchema
): void {

  const fieldExists = checkFieldPath(inputSchema, field);

  if (!fieldExists) {
    throw new Error(
      `Filter field '${field}' not found in schema. ` +
      `Available fields: ${getAllFieldPaths(inputSchema).join(', ')}`
    );
  }
}
```

### LLM Prompt Enhancement

```
When generating filter operations:

CRITICAL: Field paths must be FULL paths from item root to the field.

Rules:
1. Analyze the input schema to find WHERE the field exists
2. Use the COMPLETE path with all intermediate levels
3. Test: can you access item[field_path] successfully?

Examples:

Schema: { extracted_fields: { amount: "100" } }
✅ CORRECT: field: "extracted_fields.amount"
❌ WRONG:   field: "amount"

Schema: { user: { profile: { email: "..." } } }
✅ CORRECT: field: "user.profile.email"
❌ WRONG:   field: "email"
❌ WRONG:   field: "profile.email"

Always validate the field exists before generating the filter!
```

### Priority
**P0 - CRITICAL**

**Why Critical:**
- **Silent data loss** - No error, workflow appears successful
- **Blocks core functionality** - Filtering is fundamental operation
- **Affects business logic** - Users rely on filters for conditional processing
- **Hard to debug** - Logs don't explain why 0 items returned

### Affected Workflows
- Any workflow with filter operations on nested data
- Workflows after scatter-gather (items always nested)
- Workflows processing API responses (nested JSON)
- Estimated: 50-60% of generated workflows

---

## Impact Summary

### Combined Effect on Invoice Extraction Workflow

1. ✅ **Steps 1-10**: Completed successfully (with our fixes for step9)
2. ❌ **Step11** (Issue #25): Filter returns 0 items → No data for spreadsheet
3. ❌ **Step13**: Spreadsheet append receives empty array → No rows added
4. ❌ **Step15** (Issue #24): Token limit exceeded trying to generate email

**Result**:
- Workflow appears to "complete" steps 1-10
- No data written to spreadsheet (silent failure)
- No email sent (explicit failure)
- User sees: "Workflow failed" with confusing error about tokens

### Without These Issues

1. ✅ Steps 1-10: Complete successfully
2. ✅ **Step11**: Filter 2 items (amount >= 10) → 2 items pass
3. ✅ **Step13**: Append 2 rows to spreadsheet → Data visible
4. ✅ **Step15**: Generate email with 2k tokens → Email sent

**Result**: Workflow completes end-to-end successfully

---

## Recommendations

### Immediate Fixes (P0)

**Issue #24 - Token Limit:**
1. Add summarization step before AI email generation
2. Scope AI context to only referenced variables
3. Add token usage warnings in UI

**Issue #25 - Filter Paths:**
1. Validate filter field paths against schema during generation
2. Implement schema traversal to find correct nested paths
3. Add runtime warning when filter returns 0 items from non-empty input

### Long-Term Solutions

1. **Schema-Driven Generation**: Use output schemas to validate ALL field references
2. **Smart Context Scoping**: Automatically minimize AI step contexts
3. **Execution Warnings**: Alert when operations produce unexpected results (0 items from N)
4. **Better Calibration**: Teach calibration to fix nested path issues correctly

---

## Files to Update

### For Issue #24 (Token Limit)
- `/lib/agentkit/v6/compiler/IntentToIRConverter.ts` - Scope AI step contexts
- `/lib/pilot/StepExecutor.ts` - Add token usage tracking/warnings
- LLM system prompts - Add context scoping rules

### For Issue #25 (Filter Paths)
- `/lib/agentkit/v6/compiler/IntentToIRConverter.ts` - Fix filter field path generation
- `/lib/pilot/StepExecutor.ts` - Add filter result validation
- `/lib/pilot/WorkflowValidator.ts` - Validate filter paths against schema
- LLM system prompts - Add nested path rules

---

## Success Metrics

**Current State:**
- 0% workflows complete with correct data (silent failures)
- High token costs on failures
- Users don't understand why workflows "succeed" with no output

**After Fixes:**
- 95%+ workflows complete with correct data
- Token usage reduced 10-20x for AI steps
- Clear errors when data operations fail

---

**Status**: Both issues documented and ready for workflow generator team
**Next Steps**: Implement fixes in generation layer per recommendations above
