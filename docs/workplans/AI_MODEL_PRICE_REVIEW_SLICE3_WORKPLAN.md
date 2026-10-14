# Workplan: AI Model Price Review, Slice 3 (pending-price storage)

> **Last Updated**: 2026-10-14

**Developer:** Dev
**Requirement:** [AI_MODEL_PRICE_REVIEW_REQUIREMENT.md](/docs/requirements/AI_MODEL_PRICE_REVIEW_REQUIREMENT.md): §8a UF-1..UF-4; MP-FR-2/3/4/5/8/12 as amended; R-1 precision, R-2 storage pattern, R-4 flags; SA Re-review RR-1 (validation, bounds, manual entry), RR-2 (pending area), RR-3 (area tags), RR-4 (colour), RR-6 (index on `proposal_line_id`); R-9 row 3; O-6 (FKs in slice 3)
**Branch:** `feature/ai-model-price-review-slice3` (worktree `neuronforge-model-pricing-s3`, off origin/main `799f8018`)
**Date:** 2026-10-14
**Status:** Code complete, uncommitted: awaiting SA code review (workplan SA-approved with changes C-1 to C-13, 2026-10-14).

## Overview

Slice 3 builds the **pending area**: a place to store a provider's new price for a model before anyone decides to use it. It adds two tables (a round and its lines), one submit function that writes only pending lines and supersedes the older pending line for the same model and unit, a repository, a shared Zod schema with the RR-1 bounds, an admin manual-entry route, and an admin read route that returns current versus pending per unit with the % gap, the RR-4 colour and the RR-3 area tags. **No price in effect changes.** `ai_model_pricing` and `ai_model_image_pricing` gain only foreign keys and an index; no row is written. No apply, no fetch, no UI.

## Table of Contents

1. [Analysis](#1-analysis)
2. [Migration](#2-migration)
3. [Code](#3-code)
4. [Read model (current vs pending)](#4-read-model-current-vs-pending)
5. [Tests and CI](#5-tests-and-ci)
6. [Order of operations on production](#6-order-of-operations-on-production)
7. [Docs](#7-docs)
8. [Risks and rollback](#8-risks-and-rollback)
9. [Open questions for SA](#9-open-questions-for-sa)
10. [Task list](#10-task-list)
11. [SA Review Notes](#sa-review-notes) · [QA Testing Report](#qa-testing-report) · [Commit Info](#commit-info) · [Change History](#change-history)

---

## 1. Analysis

### 1.1 Measured on 2026-10-14 (read-only, zero-row PostgREST selects, `business-os-schema-check`)

| Claim | Result |
|---|---|
| `ai_model_pricing.proposal_id`, `.proposal_line_id`, `.cached_input_cost_per_token` | 200, present (slice 2 applied) |
| `ai_model_image_pricing.proposal_id`, `.proposal_line_id` | 200, present |
| `ai_price_proposals`, `ai_price_proposal_lines` | 42P01, absent: slice 3 creates them |
| `ai_model_pricing?select=input_cost_per_token::text` | 200: PostgREST accepts the text cast, so exact values can be read without a float |
| `admin_users` (`user_id`, `is_active`, `email`) | Per `20260920a` and `20260701`; `AdminAccessService` binds `user_id` on the first admin call, before any route body runs |

### 1.2 What reads prices today (none of it changes)

| Reader | Slice 3 effect |
|---|---|
| `lib/ai/pricing.ts` (`listActive()`, 1 h cache, `FALLBACK_PRICING`) | Not edited. The read model imports only its pure exports `inCodeTokenPrices()` and `isInputOnlyPricedModel()` |
| `lib/business-os/llm/chargePricing.ts` (FR-12 conservative rate) | Not edited. `conservativeRateDerivation()` is read for the informational "above conservative rate" flag |
| OpenAI cached input (`openaiProvider.ts:562-580`, 50% of input) | Not edited. It is the "derived" current cached rate (RR-4) |
| Images: `resolveImagePrice()` (`GeneratedImageService.ts`), setting `image_generation_prices_usd`, then `IMAGE_FALLBACK_PRICING` | Not edited. It is the "current" image price. `ai_model_image_pricing` has no reader until slice 7, so it is **not** "current" yet |
| Layer 2 guardrail (`modelSettings.ts:322`) | Not edited |

**Consequence for RR-4 "current = the rate we charge today":** until slice 7, the current cached-input rate is always the derived rule and the current image price is always setting-then-fallback, even if a column or table row exists. The read model says so per unit (`basis`).

### 1.3 Skills and rules applied

- `new-api-route`: `requireAdmin` first, Zod, repository only, Pino child with `correlationId`, `logAndFlush` (WC-7) before responding, dev-only error details, 401/403/400 + happy tests.
- `new-repository`: injected client, `{ data, error }`, no throws, singleton, types in `types.ts`, exported from `index.ts`. **No `user_id` filter, documented**: the tables are platform-wide reference data with no owner column (same exemption as `AiModelPricingRepository`'s header).
- `tenant-isolation-guard`: not applicable. No owner column, admin-only routes, and slice 3 acts on no caller-supplied row id (manual entry creates; the read takes no id). Slice 8 (apply and dismiss by line id) must revisit it.
- `business-os-schema-check`: §1.1. `business-os-entitlements`, `bos-llm-call-standards`, `durable-queue-drain`: not applicable (no entitlements import, no AI call, no queue).
- R-2 storage pattern (`20261017_business_os_credit_lots.sql`): REVOKE ALL per role on its own line, RLS on, admin SELECT via `(SELECT public.is_platform_admin())`, `SECURITY INVOKER` with `SET search_path = ''`, `EXECUTE` to `service_role` only, migration source test pinning grants.
- `console.*`: 0 in every file this slice touches (`AiModelPricingRepository.ts`, `events.ts`, `eventAudience.ts`, `types.ts`, `index.ts`, `pricing.ts`, `chargePricing.ts`, `EmbeddingService.ts`).

---

## 2. Migration

`supabase/migrations/20261066_ai_price_pending_area.sql` (placeholder number, see O-17). One `BEGIN … COMMIT`, `SET LOCAL lock_timeout = '5s'` first. Rollback `supabase/SQL Scripts/20261066_ai_price_pending_area_rollback.sql`; checker `scripts/check-ai-price-pending-area-migration.sql`.

**Migration number (C-13, O-17).** `20261059` and `20261060` are on origin/main (merged). No `20261061+` file exists on any ref or worktree; the DB exposure stream reserves `20261061+` for its slice 2c. `20261066` is approved; RM re-checks against origin/main and every remote branch at commit.

**Statement order (C-4).** Tables, constraints, indexes, trigger, function, security; the four FKs and two indexes on the live tables go **last**, so their write-blocking locks are held only until `COMMIT`.

### 2.1 `public.ai_price_proposals` (one manual entry or, from slice 5, one fetch round)

| Column | Type | Rule |
|---|---|---|
| `id` | uuid PK, default `gen_random_uuid()` | |
| `source_kind` | text NOT NULL | CHECK in `manual`, `fetch` (only `manual` is written in slice 3) |
| `provider_outcomes` | jsonb NULL | CHECK `source_kind = 'manual'` implies NULL (slice 5 fills it) |
| `created_by` | uuid NOT NULL | Admin auth user id. **No FK to `auth.users`**: a NO ACTION FK there blocks account deletion (known hazard); precedent `credit_lots.actor_admin_id` |
| `created_at` | timestamptz NOT NULL default `now()` | |

No approve or reject status (RR-2). Insert-only: `service_role` gets `SELECT, INSERT` only.

### 2.2 `public.ai_price_proposal_lines`

| Group | Columns | Rule |
|---|---|---|
| Identity | `id` uuid PK; `proposal_id` uuid NOT NULL FK to proposals; UNIQUE `(id, proposal_id)` (target of the composite FK in 2.4) | |
| Unit | `kind` text CHECK `token`/`image`; `provider` text; `model_name` text; `image_size`, `image_quality` text NULL | CHECK: token lines have no size or quality; image lines have both. Format CHECKs: lowercase, letters, digits, dots and hyphens, length bounded |
| Proposed price (as submitted) | `input_per_1m`, `output_per_1m`, `cached_input_per_1m` text; `price_per_image` text | CHECK each non-NULL value matches the R-1 regex `^[0-9]{1,6}([.][0-9]{1,9})?$`. Token lines need input and output, image lines need `price_per_image` |
| Proposed price (per token / per image) | `input_cost_per_token`, `output_cost_per_token`, `cached_input_cost_per_token`, `cost_per_image` numeric | **Generated `STORED` columns** (O-2): per token = `string::numeric * 0.000001` (exact), per image = `string::numeric`. The RPC inserts strings only. C-3: input > 0 on token lines, cost per image > 0 on image lines, cached input > 0 when present; output may be 0 |
| Current snapshot (at submit) | `current_basis` text CHECK `table`, `in_code_fallback`, `image_setting`, `unpriced` (line-level basis is never `derived`; the derived OpenAI cached-input value sits in `current_cached_input_cost_per_token` even when the basis is `table`); `current_row_id` uuid NULL; `current_input_cost_per_token`, `current_output_cost_per_token`, `current_cached_input_cost_per_token`, `current_cost_per_image` numeric NULL | For history (RR-6) and for slice 8's stale check. Supplied by the server's exact read (O-3) |
| Source | `source_url` text NOT NULL; `checked_on` date NOT NULL | CHECK `left(source_url, 8) = 'https' || chr(58) || '//'` and length 12..500 (colon built with `chr(58)` as in `20261017`); domain allow-list is enforced in Zod (config, not SQL) |
| Flags | `flags` text[] NOT NULL default `'{}'` | CHECK `flags <@` the full known list, slice-5 flags included so no later ALTER (O-5) |
| Cross-check (slice 5) | `cross_check_verdict` text NULL CHECK `agrees`/`differs`/`not_listed`/`unavailable`; `cross_check_value` text; `cross_check_source` text; `cross_check_fetched_at` timestamptz; `cross_check_diff_pct` numeric | All NULL in slice 3 ("cross-check not run") |
| State (RPC only) | `state` text NOT NULL default `pending` CHECK `pending`/`applied`/`dismissed`/`superseded`; `decided_by` uuid; `decided_at` timestamptz; `decision_reason` text; `override_reason` text; `superseded_by` uuid FK to lines `DEFERRABLE INITIALLY DEFERRED` | Shape CHECK: `pending` has every decision field NULL; `superseded` has `decided_by`, `decided_at` and `superseded_by`, and NULL `decision_reason` and `override_reason` (C-3); `applied` and `dismissed` have `decided_by`, `decided_at` and a reason of 3..500 trimmed chars |
| Audit columns | `created_by` uuid NOT NULL (no FK, as 2.1); `created_at` timestamptz NOT NULL default `now()` | |

**One pending line per unit (RR-2):** `CREATE UNIQUE INDEX ai_price_proposal_lines_one_pending_key ON public.ai_price_proposal_lines (provider, model_name, kind, coalesce(image_size, ''), coalesce(image_quality, '')) WHERE state = 'pending';` plus indexes on `(proposal_id)` and `(provider, model_name, created_at)` for history.

**Content is insert-only by privilege (C-1):** `service_role` gets `SELECT, INSERT` on the table and `UPDATE (state, decided_by, decided_at, superseded_by)` only (column-level, as slice 2's `UPDATE (retired_date)`). `decision_reason` and `override_reason` are granted by slice 8 with its RPCs, so `applied` and `dismissed` are unreachable before slice 8. Supersede sets `decided_by` to the submitting admin. No DELETE, TRUNCATE, REFERENCES or TRIGGER to anyone.

**Transition trigger (C-2):** `BEFORE UPDATE` on lines, function `public.ai_price_proposal_line_transition()`, `SECURITY INVOKER`, `SET search_path = ''`, EXECUTE revoked from PUBLIC, anon and authenticated after the CREATE. It raises unless `OLD.state = 'pending'` and `NEW.state` is `superseded`, `applied` or `dismissed`: terminal states are final whatever the caller. It never names the live tables.

### 2.3 Security (both tables, R-2 / image-table precedent)

`ENABLE ROW LEVEL SECURITY`; one policy `FOR SELECT TO authenticated USING ((SELECT public.is_platform_admin()))`; `REVOKE ALL` from PUBLIC, anon, authenticated, service_role, each on its own line; then `GRANT SELECT` to authenticated (reachable only through the admin policy) and the service_role grants above. Table comments in plain words (no "into", no punctuation beyond what the paste rules allow).

### 2.4 Provenance foreign keys on the live tables (O-6)

```sql
ALTER TABLE public.ai_model_pricing ADD CONSTRAINT ai_model_pricing_proposal_fkey
  FOREIGN KEY (proposal_id) REFERENCES public.ai_price_proposals (id);
ALTER TABLE public.ai_model_pricing ADD CONSTRAINT ai_model_pricing_proposal_line_fkey
  FOREIGN KEY (proposal_line_id, proposal_id) REFERENCES public.ai_price_proposal_lines (id, proposal_id);
CREATE INDEX ai_model_pricing_proposal_line_idx ON public.ai_model_pricing (proposal_line_id);
```

The same three for `ai_model_image_pricing`. The composite FK proves a price row's line belongs to its proposal; slice 2's `provenance_paired` CHECK already forces both NULL or both set. Every value is NULL today, so validation is a 54-row scan. `ADD FOREIGN KEY` takes SHARE ROW EXCLUSIVE (blocks writes, **not reads**) for milliseconds; `CREATE INDEX` takes SHARE (same). Charging only reads, so it never waits. These are the **only** statements in the file that name either live table (pinned by the test).

### 2.5 Submit function

`public.ai_price_submit_pending(p_admin_user_id uuid, p_source_kind text, p_provider_outcomes jsonb, p_lines jsonb) RETURNS TABLE (out_proposal_id uuid, out_line_id uuid, out_line_index integer, out_superseded_line_id uuid)`, `LANGUAGE plpgsql VOLATILE SECURITY INVOKER SET search_path = ''`.

1. Refuse NULL arguments (22004). Refuse unless `EXISTS (SELECT 1 FROM public.admin_users AS admin_row WHERE admin_row.user_id = p_admin_user_id AND admin_row.is_active)` (42501; R-2 defence in depth).
2. Refuse unless `p_lines` is an array of 1..200 elements; refuse two lines with the same unit key (22023).
3. Insert the proposal with a pre-generated id (`v_proposal_id := gen_random_uuid();`, so no `RETURNING … INTO`).
4. Per line (`jsonb_array_elements … WITH ORDINALITY`), in unit-key order: `pg_advisory_xact_lock(hashtextextended('ai_price_proposal_lines' || chr(58) || unit_key, 0))`, pre-generate the new line id, mark the existing pending line for that unit `superseded` with `superseded_by` = the new id (deferred FK), then insert the new line with prices **cast from the strings in SQL**.
5. Return one row per line.

**It never names `ai_model_pricing` or `ai_model_image_pricing`** (RR-1, pinned). Therefore it does not re-check the snapshot against the live row; the apply RPC in slice 8 does that stale check, which is where a stale snapshot could do harm (O-3). `REVOKE ALL ON FUNCTION … FROM PUBLIC/anon/authenticated/service_role`, then `GRANT EXECUTE … TO service_role`, after the CREATE.

### 2.6 Paste safety (as slice 2, plus one stated exception)

No `--` or `/*`; no backslash; ASCII only; no single-letter alias; one `BEGIN`/`COMMIT`; every literal letters, digits, underscores and spaces, with named exceptions only: the R-1 regex literal, `''` in the index expression. **The word "into" appears only as the SQL keyword pair `INSERT INTO public.ai_price_proposals` / `INSERT INTO public.ai_price_proposal_lines`** inside the function body: Postgres has no INSERT without it. No `SELECT … INTO`, no `RETURNING … INTO` (assignments use `:=`), never in a literal, `RAISE` message, comment or identifier. Precedent: `20261017` holds `INSERT INTO` (and `SELECT … INTO`) and was applied to production by hand; its test bans only the `INTO x AS y` shape. Slice 2's test bans "into" everywhere because slice 2 had no insert. SA to confirm (O-1).

### 2.7 Rollback and checker

**Rollback:** one transaction, `SET LOCAL lock_timeout = '2s'` first (C-4). `DROP CONSTRAINT` and `DROP INDEX` take ACCESS EXCLUSIVE on `ai_model_pricing`, so they block reads for milliseconds; if the lock is not had within 2 s the rollback aborts with nothing changed. A `DO` guard refuses if any `ai_model_pricing` or `ai_model_image_pricing` row has a non-NULL `proposal_id` (impossible before slice 8, but the guard is what keeps the rollback safe later). Then drop the six FK/index objects on the live tables, the function, then lines, then proposals. Pending lines are dropped with it; they never affected a charge, and each manual entry stays in `audit_trail` (O-13).

**Checker** (`SET default_transaction_read_only = on;` first, read-only, one grid of `check, verdict, detail`):

| # | Verifies |
|---|---|
| V-1 | Both tables exist with the exact columns and types; RLS on; one admin SELECT policy each |
| V-2 | Table privileges per role from `aclexplode`: nothing to PUBLIC or anon; authenticated SELECT only; service_role SELECT, INSERT, plus exactly the four UPDATE columns on lines (C-1) |
| V-3 | The function: `prosecdef = false`, `proconfig` holds `search_path=""`, `has_function_privilege` false for anon and authenticated, true for service_role |
| V-4 | The four FKs and two indexes on the live tables; the partial unique index on pending lines |
| V-5 | `ai_model_pricing` and `ai_model_image_pricing`: PASS needs zero rows with a non-NULL `proposal_id`. Active and retired counts are **printed** (INFO), not hard-coded: Sync is alive until slice 6 and can add rows. The user compares them with U-1 (C-5) |
| V-6 | **Charged-price fingerprint** (slice 2's C-3 expression) printed; the user compares it with F0 from step U-1. Must be identical |
| V-7 | Precision probe without writing: `('0.075'::numeric * 0.000001) = 0.000000075` is true |

**Write probe (optional, O-12, C-11):** `scripts/probe-ai-price-pending-area-migration.sql`, following `scripts/probe-bos-credit-lots-migration.sql`: one `DO` block, `SET LOCAL ROLE service_role` inside it, the admin id read from an active `admin_users` row (no pasted or literal uuid), no "into". It submits a `0.075` line, asserts `0.000000075` stored exactly, submits again and asserts the first is `superseded`, asserts a direct `superseded` to `pending` update fails (C-2), and then **always raises**, so nothing is kept.

---

## 3. Code

| File | Action | Purpose |
|---|---|---|
| `lib/ai/pricing-research/decimal.ts` | create | Exact decimal-string arithmetic on `BigInt` (parse, compare, per-1M to per-token and back, halve for derived cached input, gap in basis points, float-literal to plain decimal for the in-code tables). No dependency (O-11) |
| `lib/ai/pricing-research/officialSources.ts` | create | Provider to official host allow-list (config data, not model names; RR-1). Exact host match |
| `lib/ai/pricing-research/bounds.ts` | create | Named constants: ceiling $1,000 per 1M tokens, $5 per image; large move 50% (RR-1) |
| `lib/ai/pricing-research/pendingLineSchema.ts` | create | **The one Zod schema** for manual entry and, in slice 5, parser output: discriminated on `kind`; prices `z.string().regex(R-1)` (a JS number is refused); `source_url` https on the allow-list; `checked_on` ISO date, not in the future; provider from the provider factory's provider ids; model id format |
| `lib/ai/pricing-research/lineFlags.ts` | create | Pure. **Hard refusals** (line not stored): zero or negative (output 0 only when `isInputOnlyPricedModel`), above ceiling, duplicate unit. **Blocking flags** (override needed at apply, slice 8): `large_move` (> 50% either way vs current). **Informational:** `new_model` (outside coverage, O-6), `above_conservative_rate`, `fallback_differs`, `cached_input_listed`. Slice 5 adds `cross_check_differs`, `cross_check_unavailable`, `retiring` |
| `lib/ai/pricing-research/coverageColour.ts` | create | Pure RR-4 rules, §4 |
| `lib/ai/pricing-research/areaTags.ts` | create | RR-3, §4 |
| `lib/ai/pricing-research/comparisonModel.ts` | create | Assembles the read model from the repositories, the resolver and the pure modules |
| `lib/repositories/AiPriceProposalRepository.ts` | create | `submitPending(input)` via `.rpc('ai_price_submit_pending', …)` (prices passed as strings); `listPendingLines()` (exact `::text` casts). No `.update()`/`.delete()` method at all; header documents the no-owner exemption and the admin-only caller class |
| `lib/repositories/AiModelPricingRepository.ts` | modify (additive) | `listActiveExact()`: same filter and order as `listActive()`, cost columns as `::text`. `listActive()` untouched; header caller list gains the new admin route (O-10) |
| `lib/repositories/types.ts`, `index.ts` | modify | Types and exports |
| `app/api/admin/model-pricing/manual-entries/route.ts` | create | `POST`. `runtime = 'nodejs'`. `requireAdmin` first; body `{ lines: [1..50] }` through the shared schema; exact current read; flags; hard refusals answer **422 with every problem per line, nothing stored** (O-7); RPC; `logAndFlush` of `AI_PRICE_MANUAL_ENTRY`; 200 `{ proposalId, lines: [{ id, flags, supersededLineId }] }`. RPC 23505 (concurrent submit on the same unit) is 409; 42501 is 403 |
| `app/api/admin/model-pricing/comparison/route.ts` | create | `GET`. `requireAdmin` first; strict empty query schema (400 on unknown params); returns §4. No audit (read) |
| `lib/audit/events.ts`, `eventAudience.ts` | modify | Register `AI_PRICE_MANUAL_ENTRY`: severity `info`, SOC2, audience `shared` (as `AI_PRICING_*`). Entity type `ai_pricing` (registered), entity id = proposal id. Details: proposal id, line ids, provider, model, unit, per-1M strings, source URL, checked date, flags, superseded ids, `correlationId`. `AI_PRICE_FETCH_RUN` is registered in slice 5 with its writer (O-14) |
| `lib/services/EmbeddingService.ts` | **not edited** (O-9 not approved, C-6) | When `helpbot_embedding_model` is absent the read model shows "not set (service default applies)" with no tag |

**C-12:** the manual-entry body is strict Zod and carries no admin id, `created_by`, state or snapshot. The admin id comes from `requireAdmin`; the snapshot from the server's exact read. **O-14:** the audit details also carry `entity_kind: 'price_proposal'`, so the entity id is never read as a price row id. **O-15:** RPC 42501 becomes 403 with a plain message and a warn log.

Logging: `createLogger({ module: 'ModelPricingManualEntryAPI' })` / `'ModelPricingComparisonAPI'`, child with `correlationId`; errors as `{ err }`; no price page body or request body logged in full (line count, models, outcome).

---

## 4. Read model (current vs pending)

**Rows:** the coverage set (SA finding 9, computed, never typed: active DB rows ∪ `inCodeTokenPrices()` ∪ the resolved and default model of every catalogued call from `validateAreaRow` ∪ the `helpbot_embedding_model` setting ∪ the image config model and every image price key in the setting and the fallback) ∪ every model with a pending line.

**Current per unit** (exact strings):

| Unit | Current | `basis` |
|---|---|---|
| input, output | Newest active row (`listActiveExact()`, same rule as `listActive()`), else the in-code table, else none | `table` / `in_code_fallback` / `unpriced` |
| cached input | OpenAI: half the current input (the rule in `openaiProvider.ts`), labelled "derived". Other providers: none, so "not compared" (O-8: `anthropicProvider.ts` never reads cache-read tokens) | `derived` |
| image (size, quality) | `resolveImagePrice()` over `getImageGenerationConfig().pricesUsd`, then `IMAGE_FALLBACK_PRICING`, called **only for keys present in the setting or the fallback** (C-7: it logs an error "recording $0" otherwise); a key in neither is `unpriced` without the call | `image_setting` / `in_code_fallback` / `unpriced` |

**Colour per unit (RR-4):** colour comes from the **exact sign** of (current − new) (C-8); the gap = (current − new) ÷ new in basis points, rounded half away from zero, is used only for display and sorting. Green when ≥ 0 ("no change" when equal, "we charge X% above provider" when above, BQ-3); red when < 0 ("undercharging −X%"); grey "not compared" when one side is missing; a Business OS model with no current price is red "not priced". Provider price 0 (input-only output): equal is green "no change", current above 0 is green with no %.

**Row:** red if any compared unit is red; green only when every compared unit is green; grey when nothing compares. `redUnits` lists them and `summary` names them in text ("Undercharging: output −12%"), so colour is never the only signal (MP-NFR-8). `gapBasisPoints` per unit lets the list sort by gap.

**Area tags (RR-3):** for each `BOS_LLM_AREAS` area, `systemConfigRepository.getByKeys()` then `validateAreaRow(area, row)`, as `adminSettingsView.ts` does; each settings call's **resolved** model (resolved-first, so a rejected stored value tags the model actually used) is tagged with its area, with `enabled`. Embeddings: the `helpbot_embedding_model` setting, tagged "embeddings (chat)"; when absent, "not set (service default applies)" and no tag (C-6). Images: the images area's resolved model. A model nothing resolves to: "not used by Business OS". Tags describe today's settings.

**Pending:** the newest pending line per unit, with id, proposal id, source URL, checked date, flags, created by (admin email through `AdminUserRepository`), created at, and "cross-check not run" in slice 3.

---

## 5. Tests and CI

| Suite (new unless stated) | Covers |
|---|---|
| `supabase/migrations/__tests__/ai-model-pricing-slice3.migration.test.ts` | Paste safety for migration, rollback, checker and probe (§2.6, "into" only as the two `INSERT INTO` pairs); one BEGIN/COMMIT with `lock_timeout` first; every REVOKE per role on its own line before every GRANT; exact grant set (incl. the six UPDATE columns, no DELETE/TRUNCATE/REFERENCES/TRIGGER, nothing to anon or PUBLIC); RLS and the one admin policy per table; function `SECURITY INVOKER`, `SET search_path = ''`, EXECUTE to service_role only and revokes after CREATE; **the function body never names `ai_model_pricing` or `ai_model_image_pricing`**; **the only statements naming them are the four FKs and two indexes**; no `numeric(`; the R-1 regex in the CHECK equals the Zod regex (both pinned to one constant); checker read-only and naming the same objects; rollback guard present; probe ends in an exception (if O-12 approves) |
| `lib/ai/pricing-research/__tests__/decimal.test.ts` | `0.075` per 1M is `0.000000075` per token exactly; 9-decimal and 6-integer-digit edges; compare and gap exact at equality (the float trap `0.15` vs `0.00000015 × 1e6`); float literal `1.5e-7` to `0.00000015` |
| `…/pendingLineSchema.test.ts` | A JS number refused; 10 decimals refused; http, unlisted host, look-alike host refused; future date refused; image needs size and quality |
| `…/lineFlags.test.ts` | Each refusal and flag with a negative control; output 0 allowed only for input-only models |
| `…/coverageColour.test.ts` | Every RR-4 case: equal, above, below, one-sided, unpriced BOS model, derived cached, provider 0, worst unit wins, red units named |
| `…/areaTags.test.ts`, `…/comparisonModel.test.ts` | Mocked resolver and repositories: resolved-first tag, rejected stored value, switched-off area, embeddings setting, images, not used; coverage union; model names built in the test (no literals, in case the file falls in the bos-llm literal scope) |
| `lib/repositories/__tests__/AiPriceProposalRepository.test.ts` | RPC name and parameters (prices stay strings), error mapping, `listPendingLines` select text casts; no write method exists |
| `lib/repositories/__tests__/AiModelPricingRepository.test.ts` (modify: **add** cases only) | `listActiveExact` filter, order, `::text` select; existing cases unedited |
| `app/api/admin/model-pricing/manual-entries/__tests__/route.test.ts` | 401 and 403 with `request.json` never called (gate first); 400 invalid body; 422 refusals with nothing submitted; 409 on 23505; 200 happy with `logAndFlush` called once with `AI_PRICE_MANUAL_ENTRY` before the response; flush failure still 200; no internal detail outside development |
| `app/api/admin/model-pricing/comparison/__tests__/route.test.ts` | 401, 403, 400 unknown query param, 200 shape |
| `lib/audit/__tests__/eventAudience.test.ts` (modify) | Count pins +1 registered, +1 shared, with the dated comment line |
| `lib/ai/pricing-research/__tests__/chargingUntouched.guard.test.ts` | **Charging proof (source level):** the new modules import from `pricing.ts` and `chargePricing.ts` only the named read exports; no file in the slice calls `.insert`/`.update`/`.upsert`/`.delete` with `ai_model_pricing` or `ai_model_image_pricing`; the new repository has no `.update(` |

**Charging untouched, the full proof:** (1) the guard above; (2) `git diff origin/main --stat -- lib/ai/pricing.ts lib/business-os/llm/chargePricing.ts lib/ai/providers lib/services/GeneratedImageService.ts lib/repositories/SystemConfigRepository.ts lib/services/EmbeddingService.ts lib/business-os/llm/modelSettings.ts` is empty (C-6) (QA records it); (3) existing pricing suites pass unedited; (4) on production, checker V-5 and V-6 (no live row changed, fingerprint equal to F0).

**Commands** (worktree root, shared `node_modules`, no install):

```bash
npx jest supabase/migrations/__tests__/ai-model-pricing-slice3 lib/ai/pricing-research app/api/admin/model-pricing --ci
npx jest lib/repositories/__tests__/AiModelPricingRepository.test.ts lib/repositories/__tests__/AiPriceProposalRepository.test.ts lib/audit/__tests__ lib/ai app/api/admin/system-config --ci
npm run test:bos-entitlements
npm run test:authz-guard
npm run typecheck:bos-llm && npm run check:bos-llm-literals && npm run test:bos-llm
npm run lint
```

**Required CI subsets touched:** Tests (`test:gate`, every new suite), BOS entitlements (`test:bos-entitlements`: `supabase/migrations/__tests__`, `lib/repositories/__tests__`, `lib/audit/__tests__`), Admin authz surface guard (`test:authz-guard`, the two new routes), BOS LLM type-check (if `areaTags.ts` importing the catalogue pulls the new files in scope), Build. All new tests are pure, no network, no database, milliseconds: **no added CI time, no new job, no `package.json` change**.

---

## 6. Order of operations on production

**U** = the user (Supabase SQL editor, each step in a new tab). **TL/RM/SA/QA/D** = agents.

| # | Who | Step | Expected |
|---|---|---|---|
| 1 | D, SA, QA | Code review, tests, then **the user sees the diff**; RM commits and opens the PR | |
| 2 | **U** | U-1 (read-only): run the checker before the migration; note its fingerprint as F0 and its active and retired counts (C-5) | The fingerprint and count rows; the table and function rows FAIL because nothing exists yet |
| 3 | **U** | U-2: run the migration (only with the user's explicit OK) | `Success. No rows returned`. If it fails, nothing changed (one transaction) |
| 4 | **U** | U-3: run the checker | Every row `PASS`; V-6 fingerprint **equals F0**; V-5 counts equal U-1's. If a later write step says "read-only transaction", run `SET default_transaction_read_only = off;` on its own first |
| 5 | **U** (optional, O-12) | U-4: run the write probe | Ends with `PROBE PASS … this error is expected and rolls everything back` |
| 6 | RM | Merge after the apply. Code deployed before the apply is safe: the new routes would answer 500 until the tables exist, and no page calls them yet | |
| 7 | **U** | U-5: signed in as admin, open `/api/admin/model-pricing/comparison` in the browser | JSON: every covered model, current prices, area tags, no pending lines, grey rows |
| 8 | D | Record steps 2 to 7 here and in the requirement | |

A manual entry on production is not needed to finish slice 3 (the probe proves the write path). Rollback: the rollback file, then re-run the checker's V-5 and V-6.

---

## 7. Docs

| Doc | Change |
|---|---|
| [ADMIN_IDENTIFICATION_AND_ACCESS.md](/docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md) | Two register rows (`model-pricing/manual-entries` POST, `model-pricing/comparison` GET), `requireAdmin` first statement. Row numbers and totals **re-derived from disk at T-11** (C-9), not assumed; Change History row. The CI guard scans the filesystem, so `test:authz-guard` is run to confirm no cap moves |
| [AI_MODEL_PRICE_REVIEW_REQUIREMENT.md](/docs/requirements/AI_MODEL_PRICE_REVIEW_REQUIREMENT.md) | Status line and R-9 row 3 ("workplan written", later PR and apply); Change History. Ships in the same PR with the 2026-10-14 feedback already in the worktree |
| Audit registry | `lib/audit/events.ts` and `eventAudience.ts` are the registry (no separate doc found; Dev re-checks `docs/` for an event list at T-11) |
| `AiModelPricingRepository.ts` header | Caller list gains the comparison and manual-entry routes (class 1, admin) |

Targeted edits only; `git diff --stat` after each (deletion without insertion is a stop).

---

## 8. Risks and rollback

| # | Risk | Mitigation |
|---|---|---|
| RK-1 | A charge changes | No live row is written; FK and index locks block writes only, for milliseconds, and charging only reads (with a 1 h cache); `lock_timeout = '5s'`. Proven by §5's four-part proof |
| RK-2 | A float slips in and a price is stored or compared rounded | Strings end to end: Zod refuses numbers; SQL converts; reads use `::text`; comparisons in `decimal.ts`; 0.075 tests and the equality trap test |
| RK-3 | The editor misreads "into" | Only the keyword pair `INSERT INTO public.ai_price_…`, as in `20261017`; pinned by the test (O-1) |
| RK-4 | Migration number collides with the DB exposure stream | `20261066`, RM re-confirms at commit (O-17) |
| RK-5 | Area tags disagree with what calls really use | The same resolver as `/admin/business-os-llm`, resolved-first; labelled as today's settings |
| RK-6 | Sync (alive until slice 6) changes a current price after a pending line was stored | The read model computes current live on every load, so the colour stays true; the stored snapshot is only for history and slice 8's stale check |
| RK-7 | A wrong manual price | It is pending only; nothing charges it; apply needs a click, flags and (for a > 50% move) an override reason in slice 8 |
| RK-8 | Two admins submit for the same unit at once | Advisory lock per unit key; the partial unique index is the backstop (23505 becomes 409) |
| RK-9 | State changed outside the RPC (service_role holds the column UPDATE grant) | The repository has no update method (guarded); content columns are not updatable at all; the shape CHECK refuses an incoherent state |
| RK-10 | New files enter the bos-llm type-check and literal-check scope | Run both locally; tests build model names instead of writing literals |
| RK-11 | Rollback after use drops pending lines | Only possible while no live row references them (guard); manual entries remain in `audit_trail` (O-13) |
| RK-12 | Process hazards: shared `node_modules`, shared stash list, Tailwind scan of this MD | No install, no stash, no `worktree remove --force`; no backslash anywhere in this file |

---

## 9. Open questions for SA

| # | Question | Dev recommendation |
|---|---|---|
| O-1 | "into" in the migration: allow exactly the keyword pair `INSERT INTO public.ai_price_proposals` / `_lines` in the function body (no SELECT/RETURNING INTO, no literal, comment or identifier)? | Yes: Postgres needs it; `20261017` precedent; the test pins the exact two occurrences |
| O-2 | Conversion: `string::numeric * 0.000001` (exact multiplication) rather than R-1's `/ 1000000` (division picks a result scale)? And store the per-token numerics as **generated columns** from the strings, or set them in the RPC? | Multiply; generated columns (the database cannot hold a string and a number that disagree) |
| O-3 | RR-1 pins "the submit RPC never names the live tables", so the submit cannot re-check the snapshot. Accept a server-supplied snapshot, with the stale check only at apply (slice 8)? | Yes |
| O-4 | Grant UPDATE on all six decision columns now (one state definition), or only the supersede columns now and the rest in slice 8? | All six now; slice 8 needs a migration anyway, but not for this |
| O-5 | Flag CHECK holds slice-5 flags now? | Yes, avoids an ALTER of a money-path table later |
| O-6 | Manual entry for a model outside the coverage set (for example a replacement image model, BQ-1): allow with informational `new_model`, or refuse? | Allow; see the business question below |
| O-7 | Manual entry with any hard refusal: refuse the whole request (422, nothing stored) or store the valid lines? | Refuse the whole request; the admin fixes and resubmits. The fetch (slice 5) stores valid lines and lists problems, per RR-1 |
| O-8 | Current cached input for non-OpenAI providers: "not compared", since `anthropicProvider.ts` never reads cache-read tokens (a charging question for a later slice, not this one; no BOS area uses Anthropic)? | "Not compared", and TL logs the Anthropic cache-read finding separately |
| O-9 | Embedding model when `helpbot_embedding_model` is absent: export `EmbeddingService`'s existing default as a named constant (no behaviour change), or show "not set"? | Export the constant |
| O-10 | Add `listActiveExact()` to `AiModelPricingRepository` (additive; `listActive()` and its tests untouched)? | Yes, one repository per table |
| O-11 | A small `BigInt` decimal helper (new utility, CLAUDE.md rule 7) instead of a dependency? | Yes |
| O-12 | Ship the rolled-back write probe as an optional user step (credit-lots precedent), in addition to the read-only checker? | Yes, optional: it is the only end-to-end proof of R-1's 0.075 test on the real database |
| O-13 | Rollback drops pending lines if no live row references them? | Yes |
| O-14 | Register only `AI_PRICE_MANUAL_ENTRY` now; `AI_PRICE_FETCH_RUN` with its writer in slice 5? Entity type `ai_pricing`, audience `shared`, severity `info`? | Yes |
| O-15 | RPC admin check by `user_id` only (bound by `requireAdmin` beforehand)? | Yes |
| O-16 | All new pure modules under `lib/ai/pricing-research/` (RR-8), including the comparison model? | Yes, one home for the feature |
| O-17 | Migration number `20261066` | RM confirms at commit |

**Business-only question (for TL to put to the user in plain words):** may an admin record a provider price for a model Business OS does not use yet (for example the model that will replace `gpt-image-1`)? It stays pending and changes nothing until someone applies it. Recommendation: yes, shown with a "not used yet" label.

**Decided by the user 2026-10-14: yes.** Such a line carries the `new_model` flag, is labelled "not used yet", stays pending and changes nothing until applied.

**SA rulings applied (2026-10-14).** O-1 to O-3, O-5 to O-8, O-10 to O-17 approved as recommended; O-4 narrowed with a trigger (C-1, C-2); O-9 not approved (C-6). C-1 to C-13 are folded into §2 to §7 above.

---

## 10. Task list

- [x] ✅ T-0: SA approves this workplan; `git branch --show-current` = `feature/ai-model-price-review-slice3`
- [x] ✅ T-1: Confirm the as-built details §4 depends on: settings calls vs excluded embedding calls in `validateAreaRow`; provider ids export; `IMAGE_PRICE_REQUIRED_QUALITIES` and image sizes
- [x] ✅ T-2: Migration, rollback, checker (and probe if O-12) (§2)
- [x] ✅ T-3: Migration source test (§5)
- [x] ✅ T-4: `decimal.ts`, `officialSources.ts`, `bounds.ts`, `pendingLineSchema.ts` with tests
- [x] ✅ T-5: `lineFlags.ts` with tests
- [x] ✅ T-6: `AiPriceProposalRepository`, `listActiveExact()`, types, index, with tests
- [x] ✅ T-7: `coverageColour.ts`, `areaTags.ts`, `comparisonModel.ts` with tests (O-9 not approved: no `EmbeddingService` edit)
- [x] ✅ T-8: Audit event registration and count pins
- [x] ✅ T-9: The two routes with tests
- [x] ✅ T-10: Charging-untouched guard; the `git diff` check of the charging files
- [x] ✅ T-11: Docs (§7); `git diff --stat` after each
- [x] ✅ T-12: Run §5 commands; hand to SA for code review. Leave everything uncommitted
- [ ] T-13: After SA, QA and the user's approval: user steps U-1 to U-5 (§6), recorded here

### 10.1 Deviations from the approved workplan (SA rules at code review)

| # | Deviation | Why |
|---|---|---|
| D-1 | Step U-1 runs the **checker** before the migration (not slice 2's C-3), so F0 and the counts come from the same expression U-3 prints. The checker reaches the new tables only through the catalogue (`to_regclass`, `to_regprocedure`, `has_table_privilege`), so it parses before they exist; its table and function rows FAIL at U-1 by design. Its fingerprint has no alias exclusion list (the aliases were retired in slice 2), so it holds no model literal | One expression for before and after; no model names in a pasted file |
| D-2 | Two register rows were added for handlers already on main without a row (`business-os/finance#GET`, `business-os/test/take-credits#POST`, both `requireAdmin` first) | C-9: the census is re-derived from disk; 102 handlers on `799f8018`, 100 registered |
| D-3 | A red unit whose gap rounds to 0 basis points reads "under 0.01%", never "0.0%" | C-8 keeps the exact sign for colour; this keeps the text from saying "no change" beside a red unit |
| D-4 | Manual entry also refuses (422) the same model and unit twice in one request, before any read | One pending line per unit; the RPC refuses it too (22023) |
| D-5 | The probe's skip message says `SET default_transaction_read_only TO off` (not `= off`) | Keeps every probe literal inside the paste-safety character set |
| D-6 | The migration test spells word boundaries as lookarounds instead of a backslash escape | No backslash followed by a hex letter in any new file (Tailwind scan hazard, PR #180) |
| D-7 | The comparison treats an image model known only from a price key (no area, no pending line) as provider unknown (`provider: null`) | Image prices are keyed by model, size and quality, without a provider; no provider is guessed |

---

## SA Review Notes

**Reviewed by SA, 2026-10-14**, on `feature/ai-model-price-review-slice3` at `799f8018` (origin/main after `git fetch`).
**Status:** ✅ Approved WITH CHANGES. Implementation may start once C-1 to C-13 below are folded into the plan; no second workplan review is needed, SA checks them at code review.

### What SA measured (read-only)

| Check | Result |
|---|---|
| Migration numbers | origin/main holds up to `20261060`; `20261059` and `20261060` are now **merged** (§2's "unmerged" note is stale). No `20261061+` file on any remote ref, any local ref, or any worktree's `supabase/migrations`. The DB exposure stream has reserved `20261061+` for its full slice 2c (count not fixed). **`20261066` stands**; RM re-checks at commit |
| `ai_model_pricing` names | 54 rows (42 active + 12 retired is consistent), providers `openai`, `anthropic`, `google`, `kimi`; every `provider` and `model_name` fits the lowercase letters, digits, dots and hyphens format CHECK |
| `ai_price_proposals` | 42P01, absent |
| Settings | `helpbot_embedding_model` is set on production; `image_generation_prices_usd` is **absent**, so today's current image price is `IMAGE_FALLBACK_PRICING` |
| Existing decimal helper | None in `lib/` (no `BigInt` use, no decimal library in `package.json`) |
| Admin RPC check | `service_role` reads `admin_users` (full-access policy, `20260701`); `AdminAccessService` binds `user_id` on an email match before the route body runs |
| Audit pins | `eventAudience.test.ts`: 199 registered, 61 shared today; entity type `ai_pricing` registered |
| Admin route files | 72 `route.ts` under `app/api/admin` today, against the doc's census of 70 files / 100 handlers on 2026-10-09: the doc totals have moved since |
| Anthropic cache read | `anthropicProvider.ts` has no `cache_read` handling: the O-8 finding is real (TL logs it separately) |

### Rulings on the open questions

| # | Ruling |
|---|---|
| O-1 | **Approved.** The editor problem is "into" inside a string literal; the keyword in statements has been applied by hand before (`20261017`). Test pin: case-insensitive `into` occurs exactly twice in the migration, each as `INSERT INTO public.ai_price_proposals` / `INSERT INTO public.ai_price_proposal_lines`; zero times in rollback, checker and probe; never in a literal, comment, `RAISE` or identifier |
| O-2 | **Approved: multiply, generated columns.** `string::numeric * 0.000001` is exact (result scale is the sum of the scales); division picks a scale. Generated `STORED` columns make string and number unable to disagree (precedent `20260826`). The RPC then inserts strings only |
| O-3 | **Approved.** The snapshot is history; slice 8's stale check compares it with the live row, and a wrong snapshot can only make apply abort (safe direction). Slice 8 must define the stale check per `basis` (derived and setting-based current values are not table rows) |
| O-4 | **Column grant, narrowed, plus a transition trigger (C-1, C-2).** With `SECURITY INVOKER` called as `service_role`, the RPC itself needs the UPDATE privilege, so "RPC-only" in the strict sense would need `SECURITY DEFINER`, which the R-2 precedent and the SECDEF lockdown both steer away from, and the protected principal is the same `service_role` either way. The safer shape is: the smallest column grant slice 3 needs, and the state machine enforced in the database by a trigger, so a stray `service_role` write cannot reopen or re-apply a line whichever path it takes. The RPC path also avoids the repo's PostgREST `update` + `or` + `select` 42703 bug; the repository keeps no update method (guarded) |
| O-5 | **Approved**, together with the cross-check columns, `provider_outcomes` and `source_kind = 'fetch'`: schema only, it avoids an ALTER on a money-path table in slice 5. No slice-5 code |
| O-6 | **Allow with informational `new_model`**, provider on the allow-list and model id format still enforced. The RR-1 "coverage set only" rule is for fetched lines. Business confirmation below |
| O-7 | **Approved.** Whole request refused (422, every problem per line, nothing stored) |
| O-8 | **Approved:** "not compared" for non-OpenAI cached input. TL logs the Anthropic cache-read finding as a separate charging item |
| O-9 | **Not approved: do not edit `EmbeddingService.ts` in slice 3 (C-6).** The setting is present on production; when absent, show "not set (service default applies)" with no tag. Slice 7 rewires `EmbeddingService` anyway and can export the default then. This keeps every billed service out of this diff |
| O-10 | **Approved.** Additive; `listActive()` body and tests unchanged (QA inspects the hunk); not cached; header caller list updated |
| O-11 | **Approved** (no existing util, no dependency). Rules in C-8 |
| O-12 | **Approved**, optional user step, following `scripts/probe-bos-credit-lots-migration.sql` (C-11) |
| O-13 | **Approved** |
| O-14 | **Approved:** `AI_PRICE_MANUAL_ENTRY`, `info`, SOC2, `shared`, entity `ai_pricing`, entity id the proposal id; put `entity_kind: 'price_proposal'` in details so it is never read as a price row id. Pins per C-10 |
| O-15 | **Approved:** `user_id` only, bound by `requireAdmin`. An admin admitted only through the `ADMIN_EMAILS` fallback (no DB row) gets 42501 from the RPC: map it to 403 with a plain message and a warn log (fail closed is right) |
| O-16 | **Approved** |
| O-17 | **`20261066` approved** (measured above). RM re-checks origin/main and every remote branch at commit and leaves `20261061+` for the DB exposure stream |

### Required changes

1. **C-1 Grants.** `service_role` on lines: `SELECT, INSERT, UPDATE (state, decided_by, decided_at, superseded_by)` only. `decision_reason` and `override_reason` are granted by slice 8 with its RPCs, so `applied` and `dismissed` are unreachable before slice 8. Supersede sets `decided_by` to the submitting admin. Checker V-2 and the source test follow.
2. **C-2 Transition trigger.** `BEFORE UPDATE` on `ai_price_proposal_lines`: raise unless `OLD.state = 'pending'` and `NEW.state` is `superseded`, `applied` or `dismissed` (terminal states are final; "applied at most once" holds whatever the caller). Function `SECURITY INVOKER`, `SET search_path = ''`, EXECUTE revoked from PUBLIC, anon and authenticated after the CREATE; never names the live tables. Pinned in the source test; the probe asserts a direct `superseded` to `pending` update fails.
3. **C-3 CHECK tightening.** `superseded` also requires `decision_reason` and `override_reason` NULL. Defence in depth on a money path: generated `input_cost_per_token > 0` for token lines, `cost_per_image > 0` for image lines, `cached_input_cost_per_token > 0` when present; output may be 0 (input-only models; the TS rule decides which).
4. **C-4 Lock order and rollback locks.** The four FKs and two indexes on the live tables go **last** in the migration, so their SHARE ROW EXCLUSIVE / SHARE locks (writes blocked, reads not) are held only until COMMIT. The rollback gets `SET LOCAL lock_timeout = '2s'` first, and §2.7 states that `DROP CONSTRAINT` and `DROP INDEX` take ACCESS EXCLUSIVE on `ai_model_pricing` (they block reads for milliseconds; if the lock is not had within 2 s the rollback aborts with nothing changed).
5. **C-5 Checker V-5.** Do not hard-code 42 / 12 as the pass rule: Sync is alive until slice 6 and can add rows. U-1 captures the counts with F0; the checker prints them; PASS needs zero non-NULL `proposal_id` rows, and the user compares counts and fingerprint with U-1.
6. **C-6 No `EmbeddingService.ts` edit** (O-9). Add `lib/services/EmbeddingService.ts` and `lib/business-os/llm/modelSettings.ts` to the §5 "charging untouched" `git diff` list.
7. **C-7 Image current price.** `resolveImagePrice()` logs an error "recording $0" on an unpriced key. Call it only for keys present in the setting or the fallback; a configured model, size and quality with no key anywhere is "unpriced" without calling it.
8. **C-8 `decimal.ts`.** Per-1M to per-token and back by a scale shift on `BigInt`, no division. Colour comes from the exact sign of (current minus new), never from the rounded basis points; the bps rounding rule is stated and used only for display and sorting. Float-literal conversion uses the shortest round-trip form and is tested on every in-code fallback value.
9. **C-9 Admin authz doc.** Re-derive the handler census from disk at T-11 (72 route files today); row numbers and totals from that measurement, not the assumed 104/105 and 100 to 102. Both handlers: `requireAdmin` first statement; route tests prove 401/403 before any body or query is read.
10. **C-10 Audit pins.** Measure at T-8 (199 to 200, shared 61 to 62 today) and re-run `lib/audit/__tests__` after rebasing on origin/main right before the PR: parallel branches add events (semantic-merge hazard, PR #232 precedent). RM note.
11. **C-11 Probe.** As the credit-lots probe: `SET LOCAL ROLE service_role` inside the block, the admin id read from an active `admin_users` row (no pasted or literal uuid), no "into", always raises.
12. **C-12 Manual-entry body.** Strict Zod; the body carries no admin id, `created_by`, state or snapshot: the admin id comes from `requireAdmin`, the snapshot from the server's exact read.
13. **C-13 §2 text.** Correct the migration-number note (`20261059` and `20261060` are on main).

### Confirmed (no change)

- Scope is proportionate to R-9 row 3; no UI; no slice 4, 5 or 8 code. Schema-only forward columns (O-5) are the approved exception.
- RR-2: content insert-only by privilege; one-pending-per-unit partial unique index; supersede under a per-unit advisory lock taken in unit-key order (no deadlock between multi-line submits; the index is the backstop, 23505 to 409); the deferred self-FK is the right way to supersede before the insert.
- Provenance FKs: SHARE ROW EXCLUSIVE does not conflict with the ACCESS SHARE that charging reads take; a queued ALTER does not queue readers; `lock_timeout = '5s'`; validation scans 54 rows. MATCH SIMPLE plus slice 2's `provenance_paired` CHECK is correct.
- `tenant-isolation-guard`: not applicable, reasoning confirmed (platform-wide rows, no owner column, admin-only routes, no caller-supplied row id). Slice 8 (line ids from the client) must revisit it.
- `created_by` without an FK to `auth.users` is right (account-delete hazard); the read shows "former admin" when the email lookup finds nothing.
- RR-3 through `systemConfigRepository.getByKeys()` and `validateAreaRow`, resolved-first; no model literal in code; `areaTags.ts` imports the catalogue so it enters the bos-llm literal and type-check scope: run both, as planned.
- Tests: all pure, inside existing jobs (`test:gate`, BOS entitlements subsets, `test:authz-guard`); no new job, no `package.json` change, no added CI time. The new function is `SECURITY INVOKER`, outside the SECDEF surface guard.
- Production order is right: fingerprint, migration (user's explicit OK, pasted by the user), checker, optional probe, merge, browser read.

### Optimisation suggestions (not blocking)

- `export const dynamic = 'force-dynamic'` on the comparison GET.
- Label current token prices "stored price; charges pick a change up within 1 h" (the reader caches).
- `checked_on` "not in the future": compare with the UTC date plus one day, so an admin in Israel entering today's date after midnight is not refused.
- The unit-key string fed to the advisory lock uses a separator that cannot occur in a model id.

### Business question for the user (via TL)

Same as the Dev's: may an admin record a provider price for a model Business OS does not use yet (for example the `gpt-image-1` replacement)? It stays pending and changes no charge until someone applies it. SA recommends yes, labelled "not used yet".

### Approval

- [x] Workplan approved with changes C-1 to C-13; proceed to implementation. SA verifies them at code review.

### SA Code Review

**Code Review by SA, 2026-10-14**, worktree `neuronforge-model-pricing-s3`, uncommitted, base `799f8018` (origin/main is now `096f86e0`).
**Status:** 🔄 Fix Required: three small fixes (CR-1 to CR-3). None touches charging, the migration or the routes' gate. SA re-checks only those hunks, with no second full review.

**What SA ran (read-only):**

- The slice suites, the repository suites, `eventAudience` and the authz surface guard: 14 suites, 345 tests pass.
- `typecheck:bos-llm` passes with 0 new errors. `check:bos-llm-literals` passes with 0 violations.
- `tsc` over the slice files gives 0 errors. ESLint with `no-console` gives 0 findings.
- The charging files diff is empty against origin/main: `pricing.ts`, `chargePricing.ts`, `providers/`, `GeneratedImageService.ts`, `SystemConfigRepository.ts`, `EmbeddingService.ts`, `modelSettings.ts`, `modelSettingsPolicy.ts` and `callCatalog.ts`.
- The handler census from disk is 74 files and 104 handlers.
- No `20261061`+ migration exists on any remote branch.

#### Verified (no change)

| Area | Result |
|---|---|
| Migration `20261066`, mentally executed on Postgres 17 | ✅ Valid. **Generated columns:** `text::numeric * 0.000001` is immutable and exact (`0.075` gives `0.000000075`). They are computed before the CHECKs, so C-3 can use them. **Partial unique index:** the supersede UPDATE moves the old row out of the `pending` predicate before the INSERT. **Deferred self-FK:** it resolves at COMMIT. **Every name is qualified** under `search_path = ''`; `gen_random_uuid`, `hashtextextended` and `pg_advisory_xact_lock` are in `pg_catalog`. **Short-circuit:** `jsonb_typeof(...) <> 'array' OR ...` short-circuits in constant folding, and the other branch raises 22023 anyway. **RETURNS TABLE:** the out-variable names collide with no column |
| C-1 grants | ✅ REVOKE ALL is one role per line, all before the first GRANT. `authenticated` gets SELECT through the `is_platform_admin()` policy. `service_role` gets SELECT and INSERT, plus UPDATE on lines for `(state, decided_by, decided_at, superseded_by)` only. Nothing goes to anon or PUBLIC. There is no DELETE, TRUNCATE, REFERENCES or TRIGGER grant. This is the R-2 / `ai_model_image_pricing` shape |
| C-2 trigger | ✅ It is BEFORE UPDATE, INVOKER, with an empty search_path. EXECUTE is revoked from PUBLIC, anon and authenticated after the CREATE. It raises 23514 unless the move is pending to a terminal state, and it never names a live table. EXECUTE on a trigger function is checked at CREATE TRIGGER, not when it fires, so the revoke does not break the RPC |
| C-3 CHECKs | ✅ `superseded` carries no reasons. Input > 0 on token lines, output >= 0, cached > 0 when present, and image price > 0. Shape and format CHECKs mirror the Zod regexes |
| Submit function | ✅ It refuses NULL arguments (22004). It checks `admin_users` by `user_id` and `is_active` (42501). It takes 1 to 200 lines and refuses a duplicate unit key (22023). The proposal id is pre-generated. **Lock order:** the advisory lock is taken per unit in `ORDER BY unit_key`; the separator is `chr(124)`, which the model format CHECK cannot contain. Under READ COMMITTED the next statement sees the winner's line, and 23505 is the backstop. **Supersede and insert:** supersede comes before the insert, and the prices are inserted as text only. **Live tables:** they are never named (pinned) |
| Live-table FKs and indexes | ✅ They are the last six statements, under `lock_timeout = '5s'`. The FKs take SHARE ROW EXCLUSIVE and the indexes take SHARE: writes are blocked, charging reads are not. The composite FK plus slice 2's `provenance_paired` CHECK is correct. Column types match: `proposal_id` and `proposal_line_id` are uuid (`20261053`) |
| Paste safety | ✅ "into" appears only in the two pinned `INSERT INTO`. No comments, backslashes, non-ASCII characters or single-letter aliases. One BEGIN/COMMIT. The extra regex literals (provider, model, image size and quality) are named exceptions in the test |
| Rollback | ✅ `lock_timeout = '2s'` first. The guard runs before the drops, the drops run in reverse order, and there is no CASCADE |
| Checker (D-1) | ✅ It is read-only from its first line and reaches the new objects only through `to_regclass`, `to_regprocedure` and `has_*_privilege`, so it parses before the migration. At U-1 the table, function and index rows FAIL by design, and V-2 (table privileges) emits no rows. V-5 is PASS on zero `proposal_id` rows, and the counts are printed (C-5). V-6 is the fingerprint with no model literal |
| Probe (C-11) | ✅ One DO block. The admin id comes from `admin_users`. `SET LOCAL ROLE service_role` is used, with no uuid literal and no "into". **Checks:** P01 checks exactness, P02 and P03 the supersede, and P04 the trigger (it is caught as `check_violation`, which the trigger raises before the unique index is checked). P05 checks that a price UPDATE and a DELETE are refused (42501), and P06 that `authenticated` cannot EXECUTE. It always raises |
| `decimal.ts` (C-8) | ✅ **BigInt scale shift:** per-1M to per-token and back is a BigInt scale shift. `normalise` divides only by exact powers of 10; the only rounding is `gapBasisPoints`, which is used for display only. **Colour:** it comes from `compareDecimals`. **Floats:** they are read from their shortest round-trip form via `String(n)`. The exponent forms `1.5e-7` and `2e21` are tested, and every in-code token and image price round-trips (tested) |
| RR-4 / RR-3 / C-7 / C-6 | ✅ **RR-4:** the worst unit wins, red units are named in `summary`, and the colour comes from the exact sign. **RR-3:** area tags come from `systemConfigRepository.getByKeys` plus `validateAreaRow`, resolved first, with no model literal (the literal check passes). `EmbeddingService` is not edited: when the setting is missing, the view says "not set (service default applies)". **C-7:** `resolveImagePrice` is called only for a known key |
| Routes | ✅ **Gate:** the correlationId and child logger come first, then `requireAdmin`, as in the `system-config/pricing` precedent. `requireAdmin` never throws (fail closed). 401 and 403 come before the body or query is read (pinned). **Validation:** the body schema is strict Zod and carries no admin id, state or snapshot (C-12). **Answers:** 422 for refusals and for duplicate units (D-4); 409 for 23505; 403 for 42501 (O-15). **Audit:** `logAndFlush` with `entity_kind: 'price_proposal'`. Dev-only details. No direct Supabase call |
| Repository | ✅ `AiPriceProposalRepository` has the RPC and one SELECT, and no update or delete method. `listActiveExact` is additive; `listActive` is byte-unchanged (diff hunk plus guard). The PostgREST `::text` cast keeps the column key |
| Audit and authz docs | ✅ Pins are 200 registered and 62 shared, and origin/main added no audit event since the base. **D-2 census:** 104 handlers = 98 `requireAdmin` + 6 inline, in 74 files, measured. `finance/route.ts:118` and `take-credits/route.ts:83` both call `requireAdmin` first, and neither was registered before |
| Proportionality | ✅ No UI, no apply and no fetch. The slice-5 columns are schema only (O-5) |

#### Code Review Comments

1. **CR-1 `pendingLineSchema.ts` (`common.source_url`): Zod accepts URLs that the SQL CHECK refuses, so the admin gets a 500.** Priority: **Medium**.
   - **The problem:** `new URL()` trims spaces and lower-cases the scheme. Measured: `" https://developers.openai.com/api"`, `"HTTPS://developers.openai.com/api"` and `"https:developers.openai.com/api"` all pass the schema. The `left(source_url, 8) = 'https://'` CHECK then raises 23514, and the route answers 500 "could not be saved". A tab inside the URL also passes, and it is stored raw.
   - **Fix:** in the `superRefine`, also require `line.source_url.startsWith('https' + String.fromCharCode(58) + '//')` and that every character is printable ASCII with no space (`/^[!-~]+$/`: no backslash needed). Add these to `isOfficialSourceUrl` or beside it, with the message "Paste the full https address with no spaces".
   - **Tests:** add the four inputs above to `pendingLineSchema.test.ts` as refused, and add one route case showing a 400 (not a 500).
2. **CR-2 `coverageColour.ts` `formatGapPercent`: D-3 holds only at exactly 0 bps.** Priority: **Low**, but it is the stated purpose of D-3.
   - **The problem:** `toFixed(1)` prints a gap of 1 to 4 bps as "0.0%". A red unit 0.03% under reads "Undercharging: -0.0%".
   - **Fix:** print two decimals (`(Math.abs(bps) / 100).toFixed(2)`). bps can never be below 1 except at 0, which `gapText` already handles as "under 0.01%".
   - **Tests:** pin bps -1 as "-0.01%", bps -4 as "-0.04%" and -1200 as "-12.00%". Update the `formatGapPercent(0)` pin.
3. **CR-3 `chargingUntouched.guard.test.ts`: the guard does not cover the image price setting, which is a charging input.** Priority: **Low**.
   - **The problem:** `image_generation_prices_usd` is read by `resolveImagePrice`. The slice files import `systemConfigRepository`, which has write methods, and nothing pins which of them are called.
   - **Fix:** add a case that every `systemConfigRepository.<method>` in `SLICE_FILES` is `getByKeys` or `getImageGenerationConfig`, and every `adminUserRepository.<method>` is `listActive`. This mirrors the existing `aiModelPricingRepository` case.

#### Optimisation Suggestions (not blocking)

- **`imageCurrent` "known" test:** use "a finite number > 0 in the setting, or a key in the fallback" rather than `key in pricesUsd`. A configured 0 or a non-number with no fallback would otherwise still reach the resolver's "recording $0" error log.
- **"not used yet" (user decision):** the API returns the `new_model` code, and the row says "not used by Business OS", which is RR-3's area wording, a different fact. Add `NEW_MODEL_LABEL = 'not used yet'` beside `PENDING_LINE_FLAGS` now, or make it a named UI-slice item in the requirement. The user's wording must appear wherever the flag is shown.
- **§2.2 text:** `current_basis` lists `derived`, but the CHECK correctly omits it, because line-level basis is never derived. Correct the text. Slice 8 note: `current_cached_input_cost_per_token` is the derived OpenAI value even when `current_basis = 'table'`, so the stale check must re-derive it, not compare it with the table column.
- **Rollback, before slice 8 makes it reachable:** take `LOCK TABLE public.ai_model_pricing, public.ai_model_image_pricing IN SHARE ROW EXCLUSIVE MODE` before the guard. Without it, an apply cannot slip a row in between the guard and the drops. This is impossible today, so it is recorded for slice 8.
- **Checker V-4:** assert `indisunique` and a non-NULL `indpred` on `ai_price_proposal_lines_one_pending_key`, not just its presence.

#### Rulings on the deviations

| # | Ruling |
|---|---|
| D-1 | **Approved.** The same expression is used before and after the migration, and the catalogue-only access was verified. U-1's FAIL rows are expected; the user compares only V-5 (counts) and V-6 (fingerprint) |
| D-2 | **Approved.** Both rows were verified on disk (`requireAdmin` at line 118 and line 83), and the census of 104 = 98 + 6 + 0 in 74 files was re-measured |
| D-3 | **Approved in intent, incomplete:** see CR-2 |
| D-4 | **Approved.** It is the cheap refusal before any read, and the RPC's 22023 stays as the backstop |
| D-5 | **Approved** (`TO off` and `= off` are equivalent) |
| D-6 | **Approved.** No backslash-hex sequence exists in any new or changed file (grepped) |
| D-7 | **Approved.** Image price keys carry no provider, and guessing one would be a hidden literal |

#### Production apply order (confirmed)

1. CR-1 to CR-3 fixed. SA re-checks the hunks; QA tests. **Rebase on origin/main** (`096f86e0` touched `lib/repositories/types.ts`, which may conflict as text), then re-run `lib/audit/__tests__` and `test:authz-guard` (C-10). The user sees the diff, and RM re-confirms `20261066` and opens the PR.
2. **U-1:** run the checker (read-only) and record F0 (V-6) and the V-5 counts. Table, function and index rows FAIL by design.
3. **U-2:** apply the migration, only with the user's explicit OK, in a new tab. Expected: `Success. No rows returned`.
4. **U-3:** run the checker. Every row must PASS, V-6 must equal F0, and the V-5 counts must equal U-1's.
5. **U-4 (optional):** run the probe, in a new tab. It must end `PROBE PASS ... this error is expected and rolls everything back`.
6. **Merge,** then deploy.
7. **U-5:** as an admin, open `/api/admin/model-pricing/comparison`. Expected: grey rows and no pending lines. If PostgREST answers PGRST202 for the RPC later, its schema cache has not reloaded yet. Supabase's DDL watcher normally handles this.

**Rollback:** run the rollback file, then re-run the checker. V-5 and V-6 must match F0.

### Code Approved for QA: No. Yes once CR-1 to CR-3 are fixed (SA hunk check only)

## QA Testing Report

**QA, 2026-10-14**, worktree `neuronforge-model-pricing-s3`, uncommitted, base `799f8018` (origin/main is now `5e44871d`). Tested the code as SA reviewed it, **before** the CR-1 to CR-3 fixes.
**Test mode:** full
**Strategy used:** A (Jest unit and route tests, rerun); mutation checks on scratch copies through a Jest `moduleNameMapper` override (no worktree file touched); edge probes as scratch Jest tests; static analysis of the four SQL files (no local Postgres exists: no `psql`, `pg_ctl` or `postgres` on PATH, nothing installed); `git diff` for the charging files.
**Focus:** all (schema, api, security, pricing precision)
**Skipped:** live database (read or write) and browser check: forbidden for this pass; they are the user's steps U-1 to U-5. E2E: no UI in this slice.
**Input source:** prompt keywords (TL brief)

### Step 1: suite reruns (counts verbatim)

| Command | Suites | Tests | Result |
|---|---|---|---|
| New suites: `lib/ai/pricing-research`, `ai-model-pricing-slice3.migration`, both `model-pricing` route tests, both repository tests | 12 passed, 12 total | 205 passed, 205 total | ✅ |
| `npx jest supabase/migrations --ci` | 36 passed, 36 total | 1835 passed, 1835 total | ✅ |
| `npm run test:bos-entitlements` | 257 passed, 257 total | 7496 passed, 7496 total | ✅ |
| `npx jest lib/audit/__tests__ --ci` | 15 passed, 15 total | 180 passed, 180 total | ✅ |
| `npm run test:authz-guard` | 2 passed, 2 total | 203 passed, 203 total | ✅ |
| `npm run test:bos-llm` | 23 passed, 23 total | 625 passed, 625 total | ✅ |
| Tailwind escape guard (`app/__tests__/tailwind-css-escape.guard.test.ts`) | 1 passed, 1 total | 6 passed, 6 total | ✅ |
| Existing pricing suites: `lib/ai app/api/admin/system-config app/admin/system-config` (includes the 7 new `pricing-research` suites) | 20 passed, 20 total | 307 passed, 307 total | ✅ |
| `npm run typecheck:bos-llm` | 523 files in scope, 28 errors, **0 new** | | ✅ |
| `npm run check:bos-llm-literals` | 64 files in scope, 2 exempt, **0 violations** | | ✅ |
| ESLint over the slice files | 0 findings | | ✅ |

### Step 2: mutation checks (scratch copies; every mutant ran against the real tests)

| Mutant | Killed? | Tests that failed |
|---|---|---|
| `decimal.ts`: per 1M to per token **divides by a float** (`Number(x) / 1000000`) | ✅ Killed (2) | `decimal`: the float trap (0.121); `lineFlags`: large_move exactly at the boundary |
| `decimal.ts`: the conversion **rounds** (to 8 places) | ✅ Killed (4) | `decimal`: 0.075 exact, the R-1 extremes, the float trap; `lineFlags`: boundary |
| `decimal.ts`: `gapBasisPoints` truncates instead of rounding half away from zero | ✅ Killed (1) | `decimal` |
| `decimal.ts`: `compareDecimals` through `Number()` | Survived: **equivalent mutant** | Every R-1 value has at most 15 significant digits, and distinct decimals of 15 digits map to distinct doubles, so a float compare of the strings is correct in this domain. See Edge case E-3 |
| Colour rule `>` instead of `>=` (the equal case is no longer green) | ✅ Killed (6) | `coverageColour` (equal, provider 0, worst-unit rows) and `comparisonModel` (red and green rows) |
| Colour: D-3 "under 0.01%" branch removed | ✅ Killed (1) | `coverageColour`: the colour comes from the exact sign |
| Manual-entry route reads the body **before** `requireAdmin` | ✅ Killed (10 of 17) | Including "401 when signed out: the body is never read" and "403 when not an admin: the body is never read". Control run of the unmutated copy: 17 of 17 pass |
| Schema accepts `state` on a **line** | ✅ Killed (1) | `pendingLineSchema`: "takes lines only: no admin id, creator, state or snapshot" |
| Schema accepts `state` on the **body** | ✅ Killed (1) | Same test. Control run of the unmutated copy: 123 of 123 pass |
| Migration grants UPDATE on `decision_reason`, `override_reason` | ✅ Killed (1) | "grants exactly: authenticated SELECT, service_role SELECT and INSERT, plus four UPDATE columns on lines (C-1)" |
| Trigger allows `superseded` to `pending` | ✅ Killed (1) | "the transition trigger (C-2) refuses anything but pending to superseded, applied or dismissed" |

### Step 3: edge cases (`decimal.ts` and the comparison model)

| Case | Result |
|---|---|
| 0.075 per 1M | `0.000000075` per token, and back to `0.075` ✅ |
| 1e-9 | `"0.000000001"` per 1M gives `0.000000000000001` per token and back exactly; the float `1e-9` reads as `0.000000001` ✅ |
| Very large | `999999.999999999` per 1M round-trips exactly; `1e21` reads as the 22-digit integer; a 48-digit decimal formats unchanged; `parseDecimal('1e-9')` and `NaN` throw ✅ |
| Floats from `FALLBACK_PRICING` | All 99 values (every in-code token input and output, and every `IMAGE_FALLBACK_PRICING` entry) convert to a decimal that equals the original number ✅ |
| Equal prices | `0.6` vs `0.600`: green, `no_change`, "No change"; `0` vs `0`: green "No change" ✅ |
| Red unit whose gap rounds to 0 (D-3) | `0.6` vs `0.600000001`: red, "Undercharging: -under 0.01%" ✅. **But 1 to 4 bps under reads "Undercharging: -0.0%"** (`0.9999` vs `1`, `0.9996` vs `1`); 5 bps reads "-0.1%". Same defect as SA CR-2, reproduced |
| In use but unpriced | Red, "Not priced" on input and output; summary "Undercharging: input not priced, output not priced"; sorted first ✅ |
| `new_model` "not used yet" | The pending view carries `flags: ["new_model"]`, but the row's text is `usageLabel: "not used by Business OS"`; the string "not used yet" appears nowhere in the API. See E-1 (SA optimisation, same point) |
| Cached input outside OpenAI | An Anthropic line with `cached_input_per_1m` is grey "Not compared" with the `cached_input_listed` flag; input and output still compare ✅ |
| Creator no longer an admin | "former admin" ✅ |
| Source URL (re-measured SA CR-1) | `" https://…"`, `"HTTPS://…"` and `"https:developers…"` **pass Zod** but fail the SQL `left(source_url, 8)` CHECK (a 500). A tab inside the URL passes both and is stored raw. **Confirmed** |

### Step 4: static SQL verification

| Check | Migration | Rollback | Checker | Probe |
|---|---|---|---|---|
| `BEGIN` / `COMMIT` | 1 / 1 | 1 / 1 | 0 / 0 (read-only) | 0 / 0 (one DO) |
| `$tag$` balanced | `$line_transition$` 2, `$submit_pending$` 2 | `$rollback_guard$` 2 | none | `$probe$` 2 |
| "into" (any case) | Exactly 2, both `INSERT INTO public.ai_price_proposals` / `INSERT INTO public.ai_price_proposal_lines` | 0 | 0 | 0 |
| `--`, `/*`, backslash, non-ASCII, tab or CR | 0 | 0 | 0 | 0 |
| Single-letter aliases | 0 | 0 | 0 | 0 |
| Literals outside letters, digits, underscore, space | Only the five regex CHECK literals (provider, model, R-1 price, image size, image quality) | none | `to_regclass` / `to_regprocedure` names, `search_path=""` | `0.075`, `0.3`, `developers.openai.com`, `probe-model-` (not paste hazards) |

- **Checker is SELECT-only:** two statements, `SET default_transaction_read_only = on;` then one `WITH … SELECT`. The words INSERT, UPDATE and DELETE appear only as privilege-name literals. ✅
- **Checker runs before the migration:** the new objects are reached only through `to_regclass`, `to_regprocedure` and `has_*_privilege`; the live columns it reads (`proposal_id`, `retired_date`, `effective_date`, `created_at`, `ai_model_image_pricing`) exist since `20261052` / `20261053`. ✅
- **Probe always raises:** both skip paths raise, and the last statement is an unconditional `RAISE EXCEPTION` with PASS or FAIL in its text; no COMMIT. ✅
- **Migration-number check:** no `20261061` or later file on origin/main or on any of the 299 remote branches. origin/main has moved 17 commits since the base: no new audit event and no new admin route file, but `lib/repositories/types.ts` changed (+44), so the rebase may conflict as text (SA's step 1 note). ✅

### Step 5: charging untouched

`git diff origin/main --` (after `git fetch`, origin/main `5e44871d`) and `git diff HEAD --` are **empty (0 lines)** for `lib/ai/pricing.ts`, `lib/business-os/llm/chargePricing.ts`, `lib/services/EmbeddingService.ts`, `lib/business-os/llm/modelSettings.ts`, `lib/repositories/SystemConfigRepository.ts`, plus `lib/services/GeneratedImageService.ts` and `lib/ai/providers`. The `AiModelPricingRepository.ts` and its test hunks are additions only (0 removed lines), so `listActive()` and its existing tests are untouched. ✅

### Step 6: manual checklist for the user (after QA and the PR)

**U-1, checker before the migration (read-only).** Expected VERDICT: **`FAIL`, "3 pass 23 fail"**. The three PASS rows are V5 (two "no … row came from a pending price line", 0 rows) and V7. The 23 FAIL rows are expected: the 6 V1 rows, V2 column updates, the 4 V3 rows and the 12 V4 rows (6 foreign keys, 5 indexes, and the unique-and-partial check on the one-pending index, added after QA). There are no V2 "table privileges" rows yet. **Write down** the V5 INFO line (token active, token retired, image rows) and the V6 fingerprint (F0).

**U-3, checker after the migration.** PASS means all of these hold:
- the first row reads **`VERDICT | PASS | 68 pass 0 fail`** (6 V1 + 42 V2 table privileges + 1 V2 column updates + 4 V3 + 12 V4 + 2 V5 + 1 V7);
- the V2 column-updates detail reads exactly `service_role state service_role decided_by service_role decided_at service_role superseded_by` (in column order);
- **V6's fingerprint equals F0** and **V5's INFO counts equal U-1's** (both show INFO, so compare them by eye).

Any FAIL row, or a fingerprint or count that differs, means stop and report. Optional U-4 must end with `PROBE PASS  this error is expected and rolls everything back` and list P01 to P06 as PASS. "PROBE SKIPPED" means the tab is read-only or there is no active admin row with a user id.

**U-5, `GET /api/admin/model-pricing/comparison` signed in as admin.** HTTP 200, `{"success": true, "data": {"generatedAt": …, "embedding": {"status": "set", "provider": …, "model": …}, "rows": [ … ]}}`. Each row has `kind`, `provider` (`null` for an image model known only from a price key, D-7), `modelName`, `areas`, `usedByBusinessOs`, `usageLabel`, `currentBasis`, `currentNote`, `units`, `pending`, `colour`, `redUnits`, `summary` and `worstGapBasisPoints`. With no pending lines:
- every `pending` is `[]`;
- priced rows are **grey** and their units read "No new price";
- the only red rows are models a Business OS area uses that have no price anywhere ("Not priced"); they sort first;
- token rows from the table show `currentBasis: "table"` and the 1 h note; the OpenAI `cached_input` units are `derived`;
- image units are `in_code_fallback`, because `image_generation_prices_usd` is absent on production;
- `text-embedding-3-small` and `gpt-image-1` appear (MP-FR-2).

Signed out, it answers 401; signed in as a non-admin, 403; with any query parameter (for example `?x=1`), 400.

### Test Coverage

| Acceptance criterion | Tested? | Result | Notes |
|---|---|---|---|
| Pending lines stored, no price in effect changes (R-9 row 3, RK-1) | ✅ | Pass | Charging diff empty; guard test; the function never names live tables (pinned, mutation-tested); V-5 and V-6 owed by the user |
| R-1 precision: 0.075 per 1M exact, strings end to end | ✅ | Pass | Unit tests, mutants killed, edge probes; probe P01 on the database is optional U-4 |
| RR-1 validation and bounds; C-12 strict body | ⚠️ | Partial | Strict body is mutation-tested. **CR-1 open:** a URL Zod accepts but SQL refuses gives 500, not 400 |
| RR-2 one pending line per unit, supersede, insert-only content | ✅ | Pass (static) | Grant and trigger mutants killed; on the live database this is proven only by U-4 |
| RR-4 colours from the exact sign | ⚠️ | Partial | Colour correct in every case. **CR-2 open:** 1 to 4 bps under prints "-0.0%" |
| RR-3 area tags, "not used by Business OS"; user decision "not used yet" | ⚠️ | Partial | Tags pass (suite). "not used yet" exists only as the `new_model` code (E-1) |
| Admin-only routes: `requireAdmin` first, 401/403 before the body | ✅ | Pass | Pinned and mutation-tested |
| Audit `AI_PRICE_MANUAL_ENTRY` via `logAndFlush`; pins 200 / 62 | ✅ | Pass | Route happy path; `lib/audit/__tests__` 180/180 |
| Paste safety and the checker, rollback and probe shape | ✅ | Pass | Static scan above |

### Issues Found

#### Bugs (must fix before commit)
1. **CR-1 (SA) confirmed: source URL accepted by Zod, refused by the SQL CHECK** (Medium). File: `lib/ai/pricing-research/pendingLineSchema.ts`.
   - Steps: POST a line with `source_url` `" https://developers.openai.com/api"`, `"HTTPS://…"` or `"https:developers.openai.com/api"`.
   - Expected: 400 "Paste the full https address".
   - Actual: the schema passes, then the database raises 23514 and the route answers 500 "could not be saved". A tab inside the URL is stored raw.
2. **CR-2 (SA) confirmed: D-3 fails between 1 and 4 bps** (Low). File: `lib/ai/pricing-research/coverageColour.ts` (`formatGapPercent`, `toFixed(1)`).
   - Steps: current `0.9999`, new `1`.
   - Expected: no red unit reads 0.
   - Actual: red, "Undercharging: -0.0%"; the row summary reads "Undercharging: output -0.0%".
3. **CR-3 (SA): charging guard misses `systemConfigRepository` writes** (Low). Not separately reproduced by QA; the slice files today call only `getByKeys` and `getImageGenerationConfig`.

#### Performance Issues (should fix)
None found. Every new suite is pure and runs in milliseconds, with no network and no database.

#### Edge Cases (nice to fix)
1. **E-1 "not used yet" wording** (the user's decision): the API returns only the `new_model` code, and the row reads "not used by Business OS". Add a `NEW_MODEL_LABEL` now, or make it a named item of the UI slice (same as SA's optimisation).
2. **E-2 "-under 0.01%" / "+under 0.01%":** the sign before the word reads oddly; consider "under by less than 0.01%" or "less than 0.01% under" when CR-2 is fixed.
3. **E-3 compare precision is untested past 15 digits:** the float-compare mutant survives because the R-1 domain cannot tell it apart. If a table value ever carries more than 15 significant digits (`numeric` allows it), a float would be wrong. One pin such as `0.0000001500000000001` vs `0.00000015` (must be 1) would lock it.
4. **E-4 checker V-1 checks column names and order, not types** (§2.7 says "exact columns and types"); V-4 checks index presence only (SA's optimisation).

### Test Outputs / Logs

```text
New suites:            Test Suites: 12 passed, 12 total   Tests: 205 passed, 205 total
supabase/migrations:   Test Suites: 36 passed, 36 total   Tests: 1835 passed, 1835 total
test:bos-entitlements: Test Suites: 257 passed, 257 total Tests: 7496 passed, 7496 total
lib/audit/__tests__:   Test Suites: 15 passed, 15 total   Tests: 180 passed, 180 total
test:authz-guard:      Test Suites: 2 passed, 2 total     Tests: 203 passed, 203 total
test:bos-llm:          Test Suites: 23 passed, 23 total   Tests: 625 passed, 625 total
tailwind escape guard: Test Suites: 1 passed, 1 total     Tests: 6 passed, 6 total
pricing (lib/ai + system-config): Test Suites: 20 passed, 20 total  Tests: 307 passed, 307 total
typecheck-bos-llm: 523 files in scope, 28 errors, 0 new
check-bos-llm-literals: 64 files in scope, 2 exempt, 0 violations
```

**CLAUDE.md minimum (happy path plus a failure path per route): met.**
- **`POST /manual-entries`:** 200 happy (with audit), 401, 403 (gate before the body), 400, 422 (refusal and duplicate unit), 409, 403 on 42501, and 500 for an RPC failure and for a snapshot failure.
- **`GET /comparison`:** 200, 401, 403, 400 (unknown parameter) and 500.
- **Repositories:** every method has a unit test (`submitPending`, `listPendingLines`, `listActiveExact`).

### Final Status
- [ ] All acceptance criteria pass, ready for commit
- [x] Issues found: Dev must fix CR-1 (Medium), CR-2 and CR-3 (Low) before commit. QA then re-runs the affected suites and these mutants: schema `state`, colour `>=`, the D-3 branch, and the route gate. Then rebase on origin/main and re-run `lib/audit/__tests__` and `test:authz-guard` (C-10). No High-severity bug is open

## Commit Info

_To be completed by RM._

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-14 | Created | Dev workplan for R-9 row 3: proposal and line tables with insert-only content and RPC-only state, one pending line per unit, provenance FKs on the live tables, submit RPC, shared Zod schema and RR-1 bounds, manual-entry and comparison routes, RR-3 tags and RR-4 colours; zero charge change; open questions O-1 to O-17 |
| 2026-10-14 | SA changes folded in; user decision recorded | C-1 narrowed column grant, C-2 transition trigger, C-3 CHECKs, C-4 lock order and rollback timeout, C-5 printed counts, C-6 no EmbeddingService edit, C-7 image resolver only on known keys, C-8 decimal rules, C-9 census from disk, C-10 pins measured, C-11 probe, C-12 strict body, C-13 number note; generated columns (O-2); `entity_kind` (O-14). User: manual entry for a model not used yet is allowed (`new_model`, "not used yet"). Implementation started |
| 2026-10-14 | Code complete, uncommitted | T-0 to T-12 done: migration `20261066`, rollback, read-only checker, optional rolled-back probe, `lib/ai/pricing-research/` (decimal, schema, bounds, sources, flags, colour, area tags, comparison), `AiPriceProposalRepository` and `listActiveExact()`, the two admin routes, `AI_PRICE_MANUAL_ENTRY` (pins 200 / 62 shared), authz register rows 104 to 107 (census 104 = 98 + 6 + 0, 74 files). Charging files show an empty diff. Deviations D-1 to D-7 in 10.1. Awaiting SA code review |
| 2026-10-14 | SA code review and QA fixes; merged origin/main | CR-1 source URL must start with the exact `https://` and be printable ASCII with no space (400, not 500; schema and route tests). CR-2 gaps print two decimals; a red unit under 1 bp reads "less than -0.01%" (QA E-2). CR-3 guard pins the `systemConfigRepository` and `adminUserRepository` methods the slice may call. `NEW_MODEL_LABEL = 'not used yet'` returned beside the `new_model` code (`flagLabels`). `imageCurrent` counts a setting key only when it holds a finite number above 0. QA E-3 pin past 15 digits. Checker V-4 asserts the one-pending index is unique and partial (U-3 now 68 pass; U-1 3 pass 23 fail). §2.2 basis text corrected; slice 8 notes recorded in the requirement. Fast-forward to origin/main `97f75df4`; `lib/repositories/types.ts` re-applied cleanly beside main's change; no new audit event or admin handler on main (census still 104 in 74 files); `20261066` still free. Uncommitted |
