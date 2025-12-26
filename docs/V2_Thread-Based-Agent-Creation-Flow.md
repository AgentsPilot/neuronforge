# Thread-Based Agent Creation Flow Diagram

## Overview
This diagram shows the complete user journey through the V2 agent creation page (`app/v2/agents/new/page.tsx`).

> **Note**: The legacy `useConversationalBuilder.ts` hook is no longer used. The V2 page implements the thread-based flow directly without a feature flag - it is always enabled.

---

## 🎯 Main Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         USER STARTS                                 │
│            (Navigates to /v2/agents/new?prompt=...)                 │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  useEffect Hook (page.tsx lines 208-213)                            │
│  ─────────────────────────────────────                              │
│  • Checks: user && initialPrompt && !threadId && aiConfigLoaded     │
│  • Calls: initializeThread()                                        │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  initializeThread() - THREAD CREATION (lines 260-304)               │
│  ─────────────────────────────────────────────────────────────────  │
│                                                                     │
│  STEP 1: Initialize Thread                                          │
│  ─────────────────────────────                                      │
│  • Adds user's original prompt to chat                              │
│  • Shows typing indicator                                           │
│    │                                                                │
│    ├─► POST /api/agent-creation/init-thread                         │
│    │   • Creates OpenAI thread                                      │
│    │   • Injects system prompt (Workflow-Agent-Creation-Prompt-v14) │
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
│  STEP 2: Phase 1 - Analyze Prompt (processPhase1, lines 307-363)    │
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
│  STEP 3: Phase 2 - Generate Questions (processPhase2, lines 366-439)│
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
│  • Questions displayed via useEffect (lines 245-255)                │
│                                                                     │
│  If questions.length === 0:                                         │
│  • Skip to Phase 3 directly                                         │
│                                                                     │
└──────────────────┬──────────────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│         UI RENDERS QUESTIONS                                        │
│         (User answers via handleSend, lines 902-1012)               │
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
│  Auto-Enhancement Trigger (useEffect, lines 216-241)                │
│  ─────────────────────────────────────────                          │
│  When all questions answered && workflowPhase === 'enhancement':    │
│                                                                     │
│  • Shows typing indicator                                           │
│  • Calls processPhase3()                                            │
│  • V10: If isInMiniCycle, passes pendingEnhancedPrompt              │
│                                                                     │
└────────────────────────────────────────┬────────────────────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Phase 3 - Enhancement (processPhase3, lines 442-580)               │
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
│    │   • ✅ VALIDATES response with Zod schema (strict!)            │
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
│  OAuth Gate Check (lines 499-510):                                  │
│  if (missingPlugins.length > 0) → Show plugin connect cards         │
│                                                                     │
│  V10 Mini-Cycle Check (lines 513-533):                              │
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
    │  (lines 1015-1032)      │    │  (lines 1036-1056)          │
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
│  Agent Generation (createAgent, lines 668-815)                      │
│  ─────────────────────────────────────────────────────────────────  │
│                                                                     │
│  1. Call POST /api/generate-agent-v4 (OpenAI 3-Stage Generation)    │
│     • Passes enhancedPromptData, services_involved                  │
│     • Returns generated agent config with steps                     │
│                                                                     │
│  2. Check for required input parameters                             │
│     • If any required, start input parameter flow                   │
│     • Otherwise, proceed to scheduling                              │
│                                                                     │
│  3. Scheduling flow (isAwaitingSchedule)                            │
│     • User selects: On Demand / Scheduled                           │
│     • Configure cron expression if scheduled                        │
│                                                                     │
│  4. Call executeAgentCreation() (lines 821-897)                     │
│     • POST /api/create-agent with agent data                        │
│     • Links thread to agent (thread_id passed)                      │
│     • Redirect to /agents/{id}                                      │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  ⚠️ Phase 4 - Technical Workflow Generation (NOT WIRED IN FRONTEND) │
│  ─────────────────────────────────────────────────────────────────  │
│                                                                     │
│  NOTE: Phase 4 backend support exists in process-message route,     │
│  but the V2 frontend does NOT call it. After Phase 3, the flow     │
│  goes directly to /api/generate-agent-v4 for agent generation.      │
│                                                                     │
│  To enable Phase 4, frontend would need to:                         │
│  1. Add processPhase4() function                                    │
│  2. Call it after Phase 3 approval                                  │
│  3. Display technical_workflow steps                                │
│  4. Collect technical_inputs_required values                        │
│                                                                     │
│  Backend Phase 4 Request (if wired):                                                                  │
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
│    │   • Calls GPT-4o to compile functional spec → technical steps  │
│    │   • ✅ VALIDATES response with Phase 4 Zod schema              │
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
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                 ┌───────────────┴───────────────┐
                 │                               │
                 ▼                               ▼
    ┌─────────────────────────┐    ┌─────────────────────────┐
    │  Technical Inputs       │    │  Ready for Execution    │
    │  Required               │    │  (can_execute: true)    │
    │                         │    │                         │
    │  • Collect inputs       │    │  • Pass to agent        │
    │  • Re-run Phase 4       │    │    execution engine     │
    │    with collected data  │    │                         │
    └───────────┬─────────────┘    └───────────┬─────────────┘
                │                              │
                └──────────────┬───────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         FLOW COMPLETE ✅                            │
│                                                                     │
│  Thread persists in DB for 24 hours                                 │
│  (User can resume if they refresh page)                             │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 🔑 Key State Variables Throughout Flow

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

## 🎬 Example User Journey (Standard Flow)

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
9. /api/generate-agent-v4 generates agent config
   ↓
10. Scheduling UI shown (On Demand / Scheduled)
   ↓
11. User selects schedule → executeAgentCreation()
   ↓
12. /api/create-agent saves agent, redirects to /agents/{id}

API Calls: init-thread + process-message × 3 + generate-agent-v4 + create-agent
```

---

## 🎬 Example User Journey (OAuth Gate)

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

## 🎬 Example User Journey (V10 Mini-Cycle)

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

## 🔄 Thread Persistence

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
│  created_at: 2025-10-26T10:00:00Z           │
│  updated_at: 2025-10-26T10:05:23Z           │
│  expires_at: 2025-10-27T10:00:00Z (24h)     │
│  metadata: {                                │
│    last_phase: 3,                           │
│    last_updated: "...",                     │
│    iterations: [...],  ← Full audit trail   │
│    phase1_connected_services: [...],        │
│    phase1_available_services: [...],        │
│    last_phase3_response: {...}  ← v14 cache │
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

## 🎯 Critical Code References

### Frontend: `app/v2/agents/new/page.tsx`

| Function | Lines | Purpose |
|----------|-------|---------|
| `V2AgentBuilderContent` | 45 | Main page component |
| `threadId` state | 77 | Thread ID storage (useState) |
| `initializeThread()` | 260-304 | Creates thread and starts Phase 1 |
| `processPhase1()` | 307-363 | Phase 1: Analysis |
| `processPhase2()` | 366-439 | Phase 2: Questions (supports mini-cycle) |
| `processPhase3()` | 442-580 | Phase 3: Enhancement (OAuth gate, mini-cycle) |
| `handleConnectPlugin()` | 588-633 | OAuth plugin connection |
| `handleSkipPlugin()` | 639-660 | Decline plugin and re-run Phase 3 |
| `createAgent()` | 668-815 | Generate agent via /api/generate-agent-v4 |
| `executeAgentCreation()` | 821-897 | Save agent via /api/create-agent |
| `handleSend()` | 902-1012 | Handle user input (answers, feedback) |
| `handleApprove()` | 1015-1032 | Approve plan and create agent |
| `handleEdit()` | 1036-1056 | V10: Start edit flow with feedback |
| Auto-enhancement useEffect | 216-241 | Triggers Phase 3 after questions answered |
| Question display useEffect | 245-255 | Shows current question to user |

### Backend: `app/api/agent-creation/`

| Route | Purpose |
|-------|---------|
| `init-thread/route.ts` | Creates OpenAI thread with system prompt |
| `process-message/route.ts` | Handles Phases 1-4 message processing |

### Validation: `lib/validation/`

| File | Purpose |
|------|---------|
| `phase3-schema.ts` | Zod validation for Phase 3 responses |
| `phase4-schema.ts` | Zod validation for Phase 4 responses |

---

## 💡 Token Savings Explained

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
Call 1 (init-thread): System prompt (10k tokens) → Cached ✅
Call 2 (phase 1): [System prompt CACHED] + User prompt → Analysis
Call 3 (phase 2): [System prompt CACHED] + Full history → Questions
Call 4 (phase 3): [System prompt CACHED] + Full history + Answers → Enhancement

Total: 10k tokens for system prompt (cached 3 times)
Savings: 30k tokens = 75% reduction on system prompt
Overall savings: ~36% across entire flow
```

---

## 🧪 Testing Checklist

To simulate the flow yourself:

1. ✅ Start dev server (`npm run dev`)
2. ✅ Navigate to `/v2/agents/new?prompt=help%20with%20emails`
3. ✅ Check console logs for "🆔 V2 Agent Builder initialized with IDs"
4. ✅ Verify Network tab shows:
   - `POST /api/agent-creation/init-thread`
   - `POST /api/agent-creation/process-message` (phase 1)
   - `POST /api/agent-creation/process-message` (phase 2)
   - `POST /api/agent-creation/process-message` (phase 3)
5. ✅ Check Supabase `agent_prompt_threads` table for new row
6. ✅ Answer questions and verify Phase 3 triggers automatically
7. ✅ Test "Need changes" button → Should trigger Phase 2 with user_feedback
8. ✅ Test OAuth gate: Use prompt requiring unconnected plugin → Should show connect cards
9. ✅ Test "Yes, perfect!" → Should call generate-agent-v4, then create-agent
10. ✅ Verify agent is created and redirects to `/agents/{id}`

### V10 Mini-Cycle Testing:
- ✅ Create prompt that requires user_inputs_required (e.g., specific email addresses)
- ✅ Verify Phase 2 re-triggers with targeted questions
- ✅ Answer mini-cycle questions
- ✅ Verify Phase 3 re-runs with resolved_user_inputs

### V10 Edit Flow Testing:
- ✅ Click "Need changes" on plan card
- ✅ Type feedback (e.g., "Also send to Teams")
- ✅ Verify Phase 2 called with user_feedback parameter
- ✅ Verify updated plan reflects feedback

---

## 🚨 Error Handling

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
├─ createAgent() → Agent generation errors
│  └─ Shows "Error creating agent: {message}"
│
└─ executeAgentCreation() → Database save errors
   └─ Shows "Error creating agent: {message}"
```

---

## 🔒 Phase 3 Strict Validation (NEW)

### Overview
Phase 3 responses are now **strictly validated** using Zod schemas to ensure the LLM returns well-formed, type-safe JSON.

### Validation Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Phase 3 Response Flow with Validation                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. GPT-4o generates JSON response                          │
│     ↓                                                       │
│  2. Backend parses JSON                                     │
│     ↓                                                       │
│  3. ✅ Zod Schema Validation (lib/validation/phase3-schema.ts) │
│     │                                                       │
│     ├─ ✅ Valid → Continue                                  │
│     │                                                       │
│     └─ ❌ Invalid → Return 500 error with details           │
│        Example: "enhanced_prompt.sections.data: Expected   │
│                  array, received string"                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Validated Schema Structure

**File:** `lib/validation/phase3-schema.ts`

```typescript
Phase3ResponseSchema = {
  analysis: {
    data: { status: 'clear'|'partial'|'missing', confidence: 0-1, detected: string },
    actions: { ... },
    output: { ... },
    delivery: { ... },
    trigger?: { ... },              // ✅ OPTIONAL in Phase 3
    error_handling?: { ... }        // ✅ OPTIONAL in Phase 3
  },
  requiredServices: string[],
  missingPlugins: string[],
  pluginWarning: Record<string, string>,
  clarityScore: number (0-100),
  enhanced_prompt: {
    plan_title: string,
    plan_description: string,
    sections: {
      data: string[],              // ✅ Array of bullet points (not string!)
      actions: string[],           // ✅ Array of bullet points
      output: string[],            // ✅ Array of bullet points
      delivery: string[],          // ✅ Array of bullet points
      processing_steps?: string[]  // ✅ Optional (v7 compatibility)
    },
    specifics: {
      services_involved: string[],
      user_inputs_required: string[]
    }
  },
  metadata: {
    all_clarifications_applied: boolean,
    ready_for_generation: boolean,  // ✅ Lives HERE (not at top-level!)
    confirmation_needed: boolean,
    implicit_services_detected: string[],
    provenance_checked: boolean,
    // ... 7 more strictly-typed optional fields
    // ❌ NO [key: string]: any escape hatch!
  },
  conversationalSummary: string
  // ❌ ready_for_generation REMOVED from top-level (only in metadata!)
}
```

### Key Changes from Legacy

| Aspect | Before (v8 and earlier) | After (v9 with validation) |
|--------|-------------------------|----------------------------|
| **Validation** | ❌ None (any JSON accepted) | ✅ Strict Zod validation |
| **Sections Type** | `string` (single text) | `string[]` (array of bullets) |
| **Metadata** | Allows `[key: string]: any` | Strictly typed, no arbitrary keys |
| **Error Detection** | Silent failures | Clear validation errors with field paths |
| **Type Safety** | TypeScript only (compile-time) | TypeScript + Zod (runtime) |
| **processing_steps** | Not supported in v8 | ✅ Supported (optional, v7 compat) |
| **trigger/error_handling** | Required | ✅ Optional in Phase 3 (v9.1) |
| **ready_for_generation** | Both top-level & metadata | ✅ Only in metadata (v9.1) |

### Benefits

1. **Runtime Type Safety** - Catches malformed LLM responses before they reach the frontend
2. **Clear Error Messages** - When validation fails, you get exact field paths:
   ```
   enhanced_prompt.sections.actions: Expected array, received string
   metadata.all_clarifications_applied: Required
   ```
3. **No Silent Failures** - Any deviation from schema returns 500 with details
4. **Backward Compatible** - Phase 1 & 2 still use loose validation
5. **v7 Compatibility** - Supports optional `processing_steps` field

### Implementation Files

- **V2 Page:** [app/v2/agents/new/page.tsx](../app/v2/agents/new/page.tsx)
- **Init Thread API:** [app/api/agent-creation/init-thread/route.ts](../app/api/agent-creation/init-thread/route.ts)
- **Process Message API:** [app/api/agent-creation/process-message/route.ts](../app/api/agent-creation/process-message/route.ts)
- **Phase 3 Schema:** [lib/validation/phase3-schema.ts](../lib/validation/phase3-schema.ts)
- **Phase 4 Schema:** [lib/validation/phase4-schema.ts](../lib/validation/phase4-schema.ts)
- **TypeScript Types:** [components/agent-creation/types/agent-prompt-threads.ts](../components/agent-creation/types/agent-prompt-threads.ts)
- **LLM Prompt:** [app/api/prompt-templates/Workflow-Agent-Creation-Prompt-v14-chatgpt.txt](../app/api/prompt-templates/Workflow-Agent-Creation-Prompt-v14-chatgpt.txt)

### Testing Validation

To test the validation:

1. **Valid Response** - Normal Phase 3 flow should work seamlessly
2. **Invalid Response** - Modify LLM prompt to return wrong types:
   ```json
   {
     "sections": {
       "data": "string instead of array"  // ❌ Will fail validation
     }
   }
   ```
3. **Check Logs** - Look for:
   ```
   🔍 Validating Phase 3 response structure...
   ✅ Phase 3 response validated successfully
   ```
   OR
   ```
   ❌ Phase 3 response validation failed: enhanced_prompt.sections.data: Expected array, received string
   ```

---

---

## 🆕 V10 Enhancements

### Overview
V10 introduces significant improvements to the thread-based flow:
- **Mini-Cycle Mode**: Automatic refinement when Phase 3 needs more inputs
- **Edit Flow**: User feedback loop for plan modifications
- **Resolved User Inputs**: Tracking of previously required inputs now resolved
- **Declined Services**: Top-level field for services user refuses to connect

---

### V10 Data Flow Changes

#### New Request Fields

| Field | Phase | Description |
|-------|-------|-------------|
| `declined_services` | 2, 3 | Services user explicitly refused to connect (top-level, not in metadata) |
| `user_feedback` | 2 | Free-form user feedback for plan refinement |
| `enhanced_prompt` | 2 | Enhanced prompt object for mini-cycle refinement |

#### New Response Fields

| Field | Phase | Description |
|-------|-------|-------------|
| `resolved_user_inputs` | 3 | Array of `{key, value}` pairs for resolved inputs |
| `user_inputs_required` | 3 | Non-empty array triggers mini-cycle |

---

### Mini-Cycle Flow (V10)

```
┌─────────────────────────────────────────────────────────────────────┐
│  PHASE 3 RETURNS WITH user_inputs_required.length > 0              │
│  ─────────────────────────────────────────────────────────────────  │
│                                                                     │
│  Example response:                                                  │
│  {                                                                  │
│    "enhanced_prompt": {                                             │
│      "plan_title": "Email Summary Agent",                           │
│      "specifics": {                                                 │
│        "user_inputs_required": ["accountant_email", "report_day"],  │ ← Triggers mini-cycle
│        "resolved_user_inputs": []                                   │
│      }                                                              │
│    }                                                                │
│  }                                                                  │
│                                                                     │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  FRONTEND DETECTS MINI-CYCLE                                        │
│  ─────────────────────────────────────────────────                  │
│  if (user_inputs_required.length > 0 && !isInMiniCycle) {           │
│    setIsInMiniCycle(true)                                           │
│    setPendingEnhancedPrompt(enhanced_prompt)                        │
│    addAIMessage("I need a few more details...")                     │
│    processPhase2(threadId, { enhanced_prompt })                     │
│  }                                                                  │
│                                                                     │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  PHASE 2 RE-CALLED WITH enhanced_prompt                             │
│  ─────────────────────────────────────────────────────────────────  │
│  POST /api/agent-creation/process-message                           │
│  Body: {                                                            │
│    thread_id: "thread_abc123",                                      │
│    phase: 2,                                                        │
│    enhanced_prompt: { /* full enhanced_prompt from Phase 3 */ }     │
│  }                                                                  │
│                                                                     │
│  Returns: 1-4 targeted questions for missing inputs                 │
│                                                                     │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  USER ANSWERS MINI-CYCLE QUESTIONS                                  │
│  ─────────────────────────────────────────────────────────────────  │
│  • Question 1: "What is the accountant's email?"                    │
│    User: "bob@company.com"                                          │
│  • Question 2: "Which day should reports be sent?"                  │
│    User: "Friday"                                                   │
│                                                                     │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  PHASE 3 CALLED AGAIN                                               │
│  ─────────────────────────────────────────────────────────────────  │
│  Returns with resolved inputs:                                      │
│  {                                                                  │
│    "enhanced_prompt": {                                             │
│      "specifics": {                                                 │
│        "user_inputs_required": [],  ← Empty = mini-cycle complete   │
│        "resolved_user_inputs": [                                    │
│          { "key": "accountant_email", "value": "bob@company.com" }, │
│          { "key": "report_day", "value": "Friday" }                 │
│        ]                                                            │
│      }                                                              │
│    }                                                                │
│  }                                                                  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

### Edit Flow (V10)

```
┌─────────────────────────────────────────────────────────────────────┐
│  USER CLICKS "Need changes" BUTTON                                  │
│  ─────────────────────────────────────────────────                  │
│  handleEdit() is called:                                            │
│  • addUserMessage("I need to make some changes")                    │
│  • addAIMessage("Sure thing, what changes would you like?")         │
│  • setPendingEnhancedPrompt(enhancedPromptData)                     │
│  • setIsAwaitingFeedback(true)                                      │
│                                                                     │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  USER TYPES FEEDBACK                                                │
│  ─────────────────────────────────────────────────                  │
│  Input: "I want the email to be sent to Slack instead of email"    │
│                                                                     │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  PHASE 2 CALLED WITH user_feedback                                  │
│  ─────────────────────────────────────────────────────────────────  │
│  POST /api/agent-creation/process-message                           │
│  Body: {                                                            │
│    thread_id: "thread_abc123",                                      │
│    phase: 2,                                                        │
│    user_feedback: "I want the email to be sent to Slack...",       │
│    enhanced_prompt: { /* current enhanced_prompt */ }               │
│  }                                                                  │
│                                                                     │
│  Phase 2 may:                                                       │
│  • Ask clarifying questions (if feedback is unclear)                │
│  • Proceed directly to Phase 3 (if feedback is clear)               │
│                                                                     │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  PHASE 3 RETURNS UPDATED PLAN                                       │
│  ─────────────────────────────────────────────────────────────────  │
│  Updated enhanced_prompt reflects user's feedback                   │
│  User reviews and approves or requests more changes                 │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

### Declined Services (V10)

When a user refuses to connect a required service:

```typescript
// Frontend passes declined_services at top-level (not in metadata)
POST /api/agent-creation/process-message
Body: {
  thread_id: "thread_abc123",
  phase: 3,
  declined_services: ["slack", "notion"],  // V10: Top-level field
  clarification_answers: { ... }
}

// Backend includes in AI context
userMessage = {
  phase: 3,
  clarification_answers: { ... },
  declined_services: ["slack", "notion"]  // AI sees declined services
}

// AI may:
// 1. Adjust plan to work without declined services
// 2. Flag declined_plugins_blocking in metadata if critical
// 3. Suggest alternatives
```

---

### V10 State Variables (Frontend)

```typescript
// Mini-cycle state
const [isInMiniCycle, setIsInMiniCycle] = useState(false)
const [pendingEnhancedPrompt, setPendingEnhancedPrompt] = useState<any>(null)

// Edit flow state
const [isAwaitingFeedback, setIsAwaitingFeedback] = useState(false)
```

---

### V10 API Changes

#### ProcessMessageRequest (V10 additions)

```typescript
interface ProcessMessageRequest {
  thread_id: string;
  phase: 1 | 2 | 3;
  user_prompt?: string;
  user_context?: UserContext;
  connected_services?: string[];
  declined_services?: string[];      // V10: Top-level field
  clarification_answers?: Record<string, string>;
  enhanced_prompt?: EnhancedPrompt;  // V10: For mini-cycle
  user_feedback?: string;            // V10: For edit flow
  metadata?: Record<string, any>;
}
```

#### Phase 3 Response (V10 additions)

```typescript
interface Phase3Response {
  // ... existing fields ...
  enhanced_prompt: {
    plan_title: string;
    plan_description: string;
    sections: { ... };
    specifics: {
      services_involved: string[];
      user_inputs_required: string[];       // Empty = ready, Non-empty = mini-cycle
      resolved_user_inputs?: ResolvedUserInput[];  // V10: Resolved values
    }
  }
}

interface ResolvedUserInput {
  key: string;    // e.g., "accountant_email"
  value: string;  // e.g., "bob@company.com"
}
```

---

### V10 Testing Checklist

- [ ] Mini-cycle triggers when `user_inputs_required` is non-empty
- [ ] Mini-cycle Phase 2 receives `enhanced_prompt` context
- [ ] Mini-cycle questions are targeted (1-4 max)
- [ ] `resolved_user_inputs` displays in UI after mini-cycle
- [ ] Edit flow shows AI prompt for feedback
- [ ] Edit flow keeps plan card visible during input
- [ ] User feedback sent with `user_feedback` param
- [ ] `declined_services` passed at top-level (not metadata)
- [ ] AI adjusts plan when services are declined

---

## 🔧 Phase 4 - Technical Workflow Generation (V11)

### Overview
Phase 4 is a "compilation step" that converts the functional specification (Phase 3's `enhanced_prompt`) into an executable technical workflow. It maps each step to real plugin actions with validated parameters.

### When Phase 4 Runs
Phase 4 is triggered only after Phase 3 completes with `ready_for_generation: true`. It is an optional step that can be requested by the user before agent creation.

### Goals
1. **Atomic Action Mapping**: Convert each functional step to specific plugin actions
2. **Real Executability Validation**: Validate each step against actual plugin schemas in `schema_services`
3. **Technical Inputs Extraction**: Identify runtime inputs needed (Sheet IDs, Slack channel IDs, etc.)
4. **Feasibility Assessment**: Provide `can_execute`, `blocking_issues`, and `warnings`

---

### Phase 4 Request/Response Types

#### Request Body

```typescript
interface Phase4Request {
  thread_id: string;
  phase: 4;
  enhanced_prompt: EnhancedPrompt;           // From Phase 3
  schema_services?: SchemaServices;          // Auto-generated if not provided
  technical_inputs_collected?: Record<string, string>;  // For re-runs with collected inputs
  user_feedback?: string;                    // For iterative refinement
}
```

**Note:** `schema_services` is auto-generated on the backend from `enhanced_prompt.specifics.services_involved` using `generateSchemaServices()`. The frontend does not need to provide this.

#### Response Body

```typescript
interface Phase4Response {
  success: boolean;
  phase: 4;

  // Phase 4 specific fields
  technical_workflow: TechnicalWorkflowStep[];
  technical_inputs_required: TechnicalInputRequired[];
  feasibility: Feasibility;

  // Shared fields
  enhanced_prompt: EnhancedPrompt;
  conversationalSummary: string;

  metadata: Phase4Metadata;
}
```

---

### Technical Workflow Step Types

Phase 4 produces a `technical_workflow` array with three step types:

#### 1. Operation Step (Plugin Actions)
```typescript
interface OperationStep {
  id: string;                    // e.g., "step1"
  kind: 'operation';
  description: string;           // Human-readable description
  plugin: string;                // e.g., "google-mail"
  action: string;                // e.g., "searchMessages"
  inputs: Record<string, StepInput>;
  outputs: Record<string, string>;
}
```

#### 2. Transform Step (Data Transformations)
```typescript
interface TransformStep {
  id: string;
  kind: 'transform';
  description: string;
  operation: { type: string };   // e.g., "summarize_with_llm", "filter"
  inputs: Record<string, StepInput>;
  outputs: Record<string, string>;
}
```

#### 3. Control Step (Conditional Logic)
```typescript
interface ControlStep {
  id: string;
  kind: 'control';
  description?: string;
  control: {
    type: string;                // e.g., "if", "loop"
    condition: string;
  };
}
```

---

### Step Input Sources

Each step input specifies its data source:

```typescript
type StepInputSource = 'constant' | 'from_step' | 'user_input' | 'env' | 'plugin_config';

interface StepInput {
  source: StepInputSource;
  value?: any;           // For 'constant' source
  ref?: string;          // For 'from_step' source (e.g., "step1.messages")
  key?: string;          // For 'user_input' source
  plugin?: string;       // Which plugin needs this input
  action?: string;       // Which action consumes this
}
```

---

### Technical Inputs Required

When the workflow needs runtime inputs from the user:

```typescript
interface TechnicalInputRequired {
  key: string;              // Machine-friendly identifier (e.g., "slack_channel_id")
  plugin: string;           // Which plugin needs this input
  actions?: string[];       // Which actions use this input
  type?: string;            // Suggested UI type (string, fileId, folderId)
  description: string;      // Human-friendly description for UI
}
```

---

### Feasibility Assessment

```typescript
interface Feasibility {
  can_execute: boolean;                    // Overall executability
  blocking_issues: BlockingIssue[];        // Critical issues preventing execution
  warnings: FeasibilityWarning[];          // Non-blocking concerns
}

interface BlockingIssue {
  type: string;            // e.g., "missing_plugin", "missing_operation", "unsupported_pattern"
  description: string;     // Human-readable description
}

interface FeasibilityWarning {
  type: string;            // e.g., "assumption", "expensive_operation", "data_shape"
  description: string;
}
```

---

### Phase 4 Metadata

```typescript
interface Phase4Metadata extends Phase3Metadata {
  phase4: {
    can_execute: boolean;
    needs_technical_inputs: boolean;
    needs_user_feedback: boolean;
  };
}
```

---

### Schema Services Generation

The backend auto-generates `schema_services` from `services_involved`:

**File:** `lib/utils/schema-services-generator.ts`

```typescript
// Called automatically by process-message route for Phase 4
const schemaServices = await generateSchemaServices(
  enhancedPrompt.specifics.services_involved  // e.g., ['google-mail', 'slack']
);

// Returns:
{
  "google-mail": {
    name: "google-mail",
    key: "google-mail",
    description: "Send, read, and manage Gmail emails",
    context: "When user wants to...",
    actions: {
      "searchMessages": {
        description: "...",
        usage_context: "...",
        parameters: {...},
        output_schema: {...}
      }
    }
  },
  "slack": {...}
}
```

The generator uses `PluginManagerV2.getPluginsDefinitionContext()` and `toLongLLMContext()` to get full action definitions.

---

### Phase 4 Zod Validation

**File:** `lib/validation/phase4-schema.ts`

Phase 4 responses are strictly validated using a **two-step process** (v14):

```typescript
// v14: Two-schema approach
Phase4LLMResponseSchema     // What LLM returns (slim, Phase 4 fields only)
Phase4ResponseSchema        // Complete response (merged with Phase 3 cache)

// Validated schemas
TechnicalWorkflowStepSchema  // Union of operation, transform, control
TechnicalInputRequiredSchema
FeasibilitySchema
Phase4MetadataSchema
Phase3CachedDataSchema       // v14: Cached Phase 3 fields

// Helper functions
validatePhase4LLMResponse(response)   // v14: Validates slim LLM response
validatePhase4Response(response)      // Validates complete merged response
mergePhase4WithPhase3(llm, cache)     // v14: Merges LLM + cached Phase 3 data
isPhase4ReadyForGeneration(response)  // Checks metadata.ready_for_generation
```

### Phase 4 v14: Reduced Output & Merge Logic

Starting with v14, the LLM returns a **slim Phase 4 response** that excludes Phase 3 fields (analysis, enhanced_prompt, requiredServices, etc.). These are instead cached after Phase 3 and merged on the backend.

**Why?** Token optimization - Phase 3 fields are already computed and don't need to be regenerated.

```
┌─────────────────────────────────────────────────────────────────────┐
│  Phase 3 Completes → Cache Data in Thread Metadata                  │
│  ─────────────────────────────────────────────────────────────────  │
│  thread.metadata.last_phase3_response = {                           │
│    analysis: {...},                                                 │
│    requiredServices: ["google-mail", "slack"],                      │
│    missingPlugins: [],                                              │
│    pluginWarning: {},                                               │
│    clarityScore: 95,                                                │
│    enhanced_prompt: {...}                                           │
│  }                                                                  │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Phase 4 LLM Response (Slim - v14)                                  │
│  ─────────────────────────────────────────────────────────────────  │
│  {                                                                  │
│    // Phase 4 specific fields only                                  │
│    technical_workflow: [...],                                       │
│    technical_inputs_required: [...],                                │
│    feasibility: {...},                                              │
│    metadata: { ready_for_generation: true, phase4: {...} },         │
│    conversationalSummary: "..."                                     │
│    // NO analysis, enhanced_prompt, requiredServices, etc.          │
│  }                                                                  │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Backend Merge (process-message route)                              │
│  ─────────────────────────────────────────────────────────────────  │
│  1. Validate LLM response with Phase4LLMResponseSchema              │
│  2. Retrieve cached Phase 3 data from thread.metadata               │
│  3. Merge: mergePhase4WithPhase3(llmResponse, phase3Cache)          │
│  4. Validate merged result with Phase4ResponseSchema                │
│  5. Return complete response to frontend                            │
└─────────────────────────────────────────────────────────────────────┘
```

**Implementation:** `app/api/agent-creation/process-message/route.ts` (lines 610-691)

---

### Phase 4 Iteration Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│  Phase 3 Complete (ready_for_generation: true)                      │
│  User requests technical workflow                                   │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Phase 4 - Initial Generation                                       │
│  ─────────────────────────────────────────────────────────────────  │
│  • Backend generates schema_services                                │
│  • LLM compiles functional spec → technical_workflow                │
│  • Returns feasibility assessment                                   │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                 ┌───────────────┴───────────────┐
                 │                               │
                 ▼                               ▼
    ┌─────────────────────────┐    ┌─────────────────────────┐
    │  needs_technical_inputs │    │  can_execute: true      │
    │  = true                 │    │  No inputs needed       │
    └───────────┬─────────────┘    └───────────┬─────────────┘
                │                              │
                ▼                              │
┌───────────────────────────────┐              │
│  User Fills Technical Inputs  │              │
│  (text fields for each input) │              │
└───────────┬───────────────────┘              │
            │                                  │
            ▼                                  │
┌───────────────────────────────────────────┐  │
│  Phase 4 Re-run with collected inputs     │  │
│  technical_inputs_collected: {            │  │
│    "slack_channel_id": "C12345",          │  │
│    "sheet_id": "abc123"                   │  │
│  }                                        │  │
└───────────────────────────────────────────┘  │
            │                                  │
            └──────────────┬───────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Ready for Agent Execution                                          │
│  • technical_workflow validated                                     │
│  • All inputs resolved                                              │
│  • Pass to execution engine                                         │
└─────────────────────────────────────────────────────────────────────┘
```

---

### Phase 4 in Thread Metadata

Phase 4 iterations are stored in `metadata.iterations[]` alongside Phases 1-3:

```typescript
metadata: {
  last_phase: 4,
  iterations: [
    { phase: 1, timestamp: "...", request: {...}, response: {...} },
    { phase: 2, timestamp: "...", request: {...}, response: {...} },
    { phase: 3, timestamp: "...", request: {...}, response: {...} },
    { phase: 4, timestamp: "...", request: {...}, response: {...} },  // ← Phase 4
    { phase: 4, timestamp: "...", request: {...}, response: {...} }   // ← Re-run with inputs
  ]
}
```

---

### Implementation Files (Phase 4)

| File | Purpose |
|------|---------|
| [lib/validation/phase4-schema.ts](../lib/validation/phase4-schema.ts) | Phase 4 Zod validation schemas |
| [lib/utils/schema-services-generator.ts](../lib/utils/schema-services-generator.ts) | Generate schema_services from services_involved |
| [app/api/agent-creation/process-message/route.ts](../app/api/agent-creation/process-message/route.ts) | Phase 4 backend handling (lines 337-396) |
| [components/agent-creation/types/agent-prompt-threads.ts](../components/agent-creation/types/agent-prompt-threads.ts) | TypeScript types |
| [app/api/prompt-templates/Workflow-Agent-Creation-Prompt-v14-chatgpt.txt](../app/api/prompt-templates/Workflow-Agent-Creation-Prompt-v14-chatgpt.txt) | LLM prompt with Phase 4 instructions |

---

### Phase 4 Testing Checklist

> **Note**: Phase 4 is NOT wired in the V2 frontend. These tests require manual API calls or future frontend implementation.

- [ ] Phase 4 only triggers after Phase 3 `ready_for_generation: true`
- [ ] schema_services generated from `services_involved`
- [ ] technical_workflow contains valid step types (operation, transform, control)
- [ ] Each operation step references valid plugin/action from schema_services
- [ ] technical_inputs_required identifies missing runtime inputs
- [ ] feasibility.can_execute reflects actual executability
- [ ] blocking_issues populated when critical issues found
- [ ] warnings populated for non-blocking concerns
- [ ] Phase 4 iteration saved to metadata.iterations[]
- [ ] Re-run with technical_inputs_collected updates workflow
- [ ] Phase 4 metadata.phase4 fields populated correctly

---

## 📝 Iterations Audit Trail (V11)

### Overview
Each phase iteration now stores the full request and response in `metadata.iterations[]`, providing a complete audit trail of the conversation including mini-cycles.

### Data Structure

```typescript
metadata: {
  last_phase: 3,
  last_updated: "2025-12-05T13:12:36.963Z",
  iterations: [
    {
      phase: 1,
      timestamp: "2025-12-05T13:06:54.221Z",
      request: {
        phase: 1,
        user_prompt: "share with my mail a summary...",
        user_context: { full_name, email, ... },
        connected_services: ["google-mail", "slack", ...],
        available_services: [...]
      },
      response: {
        success: true,
        workflow_draft: [...],
        analysis: {...},
        clarityScore: 75,
        requiredServices: ["chatgpt-research", "google-mail"],
        missingPlugins: [],
        conversationalSummary: "..."
      }
    },
    {
      phase: 2,
      timestamp: "2025-12-05T13:07:01.728Z",
      request: {
        phase: 2,
        connected_services: [...],
        user_feedback: null,
        enhanced_prompt: null,
        declined_services: []
      },
      response: {
        success: true,
        questionsSequence: [
          { id: "q1", question: "...", type: "text", theme: "Inputs" },
          ...
        ]
      }
    },
    {
      phase: 3,
      timestamp: "2025-12-05T13:12:36.963Z",
      request: {
        phase: 3,
        clarification_answers: { q1: "...", q2: "..." },
        connected_services: [...],
        declined_services: []
      },
      response: {
        success: true,
        enhanced_prompt: {
          plan_title: "...",
          plan_description: "...",
          sections: { data: [...], actions: [...], ... },
          specifics: { services_involved: [...], ... }
        },
        metadata: { ready_for_generation: true, ... }
      }
    }
  ],
  phase1_connected_services: [...],
  phase1_available_services: [...]
}
```

### Mini-Cycle Support

When a phase runs multiple times (mini-cycles), each iteration is appended:

```
iterations: [
  { phase: 1, ... },
  { phase: 2, ... },
  { phase: 2, ... },  // Mini-cycle iteration
  { phase: 2, ... },  // Another refinement
  { phase: 3, ... }
]
```

### Implementation

**File:** [app/api/agent-creation/process-message/route.ts:499-520](../app/api/agent-creation/process-message/route.ts#L499-L520)

```typescript
const iterationRecord = {
  phase,
  timestamp: new Date().toISOString(),
  request: userMessage,
  response: aiResponse
};

const updatedMetadata = {
  ...threadRecord.metadata,
  last_phase: phase,
  last_updated: new Date().toISOString(),
  iterations: [
    ...(threadRecord.metadata?.iterations || []),
    iterationRecord
  ],
  // Phase 1 context for fallback
  ...(phase === 1 && {
    phase1_connected_services: user_connected_services,
    phase1_available_services: user_available_services
  })
};
```

---

## 🔗 Agent-Thread Linking (V11)

### Overview
When an agent is created via `/api/create-agent`, the thread record is updated with the `agent_id`, linking the conversation history to the created agent.

### Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│  init-thread                                                        │
│  Returns: { thread_id: "thread_abc123" }  ← OpenAI thread ID        │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Phase 1-3 (process-message)                                        │
│  • iterations saved to thread metadata                              │
│  • ready_for_generation: true                                       │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  generate-agent-v3                                                  │
│  Returns: { agent: {...}, agentId: "uuid" }  ← Generated config     │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  create-agent (with thread_id)                                      │
│  ─────────────────────────────────────────────────────────────────  │
│  1. Saves agent to `agents` table                                   │
│  2. Looks up thread by OpenAI thread ID                             │
│  3. Updates thread: agent_id = data.id, status = 'completed'        │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Thread now linked to agent                                         │
│  agent_prompt_threads.agent_id = agents.id                          │
└─────────────────────────────────────────────────────────────────────┘
```

### Frontend Integration

**File:** [app/v2/agents/new/page.tsx:793-798](../app/v2/agents/new/page.tsx#L793-L798)

```typescript
const createRes = await fetch('/api/create-agent', {
  method: 'POST',
  headers: { ... },
  body: JSON.stringify({
    agent: agentData,
    sessionId: sessionId.current,
    agentId: agentId.current,
    thread_id: threadId  // ← OpenAI thread ID passed to backend
  })
})
```

### Backend Implementation

**File:** [app/api/create-agent/route.ts:251-272](../app/api/create-agent/route.ts#L251-L272)

```typescript
// 🔗 Link agent to thread if thread_id (OpenAI thread ID) provided
if (thread_id) {
  try {
    const threadRepository = getAgentPromptThreadRepository();

    // Look up the internal DB record by OpenAI thread ID
    const threadRecord = await threadRepository.getThreadByOpenAIId(
      thread_id,
      agentUserIdToUse
    );

    if (threadRecord) {
      await threadRepository.updateThread(threadRecord.id, {
        agent_id: data.id,
        status: 'completed'
      });
      console.log('🔗 Linked agent to thread:', {
        agentId: data.id,
        thread_id,
        dbRecordId: threadRecord.id
      });
    }
  } catch (linkError: any) {
    console.warn('⚠️ Failed to link agent to thread (non-critical):', linkError.message);
  }
}
```

### Benefits

1. **Traceability**: Every agent can be traced back to its creation conversation
2. **Audit Trail**: Full iterations history available for debugging
3. **Analytics**: Track which prompts lead to successful agents
4. **Resume Support**: Thread can be resumed to modify the agent

---

## 📚 Related Documentation

- **Main Flow:** You are here
- **Phase 3 Schema Details:** [PHASE3_SCHEMA_VALIDATION.md](PHASE3_SCHEMA_VALIDATION.md)
- **V2 Implementation:** [V2_AGENT_CREATION_AND_SAVE_IMPLEMENTATION.md](V2_AGENT_CREATION_AND_SAVE_IMPLEMENTATION.md)
- **UI Components:** [V2_CONVERSATIONAL_UI_NEW_COMPLETE.md](V2_CONVERSATIONAL_UI_NEW_COMPLETE.md)

---

**Document Version**: 6.0
**Last Updated**: 2025-12-25 (Updated for v14 prompt, Phase 4 reduced output & merge logic)
**Author**: Development Team

### Changelog
- **v6.0** (2025-12-25): Updated for v14 prompt, added Phase 4 reduced output & merge logic documentation, added `last_phase3_response` to thread metadata
- **v5.0** (2025-12-23): Rewrote for `app/v2/agents/new/page.tsx` flow, updated all code references, added Phase 4 NOT WIRED note
- **v4.0** (2025-12-12): Added Phase 4: Technical Workflow Generation
- **v3.0** (2025-12-05): Added V10/V11 enhancements (mini-cycle, edit flow, iterations audit trail)

