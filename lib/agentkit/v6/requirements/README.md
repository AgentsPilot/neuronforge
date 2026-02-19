# Requirements System - Compiler Approach

Following OpenAI's recommendation: **Workflow creation is COMPILATION, not generation.**

## Core Principle

Treat every transformation as:
- **Lossless**: No information is lost between phases
- **Traceable**: Every requirement can be tracked from Enhanced Prompt → DSL
- **Constraint-preserving**: Hard requirements are enforced structurally
- **Rejectable**: A workflow that is executable but violates intent MUST BE REJECTED

## Architecture

```
Enhanced Prompt
     ↓
HardRequirementsExtractor (NO LLM, NO hardcoding)
     ↓
HardRequirements {
  unit_of_work, thresholds, routing_rules,
  invariants, required_outputs, side_effect_constraints
}
     ↓
[Validation Gate 1: Semantic]
     ↓
Semantic Plan + requirement_map
     ↓
[Validation Gate 2: Grounding]
     ↓
Grounded Plan + requirement_map
     ↓
[Validation Gate 3: IR]
     ↓
IR + requirement_map
     ↓
[Validation Gate 4: Compilation]
     ↓
DSL + requirement_map
     ↓
[Validation Gate 5: Final]
     ↓
PASS or FAIL
```

## Components

### 1. HardRequirementsExtractor

**Purpose**: Extract machine-checkable constraints from Enhanced Prompt

**NOT an LLM call** - structural analysis only
**NOT hardcoded patterns** - generic extraction

**Extracts**:
- `unit_of_work`: What is being processed (email | attachment | row | file | record)
- `thresholds`: Conditions that gate actions (amount > 50)
- `routing_rules`: Deterministic routing (invoice → Invoices tab)
- `invariants`: Things that MUST NEVER happen (no duplicate writes, sequential dependencies)
- `empty_behavior`: What happens if no data (fail | skip | notify)
- `required_outputs`: Fields that MUST exist (drive_link, file_id)
- `side_effect_constraints`: When writes/sends are allowed/forbidden

**Example Output**:
```typescript
{
  requirements: [
    {
      id: "R1",
      type: "threshold",
      constraint: "amount>50",
      source: "actions[7]"
    }
  ],
  thresholds: [{
    field: "amount",
    operator: "gt",
    value: 50,
    applies_to: ["append_to_sheets"]
  }],
  invariants: [{
    type: "sequential_dependency",
    description: "Create folder before upload",
    check: "create_folder.step_id < upload_file.step_id"
  }]
}
```

### 2. ValidationGates

**Purpose**: Validate each phase preserves requirements

**5 Gates**:

#### Gate 1: Semantic Plan
- Every requirement has semantic mapping
- No requirements removed or weakened
- Unit of work preserved
- Thresholds present

#### Gate 2: Grounding
- All semantic constructs have concrete capabilities
- Routing rules NOT weakened to user questions
- Thresholds preserved

#### Gate 3: IR
- Every requirement maps to IR node
- Control flow explicit (for_each, if/else, route)
- Unit of work not flattened
- Sequential dependencies explicit
- Thresholds before side effects

#### Gate 4: Compilation
- Every IR node maps to DSL steps
- Guards inserted for thresholds
- Routing nodes exist
- Explode steps for iteration
- Invariants structurally enforced

#### Gate 5: Final Validation
- All requirements enforced
- Required outputs present
- **Intent satisfaction**: "Could this workflow do the wrong thing?"
  - If YES → FAIL
  - If NO → PASS

## Generic Implementation

### NO Hardcoding

The validation helpers are **generic** and work for **any use case**:

```typescript
// ❌ BAD - Hardcoded
if (text.includes('attachment')) return 'attachment'

// ✅ GOOD - Generic structural check
hasProperty(obj, ['iteration_mode', 'per_item', 'for_each', 'loop'])
```

### Structure, Not Content

Validators check **structure and mappings**, not specific values:

```typescript
// Check if semantic plan has ANY construct for this requirement
private findSemanticMapping(req, semanticPlan): string | null {
  const path = this.deepSearch(semanticPlan, req.source, '')
  return path || null
}

// Generic deep search - works for any nested structure
private deepSearch(obj, searchTerm, currentPath): string | null {
  // Recursively traverse object, return path if found
}
```

### Property Existence, Not Keywords

```typescript
// Check if object has any of these properties (generic)
private hasProperty(obj, propertyNames: string[]): boolean {
  // Deep search for property existence
  // Works for filters, conditionals, iteration, routing, etc.
}
```

## Usage

```typescript
import { HardRequirementsExtractor, ValidationGates } from '@/lib/agentkit/v6/requirements'

// 1. Extract requirements
const extractor = new HardRequirementsExtractor()
const hardReqs = extractor.extract(enhancedPrompt)
const requirementMap = extractor.createRequirementMap(hardReqs)

// 2. Validate each phase
const gates = new ValidationGates()

// Gate 1: Semantic
const semanticResult = gates.validateSemanticPlan(semanticPlan, hardReqs, requirementMap)
if (semanticResult.result === 'FAIL') {
  throw new Error(`Semantic validation failed: ${semanticResult.reason}`)
}

// Gate 2: Grounding
const groundingResult = gates.validateGrounding(groundedPlan, hardReqs, requirementMap)
// ...

// Gate 3: IR
const irResult = gates.validateIR(ir, hardReqs, requirementMap)
// ...

// Gate 4: Compilation
const compilationResult = gates.validateCompilation(dslSteps, hardReqs, requirementMap)
// ...

// Gate 5: Final
const finalResult = gates.validateFinal(dslSteps, hardReqs, requirementMap)

if (finalResult.result === 'FAIL') {
  // REJECT workflow - it would do the wrong thing
  throw new Error(`Workflow violates intent: ${finalResult.reason}`)
}

// SUCCESS - workflow is correct
return { dsl, requirementMap, hardReqs }
```

## Requirement Map Tracking

Each requirement flows through all phases:

```typescript
{
  "R1": {
    semantic_construct: "understanding.filters[0]",
    grounded_capability: "grounded_plan.plugin[2]",
    ir_node: "ir.post_ai_filters",
    dsl_step: "step_5",
    status: "enforced"
  }
}
```

## Success Metric

**"Could this workflow ever do the wrong thing?"**

- If YES → FAIL (reject workflow creation)
- If NO → PASS (workflow is correct)

AgentPilot prefers a workflow that **FAILS CREATION** over one that **runs and violates intent**.

## Global Rules

1. **Never weaken a condition**
2. **Never replace deterministic logic with a question**
3. **Never allow "best effort" workflows**
4. **Never optimize for execution if intent is violated**
5. **Reject early and explicitly**

## Files

- `types.ts`: TypeScript interfaces (WorkflowContract, Requirement, etc.)
- `HardRequirementsExtractor.ts`: Extract machine-checkable constraints
- `ValidationGates.ts`: Validate each phase (5 gates)
- `index.ts`: Exports

## Next Steps (Implementation)

1. **Week 2**: Wire up pipeline with validation gates
2. **Week 3**: Update existing phases (SemanticPlanGenerator, IRFormalizer, DeclarativeCompiler) to use requirement_map
3. **Week 4**: Testing and refinement

The core infrastructure (Week 1) is **COMPLETE**.
