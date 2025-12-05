# Thread-Based Agent Creation Flow Diagram

## Overview
This diagram shows the complete user journey through `useConversationalBuilder.ts` when `USE_THREAD_BASED_AGENT_CREATION=true`.

---

## 🎯 Main Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         USER STARTS                                 │
│                    (Enters prompt in UI)                            │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  useEffect Hook (lines 749-786)                                     │
│  ─────────────────────────────────────                              │
│  • Checks: prompt && !projectState.conversationStarted              │
│  • Sets: conversationStarted = true                                 │
│  • Adds user message to chat                                        │
│  • Sets: originalPrompt = prompt                                    │
│  • Sets: isProcessing = true                                        │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Feature Flag Check (line 764)                                      │
│  ─────────────────────────────────                                  │
│  if (useThreadFlow) { ← TRUE                                        │
│    console.log('🆕 Using thread-based flow')                        │
│    await processWithThreads(prompt) ───────────────┐                │
│  }                                                 │                │
└────────────────────────────────────────────────────┼────────────────┘
                                                     │
                                                     ▼
┌─────────────────────────────────────────────────────────────────────┐
│  processWithThreads() - PHASE ORCHESTRATION (lines 579-673)         │
│  ─────────────────────────────────────────────────────────────────  │
│                                                                     │
│  STEP 1: Initialize Thread                                          │
│  ─────────────────────────────                                      │
│  threadId.current = await initializeThread()                        │
│    │                                                                │
│    ├─► POST /api/agent-creation/init-thread                         │
│    │   • Creates OpenAI thread                                      │
│    │   • Injects system prompt (Workflow-Agent-Creation-Prompt-v5)  │
│    │   • Stores in agent_prompt_threads table                       │
│    │   • Returns: { thread_id: "thread_abc123" }                    │
│    │                                                                │
│    └─► threadId.current = "thread_abc123"                           │
│                                                                     │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STEP 2: Phase 1 - Analyze Prompt Clarity                           │
│  ───────────────────────────────────────────                        │
│  const phase1Result = await processMessageInThread(1, prompt)       │
│    │                                                                │
│    ├─► POST /api/agent-creation/process-message                     │
│    │   Body: {                                                      │
│    │     thread_id: "thread_abc123",                                │
│    │     phase: 1,                                                  │
│    │     user_prompt: "Send my daily emails to Slack",              │
│    │     user_context: { full_name, email },                        │
│    │     connected_services: [gmail, slack, ...]                    │
│    │   }                                                            │
│    │                                                                │
│    │   Backend Processing:                                          │
│    │   • Adds user message to thread                                │
│    │   • Retrieves full thread history (includes system prompt)     │
│    │   • Builds conversation for Chat Completions                   │
│    │   • Calls GPT-4o with conversation context                     │
│    │   • Stores AI response back in thread                          │
│    │                                                                │
│    └─► Returns: {                                                   │
│          clarityScore: 75,                                          │
│          needsClarification: true,                                  │
│          missingPlugins: [],                                        │
│          pluginWarning: null,                                       │
│          analysis: { detected_plugins: ['gmail', 'slack'], ... }    │
│        }                                                            │
│                                                                     │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  STEP 3: Handle Analysis Results                                    │
│  ──────────────────────────────────                                 │
│  • Update projectState.detectedPlugins                              │
│  • Update projectState.analysisData                                 │
│  • Update projectState.clarityScore                                 │
│                                                                     │
│  Plugin Warning Check:                                              │
│  if (phase1Result.pluginWarning) {                                  │
│    addMessage(phase1Result.pluginWarning.message, 'ai')             │
│    // Example: "Gmail not connected. Please connect..."             │
│  }                                                                  │
│                                                                     │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
                    ┌────────────┴────────────┐
                    │  Clarity Score Check    │
                    │  (line 648)             │
                    └────────────┬────────────┘
                                 │
                 ┌───────────────┴───────────────┐
                 │                               │
                 ▼                               ▼
    ┌─────────────────────────┐    ┌─────────────────────────┐
    │  Score < 90             │    │  Score >= 90            │
    │  needsClarification     │    │  Clear enough!          │
    │  = true                 │    │                         │
    └───────────┬─────────────┘    └───────────┬─────────────┘
                │                              │
                ▼                              ▼
┌───────────────────────────────┐  ┌───────────────────────────────┐
│  BRANCH A: Need Questions     │  │  BRANCH B: Skip to Enhancement│
│  (Phase 2)                    │  │  (Phase 3 - No Questions)     │
└───────────────────────────────┘  └───────────────────────────────┘
                │                               │
                │                               │
                ▼                               │
┌─────────────────────────────────────────────┐ │
│  Phase 2 - Generate Questions               │ │
│  ─────────────────────────────────────────  │ │
│  const phase2 = await processMessageInThread│ │
│    (2, prompt)                              │ │
│    │                                        │ │
│    ├─► POST /api/agent-creation/            │ │
│    │        process-message                 │ │
│    │   Body: {                              │ │
│    │     thread_id: "thread_abc123",        │ │
│    │     phase: 2,                          │ │
│    │     user_prompt: "...",                │ │
│    │     ...                                │ │
│    │   }                                    │ │
│    │                                        │ │
│    └─► Returns: {                           │ │
│          questionsSequence: [               │ │
│            {                                │ │
│              id: "q1",                      │ │
│              question: "Which Slack         │ │
│                        channel?",           │ │
│              type: "text"                   │ │
│            },                               │ │
│            { ... }                          │ │
│          ]                                  │ │
│        }                                    │ │
│                                             │ │
│  Update State:                              │ │
│  • questionsSequence = phase2.questions     │ │
│  • currentQuestionIndex = 0                 │ │
│  • workflowPhase = 'clarification'          │ │
│                                             │ │
│  Add AI message:                            │ │
│  "I need to clarify a few things..."        │ │
│                                             │ │
└──────────────────┬──────────────────────────┘ │
                   │                            │
                   ▼                            │
┌─────────────────────────────────────────────┐ │
│         UI RENDERS QUESTIONS                │ │
│         (User answers one by one)           │ │
│                                             │ │
│  • Question 1: "Which Slack channel?"       │ │
│    User types: "#general"                   │ │
│    [handleAnswer() called]                  │ │
│                                             │ │
│  • Question 2: "What time of day?"          │ │
│    User types: "9am daily"                  │ │
│    [handleAnswer() called]                  │ │
│                                             │ │
│  • ... all questions answered ...           │ │
│                                             │ │
└──────────────────┬──────────────────────────┘ │
                   │                            │
                   ▼                            │
┌─────────────────────────────────────────────┐ │
│  Auto-Enhancement Trigger                   │ │
│  (lines 828-837)                            │ │
│  ─────────────────────────────────────────  │ │
│  useEffect: when all questions answered:    │ │
│                                             │ │
│  if (useThreadFlow && threadId.current) {   │ │
│    startEnhancementWithThread(              │ │
│      fullPrompt,                            │ │
│      clarificationAnswers                   │ │
│    ) ──────────────────────────────┐        │ │
│  }                                 │        │ │
└────────────────────────────────────┼────────┘ │
                                     │          │
                                     ▼          │
                                ┌────┴──────────┴─────┐
                                │  MERGE POINT:       │
                                │  Both branches meet │
                                │  at Phase 3         │
                                └────────┬────────────┘
                                         │
                                         ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Phase 3 - Enhance Prompt                                           │
│  startEnhancementWithThread() (lines 679-742)                       │
│  ─────────────────────────────────────────────────────────────────  │
│                                                                     │
│  Build fullPrompt:                                                  │
│  "Send my daily emails to Slack                                     │
│   #general channel at 9am daily"                                    │
│                                                                     │
│  const phase3 = await processMessageInThread(                       │
│    3,                                                               │
│    originalPrompt,                                                  │
│    clarificationAnswers  ← { q1: "#general", q2: "9am daily" }      │
│  )                                                                  │
│    │                                                                │
│    ├─► POST /api/agent-creation/process-message                     │
│    │   Body: {                                                      │
│    │     thread_id: "thread_abc123",                                │
│    │     phase: 3,                                                  │
│    │     user_prompt: "Send my daily emails...",                    │
│    │     clarification_answers: {                                   │
│    │       q1: "#general",                                          │
│    │       q2: "9am daily"                                          │
│    │     },                                                         │
│    │     ...                                                        │
│    │   }                                                            │
│    │                                                                │
│    │   Backend Processing:                                          │
│    │   • Adds user message + clarification answers to thread        │
│    │   • Retrieves FULL thread history:                             │
│    │     [system prompt, phase1 msg, phase1 response,               │
│    │      phase2 msg, phase2 response, phase3 msg]                  │
│    │   • Builds conversation for Chat Completions                   │
│    │   • GPT-4o generates enhanced prompt with ALL context          │
│    │   • ✅ VALIDATES response with Zod schema (strict!)            │
│    │   • Stores AI response in thread                               │
│    │                                                                │
│    └─► Returns: {                                                   │
│          enhanced_prompt: {                                         │
│            plan_title: "Gmail to Slack Automation",                 │
│            plan_description: "Send daily emails to Slack...",       │
│            sections: {                                              │
│              data: [                                                │
│                "- Fetch emails from Gmail inbox",                   │
│                "- Filter by date (today only)"                      │
│              ],                                                     │
│              actions: [                                             │
│                "- Format email content as Slack message"            │
│              ],                                                     │
│              output: [                                              │
│                "- Formatted Slack message with email subject/body"  │
│              ],                                                     │
│              delivery: [                                            │
│                "- Post to #general channel at 9am daily"            │
│              ],                                                     │
│              processing_steps: [ /* optional v7 field */ ]          │
│            },                                                       │
│            specifics: {                                             │
│              services_involved: ['gmail', 'slack'],                 │
│              user_inputs_required: []                               │
│            }                                                        │
│          },                                                         │
│          metadata: {                                                │
│            all_clarifications_applied: true,                        │
│            ready_for_generation: true,                              │
│            confirmation_needed: false,                              │
│            /* ...strictly typed Phase3Metadata */                   │
│          }                                                          │
│        }                                                            │
│                                                                     │
│  Update State:                                                      │
│  • enhancedPrompt = phase3.enhanced_prompt.plan_description         │
│  • enhancementComplete = true                                       │
│  • conversationCompleted = true                                     │
│  • workflowPhase = 'approval'                                       │
│                                                                     │
│  Add AI message:                                                    │
│  "Perfect! I've created a detailed plan..."                         │
│                                                                     │
└────────────────────────────────┬────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      APPROVAL PHASE                                 │
│                  (User reviews enhanced prompt)                     │
│                                                                     │
│  UI shows:                                                          │
│  • Enhanced prompt description                                      │
│  • Workflow steps                                                   │
│  • Required plugins                                                 │
│  • [Approve] [Edit] buttons                                         │
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
    ┌─────────────────────┐        ┌─────────────────────┐
    │  [Approve Clicked]  │        │  [Edit/Reject]      │
    │                     │        │                     │
    │  • Save agent       │        │  • Loop back to     │
    │  • Navigate to      │        │    start with       │
    │    dashboard        │        │    modifications    │
    │                     │        │                     │
    └─────────────────────┘        └─────────────────────┘
                 │
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

| State Variable           | Initial   | After Phase 1      | After Phase 2      | After Phase 3      |
|--------------------------|-----------|--------------------|--------------------|--------------------|
| `threadId.current`       | `null`    | `"thread_abc123"`  | `"thread_abc123"`  | `"thread_abc123"`  |
| `conversationStarted`    | `false`   | `true`             | `true`             | `true`             |
| `workflowPhase`          | `null`    | `'analysis'`       | `'clarification'`  | `'approval'`       |
| `clarityScore`           | `0`       | `75`               | `75`               | `75`               |
| `questionsSequence`      | `[]`      | `[]`               | `[q1, q2, ...]`    | `[q1, q2, ...]`    |
| `currentQuestionIndex`   | `0`       | `0`                | `0 → 1 → 2`        | `n` (done)         |
| `clarificationAnswers`   | `{}`      | `{}`         | `{q1: "...", q2: "..."}` | `{q1: "...", q2: "..."}` |
| `enhancedPrompt`         | `""`      | `""`               | `""`               | `"Create automated..."` |
| `enhancementComplete`    | `false`   | `false`            | `false`            | `true`             |
| `conversationCompleted`  | `false`   | `false`            | `false`            | `true`             |

---

## 🎬 Example User Journey (High Clarity Score)

```
1. User: "Send my Gmail emails from today to #general Slack at 9am"
   ↓
2. Phase 1 Analysis → clarityScore: 92 (high!)
   ↓
3. SKIP Phase 2 (no questions needed)
   ↓
4. Phase 3 Enhancement → Enhanced prompt generated
   ↓
5. Approval UI shown
   ↓
6. Done! (Only 2 API calls: init-thread + process-message phase 1 + process-message phase 3)
```

---

## 🎬 Example User Journey (Low Clarity Score)

```
1. User: "Help me with my emails"
   ↓
2. Phase 1 Analysis → clarityScore: 45 (low!)
   ↓
3. Phase 2 Questions Generated:
   - "Which email service?"
   - "What action on emails?"
   - "Where should results go?"
   ↓
4. User answers: "Gmail" → "Send to Slack" → "#general"
   ↓
5. Phase 3 Enhancement → Enhanced prompt generated
   ↓
6. Approval UI shown
   ↓
7. Done! (3 API calls: init-thread + process-message × 3 phases)
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

## 🎯 Critical Code References

| Function | Lines | Purpose |
|----------|-------|---------|
| `useConversationalBuilder` | 24 | Main hook export |
| `useThreadFlow` (flag check) | 43 | Feature flag constant |
| `threadId` ref | 45 | Thread ID storage |
| `initializeThread()` | 485-499 | Creates thread (POST /init-thread) |
| `processMessageInThread()` | 501-545 | Sends message to thread (POST /process-message) |
| `processWithThreads()` | 579-673 | Main orchestration (Phase 1 → Phase 2/3) |
| `startEnhancementWithThread()` | 679-742 | Phase 3 enhancement with thread |
| Main useEffect (feature flag branch) | 749-786 | Entry point: `processWithThreads()` vs `processWithLegacyAPIs()` |
| Auto-enhancement useEffect | 828-837 | Triggers Phase 3 after questions answered |

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

1. ✅ Set `USE_THREAD_BASED_AGENT_CREATION=true` in `.env.local`
2. ✅ Restart dev server
3. ✅ Navigate to agent creation wizard
4. ✅ Enter vague prompt (e.g., "help with emails") → Should trigger questions
5. ✅ Check console logs for "🆕 Using thread-based flow"
6. ✅ Verify Network tab shows:
   - `POST /api/agent-creation/init-thread`
   - `POST /api/agent-creation/process-message` (phase 1)
   - `POST /api/agent-creation/process-message` (phase 2)
   - `POST /api/agent-creation/process-message` (phase 3)
7. ✅ Check Supabase `agent_prompt_threads` table for new row
8. ✅ Answer questions and verify enhancement triggers
9. ✅ Try clear prompt (e.g., "Send Gmail to Slack #general at 9am") → Should skip questions
10. ✅ Verify Network tab shows only init-thread + phase 1 + phase 3 (no phase 2)

---

## 🚨 Error Handling

```
Try-Catch Boundaries:
├─ processWithThreads() → Catches all thread-based errors
│  ├─ initializeThread() fails → Falls back to legacy
│  ├─ processMessageInThread() fails → Shows error to user
│  └─ Thread expired → Creates new thread
│
└─ If useThreadFlow = true but backend fails:
   → Frontend shows error message
   → User can retry
   → OR admin can disable flag to use legacy flow
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

- **Zod Schemas:** [lib/validation/phase3-schema.ts](../lib/validation/phase3-schema.ts)
- **TypeScript Types:** [components/agent-creation/types/agent-prompt-threads.ts](../components/agent-creation/types/agent-prompt-threads.ts)
- **Validation Logic:** [app/api/agent-creation/process-message/route.ts:396-412](../app/api/agent-creation/process-message/route.ts#L396-L412)
- **LLM Prompt:** [app/api/prompt-templates/Workflow-Agent-Creation-Prompt-v9-chatgpt.txt](../app/api/prompt-templates/Workflow-Agent-Creation-Prompt-v9-chatgpt.txt)

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

**Document Version**: 3.0
**Last Updated**: 2025-12-05 (Added V11: Iterations Audit Trail + Agent-Thread Linking)
**Author**: Development Team

