# Feature Flags

> **Last Updated**: January 17, 2026
> **Version**: 1.0.0

This document describes the feature flag system used in NeuronForge for gradual rollouts, A/B testing, and feature toggling.

---

## Change History

| Date | Version | Author | Changes |
|------|---------|--------|---------|
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

| Flag | Environment Variable | Scope | Default |
|------|---------------------|-------|---------|
| Thread-Based Agent Creation | `NEXT_PUBLIC_USE_THREAD_BASED_AGENT_CREATION` | Client | `false` |
| New Agent Creation UI | `NEXT_PUBLIC_USE_NEW_AGENT_CREATION_UI` | Client | `false` |
| Enhanced Technical Workflow Review | `USE_AGENT_GENERATION_ENHANCED_TECHNICAL_WORKFLOW_REVIEW` | Server | `false` |

---

## Flag Details

### 1. Thread-Based Agent Creation

**Environment Variable**: `NEXT_PUBLIC_USE_THREAD_BASED_AGENT_CREATION`

**Purpose**: Enables OpenAI Threads API for the agent creation flow (phases 1-3: analyze, clarify, enhance). Provides approximately 36% token savings via prompt caching.

**Function**: `useThreadBasedAgentCreation()`

**Used In**:
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

### 2. New Agent Creation UI (V2)

**Environment Variable**: `NEXT_PUBLIC_USE_NEW_AGENT_CREATION_UI`

**Purpose**: Enables the new conversational UI V2 with a ChatGPT/Claude-style interface for agent creation.

**Function**: `useNewAgentCreationUI()`

**Used In**:
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

### 3. Enhanced Technical Workflow Review (V5 Generator)

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

## Configuration

### Development (.env.local)

```bash
# Feature Flags
NEXT_PUBLIC_USE_THREAD_BASED_AGENT_CREATION=false
NEXT_PUBLIC_USE_NEW_AGENT_CREATION_UI=false
USE_AGENT_GENERATION_ENHANCED_TECHNICAL_WORKFLOW_REVIEW=false
```

### Testing Configurations

```bash
# Test new UI with mock data
NEXT_PUBLIC_USE_THREAD_BASED_AGENT_CREATION=false
NEXT_PUBLIC_USE_NEW_AGENT_CREATION_UI=true

# Test thread-based flow with new UI
NEXT_PUBLIC_USE_THREAD_BASED_AGENT_CREATION=true
NEXT_PUBLIC_USE_NEW_AGENT_CREATION_UI=true

# Test V5 generator
USE_AGENT_GENERATION_ENHANCED_TECHNICAL_WORKFLOW_REVIEW=true
```

### Production (Gradual Rollout)

```bash
# Start conservative
NEXT_PUBLIC_USE_THREAD_BASED_AGENT_CREATION=true
NEXT_PUBLIC_USE_NEW_AGENT_CREATION_UI=false

# Gradually enable new UI after validation
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
//   useThreadBasedAgentCreation: boolean,
//   useNewAgentCreationUI: boolean,
//   useEnhancedTechnicalWorkflowReview: boolean,
// }

console.log('Current feature flags:', flags);
```

---

## Database-Based Feature Flags (Orchestration)

Orchestration features are configured via the database and accessed through `OrchestrationMetadata`:

| Flag | Purpose |
|------|---------|
| `orchestrationEnabled` | Enable intelligent orchestration for workflow execution |
| `compressionEnabled` | Enable context compression for token savings |
| `aisRoutingEnabled` | Enable AIS-based model routing |
| `adaptiveBudgetEnabled` | Enable adaptive token budget allocation |

These flags are stored in `system_settings_config` table and managed via the admin UI.

**Used In**:
- [WorkflowOrchestrator.ts](lib/orchestration/WorkflowOrchestrator.ts)
- [OrchestrationService.ts](lib/orchestration/OrchestrationService.ts)
- [types.ts](lib/orchestration/types.ts)

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
    useThreadBasedAgentCreation: useThreadBasedAgentCreation(),
    useNewAgentCreationUI: useNewAgentCreationUI(),
    useEnhancedTechnicalWorkflowReview: useEnhancedTechnicalWorkflowReview(),
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
