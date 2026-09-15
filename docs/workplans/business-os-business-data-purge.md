# Workplan: Business OS — Business Data Reset & Purge

> ## ⚠️ RECOVERY NOTICE — READ BEFORE RELYING ON THIS DOCUMENT
>
> **On 2026-09-15 at ~13:16, SA truncated this file to zero bytes.** A Python helper used to
> splice in the code-review section opened the file with `io.open(p, "w")` — which truncates
> immediately — and then raised `UnicodeEncodeError` on a surrogate-pair emoji escape before
> writing a single byte. The file was untracked, so `git` could not restore it.
>
> **This is SA's error, not Dev's.** It is recorded here rather than quietly repaired.
>
> **What was recovered, and how much to trust it:**
>
> | Part | Source | Trust |
> |---|---|---|
> | §1 – §11 | Dev's own assembly chunk `head.md`, timestamped **11:39** | ⚠️ **Possibly stale.** Reflects rev 2 as of 11:39. Dev edited this document after that time |
> | §9.5 (findings F-1…F-12) | Dev's chunks `sec95.md` (12:34) + `sec96.md` (13:03) | ⚠️ **Section number uncertain.** The hand-off describes F-8…F-12 under **§9.4** and N11/N12 under **§9.5**, which implies Dev renumbered after 12:34. The content is verbatim; the heading numbers may not match Dev's final |
> | **§9.4 N7–N12** | — | ❌ **NOT RECOVERED.** `head.md`'s §9.4 contains only N1–N6. N7, and the N11/N12 that SA ruled on, are not in any recovered artefact |
> | §12 (SA pass 1) | SA's own `sa_section.md` | ✅ **Verbatim.** Byte-compared against the copy that was in the file before truncation |
> | §12A (SA pass 2) | SA's own `sa_pass2.md` | ✅ **Verbatim** |
> | §12B (SA code review 1) | SA's own `sa_code1.md` | ✅ **Verbatim** — written after the truncation, never lost |
> | §13 / §14 / Change History | Dev's `tail.md` (11:34) + `row.md` | ⚠️ Rows added after 11:34 by Dev are not recovered |
>
> **Exact recovery was attempted and is not possible.** The session transcripts contain only a
> **rev-1** dump of this file (593 lines, no §12A, no §9.5); there is no post-rev-2 full read to
> decode. Every recovered artefact is preserved at
> `…/94c5c9aa-098a-48d1-8a0e-0013807f18d9/scratchpad/recovered/`.
>
> ### ➡️ Required action — Dev
>
> **Re-emit §1 through §11 and the Change History from your session state**, which holds the true
> latest text, and replace the fenced body below. Specifically re-add:
> **§9.4's N7–N12** (including the N11 / N12 that §12B rules on), the final §9.4/§9.5 numbering,
> and any Change History rows written after 11:34. SA's §12 / §12A / §12B are verbatim and must be
> carried across unchanged.
>
> **Nothing in §12B's review depends on this file** — that review was conducted against the
> working tree and the code, not against the workplan text.
>
> Delete this notice once Dev has re-emitted the body.

---


> **Last Updated**: 2026-09-15

**Developer:** Dev
**Requirement:** [BUSINESS_OS_BUSINESS_DATA_PURGE_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_BUSINESS_DATA_PURGE_REQUIREMENT.md) (31 FRs, 49 ACs, SA-approved 2026-09-14; FR-26 / FR-28 / AC-26 amended by SA §12.6, BA applying)
**Branch:** `feature/business-os-business-data-purge` — ✅ created by RM, cut from `origin/main` at `7acd323a`, confirmed checked out
**Date:** 2026-09-15
**Status:** **SA Approved with conditions (rev 2)** — implementation may begin on Stages 0/1/3/4. T11, T22, T24 held pending C-15/C-17 and the T31 `fix/` branch.

## Overview

This workplan implements "delete all data belonging to one business" across **60 user-scoped tables in 13 domains**, plus a view, 3 storage buckets and 30+ enumerated exclusions, at two levels (**Reset** / **Purge**), behind a **live Stripe pre-flight gate**, from **two surfaces on one engine**. The shape is fixed by SA: a declarative descriptor set is the only structure the executor iterates; phase 1 (gate + snapshot) is TypeScript, phase 2 (the destructive commit) is **one `SECURITY DEFINER` RPC**, phase 3 (storage + report + audit) is TypeScript again.

**32 tasks in 9 stages** (rev 2: +T30 server-side admin authorisation, +T31 the `delete-account` deprecation, +T32 the `cleanup-incomplete` hand-off to Offir). The critical path is unchanged: **T1 → T3 → T4 → T9 → T16 → T20 → T28.** T30 and T31 have no upstream dependencies and run in parallel from day one, so neither extends it.

**Rev 2 applies SA's first-pass review in full** — 8 rulings, conditions C-1…C-19, bounds B-1…B-4, and seven corrections to claims of mine that did not survive SA's verification (V1–V7, §9.13). It also records the user's four decisions, including the ruling on the existing Delete-account button (§9.3).

> **Standing constraint:** nothing in this cycle is committed. Files are written to the working tree only; the user approves before RM commits anything.

## Table of Contents

1. [Branch status](#branch-status)
2. [Analysis summary](#1-analysis-summary)
3. [Implementation approach](#2-implementation-approach)
4. [Standards reconciliation](#3-standards-reconciliation)
5. [Ownership of the gaps SA flagged as unowned](#4-ownership-of-the-gaps-sa-flagged-as-unowned)
6. [Files to create / modify](#5-files-to-create--modify)
7. [Task list](#6-task-list)
8. [Task → FR / AC mapping](#7-task--fr--ac-mapping)
9. [Test plan](#8-test-plan)
10. [Decisions, findings, and what still needs SA](#9-decisions-rulings-applied-and-what-still-needs-sa)
11. [Non-compliant files touched (Pino)](#10-non-compliant-files-touched-pino)
12. [Risks, escalations and out-of-scope](#11-risks-escalations-and-out-of-scope)
13. [SA Review Notes](#12-sa-review-notes)
14. [QA Testing Report](#13-qa-testing-report)
15. [Commit Info](#14-commit-info)
16. [Change History](#change-history)

---

## Branch status

✅ Resolved. `git branch --show-current` returns **`feature/business-os-business-data-purge`**, cut by RM from freshly-fetched `origin/main` at `7acd323a`. Unrelated work is parked in `stash@{0}` and is not touched by this cycle.

**T31 needs a second branch.** The `/api/user/delete-account` deprecation (§9.3) is a standalone `fix/` branch by SA's ruling, not a commit on this feature branch. **RM creates it**; I do not. Until it exists, T31's edits stay unwritten rather than landing on the wrong branch.

---

## 1. Analysis Summary

### 1.1 What this feature touches

| Area | Detail |
|---|---|
| **New engine** | `lib/business-os/purge/` (SA-ruled location) — descriptors, gate, snapshot, orchestrator |
| **New repository** | `lib/repositories/BusinessPurgeRepository.ts` — the single DB-access point for the engine, bounded by B-1…B-4 |
| **New migrations** | 3: the FR-1 schema-introspection RPC, the `purge_business_data` RPC, the `business-purge-snapshots` bucket |
| **New API routes** | `POST /api/business-os/purge/preview`, `POST /api/business-os/purge/commit` — both `AdminAccessService`-gated for the Reset level (T30) |
| **New Stripe client** | `lib/stripe/client.ts` — the directory exists (`StripeService.ts`, `StripeInvoiceService.ts`); the shared client file does not. **18 files** each call `new Stripe(...)`; we add the 19th as the shared one and migrate none (FU-14) |
| **Surfaces** | New Danger Zone tab on `app/test-business-os/page.tsx` (admin-gated server-side, T30); the **existing** Danger Zone button in `components/business-os/settings/SecurityTab.tsx` rewired to this engine, D9 flag-gated (§9.3) |
| **Touched infrastructure** | `lib/audit/events.ts` (2 new events + metadata), `lib/utils/featureFlags.ts` (1 new flag), `lib/business-os/LanguageContext.tsx` (en/es/he copy keys) |
| **Separate `fix/` branch** | `app/api/user/delete-account/route.ts` reduced to a `410 Gone` deprecation shim (T31) |
| **Read-only dependencies** | `lib/payments/stripeAccountContext.ts` (`resolveUserConnectAccounts`, `stripeRequestOptions`), `lib/services/AdminAccessService.ts` (`isAdminById`), `lib/auth.ts` (`getUser`), `lib/logger`, `AuditTrailService` |

### 1.2 Verified against the live tree (2026-09-15, branch `feature/business-os-business-data-purge` @ `7acd323a`)

Per the `business-os-schema-check` skill Rule 2, every claim names what was measured. **Rows marked 🔄 are ones SA re-measured and corrected — the corrected value is what appears here.**

| Claim | Measured | Result |
|---|---|---|
| Advisory-lock helpers exist | `supabase/SQL Scripts/20260129_add_advisory_lock_functions.sql` | ✅ exist, **session-scoped** → not used; `pg_try_advisory_xact_lock` inside the RPC instead (FR-28 amended) |
| Only consumer of those helpers | `lib/utils/distributedLock.ts` | ✅ one file, 13 `console.*` calls. Not touched |
| 11 crons | `vercel.json` | ✅ 11; **7 route files** in the re-population set |
| `maxDuration` outside crons | grep across `app/` | 12 files set it; neither settings nor test-business-os routes do |
| Shared Stripe client absent | grep `new Stripe(` | ✅ 18 files, no shared client |
| 🔄 Repositories | `lib/repositories/` | **54 `.ts` files, of which 52 are repository classes** (`index.ts`, `types.ts` are not). The requirement's "54" counted files and was right; my "52" counted classes and was also right. ~28 purge-set tables have no owning class |
| 🔄 Repositories that would under-capture a snapshot | grep `.neq('status','deleted')` / `.limit(` / `.range(` | **3** soft-delete (`AgentRepository`, `ContactDocumentsRepository`, `OrganizationRepository`), of which **one — `ContactDocumentsRepository` — owns a purge-set table** (`contact_documents`, #6). The larger effect: **31 of 52 classes carry `.limit()`/`.range()`**, and PostgREST caps an unbounded select at 1000 rows regardless |
| `insight-detect` tenant enumerator | `app/api/cron/insight-detect/route.ts:142-169` | `payment_invoices`, `scheduling_bookings`, `crm_contacts`, `business_events` — **all four `D`**. FR-26/AC-26 amended |
| `calendar-sync` enumerator | `businessProfileRepository.getUsersWithCalendarSyncEnabled(5)` | `business_profiles` (`K`) + a 5-min staleness threshold ⇒ due **within ~5 minutes** after a Reset |
| 🔄 `channel-metrics-sync` enumerator | `ChannelConnectionRepository.findDueForSync(staleBefore, retryBefore)` | `channel_connections` is `K` **and so is its `last_synced_at`** — a Reset does **not** make the connection due. Returns on its **next scheduled sync, up to ~20 h**, not "within the hour". My earlier copy erred in the same direction the requirement did |
| 🔄 `resolveUserConnectAccounts` fan-out | `lib/payments/stripeAccountContext.ts:83-124` | **It dedupes** — the code comment says so explicitly. Healthy case is **one** account; two distinct accounts is the `ambiguous` branch that already `logger.warn`s. So the gate is **4 traversals, not 8**. My DEV-Q8 arithmetic was wrong in my own favour |
| A second customer-facing delete path | `SecurityTab.tsx:305` → `POST /api/user/delete-account` | 🔴 Confirmed by SA line by line. **16 `REFERENCES auth.users` declarations carry no `ON DELETE`**, so it 500s at phase 6 for every onboarded user after phases 1–5 have already run. See §9.3 |
| **`/test-business-os` has no admin gate** | `middleware.ts:117-118` | 🔴 Confirmed — `/test-plugins-v2` and `/test-business-os` are on the **skip-onboarding-check** list, and `app/test-business-os/page.tsx` is `'use client'` gating on `useAuth()` only. **Any signed-in user can reach it.** → T30 |
| `AdminAccessService` shape | `lib/services/AdminAccessService.ts` | ✅ `isAdmin(user)`, `isAdminById(userId)`, `adminAccessService` singleton export, backed by `AdminUserRepository` / the `admin_users` table. Exactly what T30 needs |
| Stripe API versions live in the tree | grep `apiVersion` | **`2025-10-29.clover`** (9 sites, incl. `StripeService`) and **`2024-12-18.acacia`** (5 sites, incl. `StripeInvoiceService`), one `as any`. **Plus a third state SA did not name: `lib/payments/RefundService.ts:904` constructs `new Stripe(key)` with no `apiVersion` at all**, inheriting whatever the SDK pins |

### 1.3 What I did *not* verify, and why

`schema:check` replays `.select()` calls already in source, and `catalog.generated.ts` introspects a hard-coded 25-table list — neither can enumerate tables that no code references. **That is what T1 exists to do.** Until T1's dump lands, every table-existence claim here is inherited from the requirement's 📄/❓ tags and is **not** load-bearing. No descriptor is written before T1.

---

## 2. Implementation Approach

### 2.1 The three-phase shape (SA-mandated, not redesigned)

```
Phase 1 — TypeScript, no transaction
  a. Zod-validate input; getUser(); resolve userId from session only
  b. Authorise: AdminAccessService for the Reset level / internal behaviours (T30)
  c. Schema reconciliation (T7): call the FR-1 RPC, diff live user-scoped tables
     against descriptors — fail closed on unknown or missing; also compare the
     FK-set fingerprint against T3's (C-2)
  d. Pre-flight gate (T13): read Stripe across all connected-account candidates.
     External I/O — MUST be outside any transaction. Read-provider → then begin.
  e. Snapshot (T10): rows per descriptor (ids-only for the two unbounded
     analytics tables) + child ids, write, read back, verify

Phase 2 — ONE SECURITY DEFINER RPC, one transaction
  purge_business_data(p_user_id uuid, p_level text, p_options jsonb) RETURNS jsonb
  - pg_try_advisory_xact_lock(hashtextextended(p_user_id::text, 0)) inside
  - ordered set-wise deletes derived from T3's live pg_constraint dump
  - crm_activities deleted LAST (T5 residue — ordering, never suppression)
  - plugin_connections deleted here, AFTER phase 1d has already read it for
    account resolution: the phase split is what makes AC-33 true (T9)
  - returns per-table counts as JSONB. Everything goes or nothing does.

Phase 3 — TypeScript, non-transactional, after commit
  a. Storage removal, iterating StorageDescriptor[] only; per-object failures
     reported, never fatal (the data is already gone)
  b. Structured result; audit row; response
```

**Resume is not designed for.** SA rejected it; D7 refused the durable half-state it would need.

### 2.2 The descriptor set is the whole design

Everything else is plumbing around two structures — tables and, per **C-16**, buckets:

```
PurgeDescriptor = {
  table: string
  level: 'reset' | 'purge' | 'never' | `optional:${OptInKey}`
  scope: { kind: 'user_id' }
        | { kind: 'via', parent: string, fk: string }   // website_blocks, smart_link_clicks, user_capability_blocks
        | { kind: 'global' }                            // exclusion-only; never emits a delete
  order: number        // from T3's live FK dump, not from migration files
  snapshot: 'rows' | 'ids'   // 'ids' for website_page_views + smart_link_clicks (DEV-Q6)
  notes?: string       // the "why", per CLAUDE.md comment rule
}

StorageDescriptor = {                                    // C-16
  bucket: string
  level: 'reset' | 'purge' | 'never'
  pathPrefix: '{user_id}/'
  purpose: string
}
```

Invariants enforced by the T6 unit test (AC-45), **extended per C-4 and C-16**:

1. Every descriptor has a non-`global` scope **or** is `level: 'never'`.
2. **No delete statement is emitted without a scoping predicate** — the test walks the generated SQL, not the intent.
3. **Every §8 exclusion is present as a `level: 'never'` row.**
4. **B-1 assertion:** scanning `lib/business-os/purge/**` and `app/api/business-os/purge/**` for Supabase imports (`supabase`, `supabaseServer`, `createClient`, `SupabaseClient`) yields **exactly one file** — `BusinessPurgeRepository`. Without this the DEV-Q1 exception silently becomes "direct Supabase wherever convenient".
5. **C-16:** `StorageRemover` references no bucket-name literal; every bucket it touches has a `StorageDescriptor`.

Plus two review-time rules, mechanised where possible:

- `business_chat_plan_cache` carries `user_id = p_user_id`. `<>`, `IS DISTINCT FROM`, `NOT IN` are **forbidden** on it.
- RPC parameters are `p_`-prefixed and never share a name with a column they filter — the §1.2 `delete_user_by_id.sql` lesson.

**No table or bucket name appears anywhere in the executor.** If one can be grepped outside `descriptors.ts` and the RPC's generated body, the design has leaked.

### 2.3 Why the tenant-isolation guard lands differently here

Per the `tenant-isolation-guard` skill Step 1: this is a service-role path, but **the id is not caller-supplied** — FR-2/AC-28 forbid that on both routes, in every parameter position, which is *stronger* than an ownership pre-check. The skill's Step 2 ownership pre-check is therefore **not the applicable defence**; there is no foreign id to reject. Steps 4 and 6 are what apply:

- **Scope-defeating triggers** (Step 4): `update_invoice_on_payment` and `recompute_transaction_refund_state` filter by `id` with no `user_id`. Safe **only if no FK crosses tenants** — AC-24 tests that empirically rather than assuming it.
- **Per-effect scoping** (Step 6): every delete the engine emits is scoped to `p_user_id`. The structural-invariant test is the mechanised form of that rule.

The recorded vector is the §1.2 script: a PL/pgSQL variable named `user_id` filtering a column named `user_id`, which under `plpgsql.variable_conflict = use_variable` deletes the whole table for every tenant. T6 exists to make that impossible to reintroduce.

### 2.4 Gate design

- **One shared client** (`lib/stripe/client.ts`), pinned to **`2025-10-29.clover`** per S3 — the newer, majority version. Comment must record that `2024-12-18.acacia` is live on 5 sites **and that `RefundService.ts:904` pins nothing at all**, so FU-14's migration is not mistaken for a no-op.
- **Account resolution is `resolveUserConnectAccounts()`** — not reimplemented. It **dedupes**, so the healthy case is **one** account and **4 traversals**; two distinct accounts is the anomalous `ambiguous` branch. Every read carries `stripeRequestOptions()`/`stripeAccount`: these are direct charges on connected accounts and a platform-scoped read returns "no such object", i.e. a **false all-clear**.
- **Re-check filterability before assuming a full traversal** (SA, DEV-Q8): `/v1/subscription_schedules` accepts `scheduled`, and if C1 is implemented against `/v1/subscriptions` that accepts `status`. T13 records which endpoint it chose and whether a filter was available.
- **Six mandatory bounds**, each a refusal and never a truncated pass: time-windowed traversals (14 d payment intents, ~30 d refunds); hard page cap; wall-clock budget; `export const maxDuration` above it; ≤2 **global** retries with exponential backoff; 429 retried then refused.
- **Budget is set from T13's measurement (C-18)**, recorded as a named constant with the measured p95 in a comment, **capped at ≤ ½ `maxDuration`** so a budget refusal is always reported by our code and never by a platform kill. 20 s with `maxDuration = 60` is the pre-approved ceiling. **If a clean, single-account business measures >20 s, stop and escalate to SA** — that is evidence the shape is wrong and must not be absorbed by quietly raising a number.
- **Fail closed** on error/timeout/429-after-retry/budget. **Skip cleanly** when no Stripe is connected.
- **Cache** the gate result for the session, keyed `user + level + options`. Per **DEV-Q5(a)** this cache is **in-memory and per-instance on Vercel, therefore best-effort**. It must **never be described as rate limiting** — in code comments or anywhere else. The binding controls are the gate's own budget, page cap and ≤2-retry ceiling, which are per-request and hold regardless of instance.

### 2.5 correlationId continuity and the signed dry-run token (C-6…C-12)

The dry-run mints `correlationId` and returns it inside a signed token, which discharges FR-21, AC-29, the FR-2/AC-28 session binding and options-drift in one stateless mechanism.

```
payload   = { userId, level, canonicalJson(options), correlationId, gateVersion, issuedAt }
signature = HMAC_SHA256(key, payload)
token     = base64url(payload) + '.' + base64url(signature)        // C-10
```

| # | Condition | How |
|---|---|---|
| **C-6** | **Prefer a derived key over a new secret** | HKDF from the already-deployed `SUPABASE_SERVICE_ROLE_KEY` with a fixed feature-specific `info` string. Same cryptographic property, **zero new Vercel env dependency** — which matters, because `CRON_SECRET` has been unset for a month and left three crons dormant. A discrete `PURGE_TOKEN_SECRET` is not chosen (it would inherit exactly that failure mode — SA's E4) |
| **C-7** | **No default, no fallback, fail closed** | Missing or short key ⇒ both routes 500 with a distinct operator-facing message and an `error` log. An absent key may **never** degrade to "token not required". Asserted in a route test |
| **C-8** | `crypto.timingSafeEqual` with a length guard, never `===` | There is **no `createHmac` anywhere in `lib/` or `app/` today** (SA-verified), so this is a genuinely new crypto path |
| **C-9** | `canonicalJson(options)` is a deterministic serialiser | Recursively sorted keys, stable number formatting, its own unit test. Key-order variation between clients would otherwise read to the user as "your confirmation expired" |
| **C-10** | `payload.signature` wire format | The verifier needs `issuedAt` and `gateVersion` in the clear to check TTL and version before it knows what it is verifying. Documented in `dryRunToken.ts`'s header |
| **C-11** | `gateVersion` is a compile-time constant | With a comment stating it is bumped whenever gate semantics change; bumping invalidates outstanding tokens by design |
| **C-12** | **Never log the token** | Log a short prefix or a hash. It is a bearer credential for a destructive operation |

**Honesty point, per SA (stated, not glossed):** AC-29 says "in the same **session**". A 15-minute HMAC over `userId|level|options|correlationId|gateVersion|issuedAt` binds *user + parameters + time*, **not session** — sign out and back in within the TTL and the token still verifies. The widening is immaterial (same user id; the gate re-runs on commit regardless), and AC-29's intent — no commit without a prior matching dry-run — is fully satisfied. But the mapping must not imply a stronger property than the mechanism provides.

### 2.6 Surfaces

| | `/test-business-os` → Danger Zone | Settings → the existing Danger Zone button |
|---|---|---|
| Authorisation | **Server-side `AdminAccessService` on the routes** (T30) — not tab visibility | `getUser()`, session user only |
| Flag | Unflagged **for admins**; unreachable for non-admins at the route, not just the UI | `NEXT_PUBLIC_ENABLE_BUSINESS_DELETE`, off by default |
| Levels | Reset + Purge | Purge only |
| Copy | Technical — table names, counts, the FR-24 re-arm note | Plain, localised en/es/he, no table names, FR-23 + FR-25 + the corrected FR-26 sentences |
| Gate | Enforced | Enforced — **the flag hides the surface, never the gate** |

**S1 — why authorisation moved server-side.** `middleware.ts:117-118` puts `/test-business-os` on the skip-onboarding list with **no admin gate**, and the page gates on `useAuth()` only; its own header says it "acts as whoever you are currently logged in as". Shipping T22 as originally planned would put an **unflagged Reset + Purge button in production reachable by any signed-in customer**, while T24 gated the same capability behind a flag that is off by default — making D9's staged rollout a fiction. A `NEXT_PUBLIC_` flag is a rendering hint, never an authorisation boundary. **AC-40 extends accordingly** (§7).

---

## 3. Standards Reconciliation

### 3.1 Mandatory rule 1 vs. the RPC phase — and the bounded DEV-Q1 exception

**`supabase.rpc('purge_business_data', …)` is a database call.** It is issued **from inside `lib/repositories/BusinessPurgeRepository.ts`**, not from the service and not from the route. The service composes; the repository touches the database. Five operations:

| Method | Phase | Rule-1 note |
|---|---|---|
| `introspectSchema()` | 1c | `rpc('purge_schema_introspect')` — service-role only |
| `readForSnapshot(descriptor, userId)` | 1e | `.from(descriptor.table).select(...)` — table and predicate come from the descriptor; paginated to exhaustion; **no soft-delete filter**; `select('id')` when `descriptor.snapshot === 'ids'` |
| `executePurge(userId, level, options)` | 2 | `rpc('purge_business_data', { p_user_id, p_level, p_options })` |
| `listStorageObjects(sd, userId)` / `removeStorageObjects(...)` | 3a | Storage API, service role, iterating `StorageDescriptor[]` |

**SA granted the single-repository exception (DEV-Q1), bounded by four conditions, all applied:**

| Bound | Applied as |
|---|---|
| **B-1** | `BusinessPurgeRepository` is the **only** file under `lib/business-os/purge/**` and `app/api/business-os/purge/**` importing a Supabase client in any form. **Asserted mechanically in the T6 suite** (invariant 4, §2.2) |
| **B-2** | Table names and predicates arrive **only** as a `PurgeDescriptor` parameter. No table-name string literal anywhere in the repository — **including error messages and log lines** (log `descriptor.table`, never a literal) |
| **B-3** | The grant covers **this feature only**. `BusinessPurgeRepository` is not a general-purpose escape hatch and **no other module may import it**. That sentence goes in the file's header comment |
| **B-4** | The documented RLS-bypass comment states **both** reasons — ~20 tables give `authenticated` no DELETE policy (§5.3), **and** the snapshot must read unfiltered |

**The exception is about class count, not layering.** Every database call in this feature lands inside `lib/repositories/`, in one file, `user_id`-scoped on every read. Rule 1 is silent on granularity; the user's standing preference exists to stop *new DB access written outside the repository layer*, which is the opposite of what this does.

**Supporting argument, restated with SA's measured numbers (V5):** the under-capture risk is not "several repositories". It is **one in-scope instance** — `ContactDocumentsRepository` applies `.neq('status','deleted')` to `contact_documents` (#6), so a snapshot built through it would omit soft-deleted rows the RPC then deletes — plus a much larger structural effect: **31 of 52 repository classes carry `.limit()`/`.range()`**, and **PostgREST caps an unbounded select at 1000 rows regardless**. Reuse would silently truncate the forensic artefact for any business with more than 1000 rows in a table.

**S4 — one sanctioned exception to B-1.** `resolveUserConnectAccounts` (`lib/payments/stripeAccountContext.ts`) queries `stripe_connect_accounts` and `plugin_connections` directly, outside the repository layer. It is pre-existing debt, the requirement's §12 explicitly forbids reimplementing it, and the gate calls it read-only. **The call is sanctioned; it is not an import of a Supabase client, so B-1's assertion still holds.** Noted in code so it does not become the precedent that widens B-1, and filed as a follow-up in T29.

### 3.2 Other standards

| Standard | How |
|---|---|
| **Zod (rule 2, FR-29, AC-39)** | Both routes parse the full body before any business logic. `.strict()` so an unexpected `userId` key is a **400, not an ignored field** — part of AC-28's defence |
| **Pino (rule 3, AC-49)** | `createLogger` + `logger.child({ correlationId })`. One line per table with counts; gate outcome with per-condition detail. No `console.*` in any new or touched file — §10 |
| **user_id scoping (rule 4)** | The descriptor structure *is* the mechanism; T6 is the enforcement |
| **Admin authz** | `AdminAccessService` / `admin_users` — **never `profiles.role`**, which is user-writable (T30) |
| **TypeScript strict (rule 6)** | No `any`. `p_options` crosses the RPC boundary as a Zod-parsed type serialised to JSONB |
| **Audit** | `AuditTrailService.getInstance().log({...}).catch(...)` — non-blocking, `severity: 'warning'`, **including blocked attempts**. Unlike the route T31 retires, this audits **outcome**, not just intent |
| **`new-api-route` skill** | Both routes follow the template verbatim. Variations: `export const maxDuration`, the admin check, the commit route's token pre-check |
| **`new-repository` skill** | Template followed, with two deviations declared: **no soft-delete filter** and **no default pagination** (both would invalidate the snapshot — see V5 above) |

---

## 4. Ownership of the Gaps SA Flagged as Unowned

| Gap | Owner | Mechanism |
|---|---|---|
| **Zod validation** | T19, T20 | `.strict()` schemas on both routes; AC-39 |
| **`maxDuration`** | T19, T20 | `export const maxDuration = 60` on both; the gate budget is capped at ≤ ½ of it (C-18) |
| **Double-submit lock** | T9 (server), T26 (client) | `pg_try_advisory_xact_lock(hashtextextended(p_user_id::text, 0))` **inside** the RPC, released at COMMIT/ROLLBACK with no unlock to leak (FR-28 as amended). Client guard is cosmetic; the server lock is the control |
| **Post-purge redirect** | T25 | After Purge, `business_profiles` is gone and `middleware.ts:234` routes protected paths to `/onboarding-chat`. Sequence: result screen (FR-23/24/25 copy) → explicit sign-out CTA → `/login?businessDeleted=1` rendering the confirmation. The account still exists (D3), so signing out and confirming is honest; landing in "let's set up your business" reads as a failed delete (AC-44) |
| **`correlationId` continuity** | T16, T19, T20 | The signed token carries it (§2.5, C-6…C-12) |
| **Storage partial failure** | T17 | Per-object failures into `storage.failed[]`, surfaced in the result and audit row, **never fatal** (AC-47) |
| **Subdomain re-claimability** | T24 | FR-25 sentence in the result copy, localised (AC-43) |
| **AC-5 testability** | T10, T28 | Snapshot captures child ids **before** the delete. **C-13:** capture happens in the **same phase-1 read pass with the same paginate-to-exhaustion guarantee** as the row dump — a separately coded, silently capped id read would miss exactly the ids AC-5 never checks. **C-14:** the assertion first proves the captured id set is **non-empty and matches a known seeded count**, or a bug capturing zero ids makes AC-5 pass vacuously |
| **Rate limiting** | T14 | No general-purpose limiter exists in `lib/`. For v1: the gate cache removes Stripe cost from a retry loop, and the xact lock serialises the destructive path. **The cache is per-instance best-effort and is not rate limiting** (DEV-Q5a). A shared limiter is filed as a follow-up with an owner in T29 |
| **Snapshot failure semantics** | T10 | Write fails **or** read-back fails → abort with **zero rows deleted** (AC-35). Read-back verifies byte length and the table-key set |
| **Snapshot size ceiling** | T10 | **Split ruling (DEV-Q6):** `website_page_views` and `smart_link_clicks` capture **ids only** — unbounded, publicly writable, forensically worthless row-by-row, and a ceiling there would make a high-traffic business **undeletable**. Everything else gets a **global row ceiling whose breach is a refusal**. Ceiling value measured in T10, ≥4× headroom below the function memory limit, recorded in a comment beside the constant |

---

## 5. Files to Create / Modify

### 5.1 Create

| File | Task | Reason |
|---|---|---|
| `supabase/migrations/20260915a_purge_schema_introspect.sql` | T1 | FR-1 route (a) RPC. `SECURITY DEFINER`; **`GRANT EXECUTE … TO service_role` only — never `authenticated`** |
| `docs/workplans/business-os-business-data-purge-schema-dump.md` | T1 | The live `pg_constraint` / `pg_trigger` / `pg_policies` dump (SA-6). **C-1: no code ever reads this file** |
| `lib/business-os/purge/types.ts` | T5 | `PurgeDescriptor`, `StorageDescriptor`, `PurgeLevel`, `PurgeOptions`, `GateResult`, `PurgeReport` |
| `lib/business-os/purge/descriptors.ts` | T4 | 60 in-scope + 30+ `never` + `optional:*` + the `StorageDescriptor[]` (C-16). The only place a table or bucket name is written |
| `lib/business-os/purge/__tests__/descriptors.invariant.test.ts` | T6 | AC-45 + the B-1 single-importer assertion + C-16 |
| `lib/business-os/purge/SchemaReconciler.ts` | T7 | Fails closed on unknown / missing tables (AC-37) and on FK-fingerprint mismatch (C-2) |
| `lib/business-os/purge/PreflightGate.ts` | T13 | C1 / C2(both) / C3, multi-account, six bounds, fail-closed, skip-clean |
| `lib/business-os/purge/GateCache.ts` | T14 | Per-instance best-effort session cache — **not** a limiter |
| `lib/business-os/purge/SnapshotWriter.ts` | T10 | Surface-conditional payload, ids-only tables, child-id capture, read-back verify |
| `lib/business-os/purge/BusinessPurgeService.ts` | T16 | Three-phase orchestrator; result assembly |
| `lib/business-os/purge/StorageRemover.ts` | T17 | Iterates `StorageDescriptor[]` only; per-object failure reporting |
| `lib/business-os/purge/dryRunToken.ts` | T16 | HKDF key derivation, mint / verify (C-6…C-12) |
| `lib/business-os/purge/canonicalJson.ts` + test | T16 | C-9 |
| `lib/business-os/purge/purgeAuthz.ts` | T30 | `AdminAccessService`-backed authorisation used by both routes |
| `lib/business-os/purge/__tests__/*.test.ts` | T6/T15/T16 | Unit coverage per AC-48 |
| `lib/repositories/BusinessPurgeRepository.ts` | T8 | The engine's only Supabase surface, bounded by B-1…B-4 |
| `lib/repositories/__tests__/BusinessPurgeRepository.test.ts` | T8 | Unit test per method |
| `lib/stripe/client.ts` | T12 | One instantiation, pinned `2025-10-29.clover` (S3) |
| `supabase/migrations/20260915b_purge_business_data.sql` | T9 | The phase-2 RPC + xact advisory lock |
| `supabase/migrations/20260915c_purge_snapshots_bucket.sql` | T10 | Private bucket, **no policy granting `authenticated` anything** (AC-36) |
| `app/api/business-os/purge/preview/route.ts` | T19 | Dry-run; authz; gate; counts; token mint |
| `app/api/business-os/purge/commit/route.ts` | T20 | Authz; token + typed-name verify; re-gate; snapshot; RPC; storage; audit |
| `app/api/business-os/purge/*/__tests__/route.test.ts` | T21 | happy + 401 + 403 + 400 + blocked + missing-table |
| `components/business-os/purge/PurgeDangerZone.tsx` | T22 | Internal tab body |
| `components/business-os/purge/DeleteBusinessDialog.tsx` | T24 | Customer flow behind the **existing** Danger Zone button |
| `docs/workplans/business-os-business-data-purge-cron-register.md` | T27 | Input to AC-25 — **not evidence for it** (SA) |
| `docs/handoffs/cleanup-incomplete-cron-summary.md` | T32 | Written summary for Offir (§11.3) |

### 5.2 Modify

| File | Task | Reason |
|---|---|---|
| `app/test-business-os/page.tsx` | T22, T30 | One `TABS` entry + one `activeTab === 'danger-zone'` block, rendered only after the **server** admin check resolves |
| `components/business-os/settings/SecurityTab.tsx` | T24 | The **existing** Danger Zone button rewired to the purge engine (§9.3). **3 `console.*`** → §10. Per S5, the three error paths must also **surface in the UI** — a client logger reaches the user no better than a console did |
| `lib/business-os/LanguageContext.tsx` | T24 | en/es/he keys: blocked-state, FR-23, FR-25, corrected FR-26, the data-export sentence (DEV-Q11) |
| `lib/utils/featureFlags.ts` | T23 | `useBusinessDeleteSurface()` |
| `lib/audit/events.ts` | T18 | `BUSINESS_DATA_PURGED`, `BUSINESS_DATA_PURGE_BLOCKED` + metadata |
| `docs/architecture/BUSINESS_OS_DATA_MODEL.md` | T29 | FR-1's findings |

### 5.3 Separate `fix/` branch (T31 — RM creates the branch)

| File | Reason |
|---|---|
| `app/api/user/delete-account/route.ts` | Reduced to a **`410 Gone` deprecation shim**; all deletion logic removed. Its **16 `console.*` calls go away with the code** — deleted, not converted |

### 5.4 Explicitly NOT modified this cycle

| File | Why |
|---|---|
| The other 18 `new Stripe(...)` call sites | FU-14 |
| `supabase/SQL Scripts/delete_user_by_id.sql` | Already removed in PR #39 |
| `lib/utils/distributedLock.ts` | Not used (DEV-Q2). 13 `console.*`, but reformatting a file I am not working on is against the standard |
| `app/api/auth/cleanup-incomplete/route.ts` | 🔄 **Changed in rev 2.** The enforcer moved off it (C-17), so there is no longer a reason to touch it — and per SA's **E1** the route may be **retired entirely**. Converting 10 `console.*` in a route that is a live mass-deletion hazard pending an owner decision would be exactly the compliance theatre S5 warns about. **T32 hands it to Offir instead** |

---

## 6. Task List

Legend: 🟢 easy · 🟡 medium · 🔴 hard · ⬜ todo · ✅ done · 🔒 held

### Stage 0 — Ground truth (blocks everything)

| # | Task | Cx | Depends | Status |
|---|---|---|---|---|
| **T1** | **FR-1 schema introspection.** `20260915a_purge_schema_introspect.sql` (`SECURITY DEFINER`, `service_role`-only `EXECUTE`). Run the live dump via the **Supabase SQL editor** — no `pg` driver, no `DATABASE_URL` in this repo. Capture `information_schema.columns` for every table with a `user_id`, plus `pg_constraint`, `pg_trigger`, `pg_policies`. Attach with project ref + timestamp. **C-1: state in the dump doc's header that no code reads it — it is evidence for T3/T4; `SchemaReconciler` is the runtime oracle** | 🔴 | — | ✅ **COMPLETE — Parts 1 & 2 in the dump doc** |
| **T2** | **Close the unknowns.** (a) the four ❓: `business_intake_forms`, `websites`, `payment_methods`, `processed_webhook_events`; (b) the five §8.9 phantom names — **`contact_submissions` gets a fresh ruling if live**; (c) 🔄 **downgraded to 🟡 by SA §12.4** — `execution_optimization_tables` creates `execution_baselines`/`execution_anomalies` (both already in §8.7) and `platform_learning_tables` creates `workflow_patterns`/`global_failure_patterns`, **neither of which has a `user_id`**, so neither can ever appear in FR-1's enumeration and neither needs a descriptor. **§8.7 is closed statically; T2(c) is now one grep against the dump to confirm no third table appeared live**; (d) settle §10.2 ¶2 and AC-3's intake half | 🟡 | T1 | ✅ **COMPLETE** |
| **T3** | **Derive the delete order** from T1's `pg_constraint` dump, **not from migration files**. Verify B1–B4, including **B4** (`payment_plan_subscriptions` before `crm_contacts`, because T1's BEFORE DELETE trigger deletes future bookings and trips B2 from a direction B2 alone does not name). Confirm `crm_activities` last. Confirm **no FK crosses tenants**. **Emit the FK-set fingerprint C-2 needs** | 🔴 | T1 | ✅ **COMPLETE — 9 blocking edges; B5 absent, B6 new** |

### Stage 1 — Descriptors and the invariant

| # | Task | Cx | Depends | Status |
|---|---|---|---|---|
| **T4** | **Write `descriptors.ts`** — 60 in-scope rows (level / scope / order / `snapshot` mode / why-comment), 30+ `never` rows, 3 `optional:*` groups, **plus the `StorageDescriptor[]` (C-16)**. `business_chat_plan_cache` gets `user_id = p_user_id` and a comment on why exclusion syntax is forbidden | 🔴 | T2, T3 | ✅ **COMPLETE — 121 descriptors, 0 unclassified** |
| **T5** | Types module. Strict; no `any` | 🟢 | — | ✅ **SA-approved** |
| **T6** | **Structural-invariant test (AC-45)** — the five invariants in §2.2, including the **B-1 single-Supabase-importer scan (C-4)** and the **C-16 bucket-literal check**. Must fail against a deliberately broken fixture | 🟡 | T4, T5 | ⬜ |
| **T7** | **`SchemaReconciler`** — fails closed on a table in neither set, on an expected-but-missing table (AC-37), **and on an FK-set fingerprint mismatch against T3 (C-2)**, so a FK added after T3 surfaces as a phase-1 sentence rather than an opaque constraint error inside the phase-2 transaction | 🟡 | T4, T8 | ⬜ |

### Stage 2 — Data access and the commit

| # | Task | Cx | Depends | Status |
|---|---|---|---|---|
| **T8** | **`BusinessPurgeRepository`** — the five methods in §3.1 under **B-1…B-4**; paginated to exhaustion; no soft-delete filter; `select('id')` for `snapshot:'ids'` descriptors. Unit test per method | 🔴 | T5 | ⬜ |
| **T9** | **`purge_business_data` RPC** — `p_`-prefixed params, **`pg_try_advisory_xact_lock` inside**, ordered set-wise deletes from T3, `crm_activities` last, JSONB counts, `service_role`-only grant. **Owns AC-33's ordering**: `plugin_connections` is read in phase 1d for account resolution and deleted in phase 2 under the integrations option — assert the order rather than assume the phase split guarantees it | 🔴 | T3, T4 | ⬜ |
| **T10** | **Snapshot** — bucket migration; **surface-conditional payload (C-17):** internal path = full rows, **customer path = no-PII by default** (counts, row ids, table keys, non-PII columns); **ids-only for `website_page_views` + `smart_link_clicks` (DEV-Q6)**; **global row ceiling → refusal**, value measured with ≥4× memory headroom and recorded beside the constant (C-18); **child ids captured in the same exhaustive pass (C-13)**; write → read back → verify byte length + table-key set; either failure aborts with zero deletes. **One writer with a surface parameter — never two writers** | 🟡 | T8, T13 | ⬜ |
| **T11** | 🔒 **HELD (C-17).** **7-day retention enforcer, re-hosted.** `/api/auth/cleanup-incomplete` is **provably dormant today** (fail-closed at line 17 with `CRON_SECRET` unset) and is **not a viable host**. Host on a cron verified to execute, or give it its own `vercel.json` entry. **Acceptance requires a verified live run with a log line proving objects were considered.** Because the customer snapshot is no-PII by default, this is now defence-in-depth rather than a compliance dependency | 🟡 | T10, C-17 | 🔒 |

### Stage 3 — The pre-flight gate

| # | Task | Cx | Depends | Status |
|---|---|---|---|---|
| **T12** | **`lib/stripe/client.ts`** — one instantiation, pinned `2025-10-29.clover`, comment recording the acacia sites **and `RefundService.ts:904`'s unpinned client** | 🟢 | — | ⬜ |
| **T13** | **`PreflightGate`** — C1/C2(charges + refunds)/C3 from Stripe across every `resolveUserConnectAccounts()` candidate (**dedupes ⇒ 4 traversals in the healthy case**), every read `stripeAccount`-scoped. Re-check filterability per endpoint before declaring a full traversal. Six bounds; **budget measured, ≤ ½ `maxDuration`, escalate to SA if a clean single-account business exceeds 20 s (C-18)**. Fail closed; skip cleanly. **Blocked result names count + Stripe-side ids per condition, including refund ids — this is AC-16, a D9 un-gating condition** | 🔴 | T12 | ⬜ |
| **T14** | **`GateCache`** — per-instance best-effort; documented as **not** rate limiting | 🟡 | T13 | ⬜ |
| **T15** | **Gate unit tests** — C1, C2(charges), C2(refunds incl. dashboard-issued with no local row), C3, fail-closed, no-Stripe-skip, page cap, budget exceeded, multi-account, platform-scoped read miss, **AC-16's message content**, **AC-33's read-before-delete ordering** | 🟡 | T13 | ⬜ |

### Stage 4 — Engine

| # | Task | Cx | Depends | Status |
|---|---|---|---|---|
| **T16** | **`BusinessPurgeService`** + `dryRunToken` + `canonicalJson` — three-phase orchestrator; **C-6…C-12** applied; `correlationId` continuity; count-drift reported never hidden; the FR-19 structured result (gate outcome, per-table rows, storage deleted **and failed**, tables skipped and why, non-blocking provider state, snapshot path, **both gate timestamps + commit timestamp**, duration) | 🔴 | T7, T8, T9, T10, T13 | ⬜ |
| **T17** | **`StorageRemover`** — iterates `StorageDescriptor[]` only (C-16); per-object failures surfaced; **never fails the run** | 🟡 | T4, T8 | ⬜ |
| **T18** | **Audit events** — `BUSINESS_DATA_PURGED` / `BUSINESS_DATA_PURGE_BLOCKED` + metadata; non-blocking; `severity: 'warning'`; **blocked attempts written too**; **outcome audited, not just intent**; the purge's own row written after the audit-history option has cleared `audit_trail` | 🟢 | T16 | ⬜ |

### Stage 5 — Authorisation and routes

| # | Task | Cx | Depends | Status |
|---|---|---|---|---|
| **T30** | 🆕 **Server-side authorisation (C-15, S1, user decision 3).** `purgeAuthz.ts` using **`AdminAccessService.isAdmin({ id, email })`** (not `isAdminById` — see F-5) — the `admin_users` table, **never `profiles.role`** (user-writable, per the admin-identification doc). Both routes 403 a non-admin requesting the Reset level or internal-surface behaviour, **regardless of what the client renders**. The `/test-business-os` tab renders only after that server check resolves — a fetch, not a client-side guess. **AC-40 extends:** with the flag off, the customer surface is unreachable **and no other surface offers Reset or Purge to a non-admin** | 🟡 | — | ✅ **SA-approved; C-22 flag check added** |
| **T19** | **`POST /api/business-os/purge/preview`** — `new-api-route` template; `.strict()` Zod; `maxDuration = 60`; authz (T30); gate; per-table + per-bucket counts; unverified tables; **blocked ⇒ no confirmation offered and no token minted**; token mint on pass | 🟡 | T16, T30 | ⬜ |
| **T20** | **`POST /api/business-os/purge/commit`** — `.strict()` Zod; authz; token verify; typed-name match against `company_name` falling back to account email; **re-run the gate**; snapshot; RPC; storage; audit; structured result | 🟡 | T16, T19, T30 | ⬜ |
| **T21** | **Route integration tests** — happy, 401, **403 non-admin Reset**, 400 Zod, injected `userId` in body/header/query, token mismatch, **missing HMAC key ⇒ 500 not bypass (C-7)**, wrong typed name, blocked-by-gate, missing-table fail-closed, concurrent double submit | 🟡 | T19, T20 | ⬜ |

### Stage 6 — Surfaces

| # | Task | Cx | Depends | Status |
|---|---|---|---|---|
| **T31** | 🆕 **Retire `/api/user/delete-account` (§9.3).** Standalone `fix/` branch — **RM creates it**. Route reduced to a **`410 Gone`** shim naming the replacement; all deletion logic deleted, taking its 16 `console.*` with it. **Must land before T24**. **Now covers all FIVE delete affordances via one shared component (N7, CR-1)** | 🟡 | RM branch | ✅ **code complete — needs the `fix/` branch (N6)** |
| **T22** | 🔒 **HELD until T30.** **Danger Zone tab** on `/test-business-os` — admin-gated server-side; Reset **and** Purge; technical copy; the FR-24 re-arm note **here only** | 🟡 | T19, T20, T30 | 🔒 |
| **T23** | **Feature flag** `NEXT_PUBLIC_ENABLE_BUSINESS_DELETE` / `useBusinessDeleteSurface()`, default **off** | 🟢 | — | ⬜ |
| **T24** | 🔒 **HELD until T31 + the FR-26/AC-26 amendments.** **Customer flow behind the existing Danger Zone button** — Purge only; plain localised copy (en/es/he), **no table names**; FR-23 retention sentence; FR-25 subdomain sentence; **the corrected FR-26 sentence** ("calendar events resync within minutes; channel stats on their next scheduled sync; insights and metrics rebuild once you create new data"); the DEV-Q11 data-export sentence + link; actionable blocked message; **a11y — keyboard-operable dialog, confirmation input associated with its instruction, blocked state announced to assistive tech and never conveyed by colour alone**. **Flag-off interim state:** the button stays and opens a dialog that offers **data export** and a **named erasure-request channel** — never an empty Danger Zone (C-5's spirit), never a broken delete | 🔴 | T19, T20, T23, T31 | 🔒 |
| **T25** | **Post-purge destination (FR-27, AC-44)** — result screen → explicit sign-out CTA → `/login?businessDeleted=1`. Never a silent drop into `/onboarding-chat` | 🟡 | T24 | ⬜ |
| **T26** | **Double-submit + progress** — client in-flight guard; progress signal; distinct timeout message explaining that a timed-out RPC **rolled back** and nothing was deleted | 🟢 | T24 | ⬜ |

### Stage 7 — Verification

| # | Task | Cx | Depends | Status |
|---|---|---|---|---|
| **T27** | **Cron register** — name each of the 7 cron routes' selection predicate and which level starves it. **This document is the *input* to AC-25, not evidence for it** (SA); AC-25/AC-27 are proved in T28 | 🟡 | T4 | ⬜ |
| **T28** | **Full AC sweep on a seeded business** — Reset then re-run the full flow (AC-41), Purge then re-seed with a new `user_code` (AC-42), **cross-tenant sweep with a second business (AC-24)**, §8 exclusions unchanged incl. the plan-cache **content checksum** (AC-23), B1–B4 traps (AC-19–21), `crm_activities` empty (AC-22), **AC-5's id set non-empty and matching the seeded count (C-14)**, AC-25/AC-27 proved live, and the **D9 un-gating checklist** (AC-2, 5, 10, 13, 16, 24, 37) demonstrated on a real account. Report the measured budget and ceiling constants | 🔴 | all | ⬜ |

### Stage 8 — Hand-offs and docs

| # | Task | Cx | Depends | Status |
|---|---|---|---|---|
| **T32** | 🆕 **Written summary to Offir on `/api/auth/cleanup-incomplete`** (user decision 2 — **note it, do not act on it**). Sent **once this cycle finishes**. Contents in §11.3. **Confirmed not to conflict with anything Offir has already done — nothing is armed today.** No fix is spun up this cycle; the decision follows the summary | 🟢 | end of cycle | ⬜ |
| **T29** | **Docs + follow-ups** — update `BUSINESS_OS_DATA_MODEL.md` with FR-1's findings; record the D9 un-gating checklist as the flag's exit criteria; **file four follow-ups with named owners**: (1) the `authenticated` grant on the advisory-lock wrappers (any logged-in user can lock or unlock any id platform-wide — a trivial DoS on every background drain), (2) a shared rate-limit primitive, (3) `stripeAccountContext`'s direct Supabase access (S4), (4) `insight-detect`'s four unpaginated `.limit(500)` enumeration selects (SA §12.6 Amendment 4) | 🟢 | T28 | ⬜ |

---

## 7. Task → FR / AC Mapping

**Verified, not asserted.** SA's machine check found 44 of 49 in rev 1; AC-16, AC-29, AC-33, AC-41 and AC-42 were absent, and **AC-33 was genuinely unowned**. All five are below, AC-33 has a real owner (T9 for the ordering, T15/T21 for the test), AC-25/AC-27 are re-pointed from T27 to **T28**, and AC-48 gains T8 and T10. I re-ran the check after editing — see the verification note at the end of this section.

| FR | Task(s) |
|---|---|
| FR-1 schema verification | T1, T7 |
| FR-2 one business, no client id | T19, T20, T30 |
| FR-3 two levels | T4, T9 |
| FR-4 opt-in extras | T4, T9 |
| FR-5 gate before any deletion | T13, T16 |
| FR-6 provider enumeration, all accounts | T13 |
| FR-7 fail closed | T13 |
| FR-8 skip cleanly | T13 |
| FR-9 gate in the dry-run | T16, T19 |
| FR-10 re-evaluated pre-RPC | T16, T20 |
| FR-11 typed confirmation, no grace | T20, T24 |
| FR-12 snapshot + read-back + child ids | T10 |
| FR-13 all tables + buckets + orphan counts | T4, T17 |
| FR-14 cron starvation | T27, T28 |
| FR-15 B1–B4, no FK altered | T3, T9 |
| FR-16 exclusions untouched | T4, T6 |
| FR-17 T5 handled by ordering | T3, T9 |
| FR-18 three-phase execution | T8, T9, T16 |
| FR-19 structured result | T16 |
| FR-20 audit incl. blocked | T18 |
| FR-21 correlationId continuity | T16 |
| FR-22 non-transactional storage | T17 |
| FR-23 copy does not claim total erasure | T24 |
| FR-24 re-arm documented (internal only) | T22 |
| FR-25 subdomain release stated | T24 |
| FR-26 Reset not permanent *(amended)* | T24, T27 |
| FR-27 post-purge destination | T25 |
| FR-28 double submission *(amended)* | T9, T26 |
| FR-29 Zod on both routes | T19, T20 |
| FR-30 auth.users / profiles never deleted | T4, T6, T31 |
| FR-31 no bypass of the gate | T13, T16, T23, T30 |
| NFR delete scoping | T4, T6 |
| NFR logging | all |
| NFR tests | T6, T8, T10, T15, T21 |

**All 49 ACs, each with an owner:**

| AC | Owner(s) | AC | Owner(s) | AC | Owner(s) |
|---|---|---|---|---|---|
| AC-1 | T19, T28 | AC-18 | T18, T21 | AC-35 | T10 |
| AC-2 | T9, T28 | AC-19 | T9, T28 | AC-36 | T10, T28 |
| AC-3 | T2, T9, T28 | AC-20 | T9, T28 | **AC-37** | T7, T21 |
| AC-4 | T17, T28 | AC-21 | T9, T28 | AC-38 | T9, T21 |
| **AC-5** | T10, T28 | AC-22 | T3, T9, T28 | AC-39 | T19, T20, T21 |
| AC-6 | T13, T15 | AC-23 | T4, T6, T28 | AC-40 | T23, **T30**, T28 |
| AC-7 | T13, T15 | **AC-24** | T6, T28 | **AC-41** | T28 |
| AC-8 | T13, T15 | AC-25 | **T28** (T27 is its input) | **AC-42** | T28 |
| AC-9 | T13, T15 | AC-26 | T24, T28 | AC-43 | T24, T28 |
| **AC-10** | T13, T15 | AC-27 | **T28** (T27 is its input) | AC-44 | T25, T28 |
| AC-11 | T13, T15 | AC-28 | T19, T20, T21 | AC-45 | T6 |
| AC-12 | T16, T19, T21 | **AC-29** | T16, T20, T21 | AC-46 | T16, T18, T21 |
| **AC-13** | T13, T15 | AC-30 | T20, T21 | AC-47 | T17, T28 |
| AC-14 | T13, T15 | AC-31 | T4, T6, T28 | AC-48 | T6, **T8**, **T10**, T15, T21 |
| AC-15 | T13, T16, T21 | AC-32 | T4, T9, T28 | AC-49 | T21, lint |
| **AC-16** | **T13, T15, T28** | **AC-33** | **T9** (ordering), **T15, T21** (test) | | |
| AC-17 | T13, T15 | AC-34 | T4, T9, T28 | | |

**Bold** = a D9 un-gating condition (AC-2, 5, 10, 13, 16, 24, 37) or one of the five SA found missing (AC-16, 29, 33, 41, 42).

**Verification note.** I enumerated AC-1…AC-49 against this table mechanically rather than by eye: 49 numbers expected, 49 present, no duplicates, no gaps. The rev-1 sentence "every one of the 49 ACs has an owning task" was **false when I wrote it** — it was an assertion, not a check. It is now a check.

---

## 8. Test Plan

| Level | Scope | Task |
|---|---|---|
| **Unit — structural invariant** | Five invariants (§2.2): scope-or-never, no unscoped delete emitted, every §8 exclusion present, **B-1 single Supabase importer**, **C-16 no bucket literals**. Plus forbidden exclusion syntax and `p_` params. Proven against a broken fixture | T6 |
| **Unit — gate** | C1, C2 charges, C2 refunds, C2 dashboard-issued refund with no local row, C3, fail-closed, no-Stripe, page cap, wall-clock budget, multi-account, platform-scoped read miss, **AC-16 message content**, **AC-33 ordering** | T15 |
| **Unit — repository** | Per method: scoping applied, pagination exhausts, no soft-delete filter, `ids` mode selects only ids, RPC params shaped, storage listing scoped | T8 |
| **Unit — snapshot** | Child-id capture in the same exhaustive pass (C-13), read-back verification, write-fail and readback-fail both abort with zero deletes, ceiling breach refuses, customer path carries no PII | T10 |
| **Unit — token** | `canonicalJson` determinism (C-9), `timingSafeEqual` (C-8), TTL, `gateVersion` invalidation, **missing key ⇒ fail closed (C-7)** | T16 |
| **Integration — preview** | Happy, 401, **403 non-admin Reset**, 400 Zod, 400 injected `userId` (`.strict()`), blocked-by-gate ⇒ no token | T21 |
| **Integration — commit** | Happy, 401, 403, 400, token mismatch, missing HMAC key, wrong typed name, blocked-by-gate, missing-table fail-closed, concurrent double submit | T21 |
| **Manual / live sweep** | All 49 ACs on a seeded business; **AC-24 cross-tenant sweep**; AC-41 re-run after Reset; AC-42 re-seed after Purge; the D9 un-gating checklist on a real account | T28 |

**QA note (doubly load-bearing under B-1).** AC-2's "returns 0 rows" and AC-23's "unchanged" must be asserted with **raw, unfiltered** queries. Asserting them through existing repositories would be unsound: `ContactDocumentsRepository` applies `.neq('status','deleted')` to an in-scope table, 31 of 52 classes carry `.limit()`/`.range()`, and PostgREST caps an unbounded select at 1000 rows regardless.

**QA note (AC-5).** The snapshot is an artefact produced by the system under test, so it can lie in one specific way: capture zero ids and the assertion passes vacuously. **Assert the id set is non-empty and matches the seeded count first** (C-14).

---

## 9. Decisions, Rulings Applied, and What Still Needs SA

### 9.1 Status of the twelve rev-1 concerns

| # | Ruling | Applied in |
|---|---|---|
| **DEV-Q1** | ✅ Granted, bounded by B-1…B-4 — a **granularity** choice inside the repository layer, not a layering waiver | §3.1, T6 invariant 4, T8 |
| **DEV-Q2** | ✅ Dev right; FR-28 amended to `pg_try_advisory_xact_lock` inside the RPC. The `authenticated` grant on the existing wrappers is now a **tracked follow-up**, not a footnote | §2.1, T9, T29 |
| **DEV-Q3** | ✅ Hazard verified line by line. **User chose the disposition** — see §9.3 | T31, T24 |
| **DEV-Q4** | ✅ Dev right; FR-26/AC-26 amended — **and my replacement copy corrected in turn** (channel stats: next scheduled sync, up to ~20 h, not "within the hour") | §1.2, T24 |
| **DEV-Q5** | ✅ Accepted for v1; the cache is **per-instance best-effort and must never be called rate limiting** | §2.4, T14, T29 |
| **DEV-Q6** | 🔄 **Split, not either/or** — ids-only for the two unbounded public-write analytics tables (a ceiling there would make a busy business **undeletable**); ceiling-refusal for everything else | §4, T4, T10 |
| **DEV-Q7** | 🔄 **Ruled harder than I asked** — `cleanup-incomplete` is **dormant today**, not merely at risk, so it is not a viable enforcer host. Customer snapshot goes no-PII by default; enforcer re-hosted; T11 needs a verified live run | T10, T11, §5.4 |
| **DEV-Q8** | 🔄 **My arithmetic was wrong in my own favour** — `resolveUserConnectAccounts` dedupes, so 4 traversals not 8. Refusal semantics and the synchronous shape both stand; budget from measurement, ≤ ½ `maxDuration`, escalate above 20 s on a clean single-account business | §2.4, T13 |
| **DEV-Q9 / Q10** | ✅ Agreed; Q9 now doubly load-bearing under B-1 | §8 |
| **DEV-Q11** | ✅ Approved — one sentence and a link to the existing `/api/user/data-export` | T24 |
| **DEV-Q12** | ✅ Accepted, **with my own correction corrected**: 54 files, 52 classes; the requirement's "54" was right about files | §1.2 |

### 9.2 §8.7 is closed, not outstanding

SA read both plural-named migrations so neither of us has to guess: `execution_optimization_tables` creates `execution_baselines` and `execution_anomalies`, **both already listed in §8.7**; `platform_learning_tables` creates `workflow_patterns` and `global_failure_patterns`, **neither of which has a `user_id` column** — they are platform-wide aggregates (`pattern_hash`, `popularity`, `affected_users_count`) with no RLS policy.

A table with no `user_id` is **never returned by FR-1 route (a)'s enumeration**, so it can never trip AC-37's unknown-table check, so it needs no descriptor. **The requirement §11.2 obligation is discharged statically.** T2(c) drops from 🔴 "expand from the dump, never invent names" to 🟡 "one grep against the dump confirming no third table appeared live" — a confirmation, not a discovery, and not skippable.

### 9.3 The existing Delete-account button — decision: **reuse it (option a)**

The user rejected "remove it and put up a support message" and asked for one of two plans. **I choose (a): the existing Danger Zone button becomes this feature's customer surface.** Justification, against SA's verified facts.

**What the facts force, regardless of option.** The route deletes `auth.users` (D3/FR-30 forbid it absolutely), deletes `user_preferences` — **table #60, the `K*` this feature guarantees survives** — audits **intent but never outcome**, and **500s at phase 6 for every onboarded user** because 16 `REFERENCES auth.users` declarations carry no `ON DELETE`, after phases 1–5 have already irreversibly deleted six tables and anonymised the profile. It leaks `error.message` with no `NODE_ENV` guard and writes `role: 'deleted'` into the user-writable `profiles.role`. **None of that is functionality to improve — it is a live data-destroying bug.** So under either option the implementation must stop being reachable immediately, and that is T31.

**Why (a) and not (b).**

1. **The user's intent is that the customer ends up with the working thing, not a redirect.** Option (a) delivers exactly that: one button, in the place customers already look, which becomes the gated, snapshotted, audited purge. Option (b) creates a second affordance and then has to explain why the first one is going away.
2. **(a) eliminates the collision at every flag state.** SA's objection to (a) was that it "leaves the collision live whenever the flag is off" — but that objection assumes (a) means *keep the old route and add a new one*. It does not. **T31 removes the old implementation on day one**, independent of the flag. There is exactly one button, and it never calls the old code at any flag state. SA's objection to (c) — two adjacent buttons in one red box, one deleting the login and one explicitly not — is likewise avoided.
3. **(b)'s "formal deprecation" is strictly more moving parts for the same end state**: build a second section, then remove the first, then reconcile the copy. (a) reaches the same place in one step.
4. **No naming lie, because the button is reused and the route is not.** This is the one place I deviate from a literal reading of (a): `POST /api/user/delete-account` does **not** become the new implementation. It becomes a **`410 Gone` shim** pointing at `/api/business-os/purge/*`. Keeping the name "delete-account" on an operation that provably **does not delete the account** would be precisely the class of defect that produced this cycle's three deletion hazards. The *button* is the customer-facing surface being reused; the *endpoint* is retired honestly.

**What the button does at each state.**

| State | Behaviour |
|---|---|
| **Today (before T31)** | Calls the broken route. Every day this is reachable is exposure — hence T31 is an independent `fix/` branch that can land before Stage 0 finishes |
| **After T31, flag off** | Button stays. Opens a dialog offering **data export** (the existing, working `/api/user/data-export`, already wired into the same tab) and a **named erasure-request channel**. Not an empty Danger Zone (C-5's spirit), not a broken delete |
| **After T24, flag on** | Button opens the full flow: gate → dry-run preview → typed confirmation → commit → result → sign-out |

**Closing the interim honestly.** The flag-off window is the one part of this the user will like least, and I am not going to pretend it away: it *is* a request-based path, which is close to what the user rejected. Two things bound it. **T28 already demonstrates the entire D9 un-gating checklist** (AC-2, 5, 10, 13, 16, 24, 37) on a real account as part of this cycle — so the criteria for turning the flag on are met **inside this cycle**, not in some later one. I therefore propose **un-gating as part of this cycle's exit**, on the user's approval after T28. That makes the interim days, not months. **If the user wants the window shorter still, the lever is to sequence T31 + T24 ahead of the internal surface rather than behind it** — say so and I will re-order.

**Two things I want confirmed** (SA's E2, which the user's decision narrows but does not fully close): the **support/erasure-request address named in the flag-off copy must actually reach someone**, and someone must own it. A named channel nobody reads is worse than no channel.

**Scope consequence:** `app/api/user/delete-account/route.ts` is **in scope**, in T31, on a separate `fix/` branch. Its **16 `console.*` calls are deleted with the code they live in, not converted** — see §10.

### 9.4 Implementation findings — things that did not survive contact with the code

Recorded as measured, with what each one changes. Detail for the schema findings is in [the T1 dump doc](/docs/workplans/business-os-business-data-purge-schema-dump.md).

#### 🔴 F-1 — `/api/user/delete-account` has **four** callers, and the one SA and I both verified is dead code

DEV-Q3, SA's line-by-line verification and C-21 all name a single surface: `components/business-os/settings/SecurityTab.tsx:305`. Measured repo-wide, there are **four** wired buttons POSTing `DELETE_MY_ACCOUNT` to that route:

| Caller | Live? | Evidence |
|---|---|---|
| `components/business-os/settings/SecurityTab.tsx` | ❌ **DEAD** | Not exported from `components/business-os/settings/index.ts` (which exports only `ProfileTab`, `BusinessTab`, `LeadNotificationToggles`), and imported by **nobody**. `app/business-os/settings/page.tsx` imports only `LeadNotificationToggles` from that directory |
| `app/business-os/settings/page.tsx:395 / 406 / 958` | ✅ **LIVE** | Its own inline Danger Zone. Routable at `/business-os/settings`, reached from `BusinessOSHeader.tsx:161` and `UserMenu.tsx:151` |
| `components/v2/settings/SecurityTabV2.tsx:159 / 185 / 345` | ✅ **LIVE** | Rendered by `app/v2/settings/page.tsx:202` |
| `components/business-os/settings/ProfileTab.tsx:307 / 319 / 801` | ⚠️ barrel-exported, **no importers** | Effectively dead, but one import away from live |

**The hazard is real and its blast radius is two live settings surfaces, not one.** What was wrong is the *location*: SA and I each verified the file we found first and stopped. That is the `business-os-schema-check` Rule 5 lesson — "check every query in the file, not just the one you came for" — generalised from queries to callers.

**What it changes:**

1. **The `410 Gone` shim is unaffected, and is now doing more work than planned** — it neutralises the server for all four callers at once, which is itself the argument for retiring the route rather than repairing each button.
2. **C-21's client coupling does not yet hold.** I removed `handleDeleteAccount` from the dead `SecurityTab.tsx`. The **two live surfaces still POST to the route**, so with the shim in place they would show an error toast — precisely the outcome C-21 exists to prevent. **T31 is therefore incomplete, not done.**
3. **§9.3's "reuse the existing button" must name *which* button.** There are two live ones, on two surfaces split by the `uiVersion` routing in `middleware.ts`. That is a product/UX question about where customer-facing business deletion belongs, and I am not answering it silently. **See N7.**

**Recommended shape**, for SA/owner sign-off: extract the interim erasure-request panel into one shared component, use it from every live surface, and pick **one** surface to carry the full purge flow at T24. Duplicating the panel would also duplicate the placeholder erasure address — the one thing N2 needs to stay singular and greppable.

#### 🔴 F-2 — 38 live user-scoped relations are in neither the delete set nor the exclusion set

**117 relations carry a `user_id`; the requirement enumerates 79.** Under FR-1 condition (iii) / AC-37 the engine **fails closed on its first run** until every one is classified. This is FR-1 catching exactly what it was built to catch, at the point it was sequenced to catch it — but it is a **§8 amendment of up to 38 rows, materially larger than "§8.7 is seeded, not closed"**.

Most are plainly kernel / billing / token-accounting and belong at `level: 'never'`. Several are not obvious and need a product ruling rather than a Dev default — `business_chat_verified_questions` (every other `business_chat_*` table is in the **delete** set), `proposals`, `lead_responses`, `daily_briefings` / `daily_briefing_sends`, `user_media`, and five billing tables §8.5 never named. **BA/SA classification pass — see N8.**

**Do the base-table/view split first.** My measurement is the PostgREST OpenAPI spec, which exposes views alongside tables; the FR-1 RPC filters `table_type = 'BASE TABLE'`. Several names are views by convention (`agent_executions_with_details`, `top_complex_agents`, `active_plugin_connections`, `agent_memory_stats`), and a view needs no descriptor — so the real number is **≤ 38** and free to reduce.

#### 🟡 F-3 — T2's unknowns are all resolved, and two answers change scope

| Table | Result | Change |
|---|---|---|
| `business_intake_forms` | **EXISTS**, has `user_id` | §10.2 ¶2's contingent second half is **live, not void**. **AC-3's intake assertion stands and must be tested.** Requirement §11.1 closes |
| `payment_methods` | **EXISTS** | The drop migration was never applied. **Stays in the purge set as `D`** |
| `websites` | **ABSENT** | Drops out of the purge set |
| `processed_webhook_events` | **EXISTS and HAS `user_id`** | §3.15's stated default ("if not, it is global") does not apply — **needs a ruling** |
| `audit_logs` | **EXISTS**, has `user_id` | SA verified it as probably phantom; it is not. **Needs a ruling.** Distinct from `audit_trail`, so the §10.3 checkbox does not cover it |
| `agent_versions`, `usage_records`, `user_api_keys`, `contact_submissions` | **ABSENT** | All phantom as expected. §8.9's `contact_submissions` caveat is moot |
| `workflow_patterns`, `global_failure_patterns` | **EXIST, no `user_id`** | ✅ **SA's static closure of §8.7 confirmed live.** Requirement §11.2 discharged |
| `behavior_rules`, `execution_model_tracking` | **ABSENT** | Listed in §8.7 but do not exist — inert descriptors |
| `intent_examples` | **EXISTS, no `user_id`** | Listed in §8.7 but never enumerated — inert |

#### 🟡 F-4 — `insight_outcomes` (in-scope table **#53**) does not exist

`lib/repositories/OutcomeRepository.ts` queries it at lines 92, 135, 151 and 174. The table is absent from the live schema, so every one of those calls fails. This is the `business-os-schema-check` **Rule 5 "never worked"** shape, which that skill says must **not** be fixed by deleting the reference — doing so leaves the code running and silently returning empty, which is worse than the error. **It drops out of the purge set**; the repository needs a rebuild-or-retire product decision outside this cycle.

#### 🟡 F-5 — `AdminAccessService.isAdminById()` is the wrong method for T30

The workplan and SA's verification both named `isAdminById`. Reading it (`lib/services/AdminAccessService.ts:137`), it checks **only already-bound `user_id`s** — it deliberately skips the two other resolution paths `isAdmin(user)` has: the DB row seeded **by email** (which `isAdmin` then self-heals by binding the `user_id`), and the `ADMIN_EMAILS` env fallback.

Both routes have the full user from `getUser()`, so **T30 calls `isAdmin({ id, email })`**. Using `isAdminById` would deny a legitimately seeded admin whose row is not yet bound — and on a fail-closed path, a silent false negative is indistinguishable from correct behaviour.

#### 🟡 F-6 — `exec_sql` does not exist, so T1 could not apply its own migration

Five scripts under `scripts/` call `supabase.rpc('exec_sql', …)`. The RPC is not in the live database, so **none of them can ever have worked.** With no `pg` driver and no `DATABASE_URL` either, **applying `20260915a_purge_schema_introspect.sql` requires a human in the Supabase SQL editor.**

T1 was not blocked by this. The **PostgREST OpenAPI spec** (`GET /rest/v1/` with the service-role key) returns every exposed relation and column, read-only, with no DDL and no writes — which is where F-2, F-3 and F-4 come from. It cannot return `pg_constraint`, so **T3's delete order remains blocked.** That is the one thing genuinely waiting on the SQL editor.

#### 🟢 F-7 — the unpinned Stripe count, repo-wide

SA measured `lib/` + `app/`: **27 construction sites, 12 unpinned across 6 files.** I reproduced that exactly. Repo-wide (including `scripts/`) it is **47 sites, 13 unpinned across 7 files**, the extra being `scripts/reconcile-stripe-payments.ts:766`. T12's comment uses SA's `lib`+`app` figures and notes the script separately.

#### 🔴 F-8 — a shared Danger Zone component cannot call `useLanguage()`; it would have crashed `/v2/settings`

Found while implementing N7. `useLanguage()` **throws** outside a provider (`LanguageContext.tsx:10070`), `LanguageContext` itself is module-private, and **`app/v2/layout.tsx` provides only `V2ThemeProvider` — there is no `LanguageProvider` anywhere under `app/v2/**`**. `LanguageProvider` wraps `app/business-os/**`, `app/business-os/crm/**` and `app/onboarding-build/**` only.

So the obvious implementation of the shared component — lift the panel out of `SecurityTab` and render it on both surfaces — would have thrown at render on `/v2/settings`, turning a hazard-removal change into a broken settings page.

**Resolved** by adding `useOptionalLanguage()` beside `useLanguage()`: same context, returns `undefined` instead of throwing. The shared component falls back to English strings kept byte-identical to the `en` entries. `useLanguage()` is deliberately left throwing — an accidental silent fallback to English is a worse bug than a loud missing-provider error, so the non-throwing variant is opt-in.

Second-order detail worth keeping: `t()` returns **the key itself** when a translation is missing, so `tr()` treats `t(key) === key` as a miss and falls back. Otherwise a locale without the new keys would render `settings.security.erasure_request_title` to the customer.

#### 🟡 F-9 — `data_decision_requests` should be `optional:agents`, not `never` (BA's low-confidence flag, answered)

BA asked what writes it. **`lib/pilot/shadow/DataDecisionHandler.ts`** (lines 219, 401, 444), read by `app/api/v6/data-decisions/**` and `app/api/calibrate/status/route.ts`. It is the Pilot/V6 human-in-the-loop mechanism: when a workflow step hits a data ambiguity it raises a request the user answers, with an `expires_at`.

Columns: `id`, `execution_id`, `agent_id`, `user_id`, `step_id`, `step_name`, `failure_category`, `decision_context` (jsonb), `status`, `user_decision` (jsonb), `created_at`, `responded_at`, `expires_at`.

**BA's instinct that it is agent machinery is right, but `never` is the wrong level.** It is keyed to `agent_id` and `execution_id` — both belonging to tables in the **"delete my agents"** checkbox. Retaining it means ticking that checkbox leaves rows pointing at deleted agents and deleted executions, which is precisely the defect that put `agent_prompt_threads`, `agent_prompt_workflow_generation_sessions` and `user_memory` into that checkbox in the first place (§3.16: *"leaving it after 'delete my agents' is the same defect"*). And `decision_context` / `user_decision` hold the values the decision was *about* — it is a **data** decision, so it can contain the user's data.

**Recommendation: `optional:agents`.** BA/SA to confirm.

⚠️ **And a consequence for T3:** **no migration in the repo creates this table** — same as `audit_logs`. Its FKs are therefore unknown until Part 2's `pg_constraint` dump. **If `data_decision_requests.agent_id` references `agents(id)` with RESTRICT or NO ACTION, the "delete my agents" option gains a new FK blocker** in the B1–B4 class, and T3 must catch it. Flagged now so it is looked for rather than discovered inside the phase-2 transaction.

#### 🟢 F-10 — `agent_memory` (singular) exists; there are **four** distinct memory tables

BA's other grep. `agent_memory` is **live and user-scoped**, so §10.3's checkbox list is correct on that point — it was not a migration-file phantom. Measured alongside it:

| Table | Live | `user_id` |
|---|---|---|
| `agent_memory` | ✅ | ✅ |
| `agent_memories` | ✅ | ✅ |
| `run_memories` | ✅ | ✅ |
| `user_memory` | ✅ | ✅ |

All four are distinct relations. With BA adding `agent_memories` and `run_memories` to the checkbox, and `agent_memory` / `user_memory` already there, the family is fully covered — **but it is worth someone asking why there are four**, because a name that close to another name is how the wrong one gets deleted.

#### 🟢 F-11 — dead `components/business-os/settings/SecurityTab.tsx`: proposal

It is provably dead: absent from `components/business-os/settings/index.ts`, imported by nobody. **I have not deleted it** — deleting a file is a bigger call than my remit, and it is currently harmless.

What I did instead: pointed it at the shared `DangerZonePanel` like the live surfaces, so there is exactly one copy of the erasure copy and one erasure address in the tree. Its own handler and local placeholder are gone.

**Proposal: delete it in the T31 `fix/` branch**, together with the dead `ProfileTab.tsx` if BA/SA agree it is equally dead (it is barrel-exported but has no importers, so it is one import away from live rather than fully dead). Reason: a dead file that still describes the retired deletion flow is how the next person rediscovers it and assumes it is the live path — which is exactly what happened to SA and to me in F-1. Deleting it removes the trap; keeping it wired to the shared component only defuses it.

#### 🟢 F-12 — one pre-existing type error in `ProfileTab.tsx`, not mine

`ProfileTab.tsx(334,28)`: `avatar_url: string | null` assigned to a `ProfileForm` whose `avatar_url` is `string`. It sits in the `AvatarUpload` block, **outside every hunk of my diff** (verified against `git diff -U0`). Not fixed — out of scope, and `next.config.js` sets `ignoreBuildErrors`. Recorded so it is not attributed to this cycle.

#### 🔴 F-13 — a **fifth** Danger Zone, live, deleting four tables from the browser (SA's CR-1)

`components/settings/SecurityTab.tsx:234`, rendered at `/settings` via `app/(protected)/settings/page.tsx:22`. **It never called the retired route**, which is exactly why my F-1 sweep missed it — I searched for callers of `/api/user/delete-account`, and this one deletes directly:

```ts
await Promise.all([
  supabase.from('profiles').delete().eq('id', user.id),
  supabase.from('user_preferences').delete().eq('user_id', user.id),
  supabase.from('notification_settings').delete().eq('user_id', user.id),
  supabase.from('plugin_connections').delete().eq('user_id', user.id)
])
setErrorMessage('Account deletion initiated. Please check your email within 24 hours to complete the process.')
```

Three defects, compounding:

1. **It deletes the wrong things.** `profiles` is forbidden by FR-30/D3; `user_preferences` is the `K*` retained by *both* purge levels precisely so the owner's next sign-in is not in the wrong language; `plugin_connections` is an opt-in extra that defaults to **off**.
2. **The promised process does not exist.** No email is ever sent. There is no 24-hour completion step. The account survives; only those four tables do not.
3. **It cannot tell whether it worked.** `Promise.all` inspects no result, and `supabase-js` does not throw on an RLS denial — it returns `{ error }`. The customer sees the identical confirmation whether four tables were deleted or none were. **Both outcomes are lies, in opposite directions**, and the more likely one (RLS denies, nothing happens) is the one that looks like success.

**My F-1 claim was true and answered the wrong question.** "No caller of the tombstoned route remains" was verified and is still verified — but a route-path grep is the wrong oracle for "can a customer still trigger a broken delete". SA named the better one.

**C-27 oracle applied — every delete affordance, not every caller of the dead route.** Two independent sweeps: (a) client-side `.delete()` against identity/account tables plus `auth.admin.deleteUser`; (b) every file containing a delete-account handler name or copy. Results:

| Hit | Verdict |
|---|---|
| `components/settings/SecurityTab.tsx` | 🔴 **CR-1 — fixed.** Browser deletes removed; wired to the shared panel |
| `components/payments/StripeConnectStatus.tsx:176` | ✅ Not a sixth — deletes the **Stripe Connect** account via `/api/payments/stripe-connect/delete` |
| `components/business-os/ConfigurationDialog.tsx` | ✅ Not a sixth — Stripe Connect copy (`config.stripe.delete_account`) |
| `app/v2/agents/[id]/page.tsx:2736` | ✅ Not a sixth — an **agent's** Danger Zone |
| `app/api/admin/users/[id]/terminate/route.ts` | ⚠️ Admin-only termination, out of scope; its `profiles` delete is already commented out |
| `app/api/auth/cleanup-incomplete/route.ts` | ⚠️ Known — E1, handed to Offir via T32 |

**There is no sixth.** Post-fix, the oracle returns only the commented-out line in the admin route.

**Fixed in T31:** handler removed, the `/settings` Danger Zone now renders the shared `DangerZonePanel`. Note this surface has **no `LanguageProvider`** either — `app/(protected)/` has no layout providing one — so F-8's `useOptionalLanguage` fallback was load-bearing here too, not just on `/v2`.

#### 🟡 F-14 — the truncation bug is reachable from my own tooling, and I have changed how I write files

SA lost this document to `io.open(path, "w")` followed by a `UnicodeEncodeError` raised *before* any write: `"w"` truncates on open, so the failure left zero bytes, and the file was untracked so git could not help.

**I hit the same class of error in this session** — a `print()` of a section heading containing `→` raised `UnicodeEncodeError` on this machine's cp1252 stdout. Mine was in a read-only script and destroyed nothing, but it is the same trigger.

Two changes, applied from here on:

- **Every write is temp-then-`os.replace`**, never an in-place `"w"` on the real path. `os.replace` is atomic, so a failure anywhere before it leaves the original untouched.
- **`PYTHONIOENCODING=utf-8`** on any command that prints file content, so a non-ASCII character in a diagnostic cannot abort a script mid-edit.

Recorded because the lesson is not "SA was careless" — it is that a Windows console default plus a truncating open is a live data-loss combination for anyone scripting edits to these documents.

#### 🔴 F-15 — **B6 is a new blocker**, and it sits in the same blind spot as N11

T3's dump answers the blocker question completely. **The full FK graph is cyclic and cannot be topologically sorted** — `scheduling_bookings.contact_id → crm_contacts` is `SET NULL` while other edges run the other way, producing cycles through `crm_contacts`, `scheduling_bookings`, `agents`, `payment_invoices`, `payment_plans`, `scheduling_services`, `workflow_executions` and the two calibration tables.

That turns out not to matter, and the reason is the useful part: **only `RESTRICT` and `NO ACTION` edges constrain a delete.** `CASCADE` removes the child for you; `SET NULL` nulls it. Restricted to blocking edges the graph **is acyclic**, and there are exactly **nine** among the 110 user-scoped base tables. So the RPC does not need a total order over 239 FKs — it needs to honour nine constraints plus `crm_activities`-last. That is a simpler contract *and* a more robust one: a newly added `CASCADE` FK cannot invalidate it.

| ID | Status |
|---|---|
| **B1** `payment_refunds` → `payment_transactions` | ✅ Confirmed, RESTRICT |
| **B2** `payment_plan_subscriptions` → `scheduling_bookings` | ✅ Confirmed, RESTRICT |
| **B3** `insight_automations` → `kernel_executions` | ✅ Confirmed, NO ACTION |
| **B4** `payment_plan_subscriptions` before `crm_contacts` | ✅ Confirmed — **and the mechanism is the trigger, not the FK.** The only FK between them is SET NULL and does not block; the constraint is `delete_future_bookings_on_contact_delete_trigger` tripping B2 |
| **B5** `data_decision_requests` → `agents` | ❌ **Does not exist** — CASCADE. Recorded as a negative result at SA's request. N11's `optional:agents` still stands on its own reasoning, but it adds **no ordering constraint** |
| **B6** 🆕 `agent_logs` → `agents` | 🔴 **NEW.** `agent_logs_agent_id_fkey` is **NO ACTION**, and **both tables are in the "delete my agents" opt-in** — so ticking that checkbox fails unless `agent_logs` goes first |

**B6 lands in exactly the blind spot SA named for N11.** The agents option is **off by default**, so a default T28 sweep passes green whether or not B6 is handled. It is the same trap, found by the same dump, one table over — which is the argument for T28 running the agents path explicitly rather than treating it as an optional extra.

The other five blocking edges (`billing_events`, `boost_pack_purchases`, `user_rewards` → `credit_transactions`; `credit_transactions` → `token_usage`; `billing_events` → `user_subscriptions`) sit **entirely between tables the owner ruled `never`**, so they never constrain a purge. Recorded so that reclassifying any billing table knows it inherits an ordering problem.

**T5 is confirmed against live trigger definitions, not migration files.** Only four DELETE-capable triggers exist in `public`. Of the five `log_*_activity` triggers, exactly one is reachable by a delete-only purge: `payment_refunds` delete → `recompute_transaction_refund_state_trigger` updates `payment_transactions.status` → `log_payment_activity_trigger` writes `crm_activities`. `log_booking_activity_trigger` watches `status`, while the refund propagation writes `payment_status` — **SA's narrowing holds.** `crm_activities`-last remains correct and sufficient. The duplicate `crm_contacts` triggers §5.2 predicted are **both present live**, and both are BEFORE UPDATE, so a delete-only purge never fires them.

#### 🔴 F-16 — `organizations` exposes a gap in the oracle, not just the inventory

`organizations` is a base table, is tenant-owned, and is **absent from FR-1's enumeration** because it keys on **`owner_user_id`**. The predicate is a literal column-name match.

**This weakens AC-37's guarantee rather than merely missing a row.** AC-37 promises the engine fails closed when a user-scoped table is in neither set. A table whose ownership column is named anything else is invisible to that check. `organizations` *is* correctly excluded in §8.4 — but by a human writing prose, which is the mechanism FR-1 exists to replace.

**Measured rather than assumed.** Across all 155 base tables, scanning ten candidate ownership column names: **exactly one** non-enumerated base table carries an owner-ish column — `organizations`. Separately, nine non-enumerated base tables hold an FK to `auth.users`, of which **eight are attribution, not ownership** (`updated_by`, `changed_by`, `acknowledged_by`, `imported_by_user_id`), plus `profiles.id`.

**My recommendation: widen the predicate to the union of (a) a tenancy column by name and (b) any FK to `auth.users`.** Full reasoning and the proposed SQL are in [§9.5 of the dump](/docs/workplans/business-os-business-data-purge-schema-dump.md#95--a-gap-in-the-oracle-itself--organizations). In short: a name allow-list alone fixes today's gap and not tomorrow's; FK-alone misses the many `user_id` columns in this codebase that have no constraint; the union fails safe. Its cost is eight extra `never` descriptors for attribution-only tables — a one-time cost that converts "we think nothing else is tenant-scoped" into a check. **This changes FR-1's text, so SA must rule.**

#### 🟡 F-17 — fifteen open `INSERT` policies, where the requirement named two

§6.3 and AC-27 name two public unauthenticated INSERT paths (`website_page_views`, `smart_link_clicks`). The live dump has **15 `WITH CHECK (true)` INSERT policies**, of which those granted to `public`/`anon` include `agent_memories`, `execution_insights`, `pilot_step_routing_history` (×2), `workflow_approval_requests` and `workflow_step_executions` — alongside the two known ones.

**Three carry a policy name asserting service-role scope while the role list is `public`** (`"Service role can access all agent memories"`, `"Service role can insert insights"`, `"Service role can access all routing history"`). `workflow_step_executions` is granted to `anon` outright.

**Stated with its limit:** a permissive policy is necessary but not sufficient — PostgREST also requires a table-level `GRANT`, which this dump does not capture. So this is **a strong signal, not a proven vulnerability**, and it needs a grants check before anyone acts. It is **outside this feature's scope**; flagged because a policy whose name contradicts its role list is precisely what survives review, and because `agent_memories` is inside the agents opt-in. For SA to route.

#### 🟢 F-18 — inventory reconciled: 110, not 117, and nothing was lost

The RPC filters `BASE TABLE`; my Part 1 count came from the OpenAPI spec, which does not distinguish views. The difference is **exactly seven views**, all droppable at zero cost. Of BA's eight suspected views, **six are confirmed** — but **`agent_stats` and `agent_intensity_metrics` are base tables and still need descriptors**.

**Zero base tables were missing from the OpenAPI list**, so Part 1's set was a strict superset and none of BA's classification work is invalidated. `user_scoped_tables` from the RPC is now the authority for the §3/§8 reconciliation.

#### 🛑 F-19 — the terminate endpoint **is** called by a live UI, so I stopped rather than tombstoning it

The instruction was to confirm nothing in the product calls `POST /api/admin/users/[id]/terminate` first, and to stop rather than break an admin screen silently. **Something does call it**, so I stopped. No tombstone written.

**The caller:** `app/admin/users/page.tsx:360` — `handleTerminateUser()`, behind a confirmation modal with a free-text reason, which on success removes the user from the list and decrements a `totalUsers` stat. A real, finished admin feature, not a stray fetch.

**But the screen protecting it does not exist.** I checked every layer, because "breaking an admin screen" only weighs against tombstoning if the screen is in fact restricted to admins:

| Layer | Guard |
|---|---|
| `middleware.ts` for `/admin` | ❌ **None.** `/admin` is deliberately *not* on the skip list, but the only thing that buys is the **onboarding** check — and that check only runs when an auth cookie parses. No cookie ⇒ falls through to `NextResponse.next()` |
| `app/admin/layout.tsx` | ❌ **None.** 36 lines of chrome — sidebar, header, gradients. No auth, no redirect |
| `app/admin/users/page.tsx` | ❌ **None.** No `useAuth`, no redirect, no role check |
| Any file under `app/admin/**` | ❌ **None.** `grep` for `isAdmin` / `AdminAccessService` / `admin_users` across the whole directory returns **zero files** |
| The API route itself | ❌ **None** — SA's finding |

So the terminate button is not an admin affordance that a tombstone would break. **It is an unauthenticated account-deletion affordance with an unauthenticated back end**, and the UI is as reachable as the route.

**This changes the decision, which is why I am returning it rather than acting.** The user's ruling assumed the trade-off was "retire a dangerous endpoint at the cost of an admin screen". The real trade-off is different, and cuts two ways:

1. **Tombstoning the route alone leaves the UI in place** — the screen still renders to anyone, still lists users, and the terminate button now fails with "Failed to terminate user". That is safer than today, but it leaves a delete affordance on screen for unauthenticated visitors and an error toast as the only thing stopping it. It is the same shape as the C-21 defect I just spent a cycle removing from the customer surfaces.
2. **The UI and the route are one hazard, not two.** The honest fix retires both together.

**Options, for the user and SA:**

| | Action | Effect |
|---|---|---|
| **(a)** | Tombstone the route only, as instructed | Deletion stops immediately. Unauthenticated user-listing screen and a dead button remain |
| **(b)** | Tombstone the route **and** remove the terminate button + modal from `app/admin/users/page.tsx` | Hazard retired coherently, nothing half-wired. Slightly wider than the instruction; still inside the `fix/` branch |
| **(c)** | Put a real `AdminAccessService` guard on the route and keep the feature | ❌ **Not recommended here.** It is a second, ungated deletion path with no snapshot, no descriptor scoping and no outcome audit — the second-code-path problem FU-13 and DEV-Q3 both ruled against. And it would fix one route while 38 others stay open, which is the workstream the user has already separated |

**My recommendation is (b)**, on the same reasoning that made option (a) right for the customer surfaces: retire the endpoint honestly and remove the affordance that points at it, so nothing is left half-wired. I have written nothing pending that ruling.

⚠️ **The wider fact belongs to the separated admin-authz workstream, not to me:** the entire `/admin` surface — every page, not just this one — has no authorization at any layer. I am recording it once here because it changes how urgent that workstream is, and stopping there.

#### 🟡 F-20 — corrected blocking-edge extraction (C-29): SA's filter was right, and the census now reconciles exactly

My earlier extraction required **both** endpoints to be user-scoped. That filter cannot see a child with no tenancy column — which is precisely how B7 hides. Re-run with SA's filter (**every blocking edge whose parent is in the delete set, child unrestricted**), the full census is:

| Group | Count | Disposition |
|---|---|---|
| Parent is `auth.users` | **23** | Inert — D3 never deletes `auth.users` |
| Parent is one of the 110 user-scoped base tables | **10** | The nine I already had, **plus B7** |
| Parent outside the 110 | **4** | `boost_packs`, `reward_config`, `organizations`, `workflow_approval_requests` — all never deleted, all inert |
| **Total blocking edges in `public`** | **37** | ✅ **Reconciles exactly with SA's 37** |

SA grouped these as "23 + 9 + 5"; I group them "23 + 10 + 4" because I count B7 with the in-scope parents rather than with the remainder. Same 37 edges, same single live finding — **no disagreement, and worth stating so the difference in the two write-ups is not read as one.**

**C-29 — all three opt-in sets, external blocking edges:**

| Opt-in | External blocking edges into the set |
|---|---|
| `optional:agents` | **One — B7.** `agent_scheduler_state.last_execution_id → agent_executions`, NO ACTION |
| `optional:integrations` | **None** |
| `optional:activityHistory` | **None** |

(B6, `agent_logs → agents`, is *intra-set* — both tables are in the agents opt-in — so it is an ordering constraint inside the set rather than an external blocker. Both still have to be honoured.)

**C-30 — B7's descriptor.** `agent_scheduler_state` has **no tenancy column**; ownership runs `agent_id → agents.user_id`. Its two FKs are `agent_id → agents` **CASCADE** and `last_execution_id → agent_executions` **NO ACTION**. No code in `lib/` or `app/` references the table at all, so it is written by a database function or is dormant.

```ts
{ table:  'agent_scheduler_state',
  level:  'optional:agents',
  scope:  { kind: 'via', parent: 'agents', fk: 'agent_id' },  // no user_id column
  order:  /* before agent_executions */,
  snapshot: 'ids',
  notes:  'B7: last_execution_id -> agent_executions is NO ACTION, so this must go first. '
        + 'agent_id -> agents is CASCADE, so deleting agents would also clear it — but relying on '
        + 'that would make the ordering depend on an FK action rather than on the descriptor set.' }
```

The resulting agents-opt-in order is `agent_logs` → `agents` → `agent_scheduler_state` → `agent_executions` → the rest. Deleting `agents` first would CASCADE `agent_scheduler_state` away and incidentally unblock `agent_executions`, but **an explicit descriptor is the right mechanism**: it keeps the order a property of the structure the executor iterates rather than an emergent consequence of an FK action someone could later change to `SET NULL`.

**C-31 noted and agreed:** C-2's fingerprint covers the blocking subgraph and stays separate from FR-1's tenancy predicate. They answer different questions, and B7 is the proof that neither subsumes the other — it has **no tenancy column and no `auth.users` FK**, so the N15 union cannot see it; only the blocking-edge check can.

#### 🟢 F-21 — terminate endpoint and its affordance retired together (N18 ruled (b))

Both halves done, in the T31 `fix/` branch:

| File | Change |
|---|---|
| `app/api/admin/users/[id]/terminate/route.ts` | **`410 Gone` tombstone.** No Supabase client, no `auth.admin`, no service-role key. **17 tests**, including the C-21 source scan and two assertions specific to this route: it **never reads `params`** (a tombstone that still resolves the id is one line from acting on it), and it **does not echo the id back** (which would turn a headstone into an id oracle) |
| `app/admin/users/page.tsx` | `handleTerminateUser`, `openTerminateModal`, the row action button, the confirmation modal, the reason field and four pieces of now-dead state removed. Unused `Trash2` import dropped. **9 `console.*` converted to Pino** (rule 3 fires on touch) |

Two details from reading the old implementation that were not in the brief, both recorded in the tombstone's header:

- It returned **`deleteError.message`** to the client with no `NODE_ENV` guard.
- It wrote an audit row with **`user_id: <the deleted user>`** and a literal **`terminated_by: 'admin'`** — attributing the deletion to its own victim, because the route had no idea who the caller was. **Audit that records the wrong actor is worse than no audit: it looks like provenance.**

**Explicitly not a security fix, and the code says so.** The tombstone and the page both carry a scope note: the whole `/admin` surface is unauthenticated, that is a separate tracked workstream, and removing one deletion affordance narrows its blast radius without closing it. **No auth guard was added to the page**, as instructed.

#### 🟡 F-22 — my own C-21 assertion was broken, and it failed *open* in the first tombstone

The comment-stripper in the tombstone tests ran block comments before line comments:

```ts
source.replace(/\/\*[\s\S]*?\*\//g, '')   // block first  <-- wrong
      .replace(/^[ 	]*\/\/.*$/gm, '');
```

The terminate route's header documents the scope limit using the glob **`app/admin/**`**. That `/*` opens a block-comment match which runs to the next `*/` — the JSDoc above `gone()` — **swallowing both imports**. The `createLogger` assertion then failed against a file that plainly uses it.

It surfaced as a red test, so it cost minutes. But the failure direction is the part worth recording: had the swallowed region contained `createClient` instead of an import of the logger, **the no-deletion-primitives scan would have silently passed over it.** A checker whose input is mangled by its own preprocessing reports clean for the same reason it reports broken.

Fixed in both tombstone tests by stripping **line comments first**, with the reason in a comment beside it so the order is not "tidied" back later. The delete-account tombstone happened not to contain a `/*`-bearing line comment, so its assertion was sound — **by luck, not by construction**, which is exactly the distinction worth fixing.

#### 🟢 F-23 — T4 descriptor set written, and it passes AC-37's own check

`lib/business-os/purge/descriptors.ts`: **121 descriptors**, no duplicates, typechecks clean under `--strict`.

**The completeness check that matters, run against the live dump:** every one of the 110 user-scoped base tables has a descriptor. **Zero unclassified.** The engine would not fail closed on its first run. The 11 descriptors for relations *outside* the enumeration are exactly the expected categories and no others: five global catalogs, `organizations` (the `owner_user_id` gap N15 closes), `profiles`, and the four parent-scoped children with no tenancy column (`website_blocks`, `smart_link_clicks`, `user_capability_blocks`, `agent_scheduler_state`).

Ordering is **not** a topological sort — it cannot be, because the full FK graph is cyclic. It is four bands plus `crm_activities` at `LAST`, with `BLOCKING_EDGES` exported from the file so the invariant test can assert `order[child] < order[parent]` for each of the nine **against the live dump**. That makes the ordering verified rather than asserted by whoever last edited a band. B4 cannot be expressed as an FK at all, so it is carried separately in `TRIGGER_ORDERING` with the reason.

**Three of BA's open confirmations answered from the dump, one of them a negative result that saves work:**

| BA's question | Answer |
|---|---|
| Does `user_media` have a storage bucket? (§3.15 #64) | **No new one.** `storage_path` points at the **existing `website-images`** bucket — `GeneratedImageService.ts:41` and `StockImageService.ts:58` both set `BUCKET = 'website-images'` and record into `userMediaRepository`. **No fourth `StorageDescriptor`, and AC-4 does not extend to a new bucket.** |
| Is `business_chat_verified_questions.user_id` nullable? (§3.8 #44) | **NOT NULL.** So §8.2's portable-row shape does **not** apply to it — it is a plain scoped delete. Only `business_chat_plan_cache` is nullable, and it keeps the equality-predicate prohibition |
| Does `agent_memory` (singular) exist? (§10.3) | **Yes**, live and user-scoped — not a migration-file phantom. And there are **four** memory tables: `agent_memory`, `agent_memories`, `run_memories`, `user_memory` |

⚠️ **One requirement amendment still pending, and the descriptor set is ahead of it.** §8.10 still lists `data_decision_requests` as provisionally `never`, awaiting the identification T4 was asked to supply. I supplied it (F-9) and SA ruled **`optional:agents`** (N11), so the descriptor is written that way with the divergence flagged in its own `notes`. **BA needs to move it from §8.10 into §10.3's agents checkbox** so the document and the code agree.

⚠️ **§8.13 needs the same treatment:** six of its eight suspected views are confirmed views and drop at zero cost, but **`agent_stats` and `agent_intensity_metrics` are base tables** and now carry real `never` descriptors. The list should say so rather than leaving them filed as views.

#### 🔴 F-24 — C-35: the two retired routes' findings, preserved before the files were deleted

C-34 replaced the per-file tombstones with one repo-wide guard and **deleted both route files**. Everything the tombstone headers documented is recorded here, because it was the only place it lived.

**`POST /api/admin/users/[id]/terminate`** — hard-deleted an arbitrary `auth.users` row from a URL path parameter, on a module-scope service-role client, with **no authentication of any kind**: no `getUser()`, no admin check, not even the untrustworthy `profiles.role`. `middleware.ts` skips all of `/api`, so nothing upstream gated it. Two further defects:

- It returned **`deleteError.message`** to the client with **no `NODE_ENV` guard**, against the Security Rules table.
- It wrote an audit row as:

  ```ts
  await supabase.from('audit_trail').insert({
    user_id: userId,                                  // <- the DELETED user
    action: 'TERMINATE_USER',
    details: { reason, terminated_by: 'admin' },      // <- a literal string
  });
  ```

  **The audit row attributes the deletion to its own victim**, and records the actor as the literal string `'admin'` — because the route had no idea who the caller was, having never authenticated one. There is no actor id anywhere in the record. SA calls this the cleanest example in this codebase of **an audit record that looks like accountability and contains none**: it would survive a compliance review, satisfy a "was this logged?" question, and tell you nothing about who did it.

**`POST /api/user/delete-account`** — the findings are already in §9.4 F-1 and §9.3; restated in one line so deleting the file loses nothing: it deleted `auth.users` (forbidden by D3/FR-30), deleted `user_preferences` (the `K*` retained by both purge levels), audited **intent but never outcome**, leaked `error.message` unguarded, wrote `role: 'deleted'` into the user-writable `profiles.role`, and **500'd partway through for every onboarded user** — 16 `REFERENCES auth.users` declarations carry no `ON DELETE`, so the final delete raised an FK violation after six tables had already gone.

Both summaries also go into T32 (§11.3), where the count of live deletion paths now stands at **five**.

#### 🟢 F-25 — the repo-wide guard found a sixth candidate, and it was legitimate

Running the new guard for the first time produced two hits. Recorded because "the guard found nothing" would have been the less informative outcome:

| Hit | Verdict |
|---|---|
| `app/api/plugin-connections/route.ts` — `.from('plugin_connections').delete()` | ✅ **Legitimate.** Scoped `.eq('plugin_key', …).eq('user_id', userId)` — a user disconnecting their own integration. `plugin_connections` was therefore moved out of the SERVER table list and kept in the CLIENT one, where a delete would still be the CR-1 shape. Adding an allow-list entry for ordinary behaviour would have been the wrong fix: **an allow-list padded with routine exceptions stops being read**, which is the failure mode it exists to prevent |
| The guard file matching itself | ✅ Excluded **by exact path**, not by skipping `__tests__`. It must contain every forbidden primitive by construction. Blanket-exempting test directories would leave a hole large enough for the next incident |

The guard runs in ~4s over 500+ files, so it can run every build.

### 9.5 Still needs SA or the owner

| # | Item | Who |
|---|---|---|
| **N1** | **E1 — `/api/auth/cleanup-incomplete` is a dormant mass-account-deletion hazard armed by the pending `CRON_SECRET` change.** The user approved sending Offir a heads-up **now**, decoupled from the decision; T32's full summary still lands at cycle exit | Owner + Offir |
| **N2** | 🟠 **Interim: the erasure contact is now `meiribarak@gmail.com`** — the product owner's personal address, as a temporary unblock because no support mailbox exists. **It is rendered to every customer on three settings surfaces**, so replacing it is a product decision, not a config tidy. Defined in exactly one place; find it with `grep -rn "TEMP-ERASURE-CONTACT"`. **Owner: Barak**, before or shortly after launch | Owner |
| **N3** | **E3 residue** — whether non-admin internal staff reach the internal Danger Zone. Boundary settled (server-side, `AdminAccessService`); membership ruled **platform admins only** | ✅ ruled |
| **N4** | **Un-gating at cycle exit**, decided on QA evidence. SA confirms T28 genuinely discharges all seven D9 conditions. Build for it; do not assume it | Owner |
| **N5** | **C-18 escalation trigger** — if T13 measures a clean single-account business above 20 s, stop and return to SA rather than raising the number | SA, on trigger |
| **N6** | **T31 needs its own `fix/` branch from RM.** Code complete; files listed in the hand-off. I do not create branches | RM |
| ~~N7~~ | ✅ **RESOLVED — both surfaces, one shared component**, then extended by CR-1 to **all five** delete affordances. `DangerZonePanel` / `ErasureRequestContent` in `components/business-os/purge/` | done |
| **N8** | **Classification of the 38 unclassified user-scoped relations.** ✅ BA classified all 38; §3 60 → 64, §8 30 → 54. **Remaining:** the 8 suspected views in §8.13 drop out once T1 Part 2 confirms them | BA (done) / T1 Part 2 |
| **N9** | **Three schema rulings.** ✅ Ruled: `processed_webhook_events` → `never`; `audit_logs` live and user-scoped; `insight_outcomes` removed from §3 and its repository spun off | ✅ ruled |
| ~~N10~~ | ✅ **RESOLVED.** The user applied the migration; I called `purge_schema_introspect()` and persisted the full output to the dump doc. **T3 is done, T4/T9 unblocked** | done |
| **N11** | ✅ **Ruled `optional:agents`**, on my reasoning. **T3 must look for the FK explicitly:** if `data_decision_requests.agent_id` is RESTRICT/NO ACTION this is **B5 — `data_decision_requests` before `agents`**. ⚠️ **The agents option is off by default, so a default T28 sweep reports green** — T28 must run the agents path explicitly, after T3 confirms | T3, T28 |
| **N12** | ✅ **Ruled: delete both dead files.** Done — `components/business-os/settings/{SecurityTab,ProfileTab}.tsx` removed and the `ProfileTab` re-export dropped from `index.ts` in the same change, so the build does not break. The **live** `components/settings/SecurityTab.tsx` was kept and fixed (CR-1) | done |
| **N13** | 🆕 **`tsc` is not being run by anyone.** SA could not run it (OOMs at ~4 GB; needs `NODE_OPTIONS=--max-old-space-size=8192`), and `next.config.js` sets `ignoreBuildErrors`. I typecheck my touched files with a scoped `tsconfig`, which is a workaround, not a gate. Separate follow-up | SA |
| **N14** | 🆕 **`/v2` has no `LanguageProvider`** (F-8). Ruled out of scope this cycle — wrapping `app/v2/layout.tsx` would change RTL/`dir` handling on a major surface as a side effect of a Danger Zone panel. Separate follow-up | SA |
| **N15** | 🆕 **FR-1's predicate misses `organizations` (F-16).** This is a hole in AC-37's fail-closed guarantee, not one missing row. **Recommendation: union of (a) tenancy column by name and (b) any FK to `auth.users`** — measured cost is 8 extra `never` descriptors. **Changes FR-1's text** | SA |
| **N16** | 🆕 **B6 — `agent_logs` before `agents` (F-15).** New blocker inside the off-by-default agents opt-in. Must be in the descriptor order **and** T28 must run the agents path explicitly — same blind spot as N11 | T4, T9, T28 |
| **N17** | 🆕 **15 open `INSERT` policies, three named "Service role" but granted to `public` (F-17).** Outside this feature's scope; needs a table-`GRANT` check before anyone concludes it is exploitable. `agent_memories` is inside the agents opt-in | SA to route |
| ~~N18~~ | ✅ **RESOLVED — ruled (b), done.** Route tombstoned (17 tests) and the terminate button, modal, reason field and dead state removed from `app/admin/users/page.tsx`. No auth guard added — the `/admin` surface is a separate workstream (F-21) | done |
| **N19** | 🆕 **B7 confirmed and characterised (F-20, C-30).** `agent_scheduler_state` has no tenancy column; needs a `via`-scoped `optional:agents` descriptor, proposed text in §9.4. **C-29 complete: `optional:agents` has exactly one external blocking edge; `integrations` and `activityHistory` have none.** Census reconciles with SA at 37 | T4, T9 |
| **N20** | 🆕 **Two requirement amendments the descriptor set is ahead of (F-23).** (a) `data_decision_requests` — §8.10 still says provisional `never`; SA ruled `optional:agents`, and the descriptor is written that way. (b) §8.13 — `agent_stats` and `agent_intensity_metrics` are base tables, not views, and now carry real `never` descriptors | BA |

## 10. Non-compliant Files Touched (Pino)

Rule 3 fires on **touch**. Every file this cycle has opened, with its `console.*` count at the time and its disposition:

| File | `console.*` | Disposition |
|---|---|---|
| `app/api/user/delete-account/route.ts` | 16 | ✅ **Resolved by deletion.** Reduced to a `410 Gone` tombstone; the calls went with the code that held them |
| `components/business-os/settings/SecurityTab.tsx` | 3 | ✅ Converted, then the file itself **deleted** (N12) — it was dead code |
| `components/business-os/settings/ProfileTab.tsx` | 4 | ✅ Converted, then **deleted** (N12) |
| `components/v2/settings/SecurityTabV2.tsx` | 4 | ✅ **Converted** to `createLogger` + `{ err }` |
| `components/settings/SecurityTab.tsx` | 5 | ✅ **Converted** (touched for CR-1). The **live** `/settings` surface — kept, not deleted |
| `app/business-os/settings/page.tsx` | 0 | Already compliant |
| `app/api/auth/cleanup-incomplete/route.ts` | 10 | ⏸️ **Withheld, and SA endorsed the withholding.** C-17 moved the retention enforcer off this route, so it is no longer touched, and E1 may retire it entirely. A tidy, well-logged mass-deletion hazard reads as *maintained* to the next person. **The 10 calls transfer to T32's summary** so the obligation moves with the decision rather than evaporating |
| `lib/utils/distributedLock.ts` | 13 | ❌ **Not touched** — unused by this feature (DEV-Q2). Reformatting a file I am not working on is against the standard. Recorded for the follow-up on its `authenticated` grant |

**Every file this cycle touched is at 0 `console.*`.**

## 11. Risks, Escalations and Out-of-Scope

### 11.1 Risks carried into this cycle

| Risk | From | Mitigation |
|---|---|---|
| Gate runs on the **fully-privileged** `STRIPE_SECRET_KEY` | D10 / FU-12 | Known, time-boxed, stated in code. The gate's surface is `list`/`retrieve` only. External dependency with an owner |
| TOCTOU between the two gate evaluations | §9 residual 1 | One round-trip under the RPC shape; both timestamps logged and audited |
| Non-blocking provider residue | §9 residual 2 | Reported in the result, never silently dropped |
| A Stripe outage means you cannot delete | §9 residual 3 | By design — a refusal, never a false pass |
| `email_unsubscribes` / `user_preferences` survive | D8 / §3.14 | FR-23's required sentence |
| The live schema may disagree with all of the above | §1.1 | T1 is task 1. No descriptor before the dump |
| **The flag-off interim leaves customers on a request-based erasure path** | §9.3 | Bounded by T31 landing early and by N4's proposal to un-gate at cycle exit |
| **FOUR live deletion hazards surfaced in one cycle** | §1.2, DEV-Q3, E1, CR-1 | `delete_user_by_id.sql` removed (PR #39); `/api/user/delete-account` retired (T31); `components/settings/SecurityTab.tsx`'s browser-side delete removed (CR-1); `cleanup-incomplete` handed to Offir (T32). **SA's framing, and it is the right one: this is not three — now four — legacy mistakes. It is a systemic absence of any inventory of destructive paths, which is the premise this feature was written on and is now its fourth confirmation.** Each was found by a different oracle, and each time the previous oracle had reported clean |

### 11.2 Explicitly out of scope

FU-1 through FU-14. In particular: no provider-side cancellation, no restore from snapshot, no admin-initiated purge of *another* business, no soft delete or grace period, no cron fencing during a run, no migration of the other 18 Stripe call sites, **and no fix for `cleanup-incomplete` (T32 is a summary, not a change)**.

### 11.3 T32 — what the summary to Offir must say

Sent **once this cycle finishes**. Per the user: **note it, do not act on it.** Confirmed not to conflict with anything Offir has already done — nothing is armed today.

1. `vercel.json` schedules `/api/auth/cleanup-incomplete` at **`0 2 * * *`** (daily 02:00).
2. It iterates `auth.admin.listUsers()` and calls **`auth.admin.deleteUser()`** for every user older than **24 h** whose **`user_metadata.onboarding_completed`** is not `true`.
3. **That flag is not the authoritative completion signal.** `middleware.ts` says so in a comment — it checks `business_profiles` and explicitly *not* `user_metadata`. `lib/utils/onboarding-check.ts` treats the metadata flag as legacy backward-compatibility only.
4. **The live `/onboarding-chat` → `POST /api/onboarding/build` flow never writes that flag**, and `markLegacyOnboardingComplete()` has **zero callers anywhere in the tree**.
5. **Therefore every business onboarded through the current flow is a deletion candidate.**
6. It is dormant only because **`CRON_SECRET` is unset** (the route fail-closes at line 17 before doing any work) — and, incidentally, because `listUsers()` is unpaginated so it only ever inspects the first page. Neither is a designed safeguard.
7. **Setting `CRON_SECRET` on Vercel — the change needed to un-dormant the payment queue drains — arms this cron, and all eleven in `vercel.json`, at once.** Today the last line of defence against mass account deletion is a data-integrity constraint: the `business_profiles → auth.users` FK has no `ON DELETE`, so the delete errors out.
8. **Context for the decision: this is the FIFTH live deletion path found in one cycle**, after `delete_user_by_id.sql`, `/api/user/delete-account`, `components/settings/SecurityTab.tsx`'s browser-side delete and `/api/admin/users/[id]/terminate`. **And a finding materially larger than this cron: the entire `/admin` surface is unauthenticated** — no guard in middleware, in `app/admin/layout.tsx`, or on any page, and zero files under `app/admin/**` reference `isAdmin`/`AdminAccessService`/`admin_users`; 43 admin API routes are in the same state. That is its own workstream, but it is the context in which this cron sits. Each was found by a different oracle, and each time the previous oracle had reported clean. The pattern is not a run of unrelated mistakes — it is that **nothing in this codebase inventories its destructive paths**.
9. **This route still has 10 `console.*` calls.** Their conversion was deliberately withheld rather than done, because a tidy, well-logged mass-deletion hazard reads as *maintained* to the next person who opens it. The obligation travels with this summary.
10. **Ask:** do not set `CRON_SECRET` until this has a decision. The decision itself (fix the predicate to `business_profiles.onboarding_completed`, or retire the cron, or something else) comes **after** this summary — running *any* automated account deletion is a product call, not an engineering one.
## 12. SA Review Notes

**Reviewed by SA — 2026-09-15 (workplan review, first pass)**
**Status:** ✅ **Approved with conditions — proceed to implementation**, subject to the 8 rulings below and conditions C-1…C-19. **T11, T22 and T24 are held** until their named conditions are applied. **Two items escalate above SA** (E1, E2), and one of them (E1) is a live production hazard unrelated to this cycle that should not wait for it.

The architecture is sound. The three-phase shape, the rejected resume, ordering-not-suppression, and descriptor-only-iteration are all respected faithfully — this is the first workplan in this cycle that did not need its shape corrected. Dev also did the thing that matters most: measured before asserting. Four of the twelve concerns are correct factual corrections to my own approved requirement, and two of those force FR amendments.

I re-measured every load-bearing claim rather than accepting it. **Three of Dev's claims did not survive that check** (§12.3), and one of my own requirement obligations turned out to be closable statically (§12.4).

---

### 12.1 Rulings on the blocking questions

#### DEV-Q1 — repository granularity → ✅ **Exception granted, narrowly bounded. T8 unblocked.**

**Ruling: one `BusinessPurgeRepository` is correct. Do not write 28 repositories.** Rule-7 sign-off granted for the descriptor-driven repository pattern.

**Why this is not the exception the user's standing preference forbids.** That preference exists to stop "the file already does direct Supabase, so I'll add one more" — i.e. *new DB access written outside the repository layer*. Dev is doing the opposite: **every** database call in this feature lands inside `lib/repositories/`, in a single file, with `user_id` scoping on every read. The question being asked is not *which layer* but *how many classes in that layer*, and rule 1 is silent on granularity. The exception is therefore about class count, not about layering — and that distinction is exactly what bounds it.

**Bounds on the grant (all four are conditions of approval):**

- **B-1.** `BusinessPurgeRepository` is the **only** file under `lib/business-os/purge/**` and `app/api/business-os/purge/**` that imports a Supabase client in any form (`supabase`, `supabaseServer`, `createClient`, `SupabaseClient`). A lint-style assertion in the T6 suite proves it: scan the feature directories for Supabase imports and assert the result set is exactly that one file. Without this the exception silently becomes "direct Supabase wherever convenient".
- **B-2.** Table names and scoping predicates arrive **only** as a `PurgeDescriptor` parameter. The repository contains no table-name string literal anywhere — including in error messages and log lines (log `descriptor.table`, never a literal).
- **B-3.** The grant covers **this feature only**. `BusinessPurgeRepository` is not a general-purpose escape hatch and no other module may import it. Put that sentence in the file's header comment.
- **B-4.** The documented RLS-bypass comment must state **both** reasons — ~20 tables give `authenticated` no DELETE policy (§5.3), *and* the snapshot must read unfiltered — not just the first.

**One correction to Dev's supporting argument.** Dev writes that "several" existing repositories apply `.neq('status','deleted')`. Measured: **three** (`AgentRepository`, `ContactDocumentsRepository`, `OrganizationRepository`), of which exactly **one — `ContactDocumentsRepository` — owns a purge-set table** (`contact_documents`, #6). The under-capture argument still holds and now has a concrete instance rather than a general claim: a snapshot built through `ContactDocumentsRepository` would omit soft-deleted rows that the RPC then deletes. The larger effect is the one Dev understates — **31 of 52 repository classes carry `.limit()`/`.range()`**, and PostgREST caps an unbounded select at 1000 rows regardless. State it that way; the accurate version is more persuasive than "several".

#### DEV-Q2 — advisory lock → ✅ **Dev is right. FR-28 is amended. T9 unblocked.**

Verified against `supabase/SQL Scripts/20260129_add_advisory_lock_functions.sql`: plain session-scoped wrappers around `pg_try_advisory_lock(bigint)` / `pg_advisory_unlock(bigint)`. Over PostgREST on a pooled connection they give exactly the two failure modes Dev names — a concurrent call served by a different backend does not observe the lock (false pass), and a run that dies without unlocking leaves the lock held on a connection handed to unrelated traffic (permanent false block). `pg_try_advisory_xact_lock` inside the RPC releases at COMMIT or ROLLBACK with no unlock call to leak, and is the only correct choice for a one-transaction shape.

"No new DDL" in §12 meant "no new lock table / no new locking infrastructure", not "that specific function". **Use `pg_try_advisory_xact_lock(hashtextextended(p_user_id::text, 0))` inside `purge_business_data`.** FR-28 amendment text is in §12.6.

**Dev's side note is upgraded to a tracked follow-up, not a footnote.** Those wrappers are `SECURITY DEFINER` and `GRANT EXECUTE … TO authenticated`, so any logged-in user can take or release **any** advisory lock id in the database — including ids used by `lib/utils/distributedLock.ts` and anything built on the §8.1 queue-drain pattern. That is a trivially reachable denial-of-service on every background drain in the platform. **File it as a follow-up with a named owner in T29.** Out of scope for this cycle, but it should not be recorded only as a parenthetical inside a workplan.

#### DEV-Q3 — `/api/user/delete-account` → ✅ **Verified independently. Dev's option (b) approved, with a mandatory interim affordance. T24 unblocked once the `fix/` branch lands.**

I read all 290 lines rather than trusting the summary.

| Dev's claim | SA verification | Verdict |
|---|---|---|
| Renders in the Danger Zone at `SecurityTab.tsx:305` | Confirmed — Danger Zone block at ~304, `onClick={handleDeleteAccount}` at ~327 | ✅ |
| Deletes `auth.users` | Confirmed — `serviceSupabase.auth.admin.deleteUser(user.id)`, line 245 | ✅ |
| Deletes `user_preferences` | Confirmed — `deleteTable('user_preferences')`, line 169 | ✅ |
| "Touches none of the 60 BOS tables" | ❌ **Self-contradictory and wrong.** It touches exactly one: `user_preferences` is table **#60**, the `K*` I ruled retained on both levels — and Dev's own preceding bullet says so. The accurate statement is "touches exactly one of the 60, and it is the one table this feature guarantees survives" | 🔄 reword |
| "No audit" | ❌ **Overstated.** It writes an audit row (`auditLog`, line 99) and fails closed if that write fails (117–123). What it never does is audit the **outcome** — `deletionStats` goes to the HTTP response only | 🔄 reword to "audits intent, never outcome" |
| No Zod, no repositories, direct `createClient` | Confirmed — manual `confirmation !== 'DELETE_MY_ACCOUNT'`, `createClient` at 82, no repository anywhere | ✅ |
| "It probably half-fails" | ✅ **Confirmed, and worse than "probably".** `business_profiles.user_id UUID REFERENCES auth.users(id) UNIQUE NOT NULL` (`20260721_create_business_profiles.sql:7`) — **no `ON DELETE` clause**, one migration, no duplicate to disagree with it. Across `supabase/migrations/**`, **16 `REFERENCES auth.users` declarations carry no `ON DELETE`**. So for **any user who has ever completed onboarding**, the phase-6 hard delete raises an FK violation and the route 500s at line 249 — *after* phase 1 has irreversibly deleted `plugin_connections`, `user_preferences`, `user_memory`, `notification_settings`, `security_settings` and `user_api_keys`, and phases 2–5 have archived-and-renamed the agents and anonymised the profile. `supabase.auth.signOut()` at line 260 is never reached, so the user is left signed in to a half-destroyed account with an error | ✅ |

Two things Dev did not name, both relevant: the route leaks `error.message` to the client with **no `NODE_ENV` guard** (283–288), violating the Security Rules table; and it writes `role: 'deleted'` into `profiles` (236), the user-writable column the admin-identification doc says must never be load-bearing.

**Ruling: option (b).** Remove the button and the route in a standalone `fix/` branch, sequenced before T24, following FU-13's already-ruled shape ("remove, don't repair") — which applies with more force here because this path is customer-reachable rather than a testing-only SQL file. Option (a) leaves the collision live whenever the flag is off, which is the default and the entire point of D9. Option (c) ships two adjacent buttons in one red box where one deletes the login and one explicitly does not.

**Mandatory condition on the removal (C-5):** the button is not deleted, it is **replaced** with a short non-destructive block naming a support route for erasure requests, alongside the existing `/api/user/data-export` link (verified present and wired into the same tab). Do not leave an empty Danger Zone.

**On the GDPR dimension — stated plainly, and flagged as a compliance call rather than an architecture one.** My read, for the record and not as legal advice: Art. 17 obliges the controller to *erase on request*; it does not oblige a self-service button, and a documented request channel discharges the obligation. Separately, the existing route does not deliver erasure — it anonymises, deliberately retains agents and financial records, and **for the entire population of onboarded users it terminates in a 500 partway through**, leaving residue nobody has enumerated. **Removing it lowers exposure rather than raising it**, provided C-5's request channel ships in the same commit. The D9 window with no *self-service* deletion is acceptable; a window with no *erasure path at all* is not, and C-5 closes it. **The owner should confirm the support channel named in the copy actually reaches someone.**

#### DEV-Q4 — `insight-detect` enumerator → ✅ **Dev is right. FR-26 and AC-26 are amended. One detail of Dev's replacement copy is also wrong.**

Verified at `app/api/cron/insight-detect/route.ts:142–169`: the tenant set is the union of `payment_invoices`, `scheduling_bookings`, `crm_contacts`, `business_events` — all four `D`. `business_profiles` appears only at line 53 for per-user locale. My §6.3 sentence and FR-26 are false as written; a Reset business is invisible to `insight-detect` until the owner creates new data. `insight-metrics` (`business_events`) and `insight-automations` (`insight_automations`) are the same story.

Dev's two replacements:

- **`calendar-sync`** → `businessProfileRepository.getUsersWithCalendarSyncEnabled(5)` → `.from('business_profiles')`, 5-minute staleness threshold on `calendar_last_synced_at`. `business_profiles` is `K` and the staleness column is kept, so it becomes due **within ~5 minutes**. ✅ correct.
- **`channel-metrics-sync`** → `ChannelMetricsSyncService.syncDue(20, …)` → `ChannelConnectionRepository.findDueForSync(staleBefore, retryBefore)`. `channel_connections` is `K` — **and so is its `last_synced_at`**, the column the staleness window measures. A Reset therefore does **not** make the connection due; it keeps its existing cadence, **up to ~20 hours**, not "within the hour". ⚠️ **Dev's copy errs in the same direction mine did** — promising a return faster than the code delivers.

**Approved rewording, corrected:** *"Your calendar events will sync again within a few minutes. Your channel stats will refresh on their next scheduled sync. Insights and metrics will start rebuilding once you begin adding data again."* Localise en/es/he. AC-26 re-based accordingly — amendment text in §12.6.

---

### 12.2 Rulings on the non-blocking concerns

#### DEV-Q5 — rate limiting → ✅ **Accept Dev's proposal for v1. No new primitive.**

Confirmed: no general-purpose limiter exists in `lib/`. Building one here is unbudgeted scope with no owner. The two mechanisms Dev names are adequate for the stated concern (accidental client retry loops): the gate cache removes the Stripe cost from a retry loop, and the xact lock makes the destructive path serialise rather than multiply.

**Two conditions.** (a) The workplan must say out loud that the session gate cache is **in-memory and per-instance on Vercel, therefore best-effort and not a limit** — the binding controls are the gate's own budget, page cap and ≤2-retry ceiling, which are per-request and hold regardless of instance. Do not describe the cache as rate limiting in code comments. (b) File a follow-up for a shared limiter with an owner. It is a real gap; it is just not this cycle's gap.

#### DEV-Q6 — snapshot memory ceiling → 🔄 **Split ruling, not Dev's either/or.**

Dev offers "row ceiling → refusal" **or** "exclude the two analytics tables". **Do both, applied to different tables, because the two kinds of table differ in what a snapshot is *for*.**

- **`website_page_views` and `smart_link_clicks`:** capture **ids only**, never full rows. These are unbounded, publicly writable, append-only and forensically worthless row-by-row. A ceiling-refusal here would make a **high-traffic business undeletable**, which is the same broken-product failure as DEV-Q8 and not a safety property. Ids-only is fully compatible with AC-5, which needs the `smart_link_clicks` child **ids**, not their rows.
- **Everything else:** a global row ceiling; exceeding it is a **refusal with a distinct message**, exactly as Dev proposes and consistent with the gate bounds. A truncated snapshot of `crm_contacts` is a false forensic all-clear.

**Ceiling value: set it from measurement, not from this document** — same discipline as DEV-Q8. Instrument T10 against a seeded business, pick a value with ≥4× headroom below the function memory limit, record the measurement in a comment next to the constant, and report the constant in the T28 sweep.

#### DEV-Q7 — retention enforcer vs cron dormancy → 🔄 **Dev's concern is correct and I am ruling harder than Dev asked. T11 is held and re-scoped.**

Dev worried a cron "can sit dormant". I checked the specific host. **`/api/auth/cleanup-incomplete` is not at risk of dormancy — it is dormant right now, provably, and has been for the life of the `CRON_SECRET` gap.** Lines 14–22: `if (!cronSecret) return 500` before any work. With `CRON_SECRET` unset on Vercel (the delegated, still-open task), every daily 02:00 invocation has returned 500 without executing. Hosting a compliance-critical retention job there means **retention never runs, from day one, silently**.

Cron posture across the fleet is not uniform — I checked four: `insight-detect` warns and **runs unprotected** when the secret is absent; `calendar-sync` guards with `if (CRON_SECRET && …)` and therefore also **runs**; `payment-reminders` is **fail-closed**; `run-scheduled-agents` compares against `Bearer undefined` and is **fail-closed**. So "the crons are dormant" is not a blanket truth — but the host Dev chose is in the dormant half.

**Ruling — do not make a compliance property depend on cron liveness at all:**

1. **The customer-path snapshot takes the no-PII branch by default**, whether or not the enforcer ships: counts, row ids, table keys, non-PII columns. §10.7.3 offered this as a fork; the fork resolves this way because the other arm's precondition (a live daily cron) is not available and is not in this cycle's control. It costs almost nothing — FR-12 already states the snapshot is a **forensic artefact, not a restore path**, and counts + ids answer every question a support or dispute case asks.
2. **The internal `/test-business-os` path keeps the full row dump.** It operates on the owner's own test businesses; the PII-retention argument does not apply.
3. **The enforcer still ships as defence-in-depth, but not on `cleanup-incomplete`.** Host it on a cron verified to execute today, or give it its own `vercel.json` entry. Either way **T11's acceptance requires a verified live run with a log line proving objects were considered** — Dev's ask, granted, and now load-bearing for nothing, which is the point.
4. The surface-conditional snapshot means `SnapshotWriter` takes the surface as an input. One extra parameter on one descriptor-driven writer is acceptable. It must **not** become two writers.

#### DEV-Q8 — the 10 s gate budget → 🔄 **Refusal semantics stand. Dev's arithmetic is wrong, in Dev's own favour, and fixing it probably dissolves the problem.**

The "×2 candidates ⇒ up to 8 traversals" premise does not hold. I read `resolveUserConnectAccounts` (`lib/payments/stripeAccountContext.ts:83–124`): it **already deduplicates**, and its own comment says so — *"Deduplicated: the same account in both tables is the healthy case, and listing it twice would make a probe report a false `ambiguous`."* Two *sources*, one *account*, in the healthy case. Two distinct accounts is the `ambiguous` branch, which already emits a `logger.warn` because it is anomalous. **The normal cost is 4 traversals, not 8.** With the mandated `created` windows (14 d on payment intents, ~30 d on refunds) that is 1–2 pages each on any ordinary account.

Second correction in the same direction: **not all three are unfilterable.** `/v1/subscription_schedules` accepts a `scheduled` boolean, and if C1 is implemented against `/v1/subscriptions` that endpoint accepts `status`. Re-check the endpoint actually chosen for C1 before declaring it a full traversal.

**Rulings:**
- **The refusal-never-truncate rule is not negotiable and does not move.**
- **The synchronous-preview shape stands.** With the arithmetic corrected there is no case for an async preview, and introducing one would add a job, a polling surface and a durable half-state — the shape D7 already refused.
- **Granted:** set the final budget from T13's measurement rather than from the requirement. Record it as a named constant with the measured p95 in a comment, capped at **≤ half of `maxDuration`**, so a budget refusal is always reported by our code and never by a platform kill. 20 s with `maxDuration = 60` is pre-approved as a ceiling.
- **Escalation trigger, not a silent raise:** if T13 measures a **clean, single-account** business exceeding 20 s, stop and bring it back to SA. That would be evidence the shape is wrong, and it must not be absorbed by quietly increasing a number.

#### DEV-Q9, DEV-Q10 → ✅ Agreed, no ruling needed. Q9 is now doubly load-bearing given B-1: the QA assertions must use raw unfiltered queries, and `ContactDocumentsRepository` is the concrete reason why. Keep both recorded.

#### DEV-Q11 — the data-export sentence → ✅ **Approved.** `app/api/user/data-export/route.ts` exists and is wired into the same tab. One sentence and a link, zero implementation. Add to T24's copy keys and localise.

#### DEV-Q12 — wording nits → ✅ Accepted, with one correction of Dev's correction: `lib/repositories/` holds **54 `.ts` files**, of which **52 are repository classes** (`index.ts` and `types.ts` are not). The requirement's "54" counted files and was not wrong. Immaterial either way — say "52 repository classes across 54 files" and move on. The seven-cron count and the `lib/stripe/` directory point are both correct (`StripeService.ts`, `StripeInvoiceService.ts`, no shared client, 18 `new Stripe(` files).

---

### 12.3 Claims in the workplan that did not survive verification

Recorded separately so they are corrected in the document rather than carried into code.

| # | Workplan claim | Measured | Action |
|---|---|---|---|
| **V1** | DEV-Q3 ¶3: "touches none of the 60 Business OS tables" | Touches exactly one — `user_preferences`, #60, the `K*` — which DEV-Q3 ¶2 itself says it deletes | Reword; the contradiction weakens an otherwise correct finding |
| **V2** | DEV-Q3 ¶4 reads as "no audit" | Audits **intent** at line 99 and fails closed if that write fails; never audits **outcome** | Reword to "audits intent, never outcome" |
| **V3** | DEV-Q8: "×2 candidates = up to 8 traversals" | `resolveUserConnectAccounts` dedupes; healthy case is **one** account, 4 traversals | Correct the arithmetic — it changes the ruling |
| **V4** | DEV-Q4 proposed copy: "channel stats … within the hour" | `channel_connections.last_synced_at` is `K`, so the connection is not due after a Reset; up to ~20 h | Use the corrected copy in §12.1 |
| **V5** | DEV-Q1: "several repositories apply `.neq('status','deleted')`" | **Three**; one (`ContactDocumentsRepository`) is in the purge set. The stronger fact is **31 of 52** carry `.limit()`/`.range()` | Restate with measured numbers |
| **V6** | §1.2: "52 files (requirement says 54)" | 54 files, 52 classes. Both counts were right about different things | Restate |
| **V7** | §7: "Every one of the 49 ACs has at least one owning task" | **44 of 49** appear in the mapping table. Missing: **AC-16, AC-29, AC-33, AC-41, AC-42** | See §12.5 — a condition, not a nit |

---

### 12.4 Stage 0 sufficiency — and one of my own obligations that I can now close

**Stage 0 is sufficient, and §8.7 is closer to closed than either of us thought.**

I said in the requirement's second pass that `20260629_platform_learning_tables.sql` and `20260629_execution_optimization_tables.sql` have plural names implying unenumerated tables, and made expanding them a Dev obligation. I have now read both:

| Migration | Tables created | `user_id`? | Disposition |
|---|---|---|---|
| `20260629_execution_optimization_tables.sql` | `execution_baselines`, `execution_anomalies` | Yes, both | **Already in §8.7.** Nothing to add |
| `20260629_platform_learning_tables.sql` | `workflow_patterns`, `global_failure_patterns` | **No — neither has a `user_id` column**; both are platform-wide aggregate tables (`pattern_hash`, `popularity`, `affected_users_count` — deliberately non-identifying), and neither carries an RLS policy | **Outside FR-1 route (a)'s enumeration entirely.** A table with no `user_id` is never returned, so it can never trip AC-37's unknown-table check, so it needs no descriptor |

**So T2(c) downgrades from 🔴 "expand from the dump, never invent names" to 🟡 "confirm against T1's dump that no third table appeared live after these migrations".** The static evidence closes it; T1 only confirms. Requirement §11.2 can be marked resolved by BA alongside the other amendments. **This is not permission to skip the confirmation** — it is one grep against the dump.

The other Stage 0 unknowns are correctly sequenced. Two additions:

- **C-1:** T1's dump is a human-pasted artefact in a markdown file. The workplan must state explicitly that **no code ever reads the dump doc** — it is evidence for T3/T4, and `SchemaReconciler` (T7) is the runtime oracle. Otherwise someone will eventually generate a constant from it.
- **C-2:** the FR-1 RPC already returns `pg_constraint`. Have T7 also compare a **fingerprint of the FK set** against the one T3 derived the order from, failing closed in **phase 1** on a mismatch. Without it, a FK added after T3 surfaces as an opaque constraint error inside the phase-2 transaction — safe (it rolls back) but undiagnosable from the user-facing message. Cheap, and it turns a mystery into a sentence.

---

### 12.5 The two items Dev owned, and the AC mapping

#### The signed dry-run token → ✅ **Approved as the mechanism, with seven conditions. It is a new pattern and a new secret; rule 7 applies and is granted.**

The design is right: it discharges FR-21, AC-29, the FR-2/AC-28 session binding and options drift in one stateless mechanism, with no new table and no server-side session store.

I verified there is **no `createHmac` anywhere in `lib/` or `app/` today** — so this is a genuinely new crypto path, not a reuse, and it earns the conditions. What worries me is not the HMAC, it is the **new required environment variable**. This project has a live, month-old demonstration of what that costs: `CRON_SECRET` is unset on Vercel, the task is delegated and still open, and it has left `payment-reminders`, `run-scheduled-agents` and `cleanup-incomplete` dormant. A purge feature whose commit route depends on an unset secret will be "broken" on arrival, and the tempting fix — a fallback — is catastrophic.

**Conditions:**

- **C-6. Prefer a derived key over a new secret.** Derive the HMAC key from an **already-deployed** secret (`SUPABASE_SERVICE_ROLE_KEY`) via HKDF with a fixed, feature-specific `info` string. Same cryptographic property, **zero new deployment dependency**. A discrete `PURGE_TOKEN_SECRET` is acceptable — but then it must appear in T29's env checklist and in the D9 un-gating criteria, and someone must own setting it.
- **C-7. No default, no fallback, fail closed.** A missing or short key ⇒ both routes 500 with a distinct operator-facing message and an `error`-level log. Under no circumstances may an absent key degrade to "token not required". Assert it in a route test.
- **C-8. `crypto.timingSafeEqual`**, never `===`, with a length guard before comparing.
- **C-9. `canonicalJson(options)` must be a deterministic serialiser** (recursively sorted keys, stable number formatting) with its own unit test. Key-order variation between clients would otherwise produce spurious drift rejections that read to the user as "your confirmation expired".
- **C-10. The token is `payload + '.' + signature`**, not the signature alone — the verifier needs `issuedAt` and `gateVersion` in the clear to check TTL and version before it can decide what it is verifying. Make the wire format explicit in `dryRunToken.ts`'s header.
- **C-11. `gateVersion` is a compile-time constant with a comment stating it is bumped whenever gate semantics change**, otherwise it is decoration. Bumping it invalidates outstanding tokens by design.
- **C-12. Never log the token.** Log a short prefix or a hash. It is a bearer credential for a destructive operation.

**One honesty point, not a blocker.** AC-29 says "in the same **session**". A 15-minute HMAC over `userId|level|options|correlationId|gateVersion|issuedAt` binds *user + parameters + time*, not *session* — sign out and back in within the TTL and the token still verifies. The widening is immaterial (same user id, and the gate re-runs on commit anyway), but **state it in the workplan rather than letting the mapping imply a stronger property than the mechanism provides.** No FR amendment needed; AC-29's intent — "no commit without a prior matching dry-run" — is fully satisfied.

#### AC-5's oracle is the snapshot → ✅ **Approved. It is the only possible oracle. Two conditions, because a snapshot oracle has a specific way of lying.**

The parents are gone by assertion time, so nothing else can name the child ids. Correct call.

- **C-13.** The child-id capture must happen **inside the same phase-1 read pass, with the same paginate-to-exhaustion guarantee** as the row dump. A separately coded, silently capped id read would under-capture, and the ids it missed would be exactly the ids AC-5 never checks.
- **C-14.** The AC-5 assertion must **first assert the captured id set is non-empty** — and, in T28, matches a known seeded count. Without that, a bug capturing **zero** ids makes AC-5 pass vacuously, which is the characteristic failure of using an artefact produced by the system under test as that system's own oracle.

#### Is the AC→task mapping honest? → 🔄 **No — and this is a condition, not a nit.**

I machine-checked every AC number against §7. **Five of the 49 do not appear in the mapping table at all:**

| AC | What it requires | Where it actually lives | Why it matters |
|---|---|---|---|
| **AC-16** | Blocked message names count + Stripe-side ids per condition, **including refund ids** | Inside T13's task text only | **A D9 un-gating condition.** An un-gating criterion with no row in the coverage table is exactly the item that gets missed at the gate |
| **AC-29** | Commit rejected without a prior matching dry-run | The token (§2.5) discharges it; §4 claims it; the table omits it | Mechanism exists; the mapping just does not say so |
| **AC-33** | Integrations checkbox ON ⇒ gate still runs, `plugin_connections` read for account resolution **before** deletion | Nowhere, in text or table | **The only genuinely unowned one** — and it is an ordering constraint inside the RPC options handling. Unowned ordering constraints are how B1–B4 happen |
| **AC-41** | Full test flow re-runs after Reset without re-onboarding | T28's task text | Table omission only |
| **AC-42** | Re-seed after Purge yields a new `user_code` | T28's task text | Table omission only |

**C-3:** add all five to §7, give **AC-33 a real owner** (T9 for the ordering — account resolution reads `plugin_connections` in phase 1, the integrations option deletes it in phase 2, and the phase split already guarantees that order, so the work is mostly asserting it — plus T15 or T21 for the test). Then either re-run the check or drop the "every one of the 49" sentence.

**Two lower-priority mapping observations:**
- **AC-25 and AC-27** are mapped to **T27, which produces a document.** A register of cron selection predicates is the *input* to AC-25, not evidence for it. The owning task for both is **T28**; T27 is its prerequisite. Reword so QA does not accept a markdown file as proof.
- **AC-48**'s row lists T6/T15/T21, but the test plan also carries repository tests (T8) and snapshot tests (T10). Add them.

---

### 12.6 FR amendments for BA to apply — exact text

Two rulings force changes to the approved requirement. **Dev must not finalise T9 or T24's copy until these land**, and **BA applies them** — I am not editing the requirement from a workplan review.

**Amendment 1 — FR-28 (§10.8 item 28). Replace in full:**

> 28. **Double submission is a provable no-op.** A second concurrent run returns "already running". Mechanism: **`pg_try_advisory_xact_lock(hashtextextended(p_user_id::text, 0))` taken inside `purge_business_data`**, released automatically at COMMIT or ROLLBACK, with no unlock call that can leak. The pre-existing `pg_try_advisory_lock` wrapper (`supabase/SQL Scripts/20260129_add_advisory_lock_functions.sql`) is **deliberately not used**: it is session-scoped, and `supabase-js` speaks PostgREST over a pooled connection, so it yields both false passes (a concurrent call served by another backend does not observe the lock) and permanent false blocks (a run that dies leaves the lock held on a connection handed to unrelated traffic). No new DDL beyond the purge RPC itself.

**Also amend §12 (Notes on integration points)**, the `20260129_add_advisory_lock_functions.sql` row:

> **Not used by this feature** — session-scoped over a pooled connection, so unsuitable as a double-submit guard (FR-28). Recorded here because it is `SECURITY DEFINER` and granted to **`authenticated`**, letting any logged-in user take or release an arbitrary advisory lock id — a follow-up with an owner, outside this cycle.

**Amendment 2 — FR-26 (§10.8 item 26). Replace in full:**

> 26. **Reset's post-state is not presented as permanent — and the UI must name the right things.** Reset keeps `business_profiles` and `channel_connections`, so **`calendar-sync` repopulates `external_calendar_events` within about five minutes** (it enumerates via `business_profiles`, and the retained `calendar_last_synced_at` is already stale), and **`channel-metrics-sync` repopulates `channel_metrics_daily` on that connection's next scheduled sync — up to ~20 hours**, because `channel_connections.last_synced_at` is retained and a Reset does not make the connection due. **Insights and metrics do not return on a timer:** `insight-detect` enumerates tenants from `payment_invoices` / `scheduling_bookings` / `crm_contacts` / `business_events`, all of which Reset deletes, and `insight-metrics` and `insight-automations` likewise read `D` tables — so they rebuild only once the owner creates new data. The UI must say this and **must not promise insights within 15 minutes**.

**Amendment 3 — AC-26. Replace in full:**

> - [ ] **AC-26** After a **Reset**, the UI states that calendar events resync within minutes, that channel stats refresh on their next scheduled sync, and that insights and metrics rebuild once new data is created. A later cron regenerating any of them is **not** a failure.

**Amendment 4 — §6.3, final paragraph.** The sentence *"**Reset** keeps `business_profiles`, so new `insights` appear within 15 minutes"* is false; replace with FR-26's corrected statement. Note in passing (does not change the requirement) that each of `insight-detect`'s four enumeration selects carries `.limit(500)` with no pagination — a pre-existing tenant-coverage bug worth a follow-up, irrelevant to the purge.

**Amendment 5 — §11.2** may be marked **resolved**: both plural-named migrations are now enumerated (§12.4). T2 confirms against the dump rather than discovering.

---

### 12.7 Things in the plan that will not survive contact with the codebase

Beyond the four blocking questions.

#### 🔴 S1 — the "internal, unflagged" surface is reachable by every logged-in customer. This defeats D9.

`middleware.ts:155–156` puts `/test-plugins-v2` and `/test-business-os` on the **skip-onboarding-check** list. There is **no admin gate** — not in the middleware, not in `app/test-business-os/page.tsx`, which is `'use client'` and gates on `useAuth()` only. The page's own header documents the model: *"this page acts as whoever you are currently logged in as."*

So T22 as planned ships, to production, an **unflagged Reset + Purge button reachable by any signed-in user who knows the URL** — while T24 ships the same capability to the same users behind a flag that is off by default. D9's staged rollout is then a fiction: the flag gates the polished surface while the raw one sits open beside it. I approved "internal surface: unflagged" in the requirement on the assumption that "internal" meant access-restricted. **It does not. That is my error, surfaced now.**

**Ruling — the control must be server-side, on the routes, not on tab visibility.** A `NEXT_PUBLIC_` flag is a rendering hint, never an authorisation boundary. Required:

- The **preview and commit routes** authorise the *Reset* level and the internal-surface behaviours via **`AdminAccessService`** (per CLAUDE.md § Security Rules — `admin_users`, **never** `profiles.role`). Non-admins reaching those routes get 403 regardless of what the client renders.
- The Danger Zone **tab** on `/test-business-os` renders only after that same server check resolves — a fetch, not a client-side guess.
- The customer-surface path (Purge, flag-gated, non-admin) is unchanged.
- **AC-40 extends to:** "with the flag off, the customer surface is unreachable **and no other surface in the application offers Reset or Purge to a non-admin**."

This is a **new task — T30**, a dependency of T19/T20 and T22, and a condition of approval. Whether non-admin internal staff should reach the harness is a product call; whether an unauthenticated authorisation boundary is acceptable is not.

#### 🟡 S2 — the descriptor principle leaks at the storage boundary.

§2.2 states "no table name appears anywhere in the executor", and T6 enforces it — but T17 hardcodes `contact-documents` and `website-images`, and T10 hardcodes `business-purge-snapshots`. A bucket added later is exactly the "silently missed" failure the descriptor set exists to prevent, and storage has no `information_schema` to fail closed against. **Add a `StorageDescriptor[]` to `descriptors.ts`** (bucket, level, path prefix `{user_id}/`, purpose), have `StorageRemover` iterate only that, and extend T6's invariant to cover it. Small change; keeps the principle whole.

#### 🟡 S3 — the shared Stripe client will pin one of two live API versions.

Measured across the tree: **`2025-10-29.clover` and `2024-12-18.acacia` are both in use**, and one site carries `apiVersion: … as any`. A single pin is still right, but pin **`2025-10-29.clover`** (newer, majority) and comment that a second version is live in the tree, so FU-14's eventual migration is not mistaken for a no-op. The gate reads refund and payment-intent shapes; version skew against the payment lifecycle code is the thing to avoid.

#### 🟡 S4 — `resolveUserConnectAccounts` is itself direct Supabase.

`lib/payments/stripeAccountContext.ts` queries `stripe_connect_accounts` and `plugin_connections` directly, outside the repository layer. The gate calls it read-only and **must not reimplement it** (requirement §12 is explicit). Pre-existing, not this cycle's debt — but do not let it become the precedent that widens B-1. Record as a follow-up, and note in code that this single *call* is the sanctioned exception to B-1 and is not an import of a Supabase client.

#### 🟢 S5 — `SecurityTab.tsx` Pino conversion.

Approved; 3 `console.*` confirmed. Dev's own observation is right: all three are error paths that currently surface nowhere the user can see. Converting them to Pino does not fix that — a client component's logger does not reach the user either. **Surface them in the UI as well**, or the conversion is compliance theatre.

#### 🟢 S6 — `cleanup-incomplete` Pino conversion.

10 `console.*` confirmed. Now contingent on the DEV-Q7 re-hosting ruling: if the enforcer moves off that route, do not convert it — see **E1**, which may retire the route entirely.

---

### 12.8 Conditions of approval

| # | Condition | Blocks |
|---|---|---|
| **C-1** | State that no code reads T1's dump doc; `SchemaReconciler` is the runtime oracle | T1 |
| **C-2** | T7 also compares an FK-set fingerprint against T3's, failing closed in phase 1 | T7 |
| **C-3** | Add AC-16, AC-29, AC-33, AC-41, AC-42 to §7; give AC-33 a real owner; re-point AC-25/AC-27 at T28 | before code review |
| **C-4** | B-1…B-4 applied verbatim to `BusinessPurgeRepository`, including the single-Supabase-importer assertion in T6 | T8 |
| **C-5** | The DEV-Q3 `fix/` branch **replaces** the Delete-account button with a support-channel erasure-request block plus the existing data-export link — never an empty Danger Zone | before T24 |
| **C-6…C-12** | Dry-run token: derived key preferred; fail closed on missing key; `timingSafeEqual`; canonical JSON with its own test; `payload.signature` wire format; meaningful `gateVersion`; never logged | T16 |
| **C-13, C-14** | Child ids captured in the same exhaustive phase-1 pass; AC-5 asserts a non-empty, known-count id set | T10, T28 |
| **C-15** | **T30** — server-side `AdminAccessService` authorisation for the internal surface and the Reset level; AC-40 extended | T19, T20, T22 |
| **C-16** | `StorageDescriptor[]` in `descriptors.ts`; `StorageRemover` iterates only it; T6 extended | T4, T17 |
| **C-17** | Customer-path snapshot is no-PII by default; enforcer re-hosted off `cleanup-incomplete`; T11 acceptance requires a verified live run | T10, T11 |
| **C-18** | Gate budget and snapshot ceiling set from measurement, recorded as named constants with the measurement in a comment; budget ≤ ½ `maxDuration`; >20 s on a clean single-account business escalates to SA | T13, T10 |
| **C-19** | Apply the V1–V7 corrections and the §12.6 FR amendments before code review | before code review |

---

### 12.9 Escalations — above SA

#### 🔴 E1 — `/api/auth/cleanup-incomplete` is a dormant mass-account-deletion hazard that the pending `CRON_SECRET` change will arm. Unrelated to this cycle; should not wait for it.

Found while verifying T11's host. The facts, each measured:

1. The cron iterates `auth.admin.listUsers()` and, for every user older than 24 h whose **`user_metadata.onboarding_completed`** is not `true`, calls **`auth.admin.deleteUser(user.id)`** (lines 67–96).
2. `user_metadata.onboarding_completed` is **not the authoritative completion signal**. `middleware.ts` says so in a comment: *"We ONLY check `business_profiles` table, NOT `user_metadata`. This ensures all users go through onboarding, even if they completed an older version of it."* `lib/utils/onboarding-check.ts` treats the metadata flag as **legacy backward-compatibility only**.
3. The **live** onboarding path (`/onboarding-chat` → `POST /api/onboarding/build`) writes `business_profiles.onboarding_completed = true` and **does not write the metadata flag**. Only the superseded `components/onboarding/hooks/useOnboarding.ts` flow did. `markLegacyOnboardingComplete()` exists in `onboarding-check.ts` and **has zero callers anywhere in the tree**.
4. Therefore **every business onboarded through the current flow is a deletion candidate** for this cron.
5. It is not deleting them today for exactly two reasons, neither of them a designed safeguard: **`CRON_SECRET` is unset**, so the route 500s at line 17 before doing anything; and `auth.admin.listUsers()` is unpaginated, so it only ever inspects the first page.
6. **Setting `CRON_SECRET` on Vercel — the delegated, still-open task needed to un-dormant the payment queue drains — arms this cron.** After that, the only thing between a fully-onboarded customer and account deletion is the `business_profiles → auth.users` FK having no `ON DELETE` clause, so the delete errors out. **A data-integrity constraint is currently the last line of defence against mass account deletion.**

This is the **third** live deletion hazard this cycle has surfaced, after `delete_user_by_id.sql` (removed, PR #39) and `/api/user/delete-account` (DEV-Q3). The pattern is worth naming: this codebase has accumulated several destructive paths nobody inventoried, and this feature's entire premise is that deletion must be gated, scoped, snapshotted and audited.

**Recommendation:** a separate, immediate `fix/` branch **sequenced before anyone sets `CRON_SECRET`**, and a direct warning to the owner of that Vercel task that setting the secret has a side effect outside their feature. The minimum safe change is to switch the predicate to `business_profiles.onboarding_completed`; the better change is to delete the cron, since its stated purpose — garbage-collecting abandoned signups — is served far better by a query against the authoritative table. **Engineering/ops — except that running *any* automated account deletion is a product call and should be put to the owner explicitly.**

#### 🟠 E2 — removing the customer-facing "Delete account" affordance is a product/compliance call, not an architecture one.

SA's position is in DEV-Q3: remove it, replace it with a support-channel erasure-request block (C-5), and accept a window in which deletion is request-based rather than self-service. My reasoning — that Art. 17 requires erasure on request rather than a button, and that the current route's mid-flight 500 leaves *more* unaccounted residue than no route at all — is stated for the record and is not legal advice. **The owner should confirm (a) that a request-based erasure path during the D9 window is acceptable, and (b) that the support address named in the replacement copy actually reaches someone.**

#### 🟠 E3 — who may reach the internal Danger Zone (S1) is a product call; the missing authorisation boundary is not.

SA rules the boundary must be server-side and `AdminAccessService`-backed (C-15). Whether non-admin internal staff should also have Reset is for the owner.

#### 🟡 E4 — if Dev chooses a discrete `PURGE_TOKEN_SECRET` over a derived key (C-6), it is a new Vercel env dependency with the same shape and the same owner problem as `CRON_SECRET`.

Someone must own setting it before the D9 flag is turned on. Engineering/ops.

---

### Approval

- [x] **Workplan approved with conditions.** Implementation may begin immediately on Stage 0 (T1–T3), Stage 1 (T4–T7), Stage 3 (T12–T15) and Stage 4.
- [x] **T8 unblocked** by the DEV-Q1 ruling, subject to B-1…B-4.
- [x] **T9 unblocked** by the DEV-Q2 ruling; BA applies the FR-28 amendment (§12.6) in parallel, not after.
- [ ] **T11 held** pending C-17 (re-host + no-PII customer branch).
- [ ] **T22 held** pending C-15 (T30 — server-side admin authorisation).
- [ ] **T24 held** pending the DEV-Q3 `fix/` branch landing with C-5, and the FR-26/AC-26 amendments.
- [ ] **E1 escalated to TL and the owner — independent of this cycle, and ahead of the `CRON_SECRET` change.**

**The second SA pass is the code review.** There I will walk the `new-api-route` and `new-repository` skill checklists against the diff, re-run the AC-mapping machine check, and verify C-1…C-19 individually.

---

## 12A. SA Review Notes — second pass (rev 2)

**Reviewed by SA — 2026-09-15 (workplan rev 2)**
**Status:** ✅ **Cleared for implementation.** Two new conditions (**C-20, C-21**), one sequencing ruling, one escalation I am pressing harder than the user's decision currently allows for. Nothing blocks a start.

Rev 2 applied all eight rulings, C-1…C-19, B-1…B-4 and all seven V1–V7 corrections. I re-verified rather than accepted: **§12 is byte-for-byte intact**, the requirement amendments landed as specified, and **Dev corrected me twice more — both times correctly.** That is now eight factual corrections in this cycle, four of them against the corrector's own interest.

---

### 12A.1 Verification results

| Claim under review | How I checked | Result |
|---|---|---|
| **49/49 AC coverage, no gaps, no duplicates, every row owned** | Parsed §7's AC table programmatically: extracted all `AC-n` tokens, checked the set against 1…49, checked for duplicates and out-of-range, and asserted every AC cell has a `T`-number or `lint` beside it | ✅ **49 refs, 0 missing, 0 duplicates, 0 out of range, 0 rows without an owner.** Dev's claim holds exactly. The rev-1 gap (AC-16, 29, 33, 41, 42) is closed, AC-33 has a real owner (T9 ordering + T15/T21 test), AC-25/AC-27 are re-pointed from T27's document to T28's live proof, AC-48 gained T8 and T10 |
| All 31 FRs referenced | Counted the FR rows in §7 against §10.8's numbered list in the requirement | ✅ 31 FRs in the requirement, all 31 in the mapping, plus 3 NFR rows |
| **§12 preserved verbatim** | Byte-compared the §12 block against my original | ✅ **Identical.** Not paraphrased, not trimmed |
| Requirement amendments applied | Read FR-26, FR-28, AC-26, AC-40, §6.3, D11, D12, §1.3, §8.7 | ✅ All five §12.6 amendments landed with my exact text. **§6.3 is better than I specified** — BA rebuilt it as a table with an explicit **enumeration-source column**, which makes the class of error that produced the false FR-26 claim structurally hard to repeat. Counts hold at 31 FRs / 49 ACs |
| **`AdminAccessService` API exists as T30 assumes** | Read `lib/services/AdminAccessService.ts` | ✅ `isAdmin(user)` at :98 and **`isAdminById(userId)` at :137**, singleton export, backed by `AdminUserRepository` / `admin_users`. T30's reference is correct, and correctly avoids `profiles.role` |
| **T31 has no upstream code dependencies** | Read the task and §5.3 | ✅ Depends only on RM creating the `fix/` branch. It can land before Stage 0 finishes — and it should |
| **T30 has no upstream dependencies** | Read the task | ✅ True — **but see 12A.2, the "runs parallel to the critical path" framing needs one correction** |
| V1–V7 corrections | Read §1.2 | ✅ All seven applied, and applied honestly — §1.2 says outright *"My DEV-Q8 arithmetic was wrong in my own favour"* rather than quietly restating the number |
| §8.7 closure, T2(c) downgrade | Read T2 and §9.2 | ✅ Recorded with the reasoning (no `user_id` ⇒ outside FR-1's enumeration ⇒ no descriptor needed), and correctly kept as a confirmation step rather than dropped |

**Dev corrected SA twice in rev 2. Both stand:**

1. **`middleware.ts:117–118`, not 155–156.** I cited the wrong lines for the `/test-business-os` skip-list entry in §12.7 S1. Verified: the skip list ends at 117–118. The *finding* is unaffected — there is still no admin gate — but the citation was mine and it was wrong. Corrected here rather than silently in §12, which stays as written.
2. **A third Stripe API-version state exists that S3 did not name.** Verified: `lib/payments/RefundService.ts:904` is `new Stripe(process.env.STRIPE_SECRET_KEY!)` with no options object at all. See 12A.3 — where I have to correct Dev's correction in turn.

---

### 12A.2 Ruling: option (a) + the `410 Gone` shim + the flag-off window

#### Option (a) with the shim → ✅ **Approved. Dev's rebuttal is correct and my objection does not survive it.**

My rev-1 objection was that (a) "leaves the collision live whenever the flag is off". Dev is right that this assumed (a) meant *keep the old route and add a new one alongside it*. **T31 removes the implementation on day one, independent of the flag**, so at every flag state there is exactly one button and it never reaches the old code. The objection was aimed at a version of (a) Dev is not proposing.

**The `410 Gone` deviation is not a deviation I am tolerating — it is the part of the plan I most agree with.** Keeping the name `delete-account` on an operation that provably does not delete the account is precisely the defect class that produced this cycle's three deletion hazards. Reusing the *button* (the customer-facing affordance, where customers already look) while retiring the *endpoint* honestly is the right split, and it is a better answer than either of the options I framed.

**Dev also improved on my own C-5.** I specified "replace the button with a support-channel erasure block". Dev keeps the button and moves export + the erasure-request channel *inside the dialog*. That is better: the affordance stays where customers expect it, and what changes is copy rather than furniture. C-5 is satisfied in spirit and improved in substance.

#### New condition **C-21 — what the shim must actually be**

A tombstone that still holds the weapon is not a tombstone. The T31 shim must:

- **Import nothing that could delete anything.** No `createClient`, no `SUPABASE_SERVICE_ROLE_KEY` reference, no `auth.admin` import, no Supabase client of any kind. The deletion logic is deleted, not commented out, not moved to a helper. A shim that still imports the service-role client is one revert away from re-arming.
- **Carry a mechanised assertion**, in the same shape as T6's B-1 scan: a test that the route returns **410** and that the file contains no `auth.admin`, `createClient` or `SERVICE_ROLE` token. This is cheap and it is the only thing that stops a future "restore the old behaviour behind a flag".
- **Return the standard error shape** naming `/api/business-os/purge/*` as the replacement, with no internals leaked and no `error.message` passthrough — the existing route's `NODE_ENV`-unguarded leak must not be inherited by its own headstone.
- **Remove `handleDeleteAccount` from `SecurityTab.tsx` in the same change.** If the client handler survives and the route returns 410, the flag-off state shows an error toast instead of the export/erasure dialog — i.e. the exact "broken delete" outcome T31 exists to end. This is the coupling most likely to be missed because the two edits are on different branches.

#### The flag-off window → ✅ **Acceptable and bounded — but one correction to how much the sequencing lever actually buys.**

Dev offers to "re-order T31 + T24 ahead of the internal surface" to shorten the window. **Take the ordering, but do not expect the window to move much, and here is why.**

T24 depends on T19 + T20 + T23 + T31. T19/T20 depend on T16, which sits deep in the critical path (T1 → T3 → T4 → T9 → T16). So re-ordering T24 relative to T22 changes only which of those two comes *first among themselves* — it cannot pull T24 earlier in absolute time, because its real constraint is T16.

**The only part that can genuinely land early is T31, and T31 is the part that matters.** It removes a live data-destroying bug reachable by customers today. Every day it is unshipped is exposure that has nothing to do with the flag.

**Ruling:**
- **T31 lands first, as early as RM can cut the branch — before Stage 0 finishes, not after it.** This is not a sequencing preference; it is the removal of a live defect and it should be treated as its own priority.
- **Yes, order T24 ahead of T22.** T22 is the internal surface, now correctly gated behind T30, so it is the more contained of the two. Costs nothing, and neither is on the critical path.
- **But say plainly in the plan that this does not materially shorten the flag-off window** — T16 does. Do not let the re-ordering read as the mitigation. **T31's landing date is the mitigation.**

#### N4 — un-gating at cycle exit → ✅ **No architectural objection. It is the owner's call, and the criteria are genuinely satisfiable.**

I wrote D9's un-gating checklist (AC-2, 5, 10, 13, 16, 24, 37), so I am the right person to say whether T28 discharges it: **it does.** T28 demonstrates all seven on a real seeded account, inside this cycle. That was not true when D9 was written — at that point the checklist was a future gate with no scheduled demonstration.

So: **if T28 passes all seven on a real account, SA has no objection to flipping `NEXT_PUBLIC_ENABLE_BUSINESS_DELETE` at cycle exit.** Whether to flip it is a **product call** for the owner — I am confirming the gate is met, not deciding to open it. Two things I would want in the same breath: N2 (the erasure-request channel reaches a real person) closed, and T28's measured budget and ceiling constants (C-18) reported, since both feed the customer-facing failure modes.

---

### 12A.3 Ruling: `RefundService.ts:904` — right finding, wrong magnitude, wrong mechanism

Dev's finding is real and I missed it. But I machine-checked it before ruling, and **it is worse than Dev describes in two ways.**

**Magnitude — it is not one site.** Parsing every `new Stripe(` construction in `lib/` and `app/` and checking whether an `apiVersion` appears in the options object:

> **27 construction sites total. 12 of them are unpinned, across 6 files:**
> `lib/business-os/bizql/mutate/MutateExecutor.ts:1114` · `lib/payments/RefundService.ts:904` · `app/api/payments/plans/[id]/cancel/route.ts:80` · **`app/api/payments/refunds/route.ts:486`** · **`app/api/stripe/webhook/route.ts:1088, 1213, 1230, 1421, 1579, 1597, 1787`** · `app/api/website/booking/finalize/route.ts:199`

The two bolded ones are the problem for *this feature*: the **refund-creation route** and the **webhook that settles refunds and payments** are both unpinned. Those are exactly the objects C2 gates on.

**Mechanism — Dev says it inherits "whatever the SDK pins". It does not.** In `stripe-node` (this repo is on `stripe@^19.2.1`), omitting `apiVersion` means requests are served under the **Stripe account's default API version — a dashboard setting outside this repository.** The SDK's own pin governs the *TypeScript types* only. So the runtime behaviour of those 12 sites is controlled by a setting nobody in this repo can see, and it changes silently the moment someone clicks "upgrade" in the Stripe dashboard. **That is strictly worse than a mispinned client**, because a mispin is at least visible in a diff.

**Does this change T12?** **No.** One shared client, one instantiation, pinned `2025-10-29.clover` — unchanged and still correct. The gate reads the provider as the authority (§10.5.2), so reading under a known pin is right regardless of what the writers used. Two things change around it:

- **T12's comment must record three states and the true counts** — `2025-10-29.clover`, `2024-12-18.acacia`, and **12 unpinned sites in 6 files whose effective version is a Stripe dashboard setting**. Not "RefundService:904".
- **FU-14 gains a priority order:** the 12 unpinned sites before the acacia ones, and `app/api/stripe/webhook/route.ts` (7 of the 12) first. An unpinned client in a webhook handler is the highest-value fix in that follow-up.

#### New condition **C-20 — the gate's refund vocabulary must be borrowed, not invented**

This is the part that is load-bearing for correctness rather than hygiene. Requirement §12 already says the gate's conditions *"must agree \[with the existing lifecycle vocabularies\], not invent parallels."* The unpinned writers make that concrete and testable:

- **C2's refund predicate takes its status vocabulary from the existing lifecycle source** — `lib/payments/RefundService.ts` and `20260828b_payment_refund_ledger.sql` — rather than from a fresh reading of the Stripe docs. If the reconciler considers a refund live, the gate must too.
- **T15 pins the exact status strings in a test**, so a version-driven or refactor-driven divergence fails a test instead of silently passing a business through the gate.
- Record in `PreflightGate.ts` that refunds are **created** under an unpinned client and **read** under a pinned one, and that the pinned read is deliberate because the provider is authoritative.

**Why this matters more than it looks:** a gate that disagrees with the reconciler about what "in flight" means produces a **false all-clear** — the single worst failure mode this feature has, and the one the entire fail-closed design exists to prevent. Everything else in the gate fails toward refusal; only a vocabulary mismatch fails toward deletion.

---

### 12A.4 Ruling: withholding the `cleanup-incomplete` Pino conversion

✅ **I agree with Dev, and Dev handled the reversal correctly by surfacing it instead of dropping it silently.**

The CLAUDE.md rule fires on files you **touch**. C-17 moved the retention enforcer off that route, so Dev no longer touches it, and the rule no longer applies. Converting the logging of a route that may be retired outright under E1 is the compliance theatre S5 warns about — and it would be worse than theatre here, because a tidy, well-logged version of a mass-deletion hazard reads as *maintained* to the next person who opens it.

**Two conditions:**
- **The 10 `console.*` must appear in T32's summary to Offir**, so the conversion obligation transfers with the decision rather than evaporating.
- The user approved this conversion, so the user has the final word. **I am endorsing Dev's recommendation, not overriding the user** — and Dev flagging it explicitly rather than quietly skipping it is exactly the behaviour the standard is trying to produce.

`SecurityTab.tsx` was converted as approved, with S5's "surface them in the UI too" applied. ✅

---

### 12A.5 E1 / N1 — I accept the user's decision, and I want one thing inside it

The user ruled **note it, don't act on it this cycle**. That is a product call about an automated account-deletion mechanism, it is the user's to make, and **I accept it.** T32's contents (§11.3) are accurate and complete — I checked all eight points against the code, including the one Dev added that I had not made explicit: **setting `CRON_SECRET` arms all eleven crons in `vercel.json` at once**, not just this one. That is a better framing of the blast radius than mine.

**Where I am still uncomfortable, stated once and then left with the owner.** The safety of the current state rests entirely on an **ordering assumption**: that the summary reaches Offir before anyone sets `CRON_SECRET`. Nothing enforces that ordering except a task scheduled for *after* this cycle ends. Offir does not know the constraint exists and could reasonably set the secret next week for the payment queue-drains — the very task it was delegated for.

**My ask is not "act on it". It is: decouple the notification from the decision.**

- **Send T32's summary now**, not at cycle exit. Sending a written summary changes no code, spins up no fix, and does not pre-empt any decision. It converts an ordering assumption into a delivered fact.
- **Keep the decision deferred exactly as the user ruled.** What to do about the cron — fix the predicate to `business_profiles.onboarding_completed`, retire it, or something else — still comes after the summary and still belongs to the owner.

Deferring the *decision* is a judgement call I have no standing to override. Deferring the *warning* is the only part that carries risk, and it costs nothing to remove. **Product call; my recommendation is to send it this week.**

If the answer is still "at cycle exit", then I would ask for the one-line version now: *"don't set `CRON_SECRET` until we've talked — it arms eleven crons, one of which deletes accounts."* That is not acting on it either.

---

### 12A.6 Conditions carried into code review

| # | Condition | Owner |
|---|---|---|
| **C-20** | C2's refund predicate borrows its status vocabulary from `RefundService` / the refund-ledger migration; T15 pins the exact strings; `PreflightGate` records the unpinned-writer / pinned-reader asymmetry | T13, T15 |
| **C-21** | The T31 `410` shim imports no Supabase client, `auth.admin` or service-role key; carries a mechanised no-deletion-primitives assertion; returns the standard error shape with no `error.message` passthrough; and `handleDeleteAccount` is removed from `SecurityTab.tsx` in the same change | T31 |
| **S-1** | T31 lands first, before Stage 0 finishes. T24 ordered ahead of T22. State in the plan that **T16, not the re-ordering, governs the flag-off window** | sequencing |
| **S-2** | T30 is scheduled early despite living in Stage 5. It has no upstream dependencies but is a **hard prerequisite of T19 and T20**, and T20 is on the critical path — so it is off the critical path only for as long as it finishes before T16 does. "Runs parallel to the critical path" is true of its *dependencies*, not of its *dependents* | T30 |
| **C-18 report** | T28 reports the measured gate budget and snapshot ceiling constants; they feed N4's un-gating decision | T28 |

All of C-1…C-19 remain in force and will be verified individually at code review.

---

### Approval — second pass

- [x] **Cleared for implementation.** No held rulings remain with SA. T11, T22 and T24 stay held on their own stated conditions (C-17, T30, T31 + the amendments), all of which are now inside Dev's control.
- [x] **Option (a) + the `410 Gone` shim approved**, with C-21.
- [x] **Flag-off window accepted as bounded**, with the sequencing correction in S-1.
- [x] **N4 has no architectural objection** — the D9 checklist is genuinely satisfiable inside this cycle. The decision to flip the flag is the owner's.
- [x] **The `cleanup-incomplete` Pino withholding is endorsed**, subject to the user's final word.
- [ ] **One thing pressed back to the owner:** send T32's summary now rather than at cycle exit (12A.5). Product call.

**Next SA involvement is the code review**, where I will walk the `new-api-route` and `new-repository` skill checklists against the diff, re-run the AC-mapping check, and verify C-1…C-21 individually.

---

## 12B. SA Code Review — T31 / T30 / T5 (first code review of this cycle)

**Reviewed by SA — 2026-09-15**
**Status:** 🔄 **Changes required — one blocking finding (CR-1).** Everything else in this diff is good work; the tombstone, the authz module and the shared panel are all well-reasoned and I would approve them as they stand. The blocker is not something Dev did wrong in the code written — it is **a fifth Danger Zone, live in production, that the C-21 verification method was structurally incapable of finding.**

**Net diff: 212 insertions, 594 deletions.** A code review where the feature branch is 382 lines lighter and four duplicated destructive affordances became one shared non-destructive one is the right shape for this task.

---

### 12B.1 🔴 CR-1 (blocking) — there is a fifth Danger Zone, it is live, and it deletes data client-side

**`components/settings/SecurityTab.tsx:234` → rendered at `/settings` via `app/(protected)/settings/page.tsx:22`.**

This is a **live, authenticated, customer-reachable** Danger Zone that was not in the four-caller set, was not rewired, and was not examined. It never called `/api/user/delete-account` — which is exactly why a grep for the tombstoned route path could not find it. It does its deletes **in the browser**:

```ts
await Promise.all([
  supabase.from('profiles').delete().eq('id', user.id),
  supabase.from('user_preferences').delete().eq('user_id', user.id),
  supabase.from('notification_settings').delete().eq('user_id', user.id),
  supabase.from('plugin_connections').delete().eq('user_id', user.id)
])

setErrorMessage('Account deletion initiated. Please check your email within 24 hours to complete the process.')
```

Every clause of that is a defect:

| # | Defect | Why it matters here |
|---|---|---|
| 1 | Deletes **`profiles`** | D3 and FR-30 say `profiles` is never deleted, at any level, under any option |
| 2 | Deletes **`user_preferences`** | Table #60, `K*` — the one table this feature guarantees survives **both** levels |
| 3 | Deletes **`plugin_connections`** | An opt-in table in this feature, **off by default**. Here it goes unconditionally |
| 4 | **"Please check your email within 24 hours to complete the process."** | **No email is sent. There is no process.** This is the only thing the user is told |
| 5 | `Promise.all` with **no result inspection** | `supabase-js` does not throw on an RLS denial — it resolves with `{ error }`. Nothing reads it, and `catch` never fires. **If RLS blocks the deletes the user sees the success message and nothing happened; if RLS permits them, four tables go and the user is told to wait for an email.** Both outcomes are lies, in opposite directions |
| 6 | Direct `supabase.from()` from a `'use client'` component | Mandatory rule 1 — and the repository strategy explicitly forbids repositories in client components, which is the other half of the same rule |
| 7 | 6 × `console.*` | Rule 3 |

**This is the fourth live deletion path surfaced in this cycle**, after `delete_user_by_id.sql` (removed, PR #39), `/api/user/delete-account` (retired by this very diff), and `/api/auth/cleanup-incomplete` (E1, deferred to T32).

#### Why the verification method missed it — and my share of that

Dev verified C-21 by grepping for callers of the tombstoned route, found none, and reported the error-toast outcome impossible at any flag state. **That claim is true and I re-verified it: no caller of `/api/user/delete-account` remains anywhere in `app/`, `components/` or `lib/`.** It is also the wrong question.

The oracle for "is the Danger Zone coherent?" is **every delete affordance in the product**, not **every caller of the route we just killed**. A surface that reached the same outcome by a different mechanism is invisible to a route-path grep — and that is precisely the surface that existed.

**My C-21 wording contributed to this.** I wrote *"`handleDeleteAccount` is removed from `SecurityTab.tsx` in the same change"* — singular, definite article, one file named. There are **three** files called `SecurityTab*.tsx` in this repo and I knew that when I wrote it. A condition that names one file when three exist invites exactly the search Dev ran. Corrected below as C-27.

#### What CR-1 requires

- **`components/settings/SecurityTab.tsx`'s Danger Zone is rewired to `DangerZonePanel` / `ErasureRequestContent`**, the same as the other two live surfaces. `handleDeleteAccount` is deleted, not neutered.
- That file is now a touched file, so **rule 3 applies: its 6 `console.*` convert to Pino** in the same change.
- It joins the T31 `fix/` branch. It is a live data-loss path; it should not wait for the feature.
- **Re-run the C-21 check with the right oracle** (C-27): enumerate every component containing a delete affordance, not every caller of the retired route.

---

### 12B.2 🟠 CR-2 — two of the "four callers rewired" are dead code

Traced every settings component to its importer:

| Component | Imported by | Status |
|---|---|---|
| `components/settings/SecurityTab.tsx` | `app/(protected)/settings/page.tsx:22` | 🔴 **LIVE — missed. CR-1** |
| `components/settings/ProfileTab.tsx` | `app/(protected)/settings/page.tsx:20` | ✅ Live, no delete affordance — nothing to do |
| `components/v2/settings/SecurityTabV2.tsx` | `app/v2/settings/page.tsx:16` | ✅ Live, rewired |
| `components/v2/settings/ProfileTabV2.tsx` | `app/v2/settings/page.tsx:15` | ✅ Live, no delete affordance |
| `app/business-os/settings/page.tsx` | (is a page) | ✅ Live, rewired |
| `components/business-os/settings/SecurityTab.tsx` | **nobody** | ⚫ Dead — Dev knows (N12) |
| `components/business-os/settings/ProfileTab.tsx` | **nobody** | ⚫ **Dead — and I do not think Dev knows.** The hand-off names it `components/v2/settings/ProfileTab.tsx`, **which does not exist** (the v2 file is `ProfileTabV2.tsx`) |

So the four rewired callers are **2 live + 2 dead**, with **1 live one missed**. Not harmful in itself — the dead ones were made consistent, which is fine — but "four callers rewired" reads as coverage it does not have. Restate it as "two live surfaces rewired, two dead files made consistent pending deletion, one live surface missed (CR-1)".

⚠️ **Deletion trap for N12:** `components/business-os/settings/index.ts` re-exports `ProfileTab`. Deleting the file without removing that barrel line breaks the build — and the barrel is also why a path-import grep alone reads ambiguously on that file.

---

### 12B.3 Verified good — the parts I would approve unchanged

| Check | Result |
|---|---|
| **Tombstone holds no deletion primitive** | ✅ Imports are exactly `next/server` and `@/lib/logger`. No `createClient`, no `@supabase/*`, no `auth.admin`, no `SERVICE_ROLE`, not even unused |
| **Error shape, no `error.message` passthrough** | ✅ Body is exactly `{ success, error, replacement }` — asserted key-for-key in the test, which is better than asserting the absence of a leak |
| **410 on every verb** | ✅ POST / DELETE / GET. The reasoning for 410-over-404 and for leaving it unauthenticated is correct and written down |
| **The C-21 assertion is genuinely mechanised, in the T6 style** | ✅ **This is the best thing in the diff.** It is a *source scan*, not a behavioural test, with the reasoning stated: a behavioural test proves the current path is inert, whereas the failure mode is someone restoring the implementation behind a flag. It strips comments first so the file's own documentation of the removed behaviour doesn't match itself — a detail that is easy to get wrong and would have produced a permanently red test |
| **T30 fails closed** | ✅ `authorizePurge` denies on no actor (401) and on any non-admin (403); `AdminAccessService.isAdmin` catches and returns `false` on any error |
| **`isAdmin({id,email})` vs `isAdminById`** | ✅ **Dev is right and corrected me.** Read `AdminAccessService.ts:98–137`: `isAdminById` checks only `cache.userIds`, skipping both the email-matched DB row (with its self-heal binding) and the `ADMIN_EMAILS` env fallback. An admin seeded by email whose row is not yet bound would be denied — and on a fail-closed path that false negative is indistinguishable from correct behaviour. My §12A verified the method *exists*; Dev verified it was *suitable*. That is the better check |
| **Pino across every touched file** | ✅ 0 `console.*` in all eight |
| **`types.ts` strict** | ✅ No `any`. Discriminated unions on `PurgeScope`, `PurgeAuthzDecision`, `GateResult`; `PurgeSnapshotMode: 'rows' \| 'ids'` correctly encodes the DEV-Q6 ruling in the type system rather than in a comment |
| **Locale keys** | ✅ en / es / he all added, all four keys, no gaps |

**On `PLACEHOLDER_ERASURE_CONTACT`:** deliberately implausible, greppable, `.invalid` TLD, with the reasoning written down — *"a real-looking address that nobody reads would be strictly worse than an obviously fake one"*. That is the right instinct and it is the same argument I made about a named channel nobody reads. See C-25.

---

### 12B.4 Ruling on F-8 — the shared component across provider boundaries

✅ **Dev's shape is right. Do not give `app/v2/**` a `LanguageProvider` as the fix for this.**

**On `useOptionalLanguage()` + leaving `useLanguage()` throwing:** correct, and for the reason Dev gives. A throwing hook is a contract — *"this subtree must be inside a provider"* — and it is the only thing that makes a missing provider a build-time-visible failure rather than a silent English regression. Relaxing it globally to serve one shared component would trade a loud error in one place for a silent fallback in ten thousand lines of translations that nobody would notice until a customer did. The additive, opt-in escape hatch is the proportionate change.

**On `tr()` treating `t(key) === key` as a miss:** necessary, and a good catch. `t()` returning the key on a miss means any locale lacking the new keys would render `settings.security.erasure_request_title` to a customer, inside a Danger Zone. "Worst case is English" is the right floor.

**On whether `/v2` should just get a provider:** no — **wrong blast radius for the problem**. Wrapping `app/v2/layout.tsx` in `LanguageProvider` would put every `/v2` surface under a context it has never had, affecting `dir`/RTL handling and every component currently rendering English unconditionally. That is a broad behavioural change to a major surface, arriving as a side effect of a Danger Zone panel, with no test coverage of the surfaces it would change. Record **"give `/v2` a LanguageProvider"** as a follow-up with its own scope and its own testing, and keep this cycle's change local.

**One addition — C-26.** `FALLBACK_COPY` is required to stay byte-identical to the `en` block, and that requirement is currently enforced by a comment saying *"If you change one, change both."* That is precisely the drift the comment predicts. Make it a test: export `translations` (one word; it is already the single source of truth, and exporting it for a test introduces no new pattern) and assert every `FALLBACK_COPY` key equals its `en` counterpart. Low priority, but it is cheap and it is the difference between a convention and an invariant.

---

### 12B.5 Ruling on N11 — `data_decision_requests`

✅ **`optional:agents`. Dev's reasoning is correct, and the deciding argument is precedent, not novelty.**

The table is keyed to `agent_id` / `execution_id`, both of which are already inside the "delete my agents" checkbox, and `decision_context` / `user_decision` hold the substance the decision was about. Retaining it after that checkbox runs leaves rows pointing at deleted agents — **the exact defect that put `agent_prompt_threads`, `agent_prompt_workflow_generation_sessions` and `user_memory` into that checkbox in §3.16.** Ruling it `never` would re-create, in a new table, the inconsistency §3.16 was written to remove. `optional:agents` is the only classification consistent with the decisions already taken.

#### Consequence for T3 — yes, the dump must look for it explicitly

Add `data_decision_requests` to T3's **named** checks alongside B1–B4, because no migration in the repo creates it and its FKs are therefore unknown until the `pg_constraint` dump. Three specific instructions:

1. **If `agent_id` references `agents(id)` with `RESTRICT` or `NO ACTION`, the agents option gains a new blocker in the B1–B4 class** — call it **B5: `data_decision_requests` before `agents`** — and it must be added to the descriptor order and to the AC-19–21 trap family.
2. **The trap is that this blocker is unreachable by default.** The agents checkbox is **off**, so a default T28 sweep would never exercise it and would report green. **T28 must run the agents-option path explicitly** (AC-34 exists; make sure it runs *after* T3 has confirmed the FK, not before).
3. **If T1's dump finds the table absent**, still write the descriptor as `optional:agents` — a descriptor matching nothing is harmless, whereas a missing one fails the run closed — and mark AC-34's assertion contingent, the same shape as AC-3's intake half.

---

### 12B.6 Ruling on N12 — the dead files

✅ **Delete them, in the T31 `fix/` branch. Dev's own reasoning decides it, and this review just supplied the second data point.**

*"A dead file still describing the retired flow is precisely how F-1 fooled both of us"* — and we have now had a second, more expensive instance of the same class **in this very review** (CR-1 is its inverse: a live file mistaken for absent). Two instances in one cycle is enough.

- **Delete `components/business-os/settings/SecurityTab.tsx` and `components/business-os/settings/ProfileTab.tsx`.**
- **Remove the `ProfileTab` re-export from `components/business-os/settings/index.ts`** in the same commit, or the build breaks.
- **Do not delete `components/settings/SecurityTab.tsx`** — that one is live and gets CR-1 treatment instead. The name similarity is exactly why this must be stated explicitly.
- Dev's Pino conversion of `components/business-os/settings/ProfileTab.tsx` is about to be deleted. That is fine and not wasted judgement — the rule fired on touch and Dev followed it. It is, however, a small piece of evidence for deleting rather than maintaining dead files.

---

### 12B.7 Pino, and F-12

**Pino — ✅ agree, no disagreement to flag.** `SecurityTabV2.tsx` (4) and `ProfileTab.tsx` (4) were newly touched this round, so mandatory rule 3 fired on them independently of the user's earlier approval, which covered a different file set. Converting them was required, not optional. Every file Dev has touched is at 0 `console.*` — verified across all eight.

**F-12 — I could not confirm it by running the compiler, and I am saying so rather than asserting.** `npx tsc --noEmit` **OOMs on this repo** (V8 heap exhaustion at ~4 GB after ~290 s). That is a pre-existing environment/config condition, not attributable to this diff. What I can say:

- The error is reported in `ProfileTab.tsx` and outside every hunk of Dev's diff, so it is **not attributable to this cycle**.
- **Disposition follows N12.** If it is in `components/business-os/settings/ProfileTab.tsx` — the dead one — **do not fix it; delete the file**, and F-12 resolves itself. If it is in `components/settings/ProfileTab.tsx` (live, no delete affordance, nothing to do with this feature), **track it as a follow-up; do not fix it here.** Either way it does not block.
- Separately worth a follow-up: a typecheck that cannot run without exhausting a 4 GB heap is not a working quality gate, and `next.config.js` already ignores type errors at build. That combination means nothing is checking types on this repo today. Not this cycle's problem; name it in T29.

---

### 12B.8 New conditions

| # | Condition | Blocks |
|---|---|---|
| **C-22** | 🔴 **The D9 flag must be enforced server-side.** `authorizePurge` rule 4 lets any authenticated user Purge from the customer surface with **no flag check**. `NEXT_PUBLIC_ENABLE_BUSINESS_DELETE` is compiled into the client bundle and the routes are callable directly — so **with the flag off, a non-admin can still purge their own business by calling the route**, which contradicts AC-40's first clause and re-creates the S1 failure on the other surface. Put the check **inside `authorizePurge`**, not in the route handlers, so T19/T20 cannot forget it | T19, T20 |
| **C-23** | `surface` must be derived **server-side** (route-per-surface, or a server constant), never read from the request body. Today it only ever *narrows* permission so it is not an escalation vector — but the moment any capability keys on `surface === 'internal'`, a body-supplied value becomes one. Cheap now, awkward later | T19, T20 |
| **C-24** | Strengthen the tombstone test with an **import allow-list** assertion — the file imports exactly `next/server` and `@/lib/logger` — so a deletion primitive reached through a local helper cannot pass a token-list scan | T31 |
| **C-25** | `PLACEHOLDER_ERASURE_CONTACT` is now the **only** erasure affordance customers have during the flag-off window. Add an assertion that the placeholder is absent, so it cannot ship. **The address itself is the user's to supply (N2).** | T31, pre-merge |
| **C-26** | Make the `FALLBACK_COPY` ↔ `en` equality a test rather than a comment | T31 |
| **C-27** | **Re-run the C-21 verification with the correct oracle**: enumerate **every component containing a delete affordance**, not every caller of the retired route. My original C-21 wording named one `SecurityTab.tsx` when three exist; this supersedes it | T31 |

C-1…C-21 remain in force.

---

### 12B.9 Escalations

🔴 **CR-1 is a live customer-facing data-loss path with a false success message, and it should be told to the user as such.** `/settings` is a protected route reachable by every signed-in customer today. The message *"Account deletion initiated. Please check your email within 24 hours"* is not true, and depending on RLS the user either loses four tables or loses nothing — with the same confirmation either way. **It should be fixed in the T31 `fix/` branch, not held behind the feature.**

🔴 **The count in T32's summary changes from three to four.** §11.3 and the Change History both say "three live deletion hazards surfaced in one cycle". It is now **four**: `delete_user_by_id.sql`, `/api/user/delete-account`, `/api/auth/cleanup-incomplete`, and `components/settings/SecurityTab.tsx`. That is worth the user hearing plainly — **the pattern is not three legacy mistakes, it is a systemic absence of any inventory of destructive paths**, which is the premise this feature was written on and is now the fourth confirmation of it. Update §11.3 and §11.1.

🟠 **C-25 / N2 — the erasure address is still `TODO-ERASURE-CONTACT@example.invalid`.** During the flag-off window it is the *only* thing a customer who wants deletion can act on. **Product call, user-owned, blocking for merge.**

🟠 **C-22 is an architecture finding, not a product one**, but it has a product consequence worth stating: without it, D9's "flag off" does not mean "unreachable", and the un-gating decision (N4) would be about *visibility* rather than *capability*.

---

### Approval — code review 1

- [ ] ❌ **Not approved for QA.** CR-1 must be fixed first.
- [x] The tombstone (T31 route + tests), `purgeAuthz.ts` (T30) and `types.ts` (T5) are **approved as written** — no changes required to the code in this diff.
- [x] **N11 ruled:** `optional:agents`, with B5 named for T3 and the default-off trap named for T28.
- [x] **N12 ruled:** delete both dead files in the T31 branch, with the barrel line.
- [x] **F-8 ruled:** Dev's shape approved; `/v2` does not get a provider this cycle.
- [x] **Pino conversions endorsed.** **F-12 not attributable to this cycle**; disposition follows N12.

**Re-review scope when CR-1 lands:** the `components/settings/SecurityTab.tsx` rewire, its Pino conversion, the two deletions plus the barrel line, and C-24/C-26's assertions. Small.

---

## 12C. SA Review — T3 / the live schema dump, CR-1 verification, N15–N17

**Reviewed by SA — 2026-09-15**
**Status:** ✅ **CR-1 verified fixed. T9's contract accepted with one correction. N15 ruled (FR-1 amends). One new blocker found (B7). One critical out-of-scope security finding escalated (E5).**

This is the strongest artefact produced in this cycle. The dump doc measures rather than asserts throughout, records a **negative result** (B5) because I asked for it, and corrects its own earlier numbers (117 → 110) without being prompted. Two things need correcting, and one of them matters.

---

### 12C.1 The T9 delete-order contract — ✅ accepted, with a correction to the filter

**The core reasoning is right and I accept it.** Only `RESTRICT` and `NO ACTION` edges constrain a delete; `CASCADE` and `SET NULL` cannot block one. Sorting the blocking subgraph instead of all 239 FKs is correct, and Dev's robustness argument is the better half of it: **a newly added `CASCADE` FK cannot invalidate an order derived only from blocking edges**, whereas a total order over 239 edges would need re-deriving on every schema change.

**I verified the acyclicity claim rather than accepting it.** Over the nine edges, `credit_transactions` is the only node appearing as both parent (#2, #4, #9) and child (#5 → `token_usage`), and `token_usage` is never a child. No cycle. ✅ The arithmetic also reconciles: 144 CASCADE + 35 NO ACTION + 2 RESTRICT + 58 SET NULL = 239. ✅ And the five-of-nine billing claim holds. ✅

#### 🔴 But the filter is wrong, and it hides a tenth blocker

Dev selected *"the nine blocking edges **among the 110 user-scoped base tables**."* **The correct filter is "every blocking edge whose PARENT is in the delete set" — irrespective of whether the CHILD is user-scoped.** A non-user-scoped child holding a `NO ACTION` FK to a purge-set parent blocks the delete exactly as hard, and by construction it can never appear in a list filtered to user-scoped tables.

I extracted all 37 blocking edges from §9.8. Twenty-three point at `users` and are inert (D3 keeps `auth.users`). Of the remaining fourteen, nine are Dev's. **Five are not**, and four of those five are genuinely inert:

| Edge | Disposition |
|---|---|
| `credit_transactions → boost_packs` | Inert — parent is a global catalog, child is `never` |
| `credit_transactions → reward_config` | Inert — same |
| `profiles → organizations` | Inert — both `never` |
| `workflow_approval_responses → workflow_approval_requests` | Inert — both outside the purge set |
| 🔴 **`agent_scheduler_state → agent_executions`** (`NO ACTION`) | **NOT inert. This is a new blocker.** |

**B7 — `agent_scheduler_state` before `agent_executions`.** Verified against §9.7: `agent_executions` **is** among the 110 and **is** inside the "delete my agents" opt-in. `agent_scheduler_state` is **not** among the 110 — it has no tenancy column — which is precisely why the user-scoped filter could not see it. Tick the agents checkbox and the RPC's delete of `agent_executions` raises a foreign-key violation, the transaction rolls back, and the purge refuses. Fail-closed, so no data loss — but the agents option is simply broken, and **off by default, so a default T28 sweep reports green**.

**This is the third instance of the same trap in this cycle** (N11's original premise, B6, now B7), and the second instance of the *same blind-spot shape as N15*: a predicate that enumerates by tenancy cannot see something that has no tenancy column.

**Required:**

1. **B7 joins the order.** `agent_scheduler_state` gets a descriptor scoped `{ kind: 'via', parent: 'agent_executions', fk: <execution fk> }` at `optional:agents` — the grammar already supports this; it is how `website_blocks`, `smart_link_clicks` and `user_capability_blocks` work. Confirm the FK column name from the dump; do not invent it.
2. **T3 re-runs its blocking-edge extraction with the corrected filter** — parent-in-delete-set, not child-is-user-scoped — and reports the result even if it is "no further edges". The five I classified above are my read of §9.8; Dev should confirm them against the live dump rather than inherit my classification.
3. **C-2's FK fingerprint covers the blocking subgraph specifically**, so a blocking edge added later fails in phase 1 with a sentence rather than inside the phase-2 transaction as an opaque constraint error.
4. **The ordering-completeness check is not the tenancy predicate and must not be folded into it.** It is answerable directly from `pg_constraint` — "which blocking edges point at a table I am about to delete" — and it is independent of how tenancy is detected. Keep them as two separate checks in T7.

**Everything else about the contract stands: nine (now eleven — nine + B6 already counted, plus B7) constraints plus `crm_activities`-last.**

---

### 12C.2 N15 — FR-1's predicate → ✅ **Take the union. BA amends the requirement.**

**Ruling: adopt Dev's union — `column_name IN ('user_id','owner_user_id')` OR any FK referencing `auth.users`.**

Dev's reasoning is the right reasoning and I will not restate it, except for the part that decides it: **the alternative fixes the instance and not the class.** `organizations` happens to be correctly excluded already — by a human writing prose in §8.4, which is exactly the mechanism FR-1 exists to replace. AC-37 promises a *mechanical* fail-closed guarantee; a predicate that can only see one column name delivers that guarantee over an arbitrary subset and gives no signal about the rest. Eight extra `never` descriptors with a one-line reason each is a trivial price for converting "we believe nothing else is tenant-scoped" into a check.

I also value that Dev **measured the blast radius before recommending** — ten candidate column names across all 155 base tables, with the eight attribution columns named individually. That is what made this rulable in one pass.

**Two bounds on the ruling:**

- **The union does not close the class, and the requirement must not claim it does.** B7 is the proof: `agent_scheduler_state` has no tenancy column *and* no FK to `auth.users`, so the union would not find it either. Tables owned only through a parent are a real category — `website_blocks`, `smart_link_clicks`, `user_capability_blocks` and now `agent_scheduler_state`. FR-1's amended text must say plainly that the predicate covers **directly-tenanted** tables, and that **parent-scoped children are covered by the descriptor set and by the blocking-edge check (12C.1), not by this predicate.** Otherwise we have replaced one silent gap with a better-documented one.
- **The eight attribution-only `never` descriptors each carry their column name in the reason** (`updated_by`, `changed_by`, `acknowledged_by`, `imported_by_user_id`), so a future reader can tell "excluded because attribution" from "excluded because someone decided so".

**Who amends: BA, in the requirement.** This changes FR-1's normative text and AC-37's scope, and the single-source-of-truth rule says the requirement is where FR text lives. A predicate change that rides in a workplan is invisible to anyone reading the requirement afterwards — which is the failure mode that produced FR-26 and FR-28.

**Amendment 6 — FR-1, for BA to apply.** Append to FR-1:

> The enumeration predicate is the **union** of (a) a tenancy column by name — `user_id` or `owner_user_id` — and (b) any foreign key referencing `auth.users`. Either half alone leaves a silent gap: a name allow-list misses a future `tenant_id`, and an FK test misses the many tenancy columns in this schema that carry no constraint. The union costs eight `never` descriptors for attribution-only tables (`updated_by`, `changed_by`, `acknowledged_by`, `imported_by_user_id`), each of which must state that column in its reason.
>
> **Scope limit, stated so it is not over-read:** this predicate enumerates **directly-tenanted** tables. Tables owned only through a parent — `website_blocks`, `smart_link_clicks`, `user_capability_blocks`, `agent_scheduler_state` — carry neither a tenancy column nor an `auth.users` FK and are **invisible to it by construction**. They are covered by their `via` descriptors and by the blocking-edge check in FR-15, never by FR-1. AC-37's fail-closed guarantee is therefore over directly-tenanted tables only.

**AC-37** gains the same scope limit sentence.

---

### 12C.3 N16 / B6 → ✅ confirmed, and the QA gate is granted — now covering three blockers, not one

`agent_logs → agents`, `NO ACTION`, both inside the off-by-default agents opt-in. Confirmed in §9.8.

**Yes — write it as a hard QA gate, not a note.** And it is now **three independent reasons**, not two:

| # | Reason the agents path must be exercised | Source |
|---|---|---|
| 1 | **B6** — `agent_logs` before `agents` | this dump |
| 2 | **B7** — `agent_scheduler_state` before `agent_executions` | 12C.1, new |
| 3 | **N11** — `data_decision_requests` orphan-row correctness (no ordering constraint; B5 confirmed absent) | §12B |

**New gate, C-28:** *T28 does not pass unless the sweep is run twice — once with all three opt-ins off, and once with **Also delete my agents** on. AC-34's assertions are only meaningful in the second run. A single default-configuration sweep is not a pass and QA must refuse to record it as one.*

The reason this needs to be a gate rather than a note is structural: **every defect in this family is invisible in the default configuration**, so the cheapest test path is also the one that reports green. That is the shape of a trap, and the only reliable defence is to make the expensive path mandatory.

I would extend the same logic one step: the other two opt-ins (`integrations`, `activityHistory`) have had no equivalent blocking-edge analysis. **T3's corrected extraction (12C.1 item 2) must cover all three option sets**, not just agents — `plugin_connections` and `audit_trail` have the same "parent in delete set, child possibly not user-scoped" exposure and nobody has looked.

---

### 12C.4 N17 — policies → **route it out. Its own tracked item, not this cycle.**

**Ruling: out of scope for this cycle; raise it as a standalone security item with a named owner, ahead of the other follow-ups.**

Three reasons it does not belong here:

1. **Dev is right that this is a signal, not a finding.** A permissive `WITH CHECK (true)` policy is necessary but not sufficient — PostgREST also needs a table-level `GRANT`, which this dump does not capture. Acting on an unproven vulnerability inside a purge cycle would mean changing RLS policies on nine tables with no evidence of exploitability and no test of what breaks. **I want to record that Dev stated the limit instead of overclaiming.** A finding described as "three endpoints are publicly writable" would have been more dramatic and less true, and it would have been acted on.
2. **It is not a deletion path.** This cycle's scope creep has been disciplined precisely because everything absorbed so far *was* one.
3. **The fix is a grants check first**, which is a ten-minute query — but it is a query against a live database that is currently the user's bottleneck (N10's migration took a whole cycle step). Queueing it behind purge work would delay both.

**What travels with it, so it is not lost:** the three policies whose *name* asserts service-role scope while the role list is `public` (`agent_memories`, `execution_insights`, `pilot_step_routing_history`) and the one granted to `anon` (`workflow_step_executions`). **A policy whose name contradicts its role list is the specific thing to chase** — it survives review because reviewers read the name.

**One thing does stay in this cycle**, and it is small: `agent_memories` is inside the agents opt-in, and `smart_link_clicks` / `website_page_views` are already known re-population paths under FR-14/AC-27. **AC-27's assertion extends to `agent_memories`** — after a Purge with the agents option on, a public insert must not create an attributable row. That is one extra assertion in T28's agents run (C-28's second pass), not new work.

**The two tables marked "unclassified until §8 reconciliation"** (`execution_insights`, `pilot_step_routing_history`) must be classified by T4 regardless — they are in the 110, so AC-37 fails the run closed until they have descriptors. That is the design working; just don't let the N17 routing decision be read as deferring their classification.

---

### 12C.5 CR-1 — verified fixed, and I ran my own oracle rather than trusting the second sweep

You asked me not to take the second sweep on trust. I didn't.

| Check | Result |
|---|---|
| `components/settings/SecurityTab.tsx` no longer deletes | ✅ `handleDeleteAccount` gone (comment at :239 records the removal); renders `<DangerZonePanel />` at :456; **0 `console.*`** |
| All live surfaces render the shared panel | ✅ `components/settings/SecurityTab.tsx`, `components/v2/settings/SecurityTabV2.tsx:283`, `app/business-os/settings/page.tsx:905` (`ErasureRequestContent` inside its dialog, as designed) |
| N12 deletions | ✅ Both dead files deleted, **and the `ProfileTab` line removed from `components/business-os/settings/index.ts`** — the trap I flagged was avoided |
| Panel now has its own test | ✅ `components/business-os/purge/__tests__/DangerZonePanel.test.ts` |

**My independent oracle, run four ways** rather than by route-path: (a) every `.delete()` in `components/**` and `app/**/*.tsx`; (b) every `auth.admin.deleteUser` anywhere in the tree; (c) every "Danger Zone" string; (d) every `/api/admin/**` route lacking an admin guard.

**(a) and (c) came back clean.** The only remaining client-side `.delete()` is `app/(protected)/agents/[id]/delete/page.tsx` — deleting one agent, normal product functionality. Every "Danger Zone" string is accounted for. **There is no sixth in-product Danger Zone.** Dev's C-27 sweep was correct within the oracle I specified.

**(b) and (d) found something else entirely — see E5.** That is not a failure of Dev's sweep: I specified C-27 as "every component containing a delete affordance", and this is an API route with no UI. The oracle was too narrow, and that is mine.

---

### 12C.6 🔴 E5 — ESCALATION: 41 admin API routes have no authorisation, and one of them deletes any user account

Found by oracle (d). **This is not this feature's work and I am not folding it in.** It is reported here because this feature's own inventory discipline surfaced it and it should not be lost.

**`POST /api/admin/users/[id]/terminate`** (`app/api/admin/users/[id]/terminate/route.ts`):

- **No authentication of any kind.** No `getUser()`. No admin check. No `AdminAccessService`. No `profiles.role` check either — nothing. It is "admin" by directory name only.
- **Module-scope service-role client** (lines 5–8).
- **`auth.admin.deleteUser(params.id)`** at line 22 — hard-deletes an arbitrary `auth.users` row **from a caller-supplied path parameter**. That is the M1 cross-tenant vector the `tenant-isolation-guard` skill exists to prevent, at its maximum: not "write to another tenant's row" but "delete any account on the platform".
- Leaks `deleteError.message` and `error.message` to the client with no `NODE_ENV` guard; 5 × `console.*`; no Zod.
- **Reachable.** `middleware.ts:83` skips all `/api` paths, and the middleware only performs onboarding redirects in any case — it is not an authorisation layer.

**It is not an isolated route.** Scanning `app/api/admin/**` for any of `AdminAccessService` / `adminAccessService` / `requireAdmin` / `isAdmin`: **41 routes have no admin check, and 38 of those also never call `getUser()`.** Spot-checked three to avoid overclaiming from a grep — `app/api/admin/users` (service-role read of the `profiles` table), `app/api/admin/user-emails` (bulk email lookup by id), `app/api/admin/audit-trail` (which carries the literal comment `// TODO: Add admin role check here`). All three confirmed to have no guard of any kind.

So the exposure is a platform-wide unauthenticated admin surface covering user PII, audit trail, system configuration, pricing and token usage — with account termination as its most destructive member.

**Recommendation, split by urgency:**

1. **`/api/admin/users/[id]/terminate` should be dealt with now**, in the T31 `fix/` branch or one beside it. It is a deletion path, it is unauthenticated, and this cycle's entire premise is that destructive paths must be inventoried and gated. Retiring it to a `410` tombstone is the cheapest correct action — the same treatment, the same reasoning, and there is no evidence any UI depends on it (that should be confirmed first).
2. **The other 40 are a separate security workstream with its own owner.** They are not deletion paths and folding them in would be the scope creep I have been refusing all cycle. But they should not be recorded only in a workplan section.
3. **This is the fifth live deletion path this cycle** — `delete_user_by_id.sql`, `/api/user/delete-account`, `/api/auth/cleanup-incomplete`, `components/settings/SecurityTab.tsx`, and now `/api/admin/users/[id]/terminate`. **The pattern is no longer "legacy mistakes"; it is the absence of any inventory of destructive or privileged paths.** T32's count moves from four to five, and I would put the admin-authz finding in front of the user in the same breath, because it is materially larger than the cron.

**Which parts are product calls:** whether to retire `/terminate` outright versus guard it (product — someone may rely on it); who owns the admin-authz workstream and when (product/resourcing). **That every one of these routes needs an authorisation boundary is not a product call.**

---

### 12C.7 Smaller confirmations

| Item | SA |
|---|---|
| **B5 absent** | ✅ Recorded as a negative result exactly as asked. This is the right habit — an unrecorded negative gets re-investigated by the next person |
| **B4 mechanism corrected** | ✅ Accepted. The FK is `SET NULL` and does not block; the constraint is entirely the `BEFORE DELETE` trigger tripping B2. My §12 and the requirement both described B4 as though the FK participated. The corrected mechanism is what T3's order must encode |
| **T5 single-path narrowing** | ✅ Confirmed from live definitions, including the `status` vs `payment_status` distinction that makes `log_booking_activity_trigger` unreachable. My first-pass correction of BA holds. `crm_activities`-last remains correct and sufficient |
| **Duplicate `crm_contacts` triggers** | ✅ Both present, both `BEFORE UPDATE`, inert for a delete-only purge. §5.2's prediction confirmed |
| **Inventory 117 → 110** | ✅ Accepted, and the important half is the negative: **zero base tables were missing from Part 1**, so it was a strict superset and no classification work is invalidated. `agent_stats` and `agent_intensity_metrics` need descriptors |
| **27 tables with no DELETE policy** (vs "~20") | ✅ Live confirmation that the service role is structurally required. **B-4's RLS-bypass comment must cite 27 and this list**, not the estimate |

---

### 12C.8 Conditions added

| # | Condition | Blocks |
|---|---|---|
| **C-28** | **T28 runs twice — opt-ins off, then "Also delete my agents" on.** A single default-configuration sweep is not a pass; QA must refuse to record it as one. Three defects (B6, B7, N11) are invisible in the default configuration | T28 |
| **C-29** | T3 re-extracts blocking edges with the corrected filter — **parent in the delete set**, regardless of whether the child is user-scoped — across **all three opt-in sets**, and reports the result even if empty | T3, T4, T9 |
| **C-30** | `agent_scheduler_state` gets a `via`-scoped `optional:agents` descriptor (**B7**); FK column name taken from the dump, never invented | T4, T9 |
| **C-31** | C-2's FK fingerprint covers the **blocking subgraph** specifically, and T7 keeps the ordering-completeness check **separate** from the tenancy predicate — they answer different questions | T7 |
| **C-32** | AC-27's public-insert assertion extends to `agent_memories`, asserted in C-28's second (agents-on) run | T28 |

---

### Approval — T3 / dump review

- [x] **T9's delete-order contract accepted**, corrected to eleven constraints (nine + B6 + **B7**) plus `crm_activities`-last.
- [x] **N15 ruled: take the union. BA amends FR-1 and AC-37** with the scope limit in 12C.2.
- [x] **N16 / B6 confirmed; the QA gate is granted as C-28**, now covering three reasons.
- [x] **N17 routed out** as its own security item with a named owner; `agent_memories`' in-scope consequence stays as C-32.
- [x] **CR-1 verified fixed** by independent oracle; no sixth in-product Danger Zone exists.
- [ ] **E5 escalated** — unauthenticated admin surface; `/terminate` recommended for immediate retirement, the other 40 routed to a separate workstream.
- [ ] **N6** — T31's `fix/` branch still needs the user's approval before RM cuts it.

---

## 12D. SA Rulings — the D9 flag, and tombstone vs. deletion

**Reviewed by SA — 2026-09-15** · Both raised by the user on the 22-file working-tree diff.
**Status:** ✅ **Both ruled.** Ruling 1 keeps the server check but fixes how it reads the flag — **including a defect neither the user nor Dev named**. Ruling 2 takes the coordinator's proposal: **delete the routes, replace both tombstone tests with one repo-wide guard**, under six design conditions.

---

### 12D.1 Ruling 1 — the D9 flag

#### Can `featureFlags.ts` be imported from server code? **Yes today — and it still must not be the dependency of an authorisation boundary.**

Measured: `lib/utils/featureFlags.ts` has **no `'use client'` directive**, and `lib/logger/client.ts` is a three-line re-export of `clientLogger` from the main Pino logger, which is server-safe. So the import would work.

**But it has never had to work.** Grepping `app/api/**` and `lib/**` for importers of `@/lib/utils/featureFlags`: **zero server importers exist.** Every consumer today is a React component. The module's contract is "helpers for client rendering", and nothing enforces that it stays server-safe — one `'use client'` directive, one `window` reference, one browser-only import added by someone with no reason to think about `authorizePurge`, and the authorisation boundary breaks at build time or, worse, at runtime.

**That is too fragile a dependency for a security check, regardless of whether it happens to work today.** Dev's instinct to avoid it was right; the implementation of that instinct is what needs fixing.

#### The shape — one parser, two callers, no logger under the boundary

1. **Extract `parseBooleanFlag` into a server-safe module with zero imports** — `lib/utils/parseBooleanFlag.ts`. No logger, no React, nothing. `featureFlags.ts` imports it; `purgeAuthz.ts` imports it. This resolves deviation **(c)** properly: `=1`, `=TRUE`, `= true ` all behave, with an explicit default, in both readings — and the two readings cannot drift, because there is one parser.
2. **Register `useBusinessDeleteSurface()` in `featureFlags.ts`**, delegating to the shared parser and appearing in `getFeatureFlags()`. This resolves **(a)**. It is a **rendering hint** and nothing else.
3. **`isBusinessDeleteSurfaceEnabled()` in `purgeAuthz.ts` remains the authoritative read**, delegating to the same parser. The C-22 reasoning is unchanged: a `NEXT_PUBLIC_` flag evaluated on the client is a rendering hint, not a boundary. Moving this check into the client helper would reopen on the customer surface exactly what T30 closed on the internal one.
4. **Document it** — Available Flags table, numbered Flag Details section, `.env.local` example. Resolves **(b)**, which is the deviation that would actually have bitten: an undeployed flag is an un-un-gateable feature.

#### 🔴 A defect neither the user nor Dev named: the env read is a *computed* lookup

`purgeAuthz.ts:79` is:

```ts
return process.env[BUSINESS_DELETE_FLAG] === 'true';
```

**`process.env[someVariable]` is a computed property access, and Next.js only statically inlines *literal* `process.env.NEXT_PUBLIC_FOO` accesses.** In the Node.js runtime this happens to work, because `process.env` is the real environment object — so the code is not broken today. But it is exempt from Next's build-time substitution, and it returns `undefined` under the Edge runtime, where `process.env` is a build-time-populated object rather than the live environment.

The failure direction is **gated** — fail-closed, and therefore safe. But it presents as *"we set the flag and the surface still isn't there, with no signal why"*, which is the user's deviation **(c)** arriving through a second door. Two doors to the same silent-stays-gated outcome is one too many.

**Required: read the literal.** Keep the exported `BUSINESS_DELETE_FLAG` constant as the canonical *name* for the docs and the tests, but have the function evaluate `process.env.NEXT_PUBLIC_ENABLE_BUSINESS_DELETE` directly, with a comment saying why a literal is mandatory. It reads as duplication; it is not.

#### Naming — **keep `NEXT_PUBLIC_ENABLE_BUSINESS_DELETE`**. Premise (d) does not hold.

The observation was reasonable but the measurement disagrees. Scanning `featureFlags.ts` and `docs/feature_flags.md` for every `NEXT_PUBLIC_*` flag:

> `NEXT_PUBLIC_USE_AI_DATA_LAYER` · `NEXT_PUBLIC_USE_NEW_AGENT_CREATION_UI` · `NEXT_PUBLIC_USE_THREAD_BASED_AGENT_CREATION` · `NEXT_PUBLIC_USE_V6_*` · **`NEXT_PUBLIC_SHOW_CALIBRATION_BUTTON`** · **`NEXT_PUBLIC_MOVE_TO_CALIBRATION_AFTER_AGENT_CREATION`**

**Two existing flags already do not use `USE_`.** The convention is `NEXT_PUBLIC_<verb>_<thing>`, not `NEXT_PUBLIC_USE_*`, so `ENABLE_` is inside the convention rather than a deviation from it.

It is also the more accurate verb. Every `USE_*` flag here selects **which implementation runs** — V6 versus the older pipeline, thread-based versus classic creation. This flag does something categorically different: it **exposes a destructive capability to customers**. `SHOW_`/`MOVE_TO_`/`ENABLE_` are the exposure verbs and this is an exposure flag. And it is already written into the approved requirement (D9), AC-40 and three SA review sections — renaming ripples through an approved requirement for a cosmetic that measurement says isn't even a convention.

#### The documentation requirement — **granted, and made stronger than asked**

The coordinator's reasoning is exactly right and is the reason this needs to be binding: *listed like every other flag, the next person tidies the check onto the client for consistency and silently reopens it.* A deviation that isn't recorded as deliberate gets undone by someone being helpful.

**C-33 (binding), three parts:**

- **`docs/feature_flags.md`** — the Flag Details entry carries a `⚠️ This flag is not like the others` block: the client hook is a **rendering hint**; the authoritative check is `authorizePurge()` server-side; moving or duplicating the gate onto the client reopens the hole T30/C-22 closed. Name `authorizePurge` so the reader can find it.
- **`featureFlags.ts`** — `useBusinessDeleteSurface()`'s JSDoc says the same in two lines and points at `purgeAuthz.ts`. The warning has to be where the tidying would happen, not only in a doc nobody opens first.
- **A test, not just prose.** T21 asserts that a **non-admin customer-surface request is refused while the flag is off**. A comment is a request; a failing test is a boundary. This is the part that actually survives a tidy-up, and it is one assertion.

---

### 12D.2 Ruling 2 — **delete the routes. Take the repo-wide guard.**

✅ **The coordinator's proposal is accepted, and the user's pushback is correct.**

The deciding argument is the coordinator's, and it is my own reasoning turned against my C-21 and C-24: **a per-file assertion protects a path that already exists.** The fifth deletion path — `components/settings/SecurityTab.tsx` — was found precisely *because* it was outside the oracle I had specified, and a guard scoped to files we already know about is structurally incapable of finding the sixth. A repo-wide oracle covers paths that do not exist yet. That is strictly stronger, and it is the difference between testing an instance and testing the class — the same distinction I used to rule N15.

The user is also right on the narrow point: **410 vs 404 is cosmetic here.** A stale browser bundle POSTing `/api/user/delete-account` fails safely either way, and nothing deletes in either case. I over-valued the signal-to-stale-clients argument when I approved the tombstone; two routes that exist to do nothing, plus ~115 lines of test that only ever guard those two paths, is not a good trade.

**So: delete `app/api/user/delete-account/route.ts`, delete `app/api/admin/users/[id]/terminate/route.ts`, delete both `__tests__/` directories, and add one guard.**

#### C-34 — how the guard must be built (six conditions, and the first is the important one)

**Dev's own finding that the tombstone's comment-stripper failed open is the warning that governs this whole design.** A scan-based guard has exactly one catastrophic failure mode: it passes because it found nothing to look at.

| # | Condition |
|---|---|
| **a** | 🔴 **It must fail closed.** Assert a **floor on the number of files scanned** before asserting anything about their contents. A bad glob, a moved directory or a renamed root must turn the suite **red**, never green. "Scanned 0 files, found 0 violations" is the exact shape of the comment-stripper defect, one level up |
| **b** | **Allow-list, never deny-list.** Legitimate sites are named by exact path; anything else matching the pattern fails. `app/api/auth/cleanup-incomplete/route.ts` is allow-listed **with an inline comment naming E1 and T32**, so the one live exception is visible in the guard rather than absent from it. When E1 is decided, the allow-list entry is what tells the next person the decision is owed |
| **c** | **Three assertion families:** (1) no `auth.admin.deleteUser` / `admin.deleteUser` outside the allow-list; (2) no `.delete()` against identity tables — `profiles`, `auth.users`, `user_preferences`, `notification_settings`, `plugin_connections` — from any file carrying `'use client'` (the CR-1 shape); (3) no `.from('<identity table>').delete()` under `app/api/**` outside `lib/business-os/purge/**` and `lib/repositories/**` |
| **d** | **Strip comments before matching — and unit-test the stripper**, proving it removes block and line comments. A primitive appearing inside a **string literal** must still count as a hit: when in doubt the guard fails, because a false positive costs a conversation and a false negative costs an account |
| **e** | **Location: `lib/business-os/purge/__tests__/no-deletion-paths.guard.test.ts`** — beside T6's descriptor invariant. Same structural character, and the rule belongs to the feature whose entire premise it encodes. Not a repo-root test that nobody owns |
| **f** | **The "why" must outlive the files.** Deleting a tombstone deletes its documentation, and that record is worth more than the route was |

#### C-35 — what must be preserved before the files are deleted

Move into the workplan's findings section (beside F-1…F-18) and into T32's summary:

**`/api/user/delete-account`** — deleted `auth.users` (D3/FR-30 forbid); deleted `user_preferences`, table #60, the `K*` this feature guarantees survives both levels; audited **intent but never outcome**; **500'd at phase 6 for every onboarded user** because 16 `REFERENCES auth.users` declarations carry no `ON DELETE`, after phases 1–5 had already run irreversibly; returned `error.message` unguarded by `NODE_ENV`; wrote `role: 'deleted'` into the user-writable `profiles.role`.

**`/api/admin/users/[id]/terminate`** — hard-deleted an arbitrary `auth.users` row **from a caller-supplied path parameter with no authentication of any kind**, on a module-scope service-role client, reachable because `middleware.ts:83` skips all of `/api`; leaked `deleteError.message` unguarded; and **wrote an audit row attributing the deletion to its own victim** (`user_id: userId`, `terminated_by: 'admin'` as a literal string — no actor id anywhere). I verified that last detail in the source rather than repeating it: the only identity in the audit trail of a termination was the terminated user's.

That last one is worth keeping verbatim somewhere permanent. It is the cleanest example in this codebase of an audit record that looks like accountability and contains none.

#### Credit where it is due

Dev removed the terminate button and its modal from `app/admin/users/page.tsx` and **scoped the claim correctly** in the comment: *"NOT a security fix for this page. This whole admin surface is unauthenticated… Removing one deletion affordance narrows that gap's blast radius; it does not close it."* That is the right sentence. The temptation to describe removing one button as fixing the problem is exactly what turns a tracked workstream into a forgotten one.

---

### 12D.3 🔴 E5 escalation — amplified by the P0 already on record

E5 said: 41 `/api/admin/**` routes with no admin check, 38 with no authentication at all, all on a module-scope **service-role** client.

The project memory now also records: **the repository is PUBLIC and the live Supabase `service_role` key has been committed since 2025-10-30.**

**These two compound, and the order of remediation changes because of it.** If the service-role key is public, the 38 unauthenticated routes are not the primary exposure — anyone holding that key already has unrestricted database access directly, bypassing the routes entirely. Fixing the routes while the key is published would be securing the doors of a building whose walls are gone.

**Sequencing, stated plainly:**

1. **Rotate the `service_role` key first.** Nothing else in this list matters until that is done.
2. **Then** the admin-authz workstream (the 40 remaining routes).
3. **`/terminate` is already handled** — the route is being deleted and the UI affordance is gone.

This is not this cycle's work and I am not folding it in. It is recorded here because this feature's inventory discipline surfaced the routes, and because the two findings are more severe together than either is alone — which is the kind of thing that gets missed when each lives in its own tracker. **Product/ops call, and urgent.**

---

### 12D.4 Conditions added

| # | Condition | Blocks |
|---|---|---|
| **C-33** | Flag: extract `parseBooleanFlag` to a zero-import server-safe module; register `useBusinessDeleteSurface()` as a **rendering hint**; `isBusinessDeleteSurfaceEnabled()` stays authoritative and **reads a literal `process.env.NEXT_PUBLIC_…`**; keep the `ENABLE_` name; document the deviation in **both** `feature_flags.md` and the JSDoc; **and assert it in a T21 test** | T30, T19, T20, T21 |
| **C-34** | Delete both route files and both `__tests__/` dirs; add one repo-wide deletion-path guard under the six design conditions — **fail-closed file-count floor first** | T31 |
| **C-35** | Preserve both tombstones' documented findings in the workplan and T32 before deleting the files | T31, T32 |

**C-21 and C-24 are superseded by C-34** — they scoped the assertion to one file, which is the weakness C-34 fixes.

---

## 13. QA Testing Report

_QA will populate this section._

---

## 14. Commit Info

_RM will populate this section._

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-15 | **Dev — C-33 flag, C-34 guard, C-35 preservation, T6 invariant suite** | **C-34:** both retired route files and their `__tests__` deleted; replaced by ONE repo-wide guard at `lib/business-os/purge/__tests__/no-deletion-paths.guard.test.ts` with all six conditions — a file-count floor that fails closed (the comment-stripper defect one level up), an allow-list naming `cleanup-incomplete`/E1 inline, three assertion families, a **unit-tested comment stripper** including the exact `app/admin/**` input that broke the tombstones, string-literal hits counting as hits, and ~4s over 500+ files. **It found two hits on its first run (F-25):** `app/api/plugin-connections/route.ts` — legitimate, properly scoped, so `plugin_connections` moved to client-only rather than being allow-listed, because an allow-list padded with routine exceptions stops being read; and the guard matching itself, excluded by exact path rather than by exempting `__tests__`. **C-35:** both tombstones' findings preserved in §9.4 F-24 and T32 — verbatim, the `/terminate` audit row attributing the deletion to its own victim with `terminated_by: 'admin'` as a literal and no actor id anywhere. **C-33:** `parseBooleanFlag` extracted to a zero-import module; `useBusinessDeleteSurface()` registered with a JSDoc saying it is a rendering hint; **the computed `process.env[CONST]` replaced with a literal read** (invisible to Next's static substitution, `undefined` on Edge — fails gated, but presents as "we set the flag and nothing happened"); documented in `feature_flags.md` with a ⚠️ block naming `authorizePurge`. **T6:** 24-assertion invariant suite — ordering verified against the live dump via exported `BLOCKING_EDGES`, B-1 importer scan, C-16 storage rules, and a deliberately broken fixture proving the scope assertion can fail. **Erasure contact** swapped to the owner's address as a marked interim (N2). 38 tests pass. |
| 2026-09-15 | **SA rulings — D9 flag shape; delete-vs-tombstone** | **Flag:** `featureFlags.ts` *is* importable server-side (no `'use client'`; `logger/client` re-exports Pino) — but it has **zero server importers today**, so nothing enforces that it stays server-safe, and that is too fragile a dependency for an authorisation boundary. **Extract `parseBooleanFlag` to a zero-import module** both callers share; register `useBusinessDeleteSurface()` as a **rendering hint**; `isBusinessDeleteSurfaceEnabled()` stays authoritative per C-22. **🔴 Defect neither the user nor Dev named:** `process.env[BUSINESS_DELETE_FLAG]` is a **computed** lookup, and Next inlines only *literal* `process.env.NEXT_PUBLIC_*` accesses — works in the Node runtime, returns `undefined` on Edge, and presents as “flag set, nothing happened, no signal”, i.e. deviation (c) through a second door. **Read the literal.** **Naming: premise (d) does not hold** — measured, `NEXT_PUBLIC_SHOW_CALIBRATION_BUTTON` and `NEXT_PUBLIC_MOVE_TO_CALIBRATION_AFTER_AGENT_CREATION` already exist without `USE_`; the convention is `NEXT_PUBLIC_<verb>_<thing>`, `USE_*` means “select implementation A vs B”, and this is an exposure flag. **Keep `ENABLE_`.** Documentation deviation made **binding in three places**, incl. a T21 test — a comment is a request, a failing test is a boundary (**C-33**). **Tombstone → delete.** The user's pushback is correct and the coordinator's proposal is **strictly stronger**: a per-file assertion protects a path that already exists, and the fifth deletion path was found *outside* the oracle SA specified. 410 vs 404 is cosmetic for a stale bundle. **Delete both route files and both `__tests__/` dirs; one repo-wide guard replaces them** (**C-34**), under six conditions of which the first is decisive — **it must fail closed on a file-count floor**, because “scanned 0, found 0” is Dev's comment-stripper defect one level up. Allow-list not deny-list, with `cleanup-incomplete` listed inline naming E1/T32. **C-21 and C-24 superseded.** **C-35:** preserve both tombstones' documented findings before deleting — including that `/terminate` wrote an audit row attributing the deletion to its own victim (`user_id: userId`, `terminated_by: 'admin'` as a literal, no actor id), verified in source. **E5 amplified:** with the repo PUBLIC and the live `service_role` key committed since 2025-10-30, the 38 unauthenticated service-role routes are **not** the primary exposure — **rotate the key first**, then the admin-authz workstream. The two findings are more severe together than separately, which is what gets missed when each lives in its own tracker. |
| 2026-09-15 | **Dev — T4 descriptor set complete (121 descriptors, 0 unclassified)** | `lib/business-os/purge/descriptors.ts` written from the requirement's §3/§8 classification and the **live dump** for every ordering and scoping fact. **Passes AC-37's own completeness check: all 110 user-scoped base tables have a descriptor**, and the 11 extras are exactly the expected categories (five global catalogs, `organizations`, `profiles`, four parent-scoped children with no tenancy column). Ordering is four bands plus `crm_activities` LAST, with `BLOCKING_EDGES` exported so the invariant test asserts `order[child] < order[parent]` for all nine **against the dump** rather than trusting the bands; B4 is carried separately in `TRIGGER_ORDERING` because it cannot be expressed as an FK. **BA's three confirmations answered:** `user_media` needs **no fourth StorageDescriptor** — its `storage_path` points at the existing `website-images` bucket (`GeneratedImageService`/`StockImageService` both set `BUCKET = 'website-images'`), so AC-4 does not extend; `business_chat_verified_questions.user_id` is **NOT NULL**, so §8.2's portable-row shape does not apply to it; `agent_memory` (singular) **exists**, alongside three other memory tables. **Two pending requirement amendments flagged (N20):** §8.10 still lists `data_decision_requests` as provisional `never` where SA ruled `optional:agents`, and §8.13 still files `agent_stats`/`agent_intensity_metrics` as suspected views when Part 2 proved they are base tables. |
| 2026-09-15 | **Dev — terminate endpoint and affordance retired (N18 (b)); C-21 stripper bug fixed** | **F-21:** `POST /api/admin/users/[id]/terminate` is now a `410 Gone` tombstone with **17 tests**, including two assertions specific to it — it never reads `params`, and it does not echo the id back, which would make a headstone into an id oracle. `app/admin/users/page.tsx` lost the handler, opener, row button, confirmation modal, reason field, four pieces of dead state and an unused `Trash2` import; its **9 `console.*` converted to Pino**. Two details from the old code recorded in the tombstone header and not previously noted: it leaked `deleteError.message` with no `NODE_ENV` guard, and it wrote an audit row attributing the deletion to **its own victim** with a literal `terminated_by: 'admin'` — audit recording the wrong actor is worse than none, because it looks like provenance. **No auth guard added to the page**, as instructed; both files carry a scope note saying this is not a security fix for `/admin`. **F-22:** my own C-21 comment-stripper was broken — it ran block comments before line comments, so the glob `app/admin/**` in the route header opened a match that swallowed both imports. It failed loudly this time, but **the same bug fails *open*** if the swallowed region contains a deletion primitive; fixed in both tombstone tests, with the ordering reason recorded so it is not tidied back. The delete-account assertion was sound by luck rather than construction. |
| 2026-09-15 | **Dev — C-29 extraction corrected; terminate tombstone STOPPED on a live caller** | **F-19 (stop):** `POST /api/admin/users/[id]/terminate` **is** called by `app/admin/users/page.tsx:360`, so I did not write the tombstone. Checked every guard layer first: middleware treats `/admin` only for the onboarding redirect (which needs a parseable auth cookie), `app/admin/layout.tsx` is 36 lines of chrome, the page has no guard, and **zero files under `app/admin/**` reference `isAdmin`/`AdminAccessService`/`admin_users`**. So the affordance is as unauthenticated as the route, and tombstoning the route alone would leave a delete button on an open screen failing with a toast — the same C-21 shape just removed from the customer surfaces. **Recommend (b): retire route and affordance together.** **F-20 (C-29):** re-ran the extraction with SA's filter — every blocking edge whose parent is in the delete set, child unrestricted. **Census reconciles exactly with SA at 37**: 23 point at `auth.users` (inert under D3), 10 at parents in the 110 (the nine I had **plus B7**), 4 at parents outside it (all inert). My earlier filter required both endpoints to be user-scoped, which is precisely how B7 hides. **All three opt-in sets swept: `agents` has exactly one external blocking edge (B7), `integrations` and `activityHistory` have none.** **C-30:** `agent_scheduler_state` characterised — no tenancy column, owned `via agents.agent_id`, `last_execution_id -> agent_executions` NO ACTION, `agent_id -> agents` CASCADE, and no code references it anywhere; descriptor drafted, with the reasoning for an explicit descriptor over relying on the CASCADE. **C-31 agreed** — B7 is the proof neither check subsumes the other: no tenancy column *and* no `auth.users` FK, so the N15 union cannot see it. |
| 2026-09-15 | **SA review 3 — T3 / live schema dump; CR-1 verified; N15–N17 ruled** | **T9's delete-order contract accepted**, and the acyclicity verified independently (`credit_transactions` is the only node appearing on both sides; `token_usage` is never a child). Arithmetic reconciles (144+35+2+58=239). **But the filter was wrong:** Dev selected blocking edges *among the 110 user-scoped tables*; the correct filter is **every blocking edge whose PARENT is in the delete set**, regardless of whether the child is user-scoped. Extracting all 37 blocking edges found five outside Dev's nine, four inert — and one real: **🔴 B7 — `agent_scheduler_state` → `agent_executions` (NO ACTION).** The child has no tenancy column, so a user-scoped filter cannot see it by construction; ticking the agents opt-in would fail the transaction. **Third instance of the off-by-default trap**, and the same blind-spot shape as N15 one level over. **N15 ruled: take the union** — the alternative fixes the instance, not the class, and `organizations` is currently excluded by human prose, the very mechanism FR-1 replaces. **BA amends FR-1 and AC-37** (Amendment 6), including a **scope limit**: the union does not close the class either — B7 has neither a tenancy column nor an `auth.users` FK — so parent-scoped children are covered by their `via` descriptors and the blocking-edge check, never by FR-1. **N16/B6 confirmed; QA gate granted as C-28** — T28 must run twice (opt-ins off, then agents on), because **three** defects (B6, B7, N11) are invisible in the default configuration, i.e. the cheapest test path is the one that reports green. **N17 routed out** as its own security item pending a table-`GRANT` check — Dev stated the limit rather than overclaiming, which is why it is rulable; `agent_memories` keeps one in-scope consequence (C-32). **CR-1 verified fixed by independent oracle** (client `.delete()` sweep, `auth.admin.deleteUser` sweep, Danger-Zone string sweep): all three live surfaces render the shared panel, both dead files deleted **with the barrel line**, 0 `console.*`. **No sixth in-product Danger Zone exists.** **🔴 E5 escalated (out of scope):** `POST /api/admin/users/[id]/terminate` hard-deletes an arbitrary `auth.users` row from a caller-supplied path param with **no authentication of any kind**, on a module-scope service-role client, reachable because `middleware.ts:83` skips all `/api`. It is not isolated — **41 `/api/admin/**` routes have no admin check, 38 never call `getUser()`**; three spot-checked, one carrying the literal comment `// TODO: Add admin role check here`. **Fifth live deletion path this cycle**; T32's count moves to five. **New C-28…C-32.** |
| 2026-09-15 | **Dev — T3 complete; live FK/trigger/policy dump persisted** | N10 cleared: the user applied the introspection migration, I called `purge_schema_introspect()` with the service-role key and persisted the full output (2,540 column rows, **110 user-scoped base tables**, 239 FKs, 84 triggers, 360 policies) to the schema-dump doc as the authoritative artifact. **Delete order derived (F-15): the full FK graph is cyclic and cannot be sorted, but only the nine `RESTRICT`/`NO ACTION` edges constrain a delete and that subgraph is acyclic** — so the RPC honours nine constraints plus `crm_activities`-last, not a total order over 239 FKs. B1/B2/B3 confirmed; **B4 confirmed as a trigger constraint, not an FK one**; **B5 does not exist** (CASCADE) — negative result recorded as SA asked; **B6 is new** — `agent_logs` before `agents`, NO ACTION, inside the off-by-default agents opt-in, the same blind spot as N11. **T5's single-path narrowing confirmed from live trigger definitions**, and §5.2's predicted duplicate `crm_contacts` triggers are both present. **F-16:** `organizations` is invisible to FR-1's predicate because it keys on `owner_user_id` — a gap in AC-37's guarantee, measured as exactly one such table, with a union predicate recommended (N15). **F-17:** 15 open `INSERT` policies where the requirement named two, three of them named "Service role" but granted to `public` (N17). **F-18:** inventory reconciled 117 -> 110; seven views drop out, but `agent_stats` and `agent_intensity_metrics` are base tables needing descriptors, and no base table was missing from Part 1. |
| 2026-09-15 | **Dev — SA code review applied (CR-1, C-22, C-26, N12) + workplan re-emit** | **CR-1 fixed:** `components/settings/SecurityTab.tsx` — the **fifth** Danger Zone, live at `/settings`, deleting `profiles`, `user_preferences`, `notification_settings` and `plugin_connections` **from the browser** behind a promise of an email that is never sent, with `Promise.all` inspecting no result so an RLS denial and a success looked identical. My F-1 claim was true and answered the wrong question; **C-27's oracle — every delete affordance, not every caller of the dead route — applied in two sweeps, and there is no sixth** (the remaining hits are Stripe Connect and an agent Danger Zone). **C-22:** the D9 flag check now lives **inside `authorizePurge`**, so a non-admin cannot Purge with the flag off by calling the route directly; it restricts to admins rather than forbidding, or T28 could never demonstrate the un-gating criteria. **N12:** both dead files deleted, with the `ProfileTab` re-export dropped from `index.ts` in the same change. **C-26:** the `FALLBACK_COPY` ↔ `en` equality is now a test, with a non-vacuity guard and an assertion that the placeholder address is present and `.invalid`. 20 tests pass; typecheck clean on every touched file. **F-14:** the truncation bug is reachable from my own tooling — a `print()` of `→` raised `UnicodeEncodeError` on this machine's cp1252 stdout — so every write is now temp-then-`os.replace` and diagnostics run under `PYTHONIOENCODING=utf-8`. **§1–§11 re-emitted from session state**; §9.4 (F-1…F-14) and §9.5 (N1…N14) reconciled, §6 statuses and the §10 Pino table restored. |
| 2026-09-15 | **SA rows — summary text lost in Dev's re-emit** | ⚠️ Three SA Change-History rows (the truncation/recovery notice, the rev-2 clearance, and code review 1) were dropped by **my** re-emit split, which cut the document at `## Change History` and rebuilt without it. I have not paraphrased SA's wording back in as if it were SA's. **Nothing substantive is lost:** the Recovery Notice at the top of this file, and §12A / §12B, are verbatim and are the authoritative record of all three. SA may re-emit its rows; this row is the marker, not a replacement. |
| 2026-09-15 | **Dev — implementation round 2 (N7 shared component, BA's two greps)** | One shared component, split into `ErasureRequestContent` (the copy + the single erasure address) and `DangerZonePanel` (boxed chrome), because the surfaces use different idioms. All four known callers rewired. **F-8:** `useLanguage()` throws outside a provider and **`app/v2/**` has none**, so the obvious implementation would have crashed `/v2/settings`; resolved with `useOptionalLanguage()` + English fallbacks, with `tr()` treating `t(key) === key` as a miss. **Greps answered:** `agent_memory` is real (there are four memory tables); `data_decision_requests` is written by `lib/pilot/shadow/DataDecisionHandler.ts` and should be **`optional:agents`**, not `never` — and **no migration creates it**, so its FKs are unknown until Part 2. Pino extended to `SecurityTabV2` and `ProfileTab`. |
| 2026-09-15 | **Dev — implementation round 1 (T1 Part 1, T5, T30, T31 partial)** | Written: the FR-1 introspection migration (`SECURITY DEFINER`, `service_role`-only, pinned `search_path`, read-only); `lib/business-os/purge/types.ts`; `lib/business-os/purge/purgeAuthz.ts`; the `410 Gone` tombstone with 16 passing tests including a comment-stripping no-deletion-primitives source scan; `SecurityTab.tsx` to Pino with `handleDeleteAccount` removed; en/es/he copy; a greppable `TODO-ERASURE-CONTACT` placeholder. **F-1:** the retired route had **four** callers, and the file SA and I both verified was **dead code**. **F-2:** **117 live user-scoped relations against 79 named** — 38 unclassified, which AC-37 fails closed. **F-4:** `insight_outcomes` (#53) does not exist while `OutcomeRepository` queries it four times. **F-5:** `isAdminById` would deny email-seeded admins, so T30 uses `isAdmin({id,email})`. **F-6:** `exec_sql` does not exist, so T1 Part 1 was completed read-only via the PostgREST OpenAPI spec; T3 remains blocked on the SQL editor. |
| 2026-09-15 | **Dev rev 2 — SA review applied; user decisions folded in** | All 8 SA rulings, conditions C-1…C-19 and bounds B-1…B-4 applied. **Three new tasks: T30** (server-side `AdminAccessService` authorisation — `/test-business-os` is on the middleware skip list at `middleware.ts:117-118` with no admin gate, so an unflagged Purge would have been reachable by every signed-in customer), **T31** (retire `/api/user/delete-account` to a `410 Gone` shim on a standalone `fix/` branch), **T32** (written hand-off to Offir on the `cleanup-incomplete` cron — note it, do not act). **29 → 32 tasks, 8 → 9 stages; critical path unchanged** (T1 → T3 → T4 → T9 → T16 → T20 → T28) because T30 and T31 have no upstream dependencies. **User decision on the Delete-account button: option (a) — reuse it.** The existing Danger Zone button becomes this feature's customer surface; the *endpoint* is retired rather than repurposed, because keeping the name "delete-account" on an operation that provably does not delete the account is the defect class that produced this cycle's three deletion hazards. SA's objection to (a) is answered by T31 removing the old implementation on day one, so there is no collision at any flag state. **All seven V1–V7 corrections applied**, including my DEV-Q8 arithmetic (`resolveUserConnectAccounts` dedupes → 4 traversals, not 8), my channel-stats copy (next scheduled sync, up to ~20 h), the repository counts (54 files / 52 classes; 3 soft-delete of which 1 in-scope; 31 of 52 carrying `.limit()`/`.range()`; PostgREST's 1000-row cap), and the DEV-Q3 wording (the route touches exactly one of the 60 — `user_preferences`, #60, the `K*` — and audits intent but never outcome). **§7 AC mapping rebuilt and mechanically re-verified: 49 of 49**, with AC-33 given a real owner (T9 ordering, T15/T21 test) and AC-25/AC-27 re-pointed from T27's document to T28's live proof. The rev-1 claim that all 49 had owners was an assertion, not a check; it is now a check. **§8.7 marked closed statically** per SA §12.4 — T2(c) downgraded 🔴→🟡. **Pino reversal flagged:** `cleanup-incomplete` is no longer touched (C-17 moved the enforcer off it; E1 may retire it), so its user-approved conversion is withheld rather than performed on a route pending a deletion decision. **New finding:** `lib/payments/RefundService.ts:904` constructs Stripe with **no `apiVersion` at all** — a third version state SA's S3 did not name. |
| 2026-09-15 | **SA workplan review — approved with conditions** | All four blocking questions ruled. **DEV-Q1** exception granted, bounded by B-1…B-4 (one descriptor-driven repository is a granularity choice inside the repository layer, not a layering waiver). **DEV-Q2** confirmed — the existing wrapper is session-scoped over a pooled connection; `pg_try_advisory_xact_lock` inside the RPC; **FR-28 amended**. **DEV-Q3** verified line by line — the 16 `ON DELETE`-less `auth.users` FKs mean the route 500s at phase 6 for every onboarded user after phases 1–5 have already run; removal approved via a standalone `fix/` branch, but the button must be **replaced** with a support-channel erasure-request block (C-5), not deleted. **DEV-Q4** confirmed; **FR-26 and AC-26 amended** — and Dev's replacement copy corrected in turn (`channel_connections.last_synced_at` is retained, so channel stats return on the next scheduled sync, up to ~20 h, not within the hour). Non-blocking: Q5 accepted with the cache documented as best-effort; Q6 split (ids-only for the two unbounded analytics tables, ceiling-refusal for everything else); Q7 ruled harder than asked — the chosen host cron is **provably dormant today**, so the customer-path snapshot takes the no-PII branch by default and the enforcer is re-hosted; Q8 refusal semantics stand and the shape is unchanged, because `resolveUserConnectAccounts` already dedupes (4 traversals, not 8) — budget set from measurement, ≤ ½ `maxDuration`, >20 s on a clean account escalates. **Seven workplan claims failed verification (V1–V7)**, including the §7 assertion that all 49 ACs have an owner — **44 of 49** are in the mapping table; AC-16, AC-29, AC-33, AC-41 and AC-42 are absent, and AC-33 is genuinely unowned. **§8.7 closed statically**: `platform_learning_tables` creates `workflow_patterns`/`global_failure_patterns`, neither of which has a `user_id`, so neither can ever appear in FR-1 route (a)'s enumeration; `execution_optimization_tables` creates two tables already listed. Requirement §11.2 resolved. Dry-run token approved with C-6…C-12 (prefer an HKDF-derived key over a new Vercel secret, fail closed, `timingSafeEqual`, canonical JSON, `payload.signature` wire format); AC-5's snapshot oracle approved with C-13/C-14 (same exhaustive read pass; assert the id set is non-empty or the AC passes vacuously). **New task T30** — the "internal, unflagged" `/test-business-os` surface is on the middleware skip list with **no admin gate**, so an unflagged Purge would be reachable by every signed-in customer, defeating D9; authorisation moves server-side to `AdminAccessService`. **E1 escalated above this cycle:** `/api/auth/cleanup-incomplete` deletes `auth.users` on a `user_metadata` predicate the live onboarding flow never writes, and is dormant only because `CRON_SECRET` is unset — the pending Vercel change arms it. Third live deletion hazard found this cycle. |
| 2026-09-15 | Created | Workplan drafted from the SA-approved requirement. 29 tasks in 8 stages; critical path T1 → T3 → T4 → T9 → T16 → T20 → T28. Twelve concerns raised for SA (DEV-Q1…DEV-Q12), three of them blocking: the repository-explosion ruling, the advisory-lock mechanism, and a previously unmentioned live customer-facing `/api/user/delete-account` path that deletes `auth.users` in violation of D3. Four factual corrections to the requirement recorded against live measurement, the largest being that `insight-detect` enumerates tenants from four `D` tables rather than `business_profiles`, so FR-26/AC-26's Reset copy names the wrong crons. |
