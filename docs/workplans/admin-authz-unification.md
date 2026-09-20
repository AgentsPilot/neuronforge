# Workplan: Admin Authorization Unification

> **Last Updated**: 2026-09-20

**Developer:** Dev
**Requirement:** [ADMIN_AUTHZ_UNIFICATION_REQUIREMENT.md](/docs/requirements/ADMIN_AUTHZ_UNIFICATION_REQUIREMENT.md) — **as amended by its `## SA Review` section (RC-1 … RC-14 + 5 inline corrections). Where an RC corrects a BA statement, the RC wins.**
**Date:** 2026-09-20
**Status:** SA-reviewed 2026-09-20 — **APPROVED WITH CHANGES** (W-1 … W-10, see [SA Workplan Review](#sa-workplan-review)). Merge order is binding: **0 → 1 → 1L → 2 → 2L → 3 → 4 → 5 → 7 → 6 → 8**. No migration ships in this programme.
**Priority:** P0 (security)
**Worktree:** `C:/Users/Barak/My Projects/AgentsPilot/neuronforge-admin-authz`
**Branch:** `feature/admin-authz-unification` (off `origin/main` @ `0d7544c0`) — confirmed via `git branch --show-current`
**Baseline facts:** `admin-authz-facts.md` (44 routes: 3 canonical / 7 inline copies / 2 auth-only / 32 anonymous; 21 admin pages), re-verified in this worktree while writing this plan.

## Overview

This workplan implements "**one way to answer *is this caller a platform admin*, applied to every admin API route and every admin page, with an automated gate so the same class of hole cannot reappear silently**".

It is delivered as **eleven slices** (0, 1, 1L, 2, 2L, 3, 4, 5, 6, 7, 8) in the order the SA approved. Two orderings differ from the BA's original draft and both are SA-mandated:

- **The CI guard ships with slice 1, not slice 6** (RC-2). It lands carrying a dated allow-list of every file not yet gated; each later slice's diff *deletes* allow-list entries. Slice 6 degrades from "build the mechanism" to "the allow-list is empty and the workflow is a required check".
- **A blocking pre-flight slice 0 comes first** (RC-1). Nothing in the original plan verified that the operator can still get in after the gates close. Slice 0 is the difference between a security fix and a lockout.

Three enforcement surfaces, three named mechanisms, stated up front:

| Surface | Mechanism | Where |
|---|---|---|
| **API routes** | `requireAdmin(logger)` — the canonical gate, already shipped and tested | `lib/admin/requireAdminRoute.ts` |
| **Admin pages** | an **async Server Component** `app/admin/layout.tsx` awaiting `requireAdminPage()`, with the existing client chrome moved verbatim to `app/admin/components/AdminChrome.tsx` | `app/admin/layout.tsx`, `lib/admin/requireAdminPage.ts` |
| **CI** | a repo-wide **static shape scan** Jest guard (`lib/admin/__tests__/admin-authz-surface.guard.test.ts`) run by its own workflow with **no `paths:` filter** | `.github/workflows/admin-authz-guard.yml` |

### "How does the next page / capability / function know to use `requireAdmin`?" (user, 2026-09-20)

Four mechanisms, audited. Two were already covered by the slices; two were gaps, and both are now folded into existing slices — **no new slices**.

| # | Mechanism | Strength | Where |
|---|---|---|---|
| 1 | **Pages — structural** | 🟢 Strongest. A page **cannot** opt out of its parent layout, so a new `/admin` page is guarded before its author writes a line. Not a convention. | Slice 5 |
| 2 | **Routes under the admin path — mechanical** | 🟡 Strong, *conditional*: R1 catches an ungated `app/api/admin/**` route, but only becomes a **build gate** when the workflow is a required status check. | Slice 1 (guard) → Slice 6 (the setting) |
| 3 | **Routes outside the admin path — the hole** | 🔴 **Was missing.** R1 keys off the path, so an admin capability anywhere else is invisible. → new **R7**, the inverted rule. | **Slice 6** |
| 4 | **Authoring time — where it is actually decided** | 🔴 **Was missing, and worse than missing:** the scaffolding skill *prescribes a different admin check*. → skill + `CLAUDE.md` fixes. | **Slice 8** |

> **The honest summary: 1 and 2 are enforcement, 3 narrows the blind spot, and 4 is the only one that acts before the mistake exists.** A guard tells you after you got it wrong; the skill stops you writing it wrong. No single mechanism is sufficient, and R7 in particular **cannot be complete** — see its spec in slice 6.

And, per RC-5, a fourth surface that is **not** a unification target but a **second enforcement mechanism over the same source of truth**:

> **One source of truth (`admin_users`), two enforcement mechanisms, one per runtime: `AdminAccessService.isAdmin()` in Node, `public.is_platform_admin()` in SQL.**

---

## Table of Contents

1. [Settled Decisions](#settled-decisions)
2. [Analysis Summary](#analysis-summary)
3. [Implementation Approach](#implementation-approach)
4. [The CI Guard — Exact Specification](#the-ci-guard--exact-specification)
5. [The Pages Guard — Exact Specification](#the-pages-guard--exact-specification)
6. [The Database Surface — Sync Invariant](#the-database-surface--sync-invariant)
7. [Slice Index](#slice-index)
8. [Slice 0 — Pre-flight (blocking, no code)](#slice-0--pre-flight-blocking-no-code)
9. [Slice 1 — Stop anonymous writes and destructive actions (+ CI guard)](#slice-1--stop-anonymous-writes-and-destructive-actions--ci-guard)
10. [Slice 1L — Logging conformance for slice-1 files](#slice-1l--logging-conformance-for-slice-1-files)
11. [Slice 2 — Stop cross-tenant and internal-config reads](#slice-2--stop-cross-tenant-and-internal-config-reads)
12. [Slice 2L — Logging conformance for slice-2 files](#slice-2l--logging-conformance-for-slice-2-files)
13. [Slice 3 — Resolve the customer-visible config reads](#slice-3--resolve-the-customer-visible-config-reads)
14. [Slice 4 — One gate, one implementation](#slice-4--one-gate-one-implementation)
15. [Slice 5 — Server-side guard for /admin pages](#slice-5--server-side-guard-for-admin-pages)
16. [Slice 6 — Close the CI gate](#slice-6--close-the-ci-gate)
17. [Slice 7 — Retire the admin management surface](#slice-7--retire-the-admin-management-surface)
18. [Slice 8 — Correct the documentation](#slice-8--correct-the-documentation)
19. [RC Traceability Matrix](#rc-traceability-matrix)
20. [Risks & Flagged Callers](#risks--flagged-callers)
21. [Open Issues Raised, Not Fixed Here](#open-issues-raised-not-fixed-here)
22. [SA Review Notes](#sa-review-notes) → **[SA Workplan Review](#sa-workplan-review) — 10 required changes (W-1 … W-10) + 5 inline corrections. Read before starting slice 0.**
22b. **[SA Code Review — Slice 0 + 1](#sa-code-review--slice-0--1) — APPROVED WITH CHANGES. One blocking defect (D-1) in the guard's parser; no application-code changes required. Do not deploy until P-1 is recorded.**
23. [QA Testing Report](#qa-testing-report) → **[QA Report — Slice 0 + 1](#qa-report--slice-0--1) — PASS WITH ISSUES. Application code clean; 3 new latent guard defects (D-Q1/D-Q2/D-Q3) + 2 doc defects. Two process gates open: P-1 (deploy) and P-3/BQ-5 (stated merge gate).**
24. [Commit Info](#commit-info)
25. [Change History](#change-history)

---

## Settled Decisions

Recorded here so no slice re-opens them.

| # | Question | Decision | Decided by | Consequence for this plan |
|---|---|---|---|---|
| **BQ-1** | What reward facts are customers entitled to see? | **Option A** — publish the single boolean on the existing `GET /api/system-config` path; gate `GET /api/admin/reward-config` in the **same commit**. No new endpoint, no new pattern. | SA, 2026-09-20 | Slice 3 |
| **BQ-2** | How are admins added/removed? | **Option B** — **retire** the admin Settings admin-management screen and its write path **now**. Admins are managed through the existing bootstrap path (`supabase/migrations/20260701_seed_admin_users.sql` + `scripts/seed-admin-users.ts`) until the platform needs self-service. **Do NOT build grant/revoke in this programme.** | **User, 2026-09-20** | Slice 7 is a **deletion**, not a rebuild. Cost of B: adding a third admin requires Supabase access. |
| **BQ-3** | What does a non-admin see at an `/admin` URL? | **Option A** — silently redirected to their normal dashboard (`/business-os`). **Anonymous and signed-in-non-admin must produce an IDENTICAL response — no distinguishable signal.** | **User, 2026-09-20** | Slice 5. The identical-response constraint is a test, not a note. |
| **BQ-4** | Fix F5 (profile self-promotion) now? | **Option A** — **tracked separately as its own P0.** NOT fixed here. Two cheap pieces do come in: (a) slice 8's doc must name the remaining `profiles.role` readers; (b) the CI guard must fail any **new** code that makes an access decision from `profiles.role`, allow-list starting empty. | SA + **User, 2026-09-20** | Slices 6/8 + guard rule R4 |
| **BQ-5** | Does anything outside the repo call `/api/admin/*`? | In-repo sweep complete and **negative** (no cron, no webhook, no server-to-server caller). One question outstanding to the deployment-access holder. **Blocks slices 1 and 2 only.** | SA, 2026-09-20 | Slice 0 task |
| **BQ-6** | Logging conformance in the same diff? | **Option B + SA amendment** — security slices stay minimal; a logging slice follows **immediately** after the slice that touched the files (1 → 1L, 2 → 2L), not at the end. | SA, 2026-09-20 | Slices 1L, 2L |

---

## Analysis Summary

### What this touches

| Area | Detail |
|---|---|
| **API routes** | 44 `route.ts` files under `app/api/admin/`, of which **41 change**; 3 (category A) are already correct and are untouched. Plus 2 files outside that tree that the guard's shape rules will surface (`app/api/v2/calibrate/batch/route.ts`, `app/api/system-config/route.ts`). |
| **Admin pages** | `app/admin/layout.tsx` + 21 `page.tsx` files (all `'use client'`, none guarded) + `app/admin/components/AdminHeader.tsx`, `AdminSidebar.tsx`. |
| **Customer pages** | Exactly two, and only in slice 3: `app/(protected)/agents/[id]/page.tsx`, `app/v2/agents/[id]/page.tsx`. |
| **Shared libs** | `lib/admin/requireAdminRoute.ts` (docstring only, RC-9); new `lib/admin/requireAdminPage.ts`. `lib/services/AdminAccessService.ts` and `lib/repositories/AdminUserRepository.ts` are **read-only** — not changed by this work. |
| **CI** | new `.github/workflows/admin-authz-guard.yml`, new guard test, one new `package.json` script. |
| **Database** | **No schema change in slices 0–2 and 4–8.** One data-seed migration in slice 3 (one `system_settings_config` key). `public.is_platform_admin()` is read-only here; slice 8 documents the sync invariant. |
| **Docs** | `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` (slice 8), the requirement MD (slice 0 pre-flight record), `docs/VERCEL_ENV_SETUP.md` (slice 0). |

### Re-verified against the worktree while writing this plan

| Claim | Verified |
|---|---|
| `requireAdmin` returns `{user} \| NextResponse`; 401 signed-out (including when `getUser()` throws), 403 non-admin, fail-closed on an `isAdmin` throw, logs `{userId}` only | ✅ `lib/admin/requireAdminRoute.ts:59-90` |
| Only 3 files import `requireAdmin` today (all `system-config*`) | ✅ |
| 7 route files import `AdminAccessService` directly under `app/api/admin/`; **1 more outside it** — `app/api/v2/calibrate/batch/route.ts:116` | ✅ |
| 21 `page.tsx` under `app/admin/`; **zero** `route.ts` under `app/admin/` | ✅ |
| `AdminAccessService` caches for 60 s (`CACHE_TTL_MS = 60_000`) and performs an email→`user_id` self-heal **write** | ✅ `lib/services/AdminAccessService.ts:41,113` |
| Neither CI workflow runs `npm test`; `plugin-tests.yml` is `paths:`-filtered to `lib/server/**`, `lib/plugins/**`, `tests/plugins/**`; `bos-llm-typecheck.yml` deliberately has **no** `paths:` filter | ✅ |
| Guard precedent exists: `lib/business-os/purge/__tests__/no-deletion-paths.guard.test.ts` (repo-wide shape scan, allow-list-with-reason, unit-tested comment stripper) | ✅ |
| Behavioural gate-test precedent exists: `app/api/admin/__tests__/auditAdminGate.test.ts` (table-driven, mocks `getUser` + `AdminAccessService`, asserts *no table was read* on denial) | ✅ |
| `public.is_platform_admin()` exists, `STABLE SECURITY DEFINER`, matches `admin_users` by `auth.uid()` **or** JWT email | ✅ `supabase/migrations/20260920a_lock_system_settings_and_pricing_rls.sql:133-160` |
| The only `profiles.role` policy text left in migrations is inside a **commented** rollback block | ✅ same file, lines 305-320 |
| Post-login dashboard is `/business-os` | ✅ `app/auth/callback/page.tsx:140` |

### Four findings beyond the SA's requirement review — all confirmed by SA 2026-09-20

| # | Finding | Where it lands |
|---|---|---|
| **N-1** | **`GET /api/admin/settings/admin-users` performs a WRITE.** Lines 40-70 upsert `system_settings_config.admin_users` to "bootstrap the current user as super_admin" when the list is empty, with the **service role**. Any signed-in customer who is first through the door writes themselves in as `super_admin` **through a GET**. It grants nothing (nothing reads that key for access) so it is not a live escalation, but it is an unauthenticated-in-effect service-role write behind a verb nobody audits. It is not a read — it belongs in **slice 1**, not slice 2. ✅ SA-confirmed. | Slice 1 |
| **N-2** | **The `profiles.role` guard rule (R4) is NOT green on day one** — but for a reason that resolves itself. **6** `role === 'super_admin'` comparisons exist (**W-8 correction: 6, not 5**) — `app/admin/settings/page.tsx:322,447,457,461` + `app/api/admin/settings/admin-users/route.ts:210,211` *(**D-Q4**: these were 196,197 before slice 1 inserted the gate; `page.tsx`'s four are unchanged, that file was not modified)* — all in the two files **slice 7 deletes**, and all reading `system_settings_config.admin_users[].role`, **none** reading `profiles`. **`route.ts:211` sits inside `.filter(a => a.role === 'super_admin')`**, so R4's `.filter(`/`.some(` clause must catch it or the allow-list is under-counted and the rule under-tests. R4 therefore ships in slice 1 with a **2-entry (6-occurrence) dated allow-list** that slice 7 empties — exactly RC-2's shrinking-allow-list mechanic. ✅ SA-confirmed. | Slice 1 → Slice 7 |
| **N-3** | **`.env.example` does not exist, and `.gitignore:38` ignores `.env*`.** RC-1(b) ("add `ADMIN_EMAILS` to `.env.example`") is not literally implementable. ✅ SA-confirmed as a finding — **but the proposed remedy is REJECTED (W-1).** SA amended its own RC-1(b): the repo is **public** and has already had a live `service_role` key committed, so a `!.env.example` negation opens a class of exceptions to a blanket secrets-ignore in order to document **one variable `docs/VERCEL_ENV_SETUP.md` already covers**. The real lockout protection is slice 0's **P-1** verification, not a template file. **Docs-only. OI-8 closed, not tracked.** | Slice 0 (docs row only) |
| **N-4** | **[SA finding]** **`GET /api/system-config` is unauthenticated, service-role-backed and accepts arbitrary `keys`/`category`.** The route has no `getUser()` and no gate, and `SystemConfigRepository` is built from `supabaseServer` (`lib/repositories/SystemConfigRepository.ts:5`), so **RLS does not apply** — anyone on the internet can enumerate and read any `system_settings_config` row. Read-openness at the RLS level is a deliberate documented decision; a **service-role route with a caller-supplied key/category** is broader than that decision covers. **Out of scope** (it predates this programme and needs its own caller analysis) but directly load-bearing: it is the **second reason** slice 3 must not route the reward flag through it, and it would have made the original `category: 'rewards'` design leak every future rewards key to anonymous callers. | Tracked as **OI-15**; cited in slice 3 |

---

## Implementation Approach

### Why the gate is applied per-handler, not per-file

Several route files mix a write and a read (`agent-generation-config` is `GET,PUT`; `boost-packs` is `GET,POST,PUT,DELETE`). Slices 1 and 2 split on **verb**, not on file, so nine files are edited twice — once in slice 1 for the write verb, once in slice 2 for the GET. That is deliberate: it keeps slice 1 provably incapable of breaking a customer-facing read, which is the whole reason the BA split it that way.

The consequence for the CI guard: **rule R1 checks each exported handler, not the file.** A file where `PUT` is gated and `GET` is not must still fail. Without that, slice 1 would turn the guard green for nine files that are still anonymously readable.

### The uniform edit

Every gated handler gets exactly this shape, and nothing else changes in the handler:

1. `import { requireAdmin } from '@/lib/admin/requireAdminRoute';`
2. a `correlationId` + `requestLogger` child logger (CLAUDE.md API route pattern) if the file has no logger yet
3. as the **first** statement in the `try` — before any body parse, DB read, write, job trigger, or outbound message (FR-5 as reworded by RC-7):
   ```
   const gate = await requireAdmin(requestLogger);
   if (gate instanceof NextResponse) return gate;
   const { user } = gate;
   ```
4. nothing else. No data-access refactor, no repository migration, no log rewrite. Those are slices 1L/2L and tracked open issues.

**FR-5 note (RC-7):** the gate's own `AdminAccessService` email self-heal *is* a write, to the authorization's own table, for a caller who has just proven they are an admin. It is part of the check, not handler work. Do not "fix" it.

**Module-scope clients (SA §6.6):** several category D routes construct a service-role Supabase client at module scope (e.g. `app/api/admin/reward-config/route.ts:10-13`). Constructing a client performs no I/O, so this is harmless and **must not be touched** in these slices — neither "fixed" nor used as an excuse to relocate real work to module scope while tidying.

### Test strategy per slice

Two test files per security slice, mirroring the two precedents already in the repo:

| Kind | Shape | Precedent |
|---|---|---|
| **Behavioural** | table-driven Jest test importing every touched handler; asserts 401 anonymous, 403 signed-in-non-admin, 403 when `isAdmin` throws, 2xx for an admin, and — critically — **that no table was read and no write attempted on a denial** (the mocked Supabase client records `from(table)` calls) | `app/api/admin/__tests__/auditAdminGate.test.ts` |
| **Static** | the repo-wide shape guard, shrinking allow-list | `lib/business-os/purge/__tests__/no-deletion-paths.guard.test.ts` |

"What proves the failure path" is therefore not an afterthought — the denial assertions (401/403 + zero table access) *are* the test.

---

## The CI Guard — Exact Specification

**File:** `lib/admin/__tests__/admin-authz-surface.guard.test.ts` (new, slice 1)
**Runner:** `npm run test:authz-guard` → `jest lib/admin/__tests__/admin-authz-surface.guard.test.ts --ci`
**Workflow:** `.github/workflows/admin-authz-guard.yml` (new, slice 1)

### What it checks — six rules, scanned by SHAPE not by path

RC-4 is explicit that scoping the guard to `app/api/admin/` "repeats the precise mistake the repo's own `no-deletion-paths.guard.test.ts` docstring was written to warn against". Scan roots: `app`, `lib`, `components`, `hooks`, `supabase`.

| Rule | RC | Fails when | Allow-list at slice 1 | Empty by |
|---|---|---|---|---|
| **R1** | 4(a) | a `route.ts` under `app/api/admin/**` exports an HTTP handler (`GET`/`POST`/`PUT`/`PATCH`/`DELETE`) whose body does not call `requireAdmin(` — **per handler**, not per file. **W-7: R1 recognises BOTH export forms and fails closed on any it cannot parse** (see below). | the ungated handlers not yet reached: all of slice 2's 21 files' GETs + slice 3's 4 GETs + slice 4's 7 files | Slice 6 |
| **R2** | 4(b) | **any** `route.ts` anywhere imports `AdminAccessService` (this is what stops slice 4's de-duplication silently regressing, and what catches copy #8 landing in a different folder) | 7 category-B files + `app/api/v2/calibrate/batch/route.ts` | Slice 6, down to the **1 permanent** entry (`calibrate/batch` — a capability flag, not a route gate; see Open Issues OI-3) |
| **R3** | 4(c) | **any** `route.ts` exists under `app/admin/**` — route handlers are *not* wrapped by layouts, so one would be an unguarded admin surface inside the guarded tree | empty (0 today — keep it 0) | already empty |
| **R4** | 4(d) / BQ-4 | a file under `app/`/`lib`/`components/`/`hooks/` **compares a `role` value to an admin-ish literal** (`admin`, `super_admin`, `platform_admin`) via `===`/`!==`/`==`/`!=`/`.includes(`/`.some(`/**`.filter(`** (W-8), or does `.eq('role', '<admin-ish>')`, or selects `role` from `profiles` and branches on it | **2 entries / 6 occurrences**, both files deleted by slice 7: `app/admin/settings/page.tsx` (4), `app/api/admin/settings/admin-users/route.ts` (2, one inside a `.filter(`) — N-2 as corrected by W-8 | Slice 7 |
| **R5** | 4(e) / FR-17 | a file under `supabase/migrations/**` or `supabase/SQL Scripts/**` contains a `CREATE POLICY` that references `profiles` and `role` **after SQL comments are stripped** | empty | already empty |
| **R6** | 10 | `app/admin/layout.tsx` is `'use client'`, or does not call the page guard | 1 entry (the layout as it stands today) | Slice 5 |

### W-7 — R1 must parse both handler export forms, and fail closed on the rest

SA verified that **all 44** current admin route files use `export async function GET|POST|PUT|PATCH|DELETE`. A handler written `export const GET = async (req) => { … }` — valid Next.js — would match a naive scan and **pass ungated**. So:

| Requirement | Detail |
|---|---|
| Recognise **`export async function NAME`** | the form all 44 files use today |
| Recognise **`export const NAME = …`** (and `export let`/`export var`, `export function` without `async`) | a unit test in the guard file asserts an `export const GET = async () => {}` fixture **without** `requireAdmin` is flagged |
| **Fail closed on anything else** | a `route.ts` under `app/api/admin/**` that exports one of the five HTTP names in a form the scanner cannot attribute to a body (e.g. `export { handler as GET }`, `export * from …`) is **flagged**, not skipped. The failure message says "unparseable handler export — the guard cannot prove this is gated". |
| **Zero-handler files are flagged too** | a `route.ts` under `app/api/admin/**` from which the scanner extracts **no** handler at all is suspicious by construction: either it is dead, or the parser missed something. Flag it. |

> A shape guard that silently skips what it cannot understand is the failure mode that matters — it is the permissive-direction failure the precedent's docstring warns about.

### Anti-false-positive requirements (these are the parts that get a guard switched off)

- **R4 must not fire on LLM message roles.** `{ role: 'user' }`, `role: 'assistant'`, `role: 'system'` appear hundreds of times in this repo. R4 matches only **comparisons against admin-ish literals** and never a property *assignment*. A unit test in the same file asserts R4 is silent on `messages.push({ role: 'system', content })`.
- **W-10 — R4 must not fire on organisation roles.** `lib/repositories/OrganizationRepository.ts:279` selects `role` from `organization_members` — a **different and legitimate** role concept (org membership, not platform admin). No current comparison against an admin-ish literal exists there, so R4 should be **silent**. Verify this explicitly. **If it fires, allow-list it with the reason — do not narrow the rule**, because narrowing to avoid one false positive is how the rule stops catching the real thing.
- **R5 must strip SQL comments first.** Every `profiles.role` policy text remaining in `supabase/migrations/` is inside a comment — including a full commented rollback block at `20260920a_lock_system_settings_and_pricing_rls.sql:305-320`. Without a stripper, R5 is red on day one on a file that is *correct*.
- **The comment stripper is itself unit-tested, in the same file, against that exact input** — this is the precedent's own lesson (its docstring records a stripper bug where a glob in a line comment opened a block-comment match that swallowed real code, and notes the same bug fails *silently* in the permissive direction).
- **A hit inside a string literal still counts.** A false positive costs a conversation; a false negative costs the platform.
- **Allow-list, never a deny-list**, one written reason per entry, each entry dated. This satisfies FR-11 for free: an exception is a line in a diff that a reviewer must argue for.
- **Every allow-list entry asserts the file exists.** A stale exemption silently covers a future file re-created at the same path.

### How it is wired so it ACTUALLY runs on a new admin route

SA verified both obstacles; both are designed around:

1. **Neither existing workflow runs `npm test`.** A Jest test added today executes on the author's machine and nowhere else. → The guard gets its **own workflow** running `npm run test:authz-guard`. It is not attached to `plugin-tests.yml`.
2. **A path-filtered workflow is defeated by the change it guards.** A new file at `app/api/admin/new-thing/route.ts` matches none of `plugin-tests.yml`'s filters. → `admin-authz-guard.yml` has **no `paths:` filter at all**, following the pattern `bos-llm-typecheck.yml` already chose deliberately and documents in its header. The workflow header will say *why*, in the same voice.

```
name: Admin Authz Guard
on:
  push:        { branches: [main] }
  pull_request: { branches: [main] }
  workflow_dispatch:
permissions: { contents: read }
concurrency: { group: admin-authz-guard-${{ github.ref }}, cancel-in-progress: true }
# jobs: checkout → setup-node 18 (cache npm) → npm ci → npm run test:authz-guard
```

3. > ⚠️ **A workflow is not a build gate until it is a required status check on `main`.** That is a **GitHub repository setting, not a file in this diff.** Until the repo owner enables it, the DoD sentence "adding an unguarded admin route fails the build" is **false** — the run is merely red somewhere nobody is obliged to look. This is tracked as an explicit **manual step for the repo owner** in slice 6's checklist, and slice 6 is not Done without it.

---

## The Pages Guard — Exact Specification

**SA-approved approach (RC-10), not one of the four rejected alternatives.**

| Step | Change |
|---|---|
| 1 | Move the **current** `app/admin/layout.tsx` **verbatim** (still `'use client'`, same `useState`, same markup, same imports of `AdminSidebar`/`AdminHeader`) to `app/admin/components/AdminChrome.tsx`, renamed `AdminChrome`. |
| 2 | Rewrite `app/admin/layout.tsx` as an **`async` Server Component** that awaits the guard, then renders `<AdminChrome>{children}</AdminChrome>`. |
| 3 | New `lib/admin/requireAdminPage.ts` — the page-surface sibling of `requireAdminRoute.ts`: `getUser()` in `try/catch` → `AdminAccessService.isAdmin()` in `try/catch` (fail closed) → on any "no", `redirect('/business-os')`. Logs `{ userId }` only, or nothing at all when anonymous. |

**Why this and not a route group, a per-page call, middleware, or a client check:** in the App Router every `app/admin/**/page.tsx` renders as the `children` of `app/admin/layout.tsx`, and the layout's server render completes before the page's RSC payload is produced. There is no per-page "skip my parent layout" escape. That is **FR-9 satisfied by construction** — a materially stronger guarantee than anything available on the API side. An `app/admin/(guarded)/` route group was rejected because it creates a *second valid position for a page*, only one of which is protected.

### The three escapes — written down, not assumed away (RC-10)

| # | Escape | Status |
|---|---|---|
| **E1** | **A `route.ts` under `app/admin/` is not wrapped by layouts.** Route handlers bypass the layout entirely, so one placed there would be an unguarded admin surface *inside* the guarded tree. | **Closed by construction.** Zero exist today; guard rule **R3** keeps it at zero. This is the real escape and the requirement did not mention it. |
| **E2** | **Layouts do not re-render on soft navigation.** The guard runs on entry to the `/admin` subtree and on full page loads — not on every client-side navigation between sibling admin pages. | **Accepted, and the reason is in the plan, not in a comment.** It is acceptable *only because slices 1–2 make the underlying data unreachable*. Hence FR-7 is amended: the page guard is **defence-in-depth**; **the API gate (slices 1–2) is the security boundary.** |
| **E3** | **Admin content at a URL outside `/admin`.** The guard protects a URL subtree, not "admin-ness". `app/api/v2/calibrate/batch/route.ts` is a live example on the API side. | **Out of scope, stated as a boundary.** Partially mitigated by guard rules R2 and R4, which scan by shape repo-wide. Tracked as OI-3. |

### Two implementation notes that are cheap to get wrong

- `getUser()` calls `cookies()`, so the **whole `/admin` segment becomes dynamically rendered**. That is correct and harmless here — all 21 pages fetch at runtime anyway.
- `redirect()` from `next/navigation` **throws to signal**. It must **not** sit inside a `try/catch` that swallows it. The auth lookup gets its own narrow `try/catch`; the `redirect()` call sits outside it.

### The BQ-3 identical-response constraint is a test, not a note

An anonymous visitor and a signed-in non-admin must receive the **identical** response from the `/admin` boundary — same status, same `Location`, same body. Redirecting anonymous users to `/login` and non-admin users to `/business-os` would make the difference between them the very disclosure option A exists to prevent. **Both get `redirect('/business-os')`.** An anonymous visitor is then bounced onward by `/business-os`'s own auth, which is its behaviour for any unauthenticated visitor and reveals nothing about `/admin`.

#### W-5 — the fixture is an ONBOARDED signed-in non-admin, and here is why

**`middleware.ts` runs before the layout, and `/admin` is deliberately NOT on its skip list.** So:

| Caller | Middleware does | Reaches the layout guard? | Final destination |
|---|---|---|---|
| Anonymous (no auth cookies) | no token → falls through | ✅ yes | `/business-os` |
| Signed-in non-admin, **onboarded** | `onboarding_completed = true` → falls through | ✅ yes | `/business-os` |
| Signed-in non-admin, **NOT onboarded** | redirects to `/onboarding-chat` | ❌ never gets there | `/onboarding-chat` |

**This is not a disclosure.** That user is sent to `/onboarding-chat` from *every* protected path, so it reveals nothing about `/admin`. But the test as originally specified ("anonymous vs signed-in non-admin") **goes red on an un-onboarded fixture for a non-security reason** — and the likely reaction to a red security test is to weaken it.

> **Fix the fixture, do not weaken the assertion.** The identical-response test uses an **onboarded** signed-in non-admin. The un-onboarded case is documented here as expected middleware behaviour, and is separately asserted to land on `/onboarding-chat` (proving it never reaches admin content either).

**Second observed behaviour to record, not assume (W-5):** `app/business-os/layout.tsx` performs **no server-side auth** — it wraps children in a client `UserProvider`. An anonymous visitor redirected from `/admin` therefore **briefly renders the Business OS shell** before client auth moves them on. No loop, no admin content, no disclosure — but task 5.9 must *record that observed behaviour* rather than assert a server-side redirect that does not exist.

---

## The Database Surface — Sync Invariant

Per RC-5, the database is **not a unification target**. Node cannot evaluate a Postgres policy; Postgres cannot call `AdminAccessService`. Attempting to unify them would mean either an RLS policy calling out to the app (impossible) or the app trusting RLS to gate routes (it can't — most admin routes use the service role and bypass RLS entirely).

**The invariant this programme adopts and documents:**

> **One source of truth (`admin_users`), two enforcement mechanisms, one per runtime:**
> **`AdminAccessService.isAdmin()` in Node · `public.is_platform_admin()` in SQL.**

### Work that keeps the two in sync

| Item | Slice | Mechanism |
|---|---|---|
| No RLS policy may express admin-ness any other way, and never via `profiles.role` (FR-15/FR-17) | 1 (rule ships) → 6 (closed) | Guard rule **R5** |
| No app-code access decision may read `profiles.role` (FR-2, BQ-4 pull-in) | 1 (rule ships) → 7 (allow-list emptied) | Guard rule **R4** |
| Both mechanisms read `admin_users` — the **only** permitted divergence is documented | 8 | `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` |
| Record which tables are `is_platform_admin()`-backed today vs still service-role-only-by-convention | 8 | same doc |

### The known, deliberate divergence — must be a written invariant, not a comment in one migration

`public.is_platform_admin()` intentionally does **not** implement two of `AdminAccessService`'s resolution paths, because the database has no access to them:

| Path | Node | SQL | Consequence |
|---|---|---|---|
| `admin_users` row bound to `user_id` | ✅ | ✅ | in sync |
| `admin_users` row matched by email | ✅ | ✅ (via `auth.jwt() ->> 'email'`) | in sync |
| **`ADMIN_EMAILS` env fallback** | ✅ | ❌ (no env in Postgres) | **divergent** |
| **email → `user_id` self-heal write** | ✅ | ❌ | **divergent** |

> **The invariant to write down:** *an admin who exists only in `ADMIN_EMAILS` and has never made an API call passes every app-code check and fails every RLS policy.*

Benign today, because admin data access runs through `supabaseServer`. It is exactly the asymmetry that produces an "it works in the admin UI but the table comes back empty" bug later.

**Revocation semantics (RC-8).** In app code, revocation takes effect **within the 60 s `AdminAccessService` cache TTL**, per Node process. In RLS it is **immediate** (`is_platform_admin()` is `STABLE`, evaluated per statement, uncached). The cache is **not** removed — NFR-Performance rightly protects it.

**What the database surface does NOT close (RC-13).** After slice 1, most category D routes are admin-only — but they still construct a service-role client inline (e.g. `app/api/admin/reward-config/route.ts:10-13`) and therefore still bypass **both** RLS and the repository layer (CLAUDE.md mandatory rule 1). **They are gated, not isolated.** Deliberately deferred; see OI-5.

---

## Slice Index

### The binding merge order (W-9)

> **0 → 1 → 1L → 2 → 2L → 3 → 4 → 5 → 7 → 6 → 8**

Two constraints make it binding, both confirmed by SA 2026-09-20:

| Constraint | Why |
|---|---|
| **7 before 6** | Guard rule R4's two allow-list entries are `app/admin/settings/page.tsx` and `app/api/admin/settings/admin-users/route.ts` — **both files slice 7 deletes**. Slice 6's "allow-list empty" is unreachable in numeric order. |
| **8 after 6** | Slice 8 records the required-status-check **enablement date**, which does not exist until slice 6 is done. |

**Permitted variation (SA):** slice 7 may move earlier, to immediately after 1L — closing R4 sooner and removing the "slice 1 is gating a lie" oddity.

> **Choice made: slice 7 stays late, in the position shown above.** It deletes a screen and is the only **user-visible** change in the programme other than slice 3; keeping it after slice 5 means the pages guard is already live when the admin Settings entry disappears, so an operator never sees a missing screen on an unguarded surface. This is the more conservative option and it is what the PR body will state.

| # | Slice | Goal (one line) | Files | Difficulty | Blocks / blocked by | Status |
|---|---|---|---|---|---|---|
| **0** | Pre-flight | Prove the operator can still get in, amend the requirement contract, and finish the enumerations slices 2/3 depend on | **2 + requirement MD + this workplan** | 🟢 | **Blocks 1, 2, 5** | ✅ **Code-side complete** · 🔒 P-1/P-3 blocked on the deployment-access holder |
| **1** | Stop anonymous writes & destructive actions **+ ship the CI guard** | No anonymous caller can change platform config, trigger a job, or send a message — and the guard lands now, with a shrinking allow-list | **26** | 🔴 | Blocked by 0 (+ BQ-5) | ✅ **Code complete** — awaiting SA/QA |
| **1L** | Logging conformance (slice-1 files) | 202 `console.*` calls in 18 slice-1 files become structured Pino | **18** | 🟢 | Immediately after 1 | ⬜ |
| **2** | Stop cross-tenant & internal-config reads | No anonymous or non-admin caller can read another customer's data or internal tuning config | **23** | 🔴 | Blocked by 0 (+ BQ-5) | ⬜ |
| **2L** | Logging conformance (slice-2 files) | 16 `console.*` calls in 6 read-only slice-2 files become structured Pino | **6** | 🟢 | Immediately after 2 | ⬜ |
| **3** | Resolve the customer-visible config reads | The share-reward indicator keeps working from a customer-readable **projection**, and the full reward ruleset stops being public — **in one commit, no migration** | **8** | 🟡 | — | ⬜ |
| **4** | One gate, one implementation | Zero hand-written admin checks remain in any route file | **9 edited + 5 verified** | 🟢 | — | ⬜ |
| **5** | Server-side guard for `/admin` pages | Protection becomes a property of the route tree, inherited by page 22 before its author writes a line | **6** | 🔴 | Blocked by 0 | ⬜ |
| **7** | Retire the admin management surface | Delete the screen and the two routes that write to a store which grants nothing | **6** | 🟡 | **Must precede 6** | ⬜ |
| **6** | Close the CI gate **+ R7, the inverted rule** | Allow-list is empty (bar one permanent, justified entry), the workflow is a **required status check**, and admin capability is caught **wherever it lives**, not only under the admin path | **2 + 1 manual repo setting** | 🟢 | After 1–5 **and 7** | ⬜ |
| **8** | Correct the documentation **+ authoring-time guidance** | The access doc describes what the code actually does, **and the scaffolding skill stops teaching a wrong admin check** — so the next author is told the right thing before CI has to tell them the wrong one | **6** | 🟢 | **After 6** | ⬜ |

**Total distinct files touched across the programme: 89** (some files appear in more than one slice by design — see *Files edited in more than one slice* below). Reduced from 92 by W-1 (−2: no `.env.example`, no `.gitignore` edit) and W-3 (−1: no migration).

> **No migration ships in this programme** (W-3). If any slice starts needing one, stop and escalate to SA.

### Files edited in more than one slice (stated so a second diff does not read as a partial revert)

| File | Slices | Why |
|---|---|---|
| `app/api/admin/reward-config/route.ts` | 1 (POST gate) → 1L (logging) → 3 (GET gate **only** — no mirror write, per W-3) | SA: "say so, or the second diff reads as a partial revert" |
| `app/api/admin/boost-packs/route.ts` | 1 (POST/PUT/DELETE) → 1L → 3 (GET) | ⚠️ catalogue read deferred to 3 |
| `app/api/admin/execution-tiers/route.ts` | 1 → 3 (GET) | ⚠️ catalogue read |
| `app/api/admin/storage-tiers/route.ts` | 1 → 3 (GET) | ⚠️ catalogue read |
| `app/api/admin/agent-generation-config/route.ts`, `ais-config`, `backfill-embeddings`, `helpbot-config`, `memory-config`, `memory-consolidation`, `onboarding-config`, `orchestration-config`, `ui-config` | 1 (write verb) → 1L → 2 (GET) | verb-split, not file-split |
| `lib/admin/__tests__/admin-authz-surface.guard.test.ts` | 1 (created) → 2, 3, 4, 5, 6, 7 (allow-list shrinks) | RC-2's mechanic; each shrink is the review artefact |

---

## Slice 0 — Pre-flight (blocking, no code)

**Difficulty:** 🟢 · **Blocks slices 1, 2 and 5.** · **Status:** ⬜

### Goal

Prove that after the gates close, the operator can still get in — and finish the two enumerations that slices 2 and 3 already depend on. This is the most likely way this programme causes an incident, and the original plan had nothing for it.

**The failure it prevents:** slices 1/2/5 all deny when `AdminAccessService.isAdmin()` returns false. Admin identity resolves from the `admin_users` table (seeded by `supabase/migrations/20260701_seed_admin_users.sql`, two emails) **plus** the `ADMIN_EMAILS` env fallback — and `ADMIN_EMAILS` appears in no env template in this repo. If slice 1 lands where neither is true in a deployed environment, **every admin write returns 403 to everyone including the owner** — and under BQ-2 option B the in-product way to fix it has just been deleted, so recovery needs direct Supabase access. Deploying slice 5 into that state additionally makes `/admin` inaccessible with a **silent redirect and no on-screen explanation** (BQ-3 option A).

### Files touched

| File | Action | Change |
|---|---|---|
| `docs/requirements/ADMIN_AUTHZ_UNIFICATION_REQUIREMENT.md` | modify | **Two jobs.** (i) **W-2 — amend the contract** (see the table below): apply the six RCs that instruct requirement edits and were never applied. (ii) Append a **`## Slice 0 — Pre-flight Record`** section holding the per-environment admin-identity verification, the BQ-5 answer and who gave it, and the full caller enumeration for every read route slices 2 and 3 touch. **In this document, not a PR body** — PR bodies are not a durable source of truth (CLAUDE.md single-source-of-truth principle). |
| `docs/VERCEL_ENV_SETUP.md` | modify | Add an `ADMIN_EMAILS` row: purpose, format (comma/semicolon separated), which environments need it, and the "app-side only, invisible to RLS" divergence. **This is the whole of W-1's remedy.** |
| `docs/workplans/admin-authz-unification.md` | modify | Record the outcomes in the Change History. |

~~`.gitignore`~~ and ~~`.env.example`~~ — **DROPPED per W-1.** Do not create the file and do not add a `!.env.example` negation. Reasoning: the repo is **public** and has already had a live `service_role` key committed; loosening a blanket secrets-ignore opens a class of exceptions in order to document one variable `docs/VERCEL_ENV_SETUP.md` already covers. The real lockout protection is **P-1**, not a template. **OI-8 closed, not tracked.**

**File count: 2 + this workplan.**

### W-2 — the requirement amendments (blocking; must land before slice 1)

Six RCs instructed edits to the **requirement document** — the artefact QA tests against — and the first workplan honoured their intent in slices without ever applying them. Today the requirement still contradicts this plan. Each row is applied to `docs/requirements/ADMIN_AUTHZ_UNIFICATION_REQUIREMENT.md`:

| RC | Amendment | Why it must be in the contract, not just the plan |
|---|---|---|
| **RC-7** | **Reword FR-5** to bound *handler* work: "no handler work — no body parse, no business data read, no write, no job trigger, no outbound message — begins before the gate returns an admin", with a note that `AdminAccessService`'s email self-heal is the one write that is **part of the check**. | As written, FR-5 says the gate itself violates FR-5. A careful QA or Dev will read that as a defect and "fix" it. |
| **RC-10** | **Amend FR-7** to state the page guard is **defence-in-depth** and that **the API gate (slices 1–2) is the security boundary**; add the three escapes E1/E2/E3. | FR-7 as written leads a reader to believe the opposite, which would make slice 5 look like it closes the hole. |
| **RC-4** | **Widen FR-10** to scan by shape: (a) admin `route.ts` without the gate; (b) **any** `route.ts` importing `AdminAccessService`; (c) any `route.ts` under `app/admin/**`; (d) any access decision from `profiles.role`; (e) any migration adding an RLS policy referencing `profiles.role`. | FR-10 scoped to `app/api/admin/` cannot see copy #8 in another folder. |
| **RC-5** | **Add FR-15 / FR-16 / FR-17** (DB predicate is `public.is_platform_admin()`; the sync invariant and its one permitted `ADMIN_EMAILS` divergence; the guard fails on a new `profiles.role` RLS policy) and **rewrite the DoD "…and the database" row** around one-source/two-mechanisms. | The database is one third of the stated goal and the DoD currently carries an IOU. |
| **RC-13** | **DoD database row must name the gap it does not close:** the former category D routes still construct service-role clients inline, bypassing RLS **and** the repository layer. **Gated, not isolated.** | Otherwise the DoD implies the database surface is covered. |
| **RC-14** | **Rework the Open Business Questions section** to settled: BQ-1/BQ-4/BQ-6 resolved by SA; BQ-5 re-scoped to one question with a named owner and a blocking scope of slices 1–2 only; **BQ-2 = B and BQ-3 = A answered by the user 2026-09-20**. | Six open questions in the contract, two of which the user has already answered, is a contract QA cannot test against. |

Also fold in the requirement's own inline SA corrections that were never applied: the **slice-7 AC** must read "within the cache TTL (60 s)" in app code and "immediately" in RLS (**RC-8**), and the **F5 factual correction** — zero app-code access readers, DB policies already replaced (**RC-6**).

### Test plan

Slice 0 ships no code, so the "test" is a verification record. Each item is a stated result, not a checkbox anyone can tick from memory.

| # | What proves it works | What proves the failure path |
|---|---|---|
| P-1 | For **every environment this will deploy to** (local, Preview, Production): a read-only query confirms an `is_active = true` row in `admin_users` for the owner, **or** `ADMIN_EMAILS` is set there and contains the owner's address. Record the environment list and the result per environment. | Explicitly record any environment where **neither** holds. Slice 1 **must not deploy** to that environment until it does. This is the abort condition. |
| ~~P-2~~ | **Deleted per W-1.** There is no `.env.example` to make committable. | — |
| P-3 | BQ-5 answered by the deployment-access holder, verbatim, with a date. | If the answer is "yes, something polls an admin URL", it is added to *Risks & Flagged Callers* with an owner **before** slice 1 merges — the fix is a proper service credential, not re-opening the endpoint. |
| P-4 | Caller enumeration complete for **all 21 slice-2 routes and all 4 slice-3 routes**: for each, every in-repo `fetch`/client call listed with file:line and classified admin-operated / customer-facing / none. | Any newly found customer-facing caller is **moved out of slice 2 into slice 3** with its own resolution — never silently gated. This is the stated precondition the SA said "is real work and is not a slice". |
| **P-5** | **W-2 — the requirement contract matches this plan.** FR-5 no longer forbids the gate's own self-heal; FR-7 states defence-in-depth; FR-10 is widened to (a)–(e); FR-15/16/17 exist; the DoD database row names `is_platform_admin()` **and** the service-role/repository gap; the BQ section is settled. | Read the requirement after the edit and confirm no FR still contradicts the plan. A contract that contradicts the implementation is a QA failure waiting to be written up as a Dev defect. |

### Deploy safety

Nothing ships — slice 0 is documentation and verification only. If slices 1–8 are all delayed indefinitely, the residue is one doc row, an amended requirement that is *more* accurate than before, and a verification record. **Slice 0 is the one slice that is safe to merge in isolation forever.**

### Task checklist

- ✅ 0.1 Confirm branch is `feature/admin-authz-unification` (`git branch --show-current`) and the worktree is the `neuronforge-admin-authz` one, not the primary repo
- ✅ 0.2 Enumerate the deploy-target environments — list them explicitly, do not assume two
- 🔒 0.3 **P-1 — BLOCKED on the deployment-access holder.** Per environment: verify an `is_active` `admin_users` row for the owner, or `ADMIN_EMAILS` containing the owner. **Not resolvable by Dev** — requires Supabase console and Vercel env access. Exact checks written up in the Pre-flight Record.
- 🔒 0.4 **BLOCKED (same owner).** Record the second seeded admin and whether their row is bound to a `user_id` yet
- ~~0.5~~ **Deleted per W-1** (no `.env.example`, no `.gitignore` negation)
- ✅ 0.6 Add the `ADMIN_EMAILS` row to `docs/VERCEL_ENV_SETUP.md`, including the "app-side only, invisible to RLS" divergence
- 🔒 0.7 **P-3 — BLOCKED on the deployment-access holder.** BQ-5's single question; record the verbatim answer + date
- ✅ 0.8 **P-4** Enumerate callers for the 21 slice-2 routes and the 4 slice-3 routes; classify each
- ✅ 0.9 Append `## Slice 0 — Pre-flight Record` to the requirement MD with 0.2/0.8 results and the exact blocked checks for 0.3/0.4/0.7
- ~~0.10~~ **Closed by W-1** — SA decided N-3 docs-only; OI-8 closed
- ✅ 0.11 Report the abort-condition status to TL: the abort condition **cannot be evaluated by Dev**; it is stated as a named hand-off
- ✅ 0.12 **W-2** Amend `docs/requirements/ADMIN_AUTHZ_UNIFICATION_REQUIREMENT.md` per the six-RC table above (+ RC-6 and RC-8 inline corrections); verify **P-5**

---

## Slice 1 — Stop anonymous writes and destructive actions (+ CI guard)

**Difficulty:** 🔴 · **Blocked by slice 0 and the BQ-5 answer.** · **Status:** ⬜

### Goal

No anonymous caller can change platform-wide configuration, trigger a background job, mutate stored memory, or send a message on the platform's behalf. Reads are deliberately untouched, so **no customer-facing screen can regress in this slice**. The CI guard lands in the same slice (RC-2) carrying a dated allow-list of everything not yet gated.

### Files touched — write/action handlers only

#### D1 — Platform configuration writes (16 files)

| # | File | Handlers gated |
|---|---|---|
| 1 | `app/api/admin/agent-generation-config/route.ts` | `PUT` |
| 2 | `app/api/admin/ais-config/route.ts` | `POST` |
| 3 | `app/api/admin/ais-weights/route.ts` | `PUT` |
| 4 | `app/api/admin/ais-weights/combined/route.ts` | `PUT` |
| 5 | `app/api/admin/ais-weights/creation/route.ts` | `PUT` |
| 6 | `app/api/admin/boost-packs/route.ts` | `POST`, `PUT`, `DELETE` |
| 7 | `app/api/admin/calculator-config/route.ts` | `PUT` |
| 8 | `app/api/admin/execution-tiers/route.ts` | `POST`, `PUT`, `DELETE` |
| 9 | `app/api/admin/helpbot-config/route.ts` | `PUT` |
| 10 | `app/api/admin/memory-config/route.ts` | `PUT` |
| 11 | `app/api/admin/onboarding-config/route.ts` | `PUT` |
| 12 | `app/api/admin/orchestration-config/route.ts` | `PUT` |
| 13 | `app/api/admin/reward-config/route.ts` | `POST` |
| 14 | `app/api/admin/storage-tiers/route.ts` | `POST`, `PUT`, `DELETE` |
| 15 | `app/api/admin/system-limits/route.ts` | `PUT` |
| 16 | `app/api/admin/ui-config/route.ts` | `POST` |

#### D2 — Destructive or operational actions (5 files) — highest urgency

| # | File | Handlers gated | Effect if left open |
|---|---|---|---|
| 17 | `app/api/admin/backfill-embeddings/route.ts` | `POST` | kicks off a bulk background job |
| 18 | `app/api/admin/memory-consolidation/route.ts` | `POST` | mutates stored agent memory |
| 19 | `app/api/admin/messages/[id]/route.ts` | `PATCH`, `DELETE` | edits/deletes platform messages |
| 20 | `app/api/admin/messages/[id]/replay/route.ts` | `POST` | **re-sends a message — can send communications on the platform's behalf** |
| 21 | `app/api/admin/migrate-labels/route.ts` | `POST` | bulk data migration |

> `/api/cron/memory-consolidation` is a **separate route** from `/api/admin/memory-consolidation`. Gating the admin one does not touch the cron.

#### Category C — the write hidden in a read (1 file)

| # | File | Handlers gated | Why both verbs, in slice 1 |
|---|---|---|---|
| 22 | `app/api/admin/settings/admin-users/route.ts` | **`GET` and `POST`** | **N-1:** its `GET` (lines 40-70) *upserts* `system_settings_config.admin_users` to bootstrap the caller as `super_admin` when the list is empty. Any signed-in customer can write through it. It is not a read. Reviewers should know they are gating a write to a store that **grants nothing** — correct for this slice, and deleted outright in slice 7. |

#### CI guard + plumbing (4 files)

| # | File | Action | Change |
|---|---|---|---|
| 23 | `lib/admin/__tests__/admin-authz-surface.guard.test.ts` | **create** | The six-rule static shape scan specified above, with a dated allow-list, the unit-tested comment stripper, the R4-vs-LLM-message-role and R4-vs-organisation-role anti-false-positive tests (W-10), and **W-7's dual handler-export parsing with fail-closed on anything unparseable**. Follows `no-deletion-paths.guard.test.ts` — does **not** invent a second static-guard pattern. |
| 24 | `.github/workflows/admin-authz-guard.yml` | **create** | Dedicated workflow, **no `paths:` filter**, `on: push[main] + pull_request[main] + workflow_dispatch`, `permissions: contents: read`, concurrency group, Node 18, `npm ci`, `npm run test:authz-guard`. Header comment explains the no-filter choice. |
| 25 | `package.json` | modify | Add `"test:authz-guard": "jest lib/admin/__tests__/admin-authz-surface.guard.test.ts --ci"` |
| 26 | `app/api/admin/__tests__/adminGate.writes.test.ts` | **create** | Table-driven behavioural test over all 22 handlers above. |

**File count: 26.**

### Test plan

| What proves it works | What proves the failure path |
|---|---|
| For each of the 22 files, an **admin** caller (`getUser` → user, `isAdmin` → true) reaches the handler: the mocked Supabase client records the expected `from(table)` call and the handler returns its normal 2xx. | For each of the 22 files, **three denial cases**, each asserting **status AND that `mockTablesRead` is empty** (nothing happened before the gate — FR-5/RC-7): <br>• `getUser` → `null` ⇒ **401** <br>• `getUser` → user, `isAdmin` → `false` ⇒ **403** <br>• `getUser` → user, `isAdmin` **throws** ⇒ **403**, never 500 (fail closed, FR-3/FR-4) |
| A fourth denial case: `getUser` **throws** ⇒ **401**, never 500 — the self-gating UI (F3) depends on 401/403 never becoming 500. | |
| Denial responses contain **no email** and no information about the admin allow-list (FR-6, NFR-Security) — asserted on the response body and on the captured logger calls. | A test asserting the logger was called with `{ userId }` and that no captured log argument contains an `@`. |
| `npm run test:authz-guard` passes on the branch **as it stands after slice 1** (the allow-list exactly covers what is not yet gated). | **Two deliberate-breakage tests, run manually and recorded in the PR:** (a) add `app/api/admin/__scratch__/route.ts` with an ungated `GET` ⇒ guard **fails** naming the file and rule R1; (b) add `AdminAccessService` import to a non-allow-listed `route.ts` ⇒ guard **fails** on R2. Revert both. |
| The guard's own unit tests pass: comment stripper against `20260920a_…sql:305-320`; R4 silent on `{ role: 'system' }`. | R4 **fires** on a synthetic `if (profile.role === 'admin')` fixture; R5 **fires** on a synthetic uncommented `CREATE POLICY … profiles … role` fixture. |
| Manual: an admin operating the admin UI can still save every config screen. | Manual: signed out, `curl -X PUT /api/admin/system-limits` ⇒ 401. |

### Deploy safety

**If this ships and slice 2 is delayed indefinitely:** the platform is strictly safer — the highest-consequence hole (anonymous *writes* and irreversible actions) is closed. Cross-tenant *reads* remain open, which is the exact known state recorded in the requirement, and no customer-facing behaviour changes because no read is touched. The CI guard is already protecting the work in progress.

**Expected fallout, recorded so nobody diagnoses a phantom regression (RC-12):**

**W-4 correction applied.** Both scripts issue a bare `fetch(...)` with **no `method`** — i.e. a `GET` — and `ais-config`'s `GET` is not gated until **slice 2**. Neither performs a write probe. Recording fallout against the wrong slice is how a real regression gets waved through as "expected", so the column below says exactly when each breaks:

| File | Line | Call | Effect at slice 1 | Effect from slice 2 |
|---|---|---|---|---|
| `scripts/test-phase5-full-integration.ts` | 174 | anonymous `fetch('http://localhost:3000/api/admin/ais-config')` — a bare **GET** | **unchanged** — still passes | **401**; the script's Test 4 fails. **Expected.** |
| `scripts/test-phase6-final-verification.ts` | 287 | same bare **GET** | **unchanged** | **401**. **Expected.** |
| `scripts/test-phase3-full-integration.ts` | 170 | references `/api/admin/model-routing` — a route that **no longer exists** | already stale **before** this programme; unaffected by either slice | unaffected; deleted or marked in slice 8 housekeeping |

> **Net: slice 1 breaks no in-repo caller at all.** The dev-script fallout belongs to **slice 2** and must be recorded in slice 2's PR body, not slice 1's.

**Rollback:** each file's diff is three lines plus an import. Reverting one route is a surgical revert; reverting the slice is a single `git revert`. The guard is inert on a revert (its allow-list would simply be over-broad, never under-broad).

### Task checklist

- ✅ 1.1 Confirm slice 0's code-side work is complete; record that P-1/P-3 are **blocked on the deployment-access holder** and that slice 1 must not *deploy* until P-1 clears (it may be written and reviewed)
- ✅ 1.2 Write `lib/admin/__tests__/admin-authz-surface.guard.test.ts` — rules R1–R6, allow-list with one dated reason per entry, existence assertion per entry
- ✅ 1.3 Unit-test the comment stripper inside the guard file against `20260920a_…sql:305-320`
- ✅ 1.4 Unit-test R4's anti-false-positive behaviour on LLM `role:` literals **and organisation roles (W-10)**, and its positive behaviour on a synthetic `profile.role === 'admin'`
- ✅ 1.4b **W-7** Unit-test R1 against an `export const GET = async () => {}` fixture and against an unparseable export form; both must be flagged
- ✅ 1.5 Add `test:authz-guard` to `package.json`; confirm the guard is **red** before any route is gated (a guard that has never failed has never been tested)
- ✅ 1.6 Create `.github/workflows/admin-authz-guard.yml` with **no `paths:` filter** and the explanatory header
- ✅ 1.7 Gate D1 files 1–16 (write verbs only) — uniform edit, no other change
- ✅ 1.8 Gate D2 files 17–21 (action verbs)
- ✅ 1.9 Gate `settings/admin-users` **both verbs** (N-1) and note the reason in the PR body
- ✅ 1.10 Shrink the guard allow-list to exactly the still-ungated handlers; confirm `npm run test:authz-guard` is green
- ✅ 1.11 Write `app/api/admin/__tests__/adminGate.writes.test.ts` — 22 handlers × 4 denial cases + admin happy path + no-email-in-logs assertion
- ✅ 1.12 Run the deliberate-breakage checks; record the exact failure output in the PR body
- ✅ 1.13 Verify `components/admin/AdminCalibrationTrigger.tsx` still self-gates (it probes an already-gated route, so this is a regression check, not a change)
- ✅ 1.14 Record the dev-script fallout **against slice 2** (W-4), not slice 1
- ✅ 1.15 Flag to the user: 18 of these files carry 202 `console.*` calls; propose slice 1L per CLAUDE.md rule 3 and BQ-6's resolution. **Deliberately NOT converted in this slice.**

---

## Slice 1L — Logging conformance for slice-1 files

**Difficulty:** 🟢 · **Ships immediately after slice 1** (SA's amendment to BQ-6 option B: a conformance slice with no forcing function is precisely the debt the rule exists to prevent). · **Status:** ⬜

### Goal

Every file slice 1 touched that still logs via `console.*` moves to structured Pino (`createLogger` + `logger.*({ ...context }, 'message')`, errors as `{ err }`). One question per diff: slice 1 asked "is the hole closed?", 1L asks "is the logging compliant?".

### Files touched — 18 files, 202 `console.*` calls (measured)

| # | File | `console.*` count |
|---|---|---|
| 1 | `app/api/admin/ais-config/route.ts` | 75 |
| 2 | `app/api/admin/reward-config/route.ts` | **23** ⚠️ |
| 3 | `app/api/admin/system-limits/route.ts` | 12 |
| 4 | `app/api/admin/boost-packs/route.ts` | 11 |
| 5 | `app/api/admin/ais-weights/route.ts` | 9 |
| 6 | `app/api/admin/ais-weights/combined/route.ts` | 9 |
| 7 | `app/api/admin/ais-weights/creation/route.ts` | 9 |
| 8 | `app/api/admin/orchestration-config/route.ts` | 8 |
| 9 | `app/api/admin/ui-config/route.ts` | 8 |
| 10 | `app/api/admin/backfill-embeddings/route.ts` | 6 |
| 11 | `app/api/admin/calculator-config/route.ts` | 6 |
| 12 | `app/api/admin/migrate-labels/route.ts` | 6 |
| 13 | `app/api/admin/agent-generation-config/route.ts` | 5 |
| 14 | `app/api/admin/messages/[id]/route.ts` | 4 |
| 15 | `app/api/admin/memory-config/route.ts` | 3 |
| 16 | `app/api/admin/messages/[id]/replay/route.ts` | 3 |
| 17 | `app/api/admin/memory-consolidation/route.ts` | 2 |
| 18 | `app/api/admin/onboarding-config/route.ts` | 2 |

Slice-1 files already compliant and therefore **not** touched: `execution-tiers`, `storage-tiers`, `helpbot-config`, `settings/admin-users`.

> ⚠️ **`reward-config` is the named privacy item, not a formatting preference.** Lines 21-23 `console.log` the **full request URL** and a timestamp on **every** GET; lines 55+ log per-reward payload shapes including the eligibility/abuse-cap settings object. Converting it is a small privacy fix. It goes in **1L, not a backlog.**

**File count: 18.**

### Test plan

| What proves it works | What proves the failure path |
|---|---|
| `grep -c "console\." ` returns **0** for all 18 files. | The same grep on `main` returns the counts in the table — capture both, so the diff's scope is provable. |
| The slice-1 behavioural test (`adminGate.writes.test.ts`) passes **unchanged** — proving 1L changed logging only. | If any handler's control flow changed, that test fails. It is the regression oracle for this slice. |
| Each converted file uses `createLogger({ module: '…' })` and a `correlationId` child logger in each handler (CLAUDE.md API route pattern). | Manual spot-check of `reward-config`: no request URL and no config payload appears in any log line; `err` objects are passed as `{ err }`. |
| `npm run test:authz-guard` stays green. | — |

### Deploy safety

**If this ships and slice 2 is delayed:** zero behavioural change. Logging-only. The one substantive improvement is that `reward-config` stops writing request URLs and config payloads to logs.

**If 1L itself is delayed:** slice 1's security value is unaffected; the debt is the pre-existing `console.*` usage, unchanged from `main`. The forcing function is that 1L sits between slice 1 and slice 2 in the merge order.

### Task checklist

- ⬜ 1L.1 Record the before-counts (`grep -c` per file) in the PR body
- ⬜ 1L.2 Convert files 1–18 to `createLogger` + structured Pino; errors as `{ err }`; no message-text rewrites beyond what the structure requires
- ⬜ 1L.3 `reward-config`: remove the per-request URL log and the per-reward payload logs outright rather than converting them verbatim — they are the privacy item
- ⬜ 1L.4 Re-run `app/api/admin/__tests__/adminGate.writes.test.ts` unchanged; confirm green
- ⬜ 1L.5 Confirm `grep -rn "console\." ` is empty across the 18 files
- ⬜ 1L.6 Confirm no file outside the slice-1 set was reformatted (CLAUDE.md: don't reformat files you aren't working on)

---

## Slice 2 — Stop cross-tenant and internal-config reads

**Difficulty:** 🔴 · **Blocked by slice 0 (the caller enumeration, P-4) and the BQ-5 answer.** · **Status:** ⬜

### Goal

No anonymous or signed-in-non-admin caller can read another customer's data, platform-wide operating metrics, LLM spend, or internal tuning configuration. **Every ⚠️ catalogue-style GET is deliberately excluded and deferred to slice 3**, so this slice cannot break a customer screen.

### Files touched

#### D3 — Cross-tenant data reads (11 files)

| # | File | Handler | Exposure closed |
|---|---|---|---|
| 1 | `app/api/admin/users/route.ts` | `GET` | all platform users |
| 2 | `app/api/admin/users/[id]/stats/route.ts` | `GET` | any named user's usage |
| 3 | `app/api/admin/user-emails/route.ts` | `POST` | **a read shaped as a POST** — email addresses. Call this out in review so it is not mistaken for a write. |
| 4 | `app/api/admin/onboarding-users/route.ts` | `GET` | user onboarding state |
| 5 | `app/api/admin/messages/route.ts` | `GET` | platform message log |
| 6 | `app/api/admin/dashboard/route.ts` | `GET` | platform-wide operating metrics |
| 7 | `app/api/admin/execution-stats/route.ts` | `GET` | platform-wide execution metrics |
| 8 | `app/api/admin/storage-stats/route.ts` | `GET` | platform-wide storage metrics |
| 9 | `app/api/admin/token-usage/route.ts` | `GET` | platform LLM spend |
| 10 | `app/api/admin/token-usage/drill-down/route.ts` | `GET` | **per-user** LLM spend |
| 11 | `app/api/admin/token-usage/stats/route.ts` | `GET` | aggregate LLM spend |

#### Category C — the remaining signed-in-any-user read (1 file)

| # | File | Handler | Issue closed |
|---|---|---|---|
| 12 | `app/api/admin/settings/platform-users/route.ts` | `GET` | any signed-in customer could list every platform user |

#### D4 — Internal configuration reads, non-⚠️ (9 files, GET side only)

Each of these files already had its **write** verb gated in slice 1; this slice adds the gate to its `GET`. That is the verb-split, not a partial revert.

| # | File | Handler | Nature |
|---|---|---|---|
| 13 | `app/api/admin/agent-generation-config/route.ts` | `GET` | internal tuning |
| 14 | `app/api/admin/ais-config/route.ts` | `GET` | internal tuning |
| 15 | `app/api/admin/backfill-embeddings/route.ts` | `GET` | job status |
| 16 | `app/api/admin/helpbot-config/route.ts` | `GET` | internal |
| 17 | `app/api/admin/memory-config/route.ts` | `GET` | internal |
| 18 | `app/api/admin/memory-consolidation/route.ts` | `GET` | internal |
| 19 | `app/api/admin/onboarding-config/route.ts` | `GET` | internal |
| 20 | `app/api/admin/orchestration-config/route.ts` | `GET` | internal |
| 21 | `app/api/admin/ui-config/route.ts` | `GET` | internal |

#### Guard + tests (2 files)

| # | File | Action | Change |
|---|---|---|---|
| 22 | `lib/admin/__tests__/admin-authz-surface.guard.test.ts` | modify | **Delete 21 allow-list entries.** The shrink is the review artefact. |
| 23 | `app/api/admin/__tests__/adminGate.reads.test.ts` | **create** | Table-driven behavioural test over all 21 handlers. |

**File count: 23.**

### Test plan

| What proves it works | What proves the failure path |
|---|---|
| Admin caller reaches each of the 21 handlers and gets its normal 2xx payload. | Per handler: `getUser`→`null` ⇒ **401**; non-admin ⇒ **403**; `isAdmin` throws ⇒ **403**; `getUser` throws ⇒ **401** — each asserting **no table was read** (this is stronger for reads than for writes: the whole point is that the query never runs). |
| **The slice-0 P-4 caller enumeration is reproduced in the PR body**, showing zero customer-facing callers for all 21 routes. AC requires it. | If enumeration found a customer-facing caller for any route here, that route is **removed from this slice** and handled in slice 3. Record any such move. |
| `user-emails` (`POST`-shaped read) is explicitly listed in the PR description as a read, so the reviewer does not skim past it. | — |
| Guard allow-list is 21 entries shorter; `npm run test:authz-guard` green. | Re-run deliberate-breakage check (a): the scratch ungated route still fails the guard. |
| Manual: every admin dashboard screen still loads its data when operated by an admin. | Manual: signed out, `curl /api/admin/dashboard` ⇒ 401; `curl /api/admin/token-usage/drill-down` ⇒ 401. |

### Deploy safety

**If this ships and slice 3 is delayed indefinitely:** the system is strictly safer and **no customer screen regresses** — the four ⚠️ catalogue GETs (`reward-config`, `boost-packs`, `execution-tiers`, `storage-tiers`) are untouched by design, and they are the only reads with a plausible customer caller. The share-reward indicator keeps working exactly as today.

**Expected fallout:** `scripts/test-phase5-full-integration.ts:174` and `scripts/test-phase6-final-verification.ts:287` (anonymous `GET /api/admin/ais-config`) now fail. Already recorded.

**Rollback:** per-file, three lines each.

### Task checklist

- ⬜ 2.1 Confirm slice 0 P-4 enumeration is complete and recorded in the requirement MD
- ⬜ 2.2 Confirm no route in this slice was reclassified as customer-facing by that enumeration; if any was, move it to slice 3 and note it here
- ⬜ 2.3 Gate D3 files 1–11
- ⬜ 2.4 Gate `settings/platform-users` GET
- ⬜ 2.5 Gate the 9 non-⚠️ D4 GETs
- ⬜ 2.6 Verify the four ⚠️ GETs are **untouched** in this diff (`git diff --stat` must not list them)
- ⬜ 2.7 Delete the 21 corresponding guard allow-list entries; confirm green
- ⬜ 2.8 Write `app/api/admin/__tests__/adminGate.reads.test.ts`
- ⬜ 2.9 Reproduce the caller enumeration in the PR body (AC requirement)
- ⬜ 2.10 Flag to the user: 6 further files carry 16 `console.*` calls; propose slice 2L

---

## Slice 2L — Logging conformance for slice-2 files

**Difficulty:** 🟢 · **Ships immediately after slice 2.** · **Status:** ⬜

### Goal

The read-only files slice 2 touched that were not already converted in 1L move to structured Pino.

### Files touched — 6 files, 16 `console.*` calls (measured)

| # | File | `console.*` count |
|---|---|---|
| 1 | `app/api/admin/users/route.ts` | 7 |
| 2 | `app/api/admin/messages/route.ts` | 2 |
| 3 | `app/api/admin/onboarding-users/route.ts` | 2 |
| 4 | `app/api/admin/token-usage/stats/route.ts` | 2 |
| 5 | `app/api/admin/user-emails/route.ts` | 2 |
| 6 | `app/api/admin/users/[id]/stats/route.ts` | 1 |

The 9 D4 files in slice 2 were already converted in 1L (same files, different verb). The remaining slice-2 files carry no `console.*`.

**File count: 6.**

### Test plan

| What proves it works | What proves the failure path |
|---|---|
| `grep -c "console\."` returns 0 for all 6 files. | Before-counts captured from `main`. |
| `adminGate.reads.test.ts` passes **unchanged** — logging-only change. | Any control-flow change breaks it. |
| ⚠️ `user-emails` and `users` handle email addresses — confirm no converted log line carries an email (FR-6, NFR-Security). | An explicit assertion in the test that no captured log argument contains `@`. |

### Deploy safety

Zero behavioural change. Independent of everything after it.

### Task checklist

- ⬜ 2L.1 Record before-counts
- ⬜ 2L.2 Convert files 1–6 to `createLogger` + structured Pino
- ⬜ 2L.3 Audit `user-emails` and `users` for email addresses in log context; remove, do not convert
- ⬜ 2L.4 Re-run `adminGate.reads.test.ts` unchanged
- ⬜ 2L.5 Confirm zero `console.*` remains across the 6 files

---

## Slice 3 — Resolve the customer-visible config reads

**Difficulty:** 🟡 · **The only slice that changes what a customer sees.** · **Status:** ⬜

### Goal

The share-reward indicator on both agent-detail pages behaves exactly as it does today for a normal customer, **and** the full reward ruleset — amounts, eligibility thresholds, minimum success rates, monthly and lifetime caps — stops being readable by a non-admin.

**BQ-1 is closed by SA as option A**, and there is no trade-off left: both callers read exactly one value (`is_active` on the reward whose `reward_key === 'agent_sharing'`). So: publish **one boolean** on a customer-readable path.

> **RC-11 — the replacement read path and the gate ship in ONE commit.** Ship the gate first and the indicator is dark for every customer until the follow-up lands. This is the one genuine "worse state if the next slice is delayed" in the whole programme, and it is designed out by refusing to split the commit.

### W-3 — the approved shape is a read-only PROJECTION, not a mirror

The first draft of this slice proposed mirroring `is_active` into a `system_settings_config` key. **SA rejected it**, for a reason stronger than the drift Dev flagged:

| | |
|---|---|
| **Why the mirror is wrong** | It creates a **second store for a fact that already has one** — the exact shape of F1 (`system_settings_config.admin_users` vs the `admin_users` table) that **slice 7 of this same programme deletes**. Shipping the anti-pattern in slice 3 and deleting it in slice 7 is incoherent, and slice 8 would carry a permanent drift caveat in the document whose job is to stop people believing false things about this system. |
| **And it is worse than Dev knew** | The duplication **already exists and already drifts**: `agent_sharing_reward_amount` lives in `system_settings_config` and is read at `app/v2/agents/[id]/page.tsx:359,393`, while the amount **also** lives on the `reward_config` row the admin screen edits, with **nothing syncing them**. A mirrored boolean extends a live bug rather than avoiding one. Tracked as **OI-14** — do **not** fold the amount in to "fix" it; that changes what a customer sees and is outside BQ-1. |
| **Approved shape** | One purpose-built **customer-readable read** returning only the customer-entitled reward facts for `agent_sharing` — at minimum `{ isActive }`. It reads `reward_config` server-side and **projects**. |
| **Source of truth** | `reward_config`, unchanged. **One store. No mirror, no drift, no write-side effect, no migration.** |
| **Repository** | The read goes through `lib/repositories/` (CLAUDE.md mandatory rule 1 + the standing "enforce repository pattern in review" preference). A minimal read method is acceptable — this is the **correct direction of travel for OI-5**, not an exception to it. |
| **Not `/api/system-config`** | Rejected for domain leakage, and now for a second reason: **N-4** — that route is unauthenticated, service-role-backed and takes arbitrary `keys`/`category`, so it bypasses RLS. The original `category: 'rewards'` design would have leaked **every future rewards key** to anonymous callers. |
| **"No new endpoint"** | SA amended its own BQ-1 wording. It was aimed at preventing a new customer-facing *reward feature*, not at forcing a second store. **A single-purpose read route is this repo's standard pattern, not a new one.** |
| **Scope discipline** | Project the **boolean only**. |

### Files touched

| # | File | Action | Change |
|---|---|---|---|
| 1 | `lib/repositories/RewardConfigRepository.ts` (or the existing reward repository if one exists — verify first) | create/modify | A minimal read method returning the `agent_sharing` reward's `is_active`. Nothing else. |
| 2 | `app/api/rewards/agent-sharing/route.ts` (exact path TBC at implementation; a single-purpose customer read) | **create** | `GET` returning `{ success: true, data: { isActive: boolean } }` and **nothing else** — no amounts, no thresholds, no caps. Zod-validated (no input to validate beyond method), Pino logging with `correlationId`. Fails closed to `isActive: false`. |
| 3 | `app/api/admin/reward-config/route.ts` | modify | **Gate the `GET` with `requireAdmin`. That is all.** No mirror write, no `POST` change (W-3). |
| 4 | `app/api/admin/boost-packs/route.ts` | modify | Gate the `GET` — **conditional on slice 0's P-4 enumeration finding no customer caller.** If one is found, resolve it with the same projection shape in this same slice. |
| 5 | `app/api/admin/execution-tiers/route.ts` | modify | Gate the `GET` — same condition. |
| 6 | `app/(protected)/agents/[id]/page.tsx` | modify | `fetchShareRewardStatus()` (line ~404) fetches the new projection route instead of `/api/admin/reward-config`. Same state variable, same UI, same `.catch` fallback to `false`. |
| 7 | `app/v2/agents/[id]/page.tsx` | modify | Replace the `fetch('/api/admin/reward-config')` entry in the `Promise.all` (line 360) with the projection route. Same request count. Leave the `systemConfigApi.getByKeys` call at line 358 **untouched** (OI-14 is not fixed here). |
| 8 | `app/api/admin/storage-tiers/route.ts` | modify | Gate the `GET` — same condition as rows 4–5. |
| — | `lib/admin/__tests__/admin-authz-surface.guard.test.ts` | modify | Delete 4 allow-list entries. |
| — | `app/api/admin/__tests__/adminGate.catalogReads.test.ts` | **create** | Behavioural test for the 4 newly gated GETs. |
| — | `app/api/rewards/agent-sharing/__tests__/route.test.ts` | **create** | Happy path + failure path for the projection route. |

**File count: 8 substantive + 3 test/guard files.** ~~`supabase/migrations/20260920b_…sql`~~ — **NOT APPROVED and no longer needed. No migration ships in this programme.**

### Test plan

| What proves it works | What proves the failure path |
|---|---|
| **The customer path, end to end:** as a normal signed-in non-admin, load both agent-detail pages with `agent_sharing`'s `is_active = true` ⇒ the share-reward indicator renders **exactly as it does on `main`**. Set it `false` ⇒ indicator hidden. This is the AC. | As a normal non-admin, `GET /api/admin/reward-config` ⇒ **403**; anonymous ⇒ **401**. |
| **The projection leaks nothing:** assert the projection route's response body contains **only** `isActive` — no `min_executions`, `min_success_rate`, `max_shares_per_month`, `max_total_shares`, or any amount. An explicit key-set assertion, not a spot-check. | A snapshot test that fails if any new field is added to the response, so a future "just add the amount too" is caught in review. |
| **No second store:** `git diff` contains no migration and no write to `system_settings_config`. | Mechanical check, like slice 2's task 2.6. |
| Both pages' error handling is preserved: a failed fetch leaves `shareRewardActive` `false` (today's `.catch(() => ({success:false}))` behaviour), never an unhandled rejection. | Test with the projection fetch rejecting, and with it returning a 500. |
| The projection route fails **closed**: a repository error yields `isActive: false`, not a 500 and not `true`. | Test with the repository mocked to throw. |
| The 4 gated GETs: 401 / 403 / 403-on-throw / 401-on-throw, with no table read. | Deliberate-breakage guard check re-run. |

### Deploy safety

**This slice's whole design is its deploy safety.** Because the gate and the replacement read path are one commit, there is no intermediate state where the indicator is dark.

**If this ships and slice 4 is delayed indefinitely:** fine. Slice 4 is pure de-duplication with no behaviour change.

**If this slice is itself delayed indefinitely:** also fine, and this is why the BA isolated it. Slices 1 and 2 are already merged, the four ⚠️ GETs remain anonymously readable — a known, documented, *read-only* exposure of the reward ruleset and plan catalogues. It is the least-bad thing left open and it blocks nothing.

**Rollback:** reverting this slice restores the admin fetch on both pages and removes the gate. **Nothing is left behind** — no migration, no orphaned config key (that was the mirror design; W-3 removed it).

### Task checklist

- ⬜ 3.1 Confirm slice 0 P-4 enumeration results for `boost-packs`, `execution-tiers`, `storage-tiers`; record the verdict per route
- ⬜ 3.2 Check whether a reward repository already exists under `lib/repositories/`; extend it rather than adding a second one
- ~~3.3~~ **Deleted per W-3** — no migration ships in this programme
- ~~3.4~~ **Deleted per W-3** — no mirror write; `reward-config`'s `POST` is unchanged in this slice
- ⬜ 3.5 Add the minimal repository read for `agent_sharing`'s `is_active`
- ⬜ 3.6 Create the single-purpose customer projection route returning `{ isActive }` **only**; fails closed to `false`
- ⬜ 3.7 Gate `reward-config` `GET` (and only the `GET`)
- ⬜ 3.8 Switch `app/(protected)/agents/[id]/page.tsx` to the projection route
- ⬜ 3.9 Switch `app/v2/agents/[id]/page.tsx`'s `Promise.all` entry to the projection route; leave `getByKeys` untouched (OI-14 not fixed here)
- ⬜ 3.10 Gate `boost-packs` / `execution-tiers` / `storage-tiers` GETs (or resolve a found customer caller with the same projection shape)
- ⬜ 3.11 Delete 4 guard allow-list entries
- ⬜ 3.12 Write `adminGate.catalogReads.test.ts` and the projection route's own test (happy + failure path)
- ⬜ 3.13 Assert the projection response key-set is **exactly** `{ isActive }` — snapshot so a future field addition is caught
- ⬜ 3.14 Manual customer-path verification on **both** pages, both states of the boolean
- ⬜ 3.15 Confirm `git diff` contains **no migration** and no write to `system_settings_config`
- ⬜ 3.16 Confirm **one commit** contains the gate and the replacement path (RC-11)

---

## Slice 4 — One gate, one implementation

**Difficulty:** 🟢 (very low risk — the 7 routes are already behaviourally correct) · **Status:** ⬜

### Goal

Zero hand-written admin checks remain in any route file. Seven places to get wrong become one. Pure de-duplication, **no behaviour change**.

### Files touched

#### The 7 category B inline copies (7 files)

Each replaces its hand-rolled `getUser()` + `AdminAccessService.getInstance().isAdmin(...)` + 401/403 block with `requireAdmin(requestLogger)`, and **drops the `AdminAccessService` import** (which is what flips guard rule R2 green for it).

| # | File | Handler |
|---|---|---|
| 1 | `app/api/admin/agents/route.ts` | `GET` |
| 2 | `app/api/admin/audit-trail/route.ts` | `GET` |
| 3 | `app/api/admin/business-os/llm-usage/route.ts` | `GET` — **this is the inline copy at lines 49-64 named in the requirement; it is deleted here** |
| 4 | `app/api/admin/business-os/llm-usage/businesses/route.ts` | `GET` |
| 5 | `app/api/admin/chat-usage/route.ts` | `GET` |
| 6 | `app/api/admin/users/[id]/audit-logs/route.ts` | `GET` |
| 7 | `app/api/admin/users/[id]/login-stats/route.ts` | `GET` |

#### The docstring that will otherwise start lying (RC-9)

| # | File | Action | Change |
|---|---|---|---|
| 8 | `lib/admin/requireAdminRoute.ts` | modify | **Docstring only.** Lines 4-7 cite `app/api/admin/business-os/llm-usage/route.ts:49-64` as "the inline precedent … The precedent routes are left unchanged" — the exact code this slice deletes. Rewrite to record that the precedent was absorbed, with the date and this slice as the reference. Otherwise the canonical gate starts lying about its own provenance. |

#### Guard (1 file)

| # | File | Action | Change |
|---|---|---|---|
| 9 | `lib/admin/__tests__/admin-authz-surface.guard.test.ts` | modify | R1: delete the 7 entries. R2: delete the 7 entries, leaving **one** — `app/api/v2/calibrate/batch/route.ts`, with a written reason (it uses `isAdmin` as a *capability flag* to choose a Supabase client, not as a route gate; see OI-3). |

#### Verified, expected to need no edit (5 files)

These already mock `@/lib/auth`'s `getUser` and `@/lib/services/AdminAccessService` — which is exactly what `requireAdmin` calls — so they should pass **unchanged**. That is the regression oracle for this slice, not a chore.

| File |
|---|
| `app/api/admin/__tests__/auditAdminGate.test.ts` |
| `app/api/admin/agents/__tests__/route.test.ts` |
| `app/api/admin/business-os/llm-usage/__tests__/route.test.ts` |
| `app/api/admin/business-os/llm-usage/businesses/__tests__/route.test.ts` |
| `app/api/admin/chat-usage/__tests__/route.test.ts` |

**File count: 9 edited + 5 verified-unchanged.**

### Test plan

| What proves it works | What proves the failure path |
|---|---|
| **All 5 existing test files pass with no edit.** If they need edits, the refactor changed behaviour and that must be explained, not patched. | Those same files already assert the 401/403 split and the "no table read on denial" property — they *are* the failure-path tests, inherited. |
| **F3 regression check (explicit AC):** `components/admin/AdminCalibrationTrigger.tsx` probes `GET /api/admin/agents` and hides itself on 401/403. Verify manually: as a non-admin the component is hidden; as an admin it appears. The gate must continue to answer 401/403 and **never 500**. | Force `isAdmin` to throw and confirm `/api/admin/agents` returns **403**, so the component hides rather than erroring. |
| `git grep -n "AdminAccessService" app/api/admin` returns **only test files** afterwards. | Guard rule R2 with a 1-entry allow-list is the permanent version of that grep. |
| `npm run test:authz-guard` green with R1's allow-list now empty for `app/api/admin/**`. | — |
| `lib/admin/__tests__/requireAdminRoute.test.ts` unchanged and green. | — |

### Deploy safety

**If this ships and slice 5 is delayed indefinitely:** no risk at all. These 7 routes were already behaviourally correct; this is hygiene. It deliberately sits after the P0 slices because it buys no risk reduction.

**One coupling to respect:** slice 4 must not merge before slice 1, because R2's allow-list is created in slice 1. Merging out of order just means the guard file conflicts.

**Rollback:** trivial; the deleted inline blocks are recoverable from history and the tests prove equivalence either way.

### Task checklist

- ⬜ 4.1 Replace the inline check in files 1–7 with `requireAdmin(requestLogger)`; remove the now-unused `AdminAccessService` (and possibly `getUser`) imports
- ⬜ 4.2 Confirm each file's logger is a `correlationId` child logger, as `requireAdmin` expects an object with `warn`/`error`
- ⬜ 4.3 Rewrite `lib/admin/requireAdminRoute.ts`'s provenance docstring (RC-9)
- ⬜ 4.4 Run the 5 existing test files **unchanged**; if any fails, stop and explain rather than editing the test
- ⬜ 4.5 Shrink guard R1 and R2 allow-lists; leave the single documented `calibrate/batch` R2 entry
- ⬜ 4.6 Manual F3 check on `AdminCalibrationTrigger` as admin and as non-admin
- ⬜ 4.7 `git grep AdminAccessService app/api/admin` — confirm test files only

---

## Slice 5 — Server-side guard for `/admin` pages

**Difficulty:** 🔴 (UX risk, not security risk) · **Blocked by slice 0 (lockout risk).** · **Status:** ⬜

### Goal

Protection becomes a **property of the route tree**: every page under `/admin` is guarded on the server before any admin content is produced, and page 22 is protected before its author writes a line of it (FR-9). A non-admin — anonymous or signed-in — is **silently redirected to `/business-os`**, with an **identical** response either way (BQ-3 option A + SA constraint (i)).

### Files touched

| # | File | Action | Change |
|---|---|---|---|
| 1 | `app/admin/components/AdminChrome.tsx` | **create** | The **verbatim** current contents of `app/admin/layout.tsx` — `'use client'`, `useState(sidebarOpen)`, the gradient wrapper, `AdminSidebar`, `AdminHeader`, `<main>{children}</main>` — renamed to `AdminChrome`, taking `{ children }`. **No markup or behaviour change whatsoever**; a reviewer must be able to diff it against the old layout and see only the name. |
| 2 | `app/admin/layout.tsx` | **rewrite** | An `async` **Server Component**: `await requireAdminPage()` then `return <AdminChrome>{children}</AdminChrome>`. No `'use client'`. No `try/catch` wrapping the `redirect()`. |
| 3 | `lib/admin/requireAdminPage.ts` | **create** | Page-surface sibling of `requireAdminRoute.ts`, same rules: `getUser()` in `try/catch` (a throw ⇒ treat as signed out); `AdminAccessService.getInstance().isAdmin()` in `try/catch` (a throw ⇒ deny, fail closed); on any "no", `redirect('/business-os')`. Logs `{ userId }` only for a signed-in denial, nothing identifying for an anonymous one. Docstring names the **three escapes E1/E2/E3** and states that **the API gate is the security boundary and this is defence-in-depth** (RC-10). |
| 4 | `lib/admin/__tests__/requireAdminPage.test.ts` | **create** | Unit tests for the helper. |
| 5 | `app/admin/__tests__/layout.guard.test.tsx` | **create** | Asserts the layout calls the guard before rendering `AdminChrome`, and that `AdminChrome` is never rendered on a denial. |
| 6 | `lib/admin/__tests__/admin-authz-surface.guard.test.ts` | modify | Remove R6's allow-list entry (the layout is now compliant); confirm R3 (no `route.ts` under `app/admin/**`) is still empty and now load-bearing. |

**File count: 6.** The **21 `page.tsx` files are NOT touched** — that is the entire point of inheritance, and a diff that touched them would be the wrong shape.

### Test plan

| What proves it works | What proves the failure path |
|---|---|
| An **admin** loads every one of the 21 pages and sees exactly what they see on `main` (chrome, sidebar, header, page content). | **The identical-response test (BQ-3 SA constraint i):** an **anonymous** request to `/admin/users` and a **signed-in non-admin** request to `/admin/users` produce the **same status, the same `Location` header, and the same body**. Asserted programmatically, not eyeballed — this is the constraint that makes option A actually non-disclosing. |
| **FR-7 / FR-9 proof:** create a throwaway `app/admin/__scratch__/page.tsx` containing the literal string `ADMIN-CANARY`, do a **full page load** as a non-admin, and assert the canary string is **absent from the server response body**. Then delete it. This proves inheritance protects a page nobody guarded. | The same canary present for an admin — proving the test can fail. |
| `isAdmin` **throws** ⇒ redirect (fail closed), not a 500 and not a rendered admin page. `getUser` throws ⇒ same. | A stale-cache degradation check: `AdminAccessService` prefers a slightly stale admin set over failing, so a transient DB blip must **not** lock the operator out (NFR-Availability). Assert the admin still gets in when `listActive` errors but a cache exists. |
| **Accessibility (NFR):** the destination is a normal, navigable page — not a blank screen, not a never-resolving spinner, not a raw error. Manually confirm `/business-os` renders for a signed-in non-admin. | Confirm an anonymous visitor lands somewhere navigable rather than in a redirect loop: `/admin` → `/business-os` → (that page's own auth). **Explicitly test for a redirect loop.** |
| Guard rule R3 fails if a `route.ts` is placed under `app/admin/` (escape E1). | Deliberate breakage: add `app/admin/__scratch__/route.ts`, confirm the guard fails naming R3, revert. |
| `AdminChrome.tsx` diffs against the old `layout.tsx` with only the component name changed. | — |

### Deploy safety

**If this ships and slice 6 is delayed indefinitely:** the page surface is protected by construction. No loss.

**The real deploy risk is the operator, not the customer.** If this reaches an environment where the operator's admin identity does not resolve, **the operator is silently redirected away from `/admin` with no on-screen explanation** (BQ-3 option A's stated failure mode) and — after slice 7 — no in-product recovery. This is precisely why slice 5 is blocked on slice 0 and why slice 0's P-1 result must be re-confirmed for the target environment **immediately before this deploys**, not just when slice 0 merged.

**If this slice ships before slices 1–2 (it must not, but it is independently correct):** it would be defence-in-depth over an open API surface — better than nothing, but E2 (soft navigation) and the API gate's absence would make it a false comfort. Ship in order.

**Rollback:** restore the old `layout.tsx` from `AdminChrome.tsx` — a one-file revert that is safe because the chrome move was verbatim.

### Task checklist

- ⬜ 5.1 Re-confirm slice 0's P-1 result for the environment this will deploy to
- ⬜ 5.2 Move `app/admin/layout.tsx` verbatim to `app/admin/components/AdminChrome.tsx`; rename the component only
- ⬜ 5.3 Write `lib/admin/requireAdminPage.ts` — fail-closed, `redirect('/business-os')`, logs `{ userId }` only, docstring naming E1/E2/E3 and the defence-in-depth framing
- ⬜ 5.4 Rewrite `app/admin/layout.tsx` as an `async` Server Component; **verify `redirect()` is not inside a `try/catch`**
- ⬜ 5.5 Confirm the `/admin` segment going dynamic causes no build warning that matters (all 21 pages already fetch at runtime)
- ⬜ 5.6 Write `lib/admin/__tests__/requireAdminPage.test.ts` and `app/admin/__tests__/layout.guard.test.tsx`
- ⬜ 5.7 Run the **identical-response** test for anonymous vs **onboarded** signed-in-non-admin (W-5). Separately assert the **un-onboarded** non-admin lands on `/onboarding-chat` via middleware and never reaches admin content. **Fix the fixture; do not weaken the assertion.**
- ⬜ 5.8 Run the **ADMIN-CANARY** inheritance test; delete the scratch page
- ⬜ 5.9 Run the **redirect-loop** check for an anonymous visitor. **W-5: record the observed behaviour** — `app/business-os/layout.tsx` does no server-side auth (client `UserProvider`), so an anonymous visitor briefly renders the Business OS shell before client auth moves them on. No loop, no admin content, no disclosure. Do **not** assert a server-side redirect that does not exist.
- ⬜ 5.10 Manually load all 21 pages as an admin; confirm no visual change
- ⬜ 5.11 Remove R6's guard allow-list entry; run the R3 deliberate-breakage check
- ⬜ 5.12 Record E1/E2/E3 in the PR body so the escapes are visible in review, not just in a docstring

---

## Slice 6 — Close the CI gate

**Difficulty:** 🟢 · **After slices 1–5.** · **Status:** ⬜

### Goal

The allow-list is empty (bar one permanent, justified entry) and — the part that actually delivers **G3** — **the workflow becomes a required status check on `main`.** Until that repository setting is on, "adding an unguarded admin route fails the build" is aspirational.

Because of RC-2, this slice is no longer "build the mechanism". The mechanism shipped in slice 1 and has been protecting the work in progress ever since. This slice is "delete the last few lines and turn the gate on".

### Files touched

| # | File | Action | Change |
|---|---|---|---|
| 1 | `lib/admin/__tests__/admin-authz-surface.guard.test.ts` | modify | Allow-lists for R1, R3, R4, R5, R6 are **empty**. R2 retains exactly **one** entry — `app/api/v2/calibrate/batch/route.ts` — with a dated, written justification (a capability flag choosing a Supabase client, not a route gate). Update the file's docstring to the final state. **Plus D-4 and D-5 below.** |

### R7 — the inverted rule: catch admin capability wherever it lives

> **Added 2026-09-20, from the user's question: *"how do we ensure that every next page or every next capability or function knows how to incorporate the same `requireAdmin` method?"*** Four mechanisms were audited. Pages are **structural** (slice 5 — a page cannot opt out of its parent layout). Routes under the admin path are **mechanical** (R1, once slice 6 makes the workflow a required status check). The two gaps are this rule and slice 8's authoring-time guidance.

**The hole.** R1 keys off the **path** `app/api/admin/**`. A new admin capability placed anywhere else is invisible to it. This is the **FR-10 scope gap SA flagged in the requirement review, which was never given an owner** — and gating the 44 files does not make "admin" a closed concept.

> ⚠️ **Naming.** The brief called this "R5". **R5 and R6 are already taken** in the shipped guard (R5 = RLS policies keyed on `profiles.role`; R6 = the `/admin` layout guard). This rule is therefore **R7**. Renumbering the existing rules would invalidate every allow-list reason and every failure message already in review.

#### Specification — to the same standard as R1–R4

| Aspect | Decision |
|---|---|
| **Scans** | Every `route.ts` under `app/api/` — **excluding** `app/api/admin/**`, which R1 already owns by path. R7 is the complement, not a duplicate. |
| **Matches** | A route file that makes an **admin access decision** without `requireAdmin`: it imports `AdminAccessService` **and** calls `.isAdmin(` / `.isAdminById(`, or it compares a role value to an admin-ish literal (R4's `ROLE_COMPARISON`), or it reads `admin_users` directly. |
| **Does NOT match** | `AdminAccessService.listAdminEmails()` / `listAdmins()`. These are **admin-set queries, not access decisions** — a notification recipient list is not authorization. A naive "imports `AdminAccessService` ⇒ must use `requireAdmin`" rule would flag them and be argued down as noise within a week. **This distinction is the whole reason R7 needs specifying rather than assuming.** |
| **On something it cannot parse** | **Fail closed — flag it** (the D-1 lesson). If the file imports `AdminAccessService` but R7 cannot attribute the call to either category, it is reported as unparseable with the file named. A rule that silently skips what it cannot understand is the failure mode that matters. |
| **Allow-list** | Same mechanic as R1–R6: dated entry, written reason, **plus a named owner** for any entry that is a deferral rather than a permanent exception. |
| **Failure message** | Must name the file, say which category it matched, and state the remedy — `requireAdmin` for a gate, or an allow-list entry with a reason for a capability flag. |

#### The design tension — state it to SA, do not resolve it by overclaiming

> **R1 asks: "is everything in this path gated?" R7 asks: "is everything that behaves like an admin route gated, wherever it lives?"**
>
> **R7 cannot be complete, and the write-up must say so plainly.** It recognises admin-ness by *the signals it knows about* — `AdminAccessService`, a role comparison, `admin_users`. **A brand-new admin capability that reads an admin-only table without touching any of those is still invisible to it.** That is not a defect to be patched; it is the boundary of what static shape-matching can do.
>
> The honest framing: **R7 narrows the blind spot; it does not close it.** What covers the remainder is **mechanism 4 — authoring-time guidance (slice 8)**, because the decision is made when the file is written, not when CI runs. A guard tells you after you got it wrong; the skill stops you writing it wrong. Neither alone is sufficient, and claiming otherwise is how the gap reopens.

#### The two out-of-path files — verified, and one of them is not what was reported

| File | Finding | Disposition |
|---|---|---|
| `app/api/v2/calibrate/batch/route.ts` | ✅ **Genuine admin usage, and it is TWO distinct things.** `:117` `isAdmin({id, email})` — a **capability flag** choosing the service-role client over the RLS client, because admins may calibrate agents they do not own. There is no 401/403 to return, so `requireAdmin` is the wrong tool. Separately `:5180` `listAdminEmails()` — a **notification recipient list**, not authorization at all. | **Allow-list, do not gate.** It already holds the model R2 entry explaining why `requireAdmin` does not fit. Add a **named owner** and carry the same reason into R7. Gating it would change behaviour (non-admins would lose their own calibration), which a security sweep must not do silently. |
| `app/api/plugins/action-schema/route.ts` | ❌ **Does NOT reference admin access.** Its only mention is a **comment** at `:21` recording an SA decision (Q1 / CR3) that the endpoint is *intentionally unauthenticated* and metadata-only, and that auth "MUST be revisited" **if** it is ever extended to return user-scoped data. There is no `isAdmin` call, no role check, no `admin_users` read. Comments are stripped before scanning, so R7 correctly ignores it. | **Nothing to do.** It needs **no allow-list entry** — adding one would be a false exemption implying an admin decision exists where none does, and stale exemptions are the thing the existence assertion exists to prevent. |

> **Correction to the brief:** it stated *"Both reference admin access directly."* Only one does. **R7's allow-list therefore starts with exactly ONE entry, not two.**

---

### D-4 and D-5 — parser hardening deferred here by SA (code review, 2026-09-20)

Both are **LOW** and latent (nothing in the repo triggers either today). SA ruled they fold into slice 6 rather than slice 1, so they are recorded here to stop them being lost. D-1, D-2 and D-3 from the same review were **fixed in slice 1**.

| # | Defect | Fix |
|---|---|---|
| **D-4** | **Route files the scan never opens.** `walk(..., /\.(ts\|tsx)$/)` and `ROUTE_FILES = …endsWith('/route.ts')`. Next.js accepts `route.js\|jsx\|ts\|tsx`, so a handler in `route.tsx` escapes **R1, R2 and R3 entirely**, and a `route.js` is never read at all. None exists today (verified) — but *"we only scan the extension people currently use"* is the same shape as *"we only scan the paths we already know about"*, which this guard's own header rejects. | Match `/route\.(ts\|tsx\|js\|jsx\|mts\|cts)$/` and add those extensions to `walk`. |
| **D-Q2** | **[QA] R1 accepts a `requireAdmin(` that is mentioned but never executed.** A handler that defines a closure containing the gate and never calls it passes. <br><br>⚠️ **D-5's recorded fix does NOT close this, and slice 6 must scope it separately.** D-5 proposes requiring `indexOf('requireAdmin(')` to precede the first `.json()`/`.from(`/`.rpc(`/`searchParams`/`new URL(`. In QA's fixture the gate's index is *already* first, so an ordering check passes it. | The minimum honest shape is **"the handler's body opens with the canonical three-line gate"** — match the **first statement**, not any occurrence. Implement alongside D-5, not as part of it. |
| **D-Q3** | **[QA] An unrecognised handler shape is silently skipped whenever the file also contains one parseable handler.** W-7's fourth promise — *"a `route.ts` from which the scanner extracts no handler at all is flagged"* — only fires when the file yields **nothing**. A file with one parseable handler and one unrecognised one has `handlers.length > 0`, so the zero-handler net never fires and the unrecognised handler is invisible to R1. Nothing flags *"I saw the token `GET` exported in a shape none of my forms matched"*. QA's examples: `export async function GET<T>(…)` (generic) and `export let GET;` + `GET = async () => {…}`. Generics on a handler are contrived; **the class is not** — it is "we only recognise the shapes people currently write", which the guard's header rejects. | After the three forms run, re-scan for `export` … `\b(GET\|POST\|…)\b` occurrences **not attributed** to a handler or to an `unparseable` entry, and flag the remainder. |
| **D-5** | **R1 proves gate *presence*, not *precedence*.** `if (!h.body.includes('requireAdmin('))` passes any handler that mentions the gate **anywhere** in its body — including one that parses the body, runs its query, and *then* gates. All 30 slice-1 handlers are correctly first (SA verified independently, and the oracle asserts it), but the oracle only covers the 22 files it enumerates. **Route #45 gets R1 and no oracle**, so precedence would be unproven exactly where the guard is the only check. | In R1, additionally require the index of `requireAdmin(` to precede the first index of `.json()`, `.from(`, `.rpc(`, `searchParams` and `new URL(` within the body. This makes **FR-5 machine-enforced for every future route** rather than hand-checked once. |
| 2 | `.github/workflows/admin-authz-guard.yml` | modify | Final pass: confirm no `paths:` filter, confirm `pull_request: branches: [main]`, confirm the job name is stable (a required status check is matched **by job name** — renaming it later silently un-gates the repo; say so in the header comment). |

**File count: 2 + one manual repository setting.**

### ⚠️ The manual step — for the repo owner, not for Dev

> **A workflow is not a build gate until it is a required status check on `main`.** This is a **GitHub repository setting** (Settings → Branches → branch protection rule for `main` → *Require status checks to pass before merging*) and it is **not a file in any diff — Dev cannot do it.**
>
> ### The exact name to select: **`Admin authz surface guard`**
>
> **Not** `Admin Authz Guard` — that is the **workflow** name (`.github/workflows/admin-authz-guard.yml:43`). A required status check matches the **job** name, which is `Admin authz surface guard` (`:67`), exactly as the workflow's own header warns. **D-Q4/D-Q5 (QA, 2026-09-20): this instruction previously named the workflow, so a repo owner following it would have searched for a check that does not appear in the list.**
>
> The workflow must have run at least once on a PR before the name is offered in that picker.
>
> **Slice 6 is not Done until the repo owner has enabled it and confirmed.** If it is skipped, every other slice still holds, but G3 ("cannot recur") reverts to convention and the DoD sentence "fails the build" is false.

### Test plan

| What proves it works | What proves the failure path |
|---|---|
| `npm run test:authz-guard` green on a clean repo with the allow-lists empty. | **The three deliberate-breakage checks, re-run and recorded:** (a) an ungated `route.ts` under `app/api/admin/**` ⇒ **fail on R1**, output names the file and what to do; (b) a `route.ts` importing `AdminAccessService` ⇒ **fail on R2**; (c) a `route.ts` under `app/admin/**` ⇒ **fail on R3**. |
| Two more: (d) an access decision reading `profiles.role` in a new file ⇒ **fail on R4**; (e) a new migration with an uncommented `CREATE POLICY … profiles … role` ⇒ **fail on R5**. | Each revert restores green — proving the guard is not permanently red for an unrelated reason. |
| **The end-to-end proof:** open a throwaway PR adding an unguarded admin route and observe the **PR blocked from merging** (not merely a red tick). This is the only test that proves the required-status-check step actually happened. | Without the repo setting, the same PR shows red **and is still mergeable** — capture that distinction. |
| The failure output names the offending file and states the remedy. | Assert on the thrown message text. |
| The single R2 entry has a written, dated justification. | Guard asserts every allow-list entry's file exists (a stale exemption would silently cover a future file at the same path). |

### Deploy safety

**If this ships and slice 7 is delayed:** nothing changes at runtime — the guard is test-time only, it ships no application code. The R4 allow-list, however, cannot be emptied until slice 7 deletes those two files, so **slice 6 must merge after slice 7** or keep the 2 R4 entries. **Recommended merge order: 7 before 6.** (This is a deviation from the SA's numbering and is flagged for SA below.)

**If slice 6 never ships:** slices 1–5 and 7–8 still hold, but recurrence prevention drops back to the slice-1 allow-list — which is already most of the value, since the guard exists and runs. The irreplaceable part is the **required status check**.

### Task checklist

- ⬜ 6.1 Confirm slices 1–5 and 7 are merged (see the ordering note above)
- ⬜ 6.2 Empty the R1/R3/R4/R5/R6 allow-lists; leave the single documented R2 entry
- ⬜ 6.2a **D-4** Widen the scan to `route.(ts|tsx|js|jsx|mts|cts)` in both `walk` and `ROUTE_FILES`; add a fixture proving a `route.tsx` is now covered by R1/R2/R3
- ⬜ 6.2b0 **D-Q2** Require the handler body to **open with** the canonical gate (first statement), not merely to contain it. **Scope this separately from D-5** — in QA's fixture the gate's index is already first, so D-5's ordering check passes it
- ⬜ 6.2b1 **D-Q3** After the three export forms run, re-scan for exported handler names **not attributed** to a handler or an `unparseable` entry, and flag the remainder. Fixture: a file with one parseable gated handler plus `export async function GET<T>(…)` ungated
- ⬜ 6.2b **D-5** Make R1 prove gate **precedence**, not just presence: `requireAdmin(` must precede the first `.json()`, `.from(`, `.rpc(`, `searchParams` and `new URL(` in the body. This is the check SA ran by hand for slice 1 — making it the guard's makes FR-5 machine-enforced for route #45, which gets R1 and no oracle
- ⬜ 6.2c **R7 — the inverted rule** (see the spec above). Implement it as **R7**, not "R5" — R5/R6 are taken. Scans every `route.ts` under `app/api/` **except** `app/api/admin/**`
- ⬜ 6.2d **R7** must distinguish an **access decision** (`isAdmin` / role comparison / `admin_users` read ⇒ must use `requireAdmin`) from an **admin-set query** (`listAdminEmails` / `listAdmins` ⇒ allowed, it is a recipient list). Unit-test **both** directions against `calibrate/batch:117` and `:5180`
- ⬜ 6.2e **R7** fails closed on an `AdminAccessService` import it cannot categorise — flag with the file named (the D-1 lesson)
- ⬜ 6.2f **R7** allow-list starts with **one** entry: `app/api/v2/calibrate/batch/route.ts`, with the existing capability-flag reason **plus a named owner**. `app/api/plugins/action-schema/route.ts` gets **no entry** — it makes no admin decision, and a false exemption is worse than none
- ⬜ 6.2g Run a deliberate-breakage check for R7: add a scratch `app/api/scratch/route.ts` calling `AdminAccessService…isAdmin(...)` without `requireAdmin`; confirm it is flagged and names the remedy; revert
- ⬜ 6.2h Record in the PR body that **R7 narrows the blind spot but does not close it** — a new admin capability that touches an admin-only table without any known signal is still invisible, and slice 8's authoring-time guidance is what covers the remainder
- ⬜ 6.3 Update the guard file's docstring to the final state, in the voice of `no-deletion-paths.guard.test.ts`
- ⬜ 6.4 Run all five deliberate-breakage checks (a)–(e); record each failure message verbatim in the PR body
- ⬜ 6.5 Confirm the workflow has no `paths:` filter and a stable job name; document that renaming the job un-gates the repo
- ⬜ 6.6 **Hand the required-status-check step to the repo owner** with exact click-path instructions, naming the check **`Admin authz surface guard`** (the **job** name — not the workflow name `Admin Authz Guard`; D-Q5)
- ⬜ 6.7 Verify with a throwaway PR that merging is actually **blocked**, not merely red
- ⬜ 6.8 Record the enablement (date, who) in this workplan's Change History and in the DoD

---

## Slice 7 — Retire the admin management surface

**Difficulty:** 🟡 · **BQ-2 = option B (user, 2026-09-20).** · **Status:** ⬜

### Goal

Delete the screen and the two routes that manage admins through `system_settings_config.admin_users` — a store that **does not grant admin access**. Today an operator who "adds an admin" gets silence, while any signed-in customer can write to it. Under option B, admins are managed through the existing bootstrap path until the platform needs self-service.

> **This is a deletion, not a rebuild. Do NOT build grant/revoke in this programme** (BQ-2 option A is deferred — see OI-4).
>
> **The true cost of B, stated so nobody is surprised:** there are exactly two seeded admins (the owner and the deployment-access holder). Adding a third means editing and re-running `supabase/migrations/20260701_seed_admin_users.sql` (or `scripts/seed-admin-users.ts`) — **it requires Supabase access.**

### Files touched

| # | File | Action | Change |
|---|---|---|---|
| 1 | `app/api/admin/settings/admin-users/route.ts` | **delete** | Both handlers. Its `GET` bootstrap-upsert (N-1) and its `POST` both write to a store that grants nothing. |
| 2 | `app/api/admin/settings/platform-users/route.ts` | **delete** | Its only caller is the screen being deleted (`app/admin/settings/page.tsx:82`). It also reads the dead `system_settings_config.admin_users` key at line 47 to mark admins — that marking is meaningless once the key is abandoned. |
| 3 | `app/admin/settings/page.tsx` | **delete** | 502 lines, entirely the admin-management screen (add-admin form, user browser, admin list, remove buttons). It has no other sections, so nothing is orphaned by deleting the whole page. |
| 4 | `app/admin/components/AdminSidebar.tsx` | modify | Remove the `/admin/settings` nav entry (line 187). |
| 5 | `app/admin/components/AdminHeader.tsx` | modify | Remove the `/admin/settings` link (line 90). |
| 6 | `lib/admin/__tests__/admin-authz-surface.guard.test.ts` | modify | Delete the **2 R4 entries** (`app/admin/settings/page.tsx`, `app/api/admin/settings/admin-users/route.ts` — N-2) and the 2 corresponding R1 entries. **R4's allow-list becomes empty**, which is the state FR-2 wants. |

Referenced, **not changed**: `supabase/migrations/20260701_seed_admin_users.sql` and `scripts/seed-admin-users.ts` — these become the documented management path (slice 8 writes them up).

**File count: 6.**

### Test plan

| What proves it works | What proves the failure path |
|---|---|
| `git grep -rn "/admin/settings"` returns **nothing** in `app/`, `components/`, `lib/` afterwards — no dangling link. | Navigating to `/admin/settings` as an **admin** returns the app's standard not-found (`app/not-found.tsx`), not a crash and not a blank chrome. |
| `git grep -rn "settings/admin-users\|settings/platform-users"` returns nothing. | As a non-admin, `/admin/settings` is redirected by slice 5's layout guard before not-found is reached — confirm no admin chrome is in the response. |
| **Granting still works through the supported path:** add a third email to the seed, run it, and confirm the new admin passes an admin request. | **Revocation semantics (RC-8, corrected AC):** set `is_active = false` for an admin and confirm their admin requests start failing **within the 60 s `AdminAccessService` cache TTL** — *not* "on the next request". In RLS it is **immediate** (`is_platform_admin()` is `STABLE`, uncached). Both halves asserted; the asymmetry recorded. |
| The action is attributable: `admin_users` carries `notes` and `updated_at`; the seed records its provenance. | — |
| Guard R4's allow-list is now **empty** and the guard is green. | Deliberate breakage: reintroduce a `role === 'admin'` access decision anywhere ⇒ R4 fails with an empty allow-list. This is the highest-value item in the whole F5 discussion and it is now free to enforce. |
| The admin UI otherwise unaffected: all 20 remaining pages load. | — |

### Deploy safety

**If this ships and slice 8 is delayed:** the platform is safer (one unguarded write path deleted) and one misleading dead feature is gone. The only cost is that the management path is now documented nowhere until slice 8 — **so slice 7's PR body must carry the "how to add an admin" instructions verbatim**, and slice 8 moves them into the doc.

**⚠️ The interaction with slice 5 and slice 0 is the risk to watch.** After slice 7 there is **no in-product way to grant admin**. Combined with slice 5's silent redirect (BQ-3 option A), an operator whose `admin_users` row is missing has no on-screen explanation and no in-product recovery — only direct Supabase access. **Slice 0's P-1 verification is what makes this acceptable; re-confirm it immediately before this deploys.**

**Orphaned data:** `system_settings_config.admin_users` is left in the database with no reader and no writer. It is harmless (it grants nothing) but it is a trap for a future reader who assumes it means something. Not deleted here — see OI-7.

**Rollback:** `git revert` restores the screen and both routes, which by then are gated (slice 1), so a revert does not reopen the anonymous write.

### Task checklist

- ⬜ 7.1 Confirm with the user that BQ-2 option B is still the decision before deleting a screen
- ⬜ 7.2 Delete `app/api/admin/settings/admin-users/route.ts` and `app/api/admin/settings/platform-users/route.ts`
- ⬜ 7.3 Delete `app/admin/settings/page.tsx`
- ⬜ 7.4 Remove the nav entry and the header link
- ⬜ 7.5 `git grep` for `/admin/settings`, `settings/admin-users`, `settings/platform-users` — confirm zero hits
- ⬜ 7.6 Empty guard R4's allow-list (N-2) and delete the 2 R1 entries; run the R4 deliberate-breakage check
- ⬜ 7.7 Verify granting works via the seed path end to end
- ⬜ 7.8 Verify revocation takes effect **within 60 s** in app code and **immediately** in RLS; record both
- ⬜ 7.9 Put the "how to add/remove an admin" instructions in the PR body (slice 8 moves them to the doc)
- ⬜ 7.10 Raise OI-7 (orphaned `system_settings_config.admin_users` key) as a tracked item

---

## Slice 8 — Correct the documentation

**Difficulty:** 🟢 · **Doc-only, last** (it describes the finished state; interim edits would be rewritten twice). · **Status:** ⬜

### Goal

`docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` describes what the code actually does — including the things that are uncomfortable to write down.

### Files touched

| # | File | Action | Change |
|---|---|---|---|
| 1 | `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` | modify | Full rewrite to the as-built state. Contents below. |
| 2 | `docs/requirements/ADMIN_AUTHZ_UNIFICATION_REQUIREMENT.md` | modify | Mark the programme complete; close the ACs; record the required-status-check enablement. |
| 3 | `scripts/test-phase3-full-integration.ts` | modify or **delete** | Housekeeping: line 170 references `/api/admin/model-routing`, **a route that no longer exists** — the script is already stale. Mark or delete. |
| 4 | **`.claude/skills/new-api-route/SKILL.md`** | modify | **Authoring-time mechanism — see below. This one is a correction, not an addition.** |
| 5 | **`CLAUDE.md`** | modify | Add an admin-authz row to the Key Documentation table, in the established voice. |
| 6 | `docs/workplans/admin-authz-unification.md` | modify | Final Change History entry. |

**File count: 6.** (Slices 1L/2L already handled the `console.*` debt; slice 8 does not reopen it.)

### Mechanism 4 — authoring time, which is where it actually gets decided

> **From the user, 2026-09-20: *"how do we ensure that every next page or every next capability or function knows how to incorporate the same `requireAdmin` method?"***
>
> **A guard tells you after you got it wrong. The skill stops you writing it wrong.** R1/R7 and the page-tree structure are necessary but they are all *after the fact*; the decision is made when someone scaffolds the file.

#### 🔴 Finding — the scaffolding skill currently teaches a WRONG mechanism

This is **worse than the silence the brief anticipated.** `.claude/skills/new-api-route/SKILL.md` does not merely omit `requireAdmin` — it **actively prescribes a different admin check**, in two places:

| Location | Current text | Problem |
|---|---|---|
| `:118` (Variations) | *"**Admin-only:** after `getUser()`, also check `user.app_metadata?.role === 'admin'` and return 403 otherwise."* | A **JWT-claim check**. Not `admin_users`, and therefore a **third parallel admin signal** alongside `admin_users` and `profiles.role`. It directly violates **FR-1** ("exactly one named behaviour") and **FR-2** ("derives admin identity only from `admin_users`"). An admin present in `admin_users` without that claim is denied; a stale claim grants. |
| `:25` (Inputs table) | *"Admin-only routes also need a role check"* | Frames admin authz as "a role check", which is the mental model this entire programme exists to replace. |

> To be precise about severity: `app_metadata` is **not** user-writable (service-role only), so unlike `profiles.role` this is **not a privilege-escalation hole**. It is a **second source of truth** — exactly what goal **G1** forbids. The practical consequence is worse than it sounds: **the answer to "how does the next one know?" is currently "it is told to do the wrong thing."**
>
> Note the interplay with the guard: R4's `ROLE_COMPARISON` **would** flag `role === 'admin'` in the generated code — but only *after* it is written, and only if it lands under a scanned root. The skill is the earlier and cheaper intervention.

#### Edit 1 — `.claude/skills/new-api-route/SKILL.md`

| # | Change |
|---|---|
| 8a | **Replace** the `:118` Variations bullet. New text: an admin route's gate is **`requireAdmin(requestLogger)` from `@/lib/admin/requireAdminRoute`** — never `app_metadata.role`, never `profiles.role`, never a hand-rolled `AdminAccessService` call. |
| 8b | State that the gate is the **FIRST** thing in the handler: nothing above it may touch a request body, the database, a queue, or an outbound message (**FR-5**). |
| 8c | State that **`AdminAccessService` / the `admin_users` table is the only trusted admin signal** (`docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md`), and that `requireAdmin` owns the 401-vs-403 contract and the fail-closed behaviour — so a route must not re-implement them. |
| 8d | **Include the canonical three-line snippet verbatim**, so it is copied rather than paraphrased: `const gate = await requireAdmin(requestLogger); if (gate instanceof NextResponse) return gate; const { user } = gate;` |
| 8e | Fix the `:25` Inputs row: "admin-only" no longer reads "needs a role check" but "uses the `requireAdmin` gate". |
| 8f | Add a checklist line to the skill's existing final checklist: *"Admin route? `requireAdmin` is the first statement, and there is no other admin check in the file."* |
| 8g | Note that the CI guard (R1/R7) will fail the build if this is skipped — so the skill and the guard tell the same story from both ends. |

#### Edit 2 — `CLAUDE.md` Key Documentation table

Add one row, following the established shape of the `tenant-isolation-guard` and `durable-queue-drain` rows ("Building or reviewing X? Use the Y skill / read Z") — **match their voice, do not invent a format.** It must name `requireAdmin` as the one gate, point at `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md`, state `admin_users` as the only trusted signal (never `profiles.role`, never `app_metadata.role`), and note that the guard enforces it in CI.

> There is already an `ADMIN_IDENTIFICATION_AND_ACCESS.md` row in that table carrying *"Read before any admin-authz work — never use `profiles.role`."* **Extend that row rather than adding a competing one** — two rows about admin authz would reproduce, in the documentation index, precisely the duplication this programme removed from the code.

#### Recommendation — a standalone `admin-authz` skill? **Yes, but only after slice 8, and only as a front door.**

**Recommend building it**, with reasoning and a caveat. The bar set was *"enough non-obvious procedure to justify it beyond what the `new-api-route` edit already covers"*, and the answer is yes, because `new-api-route` covers **one of three surfaces**. The genuinely non-obvious procedure it cannot hold: the **pages** surface (why the guard must sit on `app/admin/layout.tsx` as an async Server Component with the chrome moved to `AdminChrome`, and the three escapes E1/E2/E3 — a route handler under `app/admin/` is not wrapped by layouts, layouts do not re-render on soft navigation, and the boundary is a URL subtree not "admin-ness"); the **database** surface (`public.is_platform_admin()` is the SQL-side predicate, the one-source/two-mechanisms invariant, and the `ADMIN_EMAILS` divergence that makes an env-only admin pass every app check and fail every RLS policy); the **401-vs-403 contract** and why it must never become a 500 (self-gating UI depends on it); **capability flag vs route gate** (the `calibrate/batch` case, where `requireAdmin` is the wrong tool); and **how to add a guard exception** properly. That is a cross-cutting concern spanning three runtimes — exactly the shape `tenant-isolation-guard` exists to front. **Caveat, and it is the one that decides the design: build it only after slice 8 rewrites the doc, and make it a thin decision-tree front door that POINTS at the doc rather than restating it.** A skill that duplicates the doc becomes a fourth place for admin authz to drift, which is the failure this programme is named after. **Counter-argument, recorded honestly:** the highest-traffic path by far is "someone adds an API route", and edits 8a–8g plus the `CLAUDE.md` row already cover it; the marginal value is concentrated in the rarer pages and migration work. So this is a **recommendation, not a requirement** — and it is explicitly **not built in this programme**.

### What the rewritten doc must say

| # | Statement | Why it must be there |
|---|---|---|
| 1 | **One source of truth (`admin_users`), two enforcement mechanisms, one per runtime: `AdminAccessService.isAdmin()` in Node, `public.is_platform_admin()` in SQL.** Do not attempt to unify them. | RC-5. The current phrasing invites a Dev to try, which means either an RLS policy calling the app (impossible) or the app trusting RLS to gate routes (it can't — most admin routes use the service role and bypass RLS). |
| 2 | **The sync invariant and its one permitted divergence (FR-16):** `ADMIN_EMAILS` and the email self-heal are **app-side only**. ⇒ *An admin who exists only in `ADMIN_EMAILS` and has never made an API call passes every app-code check and fails every RLS policy.* | RC-5. Today this is a comment in one migration. It is exactly the asymmetry that produces an "it works in the admin UI but the table comes back empty" bug later. |
| 3 | **The truth about `profiles.role` (F6 is currently false — FR-12, RC-6):** a repo-wide sweep for an **access decision** keyed on that column returns **zero hits**. `lib/server/route-identity.ts:118-131` and `lib/business-os/purge/purgeAuthz.ts:23-26` resolve admin **only** through `AdminAccessService` — their `profiles.role` mentions are **comments forbidding it**. Every surviving read is display or onboarding persona: `lib/repositories/UserProfileRepository.ts:51`, `components/onboarding/hooks/useOnboarding.ts`, `app/api/admin/onboarding-users/route.ts:24`. The DB policies that did read it were **replaced** on 2026-09-20 (`20260920a_…sql`; the old policy survives only as a commented rollback at lines 311-312). | RC-6 + the user's F5 instruction (a). Recording the corrected sweep here means the separate F5 item starts from the true state instead of re-doing a sweep that has now been done twice. |
| 4 | **Revocation semantics (RC-8):** within the **60 s** `AdminAccessService` cache TTL in app code, **immediate** in RLS. The cache is deliberate (NFR-Performance) and is not to be removed. | RC-8 |
| 5 | **What the database surface does NOT close (RC-13):** most former category D routes construct a service-role client inline and therefore still bypass **both** RLS and the repository layer. **They are gated, not isolated.** | RC-13. The DoD must not leave the impression the database surface is covered. |
| 6 | **Which tables are `is_platform_admin()`-backed today** (`ai_model_pricing`, `system_settings_config`) **and which are still service-role-only-by-convention.** | RC-5 |
| 7 | **How to add and remove an admin** under BQ-2 option B (edit + re-run the seed; requires Supabase access), and that there is deliberately no in-product management surface. | Slice 7 |
| 8 | **The CI guard**: its six rules, where the allow-list lives, that an exception is a dated line with a written reason, and that the workflow must remain a **required status check** — removing that setting silently un-gates the repo. | FR-11, RC-3 |
| 9 | **The three page-guard escapes E1/E2/E3**, and that **FR-7 is amended: the page guard is defence-in-depth; the API gate is the security boundary.** | RC-10 |
| 10 | **The reward-config mirror drift** (slice 3): `agent_sharing_reward_active` is mirrored on the admin toggle path; a direct DB edit of `reward_config` bypasses it. | Slice 3 |
| 11 | The doc's existing **open items 1–2** are either closed or restated truthfully, with the tracking reference for each. Open items 3–5 (grant/revoke + `GET /api/admin/admins`) are restated as deferred, with BQ-2's decision recorded. | Slice 8 AC |

### Test plan

| What proves it works | What proves the failure path |
|---|---|
| Every factual claim in the rewritten doc is re-verified against the merged code on the day it merges — file:line for each. | **A reviewer re-runs the `profiles.role` sweep** and confirms zero access-decision hits. If the sweep is non-zero, the doc is wrong and R4's allow-list is non-empty — both would be caught by the guard. |
| `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` follows CLAUDE.md Documentation Standards: header, Last Updated, Overview, ToC (it is >150 lines), tables, Change History at the end. | — |
| All programme-wide ACs are ticked in the requirement MD with evidence, including "every one of the 44 route files is in a known end state". | A file-by-file end-state table (44 rows) is the artefact; any row without a state is a gap. |

### Deploy safety

Doc-only. Zero runtime impact. Safe to delay indefinitely — at the cost that the access document stays wrong, which is what created F6 in the first place.

### Task checklist

- ⬜ 8.1 Rewrite `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` covering statements 1–11
- ⬜ 8.2 Re-verify every file:line citation against the merged code
- ⬜ 8.3 Build the 44-row route end-state table (gated / deleted / documented exception)
- ⬜ 8.4 Close or truthfully restate the doc's open items 1–2; restate 3–5 as deferred with BQ-2's decision
- ⬜ 8.5 Mark the requirement MD complete; record the required-status-check enablement date and who did it
- ⬜ 8.6 Housekeeping: mark or delete `scripts/test-phase3-full-integration.ts` (stale `/api/admin/model-routing` reference)
- ⬜ 8.7 Confirm the Open Issues table below has an owner and a tracking location for every row
- ⬜ 8.8 **Skill fix — `.claude/skills/new-api-route/SKILL.md:118`.** Replace the `user.app_metadata?.role === 'admin'` instruction with `requireAdmin`. **This is a correction of a wrong instruction, not an addition** — until it lands, the scaffolding skill actively teaches a second admin signal
- ⬜ 8.9 Same file `:25` — Inputs row: "admin-only … needs a role check" becomes "uses the `requireAdmin` gate"
- ⬜ 8.10 Same file — include the **canonical three-line snippet verbatim** (8d) so it is copied, not paraphrased; state the gate is FIRST (FR-5) and that `admin_users` is the only trusted signal
- ⬜ 8.11 Same file — add the checklist line (8f) and the note that CI (R1/R7) fails the build if the gate is skipped (8g)
- ⬜ 8.12 **`CLAUDE.md`** — **extend the existing `ADMIN_IDENTIFICATION_AND_ACCESS.md` row** in the Key Documentation table rather than adding a second admin row; match the `tenant-isolation-guard` / `durable-queue-drain` voice; name `requireAdmin` as the one gate and rule out `profiles.role` **and** `app_metadata.role`
- ⬜ 8.13 Record the standalone-skill **recommendation** (build an `admin-authz` front-door skill *after* this slice, pointing at the doc rather than restating it) — **recommendation only; do not build it in this programme**
- ⬜ 8.14 Final Change History entry here

---

## RC Traceability Matrix

Every one of the SA's 14 required changes, and where this workplan implements it.

| RC | Requirement | Planned in | Concrete? |
|---|---|---|---|
| **RC-1** | Slice 0 pre-flight (admin identity per environment; `ADMIN_EMAILS` in `.env.example`; caller enumeration in the requirement doc; send BQ-5) | [Slice 0](#slice-0--pre-flight-blocking-no-code) | ✅ — with one deviation: `.env.example` needs a `.gitignore` negation (N-3) |
| **RC-2** | CI guard lands with slice 1, dated shrinking allow-list; slice 6 = "allow-list empty" | Slices 1, 2, 3, 4, 5, 6, 7 | ✅ |
| **RC-3** | Dedicated workflow, **no `paths:` filter**, explicit DoD step to make it a **required status check**; follow the `no-deletion-paths.guard.test.ts` precedent | [Slice 1](#slice-1--stop-anonymous-writes-and-destructive-actions--ci-guard) (workflow) + [Slice 6](#slice-6--close-the-ci-gate) (manual step) | ✅ |
| **RC-4** | Widen FR-10: scan by shape, rules (a)–(e) | [The CI Guard spec](#the-ci-guard--exact-specification), rules R1–R5 | ✅ |
| **RC-5** | FR-15/16/17; DoD database row rewritten around `is_platform_admin()`, one-source/two-mechanisms, documented `ADMIN_EMAILS` divergence; slice 8 records which tables are backed by it | [Database surface](#the-database-surface--sync-invariant) + Slice 8 statements 1, 2, 6 + guard R5 | ✅ |
| **RC-6** | Apply the F5 factual correction; record the corrected sweep result | Slice 8 statement 3 | ✅ |
| **RC-7** | Reword FR-5 so the gate's self-heal write is not a self-contradiction | [Implementation Approach](#implementation-approach) — stated as a standing instruction ("do not fix it") + denial tests assert *handler* work, not all writes | ✅ |
| **RC-8** | Revocation: **within the 60 s cache TTL** in app code, immediate in RLS; keep the cache | Slice 7 test plan + Slice 8 statement 4 | ✅ |
| **RC-9** | Slice 4 updates `lib/admin/requireAdminRoute.ts`'s provenance docstring | [Slice 4](#slice-4--one-gate-one-implementation) file 8 | ✅ |
| **RC-10** | Server-layout guard; enumerate the three escapes; amend FR-7 to defence-in-depth | [Pages Guard spec](#the-pages-guard--exact-specification) E1/E2/E3 + Slice 5 + Slice 8 statement 9 | ✅ |
| **RC-11** | Slice 3: replacement read path and gate in **one** commit | [Slice 3](#slice-3--resolve-the-customer-visible-config-reads), task 3.12 | ✅ |
| **RC-12** | Record the three dev scripts as expected fallout in slice 1's AC | [Slice 1 deploy safety](#deploy-safety-1) table | ✅ |
| **RC-13** | DoD database row names the service-role / repository-pattern bypass as a known, deliberate, tracked gap | [Database surface](#the-database-surface--sync-invariant) last paragraph + Slice 8 statement 5 + OI-5 | ✅ |
| **RC-14** | Rework the BQs: two for the user, not six | [Settled Decisions](#settled-decisions) — all six recorded as settled; BQ-2/BQ-3 answered by the user 2026-09-20 | ✅ |

**Nothing in RC-1 … RC-14 was left without a concrete implementation plan.** Three items needed an SA decision rather than a Dev decision; **all three are now decided** — see [Settled Decisions](#settled-decisions) and W-1/W-3/W-9.

> ✅ **W-2 APPLIED.** The six RCs below are discharged **twice** now: in this plan (as they always were) **and** in the requirement document, via **slice-0 task 0.12**, which is blocking and precedes slice 1. The `⬜ for the contract` column is closed.

> **[SA 2026-09-20 — the matrix is optimistic on one axis, and it matters.]** Six RCs (**RC-4, RC-5, RC-7, RC-10, RC-13, RC-14**) are not instructions to write code — they are instructions to **amend the requirement document's FR table, DoD and BQ section**. This workplan honours their *intent* in slices and specs, but **the requirement MD itself still carries the un-amended FR-5, FR-7 and FR-10, still has no FR-15/16/17, and its DoD database row is unchanged.** Slice 8 touches that file only to "mark the programme complete".
>
> That is a real gap, not bookkeeping: **the requirement is the contract QA tests against.** If FR-5 still says "no write … before the check has passed", QA can correctly fail the gate's own self-heal. If FR-7 still implies the page guard is the security boundary, QA will test the wrong thing. If FR-15/16/17 do not exist, nothing obliges the DB invariant to be documented at all.
>
> **Required: a slice-0 task that applies the RC-mandated amendments to the requirement document before slice 1 starts**, so the contract and the plan agree *before* implementation rather than after. See required change **W-2**.

---

## Risks & Flagged Callers

### Every route where the gate changes behaviour for an existing caller

| Route | Slice | Caller | Effect | Mitigation |
|---|---|---|---|---|
| `GET /api/admin/reward-config` | 3 | `app/(protected)/agents/[id]/page.tsx:406` | share-reward indicator would go dark for every customer | Replacement read path in the **same commit** (RC-11) |
| `GET /api/admin/reward-config` | 3 | `app/v2/agents/[id]/page.tsx:360` | same | same; net one fewer HTTP request afterwards |
| `GET /api/admin/reward-config` | 3 | `app/(protected)/agents/[id]/page.backup-20251101-215528.tsx:424` | **dead backup file** — no effect | Not fixed here; OI-6 |
| `GET /api/admin/boost-packs` | 3 | ⚠️ unconfirmed — plausible customer-facing pricing/upgrade screen | would break an upgrade screen | **Slice 0 P-4 must enumerate before slice 3 ships** |
| `GET /api/admin/execution-tiers` | 3 | ⚠️ unconfirmed — plan/entitlement catalogue | same | same |
| `GET /api/admin/storage-tiers` | 3 | ⚠️ unconfirmed — plan/entitlement catalogue | same | same |
| `GET /api/admin/agents` | 4 | `components/admin/AdminCalibrationTrigger.tsx` | **not a break** — it deliberately probes and hides itself on 401/403. A working gate is its designed input. | Regression check in slice 4: the gate must keep answering 401/403 and **never 500** (FR-4) |
| `/api/admin/business-os/llm-usage/businesses` | 4 | `components/test-business-os/llm-usage/LlmUsageVerification.tsx` | **not a break** — internal harness, admin-operated, route already gated today | Verify only |
| `GET /api/admin/settings/platform-users` | 2 | `app/admin/settings/page.tsx:82` | admin-operated screen; and the screen is deleted in slice 7 anyway | None needed |
| `GET`/`POST /api/admin/settings/admin-users` | 1 | `app/admin/settings/page.tsx:61,124,161` | admin-operated screen; **reviewers should know slice 1 is gating a write to a store that grants nothing** — correct, and deleted in slice 7 | Stated in the slice 1 PR body |
| All 21 `/admin` pages | 5 | any non-admin visitor | silent redirect to `/business-os` | BQ-3 option A; identical-response test |

### The three dev scripts that fetch admin routes anonymously (SA §6.1, RC-12)

| File | Line | Call | Expected after slices 1–2 | Action |
|---|---|---|---|---|
| `scripts/test-phase5-full-integration.ts` | 174 | anonymous `fetch('http://localhost:3000/api/admin/ais-config')` | **401** — Test 4 of the script fails | Recorded as expected fallout; **not a reason to delay anything** |
| `scripts/test-phase6-final-verification.ts` | 287 | same | **401** | same |
| `scripts/test-phase3-full-integration.ts` | 170 | references `/api/admin/model-routing` — **a route that no longer exists** | already stale before this programme | Mark or delete in slice 8 housekeeping |

### Other risks

| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| R-1 | **Operator lockout.** An environment where neither the `admin_users` seed nor `ADMIN_EMAILS` resolves the owner. After slice 7 there is no in-product recovery; after slice 5 there is no on-screen explanation. | Low, **catastrophic** | Slice 0 P-1 is a **blocking** precondition, re-confirmed immediately before slices 1, 5 and 7 deploy |
| R-2 | **An out-of-repo caller** (uptime monitor, ops script, scheduled job) polls an admin URL. A repo sweep structurally cannot see it. | Low | BQ-5's single question to the deployment-access holder; blocks slices 1 and 2 only. Fix if found is a **service credential**, not re-opening the endpoint |
| R-3 | **The CI workflow is never made a required status check**, so G3 is aspirational. | **Medium** — it is a setting nobody owns | Called out as an explicit, named manual step; slice 6 is not Done without it; verified with a throwaway PR that merging is *blocked*, not merely red |
| R-4 | **Guard false positives** make the gate annoying and it gets switched off. `role: 'user'` appears hundreds of times in LLM message construction. | Medium | R4 matches comparisons to admin-ish literals only, never assignments; unit-tested. R5 strips SQL comments; unit-tested against the real file that would otherwise trip it |
| R-5 | **`reward-config` mirror drift** — a direct DB edit of `reward_config.is_active` leaves `agent_sharing_reward_active` stale. | Low | Documented in slice 8; the admin UI is the only supported toggle; **SA to confirm the design** |
| R-6 | **Slice 6 before slice 7** cannot empty R4's allow-list, since the 2 entries live in files slice 7 deletes. | Certain if merged in numeric order | **Recommended merge order: 7 before 6.** Flagged for SA |
| R-7 | **Redirect loop** `/admin` → `/business-os` → … for an anonymous visitor. | Low | Explicit redirect-loop test in slice 5 |
| R-8 | **A reviewer reads slice 2's nine re-edited files as a partial revert** of slice 1. | Medium | The verb-split is stated in this plan, in the slice 2 file table, and must be restated in the PR body |

---

## Follow-up Programme — Admin Routes Repository Conformance

> **Requested by the user, 2026-09-20:**
> *"once we finish reviewing this code and commit, all these admin files that have direct access to DB need to go through repositories. See if we can reuse an existing repository. Document for now and we come back to it."*

**Status:** 📋 **Documented only — no code, no estimate, no slice numbers in this programme.**
**Sequencing:** starts **after slice 1 is committed**. A **separate programme**, not a slice of this one.
**Why it is here rather than a one-line open issue:** the user asked for it explicitly, and it is larger than anything in the open-issues table — 38 files against a mandatory project rule.

This is **CLAUDE.md mandatory rule 1** (*all DB access via `lib/repositories/`*) plus the standing *"enforce repository pattern in review"* preference. The admin surface is a **large pre-existing violation** of both. This programme gates those routes; it deliberately does **not** isolate them — per RC-13, **they are gated, not isolated.**

### Scope — 38 of the 44 admin route files (measured 2026-09-20, re-verified)

Direct DB access = `supabaseServer`, a hand-rolled `createClient(...)`, `supabaseAdmin`, or a raw `.from(...)`.

| Shape | Files | Note |
|---|---|---|
| Any direct DB access | **38 / 44** | The scope of this follow-up |
| Construct **their own** `createClient(...)` | 31 | |
| …of those, at **module scope** (import time) | **25** | Harmless in itself — constructing a client performs no I/O — but it is the shape that makes the bypass invisible |
| Use the shared `supabaseServer` | 3 | |
| Already import a repository | **5** | See corrections below |

### Reuse map — the part the user asked for

**A. Already has an owning repository — reuse, do not create (14 tables).** Each repository below was verified to own the table stated.

| Table | Repository | Admin routes touching it |
|---|---|---|
| `system_settings_config` | `SystemConfigRepository` | agent-generation-config, memory-config, onboarding-config, orchestration-config, ui-config, settings/admin-users, settings/platform-users |
| `ais_system_config` | `ConfigRepository` | ais-config, ais-weights (×3), calculator-config, execution-tiers, orchestration-config, storage-tiers, system-limits |
| `reward_config` | `ConfigRepository` | reward-config |
| `ai_model_pricing` | `AiModelPricingRepository` | agent-generation-config |
| `agents` | `AgentRepository` | ais-config, dashboard, migrate-labels, token-usage/drill-down, users/[id]/stats |
| `agent_executions` | `AgentRepository` / `ExecutionRepository` | dashboard, users/[id]/stats |
| `token_usage` | `TokenUsageRepository` | ais-config, dashboard, token-usage (×3), users/[id]/stats |
| `profiles` | `UserProfileRepository` | dashboard, onboarding-users, settings/admin-users, settings/platform-users, token-usage (×2), users |
| `audit_trail` | `AuditTrailRepository` | audit-trail, users/[id]/audit-logs, users/[id]/login-stats |
| `user_subscriptions` | `UserSubscriptionRepository` | execution-stats, onboarding-users, storage-stats, users/[id]/stats |
| `plugin_connections` | `PluginConnectionRepository` | users/[id]/stats |
| `run_memories` | `MemoryRepository` | dashboard |
| `agent_intensity_metrics` | `AgentMetricsRepository` | dashboard |
| `admin_users` | `AdminUserRepository` | already correct, via `AdminAccessService` |

**B. No owning repository — a new one would be needed (6 table groups).**

| Table group | Admin routes |
|---|---|
| `ais_normalization_ranges` | ais-config, dashboard |
| `boost_packs` | boost-packs |
| `contact_messages` + `message_replies` | messages, messages/[id], messages/[id]/replay |
| `help_articles` + `support_cache` | backfill-embeddings |
| `pricing_config` + `reward_settings` | reward-config |
| `workflow_executions` + `workflow_step_executions` | token-usage/drill-down |

*(A seventh entry — `users`, from audit-trail — was supplied. It is not a table. See the new finding below.)*

### 🔴 The open question that must be answered first — for SA

**These are cross-user admin reads BY DESIGN.** `dashboard` aggregates every user's executions; `users` lists every account; `token-usage/drill-down` reports per-user LLM spend. The repository methods they need are therefore **not** the standard `.eq('user_id', userId)` shape every existing repository method is built around — and that scoping *is* the security property the repository layer exists to enforce (CLAUDE.md mandatory rule 4; Security Rules: *"Always `.eq('user_id', userId)` in queries — prevents cross-user data leakage"*).

> **This cannot be a mechanical "swap the client for the repository" refactor.** It needs an SA decision on **how an admin-scoped repository method is expressed safely, such that it cannot become a hole a non-admin caller can reach.**

The single most important open question in this write-up. Sketching the shape of the problem, not deciding it:

- A method like `listAllForAdmin()` is reachable from **any** caller that imports the repository. The repository layer has no notion of "admin" today; `AdminAccessService` is an app-layer concept.
- Putting the admin check **inside** the repository inverts the current architecture — repositories are data access, authorization lives at the route boundary in `requireAdmin` — and would make repositories depend on auth.
- Leaving the check only at the route means an unscoped method is one careless import away from a non-admin route. That is exactly the *"one place to get it wrong, and the next copy is the next bug"* failure this whole programme exists to remove.
- Whatever is chosen wants the property the CI guard gives the route surface: **a violation should be visible in review, not discoverable in an audit.** An unscoped method may need to be findable by a static rule, the way R1–R5 find ungated routes.

**Do not start this programme before that decision exists.** Converting 38 files to a shape that later proves wrong is worse than today's state, which is at least uniformly wrong in a known way.

### Interaction with slice 3 — it sets the precedent

SA has already required slice 3's customer-facing reward projection to read **through `lib/repositories/`** (workplan review W-3: *"a minimal read method is acceptable; this is the **correct** direction of travel for OI-5, not an exception to it"*).

> **Slice 3 is therefore the first instance of this pattern, and whatever shape it takes sets the precedent for all 38 files.**

Slice 3's read is the *easy* case — one non-user-scoped config value, no cross-tenant dimension — so it will not by itself answer the question above. But it will fix file layout, naming and method-shape conventions, and should be written knowing 38 files may follow. **Flag any decision taken there that would not generalise.**

### Corrections to the supplied measurements

| Claim as given | Finding |
|---|---|
| 38 admin route files perform direct DB access | ✅ **Correct** — verified 38 of 44. |
| *"Only `agents/route.ts` uses a repository today"* | ❌ **Wrong — five do.** `agents/route.ts`, `business-os/llm-usage/businesses/route.ts`, and the three `system-config*` routes. **The latter four have ZERO direct DB access.** This matters: the `system-config*` trio is the category-A canonical-gate group, so the admin surface already contains a **working precedent of gate + repository together**. Cite it rather than starting from scratch. |
| *"`agents/route.ts` still has 3 direct hits"* | ⚠️ **Count right, characterisation wrong.** Three hits, but they are two imports plus one `supabaseServer.auth.admin.listUsers()` — a **Supabase Auth Admin API** call, not a table query. There is no repository for it and arguably should not be. Its `.from(` count is **zero**. Treat auth-admin calls as a separate category, or this programme will chase a conversion with no destination. |
| *"`ui-config/route.ts` constructs its OWN service-role client at module scope — the worst shape"* | ⚠️ **True of the file, but it is not special: 25 admin route files do this**, including `agent-generation-config`, `boost-packs`, `reward-config` and `ais-weights/*`. `ui-config` is distinctive only in passing explicit `auth: { autoRefreshToken: false, persistSession: false }`. **The problem is systemic**; framing it as one file would under-scope the work. |
| `users` needs a new repository (*"verify — may be `auth.users`"*) | ❌ **Neither.** It is a dead query against a table that does not exist — see below. |

### 🐛 New finding — `audit-trail` queries a table that does not exist

`app/api/admin/audit-trail/route.ts:154` runs `.from('users').select('id, email, full_name')`.

- It is **not** `auth.users`. PostgREST resolves `.from('users')` against the **`public`** schema and cannot reach `auth` unless that schema is explicitly exposed.
- **`public.users` does not exist** — no `CREATE TABLE … users` anywhere in `supabase/`, and this is the **only** `.from('users')` in the repository.
- The error is swallowed (`if (!usersError && users)`), so `usersMap` stays `{}` and **every audit-log row returns `users: null`**. The admin audit screen has silently never shown a user's name.
- Correct target: **`profiles` via `UserProfileRepository`** for `full_name`. Note `profiles` has **no `email` column** (`UserProfileRepository:51` selects `id, full_name, role, company, timezone`), so email must come from the auth admin API — the same split `settings/admin-users` already performs.

**`users` therefore drops off the "needs a new repository" list**, taking it from 7 table groups to 6. Tracked as **OI-18**; not fixed here — a pre-existing display bug, not an authz defect, and this programme changes no behaviour.

---

## Open Issues Raised, Not Fixed Here

Per the user's standing instruction, anything outside the core task is documented rather than pulled in. One line each, plus where it should be tracked.

| # | Issue | Where it should be tracked |
|---|---|---|
| **OI-1** | **F5 — profile self-promotion (P0).** `app/api/user/profile/route.ts:124` copies `role` from the request body onto the caller's own profile; any customer can set their own profile role to `admin`. Corrected shape: **one self-promotion write, zero app-code access readers, DB policies already replaced.** Remaining question is a data-model one (which `role` values are onboarding personas vs access levels), reaching `supabase/SQL Scripts/20251118_update_profiles_role_constraint.sql` and the onboarding flow — **one grep, not a discovery phase.** | **New P0 item with a named owner and a date.** The BA's and SA's argument for keeping it separate depends on it being *scheduled*, not filed. Blocked here only by CI rule R4, which stops it recurring through a new door. |
| **OI-2** | **`console.*` in `app/api/admin/reward-config/route.ts` — 23 calls, one of which logs the full request URL on every GET and several of which log reward/eligibility payload shapes.** A small privacy issue, not a formatting preference. | **Scheduled — slice 1L**, not deferred. Recorded here so it is not lost if 1L slips. |
| **OI-3** | **FR-10 scope gap: admin-capability code outside `app/api/admin/`.** `app/api/v2/calibrate/batch/route.ts:116` resolves admin via `AdminAccessService` to choose between a service-role and an RLS client — a capability flag, not a route gate, and legitimately so. It is the **one permanent entry** in guard rule R2's allow-list. `lib/server/route-identity.ts` similarly gates act-as. Neither is unified by this programme. | **New item: "admin-capability surfaces outside `/api/admin`"**. Guard R2 makes any *new* one visible in review, which is the important half. |
| **OI-4** | **Admin grant/revoke feature + a `GET /api/admin/admins` endpoint** (BQ-2 option A). Deferred by user decision; slice 7 deletes the broken surface rather than rebuilding it. | `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` open items 3–5, restated in slice 8 with BQ-2's decision and its true cost (a third admin needs Supabase access). |
| **OI-5** | **Repository-pattern + RLS bypass in ~30 former category D routes.** They construct a service-role Supabase client inline (e.g. `app/api/admin/reward-config/route.ts:10-13`) instead of going through `lib/repositories/`, violating CLAUDE.md mandatory rule 1 and the standing "enforce repository pattern in review" preference. After slice 1 they are **gated, not isolated** (RC-13). | **New item: "admin routes repo conformance"**. Fixing 30+ routes' data access inside a security sweep destroys reviewability. |
| **OI-6** | **Dead backup file** `app/(protected)/agents/[id]/page.backup-20251101-215528.tsx` (it calls `/api/admin/reward-config` at line 424 and is otherwise unreferenced). | Housekeeping item. |
| **OI-7** | **Orphaned `system_settings_config.admin_users` key.** After slice 7 nothing reads or writes it. Harmless (it grants nothing) but a trap for a future reader who assumes it means something. Needs a cleanup migration or a documented tombstone. | **New housekeeping item**, raised by slice 7 task 7.10. |
| ~~**OI-8**~~ | ~~`.env.example` does not exist and `.gitignore:38` ignores `.env*`.~~ **CLOSED by W-1, not tracked.** SA decided docs-only: `docs/VERCEL_ENV_SETUP.md` serves RC-1(b)'s purpose, and loosening a blanket secrets-ignore on a **public** repo to document one already-documented variable is not a trade SA will approve. | **Closed.** No follow-up. |
| **OI-9** | **Live-database `pg_policies` re-measurement.** What remains genuinely unmeasured is whether a policy existing **only** in the live database (not in this repo's migrations) still trusts `profiles.role`. A `pg_policies` read, not a slice. | Existing **"DB RLS holes: settings & pricing"** item. Explicitly out of scope per SA. |
| **OI-10** | **"New table without `ENABLE ROW LEVEL SECURITY`" CI check.** Valuable, and adjacent to guard rule R5 — but SA explicitly scoped it out of this programme rather than leaving it unsaid. | **New item**, adjacent to OI-9. |
| ~~**OI-11**~~ | ~~`agent_sharing_reward_active` mirror drift.~~ **CLOSED by W-3 — the mirror is not built.** The projection reads `reward_config` directly, so there is no second store and nothing to drift. | **Closed.** Superseded by OI-14. |
| **OI-12** | **Retiring the access-level values from the `profiles_role_check` constraint.** Depends on OI-1 and OI-9 landing first. | `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` open item 6. |
| **OI-13** | **`GET /api/admin/settings/admin-users` performs a write** (bootstrap upsert, lines 40-70) — a GET that mutates, reachable by any signed-in customer today. **Resolved by slice 1 (gated) and slice 7 (deleted)**, recorded here because it is a pattern worth not repeating. | Closed by this programme; noted for the record. |
| **OI-14** | **[W-3] The `agent_sharing_reward_amount` duplication already exists and already drifts.** The amount lives **both** in `system_settings_config` (read live at `app/v2/agents/[id]/page.tsx:359,393`) **and** on the `reward_config` row the admin screen edits, with **nothing syncing them**. Slice 3 deliberately does **not** fix it — folding the amount into the projection would change what a customer sees and is outside BQ-1. | **New item: "reward amount dual-store reconciliation"**. Must be scheduled before anyone edits either store believing it is authoritative. |
| **OI-15** | **[W-6 / SA finding N-4] `GET /api/system-config` is unauthenticated, service-role-backed and takes arbitrary `keys`/`category`.** No `getUser()`, no gate, and `SystemConfigRepository` is built from `supabaseServer` (`lib/repositories/SystemConfigRepository.ts:5`) — so **RLS does not apply** and anyone on the internet can enumerate and read any `system_settings_config` row. RLS-level read-openness on that table is a deliberate documented decision; a service-role route with a caller-supplied key/category is broader than that decision covers. Predates this programme; closing it needs its own caller analysis. | **New item: "system-config read oracle"**. Out of scope here, but it is the second reason slice 3 routes around it. |
| **OI-16** | **[finding E-1] `app/admin/messages/page.tsx:152` calls `/api/admin/messages/{id}/reply` — a route that does not exist.** The directory is `replay`, not `reply`. The admin "reply to message" button 404s today and did before this programme. A broken feature, not an authz defect.<br><br>⚠️ **WARNING — the obvious fix is dangerous (SA, 2026-09-20). Do not treat this as a typo.** Repointing the page at `replay` would wire an admin button to a handler whose job is **re-sending a platform communication to a real recipient** — a materially different action from replying. Whoever picks this up **must build or identify a real reply path**; renaming the URL would send mail to a customer from a button labelled "reply". | **New item: "admin message reply path"**. Stays tracked; does **not** come into this programme. |
| **OI-18** | **`app/api/admin/audit-trail/route.ts:154` queries a table that does not exist.** `.from('users').select('id, email, full_name')` — PostgREST resolves this against `public`, **`public.users` does not exist** anywhere in `supabase/`, and it is the only `.from('users')` in the repository. The error is swallowed (`if (!usersError && users)`), so **every audit-log row returns `users: null`** and the admin audit screen has silently never shown a user's name. Correct target is `profiles` via `UserProfileRepository` for `full_name` (note `profiles` has **no email column**, so email must come from the auth admin API — the split `settings/admin-users` already performs). | **Folded into the repository-conformance follow-up** as a pre-existing display bug. Not an authz defect; this programme changes no behaviour. |
| **OI-17** | **[findings E-2 / E-3] Five anonymous reads with no in-repo caller** — `token-usage`, `token-usage/stats`, `backfill-embeddings` (GET), `memory-consolidation` (GET), and `messages/[id]/replay` (which can re-send platform communications). Two of the five carry "No in-repo caller (OI-17)" inside their guard allow-list reason, so the observation travels with the code.<br><br>⚠️ **WARNING — this must NOT become a deletion (SA, 2026-09-20).** Two reasons. First, deleting a route is a **behaviour change**, and a security sweep is the wrong vehicle for one — the same argument that made slice 7 a separate, user-decided slice. Second, **"no in-repo caller" is exactly the claim BQ-5 exists to qualify**: an ops script or uptime monitor outside the repository is structurally invisible to a repo sweep, and `dashboard` / `execution-stats` / `token-usage` are *precisely* the shape of thing something polls. **Gate them in slice 2 as planned; revisit deletion only once BQ-5 is answered.** | **New item: "uncalled admin routes"**, blocked on the BQ-5 answer. |

---

## SA Review Notes

**All three decisions this workplan escalated were made by SA on 2026-09-20 and are now folded in:**

| # | Escalation | SA decision | Applied as |
|---|---|---|---|
| 1 | **N-3 / OI-8 — `.env.example`** | ❌ **REJECTED — docs-only.** SA amended its own RC-1(b). The repo is public and has already had a live `service_role` key committed; a `!.env.example` negation opens a class of exceptions to a blanket secrets-ignore, to document one variable `docs/VERCEL_ENV_SETUP.md` already covers. The real lockout protection is P-1. | **W-1** — slice 0 drops 2 files; P-2 and tasks 0.5/0.10 deleted; OI-8 closed |
| 2 | **Slice 3 — the mirror** | ❌ **REJECTED — replaced with a read-only projection.** The mirror is the F1 anti-pattern slice 7 deletes, and the duplication already exists and drifts. **No migration ships in this programme.** "No new endpoint" amended: a single-purpose read route is this repo's standard pattern. | **W-3** — slice 3 reshaped; `20260920b` deleted; OI-11 closed, OI-14 opened |
| 3 | **Merge order 7 before 6** | ✅ **CONFIRMED.** Binding order `0 → 1 → 1L → 2 → 2L → 3 → 4 → 5 → 7 → 6 → 8`; second constraint added: **8 after 6**. Slice 7 may optionally move after 1L. | **W-9** — recorded in the Slice Index; **choice: slice 7 stays late** (the conservative option) |

**Code-review rulings (SA, 2026-09-20):** **(a)** catalogue GETs stay in slice 3 — *confirmed*, because slice 2's value rests on a **mechanical** `git diff --stat` check a reviewer can run rather than an enumeration they must trust. **(b)** slice 7 stays late — *confirmed*. **(c)** the `node_modules` junction is **acceptable**.

> **Recorded caveat on (c).** The worktree's `node_modules` is a junction to the primary repo's, so local test results are only authoritative **while the two trees' dependency sets agree**. This diff adds one npm script and no dependency, so it is moot here — but if the trees ever diverge, local green means nothing. **CI's `npm ci` from the lockfile is the authority**, which is another reason the guard needs its own workflow (slice 1) and required-status-check (slice 6).

**Plus the systematic gap SA found (W-2):** six RCs instructed amendments to the **requirement document** that were planned but never applied, leaving the contract QA tests against in contradiction with this plan. Now blocking slice-0 task **0.12**.

---

## SA Workplan Review

**Reviewed by SA — 2026-09-20**
**Status:** 🔄 Revision Required → **APPROVED WITH CHANGES**

Reviewed against the worktree, not against the plan's own claims. **Every factual assertion I spot-checked was true** — the 44/3/7/2/32 census, the 21 pages, zero `route.ts` under `app/admin/`, the 60 s cache, the `is_platform_admin()` definition, the `no-deletion-paths.guard.test.ts` and `auditAdminGate.test.ts` precedents, `/business-os` as the post-login destination, the `console.*` counts (`ais-config` 75, `reward-config` 23, `users` 7, and `settings/admin-users`/`helpbot-config` genuinely at 0), the 502-line settings page, `AdminSidebar:187`, `AdminHeader:90`, and `platform-users`' single caller. This is a workplan that was written from the code.

Ten required changes below (**W-1 … W-10**). Two are structural (**W-1** the requirement contract, **W-3** the slice-3 shape); the rest are corrections and specifications. **Nothing here rejects the plan's architecture** — the pages guard, the CI guard, the verb-split and the shrinking allow-list are all correct and well-argued.

---

### 1. RC traceability — spot-checked, and one systematic gap

| RC | Claim | SA finding |
|---|---|---|
| **RC-2** (CI guard with slice 1) | ✅ | **Genuinely discharged, not cited.** The guard is created in slice 1 (file 23), the workflow in slice 1 (file 24), and the allow-list shrink is an explicit, counted task in slices 2 (−21), 3 (−4), 4 (−7 R1 / −7 R2), 5 (−1 R6) and 7 (−2 R4). Task 1.5 — *"confirm the guard is **red** before any route is gated (a guard that has never failed has never been tested)"* — is the detail that tells me this was understood rather than copied. |
| **RC-10** (pages guard) | ✅ | **Discharged, and improved on.** The AdminChrome split is the approved shape; E1/E2/E3 are carried into a docstring *and* the PR body (task 5.12); the `redirect()`-outside-`try/catch` trap is called out; and the **ADMIN-CANARY full-page-load test** (task 5.8) is a better proof of inheritance than anything I specified — it tests the property empirically instead of trusting a framework guarantee. Keep it. |
| **RC-5** (DB divergence) | ✅ | **Discharged in substance.** The one-source/two-mechanisms framing, the four-row divergence table, and the written invariant ("an admin who exists only in `ADMIN_EMAILS` … passes every app-code check and fails every RLS policy") are all present and correct. |
| **RC-4, RC-5, RC-7, RC-10, RC-13, RC-14** | ✅ | ⚠️ **Systematically half-done — see W-2.** These six instruct amendments to the **requirement document** (FR-5 rewording, FR-7 amendment, FR-10 widening, new FR-15/16/17, DoD database row, BQ section). The plan honours their intent but never amends the requirement, which is the artefact QA tests against. Marked ✅ in the matrix; it is ✅ *for the plan* and ⬜ *for the contract*. |

---

### 2. The three escalated decisions

#### 2(a) — `.env.example`. **DECISION: drop it. Docs-only.**

Dev is right that RC-1(b) is not literally implementable: **verified** — `.gitignore` carries a blanket `.env*` under a "# env files" heading, and no `.env.example` exists.

I am **amending RC-1(b), which I authored.** Do not create the file and do not add the negation.

**Why.** RC-1(b)'s purpose was one thing: make `ADMIN_EMAILS` discoverable so an environment cannot silently lack it. `docs/VERCEL_ENV_SETUP.md` **already exists** and is this repo's actual env documentation — that row serves the purpose completely. Against that, the proposal asks to **loosen a blanket secrets-ignore rule on a public repository** which, per the project's own tracked P0, has already had a live Supabase `service_role` key committed to it. Dev's negation form (`!.env.example`, an exact filename) is the *safe* form and I have no specific objection to it — but it opens a class: the next person writes `!.env.local.example` or `!.env.*`, or names a real environment file `.env.example`, and the blanket rule that would have caught it is no longer blanket. Introducing that class as a side effect of an admin-authz sweep, to document **one variable that is already documented elsewhere**, is not a trade I will approve.

There is also a better mechanism already in the plan: **slice 0's P-1 per-environment verification** is what actually prevents the lockout. A template file only ever documented it.

**Consequence:** Slice 0 drops two files (now 2 + this workplan). Tasks 0.5 and 0.10 are deleted; **P-2 is deleted**. `ADMIN_EMAILS` keeps its `docs/VERCEL_ENV_SETUP.md` row (task 0.6), which must state the format, which environments need it, and the "app-side only, invisible to RLS" divergence. **OI-8 is closed, not tracked.**

#### 2(b) — Slice 3's replacement read path. **DECISION: replace the mirror with a projection.**

Dev's instinct to flag this was correct, and the drift risk is real — but the mirror must not ship, for a reason stronger than drift.

**The mirror is F1.** `system_settings_config.admin_users` vs the `admin_users` table — a second store holding a copy of a fact that already has a store, with nothing keeping them in sync — is precisely the bug **slice 7 of this same programme deletes**. Shipping that shape in slice 3 and deleting it in slice 7 is incoherent, and slice 8 would have to write a permanent drift caveat into the document whose whole job is to stop people believing false things about this system.

**And the duplication already exists and is already drifting.** I verified: `agent_sharing_reward_amount` is a `system_settings_config` key read by `app/v2/agents/[id]/page.tsx:359,393`, while the amount also lives on the `reward_config` row the admin screen edits. **Nothing syncs them.** A mirrored boolean does not avoid a new bug; it extends a live one.

**Approved shape — a narrow read-only projection:**

| | |
|---|---|
| **What** | One purpose-built customer-readable read that returns only the customer-entitled reward facts for `agent_sharing` — at minimum `{ isActive }`. It reads `reward_config` server-side and projects. |
| **Source of truth** | `reward_config`, unchanged. **One store. No mirror, no drift, no write-side effect, no migration.** |
| **Repository** | The read goes through `lib/repositories/` (CLAUDE.md mandatory rule 1 — and the standing "enforce repository pattern in review" preference). A minimal read method is acceptable; this is the *correct* direction of travel for OI-5, not an exception to it. |
| **Not approved** | `supabase/migrations/20260920b_seed_agent_sharing_reward_active.sql`. Not needed under this shape — **task 3.3's migration-approval question is moot and the task is deleted.** No migration ships in this programme. |
| **Scope discipline** | Project **only** the boolean. Do **not** fold in the amount to "fix" the existing drift — that changes what a customer sees and is outside BQ-1. Record it as **OI-14** instead. |

**On "no new endpoint, no new pattern".** That was my wording in the BQ-1 resolution and Dev applied it faithfully. I am amending it: it was aimed at preventing a *new customer-facing reward feature*, not at forcing a second store. A single-purpose read route is the repo's **standard** route pattern — it is not a new one. Dev's rejection of the `/api/system-config` read-through stands (domain leakage), and now has a second reason — see N-4 below.

**Everything else in slice 3 is approved as written**, including the one-commit rule (task 3.12), the `.catch(() => …)` error-path preservation test, and removing the admin fetch from the v2 `Promise.all` (net one fewer request).

#### 2(c) — Merge order. **CONFIRMED: 7 before 6.**

Verified: R4's two allow-list entries are `app/admin/settings/page.tsx` and `app/api/admin/settings/admin-users/route.ts`, and **both are files slice 7 deletes**. Slice 6's "allow-list empty" is therefore unreachable in numeric order. Dev's reasoning is correct and the deviation is approved.

**The binding merge order:**

> **0 → 1 → 1L → 2 → 2L → 3 → 4 → 5 → 7 → 6 → 8**

Two constraints that make it binding, both already respected by the plan: slice 6 must be last-but-one because it empties allow-lists that slices 5 and 7 are the last to make emptiable; and **slice 8 must follow slice 6**, because slice 8 records the required-status-check enablement date, which does not exist until slice 6 is done.

**Permitted variation:** slice 7 may move earlier, to immediately after 1L. That closes R4 sooner and removes the "slice 1 is gating a lie" oddity. It is not required — slice 7 deletes a screen and is a user-visible change, so keeping it late is the more conservative choice. Dev's call; state which in the PR.

---

### 3. Dev's three findings — all verified REAL

| # | Verdict | Evidence |
|---|---|---|
| **N-1** | ✅ **Confirmed, and it is as bad as stated.** | `app/api/admin/settings/admin-users/route.ts` — the `GET` handler reads `system_settings_config`, and when the list is empty it reads `profiles`, then **`supabaseServer.from('system_settings_config').upsert({ key: 'admin_users', value: [{ user_id: <caller>, role: 'super_admin', added_by: 'system_bootstrap' }] })`** at lines ~57-68, with the service role. Any signed-in customer who is first through the door writes themselves in as `super_admin` **through a GET**. It grants nothing (nothing reads that key for access), so it is not a live escalation — but it is an unauthenticated-in-effect service-role write behind a verb nobody audits. **Moving it to slice 1 is correct.** |
| **N-2** | ✅ **Confirmed in substance; count is 6, not 5.** | Corrected inline above. `page.tsx:322,447,457,461` + `route.ts:196,197` → **now `route.ts:210,211`; see D-Q4**. Line 211 (was 197) sits inside `.filter(a => a.role === 'super_admin')` — R4's `.some(`/`.filter(` clause must catch it, or the allow-list is under-counted. All six are in the two files slice 7 deletes; none reads `profiles`. The "R4 ships red-by-allow-list and slice 7 empties it" mechanic is right. |
| **N-3** | ✅ **Confirmed** — `.gitignore` has a blanket `.env*`; no `.env.example` exists; `docs/VERCEL_ENV_SETUP.md` does. **But the proposed remedy is rejected** — see 2(a). The finding was worth raising; the fix is docs-only. |

#### N-4 — a fourth finding, from this review

**`GET /api/system-config` is unauthenticated, service-role-backed, and accepts arbitrary `keys` and `category`.** Verified: the route has no `getUser()` and no gate, and `SystemConfigRepository` is constructed from `supabaseServer` (`lib/repositories/SystemConfigRepository.ts:5`), so **RLS does not apply**. Anyone on the internet can enumerate and read any `system_settings_config` row.

RLS-level read-openness on that table is a deliberate, documented decision (`20260920a_…sql` — the browser theme provider reads `v2_custom_tokens`). A **service-role route with a caller-supplied key/category parameter** is a broader thing than that decision covers.

It is **not a blocker and not in scope** — it predates this programme and closing it needs its own caller analysis. But it is directly load-bearing here: it is the **second reason** slice 3 must not put the reward flag behind that route, and it would have made Dev's original `category: 'rewards'` design leak every future rewards key to anonymous callers. **Record as OI-15** (W-6).

---

### 4. Slice integrity

| Slice | Independently shippable? | Deploy-safety note holds? |
|---|---|---|
| **0** | ✅ | ✅ — and "the one slice that is safe to merge in isolation forever" is exactly right. Shrinks to 2 files after 2(a). |
| **1** | ✅ | ⚠️ Correct in substance; the **expected-fallout table is wrong** and contradicts its own footnote — see W-4. |
| **1L** | ✅ | ✅ — and using slice 1's behavioural test **unchanged** as the regression oracle (task 1L.4) is the right way to prove a logging-only diff. |
| **2** | ✅ | ✅ — task 2.6 (*"`git diff --stat` must not list the four ⚠️ files"*) is the mechanical proof that slice 2 cannot break a customer screen. Good. |
| **2L** | ✅ | ✅ — the "no `@` in any captured log argument" assertion is the right shape for FR-6. |
| **3** | ✅ **after W-3** | ✅ — one-commit rule is correctly treated as the design, not a note. |
| **4** | ✅ | ✅ — "if the 5 existing test files need edits, the refactor changed behaviour; **stop and explain rather than editing the test**" (task 4.4) is the correct instinct and should survive review pressure. |
| **5** | ✅ | ⚠️ Holds, but the identical-response test is under-specified — see W-5. |
| **6** | ⚠️ only after 7 | ✅ — and the distinction between "red tick" and "merge actually blocked" (task 6.7) is the only test that proves G3. Keep it. |
| **7** | ✅ | ✅ — including the honest note that `system_settings_config.admin_users` is left orphaned (OI-7) rather than quietly deleted. |
| **8** | ✅ | ✅ |

**On slice 3 specifically** (the stranding risk I flagged): **designed out correctly.** The gate and the replacement read path are one commit (task 3.12), and the "if this slice is delayed indefinitely" paragraph is honest about what stays open. Under W-3's projection shape the risk is lower still, because there is no migration to sequence and no mirror to backfill.

**On 1L/2L** (my BQ-6 amendment): **correctly separated.** They sit *immediately* after the slices that touched the files, not at the end; they carry a before/after `grep -c` as the scope proof; and 1L.3 does the right thing with `reward-config` — **deleting** the request-URL and payload logs rather than faithfully converting them. That is the privacy item handled as a privacy item.

---

### 5. Completeness — the census adds up exactly

Recomputed independently from the plan's own path lists:

| Set | Count | Where |
|---|---|---|
| D1 writes | 16 | slice 1 |
| D2 actions | 5 | slice 1 |
| Category C `settings/admin-users` | 1 | slice 1 (N-1) |
| **Slice 1 route files** | **22** | |
| D3 cross-tenant reads | 11 | slice 2 |
| Category C `settings/platform-users` | 1 | slice 2 |
| D4 non-⚠️ GETs | 9 | slice 2 — **all 9 on files already counted in slice 1** (7 from D1 + `backfill-embeddings`, `memory-consolidation` from D2) |
| **Slice 2 new route files** | **12** | running total **34** |
| ⚠️ catalogue GETs | 4 | slice 3 — **all 4 on slice-1 files** (`reward-config`, `boost-packs`, `execution-tiers`, `storage-tiers`); 0 new |
| Category B inline copies | 7 | slice 4 → running total **41** |
| Category A already correct | 3 | untouched |
| **Total** | **44** ✅ | |

- **32 anonymous routes:** D1 16 + D2 5 + D3 11 = **32** ✅. D4's 13 GETs (9 + 4) sit on files already inside those 32 ✅.
- **7 inline copies:** all 7 in slice 4 ✅. **2 auth-only:** one in slice 1, one in slice 2 ✅.
- **21 pages:** slice 5, and **none of the 21 `page.tsx` files is edited** — correct, and a diff that touched them would be the wrong shape.
- **Nothing double-counted as a revert:** the nine verb-split files are named explicitly in *Files edited in more than one slice*, and R-8 in the risk table anticipates the reviewer reaction. This is handled better than I asked for.

End state: 42 route files gated, 2 deleted by slice 7, 44 accounted for. Slice 8's 44-row table (task 8.3) closes it.

---

### 6. Soundness — two things that would bite

#### 6(a) The BQ-3 identical-response test will fail for a reason that is not a security defect

The plan asserts anonymous and signed-in-non-admin get the same status, `Location` and body. At the **layout** that is true — both hit `redirect('/business-os')`.

But `middleware.ts` runs **before** the layout, and `/admin` is deliberately *not* on its skip list. So a signed-in non-admin **who has not completed onboarding** is redirected by middleware to `/onboarding-chat` and never reaches the guard, while an anonymous visitor (no auth cookies) falls through middleware and gets `/business-os`.

**This is not a disclosure** — that user gets `/onboarding-chat` for *every* protected path, so it reveals nothing about `/admin`. But the test as specified compares "anonymous vs signed-in non-admin" and will go red on an un-onboarded fixture, and the likely reaction to a red security test is to weaken it. **W-5:** specify the fixture as an **onboarded** signed-in non-admin, and document the middleware interaction next to the test so nobody rediscovers it as a bug.

One related note worth writing down: `app/business-os/layout.tsx` does **no server-side auth** — it wraps children in a client `UserProvider`. So an anonymous visitor redirected from `/admin` briefly renders the Business OS shell before client auth moves them on. No loop, no admin content, no disclosure — but task 5.9's redirect-loop check should record that observed behaviour rather than assume a server redirect.

#### 6(b) Does the CI gate actually fail on a new admin route? **Yes — with one unstated assumption**

The two obstacles I found are both designed around correctly: its **own** workflow (because neither existing workflow runs `npm test`) and **no `paths:` filter** (because a new file under `app/api/admin/` matches none of `plugin-tests.yml`'s filters). Task 6.7's "throwaway PR must be **blocked**, not merely red" is the only thing that proves the required-status-check half, and slice 6 is correctly not-Done without it. The note that a required check is matched **by job name**, so renaming the job silently un-gates the repo, is a good catch.

The unstated assumption: **R1 scans for exported handlers.** I verified that **all 44** current admin route files use `export async function GET|POST|…`. A handler written `export const GET = async (req) => {…}` — valid Next.js, used elsewhere in the ecosystem — would match a naive scan and pass ungated. **W-7:** R1 must recognise both forms, with a unit test for the `export const` form, and must fail closed (flag the file) on a `route.ts` under `app/api/admin/**` whose handler exports it cannot parse. A shape guard that silently skips what it cannot understand is the failure mode that matters.

---

### Required changes

1. **W-1 — Drop `.env.example` and the `.gitignore` negation** (decision 2(a)). Slice 0 becomes 2 files + this workplan; delete tasks 0.5 and 0.10 and verification **P-2**; keep the `docs/VERCEL_ENV_SETUP.md` row with format, environments, and the "app-side only, invisible to RLS" note. Close **OI-8**.
2. **W-2 — Add a slice-0 task that amends the requirement document** to carry RC-4 (FR-10 widened), RC-5 (new FR-15/16/17 + rewritten DoD database row), RC-7 (FR-5 reworded to bound *handler* work), RC-10 (FR-7 amended to defence-in-depth), RC-13 (DoD names the service-role/repository gap) and RC-14 (BQ section reworked to settled). **Before slice 1 starts.** The requirement is what QA tests against; today it still contradicts this plan.
3. **W-3 — Reshape slice 3 to the projection** (decision 2(b)): delete file row 1 (the migration) and task 3.3; change row 2 to *gate the `GET` only* — no mirror write — and delete task 3.4; rewrite rows 6-7 and tasks 3.6-3.7 to read the projection; route the read through `lib/repositories/`; project the **boolean only**. Add **OI-14**: the pre-existing `agent_sharing_reward_amount` duplication between `system_settings_config` and `reward_config`, unsynced, read live by `app/v2/agents/[id]/page.tsx:393`.
4. **W-4 — Correct slice 1's expected-fallout table.** Both scripts issue a bare `fetch` (a `GET`); `ais-config`'s `GET` is not gated until slice 2. Change the column to "unchanged at slice 1; 401 from slice 2" and delete the contradicting footnote.
5. **W-5 — Specify the BQ-3 identical-response fixture as an *onboarded* signed-in non-admin**, and document the middleware onboarding-redirect interaction (§6(a)) beside the test. Task 5.9 records `/business-os`'s observed client-side auth behaviour rather than assuming a server redirect.
6. **W-6 — Record N-4 as OI-15**: `GET /api/system-config` is unauthenticated, service-role-backed and takes arbitrary `keys`/`category`, so it reads any `system_settings_config` row bypassing RLS. Out of scope; tracked; cited in slice 3's rationale.
7. **W-7 — R1 must recognise both handler export forms** (`export async function GET` and `export const GET = …`), with a unit test for the second, and must **fail closed** on a `route.ts` under `app/api/admin/**` whose exports it cannot parse.
8. **W-8 — Correct N-2's count to 6** and confirm R4's `.filter(`/`.some(` clause catches `app/api/admin/settings/admin-users/route.ts:197`.
9. **W-9 — Record the binding merge order** `0 → 1 → 1L → 2 → 2L → 3 → 4 → 5 → 7 → 6 → 8` in the Slice Index, with the two constraints (7 before 6; 8 after 6) stated. Note slice 7's permitted earlier position after 1L, and say which was chosen.
10. **W-10 — R4 false-positive check against organisation roles.** `lib/repositories/OrganizationRepository.ts:279` selects `role` from `organization_members`, a different and legitimate role concept. No current comparison against an admin-ish literal exists, so R4 should be silent — verify, and if it fires, allow-list with the reason rather than narrowing the rule.

### Approval

- [x] Workplan **approved with changes** — fold in W-1 … W-10, then begin slice 0
- [ ] Slice 0 complete, including W-2's requirement amendments, before slice 1 starts
- [ ] No migration ships in this programme (W-3)

---

---

## SA Code Review — Slice 0 + 1

**Reviewed by SA — 2026-09-20**
**Status:** 🔄 Fix Required → **APPROVED WITH CHANGES**
**Scope:** 24 modified + 5 new files, uncommitted (374 insertions / 19 deletions).

Every claim was re-derived from the code rather than read from the plan. **All seven of Dev's claims are true.** Five defects are recorded below, all in the guard's parser, all latent (nothing in the repo triggers them today) — but the guard is the mechanism that makes "cannot recur" true, and three of the five fail on *future* code in the **permissive** direction. D-1 must be fixed before this merges.

### Verification of Dev's claims

| # | Claim | SA verification |
|---|---|---|
| 1 | 30 handlers gated, gate first in each | ✅ **Independently reproduced.** I parsed all 22 modified files and extracted every handler body: **43 handlers, 30 gated**. The 13 ungated are exactly the 9 D4 GETs + 4 ⚠️ catalogue GETs deferred to slices 2/3. In **zero** handlers does `request.json()`, `req.json()`, `.from(`, `searchParams` or `new URL(` appear before `requireAdmin(`. |
| 2 | Oracle: 4 denial cases + empty `mockTablesTouched`, 153 passing | ✅ **Ran it: 153/153.** 30 cases × 5 + 3 standalone. `mockTablesTouched` is asserted `[]` on all four denials, and the Proxy-based fake client records `from`, `rpc` **and** `auth.admin.listUsers`, plus service-level touches (`SystemConfigService`, `EmbeddingService`). A route that 403s after running its query does fail. |
| 3 | Guard red before (33 offenders), green after (39/39), 5 breakages named | ✅ **Ran it: 39/39.** The before-state is not independently re-derivable from the working tree, but the allow-list's 35 R1 entries reconcile exactly with the census (below), which is the same evidence. |
| 4 | W-7 discharged — both export forms, fails closed | ⚠️ **Partly.** Both forms are recognised and `export { … }` / `export *` are flagged. But the fail-closed promise has a hole — **D-1**. |
| 5 | W-8 — N-2 corrected to 6, `.filter(` in R4, explicit test | ✅ Allow-list reason states 4 + 2 = 6 with line numbers; `ROLE_COMPARISON` matches the `.filter(a => a.role === 'super_admin')` shape; the test names `admin-users/route.ts` explicitly. *(**D-Q4**: the cited coordinates 196,197 are now **210,211** — slice 1's gate insertion moved them. Corrected in the guard, in N-2 and here.)* |
| 6 | Zero `console.*` touched | ✅ **Verified mechanically** — no added or removed line in the entire diff contains `console.`. Slice 1L's oracle stays honest. |
| 7 | No behaviour change beyond the gate | ✅ **Verified: all 19 deletions accounted for** — 2 TODO comment lines (`ais-config`), the `NextResponse`-only import and `POST()` signature in `migrate-labels`, the `getUser` import, and the two 6-line `getUser`/401 blocks in `settings/admin-users`. **Zero success-path logic removed.** ts-jest typechecks by default and both suites pass, so all 22 files also typecheck. |

**Census reconciliation.** R1's allow-list holds 35 entries: 24 slice-2 (15 cross-tenant/auth-only + 9 D4 GETs) + 4 slice-3 + 7 slice-4. Added to slice 1's 30 gated handlers and the 3 category-A routes already on the gate, every handler in the 44-file census is either gated or carries a dated, reasoned exemption naming the slice that removes it. **Nothing is allow-listed that slice 1 should have gated.**

---

### Defects

> **D-1 — HIGH — an ungated admin route can pass R1 silently.**
> `lib/admin/__tests__/admin-authz-surface.guard.test.ts:369-388` (`extractBracedBody`), reached via `findValueParen:396-402`.
>
> `extractBracedBody` takes the **first `{` after the parameter list** as the body. For a handler wrapped in a higher-order function, the parameter list it matches is the *wrapper's* — so the `{` it then finds belongs to whatever comes next in the file.
>
> **Reproduced.** Input:
> ```
> export const GET = withAuth(async (req) => { return 1; });
> function unrelated() { const g = requireAdmin(l); return 2; }
> ```
> Output: `handlers: [{ name: 'GET', body: '{ const g = requireAdmin(l); return 2; }' }]`, `unparseable: []`.
>
> The guard attributes an **unrelated function's body** to `GET`, sees `requireAdmin(` in it, and reports the route as gated. The real handler has no gate. Both safety nets fail at once: R1 passes, and the fail-closed rule at :746 has nothing to flag. HOC-wrapped route handlers are an ordinary Next.js pattern.
>
> **Fix direction (do not merge without it):** after `matchParen` returns, require that the next meaningful token is either `{` (function form) or `=>` followed by `{` (arrow form). Anything else — `;`, `)`, `,`, an identifier — means those parens were not the handler's parameter list, and the handler must go to `unparseable`, not to `handlers`. Add the fixture above as a regression test asserting `handlers` is empty and `unparseable` names `GET`.

> **D-2 — MEDIUM — the guard cries wolf on a correctly-gated handler with a braced return type.**
> Same function, `:375` (`scaffold.indexOf('{', afterParams)`).
>
> **Reproduced.** `export async function POST(req: NextRequest): Promise<{ ok: boolean }> { const gate = await requireAdmin(l); … }` → body extracted as `{ ok: boolean }` → reported **ungated** though it is gated.
>
> This is the **same family as the `{ params }` bug Dev just fixed**, one position later: paren-matching skipped the parameter list, but nothing skips the return-type annotation. The docstring at :351-368 presents that family as closed; it is not. A false positive is the safe direction, but Dev's own reasoning applies verbatim — *"a guard that cries wolf on correct code is a guard someone switches off"*.
>
> **Fix direction:** the D-1 fix subsumes this if the "next meaningful token" scan skips a `:`-introduced type annotation before expecting `{`. Add this fixture as a regression test too.

> **D-3 — MEDIUM — a trailing `//` comment containing `/*` silently deletes the code after it.**
> `lib/admin/__tests__/admin-authz-surface.guard.test.ts:308-310` (`stripComments`).
>
> The line-comment pass is anchored to the start of a line (`/^[ \t]*\/\/.*$/gm`), so it removes only comments that occupy a **whole line**. A trailing comment survives into the block-comment pass, and if it contains `/*` that pass matches from there to the next `*/` anywhere later in the file.
>
> **Reproduced.** Input:
> ```
> const a = 1; // glob note: /*.ts files
> if (p.role === 'admin') { grantEverything(); }
> /** docblock */
> const b = 2;
> ```
> Output: `"const a = 1; // glob note: \nconst b = 2;"` — **the access decision was deleted.** R2 and R4 scan comment-stripped code, so a violation in that window becomes invisible. Silent, and in the permissive direction.
>
> This is precisely the bug class the docstring at :293-307 claims to design against; "line comments first" only covers whole-line comments, and the unit test at :574 uses a whole-line comment, so it does not pin this case.
>
> **Fix direction:** strip line comments wherever they start, not only at line start — while not treating `//` inside a string literal as a comment (`blankStringLiterals` already exists and can front this). Add the fixture above as a regression test asserting the `role === 'admin'` line survives.

> **D-4 — LOW — route files the scan never opens.**
> `:492` (`walk(..., /\.(ts|tsx)$/)`) and `:503` (`endsWith('/route.ts')`).
>
> Next.js accepts `route.js|jsx|ts|tsx`. `ROUTE_FILES` matches only `/route.ts`, so a handler in `route.tsx` escapes **R1, R2 and R3 entirely**, and a `route.js` is never read at all. None exists in the repo today (verified), so this is latent — but "we only scan the extension people currently use" is the same shape as "we only scan the paths we already know about", which this guard's own header rejects.
>
> **Fix direction:** match `/route\.(ts|tsx|js|jsx|mts|cts)$/`, and add those extensions to `walk`.

> **D-5 — LOW (strengthening) — R1 proves presence, not precedence.**
> `:733` (`if (!h.body.includes('requireAdmin('))`).
>
> R1 passes any handler that mentions `requireAdmin(` **anywhere** in its body. A handler that parses the body, runs its query and *then* gates would satisfy it. Today all 30 are correctly first — I verified this independently — and the oracle catches ordering, but **only for the 22 files it enumerates**. Route #45 gets R1 and no oracle, so precedence would be unproven exactly where the guard is the only check.
>
> **Fix direction:** in R1, also require that the index of `requireAdmin(` precedes the first index of `.json()`, `.from(`, `.rpc(`, `searchParams` and `new URL(` within the body. This is the check I ran by hand; making it the guard's makes FR-5 machine-enforced for every future route.

---

### Specifically scrutinised

**The parser fix (the `{ params }` defect).** The fix itself is **sound and correctly pinned.** `matchParen:339-349` walks the parameter list to its matching `)` before any brace search — the right primitive — and it runs against `blankStringLiterals` output, so a brace inside a string cannot derail it. Four regression tests hold it: :669 (function form), :695 (`export const` form), :663 (brace in a string), and — the one that matters most — **:712, which asserts against the real on-disk `app/api/admin/messages/[id]/route.ts`**, requiring exactly `['DELETE','PATCH']` and that both bodies contain the gate. That last test is what stops the fix rotting. Finding this on the guard's second run against real files, and treating a false positive as a real defect rather than acceptable conservatism, is the right instinct — D-1 and D-2 are that same instinct applied one step further.

**E-4 (the three `HEAD` handlers).** ✅ **Real and correctly handled.** `app/api/admin/users/route.ts:141`, `dashboard/route.ts:259` and `token-usage/route.ts:195` each declare `export async function HEAD()` returning `new NextResponse(null, { status: 200 })`. The original census grepped five verbs and never saw them. All three are allow-listed individually, dated, with a reason that states the actual harm (they confirm route existence to an anonymous prober, which NFR-Security forbids of a denial) rather than a generic note. **`HTTP_HANDLERS` at :80 includes `HEAD` and `OPTIONS`, and the R1 loop iterates whatever `scanHandlers` returns — so a new HEAD handler is caught, not skipped.** This is the guard doing its job on its first run, and it is the strongest single argument in the programme for scanning by shape.

**`settings/admin-users` (N-1).** ✅ The `GET` now opens with `requireAdmin` and returns the gate response before anything else; the service-role bootstrap upsert that writes the caller in as `super_admin` sits below it and is unreachable by a non-admin. The `getUser`/401 block is gone, so there is no second, weaker path. The file-level comment stating the route is *scheduled for deletion* and that gating it **does not make it work** is exactly the right disclosure for a reviewer.

**The CI workflow.** ✅ Runs `npm run test:authz-guard`; `package.json` defines that script as `jest lib/admin/__tests__/admin-authz-surface.guard.test.ts --ci` — they match. **No `paths:` filter**, `pull_request: branches: [main]`, `permissions: contents: read`, concurrency group, Node 18, `npm ci`. The header explains the no-filter choice and carries the job-name warning. **For the record, and this is not a criticism of the diff: it is not a build gate yet.** Until the repo owner enables `Admin authz surface guard` as a required status check on `main` (slice 6), an unguarded admin route can still be merged with a red tick beside it. The workflow says so itself.

**The allow-list mechanic.** ✅ Every entry carries a dated reason naming the slice that removes it, and two structural assertions protect it: `:549` (every allow-listed file must still exist — a stale exemption cannot outlive its subject) and `:558` (every entry must carry a reason of real length). The R2 entry for `calibrate/batch` is the model for a *permanent* exception: it explains why `requireAdmin` is the wrong tool there (a capability flag; there is no 401/403 to return) rather than merely asserting an exception.

One item reviewers should see rather than skim: `user-emails/route.ts#POST` remains anonymous until slice 2. It is a **read shaped as a POST**, classified that way since the BA's census, and its allow-list reason says so — so a slice titled "stop anonymous writes" correctly leaves an anonymous POST open. That is the approved plan, not an oversight, but it means email addresses stay anonymously readable until slice 2 merges.

**Fail-closed.** ✅ Proven per handler, not asserted: `isAdmin` rejecting ⇒ **403**, `getUser` rejecting ⇒ **401**, never 500, with `mockTablesTouched` empty in both. That is what keeps `AdminCalibrationTrigger`'s self-gating working (F3). The "denials leak nothing" test additionally asserts no `@` in any captured log argument and that the anonymous and non-admin denial bodies have identical key sets.

---

### Rulings

**(a) Keep `boost-packs` / `execution-tiers` / `storage-tiers` in slice 3 — CONFIRMED.**
Slice 2's reviewability rests on a **mechanical** property: task 2.6, "`git diff --stat` must not list these files". Moving three files in on the strength of an enumeration swaps a check a reviewer can run for a judgement they must trust — and enumerations are the kind of thing that are right almost always. The cost of waiting is that three plan/pricing catalogues stay anonymously readable for one more slice; they are the least sensitive thing in the entire census. Cheap insurance, correct instinct. The enumeration result is not lost — it is recorded in each allow-list reason.

**(b) Slice 7 stays late — CONFIRMED.** I offered the earlier position as permitted, never required. Slice 7 deletes a user-visible screen; keeping it after the guard-and-pages work is the more conservative sequencing, and R4's two entries are fully dated and justified in the meantime. No objection.

**(c) The `node_modules` junction — ACCEPTABLE.** Verified: it links to the primary repo's `node_modules`, `.gitignore:4:/node_modules` ignores it, and `git status --porcelain` shows no trace — the 29 entries are exactly the intended files. One caveat for the record, not a blocker: the worktree therefore tests against the *primary* repo's installed dependencies, so if the two dependency sets ever diverge, local results stop being authoritative. This diff adds a script and no dependency, so it is moot here, and CI's `npm ci` from the lockfile is the authority regardless.

---

### Open issues

**OI-16 — `/api/admin/messages/{id}/reply` does not exist. ✅ Real; STAYS TRACKED, with a warning attached.**
Verified: `app/admin/messages/page.tsx:152` fetches `.../reply`; the directory is `replay`. The admin reply button 404s today and did before this programme. It is a broken feature, not an authz defect, and does not belong in a security sweep.
**But the obvious fix is dangerous, and OI-16 must say so.** Repointing the page at `replay` would wire an admin button to a handler whose job is **re-sending a platform communication to a real recipient** — a different action from replying. Whoever picks this up must build or identify a real reply path, not correct the spelling.

**OI-17 — five anonymous reads with no in-repo caller. ✅ Real; STAYS TRACKED, and must NOT become a deletion in this programme.**
Two reasons. First, deleting a route is a behaviour change, and a security sweep is the wrong vehicle for one — the same argument that made slice 7 a separate, user-decided slice. Second, "no in-repo caller" is exactly the claim **BQ-5 exists to qualify**: an ops script or uptime monitor outside the repository is structurally invisible to the sweep, and `dashboard` / `execution-stats` / `token-usage` are precisely the shape of thing something polls. **Gate them in slice 2 as planned;** revisit deletion afterwards with the BQ-5 answer in hand. Good practice already visible: two of the five carry "No in-repo caller (OI-17)" inside their allow-list reason, so the observation travels with the code.

---

### Optimisation suggestions (non-blocking)

- `app/api/admin/__tests__/adminGate.writes.test.ts` — the admin happy path asserts `expect([401, 403]).not.toContain(res.status)`, which also passes on a 500. Where a handler reaches data access before validating, additionally asserting `mockTablesTouched` is **non-empty** for the admin case would prove the handler actually ran, not merely that the gate did not deny. Per-case, since several handlers validate the body first.
- Several files place `const logger = createLogger(...)` immediately above an existing `const supabase = …` or `export const dynamic` with no blank line (`agent-generation-config`, `boost-packs`, `execution-tiers`, `memory-consolidation`, `ais-weights/*`). Cosmetic only.
- `docs/VERCEL_ENV_SETUP.md` — the new section is genuinely good (it states the consequence — *"an admin who relies on `ADMIN_EMAILS` permanently is half an admin"* — not just the setting). Consider linking it from slice 0's P-1 checklist so the verifier lands on the SQL rather than searching for it.

---

### Would I let this deploy to production with P-1 unverified?

**No. Plainly: no.**

Slice 0's P-1 is a **blocking abort condition**, not a checklist item, and this is the exact scenario it was written for. This diff makes 30 handlers deny whenever `AdminAccessService.isAdmin()` returns false. If neither the `admin_users` seed nor `ADMIN_EMAILS` resolves the owner in the target environment, **every admin write returns 403 to everyone, including the owner** — and `docs/VERCEL_ENV_SETUP.md`, in this very diff, explains why that can silently be true in one environment and not another.

It is recoverable (the owner has Supabase access) and it is not a customer-facing outage, so this is not alarmism. It is that the verification is a single read-only query — `SELECT email, user_id, is_active FROM admin_users;` — plus one glance at Vercel's environment variables. There is no argument for shipping without it.

**Therefore:** commit, open the PR, let the new workflow run — all fine and encouraged. **Do not deploy to any environment until P-1 is recorded for that environment**, and re-confirm it immediately before slices 5 and 7, per the workplan's own R-1.

---

### Code Review Comments

| # | Location | Issue | Priority |
|---|---|---|---|
| 1 | `lib/admin/__tests__/admin-authz-surface.guard.test.ts:369-388, 396-402` | **D-1** — HOC-wrapped handler mis-parsed; an ungated route passes R1 and is not flagged. **Blocking.** | **High** |
| 2 | `lib/admin/__tests__/admin-authz-surface.guard.test.ts:375` | **D-2** — braced return-type annotation mis-parsed; a gated handler reported ungated. | Medium |
| 3 | `lib/admin/__tests__/admin-authz-surface.guard.test.ts:308-310` | **D-3** — trailing `//` comment containing `/*` swallows code; R2/R4 lose that window silently. | Medium |
| 4 | `lib/admin/__tests__/admin-authz-surface.guard.test.ts:492, 503` | **D-4** — `route.tsx` / `route.js` never scanned. | Low |
| 5 | `lib/admin/__tests__/admin-authz-surface.guard.test.ts:733` | **D-5** — R1 proves gate presence, not precedence; make FR-5 machine-enforced. | Low |

### Code Approved for QA: **Yes, after D-1.**

D-1 must be fixed and its regression test added before this merges — it is the one defect that lets the hole this programme exists to close reappear through the guard itself. D-2 and D-3 should land in the same commit (same file, same family, and D-2 shares D-1's fix). D-4 and D-5 may be folded into slice 6's final pass, recorded here so they are not lost. **The 22 route files and the oracle are approved as they stand — no changes required to any application code.**

---

## QA Testing Report

**Slice 0 + 1 — see [QA Report — Slice 0 + 1](#qa-report--slice-0--1) at the end of this document (QA, 2026-09-20): PASS WITH ISSUES.** Application code clean; 3 new latent guard defects (D-Q1/D-Q2/D-Q3) + 2 documentation defects (D-Q4/D-Q5). Later slices append here.

---

## Commit Info

*(RM will populate this section.)*

Branch: `feature/admin-authz-unification` (created by RM off `origin/main` @ `0d7544c0`). Dev never commits and never merges.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-20 | **QA — slices 0 + 1** (QA) | **PASS WITH ISSUES.** Re-derived rather than trusted: an independently written parser confirms **43 handlers / 30 gated / 13 deferred GETs** across the 22 files with **zero** body-parse, query, `searchParams` or `new URL(` before `requireAdmin(`; the 44-file census reconciles to **72 handlers = 37 gated + 35 allow-listed**, set-equal in both directions, no stale or missing entry. Suites re-run: guard **51/51**, oracle **153/153** (**204** together), admin surface **336/336** across 12 suites — and the 10 pre-existing admin suites import **none** of the 22 modified files, so they could not have caught a regression either way. Repo-wide `npx jest` shows 129 pre-existing failures, all in V6/pilot/orchestration/website-builder/featureFlags, none importing a modified file. **Oracle proven able to fail:** injecting a pre-gate `.from()` read into `system-limits` turned all four denial cases red (4 failed / 149 passed), reverted byte-identical — while the **guard stayed 51/51 green**, which is D-5 demonstrated live. **Guard attacked with 13 hostile fixtures**; D-1/D-2/D-3 fixes all hold (HOC wrapper, braced return type, trailing-comment stripper), `export { GET } from`, `export *`, bare re-export, expression-bodied arrow and odd whitespace all land in `unparseable` or R1, a **new `HEAD`/`OPTIONS` handler is caught**, and R2–R5 each fired on a fresh probe. **Three new latent defects, all in the guard, all permissive-direction:** **D-Q1** R1 accepts a `requireAdmin(` occurring only inside a string literal; **D-Q2** R1 accepts a `requireAdmin(` mentioned in a never-invoked closure — **not closed by D-5's recorded fix**, so slice 6 must scope it in; **D-Q3** an unrecognised handler shape is silently skipped whenever the file also has one parseable handler, because the zero-handler net only fires when the file yields nothing. Plus **D-Q4** (the R4 allow-list reason cites `admin-users/route.ts:196,197`; this diff moved them to **210, 211**) and **D-Q5** (slice 6 tells the repo owner to select the `Admin Authz Guard` job — the check name is **`Admin authz surface guard`**). No application-code defect found; 19 deletions all accounted for, `settings/admin-users`' service-role bootstrap branch now unreachable by a non-admin with an admin's prior behaviour preserved (`requireAdmin` returns the same `{id,email}` the handler used); callers re-enumerated — **slice 1 breaks no in-repo caller**, the only customer-facing callers are `reward-config` **GET**s which slice 1 does not gate, and both dev scripts issue a bare GET that breaks at slice 2. Flagged for TL: the requirement's Pre-flight Record states **P-3/BQ-5 blocks slices 1–2 from MERGING** and it is still unanswered — a contract decision, not a defect. Worktree left at exactly 29 `git status` entries; every probe deleted. |
| 2026-09-20 | **"How does the next one know?" — two missing mechanisms folded into existing slices** (Dev, from the user) | From the user's question *"how do we ensure that every next page or every next capability or function knows how to incorporate the same `requireAdmin` method?"* Four mechanisms audited: pages are **structural** (slice 5), admin-path routes are **mechanical** (R1 + slice 6's required status check), and **two were gaps**. **No new slices.** → **Slice 6 gains R7, the inverted rule**: every `route.ts` under `app/api/` *except* `app/api/admin/**` that makes an admin **access decision** must route it through `requireAdmin` — specified to the R1–R4 standard, failing closed on anything it cannot categorise, and explicitly **distinguishing an access decision from an admin-set query** (`listAdminEmails` is a recipient list, not authorization — a naive import-based rule would flag it and be argued down as noise). Stated plainly for SA: **R7 narrows the blind spot, it cannot close it** — a new capability touching an admin-only table without any known signal stays invisible, which is what mechanism 4 covers. → **Slice 8 gains the authoring-time fixes.** Finding: `.claude/skills/new-api-route/SKILL.md:118` does not merely omit `requireAdmin`, it **prescribes `user.app_metadata?.role === 'admin'`** — a third parallel admin signal violating FR-1/FR-2 (not a privilege-escalation hole, since `app_metadata` is service-role-only, but a second source of truth, which is what G1 forbids). So the current answer to "how does the next one know?" is *"it is told to do the wrong thing."* Slice 8 corrects `:118` and `:25`, adds the canonical snippet verbatim, and **extends the existing `ADMIN_IDENTIFICATION_AND_ACCESS.md` row in CLAUDE.md** rather than adding a competing one. **Corrections to the brief:** the rule is **R7, not R5** (R5/R6 are taken — renumbering would invalidate every shipped allow-list reason and failure message); and **`app/api/plugins/action-schema/route.ts` does NOT reference admin access** — its only mention is a comment recording that the route is *intentionally unauthenticated and metadata-only*, so it needs **no allow-list entry** and R7 starts with **one** entry, not two. Standalone `admin-authz` skill: **recommended, after slice 8, as a thin front door that points at the doc** — not built here. |
| 2026-09-20 | **Admin routes repository conformance documented as a follow-up programme** (Dev, from the user) | User: *"once we finish reviewing this code and commit, all these admin files that have direct access to DB need to go through repositories. See if we can reuse an existing repository. Document for now and we come back to it."* Documented as a first-class tracked follow-up starting **after slice 1 is committed** — not a slice of this programme, no estimate, no code. Verified **38 of 44** route files do direct DB access; **25** construct their own service-role client at module scope; **14 tables already have an owning repository** (reuse map included); **6 table groups** would need a new one. The blocking open question is recorded prominently: these are **cross-user admin reads by design**, so they need methods that are *not* the `.eq('user_id', userId)` shape the repository layer exists to enforce — SA must decide how that is expressed safely before any conversion begins, and slice 3's projection sets the precedent. **Corrections to the supplied figures:** *five* files already use repositories (not one) — four of them with **zero** direct access, including the three `system-config*` routes, which are a working precedent of gate + repository together; `agents/route.ts`'s three hits are two imports plus an **Auth Admin API** call, not table access; and `ui-config` is **not** uniquely the worst shape — **25 files** do the same thing. **New finding (OI-18):** `audit-trail/route.ts:154` queries `.from('users')` — `public.users` **does not exist**, PostgREST cannot reach `auth.users`, and the error is swallowed, so the admin audit screen has silently never shown a user's name. It needs `profiles` via `UserProfileRepository`, not a new repository — dropping that list from 7 groups to 6. |
| 2026-09-20 | **SA code-review fixes applied — D-1, D-2, D-3** (Dev) | **All three in the guard's parser; no application route file touched in this pass.** **D-1 (HIGH, blocking):** `extractBracedBody` took "the first `{` after the parameter list" as the body, so an HOC-wrapped handler was attributed an *unrelated function's* body — an ungated route passed R1 *and* was not flagged. New `findBodyBrace()` requires the next meaningful token after the parameter list to be `{`, or `=>` then `{`; anything else (`;`, `)`, `,`, an identifier) means those parens were not the handler's parameter list, so the handler goes to `unparseable`. **D-2:** the same function mistook a braced return type (`: Promise<{ ok: boolean }>`) for the body and reported a gated handler ungated — subsumed by D-1's fix, which skips a `:`-introduced annotation at nesting depth 0 (so a generic/braced type is stepped over, not adopted). **D-3:** `stripComments`' line pass was anchored `^[ \t]*//`, so a **trailing** comment containing `/*` opened a block match that deleted code up to the next `*/` — blinding R2/R4 in the permissive direction. Replaced with a single left-to-right scan over a string-blanked scaffold that recognises a comment wherever it starts, ignores `//` inside string literals, and preserves newlines; `blankStringLiterals` was tightened so only template literals may span newlines (an apostrophe in prose can no longer blank following lines). **12 new regression tests** including two on-disk assertions. Verified: guard **51/51** (was 39), oracle **153/153** unchanged, all admin suites **336/336**; a scratch HOC-wrapped ungated admin route — the exact D-1 shape — is now flagged twice where it previously passed silently. **D-4** (`route.tsx`/`route.js` never scanned) and **D-5** (R1 proves gate presence, not precedence) recorded as slice-6 tasks 6.2a/6.2b per SA. OI-16 and OI-17 given SA's warnings: OI-16 is **not a typo fix** (repointing at `replay` would re-send mail to a real recipient); OI-17 **must not become a deletion** (BQ-5 exists to qualify "no in-repo caller"). |
| 2026-09-20 | SA code review — slices 0 + 1 | **APPROVED WITH CHANGES.** All seven Dev claims independently verified: 30 handlers gated with the gate provably first in every one (re-parsed all 22 files: 43 handlers, 30 gated, zero with a body parse / query / `searchParams` before the gate); guard 39/39 and oracle 153/153 re-run by SA; zero `console.` lines in the diff; all 19 deletions accounted for with no success-path logic removed. Allow-list reconciles exactly with the 44-file census (30 gated + 35 exemptions + 3 already-canonical). E-4 (three `HEAD` handlers), N-1 (`settings/admin-users` GET upserts the caller as `super_admin` — gate now precedes it), OI-16 and OI-17 all verified real. **Five defects, all in the guard's parser, none in application code.** D-1 (HIGH, blocking): an HOC-wrapped handler is attributed an unrelated function's body, so an ungated route passes R1 *and* is not flagged — reproduced. D-2: a braced return-type annotation mis-parses a gated handler as ungated (same family as the `{ params }` bug). D-3: a trailing `//` comment containing `/*` silently deletes the code after it, blinding R2/R4. D-4: `route.tsx`/`route.js` never scanned. D-5: R1 proves gate presence, not precedence. Rulings: (a) catalogue GETs stay in slice 3 — **confirmed**; (b) slice 7 stays late — **confirmed**; (c) `node_modules` junction — **acceptable**, no trace in the diff. **Deployment: blocked until slice 0's P-1 is recorded for the target environment.** |
| 2026-09-20 | SA workplan review | **APPROVED WITH CHANGES.** 10 required changes (W-1 … W-10) + 5 inline corrections. Census verified to add up to 44 exactly; all spot-checked facts true. Three escalations decided: **(a)** `.env.example` **rejected** — docs-only in `VERCEL_ENV_SETUP.md`, RC-1(b) amended by SA (public repo; no loosening of the blanket `.env*` ignore to document one already-documented variable); **(b)** slice 3's mirror **rejected and replaced with a read-only projection** — the mirror is the F1 anti-pattern slice 7 deletes, and the duplication already exists and drifts (`agent_sharing_reward_amount`); migration `20260920b` not approved and no longer needed; **(c)** merge order **7 before 6 confirmed**, binding order `0→1→1L→2→2L→3→4→5→7→6→8`. N-1/N-2/N-3 all verified real (N-2's count corrected 5→6). New SA finding **N-4**: `GET /api/system-config` is unauthenticated, service-role-backed and takes arbitrary `keys`/`category`. Systematic gap found: six RCs require amendments to the **requirement document** that were planned but never applied — now a blocking slice-0 task (W-2). |
| 2026-09-20 | **Slice 1 implemented** (Dev) | **30 handlers across 22 route files gated** with the canonical `requireAdmin`. CI guard shipped **with** this slice per RC-2: `lib/admin/__tests__/admin-authz-surface.guard.test.ts` (6 rules, shrinking dated allow-list), its own unfiltered workflow `.github/workflows/admin-authz-guard.yml`, and `npm run test:authz-guard`. Verified: guard **red before** gating (33 offenders) → **green after** (39/39); behavioural test `adminGate.writes.test.ts` **153 passing** = 30 handlers × (401 anon / 403 non-admin / 403 on isAdmin-throw / 401 on getUser-throw / admin passes) + 3 leakage tests, each denial asserting **zero tables touched**; all **5 deliberate-breakage checks** (R1–R5) fail with a named file and remedy, and revert to green; **13 admin suites / 335 tests** pass including the 5 pre-existing route tests (no regression); **0 type errors** in the 22 files; **0 `console.*` lines touched** (slice 1L untouched, correctly). Two defects found and fixed in the guard itself: it mistook a destructured `{ params }` for a handler body (flagged correctly-gated dynamic routes) and collapsed kebab-case logger module names. New finding **E-4**: three `HEAD` handlers (`dashboard`, `token-usage`, `users`) the census never recorded — empty-200 probes that confirm route existence to anonymous callers; allow-listed for slice 2. |
| 2026-09-20 | **Slice 0 implemented + W-1 … W-10 applied** (Dev) | Workplan updated for all 10 SA required changes. **W-2** was the substantive one: six RCs mandating **requirement-document** edits had never been applied, so the contract QA tests against contradicted the plan — now applied (FR-5 reworded, FR-7 amended to defence-in-depth, FR-10 widened, FR-15/16/17 added, DoD database row rewritten, BQ section settled, plus RC-6 and RC-8). Slice 0 code-side: `ADMIN_EMAILS` documented in `docs/VERCEL_ENV_SETUP.md` (**W-1**: no `.env.example`, no `.gitignore` change); full caller enumeration complete and recorded in the requirement — **zero customer-facing callers** across all 21 slice-2 routes and 3 of the 4 slice-3 ⚠️ routes. Three new findings: **E-1** `app/admin/messages/page.tsx:152` calls a `/reply` route that does not exist (the folder has `replay`); **E-2** `messages/[id]/replay` has no in-repo caller yet can re-send platform communications anonymously; **E-3** four anonymous reads with no caller at all. P-1/P-3 written up as named, read-only checks **blocked on the deployment-access holder**. |
| 2026-09-20 | Initial workplan | Written against the requirement **as amended by RC-1 … RC-14**. Eleven slices (0, 1, 1L, 2, 2L, 3, 4, 5, 6, 7, 8) in the SA-approved order — CI guard ships **with slice 1** carrying a shrinking allow-list (RC-2), pre-flight slice 0 added as a blocking precondition (RC-1), logging slices follow immediately after the slices that touch the files (BQ-6 SA amendment). All 32 anonymous routes and all 7 inline-copy routes named by path. Three enforcement mechanisms specified concretely (canonical `requireAdmin`; async server `app/admin/layout.tsx` + `AdminChrome`; repo-wide static shape guard in its own unfiltered workflow). Database surface framed per RC-5 as one source of truth / two mechanisms, with the `ADMIN_EMAILS` divergence as a written invariant. Records user decisions of 2026-09-20: **BQ-2 = B** (retire the admin-management screen), **BQ-3 = A** (silent identical redirect), **F5 tracked separately** with its two cheap pull-ins. Three new findings: N-1 (`settings/admin-users` GET performs a write), N-2 (guard rule R4's allow-list is non-empty only because of files slice 7 deletes), N-3 (`.env.example` is gitignored and absent). 13 open issues recorded, not fixed. Status: **Planning — awaiting SA review.** |

---

## QA Report — Slice 0 + 1

**QA — 2026-09-20**
**Verdict: PASS WITH ISSUES.** Slice 1's **application code is correct and I found nothing wrong with it.** Every defect below is in the **guard**, and every one of them is latent (no file in the repo triggers any of them today). Three are new, in the same permissive-direction family SA's D-1…D-5 came from, and were found by writing hostile fixtures rather than by reading the code.
**Test mode:** full · **Strategy:** A + B + C (Jest unit/integration re-run, an independent parser written for this review, on-disk adversarial fixtures, and one deliberate mutation) · **Focus:** api + security · **Skipped:** e2e (no UI in this slice), log-analysis (tests run) · **Input source:** prompt keywords + the workplan's own slice-1 test plan
**Worktree:** `C:/Users/Barak/My Projects/AgentsPilot/neuronforge-admin-authz` @ `0d7544c0`, nothing committed. **Worktree returned to exactly the 29 `git status` entries / 374 insertions / 19 deletions it started with — verified at the end of this review. Every probe file deleted.**

Nothing in this report was taken from the workplan on trust. The census, the handler count, the gate-precedence claim and the allow-list reconciliation were all **re-derived from the files** with a parser written independently of the guard's.

---

### 1. Test runs — actual numbers

| Command | Result |
|---|---|
| `npx jest lib/admin/__tests__/admin-authz-surface.guard.test.ts app/api/admin/__tests__/adminGate.writes.test.ts` | **2 suites passed, 204/204 tests passed** (guard 51, oracle 153), 17.8 s |
| `npx jest app/api/admin lib/admin` | **12 suites passed, 336/336 tests passed**, 21.8 s |
| `npm run test:authz-guard` (the exact CI command) | **51/51 passed** |
| `npx jest` (whole repo, for context) | 343 passed / **21 failed** / 8 skipped suites — 5353 passed / **129 failed** / 59 skipped tests |

**On the 336:** the "5 pre-existing admin route tests" did not regress, but the honest reason is weaker than "they still pass". There are **10 pre-existing suites** under `app/api/admin/**` + `lib/admin/**`, and **not one of them imports any of the 22 modified files** — they cover `audit-trail`, `users/[id]/*`, `agents`, `chat-usage`, `business-os/llm-usage*`, `system-config*` and `requireAdminRoute` itself. They are structurally incapable of catching a slice-1 regression. The real regression evidence is §7, not this number.

**On the 129 repo-wide failures:** all 21 failing suites are in `__tests__/DeclarativeCompiler-*`, `lib/agentkit/v4|v6/**`, `lib/pilot/**`, `lib/orchestration/**`, `lib/website-builder/**`, `lib/utils/__tests__/featureFlags.test.ts`. **None is under `app/api/admin/**` or `lib/admin/**`; none imports a modified file.** The branch carries no change outside the 22 admin routes + `package.json`, so these are pre-existing `main` failures, not slice-1 fallout. Recorded because a reviewer running `npm test` will see them and should not attribute them here.

**Environment caveat (stated for the record, not a blocker).** The worktree's `node_modules` is a junction to the primary repo's (`node_modules -> /c/Users/Barak/My Projects/AgentsPilot/neuronforge/node_modules`); `git status` shows no trace of it. Local Node is **v22.19.0**, the workflow pins **Node 18** (`NODE_VERSION: '18'`, consistent with the repo's other two workflows and with `engines: >=18.17.0`). The guard uses only `fs`/`path`/regex, so the divergence is immaterial here — but local green is not CI green until the workflow has actually run once.

---

### 2. The gate is genuinely first — re-derived, not accepted

Written for this review: a standalone brace/paren-matching parser (not the guard's) that extracts every handler body in a file and compares the index of `requireAdmin(` against the first index of `request.json(`, `req.json(`, `.json()`, `.from(`, `.rpc(`, `.insert(`, `.update(`, `.upsert(`, `.delete(`, `searchParams`, `new URL(`, `fetch(`, `.send(`, `.enqueue(` and a queue `.push(`.

| Measure | Result |
|---|---|
| Handlers parsed across the 22 modified files | **43** |
| Gated | **30** |
| Ungated | **13** — exactly the 9 D4 GETs + the 4 ⚠️ catalogue GETs deferred to slices 2/3 |
| **Handlers where any of the above appears before `requireAdmin(`** | **0** |

Independently reproduces SA's 43/30/13. Manual read of all 30 confirms the gate is the **first statement inside `try`** in every one, and that nothing executes before the `try` either (the parser scans the whole body, so a pre-`try` `new URL(request.url)` would have been caught — there is none).

The 22nd file's verb split is right: `settings/admin-users` has **both** `GET` and `POST` gated, and the service-role bootstrap upsert (N-1) sits below the gate.

---

### 3. The failure paths are real — proven by breaking one

**The four denial cases are all present and all assert "nothing happened".** `app/api/admin/__tests__/adminGate.writes.test.ts:251-323`, ×30 handlers:

| Case | Assertion |
|---|---|
| (a) anonymous — `getUser → null` | `401` + `mockTablesTouched == []` + `isAdmin` never called |
| (b) signed in, not admin — `isAdmin → false` | `403` + `mockTablesTouched == []` |
| (c) **the admin check THROWS** | `403`, never 500 + `mockTablesTouched == []` |
| (d) **`getUser()` itself throws** | `401`, never 500 + `mockTablesTouched == []` |

Plus an admin happy path per handler, and two leakage tests (no `@` in any captured log argument; identical denial-body key sets for anonymous vs non-admin). The fake client is a Proxy recording `from`, `rpc`, `auth.admin.listUsers`, and the `SystemConfigService` / `EmbeddingService` service paths — so "no table touched" covers more than raw SQL.

**Mutation test — a test that cannot fail proves nothing.** I injected a pre-gate read into `app/api/admin/system-limits/route.ts` (a service-role client + `.from('system_settings_config').select('*')` placed immediately above the gate comment) and re-ran the oracle:

```
● PUT /api/admin/system-limits › 401 when signed out, and touches nothing
● PUT /api/admin/system-limits › 403 for a signed-in non-admin, and touches nothing
● PUT /api/admin/system-limits › 403 (not 500) when the admin check throws — fails closed
● PUT /api/admin/system-limits › 401 (not 500) when the auth lookup throws — fails closed
Tests: 4 failed, 149 passed, 153 total
```

**All four denial cases went red. The oracle is load-bearing.** Mutation reverted; file restored byte-identical (12 insertions, matching the original diff stat).

> **Corollary worth recording:** with that same mutation on disk the **guard stayed 51/51 green**. That is **D-5** (R1 proves presence, not precedence) demonstrated live, not theorised — and it is the reason D-Q1/D-Q2 below matter.

---

### 4. Attacking the guard — 13 hostile fixtures

Method: real `route.ts` files written to disk under `app/api/admin/__qa_probe__/**` (plus one each for R2/R3/R4/R5), guard re-run, output read. Every probe deleted afterwards; `git status` re-verified at 29.

#### 4a. What did NOT defeat the guard (so the next reviewer knows the coverage)

| # | Shape | Outcome |
|---|---|---|
| 1 | `const handler = async () => {…}; export const POST = handler;` | ✅ `unparseable` — "assigned a value this guard cannot trace to a function body" |
| 2 | `export { GET } from './impl';` (handler in a sibling file) | ✅ `unparseable` — "re-exported via `export { … }`" |
| 3 | **D-1 shape:** `export const GET = withAuth(async (req) => {…});` followed by an unrelated function containing `requireAdmin(` | ✅ `unparseable` — the D-1 fix holds. This is the single most important negative result in this review |
| 4 | Braced **return type** on a correctly-gated handler: `export async function POST(req): Promise<NextResponse \| { ok: boolean }>` | ✅ Correctly seen as **gated** — no false positive. D-2 fix holds |
| 5 | Default parameter containing braces: `export async function DELETE(req, ctx = { params: { id: '' } })`, ungated | ✅ R1 flagged it |
| 6 | Expression-bodied arrow: `export const GET = async () => NextResponse.json({…})` | ✅ `unparseable` |
| 7 | Odd whitespace — `export` / `async` / `function` / `PATCH` / params each on its own line, ungated | ✅ R1 flagged it |
| 8 | `export * from './impl';` | ✅ `unparseable` |
| 9 | A **new** `HEAD` handler and a **new** `OPTIONS` handler in a new admin route, ungated | ✅ **Both flagged by R1.** `HTTP_HANDLERS` includes them and the R1 loop iterates whatever `scanHandlers` returns — confirms E-4's claim that a new HEAD would be caught, not skipped |
| 10 | `route.ts` outside `app/api/admin/` importing `AdminAccessService` | ✅ R2 fired |
| 11 | `route.ts` under `app/admin/` | ✅ R3 fired |
| 12 | `lib/qa-probe-r4.ts` with `profile.role === 'super_admin'` | ✅ R4 fired |
| 13 | A new migration with an **uncommented** `CREATE POLICY … profiles … role` | ✅ R5 fired |

Also confirmed: **D-4 and D-5 are still open and correctly recorded** as slice-6 tasks (workplan §*D-4 and D-5 — parser hardening deferred here by SA*, with fix directions). A `route.tsx` probe was, as documented, never scanned. **Not reported as new.**

#### 4b. What DID defeat the guard — three new defects

Proof of the escape: with **only** the four escaping probes on disk (`p6`, `p7`, `p10`, `p12`) and the others removed, the guard reported **51/51 passing** — four ungated admin route handlers sitting in the tree, build green. That is the exact failure mode the guard's own header calls out.

---

### Issues Found

#### Bugs (guard only — no application-code defect found)

**D-Q1 — MEDIUM — R1 accepts a `requireAdmin(` that occurs only inside a STRING LITERAL.**
`lib/admin/__tests__/admin-authz-surface.guard.test.ts:1032` — `if (!h.body.includes('requireAdmin('))`.
`extractBracedBody` deliberately returns the **un-blanked** source (`code.slice(open, …)`, `:518`), so the gate check runs against string contents too. That is correct for R4 (a violation in a string still counts) and **inverted for R1**, where a string makes a non-gate look like a gate. Comments are safe — `SCANNED` stores `stripComments(raw)` — but strings are not.

Reproducing fixture (`app/api/admin/<anything>/route.ts`):
```ts
import { NextRequest, NextResponse } from 'next/server';
export async function PUT(request: NextRequest) {
  const note = 'this route should call requireAdmin( someday';
  return NextResponse.json({ leaked: note });
}
```
Expected: R1 offender. **Actual: guard green.**
Fix direction: run R1's `includes` against `blankStringLiterals(h.body)`, not `h.body`. (R4/R2 must keep using the un-blanked text.)

**D-Q2 — MEDIUM — R1 accepts a `requireAdmin(` that is mentioned but never executed.**
Same line, `:1032`. A handler that defines a closure containing the gate — and never calls it — passes.

```ts
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/requireAdminRoute';
export async function POST(request: Request) {
  const later = async (l: any) => { const g = await requireAdmin(l); return g; };
  void later;
  return NextResponse.json({ leaked: true });
}
```
Expected: R1 offender. **Actual: guard green.**
**This is adjacent to D-5 but is NOT closed by D-5's recorded fix.** D-5 proposes requiring `indexOf('requireAdmin(')` to precede the first `.json()`/`.from(`/`.rpc(`/`searchParams`/`new URL(`. In this fixture the gate's index is *already* first, so an ordering check passes it. Whoever implements D-5 in slice 6 must treat D-Q2 as a separate requirement — the minimum honest shape is "the handler's body opens with the canonical three-line gate", i.e. match the first statement, not any occurrence.

**D-Q3 — MEDIUM/LOW — an unrecognised handler shape is silently skipped when the file also contains a parseable handler.**
`lib/admin/__tests__/admin-authz-surface.guard.test.ts:565` (`fnRe` requires `function\s+NAME\s*\(`) + `:1053` (`if (handlers.length === 0 && unparseable.length === 0)`).
W-7's fourth promise — *"a `route.ts` from which the scanner extracts no handler at all is flagged"* — only fires for a file that yields **nothing**. A file with one parseable handler and one unrecognised one yields `handlers.length > 0`, so the zero-handler net never fires and the unrecognised handler is invisible to R1. Nothing in the parser flags "I saw the token `GET` exported in a shape none of my three forms matched".

```ts
// app/api/admin/<anything>/route.ts
export async function POST(request: NextRequest) {   // parseable + gated
  const gate = await requireAdmin(logger);
  if (gate instanceof NextResponse) return gate;
  return NextResponse.json({ ok: true });
}
export async function GET<T>(request: NextRequest) { // generic → matched by no form
  return NextResponse.json({ leaked: true });        // ungated, invisible
}
```
Expected: R1 offender (or `unparseable`). **Actual: guard green.**
A second instance of the same class: `export let GET;` followed by `GET = async () => {…}`.
Generics on a route handler are contrived — the **class** is not, and it is precisely "we only recognise the shapes people currently write", which the guard's header rejects. Fix direction: after the three forms run, re-scan for `export` … `\b(GET|POST|…)\b` occurrences that were not attributed to a handler or to an `unparseable` entry, and flag the remainder.

#### Documentation / accuracy defects (Low)

**D-Q4 — LOW — the R4 allow-list reason carries line numbers this very diff invalidated.**
`lib/admin/__tests__/admin-authz-surface.guard.test.ts:231` says *"2 occurrences (lines 196, 197); line 197 is inside `.filter(…)`"*. After the gate insertion the occurrences are at **`app/api/admin/settings/admin-users/route.ts:210` and `:211`**. Measured. The same stale pair (196/197) is repeated in the workplan's finding N-2 and in the SA code review. `app/admin/settings/page.tsx`'s four (322, 447, 457, 461) are still correct — that file was not modified. The count (6) is right; only the coordinates are wrong.

**D-Q5 — LOW — slice 6's manual step names a check that will not exist.**
`docs/workplans/admin-authz-unification.md:1046` tells the repo owner to *"select the `Admin Authz Guard` job"*. `Admin Authz Guard` is the **workflow** name; the **job** name — which is what a required status check matches, as the workflow's own header correctly warns — is **`Admin authz surface guard`** (`.github/workflows/admin-authz-guard.yml:67`). A repo owner following the workplan will look for a check name that is not in the list.

#### Edge cases / observations (no action required in slice 1)

1. **R4's allow-list is per-FILE.** `app/api/admin/settings/admin-users/route.ts` is exempted wholesale, so a *genuine* `profiles.role` access decision added to that file before slice 7 would be invisible. Inherent to file-level allow-listing and both files are deleted in slice 7 — noted so slice 7's diff is known to close it.
2. **`user-emails/route.ts#POST` stays anonymous until slice 2.** Verified by reading it: it is genuinely a read (`auth.admin.listUsers()` + filter, no write), so the allow-list reason is accurate and the deferral matches the approved plan. But every platform user's email address remains anonymously readable via an unauthenticated POST until slice 2 merges. Re-surfaced, as SA did, so it is a decision and not a surprise.

---

### 5. The allow-list reconciles exactly — re-derived

Independent census of **all 44** `app/api/admin/**/route.ts` files (and **0** `route.tsx`/`.js`/`.jsx`), parsed with the QA parser:

| Measure | Count |
|---|---|
| Route files | **44** |
| Handlers (incl. `HEAD`/`OPTIONS`) | **72** |
| Gated | **37** = 30 (slice 1) + 7 (the 3 already-canonical `system-config*` files — verified 7/7 gated) |
| Ungated | **35** |
| `R1_ALLOW` entries | **35** |
| Ungated ∖ allow-listed | **∅** |
| Allow-listed ∖ ungated (stale) | **∅** |

**Set equality, both directions.** 30 + 35 + 7 = 72 handlers, every one either gated or carrying a dated, reasoned exemption naming the slice that removes it.

Verb-level cross-check against the requirement's own census: D1's 16 files carry 22 write verbs, D2's 5 files carry 6, category C carries 2 — **30 exactly**, matching what is gated. **Nothing is allow-listed that slice 1 should have gated.**

Attributability: `ALL_EXEMPTIONS` is structurally protected by two assertions — every allow-listed file must still exist (`:697`) and every entry must carry a reason ≥20 chars (`:706`). Every entry I read is dated `2026-09-20` and names its removing slice. Verified the three `HEAD` entries individually — `users#HEAD`, `dashboard#HEAD`, `token-usage#HEAD` — each naming the actual harm (*"empty-200 probe. Confirms route existence to anonymous callers"*), not a generic note. And **a NEW `HEAD` handler is caught**: probe 9 above produced an R1 offender for both `HEAD` and `OPTIONS`.

---

### 6. CI workflow — works, and is not a gate

| Check | Result |
|---|---|
| Workflow invokes a script that exists | ✅ `npm run test:authz-guard` → `jest lib/admin/__tests__/admin-authz-surface.guard.test.ts --ci`. **Ran the exact command: 51/51.** |
| `paths:` filter | ✅ **None** (asserted mechanically against the YAML) |
| Would run on a PR adding a new admin route | ✅ `pull_request: branches: [main]` with no path filter, so a PR touching *any* file triggers it |
| Hygiene | ✅ `permissions: contents: read`, concurrency group, `timeout-minutes: 15`, Node 18 via `NODE_VERSION` (matches both existing workflows), `npm ci` |
| Job name stability warned about | ✅ in the header — and see **D-Q5**, the workplan quotes the wrong name |

> **For the record, plainly: this is NOT a real gate.** A red workflow blocks nothing. Until `Admin authz surface guard` is made a **required status check on `main`** — a GitHub repository setting, not a file in this diff — an unguarded admin route can still be merged with a red tick beside it. That is slice 6 plus a manual action by the repo owner, and slice 6 is not Done without it. The workflow says so itself; this report says so too, so it is not carried only in a file comment.

---

### 7. No success-path behaviour changed

All **19 deletions** in the diff re-derived from `git diff -U0` and individually accounted for:

| Deleted | Where | Replaced by |
|---|---|---|
| 2 TODO comment lines | `ais-config` | a comment recording that the gate now does it |
| `import { NextResponse } from 'next/server'` | `migrate-labels` | `import { NextRequest, NextResponse }` |
| `export async function POST()` | `migrate-labels` | `POST(request: NextRequest)` — Next.js always passes a Request, so no behaviour change |
| `import { getUser }` | `settings/admin-users` | `requireAdmin` |
| 2 × 6-line `getUser`/401 blocks | `settings/admin-users` GET + POST | the gate |

**Zero success-path logic removed.** The 22 files also type-check: `jest.config.js` uses the `ts-jest` preset with diagnostics at their default (on), and the oracle imports all 22 route modules — so a type error in any of them would fail the suite.

**`settings/admin-users` — the one that needed looking at.** Its `GET` now opens with `requireAdmin` (`:34`) and returns the gate response before anything else. The service-role bootstrap branch (`:57-99`) — which upserts the caller in as `super_admin` into `system_settings_config.admin_users` — is **unreachable by a non-admin**, and the old weaker `getUser`/401 path is gone, so there is no second door. **For an admin the prior behaviour is preserved exactly**: the handler used `user.id` and `user.email` from `getUser()`, and `requireAdmin` returns `{ user: { id, email } }` (`lib/admin/requireAdminRoute.ts:89`) — the same two fields, from the same `getUser()` call. Checked all nine `user.` references in the file (`:38, 58, 64, 68, 91, 92, 160, 202, 209-210`); all are `.id`/`.email`.

**`crypto.randomUUID()`** used for `correlationId` in the newly-added logger preamble is the repo's existing API-route pattern and resolves under both Node 18+ and the Jest run.

---

### 8. What slice 1 might have broken — callers re-derived

I enumerated callers myself rather than trusting the claim, grepping the whole repo for each of the 22 route paths.

| Caller class | Finding |
|---|---|
| **Admin-operated screens** (`app/admin/**/page.tsx`) | Every write-verb call site is one of these — `agent-generation-config`, `ais-config`, `ais-weights{,/combined,/creation}`, `boost-packs`, `calculator-config`, `execution-tiers`, `helpbot-config`, `memory-config`, `messages/[id]`, `onboarding-config`, `orchestration-config`, `reward-config`, `settings/admin-users`, `storage-tiers`, `system-limits`, `ui-config`. All operated by an admin; all keep working. |
| **Customer-facing** | Exactly two — `app/(protected)/agents/[id]/page.tsx:406` and `app/v2/agents/[id]/page.tsx:360` — and **both are `GET /api/admin/reward-config`, which slice 1 does not gate** (deferred to slice 3). Plus the dead backup `page.backup-20251101-215528.tsx:424` (OI-6). **No customer regression.** |
| **Dev scripts** | `scripts/test-phase5-full-integration.ts:174` and `scripts/test-phase6-final-verification.ts:287` — both a bare `fetch('…/api/admin/ais-config')`, i.e. a **GET**, which is **not gated until slice 2**. **W-4's correction is correct: slice 1 breaks neither.** |
| **Cron / server-to-server** | `vercel.json:12` references `/api/cron/memory-consolidation` — a **different route** from `/api/admin/memory-consolidation`. Confirmed untouched. |
| **No in-repo caller at all** | `backfill-embeddings`, `memory-consolidation`, `migrate-labels` — matches the workplan. |
| **`AdminCalibrationTrigger`** | Probes `GET /api/admin/agents?limit=1` (`components/admin/AdminCalibrationTrigger.tsx:63`) — a **slice-4** route, untouched here. Its 401/403 self-gating contract is preserved by the oracle's cases (c) and (d), which prove the gate never returns 500. |

**Confirmed: slice 1 breaks no in-repo caller.**

---

### Test Coverage vs Acceptance Criteria

| Acceptance criterion (requirement MD, as amended) | Tested? | Result | Notes |
|---|---|---|---|
| **Slice 1 AC** — every D1/D2 write/action verb refuses anonymous **and** signed-in non-admin | ✅ | **Pass** | 30/30 handlers × 4 denial cases, oracle 153/153; mutation-proven to be able to fail |
| **Slice 1 AC** — no read behaviour changed | ✅ | **Pass** | 13 GETs deliberately ungated, re-derived; diff contains no read-path edit |
| **Slice 1 AC** — admin UI write paths still work for an admin | ⚠️ | **Partial** | Proven at handler level (admin case reaches the handler for all 30). **Not exercised against a live deployment** — see §Not verified |
| **FR-3** fail closed | ✅ | Pass | `isAdmin` throws ⇒ 403; `getUser` throws ⇒ 401; never 500; zero tables touched in both |
| **FR-4** 401 vs 403 distinction, never a server error | ✅ | Pass | asserted per handler |
| **FR-5** no handler work before the gate | ✅ | Pass | re-derived independently across 43 handlers: 0 violations (§2) |
| **FR-6** denials log `userId` only, no email | ✅ | Pass | oracle asserts no `@` in any captured log argument and no email in any denial body |
| **FR-10(a)** guard fails on an ungated admin handler | ⚠️ | **Partial** | Fires on ordinary shapes (probes 5, 7, 9). **Three shapes escape — D-Q1, D-Q2, D-Q3** |
| **FR-10(b)** guard fails on any `route.ts` importing `AdminAccessService` | ✅ | Pass | R2 fired on a fresh probe outside `app/api/admin/` |
| **FR-10(c)** guard fails on a `route.ts` under `app/admin/**` | ✅ | Pass | R3 fired on a fresh probe |
| **FR-10(d)** guard fails on a role-based access decision | ✅ | Pass | R4 fired; silent on LLM message roles and on organisation roles (W-10) |
| **FR-10(e)** guard fails on a new `profiles.role` RLS policy | ✅ | Pass | R5 fired on an uncommented probe; silent on the real commented rollback block |
| **FR-11** every exception explicit, named, justified, dated | ✅ | Pass | 35 + 8 + 2 + 1 entries, all dated, all reasoned; two structural assertions enforce it |
| **Programme-wide** — all 44 route files in a known end state | ✅ | **Pass** | 72 handlers: 37 gated, 35 exempted, set equality both directions |
| **Programme-wide** — failure paths tested, not just happy paths | ✅ | Pass | and proven able to fail |
| **Slice 0 P-5** — the requirement contract no longer contradicts the plan | ✅ | Pass | FR-5 reworded, FR-7 defence-in-depth, FR-10 widened to (a)–(e), FR-15/16/17 present, BQ section settled |
| **Slice 0 P-1** — admin identity resolves in every deploy environment | ❌ | **Not verifiable by QA** | 🔒 blocked on the deployment-access holder; requires Supabase console + Vercel env access |
| **Slice 0 P-3** — BQ-5 answered | ❌ | **Not verifiable by QA** | 🔒 same owner. **See the merge-gate note below** |

### Not verified, and why

- **P-1 / P-3.** Read-only checks requiring Supabase-console and Vercel access. Out of QA's reach; correctly written up as named hand-offs in the requirement's Pre-flight Record.
- **Live admin UI save paths.** Would need a running app with a real admin session. Handler-level equivalent is proven (all 30 admin cases reach the handler) and the diff removes no success-path logic, but "an admin can still save every config screen" remains a **manual post-deploy check**, and it is gated behind P-1 anyway.
- **The workflow has never actually executed.** `npm run test:authz-guard` was run locally on Node 22; CI runs Node 18 with `npm ci` from the lockfile. First real evidence arrives with the PR.

### ⚠️ A merge gate the code cannot satisfy — for TL, not for Dev

The requirement's own Pre-flight Record states: *"**P-3 blocks slices 1 and 2 from merging; P-1 blocks them from deploying.**"* Slice 1's header likewise reads *"Blocked by slice 0 **and the BQ-5 answer**"*. **BQ-5/P-3 is still unanswered** (🔒 BLOCKED on the deployment-access holder). SA's review addressed P-1 and concluded "commit, open the PR… do not deploy", which is right about P-1 but is silent on P-3.

So as the contract is written today, **merging slice 1 without the BQ-5 answer violates it.** This is not a code defect and QA is not the right party to waive it. Either (a) get the one-line BQ-5 answer first, or (b) TL/SA amend the contract to say P-3 blocks *deployment* rather than *merging*. It must not simply be walked past.

### Final Status

- [x] **Application code (22 route files, 30 handlers) — no defects found. Ready.**
- [ ] **Guard — 3 new latent defects (D-Q1, D-Q2, D-Q3) + 2 documentation defects (D-Q4, D-Q5).** None blocks the commit; D-Q1/D-Q2/D-Q3 should be fixed before slice 6 declares "cannot recur", and D-Q2 must be scoped into D-5's slice-6 task because D-5's recorded fix does not close it.
- [ ] **P-1 unverified — do not deploy to any environment until it is recorded for that environment.**
- [ ] **P-3/BQ-5 unanswered — a stated merge gate. TL decision required.**

**Is this safe to commit and open as a PR?** **Yes, on the code.** It strictly reduces attack surface (30 previously-anonymous write/action handlers now deny), breaks no in-repo caller, changes no success path, and both new suites are proven able to fail. **Subject to the two process gates above**, which are decisions, not defects.

---
