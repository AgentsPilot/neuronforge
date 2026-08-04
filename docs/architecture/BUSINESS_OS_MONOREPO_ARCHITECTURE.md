# Business OS — Monorepo Architecture & Migration Decision

> **Last Updated**: 2026-07-16

## Overview

We are building a second product — an **AI Business Operating System** for non-technical, first-time business owners — that deliberately shares *none* of neuronforge/AgentPilot's UI but reuses *all* of its engine: agent creation, agent management, plugin execution, and the V6 semantic pipeline. This document records the decision of **how the two products live together in one codebase**, why the alternatives were rejected, and — most importantly — **how we migrate to that structure without ever breaking the app that exists today**.

The decision: **one git repository, restructured as a pnpm workspace / Turborepo monorepo**, cut along the boundary of **kernel vs. experience** rather than app vs. app. The reusable asset is the headless kernel. The UI is not an asset to share — it is the thing that must stay apart.

This document is written for a mixed audience. Each major section opens with the plain-English *why* before the mechanics. Engineers should be able to execute the migration from Section 7; stakeholders should be able to follow the decision from Sections 2–4 and the open question in Section 6.

---

## Table of Contents

1. [The Decision in One Page](#1-the-decision-in-one-page)
2. [Why This Boundary: Kernel vs. Experience](#2-why-this-boundary-kernel-vs-experience)
3. [Alternatives Considered and Rejected](#3-alternatives-considered-and-rejected)
4. [Target Structure](#4-target-structure)
5. [What the Repository Actually Looks Like Today](#5-what-the-repository-actually-looks-like-today)
6. [Preventing Cross-Contamination](#6-preventing-cross-contamination)
7. [Preventing Infrastructure Blast-Radius](#7-preventing-infrastructure-blast-radius)
8. [DECISION: Shared Data Model](#8-decision-shared-data-model)
9. [The Migration Plan](#9-the-migration-plan)
10. [Hazard Register](#10-hazard-register)
11. [What Changes for a Developer Day-to-Day](#11-what-changes-for-a-developer-day-to-day)
12. [Open Questions and Known Unknowns](#12-open-questions-and-known-unknowns)
    - 12.1 [Q6 explained — the "triage sweep"](#121-q6-explained--the-triage-sweep-in-plain-terms)
    - 12.2 [Q8 in depth — auth gating under a shared user pool](#122-q8-in-depth--auth-gating-under-a-shared-user-pool)
13. [Business OS: Already Merged into `main` — Footprint, Classification & Coupling](#13-business-os-already-merged-into-main-code-footprint-classification--coupling)
14. [Business OS Data Model](#14-business-os-data-model) → companion: [BUSINESS_OS_DATA_MODEL.md](/docs/architecture/BUSINESS_OS_DATA_MODEL.md)
15. [Change History](#15-change-history)

---

## 1. The Decision in One Page

**In plain English:** We are not building a second company. We are building a second storefront on top of the same factory. The factory (agent generation, workflow execution, plugins, data access) is the thing we spent years on and want to use twice. The storefront (screens, words, design language) is the thing that must be completely different, because the two audiences are completely different — a power user configuring workflows vs. a first-time business owner who should never hear the word "workflow."

So we split the codebase along that line, and we keep both storefronts in one repository so that improving the factory improves both products in a single commit.

| Question | Answer |
|---|---|
| One repo or two? | **One repo**, restructured as a pnpm workspace / Turborepo monorepo |
| What is shared? | The **headless kernel only** — V6 pipeline, Pilot engine, repositories, plugins, AI provider factory |
| What is never shared? | **All UI.** Zero shared components, zero shared design tokens, zero shared Tailwind config |
| How is that enforced? | ESLint `no-restricted-imports` boundary + CI lint gate (build error, not review catch) |
| How are deploys isolated? | **Two Vercel projects**, one per app, each with its own root directory and env vars |
| How do we migrate? | **Phased and reversible.** The current app is deployable at the end of every phase. Never a big-bang cutover |
| Shared or isolated data? | ✅ **Shared** — one Supabase project, one `agents` / `agent_executions` model, `packages/repositories` as single writer. See [Section 8](#8-decision-shared-data-model) |
| Auth model? | ✅ **Shared user pool.** Business OS guards its own routes; a **server-side entitlement gate on Orchestrator** (Phase 4 prerequisite) keeps non-technical users out of the power-user app. See [§12.2](#122-q8-in-depth--auth-gating-under-a-shared-user-pool) |
| Where does Business OS stand? | ⚠️ **Already merged into `main`** (PR #10 + `06086dc`): ~421 files, 42 DB tables, live inside the single current app. Phase 4 is now an **extraction**, not a scaffold. See [§13](#13-business-os-already-merged-into-main-code-footprint-classification--coupling) + [data model](/docs/architecture/BUSINESS_OS_DATA_MODEL.md) |
| What is still open? | Execution + three merge-surfaced questions: Q9 (chat/ai-data-layer placement), Q10 (unwired i18n), Q11 (BOS consumes no kernel today — is the shared-kernel premise met?). No open *structural* decisions remain |

**Status of this decision:** ✅ Agreed (structure) · ✅ Agreed (shared data model, Section 8) · ⬜ Not started (migration execution)

---

## 2. Why This Boundary: Kernel vs. Experience

**In plain English:** The instinct when starting a second product is to ask "should this be a separate app?" That is the wrong question, because it splits along the *product* line. The valuable line is between the part that has no opinion about how it looks (the kernel) and the part that is nothing *but* an opinion about how it looks (the experience).

The kernel does not know whether the user is a developer in Orchestrator or a bakery owner in Business OS. It takes an intent and produces a running agent. That is exactly why it can be shared. The moment kernel code knows which app called it, it has stopped being a kernel.

| Layer | Nature | Shared? | Why |
|---|---|---|---|
| **Kernel** — V6 pipeline, Pilot engine, repositories, plugins, AI factory | Headless, no React, no design opinion | ✅ Yes | It is the same factory. An agent is an agent. |
| **Experience** — routes, components, design tokens, copy, onboarding | Entirely opinionated about audience | ❌ Never | The two products deliberately contradict each other. Orchestrator says "workflow"; Business OS says "Get Paid". |

**The rule that follows:** if a piece of code needs to know *which product* it is serving in order to behave correctly, it does not belong in a shared package. It belongs in the app.

**The corollary:** the two apps share zero UI components. Not "share a few primitives." Zero. Business OS gets its own design system from scratch. This is a feature, not duplication — the whole point is that a Business OS screen must never be able to inherit a Orchestrator affordance by accident.

---

## 3. Alternatives Considered and Rejected

**In plain English:** There were three plausible ways to do this. One is too loose, one is too tight, and one is right. Here is the reasoning, including what the rejected options genuinely got right — because if our circumstances change, these become live again.

### 3.1 Rejected — Separate git repository + HTTP API between them

The new app would live in its own repo and call neuronforge over HTTP.

| Aspect | Assessment |
|---|---|
| **Genuine advantage** | 🟢 **Maximum isolation.** Nothing in Business OS can physically reach Orchestrator's code. No cross-contamination is even conceivable. Independent release cadence, independent blast radius. |
| **Why rejected** | The new app will **co-evolve the kernel**, not merely consume it. Business OS needs website generation, a marketing engine, new agent types — all of which mean *changing* V6 and Pilot, not just calling them. |
| **The cost** | Two repos force one of two frictions: (a) publish `packages/kernel` as a private npm package and version it — meaning every kernel change becomes a publish-bump-install cycle across two repos; or (b) freeze an HTTP contract over internals that are still moving weekly. |
| **Verdict** | ❌ Rejected — the friction is priced for a *stable* kernel. Ours is not stable; it is the thing we are actively developing. |

**When this becomes right again:** if the Section 8 data decision goes toward **isolated data**, this calculus shifts materially back toward separate repos. If the two apps don't share a database, the "one kernel" argument weakens, and isolation gets cheaper.

### 3.2 Rejected — Same Next.js app, different route groups / folders

Business OS as `app/(business-os)/` inside the existing Next.js app.

| Aspect | Assessment |
|---|---|
| **Genuine advantage** | 🟢 Cheapest thing to do *today*. Zero migration. Start writing screens this afternoon. |
| **Why rejected** | **Cheapest today, most expensive later.** Shared build, shared env vars, shared deploy: a Business OS mistake takes Orchestrator down. |
| **The contamination problem** | Both design systems would live in one `components/` tree. We build heavily with Claude Code agents; an LLM asked to "add a card to the dashboard" will find and reuse the nearest matching component. With one tree, the nearest match is a Orchestrator component. This failure is silent and compounding. |
| **The exit problem** | Migrating out *later* — after two design systems have interleaved in one tree and two products depend on one build — is strictly harder than splitting once, now, while Business OS is still empty. |
| **Verdict** | ❌ Rejected — it optimises the first week and taxes every week after. |

### 3.3 Accepted — One repo, pnpm workspace / Turborepo

| Aspect | Assessment |
|---|---|
| **Isolation** | 🟡 Enforced by tooling (ESLint + separate Vercel projects) rather than by physics. Weaker than separate repos, but *sufficient* and *checkable in CI*. |
| **Co-evolution** | 🟢 A kernel change plus both apps' adaptations land in **one atomic commit**. No publishing, no version skew, no contract drift. |
| **Deploy blast radius** | 🟢 Two Vercel projects → an app-level incident stays in that app. |
| **Cost** | 🟡 A real, one-time migration (Section 9). This is the price, and it is paid once. |
| **Verdict** | ✅ **Accepted** |

---

## 4. Target Structure

```text
neuronforge/
├─ apps/
│  ├─ orchestrator/          ← today's neuronforge UI (current app/, components/)
│  │  ├─ app/
│  │  ├─ components/
│  │  ├─ CLAUDE.md              ← orchestrator-scoped agent instructions
│  │  ├─ next.config.js
│  │  ├─ tailwind.config.js
│  │  └─ vercel.json            ← crons live with the routes they call
│  └─ business-os/     ← the new app (own Next.js, own design system)
│     ├─ app/
│     ├─ components/            ← built from scratch, shares nothing
│     ├─ CLAUDE.md              ← business-os-scoped agent instructions
│     ├─ next.config.js
│     └─ tailwind.config.js
├─ packages/
│  ├─ kernel/          ← lib/agentkit/v6 + lib/pilot
│  ├─ repositories/    ← lib/repositories
│  ├─ plugins/         ← lib/plugins + lib/server executors
│  ├─ ai/              ← lib/ai provider factory
│  └─ core/            ← ⚠️ see §5.2 — logger, types, supabase clients, services
├─ CLAUDE.md           ← reduced to what is genuinely shared
├─ eslint.config.mjs   ← boundary rules live here
├─ package.json        ← workspace root
├─ pnpm-workspace.yaml
└─ turbo.json
```

> ⚠️ **The four-package split in the original sketch is incomplete.** Grounding it against the real repository surfaced a fifth package and several coupling problems. See [Section 5](#5-what-the-repository-actually-looks-like-today) — this is the most important section for anyone executing the migration.

---

## 5. What the Repository Actually Looks Like Today

**In plain English:** Before writing a migration plan we went and read the code. The good news: the split is viable, and the riskiest thing we feared (UI and engine tangled together) is mostly *not* true. The bad news: the tidy four-box diagram doesn't survive contact with the codebase. Here is what is actually there.

### 5.1 ✅ The good news — the UI/kernel boundary is already almost clean

We checked whether UI components reach into engine code. They do — 20 component files import from `lib/pilot`, `lib/repositories`, `lib/agentkit` — but **almost every one of those is `import type`**, which disappears at compile time and creates no runtime coupling.

**File:** `components/v2/agent/ExecutionDetailPanel.tsx`

```typescript
import type { Execution, ExecutionLogs } from '@/lib/repositories/types'
import type { ExecutionInsight } from '@/lib/pilot/insight/types'
```

This is exactly the shape we want: the UI depends on the kernel's *types*, not its *runtime*. The packages must publish types for app consumption, and the boundary holds.

Equally important, kernel code does **not** import from `components/`. The only violations found are two legacy V4 files:

| File | Violation | Assessment |
|---|---|---|
| `lib/agentkit/v4/core/step-plan-extractor.ts:21` | `import { PromptLoader } from '@/app/api/types/PromptLoader'` | 🟢 V4 is legacy, not part of the kernel scope (V6 only) |
| `lib/agentkit/v4/v5-generator.ts:21` | `import { PromptLoader } from '@/app/api/types/PromptLoader'` | 🟢 Same — leave in `apps/orchestrator` |

**Conclusion:** the kernel→UI direction is clean for V6/Pilot. This is the single biggest reason the split is affordable.

### 5.2 🔴 `lib/` is not headless, and the four packages are not enough

The proposed packages are `kernel`, `repositories`, `plugins`, `ai`. But `lib/` has ~50 top-level entries, and V6 imports from more of them than the plan accounts for.

Actual outbound dependencies of `lib/agentkit/v6/`:

| Imports from | In proposed packages? |
|---|---|
| `@/lib/pilot` | ✅ kernel |
| `@/lib/ai` | ✅ ai |
| `@/lib/plugins` | ✅ plugins |
| `@/lib/repositories` | ✅ repositories |
| `@/lib/server` | 🔴 **not mapped** |
| `@/lib/logger` | 🔴 **not mapped** |
| `@/lib/types` | 🔴 **not mapped** |
| `@/lib/agentkit` (non-v6 root) | 🔴 **not mapped** |

And `lib/pilot/StepExecutor.ts:37` imports `runAgentKit` at **runtime**, which in turn pulls in three more unmapped areas:

**File:** `lib/agentkit/runAgentKit.ts`

```typescript
import { PluginExecuterV2 } from '@/lib/server/plugin-executer-v2';
import { AuditTrailService } from '@/lib/services/AuditTrailService';
import { AUDIT_EVENTS } from '@/lib/audit/events';
import { MemoryInjector } from '@/lib/memory/MemoryInjector';
```

**Implication:** a fifth package (`packages/core`) is required, covering at minimum `lib/logger`, `lib/types`, `lib/services`, `lib/audit`, `lib/memory`, and the Supabase clients. **Do not attempt the extraction with only four packages — it will not compile.**

Separately, `lib/` contains outright UI code that must **not** travel into any package:

| Path | Contents | Destination |
|---|---|---|
| `lib/design-system-v2/` | `theme-provider.tsx`, tokens, gradients — `'use client'` | → `apps/orchestrator` |
| `lib/hooks/` | `useTheme.ts`, `useUIVersion.ts` — `'use client'` | → `apps/orchestrator` |
| `lib/client/agent-api.ts` | `'use client'` | → `apps/orchestrator` |
| `lib/ui/` | thinking-words dictionary/loader | → `apps/orchestrator` |
| `lib/supabaseClient.ts` | `'use client'` browser client | → `packages/core` (client entrypoint) or app |

### 5.3 🔴 `lib/plugins/pluginList.tsx` puts React inside a kernel package

**File:** `lib/plugins/pluginList.tsx`

```typescript
import {
  Mail, Github, Slack, FileText, MessageCircle, Calendar, ...
} from 'lucide-react';
```

`packages/plugins` — a supposedly headless package — would ship a `.tsx` file importing `lucide-react` icons. That is a direct cross-contamination vector: Business OS would inherit Orchestrator's icon choices through the *kernel*.

**Required fix during extraction:** `pluginList.tsx` is UI metadata (CLAUDE.md itself describes it as "UI metadata for plugin display"). It must move to `apps/orchestrator/`, or be split so that the headless registry data stays in `packages/plugins` and the icon mapping lives per-app.

### 5.4 🔴 Circular dependencies between the proposed packages

pnpm workspaces and TypeScript project references do not tolerate package cycles. We found two.

**Cycle A — `repositories` ↔ `pilot`:**

| Direction | Evidence | Severity |
|---|---|---|
| repositories → pilot | `lib/repositories/CalibrationSessionRepository.ts:13` — `import type { CollectedIssue, CalibrationSession } from '@/lib/pilot/types'` | 🟢 **type-only, single file** — breakable by moving the types |
| pilot → repositories | `lib/pilot/StepExecutor.ts:63` — `import { systemConfigRepository }`; `lib/pilot/insight/AutomationAdvisor.ts:21` — `WorkflowGroupRepository`; `lib/pilot/insight/BusinessInsightGenerator.ts:59` — `InsightRepository` | 🔴 **runtime** |

Because the repositories→pilot edge is a *single type-only import*, the cycle is cheap to break: relocate `CollectedIssue` / `CalibrationSession` into `packages/core` (or have `packages/repositories` own them) and the dependency becomes one-directional: `kernel → repositories → core`.

Also note five further `import type { Agent } from '@/lib/repositories/types'` edges from `lib/pilot/**` (`ConstrainedSemanticValidator`, `DryRunValidator`, `EnhancedSchemaValidator`, `BusinessInsightGenerator`, `AutomationAdvisor`). These are type-only and point in the *allowed* direction — no action needed.

**Cycle B — `pilot` ↔ `agentkit`:** `lib/pilot/StepExecutor.ts:37` imports `runAgentKit` from `@/lib/agentkit/runAgentKit`, and V6 imports Pilot. This is **not** a package cycle *provided* `packages/kernel` contains both `agentkit` and `pilot` — which the plan already does. But note `runAgentKit.ts` sits at `lib/agentkit/` root, alongside V4/V5 legacy (`analyzePrompt-v1-backup.ts`, `v5-generator.ts`, `twostage-agent-generator.ts`, `analyzePrompt-v3-direct copy.ts`). Moving "`lib/agentkit/v6` only" into the kernel will break `StepExecutor`. Decide explicitly: either pull `runAgentKit.ts` + `agentkitClient.ts` + `convertPlugins.ts` into the kernel, or leave all of `lib/agentkit` in the kernel and accept the legacy baggage.

### 5.5 🟡 Module resolution ambiguities that will bite during the move

| Ambiguity | Detail | Risk |
|---|---|---|
| `lib/logger.ts` **and** `lib/logger/` both exist | `logger/` contains `client.ts`, `config.ts`, `index.ts`. `@/lib/logger` resolves to the **file**, shadowing the directory | 🔴 Moving one without the other silently changes which module callers get |
| `lib/utils.ts` **and** `lib/utils/` both exist | `utils/` holds `featureFlags.ts` etc.; `utils.ts` is the `cn()` helper | 🔴 Same shadowing hazard; `cn()` is UI, `featureFlags` is shared |

**Mitigation:** resolve these *before* any move (Phase 1), as standalone commits with no other changes.

### 5.6 🔴 The `@/` alias maps to the repository root

**File:** `tsconfig.json`

```json
{
  "compilerOptions": {
    "paths": { "@/*": ["./*"] }
  }
}
```

Every `@/lib/...`, `@/components/...`, `@/app/...` import in the codebase resolves against the repo root. The moment files move into `apps/orchestrator/`, **every one of those imports is wrong** unless the alias is re-pointed. This is the single highest-volume hazard in the migration; Phase 2 is designed around it (see §9).

### 5.7 🔴 Lint is not currently a build gate

**File:** `next.config.js`

```javascript
const nextConfig = {
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
}
```

This is critical for the plan's central enforcement mechanism. **As configured today, an ESLint boundary rule would not fail anything** — `next build` ignores both lint and TypeScript errors. The boundary rule is only real if we also add a **CI lint job**. Do not rely on `next build` to catch a cross-app import.

Additionally there are **two ESLint configs**: `eslint.config.js` (eslintrc-style `module.exports`, but named as a flat config) and `eslint.config.mjs` (genuine flat config). This must be reconciled to one before adding boundary rules, or the rule may silently not load.

### 5.8 🟡 Test and CI reality differs from the documentation

| Claim in CLAUDE.md | Reality |
|---|---|
| `npm test` | 🔴 **No `test` script exists** in `package.json` |
| `npm run test:e2e` (Playwright) | 🔴 **No Playwright config file exists** anywhere in the repo, despite `@playwright/test` being a devDependency |
| Jest | ✅ Real. `jest.config.js` maps `'^@/(.*)$': '<rootDir>/$1'` — same root-alias hazard as tsconfig |
| CI | 🟡 Only `.github/workflows/plugin-tests.yml`, path-filtered on `lib/server/**`, `lib/plugins/**`, `tests/plugins/**` — **these paths all change in the migration** |

The V6 regression scenarios are real: `tests/v6-regression/run-regression.ts`, `scenarios/`, `scripts/`, `imported-agents.json`.

### 5.9 🟡 Root-level files that must be assigned to an owner

| File | Belongs to | Note |
|---|---|---|
| `middleware.ts` | `apps/orchestrator` | Root middleware; Business OS will need its own |
| `vercel.json` | `apps/orchestrator` | Contains crons hitting `/api/run-scheduled-agents`, `/api/auth/cleanup-incomplete`, `/api/cron/update-template-scores` |
| `tailwind.config.js`, `postcss.config.mjs` | `apps/orchestrator` | Business OS gets its own |
| `next.config.js` | `apps/orchestrator` | Business OS gets its own |
| `types/` (root) | `packages/core` or `apps/orchestrator` | 5 files, mostly `.d.ts` shims |
| `hooks/` (root) | `apps/orchestrator` | UI hooks |
| `__tests__/v6-integration.test.ts` | follow the kernel | |
| Loose root scripts (`check-*.mjs`, `verify-*.mjs`, `*.sql`, `monitor-*.sh`) | 🟡 unassigned | Recommend a `scripts/` sweep — out of scope, but they clutter the root and will confuse the workspace |

---

## 6. Preventing Cross-Contamination

**In plain English:** The stated concern is specific and correct: we build heavily with Claude Code agents, and an LLM asked to "add a card" will reuse the nearest component it can find. If Orchestrator's components are reachable, they will get reused, and Business OS's calm/premium/executive design language will erode one plausible-looking suggestion at a time. Nobody will notice until it's everywhere.

So we don't rely on discipline. We make the wrong thing **impossible to compile**.

Four layers, weakest to strongest:

### 6.1 Physical separation (structural)

Each app owns its own `components/`, its own design tokens, its own `tailwind.config.js`, its own `next.config.js`. There is no shared UI package — deliberately, no exceptions, not even for "obviously generic" primitives like Button. Shared code is headless kernel packages **only**.

Per §5.2 and §5.3, this means the extraction must actively *reject* UI: `lib/design-system-v2/`, `lib/hooks/`, `lib/ui/`, `lib/client/`, and `lib/plugins/pluginList.tsx` go to `apps/orchestrator`, not into packages.

### 6.2 Directory-scoped `CLAUDE.md` (advisory, high value)

Claude Code resolves `CLAUDE.md` nearest-first. An agent working in `apps/business-os/` picks up that app's context.

| File | Contents |
|---|---|
| `CLAUDE.md` (root) | **Reduced** to what is genuinely shared: mandatory rules (Zod, Pino, repository pattern, RLS), git conventions, kernel design principles, V6 work protocol |
| `apps/orchestrator/CLAUDE.md` | Orchestrator design system, V2 tokens, Radix primitives, existing UI patterns. **"Never import from `apps/business-os`."** |
| `apps/business-os/CLAUDE.md` | Business OS design language, vocabulary rules (capabilities not plugins), the 7 agents. **"Never import from `apps/orchestrator`. Never reuse Orchestrator components. This app's design system is built from scratch."** |

The root file today is ~600 lines and heavily Orchestrator-specific (V2 Dashboard, Radix, design tokens, feature flags). Splitting it is *itself* a contamination control: an agent that never reads Orchestrator's design section is far less likely to reproduce it.

### 6.3 Directory-scoped subagents (advisory — see caveat)

`.claude/agents/*` currently defines 7 agents with front-matter of `name`, `description`, `tools`.

**File:** `.claude/agents/developer.md`

```markdown
---
name: developer
description: |
  Implements features in the codebase following the project's code standards.
tools: Read, Write, Edit, Bash, Glob, WebSearch
---
```

> ✅ **Verified (2026-07-16):** Claude Code subagent front-matter supports `name`, `description`, `tools`, and `model` — **there is no field that restricts a subagent to a directory subtree.** Front-matter cannot sandbox an agent to `apps/business-os/`. Per-app agent variants (e.g. `business-os-developer`) whose *instructions* confine them to one app are worthwhile, but they are **advisory guidance, not a sandbox.**

**What CAN hard-enforce a write boundary (if we want runtime blocking on top of §6.4):**

| Mechanism | What it does | Limitation |
|---|---|---|
| `settings.json` permission **`deny`** globs (e.g. `Edit(apps/orchestrator/**)`, `Write(apps/orchestrator/**)`) | Blocks the tool call outright | Static / repo-wide — cannot express "*this* session is a business-os session," so it can't allow-orchestrator-here-deny-orchestrator-there |
| **PreToolUse hook** inspecting the `file_path` on Edit/Write/MultiEdit | Can block writes outside an active-app path *dynamically* (keyed off an env var or marker signalling the current app) | Requires writing + maintaining the hook; only as good as the "current app" signal |

**Conclusion for this doc:** the always-on, contamination-proof guarantee is **§6.4 (ESLint `no-restricted-imports` + CI)** — it rejects a cross-app import at merge regardless of which agent or human wrote it. Front-matter scoping is a dead end; a PreToolUse hook is an *optional* write-time reinforcement, not the primary control. Do not rely on agent instructions alone.

### 6.4 ESLint import boundary (enforcement — the one that actually works)

A cross-app import must be a **build error, not a review catch**. Reviewers miss things; CI does not.

**File:** `eslint.config.mjs`

```javascript
import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),

  // ---- Boundary: business-os may never reach into orchestrator ----
  {
    files: ["apps/business-os/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          {
            group: ["@orchestrator/*", "**/apps/orchestrator/*", "../../orchestrator/*", "@/components/v2/*"],
            message:
              "Business OS must not import from Orchestrator. The two apps share ZERO UI. " +
              "Shared code belongs in packages/* and must be headless (no React, no design tokens).",
          },
          {
            group: ["@neuronforge/kernel/**/*.tsx", "@neuronforge/plugins/**/*.tsx"],
            message:
              "Kernel packages must not expose React components. If you need this, the code is misplaced.",
          },
        ],
      }],
    },
  },

  // ---- Boundary: orchestrator may never reach into business-os ----
  {
    files: ["apps/orchestrator/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          {
            group: ["@business-os/*", "**/apps/business-os/*", "../../business-os/*"],
            message:
              "Orchestrator must not import from Business OS. Shared code belongs in packages/*.",
          },
        ],
      }],
    },
  },

  // ---- Boundary: packages stay headless ----
  {
    files: ["packages/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", {
        patterns: [
          {
            group: ["**/apps/*", "@orchestrator/*", "@business-os/*", "@/components/*", "@/app/*"],
            message:
              "Kernel packages must not depend on any app. Dependencies point one way: apps -> packages.",
          },
          {
            group: ["react", "react-dom", "lucide-react", "framer-motion", "@radix-ui/*"],
            message:
              "Kernel packages must be headless. No React, no icons, no animation. " +
              "See docs/architecture/BUSINESS_OS_MONOREPO_ARCHITECTURE.md §6.",
          },
        ],
      }],
    },
  },
];

export default eslintConfig;
```

> 🔴 **This rule is inert unless CI runs it.** Per §5.7, `next.config.js` sets `eslint.ignoreDuringBuilds: true` and `typescript.ignoreBuildErrors: true`, so `next build` will happily build code that violates every rule above. **A CI job running `pnpm lint` on every PR is a mandatory part of this decision, not an optional extra.** Also reconcile the duplicate `eslint.config.js` / `eslint.config.mjs` (§5.7) first, or the rules may not load at all.
>
> Note the `react` restriction in the `packages/**` block will fire immediately on `lib/plugins/pluginList.tsx` (§5.3). That is the rule working as intended — fix the file, don't weaken the rule.

---

## 7. Preventing Infrastructure Blast-Radius

**In plain English:** Sharing a repository must not mean sharing a fate. If Business OS gets a traffic spike or a bad deploy at 2am, Orchestrator customers should never know. The repo is a development-time convenience; at runtime the two products should be strangers.

### 7.1 Separate Vercel projects

Two Vercel projects pointed at the same repository, each with a different **Root Directory**.

| Setting | `neuronforge-orchestrator` | `neuronforge-business-os` |
|---|---|---|
| Root Directory | `apps/orchestrator` | `apps/business-os` |
| Env vars | Orchestrator's own set | Business OS's own set |
| Domain | current production domain | new domain |
| Crons | `vercel.json` (3 crons, §5.9) | none initially |
| Scaling / incidents | isolated | isolated |

**What this buys, in plain terms:** separate env vars (a Business OS key can't leak into Orchestrator's runtime), separate scaling, separate incidents, separate rollbacks.

**Requires:** `pnpm` as the install command with workspace-root resolution, and `transpilePackages` in each app's `next.config.js` listing the workspace packages it consumes.

### 7.2 Turborepo affected-graph

| Change | Rebuilds |
|---|---|
| `apps/orchestrator/**` | Orchestrator only ✅ |
| `apps/business-os/**` | Business OS only ✅ |
| `packages/kernel/**` | **Both** ✅ correct — it *is* shared |

The last row is not a flaw. It is the honest, visible cost of sharing, and it is the point: a kernel change *should* prove itself against both consumers before merging.

### 7.3 Treat `packages/kernel` as a contract

`packages/kernel` is the **only** place where one change can break two products. That asymmetry dictates where the rigour goes:

| Practice | Rule |
|---|---|
| Test coverage | 🔴 Highest bar in the repo. Both apps' critical paths must be represented |
| Review | Mandatory SA review on every kernel change — no exceptions for "small" |
| V6 regression suite | Must run on every `packages/kernel` change (`tests/v6-regression/`) |
| Breaking changes | Must land with both apps' adaptations in the **same commit** — this is the whole reason we chose one repo |
| Public surface | Explicit exports. No deep imports into package internals from apps |

**Existing asset to preserve:** the V6 Work Protocol (V6_DESIGN_PRINCIPLES.md, V6_OPEN_ITEMS.md, WEAK_POINTS.md) already encodes hard-won kernel discipline. Those docs remain authoritative and should be referenced from the root `CLAUDE.md`, which is now essentially *the kernel's* CLAUDE.md.

---

## 8. DECISION: Shared Data Model

> ✅ **Decided 2026-07-16 — Option A (shared).** One Supabase project, one `agents` / `agent_executions` model, `packages/repositories` as the single writer. The trade-off analysis below is retained as the rationale of record.

**In plain English, the question was:** if a business owner creates an agent in Business OS, and that same person later opens Orchestrator — should they see the same agent? **Answer: yes.** A customer is one customer; their agents are their agents regardless of which door they walked in.

| | **Option A — Shared data (recommended)** | **Option B — Isolated data** |
|---|---|---|
| Supabase | One project, one `agents` / `agent_executions` model | Separate project or separate schema |
| An agent created in Business OS | Is the same entity, visible in Orchestrator | Is a different entity, invisible to Orchestrator |
| Writers | `packages/repositories` is the **single writer**, plus an app/source discriminator column | Two data layers, diverging over time |
| Migrations | One set | Two sets, or duplicated |
| Blast radius of a schema change | Both products | One product |
| Effect on this decision | ✅ Reinforces one repo — it is what makes it genuinely *one kernel* | ⚠️ **Weakens it.** If nothing is shared at the data layer, separate repos (§3.1) becomes attractive again |

**For a non-technical stakeholder, the trade-off is:**

> **Option A** is "one business, two front doors." A customer is one customer; their agents are their agents regardless of which door they walked in. Cheaper to build, and it means every improvement to the engine improves both products at once. The cost: the two products are permanently entangled at the data layer — a change to how agents are stored affects both, so those changes get slower and more careful.
>
> **Option B** is "two businesses that happen to share a supplier." Total freedom to move fast in Business OS without any risk to Orchestrator customers. The cost: we pay for the engine twice — two data layers, two sets of migrations — and the products will drift apart. And if we choose this, we should seriously reconsider whether one repository is the right container at all.

**Decision — Option A (shared), agreed 2026-07-16.** The premise of this whole architecture is that we have *one kernel* serving two experiences. An agent is an agent. If Business OS agents were a different species living in a different database, then the kernel isn't really shared — only the source code is — and we'd have taken on the coupling costs of a monorepo while getting only the code-reuse benefit. Choosing shared data is what makes this genuinely *one kernel, two front doors*.

**These now follow from the decision:**

| Requirement | Detail |
|---|---|
| Single writer | All writes via `packages/repositories`. No direct Supabase calls from either app (this is already a mandatory rule) |
| Discriminator column | Add e.g. `source_app` / `created_via` to `agents` so each app can filter its own view and we can measure adoption |
| RLS unchanged | `.eq('user_id', userId)` scoping is unaffected and remains mandatory in both apps |
| Orchestrator must tolerate Business OS rows | 🔴 Orchestrator queries must not assume every agent was created by Orchestrator. **Verify this before Business OS writes its first agent** |

**Open sub-question (not yet investigated):** whether `agents` currently carries any Orchestrator-specific required columns that a Business OS agent couldn't populate. This needs a schema review before Phase 4.

---

## 9. The Migration Plan

**In plain English, the requirement is:** *"how do we migrate and have the current app functional, seamless, with no breaking points."*

So the plan is built on one rule, and everything else is subordinate to it:

> **The current app is fully functional and deployable at the end of every phase.** There is no phase whose output is a half-migrated repository. If we stopped after any phase and never continued, we would be in a coherent, shippable state.

Two design choices follow:

1. **Move the app before extracting packages.** The instinct is to pull out the kernel first — it's the "interesting" part. That is backwards. Moving `apps/orchestrator` first is a *pure relocation*: no code is restructured, only its location changes. It proves the workspace, the alias resolution, the Vercel project, and the build — all against the app we already know works. If something breaks, we know it was the move, not a redesign. Only once that boundary holds do we start the genuinely risky work of cutting up `lib/`.
2. **Separate `business-os` last.** ~~An empty app cannot validate a boundary.~~ *(Amended — Business OS is no longer empty; it is already merged into `main`.)* The BOS code travels through Phases 2–3 as part of the single current app, and Phase 4 **carves it out** into its own app only once the shared packages exist for it to depend on. The coupling analysis (§13.3) confirms this is safe: the BOS↔kernel dependency edges are clean, so the separation is a bounded `git mv` plus a three-file hand-split, not a rewrite.

### Phase overview

| Phase | Goal | Effort | Risk | App stays live? |
|---|---|---|---|---|
| 0 | Pre-flight cleanup (resolve ambiguities) | 🟢 Low | 🟢 Low | ✅ Yes |
| 1 | Establish workspace, no files moved | 🟢 Low | 🟢 Low | ✅ Yes |
| 2 | Move everything to `apps/orchestrator` (incl. the already-merged BOS code) | 🟡 Medium | 🔴 **High** | ✅ Yes (gate) |
| 3 | Extract `packages/*` incrementally (incl. the 18 BOS repos) | 🔴 High | 🟡 Medium | ✅ Yes (per package) |
| 4 | **Extract** the already-merged Business OS into `apps/business-os` | 🟡 Medium | 🟡 Medium | ✅ Yes |
| 5 | Harden boundary in CI | 🟢 Low | 🟢 Low | ✅ Yes |

> **Amended for reality:** Business OS is already merged into `main` (PR #10 + `06086dc`; see [§13](#13-business-os-already-merged-into-main-code-footprint-classification--coupling)). Phase 4 is therefore an **extraction** of live code, not a green-field scaffold — its risk rises from 🟢 to 🟡, and Phase 2/3 now knowingly carry BOS code through as part of "the current app."

---

### Phase 0 — Pre-flight cleanup 🟢

**Why first:** these are landmines that would otherwise detonate *during* a move, when we'd be unable to tell whether the breakage came from the cleanup or the migration. Fix them while the repo is still flat and every change is trivially verifiable.

| # | Task | Reference |
|---|---|---|
| 0.1 | Resolve `lib/logger.ts` vs `lib/logger/` shadowing — pick one, update callers | §5.5 |
| 0.2 | Resolve `lib/utils.ts` vs `lib/utils/` shadowing | §5.5 |
| 0.3 | Reconcile `eslint.config.js` + `eslint.config.mjs` → one flat config | §5.7 |
| 0.4 | Add a `lint` script and a CI job that runs it (currently no lint gate exists) | §5.7 |
| 0.5 | Add a `test` script (`jest`) — CLAUDE.md documents `npm test` but it doesn't exist | §5.8 |
| 0.6 | ✅ **Done 2026-07-16** — Playwright confirmed orphaned and removed (spec deleted, dep uninstalled). Remaining sub-task: strip the stale `npm run test:e2e` / Playwright references from CLAUDE.md | §5.8, §12 Q5 |
| 0.8 | Triage the loose root scripts + tracked dumping-ground dirs before Phase 2 (delete / move to root `scripts/` / archive) | §12.1 Q6 |
| 0.7 | Document the current Vercel env var inventory — you cannot split what you haven't listed | §9 Phase 2 |

**Verification gate:** `pnpm build` succeeds · `pnpm lint` succeeds · `pnpm test` succeeds · app boots locally · agent creation + execution work.
**Rollback:** each item is an independent revertible commit.

---

### Phase 1 — Establish the workspace (no files moved) 🟢

**Why:** prove the tooling works before trusting it with the codebase.

| # | Task |
|---|---|
| 1.1 | Add `pnpm-workspace.yaml` with `apps/*`, `packages/*` |
| 1.2 | Add `turbo.json` with `build`, `lint`, `test`, `dev` pipelines |
| 1.3 | Convert root `package.json` to a workspace root; migrate `package-lock.json` → `pnpm-lock.yaml` |
| 1.4 | Create empty `apps/` and `packages/` directories |

**File:** `pnpm-workspace.yaml`

```yaml
packages:
  - "apps/*"
  - "packages/*"
```

> 🟡 **The npm → pnpm switch is its own risk**, independent of the monorepo. pnpm's strict, non-flat `node_modules` surfaces phantom dependencies that npm's hoisting hides. With this dependency list (`canvas`, `pdfjs-dist`, `pdf-parse`, `googleapis`, `officeparser`) expect at least one package to need `node-linker=hoisted` or an explicit `public-hoist-pattern`. **Do this phase on its own and let it settle.** Do not combine it with Phase 2.

**Verification gate:** app still builds and boots with pnpm, from the repo root, unchanged. Vercel preview deploy succeeds.
**Rollback:** delete workspace files, restore `package-lock.json`. One commit.

---

### Phase 2 — Move everything into `apps/orchestrator` 🔴 **the risky one**

**Why this shape:** this is a *relocation*, not a refactor. Not one line of application logic changes. Every failure in this phase is a path/config failure, which makes them fast to diagnose. And at the end we have proven the hardest claim in the whole plan — *the existing app survives the move unchanged*.

> **Note — Business OS rides along here, intentionally.** `app/`, `components/`, and `lib/` now contain the already-merged BOS trees (§13). Because today `main` is a *single* Next app serving both the orchestrator and BOS surfaces, moving the whole root into `apps/orchestrator` keeps that combined app intact and working — which is exactly the pure-relocation property we want. The BOS code is separated out later, in Phase 4. Do **not** try to split it here; that would turn the safe relocation into a risky two-app split.

| # | Task | Hazard addressed |
|---|---|---|
| 2.1 | `git mv` `app/`, `components/`, `hooks/`, `lib/`, `types/`, `middleware.ts`, `public/` → `apps/orchestrator/` | history preservation |
| 2.2 | `git mv` `next.config.js`, `tailwind.config.js`, `postcss.config.mjs`, `vercel.json` → `apps/orchestrator/` | §5.9 |
| 2.3 | Create `apps/orchestrator/tsconfig.json` extending a root base, with `"@/*": ["./*"]` **relative to `apps/orchestrator`** | §5.6 — **the critical step** |
| 2.4 | Create `apps/orchestrator/package.json` with the app's deps and scripts | |
| 2.5 | Move `jest.config.js` → `apps/orchestrator/`; its `moduleNameMapper` `'^@/(.*)$': '<rootDir>/$1'` now resolves correctly because `rootDir` is the app | §5.8 |
| 2.6 | Move `tests/`, `__tests__/`, `scripts/`, `simulators/` → `apps/orchestrator/` (they follow `lib/` for now; they'll follow the kernel in Phase 3) | §5.8 |
| 2.7 | Update `.github/workflows/plugin-tests.yml` path filters: `lib/server/**` → `apps/orchestrator/lib/server/**` | §5.8 |
| 2.8 | Create the Vercel Orchestrator project with Root Directory `apps/orchestrator`; copy **all** env vars | §7.1 |
| 2.9 | Leave `NEXT_PUBLIC_*` feature flags **untouched** — same names, same values, now scoped to the Orchestrator Vercel project | §9 note below |

**The `@/` alias — how imports resolve during and after the move.** This is the crux of the phase, and the answer is reassuring:

Because `@/*` currently maps to `./*` (repo root, §5.6), and because in Phase 2 we move **the entire root contents as one unit** into `apps/orchestrator/`, the *relative relationship between every file and every other file is unchanged*. Re-point the alias in the new `apps/orchestrator/tsconfig.json` and **every existing `@/lib/...` and `@/components/...` import keeps working with zero edits**:

**File:** `apps/orchestrator/tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "paths": {
      "@/*": ["./*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

This is precisely why Phase 2 comes before Phase 3. Move everything as one block → the alias is a one-line fix. Extract packages first → thousands of imports break at once with no working state to compare against.

> ⚠️ **`next.config.js` currently sets `typescript.ignoreBuildErrors: true` and `eslint.ignoreDuringBuilds: true` (§5.7).** This means **`pnpm build` passing is NOT sufficient evidence that this phase succeeded** — a broken alias would sail straight through the build and fail at runtime. The verification gate below therefore requires an explicit `tsc --noEmit` run *and* a manual smoke test. Do not skip either. Consider a temporary `ignoreBuildErrors: false` during this phase to make the build honest.

> ⚠️ **`git mv` preserves history**, but Git detects renames heuristically at *view* time. Use `git log --follow <file>` to trace history through the move, and configure `git config diff.renames true`. Keep Phase 2 as **pure moves with no content edits in the same commit** — mixing a rename with an edit is what actually defeats rename detection. Two commits: one pure `git mv`, one for config edits.

**Verification gate (all must pass):**

| ⬜ | Check |
|---|---|
| ⬜ | `pnpm build` succeeds from `apps/orchestrator` |
| ⬜ | `npx tsc --noEmit` produces **no new errors** vs. the pre-move baseline (capture the baseline in Phase 0) |
| ⬜ | `pnpm test` — all Jest suites pass, including `lib/pilot/__tests__` and `lib/agentkit/v6/__tests__` |
| ⬜ | V6 regression suite passes (`tests/v6-regression/run-regression.ts`) |
| ⬜ | App boots locally; `/v2` dashboard renders |
| ⬜ | **Critical flow:** create an agent end-to-end (V6 pipeline → review → save) |
| ⬜ | **Critical flow:** execute an agent (Pilot engine → plugin call → result) |
| ⬜ | **Critical flow:** connect a plugin (OAuth round-trip) |
| ⬜ | **Critical flow (BOS rides along):** a Business OS surface still renders — `/business-os` loads and a booking or website-builder page works (it is part of the app now, §13) |
| ⬜ | Vercel preview deploy green; crons still registered from `apps/orchestrator/vercel.json` (incl. the new BOS crons — calendar-sync, payment-reminders, payment-retry) |
| ⬜ | Env vars confirmed present in the new Vercel project (compare against the Phase 0 inventory) |

**Rollback:** the entire phase is `git revert` of two commits, plus re-pointing the Vercel project's Root Directory back to `/`. Keep the old Vercel project configuration until the gate is green and production has run for at least one full cron cycle (5 minutes for `run-scheduled-agents`).

---

### Phase 3 — Extract `packages/*` incrementally 🔴

**Why now and not earlier:** Phase 2 proved the app survives relocation. Now — and only now — do we do the genuinely structural work. And we do it **one package at a time**, each with its own gate, because unlike Phase 2 these moves *do* change how code resolves.

**Extraction order — dictated by the dependency graph (§5.2, §5.4), leaves first:**

| Order | Package | From | Depends on | Effort | Risk |
|---|---|---|---|---|---|
| 3.1 | `packages/core` | `lib/logger`, `lib/types`, `lib/services`, `lib/audit`, `lib/memory`, supabase clients, `lib/utils/featureFlags` | nothing | 🟡 Med | 🟡 Med |
| 3.2 | `packages/ai` | `lib/ai` | core | 🟢 Low | 🟢 Low |
| 3.3 | `packages/repositories` | `lib/repositories` | core | 🟡 Med | 🟡 Med |
| 3.4 | `packages/plugins` | `lib/plugins` (**minus `pluginList.tsx`**) + `lib/server` | core, repositories | 🔴 High | 🟡 Med |
| 3.5 | `packages/kernel` | `lib/agentkit` (V6 + `runAgentKit`) + `lib/pilot` | all of the above | 🔴 High | 🔴 High |

**Blocking prerequisites — do these before 3.3:**

| # | Task | Why |
|---|---|---|
| 3.0a | Break the `repositories ↔ pilot` cycle: move `CollectedIssue` / `CalibrationSession` out of `lib/pilot/types` (used by `CalibrationSessionRepository.ts:13`) | §5.4 — package cycles don't resolve |
| 3.0b | Move `lib/plugins/pluginList.tsx` → `apps/orchestrator` (or split headless registry from icon map) | §5.3 — React in a kernel package |
| 3.0c | Decide the `lib/agentkit` scope: V6-only + `runAgentKit`/`agentkitClient`/`convertPlugins`, or all of `agentkit` incl. V4/V5 legacy | §5.4 — `StepExecutor.ts:37` breaks otherwise |
| 3.0d | Keep `lib/design-system-v2`, `lib/hooks`, `lib/ui`, `lib/client` in `apps/orchestrator` — they are **not** kernel | §5.2 |
| 3.0e | Note: V4 legacy imports `@/app/api/types/PromptLoader` — leave V4 in `apps/orchestrator`, do not drag it into the kernel | §5.1 |

**The mechanism that keeps the app alive during extraction.** For each package, in one commit:

1. `git mv` the directory into `packages/<name>/src/`
2. Give the package a `package.json` (`@neuronforge/<name>`) and `tsconfig.json`
3. Add it as a workspace dependency of `apps/orchestrator`
4. **Add a path alias in `apps/orchestrator/tsconfig.json` mapping the old `@/lib/<name>/*` specifier to the new package.** No call sites change:

**File:** `apps/orchestrator/tsconfig.json` (during extraction)

```json
{
  "compilerOptions": {
    "paths": {
      "@/lib/ai/*": ["../../packages/ai/src/*"],
      "@/lib/ai": ["../../packages/ai/src/index.ts"],
      "@/*": ["./*"]
    }
  }
}
```

This is a **compatibility shim** and it is what makes the phase reversible: the app keeps compiling with its existing imports while the files live somewhere new. Add `transpilePackages: ['@neuronforge/ai', ...]` to `apps/orchestrator/next.config.js`, and mirror each alias into `jest.config.js`'s `moduleNameMapper` (§5.8) or tests break with the app still fine — a confusing state.

Rewrite call sites from `@/lib/ai` to `@neuronforge/ai` as a **separate, later, purely mechanical commit** — never in the same commit as the move.

**Verification gate (per package):** identical to Phase 2's gate — build, `tsc --noEmit` vs. baseline, full Jest, V6 regression, three critical flows, preview deploy.
**Rollback:** per-package `git revert`. Because each package is one commit plus one alias block, reverting is clean. **Never extract two packages in one commit.**

---

### Phase 4 — Extract the already-merged Business OS into `apps/business-os` 🟡

> **⚠️ This phase was rewritten once Business OS code was found already merged into `main` (PR #10 + `06086dc`). See [§13](#13-business-os-already-merged-into-main-code-footprint-classification--coupling) for the full footprint, classification, and coupling evidence that shapes the tasks below.** Business OS is **not** an empty scaffold anymore — its routes, components, backend, repositories, and 42 DB tables are live in `main` and (after Phase 2) sitting inside `apps/orchestrator`. This phase **carves them out** into their own app.

**Why last, still:** the boundary (Phase 3 packages) and the kernel must exist first. The BOS code rode into `apps/orchestrator` in Phase 2 as part of "the current app" — correct, because today it genuinely *is* one Next app. Now we separate it. The coupling analysis (§13.3) proved the edges are clean: **zero kernel↔BOS imports**, BOS repositories are headless (extracted in Phase 3), and BOS UI imports no orchestrator UI. The entanglement is narrow and known — **three shared shell files + the orchestrator sidebar** — so this is a bounded relocation, not a rewrite.

**4a — Relocate the BOS trees** (`git mv` from `apps/orchestrator/**` → `apps/business-os/**`; see §13.2 for the authoritative path list):

| # | Task |
|---|---|
| 4.1 | ✅ **Section 8 data decision resolved (shared).** Precondition met |
| 4.2 | Scaffold `apps/business-os` shell — own `next.config.js`, own `tailwind.config.js`, own tokens, own `package.json`, `apps/business-os/CLAUDE.md` (§6.2) |
| 4.3 | `git mv` the BOS route trees → `apps/business-os/app/`: `business-os/`, `site/`, `book/`, `onboarding-v2/`, and the BOS API routes (`api/{business-os,website,scheduling,payments,crm,email,intake,book,insights,capabilities}`, `api/cron/{calendar-sync,payment-reminders,payment-retry}`) |
| 4.4 | `git mv` BOS UI → `apps/business-os/components/`: `business-os/`, `website/`, `crm/`, `payments/`, `scheduling/`, `email-automation/`, `onboarding/` |
| 4.5 | `git mv` BOS logic + assets → `apps/business-os/`: `lib/business-os/`, `lib/website-builder/`, `lib/payments/`, `lib/email/templates/`, `lib/i18n/`, the BOS `lib/services/*` batch, `messages/*`, `public/mockups/*`, `i18n.ts` |
| 4.6 | Depend on `@neuronforge/kernel` + `@neuronforge/repositories` (which now hold the BOS repos, extracted in Phase 3) — **never** on `apps/orchestrator` |

**4b — Hand-split the three contended shell files** (§13.3E — these must be *edited*, not moved, because they encode both apps' concerns):

| # | Task |
|---|---|
| 4.7 | 🔴 **`middleware.ts`** — split: the subdomain→`/site/[subdomain]` rewrite + `onboarding-v2` gate (reads `business_profiles.onboarding_completed`) go to `apps/business-os/middleware.ts`; the orchestrator keeps only its own routing. |
| 4.8 | 🔴 **`app/(protected)/layout.tsx`** — remove the hardcoded `/business-os` sidebar link (`:566`) and the three BOS pages currently mounted in the orchestrator's `(protected)` group (`scheduling/`, `payments/`, `email-automation/` — relocate these to `apps/business-os` in 4.3). **Sequence the shell edit and the page relocation in one change** or the orchestrator sidebar 404s (§13.4). |
| 4.9 | 🔴 **`package.json`** — apportion deps per app: `@radix-ui/react-{dialog,tabs}`, `react-phone-number-input`, `stripe`, `next-intl` (see 4.13) → `apps/business-os`; keep kernel/orchestrator deps in their homes. Split `vercel.json` cron entries to the owning app. |

**4c — Auth, isolation, and the two open decisions:**

| # | Task |
|---|---|
| 4.10 | 🔴 **Add the server-side Orchestrator entitlement gate BEFORE Business OS opens to real users (§12.2).** Orchestrator must stop admitting on "logged-in + onboarded" alone. Business OS protects its own routes from day one (§12.2). |
| 4.11 | Create the second Vercel project, Root Directory `apps/business-os`, its own env var set; give BOS its own feature-flag namespace (e.g. `NEXT_PUBLIC_BOS_*`) — do **not** reuse Orchestrator's `NEXT_PUBLIC_USE_V6_*` flags |
| 4.12 | Add the `source_app`/`created_via` discriminator (feeds the entitlement gate) and **verify Orchestrator tolerates Business OS rows** (§8); run the pre-Phase-4 `agents` schema review (§12 Q2) |
| 4.13 | ⚠️ **Resolve Q10 (i18n) and Q9 (chat/ai-data-layer placement) first — see §12.** `i18n.ts` + `next-intl` appear **unwired** today (dep not declared, `next.config.js` not configured); confirm whether i18n is live before assigning it. Decide whether `lib/business-os/{chat,ai-data-layer}` is BOS app logic (default) or a promotable second kernel |
| 4.14 | *(Optional finer call, §12.2)* decide whether to share the session cookie across domains (SSO) or keep sessions per-app |

**Verification gate:** Business OS boots and deploys from `apps/business-os` · **Orchestrator unaffected** (re-run its full Phase-2 gate — no BOS sidebar 404s, no dangling imports) · a cross-app import fails `pnpm lint` · a BOS booking/payment flow works end-to-end via the shared repositories · an agent created in Business OS executes via the shared kernel · **a Business-OS-only user is denied access to Orchestrator routes (entitlement gate, 4.10)**.
**Rollback:** because 4a is pure `git mv` and 4b is three isolated file edits, revert is a bounded set of commits. Keep BOS reachable via `apps/orchestrator` (its Phase-2 home) until the new Vercel project's gate is green. *(The entitlement gate in 4.10 stays — it hardens Orchestrator regardless.)*

---

### Phase 5 — Harden the boundary 🟢

| # | Task |
|---|---|
| 5.1 | Land the full `no-restricted-imports` config (§6.4) |
| 5.2 | Make `pnpm lint` a **required** PR status check |
| 5.3 | Reduce root `CLAUDE.md` to shared concerns; move Orchestrator-specific content to `apps/orchestrator/CLAUDE.md` |
| 5.4 | Require the V6 regression suite on any `packages/kernel` diff |
| 5.5 | Revisit `typescript.ignoreBuildErrors: true` — with a clean workspace this is now feasible to turn off, and it should be |

**Verification gate:** a deliberately-added cross-app import fails CI. Test the guard rather than assuming it.

---

## 10. Hazard Register

Every hazard below was verified against the actual repository.

| # | Hazard | Evidence | Neutralised by | Sev |
|---|---|---|---|---|
| H1 | `@/` alias maps to repo root; used pervasively | `tsconfig.json` `"@/*": ["./*"]` | Move root contents as one block (Phase 2), re-point alias once; compat shims during Phase 3 | 🔴 |
| H2 | Build ignores TS **and** lint errors — a broken migration builds green | `next.config.js` §5.7 | Explicit `tsc --noEmit` in every gate; CI lint job; revisit flags in 5.5 | 🔴 |
| H3 | Package cycle `repositories ↔ pilot` | `CalibrationSessionRepository.ts:13` ↔ `StepExecutor.ts:63` | Task 3.0a — relocate the type-only edge | 🔴 |
| H4 | Proposed 4 packages don't compile — missing `lib/server`, `lib/logger`, `lib/types`, `lib/services`, `lib/audit`, `lib/memory` | §5.2 | Add `packages/core`; extract in dependency order | 🔴 |
| H5 | React inside `packages/plugins` | `lib/plugins/pluginList.tsx` imports `lucide-react` | Task 3.0b; ESLint bans React in `packages/**` | 🔴 |
| H6 | `lib/logger.ts` shadows `lib/logger/`; same for `utils` | §5.5 | Phase 0.1 / 0.2 — fix while flat | 🔴 |
| H7 | `pilot → runAgentKit` runtime import breaks if only `agentkit/v6` moves | `StepExecutor.ts:37` | Task 3.0c — explicit scope decision | 🟡 |
| H8 | CI path filters point at pre-migration paths | `plugin-tests.yml` filters `lib/server/**`, `lib/plugins/**` | Task 2.7, and again per Phase 3 extraction | 🟡 |
| H9 | Jest `moduleNameMapper` mirrors the `@/` alias — drifts silently | `jest.config.js` §5.8 | Move with the app (2.5); mirror every Phase 3 alias | 🟡 |
| H10 | Env vars must be split across two Vercel projects | §7.1 | Phase 0.7 inventory → 2.8 copy → 4.5 subset. Never share a key by default | 🟡 |
| H11 | `NEXT_PUBLIC_*` flags are build-time inlined | `lib/utils/featureFlags.ts` | Two Vercel projects isolate values naturally; Business OS gets its own namespace (4.6) | 🟢 |
| H12 | `vercel.json` crons hit `/api/*` routes | §5.9 | Moves to `apps/orchestrator/vercel.json` (2.2); verify a cron fires post-cutover | 🟡 |
| H13 | V6 regression scenarios have path assumptions | `tests/v6-regression/run-regression.ts` | Moves with `apps/orchestrator` (2.6), follows the kernel in 3.5; part of every gate | 🟡 |
| H14 | git history lost across moves | — | Pure `git mv` commits, no content edits mixed in; `--follow`; `diff.renames true` | 🟡 |
| H15 | npm → pnpm surfaces phantom deps (`canvas`, `pdfjs-dist`, `pdf-parse`) | `package.json` | Phase 1 in isolation; `node-linker=hoisted` if needed | 🟡 |
| H16 | Two ESLint configs; boundary rule may not load | `eslint.config.js` + `eslint.config.mjs` | Phase 0.3 reconcile; Phase 5.5 test the guard | 🟡 |
| H17 | Documented test commands don't exist (`npm test`, `test:e2e`; no Playwright config) | §5.8 | Phase 0.5 / 0.6 — the gates depend on these being real | 🟡 |
| H18 | Two value-form imports of kernel types from client components | `HardcodeRepairModal.tsx:9`, `AgentSetupWizard.tsx:9` | Convert to `import type` — cheap, removes a bundling risk | 🟢 |

---

## 11. What Changes for a Developer Day-to-Day

**In plain English:** less than you'd fear. The main new question you ask yourself is *"which of the three buckets does this code go in?"* — and there's a simple test for it.

### 11.1 Commands

| Task | Before | After |
|---|---|---|
| Install | `npm install` | `pnpm install` (from root) |
| Run Orchestrator | `npm run dev` | `pnpm dev --filter orchestrator` |
| Run Business OS | — | `pnpm dev --filter business-os` |
| Run both | — | `pnpm dev` |
| Build everything affected | `npm run build` | `pnpm build` (Turbo picks the affected graph) |
| Test | (no script — see H17) | `pnpm test` / `pnpm test --filter @neuronforge/kernel` |
| Lint | `npm run lint` | `pnpm lint` — **now a required PR check** |

### 11.2 Where things live

| Code | Location |
|---|---|
| A Orchestrator screen | `apps/orchestrator/app/`, `apps/orchestrator/components/` |
| A Business OS screen | `apps/business-os/app/`, `apps/business-os/components/` |
| A new plugin executor | `packages/plugins/src/` (+ definition JSON) |
| A new repository | `packages/repositories/src/` |
| V6 pipeline work | `packages/kernel/src/agentkit/v6/` |
| Pilot engine work | `packages/kernel/src/pilot/` |
| A new AI provider | `packages/ai/src/providers/` |
| Logger, shared types, audit, memory | `packages/core/src/` |

### 11.3 The one question to ask before writing code

> **"Does this code need to know which product it's serving?"**
>
> - **Yes** → it belongs in an app. Even if it feels generic.
> - **No, and it renders something** → it still belongs in an app. Both apps. Duplicated. **On purpose.**
> - **No, and it's headless** → it belongs in `packages/*`.

### 11.4 Rules that do not change

The existing mandatory rules are unaffected and still apply everywhere: all DB access through repositories, Zod on every API boundary, Pino via `createLogger` (never `console.*`), `.eq('user_id', userId)` on every query, no hardcoded model names, TypeScript strict. The V6 Work Protocol still governs all kernel work.

### 11.5 New rules

| # | Rule |
|---|---|
| N1 | **Never import across apps.** CI will fail you. There is no legitimate exception |
| N2 | **Never put React in `packages/*`.** If a package needs a component, the code is in the wrong place |
| N3 | **Never share a UI component between apps.** Duplication here is the design |
| N4 | **Kernel changes are contract changes.** Both apps' tests must pass; SA review mandatory |
| N5 | **A kernel change and both apps' adaptations land in one commit.** This is why we chose one repo — use it |

---

## 12. Open Questions and Known Unknowns

Stated explicitly rather than guessed at.

| # | Question | Status | Blocks |
|---|---|---|---|
| Q1 | Shared vs. isolated Supabase data model | ✅ **Decided 2026-07-16 — shared (Option A, §8)** | — |
| Q2 | Does the `agents` schema carry Orchestrator-specific required columns a Business OS agent couldn't populate? | ✅ **Decided 2026-07-16 — assume NOT, make no schema changes now.** Re-open only if a Business OS write fails against the live schema | Phase 4 (verify-at-write, no pre-work) |
| Q3 | Does Claude Code support hard directory-scoping of subagents in front-matter? | ✅ **Verified 2026-07-16 — NO.** Front-matter has no path field. Enforcement is ESLint+CI (§6.4); optional PreToolUse hook for write-time blocking (§6.3) | Nothing — ESLint is the real control |
| Q4 | `lib/agentkit` scope: V6-only + helpers, or everything incl. V4/V5 legacy? | ✅ **Decided 2026-07-16 — V6 + its helpers only.** V4/V5 legacy stays in `apps/orchestrator`, not promoted to a shared package | Phase 3.5 |
| Q5 | Is Playwright real? | ✅ **Resolved 2026-07-16 — no, removed.** Orphaned single spec (`tests/admin-users.spec.ts`) deleted and `@playwright/test` uninstalled. No E2E framework currently in use | — (CLAUDE.md still references it — see note) |
| Q6 | Ownership of loose root files & tracked dumping-ground dirs | ⬜ Recommend a **triage sweep** before Phase 2 — see reframed explanation below | Nothing (hygiene) — but makes Phase 2 cleaner |
| Q7 | Do both apps share auth/session? | ✅ **Decided 2026-07-16 — shared auth pool.** One account, one user pool. The Orchestrator entitlement gate (Q8) is what keeps a Business OS user out of Orchestrator screens | Phase 4 |
| Q8 | Where does auth gating live, given shared auth? | ✅ **Decided 2026-07-16 — split.** Business OS protects its own routes from day one (reuse existing pattern). The gate that matters is a **server-side entitlement check on Orchestrator** — added *before* Business OS opens to real users. See §12.2 | Phase 4 (Orchestrator gate is a prerequisite) |
| Q9 | Is `lib/business-os/{chat,ai-data-layer}` BOS app logic or a promotable second kernel? | ⬜ **Open (surfaced 2026-08-04 by §13).** It reads like reusable "kernel" (`ChatOrchestrator`, `CapabilityEngine`, `SafeExecutionLayer`) but depends only on `lib/repositories` + `lib/ai` + `lib/logger` and is **entirely disjoint from V6/Pilot**. Default: treat as `apps/business-os` app logic unless deliberately promoted | Phase 4 (task 4.13) |
| Q10 | Is the merged i18n (`i18n.ts` + `next-intl`) live or dead code? | ⬜ **Open (surfaced 2026-08-04 by §13).** `next-intl` is **not in `package.json`** and `next.config.js` was **not** wired — the scaffolding appears dormant. Confirm before assigning it to an app | Phase 4 (task 4.13) |
| Q11 | Business OS does **not** consume the V6/Pilot kernel today (§13.3D). Is that intended? | ⬜ **Open (surfaced 2026-08-04).** The migration's premise is "the shared value is the kernel," yet BOS ships its own chat/capability engine and imports zero `agentkit`/`pilot`. Confirm whether BOS adopts the kernel later, or whether "shared kernel" for BOS effectively means just `packages/repositories` + `packages/ai` | Strategic — informs whether the monorepo pays off for BOS |
| DB | Business OS data-model hygiene issues (corrupt migration, duplicate migrations, a repo without `user_id`, RLS-off global tables) | ⬜ **Open (surfaced 2026-08-04).** Catalogued in [BUSINESS_OS_DATA_MODEL.md §13](/docs/architecture/BUSINESS_OS_DATA_MODEL.md#13-data-model-observations--risks). Independent of the migration; worth spinning off as cleanup tasks | Not a blocker |

> **On Q7 + Q8 together — the gap is closed, not deferred.** See §12.2 for the full reasoning. In short: shared auth means Orchestrator's *current* gate ("logged-in + onboarded") would let a Business OS user straight into the power-user surface. The fix is not on Business OS — it is a server-side entitlement gate on **Orchestrator**, sourced from a trusted signal (the `source_app`/`created_via` discriminator from Q1, or a dedicated entitlement column — never `profiles.role`). This is now a Phase 4 prerequisite.

### 12.2 Q8 in depth — auth gating under a shared user pool

**Grounding (verified against the current code, 2026-07-16):**

| Fact | Evidence |
|---|---|
| Today's `middleware.ts` does **no** auth — only V1/V2 UI-version routing | `middleware.ts` returns `NextResponse.next()` for all paths without a session check |
| Auth is enforced **client-side** in the protected layout | `app/(protected)/layout.tsx` is `'use client'`; gates on `!user` → `redirect('/login')`, then onboarding |
| There is **no** entitlement/role gate | Any authenticated + onboarded user sees the full Orchestrator sidebar. The only access concept is `AdminAccessService`/`admin_users` (admin-only) |

**Why a flat "Business OS needs no middleware" was the wrong framing:** with a shared pool, Orchestrator's entire protection is *"are you logged in and onboarded."* A Business OS user is both — so they would pass straight into the Agents / Analytics / Audit-Trail power-user surface. That is precisely the experience the product vision forbids for non-technical owners.

**The decision — split the gating by app:**

| App | What it needs | Effort |
|---|---|---|
| **Business OS** | Protect its own routes from day one (anonymous → login). Reuse the existing pattern — protected layout or a real `middleware.ts`; the mechanism is an implementation detail | 🟢 Low |
| **Orchestrator** | **The real work:** a *server-side* entitlement gate ("does this user have Orchestrator access?") that bounces shared-pool Business OS users *before* Orchestrator code is served | 🟡 Medium |

**Two constraints on the Orchestrator gate:**

1. **Trusted server signal, not `profiles.role`.** `profiles.role` is user-writable (per the platform security rules) and must never be an authz source. Resolve entitlement server-side the way `AdminAccessService` resolves admin — from the `source_app`/`created_via` discriminator (already being added for Q1) or a dedicated entitlement/plan column.
2. **Server-side, not the current client-side redirect.** Today's gate ships page JS *before* the client decides to redirect. Acceptable for "please log in," not for "you're not allowed in this product." An unentitled user must never receive the Orchestrator bundle.

**Related finer decision (not required now):** the shared auth *pool* (one account) is settled; whether the two apps also share a **session cookie across domains** (true SSO — logged into both at once) is separate. Declining to share the session gives a free first layer — a Business OS user hitting an Orchestrator URL is simply anonymous there and bounced by login. The entitlement gate remains the real control either way.

> **On Q5 → follow-up:** `CLAUDE.md` still documents `npm run test:e2e` and lists Playwright as the E2E tool, both now inaccurate. That's a root-doc edit — flagged for a separate small fix, not done as part of this architecture doc.

### 12.1 Q6 explained — the "triage sweep," in plain terms

The repository root is **not clean**, and all of it is git-tracked (not gitignored):

| What's there | Examples | Nature |
|---|---|---|
| One-off incident scripts | `fix_execution_494784cd.sql`, `fix_execution_metrics_955d35c3.sql`, `update_agent_roi_955d35c3.sql`, `check-step2.mjs` | Dead — tied to specific past execution IDs |
| Reusable ops/debug scripts | `monitor-calibration.sh`, `tail-calibration-logs.sh`, `find-legacy-steps.mjs` | Possibly still useful |
| Tracked dumping grounds | `archive/` (hundreds of dated fix-summary `.md`s), `backups/`, `.vscode-backup/` | Should not be in version control at all |

**Why this matters for the migration (this is the recommendation you asked me to clarify):** Phase 2 moves *the entire repo root* as one block into `apps/orchestrator/`. If we do nothing, all of this clutter rides along into `apps/orchestrator` and becomes permanent — one-time incident SQL and old backups sitting inside a product app forever.

**The "sweep" is a 30-minute triage pass, done BEFORE Phase 2**, assigning each loose item one of three fates:

| Fate | Applies to | Destination |
|---|---|---|
| **Delete** | One-off incident scripts, `backups/`, `.vscode-backup/` | Removed (recoverable from git history) |
| **Keep at repo root** | Genuinely reusable ops/debug scripts | A single root-level `scripts/` (or `tooling/`) that stays at the repo root — shared, in neither app |
| **Archive properly** | `archive/` historical notes worth keeping | Either leave as a root `docs/archive/` or drop; do **not** let it enter `apps/orchestrator` |

It is labelled "out of scope" only in the sense that it is **hygiene, not architecture** — it changes nothing about the decision and blocks no phase. But doing it first means the big Phase 2 move carries only real product code, not years of debug residue.

---

## 13. Business OS: Already Merged into `main` — Code Footprint, Classification & Coupling

**Why this section exists:** the plan above was first written assuming Business OS was green-field. It is not. PR #10 (`feature/ai-business-os-phases-1-2-3`, merge `7c9801d`, 2026-07-28) plus follow-up `06086dc` (2026-07-31) merged **~421 files / ~124k insertions** of Business OS code into `main`. This section records exactly what landed, where each piece belongs in the target structure, and — critically — how entangled it is with the existing app. It is the evidence base for the amended Phase 4.

> The database side of this merge (42 tables + 1 view + 2 buckets) is catalogued separately in **[BUSINESS_OS_DATA_MODEL.md](/docs/architecture/BUSINESS_OS_DATA_MODEL.md)** — see §14.

### 13.1 What merged (footprint)

| Area | Merged content |
|---|---|
| **Route trees** | `app/business-os/` (shell + crm/email-automation/payments/reports/settings/website), `app/site/[subdomain]/` (public tenant sites + booking widget), `app/book/` (public booking management), `app/onboarding-v2/` (replaced `app/onboarding/`) |
| **API routes (~93 new)** | `api/{business-os,website,scheduling,payments,crm,email,intake,book,insights,capabilities}/**`, `api/cron/{calendar-sync,payment-reminders,payment-retry}` |
| **UI components** | `components/{business-os,website,crm,payments,scheduling,email-automation,onboarding}/**` + new Radix primitives `components/ui/{dialog,sheet,tabs}.tsx` |
| **Backend logic** | `lib/business-os/**` (`chat/` NL-command engine, `ai-data-layer/`, `actions/`, `insights/`, CapabilityRegistry, IntentParser, DraftManager), `lib/website-builder/`, `lib/payments/`, `lib/email/templates/`, `lib/i18n/`, a BOS batch of `lib/services/*` |
| **Data access** | **18 BOS repositories** in `lib/repositories/` (BusinessProfile, CRM×4, ContactDocuments, Email, ExternalCalendarEvent, Intake, Onboarding, Payment×2, Scheduling, UserCapability, Website×4) + `lib/business-os/chat/CommandSessionRepository` |
| **DB** | 36 Business OS migrations (`20260721`→`20260731`); see §14 |
| **i18n / assets** | `i18n.ts`, `messages/{en,es,he}.json`, `public/mockups/*.html` |
| **Rode along, NOT BOS** | The `20260629_*` kernel/V6-learning migrations + `lib/services/{AnomalyDetector,BaselineService,ErrorPatternService,GlobalFailureMonitor,PatternExtractor,PluginPerformanceService,WorkflowOptimizer}` + `ErrorPatternRepository`/`IntentExampleRepository` — these are **orchestrator/kernel**, bundled in the same PR |

### 13.2 Classification — where each area goes in the target structure

| Path | Target | Rationale |
|---|---|---|
| `app/{business-os,site,book,onboarding-v2}/**` | **apps/business-os** | BOS experience routes; import no orchestrator UI |
| `app/(protected)/{scheduling,payments,email-automation}/page.tsx` | **apps/business-os** *(currently mis-located in the orchestrator route group)* | BOS pages that must be relocated (§13.3, task 4.8) |
| BOS `app/api/**` (see §13.1) | **apps/business-os** | BOS route handlers |
| `app/api/{admin/*,cron/memory-consolidation,onboarding/build}` | **apps/orchestrator** | Admin/platform, not BOS |
| `components/{business-os,website,crm,payments,scheduling,email-automation,onboarding}/**` | **apps/business-os** | BOS UI — never shared |
| `components/ui/{dialog,sheet,tabs}.tsx` | ⚠️ **judgment call** | Shared Radix primitives; duplicate into each app or a `packages/ui-primitives` |
| `lib/business-os/**`, `lib/website-builder/`, `lib/payments/`, `lib/email/templates/`, `lib/i18n/`, `messages/*`, `public/mockups/*` | **apps/business-os** | BOS app logic + assets |
| `lib/business-os/{chat,ai-data-layer}` | ⚠️ **apps/business-os by default — see Q9** | Self-contained NL engine; not shared kernel unless deliberately promoted |
| 18 BOS repositories (+ WebsiteAnalytics) | **packages/repositories** | Verified headless — zero UI/BOS imports |
| BOS `lib/services/*` batch | **apps/business-os** (or `packages/*` if verified headless) | BOS business logic |

### 13.3 Coupling analysis (the part that shaped Phase 4)

Four dependency directions were checked with `grep`/import analysis. The three that would have been dangerous are **clean**:

| Direction | Verdict | Evidence |
|---|---|---|
| Kernel (`lib/agentkit`, `lib/pilot`) → BOS | ✅ **CLEAN — zero imports** | grep of kernel for any BOS namespace = none |
| New repositories → BOS / UI | ✅ **CLEAN — headless** | `lib/repositories/*` import only Supabase/logger/types |
| `lib/business-os` → orchestrator UI (`app/(protected)`, `app/v2`) | ✅ **NONE** | grep = no matches |
| `lib/business-os` → V6/Pilot kernel | ⚠️ **NONE — see Q11** | BOS depends only on `lib/repositories`(22), `lib/logger`(10), `lib/ai`(1), `AuditTrailService`(1), `supabase*`(3). It does **not** use the kernel today |

**The only real entanglement (orchestrator → BOS) lives in three shared shell files** — this is what Phase 4b hand-splits:

| File | Coupling | Impact |
|---|---|---|
| `app/(protected)/layout.tsx:566` | Orchestrator sidebar hardcodes a `/business-os` link and demotes "Dashboard" → "Agent Dashboard" | Existing app's chrome points into BOS |
| `app/(protected)/{scheduling,payments,email-automation}/page.tsx` | Import `@/components/{scheduling,payments,email-automation}` — BOS UI mounted in the orchestrator route group | Must relocate to `apps/business-os` |
| `middleware.ts` (+129/−12) | Now BOS-aware: subdomain rewrite, `onboarding-v2` gate reading `business_profiles`, v2-rewrite exclusions | One file encodes both apps' routing |

*BOS → orchestrator* has exactly one shared dependency: `app/business-os/**` → `@/components/UserProvider` (the shared auth context) — trivial for each app to own.

### 13.4 Migration impact (folded into the plan above)

- **Phase 2 stays a pure block-move.** Because `main` is one Next app serving both surfaces, relocating the whole root to `apps/orchestrator` keeps the combined app working. BOS is separated in Phase 4, not here.
- **Phase 3 extracts the 18 BOS repositories** into `packages/repositories` alongside the existing ones — verified clean.
- **Phase 4 becomes an extraction**, and its risk is the **shell coupling, not the backend**: if BOS routes move before `app/(protected)/layout.tsx` is updated, the orchestrator sidebar 404s. **Sequence the shell edit and the page relocation in one change** (task 4.8).
- **Two decisions gate Phase 4** (Q9 chat/ai-data-layer placement; Q10 i18n wiring) and one strategic question is now open (Q11: BOS doesn't consume the kernel — is the monorepo's "shared kernel" premise met for BOS, or is the shared value really just repositories + AI?).

---

## 14. Business OS Data Model

The Business OS merge introduced **42 tables + 1 view + 2 storage buckets** across 10 capability domains (Business Profile, CRM, Website, Scheduling, Payments, Email Automation, Intake, Onboarding, Command/Chat, Capabilities). The complete catalog — every table's columns, types, constraints, keys, RLS policies, indexes, triggers, and owning repository, plus the relationship graph and a risk register — is maintained as a dedicated companion document:

> 📄 **[BUSINESS_OS_DATA_MODEL.md](/docs/architecture/BUSINESS_OS_DATA_MODEL.md)**

**The one fact that matters for this architecture:** every Business OS table roots at `auth.users`, and **none reference the kernel/`agents` schema.** The two schemas are cleanly separable — which is the data-layer confirmation of the shared-Supabase decision (§8): one database, one auth root, but non-entangled tables. The `20260629_*` kernel/V6-learning tables that shipped in the same PR are **not** Business OS entities and are excluded from that catalog.

---

## 15. Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-07-16 | Initial document | Recorded the kernel-vs-experience monorepo decision, rejected alternatives (separate repo + HTTP; shared Next.js app), contamination controls, blast-radius controls, the open data-model decision, and the 6-phase reversible migration plan. Grounded against the repository: found 4 findings that materially changed the plan — `packages/core` is required (V6 depends on unmapped `lib/server`/`logger`/`types`/`services`/`audit`/`memory`); a `repositories ↔ pilot` cycle must be broken first; `lib/plugins/pluginList.tsx` puts React in a kernel package; and `next.config.js` ignores lint+TS errors, so the ESLint boundary requires a CI job to have any effect. |
| 2026-07-16 | Data model decided | Resolved Section 8 to **Option A (shared Supabase)** per stakeholder agreement. Updated the one-page decision table + status line, reframed §8 from open question to decision-of-record (rationale retained), and re-prioritized the dependent open questions. |
| 2026-07-16 | Open questions resolved (Q2–Q8) | **Q2:** assume no Orchestrator-specific required columns; make no schema changes now (verify-at-write). **Q3:** verified Claude Code front-matter has NO directory-scoping field — enforcement is ESLint+CI (§6.4), optional PreToolUse hook (§6.3); updated §6.3 accordingly. **Q4:** `packages/kernel` = V6 + helpers only; V4/V5 legacy stays in `apps/orchestrator`. **Q5:** Playwright confirmed orphaned and **removed** (deleted `tests/admin-users.spec.ts`, uninstalled `@playwright/test`); CLAUDE.md still references it — flagged for a separate fix. **Q6:** reframed as a pre-Phase-2 triage sweep with a concrete disposition table (new §12.1). **Q7:** shared auth pool. **Q8:** *(superseded below)*. |
| 2026-07-16 | Q8 revised — gap closed | Reworked Q8 after grounding it in the current code: today's `middleware.ts` does no auth, gating is a client-side layout check, and there is no entitlement gate. Shared auth therefore means Orchestrator's "logged-in + onboarded" gate would admit Business OS users. **New decision (split):** Business OS protects its own routes from day one; the real control is a **server-side entitlement gate on Orchestrator**, sourced from a trusted signal (not `profiles.role`), added as a **Phase 4 prerequisite** (task 4.2). Added §12.2 with the full reasoning. Previously "accepted deferred risk" — now mitigated by design. |
| 2026-07-16 | Renamed `studio` → `orchestrator` | Renamed the existing-app package throughout: folder `apps/orchestrator`, prose "Orchestrator" (was "Studio"). Reflects the app's role (agent orchestration/management for technical users). Note the mild terminology overlap with the kernel's existing `OrchestrationService` — acceptable, flagged for awareness. |
| 2026-08-04 | Business OS found already merged — plan amended | Reviewed PR #10 (`7c9801d`) + `06086dc`: ~421 files of Business OS code are already in `main`. Added **§13** (footprint, classification, coupling) and **§14** (data-model pointer), and created companion **[BUSINESS_OS_DATA_MODEL.md](/docs/architecture/BUSINESS_OS_DATA_MODEL.md)** (42 tables + 1 view + 2 buckets). **Rewrote Phase 4** from "scaffold empty business-os" to "**extract** the already-merged BOS" — a bounded `git mv` (4a) + three-file hand-split of `middleware.ts`/`app/(protected)/layout.tsx`/`package.json` (4b) + auth/decisions (4c). Kept Phase 2 as a pure block-move (BOS rides along as part of the single current app). Coupling verified clean (kernel↔BOS zero imports; BOS repos headless). Opened **Q9** (chat/ai-data-layer placement), **Q10** (unwired i18n/`next-intl`), **Q11** (BOS consumes no kernel today — is the shared-kernel premise met?), and a DB-hygiene item (corrupt/duplicate migrations, `WebsiteBlockRepository` lacks `user_id`, RLS-off global tables). |
