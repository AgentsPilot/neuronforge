# Workplan: Admin Archiving, Slice 1 (read-only `/admin/archiving` page)

> **Last Updated**: 2026-09-26

**Developer:** Dev
**Requirement:** [ADMIN_ARCHIVING_MODULE_REQUIREMENT.md](/docs/requirements/ADMIN_ARCHIVING_MODULE_REQUIREMENT.md), §13.3 Slice 1, conditions C-1, C-2, C-7, C-9(d), C-15
**Branch:** `feature/admin-archiving-s1`, cut from current `main` (`fa64e384` at time of writing), **not** from `fix/insight-run-group-id-per-business` (C-2). RM creates it; Dev does not.
**Process:** Full cycle: Dev workplan → SA workplan review → Dev implement → SA code review → QA → user → RM
**Date:** 2026-09-26
**Status:** Code Complete (awaiting SA code review). Not committed: RM commits after user approval

## Overview

Slice 1 adds a read-only **Archiving** page to `/admin`. It shows, for the one registered source (the audit trail), the real row count, the oldest record, and how many rows each of the three retention choices (365 / 180 / 90 days) would archive. The dropdown starts at 365 and switches between the three counts without a refetch. The Archive button is disabled with "Not switched on yet", and the archived total, last run and run history say "Not available yet". There is no migration, no write, no POST route and nothing destructive. The shared retention constant and its Zod schema land now so Slice 2's POST route and this dropdown read the same list.

---

## Table of Contents

- [1. Analysis Summary](#1-analysis-summary)
- [2. Implementation Approach](#2-implementation-approach)
- [3. Files to Create / Modify](#3-files-to-create--modify)
- [4. Task List](#4-task-list)
- [5. Test Plan](#5-test-plan)
- [6. Manual QA Check](#6-manual-qa-check)
- [7. Acceptance Criteria This Slice Closes](#7-acceptance-criteria-this-slice-closes)
- [8. Conditions Traceability](#8-conditions-traceability)
- [9. Logging Compliance (`console.*`)](#9-logging-compliance-console)
- [10. Open Questions for SA](#10-open-questions-for-sa)
- [SA Review Notes](#sa-review-notes)
- [Implementation Notes](#implementation-notes)
- [QA Testing Report](#qa-testing-report)
- [Commit Info](#commit-info)
- [Change History](#change-history)

---

## 1. Analysis Summary

| Area | What Slice 1 touches | Evidence read |
|---|---|---|
| DB | **Reads only** `public.audit_trail`: `count(*)`, `min(created_at)`, and `count(*) WHERE created_at < cutoff` three times. No new table, no migration | `supabase/SQL Scripts/create_audit_trail.sql` (`created_at TIMESTAMPTZ NOT NULL`, `idx_audit_trail_created_at` exists, so the `<` counts and the oldest-row lookup are index-backed) |
| Repository | New `ArchiveRepository`, service-role, all-accounts, read-only, following the `TokenUsageRepository` header style | `lib/repositories/TokenUsageRepository.ts:1-27`; `.claude/skills/new-repository/SKILL.md` |
| API | New `GET /api/admin/archiving`. `requireAdmin` first; no request input | `app/api/admin/business-os/entitlements/plans/route.ts` (the canonical admin GET shape); `lib/admin/requireAdminRoute.ts`; `.claude/skills/new-api-route/SKILL.md` § Admin-only routes |
| Admin authz guard | **No change.** A handler that calls `requireAdmin` adds no exemption, so `CAPS` stays as is (C-1). R3 (no `route.ts` under `app/admin/**`) and R8 (every `/admin` render entry is `'use client'`) are satisfied by construction | `lib/admin/__tests__/admin-authz-surface.guard.test.ts:367-398` |
| Page | New `app/admin/archiving/page.tsx`, `'use client'`, no guard of its own (inherits `app/admin/layout.tsx`) | `app/admin/layout.tsx`; `app/admin/business-os-tiers/page.tsx` (fetch/loading/error pattern) |
| UI primitives | `components/ui/select.tsx` (Radix) and `components/ui/badge.tsx`; "Not available yet" panels copy the `NotBuiltPanel` look. No new primitives (C-15) | `components/ui/select.tsx`, `components/ui/badge.tsx`, `app/admin/business-os-tiers/components/NotBuiltPanel.tsx` |
| Sidebar | One entry in **Monitor**, directly under "Audit trail" (C-2) | `app/admin/components/AdminSidebar.tsx:67-92` |
| Existing tests that pin the sidebar | `AdminSidebar.nav.test.ts` pins the Monitor hrefs exactly (line 89) and the total href count (`toHaveLength(22)`, line 121). Both must change in this PR, deliberately | `app/admin/components/__tests__/AdminSidebar.nav.test.ts` |

**Not touched:** `audit_trail` schema/policies, `AuditTrailService`, `AuditTrailRepository`, `lib/audit/*`, the two parked audit routes, purge descriptors, `businessOwnedTables.ts`, any migration, any cron.

---

## 2. Implementation Approach

### 2.1 Shared config (client-safe): `lib/archiving/config.ts`

Imports **nothing** (so it is safe in a `'use client'` page and cannot drag a server module into the bundle). Exports:

```typescript
export const RETENTION_DAYS_OPTIONS = [365, 180, 90] as const;
export type RetentionDays = (typeof RETENTION_DAYS_OPTIONS)[number];
export const DEFAULT_RETENTION_DAYS: RetentionDays = 365;
export function isRetentionDays(value: unknown): value is RetentionDays;

export const ARCHIVE_SOURCES = [{ key: 'audit_trail', label: 'Audit trail' }] as const;
export type ArchiveSourceKey = (typeof ARCHIVE_SOURCES)[number]['key'];

/** Off until Slice 3 merges (C-5). Flipping it is a reviewed diff, not an env var. */
export const ARCHIVE_RUNS_ENABLED = false;

/** now − days, UTC, in ms. One function, so Slice 2's run-start cutoff cannot differ from the overview's. */
export function cutoffFor(days: RetentionDays, now: Date): Date;
```

- The registry carries only `key` and `label` in Slice 1. No `exclusions` (C-9b). The batch function name and the 1,000-row batch size (TQ-3) arrive with Slice 2, where they are first used, so Slice 1 ships no dead fields (see Q-2).
- `cutoffFor` subtracts `days × 86,400,000 ms` from `now`. That is exactly "now − N days" in UTC, which is what FR-3 says; calendar/DST arithmetic does not apply to a UTC instant.

### 2.2 Types shared by route and page: `lib/archiving/types.ts`

Types only, no runtime code, so the page and the route agree on the payload without the page importing anything server-side.

```typescript
export interface RetentionOptionCount {
  retentionDays: RetentionDays;
  cutoff: string;          // ISO, UTC
  eligibleRows: number;    // rows with created_at < cutoff
}
export interface ArchiveSourceOverview {
  key: ArchiveSourceKey;
  label: string;
  totalRows: number;
  oldestRecordAt: string | null;   // null = the table is empty
  options: RetentionOptionCount[]; // all three, in RETENTION_DAYS_OPTIONS order (C-9d)
}
export interface ArchivingOverview {
  generatedAt: string;
  runsEnabled: boolean;            // mirrors ARCHIVE_RUNS_ENABLED
  sources: ArchiveSourceOverview[];
}
```

**Archived total, last run and run history are absent from the payload**, not `0`/`null`. The page renders "Not available yet" for them unconditionally in Slice 1. Slice 2 adds the fields when there is a table to read them from. This keeps the payload from ever claiming a value it cannot know (see Q-3).

### 2.3 Zod: `lib/validation/archiving.ts`

```typescript
export const retentionDaysSchema = z.custom<RetentionDays>(isRetentionDays, {
  message: 'retentionDays must be one of 365, 180, 90',
});
export const archiveSourceKeySchema = z.enum(ARCHIVE_SOURCE_KEYS); // derived from ARCHIVE_SOURCES
```

- **Built from the constant**, so the dropdown and the server cannot drift (FR-2). `isRetentionDays` is `typeof v === 'number' && RETENTION_DAYS_OPTIONS.includes(v)`, so it does **not** coerce: `"365"` is rejected.
- Zod 3.25 has no numeric `enum`. The alternative, `z.union([z.literal(365), z.literal(180), z.literal(90)])`, gives slightly nicer errors but repeats the three numbers by hand (or needs a tuple cast). `z.custom` over the type guard has one source of truth. Q-1 asks SA to confirm.
- Nothing in Slice 1 consumes these at runtime (GET has no input). They are unit-tested now (AC-3 schema half) and wired into `POST /api/admin/archiving/runs` in Slice 2.

### 2.4 Repository: `lib/repositories/ArchiveRepository.ts`

Header comment in the `TokenUsageRepository` style, stating:

- **Intentional service-role client (RLS bypass).** Archiving is platform maintenance across every account; there is no per-user caller. CLAUDE.md Rule 4 is met **by name**: every method that reads across accounts ends in `AllAccounts`, so "all accounts" is never reached by leaving an argument out.
- **Only caller:** `GET /api/admin/archiving`, which is behind `requireAdmin`.
- **Read-only in Slice 1.** No insert/update/delete. Slice 2 adds the run methods; Slice 3 the per-user ones (C-7).
- Selects only `created_at` (for the oldest row) or nothing (`head: true` counts). **No row content is ever read**, so no personal data passes through (AC-14).
- **Never throws**: returns `{ data, error }` (`AgentRepositoryResult`).

Methods (all `audit_trail`, all counts via `count: 'exact', head: true`, F-10):

| Method | Query | Notes |
|---|---|---|
| `countAuditTrailAllAccounts()` | `from('audit_trail').select('id', { count: 'exact', head: true })` | `count === null` with no error is returned as an **error**, not as `0`, so the page can never show a fake zero |
| `getOldestAuditTrailCreatedAtAllAccounts()` | `select('created_at').order('created_at', { ascending: true }).limit(1)` | Empty table → `data: null` (the page says "No records") |
| `countAuditTrailBeforeAllAccounts(cutoff: Date)` | `select('id', { count: 'exact', head: true }).lt('created_at', cutoff.toISOString())` | An invalid `Date` returns an error **before** any query. Strict `<`, the same comparison Slice 2's move function uses (§5.3 step 1) |

Constructor takes an optional `SupabaseClient` for tests. Singleton `archiveRepository` exported. Class and singleton added to `lib/repositories/index.ts`. Row types stay in the repository file (the `TokenUsageRepository` precedent, `index.ts:71`), not in `types.ts`, because they are archive-specific and tiny.

### 2.5 Route: `app/api/admin/archiving/route.ts`

Shape copied from `entitlements/plans/route.ts`, which is the canonical admin GET:

```typescript
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const gate = await requireAdmin(logger.child({ route: 'admin-archiving' }));   // FIRST statement (C-1)
  if (gate instanceof NextResponse) return gate;

  const correlationId = request.headers.get('x-correlation-id') || crypto.randomUUID();
  const requestLogger = logger.child({ correlationId, adminId: gate.user.id });
  try {
    const now = new Date();
    // total, oldest and the three eligible counts, in parallel
    // any repository error -> 500 (no partial payload)
    requestLogger.info({ source, totalRows, eligible: [...] }, 'Archiving overview read');
    return NextResponse.json({ success: true, data: overview });
  } catch (error) {
    requestLogger.error({ err: error }, 'Failed to build the archiving overview');
    return NextResponse.json({ success: false, error: 'Could not read the archiving overview',
      details: process.env.NODE_ENV === 'development' ? message : undefined }, { status: 500 });
  }
}
```

- **One `now` per request**: all three cutoffs come from the same instant, so the three counts are consistent with each other and with the cutoff dates the page prints.
- **Source dispatch** is a server-side `Record<ArchiveSourceKey, (repo, now) => Promise<ArchiveSourceOverview>>`. With one source that is one entry; adding a registry entry without a reader becomes a type error, not a silent gap.
- **Any repository error fails the whole response (500).** A partly-filled card would present a missing number as if it were known.
- **No Zod here**: GET takes no body and reads no query parameter. Query strings are ignored, not parsed, so there is nothing to validate. Zod enters with Slice 2's POST (the skill's "GET / list" variation).
- **No audit event**: a read of counts is not a state change and not sensitive (skill: "No audit log unless the read itself is sensitive"). Run events arrive in Slice 2 (C-16).
- Logs carry counts only. Never row content, never the admin's email.

### 2.6 Page: `app/admin/archiving/page.tsx`

`'use client'`, no guard of its own (header comment says why, like the Tiers page). Layout, top to bottom:

1. **Header:** "Archiving" + a `Badge` "Read-only", a one-line purpose, and a Refresh button (same pattern as `business-os-tiers/page.tsx`).
2. **Source card, "Audit trail"** (one card per `sources[]` entry):
   - Rows now: `totalRows` (`toLocaleString('en-US')`).
   - Oldest record: `oldestRecordAt` as a UTC date, or "No records".
   - **"Keep records live for"** `Select` (Radix, visible `<label>` bound via `aria-labelledby`), options "365 days" / "180 days" / "90 days" from `RETENTION_DAYS_OPTIONS`, **`DEFAULT_RETENTION_DAYS` preselected**. No free-text input anywhere.
   - Eligible now: the `eligibleRows` for the selected option, with "Records created before <cutoff, UTC> would be archived". Switching the dropdown only changes local state; **no refetch** (C-9d).
   - Archived total: **"Not available yet"**. Last run: **"Not available yet"**.
   - **Archive** button: `disabled`, no `onClick`, `aria-describedby` → "Not switched on yet". In Slice 1 it is disabled unconditionally, because there is no run to start; Slice 2 binds it to `ARCHIVE_RUNS_ENABLED` and the POST route.
3. **Run history panel** in the `NotBuiltPanel` style (`rounded-lg border border-slate-700 bg-slate-800/40 p-4`, header with icon + title, muted body): "Not available yet. Runs are recorded once archiving is switched on." No table, no fake rows.
4. **Loading** and **error** states as on the Tiers page (error text is the route's user-facing message; no details).

The Radix `select` primitive defaults to V2 light tokens (`bg-[var(--v2-bg,white)]`). The admin shell is dark, so the page passes `className` overrides (`border-slate-600 bg-slate-800 text-slate-100`) on `SelectTrigger` and `SelectContent`. **The primitive itself is not edited** (other product pages use it). See Q-4.

Page-local files: `app/admin/archiving/format.ts` (UTC date + number formatting, pure) only if the page grows past a readable size; otherwise inline. No `components/` subfolder is expected for Slice 1.

### 2.7 Sidebar: `app/admin/components/AdminSidebar.tsx`

One item added in Monitor, immediately after "Audit trail":

```typescript
{ name: 'Archiving', href: '/admin/archiving', icon: Archive, description: 'Move old audit records out' },
```

`Archive` is added to the existing `lucide-react` import. Nothing else in the file changes.

---

## 3. Files to Create / Modify

| File | Action | Reason |
|------|--------|--------|
| `lib/archiving/config.ts` | create | Retention constant `[365,180,90]`, default 365, `isRetentionDays`, source registry (1 entry), `ARCHIVE_RUNS_ENABLED = false`, `cutoffFor`. Client-safe, zero imports |
| `lib/archiving/types.ts` | create | Overview payload types shared by route and page (types only) |
| `lib/validation/archiving.ts` | create | `retentionDaysSchema`, `archiveSourceKeySchema`, derived from the constant (FR-2) |
| `lib/repositories/ArchiveRepository.ts` | create | Read-only, service-role, all-accounts counts over `audit_trail` (C-7) |
| `lib/repositories/index.ts` | modify | Export `ArchiveRepository` + `archiveRepository` |
| `app/api/admin/archiving/route.ts` | create | `GET` overview, `requireAdmin` first, Pino + `correlationId` |
| `app/admin/archiving/page.tsx` | create | `'use client'` page (C-2, C-15) |
| `app/admin/components/AdminSidebar.tsx` | modify | One Monitor entry under "Audit trail" (C-2) |
| `app/admin/components/__tests__/AdminSidebar.nav.test.ts` | modify | Monitor pin gains `/admin/archiving` after `/admin/audit-trail`; total `toHaveLength(22)` → `23`. A deliberate, reviewed pin change |
| `lib/archiving/__tests__/config.test.ts` | create | Constant, registry, flag, `cutoffFor`, zero-import (client-safe) scan |
| `lib/validation/__tests__/archiving.test.ts` | create | FR-2 accept/reject cases |
| `lib/repositories/__tests__/ArchiveRepository.test.ts` | create | Each method: query shape, happy path, error, edge |
| `app/api/admin/archiving/__tests__/route.test.ts` | create | 200 / 401 / 403 / 500, gate-first source check |
| `app/admin/archiving/__tests__/page.render.test.tsx` | create | jsdom render: counts, dropdown default + switch without refetch, disabled button, "Not available yet" |
| `app/admin/archiving/__tests__/source.guard.test.ts` | create | `'use client'`, no guard of its own, no server imports, no write path, no `console.*` |
| ~~`app/admin/archiving/__tests__/nav.test.ts`~~ | ~~create~~ | **Dropped (SA required change 1).** The updated Monitor pin in `AdminSidebar.nav.test.ts` already proves it |
| `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` | modify | Handler census and per-handler table (SA Q-6a). CLAUDE.md is **not** edited (deferred to the user) |
| `docs/requirements/ADMIN_ARCHIVING_MODULE_REQUIREMENT.md` | add | The requirement, first committed with this slice |
| `docs/workplans/ADMIN_ARCHIVING_SLICE_1_UI_WORKPLAN.md` | add | This workplan |

**Explicitly not modified:** `lib/admin/__tests__/admin-authz-surface.guard.test.ts` (C-1: `git diff main -- <file>` must be empty), `components/ui/select.tsx`, `components/ui/badge.tsx`, any `supabase/` file.

---

## 4. Task List

- [x] ✅ **T0** Confirm branch: `git branch --show-current` = `feature/admin-archiving-s1`, based on current `main` (post-PR #107 sidebar). If not, stop and escalate to TL. *(Cut from `origin/main` at `fa64e384` in an isolated worktree.)*
- [x] ✅ **T1** `lib/archiving/config.ts` + `lib/archiving/types.ts`.
- [x] ✅ **T2** `lib/archiving/__tests__/config.test.ts`; green.
- [x] ✅ **T3** `lib/validation/archiving.ts` + `lib/validation/__tests__/archiving.test.ts`; green.
- [x] ✅ **T4** `ArchiveRepository` (header, three methods, singleton) + barrel export.
- [x] ✅ **T5** `lib/repositories/__tests__/ArchiveRepository.test.ts`; green.
- [x] ✅ **T6** `app/api/admin/archiving/route.ts`.
- [x] ✅ **T7** `app/api/admin/archiving/__tests__/route.test.ts`; green. Run `lib/admin/__tests__/admin-authz-surface.guard.test.ts`; green with **no** edit to it (C-1).
- [x] ✅ **T8** `app/admin/archiving/page.tsx`.
- [x] ✅ **T9** Page tests: `page.render.test.tsx`, `source.guard.test.ts`; green.
- [x] ✅ **T10** Sidebar entry + update of `AdminSidebar.nav.test.ts` pins; green. *(No page `nav.test.ts`: SA required change 1.)*
- [x] ✅ **T11** Full checks: `npm test -- lib/archiving lib/validation/__tests__/archiving lib/repositories app/api/admin/archiving app/admin lib/admin`, `npx tsc --noEmit` (no new errors in touched files), `npm run lint` **scoped to touched files: no new findings** (SA required change 3), `npm run lint:hooks`, `npx next build` (the page is a client component importing a primitive; the build proves no server module leaked in).
- [x] ✅ **T12** Self-review against §8 (conditions) and the skills' final checklists; grep new/touched files for `console.` (expect 0); set status to Code Complete and notify TL for SA code review.
- [x] ✅ **T12a** (SA required change 2, Q-6a) Update `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md`: handler counts and one table row. CLAUDE.md is **not** edited. *(Deviation: see Implementation Notes, D-1. The re-derived split is 80/73/7/0, not 73/66/7/0.)*

---

## 5. Test Plan

All Jest. Co-located `__tests__/`. No live DB in any test (Slice 1 reads only, and the live read is covered by the manual QA check).

### 5.1 `lib/archiving/__tests__/config.test.ts` (unit)

| # | Case |
|---|---|
| U-C1 | `RETENTION_DAYS_OPTIONS` equals `[365, 180, 90]` exactly (order matters: it is the dropdown order) |
| U-C2 | `DEFAULT_RETENTION_DAYS` is `365` and is a member of the options |
| U-C3 | `isRetentionDays`: true for 365/180/90; false for 30, 366, 0, -90, 90.5, `NaN`, `"365"`, `null`, `undefined` |
| U-C4 | `ARCHIVE_SOURCES` has exactly one entry, key `audit_trail`; keys are unique; no entry has an `exclusions` field (C-9b) |
| U-C5 | `ARCHIVE_RUNS_ENABLED === false` (pins C-5, so Slice 3's flip is a visible test change) |
| U-C6 | `cutoffFor(365, fixedNow)` = `fixedNow − 365 × 86,400,000 ms`; same for 180 and 90; does not mutate `now` |
| U-C7 | Client-safety: the source of `config.ts` and `types.ts` contains no `import` of a runtime module (`types.ts` may `import type` from `config.ts` only) |

### 5.2 `lib/validation/__tests__/archiving.test.ts` (unit, FR-2 / AC-3 schema half)

| # | Case |
|---|---|
| U-V1 | `retentionDaysSchema` accepts each of 365, 180, 90 and returns the same number |
| U-V2 | Rejects 30, 366, 0, -90, 90.5, `NaN`, `Infinity` |
| U-V3 | Rejects `"365"` (no coercion), `null`, `undefined`, `{}`, `[]` |
| U-V4 | Drift check: every member of `RETENTION_DAYS_OPTIONS` passes and nothing else in a 1..400 sweep passes |
| U-V5 | `archiveSourceKeySchema` accepts `audit_trail`; rejects `token_usage`, `''`, `'AUDIT_TRAIL'` |

### 5.3 `lib/repositories/__tests__/ArchiveRepository.test.ts` (unit, fake PostgREST builder as in `AuditTrailRepository.test.ts`)

| # | Method | Case |
|---|---|---|
| U-R1 | `countAuditTrailAllAccounts` | Queries `audit_trail` with `{ count: 'exact', head: true }` and no other filter; returns the count |
| U-R2 | 〃 | Supabase error → `{ data: null, error }`, logged, no throw |
| U-R3 | 〃 | `count: null`, no error → returned as an error, not `0` |
| U-R4 | `getOldestAuditTrailCreatedAtAllAccounts` | Selects **only** `created_at`, orders ascending, limit 1; returns the timestamp |
| U-R5 | 〃 | Empty table → `{ data: null, error: null }` |
| U-R6 | 〃 | Supabase error → error result, no throw |
| U-R7 | `countAuditTrailBeforeAllAccounts` | Applies `.lt('created_at', cutoff.toISOString())` with `head: true`; returns the count |
| U-R8 | 〃 | Invalid `Date` → error result and **no query issued** |
| U-R9 | 〃 | Supabase error / `count: null` → error result |
| U-R10 | all | No method calls `insert`, `update`, `delete`, `upsert` or `rpc` (the fake builder records every call; read-only is asserted, not assumed) |

### 5.4 `app/api/admin/archiving/__tests__/route.test.ts` (integration, mocks as in `llm-settings/__tests__/route.test.ts`: `@/lib/auth`, `AdminAccessService`, `@/lib/logger`, and the repository)

| # | Case | Expect |
|---|---|---|
| I-1 | Signed out (`getUser` → `null`) | **401**, `{ success: false }`, repository **not called** |
| I-2 | Signed in, not an admin | **403**, repository **not called** (AC-10 "before it reads anything") |
| I-3 | Admin check throws | **403** (fail closed), repository not called |
| I-4 | Admin, repository returns data | **200**; `sources[0]` has `key: 'audit_trail'`, `totalRows`, `oldestRecordAt`, and `options` with exactly three entries in order 365/180/90, each with `cutoff` and `eligibleRows`; `runsEnabled: false`; **no** archived-total / last-run / runs fields |
| I-5 | Admin, all three cutoffs | Each `cutoff` = the same `now` minus N days (fake timers), passed to the repository as that `Date` |
| I-6 | Admin, empty table | 200 with `totalRows: 0`, `oldestRecordAt: null`, eligible counts `0` |
| I-7 | Admin, any one repository call returns an error | **500**, `{ success: false, error: 'Could not read the archiving overview' }`, no partial `data`; `details` absent when `NODE_ENV !== 'development'` |
| I-8 | Admin, repository throws | **500**, error logged with `err`, same body |
| I-9 | Correlation id | An `x-correlation-id` header is used for the request logger; absent → a UUID is generated |
| I-10 | Source rules (comment-stripped, `codeOf` helper) | `GET`'s first statement is `await requireAdmin(`; no `AdminAccessService`, `profiles`, `app_metadata`, `supabase`, `console.` in the route; no `POST`/`PUT`/`PATCH`/`DELETE` export |

No 400 case in Slice 1: the route has no input. AC-3's route-level half is Slice 2's POST.

### 5.5 Page tests (jsdom)

**`page.render.test.tsx`**, `@jest-environment jsdom`, `fetch` mocked:

| # | Case |
|---|---|
| P-1 | Renders row count, oldest record (UTC) and the **365** eligible count and cutoff on first paint after load |
| P-2 | The dropdown shows "365 days" preselected and offers exactly three options, "365 days", "180 days", "90 days"; there is no `input[type=text|number]` on the page (AC-2) |
| P-3 | Choosing 180 then 90 shows each option's eligible count and cutoff; **`fetch` was called exactly once** (C-9d, no refetch) |
| P-4 | Archive button is `disabled` and described by "Not switched on yet" |
| P-5 | "Not available yet" is shown for archived total, last run and run history; the strings `No runs yet` and a bare archived `0` do **not** appear |
| P-6 | Route returns 500 → error state with the route's message and a retry; no counts shown |
| P-7 | Empty table payload → "No records" for the oldest, `0` eligible for all three |

Radix `Select` in jsdom needs `Element.prototype.hasPointerCapture`, `releasePointerCapture` and `scrollIntoView` stubbed; the test sets them up locally (no global setup change). If Radix still refuses pointer interaction in jsdom, the test drives the select by keyboard (`ArrowDown` / `Enter`), which also covers the §7 keyboard NFR.

**`source.guard.test.ts`** (source scan, modelled on `business-os-tiers/__tests__/source.guard.test.ts`): walks every non-test file under `app/admin/archiving/`:

- `page.tsx`'s first statement is `'use client'` (R8, C-2).
- No `requireAdminPage` / `requireAdmin` / `AdminAccessService` (C-2: inherits the layout guard).
- Imports only from `react`, `lucide-react`, `@/components/ui/*`, `@/lib/archiving/*` and files inside the folder. In particular nothing from `@/lib/repositories`, `@/lib/supabase*`, `@/lib/validation`, `@/lib/services`.
- No `method: 'POST'` (or PUT/PATCH/DELETE) in any `fetch`, and no URL other than `/api/admin/archiving` (AC-15: nothing can start a run).
- No `console.` (AC-18).

~~**`nav.test.ts`**~~: **dropped (SA required change 1).** `AdminSidebar.nav.test.ts` already proves exactly one entry, in Monitor, directly after `/admin/audit-trail`, and that the page file exists (its on-disk scan).

### 5.6 Existing suites that must stay green

`lib/admin/__tests__/admin-authz-surface.guard.test.ts` (unchanged file), `app/admin/components/__tests__/AdminSidebar.nav.test.ts` (two pins updated), `app/admin/business-os-tiers/__tests__/*`, `app/admin/business-os-llm/__tests__/nav.test.ts`, `lib/repositories/__tests__/*`.

---

## 6. Manual QA Check

E2E is not set up, so QA records this in [QA Testing Report](#qa-testing-report). Run against the deployed preview or local dev pointed at the real project (the page only reads).

| # | Step | Expected |
|---|---|---|
| M-1 | Sign in as a platform admin, open `/admin` | Sidebar Monitor section lists Dashboard, AI cost & usage, Audit trail, **Archiving**, in that order |
| M-2 | Click Archiving | `/admin/archiving` loads with one "Audit trail" card; no console errors in DevTools |
| M-3 | In the Supabase SQL editor: `select count(*), min(created_at) from public.audit_trail;` and `select count(*) filter (where created_at < now() - interval '365 days'), count(*) filter (where created_at < now() - interval '180 days'), count(*) filter (where created_at < now() - interval '90 days') from public.audit_trail;` | Page's rows-now, oldest record and the three eligible counts match (rows written between the two reads may add a small drift to rows-now only) |
| M-4 | Dropdown shows 365 on load; switch to 180, then 90, using the **keyboard only** (Tab, Space/Enter, arrows) | Label is visible; eligible count and cutoff date change; DevTools Network shows **no new request** |
| M-5 | Look for any way to type a retention value | None |
| M-6 | Archive button | Disabled; "Not switched on yet" is visible; clicking does nothing and sends no request |
| M-7 | Archived total, last run, run history | Each reads "Not available yet"; no "0", no "No runs yet", no table |
| M-8 | Signed out, request `GET /api/admin/archiving` | **401** |
| M-9 | Signed in as a non-admin: open `/admin/archiving`, then request `GET /api/admin/archiving` | Page redirected away by the layout guard; API **403** |
| M-10 | Page contents | No archived record contents, no restore action, no schedule/cron wording (AC-14, AC-15) |

---

## 7. Acceptance Criteria This Slice Closes

Per requirement §13.3 Slice 1 "Closes".

| AC | Closed here | How it is proven |
|---|---|---|
| **AC-2** | ✅ Full | P-2, P-3, U-C1, U-C2, M-4, M-5 |
| **AC-1** | ◐ Partial: row count, oldest record, eligible count for the selected retention. Archived total and last run are Slice 2 | P-1, I-4, M-3 |
| **AC-10** | ◐ For `GET /api/admin/archiving` only (POST is Slice 2). Guard green with **caps unchanged** (C-1) | I-1, I-2, I-3, I-10, guard suite, M-8, M-9 |
| **AC-14** | ✅ No archived contents shown, no restore action | Repository selects no row content (U-R4, U-R10), source guard, M-10 |
| **AC-15** | ✅ Nothing can start a run; no cron or scheduled route | Disabled button with no handler (P-4), source guard (no write method, no other URL), M-6, no `app/api/cron/*archiv*` |
| **AC-18** | ◐ For files new or touched in this slice | §9; source guard + I-10 |
| **AC-3** | ◐ Schema half only (route-level is Slice 2's POST) | U-V1 to U-V5 |

Not closed in Slice 1: AC-4 to AC-9, AC-11 to AC-13, AC-16, AC-17.

---

## 8. Conditions Traceability

| Condition | How Slice 1 meets it |
|---|---|
| **C-1** Caps untouched; `requireAdmin` first | Route opens with `requireAdmin` (§2.5); I-10 asserts the position (the guard proves presence only, OI-20); guard test file not in the diff |
| **C-2** `'use client'` page, no per-page guard, Monitor under Audit trail, branch from `main` | §2.6, §2.7, T0; source guard + nav test |
| **C-5** `ARCHIVE_RUNS_ENABLED = false` | Constant lands in `config.ts` (U-C5); page shows "Not switched on yet". The server-side 409 is Slice 2 |
| **C-7** All archive access via `ArchiveRepository`, TokenUsage-style header, `…AllAccounts` names | §2.4 |
| **C-9(b)** No `exclusions` field | U-C4 |
| **C-9(d)** All three eligible counts in one response; client-only switch | §2.2, I-4, P-3 |
| **C-9(e)** Only `GET /api/admin/archiving` in this slice | §3; `runs/route.ts` is Slice 2 |
| **C-15** Reuse `select` / `badge`, `NotBuiltPanel` style, no new primitives | §2.6; primitives not edited |

---

## 9. Logging Compliance (`console.*`)

Checked with grep on 2026-09-26.

| File | Status | `console.*` calls |
|---|---|---|
| `app/admin/components/AdminSidebar.tsx` | modify | **0** |
| `app/admin/components/__tests__/AdminSidebar.nav.test.ts` | modify | **0** |
| `lib/repositories/index.ts` | modify | **0** |
| All new files (§3) | create | 0 by construction: route and repository use `createLogger`; the page does not log (errors go to UI state, as on the Tiers page) |

Nothing to flag or convert.

---

## 10. Open Questions for SA

| # | Question | Dev's proposal |
|---|---|---|
| **Q-1** | Zod 3.25 has no numeric enum. `z.custom<RetentionDays>(isRetentionDays)` (one source of truth, derived from the constant) or `z.union` of three `z.literal`s (nicer errors, the numbers written twice)? | `z.custom` over the type guard, with U-V4's sweep as the drift check |
| **Q-2** | The source registry in Slice 1 holds only `key` + `label`. Should the 1,000-row batch size and batch function name (TQ-3, §6) be added now, unused, or with Slice 2? | With Slice 2, where they are first read |
| **Q-3** | Should the Slice 1 payload omit archived total / last run / runs entirely (page renders "Not available yet" statically), or carry an explicit `archive: { available: false }` marker the page renders from? | Omit. Slice 2 adds the real fields; a marker would be a field that exists only to be deleted |
| **Q-4** | `components/ui/select.tsx` is styled with V2 light-theme tokens. OK to override colours via `className` on the admin page rather than edit the shared primitive? | Yes, `className` overrides only; the primitive is used by product pages |
| **Q-5** | Four `count: 'exact'` queries per page load on `audit_trail`. The three `<` counts use `idx_audit_trail_created_at`; the total is a full count. Acceptable for a manually opened admin page, or use `count: 'planned'` for the total only? | Exact for all four. The page is opened by hand, and an estimate would make M-3 unverifiable. Revisit only if QA sees a slow load |
| **Q-6** | Adding one gated handler changes the measured "72/65/7/0" split to 73/66/7/0. `ADMIN_IDENTIFICATION_AND_ACCESS.md` states it in several places (lines 43, 54, 450) and lists every handler in a 72-row table (§ "Every admin handler and its state"); CLAUDE.md and the memory note quote "72". Update these in this PR, or leave it to RM's doc pass? | Update them in this PR as a docs-only change (one new table row, the counts), so the record matches the tree when it merges. The guard test itself needs no change (C-1) |

---

## SA Review Notes

**Reviewed by SA — 2026-09-26**
**Status:** ✅ **APPROVED WITH CHANGES.** Dev may proceed once the three small changes below are made. No re-review is needed; SA checks them in code review.

The workplan matches requirement §13.3 Slice 1 and conditions C-1, C-2, C-5, C-7, C-9(b/d/e) and C-15. It adds no migration, no write path and no new pattern. The route shape follows `entitlements/plans/route.ts`, the repository header follows `TokenUsageRepository`, and the page and test layout copy `business-os-tiers`/`business-os-llm`. `requireAdmin` is the first statement, `CAPS` is untouched (C-1), and the page is `'use client'` with no guard of its own (C-2). GET takes no input, so the absence of Zod on this route is correct. I checked the sidebar pin change against `main`: `AdminSidebar.nav.test.ts` pins Monitor as `['/admin', '/admin/analytics', '/admin/audit-trail']` and asserts that **every page directory on disk** is listed exactly once (`toHaveLength(22)`). A new `app/admin/archiving/` directory therefore **must** move both pins (Monitor gains `/admin/archiving`, 22 → 23). The change is **intended and correct**.

### Answers to Dev's questions

| # | SA answer |
|---|---|
| **Q-1** | **Approved: `z.custom` over `isRetentionDays`**, with U-V4's sweep as the drift check. One source of truth matters more than error text, which only admins and tests see. Inside the guard, widen before `includes` (`(RETENTION_DAYS_OPTIONS as readonly number[]).includes(v)`) rather than casting `v`, so the guard stays honest for non-numbers |
| **Q-2** | **With Slice 2.** No unused fields ship |
| **Q-3** | **Omit.** "Not available yet" is static in Slice 1; Slice 2 adds real fields. A marker field would exist only to be deleted |
| **Q-4** | **Yes, `className` overrides on the page only.** Do not edit `components/ui/select.tsx` |
| **Q-5** | **Exact for all four.** A manually opened admin page can afford them, and `planned` would make M-3 unverifiable. Revisit only if QA sees a slow load |
| **Q-6** | **Split.** (a) Updating `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` (72/65/7/0 → 73/66/7/0 plus one table row) **may go in this PR** as a docs-only change. (b) **The CLAUDE.md "72 admin handlers" wording is deferred to the user at diff review.** It is **not** an implementation task, and Dev does not edit CLAUDE.md in this PR. (c) The auto-memory note is not a repo file and is out of scope |

### Required changes

1. **Drop `app/admin/archiving/__tests__/nav.test.ts`** (from §3 and T10). The updated Monitor pin in `AdminSidebar.nav.test.ts` already proves "exactly once, in Monitor, directly after Audit trail". A second file asserting the same thing is duplication, and the user asked for simplicity.
2. **Add the Q-6(a) doc update as a task** (e.g. T12a). It is docs only, and CLAUDE.md is explicitly excluded.
3. **T11 lint scope:** `npm run lint` must show **no new findings in touched files**. It does not need the whole repo green, because `main` is not lint-clean and a whole-repo gate would block on unrelated files. Keep `npx next build`: it is the only check that proves no server module leaked into the client page.

### Proportionality (tests and manual QA)

Acceptable as written, apart from change 1. The route tests (I-1…I-10), repository tests and page source guard follow the precedent set by the two most recent admin pages, and each covers a stated AC. I-10 and the source guard overlap slightly; keep both, because I-10 proves gate **position** (OI-20), which the CI guard does not. The Radix/jsdom workaround in §5.5 is fine. If pointer interaction still fails, keyboard-driven P-3 is enough, so don't spend time on further stubs. The manual QA list (M-1…M-10) is short and read-only. M-3's SQL comparison is the one step that proves the numbers are real, so keep it.

### Approval

- [x] Workplan approved, conditional on required changes 1 to 3. Proceed to implementation

---

**Code Review by SA — 2026-09-26**
**Status:** 🔄 **APPROVED WITH CHANGES.** The code is approved. Fix CR-1 (the admin doc) and CR-2 (rebase), and preferably CR-3, before QA signs off. No second SA pass is needed: QA or RM confirms that CR-1 and CR-2 are done.

**How I checked.** I read the full diff and every new file, and ran the 8 affected suites: 235 tests pass, and the authz guard passes unchanged (it has no diff against the base, `fa64e384`). ESLint on the touched files reports 0 findings. `console.*` in new or touched non-test files: 0. Four temporary mutations, each reverted and byte-compared against a backup:
- A statement placed before `requireAdmin` makes I-10 fail.
- A null count returned as `0` makes U-R3 and U-R9 fail.
- Removing `'use client'`, adding a repository import and printing an archived `0` make 4 page tests fail.
- A refetch on dropdown change makes P-3 fail.

The tests fail when they should. ⚠️ Another agent was mutating `route.ts` in this worktree at the same time (the gate briefly sat second). It restored the file, and the file now matches the reviewed version. Whoever runs mutation checks next should not run them in parallel.

**Checks you asked for:**
- `requireAdmin` is the first statement ✅
- `CAPS` are untouched ✅
- The repository is read-only, with a documented service-role header and `…AllAccounts` names (C-7) ✅
- A null count becomes an error in the repository ✅. See CR-3 for the route.
- The page is `'use client'` and imports only `react`, `lucide-react`, `@/components/ui/*` and `@/lib/archiving/*` ✅
- No fake data: the payload has no archived or run fields, and the page shows "Not available yet" ✅
- The `!` overrides appear only in `app/admin/archiving/page.tsx` ✅
- No primitive was edited (C-15) ✅
- The sidebar entry sits under Audit trail (C-2) ✅

### Code Review Comments

1. **`docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md`: `main` has moved, and this edit is now wrong and will conflict. Priority: High (CR-1).** Your figure of 79 at the base is correct: I counted 76 `GET`/`POST`/… exports plus 3 `HEAD` exports across 50 files. But PR #112 (`f44fec53`, now on `origin/main` at `770a4ec4`) has already re-derived this doc as **80 = 74 `requireAdmin` + 6 inline + 0 open** across 51 files. It converted `audit-trail#GET` (R1/R2 caps 7 → 6), added a summary route, and appended rows 73–80 **without renumbering**. Your 145-line diff renumbers the table, keeps "7 inline", and dates an 80-handler claim "as of 2026-09-21". **Ruling:** revert this file to the base, rebase, then make the minimal Q-6(a) edit: the counts become **81 / 75 / 6 / 0** across 52 files, one row (**#81**, `archiving` `GET`, ✅ gated, `requireAdmin` first statement), one Change History line, and "Last Updated".
2. **The branch is behind `main` by PR #112 and #113. Priority: High (CR-2).** `main` requires checks in `strict` mode, so RM must rebase before the PR. Expect a trivial conflict in `lib/repositories/index.ts`, because both sides insert after the `TokenUsageRepository` export. `AdminSidebar.tsx` and its nav test change in different hunks. On `main`, the nav test still pins `toHaveLength(22)` and the Monitor list without Archiving, so this branch's 22 → 23 change still applies. After the rebase, re-run `lib/admin`, `app/admin` and `lib/repositories`. `main` added `adminReadMethods.guard.test.ts`, which names specific repositories only, so it should not be affected.
3. **`app/api/admin/archiving/route.ts:79,83`: `?? 0` turns an impossible null into a zero. Priority: Low (CR-3), recommended.** The repository contract makes it unreachable today. Still, "never show a zero nobody measured" is the one property this slice exists to protect, and `?? 0` would silently break it if the contract ever loosened. Replace both with an explicit `if (x.data === null) throw new Error(…)`, which is covered by the existing 500 path and I-7, or with a non-null narrowing that fails loudly. Add one I-7 case, "repo returns `{ data: null, error: null }` → 500".
4. **`.claude/settings.local.json` is modified in the worktree. Priority: Info.** It predates this work and **must not be committed**. RM should stage files explicitly.

### Rulings on Dev's deviations

| # | Ruling |
|---|---|
| **D-1** | **Count verified, edit rejected as written.** See CR-1: revert, rebase, then make the minimal edit (81/75/6/0, one row). Re-counting the doc more broadly was right in spirit, but `main` already did it, and doing it twice produces a conflict and a wrong figure |
| **D-2** | **Accepted.** `cn()` only concatenates classes. The legacy `!` prefix is supported in Tailwind 4 and has precedent in `app/v2/agents/*`. It is confined to the page, and the shared primitive is untouched. QA should still do the visual check on the dark shell (M-4) |
| **D-3** | **Accepted.** Clearing the counts on a failed read is correct: stale numbers must never sit under an error. P-6 and the retry test cover it |
| **D-4** | **Accepted.** `jest.mock` is hoisted above the static import, the factories reference the test variables only lazily, and the suite passes. This clears `no-require-imports` |

### Optimisation Suggestions

- The admin doc's "21 `/admin` pages" figure is stale. Leave it to a separate doc pass, as Dev proposed.
- Info for Slice 3: requirement C-6 describes `audit-trail#GET` as a parked inline route. Since PR #112 it uses `requireAdmin`. The C-6 approach (no edit to that route) still holds, but its stated reason is out of date.

### Code Approved for QA: Yes, with CR-1 and CR-2 required before merge (CR-3 recommended)

---

## Implementation Notes

**Dev, 2026-09-26.** Code complete on `feature/admin-archiving-s1` (from `origin/main` `fa64e384`). Not committed.

### Verification

| Check | Result |
|---|---|
| New tests | 100 passing: `config.test.ts` + `archiving.test.ts` 48, `ArchiveRepository.test.ts` 13, `route.test.ts` 19, `page.render.test.tsx` 11 + `source.guard.test.ts` 9 |
| Touched-area suites (`lib/archiving lib/validation/__tests__/archiving lib/repositories app/api/admin app/admin lib/admin`) | 67 suites, 1,390 tests, all passing |
| `admin-authz-surface.guard.test.ts` | Green, **file unchanged** (C-1) |
| `npx tsc --noEmit` | 0 errors in touched files (2,077 pre-existing elsewhere) |
| `eslint` on touched files | 0 findings (SA required change 3) |
| `npm run lint:hooks` | Pass |
| `npx next build` | Pass, run with the same placeholder env vars as `.github/workflows/build.yml`. The first attempt had no env at all and failed at "Collecting page data" on a pre-existing route (`/api/admin/messages/[id]/replay`) that builds a Supabase client at import time. That is an environment gap, not the next/font flake, and the flake did not occur |
| `console.` in new/touched files | 0 |

### Deviations from the workplan

| # | Deviation | Why |
|---|---|---|
| **D-1** | **Admin doc census is 80/73/7/0, not 73/66/7/0.** | Re-counting the exported verbs under `app/api/admin/**/route.ts` gives **79 on `main`**, not 72. Seven gated handlers shipped after the 2026-09-21 census without rows: `business-os/entitlements/accounts/[accountId]` GET/POST, `…/launch` POST, `…/plans` GET, `…/shadow-report` GET, `business-os/llm-settings` GET, `…/llm-settings/ledger` GET. Writing 73 would have published a figure the doc itself says must be measured. All eight rows were added, the table renumbered, and a Change History entry records it. The guard's `CAPS` and its header comment ("72 handlers") are untouched |
| **D-2** | **The Select and Badge overrides use Tailwind's `!` modifier.** | `cn()` in `lib/utils.ts` joins classes and does not merge them, and the admin shell does not load the `--v2-*` tokens. So a plain `bg-slate-800` would compete with the primitive's `bg-[var(--v2-bg,white)]` on CSS order. `!` makes the override deterministic without editing the primitive (Q-4). There is precedent in `app/v2/agents/[id]/page-redesign.tsx` |
| **D-3** | The page has a **"Try again"** button inside the error state, as well as the header Refresh. | P-6 asks for "a retry". A failed refresh also clears the previous counts, so stale numbers never sit under an error |
| **D-4** | The route test uses a static `import` after the `jest.mock` calls, not `require`. | The copied `require` pattern fails `@typescript-eslint/no-require-imports` in the current config |

### For SA / QA to look at closely

- **Gate position (C-1):** `app/api/admin/archiving/route.ts`. `requireAdmin` is the first statement, and I-10 pins it.
- **The eligible-count fallback:** the route maps `result.data ?? 0` only after checking `result.error`. The repository returns an error, never `0`, when PostgREST gives no count (U-R3, U-R9). So the `?? 0` is a type-narrowing fallback that cannot trigger on a real read.
- **Visual check (QA M-4):** jsdom cannot show colours. Confirm on the dark shell that the dropdown trigger, the open list, the focused item and the "Read-only" badge are readable.
- **Stale page count in the admin doc (not edited):** it still says "21 `/admin` pages". The sidebar test's disk scan now finds 24 page routes with Archiving. This is out of this slice's scope and needs its own doc pass.
- **Also not edited:** the "72 admin handlers" wording in CLAUDE.md, which is deferred to the user (Q-6b).
- `.claude/settings.local.json` shows as modified in the worktree. It was already modified when the worktree was created, is not part of this slice, and **must not be committed**.

### Post-review fixes (Dev, 2026-09-26)

| Item | Fix |
|---|---|
| **CR-1** | My broad edit to `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` was reverted to base. D-1 above is superseded. |
| **CR-2** | Rebased onto `origin/main` `770a4ec4`, which includes PR #112. The slice files were staged by name, committed as a temporary WIP commit, rebased, then soft-reset, so everything is **uncommitted** again. The one conflict was in `lib/repositories/index.ts`, and I kept both exports (`AdminTokenUsageAnalyticsRepository` and `ArchiveRepository`). No `git stash` was used. `.claude/settings.local.json` was copied aside and restored byte for byte (same SHA-1). |
| **Doc, minimal edit** | Made on top of PR #112's version. The count is now **81 handlers across 52 route files = 75 `requireAdmin` + 6 inline + 0 open**. I measured it myself: 52 files export 81 handlers, and exactly 6 have no `requireAdmin`, which are the 6 inline rows. I added row 81 for `archiving` `GET` and one Change History row. Diff: +13/−10. |
| **CR-3** | The route no longer uses `?? 0`. A new `measuredCount()` helper throws when a count is missing, whether or not an error came with it, so the route answers 500. New test: a null count with no error, for the total and for one eligible count, returns 500 with no `data`. The "eligible-count fallback" bullet above is superseded. |
| **QA low** | In `load()`, the call is now `response.json().catch(() => null)`. A non-JSON error page falls through to the friendly "Could not read the archiving overview", and the route's own error message still shows when it sends one. New test: an HTML 504 whose `json()` throws shows the friendly text, not the parser message. |

Re-verified after the rebase:
- **QA-listed suites:** 12 suites, 559 tests, all passing, including the authz guard (file unchanged) and `app/api/admin/__tests__`.
- **All `app/admin` suites:** 20 suites, 368 tests, all passing.
- **eslint on touched files:** clean.
- **`next build`** with the CI placeholder env: passes.

---

## QA Testing Report

**QA — 2026-09-26**
**Test mode:** full
**Strategy used:** A + B (Jest unit and route integration with mocked auth and repository), plus mutation spot-checks. D (Playwright) does not exist in this repo, so the §6 manual steps are split into "covered by an automated test" and "owed to the user as a live check".
**Focus:** api, ui, schema, security
**Skipped:** live checks (QA cannot sign in to the app or query the production DB); they are listed below as owed to the user.
**Input source:** TL prompt + workplan §5/§6

### Test runs (worktree, uncommitted code)

| Suite | Tests | Result |
|---|---|---|
| `lib/archiving/__tests__/config.test.ts` | 25 | ✅ Pass |
| `lib/validation/__tests__/archiving.test.ts` | 23 | ✅ Pass |
| `lib/repositories/__tests__/ArchiveRepository.test.ts` | 13 | ✅ Pass |
| `app/api/admin/archiving/__tests__/route.test.ts` | 19 | ✅ Pass |
| `app/admin/archiving/__tests__/page.render.test.tsx` | 11 | ✅ Pass |
| `app/admin/archiving/__tests__/source.guard.test.ts` | 9 | ✅ Pass |
| `app/admin/components/__tests__/AdminSidebar.nav.test.ts` | 16 | ✅ Pass |
| `lib/admin/__tests__/admin-authz-surface.guard.test.ts` | 119 | ✅ Pass (file unchanged: `git diff main -- <file>` is empty, C-1) |
| `app/api/admin/__tests__/adminGate.writes.test.ts` | 293 | ✅ Pass |
| `app/api/admin/__tests__/auditAdminGate.test.ts` | 12 | ✅ Pass |
| **Total** | **540 tests, 10 suites** | **All green** (new-slice tests: 100, matching Dev's figure) |

`eslint` on the new files: 0 findings. No `app/api/cron/*archiv*` route exists.

### Mutation spot-checks

Each mutation was applied, the suites re-run, then the file restored from a backup and verified by SHA-256 (the new files are untracked, so `git diff` cannot show them; the hash match is the proof).

| # | Mutation | Caught? | Failing tests |
|---|---|---|---|
| M1a | `correlationId` line moved above `requireAdmin` (harmless statement first) | ✅ | I-10 (gate position). **The CI authz guard (119 tests) did not catch it**, the known OI-20 gap, so I-10 is the only line of defence for position |
| M1b | A repository read placed above `requireAdmin` | ✅ | I-1, I-2, I-3 ("reads nothing"), I-8, I-10 (5 failures). Guard again silent |
| M2a | `countAuditTrailAllAccounts` returns `0` on a null count | ✅ | U-R3 |
| M2b | `countAuditTrailBeforeAllAccounts` returns `0` on a null count | ✅ | U-R9 |
| M2c | Null check removed, `count ?? 0` returned | ✅ | U-R3 |
| M2d | Route stops checking an eligible-count error (falls through to `?? 0`) | ✅ | I-7 |
| M3a | `RETENTION_DAYS_OPTIONS` gains `30` | ✅ | 9 failures across U-C1, U-C3, U-V2, U-V3, I-4, I-5, I-6, the query-string test, P-2 |
| M3b | Only `isRetentionDays` accepts `30` (constant unchanged) | ✅ | U-C3, U-V2, U-V3, U-V4 (drift sweep) |
| M4 | Repository gains `deleteAuditTrailBeforeAllAccounts` (a write method) | ✅ | U-R10 (method count pinned at 3). A write inside an existing method is caught by U-R10's recorded-call check |
| M5 | Page `fetch` sends `method: 'POST'` | ✅ | source guard (AC-15), P-1 "reads only the overview route" |
| M6 | `disabled` removed from the Archive button | ✅ | P-4 |

All mutations reverted; hashes of `route.ts`, `ArchiveRepository.ts`, `config.ts` and `page.tsx` match the pre-mutation backups.

### Edge cases

| Case | How checked | Result |
|---|---|---|
| Invalid / extra input on GET (`?retentionDays=30`) | Route test "ignores the query string" | ✅ Ignored, same 200 payload. GET has no input, so no 400 case exists (AC-3's route half is Slice 2) |
| Signed out / non-admin / admin check throws | I-1, I-2, I-3 | ✅ 401 / 403 / 403, repository not called |
| Any one of the five reads fails, or the repository throws | I-7, I-8 | ✅ 500, no partial `data`; `details` only when `NODE_ENV=development` |
| Empty table | I-6, U-R5, P-7 | ✅ `0` rows, "No records", `0` eligible |
| Invalid `Date` cutoff | U-R8 | ✅ Error, no query issued |
| No write methods | U-R10, I-10 ("exports GET only"), source guard, M4/M5 | ✅ Repository has 3 read methods; route exports only `GET`; page has one GET fetch |
| Non-JSON error body (e.g. a Vercel HTML 504) | Code reading of `page.tsx` `load()` | ⚠️ `response.json()` throws and the raw parser message ("Unexpected token '<'…") becomes the on-screen error. Low severity, see Edge Cases below |

### Test Coverage

| Acceptance Criterion | Tested? | Result | Notes |
|---|---|---|---|
| AC-2 (full): dropdown of exactly 365/180/90, 365 preselected, no free text, switching updates eligible count | ✅ | Pass | U-C1/U-C2, P-2, P-3 (one fetch only). Keyboard and dark-theme legibility owed live (M-4) |
| AC-14 (full): no archived contents, no restore | ✅ | Pass | U-R4 (selects `created_at` only), U-R10, source guard; visual confirmation owed (M-10) |
| AC-15 (full): nothing starts a run, no cron | ✅ | Pass | P-4, source guard, M5/M6 mutations, no cron route |
| AC-1 (partial): row count, oldest, eligible for the selected retention | ✅ | Pass (unit) | P-1, I-4. **Real numbers vs SQL owed live (M-3)** |
| AC-10 (GET only): 401/403 before any read; guard green, caps unchanged | ✅ | Pass | I-1…I-3, I-10, M1a/M1b; guard file unchanged. Live 401/403 owed (M-8, M-9) |
| AC-18 (touched files): no `console.*`, no model names, no secrets | ✅ | Pass | I-10, source guard, eslint |
| AC-3 (schema half) | ✅ | Pass | U-V1…U-V5, M3a/M3b |

### Manual steps M-1…M-10

| Step | Automated coverage | Owed to the user live? |
|---|---|---|
| M-1 Monitor order Dashboard, AI cost & usage, Audit trail, Archiving | `AdminSidebar.nav.test.ts` pins the Monitor hrefs in order | Yes, a glance (rendered sidebar) |
| M-2 Page loads, one "Audit trail" card, no DevTools console errors | P-1 (jsdom render) | **Yes**: real browser console |
| M-3 Counts match SQL | None possible (no live DB in tests) | **Yes**: SQL below |
| M-4 365 default; switch 180 → 90 by keyboard; no new request; **dark-theme readability of trigger, open list, focused item and "Read-only" badge** | P-2, P-3 (one fetch) | **Yes**: keyboard, Network tab, colours (jsdom cannot see colour; D-2's `!` overrides are unverified visually) |
| M-5 No way to type a retention value | P-2 (no text/number input) | Optional glance |
| M-6 Archive disabled, "Not switched on yet", click sends nothing | P-4, source guard | **Yes**: click it with Network open |
| M-7 "Not available yet" ×3, no "0", no "No runs yet", no table | P-5 | Optional glance |
| M-8 Signed out → 401 | I-1 | **Yes**: open `/api/admin/archiving` in a private window |
| M-9 Non-admin: page redirected, API 403 | I-2 (API); layout guard inheritance by source guard | **Yes**: needs a non-admin account |
| M-10 No record contents, restore or schedule wording | U-R4, source guard | Yes, a glance |

**M-3 SQL (Supabase SQL editor).** For an exact match, open DevTools → Network → `archiving` response and copy the three `cutoff` values (full ISO, the page itself shows minutes only), then run:

```sql
select
  count(*)                                                        as rows_now,
  min(created_at)                                                 as oldest_record,
  count(*) filter (where created_at < '<cutoff for 365>'::timestamptz) as eligible_365,
  count(*) filter (where created_at < '<cutoff for 180>'::timestamptz) as eligible_180,
  count(*) filter (where created_at < '<cutoff for 90>'::timestamptz)  as eligible_90
from public.audit_trail;
```

Quick version without copying cutoffs (fixed-length days, the same arithmetic as `cutoffFor`; small drift possible only for rows written between the two reads):

```sql
select
  count(*) as rows_now,
  min(created_at) as oldest_record,
  count(*) filter (where created_at < now() - make_interval(secs => 365 * 86400)) as eligible_365,
  count(*) filter (where created_at < now() - make_interval(secs => 180 * 86400)) as eligible_180,
  count(*) filter (where created_at < now() - make_interval(secs => 90 * 86400))  as eligible_90
from public.audit_trail;
```

(`make_interval(secs => …)` is used rather than `interval '365 days'` because a `days` interval follows the session time zone's DST rules and can differ from the route's millisecond arithmetic by an hour.) Oldest record: the page shows it to the minute in UTC; compare against `min(created_at) at time zone 'UTC'`.

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None observed in tests. Four `count: 'exact'` queries per load (SA Q-5 accepted this); if M-2 feels slow on the real table, report it.

#### Edge Cases (nice to fix)
1. **Non-JSON error response shows a raw parser message** — `app/admin/archiving/page.tsx` `load()` — Severity: Low
   - Steps: the route is fronted by a gateway error page (HTML 502/504) or the function times out.
   - Expected: "Could not read the archiving overview".
   - Actual: `response.json()` throws a `SyntaxError`, and its message (e.g. "Unexpected token '<'…") is shown. No data leak, and the retry works; cosmetic only. Same pattern as the Tiers page, so it is not new to this slice.
2. **The CI authz guard does not catch gate position** (M1a/M1b) — known OI-20, not a Slice 1 defect. Route test I-10 is the sole protection for this route; it must not be deleted.

### Final Status
- [x] All automated acceptance criteria pass — no bugs found, **ready for commit once the user completes the live checks** (M-2, M-3, M-4 incl. dark-theme readability, M-6, M-8, M-9)
- [ ] Issues found — Dev must address before commit

---

## Commit Info

*(RM to populate.)*

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-26 | Created | Slice 1 workplan written against requirement §13.3 (as of the 2026-09-26 update: D-1, C-14 to C-17). Covers the shared retention constant and Zod schema, the read-only `ArchiveRepository`, `GET /api/admin/archiving`, the `'use client'` page, the Monitor sidebar entry, the test plan, the manual QA check and six open questions for SA. No code written |
| 2026-09-26 | SA workplan review: APPROVED WITH CHANGES | Answered Q-1 to Q-6 (Q-6: the ADMIN_IDENTIFICATION_AND_ACCESS.md count update may go in this PR; the CLAUDE.md edit is deferred to the user at diff review). Confirmed the sidebar pin change 22 → 23 is intended. Required: drop the duplicate page `nav.test.ts`, add the Q-6(a) doc task, and scope lint to touched files |
| 2026-09-26 | Dev: Code Complete | T0 to T12a done. SA required changes 1 to 3 applied (page `nav.test.ts` dropped, admin doc updated, lint scoped to touched files). 100 new tests. Touched-area suites: 67 suites and 1,390 tests green. Guard unchanged and green. tsc and lint clean on touched files, and `next build` passes. Deviations D-1 to D-4 are recorded in Implementation Notes (D-1: the re-derived census is 80/73/7/0) |
| 2026-09-26 | SA code review: APPROVED WITH CHANGES | Checks passed: gate first, caps untouched, repository read-only, null never becomes 0 in the repository, client-only page, no fake data, `!` confined to the page. Four mutations each failed the right tests. Required: CR-1 (revert the admin-doc census edit because `main`/PR #112 already re-derived it as 80/74/6/0; after rebase, write 81/75/6/0 plus one row) and CR-2 (rebase onto `origin/main` `770a4ec4`). Recommended: CR-3 (drop `?? 0` in the route). D-2, D-3 and D-4 accepted; D-1's count is verified but the edit is rejected as written |
| 2026-09-26 | QA: automated PASS | 10 suites / 540 tests green; 11 mutation spot-checks all caught and reverted (hash-verified). No bugs; one Low edge case (raw JSON parse message on a non-JSON error). Live checks M-2, M-3 (SQL given), M-4 (keyboard + dark theme), M-6, M-8, M-9 owed to the user |
| 2026-09-26 | Dev: post-review fixes | CR-1 revert, CR-2 rebase onto `770a4ec4` (kept uncommitted), doc minimal edit 81/75/6/0 across 52 files, CR-3 no `?? 0` (500 on a missing count), QA-low non-JSON error response. All re-verified |
