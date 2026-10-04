# Workplan: Admin BOS Cleanup, Slice 5a (Businesses cleanup)

> **Last Updated**: 2026-10-03

**Developer:** Dev
**Requirement:** [ADMIN_BOS_CLEANUP_REQUIREMENT.md](/docs/requirements/ADMIN_BOS_CLEANUP_REQUIREMENT.md): §4.5 (FR-BU1 to FR-BU6, as corrected by SA), §9 slice 5a acceptance criteria, and **SA Review (2026-10-02) conditions C-9 to C-15** (binding; C-1 to C-8 were slice 1, merged as PR #176). Schema facts are SA's live measurement, requirement **§A** (ref `34d665b4`). This slice adds no select, so it does not re-measure (TA-11).
**Branch:** `fix/admin-businesses-cleanup`, created by RM from `origin/main` `136234a8` (includes slice 1). Worked in its own worktree `neuronforge-admin-businesses`.
**Process:** Full cycle: Dev workplan → SA workplan review → Dev implement → SA code review → QA → user sees the uncommitted diff → user approval → RM. Nothing is committed by Dev.
**Date:** 2026-10-02
**Status:** Code Complete (2026-10-03). SA approved the workplan with conditions SA-5a-1..SA-5a-5, all implemented. Uncommitted, awaiting SA code review. T-13 (manual browser check) owed.
**Effort:** S, about 0.5 to 1 day (SA §E). Estimate in [section 12](#12-effort-estimate).

## Overview

The Businesses detail (`/admin/users`, expand a row) still carries AgentsPilot leftovers: a collapsed "AgentsPilot details" fold (agents and agent executions, whose executions figure has always been 0 because its select names a missing column), and a Subscription card that reads the AgentsPilot Pilot-Credit table and has **never rendered** (two missing columns in its select). This slice removes the fold, retires the Subscription card, and trims `GET /api/admin/users/[id]/stats` to the two reads that still feed the page (Plugins and AI spend, kept per Q-SA-1). The route gains a Zod UUID check, Pino in place of its one `console.error`, and a bound `error` on each read, so a failed read shows "could not be read", never zeros. Page copy is corrected: the stale "unauthenticated" comment, one "every login" line under the heading, and the "Role" field (see open point O-1: the value is not what the requirement assumed). The three phantom columns are recorded in the phantom-column register. No database change, no new route, no gate change.

---

## Table of Contents

- [1. Analysis Summary](#1-analysis-summary)
- [2. Implementation Approach](#2-implementation-approach)
- [3. Files to Create / Modify](#3-files-to-create--modify)
- [4. Task List](#4-task-list)
- [5. Test Plan](#5-test-plan)
- [6. Manual QA Check](#6-manual-qa-check)
- [7. Acceptance Criteria This Slice Closes](#7-acceptance-criteria-this-slice-closes)
- [8. Conditions Traceability (C-9 to C-15)](#8-conditions-traceability-c-9-to-c-15)
- [9. Logging Compliance (`console.*`)](#9-logging-compliance-console)
- [10. Risks and Rollback](#10-risks-and-rollback)
- [11. PR Body Draft](#11-pr-body-draft)
- [12. Effort Estimate](#12-effort-estimate)
- [13. Open Points for SA](#13-open-points-for-sa)
- [Implementation Notes](#implementation-notes)
- [SA Review Notes](#sa-review-notes)
- [QA Testing Report](#qa-testing-report)
- [Commit Info](#commit-info)
- [Change History](#change-history)

---

## 1. Analysis Summary

Read on `fix/admin-businesses-cleanup` @ `136234a8`.

| Area | As built today | What this slice does |
|---|---|---|
| `app/api/admin/users/[id]/stats/route.ts` (182 lines) | Module-scope service-role `createClient` (`:10-13`). `requireAdmin` first statement in the `try` (`:27-28`). `id` checked only for truthiness (`:32-34`), returns `{ error }` without `success`. **Five** parallel reads (`:37-82`): `agents`, `agent_executions` (selects phantom `total_tokens_used`, `:56`), `token_usage`, `user_subscriptions` (selects phantoms `plan_name` and `subscription_status`, `:72`), `plugin_connections`. **No read binds `error`**: each falls back to `data \|\| []` / `null` (`:85`, `:102`, `:116`, `:142`, `:153`), so a failed read is reported as zeros (skill Rule 4). Catch: 1 `console.error` (`:176`) and raw `error.message` returned unguarded (`:179`). | Trimmed to two reads with bound errors, Zod UUID, Pino, dev-only details (C-12). |
| `app/admin/users/page.tsx` (1292 lines, `'use client'`) | Only consumer of the stats route (`:312`; grep confirms no other caller in `app/`, `components/`, `lib/`, `hooks/`). `UserDetailedStats` type (`:75-113`) carries `agents`, `executions`, `subscription`. Fold `<details data-testid="agentspilot-details">` (`:951-1023`). Subscription card (`:1025-1080`) with a `Shield` icon. Plugins card (`:1082-1112`) and "AI spend, all products" card (`:1114-1165`) both guarded only by `userDetailedStats[user.id] &&` and read `.plugins.*` / `.tokens.*` unguarded. Debug log reads `data.agents.total` (`:333-341`). Stale comment (`:408-411`). Heading `<h1>Businesses</h1>` inside a flex row with the count pills (`:452-463`). "Role:" row with `Shield` (`:839-845`). Loaded check (`:301`). 0 `console.*`. | Fold and Subscription card deleted; types narrowed; per-card "could not be read" state; copy fixes (C-10, C-11, C-13). |
| Where "Role" comes from | `app/api/admin/users/route.ts:176-186`: each row is `{ ...profile, ..., role: authUser?.role \|\| 'authenticated' }`. The profile's `role` from the spread is **overwritten** by the Supabase **auth** role, which is `'authenticated'` for every normal login (and is the fallback when the auth lookup fails). | NF-8 assumed `profiles.role`. It is not. See **O-1** before relabelling. |
| `app/admin/users/__tests__/businessOsPanel.render.test.tsx` | `:185-212` mocks the stats route in the old 5-key shape and asserts the fold exists, is a `<details>`, and is closed. | Inverted (C-14). |
| `app/admin/users/__tests__/source.guard.test.ts` | No console, no `lib/business-os` / repository import in the screen files; layout guard first statement. | **Unchanged**, must stay green (C-14). |
| `app/api/admin/__tests__/adminGate.writes.test.ts` | Case `GET /api/admin/users/[id]/stats` (`:271`) with `TARGET_USER = '99999999-9999-4999-8999-999999999999'` (a valid v4 UUID, `:202`); fake client resolves `{ data: [], error: null }`; pinned at **57** cases. "Real admin passes" asserts only "not 401/403". | **Not edited.** The UUID passes Zod; the trimmed route returns 200 on the fake. Pin stays 57. |
| Authz guard `lib/admin/__tests__/admin-authz-surface.guard.test.ts` | R1 requires `requireAdmin(` in every handler body; R2 forbids `AdminAccessService` in `route.ts`. The stats route has no R1/R2 exemption. | **Unchanged.** The gate stays the first statement; the route does not mention `AdminAccessService`. No cap moves. |
| `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` | Register row 72 `users/[id]/stats` `GET` ✅ gated `requireAdmin`. OI-9 (row 9, `:539`) records the admin repository-pattern debt and its template; it lists what is "still inline after slice 2". | **No change required** (gate, handler count and census unchanged). See **O-4** for an optional one-clause addition to OI-9. |
| `docs/workplans/business-os-phantom-column-remediation.md` (294 lines) | P6 (`:232-242`) lists `agent_executions.total_tokens_used` and `user_subscriptions.plan_name` as "representative" platform breakages with no owner. `subscription_status` is absent. | Three findings recorded with ref and Rule 5 shape (C-15). Targeted `Edit`. |
| Repositories | `PluginConnectionRepository` methods `select('*')` (`:28`, `:46`, `:65`, `:128`, `:148`) on a table holding OAuth tokens. `TokenUsageRepository` / `AdminTokenUsageAnalyticsRepository` have no single-account, all-features 30-day row read with these six columns. | **Not touched.** The two remaining inline reads are recorded as OI-9 debt (section 2.1, "Known debt"). |

**Deprecated / non-compliant code noticed, not extended:** the route's module-scope service-role client is OI-9 debt; this slice reduces its reads from 5 to 2 and adds none. `app/api/admin/users/route.ts` calls `auth.admin.listUsers()` unpaged (NF-5), so rows past the first page fall back to `email: 'N/A'` and `role: 'authenticated'`; that route is not in 5a and is not changed (noted for 5b).

**Skills consulted:** `new-api-route` (Zod on the dynamic param, Pino child logger with `correlationId`, `NODE_ENV` guard, gate first); `business-os-schema-check` (Rules 4, 5; recording step); `new-repository` (nothing scaffolded; see Known debt); `tenant-isolation-guard` (not triggered: the route is a read-only, admin-gated cross-account read by design and writes nothing). No import from `lib/business-os/entitlements/` is added, so `business-os-entitlements` does not apply.

---

## 2. Implementation Approach

### 2.1 Stats route: `app/api/admin/users/[id]/stats/route.ts` (C-12)

Prologue unchanged: `correlationId`, `requestLogger = logger.child({ correlationId })`, then inside `try` the gate as the first statement (R1, FR-5). After the gate, in this order:

1. **Zod** (precedent: `business-os/accounts/[accountId]/summary/route.ts:53`):
   ```typescript
   const userIdSchema = z.string().uuid();
   // …after the gate:
   const parsedId = userIdSchema.safeParse((await params).id);
   if (!parsedId.success) {
     return NextResponse.json({ success: false, error: 'Invalid user id' }, { status: 400 });
   }
   const userId = parsedId.data;
   ```
   No query runs before this (test S-3 asserts zero tables touched).
2. **Two reads** in `Promise.all`, each **binding `error`**, columns unchanged:
   - `token_usage`: `model_name, provider, input_tokens, output_tokens, cost_usd, created_at`, `.eq('user_id', userId)`, `.gte('created_at', <30 days>)`.
   - `plugin_connections`: `plugin_key, connected_at, status`, `.eq('user_id', userId)`, `.neq('status', 'disconnected')`.
3. **Per-section result.** A read whose `error` is set is logged with `requestLogger.error({ err: error, section: 'tokens' | 'plugins', targetUserId: userId }, 'User stats read failed')` and its section becomes **`null`**. A section is never built from a failed read, so a failure can never read as `0` calls or `$0.0000`.
4. **Response:** `200 { success: true, data: { tokens: TokenStats | null, plugins: PluginStats | null } }`. The `agents`, `executions` and `subscription` keys are gone. Aggregation code for tokens and plugins is unchanged (same `by_model` top-10, same `active` rule).
5. **Catch:** `requestLogger.error({ err: error }, 'User stats request failed')`; `500 { success: false, error: 'Failed to fetch user statistics', details: NODE_ENV === 'development' ? message : undefined }`. The unguarded `message` key is removed.
6. **Header comment** rewritten: what it serves (Plugins and AI spend cards of the Businesses detail), that the agents / executions / subscription reads were removed in ADMIN_BOS_CLEANUP 5a (phantom columns, requirement §A), and the OI-9 debt note below.
7. Add `import { z } from 'zod'`. Keep `export const dynamic = 'force-dynamic'`. Keep the existing `params: Promise<{ id: string }>` signature (awaiting it is what the adminGate harness passes).

**Why per-section `null` and not a whole 500 on any read error:** C-12 allows either. A per-section null keeps the healthy card visible when only the other read failed, and lets the page say exactly which card could not be read. A thrown error (not a PostgREST error result) still goes to the 500. See O-2.

**Known debt, recorded here by name (C-12, rule 1):** the route still makes **two inline service-role reads** (`token_usage`, `plugin_connections`) through a module-scope `createClient`. They are not moved into repositories in this slice because (a) every `PluginConnectionRepository` read method selects `*` on a table that holds OAuth access and refresh tokens, so it is not a drop-in replacement and would widen what the route loads, and (b) no existing token-usage repository method returns one account's all-feature 30-day rows with these columns. The fix belongs to OI-9 (access doc row 9), following the `AdminTokenUsageAnalyticsRepository` template: admin-only methods, "Admin" in the name, allow-listed columns, `{ data, error }`, source guard.

### 2.2 Page: `app/admin/users/page.tsx` (C-10, C-11, C-13)

| Change | Lines today | Detail |
|---|---|---|
| Narrow `UserDetailedStats` | `:75-113` | Remove `agents`, `executions`, `subscription`. `tokens` and `plugins` become `… \| null`. |
| Delete the fold (C-10) | `:951-1023` | The whole `{userDetailedStats[user.id] && (<details data-testid="agentspilot-details">…)}` block and its comment. |
| Delete the Subscription card (C-11) | `:1025-1080` | The whole block and its comment. |
| Plugins card | `:1082-1112` | Still rendered when `userDetailedStats[user.id]` is set. Header count and list read from `plugins` only when non-null; when `plugins === null`, the body is one line `The connected plugins could not be read.` in `text-sm text-red-300` (a class already on the page, `:746`; D-4). The "x/y active" counter is not shown when null. |
| AI spend card | `:1114-1165` | Same pattern; null body: `The AI usage records could not be read.` No `$0.0000`, no `0` calls when null. Add `data-testid="ai-spend-card"` and `data-testid="plugins-card"` to the two card roots so the tests do not key on prose. |
| Debug log | `:333-341` | Replace `agents: …agents?.total` with `tokens: data?.tokens ? 'ok' : 'unavailable'` and `plugins: data?.plugins?.total ?? null`. Still facts only (QA E-3). |
| Loaded check | `:301` | It does not reference any removed field today. Tightened to `userDetailedStats[user.id]?.tokens && userDetailedStats[user.id]?.plugins`, so a section that came back `null` is re-fetched when the row is opened again, instead of caching the failure. See O-3. |
| Stale comment (FR-BU3) | `:408-411` | Replace the "NOT a security fix … This whole admin surface is unauthenticated …" paragraph with: the admin surface is guarded on the server (`app/admin/layout.tsx` awaits `requireAdminPage()` before any page renders; every `/api/admin` handler calls `requireAdmin`; both are enforced by the admin authz CI guard). Keep the first paragraph (terminate-route history) unchanged. |
| "Every login" line (FR-BU4) | `:452-463` | Wrap `<h1>` in a `<div>` and add below it `<p data-testid="list-scope-note" className="text-sm text-slate-400">Every login on the platform. Logins with no business show "No Business OS business".</p>`. The pills stay in the same row. **`countLabels` untouched** (5b). The `h1` text stays exactly `Businesses` (existing test). |
| Role field (FR-BU6) | `:839-845` | **Pending O-1.** Default implemented: remove the "Role" row and its `Shield` (the value is the auth role, `'authenticated'` for every login, so it carries no information and cannot be labelled "from profile" truthfully). Fallback if SA rules otherwise: label `Auth role`, no icon. Either way the Shield beside it goes. `Shield` stays imported (Security card, `:883`). |

No import changes: `Activity` (`:497`), `Shield` (`:883`), `TrendingUp`, `Settings` and `formatCost` all keep other uses. No new component, colour or icon (D-4).

### 2.3 Phantom register: `docs/workplans/business-os-phantom-column-remediation.md` (C-15)

Targeted `Edit`s only, `git diff --stat` after each (truncation hazard):

1. Insert a sub-section at the end of **P6**, before its `---`: `### P6a — Admin Businesses stats route (resolved by ADMIN_BOS_CLEANUP slice 5a)`, with a table:

   | Column | Measured | Query | Rule 5 shape | Resolution |
   |---|---|---|---|---|
   | `agent_executions.total_tokens_used` | missing (42703), `34d665b4` | `users/[id]/stats` executions read | Phantom in a select whose whole result fed only the AgentsPilot fold (always 0 executions); the column's value was summed but never displayed | Query **deleted** with its only consumer (the fold) |
   | `user_subscriptions.plan_name` | missing (42703), `34d665b4` | `users/[id]/stats` subscription read | **Never worked** | **Retired** with the Subscription card (AP Pilot-Credit table, never rendered), not patched |
   | `user_subscriptions.subscription_status` | missing, `34d665b4` (real column: `status`). **New**, hidden behind `plan_name` because PostgREST names only the first unknown column | same | **Never worked** | **Retired**, same |

   Plus one line: "Source: [ADMIN_BOS_CLEANUP_REQUIREMENT.md](/docs/requirements/ADMIN_BOS_CLEANUP_REQUIREMENT.md) SA Review §A. The two P6 'representative' entries above are therefore resolved at this site; other sites selecting them, if any, are not."
2. Change History row (2026-10-02, "Stats-route phantoms recorded (P6a)").
3. `> **Last Updated**` → 2026-10-02.

The P6 representative list itself is not rewritten (it may name other call sites).

### 2.4 Access doc, guard and gate lists: confirmed, no change

| Item | Check | Result |
|---|---|---|
| R1 (`requireAdmin(` in handler) | Gate call kept as first statement of the `try` | Unaffected |
| R2 (`AdminAccessService` in `route.ts`) | Not mentioned in code, comments or strings | Unaffected |
| `CAPS` | No exemption added or removed | No cap moves |
| `adminGate.writes.test.ts` | Same handler, same `TARGET_USER` (valid UUID), fake returns `{ data: [], error: null }` → 200; denials touch no table (Zod runs after the gate) | Not edited; pin stays 57 |
| Access doc register / census | Same file, same single `GET`, still `requireAdmin` | Row 72 stays true. No census change. Optional OI-9 clause: O-4 |

---

## 3. Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `app/api/admin/users/[id]/stats/route.ts` | modify | C-12: two reads with bound errors, per-section null, Zod UUID, Pino, dev-only details, header comment |
| `app/api/admin/users/[id]/stats/__tests__/route.test.ts` | **create** | C-14: happy path, read error not zeros (each section), invalid id 400 before any read, 500 shape, phantom names absent |
| `app/admin/users/page.tsx` | modify | C-10, C-11, C-13: fold and Subscription card deleted, types narrowed, null-section rendering, debug log, loaded check, comment, every-login line, Role field |
| `app/admin/users/__tests__/businessOsPanel.render.test.tsx` | modify | C-14: invert `:185-212` to the new shape; add null-section and copy assertions |
| `docs/workplans/business-os-phantom-column-remediation.md` | modify (targeted Edit) | C-15 |
| `docs/workplans/ADMIN_BOS_CLEANUP_SLICE_5A_WORKPLAN.md` | create (this file) | Workplan |

**Not touched:** `app/admin/users/components/BusinessOsPanel.tsx`, `source.guard.test.ts`, `adminGate.writes.test.ts`, the authz guard, `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` (unless O-4), `app/api/admin/users/route.ts`, and **none** of `AdminHeader.tsx`, `AdminChrome`, `AdminSidebar.tsx` or `app/admin/layout.tsx` (another Dev's worktree). 5a needs none of them.

---

## 4. Task List

- [x] ✅ **T-1** Baselines on `136234a8`: run `businessOsPanel.render`, `source.guard`, `defaultFilter.render`, `userNameLine.render`, `summaryErrors.contract`, `adminGate.writes`, `admin-authz-surface.guard`; record pass counts. `grep -c "console\."` on the touched files (expect 1 / 0 / 0).
- [x] ✅ **T-2** Write the route test first (section 5.1) against the target shape; confirm it fails on the current route.
- [x] ✅ **T-3** Route change (2.1). Run 5.1 green; run `adminGate.writes` and the authz guard unchanged and green.
- [x] ✅ **T-4** Page: narrow `UserDetailedStats`; delete the fold (`:951-1023`) and the Subscription card (`:1025-1080`).
- [x] ✅ **T-5** Page: null-section rendering and testids on the Plugins and AI spend cards; debug log; loaded check.
- [x] ✅ **T-6** Page copy: stale comment (FR-BU3), every-login line (FR-BU4), Role field per O-1 ruling (FR-BU6).
- [x] ✅ **T-7** Invert and extend `businessOsPanel.render.test.tsx` (5.2). Run all `app/admin/users/__tests__` green, `source.guard` **unedited**.
- [x] ✅ **T-8** Phantom register edits (2.3), `git diff --stat` after each Edit (expect insertions only plus the one Last Updated line).
- [x] ✅ **T-9** Sweeps: `git grep -n "agentspilot-details\|total_tokens_used\|subscription_status\|plan_name" -- app/admin/users "app/api/admin/users/[id]/stats"` returns only test assertions of absence; `git grep -n "console\." ` on touched files returns 0.
- [x] ✅ **T-10** Scoped `tsc` on the touched files with a scratch tsconfig (`"include": []`, `files` = touched files) and `NODE_OPTIONS=--max-old-space-size=8192`; judge by **exit code**, compare against the same run on `136234a8`. `npx eslint` on touched files clean.
- [x] ✅ **T-11** Wider regression: `npm test -- app/admin app/api/admin lib/admin`; record counts and any known flake.
- [x] ✅ **T-12** Fill "Implementation Notes", tick tasks, status → Code Complete. Leave everything **uncommitted**.
- [ ] **T-13** (QA / user) Manual browser check, section 6. **Owed**: not run by Dev (no browser session in this cycle).

---

## 5. Test Plan

### 5.1 Route: `app/api/admin/users/[id]/stats/__tests__/route.test.ts` (new)

Mocks: `@/lib/auth` (`getUser`), `@/lib/services/AdminAccessService` (`isAdmin`), `@/lib/logger` (recording), `@supabase/supabase-js` `createClient` returning a fake whose `from(table)` records the table, records the `select` string, and resolves a per-table `{ data, error }` set by each test. Same harness style as `app/api/admin/users/__tests__/route.test.ts`.

| # | Case | Assertions |
|---|---|---|
| S-1 | Happy path: admin, valid UUID, 3 `token_usage` rows over 2 models, 2 plugin rows (1 active) | 200, `success: true`; `Object.keys(data)` equals `['tokens', 'plugins']` (sorted); input/output/cost/calls totals and `by_model` order correct; `plugins.total = 2`, `active = 1`; tables touched exactly `token_usage`, `plugin_connections` (never `agents`, `agent_executions`, `user_subscriptions`) |
| S-2 | `token_usage` returns `{ data: null, error: { code: '42703' } }` | 200; `data.tokens === null` (**not** an object of zeros); `data.plugins` intact; logger received `{ err, section: 'tokens' }` |
| S-3 | `plugin_connections` read error | `data.plugins === null`; `data.tokens` intact |
| S-4 | Invalid id `'not-a-uuid'` (admin) | 400 `{ success: false, error: 'Invalid user id' }`; **no table touched** |
| S-5 | `from()` throws | 500 `{ success: false, error: 'Failed to fetch user statistics' }`, `details` undefined (`NODE_ENV=test`), no `message` key; logger received `{ err }` |
| S-6 | Selected columns | No recorded `select` string contains `total_tokens_used`, `plan_name` or `subscription_status` |

Auth: 401 / 403 / fail-closed cases are already covered by the shared list in `adminGate.writes.test.ts` (C-14); not duplicated. One local 403 smoke case (non-admin → 403, no table touched) is added so this file stands alone.

### 5.2 Page: `app/admin/users/__tests__/businessOsPanel.render.test.tsx` (inverted, `:185-212`)

| # | Case | Assertions |
|---|---|---|
| P-1 | Open a row, stats mock in the new shape `{ tokens: {…}, plugins: {…} }` | `bos-panel` present; `queryByTestId('agentspilot-details')` is **null**; no heading named exactly `Subscription`; `ai-spend-card` present and contains "may be incomplete above 1,000 calls"; `plugins-card` present |
| P-2 | Stats mock `{ tokens: null, plugins: {…} }` | `ai-spend-card` contains "could not be read"; it does **not** contain `$0.0000`; `plugins-card` renders its list |
| P-3 | Stats mock `{ tokens: {…}, plugins: null }` | `plugins-card` contains "could not be read"; no "0/0 active" |
| P-4 | List loaded | `list-scope-note` text contains "Every login on the platform"; `h1` text still exactly `Businesses`; count pill unchanged |
| P-5 | Row detail | No `Role:` label and no role row (O-1 ruling, SA-5a-1) |

Existing cases in the file (business name / user name, search capped, list error) stay unchanged.

### 5.3 Unchanged suites that must stay green

`source.guard.test.ts` (unedited: no console, no server import), `defaultFilter.render`, `userNameLine.render`, `summaryErrors.contract`, `adminGate.writes` (unedited, 57), `admin-authz-surface.guard` (unedited, caps unchanged).

### 5.4 Type-check and lint

`ts-jest` does not type-check here, so T-10's scoped `tsc` (exit code, compared with baseline) is the type evidence for the narrowed `UserDetailedStats` and the nullable sections. ESLint on the four code files.

---

## 6. Manual QA Check

As a platform admin on `npm run dev`:

1. `/admin/users`: under the "Businesses" heading, the line "Every login on the platform. Logins with no business show 'No Business OS business'." The count pills read as before.
2. Expand a business row: no "AgentsPilot details" fold; no Subscription card; "Connected Plugins" and "AI spend, all products" present with real figures.
3. The account detail has no "Role:" row (SA-5a-1).
4. DevTools Network: `GET /api/admin/users/<id>/stats` returns only `tokens` and `plugins`.
5. `GET /api/admin/users/not-a-uuid/stats` in the browser returns 400 `Invalid user id`.
6. As a signed-in non-admin: the stats URL returns 403 (unchanged).

---

## 7. Acceptance Criteria This Slice Closes

| §9 slice 5a criterion (read with C-9) | Proven by |
|---|---|
| No "AgentsPilot details" section | P-1, T-9 |
| The stats route makes no phantom read (C-9: the page **still calls it**, B-4) | S-1 (tables touched), S-6 (columns), requirement §A for the live facts |
| The stale "unauthenticated" comment is gone | T-6, T-9 grep for "unauthenticated" in `page.tsx` |
| The page says the list is every login | P-4 |
| All slices: happy and failure path per changed route; QA manual check | S-1 to S-5, section 6 |

---

## 8. Conditions Traceability (C-9 to C-15)

| Condition | Where |
|---|---|
| C-9 §9 5a criterion resolves to "still calls it, no phantom read" | Section 7, S-1, S-6 |
| C-10 fold only; Plugins and AI spend stay | 2.2, T-4, P-1 |
| C-11 Subscription card and `user_subscriptions` read retired, not patched | 2.1, 2.2, T-3, T-4, S-1, P-1 |
| C-12 two reads kept with explicit columns; `tokens`/`plugins` only; errors bound, never zeros; Zod UUID 400; Pino; dev-only details; header comment; route stays; debt recorded | 2.1, S-1 to S-6 |
| C-13 FR-BU3 comment; FR-BU4 line, `countLabels` untouched; FR-BU6 relabel and drop Shield; loaded check | 2.2, T-5, T-6, P-4, P-5, **O-1**, **O-3** |
| C-14 panel test inverted; route tests; `source.guard` unchanged | 5.1, 5.2, 5.3 |
| C-15 three phantoms recorded with `34d665b4` and shapes; §A cited | 2.3, T-8 |

---

## 9. Logging Compliance (`console.*`)

Counted with `grep -c "console\."` on `136234a8`.

| File | `console.*` | Plan |
|---|---|---|
| `app/api/admin/users/[id]/stats/route.ts` | **1** (`:176`, `console.error` in the catch) | Converted to `requestLogger.error({ err: error }, 'User stats request failed')`. Read errors logged with `{ err, section, targetUserId }`. The file already has `createLogger({ module: 'UsersIdStatsAdminAPI' })` and a `correlationId` child; both kept. → 0 |
| `app/admin/users/page.tsx` | 0 | Stays 0 (client logger already in use). `source.guard` enforces it |
| `app/admin/users/__tests__/businessOsPanel.render.test.tsx` | 0 | Stays 0 |
| `app/api/admin/users/[id]/stats/__tests__/route.test.ts` (new) | 0 | Logger mocked and recorded |
| `docs/workplans/business-os-phantom-column-remediation.md` | n/a | Doc |

No other file is touched, so there is no further file to flag under CLAUDE.md § Logging.

---

## 10. Risks and Rollback

| Risk | Likelihood / impact | Mitigation |
|---|---|---|
| Relabelling the auth role as "Persona (from profile)" would put a false label on screen | **Certain if C-13 is applied literally** / trust | O-1: default removes the row; SA rules before T-6 |
| A failed read still renders zeros somewhere | Low / high (zero spend looks real) | Sections are `null`, never default objects; S-2, S-3, P-2, P-3 |
| **Deploy skew:** an admin tab opened before deploy runs the old page against the new route; the old fold reads `executions.total_30d` without optional chaining, so expanding a row throws in that tab | Low (admin-only, a handful of users) / one tab, fixed by reload | Accept; mention in PR body |
| Another consumer of the old 5-key response | Very low | grep: the page is the only caller (section 1) |
| `adminGate.writes` "real admin" case changes status | Low | `TARGET_USER` is a valid UUID and the fake returns `error: null`; T-3 runs it unedited |
| Doc edit truncates the 294-line phantom doc | Low / high | Targeted `Edit` only; `git diff --stat` after each (T-8) |
| Touching the header files another Dev owns | None planned | 5a edits none of them |

**Rollback:** one PR, no migration, no data change, no gate or guard change. `git revert` restores the old page and the old 5-read route together (the only consumer and the producer revert as a pair). The phantom-register edit reverts with it.

---

## 11. PR Body Draft

```markdown
## fix(admin): Businesses detail drops AgentsPilot leftovers; stats route trimmed (ADMIN_BOS_CLEANUP slice 5a)

### Why
The Businesses detail still showed AgentsPilot data. The "AgentsPilot details" fold
(agents and agent executions) always showed 0 executions, because its query names a
column that does not exist. The Subscription card read the AgentsPilot Pilot-Credit
table and has never rendered, because its query names two columns that do not exist.
The stats route also turned any failed read into zeros, which look like real answers.

### What changes
- Removed the "AgentsPilot details" fold and the Subscription card. Connected Plugins
  and AI spend stay (user decision Q-SA-1).
- `GET /api/admin/users/[id]/stats` now makes two reads (`token_usage`,
  `plugin_connections`) instead of five, and returns `{ tokens, plugins }`. A failed
  read returns that section as `null` and the card says it could not be read; it never
  shows zeros. `id` must be a UUID (400 otherwise). `console.error` replaced with Pino;
  error details only in development. Gate unchanged (`requireAdmin`, first statement).
- Page copy: the stale "unauthenticated" comment is replaced; a line under the heading
  says the list is every login; the "Role" row is removed (it showed the sign-in
  role, "authenticated" for every login, which is not an admin indicator).
- If the stats request fails as a whole, both cards say they could not be read
  instead of disappearing.
- Phantom columns `agent_executions.total_tokens_used`, `user_subscriptions.plan_name`
  and `user_subscriptions.subscription_status` recorded in the phantom-column register.

### Not changed
No database change. No authz guard cap, gate list or access-doc register change.
The two remaining inline reads are known repository-pattern debt (OI-9).

### Tests
New route tests (happy path, each read failing without zeros, invalid id 400 before any
read, 500 shape, no phantom column selected). Panel render test inverted. Source guard,
adminGate list (57) and authz guard unchanged and green.

### Deploy note
An admin tab opened before this deploy may fail to render when a row is expanded. Reload the page.

### Rollback
Revert this PR. No migration.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

---

## 12. Effort Estimate

| Part | Estimate |
|---|---|
| Baselines (T-1) | 0.5 h |
| Route + its tests (T-2, T-3) | 1.5 to 2 h |
| Page deletions, null states, copy (T-4 to T-6) | 1.5 h |
| Panel test inversion and new cases (T-7) | 1 h |
| Phantom register (T-8) | 0.5 h |
| Sweeps, scoped tsc, lint, wider regression, notes (T-9 to T-12) | 1 to 1.5 h |
| **Total** | **about 6 to 7 h, within SA's 0.5 to 1 day** |

---

## 13. Open Points for SA

| # | Point | Dev proposal |
|---|---|---|
| **O-1** | **C-13 / FR-BU6 rests on a wrong premise.** The "Role" shown on the detail is **not** `profiles.role`. `app/api/admin/users/route.ts:176-186` spreads the profile and then sets `role: authUser?.role \|\| 'authenticated'`, which overwrites it with the Supabase **auth** role. That is `'authenticated'` for every normal login and is also the fallback when the auth lookup fails. Labelling it "Persona (from profile)" would be false. | **Remove the Role row** (and its Shield). It carries no information and NF-8's risk goes with it. Fallback: label it `Auth role`, no icon. Showing the real profile persona would mean changing the users list route's response (a different route, outside 5a). Not proposed. |
| O-2 | C-12 offers "`success: false`, or a section set to `null`". | Per-section `null` in a 200, so the healthy card still shows. A thrown error is a 500. If both reads fail, the response is still 200 with both sections null, and each card says it could not be read. |
| O-3 | C-13 asks for the loaded check (`:301`) to stop depending on removed fields. It does not depend on any today: it tests only that `userDetailedStats[user.id]` exists. | Tighten it to require non-null `tokens` and `plugins`, so a section that failed is fetched again when the row is reopened instead of the failure being cached. |
| O-4 | Access doc: the gate, register row 72 and the census do not change, and neither do `adminGate.writes` (57) or any guard cap. OI-9's "Still inline after slice 2" sentence does not name this route. | No access-doc edit by default, which keeps the PR off the authz doc. If SA wants it, add one clause to OI-9: "`users/[id]/stats` (two reads after ADMIN_BOS_CLEANUP 5a; `PluginConnectionRepository` selects `*`)" with a Change History row. |
| O-5 | If the whole stats request fails (non-200), the page keeps today's behaviour: Plugins and AI spend are not rendered and the failure is logged. Nothing shows zeros, but nothing on screen says the cards are missing either. | Leave it as is for 5a. A one-line "could not load" for the whole-request case is a cheap add if SA wants it. |
| O-6 | Observed, not in scope: `users/route.ts` calls `auth.admin.listUsers()` unpaged (NF-5), so rows past the first page show email `N/A` and the fallback role. | Record it for 5b. No change here. |

---

## Implementation Notes

**Dev, 2026-10-03.** Implemented on `fix/admin-businesses-cleanup` in worktree `neuronforge-admin-businesses`. Nothing committed.

### SA conditions

| Condition | Done | Where |
|---|---|---|
| SA-5a-1 (O-1) | ✅ Role row and its `Shield` deleted; one-line U-9-style comment left in its place. No "Auth role" fallback. `Shield` stays imported (Security card). P-5 asserts no `Role:` label and no `authenticated` text | `page.tsx` User Information card; P-5 |
| SA-5a-2 (O-5) | ✅ A non-OK response, or OK with `success !== true`, stores `UNREADABLE_STATS` (`{ tokens: null, plugins: null }`). `logger.error({ status })` kept. P-6 (500) and P-6b (200 with `success: false`) | `page.tsx` `handleViewUserDetails`; P-6, P-6b |
| SA-5a-3 | ✅ `agent_executions.total_tokens_used` shape is **Never worked**, with the failure described | phantom register P6a |
| SA-5a-4 | ✅ Deploy note reworded as SA wrote it | section 11 |
| SA-5a-5 | ✅ S-1 compares sorted keys with `['plugins', 'tokens']`; S-5 asserts no `message` key and `details` undefined; local 401 added next to the 403 | `stats/__tests__/route.test.ts` |
| Non-blocking: debug-log comment | ✅ Now says the payload holds plugin keys and AI spend | `page.tsx` |
| O-2, O-3 | ✅ Per-section `null` in a 200; loaded check requires non-null `tokens` and `plugins` | route; `page.tsx` |

### Deviations from the plan

| # | Deviation | Why |
|---|---|---|
| D-1 | The row's stats are read once into `const detailedStats = userDetailedStats[user.id]` (next to the existing `const stats = userLoginStats[user.id]`), and the two cards read `detailedStats.plugins` / `detailedStats.tokens` | TypeScript narrows a nullable section through a const reference, so no `!` assertions or repeated lookups. Same shape as the existing `stats` const in that map |
| D-2 | The route's aggregation now runs in two small typed helpers (`buildTokenStats`, `buildPluginStats`) with typed row interfaces, and `cost_usd` is parsed by `toNumber` | The old code relied on untyped `any` rows and `parseFloat(number)`. Output is unchanged (same totals, same cost-desc top-10, same `active` rule); S-1 pins it |
| D-3 | Extra tests beyond the plan: S-5b (development returns `details`), P-6b (200 with `success: false`) | S-5b proves the `NODE_ENV` guard both ways; P-6b covers the second half of SA-5a-2 |
| D-4 | The T-9 grep also matches the route's header comment, which names the three removed columns | Section 2.1 step 6 asks the header to say why the reads were removed. No select names them (S-6) |
| D-5 | Phantom register dates are 2026-10-03 (the day the edit was made), not 2026-10-02 | Accurate date of the change |
| D-6 | Workplan sections 5.2 (P-5), 6 (step 3) and 11 (PR body) edited in place, not only appended | SA-5a-1 and SA-5a-4 require that wording to change |

### Verification

| Check | Result |
|---|---|
| T-1 baseline (7 targeted suites on `136234a8`) | 7/7 suites, 473/473 |
| T-2 new route test on the old route | 7 failed, 2 passed (401/403 already held), as expected |
| New panel cases on the old page (page swapped to `HEAD`, then restored byte-identical) | 7 failed, as expected |
| Route test + `adminGate.writes` (unedited, 57) + authz guard (unedited) | 3/3 suites, 416/416 |
| `app/admin/users/__tests__` + route test | 6/6 suites, 81/81; `source.guard` unedited |
| T-11 `npx jest app/admin app/api/admin lib/admin` | **86/86 suites, 2322/2322.** Baseline before changes: 85 suites, 2306/2307, one failure in `business-os-invites/__tests__/page.render.test.tsx` ("after a create, shows the link once…", 68 s run) that did not reproduce after; a flake outside this slice. +15 tests = 9 route + 6 net new panel cases |
| ESLint, 4 code files | 0 errors. `page.tsx` has 10 warnings, the same 10 as `HEAD` (unused icons, `any`, exhaustive-deps); none introduced. Route and both test files clean |
| `npm run lint:hooks` | exit 0 |
| Scoped `tsc` (scratch tsconfig, `"include": []`, the 4 code files, `NODE_OPTIONS=--max-old-space-size=8192`) | exit 0, 0 errors, same as the baseline run. A deliberate null-unsafe probe (`detailedStats.tokens.total_calls` outside the guard) was reported as TS18047, proving the narrowing is checked; probe reverted |
| `console.*` | route 1 → 0; page, panel test, route test 0 |
| T-9 sweep | `agentspilot-details` only in an absence assertion; phantom names only in the route header comment (D-4) and the S-6 absence list; `unauthenticated` gone from `page.tsx` |
| Phantom register diff | 14 insertions, 1 deletion (the `Last Updated` line) |

### T-13 manual browser check: owed

Not run by Dev. Steps are section 6 (1 to 6), plus:

7. Force a stats failure (DevTools → Network → block `/api/admin/users/*/stats`), reopen a row: both "Connected Plugins" and "AI spend, all products" say they could not be read; no `$0.0000`, no `0/0 active`.
8. Unblock, close and reopen the same row: both cards fill in (a failed section is not cached, O-3).

---

## SA Review Notes

### SA Workplan Review (2026-10-02)

**Reviewed by SA — 2026-10-02**, against requirement conditions C-9..C-15, CLAUDE.md, the `new-api-route` and `business-os-schema-check` skills, and the as-built code on `136234a8` (`app/admin/users/page.tsx`, `app/api/admin/users/[id]/stats/route.ts`, `app/api/admin/users/route.ts`, `businessOsPanel.render.test.tsx`, `adminGate.writes.test.ts`, the authz guard, the access doc and the phantom register).
**Status:** ✅ **Approved with conditions** (SA-5a-1..SA-5a-5 below). Dev may implement; the conditions are carried into the implementation, not into a new workplan round.

#### Verified facts

| Claim in the workplan | Verified | Note |
|---|---|---|
| "Role" is the auth role, not `profiles.role` (O-1) | ✅ | `app/api/admin/users/route.ts:176-186` spreads the profile, then `role: authUser?.role \|\| 'authenticated'` overwrites it. It is also the fallback when `listUsers()` fails or the row is past its first page (NF-5). The page already dropped the same value from the **list** for the same reason (`page.tsx:639-641`, U-9: "the Supabase sign-in role … is not an admin indicator"). NF-8 / C-13's premise was wrong |
| The page is the only caller of the stats route | ✅ | `git grep` over `app components lib hooks scripts`: `page.tsx:312`, plus the two test files (`businessOsPanel.render.test.tsx:190`, `adminGate.writes.test.ts:271`). The response shape change has no other consumer |
| Gate stays first; Zod after the gate, before any read | ✅ | Plan 2.1 runs `requireAdmin` first in the `try`, then `safeParse((await params).id)`, then the reads. Awaiting `params` touches nothing. S-4 asserts zero tables on a bad id. This matches the `business-os/accounts/[accountId]/summary` precedent (`z.string().uuid()` at module scope) |
| `adminGate.writes` needs no edit, pin stays 57 | ✅ | No handler added or removed. `TARGET_USER` is a valid v4 UUID, so Zod passes; the fake builder resolves `{ data: [], error: null }` for any chain (`.gte`, `.neq` included), so the trimmed route returns 200 and "real admin passes" (`[401, 403]` not contained) holds. Denials run before Zod, so `mockTablesTouched` stays `[]`. New log lines carry a UUID, never an email, so "denials leak nothing" holds |
| Authz guard needs no edit, no cap moves | ✅ | R1 needs `requireAdmin(` in the handler (kept); R2 forbids `AdminAccessService` in `route.ts` (not mentioned). No exemption touched |
| Access doc register needs no edit | ✅ | Row 72 `users/[id]/stats GET ✅ gated requireAdmin` stays true. Handler count and census unchanged |
| Two inline reads are OI-9 debt, not a drop-in repo swap | ✅ | Agreed with the requirement's own data-access note: `PluginConnectionRepository` reads `select('*')` on a table holding OAuth tokens. Recorded by name in 2.1, as C-12 asks |
| `console.*` count: route 1, page 0 | ✅ | The one `console.error` (catch) is converted; the unguarded `message` key goes |

#### Rulings on the open points

| # | Ruling |
|---|---|
| **O-1** | **Remove the "Role" row and its Shield. No "Auth role" fallback.** The value is `'authenticated'` for every login and also the fallback when the auth lookup fails, so it carries no information about the business and showing it under any label invites the misreading NF-8 was about. Removal also matches the U-9 precedent on the same page. This **supersedes C-13's FR-BU6 bullet** (dated note added to the requirement's SA section). The `role` field in the `User` type and in `users/route.ts` stays: that route is not in 5a. Not a business question: no real information is removed. See SA-5a-1 |
| O-2 | **Approved.** Per-section `null` inside a 200 is one of the two forms C-12 allows, and it is the better one: the healthy card stays visible and each card says which read failed. A thrown error stays a 500 |
| O-3 | **Approved.** Requiring non-null `tokens` and `plugins` means a failed section is fetched again on the next open instead of the failure being cached. It also makes SA-5a-2 work for free |
| O-4 | **No access-doc edit.** C-12 asks for the debt to be recorded in this workplan by name, which 2.1 does. OI-9's "still inline after slice 2" line is about slice 2 of the reorganisation, and its 38-of-44 count already covers this file. Keeping the PR off the authz doc is right |
| O-5 | **Not accepted as is; see SA-5a-2.** A whole-request failure today makes both cards vanish silently. The admin then reads "no plugins, no spend" by absence, which is the softer form of the zeros problem C-12 exists to stop. The fix is a few lines and needs no new state |
| O-6 | **Agreed: out of scope, record for 5b.** NF-5 already names it. With O-1's removal, the page no longer shows the fallback role, so only `email: 'N/A'` remains as a symptom on 5a's screen |
| Stale tab | **Accepted, wording corrected (SA-5a-4).** Admin-only, two users, cured by reload, and `git revert` restores producer and consumer together |

#### Conditions

1. **SA-5a-1 (O-1).** Delete the "Role:" block (`page.tsx:839-845`) including its `Shield`. Leave a one-line comment in the U-9 style saying why (the auth sign-in role is not an admin indicator; admins live in `admin_users`). P-5 asserts that the expanded detail contains no `Role:` label. Drop the "Auth role" branch from P-5, section 6 step 3 and the PR body. — Priority: High (blocks T-6)
2. **SA-5a-2 (O-5).** When the stats response is not OK, or is OK with `success !== true`, store `{ tokens: null, plugins: null }` for that user instead of storing nothing. Both cards then render their existing "could not be read" lines, and the O-3 check refetches on the next open. No new state, component or copy. Keep the existing `logger.error({ status })`. Add test **P-6**: the stats mock returns 500, and both `ai-spend-card` and `plugins-card` say "could not be read" and neither contains `$0.0000` or `0/0`. — Priority: Medium
3. **SA-5a-3 (C-15 shape).** In the P6a table, give `agent_executions.total_tokens_used` its Rule 5 shape plainly: **Never worked.** PostgREST rejected the whole select, `|| []` turned the error into an empty list, and the fold showed 0 executions every time. "Summed but never displayed" describes the column, not the failure, and would read as a dead select. Resolution unchanged (query deleted with its only consumer). — Priority: Low
4. **SA-5a-4 (deploy note).** The old page renders `executions.total_30d` without optional chaining, so in a stale tab the throw happens **during render**. It can take down the page in that tab, not just the row. PR body: "An admin tab opened before this deploy may fail to render when a row is expanded. Reload the page." — Priority: Low
5. **SA-5a-5 (test details).** In S-1, compare against `['plugins', 'tokens']` (that is the sorted order). S-5 asserts that `message` is absent and `details` is `undefined`. Also add a 401 case (no session, no table touched) next to the local 403 smoke, so the new file meets the `new-api-route` checklist's "happy path + 401 + 400" on its own. — Priority: Low

#### Optimisation suggestions (non-blocking)

- Update the debug-log comment at `page.tsx:333-334`. It still says the payload "holds agent names"; after 5a it holds plugin keys and spend.
- The `User.role` field becomes unused on the page after SA-5a-1. Leave the type as is. It mirrors the list route's response, and 5b owns that route.

#### `new-api-route` checklist against the plan

| Item | Status |
|---|---|
| No `console.*`, only `requestLogger` | ✅ planned |
| No direct `supabase.from(...)` | ⚠️ Accepted debt: 2 inline service-role reads (down from 5), recorded under OI-9 per C-12 |
| `.eq('user_id', userId)` | ✅ both reads, `userId` Zod-validated |
| Zod before any business logic | ✅ (dynamic param; there is no body) |
| `requireAdmin` first, no other admin check | ✅ |
| Audit log | n/a: admin read, none today, none required |
| `NODE_ENV` guard on details | ✅ planned |
| Test: happy + 401 + 400 | ✅ with SA-5a-5 |
| Lint / scoped `tsc` | ✅ T-10 (exit code against the baseline, because ts-jest does not type-check here) |

#### Approval
- [x] Workplan approved. Proceed to implementation with SA-5a-1..SA-5a-5. Leave all changes uncommitted for SA code review.

### SA Code Review (2026-10-03)

**Code Review by SA — 2026-10-03**, on the uncommitted diff in worktree `neuronforge-admin-businesses` (base `136234a8`), against C-9..C-15, the 2026-10-02 O-1 note in the requirement, SA-5a-1..SA-5a-5, rulings O-1..O-6, CLAUDE.md rules 1–7 and the `new-api-route` checklist.
**Status:** ✅ **Code Approved.** No blocking finding. Two optional Low follow-ups below; neither holds QA.

#### Dev claims re-verified (not trusted)

| Claim | SA result |
|---|---|
| Wide admin set 2322/2322 | ✅ Re-ran `npx jest app/admin app/api/admin lib/admin`: **86/86 suites, 2322/2322** (one "worker failed to exit gracefully" notice, no failure) |
| Route test has 9 cases | ✅ S-1..S-6, S-5b, 401, 403 = 9 |
| `adminGate.writes` unedited, pin 57 | ✅ Not in `git status`; `toHaveLength(57)` at `:344`; green in the run above |
| Authz guard unedited | ✅ Not in `git status`; green |
| Scoped `tsc`: 0 errors in touched files | ✅ Scratch tsconfig (`include: []`, the 4 code files): **exit 0** |
| ESLint: 10 warnings, same as `HEAD`, none introduced | ✅ 0 errors; the 10 are pre-existing (unused `Eye`, `X`, `AlertTriangle`, `Lock`; `any`; exhaustive-deps). None of those icons was used by the removed blocks |
| `console.*` route 1 → 0 | ✅ |

#### Route (`app/api/admin/users/[id]/stats/route.ts`)

| Check | Result |
|---|---|
| `requireAdmin` first statement in the `try`, then Zod UUID, then reads | ✅ `:127` gate, `:130` Zod; S-4 proves no table touched on a bad id; 401/403 prove none before the gate |
| Each read binds and checks `error`, section → `null` | ✅ `:154-172`; S-2/S-3 assert `null`, not zeros, and the other section intact |
| No phantom column selected | ✅ Only `token_usage` (6 columns) and `plugin_connections` (3); S-6 pins it. Phantom names survive only in the header comment (D-4, accepted) |
| 500: no `message`, `details` dev-only | ✅ `:176-188`; S-5 and S-5b prove both directions |
| Logs: no PII beyond target UUID | ✅ `{ err, section, targetUserId }`; PostgREST error objects carry code/message/hint, no row data |
| OI-9 debt note, service-role justification | ✅ `:15-21`, `:30-31` |
| D-2 typed helpers | ✅ Accepted. Output unchanged (S-1 pins totals and cost-desc order); removes untyped rows; `toNumber` handles numeric-as-string |
| `.eq('user_id', userId)` on both reads | ✅ with the Zod-validated `userId` |

#### Page (`app/admin/users/page.tsx`)

| Check | Result |
|---|---|
| Only the fold and the Subscription card removed; Plugins and AI spend stay | ✅ |
| "Could not be read" lines; no `$0.0000` / `0/0 active` when null | ✅ Header counter hidden when `plugins` is null; summary and by-model block both behind `tokens === null` |
| SA-5a-2: non-OK, or OK with `success !== true` → `UNREADABLE_STATS` | ✅ `:317-339`; P-6, P-6b |
| O-3 refetch | ✅ Loaded check requires non-null `tokens` and `plugins` |
| Role row and its Shield removed (SA-5a-1); U-9-style comment | ✅ `Shield` still used by the Security card, so the import is live |
| FR-BU3 comment is true | ✅ `app/admin/layout.tsx:40` awaits `requireAdminPage()`; terminate history kept |
| FR-BU4 note under heading; `countLabels` untouched; `h1` exactly `Businesses` | ✅ P-4 |
| Dead code from removed sections | ✅ None. Removed types gone; `Activity`, `Shield`, `formatDate`, `formatCost` all keep other uses. `User.role` kept per the workplan-review suggestion (5b owns the list route) |
| D-1 `detailedStats` const | ✅ Accepted; gives real narrowing (Dev's TS18047 probe) |
| Deploy skew, new page against old route | ✅ Works: `tokens`/`plugins` are picked out of the old 5-key shape |

#### Tests

Panel test inverted (C-14): P-1 asserts no `agentspilot-details`, no `Subscription` heading, AI spend and plugins present with real figures. P-2/P-3/P-6 check both the presence of "could not be read" and the absence of zero figures, so they fail on the old page (consistent with Dev's 7-fail run on `HEAD`). P-5's `not.toContain('authenticated')` is meaningful because the `listBody()` fixture carries `role: 'authenticated'`. The route S-cases use a recording fake with per-table results and assert tables touched and select strings, so they are not vacuous.

#### Docs

Requirement: the O-1 note and its Change History row are additions only. Phantom register: P6a inserted at the end of P6, before its `---`; all three columns at `34d665b4`, all **Never worked** (SA-5a-3 wording applied); `subscription_status` marked new, with its real column `status`; Change History row added at the top (the doc is newest-first). The only deletion is the `Last Updated` line, and the anchor slug in the history row matches the heading. Nothing was deleted wrongly.

#### Code Review Comments

1. `app/admin/users/page.tsx:345-346` (catch) — If any of the three `fetch` calls **rejects** (network error, blocked request) or the stats body is not JSON, control lands in the catch and nothing is stored for the stats, so both cards still vanish silently. That is the residual of the O-5 problem. SA-5a-2 as written (non-OK, or `success !== true`) is met exactly; this case was outside it. Suggested one-liner in the catch: `setUserDetailedStats(prev => prev[user.id] ? prev : { ...prev, [user.id]: UNREADABLE_STATS })`. The O-3 check already refetches on reopen. **Note for QA:** T-13 step 7 ("block the request" in DevTools) produces a rejected fetch, so without this fix the cards will be **absent**, not "could not be read". Either apply the one-liner first, or have QA force a 500 instead of blocking. — Priority: Low (optional, non-blocking)
2. `app/admin/users/__tests__/businessOsPanel.render.test.tsx` — O-3 (a null section is fetched again on reopen) has no automated case; it rests on T-13 step 8. A close-and-reopen case asserting a second `/stats` call would pin it. — Priority: Low (optional)

#### Optimisation Suggestions

- The four pre-existing unused icon imports (`Eye`, `X`, `AlertTriangle`, `Lock`) can go in 5b, when that slice touches the list. Not for this PR.

#### Code Approved for QA: **Yes**

---

## QA Testing Report

### QA Report (2026-10-03)

**QA — 2026-10-03**, worktree `neuronforge-admin-businesses`, branch `fix/admin-businesses-cleanup`, base `136234a8`, uncommitted diff.
**Test mode:** full
**Strategy used:** A + B. Jest unit and route tests (mocked Supabase client) and jsdom render tests of the page. Source reading for the edge cases. D (manual browser) is **owed by the user**: QA cannot sign in.
**Focus:** api, ui, security (gate order)
**Skipped:** D (no admin session). No database access.
**Input source:** TL prompt (task list), workplan §5 test plan.
**Verdict:** ✅ **PASS WITH NOTES.** No High or Medium bug. One Low edge case is open (E-1, the same finding as SA comment 1). T-13 browser check is owed.

#### Test runs (re-run independently)

| Run | Result |
|---|---|
| New route test + `app/admin/users/__tests__` + `adminGate.writes` + authz guard, before QA additions | 8/8 suites, **488/488** |
| `adminGate.writes.test.ts` | Unchanged vs `136234a8` (`git diff --quiet` clean). `toHaveLength(57)` at `:344`; 288 tests = 57 × 5 + 3; the 5 `GET /api/admin/users/[id]/stats` cases all pass |
| `admin-authz-surface.guard.test.ts`, `users/__tests__/source.guard.test.ts` | Unchanged vs `136234a8`; green |
| Wide set `npx jest app/admin app/api/admin lib/admin` | **86/86 suites, 2322/2322**, 59 s, no failure |
| `business-os-invites/__tests__/page.render.test.tsx`, in isolation | **3/3 runs green**, 52/52 each, about 20 s. It also passed inside the wide run. It does not reproduce in isolation, and 5a touches nothing it imports |
| After QA additions: route test + `app/admin/users/__tests__` | 6/6 suites, **85/85** (route 11, panel 16) |
| Mutation check on QA-P8: the loaded check reverted to `userDetailedStats[user.id]` | QA-P8 **fails** (1 failed). The page was restored byte-identical (`cmp`), and `git diff --stat` is unchanged |
| ESLint on the two edited test files | clean |

#### Tests added by QA (minimal, real gaps only)

| Test | File | Gap closed |
|---|---|---|
| QA-S7 | `app/api/admin/users/[id]/stats/__tests__/route.test.ts` | Genuine empty reads return zero objects, **not** `null`, and log no error. Nothing pinned that "no data" and "failed read" stay distinct at the route |
| QA-S8 | same | Both reads failing: still a 200, `{ tokens: null, plugins: null }`, two error logs |
| QA-P7 | `app/admin/users/__tests__/businessOsPanel.render.test.tsx` | A login with **no business**, no usage and no plugins: the panel says "Not a Business OS account". The cards show `$0.0000`, `0/0 active` and "No plugins connected", never "could not be read" |
| QA-P8 | same | O-3: reopening after a failed read calls `/stats` again and the cards fill in. Reopening after success is served from state (no third call). Login-stats and audit-logs are mocked 200, so the stats check is what decides. This closes SA code-review comment 2 |

#### Acceptance criteria coverage (§9 slice 5a, read with C-9..C-15 and the 2026-10-02 O-1 note)

| Acceptance criterion | Tested? | Result | Evidence |
|---|---|---|---|
| No "AgentsPilot details" section | ✅ | Pass | P-1 `queryByTestId('agentspilot-details')` null and no "AgentsPilot details" text. `git grep agentspilot-details` finds only that absence assertion |
| Stats route makes no phantom read (C-9: page still calls it) | ✅ | Pass | S-1 tables touched are exactly `plugin_connections`, `token_usage`. S-6 has 2 selects and none names `total_tokens_used`, `plan_name` or `subscription_status`. The live facts are SA §A (no DB access by QA). `page.tsx:301` still fetches the route |
| Stale "unauthenticated" comment gone | ✅ | Pass | `grep unauthenticated app/admin/users/page.tsx` finds 0. The new text is at `page.tsx:402-405`, and SA verified it against `layout.tsx:40` |
| Page says the list is every login | ✅ | Pass | P-4 checks `list-scope-note` for "Every login on the platform" and that the `h1` is exactly `Businesses` |
| C-10: Plugins and AI spend stay | ✅ | Pass | P-1 checks `plugins-card` (1/2 active, Google Mail) and `ai-spend-card` ($0.4321) |
| C-11: Subscription card and `user_subscriptions` read retired | ✅ | Pass | P-1 finds no `Subscription` heading. S-1 shows `user_subscriptions` is never touched |
| C-12: response is `tokens` + `plugins` only | ✅ | Pass | S-1 sorted keys are `['plugins','tokens']` |
| C-12: errors bound, never zeros | ✅ | Pass | S-2, S-3, QA-S8 (route); P-2, P-3, P-6, P-6b (page) |
| C-12: Zod UUID 400 before any read | ✅ | Pass | S-4: 400 `{ success:false, error:'Invalid user id' }`, no table touched |
| C-12: Pino, `details` dev-only, no `message` | ✅ | Pass | S-5, S-5b. `console.*` count is 0 in the route and the page |
| Gate first; non-admin refused, nothing read | ✅ | Pass | Local 401 and 403 (no table touched, `isAdmin` not called on 401). `adminGate.writes` has 5 stats cases including fail-closed |
| FR-BU6 as superseded: Role row and Shield removed | ✅ | Pass | P-5 finds no `Role:` and no "authenticated" text, while the fixture carries `role:'authenticated'` |
| C-13: loaded check | ✅ | Pass | QA-P8, and the mutation check proves it is load-bearing |
| C-14: panel inverted, route tests, `source.guard` unchanged | ✅ | Pass | See the runs above |
| C-15: three phantoms recorded with `34d665b4` | ✅ | Pass | The P6a diff in the phantom register: 3 rows, all **Never worked**, and only the `Last Updated` line deleted |
| All slices: manual check as platform admin | ⚠️ | **Owed** | T-13, user checklist below |

**Criteria without evidence:** only the manual browser check (T-13). Every other criterion has a test or a code line.

#### Edge-case probe

| Case | Behaviour | Evidence |
|---|---|---|
| Both reads fail | 200, both `null`; page shows two "could not be read" lines | QA-S8; P-6 (same page state) |
| Only one read fails | That section is `null` and the other is intact | S-2, S-3, P-2, P-3 |
| Non-OK response | `UNREADABLE_STATS` stored; both cards say "could not be read" | `page.tsx:336-338`; P-6 |
| 200 with `success: false` | Same as non-OK | `page.tsx:330-335`; P-6b |
| **Network throw in the page fetch** (or a non-JSON body) | ❌ The catch (`page.tsx:345-346`) stores nothing for stats, so **both cards vanish silently**. A rejection of the login-stats or audit-logs fetch does the same, because the three share one `Promise.all` | E-1 below, same as SA comment 1 |
| Invalid id | 400 before any read | S-4 |
| Non-admin (401/403) | Refused, no table touched | Local 401/403; `adminGate.writes` |
| Genuine zeros | Zeros shown as zeros, not "could not be read" | QA-S7, QA-P7 |
| Reopen after failure | Refetched; filled in on success; cached after success | QA-P8 |
| Row with no business | The stats cards render normally (the route does not depend on a business), and the panel says "Not a Business OS account" | QA-P7 |

#### Removed response fields: other readers

`git grep -nE "admin/users/[^\"'\` ]*/stats" -- . ':!docs'` finds only `page.tsx:301`, the panel test and `adminGate.writes.test.ts:271`. `UserDetailedStats` and `userDetailedStats` appear only in `page.tsx`. The page has no remaining `.agents`, `.executions`, `.subscription` or `success_rate` reads. **No other consumer** of `executions`, `subscription` or `agents`.

### Issues Found

#### Bugs (must fix before commit)

None.

#### Performance Issues (should fix)

None. The route went from 5 reads to 2.

#### Edge Cases (nice to fix)

1. **E-1: a rejected fetch hides both cards silently.** File: `app/admin/users/page.tsx:345-346`. Severity: Low. This is the same finding as SA code-review comment 1.
   - Steps to reproduce: open a row while `/api/admin/users/<id>/stats` is blocked (DevTools request blocking, offline), or while any of the three detail fetches rejects.
   - Expected (spirit of SA-5a-2): both cards say "could not be read".
   - Actual: neither card renders, and nothing on screen says so. Reopening refetches (O-3), so the state recovers.
   - Fix (SA's one-liner): in the catch, add `setUserDetailedStats(prev => prev[user.id] ? prev : { ...prev, [user.id]: UNREADABLE_STATS })`. If Dev applies it, QA asks for one render case with `fetch` rejecting.
   - It does not block the verdict: SA-5a-2 as written is met, and SA rated this optional.

### Browser checklist for the user (T-13)

Run as a platform admin on `npm run dev` from this worktree, on a desktop viewport.

1. Open `/admin/users`. Under "Businesses" you see "Every login on the platform. Logins with no business show "No Business OS business"." The count pills look as before.
2. Expand a row that has a business. There is no "AgentsPilot details" fold and no "Subscription" card. "Connected Plugins" shows an "x/y active" count and the list, and "AI spend, all products" shows real figures.
3. In the same detail, the User Information card shows no "Role:" row and no shield next to the user fields. The Security card's shield is still there, which is expected.
4. DevTools → Network → `GET /api/admin/users/<id>/stats`. The response is `{ success: true, data: { tokens, plugins } }`, with no `agents`, `executions` or `subscription`.
5. Open `/api/admin/users/not-a-uuid/stats` in the address bar. You get 400 `{"success":false,"error":"Invalid user id"}`.
6. Expand a row with **no business** (it shows "No Business OS business"). The panel says "Not a Business OS account". If that login has no usage, AI spend shows `$0.0000` and Plugins shows "0/0 active" / "No plugins connected", not "could not be read".
7. In DevTools, block the request URL pattern `*/api/admin/users/*/stats`, then collapse and reopen a row. **As the code stands, both cards disappear** (E-1). If Dev applied the E-1 one-liner, both cards say "could not be read" instead. Either way, you must not see `$0.0000` or `0/0 active`.
8. Remove the block, collapse the row, and reopen it. Both cards fill in with real figures.
9. In a private window, signed in as a non-admin, open `/api/admin/users/<any-uuid>/stats`. You get 403 (signed out: 401).

### Final Status
- [x] All automated acceptance criteria pass. Ready for the user's diff review once the T-13 browser check is done.
- [ ] Issues found that Dev must address before commit. None are blocking; E-1 is optional and Low.

---

## Commit Info

[RM will populate this section]

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-02 | Created | Dev workplan for ADMIN_BOS_CLEANUP slice 5a under SA conditions C-9 to C-15 (Q-SA-1: Plugins and AI spend kept). Six open points for SA (O-1 to O-6). The main one is O-1: the "Role" field shows the auth role, not `profiles.role`, so C-13's relabel would be false. |
| 2026-10-02 | SA workplan review | Approved with conditions SA-5a-1..SA-5a-5. O-1 ruled: remove the Role row (supersedes C-13 FR-BU6). O-2, O-3, O-6 approved. O-4: no access-doc edit. O-5 replaced by SA-5a-2 (whole-request failure shows "could not be read"). |
| 2026-10-03 | Implemented | Code Complete under SA-5a-1..SA-5a-5 plus the debug-log comment suggestion. Implementation Notes added; deviations D-1..D-6. P-5, section 6 step 3 and the PR body reworded per SA-5a-1 / SA-5a-4. Uncommitted. T-13 owed. |
| 2026-10-03 | SA code review | **Code Approved** for QA. Dev's verification claims re-run and confirmed (2322/2322, 9 route cases, pin 57, guard unedited, scoped tsc exit 0). Two optional Low findings: a rejected fetch still makes the cards vanish (catch path; affects how T-13 step 7 is run), and the O-3 refetch has no automated case. |
| 2026-10-03 | QA report | **PASS WITH NOTES.** Independent re-runs: 488/488 targeted, wide 86/86 suites 2322/2322; `adminGate.writes` (57) and the authz guard unedited; the invites flake passes 3/3 in isolation. QA added QA-S7/S8 (route: genuine zeros, both reads failing) and QA-P7/P8 (page: no-business zeros, O-3 refetch, mutation-checked). The users suites are now 85/85. E-1 (Low): a rejected fetch hides both cards, same as SA comment 1. T-13 browser check owed by the user. |
