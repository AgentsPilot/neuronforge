# Workplan: Admin AI Activity — Slice A (Gap A: catalogue-driven audit filters)

> **Last Updated**: 2026-09-23

**Developer:** Dev
**Requirement:** [BUSINESS_OS_ADMIN_AI_ACTIVITY_VIEW_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_ADMIN_AI_ACTIVITY_VIEW_REQUIREMENT.md) — Gap A / Slice A
**SA ruling this plan implements:** SA-7, SA-8, SA-9, SA-10, SA-11, SA-12 and the FR-A3 ruling in that document's § SA Review Notes
**Date:** 2026-09-22 (implemented 2026-09-23)
**Branch:** `feature/admin-ai-activity-slice-a` (cut from `main` by RM — T0 cleared)
**Status:** ✅ **QA fixes applied 2026-09-23 — BUG-1 and EDGE-2 both done ([T12](#t12--qa-fixes-bug-1--edge-2-2026-09-23)); ready for the user's code read, then RM.** QA's full pass verified every reported number as exact and found one Medium bug (the pager still printed the unfiltered total under a search) plus one stale count. Both fixed, BUG-1 pinned by six new render tests and mutation-tested. QA's EDGE-1 (31 unregistered live action names), EDGE-3 and EDGE-4 are deliberately **not** touched here — EDGE-1 is a Gap B / follow-up chore, the other two are notes on pre-existing behaviour. Previously: ✅ **SA fixes applied 2026-09-23 — X-1, X-2 and X-3 all done ([T11](#t11--sa-code-review-fixes-x-1--x-2--x-3--2026-09-23)); ready for the user view, then QA.** SA ruled no third pass: the three fixes stand as applied and SA confirms them from the diff at the user-view point. Everything else was approved at the code review, including all five judgement calls. Previously: 🔄 SA code review 2026-09-23 — Fix Required on three small items (X-1 High, X-2 / X-3 Low). Before that: ✅ Code Complete — awaiting SA code review. SA approved this plan on 2026-09-22 conditional on C-1 to C-9; all nine are addressed ([Implementation Notes](#implementation-notes--deltas-from-the-plan)). OQ-1 ruled **in scope** (T8 built), OQ-2 **deferred**, OQ-3 **confirmed**.

## Overview

Business OS AI audit entries (`BUSINESS_AI_ACTION_COMPLETED` / `_FAILED`, entity type `ai_action`) already land in `audit_trail` and already render on `/admin/audit-trail`. They cannot be **isolated**, because that page's Action and Entity Type dropdowns are hardcoded JSX that stops at `AIS_*` / `USER_*` / `AGENT_*` and `agent` / `system`.

Slice A makes both dropdowns derive from the catalogues that already exist (`AUDIT_EVENTS` + `EVENT_METADATA`, `AUDIT_ENTITY_TYPES`), so AI actions become selectable **and** the class of defect — a hand-maintained list that silently omits new events — is removed. While the route is open it also picks up two unrelated defects: an unconditional `error.message` leak and a stale TODO. It adds Zod validation to the route's query string, which today is read raw.

This slice adds **no new API route, no new page, no new database access and no schema change.**

> ✅ **Numbering reconciled and confirmed — SA 2026-09-22, re-confirmed by Dev at implementation 2026-09-23.** BA's requirement is final and every `FR-A#` / `AC-A#` cited below still means what this plan assumes; the two line-number corrections were applied to the requirement instead (see C-2). The provisional-numbering warning is dropped per C-2.

---

## Table of Contents

- [Verification Log](#verification-log)
- [Analysis Summary](#analysis-summary)
- [Implementation Approach](#implementation-approach)
  - [A. Catalogue-driven dropdowns](#a-catalogue-driven-dropdowns)
  - [B. Honest totals without fixing search](#b-honest-totals-without-fixing-search)
  - [C. Zod on the route](#c-zod-on-the-route)
  - [D. The two route defects](#d-the-two-route-defects)
  - [E. The console.* finding](#e-the-console-finding)
- [Files to Create / Modify](#files-to-create--modify)
- [Task List](#task-list)
- [Test Plan](#test-plan)
- [Risks](#risks)
- [Non-Goals](#non-goals)
- [Open Questions for SA](#open-questions-for-sa)
- [Implementation Notes / deltas from the plan](#implementation-notes--deltas-from-the-plan)
- [SA Review Notes](#sa-review-notes)
- [QA Testing Report](#qa-testing-report)
- [Commit Info](#commit-info)
- [Change History](#change-history)

---

## Verification Log

Everything asserted in the task brief was re-checked against the tree on 2026-09-22 (working copy on `fix/next-font-build-flake`). **Most claims hold. Five do not, and three of the corrections change the plan.**

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| V-1 | Action dropdown hardcoded at `page.tsx:289-308` | ✅ Holds | `<option value="all">` at `:289`, three `<optgroup>`s, last `</optgroup>` at `:309` |
| V-2 | Entity Type dropdown hardcoded at `page.tsx:358-360` | ✅ Holds | `all` / `agent` / `system` only |
| V-3 | `error.message` returned unconditionally at route `:111` and `:194` | ⚠️ **Holds, off by one** | The leak is on `:110` (`'Failed to fetch audit logs: ' + error.message`) and `:193` (`error.message \|\| 'Internal server error'`). `:111` / `:194` are the `{ status: 500 }` lines |
| V-4 | Stale `// TODO: Add admin role check here` at `:45` | ✅ Holds | Sits directly below the real check at `:29-43` |
| V-5 | Search fetches `pageSize × 5` then filters in memory (`:96-98`); `totalCount` from DB `count` (`:172`) | ✅ Holds | `.range(offset, offset + (pageSize*5) - 1)` at `:98`; `const totalCount = count \|\| 0` at `:172` |
| V-6 | Route allow-listed on `R1_PARKED` **and** `R2_PARKED` in `.github/workflows/admin-authz-guard.yml` | ⚠️ **Right conclusion, wrong file** | The lists live in `lib/admin/__tests__/admin-authz-surface.guard.test.ts` (`:226` R1, `:240` R2). The workflow only *runs* that test. `CAPS` at `:326` is `R1:{parked:7}`, `R2:{parked:7,permanent:1}`. The ratchet + equality assertion is real — converting means editing the **test file**, not the workflow |
| V-7 | Route returns user emails (`:153-167`); page renders them (`:533`, `:568`) | ✅ Holds | `users` table joined on `id, email, full_name`; rendered as `log.users?.email \|\| full_name \|\| user_id` |
| V-8 | Route reads `searchParams` with no schema | ✅ Holds | `:46-56`, including `parseInt(... \|\| '1')` with no NaN guard |
| V-9 | `EVENT_METADATA` carries a description per event | ⚠️ **Holds, but incomplete — this changes the design** | 148 events in `AUDIT_EVENTS`; **only 121 have an `EVENT_METADATA` entry. 27 do not.** Driving the dropdown from `EVENT_METADATA` would silently omit 27 registered events — the exact defect being fixed. See [A](#a-catalogue-driven-dropdowns) |
| V-10 | `AUDIT_ENTITY_TYPES` is a runtime array | ✅ Holds | `lib/audit/types.ts:21-71`, 24 values, `ai_action` at `:62` |
| V-11 | "There is an existing test file at `app/api/admin/audit-trail/`" | ❌ **False** | That directory contains `route.ts` only. The route **is** covered, from elsewhere: `app/api/admin/__tests__/auditAdminGate.test.ts` drives its `GET` through 401 / 403 / admin-check-throws / admin-happy-path, asserting no table is read before the gate passes |
| V-12 | `lib/audit/events.ts` is client-safe (SA's FR-A3 ruling) | ⚠️ **Holds with a caveat** | `events.ts` imports only `./types`; neither file imports `server-only`. But `types.ts:4` is `import { NextRequest } from 'next/server'` — a **value** import used only in a type position (`:154`). SWC elides it, but relying on that is avoidable. See [T2](#t2--make-libaudittypests-explicitly-client-safe) |
| V-13 | Pino in a `'use client'` component | ✅ Works, with precedent | `lib/logger.ts:14-19` configures `browser: { asObject: true }` and exports `clientLogger`. The sibling admin client page `app/admin/users/page.tsx:34-36` already does `createLogger({ module: 'AdminUsersPage' })` |
| V-14 | Slice A needs no new DB access | ✅ Confirmed | `route.ts:72-82` already applies `.eq('action', …)` and `.eq('entity_type', …)`. The values the new dropdowns emit are ordinary strings on the existing parameters. **No repository work is required and none is proposed.** |

---

## Analysis Summary

**What this feature touches**

| Layer | Touched |
|---|---|
| UI | `app/admin/audit-trail/page.tsx` (one client component, 836 lines) |
| Shared lib | `lib/audit/filterOptions.ts` (**new**), `lib/audit/requestSchemas.ts`, `lib/audit/types.ts` (one-line hardening) |
| API | `app/api/admin/audit-trail/route.ts` (validation + two defect fixes; **no query-shape change**) |
| DB | **None.** No new table, column, index, migration or query |
| Repositories | **None.** See V-14 |
| Providers / LLM | **None** |

**Inherited debt, explicitly not fixed here** (recorded so Gap B inherits it knowingly):

1. `route.ts:11-14` constructs its own `createClient(..., SUPABASE_SERVICE_ROLE_KEY)` instead of using `lib/repositories/`. This is requirement F-11 / NFR-4 debt. Slice A adds **no** new DB access, so the mandatory repository rule is not engaged — the rule governs *new* access, and there is none. Converting the existing read is a Gap B / repo-conformance-sweep item.
2. `AuditTrailRepository`'s file header states AI entries are "excluded IN THE QUERY". That remains true and untouched: the invariant is about the **owner** route (`/api/audit/query`), which goes through the repository. The admin route does not call the repository, so offering `ai_action` in the admin UI does not weaken Layer 3 FR-27.
3. The generic detail renderer (`page.tsx:787-802`) dumps *any* entry's `details` / `changes` as key/value — including entity types carrying owner text (`crm_contact`, `proposal`, `website_page`, `intake_form`). SA-11 already records this as out of scope. Slice A neither widens nor narrows it.

---

## Implementation Approach

### A. Catalogue-driven dropdowns

**Decision 1 — the source of truth for actions is `AUDIT_EVENTS`, not `EVENT_METADATA`.**

This is the single most important design point and it contradicts the obvious reading of the brief. Measured: `Object.values(AUDIT_EVENTS).length === 148`; `Object.keys(EVENT_METADATA).length === 121`. **27 registered events have no metadata entry** — `AGENT_ARCHIVED`, `AGENT_RESTORED`, `AGENT_STATUS_CHANGED`, `AGENT_MODE_CHANGED`, `AGENT_SCHEMA_UPDATED`, `MODEL_ROUTING_DECISION`, `USER_CREATED`, `USER_SUSPENDED`, `USER_REACTIVATED`, `PROFILE_UPDATED`, `PROFILE_VIEWED`, `PLUGIN_RECONNECTED`, `PLUGIN_AUTH_FAILED`, `PLUGIN_PERMISSION_GRANTED`, `PLUGIN_PERMISSION_REVOKED`, `DATA_ACCESSED`, `ADMIN_ACTION`, `SYSTEM_CONFIG_CHANGED`, `SYSTEM_MAINTENANCE_STARTED`, `SYSTEM_MAINTENANCE_ENDED`, `PILOT_EXECUTION_CANCELLED`, `PILOT_STEP_EXECUTED`, `PILOT_STEP_FAILED`, `PILOT_STEP_RETRIED`, `PILOT_DISABLED`, `PILOT_CONFIG_UPDATED`, `SECURITY_RATE_LIMIT_EXCEEDED`.

Note `USER_CREATED` is in that list and is **currently offered** by the hardcoded JSX (`page.tsx:301`). A metadata-driven dropdown would therefore be a **regression** against AC-A6 ("nothing else about the page changes"), not just an omission.

So: iterate `AUDIT_EVENTS`; use `EVENT_METADATA[event]?.description` only as an *optional* `title` tooltip. Do **not** call `getEventMetadata()` for the label — its fallback returns the string `"Unknown event: X"`, which is correct for logging and wrong for a UI label.

**Decision 2 — nothing is excluded from the dropdowns.** The brief asks what happens to catalogue entries that should not be offered. Answer: **none, and no exclusion mechanism is built.** Reasons:

- This is the cross-account compliance browser for platform admins. There is no event a platform admin must be prevented from *selecting*. NFR-2's content rules are scoped to the new Gap B view (SA-10), not here.
- `isAiAuditFilter()` in `requestSchemas.ts:27` exists to block AI filters on the **owner** read path. It is not referenced by this route and must not be introduced into it.
- Any exclusion list is a hand-maintained subset wearing a different hat — exactly what SA rejected in the FR-A3 ruling.
- **If** a future event genuinely must be hidden, the correct place is a flag on `EventMetadata` in `lib/audit/events.ts` (keeping it catalogue-driven), never JSX. Recorded as a note in the new module; **not built**.

**Decision 3 — new module `lib/audit/filterOptions.ts`, not inline JSX.**

```typescript
export interface AuditFilterOption { value: string; label: string; description?: string }
export interface AuditFilterGroup  { label: string; options: AuditFilterOption[] }

export function buildActionFilterGroups(): AuditFilterGroup[]
export function buildEntityTypeFilterOptions(): AuditFilterOption[]
```

Why a module rather than inline: (a) it is unit-testable in the default `node` Jest environment with no jsdom and no `UserProvider` mock; (b) Gap B's page will want the same lists; (c) it leaves `page.tsx` literal-free, which makes the [regression guard](#test-plan) a trivial source scan.

**Grouping and labelling (cosmetic only, never exclusionary).**

- Groups come from an **ordered, longest-prefix-wins** rule list, with a **mandatory fallback** to the event's first underscore token. Ordered rules are needed because plain first-token grouping files `BUSINESS_AI_ACTION_COMPLETED` next to `BUSINESS_DATA_PURGED` — burying the two events this whole slice exists to surface.

  | Rule prefix | Group label |
  |---|---|
  | `BUSINESS_AI_ACTION_` | Business OS AI |
  | `BUSINESS_` | Business OS |
  | `AGENTKIT_` | AgentKit |
  | `AIS_` | Agent Intelligence Score |
  | `AI_` | AI Pricing |
  | *(any unmatched)* | title-cased first token |

  The fallback is what makes the rule list safe: a new prefix still produces a group, so **no event can ever be dropped by editing this map**. That property is asserted by test.
- Option label: the event value minus the matched group prefix, `_` → space, title-cased (`AIS_SCORE_CALCULATED` → "Score Calculated" inside the "Agent Intelligence Score" group). Unmatched events keep their full title-cased name.
- `description` (when `EVENT_METADATA` has one) is rendered as `<option title={…}>`, surfacing the catalogue's human text without bloating 148 labels.
- Groups sorted alphabetically by label; options alphabetically by label within a group. `<option value="all">All Actions</option>` stays as the first, non-derived entry (it is a UI sentinel, not a catalogue value).

**Entity types** are simpler: map `AUDIT_ENTITY_TYPES` → `{ value, label }` with `snake_case` → Title Case and a small acronym map (`ai` → AI, `ais` → AIS, `crm` → CRM). All 24 offered, `ai_action` → "AI Action". No grouping, alphabetical, `all` first.

**Accepted limitation (record in the module header):** the live `audit_trail` table can hold `action` / `entity_type` values that were never registered — `requestSchemas.ts:8-12` says so in its own header. The dropdowns therefore offer the **registered** set, not the **observed** set. "All Actions" / "All Entities" remains how an admin sees the rest. Enumerating distinct values from the table would need a new query and route; out of scope.

### B. Honest totals without fixing search

The route's `totalCount` is the **unfiltered** DB count, so with a search term active the page renders e.g. "Showing 3 of 14,332 audit logs" (`page.tsx:397`), which is false in both halves.

**Minimal honest behaviour proposed:** branch the count line on whether a search term is active.

- **No search term** (the Slice A path — dropdown filters only): unchanged. `.eq()` + `count: 'exact'` makes `total`, `totalPages` and paging genuinely correct.
- **Search term active:** render `Showing {showing} matches on this page` plus a one-line caveat — *"Search scans only the current page of results. Use the Action, Entity Type, Severity and date filters for complete results."* — and suppress the `(Page n of m)` suffix, which is derived from the same unfiltered count.

Deliberately **not** changed: the Prev/Next buttons stay wired to `pagination.totalPages`. They page the underlying unfiltered stream, which is what the route actually does; making the pager describe a filtered set requires the filtered count, i.e. the search fix. Making it honest **in words** is the minimal change; making it honest **in behaviour** is the spun-out item. That residue is called out in [Non-Goals](#non-goals) so a reviewer does not read the caveat as a claim the pager is now correct.

### C. Zod on the route

Add `AdminAuditTrailQuerySchema` to `lib/audit/requestSchemas.ts` — the established home for this route family's input schemas — and parse `request.nextUrl.searchParams` through it immediately after the admin gate and before any DB read.

Deliberate choices, each with a reason:

1. **Permissive identifiers, not enums.** `action` / `entity_type` accept the existing `IDENTIFIER` regex (`/^[A-Za-z0-9_]{1,64}$/`, `requestSchemas.ts:34`), *not* an allow-list of `AUDIT_EVENTS`. This follows the asymmetry doctrine already documented at the top of that file: a read filter is not a security boundary, and the live table holds unregistered values. An enum here would make previously-reachable rows unreachable — a regression.
2. **The `'all'` sentinel is preserved.** The page omits the param when `'all'`, but the route also tolerates a literal `'all'` (`:72`, `:76`, `:80`). A `preprocess` maps `'all'` → `undefined` so any existing caller keeps working (AC-A6).
3. **Dates are parsed permissively, NOT with `z.string().datetime()`.** ⚠️ The page's inputs are `type="datetime-local"` (`:329`, `:344`), which emit `2026-09-01T10:00` — no seconds, no timezone. `z.string().datetime()` **rejects that**, which would break both existing date filters. Use a `.refine()` on `Number.isFinite(Date.parse(v))` instead. This is the single most likely way to break the page while "adding validation", and it is exactly what an integration test must cover.
4. **`page` / `page_size` become bounded positive integers**, reusing the file's existing `positiveInt()` helper with a `page_size` maximum. This incidentally fixes a live bug: `parseInt('abc')` → `NaN` → `.range(NaN, NaN)`, a 500 today.
5. **`search` gets a max length**, matching the `BusinessListQuerySchema` precedent (`lib/business-os/usage/llmUsageVerification.ts:109-118`). Its semantics are untouched.
6. **On failure:** `400` with a fixed, non-reflective message via the existing `firstIssueMessage()` helper (`:121`), with the Zod issue path behind the `NODE_ENV === 'development'` guard.

Scope discipline: the schema covers exactly the seven parameters the route already reads. **No new parameters are introduced by Slice A** — the dropdowns emit values on `action` and `entity_type`, which already exist.

### D. The two route defects

| Line | Now | After |
|---|---|---|
| `:45` | `// TODO: Add admin role check here` | deleted |
| `:106-111` | `error: 'Failed to fetch audit logs: ' + error.message` | `error: 'Failed to fetch audit logs'`, plus `details: process.env.NODE_ENV === 'development' ? error.message : undefined` |
| `:189-195` | `catch (error: any)` … `error: error.message \|\| 'Internal server error'` | `catch (error: unknown)` … `error: 'Internal server error'`, plus the same dev-guarded `details` |

The Pino `logger.error({ err: error }, …)` calls at `:107` and `:190` stay — the detail is not lost, it moves to the server log where it belongs. The response shape matches CLAUDE.md § Error Response Format exactly (`success` / `error` / `details`).

### E. The console.* finding

**Audited both files. Result:**

| File | `console.*` count | Detail |
|---|---|---|
| `app/admin/audit-trail/page.tsx` | **1** | `console.error(err);` at **line 90**, inside `fetchLogs`'s catch |
| `app/api/admin/audit-trail/route.ts` | **0** | Already fully on Pino (`createLogger({ module: 'AdminAuditTrailAPI' })`, `:16`) |

**The page is a `'use client'` component — so what is correct there?** `createLogger` is correct and safe: `lib/logger.ts:14-19` configures Pino's `browser: { asObject: true }` transport precisely so client code can use it, and the sibling admin client page `app/admin/users/page.tsx:34-36` already does exactly this. So the standard server pattern **does** apply here; no client-specific variant is needed. The fix is three lines:

```typescript
import { createLogger } from '@/lib/logger';
const logger = createLogger({ module: 'AdminAuditTrailPage' });
// …
logger.error({ err }, 'Failed to fetch audit logs');
```

Note the current call is `console.error(err)` with no message and no context — the Pino form is a strict improvement, not a like-for-like swap.

**This is flagged for the user's approval as its own task ([T5](#t5--convert-the-pages-one-console-call-to-pino-approval-gated)), in its own commit.** Per CLAUDE.md rule 3 it proceeds unless the user explicitly declines. Because it is one call in a file already being modified, the blast radius is a single line.

---

## Files to Create / Modify

| File | Action | Change shape |
|------|--------|---|
| `lib/audit/filterOptions.ts` | create | ~110 lines. `buildActionFilterGroups()` / `buildEntityTypeFilterOptions()` + the prefix-label rule list and humanisers. Pure, no I/O, no React, client-safe. Header documents Decision 2 (nothing excluded) and the registered-vs-observed limitation |
| `lib/audit/types.ts` | modify | **One line.** `import { NextRequest }` → `import type { NextRequest }` (`:4`). Makes client-safety explicit instead of relying on SWC elision |
| `lib/audit/events.ts` | modify | ➕ **Not in the original plan.** Registers `AGENT_EXECUTED`, which a live writer stores but the catalogue never had, plus a metadata entry identical to the fallback it has always been written under. See [Implementation Note 1](#implementation-notes--deltas-from-the-plan) |
| `app/admin/audit-trail/page.tsx` | modify | (1) import the two builders; (2) replace the Action `<optgroup>` block `:290-309` with a map over `buildActionFilterGroups()`; (3) replace the Entity Type `<option>`s `:359-360` with a map over `buildEntityTypeFilterOptions()`; (4) branch the count line `:395-403` on an active search term; (5) *(T5)* `console.error` → Pino; (6) *(T8, conditional)* an `AiAuditDetails` renderer |
| `lib/audit/requestSchemas.ts` | modify | Add `AdminAuditTrailQuerySchema` + export its inferred type, next to `AuditReadQuerySchema`. Reuses the file's `IDENTIFIER`, `positiveInt` and `firstIssueMessage`. **(T11/X-1)** Two "absent" preprocessors, not one: `optionalFilter` (`'' \| 'all' \| null`) for the three dropdowns, `optionalFreeText` (`'' \| null`) for `search` and the two dates |
| `app/api/admin/audit-trail/route.ts` | modify | (1) delete stale TODO `:45`; (2) parse `searchParams` through the schema → `400` on failure; (3) read filters from the parsed object instead of raw `get()`/`parseInt`; (4) dev-guard both `error.message` returns; (5) `catch (error: any)` → `unknown`. **No change to the query builder, the search block, the users join or the response shape** |
| `lib/audit/__tests__/filterOptions.test.ts` | create | Unit tests for the builders (see [Test Plan](#test-plan)). **(T11/X-3)** Plus the two-line assertion holding the duplicated `AI_ACTION_ENTITY_TYPE` equal to its twin in `requestSchemas.ts` |
| `lib/audit/__tests__/adminAuditTrailQuerySchema.test.ts` | create | ➕ **(T11/X-1)** Pure schema suite — no route, no mocks — pinning the `'all'` sentinel to the three dropdowns and keeping it off `search` and the dates |
| `app/admin/audit-trail/__tests__/filterOptions.guard.test.ts` | create | Source-level guard: `page.tsx` contains no hardcoded event / entity-type literal |
| `app/api/admin/audit-trail/__tests__/route.validation.test.ts` | create | Integration tests for the schema, the `NODE_ENV` guard, and the datetime-local regression |
| `app/admin/audit-trail/__tests__/searchTotals.render.test.tsx` | create | ➕ **(T12/BUG-1)** jsdom render of the real page: no total derived from the unfiltered count reaches the DOM under a search, and the pager's buttons are unchanged. The only rendering test in this diff — a source scan cannot distinguish a branched label from an unbranched one |

---

## Task List

> **All tasks ✅ complete, 2026-09-23.** Deltas from the plan are recorded in
> [Implementation Notes](#implementation-notes--deltas-from-the-plan) — read that section
> before the code review; one of them (T1) is a finding the plan did not anticipate.

### T0 — Branch setup (BLOCKER) ✅

- [x] ✅ **Cleared.** RM cut `feature/admin-ai-activity-slice-a` from `main`; `git branch --show-current` confirms it. Dev did not create it.
- [x] ✅ FR/AC references confirmed against the finalised requirement (confirm-only per C-2; no renumbering needed).

<details>
<summary>Original blocker text (for the record)</summary>

- [x] ⛔ **Escalate to TL before any code.** `git branch --show-current` reports `fix/next-font-build-flake`, and no `feature/*` branch matching this work exists (`git branch -a --list "*ai-activity*" "*admin-ai*"` → empty). Per the Dev role, **Dev does not create branches — RM does, at cycle kickoff.** Implementation cannot start until RM creates it (suggested: `feature/admin-ai-activity-slice-a`) and the name is recorded in this header.
- [x] Reconcile the provisional `FR-A#` / `AC-A#` references above against BA's finalised requirement, and correct them here.

</details>

### T1 — `lib/audit/filterOptions.ts` ✅

- [x] Created per [Approach A](#a-catalogue-driven-dropdowns). Actions from `AUDIT_EVENTS` (**not** `EVENT_METADATA` — V-9); entity types from `AUDIT_ENTITY_TYPES`.
- [x] Longest-prefix-wins group rules (sorted by prefix length at module load, so "longest wins" is structural not positional) with a guaranteed first-token fallback. `AI_` narrowed to `AI_PRICING_` (C-8.1); "Business OS AI" and "Business OS" pinned to the top of the group order (C-8.2).
- [x] `description` from `EVENT_METADATA[event]?.description`, optional; `getEventMetadata()` never used for labels.
- [x] Header documents: no exclusion mechanism and why; the escape hatch is a flag on `EventMetadata`, never JSX; the registered-vs-observed limitation.
- [x] ➕ **Unplanned, required:** registered `AGENT_EXECUTED` in `AUDIT_EVENTS` — see [Implementation Note 1](#implementation-notes--deltas-from-the-plan), the one finding that changed the diff.

### T2 — Make `lib/audit/types.ts` explicitly client-safe ✅

- [x] `import { NextRequest }` → `import type { NextRequest }`. One line, zero behaviour change (V-12). `npm run build` is the proof, and it passes.

### T3 — Wire the dropdowns ✅

- [x] Both `<select>`s now map over the builders. The `value="all"` sentinels, `<select>` classes, `onChange` handlers and the `FilterState` shape are unchanged (AC-A6).
- [x] `title={option.description}` on options that have one.

### T4 — Honest count line under search ✅

- [x] Branched per [Approach B](#b-honest-totals-without-fixing-search), taking SA's optional refinement (comment 4): with a search term active it shows `Showing N matches on this page`, keeps the honest `(Page n)` and drops the `of m` derived from the unfiltered count, and adds the one-line caveat. Prev/Next untouched.
- [x] ➕ **Completed in [T12](#t12--qa-fixes-bug-1--edge-2-2026-09-23).** The count line was branched but the pager's own `Page n of m` label was not, so the unfiltered total survived one `<div>` to the right. The branch now covers **every place the number is printed**; the buttons are still unbranched.

### T5 — Convert the page's one console call to Pino ✅ (user-approved)

- [x] **User approved 2026-09-22**, so the CLAUDE.md rule 3 gate is closed and recorded (C-9).
- [x] `createLogger({ module: 'AdminAuditTrailPage' })` at module scope; `logger.error({ err }, 'Failed to fetch audit logs')`. Both touched files are now `console.*`-free (page 1 → 0, route 0 → 0).

### T6 — `AdminAuditTrailQuerySchema` ✅

- [x] Added to `lib/audit/requestSchemas.ts` with the **eight snake_case** parameter names (C-4), the `'all'` / `''` preprocess, and the permissive date refinement that **validates without transforming** (C-5). `firstIssueMessage` is a **local** helper, not an import from `lib/business-os/**` (C-3).

### T7 — Route: validation + the two defects ✅

- [x] Parsed after the admin gate, before the first DB read. `400` + fixed `'Invalid query parameters'`; the Zod issue only behind the dev guard.
- [x] Stale TODO deleted.
- [x] Both `error.message` returns dev-guarded; `catch (error: unknown)` with an `instanceof Error` narrowing.
- [x] Diff confirmed limited to validation, the two defects and where the filter values are read from — the query builder, search block, users join and response shape are byte-identical apart from the three `x !== 'all'` conditions the schema made dead.

### T8 — Formatted AI detail renderer ✅ (SA ruled IN scope, R-1)

- [x] Detected by `log.entity_type === AI_ACTION_ENTITY_TYPE`, not by the action prefix (R-1.3).
- [x] Explicitly named fields only — an allow-list by construction, never a wholesale dump (R-1.2). Renders exactly AC-A5's list: area, action type, trigger, outcome (+ error code), calls, failed calls, input/output/total tokens, estimated cost, call names, models, grouping id.
- [x] **The generic dump is suppressed for AI rows** (R-1.1) — the latent double-render SA caught. Asserted by the guard test.
- [x] No ledger read, no fetch (R-1.4).

### T9 — Tests ✅

- [x] `lib/audit/__tests__/filterOptions.test.ts` — 17 tests.
- [x] `app/admin/audit-trail/__tests__/filterOptions.guard.test.ts` — 7 tests (4 no-literal / catalogue-driven, 3 on the AI renderer's allow-list and dump suppression).
- [x] `app/api/admin/audit-trail/__tests__/route.validation.test.ts` — 17 tests, including C-6 (unregistered identifier → 200), C-7 (non-admin + invalid query → **403**, and signed-out → **401**), and the date **rejection** case SA asked for alongside the acceptance one.

### T10 — Verification ✅

- [x] `npx jest lib/audit app/api/audit app/api/admin app/admin/audit-trail lib/admin/__tests__/admin-authz-surface.guard.test.ts` → **17 suites, 494 tests, all passing** (includes `auditAdminGate.test.ts` and the authz surface guard with `CAPS` untouched).
- [x] `npx jest lib/business-os/llm lib/repositories lib/services` → **39 suites, 487 tests, all passing** (regression cover for the `AUDIT_EVENTS` addition).
- [x] `npx tsc --noEmit` → **zero errors in any touched file**. (The repo-wide run needs `--max-old-space-size=8192` or it OOMs, and reports pre-existing errors elsewhere — `ExecutionRepository`, `reward_config` / `workflow_step` entity types — none of them in this diff.)
- [x] `npx eslint` on the touched files → **0 errors, 17 warnings; the pre-change baseline was 18.** No new warning introduced; one removed by `catch (error: unknown)`. `npm run lint:hooks` passes. (`npm run lint` / `next lint` cannot run: it does not recognise the repo's flat `eslint.config.js` and drops into interactive setup — pre-existing, unrelated.)
- [x] `npm run build` → **Compiled successfully**, confirming `lib/audit/*` in a client bundle (covers T2).
- [ ] **Manual (QA):** filter to each AI action and to `ai_action`; confirm counts and paging; confirm the search caveat appears only with a search term; expand an AI row and confirm **one** detail block, not two.

### T11 — SA code-review fixes X-1 / X-2 / X-3 ✅ (2026-09-23)

All three applied exactly as directed; **nothing else changed**. Details and the
one place Dev extended SA's direction are in
[Implementation Notes 8-10](#implementation-notes--deltas-from-the-plan).

- [x] **X-1 (High)** — `optionalFilter` keeps the `'all'` sentinel and now serves **only** the three dropdown parameters (`action`, `severity`, `entity_type`). New sibling `optionalFreeText` maps only `'' | null → undefined` and serves `search`, `date_from`, `date_to`. Both helpers carry a docblock saying which set they are for and why they are not one helper.
- [x] **X-1 test** — new pure schema suite `lib/audit/__tests__/adminAuditTrailQuerySchema.test.ts` (6 tests, no route, no mocks): `search: 'all'` survives; `'install'` / `'ALL'` / `' all '` survive; `''` and an absent key both mean absent; the three dropdowns still treat `'all'` as absent and real values still pass; the dates are not subject to the sentinel either, and `'2026-09-01T10:00'` still passes through byte-for-byte. **Verified failing before the fix** — reinstating `optionalFilter` on `search` reds exactly one assertion (`Expected: "all" / Received: undefined`).
- [x] **X-2 (Low)** — `isSearchActive` hoisted above `fetchLogs` and used to gate `params.append('search', …)`, so the request and the count line share one definition. The value sent is unchanged (the raw term); only the whitespace-only case changes, and it now consistently means "no search" on both sides.
- [x] **X-3 (Low)** — `lib/audit/__tests__/filterOptions.test.ts` imports `AI_ACTION_ENTITY_TYPE` from `../requestSchemas` under an alias and asserts the two copies are equal. The half-true anti-drift claim in `filterOptions.ts`'s docblock is corrected to say what `satisfies` does and does not pin, and points at the test.
- [x] **Re-run, same selection** — `npx jest lib/audit app/api/audit app/api/admin app/admin/audit-trail lib/admin/__tests__/admin-authz-surface.guard.test.ts` → **18 suites, 501 tests, all passing** (was 17 / 494: +1 suite, +7 tests). `CAPS` untouched; `auditAdminGate.test.ts` still green.
- [x] `npx eslint` on the four changed source files → **0 errors, 17 warnings**, byte-identical to SA's own run; the two new/changed test files → **0 problems**. `npm run lint:hooks` passes. (`npm run lint` is broken repo-wide — SA's separate chore.)
- [x] Scoped `npx tsc --noEmit` over `lib/audit/**` + both audit-trail directories → **only the two pre-existing errors SA named** (`admin-helpers.ts` `reward_config`, `ais-helpers.ts` `workflow_step`). Nothing in this diff.
- [ ] **Manual (QA), added by SA for X-1:** type `all` into the search box and confirm the rows are actually filtered, not a full page under a "matches" heading. Also type spaces only and confirm the page shows the ordinary `Showing N of M` total (X-2). *(QA 2026-09-23: both verified in code — the `all` case twice, including the mutation proving the old behaviour. Note EDGE-4 when eyeballing it.)*

### T12 — QA fixes: BUG-1 + EDGE-2 ✅ (2026-09-23)

QA's two items, and **nothing else**. EDGE-1, EDGE-3 and EDGE-4 are explicitly
left alone — EDGE-1 is a Gap B input, the other two are notes on pre-existing
behaviour.

- [x] **BUG-1 (Medium) — the pager printed the unfiltered total.** `page.tsx:574-578` now renders `` {isSearchActive ? `Page ${currentPage}` : `Page ${currentPage} of ${pagination.totalPages}`} ``. **Dev agrees with QA's reading of AC-A9** — see [Implementation Note 11](#implementation-notes--deltas-from-the-plan). Two lines in the label; the `pagination.totalPages > 1` gate on the whole pager, all four buttons and every `disabled` expression are byte-identical, so Non-Goal 2 / JC-4 is honoured in full.
- [x] **BUG-1 comment** — the note at `page.tsx:505-520`, immediately above the results count, no longer reads as if the whole pager were exempt. It now states the distinction QA drew: every place the count is **printed** is branched; what stays unbranched is the pager's **behaviour**, because the buttons page the unfiltered stream, which is what the route actually does.
- [x] **BUG-1 test** — new `app/admin/audit-trail/__tests__/searchTotals.render.test.tsx` (**6 tests**, jsdom, renders the real page against a fixture reproducing the route's `showing`-changes-but-`total`-does-not asymmetry). The load-bearing assertion is that **neither `717` nor `14332` appears anywhere in `document.body.textContent`** while a search is active. Two of the six pin the *other* half: the buttons all still render and keep their unfiltered enable/disable state. A source scan could not tell a branched label from an unbranched one, so this renders rather than greps.
- [x] **BUG-1 mutation-tested** — reverting the label to the unbranched `Page {currentPage} of {pagination.totalPages}` turns **4 of the 6 red**, `Expected: "Page 1" / Received: "Page 1 of 717"`. `page.tsx` restored byte-identically (`git hash-object` = `349a5ad6…` before and after).
- [x] **EDGE-2 (docs)** — `lib/audit/filterOptions.ts:10-14` now reads **149 registered events, of which 122 have a metadata entry**, measured and dated, with a note that the totals move on every registration and the load-bearing figure is the **gap of 27** (which is unchanged, and is what the test actually asserts). The requirement's FR-A3 ruling line carries the same correction; SA's earlier 146 → 148 paragraph is left as the record with a dated "superseded figure" note beneath it, so the doc does not contradict itself.
- [x] **Re-run, same selection + the new file** — `npx jest lib/audit app/api/audit app/api/admin app/admin/audit-trail lib/admin/__tests__/admin-authz-surface.guard.test.ts` → **19 suites, 507 tests, all passing** (was 18 / 501: +1 suite, +6 tests). `CAPS` untouched; `auditAdminGate.test.ts` and the authz surface guard still green.
- [x] `npx eslint` on the four changed source files → **0 errors, 17 warnings** — unchanged from T11 and from SA's run. The new test file → **0 problems**. `npm run lint:hooks` passes.
- [x] Scoped `npx tsc --noEmit` over `lib/audit/**` + both audit-trail directories → **only the same two pre-existing errors** (`admin-helpers.ts` `reward_config` ×4, `ais-helpers.ts` `workflow_step` ×1), in files this branch does not touch.
- [x] `npm run build` → **Compiled successfully**.
- [ ] **Manual (QA re-verification):** type a term into Search and confirm the pager on the right now reads `Page 1` with no `of 717` beside it; clear the term and confirm `Page 1 of 717` returns. Everything else QA already verified is unaffected.

---

## Test Plan

Minimum bar per CLAUDE.md: happy path + one failure path before commit. Existing coverage is credited rather than duplicated.

**Already covered — do not rewrite (V-11).** `app/api/admin/__tests__/auditAdminGate.test.ts` drives this route's `GET` through signed-out → 401, non-admin → 403, admin-check-throws → 403, and admin → 200, asserting no table is read before the gate passes. It must stay green after T7 (the schema parse goes **after** the gate, so the "no read before the gate" assertions still hold). **Adding an auth test here would be duplication.**

**New — 1. `lib/audit/__tests__/filterOptions.test.ts`** *(node env, pure)*

| Test | Asserts |
|---|---|
| Exhaustive actions | Flattening every group's options yields exactly `Object.values(AUDIT_EVENTS)` as a set — count and membership. This is the **AC-A3 property**: a new registry entry appears with no UI change |
| Exhaustive entity types | Options minus the `all` sentinel equal `AUDIT_ENTITY_TYPES` as a set |
| AI is selectable | `BUSINESS_AI_ACTION_COMPLETED` and `_FAILED` are present, grouped under "Business OS AI"; `ai_action` is present and labelled "AI Action" |
| No regression on the old hardcoded set | All 14 previously-hardcoded action values and both entity values are still offered — **including `USER_CREATED`, which has no `EVENT_METADATA` entry** (the V-9 trap) |
| Partition | Every event appears in exactly one group; no group is empty; no duplicate `value` anywhere |
| Unknown prefix falls back | A synthetic `ZZZTEST_SOMETHING_HAPPENED` routed through the grouping helper produces a group rather than being dropped — proves the label map cannot exclude |
| Labels are human | No label contains `_`; no label is the string `Unknown event: …` |

**New — 2. `app/admin/audit-trail/__tests__/filterOptions.guard.test.ts`** *(source scan; precedent: `app/api/plugins/__tests__/dead-plugin-routes-removed.guard.test.ts`, `lib/__tests__/system-initializer-removed.guard.test.ts`)*

- `readFileSync(page.tsx)` contains **no** `<option value="…">` whose value is an `AUDIT_EVENTS` value or an `AUDIT_ENTITY_TYPES` value (the `all` sentinels and the three severity values are allow-listed, with a comment saying severity is a TS-only union with no runtime array — see [OQ-2](#open-questions-for-sa)).
- The file imports from `@/lib/audit/filterOptions`.

This is the guard against the hardcoded-dropdown regression coming back, and it is what makes AC-A3 real rather than aspirational. It runs in the default `node` environment — no jsdom, no `UserProvider` mock, no rendering.

**New — 3. `app/api/admin/audit-trail/__tests__/route.validation.test.ts`** *(mocks copied from `auditAdminGate.test.ts`: `getUser`, `AdminAccessService`, `@/lib/logger`, and the proxy `@supabase/supabase-js` builder that records tables read)*

| Test | Asserts |
|---|---|
| **Happy path** — admin + `action=BUSINESS_AI_ACTION_COMPLETED&entity_type=ai_action` | 200; `audit_trail` read; `.eq` called with both values |
| **Failure path** — `page=abc` | 400, not 500; **no** table read (today this is a `NaN` range and a 500) |
| **Regression** — `date_from=2026-09-01T10:00` (the real `datetime-local` format) | 200, accepted. Locks the trap in [C](#c-zod-on-the-route) item 3 |
| **Regression** — `action=all` | 200 and **no** `.eq('action', …)`, preserving the sentinel |
| **`NODE_ENV` guard, production** | With `NODE_ENV='production'` and the query erroring, the body's `error` is the fixed string and `details` is absent — the raw message appears nowhere in `JSON.stringify(body)` |
| **`NODE_ENV` guard, development** | Same scenario with `NODE_ENV='development'` → `details` present. Proves the guard is a guard, not a deletion |

**Manual (QA), recorded in the QA section below** — E2E is not set up (CLAUDE.md § Testing):

1. `/admin/audit-trail` → Action dropdown shows a "Business OS AI" group with both events; Entity Type shows "AI Action".
2. Select each in turn; list shows only matching rows; "Showing X of Y" and "(Page n of m)" are internally consistent and paging reaches every row once.
3. Type a search term; confirm the total disappears and the caveat appears; clear it; confirm the total returns.
4. Regression: severity, date and the AIS detail renderers behave as before.

---

## Risks

| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| R-1 | **Zod rejects `datetime-local` values** and silently breaks both date filters | **High** if `.datetime()` is used naively | Permissive `Date.parse` refinement + a dedicated regression test (Test 3) |
| R-2 | A 148-option dropdown is unusable in practice | Medium | SA ruled `<optgroup>`s acceptable; prefix grouping yields ~28 named groups. A searchable control is explicitly optional polish. Revisit only if QA reports it |
| R-3 | Driving from `EVENT_METADATA` drops 27 events — including `USER_CREATED`, currently offered | **Was high**, now designed out | Decision 1; asserted by the "no regression on the old hardcoded set" test |
| R-4 | `lib/audit/*` entering a client bundle pulls `next/server` in | Low | T2 makes the import type-only; `npm run build` in T10 confirms |
| R-5 | A reviewer "helpfully" converts the route to `requireAdmin` | Medium | [Non-Goal 1](#non-goals), stated with the exact cost (two allow-list deletions **plus** two cap decrements in `lib/admin/__tests__/admin-authz-surface.guard.test.ts` — **not** the workflow file, V-6) |
| R-6 | Scope creep into the search fix | Medium | [Non-Goal 2](#non-goals); acceptance never uses search; T4 changes wording only, not pager behaviour |
| R-7 | The catalogue does not cover values already in the table | Low, inherent | Documented limitation; "All Actions" unaffected; noted for Gap B |
| R-8 | Concurrent BA edits invalidate the FR/AC numbering | **Certain** | T0 reconciliation step before implementation |
| R-9 | FR-A5 ambiguity leads to building or skipping the wrong thing | Medium | [OQ-1](#open-questions-for-sa); T8 gated on an explicit ruling |

---

## Non-Goals

Stated so a reviewer does not add them.

1. **Do NOT convert `app/api/admin/audit-trail/route.ts` to `requireAdmin`.** This is admin-authz slice 4, deliberately parked. The route is allow-listed on both `R1_PARKED` (`:226`) and `R2_PARKED` (`:240`) **in `lib/admin/__tests__/admin-authz-surface.guard.test.ts`** — the workflow `.github/workflows/admin-authz-guard.yml` only runs that test. `CAPS` (`:326`) asserts **equality**, so converting requires deleting two entries *and* dropping `CAPS.R1.parked` 7→6 and `CAPS.R2.parked` 7→6 in the same commit, or the required `Admin authz surface guard` check blocks the merge. There is **no security gain**: the inline check at `:29-43` is behaviourally correct and fails closed. Touching the file for an unrelated reason does not trip the guard — entries are keyed per file, not per diff.
2. **Do NOT fix the free-text search.** `:96-98` + `:172` is a real defect; it is spun out as its own item needing a DB-level predicate and a filtered count. Slice A only stops the UI *claiming* the search is table-wide. Acceptance never uses search.
3. **Do NOT remove or change the email / `full_name` display.** `route.ts:153-167` and `page.tsx:533, 568` are pre-existing and deliberate: this is the compliance browser, where the operator needs a human identifier. NFR-2 ("never emails or business names") scopes to the **new Gap B view** (SA-10). Slice A leaves it **exactly** as-is — neither removed nor widened.
4. **Do NOT touch the generic `details` / `changes` renderer** (`page.tsx:787-802`), which dumps owner-bearing entity types. Out of scope (SA-11) and unchanged in either direction.
5. **No new DB access, no repository change, no migration, no index** (V-14). The `action` / `entity_type` filters already exist on the route.
6. **Do NOT convert the route's inline service-role client to a repository.** F-11 debt, inherited by Gap B / the repo-conformance sweep. The mandatory repository rule governs *new* access; Slice A adds none.
7. **No new API route and no new page.**
8. **Do NOT introduce `isAiAuditFilter()` into this route.** It guards the owner read path; using it here would block the filter this slice exists to add.
9. **Do NOT change `AuditTrailService`, `AuditTrailRepository`, or anything the owner sees** (`/monitoring`, its CSV export, `UsageCard`).
10. **Do NOT add a searchable/combobox control.** SA called it optional polish; a plain grouped `<select>` ships first.

---

## Open Questions for SA

> **All three ruled by SA on 2026-09-22** — OQ-1 **in scope** (build T8, with four conditions), OQ-2 **deferred** (optional on strict terms), OQ-3 **confirmed** (no exclusion mechanism). See [SA Review Notes](#sa-review-notes) § Rulings.

- [x] **OQ-1 — Is FR-A5 (the formatted AI detail renderer) in Slice A or not?** It appears in the requirement's Gap A (FR-A5, AC-A5) and in SA's slicing row for Slice A ("formatted AI details", "keep it minimal"), but it is **absent from the six-item authoritative scope handed to Dev**. The two disagree. Building it risks scope creep against the brief; skipping it fails AC-A5. **Dev's recommendation: include it** — it is a pure presentation pass over the closed, already-safe `AiAuditDetails` shape (~40 lines, no new data), it is the difference between "AI rows are findable" and "AI rows are readable", and re-opening `page.tsx` later costs more than doing it now. **T8 is gated on this ruling.**
- [x] **OQ-2 — Should the Severity dropdown also be catalogue-driven?** It is hardcoded (`page.tsx:321-324`) exactly like the other two, but `AuditSeverity` (`lib/audit/types.ts:12`) is a **type-only union with no runtime array**, unlike `AUDIT_ENTITY_TYPES` and `COMPLIANCE_FLAGS`. Deriving it means adding an `AUDIT_SEVERITIES` runtime const and deriving the type from it — a ~4-line change, consistent with the file's own pattern, which would close the same class of defect on the third dropdown. **Dev's recommendation: yes, it is cheap and consistent** — but it is outside the stated scope, and the guard test's allow-list depends on the answer. SA to rule.
- [x] **OQ-3 — Confirm no exclusion mechanism** ([Decision 2](#a-catalogue-driven-dropdowns)). Dev's position: none, on a platform-admin-only compliance browser, and if one is ever needed it belongs on `EventMetadata` in the catalogue, never in JSX. Flagged because the brief explicitly asked the question and the answer is "nothing" — SA should confirm rather than assume it was overlooked.

---

## Implementation Notes / deltas from the plan

Written at implementation (Dev, 2026-09-23). Everything here is a place the code
differs from the plan, or a place the tree differed from what the plan assumed.

**1. 🔴 The plan's "no regression on the old hardcoded set" test failed — and it was right to.**
Two of the fourteen action values the old JSX offered are **not in `AUDIT_EVENTS`**:

| Value | Status in the tree | Decision |
|---|---|---|
| `AGENT_EXECUTED` | **Written live** on every agent run (`app/api/run-agent/route.ts:644`, via `auditLog`), so real rows carry it — it was reachable *only* because the page hardcoded it | **Registered in `AUDIT_EVENTS`.** A purely catalogue-driven list would have made those rows unfilterable — a real AC-A6 regression |
| `USER_UPDATED` | **No writer anywhere in the tree** (only the page's own icon helper matches the string) | **Not registered.** It was a dead option; "All Actions" still reaches any historical rows |

This is the registered-vs-observed limitation the module header documents, hitting
a live writer. The fix is at the root cause — the writer used an unregistered
event — not a hand-maintained "extras" list in the UI, which is the design SA
rejected. `EVENT_METADATA[AGENT_EXECUTED]` is deliberately `{ severity: 'info' }`
with **no** compliance flags, which is byte-identical to the
`getEventMetadata()` fallback it has always been written under, so stored rows do
not change (the WC-12 rule in `lib/audit/__tests__/stepZeroRegistrations.test.ts`).
**This adds `lib/audit/events.ts` to the changed-file list — SA should confirm it.**

**2. The generic *changes* dump is deliberately NOT suppressed for AI rows** (only the
*details* dump is, per R-1.1). `buildAiAuditEntry` writes no `changes` at all
(`aiActionAudit.ts:208-209` says so explicitly), so a second condition would be dead
code — and if a row somehow did carry `changes`, hiding it in a compliance browser
is worse than showing it. Flagged rather than assumed.

**3. `severity` is validated as an enum, not as a permissive identifier.** C-6's
asymmetry argument is about values the live table holds that were never
registered; the `severity` column is a closed three-value union enforced by a CHECK
constraint, and the sibling `AuditReadQuerySchema` already enums it. Consequence:
`?severity=foo` now returns **400** where it previously returned 200 with zero rows.

**4. `page_size` is capped at 200.** The route asks the database for `pageSize × 5`
on the search path, so an uncapped value is a cheap way to pull 5 × N rows through a
service-role client. The page sends 20; nothing else calls this route.

**5. `AI_ACTION_ENTITY_TYPE` is defined locally in `filterOptions.ts`**, not imported
from `requestSchemas.ts` (SA comment 9's cheaper option), so the client bundle does
not pull in `zod`. It is `satisfies EntityType`, which pins it to the catalogue union —
but **not** to the other copy, as SA's X-3 notes. ✅ The two are now held equal by test
(T11); the docblock's original "cannot drift without a compile error" claim was half
true and has been corrected in the code.

**6. The count line keeps `(Page n)` and drops only `of m`** under an active search —
SA's optional refinement in comment 4, taken. ⚠️ **Incomplete as originally written — see
[Note 11](#implementation-notes--deltas-from-the-plan) (QA BUG-1).** This note said "the count
line", and that is literally all that was branched; the pager printed the same suppressed
number fifty lines lower.

**7. `npm run lint` does not work in this repo** (`next lint` does not recognise the
flat `eslint.config.js` and prompts for interactive setup). Used `npx eslint` directly
plus `npm run lint:hooks`. Pre-existing and unrelated to this slice; worth one line in
a retrospective.

**8. X-1 — SA's diagnosis is correct and the fix is the one SA specified.** Re-derived it
in the code rather than taking it on report: `optionalFilter` really was on all six
optional parameters, and a search for the literal `all` really did parse to
`search: undefined`, skip `if (search)` in the route, and return the unfiltered page under
the `Showing N matches on this page` heading T4 had just added. The split is two helpers
rather than one parameterised helper on purpose — `optionalFilter(schema, { allowAll })`
would put the decision at each call site, where the next person copying a line gets it
wrong silently. Two named helpers make the wrong one visibly wrong.

**9. One extension to SA's X-1 direction, flagged rather than assumed.** The direction named
`search` as the defect and grouped the two dates with it. The dates behave differently:
`date_from=all` was never *silently* dropped in a way a user could mistake for a filter — with
`optionalFilter` it parsed to `undefined` (no date filter, and no caveat is shown for dates),
and with `optionalFreeText` it now reaches the refine and returns **400**. That is a behaviour
change on the dates that X-1 did not strictly require. It is right — the page can only ever
send a `datetime-local` value or `''`, and "not a date" is better answered than ignored — but
it is a change, so it is recorded here and asserted in the test rather than left to be found.

**10. X-2 gates but does not trim.** SA offered "gate the append on the same trimmed value" or
"hoist `isSearchActive`"; the hoist is taken. The raw term is still what gets sent, so a search
for `  foo  ` behaves exactly as it does today. Only the whitespace-only case changes, which is
the case SA reported. Trimming the sent value would have been a second, unrequested behaviour
change on the search path.

**11. QA's reading of AC-A9 is right, and Dev's `:506-512` comment was the thing that made the
gap survive three reviews.** Re-derived in the code rather than taken on report.

`pagination.totalPages` is `Math.ceil(unfilteredCount / pageSize)` (`route.ts:201`), and
the pager label printed it unconditionally. So with a search term the card genuinely read
*"Showing 2 matches on this page (Page 1) — Search scans only the current page…"* beside
*"Page 1 of 717"* — the caveat and the refutation of the caveat in one card.

The distinction that matters, and the one the old comment blurred:

| | In scope for AC-A9 | Status |
|---|---|---|
| The **number printed** in the pager label | ✅ Yes — AC-A9 / FR-A4b are about what the page **displays** | Branched in T12 |
| First / Previous / Next / Last and their `disabled` logic | ❌ No — Non-Goal 2 and SA's JC-4 exempt the **behaviour** | Untouched, and pinned by test |
| The `pagination.totalPages > 1` gate on the whole pager | ❌ No — that is behaviour too | Untouched |

Dev's original comment was correct about the buttons and said nothing about the label, which
reads as a blanket exemption for everything inside that `<div>`. SA's JC-4 and QA's first
pass both then reasoned from it. That is the actual failure here: **a comment that justified
more than it had established.** It has been rewritten to name what is branched and what is
not, and the six new render tests assert both halves so the next reader does not have to
trust the prose.

No disagreement with QA on any part of BUG-1, including the severity.

---

## SA Review Notes

**Reviewed by SA — 2026-09-22**
**Status:** ✅ **Approved, conditional on C-1 to C-9 below.** No second workplan review is needed — fold the conditions in, unblock T0, and implement. The next SA gate is the code review.

This is a good workplan. The Verification Log is the reason: Dev re-derived every claim in the brief instead of trusting it, found five errors in it — **three of mine** — and two of those change the design rather than the wording. **All of the Verification Log was independently re-checked by SA against the tree and V-1 to V-14 all hold as Dev states them.** That is the standard.

Nine conditions follow. Two are defects that would ship (C-3, C-4), three are rulings Dev asked for (C-5, C-6, C-7), and the rest are tightenings.

---

### Rulings Dev asked for

**R-1 (OQ-1) — FR-A5 / the formatted AI detail renderer is IN Slice A. Build T8.**

The requirement governs, not the six-item scope list: FR-A5 and AC-A5 are in Gap A, and SA's own slicing row for Slice A says "minimal formatted AI details". The omission from the brief was the brief's, not Dev's, and Dev was right to gate rather than guess. Dev's recommendation to include it is accepted — re-opening `page.tsx` later costs more than the ~40 lines now, and "findable but unreadable" is half a feature.

Four conditions on T8, one of which is a bug Dev has not noticed:

1. ⚠️ **The generic dump must be suppressed for AI entries.** The fallback at `page.tsx:787` is gated on `!log.action.startsWith('AIS_')` **only**. Add the formatted block without a second condition and an AI row renders the labelled values **and then the raw key/value dump underneath** — duplicated, and the unformatted list FR-A5 exists to replace stays on screen. Extend the guard, and assert it: expanding an AI row shows the formatted block and **no** "Event Details" dump.
2. **Render explicitly named fields — never `Object.entries(details)`.** An allow-list by construction, so a key added to `AiAuditDetails` later cannot appear on an admin screen without a review. The shape is genuinely safe today (`aiActionAudit.test.ts:280` pins it at exactly 16 keys, and `correlationId` is admitted only when it matches `SAFE_CODE`, `aiActionAudit.ts:205`) — keep it that way by construction rather than by luck.
3. **Detect the entry by `entity_type === 'ai_action'`, not by the action prefix.** That matches FR-A2 and is outcome-independent, so `_COMPLETED` and `_FAILED` take the same path.
4. **No ledger read**, as already stated. If T8 starts wanting a cost breakdown, stop — that is FR-B2.

**R-2 (OQ-3) — no exclusion mechanism. Confirmed, exactly as Dev proposes.**

Dev's reasoning is right and SA re-verified the load-bearing half: `isAiAuditFilter` has exactly **one** consumer in the tree, `lib/repositories/AuditTrailRepository.ts:84`, reached from the owner read path. It is not on this route and must not be introduced to it — doing so would block the filter this slice exists to add. Add it to the Non-Goals list (Dev already has, as #8) and keep Decision 2's escape hatch **documented and unbuilt**: if an event ever must be hidden, it gets a flag on `EventMetadata`, never a list in JSX. A hand-maintained exclusion list is the rejected design wearing a hat, and Dev named it as such.

**R-3 (OQ-2) — the Severity dropdown: defer. Optional, on strict terms.**

Default answer: **leave it hardcoded in Slice A** and record a one-line follow-up. Reasons: no requirement asks for it; the three values are a closed union that has not changed; and the defect class FR-A3 fixes — a registry that grows while the JSX does not — does not really apply to a three-value type where adding a member is a compile-visible edit. Against that, Dev's change would touch `lib/audit/types.ts`, a file on the server write path, which **T2 is already touching for an unrelated client-safety reason**; mixing the two muddies a review of the one-line change that actually matters.

**If Dev still prefers to do it**, it is permitted on three terms: it is its own final commit after T1–T7 are green; `AuditSeverity` stays structurally identical (`'info' | 'warning' | 'critical'`, derived from the new const); and **`AuditReadQuerySchema`'s `z.enum(['info','warning','critical'])` (`requestSchemas.ts:57`) is derived from the same const in the same commit** — collapse all three duplications or none. Two out of three is worse than zero.

---

### Conditions

**C-1 (High) — T0 stands. It is a real blocker and RM owns it.**
Confirmed: `git branch --show-current` → `fix/next-font-build-flake`; `git branch -a --list "*ai-activity*" "*admin-ai*"` → empty. Dev is right not to create it. Escalated to TL: **RM must cut the branch** (`feature/admin-ai-activity-slice-a` is a fine name) before T1.

**C-2 (Low) — the FR/AC reconciliation is a confirm-only step, not a rewrite.**
BA's requirement is now final and SA has re-checked it. SA cross-read every `FR-A#` / `AC-A#` this workplan cites against the finalised document: **all of them still mean what the workplan assumes** (FR-A3 catalogue-driven, FR-A4 honest totals, FR-A5 AI details, FR-A7 the two defects, FR-A8 the non-goals; AC-A3 guard test, AC-A5 AI details, AC-A6 regression + scoped privacy). Two deltas to pick up:
- FR-A3's SA ruling in the requirement said "146 events". **Corrected to 148** on the re-check, crediting Dev's measurement. Dev's Decision 1 is now the requirement's position, not a departure from it.
- AC-A8 and FR-A7 cited `:111` / `:194`. **Corrected to `:110` / `:193`** in the requirement. Dev's V-3 was right.
Drop the "Numbering is provisional" warning once confirmed.

**C-3 (High) — `firstIssueMessage` is not where the workplan says it is, and importing it would invert a layer.**
Approach C item 6 and the Files table both read as though `firstIssueMessage()` lives in `lib/audit/requestSchemas.ts` at `:121`. It does not. It is `lib/business-os/usage/llmUsageVerification.ts:121`, and that module value-imports `./usageCategories` and `./usageSummary`. Importing it into `lib/audit/requestSchemas.ts` would create

> `lib/repositories/AuditTrailRepository` → `lib/audit/requestSchemas` → `lib/business-os/usage/*`

— a generic audit module taking a dependency on Business OS, which is the precise class of coupling the Layer 1.1 RC-7 import ban exists to prevent (`tokenUsageRepository.contract.test.ts:90`). The ban is asserted on `TokenUsageRepository`'s own source text, so this chain would not trip it; that makes it easier to do, not more acceptable.
**Define a two-line local helper in `lib/audit/requestSchemas.ts`** (or lift a shared one into `lib/` if a third caller ever appears). Do not import across the boundary. The same rule applies to the `BusinessListQuerySchema` precedent in Approach C item 5: copy the *pattern*, import nothing.

**C-4 (High) — the schema must use the route's snake_case parameter names, and there are eight of them, not seven.**
The page sends `action`, `severity`, `entity_type`, `date_from`, `date_to`, `search`, `page`, `page_size` (`page.tsx:67-75`) and the route reads exactly those (`route.ts:48-56`). The sibling schema in the same file, `AuditReadQuerySchema`, uses **camelCase** `entityType`. Copy-pasting it is the single most likely way to silently drop `entity_type`, `date_from`, `date_to` and `page_size` — the same failure class as R-1, and equally invisible, because an absent optional key parses clean and the filter just stops working. Pin the eight names in the schema and assert `entity_type` in the happy-path test (the plan already does — keep it). Approach C says "seven parameters"; `severity` is the one that goes missing when people count, and it is the only one that is already an enum.

**C-5 (High) — the date schema validates, it must not transform.**
Dev's ruling on `.datetime()` is **accepted and is the most valuable finding in the plan**: `type="datetime-local"` emits `2026-09-01T10:00`, `z.string().datetime()` rejects it, and both date filters would have died silently. Verified at `page.tsx:331` and `:344`.
The hard condition on the fix: **the refinement checks `Number.isFinite(Date.parse(v))` and passes the original string through unchanged.** It must not normalise to ISO or to UTC. `created_at` is `timestamptz` and the route hands the raw string to `.gte()` / `.lte()` (`route.ts:84-90`); a value with no offset is already resolved by the server's timezone today, and "helpfully" normalising it in the schema would shift every existing date filter by that offset while the tests — which only assert a 200 — stayed green. Add a one-line comment saying so, because this is exactly the change a later reader makes in good faith.

**C-6 (Medium) — permissive identifiers over an enum: accepted, and lock it with a test.**
Dev's reasoning holds and is properly grounded in the documented read/write asymmetry (`requestSchemas.ts:6-14`): a read filter is not a security boundary, the repository scopes owner reads, and the live table holds values that were never registered. An `AUDIT_EVENTS` enum would make previously-reachable rows unreachable — a regression, and it would also collide with the registered-vs-observed limitation Dev documents in `filterOptions.ts`.
**Add the test that locks it:** a well-formed but **unregistered** `action` (e.g. `SOME_LEGACY_EVENT`) returns 200 and is passed to `.eq('action', …)`. Without it, the next reviewer tightens this to an enum, every test stays green, and rows silently disappear from a compliance browser.

**C-7 (Medium) — the test boundary is right; add the ordering assertion neither file covers.**
Confirmed: `app/api/admin/audit-trail/` contains `route.ts` only, and the route is covered from `app/api/admin/__tests__/auditAdminGate.test.ts` — 401 / 403 / check-throws / 200, all asserting `mockTablesRead` is empty before the gate passes, driven through `describe.each` over three routes. **My claim in the brief was wrong; Dev's V-11 is right.** Scoping the new file to validation and the `NODE_ENV` guard is the correct boundary and re-testing auth there would be duplication.
One addition, because it is the invariant most likely to be broken by a future refactor and **no test covers it today**: **a non-admin sending an invalid query must get 403, not 400.** That is the "gate first, then parse" ordering, and the natural tidy-up ("validate the input at the top of the handler") inverts it and leaks the existence of a validation surface to an unauthenticated caller. One test, in the new file.
Also note the existing happy path calls the route with `?page=1` — the new schema must keep that green, and it will.

**C-8 (Medium) — two corrections inside `lib/audit/filterOptions.ts`.**
The module is approved: pure, node-testable, reusable by Gap B, and it is what makes the guard test a trivial source scan. The longest-prefix-wins rule list **with a mandatory fallback** is the right shape, and asserting the fallback by routing a synthetic `ZZZTEST_…` through it is exactly the test that proves the label map cannot become an exclusion list. Two corrections:
1. **Narrow the `AI_` rule to `AI_PRICING_`.** The only `AI_*` events today are the five `AI_PRICING_*` (`AI_PRICING_CREATED / UPDATED / DELETED / SYNCED / ZERO_SET`). A rule on `AI_` will mislabel any future `AI_ANYTHING_ELSE` as "AI Pricing" — a wrong label survives review far more easily than a missing group, and it quietly defeats the fallback that is the design's safety property. Match what exists; let the fallback handle what does not.
2. **Do not bury "Business OS AI" in an alphabetical list of ~28 groups.** Pin it (and "Business OS") to the top of the group order. This is the group the slice exists to add, and alphabetical-by-label puts "Agent Intelligence Score" and "AgentKit" above it. Cosmetic, cheap, and it is the first thing QA will look for.

**C-9 (Low) — T5 is correct, and the approval must be resolved before code review, not at it.**
Verified: one `console.error(err)` at `page.tsx:90`, zero in the route. Verified the client-component question too — `lib/logger.ts:15-20` configures `browser: { asObject: true }`, and `app/admin/users/page.tsx:34`/`:36` already calls `createLogger` at module scope in a `'use client'` page. Dev's conclusion is right: the standard pattern applies, no client variant is needed, and `logger.error({ err }, 'Failed to fetch audit logs')` is a strict improvement over a bare `console.error(err)` with no message and no context.
Per CLAUDE.md § Logging this proceeds unless the user **explicitly** declines. **Raise it now, not at implementation time** — a file left on `console.*` at code review without a recorded decline is a 🔄 Fix Required, and this one is a single line in a file already being modified.

---

### Comments — assessed and accepted, no action needed

| # | Item | SA position |
|---|---|---|
| 1 | **Decision 1: `AUDIT_EVENTS`, not `EVENT_METADATA`** | ✅ **Correct, and it overrides my FR-A3 ruling.** Re-measured: `AUDIT_EVENTS` has **148** entries, `EVENT_METADATA` **121**, and `USER_CREATED` is in the 27-item gap **while being offered by the hardcoded JSX today** (`page.tsx:301`). A metadata-driven dropdown is a **regression**, not an omission. `getEventMetadata()`'s fallback really does return the literal `Unknown event: X` (`events.ts:926-931`), unusable as a label. Description-as-`title` is the right use of the metadata. The requirement has been corrected to say 148 |
| 2 | **Error-leak line numbers** | ✅ **Dev is right, I was wrong.** The leaks are `route.ts:110` (`'Failed to fetch audit logs: ' + error.message`) and `:193` (`error.message \|\| 'Internal server error'`); `:111` / `:194` are the `{ status: 500 }` lines. The requirement's FR-A7 and AC-A8 are corrected |
| 3 | **Guard allow-lists live in the test, not the workflow** | ✅ **Dev is right.** `R1_PARKED` declared at `:198` with the audit-trail entry at `:226`; `R2_PARKED` at `:238` with its entry at `:240`; `CAPS` at `:326` is `R1 { parked: 7 }`, `R2 { parked: 7, permanent: 1 }`, asserted by **equality**. The workflow only runs the test. The "two deletions plus two cap decrements, same commit" conclusion stands, and Non-Goal 1 states it accurately. Touching the file for an unrelated reason does not trip the guard — entries are keyed per file |
| 4 | **Approach B — honest count under search** | ✅ Sound, and correctly scoped. One optional refinement: `currentPage` is honest (it is the real offset page); only `totalPages` is not. Consider keeping `Page n` and dropping only `of m`, rather than suppressing the indicator entirely — an operator who can page but cannot see which page they are on is a small new confusion. Dev's call; either satisfies AC-A9 |
| 5 | **T2 — `import type { NextRequest }`** | ✅ Approved. Verified `lib/audit/types.ts:4` is a value import used **only** at `:154` in a type position, and the file has no other server import. SWC would elide it; relying on that is avoidable for one keyword. Keep `npm run build` in T10 — that, not the keyword, is the actual proof |
| 6 | **Test plan** | ✅ Strong — the exhaustiveness, partition and fallback tests turn AC-A3 from aspiration into a property, and the `USER_CREATED` regression case is the right way to pin the V-9 trap. Additions: C-6's unregistered-identifier test, C-7's ordering test, and a **date-rejection** case (`date_from=notadate` → 400) — the plan has the acceptance case for dates but not the rejection case, and a refinement that accepts everything would pass it |
| 7 | **The source-level guard test** | ✅ Approved, with good precedent (`dead-plugin-routes-removed.guard.test.ts`, `system-initializer-removed.guard.test.ts`). Allow-listing the three severity values with a comment is correct under R-3 |
| 8 | **Non-Goals 1–10** | ✅ All correct and all verified. In particular #3 (leave `user_email` exactly as-is) matches the requirement's SA-10 scope note, and #6 (no repository conversion) is right: the mandatory repository rule governs **new** DB access, and V-14 confirms Slice A adds none. That reasoning must not be reused in Gap B, which adds plenty |
| 9 | **`AI_ACTION_ENTITY_TYPE` on a client page** | Importing it from `requestSchemas.ts` pulls `zod` into the client bundle. Acceptable; a local constant in `filterOptions.ts` is cheaper. Dev's call, not a condition |

### Optimisation Suggestions

- `<option title={…}>` is not reliably exposed to assistive technology and is not keyboard-discoverable. Fine as the *optional extra* Dev describes — just do not let the description become the only place an option's meaning lives. The derived labels carry the meaning; keep it that way.
- R-2 (a 148-option select) is correctly parked behind "revisit only if QA reports it". With C-8.2's pinned groups the AI events are two keystrokes away, which is most of the benefit of a combobox for none of the cost.
- Add a closing step to T10: tick the AC-A boxes in the requirement and add a Change History row to this workplan. The cycle's docs are part of the deliverable.

### Code Review — what I will check

Recorded now so there are no surprises: the generic-dump suppression for AI entries (C-3 of R-1); the eight snake_case parameter names; that the date refinement transforms nothing; no `lib/audit/**` → `lib/business-os/**` import; zero `console.*` in both touched files, or a recorded decline; `npm test -- lib/admin/__tests__/admin-authz-surface.guard.test.ts` green with `CAPS` untouched; and the diff on `route.ts` limited to validation, the two defects and where the filter values are read from.

### Approval

- [x] **Workplan approved** — proceed to implementation once **C-1 (the branch)** is cleared by RM, with C-2 to C-9 and rulings R-1 to R-3 folded in.
- [x] T8 is **in scope** (R-1). T5 proceeds unless the user explicitly declines (C-9). OQ-2 is **deferred** (R-3).
- [ ] Re-review of this workplan: **not required.**

---

---

**Code Review by SA — 2026-09-23**
**Status:** 🔄 **Fix Required — one High item (X-1) and two trivial ones (X-2, X-3).** Everything else in the diff is approved, including all five judgement calls Dev raised. The three fixes are ~6 lines plus two assertions; **no third SA pass is required** — Dev applies them, and the work goes on to the user view and QA.

Reviewed against `main` (`git diff main` over the six modified files, plus the three new test files and `lib/audit/filterOptions.ts`). Re-ran `npx jest lib/audit app/api/audit app/api/admin app/admin/audit-trail lib/admin/__tests__/admin-authz-surface.guard.test.ts` → **17 suites / 494 tests green**. `npx eslint` on the four changed source files → **0 errors, 17 warnings**, all pre-existing `no-explicit-any`. Type-checked the touched files through a scoped `tsconfig` (`include` limited to `lib/audit/**`, `app/api/admin/audit-trail/**`, `app/admin/audit-trail/**`): **the only errors are the two pre-existing ones Dev named** (`admin-helpers.ts` `reward_config`, `ais-helpers.ts` `workflow_step`), neither in this diff. **SA made no code changes** — the diff the user reads is Dev's work plus whatever Dev does for X-1 to X-3.

---

### Rulings on the five judgement calls

**JC-1 — registering `AGENT_EXECUTED` in `lib/audit/events.ts`: ✅ correct, correctly placed, and behaviour-neutral. It belongs in this slice.**

Verified independently, and the evidence is stronger than Dev claimed:

- **Root cause is the right place.** The alternative — a hand-maintained "extras" list in the UI or in `filterOptions.ts` — is the rejected hardcoded list wearing a hat (Decision 2, R-2). A live writer emitting an unregistered event is a catalogue defect, and the catalogue is where it gets fixed. `USER_UPDATED` staying unregistered is equally right: registering an event nothing writes would invent a filter that can only ever return zero rows, and `AUDIT_EVENTS` would stop meaning "what this system records".
- **Behaviour-neutral for stored rows — confirmed at the write path, not by inspecting the metadata alone.** `AuditTrailService.buildLogEntry` consumes exactly two fields from metadata: `severity: input.severity || metadata.severity` and `compliance_flags: input.complianceFlags || metadata.complianceFlags || []`. `description` is **never persisted**, so the new `'Agent executed'` string cannot change a row. And the writer at `app/api/run-agent/route.ts:666` passes `severity` **explicitly** (`normalizedResult.success ? 'info' : 'warning'`), so metadata severity is not even consulted for this event; the absent `complianceFlags` resolves to `[]` under both the old fallback and the new entry. Byte-identical on both fields that exist. WC-12 satisfied.
- **No blast radius.** `AUDIT_EVENTS` has exactly one non-test consumer in the tree (`lib/audit/filterOptions.ts:168`); everything else reads named members. Critically, registration does **not** widen the browser write surface: `CLIENT_WRITABLE_EVENTS` (`requestSchemas.ts:142-153`) is an explicit ten-entry list and `AuditWriteBodySchema` refines against that set, not against `AUDIT_EVENTS`. Checked because "registering an event" is exactly the kind of change that quietly relaxes an allow-list somewhere else. It does not here.
- **In scope?** Yes. This is not scope expansion, it is the cost of the slice's own AC-A6: a catalogue-driven list that drops a live-written action is a regression the slice itself would have introduced. Fixing it anywhere else would have been the violation.

One follow-up, **not for this slice**: `run-agent/route.ts:644` still writes the string literal `'AGENT_EXECUTED'` rather than `AUDIT_EVENTS.AGENT_EXECUTED`. Re-opening that route here would widen the diff for no behaviour change. Record it as a one-line chore.

**JC-2 — leaving the generic `changes` dump unsuppressed for AI rows: ✅ confirmed. Dev's reasoning is right, and I verified the load-bearing half.**

`buildAiAuditEntry` returns no `changes` (`aiActionAudit.ts:212-217`), and `buildLogEntry` stores `changes: null` when the input has none. The block at `page.tsx:940` is additionally not a wholesale dump — it renders only `changes.before` / `changes.after`. So for an AI row the condition is unreachable **and** the thing it would render does not exist. A second condition would be dead code asserting a fact, and hiding a stored field in a compliance browser is the wrong default. Right call, and right to flag it rather than assume it.

**JC-3 — the two unplanned behaviour changes: ✅ both accepted, both already documented; no narrowing needed.**

- `severity` as a closed enum (`?severity=foo` → 400 where it was 200-with-no-rows). Correct. C-6's asymmetry argument is about the gap between *registered* and *observed* values; `severity` has no such gap — it is a three-value CHECK-constrained column and the sibling `AuditReadQuerySchema:57` already enums it. Making the two schemas disagree on the one parameter that is genuinely closed would be the defect. The only caller sends `info|warning|critical` or omits it.
- `page_size` capped at 200, rejecting rather than clamping. Accepted. The search path asks for `pageSize × 5` through a **service-role** client, so an uncapped value is cheap amplification against a route that reads every account's rows; 200 is ten times the only caller's 20. I checked for a second caller and for an export path that might ask for more: exactly one `fetch` to this route (`page.tsx:182`, `pageSize = 20`), and `exportLogs` (`:303`) builds its CSV from the `logs` already in state — it does not re-fetch. Rejecting beats clamping here: a clamp silently returns a different page size than the caller asked for.
- **Neither is a breaking change needing narrowing**, but both are API behaviour changes on a shared route and must stay written down. They already are (Implementation Notes 3 and 4, and the requirement's Slice A evidence note). Keeping them there is the whole obligation.

**JC-4 — the count-line refinement: ✅ satisfies AC-A9 and does not overreach.**

`Showing N matches on this page` + `(Page n)` + the caveat. `currentPage` is the real offset page, so it is honest; the only thing dropped is `of m`, the one value derived from the unfiltered count. Prev/Next are untouched and still page the unfiltered stream, which is what the route actually does — that residue is stated in Non-Goal 2 and in the new comment at `page.tsx:499-506`, so a reader cannot mistake the caveat for a claim that the pager is now filtered. No part of the search fix has leaked in. This is exactly comment 4.

**JC-5 — `AI_ACTION_ENTITY_TYPE` defined locally in `filterOptions.ts`: ✅ that is what I meant, and the duplication is acceptable — but pin it (X-3).**

The reason stands: `requestSchemas.ts` value-imports `zod`, and `filterOptions.ts` is imported by a `'use client'` page. Keeping the client module's imports at `./events` + `./types` (verified: those are its only three import statements, one of them `import type`) is worth one duplicated four-character string. `satisfies EntityType` is a good touch — but it pins the copy to the *union*, not to the *other copy*. If someone changed either one to a different valid entity type, both would still compile and the admin page would silently stop rendering AI details. Dev's stated protection ("cannot drift without a compile error") is therefore half true, and the missing half is two lines of test.

---

### Verification of C-1 to C-9 (checked in the code, not taken on report)

| # | Condition | Verdict | Evidence I checked |
|---|---|---|---|
| C-1 | Branch cut by RM | ✅ | `feature/admin-ai-activity-slice-a`, cut from `main`; Dev did not create it |
| C-2 | FR/AC confirm-only + two corrections | ✅ | Requirement now reads **148 events** (`:230`) and **`:110` / `:193`** (`:428`) |
| C-3 | `firstIssueMessage` local, no cross-boundary import | ✅ | Defined at `requestSchemas.ts:74-76` with the reason in the docblock; `grep business-os lib/audit/*.ts` returns **two comment lines and zero imports** |
| C-4 | Eight snake_case names | ✅ | `action, severity, entity_type, date_from, date_to, search, page, page_size`; destructured with renames at `route.ts:64-73`; `entity_type` asserted in the happy-path test |
| C-5 | Date **validates without transforming** | ✅ | `dateFilter` is `z.string().max(64).refine(...)` — no `.transform()`, no `.datetime()`; the test asserts the value reaching `.gte()` is `'2026-09-01T10:00'` **byte-for-byte**, and a second test does the same for a full ISO string. The "do not normalise" warning sits in the docblock, where the next good-faith reader will hit it |
| C-6 | Permissive identifiers, locked by test | ✅ | `?action=SOME_LEGACY_EVENT` → 200 and `.eq('action','SOME_LEGACY_EVENT')`; the test comment even cites `AGENT_EXECUTED` as the real-world case |
| C-7 | 403-before-400 ordering | ✅ | Parse sits at `route.ts:46-62`, **after** the 401/403 gate; tests assert non-admin + invalid query → **403** and signed-out + invalid query → **401**, both with `mockTablesRead` empty. `auditAdminGate.test.ts` is unmodified and green |
| C-8.1 | `AI_` narrowed to `AI_PRICING_` | ✅ | `GROUP_RULES` carries `AI_PRICING_`; a test asserts `classifyAuditEvent('AI_SOMETHING_ELSE').group !== 'AI Pricing'` |
| C-8.2 | Pinned group order | ✅ | `PINNED_GROUPS = ['Business OS AI','Business OS']` + `byPinnedThenLabel`; test asserts `groups[0].label === 'Business OS AI'` |
| C-9 | `console.*` → Pino, approval recorded | ✅ | `grep` for `console.` on both touched files → **zero**. `createLogger({ module: 'AdminAuditTrailPage' })` at module scope, `logger.error({ err }, …)`. User approval recorded in T5 |

**T8 double-render suppression (R-1.1) — verified by reading every render guard in the expanded row, not just the one that changed.** For an `ai_action` row only `page.tsx:703` fires. The generic details dump at `:923` now carries `log.entity_type !== AI_ACTION_ENTITY_TYPE`; the AIS blocks are all gated on `log.action === 'AIS_…'`; and the two blocks that are *not* action-gated (`:874` `details?.normalization_ranges`, `:899` `details.total_executions || details.total_tokens_used`) key off snake_case fields the camelCase `AiAuditDetails` shape does not contain. One block, not two.

**R-1.2 (allow-list by construction) — verified against the writer.** `AiActionDetailsView`'s fourteen fields are name-for-name the fields `buildAiAuditEntry` writes, and they are exactly AC-A5's list. The stored shape's other three keys (`schema`, `areas`, `correlationId`) are simply not rendered, which is the right default for an allow-list. No `Object.entries(details)` anywhere near it, and the guard test pins that.

**Mandatory-rule conformance:** Zod parses before any business logic and before the first DB read (asserted by test, not just by reading). Pino only, in both files. No new DB access, so the repository rule is not engaged — Non-Goal 6's reasoning is correct **for this slice only**, and Gap B, which adds plenty of new access, may not reuse it. TypeScript strict: no new `any`; `catch (error: unknown)` with `instanceof Error` narrowing is a net improvement. No model names anywhere near this diff.

---

### Code Review Comments

1. **`lib/audit/requestSchemas.ts:80-81` (`optionalFilter`) — the `'all'` sentinel is applied to `search`, so searching for the word "all" silently returns unfiltered results. Priority: High.**
   `optionalFilter` maps `'' | 'all' | null → undefined` and is applied to all six optional parameters, including `search`. The page sends `search` whenever the box is non-empty (`page.tsx:177`), so typing `all` produces `?search=all` → the schema drops it → `if (search)` is false → **no in-memory filter runs**, and the page renders the unfiltered page of rows under the heading *"Showing 20 matches on this page"*. That is a reachable, user-visible false statement in a compliance browser — the same class of dishonesty FR-A4b exists to remove, reintroduced by the fix for it. `'all'` is a **sentinel of the three dropdowns**, not a general encoding of "absent"; `search` and the two dates are free text and must not be subject to it.
   **Direction (do not over-fix):** keep `optionalFilter` for `action`, `severity` and `entity_type`; add a sibling that maps only `'' | null → undefined` and use it for `search`, `date_from` and `date_to`. Pin it with a pure schema unit test in `lib/audit/__tests__/` — `AdminAuditTrailQuerySchema.parse({ search: 'all' }).search === 'all'` and `…parse({ action: 'all' }).action === undefined` — which is cheaper and more precise than trying to observe the in-memory filter through the route mock.

2. **`app/admin/audit-trail/page.tsx:177` vs `:204` — the request and the display disagree about what counts as an active search. Priority: Low.**
   `fetchLogs` sends `search` when `filters.searchTerm` is truthy; `isSearchActive` is `filters.searchTerm.trim().length > 0`. A whitespace-only term is therefore **sent and filtered on** by the server while the page shows the unfiltered `Showing N of M` line — the exact condition T4 removes, surviving in one corner. One line: gate the `params.append` on the same trimmed value (or hoist `isSearchActive` above `fetchLogs` and use it in both places).

3. **`lib/audit/filterOptions.ts:47` — pin the duplicated `AI_ACTION_ENTITY_TYPE` to its twin. Priority: Low.**
   As ruled in JC-5 the duplication is fine, but `satisfies EntityType` does not stop the two copies diverging. Add to `lib/audit/__tests__/filterOptions.test.ts` (a node test — importing `zod` there costs nothing):
   `import { AI_ACTION_ENTITY_TYPE as FROM_SCHEMAS } from '../requestSchemas';` then `expect(AI_ACTION_ENTITY_TYPE).toBe(FROM_SCHEMAS);`
   Two lines, and the rot concern is closed permanently. Do it while the file is open.

4. **`route.ts:47` — `Object.fromEntries(searchParams)` changes repeated-parameter semantics from first-wins to last-wins. Priority: Low, note only — no change requested.**
   `searchParams.get('action')` returned the **first** `action=`; `Object.fromEntries` keeps the **last**. Unreachable from the only caller, and neither behaviour is more correct. Recorded so it is a known consequence rather than a surprise if a future caller ever builds params in a loop.

5. **`page=1.5` now returns 400 where it used to `parseInt` to `1`. Priority: Low, note only.** Consistent with the rest of the tightening and with C-6's scope (this is a shape, not a value). Mentioned only so it sits in the same list as the `severity` and `page_size` changes if this route ever gets a changelog.

6. **Test quality — strong, and the guards would catch what they exist to catch. Priority: n/a (assessment).**
   I checked the three properties that matter rather than the count. (a) `filterOptions.test.ts` asserts **set equality** with `AUDIT_EVENTS`, not membership — so an event dropped by any future grouping edit fails immediately; the partition test plus the synthetic `ZZZTEST_…` fallback test together make "the label map cannot become an exclusion list" a property of the code, which is the most valuable assertion in the diff. (b) The source guard's regex `<option\s+value=["']([^"'{]+)["']` correctly ignores `value={…}`, and the third assertion — *only* `all|info|warning|critical` may be literals — is the one that catches the regression rather than merely its current instances; a re-hardcoded `<option value="USER_LOGIN">` fails all three assertions. (c) The route tests assert `mockTablesRead` is empty on every rejection path, which is what makes "validate before the read" checkable rather than claimed, and the two date tests assert the value *at the `.gte()` call*, not merely a 200 — precisely the trap C-5 was written about. The only property not pinned by a test is the one in comment 1.

---

### Optimisation Suggestions

- `classifyAuditEvent`'s `remainder || event` guard (an event exactly equal to its own prefix) is unreachable today for all five rules. Keep it; it is two characters and it is the difference between a blank label and a correct one. No change.
- `buildActionFilterGroups()` / `buildEntityTypeFilterOptions()` are called once at module scope in the page — good. If Gap B's view imports them too, consider memoising inside the module rather than at each call site so the two pages share one built list. Not now.
- The `ACRONYMS` map is the one piece of this module that will need editing as entity types grow (`sms`, `pdf`, `seo`). That is cosmetic-only by construction — a missing acronym yields "Seo", never a missing option — so it needs no guard. Worth one line in the module header saying exactly that, so nobody later treats it as a list that must be complete.

---

### Separate findings (not defects in this diff)

- **`npm run lint` is broken repo-wide.** `"lint": "next lint"`, and Next 14's `next lint` does not recognise the flat `eslint.config.js`, so it drops into interactive first-run setup instead of linting. Dev's workaround (`npx eslint` on the changed files + `npm run lint:hooks`) is the right one for this cycle. This is the same root-cause family as the flat-config migration in PR #76, and it means the `npm run lint` command documented in CLAUDE.md § Development Commands currently does nothing. Not Slice A's to fix — raise with TL as its own chore (point the script at `eslint .` with a `--max-warnings` baseline, and make the CLAUDE.md line match).
- **`.claude/launch.json` is untracked, unexplained and not gitignored.** It is local editor/run configuration carrying absolute paths to another worktree. **RM: do not include it, or `.claude/settings.local.json`, in the Slice A commit.** Either gitignore it or leave it untracked — it must not ride along in a feature commit.

---

### Code Approved for QA: **Not yet — after X-1, X-2 and X-3.**

| Item | Comment | Size |
|---|---|---|
| **X-1** (High, blocking) | Comment 1 — narrow the `'all'` sentinel to the three dropdown filters; leave `search` and the dates on an empty-only preprocess; add the schema unit test | ~4 lines + 2 assertions |
| **X-2** (Low) | Comment 2 — one condition, so the request and the count line agree on "search is active" | 1 line |
| **X-3** (Low) | Comment 3 — two-line equality test pinning the duplicated `AI_ACTION_ENTITY_TYPE` | 2 lines |

Nothing else changes. **No re-review cycle:** Dev applies the three, re-runs the same Jest selection, and the work proceeds to the user view and then QA — I will confirm X-1 to X-3 from the diff at that point. QA's manual list is unchanged, plus one case for X-1: **type `all` into the search box and confirm the result set is actually filtered**, rather than the full page appearing under a "matches" heading.

## QA Testing Report

**QA — 2026-09-23**
**Test mode:** full
**Strategy used:** **A + B + D-equivalent + E.** Unit (A) for the catalogue builders; integration (B) driving the **real route handler** through an in-memory PostgREST harness implementing `eq/gte/lte/order/range/count:'exact'` over a fixture table; a **jsdom render of the real `page.tsx`** standing in for the E2E this repo does not have (CLAUDE.md § Testing — Playwright is not installed); plus a **read-only measurement of the live `audit_trail` table** to establish the data facts the open ACs turn on. Mutation testing was used on three guards to prove they fail when the thing they guard is removed.
**Focus:** api, ui, schema, security, performance — all
**Skipped:** Playwright E2E (not installed; adding it needs SA review). One probe that invoked the real handler against the **production** Supabase project was **blocked by the sandbox** (`Production Reads`); its coverage was replaced by the in-memory harness plus the read-only table measurement. See [Checks that still need live data and a human](#checks-that-still-need-live-data-and-a-human).
**Input source:** prompt keywords + SA's QA notes in § *Code Review by SA — 2026-09-23* (including the manual `all` search case) + the T10 / T11 manual lines.

---

### Verification of Dev's reported numbers

Every number in the brief was re-run. **All of them are exactly true.**

| Claim | Dev reported | QA measured | Verdict |
|---|---|---|---|
| `npx jest lib/audit app/api/audit app/api/admin app/admin/audit-trail lib/admin/__tests__/admin-authz-surface.guard.test.ts` | 18 suites / 501 tests | **18 suites / 501 tests, 0 failures** (re-run twice) | ✅ Exact |
| `npx eslint` on the four changed source files | 0 errors, 17 warnings | **0 errors, 17 warnings** | ✅ Exact |
| Pre-change lint baseline | 18 | **18** — `git show main:…` of `route.ts` + `page.tsx` lints to 18; the branch's same two files lint to 17. The one removed warning is `catch (error: any)` → `unknown` | ✅ Exact |
| Scoped `tsc --noEmit` | clean but for two pre-existing errors | **Only `lib/audit/admin-helpers.ts` (`reward_config`, ×4) and `lib/audit/ais-helpers.ts` (`workflow_step`, ×1)**. Both files unmodified by this branch | ✅ Confirmed |
| `npm run build` | compiles | **✓ Compiled successfully.** `/admin/audit-trail` = 12.2 kB page / 157 kB first load | ✅ Confirmed |
| `npm run lint` broken repo-wide | broken | **Confirmed** — `next lint` does not read the flat `eslint.config.js` and drops into the interactive "How would you like to configure ESLint?" prompt, linting nothing | ✅ Confirmed |

**Wider regression sweep (not asked for, run anyway).** Full `npx jest` on the branch: **376 suites / 5,762 tests — 21 suites / 129 tests failed.** That is the same count of red suites already known on `main`, and every one sits in `lib/pilot`, `lib/agentkit`, `lib/orchestration`, `lib/website-builder`, `lib/utils/featureFlags` or the root `__tests__/DeclarativeCompiler-*` family. **Nothing in `lib/audit`, `app/admin/**` or `app/api/admin/**` is red.** The `AGENT_EXECUTED` catalogue addition caused no collateral failure.

**QA's own probes: 5 suites / 86 tests, all passing** — written in a scratch directory, run, then removed. The working tree is byte-identical to how QA found it.

---

### Live-data facts QA established (read-only `SELECT` on `audit_trail`)

| Fact | Value |
|---|---|
| Total rows in `audit_trail` | 58,261 |
| `action = BUSINESS_AI_ACTION_COMPLETED` | **52** |
| `action = BUSINESS_AI_ACTION_FAILED` | **4** |
| `entity_type = ai_action` | **56** (= 52 + 4, so the two views agree) |
| `action = AGENT_EXECUTED` | **539** — Dev's root-cause registration was necessary, not cosmetic |
| `action = USER_UPDATED` | **0** — dropping that option costs nothing |
| A real `ai_action` row's `details` keys | `area, areas, models, schema, groupId, outcome, trigger, callCount, callNames, actionType, inputTokens, totalTokens, outputTokens, failedCallCount, estimatedCostUsd`; `changes` is `null` — confirming Implementation Note 2 / JC-2 at the data |

---

### Test Coverage

| Acceptance Criterion | Tested? | Result | Notes |
|---|---|---|---|
| **AC-A1** — filter to completed AI actions, to failed, and to both; list shows only those | ✅ | **Pass** | Three ways. (1) jsdom: the Action `<select>` renders a **`Business OS AI` optgroup pinned first** holding exactly `BUSINESS_AI_ACTION_COMPLETED` + `_FAILED`; changing it fires `GET …?action=BUSINESS_AI_ACTION_FAILED&page=1&page_size=20`. (2) Route harness: each filter returns rows whose `action` set is exactly the one selected, totals 52 / 4 / 56. (3) Live counts match those totals. |
| **AC-A2** — Entity Type offers `ai_action`; selecting it returns every AI entry regardless of outcome | ✅ | **Pass** | jsdom: `<option value="ai_action">AI Action</option>` present; selecting it sends `entity_type=ai_action`. Harness: returns **both** actions and only `ai_action` rows, and its total **equals completed + failed** — asserted as an identity, not eyeballed. |
| **AC-A3** — a new catalogue entry becomes selectable with no markup change; source guard | ✅ | **Pass — guard proven, not merely present** | The offered set **equals** `AUDIT_EVENTS` (149) and `AUDIT_ENTITY_TYPES` (24) as sets; the rendered DOM carries **150** action `<option>`s (149 + the `all` sentinel) across **29** optgroups, and **25** entity options. **Mutation test:** re-adding `<option value="USER_LOGIN">` to `page.tsx` turns **2 of the guard's assertions red**; file restored byte-identically (sha verified). |
| **AC-A4** — with an AI filter and no search, the total and page count describe the filtered set and paging reaches every row exactly once | ✅ | **Pass** | Harness pages `entity_type=ai_action` at `page_size=5` to exhaustion: **12 pages, 56 distinct row ids, none seen twice, none missed**, `total` constant at 56 and `totalPages === ceil(56/5)` on every page. Boundaries: last page `showing=1, hasMore=false`; `page_size=7` (exact multiple) gives 8 pages with no phantom 9th; a page past the end returns `[]` with the total intact. The filtered total is provably different from the unfiltered one. |
| **AC-A5** — expanded AI row shows the labelled values; no ledger read | ✅ | **Pass** | jsdom renders the block with **all 13 labels** — Area, Action Type, Trigger, Outcome, Calls, Failed Calls, Input/Output/Total Tokens, Estimated Cost, Calls Made, Models, Grouping ID — with the right values (`1,801`, `$0.001234`, `insight.detect, insight.narrate`, `gpt-4o, gpt-4o-mini`). A failed row renders `failed (provider_timeout)`. **No fetch is issued on expand.** Privacy: the stored-but-not-allow-listed keys `correlationId` and `schema` are **absent from the DOM**. Sparse and `null` `details` render safely. |
| **AC-A6** — regression: existing filters, AIS renderers, pagination unchanged | ⚠️ | **Pass, with two documented behaviour changes and one dropped option** | Severity (all three values), `datetime-local` dates byte-for-byte, entity, search and pagination all still work. AIS renderers verified in jsdom: `AIS_SCORE_UPDATED` still renders its Before/After block, `AIS_NORMALIZATION_REFRESH_COMPLETED` still renders, and neither picks up the AI block. Detection is by **entity type**: a non-AI row carrying camelCase AI-looking keys still gets the generic dump, and an `ai_action` row with an unrelated action still takes the AI path. **`USER_UPDATED` was dropped — QA confirms it costs nothing: the live table holds 0 rows with that action.** |
| **AC-A7** — 401 / 403 / fail-closed, nothing read before the gate | ✅ | **Pass** | Beyond the committed tests, QA added the inverse cases: signed out + invalid query → **401**; non-admin + invalid query → **403 (not 400)**; admin check **throws** + invalid query → **403**; non-admin + a *valid* query → **403**. `tablesRead` empty on all four. Validation was not hoisted above the gate. |
| **AC-A8** — no internal error text outside development, on both 500 paths | ✅ | **Pass** | Eight cases over both 500 paths **and** the new 400 path × `production` / `test` / `development`. In production a planted secret (`relation "audit_trail" does not exist :: connstr postgres://user:pw@host`) appears **nowhere in `JSON.stringify(body)`** on either path; in development `details` is present on both. A **non-`Error` thrown value** also cannot leak (the `instanceof Error` narrowing holds). The 400 path does not echo the rejected value. The stale TODO is gone; both touched files have **0** `console.*` calls. |
| **AC-A9** — with a search term, no total drawn from the unfiltered count | ⚠️ | **Partial — see BUG-1** | The **count line** is correct: with a term it reads `Showing N matches on this page (Page 1)` + the caveat, the `of 14332` disappears, and clearing the term restores it. X-2 verified: a whitespace-only term is not sent and the ordinary total is shown. **But the pagination control beside it still renders `Page 1 of 717`**, where 717 is `totalPages` derived from the unfiltered count. |
| **AC-A10** — `Admin authz surface guard` unchanged | ✅ | **Pass** | `git diff main -- lib/admin/__tests__/admin-authz-surface.guard.test.ts` is **empty**; the suite is green inside the 18-suite run; `CAPS` untouched; the route remains on both parked allow-lists. |

---

### Issues Found

#### Bugs (must fix before commit)

**BUG-1 — The pager still prints a total derived from the unfiltered count while a search is active, contradicting the caveat beside it. Severity: Medium. File: `app/admin/audit-trail/page.tsx:566-568`.**

T4 branched the **left-hand count line** on `isSearchActive`, but the **right-hand pagination control** was not branched and still renders unconditionally:

```tsx
<span className="text-sm text-slate-400 min-w-[100px] text-center">
  Page {currentPage} of {pagination.totalPages}
</span>
```

`pagination.totalPages` is `Math.ceil(unfilteredCount / pageSize)` (`route.ts:201`).

- **Steps to reproduce:** open `/admin/audit-trail`, type any term into Search.
- **Expected (AC-A9):** the page no longer displays a total drawn from the unfiltered count — suppressed or labelled as partial.
- **Actual:** the same card shows, on one row: *"Showing 2 matches on this page (Page 1) — Search scans only the current page of results…"* **and** *"Page 1 of 717"*. Verified in jsdom; the rendered pager text while searching is literally `Page 1 of 717` against a fixture whose filtered set is 2 rows.
- **Why this is a bug and not the documented residue.** Non-Goal 2 and SA's JC-4 both scope the exemption to *behaviour* — "the **Prev/Next buttons** stay wired to `pagination.totalPages`", "Prev/Next are untouched and still page the unfiltered stream". Neither notices that the pager also **prints the number**. AC-A9 is about what the page **displays**, and 717 is a displayed total drawn from the unfiltered count — the same false statement FR-A4b exists to remove, surviving one `<div>` to the right of the fix for it.
- **Suggested shape (Dev's call):** two lines, matching what T4 already did — `{isSearchActive ? \`Page ${currentPage}\` : \`Page ${currentPage} of ${pagination.totalPages}\`}`. The **buttons** stay exactly as they are, so this changes only the label, not the pager's behaviour, and Non-Goal 2 is honoured in full.

#### Performance Issues (should fix)

*None found.* The change adds ~7 kB of `EVENT_METADATA` description prose (124 strings) to the client bundle for the `<option title>` tooltips; the built page is 12.2 kB / 157 kB first load, which is unremarkable. The builders are called **once at module scope**, not per render. 150 `<option>`s render without measurable cost. Expanding a row issues no request.

#### Edge Cases (nice to fix)

1. **EDGE-1 — The "registered vs observed" limitation is far larger than the docs imply, and QA now has the number. Severity: Low for Slice A; carry to Gap B.** Measured against the most recent 1,000 live rows: **31 of the 42 distinct `action` values in the table are not selectable** (the dropdown reaches 11 of 42), and **3 of 18 `entity_type` values** are not (`contact_document`, `stripe_connect_account`, `crm_task`). The unreachable actions are the Business OS module events — `CRM_CONTACT_CREATED`, `SCHEDULING_BOOKING_CREATED`, `WEBSITE_PAGE_PUBLISHED`, `BUSINESS_CHAT_QUERY`, `PROPOSAL_SENT`, … — written as **string literals** by their routes (e.g. `app/api/crm/contacts/route.ts:101`) and never registered in `AUDIT_EVENTS`. This is **not a regression** (the old hardcoded list offered 14, of which 13 survive) and **affects no AC** (both AI events are registered). But the Action dropdown's `Business OS` group holds **2** options while the table is full of Business OS events under unregistered names — a discoverability trap for a compliance browser, and the `AGENT_EXECUTED` pattern at 31× scale. Recommend a follow-up chore registering them at the writers, the same root-cause fix Dev applied to `AGENT_EXECUTED`.
2. **EDGE-2 — Two stale counts, introduced by this diff. Severity: Low (documentation).** `lib/audit/filterOptions.ts:10` says *"Measured: 148 registered events"*; registering `AGENT_EXECUTED` in the same change made it **149**. The requirement's FR-A3 SA-ruling line says 148 too. One-word fixes while the files are open.
3. **EDGE-3 — `getActionLabel` renders the AI rows' heading as "Business Ai Action Completed".** Pre-existing helper (`page.tsx:292`), untouched here, now visible on a row type that did not used to be findable. Cosmetic; note only.
4. **EDGE-4 — Searching `all` matches almost every AI row anyway**, because the in-memory search scans `JSON.stringify(details)` and the AI shape contains `callCount` / `callNames` / `failedCallCount` — `"callcount"` contains `"all"`. The X-1 fix is nonetheless correct and load-bearing (proved below); this is a property of the pre-existing substring search, not of the fix. Note only, and worth knowing when eyeballing SA's manual case.

---

### Mutation testing — are the guards real?

Each guard was broken deliberately, the suite re-run, and the file restored (git object sha compared before/after — **identical in all three cases**).

| Mutation | Expected to red | Result |
|---|---|---|
| Re-add `<option value="USER_LOGIN">` to `page.tsx` | the source guard | ✅ **2 assertions red** (`has no <option> whose value is a registered audit event`; `holds only the sentinel and the three severity literals`) |
| Revert `search` from `optionalFreeText` back to `optionalFilter` (reinstate X-1) | Dev's new schema suite | ✅ **red** — `passes the literal search term "all" through untouched`, `Expected: "all" / Received: undefined`. **And QA's route harness independently red:** `?entity_type=agent&search=all` returned **40 unfiltered rows instead of 0**. Dev's "verified failing before the fix" is confirmed by two independent tests |
| Delete `&& log.entity_type !== AI_ACTION_ENTITY_TYPE` from the generic dump condition | the T8 double-render guard | ✅ **red** in Dev's guard *and* in QA's jsdom test (`Event Details` reappeared beneath `AI Action Details`) |

---

### The three deliberate behaviour changes — confirmed

| Change | Verified |
|---|---|
| `?severity=foo` → **400** (was 200 + no rows) | ✅ 400, body `{ success:false, error:'Invalid query parameters' }`, **no table read**. All three valid severities still return 200 and filter correctly |
| `page_size` capped at **200** | ✅ `page_size=200` → 200; `page_size=201` → 400. The only caller sends 20 |
| `date_from=all` → **400** (T11 extension) | ✅ 400 on both `date_from=all` and `date_to=all`, no table read |

Related hardening also confirmed, each with **no table read** on rejection: `page=abc|0|-1|1.5`, `page_size=abc|0`, `action=bad-value!`, `entity_type=has%20space`, `date_from=notadate`, `search` > 200 chars. Still accepted: `date_from=2026-09-01T10:00` (the real `datetime-local` shape) **and** full ISO, unregistered `action` / `entity_type` identifiers (C-6), unknown extra params, `search` at exactly 200 chars. The old `parseInt('abc')` → `.range(NaN, NaN)` → 500 is gone.

**X-1 probed around, as SA asked.** `?search=all` genuinely filters (the 40-row `entity_type=agent` control set goes to **0**, and would have stayed at 40 under the old behaviour). `install`, `ALL`, `login`, `small` all filter. A term matching nothing returns 0 rows, not the unfiltered page. The three dropdown sentinels (`action=all`, `severity=all`, `entity_type=all`) still mean "no filter" and produce a total identical to a bare request. Empty strings on all six optional params still mean absent. The dates are unaffected by the sentinel.

**Not a defect, recorded:** repeated parameters are **last-wins** (`Object.fromEntries`) where `searchParams.get()` was first-wins. Verified (`?action=…FAILED&action=…COMPLETED` → total 52). Unreachable from the only caller; SA already recorded it as comment 4.

---

### Checks that still need live data and a human

Everything the ACs require has been verified above — the six criteria Dev left open are answered using the live row counts plus the real handler and the real page component. What remains needs a **browser and an admin session**, which QA cannot obtain (no admin cookie; the probe that invoked the real handler against production was blocked by the sandbox's `Production Reads` policy). These are **confirmations, not open questions** — each has a passing automated equivalent:

1. **Sign in as a platform admin, open `/admin/audit-trail`, and confirm the Action dropdown is usable at 150 options / 29 optgroups.** R-2 says a searchable control is revisited only *"if QA reports it"*; QA cannot judge scroll ergonomics from jsdom. Functionally covered — this is a usability opinion.
2. **Select `Business OS AI → Completed`, then `Entity Type → AI Action`; confirm 52 / 56 rows and the paging.** Counts pre-verified against the live table; paging proved exhaustive in the harness.
3. **Expand a live AI row; confirm one detail block, not two, with real stored values.** Verified in jsdom against the exact `details` key shape read off a real row, plus the mutation test.
4. **Type `all` into the search box (SA's X-1 case); confirm the rows are filtered, not a full page under a "matches" heading.** Verified twice in code, including the mutation proving the old behaviour. Note EDGE-4 when eyeballing it.
5. **Type spaces only; confirm the ordinary `Showing N of M` (X-2).** Verified in jsdom.
6. **While doing 4 and 5, look at the pager on the right — that is BUG-1.**

---

### Test Outputs / Logs

```
$ npx jest lib/audit app/api/audit app/api/admin app/admin/audit-trail \
           lib/admin/__tests__/admin-authz-surface.guard.test.ts
Test Suites: 18 passed, 18 total
Tests:       501 passed, 501 total

$ npx jest                      # full suite, branch
Test Suites: 21 failed, 8 skipped, 355 passed, 376 of 384 total
Tests:       129 failed, 58 skipped, 5575 passed, 5762 total
# all 21 pre-existing on main; none in lib/audit, app/admin/** or app/api/admin/**

$ npx jest <QA probes>
Test Suites: 5 passed, 5 total
Tests:       86 passed, 86 total

$ npx eslint app/admin/audit-trail/page.tsx app/api/admin/audit-trail/route.ts \
             lib/audit/requestSchemas.ts lib/audit/filterOptions.ts
✖ 17 problems (0 errors, 17 warnings)
# baseline (the same two large files from main): ✖ 18 problems (0 errors, 18 warnings)
# the four new/changed test files: 0 problems.  npm run lint:hooks: pass

$ npx tsc -p <scoped> --noEmit
lib/audit/admin-helpers.ts(76,5|100,5|124,5|148,5): TS2322 '"reward_config"' ...
lib/audit/ais-helpers.ts(404,5):                    TS2322 '"workflow_step"' ...
# both files unmodified by this branch

$ npm run build
 ✓ Compiled successfully
├ ƒ /admin/audit-trail        12.2 kB    157 kB
├ ƒ /api/admin/audit-trail       0 B        0 B

$ npm run lint
> next lint
? How would you like to configure ESLint?   <-- interactive prompt; lints nothing
```

**BUG-1, as rendered DOM** (jsdom; fixture total 14,332 / 717 pages; 2 rows after search):

```
left  : "Showing 2 matches on this page (Page 1)
         Search scans only the current page of results. Use the Action, Entity
         Type, Severity and date filters for complete results."
right : <span class="text-sm text-slate-400 min-w-[100px] text-center">Page 1 of 717</span>
```

**Dropdown inventory as rendered** (29 groups, `Business OS AI` pinned first):

```
Business OS AI(2), Business OS(2), Admin(3), Agent(18), Agent Intelligence Score(8),
AgentKit(11), AI Pricing(5), Approval(6), Boost(1), Consent(2), Customer(1), Data(4),
Effort(1), Free(1), Invoice(1), Memory(12), Model(1), Payment(2), Pilot(16), Plugin(8),
Profile(2), Reward(4), Routing(1), Security(4), Settings(9), Subscription(3), System(3),
User(16), Workflow(2)
Entity types: 24 offered + the sentinel; ai_action => "AI Action"
```

---

### Assessment

The diff is disciplined and the tests are unusually honest: the source guard, the X-1 schema suite and the double-render guard all **fail when the thing they protect is removed**, which QA verified rather than assumed. The three SA fixes are correctly applied — X-1 in particular is load-bearing, and Dev's "verified red before the fix" is true. The `AGENT_EXECUTED` root-cause registration was the right call and is backed by 539 live rows. Security posture is good: validation sits strictly after the gate, nothing is read on any rejection path, and the error-leak fix holds on all three paths in every `NODE_ENV`, including for a non-`Error` throw.

One real defect (BUG-1), and it is two lines. Everything else is documentation staleness and a scope observation for Gap B.

### Final Status

- [ ] All acceptance criteria pass — ready for commit
- [x] **Issues found — Dev must address before commit**

**Blocking:** BUG-1 (Medium) — AC-A9 is only half satisfied while the pager prints `Page n of <unfiltered>`.
**Recommended in the same pass** (trivial, files already open): EDGE-2 — correct `148` → `149` in `lib/audit/filterOptions.ts:10` and in the requirement's FR-A3 line.
**Not blocking, for the backlog:** EDGE-1 (31 unregistered live event names — a follow-up chore at the writers and an input to Gap B), EDGE-3, EDGE-4.

**No High-severity bug is open.** With BUG-1 fixed QA expects a clean pass; re-verification is the two assertions already described for it, and no other AC is affected.

**For RM when this ships:** `.claude/launch.json` and `.claude/settings.local.json` are untracked/modified and out of scope — they must not ride along, as SA already flagged. `docs/ENVIRONMENTS_AND_DEPLOYMENT_STRATEGY.md` and `docs/workplans/environment-readiness-staging.md` are also untracked and belong to a different cycle.

---

## Commit Info

*[RM will populate this section]*

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-23 | **QA fixes applied (BUG-1, EDGE-2) — ready for the user's code read** | **BUG-1 (Medium):** `page.tsx:574-578` no longer prints `Page n of <unfiltered totalPages>` while a search is active — the pager's label is branched on the same `isSearchActive` T4 used for the count line, so the number 717 no longer contradicts the caveat beside it. **Dev agrees with QA's reading of AC-A9 in full**, including that the `:506-512` comment was the reason the gap survived SA's JC-4 and QA's own first pass: it justified an exemption for the whole pager from a premise that only covered the buttons. The comment now names what is branched (every place the count is **printed**) and what is not (the pager's **behaviour** — all four buttons, their `disabled` logic and the `totalPages > 1` gate are byte-identical, so Non-Goal 2 / JC-4 stand untouched). Pinned by a new jsdom suite, `app/admin/audit-trail/__tests__/searchTotals.render.test.tsx` (**6 tests**), whose load-bearing assertion is that **neither `717` nor `14332` appears anywhere in the rendered DOM** under a search, with two more tests pinning the buttons as unchanged. **Mutation-tested:** reverting the label reds **4 of the 6** (`Expected: "Page 1" / Received: "Page 1 of 717"`); `page.tsx` restored byte-identically (`git hash-object` 349a5ad6… before and after). **EDGE-2 (docs):** `filterOptions.ts` now says **149 registered events / 122 with metadata**, dated and measured, and notes that the totals move on every registration while the load-bearing **gap of 27** does not; the requirement's FR-A3 line carries the same correction, with SA's 146 → 148 paragraph kept as the record under a dated "superseded figure" note. Re-ran QA's selection plus the new file: **19 suites / 507 tests, all passing** (was 18 / 501). eslint on the four source files **0 errors / 17 warnings** — unchanged; new test file 0 problems; `lint:hooks` passes; scoped `tsc` shows only the same two pre-existing errors; `npm run build` compiles. **EDGE-1, EDGE-3 and EDGE-4 deliberately not touched** — EDGE-1 is a Gap B / follow-up chore at the writers, the other two are notes on pre-existing behaviour |
| 2026-09-23 | **QA — full pass. One Medium bug (BUG-1); not ready for commit** | Dev's four reported numbers all re-run and exact (18 suites / 501 tests; eslint 0 errors / 17 warnings against an 18 baseline; scoped tsc shows only the two pre-existing errors; build compiles; `npm run lint` confirmed broken repo-wide). Full-suite sweep: 21 red suites, all pre-existing on main, none in lib/audit or the admin surfaces. AC-A1/A2/A4/A5/A6/A9 — the six Dev left open — were tested with a read-only measurement of the live table (52 completed + 4 failed = 56 `ai_action` rows; `AGENT_EXECUTED` 539 rows; `USER_UPDATED` **0** rows, so dropping it costs nothing), an in-memory PostgREST harness driving the real handler, and a jsdom render of the real page. Three guards mutation-tested and all three genuinely red when broken — including independent confirmation that X-1 was a real bug (`?entity_type=agent&search=all` returned 40 unfiltered rows instead of 0 before the fix). **BUG-1 (Medium):** the count line was made honest but the pagination control beside it still renders `Page n of <unfiltered totalPages>`, so AC-A9 is only half met — two lines, and Non-Goal 2 is untouched by the fix. Edge findings: 31 of the 42 distinct action values in the live table are unregistered and therefore unselectable (the `AGENT_EXECUTED` pattern at scale — a Gap B input, not a Slice A regression), and `filterOptions.ts:10` still says 148 events where it is now 149 |
| 2026-09-23 | **SA code-review fixes applied (X-1, X-2, X-3) — ready for the user view, then QA** | X-1: the `'all'` preprocess is now scoped to the three dropdown parameters, where `all` is the UI's own `<option>` sentinel; `search`, `date_from` and `date_to` moved to a new empty-only sibling (`optionalFreeText`), so searching for the word "all" filters instead of silently returning the unfiltered page under a "matches" heading. Pinned by a new pure schema suite (`lib/audit/__tests__/adminAuditTrailQuerySchema.test.ts`, 6 tests), **verified red before the fix**. X-2: `isSearchActive` hoisted above `fetchLogs` and used to gate the `search` parameter, so the request and the count line share one definition of "search is active" — the raw term is still what is sent, only the whitespace-only case changes. X-3: the duplicated `AI_ACTION_ENTITY_TYPE` is held equal to its twin by test, and the docblock's half-true "cannot drift" claim is corrected. Re-ran SA's selection: **18 suites / 501 tests green** (was 17 / 494); eslint on the four source files **0 errors / 17 warnings**, identical to SA's run; scoped `tsc` shows only the two pre-existing errors SA named. One extension flagged: `date_from=all` now returns 400 rather than being ignored (Implementation Note 9) |
| 2026-09-23 | **SA code review — Fix Required (three small items)** | C-1 to C-9 all verified in the code rather than taken on report: `firstIssueMessage` is local with zero `lib/business-os` imports in `lib/audit`; the eight snake_case names; the date refinement asserted byte-for-byte at `.gte()`; the 403/401-before-400 ordering; the `AI_PRICING_` narrowing; the pinned groups; both touched files `console.*`-free. T8’s double-render suppression re-checked against **every** render guard in the expanded row, not only the one that changed. All five judgement calls **approved**: `AGENT_EXECUTED` is a root-cause fix and is provably behaviour-neutral (only `severity` and `complianceFlags` reach a stored row, and the writer passes `severity` explicitly), and it does not widen `CLIENT_WRITABLE_EVENTS`; the generic `changes` dump is correctly left alone; the `severity` 400 and the `page_size` cap are accepted and already documented; the count line satisfies AC-A9 without touching the pager; the duplicated `AI_ACTION_ENTITY_TYPE` is acceptable **once a test pins it**. One real defect found: the ‘all’ sentinel preprocess is applied to `search`, so searching for the word “all” silently returns unfiltered rows under a “matches” heading (X-1). Separate findings: `npm run lint` is broken repo-wide (`next lint` does not read the flat config), and the untracked `.claude/launch.json` must not be committed |
| 2026-09-23 | **Implemented on `feature/admin-ai-activity-slice-a` — Code Complete** | T0 cleared (RM cut the branch); T1-T10 done with C-1 to C-9 and rulings R-1 to R-3 folded in. 41 new tests across three files, all green; `lib/audit` + `app/api/admin` + `app/admin/audit-trail` + the authz surface guard = 17 suites / 494 tests green, `CAPS` untouched; `npm run build` compiles; zero type errors and zero new lint warnings in the touched files. **One finding the plan did not anticipate:** two of the fourteen previously-hardcoded actions were never in `AUDIT_EVENTS`, and one of them (`AGENT_EXECUTED`) is written live on every agent run — registered at the root cause rather than re-hardcoded, which adds `lib/audit/events.ts` to the diff. See [Implementation Notes](#implementation-notes--deltas-from-the-plan) |
| 2026-09-22 | **SA review — approved, conditional** | SA re-verified V-1 to V-14 against the tree; all fourteen hold, including the three brief corrections (148 vs 121 registry entries with `USER_CREATED` in the gap; the leaks at `:110` / `:193`; the guard allow-lists in the guard **test**, not the workflow). Three rulings: **OQ-1 in scope** — build T8, and it must also suppress the generic `details` dump for AI entries or a row renders both; **OQ-2 deferred**; **OQ-3 confirmed**. Nine conditions, two of them defects that would have shipped: `firstIssueMessage` is in `lib/business-os/usage/llmUsageVerification.ts`, not `requestSchemas.ts`, and importing it would take `lib/audit` → `lib/business-os`; and the schema must use the route's **eight snake_case** parameter names, not the sibling schema's camelCase. Plus: the date refinement must validate without transforming, the `AI_` group rule narrows to `AI_PRICING_`, and three tests are added (unregistered identifier accepted, non-admin + invalid query → 403 not 400, invalid date → 400) |
| 2026-09-22 | Created | Slice A workplan. All brief claims re-verified against the tree (V-1 to V-14): five corrections, three of which change the design — `EVENT_METADATA` covers only 121 of 148 events so `AUDIT_EVENTS` must be the source; the guard allow-lists live in the guard **test**, not the workflow; and there is no existing test file in `app/api/admin/audit-trail/` (the route is covered from `app/api/admin/__tests__/auditAdminGate.test.ts`). `console.*` audit: page 1 call, route 0. Three open questions raised for SA |
