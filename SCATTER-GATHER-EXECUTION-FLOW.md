# Scatter-Gather Execution Flow & Flattening

## Overview

This document explains how the execution layer (WorkflowPilot → StepExecutor → ParallelExecutor) handles scatter-gather steps and how flattening works during execution.

---

## Execution Architecture

### 1. Entry Point: WorkflowPilot

**File**: `lib/pilot/WorkflowPilot.ts`

- Orchestrates the overall workflow execution
- Iterates through workflow steps sequentially
- Delegates individual step execution to **StepExecutor**

### 2. Step Routing: StepExecutor

**File**: `lib/pilot/StepExecutor.ts` (Lines 411-422)

```typescript
case 'scatter_gather':
  // V4 Format: Nested scatter-gather steps are delegated to ParallelExecutor
  if (!this.parallelExecutor) {
    throw new ExecutionError(
      'Scatter-gather steps require ParallelExecutor to be injected via setParallelExecutor()',
      'MISSING_PARALLEL_EXECUTOR',
      step.id
    );
  }
  logger.info({ stepId: step.id }, 'Delegating scatter-gather step to ParallelExecutor');
  result = await this.parallelExecutor.executeScatterGather(step, context);
  break;
```

**What happens**:
- StepExecutor receives a step of type `scatter_gather`
- Routes it to `ParallelExecutor.executeScatterGather()`
- ParallelExecutor handles all parallel execution logic

---

## 3. Scatter-Gather Execution: ParallelExecutor

**File**: `lib/pilot/ParallelExecutor.ts`

### Phase 1: Input Resolution (Lines 137-219)

```typescript
async executeScatterGather(
  step: ScatterGatherStep,
  context: ExecutionContext
): Promise<any> {
  const { scatter, gather } = step;

  // 1. Resolve input array
  let items = context.resolveVariable?.(scatter.input) ?? [];

  // 2. Handle StepOutput wrapping (auto-extraction)
  // If scatter.input = "{{step1}}" resolves to StepOutput object instead of direct array
  if (items && typeof items === 'object' && !Array.isArray(items)) {
    if (items.stepId && items.data !== undefined) {
      // Extract data field from StepOutput
      const data = items.data;

      if (Array.isArray(data)) {
        // Case 1: data is already an array - use directly
        items = data;
      } else if (data && typeof data === 'object') {
        // Case 2: data is an object - use schema-driven extraction
        const sourcePlugin = data._sourcePlugin;
        const sourceAction = data._sourceAction;
        items = await schemaExtractor.extractArray(data, sourcePlugin, sourceAction);
      }
    }
  }

  // 3. Validate input is array
  if (!Array.isArray(items)) {
    throw new ExecutionError(`Scatter-gather step ${step.id}: input must resolve to an array`);
  }
}
```

**Key Points**:
- `scatter.input` (e.g., `"{{emails}}"`) is resolved from ExecutionContext
- Handles auto-unwrapping if it resolves to a StepOutput object
- Uses **schema-aware extraction** to find array fields in plugin responses

---

### Phase 2: Scatter - Parallel Execution (Lines 224-231)

```typescript
// Scatter: Execute steps for each item in parallel
const scatterResults = await this.executeScatter(
  items,
  scatter.steps,          // Nested steps to run for each item
  scatter.maxConcurrency || this.maxConcurrency,
  scatter.itemVariable || 'item',
  step,
  context
);
```

**What happens**:
1. Splits `items` array into chunks (respecting `maxConcurrency`)
2. For each item, calls `executeScatterItem()`
3. Waits for all parallel executions to complete
4. Returns array of results

---

### Phase 3: Execute Each Item (Lines 301-408)

**File**: `lib/pilot/ParallelExecutor.ts:executeScatterItem()`

```typescript
private async executeScatterItem(
  item: any,
  index: number,
  steps: WorkflowStep[],
  itemVariable: string,
  scatterStep: ScatterGatherStep,
  parentContext: ExecutionContext
): Promise<{ result: any; tokensUsed: number; executionTime: number }> {
  // 1. Clone context for this item (isolated execution)
  const itemContext = parentContext.clone?.(true) ?? parentContext;
  itemContext.setVariable?.(itemVariable, item);    // e.g., {{item}}
  itemContext.setVariable?.('index', index);        // e.g., {{index}}

  const itemResults: any = {};

  // 2. Execute nested steps sequentially for this item
  for (const step of steps) {
    const output = await this.stepExecutor.execute(step, itemContext);

    // Store output in item context
    itemContext.setStepOutput?.(step.id, output);

    // Register output_variable if specified
    const outputVariable = (step as any).output_variable;
    if (outputVariable && itemContext.setVariable) {
      itemContext.setVariable(outputVariable, output.data);
    }

    // Collect result
    itemResults[step.id] = output.data;

    // If step failed, propagate error
    if (!output.metadata.success) {
      throw new ExecutionError(`Scatter item ${index} failed at step ${step.id}`);
    }
  }

  // 3. FLATTEN: Merge original item fields with step results
  let mergedResult: any;

  if (stepResultKeys.length === 1) {
    // Single nested step: Merge original item + step output
    const stepData = itemResults[stepKey];

    if (typeof item === 'object' && typeof stepData === 'object') {
      // FLATTEN: { ...item, ...stepData }
      mergedResult = { ...item, ...stepData };

      // Example:
      // item = { from: "user@example.com", subject: "Invoice #123", body: "..." }
      // stepData = { vendor_name: "Acme Corp", total_amount: 500, date: "2024-01-01" }
      // mergedResult = { from: "user@example.com", subject: "Invoice #123", body: "...", vendor_name: "Acme Corp", total_amount: 500, date: "2024-01-01" }
    }
  } else if (stepResultKeys.length > 1) {
    // Multiple nested steps: Flatten all into original item
    mergedResult = { ...item };
    for (const stepKey of stepResultKeys) {
      const stepData = itemResults[stepKey];
      if (typeof stepData === 'object') {
        mergedResult = { ...mergedResult, ...stepData };
      }
    }
  }

  return {
    result: mergedResult,
    tokensUsed: itemContext.totalTokensUsed ?? 0,
    executionTime: itemContext.totalExecutionTime ?? 0
  };
}
```

**Critical Flattening Logic** (Lines 349-402):
- **Single nested step**: Merges original item fields with step output fields
- **Multiple nested steps**: Sequentially merges all step outputs into original item
- **Result**: Flattened object with all fields accessible

**Example Transformation**:

```javascript
// Input item (from Gmail search)
{
  from: "vendor@acme.com",
  subject: "Invoice #123",
  body: "Total: $500"
}

// Nested step output (AI extraction)
{
  vendor_name: "Acme Corp",
  total_amount: 500,
  invoice_date: "2024-01-01"
}

// Merged result (flattened)
{
  from: "vendor@acme.com",        // Original field
  subject: "Invoice #123",        // Original field
  body: "Total: $500",            // Original field
  vendor_name: "Acme Corp",       // AI-extracted field
  total_amount: 500,              // AI-extracted field
  invoice_date: "2024-01-01"      // AI-extracted field
}
```

---

### Phase 4: Gather - Aggregate Results (Lines 239-245)

```typescript
// Gather: Aggregate results based on operation
const gatheredResult = this.gatherResults(
  scatterResults,           // Array of merged results
  gather.operation,         // "collect", "reduce", "filter", etc.
  gather.reduceExpression   // Optional expression for reduce
);

return gatheredResult;
```

**Gather Operations**:

1. **`collect`** (most common):
   ```javascript
   // Returns array of all merged results
   [
     { from: "...", subject: "...", vendor_name: "Acme", total_amount: 500 },
     { from: "...", subject: "...", vendor_name: "Beta", total_amount: 300 },
     // ...
   ]
   ```

2. **`reduce`**:
   ```javascript
   // Uses reduceExpression to aggregate
   // e.g., "sum(total_amount)" → 800
   ```

3. **`filter`**:
   ```javascript
   // Filters based on condition
   // Only returns items where condition is true
   ```

---

## How Flattening Works in Practice

### Example: Invoice Extraction Workflow

**Step 1**: Search emails
```javascript
// Step ID: "search_emails"
// Output: emails.data.messages = [
//   { from: "vendor1@acme.com", subject: "Invoice #1", body: "..." },
//   { from: "vendor2@beta.com", subject: "Invoice #2", body: "..." }
// ]
```

**Step 2**: Scatter-gather to extract data
```yaml
type: scatter_gather
scatter:
  input: "{{search_emails.data.messages}}"  # Array of emails
  itemVariable: "email"                      # Each item accessible as {{email}}
  steps:
    - id: extract_invoice
      type: ai_processing
      model: gpt-4
      instruction: "Extract vendor_name, total_amount, invoice_date from {{email.body}}"
      output_variable: "invoice_data"
gather:
  operation: collect
```

**Execution Flow**:

1. **ParallelExecutor receives** `items = [email1, email2]`

2. **For each email** (in parallel):
   ```javascript
   // Item context for email1:
   item = { from: "vendor1@acme.com", subject: "Invoice #1", body: "..." }

   // Execute nested step "extract_invoice":
   stepData = {
     vendor_name: "Acme Corp",
     total_amount: 500,
     invoice_date: "2024-01-01"
   }

   // FLATTEN (merge):
   mergedResult = {
     from: "vendor1@acme.com",      // Original
     subject: "Invoice #1",         // Original
     body: "...",                   // Original
     vendor_name: "Acme Corp",      // AI-extracted
     total_amount: 500,             // AI-extracted
     invoice_date: "2024-01-01"     // AI-extracted
   }
   ```

3. **Gather results**:
   ```javascript
   scatterResults = [
     { from: "vendor1@acme.com", subject: "Invoice #1", vendor_name: "Acme Corp", total_amount: 500, ... },
     { from: "vendor2@beta.com", subject: "Invoice #2", vendor_name: "Beta Inc", total_amount: 300, ... }
   ]
   ```

4. **Final output** (stored as `step2.data`):
   ```javascript
   [
     { from: "vendor1@acme.com", subject: "Invoice #1", vendor_name: "Acme Corp", total_amount: 500, invoice_date: "2024-01-01", body: "..." },
     { from: "vendor2@beta.com", subject: "Invoice #2", vendor_name: "Beta Inc", total_amount: 300, invoice_date: "2024-01-15", body: "..." }
   ]
   ```

---

## Key Architectural Decisions

### 1. Why Flatten Automatically?

**Problem**: Without flattening, downstream steps can't access both original and AI-extracted fields.

**Example**:
```yaml
# Without flattening (BAD):
step3_output = {
  step2: {
    vendor_name: "Acme Corp",
    total_amount: 500
  }
}
# Can't access original email fields! Need {{step3.step2.vendor_name}} (awkward)

# With flattening (GOOD):
step3_output = {
  from: "vendor@acme.com",
  subject: "Invoice #1",
  vendor_name: "Acme Corp",
  total_amount: 500
}
# Can access both: {{step3.from}}, {{step3.vendor_name}}
```

### 2. Why Schema-Aware Extraction?

**Problem**: Plugin responses have different structures. Hardcoding field names doesn't scale.

**Solution**: Use plugin schemas to identify array fields dynamically.

**Example**:
```javascript
// Gmail plugin: emails.messages
// Google Drive plugin: files.items
// Notion plugin: results.data

// schemaExtractor.extractArray() automatically finds the array field
```

---

## Batch Calibration Mode

**Special Behavior** (Lines 414-427):

```typescript
if (parentContext.batchCalibrationMode) {
  // STOP execution immediately on first error
  throw error; // Re-throw to stop workflow
}
```

**Why**:
- In batch calibration, we want to detect issues early
- Don't waste resources processing remaining items if one fails
- Error gets logged in `IssueCollector` for auto-repair analysis

---

## Summary: Execution Flow Diagram

```
WorkflowPilot
    │
    ├─> StepExecutor.execute(step)
    │       │
    │       └─> ParallelExecutor.executeScatterGather(step, context)
    │               │
    │               ├─> Resolve input array (auto-unwrap StepOutput)
    │               │
    │               ├─> executeScatter(items, nestedSteps, ...)
    │               │       │
    │               │       └─> For each item (parallel):
    │               │               │
    │               │               ├─> Clone context (isolated)
    │               │               ├─> Set {{item}}, {{index}} variables
    │               │               ├─> Execute nested steps sequentially
    │               │               │       │
    │               │               │       └─> StepExecutor.execute(nestedStep, itemContext)
    │               │               │
    │               │               └─> FLATTEN: Merge item + stepResults
    │               │                       │
    │               │                       └─> { ...item, ...stepData }
    │               │
    │               └─> gatherResults(scatterResults, operation)
    │                       │
    │                       └─> Return aggregated array
    │
    └─> Continue to next workflow step
```

---

## Related Files

1. **Execution Layer**:
   - `lib/pilot/WorkflowPilot.ts` - Main orchestrator
   - `lib/pilot/StepExecutor.ts` - Step routing
   - `lib/pilot/ParallelExecutor.ts` - Scatter-gather logic

2. **Context Management**:
   - `lib/pilot/ExecutionContext.ts` - Variable resolution

3. **Schema Extraction**:
   - `lib/pilot/utils/SchemaAwareDataExtractor.ts` - Dynamic array extraction

4. **Batch Calibration**:
   - `lib/pilot/shadow/IssueCollector.ts` - Uses `flattenSteps()` to analyze nested structures
   - `app/api/v2/calibrate/batch/route.ts` - Lines 833-989 enhance scatter-gather errors

---

## Common Pitfalls

### 1. Using `{{stepX}}` instead of `{{stepX.data.field}}`

**Problem**: Resolves to StepOutput object, not array.

**Solution**: ParallelExecutor auto-unwraps via schema extraction.

### 2. Missing Fields After Scatter-Gather

**Problem**: Forgot that flattening merges fields.

**Example**:
```yaml
# Correct usage:
- type: transform
  input: "{{scatter_step}}"  # Already flattened!
  operation: filter
  where: "total_amount > 100"  # Can access AI-extracted field directly
```

### 3. Batch Calibration Error Detection

**Problem**: Scatter-gather errors get buried in nested execution.

**Solution**: `IssueCollector.flattenSteps()` recursively scans nested steps to find errors and propose auto-repairs.

---

## Conclusion

The execution layer handles scatter-gather steps with:
1. **Auto-unwrapping** StepOutput objects
2. **Schema-aware** array extraction
3. **Automatic flattening** to merge original + AI-extracted fields
4. **Parallel execution** with concurrency control
5. **Batch calibration** error detection via recursive flattening

This design ensures downstream steps can seamlessly access both original data (e.g., email metadata) and AI-extracted data (e.g., invoice fields) without complex nested references.
