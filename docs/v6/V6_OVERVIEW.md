# V6 Agent Generation System - Overview

> **Start here** - This document provides a high-level introduction to the V6 system.
> **Last aligned to code**: 2026-02-22

## Documentation Guide

This documentation set covers the V6 Agent Generation System. Read in order:

| # | Document | Description |
|---|----------|-------------|
| 1 | **V6_OVERVIEW.md** (this file) | High-level introduction, problem statement, quick start |
| 2 | [**V6_ARCHITECTURE.md**](./V6_ARCHITECTURE.md) | Deep technical dive into each phase, data flow, error handling |
| 3 | [**V6_API_REFERENCE.md**](./V6_API_REFERENCE.md) | Complete API documentation with request/response schemas |
| 4 | [**V6_DEVELOPER_GUIDE.md**](./V6_DEVELOPER_GUIDE.md) | Integration, extension, debugging, testing, best practices |
| 5 | [**V6_TEST_DECLARATIVE.md**](./V6_TEST_DECLARATIVE.md) | Test page UI guide (`/test-v6-declarative.html`) |
| 6 | [**V6_EXECUTION_GUIDE.md**](./V6_EXECUTION_GUIDE.md) | Runtime execution engine internals |

### Quick Links - Key Source Files

| File | Purpose |
|------|---------|
| `app/api/v6/generate-ir-semantic/route.ts` | Main orchestration API (two modes) |
| `lib/agentkit/v6/pipeline/V6PipelineOrchestrator.ts` | Pipeline orchestrator (P0→P3→P4→P5) |
| `lib/agentkit/v6/requirements/HardRequirementsExtractor.ts` | Phase 0: Requirements extraction |
| `lib/agentkit/v6/semantic-plan/IRFormalizer.ts` | Phase 3: IR formalization |
| `lib/agentkit/v6/compiler/ExecutionGraphCompiler.ts` | Phase 4: Deterministic compilation |
| `lib/agentkit/v6/requirements/ValidationGates.ts` | Gates 1–5 validation |
| `lib/agentkit/v6/requirements/AutoRecoveryHandler.ts` | Auto-recovery on gate failures |
| `lib/agentkit/v6/config/AgentGenerationConfigService.ts` | Admin model config per phase |
| `lib/pilot/WorkflowPilot.ts` | Runtime execution engine |
| `lib/pilot/StepExecutor.ts` | Step-by-step execution |
| `lib/pilot/ConditionalEvaluator.ts` | Conditional branch evaluation |
| `lib/pilot/ExecutionContext.ts` | Variable resolution and state |

---

## What is V6?

The V6 Agent Generation System is a **compiler-based pipeline** for converting natural language prompts into executable AI automation workflows. It follows the principle that **workflow creation is compilation, not generation** — every transformation must be lossless, traceable, constraint-preserving, and rejectable.

The system has two sides:
1. **Compilation** — Converting an Enhanced Prompt into a PILOT workflow (Phases 0–5)
2. **Execution** — Running the compiled PILOT workflow against real plugins (runtime engine)

## The Problem V6 Solves

Previous agent generation approaches suffered from:
- **Field name guessing**: LLMs were forced to guess exact field names (e.g., "email" vs "email_address" vs "emailAddr")
- **Non-deterministic output**: Same prompt could produce different, potentially invalid workflows
- **No constraint tracking**: User requirements like "only send email when amount > 50" could be silently dropped
- **Cascading errors**: One wrong assumption led to multiple downstream failures

## The V6 Solution

V6 introduces a **6-phase pipeline with 5 validation gates**:

1. **Phase 0 — Requirements Extraction** (LLM): Extract machine-checkable constraints from the prompt
2. **Phase 1 & 2 — SKIPPED**: Semantic planning and grounding are block-commented (Enhanced Prompt has all needed info)
3. **Phase 3 — IR Formalization** (LLM): Map Enhanced Prompt to a `DeclarativeLogicalIRv4` execution graph
4. **Phase 4 — Compilation** (deterministic): Compile the graph to PILOT DSL workflow steps
5. **Phase 5 — PILOT Translation** (deterministic): Normalize to flat PILOT format, validate intent satisfaction

Each requirement extracted in Phase 0 is tracked through the pipeline with a status lifecycle: `pending → compiled → enforced`. Gate 5 rejects workflows where any requirement is not `enforced`.

## Current Pipeline Architecture

```
Enhanced Prompt
    │
    ▼
Phase 0: HardRequirementsExtractor.extract()      ← LLM (gpt-4o-mini, admin-configurable)
    │   outputs: HardRequirements + RequirementMap
    │   Gate 0: structural validation
    ▼
[Phase 1 & 2 SKIPPED — block-commented]           ← saves ~3500 tokens, 15–30s
    │   dummy gate results injected
    ▼
Phase 3: IRFormalizer.formalize()                  ← LLM (claude-opus-4-6, admin-configurable)
    │   receives Enhanced Prompt directly (not semantic plan)
    │   Gate 3: validateIR() + PluginResolver auto-fix + AutoRecoveryHandler
    ▼
Phase 4: ExecutionGraphCompiler.compile()          ← deterministic (no LLM)
    │   topological sort → node-by-node compilation
    │   Gate 4: validateCompilation()
    ▼
Phase 5: translateToPilotFormat()                  ← deterministic (no LLM)
    │   DSL step mapping → flat PILOT array
    │   Gate 5: validateFinal() (intent satisfaction)
    ▼
Production PILOT Workflow (WorkflowStep[])
    │
    ▼
Runtime: WorkflowPilot → StepExecutor              ← executes against real plugins
    │   builds execution plan (dependency levels)
    │   resolves {{variable}} references at runtime
    │   evaluates conditionals, loops, parallel groups
    ▼
Execution Results
```

## Key Concepts

### IR v4.0 Execution Graph

Phase 3 produces a `DeclarativeLogicalIRv4` with an **execution graph** — a directed acyclic graph (DAG) of typed nodes:

| Node Type | Description |
|-----------|-------------|
| `operation` | Plugin call (fetch/deliver), data transform, AI operation, file operation |
| `choice` | Conditional branching with rules and default path |
| `loop` | Iteration over arrays with body sub-graph |
| `parallel` | Concurrent branches with wait strategy |
| `end` | Graph termination marker |

### PILOT Workflow Steps

Phase 5 produces a flat array of `WorkflowStep[]` — the production format executed by the runtime engine:

| Step Type | Description |
|-----------|-------------|
| `action` | Plugin API call (e.g., `google-mail.search_emails`) |
| `transform` | Data transformation (filter, map, sort, group_by, etc.) |
| `ai_processing` | LLM operation (summarize, classify, extract, etc.) |
| `deterministic_extraction` | File extraction (PDF parser + Textract + AI) |
| `scatter_gather` | Loop/iteration with nested steps and gather aggregation |
| `conditional` | Branching with `then`/`else` step arrays |

### Validation Gates

| Gate | Phase | What It Checks |
|------|-------|----------------|
| Gate 0 | P0 | Structural validation of extracted requirements |
| Gate 1 | P1 (skipped) | Dummy PASS — semantic mapping coverage |
| Gate 2 | P2 (skipped) | Dummy PASS — grounding coverage |
| Gate 3 | P3 | Every requirement maps to an IR node; plugin operations are valid |
| Gate 4 | P4 | Every compiled requirement maps to a DSL step; thresholds have guards |
| Gate 5 | P5 | All requirements are `enforced`; side effects have guards |

### Admin Model Configuration

Each phase's LLM provider/model/temperature is configurable via the `system_settings_config` Supabase table. Defaults:

| Phase | Provider | Model | Temperature |
|-------|----------|-------|-------------|
| P0 (Requirements) | openai | gpt-4o-mini | 0.0 |
| P1 (Semantic, skipped) | anthropic | claude-opus-4-6 | 0.3 |
| P3 (Formalization) | anthropic | claude-opus-4-6 | 0.0 |

## Quick Start

### Generate a Workflow (Orchestrator Mode)

```typescript
const response = await fetch('/api/v6/generate-ir-semantic', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    enhanced_prompt: {
      sections: {
        data: ['Read emails from my Gmail inbox from the last 7 days'],
        actions: ['Filter emails containing keywords: complaint, refund, angry'],
        output: ['Append matching emails with sender, subject, date, body'],
        delivery: ['Write to Google Sheets spreadsheet ID abc123, tab UrgentEmails']
      },
      specifics: {
        services_involved: ['google-mail', 'google-sheets'],
        resolved_user_inputs: [
          { key: 'filter_keywords', value: ['complaint', 'refund', 'angry'] },
          { key: 'spreadsheet_id', value: 'abc123' }
        ]
      }
    },
    userId: 'offir.omer@gmail.com',
    use_v6_orchestrator: true
  })
})

const result = await response.json()
// result.workflow → WorkflowStep[] (flat PILOT array)
// result.hard_requirements → extracted constraints
// result.validation_results → gate pass/fail results
// result.requirement_map → per-requirement enforcement status
```

### Execute a Compiled Workflow

```typescript
const execResponse = await fetch('/api/v6/execute-test', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    workflow: result.workflow,
    plugins_required: ['google-mail', 'google-sheets'],
    user_id: 'offir.omer@gmail.com',
    workflow_name: 'Complaint Email Logger'
  })
})

const execResult = await execResponse.json()
// execResult.data.stepsCompleted → number of steps that ran
// execResult.data.execution_time_ms → total execution time
```

### Use the Test Page

The easiest way to test is via the interactive UI:

```
http://localhost:3000/test-v6-declarative.html
```

See [V6_TEST_DECLARATIVE.md](./V6_TEST_DECLARATIVE.md) for full test page documentation.

## Continue Reading

| Next | Document | What You'll Learn |
|------|----------|-------------------|
| 2 | [**V6_ARCHITECTURE.md**](./V6_ARCHITECTURE.md) | Deep dive into each phase, IR v4.0 graph, compilation, execution engine |
| 3 | [**V6_API_REFERENCE.md**](./V6_API_REFERENCE.md) | Complete API documentation with request/response examples |
| 4 | [**V6_DEVELOPER_GUIDE.md**](./V6_DEVELOPER_GUIDE.md) | How to integrate, extend, debug, and test V6 |
| 5 | [**V6_TEST_DECLARATIVE.md**](./V6_TEST_DECLARATIVE.md) | How to use the test UI at `/test-v6-declarative.html` |
| 6 | [**V6_EXECUTION_GUIDE.md**](./V6_EXECUTION_GUIDE.md) | Runtime execution engine: step types, variables, conditionals |

---

*V6 Agent Generation System - Neuronforge*
