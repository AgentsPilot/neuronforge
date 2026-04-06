# V6 Pipeline Architecture - Systemic Fixes for Information Loss

**Date:** February 16, 2026
**Status:** 📋 Implementation Plan Ready
**Priority:** HIGH - Addresses root cause of recurring bugs

---

## Executive Summary

### Context

After implementing 7 calibration fixes (conditional branches, global step IDs, item variable detection, in/not_in operators), we've identified systemic architectural issues causing bugs to recur.

### User's Concern

> "We a bit going back to adding LLM instructions after every issue we identify. My concern is it will not scale the way it is just now."

### Root Problem

The V6 pipeline **loses hard requirements between phases**, causing LLMs to generate workflows that violate constraints. Requirements are passed as **instructional text in prompts**, not as **structured data** that flows through the pipeline.

### 4 Root Causes Identified

1. **Requirements as Documentation, Not Data** - Requirements passed as text in prompts, no schema fields to track preservation
2. **Schema-Instruction Mismatch** - Prompts say "preserve requirements" but schemas have no fields for it
3. **Validation is String Matching** - Uses `includes()` and `JSON.stringify()`, can't detect logical errors
4. **No Structural Validators** - No graph traversal to validate dependencies, no data flow analysis

### Solution Approach

Add requirements tracking to schemas, embed requirements in IR, replace string matching with structural validation, create **contract-based pipeline** where each phase proves requirements satisfaction.

### Impact

- ✅ Eliminates root cause of bugs
- ✅ Scales to any future requirements
- ✅ Moves from reactive fixes to proactive enforcement
- ✅ Self-documenting (requirements tracking shows enforcement)

---

## Detailed Analysis: Where Requirements Are Lost

### Phase 0 → Phase 1: Requirements as Text, Not Data

**File:** `lib/agentkit/v6/requirements/HardRequirementsExtractor.ts` (lines 119-206)

Extracts requirements correctly as structured data:
```typescript
{
  "requirements": [{
    "id": "R1",
    "type": "threshold",
    "constraint": "amount > 50 gates append_sheets"
  }],
  "thresholds": [{
    "field": "amount",
    "operator": "gt",
    "value": 50,
    "applies_to": ["append_sheets"]
  }]
}
```

**File:** `lib/agentkit/v6/semantic-plan/SemanticPlanGenerator.ts` (lines 598-668)

Injects requirements as markdown text into prompt:
```typescript
message += `## 🔒 Hard Requirements (MUST PRESERVE)\n\n`
message += `These are non-negotiable constraints...\n\n`
// Just adds markdown text to prompt!
```

**Problem:** Requirements are **instructional text**, not **structured constraints**.

**File:** `lib/agentkit/v6/logical-ir/schemas/semantic-plan-types.ts` (lines 25-56)

SemanticPlan schema has NO requirements field:
```typescript
export interface SemanticPlan {
  plan_version: '1.0'
  goal: string
  understanding: Understanding  // ❌ No requirements field
  // ❌ MISSING: requirements_mapping
  // ❌ MISSING: requirements_violations
}
```

**Result:** LLM receives requirements in prompt but output schema can't capture preservation tracking. Information is **lost** when semantic plan is serialized.

---

### Phase 1 → Phase 3: Semantic Plan Drops Requirements

**File:** `lib/agentkit/v6/semantic-plan/SemanticPlanGenerator.ts` (line 200)

Returns SemanticPlan without requirements:
```typescript
return {
  success: true,
  semantic_plan: semanticPlan,  // ❌ No requirements field
  metadata: { ... }
}
```

**Information Lost:**
- Which requirements were incorporated into understanding?
- Which requirements were violated/ignored?
- How do thresholds map to conditionals in understanding?
- How do invariants map to operation sequencing?

**File:** `lib/agentkit/v6/semantic-plan/IRFormalizer.ts` (lines 161-164)

Receives requirements as optional parameter (not embedded):
```typescript
async formalize(
  groundedPlan: GroundedSemanticPlan,
  hardRequirements?: HardRequirements  // ❌ Optional, not embedded
): Promise<FormalizationResult>
```

**File:** `lib/agentkit/v6/logical-ir/schemas/declarative-ir-types-v4.ts` (lines 597-620)

DeclarativeLogicalIRv4 schema doesn't store requirements:
```typescript
export interface DeclarativeLogicalIRv4 {
  ir_version: '3.0' | '4.0'
  goal: string
  execution_graph?: ExecutionGraph
  context?: {  // ❌ Requirements not in context
    enhanced_prompt?: any
    semantic_plan?: any
    grounding_results?: any[]
    // ❌ MISSING: hard_requirements field
  }
}
```

**Critical Design Flaw:** If you serialize IR to JSON and pass to compiler later, **requirements are lost** because they're only in memory as a function parameter.

---

### Phase 4 → Phase 5: Validation is String Matching, Not Structural

**File:** `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts` (lines 168-186)

Validates requirements with warnings only:
```typescript
if (hardRequirements && hardRequirements.requirements.length > 0) {
  const requirementsValidation = this.validateHardRequirementsEnforcement(...)

  if (!requirementsValidation.valid) {
    this.warn(ctx, `Hard requirements validation warnings: ${...}`)  // ⚠️ WARN only
  }

  if (requirementsValidation.errors.length > 0) {
    return { success: false, ... }  // ❌ Only fails on errors
  }
}
```

**File:** `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts` (lines 1098-1112)

Threshold validation uses string matching:
```typescript
const hasConditional = workflow.some(step =>
  step.type === 'conditional' &&
  step.step_id?.includes(threshold.field.toLowerCase())  // ❌ STRING MATCH
)
```

**File:** `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts` (lines 1115-1128)

Routing validation uses JSON.stringify:
```typescript
const hasRouting = workflow.some(step =>
  (step.type === 'conditional' || step.type === 'action') &&
  JSON.stringify(step).includes(rule.condition)  // ❌ JSON.STRINGIFY!
)
```

**This is fundamentally broken:**
- Checks if step ID **contains** threshold field name (brittle!)
- Uses `JSON.stringify()` to search for routing condition text
- Cannot detect if conditional logic is **inverted** (e.g., `>` vs `<`)
- Cannot detect if conditional is in wrong **sequence** (before vs after data extraction)
- **Warnings** instead of **errors** (soft failures)

---

### Example: "no_duplicate_writes" Invariant

**How it SHOULD be validated:**
1. Build map of all file write operations
2. Group by target location (folder_id, spreadsheet_id)
3. Check if any location written to multiple times
4. If yes → FAIL with specific node IDs

**How it ACTUALLY is validated:**

**File:** `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts` (lines 1089-1095)

```typescript
for (const invariant of hardRequirements.invariants) {
  if (invariant.type === 'sequential_dependency') {
    // Check that execution graph enforces the sequential dependency
    // This is validated by ExecutionGraphValidator, so we just log it
    this.log(ctx, `✓ Sequential dependency enforced: ${invariant.description}`)
  }
}
```

**PUNTS TO ANOTHER VALIDATOR** - but that validator doesn't receive hard requirements!

---

## Solution Overview: Contract-Based Requirements Propagation

### The Real Problem

Requirements are passed as instructional text instead of structured data that flows through the pipeline. Each phase loses information because schemas don't track requirements preservation.

### The Solution

Make requirements **first-class data** that flows through every phase, with each phase proving it preserved them.

### Core Principle: Requirements as Contracts

Instead of adding more LLM instructions after every bug, we build architectural guarantees:

1. **Embed requirements in schemas** - Add fields to track preservation
2. **Pass requirements through pipeline** - Each phase receives and emits requirements
3. **Validate structural enforcement** - Replace string matching with graph analysis
4. **Fail fast on violations** - Errors instead of warnings

This creates a **contract-based pipeline** where each phase must prove it satisfied requirements.

---

## Three-Tier Fix Strategy

### Tier 1: Schema Changes (Foundation)

Add requirements tracking fields to enable data flow.

#### File: `lib/agentkit/v6/logical-ir/schemas/semantic-plan-types.ts`

```typescript
export interface SemanticPlan {
  // ... existing fields

  /** Hard requirements passed from Phase 0 */
  hard_requirements?: HardRequirements

  /** Mapping of requirements to semantic plan elements */
  requirements_mapping?: Array<{
    requirement_id: string
    mapped_to: {
      understanding_field: string  // e.g., "ai_processing[0]", "file_operations[2]"
      preservation_strategy: string  // How it's preserved
      confidence: 'full' | 'partial' | 'unclear'
    }
  }>

  /** Requirements that couldn't be preserved */
  requirements_violations?: Array<{
    requirement_id: string
    reason: string
    suggested_resolution: string
  }>
}
```

#### File: `lib/agentkit/v6/logical-ir/schemas/declarative-ir-types-v4.ts`

```typescript
export interface DeclarativeLogicalIRv4 {
  // ... existing fields

  context?: {
    enhanced_prompt?: any
    semantic_plan?: any
    grounding_results?: any[]
    hard_requirements?: HardRequirements  // ✅ ADD THIS
  }

  /** Enforcement tracking */
  requirements_enforcement?: Array<{
    requirement_id: string
    enforced_by: {
      node_ids: string[]  // Which nodes enforce this
      enforcement_mechanism: 'choice' | 'sequence' | 'input_binding' | 'output_capture'
    }
    validation_passed: boolean
  }>
}
```

**Why This Works:**
- Makes requirements first-class data that can be serialized
- Each phase can track how it preserved requirements
- Enables validation at compilation time

---

### Tier 2: Generator Changes (Data Flow)

Update generators to emit and track requirements.

#### File: `lib/agentkit/v6/semantic-plan/SemanticPlanGenerator.ts`

**Changes:**
- Line 200: Return requirements in output structure
- Line 598-668: Keep requirements injection in prompt (backward compatible)
- Add method to validate requirements mapping completeness
- If missing mapping: Log warning with requirement IDs that aren't mapped

#### File: `lib/agentkit/v6/semantic-plan/prompts/semantic-plan-system.md`

**Changes:**
- Lines 57-162: Add requirement mapping instructions
- Add section: "How to Fill requirements_mapping Field"
- Add example showing explicit requirement → understanding mapping

**Example addition to prompt:**

```markdown
## Requirements Mapping (CRITICAL)

You MUST fill the `requirements_mapping` field to show how each hard requirement was preserved:

```json
{
  "requirements_mapping": [
    {
      "requirement_id": "R1",
      "mapped_to": {
        "understanding_field": "post_ai_filtering.conditions[0]",
        "preservation_strategy": "Threshold mapped to conditional filter after AI extraction",
        "confidence": "full"
      }
    }
  ]
}
```

If a requirement CANNOT be preserved, add to `requirements_violations`:

```json
{
  "requirements_violations": [
    {
      "requirement_id": "R2",
      "reason": "Plugin does not support required operation",
      "suggested_resolution": "Use alternative plugin or manual step"
    }
  ]
}
```
```

#### File: `lib/agentkit/v6/semantic-plan/IRFormalizer.ts`

**Changes:**
- Line 161: Change signature to get requirements from semantic plan:
  ```typescript
  async formalize(
    groundedPlan: GroundedSemanticPlan,  // Already has hard_requirements field
  ): Promise<FormalizationResult>
  ```
- Extract requirements from `groundedPlan.hard_requirements`
- Embed requirements in IR output context
- During formalization, track which nodes enforce which requirements
- Return `requirements_enforcement` array in IR

#### File: `lib/agentkit/v6/semantic-plan/prompts/formalization-system-v4.md`

**Changes:**
- Lines 1-45: Update hard requirements section
- Add: "You MUST track enforcement in requirements_enforcement field"
- Add example showing requirement → node_id mapping

**Example addition to prompt:**

```markdown
## Enforcement Tracking (CRITICAL)

You MUST fill the `requirements_enforcement` field to show which nodes enforce each requirement:

```json
{
  "requirements_enforcement": [
    {
      "requirement_id": "R1",
      "enforced_by": {
        "node_ids": ["check_amount"],
        "enforcement_mechanism": "choice"
      },
      "validation_passed": true
    }
  ]
}
```

**Enforcement Mechanisms:**
- `choice`: Requirement enforced by conditional branching (choice node)
- `sequence`: Requirement enforced by node ordering (`next` fields)
- `input_binding`: Requirement enforced by data dependencies (inputs/outputs)
- `output_capture`: Requirement enforced by capturing required output fields
```

**Why This Works:**
- Requirements flow through pipeline as structured data
- Can serialize/deserialize without information loss
- Each phase accountable for preservation tracking

---

### Tier 3: Validation Changes (Enforcement)

Replace string matching with structural validation.

#### File: `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts`

**Current Implementation (Broken):**

Lines 1098-1112 - Threshold validation:
```typescript
const hasConditional = workflow.some(step =>
  step.type === 'conditional' &&
  step.step_id?.includes(threshold.field.toLowerCase())  // ❌ STRING MATCH
)
```

**New Implementation (Structural):**

```typescript
/**
 * Validate threshold enforcement using graph traversal
 */
private validateThresholdEnforcement(
  threshold: Threshold,
  graph: ExecutionGraph,
  workflow: WorkflowStep[]
): ValidationResult {
  const errors: string[] = []

  // 1. Find node that outputs threshold.field (extraction node)
  const extractionNode = this.findNodeThatOutputs(threshold.field, graph)
  if (!extractionNode) {
    errors.push(`Threshold field '${threshold.field}' is never extracted`)
    return { valid: false, errors }
  }

  // 2. Find all nodes using threshold.applies_to actions (action nodes)
  const actionNodes = threshold.applies_to.map(action =>
    this.findNodeByAction(action, graph)
  ).filter(n => n !== null)

  if (actionNodes.length === 0) {
    errors.push(`No nodes found for threshold.applies_to: ${threshold.applies_to.join(', ')}`)
    return { valid: false, errors }
  }

  // 3. For each action node, find gating conditional
  for (const actionNode of actionNodes) {
    const conditionalNode = this.findConditionalBeforeNode(actionNode, graph)

    if (!conditionalNode) {
      errors.push(`Action ${actionNode.id} not gated by threshold conditional`)
      continue
    }

    // 4. Validate conditional uses correct field, operator, value
    const condition = this.extractConditionFromNode(conditionalNode)

    if (condition.variable !== threshold.field &&
        !condition.variable.endsWith(`.${threshold.field}`)) {
      errors.push(
        `Conditional ${conditionalNode.id} checks wrong field: ` +
        `expected '${threshold.field}', got '${condition.variable}'`
      )
    }

    if (condition.operator !== threshold.operator) {
      errors.push(
        `Conditional ${conditionalNode.id} uses wrong operator: ` +
        `expected '${threshold.operator}', got '${condition.operator}'`
      )
    }

    if (condition.value !== threshold.value) {
      errors.push(
        `Conditional ${conditionalNode.id} uses wrong value: ` +
        `expected '${threshold.value}', got '${condition.value}'`
      )
    }

    // 5. Validate conditional comes AFTER extraction (graph traversal)
    if (!this.isReachable(extractionNode.id, conditionalNode.id, graph)) {
      errors.push(
        `Conditional ${conditionalNode.id} checks '${threshold.field}' ` +
        `before it's extracted in ${extractionNode.id}`
      )
    }
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Check if targetNodeId is reachable from sourceNodeId via next pointers
 */
private isReachable(
  sourceNodeId: string,
  targetNodeId: string,
  graph: ExecutionGraph,
  visited = new Set<string>()
): boolean {
  if (sourceNodeId === targetNodeId) return true
  if (visited.has(sourceNodeId)) return false
  visited.add(sourceNodeId)

  const node = graph.nodes[sourceNodeId]
  if (!node) return false

  // Check linear next
  if (node.next && this.isReachable(node.next, targetNodeId, graph, visited)) {
    return true
  }

  // Check choice branches
  if (node.type === 'choice' && node.choice) {
    for (const rule of node.choice.rules) {
      if (rule.next && this.isReachable(rule.next, targetNodeId, graph, visited)) {
        return true
      }
    }
    if (node.choice.default &&
        this.isReachable(node.choice.default, targetNodeId, graph, visited)) {
      return true
    }
  }

  // Check parallel branches
  if (node.type === 'parallel' && node.parallel) {
    for (const branch of node.parallel.branches) {
      if (branch.start && this.isReachable(branch.start, targetNodeId, graph, visited)) {
        return true
      }
    }
  }

  return false
}
```

**For sequential_dependency validation:**

```typescript
/**
 * Validate sequential dependency using graph traversal
 */
private validateSequentialDependency(
  invariant: Invariant,
  graph: ExecutionGraph
): ValidationResult {
  const errors: string[] = []

  // Parse dependency description (e.g., "create_folder MUST happen before upload_file")
  const match = invariant.description.match(/(\w+)\s+(?:MUST|must)\s+(?:happen\s+)?before\s+(\w+)/)
  if (!match) {
    errors.push(`Cannot parse sequential dependency: ${invariant.description}`)
    return { valid: false, errors }
  }

  const [_, firstOp, secondOp] = match

  // Find nodes by operation type
  const firstNode = this.findNodeByOperationType(firstOp, graph)
  const secondNode = this.findNodeByOperationType(secondOp, graph)

  if (!firstNode) {
    errors.push(`Cannot find node for operation: ${firstOp}`)
    return { valid: false, errors }
  }

  if (!secondNode) {
    errors.push(`Cannot find node for operation: ${secondOp}`)
    return { valid: false, errors }
  }

  // Check graph reachability
  if (!this.isReachable(firstNode.id, secondNode.id, graph)) {
    errors.push(
      `Sequential dependency violated: ${firstOp} (${firstNode.id}) ` +
      `must happen before ${secondOp} (${secondNode.id}), but not reachable in graph`
    )
  }

  // Check output binding (secondNode should use firstNode's output)
  const firstNodeOutputs = firstNode.outputs?.map(o => o.variable) || []
  const secondNodeInputs = secondNode.inputs?.map(i => i.variable) || []

  const hasDataDependency = firstNodeOutputs.some(output =>
    secondNodeInputs.includes(output)
  )

  if (!hasDataDependency) {
    errors.push(
      `Sequential dependency missing data flow: ${secondOp} (${secondNode.id}) ` +
      `should use output from ${firstOp} (${firstNode.id})`
    )
  }

  return { valid: errors.length === 0, errors }
}
```

**For no_duplicate_writes validation:**

```typescript
/**
 * Validate no duplicate writes invariant
 */
private validateNoDuplicateWrites(
  graph: ExecutionGraph
): ValidationResult {
  const errors: string[] = []
  const writeOperations = new Map<string, string[]>() // target -> node_ids[]

  // Find all file operation nodes
  for (const [nodeId, node] of Object.entries(graph.nodes)) {
    if (node.type !== 'operation' ||
        node.operation?.operation_type !== 'file_operation') {
      continue
    }

    const fileOp = node.operation.file_operation
    if (!fileOp || fileOp.operation !== 'write') continue

    // Extract target location
    const target = this.extractWriteTarget(fileOp)
    if (!target) continue

    if (!writeOperations.has(target)) {
      writeOperations.set(target, [])
    }
    writeOperations.get(target)!.push(nodeId)
  }

  // Check for duplicates
  for (const [target, nodeIds] of writeOperations.entries()) {
    if (nodeIds.length > 1) {
      errors.push(
        `Duplicate writes to '${target}' in nodes: ${nodeIds.join(', ')}. ` +
        `Violates 'no_duplicate_writes' invariant.`
      )
    }
  }

  return { valid: errors.length === 0, errors }
}

private extractWriteTarget(fileOp: any): string | null {
  // Extract target from config (folder_id, spreadsheet_id, etc.)
  if (fileOp.config?.folder_id) return `folder:${fileOp.config.folder_id}`
  if (fileOp.config?.spreadsheet_id) return `sheet:${fileOp.config.spreadsheet_id}`
  if (fileOp.config?.file_path) return `file:${fileOp.config.file_path}`
  return null
}
```

**Why This Works:**
- Detects logical errors (wrong operator, wrong sequence)
- Uses graph traversal instead of string search
- Fails fast with specific node IDs
- Can't be fooled by comments or coincidental string matches

---

## Implementation Plan

### Phase 1: Schema Changes (Foundation)

**Goal:** Add requirements tracking fields to enable data flow.

**Files to Modify:**

1. **`lib/agentkit/v6/logical-ir/schemas/semantic-plan-types.ts`**
   - Add `hard_requirements?: HardRequirements` field
   - Add `requirements_mapping?: RequirementMapping[]` field
   - Add `requirements_violations?: RequirementViolation[]` field

2. **`lib/agentkit/v6/logical-ir/schemas/declarative-ir-types-v4.ts`**
   - Add `hard_requirements?: HardRequirements` to context
   - Add `requirements_enforcement?: RequirementEnforcement[]` field

**Success Criteria:**
- ✅ Schemas compile without TypeScript errors
- ✅ Can serialize/deserialize SemanticPlan with requirements
- ✅ Can serialize/deserialize IR with requirements
- ✅ Existing tests pass (backward compatible)

**Estimated Effort:** 2 hours

---

### Phase 2: Update Semantic Plan Generation

**Goal:** Make SemanticPlanGenerator emit requirements tracking.

**Files to Modify:**

3. **`lib/agentkit/v6/semantic-plan/SemanticPlanGenerator.ts`**
   - Lines 598-668: Keep requirements injection in prompt (backward compatible)
   - Line 200: Update return value to include requirements from input
   - Add validation: Check if LLM provided requirements_mapping in output
   - If missing mapping: Log warning with requirement IDs that aren't mapped

4. **`lib/agentkit/v6/semantic-plan/prompts/semantic-plan-system.md`**
   - Lines 57-162: Add requirement mapping instructions
   - Add section: "How to Fill requirements_mapping Field"
   - Add example showing explicit requirement → understanding mapping

**Success Criteria:**
- ✅ Semantic plan includes hard_requirements field
- ✅ LLM generates requirements_mapping (even if partial)
- ✅ Warnings appear for unmapped requirements
- ✅ Generated workflows still execute correctly

**Estimated Effort:** 4 hours

---

### Phase 3: Update IR Formalization

**Goal:** Embed requirements in IR and track enforcement.

**Files to Modify:**

5. **`lib/agentkit/v6/semantic-plan/IRFormalizer.ts`**
   - Line 161: Change signature to get requirements from semantic plan
   - Extract requirements from `groundedPlan.hard_requirements`
   - Embed requirements in IR output context
   - During formalization, track which nodes enforce which requirements
   - Return `requirements_enforcement` array in IR

6. **`lib/agentkit/v6/semantic-plan/prompts/formalization-system-v4.md`**
   - Lines 1-45: Update hard requirements section
   - Add: "You MUST track enforcement in requirements_enforcement field"
   - Add example showing requirement → node_id mapping

**Success Criteria:**
- ✅ IR includes hard_requirements in context
- ✅ IR includes requirements_enforcement tracking
- ✅ Can identify which nodes enforce which requirements
- ✅ Serialized IR preserves all requirement information

**Estimated Effort:** 4 hours

---

### Phase 4: Replace Validation String Matching

**Goal:** Use graph traversal instead of string matching.

**Files to Modify:**

7. **`lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts`**
   - Lines 1078-1177: Rewrite `validateHardRequirementsEnforcement()`
   - Add helper methods:
     - `validateThresholdEnforcement()`
     - `validateSequentialDependency()`
     - `validateNoDuplicateWrites()`
     - `isReachable()` - graph traversal
     - `findNodeThatOutputs()` - find extraction nodes
     - `findNodeByAction()` - find action nodes
     - `findConditionalBeforeNode()` - find gating conditionals
     - `findNodeByOperationType()` - find nodes by operation
     - `extractWriteTarget()` - extract write targets

**Success Criteria:**
- ✅ Validation uses graph traversal, not string matching
- ✅ Can detect wrong operator (gt vs lt)
- ✅ Can detect wrong sequence (conditional before extraction)
- ✅ Returns ERRORS that fail compilation, not warnings
- ✅ Error messages include specific node IDs
- ✅ Existing valid workflows still compile

**Estimated Effort:** 8 hours

---

## Critical Files Summary

### Schema Files (Phase 1)
1. `lib/agentkit/v6/logical-ir/schemas/semantic-plan-types.ts`
2. `lib/agentkit/v6/logical-ir/schemas/declarative-ir-types-v4.ts`

### Generator Files (Phases 2-3)
3. `lib/agentkit/v6/semantic-plan/SemanticPlanGenerator.ts`
4. `lib/agentkit/v6/semantic-plan/IRFormalizer.ts`

### Prompt Files (Phases 2-3)
5. `lib/agentkit/v6/semantic-plan/prompts/semantic-plan-system.md`
6. `lib/agentkit/v6/semantic-plan/prompts/formalization-system-v4.md`

### Validation File (Phase 4)
7. `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts`

---

## Expected Outcomes

### Immediate Benefits

1. **Requirements preserved through pipeline** - No more information loss between phases
2. **Validation catches logical errors** - Can detect wrong operator, wrong sequence, missing enforcement
3. **Compilation fails on violations** - Errors instead of warnings
4. **Clear failure messages** - Specific node IDs that violate requirements
5. **Self-documenting** - Requirements tracking shows which nodes enforce what

### Long-Term Benefits

1. **Scales to new requirements** - Add new requirement types without changing code
2. **Fewer bugs** - Structural validation prevents bugs proactively instead of reactively
3. **Debugging easier** - Can trace requirement from Phase 0 → semantic plan → IR node → validation
4. **Confidence in generated workflows** - Know that all requirements are enforced
5. **Reduced LLM prompt complexity** - Don't need to add more instructions for every bug

---

## Testing Strategy

### Phase 1 Tests (Schema Changes)
- Compile TypeScript schemas without errors
- Serialize and deserialize SemanticPlan with requirements
- Serialize and deserialize IR with requirements
- Run existing test suite to ensure backward compatibility

### Phase 2 Tests (Semantic Plan Generation)
- Generate semantic plan for workflow with hard requirements
- Verify `hard_requirements` field is populated
- Verify `requirements_mapping` field is populated (or warning logged)
- Test with multiple requirement types (thresholds, invariants, routing)
- Verify existing workflows without requirements still work

### Phase 3 Tests (IR Formalization)
- Formalize semantic plan with requirements
- Verify IR includes `hard_requirements` in context
- Verify IR includes `requirements_enforcement` tracking
- Test that node IDs in enforcement tracking are correct
- Serialize IR to JSON and deserialize to verify no information loss

### Phase 4 Tests (Validation)
- **Threshold validation:**
  - ✅ Valid: Threshold enforced with correct operator/value/sequence
  - ❌ Invalid: Wrong operator (gt instead of lt)
  - ❌ Invalid: Conditional before extraction
  - ❌ Invalid: Missing conditional gate

- **Sequential dependency validation:**
  - ✅ Valid: Operations in correct sequence with data dependency
  - ❌ Invalid: Operations not reachable in graph
  - ❌ Invalid: Missing data dependency between operations

- **No duplicate writes validation:**
  - ✅ Valid: Each target written to once
  - ❌ Invalid: Same folder/spreadsheet/file written multiple times

### Regression Testing
- Run all existing E2E workflow tests
- Verify workflows without requirements still work
- Verify calibration still works
- Verify compilation logs still visible

---

## Success Metrics

- ✅ Semantic plan includes `requirements_mapping` field
- ✅ IR includes `hard_requirements` in context
- ✅ IR includes `requirements_enforcement` tracking
- ✅ Validation uses graph traversal (no string matching)
- ✅ Compilation FAILS on requirement violations (not warns)
- ✅ Can detect: wrong operator, wrong sequence, missing enforcement, duplicate writes
- ✅ Error messages include specific node IDs
- ✅ Existing workflows continue to work (backward compatible)
- ✅ Can add new requirement types without code changes

---

## Risk Assessment

### Medium Risk Areas

1. **Schema changes** - Requires updating TypeScript types, may affect existing code that reads these schemas
2. **Validation rewrite** - Substantial change from string matching to graph traversal, needs thorough testing
3. **Prompt changes** - LLM may not immediately comply with new requirements_mapping instructions

### Mitigation Strategies

1. **Incremental implementation** - Implement in 4 phases, test each phase before proceeding
2. **Backward compatibility** - All fields are optional (`?`), existing workflows without requirements continue to work
3. **Comprehensive testing** - Test both with and without requirements at each phase
4. **Gradual rollout** - Keep old validation as fallback initially, switch after confidence builds

### Low Risk Areas

1. **No breaking changes to existing workflows** - All new fields are optional
2. **No changes to runtime execution** - Only affects generation and validation
3. **Preserves existing functionality** - Requirements injection in prompts kept for backward compatibility

---

## Recommendations

### Implementation Order

1. **Phase 1 (Schema Changes)** - Foundation, low risk, enables all other phases
2. **Phase 2 (Semantic Plan)** - Medium risk, test thoroughly with and without requirements
3. **Phase 3 (IR Formalization)** - Medium risk, verify serialization works correctly
4. **Phase 4 (Validation)** - Highest risk, implement incrementally, test each validation type separately

### Testing Approach

- After each phase, run full test suite
- Test both with and without requirements
- Test multiple requirement types (thresholds, invariants, routing)
- Test edge cases (missing operators, wrong sequence, duplicate writes)

### Rollout Strategy

1. Deploy Phase 1 to dev environment
2. Test Phase 2 with existing workflows
3. Deploy Phases 1-2 to staging
4. Test Phase 3 with serialization/deserialization
5. Deploy Phases 1-3 to staging
6. Test Phase 4 with validation errors
7. Deploy all phases to production after confidence builds

---

## Related Documentation

- **CALIBRATION-FIXES-COMPLETE.md** - Summary of 7 calibration fixes
- **CALIBRATION-CONDITIONAL-BRANCH-FIX.md** - Fix #1 and #2 details
- **NO-KEEP-FIXED-BUTTON-FIX.md** - Fix #3 details
- **GLOBAL-STEP-IDS-FIX.md** - Fix #4 details
- **CONDITIONAL-EVALUATOR-ITEM-VARIABLE-FIX.md** - Runtime fix
- **FORMALIZATION-IN-NOT-IN-OPERATOR-FIX.md** - Generic formalization fix
- **PARAMETERIZE-ALL-VERIFICATION.md** - Verification of bulk parameterization

---

**Total Estimated Effort:** 18 hours (2 + 4 + 4 + 8)
**Status:** 📋 Ready for implementation
**Next Step:** Start with Phase 1 (Schema Changes)
**Priority:** HIGH - Addresses root cause of recurring bugs
