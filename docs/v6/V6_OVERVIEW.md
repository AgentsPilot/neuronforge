# V6 Agent Generation System - Overview

> **Start here** - This document provides a high-level introduction to the V6 system.

## Documentation Guide

This documentation set covers the V6 Agent Generation System. Read in order:

| # | Document | Description |
|---|----------|-------------|
| 1 | **V6_OVERVIEW.md** (this file) | High-level introduction, problem statement, quick start |
| 2 | [**V6_ARCHITECTURE.md**](./V6_ARCHITECTURE.md) | Deep technical dive into each phase, data flow, error handling |
| 3 | [**V6_API_REFERENCE.md**](./V6_API_REFERENCE.md) | Complete API documentation with request/response schemas |
| 4 | [**V6_DEVELOPER_GUIDE.md**](./V6_DEVELOPER_GUIDE.md) | Integration, extension, debugging, testing, best practices |
| 5 | [**V6_TEST_DECLARATIVE.md**](./V6_TEST_DECLARATIVE.md) | Test page UI guide (`/test-v6-declarative.html`) |

### Quick Links - Key Source Files

| File | Purpose |
|------|---------|
| `app/api/v6/generate-ir-semantic/route.ts` | Main orchestration API |
| `lib/agentkit/v6/semantic-plan/SemanticPlanGenerator.ts` | Phase 1: Understanding |
| `lib/agentkit/v6/semantic-plan/grounding/GroundingEngine.ts` | Phase 2: Grounding |
| `lib/agentkit/v6/semantic-plan/IRFormalizer.ts` | Phase 3: Formalization |
| `lib/agentkit/v6/compiler/DeclarativeCompiler.ts` | Phase 4: Compilation |
| `lib/agentkit/v6/compiler/PilotNormalizer.ts` | Phase 5: Validation |

### Test Suites

| Test File | Coverage |
|-----------|----------|
| `__tests__/DeclarativeCompiler-comprehensive.test.ts` | Core compilation |
| `__tests__/DeclarativeCompiler-dataflow.test.ts` | Variable flow |
| `__tests__/DeclarativeCompiler-regression.test.ts` | Bug regression |
| `__tests__/v6-integration.test.ts` | End-to-end |

---

## What is V6?

The V6 Agent Generation System is a **semantic-first, 5-phase pipeline** for converting natural language prompts into executable AI automation workflows. It represents a fundamental architectural shift from previous approaches, solving the "new prompt, new error" problem through deterministic compilation and real-data grounding.

## The Problem V6 Solves

Previous agent generation approaches suffered from:
- **Field name guessing**: LLMs were forced to guess exact field names (e.g., "email" vs "email_address" vs "emailAddr")
- **Non-deterministic output**: Same prompt could produce different, potentially invalid workflows
- **Validation failures**: Generated workflows often failed schema validation
- **Cascading errors**: One wrong assumption led to multiple downstream failures

## The V6 Solution

V6 introduces a **separation of concerns** between:
1. **Understanding** (what the user wants) - handled by LLM with freedom to express uncertainty
2. **Grounding** (validating against real data) - handled by fuzzy matching algorithms
3. **Formalization** (precise IR generation) - mechanical mapping using grounded facts
4. **Compilation** (executable workflow) - deterministic, rule-based compilation
5. **Validation** (correctness guarantee) - schema-driven post-compilation checks

## The 5-Phase Pipeline

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        V6 Agent Generation Pipeline                         │
└─────────────────────────────────────────────────────────────────────────────┘

     User Prompt
          │
          ▼
   ┌──────────────┐
   │   Enhanced   │ ──► Structured prompt with sections (data, actions, delivery)
   │    Prompt    │
   └──────────────┘
          │
          ▼
   ┌──────────────┐
   │   Phase 1    │ ──► Semantic Plan with assumptions, ambiguities, reasoning
   │ UNDERSTANDING│     LLM expresses uncertainty freely
   └──────────────┘
          │
          ▼
   ┌──────────────┐
   │   Phase 2    │ ──► Grounded Plan with validated field names
   │  GROUNDING   │     Fuzzy matching against real data
   └──────────────┘
          │
          ▼
   ┌──────────────┐
   │   Phase 3    │ ──► Declarative IR with exact field names
   │ FORMALIZATION│     Mechanical mapping (no guessing)
   └──────────────┘
          │
          ▼
   ┌──────────────┐
   │   Phase 4    │ ──► PILOT DSL Workflow (executable)
   │ COMPILATION  │     Deterministic, rule-based
   └──────────────┘
          │
          ▼
   ┌──────────────┐
   │   Phase 5    │ ──► Validated, normalized workflow
   │  VALIDATION  │     Schema-driven checks
   └──────────────┘
          │
          ▼
   Executable Agent
```

## Key Benefits

### 1. Semantic Understanding Phase
The LLM can now express uncertainty through:
- **Assumptions**: "I assume the email field is called 'email' or 'email_address'"
- **Ambiguities**: "It's unclear if the user wants to filter by date or by status"
- **Reasoning traces**: Documented decision-making for debugging

### 2. Real Data Grounding
Instead of guessing, the system validates assumptions against actual data:
- **Fuzzy field matching**: "email" matches "email_addr" with 85% confidence
- **Data type validation**: Confirms field contains email-formatted strings
- **Pattern matching**: Validates date formats, numeric ranges, etc.

### 3. Deterministic Compilation
Once grounded facts are established:
- **No LLM variability**: Same IR always produces same workflow
- **Predictable output**: Developers can reason about compilation behavior
- **Testable**: Unit tests can verify compilation rules

### 4. Schema-Driven Validation
Post-compilation validation ensures:
- **Type correctness**: All parameters match expected types
- **Plugin compatibility**: Actions use correct parameter schemas
- **Execution safety**: No runtime type errors

## When to Use V6

Use V6 when you need:
- **High reliability**: Production workflows that must not fail
- **Complex data sources**: Multiple sources with varying schemas
- **AI operations**: Workflows involving LLM processing of data
- **Auditability**: Need to understand why a workflow was generated

## Quick Start

### Basic Usage

```typescript
// POST /api/v6/generate-ir-semantic
const response = await fetch('/api/v6/generate-ir-semantic', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    enhanced_prompt: {
      sections: {
        data: ['Read emails from my Gmail inbox from the last 7 days'],
        actions: ['Categorize each email as urgent/normal/low-priority'],
        delivery: ['Write results to my "Email Summary" Google Sheet']
      },
      user_context: {
        original_request: 'Categorize my recent emails and save to a spreadsheet'
      }
    },
    // Optional: provide metadata for grounding
    data_source_metadata: {
      headers: ['id', 'subject', 'from', 'snippet', 'date'],
      sample_rows: [/* sample data */]
    }
  })
});
```

### Response Structure

```typescript
{
  success: true,
  // The executable workflow
  workflow: {
    steps: [...],
    metadata: {...}
  },
  // Intermediate results for debugging
  intermediate: {
    semantic_plan: {...},     // Phase 1 output
    grounded_plan: {...},     // Phase 2 output
    declarative_ir: {...},    // Phase 3 output
    compilation_result: {...} // Phase 4 output
  },
  // Metrics
  metadata: {
    total_time_ms: 2500,
    phase_times: {
      understanding: 800,
      grounding: 150,
      formalization: 600,
      compilation: 200,
      validation: 50
    }
  }
}
```

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              V6 System Architecture                          │
└─────────────────────────────────────────────────────────────────────────────┘

                                    API Layer
                    ┌─────────────────────────────────────┐
                    │   /api/v6/generate-ir-semantic      │
                    │   (Main Orchestration Endpoint)     │
                    └─────────────────────────────────────┘
                                      │
              ┌───────────────────────┼───────────────────────┐
              │                       │                       │
              ▼                       ▼                       ▼
    ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
    │ SemanticPlan    │    │  Grounding      │    │  IRFormalizer   │
    │ Generator       │───►│  Engine         │───►│                 │
    │ (Phase 1)       │    │  (Phase 2)      │    │  (Phase 3)      │
    └─────────────────┘    └─────────────────┘    └─────────────────┘
              │                     │                       │
              │              ┌──────┴──────┐                │
              │              │             │                │
              │        FieldMatcher   DataSampler          │
              │                                             │
              │                                             ▼
              │                               ┌─────────────────────┐
              │                               │ DeclarativeCompiler │
              │                               │     (Phase 4)       │
              │                               └─────────────────────┘
              │                                         │
              │                          ┌──────────────┼──────────────┐
              │                          │              │              │
              │                   PluginResolver   Resolvers      IRValidator
              │                                   (AI, Data,
              │                                    Filter, etc.)
              │                                         │
              │                                         ▼
              │                               ┌─────────────────────┐
              │                               │  PilotNormalizer    │
              │                               │  WorkflowValidator  │
              │                               │     (Phase 5)       │
              └──────────────────────────────►└─────────────────────┘
                                                        │
                                                        ▼
                                               Executable Workflow
```

## Continue Reading

Now that you understand the V6 system at a high level, continue with:

| Next | Document | What You'll Learn |
|------|----------|-------------------|
| 2 | [**V6_ARCHITECTURE.md**](./V6_ARCHITECTURE.md) | Deep dive into each phase, data structures, error handling |
| 3 | [**V6_API_REFERENCE.md**](./V6_API_REFERENCE.md) | Complete API documentation with request/response examples |
| 4 | [**V6_DEVELOPER_GUIDE.md**](./V6_DEVELOPER_GUIDE.md) | How to integrate, extend, debug, and test V6 |
| 5 | [**V6_TEST_DECLARATIVE.md**](./V6_TEST_DECLARATIVE.md) | How to use the test UI at `/test-v6-declarative.html` |

---

*V6 Agent Generation System - Neuronforge*
