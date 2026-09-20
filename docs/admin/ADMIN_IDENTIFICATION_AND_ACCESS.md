# Admin Identification & Access

> **Last Updated**: 2026-09-20

## Overview

This document describes how AgentPilot identifies **platform admins/operators** — the small, trusted group with elevated, cross-tenant visibility (initially just the platform owner). It defines the authoritative source of truth (`admin_users`), the repository/service that every component uses to answer "is this user an admin?" and "who are the admins?", how admins are bootstrapped, and the open follow-ups.

It exists because, before this work, the system had **no trustworthy admin signal** and every `/api/admin/*` route relied on the service-role key with no caller check. This is the prerequisite (Q1) for the [Admin Agent Health Dashboard](/docs/requirements/ADMIN_AGENT_HEALTH_DASHBOARD_REQUIREMENT.md).

---

## Table of Contents

1. [As-Built State — read this first](#as-built-state--read-this-first)
2. [Why not `profiles.role`](#why-not-profilesrole)
3. [Agreed Design](#agreed-design)
4. [Architecture at a Glance](#architecture-at-a-glance)
5. [Data Model](#data-model)
6. [Components](#components)
7. [Runtime Flows](#runtime-flows)
8. [Lifecycle Scenarios](#lifecycle-scenarios)
9. [How to Use It](#how-to-use-it)
10. [Bootstrapping Admins](#bootstrapping-admins)
11. [Open Items / Follow-ups](#open-items--follow-ups)
12. [Security Notes](#security-notes)
13. [Change History](#change-history)

---

## As-Built State — read this first

> **The admin surface is PARTIALLY unified.** This section exists because every
> earlier draft of it described the *intended* end state, and a reader would
> have concluded the system was protected. It is not, yet. Measured
> 2026-09-20. The 72/38/7/27 split was re-derived against `7959b0dd`, `9cac7afa` and `e08091da` and is identical in all three, so it is not tied to one commit — but re-run the census rather than trusting these figures if much time has passed.

### What is true

| Claim | Status |
|---|---|
| There is **one** canonical gate for API routes — `requireAdmin` (`lib/admin/requireAdminRoute.ts`) | ✅ True |
| It derives admin identity **only** from `admin_users`, via `AdminAccessService` | ✅ True |
| It fails closed, answers **401** signed-out / **403** non-admin, and never 500s on an authorization outcome | ✅ True |
| No app-code access decision reads `profiles.role` — a repo-wide sweep returns **zero** hits | ✅ True, and CI rule R4 keeps it that way |
| A **new** admin route cannot ship ungated | 🟡 **Not yet.** The guard detects it, but a red check blocks nothing until the repo owner makes **`Admin authz surface guard`** a required status check on `main`. **Until that manual step is done, an ungated admin route can still be merged with a red tick beside it.** See [CI enforcement](#ci-enforcement). |

> ⚠️ The row above is the one conditional in this table, and it is deliberately **not** a ✅. It is the difference between *"CI noticed"* and *"CI stopped it"*, and only the second one is a gate.

### What is NOT true, stated plainly

| Tempting claim | Reality |
|---|---|
| ~~"All 44 `/api/admin/*` route files sit behind the gate"~~ | **False.** Files are the wrong unit — the gate is per **handler**. Of **72 handlers**: **38 gated**, **7 correct-but-inline**, **27 knowingly open**. |
| ~~"This class of gap cannot recur"~~ | True **for new surfaces only**. The 27 open handlers are not a recurrence — they are the unfinished part. |
| ~~"All 21 `/admin` pages are protected on the server"~~ | **False.** Slice 5 is parked. `app/admin/layout.tsx` is a `'use client'` component and **there is no server-side page guard at all**. Every admin page renders for anyone who types the URL; what they then see depends entirely on the API routes behind it — which is what the 27 are. |
| ~~"One way to validate a caller is an admin"~~ | One way **exists** and is **enforced for new code**. It is not the only way **in use**: 7 handlers still hand-roll their own `AdminAccessService` check. Correct behaviour, duplicated logic. |
| ~~"The admin Settings screen has been retired"~~ | **False.** Slice 7 is parked. `app/admin/settings/page.tsx` and `app/api/admin/settings/admin-users/route.ts` **still exist**. They are **non-functional and gated**: an operator who "adds an admin" there writes to `system_settings_config.admin_users`, a store that **grants nothing**. Never describe this as retired. |
| ~~"The reward-config mirror could drift"~~ | Moot — no mirror was ever built. The live fact is worse and simpler: **the full reward ruleset, including eligibility thresholds and anti-abuse caps, is anonymously readable today** via `GET /api/admin/reward-config`. |

### Every admin handler and its state (72)

The unit is the **handler**, not the file: slice 1 gated write verbs and left read verbs open in the *same* file, so a file-level table would be misleading.

| # | Route | Verb | State | Note |
|---|---|---|---|---|
| 1 | `agent-generation-config` | `GET` | 🔴 **OPEN** | No admin check. Anonymous callers reach it. |
| 2 | `ais-config` | `GET` | 🔴 **OPEN** | No admin check. Anonymous callers reach it. |
| 3 | `backfill-embeddings` | `GET` | 🔴 **OPEN** | No admin check. Anonymous callers reach it. |
| 4 | `boost-packs` | `GET` | 🔴 **OPEN** | No admin check. Anonymous callers reach it. |
| 5 | `dashboard` | `GET` | 🔴 **OPEN** | No admin check. Anonymous callers reach it. |
| 6 | `dashboard` | `HEAD` | 🔴 **OPEN** | No admin check. Anonymous callers reach it. |
| 7 | `execution-stats` | `GET` | 🔴 **OPEN** | No admin check. Anonymous callers reach it. |
| 8 | `execution-tiers` | `GET` | 🔴 **OPEN** | No admin check. Anonymous callers reach it. |
| 9 | `helpbot-config` | `GET` | 🔴 **OPEN** | No admin check. Anonymous callers reach it. |
| 10 | `memory-config` | `GET` | 🔴 **OPEN** | No admin check. Anonymous callers reach it. |
| 11 | `memory-consolidation` | `GET` | 🔴 **OPEN** | No admin check. Anonymous callers reach it. |
| 12 | `messages` | `GET` | 🔴 **OPEN** | No admin check. Anonymous callers reach it. |
| 13 | `onboarding-config` | `GET` | 🔴 **OPEN** | No admin check. Anonymous callers reach it. |
| 14 | `onboarding-users` | `GET` | 🔴 **OPEN** | No admin check. Anonymous callers reach it. |
| 15 | `orchestration-config` | `GET` | 🔴 **OPEN** | No admin check. Anonymous callers reach it. |
| 16 | `reward-config` | `GET` | 🔴 **OPEN** | No admin check. Anonymous callers reach it. |
| 17 | `settings/platform-users` | `GET` | 🔴 **OPEN** | No admin check. Anonymous callers reach it. |
| 18 | `storage-stats` | `GET` | 🔴 **OPEN** | No admin check. Anonymous callers reach it. |
| 19 | `storage-tiers` | `GET` | 🔴 **OPEN** | No admin check. Anonymous callers reach it. |
| 20 | `token-usage` | `GET` | 🔴 **OPEN** | No admin check. Anonymous callers reach it. |
| 21 | `token-usage` | `HEAD` | 🔴 **OPEN** | No admin check. Anonymous callers reach it. |
| 22 | `token-usage/drill-down` | `GET` | 🔴 **OPEN** | No admin check. Anonymous callers reach it. |
| 23 | `token-usage/stats` | `GET` | 🔴 **OPEN** | No admin check. Anonymous callers reach it. |
| 24 | `ui-config` | `GET` | 🔴 **OPEN** | No admin check. Anonymous callers reach it. |
| 25 | `users` | `GET` | 🔴 **OPEN** | No admin check. Anonymous callers reach it. |
| 26 | `users` | `HEAD` | 🔴 **OPEN** | No admin check. Anonymous callers reach it. |
| 27 | `users/[id]/stats` | `GET` | 🔴 **OPEN** | No admin check. Anonymous callers reach it. |
| 28 | `agents` | `GET` | 🟡 inline | Correct behaviour, hand-rolled `AdminAccessService` check (was slice 4). |
| 29 | `audit-trail` | `GET` | 🟡 inline | Correct behaviour, hand-rolled `AdminAccessService` check (was slice 4). |
| 30 | `business-os/llm-usage` | `GET` | 🟡 inline | Correct behaviour, hand-rolled `AdminAccessService` check (was slice 4). |
| 31 | `business-os/llm-usage/businesses` | `GET` | 🟡 inline | Correct behaviour, hand-rolled `AdminAccessService` check (was slice 4). |
| 32 | `chat-usage` | `GET` | 🟡 inline | Correct behaviour, hand-rolled `AdminAccessService` check (was slice 4). |
| 33 | `users/[id]/audit-logs` | `GET` | 🟡 inline | Correct behaviour, hand-rolled `AdminAccessService` check (was slice 4). |
| 34 | `users/[id]/login-stats` | `GET` | 🟡 inline | Correct behaviour, hand-rolled `AdminAccessService` check (was slice 4). |
| 35 | `agent-generation-config` | `PUT` | ✅ gated | `requireAdmin` |
| 36 | `ais-config` | `POST` | ✅ gated | `requireAdmin` |
| 37 | `ais-weights` | `PUT` | ✅ gated | `requireAdmin` |
| 38 | `ais-weights/combined` | `PUT` | ✅ gated | `requireAdmin` |
| 39 | `ais-weights/creation` | `PUT` | ✅ gated | `requireAdmin` |
| 40 | `backfill-embeddings` | `POST` | ✅ gated | `requireAdmin` |
| 41 | `boost-packs` | `DELETE` | ✅ gated | `requireAdmin` |
| 42 | `boost-packs` | `POST` | ✅ gated | `requireAdmin` |
| 43 | `boost-packs` | `PUT` | ✅ gated | `requireAdmin` |
| 44 | `calculator-config` | `PUT` | ✅ gated | `requireAdmin` |
| 45 | `execution-tiers` | `DELETE` | ✅ gated | `requireAdmin` |
| 46 | `execution-tiers` | `POST` | ✅ gated | `requireAdmin` |
| 47 | `execution-tiers` | `PUT` | ✅ gated | `requireAdmin` |
| 48 | `helpbot-config` | `PUT` | ✅ gated | `requireAdmin` |
| 49 | `memory-config` | `PUT` | ✅ gated | `requireAdmin` |
| 50 | `memory-consolidation` | `POST` | ✅ gated | `requireAdmin` |
| 51 | `messages/[id]` | `DELETE` | ✅ gated | `requireAdmin` |
| 52 | `messages/[id]` | `PATCH` | ✅ gated | `requireAdmin` |
| 53 | `messages/[id]/replay` | `POST` | ✅ gated | `requireAdmin` |
| 54 | `migrate-labels` | `POST` | ✅ gated | `requireAdmin` |
| 55 | `onboarding-config` | `PUT` | ✅ gated | `requireAdmin` |
| 56 | `orchestration-config` | `PUT` | ✅ gated | `requireAdmin` |
| 57 | `reward-config` | `POST` | ✅ gated | `requireAdmin` |
| 58 | `settings/admin-users` | `GET` | ✅ gated | `requireAdmin` |
| 59 | `settings/admin-users` | `POST` | ✅ gated | `requireAdmin` |
| 60 | `storage-tiers` | `DELETE` | ✅ gated | `requireAdmin` |
| 61 | `storage-tiers` | `POST` | ✅ gated | `requireAdmin` |
| 62 | `storage-tiers` | `PUT` | ✅ gated | `requireAdmin` |
| 63 | `system-config` | `GET` | ✅ gated | `requireAdmin` |
| 64 | `system-config` | `PUT` | ✅ gated | `requireAdmin` |
| 65 | `system-config/pricing` | `DELETE` | ✅ gated | `requireAdmin` |
| 66 | `system-config/pricing` | `GET` | ✅ gated | `requireAdmin` |
| 67 | `system-config/pricing` | `POST` | ✅ gated | `requireAdmin` |
| 68 | `system-config/pricing` | `PUT` | ✅ gated | `requireAdmin` |
| 69 | `system-config/pricing/sync` | `POST` | ✅ gated | `requireAdmin` |
| 70 | `system-limits` | `PUT` | ✅ gated | `requireAdmin` |
| 71 | `ui-config` | `POST` | ✅ gated | `requireAdmin` |
| 72 | `user-emails` | `POST` | ✅ gated | `requireAdmin` |

### CI enforcement

`.github/workflows/admin-authz-guard.yml` runs `lib/admin/__tests__/admin-authz-surface.guard.test.ts` on every PR to `main`, with **no `paths:` filter** (a filtered workflow would be defeated by the very change it guards).

Six rules: **R1** admin handler without `requireAdmin` · **R2** any `route.ts` importing `AdminAccessService` · **R3** a `route.ts` under `app/admin/**` · **R4** an access decision on a `role` value · **R5** a migration adding an RLS policy on `profiles.role` · **R6** the `/admin` layout without its server guard.

Exemptions live in two separate lists per rule — **PARKED** (an open hole someone decided not to close yet) and **PERMANENT** (an architectural exception). Each list has an **asserted cap**, and **the ratchet rule** applies: *any commit that removes an exemption must lower that list's cap by the same number, in the same commit.* Adding an exemption therefore requires raising a cap, which is a visible act in a diff.

> ⚠️ **A green run means no NEW ungated admin surface was added.** It does **not** mean the admin surface is secure. And the workflow is only a true gate once the repo owner has made **`Admin authz surface guard`** (the *job* name) a required status check on `main`.

### Known gaps in the guard itself

| Gap | Detail |
|---|---|
| **Precedence, not presence** | R1 checks that a handler *contains* `requireAdmin(`. It does not prove the gate runs **first**, nor that it runs at all (a gate inside a never-invoked closure satisfies it). All 38 gated handlers are correct today — verified by hand and by the oracle — but that is a measurement, not an invariant. **Closing it also requires extending the oracle's instrumentation to cover the body parse**, since `mockTablesTouched` records DB/RPC/auth-API calls and not `request.json()`.<br><br>📌 **SA condition (2026-09-20): this is the FIRST thing built when the parked slices resume.** The reasoning is that the guard's authority *grows* once it becomes a required status check — and precedence is the one place where a green run does not mean what a reader will assume it means. The longer it is green-but-shallow, the more weight it carries unearned. Tracked as **OI-20**. |
| **Path-scoped** | R1 only looks under `app/api/admin/**`. An admin capability elsewhere is caught only if it imports `AdminAccessService` (R2). The inverted rule that would close this ("is anything that *behaves* like an admin route gated, wherever it lives?") is **parked deliberately**: R2 already catches the realistic recurrence, and a false positive on a *required* check is the single thing most likely to get the check switched off. |


---

## Why not `profiles.role`

`profiles.role` **cannot** be an admin security boundary:

| Problem | Evidence |
|---------|----------|
| **User-writable** — any authenticated user could self-promote to `'admin'` | The `profiles` UPDATE policy is `USING (auth.uid() = id)` with no `WITH CHECK` and no column restriction, so the browser anon key could write the column directly (`components/v2/settings/ProfileTabV2.tsx` upserts `profiles` including `role`, and offered "Administrator" as a selectable option). `app/api/user/profile/route.ts` also wrote `updateData.role = role` straight from the request body. **Closed 2026-09-20** — see the note below. |
| **Overloaded** — the same column holds onboarding personas | `role` constraint allows `business_owner`, `manager`, `consultant`, `sales`, … alongside the legacy `admin` / `user` / `viewer` (`supabase/SQL Scripts/20251118_update_profiles_role_constraint.sql`). |

Therefore admin identity lives in a **dedicated, service-role-only table** (`admin_users`), never in `profiles.role`. Do **not** seed admins from `profiles.role` — it would import self-promoted users.

### The self-promotion write is closed — and there is one rule you must inherit

`supabase/migrations/20261002_profiles_role_privilege_guard.sql` added a `BEFORE INSERT OR UPDATE OF role` trigger on `public.profiles` that silently drops a privileged value written by a non-service-role caller, the profile PUT no longer accepts `role`, and the "Administrator" option is gone. The three live `role = 'admin'` rows found on 2026-09-20 (two of them genuine `admin_users`) were cleared by `scripts/cleanup-profiles-role-admin.ts`.

**The rule:** if you ever read `profiles.role` for a privilege-ish decision, compare against **that trigger's normaliser** — `lower(regexp_replace(normalize(v, NFKC), '[^a-zA-Z0-9]', '', 'g'))` — never your own. A reader that lowercases first, or trims instead of stripping, or skips NFKC, will disagree with the database about what `'admin'` is, and **the disagreement is the vulnerability** (a dotted capital `İ` alone is enough to split them). Two classes of spelling are knowingly left unclamped — cross-script homoglyphs (`аdmin` with a Cyrillic `а`) and near-misses like `admins` / `org_admin` — which is safe only for as long as nothing authorizes on the column. The CI check that enforces "nothing authorizes on `profiles.role`" is owned by the admin-authz slice.

> Separately, `SYSTEM_ADMIN_USER_ID` / `system-admin@neuronforge.internal` is only an audit-trail attribution identity — it is **not** an operator-access concept and is unrelated to this table.

---

## Agreed Design

| Decision | Choice |
|----------|--------|
| Source of truth | A standalone **`admin_users` table** (not `profiles.role`, not an env-only list). |
| Bootstrap | Seeded from the **`ADMIN_EMAILS`** env allow-list (and/or a bootstrap SQL migration). |
| Key | **`email`** (stable; known before/independent of the auth account). `user_id` is bound once the admin has an account. |
| Write access | **Service role only** (RLS blocks anon/authenticated). |
| Consumption | Via **`AdminAccessService`** — the single surface for gates and recipient lists. |
| Runtime safety net | An email in `ADMIN_EMAILS` is treated as admin even before the DB seed runs, so the first operator is never locked out. |
| Failure behavior | The gate **fails closed** — any error denies admin access. |
| Self-promotion fix | 🟡 **Partly closed 2026-09-20.** The app-code side is done and CI-enforced (rule R4; a repo-wide sweep returns zero access decisions on `profiles.role`). The **write** on the customer profile route and the live-database `pg_policies` re-measurement remain — see [Open Items](#open-items--follow-ups) #1. |

---

## Architecture at a Glance

One authoritative allow-list (`admin_users`), reached only through one service (`AdminAccessService`). Bootstrap writes go in by **email**; consumers ask the service; nothing reads `profiles.role` for access.

> **History, so the claim is not read as "it never happened".** Two things did trust that column, and both are gone: the `system_settings_config` write policy `"Only admins can modify settings"` (dropped by `20260920a_lock_system_settings_and_pricing_rls.sql`) and `PUT /api/user/profile`, which accepted `role` from the request body until 2026-09-20. The column is a persona label; keeping it one is an active rule, not a historical fact — see [Why not `profiles.role`](#why-not-profilesrole).

```
  Bootstrap (by email)             Runtime (identity check)              Consumers
 ┌───────────────────┐         ┌──────────────────────────┐        ┌──────────────────┐
 │ ADMIN_EMAILS env  │──seed──▶│                          │◀──ask──│ /api/admin/* gate│
 │ seed SQL migration│───────▶ │   AdminAccessService     │        │ failure-email    │
 └───────────────────┘         │  (60s cache, fail-closed)│        │   recipients     │
                               │            │             │        │ future admin UI  │
                               │            ▼             │        └──────────────────┘
                               │   AdminUserRepository    │
                               │            │             │
                               │            ▼             │
                               │   admin_users (RLS:      │
                               │     service-role only)   │
                               └──────────────────────────┘
```

---

## Data Model

**Table:** `admin_users` (`supabase/migrations/20260701_create_admin_users.sql`)

| Column | Type | Notes |
|--------|------|-------|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `user_id` | `uuid` UNIQUE, NULLABLE | FK → `auth.users(id)` `ON DELETE CASCADE`. Null until the admin has an account, then bound (self-heals on first admin check carrying the email). |
| `email` | `text` NOT NULL UNIQUE | Lowercased; the stable bootstrap/seed key. |
| `granted_by` | `uuid` NULLABLE | FK → `auth.users(id)` `ON DELETE SET NULL`. Null for env/bootstrap rows. |
| `notes` | `text` | Free-form. |
| `is_active` | `boolean` NOT NULL `true` | Soft-revoke switch (disable without deleting the audit row). |
| `created_at` / `updated_at` | `timestamptz` | `updated_at` maintained by a trigger. |

**RLS:** enabled, with a single `service_role`-only policy and **no** permissive anon/authenticated policy. The repository accesses it through the service-role client (`supabaseServer`) — an intentional, documented RLS bypass for an admin-only surface.

---

## Components

| Layer | File | Responsibility |
|-------|------|----------------|
| Migration (schema) | `supabase/migrations/20260701_create_admin_users.sql` | Creates the table, indexes, RLS, `updated_at` trigger. |
| Migration (data) | `supabase/migrations/20260701_seed_admin_users.sql` | Bootstrap the initial admin(s) by email. Edit before running. |
| Repository | `lib/repositories/AdminUserRepository.ts` | Data access: `findByUserId`, `findByEmail`, `listActive`, `upsertByEmail`, `bindUserId`, `deactivateByEmail`. |
| Service | `lib/services/AdminAccessService.ts` | **The consumption surface:** `isAdmin`, `isAdminById`, `listAdmins`, `listAdminEmails`, `invalidateCache`. 60s cache, fails closed, env fallback, self-heal. |
| Seed script | `scripts/seed-admin-users.ts` | Populates `admin_users` from `ADMIN_EMAILS` (resolves emails → user ids via `auth.admin.listUsers`). |
| Env | `.env.example` → `ADMIN_EMAILS` | Comma/semicolon-separated admin emails. |
| Tests | `lib/repositories/__tests__/AdminUserRepository.test.ts`, `lib/services/__tests__/AdminAccessService.test.ts` | Unit coverage: query shape/normalization/errors (repo); 3-step resolution, self-heal, fail-closed, union, caching (service). |

---

## Runtime Flows

### The admin check — `isAdmin({ id, email })`

The gate resolves in a deliberate 3-step order and **fails closed** on any error:

```
isAdmin({ id, email })
  │
  ├─1─ user_id in cached admin set?          → YES → admin ✅   (fast path, no email needed)
  │
  ├─2─ email in cached admin set?            → YES → admin ✅
  │        └─ if that row's user_id ≠ this id → bind user_id, invalidate cache  (self-heal)
  │
  ├─3─ email in ADMIN_EMAILS env?            → YES → admin ✅   (pre-seed safety net, logs a warn)
  │
  └─ none → not admin ❌
  (any error anywhere → ❌ fail closed)
```

Why each step exists:

| Step | Purpose |
|------|---------|
| 1 — bound `user_id` | Steady state; cheap set membership against the 60s cache. |
| 2 — email match + **self-heal** | Handles *invited-before-signup*: the row was seeded with `user_id = NULL`; on the admin's first authenticated request we bind their real `user_id` so future checks hit step 1. No manual backfill needed. |
| 3 — `ADMIN_EMAILS` fallback | Guarantees the first operator is never locked out if the DB seed hasn't run yet (fresh env). Logs a warning so you know the seed is pending. |

### Listing admins — `listAdminEmails()`

Returns the **union of active `admin_users` rows and `ADMIN_EMAILS`**. On a DB error it still returns the env admins, so failure-alert recipients are never fully lost.

```
listAdminEmails() → { active admin_users emails } ∪ { ADMIN_EMAILS }
```

### Caching

The active-admin set is cached in memory for **60s** (the gate runs on every admin request; the set is tiny and rarely changes). A stale cache is preferred over throwing if a refresh fails (graceful degradation). Call `invalidateCache()` after an out-of-band grant/revoke to force immediate effect.

---

## Lifecycle Scenarios

| # | Scenario | What happens |
|---|----------|--------------|
| 1 | **New operator, already a user** | Add email to seed/env → run it → `user_id` bound immediately → admin routes pass at step 1. |
| 2 | **New operator, not yet signed up** | Seed by email (`user_id = NULL`) → they sign up and open an admin page → step 2 matches by email, binds `user_id`, grants → next request is step 1. |
| 3 | **Revoke an admin** | `deactivateByEmail(...)` (or `is_active = false`) → within ≤60s (or immediately after `invalidateCache()`) the gate denies. |
| 4 | **A user self-sets `profiles.role = 'admin'`** | **Can no longer happen, and would be irrelevant anyway** — since 2026-09-20 a database trigger drops the value on any non-service-role write, and no code reads `profiles.role` for access. They never appear in `admin_users`. |

---

## How to Use It

**Admin authz gate** (the intended consumer for `/api/admin/*` routes):

```typescript
import { AdminAccessService } from '@/lib/services/AdminAccessService';
import { getUser } from '@/lib/auth';

const user = await getUser();
if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

const isAdmin = await AdminAccessService.getInstance().isAdmin({ id: user.id, email: user.email });
if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
```

> Always pass `email` when you have it — it enables the self-heal (bind `user_id`) and the env-fallback paths.

**Notification recipients** (e.g. failure emails for the admin dashboard):

```typescript
const recipients = await AdminAccessService.getInstance().listAdminEmails();
```

After granting/revoking an admin out-of-band, call `invalidateCache()` so the 60s cache doesn't mask the change.

---

## Bootstrapping Admins

You do **not** need to hand over user IDs — email is the key, and `user_id` binds automatically. Pick either path:

**Option A — env + seed script (repeatable):**

```bash
# .env.local
ADMIN_EMAILS=meiribarak@gmail.com

npx tsx scripts/seed-admin-users.ts
```

**Option B — bootstrap SQL data migration (runs with your migrations):**

Edit the email list in `supabase/migrations/20260701_seed_admin_users.sql`, then run it. It inserts the row by email and binds `user_id` via an `auth.users` subquery if the account already exists (otherwise it binds on first login).

Either path is idempotent (keyed on `email`) and re-activates a soft-revoked row.

---

## Open Items / Follow-ups

| # | Item | Status | Notes |
|---|------|--------|-------|
| 1 | **Close the self-promotion hole** in `app/api/user/profile/route.ts` (stop accepting `role='admin'` from the body; drop "Administrator" from `ProfileTabV2` options). | 🟡 **Partly closed 2026-09-20** | The **app-code** side is done and enforced: a repo-wide sweep for an access decision on `profiles.role` returns **zero** hits, and CI rule **R4** fails the build on a new one. What remains: **(a)** the write itself still exists on the customer profile route, so a user can still set the column even though nothing reads it for access; **(b)** whether a policy living **only in the live database** still trusts the column is a `pg_policies` read nobody has run. Tracked as its own P0. |
| 2 | **Wire the gate into `/api/admin/*` routes.** | 🟡 **38 of 72 handlers done; 27 knowingly open** | Slice 1 gated every write/action verb (2026-09-20, PR #67); PR #69 gated `user-emails`. The remaining 27 are reads and internal-config GETs, plus 7 handlers that are correct but hand-roll the check. **See [As-Built State](#as-built-state--read-this-first) for the per-handler table.** Slices 2/3/4 are PARKED. |
| 2a | **Server-side guard for the 21 `/admin` pages.** | 🔴 **Not started — PARKED** | `app/admin/layout.tsx` is a `'use client'` component with **no guard of any kind**. Every admin page renders for anyone who types the URL. Guard rule **R6** holds the position with a dated PARKED exemption. |
| 2b | **Retire the non-functional admin Settings screen.** | 🔴 **Not done — PARKED** | `app/admin/settings/page.tsx` + `app/api/admin/settings/admin-users/route.ts` still exist. They are **gated but non-functional**: they manage `system_settings_config.admin_users`, a store that grants no access. Do not describe this as retired. |
| 3 | **`GET /api/admin/admins` route** to list admins over HTTP (gated by `AdminAccessService.isAdmin`), backed by `listAdmins()` / `listAdminEmails()`. | ⬜ Recommended | No HTTP endpoint exposes the admin list today — service/repo are server-side only. Needed for any UI that shows or manages admins. |
| 4 | **Admin management UI/API** (grant/revoke) instead of env/SQL only. | ⬜ Future | `AdminUserRepository` already supports `upsertByEmail` / `deactivateByEmail`. |
| 5 | **Audit-log admin grants/revocations** via `AuditTrailService`. | ⬜ Future | — |
| 6 | Decide whether to **retire `admin`/`viewer` from the `profiles.role` constraint** once nothing reads them for access. | ⬜ Future | Keep persona values; drop access-level values. Blocked on item 1's remaining halves. |
| 7 | **Error-response conformance across the admin surface.** | ⬜ Todo | **26 of 44** admin route files put a raw error `.message` into a response body with **no `NODE_ENV` guard** — two shapes: `details: <err>.message` (4 files) and `message: error instanceof Error ? … ` (16 files). Only 4 use the guarded form. Contradicts the Security Rule *"never expose internal error details to client in production"*. Severity is reduced on gated routes (admin-only now) but not closed. |
| 8 | **Guard precedence gap.** | ⬜ Todo | R1 proves a gate is **present**, not that it runs **first** or runs at all. Applies to all 38 gated handlers. Closing it needs the oracle's instrumentation extended to cover the **body parse** — `mockTablesTouched` records DB/RPC/auth-API calls, not `request.json()` — otherwise a precedence check is only half a check. |
| 9 | **Admin routes repository-pattern migration.** | ⬜ Todo | **38 of 44** admin route files do direct DB access (25 construct their own service-role client at module scope), violating CLAUDE.md mandatory rule 1. They are **gated, not isolated**. 14 tables already have an owning repository to reuse; 6 table groups would need a new one. ⚠️ Blocked on a design decision: these are cross-user admin reads **by design**, so they need methods that are *not* the `.eq('user_id', userId)` shape the repository layer exists to enforce. Full write-up in [admin-authz-unification.md](/docs/workplans/admin-authz-unification.md). |
| 10 | **`app/admin/learning-system/page.tsx:233` still uses `console.error`.** | ⬜ Todo | Rule-3 cleanup around the `user-emails` feature is incomplete. |

---

## Security Notes

- `admin_users` is **cross-tenant by design** and admin-only. Reads bypass the standard `.eq('user_id', userId)` rule intentionally, via the service-role client — documented here and in code per the project Security Rules.
- The gate **fails closed**: any repository/DB error denies admin access rather than granting it.
- Never expose the admin allow-list to a non-admin (client) surface.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-07-01 | Initial | Documented the `admin_users` source of truth, `AdminUserRepository` + `AdminAccessService`, env/SQL bootstrap, and open follow-ups. Prerequisite for the Admin Agent Health Dashboard (Q1). |
| 2026-07-01 | Added runtime flows | Added Architecture diagram, Runtime Flows (3-step `isAdmin` resolution, `listAdminEmails` union, caching), and Lifecycle Scenarios sections. |
| 2026-07-01 | Added unit tests | 21 passing tests for `AdminUserRepository` + `AdminAccessService` (query shape, self-heal, fail-closed, union, caching). |
| 2026-09-20 | **Corrected to the as-built state (slice 8)** | Added [As-Built State](#as-built-state--read-this-first) with the **72-row per-handler table** (38 gated / 7 inline / **27 knowingly open**) — the handler, not the file, is the unit, because slice 1 gated write verbs and left read verbs open in the *same* files. Replaced six claims that would have been **false** if written as originally planned: "all 44 route files are behind the gate", "this class of gap cannot recur" (true for **new** surfaces only), "all 21 `/admin` pages are protected on the server" (**there is no server page guard at all**), "one way to validate" (one way exists and is enforced for new code; 7 inline copies remain in use), "the Settings screen is retired" (it is **non-functional and gated**, never retired), and the reward-config mirror drift (moot — the live fact is that the full reward ruleset including abuse caps is **anonymously readable**). Documented CI enforcement, the PARKED/PERMANENT split, the ratchet rule, and the guard's own two known gaps. Open items reworked: 1 is **partly** closed (app-code side enforced; the write and the live `pg_policies` read remain), 2 is **38/72**, and new items 7–10 record error-response conformance (**26 of 44** files), the precedence gap, the repository-pattern migration, and a stray `console.error`. |
| 2026-09-20 | `profiles.role` self-promotion closed | Recorded the database guard (`20261002_profiles_role_privilege_guard.sql`), the route and UI changes, and the cleanup of the three live `admin` rows. Corrected the "nothing reads `profiles.role` for access" claim, which was true of the code but not of history — a dropped `system_settings_config` policy and the profile PUT both trusted it. Added the inherited-normaliser rule for any future reader, and the two knowingly-unclamped spelling classes. |
