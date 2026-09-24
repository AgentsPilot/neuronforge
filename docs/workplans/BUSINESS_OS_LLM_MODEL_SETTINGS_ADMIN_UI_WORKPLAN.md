# Workplan: Business OS LLM — Model Settings Admin Screen

> **Last Updated**: 2026-09-23

**Developer:** Dev
**Requirement:** [BUSINESS_OS_LLM_MODEL_SETTINGS_ADMIN_UI_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_LLM_MODEL_SETTINGS_ADMIN_UI_REQUIREMENT.md) — 30 FRs, 30 ACs (AC-27 removed). SA **APPROVED WITH CHANGES** twice: required changes 1–11 (folded by the BA) and the re-check's five must-fixes **R-1 … R-5, which this workplan carries** instead of a second requirement cycle.
**Context (read, not re-derived):** [BUSINESS_OS_LLM_MODEL_SETTINGS_LAYER2_WORKPLAN.md](/docs/workplans/BUSINESS_OS_LLM_MODEL_SETTINGS_LAYER2_WORKPLAN.md) (Layer 2 shipped in PRs #61/#79/#85/#87/#89; it carries every SA review and QA report for the machinery this screen drives) · [BUSINESS_OS_LLM_MODEL_SETTINGS_RUNBOOK.md](/docs/runbooks/BUSINESS_OS_LLM_MODEL_SETTINGS_RUNBOOK.md) (the de-facto spec of what an operator needs) · [ADMIN_IDENTIFICATION_AND_ACCESS.md](/docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md) · `.claude/skills/bos-llm-call-standards/SKILL.md`.
**Branch:** slice 1 on `feature/business-os-llm-admin-ui` (merged as **PR #98**); **slice 2 on `feature/business-os-llm-admin-ui-slice2`, off `origin/main` `d1e54bef`**, worktree `C:\Users\Barak\My Projects\AgentsPilot\neuronforge-llm-admin-ui`. Each slice is its own PR. **Nothing is committed from this worktree by Dev** — RM commits and merges.
**Date:** 2026-09-22 (slice 2 implemented 2026-09-23)
**Status:** **Slice 1 MERGED (PR #98). Slice 2 code complete; SA review (Fix Required) and QA report (46/7/2/1, no High) both closed — ALL SA AND QA FIXES APPLIED — F-1, F-3, F-4, F-5, F-6 plus F-7…F-11; awaiting SA/QA re-check → the user's view → RM** (uncommitted). Slice 2's gates, mutations and deviations are in §5.3 / §5.3b / §5.3c / §5.4; RC-D and DEF-6 are both closed there. **F-2 is deliberately NOT fixed here** — it changes a required gate and is the user's call (§5.3b).
**Earlier status (slice 1):** QA-PASSED (SHIP), all in-slice defects closed. Reviews and reports: [SA Code Review](#sa-code-review--slice-1), [SA Re-check](#sa-re-check--slice-1), [QA Test Report](#14-qa-testing-report). Fixes in §4.6 (SA must-fixes), §4.7 (RC-A—D) and §4.9 (QA DEF-1—7); gates re-measured after each round (§4.4). **§4.8 carries the owed insert-caller census.** **The `literalScope()` inclusion-list change must land WITH OR BEFORE slice 1.** Carried forward: **RC-D** (confirmed by QA measurement — the live seed is ≈29 h old, so a panel rendered on load would 400 on **all eight** areas today) and **DEF-6**, both for slice 2; **DEF-7** is a standalone follow-up.
**Resolved since the first draft:** Q-1 ✅ (provenance in the resolver, subject to RC-2) · Q-2 ✅ (`listPricedModels()` including `FALLBACK_PRICING`, filter moved out of the route per RC-3) · **Q-3 ✅ option C** (the door lives on the audit entries; **no column, no migration, no audit read**), narrowed by RC-1's three-state FR-14 rendering · Q-4 ✅ (3 s + `maxDuration`, RC-5) · Q-5 ✅ (the **FR-24** split stands; the **4a** split does not — RC-7) · Q-6 ✅ (drop `costSum`, RC-6) · **Q-7 ✅ answered by the user 2026-09-22: sidebar only** (D-U1 below).
**Environment:** ✅ unblocked (RC-12). The worktree has the `node_modules` junction and `.env.local`. Baselines are measured **before** the first edit (T1.0) and recorded in §4.4.

---

## Overview

Layer 2 put every catalogued Business OS AI call's provider, model, temperature and on/off switch into eight `system_settings_config` rows, read at run time. It shipped deliberately without a screen. Changing a model or switching an area off during a cost incident therefore needs a terminal, a checkout and the **service-role key**.

This layer builds the browser door: one `/admin` page over eight area cards, and one dedicated API route with a **typed area** (never a caller-supplied key). It is not a second, softer way into those rows — it calls **the same `validateAreaRow`** the change script calls, and (RC-4) **the same switch-off predicate**, so it cannot refuse less than the script does. And it never tells an operator something the system does not keep: `isBosLlmAreaEnabled` **fails open**, so the screen says *"Configured: off"*, carries an undismissible fail-open sentence beside every switch, and offers the ledger as **corroboration with its limits stated** — including the reading that says *the ledger cannot tell you*.

**Four slices (RC-7).** **Nothing before slice 3 changes what any admin can write.**

| Slice | One line | Size |
|---|---|---|
| **1** | Read route (`GET`), the ledger aggregate, the optional actor on `set()` | **L** |
| **2** | The read-only page | **M/L** |
| **3** | The writer — `PUT` + dry-run, audit, notification, **the confirm step**, the generic route's message | **L** |
| **4** | The break-glass door (FR-24) + docs | **M** |

### Decisions taken outside the requirement

| # | Decision | Trigger for re-opening |
|---|---|---|
| **D-U2** | **When the actor id fails `updated_by`'s foreign key, the save SUCCEEDS without attribution and shouts. It never fails the save.** (User, 2026-09-22, on SA's recommendation — this **reverses** S3-T17 as first written.) A constraint on *who* is recorded must never block *what* is being changed: the same reasoning that makes the break-glass script non-blocking (D-18) — a control that refuses during an emergency is the failure the control exists to prevent. Concretely: the settings row is written; `updated_by` is left **null**, never a sentinel (a sentinel would corrupt FR-14's reverse lookup and re-create the R-1 hazard); the audit entry is still written at **`critical`**, carrying who we *believed* the actor was, why the binding failed, and `details.door` — **attribution moves from the row to the trail, losing the label but not the fact**; and the admin is told **on screen**, in the same place R-3 puts the notification result, that the save succeeded but could not be attributed. The card then reads *"last changed at Y — actor not recorded"*, which is exactly the FR-14 state RC-1 added — the two paths meet, which is a good sign the design is coherent. | Re-open if `updated_by` ever becomes load-bearing for more than a label (an authorisation decision, a billing attribution) — losing it silently would stop being cheap |
| **D-U1** | **The new screen is reached from the sidebar only. No cross-link is added to `app/admin/system-config/page.tsx`.** The user's words, 2026-09-22: *"for now, we can change later if needed."* SA's default was the same (Q-7), and CLAUDE.md's logging rule binds files you **touch** — leaving that file alone is what keeps this feature's diff reviewable. | **If anyone later wants the cross-link from System Config, that file's `console.*` calls get the full Pino conversion first, as its own commit, before the link is added.** Recorded here so the next person sees the cost *before* promising the link rather than discovering it mid-slice. Re-count at that time; today's count is 20 (§11). |

---

## Table of Contents

1. [Traceability (FR → slice)](#1-traceability-fr--slice)
2. [Code-Reality Check](#2-code-reality-check)
3. [Design](#3-design)
4. [Slice 1 — Read route, ledger aggregate, actor on `set()`](#4-slice-1--read-route-ledger-aggregate-actor-on-set)
5. [Slice 2 — The read-only page](#5-slice-2--the-read-only-page)
6. [Slice 3 — The writer and the confirm step](#6-slice-3--the-writer-and-the-confirm-step)
7. [Slice 4 — The break-glass door (FR-24) and the docs](#7-slice-4--the-break-glass-door-fr-24-and-the-docs)
8. [Where R-1 … R-5 land](#8-where-r-1--r-5-land)
9. [AC Traceability](#9-ac-traceability)
10. [`console.*` in touched files](#10-console-in-touched-files)
11. [Risks](#11-risks)
12. [Questions for SA](#12-questions-for-sa)
13. [SA Review Notes](#13-sa-review-notes)
14. [QA Testing Report](#14-qa-testing-report)
15. [Commit Info](#15-commit-info)

*(Section numbers changed when 4a folded into slice 3 — RC-7.)*

---

## 1. Traceability (FR → slice)

| FR | What | Slice | Tests |
|---|---|---|---|
| FR-1 | `requireAdmin` first statement; page guarded by layout inheritance; no read-only tier | 1 (route), 2 (page) | S1-T1, S2-T1 |
| FR-2 | Dedicated route, typed area, Zod, nodejs runtime, **no literal-gate shape** | 1 (GET), 3 (PUT) | S1-T2, S1-T12, S3-T1 |
| FR-3 | Generic route keeps refusing `bos_llm_area_*`; message points here | 3 (RC-7) | S3-T15 |
| FR-4 | Resolved first, per-field provenance, `temperature: undefined` → "not set" | 1 (payload), 2 (render) | S1-T3, S1-T4, S2-T3 |
| FR-5 | Issues attached to the field they affected, with the resolver's own `reason` | 1, 2 | S1-T5, S2-T4 |
| FR-6 | The client imports no server module and holds no model/temperature literal | 2 (+ `server-only`, RC-9) | S2-T2, S1-T12 |
| FR-7 | Missing row → "running on code defaults", no attribution line, not an error | 1, 2 | S1-T6, S2-T5 |
| FR-8 | Model options derived from pricing at request time, with cache age; free text still accepted | 1 | S1-T7, S1-T13 |
| FR-9 | One validator — `validateAreaRow`; `rejected` → 400, nothing written | 3 | S3-T2, S3-T3 |
| FR-10 | `dryRun` structural (**200 / `ok: false`**, RC-8); validation re-run at write time; `resolvedBefore` is a **fresh read** (R-4) | 3 | S3-T4, S3-T5, S3-T16 |
| FR-11 | Switch-off vs call-level `enabled: true` → refuse + name the calls; the `--include-calls` choice. **Shared predicate** (RC-4) | 1 (predicate) · 3 (route + UI) · 4 (script adopts it) | S1-T16, S3-T6, S4-T8 |
| FR-12 | Locked fields disabled with their reason; route is the real gate | 1 (lock metadata), 2 (render), 3 (refusal) | S1-T8, S2-T6, S3-T7 |
| FR-13 | `set()` gains an optional actor — **both branches** (R-5) | 1 | S1-T9, S1-T10 |
| FR-14 | "Last changed by X at Y" — **three row states** (RC-1), `updated_by` → email, **null `user_id` skipped** (R-1) | 1 (payload), 2 (render) | S1-T11, S1-T11b, S2-T7 |
| FR-15 | One confirm step naming the action and its reach | 3 (RC-7) | S3-T12, S3-T13 |
| FR-16 | The screen never claims an area is off | 2 | S2-T8 |
| FR-17 | Standing, undismissible fail-open sentence | 2 | S2-T8 |
| FR-18 | Ledger check: save + 60 s window, "completed", baseline, **three readings**, new cross-tenant aggregate (**count + latest only**, RC-6) | 1 (aggregate + route), 2 (panel) | S1-T14, S1-T15, S2-T9 |
| FR-19 | Chat renders none of the three readings — short-circuited **before the repository call** | 1, 2 | S1-T15, S2-T10 |
| FR-20 | Propagation stated after a write | 2 (copy), 3 (response) | S2-T11 |
| FR-21 | One `BOS_LLM_SETTINGS_UPDATED` per save, `changes: { before, after }`, `details.door` | 3 | S3-T8 |
| FR-22 | A second `critical` `BOS_LLM_AREA_DISABLED` on switch-off, `details` | 3 | S3-T9 |
| FR-23 | Both events registered in `lib/audit/events.ts` + helper pair | 3 | S3-T10 |
| FR-24 | The break-glass door writes the same entries; `--actor` / env; **three** actor outcomes (R-1) | 4 | S4-T1 … S4-T5 |
| FR-25 | Switch-off notification, recipients minus the actor **by normalised email or id**, **result on screen** (R-3), 3 s deadline (RC-5) | 3 (route + helper), 4 (script) | S3-T11a … S3-T11d, S4-T7 |
| FR-26 | Refusals logged at warn, never audited, never notified | 3 | S3-T14 |
| FR-27 | Pino + `correlationId`, no `console.*` | all | §10 |
| FR-28 | Runbook: "which door to use", `--actor`, the notification, §5 and §8 | 4 | review |
| FR-29 | Layer 2 requirement records the D-1 reversal | 4 | review |
| FR-30 | The `bos-llm-call-standards` skill names the screen | 4 | review |

---

## 2. Code-Reality Check

Read on 2026-09-22 in this worktree, off `origin/main` `d9c60ab4`.

### 2.1 Requirement citations that hold

| Cited | Verified |
|---|---|
| G-2 / D-3 | `validateAreaRow(area, rowValue)` at `modelSettings.ts:890` — runs `evaluateAreaRow` with a **fresh** `newGuardrailContext()`, returns `{ ok, rejected, adjusted, resolved, enabled }`; `rejected` is every issue whose `kind !== 'adjusted'`, so it includes `locked` and `unknown` |
| G-6 | `app/api/admin/system-config/route.ts:49` `RESERVED_KEY_PREFIX = 'bos_llm_area_'`; the refusal message is at **:208** and names `scripts/bos-llm-settings.ts` — one string to change for FR-3 |
| G-8 | `app/admin/layout.tsx` awaits `requireAdminPage()` before rendering `AdminChrome`; the file's own header explains why a page adds no guard |
| G-9 | `requireAdmin(logger)` returns `{ user: { id, email } }` or a `NextResponse` (`lib/admin/requireAdminRoute.ts:59`). The sibling `app/api/admin/business-os/llm-usage/route.ts` is the **non-conforming** example |
| G-11 | `BOS_LLM_AREA_LOCKS` (`modelSettingsPolicy.ts:111`); `TEMPERATURE_BOUNDS` (`:34`) and `ALLOWED_PROVIDERS_LAYER2 = ['openai']` (`:30`) are in the literal gate's **exempt** policy module |
| G-13 | `logAIPricingZeroCost` (`admin-helpers.ts:269`) carries `details`, `severity: 'critical'`, and its registry row is `events.ts:755` (`severity`, `complianceFlags: ['SOC2']`, `description`). `'settings'` **and** `'system'` are both in `AUDIT_ENTITY_TYPES` (`lib/audit/types.ts:21`) |
| G-14 | `SystemConfigRepository.set` (`:258`) takes `(key, value, category?, description?)` — no actor. `SystemSettingsConfig.updated_by?: string \| null` already exists (`lib/repositories/types.ts:398`) and `getByKeys` selects `*`, so **FR-14 needs no new read** |
| G-15 | `check-bos-llm-literals.ts` header lists the four shapes under *"KNOWN FALSE POSITIVES (they will arrive with the admin screen)"* and prescribes **"a narrow rule change here, never a new file exemption"**. Exactly **two** exemptions exist today (the policy module and the operator script) |
| G-16 | `sendEmail` (`emailTransport.ts:307`) takes `to: string[]`, never throws, and its last statement returns `{ sent: false, provider: 'none', error: 'no email transport configured' }` after a `logger.warn` |
| G-17 | `scripts/bos-llm-settings.ts` has no session; `commandSet` (`:253`) calls `set(key, row, 'business_os_llm', …)` with no actor |
| R-1 | `AdminUserRepository.ts:27` — `user_id: string \| null; // null until the admin has an auth account, then bound`. `findByEmail` (`:88`) filters `.eq('email', …).eq('is_active', true)` only. **`listActive()` (`:105`) has the same property.** Both halves of R-1 are real |
| R-5 | `set()`'s update branch writes `{ value, updated_at }`; its **insert branch writes neither** `updated_at` nor `updated_by` (`:287-297`) |
| FR-18 / change 10 | `listChatCallsAllAccountsInWindow` (`TokenUsageRepository.ts:414`) is the sole unscoped read, with a private pager and an info-level log saying so. `countInWindow` / `listLabelsInWindow` both `assertAccounts` |

### 2.2 G-18 — `system_settings_config.updated_by` verified against the live schema (RC-10)

**Measured on production on 2026-09-22, read-only**, host `jgccgkyhpwirgknnceoh.supabase.co`, through the service-role client. SA was right that the repo carries no DDL for this table (`supabase/migrations/` has none — it is dashboard-created), so the column was a TypeScript declaration only. It is now proved:

| Question | Evidence | Answer |
|---|---|---|
| Does the column exist? | An explicit `select('key, category, updated_at, updated_by')` over the eight `bos_llm_area_%` rows returned **no error** and 8 rows | ✅ **Yes** |
| What is its type? | The PostgREST OpenAPI definition reports `updated_by: type=string, format=uuid`. A filter probe confirms it: `.eq('updated_by', '00000000-…')` succeeds, `.eq('updated_by', 'not-a-uuid')` fails with `invalid input syntax for type uuid` | ✅ **`uuid`, nullable, no default** |
| Is there an FK? | The OpenAPI description carries `<fk table='user_settings_complete' column='id'/>` | ⚠️ **Yes.** `user_settings_complete` is a **view** (columns `id, email, full_name, avatar_url, plan, …`), and a Postgres FK cannot target a view — PostgREST is rendering the constraint's real target through the view built over it. The practical target is the platform's user-id relation |
| Do the actual admins satisfy it? | Both active `admin_users` rows (`meiribarak@gmail.com`, `offir.omer@gmail.com`) are **bound** (`user_id` not null) and **both** ids are present in `user_settings_complete` — `2/2` | ✅ **Yes today** |
| What is stored now? | All eight rows have `updated_by = null` and `updated_at = 2026-09-21T10:14:08Z` (the seed) | ✅ Consistent with G-17: no writer has ever populated it |

**Consequences carried into the design.** (1) D-16 / FR-13 / FR-14 / R-5 rest on a real column — slice 1 may proceed. (2) The `null` on all eight rows is exactly RC-1's second FR-14 state, and it is the **live** state on day one: until the first screen save, every area renders *"last changed at Y — actor not recorded"*. That is correct and must not be mistaken for a bug. (3) The FK is a new hazard the plan did not have — **K-11**: an actor id that is not in the referenced relation makes the **whole save** fail, not just the attribution. Both current admins pass, but a newly-added admin who has never completed a profile might not.

### 2.3 New findings (W-1 … W-14)

| # | Finding | Consequence |
|---|---|---|
| **W-1** | **`evaluateAreaRow` knows the winning level for every field and throws it away.** The precedence loop (`modelSettings.ts:505-560`) iterates `[callLevel, areaLevel]` and `break`s on the first accepted value, but `ResolvedBosLlmSettings` carries only the value | FR-4's provenance badge cannot be read off the existing API. **Additive `provenance` on `AreaEvaluation`** (§3.2). **Q-1 ✅ approved, subject to RC-2** |
| **W-2** | **`lib/ai/pricing.ts` has no listing accessor.** `getPricing` is per-model; the cache is a private `Map` and `getPricingInternal` falls back to the in-code `FALLBACK_PRICING` map | FR-8 needs an additive `listPricedModels()` on the **same** module (§3.3). **Q-2 ✅ approved incl. the fallback entries; the filter moves out of the route (RC-3)** |
| **W-3** | **`getCacheStats()` already returns `{ size, ageMs, ttlMs }`** (`pricing.ts:310`) | FR-8's "shows its cache age" needs nothing new |
| **W-4** | **R-2's rendering half is not satisfiable from the row.** The row records no door, and the row's `value` JSON cannot carry one: an unknown top-level key raises `unknown_field`, and `validateAreaRow`'s `rejected` includes `unknown` — a `door` key inside the row would make **every save refuse itself** | **Resolved: Q-3 → option C.** `details.door` on the audit entries only; no column, no migration, no audit read. **RC-1** recovers the on-card signal for free through the three-state FR-14 rendering (§3.6) |
| **W-5** | **`AdminRouteUser.email` is optional** (`requireAdminRoute.ts:31`) | Exclude the actor on **either** a normalised-email match **or** a non-null `user_id` match (§3.5). SA: *"stronger than my R-4 wording … approved as written"* |
| **W-6** | **A cross-tenant sum needs more than one statement.** PostgREST gives an exact `count` with `head: true`, but no `sum` without an RPC | **Resolved by RC-6: drop `costSum` entirely.** The aggregate is **two** bounded statements — no cap, no flag, no capped cost number rendered during a cost incident (§3.4) |
| **W-7** | **`scripts/bos-llm-settings.ts` exports `runBosLlmSettingsCommand(argv)`** (`:494`) and parses flags from a plain array | FR-24's actor resolution and its three outcomes are **unit-testable without a database** |
| **W-8** | **`app/admin/system-config/page.tsx` contains 20 `console.*` calls** | **D-U1: not touched.** The sidebar is the nav (user, 2026-09-22; SA Q-7) |
| **W-9** | The admin nav is `app/admin/components/AdminSidebar.tsx` (flat `{ name, href }` groups; "System Config" at `:145`) | One entry, in the same group as System Config |
| **W-10** | `TOKEN_USAGE_COLUMNS` (`:105`) has no aggregate shape | With RC-6 the two statements need only `count` (`id`) and one `created_at` — **no new column constant is required** |
| **W-11** | **The route joins both CI gates the moment it imports `callCatalog`.** So do `adminSettingsView.ts`, the options module and the notification helper | §3.7's four shapes, asserted in-repo by S1-T12 before CI sees them |
| **W-12** | `getByKeys` is one statement over the eight keys and returns `updated_at` / `updated_by` | The whole `GET` is **two** queries plus the memoised pricing read |
| **W-13** | **(SA's RC-4, verified.) FR-11's switch-off refusal is script-local.** `validateAreaRow` does not know it: the "a call-level `enabled: true` survives an area-level `enabled: false`" check lives at `scripts/bos-llm-settings.ts:284-303`, between the validation and the write | Re-implementing it in the route makes the screen the **softer** door on the one refusal an emergency depends on. **A shared predicate in `lib/business-os/llm/` (§3.9)**, landing in slice 1, used by the route in slice 3 and adopted by the script in slice 4 |
| **W-14** | **`updated_by` carries a foreign key** (§2.2) | **K-11.** An unsatisfiable actor id fails the **entire** save, not just the attribution. Slice 3 must classify an FK violation distinctly rather than returning a bare 500 |

---

## 3. Design

### 3.1 The route contract

**File:** `app/api/admin/business-os/llm-settings/route.ts` — `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, and (from slice 3) an explicit `maxDuration` so RC-5's 3 s deadline is provably inside the platform limit rather than inside an assumption.

```
GET  /api/admin/business-os/llm-settings
  -> { success: true, data: { areas: AreaView[], modelOptions: ModelOptions, generatedAt } }

GET  /api/admin/business-os/llm-settings/ledger?area=<area>&since=<iso>
  -> { success: true, data: LedgerCheck }          (a nested route; see §3.4)

PUT  /api/admin/business-os/llm-settings           (slice 3)
  body { area: <BOS_LLM_AREAS enum>, row: unknown, dryRun?: boolean }
  -> dryRun  : 200 { ok, rejected, adjusted, resolvedBefore, resolvedAfter?, rowChangedAt? }
  -> write   : 200 { ok: true, adjusted, resolvedAfter, updatedAt, updatedByLabel, notification? }
  -> refusal : 400 { success: false, error, rejected: Issue[] }   (a REAL write only)
```

Shape rules, all of them load-bearing:

- **`requireAdmin(requestLogger)` is the first statement.** Nothing above it parses a body, reads the database or writes. `const gate = await requireAdmin(requestLogger); if (gate instanceof NextResponse) return gate;` — **not** the `llm-usage` sibling's inline `AdminAccessService` call, which fails the required `Admin authz surface guard`.
- **The client never names a key.** `area` is parsed with `z.enum(BOS_LLM_AREAS)` and the key is `bosLlmAreaKey(area)`, total over `BOS_LLM_AREAS`.
- **RC-8 — a dry-run that refuses is `200` with `ok: false`.** A preview that correctly refuses is a *successful request*; only a real write refusal is 400 (FR-9). A 400 on dry-run makes "preview" and "failure" indistinguishable to the client and pushes the UI into treating a normal refusal as an error.
- **RC-8, second half — when `ok === false` the dry-run response omits `resolvedAfter` entirely.** `validateAreaRow` returns `resolved` even for a rejected row; shipping it beside the refusals invites the UI to render "this is what you will get" when nothing will be written. Omitting it server-side makes that mistake unrepresentable.
- **`rowChangedAt`** (SA's naming suggestion; was `staleSince`) is the row's `updated_at` at dry-run time, so the UI can say *"changed by someone else since you opened this page"*.
- **No `error.message` to the client** outside development.
- The route is thin: it gates, validates, delegates to `lib/business-os/llm/adminSettingsView.ts`, and shapes the response.

### 3.2 Provenance (FR-4, W-1, RC-2)

Additive, inside the one resolver:

```ts
export type BosLlmFieldLevel = 'call' | 'area' | 'default';
export type BosLlmCallProvenance = Record<BosLlmSettingField, BosLlmFieldLevel>;

export interface AreaEvaluation {
  enabled: boolean;
  calls: Map<string, ResolvedBosLlmSettings>;
  issues: BosLlmSettingIssue[];
  provenance: Map<string, BosLlmCallProvenance>;   // NEW
}
```

Populated where the loop already decides: each field's `break` records `level!.level`, and falling through to the code default records `'default'`. `validateAreaRow` passes it through on `AreaRowValidation`.

**Why in the resolver:** the route alternative re-walks `call → area → default` over the stored row — a second implementation of precedence that gets the "a *rejected* call-level model falls through to the area level" case wrong, because only the resolver knows a value was refused.

**RC-2's two conditions, both binding:**

- **(a) The view builder serialises the `Map` to a plain object.** A `Map` through `JSON.stringify` silently becomes `{}`, and this payload is rendered — the class of bug that ships green. `adminSettingsView.ts` converts; no `Map` crosses the response boundary. S1-T3 asserts the serialised payload, not the in-memory object.
- **(b) "Additive" is pinned by a test, not claimed.** S1-T4b asserts `resolveBosLlmSettings` and `isBosLlmAreaEnabled` return the same values field for field before and after.

### 3.3 Model options (FR-8, W-2, RC-3)

Additive on `lib/ai/pricing.ts`:

```ts
export async function listPricedModels(): Promise<{
  models: Array<{ provider: string; model: string; inputCostPerToken: number; outputCostPerToken: number }>;
  cacheAgeMs: number;
  cacheTtlMs: number;
}>
```

It loads through the **same** private path `getPricingInternal` uses (identical TTL, repository read and failure behaviour) and merges the in-code `FALLBACK_PRICING` entries that lookup would also serve — excluding them would make the picker narrower than the validator (K-5).

**RC-3 — the filter does not live in the route.** Option construction moves to `lib/business-os/llm/modelOptions.ts`: the `inputCostPerToken > 0 && outputCostPerToken > 0` rule, the `ALLOWED_PROVIDERS_LAYER2` restriction and the `isImageModelName` split all sit there. `route.ts` holds **no guardrail-shaped expression**, so slice 3's AC-9 source test (S3-T3: "no price lookup, no temperature bound, no provider list") stays a meaningful test instead of one loosened to fit slice 1's code. It also removes the one place a model-keyed expression was likely to trip the literal gate.

`validateAreaRow` stays authoritative; free text is accepted and validated identically; the list is labelled **advisory, refreshed hourly** with its `cacheAgeMs` (W-3).

### 3.4 The ledger check (FR-18, FR-19, RC-6)

**New repository method** on `TokenUsageRepository`, following `listChatCallsAllAccountsInWindow` exactly — explicit name, a doc block saying it is the deliberate cross-tenant read, an info-level log, callers named:

```ts
async summariseFeatureAllAccountsInWindow(
  window: TokenUsageWindow,
  feature: string,
): Promise<RepositoryResult<{ count: number; latestAt: string | null }>>
```

**Two** bounded statements (RC-6): exact `count` (`head: true`) and one newest-first `limit 1` for `latestAt`. **No cost, no cap, no flag** — no reading uses cost, and a number silently capped at 1,000 rows, rendered during a cost incident, is K-1 appearing somewhere new. **No per-account breakdown, no owner text, no free-text feature** — `feature` comes from `bosFeature(area)` server-side.

**The two windows** (`app/api/admin/business-os/llm-settings/ledger/route.ts`):

- `after` = `[save + BOS_LLM_SETTINGS_CACHE_MS, now]` — imported from `modelSettings`, never the number 60000 written down.
- `before` = the **same-length window ending at the save time**.

**Three readings, and only one corroborates anything:**

| # | Condition | Reading |
|---|---|---|
| 1 | `after.count > 0` | *Calls are still arriving — the switch is not holding on every instance.* |
| 2 | `after.count === 0 && before.count > 0` | *No calls completed since X, and this area was making calls before the change.* |
| 3 | `after.count === 0 && before.count === 0` | *This area had no traffic before the change either — the ledger cannot tell you whether the switch is holding.* |

Reading 3 is a first-class outcome with the same weight as reading 2 — not a muted footnote — and the panel has no green-tick affordance in any branch. The *"corroboration, not proof — a `token_usage` insert failure is logged and swallowed"* sentence is **one exported string shared by the route response and the component** (SA's optimisation 3), so a copy edit cannot make them disagree. No reading ever says an area is off.

**RC-D — the 24 h bound makes this a POST-SAVE affordance, and slice 2 must treat it as one.** All eight rows carry the seed `updated_at` of 2026-09-21, so a panel that renders on page load from the row's `updated_at` takes a **400 on every area from day one**. The refusal is correct and the coupling is the point. Slice 2 must therefore either offer the check only **after a save**, or render the 400 as a first-class ***"too long ago to check"*** state — **never as an error**, which would be the panel failing loudly about its own design rather than about the system. Recorded here beside FR-18 so it is not discovered in QA.

**Chat** (FR-19) short-circuits in the route **before the repository call** (SA's addition), returning `{ kind: 'ledger_cannot_answer' }` with no counts — so a chat request issues **no cross-tenant read at all**, and the readings are never produced rather than merely hidden.

### 3.5 The switch-off notification (FR-25, R-3, R-4, RC-5)

**New shared helper** `lib/business-os/llm/areaSwitchOffNotice.ts` (`import 'server-only'`, RC-9) — behind a helper per SA-9, because both doors call it:

```ts
export interface SwitchOffNoticeResult {
  state: 'sent' | 'not_sent' | 'no_recipients' | 'timed_out';
  provider: string | null;
  recipientCount: number;
}
```

- Recipients: `listActive()` **minus the actor**, excluded on **either** a normalised (`trim().toLowerCase()`) email match **or** a non-null `user_id` match (W-5). The OR can only over-exclude the actor themselves, which is the intent.
- Empty list → `no_recipients`, an **info** line, no send.
- One `sendEmail({ to: [...] })`. Content: the area, who, when, the fail-open line. **No owner data, no prompt text.**
- `{ sent: false }` → **`warn`** with `recipientCount` and `provider`.
- **Never throws** (its own try/catch).

**RC-5 — awaited, 3 s, and honest about what a timeout means.** Awaiting is right for two reasons, and the second is the stronger: on Vercel, work not awaited before the response can be frozen with the invocation, so fire-and-forget is unreliable **delivery**, not merely an unreported result. Three binding details:

- **(a) 3 s**, not 5, and the route declares `maxDuration` explicitly — the `PUT` already spends a fresh read, a validation with pricing lookups and a write before the send.
- **(b) Racing abandons a promise; it does not cancel it.** The original `sendEmail` promise keeps its own `.then` / `.catch` logger, so the eventual outcome still reaches the log even after the response has gone.
- **(c) `timed_out` must not claim non-delivery.** Copy: *"could not confirm the email went out — assume it did not and tell them yourself."* `not_sent` keeps its wording, because there the transport **told** us.

**R-3's on-screen half:** the `PUT` response carries `notification`, and the post-save confirmation says one of:

- `sent` → *"The other admins were emailed."*
- `not_sent` → *"Could not notify the other admins (no email transport configured) — tell them yourself."*
- `timed_out` → *"Could not confirm the email went out — assume it did not and tell them yourself."*
- `no_recipients` → *"You are the only active admin — nobody else was notified."*

### 3.6 The actor and "last changed by" (FR-13, FR-14, FR-24, R-1, R-5, RC-1)

**`SystemConfigRepository.set` gains a fifth, optional options argument** — not a fifth positional string, so a caller cannot mistake it for `description`:

```ts
async set(key, value, category?, description?, opts?: { actorId?: string | null })
```

- **Update branch:** `{ value, updated_at, ...(actorId ? { updated_by: actorId } : {}) }`.
- **Insert branch (R-5):** sets `updated_at` explicitly **and** `updated_by`. FR-7's "running on code defaults" state takes exactly this path, so without R-5 the **first** save of a deleted area would render with no attribution.
- Omitting `opts` behaves **byte-identically to today** — asserted (S1-T10).

**How slice 3 keeps attribution separable from the write (D-U2).** The FK makes `updated_by` a value the *database can reject*, so it must never share a failure path with the settings change. There is no transaction to lean on — `set()` issues one statement — so separability comes from **sequencing, not rollback**:

1. attempt `set(key, row, category, undefined, { actorId })`;
2. if that fails **and** the failure is a foreign-key violation on `updated_by` (classified by error **code**, never by message text), **retry `set()` with no actor at all**. The retry carries the identical `value`, so the settings change is untouched by the first statement's rejection;
3. audit at `critical` with the believed actor and the reason, and tell the admin on screen.

**Two conditions SA set on this (2026-09-22), binding on slice 3:**

- **Catch on the Postgres error CODE `23503` plus the constraint name — never a message substring, and never a pre-emptive two-statement write.** A substring match would some day swallow an unrelated foreign key. And splitting the normal path into "write the value, then write the actor" would make **every** save two round trips and open a window where a concurrent reader sees the new value beside the **previous** actor — worse than the problem being solved. The retry re-issues an idempotent UPDATE of the same value, so a double write is harmless.
- **The fallback makes RC-1's inference unsound, and the audit entry becomes the only discriminator.** With no sentinel, a *screen* save that fell back to unattributed leaves a row **indistinguishable** from a break-glass change — so *"a present row with no actor is de-facto a command-line change"* stops being true the moment this fallback can fire. The copy as specified is safe because it claims only *"actor not recorded"*; **slices 2 and 3 must never promote it to a break-glass claim**. That makes the `critical` entry load-bearing: it is written **after** the settings write and must not be able to fail it (the existing AC-21 / S3-T14 property).

The property to preserve: **the row's `value` is never a function of whether the actor resolved.** A future refactor that merges the two attempts into one statement, or builds the payload differently on the retry, breaks D-U2 — S3-T18 exists to catch exactly that.
- **RC-1, forbidden explicitly:** the door is **never** smuggled into `description` (or any other free-text column). It is a human-readable column the seed already writes; overloading it is a schema change without a migration. `details.door` on the audit entry is the only record of which door.

**FR-14 renders three row states (RC-1).** §3.6's first draft collapsed "no row" and "unattributed change" into the same blank; they are different facts:

| Row state | Rendering |
|---|---|
| **No stored row** | The FR-7 line — *no stored row; every call is running on its code default*. No attribution line |
| **Row present, `updated_by` null** | ***"last changed at Y — actor not recorded; see the audit trail"***. Never blank, never "unknown", and **not** the same as "no row" |
| **Row present, `updated_by` set** | The admin's email, or the **raw id labelled unresolved** when it matches no bound active admin |

This recovers the R-2 signal for free in the only case that matters: the screen **always** attributes, so a present row with no recorded actor is de-facto a break-glass change, and the card says so without a column. **It is also the live state of all eight rows today** (§2.2) — correct on day one, not a bug.

**R-1's lookup guards — two, independent (RC-11):**

1. **Build side:** the id→email map **skips every admin whose `user_id` is null**. Without it, `admin.user_id === row.updated_by` matches `null` to `null` and renders every unattributed row as that admin's email.
2. **Lookup side:** `updated_by === null` is branched **before** any lookup. Without it, a null `updated_by` renders as a raw id labelled unresolved — i.e. the string `null` on screen.

Each alone is wrong in a different way, so S1-T11 and S1-T11b assert them **independently**: removing either guard must fail a test.

**FR-24's three actor outcomes (R-1)** — a pure function in the script, `resolveBreakGlassActor(email | undefined, admin | null)`:

| Input | Outcome | `userId` | `updated_by` | `details.actorSource` | Severity |
|---|---|---|---|---|---|
| active admin with a **bound** `user_id` | attributed | that id | that id | `break_glass_attributed` | `warning` |
| active admin with **`user_id === null`** | **`break_glass_email_unbound`** (R-1) | `null` | `null` | `break_glass_email_unbound` + the email in `details` | **`critical`** |
| absent, or no active admin | `break_glass_unattributed` | `null` | `null` | `break_glass_unattributed` (+ `--reason`) | **`critical`** |

All three **write**. Missing attribution never blocks an emergency. Outcomes 2 and 3 print a loud warn line.

### 3.7 Staying inside the two CI gates (FR-2, FR-6, W-11, RC-9)

`route.ts`, the ledger route, `adminSettingsView.ts`, `modelOptions.ts`, `switchOffPredicate.ts` and `areaSwitchOffNotice.ts` import `callCatalog`, so all six are in `typecheck:bos-llm` **and** `check:bos-llm-literals`. By design they contain **no model-id union type**, **no `z.enum` of model ids** (the only enum is `z.enum(BOS_LLM_AREAS)`), **no `switch` on a model name** (image-vs-token branching uses `isImageModelName` from the exempt policy module) and **no price-index key literal**. RC-3 helps here too: moving option construction out of the route removes the one place a model-keyed expression was likely to appear.

**If one becomes unavoidable: a narrow rule change in `scripts/check-bos-llm-literals.ts` with SA review — never a new file exemption** (two exist; neither is widened) **and never a baseline regeneration.** Dev raises it as a question; Dev does not edit the gate unilaterally.

**RC-9 — every new server module starts with `import 'server-only'`** (`adminSettingsView.ts`, `modelOptions.ts`, `switchOffPredicate.ts`, `areaSwitchOffNotice.ts`; the repo already uses this in `lib/branding/*`). It turns FR-6's "the client imports no server module" into a **build failure** rather than a source test a future refactor can quietly stop covering. S2-T2 stays, and S1-T12 additionally asserts the import is present (SA optimisation 2).

### 3.8 Concurrency — deliberately absent

No concurrency control: no `setIfUnchanged`, no `expectedUpdatedAt`, no 409, no race test (D-10, withdrawn by the user: *"we have only 2 admins, we can communicate and decide who does what"*). **Two simultaneous saves of the same area silently last-write-wins, and the overwritten admin is not told at save time.** Instead: "last changed by X at Y" on the **collapsed** card, and R-4's fresh `resolvedBefore` + `rowChangedAt` at dry-run time, which puts a change committed since the page loaded **inside the diff the admin is required to look at**.

**Re-open trigger:** a third admin, **or any non-human writer**. Recorded in runbook §8 (FR-28).

### 3.9 The switch-off predicate (FR-11, RC-4, W-13)

`validateAreaRow` does **not** know FR-11's rule; it lives at `scripts/bos-llm-settings.ts:284-303`, between validation and write. Re-implementing it in the route would make the screen the **softer** door on the one refusal an emergency depends on — exactly what the requirement's *"not a weaker door than the script"* clause exists to prevent, and a drift that no test in either door would notice.

**New pure module** `lib/business-os/llm/switchOffPredicate.ts` (`server-only`, in both gates):

```ts
/** Call names whose own `enabled: true` would survive an area-level `enabled: false`. */
export function callsBlockingSwitchOff(area: BosLlmArea, candidateRow: unknown): string[];

/** The `--include-calls` transform: the same row with those entries set to false. */
export function withCallsSwitchedOff(area: BosLlmArea, candidateRow: unknown): unknown;
```

A function of the **candidate row** only — no repository, no cache, no I/O — so both doors can call it at the same point in their flow. **Slice 1** ships it with its unit tests (no caller). **Slice 3** uses it in the route. **Slice 4** replaces the script's inline block with a call to it, and a test asserts the script produces the same refusal and the same `--include-calls` row as before.

---

## 4. Slice 1 — Read route, ledger aggregate, actor on `set()`

**Scope:** FR-1, FR-2 (`GET`), FR-4 … FR-8, FR-11 (predicate only), FR-12 (lock metadata), FR-13, FR-14, FR-18 (data). **Size: L.** **Behaviour on deploy: nothing is writable through the screen; the script is still the only writer.** The new `set()` parameter and the switch-off predicate have **no caller** in this slice.

### 4.1 Files

| File | Action | Change |
|---|---|---|
| `app/api/admin/business-os/llm-settings/route.ts` | create | `GET` only. `requireAdmin` first, Zod, Pino + `correlationId`, `nodejs` + `force-dynamic`. §3.1, §3.7 |
| `app/api/admin/business-os/llm-settings/ledger/route.ts` | create | `GET` for FR-18: `area` + `since`, two windows, three readings, the chat short-circuit **before** the repository call. §3.4 |
| `app/api/admin/business-os/llm-settings/__tests__/route.test.ts` | create | S1-T1 … S1-T8, S1-T11, S1-T11b, S1-T12 |
| `app/api/admin/business-os/llm-settings/__tests__/ledger.route.test.ts` | create | S1-T15 |
| `lib/business-os/llm/adminSettingsView.ts` | create | `server-only`. Eight rows → per-area view; the id→email map with **both** R-1 guards; serialises provenance to a plain object (RC-2a) |
| `lib/business-os/llm/modelOptions.ts` | create | `server-only`. RC-3 — the `> 0` on both sides, the provider restriction, the image split. **Out of the route** |
| `lib/business-os/llm/switchOffPredicate.ts` | create | `server-only`. §3.9 — RC-4's shared predicate + transform. No caller yet |
| `lib/business-os/llm/__tests__/adminSettingsView.test.ts` | create | S1-T3 … S1-T7, S1-T11, S1-T11b |
| `lib/business-os/llm/__tests__/switchOffPredicate.test.ts` | create | S1-T16 |
| `lib/business-os/llm/__tests__/modelOptions.test.ts` | create | **S1-T7 / AC-7** (SA must-fix 1) — 15 tests; the guardrails are real, only `listPricedModels` is stubbed |
| `lib/business-os/llm/ledgerCheckCopy.ts` | create | The shared reading text and caveat. **No `server-only`** — the slice-2 panel imports it |
| `scripts/lib/bos-llm-scope.ts` + `scripts/check-bos-llm-literals.ts` | modify | **The D-11 ruling:** `LITERAL_SCOPE_INCLUSIONS` and its `included` marker. **Ships as its own small PR with SA review** before slice 2 merges |
| `lib/business-os/llm/modelSettings.ts` | modify | §3.2 — additive `provenance` (Q-1 ✅, RC-2) |
| `lib/business-os/llm/__tests__/modelSettings.test.ts` | modify | S1-T4, S1-T4b |
| `lib/ai/pricing.ts` | modify | §3.3 — additive `listPricedModels()` (Q-2 ✅) |
| `lib/ai/__tests__/pricing.test.ts` | modify | S1-T13 |
| `lib/repositories/SystemConfigRepository.ts` | modify | §3.6 — optional `opts.actorId`, **both branches** (R-5) |
| `lib/repositories/__tests__/SystemConfigRepository.test.ts` | modify/create | S1-T9, S1-T10 |
| `lib/repositories/TokenUsageRepository.ts` | modify | §3.4 — `summariseFeatureAllAccountsInWindow`, **count + latest only** (RC-6) |
| `lib/repositories/__tests__/TokenUsageRepository.test.ts` | modify | S1-T14 |
| `lib/business-os/usage/__tests__/tokenUsageRepository.contract.test.ts` | modify | The new method named beside the other all-accounts read |

**No migration** (Q-3 → C; RC-10 proved the column already exists).

### 4.2 Tasks

- ✅ **T1.0** **First action** (RC-12): record the three baselines before any edit — `typecheck:bos-llm` files/errors/new, `check:bos-llm-literals` violations, the literal-scope `--list` file set.
- ✅ **T1.0b** RC-10's live schema check — **done**, recorded as **G-18** (§2.2).
- ✅ **T1.1** `provenance` on `evaluateAreaRow` / `validateAreaRow` (§3.2).
- ✅ **T1.2** `listPricedModels()` (§3.3) and `modelOptions.ts` (RC-3).
- ✅ **T1.3** `set()` optional actor, both branches (§3.6, R-5).
- ✅ **T1.4** `summariseFeatureAllAccountsInWindow`, two statements (RC-6).
- ✅ **T1.5** `switchOffPredicate.ts` (RC-4, §3.9).
- ✅ **T1.6** `adminSettingsView.ts` — both R-1 guards, the three FR-14 states (RC-1), provenance serialised (RC-2a).
- ✅ **T1.7** `GET /api/admin/business-os/llm-settings`.
- ✅ **T1.8** `GET …/ledger`.
- ✅ **T1.9** Tests S1-T1 … S1-T16 — **96 new tests across 7 files**, all passing.
- ✅ **T1.10** Gates (§4.4) measured and recorded verbatim; scope `--list` diff explained file by file.
- ⬜ **T1.11** SA code review → QA → user view → RM.

### 4.3 Tests

| ID | Asserts | AC |
|---|---|---|
| **S1-T1** | `GET` returns **401** signed out and **403** for a signed-in non-admin, on both routes, reading nothing either time. A source test asserts `requireAdmin` is the **first statement** and the file contains no `AdminAccessService` reference | AC-1 |
| **S1-T2** | The query schema rejects an unknown, padded, numeric or prototype-polluting `area`; a source test asserts `bosLlmAreaKey` is the only key source | AC-1, FR-2 |
| **S1-T3** | With the eight seeded rows, the **serialised** payload's `resolved` per call equals `validateAreaRow(area, row).resolved` field for field, for all eight areas; **provenance survives `JSON.stringify` as a plain object** (RC-2a) | AC-3 |
| **S1-T4** | Provenance: `call` / `area` / `default`, plus the case only the resolver gets right — a **rejected** call-level model with a valid area-level one → `area`. `temperature: undefined` serialises as "not set", never `0`, never blank | AC-4 |
| **S1-T4b** | **RC-2b.** `resolveBosLlmSettings` and `isBosLlmAreaEnabled` return the same values field for field as before the provenance change | AC-3 |
| **S1-T5** | An unpriced model, `temperature: 1.5`, `provider: 'anthropic'`, an unknown call name and a locked onboarding `enabled: false` → **five** issues, each with `level`, `callName`, `field`, `kind`, the resolver's own `reason` and `value` | AC-5 |
| **S1-T6** | An area with no stored row: code defaults, `rowPresent: false`, **no** attribution line, HTTP 200 | AC-3, FR-7 |
| **S1-T7** | Model options: input > 0 **and** output > 0 present; input-only and 0/0 absent; non-`openai` absent; `cacheAgeMs` / `cacheTtlMs` returned. **RC-3:** a source test asserts the `> 0` rule, the provider list and the image split appear in `modelOptions.ts` and **not** in `route.ts` | AC-7 |
| **S1-T8** | Lock metadata for onboarding's switch, `chat/planner`'s switch and temperature, and the image temperature, each with its reason | AC-12 (read half) |
| **S1-T9** | `set(..., { actorId })` writes `updated_by` **and** `updated_at` on the **update** path **and** the **insert** path (R-5) | AC-13 |
| **S1-T10** | `set()` with **four** arguments issues exactly today's statement — no `updated_by` key in the update payload — so the Step 0 route and the script are undisturbed | AC-13 |
| **S1-T11** | **R-1 guard 1 (build side), asserted alone (RC-11):** `listActive()` containing an admin with `user_id: null` produces a map with **no `null` key**; a row whose `updated_by` is null therefore cannot match it | AC-14 |
| **S1-T11b** | **R-1 guard 2 (lookup side), asserted alone (RC-11) + RC-1's three states:** no row → the FR-7 line; row with `updated_by: null` → ***"last changed at Y — actor not recorded"***, never blank, never "unknown", never the string `null`, and **not** the no-row rendering; row with a bound id → the email; row with an unmatched id → the raw id labelled unresolved | AC-14 |
| **S1-T12** | Source test over the six in-gate files: no model-id union, no `z.enum` of model ids, no `switch` on a model name, no price-index key literal, no `console.*`, **and `import 'server-only'` present** (RC-9, SA optimisation 2) | AC-28 |
| **S1-T13** | `listPricedModels()` returns the DB-cached rows **and** the in-code fallback entries, reports `cacheAgeMs`, and does not re-implement `getPricingInternal`'s lookup | AC-7, FR-8 |
| **S1-T14** | The aggregate returns **count and `latestAt` only** (RC-6 — no `costSum`, no cap, no flag); exposes no per-account rows and no owner text; rejects a bad window; is named `…AllAccountsInWindow` | AC-25 |
| **S1-T15** | The ledger route: `feature` from `bosFeature(area)` and a `feature` in the query string **ignored**; `after` starts at `since + BOS_LLM_SETTINGS_CACHE_MS`; `before` is the same length ending at `since`; **all three readings** incl. reading 3 on a quiet area (`briefing`); `area: 'chat'` → `ledger_cannot_answer`, no counts, **and the repository is asserted not called**; no response string asserts an area is off | AC-17, AC-18, AC-25 |
| **S1-T16** | **RC-4.** `callsBlockingSwitchOff` names exactly the call entries holding `enabled: true` under an area-level `enabled: false`, and returns `[]` otherwise; `withCallsSwitchedOff` produces the `--include-calls` row. Both are pure — no repository, no cache. A fixture drawn from the script's own cases (`scripts/bos-llm-settings.ts:284-303`) gives the same answers | AC-11 (predicate half) |

### 4.4 Gates

Measured in this worktree. Baselines recorded at T1.0 **before** the first edit (RC-12).

**Measured 2026-09-22, verbatim. Two runs: the T1.0 baseline, and again after the SA must-fixes.**

| Gate | Before (T1.0) | After must-fixes | After RC-A—D | **After QA DEF-1—5 (final)** |
|---|---|---|---|---|
| `npm run typecheck:bos-llm` | `167/31/0 new` | `177/31/0 new` | `177/31/0 new` | ✅ `177 files in scope, 31 errors, 0 new (86.5s)` — passed |
| `npm run check:bos-llm-literals` | `38/2/0` | `43/2/0` | `43/2/0` | ✅ `43 files in scope, 2 exempt, 0 violations (19.8s)` — passed |
| `check:bos-llm-literals -- --list` | 38, 2 exempt | 43 / 2 / 1 | 43 / 2 / 1 | ✅ `included app/api/admin/business-os/llm-settings/route.ts` · `exempt lib/business-os/llm/modelSettingsPolicy.ts` · `exempt scripts/bos-llm-settings.ts` · **43 in scope, 2 exempt, 1 included by name**; baseline untouched |
| `npm run build` | — | ✓ | ✓ | ✅ `✓ Compiled successfully`, both routes in the table |
| jest (touched paths + `scripts/`) | — | 884/885 | 895/896 | ✅ **899 of 900 tests, 53 of 54 suites.** The one failure is the same **pre-existing** dated snapshot (DEF-7) |
| grep: no `'use client'` module imports the server settings modules | — | none | none | ✅ none |
| grep: no direct Supabase client outside `lib/repositories/` | — | none | none | ✅ none |

**The one red suite is pre-existing.** `lib/business-os/llm/__tests__/callParams.boundary.step3.test.ts › T3-S › chat/planner` fails on a committed snapshot that hard-codes a date: the prompt contains `Today is 2026-09-21.` and today is the 22nd. **Proved not mine** by `git stash push -u` of the entire working tree and re-running the suite: it fails identically at `HEAD`. It is a real weakness — that snapshot goes red every day after it is recorded, and a test that is always red teaches people to ignore the suite — but fixing it is not this slice's business. **Flagged for the TL/SA as a follow-up, not silently absorbed.**

### 4.5 Implementation notes and deviations (Dev, 2026-09-22)

| # | Note |
|---|---|
| **D-1** | **The picker ASKS the guardrail instead of restating it — stronger than RC-3 required.** RC-3 said to move the `> 0` filter out of `route.ts` into a module. While doing that I found `checkModelAcceptable(area, callName, provider, model)` is **already exported** from `modelSettings.ts` — the resolver's own per-call check. So `modelOptions.ts` restates **nothing**: it enumerates candidates from `listPricedModels()` and asks the guardrail about each one. The picker is now *by construction* the set `validateAreaRow` accepts, and a new refusal reason narrows it on the next request with no change here. This also disposes of K-5 (a picker narrower than the validator) at the root rather than by labelling. |
| **D-2** | **One additive parameter was needed to make D-1 affordable.** `checkModelAcceptable` created a fresh `newGuardrailContext()` per call, so asking it ~40 × 22 questions would have re-read the image configuration from the repository each time. It now takes an **optional** context (defaulted, so every existing caller is untouched) and exports `newModelCheckContext()`. Same context type the resolver uses on refill, so the answers cannot differ from the resolver's. |
| **D-3** | **The option list is per CALL, not per area.** Acceptability is a property of the call: a reasoning model is refused for a call that sends a sampling penalty or a locked temperature and accepted for one that does not, and an image call answers to an entirely different check. One list per area would have been wrong for some of its calls. |
| **D-4** | **The call's own code default is always offered.** The resolver accepts a value equal to the code default unconditionally (it is what runs today), even when the pricing snapshot has not heard of it. Without this, an operator who changed a model could be left with no way back to where they started. |
| **D-5** | **⚠️ The shared switch-off predicate reports only SWITCHABLE calls — a deliberate difference from the script's inline block, and a question for SA (Q-8).** The script's `:284-303` filters on `enabled === true` alone, so it would name a non-switchable call such as `chat/planner`. That is wrong twice over: the planner cannot keep spending (the chat AREA gate stops it at route entry, D-27), and `--include-calls` would then write `enabled: false` into it — producing a row `validateAreaRow` **refuses** as `locked`. So the shared predicate skips non-switchable calls, which is the same reasoning that deleted the S1-7 "PARTIAL SWITCH" warning. **Nothing changes yet** (slice 1 ships no caller), but when the script adopts this in slice 4 its behaviour changes in that corner. Raised, not absorbed. |
| **D-6** | **`listPricedModels` filters nothing, on purpose.** It reports what `getPricingInternal` would serve — database rows **and** the in-code `FALLBACK_PRICING` entries — and leaves every policy decision to the caller. Pushing Business OS's `> 0` rule into `lib/ai/pricing.ts` would be the second opinion D-3 forbids, and it would break embeddings, whose `output: 0` is legitimate. |
| **D-7** | **Unit naming corrected.** The workplan drafted `inputCostPerToken`; the pricing cache actually holds **cost per 1,000 tokens** (despite the DB column being named `input_cost_per_token`). The returned fields are `inputPer1kTokens` / `outputPer1kTokens` so the name does not lie. The `> 0` test is unit-independent. |
| **D-8** | **A `too_soon` reading was added to the ledger route.** If an admin opens the panel within the first 60 seconds, the observation window has not opened. Returning reading 3 ("no traffic either") would be a false negative; returning nothing would look broken. It says so and **reads nothing** — one fewer cross-tenant query. |
| **D-9** | **The "corroboration, not proof" sentence is one exported string** (`lib/business-os/llm/ledgerCheckCopy.ts`, SA optimisation 3), imported by the route now and by the panel in slice 2. Plain module — no `server-only`, no catalog import — precisely so the client can share it. |
| **D-10** | **`staleSince` → `rowChangedAt`** in §3.1, per SA's optimisation 1. Not yet built (slice 3). |
| **D-11** | **The main `route.ts` is NOT in the literal gate's scope.** The scope is the catalog plus its **direct** importers; the route reaches the catalog only through `adminSettingsView`. Its four in-scope siblings are covered by CI, and the route itself is covered by the source test S1-T12, which asserts all four shapes plus Pino-only over **all five** files. Worth knowing before anyone assumes a green gate covers this route. |
| **D-12** | **Test assertions strip comments before scanning.** These files are documented with the very names they must not *use* — the route header explains at length why `AdminAccessService` is not called and why the key never comes from the request. A raw-text scan made the correct explanation fail, which would have pressured a future reader into deleting it. The gate takes the same position: it walks the AST, so "comments and JSDoc are never read". |
| **D-13** | **Pre-existing red suite, not absorbed.** `callParams.boundary.step3.test.ts` fails on a snapshot that hard-codes `Today is 2026-09-21`. Proved pre-existing by stashing the whole tree (§4.4). Flagged as a follow-up: a snapshot that goes red every day trains people to ignore the suite. |

### 4.6 SA slice-1 review — the seven must-fixes (Dev, 2026-09-22)

| # | Fix | What changed |
|---|---|---|
| **1** | **`modelOptions.ts` had no test.** | New `lib/business-os/llm/__tests__/modelOptions.test.ts`, **15 tests**, with `listPricedModels` stubbed but the **guardrails real**. The central one asserts the contract directly: for every candidate × every call of an area, "offered" equals `checkModelForCall(...).ok`. §4.1 gains the row. |
| **2** | **The global provider list was restated, and the comment was false.** | The pre-filter on `ALLOWED_PROVIDERS_LAYER2` is **gone**. `checkModelForCall` runs the call's own `checkProvider`, and the payload now carries **`allowedProvidersByCall`** read from each `policy.allowedProviders` instead of one area-wide list. The comment claiming "`checkProvider` remains the gate" is replaced by the module header recording **both** mistakes, because they are the tempting shape. |
| **3** | **The picker asked a function the resolver does not use.** | New export `checkModelForCall(area, callName, provider, model, ctx?)` in `modelSettings.ts`: it runs `checkProvider` **and** `checkModel` — the latter carrying the four shape rules (`model_not_a_string`, `model_empty`, `model_not_trimmed`, `model_too_long`) that `checkModelAcceptable` skips. `checkModelAcceptable` is **left alone**: its job is proving the code defaults pass *with the "equal to the default" shortcut bypassed*, so neither function can be expressed in terms of the other. A `' gpt-4o '` row from `ai_model_pricing` is now absent from the picker instead of being offered and refused on save. |
| **4** | **`too_soon` was a fifth reading written inline.** | Added to `LedgerReadingKind` **and** `LEDGER_READING_TEXT`; the route now serves `LEDGER_READING_TEXT[kind]`. Also added `LEDGER_READINGS_WITH_COUNTS`, so slice 2 can tell the two count-free readings apart without a string test. Tests assert the route's text **is** the shared constant and that every kind the route can emit has an entry. |
| **5** | **`since` was unbounded.** | `MAX_SINCE_AGE_MS` (24 h), checked **before** the windows are computed — the window length is derived from `since`, so an old one sizes the scan. **Refused, not clamped** (400 + a sentence naming the limit), so nobody reads numbers for a window they did not ask for. Four tests, including "just inside the bound still works". |
| **6** | **The route header claimed it was inside the literal gate.** | Rewritten to state it is **not** a direct catalog importer, and that it is therefore **named into** `LITERAL_SCOPE_INCLUSIONS` — an inclusion, not an exemption. |
| **7** | **S1-T12's regexes and file list.** | The model-family alternation now mirrors the gate's own `MODEL_ID_PATTERNS` (`claude`, `mistral`, `kimi`, `gemini`, `llama`, `moonshot`, `deepseek`, `grok`, `dall-e`, `whisper`, …). **Mutation-proved:** a `'claude-3-5-sonnet-20241022'` literal in `modelOptions.ts` passed all five old assertions and now fails. The file list is **derived by walking the folders**, so a sixth file or a second route is covered the moment it exists, and a test asserts the list finds the route and `modelOptions.ts`. |

**The D-11 ruling, implemented.** `literalScope()` (`scripts/lib/bos-llm-scope.ts`) gains **`LITERAL_SCOPE_INCLUSIONS`** — the mirror image of `EXEMPTIONS`: named files pulled **into** scope, each with its reason, printed by `--list` as `included`. `app/api/admin/business-os/llm-settings/route.ts` is its first and only entry. **Scope 42 → 43; exemptions still 2, neither widened; no baseline regenerated** (`git status` on `scripts/typecheck-bos-llm.baseline.json` is clean). Transitive closure was not implemented, per the ruling. **This is a gate change and ships as its own small PR with SA review before slice 2 merges.**

**Also taken (SA "should fix" 8–10), since all three were one line each:**

- **8** — `summariseFeatureAllAccountsInWindow`'s doc said "THREE FACTS" and listed two. Now "TWO FACTS".
- **9** — `buildAdminSettingsView` now builds **one** `ModelOptionsContext` per request (one pricing snapshot, one guardrail context) and runs the eight areas through `Promise.all`. Previously each area re-entered `listPricedModels()` and built a fresh context, so the image configuration was read eight times and no price lookup was shared. Two tests pin it, plus one recording that the image **default** costs no repository read at all (`checkModel` returns early for a value equal to the default — which is also why the first version of that test asserted the wrong thing).
- **10** — the two `data!` assertions in the ledger route are replaced by a guard, so a `{ data: null, error: null }` result becomes a classified failure rather than a throw inside the happy path.

### 4.7 SA re-check — RC-A to RC-D (Dev, 2026-09-22)

| # | Item | What changed |
|---|---|---|
| **RC-A** | **Two of S1-T12's five regexes were dead.** Written as plain template literals, the `case\s+` rule compiled to `/cases+/` and the price-index rule to a character class, so the switch-on-a-model rule could never fire. Coverage survived only because the broad quoted-literal rule subsumes those shapes — luck, not design. | The five rules are now a named `LITERAL_RULES` table built with `String.raw`, and **each carries a `mustMatch` sample it is asserted to match** — so every rule is proved **alive independently of whether the files happen to be clean**, which is the property that was missing. A regex that cannot match is worse than an absent one, because it reads as coverage. A further test **measures** the subsumption rather than leaving it as folklore: the broad rule covers **all three** shape rules (not two — the `z.enum` sample contains a quoted model id as well, which is why the breakage hid), while the temperature rule is genuinely independent. The per-file assertion now reports `{ file, rule, matched }`, so a failure names the rule instead of dumping a regex. |
| **RC-B** | **The inclusion list shipped without the discipline `EXEMPTIONS` has** — no equality cap and no stale-entry check, so a rename would drop the route back out of scope **with a green gate**: the exact failure the list was written to prevent. | The gate now **fails hard** on an inclusion naming a file that is not in scope (`staleInclusions`, exported and tested), saying plainly that the file it covered is no longer checked. Five new tests in the gate's own suite: the **equality cap** mirroring the `EXEMPTIONS` one; that the inclusion genuinely pulls the route into scope; that the route does **not** reach scope by the direct-import rule (so the inclusion can be retired if that ever changes); that a lost file is reported; and that the predicate **can only ever add** files. |
| **RC-C** | **The payload carried two provider lists** — the global `AreaView.allowedProviders` beside the authoritative per-call `modelOptions.allowedProvidersByCall`. That is the original bug one layer up: slice 2 could render the global one and be wrong the day a call narrows. | The area-level field is **removed**, and the type carries a note saying why there deliberately is none. Two answers to one question is how this went wrong the first time. |
| **RC-D** | **Recorded for slice 2, not fixed here** (see §3.4). The 24 h `since` bound makes the ledger panel a **post-save affordance**: every row carries the 2026-09-21 seed, so a panel rendered on page load would 400 on **every** area from day one. Slice 2 must offer the check only after a save, or render the refusal as a first-class *"too long ago to check"* state — **never as an error**. | Recorded beside FR-18 so it is not discovered in QA. |

**SA's rulings, recorded so they are not re-litigated.** The two model-check functions are **approved, not a D-3 duplication**: both are different-length prefixes over the same private `checkTokenModel` / `checkImageModel` chain, so no rule is restated anywhere, and `checkModelAcceptable` now has exactly **one** caller in the tree (the T1-3 defaults proof) — a test-only assertion helper, not a competing production answer. Residual risk is **naming**, not logic; two Low follow-ups stay open (say "test-only, one caller" in its doc block, or rename it to name its single job). SA also notes the equivalence assertion in `modelOptions.test.ts` is **near-tautological** — production and test call the same function — and that the **eight absolute sibling assertions** are what carry the weight. Written down here so nobody later deletes those believing the equivalence covers them. And **refuse-over-clamp** is right for a better reason than the one first given: a clamp would leave the caption *"since your change"* sitting over numbers that are not.

### 4.8 Every caller of `SystemConfigRepository.set` — the evidence the actor parameter is inert

Owed before merge (QA could not produce it; this is the PR-description list). Enumerated from the tree, non-test, on 2026-09-22.

**There are exactly THREE call sites, and none of them passes the new fifth argument.**

| # | Call site | Arity | Branch it can take | Effect of the change |
|---|---|---|---|---|
| 1 | `lib/repositories/SystemConfigRepository.ts:385`, inside **`setMultiple`** | `this.set(key, value, category)` — **3 args** | **both** (it loops over arbitrary keys) | `opts` is `undefined` → `actorId` is `null` → **`updated_by` is not in either payload**. The update branch is byte-identical to before. The insert branch now writes `updated_at` **explicitly** where it previously relied on the column default (R-5) — same value, different source |
| 2 | `app/api/admin/system-config/route.ts:273` — the **Step 0 admin route**, reaching `set` **only** through `setMultiple` | 3 args, via #1 | both | As #1. It has no direct call of its own, so AC-13's "an existing caller that omits the new parameter behaves exactly as before" is satisfied through one seam, not many |
| 3 | `scripts/bos-llm-settings.ts:354` — the **operator script** | `set(key, row, 'business_os_llm', ...)` — **4 args** | **both** (an area row may be absent) | Same: no `updated_by` written. This is the call that gains the actor in **slice 4**, not now |

**Conclusions.**

- **No production caller passes `opts` in slice 1.** The parameter is additive and unreached; SA independently confirmed this ("K-11 cannot be tripped by slice 1").
- **`updated_by` is never written as `null`.** The payload uses a spread, so an actor-less caller omits the column rather than blanking it — otherwise `setMultiple` would erase an attribution a screen save had recorded. Pinned by S1-T10 and by the "explicitly null actor" case.
- **The one genuine behaviour change is the insert branch's `updated_at`**, and it reaches all three callers. It is the same timestamp the column default produced; it is now application-generated, consistent with the update branch which has always set it in code.
- ⚠ **Found while enumerating, NOT mine to fix:** `SystemConfigService.set` (`lib/services/SystemConfigService.ts:263`) does **not** go through the repository at all — it queries `system_settings_config` directly with its own update/insert branches, while the module's own header claims *"→ `systemConfigRepository.set(key, value)`"*. So it will **never** record an actor, and it bypasses the repository layer CLAUDE.md mandates. Pre-existing and out of scope here; flagged for the TL as its own follow-up.

### 4.9 QA slice-1 defects — DEF-1 to DEF-7 (Dev, 2026-09-22)

QA: **SHIP**, 51 PASS / 2 FAIL / 1 PARTIAL / 0 BLOCKED, no High. Its 20 picker-equivalence probes ran against the **real** `validateAreaRow` save path and found **no divergence in either direction**.

| # | Defect | Fix |
|---|---|---|
| **DEF-3** (the one that mattered) | **The equivalence suite was blind to anything *offered* that was never asked about.** QA's mutation **M2** — ask about the raw candidate, push a normalised one — left the suite **15/15 green** while offering models a save refuses, because the assertion quantified over **candidates**, never over what is **offered**. | Added **DIRECTION B**: every option in the payload, across four areas and every call, is asserted acceptable to `checkModelForCall`. **The first attempt did NOT catch M2** — the fixture priced everything, so every normalised form stayed acceptable and the new assertion was as blind as the old one. Fixed by making the price mock **exact-match, as production is**, and adding a candidate priced under one exact casing (`GPT-4o-Uniq`), which `.toLowerCase()` then makes unpriced. **M2 now fails** with `offered: "openai:gpt-4o-uniq", acceptable: false`; the restored file is md5-identical to its pre-mutation backup and the suite is 16/16. |
| **DEF-1** | **`since` was bounded below but not above** — `2099-01-01` returned 200 `too_soon` saying *"about 60 seconds"*, false by 73 years. | Added `MAX_SINCE_SKEW_MS` (2 min): a `since` further ahead than clock skew is **400**, before any read. The tolerance is deliberate — `too_soon` legitimately covers "saved a moment ago", and the app server and the database need not agree to the millisecond. Refuse-never-guess now holds in **both** directions. |
| **DEF-2** | The chat-ordering test asserted `[200, 400]`, which **every** status satisfies. | Replaced with the ordering it meant to pin: Zod, then the chat short-circuit, **then** the bound — so chat answers **200** `ledger_cannot_answer` even with an ancient `since`, and still reads nothing. |
| **DEF-4** | AC-25 still said "and cost sum" after RC-6 removed it, so as written it could not pass. | The workplan's echo now says **count and `latestAt` only**, noting the requirement's wording is superseded by RC-6. |
| **DEF-5** | The refusal copy said 24 h while the two reads together reach ≈48 h. | Now says what is actually bounded — *"a change made in the last 24 hours (it also reads the same length of time before the change, so the two reads together look back about 48 hours)"* — and the constant's doc block says the same, so the next reader is not misled either. |
| **DEF-6** | `lastChangedByFor` can emit `at: null` against a `string` type. | **Recorded for slice 2** as **S2-T7c**, not fixed here: never render `null` as a date, and never `new Date(null)`, which is the epoch and would read as 1970. |
| **DEF-7** | The pre-existing dated snapshot. | **Written up standalone** in [FOLLOWUP_DATED_SNAPSHOT_PERMANENT_RED.md](/docs/workplans/FOLLOWUP_DATED_SNAPSHOT_PERMANENT_RED.md) with the fix shape (normalise a calendar date in the test's `normalise()`, exactly as `<uuid>` already is — test-only, no production change), why `-u` buys only one day, and why it cannot spread. **Not fixed inside this slice.** |

### 4.10 Rollout notes

Read-only. No page links to the routes yet. **One thing is not purely additive and it is not Business OS:** `set()`'s **insert** branch now writes `updated_at` explicitly (R-5) where it previously relied on the column default — a different *source* for the same value. Every insert caller of `SystemConfigRepository.set` is enumerated and named in the PR description before merge.

### 4.11 Why the gate PR ships its inclusion list empty (RM, 2026-09-22)

**An inclusion entry cannot ship ahead of the file it names.** SA approved shipping the `literalScope()` change as its own PR, landing *"with or before"* slice 1. In practice **only *with* is achievable**, and the reason is the guard RC-B asked for.

On the gate-only branch, `app/api/admin/business-os/llm-settings/route.ts` does not exist, so it is not in the import graph, so it is not in scope — and `staleInclusions()` reports the entry as stale and exits 1. Measured on the branch, and again in CI on PR #91 before the split was re-cut:

```
check-bos-llm-literals: FAILED. An entry in LITERAL_SCOPE_INCLUSIONS names a file that is not in scope:
  app/api/admin/business-os/llm-settings/route.ts
```

**This is the guard working, not a bug in it.** It cannot distinguish *"renamed away"* from *"not written yet"*, and it must not try: treating a missing target as acceptable is exactly the rot it exists to catch — the file silently dropping out of scope with a green gate. Weakening it to tolerate an absent file would have deleted the property QA proved (renamed → exit 1, moved → exit 1, restored → exit 0).

Note also that `.github/ci/non-deploying-change.sh` carves `check-bos-llm-literals.ts` and `lib/bos-llm-scope.ts` back out of the `scripts/**` skip, precisely because they **are** this gate — so a gate-only PR does not skip the gate, it runs it.

**The split was therefore re-cut, not the check:**

| PR | Carries |
|---|---|
| **#91** (gate) | Every rule and discipline change — the `LITERAL_RULES` table, `staleInclusions()` itself, the equality cap, the `{ file, rule, matched }` reporting — with `LITERAL_SCOPE_INCLUSIONS` **empty**. Gate: **38 in scope, 2 exempt, 0 included by name, 0 violations** |
| **#92** (slice 1) | The **inclusion entry**, beside the route it names, and the cap expectation moved to `[ADMIN_ROUTE]`. Gate: **43 / 2 / 1 included by name / 0 violations** |

So that the machinery is not left untested until the first real entry arrives, `literalScope()` and `staleInclusions()` each take the inclusion list as an **injectable argument** defaulting to the real one. On #91 the cap, the staleness failure, the not-decorative property, the load-bearing counterfactual and monotonicity are all proved **against a fixture**. The one property a fixture cannot prove — that the real entry pulls a real file into scope — is asserted in #92, the change that adds the entry.

**Generalise this:** any future gate change that names a not-yet-existing file into scope must land the name and the file together, or ship the list empty and let the name follow. The next person splitting a gate change will hit this.

---

## 5. Slice 2 — The read-only page

**Scope:** FR-6, FR-7, FR-12 (rendering), FR-14 (display, three states), FR-16 … FR-20 (copy), the nav entry. **Size: M/L.** **Behaviour on deploy: admins can see the settings and who last changed them. Still no new write path.**

### 5.1 Files

| File | Action | Change |
|---|---|---|
| `app/admin/business-os-llm/page.tsx` | create | `'use client'`. No server import, no model/temperature literal |
| `app/admin/business-os-llm/components/AreaCard.tsx` | create | Collapsed: name · `Configured: on` / `Configured: off` / `Cannot be switched off` · area model · override count · **the FR-14 line in whichever of its three states applies** |
| `app/admin/business-os-llm/components/CallRow.tsx` | create | Four fields, provenance badge each, locks disabled-with-reason, issues against the field |
| `app/admin/business-os-llm/components/FailOpenNotice.tsx` | create | FR-17. **No dismiss prop, no `onClose`, no visibility state** — undismissible by construction |
| `app/admin/business-os-llm/components/LedgerCheckPanel.tsx` | create | The three readings + the chat statement. **No tick, check or success colour in any branch**; the caveat sentence is the shared exported string |
| `app/admin/business-os-llm/components/StoredRowPanel.tsx` | create | Collapsed raw JSON, `updated_at`, the FR-14 line. Read-only |
| `app/admin/business-os-llm/__tests__/*.test.tsx` | create | S2-T1 … S2-T11 |
| `app/admin/components/AdminSidebar.tsx` | modify | One entry, "Business OS AI", beside System Config (W-9) |

**`app/admin/system-config/page.tsx` is NOT touched — D-U1** (user, 2026-09-22). Its 20 `console.*` calls are out of scope, and the trigger that would bring them in is recorded in the Overview.

**As built (Dev, 2026-09-23).** Eight files created under `app/admin/business-os-llm/`, four test files, two shared test helpers, and three files modified. The additions to the plan's list are marked ⊕.

| File | Action | Change |
|---|---|---|
| `app/admin/business-os-llm/page.tsx` | create | `'use client'`. Header, the standing notice, eight cards, one expanded at a time |
| `app/admin/business-os-llm/types.ts` | ⊕ create | The payload's shape, **re-declared** for the client. FR-6 forbids importing `adminSettingsView` (it is `server-only` and pulls in the resolver, the policy module and the catalog), and an `import type` would put a server path in a client file for the next edit to break. The duplication is pinned by a compile-time test, not trusted |
| `app/admin/business-os-llm/copy.ts` | ⊕ create | The screen's own words — **glosses only**. The three ledger readings and the caveat are NOT here; they come from `ledgerCheckCopy` |
| `app/admin/business-os-llm/format.ts` | ⊕ create | One timestamp formatter, UTC, that returns `null` for a missing instant instead of the epoch (DEF-6) |
| `app/admin/business-os-llm/components/AreaCard.tsx` | create | As planned |
| `app/admin/business-os-llm/components/CallRow.tsx` | create | As planned |
| `app/admin/business-os-llm/components/FailOpenNotice.tsx` | create | As planned. Two variants (banner, inline); no dismiss prop in either |
| `app/admin/business-os-llm/components/LedgerCheckPanel.tsx` | create | As planned, plus RC-D's *"too long ago to check"* state |
| `app/admin/business-os-llm/components/StoredRowPanel.tsx` | create | As planned |
| `app/admin/business-os-llm/components/LastChangedLine.tsx` | ⊕ create | FR-14's three states in **one** component, used by the card AND the stored-row panel, so the two renderings cannot drift |
| `app/admin/business-os-llm/components/Chip.tsx` | ⊕ create | The state / provenance / lock label. See deviation **D-2** for why not `components/ui/badge.tsx` |
| `app/admin/business-os-llm/__tests__/{source.guard,page.render,lastChanged.render,ledgerPanel.render,nav}.test.*` | create | 71 tests |
| `tests/helpers/bos-llm-literal-rules.ts` | ⊕ create | `codeOf` + the five `LITERAL_RULES`, extracted at their **third** caller exactly as SA suggested. `route.test.ts` now imports them |
| `tests/helpers/bos-llm-admin-fixtures.ts` | ⊕ create | Payload fixtures + the `fetch` stub |
| `lib/business-os/llm/__tests__/adminSettingsView.wireTypes.test.ts` | ⊕ create | The compile-time pin on `types.ts` |
| `app/admin/components/AdminSidebar.tsx` | modify | One entry, "Business OS AI" → `/admin/business-os-llm`, in the Configuration group directly under System Config |
| `lib/business-os/llm/adminSettingsView.ts` | ⊕ modify | **DEF-6 fixed at the boundary:** `LastChangedBy.at` is `string \| null` and `lastChangedByFor` narrows `row.updated_at ?? null` |
| `app/api/admin/business-os/llm-settings/ledger/route.ts` | ⊕ modify | Each 400 now carries a machine-readable `reason` (`too_long_ago` / `since_in_future`) beside its sentence. See deviation **D-1** |
| `app/api/admin/business-os/llm-settings/__tests__/route.test.ts` | ⊕ modify | Imports the extracted rules instead of holding its own copy |

### 5.2 Tasks

- ✅ **T2.0** Confirm the branch (`feature/business-os-llm-admin-ui-slice2`, off `origin/main` `d1e54bef` with slice 1 merged as PR #98) and read every review section before the first edit.
- ✅ **T2.1** Confirm HOW the page is guarded before adding anything: `app/admin/layout.tsx` awaits `requireAdminPage()` and renders `AdminChrome` — the page adds nothing (S2-T1).
- ✅ **T2.2** `types.ts` + the compile-time pin (`adminSettingsView.wireTypes.test.ts`).
- ✅ **T2.3** `copy.ts` — the fail-open sentence, the FR-14 states, the glosses. No ledger reading restated.
- ✅ **T2.4** `format.ts` + **DEF-6 / S2-T7c** fixed at the boundary in `adminSettingsView.ts`.
- ✅ **T2.5** `FailOpenNotice`, `Chip`, `LastChangedLine`, `CallRow`, `StoredRowPanel`.
- ✅ **T2.6** `LedgerCheckPanel` with RC-D's *"too long ago to check"* state, and the `reason` code the route now sends.
- ✅ **T2.7** `AreaCard` and `page.tsx`.
- ✅ **T2.8** The sidebar entry. `app/admin/system-config/page.tsx` untouched (D-U1).
- ✅ **T2.9** Tests S2-T1 … S2-T11 — **71 tests across 5 files**, plus the wire-type pin.
- ✅ **T2.10** Gates (§5.3) measured verbatim. Five deliberate mutations run to prove the load-bearing assertions bite (§5.5).
- ⬜ **T2.11** SA code review → QA → user view → RM.

### 5.2b Tests

All ✅ as at 2026-09-23.

| ID | Asserts | AC |
|---|---|---|
| **S2-T1** | A non-admin never reaches the page: the `/admin` layout guard is the only gate and the page adds none. No read-only variant exists | AC-2 |
| **S2-T2** | **FR-6 source test:** nothing under `app/admin/business-os-llm/` imports `modelSettings`, `modelSettingsPolicy`, `modelSettingsSchema` or `callCatalog`; no model-id or temperature literal; no `console.*` | AC-6 |
| **S2-T3** | Provenance badges render from the payload; `temperature` "not set" renders as **"not set — the provider default applies"** | AC-4 |
| **S2-T4** | Each issue renders against its field, with the resolver's own `reason` plus the plain-language gloss | AC-5 |
| **S2-T5** | No stored row → *running on code defaults*, the defaults, **no** attribution line, no error styling | AC-3 |
| **S2-T6** | Locked controls are disabled with their reason **as text** (not tooltip-only) | AC-12 |
| **S2-T7** | **RC-1's three states** render on the **collapsed** card *and* in the stored-row panel; the unresolved-id rendering is visibly labelled; the null-`updated_by` state reads *"actor not recorded"* and is distinguishable from "no row" | AC-14 |
| **S2-T7c** | **QA DEF-6 (Low, slice 2): `lastChangedByFor` can emit `at: null` against a `string` type.** `SystemSettingsConfig.updated_at` is typed `string`, but a row read from the database could carry null, and the `not_recorded` / `admin` / `unresolved` states all pass it straight through. Slice 2 must not render `null` as a date. Fix at the boundary — either narrow the type or render an explicit "time not recorded" — never `new Date(null)`, which is the epoch and would read as 1970 | AC-14 |
| **S2-T7b** | **SA comment 14 — the state-2 copy must not promise an answer that is not there.** 2.2 measured `updated_by` null on **all eight** rows, so *every* card renders the "actor not recorded" state on day one — and those seeded rows have **no audit entry either**, because the seed predates the helpers. So the line must not read "see the audit trail" unconditionally. Asserted: the state-2 copy does not direct the reader to a trail that may hold nothing for that row | AC-14 |
| **S2-T8** | **No string on the page** asserts an area is off (a rendered-output scan outside the `Configured: off` chip). `FailOpenNotice` renders beside **every** switch with no dismiss affordance | AC-16 |
| **S2-T9** | All three readings render as text with equal weight, incl. **reading 3**; the shared caveat string is always present; no tick/success affordance in any branch | AC-17 |
| **S2-T10** | The chat card renders **none** of the three readings and names the entry gate and the `Business OS LLM settings changed` server log | AC-18 |
| **S2-T11** | After a (mocked) successful write the page states the ~60 s propagation and that the ledger check only starts counting after it | FR-20 |

### 5.3 Gates

**Measured in this worktree on 2026-09-23, verbatim.**

| Gate | Result |
|---|---|
| `npm run typecheck:bos-llm` | ✅ `231 files in scope, 28 errors, 0 new (132.6s)` — passed. (Scope is 231, not slice 1's 177, because `main` has moved; **0 new** is the property. It also reports 1 baseline entry now fixed in `app/api/onboarding/build/route.ts` — not mine, and NOT regenerated) |
| `npm run check:bos-llm-literals` | ✅ `43 files in scope, 2 exempt, 0 violations (22.0s)` — passed |
| `check:bos-llm-literals -- --list` | ✅ `included app/api/admin/business-os/llm-settings/route.ts` · `exempt lib/business-os/llm/modelSettingsPolicy.ts` · `exempt scripts/bos-llm-settings.ts` · `43 in scope, 2 exempt, 1 included by name`. **Unchanged by this slice** — no exemption added or widened, no inclusion added, no baseline regenerated |
| `npm run lint:hooks` | ✅ clean, no output, exit 0 |
| `npm run build` | ✅ `✓ Compiled successfully`, exit 0. `ƒ /admin/business-os-llm  6.59 kB  94.4 kB` in the route table — dynamic, like every other `/admin` page |
| jest (touched paths) | ✅ **25 suites, 526 tests, all passing** (`app/admin/business-os-llm`, `app/admin/components`, `app/api/admin/business-os/llm-settings`, `lib/business-os/llm/__tests__`). The new files are 71 tests in 5 suites |
| `eslint` on the touched files | ⚠️ **Corrected 2026-09-24 (QA DEF-S2-6): this row first claimed 0 problems and was wrong** — `adminSettingsView.wireTypes.test.ts` carried one `prefer-as-const` error and three unused-type warnings. Both fixed, so it is now genuinely **0 problems in every file this slice created.** Pre-existing and NOT mine: 3 `no-require-imports` errors in slice 1's two route test files (the `require('../route')` idiom), and 3 warnings in `AdminSidebar.tsx` (two unused icon imports and its `icon: any`, all predating the one entry added here) |
| `npm run lint` | ⚠️ **cannot run in this repo** — `next lint` (Next 14) does not read the flat `eslint.config.mjs` and drops into its interactive "How would you like to configure ESLint?" setup instead. Pre-existing, unrelated to this slice; `npx eslint <paths>` above is the substitute. **Flagged for the TL** |

**Five mutations, run to prove the assertions are alive rather than merely green.** Each was reverted; the suite is 71/71 at rest.

| Mutation | Test that failed |
|---|---|
| Delete `<FailOpenNotice variant="inline" />` from `AreaCard` | S2-T8 "beside every area switch" |
| `formatInstant(at)` → `new Date(at as string).toISOString()` | S2-T7 (both states) **and** all three S2-T7c cases |
| Give the RC-D state a red class | RC-D "in the neutral tone" |
| Add `const isChat = area === 'chat'` to the panel | S2-T10 "holds no knowledge of WHICH areas the ledger can see" |
| Import `TEMPERATURE_BOUNDS` and write a model id in `page.tsx` | S2-T2 both rules (server module, literal) |

**Re-measured after the SA fixes (2026-09-24), verbatim:** `typecheck:bos-llm` → `231 files in scope, 28 errors, 0 new (89.9s)` passed · `check:bos-llm-literals` → `43 files in scope, 2 exempt, 0 violations (18.6s)` passed, `--list` unchanged (`1 included by name`, 2 exempt, no baseline regenerated) · `lint:hooks` → clean, exit 0 · `build` → `✓ Compiled successfully`, exit 0, `ƒ /admin/business-os-llm  6.8 kB  94.7 kB` · jest over the touched paths **plus the required `admin-authz-surface.guard` suite** → **26 suites / 609 tests, all passing** (the screen's own five suites are now 80 tests) · `npx eslint` on every new and touched file → exit 0 — **this claim was wrong when first written and is true only after the DEF-S2-6 fix**.

### 5.3b SA slice-2 review — F-1 … F-11 (Dev, 2026-09-24)

| # | Fix | What changed |
|---|---|---|
| **F-1** (High) | **The guard assertion was defeated by a comment.** It read `app/admin/layout.tsx` **raw** and looked for the substring `await requireAdminPage()`; SA commented the call out and got **114/114 green with all 22 admin pages open**. | It now goes through `codeOf()` like every other assertion in the file, and asserts the **call as a shape** — `/await\s+requireAdminPage\s*\(\s*\)/` — so an import, a comment or prose cannot satisfy it. A second test proves the **rule** rather than the file: the import line, a `//`-commented call and a `/* */`-commented call are each asserted NOT to match, and a real call is asserted to match — the property whose absence is exactly what F-1 found. **Re-measured:** SA's `// TEMPORARILY DISABLED FOR DEBUGGING: await requireAdminPage();` now gives **1 failed / 114 passed** across both guard suites, and deleting the line outright also fails. |
| **F-3** (High) | **The banner told an operator switching *chat* off to draw the false conclusion.** *"no new calls for the area is the only evidence"* is untrue for an area the ledger cannot see at all. | The claim is **scoped, not enumerated** — naming chat would put a per-area fact in the browser bundle (FR-6) and rot the day another area stops being catalogued. New `FAIL_OPEN_ACTION`: *"Confirm at the ledger rather than at this switch — and check first that the ledger can see the area at all: each card's ledger check says whether it can answer, and for some areas it cannot. Where it can, no new calls is the only evidence you will get. Runbook §5 (…) lists the three log lines to search for."* `FAIL_OPEN_INLINE` carries the same scope **and now the runbook pointer** (F-7): *"…Confirm at this area's ledger check below, which also says whether the ledger can answer for this area at all (runbook §5)."* Both are asserted, and the old unscoped sentence is asserted **absent** so it cannot come back. |
| **F-4** (Medium) | **The wireTypes header named a mechanism that does not exist.** ts-jest emits no diagnostics under this config, so **no test in this repo fails on a type error**. | The header now says what actually enforces it: **`typecheck:bos-llm`**, which has the file in scope and fails with `TS2344` on the DEF-6 revert. The ts-jest claim is gone, and the note that the runtime bodies are deliberately trivial is explicit. **This is repo-wide, not file-local** — any test whose stated mechanism is "it fails to compile" is inert outside that gate's scope, which belongs in the QA report and the test-tiering workplan. |
| **F-5** (Medium) | The undeclared second deviation. | Declared as **D-8** beside D-3, with SA's ruling recorded on both: **slice 3 adds the payload field, never a doc link.** |
| **F-6** (Medium) | **"No green in any branch" covered 3 of 5**, and the RC-D check read a wrapper whose class is `space-y-1` — it could not have failed. SA coloured the RC-D heading green and got 9/9. | Every branch the panel can reach is now driven from one table — **all five `LedgerReadingKind`s plus `cannot_check`, `failed` and `no_change`, eight in total, with a count assertion so a new branch cannot be added silently** — and each asserts the strong form: no green/emerald class anywhere in the panel's HTML, no tick glyph, no success wording. The weak `className` check is gone, replaced by "no red anywhere in the panel" on the RC-D branch. **Re-measured:** SA's green-heading mutation now **fails**, naming the `cannot_check (RC-D)` branch. |
| **F-7** (Low) | `AreaCard`'s comment said the inline notice is beside every switch *"always"*, but it renders inside `expanded &&`. | Comment corrected — "always" belonged to the banner, which is above the cards and never collapses — with the slice-3 obligation recorded: place it adjacent to the real control and in the FR-15 confirmation, where *"beside every switch"* becomes literal. The runbook pointer was added to the inline copy in the same edit. |
| **F-8** (Low) | `FAIL_OPEN_BODY` compressed runbook §5 in the alarming direction. | Now *"cannot read them **on startup**"*, plus the case it was missing: *"(An instance that had already read them keeps serving the last good values, so it stays off there.)"* — which is what §5 actually says. |
| **F-9** (Low) | `Check again` stayed enabled on `too_long_ago`, where the answer is monotonic. | `cannot_check` carries `retryable`, and the button is disabled for `too_long_ago` only — every other refusal may change on the next read. Asserted. The `reason` is also **narrowed through a type guard** now (SA optimisation), so the neutral fallback is visibly a decision about codes that do not exist yet rather than a typo-swallower. |
| **F-10** (Low) | The DEF-6 comment asserted a schema fact the repo cannot establish. | Reworded to what is known: the repository type is **hand-written, not generated**, and this table has no `CREATE TABLE` in the repo — so the renderer does not rely on the declaration. It also states plainly that the sub-state is **defensive and unreachable from a legitimate row today**, and pinned by a test. |
| **F-11** (Low) | Doc counts. | The Change History row now says **7 components / 15 files (10 source + 5 test)**. "21 pages" → **22** in `app/admin/layout.tsx` and `lib/admin/requireAdminPage.ts`. ⚠️ The two mentions inside `lib/admin/__tests__/admin-authz-surface.guard.test.ts` are **deliberately left alone**: that file belongs to the required `Admin authz surface guard` and to F-2's workstream, and this slice does not touch it. |

**F-2 is not fixed here, by instruction.** R6 of the required `Admin authz surface guard` asserts only `toContain('requireAdminPage')`, which the import satisfies — the same hole as F-1, in the gate that blocks merges for the whole repo. It is one line (`toMatch(/await\s+requireAdminPage\s*\(/)`), it changes a **gate**, and the user decides whether it lands here or opens the parked admin-authz work. **Until it does, F-1's assertion is the only thing standing.**

### 5.3c QA slice-2 defects — DEF-S2-1 … S2-9 (Dev, 2026-09-24)

QA: **46 PASS / 7 FAIL / 2 PARTIAL / 1 BLOCKED, no High** — but not shippable as written. It rendered the real page in jsdom and quoted the output, so the copy findings are **quotations, not inferences**. All four Mediums and all four Lows are fixed below; the three items ruled out of scope are recorded at the end.

| # | Defect | Fix |
|---|---|---|
| **S2-1** (Medium; High as a class) | **Two more ways to disable the one guard over 22 admin pages, both green at 115/115.** `try { await requireAdminPage(); } catch {}` — the hazard `app/admin/layout.tsx` names in **its own comment**, because `requireAdminPage` redirects by THROWING — and the call placed **after an early return**. F-1's shape match proved the call EXISTS, not that it can fail the request. | The asserted property is now **"the guard is the FIRST statement of the component body"**, computed by `firstStatementOfAdminLayout()`, which strips comments, finds the signature, and terminates the statement at `;` **or `{`** — so a `try {` opener IS the first statement and fails. One property subsumes all four known mutations. It is proved on **synthetic layouts** (deleted · `//`-commented · block-commented · try/catch · early return) rather than only on today's clean file, and an unrecognisable signature returns `null` and **fails** rather than passing vacuously. A second assertion names the try/catch hazard directly, so the failure message matches the layout's own comment. **Re-measured:** try/catch → **2 failed / 120 passed**; early return → **1 failed / 121 passed**. This also closes **DEF-S2-2**, the guard’s position in **this one file**, for free. **It does NOT close OI-20 (SA R-1).** OI-20 is the precedence gap over the **38 gated `/api/admin/*` handlers**, and closing it needs the surface guard’s oracle extended to instrument the **body parse** — whereas this is one assertion, over a different guard (`requireAdminPage`, not `requireAdmin`), in a **non-required** suite. OI-20 carries an SA condition that it is the FIRST thing built when the parked admin-authz slices resume, and calling it closed here would discharge that condition without the work ever happening. |
| **S2-3** (Medium) | **The copy promised evidence the page cannot give today.** Both sentences sent the operator to the per-area ledger check — which answers the reach question in **1 of 8 states**, while `too_long_ago` is the day-one state of **all eight cards**. So the page said *"confirm at the ledger"* and every panel answered *"Too long ago to check"*. Residue of F-3: scoping was right, but it relocated the truth-claim onto the panel without checking which states the panel can be in. | Both sentences now state the limit **up front** — so a refusal is the expected answer rather than a dead end — and name the fallback that works for a change of **any** age: runbook §5's three log lines, and the **LLM Usage tab on `/test-business-os`**, which renders the per-area call counts without SQL (runbook §5 documents it). No per-area hardcoding, so FR-6 holds. Asserted, including that neither the unscoped claim nor the old day-one-false promise can come back. **The route option (a `ledgerCanSeeArea` boolean on every response) was deliberately NOT taken here** — it is a payload change, it belongs with D-3/D-8's field in slice 3, and the copy fix is what makes the page honest today. |
| **S2-4** (Medium) | **A flat contradiction on the onboarding card:** the fail-open notice rendered one line above *"This area can never be switched off"* — on the single card where a switch warning cannot apply, it was the most prominent text. | The inline notice renders **only when `area.switchable`**. The non-switchable area gets its own line instead, saying what still **is** true there: *"There is no switch to fail open here. A settings-read failure on startup does still put this area's calls back on their code-default provider and model, which for this area is the only lever there is…"* — which matters, because onboarding's model is its only cost lever. Both directions asserted; rendering the notice unconditionally again fails the new test. |
| **S2-5** (Medium) | **The count assertion missed the likelier shape of a new branch.** `EVERY_BRANCH` derived only the three **counted** readings and hard-coded the rest, so a sixth **count-less** kind — which is what both existing count-less kinds are — left **535/535** green with `toHaveLength(8)` passing. | The table is an **exhaustive `Record<LedgerReadingKind, Branch>`**, so a new kind is a missing property. Two independent pins, because neither alone is enough: `typecheck:bos-llm` has this file in scope (`--list` → `caller`) and fails **`TS2741`**; and because **no test in this repo fails on a type error** (F-4), a runtime assertion requires the table's keys to equal `LEDGER_READING_TEXT`'s. **Re-measured with QA's own mutation** (a sixth, count-less kind): jest **1 failed / 19 passed**, `typecheck:bos-llm` **FAILED with 1 new TS2741**. The branch list also grew to **nine** — both `cannot_check` sub-states and the unknown-code fallback are now driven, closing QA's edge case 2 — and the retry rule is exercised on **both** sides of the branch it distinguishes. |
| **S2-6** (Low) | **§5.3 claimed eslint was clean and it was not:** `const ok: true = true;` in the wireTypes test is one `prefer-as-const` **error**, plus three unused-type-alias warnings. | The three type assertions are now **named and referenced**, so there is no literal annotation and no unused symbol: `npx eslint` on that file is **exit 0, 0 problems** — not merely 0 errors. The §5.3 row and the Change History row are corrected to say what was actually measured. |
| **S2-7** (Low) | F-10's retracted schema claim survived in `LastChangedLine.tsx` and `types.ts`. | Both reworded to what `adminSettingsView.ts` now says: the repository type is hand-written rather than generated, so the renderer does not rely on it; the sub-state is defensive and pinned by a test. Three files, one claim. |
| **S2-8** (Low) | `LedgerCheckPanel`'s header said *"every sentence"* comes from `ledgerCheckCopy`. | Now *"every **reading**, and the caveat"*, and the header names what the file does write — the two refusal headings, the no-stored-change line and its own failure line — while recording that even there the refusal's **explanation** is the route's sentence. |
| **S2-9** (Low) | F-4's misreading survived in `types.ts`, the file a UI author opens first. | It now names **`typecheck:bos-llm`** as the pin and states plainly that jest does not catch it, ending with *"Run the gate, not the suite, after editing either side."* |

### 5.3d SA re-check — R-1, R-2 and what regex cannot reach (Dev, 2026-09-24)

| # | Item | Resolution |
|---|---|---|
| **R-2** | **The S2-3 fix reintroduced the defect it was fixing, one layer down.** The new fallback said the LLM Usage tab shows calls per area *"for any period"*. It does not, and the runbook never claimed it — I summarised the doc instead of reading the code. `lib/business-os/usage/llmUsageVerification.ts` **requires an `accountId`** (`:86-90`, and it refuses the platform account) and bounds `since` by `MAX_WINDOW_MS = 7 * 24 * 60 * 60 * 1000` (`:61`), **refusing rather than clamping** (`:96-101`). So it is **one business at a time, last 7 days only**, while the switch it is meant to corroborate is fleet-wide and the change may be older — named in the fallback an operator reaches for precisely when the 24-hour check has already turned them away. | The fleet-wide path is now the runbook's **own read-only SQL over `token_usage`**, and the tab is offered for what it actually is: *"(The LLM Usage tab on /test-business-os is quicker but narrower — one business at a time, and the last 7 days only.)"* The inline form drops the tab altogether and names only the fleet-wide path — it has no room to qualify it. Asserted, including that *"for any period"* cannot come back. **The lesson, recorded because it is the second time it has bitten this slice: check the claim against the code, not against a doc's summary of the code.** |
| **R-1** | The OI-20 closure claim. | Corrected in both places. The first-statement property closes the **page-layout half (DEF-S2-2)** and nothing else; OI-20's precedence gap is over the 38 gated `/api/admin/*` handlers, needs the oracle instrumented for the body parse, and keeps its SA condition to be built first when the parked slices resume. |
| **Copy length** | 178 words, judged borderline. | **Reordered, not cut**, per SA's ruling: headline → **what to do** → the quiet why, with the mechanism styled quieter than the action. An operator mid-incident reads the first two blocks and acts; the why is what they come back for. The order is asserted **by position**, because "reorder, not cut" is only observable in the order. |

**Recorded, not fixed — three shapes still satisfy the first-statement property, and the real fix is behavioural.** SA found all three green at 122/122: `process.env.X && (await requireAdminPage());`, the ternary form, and a **locally shadowed no-op** `requireAdminPage`. Nothing leaks by any of them (the two properties below still hold), so none is blocking. But the conclusion is worth more than the three examples: **after three rounds of regex (F-1 → S2-1 → here), the property that matters is behavioural, not textual** — one test that renders `AdminLayout` as a non-admin and asserts the redirect, which is immune to all five known mutations **and** to these three, and does not care how the call is written. That is the shape of the fix whenever this is next touched; a fourth regex would be the wrong answer to the same question.

**Recorded, not fixed — QA's P6/P7, and the condition that makes it harmless.** An unauthenticated request carrying a crafted `Next-Router-State-Tree` header returns **200 with no redirect**: the layout is not re-rendered, so `requireAdminPage()` never runs. The caller does not have to have entered the `/admin` subtree — it only has to **say** it did, in a client-supplied header. Nothing leaks today, and the reason has to be written down because it is **two unasserted properties**, not one:

1. **every `app/admin/*/page.tsx` is `'use client'` and carries no server props** — QA checked all 22 — so no admin page has server-rendered data to leak; and
2. **every admin API is `requireAdmin`-gated as its first statement**, which is the actual security boundary.

**The day one admin page becomes a server component, or fetches on the server, property 1 breaks and this stops being harmless — silently, with no test failing.** Slice 3 must not introduce one. This belongs beside **F-2** in the admin-authz workstream, together with **S2-10** (which falsifies the *stated reason* for SA's ✅ on escape E2 while leaving the conclusion standing), and it is the TL's item for the user — not fixed here.

### 5.4 Implementation notes and deviations (Dev, 2026-09-23)

| # | Note |
|---|---|
| **D-1** | **The ledger route's two 400s now carry a `reason` code — a slice-1 file changed inside slice 2.** RC-D requires the 24 h refusal to render as *"too long ago to check"* and never as an error. The route returned only `{ success: false, error: <sentence> }`, so the client could tell the two refusals apart only by matching the message text — which makes a copy edit a UI bug, and DEF-5 had already rewritten that very sentence once. So each refusal now also carries `reason: 'too_long_ago' \| 'since_in_future'`. Purely additive: no status, sentence or behaviour changed, and slice 1's ledger tests pass untouched. **For SA:** this is the alternative to the client inferring a server decision, and it is why the panel has no string-matching in it. |
| **D-2** | **The chips are local, not `components/ui/badge.tsx`, and the reason is measured.** (a) `badge`'s `outline` variant is coloured with `--v2-border` / `--v2-text-secondary`, which are declared in `app/v2/globals-v2.css` — a stylesheet `/admin` does not load, so under this layout those tokens are undefined; (b) `cn()` in `lib/utils.ts` is a plain `join`, **not** `tailwind-merge`, so passing a `className` to recolour a variant ships both classes and lets stylesheet order pick the winner. The screen therefore uses the palette all 21 sibling admin pages use (translucent accent over slate) via one local `Chip`, and the same applies to the two buttons. **Not a new pattern — the existing one.** Recorded because "use the design system" was the instruction and this is why it was not followed literally. |
| **D-3** | **The "What *off* means here" section of the requirement's screen sketch is NOT rendered, and it is not in slice 2's FR scope.** It needs the owner-facing behaviour per area, which lives in the **Layer 2 requirement's** table and is not in the `GET` payload. Rendering it from a client-side map would be a hardcoded per-area copy table in a `'use client'` file — precisely what FR-6 exists to prevent. **For SA:** either the payload gains a per-area `whenOffBehaviour` string (a small slice-3 route addition, sourced from one server-side table), or the card links the doc. Not invented here. |
| **D-3 (ruling)** | **✅ SA APPROVED as deferred — and slice 3 adds the field to the PAYLOAD, not a doc link.** A doc link is a second source of truth for the same fact and rots silently, which is the failure this whole layer exists to avoid; and the consequence belongs beside the switch at the moment of the FR-15 confirmation, not behind a click. If slice 3 cannot carry it, the row is **withdrawn from the requirement explicitly** rather than left quietly unrendered. |
| **D-8** | **(SA F-5 — declared late, and the lateness was the defect.) The requirement's expanded-card "Area settings" section is NOT rendered either** — area-level `enabled` / `provider` / `model` / `temperature` with provenance and lock state, listed as the first section of the expanded card. The card goes straight to Calls; `areaModelSummary()` puts a derived one-line model summary on the **collapsed** card instead. **Same cause as D-3, same disposition:** the payload carries no area-level field — RC-C deliberately removed the one it had, because two answers to one question is how the picker bug happened — and synthesising one client-side would be the FR-6 hardcoding. SA accepted the reasoning; what was wrong was leaving it undeclared, where the TL and slice 3's scoping could not see it. **Disposed of together with D-3: slice 3 adds the field, or both rows are withdrawn from the requirement explicitly.** |
| **D-4** | **`LastChangedLine` is one component used twice**, rather than the card and the stored-row panel each rendering FR-14. Three states rendered in two places is four chances to make them disagree, and the state that matters most (`not_recorded`) is the one every row is in today. |
| **D-5** | **The panel auto-runs the check when a card is expanded, and `Check again` re-runs it.** FR-18 calls for a *refreshable* panel, and RC-D's refusal is only informative if an operator sees it without having to ask. Today that means every area renders *"Too long ago to check"* on expand — the correct, measured state (§14.4), not an error. Chat is not special-cased client-side: the route short-circuits it before any repository read, so the panel simply renders the kind it is given (see the component header). |
| **D-6** | **The literal-rule table was extracted to `tests/helpers/bos-llm-literal-rules.ts`** at its third caller, which is where SA said it would be worth doing. `route.test.ts` imports it; the assertions *about* the rules (each one alive, the measured subsumption) stay where they were. No rule changed. |
| **D-7** | **The screen says it is read-only, and where to go instead.** Every expanded card carries one line pointing at `npm run bos:llm-settings` / runbook §4. A read-only screen that did not say so would leave an operator who came to stop a cost runaway hunting for a control that is not there yet — and the runbook is still the only writer until slice 3. |

---

## 6. Slice 3 — The writer and the confirm step

**Scope (RC-7 folds former slice 4a in):** FR-3, FR-9 … FR-11, FR-13 (caller), **FR-15**, FR-20 (response), FR-21 … FR-23, FR-25, FR-26, plus **R-3**, **R-4** and **RC-8**. **Size: L.** **Behaviour on deploy: the screen becomes a writer, behind the preview *and* the confirmation, in one deploy. Switching an area off now emails the other admins.**

RC-7's reason, recorded: *"hold slice 3's merge if 4a cannot follow"* was a coordination promise, not a control — the same class of thing that made SA extend D-10's re-open trigger. Merging the confirm step in **deletes** the unconfirmed-write window instead of mitigating it.

### 6.1 Files

| File | Action | Change |
|---|---|---|
| `app/api/admin/business-os/llm-settings/route.ts` | modify | `PUT` + `dryRun` (**200 / `ok: false`**, `resolvedAfter` omitted on refusal — RC-8); `validateAreaRow` re-run at write time; **`callsBlockingSwitchOff`** (RC-4); `set` with the actor; audit; notification in the response; `maxDuration` |
| `lib/business-os/llm/areaSwitchOffNotice.ts` | create | §3.5 — `server-only`, 3 s, abandoned-promise logger, `timed_out` copy |
| `lib/audit/events.ts` | modify | Two events + **both metadata-registry rows** (`severity`, `complianceFlags: ['SOC2']`, description) |
| `lib/audit/admin-helpers.ts` | modify | The helper pair with **`door` as a required parameter** (R-2 / Q-3 → C) |
| `app/admin/business-os-llm/components/ConfirmChangeDialog.tsx` | create | FR-15 — one confirm step naming the action and its reach; switch-off carries the fail-open sentence and the FR-11 choice |
| `app/api/admin/system-config/route.ts` | modify | **Message only** at `:208` — points at the screen (FR-3) |
| tests for each of the above | create/modify | S3-T1 … S3-T16 |

### 6.2 Tests

| ID | Asserts | AC |
|---|---|---|
| **S3-T1** | `PUT` 401/403 as `GET`, nothing written | AC-1 |
| **S3-T2** | **Twelve refusal classes**, each **400** with the resolver's own reason, the stored row **byte-identical** afterwards | AC-8 |
| **S3-T3** | Source test: the route calls `validateAreaRow` and contains **no** guardrail re-implementation — no price lookup, no temperature bound, no provider list. (Passes because RC-3 moved option construction out in slice 1) | AC-9 |
| **S3-T4** | `dryRun: true` writes nothing and returns `resolvedBefore` / `resolvedAfter`. **R-4:** `resolvedBefore` is a **fresh read at dry-run time** — a row changed after the page's `GET` appears in the diff, and `rowChangedAt` is set | AC-10 |
| **S3-T5** | **Write-time re-validation:** a row that passes the preview and fails at write time (its price row removed in between) is refused **400**, nothing written, the preview's verdict provably not re-used | AC-10 |
| **S3-T6** | **RC-4:** the route's refusal comes from `callsBlockingSwitchOff`, names the calls, and the `--include-calls` re-submission writes the row `withCallsSwitchedOff` produces — **equal to what the script writes** for the same input | AC-11 |
| **S3-T7** | Locked values are refused by the **route**, whatever the UI disabled | AC-12 |
| **S3-T8** | A model change writes **exactly one** `BOS_LLM_SETTINGS_UPDATED` — `entityType: 'settings'`, the acting admin's id, `changes: { before, after }` with both diffs, **`details.door: 'screen'`** | AC-19 |
| **S3-T9** | A switch-off writes **both** entries, the second `critical` with **`details`**; a switch **on** writes one and sends nothing | AC-20 |
| **S3-T10** | Both events have a registry row; a test enumerates `AUDIT_EVENTS` and fails if any new event lacks one | AC-26 |
| **S3-T11a** | Recipients: `listActive()` minus the actor by **normalised email or `user_id`** — a differently-cased address, an actor with `user_id: null`, and an actor with **no** email are each excluded | AC-29 |
| **S3-T11b** | No transport → `{ sent: false, provider: 'none' }` logged at **warn** with count and provider, save succeeds, response `state: 'not_sent'` (**R-3**) | AC-29 |
| **S3-T11c** | **RC-5:** a send exceeding **3 s** yields `state: 'timed_out'`, the save succeeds, the **abandoned promise still logs** its eventual outcome, and the copy says *"could not confirm"* — never "not sent" | AC-29 |
| **S3-T11d** | Actor is the only active admin → nothing sent, **info** line, `no_recipients`. No owner or prompt text in the message | AC-29 |
| **S3-T12** | **FR-15:** every write — model change, switch-off, switch-**on** — takes **exactly one** confirm step after the preview, naming the action and its reach; **no typed confirmation**; switch-off carries the fail-open sentence | AC-15 |
| **S3-T13** | No path from an edited form to `dryRun: false` without the preview **and** the confirmation having rendered (asserted over the state machine); the FR-11 choice is explicit | AC-10, AC-11 |
| **S3-T14** | A refused save writes no audit entry, sends no notification, logs at warn. An audit or notification failure never fails the save | AC-21 |
| **S3-T15** | **FR-3:** `PUT /api/admin/system-config` still 400s every canonicalised `bos_llm_area_*` form; only the message changed; the prefix equality test stays green | AC-24 |
| **S3-T16** | **RC-8:** a dry-run with rejections is **200 with `ok: false`** and **omits `resolvedAfter`**; only a real write refusal is 400 | AC-10 |
| **S3-T17** | **K-11 / W-14 / D-U2 — REWRITTEN by the user's decision; the earlier "refuse and classify" version must now FAIL.** An `updated_by` FK violation must **not** fail the save: the write is **retried without the actor**, so the settings change lands; `updated_by` stays **null** (no sentinel); **one** `BOS_LLM_SETTINGS_UPDATED` entry is still written, at **`critical`**, carrying the believed actor, the reason the binding failed, and `details.door`; and the response tells the admin the save succeeded but is unattributed | AC-13, AC-19 |
| **S3-T18** | **D-U2's ordering requirement.** The attribution attempt is **separable** from the settings write — a rejected id must not take the write down with it. Asserted behaviourally: with the first `set()` rejected by the FK, a second is issued **without** the actor carrying the **identical** `value`, and the stored row afterwards is the row the admin asked for | AC-13 |

---

## 7. Slice 4 — The break-glass door (FR-24) and the docs

**Scope:** FR-24 (the script's audit entries, `--actor`, `--reason`, the **three** actor outcomes, its notification), **R-1's FR-24 half**, **R-2's `details.door`**, the script's **adoption of the shared predicate** (RC-4), FR-28 … FR-30. **Size: M.**

### 7.1 Files

| File | Action | Change |
|---|---|---|
| `scripts/bos-llm-settings.ts` | modify | `--actor` / `BOS_LLM_SETTINGS_ACTOR` / `--reason`; the three actor outcomes; the FR-21/FR-22 entries with `details.door: 'break_glass'`; the actor passed to `set`; the switch-off notice; the loud warn line; **`:284-303` replaced by `callsBlockingSwitchOff` / `withCallsSwitchedOff`** |
| `lib/audit/admin-helpers.ts` | modify | `door` already required from slice 3 — the script is its second caller |
| `docs/runbooks/BUSINESS_OS_LLM_MODEL_SETTINGS_RUNBOOK.md` | modify | "Which door to use"; `--actor` / env / `--reason` and **both** unattributed outcomes at `critical`; the screen's steps beside §2, §3, §4, §6; §4 gains the notification; §5 gains the three readings; **§8 records that concurrency is unguarded by decision, re-opened by a third admin _or any non-human writer_**; Change History |
| `docs/requirements/BUSINESS_OS_LLM_MODEL_SETTINGS_LAYER2_REQUIREMENT.md` | modify | Change History row for the **D-1 reversal** (FR-29) |
| `.claude/skills/bos-llm-call-standards/SKILL.md` | modify | The screen is the sanctioned way; the script is break-glass and needs `--actor`. Change History |

### 7.2 Tests

| ID | Asserts | AC |
|---|---|---|
| **S4-T1** | `--actor <bound active admin>` → the same entries as the screen, that admin's id, `set` receives it, FR-14 shows them | AC-30 |
| **S4-T2** | **R-1:** an active admin with **`user_id: null`** → `break_glass_email_unbound`, `userId: null`, email in `details`, `critical`, `updated_by` null, a warn line — **and the write happens**. Must not take the attributed branch | AC-30 |
| **S4-T3** | No actor, and a non-admin address → `break_glass_unattributed`, `critical`, `updated_by` null, loud warn — **and the write happens** | AC-30 |
| **S4-T4** | Env used when `--actor` absent; `--actor` wins when both present; `--reason` reaches `details` | FR-24 |
| **S4-T5** | `get` / `verify-stored` / `verify-equivalence` write no audit entry and send no notification | AC-30 |
| **S4-T6** | **R-2:** every entry from **both** doors carries `details.door`; omitting it is a **type error** | AC-19, AC-20 |
| **S4-T7** | A script switch-off sends the same notification through the same helper, same recipient rule | AC-29 |
| **S4-T8** | **RE-SPECIFIED under the Q-8 ruling (SA comment 12): it must assert the INTENDED DIFFERENCE, not identity.** The old wording ("refuses exactly the calls it refused before and `--include-calls` writes the identical row") is now *wrong by design* and must fail. Named fixtures: **(a)** an area holding only **switchable** call overrides — the script refuses and writes the same row as before, unchanged; **(b)** an area holding a **non-switchable** override (`chat` with `calls.planner.enabled: true`) — the script previously named `planner`, refused the switch-off, and then produced a row `validateAreaRow` rejects as `locked` on the `--include-calls` retry; it now **switches the area off** and leaves `planner` alone. The test asserts the new outcome **and** that the old one would have failed | AC-11 |
| **S4-T9** | **SA comment 13 (pre-existing, found while ruling on Q-8): FR-11 is bypassed entirely on the `--file` path.** The switch-off refusal sits inside the `else` of `if (options.file)`, so a `--file` row setting the area `enabled: false` while leaving a call `enabled: true` is written with **no** FR-11 check at all — the exact hole the rule exists to close, reachable by the more deliberate of the two inputs. Slice 4 lifts the predicate **above** the branch so both input paths get it; the test drives a `--file` row through and asserts the refusal | AC-11 |

### 7.3 Live checks (AC-22, AC-23)

QA's, after merge; they need a second admin account.

- ⬜ **AC-22** — switch `leads` off from the screen, wait 60 s, submit an enquiry → the fixed-rules suggestion; the panel shows **reading 2**; the trail shows **both** entries; the other admin receives the email; the card shows "last changed by"; the instance log shows `Business OS LLM settings changed`. Switch back on → AI suggestion returns, **no** notification.
- ⬜ **AC-23** — a screen change is visible to `bos:llm-settings -- get <area>` and vice versa; both appear in the trail, distinguishable by `details.door`.

---

## 8. Where R-1 … R-5 land

| Must-fix | Slice | How |
|---|---|---|
| **R-1** (FR-14 half) | **1** | **Two independent guards** (RC-11): the map skips null-`user_id` admins (S1-T11) **and** null `updated_by` is branched before any lookup (S1-T11b). With RC-1, (b) renders *"last changed at Y — actor not recorded"* |
| **R-1** (FR-24 half) | **4** | A **third** actor outcome, `break_glass_email_unbound`, `critical`, write still happens. S4-T2 |
| **R-2** | **3** + **4** | `details.door` as a **required** helper parameter (Q-3 → option C). **No column, no audit read**; smuggling it into `description` is forbidden. The on-card signal is recovered by RC-1's three-state rendering |
| **R-3** | **3** | `notification` in the `PUT` response; four post-save wordings; 3 s deadline; `timed_out` says *"could not confirm"* (RC-5). S3-T11b, S3-T11c |
| **R-4** | **3** | `resolvedBefore` from a **fresh read at dry-run time** + `rowChangedAt`; recipients excluded by normalised email **or** id. S3-T4, S3-T11a |
| **R-5** | **1** | The actor applies to `set()`'s **insert** branch. S1-T9 |

---

## 9. AC Traceability

| AC | Slice | Test |
|---|---|---|
| AC-1 | 1, 3 | S1-T1, S1-T2, S3-T1 |
| AC-2 | 2 | S2-T1 |
| AC-3 | 1, 2 | S1-T3, S1-T4b, S1-T6, S2-T5 |
| AC-4 | 1, 2 | S1-T4, S2-T3 |
| AC-5 | 1, 2 | S1-T5, S2-T4 |
| AC-6 | 2 | S2-T2 (+ `server-only`, S1-T12) |
| AC-7 | 1 | S1-T7, S1-T13 |
| AC-8 | 3 | S3-T2 |
| AC-9 | 3 | S3-T3 |
| AC-10 | 3 | S3-T4, S3-T5, S3-T13, S3-T16 |
| AC-11 | 1, 3, 4 | S1-T16, S3-T6, S4-T8 |
| AC-12 | 1, 2, 3 | S1-T8, S2-T6, S3-T7 |
| AC-13 | 1 | S1-T9, S1-T10 |
| AC-14 | 1, 2 | S1-T11, S1-T11b, S2-T7 |
| AC-15 | 3 | S3-T12 |
| AC-16 | 2 | S2-T8 |
| AC-17 | 1, 2 | S1-T15, S2-T9 |
| AC-18 | 1, 2 | S1-T15, S2-T10 |
| AC-19 | 3, 4 | S3-T8, S4-T6 |
| AC-20 | 3, 4 | S3-T9, S4-T6 |
| AC-21 | 3 | S3-T14 |
| AC-22 | 4 | live, §7.3 |
| AC-23 | 4 | live, §7.3 |
| AC-24 | 3, 4 | S3-T15 + doc review |
| AC-25 | 1 | S1-T14, S1-T15 |
| AC-26 | 3 | S3-T10 |
| AC-28 | all | §4.4, S1-T12, S2-T2 |
| AC-29 | 3, 4 | S3-T11a … S3-T11d, S4-T7 |
| AC-30 | 4 | S4-T1 … S4-T5 |

---

## 10. `console.*` in touched files

Counted in this worktree on 2026-09-22 over every file this workplan lists. **Re-counted at implementation time**, per SA's Q-7 condition.

| File | `console.*` | Action |
|---|---|---|
| `app/admin/system-config/page.tsx` | **20** | **Not touched — D-U1** (user, 2026-09-22: sidebar only). Out of scope for this work. **Trigger:** if the cross-link is ever wanted, this file gets the full Pino conversion first, as its own commit, before the link is added |
| `lib/repositories/SystemConfigRepository.ts` · `TokenUsageRepository.ts` · `AdminUserRepository.ts` | 0 | — |
| `lib/audit/events.ts` · `admin-helpers.ts` | 0 | — |
| `app/api/admin/system-config/route.ts` | 0 | — |
| `app/admin/components/AdminSidebar.tsx` | 0 | **Re-counted 2026-09-23 when the nav entry was added: still 0.** Nothing to convert |
| `scripts/bos-llm-settings.ts` | 0 | — |
| `lib/business-os/llm/modelSettings.ts` · `modelSettingsPolicy.ts` | 0 | — |
| `lib/notifications/emailTransport.ts` · `lib/ai/pricing.ts` | 0 | — |
| Everything created by this layer | 0 | Pino only, `correlationId` on every route (FR-27) |

---

## 11. Risks

| # | Risk | Mitigation |
|---|---|---|
| **K-1** | **The evidence panel degrades into a green tick** | Reading 3 is a first-class branch with equal weight; **no tick/success affordance in any branch**; chat short-circuits **before the repository call**; the caveat is a shared string (S2-T9) |
| **K-2** | **The literal gate goes red on a required check** | §3.7 designs all four shapes out, RC-3 removes the likeliest one, S1-T12 catches them in-repo. Escape = a **narrow gate rule change with SA review**, never an exemption, never a baseline regeneration |
| **K-3** | **A second resolution implementation** creeps in for provenance | §3.2 puts it in the resolver; S1-T4's "rejected call-level falls through to `area`" case fails if the route re-derives |
| **K-4** | **R-1 ships half-done** | Two halves, three named tests (S1-T11, S1-T11b, S4-T2), all in §8. RC-11 confirms the slice-1 half closes the hazard alone, and until slice 4 the script passes **no** actor, so no new unattributed-write path exists in between |
| **K-5** | **A picker narrower than the validator** | `listPricedModels()` merges the fallback map; advisory label + cache age; free text stays and is validated identically |
| **K-6** | **Last-write-wins bites** — deliberate (§3.8) | FR-14 on the **collapsed** card + R-4's fresh `resolvedBefore` / `rowChangedAt`. Re-open: a third admin **or any non-human writer** |
| **K-7** | **The notification is awaited**, so a slow transport slows a save | **3 s** + explicit `maxDuration`; the abandoned promise keeps its logger; `timed_out` says *"could not confirm"* (RC-5). Fire-and-forget would be unreliable **delivery** on Vercel, not just an unreported result |
| **K-9** | ~~Environment not ready~~ | **Closed (RC-12)** — junction + `.env.local` present; baselines measured at T1.0 |
| **K-10** | **`set()`'s insert branch now writes `updated_at` in application code** (R-5) | Insert callers enumerated in the slice 1 PR description; S1-T10 pins the four-argument behaviour |
| **K-11** | **NEW (W-14). `updated_by` carries an FK** (2.2), so an actor id the referenced relation does not hold would fail the **whole save**, not just the attribution | **Resolved by the user, 2026-09-22 — D-U2: the save SUCCEEDS unattributed and shouts.** Both current admins satisfy the FK (`2/2`, measured); the case to watch is a newly-added admin who has never completed a profile — i.e. during an incident, which is when this screen is used. S3-T17 is rewritten and S3-T18 added |
| **K-12** | **NEW. The FR-11 rule drifts between doors** | RC-4's shared predicate, landing in slice 1 with tests before either caller exists; S4-T8 pins the script's behaviour across adoption with a before/after fixture |

*(K-8, the slices 3 → 4a unconfirmed-write window, is **deleted** — RC-7 merged the confirm step into slice 3, so the window does not exist.)*

---

## 12. Questions for SA

Q-1 … Q-7 are answered in §13 and folded in. **Two new items from implementing slice 1**, both raised rather than decided:

- ⬜ **Q-8 (behaviour, lands in slice 4) — the shared switch-off predicate skips NON-SWITCHABLE calls; the script's inline block does not.** `scripts/bos-llm-settings.ts:284-303` filters on `enabled === true` alone, so it can name a call such as `chat/planner`. I believe that is wrong twice: the planner cannot keep spending after an area switch-off (the chat entry gate stops it before it runs, D-27), and `--include-calls` would then write `enabled: false` into it — producing a row `validateAreaRow` **refuses** as `locked`, so the operator's emergency command fails at the last step. The shared predicate therefore skips them, which is the same reasoning that deleted the S1-7 "PARTIAL SWITCH" warning. **Slice 1 ships no caller, so nothing changes yet**; the script's behaviour changes in that corner when it adopts the predicate in slice 4. Confirm, or tell me to reproduce the script's current behaviour exactly and fix it separately.
- ⬜ **Q-9 (small, for the record) — `checkModelAcceptable` gained an optional guardrail-context parameter** (§4.5 D-2), so the option builder can ask ~40 × 22 questions without re-reading the image configuration each time. Defaulted, so every existing caller is byte-identical. Flagged because it is a second additive change to `modelSettings.ts` beyond the provenance one Q-1 approved.

Also on the record, not questions: **`app/api/admin/business-os/llm-settings/route.ts` is not inside the literal gate's scope** (the scope is the catalog's direct importers; the route reaches it one hop away) — the source test S1-T12 covers it instead (§4.5 D-11); and **one suite is red on `main` for a reason unrelated to this work** (§4.5 D-13).

Standing: any pressure to touch `scripts/check-bos-llm-literals.ts` (§3.7) or to widen the FR-18 aggregate beyond count + latest comes here first.

---
---

## 13. SA Review Notes

## SA Workplan Review

**Reviewed by SA — 2026-09-22**
**Status:** 🔄 **Revision Required — conditional approval.** The plan is sound: the code-reality check is real (I re-derived W-1, W-2, W-4, W-5, W-6, W-8, W-11 and the R-1/R-5 citations from source, and all of them hold), R-1 … R-5 are mapped honestly, and the three findings that change the design were found rather than assumed. **Twelve required changes below.** None needs a second workplan cycle: fold RC-1 … RC-5 and RC-9 … RC-12 into the document and **slice 1 may start immediately**; RC-6 … RC-8 land in the slices they name.

Two things on the record before the list. First, the Dev raised Q-3 rather than quietly picking an option — the option it rejected (B) is the one that would have cost the most and been hardest to unpick, and the option it recommended is the one that costs nothing. Second, §11 and Q-7 handle the `console.*` rule the way the rule intends: count, flag, propose, and do not reformat a file you are not working on.

---

### Required changes

**RC-1 — Q-3: Option C, plus one rendering fix. (Blocking slice 1; resolved here, not deferred.)**
Take **C**. `details.door: 'screen' | 'break_glass'` on every entry from both doors, as a **required** parameter of the shared helper pair. **No `updated_via` column, no migration, no audit read.** Reasoning against my own R-2, since the Dev asked directly: R-2 protects *incident reconstruction* — "the control plane was unusable when this happened" is a fact you need while reading the trail, and C keeps that property whole and type-enforced. Option A would put a second provenance column beside an audit trail that already records the same fact — two sources of truth for one question, which is what the single-source principle exists to stop — and it contradicts D-16's "no new column" for a field no decision reads. The live-incident cost of C is also smaller than it looks: if an admin is reading the card, the screen is working, which already answers the question the door was signalling.
**But C as drafted loses more than it needs to,** because §3.6's rendering #1 collapses two different states into one blank. Required: FR-14 renders **three** row states, not two —
  - **no stored row** → the FR-7 line, no attribution (unchanged);
  - **row present, `updated_by` null** → *"last changed at Y — actor not recorded; see the audit trail"*. Never blank, never "unknown" (FR-14's own rule), and **not** the same rendering as "no row";
  - **row present, `updated_by` set** → the email, or the raw id labelled unresolved.

  This recovers the R-2 signal for free in the only case that matters: the screen **always** attributes, so a present row with no recorded actor is de-facto a break-glass change, and the card now says so without a column.
**Also forbidden explicitly, so it is not rediscovered as a shortcut:** smuggling the door into `system_settings_config.description` (or any other free-text column) via `set()`. It is a human-readable column the seed already writes; overloading it is a schema change without a migration.

**RC-2 — Q-1: approved in the resolver, with two conditions.** The provenance output belongs in `evaluateAreaRow`. The route alternative is a second implementation of precedence, and §3.2's own counter-example (a rejected call-level model falling through to `area`) proves the route cannot get it right from the stored row alone — I confirmed the break-on-accept loop at `modelSettings.ts:505-560` discards exactly that. Conditions: (a) `provenance` as a `Map` is fine inside the module, but **the view builder must serialise it to a plain object** — a `Map` crossing `JSON.stringify` silently becomes `{}`, and this payload is rendered, so it is the sort of bug that ships green; (b) S1-T4 is joined by an assertion that `resolveBosLlmSettings` and `isBosLlmAreaEnabled` outputs are **unchanged field for field** — "additive" is a claim until a test pins it.

**RC-3 — Q-2: approved, including `FALLBACK_PRICING` — but the filter must leave `route.ts`.** (a) Same-module accessor, yes: a second path through `aiModelPricingRepository` would be a second pricing source that can disagree with what `priceFor` sees, and a picker that disagrees with the validator is the K-5 failure. (b) Include the fallback entries, yes, for the Dev's own reason — `getPricingInternal` serves them, so excluding them makes the picker narrower than the validator; keep the advisory label and the cache age.
**The required change is where the filtering lives.** §3.3 puts `inputCostPerToken > 0 && outputCostPerToken > 0`, `ALLOWED_PROVIDERS_LAYER2` and `isImageModelName` **in the route** — and AC-9 / S3-T3 assert the route contains "no price lookup, no temperature bound, no provider list". As drafted, slice 3's own source test fails on slice 1's code. Move option construction into `adminSettingsView.ts` (or a sibling `modelOptions.ts`) so `route.ts` holds no guardrail-shaped expression and S3-T3 stays a meaningful test rather than one loosened to fit.

**RC-4 — FR-11 must be a shared predicate, not a second copy in the route.** The "a call-level `enabled: true` survives an area-level `enabled: false`" refusal is **not** in `validateAreaRow` — it is script-local logic at `scripts/bos-llm-settings.ts:284-303` (I read it). T3.4 as written re-implements it in the route, which makes the screen a door that can drift from the script on the one refusal an emergency depends on — the precise failure the requirement's "not a weaker door than the script" clause exists to prevent. Required: a pure shared helper in `lib/business-os/llm/`, a function of the **candidate row** (e.g. `callsBlockingSwitchOff(area, candidateRow): string[]`) plus its `--include-calls` transform, used by the route in slice 3 and adopted by the script in slice 4. One implementation, two callers — the same shape as the notification helper (SA-9).

**RC-5 — Q-4: awaiting is right; 5 s is not, and `Promise.race` does not cancel.** Awaiting is correct, and for a second reason the plan should record: on Vercel, work not awaited before the response can be frozen with the invocation, so fire-and-forget is unreliable **delivery**, not merely an unreported result. R-3 and reliability point the same way. Three changes: (a) deadline **3 s**, and the route declares `maxDuration` explicitly so the deadline is provably inside the platform limit rather than inside an assumption — the `PUT` already spends a fresh read, a validation with pricing lookups and a write before the send; (b) racing abandons the promise but does not cancel it, so the original send keeps its own `.then` / `.catch` logger and the eventual outcome still reaches the log; (c) the `timed_out` copy must not claim non-delivery — *"could not confirm the email went out — assume it did not and tell them yourself"*. `not_sent` keeps §3.5's wording.

**RC-6 — Q-6: drop `costSum` and `costSumCapped`.** Two bounded statements (exact `count`, newest-first `limit 1`), no third. None of the three readings uses cost, and a cost figure that is **silently capped at 1,000 rows** and rendered during a cost incident is K-1 appearing in a new place: a number that looks authoritative and is not. AC-25's "count, latest timestamp and cost sum" narrows to "count and latest timestamp" — strictly less data exposed on a deliberate cross-tenant read, so it needs no BA round. If cost is ever wanted here, it is an RPC, not a capped page.

**RC-7 — Fold slice 4a into slice 3; keep the FR-24 split.** Q-5's split of FR-24 stands (approved, for the Dev's reasons). 4a does not. §6.5's mitigation for K-8 is *"hold slice 3's merge if 4a cannot follow in the same session"* — that is a coordination promise, not a control, and it is the same class of thing that made me extend D-10's re-open trigger. 4a is **S** (~150 lines) against slice 3's L; merging deletes the window instead of mitigating it, and one L+S PR is still reviewable. Slices become **1 · 2 · 3 (writer + confirm step + the generic route's message) · 4 (break-glass + docs)**. FR-3's one-string change rides with slice 3. Renumber §7 into §6 and drop K-8.

**RC-8 — State and test the dry-run status code.** §3.1 does not say what a dry-run with rejections returns. It must be **200 with `ok: false`** — a preview that correctly refuses is a successful request; only a real write refusal is 400 (FR-9). A 400 on dry-run makes "preview" and "failure" indistinguishable to the client and pushes the UI into treating a normal refusal as an error. Related: when `ok === false`, the UI must **not** render `resolvedAfter` as a would-be diff — `validateAreaRow` returns `resolved` even for a rejected row, and showing it beside refusals reads as "this is what you will get" when nothing will be written.

**RC-9 — `import 'server-only'` on the new server modules.** `adminSettingsView.ts`, `areaSwitchOffNotice.ts` and the options module from RC-3. The repo already uses this (`lib/branding/*`). It turns FR-6's "the client imports no server module" into a build failure instead of a source test that a future refactor can quietly stop covering. The source test (S2-T2) stays.

**RC-10 — Prove `system_settings_config.updated_by` exists before slice 1 relies on it.** In this repository the column appears **only** as a TypeScript declaration (`lib/repositories/types.ts:398`, and the admin page's local interface at `:35`). There is **no DDL for the table under `supabase/migrations/`** — it is one of the dashboard-created tables. D-16, FR-13, FR-14 and R-5 all rest on it. Required: verify against the live schema that the column exists, its type, and any FK (the route passes an `auth.users` id from `requireAdmin`), and record the evidence in §2.1 as a G-row. Cheap now; discovered in slice 3 it invalidates a merged slice 1.

**RC-11 — R-1's slice-1 half: sufficient, but assert both halves separately.** I checked whether the hazard closes on its own, and it does — `listActive()` can return an active admin with `user_id: null` (`AdminUserRepository.ts:27`, `:105`), and slice 1 closes it twice over: the map skips null-`user_id` admins, and the null-`updated_by` case is branched **before** any lookup. Note also that until slice 4 the script passes no actor at all, so no new unattributed-write path exists before 4b — the two halves really are independent and the ordering is safe. But S1-T11 as worded can pass with only one of the two guards present, and each alone is wrong in a different way: with only the null-first branch, the map still carries a `null` key; with only the skip, a null `updated_by` renders as a raw id labelled unresolved — i.e. the string `null` on screen. Required: assert (a) the build-side skip and (b) the lookup-side null-first branch **independently**, so removing either fails. With RC-1, (b)'s rendering becomes *"last changed at Y — actor not recorded"*.

**RC-12 — The environment blocker is stale; measure the baselines before the first edit.** The header and §4.4 say no gate can run. The worktree now has the `node_modules` junction and `.env.local`. Update the header, and treat **T1.0 as the first action of slice 1** — the three baselines (`typecheck:bos-llm` files/errors/new, `check:bos-llm-literals` violations, the literal-scope `--list` file set) recorded **before** any edit, because an "after" number with no "before" proves nothing. K-9 closes.

---

### Answers to the Dev's questions

| Q | Answer |
|---|---|
| **Q-1** | **Yes — the resolver.** Additive `provenance` on `AreaEvaluation` / `AreaRowValidation`; the requirement's "no change expected" was an expectation, not a constraint, and W-1 is a good reason to break it. Subject to **RC-2** (serialise the `Map`; pin existing-caller behaviour). |
| **Q-2** | **(a) Same-module accessor. (b) Yes, include `FALLBACK_PRICING`.** Both for the Dev's stated reasons — a second pricing path can drift from `priceFor`, and a picker narrower than the validator teaches operators a falsehood. Subject to **RC-3** (the filter moves out of `route.ts`). |
| **Q-3** | **Option C**, with **RC-1**'s three-state FR-14 rendering. Not A (a second source of truth for one fact, and a migration for a field no decision reads), not B (D-16 rejected it and I do not reopen it). The narrowing is recorded in the requirement's Change History, not only here. |
| **Q-4** | **Awaited, yes — the shape is right, the number is not.** 3 s, an explicit `maxDuration`, a logger on the abandoned promise, and `timed_out` copy that says "could not confirm", never "not sent" (**RC-5**). |
| **Q-5** | **The FR-24 split is confirmed** — 4b is a different door with no session, unit-testable against a fake `admin_users`, and it owns its docs. **The 4a split is not** (**RC-7**): fold the confirm step back into slice 3. |
| **Q-6** | **Drop `costSum`** (**RC-6**). Two statements, no cap, no flag. The capped-sum-with-a-flag design is defensible engineering answering a question nobody on this screen asks. |
| **Q-7** | **Agreed — do not touch `app/admin/system-config/page.tsx`.** The boundary is right: the CLAUDE.md rule binds files you *touch*, the sidebar entry (W-9) is the nav, and converting 20 `console.*` calls in an unrelated monolith inside this feature's PR would make the diff unreviewable. Two conditions: re-count at implementation time rather than trusting today's number, and **if the user does want the in-page link, the full Pino conversion lands first, as its own commit in the same PR** — never a partial conversion of the lines near the link. |

---

### The Dev's own decisions — ruled

| Decision | Ruling |
|---|---|
| Response and payload shapes (§3.1) | **Sound**, with **RC-8** (dry-run is 200 / `ok: false`) and **RC-2a** (no `Map` in a serialised payload). The `area`-enum-only body with the key derived server-side is exactly right — key forgery is unreachable, not defended. |
| The `adminSettingsView.ts` seam | **Sound, and the best structural idea in the plan.** A thin route, a testable builder, and one obvious home for the id→email map and (with RC-3) the option list. Add `server-only` (**RC-9**). |
| Three-statement aggregate (PostgREST has no `sum`) | **Correct finding, wrong conclusion.** The existing `business_os_usage_summary` RPC is user-scoped and carries no cost column, so it is genuinely not reusable — but the answer is to drop the field that forced the third statement (**RC-6**), not to cap it. |
| Exclusion by normalised email **and** `user_id` (W-5) | **Sound — and stronger than my R-4 wording.** `AdminRouteUser.email` really is optional (`requireAdminRoute.ts:31`), so email alone can miss; `user_id` alone misses an unbound row. The OR can only over-exclude the actor themselves, which is the intent. Approved as written. |
| Server-side chat short-circuit (§3.4) | **Sound, and better than the requirement asked for** — readings that are never produced cannot be un-hidden by a client change. One addition: the short-circuit must sit **before** the repository call, so a chat request issues no cross-tenant read at all. |

---

### Standards — confirmed against the plan

- **`requireAdmin` / `requireAdminPage`:** correct on both. `requireAdmin(requestLogger)` as the first statement with the `instanceof NextResponse` early return; the page adds no guard and inherits `app/admin/layout.tsx` (G-8). The plan explicitly does **not** copy the `llm-usage` sibling, which would fail the required `Admin authz surface guard`. S1-T1's source assertion that the file contains no `AdminAccessService` reference is the right belt-and-braces.
- **Repository pattern:** every read and write goes through `SystemConfigRepository`, `TokenUsageRepository` and `AdminUserRepository`; §4.4's grep for a direct Supabase client outside `lib/repositories/` is the enforcement. Holds.
- **Zod:** the `PUT` body **and** the ledger route's query string. Keep the query schema — `since` is a caller-supplied timestamp that feeds a cross-tenant read.
- **Pino + `correlationId`:** both routes, no `console.*` in anything created. §11 is a real count, not an assertion.
- **The literal gate** (`Type check (Business OS LLM attribution)`, required and proven blocking): I re-read the gate header. The four documented false-positive shapes are a model-id `z.enum` / allow-list, a schema default, a per-model `switch`, and a price-index key literal. §3.7 designs all four out, and RC-3 *helps* — moving the option filter out of the route removes the one place a model-keyed expression was likely to appear. The escape is confirmed as the header prescribes: **a narrow rule change in `scripts/check-bos-llm-literals.ts` with SA review — never a new file exemption** (two exist; neither is widened) **and never a baseline regeneration.** Dev raises it as a question; Dev does not edit the gate unilaterally.

### Optimisation suggestions (non-blocking)

- `staleSince` reads like a cache field; `rowChangedAt` says what it is.
- S1-T12's source scan is worth extending to assert the `server-only` import from RC-9 — one line, and it catches the refactor that drops it.
- The ledger panel's "corroboration, not proof" sentence should be one string shared by the route response and the component, so a future copy edit cannot make them disagree.

### For the user (business, not technical)

- **Q-7 is the only one:** do you want a link to the new screen inside the existing System Config page? Default is **no** — the sidebar entry is the nav. If yes, that file's 20 `console.*` calls get the full Pino conversion first, which adds a commit to slice 2.

### Approval

- [x] **Workplan approved to proceed to implementation, conditionally.** Fold **RC-1 … RC-5** and **RC-9 … RC-12** into the document and start slice 1. **RC-6** lands in slice 1's aggregate, **RC-7** restructures slices 3 / 4a, **RC-8** lands in slice 3.
- [ ] RC-1 … RC-12 reflected in the workplan — SA verifies at the slice 1 code review.

---

## SA Code Review — Slice 1

**Reviewed by SA — 2026-09-22**
**Scope:** the uncommitted slice 1 tree in `neuronforge-llm-admin-ui` off `origin/main` `d9c60ab4` (HEAD unchanged) — 2 routes, 4 new `lib/business-os/llm/` modules, 4 modified files, 7 test files.
**Status:** 🔄 **Fix Required.** Everything structural is right — the shared predicate, the three readings, the two R-1 guards, the resolved-first seam, the `requireAdmin`-first gate, the repository discipline and the gate hygiene. Seven local fixes below stand between this and QA; none needs a re-plan, and none is in the parts that were hardest to get right.

**Gates re-run by SA in this worktree, not taken from the summary:**

| Gate | SA's measurement | Matches Dev's §4.4 |
|---|---|---|
| `npm run typecheck:bos-llm` | `176 files in scope, 31 errors, 0 new (85.4s)` — passed | ✅ |
| `npm run check:bos-llm-literals` | `42 files in scope, 2 exempt, 0 violations (15.9s)` — passed | ✅ |
| `npm run build` | exit 0; `.next/server/app/api/admin/business-os/llm-settings/{route.js,ledger/route.js}` both emitted | ✅ |
| `npx jest lib/business-os/llm lib/ai lib/repositories app/api/admin/business-os` | **739/740**, 47/48 suites | ✅ |
| `git status scripts/` | clean — **no exemption added, none widened, no baseline regenerated** | ✅ |

**The one red suite is confirmed pre-existing and unrelated.** `lib/business-os/llm/__tests__/callParams.boundary.step3.test.ts › T3-S › chat/planner` fails on `__snapshots__/callParams.boundary.step3.test.ts.snap:44`, which hard-codes `"Today is 2026-09-21."` against today's `2026-09-22`. Neither the test nor the snapshot appears in this diff (`git status` on both paths is clean), and the diff shows exactly one line moving — the date. Not this slice's. **SA agrees it should not be absorbed here, and agrees it is a real weakness:** a snapshot that goes red every day after it is recorded trains people to ignore the suite. Logged as a follow-up for the TL, outside this feature.

---

### Code Review Comments

**Must fix before QA**

1. **`lib/business-os/llm/modelOptions.ts` — no test exists at all. Priority: High.** The module at the centre of D-1 and FR-8 is **mocked out** wherever it appears (`lib/business-os/llm/__tests__/adminSettingsView.test.ts:36-37`), and no `modelOptions.test.ts` was written. So **S1-T7 is only half-delivered**: `listPricedModels` is covered by S1-T13, but the acceptability question, the per-call split (D-3), the provider narrowing and D-4's "the code default is always offered" have **zero** direct coverage. AC-7 is not met. (§4.1's file table also omits the test file — the plan needs the row as well as the code.)

2. **`modelOptions.ts:83-85` — the provider rule *is* restated, which contradicts D-1's own claim. Priority: Medium.** Candidates are narrowed on the **global** `ALLOWED_PROVIDERS_LAYER2`, and the comment asserts *"`checkProvider` remains the gate"* — but `checkProvider` is never called on this path and is not exported. The resolver gates provider on the **per-call** `policy.allowedProviders` (`modelSettings.ts:373-377`). They coincide today only because `modelSettingsPolicy.ts:279` sets `OPENAI_ONLY = ALLOWED_PROVIDERS_LAYER2`. The day one call gets a narrower list, the picker offers a provider `validateAreaRow` refuses — precisely the drift D-1 claims to have removed at the root. `policy` is already in hand at `:90`; filter on `policy.allowedProviders`, and correct the comment.

3. **`modelOptions.ts:98` — `checkModelAcceptable` is not the resolver's model gate, so the picker can be *wider* than the validator. Priority: Medium.** The resolver calls `checkModel` (`modelSettings.ts:331-345`), which applies four shape rules — `model_not_a_string`, `model_empty`, `model_not_trimmed`, `model_too_long` — **before** delegating to the checks `checkModelAcceptable` exposes. Candidates come from `ai_model_pricing`, an operator-editable table, so a `model_name` carrying whitespace or exceeding `MAX_MODEL_NAME_LENGTH` would be **offered in the picker and refused on save**. That is the inverse of K-5 and the same class of failure. Either ask a function that includes the shape rules, or run candidates through them before offering.

4. **`ledgerCheckCopy.ts:25-29` vs `ledger/route.ts:113-116` — `too_soon` is a fifth reading that escaped the shared-copy guarantee. Priority: Medium.** The route produces `kind: 'too_soon'` with its sentence written **inline**, while `LedgerReadingKind` declares only four kinds and `LEDGER_READING_TEXT` holds only four strings. This breaks D-9's whole point (one string, route and panel cannot disagree) at exactly the branch slice 2 will consume, and leaves the client's discriminated union incomplete — a `switch` over `LedgerReadingKind` in `LedgerCheckPanel` will have no branch for it. Add the kind and its text to the shared module. Fix in slice 1: the type is the contract slice 2 builds against.

5. **`ledger/route.ts:105-139` — `since` is unbounded, so one URL can order two full-table cross-tenant counts. Priority: Medium.** `windowMs = now − (since + 60 s)`, and the baseline window is the same length ending at `since`. A `since` of `1970-01-01` therefore issues two `count: 'exact'` scans over the whole of `token_usage` with no cap; `assertWindow` (`TokenUsageRepository.ts:180-184`) checks only `start <= end`. It is `requireAdmin`-gated, so this is not a security hole — but it is an unbounded scan of the largest table in the system, reachable from a query string, and the requirement's window is "save + 60 s". Reject or clamp a `since` older than a stated maximum, and say so in the response.

6. **`app/api/admin/business-os/llm-settings/route.ts:22-27` — the header states the opposite of D-11. Priority: Medium (for a comment).** *"This file imports the call catalog, so it is inside `check:bos-llm-literals`"* is false: the route imports `adminSettingsView`, and `literalScope()` (`scripts/lib/bos-llm-scope.ts`) selects `rel === CATALOG || imports.imports.has(CATALOG)` — **direct** importers only. D-11 states this correctly; the code comment states it backwards, on the one file whose coverage people will assume. Correct the header to say this file is **out** of the gate's scope and that S1-T12 is what covers it.

7. **`__tests__/route.test.ts:191-201` — S1-T12 must be strengthened whatever happens to the gate. Priority: High.** Two defects independent of the ruling below: (a) line 200's model-family list is `gpt-4o|gpt-4o-mini|gpt-5*|o1*|text-embedding-*` — a literal `'claude-3-5-sonnet'`, `'mistral-large'` or `'kimi-k2'` in `route.ts` passes **all five** assertions, while the real gate's rule covers them; (b) `allFiles` is a hand-maintained array, so a sixth file or a second route in this folder extends nothing. Widen the family list to match the gate's rule and derive the file list from the folder.

**Should fix — not blocking slice 1**

8. **`lib/repositories/TokenUsageRepository.ts:440` — *"Returns THREE FACTS AND NO MORE — how many rows, and the newest one's timestamp."* Priority: Low.** Two facts. Leftover from the pre-RC-6 `costSum` shape; the sentence now miscounts its own guarantee.

9. **`lib/business-os/llm/adminSettingsView.ts:243-250` — W-12's cost claim no longer holds. Priority: Low (slice 1) / Medium before slice 2.** The eight areas are processed **sequentially**, and `buildAreaModelOptions` re-enters `listPricedModels()` and creates a **fresh** guardrail context per area, then asks `checkModelAcceptable` once per (candidate × call). On today's catalogue that is on the order of 1.5–2 k awaited checks per `GET`, memoised only within one area — not "two queries plus the memoised pricing read". Correct and admin-only, so it ships; but hoist `listPricedModels()` and one context to per-request, and `Promise.all` the areas, before slice 2 puts this behind a page load.

10. **`ledger/route.ts:145-146` — `afterResult.data!` / `beforeResult.data!`. Priority: Low.** The only nullable asserted away in this diff. A `{ data: null, error: null }` result would throw inside the happy path and surface as a bare 500 rather than a classified failure.

**Plan changes for later slices, raised now**

11. **S3-T17 / K-11 is necessary but not sufficient. Priority: Medium (slice 3).** Classifying an `updated_by` FK violation and logging it distinctly still leaves the **save failed**. FR-24's own principle is that missing attribution never blocks an emergency, and the FK is most likely to bite for a newly-added admin — during an incident, which is when the screen is used. Slice 3 should catch the FK violation and **retry the write without the actor**, then log and audit at `critical` with an `actorSource` of its own, giving the screen the same three-outcome shape §3.6 already defines for the break-glass door.

12. **S4-T8 as written will fail under the Q-8 ruling. Priority: Medium (slice 4).** It asserts the script "refuses exactly the calls it refused before and `--include-calls` writes the **identical** row". Approving D-5 means that must be false for the `chat/planner` case. Re-specify S4-T8 to pin the **intended difference** with a named fixture, not identity.

13. **`scripts/bos-llm-settings.ts:276-303` — FR-11 is bypassed entirely on the `--file` path. Priority: Medium (slice 4), pre-existing.** The switch-off refusal sits inside the `else` of `if (options.file)`, so a `--file` row that sets the area `enabled: false` while leaving a call `enabled: true` is written with **no** FR-11 check at all. Found while ruling on Q-8. Slice 4 should lift the predicate above the branch so both input paths get it.

14. **RC-1's state-2 copy will point at an empty audit trail on day one. Priority: Low (slice 2).** §2.2 measured `updated_by` null on all eight rows, so *"last changed at Y — actor not recorded; see the audit trail"* is what every card renders at launch — and those seeded rows have **no** audit entry either, because the seed predates the helpers. The wording should not promise the trail holds an answer.

---

### Rulings on the questions raised

**Q-8 — APPROVED. The predicate is right and the script is wrong.** Verified from source rather than from the note:

- `modelSettings.ts:663-673` — for a non-switchable call, a call-level `enabled: true` is **accepted silently**: the `push` fires only when `rawCall !== ABSENT && rawCall !== true`. So a stored row really can hold `'planner': { enabled: true }` and validate clean.
- The same block refuses a call-level `enabled: false` on that call as `kind: 'locked'`, reason `call_not_switchable`, and `validateAreaRow` puts every non-`adjusted` issue into `rejected`.
- Therefore the script's `enabled === true`-only filter (`scripts/bos-llm-settings.ts:285-289`) would name `chat/planner`, refuse the plain `--enabled false`, and then build — via `--include-calls` — a row the **next** `validateAreaRow` call rejects. The operator's emergency command fails at the last step with nothing written. The Dev's diagnosis is exactly right.
- And the predicate asks the right question: `isSwitchableBosLlmCall` (`modelSettingsPolicy.ts:283-286`) already carries the "either impossible, or stopped by an entry gate" invariant, with `modelSettingsPolicy.test.ts` failing the suite if a future call is added with `switchable: false` and no off path.

**Does slice 4's adoption change operator-visible behaviour? Yes — in one corner, and the change is a bug fix.** `--enabled false` on an area holding a non-switchable call override goes from *"refuse, then fail on retry"* to *"switch off"*. It cannot make the kill switch weaker: a non-switchable call keeps spending only when its area gate fails, and the area switch-off is what sets that gate. Conditions: comments 12 and 13, and the runbook's "which door" section records the change (FR-28).

**Q-9 — APPROVED. `modelSettings.ts` is still safe for the resolver's hot path, and the additions are genuinely inert.** Verified from the diff:

- `checkModelAcceptable`'s fifth parameter is a **default argument**, evaluated per call. An existing four-argument caller constructs the same fresh `newGuardrailContext()` at the same moment it did before — byte-identical, not merely compatible. `newModelCheckContext()` is a one-line re-export of that same constructor, so the picker's answers come from the resolver's own context type; that part of D-1's claim holds.
- Provenance is **write-only** inside `evaluateAreaRow`. `from` is a fresh four-key object per call; every new line writes to it; nothing on the resolve path or either entry-gate path reads it. The two lines that look behavioural — `areaEnabledFromRow` (`:508`, `:538`) and `from.provider = 'default'` (`:603`) — are both new writes sitting beside unchanged assignments. `resolveBosLlmSettings` and `isBosLlmAreaEnabled` pay one `Map` and one four-key object per call: allocation, not logic. S1-T4b pins it and I re-derived it independently.
- **One caveat for the record:** `provenance` is now on the **public** `AreaEvaluation` / `AreaRowValidation` contract, so all 22 live call sites carry it although only the admin screen reads it. At this size that is the right trade — the alternative is the second precedence implementation W-1/RC-2 exists to prevent — but it must not become a precedent for further additive output on that interface.

**The out-of-scope route (D-11) — a source test is NOT an adequate substitute for the gate.** Three reasons, in order of weight: the assertions are a hand-enumerated subset of the gate's AST rules and miss whole model families (comment 7a); the file list is hand-maintained, so coverage does not follow the code (comment 7b); and jest is not a required check on this repo — no workflow runs the full suite today (see the test-tiering workplan), so S1-T12 is not a gate at all, it is a test that happens to exist.

**What should change — and it is the narrow rule change the gate's own header prescribes, never a file exemption.** Add an explicit **inclusion** list to `literalScope()` (`scripts/lib/bos-llm-scope.ts`) — the mirror image of `EXEMPTIONS`, printed by `--list` the same way — and name `app/api/admin/business-os/llm-settings/route.ts` into it. Scope only ever grows, the two exemptions are untouched, and no baseline is regenerated. I considered and reject the alternative of a transitive-closure scope: `modelSettings` has enough importers that 42 files would become hundreds, and a gate that goes red on unrelated code is a gate that gets exempted. **Dev proposes the diff; SA reviews it as its own small PR before slice 2 merges.** Comment 7's two strengthenings are due regardless, in slice 1.

---

### What I verified and found correct — recorded so it is not re-litigated

| Area | Finding |
|---|---|
| **K-11 cannot be tripped by slice 1** | A tree-wide search finds **no** caller passing `opts` to `SystemConfigRepository.set`. The four-argument path is byte-identical (`:290-305`), S1-T10 pins it, and both the Step 0 route and the operator script are undisturbed. Slice 3 is the right home for the classification — with comment 11 added to it. |
| **Null-everywhere is RC-1's state 2, not a defect** | Confirmed by construction: `lastChangedByFor` (`adminSettingsView.ts:155-169`) answers `{ kind: 'not_recorded', at }` for a present row with a null `updated_by`, **before** any map lookup. With §2.2's measurement (all eight rows null) every card renders *"last changed at Y — actor not recorded"* on day one. Correct, expected, and distinct from `no_row`. See comment 14 on the copy. |
| **R-1's two guards** | Present and independent — `:145` (`if (!admin.user_id) continue`) and `:162` (null answered first) — and S1-T11 / S1-T11b assert each one alone, so removing either fails a test. |
| **The ledger aggregate is genuinely cross-tenant and says so** | `summariseFeatureAllAccountsInWindow` has no `assertAccounts` and no `user_id` predicate, runs on the service-role client, is named `…AllAccountsInWindow`, carries the doc block naming its one caller, and logs at **info** because it is a cross-tenant read — matching `listChatCallsAllAccountsInWindow` exactly. Two integers out: no per-account rows, no owner text, no cost, and `feature` is derived from `bosFeature(area)` server-side with a test asserting a caller-supplied `feature` is ignored. |
| **The window arithmetic matches the requirement** | `after = [since + BOS_LLM_SETTINGS_CACHE_MS, now]`, `before` the same length ending at `since`; the constant is **imported**, never the number; the test asserts both windows and that the constant is 60 s. "Completed" is the right word — `token_usage` rows are inserted after the provider call resolves. Subject to comment 5. |
| **The copy cannot degrade into a green tick** | No `ok`, no `success`, no tick field on any branch; all four sentences are statements of fact; the caveat is **one exported string** present on every branch including chat; reading 3 has the same shape and weight as reading 2; and the test scans each reading for *"is off" / "disabled" / "switched off"* while separately requiring the caveat to **actively deny** it rather than merely omit it. This is the strongest part of the slice. |
| **Chat renders none of the three** | Short-circuited at `ledger/route.ts:89`, after Zod and **before** the repository; `after` and `before` are `null`; the test asserts the repository is never called. |
| **The `adminSettingsView` seam is where it should be** | Resolved-first; `validateAreaRow` is the only decider; the resolver's `Map`s are flattened here once with the JSON round-trip asserted (RC-2a); `temperature ?? null` with an explicit "never 0" test; an absent row is `rowPresent: false` + `{ kind: 'no_row' }` and HTTP 200, not an error. It does **not** become a second validator: the policy reads are shipped as rendering metadata and never used to accept or refuse anything. The one place that discipline slips is `modelOptions.ts` — comments 2 and 3. |
| **Standards** | `requireAdmin(requestLogger)` is the first awaited statement on **both** routes, with nothing above it touching a body, the DB or a queue; no `AdminAccessService` anywhere in either file (asserted by source test) — unlike the sibling `app/api/admin/business-os/llm-usage/route.ts:56`, correctly not copied. Zod on the only route that takes input. Pino + `correlationId` throughout; **zero** `console.*` in every new or touched file (§10's count re-verified). No `any`, and no non-null assertion except comment 10. `import 'server-only'` on all three new server modules, and correctly **absent** from `ledgerCheckCopy.ts`, which the client must share. No direct Supabase outside `lib/repositories/`. `SystemConfigRepository` is a global settings table with no tenant column — unscoped by design, admin-gated, consistent with its existing callers. |

---

### Optimisation Suggestions

- `LEDGER_READING_TEXT` should stay a `Record<LedgerReadingKind, string>` with `too_soon` added (comment 4) **and** be exhaustiveness-checked at the route's construction site, so a future fifth reading is a type error rather than a missing panel branch.
- `buildAdminSettingsView()` takes no arguments, which S1-T2 uses as the proof that nothing is forgeable. Worth stating in the module header — it is load-bearing and easy to lose to a future `options` parameter.
- The `codeOf()` comment-stripper in both route tests is the right call (D-12) and worth extracting to a shared test helper when slice 2 adds its third copy.

---

### Code Approved for QA: **No**

Fix comments **1 – 7**, then this is approved without a further SA cycle — send it straight to QA and note the fixes in §4.5. Comments 8 – 10 are the Dev's call for this slice. Comments 11 – 14 are plan edits to make now, so the later slices inherit them, and the `literalScope()` inclusion-list change is its own small PR with SA review before slice 2 merges.

---

## SA Re-check — Slice 1

**Reviewed by SA — 2026-09-22** (delta only, against the review above)
**Status:** ✅ **Code Approved for QA.** All seven must-fixes are applied, and findings 1–3 were correctly diagnosed as **one** bug and fixed at the root rather than three times at the edges. Two small items below are test- and gate-hygiene, not shipping code, and neither blocks the QA handoff.

**Gates re-run by SA, not taken from the summary:**

| Gate | SA's measurement |
|---|---|
| `npm run typecheck:bos-llm` | `177 files in scope, 31 errors, 0 new (85.5s)` — passed |
| `npm run check:bos-llm-literals` | `43 files in scope, 2 exempt, 0 violations (15.4s)` — passed |
| `check:bos-llm-literals -- --list` | `included app/api/admin/business-os/llm-settings/route.ts` · `exempt lib/business-os/llm/modelSettingsPolicy.ts` · `exempt scripts/bos-llm-settings.ts` · **43 in scope, 2 exempt, 1 included by name** — the exemption set is byte-for-byte the one it was |
| `npm run build` | exit 0, `✓ Compiled successfully`, both routes in the table |
| jest (touched paths **+ `scripts/`**) | **884/885**, 53/54 suites — the gate's own suite runs and passes with the new scope |
| `git status` on the baseline | untouched; `typecheck-bos-llm.baseline.json` never regenerated |

The single failure is the same dated snapshot (`callParams.boundary.step3.test.ts.snap:44`, `Today is 2026-09-21`) I independently confirmed pre-existing in the first pass. Unchanged, unrelated.

---

### Ruling — "two functions answering *is this model acceptable*" (findings 1–3)

**Approved. There is no second implementation of any rule, and the Dev's claim is right in the direction that matters.**

- Both exports are **different-length prefixes over the same private chain**. `checkModelForCall` → `checkProvider` + `checkModel` → `checkTokenModel` / `checkImageModel`; `checkModelAcceptable` → the same final pair, directly. Neither restates a rule; the shape rules and the "equal to the code default" shortcut exist in exactly one place, inside the private `checkModel`.
- **`checkModelAcceptable` genuinely cannot be expressed via `checkModelForCall`**: the latter contains the default shortcut, which would return `ok` for a code default **without testing it** — destroying the one thing the defaults proof (T1-3, `modelSettingsPolicy.test.ts:273`) exists to establish. The converse *is* expressible, but only by lifting the shape rules and the shortcut out of `checkModel` into a second location, which is strictly worse. So the asymmetry is real and the Dev's framing stands.
- **The decisive evidence is the caller census, not the argument.** `checkModelAcceptable` now has exactly **one** caller in the entire tree — `modelSettingsPolicy.test.ts:273`. Its production caller moved to `checkModelForCall`. It is a test-only assertion helper, not a competing production answer, so the D-3 hazard (two answers to one question in live code) does not exist.
- **Residual risk is naming, not logic.** `checkModelAcceptable` is the more inviting name and the wrong one for any future picker. Two Low-priority follow-ups, neither blocking: say "test-only; one caller" in its doc block, and add a direct test pinning the distinction (the default pair returns `ok` through `checkModelForCall` and takes the real check through `checkModelAcceptable`), so "neither can be expressed via the other" is pinned by a test rather than argued in a comment. Better still, rename it to name its single job.

### Ruling — is the equivalence assertion tautological?

**The equivalence assertion alone is near-tautological; the suite as a whole is not, and the non-tautological parts are the ones that would have caught both bugs.**

`modelOptions.test.ts:96` has production and test both call `checkModelForCall`, so they agree by construction. What it *does* catch is real and is precisely the class of both review findings: wrong arguments passed, a narrowing step inserted **in front of** the ask, and misuse of the verdict. What it cannot catch is the function being substituted in both places at once.

It is not carrying the weight alone. Eight sibling assertions are **absolute**, not relative: `' gpt-4o '` absent (`:148`), over-length absent (`:149`), zero-priced absent (`:165`), `anthropic` absent (`:177`), `allowedProvidersByCall[call]` identity-equal (`toBe`) to `policy.allowedProviders` (`:188`), the image call refusing a token model (`:231`), the default always offered (`:246`) and never duplicated (`:264`). Those hold without reference to any guardrail function and would each have failed under the code I rejected. **Adequate.**

### Ruling — refuse vs clamp on `since`

**Refuse is right, and for a stronger reason than "nobody reads numbers for a window they did not ask for".** A clamp would answer a different question while keeping the label of the one asked — the counts would be captioned *"since your change"* and would not be. That is the K-1 overclaim in its most dangerous form, because the wrong part would be the caption rather than the number, and this panel's entire design premise is that it never says more than it knows. The 400 names the limit and offers the alternative, and the bound is correctly evaluated **before** the windows are derived (`ledger/route.ts:141-152`) and **after** the chat short-circuit, so a chat request with an ancient `since` still reads nothing rather than erroring. Approved — with **RC-D** below, which is the consequence slice 2 inherits.

### Ruling — shipping the gate change as its own PR

**Approved, but it must land *with or before* slice 1 — not merely before slice 2.** Otherwise slice 1 sits on `main` with the one file uncovered, which is the exact state the change was written to end; the urgency argument that produced it would evaporate on merge.

The "a bad change to a required check blocks everyone" concern does not apply to this change, and it is worth being precise about why: `literalScope()` gains a **disjunct** (`|| included.has(rel)`), so the predicate can only ever admit more files. Scope cannot shrink, no exemption is added or widened, no rule is rewritten and no baseline is regenerated — measured 42 → 43, 2 exempt, 1 included, 0 violations, with the gate's own suite green. The worst case is the gate going red **for a real reason**. Two conditions, in the gate PR, not slice 1 (**RC-B**).

---

### Findings in the delta

1. **RC-A — two of S1-T12's five assertions are dead code. `app/api/admin/business-os/llm-settings/__tests__/route.test.ts:63-66`. Priority: Medium.** The template literals lose their escapes: `` `case\s+…` `` compiles to `/cases+…/` and `` `\[\s*…\]` `` to `/[s*…]/`, a character class. Verified by constructing both at runtime — the `switch`-on-a-model rule **never matches** `case 'gpt-4o':`. Coverage is not actually lost, because the broad quoted-literal rule on line 63 subsumes both shapes (a `case 'gpt-4o':` and a `PRICES['gpt-4o']` each contain a quoted model id, and I confirmed it catches them). But this is a test that exists *because* CI does not cover the file, so two decorative assertions presented as rules are worth two backslashes. Use `String.raw` or `\\s` / `\\[`.

2. **RC-B — `LITERAL_SCOPE_INCLUSIONS` ships without the discipline `EXEMPTIONS` has. `scripts/lib/bos-llm-scope.ts:194-204`. Priority: Medium — in the gate PR, not slice 1.** (a) **No equality cap.** `EXEMPTIONS` is pinned by `scripts/__tests__/check-bos-llm-literals.test.ts:204` (`expect(Object.keys(EXEMPTIONS).sort()).toEqual([POLICY, SETTINGS_SCRIPT])`), so a third exemption fails the suite deliberately. The new, symmetric lever has no such cap — only S1-T12's "contains the route" assertion, which is satisfied by any superset. Mirror the cap. (b) **No stale-entry assert.** An inclusion naming a file that is not in the import graph silently becomes a no-op, so renaming or moving `route.ts` would drop it back out of scope **with a green gate** — the precise failure this whole change was written to prevent. Fail the gate loudly on an inclusion that matches nothing.

3. **RC-C — the payload now carries two provider lists. `lib/business-os/llm/adminSettingsView.ts:117, :273`. Priority: Low.** `AreaView.allowedProviders` (the global `ALLOWED_PROVIDERS_LAYER2`) survives beside the new, authoritative `modelOptions.allowedProvidersByCall`. That is finding 2 one layer up: slice 2 can render the global one and be wrong the day a call narrows. Drop the area-level field, or mark it non-authoritative in the type.

4. **RC-D — the 24 h bound makes the ledger panel a post-save affordance, and slice 2 must treat it as one. Priority: Medium (slice 2).** All eight rows carry the seed `updated_at` of 2026-09-21, so a panel rendered on page load from the row's `updated_at` will take a **400 on every area** from day one. The refusal is correct; the coupling is the point. Slice 2 must either offer the check only after a save, or render the 400 as a first-class *"too long ago to check"* state — never as an error. Record it beside FR-18 so it is not discovered in QA.

5. **The `Promise.all` did not alter failure semantics — confirmed, and the premise is worth correcting.** `adminSettingsView.ts:207-232`: the per-area work does **no** per-area read. The rows arrive in one `getByKeys` before the loop, and the only I/O inside is through the shared guardrail context, where `priceFor` already swallows its own errors into `unpriced_model`. Sequentially a throw in area 3 aborted the builder; under `Promise.all` a rejection does the same. **Identical, and all-or-nothing both before and after** — so "one area's failed read takes the whole response down" was never the behaviour and is not the new one. Every branch is awaited inside the `map`, so there is no unhandled rejection. I would also argue all-or-nothing is the right semantics here: a settings screen that silently renders seven of eight areas is worse than one that errors.

6. **Findings 4, 5, 8, 9, 10 verified applied.** `too_soon` is a first-class `LedgerReadingKind` with its sentence in `LEDGER_READING_TEXT` and the route serving the constant (asserted by `ledger.route.test.ts:141-147`, plus `:160` requiring every produced kind to have an entry) — **D-9 holds again**, and `LEDGER_READINGS_WITH_COUNTS` gives slice 2 the count-free set explicitly, so the union it consumes is complete. `since` bounded at 24 h before the windows are derived, with its own refuse-not-clamp test (`:180`). `TokenUsageRepository.ts:442` now says "TWO FACTS". Both `data!` assertions replaced by an explicit null branch (`ledger/route.ts:178-181`). One pricing snapshot and one guardrail context per request, with the "reads it once, not once per area" property directly asserted (`modelOptions.test.ts:283-295`). S1-T12's file list is now **derived by walking the folder** rather than enumerated, and its family list mirrors the gate's — I confirmed the broad rule catches `'claude-3-5-sonnet'`, which the old assertions let through.

---

### Slice 3 — sanity check on the user's decision (save succeeds unattributed and shouts)

The framing is right and matches FR-24's own principle. Two conditions on how it is built, so the plan can carry them:

- **Separability must be catch-and-retry on the Postgres error code (`23503`) plus the constraint name — not a message substring, and not a pre-emptive two-statement write.** `set()`'s update is one statement today; splitting it into "write the value, then write the actor" would make every *normal* save two round trips and open a window in which a concurrent reader sees the new value beside the **previous** actor — worse than the problem being solved. The retry re-issues an idempotent UPDATE of the same value, so a double-write is harmless. A substring match on the error text would silently swallow an unrelated foreign key some day.
- **Record the trap this creates for RC-1.** With no sentinel, a screen save that fell back to unattributed leaves a row **indistinguishable** from a break-glass change, so RC-1's inference — *"a present row with no actor is de-facto a command-line change"* — stops being sound the moment this fallback can fire. The copy as specified is safe because it claims only *"actor not recorded"*; slices 2 and 3 must never promote it to a break-glass claim, and the audit trail becomes the only place the two can be told apart. That makes the `critical` entry load-bearing: it must be written **after** the settings write and must not be able to fail it (the existing AC-21 / S3-T14 property).

---

### Code Approved for QA: **Yes**

RC-A is two characters in a test. RC-B belongs to the gate PR, which lands with or before slice 1. RC-C and RC-D are carried into slice 2's scope. None of them is in the code slice 1 ships, and slice 1 still ships nothing writable.

---

## SA Code Review — Slice 2

**Reviewed by SA — 2026-09-24**
**Status:** 🔄 **Fix Required** — three must-fixes (F-1, F-3, and F-4's comment), none of them large. The screen itself is the best-argued UI in this repo: the FR-6 boundary is real and independently pinned, the fail-open notice is undismissible by construction rather than by convention, FR-14's three states are three different sentences, and RC-D lands as a neutral first-class state rather than an error. **What fails is not the page — it is the test that pins the one guard protecting it, and one sentence in the banner that is false for exactly one area.**

Every gate below was re-run by SA in the worktree, not taken from the summary. Every mutation below was applied, measured and reverted by SA; `git status` at the end of the review is byte-identical to the one at the start.

**Gates, as SA measured them:**

| Gate | SA's measurement | Dev's claim |
|---|---|---|
| `npm run typecheck:bos-llm` | `231 files in scope, 28 errors, 0 new (84.9s)` — passed | matches |
| `npm run check:bos-llm-literals` | `43 files in scope, 2 exempt, 0 violations (18.1s)` — passed | matches |
| `npm run lint:hooks` | clean, no output | matches |
| `npm run build` | exit 0; `/admin/business-os-llm/page` present in `.next/app-build-manifest.json`, `.next/server/app/admin/business-os-llm` emitted | matches |
| jest, the screen's five suites | **5 suites / 71 tests**, all green | matches |
| jest, all three touched paths | **25 suites / 526 tests**, all green | matches |
| `npx eslint` on every new file | 0 problems | matches |

The screen is correctly **outside** both CI gates' scope (it imports nothing from the call catalog, by design), so `source.guard.test.ts` is the only enforcement that exists for FR-6 and for the no-literals rule. That raises the bar on that file, which is where F-1 lands.

---

### Priority 1 — the access guard. The reasoning holds. The test that pins it does not.

**The reasoning is correct, and correct for a stronger reason than the Dev gives.** Walking each path:

| Path | Verdict |
|---|---|
| Full page load / direct RSC payload request | `app/admin/layout.tsx:40` awaits `requireAdminPage()` and the page renders as its `children`. There is no per-page escape from a parent layout, and `redirect()` throws to unwind before any child renders. ✅ |
| Client-side soft navigation **into** `/admin` | The layout is not yet mounted, so it renders and the guard runs. ✅ |
| Soft navigation **between** `/admin` siblings | Escape E2, documented at `requireAdminPage.ts:26-29`: the layout does not re-render. Harmless here, because the caller already passed the guard on entry to the subtree. ✅ |
| Prefetch | Prefetching `/admin/business-os-llm` renders the layout, so a non-admin's prefetch gets the redirect, not the payload. ✅ |
| Route handler under the page's directory (escape E1) | **None exists.** `find app/admin -name route.ts` returns nothing, and R3 of the required `Admin authz surface guard` keeps it that way. ✅ |
| Server action | **None.** `grep -rn "use server" app/admin/business-os-llm/` finds no match. ✅ |
| Data disclosure if the shell ever leaked | **Zero.** `page.tsx:1` is `'use client'` with no server props and no server fetch: the RSC payload carries a client-module reference and literally no settings. Both `GET`s are `requireAdmin`-gated as the first statement (`llm-settings/route.ts:59`, `ledger/route.ts:106`). The API gate is the security boundary; the layout is defence-in-depth, exactly as `requireAdminPage.ts:29` says. ✅ |

**So the page is guarded. But the assertion that proves it is defeated by a comment — F-1 — and the required CI check never proved it at all — F-2.** Both are one line each.

---

### Numbered findings

#### F-1 — `app/admin/business-os-llm/__tests__/source.guard.test.ts:130-133` — the guard assertion reads raw source, so a commented-out guard passes it. **Priority: High. MUST FIX.**

```ts
it('the layout still owns the guard', () => {
  const layout = read('app/admin/layout.tsx');          // <- raw, not codeOf()
  expect(layout).toContain('await requireAdminPage()');
});
```

Every other assertion in this file goes through `codeOf()` — the file imports it at line 14 — precisely so prose about a rule is never mistaken for the rule. This one does not.

**Measured, not argued.** SA replaced `app/admin/layout.tsx:40` with

```ts
  // TEMPORARILY DISABLED FOR DEBUGGING: await requireAdminPage();
```

and ran both guard suites:

```
Test Suites: 2 passed, 2 total
Tests:       114 passed, 114 total
```

**All 22 `/admin` pages unguarded, and every gate green.** Deleting the line outright *is* caught (S2-T1 fails, confirmed separately) — so the hole is specifically the commented-out case, which is the realistic one, because commenting a guard out while debugging is how guards get disabled.

**Fix (one line):** `const layoutCode = codeOf(read('app/admin/layout.tsx'));` and assert on `layoutCode`. Better still, assert the shape rather than a substring: `expect(layoutCode).toMatch(/await\s+requireAdminPage\s*\(\s*\)/)`.

#### F-2 — `lib/admin/__tests__/admin-authz-surface.guard.test.ts:1568` — R6 is satisfied by the import statement. **Priority: High. Pre-existing — record as an open item, do not fix in this slice.**

R6 ("`app/admin/layout.tsx` without its server-side page guard") asserts only:

```ts
expect(scanned!.code).toContain('requireAdminPage');
```

`import { requireAdminPage } from '@/lib/admin/requireAdminPage'` satisfies that. SA **deleted** `await requireAdminPage();` entirely and R6 still passed — only slice 2's own S2-T1 caught it.

This is the `Admin authz surface guard`, a **required status check on `main`**. It has never been able to detect removal of the only guard over the `/admin` page tree, and F-1 shows the compensating control can be satisfied by a comment. The fix there is also one line — `expect(scanned!.code).toMatch(/await\s+requireAdminPage\s*\(/)` — but it belongs to the admin-authz workstream, not to this feature's diff. **F-1 must land in this slice because it is the only thing standing in the meantime.**

#### F-3 — `app/admin/business-os-llm/copy.ts:32-34` and `:37-39` — the banner tells an operator switching **chat** off to draw the exact false conclusion this feature exists to prevent. **Priority: High. MUST FIX.**

`FAIL_OPEN_ACTION`: *"Confirm at the ledger, not at this switch: **no new calls for the area is the only evidence**."*
`FAIL_OPEN_INLINE`: *"… Confirm at the ledger."*

For chat that is false. `AIDataLayerService` writes **no** `token_usage` row, so an empty `business-os-chat` is vacuously empty and proves nothing. The route says so itself (`ledgerCheckCopy.ts:61-63`), and the runbook flags it with a ⚠️ in §5 — the very section `FAIL_OPEN_ACTION` points at.

Judged as an operator at 2am: they read the banner *before* the cards (correctly placed, `page.tsx:107-109`), switch chat off, query the ledger, see nothing, and walk away believing a switch they have no evidence for. The correction exists only inside the chat card's ledger panel, one expand away. **The single most important piece of copy in this feature is the one place the chat exception is missing.**

**Fix, without hardcoding an area (FR-6 holds):** scope the claim instead of enumerating areas — e.g. *"Confirm at the ledger, where it can see the area: no new calls is the only evidence there is. Each card's ledger check says whether the ledger can answer for that area."* The per-area truth keeps coming from the route, the sentence stays generic, and `LedgerCheckPanel` still needs no knowledge of which areas the ledger sees.

#### F-4 — `lib/business-os/llm/__tests__/adminSettingsView.wireTypes.test.ts:5-11` — the doc block names a mechanism that does not exist in this repo. **Priority: Medium. MUST FIX (comment only).**

The header states: *"It is a COMPILE-TIME assertion: `ts-jest` type-checks this file, so if the server's `AreaView` stops satisfying the client's, the suite fails to build."*

**That is false.** `jest.config.js:50-61` hands ts-jest an inline `tsconfig` object, and ts-jest 29.4.5 emits no diagnostics under it. SA put `const probe: number = 'definitely not a number';` in a fresh test file under the same config: **1 suite passed, 1 test passed.** Reverting the DEF-6 widening (`at: string | null` back to `at: string` in `adminSettingsView.ts:71`) also leaves the wireTypes suite **green, 2/2**.

**The pin is nonetheless real — it is just a different gate.** `typecheck:bos-llm` includes this file as `core` (confirmed with `--list`), and with the same mutation it fails loudly:

```
lib/business-os/llm/__tests__/adminSettingsView.wireTypes.test.ts(35,52): error TS2344:
  Type '{ kind: "not_recorded"; at: string | null; }' is not assignable to '{ kind: "not_recorded"; at: string; }'
```

So the duplicated client types **are** protected, by a required check. Fix the comment to name `typecheck:bos-llm` and drop the ts-jest claim — otherwise the next reader believes `npm test` covers it and it does not. This matters beyond this file: **no test in this repo can rely on type errors failing jest**, which is worth a line in the QA report.

#### F-5 — `app/admin/business-os-llm/components/AreaCard.tsx:45-49` and `:151-156` — an undeclared deviation of the same shape as D-3. **Priority: Medium.**

The requirement's expanded-card table (§ *What the Screen Shows*) lists **"Area settings"** — area-level `enabled` / `provider` / `model` / `temperature`, each with its provenance badge and lock state — as the **first** section of the expanded card. It is not rendered. `areaModelSummary()` puts a derived one-line model summary on the *collapsed* card instead, and the expanded card goes straight to Calls.

The justification is identical to the declared D-3 (the payload has no area-level field, and synthesising one client-side would be the FR-6 hardcoding) and **SA accepts it on those grounds**. But it is a second deviation from the requirement's own layout table and was not declared, so it is invisible to the TL and to slice 3's scoping. Declare it beside D-3 with the same disposition (payload field in slice 3, or an explicit withdrawal).

#### F-6 — `app/admin/business-os-llm/__tests__/ledgerPanel.render.test.tsx:148` and `:68-80` — "no green in any branch" is only asserted for three of the five branches. **Priority: Medium.**

Line 148 asserts `screen.getByTestId('ledger-cannot-check').className` does not match `/red/` — but that node's className is `space-y-1`; the styling lives on its children. The genuinely strong assertion (`:77`, `container.innerHTML` against `text-(green|emerald)-`) runs only over the three `LEDGER_READINGS_WITH_COUNTS` branches.

**Measured:** SA coloured the RC-D heading (`LedgerCheckPanel.tsx:180`) `text-green-400`. **9 tests passed.** Priority 4 of this review asked whether any branch can degrade into a green class; today nothing stops the `cannot_check` or `no_change` branches doing so. Fix: apply the `:77` `innerHTML` assertion to the whole panel in every branch, and drop the weak `className` check.

#### F-7 — `AreaCard.tsx:126` — the comment claims more than the code does. **Priority: Low.**

*"FR-17: beside the switch state, on every area, always."* The inline notice renders inside `expanded &&` (`:123`), so on the default collapsed view it is beside nothing. The requirement is still met in substance — the undismissible banner sits above the cards (`page.tsx:107-109`, deliberately) — but the word "always" is wrong. Separately, FR-17 asks the sentence beside the switch to point at runbook §5; only the banner's `FAIL_OPEN_ACTION` does. Add the pointer to `FAIL_OPEN_INLINE`. **Slice 3 must place it adjacent to the real control and in the FR-15 confirmation, where "beside every switch" becomes literal.**

#### F-8 — `copy.ts:26-30` (`FAIL_OPEN_BODY`) — compresses the runbook §5 table in the alarming direction. **Priority: Low.**

Runbook §5 distinguishes two cases: an instance that has read the settings before keeps serving **last-good**, so a switched-off area **stays off**; only an instance that has *never* read them falls back to defaults-on. `FAIL_OPEN_BODY` reads as though any read failure re-enables.

**SA's ruling on the copy overall: accurate, actionable, and it does not overclaim about the fleet.** Every claim is about the *mechanism* ("is not a guarantee", "One that cannot read them…"), never about the present state, so the case where the fleet is entirely fine is not maligned. The bias toward caution is the right bias for a 2am banner. Two words would make it exactly true: *"One that cannot read them **on startup** falls back…"*.

#### F-9 — `LedgerCheckPanel.tsx:151` — `Check again` stays enabled on a branch where the answer is provably monotonic. **Priority: Low.**

The button is disabled only for `loading` and `no_change`. On `too_long_ago` — the branch **every area takes today** — the answer can only ever get more refused with time, so the control is futile and invites pressing. D-1's `reason` code makes this a one-line branch. Either disable it for that reason, or say why it is still offered.

#### F-10 — `lib/business-os/llm/adminSettingsView.ts:166-170` — the DEF-6 comment asserts a schema fact the repo cannot establish. **Priority: Low.**

*"the column is nullable in the database and a row really can arrive without one"*. Nothing in the repository supports that: `SystemSettingsConfig.updated_at` is typed `string` (`lib/repositories/types.ts:397`), `system_settings_config` has **no `CREATE TABLE` migration in this repo** (it was created in the Supabase dashboard), and all eight seeded rows carry a timestamp.

**On the question asked:** DEF-6 **is** genuinely fixed at the boundary — `at: string | null` on all three attributed states, and `formatInstant` returning `null` rather than the epoch — and the mutation confirms it bites (4 failures, below). And **`(time not recorded)` is not reachable from a legitimate row today**, which is the correct answer: the sub-state is defensive, it is pinned by a test, and SA wants it kept. But reword the comment to what is actually known — *"the repository type is hand-written, not generated from the schema, so the renderer does not rely on it"* — so the next reader does not inherit an unverified claim about production.

#### F-11 — doc accuracy. **Priority: Low.**

- The slice-2 Change History row says "six components" and "Eleven files created under `app/admin/business-os-llm/`": there are **7** components and **15** files (10 source + 5 test). "Eleven" is right for source files only.
- "21 pages" / "twenty-one" is now 22: `app/admin/layout.tsx:9` and `:11`, `lib/admin/requireAdminPage.ts:36`, `admin-authz-surface.guard.test.ts:41` and `:311`. Cheap to fix while the files are open; no equality cap depends on the number (checked — the guard has no page-count assertion).

---

### Mutation testing — SA's own runs

All applied, measured and reverted by SA. The five the Dev reports do bite; two more do not.

| # | Mutation | Expected | SA measured |
|---|---|---|---|
| M1 | `app/admin/layout.tsx:40` **deleted** | S2-T1 fails | ✅ 1 failed / 113 passed — only slice 2's test; **R6 passed** (→ F-2) |
| M1c | `app/admin/layout.tsx:40` **commented out** | S2-T1 fails | ❌ **114/114 passed** (→ **F-1**) |
| M2 | `format.ts:17` returns a 1970 string for `null` | S2-T7c fails | ✅ 4 failed / 5 passed, all four named DEF-6 |
| M3 | `onDismiss?: () => void` added to `FailOpenNotice` Props | S2-T8 fails | ✅ 1 failed — "no dismiss affordance at all" |
| M4 | `if (area === 'chat')` branch added to `LedgerCheckPanel.run` | S2-T10 fails | ✅ 2 failed, incl. "holds no knowledge of WHICH areas" |
| M5 | model-id literal added to `copy.ts` | literal rule fails | ✅ 1 failed — "writes no model id" on `copy.ts` |
| M6 | `import type … from '@/lib/business-os/llm/adminSettingsView'` in `types.ts` | FR-6 rule fails | ✅ 1 failed — "imports no server module" on `types.ts` |
| M7 | `at: string \| null` back to `at: string` in `adminSettingsView.ts:71` | wireTypes fails to build | ❌ jest **2/2 passed**; `typecheck:bos-llm` **FAILED, 1 new TS2344** (→ F-4) |
| M8 | RC-D heading coloured `text-green-400` | a "no green" test fails | ❌ **9/9 passed** (→ F-6) |

---

### Rulings on the Dev's four items

**D-1 — the `reason` codes on the two 400s. ✅ Approved.** Additive, machine-readable, and it removes the failure mode DEF-5 already caused once. Both codes are emitted **after** the chat short-circuit and **before** any repository read, so the classification cannot cost a cross-tenant scan. `CANNOT_CHECK_HEADINGS` (`LedgerCheckPanel.tsx:54-57`) is keyed on the code and falls back to a neutral heading for an unknown one, so a third code added in slice 3 degrades to "This check does not apply here" rather than to an error — correct. The route's own `error` sentence is still what the operator reads (`:184`), so the limit is stated once, at the place that enforces it. This is the right shape: a code for the machine, a sentence for the human, neither doing the other's job.

**D-2 — a local `Chip` instead of `components/ui/badge.tsx`. ✅ Approved. All three claims independently verified.** `badge.tsx`'s `outline` variant is `border-[var(--v2-border)] … text-[var(--v2-text-secondary)]`; those tokens are declared in **`app/v2/globals-v2.css` only**; `app/layout.tsx:3` imports `./globals.css` and nothing in the `/admin` tree loads the v2 sheet — so under this layout the variant is a transparent chip with no border colour and secondary text that resolves to nothing. And `cn()` (`lib/utils.ts:1-3`) is `classes.filter(Boolean).join(' ')` — **not** `tailwind-merge` — so a `className` override ships both classes and stylesheet order decides. A 45-line local component with six named tones, matching the palette the other 21 admin pages already use, is proportionate and is **not** a new pattern. Two notes, neither blocking: the real defect is that `cn()` is named after a function that merges (its own repo-wide chore); and if a third admin screen needs a chip, promote this one rather than writing a third.

**D-3 — the requirement's *"What 'off' means here"* section not rendered. ✅ Approved as deferred, with F-5 attached.** The reasoning is exactly right and is the FR-6 argument, not an excuse: the owner-facing consequence of switching an area off is a **per-area fact**, so a client-side table of it would be precisely the hardcoding FR-6 forbids, and it would drift the moment a call moves between areas. **SA's direction for slice 3: add it to the payload, do not link a doc.** A doc link is a second source of truth for the same fact and it will rot silently, which is the failure this whole layer exists to avoid; and the consequence text belongs beside the switch at the moment of the FR-15 confirmation, not behind a click. If slice 3 cannot carry it, withdraw the row from the requirement explicitly rather than leaving it unrendered. **F-5 is the same call about the "Area settings" row — declare both, dispose of both together.**

**D-6 — `codeOf` and `LITERAL_RULES` extracted to `tests/helpers/`. ✅ Approved, as suggested.** Verified the extraction is behaviour-preserving: all five rules keep `String.raw`, each keeps its `mustMatch` sample, `FEATURE_ROOTS` is byte-identical to the string it replaced, and the *assertions about* the rules correctly stayed in slice 1's route test rather than moving into the helper — a helper that asserts its own correctness is a helper nobody checks. Third caller was the right trigger; two would have been premature.

---

### Standards, scope and the rest

| Check | Verdict |
|---|---|
| `console.*` in any touched file | **Zero.** The only two matches under the screen are a test name and a doc sentence. `AdminSidebar.tsx`, `ledger/route.ts`, `adminSettingsView.ts` and both helpers are all 0. `app/admin/system-config/page.tsx` and its 20 `console.*` calls stay **out of the diff** — D-U1 is the right call, and `nav.test.ts:40-43` pins it so a one-line cross-link cannot smuggle a 2,000-line conversion in later. |
| Pino where server-side | `ledger/route.ts` logs through the child logger with `correlationId` and `userId`, `{ err }` on the error path, never the email. The client files log nothing at all, which is correct for a browser bundle. |
| Repository pattern | Untouched. No Supabase call anywhere in the diff; `tokenUsageRepository`, `systemConfigRepository` and `adminUserRepository` are the only data paths and none changed shape. |
| Zod | `ledger/route.ts:94-100` unchanged and still validates before anything; `area` is a closed enum and `feature` is derived, never accepted. The new `reason` is response-side only. |
| The literal gate's four false-positive shapes | The screen contains **no** model-id type union, **no** `z.enum` of model ids, **no** `switch` on a model and **no** price-index key — it contains no model name at all. `--list` is unchanged: no exemption, no new inclusion, no baseline regenerated. `source.guard.test.ts` applies all five rules to every screen file, walked rather than listed, so a component added tomorrow is covered before anyone remembers. **No gate rule change was needed and none was made.** Correct. |
| Nothing writable | Confirmed at source: no `<form>`, no `onSubmit`, no `onChange`, no non-GET `fetch`. The two controls are a disabled `readOnly` checkbox (a lock has to look like a lock — right call) and refresh buttons. `READ_ONLY_NOTE` names the command instead of offering a dead control, which is the honest thing. |
| Nothing pre-empting slice 3 | Confirmed. No confirmation step, no audit write, no notification, no foreign-key fallback — and `LastChangedLine`'s `not_recorded` copy is deliberately worded to stay true once slice 3's unattributed-save lands (`:17-22`), which is the rare case of a comment doing real work. |
| `updated_by` / actor | Read-only use only. `buildAdminEmailById` fails **soft** with a warn and renders ids raw rather than failing the page — right trade, and the raw id is labelled, never "unknown". |

**On `npm run lint`: yes, this needs its own fix, and it is not slice 2's.** `"lint": "next lint"`, and the repo's only ESLint config is the flat `eslint.config.mjs`, which `next lint` on Next 14 does not read — hence the interactive setup prompt. So the repo has **no working full-lint entry point**: `lint:hooks` works but loads a different, hooks-only config, and no workflow runs anything broader. This is the second time a broken lint entry point has hidden findings here (PR #76 surfaced two crash bugs once the config was fixed). Recommend a one-line chore in a separate PR before more UI lands: `"lint": "eslint . --max-warnings 0"`. The Dev was right to use `npx eslint <paths>` and right to flag it rather than paper over it.

---

### Optimisation suggestions (never blocking)

- `LedgerCheckPanel.tsx:121` — `CANNOT_CHECK_HEADINGS[body?.reason]` indexes a `Record<string, string>` with a possibly-`undefined` value off an untyped `body`. It works, and the `??` saves it, but narrowing `reason` through a small type guard would make the fallback visible as intentional rather than incidental.
- `page.tsx:88` — `read at {formatInstant(...)}` renders a bare label if `formatInstant` ever returns `null`. `generatedAt` is always set, so this is theoretical; guarding it costs nothing.
- Collapsing and re-expanding a card unmounts and refetches the ledger panel. Cheap today (the `too_long_ago` branch is refused before any DB read), and it becomes a real read once rows are fresh. Worth remembering in slice 3, not worth changing now.
- `areaModelSummary()` returning `varies by call (n)` is a good collapsed-card summary. If F-5 puts a real area-level field in the payload, prefer the field and keep the derived summary only for the "no area value set" case.

### Code Approved for QA: **No** — approved on condition

Fix **F-1** (one line, the guard assertion), **F-3** (one clause in `FAIL_OPEN_ACTION` and `FAIL_OPEN_INLINE`) and **F-4**'s comment; declare **F-5** as a deviation. Then re-run the five screen suites and `typecheck:bos-llm`. **F-6 and F-2 should land too** — F-6 here, F-2 as an item on the admin-authz workstream — but neither changes shipping code, so QA may start once F-1, F-3, F-4 and F-5 are in. F-7 to F-11 are comment and doc accuracy: fix them while the files are open, and do not re-open the cycle for them.

**Escalation to TL — two items the user must decide:**

1. **F-2 is a hole in a required status check.** The `Admin authz surface guard` cannot detect removal of the only guard over 22 admin pages. It is pre-existing and one line to fix, but it changes the *gate*, so the user decides whether it goes in this slice or opens the parked admin-authz work.
2. **No test in this repo fails on a type error** (F-4). ts-jest is effectively transpile-only here. Any test whose stated mechanism is "it fails to compile" is inert unless the file also sits inside `typecheck:bos-llm`'s scope. That is a repo-wide test-strategy fact and belongs in the test-tiering workplan, not in this feature.

---

## SA Re-check — Slice 2

**Reviewed by SA — 2026-09-24** (delta only, against the review and QA report above)
**Status:** 🔄 **Fix Required — one clause and one doc claim.** Everything else is approved and needs no further SA pass. F-1's re-fix, F-3's re-fix, F-4, F-5, F-6 and F-7…F-11 are all properly closed; the branch table and the onboarding card are both right. But the fix for QA's S2-3 introduced a **new** unsupported instruction in the same sentence it was repairing, and the workplan claims to have closed an item in another workstream that it has not closed.

**Gates re-run by SA, not taken from the summary:**

| Gate | SA's measurement |
|---|---|
| `npm run typecheck:bos-llm` | `231 files in scope, 28 errors, 0 new (87.9s)` — passed |
| `npm run check:bos-llm-literals` | `43 files in scope, 2 exempt, 0 violations (18.7s)` — passed |
| `npm run lint:hooks` | clean, exit 0 |
| `npx eslint` on the screen + `app/admin/layout.tsx` + `lib/admin/requireAdminPage.ts` + `tests/helpers` | **0 problems, exit 0** — S2-6 is genuinely fixed |
| `npm run build` | exit 0 |
| jest, the screen's five suites | **5 suites / 92 tests** |
| jest, all touched paths **+ `lib/admin`** | **28 suites / 636 tests**, all green (a superset of the Dev's 26/621 — the required authz-guard suite is included in both) |

---

### 1. The first-statement property — what it really tests, and what still satisfies it

**It is a genuine improvement and it is honestly built.** `firstStatementOfAdminLayout` strips comments, locates the signature, terminates the statement at `;` **or `{`** — so `try {` *is* the first statement and fails — and returns `null` on an unrecognisable signature so the assertion cannot pass vacuously. Crucially it is **proved against five synthetic layouts that must be rejected**, which is the part most source-scanning tests skip. I confirmed the clean file passes and that the five rejections are asserted. QA's two mutations are closed.

**But the property is still satisfiable by a layout that does not guard.** Three probes, each applied to the real `app/admin/layout.tsx` and run against both `source.guard.test.ts` and the required `admin-authz-surface.guard.test.ts`:

| Probe | First statement of the body | Result |
|---|---|---|
| `process.env.ADMIN_STRICT && (await requireAdminPage());` | contains the call → matches `GUARD_CALL` | **122/122 passed.** `/admin` is open in any environment where that variable is unset |
| `process.env.NODE_ENV === 'production' ? await requireAdminPage() : undefined;` | ditto | **122/122 passed** |
| import replaced by `const requireAdminPage = async () => undefined;` | `await requireAdminPage()` is first, and is a no-op | **122/122 passed** |

The first two are not exotic: QA's own early-return mutation was `if (process.env.NODE_ENV === 'development') return …`. The **same intent**, expressed as a short-circuit instead of an early return, now passes. The third is contrived, but it shows the assertion pins the call's *shape*, not its *identity* — nothing checks the import resolves to `@/lib/admin/requireAdminPage`.

**The observation that matters more than any of the three:** this is the third iteration of a regex chasing source shapes. Each round closes the shapes someone thought of. The property that actually matters is behavioural — *a non-admin render of `AdminLayout` does not return children* — and it is one test: mock `getUser`/`AdminAccessService` to a non-admin, render the layout, assert it throws `NEXT_REDIRECT`. That single test is immune to all five known mutations **and** to all three of mine, because it exercises the guard instead of reading it.

**Not a blocker, and I am not asking for it in this diff.** Nothing leaks today by any of these paths — the page is `'use client'` with no server props and both `GET`s are `requireAdmin`-first, which QA proved on a real `next start` server. The source assertion should stay as a cheap tripwire. But the workplan must stop describing the property as closed, and the behavioural test belongs on the admin-authz workstream beside F-2. **Recorded, with the three probes named so the next person does not have to rediscover them.**

#### R-1 — the OI-20 closure claim is wrong and must be corrected. **Priority: High (doc). MUST FIX.**

§5.3c's S2-1 row and the Change History both say this fix closes **"DEF-S2-2 / OI-20's 'present, not first'"**. DEF-S2-2, yes. **OI-20, no.** Read at source (`docs/workplans/admin-authz-unification.md:1506`, `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md:190`), OI-20 is:

> **Guard precedence gap (D-5 + D-Q2), applying to all 38 gated handlers.** R1 proves `requireAdmin(` is **present** in a handler body — not that it runs **first** … **closing this needs the oracle's instrumentation extended to cover the body parse** — `mockTablesTouched` records DB/RPC/auth-API calls, not `request.json()`.

So OI-20 is about **API route handlers** and it carries QA's explicit refinement that closing it requires instrumenting the oracle for the body parse. Slice 2 asserts precedence in **one file** (`app/admin/layout.tsx`), for a **different** guard (`requireAdminPage`, not `requireAdmin`), from a **feature** test suite that no workflow runs as a required check, and touches neither the 65 gated handlers nor the oracle. The workplan's own earlier wording at `:2037` was precise — *"OI-20's 'present, not first' **landing in the one file where `requireAdminPage` actually lives**"* — and that is the true claim. The Change History compressed it into closure.

This matters because OI-20 carries an SA condition that it is **the first thing built when the parked admin-authz slices resume**. A workplan row saying it is closed is how that condition gets quietly discharged without the work happening. **Correct both places to "closes the page-layout half of the precedence gap; OI-20 itself (route handlers + oracle instrumentation) is untouched and remains open."**

---

### 2. The copy, judged again — and my earlier judgement was wrong in a way worth naming

QA was right and I was not. I read the banner's *claims* for truth and found them individually accurate; I did not check whether the **action it prescribed could be carried out on the day the page ships**. It could not: the banner said "confirm at the ledger" while all eight panels said "Too long ago to check". That is a different and better test than the one I applied, and I am adopting it here.

**Applying it to the new text:**

**True on day one? Yes.** *"Expect to be turned away often — the check on each card only covers a change made in the last 24 hours, and it cannot see every area."* That is now a **prediction of what the operator will actually see**, so a refusal reads as the expected answer rather than a dead end. `FAIL_OPEN_BODY`'s new parenthetical is also exactly right and closes F-8 without softening the warning. The headline is unchanged and still carries the whole warning alone.

**Does naming the fallback rescue it? Half — and the half that is wrong is a repeat of the defect being fixed.**

#### R-2 — `app/admin/business-os-llm/copy.ts:69-75` (`FAIL_OPEN_ACTION`) — *"the LLM Usage tab on /test-business-os, which shows the calls per area for **any period**"* is false. **Priority: High. MUST FIX.**

Measured at source (`lib/business-os/usage/llmUsageVerification.ts:61`, `:89-102`):

- **`MAX_WINDOW_MS: 7 * 24 * 60 * 60 * 1000`** — and it is **refused, not clamped**: *"Start time is more than 7 days ago; the maximum window is 7 days"*. "Any period" is wrong by construction.
- **`accountId` is required** — a non-platform account UUID. The report is **per business**, so it does not show "the calls per area" for the fleet without first picking one business — while the switch the operator just flipped is fleet-wide.

The runbook, which this sentence is summarising, is careful where the copy is not: it says the tab *"renders these per area and per call"* (§5:191) and *"per area and per business"* (:13). It never says any period. **The copy over-generalised past its own source, in the fallback an operator reaches for precisely when the 24-hour check has turned them away.** For a change 1–7 days old the tab does help; beyond 7 days it refuses too — and the sentence promised it would not.

That is the same defect class as S2-3, reintroduced by the fix for S2-3. It is one clause. The unbounded path is the **SQL in runbook §5**, which an operator can widen by editing the interval; the tab is the convenient path within 7 days, per business. Say that.

**Has it become too long to be read?** `FAIL_OPEN_HEADLINE` 8 words + `FAIL_OPEN_BODY` 85 + `FAIL_OPEN_ACTION` 85 = **178 words** in the banner, `FAIL_OPEN_INLINE` 65. That is at the edge, and I own part of it — F-8's parenthetical lengthened the one block whose job is to be skimmable. **My judgement: do not cut words, change the order.** `FailOpenNotice.tsx:55-57` renders headline → body → action, so the two sentences an operator must read (*"not a guarantee"* and *"expect to be turned away often; here is what to use instead"*) are separated by 85 words of mechanism. Headline → **action** → body-as-the-quiet-why costs nothing and puts the instruction where a skimmer lands. **Low, presentational, and I am explicitly not re-opening a cycle for it** — take it with R-2 if the file is open anyway.

---

### 3. Rulings on the three items put to SA

**The onboarding card renders no fail-open notice — ✅ right call, and for the right reason.** *"Switching an area off is not a guarantee"* one line above *"This area can never be switched off"* is a contradiction, and it was the most prominent text on the one card where the warning cannot apply. `AreaCard.tsx:146-153` now branches on `area.switchable`, and `LOCK_AREA_FAIL_OPEN` says what **is** true there: a cold-start read failure still puts that area's calls back on their code-default provider and model. Two things make removing the inline notice safe rather than a gap: the **banner is above every card and is never collapsed**, so the fleet-wide warning is still on screen for onboarding; and the replacement text is not reassurance — it re-states the same 60-second propagation and silent-fallback hazard about the field that area *can* change. Correct, and better than the notice it replaced. (Minor, no action: *"the only lever there is"* is loose — temperature is settable too unless locked — but the model is the cost lever and that is the point being made.)

**The exhaustive `Record<LedgerReadingKind, Branch>` with two pins — ✅ approved, and I verified both pins independently.** Adding a sixth kind (`sixth_kind`) to the union **and** to `LEDGER_READING_TEXT`:

- runtime pin: `● S2-T9 › covers every reading kind that exists, however a new one is added` — **1 failed / 19 passed**
- compile pin: `typecheck:bos-llm` → **29 errors, 1 new, FAILED** with `ledgerPanel.render.test.tsx(110,9): error TS2741: Property 'sixth_kind' is missing in type … but required in type 'Record<LedgerReadingKind, Branch>'`

Two genuinely independent mechanisms, and the second exists **because** of F-4 — the test's own comment says so. That is the right response to "no test in this repo fails on a type error": do not rely on the type system alone, and do not throw it away either. Nine branches now drive the strong `innerHTML` no-green / no-tick assertion (F-6 closed, including both `cannot_check` sub-states and the unknown-code fallback), and `isKnownReason` replaces the untyped index I raised as an optimisation. Better than I asked for.

**§5.3c's P6/P7 — ⚠️ recording is NOT enough for one of the two properties, but the fix does not belong in this diff.**

First, QA falsified a premise of mine and the record should say so plainly: my priority-1 table justified escape E2 with *"the caller already passed the guard on entry to the subtree."* **False** — a crafted `Next-Router-State-Tree` only has to *claim* it did. My **conclusion** survives, but on the other reason I gave in the same table (`'use client'`, no server props, zero settings in the payload), not on the premise I leaned on.

Of the two properties that make P6/P7 harmless:

- *"every admin API is `requireAdmin`-gated"* — **recording is enough.** It is already the subject of R1 and the required guard, with a published census; it cannot rot silently.
- *"all 22 admin pages are `'use client'` with no server props"* — **recording is not enough.** It is (a) load-bearing for an *unauthenticated, already-demonstrated* request, (b) the kind of property that breaks **silently** — the next admin page written as a Server Component that fetches data would serve its payload to that request with no test failing and no reviewer prompted — and (c) **nearly free to assert**: the guard's scanner already computes `isClient` per file (`admin-authz-surface.guard.test.ts:1567` uses `expect(scanned!.isClient).toBe(false)` on the layout), so the rule is "for every `app/admin/**/page.tsx`, `isClient === true`" over data the scanner already has.

**Ruling:** it must be escalated as a **named, tracked item with a working exploit and a costed one-line fix** — not a footnote in a feature workplan, which is where the parked workstream will never look. It goes to the admin-authz workstream with F-2 and S2-10, and it should be logged in `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` § *Known gaps in the guard itself* alongside OI-20, because that is the file a future admin-page author reads. Slice 2's own page satisfies the property, so this does not block it.

---

### Code Approved for QA / for the user's eye: **after R-1 and R-2 — both one edit each**

- **R-2** — one clause in `FAIL_OPEN_ACTION`. Describe the tab as it is (admin-only, per business, up to 7 days) and name the runbook §5 SQL as the path with no period limit.
- **R-1** — correct the OI-20 claim in §5.3c's S2-1 row and in the Change History to the page-layout half only.

Neither needs another SA pass: re-run the screen's five suites and `check:bos-llm-literals` and the page is ready for the user. **No code change is required** — R-2 is a string, R-1 is documentation.

**Carried to the admin-authz workstream, not this diff:** F-2 (R6 satisfied by the import), S2-10 / P6-P7 (the `'use client'` assertion, per the ruling above), OI-20 proper (route-handler precedence + oracle instrumentation), and the recommendation to replace the source-shape regex with one behavioural render test of `AdminLayout` — which would retire my three probes and the five synthetic layouts in a single assertion.

**Not blocking, take them or leave them:** the banner's headline → action → body ordering, and `'the only lever there is'` on the onboarding card.

---

## 14. QA Testing Report

## QA Test Report — Slice 1

**QA — 2026-09-22**
**Test mode:** full
**Strategy used:** B (integration/unit under Jest, real guardrails with the repository and pricing boundaries mocked) + C (four throwaway probe suites written for this review and deleted afterwards) + mutation testing of the shipped code and of the two CI gates. Not E: every gate could be run, so nothing rests on log reading.
**Focus:** api · schema · security · the two CI gates
**Skipped:** e2e (Playwright is not installed — CLAUDE.md § Testing; slice 1 ships no UI anyway). `npm run lint` / `lint:hooks` not run — §5.3 scopes them to slice 2.
**Input source:** the QA brief (prompt), read against §4.3's S1-T1 … S1-T16, the requirement's ACs and the two SA reviews.
**Scope tested:** the uncommitted slice 1 tree in `neuronforge-llm-admin-ui`, branch `feature/business-os-llm-admin-ui`, off `origin/main` `d9c60ab4`, **HEAD unchanged, nothing committed**. Two routes, four new `lib/business-os/llm/` modules, four modified files, nine test files.

---

### 14.1 Gates — run verbatim by QA, not taken from §4.4

| Gate | QA's measurement | Matches §4.4 / SA |
|---|---|---|
| `npm run typecheck:bos-llm` | `177 files in scope, 31 errors, 0 new (103.8s)` — **passed**, exit 0 | ✅ |
| `npm run check:bos-llm-literals` | `43 files in scope, 2 exempt, 0 violations (18.1s)` — **passed**, exit 0 | ✅ |
| `check:bos-llm-literals -- --list` | `included app/api/admin/business-os/llm-settings/route.ts` · `exempt lib/business-os/llm/modelSettingsPolicy.ts` · `exempt scripts/bos-llm-settings.ts` · **43 in scope, 2 exempt, 1 included by name**. The **ledger** route appears as `checked` — it is in scope by the direct-import rule, so only the main route needed naming in. Exemption set byte-identical; `git status` on `scripts/typecheck-bos-llm.baseline.json` clean | ✅ |
| `npm run build` | `✓ Compiled successfully`, exit 0 | ✅ |
| jest `lib/business-os/llm lib/ai lib/repositories app/api/admin/business-os scripts` | **895 of 896 tests, 53 of 54 suites**, 78.6 s. Re-run at the end of the session after every probe was deleted: **identical** | ✅ |

**The one red suite is pre-existing — independently confirmed, not taken on trust.** `git stash push -u` of the **entire** working tree (10 modified + 11 untracked paths), then `npx jest lib/business-os/llm/__tests__/callParams.boundary.step3.test.ts` at a clean `d9c60ab4`: **1 failed, 19 passed**, the diff being exactly `- "Today is 2026-09-21." / + "Today is 2026-09-22."`. `git stash pop` restored all 21 paths. Not this slice's.

**Will it spread as dates move? No — but it will not heal either, and that is the problem.** The date is injected at `lib/business-os/bizql/planner/Planner.ts:420` into the **user** message (deliberately, so `plannerVersion()`'s system-prompt hash does not invalidate the plan cache nightly), and `callParams.boundary.step3.test.ts.snap` is the only snapshot in the repo that stores a raw user message containing it — grepping `Today is` across the snapshot folder returns exactly one hit, at `:44`. The other snapshotted call params hash their system prompts (`sha256:…`), so they are date-proof. The blast radius therefore stays at one test unless another date-bearing call site is snapshotted the same way. But the value comes from `timeZone: request.timezone ?? 'UTC'`, i.e. it is deterministic per **UTC day**: the suite went red at 2026-09-22T00:00Z and is red every day from now on, and `jest -u` buys exactly one more day. The cost is not the one test — it is that the selection Dev, SA and QA all run **can never be green**, which is precisely how a suite stops being read. Escalated as **DEF-7**, for the TL, outside this feature.

---

### 14.2 The picker-vs-validator equivalence — attacked end-to-end

SA warned the shipped equivalence assertion in `modelOptions.test.ts` is near-tautological (production and test both call `checkModelForCall`) and that eight absolute sibling assertions carry the weight. QA therefore did **not** re-assert against `checkModelForCall`. A throwaway probe compared, for **all eight areas × every call × twelve hostile `ai_model_pricing` shapes**, whether the option is **offered** against whether a real `validateAreaRow(area, { calls: { <call>: { provider, model } } })` **accepts it** — the actual save path, guardrails real, only `listPricedModels` / `getPricing` / `getImageGenerationConfig` stubbed. Both directions: candidate → offered ≡ accepted, and **offered → must survive a save**.

| # | Probe (real `ai_model_pricing` shapes) | Offered? | A save accepts? | Verdict |
|---|---|---|---|---|
| P-1 | `' gpt-4o '` — whitespace-padded `model_name` | no | no (`model_not_trimmed`) | ✅ agree |
| P-2 | `'gpt-zero-out'` — `input > 0`, `output = 0` (zero price on one side only) | no | no (`zero_price`) | ✅ agree |
| P-3 | `'gpt-zero-in'` — `input = 0`, `output > 0` | no | no (`zero_price`) | ✅ agree |
| P-4 | `'gpt-image-1'` / `'dall-e-3'` on a **token** call | no | no (`image_model_on_token_call`) | ✅ agree |
| P-5 | a token model (`gpt-4o`) on the **image** call | no | no (`image_price_missing`) | ✅ agree |
| P-6 | `'dall-e-3'` priced for **one** configured size at all three qualities, the rest unpriced | no | no (`image_price_missing`) | ✅ agree |
| P-7 | the same model priced for **every** size × `low/medium/high` | yes | yes | ✅ agree |
| P-8 | `'anthropic' / 'claude-sonnet-4-6'` — provider outside the **call's own** `allowedProviders` | no | no (`provider_not_allowed`) | ✅ agree |
| P-9 | a `model_name` of `MAX_MODEL_NAME_LENGTH + 1` characters | no | no (`model_too_long`) | ✅ agree |
| P-10 | an **empty** `model_name` | no | no (`model_empty`) | ✅ agree |
| P-11 | a row whose numeric price columns parse to `NaN` | no | no (`zero_price` — `NaN > 0` is false) | ✅ agree |
| P-12 | `'o3'` / `'o1-mini'` — reasoning models, per call (`chat/planner` has a locked temperature, `chat/analysis` sends a sampling penalty) | per call | per call, identically | ✅ agree — acceptability really is per **call**, not per area |
| P-13 | `null`, `123`, `{}`, `[]`, `true`, `'  '` as the model | no | no (`model_not_a_string` / `model_empty`) | ✅ agree |
| P-14 | **the unconditional code default with NOTHING priced at all** — the one deliberate asymmetry (D-4 unshifts it) | yes | **yes** | ✅ safe — `checkModel` has the same "equal to the code default" shortcut, so the offer binds |
| P-15 | direction B, all areas: every option actually in `byCall[call]` must survive a save | — | — | ✅ zero `OFFERED-BUT-REFUSED` |
| P-16 | `allowedProvidersByCall[call]` is reference-identical to `getBosLlmCallPolicy(area, call).allowedProviders`, all eight areas | — | — | ✅ RC-C holds; no second provider list anywhere in the payload |

**Result: no divergence found.** 20 probe assertions, all green. The three findings SA collapsed into one bug are genuinely fixed at the root, and the fix holds against the **save path**, not merely against the function the fix introduced.

**Two things the probes did NOT reach, both latent rather than live.** (a) *Provider/model decoherence.* The picker answers about a **pair**; the resolver resolves `provider` and `model` as **independent** fields with their own precedence, then re-couples them (`modelSettings.ts:645`, "provider and model must not decohere"). A slice 3 writer that persisted only `model` into the call entry while `provider` inherited from another level would be asking a question the picker never answered. Unreachable today — every call's `allowedProviders` is the same `OPENAI_ONLY` reference and every default provider is `openai`, so the pair is forced — and it becomes live the day one call legitimately allows a second provider. **Recorded for slice 3, not a slice 1 defect.** (b) *The pricing cache TTL.* Every probe stubbed `listPricedModels`; on a live instance the picker and the validator share one snapshot **within a request** (`listPricedModels` uses the same refresh rule as `getPricingInternal`), so a newly priced model can be hidden for up to an hour while a save would accept it. That is the documented advisory/free-text gap, not drift.

**Is SA's "near-tautological" judgement right? Half right, and QA measured which half — see DEF-3.**

- **The tautology is defused by the fixture, not by the assertion.** Mutation **M1** reverted `modelOptions.ts` to the exact pre-fix bug (pre-filter on the global `['openai']` list + ask `checkModelAcceptable`). The equivalence test **failed**, together with the absolute sibling "refuses a model whose SHAPE is wrong" and the image-config one: **3 red in `modelOptions.test.ts`, 10 red across it and the QA probe.** It fails only because the candidate fixture contains `' gpt-4o '` and an over-long id — shapes that discriminate the two functions. Strip those two rows and the assertion becomes a true tautology. So the eight siblings do carry the weight, as SA said, *and* the equivalence assertion is live **as currently seeded**.
- **But it is blind in one direction, and that is a real hole.** Mutation **M2** left the ask intact and changed only what is pushed (`candidate.model` → `candidate.model.trim().toLowerCase()`) — a picker offering a value it never asked the validator about. `modelOptions.test.ts` stayed **15/15 green**. QA's direction-B assertion caught it on the first run: `OFFERED-BUT-REFUSED chat/planner openai:"gpt-uniq-4o" [model:unpriced_model]`, on every area. **DEF-3.**

**Would the suite catch a real regression?** Yes for the regression class that actually happened (M1, and any wrong argument, pre-filter in front of the ask, or misuse of the verdict). No for a normalisation or injection applied **after** the ask. One additional assertion closes it.

---

### 14.3 The three-reading ledger panel

| Check | Evidence | Result |
|---|---|---|
| Window arithmetic — `after` starts at `since + BOS_LLM_SETTINGS_CACHE_MS` | measured on the repository call arguments: `afterStartOffsetFromSinceMs = 60000` exactly, from the imported constant, never a literal | ✅ |
| `before` is the **same length**, ending at the save | `afterLen === beforeLen` (3 540 001 ms each for a 1 h `since`); `before.end === since` exactly | ✅ |
| "calls **completed**" | `stopped_with_before` = *"No calls **completed** since the change, and this area was making calls before it."* | ✅ |
| `feature` derived server-side | `bosFeature('leads')` → `business-os-leads`; a `feature` in the query string is ignored (it is not in the Zod schema) | ✅ |
| A quiet area cannot read as proof | `briefing`, `after=0 before=0` → `no_traffic_either`, *"the ledger cannot tell you whether the switch is holding"* — first-class, same shape and weight as reading 2 | ✅ |
| `too_soon` (new, D-8) | `since` 30 s ago → 200, `kind: too_soon`, **`summarise` called 0 times**, `after: null`, `before: null`, `observationStartsAt` returned. Reads nothing — one fewer cross-tenant query | ✅ |
| Chat renders none of them | `area=chat` → `ledger_cannot_answer`, `after: null`, `before: null`, **repository never called**. Decided before the read, so the readings are never produced rather than hidden | ✅ |
| No path degrades into a green tick | all five reading strings scanned for `off / disabled / confirmed / verified / proof that / safe / all clear / success`: **zero hits**. The only corroborating reading still does not assert the area is off; the caveat **actively denies** it (*"nothing here can tell you an area is off"*) | ✅ |
| One shared caveat string | `LEDGER_CHECK_CAVEAT` imported by the route; `ledgerCheckCopy.ts` is deliberately **not** `server-only` so slice 2 can import the same string — asserted by S1-T12 | ✅ |
| `LEDGER_READINGS_WITH_COUNTS` complete for slice 2 | all five kinds driven out of the live route in one probe: `still_arriving` / `stopped_with_before` / `no_traffic_either` return `{count, latestAt}`; `ledger_cannot_answer` / `too_soon` return `after: null, before: null`. The constant partitions the union **exactly**, with no kind unaccounted for | ✅ |

Minor: the copy an operator reads understates the reach — **DEF-5** — and the ordering test for the chat short-circuit asserts nothing — **DEF-2**.

---

### 14.4 The `since` bound — boundary probe

Fifteen values through the live handler. `reads` is the number of cross-tenant repository calls issued.

| `since` | Status | Kind | Reads | Verdict |
|---|---|---|---|---|
| 24 h ago − 2 s of slack (just inside) | 200 | `no_traffic_either` | 2 | ✅ allowed |
| 24 h ago + 2 s (a hair over) | **400** | — | **0** | ✅ refused **before** the windows are computed, message names the 24 hours |
| absent | 400 | — | 0 | ✅ |
| empty string | 400 | — | 0 | ✅ |
| `yesterday` (malformed) | 400 | — | 0 | ✅ |
| `-1` (negative) | 400 | — | 0 | ✅ |
| `0` (epoch as a number) | 400 | — | 0 | ✅ |
| `2026-09-22T10:00:00` (no timezone designator) | 400 | — | 0 | ✅ — slice 2 must send a designator |
| `2026-09-22` (date only) | 400 | — | 0 | ✅ |
| `+275760-09-13T00:00:00.000Z` (max `Date`) | 400 | — | 0 | ✅ |
| **`2099-01-01T00:00:00.000Z` (far future)** | **200** | **`too_soon`** | 0 | ❌ **DEF-1** — answered *"Running instances can take about 60 seconds…"* with `observationStartsAt: 2099-01-01T00:01:00.000Z` |
| now + 10 min (near future) | 200 | `too_soon` | 0 | ❌ same defect |
| 10 min ago | 200 | `no_traffic_either` | 2 | ✅ |
| 30 s ago | 200 | `too_soon` | 0 | ✅ |
| **`2026-09-21T10:14:08Z` — the live seed `updated_at`** | **400** | — | 0 | ✅ refusal correct — **and RC-D confirmed, measured** |

**RC-D's consequence is now measured, not predicted.** All eight rows carry `updated_at = 2026-09-21T10:14:08Z` (§2.2, verified live). At the time of this run (2026-09-22 ≈15:24 UTC) that is **≈29 h old**, so a panel that rendered on page load from the row's `updated_at` takes a **400 on every one of the eight areas, today and from now on**. The refusal is right; the coupling is the point. Slice 2 must offer the check only **after a save**, or render the 400 as a first-class ***"too long ago to check"*** — **never as an error**. This is the single most likely way slice 2 ships visibly broken.

**Refuse-over-clamp is confirmed correct**: the response carries `success: false` and **no `data`**, so there is no path on which an operator reads counts for a window they did not ask for.

---

### 14.5 The gate discipline (RC-A / RC-B) — both proved by breaking them

**RC-A — each of the five `LITERAL_RULES` broken in turn**, by appending one violating line to `lib/business-os/llm/modelOptions.ts` (in-gate, and inside S1-T12's derived file list), running the per-file assertion, and restoring byte-identically each time. *(A first attempt at this was invalidated by an aborted script that left residue in the file; it was redone from a verified-clean backup, and that residue is why an early reading looked as though rule 1 fired for everything.)*

| Break | Test result | Rule named in the failure |
|---|---|---|
| `const __qa1 = 'claude-3-5-sonnet-20241022';` | 1 failed | *a quoted model id of any vendor family* ✅ |
| `z.enum(['gpt-4o', 'gpt-4o-mini'])` | 1 failed | *a quoted model id…* (subsumed — exactly as the suite's own subsumption test records) |
| `switch (m) { case 'gpt-4o': break; }` | 1 failed | *a quoted model id…* (subsumed) |
| `PRICES['gpt-4o']` | 1 failed | *a quoted model id…* (subsumed) |
| `{ temperature: 0.7 }` | 1 failed | **a temperature bound to a literal number** ✅ — genuinely independent, as claimed |
| `z.enum([ 'gpt-4o!' ])` — isolating variant, matches no valid model id | 1 failed | **a z.enum allow-list of model ids** ✅ |
| `switch (m) { case 'gpt-4o!': break; }` — isolating variant | 1 failed | **a switch case on a model name** ✅ |
| `PRICES['gpt-4o!']` — isolating variant | 1 failed | **a price-index key literal** ✅ |

All five rules are alive, each names itself, and the three narrow shape rules are provably live **independently** of the broad one once the subsumption is stepped around. RC-A is satisfied, and the `mustMatch` liveness samples are doing the job they were added for — a dead regex cannot now read as coverage.

**The required CI gate catches the same breaks** (not only the jest backstop): `check:bos-llm-literals` went `0 violations / exit 0` → `1 violations / exit 1` with `lib/business-os/llm/modelOptions.ts(160,15): model-literal: 'claude-3-5-sonnet-20241022'` and `(160,24): temperature: temperature: 0.7`, and back to exit 0 on restore.

**RC-B — the covered route renamed and moved.**

| Action | Gate outcome |
|---|---|
| `route.ts` → `route.renamed.ts` (rename in place) | **exit 1**, *"An entry in LITERAL_SCOPE_INCLUSIONS names a file that is not in scope … It was moved, renamed or deleted, so the file it covered is no longer checked."* ✅ **red, not green** |
| `route.ts` moved to `app/api/admin/business-os/llm-model-settings/route.ts` | **exit 1**, same message ✅ |
| restored | **exit 0** ✅ |

This is the exact failure mode the inclusion list exists to prevent, and it fails loudly. RC-B is satisfied. It also means the ordering constraint in §10 is self-enforcing in one direction: if the gate change ever lands **without** the route, the gate goes red rather than quietly covering nothing.

---

### 14.6 Security and scoping

| Check | Evidence | Result |
|---|---|---|
| `requireAdmin` is the **first** statement, both routes | `route.ts:59`, `ledger/route.ts:84` — nothing above them but the correlation id and the child logger. Source test asserts the first `await` in the handler is `requireAdmin` | ✅ |
| Never the non-conforming sibling | neither file contains `AdminAccessService` (comments stripped before scanning). The sibling `app/api/admin/business-os/llm-usage/route.ts:56` **does** hand-roll `AdminAccessService.getInstance().isAdmin(...)` inside the handler — one of the seven parked inline handlers, correctly **not** copied | ✅ |
| Anonymous caller | 401 on both routes, **and nothing is read** (`buildAdminSettingsView` / `summarise` asserted not called) | ✅ |
| Signed-in non-admin | 403 on both, nothing read | ✅ |
| Fails closed | the admin check **throwing** → 403, nothing read | ✅ |
| The cross-tenant aggregate is explicitly named and cannot leak | `summariseFeatureAllAccountsInWindow` — the name carries it; the doc block names its one caller and says never to call it from an owner-facing path; logged at **info**, not debug, because it is cross-tenant. It selects `TOKEN_USAGE_COLUMNS.count` (`'id'`) with `head: true` and `created_at` with `limit 1` — **no account id, no owner text, no per-account rows, no cost**. `assertWindow` + `assertFeatures` still run | ✅ |
| The response cannot carry per-account data | the route returns `after` / `before` verbatim, and they are `{ count, latestAt }` by construction | ✅ |
| Zod on inputs | ledger route: `z.enum(BOS_LLM_AREAS)` + `z.string().datetime({ offset: true })`, parsed with `safeParse` before anything; the main route takes **no** input at all — `buildAdminSettingsView()` is called with zero arguments, asserted | ✅ |
| The client can never name a settings key | the key is `bosLlmAreaKey(area)`, total over the enum; `?key=bos_llm_area_chat` is ignored; the route source contains no `bos_llm_area_`, no `system_settings_config`, no `supabase` | ✅ |
| No error detail to the client in production | the main route gates `details` on `NODE_ENV === 'development'` (asserted with `NODE_ENV=production`); the ledger route's 500 carries no details at all, and a `relation token_usage does not exist` error does not reach the body | ✅ |
| Pino + `correlationId` | both routes take `x-correlation-id` or mint one, and use a child logger throughout | ✅ |
| No `console.*` | zero across all six feature source files and all four of their test files, and zero in the four modified `lib/` files. `scripts/check-bos-llm-literals.ts` (14) and `scripts/lib/bos-llm-scope.ts` (1) use `console.*` — correct: a CLI gate's stdout **is** its interface, and CLAUDE.md's Pino rule binds `lib/`, `app/`, `components/`. **No action.** | ✅ |
| Repository discipline | no Supabase client outside `lib/repositories/`; the deliberate absence of `.eq('user_id', …)` is in one named method with its reason written down | ✅ |

---

### 14.7 `adminSettingsView`

| Check | Evidence | Result |
|---|---|---|
| Resolved value vs stored row | `resolved` per call comes from `validateAreaRow`; `storedRow` is carried separately and labelled secondary in the type | ✅ |
| Per-field provenance survives the wire | over `JSON.parse(JSON.stringify(view))`, **every** call of **every** area carries all four keys `enabled, model, provider, temperature` — never `{}`. A recursive walk of the payload finds **no `Map` and no `Set`** anywhere. RC-2a holds | ✅ |
| `temperature: undefined` is "not set", never `0` | `images/image_generation` → `null` with `temperatureNotApplicable: true`; and the converse, which the shipped suite does **not** pin: a configured `temperature: 0` survives as **`0`** in memory and as **`0`** over the wire (the code uses `??`, not `||`) | ✅ |
| `temperature` keys are never dropped as `undefined` | every call view carries both `resolved.temperature` and `defaults.temperature` as present keys after `JSON.stringify` | ✅ |
| An absent row is "running on code defaults" | `rowPresent: false`, `storedRow: null`, `lastChangedBy: { kind: 'no_row' }` for all eight areas, HTTP **200**, no error styling anywhere in the payload | ✅ |
| The three FR-14 states stay apart | `no_row` ≠ `not_recorded` ≠ `admin` ≠ `unresolved`; never blank, never `"unknown"`, never the string `null`. Both R-1 guards present and asserted **independently** (removing either fails its own test); an empty-string `updated_by` is also answered as `not_recorded` before any lookup | ✅ |
| It has **not** become a second validator | a source scan finds **no** price lookup, **no** temperature-bound comparison, **no** provider allow-list test, **no** precedence walk of its own and **no** `checkModel`/`checkProvider`/`checkTemperature`/`evaluateAreaRow` call. `validateAreaRow` is called **exactly eight times** — once per area, no N+1 | ✅ |
| One pricing snapshot per request | `newModelOptionsContext()` built once and shared across the eight areas (SA's should-fix 9) | ✅ |
| Degrades honestly | a `listActive()` that returns `{ error }` logs at warn and renders ids `unresolved` rather than failing the page | ✅ (see DEF-6's sibling note) |

---

### 14.8 Test coverage against the acceptance criteria

| Acceptance criterion | Tested? | Result | Notes |
|---|---|---|---|
| **AC-1** (FR-1) — 401/403, nothing read, `requireAdmin` first, never a hand-rolled `AdminAccessService` | ✅ | **Pass** (read half) | Both routes. The `PUT` half is slice 3. Live verification against a deployed non-admin session is post-deploy |
| **AC-3** (FR-4, FR-7) — resolved values equal the resolver's, all eight areas; a deleted row renders as code defaults | ✅ | **Pass** | Asserted against `validateAreaRow` on the **serialised** payload, plus the additive-change proof (S1-T4b) |
| **AC-4** (FR-4) — provenance `call` / `area` / `default`; `temperature: undefined` is "not set", never `0` | ✅ | **Pass** | Including the case only the resolver gets right (a *rejected* call-level model falls through to `area`), and QA's converse (a real `0` stays `0`) |
| **AC-5** (FR-5) — five issues, each on the right field with the resolver's own `reason` | ✅ | **Pass** | Issues partition cleanly into per-call and area-level by `callName === undefined` |
| **AC-7** (FR-8) — options only where input > 0 **and** output > 0; a 0/0 row absent **and** refused if typed; advisory label with cache age | ✅ | **Pass** | Plus QA's 16 independent probes (§14.2). The list an operator actually sees depends on production `ai_model_pricing` — post-deploy |
| **AC-11** (FR-11) — the switch-off refusal | ✅ | **Pass** (predicate half) | Pure, no I/O, never mutates its input; hostile rows (`null`, a string, an array, `calls` as an array, `enabled: 'false'`, `enabled: 0`, a string call entry, an unknown call name, `__proto__`, `constructor`) all yield `[]` safely. Its `--include-calls` output is a row `validateAreaRow` **accepts** (`ok: true`), and re-running the predicate on it yields `[]`. **D-5/Q-8 reproduced**: it names `['analysis']` and skips the non-switchable `chat/planner`, and QA confirmed why — a row with `planner: { enabled: false }` is refused as `call_not_switchable`. The route and script halves are slices 3 and 4 |
| **AC-12** (FR-12) — locks with reasons | ✅ | **Pass** (read half) | `onboarding.switchable: false`; `chat/planner` `switchable: false` + `lockedTemperature: 0`; image `temperatureNotApplicable: true` |
| **AC-13** (FR-13) — actor on `set()`, both branches; a four-argument caller unchanged | ✅ | **Pass** | The update branch spreads `updated_by` only when an actor is supplied, so an actor-less caller **cannot erase** an attribution. The insert branch writes both (R-5). **No caller in slice 1**, so K-11 is untrippable here |
| **AC-14** (FR-14) — three row states, `updated_by` → email, null `user_id` skipped | ✅ | **Pass** (payload half) | Both R-1 guards asserted independently |
| **AC-17** (FR-18) — save + 60 s, "completed", all three readings | ✅ | **Pass** | §14.3. `too_soon` is a correct fourth branch, and a fifth for chat |
| **AC-18** (FR-19) — chat renders none of the three | ✅ | **Pass** | Short-circuited **before** the repository call; zero cross-tenant reads |
| **AC-25** (FR-18) — the aggregate's name, shape and exposure | ⚠️ | **Pass against the approved design; FAIL as the requirement is literally written** | The requirement still says *"count, latest timestamp **and cost sum**"*; RC-6 deliberately dropped `costSum` and the workplan records why. **DEF-4** |
| **AC-28** (FR-2, NFRs) — 0 new type diagnostics, literal gate passes with **no new exemption**, `next build` passes, no direct Supabase | ✅ | **Pass** | §14.1. Exemptions still **2**, byte-identical; the route is an **inclusion**, not an exemption; the baseline was never regenerated |

**Not in slice 1 and not tested here:** AC-2, AC-6, AC-8 … AC-10, AC-15, AC-16, AC-19 … AC-24, AC-26, AC-29, AC-30.

---

### 14.9 Issues found

#### Bugs

1. **`since` is bounded below but not above — a future timestamp is answered `too_soon` instead of refused.** File: `app/api/admin/business-os/llm-settings/ledger/route.ts` (the `MAX_SINCE_AGE_MS` check) — Severity: **Medium**.
   - Steps to reproduce: `GET …/ledger?area=leads&since=2099-01-01T00:00:00.000Z` as an admin.
   - Expected: a 400 in the same shape as the 24 h refusal — the route's own stated principle is *refuse, never guess*, and it applies symmetrically.
   - Actual: **200**, `kind: "too_soon"`, `observationStartsAt: "2099-01-01T00:01:00.000Z"`, and the sentence *"Running instances can take about 60 seconds to pick the change up, so there is nothing to count yet"* — false by 73 years. The guard is `now − savedAt > MAX`, which a negative age passes; `observationStart >= now` then routes it to `too_soon`.
   - Impact today is contained, not absent: it issues **no** database read, and slice 2 supplies `since` from the row's `updated_at`. But the route is the contract, and this is the one branch where the panel states something confidently wrong about the system's own timing.
   - Fix shape: refuse a `since` more than a small clock-skew allowance in the future, with its own sentence, **before** the `too_soon` branch.

2. **The test that should pin the chat/bound ordering asserts nothing.** File: `app/api/admin/business-os/llm-settings/__tests__/ledger.route.test.ts:199` (*"bounds chat too — the short-circuit must not become a bypass"*) — Severity: **Low**.
   - `expect([200, 400]).toContain(res.status)` is satisfied by **every** status this handler can return on that path, so the test cannot fail. Measured behaviour: the chat short-circuit sits **above** the 24 h check, so `area=chat` with a 48 h-old `since` returns **200**. Harmless today (chat reads nothing either way), but the property the test is named for is untested.
   - Fix shape: assert the status the route actually returns, or move the bound above the chat branch and assert 400.

3. **The equivalence suite quantifies over candidates, never over what is offered.** File: `lib/business-os/llm/__tests__/modelOptions.test.ts` — Severity: **Low** (a coverage hole; the shipping code is correct today).
   - Demonstrated by mutation: changing the push to `accepted.push({ provider: candidate.provider, model: candidate.model.trim().toLowerCase() })` — the picker now offers a value it never asked the validator about — leaves the suite **15/15 green**. With a realistic `ai_model_pricing` row whose `model_name` differs only in case, that offers a model a save refuses as `unpriced_model`.
   - QA's direction-B assertion caught it on every area at once.
   - Fix shape: one assertion — for every entry in `byCall[call]`, `(await checkModelForCall(area, call, o.provider, o.model)).ok` is true. Two lines, and it closes the direction SA's note left open.

4. **AC-25 in the requirement is stale and, as written, unsatisfiable.** File: `docs/requirements/BUSINESS_OS_LLM_MODEL_SETTINGS_ADMIN_UI_REQUIREMENT.md:250` — Severity: **Low** (documentation).
   - It requires the aggregate to return *"count, latest timestamp **and cost sum**"*. RC-6 deliberately removed `costSum`, for a good reason recorded in the workplan (PostgREST cannot sum without an RPC; a silently capped cost figure rendered during a cost incident is worse than none). An auditor reading only the requirement would mark AC-25 failed.
   - Fix shape: amend AC-25 to *"count and latest timestamp only — no cost sum (RC-6)"*.

#### Performance issues

5. **The refusal sentence understates the ledger check's actual reach.** File: `app/api/admin/business-os/llm-settings/ledger/route.ts` — Severity: **Low**.
   - The message says *"The ledger check only looks at the 24 hours after a change."* Measured: the baseline window is the **same length again, before** the change, so the union spans up to ≈48 h (a 1 h `since` reaches 1.98 h; a 23 h `since` reaches ≈46 h). Each individual `count: 'exact'` scan is bounded at ≈24 h, which is what the bound is for and is sound — but the sentence an operator reads is not what the route does.
   - Fix shape: one word — *"the 24 hours either side of a change"*, or say the baseline is read too.
   - Related, unmeasurable here: the two statements' latency against a real `token_usage` is untested (see §14.10).

#### Edge cases

6. **`lastChangedByFor` can emit `{ kind: 'not_recorded', at: null }` while `LastChangedBy` types `at: string`.** File: `lib/business-os/llm/adminSettingsView.ts` — Severity: **Low**.
   - Not reachable today — the column has a default and R-5 now writes it explicitly in both branches — but slice 2 renders `at` directly and must not print *"last changed at null"*. Either narrow the type or give the renderer a fallback.
   - Sibling note, **not** a defect: `buildAdminEmailById` handles a `{ error }` result but not a **thrown** one; it is safe only because `AdminUserRepository.listActive` catches internally and always resolves `{ data, error }`. The doc block's *"failing the whole page over a label would be worse"* is therefore guaranteed by the repository's convention, not by this function's own construction.

7. **PRE-EXISTING, not this slice — the dated snapshot is permanently red.** File: `lib/business-os/llm/__tests__/__snapshots__/callParams.boundary.step3.test.ts.snap:44` — Severity: **Medium as a process defect**, zero as a product defect.
   - Confirmed pre-existing by stashing the entire tree (§14.1). The blast radius is one test and will stay one test — it is the only snapshot storing a raw user message that carries a date. But it is red **every day** from 2026-09-22 onward (the date is derived per UTC day), so `jest -u` buys one day and the selection can never be green. **For the TL, outside this feature.** Fix shape: normalise the date in the serialiser, inject a fixed `timezone` + clock, or hash the user message as the system prompt already is.

---

### 14.10 What can only be proven after deploy, or in a later slice

| # | Not provable here | Why, and when it becomes provable |
|---|---|---|
| 1 | **The option list an operator actually sees** | Every probe stubbed `listPricedModels` / `getPricing`. The live list is whatever `ai_model_pricing` holds; a row there with a stray space, a 0/0 price or an unexpected provider changes it. The equivalence is proved *structurally* — the picker asks the validator — so the list cannot be **wrong**, but it can be surprisingly **short**. First `GET` after deploy, with the page (slice 2) |
| 2 | **The aggregate's latency and index behaviour** | Two `count: 'exact'` / `limit 1` statements over the real `token_usage`, the largest table in the system. The 24 h bound caps the range; whether `(feature, created_at)` is indexed for it is unverified. Measure the first real ledger check |
| 3 | **The `updated_by` foreign key (K-11)** | Slice 1 ships **no caller** that passes `opts.actorId`, so the FK cannot be tripped. It becomes live with slice 3's writer, under D-U2 |
| 4 | **Anything an operator can see or do** | Both routes are unreferenced by any page. **Deploying slice 1 changes no observable behaviour**; the script is still the only writer. The first user-visible moment is slice 2 |
| 5 | **RC-D's rendering** | QA confirmed the **400** (§14.4). Whether it renders as *"too long ago to check"* rather than an error is a slice 2 property — and the most likely way slice 2 ships visibly broken |
| 6 | **Provider/model decoherence** | Needs a call whose `allowedProviders` differ from its neighbours'. None exists today. Slice 3's writer must persist provider **with** model, or the picker's answer does not bind (§14.2) |
| 7 | **The generic route's message (FR-3), the notification, the audit entries, the confirm step** | Slices 3 and 4 |

**What this changes for the user**

- **Nothing is writable.** Slice 1 is read-only end to end; the new `set()` parameter and the switch-off predicate have no caller.
- **The seed-date refusal is now measured, not predicted.** Every one of the eight areas returns 400 on a ledger check today. Whoever reviews slice 2 should check that specific screen state first.
- **`set()`'s insert branch now writes `updated_at` from application code** where it previously relied on the column default (K-10). It is the one part of this slice that is not purely additive **and not Business OS**. §4.8 requires every insert caller of `SystemConfigRepository.set` to be enumerated in the PR description — **that enumeration is still owed, and QA did not find it in the workplan.**
- **The gate change must land with or before slice 1.** QA proved the failure mode is loud in the direction that matters: if the route moves or is renamed while the inclusion stays, the required check goes **red**, not green. Landing the gate without the route fails the same way. Landing the route **without** the gate is the one silent case — the route would simply sit on `main` unchecked, which is exactly the state §10 exists to end.

**One thing QA changed and restored, recorded for RM.** Proving DEF-7 pre-existing required `git stash push -u` of the whole tree and a `pop`. With this repo's `core.autocrlf=true`, that round-trip rewrote the working-tree line endings of the untracked files to CRLF — the normal state for a Windows checkout. `git diff --numstat` shows **no** whitespace churn on any tracked file, git normalises on commit, and the full selection re-ran to the identical 895/896 afterwards, so the tree is materially as the Dev left it. All four QA probe suites were deleted; `git status` is back to the same 10 modified + 11 untracked paths, and the one file QA mutated (`modelOptions.ts`) is md5-identical to the backup taken before the first mutation.

---

### 14.11 Test outputs

```
typecheck-bos-llm: 177 files in scope, 31 errors, 0 new (103.8s)
typecheck-bos-llm: passed

check-bos-llm-literals: 43 files in scope, 2 exempt, 0 violations (18.1s)
check-bos-llm-literals: passed

--list:
  included app/api/admin/business-os/llm-settings/route.ts
  checked  app/api/admin/business-os/llm-settings/ledger/route.ts
  exempt   lib/business-os/llm/modelSettingsPolicy.ts
  exempt   scripts/bos-llm-settings.ts
  check-bos-llm-literals: 43 files in scope, 2 exempt, 1 included by name

next build: ✓ Compiled successfully (exit 0)

jest (lib/business-os/llm lib/ai lib/repositories app/api/admin/business-os scripts)
  Test Suites: 1 failed, 53 passed, 54 total
  Tests:       1 failed, 895 passed, 896 total

pre-existing failure, reproduced at a clean HEAD after `git stash push -u`:
  T3-S: the request each Step 3 call site puts on the wire (AC-2) > chat/planner
    -  "content": "Today is 2026-09-21.
    +  "content": "Today is 2026-09-22.
  Tests: 1 failed, 19 passed, 20 total
```

```
QA probe - picker vs a real save (8 areas x every call x 12 pricing shapes, both directions)
  PROBE 1 offered <=> saveAccepts .......... 8/8 areas, 0 mismatches
  PROBE 2 image partially/fully priced ..... hidden+refused / offered+accepted
  PROBE 3 every offered option survives a save, with NOTHING priced ... 8/8
  PROBE 4 allowedProvidersByCall === policy.allowedProviders ......... 8/8
  PROBE 5 null/number/object/array/boolean/blank models .............. agree
  Tests: 20 passed, 20 total

mutation M1 (revert to the pre-fix bug: global pre-filter + checkModelAcceptable)
  modelOptions.test.ts: 3 failed  |  with the QA probe: 10 failed, 25 passed  -> CAUGHT
mutation M2 (ask about the raw candidate, offer a normalised one)
  modelOptions.test.ts: 15 passed  -> NOT CAUGHT
  QA probe: OFFERED-BUT-REFUSED chat/planner openai:"gpt-uniq-4o" [model:unpriced_model]  (every area)
```

```
QA probe - ledger boundary (status | kind | cross-tenant reads issued)
  24h - 2s ................ 200 | no_traffic_either | 2
  24h + 2s ................ 400 | -                 | 0   "...only looks at the 24 hours after a change..."
  absent / '' / 'yesterday' / '-1' / '0' / no-TZ / date-only / +275760 ... 400 | - | 0
  2099-01-01T00:00:00Z .... 200 | too_soon          | 0   obsStart=2099-01-01T00:01:00.000Z   <-- DEF-1
  now + 10 min ............ 200 | too_soon          | 0                                      <-- DEF-1
  2026-09-21T10:14:08Z .... 400 | -                 | 0   <-- the live seed: RC-D confirmed
  10 min ago .............. 200 | no_traffic_either | 2
  30 s ago ................ 200 | too_soon          | 0

WINDOWS {"afterStartOffsetFromSinceMs":60000,"afterLen":3540001,"beforeLen":3540001,
         "beforeEndsAtSince":true,"totalReachHours":1.98,"feature":"business-os-leads"}
KINDS   {"withCounts":["still_arriving","stopped_with_before","no_traffic_either"],
         "countFree":["ledger_cannot_answer","too_soon"]}
EMITTED  still_arriving/stopped_with_before/no_traffic_either -> {count,latestAt}
         ledger_cannot_answer/too_soon -> after:null, before:null
```

```
QA probe - the five literal rules, broken one at a time in lib/business-os/llm/modelOptions.ts
  'claude-3-5-sonnet-20241022' ......... FAIL -> a quoted model id of any vendor family
  z.enum(['gpt-4o','gpt-4o-mini']) ..... FAIL -> a quoted model id (subsumed)
  switch/case 'gpt-4o' ................. FAIL -> a quoted model id (subsumed)
  PRICES['gpt-4o'] ..................... FAIL -> a quoted model id (subsumed)
  { temperature: 0.7 } ................. FAIL -> a temperature bound to a literal number
  z.enum([ 'gpt-4o!' ]) ................ FAIL -> a z.enum allow-list of model ids
  switch/case 'gpt-4o!' ................ FAIL -> a switch case on a model name
  PRICES['gpt-4o!'] .................... FAIL -> a price-index key literal

  and the REQUIRED gate itself:
  clean ............... exit 0  43 files, 2 exempt, 0 violations
  model literal ....... exit 1  modelOptions.ts(160,15): model-literal: 'claude-3-5-sonnet-20241022'
  temperature literal . exit 1  modelOptions.ts(160,24): temperature: temperature: 0.7

QA probe - RC-B, the covered route moved
  route.ts -> route.renamed.ts ............................. exit 1  "names a file that is not in scope"
  route.ts -> ../llm-model-settings/route.ts ............... exit 1  same
  restored ................................................. exit 0
```

---

### 14.12 Final status

**Counts: 51 checks PASS · 2 FAIL · 1 PARTIAL · 0 BLOCKED.** (The two FAILs are DEF-1 and DEF-3; the PARTIAL is AC-25, which passes against the approved design and fails against the requirement's stale wording.) No High-severity defect is open. Every gate reproduces §4.4 and SA's re-check exactly, the picker/validator equivalence survived sixteen hostile probes against the real save path, both RC-A and RC-B were proved by breaking them, and no path in the ledger panel degrades into a green tick.

- [x] **Ship slice 1** — recommended, with **DEF-1 and DEF-3 fixed in this slice** (a guard in the route the Dev already wrote the mirror of, and a two-line test assertion). Both are small, and both sit in the parts this slice exists to get right: the refusal's symmetry, and the one direction the equivalence suite cannot see.
- [ ] DEF-2 and DEF-5 are a one-line test and a one-word copy fix — take them with DEF-1, or record them.
- [ ] DEF-4 is a requirement edit; DEF-6 is recorded for slice 2.
- [ ] **DEF-7 goes to the TL as its own item**, not into this PR.
- [ ] **Still owed before merge (§4.8):** the enumeration of every insert caller of `SystemConfigRepository.set`, in the PR description. QA did not find it.
- [ ] **Ordering:** the `LITERAL_SCOPE_INCLUSIONS` change must land **with or before** slice 1. QA proved the gate fails loudly if the route moves away from the inclusion — the only silent case is the route landing **without** the gate.

---

## QA Test Report — Slice 2

**QA — 2026-09-24**
**Test mode:** full
**Strategy used:** **A + B + C + D-by-hand** — Jest unit/render suites (the screen is pure client rendering), source-level guard scans, **seven applied-and-reverted mutations of `app/admin/layout.tsx`**, **five applied-and-reverted mutations of the ledger panel and its copy module**, two throwaway probe suites (deleted), and — because Playwright does not exist in this repo — **a real `next start` server on port 3123 with unauthenticated `curl` against the RSC payload endpoint**. Every gate was re-run verbatim by QA, not taken from §5.3 or from the SA review.
**Focus:** security (the access guard), copy truthfulness, the FR-14 states, the ledger panel, nothing-writable
**Skipped:** nothing. `npm run lint` is **BLOCKED** (pre-existing, §5.3 — `next lint` on Next 14 will not read the flat config); `npx eslint <paths>` is the substitute and was run.
**Input source:** prompt keywords (`full`, focus security + copy) over the §5 / §5.3b scope block.
**Worktree discipline:** `git status --short` at the end of this report is **identical** to the one at the start — same 7 modified, same 4 untracked. Both probe suites were deleted; every mutation was reverted and verified byte-identical.

---

### 14.13 Gates — re-run verbatim by QA

| Gate | QA's measurement | §5.3 / SA claim | Verdict |
|---|---|---|---|
| `npm run typecheck:bos-llm` | `231 files in scope, 28 errors, 0 new (89.3s)`, exit **0** | matches both | ✅ PASS |
| `npm run check:bos-llm-literals` | `43 files in scope, 2 exempt, 0 violations (23.7s)`, exit **0** | matches | ✅ PASS |
| `check:bos-llm-literals -- --list` | `included app/api/admin/business-os/llm-settings/route.ts` · `exempt lib/business-os/llm/modelSettingsPolicy.ts` · `exempt scripts/bos-llm-settings.ts` · `43 in scope, 2 exempt, 1 included by name` | matches | ✅ PASS |
| **Gate scripts unchanged** | `git diff origin/main -- scripts/check-bos-llm-literals.ts scripts/typecheck-bos-llm.ts` is **empty**. No exemption added or widened, no inclusion added, no baseline regenerated | as claimed | ✅ PASS |
| `npm run lint:hooks` | clean, no output, exit **0** | matches | ✅ PASS |
| `npm run build` | `✓ Compiled successfully`, exit **0**; route table `ƒ /admin/business-os-llm  6.8 kB  94.7 kB`; `/admin/business-os-llm/page` present in `.next/app-build-manifest.json`; `.next/server/app/admin/business-os-llm` emitted | matches | ✅ PASS |
| jest — the four touched paths **plus the required `admin-authz-surface.guard` suite** | **26 suites / 609 tests / 23 snapshots, all passing**, exit **0** | matches exactly | ✅ PASS |
| `npx eslint` on every new + touched file | **1 error, 6 warnings.** The error is in a file this slice created — see **DEF-S2-6** | §5.3 claims "exit 0, **0 problems**" | ⚠️ **FAIL (claim)** |
| `npm run lint` | cannot run — interactive `next lint` setup prompt | as recorded | ⛔ BLOCKED (pre-existing) |

**Incidental, and worth one line:** the build log shows `requireAdminPage` emitting *"Auth lookup threw on an admin page; treating as signed out"* for `/admin/business-os-llm` during prerender. That is the layout guard **running for this page** and **failing closed** — the first independent confirmation that the page is inside the guarded subtree, obtained without a single assertion.

---

### 14.14 The access guard — attacked, not reasoned about

**Two unexpected modified files, cleared first.** `app/admin/layout.tsx` and `lib/admin/requireAdminPage.ts` are not in the stated change list. Both diffs are **comment-only** (F-11's "21 pages" → 22). No behaviour. ✅

#### Can settings data be obtained without being an admin? — measured against a running server

`npx next start -p 3123`, then unauthenticated `curl` (no cookies). Every body was scanned for the page's own copy (`Business OS AI`, `Switching an area off is not a guarantee`, `Configured`, `Ledger check`) and for settings words (`gpt-`, `temperature`, `provider`, `business_os_llm`).

| # | Probe | Result | Verdict |
|---|---|---|---|
| P1 | `GET /admin/business-os-llm` (HTML) | 200, 5,934 bytes, contains `NEXT_REDIRECT`, **0 hits** for every page string and every settings word. Body is the not-found/redirect shell, `<title>NeuronForge</title>` | ✅ no leak |
| P2 | `GET …?_rsc=…` with `RSC: 1` (direct RSC payload) | 200, `NEXT_REDIRECT` present, **0 settings words**. Payload carries a **client-module reference** to `static/chunks/app/admin/business-os-llm/page-*.js` (public JS) and nothing else | ✅ no leak |
| P3 | Prefetch (`RSC: 1` + `Next-Router-Prefetch: 1`) | 200, bare tree, `null` children — **no data at all** | ✅ no leak |
| P4 | `GET /api/admin/business-os/llm-settings` | `{"success":false,"error":"Unauthorized"}` **401** | ✅ |
| P5 | `GET …/llm-settings/ledger?area=website&since=…` | `{"success":false,"error":"Unauthorized"}` **401** | ✅ |
| **P6** | **Soft navigation** — `RSC: 1` + a crafted `Next-Router-State-Tree` claiming the caller is already at `/admin/system-config` | **200, and NO `NEXT_REDIRECT`.** The layout was **not** re-rendered, so `requireAdminPage()` **did not run**. 0 settings words; payload is the page's client-chunk reference only | ⚠️ see **DEF-S2-10** |
| **P7** | Same, claiming `/admin/business-os-llm` itself is already rendered (deepest escape) | **200, no `NEXT_REDIRECT`**, 739 bytes, 0 settings words | ⚠️ see **DEF-S2-10** |
| P8 | `find app/admin -name route.ts` (escape E1) | **none** | ✅ |
| P9 | `grep -rn "use server" app/admin/business-os-llm/` | **none** | ✅ |
| P10 | Server modules imported by the screen | only `@/lib/business-os/llm/ledgerCheckCopy` (a plain copy module, deliberately not `server-only`), plus local files, `react`, `lucide-react`. **No `modelSettings`, `modelSettingsPolicy`, `modelSettingsSchema`, `callCatalog`** | ✅ FR-6 holds |
| P11 | `requireAdmin` position in both `GET`s | **first statement** in each (`llm-settings/route.ts`, `ledger/route.ts`); nothing above either but `correlationId` + child logger | ✅ |

**Verdict on disclosure: no settings data can be obtained without being an admin, by any of the paths above.** SA's conclusion holds. **The reason SA gave for one path does not** — DEF-S2-10.

#### The guard assertion — seven mutations, each applied, measured and reverted

Both guard suites run together each time (`source.guard.test.ts` + the required `admin-authz-surface.guard.test.ts`), 115 tests at rest.

| # | Mutation of `app/admin/layout.tsx:40` | Measured | Verdict |
|---|---|---|---|
| **G1** | `// TEMPORARILY DISABLED FOR DEBUGGING: await requireAdminPage();` (SA's F-1 mutation, verbatim) | **1 failed / 114 passed** — *"the layout still owns the guard, and a commented-out guard does not count"* | ✅ **F-1's fix bites** |
| **G2** | `/* await requireAdminPage(); */` (block comment) | **1 failed / 114 passed** | ✅ caught |
| **G3** | `if (process.env.NODE_ENV === 'development') return <AdminChrome>{children}</AdminChrome>;` **above** the call | **115 / 115 passed** | ❌ **DEF-S2-2** |
| **G4** | `await` dropped — `requireAdminPage();` | **1 failed / 114 passed** | ✅ caught |
| **G5** | `try { await requireAdminPage(); } catch {}` | **115 / 115 passed** | ❌ **DEF-S2-1** |
| **G6** | Guard replaced with a hand-rolled `AdminAccessService` call | **1 failed / 114 passed** | ✅ caught |
| **G7** | `const _admin = await requireAdminPage();` (result assigned, never read) | 115 / 115 passed | ✅ **correct** — the guard still runs and still redirects; this is not a regression and must not fail |

**F-1 is genuinely fixed**, and the rule-level test (import line / `//` comment / `/* */` comment asserted **not** to match, a real call asserted to match) is the right shape. **F-2 reproduced as recorded:** on G1, G2, G4 and G6 the required `Admin authz surface guard` stayed **green** — slice 2's own assertion was the only thing that failed, every time. §5.3b's sentence *"until then, F-1's assertion is the only thing standing"* is measured fact. **That is exactly why DEF-S2-1 matters:** it is a hole in the only control standing.

---

### 14.15 The fail-open copy, read as an operator at 2am

Driven by rendering the real components and reading the real strings, not by reading `copy.ts`.

| Probe | Question | Outcome |
|---|---|---|
| **C1** | Is the banner **undismissible by construction**? | ✅ **Yes.** `Props` is `{ variant }` only; the module's entire export surface is `["FailOpenNotice"]`; **0** buttons, `[role=button]` or links inside the rendered banner; no `useState`, no `onClose`, no `dismissible`, no storage key. SA's M3 (adding `onDismiss?`) re-confirmed as caught. There is nowhere to put a dismiss without changing the signature |
| **C2** | Does the banner **overclaim about the fleet**? | ✅ **No.** Every sentence is about the *mechanism* ("is not a guarantee", "One that cannot read them **on startup**…"), never about the present state, so a fleet that is entirely fine is not maligned. F-8's two-word fix and the missing last-good case are both in. *"A card that reads 'Configured: off' is describing the stored row, not what the fleet is doing"* is exactly true |
| **C3** | Is the **evidence claim** still false for chat (the F-3 defect)? | ✅ **No** — the old unscoped sentence is gone and asserted absent. Chat is not named, so FR-6 holds |
| **C4** | Does the **inline** line stay true when its own area's ledger check **cannot answer**? | ❌ **No.** See **DEF-S2-3** |
| **C5** | Is every sentence true **for every area it appears beside**? | ❌ **No.** See **DEF-S2-4** (the one non-switchable area) |
| **C6** | Does chat's card, when the ledger answers, keep the promise? | ✅ Yes — verbatim: *"The ledger cannot answer for chat: … Check the chat entry gate and the server log line 'Business OS LLM settings changed' instead."* This is the **one** panel state in which the inline notice's promise is kept |

---

### 14.16 FR-14's three states and DEF-6

Driven through the **real** `lastChangedByFor()` with realistic `SystemSettingsConfig` rows, then rendered — not from hand-made props.

| Check | Result |
|---|---|
| **State 1 (`admin`)** from a real row + a real `Map` | ✅ `{ kind: 'admin', at: '2026-09-21T10:14:08.000Z', email: 'ops@…' }` → *"Last changed by ops@… at 2026-09-21 10:14 UTC"*. No `1970`, no `(time not recorded)` |
| **State 3 (`unresolved`)** — an id in no `Map` | ✅ `{ kind: 'unresolved', at, userId: 'ghost-42' }` → the raw id **plus** *"that id matches no active admin account, so it is shown as stored"*. Never *unknown*, never blank |
| **State 2 (`not_recorded`)** — today's state on all eight rows | ✅ renders, and is textually distinct from state 1, 3 **and** from no-row (which renders **nothing**, the card printing the FR-7 line instead — confirmed: `last-changed` absent, `no-row-note` present) |
| **`at: null` → 1970 anywhere?** | ✅ **Impossible.** `formatInstant` is the **only** date path in the whole screen (`grep` for `new Date(`, `Date.parse`, `toLocale` outside `format.ts`: zero hits in code). It guards with `!at`, so `null`, `undefined` **and `''`** all return `null`. An unparseable string is returned **as-is** (`'not-a-date'` → `'not-a-date'`), never guessed at. `formatInstant('1970-01-01T00:00:00.000Z')` correctly renders that real instant; numeric `0` returns `null` |
| **Is `(time not recorded)` reachable from a legitimate row?** | ✅ **No.** Four realistic timestamp forms — `…Z`, `… +00` (raw Postgres), microsecond precision, and no-designator — all produce a real date. **Only** `updated_at` ∈ {`null`, `undefined`, `''`} reaches the sub-state. It is defensive and unreachable today, which is what SA wanted kept, and it is pinned |
| **DEF-6 closed at the boundary** | ✅ and the pin is real: reverting `at: string \| null` → `at: string` (SA's M7) makes `typecheck:bos-llm` fail — `231 files, 29 errors, **1 new**`, `TS2344` naming `adminSettingsView.wireTypes.test.ts(45,52)`. **And jest stays 2/2 green under the same mutation** — F-4's repo-wide fact reproduced |
| **F-4's stated gate is correct** | ✅ `typecheck:bos-llm -- --list` reports the wireTypes file as **`core`**. Also — better than §5.3b claims — `LedgerCheckPanel.tsx` and `ledgerPanel.render.test.tsx` are in that scope as **`caller`** (via `ledgerCheckCopy`), so two screen files *are* type-pinned |

---

### 14.17 The ledger panel — all eight branches, plus a ninth

| Check | Result |
|---|---|
| **All eight `PanelState` branches driven** | ✅ 3 counted readings + `ledger_cannot_answer` + `too_soon` + `cannot_check` + `failed` + `no_change` |
| **No tick, no green, no success wording, in every branch** | ✅ Each branch asserts the **strong** form over the whole panel: `panel.innerHTML` against `/text-(green\|emerald)-\|bg-(green\|emerald)-/`, `textContent` against `/\b(confirmed\|verified\|success\|proven)\b/i` and against `/[✓✔☑]/`. **F-6's weak wrapper-`className` check is gone** |
| **F-6's mutation re-run** | ✅ RC-D heading → `text-green-400`: **1 failed**, naming the `cannot_check (RC-D)` branch. (SA measured 9/9 green before the fix) |
| **A tick smuggled into a reading sentence** | ✅ caught — `1 failed`, `stopped_with_before` branch |
| **The panel writing its own reading** | ✅ caught — **4 failed** |
| **The caveat dropped** | ✅ caught — **3 failed** |
| **Would the count assertion catch a NINTH branch?** | ❌ **No, not for the realistic shape.** See **DEF-S2-5** |
| **Chat renders none of the three readings** | ✅ each of the three count-bearing sentences asserted absent; `ledger-counts` absent; the gate and the log line both named |
| **The chat short-circuit is server-side** | ✅ **twice over.** (a) `LedgerCheckPanel.tsx`, comments stripped, contains no `'chat'` / `"chat"` at all — asserted, and SA's M4 (adding `if (area === 'chat')`) re-confirmed as caught. (b) The route decides it **before** any repository call, and QA confirmed both `reason` codes are emitted after that short-circuit and before any read |
| **Does every string come from `ledgerCheckCopy`?** | ⚠️ **The readings and the caveat do; three branches' headings do not.** See **DEF-S2-8** — a doc overclaim, not a design fault: the refusal's *explanation* correctly comes from the route's own sentence (D-1), which is the right split |
| **F-9** (`Check again` disabled on `too_long_ago` only) | ✅ asserted and confirmed disabled on the monotonic branch; `isKnownReason` type guard makes the neutral fallback visibly deliberate |
| **RC-D is not an error** | ✅ no red anywhere in the panel's `innerHTML`; `ledger-failed` absent; the route's own 24-hour sentence rendered verbatim |

---

### 14.18 Nothing writable, and nothing pre-empting slice 3

| Scan (source, tests excluded, comments stripped) | Hits |
|---|---|
| `<form`, `onSubmit`, `onChange`, `action=`, `useFormState`, `useActionState` | **0** |
| `method: 'POST' \| 'PUT' \| 'PATCH' \| 'DELETE'` | **0** |
| `fetch(` calls | **2**, both bare `GET` — `/api/admin/business-os/llm-settings` and `…/ledger?area=&since=` |
| `AuditTrailService`, `sendEmail`, notification, `dryRun`, `supabase`, an `updated_by` write | **0** |
| `confirm` / `PUT` textual hits | **6, every one of them prose or copy** (verified after stripping comments: the only survivors are the two `Confirm at…` sentences in `copy.ts`) |
| `<input>` in the whole screen | **1**, and it is `disabled readOnly` — a lock that looks like a lock (FR-12) |
| Buttons | **4**: card expand/collapse, `Check again`, stored-row expand, page refresh. All read-only |
| Slice-3 surface | **None.** No confirmation step, no audit entry, no notification, no foreign-key fallback. `LastChangedLine`'s `not_recorded` copy is already worded to stay true once slice 3's unattributed save lands, and is asserted not to claim the change came from the command line |
| `READ_ONLY_NOTE` | Present on every expanded card, naming `npm run bos:llm-settings` and runbook §3/§4 — the honest alternative to a dead control |

✅ **PASS.** Slice 2 changes what an admin can **see** and nothing about what anyone can **write**.

### 14.19 The literal gate's four false-positive shapes

✅ **None tripped, and none needed a rule change.** Scanned every screen source file with the gate's own patterns after stripping comments: **no** quoted model id of any vendor family, **no** `z.enum` of model ids, **no** `switch` case on a model, **no** price-index key, **no** temperature literal. The screen contains no model name at all. `--list` confirms the screen is **outside** the literal gate's 43-file scope, so `source.guard.test.ts` — which walks the directory rather than listing it, so tomorrow's component is covered before anyone remembers — really is the only enforcement. Exemption and inclusion lists are **byte-identical to `origin/main`**.

### 14.20 The sidebar (D-U1)

✅ One entry, `Business OS AI` → `/admin/business-os-llm`, icon `Bot`, **directly under System Config** in the Configuration group — exactly as documented. `app/admin/system-config/page.tsx` is **untouched** and its 20 `console.*` calls stay out of the diff; `nav.test.ts` pins that so a one-line cross-link cannot smuggle the conversion in later.

---

### 14.21 Test coverage against the acceptance criteria

| AC / FR | Tested? | Result | Notes |
|---|---|---|---|
| AC-2 / FR-1 — non-admin never reaches the page | ✅ | **Pass, with a test gap** | Seven live unauthenticated probes found no leak on any path. Two of seven guard mutations are undetected (DEF-S2-1, DEF-S2-2) |
| AC-6 / FR-6 — client imports no server module, holds no literal | ✅ | Pass | Verified independently of the test; M5/M6 re-confirmed |
| AC-4 / FR-4 — provenance, `temperature` "not set" | ✅ | Pass | `not set — the provider default applies`; `null` never rendered as `0`; code default shown beside an overridden model |
| AC-5 / FR-5 — issue against its field, resolver's own `reason` | ✅ | Pass | Reason verbatim in mono, gloss beside it, never instead; non-field issues surfaced rather than dropped |
| AC-3 / FR-7 — no row → code defaults, no attribution, not an error | ✅ | Pass | Confirmed rendered: `no-row-note` present, `last-changed` absent, no error styling |
| AC-12 / FR-12 — locks disabled **with their reason as text** | ✅ | Pass | Three lock reasons render as text, not tooltip-only |
| AC-14 / FR-14 — three states (+ DEF-6) | ✅ | Pass | §14.16, driven from the real server function |
| AC-16 / FR-16 — never claims an area is off | ✅ | Pass | Only `Configured: on/off` and `Cannot be switched off`; rendered-output scan |
| AC-17 / FR-17 — standing, undismissible sentence | ⚠️ | **Partial** | Undismissible ✅ and beside every switch ✅; but two of its sentences are untrue in the state every card is in today, and one is self-contradictory on one card (DEF-S2-3, DEF-S2-4) |
| AC-17 / FR-18 — three readings, equal weight, shared caveat, no success affordance | ✅ | Pass | Eight branches, strong assertions, four mutations bite |
| AC-18 / FR-19 — chat renders none of the readings | ✅ | Pass | And the short-circuit is server-side, proven two ways |
| FR-20 — propagation stated | ✅ | Pass | `PROPAGATION_NOTE` on every panel |
| RC-D — the 24 h bound as a neutral state | ✅ | Pass | *"Too long ago to check"*, no red, retry disabled |
| D-1 — `reason` codes | ✅ | Pass | Purely additive; slice 1's ledger tests pass untouched; a third code degrades to a neutral heading |
| Nothing writable | ✅ | Pass | §14.18 |

**Counts: 46 checks PASS · 7 FAIL · 2 PARTIAL · 1 BLOCKED** (`npm run lint`, pre-existing).

---

### 14.22 Issues found

#### Bugs (must fix before commit)

**DEF-S2-1 — A `try/catch` around the guard disables it, and both guard suites stay green. — File: `app/admin/business-os-llm/__tests__/source.guard.test.ts:142-145` — Severity: Medium (High as a class; it is a hole in the only control standing)**
- Steps to reproduce: replace `app/admin/layout.tsx:40` with `try { await requireAdminPage(); } catch {}`, then `npx jest app/admin/business-os-llm/__tests__/source.guard.test.ts lib/admin/__tests__/admin-authz-surface.guard.test.ts`.
- Expected: a failure — `requireAdminPage` redirects **by throwing**, so a bare `catch` swallows the redirect and the layout returns `AdminChrome` to a non-admin.
- Actual: **`Tests: 115 passed, 115 total`**, exit 0. `GUARD_CALL = /await\s+requireAdminPage\s*\(\s*\)/` matches happily inside a `try`.
- Why this one: `app/admin/layout.tsx:38-39` **names this exact hazard in its own comment** — *"Deliberately NOT wrapped in try/catch: `requireAdminPage` redirects by throwing, and swallowing that would render the admin shell to a non-admin."* The documented hazard is the unasserted one. It is the same class as F-1 (a realistic way to disable the guard that leaves the suite green), and with F-2 open this assertion is the only control over 22 admin pages.
- Not a live vulnerability today: no settings leak (§14.14 P1–P5), because the page is `'use client'` with no server data and both APIs are `requireAdmin`-gated. What would render is the admin **shell**.
- Fix shape (one line): `expect(layoutCode).not.toMatch(/try\s*\{[\s\S]*?requireAdminPage/)`, or better, assert the call is the **first statement** of the component body — which also closes DEF-S2-2.

**DEF-S2-3 — The inline fail-open notice, and the banner, promise an answer the ledger panel does not give in the state all eight cards are in today. — Files: `app/admin/business-os-llm/copy.ts:63-66` (`FAIL_OPEN_INLINE`) and `:56-60` (`FAIL_OPEN_ACTION`) — Severity: Medium**
- `FAIL_OPEN_INLINE` says: *"Confirm at this area's ledger check below, **which also says whether the ledger can answer for this area at all** (runbook §5)."* `FAIL_OPEN_ACTION` says: *"…**each card's ledger check says whether it can answer**, and for some areas it cannot."*
- The panel makes that statement in **exactly one** of its eight states — `reading` with `kind: 'ledger_cannot_answer'`. In the other three non-reading states it says nothing about the ledger's reach. Measured, verbatim:
  - `cannot_check / too_long_ago` → *"Too long ago to check — The ledger check only works for a change made in the last 24 hours. For an older change, use the audit trail instead."*
  - `no_change` (no stored row) → *"There is no stored change to count from, so there is nothing to check."*
  - `failed` → *"The ledger check itself could not be run. That says nothing about this area — try again."*
- **`too_long_ago` is the branch every one of the eight areas takes on load** — RC-D, measured in §14.4, and restated in `LedgerCheckPanel`'s own header. So on day one the sentence that tells an operator how to verify a switch-off points at a panel that never answers the question it was sent to answer.
- Secondary misread, and the reason this is not merely pedantic: the banner primes *"for some areas it cannot [answer]"*; the operator then opens `website` and reads *"Too long ago to check"* and may conclude the ledger can **never** see that area — conflating RC-D's window bound with chat's permanent blindness. The misread is **conservative** (it sends them to the runbook §5 log lines), so it is not dangerous; it is still a misread the copy induces.
- This is the residue of F-3. Scoping instead of enumerating was the right call for FR-6 — but the fix relocated the truth-claim onto the panel without checking that the panel makes it in the states it can actually be in.
- Fix shape, still no per-area hardcoding: have the route answer the reach question **independently of the window** — add one boolean (e.g. `ledgerCanSeeArea`) to the two 400 bodies and to every reading, so the panel can state it in all eight branches — **or** soften both sentences to the conditional: *"where the check can answer, it will also tell you if the ledger cannot see this area at all."*

**DEF-S2-4 — On `onboarding`, the inline notice contradicts the line rendered directly beneath it. — Files: `app/admin/business-os-llm/components/AreaCard.tsx:123-136` + `copy.ts:63` — Severity: Medium**
- `BOS_LLM_AREA_LOCKS` makes exactly one area non-switchable: `onboarding: { switchable: false }`. `AreaCard` renders `FailOpenNotice variant="inline"` for **every** expanded card, then `LOCK_AREA_NOT_SWITCHABLE` immediately after, in the same `space-y-2` block.
- Measured, verbatim and consecutive, on the onboarding card:
  - chip: **`Cannot be switched off`**
  - notice: **`"Off" is the stored configuration, not a guarantee — an instance that cannot read these settings on startup starts with every area on. Confirm at this area's ledger check below…`**
  - next line: **`This area can never be switched off — the code refuses it at every level.`**
- An operator is told to treat a stored "off" as unreliable and to go corroborate a switch-off, one line above being told the switch-off cannot exist. On the single card where the fail-open warning is **inapplicable** (nothing can be switched off, so falling back to defaults-on changes nothing), it is the most prominent text.
- Fix shape: render the inline notice only when `area.switchable`, or give the locked area its own one-liner. Either is a two-line change in `AreaCard`.

**DEF-S2-5 — "a new branch cannot be added silently" does not hold for the realistic shape of a new branch. — File: `app/admin/business-os-llm/__tests__/ledgerPanel.render.test.tsx:78-142, 167-174` — Severity: Medium**
- §5.3b states the F-6 fix drives *"all five `LedgerReadingKind`s plus `cannot_check`, `failed` and `no_change`, eight in total, **with a count assertion so a new branch cannot be added silently**."*
- Measured: added a **sixth** `LedgerReadingKind` (`provider_outage`) to the union in `ledgerCheckCopy.ts` with its sentence, **without** adding it to `LEDGER_READINGS_WITH_COUNTS`. Result: **`Tests: 535 passed, 535 total`**, exit 0. The new branch is silently uncovered and `toHaveLength(8)` passes.
- Cause: `EVERY_BRANCH` derives only **three** entries, by spreading `LEDGER_READINGS_WITH_COUNTS`, and hard-codes the other five as literals. A new **count-less** kind therefore never enters the table — and count-less is precisely what **both** existing non-counted kinds (`ledger_cannot_answer`, `too_soon`) are, so it is the likelier shape of the next one. The assertion only bites for a new *with-counts* kind.
- This is the same family as F-1 and F-6: an assertion that reads as though it pins a property and does not.
- Fix shape: key the table off an exhaustive `Record<LedgerReadingKind, …>` so a new kind is a **compile** failure — both this test file and `LedgerCheckPanel.tsx` are inside `typecheck:bos-llm`'s scope (confirmed `caller` via `--list`), so the pin would be real rather than a number.

#### Should fix (accuracy of the record — no shipping code)

**DEF-S2-6 — §5.3's ESLint row is wrong; a file this slice created has a lint error. — File: `lib/business-os/llm/__tests__/adminSettingsView.wireTypes.test.ts:36` — Severity: Low**
- §5.3 (re-measured, 2026-09-24) claims *"`npx eslint` on every new and touched file → exit 0, **0 problems**"*. SA's gate table agrees (*"0 problems"*).
- Measured: `npx eslint lib/business-os/llm/__tests__/adminSettingsView.wireTypes.test.ts` exits **1**:
  - `36:15  error  Expected a 'const' assertion instead of a literal type annotation  @typescript-eslint/prefer-as-const` — on `const ok: true = true;`
  - plus three `no-unused-vars` warnings (`_Check` ×2, `_Reverse`), which are inherent to type-level assertions and are arguably fine.
- The screen's own ten source files, the three `tests/helpers/` files and the ledger route are genuinely **0 problems** (verified per-group, exit 0 each). `AdminSidebar.tsx`'s 3 warnings are pre-existing, as recorded. So the error is the one new-file finding, and the gate row overstates by claiming zero.
- Fix: `const ok = true as const;` (one line), and correct the §5.3 row.

**DEF-S2-7 — F-10's retracted claim survives in two other files. — Files: `app/admin/business-os-llm/components/LastChangedLine.tsx:30-31`, `app/admin/business-os-llm/types.ts:43-46` — Severity: Low**
- SA's F-10 asked for *"the column is nullable in the database and a row really can arrive without one"* to go, because nothing in the repo establishes it. It was correctly reworded in `adminSettingsView.ts:166-174`. The same unverified claim still reads in `LastChangedLine.tsx` (*"`updated_at` is typed `string` but the column is nullable (QA DEF-6)"*) and in `types.ts` (*"but a row really can come back without one"*).
- F-10 is therefore **partially** fixed: the next reader inherits the claim from whichever of the three files they open first, and two of the three are the ones a UI author opens.

**DEF-S2-8 — `LedgerCheckPanel`'s header claims more than the file does. — File: `app/admin/business-os-llm/components/LedgerCheckPanel.tsx:6-10` — Severity: Low**
- *"The panel writes no readings of its own … **Every sentence** comes from `lib/business-os/llm/ledgerCheckCopy.ts`."*
- The five **readings** and the caveat do. Three branches' text is written in the component: `CANNOT_CHECK_HEADINGS` (`:54-57`), the `No usable change time` heading and explanation (`:106-112`), the `This check does not apply here` fallback, `ledger-no-change` (`:181`) and `ledger-failed` (`:188`).
- The **split is correct** and is D-1's approved shape — a code for the machine, the route's sentence for the human, and the refusal's *explanation* does come from the route. Only the word "sentence" overclaims; "reading" would be exactly true.

**DEF-S2-9 — F-4's misreading survives in the file most likely to be opened next. — File: `app/admin/business-os-llm/types.ts:17-18` — Severity: Low**
- The wireTypes test's own header was properly corrected (it now names `typecheck:bos-llm` and states the repo-wide fact). But `types.ts` still says the wireTypes test *"fails to compile if the server's `AreaView` stops satisfying the type below"* without naming the gate — which is the precise sentence that led SA to measure F-4. A UI author reading `types.ts` still concludes `npm test` covers the duplication. It does not: QA reproduced 2/2 green under SA's M7 while `typecheck:bos-llm` failed with `1 new`.

**DEF-S2-10 — SA's ✅ on soft navigation between `/admin` siblings rests on a premise QA falsified. The conclusion survives; the stated reason does not. — File: the workplan's SA slice-2 path table (~line 1222) and `lib/admin/requireAdminPage.ts:26-29` — Severity: Low (documentation + latent hazard)**
- SA recorded escape E2 as *"Harmless here, **because the caller already passed the guard on entry to the subtree**."*
- Measured (P6/P7): an **unauthenticated** `curl` that simply supplies a crafted `Next-Router-State-Tree` claiming it is already inside `/admin` gets **200 with no `NEXT_REDIRECT`** — the layout is not re-rendered and `requireAdminPage()` never runs. The caller does not have to have entered the subtree; it only has to **say** it did, in a client-supplied header.
- Nothing leaks, and that is the part worth writing down: the payload carries only a reference to a public JS chunk, **and QA verified that all 22 `/admin` pages are `'use client'`** (every `app/admin/**/page.tsx` has the directive — checked, none missing), so no admin page has server-rendered data to leak, and both `GET`s answer **401**.
- So the real guarantee is *"every admin page is a client component **and** every admin API is `requireAdmin`-gated"* — two properties, **neither of which is asserted anywhere**, and the first of which a future server-component admin page would silently break. Worth one line in the admin-authz workstream beside F-2, and worth knowing before slice 3.

#### Edge cases (nice to fix)

1. **DEF-S2-2 — the guard's *position* is unasserted.** `if (process.env.NODE_ENV === 'development') return <AdminChrome>{children}</AdminChrome>;` above the call leaves **115/115** green. Contrived (and inert in production, where `NODE_ENV` is `production`), but it is OI-20's *"the guard proves present, not first"* landing in the one file where `requireAdminPage` actually lives. The same "first statement" assertion that fixes DEF-S2-1 closes this for free.
2. **Two `cannot_check` sub-states are never rendered by any test.** `since_in_future`'s heading and the unknown-code `This check does not apply here` fallback share `cannot_check`'s JSX, so the no-green/no-tick property holds for them by construction — but the F-9 retry logic (`retryable: reason !== 'too_long_ago'`) is only exercised on one of the two branches it distinguishes.
3. **Collapsing and re-expanding a card refetches the ledger.** Free today (the `too_long_ago` refusal precedes any DB read), a real cross-tenant read once rows are fresh. SA already flagged it for slice 3.
4. **The operator must expand all eight cards to learn which areas the ledger cannot see.** SA ruled that enumerating them on the collapsed card would breach FR-6, so this is by design — but it is the practical cost of DEF-S2-3's fix being a conditional rather than a list.

---

### 14.23 What QA could and could not see

**QA could see the page render.** Not in a browser — Playwright is not installed (CLAUDE.md § Testing) — but in three independent ways:

1. **`next start` + `curl`**, which proved the guard runs and fails closed, and that nothing leaks.
2. **jsdom, the full `page.tsx` with a stubbed `fetch`**, rendering all eight cards; QA read the complete rendered text of the page, of the chat card expanded, and of the onboarding card. DEF-S2-3 and DEF-S2-4 are quotations from that output, not inferences from `copy.ts`.
3. **The build's route table and app manifest**, confirming the page is emitted and dynamic.

**Left for the user to check by eye** — none of it is behavioural, all of it is visual, and none of it can invalidate the defects above:

- **Colour and contrast.** D-2's local `Chip` claims the `/admin` palette because `badge.tsx`'s `outline` variant depends on `--v2-border` / `--v2-text-secondary`, declared only in `app/v2/globals-v2.css`, which `/admin` does not load. QA verified the *reasoning* at source and that no green/emerald class reaches the ledger panel, but **whether the six chip tones are legible against the slate cards is a visual judgement**.
- **Whether the banner is actually read before the cards.** It is DOM-ordered above them (`page.tsx:107-109`), which is what FR-17 asks. Whether it survives a skim at 2am on a real monitor — the thing DEF-S2-3 and DEF-S2-4 are about — is worth ten seconds of the user's eyes.
- **Layout at width.** `sm:grid-cols-2 lg:grid-cols-4` for the four call fields, and `truncate` on the collapsed model summary; an eight-card page with long call names was never rendered at a real viewport.
- **That the sidebar entry looks right** under System Config with the `Bot` icon.
- **The live data.** Every card will read *"Configured: on"*, *"actor not recorded"* and *"Too long ago to check"* against the real seed — correct, measured, and the exact combination DEF-S2-3 is about.

---

### 14.24 Test outputs

```
typecheck-bos-llm: 231 files in scope, 28 errors, 0 new (89.3s)            -> passed
check-bos-llm-literals: 43 files in scope, 2 exempt, 0 violations (23.7s)  -> passed
check-bos-llm-literals --list: 43 in scope, 2 exempt, 1 included by name   (unchanged)
lint:hooks: (no output), exit 0
build: OK, exit 0;   f /admin/business-os-llm   6.8 kB   94.7 kB
jest (4 touched paths + admin-authz-surface.guard):
  Test Suites: 26 passed, 26 total
  Tests:       609 passed, 609 total
  Snapshots:   23 passed, 23 total
npx eslint (new + touched):  1 error, 6 warnings    <- DEF-S2-6
```

Guard mutations (both suites, 115 tests at rest):

```
G1 line-comment                    exit=1  1 failed, 114 passed   CAUGHT (F-1 fixed)
G2 block-comment                   exit=1  1 failed, 114 passed   CAUGHT
G3 after-early-return              exit=0  115 passed             NOT CAUGHT -> DEF-S2-2
G4 await-dropped                   exit=1  1 failed, 114 passed   CAUGHT
G5 try-catch-swallow                exit=0  115 passed            NOT CAUGHT -> DEF-S2-1
G6 hand-rolled AdminAccessService  exit=1  1 failed, 114 passed   CAUGHT
G7 result-assigned-unused          exit=0  115 passed             correct (guard still runs)
```

Panel / copy mutations:

```
M-A sixth LedgerReadingKind (no counts)  exit=0  535 passed        NOT CAUGHT -> DEF-S2-5
M-B RC-D heading text-green-400          exit=1  1 failed          CAUGHT (F-6 fixed)
M-C tick glyph in a reading sentence     exit=1  1 failed          CAUGHT
M-D panel writes its own reading         exit=1  4 failed          CAUGHT
M-E caveat dropped                       exit=1  3 failed          CAUGHT
M7 revert the DEF-6 widening             typecheck exit=1, 29 errors, 1 new, TS2344
                                         jest wireTypes: 2 passed  <- F-4's fact, reproduced
```

Unauthenticated probes against `next start -p 3123`:

```
P1 GET /admin/business-os-llm           200  NEXT_REDIRECT present, 0 page strings, 0 settings words
P2 RSC: 1                               200  NEXT_REDIRECT present, 0 settings words
P3 RSC + Next-Router-Prefetch: 1        200  bare tree, null children
P4 GET /api/.../llm-settings            401  {"success":false,"error":"Unauthorized"}
P5 GET /api/.../llm-settings/ledger     401  {"success":false,"error":"Unauthorized"}
P6 RSC + crafted Next-Router-State-Tree 200  NO NEXT_REDIRECT  <- guard not re-run; 0 settings words
P7 same, deepest segment                200  NO NEXT_REDIRECT, 739 bytes, 0 settings words
```

---

### 14.25 Final status

**Counts: 46 PASS · 7 FAIL · 2 PARTIAL · 1 BLOCKED. No High-severity defect is open.**

The page itself is right, and it is right about the hard things: the FR-6 boundary is real and independently pinned, the fail-open notice is undismissible **by construction** (verified at source *and* in the rendered DOM), FR-14's three states are three different sentences driven correctly from the real server function, `at: null` cannot produce a 1970 anywhere in the screen because one formatter is the only date path, RC-D is a neutral first-class state, the ledger panel has no success affordance in any of its eight branches, chat's short-circuit is server-side and the client provably knows nothing about which areas the ledger can see, and **nothing in this slice writes**. F-1's fix bites, F-6's fix bites, and F-4's pin is real in the gate it now correctly names.

What fails is the same thing that failed SA's review, one layer further in: **two assertions that read as though they pin a property and do not** (DEF-S2-1, DEF-S2-5), and **two sentences in the feature's most important copy that are untrue in the state every card is in on day one** (DEF-S2-3, DEF-S2-4).

- [ ] **Do not ship as-is.** Fix **DEF-S2-1** (one line — assert the guard is the first statement, which also closes DEF-S2-2), **DEF-S2-3** (either one boolean on the route's refusals, or soften two sentences to the conditional), **DEF-S2-4** (render the inline notice only when `area.switchable`) and **DEF-S2-5** (key the branch table off an exhaustive `Record<LedgerReadingKind, …>`). None is large; three are one to three lines. Then re-run the five screen suites, both guard suites, and `typecheck:bos-llm`.
- [ ] **DEF-S2-6 … DEF-S2-9** are a one-line lint fix and three comment corrections — take them in the same pass while the files are open; do not re-open the cycle for them.
- [ ] **DEF-S2-10 goes to the TL/user with F-2**, as one item on the admin-authz workstream: the `Admin authz surface guard` cannot see the removal of the guard (F-2, reproduced here four times), the compensating assertion has two blind spots (DEF-S2-1, DEF-S2-2), and the E2 escape is reachable by a crafted header — harmless only because **all 22 admin pages happen to be client components**, which nothing asserts.
- [ ] **For the test-tiering workplan, unchanged and re-confirmed by measurement:** no test in this repo fails on a type error. `typecheck:bos-llm`'s scope is the only place a type-level assertion is alive — and two screen files (`LedgerCheckPanel.tsx`, `ledgerPanel.render.test.tsx`) are in it as `caller`, which is worth knowing when writing the DEF-S2-5 fix.
- [x] **The user should look at the rendered page** before RM commits — §14.23 lists the five visual things QA could not judge, and DEF-S2-3/DEF-S2-4 are exactly the kind of thing a second pair of eyes confirms in ten seconds.

---

## 15. Commit Info

*(RM populates this section. Nothing has been committed from this worktree.)*

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-24 | **SA re-check of slice 2 — 🔄 Fix Required: one clause and one doc claim, no code change** | All seven gates re-run by SA (`typecheck:bos-llm` 231/28/0 new; literals 43/2/0; `lint:hooks` clean; `npx eslint` **0 problems, exit 0** — S2-6 genuinely fixed; `build` exit 0 with the page in `app-build-manifest.json`; jest **28 suites / 636 tests** over the touched paths plus `lib/admin`, a superset of the Dev's 26/621). **The first-statement property is a genuine improvement, honestly built** — comments stripped, statement terminated at `;` **or `{`** so a `try {` opener fails, `null` on an unrecognisable signature, and proved against five synthetic layouts that must be REJECTED, which is the part such tests usually skip. QA's two mutations are closed. **But SA found three shapes that still satisfy it, all 122/122 green:** `process.env.ADMIN_STRICT && (await requireAdminPage());`, the ternary form, and a locally shadowed no-op `requireAdminPage` (the assertion pins the call's shape, not its identity). The first two are the *same intent* as QA's early-return mutation expressed differently, so they are not exotic. **Nothing leaks by any of them** (the page is `'use client'` with no server props, both `GET`s are `requireAdmin`-first), so this is recorded, not blocking — but the honest conclusion after three rounds of regex is that the property that matters is **behavioural**: one test that renders `AdminLayout` with a non-admin and asserts `NEXT_REDIRECT` is immune to all five known mutations and all three of SA's. That belongs on the admin-authz workstream, not in this diff. **R-1 (must fix, doc): the OI-20 closure claim is wrong.** Read at source (`admin-authz-unification.md:1506`, `ADMIN_IDENTIFICATION_AND_ACCESS.md:190`), OI-20 is the precedence gap over the **38/65 gated API route handlers** and carries QA's refinement that closing it needs **the oracle instrumented for the body parse**. Slice 2 asserts precedence in **one file**, for a **different** guard, from a **feature** suite that is not a required check, and touches neither the handlers nor the oracle. The workplan's own earlier wording at `:2037` was precise ("landing in the one file where `requireAdminPage` actually lives"); the Change History compressed it into closure. This matters because OI-20 carries an SA condition that it is **the first thing built when the parked slices resume** — a row saying it is closed is how that condition gets discharged without the work. Correct both places to the page-layout half only. **R-2 (must fix, one clause): the S2-3 fix reintroduced the defect it was fixing.** `FAIL_OPEN_ACTION` now says the LLM Usage tab "shows the calls per area **for any period**". Measured at `lib/business-os/usage/llmUsageVerification.ts:61,:89-102`: **`MAX_WINDOW_MS` is 7 days and it is REFUSED, not clamped** (*"the maximum window is 7 days"*), and **`accountId` is required** — the report is **per business**, while the switch is fleet-wide. The runbook it summarises is careful where the copy is not ("per area and per call", "per area and per business" — never any period). So the page again names a verification path it cannot support, in the fallback an operator reaches for **precisely when the 24-hour check has turned them away**. The unbounded path is runbook §5's SQL; the tab is the convenient path within 7 days, per business. Say that. **Otherwise the copy is now right, and SA's earlier judgement is formally overturned:** QA applied the better test — not "is each claim true?" but "can the action be carried out on the day the page ships?" — and SA has adopted it. *"Expect to be turned away often"* makes a refusal the predicted answer rather than a dead end, and F-8's parenthetical closes the runbook §5 warm-cache gap without softening the warning. **Length: 178 words in the banner, at the edge** — SA's ruling is to change the ORDER, not cut words (headline → action → quiet why, since `FailOpenNotice.tsx:55-57` currently puts 85 words of mechanism between the two sentences a skimmer must read). Low, presentational, **explicitly not re-opening a cycle for it**. **Rulings: the onboarding card ✅ right call** — the contradiction is gone, the banner above every card still carries the fleet-wide warning so nothing is lost, and `LOCK_AREA_FAIL_OPEN` is not reassurance but the same hazard re-stated about the field that area can actually change. **The exhaustive `Record` ✅ approved, both pins verified independently by SA** — a sixth kind fails the runtime keys-equality assertion (1 failed / 19 passed) **and** `typecheck:bos-llm` (`TS2741`, 1 new); two genuinely independent mechanisms, the second existing *because* of F-4, which is the right response to "no test here fails on a type error". `isKnownReason` also closes SA's untyped-index optimisation. **P6/P7 ⚠️ recording is NOT enough for one of the two properties.** QA falsified an SA premise — "the caller already passed the guard on entry" is false, it only has to *say* it did — though the conclusion survives on the other reason SA gave in the same table. "Every admin API is `requireAdmin`-gated" is adequately recorded (R1 + published census). **"All 22 admin pages are `'use client'` with no server props" is not:** it is load-bearing for an already-demonstrated **unauthenticated** request, it breaks **silently** (the next Server-Component admin page leaks its payload with no test failing), and it is **nearly free to assert** — the guard's scanner already computes `isClient` per file (`:1567`). It must be escalated as a named item with the exploit and the one-line fix, and logged in the access doc § Known gaps beside OI-20, not left as a footnote in a feature workplan. **Verdict: ready for the user's eye once R-1 and R-2 land** — a string and a doc row; no code change, and no further SA pass needed. |
| 2026-09-24 | **QA tested slice 2 — 46 PASS / 7 FAIL / 2 PARTIAL / 1 BLOCKED, no High open, NO-SHIP as-is** | Every gate re-run verbatim (`typecheck:bos-llm` 231/28/**0 new**; literals 43/2/**0**, `--list` and both gate scripts **byte-identical to `origin/main`**; `lint:hooks` clean; `build` OK with `ƒ /admin/business-os-llm 6.8 kB`; jest **26 suites / 609 tests** incl. the required `admin-authz-surface.guard`). **The guard was attacked with seven mutations, not reasoned about:** F-1's fix **bites** (SA's comment-out and a block comment both now fail), `await` dropped and a hand-rolled `AdminAccessService` are caught, and **F-2 was reproduced four times** — the required guard stayed green every time, so slice 2's assertion really is the only thing standing. **Two mutations are NOT caught: `try { await requireAdminPage(); } catch {}` (DEF-S2-1) and the call placed after an early return (DEF-S2-2), both 115/115 green** — and the try/catch is the hazard `layout.tsx` names in its own comment. **No settings data leaks by any path**, proved on a real `next start` server with unauthenticated `curl`: HTML, direct RSC payload and prefetch all carry `NEXT_REDIRECT` and **zero** settings words, both `GET`s answer **401**, no route handler, no server action. But a crafted `Next-Router-State-Tree` gets the page's RSC segment with **no redirect at all** — so SA's “the caller already passed the guard” premise is false (DEF-S2-10); the conclusion survives only because **all 22 admin pages are `'use client'`**, which nothing asserts. **The copy was read as an operator:** undismissible **by construction** confirmed in the rendered DOM (0 buttons, export surface is one name), no fleet overclaim, F-3's chat falsehood gone — but the inline notice and the banner **promise a ledger-reach answer the panel gives in only 1 of its 8 states**, and `too_long_ago` is the state **all eight cards** are in on day one (DEF-S2-3), and on `onboarding` the notice sits one line above “This area can never be switched off” (DEF-S2-4). **FR-14 driven through the real `lastChangedByFor()`:** states 1 and 3 render correctly, `at: null` cannot produce 1970 anywhere (one formatter is the only date path, and it catches `''` too), `(time not recorded)` is unreachable from a legitimate row, and SA's M7 confirms the pin is real in `typecheck:bos-llm` while jest stays green. **Ledger panel:** all eight branches drive the strong no-green / no-tick / no-success assertion and four mutations bite — but **a sixth count-less `LedgerReadingKind` leaves 535/535 green**, so “a new branch cannot be added silently” is false for the likelier shape (DEF-S2-5). **Nothing writable confirmed** (no form, no `onSubmit`, two bare `GET`s, one `disabled readOnly` input, nothing pre-empting slice 3). §5.3's “`npx eslint` → 0 problems” is **wrong** — `adminSettingsView.wireTypes.test.ts:36` errors on `prefer-as-const` (DEF-S2-6). Ship after DEF-S2-1, -3, -4, -5 (one to three lines each). |
| 2026-09-24 | **QA slice-2 defects closed — DEF-S2-1 … S2-9, and S2-1 was the one that mattered** | **The guard assertion had two more holes, and both were green at 115/115.** QA disabled it with `try { await requireAdminPage(); } catch {}` — the hazard `app/admin/layout.tsx` names in its OWN comment, since `requireAdminPage` redirects by throwing — and again by putting an early `return` above the call. F-1's shape match proved the call EXISTS, not that it can fail the request. The asserted property is now **the guard is the FIRST statement of the component body**, terminated at `;` or `{` so a `try {` opener fails, proved against five synthetic layouts (deleted, `//`-commented, block-commented, try/catch, early return) and failing rather than passing when the signature is unrecognisable. One property, four mutations, and **DEF-S2-2** — the guard’s position in this one file — closed for free. **This does NOT close OI-20 (SA R-1):** that is the precedence gap over the 38 gated API handlers and needs the oracle instrumented for the body parse; it keeps its SA condition to be built first when the parked admin-authz slices resume. Re-measured: try/catch **2 failed / 120 passed**; early return **1 failed / 121 passed**. **S2-3: the copy promised evidence the page cannot give on day one.** Both sentences pointed at the per-area ledger check, which answers the reach question in 1 of 8 states — and `too_long_ago` is the state of all eight cards on load, so the page said "confirm at the ledger" while every panel said "Too long ago to check". Both now state the 24-hour limit up front and name the fallback that works for a change of any age: runbook §5's log lines and the **LLM Usage tab on `/test-business-os`**. No per-area hardcoding, so FR-6 holds; the `ledgerCanSeeArea` payload option is deliberately deferred to slice 3 with D-3/D-8's field. **S2-4: the onboarding card contradicted itself** — the fail-open notice sat one line above "can never be switched off". The notice now renders only for a switchable area; the locked one gets its own line saying what IS true there (a read failure still puts its calls back on the code-default model, which is that area's only cost lever). **S2-5: the branch table missed the likelier shape of a new branch** — a sixth count-less reading kind left 535/535 green. It is now an exhaustive `Record<LedgerReadingKind, Branch>` with two independent pins (`TS2741` under `typecheck:bos-llm`, which has the file in scope, plus a runtime keys-equal-`LEDGER_READING_TEXT` assertion, because no test in this repo fails on a type error); QA's own mutation now fails both. Nine branches are driven, including both `cannot_check` sub-states and the unknown-code fallback, and the retry rule is exercised on both sides. **Lows:** S2-6 the one lint error this slice introduced is gone and the two gate rows that claimed "0 problems" are corrected to say they were wrong; S2-7 F-10's retracted schema claim removed from the two remaining files; S2-8 the panel header says "every reading" and names what it does write; S2-9 `types.ts` now names `typecheck:bos-llm` as the pin and says plainly that jest does not catch it. **Recorded, not fixed (§5.3c):** QA's P6/P7 — a crafted `Next-Router-State-Tree` header returns 200 with no redirect and the guard never runs, harmless **only** because (1) all 22 admin pages are `'use client'` with no server props and (2) every admin API is `requireAdmin`-gated — two unasserted properties, the first of which a future server-component admin page would break silently. With **F-2** and **S2-10** it goes to the admin-authz workstream, not into this diff. Gates re-run verbatim: `typecheck:bos-llm` **231 / 28 / 0 new**; `check:bos-llm-literals` **43 / 2 / 0**, `--list` unchanged; `lint:hooks` clean; `build` exit 0 with `ƒ /admin/business-os-llm`; jest **26 suites / 621 tests** including the required authz-guard suite (the screen's five are 92); `npx eslint` **0 problems** on every new and touched file. |
| 2026-09-24 | **SA slice-2 fixes applied — F-1, F-3, F-4, F-5, F-6 and every Low item** | **F-1 (High) was the one that mattered: the guard assertion read `app/admin/layout.tsx` RAW, so commenting the call out left 114/114 green with all 22 admin pages open.** It now runs through `codeOf()` and matches the CALL as a shape (`/await\s+requireAdminPage\s*\(\s*\)/`), with a second test proving the RULE itself — an import line, a `//`-commented call and a `/* */`-commented call are each asserted not to match, a real call is asserted to match. Re-measured: SA's exact mutation now gives **1 failed / 114 passed**; deletion fails too. **F-3 (High): the banner's evidence claim is scoped, not enumerated** — *"check first that the ledger can see the area at all: each card's ledger check says whether it can answer, and for some areas it cannot. Where it can, no new calls is the only evidence you will get"* — because the old sentence was false for any area the ledger cannot see, and naming chat would have put a per-area fact in the browser bundle (FR-6). The unscoped sentence is asserted **absent** so it cannot come back; the inline form carries the same scope plus the runbook pointer (F-7). **F-4: the wireTypes header no longer claims ts-jest type-checks it** — it names `typecheck:bos-llm`, which does (`TS2344` on the DEF-6 revert), and records the repo-wide fact that **no test in this repo fails on a type error**. **F-5: the second deviation is declared as D-8** (the requirement's "Area settings" section), disposed of with D-3 under SA's ruling that **slice 3 adds the payload field, never a doc link**. **F-6: "no green in any branch" now drives all eight branches** — five reading kinds plus `cannot_check`, `failed` and `no_change`, with a count assertion so a ninth cannot appear silently — asserting no green/emerald class anywhere in the panel's HTML, no tick glyph and no success wording; SA's green-heading mutation now fails, naming the RC-D branch. **Lows:** F-7 comment corrected ("always" belonged to the banner) and the pointer added; F-8 `FAIL_OPEN_BODY` now says *"on startup"* and carries the last-good case runbook §5 distinguishes; F-9 `Check again` disabled on the monotonic `too_long_ago` branch, `reason` narrowed through a type guard; F-10 the DEF-6 comment reworded to what the repo can establish (hand-written type, no `CREATE TABLE` here, defensive and pinned by a test); F-11 counts fixed (**7 components / 15 files**) and "21 pages" → **22** in `layout.tsx` and `requireAdminPage.ts`. **F-2 NOT fixed, by instruction** — R6 of the required `Admin authz surface guard` is satisfied by the import, the same hole one level up, and it changes the gate the whole repo merges through; until the user rules, F-1's assertion is the only thing standing. Gates re-run verbatim: `typecheck:bos-llm` **231 in scope / 28 errors / 0 new (89.9s)**; `check:bos-llm-literals` **43 / 2 exempt / 0**, `--list` unchanged (1 included by name, no baseline regenerated); `lint:hooks` clean, exit 0; `build` exit 0 with `ƒ /admin/business-os-llm 6.8 kB 94.7 kB`; jest **26 suites / 609 tests** (the screen's five are 80), including the required authz-guard suite; `eslint` **0 problems** on every new and touched file. |
| 2026-09-24 | **SA code review of slice 2 — 🔄 Fix Required (three must-fixes, none large)** | All seven gates re-run by SA and all matching the Dev's numbers (`typecheck:bos-llm` 231/28/0 new, `check:bos-llm-literals` 43/2/0 with `--list` unchanged, `lint:hooks` clean, `build` exit 0 with the page in `app-build-manifest.json`, jest 5/71 for the screen and 25/526 across the touched paths, `eslint` clean). **Priority 1: the guard reasoning is sound on every path** — full load, direct RSC payload request, soft navigation into and within `/admin`, prefetch, route handler (none exists; R3 keeps it so) and server action (none) — and it is stronger than the Dev argued, because a `'use client'` page with no server props puts **no settings at all** in the RSC payload. **But F-1 (High, must fix): `source.guard.test.ts:130-133` reads the layout raw instead of through the `codeOf()` it already imports, so commenting the guard out passes it — SA measured 114/114 green with `// TEMPORARILY DISABLED: await requireAdminPage();` at `app/admin/layout.tsx:40`, i.e. all 22 admin pages open with every gate reporting pass.** Deleting the line outright *is* caught, so the hole is the realistic case. **F-2 (High, pre-existing, escalated):** R6 of the **required** `Admin authz surface guard` asserts only `toContain('requireAdminPage')`, which the import satisfies — it passed with the call deleted, so slice 2's test was the only thing catching it at all. **F-3 (High, must fix): the fail-open banner's *"no new calls for the area is the only evidence"* is false for chat** (`AIDataLayerService` writes no `token_usage` row), so it tells an operator switching chat off to draw exactly the false conclusion this feature exists to prevent; the correction lives only inside the chat card. Fix by scoping the claim, not by naming an area (FR-6 holds). **F-4 (Medium, must fix — comment only): the wireTypes test's stated mechanism does not exist** — ts-jest 29.4.5 under this `jest.config.js` emits no diagnostics (SA proved it with a blatant type error in a fresh file, and with the DEF-6 revert leaving jest 2/2 green). The pin is real but belongs to `typecheck:bos-llm`, which does fail with `TS2344`. Repo-wide consequence: **no test here fails on a type error.** **F-5 (Medium): an undeclared deviation** — the requirement's *"Area settings"* expanded-card row is not rendered either; same justification as D-3, accepted, but it must be declared. **F-6 (Medium):** the "no green in any branch" assertion covers only 3 of 5 branches — SA coloured the RC-D heading green and all 9 tests passed. F-7 to F-11 are Low (a comment overclaiming "always", `FAIL_OPEN_BODY` compressing runbook §5's warm-cache case, a futile `Check again` on `too_long_ago`, an unverified nullability claim in the DEF-6 comment, and "six components" / "21 pages" drift). **Rulings: D-1 ✅; D-2 ✅ with all three claims independently verified** (the `--v2-*` tokens are declared only in `app/v2/globals-v2.css`, `/admin` loads only `app/globals.css`, and `cn()` is a plain filter+join, not `tailwind-merge`); **D-3 ✅ deferred**, with SA's direction to add a payload field in slice 3 rather than link a doc; **D-6 ✅**. **Copy judgement: the fail-open notice is accurate, actionable, undismissible by construction, and does not overclaim about the fleet** — every claim is about the mechanism, never the present state — with the single exception of F-3. Standards clean: zero `console.*` in any touched file, Pino server-side, repository pattern untouched, Zod unchanged, no literal-gate false positive and no gate rule change. Nothing writable and nothing pre-empting slice 3, both confirmed at source. Nine mutations run by SA (the Dev's five plus four more); **two did not bite**, and became F-1 and F-6, with a third exposing F-4. `npm run lint` **does** need its own fix — `next lint` cannot read the flat `eslint.config.mjs`, so the repo has no working full-lint entry point — but as a separate one-line chore, not in this slice. |
| 2026-09-23 | **Slice 2 implemented — the read-only page, the first part of this work anyone can look at** | On `feature/business-os-llm-admin-ui-slice2`, off `origin/main` `d1e54bef` (slice 1 = PR #98). **Nothing writable: no form submits, two `GET`s, and every expanded card says so and points at the runbook.** **15 files under `app/admin/business-os-llm/` — 10 source (page, `types.ts`, `copy.ts`, `format.ts` and **seven** components) and 5 test files (71 tests, 80 after the SA fixes)** — two shared test helpers, and the sidebar entry beside System Config — **`app/admin/system-config/page.tsx` untouched, D-U1, its 20 `console.*` calls still out of scope and the trigger still recorded**. **FR-14's three states render as three different things** through one shared `LastChangedLine`: a resolved email, *"Last changed at Y — actor not recorded"* plus a sentence explaining that a change made before this screen or from the command line carries no name (**never** "see the audit trail" — S2-T7b: the seeded rows have no entry either), and **no line at all** when there is no row, where the card prints the FR-7 code-defaults line instead. That middle state is what **all eight** areas show today, which is correct. **QA DEF-6 closed at the boundary** (S2-T7c): `LastChangedBy.at` is now `string \| null` in `adminSettingsView.ts`, and one formatter returns `null` rather than `new Date(null)`'s 1970. **RC-D implemented as a first-class state:** the panel auto-runs on expand, the route's 400 now carries `reason: 'too_long_ago' \| 'since_in_future'` (deviation D-1, a purely additive slice-1 change so the client never string-matches a sentence DEF-5 already rewrote once), and it renders *"Too long ago to check"* in the neutral tone with the route's own explanation — **not an error**, which is the state every area is in today. **All five ledger readings come from `ledgerCheckCopy`'s constants**, the caveat is the shared string, no branch has a tick or a green class, and **chat is not special-cased client-side at all** — the route short-circuits it before any repository read, so the panel renders the kind it is handed and holds no knowledge of which areas the ledger can see (asserted at source). **The fail-open notice is undismissible by construction** (no `onClose`, no visibility state, asserted) and appears twice: a banner above the cards and one sentence beside every area's switch. **Deviations for SA: D-1** (the `reason` codes), **D-2** (local `Chip` instead of `components/ui/badge.tsx` — its `outline` variant is coloured by `--v2-*` tokens that `/admin` does not load, and `cn()` is a plain `join`, not `tailwind-merge`, so a `className` override is decided by stylesheet order), **D-3** (the requirement's *"What off means here"* section is **not** rendered — the payload carries no such field and a client-side per-area table would be the hardcoding FR-6 forbids; it needs either a payload field in slice 3 or a doc link). **D-6:** the five `LITERAL_RULES` and `codeOf` were extracted to `tests/helpers/bos-llm-literal-rules.ts` at their third caller, exactly as SA suggested; no rule changed. Gates: `typecheck:bos-llm` **231/28/0 new**; `check:bos-llm-literals` **43/2/0** with the `--list` set **unchanged** (no exemption, no new inclusion, no baseline regenerated); `lint:hooks` clean; `build` exit 0 with `ƒ /admin/business-os-llm` in the table; jest **25 suites / 526 tests, all green**; `eslint` 0 problems in every new file. **Five deliberate mutations** were run to prove the load-bearing assertions bite (delete the inline notice, render `new Date(null)`, colour the RC-D state red, add a client-side chat branch, import a server module + a model literal) — each failed exactly the test named for it, all reverted. ⚠️ `npm run lint` **cannot run in this repo** (`next lint` on Next 14 ignores the flat config and opens its interactive setup) — pre-existing, flagged for the TL, with `npx eslint <paths>` used instead. |
| 2026-09-22 | RM: recorded why the gate PR ships its inclusion list empty | §4.11. An inclusion entry cannot ship ahead of the file it names — `staleInclusions()` correctly treats a missing target as the rot it was built to catch. Split re-cut: #91 keeps the rule/discipline work with an empty list proved against a fixture; #92 adds the entry beside the route. |
| 2026-09-22 | **QA defects closed; slice 1 ready for the user's review** | **DEF-3 was the one that mattered, and the first fix for it did not work.** QA proved the equivalence suite blind in one direction: mutation **M2** (ask about the raw candidate, offer a normalised one) left it **15/15 green** while offering models a save refuses, because the assertion quantified over candidates and never over what is **offered**. Added **DIRECTION B** — every offered option, across four areas and every call, asserted acceptable to the guardrail — and **it still passed M2 on the first attempt**, because the fixture priced everything, so no normalised form could become unacceptable. Made the price mock **exact-match as production is** and added a candidate priced under one exact casing; **M2 now fails** (`offered: "openai:gpt-4o-uniq", acceptable: false`), the restored file is md5-identical to its backup, and the suite is 16/16. **DEF-1:** `since` gains an upper bound (2 min skew tolerance), so `2099-01-01` is refused rather than answered *"about 60 seconds"*. **DEF-2:** the `[200,400]` assertion — satisfied by every status — is replaced by the ordering it meant to pin (chat short-circuits **before** the bound, so an ancient `since` still gets 200 and still reads nothing). **DEF-4** AC-25's stale "cost sum" wording corrected; **DEF-5** the refusal copy now states the real reach (24 h change age, ≈48 h across both reads). **DEF-6** recorded as S2-T7c for slice 2. **DEF-7** written up standalone with its fix shape. **The owed insert-caller census is in §4.8: exactly three call sites, none passing the new argument** — `setMultiple` (which is how the Step 0 admin route reaches it) and the operator script — so the parameter is additive and unreached, `updated_by` is never written as null, and the one real change is the insert branch's explicit `updated_at`. Flagged while enumerating, **not fixed**: `SystemConfigService.set` bypasses the repository entirely and contradicts its own docstring. Gates: `177/31/0 new`; `43/2/0`, 1 included by name; build clean; jest **899/900**. |
| 2026-09-22 | **QA test report for slice 1 appended — ship recommended, 2 defects to fix in-slice** | **All four gates re-run by QA and reproduced exactly**: `typecheck:bos-llm` 177/31/**0 new**; `check:bos-llm-literals` 43 in scope, 2 exempt, 0 violations, `--list` showing 1 **included by name** with the exemption set byte-identical and the baseline untouched; `next build` exit 0; jest **895/896**. **The one red suite is pre-existing, proved by stashing the whole tree** (`git stash push -u` of all 21 paths, re-run at a clean `d9c60ab4`, identical `Today is 2026-09-21` vs `-22` diff, then popped). **It will NOT spread** — `Planner.ts:420` is the only snapshotted call site that stores a raw user message carrying a date, and every other snapshot hashes its system prompt — **but it will never heal**: the value is per **UTC day**, so the selection is red every day from now on and `-u` buys one. Escalated as DEF-7, for the TL. **The picker/validator equivalence was attacked against the REAL save path, not against `checkModelForCall`**: 8 areas × every call × 12 hostile `ai_model_pricing` shapes (padded id, zero price on one side only, an image model on a token call and the converse, a model priced for one image size but not all, a foreign provider, over-long and empty ids, NaN prices, reasoning models, non-string models), both directions, compared with `validateAreaRow`. **No divergence — 20/20 green.** The unconditional code default is safe because `checkModel` carries the same equal-to-default shortcut. **SA's 'near-tautological' judgement measured, and it is half right:** mutation **M1** (the exact pre-fix bug) turns the equivalence test red **only because** the fixture carries `' gpt-4o '` and an over-long id — the eight absolute siblings do carry the weight, as SA said. But mutation **M2** (ask about the raw candidate, offer a normalised one) leaves the suite **15/15 green** while offering a model a save refuses: the assertion quantifies over **candidates**, never over what is **offered**. **DEF-3**, one assertion to close. **Gate discipline proved by breaking it.** Each of the five `LITERAL_RULES` broken in turn: all five fail and name themselves (the three shape rules subsumed by the broad one exactly as the suite's own subsumption test records; isolating variants prove each narrow rule independently live). The **required** gate catches the same literals (exit 0 → 1 → 0). **RC-B:** renaming the route and moving it to a sibling folder both take the gate to **exit 1** with the stale-inclusion message — **red, not green**. **Ledger panel:** window offset exactly 60 000 ms from the imported constant, `before` the same length ending at the save, 'calls **completed**', a quiet area reads `no_traffic_either`, chat issues **zero** cross-tenant reads, `too_soon` reads nothing, no success affordance in any of the five strings, and `LEDGER_READINGS_WITH_COUNTS` partitions the union **exactly**. **`since` boundary:** exactly-24 h allowed, a hair over refused before any read, absent/empty/malformed/negative/epoch/no-designator/date-only/max-Date all 400. **RC-D CONFIRMED, measured:** the live seed `2026-09-21T10:14:08Z` is ≈29 h old, so a panel rendered on load **400s on all eight areas today** — slice 2 must render *'too long ago to check'*, never an error. **New defects: DEF-1 (Medium)** — `since` is bounded below but **not above**, so `2099-01-01` returns 200 `too_soon` with *'about 60 seconds'*, false by 73 years (no DB read; contained, but the route's own principle is refuse-never-guess and it should apply symmetrically); **DEF-2 (Low)** the chat-ordering test asserts `[200,400]`, which every status satisfies; **DEF-3 (Low)**; **DEF-4 (Low, doc)** AC-25 still says *'and cost sum'* after RC-6 dropped it, so as written it cannot pass; **DEF-5 (Low)** the refusal copy says 24 h while the union of both windows reaches ≈48 h; **DEF-6 (Low)** `lastChangedByFor` can emit `at: null` against a `string` type, for slice 2. **51 PASS / 2 FAIL / 1 PARTIAL / 0 BLOCKED, no High open. Ship slice 1 with DEF-1 and DEF-3 fixed in-slice.** Still owed before merge: §4.8's enumeration of every **insert** caller of `SystemConfigRepository.set` in the PR description. QA restored the tree exactly (all probe suites deleted, mutated file md5-identical to its pre-mutation backup); the stash round-trip rewrote working-tree line endings to CRLF under `core.autocrlf=true`, with **no** whitespace churn in `git diff --numstat`. |
| 2026-09-22 | **SA re-check closed (RC-A — RC-D); slice 1 approved for QA** | **RC-A:** two of S1-T12's five regexes were **dead** — template literals ate the escapes, so `case\s+` became `/cases+/` and the switch-on-a-model rule could never fire; coverage survived only because the broad quoted-literal rule happened to subsume those shapes. Rewritten as a named `LITERAL_RULES` table with `String.raw`, **each rule asserted against a sample it must match**, so every rule is proved alive independently of whether the files are clean. A further test **measures** the subsumption instead of leaving it as folklore — it is **all three** shape rules, not two, which is precisely why the breakage hid. **RC-B:** the inclusion list gained the discipline `EXEMPTIONS` already had — an **equality cap**, and a **hard gate failure** on an entry naming a file that is not in scope (`staleInclusions`), because otherwise a rename drops the route back out of scope with a **green** gate, the exact failure the list exists to prevent; plus tests that the inclusion is load-bearing and that the predicate can only ever add files. **RC-C:** the global `AreaView.allowedProviders` is **removed** — two answers to one question is how the picker bug happened, and the per-call list is authoritative. **RC-D** recorded for slice 2 beside FR-18: the 24 h bound makes the ledger panel a **post-save affordance**, and with every row carrying the 2026-09-21 seed a panel rendered on load would 400 on every area — it must render as *"too long ago to check"*, never as an error. **Slice 3 conditions recorded:** catch on Postgres **`23503` plus the constraint name** (never a substring, never a pre-emptive two-statement write, which would open a new-value/old-actor window), and — because the fallback makes RC-1's "no actor ⇒ break-glass" inference unsound — the card copy stays at *"actor not recorded"* with the **critical audit entry as the only discriminator**. Gates re-measured: `177/31/0 new`; `43 in scope, 2 exempt, 0 violations`, 1 included by name, exemptions byte-identical, baseline untouched; build clean; jest **895/896**. **The gate PR must land with or before slice 1.** |
| 2026-09-22 | **SA re-check of slice 1 — ✅ Code Approved for QA** | All seven must-fixes verified applied, and findings 1–3 correctly diagnosed as **one** bug fixed at the root: the new `checkModelForCall` runs the resolver's own `checkProvider` **and** `checkModel`, so the picker now answers with the four shape rules and the **per-call** `allowedProviders` in force, the global pre-filter is gone, and `allowedProvidersByCall` ships in the payload. **Gates re-run by SA**: `typecheck:bos-llm` 177 / 31 / **0 new**; `check:bos-llm-literals` **43 in scope, 2 exempt, 1 included by name, 0 violations**, with `--list` showing the exemption set byte-for-byte unchanged and the baseline never regenerated; `next build` exit 0 with both routes; jest **884/885** including `scripts/`, the one failure being the dated snapshot already confirmed pre-existing. **Ruling on the two functions: approved** — both exports are different-length prefixes over the same private `checkTokenModel`/`checkImageModel` chain, so no rule is restated; `checkModelAcceptable` genuinely cannot be expressed via `checkModelForCall` because the latter's code-default shortcut would short-circuit the very thing the defaults proof tests, and the decisive evidence is the caller census — `checkModelAcceptable` now has exactly **one** caller in the tree, the T1-3 test. Residual risk is naming, not logic. **The equivalence assertion alone is near-tautological** (production and test call the same function, so it catches wrong arguments, a pre-filter in front of the ask, and misuse of the verdict — the class of both bugs found — but not substitution); it is not carrying the weight, because eight sibling assertions are **absolute** and each would have failed under the rejected code. **Refuse-over-clamp approved**, and for a stronger reason than stated: a clamp keeps the caption *"since your change"* over numbers that are not, which is K-1's overclaim in its most dangerous form. **The gate PR is approved and must land with or before slice 1**, not merely before slice 2 — `literalScope()` gains a **disjunct**, so scope can only grow and the worst case is the gate going red for a real reason; but it ships with two conditions (**RC-B**): mirror the `EXEMPTIONS` equality cap, and fail loudly on a stale inclusion, because a rename would otherwise drop the route back out of scope **with a green gate**. Four delta findings, none in shipping code: **RC-A** two of S1-T12's five regexes are dead from template-literal escape loss (`case\s+` compiles to `cases+`) — coverage survives only because the broad quoted-literal rule subsumes them; **RC-B** above; **RC-C** `AreaView.allowedProviders` still ships the global list beside the authoritative per-call one; **RC-D** the 24 h bound makes the ledger panel a **post-save affordance** — all eight rows already carry the 2026-09-21 seed, so a panel rendered on load from `updated_at` would 400 on every area from day one, and slice 2 must render that as "too long ago to check", never as an error. The `Promise.all` was confirmed **not** to alter failure semantics — the per-area work does no per-area read and the builder was all-or-nothing before and after. **Slice 3's new user decision sanity-checked and accepted** with two conditions: separability must be catch-and-retry on Postgres `23503` plus the constraint name (never a message substring, and never a pre-emptive two-statement write, which would make every normal save two round trips and open a window where a reader sees the new value beside the previous actor); and the fallback makes RC-1's *"no actor ⇒ break-glass"* inference unsound, so the copy must stay at *"actor not recorded"* and the `critical` audit entry — written after the settings write, unable to fail it — becomes the only place the two doors can be told apart. |
| 2026-09-22 | **SA slice-1 must-fixes applied; D-U2 recorded** | **All seven must-fixes done** (§4.6). Three were one problem — *the picker was wider than the validator*: it pre-filtered on the **global** provider list while claiming `checkProvider` was the gate (it was never called), and asked `checkModelAcceptable`, which skips the four model **shape** rules — so an operator-editable `ai_model_pricing` row like `' gpt-4o '` would have been **offered in the picker and refused on save**. Fixed by exporting **`checkModelForCall`** (the resolver's own `checkProvider` + `checkModel` for that call) and asking it per candidate × call; `checkModelAcceptable` is untouched because its own job needs the "equal to the default" shortcut bypassed. `modelOptions.ts` gained its missing suite (**15 tests**), whose central case asserts offered ≡ `checkModelForCall(...).ok` for every candidate and call. **`too_soon` is now a first-class reading** in the shared copy module (plus `LEDGER_READINGS_WITH_COUNTS`); **`since` is bounded** at 24 h and **refused rather than clamped**; the route header no longer states the opposite of D-11; and **S1-T12 was strengthened and mutation-proved** — a `'claude-3-5-sonnet-20241022'` literal passed all five old assertions and now fails — with its file list derived by walking the folders. **D-11 implemented as ruled:** `LITERAL_SCOPE_INCLUSIONS` in `literalScope()`, the mirror of `EXEMPTIONS`, printed as `included` — scope 42 → **43**, exemptions still **2**, no baseline regenerated, transitive closure rejected. SA's optional 8—10 also taken. **User decision D-U2 recorded for slice 3:** an `updated_by` FK violation must **not** fail the save — retry without the actor, leave `updated_by` null, audit at `critical` with the believed actor and `details.door`, and tell the admin on screen; **S3-T17 rewritten** (its earlier "refuse and classify" form must now fail) and **S3-T18 added** for separability, with §3.6 recording that the row's `value` must never be a function of whether the actor resolved. Later-slice plan edits: **S4-T8 re-specified** to assert the intended difference rather than identity, **S4-T9** added for the `--file` path where FR-11 is bypassed today, and **S2-T7b** so the state-2 copy does not point at an audit trail that is empty for the seeded rows. |
| 2026-09-22 | **SA code review of slice 1 appended** | 🔄 **Fix Required — not approved for QA.** All four gates **re-run by SA** in the worktree and reproduced exactly (`typecheck:bos-llm` 176 / 31 / 0 new; `check:bos-llm-literals` 42 / 2 exempt / 0; `next build` exit 0 with both route artefacts emitted; jest 739/740), and `git status scripts/` clean — no exemption added or widened, no baseline regenerated. **The single red suite is confirmed pre-existing and unrelated**: the snapshot at `callParams.boundary.step3.test.ts.snap:44` hard-codes `Today is 2026-09-21` and neither it nor its test is in this diff. **Seven must-fixes**, all local: `modelOptions.ts` has **no test at all** (it is mocked out in `adminSettingsView.test.ts`, so S1-T7 and AC-7 are unmet); the picker restates the **global** provider list instead of asking the per-call `policy.allowedProviders`, and asks `checkModelAcceptable` rather than `checkModel`, so it can be **wider** than the validator on a malformed pricing row — both are D-1 drift in the one module that claims to have removed it; `too_soon` is a **fifth** ledger reading produced inline in the route and absent from `LedgerReadingKind` / `LEDGER_READING_TEXT`, breaking D-9's one-string guarantee on the branch slice 2 consumes; `since` is **unbounded**, so one URL orders two full-table cross-tenant counts; the main route's header claims it is inside the literal gate when D-11 correctly says the opposite; and S1-T12's regexes miss whole model families (`claude-*`, `mistral-*`, `kimi-*`) with a hand-maintained file list. **Q-8 APPROVED** — verified at `modelSettings.ts:663-673`: a locked call accepts `enabled: true` silently and refuses `enabled: false` as `locked`, so the script's filter really would name `chat/planner`, refuse the switch-off, and then fail `validateAreaRow` on the `--include-calls` retry. The predicate is right, the script is wrong, and slice 4's adoption changes operator-visible behaviour in exactly that corner — as a **bug fix** — subject to re-specifying S4-T8 (it currently asserts *identity*, which must now fail) and to covering the script's `--file` path, where FR-11 is bypassed entirely today. **Q-9 APPROVED** — the fifth parameter is a default argument evaluated per call, so existing callers are byte-identical, and provenance is **write-only** inside `evaluateAreaRow`; the resolver's hot path pays one `Map` and one four-key object per call, allocation not logic. Caveat recorded: `provenance` is now on the public `AreaEvaluation` contract that all 22 live sites carry, and that must not become a precedent. **D-11 ruled: the source test is NOT an adequate substitute for the gate** (hand-enumerated regexes narrower than the gate's AST rules; hand-maintained file list; and jest is not a required check on this repo). The fix is the narrow rule change the gate's own header prescribes — an explicit **inclusion** list in `literalScope()`, the mirror of `EXEMPTIONS`, naming the route into scope — **never a file exemption**, and a transitive-closure scope is explicitly rejected as it would turn 42 files into hundreds. Also raised for later slices: **S3-T17 is insufficient** — an FK violation on `updated_by` should make the save **retry without the actor** and audit at `critical`, because FR-24's own principle is that missing attribution never blocks an emergency. Confirmed correct and not to be re-litigated: K-11 is untrippable in slice 1 (no caller passes `opts`), null-everywhere **is** RC-1's state 2 by construction, both R-1 guards, the cross-tenant aggregate's naming/logging/exposure, the window arithmetic against the imported 60 s constant, the chat short-circuit before any read, and the evidence panel's inability to degrade into a green tick. |
| 2026-09-22 | **Slice 1 implemented (uncommitted)** | **RC-10 answered first, live and read-only:** `system_settings_config.updated_by` **exists**, is **`uuid`**, nullable, **null on all eight rows** — and carries a **foreign key** (rendered by PostgREST through the `user_settings_complete` view); both active admins satisfy it (2/2). Recorded as **G-18**; the FK is new risk **K-11**. Built: the `GET` route, the ledger route (two windows, three readings, chat short-circuited before any read, plus a `too_soon` branch), `adminSettingsView.ts` (both R-1 guards, RC-1's three FR-14 states, provenance serialised per RC-2a), `modelOptions.ts`, `switchOffPredicate.ts` (RC-4, no caller yet), additive `provenance` on the resolver, `listPricedModels()` on `lib/ai/pricing.ts`, the optional actor on `set()` in **both** branches (R-5), and `summariseFeatureAllAccountsInWindow` returning **count and latest only** (RC-6). **96 new tests across 7 files.** All four gates green and measured verbatim (§4.4): `typecheck:bos-llm` 176 files / 31 errors / **0 new** (baseline never regenerated); `check:bos-llm-literals` 42 files / **2 exempt, unchanged** / 0 violations; `next build` compiled with both routes in the table; jest 739/740 — **the single failure is pre-existing**, a snapshot hard-coding `Today is 2026-09-21`, proved by stashing the whole tree. Deviations in §4.5, the two notable ones being **D-1** (the picker ASKS `checkModelAcceptable` rather than restating any rule — stronger than RC-3 asked, and it kills K-5 at the root) and **D-5/Q-8** (the shared predicate skips non-switchable calls, which differs from the script's inline block; raised for SA rather than absorbed, and inert until slice 4). **D-U1 recorded with its re-opening trigger:** sidebar only, per the user — no cross-link from System Config, and if that link is ever wanted the 20 `console.*` calls in that file are converted first, as their own commit. |
| 2026-09-22 | **SA RCs folded in; slice 1 started** | **RC-1 … RC-5 and RC-9 … RC-12 applied; RC-6 folded into slice 1's aggregate, RC-7 restructured the slices, RC-8 into slice 3.** **RC-10 measured live and recorded as G-18 (§2.2):** `system_settings_config.updated_by` **exists**, type **`uuid`**, nullable, **all eight rows currently `null`** — and it carries a **foreign key** (PostgREST renders the target through the `user_settings_complete` view); both active admins satisfy it (2/2). The FK is new risk **K-11**: an unsatisfiable actor id fails the **whole save**. **RC-4 (new SA finding, verified as W-13):** FR-11's switch-off refusal is **script-local** (`scripts/bos-llm-settings.ts:284-303`), not in `validateAreaRow`, so the route as first planned would have made the screen the **softer** door — a shared pure predicate `lib/business-os/llm/switchOffPredicate.ts` lands in slice 1 (no caller), the route uses it in slice 3 and the script adopts it in slice 4 (K-12). **RC-1 (Q-3 → option C):** `details.door` on the audit entries only — no column, no migration, no audit read, and smuggling it into `description` is forbidden — with FR-14 now rendering **three** row states, the new one being *"last changed at Y — actor not recorded"*, which recovers the break-glass signal on the card for free and is the **live** state of all eight rows today. **RC-3:** model-option construction moved out of `route.ts` into `lib/business-os/llm/modelOptions.ts`, because as drafted slice 3's own AC-9 source test would have failed on slice 1's code. **RC-2:** provenance serialised to a plain object (a `Map` through `JSON.stringify` becomes `{}`) and existing-caller behaviour pinned by a test. **RC-5:** 3 s, explicit `maxDuration`, a logger on the abandoned promise, and `timed_out` copy that says *"could not confirm"*. **RC-6:** `costSum` dropped — the aggregate is two statements, count and latest. **RC-7:** slice 4a folded into slice 3, so the confirm step ships with the writer and **K-8 is deleted** rather than mitigated. **RC-8:** a dry-run that refuses is **200 / `ok: false`** and omits `resolvedAfter`. **RC-9:** `import 'server-only'` on every new server module. **RC-11:** R-1's two guards asserted independently. **RC-12:** the environment blocker is closed. Plus **D-U1** (user, 2026-09-22): the screen is reached from the **sidebar only** — no cross-link from System Config — recorded with its re-opening trigger so the 20 `console.*` conversion is priced before anyone promises the link. |
| 2026-09-22 | **SA workplan review appended** | 🔄 **Revision Required — conditional approval; slice 1 may start.** Twelve required changes RC-1 … RC-12. **Q-3 ruled: option C** — the door lives on the audit entries (`details.door`, a required helper parameter), no `updated_via` column and no audit read; the audit trail is the single source of truth for which door, and smuggling the door into `description` is forbidden. C is narrowed only where it loses information for nothing: FR-14 now renders **three** row states, adding *"last changed at Y — actor not recorded"* for a present row with a null `updated_by`, which recovers the break-glass signal on the card for free because the screen always attributes. **Q-1** (provenance in the resolver) and **Q-2** (`listPricedModels()` including `FALLBACK_PRICING`) approved — but the option filter moves out of `route.ts`, because as drafted slice 3's own AC-9 source test would fail on slice 1's code. **Q-4:** awaiting the send is right (fire-and-forget is also unreliable *delivery* on Vercel), 5 s → **3 s** with an explicit `maxDuration`, a logger on the abandoned promise, and `timed_out` copy that says "could not confirm". **Q-6:** drop `costSum` — no reading uses it and a silently capped cost number during a cost incident is K-1 in a new place. **Q-5:** the FR-24 split stands, the 4a split does not — **4a folds into slice 3**, because "hold the merge" is coordination, not a control. **Q-7 agreed:** `app/admin/system-config/page.tsx` (20 `console.*`) is not touched. New findings: FR-11's switch-off refusal is script-local, not in `validateAreaRow`, so it needs a shared predicate or the screen becomes the softer door (RC-4); `system_settings_config.updated_by` exists in this repo only as a TypeScript declaration, with no DDL under `supabase/migrations/` (RC-10). R-1's slice-1 half does close the hazard on its own, with both guards asserted independently (RC-11). |
| 2026-09-22 | Created (Planning) | Workplan for the admin screen, off the SA-re-checked requirement. Five slices (1, 2, 3, 4a, 4b — FR-24 split out per Q-5). Twelve new code findings W-1 … W-12, three of which change the design: `evaluateAreaRow` discards the per-field winning level, so FR-4's provenance is an additive resolver output (Q-1); `lib/ai/pricing.ts` has no listing accessor, so FR-8 needs an additive `listPricedModels()` (Q-2); and **R-2's rendering half is not satisfiable from the row** — the row has no door and its JSON cannot carry one, because `validateAreaRow` rejects unknown top-level keys (Q-3, blocking). R-1 … R-5 mapped to slices in §9. No code written, no gate measured: the worktree has no `node_modules` and no `.env.local`. |
