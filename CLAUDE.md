# CLAUDE.md — Project Context for AgentPilot

> **Last Updated**: 2026-04-07  
> This file is the project's root context document and is exempt from the standard docs ToC requirement.

## Overview

**AgentPilot** is a **no-code AI automation platform** that converts natural-language prompts into fully working agents (workflows).
Users describe what they want (e.g. *"Summarize my last 10 Gmail emails and save to Notion"*) — AgentPilot automatically detects required plugins, builds input/output schemas, and creates runnable automations.

> **Agents:** Read this file fully before starting any task.
> Key sections: [Mandatory Rules](#mandatory-rules) · [Security Rules](#security-rules) · [Agent Team](#agent-team)

---

## Tech Stack

| Layer | Tech |
|-------|------|
| **Frontend** | Next.js 14 (App Router), TypeScript, React 18, TailwindCSS 4, Framer Motion |
| **Backend** | Next.js API Routes (serverless) |
| **Database** | Supabase (PostgreSQL + Auth + RLS) |
| **LLM Providers** | OpenAI GPT-4o, Anthropic Claude, Groq, Mistral, Kimi |
| **Hosting** | Vercel |
| **Logging** | Pino (structured logging) |
| **Validation** | Zod schemas |
| **UI Components** | Radix UI primitives + custom design system |

---

## Agent Team

| Agent | Initials | Triggered by |
|---|---|---|
| Team Leader | TL | User |
| Business Analyst | BA | User |
| Developer | Dev | User or TL |
| System Architect | SA | User or TL |
| Quality Assurance | QA | User or TL |
| Release Manager | RM | User or TL |

**Standard flow:**
User → TL → BA → Dev (workplan) → SA (workplan review) → Dev (implement)
→ SA (code review) → QA (test) → TL (retrospective + user approval) → RM (commit)

---

## Repository Structure

| Directory | Purpose |
|-----------|---------|
| `/app/api/` | Next.js API routes organized by domain |
| `/app/api/agent-creation/` | Thread-based agent creation flow (phases 1-4) |
| `/app/api/v6/` | V6 semantic agent generation endpoints |
| `/app/(protected)/` | Protected routes requiring authentication |
| `/app/v2/` | V2 Dashboard and Sandbox (primary UI) |
| `/components/` | React components (presentational) |
| `/components/ui/` | Radix-UI based design system primitives |
| `/components/v6/` | V6 Review Mode UI components |
| `/lib/agentkit/v6/` | V6 agent generation pipeline (latest) |
| `/lib/pilot/` | Workflow execution engine (non-DSL) |
| `/lib/ai/` | AI provider abstraction layer |
| `/lib/ai/providers/` | Provider implementations (OpenAI, Anthropic, etc.) |
| `/lib/repositories/` | Data access layer (Supabase abstraction) |
| `/lib/services/` | Business logic services |
| `/lib/plugins/` | Plugin strategies + registry |
| `/lib/validation/` | Zod validation schemas |
| `/lib/utils/` | Utility functions and helpers |
| `/lib/audit/` | Audit trail infrastructure |
| `/hooks/` | React custom hooks |
| `/types/` | Shared TypeScript definitions |
| `/docs/` | Architecture and implementation documentation |
| `/docs/requirements/` | BA writes requirement MDs here |
| `/docs/workplans/` | Dev writes workplan MDs here; SA and QA annotate |
| `/docs/retrospectives/` | TL appends retrospective after each completed cycle |

---

## Key Architecture Components

| System | Purpose | Location |
|--------|---------|----------|
| **V6 Pipeline** | 5-phase semantic agent generation (latest) | `/lib/agentkit/v6/` |
| **Pilot Engine** | Workflow execution for complex multi-step agents | `/lib/pilot/` |
| **Thread-based Creation** | Multi-phase agent creation with OpenAI threads | `/app/api/agent-creation/` |
| **Repository Pattern** | Data access abstraction for all entities | `/lib/repositories/` |
| **AI Provider Factory** | Multi-provider abstraction (singleton) | `/lib/ai/providerFactory.ts` |
| **Orchestration Service** | Workflow orchestration with AIS-based model routing | `/lib/orchestration/OrchestrationService.ts` |
| **Audit Trail Service** | Centralized audit logging (batched, non-blocking) | `/lib/services/AuditTrailService.ts` |
| **User Context** | LLM personalization from auth/profile data | `/lib/user-context/` |

### V6 Agent Generation Pipeline

5-phase semantic pipeline:
1. **Semantic Plan** - Extract user intent into workflow draft
2. **Grounding** - Validate against available data sources
3. **Ambiguity Detection** - 5-layer detection system
4. **Formalization** - Generate logical IR (Declarative IR format)
5. **Compilation** - IR to DSL conversion

### Pilot Workflow Engine

Step types supported:
- `action` - Plugin execution
- `llm_decision` - AI-powered decision making
- `transform` - Data transformation
- `comparison` - Value comparison
- `validation` - Data validation
- `parallel` - Concurrent execution (scatter-gather)
- `control` - Conditional/loop logic

---

## Platform Design Principles

These are architectural rules that apply to anyone working on the V6 pipeline or plugin system.

### No Hardcoding in System Prompts

Never add plugin-specific rules or operation names to system prompts or IR generation logic.

| ❌ Wrong | ✅ Right |
|---|---|
| "For Google Drive, use `find_or_create_folder`" | "Prefer `find_or_create_X` actions — they handle idempotency for any plugin" |
| "Don't use AI for data restructuring" | Let the compiler detect and optimise redundant AI steps |
| Hardcoded field names or API patterns | Reference the plugin schema as the source of truth |

**Why:** AgentPilot serves non-technical users with any plugin combination. Hardcoded rules don't scale and break when plugins change. Plugin schemas are the source of truth — let the LLM reason from them.

### Fix Issues at the Root Cause

When a bug appears in pipeline output, trace it to the responsible phase and fix it there.

| Phase | Responsible for | Location |
|---|---|---|
| IntentContract generation | LLM reasoning about user intent and plugin capabilities | `/lib/agentkit/v6/` |
| CapabilityBinderV2 | Binding intent to available plugin operations | `/lib/agentkit/v6/` |
| IntentToIRConverter | Converting intent contracts to logical IR | `/lib/agentkit/v6/` |
| ExecutionGraphCompiler | Compiling IR to executable DSL | `/lib/pilot/` |

**Rule:** Only implement a fix in a downstream phase if it is genuinely a generic compiler optimisation that scales to any plugin (e.g. removing redundant steps, normalising variable references). Never add plugin-specific logic to the compiler.

---

## Git Conventions

| Convention | Rule |
|---|---|
| Feature branches | `feature/[feature-slug]` |
| Fix branches | `fix/[issue-slug]` |
| Commit style | Conventional Commits: `feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:` |
| Never | Commit directly to `main` |
| Never | Commit `.env`, secrets, or credentials |

Commits are managed by the Release Manager agent — see RM agent definition.

---

## Development Standards

The following documents define **mandatory development standards** for this project. All contributors (human and AI) must follow these patterns:

| Standard | Document | Summary |
|----------|----------|---------|
| **Repository Pattern** | [REPOSITORY_STRATEGY.md](/docs/REPOSITORY_STRATEGY.md) | All database access MUST go through the repository layer (`lib/repositories/`). No direct Supabase queries in API routes, services, or components. Repositories are server-side only — never import them in `'use client'` components. |

### Mandatory Rules (all contributors — human and AI)

1. All DB access via `lib/repositories/` — no direct Supabase calls in routes/services/components
2. All API route inputs validated with Zod before any business logic
3. All API routes use `correlationId` and structured Pino logging — no `console.log`
4. All Supabase queries **must** include `.eq('user_id', userId)` unless intentionally bypassed with `supabaseServer` (document why)
5. No hardcoded model names — use provider factory + feature flags
6. TypeScript strict mode — no implicit `any`; if `any` is unavoidable, add a comment explaining why
7. No new patterns introduced without SA review
8. When working on the V6 pipeline or plugin system — read the Platform Design Principles section before making any changes

---

## Security Rules (non-negotiable)

| Rule | Why |
|---|---|
| Always `.eq('user_id', userId)` in queries | Prevents cross-user data leakage |
| `supabaseServer` (service role) only when RLS bypass is intentional — document in code | Accidental service role use bypasses all row-level security |
| Never expose internal error details to client in production | Use `process.env.NODE_ENV === 'development'` guard already in API pattern |
| No secrets or API keys in code — environment variables only | RM must check before every commit |
| Input sanitised via Zod before use | Never trust client-supplied data |

---

## Documentation Standards

All project documentation lives under `/docs/`. When creating or updating docs, follow these conventions:

**File Naming:**

| Doc Type | Convention | Example |
|----------|------------|---------|
| High-level guides | `SCREAMING_SNAKE_CASE.md` | `REPOSITORY_STRATEGY.md` |
| Implementation docs | `PascalCase_With_Underscores.md` | `V2_Agent_Creation.md` |
| Plugin docs | `kebab-case.md` | `google-sheets-plugin.md` |
| Deprecated docs | Move to `docs/archive/` | — |

**Required Structure:**

1. **Header block** — title, last-updated date, and a brief purpose statement:
   ```markdown
   # Document Title

   > **Last Updated**: YYYY-MM-DD

   ## Overview
   One paragraph: what this doc covers and why it exists.
   ```

2. **Table of Contents** — required for docs longer than ~150 lines, placed after the Overview.

3. **Change History** — required for living docs. Place at the **end** of the document:
   ```markdown
   ## Change History

   | Date | Change | Details |
   |------|--------|---------|
   | 2026-02-13 | Added X | Brief description |
   ```

**Formatting Rules:**

- Use **tables** for structured data (APIs, configs, comparisons, status tracking)
- Include **file paths** before code blocks (`**File:** \`lib/server/example.ts\``)
- Use proper language tags on code fences (```typescript, ```json, ```bash)
- Cross-reference other docs with relative links: `[Doc Name](/docs/DOC_NAME.md)`
- Status indicators: `✅` done, `⬜` todo, `🟢` easy, `🟡` medium, `🔴` hard
- Use `---` horizontal rules to separate major sections
- Maximum one blank line between sections

---

## Code Patterns & Conventions

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| **Components** | PascalCase | `AgentWizard.tsx` |
| **API routes** | kebab-case directories | `/api/run-agent/route.ts` |
| **Utils/Services** | camelCase | `featureFlags.ts` |
| **Type files** | suffix with `-types.ts` or `-schema.ts` | `plugin-types.ts` |
| **Constants** | SCREAMING_SNAKE_CASE | `AUDIT_EVENTS` |
| **Booleans** | Prefix with verb | `isEnabled`, `hasChanges`, `canEdit` |

### Import Patterns

```typescript
// Always use @/ path alias
import { AgentRepository } from '@/lib/repositories/AgentRepository';
import type { Agent } from '@/types/agent';

// Supabase clients
import { supabase } from '@/lib/supabaseClient';        // Browser
import { supabaseServer } from '@/lib/supabaseServer';  // Server (service role)

// Logging
import { createLogger } from '@/lib/logger';
const logger = createLogger({ module: 'ModuleName' });
// or with service name:
const logger = createLogger({ service: 'ServiceName' });

// Next.js
import { NextRequest, NextResponse } from 'next/server';
import { useRouter } from 'next/navigation';
```

### API Route Pattern

Standard structure for all API routes:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { getUser } from '@/lib/auth';
import { createLogger } from '@/lib/logger';
import { AuditTrailService } from '@/lib/services/AuditTrailService';

const logger = createLogger({ module: 'ExampleAPI' });
const auditTrail = AuditTrailService.getInstance();

export async function POST(request: NextRequest) {
  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId });

  try {
    // 1. Authenticate
    const user = await getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // 2. Validate input
    const body = await request.json();
    const validated = schema.parse(body); // Zod validation

    // 3. Execute business logic
    requestLogger.info({ userId: user.id }, 'Processing request');
    const result = await someOperation(validated);

    // 4. Audit log (non-blocking)
    auditTrail.log({ action: 'ACTION_NAME', userId: user.id, entityType: 'example', entityId: result.id })
      .catch(err => requestLogger.error({ err }, 'Audit failed'));

    // 5. Return response
    return NextResponse.json({ success: true, data: result });

  } catch (error) {
    requestLogger.error({ err: error }, 'Request failed');
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
```

### Error Response Format

Always use consistent error responses:

```typescript
// Success
return NextResponse.json({ success: true, data: result });

// Error
return NextResponse.json(
  {
    success: false,
    error: 'User-friendly message',
    details: process.env.NODE_ENV === 'development' ? errorDetails : undefined
  },
  { status: 400 }
);
```

### Component Pattern

Use Server Components by default. Only add `'use client'` when you need interactivity, browser APIs, or React hooks.

```typescript
'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

interface Props {
  agentId: string;
  onSave: (data: AgentData) => Promise<void>;
  variant?: 'compact' | 'full';
}

export function AgentEditor({ agentId, onSave, variant = 'full' }: Props) {
  const [loading, setLoading] = useState(false);

  return (
    <div className="space-y-4">
      {/* Component content */}
    </div>
  );
}
```

---

## Supabase Patterns

### Client Types

| Client | Import | Use Case |
|--------|--------|----------|
| `supabaseClient` | `@/lib/supabaseClient` | Browser/client-side (respects RLS) |
| `supabaseServer` | `@/lib/supabaseServer` | Server with service role (bypasses RLS) |
| `supabaseServerAuth` | `@/lib/supabaseServerAuth` | Server with user auth cookies |

### Repository Pattern

All database operations go through repositories (see [REPOSITORY_STRATEGY.md](/docs/REPOSITORY_STRATEGY.md)):

```typescript
// lib/repositories/AgentRepository.ts
export class AgentRepository {
  async findById(id: string, userId: string): Promise<AgentRepositoryResult<Agent>> {
    try {
      const { data, error } = await this.supabase
        .from('agents')
        .select('*')
        .eq('id', id)
        .eq('user_id', userId)    // Always filter by user!
        .neq('status', 'deleted') // Exclude soft-deleted
        .single();

      if (error) throw error;
      return { data, error: null };
    } catch (error) {
      return { data: null, error: error as Error };
    }
  }
}
```

### Key Tables

| Table | Purpose |
|-------|---------|
| `agents` | Agent definitions (name, prompt, schema, status, schedule) |
| `agent_executions` | Execution history with logs |
| `agent_prompt_threads` | Thread state for agent creation flow |
| `plugin_connections` | User's connected plugins |
| `audit_trail` | Comprehensive audit logging |
| `agent_logs` | Step-by-step execution logs |
| `agent_memory` | Agent short/long-term memory |

### Query Patterns

```typescript
// Always include user_id for security
.eq('user_id', userId)
.neq('status', 'deleted')

// Pagination (note: range is inclusive)
.range(0, 9)  // Returns 10 items (0-9)

// Ordering
.order('created_at', { ascending: false })

// With relationships
.select('*, plugin_connections(*)')
```

---

## Feature Flags

Feature flags control experimental features and gradual rollouts. See `/docs/feature_flags.md` for full documentation.

### Usage

```typescript
import { useV6AgentGeneration, useV6ReviewMode, useThreadBasedAgentCreation } from '@/lib/utils/featureFlags';

// Client-side checks
if (useV6AgentGeneration()) {
  // Use V6 5-phase pipeline
}

if (useV6ReviewMode()) {
  // Use split API flow with review UI (default: true)
}

if (useThreadBasedAgentCreation()) {
  // Use thread-based agent creation
}
```

### Key Flags

| Flag | Function | Purpose |
|------|----------|---------|
| `NEXT_PUBLIC_USE_V6_AGENT_GENERATION` | `useV6AgentGeneration()` | Enable V6 semantic pipeline |
| `NEXT_PUBLIC_USE_V6_REVIEW_MODE` | `useV6ReviewMode()` | Enable 2-step API flow with user review (default: true) |
| `NEXT_PUBLIC_USE_THREAD_BASED_AGENT_CREATION` | `useThreadBasedAgentCreation()` | Enable thread-based creation |
| `NEXT_PUBLIC_USE_NEW_AGENT_CREATION_UI` | `useNewAgentCreationUI()` | Enable new conversational UI |

**Note:** `NEXT_PUBLIC_` prefix required for client-side access. Database-based flags for orchestration are managed via `/api/admin/orchestration-config`.

---

## Logging

Use structured logging with Pino (see [SYSTEM_LOGGING_GUIDELINES.md](/docs/SYSTEM_LOGGING_GUIDELINES.md)):

```typescript
import { createLogger } from '@/lib/logger';

// Create logger with module or service context
const logger = createLogger({ module: 'AgentService' });
// or: createLogger({ service: 'AgentRepository' });

// Info level
logger.info({ agentId, userId }, 'Agent created successfully');

// Error level (always include err object)
logger.error({ err: error, agentId }, 'Failed to create agent');

// Debug level
logger.debug({ payload }, 'Request payload');

// Child logger with correlation ID for request tracing
const requestLogger = logger.child({ correlationId });
```

---

## Audit Trail

Non-blocking audit logging for all important operations:

```typescript
import { AuditTrailService } from '@/lib/services/AuditTrailService';

// Get singleton instance
const auditTrail = AuditTrailService.getInstance();

// Log with .log() method - always non-blocking with .catch()
await auditTrail.log({
  action: 'AGENT_UPDATED',
  entityType: 'agent',
  entityId: agentId,
  userId: user.id,
  resourceName: agent.agent_name,
  changes: diff,
  severity: 'warning',
  request
}).catch(err => logger.error({ err }, 'Audit failed (non-blocking)'));
```

---

## AI Provider Factory

All LLM calls go through the provider factory — never call provider SDKs directly in feature code.

```typescript
import { getProviderFactory } from '@/lib/ai/providerFactory';

const factory = getProviderFactory();
const provider = factory.getProvider('openai'); // or 'anthropic', 'groq', 'mistral', 'kimi'

const response = await provider.complete({
  model: factory.getDefaultModel('openai'),
  messages: [...],
});
```

**Rules:**
- Provider selection is config/feature-flag driven — do not hardcode model names
- To add a new provider: extend the factory, do not add one-off direct SDK calls
- The factory is a singleton — never instantiate providers directly

---

## User Context

Personalize LLM calls with user data from auth or profile. See [USER_CONTEXT.md](/docs/USER_CONTEXT.md) for full details.

```typescript
import { buildUserContextFromAuth, mergeUserContext } from '@/lib/user-context';

// Fast path — from auth metadata (no DB call)
const userContext = buildUserContextFromAuth(user);

// With client overrides
const finalContext = mergeUserContext(serverContext, body.user_context);

// Full path — from profiles table (DB call)
import { buildUserContextFromProfile } from '@/lib/user-context';
const userContext = await buildUserContextFromProfile(user);
```

Include user context in LLM calls for agent creation, workflow generation, and any personalized responses.

---

## UI Components

Use Radix UI primitives from `/components/ui/`:

```typescript
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
```

### Styling

- **TailwindCSS** for utility classes
- **CVA (class-variance-authority)** for component variants
- **V2 Design System** tokens: `var(--v2-primary)`, `var(--v2-secondary)`, etc.
- **cn()** helper for conditional classes

---

## Testing

| Type | Tool | When to use |
|---|---|---|
| Unit | Jest | Pure functions, hooks, utilities, Zod schemas |
| Integration | Jest + Supabase test client | API routes, repositories, service logic |
| E2E | Playwright | Critical user journeys (agent creation, plugin connection, execution) |

**File location:** Co-located (`*.test.ts`) for unit tests, `__tests__/` for integration, `e2e/` for Playwright.

**Coverage expectations:**
- New API routes: integration test covering happy path + auth failure + invalid input
- New repositories: unit test for each method
- New UI flows: Playwright test for the critical path

**Before any code is committed:** QA agent must confirm at minimum the happy path and one failure path are tested.

### Commands

```bash
npm test           # Run Jest tests
npm run test:e2e   # Run Playwright tests
```

---

## Common Gotchas & Anti-Patterns

### Performance

| Issue | Solution |
|-------|----------|
| Auth overhead (200-1,880ms per call) | Cache auth tokens, see `PERFORMANCE_OPTIMIZATION_PLAN.md` |
| Duplicate API calls | Use `lib/utils/request-deduplication.ts` |
| React StrictMode double-mounting | Use request deduplication or memoization |

### Database

| Issue | Solution |
|-------|----------|
| Pagination off-by-one | `.range(0, 9)` for 10 items, NOT `.range(0, 10)` |
| Large JSON arrays | Use `data.join('\n')` instead of array storage |
| Concurrent updates | Use RPC functions for safe updates (e.g., `update_agent_schedule_safe`) |

### Build

| Issue | Solution |
|-------|----------|
| TypeScript errors ignored | `next.config.js` ignores errors - **fix them anyway** |
| Feature flag naming | `NEXT_PUBLIC_` prefix required for client-side |

### Code Quality

| Anti-Pattern | Instead Do |
|--------------|------------|
| Direct Supabase calls in components | Use repository pattern |
| Blocking audit logging | Always use `.catch()` for non-blocking |
| Hardcoded model names | Use provider factory and feature flags |
| Missing correlation IDs | Include `x-correlation-id` header for tracing |

---

## Plugin System (V2)

Plugins use a JSON-definition + executor-class architecture. See [PLUGIN_GENERATION_WORKFLOW.md](/docs/PLUGIN_GENERATION_WORKFLOW.md) for the full plugin generation guide.

| Component | Location | Purpose |
|-----------|----------|---------|
| **Plugin Definitions** | `lib/plugins/definitions/{name}-plugin-v2.json` | OAuth config, action schemas, output schemas |
| **Plugin Executors** | `lib/server/{name}-plugin-executor.ts` | Action implementation (extends `BasePluginExecutor`) |
| **Base Executor** | `lib/server/base-plugin-executor.ts` | Shared executor logic (auth, error handling) |
| **Plugin Manager** | `lib/server/plugin-manager-v2.ts` | Loads definitions, manages plugin registry |
| **Executor Registry** | `lib/server/plugin-executer-v2.ts` | Maps plugin keys to executor classes |
| **Plugin List (UI)** | `lib/plugins/pluginList.tsx` | UI metadata for plugin display |

Connections stored in `plugin_connections` table.

> See Deprecated section — v1 plugin system must not be extended.

---

## Deprecated — Do Not Use or Extend

| System | Location | Replaced by |
|---|---|---|
| V1 plugin strategy system | `lib/plugins/pluginRegistry.ts`, `lib/plugins/strategies/` | V2 plugin architecture |
| Any direct Supabase calls outside repositories | Anywhere | Repository pattern (`lib/repositories/`) |

If you find code using deprecated patterns during development, flag it in the workplan — do not silently extend deprecated systems.

---

## Development Commands

```bash
npm run dev        # Development server (filtered logs)
npm run dev:pretty # Development with pino-pretty formatting
npm run build      # Production build
npm run lint       # ESLint
```

---

## Key Documentation

| Document | Purpose | Last Updated |
|----------|---------|--------------|
| [feature_flags.md](/docs/feature_flags.md) | Complete feature flag reference (env + database flags) | 2026-02-08 |
| [V6_OVERVIEW.md](/docs/v6/V6_OVERVIEW.md) | V6 agent generation system overview and documentation guide | 2026-01-16 |
| [V6_AGENT_CREATION_INTEGRATION_PLAN.md](/docs/v6/V6_AGENT_CREATION_INTEGRATION_PLAN.md) | V6 integration with Intent Validation and Review UI | 2026-01-21 |
| [V2_Thread-Based-Agent-Creation-Flow.md](/docs/V2_Thread-Based-Agent-Creation-Flow.md) | Thread-based agent creation flow diagram | 2026-01-16 |
| [V2_AGENT_CREATION_AND_SAVE_IMPLEMENTATION.md](/docs/V2_AGENT_CREATION_AND_SAVE_IMPLEMENTATION.md) | V2 agent creation & save implementation (Phase 1-14) | 2025-11-25 |
| [V2_TEST_PAGE_SCOPE.md](/docs/V2_TEST_PAGE_SCOPE.md) | Test page functionality (`/test-plugins-v2`) | 2026-01-21 |
| [REPOSITORY_STRATEGY.md](/docs/REPOSITORY_STRATEGY.md) | Repository pattern guidelines and architecture | 2026-01-15 |
| [SYSTEM_LOGGING_GUIDELINES.md](/docs/SYSTEM_LOGGING_GUIDELINES.md) | Pino logging standards and best practices | 2025-11-28 |
| [USER_CONTEXT.md](/docs/USER_CONTEXT.md) | User context module for LLM personalization | not tracked |
| [PLUGIN_GENERATION_WORKFLOW.md](/docs/PLUGIN_GENERATION_WORKFLOW.md) | Interactive plugin generation guide for Claude Code | not tracked |
| [AI_PROVIDER_MODELS.md](/docs/AI_PROVIDER_MODELS.md) | Complete LLM provider/model catalogue with token limits and pricing | 2026-04-08 |

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-04-07 | Resolved merge conflicts | Merged 13 conflicts between comprehensive (agent team, design principles, security, testing, deprecated) and lean branches. Kept comprehensive version with additional Code Quality gotcha entries from lean branch. |
