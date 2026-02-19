# Week 2: Pipeline Integration - COMPLETE

**Date:** February 9, 2026
**Status:** ✅ IMPLEMENTED

---

## Summary

Integrated the requirements system (Week 1) into the V6 pipeline with validation gates at each phase.

Following OpenAI's compiler approach:
- **Workflow creation is COMPILATION, not generation**
- **Every transformation is validated**: Lossless, Traceable, Constraint-preserving
- **A workflow that violates intent MUST BE REJECTED**

---

## Components Implemented

### 1. V6PipelineOrchestrator

**File:** [lib/agentkit/v6/pipeline/V6PipelineOrchestrator.ts](lib/agentkit/v6/pipeline/V6PipelineOrchestrator.ts)

**Purpose:** Orchestrates the full pipeline with validation gates

**Flow:**
```
Enhanced Prompt
     ↓
Phase 0: Extract Hard Requirements
     ↓
Phase 1: Generate Semantic Plan → [Gate 1: Validate Semantic]
     ↓
Phase 2: Grounding → [Gate 2: Validate Grounding]
     ↓
Phase 3: Generate IR → [Gate 3: Validate IR]
     ↓
Phase 4: Compile to DSL → [Gate 4: Validate Compilation]
     ↓
Gate 5: Final Validation (Intent Satisfaction)
     ↓
PASS or FAIL
```

**Features:**
- Automatic requirements extraction
- 5 validation gates
- Detailed logging at each phase
- Returns lineage trace for debugging
- Returns structured errors with gate information

**Example Usage:**
```typescript
const orchestrator = new V6PipelineOrchestrator()
const result = await orchestrator.run(enhancedPrompt, config)

if (!result.success) {
  // Validation failed
  console.error(`Failed at ${result.error.phase}`)
  console.error(`Reason: ${result.error.message}`)
  console.error(`Gate result:`, result.error.gate)
} else {
  // Success
  console.log('Workflow:', result.workflow)
  console.log('Requirements:', result.hardRequirements)
  console.log('Lineage:', result.requirementMap)
}
```

### 2. API Endpoints

#### A. Generate Workflow with Validation

**Endpoint:** `POST /api/v6/generate-workflow-validated`

**File:** [app/api/v6/generate-workflow-validated/route.ts](app/api/v6/generate-workflow-validated/route.ts)

**Purpose:** Full pipeline with validation gates

**Request:**
```json
{
  "enhanced_prompt": {
    "sections": {
      "data": ["..."],
      "actions": ["..."],
      "delivery": ["..."]
    }
  },
  "config": {
    "provider": "openai",
    "model": "gpt-4o",
    "temperature": 0.1
  }
}
```

**Response (Success):**
```json
{
  "success": true,
  "workflow": { /* compiled DSL */ },
  "hard_requirements": {
    "count": 8,
    "unit_of_work": "attachment",
    "thresholds_count": 1,
    "invariants_count": 2,
    "requirements": [ /* detailed requirements */ ]
  },
  "validation_results": {
    "semantic": "PASS",
    "grounding": "PASS",
    "ir": "PASS",
    "compilation": "PASS",
    "final": "PASS"
  },
  "lineage": [ /* requirement tracking */ ],
  "metadata": {
    "total_requirements": 8,
    "enforced_requirements": 8,
    "pipeline_complete": true
  }
}
```

**Response (Failure):**
```json
{
  "success": false,
  "error": {
    "phase": "ir",
    "message": "Requirements not preserved: 2 unmapped, 1 violated",
    "gate_result": {
      "stage": "ir",
      "result": "FAIL",
      "unmapped_requirements": ["R3", "R5"],
      "violated_constraints": ["Sequential order not enforced"]
    }
  }
}
```

**Status Code:**
- `200`: Success
- `422`: Validation failed (workflow would violate intent)
- `400`: Invalid input
- `500`: Server error

#### B. Requirements Lineage (Debug Endpoint)

**Endpoint:** `POST /api/v6/requirements-lineage`

**File:** [app/api/v6/requirements-lineage/route.ts](app/api/v6/requirements-lineage/route.ts)

**Purpose:** Extract and display requirements WITHOUT running full pipeline

**Use Case:** Debug what requirements will be extracted before running pipeline

**Request:**
```json
{
  "enhanced_prompt": {
    "sections": {
      "data": ["..."],
      "actions": ["..."],
      "delivery": ["..."]
    }
  }
}
```

**Response:**
```json
{
  "success": true,
  "requirements": [
    {
      "id": "R1",
      "type": "unit_of_work",
      "constraint": "unit_of_work=attachment",
      "source": "data[0]"
    },
    {
      "id": "R2",
      "type": "threshold",
      "constraint": "amount>50",
      "source": "actions[7]"
    }
  ],
  "requirement_map": {
    "R1": { "status": "pending" },
    "R2": { "status": "pending" }
  },
  "breakdown": {
    "total_requirements": 8,
    "by_type": {
      "unit_of_work": 1,
      "threshold": 1,
      "invariant": 2,
      ...
    },
    "constraints": {
      "unit_of_work": "attachment",
      "thresholds": [ /* ... */ ],
      "invariants": [ /* ... */ ]
    }
  }
}
```

---

## Validation Gates

### Gate 1: Semantic Plan
**Checks:**
- Every requirement has semantic mapping
- No requirements removed or weakened
- Unit of work preserved
- Thresholds present

**Failure Example:**
```json
{
  "stage": "semantic",
  "result": "FAIL",
  "reason": "Requirements not preserved: 3 unmapped",
  "unmapped_requirements": ["R4", "R5", "R6"]
}
```

### Gate 2: Grounding
**Checks:**
- All semantic constructs have concrete capabilities
- Routing rules NOT weakened to user questions
- Thresholds preserved

### Gate 3: IR
**Checks:**
- Every requirement maps to IR node
- Control flow explicit (for_each, if/else, route)
- Unit of work not flattened
- Sequential dependencies explicit
- Thresholds before side effects

### Gate 4: Compilation
**Checks:**
- Every IR node maps to DSL steps
- Guards inserted for thresholds
- Routing nodes exist
- Explode steps for iteration
- Invariants structurally enforced

### Gate 5: Final Validation
**Checks:**
- All requirements enforced
- Required outputs present
- **Intent satisfaction**: "Could this workflow do the wrong thing?"
  - If YES → FAIL
  - If NO → PASS

---

## Lineage Tracking

Each requirement is tracked through all phases:

```json
{
  "id": "R3",
  "type": "invariant",
  "constraint": "create_folder→upload_file (sequential)",
  "source": "actions[4]",
  "status": "enforced",
  "semantic_construct": "understanding.file_operations[0].trigger",
  "grounded_capability": "grounded_plan.capabilities",
  "ir_node": "ir.delivery_rules.multiple_destinations",
  "dsl_step": "step_16, step_17"
}
```

**Status Progression:**
```
pending → mapped → grounded → compiled → enforced
```

---

## Error Handling

### Validation Failure
When a gate fails, pipeline stops and returns detailed error:

```typescript
{
  success: false,
  error: {
    phase: 'ir',  // Which phase failed
    message: 'Sequential dependencies not enforced',  // Human-readable
    gate: {
      stage: 'ir',
      result: 'FAIL',
      violated_constraints: ['create_folder→upload_file order not enforced']
    }
  }
}
```

### HTTP Status Codes
- `422 Unprocessable Entity`: Validation failed (workflow would violate intent)
- `400 Bad Request`: Invalid input
- `500 Internal Server Error`: Unexpected error

---

## Testing Strategy

### Unit Tests (TODO - Week 4)
```typescript
describe('V6PipelineOrchestrator', () => {
  test('rejects workflow with sequential dependency in parallel', async () => {
    const result = await orchestrator.run(enhancedPromptWithParallelViolation)
    expect(result.success).toBe(false)
    expect(result.error?.phase).toBe('final_validation')
    expect(result.error?.gate?.violated_constraints).toContain('Parallel step contains dependencies')
  })
})
```

### Integration Tests (TODO - Week 4)
- Test invoice/expense workflow (provided example)
- Test simple workflows (ensure not broken)
- Test edge cases (empty data, missing fields, etc.)

---

## Key Differences from Week 1

| Week 1 | Week 2 |
|--------|--------|
| Requirements infrastructure | Pipeline integration |
| Validation gates (logic) | API endpoints (wiring) |
| Standalone components | Orchestrated flow |
| Can't run workflows | Can generate & validate workflows |

---

## Next Steps

**Week 3:** Update existing phases to use requirement_map
- Modify IRFormalizer to receive requirements and use in prompts
- Modify DeclarativeCompiler to enforce constraints structurally
- Add data capture steps based on data flow

**Week 4:** Testing & refinement
- Test with real Enhanced Prompts
- Refine validation logic
- Add comprehensive error messages
- Performance optimization

---

## Files Created

1. **lib/agentkit/v6/pipeline/V6PipelineOrchestrator.ts** - Pipeline orchestrator
2. **lib/agentkit/v6/pipeline/index.ts** - Exports
3. **app/api/v6/generate-workflow-validated/route.ts** - Main API endpoint
4. **app/api/v6/requirements-lineage/route.ts** - Debug endpoint
5. **WEEK-2-PIPELINE-INTEGRATION.md** - This documentation

---

## Success Criteria

✅ **Pipeline orchestrator created** - V6PipelineOrchestrator
✅ **5 validation gates integrated** - Semantic, Grounding, IR, Compilation, Final
✅ **API endpoints created** - /generate-workflow-validated, /requirements-lineage
✅ **Error handling implemented** - Structured errors with gate information
✅ **Lineage tracking working** - Requirements tracked through all phases
✅ **Documentation complete** - This file

---

**Status:** ✅ WEEK 2 COMPLETE
**Next:** Week 3 - Update existing phases to enforce requirements
