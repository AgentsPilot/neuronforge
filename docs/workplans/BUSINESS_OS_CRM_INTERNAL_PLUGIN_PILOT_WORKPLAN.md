# Workplan: Business OS CRM Internal-Plugin Pilot (CRM-first)

> **Last Updated**: 2026-08-06

**Author:** Dev
**Status:** SA-reviewed (approve-with-changes) — C1–C4 + A1/A2 folded into §10 (2026-08-06); awaiting SA sign-off on the amended checklist, then implementation
**Feature branch:** `docs/business-os-module-requirements` (continues current branch; synced with `main` via fast-forward on 2026-08-06)

## Overview

This workplan implements the **phased, CRM-first pilot** agreed in the two BOS requirements and the SA feasibility review. It has two in-scope steps:

- **Step 1 — CRM repository conformance.** Guarantee every CRM data-access path goes through the CRM repositories in `lib/repositories/` (no direct Supabase against CRM tables outside repositories), and confirm the five CRM repositories are pattern-conformant.
- **Step 2 — Internal CRM plugin.** Deliver CRM as a **standard V2 plugin** whose executor **delegates to the CRM repositories**, gated by a new **`db_active` access strategy** (fail-closed), backward-compatible with what the app uses today, and invokable platform-wide (chat, AI data layer, V6/orchestrator).

**Explicitly out of scope (do not build/design here):** the trigger→event-driven migration (Step 3); config-driven capability selection & `business_profiles.primary_*` wiring (R7 — parked, v1 uses internal only); any external CRM plugin / license-tier strategy (designed seams only); the repo-wide ESLint/CI guard, `insight/**` remediation, and misplaced-repo relocations (tracked as separate BOS tasks per Document 1).

**Hard guardrail (SA §2.5):** the CRM executor **delegates to repositories and must NOT re-emit activities/contacts.** The 9 Postgres triggers stay untouched and remain the sole owner of cross-capability side-effects. In particular trigger **T8** already logs `contact_created` on `crm_contacts` INSERT — the `create_contact` operation must not also log that activity (would double-log). **No migration files are created in this pilot.**

### Source documents

| Doc | Role |
|---|---|
| [BUSINESS_OS_MODULE_REPOSITORY_LAYER_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_MODULE_REPOSITORY_LAYER_REQUIREMENT.md) | Document 1 — repository layer (Step 1, CRM-scoped) |
| [BUSINESS_OS_MODULE_PROVIDER_ABSTRACTION_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_MODULE_PROVIDER_ABSTRACTION_REQUIREMENT.md) | Document 2 — unified plugin model (Step 2) |
| [BUSINESS_OS_MODULE_PLUGIN_SA_FEASIBILITY_REVIEW.md](/docs/architecture/BUSINESS_OS_MODULE_PLUGIN_SA_FEASIBILITY_REVIEW.md) | SA verdict + refactors R1–R8 + trigger inventory + guardrails |

## Table of Contents

1. [Findings From the Pre-Workplan Audit](#1-findings-from-the-pre-workplan-audit)
2. [Step 1 — CRM Repository Conformance](#2-step-1--crm-repository-conformance)
3. [Step 2 — Internal CRM Plugin (R1–R6, R8)](#3-step-2--internal-crm-plugin-r1r6-r8)
4. [App → Plugin Operation Mapping (Backward-Compat)](#4-app--plugin-operation-mapping-backward-compat)
5. [Files Touched](#5-files-touched)
6. [Verification Plan (Proves Nothing Broke)](#6-verification-plan-proves-nothing-broke)
7. [Open Decisions for SA](#7-open-decisions-for-sa)
8. [Risks & Mitigations](#8-risks--mitigations)
9. [Out of Scope / Follow-ups](#9-out-of-scope--follow-ups)
10. [Task Checklist](#10-task-checklist)
11. [SA Review](#11-sa-review)
12. [QA Report](#12-qa-report)
13. [Change History](#13-change-history)

---

## 1. Findings From the Pre-Workplan Audit

A full mechanical audit of CRM data access and the CRM capability surface was performed before writing this plan. Key findings that shape the tasks below:

**CRM repositories are already conformant.** All five (`CRMContactRepository`, `CRMActivityRepository`, `CRMTaskRepository`, `CRMPipelineStagesRepository`, `ContactDocumentsRepository`) return `{ data, error }`, use Pino `createLogger`, export a singleton bound to `supabaseServer`, and scope every read/write by `.eq('user_id', …)`. **No `console.*` anywhere in the CRM repos.** Two small normalizations exist (see Task 1.1).

**Two clean repo-delegating surfaces already exist**, and are the reference model for the executor:
- `lib/business-os/chat/CapabilityEngine.ts` — clean `switch(capability.id)` → CRM repo calls (7 CRM capabilities: `contact.create/update/delete`, `task.create/complete/update/delete`), 1:1 with `CapabilityRegistry.ts`.
- `lib/business-os/ai-data-layer/SafeExecutionLayer.ts` — already delegates all CRM contact/task reads+writes to the repositories with confirmation-gated mutations.

**Direct CRM DB access outside repositories is concentrated in 8 runtime files** (plus a test-seed script, ignored). `components/**` is already clean.

| Cluster | Files | CRM tables touched | Nature |
|---|---|---|---|
| **Live chat executor** | `lib/business-os/ChatCommandExecutor.ts` (9 sites) | `crm_contacts`, `crm_tasks` | **live** path used by `app/api/business-os/chat/route.ts` — reads + task insert |
| **Public website intake** | `app/api/website/forms/intake`, `forms/contact`, `booking/confirm`, `booking/create`, `booking/finalize` (routes) | `crm_contacts`, `crm_activities`, `crm_pipeline_stages` | service-role writes: contact dedupe/insert/update + **explicit** activity logging + stage resolution |
| **Read-only dashboards/cron** | `app/api/business-os/stats`, `business-os/my-day`, `business-os/metrics/summary`, `app/api/cron/insight-detect` | `crm_contacts`, `crm_pipeline_stages` | counts/selects only |
| **Payment reminders** | `lib/services/PaymentReminderService.ts` (1 site) | `crm_contacts` | recipient lookup |

> **Correction to the audit's framing:** `ChatCommandExecutor.ts` is **live** (imported by the chat route), not legacy. `CapabilityEngine`/`SafeExecutionLayer` are parallel, cleaner surfaces. Which chat surface is canonical is an open item for SA (see §7, Decision D2) because it changes whether we remediate-in-place vs retire, and which caller we wire in R8.

**Capability coverage gaps:** neither existing surface exposes `crm_activities`, `crm_pipeline_stages`, or `contact_documents` operations — yet the website routes write activities/stages directly. The repo methods to back them already exist (`crmActivityRepository.create`, `crmPipelineStagesRepository.list`, `crmContactRepository.updateStage`). The plugin definition will expose these net-new (single source of truth).

**Substrate confirms feasibility (SA R-notes):** `base-plugin-executor.ts` `executeAction()` is provider-agnostic except the Step-2 connection branch; `user-plugin-connections.ts` `getConnection()` already has a non-OAuth `auth_type === 'platform_key'` branch returning a virtual connection carrying `user_id`; `plugin-manager-v2.ts` `validatePluginDefinition()` only requires `plugin.name`, `plugin.auth_config` (presence), and per-action `description`/`parameters`/`output_guidance`. `business_profiles` has `businessProfileRepository.findByUserId(userId)` returning `{ data: null }` for non-tenants — the exact anchor for `db_active`.

---

## 2. Step 1 — CRM Repository Conformance

**Goal:** the pilot gate from Document 1 — "the CRM tables map to their repositories, CRM data access carries no direct `.from()` outside `lib/repositories/`, and CRM repositories are conformant." Every change here is **behavior-preserving** (same queries, same query shape — NFR: no added round-trips).

### Task 1.1 — Normalize the CRM repositories (small)
- `ContactDocumentsRepository`: adopt constructor Supabase-client injection like the other four (currently uses module-level `supabaseServer` with no constructor) so it is uniformly testable and monorepo-extractable. Preserve the singleton export + `supabaseServer` default.
- `CRMPipelineStagesRepository.reorder()`: currently fires N parallel `update`s via `Promise.all` and returns the aggregate error only implicitly — make error propagation explicit (return the first error). Behavior-preserving on the success path.
- Confirm (no change expected) `{data,error}` shape, Pino logging, `user_id` scoping, singleton export across all five.
- **No** migration to the shared `RepositoryResult` type in this pilot (G4 deferred per Document 1 Q3) unless SA wants it opportunistically.

### Task 1.2 — Remediate CRM direct-DB-access to route through repositories
Each file's **CRM-table** queries move to the corresponding repository method. **Non-CRM** queries in the same files (payments, scheduling, `business_profiles`) stay as-is (out of CRM scope). Every change is behavior-preserving and independently verifiable.

**1.2.0 (investigation, blocks 1.2.a):** confirm whether `ChatCommandExecutor.ts` is the canonical live CRM chat path or is being superseded by `CapabilityEngine`. Outcome decides remediate-in-place vs retire (see §7 D2). Do not rewrite until settled.

**1.2.a — `ChatCommandExecutor.ts` (9 sites).** Replace inline `supabaseServer.from('crm_contacts'|'crm_tasks')` with `crmContactRepository.*` / `crmTaskRepository.*`. Mapping:
- contact fuzzy-match load / by-id fetch / stage+search list / name-resolve (×4) → `crmContactRepository.list` / `findById` (add a light `list` option or reuse existing filters; **no new query shape**).
- overdue tasks / follow-up contacts / task list-with-contact-join → `crmTaskRepository.getOverdue` / `crmContactRepository.list` / `crmTaskRepository.list` (repo already joins `contact:crm_contacts`).
- task insert → `crmTaskRepository.create`.
- If 1.2.0 concludes "retire," this becomes a deprecation instead (route switches to the repo-backed surface).

**1.2.b — Website public intake (5 routes).** contact dedupe/insert/update → `crmContactRepository.findByEmail`/`upsertByEmail`/`update`; activity logging → `crmActivityRepository.create` (**keep** genuinely-explicit activities, e.g. the intake `note`); stage resolution in `booking/finalize` → `crmPipelineStagesRepository.list`; stage upgrade → `crmContactRepository.updateStage`. **Guardrail:** the contact INSERT still fires T8's `contact_created` separately, as today.
  - **(C4 — must-do before moving any activity insert):** produce a **per-route inventory** table: `route → explicit crm_activities insert → is it also produced by a trigger (T1/T2 booking, T3 payment, T5 email)? → keep / drop`. `forms/intake`/`forms/contact` write a `note` (not trigger-owned → **keep**). `booking/create|confirm|finalize` also write `scheduling_bookings`/payment/email → **verify** whether their explicit activity is already trigger-owned; moving a trigger-owned activity to an explicit repo call would **double-log** (the §2.5 trap one layer up). Confirm `crmActivityRepository.create` maps the raw insert 1:1 (`type`/`title`/`description`/`metadata`) so rows are byte-identical. Parity assertion: per-contact activity **row counts unchanged** after remediation.

**1.2.c — Read-only dashboards + cron (4 routes).** counts/selects → `crmContactRepository.count`/`list` and `crmPipelineStagesRepository.list`. Where a count/aggregate has no exact repo method, add a **shape-preserving** method (e.g. `countBySource`, `countNewSince`) rather than fanning out into N calls (NFR). *If SA prefers, the pure-read cluster can be a fast-follow within the pilot branch (see §7 D1) — recommended to keep, since it's low-risk.*

**1.2.d — `PaymentReminderService.ts` (1 site).** recipient lookup → `crmContactRepository.findById`.

> **Console/Pino:** none of these files log via `console.*` for the CRM lines being touched (verified). If any touched file has stray `console.*` elsewhere, flag it per CLAUDE.md rule #3 and convert on approval — do not reformat untouched files.

---

## 3. Step 2 — Internal CRM Plugin (R1–R6, R8)

Implements the SA refactors, CRM-relevant only. **R7 (capability-selection resolver) is parked** — v1 always uses the internal CRM plugin; the selection seam is documented, not built.

### R3 — Declare `access_strategy` in the plugin definition schema (Low)
- Add `access_strategy?: { type: 'oauth' | 'db_active' | 'license_tier'; [k: string]: unknown }` to `PluginDefinition['plugin']` in `lib/types/plugin-types.ts`. Optional, so all 20 existing plugins are unchanged.
- `license_tier` is a **declared-but-unimplemented** seam (documented, throws "not implemented" if ever selected).

### R2 — Relax `validatePluginDefinition` (Low)
- In `plugin-manager-v2.ts`, allow an internal plugin to declare `access_strategy` with a **minimal** `auth_config` (an internal stub) instead of full OAuth URLs. The current check only asserts `auth_config` presence, so the change is: keep accepting a stub `auth_config`, and (optionally) assert that when `access_strategy.type === 'db_active'` the plugin is `isSystem: true`. No behavior change for existing plugins.

### R1 — Generalize the access/eligibility resolver — `db_active`, **fail-closed** (Medium; security-critical)
The genuinely-new logic. Today `getConnection()` returns a virtual connection **unconditionally** for `auth_type === 'platform_key'` (no eligibility check). We generalize resolution into an explicit strategy, adding `db_active` which **verifies an active BOS tenant and fails closed.**

- Add a small `AccessStrategyResolver` (proposed: `lib/server/access-strategy.ts`) with `resolve(userId, pluginKey, { accessStrategy, authConfig }): Promise<{ eligible: boolean; connection: UserConnection | null; reason?: string }>`:
  - `oauth` (default when no `access_strategy` and `auth_type !== 'platform_key'`): delegate to existing `UserPluginConnections.getConnection` (DB lookup + smart refresh). `eligible = connection != null`.
  - `platform_key` (default when `auth_type === 'platform_key'`): **preserve today's behavior** — unconditional virtual connection, `eligible = true`.
  - `db_active` (**new**): call `businessProfileRepository.findByUserId(userId)`. `eligible` **only** when `{ data != null, error == null }`. On `error` **or** `data == null` → `eligible = false` (fail closed). When eligible, return a virtual connection carrying `user_id` (mirror the `platform_key` virtual-connection shape).
- In `base-plugin-executor.ts` Step 2, resolve strategy from the definition (`plugin.access_strategy`, else inferred as above) and call the resolver. **(C1)** The resolver is the **single source of the connection for all strategies** — the `oauth`/`platform_key`/`db_active` connection all come from the resolver return; the legacy `if (!connection && !isSystemPlugin)` short-circuit is **removed/superseded**, not left in parallel. A denied strategy **early-returns before** `executeSpecificAction` (base-plugin-executor.ts:110) regardless of `isSystem`; an eligible `db_active` passes the resolver's **virtual connection carrying `user_id`** (the CRM plugin's `auth_type:'internal'` would otherwise make legacy `getConnection` return `null` and `isSystem:true` pass `null` straight through).
- **(C2)** Map `!eligible` to a **strategy-specific** error contract: `oauth → error:'auth_failed'` (byte-identical code + "reconnect in Settings" message, preserving existing callers/tests), `db_active → error:'access_denied'`. Do not collapse to one code. Unit-assert both.
- **(C3)** `testConnection()` (base-plugin-executor.ts:299–307) is a second, un-refactored copy of Step-2 resolution — for `auth_type:'internal'` it returns `no_connection` for **every** user including valid tenants (the null early-return precedes `performConnectionTest`, so the R5 override does not fix it). Either route `testConnection` through `AccessStrategyResolver` or scope it out with a code comment stating `db_active` plugins don't use `testConnection`. Pick one and implement it.
- **Backward-compat:** every existing plugin resolves to `oauth` or `platform_key` exactly as today — byte-for-byte behavior. Only the CRM plugin opts into `db_active` via its explicit `access_strategy`.
- **Placement (SA-confirmed, D3):** standalone `AccessStrategyResolver` module (`lib/server/access-strategy.ts`) — isolates the security-critical fail-closed branch, keeps `UserPluginConnections` single-responsibility, independently unit-testable.

### R4 — Author the CRM plugin definition (Medium)
- New `lib/plugins/definitions/crm-plugin-v2.json`:
  - `plugin`: `name:"crm"`, `isSystem:true`, `provider_family:"internal-bos"`, `access_strategy:{type:"db_active"}`, `category:"crm"`, minimal internal `auth_config` stub (mirror `chatgpt-research`'s empty-string OAuth block with `auth_type:"internal"`).
  - `actions`: the backward-compatible operation set in §4, each with full `parameters` (JSON Schema), `output_schema`, `output_guidance`, and **V6 metadata** `domain:"crm"` + per-action `capability` (from the confirmed `Capability` enum: `create/get/list/update/delete/aggregate`) so V6 CapabilityBinder selects it predictably.
  - Only **domain operations + I/O schemas** live here — no UI/navigation intents, no conversational/multilingual metadata (registry-collapse correction).

### R5 — Author `CRMPluginExecutor` (Medium)
- New `lib/server/crm-plugin-executor.ts` `extends BasePluginExecutor`:
  - `executeSpecificAction(connection, actionName, parameters)` reads `const userId = connection?.user_id` (**guard**: if missing → throw `access_denied`), then `switch(actionName)` → the mapped CRM repository call (§4). Mirrors `SafeExecutionLayer`'s delegation.
  - Return the repo `data` (executor stays thin; `BasePluginExecutor` wraps success/error formatting).
  - **Guardrail enforced here:** `create_contact` calls **only** `crmContactRepository.create` (no activity emission — T8 owns `contact_created`); `update_contact`/`move_stage` emit no activity; `log_activity` is the **only** activity-writing op and writes exactly the caller-supplied activity.
  - `move_stage` optionally validates the target stage against `crmPipelineStagesRepository.list` before `updateStage` (reject unknown stage) — keep it a single extra read only when validation is on.
  - Override `performConnectionTest` to a trivial "tenant active?" check (cosmetic).

### R6 — Register the plugin (Low)
- Add `'crm-plugin-v2.json'` to `corePluginFiles` in `plugin-manager-v2.ts`.
- Add `'crm': CRMPluginExecutor` to `executorRegistry` in `plugin-executer-v2.ts`.

### R8 — Wire ONE real caller through the plugin path (Medium; parity is the gate)
- Route one genuine CRM caller's operation through `PluginExecuterV2.execute(userId, 'crm', action, params)` instead of a direct repo call, proving internal execution end-to-end with **identical behavior**.
- **Caller (SA-directed, D2):** wire the surface that is actually on the **live** request path (resolved by Task 1.2.0). A non-live surface is a non-proof. If the live surface is `ChatCommandExecutor`, wire **one** of its CRM ops (e.g. `add_task`) through the plugin path and leave the remaining sites remediated-to-repo — bounds blast radius to one op. `CapabilityEngine`/`SafeExecutionLayer` are acceptable only if 1.2.0 confirms one of them is reachable in production.
- Centralize the `'crm'` string literal in **one** constant at the call site with a `// TODO(R7): route via capability resolver` comment (R7 parked, so no resolver yet — avoid seeding scattered plugin-name literals).
- Operations not exercised by the chosen caller (`list_*`, `move_stage`, `log_activity`, …) are proven via the plugin integration tests (§6) and are available to V6/agents.

### D7 — CRM plugin user documentation (Low; added 2026-08-06 per user)
- New `docs/plugins/crm-plugin.md`, matching the shape of the existing plugin docs (e.g. [stripe-plugin.md](/docs/plugins/stripe-plugin.md), [hubspot-plugin.md](/docs/plugins/hubspot-plugin.md)): Overview → "Connection" (for CRM: no OAuth — it's an internal capability available to active Business OS accounts, gated by the `db_active` access strategy) → **Available Actions** grouped (Contacts / Tasks / Activities / Pipeline) with each op's params + return + example use-cases, mirroring the §4 operation set → notes on the trigger-owned auto-activities (so users understand `contact_created`/booking/payment/email activities are logged automatically and `log_activity` is for manual notes). Follows the docs standards (header block, Last Updated, kebab-case filename).

### D8 — Add CRM to the V2 test page Form Tester (Medium; added 2026-08-06 per user)
- Wire the internal CRM plugin into the **Form Tester** (schema-driven, no-code) sub-mode of `/test-plugins-v2` (`app/test-plugins-v2/page.tsx` + `components/test-plugins/tester/FormTester.tsx` + `lib/plugins/tester/connection-gate.ts`) so the user can run CRM operations from the UI form.
- **Why it's low-risk + high-value:** the tester is already schema-generic — it loads any action's schema via `GET /api/plugins/action-schema` and runs it via `POST /api/plugins/execute`, both of which already resolve `crm` (definition + `CRMPluginExecutor`). No per-plugin form logic is needed. This also serves as the **primary hands-on end-to-end verification** of the plugin (db_active gate + executor + repositories) before touching any live caller.
- **The one nuance (internal-plugin connection gate):** the Form Tester's access gate (`connection-gate.ts` / `evaluateConnectionGate`) currently requires all five Google Suite **OAuth** connections. CRM has no OAuth connection — eligibility is `db_active`, enforced server-side at execute time. So the gate must treat internal/`db_active` plugins as **connection-gate-exempt** (gated only on a non-empty `userId`); a non-tenant simply gets `access_denied` back from execute and the tester displays it. Scope: add CRM to the tester's selectable plugin set and branch the gate for internal plugins — schema-generically, no CRM-specific form hardcoding (consistent with the existing "scope boundary in one named constant, not per-plugin behavior" design). Keep the destructive-action confirm gate working for `delete_contact`/`delete_task` (already presence-rule driven).

---

## 4. App → Plugin Operation Mapping (Backward-Compat)

The plugin definition is the **single source of truth** for CRM domain operations. The set below is the **union** of what `CapabilityEngine` + `SafeExecutionLayer` + the website routes use today, so any caller can migrate without loss (Decision 1: additive/gradual). SA may trim (see §7 D5).

| Plugin operation | `capability` | Executor → repository call | Existing callers it stays compatible with |
|---|---|---|---|
| `create_contact` | create | `crmContactRepository.create({ user_id, … })` | CapabilityEngine `contact.create`; SafeExecutionLayer `contacts.create`; website intake insert |
| `get_contact` | get | `crmContactRepository.findById(id, userId)` | SafeExecutionLayer `contacts.get` |
| `list_contacts` | list | `crmContactRepository.list(userId, opts)` | SafeExecutionLayer `contacts.list`; ChatCommandExecutor list |
| `count_contacts` | aggregate | `crmContactRepository.count(userId, opts)` | SafeExecutionLayer `contacts.count`; stats routes |
| `update_contact` | update | `crmContactRepository.update(id, userId, updates)` | CapabilityEngine `contact.update`; SafeExecutionLayer `contacts.update` |
| `move_stage` | update | `crmContactRepository.updateStage(id, userId, stage)` (+ optional `crmPipelineStagesRepository.list` validation) | website `booking/finalize` upgrade; today via `contact.update` |
| `delete_contact` | delete | `crmContactRepository.delete(id, userId)` (hard delete — preserve) | CapabilityEngine `contact.delete`; SafeExecutionLayer `contacts.delete` |
| `add_task` | create | `crmTaskRepository.create({ user_id, … })` | CapabilityEngine `task.create`; SafeExecutionLayer `tasks.create`; ChatCommandExecutor insert |
| `get_task` | get | `crmTaskRepository.findById(id, userId)` | SafeExecutionLayer `tasks.get` |
| `list_tasks` | list | `crmTaskRepository.list(userId, opts)` | SafeExecutionLayer `tasks.list`; ChatCommandExecutor list |
| `count_tasks` | aggregate | `crmTaskRepository.countByStatus(userId, contactId?)` | SafeExecutionLayer `tasks.count` |
| `update_task` | update | `crmTaskRepository.update(id, userId, updates)` | CapabilityEngine `task.update`; SafeExecutionLayer `tasks.update` |
| `complete_task` | update | `crmTaskRepository.complete(id, userId)` | CapabilityEngine `task.complete`; SafeExecutionLayer `tasks.complete` |
| `delete_task` | delete | `crmTaskRepository.delete(id, userId)` | CapabilityEngine `task.delete`; SafeExecutionLayer `tasks.delete` |
| `log_activity` | create | `crmActivityRepository.create({ user_id, … })` | website routes explicit activity logging (net-new capability) |
| `list_activities` | list | `crmActivityRepository.getForContact` / `getRecent` | (net-new; today only via direct access) |
| `list_pipeline_stages` | list | `crmPipelineStagesRepository.list(userId)` | website `booking/finalize`; move_stage validation |

**Priority/tag conformance note:** align the task `priority` enum on the plugin definition with `CRMTaskRepository.TaskPriority` (`low|medium|high|urgent`) — the chat registry currently under-declares it (`low|medium|high`). Do not silently drop `urgent`.

---

## 5. Files Touched

**New**
- `lib/plugins/definitions/crm-plugin-v2.json` (R4)
- `lib/server/crm-plugin-executor.ts` (R5)
- `lib/server/access-strategy.ts` (R1)
- Tests (lean, pure): `lib/server/crm-plugin-executor.test.ts`, `lib/server/access-strategy.test.ts` (§6 — no DB-backed suites)
- `docs/plugins/crm-plugin.md` (D7)

**Modified — added deliverables (D8, test page)**
- `app/test-plugins-v2/page.tsx`, `components/test-plugins/tester/FormTester.tsx`, `lib/plugins/tester/connection-gate.ts` (D8 — add CRM to Form Tester; make internal/`db_active` plugins connection-gate-exempt)
- `docs/V2_TEST_PAGE_SCOPE.md` (note CRM coverage in the Form Tester section)

**Modified — Step 2**
- `lib/types/plugin-types.ts` (R3)
- `lib/server/plugin-manager-v2.ts` (R2 + R6 `corePluginFiles`)
- `lib/server/plugin-executer-v2.ts` (R6 `executorRegistry`)
- `lib/server/base-plugin-executor.ts` (R1 Step-2 resolution + fail-closed)
- `lib/server/user-plugin-connections.ts` (R1 — only if resolver lives here per D3)
- one caller for R8 (`lib/business-os/chat/CapabilityEngine.ts` **or** `ChatCommandExecutor.ts` / `SafeExecutionLayer.ts`, per D2)

**Modified — Step 1**
- `lib/repositories/ContactDocumentsRepository.ts`, `lib/repositories/CRMPipelineStagesRepository.ts` (Task 1.1)
- `lib/business-os/ChatCommandExecutor.ts`; `app/api/website/{forms/intake,forms/contact,booking/confirm,booking/create,booking/finalize}/route.ts`; `app/api/business-os/{stats,my-day,metrics/summary}/route.ts`; `app/api/cron/insight-detect/route.ts`; `lib/services/PaymentReminderService.ts` (Task 1.2) — plus possibly small new shape-preserving repo methods for the read cluster.

**NOT touched (guardrail):** no DB migration files; the 9 Postgres triggers; `capabilities`/`user_capabilities` schema; any external plugin.

---

## 6. Verification Plan (Proves Nothing Broke)

> **Lean-test policy (per user, 2026-08-06):** keep the always-run test suite small and fast — do **not** add heavy DB-backed integration suites that slow the build. Only **fast, pure, mocked unit tests** go in the build. DB-dependent verification (no-double-logging, plugin↔repo parity, route regression) is done by **QA manually** — primarily through the new Form Tester (D8) plus a couple of DB row-count checks — not as always-run CI integration tests.

**In-build (fast pure unit — the whole point is they add ~no build time):**
- `access-strategy.test.ts` — **fail-closed matrix** with a mocked `BusinessProfileRepository`: active tenant (`data` non-null) → eligible; no profile (`data:null`) → **denied `access_denied`**; repo error → **denied**; and the `oauth` no-connection path still returns **`auth_failed`** (C2). ~6 cases, no DB.
- `crm-plugin-executor.test.ts` — with mocked CRM repositories: representative `actionName`s dispatch to the correct repo method with `user_id` from `connection`; missing `user_id` → throws; **guardrail-by-construction**: `create_contact`/`update_contact`/`move_stage` call **no** activity method (assert `crmActivityRepository.create` not called), `log_activity` calls it exactly once. No DB.

Keep both files tight (mock repos; no Supabase, no network). Two small `*.test.ts` files ≈ negligible build impact.

**QA-manual (NOT in the build — done via D8 Form Tester + DB inspection):**
- **Smoke / end-to-end:** run each CRM op from the Form Tester against a seeded active tenant; confirm success payloads. Confirm a **non-tenant** userId returns `access_denied`.
- **No-double-logging guardrail:** after `create_contact`, check `crm_activities` has **exactly one** `contact_created` row (the trigger's); `update_contact`/`move_stage` add none; `log_activity` adds exactly one.
- **Parity + Step 1/R8 regression:** spot-check that remediated routes/services produce identical CRM rows/results (website intake same contact+activity rows; stats counts unchanged; chat command unchanged), and the R8-wired caller behaves identically before/after.
- **A1:** V6 binder/orchestrator degrades gracefully on an `access_denied` execution result (one focused check).

QA writes results into §12. Minimum gate (CLAUDE.md testing): the two unit files green (happy + failure path each); guardrail + one parity path verified manually.

---

## 7. Open Decisions for SA

> **All resolved by SA in §11 (2026-08-06)** — every recommendation below was approved. D1 keep read cluster in (land last); D2 investigate liveness, remediate in place, wire the live surface; D3 standalone resolver; D4 row-presence only; D5 full union (conditional on schema/enum completeness); D6 defer unification. Retained here for rationale.

These are **technical** forks (not user-facing business decisions):

- **D1 — Step 1 remediation boundary.** Remediate all 8 CRM direct-access files in the pilot, or land write-paths (ChatCommandExecutor, website intake ×5, PaymentReminderService) now and the 4 read-only stats/cron routes as a fast-follow on the same branch? *Rec: keep read cluster in — low risk, and the pilot gate says "no direct `.from()` outside repositories for CRM."*
- **D2 — Canonical chat surface + R8 caller.** Is `CapabilityEngine` or the live `ChatCommandExecutor` the canonical CRM chat path? This decides (a) whether 1.2.a remediates-in-place or retires, and (b) which caller R8 wires. *Rec: wire `CapabilityEngine` (clean 1:1) if it is/will-be canonical; else wire the `ChatCommandExecutor` CRM ops.*
- **D3 — R1 placement.** Standalone `AccessStrategyResolver` module (rec: isolates fail-closed security logic) vs a new branch inside `UserPluginConnections.getConnection`.
- **D4 — `db_active` "active tenant" definition.** v1 = "has a `business_profiles` row" (via `findByUserId`). Confirm this is the intended eligibility signal (vs also requiring `onboarding_completed`). *Rec: presence of row only, per Document 2 "user is active in the DB."*
- **D5 — Operation surface breadth.** Full backward-compat union (§4, ~17 ops) vs the worked-example minimal 8. *Rec: union — genuine backward-compat + useful to V6/agents; trim only if SA sees risk.*
- **D6 — `RepositoryResult` unification (G4).** Leave per-repo result types (rec, defer to monorepo) or unify opportunistically on repos touched in Task 1.1.

---

## 8. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| **Double-logging via triggers** (T8 etc.) | Executor delegates only; never emits activities/contacts. Guardrail unit + integration assertions (§6). |
| **`db_active` fails open** (security) | Resolver denies on `null` **and** error; base executor blocks `!eligible` even for `isSystem`; dedicated fail-closed test matrix. |
| **Regression in 20 existing plugins** from R1 | Strategy defaults infer `oauth`/`platform_key` exactly as today; only CRM opts into `db_active`; full existing-plugin smoke via build + a couple of representative executes. |
| **Step 1 changes alter query shape** (perf NFR) | Move queries verbatim into repo methods; add only shape-preserving aggregates; parity tests compare results. |
| **R8 blast radius** | Wire exactly one caller; everything else stays on repos (additive migration). |
| **Scope creep into Step 3 / selection** | R7 parked and documented as seam; no migration files; explicitly out of scope. |

---

## 9. Out of Scope / Follow-ups

Tracked separately (do not pull into the pilot): trigger→event-driven migration (Step 3); config-driven capability selection + `business_profiles.primary_*` wiring (R7); external CRM plugin + `license_tier` strategy (seams only); repo-wide ESLint/CI "no direct DB access" guard; `lib/business-os/insight/**` remediation + `CommandSessionRepository`/`InsightRepository` relocation; full-BOS repository sweep; non-CRM direct-access in the touched files (payments/scheduling tables).

---

## 10. Task Checklist

> **SA decisions folded in (see §11):** D1 keep read cluster IN (land last) · D2 investigate liveness first, remediate `ChatCommandExecutor` **in place** (no retire), wire R8 through the **live** surface · D3 standalone `AccessStrategyResolver` · D4 `db_active` = `business_profiles` row presence only (no `onboarding_completed`) · D5 full ~17-op union · D6 defer `RepositoryResult` unification. **Must-fix conditions C1–C4 + A2 are explicit tasks below.**

> **Implementation progress (2026-08-06):** Step 2 plugin core (R1–R6) + Task 1.1 done (type-clean). **D8** (CRM in the Form Tester) done + preview-verified. **D7** (plugin doc) done. Lean unit tests (19) green. **Remaining: P3 — Step 1 route remediation (1.2.a–d + C4) + R8** (the higher-risk live-code slice). Dev pausing here for a user checkpoint before touching live public routes.
>
> **Execution order / priority (decided 2026-08-06):**
> 1. **P1 — D8 (Form Tester CRM integration)** — do next. It's additive/low-risk (dev-only test page) and gives the user hands-on end-to-end verification of the plugin (db_active gate → executor → repos) *before* touching any live caller. Highest value now.
> 2. **P1 — Lean unit tests** — the two fast pure-unit files (§6). Alongside D8.
> 3. **P2 — D7 (plugin doc)** — low-risk documentation; write once the operation surface is exercised via D8 (so examples reflect real behavior).
> 4. **P3 — Step 1 route remediation (1.2.a–d + C4) + R8** — the higher-risk slice (live chat executor, public website intake). Do after the plugin is verified via D8, so a regression there is isolated from plugin bugs.
> 5. **Then** → QA (manual DB-backed checks per §6) → user approval → RM commit.

**Step 1**
- ✅ 1.1 Normalize `ContactDocumentsRepository` (constructor injection) + `CRMPipelineStagesRepository.reorder` error propagation (surface first error); did NOT unify `RepositoryResult` (D6)
- ✅ **A2** Verified all §4 target repo methods exist with compatible signatures (contact create/findById/list/count/update/updateStage/delete; task create/findById/list/countByStatus/update/complete/delete; activity create/getForContact/getRecent; stages list). **No net-new repo methods needed for Step 2** (read-cluster aggregates in 1.2.c are the only possible net-new)
- ✅ 1.2.0 Confirmed the live CRM chat surface: `app/api/business-os/chat/route.ts` imports `ChatCommandExecutor.executeIntent` → `ChatCommandExecutor` is canonical/live. Remediated in place (no retire).
- ✅ 1.2.a Remediated `ChatCommandExecutor.ts` **9 CRM sites** → CRM repositories (behavior-preserving). Added 2 shape-preserving repo methods: `CRMContactRepository.listBasic` + `CRMTaskRepository.getOverdueContactIds` (A2 net-new, listed in §5). Also closed a latent gap (a contact-by-id fetch that lacked `user_id` scoping now goes through `findById`). Type-clean (the 2 remaining `ChatCommandExecutor` TS errors — `is_free`:1078, `company`:2524 — are **pre-existing**, not introduced here).
- 🚧 **1.2.b BLOCKED → spun off** (task_dda5f400). The public website routes cannot be cleanly remediated: `forms/intake` writes **phantom** `crm_contacts.name`/`status` + `crm_activities.type` columns that don't exist in either migration (schema is `first_name`/`last_name`/`stage`, `activity_type`); the 3 booking routes write explicit `activity_type:'booking'` **and** insert `scheduling_bookings` (trigger **T2** double-log question). This is pre-existing data-model drift (+ duplicate `20260721`/`20260722` migrations) that needs a **BA/SA data-model decision** before repository routing — exactly the "tracked as separate tasks beyond the pilot" case. **C4** inventory folded into the spun-off task.
- 🚧 **1.2.c DEFERRED → spun off** (task_dda5f400, with 1.2.b). Read-only dashboards use real columns but need ~7 net-new shape-preserving aggregate repo methods, interleaved in `Promise.all` batches; low-risk reads, SA D1 "land last" → moved to the follow-up.
- ✅ 1.2.d Remediated `PaymentReminderService.ts` recipient lookup → `crmContactRepository.findById` (also adds the `user_id` scope the inline query had; type-clean after coercing the helper call sites).

**Step 2**
- ✅ R3 Added `access_strategy` (`PluginAccessStrategy`) to `PluginDefinition['plugin']` type
- ✅ R2 Relaxed `validatePluginDefinition` (accept `access_strategy` in place of full OAuth `auth_config`; assert `db_active` ⇒ `isSystem:true`)
- ✅ R1 Standalone `AccessStrategyResolver` (`lib/server/access-strategy.ts`) + `db_active` fail-closed + base-executor Step-2 rewire — incl. **C1/C2/C3**
- ✅ **C1** Base-executor Step 2 now takes the connection **from the resolver for all strategies**; the `isSystem` null short-circuit is removed; a denied strategy early-returns before `executeSpecificAction`; eligible `db_active` passes the resolver's virtual connection carrying `user_id`
- ✅ **C2** Resolver maps `!eligible` to strategy-specific codes: `oauth → auth_failed` (byte-identical message), `db_active → access_denied`
- ✅ **C3** `testConnection()` routed through `AccessStrategyResolver` (was a second un-refactored copy that misreported `db_active` tenants)
- ✅ R4 Authored `crm-plugin-v2.json` (17 ops, full `parameters`/`output_guidance`; `domain:"crm"`+`capability`; task `priority` enum `low|medium|high|urgent`; `access_strategy:db_active`; internal `auth_config` stub)
- ✅ R5 Authored `CRMPluginExecutor` (delegate-only; T8 guardrail — `create_contact`/`update_contact`/`move_stage` emit no activity, `log_activity` is the sole activity writer; `connection?.user_id` guard; A3 stage-validation off by default)
- ✅ R6 Registered in `corePluginFiles` + `executorRegistry`
- ✅ R8 (P3) Wired the live `ChatCommandExecutor` task-create through `PluginExecuterV2.execute(context.userId, CRM_PLUGIN_KEY, 'add_task', …)` — proves the internal plugin path end-to-end (db_active → `CRMPluginExecutor` → `crmTaskRepository`) from a real caller; `user_id` derived server-side from the resolved connection (not passed). `'crm'` centralized in one `CRM_PLUGIN_KEY` constant with a `// TODO(R7)` note. Other CRM sites stay on repositories (additive/gradual). Type-clean. *(Runtime note: this now requires the chat user to be an active `business_profiles` tenant — true for BOS chat users; QA to confirm the happy path.)*

**Added deliverables (per user, 2026-08-06)**
- ✅ **D9 — Plugin visibility scoping (Business-OS-only, hidden-by-default).** User flagged that `crm` (as `isSystem`) leaked into general plugin discovery (agent-creation LLM hints, V6 binder/vocabulary, `/api/plugins/available`). SA-validated design (corrected: do **not** filter `getAvailablePlugins()` — it's the compiler's by-key resolution primitive). Implemented: `plugin.visibility: 'public' | 'business_os'` (CRM = `business_os`) + `isPluginDiscoverable` predicate; gated the **5 discovery sites** (`getActionableSystemPlugins`, `/api/plugins/available`, `CapabilityBinderV2`, `PluginVocabularyExtractor`, agent-creation `process-message`) with opt-in; by-key resolution/execution untouched. Test page opts in (`?includeBusinessOs=true`). Documented in [PLUGIN_VISIBILITY_SCOPING.md](/docs/PLUGIN_VISIBILITY_SCOPING.md). Tests: `plugin-visibility.test.ts`. Type-check clean; 22 unit tests pass.

- ✅ **D8 (P1)** Added CRM to the `/test-plugins-v2` **Form Tester**: internal/`db_active` plugins are now connection-gate-exempt (full block only on missing `userId`; Google Suite keeps its all-five OAuth completeness gate), `crm` added to the selectable set via `INTERNAL_TESTER_PLUGIN_KEYS` (schema-generic, no CRM-specific form logic); destructive-confirm still applies to `delete_*`. **Verified in the running preview:** page renders (200, no console errors), `crm` shows in the Form Tester plugin dropdown, and `GET /api/plugins/action-schema?plugin=crm` returns all **17** actions with correct `domain`/`capability` metadata. *(Full click-through execution needs a logged-in active tenant → QA-manual.)*
  > **Superseded 2026-08-09:** CRM was given a **dedicated home** on `/test-business-os` (the new **Modules** tab). This `/test-plugins-v2` Form Tester integration was **reverted** (removed `INTERNAL_TESTER_PLUGIN_KEYS`, restored the Google-Suite-only gate) so the two test pages stay cleanly separated — external/OAuth plugins on `/test-plugins-v2`, internal BOS modules on `/test-business-os`. See [BUSINESS_OS_TEST_PAGE_SCOPE.md](/docs/BUSINESS_OS_TEST_PAGE_SCOPE.md) § Tab: Modules.
- ✅ **D7 (P2)** Authored [`docs/plugins/crm-plugin.md`](/docs/plugins/crm-plugin.md) — Overview → internal/`db_active` "no connection required" → Available Actions grouped (Contacts/Tasks/Activities/Pipeline) with params/returns/examples → "Automatic activities" note. Mirrors existing plugin-doc structure + docs standards.

**Verification (lean — see §6)**
- ✅ **P1** Unit: `access-strategy.test.ts` (fail-closed matrix + `oauth auth_failed`/`db_active access_denied`) + `crm-plugin-executor.test.ts` (dispatch + guardrail-by-construction). **19 tests pass, ~8s.** Pure, mocked, no DB.
- ⬜ QA-manual (via D8 Form Tester + DB inspection): no-double-logging guardrail; plugin↔repo parity; Step 1/R8 regression; **A1** V6 graceful-degrade on `access_denied`.
- 🟡 Build + lint + plugin-load smoke — **type-check clean** for all touched files; plugin-load verified live (action-schema 200 for `crm`). Full lint pass after Step 1.

---

## 11. SA Review

**Reviewed by SA — 2026-08-06**
**Status (initial pass):** 🔄 Revision Required (approve-with-changes) — the plan is architecturally sound and consistent with the feasibility review (feasible-with-bounded-refactoring). Proceed once the **must-fix** items C1–C4 below are folded into the tasks. The rest are decisions (D1–D6 resolved) and conditions. No fundamental rework; no escalation to TL.

**Status (re-review 2026-08-06):** ✅ **Approved — proceed to implementation.** Dev folded all conditions in as specified. Verified against the amended plan: **C1** (resolver = single connection source for all strategies; `isSystem` null short-circuit removed/superseded; denied `db_active` early-returns before `executeSpecificAction`; eligible → virtual connection w/ `user_id`) = §3 R1 line 123 + checklist 284; **C2** (`oauth→auth_failed` byte-identical / `db_active→access_denied`, both unit-asserted) = §3 R1 line 124 + checklist 285/293; **C3** (`testConnection` route-through-resolver or scope-out) = §3 R1 line 125 + checklist 286; **C4** (per-route trigger-ownership inventory + 1:1 field mapping + per-contact row-count parity) = §2 1.2.b line 95 + checklist 276/294; **A2** (verify §4 repo methods / list net-new before coding) = checklist 272; **A1** (V6 graceful-degrade on `access_denied`) = checklist 296. D1–D6 resolutions carried in the §10 header note; 1.2.c lands last; R8 = one live-surface op + centralized `'crm'` literal. No gaps. No second review needed.

Substrate re-verified against live code before signing: `base-plugin-executor.ts` (Step 2 = lines 84–110; `testConnection` = lines 285–324), `user-plugin-connections.ts` `getConnection` (lines 145–209, `platform_key` branch 147–167), `plugin-manager-v2.ts` `validatePluginDefinition` (lines 724–747), `BusinessProfileRepository.findByUserId` (lines 38–63), `CRMContactRepository.create` (pure `crm_contacts` insert, no activity write), `app/api/website/forms/intake/route.ts` (contact insert/update + one explicit `crm_activities` note, lines 131–229).

### Decisions on Open Items (§7)

- **D1 — Remediation boundary → KEEP the read cluster IN the pilot (approve Dev rec).** The Document 1 pilot gate is "no direct CRM `.from()` outside repositories"; leaving 4 read routes non-conformant fails that gate. It is genuinely low-risk (counts/selects). Land it as the final Step-1 sub-task (1.2.c last) so it never blocks the write-path work. Add only **shape-preserving** aggregates (`count*`/`list`), no N-call fan-out (NFR).
- **D2 — Canonical chat surface + R8 caller → investigate first (1.2.0), then wire the LIVE surface; do NOT retire anything in this pilot.** SA cannot bless a canonical surface from docs alone — 1.2.0 must resolve it by tracing `app/api/business-os/chat/route.ts`. Direction: (a) **remediate-in-place** `ChatCommandExecutor.ts` (it is imported by the live route) — retiring it is scope creep with real blast radius and is out of scope; (b) for **R8**, wire the caller that is actually on the live request path. Wiring `CapabilityEngine`/`SafeExecutionLayer` is an acceptable R8 proof **only if 1.2.0 confirms that surface is reachable in production** — otherwise it proves nothing. If the live surface is `ChatCommandExecutor`, wire **one** of its CRM ops (e.g. `add_task`) through `PluginExecuterV2.execute` as the R8 proof and leave the remaining sites remediated-to-repo. Bounds blast radius to one op.
- **D3 — R1 placement → standalone `AccessStrategyResolver` module (approve Dev rec).** Isolating the security-critical fail-closed branch in `lib/server/access-strategy.ts` makes it independently unit-testable and keeps `UserPluginConnections` from growing a second responsibility. Confirmed.
- **D4 — `db_active` = presence of a `business_profiles` row only (approve Dev rec).** `findByUserId` (BusinessProfileRepository.ts:38) is the right anchor and returns `{data:null,error:null}` for non-tenants. Do **not** add an `onboarding_completed` gate — it is stricter than Document 2's "user is active in the DB," and would lock out mid-onboarding tenants that the live chat/website paths already serve today (behavior regression). Note for the future: `findByUserId` does not filter any status column; if `business_profiles` ever gains a soft-delete/inactive flag, revisit the eligibility predicate. Presence-only is correct for v1.
- **D5 — Operation surface → full backward-compat union (~17 ops) (approve Dev rec), conditional on C4.** The union is justified (true backward-compat + V6/agent usefulness). Condition: every op ships with full `parameters`/`output_schema`/`output_guidance` (validator requires the first and third — manager-v2:741), and the `priority` enum is aligned to `CRMTaskRepository.TaskPriority` (`low|medium|high|urgent`) per the §4 note — do not drop `urgent`.
- **D6 — `RepositoryResult` unification → defer (approve Dev rec).** G4 is deferred to the monorepo per Document 1 Q3. Do not unify opportunistically in Task 1.1 — it widens the behavior-preserving surface for no pilot benefit. Keep per-repo result types.

### R1 `db_active` fail-closed — CONFIRMED, with two holes to close

The eligibility logic **fails closed correctly**: `findByUserId` returns `{data:null,error:null}` on no-profile (PGRST116, BusinessProfileRepository.ts:49–52) and `{data:null,error}` on any other failure (catch, line 59–62). The resolver's `eligible = (data != null && error == null)` denies on **both** null-data and error. Good. Keep the fail-closed unit matrix in §6.

**C1 (must-fix) — the base-executor change must REPLACE the connection, not just add a gate.** Today Step 2 (base-plugin-executor.ts:94–107) calls `getConnection(userId, name, authConfig)` then `if (!connection && !isSystemPlugin) → auth_failed`. For the CRM plugin `auth_config.auth_type` is `'internal'` (not `'platform_key'`), so the **existing** `getConnection` would skip the virtual-connection branch (user-plugin-connections.ts:147) and fall into the OAuth DB branch → `findActiveByUserAndPlugin` → `null`. Because `isSystem:true`, the null-guard is short-circuited and **`null` is passed to `executeSpecificAction`** (line 110). So R1 must make the resolver the **single source of the connection for all strategies**: on `db_active` eligible, `executeSpecificAction` must receive the resolver's **virtual connection carrying `user_id`** — not the legacy `getConnection` null. Confirm the refactor routes the `oauth`/`platform_key` connection through the same resolver return, and that the `!eligible` early-return happens **before** `executeSpecificAction` regardless of `isSystem` (the plan says this at R1 — make it explicit in code that the old `isSystem` short-circuit branch is removed/superseded, not left in parallel where a denied `db_active` could still reach line 110). The executor's `connection?.user_id` throw stays as defense-in-depth.

**C2 (must-fix) — preserve the `auth_failed` error contract for existing OAuth plugins.** Today a non-system OAuth plugin with no connection returns `error:'auth_failed'` with the "reconnect in Settings" message (lines 101–107). The resolver must map `!eligible` to a **strategy-specific reason**: `oauth → auth_failed` (byte-identical error code + message), `db_active → access_denied`. Do not collapse both to one generic code — any existing caller or test keying on `'auth_failed'` would regress. Add a unit assertion for the oauth `auth_failed` path alongside the db_active `access_denied` path.

**C3 (must-fix) — `testConnection()` is a second, un-refactored copy of the Step-2 resolution.** `testConnection` (base-plugin-executor.ts:299–307) calls `getConnection(userId, name, authConfig)` directly and returns `error:'no_connection'` when it is null. For the CRM plugin (`auth_type:'internal'`) that path returns null for **every** user, including valid tenants — so `testConnection('crm')` would always misreport "not connected." Either route `testConnection` through the same `AccessStrategyResolver`, or explicitly scope it out with a code comment stating db_active plugins don't use `testConnection`. R4's `performConnectionTest` override (R5) is cosmetic and does **not** fix this, because the null-connection early-return happens before `performConnectionTest` is reached. Pick one and state it in the plan.

### T8 no-double-logging guardrail — CONFIRMED

- **`create_contact`:** verified `CRMContactRepository.create` is a pure `crm_contacts` insert with no `crm_activities` write. So `create_contact → repo.create` fires DB trigger **T8 `contact_created` exactly once**, executor emits nothing. Correct.
- **`update_contact` / `move_stage`:** `update`/`updateStage` are pure `crm_contacts` updates — no activity. Correct. `log_activity` is the sole `crm_activities` writer. Correct. The §4 mapping and R5 guardrail language are right.
- **Website intake (1.2.b) — CONFIRMED the intent, with C4.** Verified `forms/intake/route.ts` today does: contact insert (fires T8 `contact_created`) **plus one explicit** `crm_activities` insert `type:'note'` "Intake Form Completed" (lines 214–229). Remediation must preserve **both** — `repo.create` (T8 auto) + `crmActivityRepository.create` (the note) — exactly one note row, no second emission. The plan states this correctly.

**C4 (must-fix) — per-route explicit-activity inventory vs trigger ownership before moving the website cluster.** The intake route's explicit activity is a `note` (not trigger-owned), so it is safe to preserve. But `booking/create`, `booking/confirm`, and `booking/finalize` also insert `crm_activities` **and** write `scheduling_bookings` — which fire trigger **T1/T2** (booking→contact/activity), and the payment/email paths fire **T3/T5**. Before moving any explicit `crm_activities` insert to `crmActivityRepository.create`, 1.2.b must inventory, **per route**, whether that activity is already trigger-owned. Moving a trigger-owned activity into an explicit `log_activity`-style repo call would **double-log** — the exact §2.5 trap, one layer over. Deliverable: a small table in the task (route → explicit activity → is it also produced by T1/T2/T3/T5? → keep/drop) verified against the DB trigger inventory, plus a parity assertion that post-remediation activity **row counts per contact are unchanged**. Also confirm `crmActivityRepository.create`'s field contract maps the raw insert 1:1 (the raw row uses `type`/`title`/`description`/`metadata`) so persisted rows are byte-identical.

### Standards / Fit

- **Repository pattern (rule #1):** reinforced — this is the point of the pilot. ✅
- **Pino (rule #3):** the new `access-strategy.ts` and `crm-plugin-executor.ts` must use `createLogger`, never `console.*`. The plan's §100 console/Pino note is correct — flag+convert any stray `console.*` in touched files on approval; don't reformat untouched files. ✅
- **No hardcoded plugin names in app code (rule #5 analog):** the R8 caller will pass the `'crm'` string literal to `PluginExecuterV2.execute` because R7 (capability resolver) is parked. Acceptable for v1 **only because R7 is explicitly deferred** — but centralize that literal in **one** constant at the R8 call site with a `// TODO(R7): route via capability resolver` comment, so we don't seed scattered plugin-name literals across future callers. `corePluginFiles`/`executorRegistry` additions remain platform authoring config (acceptable, unchanged). Minor.
- **Zod at route inputs (rule #2):** Step 1 is behavior-preserving DB-access remediation, not new input surface — do **not** expand scope to add Zod where it's missing. If a touched route already lacks input validation, note it as a follow-up, don't fix it here. ✅ (scoped out)
- **TS strict (rule #6):** base signatures use `any` (`connection`, `parameters`) — inherited, acceptable. The CRM executor should type its own param/return shapes where practical; the `connection?.user_id` guard is the load-bearing check — keep it explicit. ✅
- **Monorepo boundary:** CRM plugin = JSON + TS executor (no React); `access-strategy.ts` is server-only and depends downward on repositories (sanctioned direction `plugins → repositories → core`). ✅
- **RLS/security (rule #4):** `userId` is server-resolved and every repo call is `.eq('user_id', …)`-scoped; the plugin path must never drop `user_id` (executor reads it from the resolved connection). ✅ load-bearing — covered by C1.

### Additional risks / conditions (not blocking, track them)

- **A1 — `db_active` is enforced at execute time, not at capability listing / V6 binding.** Because `isSystem:true`, the CRM plugin will appear executable/bindable for **all** users; a non-tenant AgentPilot user could get `crm` bound by the V6 CapabilityBinder and only hit `access_denied` at execute. Acceptable for v1, but confirm the V6 binder/orchestrator **degrades gracefully** on an `access_denied` execution result (doesn't hard-fail the plan). Add one test. (Matches feasibility Q6 — set `provider_family`/`domain`/`capability` deliberately.)
- **A2 — §4 assumes repo methods already exist with compatible signatures** (`updateStage`, `countByStatus`, `getOverdue`, `crmActivityRepository.getForContact`/`getRecent`, `crmPipelineStagesRepository.list`). Fold a verification pass into Task 1.1: confirm each §4 target method exists with a compatible signature; any missing method is **net-new shape-preserving repo code** and must be listed explicitly in §5 Files Touched, not discovered mid-implementation.
- **A3 — `move_stage` optional stage-validation** adds a read and could **reject a stage the old `booking/finalize` path accepted** (it resolves stages differently today). Keep validation **off by default** for the backward-compat path, or prove parity against the existing resolution before enabling. Minor.

### Approval

[x] **Workplan approved — proceed to implementation (SA, 2026-08-06 re-review).** C1–C4 + A2 + A1 are folded into §2/§3/§10 exactly as specified; D1–D6 resolved. A1/A3 remain as tracked conditions to satisfy during implementation (A3: keep `move_stage` stage-validation off by default for the backward-compat path). Code review (Phase 2) follows Dev's implementation-complete.

---

## 12. QA Report

**QA — 2026-08-07**
**Test mode:** full (in-scope slice only)
**Strategy used:** A (Jest unit — the 3 in-build files) + code review / static verification for the paths that need a live tenant (Strategy E-style analysis where a DB run was not possible)
**Focus:** api / security / schema — CRM internal plugin, `db_active` fail-closed access strategy, Step-1 repo remediation, visibility scoping
**Skipped:** live DB / logged-in-tenant execution (no seeded active tenant available in this session — routed to manual/user verification, see below); OUT-OF-SCOPE items (website intake ×5 `1.2.b`, read dashboards/cron ×4 `1.2.c`) not tested per task brief
**Input source:** prompt keywords + workplan §6 Verification Plan + §10 checklist

### What I ran

`npx jest lib/server/access-strategy.test.ts lib/server/crm-plugin-executor.test.ts lib/plugins/plugin-visibility.test.ts`

```
Test Suites: 3 passed, 3 total
Tests:       22 passed, 22 total
Time:        ~6.2 s
```

All green. The fail-closed denial logs (`db_active access denied (fail-closed)` for no-tenant and lookup-error; `license_tier ... not implemented`) print via Pino as expected — no `console.*`.

### Test Coverage

| Acceptance Criterion (from §6 / §10) | Tested? | Result | Notes |
|---|---|---|---|
| Unit: `access-strategy.test.ts` fail-closed matrix + `oauth auth_failed` / `db_active access_denied` (C2) | ✅ | Pass | 6 cases: eligible tenant, no-row → `access_denied`/`no_active_tenant`, lookup error → `access_denied`/`lookup_error`, oauth no-connection → `auth_failed`, oauth connected → eligible, `license_tier` → `access_strategy_unavailable` |
| Unit: `crm-plugin-executor.test.ts` dispatch + `user_id` scoping + T8 guardrail-by-construction | ✅ | Pass | dispatch for representative ops, missing `user_id` → throws `access_denied`, repo-error propagation, unknown action rejected |
| T8 no-double-logging: `create_contact`/`update_contact`/`move_stage` emit NO activity; `log_activity` sole writer | ✅ (static + unit) | Pass | Confirmed by reading executor: `crmActivityRepository` is referenced only by `log_activity` (`.create`) and `list_activities` (`.getForContact`) — executor lines 180/195. Test asserts `activityRepo.create` not called for the 3 mutating ops and exactly once for `log_activity` |
| `access-strategy.ts` genuinely fails closed (deny on null data AND error; no eligible-on-error path) | ✅ (static + unit) | Pass | `resolveDbActive` (lines 138–164): `if (error \|\| !data) → eligible:false`. Only the `data != null && error == null` path issues a virtual connection. `license_tier` and missing-`authConfig` both fail closed too |
| Base-executor C1 (resolver = single connection source; `isSystem` short-circuit removed; denied early-return before `executeSpecificAction`) | ✅ (static) | Pass | base-plugin-executor.ts:103–120: resolver called for every strategy; `!resolution.eligible` returns before line 125; eligible passes `resolution.connection` (virtual, carries `user_id`) |
| C3 `testConnection` routed through resolver | ✅ (static) | Pass | base-plugin-executor.ts:318–328 now resolves via `accessResolver` instead of `getConnection` directly |
| Step-1 1.2.a: no CRM `.from('crm_...')` remains in `ChatCommandExecutor.ts` | ✅ (static) | Pass (with 1 out-of-scope note) | No `.from('crm_*')` remains. The only residual `crm_contacts` refs (lines 3386, 3438) are a nested join inside a `.from('payment_invoices')` query — payments table, explicitly out of CRM scope |
| Step-1 1.2.d: no CRM `.from()` in `PaymentReminderService.ts` | ✅ (static) | Pass | Recipient lookup now `crmContactRepository.findById(contactId, userId)`; all remaining `.from()` are `payment_*` / `business_profiles` (non-CRM) |
| 1.2.a behavior-preservation (columns / limit / option mapping / output shapes) | ✅ (static, diff review) | Pass (2 negligible nuances) | See "Behavior-preservation review" below |
| Registration: `corePluginFiles` + `executorRegistry` + relaxed `validatePluginDefinition` (`db_active ⇒ isSystem`) | ✅ (static) | Pass | manager-v2:35/746/752; executer-v2:64 |
| CRM plugin definition: 17 ops, `visibility:business_os`, `access_strategy:db_active`, `isSystem:true`, `priority` enum includes `urgent` | ✅ (static) | Pass | `python -c json` → 17 actions; priority enum `low\|medium\|high\|urgent` in add_task/list_tasks/update_task |
| Visibility scoping: `business_os` hidden by default at the 5 discovery sites; opt-in works; `getAvailablePlugins()` NOT filtered | ✅ (static + unit) | Pass | `getActionableSystemPlugins` (default `includeBusinessOs=false`), `/api/plugins/available` (query-param opt-in), `CapabilityBinderV2` (by-key `allowedBusinessOsKeys`), `PluginVocabularyExtractor` (by-key `requestedServices`), agent-creation `process-message` (hard `false`). `plugin-visibility.test.ts` green |
| End-to-end CRM op execution vs `db_active` gate (Form Tester) | ⚠️ | For manual/user verification | No seeded active tenant in this session |
| No-double-logging DB row-count parity (per contact) | ⚠️ | For manual/user verification | Requires live DB inspection of `crm_activities` |
| R8 live chat `add_task` write end-to-end (db_active happy path) | ⚠️ | For manual/user verification | Requires a logged-in BOS chat tenant |
| A1: V6 binder/orchestrator degrades gracefully on `access_denied` | ⚠️ | For manual/user verification | Not unit-covered; runtime behavior check |

### Behavior-preservation review (1.2.a — `ChatCommandExecutor.ts` diff)

Reviewed the full diff against the new repo methods (`CRMContactRepository.listBasic`:446, `CRMTaskRepository.getOverdueContactIds`:303, `CRMTaskRepository.list`:156). Findings:

- **Column selection** — `listBasic` selects `id, first_name, last_name, email, phone, stage` (a superset of each original inline select); every remediated call site then maps down to the exact prior output shape. Output payloads to the client are unchanged apart from acceptable `null → undefined` coercions. ✅
- **No-limit vs limited semantics** — preserved: the two originally-unbounded fetches (`executeBookingCreate` contact load) call `listBasic` with no `limit`; the bounded ones pass the same `limit` (10 / `entities.limit || 10` / 1). ✅
- **Task-list all-statuses default** — the original applied **no** status filter when `status` was unrecognized/absent (returns every status). The remediation sets `include_completed:true` in that branch, and repo `list` (line 192) only applies the default `pending/in_progress` restriction when `!status && !include_completed` — so the "all statuses" semantics are correctly preserved. `status==='completed'` maps to `status:'completed'` (repo applies `.eq`, default restriction bypassed). ✅
- **`getOverdueContactIds`** reproduces the original inline `crm_tasks` select (`contact_id`, `due_date < now`, `status in [pending,in_progress]`, dedup) 1:1. ✅
- **R8 `add_task`** through `PluginExecuterV2.execute(userId, 'crm', 'add_task', …)` maps the same fields the original insert wrote (`title/contact_id/due_date/status:'pending'/priority`); `user_id` is server-derived from the resolved connection (not passed). `CRM_PLUGIN_KEY` centralized with the `// TODO(R7)` note. ✅

### Issues Found

#### Bugs (must fix before commit)
None. No High-severity defects in the in-scope work.

#### Performance Issues (should fix)
None observed. Remediated reads preserve query shape (no added round-trips); `listBasic` adds two harmless columns to already-single-round-trip selects.

#### Edge Cases / Notes (nice to know — not blocking)
1. **`.lt` → `.lte` boundary shift (Low).** `CRMTaskRepository.list` filters `due_before` with `.lte('due_date', due_before)` (line 204), whereas the original `ChatCommandExecutor` overdue/upcoming queries used `.lt('due_date', now/tomorrow/nextWeek)`. A task due at *exactly* the boundary millisecond would now be included where it previously wasn't. Effectively unreachable (`now` is a fresh timestamp) — flagging for completeness only. File: `lib/repositories/CRMTaskRepository.ts:204`.
2. **Security improvement that is technically a behavior change (informational).** The `executeBookingCreate` full-contact fetch (`ChatCommandExecutor.ts:1964`) previously did `.eq('id', …).single()` with **no `user_id` scope**; it now goes through `crmContactRepository.findById(id, userId)`. A contact not owned by the caller would now resolve to `null` instead of leaking. Benign in practice (the id comes from a user-scoped match list) and a genuine RLS-hygiene win. No action needed.
3. **R8 runtime gate change (verify manually — Medium importance).** Routing chat `add_task` through the plugin means task creation in chat now requires the user to be an active `business_profiles` tenant (`db_active`). A chat user *without* a `business_profiles` row who could previously create a task would now receive `access_denied`. The workplan asserts BOS chat users are always tenants — **this assumption must be confirmed in the manual happy-path run** before relying on it in production.
4. **Residual direct CRM read via cross-table join (out of scope — note only).** `executeInvoiceQuery` (`ChatCommandExecutor.ts:3382–3388`) still reads `crm_contacts` through a nested select on `.from('payment_invoices')`. This is a payments-primary query (out of CRM scope per the task brief and §9), so it is correctly left untouched — but the "no direct CRM `.from()` access" goal is not 100% for embedded joins. Belongs to the spun-off data-model task, not this pilot.

### Requires manual / user verification (could not run — no live DB or logged-in tenant this session)
- Execute each CRM op from the D8 Form Tester against a **seeded active tenant** → success payloads; a **non-tenant** `userId` → `access_denied`.
- **No-double-logging parity:** after `create_contact`, `crm_activities` has **exactly one** `contact_created` row (trigger T8's); `update_contact`/`move_stage` add none; `log_activity` adds exactly one — per-contact row-count parity.
- **R8 chat write:** create a task via the live BOS chat and confirm the `db_active → CRMPluginExecutor → crmTaskRepository` happy path succeeds for a real tenant (see Note 3).
- **A1:** confirm the V6 binder/orchestrator degrades gracefully (does not hard-fail a plan) when a CRM execution returns `access_denied`.

### Test Outputs / Logs
```
PASS lib/plugins/plugin-visibility.test.ts
PASS lib/server/access-strategy.test.ts
PASS lib/server/crm-plugin-executor.test.ts
Test Suites: 3 passed, 3 total
Tests:       22 passed, 22 total
```

### Final Status
- [x] **PASS-WITH-NOTES** — all in-scope, unit-testable and statically-verifiable work is correct: 22/22 unit tests green; T8 guardrail and `db_active` fail-closed behavior confirmed by construction; Step-1 1.2.a/1.2.d remediation is behavior-preserving with no CRM `.from('crm_*')` remaining; visibility scoping gated at all 5 discovery sites with by-key resolution untouched. No High-severity bugs. Notes 1–2 & 4 are informational/out-of-scope; **Note 3 (R8 tenant gate) plus the four DB-dependent checks above require the user's manual test-page / live-tenant run** before commit, exactly as the §6 lean-test policy anticipated.
- [ ] No blocking issues for Dev to address; the outstanding items are manual verifications for the user, not code fixes.

---

## 13. Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-08-06 | Initial workplan | Dev authored the CRM internal-plugin pilot workplan (Step 1 CRM repository conformance + Step 2 internal CRM plugin R1–R6/R8; R7 parked, Step 3 out of scope). Grounded in a full CRM data-access + capability-surface audit. Includes app→plugin operation mapping, T8 no-double-logging guardrail, `db_active` fail-closed design, verification/parity plan, and 6 open decisions for SA. |
| 2026-08-06 | SA review + Dev amendment | SA verdict: approve-with-changes (D1–D6 resolved; C1–C4 must-fix; A1–A3 tracked). Dev folded the resolved decisions and C1 (resolver = single connection source, supersede `isSystem` short-circuit), C2 (`oauth→auth_failed` / `db_active→access_denied`), C3 (`testConnection` route/scope), C4 (per-route explicit-activity-vs-trigger inventory + row-count parity), and A1/A2 into §3, §2 (1.2.b), R8, and the §10 checklist. Awaiting SA sign-off on the amended checklist. |
| 2026-08-06 | SA sign-off + implementation of Step 2 core | SA checked the approval box (no second full review needed). Dev implemented R1–R6 + Task 1.1 (A2 verified); type-check clean for all touched files. |
| 2026-08-06 | User review + 2 added deliverables | User reviewed the plugin core (approved). Added **D7** (CRM plugin doc) and **D8** (CRM in the `/test-plugins-v2` Form Tester UI), set the execution order/priority (D8 + lean tests first → D7 → Step 1 remediation + R8 → QA), and tightened the test policy to lean pure-unit-only in-build with DB-backed verification done manually by QA via the Form Tester. |
| 2026-08-06 | Implemented D8, D7, lean tests | D8: internal plugins connection-gate-exempt in the Form Tester (`INTERNAL_TESTER_PLUGIN_KEYS`), `crm` selectable; preview-verified (page 200, `crm` in dropdown, action-schema returns 17 CRM actions). D7: authored `docs/plugins/crm-plugin.md`. Tests: `access-strategy.test.ts` + `crm-plugin-executor.test.ts` — 19 pass (~8s), pure/mocked. All touched files type-check clean. Remaining: Step 1 route remediation (P3) + R8. |
| 2026-08-06 | D9 plugin visibility scoping | User flagged CRM leaking into general plugin discovery. SA-reviewed + corrected the design (keep `getAvailablePlugins()` unfiltered — it's the by-key resolution primitive; gate only the 5 true discovery surfaces). Documented in `docs/PLUGIN_VISIBILITY_SCOPING.md` and implemented: `plugin.visibility` enum, `isPluginDiscoverable` predicate, gating at `getActionableSystemPlugins`/`/api/plugins/available`/`CapabilityBinderV2`/`PluginVocabularyExtractor`/agent-creation `process-message`, test-page opt-in. 22 unit tests pass; type-check clean. |
| 2026-08-09 | Dedicated BOS Modules test tab + D8 revert | Added a **Modules** tab to `/test-business-os` (session-based; `BosModuleTester` reusing the schema-form builders; reuses existing endpoints only — Option A) as CRM's dedicated tester home. Reverted the earlier **D8** integration of CRM into the `/test-plugins-v2` Form Tester (removed `INTERNAL_TESTER_PLUGIN_KEYS`, restored the Google-Suite-only gate) so external-OAuth vs internal-BOS test surfaces stay separated. Added `visibility` to `/api/plugins/available` response + `PluginInfo.visibility?`. SA APPROVE, QA PASS-WITH-NOTES (72/72 helper tests). |
| 2026-08-06 | Step 1 (partial) + R8 | Remediated the safe/live CRM data-access: 1.2.a `ChatCommandExecutor` (9 sites → repos; +2 shape-preserving repo methods; closed a missing-`user_id` gap) and 1.2.d `PaymentReminderService`. R8: wired `ChatCommandExecutor` task-create through the internal CRM plugin (`add_task`). **1.2.b (website intake ×5) blocked** by pre-existing data-model drift (phantom `crm_contacts.name`/`status` + `crm_activities.type` columns; booking-route/T2 double-log question; duplicate migrations) and **1.2.c (read dashboards ×4)** deferred (needs ~7 net-new aggregate methods) — both spun off as a BA/SA data-model reconciliation task (task_dda5f400). All in-scope changes type-clean (2 remaining `ChatCommandExecutor` TS errors are pre-existing); 22 unit tests pass. |
