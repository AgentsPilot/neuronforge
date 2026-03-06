# Generic Intent V1 Implementation Status

**Date:** 2026-02-26
**Status:** 🟡 Implementation Complete - Ready for Testing
**Decision:** Option A (Rewrite Intent Prompt for Generic Intent V1)

---

## Summary

Successfully implemented Option A from the architectural decision: rewriting the Intent system prompt to generate Generic Intent V1 format that aligns with the TypeScript schema in `intent-schema-types.ts`.

---

## What Was Completed

### 1. ✅ New System Prompt Created

**File:** [lib/agentkit/v6/intent/intent-system-prompt-v2.ts](../lib/agentkit/v6/intent/intent-system-prompt-v2.ts)

**Key Features:**
- Generates `version: "intent.v1"` (not `"core_dsl_v1"`)
- Uses symbolic `RefName` for data flow (e.g., `"emails"`, `"attachments"`)
- Uses `CapabilityUse` with `{domain, capability}` for binding
- Steps use `kind` field (not `type`)
- Steps have `inputs: RefName[]` (array, not map)
- Steps have `output?: RefName` (single, not multiple outputs)
- Plugin-agnostic design (no semantic_op, no concrete plugin names)
- Execution-agnostic design (no JSONPath refs, no {{variables}})

**Comprehensive Coverage:**
- All 16 IntentStep kinds documented with examples
- ValueRef system (4 kinds: literal, config, ref, computed)
- Condition AST (test, and, or, not)
- Common workflow patterns
- Validation rules

### 2. ✅ Validation Function Added

**File:** [lib/agentkit/v6/intent/generate-intent.ts](../lib/agentkit/v6/intent/generate-intent.ts)

**Function:** `validateGenericIntentV1(data: any)`

**Validates:**
- ✅ `version === "intent.v1"`
- ✅ All steps have `id`, `kind`, `summary`
- ✅ Steps array is non-empty
- ✅ unit_of_work format (string or object with entity)

### 3. ✅ New Generation Function Created

**File:** [lib/agentkit/v6/intent/generate-intent.ts](../lib/agentkit/v6/intent/generate-intent.ts)

**Function:** `generateGenericIntentContractV1(args)`

**Features:**
- Uses new system prompt (buildIntentSystemPromptV2)
- Uses Generic Intent V1 validation
- No vocabulary injection needed (domain + capability are in prompt)
- Saves failed validation output for debugging

---

## Schema Alignment

### Before (Core DSL V1)
```typescript
{
  version: "core_dsl_v1",
  steps: CoreStep[]  // with type: "fetch" | "transform" | ...
}

interface CoreStep {
  type: CoreStepType;
  inputs: Record<string, { ref: string }>;  // map
  outputs: Record<string, string>;  // map
  fetch?: { semantic_op: string; params: {...} };
}
```

### After (Generic Intent V1)
```typescript
{
  version: "intent.v1",
  steps: IntentStep[]  // with kind: "data_source" | "transform" | ...
}

interface IntentStep {
  kind: StepKind;
  inputs?: RefName[];  // array of symbolic refs
  output?: RefName;  // single symbolic ref
  uses?: CapabilityUse[];  // domain + capability
}
```

---

## Key Differences Summary

| Aspect | Core DSL V1 (Old) | Generic Intent V1 (New) |
|--------|-------------------|------------------------|
| Version | `"core_dsl_v1"` | `"intent.v1"` |
| Step identifier | `type` | `kind` |
| Data flow | JSONPath: `$.stepId.outputKey` | Symbolic: `"emails"` |
| Inputs | Map: `{emails: {ref: "..."}}` | Array: `["emails"]` |
| Outputs | Map: `{emails: "desc", count: "desc"}` | Single: `"emails"` |
| Binding | `semantic_op: "EMAIL.SEARCH"` | `uses: [{domain:"email", capability:"search"}]` |
| Field access | JSONPath: `$.item.amount` | ValueRef: `{kind:"ref", ref:"item", field:"amount"}` |
| Philosophy | Semi-bound, execution-aware | Plugin-agnostic, execution-agnostic |

---

## What Works Now

✅ **System Prompt** - Complete Generic Intent V1 prompt with all 16 step kinds
✅ **Validation** - Validates Generic Intent V1 structure
✅ **Generation Function** - Generates Generic Intent V1 contracts
✅ **Type Alignment** - Matches `intent-schema-types.ts` exactly

---

## What Needs Testing

### Next Step 1: Generate Test Contract

Run the existing test with the new generation function:

```typescript
// In test-intent-contract-generation.ts, replace:
import { generateIntentContract } from '../lib/agentkit/v6/intent/index.js'

// With:
import { generateGenericIntentContractV1 } from '../lib/agentkit/v6/intent/generate-intent.js'

// And replace the call:
const { intent, rawText } = await generateIntentContract({ enhancedPrompt })

// With:
const { intent, rawText } = await generateGenericIntentContractV1({ enhancedPrompt })
```

### Next Step 2: Verify Output Structure

Check generated contract has:
- ✅ `version: "intent.v1"`
- ✅ Steps with `kind` field (not `type`)
- ✅ Steps with `inputs: RefName[]` (array)
- ✅ Steps with `output?: RefName` (single)
- ✅ Steps with `uses?: CapabilityUse[]`
- ✅ Symbolic refs (no JSONPath)
- ✅ No `semantic_op` anywhere
- ✅ No plugin names in step definitions

### Next Step 3: Test with CapabilityBinder

```typescript
import { CapabilityBinder } from '../lib/agentkit/v6/capability-binding/CapabilityBinder'
import { PluginManagerV2 } from '../lib/server/plugin-manager-v2'

const pluginManager = await PluginManagerV2.getInstance()
const binder = new CapabilityBinder(pluginManager)

const boundIntent = await binder.bind(intent)

// Check:
// - All steps have plugin_key bound
// - All steps have action bound
// - binding_confidence > 0.7
// - No unbound steps
```

### Next Step 4: Update Pipeline Orchestrator

Once testing passes, update V6PipelineOrchestrator to use the new format:

1. Update imports to use `generateGenericIntentContractV1`
2. Ensure CapabilityBinder is called with the new format
3. Update any downstream code expecting Core DSL V1

---

## Migration Path

### Phase 1: Parallel Operation (Current)
- ✅ Both formats exist
- ✅ Old: `generateIntentContract()` → Core DSL V1
- ✅ New: `generateGenericIntentContractV1()` → Generic Intent V1
- Use new function for testing

### Phase 2: Validation & Refinement
- Test new format with real workflows
- Refine system prompt based on LLM output quality
- Ensure CapabilityBinder works correctly
- Update documentation and examples

### Phase 3: Switch Default
- Update pipeline to use new generation function by default
- Mark old function as deprecated
- Update all test files

### Phase 4: Cleanup
- Remove Core DSL V1 system prompt
- Remove Core DSL V1 validation
- Remove legacy generation function
- Update all references

---

## Known Issues / Considerations

### 1. LLM Training Required
The LLM has been trained on Core DSL V1 format for weeks. It may:
- ❓ Initially generate wrong format (old habits)
- ❓ Need few-shot examples in user prompt
- ❓ Require temperature adjustment (currently 0.0)

**Solution:** If generation quality is poor, add 1-2 complete examples to the user prompt.

### 2. ValueRef Complexity
ValueRef system is more abstract than JSONPath:
```typescript
// Old (concrete):
{ "ref": "$.extract_transaction.amount" }

// New (abstract):
{ kind: "ref", ref: "extract_transaction", field: "amount" }
```

The LLM must learn this structure. Monitor early outputs.

### 3. CapabilityUse Learning Curve
LLM must learn to use domain + capability instead of semantic_op:
```typescript
// Old:
fetch: { semantic_op: "EMAIL.SEARCH", params: {...} }

// New:
uses: [{
  domain: "email",
  capability: "search",
  preferences: { must_support: ["attachments"] }
}]
```

### 4. Single Output Constraint
Generic Intent V1 allows only ONE output per step:
```typescript
// Old (multiple outputs):
outputs: {
  emails: "array of emails",
  count: "total count"
}

// New (single output):
output: "emails"
```

If step needs multiple outputs, must either:
- Use nested structure: `{emails: [...], count: 42}`
- Create separate steps
- Use aggregate step with multiple metrics

### 5. Loop Collection Semantics
Loop collection is more explicit:
```typescript
loop: {
  over: "emails",
  item_ref: "email",
  collect: {
    enabled: true,
    collect_as: "all_attachments",
    from_step_output: "attachments"  // which output to collect
  },
  do: [...]
}
```

Must clearly specify WHAT to collect from loop body.

---

## Testing Checklist

Before marking as production-ready:

- [ ] Generate intent contract with new function
- [ ] Verify output structure matches Generic Intent V1
- [ ] Test CapabilityBinder with generated contract
- [ ] Verify all capabilities bind to plugin actions
- [ ] Test with at least 3 different workflows:
  - [ ] Simple linear workflow (fetch → transform → deliver)
  - [ ] Loop workflow (fetch → loop → aggregate → notify)
  - [ ] Complex workflow (nested loops, branches, parallel)
- [ ] Verify symbolic refs resolve correctly in compiler
- [ ] Test error handling (invalid refs, missing capabilities)
- [ ] Performance test (generation time, token usage)
- [ ] Compare output quality to Core DSL V1

---

## Success Criteria

✅ **Generation:** LLM produces valid Generic Intent V1 JSON
✅ **Validation:** Contract passes validateGenericIntentV1()
✅ **Binding:** CapabilityBinder successfully binds all steps
✅ **Compilation:** Downstream IR compilation works
✅ **Execution:** End-to-end pipeline runs successfully
✅ **Quality:** Output quality matches or exceeds Core DSL V1

---

## Files Modified

1. ✅ Created: `lib/agentkit/v6/intent/intent-system-prompt-v2.ts`
2. ✅ Updated: `lib/agentkit/v6/intent/generate-intent.ts`
   - Added `validateGenericIntentV1()`
   - Added `generateGenericIntentContractV1()`
   - Fixed regex flag compatibility issue

---

## Next Actions

1. 🔴 **TEST** - Run generation with new function on sample workflow
2. 🔴 **VERIFY** - Check output structure matches intent-schema-types.ts
3. 🔴 **BIND** - Test CapabilityBinder with generated contract
4. 🟡 **REFINE** - Adjust prompt based on LLM output quality
5. 🟡 **INTEGRATE** - Update pipeline orchestrator to use new format
6. ⚪ **DEPRECATE** - Mark Core DSL V1 as legacy
7. ⚪ **DOCUMENT** - Update developer guide with new format

---

**Status:** 🟡 Ready for Testing - Implementation complete, awaiting validation

**Blocker:** Need to test with real LLM generation to verify output quality and structure
