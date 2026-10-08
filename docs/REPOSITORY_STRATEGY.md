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
├── index.ts                       # Barrel exports (repositories + types)
├── types.ts                       # Shared TypeScript interfaces and types
├── AgentRepository.ts             # Agent CRUD and status management
├── AgentConfigurationRepository.ts # Agent input values and run configuration
├── AgentLogsRepository.ts         # Agent execution output logs
├── AgentMetricsRepository.ts      # Agent performance metrics
├── AgentStatsRepository.ts        # Agent run statistics and costs
├── ArchiveRepository.ts           # Admin archiving: all-accounts counts, the run log, the run lifecycle, and per-user erasure/export (slice 3)
├── ConfigRepository.ts            # System and reward configuration
├── ExecutionRepository.ts         # Agent execution records and token usage
├── ExecutionLogRepository.ts      # Step-by-step execution logs (legacy path)
├── MemoryRepository.ts            # Agent run memories
├── PluginConnectionRepository.ts  # Plugin connection persistence (OAuth tokens, status)
├── ProcessedWebhookEventRepository.ts # Stripe webhook idempotency claim (processed_webhook_events); unscoped by design
├── SharedAgentRepository.ts       # Shared/template agents for marketplace
└── SystemConfigRepository.ts      # System-wide settings configuration
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
- Create and manage execution records
- Query executions by agent or user
- Pagination support for execution history
- Token usage aggregation and lookup
- Update execution logs with adjusted tokens
- Find running executions for concurrency checks

**Key Methods:**
| Method | Description |
|--------|-------------|
| `create(input)` | Create new execution record |
| `findById(id)` | Get execution by ID |
| `findByAgentId(agentId, options?)` | Get executions for agent with pagination |
| `updateLogs(id, logs)` | Update execution logs (for adjusted tokens) |
| `findRunningByAgentId(agentId)` | Find pending/running executions |
| `findForStatusQuery(options)` | Lightweight query for status polling |
| `getTokenUsageByExecutionIds(ids)` | Batch fetch token usage data |

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

---

### SystemConfigRepository
**Location:** `lib/repositories/SystemConfigRepository.ts`

**Purpose:** Manages system-wide settings from the `system_settings_config` table. Provides typed access to configuration values with category-based organization.

**Key Responsibilities:**
- Get config values by key or category
- Type-safe getters: `getString()`, `getNumber()`, `getBoolean()`
- Upsert config values with automatic category inference
- Convenience methods: `getRoutingConfig()`, `getAgentCreationConfig()`

**Key Methods:**
| Method | Description |
|--------|-------------|
| `getByKey(key)` | Get single config value |
| `getByCategory(category)` | Get all configs in a category |
| `getByCategoryAsMap(category)` | Get configs as key-value map |
| `getString(key, fallback)` | Get string value with fallback |
| `getNumber(key, fallback)` | Get number value with fallback |
| `getBoolean(key, fallback)` | Get boolean value with fallback |
| `set(key, value, category?, description?)` | Upsert config value |
| `getRoutingConfig()` | Get all routing-related settings |

---

### AgentStatsRepository
**Location:** `lib/repositories/AgentStatsRepository.ts`

**Purpose:** Manages agent run statistics from the `agent_stats` table. Used for cost estimation and execution tracking.

**Key Responsibilities:**
- Retrieve last run cost for balance estimation
- Increment execution statistics via RPC
- Support for agent cost prediction

**Key Methods:**
| Method | Description |
|--------|-------------|
| `getLastRunCost(agentId, userId)` | Get tokens used in last execution |
| `incrementStats(agentId, userId, success)` | Increment run counts via `increment_agent_stats` RPC |

---

### AgentConfigurationRepository
**Location:** `lib/repositories/AgentConfigurationRepository.ts`

**Purpose:** Manages agent input configurations from the `agent_configurations` table. Stores saved input values and execution state.

**Key Responsibilities:**
- Retrieve saved input values for agent execution
- Update execution status (for legacy path)
- Support for both test mode and production runs

**Key Methods:**
| Method | Description |
|--------|-------------|
| `getInputValues(agentId, userId)` | Get saved input values and schema |
| `updateStatus(id, status, completedAt?, durationMs?)` | Update execution status (legacy) |

---

### AgentLogsRepository
**Location:** `lib/repositories/AgentLogsRepository.ts`

**Purpose:** Manages agent execution output logs in the `agent_logs` table. Stores final execution results and outputs.

**Key Responsibilities:**
- Create execution log entries
- Store run output and full output data
- Track execution status (completed/failed)

**Key Methods:**
| Method | Description |
|--------|-------------|
| `create(input)` | Create new agent log entry |

**Input Interface:**
```typescript
interface CreateAgentLogInput {
  agent_id: string;
  user_id: string;
  run_output?: string | null;
  full_output?: Record<string, unknown> | null;
  status: 'completed' | 'failed';
  created_at?: string;
}
```

---

### PluginConnectionRepository
**Location:** `lib/repositories/PluginConnectionRepository.ts`

**Purpose:** Manages plugin connection records in the `plugin_connections` table. Handles OAuth token storage, connection status, and profile data.

**Key Responsibilities:**
- Query active/all connections for a user
- Upsert connections (insert or update on user_id + plugin_key conflict)
- Update connection status (disconnect, expire)
- Update profile data (merged by caller before writing)
- Find connections by JSONB profile data match (for webhook lookups)

**Key Methods:**
| Method | Description |
|--------|-------------|
| `findActiveByUser(userId)` | Get all active connections for a user |
| `findByUserAndPlugin(userId, pluginKey)` | Get connection by user and plugin (any status) |
| `findActiveByUserAndPlugin(userId, pluginKey)` | Get active connection by user and plugin |
| `existsByUserAndPlugin(userId, pluginKey)` | Check if connection exists |
| `findProfileData(userId, pluginKey)` | Get only the profile_data field |
| `findActiveByProfileData(pluginKey, match)` | Find connection by JSONB containment (no userId) |
| `findAllByUser(userId)` | Get all connections ordered by connected_at |
| `upsert(input)` | Upsert connection, forces status='active', adds timestamps |
| `updateStatus(userId, pluginKey, status, extra?)` | Update status with optional extra fields |
| `updateProfileData(userId, pluginKey, data)` | Write final merged profile data |
| `markExpired()` | Bulk mark expired active connections |

---

### ExecutionLogRepository
**Location:** `lib/repositories/ExecutionLogRepository.ts`

**Purpose:** Manages step-by-step execution logs in the `agent_execution_logs` table. Used primarily by the legacy execution path for granular logging.

**Key Responsibilities:**
- Create step-by-step log entries during execution
- Track execution phases (documents, prompt, validation, etc.)
- Support for execution debugging and audit trail

**Key Methods:**
| Method | Description |
|--------|-------------|
| `create(input)` | Create new execution log entry |

**Input Interface:**
```typescript
interface CreateExecutionLogInput {
  execution_id: string;
  agent_id: string;
  user_id: string;
  timestamp: string;
  level: 'info' | 'warning' | 'error';
  message: string;
  phase: 'documents' | 'prompt' | 'validation' | string;
}
```

---

### ArchiveRepository
**Location:** `lib/repositories/ArchiveRepository.ts`

**Purpose:** Data access for the Admin Archiving module (`/admin/archiving`). Reads the archivable sources — today only `audit_trail` — across **all accounts** for the admin overview. See [ADMIN_ARCHIVING_MODULE_REQUIREMENT.md](/docs/requirements/ADMIN_ARCHIVING_MODULE_REQUIREMENT.md).

**Service role, intentionally:** it uses `supabaseServer` and has no `user_id` filter, because the admin overview counts every account's rows. Its all-accounts and run methods are called only from `requireAdmin`-gated routes (`app/api/admin/archiving/**`); its two per-user methods only from `AuditTrailService` erasure and export (slice 3), and they are scoped by their `userId` argument (Rule 4), so they carry no suffix. Methods that read account data across accounts (`audit_trail`, `archived_records`) are suffixed `…AllAccounts` so the missing user scope is visible at every call site. Methods over `archive_runs` (the run log) have plain names: that table holds no account data and has no `user_id` at all.

**Key Responsibilities:**
- Count rows, and rows older than a cutoff, with `count: 'exact', head: true` (no row content is read)
- Return an error — never `0` — when the database gives no count
- Read the run log with a named column list; never select `archived_records.payload`, except `listArchivedForUser` for the person's own export (no admin route or UI reads it, AC-14)

**Key Methods:**
| Method | Description |
|--------|-------------|
| `countAuditTrailAllAccounts()` | Total `audit_trail` rows |
| `getOldestAuditTrailCreatedAtAllAccounts()` | `created_at` of the oldest `audit_trail` row (null when empty) |
| `countAuditTrailBeforeAllAccounts(cutoff)` | Rows with `created_at` before the cutoff (the archive-eligible count) |
| `countArchivedAllAccounts(source)` | Rows of one source now in `archived_records` (slice 2a) |
| `listRuns({ limit })` | The newest `archive_runs` rows, newest first, 20 by default (slice 2a) |
| `getLatestCutoff(source)` | The latest cutoff among **succeeded** runs of a source (everything before it is archived), or null (slice 2a) |
| `takeOverStaleRuns(now, staleAfterMs)` | Flips `running` runs with no sign of life for 5 minutes to `partial` / `interrupted` (two plain updates); returns their ids (slice 2b) |
| `createRun({ source, retentionDays, cutoff, startedBy })` | Inserts a `running` run, field by field; `conflict` when one is already running for the source (the partial unique index) (slice 2b) |
| `claimRunForContinue(runId, now)` | Moves a `partial` or `failed` run back to `running` and writes `last_batch_at`; `not_continuable` for any other id, `conflict` if another run is running (slice 2b) |
| `runBatchAllAccounts(source, runId, cutoff, batchSize)` | Moves one batch through the source's database function (`archive_audit_trail_batch`) with the run's **stored** cutoff; returns three counts, never content (slice 2b) |
| `finishRun(runId, { status, errorCode, now })` | Ends a `running` run as `succeeded`, `partial` or `failed`; zero rows is an error (slice 2b) |
| `deleteArchivedForUser(userId)` | GDPR erasure: deletes every archived row of one account, of any source. Refuses a non-UUID before any query; one filter (`user_id`), no `select`; returns the count, and a missing count is an error (slice 3) |
| `listArchivedForUser(userId, source)` | GDPR export: one account's archived rows of one source (`source_id`, `payload`, `archived_at`), newest first, read in 1,000-row pages. The only method that selects `payload` (slice 3) |

**Writes (slice 2b).** It writes `archive_runs` only. Rows of `audit_trail` and `archived_records` move **only** through the database function, which copies, deletes and records a batch in one transaction and refuses a run that is not `running` with exactly the stored cutoff. The function name lives in this server-only file, never in the client-safe registry. The callers are `POST /api/admin/archiving/runs` and its runner `lib/archiving/server/runArchive.ts`, both behind `requireAdmin`; the route's source test pins that the runner is the only caller of `runBatchAllAccounts` and the route the only caller of the runner, after its runs-enabled check. **Per-user (slice 3).** `deleteArchivedForUser` is the one other write: a delete by one account's `user_id`, no payload. Both per-user methods are called only by `AuditTrailService.anonymizeUserData` / `exportUserData`, whose callers must pass the authenticated or admin-verified account id, never a request-body value (the argument is the tenant boundary on a service-role path).

### ProcessedWebhookEventRepository
**Location:** `lib/repositories/ProcessedWebhookEventRepository.ts`

**Purpose:** The Stripe webhook's idempotency claim on `processed_webhook_events`: one row per Stripe event id, `processing` → `completed`, or `failed` so that Stripe's next delivery may reclaim it. Moved out of `app/api/stripe/webhook/route.ts` with no behaviour change (CF-5 PR 1, [workplan](/docs/workplans/BUSINESS_OS_WEBHOOK_CONNECT_REPOSITORIES_WORKPLAN.md) §7.3.2).

**Key Methods:**
| Method | Description |
|--------|-------------|
| `findClaim(eventId)` | `event_id, status` of the claim, or null |
| `insertClaim(row)` | New `processing` claim; a `23505` comes back as the same error object (another delivery won) |
| `reclaimFailed(eventId)` | A `failed` claim back to `processing` |
| `complete(eventId)` | `completed`; reached only through the route's `completeClaim()` (source guard) |
| `markFailed(eventId, message)` | Releases the claim after a handler threw |

#### Pattern: unscoped by design, owner proven by the caller (Stripe webhook repositories)

The Stripe webhook runs on the service role with no user session, and its queries are keyed by Stripe ids or by rows it already loaded, not by a session user. The repositories it uses (this one first; the invoice, money-row, plan and booking methods follow in CF-5 PRs 2 to 5) therefore carry methods **without a `user_id` filter**, as an exception to Rule 4. The exception is bounded:

- **Section header.** Such methods sit in one section per class, headed `// Stripe webhook: keyed by Stripe ids or rows the route has already proved owned (⟨unscoped-by-design⟩)`.
- **Marker and owner check named.** Each method's doc comment carries `⟨unscoped-by-design⟩` and names what replaces the owner filter. Either the key is a Stripe id from a signature-verified event, which a business cannot forge, or the row was proved to belong to the sending connected account before the call (the route's `accountOwns`). Adding a `user_id` filter there would change the query, and these moves are behaviour-preserving.
- **Tested.** Each such method has a unit test asserting that it adds no owner filter, so a later "fix" that adds one has to change the test on purpose.
- **Fixed shape.** Column lists are module constants (a closed union type). Inserts take a typed row that the caller passes as an object literal (or with `satisfies`), so an extra key fails `tsc`. There is no generic patch or update method: each update is a named transition with its patch fixed in the repository (SA Q-3 / C-3 of the workplan; `tenant-isolation-guard` Step 3).
- **Errors passed through.** Methods return supabase-js's own `{ data, error }`, the same error object, so callers keep reading `error.code`. They neither catch nor log: the route logs what it acts on, with the correlation and Stripe event ids.

## Type Definitions

All shared types are centralized in `lib/repositories/types.ts`:

| Type | Description |
|------|-------------|
| `Agent` | Core agent entity with all fields |
| `AgentStatus` | Status union type: `'draft' \| 'active' \| 'inactive' \| 'deleted' \| 'archived'` |
| `Execution` | Agent execution record with logs |
| `ExecutionStatus` | Execution status: `'pending' \| 'running' \| 'completed' \| 'failed' \| 'success' \| 'error'` |
| `ExecutionStatusRecord` | Lightweight execution record for status polling |
| `ExecutionLogs` | Structured execution log data |
| `ExecutionTokensUsed` | Token consumption with intensity adjustment |
| `TokenUsage` | Token consumption record |
| `SharedAgent` | Shared agent template entity |
| `AgentMetrics` | Performance metrics snapshot |
| `SystemSettingsConfig` | System configuration entry |
| `AgentStats` | Agent run statistics |
| `AgentConfiguration` | Agent input values configuration |
| `AgentLog` | Agent execution output log |
| `ExecutionLog` | Step-by-step execution log entry |
| `CreateExecutionInput` | Input for creating execution records |
| `CreateAgentLogInput` | Input for creating agent logs |
| `CreateExecutionLogInput` | Input for creating execution logs |
| `UpsertPluginConnectionInput` | Input for upserting plugin connections |
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
| `ExecutionRepository` | create, findByAgentId, updateLogs, findRunningByAgentId, findForStatusQuery |
| `SharedAgentRepository` | create |
| `AgentMetricsRepository` | findByAgentId |
| `ConfigRepository` | getSystemConfig (on cache miss) |
| `MemoryRepository` | findByAgentId (on large queries) |
| `SystemConfigRepository` | getByKey, getByCategory, set, setMultiple, delete |
| `AgentStatsRepository` | getLastRunCost, incrementStats |
| `AgentConfigurationRepository` | getInputValues, updateStatus |
| `AgentLogsRepository` | create |
| `PluginConnectionRepository` | upsert |
| `ExecutionLogRepository` | create |

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
| `/api/run-agent` | POST | Multiple repositories | Execute agent (uses 7 repositories) |
| `/api/run-agent` | GET | `executionRepository.findForStatusQuery()` | Get execution status |
| `/api/shared-agents` | POST | `sharedAgentRepository.create()` | Share an agent |
| `/api/shared-agents/exists` | GET | `sharedAgentRepository.existsByOriginalAgent()` | Check if agent is shared |
| `/api/system-config` | GET | `systemConfigRepository.getByCategory()` | Get system config |

**`/api/run-agent` POST uses:**
- `agentRepository.findById()` - Fetch agent
- `agentStatsRepository.getLastRunCost()` - Estimate cost
- `agentStatsRepository.incrementStats()` - Track execution stats
- `agentConfigurationRepository.getInputValues()` - Get saved inputs
- `executionRepository.create()` - Create execution record
- `executionRepository.updateLogs()` - Store adjusted tokens
- `agentLogsRepository.create()` - Log execution output
- `executionLogRepository.create()` - Step-by-step logs (legacy path)
- `systemConfigRepository.getBoolean()` - Check pilot enabled

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

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-02-13 | Added `PluginConnectionRepository` | Extracted all direct Supabase queries from `UserPluginConnections` into a dedicated repository with 11 methods. Deleted legacy `lib/plugins/savePluginConnection.ts`. Added `UpsertPluginConnectionInput` type. |
| 2026-02-13 | Extracted `OAuthTokenService` | Moved OAuth HTTP plumbing (`exchangeCodeForTokens`, `refreshAccessToken`, `fetchUserProfile`, `calculateExpiresAt`) from `UserPluginConnections` into `lib/services/OAuthTokenService.ts`. Consolidated duplicated PKCE logic. |
| 2026-02-13 | Cleaned up `UserPluginConnections` | Removed dead code (`hasPluginPermission`, `cleanupExpiredConnections`), removed `getPluginDisplayName` hack, replaced all `any` types with proper types (`NextRequest`, `Record<string, unknown>`), extracted `audit()` helper with static import, added bounded token validation cache (max 100 entries). |
| 2026-09-26 | `ArchiveRepository`: archive-side reads | Admin Archiving slice 2a: `countArchivedAllAccounts`, `listRuns`, `getLatestCutoff` over the new `archived_records` / `archive_runs` tables; still read-only. Naming rule clarified: `…AllAccounts` for account data, plain names for the run log |
| 2026-09-26 | Added `ArchiveRepository` | Admin Archiving slice 1: three read-only, all-accounts count methods over `audit_trail`, service role documented. Added to the structure tree and the catalog. |
| 2026-09-27 | `ArchiveRepository`: per-user erasure and export | Admin Archiving slice 3: `deleteArchivedForUser` (GDPR erasure deletes archived rows, C-8) and `listArchivedForUser` (GDPR export, the one `payload` read), both scoped by `userId` and refusing a non-UUID |
| 2026-09-26 | `ArchiveRepository`: run lifecycle | Admin Archiving slice 2b: `takeOverStaleRuns`, `createRun`, `claimRunForContinue`, `runBatchAllAccounts` (through `archive_audit_trail_batch`), `finishRun`. The repository now writes `archive_runs`; archive rows move only through the database function |
| 2026-10-07 | Added `ProcessedWebhookEventRepository` | CF-5 PR 1: the Stripe webhook's claim queries (five) moved behind a repository with exact chains. Recorded the "unscoped by design, owner proven by the caller" pattern for the webhook repositories (SA C-6) |
