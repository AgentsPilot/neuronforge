# Workplan: AI Model Price Review, Slice 2 (capture, baseline, exact prices, active-row uniqueness, new columns, image table, retire duplicates)

> **Last Updated**: 2026-10-12

**Developer:** Dev
**Requirement:** [AI_MODEL_PRICE_REVIEW_REQUIREMENT.md](/docs/requirements/AI_MODEL_PRICE_REVIEW_REQUIREMENT.md) (SA Requirement Review 2026-10-08: findings 1, 3, 4, 8; R-1, R-2 storage pattern; R-8 row 2; MP-NFR-3, MP-NFR-5, MP-FR-16)
**Branch:** `feature/ai-model-price-review-slice2` (local worktree `neuronforge-model-pricing-s2`, cut from `fix/ai-model-price-review-slice1` / PR #281, not pushed)
**Date:** 2026-10-10
**Status:** COMPLETE: merged 2026-10-11 (PR #304, commit 856455c4, merge 7cf7974a) and applied to production 2026-10-11, checker VERDICT PASS (see [Production apply record](#production-apply-record))

## Overview

Slice 2 is the schema groundwork for reviewed prices. It captures the live definition of `ai_model_pricing` (created outside migrations, AB-9), commits it as a no-op baseline, then changes it: both cost columns become unconstrained `numeric`, the unique constraint `(provider, model_name, effective_date)` becomes a partial unique index on active rows, and three nullable columns are added (`cached_input_cost_per_token`, `proposal_id`, `proposal_line_id`). An empty `ai_model_image_pricing` table is created. Duplicate history rows are retired (never deleted), and alias rows are retired only after a 90-day usage check. SA placed all of this in slice 2 (R-8 row 2). **Readers are unchanged and no charge changes**: the proof is a price fingerprint taken before and after every step.

## Table of Contents

1. [Analysis](#1-analysis)
2. [Step 1: user runs these (read-only)](#2-step-1-user-runs-these-read-only)
3. [Baseline migration](#3-baseline-migration)
4. [Schema change migration](#4-schema-change-migration)
5. [Retiring duplicate and alias rows](#5-retiring-duplicate-and-alias-rows)
6. [Code changes](#6-code-changes)
7. [Tests](#7-tests)
8. [Order of operations on production](#8-order-of-operations-on-production)
9. [Risks and rollback](#9-risks-and-rollback)
10. [Open questions for SA](#10-open-questions-for-sa)
11. [Task list](#11-task-list)
12. [SA Review Notes](#sa-review-notes) · [QA Testing Report](#qa-testing-report) · [Production apply record](#production-apply-record) · [Commit Info](#commit-info) · [Change History](#change-history)

---

## 1. Analysis

### 1.1 Measured on 2026-10-10

Live, by zero-row selects (`business-os-schema-check` procedure, read-only, worktree HEAD `236ad66e`):

| Claim | Result |
|---|---|
| `ai_model_pricing` has `id, provider, model_name, input_cost_per_token, output_cost_per_token, effective_date, retired_date, created_at` | OK |
| `ai_model_pricing.cached_input_cost_per_token`, `.proposal_id`, `.updated_at` | 42703, absent |
| `ai_model_image_pricing`, `ai_price_proposals` | 42P01, absent |
| `token_usage` has `id, user_id, provider, model_name, created_at, feature, input_tokens, output_tokens, cost_usd` | OK. **`token_usage` is the table that records which model a call used** |
| `business_os_credit_charges.model` / `.model_name` | 42703. The credit ledger does not record the model, so it cannot be the 90-day check |

### 1.2 Who reads or writes the table

| Path | Access | Effect of slice 2 |
|---|---|---|
| `lib/ai/pricing.ts` via `listActive()` | `select('*')`, `retired_date IS NULL`, `effective_date <= today`, order `effective_date DESC, created_at DESC`, first row per `provider:model` wins; reads only 4 fields through `Number()`; 1-hour cache per instance | Unchanged. New columns are ignored. Retired duplicates were never winners |
| `lib/ai/pricing.ts` `listPricedModels()` (Layer 2 model picker, via the pricing cache) | reads the same active rows as `listActive()` | The retired aliases leave the picker. No effect: they are Anthropic and every BOS policy is OpenAI-only (SA-6) |
| Admin `pricing/route.ts` (GET `listAll`, PUT, POST, DELETE) and `pricing/sync/route.ts` (`syncMany`) | service role | Unchanged. After the change a Sync or edit stores the exact value it sends (MP-FR-16, intended). Retired in slice 8. **`listAll()` has no `retired_date` filter and the admin page shows no retired marker, so the page still lists all 54 rows after the retire** (QA edge case 6); the retire is confirmed by the script output and checker V-4, not by the page. Follow-up recorded in the requirement (slice 4) |
| `app/api/admin/agent-generation-config/route.ts:52` | direct select of non-retired rows (legacy, pre-existing rule-1 breach, out of scope) | Retired aliases disappear from that legacy model list |
| `scripts/analyze-pricing-discrepancies.ts`, `scripts/calculate-gpt4o-cost.ts` | operator scripts | Unchanged |
| `20260213_add_claude_46_pricing.sql`, `SQL Scripts/20251030_add_missing_models_pricing.sql` | `ON CONFLICT (provider, model_name, effective_date)` | After the constraint is dropped, a re-run fails with 42P10 and writes nothing. 20260213 is immutable history; 20251030 is deleted in slice 10 (R-1) |

`console.*`: 0 in `lib/ai/pricing.ts` and `AiModelPricingRepository.ts`.

### 1.3 Skills and rules applied

- `business-os-schema-check`: section 1.1; the capture in section 2 is the authority for types and names.
- R-2 storage pattern (`20261017_business_os_credit_lots.sql` and its test): `REVOKE ALL` per role, RLS on, admin SELECT via `is_platform_admin()`, migration source test pinning grants. **Slice 2 creates no function**, so the service-role-only `EXECUTE` rule first applies in slice 3. The test asserts no `CREATE FUNCTION`.
- Repo migration conventions (`20261039`, `20261044`, credit lots): one `BEGIN … COMMIT` with `SET LOCAL lock_timeout = '5s'`, plain `CREATE` (a second paste fails and changes nothing), no `--` or `/*` comments in pasted files, string literals limited to letters, digits, underscores and spaces, rollback in `supabase/SQL Scripts/<name>_rollback.sql`, checker in `scripts/check-*.sql`, read-only scripts open with `SET default_transaction_read_only = on;`.
- `tenant-isolation-guard`: not applicable. The table has no owner column, and no caller-supplied id is acted on.
- `business-os-entitlements`, `bos-llm-call-standards`, `durable-queue-drain`: not applicable.

---

## 2. Step 1: user runs these (read-only)

> **As run (2026-10-10).** C-2 and P-1 were pulled by the agent with read-only PostgREST GETs (service role, no write, no RPC) and replaced the user-run versions; the result is [the capture](/docs/workplans/AI_MODEL_PRICE_REVIEW_SLICE2_CAPTURE_2026-10-10.md). The user ran C-1 in the SQL editor. **C-3 is no longer run up front**: the user decided the fingerprint is taken just before the retire, and the retire script computes it inside its own transaction before and after the update and prints it after `COMMIT` (that printed value is F0 for the checker's V-4). C-3 below is kept as the definition of the fingerprint.

**User runs C-1, C-2, C-3 and P-1 in the Supabase SQL editor, each in its own run, and pastes back all four result grids at once** (SA-1). Each block is one self-contained `SELECT` / `WITH` statement: nothing is written, no session setting is changed, and the blocks hold no backslash, no non-ASCII character and no word "into". Dev transcribes the four grids to section 2.1 before writing any SQL file. Then the user approves the retire list in writing (section 8 step 3), and only then does Dev write the retire script.

| Query | What the user pastes back |
|---|---|
| C-1 | The whole grid, about 60 to 120 rows of `ord, section, name, detail` |
| C-2 | The whole grid, one row per model with an active price row: `provider, model_name, calls_last_90_days, last_call, oldest_row` |
| C-3 | The single row: `priced_models, price_fingerprint` (this is F0) |
| P-1 | The whole grid: every row of a model with more than one active row, plus the three alias rows, each with its `action` and `tie_stop_and_ask_sa` |

**C-1: definition, security, data shape and precision proof**

```sql
WITH target AS (
  SELECT pg_class.oid AS table_oid, pg_class.relrowsecurity AS rls_on, pg_class.relforcerowsecurity AS rls_forced,
         pg_get_userbyid(pg_class.relowner) AS owner_name,
         COALESCE(pg_class.relacl, acldefault('r', pg_class.relowner)) AS table_acl
  FROM pg_class JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
  WHERE pg_namespace.nspname = 'public' AND pg_class.relname = 'ai_model_pricing' AND pg_class.relkind = 'r'
)
SELECT 1 AS ord, 'table' AS section, 'ai_model_pricing' AS name,
       concat_ws(' ', 'owner', target.owner_name, 'rls_on', target.rls_on::text, 'rls_forced', target.rls_forced::text, 'comment', obj_description(target.table_oid, 'pg_class')) AS detail
FROM target
UNION ALL
SELECT 2, 'column', pg_attribute.attname::text,
       concat_ws(' ', 'position', pg_attribute.attnum::text, 'type', format_type(pg_attribute.atttypid, pg_attribute.atttypmod),
                 'precision', coalesce(columns.numeric_precision::text, 'none'), 'scale', coalesce(columns.numeric_scale::text, 'none'),
                 'not_null', pg_attribute.attnotnull::text, 'default', coalesce(pg_get_expr(pg_attrdef.adbin, pg_attrdef.adrelid), 'none'))
FROM target
JOIN pg_attribute ON pg_attribute.attrelid = target.table_oid AND pg_attribute.attnum > 0 AND NOT pg_attribute.attisdropped
LEFT JOIN pg_attrdef ON pg_attrdef.adrelid = target.table_oid AND pg_attrdef.adnum = pg_attribute.attnum
LEFT JOIN information_schema.columns AS columns
  ON columns.table_schema = 'public' AND columns.table_name = 'ai_model_pricing' AND columns.column_name = pg_attribute.attname
UNION ALL
SELECT 3, 'constraint', pg_constraint.conname::text, concat_ws(' ', 'type', pg_constraint.contype::text, pg_get_constraintdef(pg_constraint.oid))
FROM target JOIN pg_constraint ON pg_constraint.conrelid = target.table_oid
UNION ALL
SELECT 4, 'index', indexes.indexname::text, indexes.indexdef
FROM pg_indexes AS indexes WHERE indexes.schemaname = 'public' AND indexes.tablename = 'ai_model_pricing'
UNION ALL
SELECT 5, 'referenced_by', pg_constraint.conname::text, concat_ws(' ', pg_constraint.conrelid::regclass::text, pg_get_constraintdef(pg_constraint.oid))
FROM target JOIN pg_constraint ON pg_constraint.confrelid = target.table_oid
UNION ALL
SELECT 6, 'policy', policies.policyname::text,
       concat_ws(' ', 'cmd', policies.cmd, 'roles', policies.roles::text, 'permissive', policies.permissive, 'using', policies.qual, 'check', policies.with_check)
FROM pg_policies AS policies WHERE policies.schemaname = 'public' AND policies.tablename = 'ai_model_pricing'
UNION ALL
SELECT 7, 'table_grant', CASE WHEN acl_item.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl_item.grantee)::text END,
       concat_ws(' ', acl_item.privilege_type, 'grantable', acl_item.is_grantable::text)
FROM target CROSS JOIN LATERAL aclexplode(target.table_acl) AS acl_item
UNION ALL
SELECT 8, 'column_grant', concat_ws(' ', pg_attribute.attname::text, CASE WHEN acl_item.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(acl_item.grantee)::text END),
       acl_item.privilege_type
FROM target
JOIN pg_attribute ON pg_attribute.attrelid = target.table_oid AND pg_attribute.attnum > 0 AND pg_attribute.attacl IS NOT NULL
CROSS JOIN LATERAL aclexplode(pg_attribute.attacl) AS acl_item
UNION ALL
SELECT 9, 'trigger', pg_trigger.tgname::text, pg_get_triggerdef(pg_trigger.oid)
FROM target JOIN pg_trigger ON pg_trigger.tgrelid = target.table_oid AND NOT pg_trigger.tgisinternal
UNION ALL
SELECT DISTINCT 10, 'dependent_view', view_class.oid::regclass::text, view_class.relkind::text
FROM target
JOIN pg_depend ON pg_depend.refobjid = target.table_oid AND pg_depend.classid = 'pg_rewrite'::regclass
JOIN pg_rewrite ON pg_rewrite.oid = pg_depend.objid
JOIN pg_class AS view_class ON view_class.oid = pg_rewrite.ev_class AND view_class.oid <> target.table_oid
UNION ALL
SELECT 11, 'function_mentions', pg_proc.oid::regprocedure::text, 'body names the table'
FROM pg_proc JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
WHERE pg_namespace.nspname = 'public' AND pg_proc.prosrc ILIKE '%ai_model_pricing%'
UNION ALL
SELECT 12, 'row_count', 'all',
       concat_ws(' ', 'total', count(*)::text, 'active', (count(*) FILTER (WHERE pricing.retired_date IS NULL))::text,
                 'retired', (count(*) FILTER (WHERE pricing.retired_date IS NOT NULL))::text,
                 'active_future_dated', (count(*) FILTER (WHERE pricing.retired_date IS NULL AND pricing.effective_date > (now() AT TIME ZONE 'utc')::date))::text)
FROM public.ai_model_pricing AS pricing
UNION ALL
SELECT 13, 'model', concat_ws(' ', pricing.provider, pricing.model_name),
       concat_ws(' ', 'active', (count(*) FILTER (WHERE pricing.retired_date IS NULL))::text,
                 'retired', (count(*) FILTER (WHERE pricing.retired_date IS NOT NULL))::text, 'newest_effective', max(pricing.effective_date)::text)
FROM public.ai_model_pricing AS pricing GROUP BY pricing.provider, pricing.model_name
UNION ALL
SELECT 14, 'precision', concat_ws(' ', pricing.provider, pricing.model_name, pricing.effective_date::text),
       concat_ws(' ', 'input', pricing.input_cost_per_token::text, 'output', pricing.output_cost_per_token::text,
                 'input_per_1m', (pricing.input_cost_per_token * 1000000)::text, 'output_per_1m', (pricing.output_cost_per_token * 1000000)::text,
                 'retired', coalesce(pricing.retired_date::text, 'no'))
FROM public.ai_model_pricing AS pricing
WHERE pricing.model_name ILIKE '%gemini%' OR pricing.input_cost_per_token < 0.0000001 OR pricing.output_cost_per_token < 0.0000001
ORDER BY ord, name;
```

**Reading the precision proof (finding 1, AB-10).** Section `column` gives `format_type` for both cost columns. Section `precision` shows each sub-$0.10-per-1M row as stored text. If gemini-1.5-flash input reads `0.00000008` and the type is `numeric(p,8)`, AB-10 is **real storage rounding**. If it reads `0.000000075` (or the type is unconstrained), it was **display only** and slice 1 already fixed it. If the type is `real` / `double precision`, branch F in section 4.1 applies.

**C-2: 90-day usage of every model with an active row** (SA-3; `token_usage.provider`, `model_name`, `created_at`, verified in 1.1). Joined on **both** `provider` and `model_name`, because the price key is `provider:model`. `calls_last_90_days` decides the alias retirement in one run; `last_call` is the latest call ever recorded (empty means never); `oldest_row` proves the table covers 90 days at all. The same grid is slice 9's coverage evidence.

```sql
WITH active_model AS (
  SELECT DISTINCT pricing.provider, pricing.model_name
  FROM public.ai_model_pricing AS pricing
  WHERE pricing.retired_date IS NULL
),
model_usage AS (
  SELECT usage_row.provider, usage_row.model_name,
         count(*) FILTER (WHERE usage_row.created_at >= now() - interval '90 days') AS recent_calls,
         max(usage_row.created_at) AS last_call
  FROM public.token_usage AS usage_row
  GROUP BY usage_row.provider, usage_row.model_name
)
SELECT active_model.provider, active_model.model_name,
       coalesce(model_usage.recent_calls, 0) AS calls_last_90_days,
       model_usage.last_call,
       (SELECT min(oldest.created_at) FROM public.token_usage AS oldest) AS oldest_row
FROM active_model
LEFT JOIN model_usage
  ON model_usage.provider = active_model.provider AND model_usage.model_name = active_model.model_name
ORDER BY calls_last_90_days, active_model.provider, active_model.model_name;
```

The alias names in C-3 and P-1 stay as they are. A new `NOT IN` list is made only if C-2 reveals another zero-call alias (a model no code path calls); that is settled with SA before the retire script is written.

**C-3: price fingerprint F0.** The prices `listActive()` would charge for every model except the aliases, as one hash. Rounded to 18 decimals so the hash compares values, not text formats (branch F).

```sql
SELECT count(*) AS priced_models,
       md5(string_agg(concat_ws(' ', ranked.provider, ranked.model_name, round(ranked.input_cost_per_token::numeric, 18)::text,
                                round(ranked.output_cost_per_token::numeric, 18)::text), ' ' ORDER BY ranked.provider, ranked.model_name)) AS price_fingerprint
FROM (
  SELECT pricing.provider, pricing.model_name, pricing.input_cost_per_token, pricing.output_cost_per_token,
         row_number() OVER (PARTITION BY pricing.provider, pricing.model_name ORDER BY pricing.effective_date DESC, pricing.created_at DESC) AS position
  FROM public.ai_model_pricing AS pricing
  WHERE pricing.retired_date IS NULL AND pricing.effective_date <= (now() AT TIME ZONE 'utc')::date
    AND pricing.model_name NOT IN ('claude-3-haiku', 'claude-3-opus', 'claude-3-sonnet')
) AS ranked
WHERE ranked.position = 1;
```

**P-1: retire preview** (which rows would be retired, each labelled). Moved here from section 5 (SA-1) so the retire list is known and approved before the retire script is written.

```sql
WITH ranked AS (
  SELECT pricing.id, pricing.provider, pricing.model_name, pricing.effective_date, pricing.created_at,
         pricing.input_cost_per_token::text AS input_text, pricing.output_cost_per_token::text AS output_text,
         pricing.effective_date > (now() AT TIME ZONE 'utc')::date AS is_future,
         row_number() OVER (PARTITION BY pricing.provider, pricing.model_name, pricing.effective_date > (now() AT TIME ZONE 'utc')::date
                            ORDER BY pricing.effective_date DESC, pricing.created_at DESC) AS position,
         count(*) OVER (PARTITION BY pricing.provider, pricing.model_name) AS active_rows,
         count(*) OVER (PARTITION BY pricing.provider, pricing.model_name, pricing.effective_date, pricing.created_at) AS same_instant
  FROM public.ai_model_pricing AS pricing
  WHERE pricing.retired_date IS NULL
)
SELECT ranked.id, ranked.provider, ranked.model_name, ranked.effective_date, ranked.created_at, ranked.input_text, ranked.output_text,
       CASE WHEN ranked.model_name IN ('claude-3-haiku', 'claude-3-opus', 'claude-3-sonnet') THEN 'retire alias if zero calls in C2'
            WHEN ranked.is_future THEN 'future price not touched'
            WHEN ranked.position = 1 THEN 'keep charged price'
            ELSE 'retire duplicate' END AS action,
       ranked.same_instant > 1 AS tie_stop_and_ask_sa
FROM ranked
WHERE ranked.active_rows > 1 OR ranked.model_name IN ('claude-3-haiku', 'claude-3-opus', 'claude-3-sonnet')
ORDER BY ranked.provider, ranked.model_name, ranked.effective_date DESC, ranked.created_at DESC;
```

"Keep" is exactly the row `listActive()` charges today (same filter, same order). Any `tie_stop_and_ask_sa = true` means two rows share date and `created_at`, so PostgREST's pick is not determined: Dev stops and asks SA before writing the retire script.

### 2.1 Captured result

Recorded in [AI_MODEL_PRICE_REVIEW_SLICE2_CAPTURE_2026-10-10.md](/docs/workplans/AI_MODEL_PRICE_REVIEW_SLICE2_CAPTURE_2026-10-10.md): C-2 and P-1 (agent, read-only PostgREST, 2026-10-10T18:53:58Z), C-1 and the view definition (user, SQL editor), and the user's written approval of the 12-row retire list.

| Settled | Value |
|---|---|
| Branch | **N**: both cost columns are `numeric(10,8)`; gemini-1.5-flash input is stored `0.00000008`, so AB-10 is real storage rounding |
| Old unique constraint | `ai_model_pricing_provider_model_name_effective_date_key` (a constraint, not a bare index) |
| Primary key | `ai_model_pricing_pkey` |
| Policies | `ai_model_pricing_admin_select`, `ai_model_pricing_admin_write` |
| Grants | anon SELECT; authenticated SELECT; service_role SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER; MAINTAIN on anon and authenticated is the Supabase default (SA note below, not changed in slice 2) |
| Referenced by, triggers, functions | None |
| **Dependent view** | `public.pilot_cost_savings_summary` reads both cost columns. Postgres refuses `ALTER COLUMN ... TYPE` while a view uses the column. Handled in section 4.6 (deviation D-1) |
| Retire list | 12 rows: 9 duplicates and 3 aliases with zero calls ever. Approved in writing by the user 2026-10-10 |
| Ties, future-dated rows, a kept row that differs from the charged row | None |

---

## 3. Baseline migration

**SA ruling O-1: a committed, guarded no-op with the full captured definition, security and table comment included, dated now:** `supabase/migrations/20261052_ai_model_pricing_baseline.sql` (N1 = `20261052`; RM re-confirms at commit). Back-dating is rejected: it would misstate history and would not replay, since the captured policies call `is_platform_admin()`, which `20260920a` creates later.

```sql
BEGIN;
DO $baseline$
BEGIN
  IF to_regclass('public.ai_model_pricing') IS NULL THEN
    CREATE TABLE public.ai_model_pricing ( CAPTURED columns, types, defaults, NOT NULL, in position order,
      CONSTRAINT CAPTURED_PK_NAME PRIMARY KEY (id),
      CONSTRAINT CAPTURED_UNIQUE_NAME UNIQUE (provider, model_name, effective_date) );
    CAPTURED non-constraint indexes, verbatim indexdef;
    COMMENT ON TABLE public.ai_model_pricing IS CAPTURED_TABLE_COMMENT;
    ALTER TABLE public.ai_model_pricing ENABLE ROW LEVEL SECURITY;
    CAPTURED policies, verbatim; CAPTURED table and column grants and revokes, verbatim;
  END IF;
END
$baseline$;
COMMIT;
```

Why (c), the guard, over the alternatives: (a) documentation only can never be executed, so never proven, and repo convention forbids comments in pasted SQL; (b) `CREATE TABLE IF NOT EXISTS` plus separate `CREATE INDEX IF NOT EXISTS` / `GRANT` lines is not a true no-op, since a `GRANT` always runs and a mistranscribed index name would be **created**. With (c) the body never executes on prod, whatever a transcription error, and on an empty database it builds the complete live definition, security included: R-1's `IF NOT EXISTS` intent, made total.

The user may run it once on prod (expected: `Success. No rows returned`, nothing changes; C-1 re-run is identical). The Jest test pins the guard shape, and pins the captured names and types as constants in the test itself (it does not parse this MD; O-1, SA-4c).

---

## 4. Schema change migration

`supabase/migrations/20261053_ai_model_pricing_exact_prices_and_image_table.sql` (N2 = `20261053`; RM re-confirms at commit), one transaction. Rollback: `supabase/SQL Scripts/20261053_ai_model_pricing_exact_prices_and_image_table_rollback.sql`. Checker: `scripts/check-ai-model-pricing-slice2-migration.sql`.

### 4.1 Unconstrained numeric (R-1 precision)

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE public.ai_model_pricing
  ALTER COLUMN input_cost_per_token TYPE numeric,
  ALTER COLUMN output_cost_per_token TYPE numeric;
```

| Captured type | What the ALTER does |
|---|---|
| **N** `numeric(p,s)` (expected) | Relaxing a typmod to unconstrained `numeric` is binary-compatible: no table rewrite, no value change. Stored values keep their digits and their text form, so `listActive()` returns byte-identical JSON |
| **F** `real` / `double precision` | Needs `USING input_cost_per_token::numeric` (likewise output). It rewrites 54 rows; values convert at 15 significant digits, so `7.5e-8` becomes `0.000000075`. Text form changes, value does not (fingerprint compares rounded values) |
| **U** already unconstrained `numeric` | The ALTER is dropped from the file; AB-10 was display only (finding 1) |

**Locks.** `ALTER COLUMN TYPE` takes an ACCESS EXCLUSIVE lock for milliseconds on a 54-row table. `lock_timeout = '5s'` makes the migration abort (changing nothing) rather than queue behind a long transaction. A pricing read on a cache miss can wait at most those 5 s; `pricing.ts` never throws on a failed read (it keeps its cache or falls back).
**Cache.** Values are identical before and after, so stale 1-hour caches hold the same prices. No refresh is needed.
**Not done here.** A value already rounded in storage **stays rounded**. Slice 2 changes no stored price (zero charge change; Q8: going forward only). It is corrected by the first real proposal (slice 9) or by a Sync/edit before then. The BOS-live models in the table (`gpt-4o-mini`, `gpt-4o`) are whole multiples of $0.01 per 1M, so 8 decimals hold them exactly anyway.

### 4.2 New nullable columns on the token table

```sql
ALTER TABLE public.ai_model_pricing ADD COLUMN cached_input_cost_per_token numeric;
ALTER TABLE public.ai_model_pricing ADD COLUMN proposal_id uuid;
ALTER TABLE public.ai_model_pricing ADD COLUMN proposal_line_id uuid;
ALTER TABLE public.ai_model_pricing ADD CONSTRAINT ai_model_pricing_cached_input_valid
  CHECK (cached_input_cost_per_token IS NULL OR (cached_input_cost_per_token >= 0 AND cached_input_cost_per_token <> 'NaN' AND cached_input_cost_per_token <> 'Infinity'));
ALTER TABLE public.ai_model_pricing ADD CONSTRAINT ai_model_pricing_provenance_paired
  CHECK ((proposal_id IS NULL) = (proposal_line_id IS NULL));
```

No default, so each `ADD COLUMN` is catalogue-only. All rows are NULL, so both CHECKs hold. No foreign key yet: the proposal tables arrive in slice 3, which adds the FKs as a plain `ADD CONSTRAINT … FOREIGN KEY` with `lock_timeout` (ruling O-6: every value is NULL, so `NOT VALID` then `VALIDATE` buys nothing).

### 4.3 Partial unique index replaces the constraint (finding 8)

```sql
CREATE UNIQUE INDEX ai_model_pricing_active_model_date_key
  ON public.ai_model_pricing (provider, model_name, effective_date) WHERE retired_date IS NULL;
ALTER TABLE public.ai_model_pricing DROP CONSTRAINT CAPTURED_UNIQUE_NAME;
```

**Why this cannot fail on duplicates, so retire-first is not required.** The old constraint covers every row, so the active rows are already unique on these columns; a subset of a unique set is unique. The index is created **before** the drop, so uniqueness never lapses. `DROP CONSTRAINT` names the captured name with no `IF EXISTS`, so a wrong name aborts the whole transaction. If C-1 shows the uniqueness is a unique **index** (not a constraint) the line becomes `DROP INDEX public.CAPTURED_NAME`. If section `referenced_by` lists a foreign key on these columns, stop and re-plan with SA. Retirement (section 5) still runs first for clean data, but nothing depends on it.

The index allows two active rows of one model on **different** dates (a scheduled future price); `listActive()` already handles that with `effective_date <= today` and newest-wins.

### 4.4 Empty image price table (R-1, R-2 pattern)

```sql
CREATE TABLE public.ai_model_image_pricing (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  model_name text NOT NULL,
  size text NOT NULL,
  quality text NOT NULL,
  cost_per_image numeric NOT NULL,
  effective_date date NOT NULL,
  retired_date date,
  created_at timestamptz NOT NULL DEFAULT now(),
  proposal_id uuid,
  proposal_line_id uuid
);
ALTER TABLE public.ai_model_image_pricing ADD CONSTRAINT ai_model_image_pricing_cost_positive CHECK (cost_per_image > 0 AND cost_per_image <> 'NaN' AND cost_per_image <> 'Infinity');
ALTER TABLE public.ai_model_image_pricing ADD CONSTRAINT ai_model_image_pricing_provenance_paired CHECK ((proposal_id IS NULL) = (proposal_line_id IS NULL));
CREATE UNIQUE INDEX ai_model_image_pricing_active_key
  ON public.ai_model_image_pricing (provider, model_name, size, quality, effective_date) WHERE retired_date IS NULL;
COMMENT ON TABLE public.ai_model_image_pricing IS 'Price per generated image by provider model size and quality  Empty until the first approved price proposal  Written only by the service role  History is kept with retired_date and rows are never deleted';
ALTER TABLE public.ai_model_image_pricing ENABLE ROW LEVEL SECURITY;
CREATE POLICY ai_model_image_pricing_admin_select ON public.ai_model_image_pricing FOR SELECT TO authenticated USING ((SELECT public.is_platform_admin()));
REVOKE ALL ON TABLE public.ai_model_image_pricing FROM PUBLIC;
REVOKE ALL ON TABLE public.ai_model_image_pricing FROM anon;
REVOKE ALL ON TABLE public.ai_model_image_pricing FROM authenticated;
REVOKE ALL ON TABLE public.ai_model_image_pricing FROM service_role;
GRANT SELECT ON TABLE public.ai_model_image_pricing TO authenticated;
GRANT SELECT, INSERT, UPDATE (retired_date) ON TABLE public.ai_model_image_pricing TO service_role;
COMMIT;
```

No reader exists until slice 6, and an empty table falls back to the in-code image prices (R-8). No `DELETE`, `TRUNCATE`, `REFERENCES` or `TRIGGER` is granted to anyone (Q9: no hard delete). `UPDATE` is limited to `retired_date`. The `authenticated` SELECT is reachable only through the admin policy (O-2).

### 4.5 Rollback (`SQL Scripts/20261053_ai_model_pricing_exact_prices_and_image_table_rollback.sql`)

One transaction, guarded so it refuses rather than loses data:

1. `DO` block raises `slice two rollback refused` if `ai_model_image_pricing` has any row, if any `cached_input_cost_per_token` / `proposal_id` is non-NULL, or if any cost value differs from `round(value, CAPTURED_SCALE)` (a value only the new type can hold, for example from a Sync after apply).
2. `DROP TABLE public.ai_model_image_pricing;`
3. `ALTER TABLE public.ai_model_pricing ADD CONSTRAINT CAPTURED_UNIQUE_NAME UNIQUE (provider, model_name, effective_date);` then `DROP INDEX public.ai_model_pricing_active_model_date_key;`
4. Drop the two CHECKs and the three columns.
5. The view (4.6): the same guard, `DROP VIEW`, `ALTER COLUMN … TYPE numeric(10,8)` for both cost columns, then the identical recreate block. Going back to `numeric(10,8)` would round any value written with more than 8 decimals after apply; the guard in step 1 refuses instead (`value <> round(value, 8)`, and any `abs(value) >= 100`, which also covers large negatives and -Infinity). It also refuses when `(provider, model_name, effective_date)` repeats across all rows (SA optimisation), instead of an opaque 23505.

### 4.6 The dependent view `pilot_cost_savings_summary` (deviation D-1, needs the SA ruling)

C-1 found one view that reads both cost columns. It is legacy AgentsPilot reporting with no reference anywhere in the repo. It is **not dropped permanently**: inside the same transaction and under the same `lock_timeout`, the migration

1. runs a guard `DO $view_guard$` that refuses (and changes nothing) unless the view exists as a plain view, **no object depends on it** (any `pg_depend` row of type `n` on the view other than its own rewrite rule), its columns are exactly the captured eight in order, **no trigger is on the view, it has exactly one rewrite rule (its own), no comment is on the view or its columns** (CR-1: `DROP VIEW` without `CASCADE` still drops auto-dependents silently), and both cost columns are still `numeric(10,8)`. The rollback guard repeats the trigger and rewrite-rule refusals (not the comment one);
2. `DROP VIEW public.pilot_cost_savings_summary;` with no `CASCADE` and no `IF EXISTS`;
3. alters both cost columns (4.1);
4. recreates the view from the captured `pg_get_viewdef` text, with only the two table references schema-qualified (`public.ai_model_pricing`, `public.pilot_step_routing_history`). Column types are unchanged: `numeric(10,8) + numeric(10,8)` already yields unconstrained `numeric`;
5. recreates it **hardened** (user decision 2026-10-11, below): `CREATE VIEW ... WITH (security_invoker = true) AS ...`, `ALTER VIEW ... OWNER TO postgres;`, no comment, then `REVOKE ALL` from PUBLIC, anon, authenticated and service_role (a new view in `public` picks up Supabase default privileges), then `GRANT SELECT ON public.pilot_cost_savings_summary TO authenticated, service_role;`.

**Captured (user-run, 2026-10-10).** Owner `postgres`; reloptions none; comment none; grants `postgres=arwdDxtm/postgres, anon=arwdDxtm/postgres, authenticated=arwdDxtm/postgres, service_role=arwdDxtm/postgres`. A read-only anon HEAD probe showed the view answering anon with 200 (0 rows today).

**Deliberate hardening, user-approved 2026-10-11.** The view keeps the same definition and output columns but is not restored as it was: `security_invoker = true` (it respects the RLS of its base tables), anon loses all access, authenticated and service_role get SELECT only (the view is not updatable, so write grants meant nothing), owner stays `postgres`, no comment. The rollback recreates the same hardened view and does **not** restore anon access; it says so with a `RAISE NOTICE` (SQL comments are not allowed in pasted files). Checker V-5 verifies owner, `security_invoker`, and every privilege per role (MAINTAIN included).

**Behaviour note.** With `security_invoker`, a non-admin caller's `tier3_cost` subquery sees no `ai_model_pricing` rows under that table's admin-only RLS, so `tier3_cost` is NULL and the view returns no rows for them (`WHERE tier3_cost > 0`). Admins and service_role see what they saw before. Nothing in the repo reads the view. The base table `pilot_step_routing_history` answered anon with 206 and 21 rows; that is out of scope here and handled by a separate task.

The view's one literal `'gpt-4o'` breaks the "letters, digits, underscores and spaces" literal rule; it is kept byte for byte and is the test's named exception.

---

## 5. Retiring duplicate and alias rows

### 5.1 Preview P-1

P-1 is in section 2 (Step 1) and runs with C-1 to C-3, before any SQL file is written (SA-1). The user approves the retire list in writing; Dev then writes the retire script and its rollback, so both are in the diff that SA reviews, QA tests and the user sees. **Just before the retire runs, the user re-runs P-1** (section 8 step 7): its grid must equal the approved list. The script's row-count check is the backstop.

### 5.2 The retire script (written after the user's written approval of the P-1 list; run only with the user's explicit approval)

`supabase/SQL Scripts/20261010_ai_model_pricing_retire_duplicate_rows.sql`, with `20261010_ai_model_pricing_retire_duplicate_rows_rollback.sql` beside it (SA-2, ruling O-3), with explicit ids from P-1. It is not a migration: it holds production-only UUIDs, its count check raises by design on any other database (so it would break a replay of `migrations/`), and it is a one-off data fix, not schema. The migration test still reads it by path. It runs in the SQL editor, so the PostgREST update + `.or()` + `.select()` bug does not apply; it uses no `.or()` anyway.

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
DO $retire$
DECLARE
  v_before text;
  v_after text;
  v_retired integer;
BEGIN
  v_before := (FINGERPRINT_EXPRESSION);
  UPDATE public.ai_model_pricing AS pricing
  SET retired_date = (now() AT TIME ZONE 'utc')::date
  WHERE pricing.retired_date IS NULL
    AND pricing.id IN (DUPLICATE_IDS_FROM_P1, ALIAS_IDS_ONLY_IF_C2_ZERO);
  GET DIAGNOSTICS v_retired = ROW_COUNT;
  IF v_retired <> EXPECTED_COUNT THEN
    RAISE EXCEPTION 'retired row count is not the previewed count';
  END IF;
  v_after := (FINGERPRINT_EXPRESSION);
  IF v_after IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'a charged price would change';
  END IF;
END
$retire$;
COMMIT;
```

**As written.** The 12 approved ids are a `VALUES` list of full UUIDs, each bound to its approved provider and model, so a wrong id cannot match. The script also refuses unless each of the three duplicated models keeps exactly one active row, counted per model (`GROUP BY model_name HAVING count(*) = 1` must return 3 models, so a 2/1/0 split refuses). After `COMMIT` it prints the fingerprint, the active and the retired row counts: that fingerprint is F0 for check V-4. The rollback restores only those 12, only if all 12 were retired by one run (one shared `retired_date`), with the same count and fingerprint checks.

`FINGERPRINT_EXPRESSION` is C-3's `price_fingerprint` as a scalar subquery (aliases excluded), so the transaction **proves inside itself** that no charged price changed, and rolls back if one would. No `DELETE` anywhere. Aliases are included only where C-2 shows zero calls in 90 days **and** `oldest_row` is older than 90 days; any alias with calls stays active and is recorded here for a later review. Rollback file (`..._rollback.sql`, same folder): `UPDATE … SET retired_date = NULL WHERE id IN (same ids) AND retired_date = APPLY_DATE`.

---

## 6. Code changes

**None that change behaviour.** No repository method, type, route or reader changes in slice 2.

| File | Change |
|---|---|
| `lib/repositories/AiModelPricingRepository.ts` `:108-110`, `:145`, `:290-294` | Comment only: "unique constraint `(provider, model_name, effective_date)`" becomes "partial unique index on active rows (`retired_date IS NULL`)" |
| `lib/ai/pricing.ts` `:159` | Comment only, same correction |
| `app/api/admin/system-config/pricing/sync/route.ts` `:32-34` | Comment only, same correction: "the unique constraint is `(provider, model_name, effective_date)`" becomes the partial unique index on active rows (SA-6) |
| `lib/repositories/types.ts` `AiModelPricing` | **Not changed.** The new columns arrive through `select('*')` but no code reads them; slice 6 adds the fields with their reader. Changing the type now risks nothing but proves nothing |

`lib/ai/pricing.ts` behaviour is unchanged: the same `listActive()` filter and order, the same four fields through `Number()`, the same cache and fallback. Tests that pin the read: `lib/repositories/__tests__/AiModelPricingRepository.test.ts` (filters and order) and `lib/ai` suites. Both must stay green unedited.

---

## 7. Tests

New `supabase/migrations/__tests__/ai-model-pricing-slice2.migration.test.ts` (source test over SQL text; Jest cannot run Postgres and there is no branch database), covering the baseline, change migration, rollback, retire script, retire rollback and checker:

| Group | Assertions |
|---|---|
| Paste safety (all files) | no `--` or `/*`; no backslash; every literal matches letters, digits, underscores and spaces (UUID literals allowed in the two retire files only); no literal contains `into` (any case); no single-letter alias; one `BEGIN` and one `COMMIT`, `lock_timeout` on every write file |
| Baseline | exactly one `DO` guarded by `to_regclass('public.ai_model_pricing') IS NULL`; no statement outside the guard; the column list, types, table comment, constraint and index names equal the captured values, pinned as constants in the test (O-1, SA-4c; the test does not parse this MD) |
| Precision | both cost columns `TYPE numeric;` with no typmod; `cached_input_cost_per_token numeric` and `cost_per_image numeric NOT NULL` with no typmod; no `numeric(` in the change migration. Negative control: the typmod detector flags `numeric(10,8)` |
| Uniqueness | the partial index text exactly, created **before** `DROP CONSTRAINT CAPTURED_UNIQUE_NAME`; no `IF EXISTS` on the drop |
| Token table security unchanged | the change migration has no `GRANT`, `REVOKE`, `POLICY` or DML naming `public.ai_model_pricing`, matched on a word boundary so `ai_model_image_pricing` lines do not count (SA-4b) |
| Image table (R-2 pattern) | columns in order; RLS on; one admin SELECT policy with `(SELECT public.is_platform_admin())`; `REVOKE ALL` from each of PUBLIC, anon, authenticated, service_role on its own line; exactly two GRANTs, each after every REVOKE; no DELETE/TRUNCATE/REFERENCES/TRIGGER; nothing to anon or PUBLIC; no `CREATE FUNCTION` in slice 2 |
| Retire (read by path from `supabase/SQL Scripts/`, SA-2) | only `UPDATE … SET retired_date`; no `DELETE`; explicit id list; row-count check and fingerprint check both present |
| Rollback / checker | rollback guard present and restores `CAPTURED_UNIQUE_NAME`; checker names the same index, constraint and columns as the migration |

**$0.075 per 1M stored exactly.** Jest proves the declared type is unconstrained `numeric` (which stores any decimal value exactly). Production proves storage in check V-2 (section 8): `format_type` reads `numeric`, and `SELECT (0.075::numeric / 1000000) = 0.000000075, CAST(0.075 / 1000000 AS numeric(10,8))::text` returns `true` and `0.00000008`, which shows what the old type did and the new one does not. The end-to-end proof (submit `0.075`, store `0.075/1000000`) is R-1's test and belongs to slice 3's RPC.

**Commands** (worktree root, shared `node_modules`, no install):

```bash
npx jest supabase/migrations/__tests__/ai-model-pricing-slice2 --ci
npx jest lib/repositories/__tests__/AiModelPricingRepository.test.ts lib/ai app/api/admin/system-config app/admin/system-config --ci
npx jest lib/business-os/__tests__/businessOwnedTables.test.ts scripts/__tests__ app/__tests__/tailwind-css-escape.guard.test.ts --ci
npm run test:bos-entitlements
```

`test:bos-entitlements` runs all of `supabase/migrations/__tests__` and is a required check on main.

---

## 8. Order of operations on production

**U** = the user, in the Supabase SQL editor. **D** / **SA** / **QA** / **RM** = agents.

| # | Who | Step | Expected |
|---|---|---|---|
| 1 | U, D | C-1 by the user; C-2 and P-1 by the agent (read-only PostgREST); C-3 not run up front (done 2026-10-10) | Read-only; nothing changes |
| 2 | D | Transcribe them to section 2.1; settle branch N/F/U and the constraint name; present the P-1 retire list (aliases only where C-2 shows zero calls) | |
| 3 | U | **Approve the retire list in writing** (business decision) | |
| 4 | D | Write all files, including the retire script and its rollback with the approved ids, and the test | |
| 5 | SA, QA | Code review and test, then **the user sees the diff**; RM commits and opens the PR | |
| 6 | U | (Optional) run the baseline in a new tab | `Success. No rows returned`; re-running C-1 gives an identical grid |
| 7 | U | Re-run P-1 just before the retire | Same grid as the approved list; if not, stop and return to step 2 |
| 8 | U | Run the retire script in a new tab | Commits only if the count is 12, each duplicated model keeps one active row and the fingerprint is unchanged. Prints the fingerprint: record it as F0 |
| 9 | U | (Optional) re-run C-3 | Same `price_fingerprint` as F0 |
| 10 | U | Run the schema migration (section 4, with the view handling of 4.6) in a new tab | `COMMIT`; the view guard refuses if anything about the view differs from the capture |
| 11 | U | Run the checker `scripts/check-ai-model-pricing-slice2-migration.sql` | V-1: types `numeric`; partial index present; old constraint absent; three new columns NULL everywhere. V-2: precision probe as in section 7. V-3: image table present, empty, RLS on, grants exactly as 4.4. **V-4: the printed fingerprint must equal F0** (INFO row, the user compares exactly). **`V4 price rows` reads `active 42 retired 12`.** V-5: the view is back, hardened. If a write step fails with "read-only transaction", run `SET default_transaction_read_only = off;` on its own, then re-run (the checker's session `SET` can persist on a pooled editor connection) |
| 12 | U | Open `/admin/system-config`; send one Business OS chat message | Page loads with the same prices. **It still lists all 54 rows: the retired rows do not disappear** (`listAll()` has no `retired_date` filter); the retire is confirmed by step 8's output and V-4, not by the page. The message is charged as usual |
| 13 | D | Record steps 1 to 12 in this workplan and the requirement | |

Rollback order is the reverse: the schema rollback (4.5), then the retire rollback. Each is independent of the other.

Steps 6 to 12 were run on 2026-10-11 by TL through the Supabase connector, with the user's explicit go-ahead; results are in the [Production apply record](#production-apply-record).

---

## 9. Risks and rollback

| # | Risk | Mitigation |
|---|---|---|
| RK-1 | C-1 shows a dependent view, trigger, referencing FK or function that blocks `ALTER TYPE` or the constraint drop | C-1 found one dependent view and nothing else; handled by RK-10 and section 4.6 |
| RK-10 | The view `pilot_cost_savings_summary` is recreated wrongly (definition, owner, options, comment or grants), or something depends on it | The guard refuses before the drop if any object depends on the view or its columns differ; no `CASCADE`. The recreate is the captured text, pinned in the Jest test and identical in migration and rollback. Owner, options and grants are the user-approved hardened set (T-2b) and are checked by V-5. The view is legacy reporting with no code reference, so a wrong grant would affect no app path; the whole change is one transaction, so a failure leaves the old view in place |
| RK-11 | Hardening changes who can read the view: anon loses access, and non-admin signed-in users get no rows (security_invoker plus admin-only RLS on `ai_model_pricing`) | Deliberate, user-approved 2026-10-11. No repo code reads the view; the anon probe returned 0 rows today. The rollback keeps the hardening, so anon access is never restored by accident. If a legacy consumer is ever found, it must read as an admin or through the service role |
| RK-2 | Branch F (float columns) changes the JSON text form of prices | Values are equal (fingerprint rounds to 18 decimals); `pricing.ts` parses with `Number()` |
| RK-3 | Constraint name mistranscribed | `DROP CONSTRAINT` with no `IF EXISTS` aborts the whole transaction; nothing changes |
| RK-4 | Lock wait on a busy moment | `lock_timeout = '5s'` aborts cleanly; re-run later. Readers wait at most 5 s, and only on a cache miss |
| RK-5 | Retiring a row that is being charged | The retire transaction recomputes the fingerprint and rolls back on any difference |
| RK-6 | A retired alias is called later | Only retired with zero calls in 90 days (C-2); neither the code nor the Sync list names them. BOS calls are all `['openai']` and never reach these rows. A **non-BOS** call would be recorded at **$0**: `calculateCost` returns 0 and `FALLBACK_PRICING` holds only the dated `claude-3-*` names, so there is no in-code fallback price (SA-5). Accepted, because C-2 requires zero calls |
| RK-7 | Rounded stored values remain after slice 2 | Intended (Q8, zero charge change); corrected by slice 9 or a Sync. BOS-live models are unaffected (section 4.1) |
| RK-8 | A Sync or edit after apply stores an exact value (for example gemini-1.5-flash `0.000000075`) and changes that model's charge | Intended going forward (MP-FR-16). It also makes the schema rollback refuse, by design |
| RK-9 | Process: read-only `SET` persists in an editor tab; `ON CONFLICT` seeds fail (42P10, no write) if re-run; migration numbers may collide with another branch; shared `node_modules` and stash list | Write steps say "new tab"; 20251030 goes in slice 10; RM re-confirms N1 `20261052` and N2 `20261053` at commit (the retire script is in `SQL Scripts/` and takes no migration number); no install, no `git stash`, no `worktree remove --force` |

---

## 10. Open questions for SA

All six answered by SA on 2026-10-10 (rulings table in SA Review Notes) and applied: O-1 guarded `DO` with full definition and table comment, dated now (`20261052` after D-2; ruled as `20261050`); O-2 as drafted; O-3 `supabase/SQL Scripts/`; O-4 the three CHECKs confirmed, none on the existing cost columns; O-5 token-table service-role DELETE stays until slice 8; O-6 plain `ADD CONSTRAINT … FOREIGN KEY` in slice 3. The questions are kept below as asked.

- **O-1 Baseline form and filename.** Guarded `DO` with the full definition, security included (recommended, section 3), or the narrower `CREATE TABLE IF NOT EXISTS`? Filename dated now (recommended: a back-dated file would misstate history, and the repo cannot replay from empty today anyway) or back-dated before `20260213`?
- **O-2 Image table client access.** R-2 literally: REVOKE ALL, then `GRANT SELECT` to `authenticated` behind the admin policy (drafted, same as the token table). Or service-role only with no client grant and no policy (as `boost_packs` after `20261039`/`20261040`)?
- **O-3 Retire script location.** `supabase/migrations/` (recommended: the prod data change is in history and under the test) or `supabase/SQL Scripts/`?
- **O-4 CHECKs.** Confirm the three new CHECKs (cached input `>= 0`, not NaN; provenance paired; image cost `> 0`). Recommendation: no new CHECK on the existing cost columns in slice 2; R-4 refuses bad values at submission in slice 3.
- **O-5 service_role on the image table.** `SELECT, INSERT, UPDATE (retired_date)` and no DELETE. Should the token table's service-role DELETE go now, or with the DELETE route in slice 8 (recommended)?
- **O-6 Provenance FKs** to `ai_price_proposals` / `ai_price_proposal_lines` added in slice 3 (`NOT VALID`, then `VALIDATE`). Confirm.

---

## 11. Task list

- [x] ✅ T-0: SA approves this workplan; `git branch --show-current` = `feature/ai-model-price-review-slice2`
- [x] ✅ T-1: C-1 (user), C-2 and P-1 (agent, read-only PostgREST) captured; C-3 dropped from the up-front run (fingerprint taken by the retire script); branch N and the `CAPTURED_*` table names settled (section 2.1)
- [x] ✅ T-1a: User approved the 12-row retire list in writing (2026-10-10)
- [x] ✅ T-2: Baseline migration `20261052` (section 3)
- [x] ✅ T-2b: View placeholders filled 2026-10-11 with the user-approved hardened set (section 4.6): `security_invoker = true`, owner `postgres`, no comment, SELECT to authenticated and service_role only, nothing to anon. The Jest group now asserts the hardened values
- [x] ✅ T-3: Schema migration `20261053` with the view handling (4.6), rollback, checker (section 4)
- [x] ✅ T-4: Retire script and its rollback in `supabase/SQL Scripts/`, with the 12 approved ids (section 5.2)
- [x] ✅ T-5: Comment-only edits, including `pricing/sync/route.ts:32-34` (section 6)
- [x] ✅ T-6: Migration test (section 7); section 7 commands run; `git diff --stat` (no deletion without insertion)
- [ ] T-7: Requirement status and Change History done; hand to SA for code review with the deviations below. Leave everything uncommitted
- [ ] T-8: After merge: user steps 6 to 12 (section 8), including the P-1 re-run before the retire, recorded here

### 11.1 Deviations from the approved workplan (SA rules at code review)

| # | Deviation | Why |
|---|---|---|
| D-1 | The schema migration drops and recreates `public.pilot_cost_savings_summary` around the ALTER TYPE, **hardened** (section 4.6): `security_invoker = true`, anon loses all access, SELECT only for authenticated and service_role, owner postgres, no comment. The rollback keeps the hardening | C-1 found the view; Postgres refuses the ALTER otherwise. Not dropped permanently; guarded; no `CASCADE`. The hardening is a deliberate change, approved by the user 2026-10-11: prod granted ALL to anon on a view over billing data |
| D-2 | Migration numbers are `20261052` (baseline) and `20261053` (schema) | First ruled `20261050` / `20261051`; `20261050` and then `20261051` were taken on origin/main by the SECURITY DEFINER lockdown slices 4a and 5 (commit d1247417). Renumbered by TL on 2026-10-11 before the first push; RM re-confirms at commit |
| D-3 | C-3 is not run up front; F0 is the fingerprint the retire script prints | User decision 2026-10-10 |
| D-4 | Literal exceptions to the paste-safety rule: `'gpt-4o'` in the view (byte-equivalent recreate), the captured table comment in the baseline, `public.<name>` in `to_regclass`, model names and UUIDs in the retire files and the checker | All are verbatim captured or approved values; none holds `into`, a backslash or `--`. The test lists each exception by file |
| D-5 | The baseline also sets `lock_timeout` and does not reproduce MAINTAIN | Uniform with the write files. MAINTAIN on anon and authenticated is the Supabase default on prod; the guarded body never runs there (SA note) |
| D-6 | The retire `UPDATE` binds each id to its approved provider and model, and refuses unless each duplicated model keeps one active row | Extra guards beyond 5.2; a wrong id cannot match |

**SA note (not changed in slice 2).** anon and authenticated hold MAINTAIN on `ai_model_pricing` (Supabase default). Recorded for a later grant tidy-up.

---

## SA Review Notes

**Reviewed by SA — 2026-10-10** (worktree HEAD `236ad66e`; `origin/main` fetched, last migration on main `20261048`, `20261049` claimed on a branch)
**Status:** APPROVED WITH CHANGES. T-1 (the user's read-only capture) may start now. Write no SQL file until changes SA-1 to SA-6 are in the workplan.

### What was verified

| Check | Result |
|---|---|
| C-1, C-2, C-3, P-1 read-only and paste-safe | Yes. Only `SELECT`/`WITH`. No `into` in any literal or comment, no backslash anywhere in this file (it is a Tailwind-scanned doc), no non-ASCII in the SQL. Catalog use is valid: `relforcerowsecurity`, `acldefault('r', …)`, `aclexplode`, `pg_policies.roles::text`, `pg_rewrite` dependency join, `SELECT DISTINCT` inside one `UNION ALL` branch, `AS position` label (allowed), final `ORDER BY ord, name` binds to the whole union. They run as written |
| Baseline is a guaranteed prod no-op | Yes. `to_regclass(...) IS NULL` is false on prod, so nothing in the body executes. A body syntax error would abort the `DO` inside `BEGIN … COMMIT` and change nothing. Statements naming `is_platform_admin()` are not executed, so they cannot fail |
| `numeric(p,s)` → `numeric` | Typmod relaxation is binary-coercible: no rewrite, no value or text-form change (stored dscale is kept). Still an ACCESS EXCLUSIVE lock for the whole transaction; `lock_timeout = '5s'` bounds the wait, the hold is milliseconds. Float branch F and branch U as the workplan says. The existing policies on the table (`20260920a`) use only `is_platform_admin()`, so no policy blocks the ALTER. Views are caught by C-1 section 10; any other blocker makes the ALTER fail inside the transaction, which is safe |
| Constraint swap | Index created before the drop, subset-of-unique argument correct, no `IF EXISTS`. **Nothing in app code relies on the constraint**: no `onConflict` and no `upsert` on this table anywhere in `lib/`, `app/` or `scripts/`. `syncMany` is deliberately update-or-insert, `create()` is a plain insert, no code matches 23505. Only the two seed SQL files use `ON CONFLICT (provider, model_name, effective_date)`; after the drop they fail 42P10 and write nothing (a partial index is not inferred without a matching `WHERE`) |
| `syncMany` after slice 2 | Its lookup (`order effective_date desc limit 1`) is not retired-aware. Slice 2 retires only rows that are never the newest for their model, plus the three aliases, which are not in the Sync list. So Sync keeps updating the kept row. Verified, no change needed; Sync is deleted in slice 8 |
| 90-day alias check on `token_usage` | Correct table. Every provider call (BOS and legacy) is recorded by `lib/ai/providers/baseProvider.ts` with `model_name`, and `pricing.ts` looks prices up by exact `provider:model_name`, never by prefix. So "no `token_usage` row under that name" means "no call priced from that row". The ledger has no model column (1.1), as stated |
| Retire script | `UPDATE … SET retired_date` only, explicit ids, `retired_date IS NULL` (a re-run matches 0 rows and the count check raises), count check, in-transaction fingerprint compare. It cannot change a charged price: a wrong id that is a charged row changes the hash and rolls back |
| Image table vs R-2 / `20261017` | `REVOKE ALL` per role on its own line, RLS on, admin SELECT via `(SELECT public.is_platform_admin())`, grants after every revoke, no DELETE/TRUNCATE/REFERENCES/TRIGGER, no function. Matches the precedent. The mixed `GRANT SELECT, INSERT, UPDATE (retired_date)` is valid syntax |
| Test placement and CI time | `supabase/migrations/__tests__/` is already in `test:bos-entitlements` (required) and in the Jest gate. A source test over SQL text runs in milliseconds. No `package.json` change, **no added CI time** |
| Migration numbers | N1 baseline, N2 schema change; final numbers `20261052` / `20261053` per D-2. RM re-confirms at commit |

### Rulings on O-1 to O-6

| # | Ruling |
|---|---|
| O-1 | **Guarded `DO` with the full captured definition, security included, dated now (`20261050`).** Back-dating is rejected. It would misstate history, and it would not even replay: the captured policies call `is_platform_admin()`, which `20260920a` creates later. Also include the captured table comment. Pin the captured names as constants in the Jest test; do not parse this MD |
| O-2 | **As drafted** (R-2 literal): admin SELECT policy plus `GRANT SELECT` to `authenticated`, the same as the sibling `ai_model_pricing`. No write policy |
| O-3 | **`supabase/SQL Scripts/`, not `supabase/migrations/`** (SA-2) |
| O-4 | **The three CHECKs are confirmed. No new CHECK on the existing cost columns in slice 2**; R-4 refuses bad values at submission in slice 3 |
| O-5 | **The token table's service-role DELETE stays until slice 8.** The DELETE route still uses it; revoking it now breaks a live admin route |
| O-6 | **FKs in slice 3, as a plain `ADD CONSTRAINT … FOREIGN KEY`** with `lock_timeout`. Every value is NULL on a 54-row table, so `NOT VALID` then `VALIDATE` adds steps and buys nothing |

### Required changes

1. **SA-1, sequencing (High).** P-1 is read-only. Move it to step 1 with C-1 to C-3: one paste-back of four grids. The user approves the retire list in writing (today's step 6) **before** Dev writes the retire script. The script and its rollback are then part of the diff that SA reviews, QA tests and the user sees. As written, T-4 needs P-1, but section 8 runs P-1 only after the PR (step 5). Just before the retire runs, the user re-runs P-1; the count check is the backstop.
2. **SA-2, retire script location (Medium).** The script goes in `supabase/SQL Scripts/<date>_ai_model_pricing_retire_duplicate_rows.sql`, with `_rollback.sql` beside it. It holds production-only UUIDs, and on any other database its count check raises by design, so in `migrations/` it would break any replay. It is a one-off data fix, not schema. The migration test still reads it by path. Update section 5.2, section 7 and the task list.
3. **SA-3, C-2 in one run (Medium).** Do not hardcode the three aliases and plan a second run. List **every model with an active row**: `provider`, `model_name`, 90-day call count and `last_call` from `token_usage`, joined on **both** `provider` and `model_name` (the price key is `provider:model`). Keep `oldest_row`. This gives the alias decision in one prod run, and gives slice 9 its coverage evidence. Keep the alias names in P-1/C-3 as they are. Make a new `NOT IN` list only if C-2 reveals another zero-call alias.
4. **SA-4, tests (Medium).**
   - (a) Drop the "Readers unchanged" filesystem assertion. Slice 3's repository will name `proposal_line_id` by design, so the assertion would fail then, and today the diff already proves it.
   - (b) The "token table security unchanged" assertion must match `public.ai_model_pricing` on a word boundary. `ai_model_image_pricing` lines must not count.
   - (c) Pin the captured names and types as constants in the test (O-1).
5. **SA-5, RK-6 wording (Low).** A retired alias called by a **non-BOS** path is recorded at **$0**. `calculateCost` returns 0 and `FALLBACK_PRICING` holds only the dated `claude-3-*` names. It does not fall back to an in-code price. BOS calls are all `['openai']` and never reach these rows. The decision stands, because C-2 requires zero calls.
6. **SA-6, completeness of 1.2 and section 6 (Low).**
   - Add `listPricedModels()` (Layer 2 picker, via the pricing cache): the retired aliases leave it. No effect, because they are Anthropic and every BOS policy is OpenAI-only.
   - Add `app/api/admin/system-config/pricing/sync/route.ts:32-34` to the comment-only edits: "unique constraint" becomes the partial index.

### Optimisation suggestions (non-blocking)

- C-1 section 11 (`prosrc ILIKE`) misses SQL-standard (`BEGIN ATOMIC`) function bodies, whose `prosrc` is empty.
  - Option: add one branch listing `pg_depend` rows with `refobjid = table_oid AND classid <> 'pg_rewrite'::regclass AND deptype NOT IN ('a', 'i')`.
  - Not required: a missed blocker makes the ALTER fail atomically.
- Rollback guard (4.5): also refuse when `(provider, model_name, effective_date)` repeats across all rows. Otherwise the `ADD CONSTRAINT` fails anyway, but with an opaque 23505.
- Image `cost_per_image` and `cached_input_cost_per_token` CHECKs could also exclude `'Infinity'`.
  - Do this only if C-1 also reports `current_setting('server_version_num')` at 140000 or higher. On PG 13 the literal itself errors.
  - The NaN clause is enough for slice 2.
- RK-9: if a write step fails with "read-only transaction", the editor connection kept the capture's `SET`. Run `SET default_transaction_read_only = off;` alone, then re-run.
- V-2's arithmetic probe illustrates the rounding; the actual proof is `format_type = numeric` in V-1. Either can stay.
- Length: with SA-1 to SA-4 applied, sections 5.1 and 8 get shorter. No further cuts are needed; the SQL is the substance.

### Needs the user (business, not technical)

- The written approval of the retire list (SA-1). This is the only decision in slice 2.
- If C-1 shows real rounding in storage (branch N, scale 8), sub-cent models such as gemini-1.5-flash stay about 7% high until slice 9. Q8 (going forward only) already covers this; nothing to decide.

### Approval
[x] Workplan approved with changes SA-1 to SA-6. Dev amends the workplan; SA re-checks those items at code review, with no separate re-review. T-1 may start now.

---

### SA Code Review

**Code Review by SA — 2026-10-11** (worktree `neuronforge-model-pricing-s2`, uncommitted on HEAD `236ad66e`)
**Status:** CHANGES REQUIRED (small, listed below). Fix CR-1 to CR-3, then go to QA. SA re-checks the fix by diff only; no new review cycle.

#### What was verified

| Check | Result |
|---|---|
| SA-1 to SA-6 from the workplan review | All applied |
| Baseline `20261052` is a no-op on prod | Yes. Only `SET LOCAL lock_timeout` and a `DO` block guarded by `to_regclass(...) IS NULL`, which is false on prod. Columns, types, defaults, nullability and order match C-1 exactly: `numeric(10,8)`, `created_at` nullable with `now()`. PK and unique names match. The two policies match C-1 (`public.` qualification only). The grants match. The table comment is verbatim. MAINTAIN is not reproduced (D-5, accepted) |
| Postgres version | C-1 shows `m` (MAINTAIN) in the ACLs, so prod runs PG 17. `security_invoker` (PG 15+) and `has_table_privilege(..., 'MAINTAIN')` in V-5 are both valid |
| View guard | The `pg_depend` test is correct. It excludes the view's own `_RETURN` rule by rule oid, so it works on PG 16+ with no self rows and on older versions with them. It catches other views, materialized views and `BEGIN ATOMIC` functions. The column array equals the capture. The cost-column check pins precision 10 and scale 8. See CR-1 for the one gap |
| Statement order | Guard, then `DROP VIEW` (no `CASCADE`, no `IF EXISTS`), then `ALTER ... TYPE numeric`, then `CREATE VIEW`, all inside one transaction after `SET LOCAL lock_timeout` |
| Recreated view body | Diffed mechanically against the capture's `pg_get_viewdef` block. Byte-identical apart from the two intended `public.` qualifications, in both the migration and the rollback. The test constant is identical too |
| `pilot_step_routing_history` lives in `public` | Read-only probe, 2026-10-11, service role: `GET /rest/v1/pilot_step_routing_history?select=execution_id,agent_id,tokens_used,estimated_cost_usd,created_at,routing_source&limit=0` with `Accept-Profile: public` returned 200. The table is in `public` and every column the view reads exists |
| Who reads the view | Nothing in the repo: `app/`, `lib/`, `scripts/`, `supabase/functions`, the crons in `vercel.json`. The only hits are this slice's own files. A similar view in `docs/PILOT_PER_STEP_ROUTING_IMPLEMENTATION.md` is a different object (`pilot_cost_savings`). Supabase Studio and its reports run as `postgres`, the owner, so they are unaffected. After the change, anon gets 42501 instead of 200. That is intended (RK-11) |
| Hardening | Owner `postgres`. `REVOKE ALL` from PUBLIC, anon, authenticated and service_role (this removes the default-privilege grants and MAINTAIN on PG 17), then SELECT only to authenticated and service_role. The rollback restores the same block, and the test proves it identical |
| New columns and CHECKs | Catalogue-only `ADD COLUMN` with no default. `<> 'NaN'` is needed, because numeric NaN sorts above every number and so passes `>= 0`. Provenance pairing is correct. See CR-2 for Infinity |
| Partial index before constraint drop | Yes, and the drop has no `IF EXISTS`. C-1 shows no FK on the constraint |
| Image table (R-2, O-2, O-5) | REVOKE ALL per role on its own line, then exactly two GRANTs. RLS on, one admin SELECT policy with `(SELECT public.is_platform_admin())`. `UPDATE (retired_date)` only, no DELETE, TRUNCATE, REFERENCES or TRIGGER, nothing to anon or PUBLIC, no function. `20261050_secdef_lockdown_slice4a_signed_in.sql` on `origin/main` does not touch `is_platform_admin` or these tables |
| Schema rollback | Refuses, without losing data, when: the image table has a row; any new column is non-NULL; a cost needs more than 8 decimals or 2 whole digits (no silent rounding back to `numeric(10,8)`); or `(provider, model_name, effective_date)` repeats across all rows. It re-adds the captured constraint **before** dropping the partial index. Tightening the typmod rewrites 54 rows under the same lock, which is fine |
| Retire script | The 12 UUIDs match the capture's P-1 "retire" rows exactly: 9 duplicates and 3 aliases, compared string by string. None of the 3 kept rows (`7c1c0f51`, `e412a440`, `6d0bbad2`) is in the list. Each id is bound to its provider and model and to `retired_date IS NULL`. `ROW_COUNT` must be 12, and the per-model keep check and the before/after fingerprint inside the transaction must pass. A NULL fingerprint refuses. No DELETE, INSERT, DROP or ALTER |
| Fingerprint identity | The expression is token-identical, whitespace aside, to C-3 in the retire script (twice plus the printout), in the retire rollback and in checker V-4. The test pins it three times in the retire script. The `round(..., 18)` normalises scale, so the hash is the same before and after the typmod relaxation. **The alias exclusion cannot hide an unintended change.** It drops only the three alias names, and those are exactly the rows the script intends to remove (they are bound by id, provider and model, and counted). Every other model's charged price is in the hash. Without the exclusion, the retire would always fail its own check |
| Retire rollback | Restores only the same 12, only if all 12 share one `retired_date`. It applies the same count and fingerprint checks: un-retiring an older row that would become the winner (for example after a later price change) changes the hash and refuses. No DELETE |
| Checker | Read-only. `SET default_transaction_read_only = on`, then a single `WITH ... SELECT` with no DML or DDL. V-1 checks the types (`atttypmod = -1`), the index, constraint absence, the new columns and the token-table grants. V-2 is the probe. V-3 checks the image table, RLS, policy and grants, including the column-level UPDATE. V-4 is INFO. V-5 checks owner, `security_invoker`, every privilege including MAINTAIN, and no column grants. Correct. It references the new columns and table directly, so it can only run **after** the schema migration (before that it errors, which is safe) |
| Paste safety | The test enforces it for all six files: no `--`, `/*`, backslash or `into` in any case, ASCII only, no single-letter alias, and literals restricted with named exceptions (D-4). Each write file opens with `BEGIN; SET LOCAL lock_timeout` and has one `COMMIT`. Re-checked by hand: no hazards |
| Test placement and CI time | `supabase/migrations/__tests__/` is in `test:bos-entitlements` (required) and in the Jest gate. Ran it: 79 of 79 pass, and the suite is pure text, so it adds no CI time. It guards the risky properties: the drop, alter and create order; no CASCADE; the view body; the hardened grants; index-before-drop; the restore-before-drop in the rollback; the 12 ids with kept-id exclusion; the count and fingerprint checks; no DELETE |
| Code edits | Comment-only in `pricing.ts`, `AiModelPricingRepository.ts` and `sync/route.ts`. No behaviour change. `console.*`: 0 in the touched files |
| Migration numbers | `origin/main` now has `20261050_secdef_lockdown_slice4a_signed_in.sql`. `20261052` and `20261053` are free in every local worktree. RM re-confirms against remote branches at commit. Separately, the uncommitted `20261050_propagate_refund_to_booking_tenant_scope.sql` in `neuronforge-refund-trigger` now collides with main; tell that session |

#### Code Review Comments

1. **CR-1: the view guard does not see auto-dependents. Priority: Medium.** Files: `20261053_..._image_table.sql`, `$view_guard$`, and the rollback's `$rollback_guard$`.
   - **The gap.** `DROP VIEW` without `CASCADE` still silently drops objects with an *auto* (`a`) dependency on the view: INSTEAD OF triggers, extra rewrite rules (for example `ON INSERT DO INSTEAD`) and comments on the view's columns.
   - **Why it matters here.** The guard checks only `deptype = 'n'`. C-1 captured triggers on the table, not on the view. The prod view granted INSERT, UPDATE and DELETE to anon, so a write rule or trigger is not impossible.
   - **Fix.** Add these refusals to both guards, in the same message style:
     - `EXISTS (SELECT 1 FROM pg_trigger WHERE pg_trigger.tgrelid = v_view)`
     - `(SELECT count(*) FROM pg_rewrite WHERE pg_rewrite.ev_class = v_view) <> 1`
   - **Migration guard only:** also add `EXISTS (SELECT 1 FROM pg_description WHERE pg_description.objoid = v_view)`. That covers the view comment and the column comments; the capture says there is no comment.
   - **Test:** pin all three conditions.
2. **CR-2: exclude Infinity in the two new CHECKs. Priority: Low; required because SA's condition is now met.** File: `20261053`.
   - SA made this conditional on PG 14 or later. C-1 proves PG 17. On PG 14+, `'Infinity'::numeric` passes both `>= 0` and `> 0`, and an infinite price would produce infinite charges.
   - **Fix:**
     - append `AND cached_input_cost_per_token <> 'Infinity'` to `ai_model_pricing_cached_input_valid`;
     - append `AND cost_per_image <> 'Infinity'` to `ai_model_image_pricing_cost_positive`.
   - Update the two test strings. The literal is letters only, so it is paste-safe. The rollback drops these constraints by name, so it needs no change.
3. **CR-3: section 8, apply order and expectations. Priority: Low, doc.** Section 8's order (**retire before schema**) is the correct one; keep it. The order proposed at hand-off (baseline, schema, checker, P-1, retire, checker) has no fingerprint taken before the schema step: C-3 is no longer run up front (D-3), and the retire prints only its own after-value. So the ALTER TYPE would have no before/after proof. Amend step 11 to state:
   - **V-4 must equal F0.**
   - **"V4 price rows" reads `active 42 retired 12`.**
   - **If a write step fails with "read-only transaction", run `SET default_transaction_read_only = off;` alone, then re-run.** The checker's session `SET` can persist on a pooled editor connection.

#### Optimisation Suggestions (non-blocking)

- **Retire per-model keep check.** It sums the active rows of the three models (`<> 3`), so a 2/1/0 split would pass. The fingerprint catches the realistic version of that case. A stricter form: `(SELECT count(*) FROM (SELECT pricing.model_name FROM ... GROUP BY pricing.model_name HAVING count(*) = 1) AS kept_model) <> 3`.
- **Rollback range check.** Use `abs(...) >= 100`, or add `<= -100`. A large negative value would make the ALTER fail atomically anyway, but with an opaque overflow error.
- **Test.** Assert that `FINGERPRINT_CORE` also appears, flattened, in the checker and in the retire rollback, so the three files cannot drift apart. Also pin the guard's own-rule exclusion clause.
- **Checker.**
  - V-1: compare `pg_get_indexdef` with the exact partial-index text, instead of only `indpred IS NOT NULL`.
  - V-3: add MAINTAIN, plus the presence of the two image CHECKs and of `ai_model_image_pricing_active_key`.
  - V-5: optionally print `md5(pg_get_viewdef(view, true))` as INFO.
- **Comment wrap.** `lib/ai/pricing.ts:159-161` leaves "so" alone at the end of a short line. Reflow the comment.

#### Confirmed apply order (production, Supabase SQL editor, each write step in a new tab)

1. (Optional) Baseline `20261052`. Expect `Success. No rows returned`.
2. Re-run P-1. The grid must equal the approved 12 retire rows plus the 3 kept rows; if not, stop.
3. Retire script. It commits only if: the count is 12, each model keeps one active row, and the fingerprint is unchanged. **Record the printed `price_fingerprint` as F0**; expect `active_rows 42`, `retired_rows 12`.
4. Schema migration `20261053`. Expect `COMMIT`; the view guard refuses, with no changes, if anything differs.
5. Checker. VERDICT PASS; **V-4 equals F0**; V-4 rows `active 42 retired 12`.
6. Smoke test: `/admin/system-config` shows the same prices; one Business OS chat message is charged as usual.

The rollback is the reverse: schema rollback, then retire rollback. Each is independent of the other.

#### Code Approved for QA: No, until CR-1 to CR-3 are in. Then Yes, with no further SA cycle.

---

## QA Testing Report

**QA - 2026-10-11** (worktree `neuronforge-model-pricing-s2`, uncommitted; no database touched, nothing installed, nothing staged)
**Test mode:** full
**Strategy used:** A (Jest source tests over the SQL text) plus static SQL verification. **No real Postgres run happened**: `psql`, `pg_ctl`, `postgres`, `docker` and the `supabase` CLI are not on PATH, there is no `C:/Program Files/PostgreSQL`, no Windows Postgres service, and no embedded engine (pglite, pg-mem) in `node_modules`. Nothing was installed. Every "proved" item below is by careful reading, not by execution.
**Focus:** schema, security, pipeline of the production apply order (section 8)
**Skipped:** real-Postgres fixture run (no engine available); browser check (prod-only, the user does it per the checklist below)
**Input source:** TL prompt

### Step 1: test runs (counts verbatim)

| Command | Result |
|---|---|
| `npx jest supabase/migrations/__tests__/ai-model-pricing-slice2.migration.test.ts --ci` | Test Suites: 1 passed, 1 total. Tests: 79 passed, 79 total |
| `npx jest supabase/migrations --ci` | Test Suites: 26 passed, 26 total. Tests: 1103 passed, 1103 total |
| `npm run test:bos-entitlements` | Test Suites: 213 passed, 213 total. Tests: 5791 passed, 5791 total |
| `npx jest app/__tests__/tailwind-css-escape.guard.test.ts --ci` | Test Suites: 1 passed, 1 total. Tests: 6 passed, 6 total |
| Regression, readers (section 7): `npx jest lib/repositories/__tests__/AiModelPricingRepository.test.ts lib/ai app/api/admin/system-config app/admin/system-config --ci` | Test Suites: 14 passed, 14 total. Tests: 227 passed, 227 total |

The Tailwind guard scans **tracked** files only, so it did not see the 9 untracked slice 2 files. QA ran the guard's own decoder over every changed and untracked file (negative control `C:` + backslash + `9e5eba32` flagged 1): **0 undecodable escapes** in all of them, including the test file, which holds 85 backslashes (regex escapes, all decodable).

The `lib/` and `app/` diff is comment-only (verified line by line): `pricing/sync/route.ts`, `lib/ai/pricing.ts`, `AiModelPricingRepository.ts`.

### Step 2: static verification (no real Postgres)

| Check | Result |
|---|---|
| One `BEGIN;` and one `COMMIT;` per write file (baseline, migration, schema rollback, retire, retire rollback); checker has none and opens with `SET default_transaction_read_only = on;` | Pass, all 6 files |
| Dollar tags balanced (`$baseline$`, `$view_guard$`, `$rollback_guard$`, `$retire$`, `$unretire$`, 2 each) | Pass |
| Single quotes even and parentheses balanced (outside literals) | Pass, all 6 files |
| Recreated view vs captured `pg_get_viewdef` | Exactly 2 differing lines: `FROM ai_model_pricing` became `FROM public.ai_model_pricing`, and `FROM pilot_step_routing_history psrh` became `FROM public.pilot_step_routing_history psrh`. Column references `ai_model_pricing.x` still resolve (no alias on the qualified table). Migration and rollback view bodies are byte-identical |
| The 12 UUIDs | Retire script: 12 tuples, 12 unique, (id, provider, model) set equals the capture's 12 "retire duplicate" / "retire alias" rows exactly. Retire rollback: 36 tuples in its 3 lists, the same 12 unique. The 3 "keep charged price" ids appear 0 times |
| Baseline is a prod no-op | Yes by reading: the only body is inside `IF to_regclass('public.ai_model_pricing') IS NULL`. Body syntax is valid (plpgsql raw-parses it at compile, so a syntax error would abort even on prod; none found) |
| ALTER TYPE succeeds with the view present | Yes by reading: the guard passes on the captured state, `DROP VIEW` (no CASCADE) runs before the ALTER, so no rule references the columns. `numeric(10,8)` to `numeric` is binary-coercible: no rewrite, stored values and their text form unchanged. The only other references (policies) call `is_platform_admin()` and name no column |
| View recreated hardened | Yes: `WITH (security_invoker = true)`, owner postgres, `REVOKE ALL` from PUBLIC, anon, authenticated, service_role, then `GRANT SELECT` to authenticated, service_role. Result column types unchanged (`numeric(10,8) + numeric(10,8)` was already unconstrained `numeric`) |
| PG version needs | `security_invoker` needs PG15+, `has_table_privilege(..., 'MAINTAIN')` in the checker needs PG17+. The C-1 capture lists MAINTAIN grants, which exist only on PG17+, so prod satisfies both |
| Fingerprint unchanged by the retire | Yes by reading: the 9 duplicates are never position 1 (older `effective_date` than the kept row in every model), the 3 aliases are excluded by `NOT IN`. The fingerprint is `round(x, 18)::text`, so it is also unchanged by the ALTER TYPE (dscale is kept) |
| $0.075 per 1M (7.5e-8) stored exactly after the migration | Yes by reading: both cost columns become unconstrained `numeric` (arbitrary precision) with no CHECK; `0.000000075` is stored as written. Before: `numeric(10,8)` rounds it to `0.00000008`, as C-1 recorded for gemini-1.5-flash |
| Re-run safety | Second migration run refuses in the guard (cost columns are no longer `numeric(10,8)`), before any change. Second retire run updates 0 rows and raises on the count. Second retire-rollback run refuses (0 rows retired) |

### Step 3: paste-safety scan (all 6 SQL files)

| Hazard | Result |
|---|---|
| The word "into", any case, including inside words | 0 in every file |
| `--` and `/*` | 0 in every file |
| Backslash | 0 in every file |
| Non-ASCII | 0 in every file (also 0 CR, 0 tab) |
| Single-letter aliases | 0 (the only short alias is `psrh`, 4 letters, from the captured view) |
| Literals outside letters, digits, underscores and spaces | Only the D-4 named exceptions: the captured table comment (baseline, inside the dollar-quoted body), `'public.<name>'` in `to_regclass`, `'gpt-4o'` in the view, model names and UUIDs in the retire files and the checker |

### Step 4: refusal paths (by reasoning)

| Script | Condition | Refuses? |
|---|---|---|
| Migration | view missing / not relkind `v` / any `n` dependency other than its own rewrite rule / columns not the captured 8 / cost columns not `numeric(10,8)` | Yes, each raises before `DROP VIEW` |
| Migration | constraint name wrong | Yes, `DROP CONSTRAINT` has no `IF EXISTS`; whole transaction aborts |
| Schema rollback | a price with 9 decimals (for example `0.000000075`) | Yes: `0.000000075 <> round(0.000000075, 8)` is true |
| Schema rollback | a price of 100 or more, NaN or +Infinity | Yes (`>= 100`; NaN and Infinity sort above 100) |
| Schema rollback | any image price row; any non-NULL cached price, `proposal_id` or `proposal_line_id` | Yes |
| Schema rollback | `(provider, model_name, effective_date)` repeats across all rows | Yes, clear message instead of 23505 |
| Schema rollback | view changed or depended on | Yes, same guard as the migration |
| Retire | matched rows not 12; a duplicated model not left with exactly one active row; fingerprint changed or NULL | Yes, each raises inside the transaction |
| Retire rollback | fewer than 12 of the ids retired, or the 12 do not share one `retired_date` (`count(DISTINCT) <> 1`) | Yes |
| Retire rollback | restored count not 12; fingerprint changed | Yes |

The two rollbacks are independent: either order works (the restored duplicates have distinct dates, so neither the partial index nor the re-added full constraint conflicts). Section 8 says schema rollback first.

### Test Coverage

| Acceptance criterion (slice 2) | Tested? | Result | Notes |
|---|---|---|---|
| Baseline is a guarded no-op with the captured definition | Yes (Jest + reading) | Pass | Not executed on Postgres |
| Both cost columns unconstrained `numeric`; $0.075 per 1M exact | Yes (Jest + reading) | Pass | Storage proof is V1 on prod |
| Partial unique index replaces the constraint, no lapse | Yes | Pass | Index created before the drop |
| Three nullable columns + two CHECKs | Yes | Pass | |
| Image table, R-2 grants and RLS | Yes | Pass | `GRANT SELECT, INSERT, UPDATE (retired_date)` is valid: the column list binds to UPDATE only |
| Dependent view dropped and recreated hardened | Yes | Pass | User-approved D-1 |
| 12 approved rows retired, never deleted, fingerprint unchanged | Yes | Pass | UUIDs match capture exactly |
| Both rollbacks refuse rather than lose data | Yes (reading) | Pass | |
| Readers and charges unchanged | Yes | Pass | Comment-only diff; 227 reader tests green |
| Executed on a real Postgres | No | Not run | No engine available locally |

### Issues Found

#### Bugs (must fix before commit)
None.

#### Performance Issues (should fix)
None. ACCESS EXCLUSIVE on a 54-row table is held for milliseconds, bounded by `lock_timeout = '5s'`.

#### Edge Cases (nice to fix)
1. **Checker V2 is a constant probe** - `scripts/check-ai-model-pricing-slice2-migration.sql` - Low. It is PASS on any database, migrated or not. The real proof is V1 (`format_type` = `numeric`, typmod -1). SA already accepted this; listed so the user does not read V2 as the storage proof.
2. **Checker errors instead of reporting FAIL when run before the migration or after the schema rollback** - same file - Low. It names `ai_model_image_pricing` and the new columns, so it fails with 42P01 / 42703. Use C-1 to check a rolled-back state.
3. **Schema rollback guard does not catch a cost of -100 or less, or -Infinity** - `20261053_..._rollback.sql` - Low. The `ALTER ... TYPE numeric(10,8)` then fails with numeric overflow; atomic, no data loss, only a less clear message. No path writes negative prices today.
4. **The migration refuses on any database without the view** - `20261053_...sql` - Low. `pilot_cost_savings_summary` is not created by any migration, so a replay or branch database stops at the guard. The repo cannot replay from empty anyway (section 3).
5. **Workplan nits** - this file - Low. Section 4.6 sits before 4.5; section 10 still names `20261050` / `20261052` (superseded by D-2).
6. **The admin pricing list cannot tell a retired row from an active one** - `app/admin/system-config/page.tsx`, `app/api/admin/system-config/pricing/route.ts:175` (`listAll()`) - Medium as a user-facing expectation, not a slice 2 defect (section 1.2 says the admin GET is unchanged, and it is). After the retire the page still shows all 54 rows, including 4 `gpt-4o-mini` rows with identical prices, and no column marks the 12 as retired. An admin who edits one of the retired rows changes nothing that is charged, with no sign of that. To verify the retire, use the retire script's own output and checker row `V4 price rows` (`active 42 retired 12`), not the page. Showing or hiding retired rows is a UI decision for a later slice.

### Manual checklist for the user (production, after merge)

Order per section 8. Each script in a **new SQL editor tab** (the checker leaves its tab read-only).

1. (Optional) Baseline `20261052`: `Success. No rows returned`.
2. Re-run P-1: the grid must equal the 12 approved rows plus the 3 kept rows.
3. Retire script: one result row. **PASS** = `active_rows` 42, `retired_rows` 12, and a `price_fingerprint`. Write the fingerprint down as F0. Any error means nothing changed.
4. Schema migration `20261053`: `Success. No rows returned`. An error naming the view or the cost columns means it refused and nothing changed.
5. Checker: **PASS** = first row `VERDICT | PASS | 83 pass 0 fail`; every other row PASS except two INFO rows. Row `V4 price fingerprint ...` must equal F0 exactly. Row `V4 price rows` must read `active 42 retired 12`. Any FAIL row: stop and send the grid.
6. `/admin/system-config`, pricing list: **still 54 rows; the retired rows do NOT disappear.** `GET /api/admin/system-config/pricing` calls `listAll()` (`select('*')`, no `retired_date` filter) and `app/admin/system-config/page.tsx` neither filters nor shows `retired_date`, so the 12 retired rows stay listed and look the same as active ones (see Edge Case 6). What to check instead: the page loads, the list still shows 54 rows, and prices are unchanged, for example `gpt-4o-mini` $0.15 / $0.60 per 1M, `claude-3-5-sonnet-20241022` $3 / $15, `claude-3-haiku-20240307` $0.25 / $1.25, `gemini-1.5-flash` still $0.08 / $0.30 (stays rounded until slice 9 or a Sync, by design).
7. Send one Business OS chat message: charged as usual.

Rollback, only if needed: schema rollback, then retire rollback, each in a new tab. Either one printing a "refused" error has changed nothing.

### Final Status
- [x] All acceptance criteria pass by Jest and static verification - ready for commit (no bug open)
- [ ] Issues found - Dev must address before commit
- Not done: execution on a real Postgres (none available). The first execution of these scripts on any Postgres will be production, protected by the guards, one transaction per script, and the checker.

---

## Production apply record

Run by TL on 2026-10-11 through the Supabase connector (project `jgccgkyhpwirgknnceoh`, Postgres 17), with the user's explicit go-ahead, exactly from the committed files.

| # | Step | Result |
|---|---|---|
| 7 | P-1 re-run | Identical to the approved list: 12 retire rows, 3 kept rows, no ties. The three aliases still had zero calls ever in `token_usage` |
| 6 | Baseline `20261052` | Ran; no-op as designed (table exists) |
| - | Pre-retire fingerprint (independent read) | `76c7cfe8e89e2464f9fa866668682426`; 54 active, 0 retired |
| 8 | Retire script | Committed. Printed fingerprint F0 `76c7cfe8e89e2464f9fa866668682426` (unchanged); 42 active, 12 retired; no row deleted |
| 10 | Schema migration `20261053` | Committed; every view guard passed. The view was recreated with `security_invoker=true` |
| 11 | Checker (run without its leading `SET default_transaction_read_only`, which can persist on a pooled connection; the rest is SELECT only) | **VERDICT PASS, 83 pass 0 fail.** V-1 cost columns `numeric`; V-2 old type stored `0.00000008`, new type stores `0.000000075`; V-4 fingerprint `76c7cfe8e89e2464f9fa866668682426` = F0; rows active 42 retired 12; V-5 `security_invoker=true` |
| - | Anon probe of the view (HEAD, no rows read) | 401, was 200 before |
| - | Service-role price read as the app does it | 200; gpt-4o $2.50 / $10 and gpt-4o-mini $0.15 / $0.60 per 1M, unchanged |
| 12 | `/admin/system-config` and one Business OS chat message | Owed by the user after deploy. The page still lists all 54 rows (expected; noted for the review UI slice) |

## Commit Info

| Item | Value |
|---|---|
| PR | #304, merged 2026-10-11 |
| Commit | `856455c4` feat(pricing): exact price storage, image price table, retire duplicate price rows (price review slice 2) |
| Merge | `7cf7974a` |
| Migration numbers | `20261052` baseline, `20261053` schema change (D-2) |

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-10 | Created | Dev workplan for slice 2 (R-8 row 2): read-only capture C-1 to C-3, guarded baseline, unconstrained numeric, partial unique index, new nullable columns, empty image table, retire preview and fingerprint-checked retire script, tests, production order. No code written |
| 2026-10-10 | SA changes applied | SA-1: P-1 moved to Step 1 with C-1 to C-3 (four grids, one paste-back), written approval before the retire script, P-1 re-run before the retire. SA-2: retire script in `supabase/SQL Scripts/`. SA-3: C-2 lists every active model with 90-day calls and last call, joined on provider and model. SA-4: readers assertion dropped, word-boundary match, captured constants in the test. SA-5: RK-6 wording. SA-6: `listPricedModels()` and sync route comment. Rulings O-1 to O-6 applied (N1 `20261050`, N2 `20261052`). Step 1 blocks are single SELECT/WITH statements, the read-only SET line removed |
| 2026-10-10 | Code written | C-1 and the view definition recorded in the capture; C-3 dropped from the up-front run. Baseline `20261052`, schema migration `20261053` with drop and recreate of the dependent view `pilot_cost_savings_summary` (D-1), rollback, checker, retire script and rollback with the 12 approved ids, comment-only edits, Jest test. View owner, grants, options and comment are placeholders (T-2b, blocking). Uncommitted |
| 2026-10-11 | T-2b filled: view hardened | User decision: recreate `pilot_cost_savings_summary` with `security_invoker = true`, owner postgres, no comment, anon loses all access, SELECT only for authenticated and service_role; the rollback recreates the same hardened view and does not restore anon. Checker V-5 and the Jest test assert the hardened values; RK-11 added. Non-admins now get no rows (security_invoker plus admin-only RLS on `ai_model_pricing`) |
| 2026-10-11 | SA code review and QA fixes | CR-1: view guard refuses on a trigger on the view, a rewrite rule beyond its own, and (migration only) a comment on the view or its columns. CR-2: both new CHECKs exclude `'Infinity'`. CR-3: section 8 step 11 states V-4 equals F0, `active 42 retired 12`, and the read-only recovery. Retire keep check counted per model; schema rollback range check uses `abs()`; test pins the identical fingerprint in the retire script, the retire rollback and checker V-4. QA: admin page still lists 54 rows after the retire (1.2, section 8 step 12; follow-up in the requirement under slice 4); section 4.5 now precedes 4.6; section 10 numbers. `lib/ai/pricing.ts` comment reflowed (SA nit) |
| 2026-10-11 | Migrations renumbered | `20261051` was taken on origin/main (SECURITY DEFINER slice 5, d1247417). Baseline is now `20261052`, schema change `20261053` (and its rollback); test paths and every reference updated. The baseline content was already run on production on 2026-10-11 as a no-op |
| 2026-10-12 | Applied and merged | PR #304 merged (856455c4, merge 7cf7974a). Production apply record added: retire, `20261053` and checker (VERDICT PASS 83/0, fingerprint unchanged) run 2026-10-11 by TL via the Supabase connector with the user's go-ahead; anon now refused on the view. Status COMPLETE. User post-deploy smoke check (step 12) still owed |
