# Admin Identification & Access

> **Last Updated**: 2026-07-01

## Overview

This document describes how AgentPilot identifies **platform admins/operators** — the small, trusted group with elevated, cross-tenant visibility (initially just the platform owner). It defines the authoritative source of truth (`admin_users`), the repository/service that every component uses to answer "is this user an admin?" and "who are the admins?", how admins are bootstrapped, and the open follow-ups.

It exists because, before this work, the system had **no trustworthy admin signal** and every `/api/admin/*` route relied on the service-role key with no caller check. This is the prerequisite (Q1) for the [Admin Agent Health Dashboard](/docs/requirements/ADMIN_AGENT_HEALTH_DASHBOARD_REQUIREMENT.md).

---

## Table of Contents

1. [Why not `profiles.role`](#why-not-profilesrole)
2. [Agreed Design](#agreed-design)
3. [Architecture at a Glance](#architecture-at-a-glance)
4. [Data Model](#data-model)
5. [Components](#components)
6. [Runtime Flows](#runtime-flows)
7. [Lifecycle Scenarios](#lifecycle-scenarios)
8. [How to Use It](#how-to-use-it)
9. [Bootstrapping Admins](#bootstrapping-admins)
10. [Open Items / Follow-ups](#open-items--follow-ups)
11. [Security Notes](#security-notes)
12. [Change History](#change-history)

---

## Why not `profiles.role`

`profiles.role` **cannot** be an admin security boundary:

| Problem | Evidence |
|---------|----------|
| **User-writable** — any authenticated user can self-promote to `'admin'` | `app/api/user/profile/route.ts` writes `updateData.role = role` straight from the request body; `components/v2/settings/ProfileTabV2.tsx` offers "Administrator" as a selectable option. |
| **Overloaded** — the same column holds onboarding personas | `role` constraint allows `business_owner`, `manager`, `consultant`, `sales`, … alongside the legacy `admin` / `user` / `viewer` (`supabase/SQL Scripts/20251118_update_profiles_role_constraint.sql`). |

Therefore admin identity lives in a **dedicated, service-role-only table** (`admin_users`), never in `profiles.role`. Do **not** seed admins from `profiles.role` — it would import self-promoted users.

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
| Self-promotion fix | **Deferred** this cycle (see [Open Items](#open-items--follow-ups)). |

---

## Architecture at a Glance

One authoritative allow-list (`admin_users`), reached only through one service (`AdminAccessService`). Bootstrap writes go in by **email**; consumers ask the service; nothing reads `profiles.role` for access.

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
| 4 | **A user self-sets `profiles.role = 'admin'`** | **Irrelevant** — no code reads `profiles.role` for access; they never appear in `admin_users`. (Closing the leftover self-promotion write is a tracked follow-up.) |

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
| 1 | **Close the self-promotion hole** in `app/api/user/profile/route.ts` (stop accepting `role='admin'` from the body; drop "Administrator" from `ProfileTabV2` options). | ⬜ Deferred | Intentionally out of scope this cycle. **Must** be closed before the admin dashboard ships, otherwise the old field remains a confusing shadow signal. |
| 2 | **Wire the gate into `/api/admin/*` routes.** This cycle delivered only the identity source; the routes still use the service-role key with no caller check. | ⬜ Todo | Add the `isAdmin` gate to each admin route (requirement AC-10 / Q1). |
| 3 | **`GET /api/admin/admins` route** to list admins over HTTP (gated by `AdminAccessService.isAdmin`), backed by `listAdmins()` / `listAdminEmails()`. | ⬜ Recommended | No HTTP endpoint exposes the admin list today — service/repo are server-side only. Needed for any UI that shows or manages admins. |
| 4 | **Admin management UI/API** (grant/revoke) instead of env/SQL only. | ⬜ Future | `AdminUserRepository` already supports `upsertByEmail` / `deactivateByEmail`. |
| 5 | **Audit-log admin grants/revocations** via `AuditTrailService`. | ⬜ Future | — |
| 6 | Decide whether to **retire `admin`/`viewer` from the `profiles.role` constraint** once nothing reads them for access. | ⬜ Future | Keep persona values; drop access-level values. |

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
