# DSL Execution Architectural Redesign

> **Status:** ~95% Complete (Phase 5F partially remaining)
> **Created:** 2026-01-10
> **Updated:** 2026-01-15
> **Goal:** Transform the agent execution pipeline from "best-effort string assembly" to "typed compiler/runtime"

---

## Table of Contents

1. [The Core Problem](#the-core-problem)
2. [Problem Inventory](#problem-inventory)
3. [Solution Architecture](#solution-architecture)
4. [Contract Specifications](#contract-specifications)
5. [Implementation Phases](#implementation-phases)
   - [Phase 1: Stability](#phase-1-stability-executor-normalization)
   - [Phase 2: Correctness](#phase-2-correctness-dsl-compilervalidator)
   - [Phase 3: Scale](#phase-3-scale-schema-propagation)
   - [Phase 4: Predictability](#phase-4-predictability-llm-output-enforcement-)
   - [Phase 5: Schema Contract Enforcement](#phase-5-schema-contract-enforcement-safe-execution)
6. [File Change Map](#file-change-map)
7. [Progress Tracker](#progress-tracker)
8. [Notes & Decisions](#notes--decisions)

---

## The Core Problem

### One Sentence Summary

We have **no compile-time contract** between declared outputs (Phase 4 / Reviewer / DSL) and observed outputs (Executor / plugin / LLM runtime).

### The Architectural Weakness

```
Phase 4 (LLM)  →  Reviewer (LLM)  →  DSL Builder  →  Executor (Runtime)
     ↓                ↓                  ↓                 ↓
  "suggests"      "refines"         "assumes"         "discovers truth"
   outputs         outputs           shapes              shapes
```

Each component makes *claims* about input/output shapes, but the **only place that knows the truth is runtime**. When those claims drift even slightly, execution becomes brittle.

### Why This Matters

- The system is "typed in text" but "untyped in execution"
- LLMs guess field names that don't match actual schemas
- Runtime wraps data in structures the DSL doesn't expect
- No validation catches these mismatches before execution
- Result: intermittent, hard-to-debug failures

### The Key Design Principle

> **LLMs can propose structure; code must enforce structure.**
>
> The executable pipeline needs a compiler + runtime normalization, not just better prompts.

---

## Problem Inventory

### Category: Naming Consistency

| # | Problem | Status |
|---|---------|--------|
| P1 | Output Key Naming Mismatches - Transform declares `action_items`, runtime returns `items` | ✅ Phase 1 |
| P3 | Template Field Names Don't Match Schema - Template uses `{{sender}}`, schema has `from.name` | ✅ Phase 3 |
| P5 | Transform Output Structure Inconsistency - Format returns raw string, not wrapped object | ✅ Phase 1 |
| P6 | Input Naming Convention Inconsistency - Template expects `{{data}}`, runtime provides `{value: ...}` | ✅ Phase 1 |

### Category: Data Structure

| # | Problem | Status |
|---|---------|--------|
| P2 | StepOutput Wrapper Not Accounted For - DSL expects `step.field`, runtime has `step.data.field` | ✅ Phase 1 |
| P9 | Type Shape Mismatches Between Steps - Operation returns nested object, transform expects flat | ✅ Phase 3 |
| P12 | Output Type Declaration vs Actual Type - Declared `object`, received `string` | ✅ Phase 3 |

### Category: Template Processing

| # | Problem | Status |
|---|---------|--------|
| P4 | Handlebars Templates Treated as Variables - `{{#each}}` matched as single variable | ✅ Phase 2 |
| P7 | JSON Template Escaping Issues - Unescaped quotes break JSON structure | ✅ Phase 2 |

### Category: Cross-Step References

| # | Problem | Status |
|---|---------|--------|
| P8 | Cross-Step Reference Validation Gap - `from_step` refs to non-existent outputs | ✅ Phase 2 |

### Category: Control Flow

| # | Problem | Status |
|---|---------|--------|
| P10 | Conditional Branch Data Flow Issues - Data availability unclear after branching | ✅ Control Flow |
| P11 | Loop Item Reference Ambiguity - `{{item}}` vs `{{item.data}}` confusion | ✅ Control Flow |

### Category: Schema Contract Enforcement (Phase 5)

| # | Problem | Status |
|---|---------|--------|
| P13 | `ai_processing` outputs not contract-enforced - validation fails silently, invalid data propagates | 🔄 Phase 5 (fail-fast pending) |
| P14 | Deterministic transforms underspecified - deduplicate missing `sort_field`/`keep`, split outputs generic `buckets: object` | ✅ Phase 5 |
| P15 | Output contracts don't match usage - DSL declares `buckets: object`, templates use `step4.data.action_required` | ✅ Phase 5 |
| P16 | Format steps lack formal input model - empty `input` causes spurious warnings | 🔄 Phase 5 (template_only pending) |
| P17 | Vague output types accepted - `"object"`, `"object[]"` pass through without schema | ✅ Phase 5 |

### Category: Runtime Execution (2026-01-15)

| # | Problem | Status |
|---|---------|--------|
| P18 | Handlebars `{{#each}}` blocks not rendering in JSON templates - `expandTemplateWithJsonEscape` bypassed Handlebars engine | ✅ Fixed |
| P19 | Map transform with columns falls back to ai_processing - `hasMappingConfig()` didn't recognize `columns` as valid | ✅ Fixed |
| P20 | Field name mismatch in map transforms - column names like "received time" didn't match fields like "received_time" | ✅ Fixed |
| P21 | Static values not supported in map transforms - "Status='Open'" had to be LLM-generated | ✅ Fixed |
| P22 | Map transform output reference missing key - `{{step5.data}}` should be `{{step5.data.rows}}` for single-output transforms | ✅ Fixed |
| P23 | Handlebars block helper paths not pre-resolved - `{{#each step7.data.open_items}}` couldn't find `step7` in Handlebars context | ✅ Fixed |
| P24 | Stale data in read-modify-read patterns - step7 referenced step3 data after step6 modified the resource | ✅ Fixed (Reviewer prompt) |
| P25 | Map transform to Google Sheets missing headers - rows appended without column headers when `add_headers: true` not set | 🔄 Pending |
| P26 | Gmail search returns empty body fields - `link_to_email`, `cta_text` cannot be extracted from emails with empty body | 🔄 Pending |

---

## Solution Architecture

### Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          GENERATION LAYER                                │
│  ┌──────────┐    ┌──────────┐    ┌──────────────┐                       │
│  │ Phase 4  │ →  │ Reviewer │ →  │ DSL Builder  │                       │
│  │  (LLM)   │    │  (LLM)   │    │              │                       │
│  └──────────┘    └──────────┘    └──────────────┘                       │
│       ↓               ↓                 ↓                                │
│   Proposes        Refines          Assembles                            │
│   structure       structure        DSL JSON                             │
└─────────────────────────────────────────────────────────────────────────┘
                                         ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                      NEW: COMPILER/VALIDATOR LAYER                       │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                      DSL Compiler/Validator                       │   │
│  │  • Validate all {{stepX.key}} refs exist in declared outputs     │   │
│  │  • Validate template fields match source schemas                  │   │
│  │  • Validate transform outputs match transform type contracts      │   │
│  │  • Auto-normalize paths (add .data where needed)                  │   │
│  │  • Output: blocking_errors[], warnings[], normalized_dsl          │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                                         ↓
┌─────────────────────────────────────────────────────────────────────────┐
│                          EXECUTION LAYER                                 │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                    Executor + Normalizer                          │   │
│  │  • Every step output normalized to contract shape                 │   │
│  │  • Map runtime keys to declared output keys                       │   │
│  │  • Validate LLM responses against JSON schema                     │   │
│  │  • Preserve raw output in _raw for debugging                      │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │                    Plugin Schema Registry                         │   │
│  │  • Source of truth for plugin action output schemas               │   │
│  │  • Used by Compiler for validation                                │   │
│  │  • Used by Executor for normalization                             │   │
│  └──────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

### Solution Components

#### 1. Executor Output Normalization (Stability)

**Purpose:** Make the executor the source of truth by normalizing all outputs to declared shapes.

**Rules:**
- Every step writes to `stepOutputs[stepId] = { data: <normalized> }`
- Runtime output keys are mapped to declared output keys
- Primitives are wrapped in declared key objects
- Extra keys preserved in `_raw` for debugging

#### 2. DSL Compiler/Validator (Correctness)

**Purpose:** Catch schema drift before runtime.

**Checks:**
- Every `{{stepX.key}}` reference exists in stepX's declared outputs
- Template variables match source step's output schema fields
- Transform outputs are consistent with transform type
- `from_step` refs point to valid output keys
- Conditional branches have compatible output shapes

**Output:**
- `blocking_errors[]` - Must fix before execution
- `warnings[]` - Safe but suspicious
- `normalized_dsl` - Auto-fixed paths and aliases

#### 3. Plugin Schema Propagation (Scale)

**Purpose:** Use real schemas instead of LLM-invented field names.

**Flow:**
- Plugin schemas define authoritative output shapes
- Phase 4/Reviewer reference only fields from schemas
- Compiler validates template fields against schemas
- Executor validates runtime output against schemas

#### 4. LLM Output Enforcement (Predictability)

**Purpose:** Make ai_processing/extract steps schema-respecting.

**Rules:**
- LLM steps that feed downstream logic require JSON schema
- Validation on response, retry on failure
- Declared output shape becomes enforced contract

---

## Contract Specifications

### StepOutput Shape Contract

Every step execution MUST produce output in this shape:

```typescript
interface StepOutput {
  data: {
    [declaredOutputKey: string]: any;  // Normalized to match DSL outputs
  };
  _raw?: any;      // Original runtime output (for debugging)
  _meta?: {
    normalizedKeys?: Record<string, string>;  // runtime key → declared key mapping
    validationWarnings?: string[];
  };
}
```

**Example:**

```typescript
// DSL declares:
outputs: { action_items: "object[]", next_step: "step5" }

// Runtime returns:
{ items: [{...}, {...}] }

// Executor normalizes to:
{
  data: {
    action_items: [{...}, {...}]
  },
  _raw: { items: [{...}, {...}] },
  _meta: { normalizedKeys: { "items": "action_items" } }
}
```

### Transform Type Output Contracts

Each transform type MUST produce a specific output shape:

| Transform Type | Runtime Output | Normalized Shape |
|----------------|----------------|------------------|
| `filter` | `T[]` | `{ [declaredKey]: T[] }` |
| `map` | `U[]` | `{ [declaredKey]: U[] }` |
| `sort` | `T[]` | `{ [declaredKey]: T[] }` |
| `group_by` | `Record<string, T[]>` | `{ [declaredKey]: Record<string, T[]> }` |
| `aggregate` | `AggResult` | `{ [declaredKey]: AggResult }` |
| `format` | `string` | `{ [declaredKey]: string }` |
| `pick_fields` | `Partial<T>[]` | `{ [declaredKey]: Partial<T>[] }` |
| `*_with_llm` | Varies (JSON) | `{ [declaredKey]: ParsedJSON }` |

### Variable Reference Contract

All variable references MUST follow this format:

```
{{stepId.outputKey}}           → stepOutputs[stepId].data[outputKey]
{{stepId.outputKey.field}}     → stepOutputs[stepId].data[outputKey].field
{{stepId.outputKey.nested.path}} → deep access

Special prefixes:
{{input.fieldName}}            → workflow input
{{env.VARIABLE}}               → environment variable
{{item.field}}                 → current loop iteration item (inside for_each only)
```

**Compiler Validation:**
- `stepId` must exist in workflow
- `outputKey` must be declared in step's outputs
- For operation steps: `field` path must exist in plugin action's output_schema

### Template Field Validation Contract

For `format` transforms with templates:

```typescript
// Template:
"<td>{{from.name}}</td><td>{{date}}</td>"

// Compiler MUST verify:
// 1. Input step's output_schema contains "from.name" and "date"
// 2. Field paths are valid according to schema

// INVALID (would be caught):
"<td>{{sender}}</td>"  // "sender" not in source schema
```

### Operation Step Input Contract

For `from_step` inputs:

```typescript
// DSL:
inputs: {
  data: { source: "from_step", ref: "step3.filtered_emails" }
}

// Compiler MUST verify:
// 1. step3 exists
// 2. step3.outputs contains "filtered_emails"
// 3. Type compatibility (if both sides declare types)
```

---

## Implementation Phases

### Phase 1: Stability (Executor Normalization)

**Goal:** Formalize the runtime normalization we've been doing ad-hoc.

**Tasks:**
- [ ] Define `StepOutput` interface with `data`, `_raw`, `_meta`
- [ ] Create output normalizer function per transform type
- [ ] Create key mapping logic (runtime key → declared key)
- [ ] Update `StepExecutor` to use normalizer for all outputs
- [ ] Update `ExecutionContext.resolveVariable()` to use normalized paths
- [ ] Add logging for normalization actions

**Files to Modify:**
- `lib/pilot/types.ts` - Add StepOutput interface
- `lib/pilot/StepExecutor.ts` - Add normalization layer
- `lib/pilot/ExecutionContext.ts` - Update variable resolution
- `lib/pilot/output-normalizer.ts` - NEW: Normalization logic

### Phase 2: Correctness (DSL Compiler/Validator)

**Goal:** Catch errors before execution.

**Tasks:**
- [ ] Create DSL compiler module
- [ ] Implement reference validation (all {{stepX.key}} refs)
- [ ] Implement output key existence validation
- [ ] Implement from_step ref validation
- [ ] Implement template field validation against schemas
- [ ] Add auto-normalization for common issues
- [ ] Integrate into agent execution flow (validate before run)

**Files to Modify:**
- `lib/pilot/dsl-compiler.ts` - NEW: Compiler/validator
- `lib/pilot/WorkflowPilot.ts` - Integrate compiler before execution
- `app/api/run-agent/route.ts` - Return compiler errors to client

### Phase 3: Scale (Schema Propagation)

**Goal:** Use authoritative schemas throughout the pipeline.

**Tasks:**
- [ ] Ensure all plugins have complete output_schema definitions
- [ ] Create schema registry accessible to compiler and executor
- [ ] Update Phase 4 prompt to require schema field names in templates
- [ ] Update Reviewer prompt to validate field names against schemas
- [ ] Add schema-based field path validation in compiler

**Files to Modify:**
- `lib/plugins/schemas/*.json` - Complete output schemas
- `lib/pilot/schema-registry.ts` - NEW: Schema access layer
- `app/api/prompt-templates/Workflow-Agent-Creation-Prompt-v*.txt` - Prompt updates
- `lib/pilot/dsl-compiler.ts` - Schema-aware validation

### Phase 4: Predictability (LLM Output Enforcement) ✅

**Goal:** Make ai_processing steps schema-respecting.

**Tasks:**
- [x] Define JSON schemas for common LLM output patterns (`lib/pilot/llm-output-validator.ts`)
- [x] Add schema parameter to ai_processing transform definition (`convertDslOutputsToSchema()`)
- [x] Implement response validation in executor (both orchestration and fallback paths)
- [x] Add retry logic for validation failures
- [x] Update Phase 4 prompt to require output schemas for LLM transforms

**Implementation Details:**

1. **DSL Outputs to Schema Conversion** (`lib/pilot/llm-output-validator.ts`):
   - `convertDslOutputsToSchema()` converts DSL `outputs` declarations to `LLMOutputSchema`
   - Filters routing keys, handles nested properties and array items
   - Returns schema for LLM prompt injection

2. **StepExecutor Integration** (`lib/pilot/StepExecutor.ts`):
   - Orchestration path: Converts `outputs` to schema, passes as `outputSchema` to orchestrator
   - Fallback path: Converts `outputs` to schema, injects into LLM prompt via `buildSchemaPromptInstructions()`

3. **Orchestration Handler Integration** (`lib/orchestration/handlers/BaseHandler.ts`):
   - `formatPrompt()` checks for `context.input.outputSchema`
   - Injects schema instructions into system prompt for ALL handlers
   - Ensures LLM returns full objects (not just IDs) when schema specifies array items

4. **Additional Fixes**:
   - `jsonrepair` added to OutputNormalizer for malformed JSON recovery
   - JSON escaping instructions added to Phase 4 and Technical Reviewer prompts
   - Handlebars block context detection in DSL compiler (skips validation for `{{#each}}` context variables)

**Files Modified:**
- `lib/pilot/StepExecutor.ts` - LLM response validation + schema injection
- `lib/pilot/llm-output-validator.ts` - Schema conversion and validation
- `lib/pilot/output-normalizer.ts` - jsonrepair integration
- `lib/orchestration/handlers/BaseHandler.ts` - Schema injection for orchestrated steps
- `app/api/prompt-templates/*.txt` - JSON escaping instructions

### Phase 5: Schema Contract Enforcement (Safe Execution)

**Goal:** Guarantee clear, unambiguous, and enforceable output structure for every step. No step output may be consumed unless its structure is explicitly defined and machine-validated.

**Core Principle:**
> **No step output may be consumed unless its structure is explicitly defined and machine-validated.**

Free-form outputs such as `"object"`, `"object[]"`, or `"any"` are no longer acceptable unless they resolve to a concrete schema.

#### Phase 5A: Schema Registry Extension

**Tasks:**
- [ ] Add `$ref` resolution to schema registry
  - `resolveSchemaRef("plugins.google-mail.search_emails.output")`
  - `resolveSchemaRef("ai.extract_emails_summary.v1.output")`
  - `resolveSchemaRef("transforms.split.by_field.output")`
- [ ] Add AI processing schema registration
  - Define common AI extraction schemas (e.g., `ai.extract_emails_summary.v1`)
  - Support schema versioning for backward compatibility
- [ ] Add transform output schema definitions
  - Typed output contracts for each transform type
  - Support for inferring output type from input type

**Schema Registry Categories:**
```typescript
// 1. Plugin Action Outputs
"plugins.google-mail.search_emails.output"

// 2. AI Processing Outputs
"ai.extract_emails_summary.v1.output"
"ai.extract_emails_summary.v1.row"

// 3. Deterministic Transform Outputs
"transforms.split.by_classification.output"
"transforms.deduplicate.output"
```

**Files to Modify:**
- `lib/pilot/schema-registry.ts` - Add `$ref` resolution, AI schemas, transform schemas

#### Phase 5B-1: Phase 4 Prompt Update (Schema Declaration)

**Rationale:** Phase 4 already knows the fields it wants to extract (from `description` or `inputs.instructions`), but declares outputs as vague `"object[]"`. By requiring explicit field declarations at Phase 4, we create a clean data flow where the Reviewer validates/corrects, and DSL Builder converts to `$ref`.

**Tasks:**
- [ ] Update `Workflow-Agent-Creation-Prompt-v15-chatgpt.txt` (new version)
- [ ] Add OUTPUT SCHEMA DECLARATION section with requirements:

```
### OUTPUT SCHEMA DECLARATION (REQUIRED)

Every step that outputs structured data MUST declare the explicit structure:

1. For operation steps:
   - outputs MUST match the action's output_schema field names from schema_services
   - Use the exact field names from the action's output_schema

2. For ai_processing/extract_with_llm steps that output structured data:
   - MUST include `output_schema` with explicit field definitions
   - MUST NOT declare outputs as vague "object[]" or "object"
   - The output_schema MUST list all fields that will be referenced by downstream steps
   - Example:
     "outputs": { "rows": "EmailSummary[]" },
     "output_schema": {
       "type": "array",
       "items": {
         "type": "object",
         "required": ["classification", "sender", "subject"],
         "properties": {
           "classification": { "type": "string", "enum": ["action_required", "fyi"] },
           "sender": { "type": "string" },
           "subject": { "type": "string" },
           "priority": { "type": "string", "enum": ["High", "Medium", "Low"] }
         }
       }
     }

3. For split transforms:
   - MUST declare explicit bucket names in outputs
   - WRONG: "outputs": { "buckets": "object" }
   - CORRECT: "outputs": { "action_required": "EmailSummary[]", "fyi": "EmailSummary[]" }

4. For format transforms:
   - If the step outputs a structured object (e.g., email content), declare the shape
   - Example: "outputs": { "content": { "subject": "string", "html_body": "string" } }

REJECTED output declarations:
- "object" without properties
- "object[]" without item schema
- "any"
```

**Files to Modify:**
- `app/api/prompt-templates/Workflow-Agent-Creation-Prompt-v15-chatgpt.txt` - NEW

#### Phase 5B-2: Reviewer Prompt v4 (Schema Enforcement)

**Tasks:**
- [ ] Create `Workflow-Agent-Technical-Reviewer-SystemPrompt-v4.txt`
- [ ] Add OUTPUT SCHEMA ENFORCEMENT section:
  - Reject `"object"`, `"object[]"`, `"any"` outputs
  - Require `$ref` or inline JSON Schema for all outputs
  - For `ai_processing` steps: MUST include full `output_schema` with required fields
  - For `split` transforms: MUST declare explicit bucket names, not generic `buckets`
  - Add blocking_gap if output_schema cannot be inferred
- [ ] Update `v5-generator.ts` to use v4 prompt

**New Reviewer Rules:**
```
**OUTPUT SCHEMA ENFORCEMENT (CRITICAL)**

REJECTED output types (MUST be replaced):
- "object"
- "object[]"
- "any"

For operation steps:
- Use "$ref" to the action's output schema from schema_services

For ai_processing steps:
- MUST include full output_schema with required fields, types, and enums
- If output_schema is missing and outputs are consumed downstream, add blocking_gap

For split transforms:
- MUST declare explicit bucket names as outputs
- WRONG: "outputs": { "buckets": "object" }
- CORRECT: "outputs": { "action_required": "object[]", "fyi": "object[]" }
```

**Files to Modify:**
- `app/api/prompt-templates/Workflow-Agent-Technical-Reviewer-SystemPrompt-v4.txt` - NEW
- `lib/agentkit/v4/v5-generator.ts` - Use v4 prompt

#### Phase 5C: Reviewer Schema Types Update

**Tasks:**
- [ ] Update `technical-reviewer-schema.ts` to support `$ref` and inline schemas
- [ ] Add `OutputContract` type:
  ```typescript
  type OutputContract =
    | string                           // Simple type (for backward compat, will warn)
    | { "$ref": string }               // Schema registry reference
    | { "schema": JSONSchema }         // Inline JSON Schema
  ```
- [ ] Update validation to handle new output format

**Files to Modify:**
- `lib/validation/technical-reviewer-schema.ts` - Add OutputContract type

#### Phase 5D: DSL Compiler Enhancement

**Tasks:**
- [ ] Add `validateSchemaRef()` - verify `$ref` exists in registry
- [ ] Fix `validateTemplateReferences()` - validate `parts[2]` when `parts[1] === 'data'`
  ```typescript
  // Currently skips validation for {{step4.data.action_required}}
  // Should validate "action_required" exists in step4's outputs
  ```
- [ ] Add `validateIterationTarget()` - verify `#each` targets array-typed outputs
- [ ] Add warning for vague output types (`"object"`, `"object[]"`)

**Files to Modify:**
- `lib/pilot/dsl-compiler.ts` - Enhanced schema validation

#### Phase 5E: DSL Builder Updates

**Tasks:**
- [ ] Generate `$ref` in outputs instead of inline types
- [ ] Generate explicit bucket names for split outputs using `inferSplitBucketKeys()`
- [ ] Pass through `output_schema` from reviewer to DSL steps

**Files to Modify:**
- `lib/agentkit/v4/core/phase4-dsl-builder.ts` - Use $ref, explicit split outputs

#### Phase 5F: Runtime Enforcement

**Tasks:**
- [ ] **Fail-fast on ai_processing validation failure** (P13)
  ```typescript
  // Change from (StepExecutor.ts line ~1115):
  logger.error({...}, 'using raw response');
  // To:
  throw new ExecutionError('Schema validation failed', 'SCHEMA_VALIDATION_FAILED', step.id);
  ```
- [ ] **Add sort_field and keep to deduplicate** (P14)
  ```typescript
  config: {
    field: "thread_id",
    sort_field: "date",      // NEW
    keep: "most_recent"      // NEW: "most_recent" | "first" | "last"
  }
  ```
- [ ] **Add template_only flag for format steps** (P16)
  ```typescript
  interface TransformStep {
    template_only?: boolean;  // Skip input validation for template-only steps
  }
  ```

**Files to Modify:**
- `lib/pilot/StepExecutor.ts` - Fail-fast, deduplicate enhancements
- `lib/pilot/types.ts` - Add template_only to TransformStep
- `lib/pilot/WorkflowParser.ts` - Skip input validation for template_only

#### Phase 5G: Code Cleanup

**Tasks:**
- [ ] Remove redundant `convertDslOutputsToSchema()` calls (handled via `$ref`)
- [ ] Change template input extraction warning from `'fallback_used'` to `'template_input_inferred'`
- [ ] Consolidate duplicate schema validation logic
- [ ] Remove dead code paths for legacy output formats

**Files to Modify:**
- `lib/pilot/llm-output-validator.ts` - Cleanup
- `lib/agentkit/v4/core/phase4-dsl-builder.ts` - Cleanup

---

## File Change Map

| File | Phase | Changes |
|------|-------|---------|
| `lib/pilot/types.ts` | 1, 5F | Add StepOutput, NormalizationMeta interfaces; Add template_only flag |
| `lib/pilot/output-normalizer.ts` | 1 | NEW: Transform output normalization |
| `lib/pilot/StepExecutor.ts` | 1, 4, 5F, P18-P23 | Use normalizer, add LLM validation; Fail-fast, deduplicate enhancements; Handlebars JSON templates, deterministic map with columns, block helper path pre-resolution |
| `lib/pilot/ExecutionContext.ts` | 1 | Update resolveVariable for normalized paths |
| `lib/pilot/dsl-compiler.ts` | 2, 3, 5D | DSL validation and auto-fix; Schema ref validation |
| `lib/pilot/WorkflowPilot.ts` | 2 | Integrate compiler |
| `lib/pilot/WorkflowParser.ts` | 5F | Skip input validation for template_only steps |
| `lib/pilot/schema-registry.ts` | 3, 5A | Plugin schema access; Add $ref resolution, AI schemas |
| `lib/pilot/llm-output-validator.ts` | 4, 5G | LLM response schemas; Cleanup |
| `lib/validation/technical-reviewer-schema.ts` | 5C | Add OutputContract type with $ref support |
| `lib/agentkit/v4/core/phase4-dsl-builder.ts` | 5E, 5G, P19-P22 | Use $ref, explicit split outputs; Cleanup; Recognize columns as valid config, extract static values, auto-append single output key |
| `lib/agentkit/v4/v5-generator.ts` | 5B | Use reviewer prompt v4 |
| `app/api/run-agent/route.ts` | 2 | Return compiler errors |
| `app/api/prompt-templates/...-v4.txt` | 5B | NEW: Reviewer prompt with schema enforcement |
| Prompt templates | 3, 4 | Schema enforcement rules |

---

## Progress Tracker

### Overall Progress

| Phase | Status | Problems Addressed |
|-------|--------|-------------------|
| Phase 1: Stability | ✅ Complete | P1, P2, P5, P6 |
| Phase 2: Correctness | ✅ Complete | P4, P7, P8 |
| Phase 3: Scale | ✅ Complete | P3, P9, P12 |
| Phase 4: Predictability | ✅ Complete | P9, P12 |
| Control Flow Fixes | ✅ Complete | P10, P11 |
| Phase 5: Schema Contract Enforcement | 🔄 ~90% Complete | P14 ✅, P15 ✅, P17 ✅; Remaining: P13, P16 |

### Detailed Task Progress

#### Phase 1 Tasks
- [x] Define StepOutput interface (`lib/pilot/types.ts`)
  - Added `NormalizationMeta` interface
  - Added `DeclaredOutput` interface
  - Added `TransformType` type
  - Enhanced `StepOutput` with `_raw` and `_meta` fields
- [x] Create output normalizer (`lib/pilot/output-normalizer.ts`)
  - Transform type detection
  - Key mapping logic (runtime → declared)
  - String output handling (wrapping, JSON parsing)
  - Array output handling
  - Object output handling with intelligent key matching
- [x] Update StepExecutor (`lib/pilot/StepExecutor.ts`)
  - Integrated normalizer after switch block
  - Removed ad-hoc transform fixes
  - Added normalization logging
- [x] ExecutionContext verified compatible
  - Existing `data` fallback works with normalized structure
  - No changes needed

#### Phase 2 Tasks
- [x] Create DSL compiler module (`lib/pilot/dsl-compiler.ts`)
  - `DslCompiler` class with 3-phase compilation
  - `CompilationError`, `CompilationWarning`, `AutoFix` types
  - `compileDsl()`, `isDslValid()`, `getErrorSummary()` exports
- [x] Reference validation
  - All `{{stepX.key}}` refs validated against step index
  - Template variable extraction and validation
  - Condition string reference validation
- [x] Output key validation
  - Declared output keys extracted (excluding routing keys)
  - Output registry built during compilation
  - Missing output declaration warnings
- [x] from_step validation
  - Target step existence check
  - Output key existence check
  - Detailed error messages with available keys
- [x] Routing validation
  - next_step targets validated
  - Branch outputs validated
  - is_last_step consistency check
- [x] Integration into WorkflowPilot
  - Compilation runs before parsing
  - Validation errors throw `ValidationError`
  - Audit event `PILOT_VALIDATION_FAILED` logged
  - Warnings logged to console

#### Phase 3 Tasks
- [x] Create schema registry (`lib/pilot/schema-registry.ts`)
  - Singleton `SchemaRegistry` class
  - Loads plugin definitions from `lib/plugins/definitions/*-v2.json`
  - `getOutputSchema()` for plugin action schema lookup
  - `validateFieldPath()` for field validation
  - `getAllFieldPaths()` for available fields
  - Plugin name normalization (gmail → google-mail, etc.)
- [x] Schema-aware compiler (`lib/pilot/dsl-compiler.ts`)
  - Added `SCHEMA_FIELD_NOT_FOUND` error type
  - Added `SCHEMA_FIELD_MISMATCH` warning type
  - `pluginActionRegistry` tracks plugin/action per step
  - `validateSchemaField()` validates field paths against schemas
  - `validateSchemaReferencesInTemplate()` for template validation
  - `validateSchemaInFromStepRef()` for from_step validation
  - Integrated into condition and control structure validation
- [x] Integrate schema registry initialization
  - `initializeSchemaRegistry()` called in WorkflowPilot before compilation
  - Schema registry loaded once at execution startup
- [x] Complete plugin schemas (verify all actions have output_schema)
  - Audited all 11 plugins: 67/67 actions have output_schema defined
  - All plugins have complete schema coverage
- [x] Update Phase 4 prompt for schema field awareness
  - Added "Output schema field naming" section to Phase 4 prompt
  - Instructs LLM to use exact field names from output_schema
  - Provides examples of correct vs incorrect field references
- [x] Update Reviewer prompt for schema validation
  - Added "OUTPUT SCHEMA FIELD VALIDATION" section
  - Reviewer validates template field names against source action's output_schema
  - Instructs reviewer to fix incorrect field names and add reviewer_note

#### Phase 4 Tasks
- [x] Define LLM output schemas (`lib/pilot/llm-output-validator.ts`)
  - Created `LLMOutputSchema` and `JsonSchemaProperty` types
  - Pre-defined schema patterns: classification, extraction, summary, list, decision, key_value, boolean_result, scored_items
  - `getSchemaPattern()` for common patterns
  - `createExtractionSchema()` and `createClassificationSchema()` for custom schemas
- [x] Add schema to ai_processing
  - Steps can include `output_schema` field (object or pattern string)
  - Supports both direct schema objects and pattern references
  - Example: `"output_schema": "extraction"` or `"output_schema": { "type": "object", ... }`
- [x] Response validation
  - `validateLLMOutput()` validates response against schema
  - JSON parsing with fallback for markdown code blocks
  - Detailed error messages with path information
  - Validates types, required fields, enums, min/max constraints
- [x] Retry logic
  - Up to 2 retries when validation fails
  - Retry prompt includes validation errors and fix instructions
  - Falls back to raw response after all retries exhausted
  - Logging at each retry attempt
- [x] Prompt updates
  - `buildSchemaPromptInstructions()` adds schema requirements to prompt
  - Includes JSON schema definition and example output
  - Critical rules for JSON-only response
  - Phase 4 prompt: Added "LLM-assisted output schema" section with examples
  - Reviewer prompt: Added "LLM Output Schema Validation" guidance

#### Control Flow Fixes (P10, P11)
- [x] P10: Conditional Branch Data Flow (`lastBranchOutput` validation)
  - Added `conditionalStepIds` tracking in DSL compiler
  - Control steps with `control.type === 'if'` registered during index build
  - `validateFromStepRef()` recognizes `lastBranchOutput` as valid for conditional steps
  - `validateTemplateReferences()` skips validation for `{{stepX.lastBranchOutput.*}}`
  - Post-conditional steps can safely reference branch output data
- [x] P11: Loop Item Reference Ambiguity (`item_name` recognition)
  - Added `loopItemVariables` tracking in DSL compiler
  - Loop item variable scope management (add on loop entry, remove on exit)
  - `validateFromStepRef()` skips validation for loop item variable refs
  - `validateTemplateReferences()` skips loop item variable prefixes
  - `validateSchemaReferencesInTemplate()` and `validateSchemaInFromStepRef()` skip loop items
  - Custom item names (e.g., `email_payload.recipients`) correctly recognized

#### Phase 5 Tasks (Schema Contract Enforcement)

**Phase 5A: Schema Registry Extension** ✅
- [x] Add `$ref` resolution method to schema registry (`resolveSchemaRef()`)
- [x] Define AI processing schema format (e.g., `ai.extract_emails_summary.v1`)
- [x] Define transform output schema format (built-in transform schemas registered)
- [x] Add `registerSchema()` and `getSchema()` methods

**Phase 5B-1: Phase 4 Prompt Update (Schema Declaration)** ✅
- [x] Create `Workflow-Agent-Creation-Prompt-v15-chatgpt.txt`
- [x] Add OUTPUT SCHEMA DECLARATION section (lines 624-686)
- [x] Require explicit field declarations for ai_processing steps
- [x] Require explicit bucket names for split transforms
- [x] Reject vague `"object"`, `"object[]"` outputs

**Phase 5B-2: Reviewer Prompt v4 (Schema Enforcement)** ✅
- [x] Create `Workflow-Agent-Technical-Reviewer-SystemPrompt-v4.txt`
- [x] Add OUTPUT SCHEMA ENFORCEMENT section (lines 110-173)
- [x] Add rules to reject `"object"`, `"object[]"`, `"any"` outputs
- [x] Add requirement for explicit `output_schema` on ai_processing steps
- [x] Add requirement for explicit bucket names on split transforms
- [x] Add blocking_gap if output_schema cannot be inferred
- [x] Update `v5-generator.ts` to use v4 prompt (line 73)

**Phase 5C: Reviewer Schema Types** ✅
- [x] Add `OutputContract` type to `technical-reviewer-schema.ts`
- [x] Support `$ref` and inline `schema` formats (`OutputContractSchema`)
- [x] Update validation for new output format (`validateOutputContract()`, `validateAIOutputSchema()`)

**Phase 5D: DSL Compiler Enhancement** ✅
- [x] Add `validateSchemaRef()` for `$ref` validation (`validateOutputSchemaRefs()`)
- [x] Fix `validateTemplateReferences()` to validate `parts[2]` in `stepX.data.Y`
- [x] Add `validateIterationTarget()` for array-typed outputs
- [x] Add warning for vague output types

**Phase 5E: DSL Builder Updates** ✅
- [x] Generate `$ref` in outputs instead of inline types
- [x] Generate explicit bucket names for split using `inferSplitBucketKeys()`
- [x] Pass through `output_schema` from reviewer (lines 1338-1340 in phase4-dsl-builder.ts)

**Phase 5F: Runtime Enforcement** 🔄 Partial
- [ ] P13: Fail-fast on ai_processing validation failure (change logger.error to throw)
- [x] P14: Add `sort_field` and `keep` to deduplicate transform (StepExecutor.ts lines 2448-2519)
- [ ] P16: Add `template_only` flag for format steps
- [ ] Update WorkflowParser to skip input validation for `template_only`

**Phase 5G: Code Cleanup**
- [ ] Remove redundant `convertDslOutputsToSchema()` calls
- [ ] Change template input extraction warning type
- [ ] Consolidate duplicate schema validation logic
- [ ] Remove dead code paths

---

## Notes & Decisions

*(This section will be updated as we make implementation decisions)*

### Open Questions

1. Should the compiler auto-fix issues or only report them?
2. How do we handle backward compatibility with existing DSLs?
3. Should schema validation be strict or lenient?

### Decisions Made

**2025-01-10 - Phase 1 Implementation:**

1. **Normalization happens at executor level, not in transforms**
   - Centralizes all normalization in one place after step execution
   - Transforms remain simple and return their natural output format
   - Normalizer handles all key mapping and wrapping

2. **Preserve raw output for debugging**
   - `_raw` field stores original output when normalization occurs
   - `_meta` tracks exactly what transformations were applied
   - Helps debug issues without losing information

3. **ExecutionContext unchanged**
   - Existing `data` fallback in resolveVariable() works with normalized structure
   - No breaking changes to variable resolution
   - Maintains backward compatibility

4. **Transform type detection from step definition**
   - `getTransformType()` examines step `kind`, `type`, and `operation` fields
   - Supports both DSL format and legacy step formats
   - Maps ai_processing intents to LLM transform types

**2025-01-10 - Phase 2 Implementation:**

1. **Compilation runs before parsing**
   - DSL validated immediately after loading workflow steps
   - Errors block execution before any state is created
   - Provides early, clear error messages

2. **Three-phase compilation**
   - Phase 1: Build step index and output registry
   - Phase 2: Validate all steps (inputs, conditions, control structures)
   - Phase 3: Validate routing (next_step, branches, is_last_step)

3. **Errors vs Warnings distinction**
   - Errors block execution (missing steps, invalid refs)
   - Warnings allow execution but log concerns (unqualified refs, missing output declarations)

4. **Handlebars-aware validation**
   - Template validation skips Handlebars helpers (`#`, `/`, `else`, `@`, `this`)
   - Only validates runtime variable references

5. **Output registry for cross-validation**
   - Each step's declared outputs registered during compilation
   - Used to validate from_step refs and template variables

**2025-01-10 - Phase 3 Implementation:**

1. **Schema registry as singleton**
   - `SchemaRegistry` is a singleton loaded once per application
   - Plugin definitions loaded from `lib/plugins/definitions/*-v2.json`
   - Supports plugin name normalization (gmail → google-mail)

2. **Validation is graceful**
   - If schema registry not initialized, validation is skipped
   - If plugin has no output_schema, validation allows through
   - Only produces errors when schema exists and field is definitively wrong

3. **Schema field validation integrated everywhere**
   - Template references: `{{step1.emails[0].sender}}` validated
   - from_step refs: `step1.emails.sender` nested paths validated
   - Condition strings: schema refs in conditions validated
   - Control structures: `collection_ref` field paths validated

4. **Array access normalized for validation**
   - `emails[0].sender` → `emails[].sender` for path matching
   - `emails[*].sender` → `emails[].sender` for wildcards
   - Allows flexible array indexing while validating field names

5. **'data' wrapper handling**
   - `step1.data.emails` → `emails` for schema validation
   - Synthetic data wrapper stripped before schema lookup
   - Maintains compatibility with normalized output structure

6. **SchemaRegistry refactored to delegate to PluginManagerV2**
   - Removed duplicate JSON loading code
   - SchemaRegistry now gets plugin definitions from PluginManagerV2
   - Eliminates ~30 lines of duplicate code
   - Single source of truth for plugin data

7. **Removed plugin name normalization**
   - Normalization (gmail → google-mail) was defensive code that never fired
   - DSL uses canonical names from PluginManagerV2
   - Simplified SchemaRegistry by removing dead code

8. **Prompt updates for schema awareness**
   - Phase 4 prompt: Added "Output schema field naming" section
   - Reviewer prompt: Added "OUTPUT SCHEMA FIELD VALIDATION" section
   - Both now explicitly require using output_schema field names

**2025-01-10 - Phase 4 Implementation:**

1. **LLM output validator as dedicated module**
   - Created `lib/pilot/llm-output-validator.ts` for schema validation
   - Provides `validateLLMOutput()` for response validation
   - Provides `buildSchemaPromptInstructions()` for prompt enhancement
   - Pre-defined schema patterns for common use cases

2. **Schema can be pattern reference or full schema**
   - Simple: `"output_schema": "extraction"` uses pre-defined pattern
   - Custom: `"output_schema": { "type": "object", "properties": {...} }`
   - Patterns include: classification, extraction, summary, list, decision

3. **Retry on validation failure**
   - Maximum 2 retries when schema validation fails
   - Each retry includes error details in prompt
   - Falls back to raw response after all retries (graceful degradation)
   - Prevents infinite loops while giving LLM chance to correct

4. **JSON parsing handles LLM quirks**
   - Direct JSON parse attempted first
   - Falls back to extracting from markdown code blocks
   - Falls back to finding JSON object/array in text
   - Clear error message when all parsing fails

5. **Prompt enhancement is additive**
   - Original prompt preserved
   - Schema instructions appended
   - Example output generated from schema
   - Critical rules for JSON-only response

**2025-01-10 - Control Flow Fixes:**

1. **Conditional `lastBranchOutput` validation (P10)**
   - DSL compiler tracks conditional control steps (`control.type === 'if'`)
   - `lastBranchOutput` recognized as valid output key for conditional steps
   - Allows post-conditional steps to reference `{{stepX.lastBranchOutput.field}}`
   - Runtime already implements `lastBranchOutput` on conditional steps

2. **Loop item variable recognition (P11)**
   - DSL compiler tracks active loop item variables during nested step validation
   - Scope managed correctly (add on loop entry, remove on loop exit)
   - Supports custom `item_name` values (e.g., `email_payload`, `recipient`)
   - All validation methods skip loop item variable references
   - Works with both `{{item.field}}` (default) and `{{custom_name.field}}`

3. **Graceful scope handling**
   - Loop item variables only valid within loop body
   - Correctly handles nested loops (each has its own scope)
   - References outside loop correctly fail validation

**2026-01-12 - Phase 5 Design (Schema Contract Enforcement):**

1. **Schema Registry as single source of truth**
   - All schemas stored in Schema Registry with stable keys
   - Three categories: plugin outputs, AI processing outputs, transform outputs
   - `$ref` syntax for schema references: `"$ref": "plugins.google-mail.search_emails.output"`
   - Enables schema reuse, consistent validation, no duplication

2. **Explicit rejection of vague types**
   - `"object"`, `"object[]"`, `"any"` are no longer acceptable
   - Reviewer prompt v4 will reject these and require replacement
   - Either `$ref` to registry or inline JSON Schema required

3. **Three-layer enforcement**
   - **Reviewer (LLM)**: Must reject ambiguous outputs, add blocking issues
   - **Compiler**: Validates `$ref` exists, validates all references against schemas
   - **Runtime**: Validates output against schema, fail-fast on validation failure

4. **Token efficiency strategy**
   - LLM prompts reference schema keys, not full schemas
   - Full JSON Schemas live server-side only
   - LLM sees: field names, required keys, enums, examples

5. **Deduplicate transform enhancements**
   - Adding `sort_field` for ordering before deduplication
   - Adding `keep` option: `"most_recent"`, `"first"`, `"last"`
   - Ensures "keep most recent per thread" actually works correctly

6. **Split transform output alignment**
   - DSL must declare explicit bucket names, not generic `"buckets": "object"`
   - `inferSplitBucketKeys()` used to generate output declarations
   - Templates can reference `{{step4.data.action_required}}` with compiler validation

7. **Format step formal model**
   - `template_only: true` flag for steps that derive input from template references
   - Eliminates spurious "missing input" warnings
   - Cleaner static analysis

8. **Definition of "DSL is safe"**
   - All `ai_processing` outputs are schema-validated before continuing
   - All deterministic transforms have complete, validated configs
   - All references are validated against declared output contracts at compile time
   - Runtime execution only receives normalized, validated data envelopes

**2026-01-14 - Phase 5 Implementation (Schema Contract Enforcement):**

1. **Schema Registry `$ref` resolution complete**
   - `resolveSchemaRef()` supports three categories: `plugins.*`, `ai.*`, `transforms.*`
   - `registerSchema()` and `getSchema()` provide dynamic schema management
   - Built-in transform schemas (split, deduplicate, format) pre-registered

2. **v15 Creation Prompt with OUTPUT SCHEMA DECLARATION section**
   - Lines 624-686 explicitly reject vague types (`"object"`, `"object[]"`, `"any"`)
   - Requires explicit `output_schema` for ai_processing steps
   - Requires explicit bucket names for split transforms

3. **v4 Reviewer Prompt with OUTPUT SCHEMA ENFORCEMENT section**
   - Lines 110-173 enforce schema contract rules
   - Adds `blocking_gap` when `output_schema` is missing for ai_processing
   - Validates downstream field references against declared schemas

4. **OutputContract type with full Zod validation**
   - `OutputContractSchema` supports `$ref`, `type`, and inline `schema`
   - `validateOutputContract()` and `validateAIOutputSchema()` helpers
   - Type-safe schema enforcement at build time

5. **DSL Builder explicit bucket generation**
   - `inferSplitBucketKeys()` generates explicit bucket names from context
   - `output_schema` pass-through from reviewer to runtime
   - Structured output schema extraction for format transforms

6. **Deduplicate transform enhancements (P14)**
   - `sort_field` option for pre-sorting before deduplication
   - `keep` option: `"first"`, `"last"`, `"most_recent"`
   - Implemented in `StepExecutor.ts` lines 2448-2519

7. **Remaining work (P13, P16)**
   - P13: Change `logger.error` to `throw ExecutionError` for ai_processing validation failures
   - P16: Add `template_only` flag for format steps to skip input validation

---

## Completion Criteria

This document can be deleted when:

- [x] All problems in the inventory are marked ✅ Resolved (P1-P17) — **P1-P12, P14, P15, P17 complete; P13, P16 remaining**
- [x] All Phase tasks are complete (Phases 1-5) — **Phases 1-4 complete; Phase 5 ~90% complete**
- [x] Agent execution is stable without ad-hoc fixes
- [x] New plugins/transforms follow the contract automatically
- [x] No step output uses vague types (`"object"`, `"object[]"`) — **Enforced via prompts**
- [x] All `ai_processing` steps have validated `output_schema` — **Prompts require it; runtime validation in place**
- [x] Compiler catches all reference errors before runtime

**Note:** P1-P12, P14, P15, P17 resolved. Only P13 (fail-fast) and P16 (template_only) remain.

---

## 2026-01-15 Runtime Fixes

### Issue #5: Handlebars `{{#each}}` Blocks Not Rendering in JSON Templates

**Problem:** JSON templates with `json_escape: true` were not rendering Handlebars block helpers. The `expandTemplateWithJsonEscape` method only did simple regex replacement, causing `{{#each step7.data.open_items}}...{{/each}}` to pass through unrendered.

**Fix (StepExecutor.ts):**
1. Added Handlebars block detection to `expandTemplateWithJsonEscape()` (line 2058-2063)
2. Created `expandHandlebarsTemplateWithJsonEscape()` method (lines 2219-2307) that:
   - Pre-escapes all string values in data for JSON safety
   - Pre-resolves runtime variables with JSON escaping
   - Uses Handlebars library to compile and execute templates
   - Returns properly rendered output with all blocks expanded

### Issue #7: Deterministic Map Transform with Columns

**Problem:** The `map` transform with `columns` config was falling back to `ai_processing`, losing the column specification. The LLM then guessed which columns to output, resulting in incomplete rows.

**Root Cause:** `hasMappingConfig()` didn't recognize `columns` as valid config, and `transformMap()` expected `config.columns` but received `config.mapping.columns`.

**Fix (phase4-dsl-builder.ts + StepExecutor.ts):**

1. **DSL Builder - Recognize columns as valid config** (line 1090-1093):
   ```typescript
   // Columns input is valid for map transforms
   if (key === 'columns' && input?.source === 'constant' && Array.isArray(input.value)) {
     hasValidConfig = true;
   }
   ```

2. **DSL Builder - Extract static values from description** (lines 1285-1322):
   - Added `extractStaticValuesFromDescription()` method
   - Parses patterns like `add Status="Open"` from step description
   - Automatically adds to `config.mapping.static_values`

3. **StepExecutor - Enhanced transformMap** (lines 1639-1680):
   - Check both `config.columns` and `config.mapping.columns`
   - Added `static_values` support for columns with fixed values
   - Added `findFieldValue()` helper for field name normalization

4. **StepExecutor - Field name normalization** (lines 1713-1785):
   - `findFieldValue()` finds values using various name normalizations
   - `generateFieldNameVariations()` generates variations:
     - "received time" → `received_time`, `receivedTime`, `ReceivedTime`
     - "CTA text" → `cta_text`, `ctaText`, `CTA_text`
     - "link to the email" → `link_to_email`, `link_to_the_email`

**Result:** Map transforms with `columns` now execute deterministically without LLM, with automatic field name normalization and static value support.

### Issue P22: Map Transform Output Reference Missing Key

**Problem:** When a downstream step referenced a map transform's output as `{{step5.data}}`, it received `{ rows: [[...]] }` (an object) instead of `[[...]]` (the array). This caused Google Sheets `append_rows` to fail since it expects a 2D array.

**Root Cause:** `resolveInput()` returned `{{stepId}.data}}` for map transforms, but the output is wrapped under the declared key (e.g., `rows`).

**Fix (phase4-dsl-builder.ts - resolveInput()):**
```typescript
if (operation === 'map') {
  const outputKeys = stepInfo.outputKeys || [];
  if (outputKeys.length === 1) {
    return `{{${stepId}.data.${outputKeys[0]}}}`;  // Auto-append single output key
  }
  // ... fallback logic
}
```

**Result:** `{{step5.data}}` now correctly resolves to `{{step5.data.rows}}` for map transforms with a single declared output.

### Issue P23: Handlebars Block Helper Paths Not Pre-Resolved

**Problem:** Templates with `{{#each step7.data.open_items}}` rendered empty tables because the path inside block helpers wasn't pre-resolved. Handlebars couldn't find `step7` in its context (which only contained the format step's input data).

**Root Cause:** The pre-resolution regex `\{\{([^#/@}][^}]*)\}\}` excluded patterns starting with `#`, so block helper paths like `step7.data.open_items` in `{{#each step7.data.open_items}}` were never resolved.

**Fix (StepExecutor.ts - expandHandlebarsTemplate & expandHandlebarsTemplateWithJsonEscape):**
```typescript
// Pre-resolve paths inside block helpers BEFORE the simple variable regex
let preResolvedTemplate = template.replace(
  /\{\{#(each|if|unless|with)\s+(step[^}]+)\}\}/g,
  (match, helper, path) => {
    const resolved = context.resolveVariable(`{{${path}}}`);
    const safeKey = `__resolved_${path.replace(/\./g, '_')}`;
    handlebarsContext[safeKey] = resolved;  // or jsonEscapeData(resolved) for JSON templates
    return `{{#${helper} ${safeKey}}}`;
  }
);
```

**Result:** `{{#each step7.data.open_items}}` is rewritten to `{{#each __resolved_step7_data_open_items}}` with the data pre-resolved into the Handlebars context.

### Issue P24: Stale Data in Read-Modify-Read Patterns

**Problem:** When a workflow reads from a resource (step3), modifies it (step6), and then a later step (step7) references the original read, it uses stale data. Example: step7 parsed `step3.data.values` after step6 appended rows, missing the newly added rows.

**Fix (Technical Reviewer Prompt v4 - DATA FRESHNESS VALIDATION):**

Added a new validation rule that:
1. Detects read-modify-read patterns across any plugin (sheets, docs, databases, etc.)
2. Automatically inserts a re-read step after modifications
3. Updates downstream references to use fresh data

**Generic operation categories:**
- READ: `read_*`, `get_*`, `fetch_*`, `query_*`, `search_*`, `list_*`
- WRITE: `append_*`, `update_*`, `write_*`, `insert_*`, `delete_*`, `create_*`

**Result:** Reviewer now inserts `step6b` (re-read) after `step6` (append) and rewires `step7` to reference `step6b.data.values` instead of stale `step3.data.values`.
