# Feature Flags

> **Last Updated**: February 8, 2026
> **Version**: 1.1.0

This document describes the feature flag system used in NeuronForge for gradual rollouts, A/B testing, and feature toggling.

---

## Change History

| Date | Version | Author | Changes |
|------|---------|--------|---------|
| 2026-02-08 | 1.1.0 | - | Added `useV6AgentGeneration` flag. Clarified that Thread-Based and New UI flags are for legacy route only. Expanded database-based flags documentation with detailed sections for each orchestration flag. |
| 2026-01-17 | 1.0.0 | - | Initial documentation created. Documented 3 environment-based flags and 4 database-based orchestration flags. |

---

## Overview

Feature flags allow you to enable or disable features without code changes. NeuronForge uses two types of feature flags:

1. **Environment-based flags** - Configured via `.env` files
2. **Database-based flags** - Stored in the database (orchestration features)

---

## Environment-Based Feature Flags

### Location

Feature flag functions are defined in:
- **Source**: [featureFlags.ts](lib/utils/featureFlags.ts)
- **Tests**: [featureFlags.test.ts](lib/utils/__tests__/featureFlags.test.ts)

### Available Flags

| Flag | Environment Variable | Scope | Default | Active Routes |
|------|---------------------|-------|---------|---------------|
| V6 Agent Generation | `NEXT_PUBLIC_USE_V6_AGENT_GENERATION` | Client | `false` | `/v2/agents/new`, `/test-plugins-v2` |
| Enhanced Technical Workflow Review | `USE_AGENT_GENERATION_ENHANCED_TECHNICAL_WORKFLOW_REVIEW` | Server | `false` | `/v2/agents/new`, `/test-plugins-v2` (via API) |
| Thread-Based Agent Creation | `NEXT_PUBLIC_USE_THREAD_BASED_AGENT_CREATION` | Client | `false` | Legacy: `/agents/new/chat` only |
| New Agent Creation UI | `NEXT_PUBLIC_USE_NEW_AGENT_CREATION_UI` | Client | `false` | Legacy: `/agents/new/chat` only |

---

## Flag Details

### 1. V6 Agent Generation

**Environment Variable**: `NEXT_PUBLIC_USE_V6_AGENT_GENERATION`

**Purpose**: Enables the V6 5-phase agent generation pipeline (semantic plan → grounding → formalization → compilation → validation) instead of the V4 direct generation approach.

**Function**: `useV6AgentGeneration()`

**Used In**:
- [v2/agents/new/page.tsx](app/v2/agents/new/page.tsx) - Main agent creation page
- [test-plugins-v2/page.tsx](app/test-plugins-v2/page.tsx) - Plugin testing page

**Values**:
- `true` or `1` - Use V6 5-phase pipeline
- `false`, `0`, or omit - Use V4 direct generation

```typescript
import { useV6AgentGeneration } from '@/lib/utils/featureFlags';

const useV6 = useV6AgentGeneration();

if (useV6) {
  // Call /api/v6/generate-ir-semantic
} else {
  // Call /api/generate-agent-v4
}
```

---

### 2. Enhanced Technical Workflow Review (V5 Generator)

**Environment Variable**: `USE_AGENT_GENERATION_ENHANCED_TECHNICAL_WORKFLOW_REVIEW`

**Purpose**: Enables the V5 workflow generator with LLM-based technical workflow review and repair before DSL building. Validates against plugin schemas and fixes issues like missing steps or invalid references.

**Function**: `useEnhancedTechnicalWorkflowReview()`

**Used In**:
- [generate-agent-v4/route.ts](app/api/generate-agent-v4/route.ts)

**Values**:
- `true` or `1` - Use V5 generator with LLM review
- `false`, `0`, or omit - Use V4 generator

> **Note**: This is a server-side only flag (no `NEXT_PUBLIC_` prefix). It cannot be accessed from client-side code.

```typescript
import { useEnhancedTechnicalWorkflowReview } from '@/lib/utils/featureFlags';

const useV5 = useEnhancedTechnicalWorkflowReview();

const generator = useV5
  ? new V5WorkflowGenerator(plugins, userId, agentId)
  : new V4WorkflowGenerator(plugins, userId, agentId);
```

---

## Legacy Flags

> **Note**: The following flags are only used in the legacy agent creation route (`/agents/new/chat`). They do NOT affect the current `/v2/agents/new` or `/test-plugins-v2` pages.

### 3. Thread-Based Agent Creation (Legacy)

**Environment Variable**: `NEXT_PUBLIC_USE_THREAD_BASED_AGENT_CREATION`

**Purpose**: Enables OpenAI Threads API for the agent creation flow (phases 1-3: analyze, clarify, enhance). Provides approximately 36% token savings via prompt caching.

**Function**: `useThreadBasedAgentCreation()`

**Used In** (legacy route only):
- [useConversationalBuilder.ts](components/agent-creation/useConversationalBuilder.ts)
- [useThreadManagement.ts](components/agent-creation/conversational/hooks/useThreadManagement.ts)

**Values**:
- `true` or `1` - Use OpenAI Threads API
- `false`, `0`, or omit - Use legacy sequential API calls

```typescript
import { useThreadBasedAgentCreation } from '@/lib/utils/featureFlags';

const useThreadFlow = useThreadBasedAgentCreation();

if (useThreadFlow) {
  // Use thread-based flow with caching
} else {
  // Use legacy sequential API calls
}
```

---

### 4. New Agent Creation UI (Legacy)

**Environment Variable**: `NEXT_PUBLIC_USE_NEW_AGENT_CREATION_UI`

**Purpose**: Toggles between `ConversationalAgentBuilderV2` and legacy `ConversationalAgentBuilder` in the old `/agents/new/chat` route.

**Function**: `useNewAgentCreationUI()`

**Used In** (legacy route only):
- [AgentBuilderParent.tsx](components/agent-creation/AgentBuilderParent.tsx)

**Values**:
- `true` or `1` - Show `ConversationalAgentBuilderV2`
- `false`, `0`, or omit - Show legacy `ConversationalAgentBuilder`

```typescript
import { useNewAgentCreationUI } from '@/lib/utils/featureFlags';

const useNewUI = useNewAgentCreationUI();

return useNewUI ? (
  <ConversationalAgentBuilderV2 {...props} />
) : (
  <ConversationalAgentBuilder {...props} />
);
```

---

## Configuration

### Development (.env.local)

```bash
# Active Feature Flags (v2/agents/new, test-plugins-v2)
NEXT_PUBLIC_USE_V6_AGENT_GENERATION=false
USE_AGENT_GENERATION_ENHANCED_TECHNICAL_WORKFLOW_REVIEW=false

# Legacy Feature Flags (agents/new/chat only)
NEXT_PUBLIC_USE_THREAD_BASED_AGENT_CREATION=false
NEXT_PUBLIC_USE_NEW_AGENT_CREATION_UI=false
```

### Testing Configurations

```bash
# Test V6 5-phase pipeline
NEXT_PUBLIC_USE_V6_AGENT_GENERATION=true

# Test V5 generator (LLM review) with V4 flow
NEXT_PUBLIC_USE_V6_AGENT_GENERATION=false
USE_AGENT_GENERATION_ENHANCED_TECHNICAL_WORKFLOW_REVIEW=true

# Test legacy route with thread-based flow
NEXT_PUBLIC_USE_THREAD_BASED_AGENT_CREATION=true
NEXT_PUBLIC_USE_NEW_AGENT_CREATION_UI=true
```

### Production (Gradual Rollout)

```bash
# Current recommended setup
NEXT_PUBLIC_USE_V6_AGENT_GENERATION=false  # Enable when V6 is stable
USE_AGENT_GENERATION_ENHANCED_TECHNICAL_WORKFLOW_REVIEW=true

# Legacy route (if still in use)
NEXT_PUBLIC_USE_THREAD_BASED_AGENT_CREATION=true
NEXT_PUBLIC_USE_NEW_AGENT_CREATION_UI=true
```

---

## Utility Functions

### Get All Feature Flags

Use `getFeatureFlags()` for debugging or admin dashboards:

```typescript
import { getFeatureFlags } from '@/lib/utils/featureFlags';

const flags = getFeatureFlags();
// Returns:
// {
//   useV6AgentGeneration: boolean,
//   useEnhancedTechnicalWorkflowReview: boolean,
//   useThreadBasedAgentCreation: boolean,  // Legacy
//   useNewAgentCreationUI: boolean,        // Legacy
// }

console.log('Current feature flags:', flags);
```

---

## Database-Based Feature Flags (Orchestration)

These flags control workflow execution behavior and are stored in the `system_settings_config` database table. They are managed via the admin UI at `/admin/orchestration-config`.

### Location

- **Storage**: `system_settings_config` table in Supabase
- **Admin UI**: [/admin/orchestration-config](app/admin/orchestration-config/page.tsx)
- **API**: [/api/admin/orchestration-config](app/api/admin/orchestration-config/route.ts)
- **Types**: [types.ts](lib/orchestration/types.ts)

### Available Database Flags

| Flag | DB Key | Default | Phase |
|------|--------|---------|-------|
| Orchestration Enabled | `orchestration_enabled` | `false` | Phase 1 |
| Compression Enabled | `orchestration_compression_enabled` | `false` | Phase 2 |
| AIS Routing Enabled | `orchestration_ais_routing_enabled` | `false` | Phase 2 |
| Adaptive Budget Enabled | `orchestration_adaptive_budget_enabled` | `false` | Phase 3+ |

---

### 1. Orchestration Enabled

**DB Key**: `orchestration_enabled`

**Purpose**: Master switch for the intelligent orchestration system. When enabled, workflow execution uses intent classification, token budget management, and orchestration metadata tracking.

**Used In**:
- [OrchestrationService.ts](lib/orchestration/OrchestrationService.ts) - `isEnabled()` method
- [WorkflowOrchestrator.ts](lib/orchestration/WorkflowOrchestrator.ts) - Initializes orchestration metadata

**Effect when enabled**:
- Intent classification runs for each workflow step
- Token budgets are allocated based on intent type
- Orchestration metadata is tracked throughout execution
- Audit logs capture orchestration events

```typescript
// Check if orchestration is enabled
const orchestrationService = new OrchestrationService(supabase);
const isEnabled = await orchestrationService.isEnabled();

if (isEnabled) {
  const metadata = await orchestrationService.prepareWorkflowExecution(workflow, agentId, userId);
  // Use orchestrated execution
}
```

---

### 2. Compression Enabled

**DB Key**: `orchestration_compression_enabled`

**Purpose**: Enables context compression to reduce token usage. Uses semantic, structural, or template-based compression strategies based on intent type.

**Used In**:
- [OrchestrationService.ts](lib/orchestration/OrchestrationService.ts) - `isCompressionEnabled()` method
- [CompressionService.ts](lib/orchestration/CompressionService.ts) - Applies compression policies
- [MemoryCompressor.ts](lib/orchestration/MemoryCompressor.ts) - Memory context compression

**Effect when enabled**:
- Content is compressed before LLM calls based on intent-specific policies
- Compression strategies: `semantic`, `structural`, `template`, `truncate`
- Target compression ratios are configurable per intent type
- Quality scores ensure compression doesn't degrade output

**Related Configuration Keys**:
- `orchestration_compression_target_ratio` - Target reduction (e.g., 0.5 = 50%)
- `orchestration_compression_min_quality` - Minimum quality threshold
- `orchestration_compression_aggressiveness` - `low`, `medium`, `high`

---

### 3. AIS Routing Enabled

**DB Key**: `orchestration_ais_routing_enabled`

**Purpose**: Enables Agent Intensity Score (AIS) based model routing. Routes requests to appropriate model tiers (fast/balanced/powerful) based on the agent's complexity scores.

**Used In**:
- [OrchestrationService.ts](lib/orchestration/OrchestrationService.ts) - `isRoutingEnabled()` method
- [RoutingService.ts](lib/orchestration/RoutingService.ts) - Makes routing decisions
- [WorkflowOrchestrator.ts](lib/orchestration/WorkflowOrchestrator.ts) - Applies routing per step

**Effect when enabled**:
- Agent's AIS scores (`creation_score`, `execution_score`, `combined_score`) determine model tier
- Fast tier (Haiku): Low complexity agents (combined_score < 3.0)
- Balanced tier (GPT-4o-mini): Medium complexity (3.0 - 6.5)
- Powerful tier (Sonnet): High complexity (> 6.5)

**Related Configuration Keys**:
- `orchestration_ais_fast_tier_max_score` - Max score for fast tier (default: 3.0)
- `orchestration_ais_balanced_tier_max_score` - Max score for balanced tier (default: 6.5)
- `orchestration_ais_quality_weight` - Weight for quality in routing decisions
- `orchestration_ais_cost_weight` - Weight for cost in routing decisions

**Model Configuration**:
- `orchestration_model_fast` - Fast tier model (default: `claude-3-haiku-20240307`)
- `orchestration_model_balanced` - Balanced tier model (default: `gpt-4o-mini`)
- `orchestration_model_powerful` - Powerful tier model (default: `claude-3-5-sonnet-20241022`)

---

### 4. Adaptive Budget Enabled

**DB Key**: `orchestration_adaptive_budget_enabled`

**Purpose**: Enables adaptive token budget allocation based on execution history and predictive analytics. Currently planned for Phase 3+.

**Status**: Not yet implemented (hardcoded to `false`)

**Planned Effect when enabled**:
- Token budgets adjust dynamically based on historical step execution data
- Predictive allocation based on similar workflows
- Budget rebalancing during execution if steps under/over-utilize

---

### Accessing Database Flags in Code

```typescript
import { OrchestrationService } from '@/lib/orchestration/OrchestrationService';

const orchestrationService = new OrchestrationService(supabaseClient);

// Check individual flags
const orchestrationEnabled = await orchestrationService.isEnabled();
const compressionEnabled = await orchestrationService.isCompressionEnabled();
const routingEnabled = await orchestrationService.isRoutingEnabled();

// Flags are included in OrchestrationMetadata
const metadata = await orchestrationService.prepareWorkflowExecution(workflow, agentId, userId);
console.log(metadata.featureFlags);
// {
//   orchestrationEnabled: true,
//   compressionEnabled: true,
//   aisRoutingEnabled: true,
//   adaptiveBudgetEnabled: false
// }
```

### Managing via Admin UI

Navigate to `/admin/orchestration-config` to:
- Toggle feature flags on/off
- Configure model routing thresholds
- Set compression parameters
- Adjust token budgets per intent type
- Monitor orchestration metrics

---

## Implementation Details

### Flag Parsing Logic

All environment-based flags follow the same parsing pattern:

1. Return `false` if variable is not set, empty, or whitespace-only
2. Normalize value (lowercase, trim)
3. Return `false` for `'false'` or `'0'`
4. Return `true` for `'true'` or `'1'`
5. Return `false` for any other value

```typescript
export function useFeatureFlag(): boolean {
  const flag = process.env.FEATURE_FLAG_NAME;

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

### Client vs Server Flags

- **Client-side flags** must use `NEXT_PUBLIC_` prefix to be bundled by Next.js
- **Server-side flags** should NOT use `NEXT_PUBLIC_` prefix (keeps them secure)

---

## Adding a New Feature Flag

1. **Add the function** to [featureFlags.ts](lib/utils/featureFlags.ts):

```typescript
/**
 * Check if [feature name] is enabled
 *
 * @returns {boolean} True if enabled, false otherwise
 */
export function useMyNewFeature(): boolean {
  const flag = process.env.NEXT_PUBLIC_MY_NEW_FEATURE; // or without NEXT_PUBLIC_ for server-only

  if (!flag || flag.trim() === '') {
    return false;
  }

  const normalizedFlag = flag.trim().toLowerCase();
  return normalizedFlag === 'true' || normalizedFlag === '1';
}
```

2. **Add to `getFeatureFlags()`**:

```typescript
export function getFeatureFlags() {
  return {
    useV6AgentGeneration: useV6AgentGeneration(),
    useEnhancedTechnicalWorkflowReview: useEnhancedTechnicalWorkflowReview(),
    useThreadBasedAgentCreation: useThreadBasedAgentCreation(),
    useNewAgentCreationUI: useNewAgentCreationUI(),
    useMyNewFeature: useMyNewFeature(), // Add here
  };
}
```

3. **Add to `.env.example`**:

```bash
# My New Feature
# Description of what this feature does
NEXT_PUBLIC_MY_NEW_FEATURE=false
```

4. **Add tests** to [featureFlags.test.ts](lib/utils/__tests__/featureFlags.test.ts)

5. **Update this documentation**

---

## Debugging

Feature flags log their values to the console when called:

```
Feature Flag: NEXT_PUBLIC_USE_THREAD_BASED_AGENT_CREATION= true
Feature Flag: NEXT_PUBLIC_USE_NEW_AGENT_CREATION_UI= none
```

To see all current flag values:

```typescript
import { getFeatureFlags } from '@/lib/utils/featureFlags';
console.log('Feature Flags:', getFeatureFlags());
```

---

## Best Practices

1. **Default to `false`** - New features should be opt-in
2. **Use descriptive names** - Flag names should clearly indicate what they control
3. **Document the purpose** - Add JSDoc comments explaining the flag's effect
4. **Add console logging** - Log flag values during development for debugging
5. **Write tests** - Test all valid/invalid input combinations
6. **Clean up old flags** - Remove flags for features that are fully rolled out
