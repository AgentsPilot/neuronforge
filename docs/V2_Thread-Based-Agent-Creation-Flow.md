# Thread-Based Agent Creation Flow Diagram

> **Last Updated**: 2026-06-01

## Overview
This diagram shows the complete user journey through the V2 agent creation page (`app/v2/agents/new/page.tsx`).

> **Note**: The legacy `useConversationalBuilder.ts` hook, `ConversationalAgentBuilder*` components, and `/agents/new/chat` route are **deprecated** (marked `@deprecated`) and are not part of the active flow. The V2 page implements the thread-based flow directly without a feature flag — it is always enabled.

> **Phase 2 is now SINGLE-QUESTION (2026-05-29).** The page no longer renders a batch `questionsSequence: [...]` — each Phase 2 round-trip returns exactly ONE question (or `phase2_done: true`), and the page renders one question at a time until the loop terminates. The contract, controller, telemetry, and UX described below all reflect that. See `app/api/prompt-templates/Workflow-Agent-Creation-Prompt-v16-chatgpt.txt` (the active prompt — v16) and `lib/validation/phase2-schema.ts` for the authoritative shape.

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
│    │   • Injects system prompt (Workflow-Agent-Creation-Prompt-v16)  │
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
│  STEP 3: Phase 2 - SINGLE-QUESTION LOOP (processPhase2)             │
│  ─────────────────────────────────────────────────────────────────  │
│                                                                     │
│  NOTE: V2 flow ALWAYS runs Phase 2 (no clarity-score skip).         │
│        ONE round-trip per question; the loop terminates when the    │
│        LLM emits phase2_done: true (or the cap fires server-side).  │
│                                                                     │
│  ┌─ FIRST TURN (no answer yet) ───────────────────────────────────┐ │
│  │ POST /api/agent-creation/process-message                       │ │
│  │ Body: {                                                        │ │
│  │   thread_id, phase: 2,                                         │ │
│  │   phase2_user_answer: null,        ← signals first-turn        │ │
│  │   enhanced_prompt: null,           ← for mini-cycle start      │ │
│  │   user_feedback: null,             ← for edit flow             │ │
│  │   declined_services: [],                                       │ │
│  │   connected_services, plugin_action_summary  (heavy, see E1)   │ │
│  │ }                                                              │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌─ MID-LOOP TURNS (one answer per turn) ─────────────────────────┐ │
│  │ POST /api/agent-creation/process-message                       │ │
│  │ Body: {                                                        │ │
│  │   thread_id, phase: 2,                                         │ │
│  │   phase2_user_answer: "<the user's reply>",                    │ │
│  │   // E1: connected_services + plugin_action_summary OMITTED    │ │
│  │   //     on mid-loop turns (thread already has them).          │ │
│  │ }                                                              │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  ┌─ RESPONSE SHAPE — strict (FR4, .strict() Zod) ─────────────────┐ │
│  │ {                                                              │ │
│  │   question: {                                                  │ │
│  │     id: "q1",                  ← UNIQUE across the whole       │ │
│  │     question: "Which ...?",       thread (E5 hard rule)        │ │
│  │     type: "select" | "multi_select" | "text",                  │ │
│  │     options?: [{ value, label, description? }],                │ │
│  │     allowCustom?: true,                                        │ │
│  │     theme?: "Inputs"|"Processing"|"Outputs"|"Delivery"         │ │
│  │   } | null,                    ← null iff phase2_done is true  │ │
│  │   phase2_done: false,                                          │ │
│  │   ai_reasoning?: "<1–3 sentences explaining this turn's        │ │
│  │                    decision>"  ← E6: server-side telemetry,    │ │
│  │                                   STRIPPED from the response   │ │
│  │                                   that's actually returned     │ │
│  │                                   to the page.                 │ │
│  │ }                                                              │ │
│  │                                                                │ │
│  │ Terminal turn (loop end): { question: null, phase2_done: true, │ │
│  │                             disclosure_banner?, termination_   │ │
│  │                             reason: "phase2_done"|"cap_hit" }  │ │
│  └────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│  Server-side cap (FR5.12 / C1): up to MAX_ITERATIONS=10 questions   │
│  PER SESSION (mini-cycles get a fresh budget per F2). The cap fires │
│  PRE-CALL — once 10 questions have been asked, the 11th turn        │
│  short-circuits without an LLM call. The cap is NEVER mentioned to  │
│  the LLM or user; cap_hit surfaces only via the soft disclosure     │
│  banner.                                                            │
│                                                                     │
└──────────────────┬──────────────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│         UI RENDERS THE QUESTION (one per turn)                      │
│                                                                     │
│  • First Phase 2 question of the initial session is preceded by a   │
│    client-side OPENING MESSAGE: "I need a few quick details before  │
│    I can build your agent." (E3, resolves T2 contract gap.)         │
│  • Q2+ are preceded by a client-side HINT (Bot bubble lead-in) from │
│    the `clarification_hints` thinking-words category, shuffled per  │
│    session so no two are the same.                                  │
│  • Each question carries a thread-wide running "Question N" pill    │
│    (E4: numerator only — never "of M"; continues across mini-cycles)│
│  • User selects an option (select/multi_select) or types a text     │
│    answer; `submitPhase2Answer` keys the value by `question.id`     │
│    (F1: into the staleness-proof `clarificationAnswersRef` AND      │
│    setBuilderState in the same call) and round-trips it back as     │
│    `phase2_user_answer`. Server responds with the NEXT question or  │
│    `phase2_done: true`.                                             │
│                                                                     │
└──────────────────┬──────────────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Loop-end transition                                                │
│  ─────────────────────────                                          │
│  When the most recent /process-message response has                 │
│  `phase2_done: true`:                                               │
│                                                                     │
│  • Surface `disclosure_banner` if present (cap_hit termination).    │
│  • Mini-cycle? (i.e. enhanced_prompt was pending)                   │
│      → processPhase3(tid, { enhanced_prompt: pendingEnhancedPrompt })│
│        ⇒ refines the existing plan.                                 │
│  • Initial session?                                                 │
│      → processPhase3(tid) ⇒ builds the plan from scratch.           │
│                                                                     │
└────────────────────────────────────┬────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Phase 3 - Enhancement (processPhase3)                              │
│  ─────────────────────────────────────────────────────────────────  │
│                                                                     │
│    ├─► POST /api/agent-creation/process-message                     │
│    │   Body: {                                                      │
│    │     thread_id: "thread_abc123",                                │
│    │     phase: 3,                                                  │
│    │     clarification_answers: { q1: "#general", q2: "9am" },      │
│    │     declined_services: [],                                     │
│    │     enhanced_prompt: null,  // V10: for refinement             │
│    │     // E7: connected_services + plugin_action_summary OMITTED  │
│    │     //     when the connected_services_signature matches the   │
│    │     //     one persisted in thread metadata (most mini-cycle   │
│    │     //     Phase 3 turns). SENT when sig differs (initial,    │
│    │     //     post-OAuth, post-decline). ~1k–3k tokens saved per │
│    │     //     match.                                              │
│    │   }                                                            │
│    │                                                                │
│    │   Backend Processing:                                          │
│    │   • Adds user message + clarification answers to thread        │
│    │   • Retrieves FULL thread history                              │
│    │   • Calls AI provider with conversation context                │
│    │   • Validates response with strict Zod schema (phase3-schema). │
│    │   • F3 normalizer absorbs LLM quirks on                        │
│    │     resolved_user_inputs[*].value before validation: array→    │
│    │     comma-string, null/undefined→drop row, boolean→'true'/    │
│    │     'false', non-array object→JSON.stringify.                  │
│    │   • E2 / F3 corrective retry: on validation failure, ONE       │
│    │     retry with a corrective user-turn appended:                │
│    │       - looksLikePhase2: true  → "your previous reply was a    │
│    │         Phase 2 single-question payload; emit Phase 3 now"     │
│    │       - looksLikePhase2: false → "your previous reply failed   │
│    │         schema validation at: <errors>" (interpolated paths)   │
│    │     The corrective user turn AND the good reply are persisted  │
│    │     to the thread to keep the message sequence well-formed.    │
│    │   • Stores AI response in thread.                              │
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
│  Agent Generation (createAgent)                                     │
│  ─────────────────────────────────────────────────────────────────  │
│                                                                     │
│  Checks feature flag: useV6AgentGeneration()                        │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  V6 FLOW (flag enabled) — IntentContract Pipeline (Pipeline A)│  │
│  │  ─────────────────────────────────────────────────────────    │  │
│  │                                                               │  │
│  │  POST /api/v6/generate-ir-intent-contract                     │  │
│  │  Body: {                                                      │  │
│  │    enhanced_prompt: enhancedPromptData,                       │  │
│  │    userId: user.id,                                           │  │
│  │    config: {                                                  │  │
│  │      return_intermediate_results: true,                       │  │
│  │      provider: 'openai'                                       │  │
│  │    }                                                          │  │
│  │  }                                                            │  │
│  │                                                               │  │
│  │  Single API call runs the IntentContract pipeline:            │  │
│  │    1. IntentContract generation (semantic intent extraction)  │  │
│  │    2. CapabilityBinderV2 (intent → plugin operations)         │  │
│  │    3. IntentToIRConverter (logical IR)                        │  │
│  │    4. ExecutionGraphCompiler (IR → DSL workflow steps)        │  │
│  │                                                               │  │
│  │  Returns: {                                                   │  │
│  │    success: true,                                             │  │
│  │    ir: { config_defaults, ... },                              │  │
│  │    workflow: { workflow_steps, suggested_plugins },           │  │
│  │    metadata: { steps_generated, phase_times_ms }              │  │
│  │  }                                                            │  │
│  │                                                               │  │
│  │  Mapped to agent via mapV6ResponseToAgent().                  │  │
│  │  Sets platform_version: 'v6.0' in agent_config.               │  │
│  │                                                               │  │
│  │  (Note: the older "Pipeline B" / semantic pipeline at         │  │
│  │   /api/v6/generate-ir-semantic remains in the codebase but    │  │
│  │   the V2 UI no longer calls it — see                          │  │
│  │   docs/v6/V6_PIPELINE_A_MIGRATION.md § P6.)                   │  │
│  │                                                               │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │  V4 FLOW (flag disabled) — OpenAI 3-Stage Generation          │  │
│  │  ─────────────────────────────────────────────────────────    │  │
│  │                                                               │  │
│  │  POST /api/generate-agent-v4                                  │  │
│  │  (The route is V4-only as of 2026-05-31; the                  │  │
│  │   USE_AGENT_GENERATION_ENHANCED_TECHNICAL_WORKFLOW_REVIEW     │  │
│  │   flag that picked V5 was retired — see docs/FEATURE_FLAGS.md │  │
│  │   § Enhanced Technical Workflow Review for the retirement     │  │
│  │   note.)                                                      │  │
│  │                                                               │  │
│  │  Returns: GenerateAgentV2Response (agent config with steps).  │  │
│  │  Sets platform_version: 'v2.0' in agent_config.               │  │
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
│  3. Call executeAgentCreation()                                     │
│     • POST /api/create-agent with agent data + input_values         │
│       (E9: inputs are INLINE-SAVED in the same call now —           │
│        agent_configurations row is created atomically with the      │
│        agent insert. No separate POST to                            │
│        /api/agent-configurations/save-inputs in the create path;    │
│        that route remains the canonical write for post-creation     │
│        edits from the agent edit page.)                             │
│     • Links thread to agent (thread_id passed)                      │
│     • Shows success message; 300 ms later, router.push to           │
│       /agents/{id}.                                                 │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

> **Note (R1 cleanup, 2026-05-24):** Phase 4 ("Technical Workflow Generation") has been removed from the agent-creation flow. The V2 frontend only ever orchestrates Phases 1-3 (Describe → Clarify → Enhance → Approve), after which agent generation runs via V6 or V4 directly. Phase 4 was never wired into the production frontend; the supporting backend branch, validation schema, and helper utility were removed in R1.


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

---

## Example User Journey (Standard Flow)

```
1. User navigates to: /v2/agents/new?prompt=Help%20me%20with%20emails
   ↓
2. initializeThread() creates thread + calls Phase 1
   ↓
3. Phase 1 Analysis → clarityScore, conversationalSummary displayed
   ↓
4. Phase 2 starts (single-question loop):
   ↓
   Q1 (preceded by opening message): "Which email service?"  → user picks "Gmail"
   ↓
   Q2 (preceded by a hint bubble): "What action on emails?"  → user picks "Send to Slack"
   ↓
   Q3 (preceded by a different hint):  "Which Slack channel?" → user types "#general"
   ↓
   Server emits { question: null, phase2_done: true, ai_reasoning: "..." }
   ↓
5. Page advances to processPhase3() (initial session ⇒ no enhanced_prompt)
   ↓
6. Phase 3 Enhancement → Enhanced prompt with plan card shown
   (E2/F3 corrective retry handled silently if needed)
   ↓
7. User clicks "Yes, perfect!" → createAgent() called
   ↓
8a. V6 flag ON:  POST /api/v6/generate-ir-intent-contract (IntentContract pipeline)
8b. V6 flag OFF: POST /api/generate-agent-v4 (V4-only since 2026-05-31)
   ↓
9. Input parameters collected (if required and not already resolved)
   ↓
10. Scheduling UI shown (On Demand / Scheduled)
   ↓
11. User selects schedule → executeAgentCreation()
   ↓
12. POST /api/create-agent saves agent AND inline-saves input_values (E9),
    then 300 ms later router.push('/agents/{id}')

API Calls (V6):  init-thread + process-message × (N+1)  +  generate-ir-intent-contract + create-agent
API Calls (V4):  init-thread + process-message × (N+1)  +  generate-agent-v4 + create-agent
  where N = number of Phase 2 questions actually asked (3–6 typical; ≤10 per session)
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

(Line numbers intentionally omitted — they shift with every change. Grep by function name.)

| Function / Hook | Purpose |
|---|---|
| `V2AgentBuilderContent` | Main page component |
| `threadId` state | Thread ID storage |
| Init thread `useEffect` | Triggers `initializeThread()` when prerequisites are ready |
| `initializeThread()` | Creates thread + immediately starts Phase 1 |
| `processPhase1()` | Phase 1: diagnostic narrative |
| `processPhase2()` | Phase 2 round-trip — sends `phase2_user_answer`, receives one question or `phase2_done: true` |
| `submitPhase2Answer(answerText)` | Records the user's answer (synchronous to `clarificationAnswersRef` — F1; also `setBuilderState`), increments running question number (E4), round-trips back via `processPhase2` |
| `resetClarificationHints()` | Re-shuffles the hint deck + resets the per-session question counter (E3) at the start of each Phase 2 session (initial OR mini-cycle) |
| `nextClarificationHint()` | Returns the next shuffled hint from the `clarification_hints` thinking-words category (E3) |
| `processPhase3()` | Phase 3 enhancement (OAuth gate, mini-cycle, E2/F3 corrective retry handled server-side) |
| `handleConnectPlugin()` | OAuth plugin connection — re-runs Phase 3 with updated `connected_services` |
| `handleSkipPlugin()` | Decline plugin and re-run Phase 3 with `declined_services` |
| `createAgent()` | Calls V6 (`/api/v6/generate-ir-intent-contract`) or V4 (`/api/generate-agent-v4`) per `useV6AgentGeneration()` |
| `executeAgentCreation()` | Single POST to `/api/create-agent` (with `input_values` folded in — E9), then redirect |
| `handleSend()` | Handles user input — answers, feedback, free-text |
| `handleApprove()` | Approve plan → start the create flow |
| `handleEdit()` | V10: Start edit flow with `user_feedback` |

### Backend: `app/api/agent-creation/`

| Route | Purpose |
|-------|---------|
| `init-thread/route.ts` | Creates OpenAI thread, injects the v16 system prompt |
| `process-message/route.ts` | Handles Phases 1, 2, 3 — including the Phase 2 done-keyword short-circuit (F2 pre-call cap), the loop controller call, the E1/E7 thread-context omission, the E2/F3 Phase 3 corrective retry, and the E6 per-turn `ai_reasoning` breadcrumb |
| `thread/[id]/route.ts` | Resume existing thread with full history |

### Agent Generation APIs

| Route | Pipeline | Called When |
|-------|----------|------------|
| `/api/v6/generate-ir-intent-contract` | **V6 IntentContract pipeline (Pipeline A)** — IntentContract → CapabilityBinderV2 → IntentToIRConverter → ExecutionGraphCompiler | `useV6AgentGeneration()` enabled |
| `/api/generate-agent-v4` | V4 OpenAI 3-stage generation (V5 retired 2026-05-31) | `useV6AgentGeneration()` disabled |
| `/api/create-agent` | Final atomic agent insert. **E9: also inline-saves `agent_configurations.input_values` when the request includes `input_values`.** | After scheduling step in `executeAgentCreation()` |
| `/api/agent-configurations/save-inputs` | Canonical write path for **post-creation** input edits from the agent edit page. NOT called from the creation flow anymore (folded into `/api/create-agent` by E9). | From the agent edit page's input-config drawer |

### Validation: `lib/validation/`

| File | Purpose |
|------|---------|
| `phase2-schema.ts` | Strict Zod schema for the Phase 2 single-question response — `{ question, phase2_done, ai_reasoning? }`. `.strict()` rejects extra top-level keys. |
| `phase3-schema.ts` | Strict Zod schema + normalizer for Phase 3 responses. The F3 normalizer absorbs `resolved_user_inputs[*].value` LLM quirks (null/bool/object/array) before validation. |

### Loop control + Telemetry: `lib/agent-creation/`

| File | Purpose |
|------|---------|
| `phase2-loop-controller.ts` | Pure state machine for the Phase 2 cap and termination. NO I/O — caller (the route) owns Pino logging, thread metadata writes, and the cap pre-call short-circuit. |
| `phase2-done-detector.ts` | Done-keyword short-circuit (`"build it"`, `"that's enough"`, `"go ahead"`, etc.) — terminates the loop server-side without an LLM call. |

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
   - `POST /api/agent-creation/process-message` (phase 2) — ONE call per question; expect N+1 calls (the last one returns `phase2_done: true`)
   - `POST /api/agent-creation/process-message` (phase 3)
   - `POST /api/v6/generate-ir-intent-contract` OR `POST /api/generate-agent-v4`
   - `POST /api/create-agent` (ONE call — E9 folds input save in; no separate `/api/agent-configurations/save-inputs` should appear in the create flow)
5. Check Supabase `agent_prompt_threads` table for new row
6. Answer the questions one at a time — verify each response has `question.id` UNIQUE across the whole thread (E5; e.g. q1, q2, …, qN — never repeated)
7. `grep "Phase 2 turn decision" dev.log` — verify the E6 `ai_reasoning` breadcrumb fires per turn with a sensible explanation
8. Test "Need changes" button → Should trigger Phase 2 with `user_feedback` (mini-cycle)
9. Test OAuth gate: Use prompt requiring unconnected plugin → Should show connect cards
10. Test "Yes, perfect!" → Should call V6 or V4 generation, then create-agent
11. Verify agent is created and redirects to `/agents/{id}` within ~300 ms of the success message

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
| 2026-06-01 | Phase 2 single-question + v16 prompt + V6 Pipeline A + E9 + flag retirement | Major update reflecting the merged feature cycle. Phase 2 is now SINGLE-QUESTION per turn (FR4 strict contract: `{ question, phase2_done, ai_reasoning? }` validated by `lib/validation/phase2-schema.ts`). Prompt bumped to v16. V6 endpoint corrected from `/api/v6/generate-ir-semantic` to `/api/v6/generate-ir-intent-contract` (Pipeline A — IntentContract). `/api/create-agent` now folds the input-values save inline (E9 — no separate `/api/agent-configurations/save-inputs` in the create flow; that route remains for post-creation edits). `USE_AGENT_GENERATION_ENHANCED_TECHNICAL_WORKFLOW_REVIEW` flag retired; V5 generator no longer reachable from this route. Added: F1 (answer-keying race), F2 (per-session cap reset), F3 (Phase 3 normalizer + context-aware nudge), C1 (cap to 10 inclusive), E1 (mid-loop context omission), E2 (Phase 3 entrenchment retry), E3/E3.5 (client-side hints + opening message), E4 (running Question N), E5 (no re-ask + qID uniqueness), E6 (`ai_reasoning` telemetry), E7 (Phase 3 thread-context omission by signature), E8 (Agent Draft accordions). Dropped volatile per-line refs in favour of function-name anchors. |
| 2026-05-24 | R1 Phase 4 cleanup | Removed Phase 4 documentation as part of R1 cleanup (Phase 4 was never wired in the production frontend). System prompt bumped to v15; `process-message` now handles Phases 1-3 only; `phase4-schema.ts` no longer exists at that path; `schema-services-generator.ts` deleted. |
| 2026-04-01 | Updated for V6 pipeline + accurate line refs | Documented V6/V4 branching in agent generation, updated system prompt to v14, fixed all line number references, added `ai_provider`/`ai_model` to thread schema, added agent generation APIs table |
| 2026-01-16 | Initial document | Original thread-based flow diagram with Phases 1-4 |
