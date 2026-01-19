# V6 Agent Creation Integration Plan

> **Status**: Implementation In Progress - Ready for Testing
> **Created**: January 17, 2026
> **Updated**: January 18, 2026 - Steps 1-3 Complete, Step 4 Pending User Testing

This document outlines the implementation plan for integrating V6 agent generation into the existing agent creation flow.

---

## 1. Overview

### Goal
Add V6 as an optional agent generation method (controlled via feature flag) that users can choose during agent creation. After successful agent creation, navigate to the agent sandbox page instead of the agent detail page.

### Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **API Approach** | Single API call | `/api/v6/generate-ir-semantic` already runs all 5 phases |
| **Expected Duration** | ~8-15 seconds | Phase 1 (LLM) takes most time; Phases 2-5 are fast |
| **Error Handling** | Show error, no fallback | Per user request |
| **Post-Creation Navigation** | `/v2/sandbox/[agentId]` | User confirmed sandbox page |
| **Feature Flag Type** | Environment-based | Follows existing pattern |

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

## 4. V6 API Details

### Single API Call

`/api/v6/generate-ir-semantic` already orchestrates **all 5 phases** in one call:

| Phase | Description | Typical Time |
|-------|-------------|--------------|
| Phase 1 | Understanding (Semantic Plan) | 5-20 sec |
| Phase 2 | Grounding (Assumption Validation) | 100-500 ms |
| Phase 3 | Formalization (IR Generation) | 50-100 ms |
| Phase 4 | Compilation (PILOT DSL) | 50-100 ms |
| Phase 5 | Normalization | 10-50 ms |

**Total: ~8-15 seconds** (mostly Phase 1)

### V6 API Response Structure

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

  return {
    id: context.agentId,
    user_id: context.userId,
    agent_name: semanticPlan?.goal ||
                context.enhancedPromptData?.plan_title ||
                'New Agent',
    user_prompt: context.initialPrompt || '',
    system_prompt: '',  // V6 focuses on workflow, not system prompts
    description: context.enhancedPromptData?.plan_description ||
                 semanticPlan?.goal ||
                 '',
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
    agent_config: {
      mode: 'on_demand',
      metadata: {
        version: '6.0',
        generator_version: 'v6',
        generation_method: 'v6_semantic_5_phase',
        agent_id: context.agentId,
        session_id: context.sessionId,
        prompt_type: 'enhanced',
        architecture: 'semantic_plan_5_phase',
        latency_ms: context.latencyMs,
        phase_times_ms: metadata.phase_times_ms,
        grounding_confidence: metadata.grounding_confidence,
        steps_generated: metadata.steps_generated
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

### Modified Flow

```typescript
const createAgent = async (useEnhanced: boolean = true) => {
  // ... existing setup code (lines 660-694) ...

  const useV6 = useV6AgentGeneration();  // Import from featureFlags

  if (useV6) {
    // === V6 FLOW (Single API Call) ===
    console.log('🚀 Using V6 5-phase semantic pipeline...')

    // Show loading message
    addTypingIndicator()
    addAIMessage('🔍 Generating your workflow using V6 semantic pipeline...')

    const v6StartTime = Date.now();

    // Single API call - runs all 5 phases
    const v6Response = await fetch('/api/v6/generate-ir-semantic', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-id': user.id,
        'x-session-id': sessionId.current,
        'x-agent-id': agentId.current
      },
      body: JSON.stringify({
        enhanced_prompt: enhancedPromptData,
        userId: user.id,
        config: {
          return_intermediate_results: true,  // Get semantic plan for agent name
          provider: 'openai'
        }
      })
    });

    if (!v6Response.ok) {
      const error = await v6Response.json();
      throw new Error(error.error || error.details || 'V6 generation failed');
    }

    const v6Data = await v6Response.json();
    const v6LatencyMs = Date.now() - v6StartTime;

    // Update status
    removeTypingIndicator()
    addAIMessage('✅ Workflow generated successfully!')

    // Map V6 response to agent object (V4-compatible)
    const generatedAgent = mapV6ResponseToAgent(v6Data, {
      agentId: agentId.current,
      userId: user.id,
      sessionId: sessionId.current,
      initialPrompt: initialPrompt || '',
      enhancedPromptData,
      connectedPlugins,
      latencyMs: v6LatencyMs
    });

    console.log('✅ V6 Agent generated:', generatedAgent.agent_name);
    console.log(`⏱️ V6 Total time: ${v6LatencyMs}ms`);
    console.log(`📊 Phase times:`, v6Data.metadata?.phase_times_ms);

    // Build agent config (same as V4 flow)
    const agentConfig: CreateAgentConfig = {
      creation_metadata: {
        ai_generated_at: new Date().toISOString(),
        session_id: sessionId.current,
        agent_id: agentId.current,
        thread_id: threadId || '',
        prompt_type: 'enhanced',
        clarification_answers: builderState.clarificationAnswers,
        version: '6.0',
        platform_version: 'v6.0',
        enhanced_prompt_data: enhancedPromptData
      },
      ai_context: {
        reasoning: generatedAgent.ai_reasoning,
        confidence: generatedAgent.ai_confidence,
        original_prompt: initialPrompt || '',
        enhanced_prompt: builderState.enhancedPrompt || '',
        generated_plan: ''
      }
    };

    // Build agent data (same structure as V4)
    const agentData: CreateAgentData = {
      ...generatedAgent,
      agent_config: agentConfig,
      schedule_cron: null,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      mode: 'on_demand',
      status: 'draft'
    };

    // Store agent data and continue with existing flow
    setPendingAgentData(agentData);

    // Continue to input parameters / scheduling (existing code)
    // ...

  } else {
    // === EXISTING V4 FLOW ===
    // ... existing V4 code (lines 696-815) ...
  }
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

| File | Changes |
|------|---------|
| `lib/utils/featureFlags.ts` | Add `useV6AgentGeneration()` function |
| `app/v2/agents/new/page.tsx` | Add V6 branch in `createAgent()`, add `mapV6ResponseToAgent()` helper, change navigation to sandbox |
| `.env.example` | Add `NEXT_PUBLIC_USE_V6_AGENT_GENERATION=false` |
| `docs/feature_flags.md` | Document new flag |
| `lib/utils/__tests__/featureFlags.test.ts` | Add tests for new flag |

---

## 11. Implementation Steps

### Step 1: Feature Flag ✅ COMPLETE
1. ✅ Added `useV6AgentGeneration()` to `lib/utils/featureFlags.ts`
2. ✅ Updated `getFeatureFlags()` to include new flag
3. ✅ Added to `.env.example`
4. ✅ Added tests to `lib/utils/__tests__/featureFlags.test.ts` (11 test cases)

**Additional Improvement**: Refactored all feature flag functions to use a shared `parseBooleanFlag()` private helper, reducing code duplication.

### Step 2: Agent Mapping Helper ✅ COMPLETE
1. ✅ Added `mapV6ResponseToAgent()` function to `app/v2/agents/new/page.tsx` (lines 147-214)
2. ✅ Added `extractInputSchema()` helper function (lines 109-138)
3. ✅ Defined TypeScript types: `V6GenerateResponse` (lines 53-88) and `InputSchemaItem` (lines 93-101)

### Step 3: V6 Integration in `createAgent()` ✅ COMPLETE
1. ✅ Imported `useV6AgentGeneration` at top of file
2. ✅ Added feature flag check at start of `createAgent()`
3. ✅ Implemented V6 API call (single call to `/api/v6/generate-ir-semantic`) (lines 875-966)
4. ✅ Map V6 response to agent object using helper
5. ✅ Continue with existing flow (input params, scheduling)

**Note**: Fixed issue where `generatedAgent.agent.input_schema` was referenced (V4 only). Changed to `agentData.input_schema` which works for both V6 and V4 flows.

### Step 4: Navigation Change ⏳ PENDING (After User Testing)
1. In `executeAgentCreation()`, change:
   ```typescript
   // From:
   router.push(`/agents/${result.agent.id}`)
   // To:
   router.push(`/v2/sandbox/${result.agent.id}`)
   ```

**Status**: User wants to test current implementation before proceeding. Currently navigates to `/agents/[id]` (edit page).

### Step 5: Error Handling ⏳ PENDING
1. ✅ Basic try-catch in V6 branch already included
2. ⏳ Review error handling after testing
3. ✅ No fallback to V4 (per user requirement)

### Step 6: Documentation Update ⏳ PENDING
1. ⏳ Update `docs/feature_flags.md` with new flag
2. ✅ This document updated with implementation status

### Step 7: Testing ⏳ IN PROGRESS
1. ⏳ Test V6 flow end-to-end with flag enabled
2. ⏳ Test V4 flow (regression) with flag disabled
3. ⏳ Test feature flag toggle
4. ⏳ Test error scenarios
5. ⏳ Test navigation to sandbox

---

## 12. Rollout Strategy

### Phase 1: Internal Testing
```bash
# .env.local
NEXT_PUBLIC_USE_V6_AGENT_GENERATION=true
```

### Phase 2: Production (Default Off)
```bash
# .env.production
NEXT_PUBLIC_USE_V6_AGENT_GENERATION=false
```

### Phase 3: Gradual Rollout
Enable for specific users or percentage-based rollout (requires future infrastructure).

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

- [x] Feature flag controls V6 vs V4 generation
- [ ] V6 generation completes successfully with valid workflow *(Ready for testing)*
- [x] Agent object matches V4 structure (compatible with `/api/create-agent`)
- [ ] Agent saved to database with correct `pilot_steps` format *(Ready for testing)*
- [ ] Navigation goes to sandbox page after creation *(Step 4 pending)*
- [x] Error handling shows meaningful messages
- [x] V4 flow unchanged when flag is off
- [ ] Documentation updated *(Step 6 pending)*

---

## 15. Open Questions

1. **System Prompt**: V6 focuses on workflow generation. Should we generate a system prompt separately or leave empty?

2. **Input Schema Enhancement**: The `extractInputSchema()` helper parses `{{input.x}}` patterns. Should we also look at the IR for declared inputs?

3. **Confidence Score**: V6 returns `grounding_confidence`. Is this suitable for `ai_confidence` or should we calculate differently?

---

## Approval

- [x] Plan reviewed and approved
- [x] Ready for implementation
- [x] Implementation started (January 18, 2026)
- [ ] User testing complete
- [ ] Full implementation complete

---

## 17. Testing Instructions

To test the V6 agent creation flow:

1. **Enable the feature flag** in `.env.local`:
   ```bash
   NEXT_PUBLIC_USE_V6_AGENT_GENERATION=true
   ```

2. **Restart the dev server**:
   ```bash
   npm run dev
   ```

3. **Navigate to agent creation**: `/v2/agents/new`

4. **Create an agent** with any prompt and complete the flow

5. **Expected behavior**:
   - Console should log: `🚀 Using V6 5-phase semantic pipeline...`
   - UI should show: "🔍 Generating your workflow using V6 semantic pipeline..."
   - After ~8-15 seconds, workflow should be generated
   - Agent should be saved to database
   - Navigation should go to `/agents/[id]` (edit page) - *sandbox navigation pending Step 4*

6. **Verify V4 still works** by setting flag to `false`

---

## 18. Known Issues / Bugs Identified

Issues discovered during testing that need to be addressed separately from this integration.

### 18.1 Scatter-Gather After Group Transform - Wrong Variable Reference

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

### 18.2 IR Formalization Schema Mismatch

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
