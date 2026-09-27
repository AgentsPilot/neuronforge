# CLAUDE.md — Project Context for AgentPilot

> **Last Updated**: 2026-09-27
> This file is the project's root context document and is exempt from the standard docs ToC and Change History requirements — its history is `git log -- CLAUDE.md`.

## Overview

**AgentPilot** is a **no-code AI automation platform** that converts natural-language prompts into fully working agents (workflows).
Users describe what they want (e.g. *"Summarize my last 10 Gmail emails and save to Notion"*) — AgentPilot automatically detects required plugins, builds input/output schemas, and creates runnable automations.

> **Agents:** Read this file fully before starting any task.
> Key sections: [Mandatory Rules](#mandatory-rules-all-contributors--human-and-ai) · [Security Rules](#security-rules-non-negotiable) · [Agent Team](#agent-team)

> **Maintaining this file:** it holds rules that don't change and pointers to docs — **never counts, statuses, PR numbers or "as of" dates**. Those belong in the linked doc, which is their single source of truth. If a change to the codebase would force an edit here, the detail is in the wrong place.

---

## Tech Stack

| Layer | Tech |
|-------|------|
| **Frontend** | Next.js 14 (App Router), TypeScript, React 18, TailwindCSS 4, Framer Motion |
| **Backend** | Next.js API Routes (serverless) |
| **Database** | Supabase (PostgreSQL + Auth + RLS) |
| **LLM Providers** | OpenAI, Anthropic, Groq, Mistral, Kimi |
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
| Troubleshooter | TS | User or TL |

**Standard flow:**
User → TL → BA → SA (requirement review) → Dev (workplan) → SA (workplan review) → Dev (implement)
→ SA (code review) → QA (test) → user sees the diff → TL (retrospective + user approval) → RM (commit + PR)

UI-only changes take a short path, and nothing is committed before the user has seen the diff — see [team-leader.md](/.claude/agents/team-leader.md) § Standing User Preferences.

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
| `/lib/pilot/` | Workflow execution engine |
| `/lib/ai/` | AI provider abstraction layer (`providerFactory.ts`, `providers/`) |
| `/lib/orchestration/` | Workflow orchestration with AIS-based model routing |
| `/lib/business-os/` | Business OS modules (CRM, scheduling, payments, insights, LLM, entitlements) |
| `/lib/repositories/` | Data access layer (Supabase abstraction) |
| `/lib/services/` | Business logic services (incl. `AuditTrailService.ts`) |
| `/lib/plugins/` | Plugin definitions + UI metadata |
| `/lib/server/` | Plugin executors and plugin manager |
| `/lib/validation/` | Zod validation schemas |
| `/lib/user-context/` | LLM personalization from auth/profile data |
| `/hooks/` | React custom hooks |
| `/types/` | Shared TypeScript definitions |
| `/docs/requirements/` | BA writes requirement MDs here |
| `/docs/workplans/` | Dev writes workplan MDs here; SA and QA annotate |
| `/docs/retrospectives/` | TL appends retrospective after each completed cycle |

---

## Platform Design Principles

These apply to anyone working on the V6 pipeline or plugin system.

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
| Never | Commit or push directly to `main` — every change merges through a PR with required checks green |
| Never | Commit `.env`, secrets, or credentials |

Commits are managed by the Release Manager agent — see RM agent definition.

---

## Mandatory Rules (all contributors — human and AI)

> Code comments cite these by number ("CLAUDE.md rule 4") — keep the numbering stable.

1. All DB access via `lib/repositories/` — no direct Supabase calls in routes/services/components. Repositories are server-side only — never import them in `'use client'` components. See [REPOSITORY_STRATEGY.md](/docs/REPOSITORY_STRATEGY.md).
2. All API route inputs validated with Zod before any business logic
3. All server/app code uses structured Pino logging via `createLogger` — never `console.*` (API routes also attach a `correlationId`). See [Logging](#logging) for what to do when you touch a non-compliant file.
4. All Supabase queries **must** include `.eq('user_id', userId)` unless intentionally bypassed with `supabaseServer` (document why)
5. No hardcoded model names — use provider factory + feature flags
6. TypeScript strict mode — no implicit `any`; if `any` is unavoidable, add a comment explaining why
7. No new patterns introduced without SA review
8. When working on the V6 pipeline (`lib/agentkit/v6/`, `lib/pilot/`, `scripts/test-dsl-execution-simulator/`) or plugin system — read the [Platform Design Principles](#platform-design-principles) above AND follow the V6 Work Protocol in the `v6-pipeline` skill (§4). Start from [V6_DOCS_INDEX.md](/docs/v6/V6_DOCS_INDEX.md).

---

## Security Rules (non-negotiable)

| Rule | Why |
|---|---|
| Always `.eq('user_id', userId)` in queries | Prevents cross-user data leakage |
| `supabaseServer` (service role) only when RLS bypass is intentional — document in code | Accidental service role use bypasses all row-level security. A `.eq('user_id')` repo alone does **not** stop cross-tenant writes on service-role paths — use the `tenant-isolation-guard` skill |
| Never expose internal error details to client in production | Use the `process.env.NODE_ENV === 'development'` guard (see [Error Response Format](#error-response-format)) |
| No secrets or API keys in code — environment variables only | RM must check before every commit |
| Input sanitised via Zod before use | Never trust client-supplied data |
| Admin authz: routes gate with `requireAdmin` (first statement in the handler), pages with `requireAdminPage` — **never** `profiles.role` or `app_metadata.role` | `profiles.role` is user-writable (self-promotion). Source of truth is the `admin_users` table; the SQL-side predicate is `public.is_platform_admin()`. A hand-rolled `AdminAccessService` call inside a `route.ts` **fails the required CI guard**. Current coverage and known gaps: [ADMIN_IDENTIFICATION_AND_ACCESS.md](/docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md) |

---

## Currency & Timezone (Business OS)

Both are business-level facts with traps. Read before touching money display or any hour shown to a client.

| Rule | Why |
|---|---|
| **`scheduling_services.currency` is the authority** for what a client is charged | A business may price a client in another currency. `business_profiles.currency` is only a **default** for new services and a **label** for sums — never a constraint |
| **`user_preferences.timezone` is the authority** for the clock | `business_profiles.timezone` **does not exist**. Naming it in a `.select()` makes PostgREST reject the *whole* query |
| **NULL means "not asked"; `'UTC'` means "chose UTC"** | Keep them distinguishable, or the readiness gate cannot tell it needs to ask |
| **`LanguageContext.currencyCode` is localStorage-backed** — display only | Never seed a value that gets **written** from it. Use `businessCurrency` for anything persisted (invoices, payments, new services) |
| **Never sum money across currencies** | There is no FX rate anywhere in the platform. Group by currency (`revenue_by_currency`) and label with `primary_currency` |
| **A missing timezone blocks publishing** a booking surface | Via the `timezone` gap in `journeyReadiness`. Currency deliberately does **not** gate |

Fixing a gap? Use `gapFixAction(kind)` — it returns the settings tab *and* the label together, so they cannot point at different things.

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

Always import with the `@/` path alias.

### Scaffolding

| Creating a… | Use the skill |
|---|---|
| API route | `new-api-route` — auth, Zod, repository access, Pino + correlationId, non-blocking audit, error format |
| Repository | `new-repository` — client injection, `RepositoryResult`, `user_id` filter, soft delete |
| Plugin | `new-plugin` — definition JSON, executor, registries, UI list |

### Error Response Format

```typescript
return NextResponse.json({ success: true, data: result });

return NextResponse.json(
  {
    success: false,
    error: 'User-friendly message',
    details: process.env.NODE_ENV === 'development' ? errorDetails : undefined
  },
  { status: 400 }
);
```

### Components

Use Server Components by default. Only add `'use client'` when you need interactivity, browser APIs, or React hooks. Use Radix primitives from `/components/ui/`, Tailwind, CVA for variants, `cn()` for conditional classes, and V2 tokens (`var(--v2-primary)`, …).

---

## Supabase Patterns

| Client | Import | Use Case |
|--------|--------|----------|
| `supabaseClient` | `@/lib/supabaseClient` | Browser/client-side (respects RLS) |
| `supabaseServer` | `@/lib/supabaseServer` | Server with service role (bypasses RLS) |
| `supabaseServerAuth` | `@/lib/supabaseServerAuth` | Server with user auth cookies |

Before claiming a column or table exists, verify it against the live schema — use the `business-os-schema-check` skill.

---

## Feature Flags

Env flags live in `lib/utils/featureFlags.ts`; the full reference (env + database flags) is [feature_flags.md](/docs/feature_flags.md). `NEXT_PUBLIC_` prefix is required for client-side access.

> ⚠️ **Never name a flag reader `use…`.** These are plain functions that read `process.env`, not React hooks. `react-hooks/rules-of-hooks` keys off the *identifier*, so a `use`-prefixed plain function makes every call site a lint error and tells the next reader hook rules apply when they do not. Use `is…Enabled`. `npm run lint:hooks` enforces this.

---

## Logging

Use `createLogger({ module })` or `createLogger({ service })` from `@/lib/logger`; context first, message second (`logger.info({ agentId }, 'Agent created')`); errors always as `{ err }`; request handlers use `logger.child({ correlationId })`. Full guide: [SYSTEM_LOGGING_GUIDELINES.md](/docs/SYSTEM_LOGGING_GUIDELINES.md).

### Non-compliant files you touch (mandatory)

`console.*` is not an accepted logging path anywhere in `lib/`, `app/`, or `components/`. When you open or modify a file that still uses it:

1. **Flag it** to the user — name the file and the count of `console.*` calls.
2. **Propose converting** the whole file to the Pino standard.
3. **Convert it once the user approves** — proceed unless the user explicitly says they don't want it converted.

This is a basic coding standard, not optional cleanup. Don't silently leave a touched file non-compliant, and don't reformat files you aren't otherwise working on.

---

## Audit Trail

`AuditTrailService.getInstance().log({ action, entityType, entityId, userId, ... })` — **always non-blocking**: chain `.catch(err => logger.error({ err }, 'Audit failed'))`, never let an audit failure fail the request.

---

## AI Provider Factory

All LLM calls go through `getProviderFactory()` (`@/lib/ai/providerFactory`) — never call provider SDKs directly in feature code.

- Provider and model selection is config/feature-flag driven — do not hardcode model names
- To add a new provider: extend the factory, do not add one-off direct SDK calls
- The factory is a singleton — never instantiate providers directly
- Personalize with [User Context](/docs/USER_CONTEXT.md) (`buildUserContextFromAuth` / `buildUserContextFromProfile`)
- **Business OS AI calls** have stricter standards (catalogued call, attribution, cost tracking, audit, DB-resolved model settings) — use the `bos-llm-call-standards` skill

---

## Testing

| Type | Tool | When to use |
|---|---|---|
| Unit | Jest | Pure functions, hooks, utilities, Zod schemas |
| Integration | Jest + Supabase test client | API routes, repositories, service logic |
| E2E | **Not set up** | Playwright is not installed. Critical user journeys are verified manually by QA. Adding any E2E tool is a new pattern and needs SA review. |

**File location:** Co-located (`*.test.ts`) for unit tests, `__tests__/` for integration.

**Coverage expectations:**
- New API routes: integration test covering happy path + auth failure + invalid input
- New repositories: unit test for each method
- New UI flows: QA records a manual check of the critical path in the workplan's QA report; a source-level Jest guard can back it up where one fits

**Before any code is committed:** QA agent must confirm at minimum the happy path and one failure path are tested.

---

## Documentation Standards

All project documentation lives under `/docs/`.

| Doc Type | Convention | Example |
|----------|------------|---------|
| High-level guides | `SCREAMING_SNAKE_CASE.md` | `REPOSITORY_STRATEGY.md` |
| Implementation docs | `PascalCase_With_Underscores.md` | `V2_Agent_Creation.md` |
| Plugin docs | `kebab-case.md` | `google-sheets-plugin.md` |
| Deprecated docs | Move to `docs/archive/` | — |

**Required structure:** header block (`# Title`, `> **Last Updated**: YYYY-MM-DD`, `## Overview` paragraph); a Table of Contents for docs over ~150 lines; a `## Change History` table (`Date | Change | Details`) at the **end** of living docs.

**Formatting:** tables for structured data; `**File:** \`path\`` before code blocks; language tags on code fences; relative links `[Doc](/docs/DOC.md)`; status icons `✅` done, `⬜` todo, `🟢` easy, `🟡` medium, `🔴` hard; `---` between major sections.

---

## Common Gotchas

| Issue | Solution |
|-------|----------|
| Pagination off-by-one | `.range(0, 9)` returns 10 items — range is inclusive |
| Concurrent updates | Use RPC functions for safe updates (e.g. `update_agent_schedule_safe`) |
| Duplicate API calls / StrictMode double-mount | Use `lib/utils/request-deduplication.ts` |
| TypeScript errors ignored by `next.config.js` | **Fix them anyway** |
| Background job / cron that drains a table | Use the `durable-queue-drain` skill — naive select-then-process double-sends |

---

## Plugin System (V2)

JSON definition (`lib/plugins/definitions/{name}-plugin-v2.json`) + executor class (`lib/server/{name}-plugin-executor.ts`, extends `BasePluginExecutor`), loaded by `lib/server/plugin-manager-v2.ts` and mapped in `lib/server/plugin-executer-v2.ts`. Connections are stored in `plugin_connections`. Guide: [PLUGIN_GENERATION_WORKFLOW.md](/docs/PLUGIN_GENERATION_WORKFLOW.md).

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
npm run dev                  # Development server (filtered logs)
npm run dev:pretty           # Development with pino-pretty formatting
npm run build                # Production build
npm run lint                 # ESLint
npm test                     # Full Jest suite (ignores .claude/ worktrees)
npm test -- path/to/tests    # Subset
npm run test:plugins         # Plugin tests only
```

---

## Key Documentation

Each doc owns its own status. Read it when the "Read when" column matches your task.

| Document | Read when | Skill |
|----------|-----------|-------|
| [V6_DOCS_INDEX.md](/docs/v6/V6_DOCS_INDEX.md) | Any V6 pipeline work — gives the reading order | `v6-pipeline` |
| [V2_Thread-Based-Agent-Creation-Flow.md](/docs/V2_Thread-Based-Agent-Creation-Flow.md) | Changing the `/v2/agents/new` creation flow | `agent-creation-flow` |
| `docs/Calibration/CALIBRATION_OVERVIEW.md` | Changing calibration | `calibration` |
| [ADMIN_IDENTIFICATION_AND_ACCESS.md](/docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md) | Any `/api/admin/*` route, `/admin` page, or admin check — includes current coverage and what is not yet true | — |
| [BUSINESS_OS_LLM_CALL_ATTRIBUTION_LAYER1_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_LLM_CALL_ATTRIBUTION_LAYER1_REQUIREMENT.md) | Any Business OS AI call; operators: [model settings runbook](/docs/runbooks/BUSINESS_OS_LLM_MODEL_SETTINGS_RUNBOOK.md) | `bos-llm-call-standards` |
| [BUSINESS_OS_INSIGHTS_MODULE.md](/docs/architecture/BUSINESS_OS_INSIGHTS_MODULE.md) | `lib/business-os/insight/**`, insight routes and crons. ⚠️ Two unrelated systems are called "insights" | `business-os-insights` |
| [BUSINESS_OS_ENTITLEMENTS.md](/docs/architecture/BUSINESS_OS_ENTITLEMENTS.md) | `lib/business-os/entitlements/**` or what a plan includes | — |
| [BUSINESS_OS_EVENT_DRIVEN_MIGRATION_PLAN.md](/docs/architecture/BUSINESS_OS_EVENT_DRIVEN_MIGRATION_PLAN.md) §8.1 | Background jobs, crons, queue drains | `durable-queue-drain` |
| [BUSINESS_OS_TEST_PAGE_SCOPE.md](/docs/BUSINESS_OS_TEST_PAGE_SCOPE.md) / [V2_TEST_PAGE_SCOPE.md](/docs/V2_TEST_PAGE_SCOPE.md) | Test harnesses `/test-business-os`, `/test-plugins-v2` | — |
| [REPOSITORY_STRATEGY.md](/docs/REPOSITORY_STRATEGY.md) | Data-access design questions | `new-repository` |
| [feature_flags.md](/docs/feature_flags.md) | Adding or reading a flag | — |
| [AI_PROVIDER_MODELS.md](/docs/AI_PROVIDER_MODELS.md) | Model catalogue, limits, pricing | — |
| [EFFORT_ESTIMATOR.md](/docs/EFFORT_ESTIMATOR.md) | Effort Estimator feature | — |
