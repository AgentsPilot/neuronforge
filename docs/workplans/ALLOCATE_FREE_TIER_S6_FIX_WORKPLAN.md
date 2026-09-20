# Workplan: Allocate Free Tier — S-6 P0 Fix

> **Last Updated**: 2026-09-20

**Developer:** Dev
**Branch:** `fix/allocate-free-tier-auth` (worktree `.claude/worktrees/fix-allocate-free-tier`, cut from `origin/main` by RM)
**Requirement:** Finding **S-6** in [BUSINESS_OS_LLM_AUDIT_TRAIL_WORKPLAN.md](/docs/workplans/BUSINESS_OS_LLM_AUDIT_TRAIL_WORKPLAN.md) (§2.2 row S-6, SA review "New finding"), plus the user's six required outcomes relayed by TL on 2026-09-19
**Date:** 2026-09-19
**Status:** Code Complete (2026-09-19), SA code-review fixes applied, QA passed; uncommitted. C1 ✅ and C2 ❌ folded in on 2026-09-20 (§7.1): no migration, and no ledger row. Remaining gates: the user's yes/no on the `console.*` conversion (§Implementation Notes). **C3's RLS/grants output came back and is now fixed on this same branch as the second P0 — see [§9 P0-FT-RLS](#9-p0-ft-rls--user_subscriptions-write-lock-down)** (migration + three service-role conversions, applied by hand after the code deploy). SA reviewed §9 on 2026-09-20 (Fix Required); RC9-1 to RC9-9 are applied — see §9.9 — SA re-reviewed and approved for QA on 2026-09-20, and **QA passed §9 on 2026-09-20 (PASS, no bugs) — see [§QA Testing Report — §9](#qa-testing-report--9-p0-ft-rls)**. ⚠️ The migration was applied to production **before** the code deployed, so production is in the broken window until this branch ships

## Overview

`POST /api/onboarding/allocate-free-tier` has no authentication. It takes `userId` from the request body and writes `user_subscriptions` through a module-level service-role client. On every call it adds the free-tier tokens to the balance, and it also sets `account_frozen: false`. Anyone can therefore top up any account without limit and undo the freeze applied by the free-tier expiry cron. This workplan replaces the route with a session-scoped, once-only, race-safe grant. It never unfreezes an account. All DB access goes through a new `UserSubscriptionRepository`, and the route follows the current route standard: Zod, Pino with a correlationId, a non-blocking `AuditTrailService`, and error details shown only in development.

## Table of Contents

1. [Analysis Summary](#1-analysis-summary)
2. [Implementation Approach](#2-implementation-approach)
3. [Decisions for SA](#3-decisions-for-sa)
4. [Files to Create / Modify](#4-files-to-create--modify)
5. [Task List](#5-task-list)
6. [Test Plan](#6-test-plan)
7. [Read-only checks for TL](#7-read-only-checks-for-tl)
8. [Out of scope / flagged](#8-out-of-scope--flagged)
9. [P0-FT-RLS — `user_subscriptions` write lock-down](#9-p0-ft-rls--user_subscriptions-write-lock-down)
10. [SA Review Notes](#sa-review-notes)
11. [Implementation Notes](#implementation-notes)
12. [QA Testing Report — §9 (P0-FT-RLS)](#qa-testing-report--9-p0-ft-rls)
13. [QA Testing Report — S-6](#qa-testing-report--s-6)
14. [Commit Info](#commit-info)
15. [Change History](#change-history)

---

## 1. Analysis Summary

### 1.1 Current route defects (`app/api/onboarding/allocate-free-tier/route.ts`)

| # | Defect | Lines |
|---|---|---|
| D1 | No auth. `userId` comes from the body and is trusted | 16-24 |
| D2 | Module-level `createClient(URL, SERVICE_ROLE_KEY)` bypasses RLS. Direct `.from()` calls, no repository | 5-8, 29-33, 76-131 |
| D3 | Re-grants on every call: `balance: existing + raw_tokens`, and it resets `free_tier_granted_at` and `free_tier_expires_at` | 87-99 |
| D4 | Read-modify-write on `balance` with no concurrency guard. It can overwrite a concurrent spend, and two concurrent grants both apply | 76-99 |
| D5 | Overwrites `total_earned = raw_tokens`, which erases the lifetime-earned history the Stripe webhook and `QuotaAllocationService` rely on | 89 |
| D6 | Overwrites `storage_quota_mb` / `executions_quota`, which can downgrade a paying user | 90-91 |
| D7 | Writes `account_frozen: false` on the existing row, undoing the cron freeze | 95 |
| D8 | Audit call is a `fetch` to `${NEXT_PUBLIC_SUPABASE_URL}/api/audit/log` (the Supabase host), so it never recorded anything (audit workplan M-2) | 147-168 |
| D9 | 13 `console.*` calls, no Zod, no correlationId | throughout |
| D10 | Returns the raw `error.message` to the client in production | 184-192 |

### 1.2 What the surrounding code tells us

| Source | Finding | Consequence for the design |
|---|---|---|
| `app/api/cron/check-free-tier-expiration/route.ts` | Freezes a row when `free_tier_expires_at < now AND account_frozen = false AND balance > 0 AND balance == total_earned`. On freeze it sets `balance = 0`, `account_frozen = true`, `free_tier_expires_at = NULL`. **It does not clear `free_tier_granted_at`** | Every cron-frozen account keeps `free_tier_granted_at` set, so the once-only guard alone stops the re-grant/unfreeze abuse path. We also never write `account_frozen` on existing rows (defence in depth) |
| `app/api/stripe/webhook/route.ts` (:137-199, :488-502, :604-653, :750-764), `sync-subscription` (:134-184) | Every purchase, boost pack or welcome bonus does `total_earned = old + credits`. A purchase also sets `free_tier_expires_at = null, account_frozen = false` | `total_earned` is **cumulative lifetime credits**. The free-tier route's overwrite (D5) is the outlier |
| `lib/credits/rewardService.ts:163-184` | Rewards also do `total_earned += credits` and `balance += credits` (via upsert `onConflict: 'user_id'`) | Confirms the cumulative semantics. The upsert is indirect evidence of a unique constraint on `user_id` (§7 C1) |
| `lib/services/QuotaAllocationService.ts:73-77` | "Use `total_earned` as source of truth for lifetime purchases" to compute the quota tier | Overwriting `total_earned` downward (D5) can shrink a user's computed quota at the next re-allocation |
| `lib/services/CreditService.ts` | `chargeTokensWithIntensity` (:464-481) is itself an **unguarded** read-modify-write on `balance`. `initializeUser` (the only other insert with a ledger row) has **no callers** | Our grant can protect itself against a concurrent spend, but it cannot stop a concurrent spend from overwriting the grant (§2.5, residual R1) |
| `lib/stripe/StripeService.ts:84-91` | Creates a `user_subscriptions` row (`stripe_customer_id`, `monthly_*`) with no free-tier fields | A pre-existing row with `free_tier_granted_at IS NULL` is a real case (§3 Q2) |
| `lib/services/QuotaAllocationService.ts`, `lib/credits/rewardService.ts` | Neither exposes a reusable "grant once" or atomic-increment primitive. Both are raw `SupabaseClient` services with `console.*` | Nothing to reuse. The new repository is the first `user_subscriptions` repository |
| `lib/repositories/SystemConfigRepository.ts` | `getByKeys(keys)` already reads `system_settings_config` | Reuse it for the four `free_tier_*` keys instead of a direct `.from()` |
| `lib/audit/events.ts` | `FREE_TIER_ALLOCATED` is **not registered**. `subscription` is a valid `EntityType` | Register the event with metadata (severity `info`, flags `SOC2`, `FINANCIAL`, matching the Stripe billing events) |
| Supabase SQL in repo | No `CREATE TABLE user_subscriptions` anywhere under `supabase/` (only `ALTER TABLE ... ADD COLUMN` quota scripts). `executions_quota` defaults `NULL` = unlimited | Uniqueness of `user_id` could not be proven from the repo, so it went to TL as check C1. **Confirmed live on 2026-09-20: UNIQUE index `user_credits_user_id_key` (§7.1)** |

### 1.3 Callers

| Caller | Current call | Change |
|---|---|---|
| `components/onboarding/hooks/useOnboarding.ts:415` | `body: JSON.stringify({ userId: user.id })`. Only logs the result, and never fails onboarding | Stop sending `userId` (empty JSON body). Treat `alreadyGranted: true` as success |
| `app/test-plugins-v2/page.tsx:2231` (internal harness) | Grants to an arbitrary typed `freeTierUserId` | Remove the user-id input. The button grants to the **logged-in** user only. Document the behaviour change in `docs/V2_TEST_PAGE_SCOPE.md` |

---

## 2. Implementation Approach

### 2.1 Layering

```
route.ts  (auth, Zod, correlationId, response shaping, audit)
  └─ FreeTierGrantService.grant(userId, logger)   (config → tokens → once-only grant algorithm)
       ├─ systemConfigRepository.getByKeys([...])
       ├─ pilotCreditsToTokens(n, supabaseServer)   (existing shared util, unchanged)
       ├─ UserSubscriptionRepository   (findGrantStateByUserId / insertFreeTierRow / applyFreeTierGrant)
       └─ CreditTransactionRepository.createFreeTierGrantEntry   (non-fatal ledger, if Q4 = yes)
```

The route stays thin, which makes the algorithm unit-testable without HTTP. `FreeTierGrantService` is a plain module in `lib/services/` (an existing pattern) with repositories injectable for tests.

### 2.2 Authentication and the body `userId` (outcome 1)

- `const user = await getUser()` → `401` if absent. **The grant account is always `user.id`.**
- Body schema: `z.object({ userId: z.string().uuid().optional() }).strict()`. An empty or absent body is accepted: the route reads `request.text()` and parses JSON only if it is non-empty, because `request.json()` throws on an empty body.
- **If `userId` is present and differs from `user.id` → `403`** plus `requestLogger.warn({ sessionUserId, attemptedUserId }, 'free-tier grant: body userId mismatch')`. Nothing is read or written.
- **Why accept a matching `userId` rather than rejecting the field outright:** Vercel deploys are not atomic with client bundles. Browsers holding the pre-fix `useOnboarding` bundle will keep sending `{ userId: <own id> }` for a while. Rejecting that would break onboarding for real users during the rollout window. Accepting a match costs nothing, because the value is never used as the target. A mismatch cannot come from our own clients after the fix (the only arbitrary-id caller, the test harness, is updated in the same PR). A mismatch is therefore an abuse signal and gets a `403` plus a warn log.
- An invalid body (non-UUID `userId`, extra keys, non-object JSON) → `400` with `details` only in development.

### 2.3 Once-only grant algorithm (outcome 2)

`free_tier_granted_at IS NOT NULL` is the "already granted" marker. Every write is conditional on it being `NULL`, so Postgres decides who wins. Under READ COMMITTED, a concurrent `UPDATE` blocks on the row lock and **re-evaluates its `WHERE`** after the winner commits, so the loser matches 0 rows.

```
grant(userId):
  cfg        = load + Zod-validate free_tier_* config (fail closed on invalid)
  rawTokens  = pilotCreditsToTokens(cfg.pilotTokens)          ; must be > 0
  for attempt in 1..MAX_ATTEMPTS (3):
    row = repo.findGrantStateByUserId(userId)                  ; maybeSingle, allow-listed columns
    if row.error               → throw (500)
    if row is null:
      ins = repo.insertFreeTierRow(userId, newRowValues)       ; plain INSERT, never upsert
      if ins.inserted          → return GRANTED(new)
      if ins.conflict (23505)  → continue                      ; a concurrent grant or another path created the row
      else                     → throw
    if row.free_tier_granted_at != null → return ALREADY_GRANTED  ; no write at all
    upd = repo.applyFreeTierGrant(userId, expectedBalance = row.balance, patch(row))
          ; UPDATE ... WHERE user_id = $1 AND free_tier_granted_at IS NULL AND balance = $expected (IS NULL if null)
          ; .select('user_id') → updated = rows.length === 1
    if upd.updated → return GRANTED(existing)
    continue                                                   ; lost race: either granted meanwhile (next read → ALREADY) or balance moved (retry)
  → return RETRY_EXHAUSTED                                     ; 503, onboarding tolerates it
```

- **Double-click / two tabs, no row yet:** both `INSERT`. With a unique `user_id`, one wins and the other gets `23505`, re-reads, sees `granted_at` set, and returns `ALREADY_GRANTED`. **C1 confirmed the unique index (`user_credits_user_id_key`) on 2026-09-20, so this holds** and no migration is needed.
- **Double-click, row exists (e.g. created by Stripe):** both conditional `UPDATE`s race. One matches, the other re-evaluates `granted_at IS NULL` → false → 0 rows, re-reads, and returns `ALREADY_GRANTED`.
- **Grant vs concurrent spend:** the `balance = expected` predicate means our write never overwrites a spend that landed after our read. We retry with the fresh balance.
- **Null balance:** a `NULL` expected balance uses `.is('balance', null)`, because `.eq` with null matches nothing.
- **Duplicate rows:** impossible now C1 has confirmed the unique index, but the guards stay: `maybeSingle()` errors on more than one row → `500`, fail closed, logged, no grant; and a multi-row update is an error (SA F-2).

### 2.4 Field allow-lists (outcome 3 + tenant-isolation-guard Step 3)

The repository builds each payload **field by field from typed arguments**. No spread of caller or DB objects. `user_id` is always the authenticated id and appears only in the `WHERE` (update) or as an explicit key (insert).

**New row (`insertFreeTierRow`)** — the same columns as today:
`user_id, balance = raw, total_earned = raw, storage_quota_mb = cfg, storage_used_mb = 0, executions_quota = cfg, executions_used = 0, status = 'active', free_tier_granted_at = now, free_tier_expires_at = now + days, free_tier_initial_amount = raw, account_frozen = false, created_at, updated_at`.
`account_frozen: false` is allowed **only** here (outcome 3: a brand-new row may initialise it).

**Existing row (`applyFreeTierGrant`)** — recommended patch (see Q2/Q3):

| Column | Value | Rule |
|---|---|---|
| `balance` | `row.balance + raw` | add, guarded by `balance = expected` |
| `total_earned` | `(row.total_earned ?? 0) + raw` | cumulative, like every other credit source (Q3) |
| `storage_quota_mb` | `max(row.storage_quota_mb ?? 0, cfg.storageMb)` | never lower |
| `executions_quota` | `NULL` if either the row or the config is `NULL` (unlimited), else `max(row, cfg)` | never lower. `NULL` = unlimited |
| `free_tier_granted_at` | `now` | the once-only marker |
| `free_tier_initial_amount` | `raw` | |
| `free_tier_expires_at` | `now + days` **only if** `row.balance ?? 0 == 0 AND row.total_earned ?? 0 == 0`. Otherwise **not written** | protects prior credits from the cron (Q3) |
| `updated_at` | `now` | |
| **never written** | `account_frozen`, `status`, `stripe_*`, `user_id`, `id`, `*_used` | |

### 2.5 Balance race: optimistic predicate (recommended) vs RPC (SA choice)

| Option | What | Pros | Cons |
|---|---|---|---|
| **A (recommended for this P0)** | Conditional PostgREST `UPDATE` with `balance = expected`, bounded retry (§2.3) | No migration, no new pattern, ships without a manual DB apply, and the grant never overwrites a spend | **R1:** `CreditService.chargeTokensWithIntensity` is an unguarded read-modify-write. A spend that read *before* our grant and writes *after* it overwrites the grant (the user loses the free tokens, and `granted_at` stays set, so there is no retry). Needs an agent run during the ~ms window of onboarding completion, so the likelihood is very low |
| B | New `SECURITY DEFINER` RPC `grant_free_tier(p_user_id, …)`: one `UPDATE … SET balance = balance + $raw … WHERE user_id = $1 AND free_tier_granted_at IS NULL RETURNING …`, plus `INSERT … ON CONFLICT DO NOTHING` | Truly atomic increment, no retry loop | **New pattern (SA sign-off)**, a migration the user must apply manually, `EXECUTE` must be revoked from `anon`/`authenticated` (otherwise it is a new forgery path), and it still does not fix R1 (the spend side is the unsafe one) |

R1 is a `CreditService` defect, not a grant defect. The fix for both sides is an atomic `balance = balance ± n` for spends. I recommend **A** now and logging R1 as a follow-up (§8).

### 2.6 Logging, audit, errors (outcome 5)

- `createLogger({ module: 'AllocateFreeTierAPI' })`, `requestLogger = logger.child({ correlationId, userId })`. All 13 `console.*` calls are removed. Log lines: request received, config loaded (debug), granted (info, with `path: 'insert' | 'update'`, `rawTokens`, `attempts`), already granted (info), lost race / retry (debug), mismatch (warn), failures (error with `{ err }`).
- `AuditTrailService.getInstance().log({ action: AUDIT_EVENTS.FREE_TIER_ALLOCATED, entityType: 'subscription', entityId: user.id, userId: user.id, resourceName: 'Free Tier Quotas', details: {...}, request })` is not awaited and ends in `.catch(err => requestLogger.error({ err }, 'Audit failed (non-blocking)'))`. It is written **only on an actual grant**, never on a no-op. This replaces the broken `fetch`. It is the first time this event will ever be recorded (audit workplan M-2 already notes this as an intended behaviour change).
- Register `FREE_TIER_ALLOCATED` in `lib/audit/events.ts` with metadata `{ severity: 'info', complianceFlags: ['SOC2', 'FINANCIAL'], description: 'Free-tier credits and quotas granted' }`.
- 500 responses return `'Failed to allocate free tier'`, with `details` only when `NODE_ENV === 'development'`.

### 2.7 Response contract

| Case | Status | Body |
|---|---|---|
| Granted | 200 | `{ success: true, alreadyGranted: false, allocation: { pilot_tokens, raw_tokens, storage_mb, executions }, message }` (keys unchanged, so the test page's display keeps working. For existing rows, `storage_mb` / `executions` report the **effective** values written) |
| Already granted (incl. lost race) | 200 | `{ success: true, alreadyGranted: true, allocation: null, message: 'Free tier already granted' }` |
| Unauthenticated | 401 | `{ success: false, error: 'Unauthorized' }` |
| Body `userId` ≠ session | 403 | `{ success: false, error: 'Forbidden' }` |
| Invalid body | 400 | `{ success: false, error: 'Invalid input', details?: dev-only }` |
| Retries exhausted | 503 | `{ success: false, error: 'Please try again' }` |
| Config invalid / DB error | 500 | `{ success: false, error: 'Failed to allocate free tier', details?: dev-only }` |

### 2.8 Tenant-isolation-guard application (outcome 6)

| Checklist item | Application |
|---|---|
| Service role + caller-supplied id | Yes: `supabaseServer`, body `userId`. **The caller-supplied id is removed as a target.** The only accepted id is `getUser().id` |
| Ownership pre-check | Not needed once the id is session-derived: the only row touched is `user_id = session user`. The mismatch → 403 check is the pre-check for the legacy field |
| Explicit allow-list | §2.4. Typed args only, no spreads, `user_id` from auth, `id` never written |
| Scope-defeating three | **Upsert:** not used (plain insert + conditional update). **Triggers:** none on `user_subscriptions` are visible in the repo, but this cannot be proven (§7 C3). **Payload injection:** impossible (typed args) |
| Test | Foreign body id → 403 and repository never called. Payload assertions prove `account_frozen`/`user_id`/`status` are absent from the update patch |

Service-role use is intentional and documented in the repository header. The user must never be able to write `balance` themselves, so the grant cannot run under the user's RLS session. The route authenticates, then the repository writes only the session user's row.

---

## 3. Decisions for SA

| # | Question | Options | Dev recommendation |
|---|---|---|---|
| **Q1** | `user_subscriptions.user_id` uniqueness is **unproven** (no `CREATE TABLE` in repo). Indirect evidence says it is unique: `rewardService` upserts `onConflict: 'user_id'`, which Postgres rejects without a matching unique constraint, and many readers use `.single()` per user. | (a) Proceed on the assumption, gated on TL read-only check C1 before merge. (b) If C1 shows it is not unique: add a migration for a unique index (after a duplicate check), or fall back to an insert-then-recheck (not race-proof) | **(a)**, with C1 as a merge gate. If C1 fails, stop and come back to SA. Do not ship an insert path that can create duplicates |
| **Q2** | Existing row with `free_tier_granted_at IS NULL` (e.g. created by `StripeService`): grant tokens? overwrite quotas? | (a) Add tokens, never lower quotas (§2.4). (b) Skip the grant entirely for rows with paid history. (c) Old behaviour (overwrite quotas) | **(a)**. The user completed onboarding and is entitled to the one grant. Lowering a paying user's quota is a regression |
| **Q3** | `total_earned` value and `free_tier_expires_at` on existing rows. Old code: `total_earned = raw` (overwrite). The cron freezes on `balance == total_earned`. | (a) `total_earned = old + raw` (cumulative) **and** set `free_tier_expires_at` only when the row had `balance == 0 AND total_earned == 0`. (b) Keep the overwrite `total_earned = raw`. (c) Cumulative, and always set expiry | **(a)**. Reasoning: new rows are unchanged (`balance = total_earned = raw`, expiry set → cron works exactly as today). For existing rows, cumulative keeps `total_earned` truthful for Stripe and `QuotaAllocationService`. Setting an expiry on a row that already held credits would let the cron wipe **purchased** credits whenever `B == E` (e.g. bought and never spent), which (c) would cause. Under (b), `B > 0` never freezes, but it rewrites lifetime-earned downward and so can shrink quotas at the next re-allocation. (a) keeps both invariants: free-only accounts expire, and accounts with prior credits are never wiped |
| **Q4** | Write a `credit_transactions` ledger row? | (a) Yes, non-fatal after the grant: `transaction_type: 'allocation'` (proven valid by the live webhook), `activity_type: 'free_tier_grant'`, `credits_delta: raw`, `balance_before/after`, via a new minimal `CreditTransactionRepository`. (b) Defer | **(a)**. Every other credit source writes one, and the S-6 forensics (`docs/investigations/S6_FREE_TIER_ABUSE_CHECK.sql`) show why the missing ledger row hurts. Notes: the Stripe renewal only preserves `boost_pack_purchase` / `reward_credit` / `welcome_bonus`, so free-tier tokens are still dropped at the first renewal, **as today** (no behaviour change). `activity_type` constraint values are unknown → C2. Q3 of the investigation SQL must exclude `free_tier_grant` rows for grants after deploy |
| **Q5** | Body `userId` handling | (a) Optional, must equal session, else 403 plus a warn log (§2.2). (b) Reject any `userId` with 400. (c) Silently ignore | **(a)**. It keeps in-flight pre-fix bundles working during rollout, and a mismatch is a clear abuse signal. (c) hides abuse, and (b) breaks cached clients |
| **Q6** | Also write an audit entry for the 403 mismatch? | (a) Pino warn only. (b) Also `auditTrail.log` a denial event | **(a)** for this P0. Adding a new denial event widens scope. Revisit with the "unauthenticated admin routes" queue |
| **Q7** | Balance race strategy | A (optimistic predicate) / B (RPC, new pattern) — §2.5 | **A**. Log R1 (`CreditService` spend read-modify-write) as a follow-up |
| **Q8** | Missing config keys. Today a missing `free_tier_executions` key parses to `0` (not unlimited); `null` means unlimited | (a) Preserve today's defaults exactly (20834 / 1000 / 0 / 30). (b) Treat missing as unlimited | **(a)**. A behaviour-neutral refactor. A value that is present but invalid (negative, NaN) → 500 fail closed, no grant |

---

## 4. Files to Create / Modify

| File | Action | Reason |
|---|---|---|
| `lib/repositories/UserSubscriptionRepository.ts` | create | `findGrantStateByUserId`, `insertFreeTierRow` (23505 → `conflict`), `applyFreeTierGrant` (conditional update, allow-list). `supabaseServer` intentional and documented. Singleton export |
| `lib/repositories/CreditTransactionRepository.ts` | create (if Q4 = a) | `createFreeTierGrantEntry(userId, …)` only, user-scoped insert |
| `lib/repositories/types.ts` | modify | `UserSubscriptionGrantState`, `FreeTierNewRow`, `FreeTierGrantPatch`, `CreditTransactionInsert` types |
| `lib/repositories/index.ts` | modify | Export the new classes, singletons and types |
| `lib/services/FreeTierGrantService.ts` | create | Config load (via `systemConfigRepository.getByKeys`) + Zod, token conversion, grant algorithm §2.3, quota max rules §2.4. Returns a discriminated result `GRANTED \| ALREADY_GRANTED \| RETRY_EXHAUSTED` |
| `app/api/onboarding/allocate-free-tier/route.ts` | rewrite | Auth, Zod, mismatch 403, Pino + correlationId, audit, response contract. Removes the module-level client and all 13 `console.*` calls |
| `lib/audit/events.ts` | modify | Register `FREE_TIER_ALLOCATED` + metadata |
| `components/onboarding/hooks/useOnboarding.ts` | modify | Stop sending `userId`, and treat `alreadyGranted` as success. **31 `console.*` calls in this file (flagged, see §8)** |
| `app/test-plugins-v2/page.tsx` | modify | Remove the free-tier user-id input and state. The button grants to the logged-in user and shows `alreadyGranted`. **2 `console.*` calls in this file (flagged, see §8)** |
| `docs/V2_TEST_PAGE_SCOPE.md` | modify | The free-tier section now grants to the session user only, with the new request/response formats. Change History row |
| `lib/repositories/__tests__/UserSubscriptionRepository.test.ts` | create | Per-method unit tests (§6) |
| `lib/repositories/__tests__/CreditTransactionRepository.test.ts` | create (if Q4 = a) | Unit test |
| `lib/services/__tests__/FreeTierGrantService.test.ts` | create | Algorithm tests (§6) |
| `app/api/onboarding/allocate-free-tier/__tests__/route.test.ts` | create | Route tests (§6) |
| `docs/workplans/BUSINESS_OS_LLM_AUDIT_TRAIL_WORKPLAN.md` | modify | Mark S-6 as fixed on this branch (a pointer only) |

No migration is planned unless Q1 (b) or Q7 (B) is chosen.

---

## 5. Task List

- ✅ **T1** SA reviews this workplan and rules on Q1 to Q8 (APPROVED WITH CHANGES, 2026-09-19)
- ✅ **T2** Read-only checks recorded in §7.1 (2026-09-20): **C1 PASS** (`user_credits_user_id_key`, no migration), **C2 NEGATIVE** (ledger removed, §8.1 F-4), **C3 triggers cleared**; the C3 RLS/grants half is still pending with the user
- ✅ **T3** Types in `lib/repositories/types.ts` (closed types, RC-4)
- ✅ **T4** `UserSubscriptionRepository` + unit tests
- ✅ **T5** `CreditTransactionRepository` + unit test (Q4 = a, behind the `SHIP_FREE_TIER_LEDGER_ROW` switch, TODO(C2))
- ✅ **T6** Register `FREE_TIER_ALLOCATED` in `lib/audit/events.ts`
- ✅ **T7** `FreeTierGrantService` + unit tests
- ✅ **T8** Rewrite the route (Zod, auth, 403 mismatch, 409 frozen, Pino, audit, dev-only details) + route tests
- ✅ **T9** Update `useOnboarding.ts` (no `userId`, and `alreadyGranted` handled)
- ✅ **T10** Update the `test-plugins-v2` free-tier section + `docs/V2_TEST_PAGE_SCOPE.md`
- ✅ **T11** `npx jest` on the new tests + related suites, `npx tsc --noEmit` filtered to the touched files. `npm run lint` could not run from the worktree (see Implementation Notes)
- ✅ **T12** Grep proof: no `console.` and no `createClient(` in the route, and no `userId` target read from the body
- ✅ **T13** Update the S-6 pointer in the audit workplan. Status → Code Complete. Notify TL for the SA code review
- ✅ **T14** (SA.6) Whole-file `console.*` → `clientLogger` conversion of `useOnboarding.ts` (31 calls) and `test-plugins-v2/page.tsx` (2 calls), as a separable change. **Awaiting the user's yes/no**
- ✅ **T15** (RC-8) Trigger query in C3 of `docs/investigations/S6_FREE_TIER_ABUSE_CHECK.sql`: already present, no change needed

---

## 6. Test Plan

All tests are Jest with mocked repositories and a mocked `getUser`. Nothing touches the DB.

### 6.1 Route — `app/api/onboarding/allocate-free-tier/__tests__/route.test.ts`

| ID | Case | Expectation |
|---|---|---|
| R1 | Happy path, no body | 200, `alreadyGranted: false`, service called with `session.id`, audit `log` called once with `userId = entityId = session.id` |
| R2 | Unauthenticated | 401, service never called |
| R3 | Body `userId` ≠ session | 403, **service/repo never called**, warn logged with both ids |
| R4 | Body `userId` == session (legacy client) | 200, grant to the session id |
| R5 | Invalid body (non-uuid `userId`, extra key, non-object JSON) | 400. `details` present only in development |
| R6 | Service returns `ALREADY_GRANTED` | 200, `alreadyGranted: true`, **no audit call** |
| R7 | Service throws | 500 with a generic error. No `details` in production, `details` in development |
| R8 | Service returns `RETRY_EXHAUSTED` | 503 |
| R9 | Audit `log` rejects | Response still 200 and the error is logged |

### 6.2 Service — `lib/services/__tests__/FreeTierGrantService.test.ts`

| ID | Case | Expectation |
|---|---|---|
| S1 | No row → insert succeeds | `GRANTED`. Insert values as §2.4, including `account_frozen: false`, `total_earned = balance = raw` |
| S2 | Row with `free_tier_granted_at` set (second call) | `ALREADY_GRANTED`, **insert and update never called** |
| S3 | Insert → 23505 (concurrent first grant) → re-read shows granted | `ALREADY_GRANTED`, update never called |
| S4 | Existing row, `granted_at` null → update matches | `GRANTED`. Patch contains `balance = old + raw`, `total_earned = oldE + raw`, and **no `account_frozen`, `status`, `user_id`, `id` keys** |
| S5 | Update matches 0 rows, re-read shows `granted_at` set (lost race) | `ALREADY_GRANTED`, exactly one update attempt |
| S6 | Update matches 0 rows because balance moved, then succeeds on the retry with the new expected balance | `GRANTED`, second call uses the fresh balance |
| S7 | Balance keeps moving | `RETRY_EXHAUSTED` after 3 attempts |
| S8 | **Frozen** existing row with `granted_at` null | `GRANTED`, patch has no `account_frozen` key (the account stays frozen) |
| S9 | Cron-frozen row (`account_frozen: true`, `granted_at` set) | `ALREADY_GRANTED`, no write (it stays frozen) |
| S10 | Quotas: existing storage 5000 > cfg 1000 → 5000 kept. Existing executions `null` → stays `null`. Existing 10 < cfg 50 → 50 | never lower |
| S11 | Expiry: existing row with `balance == 0 && total_earned == 0` → `free_tier_expires_at` set. With prior credits → key absent | Q3 (a) |
| S12 | Null existing balance | update uses the null predicate (`expectedBalance: null`) |
| S13 | Config missing keys → defaults. Invalid config value → throws, no repo write | Q8 |
| S14 | Repo read error / duplicate-row error | throws, no write |
| S15 | Ledger insert fails (Q4) | still `GRANTED`, and the error is logged |

### 6.3 Repository — `lib/repositories/__tests__/UserSubscriptionRepository.test.ts`

| ID | Method | Expectation |
|---|---|---|
| U1 | `findGrantStateByUserId` | `.eq('user_id', id)` + `maybeSingle()`. Returns null for no row, and `{ error }` on an error |
| U2 | `insertFreeTierRow` | Payload keys equal the exact allow-list. A 23505 error maps to `{ data: { inserted: false, conflict: true } }`, and other errors to `{ error }` |
| U3 | `applyFreeTierGrant` | Chains `.eq('user_id')`, `.is('free_tier_granted_at', null)`, and `.eq('balance', n)` or `.is('balance', null)`. The payload never contains `account_frozen`/`user_id`/`id`/`status`. `updated` reflects the returned row count |

### 6.4 Manual / QA (non-prod, no DB writes by Dev)

QA on a preview or local environment with a test account: complete onboarding once → the grant is recorded; click again from the test page → `alreadyGranted: true` and the balance is unchanged. With the account frozen (set by QA in a test DB) → it stays frozen. A `curl` with another user's `userId` → 403. `audit_trail` shows exactly one `FREE_TIER_ALLOCATED`.

---

## 7. Read-only checks for TL

Dev does **not** query the DB. These are `SELECT`-only checks for TL/user in the Supabase SQL editor:

| # | Check | SQL | Why |
|---|---|---|---|
| **C1** (merge gate) | `user_id` unique? | `select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.user_subscriptions'::regclass;` and `select indexname, indexdef from pg_indexes where tablename = 'user_subscriptions';` | The insert path's "23505 = already exists" depends on it (§2.3, Q1) |
| C1b | Existing duplicates (only if C1 shows no unique constraint) | `select user_id, count(*) from user_subscriptions group by 1 having count(*) > 1;` | Needed before any unique index |
| **C2** | `credit_transactions` check constraints | `select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.credit_transactions'::regclass and contype = 'c';` | Confirms `activity_type = 'free_tier_grant'` is allowed (Q4) |
| **C3** | Triggers and RLS on `user_subscriptions` | `select tgname, pg_get_triggerdef(oid) from pg_trigger where tgrelid = 'public.user_subscriptions'::regclass and not tgisinternal;` and `select policyname, cmd, roles, qual, with_check from pg_policies where tablename = 'user_subscriptions';` | The tenant-guard "unscoped trigger" check. Also: **if `authenticated` has an UPDATE/INSERT policy on its own row, any user can set their own `balance` from the browser**, which would be a separate P0 (§8) |

### 7.1 Results (user ran the read-only SQL)

| # | Date | Result | Consequence |
|---|---|---|---|
| **C1** | 2026-09-20 | ✅ **PASS.** `user_subscriptions.user_id` carries a UNIQUE index, **`user_credits_user_id_key`** (the name predates the table's rename) | The insert path's "23505 = the row already exists" holds. **No migration is needed**, C1b was not required, and the C1 caveat is closed. Duplicate rows cannot exist, so the `maybeSingle` fail-closed and the multi-row update guard (SA F-2) are belt and braces |
| **C2** | 2026-09-20 | ❌ **NEGATIVE.** `credit_transactions_activity_type_check` allows only: `agent_execution`, `agent_creation`, `reward_credit`, `subscription_renewal`, `subscription_upgrade`, `boost_pack_purchase`, `welcome_bonus`. `'free_tier_grant'` would be rejected | **Q4 fallback applied: the PR ships with no ledger row.** The ledger code was removed, not left dead behind a switch (`CreditTransactionRepository` + its test deleted, `SHIP_FREE_TIER_LEDGER_ROW` and `recordLedger` gone, `types.ts` / `index.ts` entries reverted). `welcome_bonus` and `reward_credit` must **never** be reused as a stand-in: the Stripe webhook queries both. Re-adding a ledger row needs the migration in §8.1 F-4 |
| **C3** (triggers) | 2026-09-20 | Triggers: only `trigger_update_user_subscriptions_updated_at` (BEFORE UPDATE, sets `updated_at`). **No cross-table write, so the tenant-guard "unscoped trigger" risk does not apply and no SA re-review is needed on that count.** | Tenant-guard Step 4 cleared |
| **C3** (RLS / grants) | 2026-09-20 | ⛔ **Confirmed bad, as SA.4 warned.** RLS is enabled on `user_subscriptions`, but the policies `Users can update their own credits` (cmd **ALL**, roles `public`, `USING auth.uid() = user_id`, **no WITH CHECK**) and `Users can update own subscription` (cmd UPDATE, same shape) sit on top of INSERT/UPDATE/DELETE grants held by both `authenticated` and `anon`. **Any signed-in user can set their own `balance`, quotas and `account_frozen` straight from the browser with the public anon key.** | **A separate P0, tracked as §8.2 (P0-FT-RLS).** It is **not** caused by this route and **does not block this PR** (SA.4 ruled this in advance): the PR strictly reduces the attack surface. TL to open its own cycle |

---

## 8. Out of scope / flagged

| Item | Detail | Proposed handling |
|---|---|---|
| **R1** `CreditService` spend read-modify-write | `chargeTokensWithIntensity` (and `chargeForExecution`/`chargeForCreation`) read and then write `balance` unguarded. Concurrent spends lose updates, and a spend can overwrite a grant | **Tracked follow-up (SA Q7), see §8.1.** Atomic `balance = balance - n` (RPC or conditional update) |
| Cron heuristic | `balance == total_earned` freezes only accounts that **never spent a token**. Any spend makes `balance < total_earned`, so the account never expires. This is probably not the business intent | Follow-up for BA. Not changed here (the grant preserves today's cron behaviour for new rows) |
| Cron file logging | `check-free-tier-expiration/route.ts`: 10 `console.*` calls, module-level service client, no repo | Not touched in this fix. Flag for the "unauthenticated admin routes" / conformance queue |
| `lib/utils/pricingConfig.ts` | 6 `console.*` calls, direct `.from('ais_system_config')`. Used unchanged | Not touched. Conformance sweep |
| `get-allocation/route.ts` | Authenticated (OK), but has `console.*`, a module-level service client and returns `authError.message` in production | Not touched. Conformance sweep |
| `useOnboarding.ts` — 31 `console.*` calls | Client hook | ~~Convert only 3~~ **Superseded by SA.6:** whole file converted to `clientLogger` as a separable change. Awaiting the user's yes/no; revert that change if declined |
| `test-plugins-v2/page.tsx` — 2 `console.*` calls | Internal harness, ~5k lines. Neither is in the free-tier block | **Superseded by SA.6:** both converted, same separable change, same yes/no |
| RLS writes on `user_subscriptions` | C3 came back positive: users **can** write their own row from the browser | **Confirmed P0, diagnosed in §8.2, fixed in §9 (P0-FT-RLS)** — same branch, separate commit |
| S6 investigation SQL Q3 | ~~After deploy, new grants write a ledger row (Q4), so Q3 would double-subtract~~ **Obsolete since C2:** no ledger row is written, so Q3 needs no change. Revisit if the F-4 migration lands | No action |

### 8.1 Tracked follow-ups

| # | Follow-up | Owner / trigger |
|---|---|---|
| **R1** | **Unguarded read-modify-write of `balance` in the `CreditService` spend path** (`chargeTokensWithIntensity` :464-481, and `chargeForExecution` / `chargeForCreation`). Concurrent spends lose updates, and a spend that read before the grant and writes after it overwrites the grant (the user loses the free tokens; `free_tier_granted_at` stays set, so there is no retry). Fix on the spend side: an atomic `balance = balance - n` (RPC, or a conditional update with a `balance = expected` predicate as this workplan does) | TL to queue as its own cycle (SA Q7) |
| F-2 | Quota columns on the update path are computed from the read, and only `balance` / `granted_at` / `account_frozen` guard the write. A concurrent quota-only change (e.g. `QuotaAllocationService`) that lands between our read and write could be overwritten by the `max(...)` values. Every credit path also moves `balance`, so this needs a quota change with no balance change | Low; note for SA code review |
| F-3 | ~~If C2 disallows `free_tier_grant`…~~ **Done (2026-09-20).** C2 came back negative, so the ledger code was removed from the PR. Superseded by F-4 |
| **F-4** | **To ledger the free-tier grant, a migration must first add `'free_tier_grant'` to `credit_transactions_activity_type_check`.** Today the CHECK allows only: `agent_execution`, `agent_creation`, `reward_credit`, `subscription_renewal`, `subscription_upgrade`, `boost_pack_purchase`, `welcome_bonus` (C2, 2026-09-20). Never reuse `welcome_bonus` or `reward_credit` instead: the Stripe webhook queries both, and a `welcome_bonus` row makes it treat the account as a returning subscriber. **Until the migration lands, a grant is visible only through `user_subscriptions.free_tier_granted_at` / `free_tier_initial_amount` and the `FREE_TIER_ALLOCATED` audit entry** — it is absent from `credit_transactions`, so any ledger-based credit reconciliation must add the grant back by hand (the S-6 investigation SQL Q3 already assumes this) | TL to queue; needs a migration + SA review, out of scope for this P0 |

### 8.2 P0-FT-RLS — `user_subscriptions` is writable by any signed-in user (SA's diagnosis; **the fix is §9**)

**Raised by SA, 2026-09-20, from the C3 RLS/grants output (§7.1).** This is a **new P0**, independent of S-6. ➡️ **Implemented on this same branch as a separate change — see [§9](#9-p0-ft-rls--user_subscriptions-write-lock-down)** for the migration, the verified blast radius (SA's step-3 grep re-run found three writers this snapshot missed), the apply guide and the sibling-table answer. The text below is kept as SA's original diagnosis.

#### What the check returned

| Object | Definition | Consequence |
|---|---|---|
| RLS | Enabled on `public.user_subscriptions` | — |
| Policy `Users can update their own credits` | `cmd = ALL`, roles `public`, `USING (auth.uid() = user_id)`, **`WITH CHECK` = null** | `ALL` covers SELECT, INSERT, UPDATE and DELETE. With no `WITH CHECK`, Postgres falls back to `USING` for the write check, so a row stays writable as long as it keeps the caller's own `user_id` |
| Policy `Users can update own subscription` | `cmd = UPDATE`, same shape | Duplicate of the UPDATE half |
| Grants | `authenticated` **and `anon`** hold INSERT / UPDATE / DELETE | The policies are reachable from the browser with the public anon key |

#### Impact

Any signed-in user can run, from the browser console, `supabase.from('user_subscriptions').update({ balance: 999999999, account_frozen: false, storage_quota_mb: 9999999, executions_quota: null }).eq('user_id', myId)` and give themselves unlimited paid capacity, unfreeze a frozen account, or `DELETE` their row and have the next grant path recreate it. **This defeats S-6's whole purpose from a different direction** — the route is now locked down, but the table underneath it is not. Severity **P0**, the same class as S-6, and arguably worse: it needs no API at all.

It also makes every server-side balance guarantee advisory: the grant's `balance = expected` CAS, the expiry cron's freeze, and `QuotaAllocationService`'s tier maths all assume only the service role writes this table.

#### Why it does not block this PR

SA.4 ruled this case in advance ("it **does not block** this PR, because this route is not the cause"). The PR strictly reduces the attack surface: it removes an unauthenticated, unlimited, cross-account write path. Shipping it with this open is better than not shipping it. The two issues have no code overlap.

#### Recommended fix shape (for the new cycle — SA pre-opinion, not an approval)

1. **Drop the write side of both policies.** Replace them with a single SELECT-only policy, e.g. `create policy "Users read own subscription" on public.user_subscriptions for select to authenticated using (auth.uid() = user_id);` and drop `Users can update their own credits` and `Users can update own subscription`.
2. **Revoke the grants:** `revoke insert, update, delete on public.user_subscriptions from anon, authenticated;` and revoke **all** privileges from `anon` (an unauthenticated role has no business reading this table either — verify no public surface reads it first).
3. **Verification before applying** — Dev must confirm nothing legitimate writes this table from the browser. **SA has already done this pass:** all 10 client-side call sites (`components/settings/BillingSettings.tsx:267`, `components/settings/UsageAnalytics.tsx:132`, `components/v2/billing/StorageUsageV2.tsx:35`, `components/v2/Footer.tsx:127`, `components/v2/settings/BillingSettingsV2_NEW.tsx:192` and `:339`, `components/v2/TokenDisplay.tsx:19`, `components/v2/UserMenu.tsx:59`, `app/v2/agents/[id]/run/page.tsx:428`, `app/v2/dashboard/page.tsx:158`) are `.select(...)` only, and every write goes through a service-role API route or `lib/repositories/`. The two admin pages only mention the table in copy. **So dropping the write policies looks safe**, but the new cycle must re-run this grep at implementation time (and include `hooks/`, `lib/` client modules and any Edge function) rather than trust this snapshot.
4. **Also check the sibling tables** in the same cycle: `credit_transactions`, `plugin_connections` and `profiles` may carry the same `for all` + `USING`-only policy shape. A `WITH CHECK`-less `FOR ALL` policy is the pattern to hunt for, not just this one table.
5. **Roll-out:** additive-then-restrictive. Apply in a maintenance window, watch for 403s from the browser on billing screens, and keep the SELECT policy so read paths are untouched.
6. **Regression guard:** a Jest source guard asserting no `'use client'` file writes `user_subscriptions`, plus a manual QA step that a browser-side `update` returns 0 rows / an RLS error.

#### Related

Dev's forensic SQL (`docs/investigations/S6_FREE_TIER_ABUSE_CHECK.sql`) looks for balances inflated through the route. It cannot distinguish an abuse through **this** hole, because a direct RLS write leaves no route log and no audit entry. Whoever scopes the remediation question should treat the two together.

---

## 9. P0-FT-RLS — `user_subscriptions` write lock-down

**Dev, 2026-09-20. Same branch as S-6 (`fix/allocate-free-tier-auth`), separate change.** S-6 locked the *route*; this locks the *table* underneath it. The two have no code overlap and are reviewed as two commits.

### 9.1 Diagnosis

C3 (§7.1) read the live schema. RLS is enabled on `public.user_subscriptions`, and six policies sit on it:

| Policy | cmd | roles | USING | WITH CHECK |
|---|---|---|---|---|
| `Users can update their own credits` | **ALL** | `public` | `auth.uid() = user_id` | **none** |
| `Users can update own subscription` | **UPDATE** | `public` | `auth.uid() = user_id` | **none** |
| `Service role can manage all credits` | ALL | `public` | `auth.jwt() ->> 'role' = 'service_role'` | none |
| `Users can view own credits` | SELECT | `public` | `auth.uid() = user_id` | — |
| `Users can view own subscription` | SELECT | `public` | `auth.uid() = user_id` | — |
| `Users can view their own credits` | SELECT | `public` | `auth.uid() = user_id` | — |

and both `anon` and `authenticated` hold `SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER`.

Three facts combine into the hole:

1. `FOR ALL` covers INSERT, UPDATE **and** DELETE, not just "manage".
2. With no `WITH CHECK`, Postgres re-uses `USING` as the write check — so the row is writable as long as it keeps the caller's own `user_id`. Nothing constrains **which columns** or **what values**.
3. The grants make the policy reachable from the browser with the public anon key, which ships in every page.

Consequence: any signed-in user can run `supabase.from('user_subscriptions').update({ balance: 999999999, account_frozen: false, storage_quota_mb: 9999999, executions_quota: null }).eq('user_id', myId)` from the devtools console and hand themselves unlimited paid capacity, unfreeze a cron-frozen account, or delete the row so the next grant path recreates it. There is no API call, so no route log, no correlationId and no audit entry — **the forensic SQL in `docs/investigations/S6_FREE_TIER_ABUSE_CHECK.sql` cannot see abuse through this path at all.**

It also makes every server-side balance guarantee advisory: the free-tier grant's `balance = expected` compare-and-set (§2.5), the expiry cron's freeze, and `QuotaAllocationService`'s tier maths all assume the service role is the only writer.

### 9.2 The fix

**File:** `supabase/migrations/20261001_user_subscriptions_write_lockdown.sql` (applied by hand — see the apply guide, §9.5)

1. `DROP POLICY IF EXISTS` on the two write policies, by name.
2. `REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ... FROM anon, authenticated`.

Both, not one: without the grant the policy is unreachable, and without the policy the grant is unusable; a future dashboard edit that restores either one alone does not re-open the hole. The file runs in one transaction, is idempotent (`IF EXISTS`; a `REVOKE` of a privilege not held is a no-op), refuses to run if RLS has been switched off, and asserts its own post-conditions inside the transaction (no write policy left, neither role holds a write privilege — `has_table_privilege`, which also counts privileges inherited from a grant to `PUBLIC` — and at least one SELECT policy and `authenticated`'s SELECT survive). A full rollback block is in the header.

**Two server-side write paths are converted in the same branch, because they would otherwise break** (§9.3):

| File | Change |
|---|---|
| `app/api/run-agent/route.ts` | `new CreditService(supabase)` → `new CreditService(supabaseServer)`. The route's `supabase` is `createAuthenticatedServerClient()` (user cookies, RLS-respecting), and `chargeTokensWithIntensity` UPDATEs `balance`/`total_spent`. Every call is scoped to `user.id` from the verified session, never a body value |
| `app/api/stripe/update-subscription/route.ts` | The `user_subscriptions` UPDATE moves to `supabaseServer`, matching its sibling routes (`cancel-subscription`, `reactivate-subscription`, `sync-subscription`), still `.eq('user_id', user.id)` and still limited to `monthly_amount_usd` / `monthly_credits`. The `billing_events` insert on the next line is a different table and is left alone. Its result is now captured, logged and returned as a 500 (RC9-5), and the file's 3 `console.*` calls are converted to Pino |
| `app/api/stripe/create-checkout/route.ts` (**W-4, found by SA**) | The two `stripeService` calls receive `supabase: supabaseServer` instead of the cookie client. Both reach `StripeService.getOrCreateCustomer`, which UPDATEs `stripe_customer_id` or INSERTs the row without checking the result. `userId` is session-derived and every statement inside is `.eq('user_id', userId)` |
| `app/v2/agents/[id]/page.tsx`, `app/(protected)/agents/[id]/page.tsx` | **RC9-7**: the share-reward failure is no longer silent - both pages mark the agent shared, log the reward error through `clientLogger` and tell the user *"Agent shared. The credit reward could not be applied right now and will be credited later."* No 0-credit success banner, and no re-enabled Share button that then claims "already shared" |
| `lib/pilot/StateManager.ts` | **RC9-8**: comment only. Records that its `ExecutionService` holds the *user* client, so only reads and the SECURITY DEFINER `recordExecution` may be called from there |

#### Decisions

| # | Decision | Why |
|---|---|---|
| **D-1** | **Do not consolidate the three duplicate SELECT policies** (`Users can view own credits`, `Users can view own subscription`, `Users can view their own credits`) | Minimal change on a P0. They are identical owner reads and carry no risk; dropping and recreating a read policy could cost a read outage on every billing screen for zero security gain. Filed as a clean-up follow-up (§9.7 FT-RLS-2) |
| **D-2** | **Keep `anon`'s SELECT grant** (SA's §8.2 step 2 suggested revoking everything from `anon`) | It is already inert: the owner policies require `auth.uid() = user_id`, and `auth.uid()` is NULL for an unauthenticated caller, so an anon SELECT returns zero rows. Revoking it turns any read issued before the session hydrates from "no rows" into a 403 on `TokenDisplay` / `Footer` / the dashboard. Same clean-up follow-up |
| **D-3** | **Do not fix the browser-side share reward** (`RewardService` built with the browser client in the two agent pages) | That path *is* the vulnerability: it awards credits by upserting `balance` straight from the browser, so any user can replay the upsert and award themselves credits without sharing anything. Fixing it properly means a new authenticated, service-role reward route — a credit-granting API that needs its own SA review, and not something to bolt onto a P0. **Business consequence: once the migration is applied, sharing an agent still works but the reward is not credited** (the share succeeds, the "credits awarded" banner does not appear, no error is shown to the user). Follow-up FT-RLS-1 |
| ~~**D-4**~~ | ~~No error check added to the Stripe update~~ — **rejected by SA (RC9-5) and now implemented.** The write result is captured, logged with Pino and returned as a 500 | It is the only path that persists a paid plan change after Stripe has already been charged, and the failure mode of this whole cycle is "a write silently does nothing". The file's 3 `console.*` calls were converted in the same edit (the user approved converting `console.*` in files we touch) |

#### Files (this change only — the S-6 files are in §4)

| File | Action | Reason |
|---|---|---|
| `supabase/migrations/20261001_user_subscriptions_write_lockdown.sql` | create | The fix. Applied by hand, after deploy (§9.5) |
| `lib/repositories/__tests__/userSubscriptionsWriteLockdownMigration.test.ts` | create | Pins the migration's content + the source guards (§9.6) |
| `app/api/run-agent/route.ts` | modify | W-1: charge credits with the service role (2 lines + comment) |
| `app/api/stripe/update-subscription/route.ts` | modify | W-2 + RC9-5: service-role write, error captured then 500, `console.*` converted to Pino |
| `app/api/stripe/create-checkout/route.ts` | modify | W-4: service-role client into the two `stripeService` calls |
| `app/v2/agents/[id]/page.tsx` | modify | RC9-7: loud share-reward failure |
| `app/(protected)/agents/[id]/page.tsx` | modify | RC9-7: same, plus a `clientLogger` import |
| `lib/pilot/StateManager.ts` | modify | RC9-8: comment only |
| `docs/workplans/ALLOCATE_FREE_TIER_S6_FIX_WORKPLAN.md` | modify | This section |

### 9.3 Blast radius (verified 2026-09-20, not taken from the §8.2 snapshot)

Method: `grep -rn "user_subscriptions"` across the whole repo, then for each hit the **op** (select / update / upsert / insert / delete) and the **client** (browser anon, user-cookie `createServerClient` / `createAuthenticatedServerClient`, or service role). Services that take an injected `SupabaseClient` (`CreditService`, `ExecutionService`, `StorageService`, `QuotaAllocationService`, `RewardService`) were then traced to their construction sites, which is how W-1 to W-3 were found — a grep of `.from('user_subscriptions')` alone does not show them.

**And that was still not enough.** SA's independent re-run found **W-4**, in a file that never names the table at all: `create-checkout` passes its client *into* `StripeService`, whose `getOrCreateCustomer` writes `user_subscriptions`. The lesson, now recorded in the test file's header: a textual guard cannot find an injected-client writer, so **every service that takes a `SupabaseClient` parameter has to be traced by hand** — including the ones whose own file never mentions the table. `.rpc(` calls, SQL functions and triggers were checked too.

**Reads — browser (anon key), all `.select(...)`, unaffected:**

| File | Line |
|---|---|
| `app/v2/agents/[id]/run/page.tsx` | 428 |
| `app/v2/dashboard/page.tsx` | 158 |
| `components/settings/BillingSettings.tsx` | 267 |
| `components/settings/UsageAnalytics.tsx` | 132 |
| `components/v2/billing/StorageUsageV2.tsx` | 35 |
| `components/v2/Footer.tsx` | 127 |
| `components/v2/settings/BillingSettingsV2_NEW.tsx` | 192, 339 |
| `components/v2/TokenDisplay.tsx` | 19 |
| `components/v2/UserMenu.tsx` | 59 |

Confirms SA's list of ten (`Footer.tsx` carries `'use client'` on line 4, not line 1, so a naive head-of-file check misses it).

**Reads — user-cookie clients, unaffected** (SELECT stays granted): `app/api/stripe/create-portal/route.ts:41`, `app/api/generate-agent/route.ts:90`.

**Writers found — would break without the code changes:**

| # | Path | Client | Op | Handling |
|---|---|---|---|---|
| **W-1** | `app/api/run-agent/route.ts:88` → `CreditService.chargeTokensWithIntensity` (`lib/services/CreditService.ts:475`) | user-cookie (`createAuthenticatedServerClient`) | UPDATE `balance`, `total_spent` | **Fixed in this branch** (service role). Without it, every agent run stops charging tokens — a silent fail-open, because the charge error is caught and logged as non-fatal |
| **W-2** | `app/api/stripe/update-subscription/route.ts:78` | user-cookie (`createServerClient` + `cookies()`) | UPDATE `monthly_amount_usd`, `monthly_credits` | **Fixed in this branch** (service role). Without it, a paid upgrade/downgrade goes through in Stripe but the UI keeps showing the old plan, and the result is not even checked (D-4) |
| **W-3** | `app/v2/agents/[id]/page.tsx:1857` and `app/(protected)/agents/[id]/page.tsx:713` → `RewardService.awardAgentSharingReward` (`lib/credits/rewardService.ts:177`) | **browser anon key** | UPSERT `balance`, `total_earned` | **Deliberately not fixed** (D-3, ruled by the user and SA). Degrades to "shared, not credited" - and now says so out loud (RC9-7) |
| **W-4** | `app/api/stripe/create-checkout/route.ts:90` and `:129` → `StripeService.getOrCreateCustomer` (`lib/stripe/StripeService.ts:79-91`) | user-cookie (`createServerClient` + `cookies()`) | UPDATE `stripe_customer_id`, or INSERT the whole row | **Found by SA (RC9-1), fixed in this branch** (service role). Worst case without it: a user with no row pays, the INSERT fails silently, and `handleCheckoutCompleted` (`webhook:641-655`) only UPDATEs - 0 rows, not an error - so **the payment is taken and the credits are never granted**, with nothing logged |

`app/(protected)/agents/[id]/page.backup-20251101-215528.tsx:664` holds a fourth copy of W-3; it is a dead backup file and is not built.

**Service-role writers — unaffected:** the Stripe webhook (12 sites), `cancel-subscription`, `reactivate-subscription`, `sync-subscription`, the free-tier expiry cron, `UserSubscriptionRepository` (`supabaseServer`, the S-6 fix), `QuotaAllocationService` (always built with `supabaseAdmin`), and everything under `scripts/` and `archive/` (service-role CLI tools, not a runtime path).

**Database-side writers — unaffected:** `update_user_storage_used()` (trigger on `storage_usage`) and `increment_executions_used()` (called by `ExecutionService.recordExecution`, reached from `StateManager:227`) are both `SECURITY DEFINER`, so they run as the function owner and ignore the caller's grants. `trigger_update_user_subscriptions_updated_at` is the only non-internal trigger on the table (C3) and only stamps `updated_at`. No other `.rpc(` in the codebase touches this table.

### 9.4 Risks

| # | Risk | Likelihood | Mitigation |
|---|---|---|---|
| R-1 | A writer this sweep missed breaks silently in production | Low | Two independent sweeps (SA's and this one) plus the Jest source guard in §9.6; the post-apply watch in §9.5 step 7 names the exact symptoms; rollback is one transaction |
| R-2 | Share rewards stop being credited (D-3, accepted) | **Certain** | Stated in the apply guide so the user decides with open eyes; follow-up FT-RLS-1. The alternative is leaving a self-service credit grant open |
| R-3 | The policy names have drifted since 2026-09-20, so `DROP ... IF EXISTS` silently drops nothing | Low | The pre-check lists the live policies and says to STOP if anything unexpected can write; the in-transaction post-condition fails the migration if a named write policy survives, and the `has_table_privilege` assertion catches the drift case anyway |
| R-4 | A privilege was granted to `PUBLIC` rather than to `anon`/`authenticated`, so the REVOKE misses it | Low | The post-condition uses `has_table_privilege`, which counts inherited PUBLIC grants, and aborts the transaction with the remedy in a comment |
| R-5 | Someone rolls the migration back to "fix" an unrelated bug and re-opens the hole | Medium | The rollback block says so explicitly and tells the reader to revert code first |
| R-6 | `run-agent` now charges credits with the service role, so an id bug would cross tenants | Low | `user.id` comes from `supabase.auth.getUser()` on the same request; no body-supplied id reaches `CreditService`. Same shape as the S-6 fix and the tenant-isolation-guard pattern; SA re-ran that checklist over both swaps and passed them |
| **R-7** | **The migration is applied before the code deploy** | Medium — it is one click in the SQL editor | The most expensive mistake available here: token charging fails 42501 into the non-fatal catch at `run-agent/route.ts:600-604`, so **every run completes and charges nothing, silently**. §9.5 step 1 states the order, the cost, and a concrete "run one agent and watch the balance move" gate before applying |
| R-8 | `DROP POLICY` waits on `ACCESS EXCLUSIVE` and queues every billing read behind its lock request | Low | `SET LOCAL lock_timeout = '3s'` / `statement_timeout = '30s'` (RC9-3): it gives up harmlessly and can simply be re-run |

### 9.5 Apply guide (for the user)

The file is `supabase/migrations/20261001_user_subscriptions_write_lockdown.sql`.

1. **When: the code deploys first, then the migration — never the other way round.** The deploy must contain **W-1, W-2 and W-4** (RC9-4). `supabaseServer` behaves identically before and after the migration, so there is no window in which the new code is wrong; the reverse order is the dangerous one:
   - **If the migration goes first**, `chargeTokensWithIntensity` throws 42501 into the `catch (spendingError)` at `app/api/run-agent/route.ts:600-604`, which logs *"Failed to track token consumption"* as **non-fatal** and continues. Every agent run then completes and charges **nothing** — no failed request, no user-visible error. The only symptom is "balances stopped moving". Plan changes and checkout would fail just as quietly (W-2, W-4).
   - **Before applying:** wait for the Vercel promotion to finish (in-flight invocations of the previous deployment can still serve requests for a short while), then **run one agent on a test account and confirm its balance moved**. That is the proof the new code is live.
   - Accept D-3 / R-2 first: **agent-share rewards stop being credited** the moment it is applied (the user now sees "Agent shared. The credit reward could not be applied right now and will be credited later.", and the failure is logged — RC9-7).
   - No maintenance window is needed. The file takes `ACCESS EXCLUSIVE` only briefly and gives up after 3 s (step 4).
2. **Where:** Supabase dashboard → SQL Editor, on the production project (and on any other environment with this schema).
3. **Pre-check** (read-only, the three queries in the file header — the same ones as investigation check C3). Expect:
   - `rls_enabled = true` **and `rls_forced = false`**. If `rls_forced` is `true`, **stop**: with FORCE RLS the table owner is subject to RLS too, so the `SECURITY DEFINER` functions that write this table (`update_user_storage_used`, `increment_executions_used`) would start writing zero rows in silence once the write policies are gone (RC9-6);
   - the six policies in the §9.1 table, all `permissive = PERMISSIVE`;
   - `anon` and `authenticated` each holding SELECT + the write privileges.
   - **Stop and send the output to the Dev if** a policy that is *not* in that table can write (any `cmd` of ALL / INSERT / UPDATE / DELETE whose `roles` include `public`, `authenticated` or `anon`) — this file only drops the two it knows about. A `roles` column showing `{public}` is what we expect; a named role there means the live schema has drifted.
4. **Apply:** run the whole file. It is one transaction and safe to re-run. If it aborts, **nothing was changed**:

   | Abort message | What it means |
   |---|---|
   | `canceling statement due to lock timeout` | Something else held a conflicting lock for more than 3 s. Harmless — just run it again (RC9-3) |
   | `RLS is disabled on public.user_subscriptions ...` | RLS was switched off. Escalate to the Dev; the migration would not protect anything |
   | `write policies still present after DROP ...` | A policy name drifted. Send the pre-check output to the Dev |
   | `... still holds ... on public.user_subscriptions` | The privilege came from a grant to `PUBLIC`, which `REVOKE ... FROM anon, authenticated` does not remove. Re-run the same `REVOKE` with `FROM PUBLIC` as the file's comment explains, then re-run the file |
   | `no PERMISSIVE SELECT policy left ...` / `authenticated lost SELECT ...` | Reads would have broken. Escalate — nothing was applied |

5. **Post-check** (read-only, same three queries). Expect `rls_enabled = true`, `rls_forced = false`; exactly four policies left — the three `Users can view ...` SELECT ones (still `PERMISSIVE`) and `Service role can manage all credits`; and `anon` / `authenticated` holding `SELECT` and nothing else.
6. **Verify from the browser** — this is the check that actually proves the hole is closed, and the only one that exercises the anon key the way an attacker would. Two ways; **option A needs no session parsing and is the one to use if anything looks odd.**

   **Option A — copy the headers from a real request (recommended).** In a logged-in tab, open devtools → Network, reload a page that shows your token balance (the dashboard or `/settings` billing), and find the request to `…/rest/v1/user_subscriptions?select=…`. Right-click it → *Copy* → *Copy as fetch*. Paste it into the Console and run it: it should return your row (that is check (a)). Then paste the same thing again, and before running it change `method` to `'PATCH'`, put `body: JSON.stringify({ balance: 1 })` in the options, and replace the `?select=…` part of the URL with `?user_id=eq.<your user id>` — that is check (b).

   **Two headers you must add to (b)** before running it (SA N-1/N-2), because "Copy as fetch" of a GET carries neither:
   ```js
   headers: { ...copiedHeaders, 'Content-Type': 'application/json', 'Prefer': 'return=representation' }
   ```
   Without `Content-Type`, PostgREST answers **415** and the check proves nothing about 42501. Without `Prefer: return=representation`, a successful PATCH answers **204 with no body**, so you cannot tell the ⚠️ "0 rows" row of the table below from a real success. Read the response **body**: `[]` means 0 rows (⚠️), a returned row means the write went through (⛔).

   **Option B — read the session from the cookie.** The app's browser client is `createBrowserClient` from `@supabase/ssr`, so the session lives in **cookies**, not `localStorage`. In the Console of a logged-in tab:
   ```js
   // Reassembles the (possibly chunked, possibly base64-) sb-<ref>-auth-token cookie.
   const raw = document.cookie.split('; ')
     .filter(c => /^sb-.+-auth-token(\.\d+)?=/.test(c))
     .sort()                                   // .0 before .1
     .map(c => decodeURIComponent(c.slice(c.indexOf('=') + 1)))
     .join('');
   if (!raw) throw new Error('no supabase auth cookie on this tab - are you signed in?');
   const b64 = raw.startsWith('base64-') ? raw.slice(7) : null;
   const s = JSON.parse(b64 === null ? raw
     : new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/')), ch => ch.charCodeAt(0))));

   const url = '<NEXT_PUBLIC_SUPABASE_URL>', key = '<NEXT_PUBLIC_SUPABASE_ANON_KEY>';
   const h = { apikey: key, Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/json',
               Prefer: 'return=representation' };  // Prefer: so a successful PATCH returns rows, not a bodiless 204 (SA N-2)

   // (a) read - must still work: 200 and one row
   await fetch(`${url}/rest/v1/user_subscriptions?select=balance&user_id=eq.${s.user.id}`, { headers: h })
     .then(r => r.json().then(j => ({ status: r.status, j })));

   // (b) write - must now fail
   await fetch(`${url}/rest/v1/user_subscriptions?user_id=eq.${s.user.id}`,
     { method: 'PATCH', headers: h, body: JSON.stringify({ balance: 1 }) })
     .then(r => r.json().then(j => ({ status: r.status, j })));
   ```
   *(Dev verified this parser offline against synthetic cookies in all four shapes `@supabase/ssr` writes — plain JSON, `base64-`, `base64-` url-safe, and chunked `.0`/`.1` — plus the "not signed in" case. It was **not** run against a live logged-in session, because Dev has no deployed environment or account; if it throws, use option A, which parses nothing.)*

   **What the PATCH result means:**

   | Result of (b) | Meaning |
   |---|---|
   | 401/403 with `42501 permission denied for table user_subscriptions` | ✅ The grant revoke landed — **this is the proof** |
   | 2xx / 204 but 0 rows affected | ⚠️ The policies were dropped but the grants are still there (or a `PUBLIC` grant) — **escalate**, the hole is only half closed |
   | 2xx and `balance` actually changed to 1 | ⛔ Nothing was applied — **stop**, and restore that account's balance |

   ⚠️ Run **(b)** only *after* applying. Before the migration it really does write `balance: 1` — if you want to see the "before" behaviour, use a throwaway account.
7. **Watch for a day:** Vercel logs for `run-agent` (token charging still writes: balances move after runs), a plan change on a test account still updating the billing screen (it now returns a 500 and logs *"Stripe subscription was updated but the local user_subscriptions row was not"* if the write fails, instead of going quiet — RC9-5), a test checkout still persisting `stripe_customer_id` (W-4), and any `42501` / `permission denied for table user_subscriptions` in client error logs. The expected — and accepted — one is the share-reward path (D-3).
8. **Rollback** (only if a legitimate path is broken and cannot wait): the block in the file header. It restores the two policies and the grants exactly as they were on 2026-09-20 — **and re-opens the hole**. Prefer reverting the code change that broke and leaving the migration in place.
9. **Tell RM/QA** it has been applied, with the post-check and step 6 output, so this section can be closed.

### 9.6 Test plan

All in `lib/repositories/__tests__/userSubscriptionsWriteLockdownMigration.test.ts` unless stated.

| # | Test | Result |
|---|---|---|
| T-1 | One transaction, **and** `SET LOCAL lock_timeout = '3s'` / `statement_timeout = '30s'` before the first `DROP` (RC9-3) | ✅ |
| T-2 | Drops exactly the two write policies, by name, idempotently | ✅ |
| T-3 | Revokes the six write privileges from both roles and only that — no `GRANT`, no `CREATE POLICY`, no `REVOKE ... SELECT` | ✅ |
| T-4 | Leaves the SELECT policies, the service-role policy, the table and RLS itself untouched; contains no data statement | ✅ |
| T-5 | Fails closed when RLS is off; asserts its own post-conditions, including that a **PERMISSIVE** SELECT policy survives (RC9-6) | ✅ |
| T-6 | Header documents the pre-check with its STOP rule, the post-check, and a rollback that restores both policies **and** the grants | ✅ |
| T-7 | Header names the code that must ship first — now including **W-4** (`create-checkout`, `getOrCreateCustomer`) | ✅ |
| T-8 | Header states what to expect for `rls_forced` and `permissive` (RC9-6) | ✅ |
| T-9 | **Source guard:** no `'use client'` module writes the table directly — both `from('…')` and `from("…")` quote styles (RC9-9) | ✅ |
| T-10 | **Source guard:** only the two documented pages build `RewardService` with the browser client | ✅ |
| T-11 | **Regression guard:** `run-agent` builds `CreditService` with `supabaseServer` | ✅ |
| T-12 | **Regression guard (W-4):** `create-checkout` passes `supabase: supabaseServer` into both `stripeService` calls, and never the bare shorthand | ✅ |
| T-13 | **Regression guard:** the Stripe plan update writes with `supabaseServer`, captures `subUpdateError`, returns 500, and has no `console.*` left (RC9-5) | ✅ |
| T-14 | **Regression guard (RC9-7):** both agent pages carry the "shared, reward could not be applied" message and log the reward error | ✅ |
| T-15 | Nothing in the S-6 / Stripe / onboarding / repository suites regressed | ✅ |
| T-16 | Live effect of the migration | Not testable without a DB — the apply guide's post-check and step 6 cover it |

**Runs (2026-09-20, in the worktree, after the SA fixes):**
- `npx jest lib/repositories/__tests__/userSubscriptionsWriteLockdownMigration.test.ts` → **15/15 pass**.
- Wider related set (`lib/repositories/__tests__`, `FreeTierGrantService`, `app/api/onboarding`, `app/api/stripe`, `ownerPolicyMigration`, `lib/pilot`) → **58 suites, 770 tests: 53 suites / 731 tests pass, 5 suites / 39 tests fail.** The five failures are all in `lib/pilot/__tests__` (`StructuredTransforms`, `StructuredTransforms.wp33`, `StructuredTransforms.wp37`, `ConditionalEvaluator`, `ConditionalEvaluator.contains_any`) with `TypeError: context.isConditionalCoercionEnabled is not a function`. **Verified pre-existing:** `git stash`ing this cycle's changes and re-running those five suites reproduces exactly 5 failed suites / 39 failed tests. They are unrelated to the only `lib/pilot` edit here, which is a comment.
- `npx eslint -c eslint.config.mjs` on all seven touched files, each compared with `git show HEAD:<file>` piped through `--stdin`: **identical counts on every file** (`run-agent` 20, `update-subscription` 4, `create-checkout` 1, `app/v2/agents/[id]/page.tsx` 96, `app/(protected)/agents/[id]/page.tsx` 42, `StateManager` 20 — all pre-existing `no-explicit-any` / `no-unused-vars`). The new test file: **0 findings**.
- The §9.5 step-6 **cookie parser was checked offline** (Node, synthetic `document.cookie` strings) against all four shapes `@supabase/ssr` writes — plain JSON, `base64-`, `base64-` url-safe, chunked `.0`/`.1` — plus the "not signed in" path. It was **not** run against a live logged-in session: Dev has no deployed environment or account. Option A in step 6 needs no parsing and is the authoritative fallback.
- `tsc` on the whole project OOMs in this worktree (pre-existing; the worktree also has no `node_modules` of its own, so types resolve from the parent checkout). A scoped `tsc` over all seven touched files and their import graph reports **632 pre-existing errors**, none of them on a line this cycle changed. The ones inside touched files: 5 in `run-agent/route.ts` (`ExecutionRepository` methods that genuinely do not exist — `create`, `findRunningByAgentId`, `findForStatusQuery` — plus a `Partial<Execution>` mismatch); ~50 in `app/v2/agents/[id]/page.tsx` and 4 in `app/(protected)/agents/[id]/page.tsx`, almost all `TS2769` on the pages' **existing** `clientLogger.error('msg', err)` calls, which use Pino's signature incorrectly. **The RC9-7 blocks added here type-check cleanly** — they use the correct `logger.error({ err, agentId }, 'message')` form, and no error is reported on lines 1926-1930 (`app/v2/...`) or 810-821 (`app/(protected)/...`). `update-subscription`, `create-checkout`, `StateManager` and the new test file report **no errors at all**. That mismatch between the pages' existing calls and the Pino API is part of what FT-RLS-5 would clean up.

### 9.7 Follow-ups (not fixed here)

| # | Item | Priority | Why not now |
|---|---|---|---|
| **FT-RLS-1** | **The agent-share reward must move to a server route** — authenticated, service-role, Zod, idempotent per (user, agent), audited. Until it lands, sharing an agent credits nothing; the user is told so and the failure is logged (RC9-7). **Back-fill is possible and safe**: `RewardService` returns before writing `credit_transactions` / `user_rewards`, so the owed rewards are exactly the `shared_agents` rows with no matching `user_rewards` row — `select sa.user_id, sa.original_agent_id, sa.created_at from shared_agents sa left join user_rewards ur on ur.user_id = sa.user_id and ur.related_entity_id = sa.original_agent_id where ur.id is null and sa.created_at >= '<migration date>';` (verify the column names against the live schema first). SA also asks that `RewardService` then stop accepting a browser client at all | **P1** | A new credit-granting API needs its own BA/SA cycle. The user and SA both ruled: ship the lock-down first |
| **FT-RLS-3** | **`increment_executions_used(p_user_id uuid)` is `SECURITY DEFINER`, has no ownership check, and `EXECUTE` is open to any caller** — a signed-in user can increment **any** account's `executions_used` over PostgREST `/rpc/`, pushing another tenant over their execution quota. After this migration it is the only remaining way a signed-in user can move another account's quota numbers | **P1 in its own right** (SA §9) | A different object with a different fix — an `auth.uid() = p_user_id` check inside the function, or revoking EXECUTE from `anon`/`authenticated` and calling it only from the service role. Needs its own read-only check of the live definition first |
| FT-RLS-2 | Consolidate the three duplicate owner SELECT policies into one, and revoke `anon`'s now-pointless SELECT (D-1, D-2 — both agreed by SA) | P3 | Cosmetic + hardening; a separate, low-risk migration |
| FT-RLS-4 | ~~`update-subscription` ignores its write result and logs with `console.*`~~ **Done in this cycle** (RC9-5): the result is captured, logged with Pino, and returned as a 500; all 3 `console.*` calls converted | — | — |
| **FT-RLS-5** | **Two large client pages still log with `console.*` and are only partially compliant after this change:** `app/v2/agents/[id]/page.tsx` (**54 calls**; it already imports `clientLogger`, and the RC9-7 code uses it) and `app/(protected)/agents/[id]/page.tsx` (**24 calls**; `clientLogger` imported here for the RC9-7 code). Per CLAUDE.md § Logging both should be converted whole-file | P3 | **Flagged for the user's go-ahead.** 78 hand-checked call sites in two ~2,000-line UI pages is a large, risky diff to fold into a P0; Dev will do it as its own commit on a yes, the same way `useOnboarding.ts` was handled in the S-6 cycle |
| **SIB-0** | **The sibling tables SA asked about** — see §9.8 | P2 | Diagnosis only, no fix. SA: prioritise the `payment_*` cluster now that Business OS records money against those rows |

**For RM — which commit gets what.** Three separable commits on this branch:

| Commit | Files |
|---|---|
| **P0-FT-RLS** (the fix) | `supabase/migrations/20261001_user_subscriptions_write_lockdown.sql`, `lib/repositories/__tests__/userSubscriptionsWriteLockdownMigration.test.ts`, `app/api/run-agent/route.ts`, `app/api/stripe/create-checkout/route.ts`, `app/v2/agents/[id]/page.tsx`, `app/(protected)/agents/[id]/page.tsx`, `lib/pilot/StateManager.ts`, this workplan |
| **P0-FT-RLS** (same commit) | `app/api/stripe/update-subscription/route.ts` — the service-role swap **and** the RC9-5 error handling |
| **Logging (Commit B)** | The `console.*` → Pino conversions: `useOnboarding.ts` and `test-plugins-v2/page.tsx` from the S-6 cycle. `app/api/stripe/update-subscription/route.ts`'s 3 conversions are **interleaved with the RC9-5 error path in the same file** (they share the module logger), so they cannot be split cleanly — they ride with the P0 commit, and the logging commit message should say so. If the user declines Commit B, this file still stays converted: the 500 path depends on the logger |

### 9.8 SIB-0 — sibling tables with the same `FOR ALL` + `USING`-only shape

**Scope and honesty warning.** This is what the **repo's SQL shows**; it is not the live schema. The policies on `user_subscriptions` itself do not exist anywhere under `supabase/` — they were created through the dashboard — and neither do any policies for `credit_transactions`, `plugin_connections` or `profiles`, the three tables SA named. So the list below is a floor, not a ceiling, and each entry still has to be read live (a policy is only exploitable if `anon`/`authenticated` also hold the matching grant).

Grep: every `CREATE POLICY ... FOR ALL` under `supabase/**/*.sql` with a `USING` clause, **no** `WITH CHECK`, and not scoped to `service_role` — 16 policies over 15 tables, all of them `TO PUBLIC` (no `TO` clause at all):

| Table | Policy | USING | Defined in |
|---|---|---|---|
| `payment_plans` | Users can manage their own payment plans | `auth.uid() = user_id` | `20260723_enhance_payments.sql` |
| `payment_plan_installments` | Users can manage their own installments | `auth.uid() = user_id` | same |
| `payment_reminders` | Users can manage their own payment reminders | `auth.uid() = user_id` | same |
| `payment_processors` | Users can manage their own payment processors | `auth.uid() = user_id` | same |
| `payment_automation_rules` | Users can manage their own automation rules | `auth.uid() = user_id` | same |
| `payment_automation_executions` | Users can view their own automation executions | `auth.uid() = user_id` | same |
| `payment_events` | Users can view their own payment events | `auth.uid() = user_id` | same |
| `saved_payment_methods` | Users can manage their contacts saved payment methods | `auth.uid() = user_id` | same |
| `command_sessions` | Users can only access their own command sessions | `auth.uid() = user_id` | `20260731_add_command_sessions.sql` |
| `command_sessions` | Users can only access their own sessions | `auth.uid() = user_id` | `20260824_add_command_sessions.sql` (a second, duplicate policy) |
| `execution_anomalies` | execution_anomalies_user_isolation | `user_id = auth.uid()` | `20260629_execution_optimization_tables.sql` |
| `execution_baselines` | execution_baselines_user_isolation | `user_id = auth.uid()` | same |
| `plugin_performance` | plugin_performance_user_isolation | `user_id = auth.uid()` | `20260629_plugin_performance_table.sql` |
| `agent_group_memberships` | Users can manage their agent group memberships | `agent_id IN (SELECT id FROM agents WHERE user_id = auth.uid())` | `20260615_add_organizations.sql` |
| `workflow_groups` | Users can manage their org groups | `org_id IN (SELECT id FROM organizations WHERE owner_user_id = auth.uid())` | same |
| `organization_members` | Org owners can manage members | `org_id IN (SELECT id FROM organizations WHERE owner_user_id = auth.uid())` | same |

(`support_cache`'s "Support cache is internal only" is also `FOR ALL` + USING-only, but its `USING (false)` denies everything, so it is fine.)

Two groups are worse than "a user edits their own row": the `organizations` sub-selects let an org owner insert or delete membership rows directly, and the payment ones let a user mark their own invoices and installments however they like — which matters now that Business OS records money. The three tables SA named (`credit_transactions`, `plugin_connections`, `profiles`) could not be assessed from the repo at all; `profiles` in particular is known to be user-writable (CLAUDE.md § Security Rules on `profiles.role`).

**Recommended next step (read-only, for whoever picks this up)** — one query that lists every user-reachable write policy in the database, live:

```sql
SELECT p.tablename, p.policyname, p.cmd, p.roles, p.qual, p.with_check,
       has_table_privilege('authenticated', format('public.%I', p.tablename), 'UPDATE') AS authd_can_update,
       has_table_privilege('anon',          format('public.%I', p.tablename), 'UPDATE') AS anon_can_update
FROM pg_policies p
WHERE p.schemaname = 'public'
  AND p.cmd IN ('ALL', 'UPDATE', 'INSERT', 'DELETE')
  AND p.with_check IS NULL
  AND (p.roles @> '{public}' OR p.roles @> '{authenticated}' OR p.roles @> '{anon}')
ORDER BY p.tablename, p.policyname;
```

**Not fixed in this cycle.** Flagged for TL to scope as its own hardening cycle, and it should be scoped from that query's output rather than from the repo.

### 9.9 Dev response to the SA review of §9 (2026-09-20)

Every item applied. Nothing was argued down.

| # | SA required | What was done |
|---|---|---|
| **RC9-1** | W-4: `create-checkout` must not hand its cookie client to `getOrCreateCustomer` | `supabase: supabaseServer` on both `stripeService` calls, with a comment naming the failure mode. §9.3 has the W-4 row and the "trace injected clients by hand" lesson; the migration header lists it under "code that must ship first"; T-12 pins it. **Confirmed SA's reading of the consequence independently**: `getOrCreateCustomer` checks neither result (`StripeService.ts:79-91`), and `handleCheckoutCompleted` only UPDATEs |
| **RC9-2** | Replace the `localStorage` snippet; document the three PATCH outcomes | §9.5 step 6 rewritten: **option A** copies the headers from a real Network-tab request (no parsing at all, so nothing can break), **option B** reassembles the chunked/`base64-` `sb-<ref>-auth-token` **cookie**. The three-outcome table is in. Honest caveat recorded in §9.6: the parser was verified **offline** against synthetic cookies in all four encodings; Dev has no deployed environment or logged-in session to run it against, which is why option A is presented first |
| **RC9-3** | `lock_timeout` / `statement_timeout` after `BEGIN;` | Added, with a comment. §9.5 step 4 now has an abort table whose first row is "lock timeout → nothing changed, just re-run". T-1 pins both settings **and** that they precede the first `DROP` |
| **RC9-4** | Step 1: W-4 in the same deploy; wait for the promotion and verify a charged run; spell out the reverse-order cost | Step 1 rewritten around exactly that, naming `run-agent/route.ts:600-604` and the "balances stopped moving" symptom. Added as risk R-7 |
| **RC9-5** | D-4 rejected: capture the write result, log it, return 500 | Done: `const { error: subUpdateError }`, a Pino error line, and a 500 with a support-facing message (`details` only in development, per the API pattern). The file's 3 `console.*` calls are converted to Pino in the same edit — the user has approved converting `console.*` in files we touch. D-4 is struck through in §9.2 |
| **RC9-7** | The browser reward path must fail loudly in both pages | Done. `app/v2/...` now sets `hasBeenShared`, logs through `clientLogger` and shows the explicit message instead of falling through silently; `app/(protected)/...` no longer shows a 0-credit success banner. T-14 pins both strings. FT-RLS-1 records the back-fill query |
| **RC9-6** | Pre-check: expect `rls_forced = false`, show `permissive`; post-condition needs a PERMISSIVE SELECT policy | Done in the migration header, in §9.5 step 3 (with the reason: FORCE RLS would silence the SECURITY DEFINER writers), and in the post-condition (`cmd = 'SELECT' AND permissive = 'PERMISSIVE'`). T-5 / T-8 pin it |
| **RC9-8** | Comment at `StateManager:138` | Added, naming the two quota-writing methods that must never be called from there |
| **RC9-9** | Test: double-quoted `from(...)` variant; note what the guards cannot catch | Both done. The file header now says plainly that a textual guard cannot see an injected-client writer, and that this is exactly how W-4 hid |
| SA §9 opt. 1 | FT-RLS-3 deserves its own P1 | Promoted to a P1 row of its own in §9.7, with the fix shape |
| SA §9 opt. 3 | `RewardService` should become server-only once FT-RLS-1 lands | Recorded in FT-RLS-1 |

**Still true after the fixes:** Dev did not touch the DB, did not commit, and the migration must not be applied until RC9-1's deploy is live (§9.5 step 1).

---

---

## SA Review Notes

**Reviewed by SA — 2026-09-19**
**Status:** 🔄 **APPROVED WITH CHANGES.** Dev may start implementing once RC-1 to RC-9 are in the design. The merge is gated on C1 and on the C2 and C3 results (§SA.4).

### SA.1 Claims checked against the code

| Dev claim | Result | Evidence |
|---|---|---|
| Route defects D1–D10 | ✅ Confirmed | `route.ts:5-8, 16-24, 77-106, 147-168, 185-192` |
| The cron freezes on `expires_at < now AND frozen = false AND balance > 0 AND balance == total_earned`. It sets `balance 0, frozen true, expires_at NULL` and does not clear `granted_at` | ✅ Confirmed | `check-free-tier-expiration/route.ts:35-41, 57-59, 77-86` |
| "Cron-frozen accounts always have `free_tier_granted_at` set" | ✅ **True for every code path**, with one caveat. The cron only picks rows with `free_tier_expires_at` set. In app code, only this route sets `expires_at`, and it always sets `granted_at` in the same statement. The Stripe paths only ever set it to `NULL` (`webhook:198, 501, 652`, `sync-subscription:183`). No SQL under `supabase/` writes these columns. **Caveat:** hand-run SQL or `scripts/test-free-tier-ui.ts` (its reset sets `granted_at NULL`) can leave a row that is frozen but has no grant. That is why RC-1 exists | grep across `app/ lib/ components/ scripts/ supabase/` |
| `total_earned` counts every credit ever received | ✅ Confirmed | `webhook:491-492`, `rewardService.ts:164-181`, `QuotaAllocationService.ts:73-77` |
| Indirect evidence that `user_id` is unique | ✅ Plausible, not proof. `rewardService` upserts with `onConflict: 'user_id'`, and PostgREST rejects that unless a unique constraint exists. It only works if that code path runs successfully in production | `rewardService.ts:176-184` |
| `credits_delta` uses the same units as `balance` (tokens) | ✅ Confirmed. The webhook sets `newBalance = currentBalance + credits` and records `credits_delta: credits` | `webhook:491, 508` |
| A client-safe logger exists | ✅ `clientLogger` (`lib/logger.ts:30`, re-exported by `lib/logger/client.ts`), already used by `'use client'` files (e.g. `components/UserProvider.tsx`) | — |

### SA.2 Decisions

| # | Ruling | Reasoning |
|---|---|---|
| **Q1** | **(a)** Proceed. **C1 gates the merge.** If `user_id` is **not** unique: run C1b. With no duplicates, add one additive migration, `create unique index concurrently … on public.user_subscriptions (user_id)`, which the user applies **before** deploy. SA approves that migration shape now. If duplicates **do** exist, stop and escalate to the user: deciding which row is the real account is a business/data decision. **Never** ship the insert-then-recheck fallback | Without a unique constraint, nothing short of an RPC with a lock can stop two concurrent inserts, and an RPC would not fix duplicates that already exist either. The read path already fails closed on duplicates (`maybeSingle` errors → 500, no grant) |
| **Q2** | **(a)** with **RC-1** (a frozen row is never granted) | Adding tokens and never lowering quotas is correct. **FYI for TL, not a blocker:** an account created before onboarding existed that never received the grant can now claim it **once**. Today it can claim it without limit, so this is strictly tighter and I am not raising it as a decision |
| **Q3** | **(a)** Approved: add to `total_earned`, and set `free_tier_expires_at` only when the row had `balance == 0 AND total_earned == 0` (`NULL` counts as 0) | Checked against the cron. New rows behave exactly as today (`B == E == raw`, expiry set). A row with earlier credits never gets an expiry, so the cron can never wipe purchased or reward credits. Option (c) would wipe them. One real change: a buyer who has spent down to `balance 0` with `total_earned > 0` no longer gets an expiry. The old code *would* have frozen them (`B = E = raw` after the overwrite). Freezing a past buyer was a bug, so the new behaviour is the correct one |
| **Q4** | **(a)**, **depends on C2**. `transaction_type: 'allocation'`, `activity_type: 'free_tier_grant'`, `credits_delta: raw`. If C2 shows there is no CHECK on `activity_type`, or the CHECK allows this value, proceed. If the CHECK does **not** allow it, **leave the ledger row out of this PR** (drop `CreditTransactionRepository`) and log a follow-up. Do not widen the CHECK in a P0. **Never** use `'welcome_bonus'` as a stand-in: the Stripe webhook treats the existence of a `welcome_bonus` row as "has had a subscription before" (`webhook:729-736`) and keeps it on renewal, so reusing it would change billing | The ledger is written only on `GRANTED`, after the grant, and a failure there does not fail the request. A failed write is logged at **error** with `userId` and `rawTokens`, so it can be backfilled |
| **Q5** | **(a)** with **RC-5** (compare ids lower-cased) | A matching `userId` keeps old cached client bundles working. A mismatch is an abuse signal |
| **Q6** | **(a)** Pino `warn` only | A new denial audit event is out of scope for this P0 |
| **Q7** | **A: a conditional PostgREST update** with a bounded retry. **No RPC** | Under READ COMMITTED, a concurrent `UPDATE` waits for the row lock and then re-checks its `WHERE` against the committed row. `granted_at IS NULL AND balance = $expected` therefore lets exactly one writer win, in one statement. The CLAUDE.md gotcha ("use RPC functions for concurrent updates") is about getting that same guarantee, and a one-shot conditional write gets it. An RPC would add a migration and a new `EXECUTE` grant to lock down (a new way in for attackers), and it still would not fix R1. **R1 must be logged as a tracked follow-up** (the spend path in `CreditService`) |
| **Q8** | **(a)** Keep today's defaults. Also: `rawTokens` must be a finite integer `> 0`, otherwise fail closed with a 500 and no write | `getPricingConfig` quietly falls back to its defaults if the DB read fails (`pricingConfig.ts:75-78`). That is acceptable because the fallback amount is bounded. The util stays as it is, but it is a conformance-sweep item (§8 already lists it) |

### SA.3 Required changes (Dev to fold in before coding)

| # | Change | Why |
|---|---|---|
| **RC-1** | If the existing row has `account_frozen === true` and `granted_at IS NULL`: **no write**, the service returns `INELIGIBLE_FROZEN`, and the route answers `409 { success: false, error: 'Free tier not available for this account' }` with a `warn` log. No audit and no ledger. **Rewrite S8 to match.** For safety, also add `.eq('account_frozen', false)` to the `applyFreeTierGrant` predicate, so a freeze that lands between our read and our write makes the update match 0 rows. The next loop iteration then re-reads and returns `INELIGIBLE_FROZEN` | Your design (grant, but stay frozen) never writes `account_frozen`. But tokens granted to a frozen account become spendable the moment a purchase unfreezes it, which is a back door around the freeze. In code this state can only come from hand-run SQL, so failing closed costs legitimate users nothing |
| **RC-2** | Detect the unique-violation case by `error.code === '23505'` only, never by the message text. The insert-conflict path counts toward `MAX_ATTEMPTS` (3), so the loop is bounded on every path | Keeps the loop from spinning forever and makes the check independent of the message wording |
| **RC-3** | `RETRY_EXHAUSTED` is logged at **error** (not warn or debug) with `attempts`. The 503 body is generic with no `details` | Onboarding hides this failure from the user and does not retry, so ops must be able to see it |
| **RC-4** | Make `FreeTierGrantPatch` a **closed** type (explicit optional keys, no index signature, no `Partial<Row>`), and build it only inside the repository or service from numbers and dates, so that adding `account_frozen`, `status`, `user_id` or `id` is a **compile error**. The insert type is also closed. It is the only one allowed to hold `account_frozen: false` | Moves the "never write `account_frozen` on an existing row" rule from a convention to a type rule, on top of the tests |
| **RC-5** | Compare the body `userId` with `user.id` after lower-casing both | `z.string().uuid()` also accepts upper-case. A legacy client should never get a false 403 |
| **RC-6** | `details` exists only when `NODE_ENV === 'development'`, and is only a message **string**: never the PostgREST error object (its `hint`/`details` show the schema) and never a stack. 401, 403, 409 and 503 bodies never carry `details`, ids or balances | Security rule: no raw errors in production |
| **RC-7** | `ALREADY_GRANTED`, `INELIGIBLE_FROZEN`, 401, 403 and 400 do **no** DB writes of any kind: no subscription update, no ledger, no audit. **Suggested:** read the grant state *before* loading the config and pricing, so a repeat call costs one `SELECT` | Outcome 2: "repeat calls write nothing" |
| **RC-8** | Add the trigger query from §7 C3 (`pg_trigger … not tgisinternal`) to C3 in `docs/investigations/S6_FREE_TIER_ABUSE_CHECK.sql`. Today that file checks only RLS, policies and grants, so the tenant-guard trigger check would be skipped. If any trigger exists on `user_subscriptions`, SA must re-review before merge | Tenant-isolation-guard Step 4 (unscoped trigger) |
| **RC-9** | Tests: add the cases in §SA.5 | Coverage of the security invariants the user asked for |

### SA.4 What depends on C1–C3

| Check | If the result is… | Then |
|---|---|---|
| **C1** `user_id` unique | Unique | Design as written. Merge allowed |
| | Not unique, no duplicates (C1b) | Add the unique-index migration (Q1). The user applies it before deploy. Then merge |
| | Not unique, with duplicates | **Stop.** Escalate the duplicate cleanup to the user. Do not merge the insert path |
| **C2** `activity_type` CHECK | No CHECK, or `free_tier_grant` allowed | Q4 ledger ships |
| | CHECK does not allow it | Ship without the ledger (Q4 fallback) and log a follow-up. The rest of the PR is unchanged |
| **C3** RLS / grants / triggers | `authenticated` or `anon` can `INSERT`/`UPDATE` `user_subscriptions` | A **separate P0**: any user can set their own `balance` from the browser. Escalate to the user immediately. It **does not block** this PR, because this route is not the cause |
| | Any trigger on `user_subscriptions` | SA re-reviews it before merge (RC-8) |
| | Neither | No effect |

The design does not depend on C1–C3 anywhere else. The once-only guard, the freeze rule, the session-only target and the error hygiene are right whatever the three checks return.

### SA.5 Security model and test plan audit

| Invariant the user asked for | Design | Test (existing / **added by SA**) |
|---|---|---|
| Session user only, body `userId` never trusted | ✅ The target is always `getUser().id`. The body id is only compared | R2 (401), R3 (403, service never called), R4. **Added R10:** `getUser()` throws → generic 500, service never called, no `details` in production. **Added R11:** mixed-case own id → 200 (RC-5) |
| Injected fields dropped | ✅ `.strict()` body plus a closed patch type | **Added R12:** body `{ userId: own, balance: 999999, account_frozen: false, user_id: 'ATTACKER', total_earned: 1 }` → 400 and the service is never called. **Strengthen U2/U3:** assert `Object.keys(payload).sort()` **equals** the exact allow-list (not just "doesn't contain X"), and assert `.eq('user_id', <session id>)` is the only `user_id` in the chain |
| Repeat calls write nothing | ✅ | S2, R6. **Add to S2:** the ledger repo is never called. **Add to R6:** audit never called (already there) |
| Lost race | ✅ | S3, S5, S6, S7. **Added S3b:** insert → 23505 → re-read finds a row with `granted_at NULL` (created at the same moment by Stripe or rewards) → takes the update path → `GRANTED`. **Added S7b:** insert keeps returning 23505 with no row visible → `RETRY_EXHAUSTED` after 3, not an endless loop (RC-2). **Added S7c:** exhaustion logs at error (RC-3) |
| Frozen stays frozen | ✅ with RC-1 | S9 (cron-frozen, granted → no write). **S8 rewritten:** frozen with `granted_at NULL` → `INELIGIBLE_FROZEN`, no write. **Added U3b:** the update predicate includes `.eq('account_frozen', false)`. **Added R13:** `INELIGIBLE_FROZEN` → 409, no audit |
| Unique-violation path | ✅ | S3, U2 (23505 → `conflict`). **Added U2b:** a non-23505 error whose message contains "duplicate" → `{ error }`, not `conflict` (RC-2) |
| No partial grant | ✅ The grant is one statement (the insert, or the conditional update). The ledger and audit come after it and cannot fail it | S15. **Added S16:** the ledger and audit are attempted only after `upd.updated` / `ins.inserted` is true |
| No details leaked in production | ✅ with RC-6 | R5, R7. **Added:** a production 500 body has **no** `details` key at all, and a development `details` value is a string |
| Config fails closed | ✅ | S13. **Added S13b:** `rawTokens <= 0` or not an integer → throws, no repo write (Q8) |

### SA.6 Scope rulings

| Item | Ruling |
|---|---|
| **test-plugins-v2 behaviour change** | ✅ **Approved and required.** Granting to any typed-in user id *is* the vulnerability, and an internal page is no exception. The button now grants to the logged-in user only. A tester who has already received the grant will see `alreadyGranted: true`, which is expected. Say so in `V2_TEST_PAGE_SCOPE.md`. If a real need turns up for "grant to another user", it gets its own admin route behind `AdminAccessService`, in a separate cycle |
| **`useOnboarding.ts`: convert only 3 of the 31 `console.*` calls** | ❌ **Rejected.** CLAUDE.md § Logging requires flag → propose **whole-file** conversion → convert unless the user declines. A partial conversion is not an allowed outcome, and it leaves the file mixed. A client logger exists (`clientLogger`, `lib/logger.ts:30`), so "leave it because there is no client logger" does not apply either. **SA recommendation: convert the whole file** with `clientLogger` in its own commit on this branch. It is mechanical, the file is being edited anyway, and it carries no security risk. TL puts it to the user as a **yes/no**. If the user explicitly declines, record that here and leave all 31 |
| **`test-plugins-v2/page.tsx`: 2 `console.*` calls** | Same rule. **SA recommendation: convert both** (trivial). TL includes this in the same yes/no. It is not a merge blocker if the user declines |
| Remediating accounts already abused before the fix | Out of scope. Whether and how to claw back credits depends on the S-6 investigation results and is a business decision for the user. This PR only stops further abuse |

### SA.7 Optimisation suggestions (non-blocking)

- Read the grant state before the config and pricing reads (RC-7), so the common repeat call costs one `SELECT`.
- On the mismatch `warn`, log both ids, but never the raw body.
- For the `FREE_TIER_ALLOCATED` audit `details`, reuse the old payload keys (`pilot_tokens`, `raw_tokens`, `storage_mb`, `executions`) and add `path: 'insert' | 'update'`.

### Approval

[x] Workplan approved **with the changes above**. Proceed to implementation with RC-1 to RC-9 folded in. Merge gates: C1 (and the migration, if needed), the C2 outcome applied to Q4, C3 including triggers (RC-8), and the user's yes/no on the two `console.*` conversions.

---

## Implementation Notes

**Dev, 2026-09-19.** Uncommitted in worktree `.claude/worktrees/fix-allocate-free-tier`, branch `fix/allocate-free-tier-auth`. No DB access, no migration.

### Files changed

**Commit A — security fix (S-6):**

| File | Action |
|---|---|
| `app/api/onboarding/allocate-free-tier/route.ts` | rewritten (auth, `.strict()` Zod body, lower-cased mismatch → 403, 409/503 mapping, Pino + correlationId, non-blocking audit, dev-only string `details`) |
| `lib/services/FreeTierGrantService.ts` | new (grant algorithm, config parse). No ledger write: C2 came back negative on 2026-09-20 |
| `lib/repositories/UserSubscriptionRepository.ts` | new |
| `lib/repositories/types.ts`, `lib/repositories/index.ts` | modified (closed types, exports) |
| `lib/audit/events.ts` | modified (`FREE_TIER_ALLOCATED`, info, SOC2 + FINANCIAL) |
| `components/onboarding/hooks/useOnboarding.ts` | modified: sends `{}`, handles `alreadyGranted` (functional hunk only) |
| `app/test-plugins-v2/page.tsx` | modified: user-id input removed, grants to the session user, shows `alreadyGranted` (functional hunks only) |
| `app/api/onboarding/allocate-free-tier/__tests__/route.test.ts`, `lib/services/__tests__/FreeTierGrantService.test.ts`, `lib/repositories/__tests__/UserSubscriptionRepository.test.ts` | new tests |
| `docs/V2_TEST_PAGE_SCOPE.md` | Tab 4 rewritten for the behaviour change, v1.9.2 changelog entry |
| `docs/workplans/BUSINESS_OS_LLM_AUDIT_TRAIL_WORKPLAN.md` | S-6 rows point here; Change History row |
| `docs/workplans/ALLOCATE_FREE_TIER_S6_FIX_WORKPLAN.md`, `docs/investigations/S6_FREE_TIER_ABUSE_CHECK.sql` | this workplan; the investigation SQL (unchanged by Dev, RC-8 already satisfied) |

**Commit B — `console.*` → `clientLogger` (SA.6, awaiting the user's yes/no):** the remaining hunks in `components/onboarding/hooks/useOnboarding.ts` (all 31 calls, plus the one added in the allocation block) and `app/test-plugins-v2/page.tsx` (2 calls). Both files carry hunks for both commits. To split them, RM stages the functional hunks first with `git apply --cached <patch>` using the functional-only patch Dev saved before the conversion (path given in Dev's hand-off to TL), commits A, then stages the rest for B. If the user declines B, reverting it means restoring those two files to the patch state.

### Test results

| Check | Result |
|---|---|
| `npx jest` — the 4 new suites | 4 suites, 75 tests, all pass |
| `npx jest` — new + related (`lib/audit`, `app/api/audit`, `app/api/onboarding`, `SystemConfigRepository.image`) | 10 suites, 189 tests, all pass |
| `npx tsc --noEmit` (whole project, 2,037 errors, pre-existing) filtered to touched files | 0 errors in new/changed code. 1 error in `useOnboarding.ts:210` (`updateMode` passes `'on-demand'` where `OnboardingState.mode` expects `'on_demand'`) is **pre-existing** in untouched code (same code at HEAD line 207) |
| `npm run lint` / `npx eslint` | First run: **not effective** ("File ignored because no matching configuration was supplied"; ESLint 9 picks the eslintrc-shaped `eslint.config.js`, SA F-7). Re-run after the SA review with `-c eslint.config.mjs`: see "SA code review fixes" below |
| Grep proof (T12) | Route: 0 `console.`, 0 `createClient(`; the only grant call is `grant(user.id, …)`. Also 0 `console.` in the service, both repositories, `useOnboarding.ts`, `page.tsx` |

Tooling note: the worktree has no `node_modules`. `npx jest` resolved the parent repo's install. `npx tsc -p .` failed with TS2688 (no `@types/jest` / `@types/node`), so tsc was run with a scratch config that extends the worktree `tsconfig.json` and only points `typeRoots` at the parent repo's `node_modules/@types`, with `--max-old-space-size=12288` (the default heap ran out of memory).

### SA code review fixes (2026-09-19)

| # | Change | Test |
|---|---|---|
| **RF-1 / F-1** | `FreeTierGrantService.grant()`: after the insert, `continue` only when `ins.data.conflict === true`. Any other `inserted: false` result throws (`'Free-tier insert returned no row and no conflict'` → 500), as §2.3 specifies, so a grant that landed can never be re-read as "already granted" without its ledger row and audit entry | **S7d**: insert returns `{ inserted: false, conflict: false }` → throws; insert called once, no re-read, update and ledger never called |
| **RF-1 / F-2** | `UserSubscriptionRepository.applyFreeTierGrant()`: more than one updated row is now an error (logged at error by the repository, returned as `{ error }`), so the service throws instead of retrying. Exactly one → `updated: true`; zero → `updated: false` | **U3 "RF-1 / F-2"**: 2 rows returned → `{ data: null, error }` with "updated 2 rows" |
| F-3 | Route hoists the session user id; the outer `catch` logs `{ err, userId }` | "F-3: a 500 after authentication logs the session userId" |
| F-4 | Ledger `{ error }` result is logged once: the repository logs the DB error (with `err`); the service logs one error line with the backfill context (`userId`, `rawTokens`) and no duplicate `err`. A thrown ledger error (not seen by the repository) still logs `err` in the service | S15 unchanged, still passes |
| F-5 | S8 now asserts config and pricing are not read on the frozen path. New **R9b**: a never-settling audit promise does not hold the 200 response | S8, R9b |
| F-6 | Blank line before the new section header in `lib/repositories/types.ts` | — |

Not changed: F-7 (repo-wide ESLint config duplication, TL tooling ticket), F-8 (accepted).

**Re-run results after the fixes:**

| Check | Result |
|---|---|
| `npx jest` on the 4 suites (main repo's `node_modules`) | 4 suites, **79 tests, all pass** (75 + S7d, U3 multi-row, R9b, F-3) |
| `tsc` scoped to the touched files (scratch config extending the worktree `tsconfig.json`, `files` = the 13 touched files, `typeRoots` → main repo) | 10 errors in total, **0 in new or changed code**. 1 in a touched file: `useOnboarding.ts:210` (pre-existing `'on-demand'` vs `'on_demand'`). The other 9 are in unrelated files pulled in by imports (`lib/analytics/aiAnalytics.ts` 6, `lib/pilot/insight/MemoryManager.ts` 2, `lib/repositories/CalibrationSessionRepository.ts` 1) |
| `npx eslint -c eslint.config.mjs` on the route, service, both repositories, the 4 test suites, `types.ts`, `index.ts`, `events.ts`, `useOnboarding.ts` | 4 findings, **all pre-existing**: `useOnboarding.ts:134-135` (`as any`), `lib/audit/events.ts:938` (unused `_`), `lib/repositories/types.ts:350` (`SystemSettingsConfig.value: any`). New code is clean |
| `npx eslint -c eslint.config.mjs app/test-plugins-v2/page.tsx` | 88 findings (84 errors, 4 warnings), the same count SA recorded, all pre-existing |
| Caller files | Not changed in this round. The functional-only patch was not regenerated; `git apply --cached --check` confirms it still applies |

### C1 / C2 fold-in (2026-09-20)

C1 passed (`user_credits_user_id_key`, a UNIQUE index on `user_subscriptions(user_id)`), so **no migration is written**. C2 came back negative, so the **ledger row was removed from the PR** rather than left dead behind a `false` switch:

| Change | Detail |
|---|---|
| Deleted | `lib/repositories/CreditTransactionRepository.ts` and `lib/repositories/__tests__/CreditTransactionRepository.test.ts` |
| `lib/services/FreeTierGrantService.ts` | `SHIP_FREE_TIER_LEDGER_ROW`, `LedgerStore`, `ledgerRepository`, `writeLedger` and `recordLedger()` removed, along with both call sites. A comment in their place records the C2 result, the forbidden `welcome_bonus` / `reward_credit` stand-ins, and the pointer to §8.1 F-4 |
| `lib/repositories/types.ts` / `index.ts` | `FreeTierLedgerEntryInput` and the `CreditTransactionRepository` / `FREE_TIER_GRANT_ACTIVITY_TYPE` exports reverted |
| Tests | Ledger-specific cases removed (S15's four cases, S16). Every other case kept, including the SA and QA additions. One new guard: the service source must not reference `CreditTransactionRepository` / `createFreeTierGrantEntry` / `SHIP_FREE_TIER_LEDGER_ROW`, or write to `credit_transactions` |
| Unchanged | The route, the repository, the audit entry and the response contract. `FREE_TIER_ALLOCATED` is now the only durable record of a grant beyond the subscription row's own columns |

**Re-run after the removal:**

| Check | Result |
|---|---|
| `npx jest` on the 3 remaining suites | **85 tests, all pass** (route 32, service 39, repository 14 — includes the SA and QA additions) |
| `npx jest` with `lib/audit` + `app/api/audit` | 6 suites, 180 tests, all pass |
| `tsc` scoped to the 11 touched files | 10 errors, **0 in new or changed code**: `useOnboarding.ts:210` (pre-existing) plus 9 in unrelated imported files (`aiAnalytics.ts` 6, `MemoryManager.ts` 2, `CalibrationSessionRepository.ts` 1) |
| `npx eslint -c eslint.config.mjs` on the touched files | 4 findings, **all pre-existing** (`useOnboarding.ts:134-135`, `lib/audit/events.ts:938`, `lib/repositories/types.ts:350`). New code clean |
| Caller files | Not touched in this round; the functional-only patch still applies |

### Deviations from SA's decisions

| # | SA said | Implemented | Why |
|---|---|---|---|
| DV-1 | RC-1: add `.eq('account_frozen', false)` to the update predicate | `.not('account_frozen', 'is', true)` (`account_frozen IS NOT TRUE`) | The column's nullability cannot be proven from the repo (no `CREATE TABLE`). With `= false`, a row whose flag is `NULL` would match 0 rows on every attempt and end in `RETRY_EXHAUSTED` (503) forever. `IS NOT TRUE` gives the same protection against a frozen row and treats `NULL` as not frozen, which matches the service's `account_frozen === true` check |
| DV-2 | RC-4: closed patch type | Closed type, **plus** `?: never` keys for `account_frozen`, `status`, `user_id`, `id`, `storage_used_mb`, `executions_used` | TS excess-property checks only apply to object literals; `?: never` makes those keys a compile error for any object. The repository also rebuilds the payload key by key, so a wider object cast past the compiler still cannot reach the DB (tested) |
| DV-3 | Conversion "mechanical" | Mostly mechanical. Three changes in `useOnboarding.ts`: the two "run this migration" lines became one `warn`; the seven "saved successfully" lines became one `info`; personal fields (full name, email, company, job title) are **no longer logged** (only timezone, goal, mode, domain, role) | Structured logging collapses multi-line prints naturally, and the browser console should not echo the owner's personal data |
| DV-4 | — | Config value `free_tier_duration_days` must be an integer `> 0`; storage and executions `>= 0`; pilot tokens `>= 0` (raw tokens must then be `> 0`, per Q8) | Q8 says "present but invalid → 500"; a zero or negative duration would give an already-expired grant, so it is treated as invalid |
| DV-5 | — | The route logs `'Free-tier grant requested'` at info on each authenticated call | Gives one line per call to join with the service's outcome line; no body content is logged |

No other deviations. Q1–Q8 and RC-1 to RC-9 are implemented as ruled; RC-8 was already satisfied by the investigation SQL.

### Pending gates (unchanged)

- ~~**C1**~~ — ✅ cleared 2026-09-20 (`user_credits_user_id_key`). No migration.
- ~~**C2**~~ — ✅ answered 2026-09-20, negative. Ledger removed; see §8.1 F-4.
- **C3** — triggers cleared (only the `updated_at` trigger). **RLS policies and grants still pending**: if `authenticated` can write `user_subscriptions`, that is a separate P0.
- **User yes/no** on Commit B.

---

## SA Code Review

**Code Review by SA — 2026-09-19**
**Status:** 🔄 **CHANGES REQUIRED (minor).** One required fix (RF-1) plus its test. Every security invariant the user asked for holds; RF-1 closes an audit/ledger gap on a path the approved algorithm said must throw. After RF-1, SA spot-checks that one hunk. No full re-review. Merge gates C1–C3 and the Commit B yes/no are unchanged.

### SCR.1 What was run

| Check | Result |
|---|---|
| `jest` on the 4 new suites (run from the worktree with the main repo's `node_modules/jest`) | ✅ 4 suites, 75 tests, all pass. ts-jest type-checks these files and everything they import |
| `tsc` scoped to the touched files (scratch tsconfig extending the worktree's, `files` = route, service, both repos, 4 test suites, `useOnboarding.ts`, `lib/audit/events.ts`, then again with `app/test-plugins-v2/page.tsx` added) | ✅ 0 errors in new or changed code. The one hit is `useOnboarding.ts:210` (`'on-demand'` vs `'on_demand'`), and it is **pre-existing** (same code at `origin/main` :205-209). The other errors are in unrelated files pulled in by imports (e.g. `lib/analytics/aiAnalytics.ts`) |
| ESLint | ✅ **Did run** with `eslint -c eslint.config.mjs`. The Dev's "file ignored" came from the repo having two configs: ESLint 9 picks `eslint.config.js` first, and that file is shaped for the old eslintrc format. Result: 0 new findings. The route, the service, both repositories and all 4 test suites are clean. `useOnboarding.ts:134-135` (`as any`) and `lib/audit/events.ts:938` (unused `_`) are pre-existing. `test-plugins-v2/page.tsx` has 88 pre-existing findings; the 6 that fall inside changed hunks are all untouched `any` lines (`useState<any>`, `catch (error: any)`) |
| Not run | `next build`, full-project `tsc`, any DB check (C1–C3 remain with TL/user) |

### SCR.2 RC verification (implemented, not just ticked)

| RC | Verdict | Evidence |
|---|---|---|
| RC-1 frozen never granted | ✅ | Service returns `INELIGIBLE_FROZEN` before any config read or write (`FreeTierGrantService.ts:235-238`). The update predicate also refuses frozen rows (`UserSubscriptionRepository.ts:159`, see DV-1). Route maps it to a 409 with a fixed body and no audit (`route.ts:123-127`). Tests: S8, the "frozen between read and write" case, U3b, R13 |
| Conditional-update filters | ✅ | `.eq('user_id', userId)`, `.is('free_tier_granted_at', null)`, `.not('account_frozen','is',true)`, and `.eq('balance', n)` or `.is('balance', null)` (`UserSubscriptionRepository.ts:153-162`). U3 asserts the exact filter chain and that `user_id` appears only once |
| RC-2 `23505` only; bounded loop | ✅ | Matches on `errorCode(error) === '23505'` only (`:108`). U2b checks that a "duplicate"-worded non-23505 error is treated as an error. The `for` loop is capped at `MAX_GRANT_ATTEMPTS = 3` on every path, including insert conflicts (`:221`, S7b) |
| RC-3 exhaustion logged at error | ✅ | `FreeTierGrantService.ts:313`, S7c. The 503 body is generic (`route.ts:131`) |
| RC-4 closed types | ✅ | `FreeTierGrantPatch` / `FreeTierNewRow` have no index signature; forbidden keys are `?: never` (DV-2). The repository still rebuilds the payload key by key (`:139-150`), and the "smuggled wider object" test proves it |
| RC-5 lower-cased compare | ✅ | `route.ts:72`, R11 |
| RC-6 prod errors | ✅ | `errorBody` adds `details` only in development and only as a string (`route.ts:28-30`). The service wraps DB errors in generic `Error` messages with `cause`, so even the development `details` never carries the PostgREST object. 401/403/409/503 bodies are fixed literals. R7 asserts no `details` key in production |
| RC-7 no writes on reject/repeat/frozen | ✅ | 401/400/403 return before `grant()`. `ALREADY_GRANTED` and `INELIGIBLE_FROZEN` return before `loadGrantConfig`, so there is no config read and no write, and they cost one SELECT. The ledger only runs after `inserted`/`updated` is true, and the audit only runs on `GRANTED`. Tests: S2 (asserts config, insert, update and ledger were not called), S8, S9, R2/R3/R5/R6/R12/R13 |
| RC-8 trigger query | ✅ | Already in the investigation SQL (Dev T15) |
| RC-9 SA test additions | ✅ | R10–R13, S3b, S7b, S7c, S13b, S16, U2b, U3b, exact-key assertions: all present |

### SCR.3 Rulings on the deviations

| # | Ruling | Reason |
|---|---|---|
| DV-1 `.not('account_frozen','is',true)` | ✅ **Accepted, and better than what SA asked for.** | PostgREST `not.is.true` is SQL `IS NOT TRUE`. It refuses a row frozen as `true` exactly as `= false` would. A `NULL` flag stays eligible, which matches the service's `=== true` check. With `= false`, a `NULL` row would end in a permanent 503 |
| DV-2 `?: never` keys | ✅ Accepted | It makes the type rule hold for non-literal objects too. Belt and braces with the key-by-key rebuild |
| DV-3 logging collapse + dropped personal fields | ✅ Accepted | See SCR.5. Dropping name, email, company and job title from the browser console is an improvement |
| DV-4 `durationDays > 0` | ✅ Accepted | A 0-day grant would expire on creation. That is "present but invalid" under Q8, so failing closed is right |
| DV-5 info line per call | ✅ Accepted | One line per call, no body content, and it joins with the service's outcome line through the child logger |

### SCR.4 Security

| Question | Finding |
|---|---|
| Body `userId` chooses the account? | **No.** It is only compared (`route.ts:71-79`). The only `grant` call is `grant(user.id, …)` (`:84`), and R3/R4/R11 prove it. The route has 2 callers (`useOnboarding.ts`, `test-plugins-v2/page.tsx`), and both now send `{}` |
| `account_frozen` written on an existing row? | **No.** The update payload is a fixed 7- or 8-key object with no `account_frozen` (`UserSubscriptionRepository.ts:139-150`). U3 asserts the exact key set, and the smuggling test proves extra keys are dropped. `account_frozen: false` appears only in the insert of a brand-new row (`:96`) |
| Partial grant? | **None in the balance/marker state.** The grant is one statement: either the insert, or the conditional update, which sets `balance`, `total_earned`, quotas and `free_tier_granted_at` together. **Ledger failing after the balance update: acceptable as ruled in Q4.** The grant is committed and correct. The failure is logged at error with `userId` + `rawTokens` for backfill (`FreeTierGrantService.ts:355-363`, S15), and the route's `FREE_TIER_ALLOCATED` audit entry is still written, so the grant has a second durable record. The missing ledger row does not change billing: renewal drops free-tier tokens either way |
| tenant-isolation-guard checklist | Service role + caller id: ✅ the caller id was removed as a target, and the id now comes from `getUser()`. Ownership pre-check: ✅ not needed, because the only row touched is the session user's; the 403 mismatch check covers the legacy field. Every caller-supplied id checked: ✅ there is only one. Allow-list: ✅ typed args, no spreads, `user_id` from auth, `id` never written. Scope-defeating three: ✅ no upsert, no payload injection (`.strict()` body plus a closed type plus the rebuild); triggers still depend on **C3**. Global catalog: n/a (`system_settings_config` is read through the existing repo, not user-scoped, which is correct). Queue runner: n/a. Tests: ✅ foreign id → 403 with no service call; injected fields → 400 |
| Informational | The route is a cookie-authenticated POST. A cross-site request could at most make a victim claim **their own** one-time grant, which is harmless, and Supabase cookies are `SameSite=Lax` anyway. No action |

### SCR.5 CLAUDE.md compliance

| Rule | Result |
|---|---|
| Repository pattern | ✅ No `.from()` outside `lib/repositories/`. Config goes through `systemConfigRepository.getByKeys`. `pilotCreditsToTokens(n, supabaseServer)` is the existing util, used unchanged (already on the §8 conformance list) |
| Service role documented | ✅ Header comments in both repositories explain why RLS is bypassed and what the tenant boundary is instead |
| Zod | ✅ `.strict()` body schema at the boundary; config Zod-validated in the service |
| Pino + correlationId | ✅ `createLogger({ module })`, child with `correlationId` then `userId`. 0 `console.*` in the route, the service, both repositories, `useOnboarding.ts` and `page.tsx` (grep verified) |
| Audit non-blocking | ✅ Not awaited, ends in `.catch(... 'Audit failed (non-blocking)')`, GRANTED only (R9) |
| No implicit `any` | ✅ tsc clean on the new code. The only `as never` casts are in test fixtures |
| No hardcoded model names | ✅ n/a, no LLM involved |
| `clientLogger` conversion | ✅ **No functional change.** Only log output changes. (a) Lines that became `logger.debug` are hidden in the production browser console, because `lib/logger.ts` sets the level to `info` in production. They were debug noise, so this is acceptable. (b) **No new PII.** The "about to save" and "saved successfully" lines no longer print full name, email, company or job title. What remains is timezone, goal, mode, domain, role, allocation amounts, pipeline template and stage count. (c) `{ err: profileError }` can carry the Postgres `details` of a failed row. That is the same object `console.error` printed before, so it is not a regression. `test-plugins-v2`: the two `DEBUG` lines became `debug` with `{ pluginKey }` only. Commit B's split still needs the user's yes/no (unchanged) |

### SCR.6 Findings

| # | File:line | Finding | Severity |
|---|---|---|---|
| **F-1** | `lib/services/FreeTierGrantService.ts:256-279` | The approved algorithm (§2.3) is `inserted → GRANTED; conflict → continue; else → throw`. The code checks only `inserted`, so an insert result of `{ inserted: false, conflict: false }` (no error, but not exactly one row returned, see `UserSubscriptionRepository.ts:115`) is treated as a lost race. If that insert *did* land, the re-read returns `ALREADY_GRANTED` and the account is granted with **no ledger row and no audit entry**. The path is very unlikely: PostgREST returns the inserted row under the service role. But it is a silent deviation from the ruled design on the one path where the audit trail must not go missing | **Medium** (required, RF-1) |
| F-2 | `lib/repositories/UserSubscriptionRepository.ts:167` | `updated` is `data.length === 1`. If more than one row were updated (only possible if C1 shows `user_id` is not unique), the rows *were* changed but this reports `updated: false`. The next re-read then fails on `maybeSingle` → 500, with no audit. C1 gates the merge, so this is fold-in, not blocking | Low (fold into RF-1) |
| F-3 | `app/api/onboarding/allocate-free-tier/route.ts:134` | The outer `catch` logs with `requestLogger`, so a 500 after authentication loses the `userId` context. Hoist `user` or log with `userLogger` when it is available | Low |
| F-4 | `FreeTierGrantService.ts:359/362` + `CreditTransactionRepository.ts:238` | A ledger failure is logged twice at error (repository, then service). Harmless, and the service line is the one with the backfill context | Low / informational |
| F-5 | tests | (a) S8 does not assert that config was not read on the frozen path (S2 does this for the repeat path). (b) R9 proves a *rejected* audit does not break the response, but not that a *never-settling* audit does not hold it. A `new Promise(() => {})` case would prove "not awaited" | Low (optional) |
| F-6 | `lib/repositories/types.ts:356` | The new section header directly follows the closing `}` with no blank line | Cosmetic |
| F-7 | repo-wide (out of scope) | Two ESLint configs. `eslint.config.js` is eslintrc-shaped and ESLint 9 picks it first, so direct `eslint` runs ignore every file. `next lint` may behave differently. TL to queue a tooling ticket; not part of this PR | Informational |
| F-8 | §8.1 F-2 | Quota columns can be overwritten by a concurrent quota-only change. Accepted as recorded (Low) | Accepted |

### SCR.7 Required fix

| # | Change | Test |
|---|---|---|
| **RF-1** | In `grant()`, after the `inserted` branch, `continue` **only** when `ins.data.conflict === true`. Any other `inserted: false` result throws (→ 500, logged), as §2.3 specifies. In the same pass (F-2), make the repository's update outcome distinguish "more than one row updated": log it at error and report it so the service throws instead of retrying silently | Add S7d: insert returns `{ inserted: false, conflict: false }` → throws, and ledger/update are never called. Add a U3 case: `data` has 2 rows → not reported as a clean `updated: false` |

F-3 and F-5 are recommended while the file is open. They are not gating.

### Code Approved for QA: **No, pending RF-1.** Once RF-1 and its tests are in, SA spot-checks that diff and approves for QA. The merge gates (C1, C2 → `SHIP_FREE_TIER_LEDGER_ROW`, C3 including triggers, and the user's Commit B yes/no) are unchanged.

### SA re-review (2026-09-19)

**Status:** ✅ **APPROVED for QA.** This spot-check covers only the RF-1 and F-3 to F-6 changes.

| Item | Result |
|---|---|
| RF-1 / F-1 | ✅ `FreeTierGrantService.grant()` now `continue`s only when `conflict === true`. Any other `inserted: false` throws, so a 500 can never be re-read as "already granted" without its ledger row and audit entry. S7d asserts it throws, the insert and read each ran once, and update and ledger were never called |
| RF-1 / F-2 | ✅ `applyFreeTierGrant` throws inside its try when more than 1 row comes back. That logs at error and returns `{ error }`, so the service fails closed with a 500 instead of retrying. The case only arises if C1 fails, and C1 still gates the merge. The new U3 case covers it |
| F-3 | ✅ The session id is hoisted, and the outer `catch` logs `{ err, userId }`. Tested |
| F-4 | ✅ The service logs one line with the backfill context and no duplicate `err`. A thrown ledger error still carries `err` |
| F-5 | ✅ S8 now asserts no config or pricing read. R9b proves a never-settling audit promise does not hold the 200 |
| F-6 | ✅ |
| Jest (re-run by SA) | 4 suites, **79/79 pass** |

The Dev's scoped tsc and ESLint results were taken as reported and not re-run for these hunks. Merge gates are unchanged: C1, C2 (which sets `SHIP_FREE_TIER_LEDGER_ROW`), C3 including triggers, and the user's yes/no on Commit B.

### SA final check — C1/C2/C3 delta (2026-09-20)

**Status:** ✅ **APPROVED.** Spot-check of the ledger removal and the DB-check fold-in only; the earlier code review and re-review stand.

| Check | Result |
|---|---|
| Dead references | ✅ None. Repo-wide grep for `CreditTransaction`, `creditTransactionRepository`, `FREE_TIER_GRANT_ACTIVITY_TYPE`, `SHIP_FREE_TIER_LEDGER_ROW`, `FreeTierLedgerEntryInput` and `from('credit_transactions')` returns only the unrelated pre-existing `components/settings/UsageAnalytics.tsx` interface and the new source-guard test. `lib/repositories/index.ts` and `types.ts` no longer export the ledger class or `FreeTierLedgerEntryInput`; the surviving `UserSubscription*` / `FreeTier*` types are all still used |
| Types / compile | ✅ `LedgerStore`, `ledgerRepository`, `writeLedger` and `recordLedger()` are gone from the service together with both call sites and the `FreeTierGrantServiceDeps` fields. The 3 suites compile and run under ts-jest, which type-checks them and everything they import |
| Error handling and response contract | ✅ Unchanged. The grant loop is byte-for-byte the same apart from the two removed `recordLedger` calls: same `ALREADY_GRANTED` / `INELIGIBLE_FROZEN` short-circuits, same RF-1 throw on "neither inserted nor conflict", same bounded retry and `RETRY_EXHAUSTED`. The route is untouched: same 200/401/403/400/409/503/500 mapping, same dev-only string `details` |
| Tests kept their teeth | ✅ The ledger-specific cases (S15, S16, the whole `CreditTransactionRepository` suite) were deleted along with the code, which is correct — they no longer assert anything real. No surviving test was hollowed out: S2 still asserts no config read, no `toRawTokens`, no insert and no update; S5, S7d, S8, S9, S14 still assert the write methods were never called; U2/U3 still assert the exact payload key sets and the full filter chain. A new source-level guard asserts `FreeTierGrantService.ts` contains no ledger reference and no `from('credit_transactions')`, so a future re-add cannot land silently, and it points at the F-4 migration |
| `FREE_TIER_ALLOCATED` is the only durable grant record | ✅ And it is written on **both** paths: the route audits every `GRANTED` result and carries `path: 'insert' \| 'update'` in `details` (`route.ts:89-107`). R1 covers the insert path, and there is a route test asserting the audit `details` for the update path (`storage_mb: 5000`, `executions: 50`, `path: 'update'`). It is still non-blocking and is never written on a repeat, frozen, 403 or 400 |
| C1 consequence | ✅ With `user_credits_user_id_key` confirmed UNIQUE, the insert path's 23505 semantics hold, and the `maybeSingle` fail-closed plus the multi-row update guard (F-2) are now belt and braces rather than load-bearing. No migration |
| C2 consequence | ✅ The Q4 fallback was applied as ruled: the code was **removed**, not left dead behind a flag. The stand-in ban (`welcome_bonus` / `reward_credit`) is recorded in code and in F-4. **Accepted trade-off:** a grant is now absent from `credit_transactions`, so ledger-based reconciliation must add it back by hand until F-4 lands. That matches the pre-fix behaviour, so it is not a regression |
| C3 triggers | ✅ Only an `updated_at` stamp, no cross-table write. Tenant-guard Step 4 clear. No SA re-review needed |
| C3 RLS / grants | ⛔ **Confirmed P0, written up as §8.2 (P0-FT-RLS) with a recommended fix shape.** SA independently verified the Dev's claim: all 10 browser-side `user_subscriptions` call sites are `.select(...)` only, so dropping the two write policies and revoking the write grants looks safe. **It does not block this PR** (SA.4 ruled this in advance) |
| Jest (re-run by SA) | 3 suites, **85/85 pass** |
| Doc nit (fixed by SA in this pass) | The §8 row about the investigation SQL Q3 still assumed a ledger row would exist; it is now marked obsolete and points at F-4 |

Remaining merge gate: **only the user's yes/no on the `console.*` conversion (Commit B).** C1, C2 and C3 are all resolved.

---

## SA Review — §9 (P0-FT-RLS)

**Reviewed by SA — 2026-09-20.** Workplan review and code review in one pass (the change is small).
**Status:** 🔄 **Fix Required** — two blocking items (RC9-1, RC9-2), four required before merge (RC9-3 to RC9-5, RC9-7). The diagnosis, the migration body and the two client swaps are otherwise correct and I approve them as written.

### 1. Blast radius — one writer is still missing (RC9-1, blocking)

I re-ran the sweep independently rather than trusting §9.3, because this is the item that becomes a silent production failure. Method: every `user_subscriptions` reference in `app/`, `components/`, `hooks/`, `lib/` (38 files), classified read/write; then **every** service that takes an injected `SupabaseClient` and writes the table traced to its construction sites; then `.rpc(`, SQL functions and triggers under `supabase/`; then non-TS files and `supabase/functions`.

Confirmed correct in §9.3:

| Path | Verdict |
|---|---|
| W-1 `run-agent` → `CreditService` | Real, and the fix is right. Both call sites pass `user.id` (`:109` `checkExecutionAllowed`, `:573` `chargeTokensWithIntensity`); the body's `user_id: provided_user_id` is only used at `:772` for execution attribution and never reaches `CreditService` |
| W-2 `stripe/update-subscription` | Real, fix right |
| W-3 `RewardService` from the two agent pages | Real; see §5 below for my ruling |
| `ExecutionService` (`StateManager:138`, user client) | Genuinely safe: `StateManager` only calls `checkExecutionAvailable` (SELECT) and `recordExecution`, whose only write is `rpc('increment_executions_used')`. I verified `SECURITY DEFINER` in `supabase/SQL Scripts/20251117000003_add_execution_quotas.sql:37` and `20251117_complete_quota_system.sql:264`, and `update_user_storage_used` at `:190` |
| `StorageService`, `QuotaAllocationService` | Only constructed with `supabaseAdmin` (webhook, sync-subscription) or in service-role scripts |
| `app/admin/{executions,storage}-config/page.tsx`, `data-export`, `admin/*`, `business-os/purge/descriptors.ts`, `accountDeletionPolicy.ts` | Reads or copy only — confirmed |

**Missed: W-4 — `app/api/stripe/create-checkout/route.ts`.** The file never mentions `user_subscriptions`, which is why both sweeps missed it: it passes its user-cookie `createServerClient` (anon key + cookies, `:17-27`) into `stripeService.createCustomCreditSubscription({ supabase, ... })` (`:90`) and `createBoostPackCheckout({ supabase, ... })` (`:129`). Both call `StripeService.getOrCreateCustomer(supabase, …)` (`lib/stripe/StripeService.ts:142`, `:237`), which **writes `user_subscriptions`**:

- `:79-82` `UPDATE { stripe_customer_id } WHERE user_id` on an existing row;
- `:85-91` `INSERT { user_id, stripe_customer_id, monthly_amount_usd: 10.00, monthly_credits: 20833 }` when no row exists.

Neither result is checked, so after the migration both fail with 42501 and are **silently discarded**. Consequences:

1. **Row exists (common):** `stripe_customer_id` is never persisted, so every checkout creates a *new* Stripe customer, and `/api/stripe/create-portal` (`:39-51`, reads `stripe_customer_id`) returns "No active subscription found" until the webhook repairs the row at `webhook/route.ts:645`.
2. **No row (a user who reaches billing without a free-tier grant):** this INSERT is the only thing that creates the row on that path. The webhook has **no insert fallback** — `handleCheckoutCompleted` does `.update(...).eq('user_id', userId)` (`:641-655`), which matches 0 rows and is *not* an error. **The user pays and is never credited**, and nothing logs it.

**Required:** pass `supabaseServer` for these two calls (cleanest one-line form: `supabase: supabaseServer`), or move the customer-id write behind `UserSubscriptionRepository`. Tenant scoping is unaffected: `getOrCreateCustomer` takes `userId` explicitly, every statement is `.eq('user_id', userId)`, and `create-checkout` derives it from `supabase.auth.getUser()`. The other reads sharing that client (`ais_system_config`, `boost_packs`) are config tables the anon role can already read, so the service role is neutral there. Add `create-checkout` to the pinned guard test, and add W-4 to §9.3 and to the migration header's "CODE THAT MUST SHIP FIRST" list.

**Nothing else was found.** With W-4 fixed I consider the blast radius closed for the app; the only remaining unknowns are live-schema objects that do not exist in the repo (the same caveat as §9.8), and the pre-check's STOP rule covers those.

### 2. The migration (approved, with RC9-3)

Correct and idempotent. Verified statement by statement: the two `DROP POLICY IF EXISTS` names match the live definitions in §9.1; the `REVOKE` leaves SELECT alone; `IF EXISTS` plus a no-op REVOKE make it re-runnable; the RLS pre-condition fails closed; the post-conditions run inside the same transaction, so any failure rolls the whole thing back; `has_table_privilege` is the right instrument because it also counts grants inherited from `PUBLIC`, and the remedy is in the comment. Dropping the `FOR ALL` policy costs no reads — three owner SELECT policies remain, and the post-condition asserts one survives along with `authenticated`'s SELECT grant. The rollback block reproduces the prior state exactly (`FOR ALL TO public USING (auth.uid() = user_id)` with no `WITH CHECK`, `FOR UPDATE` likewise, and the six grants) — checked against the §9.1 table rather than assumed.

**RC9-3 (required, concurrency).** `DROP POLICY` takes `ACCESS EXCLUSIVE` on `user_subscriptions`, a table read on every page load (`TokenDisplay`, `Footer`, dashboard) and written by the webhook. If anything holds a conflicting lock, this migration waits *and queues every subsequent query behind its lock request*. Add immediately after `BEGIN;`:

```sql
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
```

so it fails fast and harmlessly instead of stalling billing reads, and tell the user in §9.5 step 4 that a `lock_timeout` abort means "nothing changed, just re-run". Pin it in T-1.

**RC9-6 (should, low).** The pre-check selects `relforcerowsecurity` but §9.5 never says what to expect. Expect `false`, and escalate if `true`: with FORCE RLS on and the write policies dropped, a `SECURITY DEFINER` function owned by the table owner would start writing 0 rows silently. Also show `permissive` in the policy pre/post-check, and tighten the surviving-SELECT post-condition with `AND permissive = 'PERMISSIVE'` — a RESTRICTIVE-only SELECT policy would satisfy the current assertion and still break reads.

### 3. The two client swaps — tenant-isolation-guard (pass)

Applied `.claude/skills/tenant-isolation-guard/SKILL.md` to both:

| Step | `run-agent` | `stripe/update-subscription` |
|---|---|---|
| Service role + caller-supplied id? | Service role; id from `supabase.auth.getUser()` on the same request | Same |
| Ownership pre-check | Not needed: the id *is* the session id, never a body value (`provided_user_id` is not used on this path) | Not needed, same reason |
| Field allow-list | `chargeTokensWithIntensity` writes `balance`, `total_spent`, `agents_paused`, all `.eq('user_id', userId)`; no spread | Literal two-key payload (`monthly_amount_usd`, `monthly_credits`), `.eq('user_id', user.id)` |
| Scope-defeating three | No upsert on these paths; the only trigger is the `updated_at` stamp (C3); no payload injection | Same |

Both comments state *why* the service role is used, per the Security Rules. The knock-on writes the service role now performs (`credit_transactions`, `billing_events` inside `CreditService`) are all `user_id`-scoped to the same session id. No RLS bypass beyond the intended one.

**RC9-5 (required, medium) — D-4 is not acceptable as-is.** It was pre-existing, but this is the statement we are editing, it is now the *only* path that persists a paid plan change, and the failure mode of this entire cycle is "a write silently does nothing". Capture the result:

```ts
const { error: subUpdateError } = await supabaseServer.from('user_subscriptions').update({ ... }).eq('user_id', user.id);
```

…log it and return 500. That needs a logger in a file with **3 `console.*` calls** (`:53`, `:56`, `:113`), which CLAUDE.md § Logging requires you to flag and offer to convert anyway — FT-RLS-4 records it, but it must be **put to the user as part of the same yes/no as Commit B**, not silently deferred. If the user declines the conversion, still capture the error and return 500 using the existing `console.error`.

### 4. Apply guide §9.5 (RC9-2 blocking, RC9-4 required)

**The ordering is right and the reasoning is right: deploy the code first, then apply the migration.** `supabaseServer` behaves identically before and after the migration, so there is no window in which the new code is wrong; the reverse order is the dangerous one. Make that cost explicit in step 1, because it is the whole point: if the migration goes first, `chargeTokensWithIntensity` throws 42501 into the `catch (spendingError)` at `run-agent/route.ts:600-604`, which logs *"Failed to track token consumption"* as non-fatal and continues — so **every agent run completes and charges nothing**, with no failed request and no user-visible error. Detection would be "balances stopped moving".

**RC9-4 (required):** add to step 1 — (a) W-4 must be in the same deploy; (b) wait for the Vercel promotion to complete, then run one agent on a test account and confirm the balance moved *before* applying, since in-flight invocations of the previous deployment can still serve requests briefly.

**RC9-2 (blocking): step 6's browser check cannot run as written.** The app's browser client is `createBrowserClient` from `@supabase/ssr` (`lib/supabaseClient.ts`), which keeps the session in **cookies**, not `localStorage`. `Object.keys(localStorage).find(x => x.startsWith('sb-') …)` returns `undefined`, and `JSON.parse(localStorage.getItem(undefined))` throws before the check runs — the user would conclude the environment is broken, or skip the verification entirely. Replace it with a cookie-based read of the chunked `sb-<ref>-auth-token` cookie (handle the `base64-` prefix and the `.0`/`.1` chunk suffixes), or — simpler for a one-off — tell the user to copy the `apikey` and `Authorization` headers from any existing `/rest/v1/user_subscriptions?select=…` request in the Network tab and reuse them in the two `fetch` calls. Dev must run the replacement snippet once in a browser before handing it over.

State the three outcomes explicitly, because they mean different things:

| Result of the PATCH | Meaning |
|---|---|
| 401/403 with `42501 permission denied for table user_subscriptions` | ✅ The grant revoke landed — this is the proof |
| 2xx / 204 with 0 rows affected | ⚠️ Policies dropped but grants still present (or a `PUBLIC` grant) — escalate, the hole is only half closed |
| 2xx and `balance` actually changed | ⛔ Nothing applied — stop |

The "run (b) only after applying" warning is good and should stay.

### 5. W-3 / D-3 — my ruling on the question put to the user

**Recommendation: ship the lock-down first. Do not build the server-side reward route in this cycle.** It is a credit-granting API — auth, Zod, idempotency per (user, agent), audit — and it needs its own SA pass. Bolting it onto a P0 either delays the P0 or ships a second credit-granting hole. And what is being "lost" is a path that is itself the vulnerability: `RewardService.awardAgentSharingReward` upserts `balance` straight from the browser, so today any signed-in user can replay that upsert and mint credits at will. Leaving it broken is strictly safer than leaving it working.

**But the code must not fail silently, and today it does.** I checked the service and both call sites:

- `lib/credits/rewardService.ts:187-196` returns `{ success: false }` on the upsert error and — importantly — returns **before** writing `credit_transactions` or `user_rewards`. A post-migration failure therefore leaves no partial ledger state, and the reward can be back-filled later. Good.
- `app/v2/agents/[id]/page.tsx:1907-1916`: on `success === false` **nothing happens at all** — no banner, no error, and `setHasBeenShared(true)` sits inside the success branch, so the Share button stays enabled and the next click alerts *"This agent has already been shared!"*. That is the worst of the three outcomes.
- `app/(protected)/agents/[id]/page.tsx:802-812`: shows the success notification with `creditsAwarded = 0` — it celebrates a reward of zero.

**Required in this cycle (small, client-only):** in both pages treat `success === false` as "shared, reward not applied" — set the shared state, show an explicit message along the lines of *"Agent shared. The credit reward could not be applied right now and will be credited later."*, and log the reward error through `clientLogger.error` (the `(protected)` page uses `console.*`; the same flag-and-offer rule applies). Do **not** close this by re-granting the browser write. FT-RLS-1 should also record that the back-fill is derivable from `shared_agents` rows with no matching `user_rewards` row, since I verified that state stays clean.

### 6. Decisions D-1 to D-4

| # | Ruling |
|---|---|
| D-1 keep the three duplicate SELECT policies | ✅ Agreed. Identical owner reads, no security value in churning them during a P0, real risk of a read outage. FT-RLS-2 is the right home |
| D-2 keep `anon`'s SELECT grant | ✅ Agreed, and the reasoning is correct: the owner policies require `auth.uid() = user_id`, which is NULL for `anon`, so the grant is inert, and revoking it converts pre-hydration reads from "0 rows" into 403s on `TokenDisplay` / `Footer` / dashboard. This supersedes my §8.2 step 2 |
| D-3 leave the browser reward path broken | ✅ Agreed on the *migration* decision — with the loud-failure requirement in §5 attached |
| D-4 no error check on the Stripe update | 🔄 Rejected — see RC9-5 |

### 7. The static test

It does pin the invariants that matter — one transaction, exactly two `DROP POLICY` by name, exactly one `REVOKE` that never names SELECT, no `GRANT`/`CREATE POLICY`/`ALTER POLICY`/`ALTER TABLE`/DML, the RLS fail-closed guard, each post-condition, the documented pre-check/post-check/rollback, and the "ship this code first" header. Stripping comment lines before asserting on the body is the right call, and the `ownerPolicyMigration` precedent means this is not a new pattern. The source guards are a genuine regression net for W-3 (a third `RewardService` caller fails the suite) and for the two swaps.

Gaps to close alongside the fixes:

1. Add the W-4 assertion (`create-checkout` passes `supabaseServer` into the two `stripeService` calls).
2. The write scan only matches `from('user_subscriptions')` with single quotes — add the double-quoted variant.
3. Pin the `SET LOCAL lock_timeout` line from RC9-3.
4. Say in the file header what the guards **cannot** catch: a write through a service that receives an injected client — exactly how W-4 hid. That is review discipline, not a test.

### 8. Required changes (summary)

| # | Change | Priority |
|---|---|---|
| **RC9-1** | Fix W-4: `create-checkout` must pass `supabaseServer` into `createCustomCreditSubscription` / `createBoostPackCheckout` (or route the `getOrCreateCustomer` write through a repository). Update §9.3, the migration header's ship-first list, and the guard test | **Blocking / High** |
| **RC9-2** | Replace the `localStorage` session lookup in §9.5 step 6 with a cookie-based (or Network-tab) snippet, verified once in a browser; document the three PATCH outcomes | **Blocking / High** |
| **RC9-3** | `SET LOCAL lock_timeout` / `statement_timeout` after `BEGIN;`, plus the "re-run on a lock timeout" note in step 4 | Required / Medium |
| **RC9-4** | §9.5 step 1: W-4 in the same deploy; wait for the promotion and verify one charged run before applying; spell out that the reverse order silently stops all token charging (`run-agent:600-604` swallows it) | Required / Medium |
| **RC9-5** | Capture and log the `update-subscription` write result and return 500 on failure; put that file's 3 `console.*` calls to the user with Commit B | Required / Medium |
| **RC9-7** | Make the browser reward path fail loudly in both agent pages (no silent no-op, no 0-credit celebration); record the back-fill query in FT-RLS-1 | Required / Medium |
| RC9-6 | Pre-check: expect `relforcerowsecurity = false`, show `permissive`; post-condition requires a PERMISSIVE SELECT policy | Should / Low |
| RC9-8 | Comment at `StateManager:138` that its `ExecutionService` holds the user client, so quota-writing methods must never be called from there | Should / Low |
| RC9-9 | Test file: double-quoted `from("user_subscriptions")` variant; note what the guards cannot catch | Nice / Low |

### 9. Optimisation suggestions (non-blocking)

- FT-RLS-3 (`increment_executions_used` is `SECURITY DEFINER` with no `auth.uid()` check and EXECUTE open to any caller) is a real second hole found by this sweep and deserves its own P1 entry rather than a workplan footnote — after this migration it is the only remaining way a signed-in user can move another account's quota numbers.
- §9.8's live query is the right next step for the sibling tables; the `payment_*` cluster should be the priority now that Business OS records money against those rows.
- Once FT-RLS-1 lands, `RewardService` should stop accepting a browser client at all (server-only constructor), so the pattern cannot come back.

### Code Approved for QA: **No** — re-review after RC9-1 to RC9-5 and RC9-7. The migration must not be applied to production until RC9-1 is deployed.

---

## SA Re-review — §9 (P0-FT-RLS)

**Reviewed by SA — 2026-09-20 (spot-check of the RC9-1 to RC9-9 fixes).**
**Status:** ✅ **Approved for QA** — all nine items land correctly. Two documentation-only corrections must be made to §9.5 step 6 **before the user runs the browser verification** (N-1, N-2); they do not block QA or the commit. Three Low notes recorded.

### What I checked

| Item | Verdict |
|---|---|
| **RC9-1** `create-checkout` | ✅ Both calls take `supabase: supabaseServer` (`:100`, `:140`) with a comment naming the failure mode. **Tenant isolation holds:** `userId: user.id` comes from `supabase.auth.getUser()`, `getOrCreateCustomer` scopes every statement `.eq('user_id', userId)`, no body value reaches it, no upsert, no spread. The other reads that now travel on the service-role client are `ais_system_config` and `boost_packs` — global config the anon role already reads, so no scope was lost. The cookie client is still used for auth and the `profiles` read, which is correct. W-4 is in §9.3, in the migration header's ship-first list, and in T-12 |
| **RC9-2** browser check | ✅ Correct diagnosis and a good structure. **Option A alone is sufficient to prove 42501** — "Copy as fetch" carries a live `apikey` + `Authorization` and needs no parsing — *provided* N-1 and N-2 below are added. Option B's parser reads correctly to me (chunk `.sort()`, `base64-` prefix, url-safe alphabet, `decodeURIComponent`, and a clear throw when there is no cookie); shipping it unverified-in-browser is acceptable **because** option A exists and is flagged as the fallback, and the caveat is stated honestly in the doc |
| **RC9-3** lock guards | ✅ `SET LOCAL lock_timeout = '3s'` / `statement_timeout = '30s'` are inside the transaction and before the `DROP POLICY`s, so they cover the ACCESS EXCLUSIVE wait. Idempotency is untouched (`SET LOCAL` dies with the transaction; `IF EXISTS` + no-op REVOKE unchanged). The abort table in step 4 says the right thing: a lock timeout changed nothing, just re-run |
| **RC9-4** ordering | ✅ Step 1 is now unambiguous for a non-DBA: deploy W-1/W-2/W-4 → wait for the promotion → run one agent and watch the balance move → then apply, with the reverse-order cost spelled out (`run-agent/route.ts:600-604` swallows the 42501 as non-fatal, so runs complete and charge nothing). R-7 added |
| **RC9-5** Stripe write | ✅ `const { error: subUpdateError }`, Pino error line, 500 with a support-facing message and `details` only in development. The comment correctly explains *why* it must be loud (Stripe has already been charged). The 3 `console.*` conversions are genuinely inseparable from the error path — riding with the P0 commit is the right call, and §9.9 says so |
| **RC9-6** pre/post-check | ✅ `rls_forced = false` expectation with the FORCE-RLS reasoning, `permissive` in the output, and the post-condition now requires a **PERMISSIVE** SELECT policy (`cmd = 'SELECT' AND permissive = 'PERMISSIVE'`) — correct column and correct literals |
| **RC9-7** UI | ✅ Neither page can now mislead. V2 (`:1916-1930`) sets `hasBeenShared`, logs via `clientLogger.error` and tells the user plainly; the `(protected)` page (`:808-821`) no longer fires the success notification with `creditsAwarded = 0`. Both messages state the reward was *not* applied — no credit number is shown. The new `clientLogger` calls use the correct Pino object-first form |
| **RC9-8** StateManager | ✅ The comment names the exact methods that must never be called from that instance and why |
| **RC9-9** test file | ✅ Double-quoted `from("…")` variant added, and the header now states that a textual guard cannot see an injected-client writer — the W-4 lesson is recorded where the next person will read it |

**Tests:** I re-ran the suite myself in the worktree (`node ../../../node_modules/jest/bin/jest.js --rootDir .`): **15/15 pass**. The new assertions pin what they claim — T-12 checks two occurrences of `supabase: supabaseServer` *and* rejects the bare `supabase,` shorthand; T-13 checks the captured error, the `if (subUpdateError)` branch, the 500 and the absence of `console.`; the RC9-7 test pins both user-facing strings. I did not re-run the `lib/pilot` suites; the Dev's pre-existing claim is plausible (the only change there is a comment block) and QA can confirm cheaply.

### Required before the user runs step 6 (documentation only)

| # | Item | Why |
|---|---|---|
| **N-1** | Option A must say: **add `'Content-Type': 'application/json'` to the copied headers** before switching the method to `PATCH`. Chrome's "Copy as fetch" of a `GET` does not include it, and PostgREST rejects a body without it with **415** — an ambiguous result that proves nothing about 42501 | The whole point of step 6 is an unambiguous verdict |
| **N-2** | Both options should add `Prefer: return=representation` to the PATCH headers, and the outcome table should read the response **body**: `[]` = 0 rows (⚠️ half-closed), a returned row = ⛔ nothing applied | As written, a bare PATCH returns `204` with no body, so the user cannot actually distinguish the ⚠️ row of the table from success. This is the row that catches "policies dropped but grants still present" |

### Low notes (non-blocking)

- **L-1:** the catch-all in `update-subscription` still returns `error.message` to the client (`:136-138`), which the Security Rules forbid in production. Pre-existing, but it is now three lines from code we edited — worth the one-line fix (`'Failed to update subscription'`, `details` dev-only) while the file is open.
- **L-2:** FT-RLS-5 lists the two agent pages (54 + 24 `console.*`) for the user's go-ahead, which is the right handling. Add `lib/pilot/StateManager.ts` (**84 calls**) to the same entry for completeness — the touch there is comment-only, so it clearly should not be converted inside this P0.
- **L-3:** the user-facing string promises the reward "will be credited later". That is a commitment that only FT-RLS-1 can honour, and the back-fill source (`shared_agents` rows with no matching `user_rewards` row) is recorded — keep FT-RLS-1 prioritised, or soften the wording.
- The workplan states the user has already approved converting `console.*` in touched files; TL should confirm that against the user's own message rather than the workplan. It does not change the outcome here — the `update-subscription` conversion is required by the RC9-5 error path regardless.

### Code Approved for QA: **Yes.** Apply-to-production remains gated on the deploy of W-1/W-2/W-4 first (§9.5 step 1) and on N-1/N-2 being folded into step 6 before the user runs the verification.

---

## QA Testing Report — §9 (P0-FT-RLS)

**QA — 2026-09-20**
**Verdict: ✅ PASS.** No bugs. No fifth RLS-respecting write path exists. Five Low edge cases (one of them SA's carried-over L-1) are recorded below; none blocks the commit.
**Test mode:** full, on the §9 change only (S-6 was signed off on 2026-09-19 and is already on `main` — `git diff origin/main...HEAD` is empty, so the entire delta under test is the seven-file working tree).
**Strategy used:** A + C — Jest static/source guards (the migration is DDL and the swaps are wiring, so there is nothing to exercise at runtime without a DB), plus an **independent, hand-traced blast-radius sweep** that did not reuse §9.3 or SA's list.
**Focus:** security (RLS / tenant isolation), api, schema (the migration).
**Skipped:** E2E (Playwright is not installed — CLAUDE.md § Testing), and every form of DB access (hard rule: no DB, no dev server, no production-code edits, no commit).
**Input source:** TL prompt (seven explicit verification points) + workplan §9.6.

> ⚠️ **Context: production is in the broken window right now.** The migration was applied to production **before** the code shipped, i.e. the reverse of §9.5 step 1. The four consequences are live and silent — see [Production damage assessment](#production-damage-assessment-the-broken-window) and the [post-deploy verification list](#post-deploy-verification-list-for-the-user-prod-is-already-migrated).

### 1. Independent sweep — is there a fifth RLS-respecting writer? **No.**

Not taken from §9.3 or from SA's list. Method: (a) every `from('user_subscriptions')` / `from("user_subscriptions")` in `app/`, `components/`, `hooks/`, `lib/` classified by op; (b) **every** class or function that takes an injected `SupabaseClient` and writes the table, then traced to **all** of its construction sites (this is how W-4 hid); (c) every `.rpc(` in the repo; (d) every SQL function and trigger under `supabase/` that writes the table; (e) `supabase/functions`, `supabase/held`, `supabase/seeds`; (f) raw `fetch` to `/rest/v1/user_subscriptions`; (g) the Business OS purge engine (the table appears in `lib/business-os/purge/descriptors.ts:318`).

| # | Channel | Finding |
|---|---|---|
| a | Direct `.from()` writers | 12 modules, all enumerated and pinned in the new QA test. All service-role except the two documented exceptions |
| b | Injected-client writers | `CreditService`, `ExecutionService`, `StorageService`, `StripeService`, `RewardService`, `UserSubscriptionRepository`. **All construction sites found:** `CreditService` → only `run-agent` (now `supabaseServer`); `StorageService` → only `QuotaAllocationService` (always `supabaseAdmin`); `ExecutionService` → `QuotaAllocationService` (admin) and `StateManager` (cookie client, read + RPC only — verified, RC9-8); `StripeService` takes its client per-call and **only `create-checkout` passes one** (both sites now `supabaseServer`); `RewardService` → the two agent pages (D-3); `UserSubscriptionRepository` defaults to `supabaseServer` and is only used via its singleton |
| c | `.rpc(` | Exactly one reaches the table: `increment_executions_used` — `SECURITY DEFINER`, so it is unaffected. Confirmed in `supabase/SQL Scripts/20251117000003_add_execution_quotas.sql:33-44` |
| d | SQL functions / triggers | `update_user_storage_used()` (trigger on `storage_usage`) is `SECURITY DEFINER` — confirmed at `20251117_complete_quota_system.sql:176-190`. The only non-internal trigger on the table is the `updated_at` stamp (C3) |
| e | Edge functions / held / seeds | No reference to the table |
| f | Raw PostgREST `fetch` | None |
| g | Purge engine | `never('user_subscriptions', …)`; `descriptors.ts:393` excludes `level === 'never'` from every purge/reset plan, and `purge_business_data` is service-role. No write |

**Conclusion: the four known paths are the complete set.** W-1, W-2, W-4 are fixed; W-3 is the deliberate exception.

### 2. Test Coverage — the TL's seven verification points

| # | Criterion | Tested? | Result | Notes |
|---|---|---|---|---|
| 1 | Every RLS-respecting write to `user_subscriptions` is gone | ✅ | **Pass** | Seven-channel sweep above. No fifth path. Now pinned by two new QA allow-list guards so the next one fails in CI, not in production |
| 2a | W-1 `run-agent` / CreditService charge | ✅ | **Pass** | `new CreditService(supabaseServer)` (`:94`). Both call sites (`:109` `checkExecutionAllowed`, `:573` `chargeTokensWithIntensity`) pass `user.id` |
| 2b | W-2 `stripe/update-subscription` | ✅ | **Pass** | `supabaseServer.from('user_subscriptions').update({monthly_amount_usd, monthly_credits}).eq('user_id', user.id)` (`:83-92`) |
| 2c | W-4 `stripe/create-checkout`, **both** call sites | ✅ | **Pass** | `supabase: supabaseServer` at `:100` and `:140`; `userId: user.id` in both blocks; the bare `supabase,` shorthand is gone. `getOrCreateCustomer` is the only writer reached and is `.eq('user_id', userId)` on all three of its scoped statements, with an explicit `user_id: userId` on the INSERT and **no upsert** |
| 2d | W-3 browser RewardService — left failing, loudly, on both pages | ✅ | **Pass** | Both pages now log through `clientLogger` (object-first Pino form) and alert the user. Neither can reach its credits banner from the failure branch — verified structurally, not just textually (see §4) |
| 3 | The swaps keep user scoping (tenant-isolation-guard) | ✅ | **Pass** | All three ids come from `supabase.auth.getUser()` on the same request. `run-agent` does destructure `user_id: provided_user_id` from the body, and it **never reaches `CreditService`** — now pinned by a guard. Field allow-lists hold: the Stripe patch writes exactly `monthly_amount_usd` + `monthly_credits`, never `balance` / quotas / `account_frozen` / `user_id` |
| 4 | Migration content + post-conditions match the user's post-check | ✅ | **Pass** | See §3 |
| 5 | RC9-5 error path in `update-subscription` | ✅ | **Pass** | `const { error: subUpdateError }` → `logger.error({ err, userId, newPilotCredits }, …)` → 500 with a support-facing message and `details` only when `NODE_ENV === 'development'`. It returns **before** the `billing_events` insert, so a failed write cannot leave a misleading billing event |
| 6 | RC9-7 UI cannot claim credits it did not grant | ✅ | **Pass** | See §4 |
| 7 | Suites + the "5 pre-existing `lib/pilot` failures" claim + ESLint vs HEAD | ✅ | **Pass** | See §5. The claim is **confirmed, and proved without touching the shared stash** |

### 3. The migration vs what production already has

`supabase/migrations/20261001_user_subscriptions_write_lockdown.sql`, re-read line by line.

| Check | Result |
|---|---|
| One transaction, `SET LOCAL lock_timeout='3s'` / `statement_timeout='30s'` **before** the first `DROP POLICY` | ✅ |
| Drops exactly the two `USING`-only write policies by name, `IF EXISTS` (re-runnable) | ✅ |
| Revokes `INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER` from `anon, authenticated`; one `REVOKE`; never names `SELECT`; no `GRANT`, no `CREATE/ALTER POLICY`, no `ALTER TABLE`, no data statement | ✅ |
| Fails closed if `relrowsecurity` is false | ✅ |
| In-transaction post-conditions: no named write policy survives; `has_table_privilege` (which counts PUBLIC-inherited grants) is false for both roles × all six privileges; a **PERMISSIVE** SELECT policy survives; `authenticated` keeps SELECT | ✅ |
| **Post-conditions equal the user's live post-check** | ✅ **Match.** The file's POST-CHECK block predicts exactly: `rls_enabled = true`, `rls_forced = false`; four policies left — the three `Users can view …` SELECT policies (PERMISSIVE) + `Service role can manage all credits`; `anon`/`authenticated` holding SELECT and nothing else. That is the user's reported output, item for item |
| N-1 / N-2 folded into §9.5 step 6 before the user runs the browser check | ✅ Both present in option A and option B (`Content-Type: application/json`, `Prefer: return=representation`, and the three-outcome table now reads the body) |

`Service role can manage all credits` (cmd `ALL`, roles `public`) survives by design and is inert twice over: its `USING` requires a `service_role` JWT, and after the revoke neither reachable role holds a write privilege.

**QA cannot prove which revision of the file the user pasted** (there is no DB access, and the file is uncommitted). That does not matter: the post-check output they reported is the migration's own stated post-condition, so the *effect* on production is the intended one. Recorded so RM does not read this as a live-verified apply.

### 4. RC9-7 — the UI cannot claim credits it did not grant

Checked the whole path, not just the strings.

- `RewardService.awardAgentSharingReward` returns `{ success: false, creditsAwarded: 0 }` **immediately** on the `user_subscriptions` upsert error (`rewardService.ts:187-195`), before the `credit_transactions` insert and before the `user_rewards` upsert. **So `success: true` always means the balance write landed** — the UI's success branch cannot fire on a blocked write. This also makes FT-RLS-1's back-fill claim sound (no partial ledger state; the owed rewards really are the `shared_agents` rows with no matching `user_rewards` row). Now pinned by a QA ordering guard.
- `app/v2/agents/[id]/page.tsx`: `setShareCreditsAwarded(` and `setShowShareSuccess(true)` each appear exactly once, both inside the success branch. The failure branch sets `hasBeenShared` (so the Share button cannot be re-clicked into "already shared!"), logs, and alerts.
- `app/(protected)/agents/[id]/page.tsx`: `setCreditsAwarded(rewardResult.creditsAwarded)` and `setShowSuccessNotification(true)` each appear exactly once, in the success branch. Previously the failure branch fired the notification with `creditsAwarded = 0`, which rendered "Agent shared with community" — not a false credit claim, but a success banner on a failure. That is now gone. `setHasBeenShared(true)` still runs after the branch, as before.

### 5. Test, lint and regression runs (QA's own, in the worktree)

Jest via the parent checkout's binary (`node ../../../node_modules/jest/bin/jest.js`); ESLint via `-c eslint.config.mjs`.

| Run | Result |
|---|---|
| Dev's `userSubscriptionsWriteLockdownMigration.test.ts` | **15/15 pass** — matches §9.6 |
| QA's new `userSubscriptionsWriteLockdown.qa.test.ts` | **10/10 pass** |
| Related set **excluding** `lib/pilot` (`lib/repositories/__tests__`, `FreeTierGrantService`, `app/api/onboarding`, `app/api/stripe`, `ownerPolicyMigration`) | **27 suites / 275 tests, all pass** |
| Same set **including** `lib/pilot` | 59 suites / 780 tests — **54 suites / 741 tests pass; 5 suites / 39 tests fail** |
| `lib/pilot` alone | 32 suites / 505 tests — the same 5 suites / 39 tests fail |
| ESLint, every touched file, worktree vs `git show HEAD:<file>` piped through `--stdin` | **Identical counts on all six pre-existing files** (`run-agent` 20 / 20, `create-checkout` 1 / 1, `update-subscription` 4 / 4, `app/v2/agents/[id]/page.tsx` 96 / 96, `app/(protected)/agents/[id]/page.tsx` 42 / 42, `StateManager` 20 / 20). Dev's new test file **0**, QA's new test file **0** |

**The "5 pre-existing failures" claim is confirmed — and proved without `git stash`** (the stash stack is shared with other sessions). Two facts settle it:

1. `git diff --stat origin/main...HEAD` is **empty** — the S-6 commits are already on `main`, so HEAD is byte-identical to `origin/main`.
2. `git diff -U0 -- lib/pilot | grep -E '^[+-]' | grep -vE '^[+-]\s*(//|\*|/\*)'` returns **0 lines** — the entire `lib/pilot` change is comment text.

So every file the five suites load is byte-identical to `origin/main`. The failures (`StructuredTransforms`, `.wp33`, `.wp37`, `ConditionalEvaluator`, `.contains_any`, all `TypeError: context.isConditionalCoercionEnabled is not a function` at `ConditionalEvaluator.ts:121`) are test-fixture debt on `main`: the suites hand `evaluate()` a hand-built mock context that lacks the method, which `ExecutionContext.ts:216` does provide. No suite in `lib/pilot/__tests__` even references `StateManager`. **Unrelated to this cycle; not a release blocker for P0-FT-RLS.** Worth its own small clean-up ticket.

### 6. Tests added by QA (tests only, no production code touched)

**New file:** `lib/repositories/__tests__/userSubscriptionsWriteLockdown.qa.test.ts` — 10 tests. Dev's file pins the migration and the three known call sites; these add the nets that would have caught W-4 as a *discovery* rather than a regression, plus the scoping and UI guards.

| # | Test | Why it was missing |
|---|---|---|
| QA-1 | **Table-level writer allow-list** — every module in `app`/`components`/`hooks`/`lib` that follows `from('user_subscriptions')` with `.update/.insert/.upsert/.delete`, pinned as a sorted list of 12 with the client annotated per entry | Dev's guards only assert the *absence* of a browser writer and the *presence* of three fixed call sites. A new server writer on a cookie client passes both. This fails on any new writer, whatever client it uses |
| QA-2 | **Injected-client construction allow-list** — every `new CreditService/ExecutionService/StorageService/QuotaAllocationService(<arg>)` in the repo, pinned as `file::Name(arg)` | The exact W-4 shape. A future `new CreditService(supabase)` in a *different* route passes every existing guard (Dev's is hard-coded to `run-agent`) |
| QA-3 | `StateManager` still calls only `checkExecutionAvailable` + `recordExecution`, and `recordExecution` is still on the `increment_executions_used` RPC | RC9-8 is a **comment**. Nothing enforced it. Adding `updateExecutionQuota` there would fail 42501 in production and nothing would have caught it |
| QA-4 | `create-checkout` is the only file passing a client to `StripeService`, **and** `getOrCreateCustomer` / `createCustomCreditSubscription` / `createBoostPackCheckout` are still the only three methods that accept one | A new client-taking StripeService method, or a second caller, re-opens W-4 |
| QA-5 | `run-agent` — every `creditService.*` argument is `user.id`; `provided_user_id` / `executionUserId` never reach it | R-6. Nothing pinned the tenant scoping of the service-role swap |
| QA-6 | `update-subscription` — the `supabaseServer` statement is `.eq('user_id', user.id)` and its payload keys are exactly `monthly_amount_usd` + `monthly_credits` (no `balance`, quotas, `account_frozen`, `user_id`) | Field allow-list on a service-role write; RLS no longer backstops it |
| QA-7 | `create-checkout` — both `stripeService.create*` blocks carry `supabase: supabaseServer` **and** `userId: user.id`; `getOrCreateCustomer` is `.eq('user_id', userId)` on all three scoped statements, `user_id: userId` on the INSERT, and has **no upsert** | Dev's test counts occurrences file-wide; this pins them per call block and covers the callee's own scoping |
| QA-8 / QA-9 | The two agent pages: the credit-banner setters appear exactly once each and are unreachable from the failure branch | Dev's RC9-7 test only asserts the two strings exist. A future edit could add the banner back to the failure branch and still pass |
| QA-10 | `RewardService` returns `success: false` **before** the `credit_transactions` / `user_rewards` writes | The correctness of both RC9-7 ("success ⇒ credits landed") and FT-RLS-1's back-fill rests on this ordering, and nothing pinned it |

### Issues Found

#### Bugs (must fix before commit)

None.

#### Performance Issues (should fix)

None. The migration takes `ACCESS EXCLUSIVE` only briefly and gives up after 3 s; the swaps change which client object is used, not the number of round-trips.

#### Edge Cases (all Low, none blocking)

1. **Column-level grants are not covered by the post-condition** — Low. `has_table_privilege(role, table, 'UPDATE')` returns false when only a *column* privilege is held (e.g. `GRANT UPDATE(balance)`), and `REVOKE … ON TABLE` does not remove column grants. Nothing in the repo suggests any exist, and the user's `information_schema.role_table_grants` post-check would not show them either. One read-only query settles it — listed as item 6 of the post-deploy list.
2. **`update-subscription`'s `billing_events` insert still runs on the user-cookie client and its result is still discarded** (`:117-125`) — Low, **pre-existing and out of scope** (this migration does not touch `billing_events`). Flagged only because it now sits three lines from RC9-5's loud path: if `billing_events` ever gets the same lock-down, that insert fails in exactly the silent way RC9-5 was written to prevent. Worth folding into the SIB-0 follow-up.
3. **Carried over from SA — L-1 still open:** the catch-all in `update-subscription` (`:136-139`) returns `error.message` to the client, which CLAUDE.md § Security Rules forbids in production. Pre-existing; QA agrees with SA that it is a one-line fix worth taking while the file is open, but it does not block.
4. **Dead state write** — Low. In the `(protected)` page's failure branch, `setQualityScoreAwarded(...)` is still called although the notification is never shown. Harmless; only noted so it is not mistaken for a leftover success path.
5. **`app/(protected)/agents/[id]/page.backup-20251101-215528.tsx:664`** holds a fourth copy of the W-3 reward call. It is not a route and not imported, so it is not built — but it is real code carrying the vulnerable pattern, and both guard files have to skip it by filename. Deleting it would be cleaner than skipping it.

### Untestable here (no DB, no dev server)

| Item | Why | Covered by |
|---|---|---|
| The migration's live effect | DDL; QA has no DB access | The user's post-check (already matched) + §9.5 step 6 browser check |
| That a browser `PATCH` now returns 42501 | Needs a live signed-in session against production | §9.5 step 6 — **still outstanding**, and it is the only check that exercises the anon key the way an attacker would |
| Whether an **updatable view**, a **column-level grant**, or a **non-`SECURITY DEFINER` function on another table** writes `user_subscriptions` live | None exist in the repo; only the live catalog can rule them out | Post-deploy items 5 and 6 |
| That token charging, checkout and plan change actually work again after the deploy | Requires a deployed environment | Post-deploy items 1-3 |

### Production damage assessment (the broken window)

The migration was applied **before** the code deployed — the order §9.5 step 1 and risk R-7 warn against. Four things are, right now, failing silently in production:

| Path | What production is doing right now | Recoverable? |
|---|---|---|
| **Agent runs** (W-1) | `chargeTokensWithIntensity` fails 42501 into the non-fatal `catch (spendingError)` at `run-agent/route.ts:637-639`. **Every run completes and charges nothing.** No `credit_transactions` row either, so balances and `total_spent` are frozen and the ledger has a hole | Yes, but only by reconstruction from `agent_executions` token counts. Revenue leak, no user harm |
| **Stripe checkout** (W-4) | `getOrCreateCustomer` cannot persist `stripe_customer_id`, and cannot INSERT a row for a user who has none. Neither result is checked. The webhook's `handleCheckoutCompleted` then only `UPDATE`s — 0 rows, no error — **so a first-time payer is charged and never credited**, while a `credit_transactions` row is still written claiming the credits | Yes — and detectable, because the ledger row exists without a matching account row. See post-deploy item 4. **This is the one with real customer harm** |
| **Plan change** (W-2) | Stripe is charged at the new price; the local `UPDATE` fails and, in the *pre-fix* code now running, the result is discarded. The billing screen keeps showing the old plan and a `billing_events` row is still written | Yes — compare `billing_events` against `user_subscriptions` (post-deploy item 4b) |
| **Agent-share reward** (W-3) | Fails — intended (D-3). But the *pre-fix* pages are still live: the `(protected)` page shows its success notification anyway, and the v2 page falls through silently leaving the Share button armed | Yes — FT-RLS-1's back-fill query |

**The single most useful thing is to get this branch deployed.** Three of the four stop the moment it is live.

### Post-deploy verification list for the user (prod is already migrated)

Run in order. Items 1-3 are the proof the fix is live; 4 finds anyone harmed during the window; 5-6 close the two residuals QA could not check without a DB. **Every query below is read-only — do not run any of them through an account you are also testing with.** QA has not run any of them.

1. **Run one agent and confirm the balance moved.** On a test account: note the token balance (dashboard or the footer display), run any agent once, reload. **The balance must go down.** If it does not, the deploy is not live on that invocation path — stop and escalate; nothing else on this list is meaningful until it passes. Cross-check in Vercel logs: the line `Failed to track token consumption` must stop appearing. (A count of that line since the migration is also the size of the uncharged-runs hole.)
2. **Stripe checkout.** On a test account **with no `user_subscriptions` row** (the W-4 worst case), complete a small checkout. Afterwards the account must have a row with `stripe_customer_id` **and** `stripe_subscription_id` set, and a balance that includes the purchased credits. Watch the logs for `permission denied for table user_subscriptions` / `42501` — there should be none.
3. **Plan change.** On a test account with an active subscription, change the plan. The billing screen must show the new plan after a reload. If the local write ever fails now, the API returns a **500** and logs `Stripe subscription was updated but the local user_subscriptions row was not` — that is RC9-5 working, and it is a loud failure, not a silent one.
4. **Find anyone who paid during the broken window without being credited.** Read-only. Replace both timestamps: `<MIGRATION_APPLIED_AT>` = when you ran the migration, `<CODE_DEPLOYED_AT>` = when the Vercel promotion of this branch finished (both UTC).

   **4a — payments that left a ledger row but no account row (the W-4 signature):**
   ```sql
   -- READ-ONLY. Paid during the broken window, account row never updated.
   select
     ct.user_id,
     ct.created_at                        as paid_at,
     ct.activity_type,
     ct.credits_delta                     as credits_owed,
     ct.balance_after                     as balance_the_webhook_expected,
     us.balance                           as balance_now,
     us.stripe_customer_id,
     us.stripe_subscription_id,
     (us.user_id is null)                 as no_subscription_row,
     ct.metadata ->> 'stripe_session_id'  as stripe_session_id
   from credit_transactions ct
   left join user_subscriptions us on us.user_id = ct.user_id
   where ct.created_at >= timestamptz '<MIGRATION_APPLIED_AT>'
     and ct.created_at <  timestamptz '<CODE_DEPLOYED_AT>'
     and ct.activity_type in ('subscription_renewal', 'subscription_upgrade', 'boost_pack_purchase')
     and (
           us.user_id            is null   -- the row never existed, so the webhook UPDATE hit 0 rows
        or us.stripe_customer_id is null   -- getOrCreateCustomer could not persist the customer id
        or us.balance < ct.balance_after   -- the ledger promised credits the balance never received
     )
   order by ct.created_at;
   ```
   Expected: **zero rows.** Any row is a customer who paid and was not credited — credit them by hand (the `credits_delta` is the amount owed) and keep the `stripe_session_id` for the refund/credit note. The third predicate (`balance < balance_after`) gets noisier the longer you wait, because normal spending also lowers the balance once charging works again; the first two are exact and do not decay.

   **4b — plan changes that did not persist (the W-2 signature):**
   ```sql
   -- READ-ONLY. A plan change was billed and logged, but the account row may be stale.
   select be.user_id, be.created_at, be.event_type, be.description,
          be.amount_cents, us.monthly_amount_usd, us.monthly_credits
   from billing_events be
   join user_subscriptions us on us.user_id = be.user_id
   where be.created_at >= timestamptz '<MIGRATION_APPLIED_AT>'
     and be.created_at <  timestamptz '<CODE_DEPLOYED_AT>'
     and be.event_type = 'subscription_updated'
   order by be.created_at;
   ```
   For each row, `be.amount_cents / 100` should equal `us.monthly_amount_usd`. Where it does not, the customer is being billed the new price on the old plan — fix the row, or have them re-run the plan change now that the code is live.

   **4c — the authoritative cross-check.** The DB only knows about payments the webhook processed. Open the Stripe Dashboard → Payments for the same window and confirm every succeeded payment has a matching `credit_transactions` row **and** a balance that reflects it. This is the only way to catch a payment that left no trace at all.

5. **Rule out a `SECURITY INVOKER` writer the repo cannot see** (read-only):
   ```sql
   select p.proname, p.prosecdef as security_definer, n.nspname
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname not in ('pg_catalog', 'information_schema')
     and pg_get_functiondef(p.oid) ilike '%user_subscriptions%'
   order by p.prosecdef, p.proname;
   ```
   Every function that writes the table must show `security_definer = true`. Any `false` one that writes it will now fail 42501 for a signed-in caller. Also check for an updatable view over the table:
   ```sql
   select c.relname, c.relkind, c.reloptions
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('v', 'm')
     and pg_get_viewdef(c.oid) ilike '%user_subscriptions%';
   ```
   A view with `security_invoker` unset would let a write through it bypass the revoke.

6. **Close the column-grant gap** (read-only, one query, edge case 1 above):
   ```sql
   select grantee, privilege_type, column_name
   from information_schema.role_column_grants
   where table_schema = 'public' and table_name = 'user_subscriptions'
     and grantee in ('anon', 'authenticated')
     and privilege_type <> 'SELECT'
   order by grantee, column_name;
   ```
   Expected: **zero rows.** Any row means a column-level write grant survived the table-level `REVOKE` — re-run the revoke naming those columns.

7. **§9.5 step 6 is still outstanding and should be done** — the browser `PATCH` check (option A, with `Content-Type: application/json` and `Prefer: return=representation`). It is the only check that exercises the anon key the way an attacker would. Expect `42501 permission denied for table user_subscriptions`.

8. **Watch for a day:** `42501` / `permission denied for table user_subscriptions` in client and server logs. The **only** expected one is the share-reward path (D-3/R-2) — everything else is a writer the sweep missed. Also keep an eye out for the `(protected)` page's share notification: until this branch is deployed it still congratulates users on a reward they did not get.

9. **Then run FT-RLS-1's back-fill query** (already in §9.7) to credit the share rewards owed since the migration.

### Final Status

- [x] All acceptance criteria pass — **ready for commit.** No bugs; no fifth write path; the migration's post-conditions match production's post-check; the four write paths are correct and user-scoped; RC9-5 and RC9-7 land as specified; the five `lib/pilot` failures are proved pre-existing; ESLint is unchanged per file.
- [ ] Issues found — Dev must address before commit *(none — the five Low edge cases are optional, and SA's L-1 is a pre-existing one-liner)*
- ⚠️ **Deploy is urgent, not optional.** Production has been migrated ahead of the code, so three of the four paths are failing silently right now. Post-deploy item 1 ("run one agent, confirm the balance moved") is the gate that says the window is closed.

---

## QA Testing Report — S-6

**QA — 2026-09-19**
**Test mode:** full
**Strategy used:** A + B (Jest unit and route-level integration with mocked `getUser`, repositories and Supabase builder). No DB, no dev server, per the task's hard rules. Option E was not needed. DB-only behaviour is listed under "Untestable without a DB" and "Post-deploy checks".
**Focus:** security, api (plus the two callers and the test-page doc)
**Skipped:** live DB checks (C1–C3), E2E (Playwright not set up), manual browser run (no dev server allowed)
**Input source:** TL prompt (four user requirements + edge-case list)
**Verdict:** ✅ **PASS.** No bugs found. Every one of the user's four requirements holds in the code and is asserted by tests. Merge stays gated on C1–C3 and the Commit B yes/no (unchanged).

### How it was run

The worktree has no `node_modules`, so every tool ran from the worktree with the main repo's install (`node <main>/node_modules/jest/bin/jest.js …`), as the Dev and SA did. tsc used a temporary scratch tsconfig (extends the worktree's, `files` = the 13 touched files, `typeRoots` → main repo), deleted afterwards. ESLint ran with `-c eslint.config.mjs`.

| Check | Result |
|---|---|
| Jest, the 4 new suites (before QA additions) | 4 suites, **79/79 pass** (matches Dev's number) |
| Jest, the 4 new suites (after QA additions) | 4 suites, **100/100 pass** (+21 QA tests) |
| Jest, related set: `app/api/onboarding` (allocate, build, chat), `lib/audit`, `app/api/audit`, `lib/repositories/__tests__` (all 22), `FreeTierGrantService` | **27 suites, 347/347 pass** |
| Jest, `app/api/stripe` (other `EVENT_METADATA` consumer) | 1 suite, 7/7 pass |
| tsc, scoped to the 13 touched files incl. the modified tests and `app/test-plugins-v2/page.tsx` | **0 errors in new or changed code.** 10 errors total, all pre-existing: `useOnboarding.ts:210` (`'on-demand'` vs `'on_demand'`, untouched code) and 9 in unrelated imported files (`aiAnalytics.ts` 6, `MemoryManager.ts` 2, `CalibrationSessionRepository.ts` 1). `page.tsx` compiles clean |
| ESLint `-c eslint.config.mjs` on route, service, both repos, all 4 test suites, `types.ts`, `index.ts`, `events.ts`, `useOnboarding.ts` | 4 findings, all pre-existing (`useOnboarding.ts:134-135`, `events.ts:938`, `types.ts:350`). QA-added tests are clean |
| Grep: `console.` | 0 in route, service, both repos, `useOnboarding.ts`, `page.tsx` |
| Grep: callers of the route | Only `useOnboarding.ts:418` and `test-plugins-v2/page.tsx:2235`; both send `JSON.stringify({})`. No scripts or other callers |

### Test Coverage — the user's four requirements

| # | Requirement | Code evidence | Tests | Result |
|---|---|---|---|---|
| 1a | Body `userId` never selects the account | `route.ts`: the only `grant()` call is `grant(user.id, …)`; `parsed.data.userId` is only compared | R3, R4, R11, **QA-S5** (every repository call in a multi-attempt run uses only the passed id) | ✅ Pass |
| 1b | 401 without a session | `getUser()` (validated `supabase.auth.getUser()`) → 401 before the body is read | R2, **QA-R5** (401 wins over a malformed body), R10 (`getUser` throws → generic 500, no grant) | ✅ Pass |
| 1c | 403 on a mismatch | Lower-cased compare, warn with both ids, no read or write | R3 (asserts `grant` and audit not called, warn payload), **QA-R3** (upper-case foreign id still 403) | ✅ Pass |
| 1d | 400 on extra fields | `.strict()` schema | R5 (extra key), R12 (injected `balance`/`account_frozen`/`user_id`), **QA-R4** (foreign id + extra field → 400, validation first) | ✅ Pass |
| 2a | A repeat call writes nothing | `ALREADY_GRANTED` returns before config load; no insert/update/ledger/audit | S2 (asserts config, pricing, insert, update, ledger **not called**), S9, R6 (no audit) | ✅ Pass |
| 2b | Insert 23505 → already granted | Repo maps code `23505` only → `conflict`; service re-reads | U2, U2b (non-23505 "duplicate" message stays an error), S3, S3b | ✅ Pass |
| 2c | Update CAS lost → re-read → already granted | Conditional update (`granted_at IS NULL`, `account_frozen IS NOT TRUE`, `balance = expected`/`IS NULL`); 0 rows → re-read | U3 (exact filter chain), S5, S6, **QA-S6** (re-read error after a lost race → throws, no second write) | ✅ Pass |
| 2d | Retries bounded | `MAX_GRANT_ATTEMPTS = 3` on every path, including insert conflicts; exhaustion logged at error | S7/S7c, S7b, S7d (neither inserted nor conflict → throws, no retry), U3 multi-row → error | ✅ Pass |
| 3a | No path writes `account_frozen` on an existing row | Update payload rebuilt key by key (7 or 8 keys), `?: never` on the patch type | U3 (exact key set), the smuggled-wider-object test, S4, S8, **QA-S4** (`account_frozen: NULL` row → granted, patch has no `account_frozen`) | ✅ Pass |
| 3b | Frozen, never granted → 409, no writes | `INELIGIBLE_FROZEN` before config load; route → fixed 409 body, no audit | S8 (config, pricing, insert, update, ledger **not called**), the frozen-between-read-and-write case, U3b, R13, **QA-R6** | ✅ Pass |
| 4 | Tests assert invariants, not only status codes | Write-method `not.toHaveBeenCalled` / exact payload keys / exact filter chain / call order (S16) throughout | All four suites | ✅ Pass |

### Edge cases checked (the TL's list)

| Edge case | Behaviour | Test |
|---|---|---|
| Malformed JSON | 400 `Invalid input`, no details in prod | R5 (existing) |
| Empty body | 200, grant to session user | R1 (no body), R1b (`{}`), **QA-R1** (whitespace only) |
| JSON `null`, a JSON string, `userId: null`, `""`, a number | 400, no grant, no audit | **QA-R2** (5 cases) |
| `userId` in a different case | Own id → 200 (R11); foreign id → 403 (**QA-R3**) | ✅ |
| Non-UUID `userId` | 400 (checked before the mismatch, so a non-UUID foreign id is 400, not 403) | R5 |
| Config missing | Today's defaults 20834 / 1000 / 0 / 30 | S13 |
| Config empty string | Defaults (legacy `value \|\| default`) | **QA-S3** |
| Config non-numeric / fractional / boolean / negative / zero duration | `FreeTierConfigError` → 500, no write | S13, **QA-S2** (4 cases) |
| Null balance | `expectedBalance: null` → `.is('balance', null)`; counts as 0 for the expiry rule | S12, S11, U3 |
| `pilotCreditsToTokens` throwing | Propagates → 500, no insert/update/ledger | **QA-S1** |
| Raw tokens 0 / negative / fractional / NaN / Infinity | `FreeTierConfigError`, no write | S13b |
| Audit failing / never settling | 200 still returned, error logged | R9, R9b |
| Ledger failing / throwing | Still `GRANTED`, error logged with `userId` + `rawTokens` | S15 |
| Insert: no error but 0 rows | Repo → `{inserted:false, conflict:false}` → service throws | **QA-U1** + S7d |
| `details` on non-500 responses in development | Never present on 401/403/409/503 | **QA-R6** |
| Audit payload on the update path | numeric `executions`, `path: 'update'`, effective storage | **QA-R7** |

### Tests added by QA (tests only, no production code touched)

| File | Added |
|---|---|
| `app/api/onboarding/allocate-free-tier/__tests__/route.test.ts` | `describe('QA additions (edge cases)')`: QA-R1 … QA-R7 (11 tests) |
| `lib/services/__tests__/FreeTierGrantService.test.ts` | `describe('QA additions (edge cases)')`: QA-S1 … QA-S6 (9 tests) |
| `lib/repositories/__tests__/UserSubscriptionRepository.test.ts` | QA-U1 (1 test) |

These are new tests in files that belong to Commit A (the security fix). They are untracked new files, so the functional-only patch Dev saved for the A/B split is not affected.

### Callers and docs

| Item | Result |
|---|---|
| `useOnboarding.ts` | Sends `{}` with `Content-Type: application/json`; `alreadyGranted` handled as success; any failure (409, 503, 500) is logged and onboarding continues, as before. Compiles (only the pre-existing `:210` error) |
| `test-plugins-v2/page.tsx` | User-id input and state removed; button disabled without `sessionUser` (from `useAuth()`, already in the file at :793); sends `{}`; shows the "Already granted" note. Compiles clean |
| `docs/V2_TEST_PAGE_SCOPE.md` | Matches the behaviour: request `{}`, the legacy-`userId` rule, all 7 status codes and bodies, once-only, frozen → 409, the DB steps and the ledger caveat (C2). The `raw_tokens` example (208340) matches the default 10 tokens per credit |

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None. A repeat or frozen call costs one `SELECT` (S2, S8 assert config and pricing are not read).

#### Edge Cases (nice to fix, all Low, none blocking)
1. **No retry path after a failed grant** — `useOnboarding.ts` — Low. A legitimate user whose grant ends in 500 or 503 (config/DB error, or three lost races) keeps `free_tier_granted_at = NULL`, so a later call *would* grant. But onboarding runs once and nothing calls the route again, so the user silently has no free tier until support steps in. Same as before the fix (the old route also failed silently). Suggest a follow-up: retry on 503 once, or re-attempt on next dashboard load when `free_tier_granted_at IS NULL`. Watch the `Free-tier grant retries exhausted` and `Free-tier grant failed` error lines after deploy.
2. **Hard-coded amounts on the test page** — `app/test-plugins-v2/page.tsx` ("What will be granted" panel) — Low, cosmetic, pre-existing. It still says "Execution Quota: Unlimited (null)" and fixed 20,834 / 1,000 MB / 30 days, while the doc now says the values come from config, and on an existing row the effective quotas can be higher. The response box shows the real values, so testers are not misled after a grant.
3. **Arithmetic assumes numeric JSON** — `FreeTierGrantService.buildExistingRowPatch` — Low. `balance + rawTokens` would string-concatenate if PostgREST ever returned `balance` as a string (it returns `numeric`/`bigint` as JSON numbers today, and the Stripe webhook makes the same assumption). A `Number()` coercion or a Zod parse of the read row would harden it. Not a regression.
4. **Fractional config now fails closed** — Low, intentional (Q8/DV-4). A config value like `20834.5` stored as a JSON number used to grant; it now returns 500 with no write (QA-S2 documents it). Worth knowing if anyone edits `system_settings_config` by hand.
5. **Ledger ships ON before C2** — Low. `SHIP_FREE_TIER_LEDGER_ROW = true`. If C2 turns out to reject `free_tier_grant`, grants still succeed and each one logs a ledger error (S15); nothing breaks, but flip the switch per F-3 in §8.1.

### Untestable without a DB

| Item | Why it can't be tested here | Covered by |
|---|---|---|
| **C1** `user_subscriptions.user_id` is unique | The whole insert race (two first-time grants) relies on Postgres raising 23505. Mocks can only simulate the code | C1 (merge gate), L-6 |
| **C2** `credit_transactions` CHECK allows `activity_type = 'free_tier_grant'` (and `transaction_type = 'allocation'`) | Constraint values are not in the repo | C2, L-2 |
| **C3** RLS policies, grants and triggers on `user_subscriptions` | A trigger could rewrite `account_frozen`/`balance` behind the allow-list; an `authenticated` UPDATE policy would be a separate P0 | C3 |
| READ COMMITTED re-evaluation of the conditional `UPDATE` | Real lock/re-check semantics need two live transactions | L-6 |
| PostgREST rendering of `.not('account_frozen','is',true)` as `IS NOT TRUE` and `.is('balance', null)` | Verified by the builder call chain only | L-5, L-7 |
| `getUser()` against real cookies; the audit row actually landing in `audit_trail` | Mocked | L-2, L-4 |

### Post-deploy checks for the user (L-steps)

Run on a preview/staging environment with test accounts first, then spot-check production read-only.

| # | Check | Expected |
|---|---|---|
| **L-1** | Before merge: run C1, C1b (if needed), C2, C3 from §7 / `docs/investigations/S6_FREE_TIER_ABUSE_CHECK.sql` | C1 unique; C2 decides `SHIP_FREE_TIER_LEDGER_ROW`; C3 has no user write policies and no triggers (else SA re-review) |
| **L-2** | Fresh test account completes onboarding | One `user_subscriptions` row: `balance = total_earned = free_tier_initial_amount = raw`, `free_tier_granted_at` set, `free_tier_expires_at` = +30 days, `account_frozen = false`. Exactly one `FREE_TIER_ALLOCATED` in `audit_trail`. One `credit_transactions` row with `activity_type = 'free_tier_grant'` (if C2 allowed it) |
| **L-3** | Same account: click "Grant Free Tier to Me" on `/test-plugins-v2` twice | `alreadyGranted: true`; `balance`, `total_earned` and `updated_at` unchanged; no new audit or ledger row |
| **L-4** | `curl` the route: (a) no cookie; (b) own cookie + another user's `userId`; (c) own cookie + `{"balance":1}`; (d) own cookie + `{"userId":"<own id in UPPER case>"}` | (a) 401; (b) 403 plus a `free-tier grant: body userId mismatch` warn line; (c) 400; (d) 200 `alreadyGranted: true`. None of them changes any row |
| **L-5** | Test DB only: an account with `account_frozen = true`, `free_tier_granted_at = NULL` → call the route. Then a cron-frozen account (`granted_at` set) | First: 409, row unchanged, still frozen. Second: 200 `alreadyGranted: true`, still frozen |
| **L-6** | Fresh account: fire two requests in parallel (two tabs or two `curl &`) | Exactly one grant (balance = raw, not 2×raw), exactly one audit and one ledger row; the other response is `alreadyGranted: true` (or 503, which is safe) |
| **L-7** | Test account with a pre-existing row and credits (e.g. created by a test Stripe checkout, `granted_at` NULL) → grant | Tokens added to `balance`, `total_earned` grows by the same amount, quotas not lowered, **no** `free_tier_expires_at` written, `account_frozen` untouched |
| **L-8** | Vercel logs for the first days | `AllocateFreeTierAPI` lines carry `correlationId` and `userId`; watch for `retries exhausted`, `Free-tier grant failed` and ledger errors; mismatch warns are an abuse signal |
| **L-9** | Next run of the S-6 investigation SQL Q3 | Add `activity_type <> 'free_tier_grant'` (§8) so post-deploy grants are not double-counted |

### Final Status
- [x] All acceptance criteria pass in code and tests — **ready for commit once the existing gates clear** (C1, C2 → ledger switch, C3 incl. triggers, and the user's yes/no on Commit B)
- [ ] Issues found — Dev must address before commit (none; the five Low edge cases above are optional follow-ups)

---

## Commit Info

*(RM to populate)*

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-19 | Workplan created | Dev analysis of S-6. Design: session-only account, once-only conditional grant, optimistic balance predicate, never-unfreeze allow-list, new `UserSubscriptionRepository`. Q1 to Q8 raised for SA. C1 to C3 read-only checks for TL |
| 2026-09-19 | SA workplan review | APPROVED WITH CHANGES. Q1–Q8 ruled (conditional update, no RPC; cumulative `total_earned`; expiry only on empty rows; ledger depends on C2). RC-1 (never grant a frozen row) to RC-9 added, plus extra tests. test-plugins-v2 change approved; partial `console.*` conversion rejected in favour of a whole-file yes/no for the user |
| 2026-09-19 | Code complete | Dev implemented the fix with RC-1 to RC-9 and Q1–Q8 folded in (deviations DV-1 to DV-5). Ledger row behind `SHIP_FREE_TIER_LEDGER_ROW` (TODO(C2)). Whole-file `console.*` conversion of `useOnboarding.ts` and `test-plugins-v2/page.tsx` as a separable commit, pending the user. R1 recorded as a tracked follow-up (§8.1). 75 new tests pass; tsc clean on touched code |
| 2026-09-19 | SA code review | CHANGES REQUIRED (minor). All RCs verified in code; DV-1 to DV-5 accepted; security invariants hold. RF-1: an insert that is neither `inserted` nor `conflict` must throw (as in §2.3) instead of re-looping, plus a multi-row update guard. SA re-ran jest (75/75), a scoped tsc (clean apart from a pre-existing error) and ESLint via `-c eslint.config.mjs` (0 new findings) |
| 2026-09-19 | SA re-review | APPROVED for QA. RF-1 (throw on an insert that neither lands nor conflicts; error on a multi-row update) and F-3 to F-6 verified; jest 79/79 |
| 2026-09-19 | SA code-review fixes | RF-1 (insert that is neither inserted nor conflict throws; multi-row update is an error) plus F-3 to F-6, with tests S7d, U3 multi-row, R9b, F-3. 79/79 tests pass; scoped tsc and ESLint (`-c eslint.config.mjs`) show only pre-existing findings. Ready for SA spot-check of RF-1 |
| 2026-09-19 | QA testing report | PASS, no bugs. All four user requirements verified in code and tests. QA added 21 edge-case tests (route QA-R1–R7, service QA-S1–S6, repo QA-U1): 4 suites 100/100, related set 27 suites 347/347. Scoped tsc and ESLint: only pre-existing findings. Five Low edge cases noted; DB-only items and post-deploy L-1 to L-9 listed. Merge gates unchanged |
| 2026-09-20 | SA final check | APPROVED. Ledger removal verified clean (no dead references, contract and error handling unchanged, no hollowed-out tests, `FREE_TIER_ALLOCATED` written on both grant paths); jest 85/85. C3's RLS output raised as a **new P0, §8.2 (P0-FT-RLS)**: `user_subscriptions` is writable from the browser by any signed-in user — separate cycle, does not block this PR. Only Commit B's yes/no still gates the merge |
| 2026-09-20 | P0-FT-RLS — SA review fixes (§9.9) | All of RC9-1 to RC9-9 applied. **RC9-1**: SA found a fourth writer, `app/api/stripe/create-checkout/route.ts` → `StripeService.getOrCreateCustomer` (the file never names the table) — now on the service role; worst case avoided was *payment taken, credits never granted*. **RC9-2**: the browser verification is cookie-based (the app uses `createBrowserClient`, not `localStorage`) with a Network-tab fallback and a three-outcome table. **RC9-3**: `lock_timeout`/`statement_timeout`. **RC9-4**: deploy-then-migrate spelled out with its silent-fail-open cost. **RC9-5**: D-4 rejected — the Stripe plan write is captured, logged and 500s; the file's 3 `console.*` converted. **RC9-7**: the share-reward failure is loud in both agent pages. **RC9-6/8/9** applied. FT-RLS-3 promoted to P1. 15 static/guard tests; related suites 53/58 pass (the 5 `lib/pilot` failures reproduce with the changes stashed); ESLint identical to HEAD on all seven files |
| 2026-09-20 | P0-FT-RLS implemented (§9) | Second P0, same branch, separate commit. Migration `20261001_user_subscriptions_write_lockdown.sql` (drops the two PUBLIC write policies, revokes the write grants from `anon`/`authenticated`, keeps owner SELECT and the service-role policy; RLS pre-condition + in-transaction post-conditions + rollback). SA's step-3 verification re-run found **three** RLS-scoped writers the earlier snapshot missed: `run-agent` and `stripe/update-subscription` converted to the service role, the browser-side share reward deliberately left to break (D-3, follow-up FT-RLS-1). New static + source-guard test (12 tests); 6 suites / 110 tests pass; ESLint shows no new findings. Sibling tables answered in §9.8, not fixed |
| 2026-09-20 | C1 / C2 results folded in | C1 PASS (`user_credits_user_id_key` UNIQUE on `user_subscriptions(user_id)`) — no migration, caveat closed. C2 NEGATIVE (`credit_transactions_activity_type_check` has no `free_tier_grant`) — ledger code removed from the PR, not left dead behind a switch; follow-up F-4 records the migration needed to ledger the grant later. C3 triggers cleared (`trigger_update_user_subscriptions_updated_at` only); RLS/grants still pending. 85 tests pass; scoped tsc and ESLint show only pre-existing findings |
| 2026-09-20 | SA review of §9 (P0-FT-RLS) | 🔄 FIX REQUIRED. Migration body, rollback, post-conditions and the two service-role swaps approved (tenant-isolation-guard passes on both). Independent blast-radius re-sweep found a fourth writer the grep missed: `stripe/create-checkout` passes its user-cookie client into `StripeService.getOrCreateCustomer`, which UPDATEs `stripe_customer_id` / INSERTs the row unchecked — post-migration a user with no row can pay and never be credited (RC9-1, blocking). §9.5 step 6's browser check cannot run: the app uses `createBrowserClient` (cookie session), not localStorage (RC9-2, blocking). Plus `lock_timeout` on an ACCESS EXCLUSIVE migration, deploy-ordering wording, the ignored Stripe write result (D-4 rejected), and a requirement that the browser reward path fail loudly (D-3 accepted otherwise). Deploy-before-migration ordering confirmed correct |
| 2026-09-20 | SA re-review of §9 | ✅ APPROVED FOR QA. Spot-checked RC9-1 to RC9-9: the `create-checkout` swap keeps session scoping (tenant-isolation-guard passes), the `lock_timeout`/`statement_timeout` and PERMISSIVE post-condition are correct and still idempotent, the deploy-then-migrate ordering and abort table are followable by a non-DBA, the RC9-7 UI cannot claim credits it did not grant, and the guard tests pin what they claim (SA re-ran the suite: 15/15). Two documentation-only corrections before the user runs §9.5 step 6: option A must add `Content-Type: application/json` (otherwise PostgREST answers 415, not 42501), and both options need `Prefer: return=representation` so the "2xx but 0 rows" outcome is actually distinguishable. Low notes: the catch-all still returns `error.message` in production, StateManager belongs in FT-RLS-5, and the "will be credited later" wording depends on FT-RLS-1 |
| 2026-09-20 | QA testing report — §9 (P0-FT-RLS) | ✅ **PASS, no bugs.** Independent seven-channel blast-radius sweep (direct writers, injected-client services traced to every construction site, `.rpc(`, SQL functions/triggers, edge functions, raw PostgREST fetch, the purge engine) found **no fifth RLS-respecting writer** — the four known paths are the complete set. All four verified: `run-agent` and both `create-checkout` call sites and the Stripe plan update are service-role and session-scoped (no body id reaches any of them; the Stripe patch is limited to two columns); the browser reward path fails loudly on both agent pages and cannot reach a credits banner. The migration’s in-file post-conditions match the user’s live post-check item for item. RC9-5 and RC9-7 land as specified. Dev’s 15/15 pass; related set 27 suites / 275 tests pass excluding `lib/pilot`; the 5 `lib/pilot` failures are **proved pre-existing without touching the shared stash** (`origin/main...HEAD` is empty and `lib/pilot` has zero non-comment changes). ESLint identical to HEAD on all six touched files; both test files 0. QA added 10 tests (`userSubscriptionsWriteLockdown.qa.test.ts`): a table-level writer allow-list and an injected-client construction allow-list (the W-4 shape, now a discovery net not just a regression net), the StateManager RC9-8 enforcement, per-call-block tenant scoping on all three swaps, and structural guards that neither page can announce credits it did not grant. Five Low edge cases (column-level grants not covered by the post-condition; the `billing_events` insert still on the cookie client; SA’s L-1 still open; a dead `setQualityScoreAwarded`; the backup page copy of W-3). **Production is in the broken window** — the migration was applied before the code, so agent runs charge nothing, first-time checkouts can be paid-but-not-credited, and plan changes do not persist, all silently. A nine-item post-deploy list is in the QA section, starting with "run one agent, confirm the balance moved", plus read-only queries to find anyone who paid during the window without being credited |
