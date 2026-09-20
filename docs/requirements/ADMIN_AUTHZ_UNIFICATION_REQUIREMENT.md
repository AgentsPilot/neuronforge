# Requirement: Admin Authorization Unification

> **Last Updated**: 2026-09-20

**Created by:** BA
**Date:** 2026-09-20
**Status:** SA-reviewed 2026-09-20 — **APPROVED WITH CHANGES** (RC-1 … RC-14, see [SA Review](#sa-review)). Awaiting user decisions on **BQ-2 and BQ-3 only**; BQ-1/BQ-4/BQ-6 resolved by SA, BQ-5 re-scoped to one question for the deployment-access holder.
**Priority:** P0 (security)
**Worktree:** `C:/Users/Barak/My Projects/AgentsPilot/neuronforge-admin-authz` · branch `feature/admin-authz-unification` (off `origin/main` @ `0d7544c0`)

## Overview

AgentPilot has a trustworthy admin identity source (`admin_users` via `AdminAccessService`) and a canonical route gate (shipped in PR #61), but almost nothing uses them. Of the 44 route files under `/api/admin/`, **3 are on the canonical gate, 7 re-implement it by hand, 2 accept any signed-in user, and 32 are reachable by a fully anonymous caller**. The `/admin` pages have no server-side guard at all, and nothing in CI notices when a new admin surface ships without one.

This requirement defines the business outcome: **exactly one way to answer "is this caller a platform admin", applied to every admin API route and every admin page, with an automated gate so the same class of hole cannot reappear silently.** It is delivered as a sequence of small, independently shippable slices so each can be reviewed and deployed on its own.

---

## Table of Contents

1. [Business Context & Why Now](#business-context--why-now)
2. [Goal](#goal)
3. [User Stories](#user-stories)
4. [Current State — Measured](#current-state--measured)
5. [Category D in Full — All 32 Anonymous Routes](#category-d-in-full--all-32-anonymous-routes)
6. [Routes Where a Real Admin Check Breaks an Existing Caller](#routes-where-a-real-admin-check-breaks-an-existing-caller)
7. [Functional Requirements](#functional-requirements)
8. [Non-Functional Requirements](#non-functional-requirements)
9. [Delivery Slices](#delivery-slices)
10. [Acceptance Criteria](#acceptance-criteria)
11. [Definition of Done](#definition-of-done)
12. [Recommendation on F5 — Profile Self-Promotion](#recommendation-on-f5--profile-self-promotion)
13. [Out of Scope / Tracked Separately](#out-of-scope--tracked-separately)
14. [Notes on Integration Points](#notes-on-integration-points)
15. [Open Business Questions](#open-business-questions)
16. [SA Review](#sa-review) — **read before planning; contains 14 required changes and 5 inline corrections**
17. [Change History](#change-history)

---

## Business Context & Why Now

| Fact (measured 2026-09-20) | Business consequence |
|---|---|
| 32 admin route files accept an **anonymous** request | Anyone on the internet who knows a URL can read every platform user's data and rewrite platform-wide configuration (pricing tiers, credit rewards, model routing weights, system limits). |
| 2 more accept **any signed-in user** | Any customer can list every other customer, and can write to the store the admin Settings screen uses to manage admins. |
| 7 routes hand-copy the correct check | Seven places to get wrong; the next copy is the next bug. |
| `/admin` pages have **no server-side guard** | Admin screens render for anyone who types the URL. Whether they show data depends entirely on the API routes behind them — which is exactly what is broken. |
| No CI gate exists for this | The last two admin surfaces shipped without a guard and nobody noticed. There is no reason to expect the next one to be different. |
| The admin Settings screen writes to a store that no longer grants admin (F1) | An operator can "add an admin" and it silently does nothing. Access management is currently non-functional and unguarded. |

The repository is public and pre-launch. The cost of closing this now is a set of small diffs. The cost of closing it after launch is a disclosure event.

---

## Goal

> **"ONE way to validate that a caller is a platform admin, covering API routes, admin pages, and the database, so this class of gap cannot recur."** — user, 2026-09-20

Three parts, all required:

| # | Part | Outcome |
|---|---|---|
| G1 | **One answer** | A single named behaviour decides admin-or-not. No route, page, or component re-derives it. |
| G2 | **Full coverage** | Every `/api/admin/*` route and every `/admin` page is behind that behaviour, enforced on the server. |
| G3 | **Cannot recur silently** | An admin surface without its guard fails the build, not a future audit. |

---

## User Stories

- As the **platform owner**, I want every admin API and admin screen to refuse non-admins, so that customer data and platform economics cannot be read or rewritten by an outsider.
- As the **platform owner**, I want one place that decides who is an admin, so that granting or revoking access takes one action and takes effect everywhere.
- As a **developer**, I want adding an admin surface without a guard to fail my build, so that I cannot ship this hole by omission.
- As a **reviewer**, I want each change small enough to read in one sitting, so that a security fix is not buried in a refactor.
- As a **customer**, I want an admin URL to tell me nothing about the admin area and never show me another customer's data.
- As a **new engineer**, I want the admin access document to describe what the code actually does, so that I don't build on a false assumption.

---

## Current State — Measured

Source: `admin-authz-facts.md`, measured 2026-09-20 against `origin/main @ 0d7544c0`. 44 route files under `app/api/admin/`.

| Category | Files | Today's behaviour | Target |
|---|---|---|---|
| **A** — canonical gate | 3 | ✅ Correct | Unchanged |
| **B** — inline hand-copied check | 7 | ✅ Correct behaviour, duplicated | Move onto the one gate |
| **C** — signed-in, no admin check | 2 | 🔴 Any customer passes | Gate (plus F1 decision) |
| **D** — no auth at all | 32 | 🔴 Anonymous passes | Gate |

**Pages:** `app/admin/layout.tsx` is a client component with no guard; 21 `page.tsx` files sit under it. `middleware.ts` matches `/admin` but only performs onboarding redirect and subdomain rewrite — it performs no admin check, and it skips `/api` entirely, so nothing sits in front of `/api/admin/*`.

**CI:** two workflows exist (`bos-llm-typecheck.yml`, `plugin-tests.yml`). There is no general lint/test gate yet that an authz check could attach to.

> **[SA 2026-09-20 — addition]** Verified, and it is worse than "no gate to attach to": **neither workflow runs `npm test` at all.** `plugin-tests.yml` runs `test:plugins:unit` / `test:plugins:smoke`, path-filtered to `lib/server/**`, `lib/plugins/**`, `tests/plugins/**`; `bos-llm-typecheck.yml` runs a scoped `tsc`. A Jest guard test added today would run on the author's machine and nowhere else. Two consequences for slice 6, both in [SA Review §1](#1-does-this-achieve-cannot-recur): the slice must ship its **own workflow with no `paths:` filter**, and "fails the build" is only true once that workflow is a **required status check** on `main`.
>
> **[SA 2026-09-20 — addition]** The repo does already have the right *shape* for the guard, which the requirement does not reference: `lib/business-os/purge/__tests__/no-deletion-paths.guard.test.ts` (repo-wide static scan, allow-list-with-reason rather than deny-list, comment-stripper unit-tested against its own past bug) and `components/test-business-os/llm-usage/__tests__/boundaries.static.test.ts`. Slice 6 must follow that precedent, not invent a second static-guard pattern.

---

## Category D in Full — All 32 Anonymous Routes

Grouped by **what an anonymous caller can do**, not by folder. A file with both reads and writes appears in two groups; all 32 files are accounted for, and every file is named at least once.

### D1 — Platform configuration writes (16 files)

Changing these changes cost, behaviour, or limits for **every user on the platform**.

| Route | Verbs | What an anonymous caller could change |
|---|---|---|
| `agent-generation-config` | PUT | Agent generation behaviour |
| `ais-config` | POST | AIS scoring configuration |
| `ais-weights` | PUT | Model-routing weights |
| `ais-weights/combined` | PUT | Model-routing weights |
| `ais-weights/creation` | PUT | Model-routing weights |
| `boost-packs` | POST, PUT, DELETE | Purchasable credit packs |
| `calculator-config` | PUT | Pricing/savings calculator inputs |
| `execution-tiers` | POST, PUT, DELETE | Execution entitlement tiers |
| `helpbot-config` | PUT | Help bot configuration |
| `memory-config` | PUT | Agent memory configuration |
| `onboarding-config` | PUT | Onboarding flow configuration |
| `orchestration-config` | PUT | Orchestration + model routing |
| `reward-config` | POST | Credit reward amounts and eligibility rules |
| `storage-tiers` | POST, PUT, DELETE | Storage entitlement tiers |
| `system-limits` | PUT | Platform-wide limits |
| `ui-config` | POST | UI configuration |

**Treatment:** uniform. Admin-only, no exceptions. No legitimate non-admin caller exists for any of them.

### D2 — Destructive or operational actions (5 files)

| Route | Verbs | Effect |
|---|---|---|
| `backfill-embeddings` | POST | Kicks off a bulk background job |
| `memory-consolidation` | POST | Mutates stored agent memory |
| `messages/[id]` | PATCH, DELETE | Edits/deletes platform messages |
| `messages/[id]/replay` | POST | Re-sends a message |
| `migrate-labels` | POST | Bulk data migration |

**Treatment:** uniform, and **highest urgency** — these are irreversible or expensive, and `replay` can send communications on the platform's behalf. Ship in the first slice.

### D3 — Cross-tenant data reads (11 files)

Every one of these returns data about users who are not the caller.

| Route | Verbs | Exposure |
|---|---|---|
| `users` | GET | All platform users |
| `users/[id]/stats` | GET | Any named user's usage |
| `user-emails` | POST | Email addresses (a read shaped as a POST) |
| `onboarding-users` | GET | User onboarding state |
| `messages` | GET | Platform message log |
| `dashboard` | GET | Platform-wide operating metrics |
| `execution-stats` | GET | Platform-wide execution metrics |
| `storage-stats` | GET | Platform-wide storage metrics |
| `token-usage` | GET | Platform LLM spend |
| `token-usage/drill-down` | GET | Per-user LLM spend |
| `token-usage/stats` | GET | Aggregate LLM spend |

**Treatment:** uniform, admin-only. `user-emails` deserves a call-out in review because its POST shape may cause it to be mistaken for a write.

### D4 — Configuration reads (13 files, GET side)

| Route | Nature | Different treatment? |
|---|---|---|
| `reward-config` | GET | ⚠️ **Yes — has legitimate non-admin callers.** See next section. |
| `boost-packs` | GET | ⚠️ **Verify.** A catalogue of purchasable packs is plausibly needed by a customer-facing pricing/upgrade screen. |
| `execution-tiers` | GET | ⚠️ **Verify.** Same reasoning — plan/entitlement catalogue. |
| `storage-tiers` | GET | ⚠️ **Verify.** Same reasoning. |
| `agent-generation-config` | GET | No — internal tuning |
| `ais-config` | GET | No — internal tuning |
| `backfill-embeddings` | GET | No — job status |
| `helpbot-config` | GET | No |
| `memory-config` | GET | No |
| `memory-consolidation` | GET | No |
| `onboarding-config` | GET | No |
| `orchestration-config` | GET | No |
| `ui-config` | GET | No |

**Treatment:** admin-only by default. The four ⚠️ rows must have their callers enumerated before the read slice ships; any that turn out to be consumed by a customer-facing screen follow the same resolution pattern chosen for `reward-config` in **BQ-1**.

### Category C (for completeness — 2 files, not category D)

| Route | Verbs | Issue |
|---|---|---|
| `settings/admin-users` | GET, POST | 🔴 F1 — any signed-in user can write the admin list, **and it writes to `system_settings_config.admin_users`, a store that does not grant admin access.** Both unguarded and ineffective. |
| `settings/platform-users` | GET | 🔴 Any signed-in user can list every platform user. |

---

## Routes Where a Real Admin Check Breaks an Existing Caller

This section exists so that no slice ships a silent regression. It is based on the callers enumerated in the facts file (F2, F3, F4), each of which was read.

### Confirmed break — 1 route

| Route | Non-admin callers | What breaks | Business question |
|---|---|---|---|
| `GET /api/admin/reward-config` | `app/(protected)/agents/[id]/page.tsx:406`<br>`app/v2/agents/[id]/page.tsx:360`<br>`app/(protected)/agents/[id]/page.backup-20251101-215528.tsx:424` (dead backup file) | Both live agent-detail pages fetch the full reward configuration **only to learn whether the `agent_sharing` reward is active and what it pays**. Gating the route makes the share-reward indicator silently go dark for every customer. Note the route currently returns the *entire* reward and eligibility ruleset — thresholds, caps, per-month limits — to any anonymous caller. | **BQ-1.** Which reward facts are a customer entitled to see, and on what surface? |

### Confirmed *not* a break — 2 callers checked

| Caller | Route it calls | Why it is safe |
|---|---|---|
| `components/admin/AdminCalibrationTrigger.tsx` (F3) | `GET /api/admin/agents` (already category B / gated) | It deliberately probes the route and hides itself on 401/403. A working gate is its designed input, not a regression. This self-gating pattern must keep working after slice 4 — the gate must continue to answer 401/403, never 500. |
| `components/test-business-os/llm-usage/LlmUsageVerification.tsx` (F4) | `/api/admin/business-os/llm-usage/businesses` (already gated) | Internal test harness, operated by an admin, and the route is already admin-only today. |

### Unmeasured risk — must be enumerated before the read slice ships

The facts sweep enumerated callers only for the routes named in F2–F4. The four catalogue-style GETs flagged in D4 (`boost-packs`, `execution-tiers`, `storage-tiers`, and `reward-config` itself) are the plausible remaining breaks, because plan/pricing catalogues are the kind of thing a customer-facing upgrade screen reads. **Slice 2 does not ship until every caller of every read route it touches has been enumerated and each is confirmed admin-operated or explicitly resolved.** Any new break found is added to the table above with its own business question, not silently gated.

Separately, see **BQ-5**: no sweep can find a caller that lives outside this repository (an ops script, an uptime monitor, a scheduled job hitting `dashboard` or `execution-stats`).

---

## Functional Requirements

| # | Requirement |
|---|---|
| FR-1 | There is exactly **one** named behaviour that answers "is this caller a platform admin" for API routes. Every `/api/admin/*` route uses it and no route re-implements it. |
| FR-2 | That behaviour derives admin identity **only** from the `admin_users` source of truth. No access decision anywhere reads the user-writable profile role field. |
| FR-3 | The behaviour **fails closed**: if it cannot determine the answer, the answer is "no". |
| FR-4 | The behaviour answers **401 when not signed in** and **403 when signed in but not an admin**, and never a server error, so self-gating UI can rely on the distinction. |
| FR-5 | **No handler work** — no body parse, no business data read, no write, no job trigger, no outbound message — begins before the gate returns an admin. *(**Amended 2026-09-20 per RC-7.** The one write that is **part of the check** is `AdminAccessService`'s email→`user_id` self-heal: a write **by** the authorization, to the authorization's own table, for a caller who has just proven they are an admin. It is not handler work. Do not "fix" it — the previous wording made the gate violate this FR.)* |
| FR-6 | Denials are logged with the user identifier only. Email addresses are not written to logs. |
| FR-7 | Every page under `/admin` is protected **on the server** before any admin content is produced. A client-side check is not sufficient and does not satisfy this requirement.<br><br>*(**Amended 2026-09-20 per RC-10.**) The page guard is **defence-in-depth**. **The API gate (FR-1 … FR-5) is the security boundary** — a reader of the original wording would conclude the opposite, and would test the wrong thing. Three escapes are acknowledged rather than assumed away:<br>**E1** — a `route.ts` under `app/admin/` is **not** wrapped by layouts. Zero exist today; FR-10(c) keeps it that way.<br>**E2** — layouts do **not** re-render on client-side soft navigation between sibling pages, so the guard runs on entry to the subtree and on full loads. Acceptable **only because** the API gate makes the underlying data unreachable.<br>**E3** — admin content at a URL outside `/admin` is outside this boundary (e.g. `app/api/v2/calibrate/batch/route.ts:116`). Out of scope; stated as a boundary.* |
| FR-8 | A non-admin reaching an `/admin` URL gets the experience chosen in **BQ-3** (**= option A**, silent redirect to the normal dashboard), consistently across all 21 pages. An **anonymous** visitor and a **signed-in non-admin** must receive an **identical** response — otherwise the difference between them is itself the disclosure the option exists to prevent. |
| FR-9 | Admin page protection is **inherited, not opted into** — adding a new page under `/admin` is protected by default, without the author doing anything. |
| FR-10 | **CI fails by SHAPE, not by path** *(**widened 2026-09-20 per RC-4**; a guard scoped to files we already know about is structurally incapable of finding the next one)*. The guard fails on:<br>**(a)** a `route.ts` under `app/api/admin/**` that does not use the one gate;<br>**(b)** **any** `route.ts` anywhere that imports `AdminAccessService` directly — this is what stops the de-duplication silently regressing and what catches the next inline copy landing in a different folder;<br>**(c)** any `route.ts` under `app/admin/**` (0 today — keep it 0, because route handlers are **not** wrapped by layouts);<br>**(d)** any file under `app/`, `lib/`, `components/` or `hooks/` making an access decision from `profiles.role`;<br>**(e)** any migration adding an RLS policy that references `profiles.role`. |
| FR-11 | Exceptions to FR-10 are possible but must be **explicit, named, justified in the file, and visible in review**. An exception is never the default. |
| FR-12 | `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` describes what the code actually does, including an honest statement of where the profile role field is still read. |
| FR-13 | Admin management (who can grant or revoke admin) operates on the store that actually grants access, or the non-functional management surface is removed. Resolved by **BQ-2 = option B: the surface is removed.** |
| FR-14 | No customer-visible capability is removed without a decision. Where a gate would remove one (`reward-config`), the capability is preserved through the resolution chosen in **BQ-1**. |
| **FR-15** | *(**Added 2026-09-20 per RC-5.**)* The database-side admin predicate is **`public.is_platform_admin()`**. No RLS policy may express admin-ness any other way, and **never** via `profiles.role`. |
| **FR-16** | *(**Added 2026-09-20 per RC-5.**)* **Sync invariant.** There is **one source of truth (`admin_users`) and two enforcement mechanisms, one per runtime**: `AdminAccessService.isAdmin()` in Node, `public.is_platform_admin()` in SQL. These are **not** to be unified — Node cannot evaluate a Postgres policy and Postgres cannot call the service. The **only** permitted divergence is the `ADMIN_EMAILS` bootstrap and the email self-heal, which are **app-side only** (Postgres has no access to the environment). Consequence, which must be documented: *an admin who exists only in `ADMIN_EMAILS` and has never made an API call passes every app-code check and fails every RLS policy.* |
| **FR-17** | *(**Added 2026-09-20 per RC-5.**)* The FR-10 guard fails on a **new migration** adding an RLS policy that references `profiles.role`. A broader "new table without `ENABLE ROW LEVEL SECURITY`" check is valuable but is **explicitly out of scope** of this requirement. |

---

## Non-Functional Requirements

| Area | Requirement |
|---|---|
| **Performance** | The check runs on every admin request and every admin page render. It must not add a perceptible delay; the existing short-lived caching of the admin set is sufficient and must not be bypassed per-request. |
| **Security** | Fail closed everywhere. The admin allow-list is never returned to a non-admin surface. Denial responses reveal nothing about whether the resource exists or who the admins are. |
| **Availability** | An outage of the identity store denies admin access rather than granting it. Existing graceful-degradation behaviour (preferring a slightly stale admin set over failing) is retained so a transient blip does not lock the operator out. |
| **Observability** | Every denial is attributable: who, which surface, when. Enough to distinguish "operator misconfigured" from "someone is probing". |
| **Accessibility** | The non-admin experience on an `/admin` URL is a normal, navigable page — not a blank screen, a spinner that never resolves, or a raw error. |
| **Reviewability** | No slice mixes a security change with an unrelated refactor. Each slice is readable in one sitting. |
| **Compatibility** | The self-gating UI pattern (a component that hides itself on 401/403) continues to work unchanged. |

---

## Delivery Slices

Ordering principle: **highest blast radius first, then the lock that stops recurrence, then correctness of the management surface and docs.** Each slice is independently deployable — it leaves the system strictly safer than before and does not depend on a later slice to be correct.

| # | Slice | Scope | Independently shippable because | Risk |
|---|---|---|---|---|
| 1 | 🔴 **Stop anonymous writes and destructive actions** | All write/action verbs across D1 (16 files) + D2 (5 files) + the write on category C `settings/admin-users` | Closes the highest-consequence hole in one reviewable diff. Nothing legitimate calls these except the admin UI, which is operated by an admin. Reads are untouched, so no customer-facing screen can regress. | Low |
| 2 | 🔴 **Stop cross-tenant data reads** | D3 (11 files) + category C `settings/platform-users` + the non-⚠️ D4 config reads | Pure "deny where nobody legitimate is asking". Gated on completing the caller enumeration described above. Excludes every ⚠️ route, so it cannot break a customer screen. | Low–Medium |
| 3 | 🟡 **Resolve the customer-visible config reads** | `reward-config` GET plus any of `boost-packs` / `execution-tiers` / `storage-tiers` GET found to have customer callers | The only slice that changes what a customer sees. Isolating it means the decision in BQ-1 blocks one small slice, not the whole programme. | Medium |
| 4 | 🟢 **One gate, one implementation** | Move the 7 category B inline copies onto the canonical gate; delete the inline copy in `business-os/llm-usage` | Pure de-duplication with no behaviour change — the 7 routes are already correct. Deployable any time; deliberately placed after the P0 slices because it buys hygiene, not safety. Verify the self-gating component (F3) still works. | Very low |
| 5 | 🔴 **Server-side guard for `/admin` pages** | All 21 pages, protected by inheritance (FR-9), plus the non-admin experience from BQ-3 | Entirely independent of the API work — different surface, different failure mode. Ships even if slices 1–3 are still in review. | Medium (UX) |
| 6 | 🟢 **CI gate** | Fail the build on an admin route without the gate or an admin page outside the boundary; explicit reviewed exception list | Only meaningful once 1–5 make the repo clean — introduced earlier it is red on day one and gets ignored. This is the slice that delivers goal G3. | Low |
| 7 | 🟡 **Fix admin management (F1)** | Per BQ-2: either point the Settings screen at the real admin store, or retire it | Correctness of *who* is an admin, separate from *where* the check runs. Slices 1–6 are correct without it. | Medium |
| 8 | 🟢 **Correct the documentation** | Rewrite `ADMIN_IDENTIFICATION_AND_ACCESS.md` to the as-built state; close its open items 1–2 or restate them truthfully; record the exception list | Doc-only. Last because it describes the finished state; interim doc edits would be rewritten twice. | None |

**Note on slice 4's position.** It could be pulled to the front as a warm-up that proves the pattern on 7 already-correct routes before touching 32 broken ones. That is a legitimate preference; BA recommends security-first ordering because slice 4 delivers no risk reduction and the anonymous write surface is live today.

**Note on a possible slice 4.5.** See **BQ-6** — the project logging standard implies converting `console.*` logging in every file these slices touch. If bundled, it roughly doubles each diff.

---

## Acceptance Criteria

### Per slice

- [ ] **Slice 1** — Every D1 and D2 write/action verb refuses an anonymous request and refuses a signed-in non-admin. No read behaviour changed. The admin UI's write paths still work when operated by an admin.
- [ ] **Slice 2** — Every D3 route and the category C read refuse anonymous and non-admin callers. A caller enumeration for each touched route is recorded in the PR, showing zero customer-facing callers.
- [ ] **Slice 3** — The share-reward indicator on both agent-detail pages behaves exactly as it does today for a normal customer, and the full reward ruleset is no longer readable by a non-admin.
- [ ] **Slice 4** — Zero hand-written admin checks remain in any route file; the `business-os/llm-usage` inline copy is deleted. Behaviour of the 7 routes is unchanged, and the self-gating admin component still hides itself for non-admins and appears for admins.
- [ ] **Slice 5** — A signed-out visitor and a signed-in non-admin both get the BQ-3 experience on all 21 `/admin` pages, with no admin data present in the server response. An admin is unaffected. A newly added page under `/admin` is protected without its author taking any action.
- [ ] **Slice 6** — CI fails on a deliberately introduced unguarded admin route, and fails on a deliberately introduced unprotected admin page. CI passes on the clean repo. The exception list is empty or every entry carries a written justification.
- [ ] **Slice 7** *(**AC corrected 2026-09-20 per RC-8**)* — Under **BQ-2 = option B**, the non-functional management surface is **removed**, and granting or revoking an admin through the retained bootstrap path (`supabase/migrations/20260701_seed_admin_users.sql` / `scripts/seed-admin-users.ts`) takes effect **within the `AdminAccessService` cache TTL (60 s)** in app code and **immediately** in RLS (`public.is_platform_admin()` is `STABLE`, evaluated per statement, uncached). Performing it requires Supabase access; the action is attributable via `admin_users.notes` / `updated_at`. **The 60 s cache is not removed** — NFR-Performance protects it.

  > **[SA 2026-09-20 — correction — NOW APPLIED ABOVE]** "on the next admin request" is not achievable and must not be written as an acceptance criterion. `AdminAccessService` caches the admin set for 60 s (`CACHE_TTL_MS = 60_000`, `lib/services/AdminAccessService.ts:41`), per Node process. Revocation therefore takes effect **within 60 seconds** in app code, and **immediately** in RLS (`public.is_platform_admin()` is `STABLE`, evaluated per statement, uncached). Correct the AC to "within the cache TTL (60 s)" and state the app/DB asymmetry — do **not** remove the cache, which NFR-Performance rightly protects.
- [ ] **Slice 8** — The access document matches the code, names every remaining reader of the profile role field, and no longer claims that nothing reads it.

### Programme-wide

- [ ] Every one of the 44 route files is in a known end state: gated, or a documented exception.
- [ ] Every one of the 32 category D routes is accounted for in this document and closed by a slice.
- [ ] No customer-facing behaviour changed except where a business question was answered.
- [ ] Denial responses carry no user email and no information about the admin allow-list.
- [ ] Failure paths are tested, not just happy paths: anonymous, signed-in non-admin, and identity-store-unavailable all deny.

---

## Definition of Done

Tied line-by-line to the goal sentence.

| Goal fragment | Done when |
|---|---|
| *"ONE way to validate that a caller is a platform admin"* | There is a single named behaviour, backed by the single `admin_users` source of truth. Searching the repository for an admin decision finds exactly that one behaviour and its callers — no inline copies, no second definition, no parallel store, no access decision reading the user-writable profile role field. |
| *"covering API routes"* | All 44 `/api/admin/*` route files sit behind it, with any exception explicit, justified in the file, and listed in the docs. |
| *"...admin pages"* | All 21 `/admin` pages are protected on the server by inheritance, so a new page is protected before its author writes a line of it. |
| *"...and the database"* | *(**Rewritten 2026-09-20 per RC-5 and RC-13.** The previous wording was an IOU, and it was out of date.)*<br><br>**1. The predicate exists and is named.** `public.is_platform_admin()` (`supabase/migrations/20260920a_lock_system_settings_and_pricing_rls.sql:133-160`) — `STABLE SECURITY DEFINER`, `SET search_path`, true iff an `is_active` `admin_users` row matches `auth.uid()` **or** the JWT email; `REVOKE ALL … FROM PUBLIC`. It is already the predicate behind the `ai_model_pricing` and `system_settings_config` policies, in production as of 2026-09-20.<br><br>**2. One source of truth, two mechanisms — not unified (FR-16).** `admin_users` is the single source; `AdminAccessService.isAdmin()` enforces in Node, `public.is_platform_admin()` in SQL. Do not attempt to unify them.<br><br>**3. The divergence is written down, not left as a comment in one migration.** `ADMIN_EMAILS` and the email self-heal are app-side only ⇒ *an env-only admin passes every app check and fails every RLS policy.*<br><br>**4. Revocation semantics are stated (RC-8):** **within the 60 s `AdminAccessService` cache TTL** in app code; **immediately** in RLS. The cache is deliberate and is retained.<br><br>**5. ⚠️ The gap this does NOT close (RC-13).** Most of the formerly-anonymous admin routes construct a **service-role client inline** (e.g. `app/api/admin/reward-config/route.ts:10-13`, at module scope). Once gated they are admin-only — but they still bypass **both** RLS **and** the repository layer (CLAUDE.md mandatory rule 1). **They are gated, not isolated.** This is a known, deliberate, tracked deferral, not coverage.<br><br>**6. The one genuine unknown is named and owned.** Whether a policy existing **only** in the live database (not in this repo's migrations) still trusts `profiles.role` is a `pg_policies` read, tracked under the existing "DB RLS holes: settings & pricing" item — never an unknown left unsaid. |
| *"so this class of gap cannot recur"* | Adding an admin route or admin page without its guard **fails the build**. The failure names the offending file and what to do. Removing the CI gate is itself a visible change in review. A gap can still be introduced deliberately, with a written exception — it can no longer be introduced silently. |

Additionally: the access document is true on the day the last slice merges, and the user has signed off on every business question below.

---

## Recommendation on F5 — Profile Self-Promotion

**The finding, as corrected 2026-09-20 (RC-6 — APPLIED).** `app/api/user/profile/route.ts:124` copies a `role` value straight from the request body onto the caller's own profile. **Any customer can set their own profile role to `admin`.**

**What that does NOT do.** Under `AdminAccessService` it grants nothing — the service never reads that field. And a repo-wide sweep for an **access decision** keyed on that column — `role === 'admin'` in any spelling across `lib/`, `app/`, `components/`, `hooks/` — returns **zero hits**, verified twice (BA sweep + SA sweep, 2026-09-20). Specifically:

- `lib/server/route-identity.ts:118-131` resolves admin **only** through `adminAccessService.isAdmin(...)`. Its line 121 is a **comment** reading "never profiles.role (CLAUDE.md security rules)".
- `lib/business-os/purge/purgeAuthz.ts:23-26` likewise — `AdminAccessService` only; the `profiles.role` mention is a comment **forbidding** it.
- Every surviving read of the column is **display or onboarding persona**: `lib/repositories/UserProfileRepository.ts:51`, `components/onboarding/hooks/useOnboarding.ts`, `app/api/admin/onboarding-users/route.ts:24`.
- The database half: `supabase/migrations/20260920a_lock_system_settings_and_pricing_rls.sql` **replaced** the `profiles.role` policies — the old policy survives only as a **commented** rollback at lines 311-312.

> **Corrected shape of F5: one self-promotion write, zero app-code access readers, and the DB policies that read it already replaced.** The one genuinely unmeasured thing is whether a policy existing **only in the live database** still trusts the column — a `pg_policies` read, not a slice.
>
> **Consequence for the reasoning below:** the "different investigation" argument **dissolves** (the discovery is done; the answer is "nobody reads it for access"). The decision rests on **different blast radius** alone — the remaining work sits on `PUT /api/user/profile`, a customer-facing route, and the real question is a data-model one: which `role` values are onboarding personas and which are access levels, which reaches `supabase/SQL Scripts/20251118_update_profiles_role_constraint.sql` and the onboarding flow. That is **one grep**, not a discovery phase — say so, so the separate item is not over-estimated and therefore never scheduled.

<details><summary>Original (superseded) wording and the SA correction that replaced it</summary>

> ~~The field **is** still read elsewhere: database row-level policies …, `lib/server/route-identity.ts`, and `lib/business-os/purge/purgeAuthz.ts`. Each of those three must be individually verified.~~

> **[SA 2026-09-20 — CORRECTION. The sentence above is factually wrong and must be replaced before this requirement is approved.]**
>
> Two of the three named readers do not read the field. Verified in the worktree:
> - `lib/server/route-identity.ts:118-131` resolves admin **only** through `adminAccessService.isAdmin(...)`. Its line 121 is a *comment* reading "never profiles.role (CLAUDE.md security rules)".
> - `lib/business-os/purge/purgeAuthz.ts:23-26` likewise — `AdminAccessService` only; the `profiles.role` mention is a comment forbidding it.
>
> A repo-wide sweep for an **access decision** keyed on that column — `role === 'admin'` in any spelling across `lib/`, `app/`, `components/`, `hooks/` — returns **zero hits**. Every surviving read of the column is display or onboarding persona (`lib/repositories/UserProfileRepository.ts:51`, `components/onboarding/hooks/useOnboarding.ts`, `app/api/admin/onboarding-users/route.ts:24`).
>
> The database half is also out of date: `supabase/migrations/20260920a_lock_system_settings_and_pricing_rls.sql` **replaced** the `profiles.role` policies rather than partially addressing them — the old policy survives only as a commented rollback at lines 311-312. What remains genuinely unmeasured is whether a policy that exists **only in the live database** and not in this repo's migrations still trusts the column. That is a `pg_policies` read, not a slice.
>
> **Corrected shape of F5: one self-promotion write, zero app-code access readers, and the DB policies that read it already replaced.** See [SA Review §5](#5-f5-verdict) — this strengthens the case for keeping F5 separate, but it dissolves the BA's "different investigation" argument, so the reasoning table below must be re-based on "different blast radius" alone.

</details>

**BA recommendation: keep F5 as a separate tracked item, not a slice of this requirement — but make it impossible to forget.**

Reasoning:

| Argument | Detail |
|---|---|
| **Different blast radius** | This requirement touches admin-only surfaces; a bad slice inconveniences the operator. F5 touches the customer profile API, the customer settings UI, database policies, and two authorization helpers. A bad fix breaks signup, onboarding personas, or a customer's ability to save their profile. Mixing them makes the P0 admin slices riskier and slower to review. |
| ~~**Different investigation**~~ | ~~F5 is not "remove one line" … re-measuring three readers plus live database policies.~~ **STRUCK 2026-09-20 per RC-6.** There is no three-reader discovery task: the sweep is done and the answer is "nobody reads it for access". The remaining data-model question (which `role` values are personas vs access levels) is **one grep**. This argument no longer carries weight and must not be cited as a reason to defer. |
| **It does not block this goal** | Slices 1–8 deliver "one way to answer is-this-caller-an-admin" whether or not F5 is closed, because the one way never consults that field. |
| **It is genuinely urgent on its own** | If a database policy still grants elevated access based on a self-settable field, that is a live privilege-escalation path that exists with or without this work. It deserves its own P0 item with its own owner — not to be absorbed as a footnote in a sweep. |

**Two pieces of F5 that must be pulled into this requirement anyway** (both cheap, both protect the goal):

1. **Slice 8** must state the truth: the access document currently claims no code reads the profile role for access (F6). It must instead name the three readers, their verified status, and the tracking reference.
2. **Slice 6's** CI gate should treat *a new access decision that reads the profile role field* as a failure, with the existing readers recorded as a dated, named exception list. Without this, the "cannot recur" promise is only half true — a future developer could reintroduce exactly the pattern we just removed, through the other door.

**The decision is the user's — see BQ-4.**

---

## Out of Scope / Tracked Separately

Per the user's instruction, anything not core to "one admin check, everywhere, permanently" is recorded here rather than pulled in.

| # | Item | Why out | Where it goes |
|---|---|---|---|
| 1 | **F5 — profile self-promotion write** and the three readers of that field | See recommendation above. Pending BQ-4. | New P0 item, own owner |
| 2 | **Database policies that trust the profile role field** | Database-layer work with its own migration and verification cycle; partially addressed 2026-09-20 and needs re-measurement. | Existing "DB RLS holes: settings & pricing" item |
| | ⚠️ **[SA 2026-09-20]** Partly wrong, and partly in scope. The repo's policies were **replaced**, not partially addressed (see the correction under F5). More importantly, the database is one of the three surfaces the goal names — it cannot be wholly out of scope. The *canonical DB predicate already exists* (`public.is_platform_admin()`); naming it and stating the sync invariant belongs **in** this requirement. Only the live-database `pg_policies` re-measurement stays out. See [SA Review §4](#4-the-database-layer). | | |
| 3 | **Admin management UI (grant/revoke + audit trail)** and a `GET /api/admin/admins` endpoint | Already tracked as items 3–5 in the access doc. Slice 7 only resolves the *broken* management surface, it does not build the good one. | Access doc open items |
| 4 | **Repository-pattern violations in the touched routes** — many category D routes create a service-role database client directly instead of going through a repository | A mandatory project standard and a real issue, but fixing 30+ routes' data access inside a security sweep destroys reviewability. | ✅ **Now scoped and documented as a follow-up programme** — see **[Follow-up Programme — Admin Routes Repository Conformance](/docs/workplans/admin-authz-unification.md#follow-up-programme--admin-routes-repository-conformance)**. |
| | 📋 **[Dev 2026-09-20 — expanded at the user's request:** *"all these admin files that have direct access to DB need to go through repositories. See if we can reuse an existing repository. Document for now and we come back to it."***]** Measured: **38 of 44** route files do direct DB access; **31** construct their own `createClient`, **25** of those at module scope; **14 tables already have an owning repository to reuse**; **6 table groups** would need a new one. Starts **after slice 1 is committed** — a separate programme, **not** a slice here.<br>⚠️ **Blocked on one SA decision:** these are cross-user admin reads **by design**, so the methods they need are **not** the standard `.eq('user_id', userId)` shape that is itself the security property the repository layer enforces (mandatory rule 4). **How an admin-scoped repository method is expressed without becoming a hole a non-admin caller can reach must be decided BEFORE any conversion starts.** Slice 3's projection is the first instance of the pattern and sets the precedent. | | |
| 5 | **`console.*` logging in the touched route files** | Required by the project logging standard; see BQ-6 for whether it is bundled or becomes slice 4.5. | Slice 4.5 or per-slice, per BQ-6 |
| 6 | **The dead backup file** `app/(protected)/agents/[id]/page.backup-20251101-215528.tsx` | Unrelated cleanup that happens to appear in the caller list. | Housekeeping item |
| 7 | **Retiring the access-level values from the profile role constraint** | Depends on item 1 and 2 landing first. | Access doc open item 6 |

---

## Notes on Integration Points

| Area | Touched | Note |
|---|---|---|
| `lib/admin/requireAdminRoute.ts` | Read-only unless FR-4 needs reinforcing | Already the canonical gate, already tested. |
| `lib/services/AdminAccessService.ts` / `AdminUserRepository` | Read-only | The single source of truth. Not changed by this work. |
| `admin_users` table | Read; written only by slice 7 | Service-role write only. |
| `system_settings_config` key `admin_users` | Slice 7 | The wrong store the Settings screen writes to today (F1). |
| `app/api/admin/**` (44 files) | Slices 1–4 | — |
| `app/admin/**` (layout + 21 pages) | Slice 5 | Layout is currently a client component with no guard. |
| `middleware.ts` | Read-only | Skips `/api` entirely; not a viable place for the API check. Matches `/admin` but does no admin work today. |
| Agent-detail pages (`(protected)` and `v2`) | Slice 3 only | The only customer-facing screens in scope. |
| `components/admin/AdminCalibrationTrigger.tsx` | Verified, not changed | Depends on 401/403 semantics (FR-4). |
| CI workflows | Slice 6 | No general lint/test workflow exists yet to attach to. |
| `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` | Slice 8 | Currently stale (F6). |

---

## Open Business Questions

> ## ⚠️ ALL SIX ARE SETTLED AS OF 2026-09-20 — RC-14 APPLIED
>
> **Nothing below is open.** The discussion is retained as the record of *why* each was decided; the table is the answer. QA tests against the **Decision** column, not the options tables.
>
> | BQ | Decision | Decided by | Where implemented |
> |---|---|---|---|
> | **BQ-1** — reward facts | **Option A.** Publish only the customer-entitled fact (`isActive` for `agent_sharing`) on a customer-readable path; gate `GET /api/admin/reward-config` **in the same commit**. Verified: both callers read exactly one boolean. **Implemented as a read-only *projection* over `reward_config` through `lib/repositories/` — NOT a mirror and NOT via `/api/system-config`** (SA workplan review W-3; see also N-4 below). **No migration.** | **SA** (not a business question) | Slice 3 |
> | **BQ-2** — how admins are added | **Option B.** **Retire** the admin Settings admin-management screen and its write path now. Admins are managed through the existing bootstrap path until the platform needs self-service. **Do NOT build grant/revoke in this programme.** Option C (gate the non-functional screen) is **ruled out** — it fails FR-13 outright. True cost of B: there are exactly two seeded admins (the owner and the deployment-access holder); adding a third means editing and re-running `20260701_seed_admin_users.sql`, i.e. **it requires Supabase access**. | **User, 2026-09-20** | Slice 7 |
> | **BQ-3** — non-admin experience on `/admin` | **Option A.** Silently redirect to the normal dashboard (`/business-os`). **Constraint (i):** an anonymous visitor and a signed-in non-admin must receive an **identical** response — otherwise the difference is itself the disclosure. **Constraint (ii):** the failure mode is accepted — combined with BQ-2 option B, an operator whose admin row is missing gets a silent redirect and no in-product way to find out why. That is what the pre-flight verification exists to prevent. | **User, 2026-09-20** | Slice 5 |
> | **BQ-4** — F5 now or separate | **Option A — separate P0 item.** Zero app-code access readers and DB policies already replaced, so F5's live exposure is a self-promotion write with no consumer. It does not belong in a P0 admin sweep. **Two pull-ins are mandatory, not optional:** (a) the docs must state the corrected truth; (b) the CI guard must fail any **new** access decision reading `profiles.role`, allow-list starting **empty**. **The user's part is a scheduling commitment with a named owner — not a technical fork.** | **SA**, endorsed by **User, 2026-09-20** | Guard rule (d) in slice 1; docs in slice 8; the fix itself is **out of scope** |
> | **BQ-5** — external callers | **In-repo sweep complete and NEGATIVE** — no cron (`vercel.json`: 14 entries, none under `/api/admin/`), no webhook, no server-to-server caller. What a repo sweep structurally cannot see is an uptime monitor or ops script outside the repo. **One question, to one person** — the deployment-access holder and second seeded admin: *"does anything you run poll an `/api/admin/…` URL?"* **Blocks slices 1 and 2 only; does not block 3–8.** | **SA** (re-scoped); answer pending — see Pre-flight Record | Slice 0 |
> | **BQ-6** — logging conformance | **Option B + amendment.** Security slices stay minimal; a logging-conformance slice follows **immediately after** the slice that touched the files (1 → 1L, 2 → 2L), **not** at the end. CLAUDE.md's logging rule requires the conversion to be *surfaced and proposed*, not that it ship in the same commit. `app/api/admin/reward-config/route.ts`'s per-request `console.log` of the request URL goes in **1L**, not a backlog. | **SA** | Slices 1L, 2L |

<details><summary>Original discussion, retained as the decision record</summary>

Each is a decision about what the business wants, with impact, options, and a BA recommendation. The user decides.

---

### BQ-1 — What are customers entitled to know about reward terms, and where should they read it?

**Impact.** Today the reward configuration endpoint is readable by anyone on the internet and returns the complete reward ruleset — amounts, eligibility thresholds, minimum success rates, monthly and lifetime caps. Two live customer screens call it, but only to show one thing: whether the agent-sharing reward is active and what it pays. If we simply lock the endpoint, that indicator goes dark for every customer. If we leave it open, our full incentive ruleset stays public and editable-adjacent.

> **[SA 2026-09-20 — correction + resolution]** This is not a business question; SA resolves it. Verified in the worktree:
> - `app/(protected)/agents/[id]/page.tsx:404-424` reads exactly one value — `is_active` on the reward whose `reward_key === 'agent_sharing'`. Nothing else.
> - `app/v2/agents/[id]/page.tsx:360` fetches the same route in a `Promise.all`, and in the **same** `Promise.all` at line 358 already fetches `agent_sharing_reward_amount` from `systemConfigApi.getByKeys(...)` → **`GET /api/system-config`, a non-admin, customer-readable endpoint.**
>
> So "what it pays" is *already* published to customers through a different route. The only fact still sourced from the admin endpoint is one boolean. There is no trade-off left to decide between options A/B/C: A is strictly better and costs one config key on a path that already exists.
>
> **Decision (SA): option A**, implemented as a single boolean on the existing `/api/system-config` path — no new endpoint, no new pattern (CLAUDE.md mandatory rule 7) — with `GET /api/admin/reward-config` gated in the same commit. BQ-1 is closed; it does not go to the user.

**Options.**

| Option | Customer sees | Trade-off |
|---|---|---|
| **A** — Publish the small set of customer-relevant reward facts (is it active, what it pays) on a customer-facing surface; the admin endpoint becomes admin-only | Unchanged | Best outcome; costs one small customer-facing read path |
| **B** — Leave the admin endpoint readable by any signed-in customer | Unchanged, plus the full ruleset | Cheapest; keeps our incentive thresholds and anti-abuse caps visible to anyone with an account — an invitation to game them |
| **C** — Lock it and drop the reward indicator from the agent pages | Loses the share-reward prompt | Cheapest to build; removes a growth mechanic |

**BA recommendation: A.** The customer needs two facts, not the ruleset. The eligibility thresholds and abuse caps are exactly the part that should not be public. A is the only option that improves both the security and the product posture, and it is a small piece of work isolated in slice 3.

---

### BQ-2 — From now on, how are platform admins added and removed?

**Impact.** The admin Settings screen today writes the admin list into a store that no longer grants admin access, and any signed-in customer can perform that write. So an operator who "adds an admin" through the UI gets silence — nothing happens — while a customer who finds the endpoint can write to it freely. Access management is both non-functional and unguarded.

**Options.**

| Option | Operator experience | Trade-off |
|---|---|---|
| **A** — Rebuild the screen against the real admin list (grant, revoke, with an audit record) | Self-service admin management in the product | The right destination; the largest piece of work in this programme and the only one that is a feature rather than a fix |
| **B** — Retire the screen now; admins are managed by the operator through the existing bootstrap path until the platform needs self-service | No UI; a deliberate operator action instead | Removes a misleading and unguarded write immediately, at almost no cost. Acceptable while the admin group is the platform owner. |
| **C** — Keep the screen, just gate it | Screen looks like it works; still does nothing | Worst of both — a gated lie |

**BA recommendation: B now, A when the admin group grows beyond the owner.** The admin set is currently tiny and rarely changes. B deletes a security hole and a confusing dead feature in one small slice; A can be scheduled honestly as a feature rather than smuggled into a security fix. C is not acceptable.

---

### BQ-3 — What should a customer experience when they open an admin URL?

**Impact.** 21 admin pages. What a non-admin sees is a posture choice: do we confirm that an admin area exists at this address, or say nothing?

**Options.**

| Option | Experience | Trade-off |
|---|---|---|
| **A** — Silently send them to their normal dashboard | "That link just took me home" | Reveals nothing. Slightly confusing for an operator who lost their admin access and doesn't know why |
| **B** — Show the standard "page not found" | "There's nothing here" | Reveals nothing; consistent with the rest of the product's not-found handling |
| **C** — Show an explicit "you don't have access" | "There is an admin area and I'm not in it" | Clearest for a legitimate operator debugging their own access; confirms the admin area exists to anyone probing |

**BA recommendation: A.** Pre-launch, on a public repository, we should not confirm to a prober that an admin surface exists at a guessed URL. The operator population is one person who knows their own access status, so C's debugging benefit is near zero, and denials are logged and attributable regardless.

---

### BQ-4 — Do we fix the profile self-promotion hole now, or track it as its own P0?

**Impact.** Any customer can set their own profile role to `admin`. That does not make them a platform admin under our admin check — but three other places in the system still read that field, including database-level access policies. Bundling it here makes this programme touch customer-facing signup and profile flows. Not bundling it leaves a live, separately-owned escalation path open for as long as it stays unowned.

**Options.**

| Option | Consequence |
|---|---|
| **A** — Separate P0 item with a named owner and a date; this programme only tells the truth about it in the docs and blocks *new* readers in CI | Admin slices stay small, fast, and low-risk. The hole stays open until that item is worked — so it must actually be scheduled, not filed. |
| **B** — Add it as a slice here | One programme closes everything; but this programme's blast radius grows from admin-only to every customer's profile save, and the P0 admin slices wait behind a discovery task |
| **C** — Close only the write (stop accepting a role from the request body), leave the three readers for the separate item | Small, immediately reduces the attack surface to "whoever already self-promoted"; does not close the escalation for existing self-promoted rows and needs a check for whether any legitimate flow sets the role through that path |

**BA recommendation: A, with C as an acceptable compromise if the user wants something closed this week.** A keeps the admin sweep shippable in small pieces, which is what the user asked for. C is genuinely tempting and cheap — the caveat is that it needs a quick check that onboarding does not legitimately set the persona through that same field, which is exactly the discovery work that makes it a separate item. Option B is not recommended: it converts a set of low-risk admin-only diffs into a customer-facing change.

---

### BQ-5 — Does anything outside this codebase call these admin endpoints?

**Impact.** A repository sweep cannot find an ops script, an uptime monitor, a spreadsheet, a scheduled job, or a partner integration that polls something like the platform dashboard or execution stats. If one exists, slices 1 and 2 break it silently — and the fix is not "open the endpoint again", it is a proper service credential, which is a separate piece of work.

**Options.**

| Option | Consequence |
|---|---|
| **A** — Assume none exists and ship; treat any breakage as a fast follow | Fastest. Risk is an operator-visible outage of an internal tool, not a customer outage |
| **B** — Confirm first with whoever operates the platform (including the coworker who holds deployment access), then ship | One conversation's delay; eliminates the surprise |

**BA recommendation: B, scoped to a single question.** The user does not hold deployment access, which means at least one other person interacts with this system operationally. One message answers it, and slice 1 is the single most disruptive-if-wrong change in this programme. If the answer is "none", record it in the slice 1 PR and move on.

---

### BQ-6 — Do we bring the touched files up to the project logging standard in the same change?

**Impact.** The project standard is that any file we touch must move off ad-hoc console logging onto structured logging. These slices touch roughly 39 route files, many of which log heavily and informally — one of them logs its full configuration payload on every request. Applying the standard is correct, but it roughly doubles each diff, and it mixes a "did we close the hole" review with a "did we rename the log lines" review.

**Options.**

| Option | Consequence |
|---|---|
| **A** — Convert each file in the slice that touches it | Follows the standard literally. Security diffs get noisy; a reviewer has to separate signal from formatting |
| **B** — Security slices stay minimal; one dedicated logging-conformance slice immediately after, covering exactly the files touched | Each review answers one question. The standard is met within the same programme, just one merge later |
| **C** — Defer entirely to a separate item | Smallest diffs; the debt is likely to sit |

**BA recommendation: B.** The user's standing preference is a careful review before every commit, and that is only possible if each diff asks one question. B honours the standard within this programme while keeping the P0 security changes readable. It also gives a natural place to deal with the route that currently logs an entire configuration payload, which is a small privacy issue in its own right.

---

</details>

---

## SA Review

**Reviewed by SA — 2026-09-20**
**Status:** 🔄 Revision Required → **APPROVED WITH CHANGES**

Reviewed against the worktree at `C:/Users/Barak/My Projects/AgentsPilot/neuronforge-admin-authz`, branch `feature/admin-authz-unification`. Every claim below was verified in code, not inferred. The BA's census (44 routes, 3/7/2/32 split, 21 pages, 0 route handlers under `app/admin/`, middleware skipping `/api`) is **accurate and reproduced**. The analysis is unusually good; the changes below are about three things it treats as settled that are not — the database surface, the CI mechanism, and one factual error about F5.

**Approve to proceed to workplan once RC-1 … RC-14 are folded in.** No slice may start before RC-1 (Slice 0) is done.

---

### 1. Does this achieve "cannot recur"?

**Not as written. Two of the three surfaces are left as convention, and the one mechanism that would fix that is the last slice and is not specified.**

| Surface | Recurrence prevented by | Verdict |
|---|---|---|
| **API routes** | Nothing structural. After slices 1-4 every route is gated; route #45 is gated only if its author remembers. **Only slice 6 makes it impossible.** | 🔴 CI is load-bearing and is a single point of failure |
| **Admin pages** | The route tree itself, *if* the guard sits on `app/admin/layout.tsx`. A page cannot opt out of its parent layout. | 🟢 Genuinely structural — the strongest part of the plan |
| **Database** | Nothing. A new table with no RLS, or a new policy keyed on `profiles.role`, is unremarked. | 🔴 Not addressed at all (see §4) |

**Is a CI-only mechanism sufficient in this repo? No — not in the form the requirement implies.** Three verified obstacles, each of which silently turns "fails the build" into "shows red somewhere nobody looks":

1. **Neither existing workflow runs `npm test`.** `plugin-tests.yml` runs only `test:plugins:unit` / `test:plugins:smoke`; `bos-llm-typecheck.yml` runs a scoped `tsc`. A guard test added today executes nowhere in CI.
2. **A path-filtered workflow is defeated by the change it guards.** `plugin-tests.yml` filters on `lib/server/**`, `lib/plugins/**`, `tests/plugins/**`. A new file at `app/api/admin/new-thing/route.ts` matches none of them. The authz workflow must have **no `paths:` filter** — exactly the choice `bos-llm-typecheck.yml` already made deliberately and documents in its header.
3. **A workflow is not a build gate until it is a required status check on `main`.** That is a repository setting, not a file in the diff. If it is not turned on, G3 is aspirational and the DoD sentence "fails the build" is false.

Also: **do not scope the guard to `app/api/admin/`.** That repeats the precise mistake the repo's own `no-deletion-paths.guard.test.ts` docstring was written to warn against — "a guard scoped to files we already know about is structurally incapable of finding the sixth". Admin-capability code already lives outside that tree: `app/api/v2/calibrate/batch/route.ts:116` resolves admin via `AdminAccessService`, and `lib/server/route-identity.ts` gates act-as. Scan by **shape**, not by path (RC-4).

> **RC-1** — Add **Slice 0** (see §3). Blocking precondition for slices 1, 2, 5.
> **RC-2** — Split slice 6: land the guard test **with slice 1**, carrying the still-ungated files as a dated allow-list that each later slice shrinks. Slice 6 becomes "allow-list is empty".
> **RC-3** — Specify the CI mechanism: a dedicated workflow, **no `paths:` filter**, `on: pull_request` to `main`, running only the guard; plus an explicit DoD step to enable it as a **required status check**. Follow the shape of `no-deletion-paths.guard.test.ts` — allow-list with a written reason per entry, which satisfies FR-11 for free.
> **RC-4** — Widen FR-10. The guard must fail on: (a) a `route.ts` under `app/api/admin/**` that does not use the one gate; (b) **any** `route.ts` anywhere that imports `AdminAccessService` directly (this is what stops slice 4's de-duplication silently regressing); (c) any `route.ts` under `app/admin/**` (0 today — keep it 0, because route handlers are **not** wrapped by layouts); (d) any file under `app/`/`lib/`/`components/` making an access decision from `profiles.role`; (e) any migration adding an RLS policy referencing `profiles.role`.

**On RC-2, specifically.** "Introduce the CI gate last, once the repo is clean" is the standard way this kind of programme loses its only structural guarantee: the gate is the cheapest thing to cut when the security slices have already landed and the urgency is gone. Landing it first with a shrinking allow-list inverts the incentive — the guard protects the work *while* it is in progress, each slice's diff visibly deletes allow-list entries (a nice review artefact), and slice 6 degrades from "build the mechanism" to "delete the last four lines".

---

### 2. The `/admin` page guard

Verified: all 21 `page.tsx` files under `app/admin/` are `'use client'`; `app/admin/layout.tsx` is `'use client'` with no guard; **zero** `route.ts` files exist under `app/admin/`; `middleware.ts` matches `/admin` (it is not on the skip list) and performs only onboarding redirect + subdomain rewrite.

#### ✅ Approve: a **server** `app/admin/layout.tsx` that awaits the admin check and renders the existing chrome as a child client component

Move the current file verbatim to `app/admin/components/AdminChrome.tsx` (still `'use client'`), and make `app/admin/layout.tsx` an `async` Server Component that runs the check and then renders `<AdminChrome>{children}</AdminChrome>`.

**Why this one:** it is the only option where protection is a **property of the route tree** rather than a convention. In the App Router every `app/admin/**/page.tsx` renders as the `children` of `app/admin/layout.tsx`, and the layout's server render completes before the page's RSC payload is produced. There is no per-page "skip my parent layout" escape hatch. That is FR-9 satisfied by construction, which is a materially stronger guarantee than anything available on the API side.

**Is a layout guard genuinely inherited by every page here? Yes — with three escapes that must be written down rather than assumed away:**

1. **A `route.ts` under `app/admin/`.** Route handlers are *not* wrapped by layouts. None exist today; RC-4(c) keeps it that way. This is the real escape and the requirement does not mention it.
2. **Soft navigation.** Layouts are not re-rendered on client-side navigation between sibling pages inside the same layout segment. The guard therefore runs on entry to the subtree and on full loads, not on every in-app navigation. This is acceptable **only because slices 1-2 make the underlying data unreachable** — which means FR-7 currently overstates the page guard's role and must be amended (RC-10).
3. **Admin content at a URL outside `/admin`.** The guard protects a URL subtree, not "admin-ness". Out of scope, but state it as a boundary.

Two implementation notes for the workplan, both cheap to get wrong: `getUser()` calls `cookies()`, so the whole `/admin` segment becomes dynamically rendered — correct, and harmless here since all 21 pages fetch at runtime anyway. And `redirect()` from `next/navigation` throws to signal; it must not sit inside a `try/catch` that swallows it.

#### ❌ Reject: middleware as the enforcement point

Failure modes, in order of severity: (i) it is authorization in a layer that is itself configured by a **`matcher` and a hand-maintained skip list** — a developer-edited convention, which is exactly what the goal exists to eliminate; (ii) the Edge runtime has no shared process, so `AdminAccessService`'s 60 s cache cannot survive between invocations and this becomes a DB round trip per navigation, stacked on the service-role call middleware already makes; (iii) Next.js's own guidance after the `x-middleware-subrequest` bypass class (CVE-2025-29927) is that middleware must not be the sole authorization boundary. **Acceptable only as an optional cheap pre-filter for UX**, never as the guarantee.

#### ❌ Reject: `requireAdminPage()` called at the top of each of the 21 pages

Fails FR-9 by definition — 21 opt-ins, and page 22 is the recurrence. This is the convention-based approach wearing a server-side hat.

#### ❌ Reject: a client-side guard in the existing client layout

Fails FR-7 by definition: the decision runs after the admin bundle and any serialised props have already been shipped.

#### ❌ Reject: an `app/admin/(guarded)/` route group with a server layout, leaving the outer layout client

It works, but it creates a **second valid position for a page** (`app/admin/foo` vs `app/admin/(guarded)/foo`), only one of which is protected. That is an opt-in dressed as inheritance, and it is the more dangerous shape precisely because it looks structural. Put the guard on the top-level `app/admin/layout.tsx`, where no unguarded sibling position exists.

> **RC-10** — Fix slice 5's approach to the server-layout guard above, enumerate the three escapes, and amend **FR-7** to state that the page guard is defence-in-depth and **the API gate (slices 1-2) is the security boundary**. As written, FR-7 will lead a reader to believe the opposite.

---

### 3. Slice ordering and safety

**The ordering principle — highest blast radius first — is right, and I endorse it over the "warm up on slice 4" alternative the BA raises.** Slice 4 reduces no risk; the anonymous write surface is live. Independent-shippability holds for all eight, with the exceptions below.

#### 🔴 The missing slice: nothing verifies the operator can still get in

This is the most likely way this programme causes an incident, and it is absent. Slices 1, 2 and 5 all deny whenever `AdminAccessService.isAdmin()` returns false. Admin identity resolves from the `admin_users` table (seeded by `supabase/migrations/20260701_seed_admin_users.sql`, two emails: the owner and the coworker who holds deployment access) **plus** the `ADMIN_EMAILS` env fallback. Verified: **`ADMIN_EMAILS` does not appear in `.env.example`.** Nothing in this requirement confirms the seed has been applied, or the env var set, in each deployed environment.

If slice 1 lands where neither is true, every admin write returns 403 to everyone including the owner — and under **BQ-2 option B** the in-product way to fix it has just been deleted, so recovery requires direct Supabase access. Deploying slice 5 into that state additionally makes `/admin` inaccessible with (under BQ-3 option A) a **silent redirect and no on-screen explanation**.

> **RC-1** — Add **Slice 0 — pre-flight (no code, blocking)**: (a) confirm `admin_users` is seeded and `is_active` in every environment this will deploy to, or that `ADMIN_EMAILS` is set there; (b) add `ADMIN_EMAILS` to `.env.example` with a comment; (c) complete the caller enumeration that slices 2 and 3 already depend on; (d) send BQ-5's single question. Output recorded **in this document**, not in a PR body — PR bodies are not a durable source of truth (CLAUDE.md single-source-of-truth principle).

#### Per-slice independence

| Slice | Independently shippable? | SA note |
|---|---|---|
| 1 | ✅ strictly safer | Blocked on Slice 0. Note in its AC that three **dev scripts will start failing** (see §6.1) so nobody diagnoses a phantom regression. |
| 2 | ✅ | Its stated precondition ("caller enumeration complete") is real work and is not a slice — move it into Slice 0. |
| 3 | ⚠️ **conditionally** | The replacement customer read path and the gate **must be one commit**. Ship the gate first and the share-reward indicator is dark for every customer until the follow-up lands — the one genuine "worse state if the next slice is delayed" in the plan. |
| 4 | ✅ | One coupling the BA missed — see RC-9. |
| 5 | ✅ different surface | Blocked on Slice 0 (lockout risk above). |
| 6 | ⚠️ | Per RC-2, most of it should move to slice 1. |
| 7 | ✅ | Note for reviewers: slice 1 gates the `settings/admin-users` POST, i.e. it gates a write to a store that grants nothing. Correct (it stops any signed-in customer writing it), but reviewers should know they are gating a lie for a slice or two. |
| 8 | ✅ doc-only | — |

> **RC-9** — Slice 4 must update the docstring of `lib/admin/requireAdminRoute.ts` in the same diff. It cites `app/api/admin/business-os/llm-usage/route.ts:49-64` as "the precedent … left unchanged" — the exact file slice 4 deletes. Otherwise the canonical gate starts lying about its own provenance.
> **RC-11** — Slice 3: replacement read path and gate in one commit; add it to the AC.
> **RC-12** — Slice 1 AC: record the three dev scripts as expected fallout.

Also note `reward-config` is edited in two slices (POST in 1, GET in 3). Acceptable, but say so, or the second diff reads as a partial revert.

---

### 4. The database layer

**This is the weakest section of the requirement, and it is one third of the stated goal.** The DoD row for *"…and the database"* promises only that the allow-list is service-role-write-only, that slice 7 makes management real, and that any policy still trusting a user-writable signal becomes "a named, tracked, owned item with a date". That is an IOU, not coverage — and it is out of date.

**The answer already exists in the worktree and the requirement does not name it.** `supabase/migrations/20260920a_lock_system_settings_and_pricing_rls.sql:133-160` defines:

`public.is_platform_admin()` — `STABLE SECURITY DEFINER`, `SET search_path = pg_catalog, public`, returning true iff an `is_active` row in `admin_users` matches `auth.uid()` **or** `lower(email) = lower(auth.jwt() ->> 'email')`; `REVOKE ALL … FROM PUBLIC`, `GRANT EXECUTE … TO authenticated, service_role`.

It is already the predicate behind the `ai_model_pricing` and `system_settings_config` policies, and per repo memory it is applied to production as of 2026-09-20.

#### Is "one way to validate an admin" achievable across app code *and* Postgres RLS?

**No — and it should not be attempted.** Node cannot evaluate a Postgres policy; Postgres cannot call `AdminAccessService`. What is achievable, and is already the case, is:

> **One source of truth (`admin_users`), two enforcement mechanisms, one per runtime: `AdminAccessService.isAdmin()` in Node, `public.is_platform_admin()` in SQL.**

The requirement must say this in those words. Its current phrasing invites a Dev to try to unify the two, which would mean either an RLS policy calling out to the app (impossible) or the app trusting RLS to gate routes (it can't — most admin routes use the service role and bypass RLS entirely).

#### Does the requirement say how they stay in sync? No. And they are already deliberately divergent.

`is_platform_admin()` intentionally does **not** implement `AdminAccessService`'s third resolution path, the `ADMIN_EMAILS` env fallback (the database has no access to the env), and does not perform the email→`user_id` self-heal write. Consequence, currently undocumented outside that migration's own comments:

> **An admin who exists only in `ADMIN_EMAILS` and has never made an API call passes every app-code check and fails every RLS policy.**

Benign today, because admin data access runs through `supabaseServer`. It is exactly the asymmetry that produces a "it works in the admin UI but the table comes back empty" bug later, and it is the kind of thing that must be a written invariant, not a comment in one migration.

> **RC-5** — Add to Functional Requirements, and rewrite the DoD *"…and the database"* row around them:
> - **FR-15** — The database-side admin predicate is `public.is_platform_admin()`. No RLS policy may express admin-ness any other way, and never via `profiles.role`.
> - **FR-16** — Sync invariant: both mechanisms read `admin_users`. The **only** permitted divergence is the `ADMIN_EMAILS` bootstrap and the email self-heal, which are app-side only; the consequence is documented in slice 8.
> - **FR-17** — The slice-6 guard fails on a new migration adding an RLS policy that references `profiles.role`. (A broader "new table without `ENABLE ROW LEVEL SECURITY`" check is valuable but belongs to a separate item — declare it out of scope explicitly rather than leaving it unsaid.)
> - Slice 8 records which tables are `is_platform_admin()`-backed today and which are still service-role-only-by-convention.

> **RC-13** — The DoD's database row must also **name the gap it does not close**: most category D routes construct a service-role client inline (e.g. `app/api/admin/reward-config/route.ts:10-13`, at module scope). After slice 1 they are admin-only — but they still bypass RLS *and* the repository layer (CLAUDE.md mandatory rule 1, and the standing "enforce repository pattern in review" preference). The BA correctly defers the fix (out-of-scope item 4); the DoD must not leave the impression that the database surface is therefore covered. It is gated, not isolated.

---

### 5. F5 verdict

**Agree with the BA's recommendation — option A, keep F5 separate — but the reasoning must be re-based, because one of its four supporting arguments rests on a false fact.** See the inline correction above: `lib/server/route-identity.ts` and `lib/business-os/purge/purgeAuthz.ts` **do not** read `profiles.role`; a repo-wide sweep for an access decision keyed on that column returns **zero** hits; the DB policies that did read it were replaced on 2026-09-20.

Corrected F5: **one self-promotion write, zero app-code access readers, DB policies already replaced.** That cuts both ways:

- It **dissolves** the "different investigation" argument. There is no three-reader discovery task; the discovery is done and the answer is "nobody reads it for access."
- It **strengthens** the "different blast radius" argument, which is the one that actually carries the decision. The remaining work sits on `PUT /api/user/profile` — a customer-facing route — and the real question is a data-model one: which values of `role` are onboarding personas and which are access levels, which reaches the `profiles_role_check` constraint (`supabase/SQL Scripts/20251118_update_profiles_role_constraint.sql`) and the onboarding flow.

**SA verdict: A. The BA's two pull-ins are correct and should be mandatory, not optional, and I add a third.**

1. Slice 8 must state the truth about the profile role field (BA's point — agreed, and it is now a *better* truth: zero readers).
2. Slice 6's guard must fail on a **new** access decision reading that field (BA's point — agreed, and this is the highest-value item in the whole F5 discussion). Verified zero readers today means the allow-list for this rule is **empty**, so the rule is free to enforce and cannot be argued down as noisy.
3. **New:** record the corrected sweep result here, so the separate F5 item starts from the true state instead of re-doing a sweep that has already been done twice.

On the BA's option C (close only the write, now): it is a smaller risk than the BA judged — no access decision depends on the column — but I still decline it **inside this programme**, for the BA's own blast-radius reason. The remaining open question ("does onboarding legitimately set the persona through that path?") is one grep in the F5 item, not a discovery phase; say so, so the separate item is not over-estimated and therefore never scheduled.

---

### 6. What the BA missed

#### 6.1 Non-browser callers — verified, and the answer is clean

I checked what the requirement assumed: `vercel.json` (14 cron entries — **none** under `/api/admin/`), all 15 `app/api/cron/**` routes, and every server-side reference to `/api/admin` in `lib/` and `app/api/` (all comments, tests, or the gate itself).

> **No cron, no webhook, and no server-to-server caller of any `/api/admin/*` route exists in this repository.** A cookie-based `getUser()` gate breaks nothing internal.

One near-miss worth stating explicitly so nobody trips on it: `/api/cron/memory-consolidation` is a **separate route** from `/api/admin/memory-consolidation` (D2). Gating the admin one does not touch the cron.

Three in-repo callers **will** break, all developer tooling, none flagged by the BA:

| File | Line | Call |
|---|---|---|
| `scripts/test-phase5-full-integration.ts` | 174 | anonymous `fetch('http://localhost:3000/api/admin/ais-config')` |
| `scripts/test-phase6-final-verification.ts` | 287 | same |
| `scripts/test-phase3-full-integration.ts` | 170 | references `/api/admin/model-routing` — a route that no longer exists; the script is already stale |

Not a reason to delay anything (RC-12): record them as expected fallout in slice 1, and delete or mark the stale ones in slice 8's housekeeping.

#### 6.2 FR-5 contradicts the gate itself

`AdminAccessService.isAdmin()` **writes** — it binds `user_id` onto an `admin_users` row matched by email (the self-heal). FR-5 says "no write … happens in an admin route before the check has passed", which the gate technically violates. Harmless in substance (it is a write *by* the authorization, to the authorization's own table, for a caller who has just proven they are an admin), but as written a careful Dev or QA will read it as a defect and "fix" it.

> **RC-7** — Reword FR-5 to bound *handler* work: "no handler work — no body parse, no business data read, no write, no job trigger, no outbound message — begins before the gate returns an admin." Note the self-heal as the one write that is part of the check.

#### 6.3 The 60 s cache and revocation semantics

Covered by the inline correction to slice 7's AC. → **RC-8**.

#### 6.4 FR-10's scope is too narrow

Covered by RC-4(b). Restating the reason because it is the subtle one: gating the 44 files under `app/api/admin/` does not make "admin" a closed concept. `app/api/v2/calibrate/batch/route.ts:116` already resolves admin outside that tree. If the guard only knows about `app/api/admin/`, then the day after slice 4 removes the seven inline copies, nothing stops copy #8 appearing in a different folder.

#### 6.5 BQ-6 has a concrete, nameable violation

`app/api/admin/reward-config/route.ts:21-23` logs the request URL and a timestamp via `console.log` on **every** GET, and lines 55+ log per-reward payload shapes. This is the route the BA alludes to as "logs its full configuration payload". Naming it makes BQ-6 decidable rather than abstract, and makes it a small privacy item rather than a formatting preference.

#### 6.6 Module-scope service-role clients

Several category D routes construct their Supabase client at **module** scope (import time, before any gate can run). This is harmless — constructing a client performs no I/O — but it should be one line in the workplan so Dev neither "fixes" it pointlessly nor, worse, relocates real work to module scope while tidying.

---

### 7. The six open business questions

The user has a standing preference (repo memory, *"Requirement decisions via BA→SA"*) not to be handed raw technical forks. **Four of the six are technical and I resolve them here. Two are genuinely the user's, and I have narrowed both.**

| BQ | Genuinely a business decision? | Resolution |
|---|---|---|
| **BQ-1** — reward facts | ❌ **No — SA resolves** | **Option A**, and there is no trade-off to weigh. Verified: both callers read exactly one boolean (`is_active` on `agent_sharing`), and the *amount* is already customer-readable via `GET /api/system-config?keys=agent_sharing_reward_amount`, which the v2 page fetches in the same `Promise.all`. Implement the one boolean on that existing path — no new endpoint, no new pattern — and gate the admin route in the same commit. **Closed; remove from the user's list.** |
| **BQ-2** — how admins are added | ✅ **Yes — the user decides** | Product scope and operations: does the owner want self-service admin management, and who operates the platform. SA endorses the BA's **B now, A later** and **rules out C** (a gated non-functional screen fails FR-13 outright — do not present it as a live option). One fact the user needs that the BA does not give: there are exactly two seeded admins, the owner and the coworker who holds deployment access, and under B adding a third means editing and re-running `20260701_seed_admin_users.sql`, i.e. it requires Supabase access. That is the true cost of B. |
| **BQ-3** — non-admin experience on `/admin` | ✅ **Yes — the user decides** (posture), with two SA constraints | Reveal-or-not is a business posture call. SA constrains it: **(i)** whichever option is chosen, an authenticated non-admin and an anonymous visitor must receive the **identical** response — otherwise the difference between them is itself the disclosure the option was meant to prevent; **(ii)** option A's failure mode must be stated to the user — combined with BQ-2 option B, an operator whose admin row is missing gets a silent redirect and no way to find out why, since the denial is in logs they cannot read from the product. SA leans A *given* RC-1's pre-flight; B is equally acceptable. |
| **BQ-4** — F5 now or separate | ❌ **No — SA resolves** | **Option A (separate item).** It is a sequencing question, and the corrected facts settle it: zero app-code access readers, DB policies already replaced, so F5's live exposure is a self-promotion write with no consumer. It does not belong in a P0 admin sweep. **The only part that is the user's is a scheduling commitment**, not a technical choice: the BA's argument for A depends on F5 actually being scheduled with an owner, not filed. Ask for that, not for the fork. |
| **BQ-5** — external callers | ✅ **Yes — but now a single narrow question** | My in-repo sweep is complete and negative (§6.1). What a repo sweep structurally *cannot* see is an uptime monitor, an ops script, or a scheduled job living outside the repo. So: one question, to one person — the coworker who holds deployment access and is the second seeded admin: *"does anything you run poll an `/api/admin/…` URL?"* Record the answer here. **Block only slices 1 and 2 on it; do not block 3-8.** |
| **BQ-6** — logging conformance | ❌ **No — SA resolves** | **Option B, with one amendment.** CLAUDE.md's logging rule requires the conversion to be *surfaced and proposed*, not that it ship in the same commit — B satisfies the standard while keeping each diff answering one question. **Amendment:** the logging slice must follow **immediately after the slice that touched the files** (slice 1 → 1L, slice 2 → 2L), not sit at the end of the programme. A conformance slice with no forcing function is precisely the debt the rule exists to prevent. `app/api/admin/reward-config/route.ts`'s per-request `console.log` of the request URL goes in 1L, not a backlog. |

> **RC-14** — Update the Open Business Questions section: mark BQ-1, BQ-4 and BQ-6 **Resolved by SA** with the decisions above; re-scope BQ-5 to one question with a named owner and a stated blocking scope; keep BQ-2 and BQ-3 for the user with the SA constraints and facts added. The user should be asked **two** questions plus one scheduling commitment, not six.

---

### Required changes

1. **RC-1** — Add **Slice 0** (pre-flight, blocking): verify admin identity resolves in every target environment; add `ADMIN_EMAILS` to `.env.example`; complete the slice-2/3 caller enumeration **in this document**; send BQ-5's question.
2. **RC-2** — Land the CI guard test with **slice 1**, carrying a dated shrinking allow-list; slice 6 becomes "allow-list empty".
3. **RC-3** — Specify the CI mechanism: dedicated workflow, **no `paths:` filter**, and an explicit DoD step to make it a **required status check** on `main`. Follow the `no-deletion-paths.guard.test.ts` precedent.
4. **RC-4** — Widen FR-10 to scan by shape, covering (a)-(e) in §1.
5. **RC-5** — Add FR-15/16/17 and rewrite the DoD database row around `is_platform_admin()`, the one-source/two-mechanisms statement, and the documented `ADMIN_EMAILS` divergence.
6. **RC-6** — Apply the F5 factual correction and record the corrected sweep result.
7. **RC-7** — Reword FR-5 so the gate's own self-heal write is not a self-contradiction.
8. **RC-8** — Correct slice 7's AC: revocation takes effect **within the 60 s cache TTL** in app code, immediately in RLS.
9. **RC-9** — Slice 4 must update `lib/admin/requireAdminRoute.ts`'s docstring, which cites the file slice 4 deletes.
10. **RC-10** — Fix slice 5's approach to the server-layout guard, enumerate the three escapes, and amend FR-7 to state the page guard is defence-in-depth.
11. **RC-11** — Slice 3: replacement customer read path and the gate ship in **one** commit.
12. **RC-12** — Record the three dev scripts as expected fallout in slice 1's AC.
13. **RC-13** — DoD database row must name the service-role / repository-pattern bypass as a known, deliberate, tracked gap.
14. **RC-14** — Rework the Open Business Questions section per §7: two questions for the user, not six.

### Approval

- [x] Requirement **approved with changes** — fold in RC-1 … RC-14, then proceed to Dev workplan
- [x] **RC-4, RC-5, RC-6, RC-7, RC-8, RC-10, RC-13, RC-14 applied to this document 2026-09-20** (workplan review **W-2**)
- [ ] Slice 0 complete (blocking precondition for slices 1, 2, 5) — **code-side done; P-1/P-3 blocked, see Pre-flight Record**
- [x] BQ-2 and BQ-3 answered by the user (2026-09-20); BQ-1/BQ-4/BQ-6 resolved by SA
- [ ] BQ-5 answered by the deployment-access holder; F5 scheduled with an owner

---

## Slice 0 — Pre-flight Record

> **Recorded here, not in a PR body** — PR bodies are not a durable source of truth (CLAUDE.md single-source-of-truth principle). Per **RC-1**.
> **Recorded by:** Dev, 2026-09-20. **Status:** code-side complete; **two items blocked on the deployment-access holder.**

### 0.2 — Deploy-target environments

| Environment | How admin identity would resolve | Verified? |
|---|---|---|
| **Local development** | `admin_users` seed applied to the dev Supabase project, **or** `ADMIN_EMAILS` in `.env.local` | 🔒 **BLOCKED** — see 0.3 |
| **Vercel Preview** | Same, on whichever Supabase project Preview points at | 🔒 **BLOCKED** |
| **Vercel Production** | Same, on the production Supabase project | 🔒 **BLOCKED** |

Environments are enumerated from `docs/ENVIRONMENTS_AND_DEPLOYMENT_STRATEGY.md` and `docs/VERCEL_ENV_SETUP.md`. **Do not assume two** — if Preview and Production share one Supabase project today, record that explicitly, because it changes what "verified" means.

### 0.3 / 0.4 / 0.7 — 🔒 BLOCKED on the deployment-access holder

**Dev cannot resolve these.** They require the Supabase console and the Vercel environment-variable settings, neither of which Dev (or the user) holds. Owner: the coworker who holds deployment access — **also the second seeded admin**, per `supabase/migrations/20260701_seed_admin_users.sql`.

**The exact checks to run. Each is read-only.**

| # | Check | Exact action | Pass condition |
|---|---|---|---|
| **P-1a** | Is the admin seed applied? | In each environment's Supabase project, run:<br>`SELECT email, user_id, is_active FROM admin_users;` | At least one row with `is_active = true` whose `email` is the owner's. Record `user_id` **bound or NULL** (NULL is fine — it self-heals on first login — but it means **RLS will deny that admin** until they make one API call; see FR-16). |
| **P-1b** | Is the env fallback set? | In Vercel → Project → Settings → Environment Variables, for **each** of Development / Preview / Production: does `ADMIN_EMAILS` exist, and does it contain the owner's address? | Present **or** P-1a passes. **If NEITHER holds in an environment, that is the ABORT CONDITION for that environment.** |
| **P-1c** | Is `is_platform_admin()` live? | `SELECT proname FROM pg_proc WHERE proname = 'is_platform_admin';` | One row. (Repo memory says the migration was applied to production 2026-09-20; confirm per environment.) |
| **P-3** | BQ-5 — external callers | **One question, verbatim:** *"Does anything you run — an uptime monitor, an ops script, a scheduled job, a spreadsheet, a partner integration — poll a URL under `/api/admin/…` on AgentPilot?"* | A recorded **yes/no + date**. If **yes**, the caller is added to the workplan's *Risks & Flagged Callers* with an owner **before slice 1 or 2 merges**, and the fix is a **proper service credential**, not re-opening the endpoint. |

> **⚠️ Why this blocks deployment, not development.** Slice 1 may be written, reviewed and merged with these open. It **must not be deployed** to an environment failing P-1, because on that environment every admin write would return 403 to everyone **including the owner** — and under BQ-2 option B the in-product recovery has been deleted. Slice 5 into the same state additionally makes `/admin` inaccessible with a silent redirect and no on-screen explanation (BQ-3 option A). **P-3 blocks slices 1 and 2 from merging; P-1 blocks them from deploying.**

> 🔺 **[QA 2026-09-20 — CONTRADICTION FLAGGED, DELIBERATELY NOT RESOLVED.]**
> The paragraph above says **both** *"Slice 1 may be written, reviewed and **merged** with these open"* **and** *"**P-3** blocks slices 1 and 2 **from merging**"*. **P-3 — the single BQ-5 question to the deployment-access holder — is still unanswered**, so the two sentences give opposite answers to "may slice 1 merge now?".
>
> This is a **contract decision for TL / the user, not a Dev defect.** Dev is deliberately not picking a reading, because either choice would be Dev granting or withholding a merge approval that is not Dev's to give. **Carried into the slice 1 PR as an open item.**

### 0.8 / P-4 — Caller enumeration (COMPLETE)

Measured 2026-09-20 across `app/`, `components/`, `lib/`, `hooks/`, `scripts/`, excluding each route's own folder and `__tests__`.

**Result: every caller of every slice-2 and slice-3 route is an `/admin` page, i.e. admin-operated. Zero customer-facing callers, except the two already-known `reward-config` callers.**

| Route | In-repo callers | Verdict |
|---|---|---|
| `users` | `app/admin/users/page.tsx:160` | admin-operated |
| `users/[id]/stats` | `app/admin/users/page.tsx:276` | admin-operated |
| `user-emails` | `app/admin/learning-system/page.tsx:220` | admin-operated |
| `onboarding-users` | `app/admin/onboarding/page.tsx:124` | admin-operated |
| `messages` | `app/admin/messages/page.tsx:87` | admin-operated |
| `dashboard` | `app/admin/page.tsx:91` | admin-operated |
| `execution-stats` | `app/admin/executions-config/page.tsx:108` | admin-operated |
| `storage-stats` | `app/admin/storage-config/page.tsx:108` | admin-operated |
| `token-usage` | **none** | dead read — gating breaks nothing |
| `token-usage/stats` | **none** | dead read — gating breaks nothing |
| `token-usage/drill-down` | `app/admin/analytics/page.tsx:259` | admin-operated |
| `settings/platform-users` | `app/admin/settings/page.tsx:82` | admin-operated — **and deleted by slice 7** |
| `agent-generation-config` | `app/admin/agent-generation-config/page.tsx:76` | admin-operated |
| `ais-config` | `app/admin/ais-config/page.tsx:126` + 2 dev scripts (see fallout) | admin-operated |
| `backfill-embeddings` | **none** | dead |
| `helpbot-config` | `app/admin/helpbot-config/page.tsx:125` | admin-operated |
| `memory-config` | `app/admin/memory-config/page.tsx:221` | admin-operated |
| `memory-consolidation` | **none** | dead |
| `onboarding-config` | `app/admin/onboarding/page.tsx:73` | admin-operated |
| `orchestration-config` | `app/admin/orchestration-config/page.tsx:309` | admin-operated |
| `ui-config` | `app/admin/ui-config/page.tsx:121` | admin-operated |

**Slice-3 ⚠️ catalogue GETs — all three cleared:**

| Route | In-repo callers | Verdict |
|---|---|---|
| `boost-packs` GET | `app/admin/system-config/page.tsx:176` **only** | ✅ **No customer caller.** The "plausible customer-facing pricing/upgrade screen" does not exist. |
| `execution-tiers` GET | `app/admin/executions-config/page.tsx:82` **only** | ✅ **No customer caller.** |
| `storage-tiers` GET | `app/admin/storage-config/page.tsx:82` **only** | ✅ **No customer caller.** |
| `reward-config` GET | `app/(protected)/agents/[id]/page.tsx:406`, `app/v2/agents/[id]/page.tsx:360`, `app/admin/reward-config/page.tsx:63`, + the dead backup file `:424` | 🔴 **The one real customer-facing caller** — resolved by slice 3's projection |

> **Consequence.** Three of the four ⚠️ routes could be moved from slice 3 into slice 2. **Recommendation: leave them in slice 3.** The enumeration proves they are safe, not that moving them is free — slice 2's stated guarantee is "cannot break a customer screen", and it is cheaper to keep that guarantee mechanical (task 2.6: `git diff --stat` must not list the four ⚠️ files) than to re-argue it per route. `reward-config` is the only route where the decision was ever in doubt.

### Three findings from the enumeration (new — not in the facts sweep)

| # | Finding | Disposition |
|---|---|---|
| **E-1** | **`app/admin/messages/page.tsx:152` calls `/api/admin/messages/{id}/reply` — a route that does not exist.** The folder contains `replay`, not `reply`. The admin "reply to message" button 404s today. | Pre-existing bug, unrelated to authz. Tracked as **OI-16**; not fixed here. |
| **E-2** | **`POST /api/admin/messages/[id]/replay` has no in-repo caller at all.** It is an anonymous, unauthenticated route that can **re-send platform communications**, reachable by anyone, called by nothing. | Gated in **slice 1** (D2). Its dead-ness is a reason to gate it, not to skip it. |
| **E-3** | **`token-usage`, `token-usage/stats`, `backfill-embeddings` (GET) and `memory-consolidation` (GET) have no in-repo callers.** Four anonymous reads of platform LLM spend and job state, called by nothing. | Gated in slices 1/2 as planned. Candidates for deletion — recorded as **OI-17**, not actioned here. |

### 0.6 — `ADMIN_EMAILS` documentation

Added to `docs/VERCEL_ENV_SETUP.md` (**W-1**: docs-only; no `.env.example`, no `.gitignore` change).

### 0.12 / P-5 — Requirement amendments (COMPLETE)

RC-4, RC-5, RC-6, RC-7, RC-8, RC-10, RC-13 and RC-14 are applied to this document. The contract and the workplan now agree. See the Change History entry below.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-20 | Initial draft | Written from the measured facts sweep of 2026-09-20 (`origin/main @ 0d7544c0`). Full 44-route census, all 32 anonymous routes grouped and accounted for, breaking-caller analysis (F2 confirmed; F3/F4 confirmed safe; four unmeasured candidates flagged), 8 delivery slices, definition of done tied to the goal sentence, F5 scope recommendation, and 6 open business questions. Status: Draft — not approved. |
| 2026-09-20 | **RC amendments applied (workplan review W-2)** | Six RCs instructed edits to this document and had never been applied, leaving the contract QA tests against in contradiction with the implementation plan. Now applied: **RC-7** (FR-5 reworded to bound *handler* work, so the gate's own self-heal write is no longer a self-contradiction), **RC-10** (FR-7 amended — the page guard is **defence-in-depth**, the API gate is the security boundary; escapes E1/E2/E3 enumerated), **RC-4** (FR-10 widened to scan by shape, (a)–(e)), **RC-5** (**FR-15/FR-16/FR-17 added**; DoD database row rewritten around `public.is_platform_admin()`, the one-source/two-mechanisms invariant, and the documented `ADMIN_EMAILS` divergence), **RC-13** (DoD database row now names the service-role / repository-pattern bypass — *gated, not isolated*), **RC-14** (Open Business Questions reworked to a settled decision table: BQ-2 = B and BQ-3 = A by the user 2026-09-20, BQ-1/BQ-4/BQ-6 by SA, BQ-5 re-scoped). Plus the two inline corrections that were never applied: **RC-8** (slice-7 AC — revocation within the 60 s cache TTL in app code, immediate in RLS) and **RC-6** (F5 corrected to *one self-promotion write, zero app-code access readers, DB policies already replaced*; the "different investigation" argument struck). Also appended the **Slice 0 Pre-flight Record**: environments enumerated, full caller enumeration complete (**zero customer-facing callers** for all 21 slice-2 routes and for 3 of the 4 slice-3 ⚠️ routes), three new findings (E-1 a 404ing admin reply button, E-2 an uncalled anonymous message-replay route, E-3 four uncalled anonymous reads), and the exact read-only checks blocked on the deployment-access holder. |
| 2026-09-20 | SA review | APPROVED WITH CHANGES. 14 required changes (RC-1 … RC-14). Key findings: the database surface is one third of the goal and is treated as an IOU although its canonical predicate `public.is_platform_admin()` already exists and is in production; the CI gate is the only thing preventing route recurrence and neither existing workflow runs `npm test`, so it must ship with slice 1 and become a required status check; a missing pre-flight slice can lock the operator out of their own platform; F5's "three readers" claim corrected to zero. BQ-1, BQ-4 and BQ-6 resolved by SA; BQ-5 re-scoped; BQ-2 and BQ-3 remain the user's. |
