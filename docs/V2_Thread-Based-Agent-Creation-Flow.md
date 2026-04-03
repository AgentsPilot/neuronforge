# Thread-Based Agent Creation Flow Diagram

> **Last Updated**: 2026-04-01

## Overview
This diagram shows the complete user journey through the V2 agent creation page (`app/v2/agents/new/page.tsx`).

> **Note**: The legacy `useConversationalBuilder.ts` hook is no longer used. The V2 page implements the thread-based flow directly without a feature flag - it is always enabled.

---

## Main Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         USER STARTS                                 │
│            (Navigates to /v2/agents/new?prompt=...)                 │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  useEffect Hook (page.tsx ~line 454)                                │
│  ─────────────────────────────────────                              │
│  • Checks: user && initialPrompt && !threadId && aiConfigLoaded     │
│  • Calls: initializeThread()                                        │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  initializeThread() - THREAD CREATION (~line 519)                   │
│  ─────────────────────────────────────────────────────────────────  │
│                                                                     │
│  STEP 1: Initialize Thread                                          │
│  ─────────────────────────────                                      │
│  • Adds user's original prompt to chat                              │
│  • Shows typing indicator                                           │
│    │                                                                │
│    ├─► POST /api/agent-creation/init-thread                         │
│    │   • Creates OpenAI thread                                      │
│    │   • Injects system prompt (Workflow-Agent-Creation-Prompt-v14)  │
│    │   • Stores in agent_prompt_threads table                       │
│    │   • Returns: { thread_id: "thread_abc123" }                    │
│    │                                                                │
│    └─► setThreadId("thread_abc123")                                 │
│    │                                                                │
│    └─► Immediately calls processPhase1(thread_id)                   │
│                                                                     │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STEP 2: Phase 1 - Analyze Prompt (processPhase1, ~line 566)        │
│  ───────────────────────────────────────────                        │
│    │                                                                │
│    ├─► POST /api/agent-creation/process-message                     │
│    │   Body: {                                                      │
│    │     thread_id: "thread_abc123",                                │
│    │     phase: 1,                                                  │
│    │     user_prompt: "Send my daily emails to Slack"               │
│    │   }                                                            │
│    │                                                                │
│    │   Backend Processing:                                          │
│    │   • Merges user_context from auth + request                    │
│    │   • Fetches connected_services from PluginManagerV2            │
│    │   • Adds user message to thread                                │
│    │   • Retrieves full thread history (includes system prompt)     │
│    │   • Calls AI provider (OpenAI/Anthropic/Kimi) with context     │
│    │   • Stores AI response back in thread                          │
│    │                                                                │
│    └─► Returns: {                                                   │
│          clarityScore: 75,                                          │
│          conversationalSummary: "I understand you want...",         │
│          connectedPlugins: ['google-mail', 'slack', ...],           │
│          analysis: { ... }                                          │
│        }                                                            │
│                                                                     │
│  • Stores connectedPlugins in state for service status              │
│  • Displays conversationalSummary to user                           │
│  • Immediately proceeds to Phase 2 (always runs)                    │
│                                                                     │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STEP 3: Phase 2 - Generate Questions (processPhase2, ~line 625)    │
│  ─────────────────────────────────────────                          │
│                                                                     │
│  NOTE: V2 flow ALWAYS runs Phase 2 (no clarity score skip)          │
│                                                                     │
│    ├─► POST /api/agent-creation/process-message                     │
│    │   Body: {                                                      │
│    │     thread_id: "thread_abc123",                                │
│    │     phase: 2,                                                  │
│    │     enhanced_prompt: null,        // V10: for mini-cycle       │
│    │     user_feedback: null,          // V10: for edit flow        │
│    │     declined_services: []         // V10: skipped plugins      │
│    │   }                                                            │
│    │                                                                │
│    └─► Returns: {                                                   │
│          questionsSequence: [                                       │
│            { id: "q1", question: "Which Slack channel?", type: "text" },
│            { ... }                                                  │
│          ],                                                         │
│          conversationalSummary: "Let me ask a few questions..."     │
│        }                                                            │
│                                                                     │
│  If questions.length > 0:                                           │
│  • setQuestionsSequence(questions)                                  │
│  • Questions displayed via useEffect (~line 504)                    │
│                                                                     │
│  If questions.length === 0:                                         │
│  • Skip to Phase 3 directly                                         │
│                                                                     │
└──────────────────┬──────────────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│         UI RENDERS QUESTIONS                                        │
│         (User answers via handleSend, ~line 1298)                   │
│                                                                     │
│  • Question 1: "Which Slack channel?"                               │
│    User types: "#general" → answerQuestion(q.id, answer)            │
│                                                                     │
│  • Question 2: "What time of day?"                                  │
│    User types: "9am daily" → answerQuestion(q.id, answer)           │
│                                                                     │
│  • ... all questions answered ...                                   │
│                                                                     │
└──────────────────┬──────────────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Auto-Enhancement Trigger (useEffect, ~line 462)                    │
│  ─────────────────────────────────────────                          │
│  When all questions answered && workflowPhase === 'enhancement':    │
│                                                                     │
│  • Shows typing indicator                                           │
│  • Calls processPhase3()                                            │
│  • V10: If isInMiniCycle, passes pendingEnhancedPrompt              │
│                                                                     │
└────────────────────────────────────┬────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Phase 3 - Enhancement (processPhase3, ~line 701)                   │
│  ─────────────────────────────────────────────────────────────────  │
│                                                                     │
│    ├─► POST /api/agent-creation/process-message                     │
│    │   Body: {                                                      │
│    │     thread_id: "thread_abc123",                                │
│    │     phase: 3,                                                  │
│    │     clarification_answers: { q1: "#general", q2: "9am" },      │
│    │     connected_services: ['google-mail', 'slack'],              │
│    │     declined_services: [],                                     │
│    │     enhanced_prompt: null  // V10: for refinement              │
│    │   }                                                            │
│    │                                                                │
│    │   Backend Processing:                                          │
│    │   • Adds user message + clarification answers to thread        │
│    │   • Retrieves FULL thread history                              │
│    │   • Calls AI provider with conversation context                │
│    │   • Validates response with Zod schema (strict!)               │
│    │   • Stores AI response in thread                               │
│    │                                                                │
│    └─► Returns: {                                                   │
│          enhanced_prompt: {                                         │
│            plan_title: "Gmail to Slack Automation",                 │
│            plan_description: "Send daily emails to Slack...",       │
│            sections: { data, actions, output, delivery },           │
│            specifics: {                                             │
│              services_involved: ['google-mail', 'slack'],           │
│              user_inputs_required: [],                              │
│              resolved_user_inputs: []  // V10                       │
│            }                                                        │
│          },                                                         │
│          missingPlugins: [],  // OAuth gate check                   │
│          metadata: { ready_for_generation: true, ... }              │
│        }                                                            │
│                                                                     │
│  OAuth Gate Check:                                                  │
│  if (missingPlugins.length > 0) → Show plugin connect cards         │
│                                                                     │
│  V10 Mini-Cycle Check:                                              │
│  if (user_inputs_required.length > 0) → Trigger Phase 2 again       │
│                                                                     │
│  Success Path:                                                      │
│  • setEnhancedPromptData(enhanced_prompt)                           │
│  • setEnhancement(enhancedPrompt)                                   │
│  • Show plan card with Approve/Edit buttons                         │
│                                                                     │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      APPROVAL PHASE                                 │
│                  (User reviews enhanced prompt)                     │
│                                                                     │
│  UI shows (EnhancedPromptCard component):                           │
│  • Plan title and description                                       │
│  • Expandable workflow steps (sections)                             │
│  • Services involved                                                │
│  • [Yes, perfect!] [Need changes] buttons                           │
│                                                                     │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
                    ┌────────────┴────────────┐
                    │   User Decision         │
                    └────────────┬────────────┘
                                 │
                 ┌───────────────┴───────────────┐
                 │                               │
                 ▼                               ▼
    ┌─────────────────────────┐    ┌─────────────────────────────┐
    │  [Yes, perfect!]        │    │  [Need changes]             │
    │  handleApprove()        │    │  handleEdit()               │
    │  (~line 1411)           │    │  (~line 1431)               │
    │                         │    │                             │
    │  • Add plan summary msg │    │  • Store pending prompt     │
    │  • Show typing indicator│    │  • Set isAwaitingFeedback   │
    │  • Call createAgent()   │    │  • User types feedback      │
    │                         │    │  • Trigger Phase 2 with     │
    │                         │    │    user_feedback param      │
    └───────────┬─────────────┘    └─────────────────────────────┘
                │
                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Agent Generation (createAgent, ~line 961)                          │
│  ─────────────────────────────────────────────────────────────────  │
│                                                                     │
│  Checks feature flag: useV6AgentGeneration()                        │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  V6 FLOW (flag enabled) — 5-Phase Semantic Pipeline           │  │
│  │  ─────────────────────────────────────────────────────────    │  │
│  │                                                               │  │
│  │  POST /api/v6/generate-ir-semantic                            │  │
│  │  Body: {                                                      │  │
│  │    enhanced_prompt: enhancedPromptData,                       │  │
│  │    userId: user.id,                                           │  │
│  │    config: {                                                  │  │
│  │      return_intermediate_results: true,                       │  │
│  │      provider: 'openai'                                      │  │
│  │    }                                                          │  │
│  │  }                                                            │  │
│  │                                                               │  │
│  │  Single API call runs all 5 V6 phases:                        │  │
│  │    1. Semantic Plan (understanding)                           │  │
│  │    2. Grounding                                               │  │
│  │    3. Formalization                                           │  │
│  │    4. Compilation                                             │  │
│  │    5. Normalization                                           │  │
│  │                                                               │  │
│  │  Returns: {                                                   │  │
│  │    success: true,                                             │  │
│  │    workflow: { workflow_steps, suggested_plugins },            │  │
│  │    validation: { valid, issues },                             │  │
│  │    metadata: {                                                │  │
│  │      steps_generated, plugins_used,                           │  │
│  │      total_time_ms, phase_times_ms                            │  │
│  │    },                                                         │  │
│  │    intermediate_results: { semantic_plan, grounded_plan, ir } │  │
│  │  }                                                            │  │
│  │                                                               │  │
│  │  Maps V6 response to agent via mapV6ResponseToAgent()         │  │
│  │  Sets platform_version: 'v6.0' in agent_config                │  │
│  │                                                               │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  V4 FLOW (flag disabled) — OpenAI 3-Stage Generation          │  │
│  │  ─────────────────────────────────────────────────────────    │  │
│  │                                                               │  │
│  │  POST /api/generate-agent-v4                                  │  │
│  │  Body: {                                                      │  │
│  │    enhancedPrompt: JSON.stringify(enhancedPromptData),        │  │
│  │    promptType: 'enhanced',                                    │  │
│  │    clarificationAnswers: { ... },                             │  │
│  │    userId: user.id,                                           │  │
│  │    services_involved: requiredServices,                       │  │
│  │    connectedPlugins: connectedPlugins                         │  │
│  │  }                                                            │  │
│  │                                                               │  │
│  │  Returns: GenerateAgentV2Response (agent config with steps)   │  │
│  │  Sets platform_version: 'v2.0' in agent_config                │  │
│  │                                                               │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  After either flow:                                                 │
│  1. Check for required input parameters (input_schema)              │
│     • Pre-fills values from resolved_user_inputs if available       │
│     • If unresolved required params exist, start input param flow   │
│     • Otherwise, proceed to scheduling                              │
│                                                                     │
│  2. Scheduling flow (isAwaitingSchedule)                            │
│     • User selects: On Demand / Scheduled                           │
│     • Configure cron expression if scheduled                        │
│                                                                     │
│  3. Call executeAgentCreation() (~line 1216)                         │
│     • POST /api/create-agent with agent data                        │
│     • Saves input parameter values via /api/agent-configurations    │
│     • Links thread to agent (thread_id passed)                      │
│     • Redirect to /agents/{id}                                      │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  Phase 4 - Technical Workflow Generation (NOT WIRED IN FRONTEND)    │
│  ─────────────────────────────────────────────────────────────────  │
│                                                                     │
│  NOTE: Phase 4 backend support exists in process-message route,     │
│  but the V2 frontend does NOT call it. After Phase 3, the flow     │
│  goes directly to agent generation (V6 or V4, see above).           │
│                                                                     │
│  To enable Phase 4, frontend would need to:                         │
│  1. Add processPhase4() function                                    │
│  2. Call it after Phase 3 approval                                  │
│  3. Display technical_workflow steps                                │
│  4. Collect technical_inputs_required values                        │
│                                                                     │
│  Backend Phase 4 Request (if wired):                                │
│    │                                                                │
│    ├─► POST /api/agent-creation/process-message                     │
│    │   Body: {                                                      │
│    │     thread_id: "thread_abc123",                                │
│    │     phase: 4,                                                  │
│    │     enhanced_prompt: { /* from Phase 3 */ },                   │
│    │     schema_services: { /* auto-generated from services */ }    │
│    │   }                                                            │
│    │                                                                │
│    │   Backend Processing:                                          │
│    │   • Generates schema_services from services_involved           │
│    │   • Builds Phase 4 user message with full plugin definitions   │
│    │   • Calls AI provider to compile functional spec → tech steps  │
│    │   • Validates response with Phase 4 Zod schema                 │
│    │   • Stores AI response in thread                               │
│    │                                                                │
│    └─► Returns: {                                                   │
│          technical_workflow: [                                      │
│            { id: "step1", kind: "operation",                        │
│              plugin: "google-mail", action: "searchMessages", ... },│
│            { id: "step2", kind: "transform",                        │
│              operation: { type: "summarize_with_llm" }, ... },      │
│            ...                                                      │
│          ],                                                         │
│          technical_inputs_required: [                               │
│            { key: "slack_channel_id", plugin: "slack",              │
│              description: "Slack channel to post to" }              │
│          ],                                                         │
│          feasibility: {                                             │
│            can_execute: true,                                       │
│            blocking_issues: [],                                     │
│            warnings: [{ type: "assumption", description: "..." }]   │
│          },                                                         │
│          metadata: {                                                │
│            ready_for_generation: true,                              │
│            phase4: {                                                │
│              can_execute: true,                                     │
│              needs_technical_inputs: true,                          │
│              needs_user_feedback: false                             │
│            }                                                        │
│          }                                                          │
│        }                                                            │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Key State Variables Throughout Flow

### Page-Level State (`app/v2/agents/new/page.tsx`)

| State Variable           | Initial   | After Phase 1      | After Phase 2      | After Phase 3      |
|--------------------------|-----------|--------------------|--------------------|-------------------- |
| `threadId`               | `null`    | `"thread_abc123"`  | `"thread_abc123"`  | `"thread_abc123"`  |
| `connectedPlugins`       | `[]`      | `['google-mail']`  | `['google-mail']`  | `['google-mail']`  |
| `requiredServices`       | `[]`      | `[]`               | `[]`               | `['google-mail', 'slack']` |
| `missingPlugins`         | `[]`      | `[]`               | `[]`               | `[]` or `['slack']`|
| `declinedPlugins`        | `[]`      | `[]`               | `[]`               | `['notion']` (if skipped) |
| `enhancedPromptData`     | `null`    | `null`             | `null`             | `{plan_title, ...}`|
| `isInMiniCycle`          | `false`   | `false`            | `false`            | `true` (if user_inputs_required) |
| `pendingEnhancedPrompt`  | `null`    | `null`             | `null`             | `{...}` (if mini-cycle) |
| `isAwaitingFeedback`     | `false`   | `false`            | `false`            | `true` (if "Need changes" clicked) |
| `isAwaitingSchedule`     | `false`   | `false`            | `false`            | `true` (after approve) |
| `pendingAgentData`       | `null`    | `null`             | `null`             | `{agent_name, ...}`|

### Builder State Hook (`useAgentBuilderState`)

| State Variable           | Initial   | After Phase 1      | After Phase 2      | After Phase 3      |
|--------------------------|-----------|--------------------|--------------------|-------------------- |
| `workflowPhase`          | `'init'`  | `'analysis'`       | `'questions'`      | `'approval'`       |
| `clarityScore`           | `0`       | `75`               | `75`               | `75`               |
| `questionsSequence`      | `[]`      | `[]`               | `[q1, q2, ...]`    | `[q1, q2, ...]`    |
| `currentQuestionIndex`   | `-1`      | `-1`               | `0 → 1 → -1`       | `-1`               |
| `clarificationAnswers`   | `{}`      | `{}`               | `{q1: "..."}` | `{q1: "...", q2: "..."}` |
| `enhancedPrompt`         | `""`      | `""`               | `""`               | `"Plan description..."` |
| `enhancementComplete`    | `false`   | `false`            | `false`            | `true`             |

### Phase 4 State (NOT IMPLEMENTED IN FRONTEND)

| State Variable           | Description |
|--------------------------|-------------|
| `technicalWorkflow`      | Would hold `[{id, kind, plugin, action, ...}]` |
| `technicalInputsRequired`| Would hold `[{key, plugin, description, ...}]` |
| `feasibility`            | Would hold `{can_execute, blocking_issues, warnings}` |

---

## Example User Journey (Standard Flow)

```
1. User navigates to: /v2/agents/new?prompt=Help%20me%20with%20emails
   ↓
2. initializeThread() creates thread + calls Phase 1
   ↓
3. Phase 1 Analysis → clarityScore: 45, conversationalSummary displayed
   ↓
4. Phase 2 Questions Generated:
   - "Which email service?"
   - "What action on emails?"
   - "Where should results go?"
   ↓
5. User answers: "Gmail" → "Send to Slack" → "#general"
   ↓
6. Auto-enhancement useEffect triggers Phase 3
   ↓
7. Phase 3 Enhancement → Enhanced prompt with plan card shown
   ↓
8. User clicks "Yes, perfect!" → createAgent() called
   ↓
9a. V6 flag ON:  POST /api/v6/generate-ir-semantic (5-phase semantic pipeline)
9b. V6 flag OFF: POST /api/generate-agent-v4 (OpenAI 3-Stage generation)
   ↓
10. Input parameters collected (if required and not already resolved)
   ↓
11. Scheduling UI shown (On Demand / Scheduled)
   ↓
12. User selects schedule → executeAgentCreation()
   ↓
13. POST /api/create-agent saves agent, redirects to /agents/{id}

API Calls (V6):  init-thread + process-message × 3 + generate-ir-semantic + create-agent
API Calls (V4):  init-thread + process-message × 3 + generate-agent-v4 + create-agent
```

---

## Example User Journey (OAuth Gate)

```
1. User: "Send my Gmail to Notion"
   ↓
2. Phase 1-2 complete normally
   ↓
3. Phase 3 returns: missingPlugins: ['notion']
   ↓
4. UI shows plugin connect cards
   ↓
5a. User clicks "Connect Notion" → OAuth flow → Plugin connected
    → Phase 3 re-runs with updated connected_services
   ↓
5b. User clicks "Skip" → Phase 3 re-runs with declined_services: ['notion']
    → LLM adjusts plan or flags blocking issue
```

---

## Example User Journey (V10 Mini-Cycle)

```
1. User: "Send daily summary to my accountant"
   ↓
2. Phase 3 returns: user_inputs_required: ['accountant_email']
   ↓
3. Frontend detects mini-cycle, triggers Phase 2 with enhanced_prompt
   ↓
4. Phase 2 generates targeted question: "What is your accountant's email?"
   ↓
5. User answers: "bob@company.com"
   ↓
6. Phase 3 re-runs → resolved_user_inputs: [{key: 'accountant_email', value: 'bob@company.com'}]
   ↓
7. Plan shown with all inputs resolved
```

---

## Thread Persistence

```
┌─────────────────────────────────────────────┐
│  agent_prompt_threads Table                 │
│  ─────────────────────────────────────────  │
│                                             │
│  id: uuid                                   │
│  user_id: uuid                              │
│  openai_thread_id: "thread_abc123"          │
│  status: "active" → "completed"             │
│  current_phase: 3                           │
│  agent_id: null → uuid (after create-agent) │
│  ai_provider: 'openai' (immutable)          │
│  ai_model: 'gpt-4o' (immutable)            │
│  created_at: 2026-03-15T10:00:00Z           │
│  updated_at: 2026-03-15T10:05:23Z           │
│  expires_at: 2026-03-16T10:00:00Z (24h)     │
│  metadata: {                                │
│    last_phase: 3,                           │
│    last_updated: "...",                     │
│    iterations: [...],  ← Full audit trail   │
│    phase1_connected_services: [...],        │
│    phase1_available_services: [...]         │
│  }                                          │
│                                             │
└─────────────────────────────────────────────┘
```

**Resume Capability**: If user refreshes page mid-flow, frontend can:
1. Check DB for active thread
2. Retrieve `threadId` and `current_phase`
3. Fetch thread messages from OpenAI
4. Rebuild UI state from thread history

---

## Critical Code References

### Frontend: `app/v2/agents/new/page.tsx`

| Function | ~Line | Purpose |
|----------|-------|---------|
| `V2AgentBuilderContent` | 273 | Main page component |
| `threadId` state | 312 | Thread ID storage (useState) |
| Init thread useEffect | 454 | Triggers thread creation when ready |
| Auto-enhancement useEffect | 462 | Triggers Phase 3 after questions answered |
| Question display useEffect | 504 | Shows current question to user |
| `initializeThread()` | 519 | Creates thread and starts Phase 1 |
| `processPhase1()` | 566 | Phase 1: Analysis |
| `processPhase2()` | 625 | Phase 2: Questions (supports mini-cycle) |
| `processPhase3()` | 701 | Phase 3: Enhancement (OAuth gate, mini-cycle) |
| `handleConnectPlugin()` | 847 | OAuth plugin connection |
| `handleSkipPlugin()` | 898 | Decline plugin and re-run Phase 3 |
| `createAgent()` | 961 | Generate agent via V6 or V4 pipeline |
| `executeAgentCreation()` | 1216 | Save agent via /api/create-agent |
| `handleSend()` | 1298 | Handle user input (answers, feedback) |
| `handleApprove()` | 1411 | Approve plan and create agent |
| `handleEdit()` | 1431 | V10: Start edit flow with feedback |

### Backend: `app/api/agent-creation/`

| Route | Purpose |
|-------|---------|
| `init-thread/route.ts` | Creates OpenAI thread with v14 system prompt |
| `process-message/route.ts` | Handles Phases 1-4 message processing |
| `thread/[id]/route.ts` | Resume existing thread with full history |

### Agent Generation APIs

| Route | Pipeline | Called When |
|-------|----------|------------|
| `/api/v6/generate-ir-semantic` | V6 5-phase semantic pipeline | `useV6AgentGeneration()` enabled |
| `/api/generate-agent-v4` | V4 OpenAI 3-stage generation | `useV6AgentGeneration()` disabled |

### Validation: `lib/validation/`

| File | Purpose |
|------|---------|
| `phase3-schema.ts` | Zod validation for Phase 3 responses |
| `phase4-schema.ts` | Zod validation for Phase 4 responses |

---

## Token Savings Explained

### Legacy Flow (4 API calls):
```
Call 1: System prompt (10k tokens) + User prompt → Analysis
Call 2: System prompt (10k tokens) + User prompt → Questions
Call 3: System prompt (10k tokens) + User prompt + Answers → Enhancement
Call 4: System prompt (10k tokens) + Enhanced prompt → Generate Agent

Total: 40k tokens for system prompt alone!
```

### Thread-Based Flow (1 init + 3 process calls):
```
Call 1 (init-thread): System prompt (10k tokens) → Cached
Call 2 (phase 1): [System prompt CACHED] + User prompt → Analysis
Call 3 (phase 2): [System prompt CACHED] + Full history → Questions
Call 4 (phase 3): [System prompt CACHED] + Full history + Answers → Enhancement

Total: 10k tokens for system prompt (cached 3 times)
Savings: 30k tokens = 75% reduction on system prompt
Overall savings: ~36% across entire flow
```

---

## Testing Checklist

To simulate the flow yourself:

1. Start dev server (`npm run dev`)
2. Navigate to `/v2/agents/new?prompt=help%20with%20emails`
3. Check console logs for "V2 Agent Builder initialized with IDs"
4. Verify Network tab shows:
   - `POST /api/agent-creation/init-thread`
   - `POST /api/agent-creation/process-message` (phase 1)
   - `POST /api/agent-creation/process-message` (phase 2)
   - `POST /api/agent-creation/process-message` (phase 3)
5. Check Supabase `agent_prompt_threads` table for new row
6. Answer questions and verify Phase 3 triggers automatically
7. Test "Need changes" button → Should trigger Phase 2 with user_feedback
8. Test OAuth gate: Use prompt requiring unconnected plugin → Should show connect cards
9. Test "Yes, perfect!" → Should call V6 or V4 generation, then create-agent
10. Verify agent is created and redirects to `/agents/{id}`

### V10 Mini-Cycle Testing:
- Create prompt that requires user_inputs_required (e.g., specific email addresses)
- Verify Phase 2 re-triggers with targeted questions
- Answer mini-cycle questions
- Verify Phase 3 re-runs with resolved_user_inputs

### V10 Edit Flow Testing:
- Click "Need changes" on plan card
- Type feedback (e.g., "Also send to Teams")
- Verify Phase 2 called with user_feedback parameter
- Verify updated plan reflects feedback

---

## Error Handling

```
Try-Catch Boundaries:
├─ initializeThread() → Catches thread creation errors
│  └─ Shows "Error initializing conversation" message
│
├─ processPhase1/2/3() → Each phase has own error handling
│  ├─ HTTP error → Logs detailed error, shows user message
│  └─ Thread expired (410) → User must start new session
│
├─ handleConnectPlugin() → OAuth flow errors
│  └─ Shows "Failed to connect {plugin}" message
│
├─ createAgent() → Agent generation errors (V6 or V4)
│  └─ Shows "Error creating agent: {message}"
│
└─ executeAgentCreation() → Database save errors
   └─ Shows "Error creating agent: {message}"
```

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-04-01 | Updated for V6 pipeline + accurate line refs | Documented V6/V4 branching in agent generation, updated system prompt to v14, fixed all line number references, added `ai_provider`/`ai_model` to thread schema, added agent generation APIs table |
| 2026-01-16 | Initial document | Original thread-based flow diagram with Phases 1-4 |
