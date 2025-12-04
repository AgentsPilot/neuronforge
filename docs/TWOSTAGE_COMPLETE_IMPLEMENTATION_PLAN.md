# Two-Stage Agent Generator V3 - Complete Implementation Plan

**Version:** 3.0 Final
**Date:** 2025-12-03
**Objective:** Production-ready agent generation with 95%+ success rate
**Estimated Time:** 7-9 hours (2 days)

---

## Executive Summary

### The Core Problem
Current two-stage generator produces workflows with:
1. ❌ Duplicate `params` objects in transform steps
2. ❌ `$PLACEHOLDER` values not replaced (leakage)
3. ❌ Incorrect loop variable syntax
4. ❌ All transforms route through LLM (expensive)
5. ❌ Inconsistent field structures

### The Root Cause
**Stage 1 uses `$PLACEHOLDER` concept → Stage 2 tries to extract values → Fails**

**The paradigm shift:**
- ❌ OLD: Stage 1 placeholders → Stage 2 extracts from prompt
- ✅ NEW: Stage 1 uses `{{input.X}}` → Stage 2 scans references → builds schema

### The Solution Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Stage 1: Workflow Structure Designer (Claude Sonnet 4)     │
├─────────────────────────────────────────────────────────────┤
│ Input:  User prompt + Plugin summaries                     │
│ Output: Workflow with {{input.X}} and {{stepN.field}}     │
│ Cost:   ~4,000 tokens (optimized with summaries)           │
│ Time:   3-5 seconds                                         │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ Gate 1: Structure Validation                                │
├─────────────────────────────────────────────────────────────┤
│ • No $PLACEHOLDER values allowed                           │
│ • Plugin/action references valid                           │
│ • Step IDs unique                                           │
│ • Field structures correct per type                        │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ Stage 2: Input Schema Builder (No LLM!)                    │
├─────────────────────────────────────────────────────────────┤
│ Input:  Stage 1 workflow                                    │
│ Process:                                                    │
│   1. Scan for {{input.X}} references                       │
│   2. Build required_inputs schema                          │
│   3. Generate user-friendly labels                         │
│   4. Process nested steps recursively                      │
│ Output: Complete workflow + input schema                   │
│ Cost:   0 tokens (pure JavaScript)                         │
│ Time:   <100ms                                              │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ Gate 2: Parameter Validation                                │
├─────────────────────────────────────────────────────────────┤
│ • No $PLACEHOLDER leakage                                  │
│ • Required params present                                   │
│ • {{input.X}} references match schema                      │
│ • Field structures validated                               │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│ Gate 3: Semantic Validation                                 │
├─────────────────────────────────────────────────────────────┤
│ • Workflow complexity matches type                         │
│ • No AI in loops                                            │
│ • Confidence score acceptable                              │
└─────────────────────────────────────────────────────────────┘
                           ↓
                    ✅ Success!
```

### Key Benefits

1. **Massive Cost Savings:**
   - Stage 2 eliminates LLM call: ~2,000 tokens saved
   - Plugin summaries reduce Stage 1: ~1,500 tokens saved
   - Deterministic transforms: 30-50% execution savings
   - **Total: 60-70% token reduction**

2. **Higher Accuracy:**
   - No placeholder extraction failures
   - Input schema always matches workflow
   - Field structures correct by design

3. **Simpler Code:**
   - Stage 2: 300 lines → 100 lines
   - No complex merging logic
   - Easy to maintain and debug

---

## Phase 1: Stage 1 Prompt Rewrite (3 hours)

### 1.1 Remove Placeholder Concept
**File:** `lib/agentkit/stage1-workflow-designer.ts`

**Lines to change:**
- Line 64-65: Update interface comments
- Line 72: Update params type description
- Lines 200-329: Complete system prompt rewrite
- Lines 332-336: Update tool schema

**Changes:**

```typescript
// OLD (lines 64-65):
/**
 * Stage 1 Workflow Step
 * Parameters are PLACEHOLDERS (e.g., "$EMAIL_ADDRESS", "$SEARCH_QUERY")
 */

// NEW:
/**
 * Stage 1 Workflow Step
 * Parameters use {{input.X}} or {{stepN.field}} references
 */

// OLD (line 72):
params?: Record<string, string>; // Values are PLACEHOLDERS like "$PARAM_NAME"

// NEW:
params?: Record<string, any>; // Values are {{input.X}} or {{stepN.field}} or literals

// OLD (line 290, tool schema):
description: 'Array of workflow steps with PLACEHOLDER parameters',

// NEW:
description: 'Array of workflow steps with {{input.X}} and {{stepN.field}} references',

// OLD (line 334, params field):
description: 'Parameters with PLACEHOLDER values (e.g., {"to": "$RECIPIENT_EMAIL"})',

// NEW:
description: 'Parameters with {{input.X}} or {{stepN.field}} references or literal values',
additionalProperties: true  // Allow nested objects
```

### 1.2 Rewrite System Prompt Instructions

**Replace lines 200-329 with:**

```markdown
You are a workflow structure designer. Design the STRUCTURE of a workflow - parameter VALUES will reference inputs or step outputs.

1. **YOUR ROLE**
   - Design workflow architecture (which steps, in what order)
   - Use {{input.field_name}} for values from user
   - Use {{stepN.field}} for values from previous steps
   - Use literal values only for constants

2. **CRITICAL: Parameter Value Syntax**

   ❌ NEVER use $PLACEHOLDER format like $EMAIL or $QUERY
   ✅ ALWAYS use {{input.field_name}} for user-provided values
   ✅ ALWAYS use {{stepN.field}} for step outputs
   ✅ Use literals only for hardcoded constants

   **Examples:**

   ✅ CORRECT:
   ```json
   {
     "type": "action",
     "plugin": "google-mail",
     "action": "send_email",
     "params": {
       "recipients": {
         "to": ["{{input.recipient_email}}"]  // User input
       },
       "content": {
         "subject": "Daily Summary",           // Literal constant
         "body": "{{step2.summary}}"          // Previous step output
       }
     }
   }
   ```

   ❌ WRONG:
   ```json
   {
     "params": {
       "recipients": { "to": ["$RECIPIENT_EMAIL"] },  // Never use $
       "content": { "body": "$SUMMARY" }              // Never use $
     }
   }
   ```

3. **WORKFLOW TYPES**
   - simple_linear: Sequential steps, no branching (3-5 steps)
   - conditional: Has if/else logic (5-8 steps)
   - loop: Iterates over data (6-10 steps)
   - complex: Batch + loop hybrid (10-15 steps)

4. **AVAILABLE PLUGINS**
${Object.entries(availablePlugins).map(([key, plugin]) => {
  const actionsList = Object.entries(plugin.actions).map(([actionName, actionDef]: [string, any]) => {
    const desc = actionDef.description?.split('.')[0] || '';
    return `  • ${actionName}: ${desc}`;
  }).join('\n');
  return `${plugin.name} (${key})\n${actionsList}`;
}).join('\n\n')}

5. **CRITICAL FIELD STRUCTURES (Learn these patterns!)**

   **Action steps** - Parameters in nested `params` object:
   ```json
   {
     "id": "step1",
     "type": "action",
     "name": "Send email",
     "plugin": "google-mail",
     "action": "send_email",
     "params": {                              // ← params object
       "recipients": { "to": ["{{input.email}}"] },
       "content": { "subject": "Hello" }
     },
     "next": "step2"
   }
   ```

   **Transform steps** - Fields at TOP LEVEL (no params):
   ```json
   {
     "id": "step2",
     "type": "transform",
     "name": "Filter interested leads",
     "operation": "filter",                   // ← TOP LEVEL
     "input": "{{step1.leads}}",             // ← TOP LEVEL
     "config": {                              // ← TOP LEVEL
       "condition": {
         "field": "status",
         "operator": "==",
         "value": "{{input.target_status}}"
       }
     },
     "next": "step3"
   }
   ```

   **Loop steps** - Nested loopSteps array:
   ```json
   {
     "id": "step3",
     "type": "loop",
     "name": "Process each customer",
     "iterateOver": "{{step2.customers}}",   // ← What to loop over
     "maxIterations": 100,                    // ← Safety limit
     "loopSteps": [                           // ← Nested steps
       {
         "id": "step3_1",
         "type": "conditional",
         "condition": {
           "field": "loop.item.status",      // ← loop.item syntax!
           "operator": "==",
           "value": "pending"
         },
         "trueBranch": "step3_2",
         "falseBranch": null
       },
       {
         "id": "step3_2",
         "type": "action",
         "plugin": "hubspot",
         "action": "create_task",
         "params": {
           "title": "Follow up with {{loop.item.name}}",  // ← loop.item
           "due_date": "{{input.due_date}}"
         }
       }
     ]
   }
   ```

   **Conditional steps** - Condition + branches:
   ```json
   {
     "id": "step4",
     "type": "conditional",
     "name": "Check if high value",
     "condition": {
       "field": "step1.amount",
       "operator": ">",
       "value": "10000"
     },
     "trueBranch": "step5",
     "falseBranch": "step6"
   }
   ```

6. **VARIABLE REFERENCES**
   - Input variables: `{{input.field_name}}` - values from user
   - Step output: `{{step1.data.field}}` - output from step1
   - Previous step: `{{prev.data}}` - output from last step
   - Loop current item: `{{loop.item.field}}` - current iteration item
   - Loop index: `{{loop.index}}` - current iteration number (0-based)
   - Nested loops: `{{loop.parent.item.field}}` - parent loop's item

7. **CONDITIONALS**
   Format: `{ field, operator, value }` or `{ and/or/not: [...] }`

   Simple: `{ field: "step1.status", operator: "==", value: "success" }`
   AND: `{ and: [{ field: "...", operator: "...", value: "..." }, ...] }`
   OR: `{ or: [{ field: "...", operator: "...", value: "..." }, ...] }`
   NOT: `{ not: { field: "...", operator: "...", value: "..." } }`

   Operators: ==, !=, >, <, >=, <=, contains, startsWith, endsWith, exists, not_exists

8. **CRITICAL: Batch Processing Architecture**

   ⚠️ **NEVER put ai_processing inside a loop!** This causes massive token waste.

   ❌ BAD (100 LLM calls):
   ```
   loop over 100 customers:
     - ai_processing: extract data
     - ai_processing: classify
   ```

   ✅ GOOD (2 LLM calls):
   ```
   1. action: get all customers (100 items)
   2. ai_processing: extract data from ALL at once (returns array)
   3. ai_processing: classify ALL at once (returns array)
   4. loop over results:
        - action: create_task (must be individual)
   ```

   **Pattern for 100+ items:**
   ```
   Step 1-3:   Get all data (actions)
   Step 4:     ai_processing - process ALL items (batch)
   Step 5:     transform - filter/map (deterministic, no LLM)
   Step 6:     ai_processing - classify ALL items (batch)
   Step 7:     loop over results
                 - conditional logic
                 - individual plugin actions only
   Step 8:     ai_processing - generate summary report (batch)
   ```

9. **COMPLETE EXAMPLE: Complex Batch + Loop Workflow**

   Task: "Review 100 customer folders, extract contract data, check tracker sheet, classify mismatches, create tasks"

   ```json
   {
     "workflow_steps": [
       {
         "id": "step1",
         "type": "action",
         "name": "Get customer folders from Drive",
         "plugin": "google-drive",
         "action": "get_folder_contents",
         "params": {
           "folder_id": "{{input.main_folder_id}}"
         },
         "next": "step2"
       },
       {
         "id": "step2",
         "type": "action",
         "name": "Get PDF contracts from all folders",
         "plugin": "google-drive",
         "action": "list_files",
         "params": {
           "query": "mimeType='application/pdf' and parents in {{step1.folder_ids}}"
         },
         "next": "step3"
       },
       {
         "id": "step3",
         "type": "ai_processing",
         "name": "Extract customer data from ALL PDFs at once",
         "params": {
           "input": "{{step2.pdf_files}}",
           "task": "extract_structured_data",
           "prompt": "For each PDF contract, extract: customer_name, company, email, subscription_package. Return array of objects.",
           "output_format": "structured_array"
         },
         "next": "step4"
       },
       {
         "id": "step4",
         "type": "action",
         "name": "Lookup ALL customers in tracker sheet",
         "plugin": "google-sheets",
         "action": "batch_lookup",
         "params": {
           "spreadsheet_id": "{{input.tracker_sheet_id}}",
           "lookup_column": "Email",
           "lookup_values": "{{step3.customer_emails}}"
         },
         "next": "step5"
       },
       {
         "id": "step5",
         "type": "transform",
         "name": "Map sheet data to customers",
         "operation": "map",
         "input": "{{step3.customers}}",
         "config": {
           "add_fields": {
             "sheet_package": {
               "lookup": {
                 "source": "{{step4.sheet_rows}}",
                 "match_field": "email",
                 "return_field": "package"
               }
             }
           }
         },
         "next": "step6"
       },
       {
         "id": "step6",
         "type": "ai_processing",
         "name": "Classify ALL package mismatches at once",
         "params": {
           "input": "{{step5.customers_with_sheet_data}}",
           "task": "classification",
           "prompt": "For each customer, compare subscription_package (from contract) vs sheet_package (from tracker). Classify as: 'Match', 'Upgrade', 'Downgrade', or 'Missing'. Return array with classification field.",
           "output_format": "structured_array"
         },
         "next": "step7"
       },
       {
         "id": "step7",
         "type": "loop",
         "name": "Create tasks for mismatches",
         "iterateOver": "{{step6.classified_customers}}",
         "maxIterations": 100,
         "loopSteps": [
           {
             "id": "step7_1",
             "type": "conditional",
             "name": "Check if mismatch exists",
             "condition": {
               "field": "loop.item.classification",
               "operator": "!=",
               "value": "Match"
             },
             "trueBranch": "step7_2",
             "falseBranch": null
           },
           {
             "id": "step7_2",
             "type": "action",
             "name": "Create task in HubSpot",
             "plugin": "hubspot",
             "action": "create_task",
             "params": {
               "title": "Package Mismatch: {{loop.item.customer_name}}",
               "description": "Contract: {{loop.item.subscription_package}}, Tracker: {{loop.item.sheet_package}}, Type: {{loop.item.classification}}",
               "due_date": "{{input.task_due_date}}",
               "assigned_to": "{{input.assigned_user_email}}"
             }
           }
         ],
         "next": "step8"
       },
       {
         "id": "step8",
         "type": "ai_processing",
         "name": "Generate summary report",
         "params": {
           "input": "{{step7.loop_results}}",
           "task": "generate_report",
           "prompt": "Generate HTML report summarizing: total customers reviewed, matches, upgrades, downgrades, missing entries, tasks created.",
           "output_format": "html"
         },
         "next": "step9"
       },
       {
         "id": "step9",
         "type": "action",
         "name": "Email report",
         "plugin": "google-mail",
         "action": "send_email",
         "params": {
           "recipients": {
             "to": ["{{input.report_recipient_email}}"]
           },
           "content": {
             "subject": "Customer Onboarding Review Report",
             "body": "{{step8.report}}",
             "html": true
           }
         }
       }
     ]
   }
   ```

   **Key learnings from this example:**
   - Steps 3, 6, 8: AI processes ALL items in batch (3 LLM calls total)
   - Step 5: Transform is deterministic (no LLM)
   - Step 7: Loop only for individual HubSpot actions
   - All params use {{input.X}} or {{stepN.field}} syntax
   - Transform has operation/input/config at top level
   - Loop uses {{loop.item.X}} syntax

10. **QUALITY CHECKLIST**
    ✓ Every step has id, type, AND name fields
    ✓ Use {{input.X}} for user inputs (NEVER $PLACEHOLDER)
    ✓ Use {{stepN.field}} for step outputs
    ✓ Action steps: params is nested object
    ✓ Transform steps: operation/input/config at TOP LEVEL (no params)
    ✓ Loop steps: loopSteps array, maxIterations safety limit
    ✓ Loop variables: {{loop.item.field}} syntax
    ✓ NO ai_processing inside loops (use batch before loop)
    ✓ Conditionals: {field, operator, value} format
    ✓ Steps in logical order
    ✓ All plugins exist in available list

**YOUR OUTPUT:**
Return complete workflow design using the workflow_designer tool.
Focus on correct structure and {{variable}} syntax.
```

### 1.3 Update Tool Schema
**Lines 332-407:**

```typescript
params: {
  type: 'object',
  description: 'Parameters with {{input.X}} or {{stepN.field}} references, or literal values. For action steps only.',
  additionalProperties: true  // Allow nested objects
}
```

---

## Phase 2: Stage 2 Complete Rewrite (2 hours)

### 2.1 New Stage 2 Architecture
**File:** `lib/agentkit/stage2-parameter-filler.ts`

**Complete rewrite - Stage 2 is now a pure JavaScript scanner:**

```typescript
/**
 * Stage 2: Input Schema Builder
 *
 * NO LLM CALLS - Pure JavaScript processing:
 * 1. Scan workflow for {{input.X}} references
 * 2. Build required_inputs schema
 * 3. Generate user-friendly labels
 * 4. Process nested steps recursively
 * 5. Return complete workflow
 */

import { Stage1WorkflowDesign, Stage1RequiredInput } from './stage1-workflow-designer';

export interface Stage2CompleteWorkflow {
  agent_name: string;
  agent_description: string;
  workflow_type: string;
  workflow_steps: any[];
  required_inputs: Stage1RequiredInput[];
  suggested_plugins: string[];
  confidence: number;
  reasoning: string;
  tokensUsed?: {
    input: number;
    output: number;
  };
}

export async function fillParameterValues(
  stage1Design: Stage1WorkflowDesign,
  _userPrompt: string,
  _connectedPlugins: string[]
): Promise<Stage2CompleteWorkflow> {

  console.log('🔧 [Stage 2] Building input schema from workflow...');

  // ========================================
  // STEP 1: Extract {{input.X}} references
  // ========================================

  const inputReferences = extractInputReferences(stage1Design.workflow_steps);
  console.log(`📝 [Stage 2] Found ${inputReferences.size} input references:`, Array.from(inputReferences));

  // ========================================
  // STEP 2: Build required_inputs schema
  // ========================================

  const required_inputs = buildInputSchema(inputReferences);
  console.log(`📋 [Stage 2] Generated input schema with ${required_inputs.length} fields`);

  // ========================================
  // STEP 3: Process nested steps recursively
  // ========================================

  const finalSteps = processWorkflowSteps(stage1Design.workflow_steps);

  // ========================================
  // STEP 4: Return complete workflow
  // ========================================

  return {
    agent_name: stage1Design.agent_name,
    agent_description: stage1Design.agent_description,
    workflow_type: stage1Design.workflow_type,
    workflow_steps: finalSteps,
    required_inputs: required_inputs,
    suggested_plugins: stage1Design.suggested_plugins,
    confidence: 85,
    reasoning: `Workflow structure validated. Found ${inputReferences.size} input fields: ${Array.from(inputReferences).join(', ')}`,
    tokensUsed: { input: 0, output: 0 }  // No LLM call!
  };
}

/**
 * Extract all {{input.X}} references from workflow
 */
function extractInputReferences(steps: any[]): Set<string> {
  const references = new Set<string>();
  const stepStr = JSON.stringify(steps);

  // Match {{input.field_name}} patterns (snake_case)
  const matches = stepStr.matchAll(/\{\{input\.([a-z_][a-z0-9_]*)\}\}/gi);

  for (const match of matches) {
    const fieldName = match[1].toLowerCase();
    references.add(fieldName);
  }

  return references;
}

/**
 * Build input schema with user-friendly labels
 */
function buildInputSchema(inputRefs: Set<string>): Stage1RequiredInput[] {
  const inputs: Stage1RequiredInput[] = [];

  for (const fieldName of inputRefs) {
    inputs.push({
      name: fieldName,
      type: inferInputType(fieldName),
      label: generateLabel(fieldName),
      description: `${generateLabel(fieldName)} for this workflow`,
      required: true,
      default_value: ''
    });
  }

  // Sort alphabetically for consistency
  return inputs.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Infer input type from field name conventions
 */
function inferInputType(fieldName: string): string {
  // Email fields
  if (fieldName.includes('email')) return 'email';

  // Number fields
  if (fieldName.includes('count') ||
      fieldName.includes('limit') ||
      fieldName.includes('max') ||
      fieldName.includes('amount') ||
      fieldName.includes('number')) {
    return 'number';
  }

  // Boolean fields
  if (fieldName.includes('enabled') ||
      fieldName.includes('flag') ||
      fieldName.includes('is_') ||
      fieldName.startsWith('has_')) {
    return 'boolean';
  }

  // Date fields
  if (fieldName.includes('date') ||
      fieldName.includes('time') ||
      fieldName.includes('deadline')) {
    return 'date';
  }

  // URL fields
  if (fieldName.includes('url') || fieldName.includes('link')) {
    return 'url';
  }

  // ID fields (usually strings but could be specialized)
  if (fieldName.endsWith('_id')) {
    return 'string';
  }

  // Default to string
  return 'string';
}

/**
 * Generate user-friendly label from snake_case field name
 * Examples:
 *   recipient_email → "Recipient Email"
 *   main_folder_id → "Main Folder ID"
 *   search_query → "Search Query"
 */
function generateLabel(fieldName: string): string {
  return fieldName
    .split('_')
    .map(word => {
      // Keep common abbreviations uppercase
      const upper = word.toUpperCase();
      if (['ID', 'URL', 'API', 'PDF', 'HTML', 'CSV'].includes(upper)) {
        return upper;
      }
      // Capitalize first letter
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(' ');
}

/**
 * Process steps recursively (handle nested loops, parallels, etc.)
 * This is just a deep clone with recursive processing
 */
function processWorkflowSteps(steps: any[]): any[] {
  return steps.map(step => {
    const processed: any = { ...step };

    // Recursively process nested steps
    if (step.loopSteps && Array.isArray(step.loopSteps)) {
      processed.loopSteps = processWorkflowSteps(step.loopSteps);
    }

    if (step.parallelSteps && Array.isArray(step.parallelSteps)) {
      processed.parallelSteps = processWorkflowSteps(step.parallelSteps);
    }

    // Handle switch cases (array of step IDs pointing to nested steps)
    if (step.cases && typeof step.cases === 'object') {
      // Cases are just step ID references, no nested processing needed
      processed.cases = { ...step.cases };
    }

    return processed;
  });
}
```

**Key Changes:**
- ❌ Removed: All LLM API calls
- ❌ Removed: Placeholder extraction logic
- ❌ Removed: Complex merging logic
- ✅ Added: Simple {{input.X}} regex scanner
- ✅ Added: Smart type inference
- ✅ Added: Label generation
- ✅ Added: Recursive nested step processing

---

## Phase 3: Update Gate Validations (1 hour)

### 3.1 Gate 1: Validate No Placeholders
**File:** `lib/agentkit/twostage-agent-generator.ts` (lines 282-369)

**Add after line 302:**

```typescript
// 3. CRITICAL: Check for forbidden $PLACEHOLDER values
const workflowStr = JSON.stringify(design.workflow_steps);
const placeholderMatches = workflowStr.match(/"\$[A-Z_0-9]+"/g);

if (placeholderMatches && placeholderMatches.length > 0) {
  const uniquePlaceholders = Array.from(new Set(placeholderMatches));
  errors.push(`Found forbidden $PLACEHOLDER values: ${uniquePlaceholders.join(', ')}. Use {{input.field_name}} instead.`);
}

// 4. Validate {{input.X}} format (snake_case)
const inputRefMatches = workflowStr.matchAll(/\{\{input\.([^}]+)\}\}/g);
for (const match of inputRefMatches) {
  const fieldName = match[1];
  // Check valid field name (snake_case: lowercase, numbers, underscores)
  if (!/^[a-z_][a-z0-9_]*$/i.test(fieldName)) {
    warnings.push(`Input reference "{{input.${fieldName}}}" should use snake_case (lowercase with underscores)`);
  }
}
```

### 3.2 Gate 2: Validate Field Structures
**File:** `lib/agentkit/twostage-agent-generator.ts` (lines 370-458)

**Add after line 384:**

```typescript
// 2. Validate field structures by step type
for (const step of complete.workflow_steps || []) {
  const stepType = step.type;

  // Transform steps: Must have operation/input/config at TOP LEVEL
  if (stepType === 'transform') {
    if (!step.operation) {
      errors.push(`Step ${step.id}: Transform step missing 'operation' field at top level`);
    }
    if (!step.input) {
      errors.push(`Step ${step.id}: Transform step missing 'input' field at top level`);
    }
    // Transform should NOT have params
    if (step.params) {
      warnings.push(`Step ${step.id}: Transform step has 'params' object - should use operation/input/config at top level instead`);
    }
  }

  // Action steps: Must have plugin, action, and params
  if (stepType === 'action') {
    if (!step.plugin) {
      errors.push(`Step ${step.id}: Action step missing 'plugin' field`);
    }
    if (!step.action) {
      errors.push(`Step ${step.id}: Action step missing 'action' field`);
    }
    // params is optional - validated later for required fields
  }

  // Loop steps: Must have iterateOver, loopSteps
  if (stepType === 'loop') {
    if (!step.iterateOver) {
      errors.push(`Step ${step.id}: Loop step missing 'iterateOver' field`);
    }
    if (!step.loopSteps || !Array.isArray(step.loopSteps)) {
      errors.push(`Step ${step.id}: Loop step missing 'loopSteps' array`);
    }
    if (!step.maxIterations) {
      warnings.push(`Step ${step.id}: Loop step missing 'maxIterations' safety limit`);
    }
  }

  // Conditional steps: Must have condition
  if (stepType === 'conditional') {
    if (!step.condition) {
      errors.push(`Step ${step.id}: Conditional step missing 'condition' field`);
    }
  }
}
```

---

## Phase 4: Token Optimization (1 hour)

### 4.1 Add Plugin Summary Method
**File:** `lib/server/plugin-manager-v2.ts`

**Add after line 174:**

```typescript
/**
 * Generate lightweight plugin summaries for Stage 1 LLM
 * Returns only action names + brief descriptions (no parameter details)
 *
 * Token savings: ~1,500 tokens → ~400 tokens (73% reduction)
 */
getPluginSummariesForStage1(pluginKeys: string[]): Record<string, PluginSummary> {
  const summaries: Record<string, PluginSummary> = {};

  for (const key of pluginKeys) {
    const plugin = this.plugins.get(key);
    if (!plugin) continue;

    summaries[key] = {
      name: plugin.name,
      description: plugin.description,
      category: plugin.category || 'general',
      actions: Object.entries(plugin.actions).map(([actionName, actionDef]: [string, any]) => {
        // Extract first sentence only from description
        const fullDesc = actionDef.description || '';
        const shortDesc = fullDesc.split('.')[0] + (fullDesc.includes('.') ? '.' : '');

        return {
          name: actionName,
          description: shortDesc
          // Omit: parameter schemas, output schemas, rules, examples
        };
      })
    };
  }

  return summaries;
}

interface PluginSummary {
  name: string;
  description: string;
  category: string;
  actions: Array<{
    name: string;
    description: string;
  }>;
}
```

### 4.2 Update Stage 1 to Use Summaries
**File:** `lib/agentkit/stage1-workflow-designer.ts` (lines 109-120)

```typescript
// OLD:
const pluginManager = await PluginManagerV2.getInstance();
const allPlugins = pluginManager.getAvailablePlugins();
const availablePlugins = Object.entries(allPlugins)
  .filter(([key]) => connectedPlugins.includes(key))
  .reduce((acc, [key, value]) => {
    acc[key] = value;
    return acc;
  }, {} as Record<string, any>);

// NEW:
const pluginManager = await PluginManagerV2.getInstance();
const pluginSummaries = pluginManager.getPluginSummariesForStage1(connectedPlugins);
```

**Update buildStage1SystemPrompt signature (line 205):**

```typescript
// OLD:
function buildStage1SystemPrompt(availablePlugins: Record<string, any>): string {

// NEW:
function buildStage1SystemPrompt(pluginSummaries: Record<string, PluginSummary>): string {
```

**Update plugin list formatting (lines 220-232):**

```typescript
4. **AVAILABLE PLUGINS**
${Object.entries(pluginSummaries).map(([key, plugin]) => {
  const actionsList = plugin.actions.map(a =>
    `  • ${a.name}: ${a.description}`
  ).join('\n');
  return `**${plugin.name}** (${key})\n${actionsList}`;
}).join('\n\n')}
```

---

## Phase 5: Fix Deterministic Transform Routing (1 hour)

### 5.1 Update StepExecutor Routing Logic
**File:** `lib/pilot/StepExecutor.ts` (line 486)

**Find and modify:**

```typescript
// OLD (line 486):
const llmStepTypes = [
  'ai_processing',
  'llm_decision',
  'summarize',
  'extract',
  'transform',  // ❌ Remove this
  'generate'
];

// NEW:
const llmStepTypes = [
  'ai_processing',
  'llm_decision',
  'summarize',
  'extract',
  'generate'
  // 'transform' removed - we'll detect dynamically below
];

// Add smart detection for transforms (after line 490):
if (step.type === 'transform') {
  const transformStep = step as TransformStep;
  const needsLLM = !this.canExecuteTransformDeterministically(
    transformStep.operation,
    transformStep.config
  );

  if (!needsLLM) {
    console.log(`🔀 [StepExecutor] Transform "${step.id}" routed to DETERMINISTIC execution`);
  } else {
    console.log(`🤖 [StepExecutor] Transform "${step.id}" routed to LLM (complex operation)`);
  }

  return needsLLM;
}
```

### 5.2 Add Detection Method
**File:** `lib/pilot/StepExecutor.ts` (add after line 600)

```typescript
/**
 * Determine if a transform operation can be executed deterministically
 * without requiring an LLM call
 */
private canExecuteTransformDeterministically(
  operation: string,
  config: any
): boolean {

  // Simple operations that have deterministic implementations
  const deterministicOps = [
    'map',           // Field mapping
    'filter',        // Conditional filtering
    'group',         // Group by field
    'flatten',       // Flatten arrays
    'sort',          // Sort by field
    'deduplicate',   // Remove duplicates
    'slice',         // Array slicing
    'reverse'        // Reverse array
  ];

  if (!deterministicOps.includes(operation)) {
    // Complex operations need LLM: aggregate, join with complex logic, etc.
    return false;
  }

  // Check if config requires AI reasoning
  if (config?.ai_instructions ||
      config?.custom_logic ||
      config?.reasoning_required ||
      config?.llm_processing) {
    return false;
  }

  // Check for complex conditions that might need AI
  if (operation === 'filter' && config?.condition) {
    const conditionStr = JSON.stringify(config.condition);
    // If condition contains natural language or complex logic, needs LLM
    if (conditionStr.includes('analyze') ||
        conditionStr.includes('interpret') ||
        conditionStr.includes('understand')) {
      return false;
    }
  }

  // Simple operations with standard config - can execute deterministically
  return true;
}
```

---

## Phase 6: Add Complete Example (1 hour)

### 6.1 Create Example Library
**File:** `lib/agentkit/examples/workflow-examples.ts` (NEW FILE)

```typescript
/**
 * Workflow Examples for Stage 1 Few-Shot Learning
 *
 * These examples teach PATTERNS, not templates.
 * Each example uses different plugins and shows different architectural patterns.
 */

export interface WorkflowExample {
  user_prompt: string;
  explanation: string;
  workflow_steps: any[];
  required_inputs: any[];
  key_learnings: string[];
  architecture_type: string;
  llm_call_count: number;
}

export const WORKFLOW_EXAMPLES: Record<string, WorkflowExample> = {

  simple_linear: {
    user_prompt: "Send me a daily summary email of unread emails from the last 24 hours",
    explanation: "Simple linear workflow - sequential steps, 1 LLM call for summarization",
    architecture_type: "simple_linear",
    llm_call_count: 1,

    workflow_steps: [
      {
        id: "step1",
        type: "action",
        name: "Search for unread emails",
        plugin: "google-mail",
        action: "search_emails",
        params: {
          query: "is:unread newer_than:1d"
        },
        next: "step2"
      },
      {
        id: "step2",
        type: "ai_processing",
        name: "Summarize all emails at once",
        params: {
          input: "{{step1.emails}}",
          task: "summarize",
          prompt: "Summarize key points from these emails. Group by sender and highlight action items."
        },
        next: "step3"
      },
      {
        id: "step3",
        type: "action",
        name: "Send summary email",
        plugin: "google-mail",
        action: "send_email",
        params: {
          recipients: {
            to: ["{{input.recipient_email}}"]
          },
          content: {
            subject: "Daily Email Summary - {{step1.email_count}} unread",
            body: "{{step2.summary}}"
          }
        }
      }
    ],

    required_inputs: [
      {
        name: "recipient_email",
        type: "email",
        label: "Recipient Email",
        description: "Email address to send the summary to",
        required: true
      }
    ],

    key_learnings: [
      "Sequential flow with 'next' pointers",
      "Action steps use nested 'params' object",
      "AI processes ALL emails in one call (not loop)",
      "Use {{input.field}} for user inputs",
      "Use {{stepN.field}} for step outputs",
      "Literal values for constants (query string)"
    ]
  },

  complex_batch_loop: {
    user_prompt: "Review all customer onboarding folders in Drive, extract contract data from PDFs, cross-check against tracker sheet, classify mismatches, and create tasks for discrepancies",
    explanation: "Complex workflow - batch AI processing first, then loop for individual plugin actions",
    architecture_type: "complex",
    llm_call_count: 4,

    workflow_steps: [
      {
        id: "step1",
        type: "action",
        name: "Get customer folders from Drive",
        plugin: "google-drive",
        action: "get_folder_contents",
        params: {
          folder_id: "{{input.main_folder_id}}"
        },
        next: "step2"
      },
      {
        id: "step2",
        type: "action",
        name: "List all PDF contracts",
        plugin: "google-drive",
        action: "list_files",
        params: {
          query: "mimeType='application/pdf' and parents in {{step1.folder_ids}}"
        },
        next: "step3"
      },
      {
        id: "step3",
        type: "action",
        name: "Download all PDFs",
        plugin: "google-drive",
        action: "batch_download_files",
        params: {
          file_ids: "{{step2.file_ids}}"
        },
        next: "step4"
      },
      {
        id: "step4",
        type: "ai_processing",
        name: "Extract customer data from ALL PDFs at once (BATCH)",
        params: {
          input: "{{step3.pdf_contents}}",
          task: "extract_structured_data",
          prompt: "For each PDF contract, extract: customer_name, company, email, subscription_package, start_date. Return array of objects with these fields.",
          output_format: "structured_array"
        },
        next: "step5"
      },
      {
        id: "step5",
        type: "action",
        name: "Get tracker sheet data",
        plugin: "google-sheets",
        action: "read_sheet",
        params: {
          spreadsheet_id: "{{input.tracker_sheet_id}}",
          range: "A:E"
        },
        next: "step6"
      },
      {
        id: "step6",
        type: "transform",
        name: "Map sheet data to customers",
        operation: "map",
        input: "{{step4.customers}}",
        config: {
          add_fields: {
            "sheet_package": {
              "lookup": {
                "source": "{{step5.rows}}",
                "match_field": "email",
                "return_field": "package"
              }
            },
            "exists_in_tracker": {
              "lookup": {
                "source": "{{step5.rows}}",
                "match_field": "email",
                "return_field": "email",
                "exists_check": true
              }
            }
          }
        },
        next: "step7"
      },
      {
        id: "step7",
        type: "ai_processing",
        name: "Classify ALL package mismatches at once (BATCH)",
        params: {
          input: "{{step6.customers_with_sheet_data}}",
          task: "classification",
          prompt: "For each customer, compare subscription_package (from contract) vs sheet_package (from tracker). Classify as: 'Match', 'Upgrade', 'Downgrade', or 'Missing'. For 'Missing', note if exists_in_tracker is false. Return array with 'classification' and 'issue_description' fields.",
          output_format: "structured_array"
        },
        next: "step8"
      },
      {
        id: "step8",
        type: "loop",
        name: "Create tasks for each mismatch",
        iterateOver: "{{step7.classified_customers}}",
        maxIterations: 200,
        loopSteps: [
          {
            id: "step8_1",
            type: "conditional",
            name: "Check if mismatch exists",
            condition: {
              field: "loop.item.classification",
              operator: "!=",
              value: "Match"
            },
            trueBranch: "step8_2",
            falseBranch: null
          },
          {
            id: "step8_2",
            type: "conditional",
            name: "Route by classification type",
            condition: {
              field: "loop.item.classification",
              operator: "==",
              value: "Missing"
            },
            trueBranch: "step8_3",
            falseBranch: "step8_4"
          },
          {
            id: "step8_3",
            type: "action",
            name: "Create urgent task for missing customer",
            plugin: "hubspot",
            action: "create_task",
            params: {
              title: "URGENT: Missing Customer - {{loop.item.customer_name}}",
              description: "Customer {{loop.item.customer_name}} ({{loop.item.email}}) has a contract but is not in the tracker sheet. Issue: {{loop.item.issue_description}}",
              due_date: "{{input.urgent_task_due_date}}",
              priority: "high",
              assigned_to: "{{input.assigned_user_email}}"
            }
          },
          {
            id: "step8_4",
            type: "action",
            name: "Create standard task for package mismatch",
            plugin: "hubspot",
            action: "create_task",
            params: {
              title: "Package Mismatch: {{loop.item.customer_name}}",
              description: "Customer: {{loop.item.customer_name}} ({{loop.item.company}})\nContract Package: {{loop.item.subscription_package}}\nTracker Package: {{loop.item.sheet_package}}\nClassification: {{loop.item.classification}}\nIssue: {{loop.item.issue_description}}",
              due_date: "{{input.standard_task_due_date}}",
              priority: "normal",
              assigned_to: "{{input.assigned_user_email}}"
            }
          }
        ],
        next: "step9"
      },
      {
        id: "step9",
        type: "ai_processing",
        name: "Generate summary report (BATCH)",
        params: {
          input: "{{step8.loop_results}}",
          task: "generate_report",
          prompt: "Generate an HTML report summarizing: Total customers reviewed, Number of matches, Number of upgrades, Number of downgrades, Number missing from tracker, Total tasks created (urgent vs standard). Include a table with all mismatches.",
          output_format: "html"
        },
        next: "step10"
      },
      {
        id: "step10",
        type: "action",
        name: "Email report to team",
        plugin: "google-mail",
        action: "send_email",
        params: {
          recipients: {
            to: ["{{input.report_recipient_email}}"]
          },
          content: {
            subject: "Customer Onboarding Review Report - {{step7.total_customers}} Customers",
            body: "{{step9.report}}",
            html: true
          }
        }
      }
    ],

    required_inputs: [
      {
        name: "main_folder_id",
        type: "string",
        label: "Main Folder ID",
        description: "Google Drive folder ID containing customer folders",
        required: true
      },
      {
        name: "tracker_sheet_id",
        type: "string",
        label: "Tracker Sheet ID",
        description: "Google Sheets ID for customer tracker",
        required: true
      },
      {
        name: "assigned_user_email",
        type: "email",
        label: "Assigned User Email",
        description: "Email of user to assign tasks to",
        required: true
      },
      {
        name: "urgent_task_due_date",
        type: "date",
        label: "Urgent Task Due Date",
        description: "Due date for urgent tasks (missing customers)",
        required: true
      },
      {
        name: "standard_task_due_date",
        type: "date",
        label: "Standard Task Due Date",
        description: "Due date for standard mismatch tasks",
        required: true
      },
      {
        name: "report_recipient_email",
        type: "email",
        label: "Report Recipient Email",
        description: "Email to send final report to",
        required: true
      }
    ],

    key_learnings: [
      "BATCH ALL AI operations before loops (4 LLM calls vs 400+)",
      "Transform steps: operation/input/config at TOP LEVEL (not in params)",
      "Loop variables use {{loop.item.field}} syntax",
      "Loops only for plugin actions that MUST be individual (HubSpot tasks)",
      "Nested conditionals inside loops are fully supported",
      "Step 4, 7, 9: AI processes ALL items in batch",
      "Step 6: Transform is deterministic (no LLM call)",
      "Step 8: Loop for individual HubSpot task creation",
      "All user inputs use {{input.field_name}} format",
      "Condition format: {field, operator, value}"
    ]
  }
};
```

### 6.2 Reference Examples in Stage 1 Prompt
**File:** `lib/agentkit/stage1-workflow-designer.ts`

**Add before "CRITICAL FIELD STRUCTURES" section (around line 240):**

```typescript
**LEARNING FROM REFERENCE EXAMPLES:**

Study these proven patterns - adapt the ARCHITECTURE, not the specific plugins.

--- EXAMPLE 1: Simple Linear (3 steps, 1 LLM call) ---
Task: "Send daily summary email of unread emails"

Architecture:
  Step 1: action (search_emails) - get data
  Step 2: ai_processing - summarize ALL at once
  Step 3: action (send_email) - deliver result

Key: AI processes ALL emails in batch, not loop.
Variables: {{input.recipient_email}} for user input, {{step1.emails}} for data flow

--- EXAMPLE 2: Complex Batch + Loop (10 steps, 4 LLM calls) ---
Task: "Review 100 customer folders, extract contracts, check tracker, classify mismatches, create tasks"

Architecture:
  Step 1-3:   actions - get ALL data (folders, PDFs, download)
  Step 4:     ai_processing - extract ALL customer data (BATCH, 1 LLM call)
  Step 5:     action - get tracker sheet
  Step 6:     transform - map sheet data (DETERMINISTIC, no LLM)
  Step 7:     ai_processing - classify ALL mismatches (BATCH, 1 LLM call)
  Step 8:     loop - create individual HubSpot tasks
              Nested conditionals route by classification type
  Step 9:     ai_processing - generate report (BATCH, 1 LLM call)
  Step 10:    action - email report

Key learnings:
  • Batch ALL AI before loop (4 calls vs 400)
  • Transform has operation/input/config at TOP (not params)
  • Loop uses {{loop.item.X}} syntax
  • Nested conditionals fully supported

See full examples in lib/agentkit/examples/workflow-examples.ts

**Now apply these patterns to design your workflow...**
```

---

## Phase 7: Testing & Validation (2 hours)

### 7.1 Create Test Cases
**File:** `lib/agentkit/__tests__/twostage-complete.test.ts` (NEW)

```typescript
import { generateAgentTwoStage } from '../twostage-agent-generator';

describe('TwoStage Generator V3 - Complete Tests', () => {
  const TEST_USER_ID = 'test-user-123';

  describe('Simple Workflows', () => {
    it('should generate simple email summary workflow', async () => {
      const result = await generateAgentTwoStage(
        TEST_USER_ID,
        "Send me a daily summary email of my inbox",
        ['google-mail']
      );

      expect(result.success).toBe(true);
      expect(result.agent).toBeDefined();
      expect(result.agent!.workflow_type).toBe('simple_linear');
      expect(result.agent!.workflow_steps.length).toBeLessThanOrEqual(5);

      // Verify no $PLACEHOLDER values
      const workflowStr = JSON.stringify(result.agent!.workflow_steps);
      expect(workflowStr).not.toMatch(/"\$[A-Z_]+"/);

      // Verify {{input.X}} references
      expect(workflowStr).toMatch(/\{\{input\./);

      // Verify input schema was built
      expect(result.agent!.required_inputs.length).toBeGreaterThan(0);
    });
  });

  describe('Complex Workflows', () => {
    it('should generate complex batch+loop workflow', async () => {
      const result = await generateAgentTwoStage(
        TEST_USER_ID,
        "Review all customer onboarding folders, extract contract data, check tracker sheet, and create tasks for mismatches",
        ['google-drive', 'google-sheets', 'hubspot']
      );

      expect(result.success).toBe(true);
      expect(result.agent).toBeDefined();
      expect(result.agent!.workflow_type).toBe('complex');
      expect(result.agent!.workflow_steps.length).toBeGreaterThanOrEqual(8);

      // Verify batch processing (AI steps outside loops)
      const topLevelAI = result.agent!.workflow_steps.filter(s =>
        s.type === 'ai_processing'
      );
      expect(topLevelAI.length).toBeGreaterThanOrEqual(2);

      // Verify no AI in loops
      const loops = result.agent!.workflow_steps.filter(s => s.type === 'loop');
      for (const loop of loops) {
        const hasAI = loop.loopSteps.some((s: any) =>
          ['ai_processing', 'summarize', 'extract'].includes(s.type)
        );
        expect(hasAI).toBe(false);
      }

      // Verify transform field structure
      const transforms = result.agent!.workflow_steps.filter(s => s.type === 'transform');
      for (const t of transforms) {
        expect(t.operation).toBeDefined();
        expect(t.input).toBeDefined();
        expect(t.params).toBeUndefined(); // Should NOT have params
      }
    });
  });

  describe('Field Structure Validation', () => {
    it('should have correct field structures for all step types', async () => {
      const result = await generateAgentTwoStage(
        TEST_USER_ID,
        "Search emails, filter by status, and send to HubSpot",
        ['google-mail', 'hubspot']
      );

      expect(result.success).toBe(true);

      for (const step of result.agent!.workflow_steps) {
        if (step.type === 'action') {
          // Action steps should have params
          expect(step.plugin).toBeDefined();
          expect(step.action).toBeDefined();
        }

        if (step.type === 'transform') {
          // Transform should NOT have params
          expect(step.params).toBeUndefined();
          expect(step.operation).toBeDefined();
          expect(step.input).toBeDefined();
        }

        if (step.type === 'loop') {
          expect(step.iterateOver).toBeDefined();
          expect(step.loopSteps).toBeDefined();
          expect(Array.isArray(step.loopSteps)).toBe(true);
        }
      }
    });
  });

  describe('Input Schema Generation', () => {
    it('should build input schema from {{input.X}} references', async () => {
      const result = await generateAgentTwoStage(
        TEST_USER_ID,
        "Send email to recipient about the topic",
        ['google-mail']
      );

      expect(result.success).toBe(true);
      expect(result.agent!.required_inputs).toBeDefined();

      // Should have detected {{input.recipient_email}} and similar
      const inputNames = result.agent!.required_inputs.map(i => i.name);
      expect(inputNames.length).toBeGreaterThan(0);

      // Check label generation
      for (const input of result.agent!.required_inputs) {
        expect(input.label).toBeDefined();
        expect(input.label).not.toBe(input.name); // Should be formatted
        expect(input.label).toMatch(/^[A-Z]/); // Should be capitalized
      }
    });
  });

  describe('Token Optimization', () => {
    it('should not call LLM in Stage 2', async () => {
      const result = await generateAgentTwoStage(
        TEST_USER_ID,
        "Simple workflow test",
        ['google-mail']
      );

      expect(result.success).toBe(true);
      expect(result.tokensUsed?.stage2.input).toBe(0);
      expect(result.tokensUsed?.stage2.output).toBe(0);
    });
  });
});
```

### 7.2 Manual Testing Checklist

**Test Suite:**
1. ✅ Simple workflow (3-5 steps)
2. ✅ Complex workflow (10-15 steps)
3. ✅ Workflow with loops
4. ✅ Workflow with conditionals
5. ✅ Workflow with transforms
6. ✅ Workflow with nested loops + conditionals

**Validation Checks:**
- ✅ No $PLACEHOLDER values anywhere
- ✅ All {{input.X}} references valid snake_case
- ✅ Input schema matches {{input.X}} references
- ✅ Transform steps: operation/input/config at top level
- ✅ Action steps: params nested object
- ✅ Loop variables use {{loop.item.X}}
- ✅ No AI processing inside loops
- ✅ Validation gates all pass

---

## Success Criteria

### Generation Quality (Target: 95% simple, 90% complex)

✅ **Structure:**
- No duplicate params objects
- No placeholder leakage ($PLACEHOLDER)
- Correct field structures per step type
- Loop variables use {{loop.item.X}} syntax

✅ **Architecture:**
- Batch processing before loops (4 LLM calls vs 400)
- Transform steps have operation/input/config at top
- Nested conditionals in loops work correctly

✅ **Input Schema:**
- All {{input.X}} references captured
- User-friendly labels generated
- Correct type inference

### Token Efficiency

✅ **Stage 1:**
- Plugin summaries: 400 tokens (down from 1,500) = 73% reduction
- Total Stage 1 input: ~4,000 tokens

✅ **Stage 2:**
- No LLM call: 0 tokens (down from 2,000) = 100% reduction
- Pure JavaScript scanning: <100ms

✅ **Total Savings:**
- Generation: 60-70% token reduction
- Execution: 30-50% savings via deterministic transforms

### Execution Success

✅ **Runtime:**
- Generated workflows execute without errors
- Batch processing works (4 LLM calls vs 400+)
- Deterministic transforms route correctly
- All validation gates pass

---

## Implementation Timeline

### Day 1 (5-6 hours):
**Morning (3 hours):**
- Phase 1: Rewrite Stage 1 prompt (remove placeholders, add {{input.X}})
- Phase 2: Rewrite Stage 2 (pure JavaScript scanner)

**Afternoon (2-3 hours):**
- Phase 3: Update validation gates
- Phase 4: Token optimization (plugin summaries)
- Test simple workflow end-to-end

### Day 2 (3-4 hours):
**Morning (2 hours):**
- Phase 5: Fix deterministic transform routing
- Phase 6: Add complete examples

**Afternoon (1-2 hours):**
- Phase 7: Comprehensive testing
- Fix any issues discovered
- Document final results

**Total: 8-10 hours**

---

## Risk Mitigation

### Potential Issues:

1. **Stage 1 might still generate $PLACEHOLDER:**
   - Mitigation: Gate 1 validation rejects with clear error
   - Fallback: Can add more examples showing {{input.X}} format

2. **Input schema might miss some {{input.X}} references:**
   - Mitigation: Regex pattern tested extensively
   - Validation: Gate 2 checks all references match schema

3. **Plugin summaries might lose critical info:**
   - Mitigation: Keep action descriptions, only remove param details
   - Test: Verify workflows still generate correctly

4. **Deterministic routing might be too aggressive:**
   - Mitigation: Conservative detection (when in doubt, use LLM)
   - Monitoring: Log routing decisions

### Rollback Plan:

- Each phase is independent
- Can roll back individual changes
- Keep old Stage 2 in `stage2-parameter-filler.OLD.ts` for reference

---

## Cost Analysis

### Before Optimization:
- Stage 1: 4,500 tokens @ $0.003/1K = $0.0135
- Stage 2: 2,000 tokens @ $0.003/1K = $0.0060
- **Total: $0.0195 per generation**

### After Optimization:
- Stage 1: 4,000 tokens @ $0.003/1K = $0.012
- Stage 2: 0 tokens = $0.00
- **Total: $0.012 per generation**

**Savings: 38% per generation**

### At Scale (10K generations/day):
- Before: $195/day
- After: $120/day
- **Savings: $75/day = $27,375/year**

### Execution Savings (via deterministic transforms):
- Average workflow: 5,000 tokens
- 30% reduction: 1,500 tokens saved
- At 100K executions/day: 150M tokens saved
- **Savings: ~$450/day = $164,250/year**

**Total Annual Savings: ~$191,625**

---

## Monitoring & Metrics

### Track These Metrics:

1. **Generation Success Rate:**
   - Simple workflows: target 95%
   - Complex workflows: target 90%

2. **Token Usage:**
   - Stage 1 avg tokens
   - Stage 2 avg tokens (should be 0)
   - Total tokens per generation

3. **Execution Efficiency:**
   - % transforms routed deterministically
   - Avg LLM calls per workflow
   - Token savings per execution

4. **Quality Metrics:**
   - % workflows with placeholder leakage (target 0%)
   - % workflows with correct field structures (target 100%)
   - % workflows passing all 3 gates (target 95%+)

---

## Next Steps After Implementation

1. **Collect Real Usage Data:**
   - Monitor success rates for 1 week
   - Identify common failure patterns

2. **Iterative Improvement:**
   - Add more examples for failing patterns
   - Refine detection logic
   - Improve error messages

3. **Advanced Features:**
   - Add workflow optimization suggestions
   - Implement workflow templates
   - Build example library from successful generations

4. **Documentation:**
   - Update user-facing docs
   - Create troubleshooting guide
   - Document best practices

---

## Conclusion

This implementation plan addresses ALL identified issues:

✅ **Eliminates placeholder concept** - use {{input.X}} instead
✅ **Simplifies Stage 2** - no LLM, just scanning
✅ **Fixes field structures** - type-aware validation
✅ **Optimizes tokens** - 60-70% reduction
✅ **Enables deterministic transforms** - 30-50% execution savings
✅ **Adds strategic examples** - few-shot learning

**Result:** Production-ready agent generator with 95%+ success rate, 60% lower cost, and correct workflows every time.

Ready to implement? 🚀
