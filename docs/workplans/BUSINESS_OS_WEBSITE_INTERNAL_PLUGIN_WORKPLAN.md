# Business OS — Website Internal Plugin Workplan

> **Last Updated**: 2026-08-10
> **Module**: Website (#6 in the [module roadmap](/docs/workplans/BUSINESS_OS_MODULE_PLUGINS_ROADMAP.md))
> **Status**: 🟢 **Implemented → SA code-review APPROVE (§9.2) → QA PASS (§10), no bugs.** Awaiting user code review before RM (RM held).
> **RM**: Held (same "hold RM until user reviews code" gate as CRM/Scheduling/Payments/Intake).

## Overview

Convert the Business OS **Website** module into an internal, repository-backed V2 plugin, following the pattern proven on CRM, Scheduling, Payments, and Intake: a repository-delegating executor extending `BasePluginExecutor`, `access_strategy: db_active` (fail-closed), `visibility: business_os`, `isSystem: true`, registered in `corePluginFiles` + `executorRegistry`, surfaced automatically in the `/test-business-os` **Modules** tab.

Website is **content management** — a large op surface with lower agent-invocation value than the prior modules. Two things shape this workplan:

1. **G3 (the core work):** `website_blocks` has **no `user_id` column** — a block's owner is only reachable via `page_id → website_pages.user_id`, enforced in the DB by RLS. Internal plugins run through `supabaseServer` (**service role → RLS bypassed**), so the executor is the **sole tenant-isolation boundary**. Every block op must verify page ownership before delegating. We fix this with **Option A — an executor-level ownership pre-check** using the user-scoped `WebsitePageRepository.findById(pageId, userId)` (the exact pattern the existing REST route `pages/[id]/blocks/[blockId]/route.ts:83-98` already uses).
2. **Trim the surface:** expose a lean, high-value v1 op set and leave editor-grade plumbing (reorder, bulkCreate, capability_config, content-section CRUD, domain setters, templates, upload) to the REST/UI layer.

Favorable: **no cross-capability triggers** on any website table (only `updated_at` bumps — cleanest trigger picture of the initiative); Page/Content/Analytics repos are already clean and `user_id`-scoped; nothing is capability-wired, so (like Intake) the plugin + Modules tab is the first executable surface and **no `SafeExecutionLayer` wiring is needed**.

## Table of Contents

1. [Scope](#1-scope)
2. [Assessment findings (Step 0 baseline)](#2-assessment-findings-step-0-baseline)
3. [Step 0 — Remediation](#3-step-0--remediation)
4. [Step 2 — Build the internal plugin](#4-step-2--build-the-internal-plugin)
5. [Guardrails](#5-guardrails)
6. [test-business-os Modules tab](#6-test-business-os-modules-tab)
7. [Open issues seeded to the roadmap](#7-open-issues-seeded-to-the-roadmap)
8. [Lean-test policy](#8-lean-test-policy)
9. [SA review](#9-sa-review)
10. [QA report](#10-qa-report)

---

## 1. Scope

### In scope (v1 — ~11 ops, pure repo delegation behind ownership checks)

| Group | Ops | Repo method | Ownership check |
|---|---|---|---|
| Pages | `list_pages` | `listByUser(userId)` | user-scoped repo (direct) |
| | `get_page` | `findById(id, userId)` | user-scoped repo (direct) |
| | `create_page` | `create({ user_id, … })` | **M1: explicit field allow-list** (never raw params) |
| | `update_page` | `update(id, userId, updates)` | **M1: explicit field allow-list** (never raw params) |
| | `publish_page` | `publish(id, userId)` | user-scoped repo (direct) |
| | `unpublish_page` | `unpublish(id, userId)` | user-scoped repo (direct) |
| Blocks | `list_blocks` | `findByPageId(pageId, …)` | **Option A: `assertPageOwned(pageId, userId)`** |
| | `toggle_block` | `toggleEnabled(blockId, enabled)` | **Option A: `resolveBlockOwnedPage(blockId, userId)`** |
| | `update_block_content` | `updateContent(blockId, content)` | **Option A: `resolveBlockOwnedPage(blockId, userId)`** |
| Analytics | `get_analytics_summary` | `getSummary(userId, subdomain?)` | user-scoped repo (direct) |
| | `get_page_analytics` | `getPageSummary(pageId, userId)` | user-scoped repo (direct) |

### Out of scope (v1 — REST/UI keep them)

- **Block editor plumbing:** `reorder` / `moveBlock` (needs an ordered id list — awkward for an agent — and depends on the **phantom** `clear_block_positions` RPC → slow fallback), `bulkCreate` (accepts mixed `page_id`s — multi-page ownership hazard), `create`/`delete` single block, `updateCapabilityConfig` (editor-grade capability wiring), `findByType`/`findByCapability`.
- **Content-section CRUD** (`WebsiteContentRepository` get/update/replace/multi-section + `syncServicesFromScheduling`) — overlaps confusingly with block content; defer.
- **Hosting/domain:** `setSubdomain` / `setCustomDomain` / `verifyCustomDomain`, `checkSubdomainAvailable` / `generateSubdomain` (RPCs), template application, upload.
- **Destructive page ops:** `archive_page` / `delete_page` — **both kept out of the agent surface for v1** (M3, SA-confirmed); the UI handles deletion/archival. (`delete` is hard; `archive` renames the slug — neither belongs on the agent surface yet.)
- **Public read/render + cross-module routes** (`public/[subdomain]`, `booking/*`, `checkout`, `forms/*`) — unauthenticated/other-module leaves, untouched.

### G3 fix approach — Option A (executor-level), with B/C deferred

- **Option A (this workplan):** the executor owns tenant isolation for blocks — no schema change, no change to the shared repo or its other callers. Two helpers (see §4.2).
- **Deferred follow-ups (roadmap):** **B** — thread `userId` through `WebsiteBlockRepository` and filter via the parent page (fixes the repo for *all* callers, larger blast radius); **C** — denormalize `user_id` onto `website_blocks` (migration + backfill + sync trigger, most robust). Note in the roadmap that Option A leaves the repo itself still-unscoped for non-plugin callers (they already do their own page pre-checks — verified).

---

## 2. Assessment findings (Step 0 baseline)

Read-only assessment, 2026-08-10 (full detail in the roadmap Website section).

- **Repos (4):** all constructor-DI, `{data,error}`, Pino, singleton getters.
  - `WebsitePageRepository` — **the ownership oracle**; all mutating/reading methods `user_id`-scoped (`findById(id,userId)` :109); only the by-subdomain/custom-domain lookups are intentionally public. `archive` = soft, `delete` = hard.
  - `WebsiteBlockRepository` — **G3**: no `user_id` column; id-only methods (`findById`/`update`/`updateContent`/`toggleEnabled`/`delete`/`updateCapabilityConfig`) and page-scoped-trusting methods. All deletes hard (page CASCADE).
  - `WebsiteContentRepository` — one JSONB row/user, all methods `user_id`-scoped ✅.
  - `WebsiteAnalyticsRepository` — reads `user_id`-scoped ✅; **2 stray `console.log`** in `getSummary` (`:154`,`:242`).
- **Triggers:** only `updated_at` bumps on `website_pages`/`website_content`; **none** on `website_blocks` (no `updated_at`) or `website_page_views`. No cross-capability side-effects. Publishing = plain `status='live'` update.
- **RPCs:** `check_subdomain_available`/`generate_subdomain` real; **`clear_block_positions` is phantom** (not in any migration) → `reorder` uses a slow fallback.
- **Direct DB outside repos:** only cross-module/public routes (booking/checkout/forms/stats read `website_pages` directly); the four target tables' management routes go through repos. `app/api/website/booking/intake/route.ts:93` is the only non-repo `website_blocks` read. Known phantom-column writer `website/forms/intake/route.ts` = **CRM task_dda5f400** (note only).
- **Capability wiring:** **no `website` capability** in `capabilities-schema.ts`; **no** `SafeExecutionLayer` reference. First executable surface (like Intake). The only existing chat surface is the standalone regex `WebsiteActionHandler` (parallel, not wired through the capability layer).
- **Domain:** `web` exists (`intent-schema-types.ts:42`).

---

## 3. Step 0 — Remediation

| # | Item | Action | Risk |
|---|---|---|---|
| **W0.1** | Analytics `console.log` (M-standard) | `get_analytics_summary` delegates to `getSummary`, so we touch that path — convert the 2 `console.log` (`WebsiteAnalyticsRepository.ts:154,242`) to Pino `logger.*`, and **trim the `:154` full-row payload** (M4 — don't log entire rows). Flag to user before converting (CLAUDE.md). | 🟢 Logging standard. |
| **W0.2** | Repo singleton caching (R5) | The executor must instantiate `new WebsitePageRepository(supabaseServer)` / `new WebsiteBlockRepository(supabaseServer)` / `new WebsiteAnalyticsRepository(supabaseServer)` directly — **not** the `get*Repository()` caching getter (which pins the first-injected client). Mirror the REST routes. | 🟢 Correctness. |

> No trigger reconciliation needed (none exist). No DI refactor needed (all four repos already DI). No dead-code prune in this workplan (`WebsiteActionHandler` retirement is a separate follow-up — R6).

---

## 4. Step 2 — Build the internal plugin

### 4.1 Definition — `lib/plugins/definitions/website-plugin-v2.json`

- `key: "website"`, `isSystem: true`, `visibility: "business_os"`, `access_strategy: { type: "db_active" }`, `domain: "web"`, internal `auth_config` stub.
- **11 actions** (§1), each with `description`, `parameters`, **and `output_guidance`**. Validate `db_active ⇒ isSystem`.

### 4.2 Executor — `lib/server/website-plugin-executor.ts`

- `WebsitePluginExecutor extends BasePluginExecutor`; `executeSpecificAction(connection, actionName, parameters)` reads `userId = connection?.user_id` (throw `access_denied` if missing).
- Instantiate repos directly with `supabaseServer` (W0.2). Import the three repo classes + (no CRM/etc.). Content-repo not imported in v1.
- **🔒 G3 Option-A ownership helpers (load-bearing):**
  - `assertPageOwned(pageId, userId)` → `websitePageRepository.findById(pageId, userId)`; **branch on `!data`** → throw `access_denied`. **(M2)** `findById` uses `.single()`, so a not-owned/not-found page returns `{ data: null, error: <PGRST116> }` — the guard must treat **both** a non-null `error` and a null `data` as not-owned and fail closed; do **not** pipe it through a rethrowing `unwrap` (that would surface a raw 500 instead of `access_denied`). Used by `list_blocks` and any page-param op.
  - `resolveBlockOwnedPage(blockId, userId)` → `websiteBlockRepository.findById(blockId)` to read its `page_id`; if no block (or error) → `access_denied`; then `assertPageOwned(block.page_id, userId)`; return the block. Used by `toggle_block` / `update_block_content` (the id-only block ops) **before** the mutating call. The id-only mutations write strictly by block id and never reassign `page_id`, so there's no cross-page TOCTOU.
  - Every ownership miss is **fail-closed** (`access_denied`), never a silent pass.
- **🔒 M1 — page ops use explicit field allow-lists (MEDIUM · security).** The block cross-tenant lesson applies to **pages** too. `WebsitePageRepository.update(id, userId, updates)` applies `updates` as the SET clause under `.eq('user_id', userId)` (`WebsitePageRepository.ts:304-321`), and `parameters` is `any` — so forwarding raw `params` as `updates` would let a caller inject `user_id: '<other-tenant>'` (**giving their own page away**), or `status`/`published`/`custom_domain_verified`. And `create(page)` inserts the object directly (`:287-297`) — a raw forward could inject `id`, `custom_domain_verified: true`, or `status: 'live'`. **Fix:** `update_page` and `create_page` build the payload from an **explicit allow-list** (e.g. `title`, `slug`, `page_type`, `content`/SEO/theme fields — the editable set), with `user_id` **always** the authenticated id and never taken from `params`; `id` never from `params` on create. Mirror `IntakePluginExecutor.updateSettings` (`intake-plugin-executor.ts:137-141`).
- Page/analytics ops delegate to the already-user-scoped repo methods directly (pass `userId`).
- **Delegate-only:** no triggers to avoid; publishing is a plain `publish(id,userId)` repo call (keeps `status` + legacy `published` in sync — R7 handled inside the repo).

### 4.3 Register

- Add `'website-plugin-v2.json'` to `corePluginFiles` (`plugin-manager-v2.ts`); add `'website': WebsitePluginExecutor` to `executorRegistry` (`plugin-executer-v2.ts`).

### 4.4 P4 — real-caller wiring

**N/A** (like Intake) — no capability-layer caller exists. Do **not** wire `capabilities-schema.ts` / `SafeExecutionLayer`, and do **not** touch `WebsiteActionHandler` (the parallel regex surface — retirement is a deferred follow-up, R6). The plugin + Modules tab is the first executable surface.

### 4.5 Tests (lean — see §8)

`lib/server/website-plugin-executor.test.ts` — fast pure unit tests with `jest.mock`ed website repos: dispatch table, missing-`userId` throws, and:
- **G3 block ownership (required):** `list_blocks` with a `pageId` the user doesn't own (`findById(pageId,userId)` → `{data:null}`) → `access_denied`, `findByPageId` never called; `toggle_block` / `update_block_content` with a `blockId` whose page the user doesn't own → `access_denied` **before** the mutating call (assert `toggleEnabled`/`updateContent` not called); `toggle_block` with a non-existent `blockId` → `access_denied`; the ownership guard treats a PGRST116 `{data:null,error}` as not-owned (M2).
- **M1 page allow-list (required):** `update_page` / `create_page` with a `params.user_id: 'ATTACKER'` (and `params.id` / `params.status` on create) asserts the repo receives the authenticated `userId` and a payload with **none** of the injected fields.
- page/analytics ops pass the authenticated `userId` through; param guards.

---

## 5. Guardrails

- **🔒 Service role bypasses RLS (R4).** The executor is the *sole* tenant boundary for blocks — every block op runs Option-A ownership resolution and fails closed. Page/content/analytics ops use the user-scoped repo methods directly.
- **🔒 Explicit allow-lists (M1).** `create_page` / `update_page` build their payload field-by-field — raw `params` is never forwarded — so no caller can inject `user_id` (page hand-off), `id`, `status`, `published`, or `custom_domain_verified`.
- **No caller-supplied identity.** `userId` always from `connection.user_id`; never from `params`. `create_page` sets `user_id: userId`.
- **db_active fail-closed** — no `business_profiles` row / lookup error → `access_denied`.
- **business_os visibility** — hidden from the 5 discovery sites; resolvable by key.
- **No side-effects to delegate** — website tables have no cross-capability triggers.
- **Deferred hazards not exposed in v1:** `reorder` (phantom RPC + ordered-list), `bulkCreate` (multi-page), `delete_page` (hard delete) — kept out of the agent surface.

---

## 6. test-business-os Modules tab

No new work — the Modules tab auto-lists any `visibility: business_os` plugin. **Verification** (QA / user manual, needs dev-server restart): Website appears in the Modules tab; `list_pages` / `get_page` round-trip; `publish_page` flips status to `live`; `list_blocks` for an owned page returns blocks; **the G3 guard — `toggle_block` / `list_blocks` against a page id owned by a *different* tenant returns `access_denied`.**

---

## 7. Open issues seeded to the roadmap

Recorded in the roadmap Website section: G3 (Option A here; B/C deferred), trimmed op surface (deferred ops), phantom `clear_block_positions` RPC, `bulkCreate` multi-page, singleton caching, `WebsiteActionHandler` parallel-surface retirement, dual publish flags, analytics `console.log`.

---

## 8. Lean-test policy

Only fast **pure mocked unit tests** run in-build (executor dispatch + the G3 ownership guards). DB-backed behaviour (real publish, analytics rollups, cross-tenant guard end-to-end) is **QA-manual** — same policy as the prior modules.

---

## 8a. Implementation notes (Dev)

**Date:** 2026-08-11 · **Branch:** `docs/business-os-event-driven-architecture` · RM held (no commit).

### Files created
| File | Purpose |
|---|---|
| `lib/plugins/definitions/website-plugin-v2.json` | Plugin definition — key `website`, `isSystem:true`, `visibility:business_os`, `access_strategy:{type:"db_active"}`, `domain:"web"`, internal `auth_config` stub. Exactly **11 actions**, each with `description` + `parameters` + `output_guidance`. |
| `lib/server/website-plugin-executor.ts` | `WebsitePluginExecutor extends BasePluginExecutor` — repo-delegating executor with the G3 ownership helpers + M1 page allow-lists. |
| `lib/server/website-plugin-executor.test.ts` | 22 pure mocked unit tests (dispatch, G3 block ownership, M1 allow-lists, analytics, guards). |

### Files modified
| File | Change |
|---|---|
| `lib/repositories/WebsiteAnalyticsRepository.ts` | **W0.1/M4** — converted the 2 `console.log` (`:154`, `:242`) to `logger.debug`; trimmed the `:154` full-row payload to `{ recordCount, userId, subdomain }` (no row bodies); `:242` logs counts only (`totalViews`/`uniqueVisitors` + userId/subdomain). |
| `lib/server/plugin-manager-v2.ts` | Added `'website-plugin-v2.json'` to `corePluginFiles`. |
| `lib/server/plugin-executer-v2.ts` | Imported + registered `'website': WebsitePluginExecutor` in `executorRegistry`. |

### How M1–M5 + G3 were handled
- **G3 (Option A):** `assertPageOwned(pageId,userId)` calls `pageRepo.findById(pageId,userId)` and branches on `!data` (never `unwrap`) → `access_denied`. `resolveBlockOwnedPage(blockId,userId)` reads the block by id, fails closed on `!data`, then `assertPageOwned(block.page_id,userId)`. `list_blocks` asserts page ownership before `findByPageId`; `toggle_block`/`update_block_content` resolve block-owned-page before the mutating call. `get_page` also routes through `assertPageOwned` (M2 — see below).
- **M1 (page allow-lists):** `createPage`/`updatePage` build the payload field-by-field from an explicit allow-list. `user_id` is always the authenticated id (create), never from params; `id`/`status`/`published`/`custom_domain_verified` can never be injected. Page allow-list fields chosen:
  - **create** (`WebsitePageInsert` domain fields): `page_type`, `slug`, `title` (required) + optional `meta_description`, `seo_keywords`, `theme`, `subdomain`, `favicon_url`, `og_image_url`, `website_language`. (`template_id` deliberately excluded — editor-grade; `custom_domain` not in the Insert type.)
  - **update** (`WebsitePageUpdate` fields): `page_type`, `slug`, `title`, `meta_description`, `seo_keywords`, `theme`, `subdomain`, `custom_domain`, `favicon_url`, `og_image_url`, `website_language`. (`user_id` excluded — always the authenticated id via the `.eq('user_id',userId)` scope.)
- **M2:** ownership reads branch on `!data`. Caught during testing — `get_page` initially used `unwrap`, which rethrew the raw PGRST116 error as a 500 instead of `access_denied`; switched it to `assertPageOwned`. Test `notOwned()` returns `{data:null,error:PGRST116}` and asserts the `access_denied` contract holds.
- **M3:** neither `delete_page` nor `archive_page` is exposed (11 actions only).
- **M4:** covered under W0.1 above (flagged below).
- **M5:** `get_page_analytics` delegates to the user-scoped `getPageSummary(pageId,userId)` with no ownership pre-check — a foreign pageId returns a zeroed summary (documented as an intentional non-leak in the executor).
- **W0.2:** repos instantiated as `new WebsitePageRepository(supabaseServer)` / `new WebsiteBlockRepository(supabaseServer)` / `new WebsiteAnalyticsRepository(supabaseServer)` in the constructor — the caching `get*Repository()` getters are not used.
- **P4 N/A:** `capabilities-schema.ts` / `SafeExecutionLayer` untouched; `WebsiteActionHandler` untouched; REST routes untouched.

### Console.* flag (CLAUDE.md logging standard)
`lib/repositories/WebsiteAnalyticsRepository.ts` had **2 `console.log`** calls (`:154`, `:242`) — converted to Pino `logger.debug` per W0.1/M4 (this file is on the `get_analytics_summary` path). No other `console.*` remain in the touched files.

### Verification
- **Typecheck:** `npx tsc --noEmit` — the 5 touched files (`.json` excluded) report **0 errors** (repo has a large unrelated pre-existing baseline elsewhere; touched files clean).
- **Tests:** `npx jest lib/server/website-plugin-executor.test.ts` → **22 passed / 22**.

### Deviations
- None of substance. The only mid-implementation correction was routing `get_page` through `assertPageOwned` (M2) instead of `unwrap` — this is the M2 rule applied to the read path, caught by the not-owned test.

---

## 9. SA review

**Reviewed by SA — 2026-08-10**
**Status:** 🔄 Revision Required — **APPROVE-WITH-CHANGES.** The load-bearing G3/Option-A design is correct, fail-closed, and copies a pattern already proven in the REST layer, so there is no fundamental rework and no TL escalation. There is **one MEDIUM security gap the plan does not cover** (M1 — page create/update must use explicit field allow-lists; this is the *same* cross-tenant lesson as Payments M1 / Intake M1, applied to blocks in this plan but **silent for pages**). Fold in M1–M5, then cleared for implementation — a diff against M1–M5 suffices, no second full review.

### Verification performed (against live code, not docs)

| Claim in the plan | Verdict | Evidence |
|---|---|---|
| `WebsitePageRepository.findById(id,userId)` is the user-scoped ownership oracle | ✅ Confirmed | `WebsitePageRepository.ts:109-124` — `.eq('id',id).eq('user_id',userId).single()` |
| `findById` returns `data:null` for a not-owned/not-found page (guard works) | ✅ Confirmed **with a nuance (M2)** | `.single()` on no-match errors PGRST116 → thrown → caught → `{ data:null, error:<non-null> }`. Unlike `getHomepage`/`findByType` (`:207`,`:251`) it does **not** special-case PGRST116, so `data` is null but `error` is **non-null**. The guard must branch on `!data`, not on `unwrap` (see M2). |
| `WebsiteBlockRepository.findById(blockId)` is id-only (the G3 surface) | ✅ Confirmed | `WebsiteBlockRepository.ts:217-231` — selects by `id` only; `updateContent`/`toggleEnabled`/`update`/`delete`/`updateCapabilityConfig` all id-only; `findByPageId`/`findByType`/`findByCapability`/`bulkCreate`/`reorder` page-scoped-trusting. No `user_id` column anywhere. |
| id-only block mutations write strictly by block id (no cross-page write) | ✅ Confirmed | `toggleEnabled` `:361-377` (`.update({enabled}).eq('id',id)`), `updateContent` `:335-359` (re-reads `findById(id)`, writes `.eq('id',id)`). Neither touches `page_id`. |
| Publish is a plain column update; keeps `status` + legacy `published` in sync (R7) | ✅ Confirmed | `publish` `:323-345` sets `status:'live'`+`published:true`; `unpublish` `:347-367` sets `status:'draft'`+`published:false`. No fan-out. |
| Repo singleton getters cache the first-injected client → executor must `new X(supabaseServer)` | ✅ Confirmed | `getWebsitePageRepository` `:492-499`, block `:578-585`, analytics `:525-532` — all `if(!instance) instance = new X(supabase)`. REST route does it right: `new WebsitePageRepository(supabaseServer)` / `new WebsiteBlockRepository(supabaseServer)` (`pages/[id]/blocks/[blockId]/route.ts:43,49,83,92`). |
| Analytics `console.log` at `:154`,`:242` in `getSummary`; `get_analytics_summary`→`getSummary` | ✅ Confirmed | `WebsiteAnalyticsRepository.ts:154`,`:242`. `getPageSummary` (`:403`) is clean (no `console.*`). |
| Existing Option-A pre-check pattern the plan copies | ✅ Confirmed | `blocks/[blockId]/route.ts:83-98` — page `findById(id,user.id)` ownership check, then block `findById` + `page_id === id` cross-check, before mutate. |
| `connection.user_id` is server-resolved (never client-supplied); `db_active` fails closed | ✅ Confirmed | `access-strategy.ts:138-164` — `buildVirtualConnection(userId,…)` only issued after `business_profiles` row check; denies on no-row AND lookup error. |
| `validatePluginDefinition` needs description+parameters+output_guidance; `db_active⇒isSystem`; auth_config OR access_strategy | ✅ Confirmed | `plugin-manager-v2.ts:749-767` |
| Registration sites = `corePluginFiles` + `executorRegistry` | ✅ Confirmed | `plugin-manager-v2.ts:14-39`, `plugin-executer-v2.ts:46-72` (crm/scheduling/payments/intake precedent) |
| `web` exists in the V6 `Domain` enum | ✅ Confirmed | `intent-schema-types.ts:42` (`"web"`) — literal fit, no borrowing (unlike Intake's `crm`) |
| P4 N/A — no capability-layer caller (`website` not in `capabilities-schema.ts`, no `SafeExecutionLayer` ref) | ✅ Accepted (assessment-corroborated; Intake precedent) | roadmap Website §; consistent with Intake §4.4 |

### Answers to the review questions

1. **Option A correctness → CORRECT and fail-closed, one contract nuance (M2).** Both helpers are right. `assertPageOwned` via the user-scoped `findById(pageId,userId)` closes the page surface; `resolveBlockOwnedPage` (block `findById(blockId)` → `page_id` → `assertPageOwned`) closes the id-only block surface by deriving ownership **from the actual block's page**, which is equivalent to (and cleaner than) the route's `page_id===id` cross-check. A non-existent block and a not-owned page both yield `data:null` → `access_denied`. The 2-read path is sound. The id-only mutations (`toggleEnabled`/`updateContent`) write strictly by block id after the check, and **no exposed op reassigns a block's `page_id`**, so there is no cross-page TOCTOU (benign, single-tenant service role). **No exposed op can bypass ownership** — pages/analytics use user-scoped methods; `get_page_analytics(pageId)` is scoped by `.eq('user_id',userId)` so a foreign pageId returns a zeroed summary, not a leak (M5 note). The one correctness detail the plan must state: because `findById` returns a **non-null** PGRST116 error on not-found, the guard must branch on `!result.data` and throw `access_denied` — it must **not** reuse the throw-on-error `unwrap` helper (which would rethrow the raw Supabase error and surface as `execution_error`, breaking the `access_denied` contract and the G3 test assertions). See M2.
2. **Trimmed op set → ENDORSE (~11 is the right cut).** Deferrals all justified against live code: `reorder`/`moveBlock` depend on the phantom `clear_block_positions` RPC + slow fallback (`WebsiteBlockRepository.ts:387-414`) and an ordered-id-list is awkward for an agent; `bulkCreate` accepts mixed `page_id`s (`:295`, multi-page hazard); `updateCapabilityConfig`/`findByType`/`findByCapability` are editor-grade. Deferring the whole `WebsiteContentRepository` is acceptable for v1 (it overlaps confusingly with block content) — **not** a blocker, but seed a note that a single `get_content` read may be a cheap future add if agents need the JSONB content row. **`delete_page` AND `archive_page`: keep BOTH out of v1 (M3).** Hard `delete` CASCADEs blocks (high blast radius) — never expose. `archive` is soft + user-scoped (`:369-403`) so technically safe, but low agent value and destructive-ish; a read/edit/publish-only v1 surface is the right conservative cut. Add `archive_page` (soft, **never** hard `delete`) later only if a real caller needs programmatic archival.
3. **W0.2 singleton caching → CONFIRMED.** All three getters cache the first client (`:492`,`:578`,`:525`); the executor must instantiate `new WebsitePageRepository(supabaseServer)` / `new WebsiteBlockRepository(supabaseServer)` / `new WebsiteAnalyticsRepository(supabaseServer)` directly — exactly as the REST routes do. Endorse as written.
4. **W0.1 `console.log` → CONVERT, don't avoid the repo (M4).** `get_analytics_summary` legitimately delegates to `getSummary`, so the file is touched — converting `:154`/`:242` to Pino is the correct Step-0 action per CLAUDE.md (flag to user first). Additionally trim the `:154` payload (it dumps `firstRecord`/full row data) down to a minimal `logger.debug` context. Don't skip the analytics op to dodge the file — the summary is a high-value read.
5. **Triggers / side-effects → CONFIRMED nothing to delegate-avoid.** Publish/unpublish are plain column updates with no fan-out (`:323-367`); the code corroborates the "only `updated_at`, no cross-capability triggers" assessment. (Note: SA validated at the code/assessment level, did not re-open the migration files — the plan's trigger claim is accepted on that basis.)
6. **P4 N/A + `WebsiteActionHandler` → CONFIRMED correct.** No capability-layer caller exists (Intake precedent), so there is nothing to wire into `SafeExecutionLayer`, and leaving the parallel regex `WebsiteActionHandler` untouched (retirement = separate follow-up R6) is right — folding it in would balloon scope and risk drift. The plugin + Modules tab is the first executable surface.
7. **Domain `web`, definition validity, no new patterns → ALL CONFIRMED.** `web` is a literal `Domain` member (`intent-schema-types.ts:42`) — use it. 11 actions each with description+parameters+output_guidance + internal `auth_config` stub + `access_strategy:{type:"db_active"}` + `isSystem:true` satisfies `validatePluginDefinition` (`:749-767`). Registered in both sites. Option A is the **existing** REST-route pattern, not a new one; reuses the shipped `db_active` + `business_os` substrate. No new pattern.

### Must-fix (fold into the plan before coding)

- **M1 — [MEDIUM · security] `create_page` and `update_page` must build their payloads from explicit field allow-lists; never forward raw `params`.** This is the initiative's load-bearing lesson (Payments M1 / Intake M1) and the plan applies it to **blocks** but is **silent for pages**. `update(id,userId,updates)` applies `updates` as the SET clause under `.eq('user_id',userId)` (`WebsitePageRepository.ts:304-321`) — since `parameters` is `any`, forwarding raw `params` as `updates` lets a caller inject `user_id:'<other-tenant>'` into the SET clause and **reassign ownership of their own row to another tenant** (an ownership-giveaway / integrity break), plus set unintended columns (`custom_domain`, `custom_domain_verified`, `status`, `published`). `create(page)` inserts `page` directly (`:287-297`) — raw forward lets a caller inject `id`, `custom_domain_verified:true`, `status:'live'`, etc. **Fix (executor):** for `update_page` pick only the `WebsitePageUpdate` fields explicitly (`page_type`/`slug`/`title`/`meta_description`/`seo_keywords`/`theme`/`subdomain`/`custom_domain`/`status`/`favicon_url`/`og_image_url`/`website_language`) — **exclude `user_id`**; for `create_page` pick only `WebsitePageInsert` domain fields and set `user_id:userId` from the authenticated id (never from `params`). Mirror the `IntakePluginExecutor.updateSettings` allow-list (`intake-plugin-executor.ts:137-141`). Add unit tests asserting a `params.user_id` (and a stray `params.id`) are dropped on both ops. Reword §4.2/§4.5/§5 to state page create/update allow-listing alongside the block guards.
- **M2 — [LOW · correctness] Ownership reads must branch on `!data`, not the throw-on-error `unwrap`.** `WebsitePageRepository.findById` returns a **non-null** PGRST116 error on a not-owned/not-found page (it does not special-case PGRST116). `assertPageOwned`/`resolveBlockOwnedPage` must check `!result.data` and throw `access_denied` (fail-closed), and must **not** pass the result through a rethrowing `unwrap` — otherwise a legitimate "not my page" maps to a generic `execution_error` instead of `access_denied`, and the G3 tests (which assert `access_denied` + that the mutating call was never made) would need the branch anyway. State this in §4.2.
- **M3 — [LOW] Keep both `delete_page` and `archive_page` out of v1.** Never expose the hard `delete` (CASCADEs blocks). Defer `archive_page` (soft) too; add it later only if a real caller needs programmatic archival — as soft `archive`, never hard `delete`. Update §1/§5 to remove the "SA to confirm archive" ambiguity.
- **M4 — [LOW] W0.1 — convert both `console.log` (`:154`,`:242`) to Pino and trim the `:154` payload.** Flag to the user before converting (CLAUDE.md). The `:154` log dumps `firstRecord`/full row data — reduce to a minimal `logger.debug` context (counts + userId/subdomain, no row bodies). Do not skip the analytics op to avoid the file.
- **M5 — [LOW · informational, no code] `get_page_analytics` returns a zeroed summary for a foreign/non-owned `pageId`** (scoped by `.eq('user_id',userId)`, so no data leak — a non-owner cannot distinguish "no views" from "not my page"). This is acceptable and needs no ownership pre-check; note it in §4.2 as an intentional non-leak so QA has the oracle. (Optionally add `assertPageOwned` for a cleaner `not_found` contract — not required.)

### Approval

[ ] Workplan approved — proceed to implementation
[x] **Revision required — fold in M1–M5, then cleared for implementation** (no second full review; a diff against M1–M5 + the §-answers suffices). **M1 is the load-bearing one:** page create/update must use explicit field allow-lists — the block-ownership design is otherwise correct and fail-closed.

### 9.2 SA code review (post-implementation)

**Reviewed by SA — 2026-08-11**
**Status:** ✅ **APPROVE** — Code approved for QA. Every M1–M5 + G3 item is correctly implemented; the two load-bearing security controls (G3 block ownership, M1 page allow-lists) are fail-closed and test-locked. No fix required. Two optional hardening notes below (non-blocking).

#### Verification results

| Check | Result |
|---|---|
| `npx tsc --noEmit` (touched files) | ✅ **0 errors** in `website-plugin-executor.ts`, `website-plugin-executor.test.ts`, `WebsiteAnalyticsRepository.ts`, `plugin-executer-v2.ts`, `plugin-manager-v2.ts` (grep of full-repo output — none of the touched files appear; large pre-existing baseline elsewhere is unrelated) |
| `npx jest lib/server/website-plugin-executor.test.ts` | ✅ **22 passed / 22** |

#### Findings (against the review priorities)

1. **G3 Option-A ownership (load-bearing) — ✅ CORRECT, fail-closed.**
   - `assertPageOwned` (`website-plugin-executor.ts:153-159`) calls `pageRepo.findById(pageId, userId)` and branches on `!result.data` → throws `access_denied`. Does **not** route through `unwrap` — a PGRST116 `{data:null,error}` is treated as not-owned (M2 honored). ✓
   - `resolveBlockOwnedPage` (`:167-174`) reads `blockRepo.findById(blockId)`, fails closed on `!result.data`, THEN `assertPageOwned(block.page_id, userId)`, returns the block. ✓
   - Every block op enforces it: `list_blocks` asserts ownership **before** `findByPageId` (`:106-110`); `toggle_block` (`:112-117`) and `update_block_content` (`:119-124`) call `resolveBlockOwnedPage` **before** `toggleEnabled`/`updateContent`. ✓
   - `get_page` routes through `assertPageOwned` (`:82-87`) — the M2 read-path fix Dev noted; no rethrowing unwrap. ✓
   - **No exposed op reaches a repo mutation without an ownership check.** All 11 cases audited: pages/analytics use user-scoped repo methods (`listByUser`/`publish`/`unpublish`/`getSummary`/`getPageSummary` all take `userId`; `update` passes `userId` as the `.eq` scope); blocks go through the two G3 helpers. The id-only block mutations write strictly by block id and never carry `page_id`, so a checked block cannot be re-pointed to another page (no TOCTOU). ✓
2. **M1 page allow-lists (load-bearing) — ✅ CORRECT, field lists validated against the types.**
   - `createPage` (`:183-203`) builds `WebsitePageInsert` field-by-field; `user_id` is hard-set to the authenticated `userId`; `id`/`status`/`published`/`custom_domain_verified` are never read from `params`. Allow-list vs `WebsitePageInsert` (`WebsitePageRepository.ts:62-76`): all editable domain fields present; `status` intentionally omitted (new pages default to draft — correct); `template_id` omitted (editor-grade — acceptable). No dangerous field included.
   - `updatePage` (`:209-226`) builds `WebsitePageUpdate` field-by-field and passes `userId` as the scope arg (never as a SET field). Allow-list vs `WebsitePageUpdate` (`WebsitePageRepository.ts:78-91`): all editable fields present; `status` intentionally omitted (publish/unpublish own publish state — correct). `custom_domain_verified` is not in the Update type at all, so it is doubly unreachable. No editable field wrongly omitted, no dangerous field included. ✓
3. **Tests assert the guarantees (not just "throws") — ✅.** `create_page` test asserts the repo received `user_id: 'u1'` and `toEqual`s a payload with the injected `id`/`status`/`published`/`custom_domain_verified` absent (`:100-127`); `update_page` test asserts `passedUserId === 'u1'` and the patch `toEqual`s `{title}` with no injected fields (`:129-147`); block tests assert `toggleEnabled`/`updateContent`/`findByPageId` are **not** called on an ownership miss (`:161-198`), including the non-existent-block and PGRST116 `{data:null,error}` cases. ✓
4. **W0.2 — ✅.** Repos instantiated as `new WebsitePageRepository(supabaseServer)` / `new WebsiteBlockRepository(...)` / `new WebsiteAnalyticsRepository(...)` in the constructor (`:60-63`); no `get*Repository()` caching getter used.
5. **W0.1/M4 — ✅.** Both `console.log` in `WebsiteAnalyticsRepository.getSummary` converted to `logger.debug`; the `:154` log trimmed to `{ recordCount, userId, subdomain }` (no `firstRecord`/full-row body); the second logs counts only. `grep console.` on the file returns nothing; `createLogger` already imported (`:9`).
6. **Definition validity — ✅.** Exactly **11 actions**, each with `description` + `parameters` + `output_guidance`; `isSystem:true`, `access_strategy:{type:"db_active"}`, `visibility:"business_os"`, `domain:"web"`, internal `auth_config` stub. Registered in **both** `corePluginFiles` (`plugin-manager-v2.ts`) and `executorRegistry` (`plugin-executer-v2.ts`).
7. **P4 N/A — ✅.** Diff touches only the executor, its test, the analytics repo, and the two registration sites. `capabilities-schema.ts` / `SafeExecutionLayer` / `WebsiteActionHandler` / REST routes untouched (confirmed via `git status`).
8. **Standards — ✅.** Repository pattern (the executor's only Supabase contact is constructing repos with `supabaseServer`); Pino, no `console.*`; `connection`/`parameters` typed `any` matches the base class abstract signature (`base-plugin-executor.ts:156-160`) — established pattern, not new.

#### Optional hardening (non-blocking — do NOT re-cycle for these)

- **[Low] `create_page`/`update_page` accept `subdomain` directly**, bypassing the `check_subdomain_available`/`generate_subdomain` RPCs. A collision surfaces as a repo error (DB uniqueness), not a leak — acceptable for v1, and `subdomain` was already an editable field on `update`. Note only.
- **[Low] `page_type` / `website_language` JSON parameters use plain `type:"string"`** while their descriptions enumerate the valid values. The DB/TS `PageType`/`WebsiteLanguage` enums enforce at the repo boundary, so an invalid value fails closed — adding a JSON `enum` would only improve the LLM-facing contract. Optional.

#### Code Approved for QA: **Yes**

---

## 10. QA report

**QA — 2026-08-11**
**Test mode:** full (security-focused)
**Strategy used:** A (Jest pure unit) + static source audit — no running dev server (Modules-tab live check is a user-manual step per §6). Security controls verified at the source, not just via green tests, as instructed.
**Focus:** security (G3 block ownership + M1 page allow-lists), api, schema
**Skipped:** e2e / DB-backed behaviour (QA-manual per §8 lean-test policy — real publish, analytics rollups, cross-tenant guard end-to-end)
**Input source:** prompt keywords + workplan scope

### Verdict: ✅ **PASS**

All 11 ops audited at the source. The two load-bearing controls (G3, M1) are correctly implemented, fail-closed, and test-locked. No exposed op reaches a repo read or mutation with a caller-supplied page/block id without an ownership check or a `user_id`-scoped repo method. Unit tests 22/22 green; touched files typecheck-clean. Two non-blocking cosmetic observations noted below (no security or data-integrity impact) — **no fix required for commit.**

### Test + typecheck results
| Check | Command | Result |
|---|---|---|
| Unit tests | `npx jest lib/server/website-plugin-executor.test.ts` | ✅ **22 passed / 22** (1.9s) |
| Typecheck (touched files) | `npx tsc --noEmit` filtered to the 5 touched files | ✅ **0 errors** in `website-plugin-executor.ts`, `website-plugin-executor.test.ts`, `WebsiteAnalyticsRepository.ts`, `plugin-executer-v2.ts`, `plugin-manager-v2.ts` (large unrelated pre-existing baseline elsewhere, no NEW error in a touched file) |

### Guardrail audit — 11-op ownership walk (read the code)
| # | Op | Ownership boundary | Verdict |
|---|---|---|---|
| 1 | `list_pages` | `listByUser(userId)` — user-scoped | ✅ |
| 2 | `get_page` | `assertPageOwned(id, userId)` — branches on `!data`, throws `access_denied`; NOT `unwrap` (M2) | ✅ |
| 3 | `create_page` | no page id read; `user_id` hard-set to authenticated id; allow-list build | ✅ |
| 4 | `update_page` | `pageRepo.update(id, userId, updates)` — SET under `.eq('user_id')`; allow-list build; foreign id = no-op (0 rows) | ✅ |
| 5 | `publish_page` | `publish(id, userId)` — `.eq('id').eq('user_id')`; foreign id = no-op | ✅ |
| 6 | `unpublish_page` | `unpublish(id, userId)` — `.eq('id').eq('user_id')`; foreign id = no-op | ✅ |
| 7 | `list_blocks` | `assertPageOwned(page_id, userId)` **before** `findByPageId` | ✅ |
| 8 | `toggle_block` | `resolveBlockOwnedPage(block_id, userId)` **before** `toggleEnabled` | ✅ |
| 9 | `update_block_content` | `resolveBlockOwnedPage(block_id, userId)` **before** `updateContent` | ✅ |
| 10 | `get_analytics_summary` | `getSummary(userId, subdomain)` — reads `website_page_views` scoped by `.eq('user_id')`; foreign subdomain → empty | ✅ |
| 11 | `get_page_analytics` | `getPageSummary(pageId, userId)` — `.eq('page_id').eq('user_id')`; foreign pageId → zeroed (M5) | ✅ |

**Bypass search:** No path found where an undefined/empty/foreign pageId or blockId, an existing block on an unowned page, or params with extra keys reaches a repo read/mutation without an ownership check or `user_id` scope. `resolveBlockOwnedPage` derives ownership from the block's *actual* `page_id` (not a caller-supplied page id), so a block on an unowned page fails closed; a missing block (`{data:null}`) fails closed; a PGRST116 `{data:null,error}` is treated as not-owned. The id-only block mutations never carry `page_id` → no cross-page TOCTOU.

**M1 allow-list construction (verified at source):** `createPage` (`website-plugin-executor.ts:183-203`) builds `WebsitePageInsert` field-by-field, hard-sets `user_id: userId`, and never reads `id`/`status`/`published`/`custom_domain_verified` from params. `updatePage` (`:209-226`) builds `WebsitePageUpdate` field-by-field, passes `userId` only as the `.eq` scope arg (never a SET field), and omits `status`/`published`/`custom_domain_verified` (the last is not even in the Update type). Cannot inject any of the dangerous fields.

**Repo construction (W0.2):** constructor uses `new WebsitePageRepository(supabaseServer)` / `new WebsiteBlockRepository(...)` / `new WebsiteAnalyticsRepository(...)` — no caching `get*Repository()` getter. Executor has **no** direct `.from()` / `supabaseServer.*` calls (grep clean) — its only Supabase contact is constructing repos.

**W0.1/M4 (Pino):** `WebsiteAnalyticsRepository.getSummary` — both former `console.log` are now `logger.debug`; `:155` logs `{ recordCount, userId, subdomain }` (no row bodies), `:236` logs counts only. `grep console.` on the file returns nothing; `createLogger` imported (`:9`).

### Definition sanity
Parsed `lib/plugins/definitions/website-plugin-v2.json`: exactly **11 actions** (list_pages, get_page, create_page, update_page, publish_page, unpublish_page, list_blocks, toggle_block, update_block_content, get_analytics_summary, get_page_analytics); each has `description` + `parameters` + `output_guidance`. `access_strategy:{type:"db_active"}`, `isSystem:true`, `visibility:"business_os"`, `domain:"web"`, internal `auth_config` stub. Satisfies `validatePluginDefinition` (`plugin-manager-v2.ts:742-769`: name present; auth_config OR access_strategy present; db_active⇒isSystem holds; ≥1 action; every action has the 3 required fields). Registered in **both** `corePluginFiles` (`plugin-manager-v2.ts:39`) and `executorRegistry` (`plugin-executer-v2.ts:72`).

### Behavior parity vs the REST route (`pages/[id]/blocks/[blockId]/route.ts`) — **PASS**
REST PUT: `pageRepo.findById(id, user.id)` ownership → `blockRepo.findById(blockId)` → assert `block.page_id === id` → mutate. Executor `resolveBlockOwnedPage`: `blockRepo.findById(blockId)` → `assertPageOwned(block.page_id, userId)` → mutate. Equivalent-or-stronger: the executor derives the page from the actual block and always checks ownership of *that* page, so it needs no caller-supplied page id and cannot be fed a mismatched pair. Same fail-closed semantics.

### Per-op test coverage
All 11 ops covered, plus missing-`userId` → access_denied, unknown-action, `page_id` required-before-read, and repo-error propagation. G3 suite: unowned pageId list_blocks (findByPageId NOT called), toggle/update on unowned block page (mutation NOT called), non-existent blockId, PGRST116 `{data:null,error}` treated as not-owned. M1 suite: create_page + update_page assert the repo receives the authenticated `userId` and a payload/patch with the injected `user_id`/`id`/`status`/`published`/`custom_domain_verified` absent. **No op lacks coverage.**

### Edge cases (PASS/CONCERN — no fix)
- `get_page_analytics` foreign pageId → **PASS.** `getPageSummary` (`WebsiteAnalyticsRepository.ts:400-406`) filters `.eq('page_id').eq('user_id')` → 0 rows → zeroed summary. No cross-tenant leak (M5 confirmed at source).
- `publish_page`/`unpublish_page`/`update_page` unowned page → **PASS (security).** All three repo methods scope `.eq('id').eq('user_id')`; a foreign id matches 0 rows → `.single()` PGRST116 → `{data:null,error}`, **not** a cross-tenant write. Cosmetic note: because these use `unwrap` (not `assertPageOwned`), an unowned target surfaces a generic error rather than `access_denied` — no data-integrity or leak impact (see Observation 1).
- `update_block_content` empty content `{}` → **PASS.** `requireParam` treats `{}` as present (only rejects `undefined`/`null`/`''`); ownership still enforced; `updateContent` merges `{}` → harmless no-op.

### Lean-build check — PASS
Test file is pure mocked unit tests: `jest.mock` on all three repos + `@/lib/supabaseServer`. No DB/network/integration. 22 tests in ~1.9s.

### Observations (non-blocking — NOT bugs, no fix required for commit)
1. **[Cosmetic · error contract] `publish_page`/`unpublish_page`/`update_page` against an unowned page return a generic error, not `access_denied`.** They rely on the `user_id`-scoped repo (correct, fail-closed, no cross-tenant write) but pipe through `unwrap`, which rethrows the raw PGRST116. `get_page` was routed through `assertPageOwned` for exactly this contract reason (M2); the mutating page ops were not. No security impact — purely the LLM-facing error string. Optional future hardening, consistent with the workplan's "delegate to user-scoped repo directly" design. File: `website-plugin-executor.ts:95-103, 209-226`.
2. **[Info] No negative unit test for the unowned-page publish/unpublish/update path** (the mocks return `ok()` for those). Not required by §4.5 and not a security gap — the boundary is the repo's `.eq('user_id')`, already exercised by the ownership design. Minor coverage note only.

### Final status
- [x] All acceptance criteria pass — ready for commit (pending the §6 user-manual Modules-tab live check + user code review; RM held per workplan)
- [ ] Issues found — Dev must address before commit

_No §9 content modified._

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-08-10 | Created | Drafted from the read-only Website assessment. Core work: G3 ownership scoping via Option A (executor-level page-ownership pre-check — helpers `assertPageOwned` / `resolveBlockOwnedPage`, fail-closed) since the service-role plugin bypasses RLS. Trimmed v1 to ~11 high-value ops; deferred reorder/bulkCreate/capability_config/content-CRUD/domain/templates/delete to REST/UI. No cross-capability triggers; P4 N/A (first executable surface). B/C repo-layer G3 fixes deferred. |
| 2026-08-10 | SA-approved + M1–M5 folded in | APPROVE-WITH-CHANGES. Folded: **M1** page ops (`create_page`/`update_page`) need explicit field allow-lists too (raw-params forward could inject `user_id` and hand a page to another tenant — MEDIUM), **M2** ownership guard branches on `!data` and treats PGRST116 `{data:null,error}` as not-owned (no rethrowing unwrap), **M3** keep both `delete_page` + `archive_page` out of v1, **M4** convert analytics `console.log` + trim the full-row payload, **M5** (informational) `get_page_analytics` returns a zeroed summary for a foreign pageId — user_id-scoped, no leak. Cleared for implementation. |
