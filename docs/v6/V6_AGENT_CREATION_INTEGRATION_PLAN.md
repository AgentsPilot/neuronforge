# V6 Agent Creation Integration Plan

> **Status**: Implementation In Progress - Phase A6 (Testing)
> **Created**: January 17, 2026
> **Updated**: January 21, 2026 - Added V6WorkflowPreview component for visual workflow approval UI.

This document outlines the implementation plan for integrating V6 agent generation with Intent Validation into the existing agent creation flow. When V6 is enabled, it **always** includes the full Intent Validation flow with Review & Customize UI.

---

## 1. Overview

### Goal
Add V6 as an optional agent generation method (controlled via feature flag) that users can choose during agent creation. **When V6 is enabled, it includes the full Intent Validation flow** with a Review & Customize UI between grounding and IR formalization. After successful agent creation, navigate to the agent sandbox page.

### Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **API Approach** | **Split API calls** (Phase 2) | Allows Review UI between grounding and compilation |
| **Intent Validation** | Included in V6 flow | Single feature flag controls both V6 + Intent Validation |
| **Expected Duration** | ~6-16s (processing) + user review time | Phase 1 (LLM) takes most time; Review UI adds user interaction |
| **Error Handling** | Show error, no fallback | Per user request |
| **Post-Creation Navigation** | `/v2/sandbox/[agentId]` | User confirmed sandbox page |
| **Feature Flag Type** | Environment-based | Follows existing pattern |

### Flow Summary

When `useV6AgentGeneration = true`, the agent creation uses the **V6 + Intent Validation flow**:
- Split API architecture (not single API call)
- Includes Review & Customize UI between grounding and compilation
- No separate "basic V6" mode - V6 always includes Intent Validation

| Feature Flag | Flow |
|--------------|------|
| `useV6AgentGeneration = false` | V4 flow (current production) |
| `useV6AgentGeneration = true` | V6 + Intent Validation (split API + Review UI) |

### Feature Flag Lifecycle

> **The feature flag is TEMPORARY.** Once V6 + Intent Validation is stable in production, the flag and all V4 code will be removed.

| Phase | Flag Status | What Happens |
|-------|-------------|--------------|
| **Development** | Keep flag | V4 works while building V6 |
| **Testing** | Keep flag | Can toggle between V4/V6 for comparison |
| **Initial Production** | Keep flag (default: false) | Gradual rollout, can rollback if needed |
| **Stable Production** | **Remove flag** | Delete flag + V4 code, V6 becomes the only flow |

**Simplification on removal:** ~300-350 lines removed + single code path (no branching)

---

## 2. Current Agent Creation Flow

### Key Files

| File | Purpose |
|------|---------|
| `app/v2/agents/new/page.tsx` | Main agent creation page (complete conversational builder) |
| `hooks/useAgentBuilderState.ts` | State management for builder phases |
| `hooks/useAgentBuilderMessages.ts` | Chat message management |
| `/api/agent-creation/process-message` | Process phases 1, 2, 3 (analysis, questions, enhancement) |
| `/api/generate-agent-v4` | Generate agent configuration from enhanced prompt |
| `/api/create-agent` | Save agent to database |

### Current Flow Sequence

```
1. User enters prompt
2. Phase 1: Analysis (clarity score, plugin detection)
3. Phase 2: Clarification questions
4. Phase 3: Enhanced prompt generation
5. User approves plan
6. createAgent() → /api/generate-agent-v4
7. Input parameters collection (if needed)
8. Scheduling configuration
9. executeAgentCreation() → /api/create-agent
10. Navigate to /agents/[id] (detail page)
```

### Key Functions in `app/v2/agents/new/page.tsx`

| Function | Line | Purpose |
|----------|------|---------|
| `createAgent(useEnhanced)` | ~660 | Calls `/api/generate-agent-v4`, builds agent data |
| `executeAgentCreation(agentData)` | ~821 | Calls `/api/create-agent`, saves to DB, navigates |
| `handleApprove()` | ~1095 | User approves plan, triggers `createAgent(true)` |

---

## 3. Feature Flag Implementation

### New Flag Definition

Based on `docs/feature_flags.md` pattern:

**Environment Variable**: `NEXT_PUBLIC_USE_V6_AGENT_GENERATION`

**Scope**: Client-side (needs `NEXT_PUBLIC_` prefix as it controls UI behavior)

**Default**: `false`

### Implementation

Add to `lib/utils/featureFlags.ts`:

```typescript
/**
 * Check if V6 agent generation is enabled
 *
 * When enabled, the agent creation flow will use the V6 5-phase pipeline
 * (semantic plan → grounding → formalization → compilation → validation)
 * instead of the V4 direct generation approach.
 *
 * @returns {boolean} True if V6 generation is enabled, false otherwise
 */
export function useV6AgentGeneration(): boolean {
  const flag = process.env.NEXT_PUBLIC_USE_V6_AGENT_GENERATION;

  if (!flag || flag.trim() === '') {
    return false;
  }

  const normalizedFlag = flag.trim().toLowerCase();

  if (normalizedFlag === 'false' || normalizedFlag === '0') {
    return false;
  }

  if (normalizedFlag === 'true' || normalizedFlag === '1') {
    return true;
  }

  return false;
}
```

Update `getFeatureFlags()`:

```typescript
export function getFeatureFlags() {
  return {
    useThreadBasedAgentCreation: useThreadBasedAgentCreation(),
    useNewAgentCreationUI: useNewAgentCreationUI(),
    useEnhancedTechnicalWorkflowReview: useEnhancedTechnicalWorkflowReview(),
    useV6AgentGeneration: useV6AgentGeneration(), // Add this
  };
}
```

### Environment Configuration

Add to `.env.example`:

```bash
# V6 Agent Generation
# Enables the 5-phase V6 pipeline for agent creation
# When true, uses semantic plan → grounding → formalization → compilation → validation
NEXT_PUBLIC_USE_V6_AGENT_GENERATION=false
```

---

## 4. V6 Pipeline Reference

### Underlying V6 Pipeline

For reference, the V6 5-phase pipeline (used internally by the split APIs) consists of:

| Phase | Description | Typical Time |
|-------|-------------|--------------|
| Phase 1 | Understanding (Semantic Plan) | 5-20 sec |
| Phase 2 | Grounding (Assumption Validation) | 100-500 ms |
| Phase 3 | Formalization (IR Generation) | 50-100 ms |
| Phase 4 | Compilation (PILOT DSL) | 50-100 ms |
| Phase 5 | Normalization | 10-50 ms |

**Total: ~8-15 seconds** (mostly Phase 1)

### V6 API Response Structure (Reference)

This is the response from `/api/v6/generate-ir-semantic` which runs all 5 phases. For the V6 + Intent Validation integration, we use **split APIs** instead (see Section 18.2):

```typescript
{
  success: true,
  workflow: {
    workflow_steps: [...],      // PILOT DSL steps
    suggested_plugins: [...]    // Detected plugins
  },
  validation: {
    valid: boolean,
    issues: []
  },
  metadata: {
    architecture: 'semantic_plan_5_phase',
    total_time_ms: number,
    phase_times_ms: {
      understanding: number,
      grounding: number,
      formalization: number,
      compilation: number,
      normalization: number
    },
    steps_generated: number,
    plugins_used: string[]
  },
  // Intermediate results (if return_intermediate_results: true)
  intermediate_results?: {
    semantic_plan: {...},
    grounded_plan: {...},
    ir: {...}
  }
}
```

> **Note**: The V6 + Intent Validation flow uses **split APIs** (`/api/v6/generate-semantic-grounded` and `/api/v6/compile-with-decisions`) to allow user interaction between grounding and compilation. See Section 18.2 for the split API specifications.

---

## 5. Agent Object Mapping

### V4 Agent Object Structure (Reference)

From `/api/generate-agent-v4` response (lines 442-502):

```typescript
agent: {
  id: agentId,
  user_id: userId,
  agent_name: string,
  user_prompt: string,           // Original user prompt
  system_prompt: string,
  description: string,
  plugins_required: string[],
  connected_plugins: string[],
  input_schema: Array<{
    name: string,
    type: string,
    label: string,
    required: boolean,
    description: string,
    placeholder: string,
    hidden: boolean
  }>,
  output_schema: [],
  status: 'draft',
  mode: 'on_demand',
  schedule_cron: null,
  created_from_prompt: string,
  ai_reasoning: string,
  ai_confidence: number,
  ai_generated_at: string,
  workflow_steps: [...],
  pilot_steps: [...],
  trigger_conditions: {
    error_handling: {
      on_failure: 'stop',
      retry_on_fail: false
    }
  },
  detected_categories: Array<{ plugin: string, detected: boolean }>,
  agent_config: {
    mode: 'on_demand',
    metadata: {
      version: string,
      generator_version: string,
      generation_method: string,
      agent_id: string,
      session_id: string,
      prompt_type: string,
      architecture: string,
      latency_ms: number
    }
  }
}
```

### V6 to Agent Object Mapping

```typescript
// Map V6 response to V4-compatible agent object
// Updated January 21, 2026 - Fixed to match CreateAgentConfig type
const mapV6ResponseToAgent = (
  v6Response: V6Response,
  context: {
    agentId: string,
    userId: string,
    sessionId: string,
    initialPrompt: string,
    enhancedPromptData: any,
    connectedPlugins: string[],
    latencyMs: number
  }
): AgentData => {
  const { workflow, metadata, intermediate_results } = v6Response;
  const semanticPlan = intermediate_results?.semantic_plan;
  const description = context.enhancedPromptData?.plan_description ||
                      semanticPlan?.goal || '';

  return {
    user_id: context.userId,
    // Note: id is NOT included - CreateAgentData doesn't have id field
    agent_name: context.enhancedPromptData?.plan_title ||  // Priority 1: plan_title
                semanticPlan?.goal ||                       // Priority 2: semantic goal
                'New Agent',                                // Priority 3: default
    user_prompt: context.initialPrompt || '',
    system_prompt: `You are an automation agent. ${description}`,  // V4 pattern
    description: description,
    plugins_required: workflow.suggested_plugins || metadata.plugins_used || [],
    connected_plugins: context.connectedPlugins,
    input_schema: extractInputSchema(workflow.workflow_steps),
    output_schema: [],
    status: 'draft',
    mode: 'on_demand',
    schedule_cron: null,
    created_from_prompt: context.initialPrompt || '',
    ai_reasoning: `Generated via V6 5-phase semantic pipeline. ` +
                  `${metadata.steps_generated} steps created.`,
    ai_confidence: metadata.grounding_confidence || 0.8,
    ai_generated_at: new Date().toISOString(),
    workflow_steps: workflow.workflow_steps,
    pilot_steps: workflow.workflow_steps,
    trigger_conditions: {
      error_handling: {
        on_failure: 'stop',
        retry_on_fail: false
      }
    },
    detected_categories: (workflow.suggested_plugins || []).map((p: string) => ({
      plugin: p,
      detected: true
    })),
    // Updated: Uses creation_metadata and ai_context (not mode/metadata)
    agent_config: {
      creation_metadata: {
        ai_generated_at: new Date().toISOString(),
        session_id: context.sessionId,
        agent_id: context.agentId,
        thread_id: '',
        prompt_type: 'enhanced',
        clarification_answers: {},
        version: '6.0',
        platform_version: 'v6.0',
        enhanced_prompt_data: {
          ...context.enhancedPromptData,
          v6_metadata: {
            architecture: 'semantic_plan_5_phase',
            phase_times_ms: metadata.phase_times_ms,
            grounding_confidence: metadata.grounding_confidence,
            steps_generated: metadata.steps_generated
          }
        }
      },
      ai_context: {
        reasoning: `Generated via V6 5-phase semantic pipeline. ${metadata.steps_generated} steps.`,
        confidence: metadata.grounding_confidence || 0.8,
        original_prompt: context.initialPrompt || '',
        enhanced_prompt: context.enhancedPromptData?.enhanced_prompt || '',
        generated_plan: ''
      }
    }
  };
};

// Helper: Extract input schema from workflow steps
const extractInputSchema = (workflowSteps: any[]): InputSchemaItem[] => {
  const inputs: InputSchemaItem[] = [];
  const seenNames = new Set<string>();

  for (const step of workflowSteps) {
    // Look for variable references like {{input.variable_name}}
    const stepStr = JSON.stringify(step);
    const matches = stepStr.match(/\{\{input\.(\w+)\}\}/g) || [];

    for (const match of matches) {
      const name = match.replace('{{input.', '').replace('}}', '');
      if (!seenNames.has(name)) {
        seenNames.add(name);
        inputs.push({
          name,
          type: 'string',
          label: name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
          required: true,
          description: '',
          placeholder: '',
          hidden: false
        });
      }
    }
  }

  return inputs;
};
```

---

## 6. Integration Point

### Location: `createAgent()` function in `app/v2/agents/new/page.tsx`

The integration point is the `createAgent()` function (around line 660-815).

### V6 Flow (Split API with Intent Validation)

When `useV6AgentGeneration() = true`, the flow is:

1. **User approves plan** → triggers `createAgent()`
2. **API Call 1**: `/api/v6/generate-semantic-grounded` (Phases 1+2 + 5-Layer Detection)
3. **Show Review UI** → user configures assumptions, resolves ambiguities
4. **User clicks "Create Agent"** → triggers compilation
5. **API Call 2**: `/api/v6/compile-with-decisions` (Phases 3+4+5 with user constraints)
6. **API Call 3**: `/api/create-agent` (save to DB)
7. **Navigate** to `/v2/sandbox/{agentId}`

See **Section 18** for detailed flow diagram and API specifications.

### Modified Flow (Conceptual)

```typescript
const createAgent = async (useEnhanced: boolean = true) => {
  // ... existing setup code ...

  const useV6 = useV6AgentGeneration();  // Import from featureFlags

  if (useV6) {
    // === V6 + INTENT VALIDATION FLOW ===
    console.log('🚀 Using V6 with Intent Validation flow...')

    // API Call 1: Semantic Understanding + Grounding + 5-Layer Detection
    addAIMessage('🔍 Analyzing your request...')
    const semanticGroundedResponse = await fetch('/api/v6/generate-semantic-grounded', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-user-id': user.id },
      body: JSON.stringify({
        enhanced_prompt: enhancedPromptData,
        userId: user.id,
        config: { provider: 'openai' }
      })
    });

    const semanticGroundedData = await semanticGroundedResponse.json();

    // Store data for Review UI
    setSemanticGroundedData(semanticGroundedData);

    // Transition to Review & Customize phase (new phase)
    setBuilderPhase('review_customize');
    // Review UI component will render based on phase
    // User interacts with Review UI...
    // When user clicks "Create Agent", handleReviewComplete() is called

  } else {
    // === EXISTING V4 FLOW ===
    // ... existing V4 code (unchanged) ...
  }
};

// NEW: Called when user clicks "Create Agent" in Review UI
const handleReviewComplete = async (userDecisions: ReviewUIDecisions) => {
  // API Call 2: Compile with user decisions
  addAIMessage('✨ Creating your agent...')
  const compileResponse = await fetch('/api/v6/compile-with-decisions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-user-id': user.id },
    body: JSON.stringify({
      grounded_plan: semanticGroundedData.grounded_plan,
      user_decisions: userDecisions,
      enhanced_prompt: enhancedPromptData,
      userId: user.id
    })
  });

  const compiledData = await compileResponse.json();

  // Map to agent object and save via /api/create-agent
  const agentData = mapV6ResponseToAgent(compiledData, context);
  await executeAgentCreation(agentData);
  // navigates to /v2/sandbox/{agentId}
};
```

---

## 7. Navigation Change

### Current Behavior
After agent creation in `executeAgentCreation()` (line 888):
```typescript
router.push(`/agents/${result.agent.id}`)
```

### New Behavior
```typescript
router.push(`/v2/sandbox/${result.agent.id}`)
```

This change applies to **both V4 and V6** flows.

### Sandbox Page Features
The sandbox page at `/v2/sandbox/[agentId]` (`app/v2/sandbox/[agentId]/page.tsx`) provides:
- Input variable configuration (left column)
- Debugger controls: Play, Pause, Resume, Stop
- Step-by-step execution timeline with real-time SSE streaming (middle column)
- Data inspector showing each step's output (right column)
- Pilot credits and execution time display
- Step-level debugging with status indicators (pending → running → completed/failed)

---

## 8. Loading State UI

Since V6 runs as a single API call (~8-15 seconds), show a simple loading message:

```
User approves plan
        ↓
"🔍 Generating your workflow using V6 semantic pipeline..."
[typing indicator for ~8-15 seconds]
        ↓
"✅ Workflow generated successfully!"
        ↓
"Agent draft ready!"
        ↓
Continue to input parameters / scheduling...
```

---

## 9. Error Handling

Per user requirement: **Show error, no fallback to V4**

```typescript
try {
  const v6Response = await fetch('/api/v6/generate-ir-semantic', { ... });

  if (!v6Response.ok) {
    const error = await v6Response.json();
    throw new Error(error.error || error.details || 'V6 generation failed');
  }

  // ... process response ...

} catch (error: any) {
  console.error('❌ V6 Agent creation error:', error);
  removeTypingIndicator();
  addSystemMessage(`Error creating agent: ${error.message}`);
  setIsCreatingAgent(false);
  // Do NOT fall back to V4 - user must retry
}
```

---

## 10. Files to Modify

### Phase A: Test Page Files

| File | Changes |
|------|---------|
| `app/test-plugins-v2/page.tsx` | Add V6 Intent Validation section after Phase 3, integrate Review UI |
| `docs/V2_TEST_PAGE_SCOPE.md` | Document new V6 Intent Validation testing flow |

### Phase B: Production Files

| File | Changes |
|------|---------|
| `lib/utils/featureFlags.ts` | Add `useV6AgentGeneration()` function ✅ (already done) |
| `app/v2/agents/new/page.tsx` | Replace V6 branch with split API flow, integrate Review UI component |
| `hooks/useAgentBuilderState.ts` | Add `review_customize` phase, add state for semantic/grounded data |
| `.env.example` | Add `NEXT_PUBLIC_USE_V6_AGENT_GENERATION=false` ✅ (already done) |
| `docs/feature_flags.md` | Document new flag |
| `lib/utils/__tests__/featureFlags.test.ts` | Add tests for new flag ✅ (already done) |

---

## 10.1 Test Page Strategy

### Why Test Page First?

| Benefit | Explanation |
|---------|-------------|
| **Isolated testing** | Test new APIs and UI without affecting production |
| **Faster iteration** | No need to go through full agent creation flow |
| **Uses existing Enhanced Prompt** | Thread Conversation Phase 3 already generates input |
| **Reusable components** | Review UI component works in both test page and production |
| **Validates APIs independently** | Can test API responses before UI integration |

### Test Page Flow (Extended)

> **Key Insight:** The test page flow ends at **compiled workflow + execute** - NOT "create agent". This lets us validate the pipeline quality by executing workflows directly, without involving agent creation logic. Agent creation integration comes later in Phase B.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    TEST-PLUGINS-V2: TAB 3 (THREAD CONVERSATION)              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  EXISTING FLOW (unchanged)                                                   │
│  ════════════════════════════════════════════════════════════════════════   │
│                                                                              │
│  Phase 1 (Analysis) → Phase 2 (Q&A) → Phase 3 (Enhanced Prompt)              │
│                                              │                               │
│                                              ▼                               │
│                                   ┌─────────────────────┐                   │
│                                   │ Enhanced Prompt      │                   │
│                                   │ Display              │                   │
│                                   │                      │                   │
│                                   │ [Accept Plan]        │ ← Existing        │
│                                   │ [Generate Phase 4]   │ ← Existing        │
│                                   │ [🆕 Test V6 Intent]  │ ← NEW BUTTON      │
│                                   └─────────────────────┘                   │
│                                              │                               │
│                                              │ Click "Test V6 Intent"        │
│                                              ▼                               │
│  NEW V6 + INTENT VALIDATION SECTION                                          │
│  ════════════════════════════════════════════════════════════════════════   │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ 🔍 API CALL 1: /api/v6/generate-semantic-grounded                    │    │
│  │                                                                       │    │
│  │ Loading: "Analyzing and grounding your request..."                    │    │
│  │                                                                       │    │
│  │ Response Display:                                                     │    │
│  │ • Semantic Plan (expandable JSON)                                     │    │
│  │ • Grounded Plan (expandable JSON)                                     │    │
│  │ • Ambiguity Report (expandable JSON)                                  │    │
│  │ • Phase times & metadata                                              │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│       │                                                                      │
│       ▼                                                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ 🎯 REVIEW & CUSTOMIZE UI COMPONENT                                    │    │
│  │                                                                       │    │
│  │ ┌─────────────────────────────────────────────────────────────────┐  │    │
│  │ │ Plan Header: Title & Description                                 │  │    │
│  │ ├─────────────────────────────────────────────────────────────────┤  │    │
│  │ │ REMAINING QUESTIONS (if any) - dropdowns                        │  │    │
│  │ ├─────────────────────────────────────────────────────────────────┤  │    │
│  │ │ PLEASE CONFIRM (must-confirm items) - radio buttons              │  │    │
│  │ ├─────────────────────────────────────────────────────────────────┤  │    │
│  │ │ ASSUMPTIONS (collapsible) - checkboxes                          │  │    │
│  │ ├─────────────────────────────────────────────────────────────────┤  │    │
│  │ │ EDGE CASES (if any) - dropdowns                                 │  │    │
│  │ └─────────────────────────────────────────────────────────────────┘  │    │
│  │                                                                       │    │
│  │ [Compile Workflow] - disabled until mandatory items resolved          │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│       │                                                                      │
│       │ Click "Compile Workflow"                                             │
│       ▼                                                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ ✨ API CALL 2: /api/v6/compile-with-decisions                        │    │
│  │                                                                       │    │
│  │ Request includes: grounded_plan + user_decisions                      │    │
│  │                                                                       │    │
│  │ Response Display:                                                     │    │
│  │ • IR (expandable JSON)                                                │    │
│  │ • Workflow Steps (expandable JSON)                                    │    │
│  │ • Validation Status                                                   │    │
│  │ • Phase times & metadata                                              │    │
│  │                                                                       │    │
│  │ [📥 Download All] [▶️ Execute Workflow] [🔄 Reset]                    │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│       │                                                                      │
│       │ Click "Execute Workflow" (uses existing test page execution)         │
│       ▼                                                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │ 🧪 WORKFLOW EXECUTION (Existing Test Page Feature)                    │    │
│  │                                                                       │    │
│  │ Uses /api/v6/execute-test to run workflow against real plugins        │    │
│  │ Shows step-by-step execution results                                  │    │
│  │ Validates workflow correctness WITHOUT saving as agent                │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                                                              │
│  ════════════════════════════════════════════════════════════════════════   │
│  END OF PHASE A - Pipeline validated, workflow executes correctly           │
│  Agent creation (save to DB) is Phase B                                      │
│  ════════════════════════════════════════════════════════════════════════   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Test Page State Variables (New)

```typescript
// V6 Intent Validation state (in test-plugins-v2)
- v6IntentValidationActive: boolean           // Is V6 section visible
- v6SemanticGroundedResponse: any             // API 1 response
- v6UserDecisions: ReviewUIDecisions          // User's choices from Review UI
- v6CompileResponse: any                      // API 2 response
- v6IsLoading: boolean                        // Loading state
- v6Error: string | null                      // Error message
```

---

## 11. Implementation Steps

### Completed Foundation Work

The following foundational work was done during early exploration and will be **replaced** by the full V6 + Intent Validation implementation:

| Item | Status | Notes |
|------|--------|-------|
| Feature flag `useV6AgentGeneration()` | ✅ Complete | In `lib/utils/featureFlags.ts` |
| Feature flag tests | ✅ Complete | 11 test cases |
| `mapV6ResponseToAgent()` helper | ✅ Complete | Will be updated for split API response |
| `extractInputSchema()` helper | ✅ Complete | No changes needed |
| TypeScript types | ✅ Complete | Will be extended for new data structures |

### Implementation Steps for V6 + Intent Validation

The implementation is organized into three phases: **Test Page Development**, **Production Integration**, and **Rollout**.

#### Phase A: Test Page Development (in `/test-plugins-v2`)

Build and test the V6 + Intent Validation flow in the test page **before** touching production code.

| Step | Task | Status | Notes |
|------|------|--------|-------|
| **A1** | Create `/api/v6/generate-semantic-grounded` endpoint | ✅ Done | Orchestrates Phases 1+2 + 5-Layer Detection |
| **A2** | Create 5-Layer Ambiguity Detection module | ✅ Done | See Section 18.4 for breakdown |
| **A3** | Create `/api/v6/compile-with-decisions` endpoint | ✅ Done | Runs Phases 3+4+5 with user constraints |
| **A4** | Create Review & Customize UI component | ✅ Done | Reusable component for test page and production |
| **A5** | Extend test-plugins-v2 Tab 3 (Thread Conversation) | ✅ Done | Add "V6 Intent Validation" button after Phase 3 |
| **A6** | Test and iterate in test page | ⏳ Pending | Full flow testing without affecting production |

**A6 Exit Criteria (must pass before Phase B):**

| Criteria | Status | Description |
|----------|--------|-------------|
| Full flow works | ⬜ | Enhanced Prompt → API 1 → Review UI → API 2 → Compile → Execute |
| Multiple prompt types tested | ⬜ | Test at least 3 different prompts (simple, grouped, conditional) |
| 5-Layer Detection outputs correct | ⬜ | Each layer produces expected must_confirm/should_review items |
| Review UI interactions work | ⬜ | Mandatory items block button, assumptions toggle, edge cases select |
| Compiled workflow executes | ⬜ | Workflow runs via `/api/v6/execute-test` without errors |
| No console errors | ⬜ | Clean console during full flow (warnings acceptable) |

> **Proceed to Phase B only when all A6 criteria are checked.**

**Test Page Flow (after Phase 3 Enhanced Prompt):**
```
Phase 3 (Enhanced Prompt)
    │
    └─→ [🆕 Test V6 + Intent Validation]
              │
              ▼
        API 1: /api/v6/generate-semantic-grounded
              │
              ▼
        🆕 Review & Customize UI (in test page)
              │
              ▼
        API 2: /api/v6/compile-with-decisions
              │
              ▼
        Compiled Workflow Display
              │
              ▼
        [▶️ Execute Workflow] ← Uses existing /api/v6/execute-test
              │
              ▼
        Execution Results (validates workflow quality)

        ═══════════════════════════════════════════
        END OF PHASE A - No agent creation here
        Agent creation is Phase B (production)
        ═══════════════════════════════════════════
```

#### Phase B: Production Integration (in `/v2/agents/new`)

Once the flow is tested and stable in the test page, integrate into production.

| Step | Task | Status | Notes |
|------|------|--------|-------|
| **B1** | Add `review_customize` phase to builder state | ⏳ Pending | Update `useAgentBuilderState.ts` |
| **B2** | Modify `createAgent()` for split API flow | ⏳ Pending | Replace current V6 branch |
| **B3** | Integrate Review & Customize UI component | ⏳ Pending | Render based on `review_customize` phase |
| **B4** | Add `handleReviewComplete()` function | ⏳ Pending | Handle Review UI submission |
| **B5** | Update navigation to sandbox | ⏳ Pending | `router.push('/v2/sandbox/{agentId}')` |
| **B6** | Production end-to-end testing | ⏳ Pending | Test with feature flag enabled |

#### Phase C: Rollout & Cleanup

| Step | Task | Status | Notes |
|------|------|--------|-------|
| **C1** | Deploy to production (flag off) | ⏳ Pending | Code deployed but inactive |
| **C2** | Enable flag, monitor | ⏳ Pending | V6 live for all users |
| **C3** | Stabilization (~2 weeks) | ⏳ Pending | Fix issues, gather feedback |
| **C4** | **Remove feature flag & V4 code** | ⏳ Future | See "Post-Stabilization Cleanup" below |

### Implementation Notes

- **Test page first**: All new code (APIs, Review UI) is built and tested in `/test-plugins-v2` before production
- The current V6 branch in `page.tsx` (single API call) will be **replaced** with the split API flow
- The Review & Customize UI component is **reusable** - same component in test page and production
- No backwards compatibility needed for "basic V6" - it was only for internal testing

### Post-Stabilization Cleanup (Step 11)

Once V6 is stable in production, remove the feature flag and V4 code:

| File | Action |
|------|--------|
| `lib/utils/featureFlags.ts` | Remove `useV6AgentGeneration()` function |
| `lib/utils/__tests__/featureFlags.test.ts` | Remove 11 test cases |
| `app/v2/agents/new/page.tsx` | Remove `if/else` branching, keep only V6 flow |
| `.env.example`, `.env.local` | Remove `NEXT_PUBLIC_USE_V6_AGENT_GENERATION` |
| `docs/feature_flags.md` | Remove flag documentation |
| `/api/generate-agent-v4` | Consider deprecation (check if used elsewhere) |

**Estimated cleanup:** ~300-350 lines removed, single code path

---

## 12. Rollout Strategy

### Phase 1: Test Page Development (Steps A1-A6)
```
Location: /test-plugins-v2
Flag: Not needed (test page is separate)
```
- Build APIs: `/api/v6/generate-semantic-grounded`, `/api/v6/compile-with-decisions`
- Build 5-Layer Ambiguity Detection module
- Build Review & Customize UI component
- Extend test-plugins-v2 Tab 3 with "Test V6 + Intent Validation" button
- **Iterate until flow works correctly**

### Phase 2: Production Integration (Steps B1-B6)
```bash
# .env.local
NEXT_PUBLIC_USE_V6_AGENT_GENERATION=true
```
- Integrate Review UI component into `/v2/agents/new`
- Add `review_customize` phase to builder state
- Wire up split API flow in `createAgent()`
- Test end-to-end with flag enabled locally

### Phase 3: Production Deployment (Step C1)
```bash
# .env.production
NEXT_PUBLIC_USE_V6_AGENT_GENERATION=false
```
- Deploy V6 code to production (inactive)
- V4 continues as production flow
- Can enable for specific internal testing if needed

### Phase 4: Production Rollout (Step C2)
```bash
# .env.production
NEXT_PUBLIC_USE_V6_AGENT_GENERATION=true
```
- Enable V6 for all users
- Monitor for issues
- V4 still available as emergency rollback

### Phase 5: Stabilization & Cleanup (Steps C3-C4)
Once V6 is stable (no critical bugs for ~2 weeks):
- Remove feature flag
- Delete V4 code
- V6 becomes the only flow
- **~300-350 lines of code removed**

---

## 13. Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| V6 API failures | Users cannot create agents | Feature flag allows instant rollback to V4 |
| Longer generation time (~8-15s vs ~3-6s) | UX degradation | Informative loading message |
| Missing plugin support | Workflow execution fails | V6 validates plugins during compilation |
| Regression in V4 flow | Affects all users | Keep V4 as default, thorough testing |
| V6 output schema mismatch | Agent save fails | `mapV6ResponseToAgent()` ensures compatibility |
| Missing input_schema | Sandbox can't collect inputs | `extractInputSchema()` parses workflow steps |

---

## 14. Success Criteria

### Phase A: Test Page (must pass before Phase B)

- [x] Feature flag `useV6AgentGeneration()` implemented
- [x] `/api/v6/generate-semantic-grounded` returns semantic plan + grounded plan + ambiguity report
- [x] 5-Layer Ambiguity Detection module identifies must-confirm items correctly
- [x] `/api/v6/compile-with-decisions` compiles with user constraints
- [x] Review & Customize UI component displays all sections per spec
- [x] "V6 Intent Validation" button added to test-plugins-v2 Tab 3
- [ ] Full flow works in test page: Enhanced Prompt → Review UI → Compiled Workflow
- [ ] **Compiled workflow executes successfully** via existing `/api/v6/execute-test`
- [ ] Workflow quality validated through execution (no agent creation needed)

### Phase B: Production Integration

- [ ] `review_customize` phase added to builder state
- [ ] Review UI component integrated into `/v2/agents/new`
- [ ] `createAgent()` uses split API flow when flag enabled
- [ ] Agent object matches V4 structure (compatible with `/api/create-agent`)
- [ ] Agent saved to database with correct `pilot_steps` format
- [ ] Navigation goes to `/v2/sandbox/{agentId}` after creation
- [ ] Error handling shows meaningful messages (no fallback to V4)
- [x] V4 flow unchanged when flag is off

### Phase C: Rollout

- [ ] V6 enabled in production
- [ ] No critical bugs for ~2 weeks
- [ ] Feature flag and V4 code removed
- [ ] Documentation updated

---

## 15. Open Questions (Resolved)

> **Status**: All questions resolved as of January 21, 2026

| Question | Resolution | Implementation |
|----------|------------|----------------|
| **System Prompt** | Generate using V4 pattern | `system_prompt: \`You are an automation agent. ${description}\`` |
| **Input Schema Enhancement** | Current approach is sufficient | `extractInputSchema()` parses `{{input.x}}` patterns - adequate for now |
| **Confidence Score** | Use grounding_confidence directly | `ai_confidence: metadata.grounding_confidence \|\| 0.8` |

---

## 16. Approval & Status

- [x] Plan reviewed and approved
- [x] Ready for implementation
- [x] Foundation work started (January 18, 2026)
- [x] Architecture simplified: V6 = V6 + Intent Validation (January 19, 2026)
- [x] Test page strategy defined (January 19, 2026)
- [x] **Phase A: Steps A1-A5 complete** - All files created and verified (January 21, 2026)
- [ ] **Phase A6: Testing** - Full flow testing in test page
- [ ] Phase A complete (all A6 exit criteria pass)
- [ ] **Phase B: Production Integration** in progress
- [ ] Phase B complete (production flow works with flag)
- [ ] **Phase C: Rollout** - V6 enabled in production
- [ ] Phase C complete (flag removed, V6 is only flow)

> **Current Status (January 21, 2026)**: Phase A steps A1-A5 complete. All files verified to exist. Ready for A6 testing.

---

## 17. Testing Instructions

Testing happens in two stages: **Test Page first**, then **Production**.

### Stage 1: Test Page Testing (Phase A)

Test the V6 + Intent Validation flow in `/test-plugins-v2` before production:

1. **Start the dev server**:
   ```bash
   npm run dev
   ```

2. **Navigate to test page**: `/test-plugins-v2`

3. **Go to Tab 3** (Thread Conversation)

4. **Create an Enhanced Prompt**:
   - Enter a prompt (e.g., "Send weekly email summaries of Gmail to a Google Sheet")
   - Complete Phase 1 (Analysis) and Phase 2 (Q&A)
   - Reach Phase 3 (Enhanced Prompt)

5. **Click "Test V6 + Intent Validation"** button (after Phase 3 display)

6. **Verify API Call 1** (`/api/v6/generate-semantic-grounded`):
   - Loading indicator shows
   - Response displays: semantic plan, grounded plan, ambiguity report
   - No errors

7. **Review & Customize UI appears**:
   - Plan title & description show correctly
   - Remaining Questions section (if any)
   - Please Confirm section (if any must-confirm items)
   - Assumptions section (collapsible, checkboxes)
   - Edge Cases section (if any)
   - Schedule & Settings section

8. **Test mandatory item blocking**:
   - "Compile Workflow" button disabled until mandatory items resolved
   - Resolve all mandatory items
   - Button becomes enabled

9. **Click "Compile Workflow"** and verify API Call 2 (`/api/v6/compile-with-decisions`):
   - Loading indicator shows
   - Response displays: IR, workflow steps, validation status
   - No errors

10. **Execute the compiled workflow**:
   - Click "Execute Workflow" button
   - Uses existing `/api/v6/execute-test` endpoint
   - View step-by-step execution results
   - Verify workflow runs correctly against real plugins

11. **Download results** and verify JSON structure

### Stage 2: Production Testing (Phase B)

After test page works, test in production with feature flag:

1. **Enable the feature flag** in `.env.local`:
   ```bash
   NEXT_PUBLIC_USE_V6_AGENT_GENERATION=true
   ```

2. **Restart the dev server**:
   ```bash
   npm run dev
   ```

3. **Navigate to agent creation**: `/v2/agents/new`

4. **Create an agent** with any prompt and complete the Q&A flow

5. **Expected behavior**:
   - Console should log: `🚀 Using V6 with Intent Validation flow...`
   - UI should show: "Analyzing your request..." (~6-16 seconds)
   - **Review & Customize UI** should appear (same as test page)
   - User clicks "Create Agent"
   - Agent compilation happens (~200-300ms)
   - Agent saved to database
   - Navigation goes to `/v2/sandbox/{agentId}`

6. **Verify V4 still works** by setting flag to `false`

7. **Test Review UI interactions**:
   - Verify mandatory items block "Create Agent" button until resolved
   - Verify assumption checkboxes work
   - Verify edge case dropdowns work
   - Verify schedule configuration saves correctly

---

## 18. V6 + Intent Validation Technical Specification

This section provides the technical specification for the V6 agent creation pipeline with Intent Validation. See `docs/INTENT_VALIDATION_USER_FLOW.md` for the complete user flow documentation.

### 18.1 Architecture Overview

When `useV6AgentGeneration = true`, the agent creation uses a split API architecture with user interaction between grounding and compilation:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    V6 + INTENT VALIDATION FLOW                               │
│                    (when useV6AgentGeneration = true)                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  THREAD-BASED FLOW (No changes)                                              │
│  ═══════════════════════════════════════════════════════════════════════════ │
│                                                                              │
│  Raw Prompt → Phase 1 Analysis → Phase 2 Q&A → Phase 3 Enhanced Prompt       │
│       │                                                │                     │
│       │                                                ▼                     │
│       │                                        User clicks "Approve"         │
│       │                                                │                     │
│       ▼                                                ▼                     │
│  ═══════════════════════════════════════════════════════════════════════════ │
│  INTENT VALIDATION FLOW (New)                                                │
│  ═══════════════════════════════════════════════════════════════════════════ │
│                                                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ API CALL 1: /api/v6/generate-semantic-grounded                         │  │
│  │                                                                         │  │
│  │ Input:  enhanced_prompt (from Thread-Based Phase 3)                     │  │
│  │                                                                         │  │
│  │ Runs:                                                                   │  │
│  │   • V6 Phase 1: Semantic Understanding (~5-15s)                         │  │
│  │   • V6 Phase 2: Grounding (~100-500ms)                                  │  │
│  │   • NEW: 5-Layer Ambiguity Detection (~50-100ms)                        │  │
│  │                                                                         │  │
│  │ Output: semantic_plan, grounded_plan, ambiguity_report,                 │  │
│  │         assumptions, edge_cases                                         │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│       │                                                                      │
│       │  User sees: Loading indicator (~6-16 seconds)                        │
│       ▼                                                                      │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ 🎯 REVIEW & CUSTOMIZE UI                                                │  │
│  │                                                                         │  │
│  │ Displays:                                                               │  │
│  │   • Plan title & description (from semantic_plan)                       │  │
│  │   • REMAINING QUESTIONS (from grounding_ambiguities) - MANDATORY        │  │
│  │   • PLEASE CONFIRM (from must_confirm) - MANDATORY                      │  │
│  │   • ASSUMPTIONS (validated by grounding) - Optional                     │  │
│  │   • EDGE CASES (from semantic plan) - Optional                          │  │
│  │   • SCHEDULE & SETTINGS - Optional                                      │  │
│  │                                                                         │  │
│  │ Collects: ReviewUIDecisions (user's choices)                            │  │
│  │                                                                         │  │
│  │ [Create Agent] - disabled until mandatory items resolved                │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│       │                                                                      │
│       │  User clicks "Create Agent"                                          │
│       ▼                                                                      │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ API CALL 2: /api/v6/compile-with-decisions                             │  │
│  │                                                                         │  │
│  │ Input: grounded_plan + user_decisions + enhanced_prompt                 │  │
│  │                                                                         │  │
│  │ Runs:                                                                   │  │
│  │   • V6 Phase 3: IR Formalization (with user constraints) (~50-100ms)    │  │
│  │   • V6 Phase 4: Compilation (~50-100ms)                                 │  │
│  │   • V6 Phase 5: Normalization (~10-50ms)                                │  │
│  │                                                                         │  │
│  │ Output: workflow_steps, pilot_dsl, validation                           │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│       │                                                                      │
│       │  User sees: "Creating agent..." (~200-300ms)                         │
│       ▼                                                                      │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ API CALL 3: /api/create-agent (Existing - No Changes)                   │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
│       │                                                                      │
│       ▼                                                                      │
│  Navigate to /v2/sandbox/{agentId}                                           │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 18.2 New API Endpoints

> **Note:** The two new split APIs are **additions** to the existing V6 APIs. Existing APIs are kept for backwards compatibility, test page usage, and non-interactive flows.

| API | Status | Purpose |
|-----|--------|---------|
| `/api/v6/generate-ir-semantic` | **Keep (existing)** | Full 5-phase pipeline, single call, used by declarative test page |
| `/api/v6/compile-declarative` | **Keep (existing)** | Takes IR, compiles to workflow (Phase 4+5 only), used by declarative test page |
| `/api/v6/generate-semantic-grounded` | **New** | Phases 1+2 + 5-Layer Detection, returns data for Review UI |
| `/api/v6/compile-with-decisions` | **New** | Phase 3 (formalization with user constraints) + reuses `/api/v6/compile-declarative` logic for Phase 4+5 |

**Code Reuse:** `/api/v6/compile-with-decisions` will internally:
1. Run Phase 3 (IR Formalization) with user decisions applied
2. Call the same compilation logic as `/api/v6/compile-declarative` for Phase 4+5 (no duplication)

#### API 1: `/api/v6/generate-semantic-grounded`

**Purpose:** Run V6 Phases 1+2 + 5-Layer Detection, return data for Review UI

```typescript
// Request
POST /api/v6/generate-semantic-grounded
{
  enhanced_prompt: EnhancedPromptInput,
  userId: string,
  config?: {
    provider?: 'openai' | 'anthropic',
    skip_grounding?: boolean  // For testing
  }
}

// Response
{
  success: true,

  // Phase 1 output
  semantic_plan: {
    goal: string,
    intent: string,
    data_sources: DataSource[],
    actions: Action[],
    outputs: Output[],
    delivery: Delivery
  },

  // Phase 2 output
  grounded_plan: {
    ...semantic_plan,
    grounding_results: GroundingResult[],
    validated_fields: ValidatedField[],
    grounding_confidence: number
  },

  // 5-Layer Detection output (NEW)
  ambiguity_report: {
    must_confirm: MustConfirmItem[],      // Mandatory - blocks Create Agent
    should_review: ShouldReviewItem[],    // Expanded in UI
    looks_good: LooksGoodItem[],          // Collapsed in UI
    grounding_ambiguities: Ambiguity[],   // Discovered during grounding
    overall_confidence: number
  },

  // For Review UI
  assumptions: Assumption[],
  edge_cases: EdgeCase[],

  // Metadata
  metadata: {
    phase_times_ms: {
      understanding: number,
      grounding: number,
      ambiguity_detection: number
    },
    total_time_ms: number
  }
}
```

#### API 2: `/api/v6/compile-with-decisions`

**Purpose:** Run V6 Phases 3+4+5 with user's confirmed choices from Review UI

```typescript
// Request
POST /api/v6/compile-with-decisions
{
  grounded_plan: GroundedPlan,          // From API Call 1
  user_decisions: ReviewUIDecisions,     // From Review UI
  enhanced_prompt: EnhancedPromptInput,  // Original
  userId: string,
  config?: {
    provider?: 'openai' | 'anthropic'
  }
}

// Response
{
  success: true,

  // Phase 3 output
  ir: DeclarativeLogicalIR,

  // Phase 4+5 output
  workflow: {
    workflow_steps: WorkflowStep[],
    suggested_plugins: string[]
  },

  // Validation
  validation: {
    valid: boolean,
    issues: ValidationIssue[]
  },

  // Metadata
  metadata: {
    phase_times_ms: {
      formalization: number,
      compilation: number,
      normalization: number
    },
    total_time_ms: number,
    steps_generated: number
  }
}
```

### 18.3 Data Types

```typescript
// ═══════════════════════════════════════════════════════════════════════════
// 5-LAYER AMBIGUITY DETECTION TYPES
// ═══════════════════════════════════════════════════════════════════════════

interface MustConfirmItem {
  id: string;
  layer: 1 | 2 | 3 | 4 | 5;
  type: 'confidence_mismatch' | 'pattern_detected' | 'cross_conflict' |
        'vague_language' | 'business_risk' | 'fake_validation';
  title: string;
  description: string;
  options: ConfirmOption[];
  recommended?: string;  // ID of recommended option
}

interface ConfirmOption {
  id: string;
  label: string;
  description: string;
  impact?: string;
}

interface ShouldReviewItem {
  id: string;
  type: 'medium_confidence' | 'vague_detected' | 'conflict_potential';
  assumption: string;
  confidence: number;
  grounding_result?: string;
}

interface LooksGoodItem {
  id: string;
  assumption: string;
  confidence: number;
  validated_by: string;
}

interface Ambiguity {
  id: string;
  field: string;
  description: string;
  discovered_options: AmbiguityOption[];
  source: 'grounding' | 'semantic';
}

interface AmbiguityOption {
  id: string;
  label: string;
  metadata?: Record<string, any>;  // e.g., column position, sample values
}

// ═══════════════════════════════════════════════════════════════════════════
// REVIEW UI DECISIONS (User's choices from Review & Customize UI)
// ═══════════════════════════════════════════════════════════════════════════

interface ReviewUIDecisions {
  // Mandatory responses
  confirmed_patterns: Record<string, string>;     // { item_id: selected_option_id }
  resolved_ambiguities: Record<string, string>;   // { ambiguity_id: selected_option_id }
  fake_validation_acks: string[];                 // IDs of acknowledged fake validations

  // Optional responses
  approved_assumptions: string[];                 // IDs of approved assumptions
  disabled_assumptions: string[];                 // IDs user unchecked
  edge_case_handling: Record<string, string>;     // { edge_case_id: handling_option }

  // Consolidated from current flow (replaces separate steps)
  schedule_config: {
    mode: 'on_demand' | 'scheduled';
    cron?: string;
    timezone?: string;
  };

  input_parameters: Record<string, any>;          // Any input overrides
  notification_settings: {
    on_success: boolean;
    on_failure: boolean;
  };
}
```

### 18.4 Implementation Checklist

| Step | Task | Complexity | Code Familiarity | Notes |
|------|------|------------|------------------|-------|
| **1** | **Create 5-Layer Detection Module** | | | |
| 1.1 | Layer 1: Confidence mismatches | Medium | 🟡 Medium | Compare grounding vs semantic confidence |
| 1.2 | Layer 2: Semantic patterns (loop intent, data visibility) | High | 🟡 Medium | Pattern matching on semantic plan |
| 1.3 | Layer 3: Cross-assumption conflicts | Medium | 🟡 Medium | Compare assumptions against each other |
| 1.4 | Layer 4: Vague language detection | Low | 🟢 High | String/regex on enhanced prompt |
| 1.5 | Layer 5: Business risks (PII, irreversible) | Medium | 🟡 Medium | Field type and operation analysis |
| **2** | **Create `/api/v6/generate-semantic-grounded`** | Medium | 🟡 Medium | Orchestrate phases 1+2 + detection |
| **3** | **Create `/api/v6/compile-with-decisions`** | Medium | 🟡 Medium | Pass user constraints to IR formalizer |
| **4** | **Create Review & Customize UI** | | | |
| 4.1 | Plan header section | Low | 🟢 High | Simple display component |
| 4.2 | Remaining Questions section | Medium | 🟢 High | Dropdown/radio components |
| 4.3 | Please Confirm section | Medium | 🟢 High | Radio button groups |
| 4.4 | Assumptions section | Medium | 🟢 High | Collapsible checkboxes |
| 4.5 | Edge Cases section | Medium | 🟢 High | Dropdown selects |
| 4.6 | Schedule & Settings section | Low | 🔴 Low | May reuse existing components |
| **5** | **Modify `createAgent()` in page.tsx** | High | 🔴 Low | Main integration point |
| **6** | **Add `review_customize` phase** | Medium | 🔴 Low | New builder phase |
| **7** | **Update navigation to sandbox** | Low | 🟡 Medium | Simple router.push change |
| **8** | **Testing** | High | 🟡 Medium | End-to-end testing |

#### Familiarity Legend

| Level | Meaning |
|-------|---------|
| 🟢 High | Have read the code or standard patterns |
| 🟡 Medium | Have read documentation, understand concept |
| 🔴 Low | Haven't seen the code, need to explore |

### 18.5 Files to Read Before Implementation

| Priority | File | Purpose | For Steps |
|----------|------|---------|-----------|
| **High** | `app/v2/agents/new/page.tsx` | Main integration point | 5, 6 |
| **High** | `hooks/useAgentBuilderState.ts` | State management, phases | 5, 6 |
| **High** | `lib/agentkit/v6/semantic-plan/` | Semantic plan output structure | 1.1-1.5, 2 |
| **High** | `lib/agentkit/v6/grounding/` | Grounding output structure | 1.1, 2 |
| **Medium** | `lib/agentkit/v6/ir-formalizer/` | How to pass user constraints | 3 |
| **Medium** | `app/api/v6/generate-ir-semantic/route.ts` | Existing V6 orchestration | 2, 3 |
| **Low** | Current input params / schedule UI | May reuse for Review UI | 4.6 |

### 18.6 Recommended Implementation Order

```
Phase 2A: Research & Foundation
├── Read page.tsx and useAgentBuilderState.ts
├── Read V6 semantic plan and grounding code
└── Understand data structures

Phase 2B: Backend APIs
├── Step 2: /api/v6/generate-semantic-grounded
├── Step 1: 5-Layer Detection module (parallel)
└── Step 3: /api/v6/compile-with-decisions

Phase 2C: Frontend
├── Step 4: Review & Customize UI component
├── Step 6: Add review_customize phase
└── Step 5: Modify createAgent()

Phase 2D: Polish
├── Step 7: Navigation to sandbox
└── Step 8: Testing
```

### 18.7 New Files Created

> **Status**: All Phase A files have been created. Verified January 21, 2026.

| File | Purpose | Status |
|------|---------|--------|
| `lib/agentkit/v6/ambiguity-detection/index.ts` | 5-Layer Detection entry point | ✅ Created |
| `lib/agentkit/v6/ambiguity-detection/types.ts` | TypeScript interfaces | ✅ Created |
| `lib/agentkit/v6/ambiguity-detection/detector.ts` | Main detector orchestration | ✅ Created |
| `lib/agentkit/v6/ambiguity-detection/layers/layer1-confidence.ts` | Confidence mismatch detection | ✅ Created |
| `lib/agentkit/v6/ambiguity-detection/layers/layer2-patterns.ts` | Semantic pattern detection | ✅ Created |
| `lib/agentkit/v6/ambiguity-detection/layers/layer3-conflicts.ts` | Cross-assumption conflicts | ✅ Created |
| `lib/agentkit/v6/ambiguity-detection/layers/layer4-vague.ts` | Vague language detection | ✅ Created |
| `lib/agentkit/v6/ambiguity-detection/layers/layer5-business.ts` | Business risk detection | ✅ Created |
| `app/api/v6/generate-semantic-grounded/route.ts` | API endpoint for phases 1+2 | ✅ Created |
| `app/api/v6/compile-with-decisions/route.ts` | API endpoint for phases 3+4+5 | ✅ Created |
| `components/v6/V6ReviewCustomizeUI.tsx` | Main Review UI component (single file with all sections) | ✅ Created |
| `components/v6/V6WorkflowPreview.tsx` | Workflow preview component shown after compilation | ✅ Created |

> **Note**: The Review UI is implemented as a single component (`V6ReviewCustomizeUI.tsx`) rather than separate sub-components. All sections (Plan Header, Remaining Questions, Please Confirm, Assumptions, Edge Cases, Schedule & Settings) are included in this file.

> **V6WorkflowPreview Component**: Displays compiled workflow steps in a visual format for user approval before saving as an agent. Features include:
> - Visual step cards with type icons (operation, transform, conditional, scatter_gather)
> - Plugin badges showing which service each step uses
> - Expandable step details showing inputs, config, and nested steps
> - User decisions summary (confirmed patterns, resolved ambiguities)
> - Action buttons: Go Back, Copy JSON, Approve & Save Agent

### 18.8 Files to Modify

| File | Changes |
|------|---------|
| `app/v2/agents/new/page.tsx` | Add Review UI phase, split createAgent() flow |
| `hooks/useAgentBuilderState.ts` | Add `review_customize` phase, store semantic/grounded data |
| `lib/agentkit/v6/ir-formalizer/` | Accept user_decisions as constraints |

### 18.9 What Changes for Users

| Before (Current V4) | After (V6 + Intent Validation) |
|---------------------|--------------------------------|
| Q&A Chat → Approve Plan → Input Params → Schedule → Draft Review → Create | Q&A Chat → Approve Plan → **Review & Customize** → Create |
| 5 interaction points after plan | **1 interaction point** after plan |
| Assumptions hidden | Assumptions surfaced and validated |
| Edge cases not shown | Edge cases with handling options |
| Patterns not detected | 5-layer detection catches issues |
| No grounding validation | Real data validation before compilation |

### 18.10 Related Documentation

- `docs/INTENT_VALIDATION_USER_FLOW.md` - Complete user flow and UI mockups
- `docs/shadow-critic-architecture.md` - 5-Layer detection concepts

### 18.11 Review UI Section Mapping to Data Structures

The Review UI sections map to **existing data structures** from semantic plan and grounding. This clarifies exactly where each section's data comes from:

| Review UI Section | Source | Field Path | Notes |
|-------------------|--------|------------|-------|
| **Plan Header** | `semantic_plan` | `goal`, `understanding.data_sources[0].source_description` | Display only |
| **Remaining Questions** | `semantic_plan` | `ambiguities[]` where `requires_user_input: true` | Already exists in semantic plan |
| **Please Confirm** | `grounding_results` + 5-layer | Low confidence items OR `grounding_errors[]` | 5-layer classifies these |
| **Assumptions** | `grounding_results` | Where `validated: true` AND `confidence >= 0.8` | Pre-checked by default |
| **Edge Cases** | `semantic_plan` | `understanding.edge_cases[]` | Already exists |
| **Schedule & Settings** | `enhanced_prompt` | `specifics.trigger_scope`, existing schedule logic | From thread flow |

**Key Insight:** The semantic plan and grounding **already contain** most of the data we need. The 5-Layer Detection module **classifies and categorizes** this existing data into the Review UI sections - it doesn't generate new data.

### 18.12 5-Layer Detection: Classification Not Generation

The 5-Layer Detection module **analyzes existing data** from semantic plan and grounding, then classifies items into Review UI categories:

| Layer | Input Data | Classification Output |
|-------|------------|----------------------|
| **Layer 1: Confidence Mismatches** | `grounding_results[].confidence` vs `assumptions[].confidence` | `must_confirm[]` if grounding < semantic |
| **Layer 2: Semantic Patterns** | `understanding.delivery`, `understanding.grouping` | `must_confirm[]` if per_item vs per_group ambiguous |
| **Layer 3: Cross-Assumption Conflicts** | `assumptions[]` entries | `must_confirm[]` if assumptions contradict |
| **Layer 4: Vague Language** | `enhanced_prompt` text, `ambiguities[]` | `should_review[]` items |
| **Layer 5: Business Risks** | `assumptions[].impact_if_wrong`, field types | `must_confirm[]` if critical impact |

**Implementation Approach:**
```typescript
// 5-Layer Detection is ANALYSIS, not generation
function detectAmbiguities(
  semanticPlan: SemanticPlan,
  groundedPlan: GroundedSemanticPlan,
  enhancedPrompt: EnhancedPrompt
): AmbiguityReport {
  // Read existing data, classify into categories
  const mustConfirm = [];
  const shouldReview = [];
  const looksGood = [];

  // Layer 1: Compare confidence scores
  for (const result of groundedPlan.grounding_results) {
    const assumption = semanticPlan.assumptions.find(a => a.id === result.assumption_id);
    if (result.confidence < getConfidenceThreshold(assumption)) {
      mustConfirm.push(createConfidenceMismatchItem(result, assumption));
    }
  }

  // ... other layers classify existing data ...

  return { must_confirm: mustConfirm, should_review: shouldReview, looks_good: looksGood };
}
```

### 18.13 User Decisions → IR Formalizer Transformation

The IR Formalizer already supports `resolvedUserInputs`. We need to transform Review UI decisions into this format:

**Input (from Review UI):**
```typescript
ReviewUIDecisions {
  resolved_ambiguities: {
    "ambiguity_stage_column": "Stage (Column D)"    // User picked from dropdown
  },
  confirmed_patterns: {
    "pattern_email_delivery": "per_person"          // User picked "one email per person"
  },
  disabled_assumptions: ["assumption_id_123"],      // User unchecked this
  edge_case_handling: {
    "edge_empty_data": "skip_silently"              // User picked handling option
  }
}
```

**Output (for IR Formalizer):**
```typescript
resolvedUserInputs: [
  { key: "Stage_column", value: "Stage" },              // From resolved ambiguity
  { key: "email_delivery_mode", value: "per_person" },  // From confirmed pattern
  { key: "empty_data_handling", value: "skip" }         // From edge case
]

// Also pass to grounded plan modification:
disabledAssumptions: ["assumption_id_123"]  // These get marked as skipped
```

**Transformation Logic:**
```typescript
function transformDecisionsForIRFormalizer(
  decisions: ReviewUIDecisions,
  groundedPlan: GroundedSemanticPlan
): { resolvedUserInputs: Array<{key: string, value: any}>, modifiedGroundedPlan: GroundedSemanticPlan } {

  const resolvedUserInputs = [];

  // 1. Resolved ambiguities → direct field overrides
  for (const [ambiguityId, selectedValue] of Object.entries(decisions.resolved_ambiguities)) {
    const ambiguity = findAmbiguity(groundedPlan, ambiguityId);
    resolvedUserInputs.push({
      key: ambiguity.field,
      value: selectedValue
    });
  }

  // 2. Confirmed patterns → behavior flags
  for (const [patternId, selectedOption] of Object.entries(decisions.confirmed_patterns)) {
    resolvedUserInputs.push({
      key: patternId.replace('pattern_', ''),
      value: selectedOption
    });
  }

  // 3. Disabled assumptions → mark as skipped in grounded plan
  const modifiedGroundedPlan = { ...groundedPlan };
  for (const assumptionId of decisions.disabled_assumptions) {
    const resultIndex = modifiedGroundedPlan.grounding_results.findIndex(
      r => r.assumption_id === assumptionId
    );
    if (resultIndex >= 0) {
      modifiedGroundedPlan.grounding_results[resultIndex].skipped = true;
      modifiedGroundedPlan.grounding_results[resultIndex].validation_method = 'user_disabled';
    }
  }

  return { resolvedUserInputs, modifiedGroundedPlan };
}
```

### 18.14 Test Page Button Placement

In `test-plugins-v2` Tab 3, after Phase 3 Enhanced Prompt is displayed, the existing buttons are:

```
┌─────────────────────────────────────────────────────────────────┐
│ Enhanced Prompt Display (Phase 3)                               │
│ ───────────────────────────────────────────────────────────────│
│                                                                 │
│ [🔬 Test V6 + Intent Validation]  ← NEW BUTTON (add FIRST)     │
│                                                                 │
│ [🔧 Generate Technical Workflow (Phase 4)]  ← Existing          │
│ [Accept Plan (Skip Phase 4)]                ← Existing          │
│ [Refine Further]                            ← Existing          │
│ [📥 Download JSON]                          ← Existing          │
└─────────────────────────────────────────────────────────────────┘
```

The new button should be **visually distinct** (different color/style) to indicate it's an alternative V6 path, not part of the existing Phase 4 flow.

**Button Click Handler:**
```typescript
const handleTestV6IntentValidation = async () => {
  setV6IntentValidationActive(true);
  setV6IsLoading(true);

  // API Call 1: Generate semantic + grounded plan
  const response = await fetch('/api/v6/generate-semantic-grounded', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      enhanced_prompt: enhancedPrompt,  // From Phase 3
      userId: userId,
      config: { provider: 'openai' }
    })
  });

  const data = await response.json();
  setV6SemanticGroundedResponse(data);
  setV6IsLoading(false);

  // Review UI will now render based on this data
};
```

### 18.15 Logging Standards

All new files created for V6 + Intent Validation **must follow** the structured logging guidelines in `docs/SYSTEM_LOGGING_GUIDELINES.md`. This ensures consistent, queryable logs for debugging and monitoring.

#### Quick Reference

**Server-Side (API Routes & Services):**
```typescript
import { createLogger } from '@/lib/logger'

// Create module-scoped logger
const logger = createLogger({ module: 'V6', service: 'AmbiguityDetection' })

// In API routes - add correlation ID
export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID()
  const requestLogger = logger.child({ correlationId, route: '/api/v6/generate-semantic-grounded' })
  const startTime = Date.now()

  requestLogger.info('Request received')

  try {
    // ... processing ...
    const duration = Date.now() - startTime
    requestLogger.info({ duration, stepsGenerated: 5 }, 'Request completed')
  } catch (error) {
    const duration = Date.now() - startTime
    requestLogger.error({ err: error, duration }, 'Request failed')
  }
}
```

#### Required Logging for New Files

| File | Logger Context | Key Log Points |
|------|---------------|----------------|
| `/api/v6/generate-semantic-grounded/route.ts` | `{ module: 'V6', route: '/api/v6/generate-semantic-grounded' }` | Request start, Phase 1 complete, Phase 2 complete, 5-layer detection complete, response |
| `/api/v6/compile-with-decisions/route.ts` | `{ module: 'V6', route: '/api/v6/compile-with-decisions' }` | Request start, decisions received, Phase 3 complete, Phase 4+5 complete, response |
| `lib/agentkit/v6/ambiguity-detection/detector.ts` | `{ module: 'V6', service: 'AmbiguityDetector' }` | Detection start, each layer result count, overall confidence, detection complete |
| `lib/agentkit/v6/ambiguity-detection/layers/*.ts` | `{ module: 'V6', service: 'AmbiguityDetection', layer: N }` | Items detected per category |

#### Log Levels for V6 Components

| Scenario | Level | Example |
|----------|-------|---------|
| API request received/completed | `info` | `requestLogger.info({ duration }, 'Request completed')` |
| Phase timing metrics | `info` | `logger.info({ phase: 1, duration: 5200 }, 'Phase 1 complete')` |
| Layer detection results | `debug` | `logger.debug({ mustConfirm: 2, shouldReview: 3 }, 'Layer 1 detection complete')` |
| User decisions received | `debug` | `logger.debug({ decisionsCount: 5 }, 'Processing user decisions')` |
| Slow operation (>5s) | `warn` | `logger.warn({ duration: 8500 }, 'Slow semantic plan generation')` |
| Validation failure | `error` | `logger.error({ err: error }, 'IR validation failed')` |
| Unexpected state | `error` | `logger.error({ expected: 'array', got: typeof input }, 'Invalid input type')` |

#### Standard Field Names

Use these consistently across all V6 files:

```typescript
// Timing
duration         // Operation duration in ms
phase            // Phase number (1-5)
layer            // Detection layer (1-5)

// Counts
mustConfirmCount     // Number of must_confirm items
shouldReviewCount    // Number of should_review items
looksGoodCount       // Number of looks_good items
stepsGenerated       // Number of workflow steps

// Identifiers
correlationId    // Request correlation ID
userId           // User identifier
assumptionId     // Assumption being processed

// Confidence
groundingConfidence  // Overall grounding confidence (0-1)
overallConfidence    // Detection overall confidence (0-1)
```

#### Example: 5-Layer Detection Logging

```typescript
// In detector.ts
export class AmbiguityDetector {
  private logger = createLogger({ module: 'V6', service: 'AmbiguityDetector' })

  detect(context: DetectionContext): AmbiguityReport {
    const startTime = Date.now()
    this.logger.info('Starting 5-layer detection')

    // Run layers
    const layer1 = detectConfidenceMismatches(context)
    this.logger.debug({
      layer: 1,
      mustConfirmCount: layer1.must_confirm.length,
      shouldReviewCount: layer1.should_review.length
    }, 'Layer 1 complete')

    // ... other layers ...

    const duration = Date.now() - startTime
    this.logger.info({
      duration,
      mustConfirmCount: allMustConfirm.length,
      shouldReviewCount: allShouldReview.length,
      looksGoodCount: filteredLooksGood.length,
      overallConfidence: confidence
    }, 'Detection complete')

    return report
  }
}
```

#### Migration Status

**Completed:**
| File | Status |
|------|--------|
| `app/api/v6/generate-semantic-grounded/route.ts` | ✅ Migrated to `createLogger()` |
| `lib/agentkit/v6/ambiguity-detection/detector.ts` | ✅ Migrated to `createLogger()` |
| `app/api/v6/compile-with-decisions/route.ts` | ✅ Created with `createLogger()` |

**Pending (optional, for debug-level logging):**
| File | Status |
|------|--------|
| `lib/agentkit/v6/ambiguity-detection/layers/*.ts` | Consider adding debug-level logging |

---

## 19. Known Issues / Bugs Identified

> **Note**: Issues discovered during testing that need to be addressed separately from this integration. Review after implementation to validate if still relevant.

### 19.1 Scatter-Gather After Group Transform - Wrong Variable Reference

**Status**: Identified, Not Fixed
**Severity**: High (causes runtime failure)
**Discovered**: January 18, 2026

**Problem**:
When a `scatter_gather` step follows a `group` transform, the LLM compiler generates `{{stepX.data}}` but the group transform outputs an **object**, not an array. The scatter_gather expects an array to iterate over.

**Error Message**:
```
ExecutionError: Scatter-gather step stepX: input must resolve to an array, got object
```

**Root Cause**:
The group transform returns a structured object:
```typescript
{
  grouped: {},     // Object: { "key1": [...], "key2": [...] }
  groups: [],      // Array: [{key, items, count}, ...] ← SHOULD USE THIS
  keys: [],        // Array of unique keys
  count: 0         // Number of groups
}
```

The scatter_gather should reference `{{stepX.data.groups}}` (the array) not `{{stepX.data}}` (the whole object).

**Affected File**:
`lib/agentkit/v6/compiler/IRToDSLCompiler.ts` - `fixVariableReferences()` method (lines 227-288)

**Suggested Fix** (Two-part):

**Part A - Post-Processing Fix** (in `fixVariableReferences()`):
```typescript
// Track group transform steps
const groupTransformSteps = new Set<string>()

workflow.forEach(step => {
  if (step.type === 'transform' && step.operation === 'group') {
    groupTransformSteps.add(step.id)
  }
})

// In unwrapVariableReference(), add:
if (groupTransformSteps.has(stepId)) {
  return `{{${stepId}.data.groups}}`
}
```

**Part B - LLM Prompt Enhancement** (in `buildSystemPrompt()` around line 967):
```
## Group Transform + Scatter_Gather Pattern (CRITICAL)

When scatter_gather follows a group transform step:
- Group transform outputs: {grouped: {}, groups: [{key, items}...], keys: [], count: N}
- ✅ CORRECT: scatter.input = "{{stepX.data.groups}}"
- ❌ WRONG: scatter.input = "{{stepX.data}}"
```

**Priority**: Should be fixed before V6 is enabled in production.

---

### 19.2 IR Formalization Schema Mismatch

**Status**: Identified, Not Fixed
**Severity**: High (causes IR validation failure, blocks compilation)
**Discovered**: January 18, 2026

**Problem**:
The Phase 3 IR Formalizer (LLM) generates IR structures that don't conform to the `DeclarativeLogicalIR` schema. The IR validation fails before compilation can begin.

**Error Message**:
```
POST /api/v6/compile-declarative 400
[API] ✗ Declarative IR validation failed
```

**Specific Schema Violations Found**:

#### Issue A: `normalization` object structure mismatch

LLM generates:
```json
"normalization": {
  "description": "...",
  "fields": [{ "field": "Stage", "operation": "trim_and_coerce_number" }]
}
```

Schema expects:
```json
"normalization": {
  "required_headers": [...],
  "case_sensitive": boolean,
  "missing_header_action": "skip" | "error" | "use_default"
}
```

**Errors**: Extra properties (`description`, `fields`), missing required (`required_headers`, `case_sensitive`, `missing_header_action`)

#### Issue B: `per_group_delivery` has disallowed `config` property

LLM generates:
```json
"per_group_delivery": {
  "plugin_key": "google-mail",
  "operation_type": "send_email",
  "config": { "recipients": {...}, "content": {...} }  // ← NOT ALLOWED
}
```

**Error**: `config` is not in the schema for `per_group_delivery`

**Root Cause**:
Phase 3 (IR Formalization) LLM is generating fields that don't exist in the schema, likely due to:
1. Outdated or incomplete schema examples in the prompt
2. LLM hallucinating reasonable-sounding but non-existent fields
3. Schema evolution without corresponding prompt updates

**Affected Component**:
Phase 3 - IR Formalizer (`lib/agentkit/v6/logical-ir/` or formalization prompt)

**Suggested Fixes**:

1. **Update Phase 3 prompt** with exact schema definition and stricter examples
2. **Add validation feedback loop** - if IR validation fails, feed errors back to LLM for retry
3. **Review schema** - if `normalization.fields` and `config` are actually useful, consider adding them to the schema

**Priority**: High - blocks IR compilation entirely.

---

*V6 Agent Generation System - Neuronforge*
