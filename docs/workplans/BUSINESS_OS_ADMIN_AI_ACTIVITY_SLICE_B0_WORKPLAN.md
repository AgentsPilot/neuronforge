# Workplan: Admin AI Activity — Slice B0 (the grouping RPC + its index)

> **Last Updated**: 2026-09-24

**Developer:** Dev
**Requirement:** [BUSINESS_OS_ADMIN_AI_ACTIVITY_VIEW_REQUIREMENT.md](/docs/requirements/BUSINESS_OS_ADMIN_AI_ACTIVITY_VIEW_REQUIREMENT.md) — Gap B / Slice B0
**SA rulings this plan implements:** SA-1, SA-4, SA-5, SA-6, SA-14 (§ SA Review Notes) and re-check §4 Q3 + carry-forward item 4 (§ SA Re-Check Notes)
**Date:** 2026-09-24
**Branch:** ⛔ **not yet created — RM cuts it from `main` at kickoff.** Suggested name: `feature/admin-ai-activity-slice-b0`. Verified 2026-09-24: `git branch --show-current` → `main`, and `git branch -a --list "*ai-activity*"` returns only Slice A's merged branch. **Dev does not create it.** See [T0](#t0--branch-setup-blocker).
**Status:** 📋 **Planning — for SA review. No code, no SQL and no migration file is committed by this plan.**

## Overview

Gap B's view cannot be read from the client. PostgREST aggregate functions are disabled on this project (`PGRST123`), so there is no `GROUP BY session_id, user_id` + `SUM(cost_usd)` from Node, and `token_usage` carries no index that makes a cross-account, window-bounded read anything but a full scan. B0 is the database foundation that removes both obstacles: **one SQL function, one index, and the thin typed repository seam that calls them**.

B0 ships nothing a user can see. Its whole job is to make B1 buildable at NFR-6 volumes, and to make the row key `(session_id, user_id)` a property of the database rather than a rule the next developer has to remember.

**Three things are fixed and not up for re-litigation in this plan:** the grouping key is `(session_id, user_id)` and never `session_id` alone (F-13); the 100-row cap is enforced *inside* the function (re-check carry-forward 4); and the function is INVOKER rights with `REVOKE ALL … FROM PUBLIC, anon, authenticated` (D-7).

---

## Table of Contents

- [Verification Log](#verification-log)
- [Analysis Summary](#analysis-summary)
- [Implementation Approach](#implementation-approach)
  - [A. The seam: what B0 is, and what it is not](#a-the-seam-what-b0-is-and-what-it-is-not)
  - [B. The function contract](#b-the-function-contract)
  - [C. Bucketing: RPC vs calling code](#c-bucketing-rpc-vs-calling-code)
  - [D. Literals vs parameters](#d-literals-vs-parameters)
  - [E. The index proposal](#e-the-index-proposal)
  - [F. Security lockdown](#f-security-lockdown)
  - [G. The repository seam](#g-the-repository-seam)
  - [H. Migration file shape and house style](#h-migration-file-shape-and-house-style)
- [Files to Create / Modify](#files-to-create--modify)
- [Task List](#task-list)
- [Migration Application Procedure](#migration-application-procedure)
- [Measurement Plan (AC-B16)](#measurement-plan-ac-b16)
- [Test Plan](#test-plan)
- [Risks](#risks)
- [Non-Goals](#non-goals)
- [Open Questions for SA](#open-questions-for-sa)
- [Applied to Production](#applied-to-production)
- [SA Review Notes](#sa-review-notes)
- [QA Testing Report](#qa-testing-report)
- [Commit Info](#commit-info)
- [Change History](#change-history)

---

## Verification Log

Every claim in the brief and in the requirement's F-13 to F-18 was re-checked against `main` at `52b43e6a` on 2026-09-24. **Most hold. Six findings change this plan, and three of them are corrections to the requirement.**

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| V-1 | PostgREST aggregates are disabled (`PGRST123`) | ✅ Holds | `supabase/migrations/20260929_usage_summary.sql:24-25`, in the "WHY NOT JUST NARROW THE SELECT" block |
| V-2 | `token_usage` has no index on `session_id` or `feature`; the only one from that migration is `(user_id, created_at DESC)` | ✅ Holds | `20260929_usage_summary.sql:98-99`; the only other two are `(execution_id)` and `(agent_id, execution_id)` in `supabase/SQL Scripts/20250113_add_execution_id_to_token_usage.sql:10-14` |
| V-3 | **There is no index on `created_at` alone either** | ➕ **New, and it is the actual gap** | A cross-account window read has no usable index at all: `(user_id, created_at DESC)` is unusable when `user_id` is not constrained. This is what makes the sweeping admin's query a seq scan, not the missing `feature` index **⚠️ Superseded 2026-09-26 by live `pg_indexes`: the production DB has `idx_token_usage_created_at` (btree `created_at`) and `idx_token_usage_feature (feature, created_at DESC)`, neither in the repo. A cross-account window read uses an index range scan (1.6 ms for 14 days). Re-plan B0's index proposal against the live index list; see the admin slice 4 workplan §15.8.** |
| V-4 | `insight-detect` mints one `runId` per run, outside the per-business loop | ✅ Holds, unchanged on `main` | `app/api/cron/insight-detect/route.ts:143` (`const runId = crypto.randomUUID();`), used inside `for (const userId of userIds)` at `:206`. The concurrent F-13 fix has not landed; this plan does not depend on it either way |
| V-5 | `business_os_usage_summary` is the precedent, and its REVOKE still leaves the service-role client able to call it | ✅ Holds, with live evidence | `20260929_usage_summary.sql:92-93` revokes from `PUBLIC, anon, authenticated`; the owner usage card calls it through `TokenUsageRepository.usageSummaryByFeatureAndDay` and the Layer 1.1 workplan records "`business_os_usage_summary` already exists on `main` environments" (`BUSINESS_OS_LLM_USAGE_VERIFICATION_LAYER1_1_WORKPLAN.md:882`). So `REVOKE … FROM PUBLIC` does **not** take EXECUTE away from `service_role` |
| V-6 | **The requirement's Business OS row filter — `feature LIKE 'business-os-%'` — is wrong in two ways** | ❌ **Correction needed** | The codebase's filter is `BOS_FEATURE_FILTER_PREFIX = 'business-os'` (**no trailing hyphen**, `callCatalog.ts:132`) **OR** one of five legacy values (`insight-generation`, `correlated-insight-generation`, `health-summary-generation`, `landing-page-generation`, `lead-reply` — `callCatalog.ts:100-123`). `'business-os-%'` would miss the legacy briefing tag `business-os` **exactly**, miss a misspelled `business-os<typo>` (deliberately included so it is seen, not hidden), and miss every legacy row — which is real Business OS spend. **This plan mirrors `bosRowFilter()` (`callCatalog.ts:139-141`), not the requirement's prose.** See [Open Question OQ-1](#open-questions-for-sa) |
| V-7 | **`audit_trail.entity_id` is `TEXT`; `token_usage.session_id` is `uuid`** | ➕ **New — the join needs a cast** | `supabase/SQL Scripts/create_audit_trail.sql:15` (`entity_id TEXT`); the tracker validates `session_id` against a UUID regex and nulls anything else (`lib/analytics/aiAnalytics.ts:140-146`), and `turnUsage.ts:87` states "`session_id` is a uuid column". The join is `a.entity_id = t.session_id::text` — cast on the **uuid** side, so `idx_audit_trail_entity_id` stays usable |
| V-8 | `TokenUsageRepository`'s contract test pins the exact public method set | ⚠️ **Holds as a rule — but it is RED on `main` today, and nothing in CI runs it** | `npx jest lib/business-os/usage/__tests__/tokenUsageRepository.contract.test.ts` → **1 failed, 4 passed**: `summariseFeatureAllAccountsInWindow` exists on the class (`TokenUsageRepository.ts:455`) and is **absent from `EXPECTED_ARITY`**. It was added by the Layer 2 ledger-check work without extending the pin. And **no workflow runs Jest** — `.github/workflows/` holds six workflows and the only test steps are `test:authz-guard`, `test:bos-entitlements` and the plugin suites. SA-6's "adding a method **fails CI**" is not true today. B0 fixes the pin as part of its own change |
| V-9 | `TOKEN_USAGE_COLUMNS.call` lacks `user_id`, `model_name` and `provider` | ✅ Holds — **but the new column list belongs to B2, not B0** | `TokenUsageRepository.ts:105` (`call`), `:51-64` (`LedgerCallRow`). B0 returns an **RPC row shape**, not `token_usage` columns; the three missing columns are needed by FR-B2's drill-down, which is slice B2. Recorded so SA does not read its absence here as an omission |
| V-10 | `TokenUsageRepository` imports nothing from `lib/business-os/**`, enforced by source text | ✅ Holds | `tokenUsageRepository.contract.test.ts` asserts `not.toMatch(/from\s+['"]@\/lib\/business-os/)` and `not.toMatch(/callCatalog/)`. B0's new method keeps it: the prefix, the legacy list and the platform account ids are all passed in as plain data |
| V-11 | The repository already calls an RPC, and the test helper already fakes one | ✅ Holds | `TokenUsageRepository.ts:265-268` (`.rpc('business_os_usage_summary', …)`); `tests/helpers/fakePostgrest.ts:283-291` records `rpcCalls` and dispatches to an injected handler |
| V-12 | `AiAuditDetails` is a closed, safe shape and the outcome lives in it | ✅ Holds, **and the outcome is also in the action name** | `lib/business-os/llm/aiActionAudit.ts:101-121`; `buildAiAuditEntry` sets `action` to `BUSINESS_AI_ACTION_FAILED` / `_COMPLETED` from the same `failure` value (`:211`). **So an outcome filter needs no JSON access at all** — it is an equality on `audit_trail.action`. This is what keeps every `AiAuditDetails` key name out of the SQL |
| V-13 | The migration house style: header comment block stating what it costs / why not the alternative / why not `SECURITY DEFINER`, then DDL, then `COMMENT ON`, then `REVOKE`, then the index | ✅ Holds | `20260929_usage_summary.sql` end to end; `20261004_payment_tables_write_lockdown.sql:1-60` for the pre-check/post-check/rollback-in-the-header convention; `20261005` + `20261005b` for splitting a migration whose second half must not share the first half's transaction |
| V-14 | A previous rollback carried a truncation defect worth learning from | ✅ Holds | `PAYMENT_TABLES_WRITE_LOCKDOWN_WORKPLAN.md:310-318`: the rollback looked a policy up by a 65-character name Postgres had stored truncated to 63, so one table could not be rolled back by the scripted path. **The general lesson — "the thing you drop must be named exactly as the database stored it" — applies here to a *function signature*, not a policy name.** See [Rollback](#4-rollback) |
| V-15 | There is a precedent for a Jest guard over migration SQL text | ✅ Holds | `supabase/migrations/__tests__/business-os-entitlements.migration.test.ts` — strips comments so prose cannot satisfy a rule, strips `$$ … $$` bodies, splits top-level statements. B0 reuses its helpers |
| V-16 | `token_usage`'s DDL is not in this repo | ➕ **New — a pre-apply verification step** | No `CREATE TABLE … token_usage` exists anywhere under `supabase/`; the table was created in the dashboard (the same class of thing memory records for the core user tables). Column types, and whether `total_tokens` is a generated column, must be **read from production** before the migration is written, not assumed. The function avoids `total_tokens` entirely and sums `input_tokens + output_tokens` |
| V-17 | QA has read-only SQL access to production and already used it | ✅ Holds | `BUSINESS_OS_ADMIN_AI_ACTIVITY_SLICE_A_WORKPLAN.md:790-800` — 58,261 rows in `audit_trail`, 52 `BUSINESS_AI_ACTION_COMPLETED`, 4 `_FAILED`, 56 `ai_action`. **No equivalent figure for `token_usage` exists anywhere in the repo** — sizing it is step 0 of the measurement |

---

## Analysis Summary

**What this slice touches**

| Layer | Touched |
|---|---|
| **Database** | **One new function** `public.business_os_ai_activity`, **one new index** on `public.token_usage`, and (conditionally, on the measurement) one partial index on `public.audit_trail`. No table, no column, no policy, no trigger, no data change |
| Repositories | `lib/repositories/TokenUsageRepository.ts` — one new, explicitly named all-accounts method that calls the RPC and returns a typed row. Plus the `EXPECTED_ARITY` pin, including the pre-existing red entry (V-8) |
| API routes | **None.** B0 adds no route |
| UI | **None** |
| Providers / LLM | **None.** No LLM call, no embedding (NFR-3) |
| Owner-facing surface | **None** (AC-B18 is untouched by construction) |

**Tables read by the new function:** `token_usage` (the grouping) and `audit_trail` (a `COUNT(*)` per group, and nothing else — see [C](#c-bucketing-rpc-vs-calling-code)).

**Debt this slice inherits and does not fix:** the two inline service-role clients on the existing admin routes (F-11) are untouched — B0 adds no route. The shared insight `runId` (F-13) is another Dev's slice and this plan neither edits `app/api/cron/insight-detect/route.ts` nor sweeps consumers of `token_usage.session_id`; **the composite key is correct with or without that fix**, because historical rows keep the shared id.

---

## Implementation Approach

### A. The seam: what B0 is, and what it is not

B0 is **the database read path**: the SQL that answers the question, the index that makes it affordable, and the typed method that calls it. It stops at the repository's return value.

| Concern | Slice | Why |
|---|---|---|
| Grouping, the cap, the honest count, the two buckets | **B0** | Every one of them is an aggregate over an unbounded set. PostgREST cannot do it (V-1) |
| The `(session_id, user_id)` key | **B0** | It is enforced in the `GROUP BY`, so no caller can get it wrong |
| Classification *labels* (cache / platform / ungrouped / no-entry-found), the trailing exclusion window, the "multiple entries" marker | **B1** | Decisions over the ≤100 rows the RPC already returned. They are product policy, they will change, and a hand-applied migration is the worst place to version product policy |
| Company-name resolution (`BusinessProfileRepository`), area labels, the six presets, Zod, `requireAdmin`, the page | **B1** | No database aggregate involved |
| Per-call drill-down rows, the new `TOKEN_USAGE_COLUMNS` entry with `user_id` / `model_name` / `provider` | **B2** | A plain filtered `SELECT` on `session_id` **and** `user_id`. No aggregate, so no RPC and no migration (V-9) |
| The $0.0001 reconciliation, the multi-entry cost sum, the audited-but-unledgered reverse pass | **B3** | See [C](#c-bucketing-rpc-vs-calling-code) — none of them needs SQL |

**The rule that decides every one of those rows:** *if it requires an aggregate over a set the cap has not yet bounded, it is SQL; if it is arithmetic or a label over ≤100 rows already returned, it is TypeScript.*

### B. The function contract

**Proposed signature** (a proposal, validated by [the measurement](#measurement-plan-ac-b16), not a settled fact):

```sql
CREATE OR REPLACE FUNCTION public.business_os_ai_activity(
  p_from               TIMESTAMPTZ,   -- window start, inclusive
  p_to                 TIMESTAMPTZ,   -- window end, inclusive
  p_feature_prefix     TEXT,          -- 'business-os'  (BOS_FEATURE_FILTER_PREFIX, as data)
  p_legacy_features    TEXT[],        -- BOS_LEGACY_FEATURES_FLAT, as data
  p_platform_accounts  UUID[],        -- platformAccountIds(), as data
  p_account            UUID    DEFAULT NULL,  -- one business, or every business
  p_features           TEXT[]  DEFAULT NULL,  -- the area filter, as ledger feature values
  p_audit_action       TEXT    DEFAULT NULL,  -- 'BUSINESS_AI_ACTION_FAILED' | '…COMPLETED' | NULL
  p_min_cost_usd       NUMERIC DEFAULT NULL,
  p_sort               TEXT    DEFAULT 'cost',-- 'cost' | 'time'
  p_limit              INT     DEFAULT 100
)
RETURNS TABLE (
  row_kind           TEXT,          -- 'total' | 'ungrouped' | 'platform' | 'group'
  group_id           UUID,          -- token_usage.session_id   (NULL on non-group rows)
  account_id         UUID,          -- token_usage.user_id      (NULL on 'total'/'ungrouped')
  first_call_at      TIMESTAMPTZ,
  last_call_at       TIMESTAMPTZ,
  features           TEXT[],
  models             TEXT[],
  providers          TEXT[],
  call_count         BIGINT,
  failed_call_count  BIGINT,
  cache_call_count   BIGINT,
  input_tokens       BIGINT,
  output_tokens      BIGINT,
  ledger_cost_usd    NUMERIC,
  audit_entry_count  BIGINT,
  total_groups       BIGINT         -- only on row_kind = 'total'
)
LANGUAGE sql
STABLE
SET search_path = public
```

**One row of `row_kind = 'group'` = one AI action, for one business.** `group_id` is the grouping id the product minted (`AiActionSpec.groupId` → `buildBosCallContext` → `session_id`); `account_id` is the business the ledger attributed the calls to. The pair is the row key, enforced by `GROUP BY t.user_id, t.session_id` inside the function — **`session_id` alone never appears in a `GROUP BY`, and the migration guard test asserts that** (F-13, AC-B5).

Seven contract decisions worth SA's attention:

1. **Output columns are named `group_id` / `account_id`, not `session_id` / `user_id`.** In a `RETURNS TABLE` function the output names are in scope inside the body, so an output column named `user_id` makes every `WHERE user_id = …` ambiguous. Renaming is not cosmetic — it is what keeps the body unambiguous.
2. **Window bounds are `>= p_from AND <= p_to`, inclusive on both ends.** A half-open upper bound is tidier for day-boundary presets, but **every other ledger read in the repo is `.gte`/`.lte`** (`listCallsInWindow`, `countInWindow`, `pageChatCalls`), and B2's drill-down will be one of them. AC-B2 requires the drill-down's calls to sum to the row's totals; a one-row disagreement on a boundary timestamp would look exactly like a cost bug. Consistency wins.
3. **The cap is `LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 100)`** — inside the function, in pure SQL, so it survives a caller that reaches the RPC directly with `p_limit => 10000` (re-check carry-forward 4, AC-B11). The route's Zod schema caps it too; that is defence in depth, not the enforcement point.
4. **`total_groups` is the honest filtered count** — `COUNT(*)` over the group set *after* every filter and *before* the cap (FR-B10, AC-B11). It is carried on the single `row_kind = 'total'` row. The existing audit page's dishonest "showing X of Y" is not reproduced here.
5. **The audit side contributes exactly one number: `audit_entry_count`.** One correlated `COUNT(*)`, which doubles as the outcome filter (`p_audit_action IS NULL OR audit_entry_count > 0`). Nothing else about the entry is read in SQL — see [C](#c-bucketing-rpc-vs-calling-code).
6. **No `created_at` bound on the audit sub-query.** An entry is queued when the action *ends*, so an action straddling `p_to` has its entry written after the window. Bounding the lookup by the window would manufacture false "unaudited" rows. The `(entity_id, user_id)` probe is selective enough that the bound buys nothing anyway.
7. **`p_sort` falls back to cost on any unrecognised value**, and every sort ends with `last_call_at DESC, account_id, group_id` so the order is total and stable. An unstable order under a cap means two identical requests can return different rows.

**Sketch of the body** (for SA's review of the shape; the committed file will carry the house-style header):

```sql
WITH bos AS (
  SELECT t.user_id, t.session_id, t.created_at, t.feature, t.provider, t.model_name,
         COALESCE(t.input_tokens, 0)  AS in_tok,
         COALESCE(t.output_tokens, 0) AS out_tok,
         COALESCE(t.cost_usd, 0)      AS cost,
         t.success
  FROM token_usage t
  WHERE t.created_at >= p_from
    AND t.created_at <= p_to
    AND (t.feature LIKE p_feature_prefix || '%' OR t.feature = ANY(p_legacy_features))
    AND (p_account  IS NULL OR t.user_id = p_account)
    AND (p_features IS NULL OR t.feature = ANY(p_features))
),
grouped AS (
  SELECT b.session_id, b.user_id,
         MIN(b.created_at), MAX(b.created_at),
         ARRAY_AGG(DISTINCT b.feature), ARRAY_AGG(DISTINCT b.model_name), ARRAY_AGG(DISTINCT b.provider),
         COUNT(*), COUNT(*) FILTER (WHERE b.success IS FALSE), COUNT(*) FILTER (WHERE b.provider = 'cache'),
         SUM(b.in_tok), SUM(b.out_tok), SUM(b.cost)
  FROM bos b
  WHERE b.session_id IS NOT NULL
    AND NOT (b.user_id = ANY(p_platform_accounts))
  GROUP BY b.user_id, b.session_id          -- the composite key, in the one place it cannot be forgotten
),
filtered AS (
  SELECT g.*,
         (SELECT COUNT(*) FROM audit_trail a
           WHERE a.entity_type = 'ai_action'
             AND a.entity_id = g.session_id::TEXT
             AND a.user_id   = g.user_id
             AND (p_audit_action IS NULL OR a.action = p_audit_action)) AS entries
  FROM grouped g
  WHERE (p_min_cost_usd IS NULL OR g.cost >= p_min_cost_usd)
)
-- 'total' row  UNION ALL  'ungrouped' bucket  UNION ALL  'platform' bucket
-- UNION ALL (SELECT … FROM filtered WHERE p_audit_action IS NULL OR entries > 0
--            ORDER BY <p_sort> LIMIT LEAST(GREATEST(COALESCE(p_limit,100),1),100))
-- then one outer ORDER BY that puts 'total' first and re-applies <p_sort> to the capped rows.
```

### C. Bucketing: RPC vs calling code

| FR | What it needs | Where it lands | Why |
|---|---|---|---|
| **FR-B8 — ungrouped bucket** (`session_id IS NULL`) | `SUM(cost)`, `COUNT(*)`, tokens over an unbounded set | **RPC**, as `row_kind = 'ungrouped'` | It is an aggregate. There is no client-side alternative, and a `NULL` group would otherwise collapse every ungrouped row into one nonsense "group" or be dropped silently |
| **FR-B8 — platform-account bucket** | Same, filtered to `user_id = ANY(p_platform_accounts)` | **RPC**, as `row_kind = 'platform'` | Same reason. The ids are passed in as data (`platformAccountIds()`), never hardcoded — `SYSTEM_ADMIN_USER_ID` is environment-dependent and the all-zero fallback is not the only value |
| FR-B8 — the **labels**, and the sentence "this is not audit loss" | Text | **B1** | Not an aggregate |
| **FR-B10 — the honest "of N"** | `COUNT(*)` over the filtered group set | **RPC**, as `row_kind = 'total'` | An aggregate, and it must be computed before the cap or it is not a count of anything |
| **FR-B5 — cache classification** | `COUNT(*) FILTER (WHERE provider = 'cache')` per group | **RPC** (the number), **B1** (the rule) | The count is an aggregate; deciding that a group whose calls are *all* cache rows is benign rather than lost is a policy sentence |
| **FR-B5 — the residual "no entry found" class** | `audit_entry_count = 0` | **RPC** (the number), **B1** (the class) | Same split |
| **FR-B5 — the trailing exclusion window** | A timestamp comparison | **B1** | Re-check §4 Q4: it must be sized conservatively in minutes, **not** derived from `batchIntervalMs`, and its boundary must be visible on screen. Baking a magic interval into a hand-applied migration would make changing it a second production apply |
| **FR-B6 — reconciliation, summing *all* entries of a multi-entry group** | `SUM((details->>'estimatedCostUsd')::numeric)` | **B3, in TypeScript** | It looks like an aggregate, but it is not an unbounded one: it runs over the entries of ≤100 already-returned `(group_id, account_id)` pairs. Doing it in TS keeps **every `AiAuditDetails` key name out of the SQL**, so the closed shape in `aiActionAudit.ts:101-121` stays the single source of truth. That is the difference between one place to change and two |
| **FR-B9 — the audited-but-unledgered reverse pass** | An anti-join, audit-first | **B3, in TypeScript** | It is not a ledger aggregate at all. B3 reads the window's AI entries through a new, named `AuditTrailRepository` method (capped), and anti-joins them in code against the ledger groups it already has. `NOT EXISTS` is not expressible in PostgREST, but an anti-join over two bounded lists does not need to be |

**The consequence for the audit table:** the RPC reads `audit_trail` for one `COUNT(*)` per candidate group and nothing else. No `details`, no `changes`, no `resource_name`, no email — NFR-2's allow-list posture holds trivially, because the only column values that leave the function are integers, timestamps, uuids and label arrays.

### D. Literals vs parameters

One rule, applied consistently, because SA will otherwise have to ask about each one:

> **A value is a literal in the SQL only when an index predicate requires it. Everything else is a parameter, passed as plain data.**

| Value | Form | Why |
|---|---|---|
| `'business-os'` feature prefix | **Parameter** `p_feature_prefix` | No partial index depends on it (see [E](#e-the-index-proposal)), so the catalogue stays the only source of truth |
| The five legacy feature values | **Parameter** `p_legacy_features` | Most volatile of all — `BOS_LEGACY_FEATURES` carries a standing comment about what happens when a value is added |
| Platform account ids | **Parameter** `p_platform_accounts` | Environment-dependent |
| Area filter values | **Parameter** `p_features` | Request input |
| The two AI event names | **Parameter** `p_audit_action` | Request input |
| `'ai_action'` entity type | **Literal**, once | The only value a partial index predicate needs. Pinned by a guard test asserting the migration text contains exactly the value of `AI_ACTION_ENTITY_TYPE` (`lib/audit/requestSchemas.ts:24`) — the same technique Slice A's X-3 used for its duplicated copy of the same constant |
| `'cache'` provider | **Literal**, once | Written by `recordCachedTurn` (`turnUsage.ts:98`) and by nothing else. Pinned by the same guard test |

### E. The index proposal

**Proposal, to be confirmed or replaced by the measurement in [AC-B16](#measurement-plan-ac-b16).**

**File:** `supabase/migrations/20261006b_business_os_ai_activity_index.sql`

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_token_usage_created_feature_user_session
  ON public.token_usage (created_at DESC, feature, user_id, session_id);
```

**Why this shape:**

- The selective predicate on the sweeping admin's path is **the window, cross-account** — and V-3 found there is no index on `created_at` at all. That, not the missing `feature` index, is why the read is a seq scan.
- `feature`, `user_id` and `session_id` ride along so the feature predicate and the optional account filter are applied on **index tuples**, before the heap fetch. On a ledger where Business OS rows are a minority of a table that also carries every agent-platform call, that is where the saving is.
- The existing `(user_id, created_at DESC)` already serves the *investigating* admin's path (`p_account` given) and Postgres will keep choosing it there. This index is for the path that has nothing today.

**Why not a partial index** `… WHERE feature LIKE 'business-os%'`, which would be far smaller: a partial index is only used when Postgres can prove the query predicate implies the index predicate. The real filter is `feature LIKE <prefix> || '%' OR feature = ANY(<array>)` — a parameter on one side and an OR on the other. Neither branch is provably implied, so the partial index would be built and never used. Making it usable would mean hard-coding the prefix **and** the five legacy values into the index predicate *and* into the function body, identically — a second copy of the call catalogue living in production DDL, silently wrong the day someone adds a legacy value. **Rejected on drift, not on size.**

**Alternatives the measurement will compare** (§ Measurement Plan step 4):

| Variant | Hypothesis |
|---|---|
| **(a) proposed** `(created_at DESC, feature, user_id, session_id)` | Index range on the window, both filters on index tuples |
| (b) `(created_at DESC)` only | Narrower, cheaper to maintain on a high-write ledger; more heap fetches |
| (c) (a) `+ INCLUDE (input_tokens, output_tokens, cost_usd, success, provider, model_name)` | Index-only scan, no heap fetch at all — at a materially larger index and more write amplification |

**Second index, conditional:**

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_audit_trail_ai_action_entity
  ON public.audit_trail (entity_id, user_id)
  WHERE entity_type = 'ai_action';
```

`idx_audit_trail_entity_id` already exists on `entity_id` alone, so each probe is already an index lookup. This one is partial on a **literal equality** (so predicate implication does work) and would be tiny — 56 rows today (V-17). It is proposed **only if** the measurement shows the per-group audit probe is a material share of the runtime. `CREATE INDEX` on a 58k-row table is cheap either way; the discipline is that it is not added on a hunch.

**`CONCURRENTLY` is not optional, and it has a procedural consequence.** A plain `CREATE INDEX` takes a `SHARE` lock on `token_usage` and blocks every insert for its duration — that is every Business OS and agent LLM call, platform-wide, mid-day. `CREATE INDEX CONCURRENTLY` **cannot run inside a transaction block**, and the Supabase SQL editor runs a multi-statement script as one implicit transaction. **So the index cannot live in the same file as the function**, and the `b` file must be pasted and run **on its own**. That is the reason for the two-file split, and it is the same reason `20261005b` exists.

### F. Security lockdown

Exactly the `business_os_usage_summary` posture (D-7), with its reasoning restated in the header for the next reader:

| Property | Value |
|---|---|
| Rights | **INVOKER** — the keyword `SECURITY DEFINER` does not appear in the file, and the guard test asserts its absence |
| Grants | `REVOKE ALL ON FUNCTION public.business_os_ai_activity(<full arg list>) FROM PUBLIC;` then `… FROM anon, authenticated;` |
| Who may execute | **`service_role` only** — it keeps EXECUTE because the REVOKE names `PUBLIC`, `anon` and `authenticated`, not `service_role` (V-5, proven by the live precedent). The only holder of that key on a request path is `supabaseServer`, reached only from `TokenUsageRepository`, reached only from a `requireAdmin`-gated route (B1). Also `postgres`/the owner, for the operator running the post-check by hand |
| Why not `SECURITY DEFINER` | Definer rights would buy nothing — the only caller already bypasses RLS — and would turn `p_account` into a parameter that reads any tenant's spend from a role that is not supposed to have it. This repo carries a queued P1 about **50 anon-callable `SECURITY DEFINER` functions**; this is not the fifty-first |
| Proof | Two checks, both in [§ post-check](#3-post-check-read-only): `has_function_privilege` for `anon`, `authenticated` and `service_role`; **and** an actual anonymous `POST /rest/v1/rpc/business_os_ai_activity` with the public anon key, expected to be refused (AC-B12) |

### G. The repository seam

**File:** `lib/repositories/TokenUsageRepository.ts`

```typescript
export interface AiActivityRow { /* one row of the RPC, BIGINT/NUMERIC as number | string */ }
export interface AiActivityQuery { /* account?, features?, auditAction?, minCostUsd?, sort, limit,
                                      featurePrefix, legacyFeatures, platformAccounts */ }

async listAiActivityGroupsAllAccounts(
  window: TokenUsageWindow,
  query: AiActivityQuery
): Promise<RepositoryResult<AiActivityRow[]>>
```

Five constraints, all of them verified against the tree (V-8, V-9, V-10):

1. **`AllAccounts` is in the name** (NFR-4.1). "All accounts" is reached by calling a differently *named* method, never by omitting an argument — `query.account` narrows, it does not unlock. Arity **2**.
2. **`EXPECTED_ARITY` is extended in the same commit** — and so is the **pre-existing missing entry** `summariseFeatureAllAccountsInWindow: 2` (V-8). That test is red on `main` today and no workflow runs it; B0 leaves it green and says so in the Commit Info.
3. **No import from `lib/business-os/**`.** The prefix, the legacy list and the platform ids arrive in `query` as plain strings and arrays. `callCatalog` is not named in the file (the source-text assertion checks both).
4. **No new `TOKEN_USAGE_COLUMNS` entry.** The RPC returns its own shape; the allow-list extension for `user_id` / `model_name` / `provider` is B2's (V-9).
5. **Guards run before the call**, matching the file's existing style: valid window, `limit` an integer in 1..100 (**refused, not silently clamped** — clamping in two places invites them to disagree), `featurePrefix` and every feature value against `LABEL_PATTERN`, every account id against `UUID_PATTERN`, `sort` in `{cost, time}`, `auditAction` against a conservative pattern. Logged at **`info`, not `debug`** — it is a cross-tenant read, matching `listChatCallsAllAccountsInWindow`.

**Why the method is in B0 and not B1:** the brief scopes this slice to "the database read path", and the seam is part of it — the contract-pin edit, the typed row shape and the argument marshalling are all consequences of the function's signature. It also gives B0 something testable without a database (the fake RPC handler, V-11) and leaves B1 as route + UI. The alternative — a migration with no caller — is raised as [OQ-3](#open-questions-for-sa).

### H. Migration file shape and house style

Following V-13 and V-15:

- **Two files**, both under `supabase/migrations/`, numbered after the current head `20261005b`:
  - `20261006_business_os_ai_activity.sql` — header block, `CREATE OR REPLACE FUNCTION`, `COMMENT ON FUNCTION`, the two `REVOKE`s. Safe as one transaction; re-runnable.
  - `20261006b_business_os_ai_activity_index.sql` — header block, **one** `CREATE INDEX CONCURRENTLY IF NOT EXISTS` statement, run on its own (see [E](#e-the-index-proposal)).
- **Header blocks** carry, in the precedent's order: what the read costs today and why Node cannot do it (with the measured numbers from §Measurement); why not a narrower client-side select (`PGRST123`); why not `SECURITY DEFINER`; the pre-check, the post-check and the **rollback** as copy-pasteable SQL; and, in the `b` file, a banner that it must be run alone and not inside a transaction.
- **Idempotency:** `CREATE OR REPLACE FUNCTION` and `CREATE INDEX … IF NOT EXISTS`, so a re-run is a no-op. **One caveat to document in the header:** `CREATE OR REPLACE` cannot change a function's return type — if the `RETURNS TABLE` shape ever changes, the replacement needs an explicit `DROP FUNCTION` first, and dropping requires the **full argument type list**. `CREATE OR REPLACE` also preserves the existing ACL, so the `REVOKE`s stay in force across a replace and re-running them is harmless.
- **No data is written, read or moved.** Nothing in either file touches a row.

---

## Files to Create / Modify

| File | Action | Change shape |
|------|--------|---|
| `supabase/migrations/20261006_business_os_ai_activity.sql` | create | The function + `COMMENT ON` + two `REVOKE`s, under a house-style header carrying pre-check, post-check and rollback. One transaction, re-runnable |
| `supabase/migrations/20261006b_business_os_ai_activity_index.sql` | create | One `CREATE INDEX CONCURRENTLY IF NOT EXISTS` on `token_usage`, plus (conditionally) the `audit_trail` partial index. **Run alone, outside a transaction** |
| `scripts/preflight-bos-ai-activity-migration.sql` | create | Read-only. Sizes the table, records the BEFORE plan, confirms the function and index names are free, confirms column types (V-16) |
| `scripts/verify-bos-ai-activity-migration.sql` | create | Read-only. The post-check: grants, `indisvalid`, the live cross-tenant probe (see [Test Plan](#test-plan)), and the AFTER plan |
| `lib/repositories/TokenUsageRepository.ts` | modify | One new method + its two exported interfaces + guards. Header amended to name the **third** deliberate all-accounts read |
| `lib/business-os/usage/__tests__/tokenUsageRepository.contract.test.ts` | modify | `EXPECTED_ARITY` += the new method **and** the pre-existing missing `summariseFeatureAllAccountsInWindow` (V-8); one `@ts-expect-error` line proving the method takes no account parameter |
| `lib/repositories/__tests__/TokenUsageRepository.test.ts` | modify | Unit tests for the new method against the fake RPC handler |
| `supabase/migrations/__tests__/business-os-ai-activity.migration.test.ts` | create | SQL-text guard over both files, reusing the entitlements test's comment/body strippers (V-15) |

**No file under `app/`, `components/` or `hooks/` is touched.** `app/api/cron/insight-detect/route.ts` is **not** touched (another Dev's slice).

---

## Task List

### T0 — Branch setup (BLOCKER)

- [ ] ⛔ **Escalate to TL if the branch does not exist.** Verified 2026-09-24: current branch is `main`; no `feature/admin-ai-activity-slice-b0` exists locally or on the remote. **Dev does not create branches — RM does, at cycle kickoff.** No file in this slice is written until it exists and `git branch --show-current` confirms it.
- [ ] Record the branch name in this document's header.

### T1 — Read the live schema before writing any SQL

- [ ] Run the preflight's read-only column query on production and record: the exact types of `token_usage.session_id`, `user_id`, `cost_usd`, `input_tokens`, `output_tokens`, `provider`, `model_name`, `feature`, `success`, `created_at`; whether `total_tokens` is generated; and the exact type of `audit_trail.entity_id` (V-7, V-16). **The function is not written against an assumption.**
- [ ] Record the table's size (rows, bytes, rows in a 31-day window, distinct `(session_id, user_id)` groups in that window) — [Measurement step 0](#measurement-plan-ac-b16).

### T2 — Measure BEFORE

- [ ] `EXPLAIN (ANALYZE, BUFFERS)` the function body inlined, at the widest window, cross-account. Record rows, buffers and time in the [Measurement Record](#measurement-record).

### T3 — Write `20261006_business_os_ai_activity.sql`

- [ ] Function per [B](#b-the-function-contract): `LANGUAGE sql STABLE SET search_path = public`, INVOKER, composite `GROUP BY`, in-function cap, the three non-group `row_kind`s, stable total ordering.
- [ ] `COMMENT ON FUNCTION`, then `REVOKE ALL … FROM PUBLIC` and `… FROM anon, authenticated`.
- [ ] Header: cost, `PGRST123`, why not `SECURITY DEFINER`, pre-check, post-check, rollback, the `CREATE OR REPLACE` return-type caveat.

### T4 — Write `20261006b_…_index.sql`

- [ ] The proposed index, `CONCURRENTLY`, `IF NOT EXISTS`, one statement, with the "run this alone" banner and the reason.

### T5 — The repository seam

- [ ] `listAiActivityGroupsAllAccounts` per [G](#g-the-repository-seam), with guards, `info` logging and the amended file header.
- [ ] Extend `EXPECTED_ARITY` by **two** entries (the new one and the pre-existing gap, V-8); add the `@ts-expect-error` contract line.

### T6 — Tests

- [ ] `business-os-ai-activity.migration.test.ts` (see [Test Plan](#test-plan)), each assertion naming the decision it protects.
- [ ] Repository unit tests against the fake RPC handler.
- [ ] Run the migration guards' **mutation test**: break each protected property in a scratch copy, confirm the corresponding assertion goes red, restore byte-identically.

### T7 — Verification (local)

- [ ] `npx jest lib/repositories lib/business-os/usage supabase/migrations` — green, including the contract test that is red on `main` today.
- [ ] `npx tsc --noEmit` scoped to the touched files — no new errors.
- [ ] `npx eslint` on the touched files — no new warning against the pre-change baseline.
- [ ] `npm run typecheck:bos-llm` — the repository must not have entered the gate's scope.

### T8 — Apply to production (checkpoint, D-7)

- [ ] Run the [Migration Application Procedure](#migration-application-procedure) with the user. **B1 cannot be verified until this is done and recorded in [§ Applied to Production](#applied-to-production).**

### T9 — Measure AFTER and record

- [ ] Re-run T2's measurement; fill in the [Measurement Record](#measurement-record); confirm or replace the index choice; paste the final numbers into the migration header.

---

## Migration Application Procedure

Applied **by hand, in the Supabase SQL editor, against production** — there is no branch database (D-7). Following `PAYMENT_TABLES_WRITE_LOCKDOWN_WORKPLAN.md` §5.

### 1. Pre-check (read-only)

`scripts/preflight-bos-ai-activity-migration.sql`, run first and read:

| Query | Expected |
|---|---|
| `SELECT proname FROM pg_proc WHERE proname = 'business_os_ai_activity'` | **0 rows.** A row means a previous attempt partly landed — stop and read its signature |
| `SELECT indexname FROM pg_indexes WHERE tablename IN ('token_usage','audit_trail') ` | The three known `token_usage` indexes and the eight `audit_trail` ones; **neither new name present** |
| Column types for the ten columns in T1 | Match what the function assumes |
| `SELECT COUNT(*), pg_size_pretty(pg_total_relation_size('token_usage')) FROM token_usage` | Recorded — this is the number the repo has never had |
| Rows in the widest window; distinct `(session_id, user_id)` groups in it | Recorded; drives the AC-B16 expectation |
| `EXPLAIN (ANALYZE, BUFFERS)` of the inlined body | The BEFORE plan |

### 2. Apply

1. **No application code needs to ship first.** Nothing reads the function until B1. The repository method added in B0 has no caller, so deploy order is free in both directions.
2. Paste **`20261006_business_os_ai_activity.sql` whole** and run it. It is one transaction.
3. Paste **`20261006b_…_index.sql` ALONE** and run it — nothing above it, nothing below it. `CREATE INDEX CONCURRENTLY` cannot run inside a transaction block, and a multi-statement paste is one. If it errors with `cannot run inside a transaction block`, something else was in the editor buffer.
4. `CONCURRENTLY` can fail part-way and leave an **invalid** index that is maintained on writes and used by nothing. Step 3 of the post-check is not optional.

### 3. Post-check (read-only)

`scripts/verify-bos-ai-activity-migration.sql`:

| # | Query | Expected |
|---|---|---|
| P1 | `prosecdef`, `provolatile`, `proconfig` for the function | `false` (INVOKER), `s` (STABLE), `{search_path=public}` |
| P2 | `has_function_privilege('anon', …, 'EXECUTE')`, same for `authenticated` | **false, false** |
| P3 | `has_function_privilege('service_role', …, 'EXECUTE')` | **true** — the half that proves the lockdown did not lock out its only caller |
| P4 | `SELECT indisvalid FROM pg_index … ` for the new index | **true**. `false` = the concurrent build failed; drop it concurrently and retry |
| P5 | `pg_size_pretty(pg_relation_size('idx_token_usage_created_feature_user_session'))` | Recorded |
| P6 | Anonymous `POST /rest/v1/rpc/business_os_ai_activity` with the public anon key | Refused (AC-B12). The end-to-end half of P2 |
| P7 | The **live cross-tenant probe** — see [Test Plan T-6](#test-plan) | Two rows, disjoint totals |
| P8 | A call with `p_limit => 10000` | **≤ 100** `row_kind = 'group'` rows (AC-B11) |

### 4. Rollback

In the header of each file, and disarmed by a comment banner in the precedent's style:

```sql
-- Function: the identity of a function is its FULL argument type list.
DROP FUNCTION IF EXISTS public.business_os_ai_activity(
  TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT[], UUID[], UUID, TEXT[], TEXT, NUMERIC, TEXT, INT);

-- Index: CONCURRENTLY here too, and again it must be run on its own.
DROP INDEX CONCURRENTLY IF EXISTS public.idx_token_usage_created_feature_user_session;
```

**The lesson from V-14, applied.** The payment-lockdown rollback failed on one table because it named the object by a string the database had stored differently. The same class of defect here is the **argument list**: `DROP FUNCTION … (uuid, timestamptz)` against a function created with eleven parameters silently drops nothing under `IF EXISTS`, and a later re-apply then stacks a *second overload* that PostgREST may resolve to either way. So:

- the rollback's argument list is **copied from the `CREATE`, not retyped**, and a guard test asserts the two lists are character-identical;
- the post-check's P1 query counts overloads (`SELECT COUNT(*) FROM pg_proc WHERE proname = 'business_os_ai_activity'`) and expects exactly **1**, before and after.

**Rolling back is worse than fixing forward once B1 is deployed:** the view has no Node fallback by design (FR-B11 rejects summing in Node), so a dropped function makes the page show an error state rather than a wrong number. That is the intended failure mode, and it is stated in the header so nobody "fixes" an unrelated bug by dropping this.

### 5. Applied-state record

The outputs of §1 and §3, plus the [Measurement Record](#measurement-record), are pasted into [§ Applied to Production](#applied-to-production) **in this document**, dated, with who ran them. That section is the record; a green post-check that lives only in an editor tab is not one.

---

## Measurement Plan (AC-B16)

AC-B16 demands the same measurement **before and after the index**, so the index's value is evidenced rather than assumed. That is also why the index shape is proposed here and not pinned in the requirement (re-check §4 Q3).

**Where it runs:** production, read-only, in the Supabase SQL editor, by the user or QA (V-17 establishes that access). There is no branch database and no other environment with comparable data.

**The window:** 31 days — the widest of D-3's six presets (Last Month). **B1's Zod bound (NFR-10) must be set to the window that was actually measured here**; setting a wider bound than the one with a measurement behind it would make AC-B16 decorative.

| Step | What | Recorded |
|---|---|---|
| **0** | Size the ledger: total rows, total bytes, `n_live_tup`, rows in the 31-day window, Business OS rows in it, distinct `(session_id, user_id)` groups in it, rows with `session_id IS NULL`, rows on a platform account | The figures the repo has never had. Direct analogue of QA's 58,261 for `audit_trail` |
| **1** | **BEFORE:** `EXPLAIN (ANALYZE, BUFFERS)` on the inlined body, 31 days, cross-account, `p_sort => 'cost'` | Plan node types (expect `Seq Scan on token_usage`), actual rows, `shared hit/read`, execution time |
| **2** | BEFORE, second shape: the same with `p_account` set (the investigating admin's path) | Expect the existing `(user_id, created_at DESC)` index to be chosen already |
| **3** | BEFORE, third shape: the same with `p_audit_action` set, to isolate the per-group audit probe's share | Decides whether the conditional `audit_trail` index is built |
| **4** | Build variant (a); re-run 1–3. Then, only if (a) disappoints, try (b) and (c) from [E](#e-the-index-proposal), dropping each concurrently between trials | One row per variant in the record below |
| **5** | **AFTER:** the winning variant's numbers, plus index size and build time | The table below |
| **6** | Wall clock for the function *as called*, three runs, cold and warm | The number an operator will feel |

**Honest limits of this measurement, stated up front:** production Business OS AI volume today is small (56 `ai_action` entries, V-17), so step 1 measures the *scan*, not a heavy aggregate. The scan is the part that grows with the whole ledger and the part the index addresses, so the before/after remains meaningful — but the record will say plainly that this is a measurement at current volume, not a load test, and NFR-6's growth argument stays an argument.

### Measurement Record

*(filled in at T2 and T9; empty is a failed acceptance criterion, not a formatting gap)*

| Measurement | Before | After | Delta |
|---|---|---|---|
| Ledger rows / size | | | — |
| Rows in the 31-day window | | | — |
| Distinct `(group, account)` in it | | | — |
| Plan (cross-account) | | | |
| Actual rows scanned | | | |
| Shared buffers hit / read | | | |
| Execution time (ms) | | | |
| Plan (single account) | | | |
| Audit-probe share | | | |
| Index size / build time | — | | — |

---

## Test Plan

**The constraint that shapes this plan:** there is no branch database, so **no behavioural test of the SQL can run in CI**, and AC-B5's "seeded" fixtures cannot be seeded on production. Everything below is honest about which side of that line it sits on.

### Automated (Jest, no database)

| # | Test | Protects |
|---|---|---|
| T-1 | The migration text contains **no** `SECURITY DEFINER`, and does contain `LANGUAGE sql`, `STABLE`, `SET search_path = public` | D-7, AC-B12 |
| T-2 | It contains `REVOKE ALL ON FUNCTION … FROM PUBLIC` **and** `… FROM anon, authenticated` | D-7, AC-B12 |
| T-3 | **The `GROUP BY` names both columns, and no `GROUP BY` names `session_id` without `user_id`** — asserted on comment-stripped text, so prose about the rule cannot satisfy it | F-13, AC-B5. The single most important guard in the slice |
| T-4 | The `LIMIT` expression caps at the literal `100` inside the function | AC-B11, re-check carry-forward 4 |
| T-5 | The literals `'ai_action'` and `'cache'` in the SQL equal `AI_ACTION_ENTITY_TYPE` and the provider written by `recordCachedTurn`; no other catalogue value appears as a literal | [D](#d-literals-vs-parameters) |
| T-6 | The rollback's `DROP FUNCTION` argument list is character-identical to the `CREATE`'s | V-14's lesson |
| T-7 | The index file contains `CONCURRENTLY`, `IF NOT EXISTS`, and exactly **one** top-level statement | [E](#e-the-index-proposal) |
| T-8 | Repository: the RPC name and every argument are marshalled exactly once, from the typed query object | — |
| T-9 | Repository: `limit` > 100, an inverted window, a bad feature value, a non-UUID account and an unknown `sort` are each **refused before any call** (`rpcCalls` empty) | Defence in depth |
| T-10 | Repository: an RPC error returns `{ data: null, error }` and never throws; the cross-tenant read logs at `info` | File convention |
| T-11 | Contract test: the method set and arity pin is **green**, including the pre-existing `summariseFeatureAllAccountsInWindow` gap | V-8, AC-B15 |
| T-12 | Contract test: the repository still imports nothing from `lib/business-os/**` | NFR-4.2 |

All twelve are **mutation-tested** before they are trusted (the Slice A / QA convention): break the property in a scratch copy, confirm the assertion goes red, restore byte-identically.

### Live, read-only, on production (QA, at the apply checkpoint)

| # | Check | Criterion |
|---|---|---|
| **L-1** | **The cross-tenant regression, done on real data instead of fixtures.** Find a `session_id` that genuinely spans two `user_id`s — production already contains them, because `insight-detect` mints one `runId` per run across every business (V-4). Call the function over a window containing it | **Two `row_kind = 'group'` rows, one per account**, whose `ledger_cost_usd`, `call_count` and token totals each equal an independent per-account `SELECT`, and whose totals **sum** to the shared group's overall total with no overlap (AC-B5) |
| L-2 | Drill-down disjointness, in advance of B2: the per-account `SELECT … WHERE session_id = X AND user_id = A` returns no row belonging to B | AC-B5 |
| L-3 | `p_limit => 10000` on a window with more than 100 groups | ≤ 100 group rows returned; `total_groups` larger than the row count (AC-B11) |
| L-4 | `anon` and `authenticated` `has_function_privilege` → false; `service_role` → true; anonymous REST call refused | AC-B12 |
| L-5 | Ungrouped and platform buckets: compare `row_kind='ungrouped'` / `'platform'` against independent `SELECT`s | AC-B9's B0 half |
| L-6 | `total_groups` against an independent `COUNT(DISTINCT (session_id,user_id))` under the same filters | AC-B11's "honest count" |

**Deviation from AC-B5 that SA must accept or reject ([OQ-2](#open-questions-for-sa)):** AC-B5 says *"a **seeded** insight run whose single group id spans two businesses"*. Seeding is impossible without a throwaway database, and writing rows into production `token_usage` to test a read is not acceptable. L-1 substitutes the **real** occurrence of exactly that data shape — which is arguably stronger evidence, since it is the production defect rather than a reconstruction of it — but it is discovered, not constructed, so it cannot cover a shape production happens not to contain. If SA wants constructed fixtures, the prerequisite is a throwaway Postgres (local `supabase start` or docker) plus a minimal DDL for the two tables, and that is new tooling needing its own review.

---

## Risks

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R-1 | **The requirement's `feature LIKE 'business-os-%'` is used instead of `bosRowFilter()`'s real predicate**, and every legacy row — real Business OS spend — silently vanishes from an operator's cost view | **High** | V-6; the function mirrors `bosRowFilter()`, the prefix and legacy list are parameters supplied from the catalogue, and [OQ-1](#open-questions-for-sa) asks BA to correct the requirement's prose |
| R-2 | The per-group audit probe dominates the runtime once group counts grow into the thousands (chat writes one group per turn) | Medium | Measured explicitly in step 3; the conditional partial index on `audit_trail` is the answer, and it is near-free |
| R-3 | `CREATE INDEX` without `CONCURRENTLY` blocks every LLM call's ledger insert, platform-wide, for the build | **High**, fully avoidable | `CONCURRENTLY`, in its own file, run alone, with the reason in the banner |
| R-4 | A failed concurrent build leaves an **invalid** index: maintained on every write, used by nothing | Medium | Post-check P4 on `indisvalid`; the remedy (`DROP INDEX CONCURRENTLY`, retry) is in the header |
| R-5 | The rollback names the wrong argument list and silently drops nothing, then a re-apply stacks a second overload | Medium | T-6 pins the two lists identical; P1 counts overloads and expects exactly 1 |
| R-6 | `token_usage`'s DDL is not in the repo, so the function is written against assumed types | Medium | T1 reads the live schema first; the function avoids `total_tokens` and sums the two token columns instead (V-16) |
| R-7 | The contract test is red on `main` and no CI job runs it, so the "pin" SA-6 relies on catches nothing | Medium | B0 fixes the pin (V-8) and reports the gap. **Making Jest a required check is out of scope** — it belongs to the parked test-tiering work |
| R-8 | The measurement is taken at today's small Business OS volume and reads as a stronger guarantee than it is | Low | The record states the limitation in its own words; the scan — the part that scales with the whole ledger — is what is measured |
| R-9 | Index write amplification on a high-write ledger is not free, and variant (c) makes it worse | Low | Variant comparison in step 4; index size recorded; the narrowest variant that meets the target wins |
| R-10 | The other Dev's F-13 fix lands and someone concludes the composite key is no longer needed | Low | Stated in [Analysis Summary](#analysis-summary) and in the migration header: historical rows keep the shared id and cannot be retroactively split |

---

## Non-Goals

Recorded so the diff does not quietly grow them:

- **No API route.** B0 adds none. B1's route must call `requireAdmin` as its first statement (SA-7) and must not live under `app/admin/**`.
- **No UI, no page, no sidebar entry, no cross-link.** B1 / B3.
- **No classification labels, no trailing exclusion window, no $0.0001 marker, no reverse pass.** B1 / B3 — with reasons, in [C](#c-bucketing-rpc-vs-calling-code).
- **No new `TOKEN_USAGE_COLUMNS` entry and no `AuditTrailRepository` method.** B2 and B1/B3 respectively; `AuditTrailRepository`'s header invariant is untouched here because B0 does not read entries through it (NFR-4.4 bites when B1 adds that method).
- **No change to `app/api/cron/insight-detect/route.ts`**, and no sweep of `token_usage.session_id` consumers — another Dev's slice.
- **No change to what is recorded, attributed, grouped or costed.** B0 reads.
- **No conversion of the existing inline service-role admin routes** (F-11 / repo-conformance sweep).
- **No Jest-in-CI work**, despite R-7 — that is the parked test-tiering cycle.
- **No `SECURITY DEFINER`, ever.**

---

## Open Questions for SA

Three, each of which genuinely needs a ruling before implementation.

**OQ-1 — The requirement's Business OS feature predicate is wrong; confirm the correction.** "What one row is" and FR-B11 both say `feature LIKE 'business-os-%'`. The codebase's filter is `feature LIKE 'business-os%'` **OR** one of five legacy values (V-6). The requirement's version would drop the legacy briefing tag `business-os`, every `insight-generation` / `lead-reply` / `landing-page-generation` / `health-summary-generation` / `correlated-insight-generation` row, and any misspelled area — all of it real Business OS spend, silently missing from a cost view. **Proposed:** the function mirrors `bosRowFilter()` exactly, with the prefix and the legacy list passed in as data, and BA amends the requirement's prose. Confirm, and confirm that the correction is a doc fix rather than a scope change.

**OQ-2 — Accept the live cross-tenant probe (L-1) as AC-B5's B0-side evidence, in place of seeded fixtures.** Production cannot be seeded and there is no throwaway database. L-1 uses the real shared-`runId` data instead. Accept, or rule that B0 must first stand up a local Postgres — which is new tooling and needs its own review.

**OQ-3 — Confirm the slice boundary: does the repository method belong in B0?** This plan puts it here, because the contract-pin edit and the typed row shape are consequences of the function's signature, and because it gives B0 something testable without a database. The cost is that it lands with no caller until B1. The alternative is a migration alone and everything typed in B1. **Proposed: keep it in B0.**

**One minor item SA may want to overrule rather than a question:** the two FR-B8 buckets are subject to the window, account and feature filters (which are row-level) but **not** to `p_audit_action` or `p_min_cost_usd` (which are properties of a group, and a bucket is by definition not a group). B1 must say so on screen. If SA prefers the buckets to ignore *every* filter but the window, that is a one-line change here and a different sentence in B1.

---

## Applied to Production

*(Filled in at T8. Until this section carries dated pre-check and post-check output, B0 is not done and B1 cannot be verified — D-7.)*

| Step | Result |
|---|---|
| 1. Pre-check | |
| 2. Function applied | |
| 3. Index applied (run alone) | |
| 4. Post-check P1–P8 | |
| 5. Measurement record filled | |
| 6. Rollback needed? | |

---

## SA Review Notes

**Reviewed by SA — 2026-09-24**
**Status:** 🔄 **Approve with changes.** The slice boundary, the security posture and the migration procedure are right, and the verification log is the most useful part of the document — including where it corrects me. Fourteen changes below; **B-1, B-2, B-3 and B-8 must be resolved in the document before any SQL is written**, because each one is a way this function can ship looking correct and be wrong. Reviewed jointly with [insight-run-group-id-per-business-workplan.md](/docs/workplans/insight-run-group-id-per-business-workplan.md); the cross-plan rulings are in §Cross-plan below.

---

### 1. Rulings on the six corrections

**Correction 1 (V-6 / OQ-1) — `feature LIKE 'business-os-%'` is wrong. UPHELD.**

Verified directly: `BOS_FEATURE_FILTER_PREFIX = 'business-os'` (`callCatalog.ts:129`, no trailing hyphen) and `bosRowFilter()` (`:139-141`) returns prefix **plus** `BOS_LEGACY_FEATURES_FLAT` — `insight-generation`, `correlated-insight-generation`, `health-summary-generation`, `landing-page-generation`, `lead-reply`, and the legacy briefing tag `business-os` exactly. The requirement's text at `:254` and `:560` would drop all of it from a cost view.

**Ruling: a documentation correction, not a scope change.** Your read is what the code does; the requirement's prose is a transcription error, and correcting it does not change what Gap B is for or what it costs. **BA amends `:254` and `:560` to point at `bosRowFilter()` rather than restate a predicate** — restating it in prose is how this drifted in the first place; the requirement should name the function, not copy its body.

Two things I am adding to the correction:

- The prefix and legacy list must be sourced from `bosRowFilter()` **at the B1 call site**, never inside `TokenUsageRepository` (the import ban, V-10). B0's repository unit test must prove the marshalling — that whatever the caller passes reaches `p_feature_prefix` / `p_legacy_features` unaltered and unenriched.
- `BOS_LEGACY_FEATURES.onboarding` is deliberately empty and carries a standing comment explaining that listing it would break `isBusinessOsFeature` and Check 2. **Do not "fix" that while mirroring the filter.** One line in the migration header.

**Correction 2 (V-8) — the contract pin is red on `main` and nothing in CI runs it. UPHELD; my SA-6 claim was wrong.**

I ran it: `npx jest lib/business-os/usage/__tests__/tokenUsageRepository.contract.test.ts` → **1 failed, 4 passed**. `summariseFeatureAllAccountsInWindow` is on the prototype (`TokenUsageRepository.ts:455`, arity 2) and absent from `EXPECTED_ARITY`. And six workflows run only `test:authz-guard`, `test:bos-entitlements` and the plugin suites — no Jest. **SA-6's "adding a method fails CI" was true of the test and false of the pipeline.** Thank you for checking it rather than quoting it.

**Rulings, three parts:**

1. **Fixing the pin belongs in B0.** You cannot add your entry to a file whose assertion is already failing and claim the pin verified your change; leaving it red would make T-11 meaningless. It is in a file you must edit anyway.
2. **But it is its own first commit on the branch**, with a message naming it as a **pre-existing** defect introduced by the Layer 2 ledger work, so RM and QA can see B0 did not cause it and can cherry-pick it if B0 slips. Do not bury it in the B0 commit.
3. **The CI gap gets its own recorded item, and is out of scope here — I agree with R-7.** Two additions: it must be *recorded*, not only noted in a risk table; and **the requirement's SA-6 bullet 1 must be corrected too** (it asserts a CI property that does not exist, and the next reader will rely on it exactly as you nearly did). BA makes that correction alongside OQ-1.

**Correction 3 (V-3) — the real index gap is `created_at`. UPHELD as reasoning, DOWNGRADED as fact.**

The conclusion is right: `(user_id, created_at DESC)` cannot serve a cross-account window read, and that is what makes the sweeping admin's path a scan. But the evidence is *repo migration files*, and your own V-16 establishes that the repo is **not** the source of truth for this table — it was created in the dashboard, and so may its indexes have been.

**Required change:** the pre-check must **enumerate and record** `pg_indexes` for both tables, not assert "the three known `token_usage` indexes and the eight `audit_trail` ones". An unexpected index is information (it may already serve the path, or it may explain a plan you did not predict); a pre-check that expects a count will read it as a failure. Same fix applies to the `audit_trail` row — `create_audit_trail.sql` declares six, not eight.

**Correction 4 (V-7) — the join needs `g.session_id::TEXT`, casting the uuid side. UPHELD.**

Verified: `audit_trail.entity_id TEXT` (`create_audit_trail.sql:15`), `idx_audit_trail_entity_id` on it (`:42`), and the ledger's `session_id` validated as a UUID on write (`aiAnalytics.ts:139`). Casting the uuid keeps the text index usable; casting the text side would not.

**Add one warning to the header:** `audit_trail` has **its own `session_id TEXT` column** (`create_audit_trail.sql:25`), unrelated to `token_usage.session_id`. Name it explicitly so nobody later "corrects" the join to use the column with the matching name. This is a genuine foot-gun and costs one comment line.

**Correction 5 (V-9) — `TOKEN_USAGE_COLUMNS` belongs to B2. UPHELD.**

The RPC returns its own shape; the three missing columns serve FR-B2's drill-down. One consequence to record so QA does not fail you on it: **AC-B15 is satisfied across B0 + B2, not within B0** — it bundles the method-set pin (B0), the import ban (B0), the new column allow-list (B2) and `AuditTrailRepository`'s header (B1/B3). State that split in the Test Plan.

**Correction 6 (V-16) — `token_usage`'s DDL is not in the repo; read the live schema first. UPHELD, and make it a hard gate.**

Confirmed: no `CREATE TABLE … token_usage` anywhere under `supabase/`, and the generated catalog does not cover it either. **T3 must not start until T1's output is pasted into this document.** Add that as an explicit blocker line on T3, in the style of T0. A function written against assumed types, applied by hand to production, with no branch database to catch it, is the single most expensive mistake available in this slice.

---

### 2. Rulings on OQ-2 and OQ-3

**OQ-2 — the live probe is ACCEPTED in place of seeded fixtures, with three conditions.**

You are right that it is stronger evidence, and you are right about the limitation. AC-B5's word "seeded" described a method, not the property being tested; the property is what matters. **Standing up a local Postgres is rejected** — new tooling, its own review, disproportionate to one assertion.

Conditions:

1. **L-1's evidence must be reproducible.** Record the concrete `session_id`, the two `user_id`s and the window in the Applied-to-Production section. "We found one and it worked" is an anecdote; the identifiers make it a check someone else can re-run.
2. **Pin L-1's window to a pre-cut-over range, explicitly.** The shared-id data exists only because F-13 is unfixed. Once the parallel fix lands, such windows start ageing out of D-3's six presets, and a future re-run of L-1 over "last month" will silently find nothing to test and pass. Cite the cut-over date (see Cross-plan X-1) and pin the window.
3. **Because L-1 is discovered rather than constructed, T-3 has to carry more weight than it currently can.** See B-1 — as specified, T-3 can silently disarm itself, and it is the only other thing protecting the composite key.

**OQ-3 — the repository method stays in B0. CONFIRMED.**

Your reasoning holds: the typed row shape and the contract-pin edit are consequences of the signature, and it gives B0 something testable without a database. One condition: **B1 must be the immediately next slice.** An exported method with no production caller is dead code the moment B1 slips, and this repo already carries a repository-conformance sweep as open debt. If B1 is not next, move the method to B1 and ship B0 as the migration alone.

**The minor item you offered for overrule — the FR-B8 buckets and which filters apply.** Your reading is right and I am not overruling it: the buckets are row-level populations, so they honour the window, account and feature filters and cannot honour group-level filters (`p_audit_action`, `p_min_cost_usd`) because a bucket is not a group. **Keep it as proposed.** But it must be a documented property, not an emergent one — it goes in the `COMMENT ON FUNCTION` text as well as on B1's screen, because an operator who filters to "failed only" and still sees an ungrouped bucket will otherwise read it as a bug.

---

### 3. Findings — things this plan gets wrong or leaves undefined

| # | Finding | Priority |
|---|---|---|
| **B-1** | **T-3 is at risk of being vacuous, and it is the guard you yourself call the most important in the slice.** The entitlements helper you propose to reuse, `stripFunctionBodies`, replaces every `$$ … $$` span with a placeholder. The precedent function (`20260929_usage_summary.sql`) is `AS $$ … $$`, so if you follow it, the text T-3 inspects **contains no `GROUP BY` at all** — and T-3's negative half ("no `GROUP BY` names `session_id` without `user_id`") passes on the empty set. Required: T-3, T-4 and T-5 run on **comment-stripped, body-INTACT** text; and the test opens with a sentinel assertion that the extracted text contains `GROUP BY` and a non-trivial body, so a future change to the stripping cannot disarm it in silence. Note `stripFunctionBodies` also does not strip `$tag$`-quoted bodies, so which quoting you choose changes the test's meaning — pin the quoting style in the test | **High** |
| **B-2** | **The four `row_kind`s are not defined as a partition, and as sketched they overlap.** `grouped` excludes `session_id IS NULL` **and** platform accounts. A platform-account row with a NULL `session_id` therefore qualifies for the `ungrouped` bucket *and* the `platform` bucket, and is counted twice by anything that adds them. Required: define the kinds as an explicit **ordered** partition of the filtered row set (proposal: platform first, then ungrouped, then group), state the order in the header and the `COMMENT ON`, and add a live check that the three populations' `call_count`s sum to the unfiltered row count for the window | **High** |
| **B-3** | **The `total` row's contract is undefined, and the count can disagree with the rows it counts.** (a) `RETURNS TABLE` gives the `total` row all sixteen columns; only `total_groups` is specified. Say what `ledger_cost_usd`, `call_count` and the token columns mean on it — or return NULL and say that. (b) More seriously: the sketch applies `p_min_cost_usd` in `filtered` but `p_audit_action`/`entries > 0` in the final branch. `total_groups` must be `COUNT(*)` over **exactly the relation the capped rows are drawn from**, same predicates, one CTE, counted once. As sketched, "of N" and the rows can disagree — which is precisely the dishonest-count defect (F-5) that FR-B10 exists to avoid, reproduced in the function meant to fix it | **High** |
| **B-4** | **`p_sort` cannot parameterise an `ORDER BY` in `LANGUAGE sql`.** It has to be two separate `CASE` expressions — `ORDER BY (CASE WHEN p_sort='cost' THEN cost END) DESC NULLS LAST, (CASE WHEN p_sort='time' THEN last_call_at END) DESC NULLS LAST, last_call_at DESC, account_id, group_id` — because NUMERIC and TIMESTAMPTZ cannot collapse into one expression. Also: a per-branch `LIMIT` inside a `UNION ALL` requires the branch parenthesised. Both belong in the plan, not discovered mid-apply against production. And record in the measurement that a `CASE`-based sort is never index-assisted, so the plan will always carry a sort node | **Medium** |
| **B-5** | **`ARRAY_AGG(DISTINCT …)` over nullable columns yields `{NULL}`.** `model_name` and `provider` are nullable on the ledger's own write path. Use `FILTER (WHERE … IS NOT NULL)` on all three array aggregates, or B1 renders a null label. `ARRAY_AGG(DISTINCT …)` is sorted, so ordering is stable — say so, since B1 will compare these arrays | **Medium** |
| **B-6** | **`failed_call_count` counts only `success IS FALSE`; NULL is neither.** There is no `succeeded_call_count`, so B1 will compute `call_count - failed_call_count` and silently fold NULLs into "succeeded". Either add the third count or document the rule. T1 must record whether `success` is `NOT NULL` in production — if it is, this collapses to a non-issue and should be recorded as one | **Medium** |
| **B-7** | **`REVOKE` and `has_function_privilege` both need the full eleven-type signature**, which is the same defect class as R-5 and is not covered by T-6 (which pins only `CREATE` against the rollback). Have P2/P3 resolve the `oid` from P1's overload query and use that, so the argument list is written by hand in exactly one place (`CREATE`) and copied in exactly one (the rollback) | **Medium** |
| **B-8** | **The security claim rests on Supabase's default privileges, not on your `REVOKE`.** `REVOKE ALL … FROM PUBLIC` removes the *default* PUBLIC EXECUTE; `service_role` keeps EXECUTE only because Supabase's `ALTER DEFAULT PRIVILEGES` grants functions explicitly to `anon, authenticated, service_role`. That is an environment property, not a property of this file. V-5's live precedent is good evidence — it is not a guarantee, and it will not hold if the editor session runs as a role those default privileges were not configured for. Consequence: **P3 is a blocking check, not a nice-to-have.** If it returns false, the remedy is an explicit `GRANT EXECUTE … TO service_role` **added to the migration file and re-applied** — never run ad hoc in the editor, or the file and production diverge permanently. Say this in the header and in §2 of the procedure. It is the one way B0 can leave production with a function nobody can call, and nothing would notice until B1 | **Medium** |
| **B-9** | **The window bound is a product decision; B0 must not set it.** "B1's Zod bound must be set to the window that was actually measured here" inverts the dependency. D-3 gives an admin an *arbitrary* explicit range and NFR-10 requires a bound without fixing its value. **Ask TL for the intended maximum before T2 and measure at that width.** If it is wider than 31 days, measure wider. Otherwise B0 quietly sets product policy and AC-B16 measures the wrong thing. (The right standing rule: the bound may never exceed the width that has a measurement behind it — but which width to aim for is BA/TL's call) | **Medium** |
| **B-10** | **Numeric marshalling is load-bearing for B3, and the plan defers it with a comment.** `AiActivityRow`'s "BIGINT/NUMERIC as `number \| string`" is not a decision. PostgREST returns both as JSON numbers, so a NUMERIC `SUM` arrives as a JS float. FR-B6 reconciles that figure against `estimatedCostUsd` at $0.0001 resolution — a float round-trip is exactly how a spurious mismatch marker gets manufactured. Pick one representation, state it in the interface comment, and assert it in the unit test | **Medium** |
| **B-11** | **`auditAction` should be validated against the closed set, not a pattern.** There are exactly two legal values (`AUDIT_EVENTS.BUSINESS_AI_ACTION_COMPLETED` / `_FAILED`), and `LABEL_PATTERN` will not match them anyway. A two-value check is both stricter and simpler than "a conservative pattern", and it is the repository's existing style (`assertMatch`) | Low |
| **B-12** | **Platform-bucket completeness has a known hole.** `platformAccountIds()` deliberately omits a `SYSTEM_ADMIN_USER_ID` that is set but not a UUID — `isPlatformAccountEnvIgnored()` exists to surface exactly that state. If it holds in production, rows on the misconfigured id appear as an ordinary business in the `group` rows. Record the production value of `SYSTEM_ADMIN_USER_ID` during T1, and hand `isPlatformAccountEnvIgnored()` to B1 as something to surface | Low |
| **B-13** | **`cache_call_count` is structurally chat-only.** `provider = 'cache'` is written by `recordCachedTurn` (`turnUsage.ts:98`) and by nothing else, for BizQL chat only, so the column is 0 for the other seven areas by construction — correct as a number, misleading as a uniformly-rendered column. Note it for B1. Also note the sibling discriminator `activity_type = 'cache_hit'` on the same rows, so nobody later adds a second, inconsistent rule | Low |
| **B-14** | V-4's line numbers (`:143`, `:206`) are the requirement's, not `main`'s — the mint is `:145`, the loop `:209`, `groupId: runId` `:228`. Harmless (B0 does not touch the file), but a verification log that reproduces another document's numbers is not verifying them, and that is the log's whole value | Low |

---

### 4. Conformance and posture — assessed

| Check | Verdict |
|---|---|
| **Security: INVOKER + REVOKE, and does this join the anon-callable `SECURITY DEFINER` P1?** | ✅ **No, and correctly so.** INVOKER + a guard test asserting `SECURITY DEFINER` is absent means `p_account` confers nothing on a caller who does not already bypass RLS. This is the opposite of the P1 population. **Subject to B-8** — the REVOKE's *effect* on `service_role` is an environment property and P3 is what proves it |
| **Repository pattern (NFR-4, CLAUDE.md rule 1)** | ✅ New DB access goes through `lib/repositories/TokenUsageRepository.ts`; no inline service-role client; no new route. The `AllAccounts` naming rule and the import ban are both honoured |
| **`.eq('user_id')` (CLAUDE.md rule 4)** | ✅ Deliberately bypassed, under the documented-exception clause: a distinctly named method, `info`-level logging, and a file-header entry naming it as the third deliberate all-accounts read. Correct |
| **Zod (CLAUDE.md rule 2)** | ✅ N/A — B0 adds no route. Correctly deferred to B1/AC-B14. The in-function cap as the enforcement point with Zod as defence in depth is the right way round |
| **Pino (CLAUDE.md rule 3)** | ✅ Zero `console.*` in any file B0 touches. No conversion owed |
| **No hardcoding (Platform Design Principles)** | ✅ The literals-vs-parameters rule in §D is the right rule, correctly applied. `'ai_action'` and `'cache'` are the only literals and both are pinned to their source constants |
| **Over/under-scoping** | ✅ The "aggregate over an unbounded set ⇒ SQL; arithmetic over ≤100 returned rows ⇒ TypeScript" rule is a good boundary and is applied consistently. FR-B6 and FR-B9 are correctly kept out of SQL |
| **Rollback (V-14's lesson)** | ✅ Correct diagnosis and correct generalisation — the truncation defect's real lesson is "name the object exactly as the database stored it", and for a function that is the argument list. T-6 + the overload count is the right pair. **Extend it per B-7** to the REVOKE and the privilege checks, which have the same exposure and are not currently covered |
| **Migration procedure under hand-apply** | ✅ Genuinely good. The two-file split with the reason, the `CONCURRENTLY`-cannot-run-in-a-transaction explanation, `indisvalid` in the post-check, the deploy-order-is-free statement, and the applied-state record in the document rather than an editor tab. The one change is B-8's escalation of P3 to blocking |
| **Measurement honesty** | ✅ Stating up front that this is a measurement at current volume and not a load test is the right call, and R-8 says so in the record itself rather than only in the plan |

---

### 5. Cross-plan: B0 ↔ the F-13 fix

**They agree, and I verified the transition property rather than taking it from either plan.**

- **The `(session_id, user_id)` key holds across the cut-over.** Pre-fix: one `session_id` spans N `user_id`s, so the pair separates them. Post-fix: the group is already unique per business, so the pair is redundant but harmless. There is no date on which the key changes meaning. The F-13 workplan's §4 conclusion — **no backfill, ever, and the composite key is permanent rather than a stopgap** — is **confirmed**, and it is stronger than that plan argues: `audit_trail` carries a `hash` tamper-detection column (`create_audit_trail.sql:31`), so a backfill would invalidate integrity evidence on the one table whose value is that it was not edited.
- **Nothing in B0 assumes the fix has landed.** Confirmed against the Analysis Summary and R-10. Correct, and it should stay that way.
- **X-1 (action, both plans):** B0's L-1 *depends* on the fix **not** having landed for the window it probes. The F-13 workplan publishes a cut-over date; **cite it here and pin L-1's window to a pre-cut-over range.** Neither plan currently states this dependency, and it is the one way the two can quietly interfere.
- **X-2 (make it explicit):** `a.user_id = g.user_id` in the audit sub-query is what makes `audit_entry_count` equal 1 rather than N for historical shared-id groups. It is load-bearing for the pre-fix population, not a tidy-up — say so in the header so it is not simplified away.
- **X-3 (sequencing hygiene):** both branches edit the requirement document. Have BA land the OQ-1 + SA-6 corrections **first, on their own**, before either branch touches the file.

---

### 6. Optimisation suggestions (non-blocking)

- Consider whether the outer `ORDER BY` needs to place `total` first at all. B1 receives ≤ 103 rows and will partition them by `row_kind` in TypeScript regardless; dropping the cross-kind ordering removes one `CASE` from an already intricate single-expression function. Order *within* the group rows still has to be total and stable (your decision 7 is right about that).
- The conditional `audit_trail` partial index is well reasoned. At 56 `ai_action` rows it will not register in step 3's measurement even if the probe shape is wrong at scale; note that explicitly, so a "no material share" reading at today's volume is not later cited as evidence the index is never needed.
- `COMMENT ON FUNCTION` is the one artefact an operator reads in the dashboard without opening the repo. Put the row-kind partition (B-2), the bucket-filter rule (§OQ minor item) and the `(session_id, user_id)` reason in it, not only in the file header.

---

### Approval

- [x] **Approved to proceed, conditional on B-1, B-2, B-3 and B-8 being resolved in this document before any SQL is written**, and on the six corrections' rulings being applied. B-4 to B-7 and B-9, B-10 should be written into the plan in the same pass; B-11 to B-14 are notes for implementation.
- [x] **All six corrections upheld** — correction 3 with its evidence downgraded from fact to reasoning (enumerate, do not assert), correction 6 escalated to a hard gate on T3.
- [x] **OQ-1** → doc correction, BA amends `:254` and `:560` to cite `bosRowFilter()`; **the requirement's SA-6 bullet 1 is corrected too**, since my own claim there was wrong.
- [x] **OQ-2** → live probe **accepted** in place of seeded fixtures, under three conditions. Local Postgres rejected.
- [x] **OQ-3** → repository method **stays in B0**, conditional on B1 being the immediately next slice.
- [x] The contract-pin fix belongs in B0, as its **own first commit**. The Jest-in-CI gap is **out of scope** and must be **recorded as its own item**.
- [ ] Re-submit the amended document for a one-pass SA confirmation before T3. No second full review.

---

## QA Testing Report

*(QA populates this section.)*

---

## Commit Info

*(RM populates this section.)*

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-09-26 | V-3 corrected by live check | The live `pg_indexes` (admin slice 4, L-3) shows `idx_token_usage_created_at` and `idx_token_usage_feature (feature, created_at DESC)` exist in production, created outside the repo, exactly the case SA Correction 3 warned about. V-3's "no index on `created_at`" is superseded; the index proposal needs re-planning against the live list before any migration |
| 2026-09-24 | SA review | **Approve with changes.** All six corrections upheld (3 downgraded to reasoning — enumerate `pg_indexes`, do not assert a count; 6 escalated to a hard gate on T3). OQ-1 = doc correction citing `bosRowFilter()`, and the requirement's SA-6 bullet 1 is corrected too (SA's CI claim was wrong — the contract test is verified RED on `main`, 1 failed / 4 passed). OQ-2 = live probe **accepted** over seeded fixtures under three conditions; local Postgres rejected. OQ-3 = repository method **stays in B0**, conditional on B1 being next. Fourteen findings; four are blocking before SQL is written: **B-1** T-3 self-disarms if the entitlements `$$`-body stripper is reused, **B-2** the four `row_kind`s overlap on a platform row with a NULL `session_id`, **B-3** `total_groups` is computed over a different predicate set than the rows it counts (reproduces the F-5 dishonest count), **B-8** `service_role`'s EXECUTE rests on Supabase default privileges not on the REVOKE, so P3 is blocking and its remedy is a `GRANT` in the file. Cross-plan with the F-13 fix: the `(session_id, user_id)` key holds across the cut-over, no-backfill confirmed permanent (`audit_trail.hash`), and L-1's window must be pinned to a pre-cut-over range |
| 2026-09-24 | Created | Slice B0 planned against `main` @ `52b43e6a`. 17-point verification log; six findings that change the plan — no index on `created_at` at all (V-3), the requirement's feature predicate misses every legacy Business OS row (V-6), the audit join needs a `uuid → text` cast (V-7), the `TokenUsageRepository` contract pin is **red on `main`** and is run by no CI job (V-8), the new column allow-list belongs to B2 not B0 (V-9), and `token_usage`'s DDL is not in the repo so its types must be read live (V-16). Proposes `business_os_ai_activity(…11 args…)`, INVOKER + REVOKE, cap inside the function, `GROUP BY (user_id, session_id)`, four `row_kind`s, and a `CONCURRENTLY`-built four-column index in its own file; measurement plan, hand-apply procedure with pre/post-check and an overload-safe rollback, 12 Jest guards + 6 live read-only checks, and three open questions |
