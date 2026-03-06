# V6 Pipeline Complete Flow - Current State

**Date:** 2026-02-26
**Status:** Documentation of complete V6 pipeline

---

## Complete V6 Pipeline Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         USER INPUT                                       │
│ "Extract invoices from Gmail, store in Drive, log to Sheets"           │
└─────────────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ PHASE 0: Enhanced Prompt Creation                                       │
│ - Parse user input                                                      │
│ - Extract hard requirements (thresholds, invariants, unit_of_work)     │
└─────────────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ PHASE 1-2: Semantic Plan + Grounding (CURRENTLY SKIPPED)                │
│ - These phases are bypassed - Enhanced Prompt goes directly to IR      │
│ - Saves ~3500 tokens and 15-30 seconds                                 │
└─────────────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ PHASE 3: IR Formalization (IRFormalizer)                                │
│ - LLM generates IntentContract (Generic Intent V1)                     │
│ - Plugin-agnostic, uses domain + capability                            │
│ - Per-step capability requirements in `uses` field                     │
│ - Outputs: IntentContract JSON                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ ✅ PHASE 3.5: Capability Binding (CapabilityBinderV2) - NEW!           │
│ - Takes: IntentContract                                                │
│ - Phase 0: Subset resolution (SubsetRefResolver)                       │
│ - Phase 1: Domain + Capability matching                                │
│ - Phase 2: Provider preference scoring                                 │
│ - Phase 3: Must-support filtering                                      │
│ - Outputs: BoundIntentContract                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ ⚠️  MISSING PHASE: Intent → IR Conversion                              │
│ - Takes: BoundIntentContract                                           │
│ - Converts Generic Intent steps → ExecutionGraph (IR v4)               │
│ - Maps IntentSteps to IR nodes (operation, choice, loop, parallel)     │
│ - Resolves variable references                                         │
│ - Outputs: DeclarativeLogicalIRv4                                      │
│                                                                         │
│ 🔴 THIS IS WHAT WE NEED TO IMPLEMENT NEXT!                             │
└─────────────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ PHASE 4: IR Compilation (ExecutionGraphCompiler)                        │
│ - Takes: DeclarativeLogicalIRv4 (ExecutionGraph)                       │
│ - Validates execution graph                                            │
│ - Topological sort                                                      │
│ - Compiles each node type to PILOT DSL steps                           │
│ - Resolves variable references ({{variable}})                          │
│ - Outputs: WorkflowStep[] (PILOT DSL)                                  │
└─────────────────────────────────────────────────────────────────────────┘
                                  ↓
┌─────────────────────────────────────────────────────────────────────────┐
│ PHASE 5: Workflow Execution                                             │
│ - Takes: WorkflowStep[] (PILOT DSL)                                    │
│ - Executes each step with plugin actions                               │
│ - Handles data flow, variable substitution                             │
│ - Returns: Execution results                                           │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## What We've Completed

### ✅ Phase 0: Enhanced Prompt & Requirements
- **File:** `lib/agentkit/v6/requirements/HardRequirementsExtractor.ts`
- **Status:** Complete
- **What it does:** Extracts hard requirements from user prompt

### ✅ Phase 3: IR Formalization (Intent Contract Generation)
- **File:** `lib/agentkit/v6/semantic-plan/IRFormalizer.ts`
- **Status:** Complete
- **What it does:** LLM generates Generic Intent V1 contracts

### ✅ Phase 3.5: Capability Binding (NEW!)
- **File:** `lib/agentkit/v6/capability-binding/CapabilityBinderV2.ts`
- **Status:** Complete (just implemented in Phase 3)
- **What it does:** Binds intent steps to plugin actions using V6 metadata

### ✅ Phase 4: IR Compilation
- **File:** `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts`
- **Status:** Complete
- **What it does:** Compiles ExecutionGraph (IR v4) to PILOT DSL steps

---

## What's Missing: Intent → IR Converter

### The Gap

**Currently:**
```
IntentContract (Generic V1) → ??? → ExecutionGraph (IR v4) → PILOT DSL
                              ^^^
                         MISSING LINK!
```

**We have:**
- ✅ `IntentContract` - Plugin-agnostic semantic workflow
- ✅ `BoundIntentContract` - Same, but with plugin bindings
- ✅ `ExecutionGraph (IR v4)` - Node-based execution graph

**We need:**
- ❌ **Converter** that transforms `BoundIntentContract` → `ExecutionGraph (IR v4)`

---

## Intent → IR Conversion Specification

### Input: BoundIntentContract

```typescript
{
  version: "intent.v1",
  goal: "...",
  steps: [
    {
      id: "fetch_emails",
      kind: "data_source",
      plugin_key: "google-mail",      // ← Added by CapabilityBinder
      action: "search_emails",         // ← Added by CapabilityBinder
      uses: [{
        domain: "email",
        capability: "search"
      }],
      output: "emails"
    },
    {
      id: "process_each",
      kind: "loop",
      loop: {
        over: "emails",
        item_ref: "email",
        do: [
          {
            id: "extract_data",
            kind: "extract",
            plugin_key: "chatgpt-research",
            action: "extract_structured_data",
            extract: {
              input: "email",
              fields: [...]
            },
            output: "transaction"
          }
        ]
      }
    }
  ]
}
```

### Output: ExecutionGraph (IR v4)

```typescript
{
  version: "declarative-logical-ir-v4.0",
  goal: "...",
  execution_graph: {
    start_node: "node_0",
    nodes: {
      "node_0": {
        id: "node_0",
        type: "operation",
        operation: {
          plugin: "google-mail",
          action: "search_emails",
          params: {...}
        },
        outputs: {
          "result": {
            var: "emails",
            type: "collection"
          }
        },
        next_nodes: ["node_1"]
      },
      "node_1": {
        id: "node_1",
        type: "loop",
        loop: {
          collection_var: "emails",
          item_var: "email",
          body_nodes: ["node_1_0"],
          aggregation: {
            mode: "collect",
            output_var: "results"
          }
        },
        next_nodes: ["node_2"]
      },
      "node_1_0": {
        id: "node_1_0",
        type: "operation",
        operation: {
          plugin: "chatgpt-research",
          action: "extract_structured_data",
          params: {
            "input": "{{email}}"
          }
        },
        outputs: {
          "result": {
            var: "transaction",
            type: "object"
          }
        }
      },
      "node_2": {
        id: "node_2",
        type: "end"
      }
    }
  }
}
```

---

## Mapping Rules: IntentStep → IR Node

| IntentStep Kind | IR Node Type | Conversion Logic |
|----------------|--------------|------------------|
| **data_source** | operation | Map to plugin.action, extract params from source/query/filters |
| **artifact** | operation | Map to plugin.action for get_or_create operations |
| **transform** | operation | May use internal transform OR mapped plugin action |
| **extract** | operation | Map to AI extraction plugin action |
| **classify** | operation | Map to AI classification plugin action |
| **summarize** | operation | Map to AI summarization plugin action |
| **generate** | operation | Map to AI generation plugin action |
| **decide** | choice | Map condition to ChoiceConfig, create branches |
| **loop** | loop | Map to LoopConfig with collection, item_var, body_nodes |
| **aggregate** | operation | Convert subset/count/sum/min/max to operations or internal logic |
| **deliver** | operation | Map to plugin.action for create/append/upload |
| **notify** | operation | Map to plugin.action for send_message |
| **schedule** | NOT MAPPED | Schedule hints may be metadata, not execution nodes |
| **trigger** | NOT MAPPED | Trigger hints may be metadata, not execution nodes |
| **parallel** | parallel | Map branches to ParallelConfig |

---

## Implementation Plan for Intent → IR Converter

### Step 1: Create IntentToIRConverter Class

**File:** `lib/agentkit/v6/compiler/IntentToIRConverter.ts`

```typescript
export class IntentToIRConverter {
  convert(boundIntent: BoundIntentContract): DeclarativeLogicalIRv4 {
    // 1. Initialize execution graph
    // 2. Convert each IntentStep to IR node(s)
    // 3. Build node connections (next_nodes)
    // 4. Resolve variable references
    // 5. Return IR v4
  }

  private convertStep(step: BoundStep, ctx: ConversionContext): ExecutionNode {
    switch (step.kind) {
      case 'data_source': return this.convertDataSource(step)
      case 'loop': return this.convertLoop(step, ctx)
      case 'decide': return this.convertDecide(step, ctx)
      case 'aggregate': return this.convertAggregate(step, ctx)
      case 'deliver': return this.convertDeliver(step)
      // ... etc
    }
  }
}
```

### Step 2: Integrate into V6PipelineOrchestrator

**File:** `lib/agentkit/v6/pipeline/V6PipelineOrchestrator.ts`

Add after CapabilityBinder:

```typescript
// Phase 3.5: Capability Binding
const binder = new CapabilityBinderV2(pluginManager)
const boundIntent = await binder.bind(intentContract, userId)

// Phase 3.6: Intent → IR Conversion (NEW!)
const converter = new IntentToIRConverter()
const ir = converter.convert(boundIntent)

// Phase 4: IR Compilation (existing)
const compiler = new ExecutionGraphCompiler(pluginManager)
const compilationResult = await compiler.compile(ir, hardReqs)
```

### Step 3: Handle Special Cases

1. **Aggregate Steps**
   - Subset outputs → operations that filter collections
   - Count/sum/min/max → operations or inline logic
   - Reference SubsetRefResolver results

2. **Transform Steps**
   - Simple transforms → inline operations
   - Complex transforms → may need plugin mapping

3. **Internal Capabilities**
   - extract, generate, summarize → map to AI plugin OR internal handler
   - Need to decide on routing strategy

4. **Variable Resolution**
   - Map IntentStep.output → IR outputs.result.var
   - Map ValueRef → {{variable}} in IR params
   - Handle field access (email.subject → {{email.subject}})

---

## Current Status Summary

### ✅ Completed (Phases 1-3)
1. ✅ Enhanced Prompt Creation
2. ✅ Hard Requirements Extraction
3. ✅ Intent Contract Generation (IRFormalizer)
4. ✅ **Capability Binding (CapabilityBinderV2)** ← Just finished!
5. ✅ All 11 plugins enhanced with V6 metadata

### 🔴 Next Task (Phase 3.6)
**Create IntentToIRConverter**
- Input: BoundIntentContract
- Output: DeclarativeLogicalIRv4 (ExecutionGraph)
- Map IntentSteps → IR nodes
- Resolve variable references
- Handle special cases (aggregates, transforms, internal capabilities)

### ✅ Already Complete (Phase 4-5)
1. ✅ IR Compilation (ExecutionGraphCompiler)
2. ✅ Workflow Execution (existing pilot executor)

---

## Why This Matters

**Without IntentToIRConverter:**
- We have Intent Contracts but can't execute them
- The gap between semantic plan and executable IR is not bridged
- CapabilityBinder output (BoundIntentContract) is unused

**With IntentToIRConverter:**
- Complete end-to-end pipeline ✅
- User prompt → Intent → Bound Intent → IR → PILOT DSL → Execution
- Full deterministic binding with V6 metadata
- Ready for production workflows

---

## Next Steps

1. **Implement IntentToIRConverter** (Priority: HIGH)
   - Create `lib/agentkit/v6/compiler/IntentToIRConverter.ts`
   - Implement step-to-node conversion logic
   - Handle variable resolution
   - Test with real Generic Intent V1 contract

2. **Integrate into V6PipelineOrchestrator**
   - Add Phase 3.6 after CapabilityBinder
   - Wire up converter between binder and compiler

3. **Handle Special Cases**
   - Aggregate subset conversion
   - Internal capability routing
   - Transform step mapping

4. **End-to-End Testing**
   - Test full pipeline: Prompt → PILOT DSL
   - Validate with real user workflows
   - Ensure all edge cases handled

---

**Status:** 🟡 PHASE 3 COMPLETE, PHASE 3.6 (Intent → IR Converter) NEXT

---

**End of Document**
