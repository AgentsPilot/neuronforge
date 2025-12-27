# Agent Creation Complete Flow - Unified Documentation

**Date**: December 27, 2025
**Status**: Current Production Flow
**Purpose**: Single entry point for understanding the complete agent creation architecture

---

## Overview

This document provides a comprehensive end-to-end view of the agent creation flow, from user interaction in the frontend through to the final PILOT_DSL_SCHEMA generation. It serves as a master index that links to detailed component documentation.

### Assumptions

> **Feature Flag**: `USE_AGENT_GENERATION_ENHANCED_TECHNICAL_WORKFLOW_REVIEW=true`
> This document describes the V5 flow path. When the flag is `false`, the LLM Technical Reviewer stage is skipped.

---

## Quick Reference: Key Files

| Component | File Path | Purpose |
|-----------|-----------|---------|
| Frontend Page | [app/v2/agents/new/page.tsx](../app/v2/agents/new/page.tsx) | Main agent creation UI |
| Init Thread API | [app/api/agent-creation/init-thread/route.ts](../app/api/agent-creation/init-thread/route.ts) | Creates OpenAI thread |
| Process Message API | [app/api/agent-creation/process-message/route.ts](../app/api/agent-creation/process-message/route.ts) | Handles Phases 1-4 |
| Generate Agent V4 API | [app/api/generate-agent-v4/route.ts](../app/api/generate-agent-v4/route.ts) | Orchestrates V4/V5 generation |
| V5 Generator | [lib/agentkit/v4/v5-generator.ts](../lib/agentkit/v4/v5-generator.ts) | LLM Technical Reviewer + DSL building |
| Phase4 DSL Builder | [lib/agentkit/v4/core/phase4-dsl-builder.ts](../lib/agentkit/v4/core/phase4-dsl-builder.ts) | Converts technical workflow to PILOT_DSL |
| Create Agent API | [app/api/create-agent/route.ts](../app/api/create-agent/route.ts) | Saves agent to database |
| Thread Repository | [lib/agent-creation/agent-prompt-thread-repository.ts](../lib/agent-creation/agent-prompt-thread-repository.ts) | Thread CRUD operations |

---

## Complete Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ASSUMPTION: USE_AGENT_GENERATION_ENHANCED_TECHNICAL_WORKFLOW_REVIEW=true   │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  FRONTEND: app/v2/agents/new/page.tsx                                        │
│  ────────────────────────────────────                                        │
│  Doc: V2_Thread-Based-Agent-Creation-Flow.md (Lines 489-508)                │
│                                                                              │
│  User navigates to: /v2/agents/new?prompt=Help%20me%20with%20emails          │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  useEffect Hook (page.tsx:208-213)                                           │
│  ─────────────────────────────────                                           │
│  Doc: V2_Thread-Based-Agent-Creation-Flow.md                                │
│                                                                              │
│  Checks: user && initialPrompt && !threadId && aiConfigLoaded                │
│  Calls: initializeThread()                                                   │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  initializeThread() (page.tsx:260-304)                                       │
│  ─────────────────────────────────────                                       │
│  Doc: V2_Thread-Based-Agent-Creation-Flow.md                                │
│                                                                              │
│  • Adds user's original prompt to chat UI                                    │
│  • Shows typing indicator                                                    │
│                         │                                                    │
│                         ▼                                                    │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  POST /api/agent-creation/init-thread                                 │  │
│  │  File: app/api/agent-creation/init-thread/route.ts                    │  │
│  │                                                                       │  │
│  │  • Authenticates user via Supabase                                    │  │
│  │  • Resolves AI provider/model from user settings                      │  │
│  │  • Loads system prompt (v14-chatgpt) via PromptLoader                 │  │
│  │  • Creates OpenAI thread with system prompt injected                  │  │
│  │  • Stores in agent_prompt_threads table                               │  │
│  │    - phase=1, status='active', expires_at=24h                         │  │
│  │  • Returns: { thread_id: "thread_abc123" }                            │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                         │                                                    │
│                         ▼                                                    │
│  setThreadId("thread_abc123")                                                │
│  Immediately calls: processPhase1(thread_id)                                 │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 1: Analysis                                                           │
│  ─────────────────                                                           │
│  processPhase1() (page.tsx:307-363)                                          │
│  Doc: V2_Thread-Based-Agent-Creation-Flow.md                                │
│                         │                                                    │
│                         ▼                                                    │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  POST /api/agent-creation/process-message { phase: 1 }                │  │
│  │  File: app/api/agent-creation/process-message/route.ts                │  │
│  │                                                                       │  │
│  │  • Sends user prompt to OpenAI thread                                 │  │
│  │  • LLM analyzes intent and complexity                                 │  │
│  │  • Returns: clarityScore, conversationalSummary, connectedPlugins     │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                         │                                                    │
│                         ▼                                                    │
│  • Displays conversationalSummary to user                                    │
│  • Stores connectedPlugins in state                                          │
│  • Immediately proceeds to Phase 2                                           │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 2: Clarification Questions                                            │
│  ────────────────────────────────                                            │
│  processPhase2() (page.tsx:366-439)                                          │
│  Doc: V2_Thread-Based-Agent-Creation-Flow.md                                │
│                         │                                                    │
│                         ▼                                                    │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  POST /api/agent-creation/process-message { phase: 2 }                │  │
│  │                                                                       │  │
│  │  • LLM generates clarification questions                              │  │
│  │  • Returns: questionsSequence[], conversationalSummary                │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                         │                                                    │
│                         ▼                                                    │
│  setQuestionsSequence(questions)                                             │
│  UI renders questions via useEffect (lines 245-255)                          │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  USER ANSWERS QUESTIONS                                                      │
│  ──────────────────────                                                      │
│  handleSend() (page.tsx:902-1012)                                            │
│  Doc: V2_Thread-Based-Agent-Creation-Flow.md                                │
│                                                                              │
│  Q1: "Which Slack channel?" → User: "#general"                               │
│  Q2: "What time of day?" → User: "9am daily"                                 │
│  ...all questions answered...                                                │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 3: Enhanced Prompt Generation                                         │
│  ───────────────────────────────────                                         │
│  Auto-Enhancement useEffect (page.tsx:216-241)                               │
│  processPhase3() (page.tsx:442-580)                                          │
│  Doc: V2_Thread-Based-Agent-Creation-Flow.md                                │
│  Doc: PHASE3_SCHEMA_VALIDATION.md                                           │
│                         │                                                    │
│                         ▼                                                    │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  POST /api/agent-creation/process-message { phase: 3 }                │  │
│  │                                                                       │  │
│  │  • LLM generates enhanced_prompt with execution plan                  │  │
│  │  • Validates response with Zod schema                                 │  │
│  │  • Caches in thread.metadata.last_phase3_response                     │  │
│  │  • Returns: enhanced_prompt, services_involved[], missingPlugins[]    │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                         │                                                    │
│                         ▼                                                    │
│  • setEnhancedPromptData(enhanced_prompt)                                    │
│  • Show EnhancedPromptCard with [Yes, perfect!] [Need changes] buttons       │
│                                                                              │
│  OAuth Gate: if missingPlugins.length > 0 → Show plugin connect cards        │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PHASE 4: Technical Workflow Generation                                      │
│  ──────────────────────────────────────                                      │
│  Doc: V2_Thread-Based-Agent-Creation-Flow.md (Lines 1006-1386)              │
│                         │                                                    │
│                         ▼                                                    │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  POST /api/agent-creation/process-message { phase: 4 }                │  │
│  │                                                                       │  │
│  │  • LLM builds technical_workflow from enhanced_prompt                 │  │
│  │  • Returns: technical_workflow[], feasibility, technical_inputs       │  │
│  │  • Merges with cached Phase 3 data                                    │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  USER APPROVAL                                                               │
│  ─────────────                                                               │
│  handleApprove() (page.tsx:1015-1032)                                        │
│  Doc: V2_Thread-Based-Agent-Creation-Flow.md                                │
│                                                                              │
│  User clicks [Yes, perfect!]                                                 │
│  • Adds plan summary message to chat                                         │
│  • Shows typing indicator                                                    │
│  • Calls: createAgent()                                                      │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  createAgent() (page.tsx:668-815)                                            │
│  ────────────────────────────────                                            │
│  Doc: V2_Thread-Based-Agent-Creation-Flow.md                                │
│                         │                                                    │
│                         ▼                                                    │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  POST /api/generate-agent-v4                                          │  │
│  │  File: app/api/generate-agent-v4/route.ts                             │  │
│  │  Doc: V4_OPENAI_3STAGE_ARCHITECTURE.md                                │  │
│  │                                                                       │  │
│  │  Input: {                                                             │  │
│  │    enhancedPromptTechnicalWorkflow,  // Phase 4 output                │  │
│  │    openaiThreadId: threadId,         // Thread correlation            │  │
│  │    services_involved                 // Plugin list from Phase 3      │  │
│  │  }                                                                    │  │
│  │                                                                       │  │
│  │  Feature Flag Check (line 116-118):                                   │  │
│  │  useEnhancedTechnicalWorkflowReview() → true → V5 path                │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  V5 GENERATOR - STAGE 1: LLM Technical Reviewer                              │
│  ──────────────────────────────────────────────                              │
│  File: lib/agentkit/v4/v5-generator.ts (Lines 237-266)                      │
│  Doc: V5_GENERATOR_ARCHITECTURE.md                                          │
│                                                                              │
│  Prompt Templates:                                                           │
│    • System: Workflow-Agent-Technical-Reviewer-SystemPrompt-v3               │
│    • User: Workflow-Agent-Technical-Reviewer-UserPrompt-v1                   │
│                                                                              │
│  Process:                                                                    │
│    1. Loads plugin schemas (schema_services)                                 │
│    2. Sends technical_workflow to LLM for review                             │
│    3. LLM validates against plugin schemas                                   │
│    4. LLM repairs issues:                                                    │
│       - Missing steps                                                        │
│       - Invalid plugin/action references                                     │
│       - Incorrect input/output mappings                                      │
│       - Control flow structure issues                                        │
│                                                                              │
│  Output (TechnicalReviewerResponse):                                         │
│    • reviewer_summary: { status: approved|repaired|blocked }                 │
│    • technical_workflow: reviewed/repaired steps                             │
│    • feasibility: { can_execute, blocking_issues[], warnings[] }             │
│                                                                              │
│  Schema Validation: lib/validation/technical-reviewer-schema.ts             │
│  JSON Repair: Uses jsonrepair library for malformed responses               │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  V5 GENERATOR - STAGE 2: Phase4DSLBuilder.build()                            │
│  ────────────────────────────────────────────────                            │
│  File: lib/agentkit/v4/core/phase4-dsl-builder.ts                           │
│  Doc: Phase4-to-PILOT_DSL-Mapping.md                                        │
│                                                                              │
│  100% Deterministic Conversion (No LLM):                                     │
│                                                                              │
│  Step Type Mapping (Lines 358-391):                                          │
│  ┌────────────────────────┬──────────────────────────────────────┐          │
│  │ Phase 4 Kind           │ PILOT_DSL Type                       │          │
│  ├────────────────────────┼──────────────────────────────────────┤          │
│  │ kind: "operation"      │ type: "action" (ActionStep)          │          │
│  │ kind: "transform"      │ type: "transform" (deterministic)    │          │
│  │                        │   or "ai_processing" (LLM-assisted)  │          │
│  │ kind: "control"        │ type: "scatter_gather" (for_each)    │          │
│  │   (for_each)           │   or "conditional" (if)              │          │
│  └────────────────────────┴──────────────────────────────────────┘          │
│                                                                              │
│  Transform Type Routing (Lines 414-445):                                     │
│  • Deterministic: filter, map, sort, group_by, aggregate, reduce             │
│  • LLM-Assisted: summarize_with_llm, classify_with_llm, extract_with_llm     │
│                                                                              │
│  Input Resolution (Lines 778-868):                                           │
│  ┌────────────────────────┬──────────────────────────────────────┐          │
│  │ source                 │ Resolution                           │          │
│  ├────────────────────────┼──────────────────────────────────────┤          │
│  │ "constant"             │ literal value                        │          │
│  │ "from_step"            │ {{stepX.output.field}}               │          │
│  │ "user_input"           │ {{input.key}}                        │          │
│  │ "env"                  │ {{env.key}}                          │          │
│  │ "plugin_config"        │ {{plugin.config.key}}                │          │
│  └────────────────────────┴──────────────────────────────────────┘          │
│                                                                              │
│  Confidence Calculation:                                                     │
│  • Base: 0.95 if feasibility.can_execute                                     │
│  • Adjusted by warnings (-0.05 each) and errors (-0.1 each)                  │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Output: PILOT_DSL_SCHEMA                                                    │
│  ────────────────────────                                                    │
│  Doc: Phase4-to-PILOT_DSL-Mapping.md                                        │
│                                                                              │
│  {                                                                           │
│    agent_name: string,                                                       │
│    description: string,                                                      │
│    system_prompt: string,                                                    │
│    workflow_type: "pure_ai" | "data_retrieval_ai" | "ai_external_actions",   │
│    suggested_plugins: string[],                                              │
│    required_inputs: RequiredInput[],                                         │
│    workflow_steps: WorkflowStep[],                                           │
│    suggested_outputs: SuggestedOutput[],                                     │
│    reasoning: string,                                                        │
│    confidence: number  // 0-1                                                │
│  }                                                                           │
│                                                                              │
│  Additional V5 Response Fields:                                              │
│  • workflowGenerationSessionId: for session tracking diary                   │
│  • metadata.version: "v5"                                                    │
│  • metadata.generator_version: "v5"                                          │
│  • metadata.architecture: "technical-workflow-llm-review-dsl"                │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  SCHEDULING FLOW (page.tsx - isAwaitingSchedule)                             │
│  ───────────────────────────────────────────────                             │
│  Doc: V2_Thread-Based-Agent-Creation-Flow.md                                │
│                                                                              │
│  UI shows scheduling options:                                                │
│    • [On Demand] - Manual trigger                                            │
│    • [Scheduled] - Configure cron expression                                 │
│                                                                              │
│  User selects schedule → setPendingAgentData(agentData)                      │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  executeAgentCreation() (page.tsx:821-897)                                   │
│  ─────────────────────────────────────────                                   │
│  Doc: V2_Thread-Based-Agent-Creation-Flow.md (Lines 1509-1598)              │
│                         │                                                    │
│                         ▼                                                    │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │  POST /api/create-agent                                               │  │
│  │  File: app/api/create-agent/route.ts                                  │  │
│  │                                                                       │  │
│  │  Body: {                                                              │  │
│  │    agent: PILOT_DSL_SCHEMA,                                           │  │
│  │    sessionId,                                                         │  │
│  │    agentId,                                                           │  │
│  │    thread_id: threadId                                                │  │
│  │  }                                                                    │  │
│  │                                                                       │  │
│  │  Actions:                                                             │  │
│  │    • Saves agent to agents table                                      │  │
│  │    • Links thread: agent_prompt_threads.agent_id = agents.id          │  │
│  │    • Updates thread status = 'completed'                              │  │
│  │    • Returns: { id: agent_uuid, ... }                                 │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│                         │                                                    │
│                         ▼                                                    │
│  router.push(`/agents/${data.id}`)  // Redirect to agent page                │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Phase Summary Table

| Phase | API Endpoint | Input | Output | Doc Reference |
|-------|--------------|-------|--------|---------------|
| Init | `POST /api/agent-creation/init-thread` | user, aiConfig | thread_id | V2_Thread-Based-Agent-Creation-Flow.md |
| 1 | `POST /api/agent-creation/process-message` | phase=1, prompt | clarityScore, connectedPlugins | V2_Thread-Based-Agent-Creation-Flow.md |
| 2 | `POST /api/agent-creation/process-message` | phase=2 | questionsSequence[] | V2_Thread-Based-Agent-Creation-Flow.md |
| 3 | `POST /api/agent-creation/process-message` | phase=3, answers | enhanced_prompt, services_involved | PHASE3_SCHEMA_VALIDATION.md |
| 4 | `POST /api/agent-creation/process-message` | phase=4 | technical_workflow, feasibility | V2_Thread-Based-Agent-Creation-Flow.md |
| V5 Gen | `POST /api/generate-agent-v4` | technicalWorkflow | PILOT_DSL_SCHEMA | V4_OPENAI_3STAGE_ARCHITECTURE.md |
| Save | `POST /api/create-agent` | agent, thread_id | agent.id | V2_Thread-Based-Agent-Creation-Flow.md |

---

## Frontend State Flow

| State Variable | Init | Phase 1 | Phase 2 | Phase 3 | Approve | Complete |
|----------------|------|---------|---------|---------|---------|----------|
| `threadId` | `null` | `"thread_abc"` | `"thread_abc"` | `"thread_abc"` | `"thread_abc"` | `"thread_abc"` |
| `workflowPhase` | `'init'` | `'analysis'` | `'questions'` | `'enhancement'` | `'approval'` | `'complete'` |
| `questionsSequence` | `[]` | `[]` | `[q1, q2...]` | `[q1, q2...]` | `[q1, q2...]` | `[q1, q2...]` |
| `enhancedPromptData` | `null` | `null` | `null` | `{plan...}` | `{plan...}` | `{plan...}` |
| `pendingAgentData` | `null` | `null` | `null` | `null` | `{agent...}` | `null` |

---

## Database Tables Involved

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `agent_prompt_threads` | Tracks thread lifecycle | thread_id, phase, status, metadata, agent_id |
| `agents` | Stores created agents | id, workflow_steps, system_prompt, plugins_required |
| `workflow_generation_sessions` | V5 session tracking | session_id, stages[], openai_thread_id |

---

## Detailed Documentation Index

### Frontend & Thread Flow
- **[V2_Thread-Based-Agent-Creation-Flow.md](V2_Thread-Based-Agent-Creation-Flow.md)** - Comprehensive frontend flow, all phases, state management, iterations audit trail

### V4/V5 Generator Architecture
- **[V4_OPENAI_3STAGE_ARCHITECTURE.md](V4_OPENAI_3STAGE_ARCHITECTURE.md)** - 3-stage architecture overview, V4 vs V5 comparison, feature flag documentation
- **[V5_GENERATOR_ARCHITECTURE.md](V5_GENERATOR_ARCHITECTURE.md)** - V5 orchestrator details, LLM Technical Reviewer, session tracking, input structures, data flow examples

### DSL Conversion
- **[Phase4-to-PILOT_DSL-Mapping.md](Phase4-to-PILOT_DSL-Mapping.md)** - Step kind→DSL type mapping, input resolution patterns, condition parsing, confidence calculation

### Schema Validation
- **[PHASE3_SCHEMA_VALIDATION.md](PHASE3_SCHEMA_VALIDATION.md)** - Phase 3 Zod schema validation, response structure

---

## V4 vs V5 Path Comparison

```
                    ┌─────────────────────────────────────┐
                    │  POST /api/generate-agent-v4        │
                    │  with enhancedPromptTechnicalWorkflow│
                    └─────────────────┬───────────────────┘
                                      │
                           Feature Flag Check
                    useEnhancedTechnicalWorkflowReview()
                                      │
              ┌───────────────────────┴───────────────────────┐
              │                                               │
              ▼                                               ▼
┌─────────────────────────────┐             ┌─────────────────────────────┐
│  V5 PATH (flag=true)        │             │  V4 PATH (flag=false)       │
│  ─────────────────────────  │             │  ─────────────────────────  │
│                             │             │                             │
│  1. LLM Technical Reviewer  │             │  (Skip reviewer)            │
│     - Validate workflow     │             │                             │
│     - Repair issues         │             │                             │
│     - Check feasibility     │             │                             │
│                             │             │                             │
│  2. Phase4DSLBuilder        │             │  1. Phase4DSLBuilder        │
│     - Convert to PILOT_DSL  │             │     - Convert to PILOT_DSL  │
│                             │             │                             │
│  Output includes:           │             │  Output includes:           │
│  - workflowGenerationSessionId            │  - Standard PILOT_DSL       │
│  - metadata.version: "v5"   │             │  - metadata.version: "v4"   │
└─────────────────────────────┘             └─────────────────────────────┘
```

---

## Key Code References

### Thread Initialization
```typescript
// app/api/agent-creation/init-thread/route.ts:55-120
const thread = await openai.beta.threads.create({
  messages: [{ role: 'assistant', content: systemPrompt }]
});
await threadRepository.createThread({
  openai_thread_id: thread.id,
  user_id: user.id,
  current_phase: 1,
  status: 'active',
  ai_provider: resolvedProvider,
  ai_model: resolvedModel,
  metadata: { created_from: 'v2-agent-creation' }
});
```

### V5 Feature Flag Check
```typescript
// app/api/generate-agent-v4/route.ts:116-118
const useV5 = useEnhancedTechnicalWorkflowReview();
if (useV5 && enhancedPromptTechnicalWorkflow) {
  // Use V5 generator with LLM review
}
```

### Phase4 DSL Builder Entry Point
```typescript
// lib/agentkit/v4/core/phase4-dsl-builder.ts:122-140
static build(phase4Response: Phase4Response): Phase4DSLBuilderResult {
  const builder = new Phase4DSLBuilder(phase4Response);
  return builder.convert();
}
```

---

## Troubleshooting Guide

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| Thread not found | Thread expired (24h) | Create new thread |
| Phase 3 validation fails | LLM response doesn't match Zod schema | Check PHASE3_SCHEMA_VALIDATION.md |
| V5 reviewer returns blocked | Workflow has unresolvable issues | Review blocking_issues in response |
| DSL conversion warnings | Missing inputs or invalid references | Check Phase4-to-PILOT_DSL-Mapping.md |

### Debugging Tips

1. **Check thread status**: Query `agent_prompt_threads` table
2. **View V5 session**: Query `workflow_generation_sessions` with sessionId
3. **Inspect DSL output**: Check `conversion_stats` and `warnings` in builder result

---

## Related Documentation

- [V4_PRODUCTION_READINESS_CHECKLIST.md](V4_PRODUCTION_READINESS_CHECKLIST.md) - Production deployment checklist
- [COMPLETE_SYSTEM_FLOW.md](COMPLETE_SYSTEM_FLOW.md) - Execution flow (AIS, Memory, Routing)
- [AGENT_CREATION_AND_EXECUTION_FLOW.md](AGENT_CREATION_AND_EXECUTION_FLOW.md) - Legacy v2 flow (historical reference)

---

**Document Version**: 1.0
**Created**: December 27, 2025
**Maintainer**: AI Agent (Claude) & Human Developer
