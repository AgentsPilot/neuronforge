# Repository Layer Implementation Plan

## Overview

Create a comprehensive repository layer to centralize all database operations for the agent detail page (`v2/agents/[id]/page.tsx`), following the pattern established by `AgentRepository`.

---

## Phase 1: Extend AgentRepository (Priority: High)

### File: `lib/repositories/AgentRepository.ts`

Add missing methods to existing repository:

| Method | Purpose |
|--------|---------|
| `duplicate(agentId, userId)` | Create copy of agent with "(Copy)" suffix, draft status |
| `updateDetails(id, userId, input)` | Update name, description, schedule_cron, mode, timezone |

### Changes to `lib/repositories/types.ts`

```typescript
export interface UpdateAgentDetailsInput {
  agent_name?: string;
  description?: string | null;
  schedule_cron?: string | null;
  mode?: 'on_demand' | 'scheduled';
  timezone?: string | null;
}
```

---

## Phase 2: ExecutionRepository (Priority: High)

### File: `lib/repositories/ExecutionRepository.ts`

Handles agent execution data and token usage.

| Method | Purpose |
|--------|---------|
| `findByAgentId(agentId, options?)` | Get executions for agent with pagination |
| `findById(id)` | Get single execution |
| `getTokenUsageByExecutionIds(ids)` | Batch fetch token_usage records |
| `countByAgentId(agentId)` | Count total executions |

### Types to add:

```typescript
export interface Execution {
  id: string;
  agent_id: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'success';
  started_at: string;
  completed_at?: string;
  execution_duration_ms?: number;
  logs?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error_message?: string;
}

export interface TokenUsage {
  id: string;
  execution_id: string;
  input_tokens: number;
  output_tokens: number;
  activity_type: string;
}
```

---

## Phase 3: SharedAgentRepository (Priority: Medium)

### File: `lib/repositories/SharedAgentRepository.ts`

Handles shared/template agents.

| Method | Purpose |
|--------|---------|
| `existsByOriginalAgent(agentId, userId)` | Check if agent already shared |
| `create(data)` | Insert new shared agent with scores |
| `findByUserId(userId)` | Get user's shared agents |

### Types to add:

```typescript
export interface CreateSharedAgentInput {
  original_agent_id: string;
  user_id: string;
  agent_name: string;
  description?: string;
  user_prompt?: string;
  input_schema?: Record<string, unknown>;
  output_schema?: Record<string, unknown>;
  connected_plugins?: string[];
  plugins_required?: string[];
  workflow_steps?: unknown[];
  mode?: string;
  quality_score?: number;
  reliability_score?: number;
  efficiency_score?: number;
  adoption_score?: number;
  complexity_score?: number;
  base_executions?: number;
  base_success_rate?: number;
}
```

---

## Phase 4: AgentMetricsRepository (Priority: Medium)

### File: `lib/repositories/AgentMetricsRepository.ts`

Handles agent intensity metrics.

| Method | Purpose |
|--------|---------|
| `findByAgentId(agentId)` | Get metrics for agent |
| `upsert(agentId, metrics)` | Create or update metrics |

### Types to add:

```typescript
export interface AgentMetrics {
  agent_id: string;
  user_id: string;
  success_rate: number;
  total_executions: number;
  avg_execution_time_ms?: number;
  // ... other intensity fields
}
```

---

## Phase 5: ConfigRepository (Priority: Low)

### File: `lib/repositories/ConfigRepository.ts`

Handles system configuration lookups.

| Method | Purpose |
|--------|---------|
| `getSystemConfig(key)` | Get value from ais_system_config |
| `getRewardConfig(key)` | Get active reward by key |
| `getAllRewardConfigs()` | Get all active rewards |

### Types to add:

```typescript
export interface SystemConfig {
  config_key: string;
  config_value: string;
}

export interface RewardConfig {
  reward_key: string;
  credits_amount: number;
  is_active: boolean;
}
```

---

## Phase 6: MemoryRepository (Priority: Low)

### File: `lib/repositories/MemoryRepository.ts`

Handles run memories.

| Method | Purpose |
|--------|---------|
| `countByAgentId(agentId)` | Count memories for agent |
| `findByAgentId(agentId, options?)` | Get memories with pagination |

---

## Implementation Order

```
1. AgentRepository (extend)     ← Already exists, add 2 methods
2. ExecutionRepository          ← Most used in the page
3. SharedAgentRepository        ← Used for sharing feature
4. AgentMetricsRepository       ← Used for metrics display
5. ConfigRepository             ← System configs
6. MemoryRepository             ← Simple count query
```

---

## Phase 7: Update `v2/agents/[id]/page.tsx`

### Imports to add:

```typescript
import {
  agentRepository,
  executionRepository,
  sharedAgentRepository,
  agentMetricsRepository,
  configRepository,
  memoryRepository,
} from '@/lib/repositories';
```

### Functions to refactor:

| Current Function | Repository Method |
|-----------------|-------------------|
| Direct Supabase in `fetchAgentData` (agents) | `agentRepository.findById()` |
| Direct Supabase in `fetchAgentData` (executions) | `executionRepository.findByAgentId()` |
| Direct Supabase in `fetchAgentData` (token_usage) | `executionRepository.getTokenUsageByExecutionIds()` |
| `fetchMemoryCount` | `memoryRepository.countByAgentId()` |
| `fetchTokensPerPilotCredit` | `configRepository.getSystemConfig()` |
| `fetchSharingRewardAmount` | `configRepository.getRewardConfig()` |
| `handleToggleStatus` | `agentRepository.updateStatus()` (already exists) |
| `handleSaveAgent` | `agentRepository.updateDetails()` (new) |
| `handleDuplicateAgent` | `agentRepository.duplicate()` (new) |
| `handleDeleteAgent` | `agentRepository.softDelete()` ✅ Done |
| `handleShareAgent` (check exists) | `sharedAgentRepository.existsByOriginalAgent()` |
| `handleShareAgent` (get metrics) | `agentMetricsRepository.findByAgentId()` |
| `handleShareAgent` (insert) | `sharedAgentRepository.create()` |

---

## Final File Structure

```
lib/repositories/
├── index.ts                    # Barrel exports
├── types.ts                    # All shared types
├── AgentRepository.ts          # ✅ Exists (extend)
├── ExecutionRepository.ts      # New
├── SharedAgentRepository.ts    # New
├── AgentMetricsRepository.ts   # New
├── ConfigRepository.ts         # New
└── MemoryRepository.ts         # New
```

---

## Estimated Effort

| Phase | Files | Est. Lines | Priority |
|-------|-------|-----------|----------|
| 1. Extend AgentRepository | 2 | ~50 | High |
| 2. ExecutionRepository | 2 | ~120 | High |
| 3. SharedAgentRepository | 2 | ~100 | Medium |
| 4. AgentMetricsRepository | 2 | ~60 | Medium |
| 5. ConfigRepository | 2 | ~60 | Low |
| 6. MemoryRepository | 2 | ~40 | Low |
| 7. Refactor page.tsx | 1 | ~-100 (net reduction) | High |

**Total new code:** ~430 lines across 6 new files
**Net change in page.tsx:** Remove ~150 lines of direct Supabase calls, add ~50 lines of repository imports/calls

---

## Benefits

1. **Centralized logic** - All DB operations in one place per entity
2. **Testability** - Can mock repositories in tests
3. **Consistency** - Same patterns across all data access
4. **Maintainability** - Changes to queries in one place
5. **Type safety** - Strong typing for all operations
6. **Reusability** - Same repositories used across other pages
