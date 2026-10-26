# Workplan: DL-1a — Account closures schema + cleanup regeneration (+ GoTrue spike)

> **Last Updated**: 2026-10-25

**Developer:** Dev
**Requirement:** [BUSINESS_OS_ACCOUNT_DELETION_LIFECYCLE_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_ACCOUNT_DELETION_LIFECYCLE_REQUIREMENT.md) §6.3 DL-1a, §7 DL-1a, §10 (XC-1, XC-3, XC-4, XC-11, XC-21), `## SA Split Review — 2026-10-25` (SR-3, SR-4, SR-5, SR-7, SR-8). Parent: [BUSINESS_OS_SELF_SERVICE_EXIT_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_SELF_SERVICE_EXIT_REQUIREMENT.md) `## SA Review — 2026-10-25` (F-1 to F-4, F-14). Both requirements are on branch `docs/bos-self-service-exit` until that docs PR merges.
**Overall plan:** [BUSINESS_OS_ACCOUNT_DELETION_PLAN.md](/docs/workplans/BUSINESS_OS_ACCOUNT_DELETION_PLAN.md)
**Coordination:** `C:\Users\Barak\My Projects\AgentsPilot\SELF_SERVICE_EXIT_COORDINATION.md` (cleanup-regen lock and 20261093 held by DL-1a since 2026-10-25)
**Branch:** `feature/account-closure-dl1a` (worktree `neuronforge-dl1a`, from `origin/main` `7e51af5b`)
**Date:** 2026-10-25
**Status:** Code Complete (session cut kept by default; GoTrue spike not yet run, see §3.4)

## Overview

DL-1a builds only the storage and the safety seams for the deletion lifecycle. Nothing customer-facing changes. It adds the server-write-only table `business_os_account_closures`, its claim RPC, and (unless the spike rules it out) a service-role-only function that ends one user's sign-in sessions. It also adds the closure repository, the lock seam over the Supabase Auth admin API, the purge descriptor, and the regenerated test-account cleanup function, so that stage E (and a test-account cleanup) also deletes the closure row. Two migrations, one manual prod gate, applied and merged back to back.

---

## Table of Contents

1. [Analysis summary](#1-analysis-summary)
2. [Decisions and their reasons](#2-decisions-and-their-reasons)
3. [Task 1: the GoTrue spike](#3-task-1-the-gotrue-spike)
4. [Schema: migration 20261093](#4-schema-migration-20261093)
5. [Code: repositories, constants, descriptor](#5-code-repositories-constants-descriptor)
6. [Cleanup regeneration: migration 20261094](#6-cleanup-regeneration-migration-20261094)
7. [Guards and tests](#7-guards-and-tests)
8. [Read-only SQL for TL (schema check)](#8-read-only-sql-for-tl-schema-check)
9. [Prod apply plan](#9-prod-apply-plan)
10. [Rollback](#10-rollback)
11. [Files to create / modify](#11-files-to-create--modify)
12. [Task list](#12-task-list)
13. [Risks](#13-risks)
14. [Open items for SA](#14-open-items-for-sa)
15. [SA Review Notes](#sa-review-notes)
16. [QA Testing Report](#qa-testing-report)
17. [Commit Info](#commit-info)
18. [Change History](#change-history)

---

## 1. Analysis summary

| Area | What DL-1a touches | Evidence (read on `7e51af5b`) |
|---|---|---|
| New table | `public.business_os_account_closures` (XC-1 + SA-Q1 columns + claim columns + SR-8 columns) | F-1: a free account cannot hold a billing row, so the closure is its own table |
| New SQL functions | Claim RPC (XC-4). Session-cut function (XC-3), unless the spike drops it | Claim-pattern skill §2; 20261074's start-function grant shape |
| Auth | GoTrue ban / unban through the admin API, behind one repository seam. No call site in DL-1a: DL-4 wires it | F-2 (the anonymise bans for 100 years and checks `> 99 years`), F-3 (`getUser()` 30 s cache) |
| Purge / cleanup | Descriptor (`never`, user-scoped, `export: exclude`), a step-B removal entry, `USER_OWNED_TABLES` reason, regenerated cleanup function | `descriptors.ts`, `scripts/generate-test-account-cleanup-sql.ts` (`FUNCTION_MIGRATION` = 20261092, `PREVIOUS` = 20261081), drift test pins |
| Guards | Duplicate migration prefix (SR-7, new). `no-deletion-paths` family 4: the session-cut migration is allow-listed, and the regeneration's history entries move (SR-3) | `no-deletion-paths.guard.test.ts` l.104–219 |
| Not touched | Routes, UI, emails, audit events, feature flags, `vercel.json`, `receiptInput.ts` key set, entitlements | DL-1b to DL-5 |

**Phase (CLAUDE.md rule 8):** not V6 or pilot work. No plugin code.

**Deprecated systems met:** `lib/business-os/account/accountDeletionPolicy.ts` (`@deprecated`, purge slice 3a) reads `USER_OWNED_TABLES`, so the new table appears in it as a "delete" table. This is the correct verdict, so no edit is needed there. Flagged only, not extended.

**`console.*`:** none in the files this slice edits (to be re-checked with `grep -n "console\." <file>` on each file before its first edit; any hit is flagged to TL, per CLAUDE.md § Logging).

---

## 2. Decisions and their reasons

| # | Decision | Why | Needs |
|---|---|---|---|
| D-1 | **Two migrations: 20261093 = table + claim RPC + session-cut function; 20261094 = regenerated cleanup function.** The coordination file reserves 20261093 for "the regenerated cleanup function". Dev proposes the order above and asks TL to reserve 20261094 | The generator owns the whole function file, so the table cannot live in it. DE-8a (20261074 table → 20261075 function) and DE-10b.1 (20261080 → 20261081) set the precedent that the lower number is the one applied first. If the function took 20261093 and the table 20261094, apply order and number order would run in opposite directions | TL: reserve 20261094 and re-label 20261093 (O-1) |
| D-2 | **Descriptor `level: 'never'`, user-scoped, `export: exclude`**, plus an entry in `FULL_REMOVAL_EXTRAS` (step B) | A business Reset or Purge must **not** erase a pending deletion request. If it did, the banner, the lock and the stored GDPR request time would vanish while the plan stayed set not to renew. Step B removes the row in **both** cleanup modes: the hard test-account delete, and the anonymise (it is not in `KEEP_SET`). That is XC-1's "at E the engine deletes it" | SA (O-2) |
| D-3 | **`FUNCTION_REQUIRED_TABLES` is not extended** | XC-11: only for tables the generated SQL names **statically**. Step-B tables travel as string literals in `VALUES` and are run through `format('%I')` behind `to_regclass(...) IS NOT NULL`. An absent table is reported `absent` and skipped. The table migration is still applied first (D-1, §9) | SA confirms (O-3); contrast SA C-8 for `business_os_data_exports` |
| D-4 | **No trigger on the closure table.** The repository sets `updated_at` | Every trigger on a plan table must be reviewed for G-17 (and for G-21 in the anonymise). Zero triggers means zero new review entries | — |
| D-5 | **Claim RPC is `SECURITY INVOKER`, executable by `service_role` only** (20261074 start-function shape). The lease is part of the claim predicate (`claimed_at` older than `p_lease_seconds` is claimable again), so the "reaper first" step is built into the claim and no separate reap RPC is needed | The skill's `SECURITY DEFINER` exists for tables that `service_role` cannot write. Here `service_role` holds the table grants, so INVOKER adds no power. A closure row never dead-letters: an account must eventually lock or be kept. So the reaper has nothing to do beyond freeing the lease | SA (O-4) |
| D-6 | **The claim never takes a `requesting` row younger than 15 minutes** (SQL literal, mirrored as a TS constant and pinned by a migration test) | XC-2: the request route owns a `requesting` row until it moves it to `pending` or deletes it. The job settles only abandoned rows. Putting the age in the claim stops a job run from racing a live request | — |
| D-7 | **The session-cut function refuses unless the user has an open closure row in `grace` or `locked`** (it raises with SQLSTATE 42501). It deletes `auth.sessions` by `user_id`, then any remaining `auth.refresh_tokens` by `user_id::text`, and returns the two counts | Tenant-isolation-guard: a service-role function that takes a user id must not become a general "sign anyone out" tool. Because it checks the closure row in SQL, the guard does not depend on the caller. `refresh_tokens.user_id` is text (DE-10b.1 SQL-4, I-7). Deleting sessions cascades the refresh tokens and `mfa_amr_claims` linked to them. The second delete catches tokens with no session | SA (O-5) |
| D-8 | **Two new repositories, not exported from the barrel:** `AccountClosureRepository` (table and claim) and `AccountLockRepository` (ban, unban, session cut, login state). Each has a callers guard modelled on `authAccountRepository.callers.guard.test.ts`. Types live in the repository files | Rule 1 and XC-3 ("both calls sit behind one repository seam"). `AuthAccountRepository` is pinned to the invite flow by its own guard, so adding the ban there would widen that guard's meaning. SR-11 prefers types kept out of the shared `types.ts` / `index.ts` | SA (O-6) |
| D-9 | **Columns beyond XC-1's list:** `lock_timezone` (the zone `lock_at` was computed in) and `next_check_at` / `last_error_code` (claim pacing and observability) | `lock_at` is fixed when stage C starts, and later emails must show the same local date even if the owner changes zone (XC-4). `next_check_at` lets DL-3 sleep a row in B until the paid period ends, instead of re-claiming it every hour | SA (O-7) |
| D-10 | **`reason_code` has a shape CHECK only** (`^[a-z][a-z0-9_]{1,39}$`), with no value list | BQ-7 (the reason list) is still open. The value list is enforced by Zod in DL-1b from one TS list, so a later list change needs no migration | — |

---

## 3. Task 1: the GoTrue spike

**Question (XC-3):** does `auth.admin.updateUserById(id, { ban_duration: '87600h' })` on its own end a user's live sign-in, so that the session-cut function is not needed?

**Expected answer: no, keep the function.** A published report on supabase/auth (unverified, static analysis) says the ban is checked only when credentials are issued: password sign-in, the refresh-token grant and OTP. Under that reading an issued access token keeps working until it expires (about 1 h by default), and the session rows stay. The admin `signOut(jwt, 'global')` call does revoke every session, but it needs **the user's own JWT**, which a cron job at lock time does not have. The spike proves or disproves this on our project.

### 3.1 Safety

| Rule | How |
|---|---|
| Only a disposable `+test` login | The user creates it by invite (e.g. `meiribarak+closurespike@…`). It is not an admin, has no business, no Stripe customer and no money. TL confirms it with S-0 below |
| Prod is the only database | Preview and production share one database (C-10 §2), so this writes to the prod `auth` schema. **It runs only after the user explicitly OKs it in the session.** This workplan does not authorise it |
| Nothing stored | The script keeps tokens in memory only. It never logs a token or an email, and prints status codes and error codes only |
| Reversible | The last step unbans (`ban_duration: 'none'`). The login stays until a later Danger Zone test-account cleanup removes it |
| No code in git | The script lives in the session scratchpad and is not committed (it holds no secret; it reads `.env.local`) |

### 3.2 Steps (script `spike-gotrue-ban.ts`, run by TL with `npx tsx`)

| # | Step | Records |
|---|---|---|
| S-0 | Read-only SQL (§8 Q-10) by email → the id, `banned_until`, counts of sessions and of refresh tokens not revoked | Baseline. Must be: not an admin, no `business_profiles` row, `banned_until` NULL |
| 1 | Two password sign-ins with the anon key (clients A and B) | Two access + refresh token pairs, in memory |
| 2 | Q-10 again | sessions = 2, refresh tokens not revoked ≥ 2 |
| 3 | `auth.admin.updateUserById(id, { ban_duration: '87600h' })` | HTTP result, `banned_until` about 10 years out |
| 4 | Q-10 again (within 5 s) | **Did the session and refresh-token rows go, or get revoked?** |
| 5 | `auth.getUser(accessTokenA)` (what `lib/auth.ts` `getUser()` calls) | Status and error code. Does a banned user's open session still pass? |
| 6 | `auth.refreshSession({ refresh_token: B })` | Expect refused; record the code |
| 7 | Password sign-in again | Expect refused; **record the exact error code** (`user_banned` expected), which DL-4 maps to the "account closed" copy (XC-21) |
| 8 | `auth.admin.signOut(accessTokenA, 'global')`, then `auth.getUser(accessTokenA)` and Q-10 | Proves the F-3 mechanism: once the session row is gone, the old access token fails (`session_not_found` expected) |
| 9 | `auth.admin.updateUserById(id, { ban_duration: 'none' })`, then sign in | Unlock works; `banned_until` NULL or in the past |

### 3.3 Decision rule

| Observation after step 3 | Decision |
|---|---|
| Within 5 s: zero session rows **and** zero live refresh tokens, **and** step 5 fails | GoTrue ends the sign-in by itself. **Drop the session-cut function** from 20261093 before it is written: `AccountLockRepository.cutSessions` is removed and the SQL_AUTH_WRITE allow-list entry is not added. Recorded here and in the requirement (XC-3) |
| Anything else (expected) | **Keep the function.** Step 8's result tells DL-4 how fast an open session ends (F-3: within about 30 s through the `getUser()` cache) |
| Step 8 does **not** fail the old token | Stop and tell SA: neither path ends an open session, so XC-3 needs a new ruling before DL-4 |

Results go into §3.4 (filled after the run), then SA confirms the decision before Task 3.

### 3.4 Spike results

*(to be filled after the run: date, who ran it, rows S-0 to 9, decision)*

**Dev, 2026-10-25: not run.** The user has not approved it yet. On TL's instruction Dev built the default (**keep** the session cut) and isolated it so a **drop** is one small change: in 20261093 the cut function's CREATE, ALTER, REVOKE and GRANT block plus post-condition 7; its DROP line in the 93 rollback; checker rows 9 and 10 and pre-check row 7; `AccountLockRepository.cutSessions` and `SESSION_CUT_FUNCTION`; the 20261093 entry of `SQL_AUTH_WRITE_ALLOW_LIST`; the cut-function rule of the callers guard; and the cut tests in T-2 and T-4. The script is written, NOT in git and NOT run: `spike-gotrue-ban.ts` in the Dev session scratchpad, with the W-11 guards (password from `SPIKE_PASSWORD` or a hidden prompt, never argv; the email must contain `+test` and `getUserById(S-0 id)` must return it; unban in `finally`; a final global sign-out; codes and timestamps only). It pauses for Q-10 at steps 2, 4 and 8, because the `auth` schema is not reachable through the API.

---

## 4. Schema: migration 20261093

**File:** `supabase/migrations/20261093_business_os_account_closures.sql` (hand-written, one transaction, paste-safe: no `into` in prose, no `SELECT … INTO`)

### 4.1 Table

| Column | Type | Null / default | Meaning (source) |
|---|---|---|---|
| `id` | uuid | PK, `gen_random_uuid()` | One row per request (XC-1) |
| `user_id` | uuid | NOT NULL, FK `auth.users(id) ON DELETE CASCADE` | The account. Tenancy FK, so G-18/G-20 see it as the plan's own key |
| `status` | text | NOT NULL, default `requesting`, CHECK in (`requesting`, `pending`, `grace`, `locked`, `kept`) | XC-1 state machine. No `closed` (SA W-6, XC-1a) |
| `requested_at` | timestamptz | NOT NULL, `now()` | The GDPR clock (SA-Q1); E reads it (XC-6) |
| `statement_language` | text | NOT NULL, CHECK in (`en`, `he`, `es`) | Never the text (XC-1, SA-8); mirrors `STATEMENT_LANGUAGES` |
| `reason_code` | text | NOT NULL, shape CHECK (D-10) | BQ-7 list, enforced in Zod |
| `renewal_was_on` | boolean | NOT NULL | Read from our billing row at insert (XC-2); false for a free account |
| `plan_ends_at` | timestamptz | NULL | B end (`current_period_end` at request). NULL = no paid plan |
| `grace_starts_at` | timestamptz | NULL | Stage C start (`ended_at`, or the request for free) |
| `lock_at` | timestamptz | NULL | Start of local day 15, fixed at C start (XC-4) |
| `lock_timezone` | text | NULL, length ≤ 64 (W-13) | Zone `lock_at` was computed in (D-9) |
| `locked_at` | timestamptz | NULL | Stage D happened |
| `blocked_at` | timestamptz | NULL | The latest time the lock was refused by a blocker |
| `blocked_codes` | text[] | NOT NULL, `'{}'` | Guard codes only (XC-1, XC-5) |
| `kept_at` | timestamptz | NULL | — |
| `kept_source` | text | NULL, CHECK in (`owner`, `admin`, `stripe`) | XC-1, XC-13 |
| `requested_email_sent_at`, `grace_email_sent_at`, `reminder_email_sent_at`, `blocked_email_sent_at`, `closed_email_sent_at`, `kept_email_sent_at` | timestamptz | NULL | One per email (XC-1, XC-4, BQ-22) |
| `closed_email_attempts` | integer | NOT NULL, `0`, CHECK ≥ 0 | SR-8 |
| `closed_email_first_attempt_at` | timestamptz | NULL | SR-8 (the BQ-41 cap counts from here) |
| `claimed_by` | uuid | NULL | Claim (skill §1) |
| `claimed_at` | timestamptz | NULL | Lease clock |
| `attempts` | integer | NOT NULL, `0`, CHECK ≥ 0 | Bumped per claim |
| `next_check_at` | timestamptz | NULL | When the job should look next; NULL = now (D-9) |
| `last_error_code` | text | NULL, length ≤ 64 | A code, never a message |
| `created_at`, `updated_at` | timestamptz | NOT NULL, `now()` | — |

**Row CHECKs** (one named constraint each, so a failing write names the rule):
- `kept_source IS NOT NULL` and `kept_at IS NOT NULL` exactly when `status = 'kept'`.
- `grace_starts_at` and `lock_at` NOT NULL when `status IN ('grace', 'locked')`.
- `locked_at` NOT NULL when `status = 'locked'`.
- `(claimed_by IS NULL) = (claimed_at IS NULL)`.
- `cardinality(blocked_codes) <= 20`, and every element matches `^[A-Z]-[0-9]{1,2}[a-z]?$|^[a-z_]{1,40}$`. That keeps guard codes like `G-9` and the failed-payment code, and refuses free text. Built as SA W-13 says, with no helper function: `cardinality(...) <= 20 AND array_position(blocked_codes, NULL) IS NULL AND array_to_string(blocked_codes, ',') ~ '^(([A-Z]-[0-9]{1,2}[a-z]?|[a-z_]{1,40})(,|$))*$'`.

**Indexes:**
- `business_os_account_closures_one_open` UNIQUE on `(user_id)` WHERE `status IN ('requesting', 'pending', 'grace', 'locked')`. XC-1 lists the open set. `requesting` is included so a double click cannot create two rows.
- `business_os_account_closures_claimable` on `(next_check_at)` WHERE `status IN ('requesting', 'pending', 'grace')`, the claim's predicate (skill §1).
- `business_os_account_closures_user` on `(user_id, created_at DESC)`, for history reads by user.

**Access:** `ENABLE ROW LEVEL SECURITY`, no policy. `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role`, then `GRANT SELECT, INSERT, UPDATE, DELETE … TO service_role` (20261074 shape).

### 4.2 Claim RPC

`public.business_os_account_closures_claim_due(p_runner uuid, p_batch integer) RETURNS SETOF public.business_os_account_closures` (SA W-2: no lease parameter). `LANGUAGE sql`, `VOLATILE`, `SECURITY INVOKER`, `SET search_path = pg_catalog, public, pg_temp`.

```sql
WITH due AS (
  SELECT c.id FROM public.business_os_account_closures AS c
  WHERE c.status IN ('requesting', 'pending', 'grace')
    AND (c.status <> 'requesting' OR c.requested_at < now() - interval '15 minutes')
    AND (c.next_check_at IS NULL OR c.next_check_at <= now())
    AND (c.claimed_at IS NULL OR c.claimed_at < now() - interval '90 seconds')
  ORDER BY c.next_check_at NULLS FIRST, c.requested_at
  LIMIT LEAST(GREATEST(p_batch, 1), 100)
  FOR UPDATE SKIP LOCKED
)
UPDATE public.business_os_account_closures AS c
SET claimed_by = p_runner, claimed_at = now(), attempts = c.attempts + 1, updated_at = now()
FROM due WHERE c.id = due.id
RETURNING c.*;
```

Per SA W-2 the lease is the literal `interval '90 seconds'`, pinned by T-2 to `CLOSURE_LEASE_SECONDS`, so no caller can pass a shorter one. As built, the due CTE also requires `p_runner IS NOT NULL` and clamps `coalesce(p_batch, 1)` to 1..100. EXECUTE: `REVOKE … FROM PUBLIC, anon, authenticated`; `GRANT EXECUTE … TO service_role`.

### 4.3 Session-cut function (only if the spike keeps it)

`public.business_os_account_closure_cut_sessions(p_user_id uuid) RETURNS jsonb`. `LANGUAGE plpgsql`, `VOLATILE`, **`SECURITY DEFINER`**, owner `postgres`, `SET search_path = pg_catalog, public, pg_temp`. Variables are assigned with `:=` only.

1. If `p_user_id IS NULL`, or no row exists in `public.business_os_account_closures` with that `user_id` and (`status = 'locked'` or (`status = 'grace'` and `lock_at <= now()`)) → `RAISE EXCEPTION … USING ERRCODE = '42501'` (SA W-3).
2. `DELETE FROM auth.sessions WHERE user_id = p_user_id` → `v_sessions` from `GET DIAGNOSTICS`.
3. `DELETE FROM auth.refresh_tokens WHERE user_id = p_user_id::text` → `v_tokens`.
4. `RETURN jsonb_build_object('sessions', v_sessions, 'refresh_tokens', v_tokens)`.

`REVOKE ALL … FROM PUBLIC, anon, authenticated`; `GRANT EXECUTE … TO service_role`.

### 4.4 In-migration guards (20261074 pattern)

- Pre: `anon` / `authenticated` may not CREATE in `public`. `auth.sessions.user_id` is uuid and `auth.refresh_tokens.user_id` is text-like (else raise: the delete would compare wrongly). `postgres` holds DELETE on both.
- Post: RLS on, zero policies on the table, `anon` / `authenticated` hold no table privilege, the partial unique index exists, each function's `prosecdef` / `provolatile` / `proconfig` is as above, and no `EXECUTE` exists for `PUBLIC` (grantee 0), `anon` or `authenticated`. Any failure raises, and the whole file rolls back.

---

## 5. Code: repositories, constants, descriptor

### 5.1 Constants (pure, client-safe)

**File:** `lib/business-os/account-deletion/closureLifecycle.ts`

`CLOSURE_STATUSES`, `OPEN_CLOSURE_STATUSES` (`requesting`, `pending`, `grace`, `locked`), `CLAIMABLE_CLOSURE_STATUSES`, `KEPT_SOURCES`, `CLOSURE_EMAILS` (`requested`, `grace`, `reminder`, `blocked`, `closed`, `kept`; the same words as XC-13 `details.email`, plus `blocked`), `ALLOWED_TRANSITIONS` (`requesting→pending|grace`, `pending→grace|kept`, `grace→locked|kept`, `locked→kept`; no `deleted` pseudo-state and no `closed`, SA W-5 and W-6), `GRACE_DAYS = 14`, `REQUESTING_SETTLE_MINUTES = 15`, `CLOSURE_LEASE_SECONDS = 90`, `LOCK_BAN_DURATION = '87600h'`, `UNBAN_DURATION = 'none'`. A migration test (§7) fails CI when a SQL literal and its constant differ (`jobPolicy.ts` precedent).

### 5.2 `AccountClosureRepository`

**File:** `lib/repositories/AccountClosureRepository.ts` (new-repository skill; service-role client, documented; never throws; `{ data, error }`; Pino `service: 'AccountClosureRepository'`; logs ids and codes only)

| Method | Scope | Used by |
|---|---|---|
| `findOpenForUser(userId)` | `.eq('user_id', userId).in('status', OPEN)`, `.maybeSingle()` | DL-1b (request, keep, checkout and Boost refusal), DL-2 (banner) |
| `findById(id, userId)` | `.eq('id').eq('user_id')` | DL-1b, DL-5 |
| `insertRequesting(input)` | Explicit field list (`user_id` from the session caller, `statement_language`, `reason_code`, `renewal_was_on`, `plan_ends_at`). Never `id`, `status` or timestamps from input. A 23505 on the open-row index → typed `already_open` | DL-1b |
| `transition(id, userId, from, to, patch)` | Compare-and-set `.eq('id').eq('user_id').eq('status', from)`; refuses a pair not in `ALLOWED_TRANSITIONS` before any DB call; patch built from a per-transition allow-list of columns; `{ count: 'exact' }` instead of `.select()` after an update (PostgREST update + select hazard noted in memory) | DL-1b to DL-5 |
| `deleteRequesting(id, userId)` | `.eq('status', 'requesting')` only (XC-2's Stripe-failure path) | DL-1b |
| `claimDue(runnerId, batch)` ⟨unscoped-by-design⟩ | RPC (§4.2) with `CLOSURE_LEASE_SECONDS`; the result is parsed with Zod | DL-3 |
| `updateClaimed(id, runnerId, patch)` ⟨unscoped-by-design⟩ | `.eq('id').eq('claimed_by', runnerId)` compare-and-set; allow-listed columns; clears the claim | DL-3, DL-4 |

`⟨unscoped-by-design⟩` methods carry the `PluginConnectionRepository` doc-comment precedent. Every later effect is scoped to the claimed row's `user_id` (tenant-isolation-guard step 6).

### 5.3 `AccountLockRepository` (the auth-admin lock seam)

**File:** `lib/repositories/AccountLockRepository.ts` (not in the barrel; callers guard)

| Method | Does | Notes |
|---|---|---|
| `readLoginState(userId)` | `auth.admin.getUserById` → `{ exists, bannedUntil, isTombstone }`. Tombstone = `isClosedAccountEmail(email)` or `app_metadata.deleted === true` (XC-3) | The email is never logged or returned |
| `banLogin(userId)` | `updateUserById(id, { ban_duration: LOCK_BAN_DURATION })` | Refuses (no call) when `readLoginState` says tombstone or missing |
| `unbanLogin(userId)` | `updateUserById(id, { ban_duration: UNBAN_DURATION })` | Refuses on a tombstone (XC-3) |
| `cutSessions(userId)` | RPC §4.3 → `{ sessions, refreshTokens }`; 42501 → typed `not_closing` | Removed if the spike drops the function |

There are no callers in DL-1a besides tests. The callers guard starts with an empty production allow-list, and DL-4 adds the lifecycle job and the admin Unlock route.

### 5.4 Descriptor, removal entry, ownership

- `lib/business-os/purge/descriptors.ts`, in the `EXCLUDED` list near the DE-10b.1 receipt entry: `never('business_os_account_closures', U, exclude(EXPORT_REASON.PLATFORM, 'the deletion request itself: dates, a language code and guard codes'), '<notes: why never (D-2), FK CASCADE to auth.users, no inbound FK, no trigger, removed by step B in both cleanup modes>')`.
- `scripts/generate-test-account-cleanup-sql.ts` `FULL_REMOVAL_EXTRAS`, in the "Account settings" group next to `auth_handoff_codes`: `{ table: 'business_os_account_closures', reason: 'The deletion request of the account (DL-1a, XC-1). Removed in both modes: at E the engine deletes it.' }`.
- `lib/business-os/businessOwnedTables.ts` `USER_OWNED_TABLES`: one reason line (account-level; a business Reset or Purge must not cancel a deletion request). Added at the DE-8a anchor, add-only (SR-10).

---

## 6. Cleanup regeneration: migration 20261094

Holds the S-1 lock (SR-3 file list). Generator edits:

| Constant | From | To |
|---|---|---|
| `FUNCTION_MIGRATION` | `20261092_operator_test_account_cleanup_meeting_links` | `20261094_operator_test_account_cleanup_account_closures` |
| `PREVIOUS_FUNCTION_MIGRATION` | `20261081_operator_account_cleanup_anonymise` | `20261092_operator_test_account_cleanup_meeting_links` |
| `FUNCTION_MIGRATION_PURPOSE` | 20261092 lines | "Adds business_os_account_closures to step B, removed in the hard delete and in the anonymise" · "Nothing else in the plan changes. Same 8 argument signature as 20261092" |
| `ROLLBACK_CONSEQUENCE` | 20261092 lines | "The restored 20261092 function does not remove closure rows, so a test account cleanup or an anonymise would leave its closure row behind" · "That leaves an orphan row under a closed login. It removes nothing" |
| Doc comment | — | One `20261094:` paragraph (chains on 20261092, stamp `ec34d5604055abfe`, applied 2026-10-25) |
| `FUNCTION_REQUIRED_TABLES` | unchanged | D-3 |

Then `npx tsx scripts/generate-test-account-cleanup-sql.ts` rewrites: `scripts/test-account-cleanup-check.sql`, `scripts/test-account-cleanup-delete.sql`, the 20261094 migration, `supabase/SQL Scripts/20261094_…_rollback.sql`, and `cleanupFunctionVersion.generated.ts` (new stamp). **20261092 and its rollback are never touched** (they are pinned).

Before running the generator: `git diff --stat` must be clean of generated files. After it runs: `git diff --numstat` must show additions in the generated files and no deletion-only file (memory: agent file-write truncation hazard).

Scripts for the apply (paste-safe, read-only, one statement each, ending `ORDER BY checks.ord;`, 20261092 shape):
- `scripts/precheck-account-closures.sql`: one pre-check for both files (§9 step 3).
- `scripts/check-account-closures-migration.sql`: the checker after 20261093.
- `scripts/check-test-account-cleanup-account-closures-migration.sql`: the checker after 20261094, with an md5 information row.

---

## 7. Guards and tests

| # | Test | File | Asserts |
|---|---|---|---|
| T-1 | **Duplicate migration prefix (SR-7)** | `supabase/migrations/__tests__/migrationNumberUnique.guard.test.ts` (new) | No two `supabase/migrations/*.sql` files with an 8-digit prefix ≥ `20261093` share a prefix. A fixture proves it fails on a planted pair and ignores the known duplicates below 20261093. One `readdirSync`, so it adds no CI time |
| T-2 | Migration 20261093 static checks | `supabase/migrations/__tests__/business-os-account-closures.migration.test.ts` (new) | RLS on, no `CREATE POLICY`, the REVOKE/GRANT lines, the partial unique index over exactly `OPEN_CLOSURE_STATUSES`, status CHECK = `CLOSURE_STATUSES`, language CHECK = `STATEMENT_LANGUAGES`, `15 minutes` = `REQUESTING_SETTLE_MINUTES`, session-cut `SECURITY DEFINER` + search_path + 42501 + `p_user_id::text` on refresh tokens, no `into` in prose, no `SELECT … INTO` |
| T-3 | `AccountClosureRepository` | `lib/repositories/__tests__/AccountClosureRepository.test.ts` | Every method: happy path and error path. `user_id` filter on scoped methods. An injected `id` / `status` / `user_id` in input is dropped. A transition outside the map makes no DB call. 23505 → `already_open`. The claim result is Zod-parsed. A double claim modelled as a disjoint batch (skill test) |
| T-4 | `AccountLockRepository` | `lib/repositories/__tests__/AccountLockRepository.test.ts` | Exact `ban_duration` values; ban and unban refuse a tombstone (both signals) and make no admin call; the email never appears in log calls; 42501 → `not_closing` |
| T-5 | Callers guards | `lib/repositories/__tests__/accountClosureRepositories.callers.guard.test.ts` | Only allow-listed files import either repository (tests only, for now) |
| T-6 | Descriptor and export classification | existing `exportClassification.test.ts`, `descriptors.invariant.test.ts`, `businessOwnedTables.test.ts` | Pass with the new rows (no edit expected) |
| T-7 | **Drift test regeneration** | `scripts/__tests__/testAccountCleanupSql.test.ts` | 20261092 pair moves from `APPLIED_TARGET` to `APPLIED` with its current hashes (`e858e9ae…`, `f86ef4e2…`). New `APPLIED_TARGET` pins once the bytes are final. l.514 expectation → 20261092. The 20261092 describe block is re-pinned to **literals** (`ec34d5604055abfe`, the 92 file, `PRECHECK_92` / `CHECKER_92`) because it currently reads `CLEANUP_FUNCTION_VERSION` and `migrationSql`, which now mean 20261094. New 20261094 block: chains on 20261092 (stamp in previous file and rollback), the closure table is in step B of both modes and not in `KEEP_SET`, new stamp ≠ `ec34…`, pre-check and checker contents, md5 row |
| T-8 | **`no-deletion-paths` family 4 (SR-3)** | `lib/business-os/purge/__tests__/no-deletion-paths.guard.test.ts` | `SQL_LOGIN_DELETE_ALLOW_LIST`: add 20261081 as named history (it stops being `PREVIOUS_MIGRATION_FILE`). `SQL_AUTH_WRITE_ALLOW_LIST`: add explicit 20261081 history (it carries the auth writes, so "older applied versions hold none" would otherwise fail). Add the **20261093** session-cut file with **only** the `DELETE FROM auth.<table other than users>` shape. That needs a per-entry `shapes` field, because "every allow-listed file still holds each shape" today requires all three shapes. New negative fixture: a non-allow-listed `DELETE FROM auth.sessions` still fails |
| T-9 | Full suites before hand-over | — | `npm test -- scripts/__tests__/testAccountCleanupSql.test.ts lib/business-os/purge lib/business-os/data-export lib/business-os/__tests__ lib/repositories/__tests__ supabase/migrations/__tests__`, then `npm test`. `npm run lint`. `npx tsc --noEmit` on touched files with `NODE_OPTIONS=--max-old-space-size=8192`, checking the tool's exit code. No `business-os-entitlements` import, so `test:bos-entitlements` is not needed (re-confirmed with grep) |

---

## 8. Read-only SQL for TL (schema check)

Each query is one read-only `SELECT`. TL pastes the results here before Task 3 is finalised. The word "into" is avoided (Supabase SQL editor hazard).

```sql
-- Q-1 nothing named like this exists yet
SELECT pg_catalog.to_regclass('public.business_os_account_closures') AS closures_table,
       pg_catalog.to_regprocedure('public.business_os_account_closures_claim_due(uuid, integer, integer)') AS claim_fn,
       pg_catalog.to_regprocedure('public.business_os_account_closure_cut_sessions(uuid)') AS cut_fn;
```

```sql
-- Q-2 the auth columns the session cut compares
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'auth' AND table_name IN ('sessions', 'refresh_tokens')
  AND column_name IN ('id', 'user_id', 'session_id', 'revoked', 'not_after')
ORDER BY table_name, column_name;
```

```sql
-- Q-3 foreign keys of refresh_tokens and mfa_amr_claims to sessions, with their delete action
SELECT rel.relname AS child, con.conname, con.confdeltype
FROM pg_catalog.pg_constraint AS con
JOIN pg_catalog.pg_class AS rel ON rel.oid = con.conrelid
JOIN pg_catalog.pg_namespace AS nsp ON nsp.oid = rel.relnamespace AND nsp.nspname = 'auth'
WHERE con.contype = 'f' AND con.confrelid = pg_catalog.to_regclass('auth.sessions');
```

```sql
-- Q-4 the definer (postgres) may delete from both auth tables
SELECT pg_catalog.has_table_privilege('postgres', 'auth.sessions', 'DELETE') AS sessions_delete,
       pg_catalog.has_table_privilege('postgres', 'auth.refresh_tokens', 'DELETE') AS refresh_delete;
```

```sql
-- Q-5 the live cleanup function is 20261092 (precondition SR-4)
SELECT position('ec34d5604055abfe' in p.prosrc) > 0 AS is_20261092
FROM pg_catalog.pg_proc AS p
WHERE p.oid = pg_catalog.to_regprocedure('public.operator_test_account_cleanup(text, text, text, text, uuid, text, uuid, jsonb)');
```

```sql
-- Q-6 triggers on auth.users that fire on UPDATE (a ban updates banned_until)
SELECT trg.tgname, pg_catalog.pg_get_triggerdef(trg.oid) AS def
FROM pg_catalog.pg_trigger AS trg
WHERE trg.tgrelid = pg_catalog.to_regclass('auth.users') AND NOT trg.tgisinternal;
```

```sql
-- Q-7 the billing and preference columns DL-1b and DL-3 will read (names only, rule 6 of the schema skill)
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND ((table_name = 'business_os_billing_accounts' AND column_name IN ('user_id', 'livemode', 'subscription_status', 'current_period_end', 'cancel_at_period_end', 'ended_at'))
    OR (table_name = 'user_preferences' AND column_name IN ('user_id', 'timezone')))
ORDER BY table_name, column_name;
```

```sql
-- Q-8 anon and authenticated may not create objects in public (both migrations refuse otherwise)
SELECT pg_catalog.has_schema_privilege('anon', 'public', 'CREATE') AS anon_create,
       pg_catalog.has_schema_privilege('authenticated', 'public', 'CREATE') AS auth_create;
```

```sql
-- Q-9 no migration row or object already claims 20261093 or 20261094 (if the history table is used)
SELECT version FROM supabase_migrations.schema_migrations WHERE version >= '20261093' ORDER BY version;
```

```sql
-- Q-10 (spike only) one login by email: id, ban, session and live token counts. Replace the email
SELECT u.id, u.banned_until,
  (SELECT count(*) FROM auth.sessions AS s WHERE s.user_id = u.id) AS sessions,
  (SELECT count(*) FROM auth.refresh_tokens AS t WHERE t.user_id = u.id::text AND NOT t.revoked) AS live_refresh_tokens,
  EXISTS (SELECT 1 FROM public.admin_users AS a WHERE a.user_id = u.id) AS is_admin,
  EXISTS (SELECT 1 FROM public.business_profiles AS b WHERE b.user_id = u.id) AS has_business
FROM auth.users AS u
WHERE lower(u.email) = lower('name+closurespike@example.com');
```

Q-9 errors harmlessly if migrations are applied by hand and the history table is absent; the coordination file and `origin/main` remain the reservation record (C-8).

---

## 9. Prod apply plan

A manual prod gate. The user, or TL with the user's go-ahead, applies the SQL. **Admin deletes and test-account cleanup pause from step 4 (the 20261093 apply) until the 20261094 build is live** (SA F-A: the live 20261092 G-10 does not know the new link to the login), so steps 3 to 9 run in one sitting. If step 6 raises, fix forward in the same sitting or roll 20261093 back at once.

| # | Step | Who | Stop if |
|---|---|---|---|
| 1 | SA code review ✅, QA ✅, user has seen the diff and approved (standing rule) | TL | any not done |
| 2 | **SR-5 pre-apply check.** (a) Branch rebased on current `origin/main` (by RM; this session never rebases or stashes), CI green. (b) `git show origin/main:scripts/generate-test-account-cleanup-sql.ts` shows `FUNCTION_MIGRATION = '20261092_operator_test_account_cleanup_meeting_links'`, which equals our `PREVIOUS_FUNCTION_MIGRATION`. (c) `origin/main` and the coordination file hold no other 20261093 / 20261094 file. (d) The coordination lock is still DL-1a's | TL | any mismatch: re-regenerate on the new main with new numbers |
| 3 | Run `scripts/precheck-account-closures.sql` | user / TL | any FAIL. Rows: table and functions absent; live cleanup stamp `ec34d5604055abfe`; new stamp absent; Q-2 types; Q-4 privileges; Q-8 |
| 4 | Apply `20261093_business_os_account_closures.sql` | user | an exception (it rolls back as one transaction) |
| 5 | Run `scripts/check-account-closures-migration.sql` | user / TL | any FAIL in rows 1 to 12 (row 12: all twelve named CHECKs exist). Row 13 is information: FAIL until 20261094 is live is expected (W-1) |
| 6 | Apply `20261094_operator_test_account_cleanup_account_closures.sql` | user | an exception |
| 7 | Run `scripts/check-test-account-cleanup-account-closures-migration.sql` | user / TL | any FAIL in rows 1 to 8, **or row 9 (md5) not `ok`** (SA CR-2). A row 9 FAIL is resolved before the merge by comparing the pasted bytes (line endings) with the PR head, never ignored |
| 8 | **Enqueue the PR at once** (manual merge: migration-gated, so not auto-merge) | user / RM | CI red: run rollback §10 for 20261094 if the merge cannot land within the session |
| 9 | After the Vercel deploy: `/admin/users` → Danger Zone **check** on a `+test` account answers with no `function_out_of_date` (the coordination file's "checker green") | TL / QA | `function_out_of_date` persists past the deploy |
| 10 | Release the lock in the coordination log and send `[DELETE→EXPORT] DL-1a merged + applied` to the EXPORT session (next: MX-1a) | TL | — |

---

## 10. Rollback

| Undo | How | Effect |
|---|---|---|
| 20261094 | `supabase/SQL Scripts/20261094_operator_test_account_cleanup_account_closures_rollback.sql` (generated; restores the 20261092 function byte for byte, stamp `ec34…`) **and** revert the PR | The check and E answer `function_out_of_date` until code and DB agree again. That fails closed. **A 94-only rollback still blocks every check and delete on G-10** while the 93 table exists (SA F-A), so a full restore is: 94 rollback → 93 rollback → PR revert |
| 20261093 | `supabase/SQL Scripts/20261093_business_os_account_closures_rollback.sql` (hand-written): refuses if the table holds any row, then drops the session-cut function, the claim function and the table | Run **after** the 20261094 rollback. Safe while DL-1b is unshipped, because nothing writes the table |
| Spike | `ban_duration: 'none'` (step 9) | The test login signs in again |

---

## 11. Files to create / modify

| File | Action | Reason |
|---|---|---|
| `supabase/migrations/20261093_business_os_account_closures.sql` | create | §4 |
| `supabase/SQL Scripts/20261093_business_os_account_closures_rollback.sql` | create | §10 |
| `supabase/migrations/20261094_operator_test_account_cleanup_account_closures.sql` | create (generated) | §6 |
| `supabase/SQL Scripts/20261094_operator_test_account_cleanup_account_closures_rollback.sql` | create (generated) | §6, §10 |
| `scripts/test-account-cleanup-check.sql`, `scripts/test-account-cleanup-delete.sql` | modify (generated) | the pasted SQL follows the plan |
| `lib/business-os/test-account-cleanup/cleanupFunctionVersion.generated.ts` | modify (generated) | new stamp |
| `scripts/generate-test-account-cleanup-sql.ts` | modify | §6 constants, step-B entry |
| `scripts/precheck-account-closures.sql`, `scripts/check-account-closures-migration.sql`, `scripts/check-test-account-cleanup-account-closures-migration.sql` | create | §9 |
| `lib/business-os/account-deletion/closureLifecycle.ts` | create | §5.1 |
| `lib/repositories/AccountClosureRepository.ts`, `lib/repositories/AccountLockRepository.ts` | create | §5.2, §5.3 |
| `lib/business-os/purge/descriptors.ts` | modify (add one row) | §5.4 |
| `lib/business-os/businessOwnedTables.ts` | modify (add one reason) | §5.4 |
| `scripts/__tests__/testAccountCleanupSql.test.ts` | modify | T-7 |
| `lib/business-os/purge/__tests__/no-deletion-paths.guard.test.ts` | modify | T-8 |
| `supabase/migrations/__tests__/migrationNumberUnique.guard.test.ts`, `supabase/migrations/__tests__/business-os-account-closures.migration.test.ts` | create | T-1, T-2 |
| `lib/repositories/__tests__/AccountClosureRepository.test.ts`, `AccountLockRepository.test.ts`, `accountClosureRepositories.callers.guard.test.ts` | create | T-3 to T-5 |
| `docs/runbooks/TEST_ACCOUNT_CLEANUP_RUNBOOK.md` | modify (one row) | version history: 20261094 |
| `lib/business-os/purge/__tests__/classification-baseline.json`, `descriptors.invariant.test.ts` | modify (add-only) | SA-S3 baseline: the new `never` row, count 161 → 162 |
| `lib/business-os/data-export/__tests__/exportClassification.test.ts` | modify (counts only) | 162 = 38 include + 0 planned + 124 exclude |
| `supabase/migrations/__tests__/business-os-credit-lots.migration.test.ts` | modify (add-only) | L8 allow-list: the 20261092 pair named literally, now that `MIGRATION_FILE` is 20261094 |
| `docs/requirements/BUSINESS_OS_ACCOUNT_DELETION_LIFECYCLE_REQUIREMENT.md` | modify (status line + spike result, after merge of the docs PR) | memory: "always update main requirement" |

---

## 12. Task list

- [ ] 1. **GoTrue spike** (§3): ✅ Dev wrote the scratch script (not run, see §3.4); TL runs it after the user's explicit OK; results in §3.4; SA confirms keep or drop.
- [x] ✅ 2. TL runs §8 Q-1 to Q-9 and pastes the results here; Dev adjusts §4 if any fact differs.
- [x] ✅ 3. TL confirms O-1 (numbers) in the coordination file: 20261093 = schema, 20261094 = regeneration.
- [x] ✅ 4. `closureLifecycle.ts` constants.
- [x] ✅ 5. Migration 20261093 + its rollback + T-2.
- [x] ✅ 6. T-1 duplicate-prefix guard (with fixtures).
- [x] ✅ 7. `AccountClosureRepository` + T-3.
- [x] ✅ 8. `AccountLockRepository` + T-4 (without `cutSessions` if the spike drops it).
- [x] ✅ 9. Callers guard T-5.
- [x] ✅ 10. Descriptor row + `USER_OWNED_TABLES` reason; T-6 green.
- [x] ✅ 11. Generator constants + step-B entry; run the generator; `git diff --numstat` check.
- [x] ✅ 12. Drift test T-7 (history move, 92 block re-pinned to literals, new 94 block, `APPLIED_TARGET` pins last).
- [x] ✅ 13. `no-deletion-paths` T-8 (per-entry shapes, 20261081 history, 20261093 entry).
- [x] ✅ 14. Pre-check and two checker scripts, with their paste-safety assertions in T-7.
- [x] ✅ 15. Runbook row; full test, lint and type runs (T-9); `console.*` check on every touched file.
- [ ] 16. Hand over to SA for code review; leave the changes uncommitted (standing rule).

**Estimate:** 2 d (SA XC-17), of which the spike is about 0.25 d of elapsed time and depends on the user's OK and a `+test` invite. Regeneration and test re-pinning is the largest part (about 0.75 d).

---

## 13. Risks

| # | Risk | Mitigation |
|---|---|---|
| K-1 | EXPORT's MX-1a regenerates from a stale branch while DL-1a is open | S-1 lock held; SR-5 pre-apply check step 2(b); CI conflicts on the same generator lines |
| K-2 | Applying **20261093** pauses admin deletes (G-10) until the 20261094 build is live (SA F-A) | Steps 3 to 9 in one sitting; full restore order 94 → 93 → revert |
| K-3 | The spike disturbs a real account | `+test` only, S-0 baseline must show no admin, no business; user OK first; unban last |
| K-4 | `refresh_tokens.user_id` type differs on prod | Q-2 and the in-migration pre-guard raise before anything is created |
| K-5 | An `auth.users` UPDATE trigger reacts to the ban (Q-6) | Reviewed before DL-4 wires the ban; DL-1a only adds the seam |
| K-6 | Generator writes a truncated file | `git diff --numstat` after every generated write; drift test |
| K-7 | Another stream takes 20261093/94 without reading the coordination file | T-1 fails CI on a shared prefix; re-check `origin/main` at PR open (C-8) |

---

## 14. Open items for SA

| # | Item | Dev default |
|---|---|---|
| O-1 | Numbering: 20261093 schema, 20261094 regeneration (instead of 20261093 = regeneration) | Yes, schema first (D-1) |
| O-2 | Descriptor `never` + step-B removal in both modes, rather than `purge` | `never` (D-2) |
| O-3 | `FUNCTION_REQUIRED_TABLES` not extended (dynamic step-B SQL) | Not extended (D-3); add if SA prefers the C-8 reasoning |
| O-4 | Claim RPC `SECURITY INVOKER` with the lease in the predicate and no separate reap RPC; a lease floor in SQL? | INVOKER, no reap RPC, no SQL floor (D-5) |
| O-5 | The session-cut function checks an open `grace` / `locked` row itself | Yes (D-7) |
| O-6 | Two repositories, outside the barrel, with a callers guard; not an extension of `AuthAccountRepository` | Yes (D-8) |
| O-7 | Extra columns `lock_timezone`, `next_check_at`, `last_error_code`, `blocked_email_sent_at` | Add (D-9) |
| O-8 | `closed` status: XC-1 lists it, but at E the engine deletes the row. Keep it in the CHECK as reserved, unwritten? | Keep, document "never written in this stream" |
| O-9 | `blocked_codes` element CHECK pattern (§4.1) | As written |
| O-10 | The spike runs on prod `auth` (the only database) after the user's OK | As in §3.1 |

---

## SA Review Notes

*(SA populates)*

## SA Workplan Review — 2026-10-25

**Reviewed by SA — 2026-10-25** (worktree `neuronforge-dl1a` on `7e51af5b`; requirement on `docs/bos-self-service-exit`; coordination file and TL's Q-1 to Q-9 results below read)
**Status:** ⚠️ Approved with conditions W-1 to W-13. Task 1 (the spike) needs the user's explicit in-session OK first. Tasks 4 to 16 start only after SA has confirmed the §3.4 result (W-11).

### What was checked

The generator (`FUNCTION_MIGRATION` = 20261092, `PREVIOUS` = 20261081, `FUNCTION_REQUIRED_TABLES`, `FULL_REMOVAL_EXTRAS`, the plan loop's `to_regclass … CONTINUE`, the G-10 `fk_catalog` / `fk_review` CTEs). The drift test (`APPLIED_TARGET` on the 92 pair, and the 20261092 describe block l.1435–1520, which reads `CLEANUP_FUNCTION_VERSION`, `migrationSql`, `rollbackSql` and `previousMigrationSql`). `no-deletion-paths.guard.test.ts` family 4 (l.104–219 and l.473–520). `descriptors.ts` (`never`, `EXPORT_REASON`). The "only extends `never` descriptors" test. The `authAccountRepository.callers.guard.test.ts` precedent (including CR-2). The 20261074 grant and INVOKER shape. The skills `durable-queue-drain`, `new-repository` and `tenant-isolation-guard`.

Every code finding Dev lists is **confirmed**: per-entry `shapes` is needed (today every entry must hold all three shapes), 20261081 must become a literal entry in both lists, the 92 block has to be re-pinned to literals, and `FUNCTION_REQUIRED_TABLES` does not need the table (the dynamic loop skips an absent table). On the duplicate prefixes: 20261077 to 20261081 each already exist twice in `supabase/migrations/`, so SR-7 is needed. TL's Q-2 to Q-6 results match §4.3 and §4.4: `refresh_tokens.user_id` is varchar, so `= p_user_id::text` compares correctly; both session FKs CASCADE; `postgres` may DELETE; no `auth.users` UPDATE trigger (K-5 closed). Q-5 meets the SR-4 precondition.

### New finding (changes §9, §10 and K-2)

**F-A. Admin deletes and test-account cleanup pause from step 4, not step 6.** When 20261093 is applied, it adds `business_os_account_closures.user_id → auth.users`. The live 20261092 function's G-10 (`fk_catalog` against `fk_review`) does not know that foreign key, so `kind IS NULL`, and every check and delete refuses ("A link to the login nobody has reviewed") until 20261094 is live. That fails closed and is harmless. But it means (a) steps 3 to 7 run in one sitting, (b) if step 6 raises, either fix forward in the same sitting or roll 20261093 back at once, and (c) rolling back 20261094 **alone** leaves G-10 blocking. A full restore is: the 94 rollback, then the 93 rollback (safe while the table is empty), then the PR revert.

### Conditions

| # | Condition | Where |
|---|---|---|
| **W-1** | Correct §9 (the pause window starts at step 4, and steps 3 to 7 run in one sitting), K-2, and §10 (a 94-only rollback still blocks on G-10, so a full restore is 94 rollback → 93 rollback → revert) per F-A. The 93 checker gets one information row: "until 20261094 is live, every check refuses with G-10 on this table; expected". | §9, §10, §13 |
| **W-2** | **Claim RPC lease (O-4):** drop `p_lease_seconds`. Use the literal `interval '90 seconds'` in the predicate, pinned by T-2 to `CLOSURE_LEASE_SECONDS`, the same way `15 minutes` is pinned to `REQUESTING_SETTLE_MINUTES`. That keeps `LANGUAGE sql` with no wrapper, and no caller can pass a lease shorter than `maxDuration`. | §4.2, §5.1, T-2 |
| **W-3** | **Session-cut self-check (O-5), tightened:** refuse with 42501 unless the user has a row with `status = 'locked'` **or** `status = 'grace' AND lock_at <= now()`. A `grace` row before its lock date must not let anyone end sessions. A NULL `p_user_id` is also refused with 42501. T-2 pins the predicate. | §4.3, T-2 |
| **W-4** | **The lock seam checks itself, as the SQL function does** (tenant-isolation-guard: a service-role path with a caller-supplied id). `banLogin(userId)` first reads the closure row on the server and refuses (no admin call) unless the W-3 predicate holds. `unbanLogin(userId)` refuses unless the user's latest closure row is `locked`, or `kept` with `kept_source = 'admin'` (so a retry after the transition works). Both keep the tombstone refusal. Add the third tombstone signal of F-2: `banned_until` more than 99 years out. T-4 covers each refusal, with no admin call made. | §5.3, T-4 |
| **W-5** | **Transitions:** add `requesting → grace` (a free account starts C at once: §3.1, XC-2). Take the pseudo-state `deleted` out of `ALLOWED_TRANSITIONS`: `deleteRequesting` is its own method. `updateClaimed` that changes `status` must take `from`, apply `.eq('status', from)`, and check the same map before any DB call. | §5.1, §5.2, T-3 |
| **W-6** | **O-8: drop `closed`.** Remove the status from the CHECK and from `CLOSURE_STATUSES`, along with the `closed_at` column, its row CHECK and `locked → closed`. Under XC-1 the engine deletes the row at E, inside its own transaction, so `closed` can never be stored. A reserved state that nothing writes is a trap for DL-5. `closed_email_*` stays (that is the stage-D email). **SA amendment XC-1a:** the terminal statuses are `kept` only, and "closed" is the absence of the row plus the receipt. TL routes the splice to BA (XC-1 note in both the lifecycle and parent requirements). | §4.1, §5.1 |
| **W-7** | **T-8 `shapes`, asserted both ways:** each `SQL_AUTH_WRITE_ALLOW_LIST` entry holds **exactly** its listed shapes and none of the others. So the 93 file is pinned to `DELETE FROM auth.<not users>` only, and a later edit or comment adding `UPDATE auth.users` fails. 20261093 goes in the auth-write list only, never in `SQL_LOGIN_DELETE_ALLOW_LIST`. 20261081 becomes a literal entry in both lists, and 20261092 moves to `PREVIOUS_MIGRATION_FILE`. "Older applied versions hold none" must still pass for 77, 75, 47, 46, 43, 42 and 41. Keep the negative fixture (`DELETE FROM auth.sessions` in a file that is not allow-listed fails). | T-8 |
| **W-8** | **T-7:** in the 20261092 block, re-pin **every** moving reference to a literal: the 92 migration and rollback read by literal path, 81 as its previous file, stamp `ec34d5604055abfe`, `PRECHECK_92` / `CHECKER_92`, and the md5 body sliced from the literal 92 file. The new 94 block mirrors that shape. The order is a history move first, then the new pins last, once the bytes are final (as Dev planned). | T-7 |
| **W-9** | **T-1 (SR-7):** the version is the whole leading token before the first `_`. Every file whose first 8 digits are ≥ `20261093` must have **exactly** 8 digits with no letter suffix (which refuses `20261095b_` and a 14-digit `20261101120000_`), and must be unique. Also refuse a `supabase/held/*.sql` file that shares a ≥ 20261093 prefix with `supabase/migrations/`. The real duplicates (20261077 to 20261081) stay out of scope, and a fixture proves it. | T-1 |
| **W-10** | **T-5 includes CR-2:** the names of both SQL functions, `.from('business_os_account_closures')` and `ban_duration` may appear only in the repository files, their tests, the guard and the migration and rollback files. The scan covers `app`, `lib`, `components`, `hooks`, `scripts` and `supabase/`, in `.ts`, `.tsx`, `.js`, `.mjs` and `.sql` files. (`lib/utils/onboarding-check.ts` calls `updateUserById` without a ban, so scan `ban_duration` only, not `updateUserById`.) | T-5 |
| **W-11** | **Spike conditions** (see "Spike ruling" below). SA confirms §3.4 before Task 5. | §3 |
| **W-12** | **Apply (SR-5):** the SR-4 precondition is met (Q-5, `ec34…` live). Apply the bytes of the **rebased PR head** that CI ran green. The 94 checker's md5 row must match the committed body. If `origin/main` moved after the rebase, repeat step 2 before step 3. | §9 |
| **W-13** | **O-9 `blocked_codes` CHECK without a helper function:** `cardinality(blocked_codes) <= 20 AND array_position(blocked_codes, NULL) IS NULL AND array_to_string(blocked_codes, ',') ~ '^(([A-Z]-[0-9]{1,2}[a-z]?|[a-z_]{1,40})(,|$))*$'`. A CHECK cannot run a subquery, and a new function would be one more object to review. T-2 pins it. Also add `lock_timezone` length ≤ 64. | §4.1 |

### O-rulings

| # | Ruling |
|---|---|
| O-1 | ✅ 20261093 = table + claim + session cut; 20261094 = regeneration. Both are reserved in the coordination file. The lower number applies first (74→75, 80→81). |
| O-2 | ✅ `never` + step B in both modes. Step B is not in `KEEP_SET`, so the anonymise removes the row too, and the "only extends `never` descriptors" test holds. Purge and Reset must not cancel a request. |
| O-3 | ✅ Not extended. The loop skips an absent table with `to_regclass … CONTINUE` and names it only as a `VALUES` literal. Apply order is enforced by §9 (the 93 checker before step 6). |
| O-4 | ✅ INVOKER, service_role-only EXECUTE (20261074 shape); the lease in the predicate is the reaper; no dead-letter (a row must end in lock or kept). Lease as a SQL literal (W-2). This is a ruled deviation from `durable-queue-drain` Steps 2 and 3, so cite this review in the migration header and the repository doc-comment. |
| O-5 | ✅ with W-3. Self-check in SQL; SECURITY DEFINER, owner `postgres`, `search_path` pinned, auth tables fully qualified. XC-21 already rules it an approved rule-7 exception. |
| O-6 | ✅ Two repositories, outside the barrel (S-16 / SR-11, `AuthAccountRepository` precedent), each with a callers guard (W-10). The `new-repository` "types in `types.ts` / barrel export" items are waived by S-16. Every other checklist item applies. |
| O-7 | ✅ All four columns. `blocked_email_sent_at` = one blocked email per row (BQ-22). |
| O-8 | ❌ Do not keep it reserved. Drop `closed` and `closed_at` (W-6, XC-1a). |
| O-9 | ✅ The pattern as written, in the W-13 form. |
| O-10 | ✅ On prod `auth`, under the spike ruling below, only after the user's explicit OK. |

### Spike ruling (O-10, W-11)

The design is safe, minimal and reversible, once these are added.

1. **Target.** One `+test` login used for the spike only, that no other session's or QA's test is using (a ban would break theirs). S-0 must show: an email that matches the cleanup's test-tag predicate (G-1), not an admin, and no live-mode billing row. A `business_profiles` row is acceptable if the invite flow creates one (a ban touches only the login). Prefer none.
2. **Script guards.** The password is read from an environment variable or a prompt, never from argv. The script refuses unless the target email matches the test-tag predicate **and** `getUserById` returns the S-0 id. Step 9's unban runs in a `finally`, so a failure partway always unbans. After the step-9 sign-in, a final global sign-out leaves no live session. Output is status codes and error codes only.
3. **Record.** Record the GoTrue version (`GET /auth/v1/health`), timestamps, and steps 4 to 6 for **both** clients A and B.
4. **Decision evidence.** **Drop** the function only if, within 5 s after step 3: zero `auth.sessions` rows **and** zero non-revoked `refresh_tokens` for the user, **and** `getUser` fails with a session error for **both** access tokens, **and** step 6 is refused. Anything less (including tokens revoked while the session rows stay) means **keep**. Step 8 not ending the old token means stop and escalate, as §3.3 says.
5. **Optional step 5b** (no weight in the decision). After step 8, one PostgREST read with access token A. It shows whether JWT-only RLS reads keep working until the token expires. DL-4 needs that for honest lock copy (C-9).
6. **User approval.** The user must OK it in the session, told that it writes to the **prod** auth schema: one 10-year ban and unban of that one login, plus its session rows.

### Standards

- **Rule 1 and new-repository:** ✅ with O-6.
- **Rule 2:** no route in this slice. The claim result is parsed with Zod (✅).
- **Rule 3:** Pino. Re-check `console.*` per file (✅ as planned).
- **Rule 4 and tenant-isolation:** ✅ with W-3 and W-4.
- **Rule 5:** no LLM.
- **Rule 6:** no `any` planned.
- **Rule 7:** ✅ for the INVOKER claim with the lease in its predicate (O-4), the definer session cut (XC-21) and the duplicate-prefix guard (SR-7).
- **Entitlements:** none. The T-9 grep confirms it.
- **CI:** pure Jest, so no added time.
- **SR-12:** the coordination log records the §11 splice as done and identical. TL keeps the byte-identity check.

### Optimisation suggestions (not blocking)

- **Descriptor reason.** `EXPORT_REASON.PLATFORM` reads "not this account's data". The request is the account's own process state. Pass the reason through `exclude(…)` with its own honest text (for example "the deletion request itself: process state shown in the app"), at DELETE's anchor.
- **`CLOSURE_EMAILS`** includes `blocked`, which the XC-13 `details.email` list does not. DL-3 decides whether the blocked email is logged as `ACCOUNT_CLOSURE_EMAIL_SENT` or only as `ACCOUNT_CLOSURE_BLOCKED`. No DL-1a change.
- **For DL-3 and DL-5:** with no dead-letter, set `next_check_at` back off after an error, and show `attempts` / `last_error_code` on the ready list, so that a stuck row is seen.
- **After merge:** add a short note to `durable-queue-drain` describing the "lease-in-predicate, INVOKER" variant ruled here.

### Approval

[x] Workplan approved with conditions W-1 to W-13. The spike runs only after the user's explicit OK. SA confirms §3.4 before Task 5. W-1 to W-10 and W-13 are folded into the workplan before code is written.

## Dev implementation notes — 2026-10-25

| # | Note |
|---|---|
| N-1 | Built with the session cut **kept** (the default) before the spike ran, on TL's instruction; SA's "tasks 4 to 16 after §3.4" is therefore open. The drop path is listed in §3.4 |
| N-2 | New stamp **`792d801e13101316`**. 20261094 sha256 `eb04be06…a169ea33`, rollback `9e79c08b…ef119dd`, function-body md5 `8c4fc3c2a7ef552a5785383230f1f548` (in the 94 checker row 9). Regenerate means re-pin all four |
| N-3 | W-1 to W-10 and W-13 are built as ruled; §4, §5.1, §9, §10 and K-2 above now say what was built |
| N-4 | `findLatestForUser` was added to `AccountClosureRepository`: the W-4 unban check needs the newest row in any state |
| N-5 | Three pinned counts outside §11 moved with the new descriptor (SA-S3 baseline, export totals, the credit-lots L8 list): add-only, listed in §11 |
| N-6 | `npx tsc --noEmit` reports 0 errors in the touched files (the repo carries ~1,850 errors elsewhere, untouched). ESLint clean on every touched file. No `console.*` in any touched file |
| N-8 | **SA code review applied (2026-10-25).** CR-1: `unbanLogin` accepts a `kept`/`admin` row only when `locked_at` is set; new T-4 case (kept by an admin, never locked: no admin call). CR-2: §9 step 7 makes the md5 row an operator gate. Optional tightenings taken: the `blocked_codes` CHECK also refuses an empty element (`array_position(blocked_codes, '') IS NULL`) and a comma inside an element (the split count equals the cardinality); the 93 rollback takes `LOCK TABLE … IN ACCESS EXCLUSIVE MODE` before the row count; the 93 checker gains row 12 (all twelve named CHECKs exist), so the G-10 information row is now row 13. These change the bytes of 20261093 and its rollback only. Nothing pins their sha, and 20261094 does not contain them, so the stamp `792d801e13101316`, the 94 sha256 pins and the md5 are unchanged |
| N-7 | The callers guard (W-10) matches `.from('business_os_account_closures')` as a literal, so the repository uses the literal, never a constant: a constant elsewhere would evade the scan |

## SA Code Review — 2026-10-25

**Code Review by SA — 2026-10-25** (worktree `neuronforge-dl1a`, branch `feature/account-closure-dl1a` on `7e51af5b`, uncommitted; the session-cut **keep** variant, spike not run)
**Status:** ⚠️ Code Approved for QA with conditions CR-1 to CR-3. CR-1 is a small code fix that can run in parallel with QA (QA re-runs T-4). Nothing is applied to prod until the spike has run and SA has confirmed §3.4 (CR-4).

### What was checked

- **20261093** read line by line: pre-guards, the table, 10 named CHECKs, 3 indexes, RLS with no policy, `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role` then 4 grants to service_role, the claim (INVOKER, `LANGUAGE sql`, the literals `interval '90 seconds'` and `interval '15 minutes'`, `p_runner IS NOT NULL`, batch clamped 1..100, `FOR UPDATE SKIP LOCKED`), the session cut (DEFINER, owner postgres, `search_path` pinned, auth tables fully qualified, NULL refused, W-3 predicate, 42501, sessions deleted by uuid and refresh tokens by `user_id::text`), and post-conditions 1 to 7. No `into` in any of the five hand-written SQL files (checked with grep).
- **The 93 rollback:** it refuses when the table is missing, when the live cleanup body still names the table, and when any row exists. Then it drops the cut, the claim and the table. ✅
- **The 94 vs 92 diff:** compared with ordinals and the stamp normalised. Only these differ: the header (purpose, rollback target), and per plan copy one step-B VALUES entry plus one `('public', 'business_os_account_closures', 'user_id', 'tenancy', NULL)` fk_review entry. The fk_review entry is what clears G-10 (F-A). The 94 rollback's function body is **byte-identical** to the 92 migration's body (same md5). The 92 pair is untouched and is now sha-pinned in `APPLIED`. ✅
- **Pre-check and the two checkers:** read-only, one statement each, end with `ORDER BY checks.ord;`. 93 row 12 is information only (W-1/F-A) ✅. The pre-check uses the `NOT EXISTS` form for the absent stamp ✅.
- **`closureLifecycle.ts`:** pure, no imports. No `closed` (W-6). The transitions are as W-5 rules (`requesting→grace` is in, `deleted` is gone). ✅
- **`AccountClosureRepository`:** service role documented. `user_id` filters on every per-account method. `insertRequesting` builds its payload field by field. Transitions are compare-and-set on status, refused before any DB call when outside the map. The patch goes through per-column Zod with a per-transition allow-list. Updates use `{ count: 'exact' }`, never `.select()`. The claim result is Zod-parsed. `findLatestForUser` (N-4) is scoped and newest first. `updateClaimed` is compare-and-set on `claimed_by` **and** `from` (W-5). Never throws. Pino, ids and codes only. ✅
- **`AccountLockRepository`:** W-4. Ban and unban read the closure state on the server **before** any admin call, then the login state. The three tombstone signals are there (placeholder email, `app_metadata.deleted`, a ban more than 99 years out). The email is never returned or logged. 42501 maps to `not_closing`. ✅ (CR-1 below)
- **Guards:** callers guard W-10 (6 rules incl. CR-2 strings, `.sql` and `supabase/` scanned, root files, stale-entry check, negative fixtures, barrel check) ✅. Duplicate-prefix W-9 (whole leading token, exactly 8 digits, held collision, out-of-scope fixture) ✅. `no-deletion-paths` W-7: per-entry `shapes` asserted both ways; 93 pinned to the non-users auth delete only and absent from the login-delete list; 20261081 literal in both lists; the "older versions hold none" set pinned to 41/42/43/46/47/75/77; the negative fixture is there ✅. Drift W-8: the 92 block is re-pinned to literals (`STAMP_92`, the literal 92 and 81 files, the md5 from the literal 92 body). The new 94 block mirrors it. History moved first, new pins last ✅.
- **Descriptor, ownership, counts:** `never`, user-scoped, `exclude` with its own honest reason (the SA optimisation was taken). `USER_OWNED_TABLES` reason. The baseline JSON, the invariant test and the export totals each go 161 → 162 (38 + 0 + 124). The credit-lots L8 list now names the 92 pair. All add-only ✅. The runbook row and the rollback order are correct ✅.

### Runs (SA, in the worktree)

| Run | Result |
|---|---|
| `jest scripts/__tests__/testAccountCleanupSql.test.ts` (generator drift) | 203 / 203 ✅ |
| Drift + `lib/business-os/purge` + `data-export` + `lib/business-os/__tests__` + the 3 new repository suites + `supabase/migrations/__tests__` | 127 / 128 suites, 4495 / 4497. The 2 failures are `lib/business-os/__tests__/bookingNextStep.test.ts`, which this diff does not touch. **They fail the same way in the main checkout**, so they are pre-existing / local, not DL-1a. QA confirms CI is green on the rebased head |
| `npm run test:bos-entitlements` | 311 / 311 suites, 9347 / 9347 ✅ (no entitlements import in the diff, confirmed by reading) |
| `npx tsc --noEmit` (8 GB) | 1847 errors repo-wide, **0 in DL-1a lines**. The only hit in a touched file, `exportClassification.test.ts:2027`, is on `origin/main` unchanged |
| `eslint` on the 12 touched code files | clean. No `console.*` in any touched file |

### Code Review Comments

1. `lib/repositories/AccountLockRepository.ts:191` — **CR-1.** `unbanLogin` accepts any newest row that is `kept` with `kept_source = 'admin'`, however old. An account an admin kept from `grace` (never locked), or kept months ago, therefore stays unbannable forever. That lifts any later ban that is not a tombstone (none exists today, but the seam must not depend on that). **Fix:** for the `kept` branch, also require `row.locked_at !== null`, meaning the row really was locked, which is the "retry after Keep" case W-4 meant. Add one T-4 refusal case: `kept`/`admin` with `locked_at` null makes no admin call. Priority: **Medium**. One line plus one test, before merge.
2. `supabase/migrations/20261093_business_os_account_closures.sql:110-112` — the W-13 CHECK, as SA wrote it, still accepts `[""]`, `["G-9", ""]` and a single element `"G-9,G-1"`, because `array_to_string` hides an empty element and a comma inside an element. The content stays code-shaped, never free text, and the repository's per-element Zod already refuses all three. So this is not a security gap. Optional before apply, since a CHECK is far cheaper now than as a later migration: add `AND array_position(blocked_codes, '') IS NULL AND cardinality(string_to_array(array_to_string(blocked_codes, ','), ',')) = cardinality(blocked_codes)`, and extend the T-2 pattern test. Priority: Low (SA's own W-13 gap).
3. `scripts/check-test-account-cleanup-account-closures-migration.sql` row 9 — **CR-2.** W-12 says the md5 row must match the committed body, but the row reads "information only, never a gate" (the 92 shape). **Fix (doc only):** §9 step 7 says row 9 must read `ok`. A FAIL is resolved before the merge by comparing the pasted bytes (line endings) with the PR head, never ignored. The row text may stay. Priority: Low.
4. `lib/repositories/AccountClosureRepository.ts`, `AccountLockRepository.ts` — no exported singleton (new-repository checklist). Accepted for DL-1a: there are no callers, and a lower-case singleton would slip past the class-name rules of the callers guard. **DL-1b / DL-4:** if a singleton is added, add its identifier to the callers-guard rules in the same PR. Priority: Low, no change now.
5. `isAllowedTransition` (`closureLifecycle.ts:60`) indexes a plain object with `from`, so a non-status string such as `'constructor'` would throw outside the repository's `try`. TS types block it, and every caller passes a code constant. DL-1b must never pass a client-supplied status into `transition` / `updateClaimed`. Priority: Low, note for DL-1b.

### Conditions

| # | Condition | When |
|---|---|---|
| **CR-1** | Comment 1: the `locked_at` requirement on the kept branch of `unbanLogin`, plus its T-4 case | Before merge. QA re-runs `AccountLockRepository.test.ts` |
| **CR-2** | Comment 3: §9 step 7 makes the md5 row an operator gate | Before apply |
| **CR-3** | **Serialise with EXPORT's MX-1a** (counts and regeneration). `exportClassification.test.ts` (2 `toHaveLength`, 1 `kinds`), `classification-baseline.json` `count`, `descriptors.invariant.test.ts` `baseline.count`, and the generator constants are the same lines MX-1a changes. If MX-1a adds exactly one table, both branches write `162` and git merges **cleanly**, leaving main wrong by one. Rule: MX-1a does not touch those lines, regenerate or reserve against `PREVIOUS = 20261092` until DL-1a is **merged to main** (the S-1 lock already says this). Then it rebases on main and counts from 162 (162 + N), with `PREVIOUS_FUNCTION_MIGRATION = 20261094`. The merge queue is the backstop, not the plan. TL repeats this in the `[DELETE→EXPORT]` release message | At lock release (§9 step 10) |
| **CR-4** | **Spike gate.** This approval covers the **keep** variant. The keep/drop result changes the bytes of 20261093, so **no prod apply before §3.4 is filled and SA has confirmed it.** If the result is **drop**: Dev removes exactly the §3.4 list, and SA re-reviews that diff (short pass: 93 bytes, the rollback line, checker rows 9–10, pre-check row 7, the `SQL_AUTH_WRITE_ALLOW_LIST` entry, the callers-guard rule, the T-2/T-4 cut tests). QA then re-runs the 93 replica set. If step 8 does not end the old token: stop and escalate (§3.3) | Before §9 step 1 |

`origin/main` has moved two PRs (#506 docs, #507 credits resize) since `7e51af5b`. Neither touches a DL-1a file, a descriptor or the generator inputs, so the stamp should not move. RM rebases per SR-5 and re-runs the drift test, and if it changes, every N-2 pin is re-pinned.

### Optimisation Suggestions

- 93 rollback: take `LOCK TABLE public.business_os_account_closures IN ACCESS EXCLUSIVE MODE` before the row count, so a write cannot slip between the count and the `DROP` once DL-1b ships.
- 93 checker: one row confirming the named CHECK constraints exist (`status_check`, `blocked_codes_shape`, `kept_shape`), so a hand-edited paste cannot drop one without notice. Post-conditions do not cover them either.
- `TRANSITION_COLUMNS` could reject a transition whose required columns are missing (for example `→kept` without `kept_at`/`kept_source`) before the DB raises 23514. The DB is the authority, so this only gives a better error code. For DL-1b.
- `generate-test-account-cleanup-sql.ts`: the last `ROLLBACK_CONSEQUENCE` element has no trailing comma (style).

### What QA must exercise (pre-apply, PGlite or local-Postgres replica, DE-10b.1 style)

1. **Replica set-up:** stub `auth.users`, `auth.sessions(user_id uuid)`, `auth.refresh_tokens(user_id varchar, session_id uuid FK → sessions ON DELETE CASCADE)` and `auth.mfa_amr_claims` (CASCADE). Roles `anon`, `authenticated`, `service_role` (**BYPASSRLS**, as on Supabase). Owner `postgres`. A 92 cleanup function body carrying `ec34d5604055abfe`, or the real 92 file if the replica can run it.
2. **20261093 pre-guards:** each one refuses and creates nothing (anon CREATE on public; the table already exists; `refresh_tokens.user_id` as uuid). Then a clean apply with all 7 post-conditions passing. **Key risk:** the post-condition-4 `indexdef LIKE` text must match the replica's PG version formatting.
3. **CHECKs:** every named constraint refuses its violation (`closed` status, `fr`, `Bad` reason, kept shape both ways, grace without `lock_at`, locked without `locked_at`, claim pair, 21 codes, a NULL element, free text, 65-char zone, negative counts). The one-open index: a second open row gives 23505, and a new `requesting` row after `kept` is allowed.
4. **Claim as service_role:** a `requesting` row under 15 min is skipped and an older one is claimed; `locked`/`kept` are never claimed; a future `next_check_at` is skipped; claimed 60 s ago is not reclaimable, 91 s ago is; `attempts` is bumped; `p_runner` NULL returns 0 rows; `p_batch` NULL/0/1000 is clamped. Two sessions get disjoint batches (if the harness has two connections). As `anon` / `authenticated`: permission denied.
5. **Session cut:** NULL, no row, `pending`, and `grace` with a future `lock_at` each give **42501**. `grace` past its lock and `locked` delete that user's sessions, their cascaded tokens **and** an orphan token with `session_id` NULL. Another user's rows are untouched. The counts are returned. `anon` / `authenticated` EXECUTE is denied.
6. **Scripts:** the pre-check is all `ok` before 93 and fails rows 1/2 after it. The 93 checker shows rows 1–11 `ok`, row 12 FAIL before 94 and `ok` after. The 94 checker shows rows 1–8 `ok` and the md5 row `ok` on the committed bytes.
7. **F-A proof:** with 93 and 92 live, a test-account check refuses on G-10. With 94 live, the check passes, and both the hard delete and the anonymise remove a `+test` account's closure row (step B count reported).
8. **Rollback order:** the 93 rollback with 94 live refuses. The 94 rollback restores 92 (stamp `ec34…`, md5 equal to the 92 body), after which G-10 refuses again. The 93 rollback with a row refuses. Empty, it drops the three objects. Then the 92 check works again.
9. **Jest:** the full suite on the rebased head (confirm the `bookingNextStep` failure is local / pre-existing), and CR-1's new T-4 case.
10. No live auth call. There is no caller in DL-1a, and the spike is TL's job under the user's OK.

### Code Approved for QA: Yes, with conditions CR-1 (before merge), CR-2 (before apply), CR-3 (at lock release) and CR-4 (spike: no apply before SA confirms §3.4; a drop needs a short SA re-review)

## QA Testing Report

*(QA populates)*

## QA Report — 2026-10-25 (pre-apply)

**QA — 2026-10-25** (worktree `neuronforge-dl1a`, branch `feature/account-closure-dl1a` on `7e51af5b`, uncommitted, the session-cut **keep** variant)
**Test mode:** full (SA Code Review "What QA must exercise", items 1–9)
**Strategy used:** B + C. A **local replica** on a real PostgreSQL server (embedded-postgres **17.10**, plus a **15.18** formatting check), not PGlite. A real server gives several connections, so `FOR UPDATE SKIP LOCKED` could be tested concurrently. The public schema was rebuilt from the DE-10b.1 prod introspect shape. The auth stub matches Q-2/Q-3: `refresh_tokens.user_id varchar(255)`, `session_id` FK → `sessions` ON DELETE CASCADE, `mfa_amr_claims` CASCADE. Roles: `anon`, `authenticated`, `service_role` BYPASSRLS. Owner `postgres`, with the Supabase default privileges (ALL on new tables and functions to the three roles). The real repo migrations were applied in the prod order 41 → 77 → 80 → 81 → **92** (live stamp `ec34d5604055abfe`), then 93 and 94. Jest (A) ran in the worktree.
**Focus:** schema, security, api (repositories)
**Skipped:** the GoTrue spike and any live auth call (item 10, CR-4: TL's job, under the user's OK). No prod or Supabase connection was made.
**Input source:** prompt keywords (TL brief) + SA Code Review item list
**Harness (scratchpad, not in git):** `…\scratchpad\dl1aqa\epg\qa.mjs` (+ `lib.mjs`, `seed.mjs`, `auth_ddl.part`), `…\scratchpad\dl1aqa\epg15\pg15.mjs`. Outputs: `…\scratchpad\dl1aqa\out4.txt`, `out_pg15.txt`. Re-run: `node qa.mjs <empty data dir>` (about 1 min).
**Bytes tested** (sha256 prefix, LF): 93 `21201dca63603e58`, 93 rollback `071b7c79ad406dfa`, 94 `eb04be0682923bfe` (= N-2), 94 rollback `9e79c08b2c55e7ed` (= N-2). W-12: the applied bytes must be these, or the rebased PR-head bytes after a re-run of this harness.

### Test Coverage

| SA item | Acceptance criterion | Tested? | Result | Notes |
|---|---|---|---|---|
| 1 | Replica: auth stub per Q-2/Q-3, BYPASSRLS service_role, owner postgres, live 92 | ✅ | Pass | 92 check on a `+test` account: `ec34…` OK. Pre-check (before 93): 8/8 `ok`, also inside a `READ ONLY` transaction |
| 2 | 93 pre-guards refuse and create nothing | ✅ | Pass | 10 cases: anon / authenticated / PUBLIC CREATE on public; table exists (the planted table is untouched); claim function exists; cut function exists; `refresh_tokens.user_id` uuid; `sessions.user_id` text; `auth.sessions` / `auth.refresh_tokens` missing. Each refused with its own message and left 0 new objects. **Not exercisable:** "postgres may not DELETE on auth" (postgres is a superuser locally; prod Q-4 = true/true, pre-check row 7) |
| 2 | Post-conditions 1–7 + the indexdef `LIKE` | ✅ | Pass | Clean apply passes all 7 on **PG 17.10 and PG 15.18**. Both print `… USING btree (user_id) WHERE (status = ANY (ARRAY['requesting'::text, 'pending'::text, 'grace'::text, 'locked'::text]))`, so the LIKE matches. **Mutation test:** 21 broken copies of 93 (RLS off, a policy, anon SELECT, authenticated column UPDATE, the table REVOKE removed under default privileges, service_role TRUNCATE / no DELETE, predicate without `locked`, index not unique, per-user index missing, a trigger, FK RESTRICT, an inbound FK, claim DEFINER, claim search_path, claim REVOKE removed, claim granted to authenticated, claim GRANT missing, cut INVOKER, cut owner service_role, cut granted to anon). Each raised its own post-condition and rolled back to 0 objects. A second apply refuses. Table ACL `{postgres=arwdDxtm/postgres,service_role=arwd/postgres}`, both function ACLs `{postgres=X/postgres,service_role=X/postgres}` |
| 3 | Every named CHECK refuses its violation | ✅ | Pass | 47 cases, each matched to its **named constraint** (23514). `closed` / `deleted` status; `fr`; `Bad`, too short, 41 chars and free text as reason; kept shape 4 ways; grace without `lock_at` / `grace_starts_at`; locked without `grace_starts_at` / `locked_at`; claim pair both ways; 21 codes; NULL element; only NULL; **`['']`, `['G-9','']`** (new clause); **`['G-9,G-1']`, `['G-9,']`** (new comma clause); free text; `G-100`, `g-9`, `G-9ab`, 41-char snake code, a digit in snake form; 65-char zone and error code; negative attempts and email attempts. Accepted: 20 codes, `{}`, `['G-9','G-10a','payment_failed']`, a 40-char reason, a 64-char zone, valid kept / locked rows. NOT NULL (23502) and unknown user (23503) also checked. Exactly 12 CHECKs exist |
| 3 | One open row per user; a new request after kept | ✅ | Pass | A second open row (requesting / pending / grace / locked) → 23505 `…_one_open`. After kept, a new `requesting` row is accepted, a second kept row is accepted, and re-opening the old row while a new one is open → 23505. anon / authenticated SELECT and UPDATE → 42501. service_role INSERT works (RLS on, no policy) |
| 4 | Claim RPC boundaries | ✅ | Pass | Claimed exactly {requesting 15m02s, pending past `next_check_at`, pending NULL, grace NULL claim, grace claimed 91 s ago}. Skipped: requesting 5 min and 14m58s, locked, kept, future `next_check_at`, grace claimed 60 s ago. Order: `next_check_at` NULLS FIRST, then `requested_at`. `claimed_by` / `claimed_at` / `updated_at` are set, `attempts` +1 (3→4, 0→1), and the 60 s row is untouched. A second claim right after gets 0. NULL runner → 0 rows. Batch NULL/0/−5/1 → 1, 7 → 7, 100 → 100, 1000 → 100. The whole row is returned (31 columns, equal to `ACCOUNT_CLOSURE_COLUMNS`). anon / authenticated EXECUTE → 42501 |
| 4 | SKIP LOCKED disjoint batches | ✅ | Pass | Connection A claims 10 and does not commit. Connection B claims 10 in 8 ms (no wait), with 0 overlap; each runner owns 10 after both commit. 4 parallel workers × batch 40 over 120 rows: 120 claimed, all distinct |
| 5 | Session cut | ✅ | Pass | 42501, nothing removed, for: NULL, no row, `pending`, `grace` before its lock, `requesting`, `kept` (even one that was locked before), unknown uuid. `grace` past its lock and `locked` each return `{"sessions":2,"refresh_tokens":1}`: 2 sessions, the 2 session-linked tokens and the amr claim go by cascade, and the **orphan token (`session_id` NULL)** goes by `user_id::text`, leaving 0/0/0. Every other user (6 + the seeded `+test`) is untouched. A second cut is a no-op `{0,0}`. In the replica service_role cannot DELETE `auth.sessions` itself (42501), so the cut proves the DEFINER path. anon / authenticated EXECUTE → 42501 |
| 6 | Pre-check and both checkers | ✅ | Pass | Pre-check: before 93, 8/8 ok. After 93, rows 1, 2 FAIL and 3–8 ok. After 94, rows 1, 2, 4, 5 FAIL. After the full restore, 8/8 ok. **93 checker:** rows 1–12 ok and row 13 FAIL (info) before 94; 1–13 ok after 94 (PG 15 too). **94 checker:** rows 1–8 ok, **row 9 md5 `8c4fc3c2a7ef552a5785383230f1f548` ok** |
| 7 | F-A proof | ✅ | Pass | 93 + 92 live: `check` BLOCKED `G-10 public.business_os_account_closures.user_id`, `delete` raises P0001 BLOCKED (the login stays), `anonymise_check` BLOCKED on the same link. 94 live: check OK, and the plan lists `B business_os_account_closures found 2`. **Hard delete** of the `+test` account with 2 closure rows (pending + kept): login gone, 0 closure rows, report `rows_removed: 2`. **Anonymise** of a real account with a `locked` row: tombstone `deleted-…@deleted.invalid`, closure row gone, report count 1 |
| 8 | Rollback order | ✅ | Pass | The 93 rollback with 94 live refuses ("still names the table") with and without a row, dropping nothing. The 94 rollback restores 92: stamp `ec34`, body md5 `c721f252…` = the 92 body applied at set-up, one overload, DEFINER, owner postgres, ACL service_role only. Then G-10 refuses again, and 93 checker rows 11 and 13 FAIL. The 93 rollback with 1 row refuses ("holds 1 deletion request(s)"). Empty, it drops table, claim and cut (`000`). The 92 check is clean again. A second 93 rollback refuses cleanly. Re-applying 93 → 94 after the full restore works |
| 9 | Jest | ✅ | Pass (DL-1a) | See the table below. CR-1's T-4 case is present and green: "refuses kept by an admin but never locked (locked_at null) with no admin call". The code reads `locked_at` through `findLatestForUser` → `ACCOUNT_CLOSURE_COLUMNS` (it is in the select list, so it is never `undefined`) |
| 10 | No live auth call | ✅ | — | None made |

**Jest runs (worktree, Windows, Node 22):**

| Run | Result |
|---|---|
| 3 new repository suites + callers guard + T-1 + T-2 + drift `testAccountCleanupSql` + `no-deletion-paths` | **7/7 suites, 372/372 tests** |
| `npm run test:bos-entitlements` | **311/311 suites, 9350/9350 tests** (SA: 9347; +3 from CR-1) |
| `npm test -- --ci` (full) | 1677 passed, 8 skipped, **24 failed** suites (145 tests). **None is a DL-1a file.** 11 are in `.github/ci/jest-quarantine.json`. The other 13, including `bookingNextStep`, `supabaseFetch` and 11 source-scan guards, **fail the same way in the main checkout at `1baf1f9b`** (13/13 suites, 23 tests). So they are local and Windows-environment issues, as SA found, not DL-1a regressions. CI on the rebased head is still the authority (RM, SR-5) |

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None. The claim is one indexed CTE; 120 rows across 4 workers ran without lock waits.

#### Edge Cases (nice to fix)
1. **The 93 checker errors instead of answering FAIL when the table is absent.** Rows 3, 4 and 11 name `public.business_os_account_closures` as text or in `FROM`. Run before 93, or after a full rollback, the script raises 42P01 instead of returning FAIL rows. The §9 order (run it only after step 4) makes this harmless. — `scripts/check-account-closures-migration.sql` — Severity: Low
2. **The 94 checker's row-9 text still says "information only, never a gate"**, while §9 step 7 (CR-2) now makes it a gate. SA allowed the text to stay; the operator should follow §9, not the row text. — `scripts/check-test-account-cleanup-account-closures-migration.sql` — Severity: Low (doc)
3. **Pre-guard "postgres may DELETE on auth.sessions / refresh_tokens" is not exercised.** No local cluster can make `postgres` a non-superuser. It is covered by prod Q-4 (true/true) and pre-check row 7. — Severity: Info
4. **The session cut refuses a `kept` row even when it was locked before** (the W-3 predicate reads the current status only). This is the intended design: DL-4 cuts at the lock. Recorded for DL-4. — Severity: Info

### Not verified (and why)
- The GoTrue spike and the keep/drop decision (CR-4). If the result is **drop**, re-run this harness after SA's short re-review. The cut cases in §5 and post-conditions PC-7 then go away.
- Behaviour on Supabase's managed `postgres` (non-superuser) and the SQL editor. That is covered only by the read-only Q-1…Q-9 results and the in-file guards.
- CI on the rebased head (RM, SR-5).

### Post-apply prod checklist (for TL and the user, §9)
1. **Gates first:** §3.4 filled and confirmed by SA (CR-4). SR-5 rebase done, drift test green, CI green. The pasted bytes match the sha256 above, or the rebased head after a harness re-run.
2. **Pre-check** `scripts/precheck-account-closures.sql` → 8/8 `ok`.
3. **Apply 93.** Then the **93 checker** → rows 1–12 `ok`, row 13 `FAIL` (expected). Admin deletes and test-account cleanup are now paused (F-A). Continue in the same sitting.
4. **Apply 94 at once.** Then the **94 checker** → rows 1–8 `ok` **and row 9 `ok`** (md5 `8c4fc3c2a7ef552a5785383230f1f548`). A row-9 FAIL means line endings: compare with the PR head before the merge (CR-2).
5. **Re-run the 93 checker** → rows 1–13 all `ok` (row 13 turns `ok` once 94 is live).
6. **Read-only spot check (optional):** `SELECT proname, proacl::text, prosecdef, pg_get_userbyid(proowner) FROM pg_proc WHERE proname IN ('business_os_account_closures_claim_due','business_os_account_closure_cut_sessions');` → both ACLs `{postgres=X/postgres,service_role=X/postgres}`, the claim `f`, the cut `t` and owned by postgres.
7. **Enqueue the PR** (manual merge). After the Vercel deploy, a Danger Zone **check** on a `+test` account answers with the new stamp: no `function_out_of_date`, and no G-10 blocker on `business_os_account_closures`.
8. Release the lock and send the `[DELETE→EXPORT]` message with CR-3 (MX-1a counts from 162, `PREVIOUS = 20261094`).
9. **If anything fails:** 94 rollback → 93 rollback (refuses while 94 is live or any row exists) → PR revert. Replica-proven in item 8.

### Final Status
- [x] All acceptance criteria pass on the replica — ready for commit, subject to CR-1 being in the diff (it is, and green), CR-2 at apply, CR-3 at lock release, and **CR-4: no prod apply before the spike result is confirmed by SA**
- [ ] Issues found — Dev must address before commit (none; edge cases 1–2 optional)

## Commit Info

*(RM populates)*

---

## Change History

| Date | Change | Details |
|---|---|---|
| 2026-10-25 | Workplan created (Dev) | DL-1a scope from XC-1/3/4/11/21 and SR-3/4/5/7/8. Spike first; two migrations proposed (20261093 schema, 20261094 regeneration, O-1); 16 tasks, 2 d |
| 2026-10-25 | Implemented (Dev) | Tasks 4 to 15 done, session cut kept pending the spike; new stamp `792d801e13101316`; W-conditions folded into §4, §5.1, §9, §10, K-2; Dev notes N-1 to N-7 |
| 2026-10-25 | SA workplan review (SA) | `## SA Workplan Review — 2026-10-25`: ⚠️ approved with W-1 to W-13. F-A: G-10 pauses admin deletes from the 20261093 apply. O-8 dropped (`closed` removed, XC-1a). Lease as a SQL literal, tighter session-cut and lock-seam self-checks, spike guards; the spike needs the user's OK |
| 2026-10-25 | SA code review (SA) | `## SA Code Review — 2026-10-25`: ⚠️ approved for QA with CR-1 (unban kept branch needs `locked_at`), CR-2 (md5 row is an operator gate), CR-3 (MX-1a serialisation on the 162 counts), CR-4 (no apply before the spike is confirmed; a drop gets a short re-review). 94 vs 92 and the 94 rollback restore verified byte for byte; drift 203/203, test:bos-entitlements 9347/9347 |
| 2026-10-25 | QA pre-apply (QA) | `## QA Report — 2026-10-25 (pre-apply)`: ✅ no bugs. Local real-Postgres replica (17.10 + 15.18 check): 173/173 checks on SA items 1–8, incl. 21 post-condition mutations, 47 named CHECK cases, concurrent SKIP LOCKED, session cut incl. orphan token, F-A both modes, full rollback order. Jest: DL-1a suites 372/372, test:bos-entitlements 9350/9350; 24 full-suite failures are quarantined or fail identically on main. 2 Low edge cases |

## TL schema-check results — 2026-10-25 (Q-1…Q-9, prod, read-only)

- **Q-1:** `business_os_account_closures`, `business_os_account_closures_claim_due(uuid, integer, integer)` and `business_os_account_closure_cut_sessions(uuid)` do not exist yet (all NULL).
- **Q-2:** `auth.sessions.id` uuid NOT NULL, `auth.sessions.user_id` uuid NOT NULL, `auth.sessions.not_after` timestamptz NULL; `auth.refresh_tokens.id` bigint NOT NULL, `auth.refresh_tokens.user_id` **character varying** NULL (compare with `user_id::text`), `auth.refresh_tokens.session_id` uuid NULL, `auth.refresh_tokens.revoked` boolean NULL.
- **Q-3:** FKs to `auth.sessions`: `refresh_tokens_session_id_fkey` and `mfa_amr_claims_session_id_fkey`, both **ON DELETE CASCADE** — deleting a session also removes its refresh tokens and amr claims (refresh tokens with a NULL `session_id` still need the explicit `user_id::text` delete).
- **Q-4:** `postgres` may DELETE from `auth.sessions` and `auth.refresh_tokens` (true / true).
- **Q-5:** the live cleanup function carries `ec34d5604055abfe` (20261092) — SR-4 precondition met.
- **Q-6:** the only trigger on `auth.users` is `create_user_settings_trigger` AFTER INSERT — a ban (UPDATE of `banned_until`) fires nothing.
- **Q-7:** `business_os_billing_accounts`: `user_id` uuid, `livemode` boolean, `subscription_status` text, `current_period_end` timestamptz, `cancel_at_period_end` boolean, `ended_at` timestamptz; `user_preferences`: `user_id` uuid, `timezone` **character varying**.
- **Q-8:** anon / authenticated cannot CREATE in `public` (false / false).
- **Q-9:** no row ≥ 20261093 in `supabase_migrations.schema_migrations` (migrations are applied by hand; the coordination file holds the reservations: 20261093 + 20261094 = DL-1a).
- **Q-10** (spike baseline) is run only after the user approves the spike.

## Spike result — 2026-10-26 (D1.1, run by the user on prod, TL read Q-10)

Login: `meiribarak+closurespike@gmail.com` (id `00075df3-6d6c-41d4-be20-23b79b951203`, Champion, not admin, no live billing, no business). The script's tag guard was set to `+closurespike` for this login; the S-0 id match stayed the hard guard. GoTrue **v2.197.0**.

| Step | Result |
|---|---|
| 1 | two sign-ins A and B: ok |
| 3 | ban 10 years: ok (`banned_until` 2036-10-23) |
| Q-10 after the ban (read at 20:32, after step 8) | **sessions 3, live refresh tokens 3** — the ban removed nothing |
| 5 | `getUser` A/B: **403 user_banned** |
| 6 | refresh A/B: **400 user_banned** |
| 7 | new sign-in: **400 user_banned** |
| 8 | global sign-out with the banned token: `user_banned` (refused); `getUser` after: 403 |
| 5b | PostgREST read with the old access token: **200** — direct RLS reads keep working until the JWT expires |
| 9 | unban ok, `banned_until` cleared, sign-in after unban ok, final global sign-out ok |
| Q-10 after step 9 | banned_until NULL, sessions 0, refresh tokens 0 |

Note: the user pressed Enter at pauses 2 and 4 before TL read Q-10, so the only mid-ban reading is the step-8 one; it is decisive (rows still present ~66 s after the ban).

**Decision (§3.3 rule): KEEP the session-cut function.** A ban alone refuses the Auth API, refresh and sign-in at once, but leaves session and refresh-token rows in place, a banned user cannot sign itself out, and an already-issued access token still reads through PostgREST (5b = 200) until it expires. For DL-4 (D9): the error code a banned user sees is `user_banned` (403 on getUser, 400 on refresh/sign-in); lock copy must not promise that an open tab stops reading data instantly — the session cut removes refresh, and the JWT lifetime bounds the rest.
