# Repository Strategy Guidelines

## Overview

This document outlines the repository pattern implementation used in the NeuronForge application. The repository layer serves as an abstraction between the database and business logic, providing a clean separation of concerns and centralizing all data access operations.

## Architecture Principles

### What is the Repository Pattern?

The repository pattern is a design pattern that mediates between the domain/business logic layer and the data mapping layer. It provides a collection-like interface for accessing domain objects while encapsulating the logic required to access data sources.

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client Components                         │
│                    (React, Next.js Pages)                        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ HTTP Requests
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         API Routes                               │
│                  (app/api/**/route.ts)                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Method Calls
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Business Logic Layer                        │
│              (Services, Validators, Helpers)                     │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Repository Methods
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Repository Layer                            │
│                   (lib/repositories/*)                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Supabase Client
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         Database                                 │
│                      (Supabase/PostgreSQL)                       │
└─────────────────────────────────────────────────────────────────┘
```

### Key Benefits

1. **Separation of Concerns**: Database logic is isolated from business logic
2. **Testability**: Repositories can be mocked for unit testing
3. **Maintainability**: Changes to database schema only affect repository layer
4. **Consistency**: Standardized data access patterns across the application
5. **Type Safety**: Centralized TypeScript interfaces for all database entities

## Important Constraints

### Server-Side Only

**Repositories are designed for server-side use only.** They should NOT be imported or used directly in:

- React Client Components (`'use client'`)
- Browser-executed code
- Any code that runs in the user's browser

**Why?**
- Repositories use the Supabase server client with elevated permissions
- Direct database access from the client bypasses security policies
- Exposing repository logic to the client creates security vulnerabilities

**Correct Usage:**
```typescript
// API Route (Server-side) - CORRECT
// app/api/agents/route.ts
import { agentRepository } from '@/lib/repositories';

export async function GET(request: Request) {
  const { data, error } = await agentRepository.findAllByUser(userId);
  return Response.json(data);
}
```

**Incorrect Usage:**
```typescript
// Client Component - INCORRECT
'use client'
import { agentRepository } from '@/lib/repositories'; // DON'T DO THIS

export function AgentList() {
  // This exposes database logic to the client
  const agents = await agentRepository.findAllByUser(userId);
}
```

### Exception: Server Components with Authenticated Supabase Client

In Next.js App Router, Server Components can use repositories if they inject an authenticated Supabase client. This is acceptable because Server Components execute on the server.

```typescript
// Server Component - Acceptable with proper client injection
import { AgentRepository } from '@/lib/repositories';
import { createServerComponentClient } from '@supabase/auth-helpers-nextjs';

export async function AgentPage() {
  const supabase = createServerComponentClient({ cookies });
  const agentRepo = new AgentRepository(supabase);
  const { data } = await agentRepo.findById(agentId, userId);
}
```

## Repository Structure

All repositories are located in `lib/repositories/` with the following structure:

```
lib/repositories/
├── index.ts                    # Barrel exports (repositories + types)
├── types.ts                    # Shared TypeScript interfaces and types
├── AgentRepository.ts          # Agent CRUD and status management
├── ExecutionRepository.ts      # Agent execution records and token usage
├── SharedAgentRepository.ts    # Shared/template agents for marketplace
├── AgentMetricsRepository.ts   # Agent performance metrics
├── ConfigRepository.ts         # System and reward configuration
└── MemoryRepository.ts         # Agent run memories
```

## Repository Catalog

### AgentRepository
**Location:** `lib/repositories/AgentRepository.ts`

**Purpose:** Manages all agent-related database operations including CRUD operations, status transitions, and soft delete functionality.

**Key Responsibilities:**
- Create, read, update, delete agents
- Status management (draft → active → inactive)
- Soft delete with recovery capability
- Agent duplication
- Filtering by user and status

---

### ExecutionRepository
**Location:** `lib/repositories/ExecutionRepository.ts`

**Purpose:** Handles agent execution records and associated token usage data.

**Key Responsibilities:**
- Query executions by agent or user
- Pagination support for execution history
- Token usage aggregation and lookup
- Batch fetch token data for multiple executions

---

### SharedAgentRepository
**Location:** `lib/repositories/SharedAgentRepository.ts`

**Purpose:** Manages shared agent templates for the agent marketplace/sharing feature.

**Key Responsibilities:**
- Create shared agent entries
- Check if agent has been shared
- Query shared agents by user
- Store quality scores and metrics snapshots

---

### AgentMetricsRepository
**Location:** `lib/repositories/AgentMetricsRepository.ts`

**Purpose:** Provides access to agent intensity and performance metrics.

**Key Responsibilities:**
- Retrieve agent success rates
- Get execution counts and timing data
- Support for agent quality scoring

---

### ConfigRepository
**Location:** `lib/repositories/ConfigRepository.ts`

**Purpose:** Manages system-wide configuration and reward settings.

**Key Responsibilities:**
- Retrieve system configuration values
- Access reward configuration (credits, limits)
- Type-safe config value parsing

---

### MemoryRepository
**Location:** `lib/repositories/MemoryRepository.ts`

**Purpose:** Handles agent run memories for context persistence.

**Key Responsibilities:**
- Count memories per agent
- Retrieve memory records with pagination
- Support for memory-based agent features

## Type Definitions

All shared types are centralized in `lib/repositories/types.ts`:

| Type | Description |
|------|-------------|
| `Agent` | Core agent entity with all fields |
| `AgentStatus` | Status union type: `'draft' \| 'active' \| 'inactive' \| 'deleted'` |
| `Execution` | Agent execution record with logs |
| `ExecutionLogs` | Structured execution log data |
| `TokenUsage` | Token consumption record |
| `SharedAgent` | Shared agent template entity |
| `AgentMetrics` | Performance metrics snapshot |
| `AgentRepositoryResult<T>` | Standard result wrapper with error handling |

## Usage Patterns

### Importing Repositories

```typescript
// Import singleton instances for convenience
import {
  agentRepository,
  executionRepository,
  configRepository
} from '@/lib/repositories';

// Or import classes for custom client injection
import {
  AgentRepository,
  ExecutionRepository
} from '@/lib/repositories';
```

### Standard Result Pattern

All repository methods return a consistent result structure:

```typescript
interface AgentRepositoryResult<T> {
  data: T | null;
  error: Error | null;
}

// Usage
const { data: agent, error } = await agentRepository.findById(id, userId);
if (error) {
  console.error('Failed to fetch agent:', error);
  return;
}
// Use agent safely
```

### Dependency Injection

Repositories support Supabase client injection for testing and flexibility:

```typescript
// Use default client (singleton)
const agents = await agentRepository.findAllByUser(userId);

// Inject custom client (e.g., for testing or different auth context)
const customRepo = new AgentRepository(customSupabaseClient);
const agents = await customRepo.findAllByUser(userId);
```

## Best Practices

1. **Always use repositories for database access** - Never write direct Supabase queries in API routes or services

2. **Handle errors consistently** - Check the `error` property before using `data`

3. **Use singleton instances** - Import from `@/lib/repositories` for standard operations

4. **Inject clients when needed** - Use class constructors for custom auth contexts or testing

5. **Keep repositories focused** - Each repository should manage one entity type

6. **Add new methods to existing repositories** - Before creating a new repository, check if the operation fits an existing one

7. **Document complex queries** - Add JSDoc comments for non-trivial database operations

## Logging Integration

All repositories integrate with the application's logging system following the guidelines in `docs/SYSTEM_LOGGING_GUIDELINES.md`.

### Logger Setup

Each repository initializes a Pino logger in its constructor and uses the server-side Supabase client:

```typescript
import { SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer as defaultSupabase } from '@/lib/supabaseServer';
import { createLogger, Logger } from '@/lib/logger';

export class AgentRepository {
  private supabase: SupabaseClient;
  private logger: Logger;

  constructor(supabaseClient?: SupabaseClient) {
    this.supabase = supabaseClient || defaultSupabase;
    this.logger = createLogger({ service: 'AgentRepository' });
  }
}
```

**Important:** All repositories must use `supabaseServer` from `@/lib/supabaseServer`, NOT the browser client from `@/lib/supabaseClient`. The browser client will fail when called from API routes.

### Method-Level Logging Pattern

For operations that require detailed logging (creates, updates, deletes, complex queries), use child loggers with method context:

```typescript
async create(input: CreateAgentInput): Promise<AgentRepositoryResult<Agent>> {
  const methodLogger = this.logger.child({ method: 'create', userId: input.user_id });
  const startTime = Date.now();

  try {
    methodLogger.debug({ agentName: input.agent_name }, 'Creating agent');

    const { data, error } = await this.supabase
      .from('agents')
      .insert({ ... })
      .select()
      .single();

    if (error) throw error;

    const duration = Date.now() - startTime;
    methodLogger.info({ agentId: data.id, duration }, 'Agent created');

    return { data, error: null };
  } catch (error) {
    const duration = Date.now() - startTime;
    methodLogger.error({ err: error, duration }, 'Failed to create agent');
    return { data: null, error: error as Error };
  }
}
```

### Logging Levels

| Level | When to Use | Example |
|-------|-------------|---------|
| `debug` | Start of operations, intermediate steps | `'Creating agent'`, `'Validating status transition'` |
| `info` | Successful completions, important state changes | `'Agent created'`, `'Agent status updated'` |
| `warn` | Recoverable issues, validation failures | `'Invalid status transition'`, `'Agent not found'` |
| `error` | Operation failures, exceptions | `'Failed to create agent'`, `'Database error'` |

### Performance Tracking

All significant operations should track duration for performance monitoring:

```typescript
const startTime = Date.now();
try {
  // ... operation
  const duration = Date.now() - startTime;
  methodLogger.info({ count: data.length, duration }, 'Fetched executions');
} catch (error) {
  const duration = Date.now() - startTime;
  methodLogger.error({ err: error, duration }, 'Failed to fetch executions');
}
```

### Logging Guidelines by Repository

| Repository | Key Logged Operations |
|------------|----------------------|
| `AgentRepository` | create, updateStatus, softDelete, hardDelete, restore, duplicate, updateDetails |
| `ExecutionRepository` | findByAgentId, getTokenUsageByExecutionIds |
| `SharedAgentRepository` | create |
| `AgentMetricsRepository` | findByAgentId |
| `ConfigRepository` | getSystemConfig (on cache miss) |
| `MemoryRepository` | findByAgentId (on large queries) |

### Client-Side Logging

For client components that use repositories via API routes, use `clientLogger` from `@/lib/logger/client`:

```typescript
'use client'
import { clientLogger } from '@/lib/logger/client';

export function AgentDetailPage({ agentId }: Props) {
  useEffect(() => {
    clientLogger.setContext({ component: 'AgentDetailPage', agentId });
    clientLogger.info('Page mounted');

    return () => {
      clientLogger.debug('Page unmounted');
      clientLogger.clearContext();
    };
  }, [agentId]);

  const handleSave = async () => {
    clientLogger.debug('Saving agent', { agentId });
    try {
      await fetch(`/api/agents/${agentId}`, { method: 'PUT', ... });
      clientLogger.info('Agent saved successfully');
    } catch (error) {
      clientLogger.error('Failed to save agent', error);
    }
  };
}
```

## Client API Layer

For client components (`'use client'`), use the **Client API service** instead of making raw `fetch` calls. This provides type-safe access to all agent-related operations.

**Location:** `lib/client/agent-api.ts`

### Available Services

| Service | Description |
|---------|-------------|
| `agentApi` | Agent CRUD, status updates, executions, memory count |
| `sharedAgentApi` | Check if agent is shared, share an agent |
| `metricsApi` | Get agent performance metrics |
| `systemConfigApi` | Access system configuration values |

### Usage Example

```typescript
'use client'
import { agentApi, sharedAgentApi, metricsApi } from '@/lib/client/agent-api';

export function AgentDetailPage({ agentId, userId }: Props) {
  const fetchAgent = async () => {
    // Get agent with automatic plugin token refresh
    const result = await agentApi.getById(agentId, userId);
    if (result.success && result.data) {
      setAgent(result.data.agent);
    }
  };

  const fetchExecutions = async () => {
    // Get executions with server-side token enrichment
    const result = await agentApi.getExecutions(agentId, userId, { includeTokens: true });
    if (result.success) {
      setExecutions(result.data);
    }
  };

  const handleShare = async () => {
    // Share agent with quality scores
    const result = await sharedAgentApi.share(agentId, userId, {
      quality_score: 85,
      reliability_score: 90,
      base_executions: 100,
    });
    if (result.success) {
      console.log('Shared with ID:', result.data.id);
    }
  };
}
```

### Client API Methods

**agentApi:**
| Method | Description |
|--------|-------------|
| `getById(agentId, userId)` | Get agent details (also triggers plugin token refresh) |
| `update(agentId, userId, data)` | Update agent fields |
| `delete(agentId, userId)` | Soft delete an agent |
| `updateStatus(agentId, userId, status)` | Pause or activate agent |
| `duplicate(agentId, userId)` | Create a copy of the agent |
| `getExecutions(agentId, userId, options?)` | Get executions with optional token enrichment |
| `getMemoryCount(agentId, userId)` | Get count of agent memories |

**sharedAgentApi:**
| Method | Description |
|--------|-------------|
| `existsByOriginalAgent(agentId, userId)` | Check if agent has been shared |
| `share(agentId, userId, shareData?)` | Share agent with optional quality scores |

**metricsApi:**
| Method | Description |
|--------|-------------|
| `getBasicMetrics(agentId, userId)` | Get execution counts, success rate, avg duration |

## API Routes Using Repositories

The following API routes use the repository layer. **Client components should use the Client API service above rather than calling these directly.**

| Route | Method | Repository | Description |
|-------|--------|------------|-------------|
| `/api/agents` | GET | `agentRepository.findAllByUser()` | List agents with optional status filter |
| `/api/agents/[id]` | GET | `agentRepository.findById()` | Get single agent + plugin token refresh |
| `/api/agents/[id]` | PUT | `agentRepository.updateDetails()` | Update agent |
| `/api/agents/[id]` | DELETE | `agentRepository.softDelete()` | Soft delete agent |
| `/api/agents/[id]/status` | POST | `agentRepository.updateStatus()` | Update agent status |
| `/api/agents/[id]/duplicate` | POST | `agentRepository.duplicate()` | Duplicate agent |
| `/api/agents/[id]/executions` | GET | `executionRepository.findByAgentId()` | Get executions with token enrichment |
| `/api/agents/[id]/memory/count` | GET | `memoryRepository.countByAgentId()` | Get memory count |
| `/api/agents/[id]/metrics` | GET | `agentMetricsRepository.findByAgentId()` | Get performance metrics |
| `/api/shared-agents` | POST | `sharedAgentRepository.create()` | Share an agent |
| `/api/shared-agents/exists` | GET | `sharedAgentRepository.existsByOriginalAgent()` | Check if agent is shared |
| `/api/system-config` | GET | `systemConfigRepository.getByCategory()` | Get system config |

**Direct fetch (use only when Client API doesn't cover your use case):**
```typescript
'use client'

// Prefer this (type-safe, handles auth headers automatically):
const result = await agentApi.getById(agentId, userId);

// Instead of this (manual, error-prone):
const response = await fetch(`/api/agents/${agentId}`, {
  headers: { 'x-user-id': userId }
});
const data = await response.json();
```

## Adding New Repositories

When creating a new repository:

1. Create the file in `lib/repositories/`
2. Add types to `types.ts`
3. Export from `index.ts`
4. Follow the established patterns:
   - Constructor with optional Supabase client injection
   - Logger initialization with service name
   - Consistent `AgentRepositoryResult<T>` return type
   - Export both class and singleton instance
5. Add logging for significant operations following the patterns above
