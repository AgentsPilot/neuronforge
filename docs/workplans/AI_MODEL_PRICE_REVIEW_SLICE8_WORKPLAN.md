# Workplan: AI Model Price Review, Slice 8 (per-model Apply, bulk Apply, Dismiss)

> **Last Updated**: 2026-10-17

**Developer:** Dev
**Requirement:** [AI_MODEL_PRICE_REVIEW_REQUIREMENT.md](/docs/requirements/AI_MODEL_PRICE_REVIEW_REQUIREMENT.md): MP-FR-8, MP-FR-9, MP-FR-10, MP-FR-14; UF-3; Q2, Q3, Q5, Q7; R-1, R-2, R-4; RR-1 (bounds), RR-2, RR-5; R-9 row 8; the slice 8 notes (slice 3 SA code review, slice 6 SC6-8)
**Branch:** `feature/ai-model-price-review-slice8` (worktree `neuronforge-model-pricing-s8`, off origin/main `98735db9`, merged with origin/main `ac674ceb` (slice 6) on 2026-10-16 and `c32a0093` (slice 7) on 2026-10-17)
**Date:** 2026-10-16
**Status:** Code Complete 2026-10-17, uncommitted; awaiting SA code review and QA. SA-approved with conditions 2026-10-17 (RC-1..RC-16, folded in below; SA Review Notes are binding). User decisions B-1..B-4 recorded 2026-10-17. Slice 7 merged (PR #455, `c32a0093`); the user said "start slice 8" on 2026-10-17. Implementation notes and deviations: [section 10](#10-implementation-notes-and-deviations). Migration `20261079`, not applied anywhere.

> ⚠️ **Implementation starts only after slices 6 and 7 are merged.** Slice 6 is merged (PR #441, `ac674ceb`); slice 7 is not yet. Slice 6 removed every other live-price writer (Sync, direct edit) and adds the `livePriceWrites` guard this slice extends. Slice 7 makes the charging readers read what this slice writes (image table, cached input); without it an applied image or cached-input price would not be charged. At implementation start, run the T-0 checklist (section 6).

## Overview

Slice 8 adds the **first in-app writer of live prices since slice 6**: a per-row **Apply** button (primary flow), **bulk Apply** for selected rows, and **Dismiss**, on `/admin/system-config`. Apply turns pending lines into live rows of `ai_model_pricing` (tokens, embeddings) or `ai_model_image_pricing` (images) through one all-or-nothing database function, writes one durable audit row per line, shows when charges will use the new price ("in effect on all servers within 1 hour"), and, when a model Business OS uses is touched, shows the margin-check prompt (MP-FR-14) until an admin marks it done with a note. Packages, allowances, markup and credit value never change (Q7). There is no undo (Q5). This is a **money path**.

## Table of Contents

1. [Analysis](#1-analysis) · 2. [Design](#2-design) · 3. [Files](#3-files) · 4. [Tests](#4-tests) · 5. [Risks](#5-risks) · 6. [Task list](#6-task-list) · 7. [Open questions for SA](#7-open-questions-for-sa) · 8. [Business questions](#8-business-questions) · 9. [Production apply order](#9-production-apply-order) · [SA Review Notes](#sa-review-notes) · [QA Testing Report](#qa-testing-report) · [Commit Info](#commit-info)

---

## 1. Analysis

Read on origin/main `98735db9`, re-checked after merging origin/main `ac674ceb` (slice 6 merged; `livePriceWrites.guard` as merged: LW-3 lists only `AiModelPricingRepository` and `AiPriceProposalRepository`, LW-5 `SQL_FUNCTIONS_ALLOWED = []`). Slice 7 facts come from the SA slice 7 review note, now in the requirement under "Notes for slice 8".

| Fact | Consequence |
|---|---|
| `ai_price_proposal_lines` (`20261066`): state `pending/superseded/applied/dismissed`, CHECK `state_shape` already requires `decided_by`, `decided_at`, a 3–500 char `decision_reason` for applied and dismissed, optional 3–500 char `override_reason`. Transition trigger allows only pending → superseded/applied/dismissed | No CHECK rewrite for the state. Slice 8 only grants `UPDATE (decision_reason, override_reason)` (+ the batch link) to `service_role` |
| Line content is insert-only; prices are per-1M text plus STORED generated per-token numerics | The apply function copies the generated numerics; no float, no arithmetic in the route |
| Snapshot columns: `current_basis` (`table`, `in_code_fallback`, `image_setting`, `unpriced`), `current_row_id` (set only for `table`; no FK, so it is resolved by `kind`: tokens in `ai_model_pricing`, images in `ai_model_image_pricing`), `current_*_cost_per_token`, `current_cost_per_image` | The stale check is defined **per basis** (SA slice 7 note, 2.2). Table rows are visible to SQL; in-code prices live only in the app, so the route recomputes them |
| After slice 7 the charged cached-input rate is, **for OpenAI only**, the live `cached_input_cost_per_token` when above 0, else half the input; for any other provider none (SA slice 7 note 1, amended by F-1). `image_setting` is no longer produced and no longer charges (user decision 2026-10-16) | The function compares the snapshot with that expression (2.2); apply writes the cached rate only as NULL or above 0; `image_setting` lines are always stale |
| Live readers: `retired_date IS NULL AND effective_date <= today (UTC)`, newest `effective_date`, then `created_at` | The function uses the same rule to find "the row charged today"; effective date `(now() AT TIME ZONE 'utc')::date` |
| Partial unique index on active rows `(provider, model_name, effective_date)`; image table `(provider, model_name, size, quality, effective_date)` | Retire first, then insert: a same-day second apply works |
| `ai_model_pricing` grants (slice 2 capture): `service_role` has ALL incl. DELETE, TRUNCATE; `anon` and `authenticated` SELECT + MAINTAIN; policy `ai_model_pricing_admin_write` FOR ALL to `authenticated` is inert (no write grant); table comment names the deleted route and claims "read + write" | SC6-8: new `COMMENT ON TABLE`, narrow `service_role` to `SELECT, INSERT, UPDATE (retired_date)`, drop the policy (2.1) |
| **Finding 3, corrected by SA:** on PG17 `LOCK TABLE` allows any mode with table-level MAINTAIN, UPDATE, DELETE or TRUNCATE, and **ROW EXCLUSIVE** (or weaker) with INSERT; a column UPDATE grant does not count | After the narrowing the apply function cannot take SHARE ROW EXCLUSIVE but **can** take ROW EXCLUSIVE (RC-3). MAINTAIN is never granted to `service_role` |
| `BLOCKING_FLAGS` = `large_move`, `cross_check_differs`, `retiring` (`lineFlags.ts`); `renamed` is in the CHECK but not blocking in code | The function repeats the blocking list; a test pins it equal to `BLOCKING_FLAGS` (O-9 on `renamed`) |
| `livePriceWrites.guard` (slice 6): LW-3 per-repository literal lists, LW-5 `SQL_FUNCTIONS_ALLOWED = []` | Slice 8 adds its names deliberately (2.8) |
| Slice 2 checker pins `ai_model_pricing` grants and two policies; slice 3 checker pins the line columns and exactly four UPDATE columns | **Named rows will FAIL after `20261079`, by design** (RC-10, confirmed against the files: slice 2 rows 150, 160; slice 3 rows 103, 210; later 500/501 and slice 2 row 310). The slice 8 checker re-asserts them; both old files get a header line (O-15); section 9 tells the user first |
| Audit pins (`eventAudience.test.ts`): 205 registered, 63 shared | +3 events → 208 / 66, `bos` and `agentspilot` unchanged (re-count at T-0: `feature/bos-finance-health-4b` is in flight) |
| Costs & credits tab: `/admin/business-os-llm?tab=costs` | The margin prompt links there |
| Pricing cache: per instance, `CACHE_TTL_MS` 1 h; after slice 7 `refreshPricingCache()` reloads token prices and invalidates the image cache, on the serving server only (SA slice 7 note 3) | Claim only "in effect on all servers within 1 hour" (2.6) |
| Image guardrail: an image model is accepted only when every configured size is priced at low, medium and high, in the table or the fallback (SA slice 7 note 4) | A partial image set applied for a new model leaves it refused; the row applies its set as one batch and the UI warns (2.7) |
| `20261072` and `20261073` are taken on `origin/feature/bos-finance-health-4b` (`240b14de`, also in worktree `neuronforge-finance-health`), not yet on main (RC-1) | **`20261079`** for the migration and every companion file and reference (re-check at T-0). ⚠️ **Re-check on 2026-10-17 found `20261079` and `20261075` also used**, uncommitted, in worktree `neuronforge-de8a` (`20261079_business_os_data_exports.sql`, `20261075_operator_test_account_cleanup_data_exports.sql`). Whichever branch merges first keeps the number; if de8a holds it at T-0, slice 8 moves to the next free number (today `20261076`) and every reference is updated |

---

## 2. Design

### 2.1 Migration `20261079_ai_price_apply_and_dismiss.sql`

One transaction, `lock_timeout 5s`, statement order pinned by the source test:

1. **`ai_price_apply_batches`**: `id uuid pk`, `applied_by uuid not null` (no FK to auth.users, as slice 3), `applied_at timestamptz not null default now()`, `line_count int` (1–50), `margin_review_needed boolean not null`, `margin_items jsonb not null` (array, server-computed, CHECK `jsonb_typeof = 'array'`, size cap), `margin_review_done boolean not null default false`, `margin_review_by uuid`, `margin_review_at timestamptz`, `margin_review_note text`. CHECKs: done ⇔ by/at/note set, note 3–500 chars; not needed ⇒ not done (B-3). No column named `user_id` (`applied_by` is right; the `businessOwnedTables` scanner keys on `user_id`); platform-only, so no data-export descriptor (stated in the PR) (RC-13).
2. **Batch link on lines**: `ALTER TABLE ai_price_proposal_lines ADD COLUMN apply_batch_id uuid` + FK to batches + CHECK `(state = 'applied') = (apply_batch_id IS NOT NULL)` (no existing row is applied, so validation is trivial) (O-5), plus a partial index `(apply_batch_id) WHERE apply_batch_id IS NOT NULL` for the slice 9 joins (RC-13).
3. **Batch transition trigger** (`ai_price_apply_batch_transition`, SECURITY INVOKER, empty search_path): only `margin_review_done` false → true, never back, and any UPDATE is refused once `OLD.margin_review_done` is true (no note rewrite after done) (RC-13).
4. **`ai_price_apply_lines(p_admin_user_id uuid, p_lines jsonb, p_margin jsonb)`**, SECURITY INVOKER, `SET search_path = ''`, `SET lock_timeout = '5s'`; `RETURNS TABLE` names `out_`-prefixed (RC-13). `p_lines` = `[{line_id, reason, override_reason}]` only; prices, models and snapshots are **read from the database**, never taken from the caller. Steps:
   Statement order (RC-2, RC-3, pinned by the source test):
   1. null and shape checks; 1–50 lines, enforced here **and** in Zod (O-17); distinct ids; reason and override 3–500 chars after trim; repeat the `admin_users` active check (42501);
   2. read each line's unit key from its insert-only columns (no lock needed); a missing id → `P8004`; sort the keys **in SQL**;
   3. take the advisory keys in that order, the expression byte-equal to `20261066`: `'ai_price_proposal_lines' || chr(124) || concat_ws(chr(124), provider, model_name, kind, coalesce(image_size, ''), coalesce(image_quality, ''))` (RC-5);
   4. `LOCK TABLE public.ai_model_pricing, public.ai_model_image_pricing IN ROW EXCLUSIVE MODE` (allowed by the INSERT grant), before any live row is touched;
   5. insert the **batch** row first (pre-generated id, `line_count`, margin), because the `apply_batch_id` FK is checked at the end of each statement (RC-2);
   6. per line: `SELECT … FOR UPDATE` the line and re-check `pending` (`P8001`); lock **all** active rows of the unit `FOR UPDATE` in one statement, no `LIMIT`; then, in **separate** statements, find the newest charged row and run the checks below;
   - **blocking** (stored flags): `flags && ARRAY['large_move','cross_check_differs','retiring']` and no override → `P8003`; an override on a line with no blocking flag → `P8006` (O-10, route 422 `override_not_needed`);
   - **stale check** per 2.2 (`current_row_id` resolved by `kind`) → `P8002`, naming the line; basis `image_setting` is always `P8002`;
   - **retire** every active row for the unit with `effective_date <= today` (`UPDATE … SET retired_date = today`; every live-table UPDATE sets `retired_date` only, pinned by the source test); an active row with `effective_date > today` → `P8007` (O-2, O-3);
   - **insert** the new live row: token → `ai_model_pricing` (input, output and the cached rate from the line's generated columns, the cached rate only as NULL or above 0 (the line CHECK already refuses a cached 0), `effective_date` today, `proposal_id`, `proposal_line_id`); image → `ai_model_image_pricing` (size, quality, `cost_per_image`);
   - **mark** the line `applied` (`decided_by`, `decided_at`, `decision_reason`, `override_reason`, `apply_batch_id` of the batch inserted in step 5);
   - ids pre-generated, no RETURNING, no SELECT … INTO; `p_margin` stored as given by the server route;
   - `RETURN NEXT` per line: line id, live table name, new row id, retired row ids, batch id, applied_at.
   Any `RAISE` aborts the whole call: all-or-nothing (MP-FR-9).
5. **`ai_price_dismiss_lines(p_admin_user_id uuid, p_line_ids uuid[], p_reason text)`**, `SET lock_timeout = '5s'`: admin check, 1–50 ids; reads the unit keys and takes **the same advisory keys in unit-key order, sorted in SQL**, before its `FOR UPDATE` (RC-5, otherwise a dismiss can deadlock an apply or submit); `P8004`/`P8001` as above; set `dismissed` with the reason. Never names a live table.
6. **`ai_price_apply_batch_review_done(p_admin_user_id uuid, p_batch_id uuid, p_note text)`**: admin check; refuses a batch that needs no review or is already done (`P8005`).
7. **Security**: RLS on batches + admin SELECT policy via `is_platform_admin()`; `REVOKE ALL` from PUBLIC, anon, authenticated, service_role; `GRANT SELECT` to authenticated; `GRANT SELECT, INSERT, UPDATE (margin_review_done, margin_review_by, margin_review_at, margin_review_note)` to service_role. Lines: `GRANT UPDATE (decision_reason, override_reason, apply_batch_id)` to service_role. Functions: REVOKE from PUBLIC, anon, authenticated, service_role, then `GRANT EXECUTE` to service_role only (trigger function: revoked only).
8. **SC6-8 + O-6 widened (RC-8) on `ai_model_pricing`**: `REVOKE ALL` from PUBLIC, `anon`, `authenticated` and `service_role`; `GRANT SELECT` to `authenticated`; `GRANT SELECT, INSERT, UPDATE (retired_date)` to `service_role` (this removes MAINTAIN from all three roles, matching `ai_model_image_pricing`); `DROP POLICY ai_model_pricing_admin_write`; new `COMMENT ON TABLE` (writer = `ai_price_apply_lines` run by the service role; authenticated platform admins read only; history kept with `retired_date`, never deleted). The image table comment is refreshed to name the same writer (O-16). `20261052` is never edited.
9. Paste safety: the word "into" only as `INSERT INTO`; no comments; no single-letter aliases; literals letters, digits, underscores and spaces, `chr()` for punctuation (slice 3 rule); no backslash.

Companion files: rollback `supabase/SQL Scripts/20261079_ai_price_apply_and_dismiss_rollback.sql` (takes `LOCK TABLE public.ai_model_pricing, public.ai_model_image_pricing, public.ai_price_proposal_lines IN SHARE ROW EXCLUSIVE MODE` before its guard; refuses **only** when a batch exists or a line is `applied`; a `dismissed` line does not block it (RC-9 a); else drops in reverse and restores the captured grants, policy and comment). Its header documents the **emergency stop**, which works in any state, run as `postgres`: `REVOKE EXECUTE ON FUNCTION public.ai_price_apply_lines(uuid, jsonb, jsonb) FROM service_role;` and the re-grant `GRANT EXECUTE ON FUNCTION public.ai_price_apply_lines(uuid, jsonb, jsonb) TO service_role;` (RC-9 b); read-only checker `scripts/check-ai-price-apply-migration.sql`; probe `scripts/probe-ai-price-apply-migration.sql` (one DO block, always ends in an error so nothing is kept; probe model names only, never a real model; applies two lines and finds both pointing at one batch, RC-2). **Also**: the slice 3 rollback gets the `LOCK TABLE … SHARE ROW EXCLUSIVE` line before its guard (slice 3 note).

### 2.2 Stale check per basis (SA slice 7 note, binding; replaces the slice 3 note)

Two layers, both required and ANDed, so any disagreement fails closed (a false 409, never a wrong price). The function is the authority for everything in the tables; the route covers what SQL cannot see (in-code prices) by recomputing `lineContextFor` on the server and refusing on any difference.

**Exact decimals (RC-6):** `findLinesForDecision` selects every generated per-token column and every `current_*` column as `::text` (as `listActiveExact`); `applyDecision.ts` compares them by value with `decimal.ts`, never through `Number()`. SQL compares numerics with `=` / `IS NOT DISTINCT FROM`, never `::text`. A parity test checks that the route's expected cached rate, the SQL CASE (the same fixtures through the probe) and slice 7's charging rule agree on column NULL, 0 and above 0, on OpenAI and another provider, including an input with an odd last digit.

| Line | Function, under lock | Route, before the call (`applyDecision.ts`, from `loadPricingSnapshot` + `lineContextFor`) |
|---|---|---|
| Token, basis `table` | `current_row_id`, looked up in `ai_model_pricing`, is still the active row charged today for (provider, model); input and output equal the snapshot exactly; the expected cached value `CASE WHEN line.provider='openai' AND live.cached_input_cost_per_token > 0 THEN live.cached_input_cost_per_token WHEN line.provider='openai' THEN live.input_cost_per_token/2 ELSE NULL END` is compared `IS NOT DISTINCT FROM current_cached_input_cost_per_token` (a 0 counts as unset) | Recompute; any difference in basis, row id or a unit → 409 |
| Token, basis `in_code_fallback` | Stale if an active row now exists for the unit | Recompute; any difference from today's in-code price → 409 |
| Token, basis `unpriced` | Stale if an active row now exists | Recompute; stale if the model is now priced anywhere |
| Image, basis `table` | `current_row_id`, looked up in `ai_model_image_pricing` (no FK), is still active for (provider, model, size, quality) with an equal `cost_per_image` | Recompute; any difference → 409 |
| Image, basis `in_code_fallback` / `unpriced` | Stale if an active image row now exists | Otherwise the recompute decides |
| Image, basis `image_setting` | **Always stale**: slice 7 no longer produces it and none exists live; the setting no longer affects charging (user decision 2026-10-16) | Same, with the words "record the price again" |

This supersedes the first draft, which skipped the cached-input column. **Apply-time flags (RC-7, O-14):** the route re-runs `evaluatePendingLine` against today's context: a hard refusal is 422 `refused`; re-evaluated **blocking** flags that differ from the stored flags are 409 `stale` ("record the price again"). The override requirement uses the **stored** flags, as the function does.

### 2.3 Concurrency

Per SA's Finding 3 analysis (binding):
- Apply vs apply and apply vs submit: same advisory key per unit, keys taken in unit-key order sorted in SQL; the second caller waits, then sees `applied` or `superseded` (`P8001`), or records a snapshot the next apply finds stale. Overlapping bulk applies cannot deadlock.
- Apply vs dismiss: dismiss takes the same keys in the same order (RC-5), so no deadlock.
- Apply vs the emergency runbook (O-4, RC-4): paste 2 of the runbook gets `LOCK TABLE public.ai_model_pricing IN SHARE ROW EXCLUSIVE MODE;` straight after `BEGIN;` (it runs as `postgres`), with one sentence saying why ("waits for any in-app Apply to finish"). It conflicts with the apply's up-front ROW EXCLUSIVE, so the two strictly serialise, with no key to type and no deadlock. `emergencyRunbook.source.test.ts` pins the line and its position; the runbook's paste-safety rules stay intact. **This runbook edit is part of slice 8's code, not of this workplan update.**
- Apply vs the slice 3 and slice 8 rollbacks: their SHARE ROW EXCLUSIVE conflicts with the apply's up-front ROW EXCLUSIVE, so normally whichever is first wins cleanly. **Known and accepted (SA CR8-5, QA concurrency review):** Apply reads `ai_price_proposal_lines` (ACCESS SHARE) before its table lock; a rollback that starts in that gap holds SHARE ROW EXCLUSIVE on the live tables and then needs ACCESS EXCLUSIVE on the lines table. That short deadlock is detected by Postgres, which aborts one side with 40P01: Apply answers 409 `busy`, or the operator re-runs the rollback. Nothing can be half-applied. Reordering would break RC-3's advisory-then-table order, so it stays.
- Both new locking functions carry `SET lock_timeout = '5s'`; the route maps 55P03 and 40P01 to 409 `busy` ("Someone else is changing prices. Try again.").

### 2.4 Routes (all `requireAdmin` first, strict Zod, Pino child with `correlationId`, repository only, `runtime = 'nodejs'`)

| Route | Body (strict) | Answers |
|---|---|---|
| `POST /api/admin/model-pricing/apply` | `{ lines: [{ lineId: uuid, reason: 3–500, overrideReason?: 3–500 }] }`, 1–50, distinct ids | 200 `{ batchId, appliedAt, lines[], marginReview }` · 400 invalid · 401/403 gate · 403 RPC 42501 · 404 unknown line · 409 `not_pending` / `stale` (incl. 23505, a same-day collision with a runbook row) / `starts_later` / `busy` (55P03, 40P01) (each listing the lines) · 422 `override_required` / `override_not_needed` / `refused` · 500; `details` only in development (RC-14) |
| `POST /api/admin/model-pricing/dismiss` | `{ lineIds: uuid[] 1–50 distinct, reason: 3–500 }` | 200 · 400 · 401/403 · 404 · 409 `not_pending` / `busy` · 500 |
| `POST /api/admin/model-pricing/apply-batches/[batchId]/margin-review` | `{ note: 3–500 }`; path id uuid | 200 · 400 · 401/403 · 404 · 409 `already_done` / `not_needed` · 500 |

Apply flow: gate → Zod → read the lines (`findLinesForDecision`) → 404/409 not pending → `loadPricingSnapshot()` → route stale check (409) → hard refusals (422) and re-evaluated blocking flags (409, RC-7) → blocking without override or override not needed (422) → margin items (2.5) → `applyLines` RPC (maps `P8001..P8007`, 42501, 23505, 55P03, 40P01) → `refreshPricingCache()` **bounded by a timeout** (F-5: a hung shared read would hold every async price lookup on the instance; a timeout or error is logged at warn and the apply still answers 200 with the "within 1 hour" claim) → one `AI_PRICING_APPLIED_LINE` per line, all in **one** `logAndFlush([...])` call (one flush, one bounded wait; RC-12) → response. The route checks are fast feedback; the function is the authority.

Audit details per applied line (MP-FR-9): model and unit, old → new per unit (per 1M text), source URL, checked date, reason, override reason, who submitted (`created_by`), who applied, proposal id, line id, batch id, new and retired live row ids. Entity `ai_pricing`, entity id the line id, `details.entity_kind` `price_line` (`apply_batch` for margin done), as the slice 3/5 events (RC-12). Dismiss: `AI_PRICE_LINE_DISMISSED` per line. Margin done: `AI_PRICE_MARGIN_REVIEW_DONE`, entity id the batch id. Severities (O-13): applied `warning` (a charge changes), the other two `info`; audience `shared`. A flush failure is logged at error and the 200 stands: the DB provenance (`proposal_line_id`, line `decided_by`/reason, batch row) is the backstop record (R-2).

### 2.5 Authorisation and tenant isolation (`tenant-isolation-guard`)

The guard applies: service role, ids from the client. The rows are **platform reference data with no owner** (no `user_id`; skill step 5, "global catalog"), so there is no tenant to cross; the boundary is "platform admin or not":

1. `requireAdmin` is the first statement (401/403 before the body is read); the function repeats the active `admin_users` check on the id from the session (`gate.user.id`), never from the body.
2. Any active admin may apply or dismiss any pending line (Q2: one admin, one approval, no second approver). A line id from the client therefore grants nothing an admin does not already hold.
3. **Field allow-list**: the client sends only line ids and reason texts. Strict Zod refuses any other key (an injected `adminUserId`, `price`, `model`, `effectiveDate`, `margin` is 400). Everything written to a live table is read inside the function from the locked line. The margin items are computed by the server.
4. A forged or foreign id resolves to nothing (`P8004` → 404) or to a non-pending line (`P8001` → 409) before any write.
5. Tests: injected keys → 400 and the repository is never called; unknown id → 404 with no RPC; the admin id passed to the RPC is the session's.

### 2.6 Margin prompt (MP-FR-14, Q7) and effective time (MP-FR-10)

- **Needed** after **every** applied change, rise or drop, to a model tagged with a Business OS area at apply time (`snapshot.areas`, RR-3), embeddings and images included (**B-1, user 2026-10-17**). A "not used yet" model may be applied and gets **no** prompt (`margin_review_needed = false`, **B-3**). Items: model, areas, per-unit old → new and % change; no cost-per-action figure until the impact view, slice 13 (**B-2**); plus a "fallback differs, update by PR" item when the applied price differs from the in-code fallback (R-1). Stored on the batch.
- The page shows every open prompt (from the comparison read, O-8) above the table: the models, the changes, a link "Review credit pricing" to `/admin/business-os-llm?tab=costs`, and "Mark done" with a required note. Any admin may mark it done, including the one who applied (**B-4**; no `margin_review_by <> applied_by` rule). Open prompts are read in the comparison builder only, never in `loadPricingSnapshot()` (O-8). Nothing changes plans, allowances, markup or credit value.
- **Effective time** (SA slice 7 note 3): claim only "in effect on all servers within 1 hour". The page shows "Applied at HH:MM UTC. In effect on all servers within 1 hour." (`formatUtcTime`); the response carries `appliedAt`. `refreshPricingCache()` reloads token prices and invalidates the image cache on the serving server only, and the route bounds the call with a timeout (F-5). Business OS token calls fill the cache on the settings path; non-Business-OS paths can still charge in-code prices on a cold server, which the help text says in plain words.

### 2.7 UI (`/admin/system-config`)

- Per row with pending line(s): **Apply** and **Dismiss** beside Enter provider price. Image rows apply or dismiss all their pending size and quality lines together, as one batch (SA slice 7 note 4). If, after the apply, the image model would still miss a configured size at low, medium or high (in the table or the fallback), the drawer says so before confirming: "Business OS will keep refusing this image model until every size is priced at low, medium and high." (O-19)
- Apply opens a drawer (shared `AdminDrawer`, as manual entry): per line, old → new, the reason **pre-filled** "Provider price change — source <url> (checked <date>)" (built in the page from the line, RR-2), editable, required; for each line with a blocking flag, the flag in words and an **empty** override field, required (RR-5). Cached input shows old → new, including "derived (half of input)"; a non-OpenAI cached price is labelled **"stored, not charged"** (F-1: only OpenAI cached reads are charged; the apply is allowed, the label is mandatory); a new line with no cached price over a live cached rate above 0 says the stored rate is removed and the default rule applies (RC-15). Confirm sends one request.
- **Bulk**: a checkbox per row with pending lines, "Apply selected (n)", the same drawer listing every line with its own pre-filled reason.
- Dismiss: a drawer with a required, **not** pre-filled reason.
- After Apply: a notice "Applied at HH:MM UTC. In effect on all servers within 1 hour." and the table re-reads. Errors in words per code (stale: "The price we charge changed since this was recorded. Record the provider price again.").
- Help drawer: step 3 becomes "Apply" (no longer "coming later"); the buttons paragraph explains Apply and Dismiss. S-1 and S-4 re-pinned in `source.guard.test.ts` with "SA 2026-10-xx slice 8"; no banned word ("immediately").
- Client code in new components; `page.tsx` keeps NW-1 (no write request in the page itself) and a new pin says only `priceApply.ts` posts (O-18).

### 2.8 Guards

`livePriceWrites.guard.test.ts`:
- LW-3: `AiPriceProposalRepository.ts` functions + `ai_price_dismiss_lines`; new `AiPriceApplyRepository.ts` → tables `ai_price_apply_batches`, functions `ai_price_apply_lines`, `ai_price_apply_batch_review_done` (O-7).
- LW-5: `SQL_FUNCTIONS_ALLOWED = ['ai_price_apply_lines']`, and **kept meaningful**: (a) the allowed function may be created only in `20261079` (a name → files map; a later `CREATE OR REPLACE` elsewhere fails until reviewed); (b) non-vacuity: its body is found and *is* live DML; the dismiss and review bodies are found and are *not*; (c) LW-4 negative control: a fake function named `ai_price_apply_lines` in another file is reported (the existing `20991231_x.sql` control keeps passing under the name → file map). No new repository walk: LW-1's existing file list is extended (RC-16).
- LW-2 unchanged (pricing repository stays read-only); LW-1 unchanged (no new file names a live table; the function does). `AiModelImagePricingRepository.ts`, added by slice 7 as read-only, stays read-only: slice 8 adds no method to it and adds only its own functions and table to the lists (SA slice 7 note 5).

---

## 3. Files

| File | Action | Reason |
|---|---|---|
| `supabase/migrations/20261079_ai_price_apply_and_dismiss.sql` | create | 2.1 |
| `supabase/SQL Scripts/20261079_ai_price_apply_and_dismiss_rollback.sql` | create | rollback with lock, emergency stop in header |
| `supabase/SQL Scripts/20261066_ai_price_pending_area_rollback.sql` | modify | lock before guard (slice 3 note) |
| `scripts/check-ai-price-apply-migration.sql`, `scripts/probe-ai-price-apply-migration.sql` | create | checker, probe |
| `scripts/check-ai-model-pricing-slice2-migration.sql`, `scripts/check-ai-price-pending-area-migration.sql` | modify (header line only) | names the rows that FAIL by design after slice 8 (RC-10, O-15) |
| `supabase/migrations/__tests__/ai-model-pricing-slice8.migration.test.ts` | create | source test |
| `lib/repositories/AiPriceApplyRepository.ts` (+ index export, types) | create | apply RPC, batches read, review RPC (`new-repository` skill) |
| `lib/repositories/AiPriceProposalRepository.ts` | modify | `findLinesForDecision`, `dismissLines` |
| `lib/ai/pricing-research/applyDecision.ts` | create | pure: stale check per basis, margin items, pre-fill text, effective time |
| `lib/ai/pricing-research/comparisonModel.ts` | modify | open margin reviews in the read model (O-8) |
| `lib/ai/pricing-research/applySchema.ts` | create | Zod bodies |
| `app/api/admin/model-pricing/apply/route.ts`, `dismiss/route.ts`, `apply-batches/[batchId]/margin-review/route.ts` (+ tests) | create | 2.4 |
| `lib/audit/events.ts`, `lib/audit/eventAudience.ts`, `lib/audit/__tests__/eventAudience.test.ts` | modify | 3 events, pins |
| `app/admin/system-config/components/PriceApplyDrawer.tsx`, `PriceDismissDrawer.tsx`, `MarginReviewNotice.tsx`, `app/admin/system-config/priceApply.ts` | create | UI, client calls |
| `app/admin/system-config/page.tsx`, `priceReviewCopy.ts`, `components/PriceRowCells.tsx` | modify | buttons, selection, help |
| `app/admin/system-config/__tests__/*` (render tests, `source.guard.test.ts`) | modify/create | 2.7 |
| `lib/ai/pricing-research/__tests__/livePriceWrites.guard.test.ts` | modify | 2.8 |
| `docs/admin/ADMIN_IDENTIFICATION_AND_ACCESS.md` | modify | three route rows, census |
| `docs/runbooks/AI_MODEL_PRICE_EMERGENCY_SQL_RUNBOOK.md`, `lib/ai/pricing-research/__tests__/emergencyRunbook.source.test.ts` | modify | paste 2 table lock after `BEGIN;` + pin (RC-4) |
| `docs/requirements/AI_MODEL_PRICE_REVIEW_REQUIREMENT.md` | modify | status, Change History |

Charging files (`lib/ai/pricing.ts`, `chargePricing.ts`, providers) are **not** edited; only `refreshPricingCache` is imported.

---

## 4. Tests

All offline, inside the existing Jest job; source scans read named files only; no new repository walk; drawer and notice tests render the components directly with a mocked `fetch`, with at most one page-level wiring test; no new job, **no added CI time** (RC-16).

- **Migration source test**: paste safety ("into" count = number of `INSERT INTO` statements; literal charset; no comment; no backslash; no single-letter alias); the statement list and order; exact grants and column grants (lines: the four C-1 columns + three; batches; `ai_model_pricing` narrowed to `SELECT, INSERT, UPDATE (retired_date)`); policy drop; the new comment text and that `20261052` is untouched; every function SECURITY INVOKER, `search_path = ''`, EXECUTE to service_role only, revoked after creation; apply body order: unit keys sorted in SQL, advisory keys, `LOCK TABLE … IN ROW EXCLUSIVE MODE`, batch insert before the first line UPDATE, then `FOR UPDATE` and the stale check in separate statements (RC-2, RC-3); the advisory key expression in apply and dismiss byte-equal to `20261066` (RC-5); `SET lock_timeout = '5s'` on both; every live-table UPDATE sets `retired_date` only; retires before insert, reads prices only from the line, uses no RETURNING / SELECT … INTO; contains the SA cached-input CASE expression with `IS NOT DISTINCT FROM`, resolves `current_row_id` by `kind`, and refuses `image_setting`; the probe covers a cached column of 0, an image `table` stale case and an `image_setting` line; its blocking list equals `BLOCKING_FLAGS`; dismiss and review never name a live table; rollbacks (new and slice 3) lock before their guard; the new rollback refuses only on a batch or an applied line, and its header carries the emergency stop (RC-9); checker read-only; probe one DO block ending in an error, admin id read from `admin_users`, no uuid literal.
- **Pure** (`applyDecision.test.ts`): the RC-6 parity test; re-evaluated blocking flags that differ → stale (RC-7); stale per basis: token `table` with the cached column above 0, at 0 (unset) and NULL, on OpenAI and another provider; a changed in-code price; an appeared table row; image `table` with a changed `cost_per_image`; `image_setting` always stale; the incomplete image set warning; margin items (BOS-tagged vs not; fallback differs); pre-fill text; effective time.
- **Routes**: apply, dismiss, margin-review each: 401 and 403 before the body is read; 400 (bad JSON, unknown key, duplicate id, short reason, injected `adminUserId`); 404; 409 not pending; apply 409 stale (route layer, and RPC `P8002` mapping), 409 starts later, 422 override required, 422 `override_not_needed`, 422 refused, 409 `busy` on 55P03/40P01, 409 `stale` on 23505, 403 on 42501; happy path single and bulk (RPC receives only ids, reasons and the session admin id; one audit per line in one `logAndFlush([...])` call, awaited before the response; refresh called; `appliedAt` returned and no "by HH:MM" promise in the response; flush failure still 200; no detail leaks outside development).
- **Components and page** (`fireEvent`, test ids, mocked `fetch` and `ProviderPriceCheck`): Apply opens the drawer with the pre-filled reason; override field empty and required on a blocking line; confirm posts the right body and shows the effective time; bulk selection; Dismiss requires a reason and is not pre-filled; margin notice link and Mark done; RC-15 cached-input words; error words per code.
- **Guards**: LW-3/LW-5 as 2.8; runbook lock pin (RC-4); audit pins.

---

## 5. Risks

| # | Risk | Mitigation |
|---|---|---|
| K-1 | A wrong price goes live for every customer | Pending-only research, cross-check, blocking flags with written overrides, two-layer stale check, exact numerics, per-line confirmation, audit + provenance; correction = a new line (Q5) |
| K-2 | Half an apply | One function, one transaction, every refusal raises |
| K-3 | Stale snapshot invisible to SQL (in-code prices only, after slice 7) | The function checks table rows and the cached rate (SA expression); the route recomputes `lineContextFor`; for in-code prices the window is a deploy, negligible |
| K-4 | Operator runbook insert races an apply | Runbook paste 2 takes SHARE ROW EXCLUSIVE, the apply takes ROW EXCLUSIVE up front: strict serialisation (RC-3, RC-4) |
| K-5 | Reverting slice 6 after slice 8 brings Sync back | Warning already in R-9 row 6; repeated in the PR |
| K-6 | Slice 7's merged code differs from the SA note (basis names, cached rule, image repository) | The SA note is binding; re-read slice 7 at implementation start and raise any difference with SA before coding |
| K-11 | A new image model applied size by size stays refused by the guardrail | The row applies its whole pending set as one batch; the drawer warns when the set is still incomplete |
| K-7 | Old checkers report FAIL after `20261079` | Expected and named (RC-10); the user is told before pasting; the slice 8 checker asserts the new state |
| K-8 | Narrowing breaks a hidden writer | LW-1 shows no app writer after slice 6; all other readers use SELECT; checker verifies SELECT still held |
| K-9 | Audit row lost on a frozen instance | `logAndFlush` + DB provenance as backstop |
| K-10 | Merge conflicts with slice 7 and `bos-finance-health-4b` in the requirement, guard, audit pins and page files | Small, targeted edits; merge origin/main at T-0 |
| K-12 | A bad apply needs stopping at once, in any state | Emergency stop: `REVOKE EXECUTE` on `ai_price_apply_lines` as `postgres` (RC-9 b) |
| K-13 | Deadlock or lock wait shows as a 500 | One lock order everywhere (RC-3, RC-5); `lock_timeout 5s`; 55P03/40P01 → 409 `busy` |

---

## 6. Task list

- [x] ✅ T-0 checklist, when coding starts (after slice 7 merges):
  - [x] `git fetch` and `git merge origin/main` (merge only, never stash)
  - [x] re-check the migration number (`git log --remotes --name-only -- 'supabase/migrations/2026107*'` plus every worktree's `supabase/migrations/`); `20261079` unless taken, then update every reference
  - [x] confirm slice 7's merged `comparisonModel` cached-input rule equals the SQL CASE (OpenAI only: column above 0, else half the input; others none, F-1); raise any difference with SA before T-1
  - [x] recount the audit pins (registered, `shared`, `bos`, `agentspilot`)
  - [x] confirm slice 7's basis names and that `AiModelImagePricingRepository.ts` is in LW-2 as read-only
- [x] ✅ T-1: Migration `20261079` + source test (RC-1..RC-5 first)
- [x] ✅ T-2: Rollback (RC-9) with the emergency stop; slice 3 rollback lock; checker (RC-8 assertions); probe; old checker header notes naming the RC-10 rows (re-confirm the row ids)
- [x] ✅ T-3: Repositories (`new-repository` skill) + unit tests
- [x] ✅ T-4: `applyDecision.ts`, `applySchema.ts` + pure tests
- [x] ✅ T-5: Audit events, audience, pins
- [x] ✅ T-6: Apply route + tests (`new-api-route` skill)
- [x] ✅ T-7: Dismiss and margin-review routes + tests
- [x] ✅ T-8: Comparison read model: open margin reviews
- [x] ✅ T-9: UI: buttons, selection, drawers, notice, help, copy + render tests; source guard re-pins
- [x] ✅ T-10: `livePriceWrites` guard LW-3/LW-5
- [x] ✅ T-11: Runbook paste 2 table lock + source-test pin (RC-4); docs: admin route register, requirement status and Change History
- [x] ✅ T-12: `npm run lint`, targeted Jest, `tsc` on touched files; hand to SA

---

## 7. Open questions for SA

All ruled by SA on 2026-10-17; the rulings in the SA Review Notes are binding and are folded into sections 2 to 6. Changed by the rulings: O-4 (table lock, not an advisory key, RC-4), O-6 (widened, RC-8), O-10 (422 `override_not_needed`), O-17 (also enforced in the function).

| # | Question | Dev proposal |
|---|---|---|
| O-1 | One reason per request (as the brief) or **one per line**? Pre-fills differ per source URL, so a bulk apply with one reason would store the wrong source | Per line; the batch has no reason column |
| O-2 | An active row dated after today for the unit | Refuse (`P8007`, 409); only the runbook can create one |
| O-3 | Retire every active row for the unit dated today or earlier, or only the newest | Every one: leaves exactly one active row per unit |
| O-4 | Add the advisory-lock step to the emergency runbook | **Ruled: a table lock instead (RC-4)** |
| O-5 | Batch link: `apply_batch_id` on lines (+ CHECK) or `line_ids uuid[]` on the batch | Column on lines (FK, joins for slice 9 history) |
| O-6 | Also revoke `anon` SELECT and MAINTAIN on `ai_model_pricing` (all readers use the service role; RLS already denies) | **Ruled: yes, widened (RC-8)** |
| O-7 | New `AiPriceApplyRepository` for the one live writer vs extending `AiPriceProposalRepository` (whose header says it never changes a live price) | New repository |
| O-8 | Open margin prompts: in the comparison payload or a new GET | Comparison payload (one read) |
| O-9 | `renamed` blocking (R-4 says yes, code says no); R-4's proposal-level "unpriced in use" in a per-line flow | **Ruled as proposed; recorded as an R-4 amendment in the requirement** |
| O-10 | Override reason sent for a line with no blocking flag | **Ruled: 422 `override_not_needed`** (`P8006`) |
| O-11 | Custom SQLSTATEs `P8001`–`P8007` for the route mapping | Yes |
| O-12 | ~~Effective time with slice 7 caches~~ | **Resolved by SA slice 7 note 3:** claim only "within 1 hour" |
| O-13 | Severities | Applied `warning`; dismissed and margin done `info` |
| O-14 | Re-run hard refusals (bounds) at apply | Yes, route only (bounds are code config) |
| O-15 | Old slice 2 and 3 checkers will FAIL after this migration | Header note only; never rewritten |
| O-16 | Also refresh the image table comment (names the apply function) | Yes |
| O-17 | Bulk limit | 50 lines per request |
| O-18 | Keep NW-1 ("page.tsx sends no write") by keeping writes in components | Yes, and add a pin that only `priceApply.ts` posts |
| O-19 | Incomplete image set (SA slice 7 note 4): warn and allow, or refuse the apply | Warn and allow: a priced size is still correct data, and the model is not charged until the set is complete |

---

## 8. Business questions

All **decided by the user on 2026-10-17**, as recommended (recorded in the requirement).

| # | Question | Decision |
|---|---|---|
| B-1 | Show the margin-check prompt after **every** applied change to a model Business OS uses, or only above a 20% change? | **Every** change to a model Business OS uses |
| B-2 | The prompt should show the change in cost per action, but that figure needs the customer-impact view, which you placed after history (slice 13). Until then it shows the % change per price unit. Acceptable? | **Yes**, % per price unit until the impact view exists |
| B-3 | May an admin apply a price for a model Business OS does not use yet ("not used yet")? It changes no customer charge today | **Yes**, with no margin prompt |
| B-4 | Can the admin who applied a change also mark its margin review done? | **Yes** |

---

## 9. Production apply order

Only with the user's explicit go-ahead; the user (or TL via the connector, with the user's OK) applies by hand.

1. Preconditions: slices 6 and 7 merged **and deployed**; slice 6 verified live (no Sync, pricing route GET-only). `20261079` still the next free number.
2. Read-only before-capture (SA CR8-3 a): run `scripts/check-ai-price-apply-migration.sql` **before** the migration. It parses without the new objects; VERDICT FAIL is expected at this point. Copy rows **V5** (row counts) and **V6** (the charged-price fingerprint), so the before and after values come from the same query (the slice 2 checker rounds differently). Do not quote an expected constant: the 2026-10-16 embedding runbook row already moved the fingerprint from `76c7cfe8…` to `8d6bbb23…` (RC-11). Also capture the line state counts.
3. **Before anything is pasted, tell the user in plain words (RC-10, SA CR8-3 b):** "From now on, these old checks are expected to show FAIL, by design. Read the slice 8 check instead."
   - **`scripts/check-ai-model-pricing-slice2-migration.sql`:** VERDICT; row **150** (the pricing table now has one policy, not two); row **160**, exactly six rows:
     - `anon SELECT`;
     - `service_role UPDATE`;
     - `service_role DELETE`;
     - `service_role TRUNCATE`;
     - `service_role REFERENCES`;
     - `service_role TRIGGER`.

     The 160 rows `authenticated SELECT`, `service_role SELECT` and `service_role INSERT` still pass.
   - **`scripts/check-ai-price-pending-area-migration.sql`:** VERDICT; row **103** (the lines table has one more column, `apply_batch_id`) and row **210** (service_role may also update `decision_reason`, `override_reason` and `apply_batch_id`).
   - **Later, by design:** after the first real token apply (slice 12), slice 3 row **500** and slice 2 row **130**; after the first image apply, slice 3 row **501** and slice 2 row **310**.
   - `scripts/check-ai-price-submit-pending-fetch-migration.sql` keeps passing.
4. Paste and run `20261079` (one transaction).
5. Run the slice 8 checker → VERDICT PASS; rows V5 and V6 equal the step 2 capture (the migration changes no price).
6. Run the probe in a fresh tab → `PROBE PASS … this error is expected and rolls everything back` (P01 to P14); re-run the checker: V5 and V6 unchanged.
7. Merge **by hand** (the PR must not auto-merge: it is migration-gated) and deploy the code (the migration first: deployed code no longer writes the live tables, so the narrowing cannot break it; new code needs the new functions).
8. After deploy: page check (Apply, Dismiss, help). No test apply on a real model. With the user's OK, dismiss the slice 4 UF-6 test line, which proves Dismiss with zero charge effect (a dismissed line does not block the rollback, RC-9). The first real apply is slice 12, with the user.
9. Record in Commit Info.

**Emergency stop (any state, as `postgres`, RC-9 b):** `REVOKE EXECUTE ON FUNCTION public.ai_price_apply_lines(uuid, jsonb, jsonb) FROM service_role;` stops every in-app Apply at once; `GRANT EXECUTE ON FUNCTION public.ai_price_apply_lines(uuid, jsonb, jsonb) TO service_role;` restores it. The full rollback is possible only while no batch exists and no line is applied.

---

## 10. Implementation notes and deviations

**T-0 (2026-10-17), done:**
- Merged origin/main `c32a0093` (slice 7, PR #455). The requirement edit was saved, the file reset, merged, re-applied with `git apply --3way` and the four conflict hunks resolved by hand (status line, the slice 7 note kept as main wrote it with F-1 and F-5 added, both decision tables kept, both Change History sets kept). No stash.
- **Migration number: `20261079`.** `20261074` and `20261075` landed on main (data export DE-8a); `20261076`/`20261077` are in worktree `neuronforge-finance-health` (the boost reversal migrations renumbered); `20261078` is on a remote branch (finance snapshots). Every reference uses `20261079`.
- Slice 7's merged `tokenCurrent` matches the SQL CASE exactly (OpenAI only: the stored rate when above 0, else half the input; other providers none). The RC-6 parity test (`applyDecision.test.ts`) runs the route rule and `tokenCurrent` on NULL, 0 and above 0, on OpenAI and Anthropic, with an odd last digit; the probe (P04 to P06) runs the SQL side on the same values.
- Audit pins on main were 211 registered / 69 shared (data export added six); slice 8 makes them 214 / 72; `bos` 58 and `agentspilot` 84 unchanged.
- `AiModelImagePricingRepository.ts` is in `READ_ONLY_REPOSITORIES` (LW-2) with `listActive`, `listActiveExact`; slice 8 does not touch it.

**Deviations (for SA):**

| # | Planned | Built | Why |
|---|---|---|---|
| D-1 | Apply and Dismiss in the shared `AdminDrawer` | An inline panel above the table (`PriceDecisionPanel`), like the manual-entry form | Same pattern as the form beside it, no new layout part; the help drawer stays the only drawer on the page |
| D-2 | RC-9: the emergency stop in the rollback file header; RC-10: a header line in the slice 2 and slice 3 checkers | The stop is documented in the emergency runbook (new subsection, pinned by its source test) and in section 9; the FAIL rows are named in section 9 step 3 only | The paste-safety tests forbid comments in every pasted file, so a header is impossible without weakening them |
| D-3 | RC-6: `findLinesForDecision` selects the generated per-token columns as text | It selects the per-1M text the line was submitted with and every `current_*` column as `::text` | The per-1M text is the exact source of the generated columns; the route never needs the per-token form of the new price |
| D-4 | RC-7: compare the re-evaluated blocking flags with the stored ones | Only `large_move` is compared | `cross_check_differs` and `retiring` come only from a fetch round's LiteLLM reading; the route cannot recompute them, so comparing would mark every such line stale |
| D-5 | P8005 for both margin refusals | P8005 with DETAIL `not_needed` or `already_done` | One code, two answers, as the route maps them |
| D-6 | The route answers with `effectiveBy` | `appliedAt` plus the words "In effect on all servers within 1 hour." | SA O-12 / slice 7 note 3: no "by HH:MM" promise |
| D-7 | — | The apply and dismiss routes catch an audit flush rejection after the write | The price is already applied; a 500 would mislead the admin. The database provenance remains the record |
| D-8 | — | The comparison row gains `imageSetIncomplete` and the read model `openMarginReviews` (both optional) | O-19 and O-8; optional so older read-model doubles stay valid |
| D-9 | — | Slice 7's `chargeSources.guard` G-2 allow-list gains `AiPriceProposalRepository.ts` (one commented line) | It selects the line's SNAPSHOT column `current_cached_input_cost_per_token`, which contains the guarded name; it is compared, never charged. The apply route's audit field moved to `applyDecision.ts` (already allowed) so the route stays off the list. `comparisonTruth.test.ts` and `comparisonModel.test.ts` gain a mock of the new repository |

**Local only, not caused by this slice:** `openaiPricingAdapter.test.ts` fails 6 cases in this Windows checkout because its fixture is checked out with CRLF line endings (`core.autocrlf true`); the adapter, its test and its fixture are untouched here. CI (LF) is the arbiter.

**Not done here (needs the user):** the production apply (section 9), and the browser check after deploy.

---

## SA Review Notes

**Reviewed by SA — 2026-10-17** (against `feature/ai-model-price-review-slice8` at origin/main `ac674ceb`; slice 7 read uncommitted in `-s7`; skills loaded: `tenant-isolation-guard`, `new-api-route`, `business-os-schema-check`; no DB write, no live catalog query: grants are taken from the slice 2 capture and the migrations)
**Status:** ✅ Approved with conditions. RC-1..RC-16 below are folded into this workplan by the Dev before T-1. No second full SA pass is needed; SA verifies each RC at code review. RC-1, RC-2, RC-3, RC-4 and RC-5 are blocking for the migration.

### Verdict in one paragraph

The shape is right: one all-or-nothing SECURITY INVOKER function that reads every price from the locked line, never from the caller; per-line reasons; a DB-level "never edit a price in place" (after the narrowing, `service_role` can only INSERT a row or set `retired_date`, so an in-place price edit is refused by Postgres itself, not only by the guard); tenant isolation correctly reduced to "platform admin or not" for an owner-less global catalog (skill step 5), with the admin id taken from the session and re-checked in SQL. Five things must change before the migration is written: the migration number is taken; the batch row must exist before a line points at it; the lock design needs one explicit table lock to be deadlock-free against the runbook and the rollbacks; dismiss must use the same lock order as submit and apply; and both stale-check layers must compare exact decimals.

### User decisions recorded (2026-10-17, via TL; the Dev records them in the requirement)

| # | Decision | Effect on this workplan |
|---|---|---|
| **B-1** | Show the margin prompt after **every** applied change to a model Business OS uses (no threshold) | `margin_review_needed` = any applied line's model carries an RR-3 area tag at apply time, rises and drops alike |
| **B-2** | Until the impact view exists (slice 13), the prompt shows the % change per price unit | Margin items carry per-unit old → new and %; no cost-per-action figure |
| **B-3** | An admin may apply a price for a "not used yet" model, with **no** margin prompt | Such a batch has `margin_review_needed = false`; the CHECK "not needed ⇒ not done" holds |
| **B-4** | The admin who applied a change may also mark its margin review done | No `margin_review_by <> applied_by` rule anywhere |

Earlier decisions still bind: Q2 (any admin, one approval), Q5 (no undo; a correction is a new line), Q7 (never change packages, allowances, markup or credit value; only prompt), UF-3 (per-row Apply with a pre-filled reason; override reasons never pre-filled; Dismiss needs a reason, not pre-filled).

### Rulings on O-1..O-19

| # | Ruling |
|---|---|
| O-1 | ✅ One reason **per line**. A bulk reason would store the wrong source URL. The batch has no reason column |
| O-2 | ✅ Refuse (`P8007`, 409). A future-dated active row would silently replace the applied price on its date |
| O-3 | ✅ Retire every active row dated today or earlier, leaving exactly one active row. Slice 9 note: an older active row that was already shadowed gets today's `retired_date`; history should show "not charged since <newer row's date>" rather than read the retire date as the end of charging |
| O-4 | ✅ Yes, **but changed** (RC-4): the runbook takes a table lock, not an advisory key that an operator must type exactly |
| O-5 | ✅ Column on lines, with FK and CHECK. Ordering fix in RC-2; partial index in RC-13 |
| O-6 | ✅ Yes, **widened** (RC-8): revoke MAINTAIN from `authenticated` as well, and leave `authenticated` with SELECT only. Every code reader checked: `AiModelPricingRepository` (`supabaseServer`), `app/api/admin/agent-generation-config/route.ts`, `lib/utils/usageTracker.ts`, `lib/memory/MemorySummarizer.ts`, `scripts/analyze-pricing-discrepancies.ts`, `scripts/calculate-gpt4o-cost.ts` all use the service-role key; the two `'use client'` pages name the table only in text. The only SQL reader, `pilot_cost_savings_summary`, is `security_invoker` and granted to `authenticated` and `service_role` only, so it keeps working. RLS gives `anon` zero rows today anyway, so nothing can break |
| O-7 | ✅ New `AiPriceApplyRepository` (`new-repository` skill: client injection, `RepositoryResult`, never throws, header with the unscoped-by-design reason and the one permitted caller class: admin routes behind `requireAdmin`) |
| O-8 | ✅ In the comparison payload, read in the comparison builder only. **Do not** add the batch read to `loadPricingSnapshot()`: the apply route calls it and does not need it |
| O-9 | ✅ Leave `renamed` non-blocking (nothing sets it; the pin "function list = `BLOCKING_FLAGS`" fails if code ever makes it blocking). ✅ Drop R-4's proposal-level "unpriced in use" gate: there is no proposal-approval moment in a per-line flow, and the red "not priced" row (RR-4) is the signal. **The Dev records this as an R-4 amendment in the requirement** |
| O-10 | ✅ Refuse an override on a line with no blocking flag. Status: **422 `override_not_needed`** (it is known only after the lines are read, so it is not a Zod 400). Fix §2.4 and O-10 to say the same (RC-14) |
| O-11 | ✅ `P8001`–`P8007` (class P is in the I–Z range Postgres leaves to applications; no collision in `supabase/migrations/`) |
| O-12 | ✅ Resolved: "in effect on all servers within 1 hour" only. No "by HH:MM" anywhere (R-2's wording is superseded) |
| O-13 | ✅ Applied `warning`; dismissed and margin done `info`; audience `shared`. All three are valid `AuditSeverity` values |
| O-14 | ✅ Route only, refined by RC-7 |
| O-15 | ✅ Header note only, never rewritten; plus RC-10 so the user knows **before** pasting which old rows will say FAIL |
| O-16 | ✅ Refresh the image table comment to name `ai_price_apply_lines` as the writer |
| O-17 | ✅ 50 lines per request, enforced in Zod **and** in the function. The largest image set (sizes × qualities) is well under it |
| O-18 | ✅ Keep NW-1; add the pin that only `priceApply.ts` posts |
| O-19 | ✅ **Warn and allow.** Adding a price never removes coverage, so a partial set cannot break a model that works today; the guardrail keeps refusing an incompletely priced image model, so it is never charged at $0. The row still applies its whole pending set as one batch |

### Finding 3 and concurrency (the questions TL asked)

**Correction of the fact.** On PG17, `LOCK TABLE` permits **any** mode to a role holding table-level MAINTAIN, UPDATE, DELETE or TRUNCATE, and permits **ROW EXCLUSIVE** (or weaker) to a role holding INSERT. A column-level UPDATE grant does not count. So after the narrowing the apply function cannot take SHARE ROW EXCLUSIVE, but it **can** take ROW EXCLUSIVE. Do not grant MAINTAIN to `service_role` to get the stronger lock (it would also allow VACUUM FULL / CLUSTER, an ACCESS EXCLUSIVE rewrite); RC-3 does not need it.

**Apply vs apply.** Safe. One pending line per unit (partial unique index), the same advisory key per unit, keys taken in unit-key order sorted in SQL; the second caller waits, then sees `applied` (`P8001`). Overlapping bulk applies take keys in the same order, so they cannot deadlock.

**Apply vs submit.** Safe. Same key and order as `ai_price_submit_pending`. A superseded line is `P8001`; a submit that waited behind an apply records a snapshot the next apply will find stale.

**Apply vs dismiss.** **Not safe as written**: dismiss locks rows in id order with no advisory key, so a dismiss of (B, A) against an apply or submit of (A, B) can deadlock. Postgres would abort one (40P01), so nothing is corrupted, but it surfaces as a 500. RC-5.

**Apply vs the emergency runbook (O-4).** Mostly fails closed today, without any change: the runbook retires by id with `WHERE retired_date IS NULL` and checks `ROW_COUNT` (it refuses if an apply retired the row first); an apply that waits behind a runbook retire re-reads and finds its `current_row_id` retired (`P8002`), **provided the stale check runs in a statement after the lock** (RC-3); and two same-day inserts for one unit collide on the partial unique index (23505). The residual windows are a first price for a unit inserted by both at once across UTC midnight (different `effective_date`, no index collision, two active rows), and a stale check written in the same statement as the lock. An advisory key in the runbook would close it only if the operator types the key byte-exact (`ai_price_proposal_lines|openai|gpt-4o|token||`); a typo silently takes a different lock. RC-3 + RC-4 close it with no key to type and no deadlock.

**Apply vs the rollbacks.** With the up-front ROW EXCLUSIVE (RC-3) the rollbacks' SHARE ROW EXCLUSIVE conflicts at the first statement on either side, so whichever is first wins cleanly. Without it the apply only acquires ROW EXCLUSIVE at its first UPDATE, after it already holds row locks, which is a deadlock shape.

**The two-layer stale check.** The layers are ANDed, so any disagreement fails **closed** (a false 409, never a wrong price). Gaps found: (a) the in-code half is checked outside the lock, which is acceptable because in-code prices change only by a deploy; (b) exactness: the route must compare decimals by value from `::text` reads, and the SQL must compare numerics, never text (RC-6); (c) slice 7's `comparisonModel.ts` change (RC7-7, task T-8) is **not yet written** in `-s7` as of this review. Until it lands the route still derives cached input as half the input for OpenAI even when the column is above 0. That gives false 409s, never a wrong apply, but T-0 must confirm the merged rule equals the SQL CASE (RC-6 parity test); (d) a re-evaluated flag set that differs from the stored one (RC-7).

### Required changes

1. **RC-1 (High) Migration number.** `20261072` **and** `20261073` are taken: `origin/feature/bos-finance-health-4b`, commit `240b14de` (2026-10-17, "record boost refunds and disputes as dated events", `20261072_business_os_boost_reversal_events.sql`, `20261073_operator_test_account_cleanup_boost_reversal_events.sql`), also on disk in worktree `neuronforge-finance-health`. Neither is on main yet. **Use `20261074`** for the migration, rollback, checker, probe, source test, LW-5 name → file map and every doc reference. Re-check at T-0 with `git log --remotes --name-only -- 'supabase/migrations/2026107*'` plus every worktree's `supabase/migrations/`.
2. **RC-2 (High) Batch row first.** The `apply_batch_id` FK is checked at the end of each statement, so marking a line `applied` before its batch row exists fails with 23503. Insert the batch (pre-generated id, `line_count`, margin) **before** the first line UPDATE. Pin the order in the source test; the probe applies two lines and finds both pointing at one batch.
3. **RC-3 (High) Lock design.** In `ai_price_apply_lines`, in this order: (1) shape and admin checks; (2) read each line's unit key from its insert-only columns (no lock needed) and sort **in SQL**; (3) advisory keys in that order; (4) `LOCK TABLE public.ai_model_pricing, public.ai_model_image_pricing IN ROW EXCLUSIVE MODE` (allowed by the INSERT grant), before any live row is touched; (5) per line: `FOR UPDATE` the line and re-check `pending`; lock **all** active rows of the unit `FOR UPDATE` in one statement with no `LIMIT`; then, in **separate** statements, find the newest charged row and run the stale check. Add the function attribute `SET lock_timeout = '5s'` to the apply and dismiss functions. The route maps 55P03 and 40P01 to 409 `busy` ("Someone else is changing prices. Try again.").
4. **RC-4 (High) Runbook (O-4).** Paste 2 gets `LOCK TABLE public.ai_model_pricing IN SHARE ROW EXCLUSIVE MODE;` straight after `BEGIN;` (it runs as `postgres`). It conflicts with the apply's up-front ROW EXCLUSIVE, so the two strictly serialise, with no key to type and no deadlock. Update `emergencyRunbook.source.test.ts` to pin the line and its position. One sentence in the runbook says why ("waits for any in-app Apply to finish").
5. **RC-5 (High) Dismiss lock order.** `ai_price_dismiss_lines` takes the same advisory keys in unit-key order (sorted in SQL) before its `FOR UPDATE`, exactly as apply does. The source test pins that the key expression in both new functions is byte-equal to the one in `20261066` (`'ai_price_proposal_lines' || chr(124) || concat_ws(chr(124), provider, model_name, kind, coalesce(image_size, ''), coalesce(image_quality, ''))`).
6. **RC-6 (High) Exact decimals, and a parity test.** `findLinesForDecision` selects every generated per-token column and every `current_*` column as `::text` (as `listActiveExact`). `applyDecision.ts` compares them with `lib/ai/pricing-research/decimal.ts` **by value**, never through `Number()`. SQL compares numerics with `=` / `IS NOT DISTINCT FROM`, never `::text`. Add a parity test: the route's expected cached rate, the SQL CASE (the same fixtures run through the probe) and slice 7's charging rule (OpenAI: column above 0, else half the input; other providers: none, F-1) agree on column NULL, 0 and above 0, on OpenAI and another provider, including an input with an odd last digit.
7. **RC-7 (Medium) Apply-time flags (O-14).** The route re-runs `evaluatePendingLine` against today's context: a hard refusal is 422 `refused`; if the re-evaluated **blocking** flags differ from the line's stored flags, that is 409 `stale` ("record the price again"). The override requirement uses the **stored** flags, which is what the function enforces.
8. **RC-8 (Medium) Grants on `ai_model_pricing` (SC6-8 + O-6).** `REVOKE ALL` from PUBLIC, `anon`, `authenticated` and `service_role`; `GRANT SELECT` to `authenticated`; `GRANT SELECT, INSERT, UPDATE (retired_date)` to `service_role`; `DROP POLICY ai_model_pricing_admin_write`; new `COMMENT ON TABLE`. This removes MAINTAIN from all three roles (the slice 2 capture shows `anon` and `authenticated` with SELECT + MAINTAIN), matching `ai_model_image_pricing`. The slice 8 checker asserts, with `has_table_privilege`: `service_role` holds SELECT and INSERT and not UPDATE (table-level), DELETE, TRUNCATE, REFERENCES, TRIGGER or MAINTAIN, and holds column UPDATE on `retired_date` only; `anon` holds nothing; `authenticated` holds SELECT only; exactly one policy (`ai_model_pricing_admin_select`). `20261052` is not edited.
9. **RC-9 (Medium) Rollback and emergency stop.** (a) The new rollback refuses only when a batch exists or a line is `applied`. A `dismissed` line is valid under the slice 3 schema, so it must not block the rollback; otherwise §9 step 7 (dismissing the UF-6 test line) would end the rollback option on day one. (b) Document an emergency stop that works in **any** state, run as `postgres`: `REVOKE EXECUTE ON FUNCTION public.ai_price_apply_lines(uuid, jsonb, jsonb) FROM service_role;` (and its re-grant), in the rollback file header and in §9. The new rollback and the slice 3 rollback both take `LOCK TABLE public.ai_model_pricing, public.ai_model_image_pricing, public.ai_price_proposal_lines IN SHARE ROW EXCLUSIVE MODE` before their guard (as planned).
10. **RC-10 (Medium) Old checkers that will FAIL by design; tell the user first.** After the migration: slice 2 `scripts/check-ai-model-pricing-slice2-migration.sql` row **150** (policy count 2 → 1) and rows **160** for `service_role` UPDATE, DELETE, TRUNCATE, REFERENCES and TRIGGER, and `anon` SELECT. Slice 3 `scripts/check-ai-price-pending-area-migration.sql` row **103** (37 → 38 columns) and **210** (UPDATE columns). After the first real apply (slice 12): slice 3 rows **500/501**, and slice 2 row **310** after the first image apply. The Dev confirms each row id against the files at T-2. Each old file's header line names these rows. §9 step 4 tells the user, in plain words, before anything is pasted: "the slice 2 and slice 3 checks are expected to show FAIL on these rows from now on; read the slice 8 check instead". The slice 8 checker re-asserts every one of them in its new form.
11. **RC-11 (Medium) Fingerprint in §9 step 2.** The BQ-7a runbook row (2026-10-16 19:56 UTC) changed the "all models" fingerprint from `76c7cfe8…` to `8d6bbb2344a2c9940e65fd51ca6ccf82`. Step 2 re-captures the fingerprint and step 4 compares with that capture; do not quote either constant as the expected value.
12. **RC-12 (Medium) Audit.** Use the list form, one `logAndFlush([...])` call for every applied line (one flush, one bounded wait), not up to 50 sequential flushes. Pins on today's main: 205 → 208 registered, 63 → 66 shared, `bos` and `agentspilot` unchanged. Re-count after the rebase: `feature/bos-finance-health-4b` is in flight. Entity `ai_pricing`; `details.entity_kind` `price_line` / `apply_batch`, as the slice 3/5 events do.
13. **RC-13 (Low) Schema details.** The batch trigger also refuses any UPDATE once `OLD.margin_review_done` is true (no note rewrite after done). Add a partial index on lines `(apply_batch_id) WHERE apply_batch_id IS NOT NULL` for the slice 9 joins. No column named `user_id` on the batch table (the `businessOwnedTables` scanner keys on it; `applied_by` is right). `RETURNS TABLE` output names are `out_`-prefixed, as in slice 3, to avoid PL/pgSQL name clashes. The batch table is platform-only, with no owner column, so no data-export descriptor is needed (state this in the PR).
14. **RC-14 (Low) Route mapping.** 23505 from the function (a same-day active-key collision with a runbook row) → 409 `stale`. O-10 → 422 `override_not_needed`. 55P03 / 40P01 → 409 `busy` (RC-3). `details` only in development.
15. **RC-15 (Low) Cached input in the drawer.** Show cached input old → new, including "derived (half of input)". For a non-OpenAI line with a cached price, say it is stored but **not charged today** (only `openaiProvider` charges cached reads after slice 7). When the new line has no cached price and the live row has one above 0, say the stored cached rate is removed and the default rule applies.
16. **RC-16 (Low) Test cost.** No new repository walk: extend LW-1's existing file list. Drawer and notice tests render the components directly with a mocked `fetch`; at most one page-level wiring test. Source tests read named files only. Migration source test, pure tests and route tests are all offline. This keeps the existing Jest job's time flat (no-added-CI-time rule) and the page suites fast.

### Checks that passed

- **Paste safety and PG17.** The planned rules (the word "into" only in `INSERT INTO`, no comments, no single-letter aliases, `chr()` punctuation, no backslash, no RETURNING / SELECT … INTO, ids pre-generated) match slice 3 and avoid the SQL-editor bug. `hashtextextended`, `pg_advisory_xact_lock`, `gen_random_uuid` resolve from `pg_catalog` under `search_path = ''`. `SELECT … FOR UPDATE` needs UPDATE on at least one column, which the column grants provide on all three tables. The FK checks from the live tables to the lines run as the table owner. The line transition trigger already forbids edits after `applied` / `dismissed`, so the new column grants cannot rewrite a decided line.
- **Grants (SC6-8).** As specified, plus RC-8. Batches: RLS on, admin SELECT policy, `authenticated` SELECT, `service_role` SELECT, INSERT and column UPDATE of the four review columns: the credit-lots / slice 3 precedent. Functions: revoke from PUBLIC, `anon`, `authenticated` and `service_role`, then EXECUTE to `service_role` only; the trigger function is revoked only.
- **`livePriceWrites` LW-3 / LW-5.** As §2.8: LW-3 adds `ai_price_dismiss_lines` to `AiPriceProposalRepository.ts`, and the new `AiPriceApplyRepository.ts` → table `ai_price_apply_batches`, functions `ai_price_apply_lines` and `ai_price_apply_batch_review_done`. LW-5 `SQL_FUNCTIONS_ALLOWED = ['ai_price_apply_lines']`, pinned to the one migration file (now `20261074`), with non-vacuity and the negative control. Add to the source test: every live-table UPDATE in the apply body sets `retired_date` only (the grant enforces it too). `AiModelImagePricingRepository.ts` stays read-only (LW-2, slice 7). The existing LW-4 control that names `ai_price_apply_lines` in `20991231_x.sql` keeps passing under the name → file map.
- **Routes (`new-api-route`).** `requireAdmin` is the first statement; strict Zod; Pino child with `correlationId`; repository only; `runtime = 'nodejs'`; audited money write flushed before the response; 401/403/400 tests; injected `adminUserId` / price / model keys → 400 with no repository call. This satisfies the `tenant-isolation-guard` Step 7 equivalent for a global catalog.
- **Production order (§9).** Migration before code is correct (slice 6 code no longer writes the live tables, and the new code needs the new functions). Preconditions: slices 6 **and** 7 merged and deployed. Rollback as `postgres` with the lock; plus RC-9 (b) as the fast stop.

### Business questions

None new. B-1..B-4 are decided (above).

### Approval

[x] Workplan approved with conditions. Proceed to implementation after slice 7 merges, with RC-1..RC-16 folded into this workplan first (RC-1..RC-5 before T-1).

---

**SA Code Review — 2026-10-17** (worktree `neuronforge-model-pricing-s8`, uncommitted, on origin/main `c32a0093`; read-only; targeted Jest run: 37/38 suites, 707/713 tests pass, the only failure is the known CRLF `openaiPricingAdapter.test.ts`, which this slice does not touch; admin census re-counted from disk: 78 files, 106 handlers, 6 without `requireAdmin`. No live catalog query: the grants come from the slice 2 capture, as at workplan review)
**Status:** ✅ Code approved for QA, with conditions. CR8-1 and CR8-2 must be fixed before QA signs off. SA spot-checks both fixes; no second full review is needed. CR8-3 is a doc fix that must land before the production apply. The rest are Low.

### Verdict

The migration is correct as written. I traced it statement by statement for PG17 and found no defect.
- **Locks and keys:** the advisory key string is the same as `20261066`'s (`'ai_price_proposal_lines' || chr(124) || unit_key`). It is taken in SQL-sorted order in apply and in dismiss. Apply then takes ROW EXCLUSIVE on both live tables, which the INSERT grant permits. The batch row is inserted before any line UPDATE. Each line is locked FOR UPDATE, and `PERFORM … FOR UPDATE` locks every active row of the unit, with no LIMIT. The future-date check, the charged-row lookup and the stale check each run as separate statements after the locks.
- **Stale check and refusals:** the F-1 CASE is OpenAI-only and uses `IS NOT DISTINCT FROM` against numerics. `current_row_id` is resolved by kind. `image_setting` always raises P8002. The override rules are P8003 and P8006, and the blocking list equals `BLOCKING_FLAGS`.
- **Writes:** every live-table UPDATE sets only `retired_date` (the narrowed grant enforces this too). Inserts carry provenance, and image lines go to the image table. A cached rate is written only when above 0.
- **Review and trigger:** the batch trigger allows only false → true and refuses any UPDATE once a review is done. B-4 holds: no `by <> applied_by` rule.
- **Grants, policies and paste safety:** grants, the policy drop and both comments match RC-8 and O-16. All four functions are SECURITY INVOKER with `search_path = ''`, and EXECUTE goes to service_role only. The paste-safety rules hold.
- **Rollback, checker and probe:** the rollback refuses only on a batch or an applied line, and takes SHARE ROW EXCLUSIVE before its guard. The slice 3 rollback gets the same lock line. The checker is read-only and parses before the migration. The probe is one DO block that always raises.
- **Routes:** each route runs `requireAdmin` first, then strict Zod. The route-side recompute uses exact decimals. All refusal codes are mapped and tested. All audit entries go in one `logAndFlush([...])` call, and the refresh is bounded to 2 s. Logging is Pino with a correlationId, and data access goes through repositories only.
- **Guards:** LW-3 and LW-5 are tightened correctly, with a non-vacuity check and a negative control.

Two things need fixing before QA: the words an admin sees when the emergency stop is on, and focus handling for the inline panel (D-1).

### Code Review Comments

1. **CR8-1 — `lib/ai/pricing-research/decisionErrors.ts:90`, `docs/runbooks/AI_MODEL_PRICE_EMERGENCY_SQL_RUNBOOK.md` (new "Stopping every in-app Apply" subsection) — Priority: Medium.** Under the RC-9 emergency stop (`REVOKE EXECUTE … FROM service_role`), PostgREST returns SQLSTATE `42501`. The route maps that to `not_admin_row`, and the admin sees "Your admin access is not recorded in the admin list, so prices cannot be changed." That message is wrong during an incident. The runbook also promises different words ("The prices could not be applied"). **Fix:** keep the function's 42501 (RC-ruled) and change the `not_admin_row` text so it is true in both cases, for example: "Prices cannot be changed right now: your admin access is not recorded, or an operator has switched Apply off. Ask an operator." Make the runbook sentence quote exactly the words the page shows. In the apply route test, assert the 42501 row's `error` text, so a later edit cannot let the two drift apart again.
2. **CR8-2 — `app/admin/system-config/components/PriceDecisionPanel.tsx` (D-1 condition) — Priority: Medium (accessibility on the money action).** The row's Apply or Dismiss button can be far down a long table, but the panel opens above the table and focus stays on the row button. On a scrolled page nothing visible happens, and a screen reader announces nothing. **Fix:** on mount, move focus to the panel heading (`tabIndex={-1}` on the `h3`, focused in an effect) and call `scrollIntoView({ block: 'start' })`. When Cancel is pressed, return focus to the row button that opened the panel, or to "Apply selected". Add one render test asserting that focus lands in the panel. The manual-entry form has the same gap, but it is out of scope here: do not change it in this slice.
3. **CR8-3 — §9 steps 2 and 3 — Priority: Low (doc, but it must land before the production apply).**
   - (a) Step 2 must name the query. Run `scripts/check-ai-price-apply-migration.sql` **before** the migration (it parses without the new objects; its VERDICT then says FAIL, as expected) and copy rows V5 and V6. Step 5 compares the same rows after the migration. This keeps the fingerprint expression identical on both sides; the slice 2 checker rounds differently.
   - (b) Step 3 must expand row 160 into the exact six FAIL rows, and add **slice 2 row 130** to the "later" list (it fails after the first token apply, because `proposal_id` is then set). The confirmed list is in "Production apply order" below.
4. **CR8-4 — `lib/ai/pricing-research/applyDecision.ts` `marginItemsFor` — Priority: Low.** When the new token line has no cached price, the "cached input" unit is skipped. For OpenAI the charged cached rate still changes, either because the stored rate is removed or because the derived half moves with the input. B-1 still holds, because the prompt is raised per model, but the item under-reports that change. **Fix (this slice preferred, slice 13 acceptable):** for OpenAI token lines, add a "cached input per 1M" change. Old = `current_cached_input_cost_per_token`. New = the line's cached rate if above 0, else half the new input, computed with `decimal.ts`.
5. **CR8-5 — concurrency note, no code change — Priority: Low.** The §2.3 claim "the rollbacks conflict at the first statement on either side" is slightly too strong. Apply reads `ai_price_proposal_lines` (ACCESS SHARE) before it takes its ROW EXCLUSIVE table lock. A rollback that starts in that gap holds SHARE ROW EXCLUSIVE on the live tables, then needs ACCESS EXCLUSIVE on the lines table for its ALTER and DROP. That is a deadlock shape. Postgres detects it (40P01) and aborts one side cleanly: Apply answers 409 `busy`, or the operator re-runs the rollback. Nothing can be half-applied. Record this in §2.3 as known and acceptable; reordering would break RC-3's advisory-then-table order.

### Rulings on D-1..D-9

| # | Ruling |
|---|---|
| D-1 | ✅ Accepted: the inline panel matches the manual-entry form beside it and adds no new layout part. **Condition: CR8-2** (focus and scroll) |
| D-2 | ✅ Accepted. Pasted files cannot carry comments (the slice 3 paste-safety rule, pinned by the tests), so a header is impossible without weakening that rule. The emergency stop is in the runbook (pinned by `emergencyRunbook.source.test.ts`) and in §9. The RC-10 rows are told to the user in §9 step 3, corrected by CR8-3. The old checkers stay untouched (O-15) |
| D-3 | ✅ Accepted. The per-1M text is the exact source of the generated columns. The route never compares the new price per token, and the function reads the generated numerics itself. Every `current_*` column is read as `::text`, which is what RC-6 protects |
| D-4 | ✅ Accepted. `cross_check_differs` and `retiring` are evidence from a fetch round, and the server cannot recompute them. Comparing them would mark every such line stale for ever. The stored flags still drive the override requirement in both layers, so a line carrying them always needs a written override. `large_move` depends only on today's charged price and the bounds, both of which the route has |
| D-5 | ✅ Accepted (one code; DETAIL `not_needed` / `already_done`, mapped and tested) |
| D-6 | ✅ Accepted. `appliedAt` plus "In effect on all servers within 1 hour." is exactly O-12 and slice 7 note 3 |
| D-7 | ✅ Accepted. `logAndFlush` already never rejects, so the `.catch` is unreachable belt-and-braces. It is harmless and documents intent, so keep it |
| D-8 | ✅ Accepted. Optional fields keep older read-model doubles valid. The comparison read fails as a whole if the margin read fails, which is correct: a missing prompt must not pose as "no prompt" (B-1). The consequence is that the new code must not be deployed before the migration (see the apply order) |
| D-9 | ✅ Accepted as safe. LW-3 pins `AiPriceProposalRepository.ts` to `ai_price_proposals`, `ai_price_proposal_lines` and two functions, so it cannot name a live table and cannot read the live cached column; the only match is the `current_` snapshot column. Optional later improvement: give G-2's matcher a word boundary (`(?<![a-z_])cached_input_cost_per_token`), so snapshot columns stop matching and the allow-list line can go |

### Other checks (pass)

- **Routes:** `requireAdmin` is the first statement in all three. Strict Zod: injected `adminUserId`, price or margin → 400, and the repository is never called. Line ids are distinct, there are 1 to 50 lines, reasons are 3 to 500 characters after trim, and the path id must be a uuid. Every mapping in the brief is implemented and tested: 55P03 / 40P01 → 409 `busy`, 23505 / P8002 → 409 `stale`, P8006 → 422 `override_not_needed`, P8007 → 409 `starts_later`. `details` appears only in development. The F-5 refresh race clears its timer, and a refresh that rejects late is absorbed by the race, so there is no unhandled rejection. The RC-7 recheck uses `large_move` only, per D-4.
- **Tenant isolation:** this is an owner-less global catalog (skill step 5). The admin id comes from the session and is re-checked in SQL. The body carries ids and words only, and every price is read from the locked line.
- **UI:** the reason is pre-filled from the line's own source and date and stays editable. Override fields are never pre-filled and are required on blocking lines. Bulk "Apply selected (n)" works, and image rows apply their whole pending set. The margin notice behaves as B-1..B-4 require: a link to `?tab=costs`, "Mark done" with a required note, and no prompt for "not used yet" models. The "stored, not charged" and "derived (half of input)" labels and the removed-rate note are there (RC-15). The image-set-incomplete warning is warn-and-allow (O-19). Only "within 1 hour" is claimed, and "immediately" appears nowhere. NW-1 holds: `page.tsx` has no write, and `priceReview.source.test.ts` pins that only `priceApply.ts` (plus the two earlier writers) posts.
- **Guards:** LW-5 allows `ai_price_apply_lines` only in `20261079_ai_price_apply_and_dismiss.sql`, with non-vacuity and a `20991231_x.sql` negative control. `chargeParity` is untouched. Audit pins: 214 / 72, with `bos` 58 and `agentspilot` 84 unchanged. Register: 106 = 100 + 6, rows 111 to 113.
- **Runbook:** the paste 2 lock sits straight after `BEGIN;`, and the test pins both its text and its position (CRLF-normalised). The "one unit" rule still counts statements. The source test still means something.
- **Logging:** no `console.*` in any touched non-test file.

### Optimisation Suggestions

- Hint and error texts in the panel and the margin note are not linked with `aria-describedby`, and required fields lack `aria-required`.
- `listOpenMarginReviews` caps at 20 without telling the admin. Show "and N more", or raise the cap.
- The slice 8 checker leaves the image table's table-level privileges to slice 2 row 330, which still passes. That is acceptable.

### Production apply order (confirmed, with CR8-3 folded in)

0. **Before anything is pasted, the PR must not auto-merge.** It is migration-gated: new code before the migration breaks the whole pricing page (D-8) and has no functions to call. Merge manually, only after step 5 passes.
1. Preconditions: slices 6 and 7 are merged **and deployed**; `20261079` is still free on main (re-check: `neuronforge-de8a` had used the number locally).
2. Before-capture (read-only): run `scripts/check-ai-price-apply-migration.sql`. VERDICT FAIL is expected at this point. Copy V5 (row counts) and V6 (fingerprint). Also capture the line state counts.
3. Tell the user, in plain words, that **these old checks will say FAIL from now on, by design**:
   - **`scripts/check-ai-model-pricing-slice2-migration.sql`**: VERDICT, and row **150** (the pricing table now has one policy, not two). Row **160**, six rows:
     - `anon SELECT`;
     - `service_role UPDATE`;
     - `service_role DELETE`;
     - `service_role TRUNCATE`;
     - `service_role REFERENCES`;
     - `service_role TRIGGER`.

     The rows `authenticated SELECT`, `service_role SELECT` and `service_role INSERT` still pass.
   - **`scripts/check-ai-price-pending-area-migration.sql`**: VERDICT, row **103** (the lines table has one more column, `apply_batch_id`) and row **210** (service_role may also update `decision_reason`, `override_reason` and `apply_batch_id`).
   - **Later, by design:**
     - after the first real token apply (slice 12): slice 3 row **500** and slice 2 row **130**;
     - after the first image apply: slice 3 row **501** and slice 2 row **310**.
   - `scripts/check-ai-price-submit-pending-fetch-migration.sql` keeps passing.
4. Paste and run `20261079` (one transaction).
5. Run the slice 8 checker: VERDICT PASS. V5 and V6 must equal step 2 (the migration changes no price).
6. Run the probe in a fresh tab. Expected: `PROBE PASS … this error is expected and rolls everything back`. Re-run the checker: V5 and V6 are unchanged.
7. Merge and deploy the code.
8. After deploy: check the page (Apply, Dismiss, help). Never run a test Apply on a real model. With the user's OK, dismiss the UF-6 test line (zero charge effect; it does not block the rollback, RC-9).
9. Record everything in Commit Info.

The emergency stop and the rollback limits are unchanged from §9.

### Code Approved for QA: Yes, conditional on CR8-1 and CR8-2 (SA spot-check); CR8-3 before the production apply

---

**SA spot-check — 2026-10-18** (a diff-only review of the fixes, in worktree `neuronforge-model-pricing-s8`, merged with origin/main `f7f69aaf`, uncommitted. Targeted Jest: 37 of 38 suites and 719 of 725 tests pass. The only failure is the known CRLF case, `openaiPricingAdapter.test.ts`, which this slice does not touch. `20261079` is still free on main: 74–78 are taken, 79 is this slice. The migration body is unchanged at 511 lines.)
**Status:** ✅ Approved. CR8-1..CR8-5 are resolved, and the QA additions are sound. Nothing blocks QA sign-off or the production apply order in §9.

| Item | Result |
|---|---|
| CR8-1 | ✅ **Resolved.** `not_admin_row` now reads "Prices cannot be changed right now: your admin access is not recorded, or an operator has switched Apply off. Ask an operator." Runbook §6 quotes it exactly. `emergencyRunbook.source.test.ts` builds the quoted string from `decisionAnswer('not_admin_row').error`, so the two cannot drift. The route test asserts the 42501 text |
| CR8-2 | ✅ **Resolved.** The heading has `tabIndex={-1}` and takes focus on mount, with a guarded `scrollIntoView({ block: 'start' })`. The page stores the opening button (row Apply or Dismiss, or "Apply selected"), and Cancel focuses it again. Render tests cover both the focus on open and the focus return on Cancel. After a successful decision the panel unmounts, and the always-mounted `role="status"` notice announces the outcome. That is acceptable |
| CR8-3 | ✅ **Resolved.** Step 2 runs the slice 8 checker before the migration and keeps V5 and V6. Step 3 lists the six exact row-160 rows and adds slice 2 row 130 to the "later" list. Step 7 says to merge by hand, with no auto-merge |
| CR8-4 | ✅ **Resolved.** `newChargedCachedPer1m` uses the line's own cached price, or, for OpenAI without one, half the new input (computed with `decimal.ts`). For other providers it returns no change. Tested |
| CR8-5 | ✅ **Resolved.** §2.3 records the short rollback-vs-apply deadlock as known and accepted (40P01 → `busy`, or re-run the rollback) |
| `applied_unconfirmed` | ✅ **Sound.** `committed` is set only after the RPC returned rows without an error. Any later throw (a refresh throwing synchronously, or the audit) answers 500 `applied_unconfirmed` with "The prices were applied, but the page could not confirm it. Reload the page to see them." It never says "Nothing was changed". Tested with an audit that throws synchronously. If the admin presses confirm again, the answer is a harmless 409 `not_pending` |
| Repository row count | ✅ **Correct.** A count that differs after commit is logged at error and the rows are returned, so the route cannot claim an applied price was not applied. The function either returns one row per line or raises, so the route's `applied.length === 0` branch is unreachable in practice |
| Browser 50-line cap | ✅ **Correct.** It counts pending **lines**, not rows. "Apply selected" is disabled, linked with `aria-describedby` to a `role="alert"` explanation. Zod and the function still enforce the cap |
| `moreMarginReviews` | ✅ **Correct.** The repository reads 21, the page shows 20, and it says that more are open |
| Admin register | ✅ **Re-counted from disk:** 81 files, 110 handlers, 6 without `requireAdmin`, so **110 = 104 + 6**. Rows 114–117 name the four routes main added: `business-os/finance/history#GET`, `users/[id]/data-exports#GET` and `#POST`, and `…/parts/[partNo]/download#POST`. All four files exist |

**Optional, non-blocking:**
- `page.tsx` declares its own `MAX_APPLY_LINES = 50`. Importing `MAX_DECISION_LINES` from `applySchema.ts` would stop the two from drifting apart.
- On `applied_unconfirmed`, the panel could call the page's re-read itself instead of asking the admin to reload.
- A non-OpenAI line with its own cached price shows a "cached input" change in the margin item. Adding the "stored, not charged" words there would match the panel.

## QA Testing Report

**QA — 2026-10-18** (worktree `neuronforge-model-pricing-s8`, uncommitted, code as of 22:52 on 2026-10-17, so **before** any CR8 fix; no DB write, no dev server, no source edit; mutants ran on a scratchpad copy only, since deleted)
**Test mode:** full (money path)
**Strategy used:** A + B (Jest: source, pure, route and render tests) + mutation testing on a scratch copy + static SQL checks + reasoned PG17 and concurrency review. The migration, checker and probe were **not** run (no DB). Option D (browser) is the user's post-deploy check below.
**Focus:** all (security, schema, api, ui, concurrency)
**Skipped:** live SQL run of the migration, probe and checker (no DB writes allowed; the probe is the runtime proof, in step 5 below); browser check (after deploy, by the user).
**Input source:** prompt keywords (TL brief)

### Test Coverage

| Acceptance criterion | Tested? | Result | Notes |
|---|---|---|---|
| MP-FR-8: per-row and bulk Apply; reason pre-filled; override empty | ✅ | Pass | Render tests; mutants U01 and U02 killed. CR8-2 (focus) still open |
| MP-FR-9: all or nothing; provenance; one audit row per line | ✅ | Pass (source) | One function, and every refusal raises; X01 (batch insert after the lines) killed; the runtime proof is probe P01 |
| MP-FR-10: "in effect on all servers within 1 hour" | ✅ | Pass | Route returns `appliedAt` plus the words; the refresh is bounded (R07 killed) |
| MP-FR-14: margin prompt (B-1..B-4) | ✅ | Pass, gaps | B-1 and B-3 mutants killed; image lines not covered (U04b survived); CR8-4 under-reporting of OpenAI cached input is open (Low) |
| UF-3: Dismiss needs a reason, not pre-filled | ✅ | Pass | U02b killed |
| RR-5: override never pre-filled | ✅ | Pass | U01 killed |
| Stale check per basis (2.2); exact decimals (RC-6) | ✅ | Pass | Route recompute killed (R03). SQL text pins killed (M04, M05, X05, X11). The logic-only mutant M04b is caught by probe P03, not by Jest |
| Blocking flags and overrides (RC-7, O-10) | ✅ | Pass | Route mutants R04 and R04c killed. The SQL P8003 logic (M07) is caught only by probe P07 |
| Grants (RC-8); policy drop; EXECUTE to service_role only | ✅ | Pass | M01, M11, M12, M12b, X06, X07, X09 killed |
| Lock design (RC-3, RC-5); lock_timeout; busy | ✅ | Pass, gap | X02, X04, X10, X14, M09, R05b killed. The key **order** is not pinned (X03 survived) |
| Rollback (RC-9) and slice 3 rollback lock | ✅ | Pass | RB04, RB05, RB07 killed |
| Runbook paste 2 lock (RC-4) | ✅ | Pass | RB01, RB02, RB03 killed |
| NW-1: `page.tsx` sends no write | ✅ | Pass | U06 killed |
| Authorisation: `requireAdmin` first; strict Zod; session admin id | ✅ | Pass, gap | Apply and dismiss mutants killed. Margin-review reading the body before the gate is not tested (R01c survived) |
| Emergency-stop wording | ❌ | Fail | CR8-1, confirmed independently (Bug 1) |
| 50-line cap | ⚠️ | Partial | Zod caps it. The source pin for the SQL cap is a substring that also matches 500 (M08 and M08b survived) |

### Test runs (counts verbatim)

| Run | Suites | Tests |
|---|---|---|
| 7 new suites | 7/7 | 144/144 |
| `app/admin/system-config`, run A (in parallel with B) | 11/11 | 162/162, 61.2 s |
| `app/admin/system-config`, run B | 11/11 | 162/162, 59.9 s |
| `app/api/admin/model-pricing` | 6/6 | 104/104 |
| `lib/ai` | 26/27 | 498/504 (the 6 failures are `openaiPricingAdapter`, CRLF only) |
| `lib/ai/pricing-research` | 16/17 | 346/352 (the same 6) |
| `supabase/migrations` | 45/45 | 2453/2453 |
| `npm run test:bos-entitlements` | 289/289 | 8807/8807 |
| `npm run test:authz-guard` | 2/2 | 203/203 |
| `lib/audit` | 16/16 | 187/187 |
| `npm run test:bos-llm` | 23/23 | 636/636 |
| Tailwind guard (`app/__tests__/tailwind-css-escape.guard.test.ts`) | 1/1 | 6/6 |
| `chargeParity` | 1/1 | **21/21**; `git hash-object` = `d1231341bf6ae57ce4a7fe15314a015ffcbff65e`; LF sha256 `cdb1aeaf…5d6e` (the raw CRLF checkout hashes differently, as expected) |
| `openaiPricingAdapter` on an LF `git -c core.autocrlf=false archive HEAD` export | 1/1 | **27/27** (6 fail in the CRLF checkout: the fixture has 217 CR characters, the HEAD blob has 0; the adapter, its test and its fixture are unchanged against origin/main) |

Slowest 5 tests in `app/admin/system-config` (run A / run B):

| Test | Run A | Run B |
|---|---|---|
| T-1 joined row | 1974 ms | 2008 ms |
| priceDecision row Apply | 1859 ms | 1285 ms |
| R-1 h1 and rows | 1640 ms | 1739 ms |
| M-1 non-decimal refused | 1349 ms | 1640 ms |
| T-1b two-row header | 1207 ms | not in top 5 |
| M-6b re-read | not in top 5 | 1273 ms |

All are under 2.1 s against the 5 s default timeout, so there is no flake risk.

### Mutation results

65 mutants: 53 killed, 12 survived. One of the 12 survivors is equivalent.

**Migration, from the brief**

- Killed:
  - M01: EXECUTE granted to authenticated.
  - M02: an UPDATE sets `input_cost_per_token`.
  - M03: DELETE instead of retire.
  - M04: the stale block deleted.
  - M05 and M05b: the cached CASE without `openai`, in both forms.
  - M06: future-dated rows not refused.
  - M07b: the blocking list missing `retiring`.
  - M09: dismiss without the advisory keys.
  - M11: service_role keeps UPDATE on `input_cost_per_token`.
  - M12 and M12b: anon keeps SELECT, in both forms.
- Survived:
  - **M04b**: the stale check disabled, with its text kept (`IF false AND NOT EXISTS`).
  - **M07**: the P8003 check disabled (`IF false`).
  - **M08 and M08b**: the cap raised from 50 to 500 in apply and in dismiss.
  - **M10**: the batch trigger allows done true → false.

**Migration, extra mutants**

- Killed:
  - X01: batch insert after the lines.
  - X02: no table lock.
  - X04: no lock_timeout.
  - X05: image_setting accepted.
  - X06: MAINTAIN granted to service_role.
  - X07: the write policy kept.
  - X08: a cached 0 written.
  - X09: SECURITY DEFINER.
  - X10: a different hash seed.
  - X11: the image cost ignored.
  - X13: an image UPDATE that sets the cost.
  - X14: `LIMIT 1 FOR UPDATE`.
- Survived:
  - **X03**: the advisory keys taken `ORDER BY 1 DESC`.
  - **X12**: the RAISE after the apply function's admin_users check removed.

**Routes**

- Killed:
  - R01: `requireAdmin` not first in apply.
  - R01b: `requireAdmin` not first in dismiss.
  - R02: Zod accepts a `price` field.
  - R02b: Zod accepts extra body keys.
  - R03: the recompute skipped.
  - R04: the flag recheck skipped.
  - R04b: the bounds refusal skipped.
  - R04c: the override check skipped.
  - R05: 23505 mapped to 500.
  - R05b: 55P03 and 40P01 unmapped.
  - R06: the apply audit flush without a catch.
  - R07: the refresh without a timeout.
  - R09: details sent outside development.
- Survived:
  - **R01c**: margin-review reads the body before `requireAdmin`.
  - **R06b**: the dismiss flush without a catch.
  - **R06c**: the apply audit not awaited.
  - R08, **equivalent**: admin id taken from the body. Strict Zod already refuses `adminUserId`, so the mutant can never act.

**UI**

- Killed:
  - U01: the override pre-filled.
  - U02: the reason not pre-filled.
  - U02b: the dismiss reason pre-filled.
  - U03: a margin prompt for a "not used yet" model (B-3).
  - U04: the margin prompt hidden for a Business OS model (B-1).
  - U05: a non-OpenAI cached price not labelled.
  - U05b: "cached removed" not labelled.
  - U06: `page.tsx` sends a POST.
  - U07: the margin link wrong.
- Survived:
  - **U04b**: the margin prompt skips image lines (B-1 includes images).

**Runbook, rollbacks and probe**

- Killed:
  - RB01: the paste 2 lock removed.
  - RB02: the paste 2 lock moved after the DO block.
  - RB03: the paste 2 lock weakened to ROW EXCLUSIVE.
  - RB04: the rollback lock removed.
  - RB05: the rollback refuses on a dismissed line.
  - RB06: the probe stops raising.
  - RB07: the slice 3 rollback lock removed.
- Survived: none.

**Why the survivors survive**

- M08 and X03: `toContain('NOT BETWEEN 1 AND 50')` also matches `… AND 500`, and `toContain('ORDER BY 1')` also matches `ORDER BY 1 DESC`.
- M04b, M07, M10 and X12: the source test pins text, not logic.
- The probe catches M04b (P03) and M07 (P07). It does not catch M08, M10 or X12, and no runtime check can catch X03.
- Per D-7, `logAndFlush` never rejects, so R06b matters little. R06c does matter: the audit must be flushed before the response.

### Static checks

| Check | Result |
|---|---|
| Paste safety (migration, rollback, checker, probe, slice 3 rollback) | ✅ "into" appears only as `INSERT INTO` (3 in the migration, 3 in the probe, 0 elsewhere); 0 `--`; 0 `/*`; 0 backslashes; 0 non-ASCII characters; no single-letter aliases |
| Probe always raises | ✅ It is one DO block that ends in `RAISE EXCEPTION USING MESSAGE = 'PROBE ' …` on every path. The early exits (read-only tab, no admin) also raise. It has no RETURN and no COMMIT, and covers P01–P14 |
| No `console.*` | ✅ 0 in every changed or new non-test `.ts`/`.tsx` file |
| No backslash followed by a hex digit in docs | ✅ 0 in the four changed docs (scanned with a node regex) |
| Charging files untouched | ✅ No diff in `lib/ai/pricing.ts`, `chargePricing.ts`, `lib/ai/providers` or `lib/business-os`. The only `lib/ai` test change outside pricing-research is the D-9 allow-list line in `chargeSources.guard.test.ts` |

### PG17 reasoning on `20261079` (not run)

QA independently agrees with SA's code-review verdict that the migration is correct.

- **Privileges as service_role (the functions are SECURITY INVOKER):**
  - `LOCK TABLE … ROW EXCLUSIVE` is allowed by table-level INSERT on both live tables; the image table already has INSERT from `20261053`.
  - `SELECT … FOR UPDATE` on the live tables needs UPDATE on any one column, which `retired_date` provides.
  - The line UPDATEs use only granted columns: the slice 3 columns plus `decision_reason`, `override_reason` and `apply_batch_id`.
  - `REVOKE ALL ON TABLE` also removes the old column grants.
  - service_role has BYPASSRLS.
  - EXECUTE on the trigger function is not checked when the trigger fires.
- **Lock order:**
  1. Shape and admin checks.
  2. Unit keys, sorted in SQL.
  3. Advisory keys.
  4. `LOCK TABLE`.
  5. Batch INSERT.
  6. Per line: the line `FOR UPDATE`, then every active row of the unit `FOR UPDATE` (PERFORM fetches every row). P8007, the charged-row lookup, the stale check, retire, insert and the line mark each run as separate statements.
- **Snapshots:** the function is VOLATILE under read committed, so every statement after a lock wait sees committed data.
- **FK order:** the batch row is inserted before the first line UPDATE. The live-row FKs point at the line that the same transaction has locked.
- **CHECK constraints:**
  - `state_shape`, `applied_batch_shape`, `review_shape` (with the trigger), `line_count` 1–50 and `ai_model_pricing_cached_input_valid` all hold.
  - `margin_items` is capped at 200. The route builds at most one item per model, so 50 lines give at most 50 items.
  - The partial unique index is safe because each row is retired before the new one is inserted.
- **Compiles:**
  - Every name resolves from `pg_catalog` under `search_path = ''`.
  - The `out_` names avoid clashes with variables.
  - `USING ERRCODE = 'P800x', DETAIL = …` is valid.
  - `proconfig` will match the checker.
  - Mixed table and column GRANTs are valid; slice 2 already used them in production.
- **Deploy order:** `buildComparison` throws if `ai_price_apply_batches` is missing, so the migration must go first. SA step 0 also says the PR must not auto-merge.

### Concurrency findings

| Pair | Finding |
|---|---|
| Apply vs apply, same unit | Both take the same advisory key, and the partial unique index allows only one pending line per unit. The second apply waits, then re-reads the line as `applied` and stops with P8001. No double active row |
| Overlapping bulk applies | Keys are taken in ascending order, all up front, before any row lock, so no lock cycle can form. The rows each apply touches are disjoint per unit. KEY SHARE locks on a shared proposal are compatible |
| Apply vs dismiss | The same keys in the same order (RC-5). The loser gets P8001. No deadlock |
| Apply vs submit | Submit takes the same keys in ascending order, one per unit (`20261069`). Apply holds all of its keys first, so no cycle forms. If a submit computed its snapshot before an apply committed, the next apply sees it as stale (P8002): it fails closed |
| Apply vs runbook paste 2 | SHARE ROW EXCLUSIVE and ROW EXCLUSIVE conflict, and paste 2 takes no advisory key, so the two strictly serialise.<br>• **Apply first:** paste 2's count and old-id checks refuse, or its insert hits 23505.<br>• **Paste 2 first:** Apply gets 55P03 → 409 `busy`, or it waits and then P8002.<br>No double active row across UTC midnight: Apply retires every row dated today or earlier and refuses later-dated rows. Images have no runbook paste |
| Apply vs rollbacks | **Apply first:** the rollback waits, then its guard refuses.<br>**Rollback first:** a short deadlock (Apply's early ACCESS SHARE on the lines table vs the rollback's ALTER). Postgres detects it and aborts one side, normally Apply (40P01 → `busy`). Nothing is half-applied. Same as SA CR8-5 |

### Issues Found

#### Bugs (must fix before commit)

1. **Emergency-stop answer is misleading** (= SA **CR8-1**, confirmed independently) — Files: `lib/ai/pricing-research/decisionErrors.ts`, `docs/runbooks/AI_MODEL_PRICE_EMERGENCY_SQL_RUNBOOK.md` — Severity: **Medium**
   - Steps: `REVOKE EXECUTE … FROM service_role`, then Apply.
   - Expected: words that are true during an incident, and the same words in the runbook.
   - Actual (code as reviewed): SQLSTATE 42501 → `not_admin_row` → 403 "Your admin access is not recorded in the admin list, so prices cannot be changed." The runbook says "The prices could not be applied". No price changes. Fix as CR8-1 says, including the test assertion on the 42501 `error` text.
2. **Apply / Dismiss panel takes no focus and does not scroll** (= SA **CR8-2**, confirmed in code) — File: `app/admin/system-config/components/PriceDecisionPanel.tsx` — Severity: **Medium** (accessibility on the money action)
   - The file has no `scrollIntoView` and no `tabIndex`. From a row far down the table, nothing visible happens. Fix as CR8-2 says, with the render test.
3. **Weak test pins on the money path** (survived mutants) — Files: `supabase/migrations/__tests__/ai-model-pricing-slice8.migration.test.ts`, the margin-review route test, the dismiss route test, `applyDecision.test.ts` — Severity: Low
   - Change:
     - pin the apply cap exactly, e.g. `NOT BETWEEN 1 AND 50 THEN`, and the dismiss cap the same way (M08, M08b);
     - pin the key loop order exactly, e.g. `ORDER BY 1` followed by a newline and `LOOP` (X03). Without that, RC-5's deadlock freedom is not enforced.
   - Add:
     - pins for the batch trigger condition (M10) and the admin_users RAISE (X12);
     - a "body never read" test for margin-review (R01c);
     - a test that the apply audit is awaited before the response (R06c);
     - an image line in the margin tests (U04b).
   - The code itself is correct today.

#### Performance Issues (should fix)

None:
- one RPC per apply;
- the cache refresh is bounded at 2 s;
- the audit is a single `logAndFlush` list;
- the `app/admin/system-config` suite time is flat (about 60 s).

#### Edge Cases (nice to fix)

1. **CR8-4 (agree, Low):** the margin item omits the OpenAI cached-input change when the new line has no cached price.
2. **Throw after commit:** if the apply route throws after the RPC has committed, it answers 500 "Nothing was changed" although the batch is applied. Example: the repository's row-count guard. Theoretical only.
3. **No 50-line cap in the browser:** "Apply selected" can exceed 50 lines (many image rows). Zod answers 400 and nothing is applied.
4. **Open margin reviews capped at 20:** `OPEN_REVIEW_LIMIT` hides the rest without saying so (as SA noted).

### Manual check for the user (after the migration and deploy)

1. **Before pasting**, know which old checks will now show FAIL, by design. Every other row in those checks still passes.
   - **Slice 2 check:** row 150, plus row 160 for six privileges:
     - anon SELECT;
     - service_role UPDATE;
     - service_role DELETE;
     - service_role TRUNCATE;
     - service_role REFERENCES;
     - service_role TRIGGER.

     That is 7 FAIL rows, plus VERDICT.
   - **Slice 3 check:** rows 103 and 210. That is 2 FAIL rows, plus VERDICT.
   - **Later:**
     - after the first token Apply: slice 3 row 500 and slice 2 row 130;
     - after the first image Apply: slice 3 row 501 and slice 2 row 310.
2. Run `scripts/check-ai-price-apply-migration.sql` **before** the migration. VERDICT FAIL is expected at this point. Copy the V5 row (counts) and the V6 row (fingerprint).
3. Paste and run `20261079`. It finishes with COMMIT and no error.
4. Run the slice 8 checker again. Expect **VERDICT PASS, "73 pass 0 fail"**, plus the two INFO rows. V5 and V6 must equal step 2.
5. In a fresh tab, run `SET default_transaction_read_only TO off` on its own, then the probe.
   - Expect an error that starts **"PROBE PASS  this error is expected and rolls everything back"**, with P01 to P14 all PASS.
   - Re-run the checker: V5 and V6 are unchanged.
6. Merge by hand and deploy. Open `/admin/system-config` and check:
   - the subtitle says "A live price changes only when an admin applies a provider price";
   - the help says "Apply or Dismiss";
   - rows with a pending price show a checkbox, **Apply** and **Dismiss**.
7. Click **Check provider prices** and wait. Find `gpt-4o-mini` with a pending price. If it has none, use another model that Business OS uses and that has a pending price.
8. Click **Apply** on that row.
   - The panel opens and takes focus (after the CR8-2 fix).
   - It shows ours → provider for each unit.
   - The reason is pre-filled: "Provider price change — source https://… (checked YYYY-MM-DD)".
   - There is no override field unless the line is flagged. A flagged line shows an empty override field that you fill in yourself.

   Then click Confirm.
9. Expect: "Applied at HH:MM UTC. In effect on all servers within 1 hour. A model Business OS uses changed: check plan margins in the prompt below."
   - The table re-reads and shows the new price.
   - A read-only check of `public.ai_model_pricing` for `openai` / `gpt-4o-mini`, newest `created_at` first, shows:
     - one row with `retired_date` NULL, `effective_date` today and `proposal_line_id` set;
     - the old row with `retired_date` today.
10. **Live within 1 hour:** after at most 60 minutes, run one Business OS chat on that model. Its recorded cost uses the new rate (see the Costs & credits tab or the usage row).
11. **Margin prompt:** a card appears above the table. It shows the model, its areas, and "input per 1M $old → $new (+x%)". **Review credit pricing** opens `/admin/business-os-llm?tab=costs`.
12. **Mark done:** type a note of at least 3 characters and click **Mark done**. The card goes, and stays gone after a reload.
13. **Dismiss another line**, for example the UF-6 test line:
    - the reason field is empty and required;
    - after Confirm the page says "Dismissed. No charge changed.";
    - the pending price is gone, and no live price changed.
14. **Audit trail** (entity `ai_pricing`). Expect:
    - one `AI_PRICING_APPLIED_LINE` (warning) per line, with old → new, the reason, the batch id, and the new and retired row ids;
    - one `AI_PRICE_MARGIN_REVIEW_DONE` (info), whose entity is the batch id;
    - one `AI_PRICE_LINE_DISMISSED` (info).
15. **Emergency stop:** check that runbook section 6 holds the pair `REVOKE EXECUTE ON FUNCTION public.ai_price_apply_lines(uuid, jsonb, jsonb) FROM service_role;` / `GRANT EXECUTE … TO service_role;`.
    - Do not run it on production.
    - Its quoted page words must match the CR8-1 text.
16. **Old checks again:** re-run the slice 2 and slice 3 checks. Only the rows named in step 1 FAIL. After step 8, slice 3 row 500 and slice 2 row 130 also FAIL.

### QA Re-pass — 2026-10-18 (after CR8-1..CR8-5 and the QA test-pin fixes)

This pass ran on the same worktree, now merged with origin/main `f7f69aaf` and still uncommitted. No DB write and no source edit. The mutants ran on a scratchpad copy; its `node_modules` junction was removed before the copy was deleted.

**Step 1: test runs (counts verbatim), all pass**

| Run | Suites | Tests |
|---|---|---|
| 7 new suites | 7/7 | 155/155 |
| `app/admin/system-config` | 11/11 | 164/164 (32.5 s) |
| `app/api/admin/model-pricing` | 6/6 | 108/108 |
| `lib/ai/pricing-research` | 16/17 | 349/355 (the 6 failures are the known CRLF `openaiPricingAdapter` failures; the adapter, its test and its fixtures are unchanged against origin/main, and it passed 27/27 on the LF export in the first pass) |
| `supabase/migrations` | 47/47 | 2512/2512 |
| `test:bos-entitlements` | 292/292 | 8817/8817 |
| `test:authz-guard` | 2/2 | 203/203 |
| `lib/audit` | 16/16 | 189/189 |
| `test:bos-llm` | 23/23 | 636/636 |
| Tailwind guard | 1/1 | 6/6 |
| `chargeParity` | 1/1 | 21/21; `git hash-object` `d1231341bf6ae57ce4a7fe15314a015ffcbff65e` (unchanged) |

Slowest 3 in `app/admin/system-config`:

| Test | Time |
|---|---|
| T-1 joined row | 1727 ms |
| page wiring: bulk cap, focus return and confirm | 1186 ms |
| T-1b two-row header | 1045 ms |

**Step 2: mutants (17 run: 16 killed, 1 survived)**

| Mutant | Result |
|---|---|
| M08 / M08b: the 50-line cap raised to 500 in apply and dismiss | Killed |
| M10: the batch trigger allows true → false | Killed |
| X03: the apply advisory keys taken DESC | Killed |
| X03b: the dismiss advisory keys taken DESC (new) | Killed |
| X12: the admin_users RAISE removed | Killed |
| R01c: margin-review reads the body before `requireAdmin` | Killed |
| R06b: the dismiss flush has no catch | Killed |
| R06c: the apply audit is not awaited | Killed |
| U04b: the margin prompt skips image lines | Killed |
| N01 (CR8-1): the old 42501 message comes back | Killed by both the runbook pin and the route test |
| N02 (CR8-2): no focus when the panel opens | Killed |
| N02b: no scroll when the panel opens | Killed |
| N03 (`applied_unconfirmed`): a throw after commit claims "Nothing was changed" | Killed |
| N04: the browser 50-line cap removed | Killed |
| N04b: the browser cap no longer disables the button | Killed |
| **M07**: the SQL P8003 check disabled | **Survived**. Not in the QA pin list. It stays covered by the route's 422 `override_required` (mutant R04c, killed in the first pass) and by probe P07 at apply time. Not blocking |

**Step 3: SQL paste safety (migration, rollback, checker, probe, slice 3 rollback): pass**

| Check | Result |
|---|---|
| "into" | Appears only as `INSERT INTO`: 3 in the migration, 3 in the probe, 0 in the other files |
| Comments, backslashes, non-ASCII | 0 `--`, 0 `/*`, 0 backslashes, 0 non-ASCII characters |
| Aliases | No single-letter aliases |
| Probe | Still ends in one `RAISE EXCEPTION USING MESSAGE = 'PROBE '`, with no RETURN and no COMMIT |
| Code and docs | No `console.*` in touched non-test files. No backslash followed by a hex digit in the 4 changed docs |
| Charging files | Untouched |
| CR8-1 wording | The new 403 words appear verbatim in both the runbook and the route test |
| CR8-3 | Folded into §9 and into the SA "Production apply order" (slice 2 row 130 added) |

### Final Status

- [x] All acceptance criteria pass — **ready for commit** (QA re-pass 2026-10-18).
  - CR8-1 and CR8-2 are fixed and pinned by tests.
  - The QA test-pin findings are fixed, except M07, which is covered by the route layer and the probe.
  - No open High or Medium bug.
  - Still owed before the PR merges: the PR must not auto-merge. Production follows the "Production apply order" and the manual check above, and the user runs both by hand.
- [ ] Issues found — Dev must address before commit

## Commit Info

| Item | Value |
|---|---|
| Branch | `feature/ai-model-price-review-slice8` |
| Commit | `9111fb779b7ebcab3957062ca18de8f44b1c6e23` (45 files, +6329 / -56) |
| PR | [#462](https://github.com/AgentsPilot/neuronforge/pull/462) |
| Frozen `chargeParity.test.ts` | hash `d1231341bf6ae57ce4a7fe15314a015ffcbff65e`, unchanged |

**Production apply (2026-10-18, by TL via the Supabase connector, user authorisation 2026-10-17):**

| Step | Result |
|---|---|
| Before (slice 8 checker V5 / V6) | token active 43, token retired 12, image rows 0; fingerprint `8d6bbb2344a2c9940e65fd51ca6ccf82`; no proposal lines; `ai_price_apply_batches` absent |
| Migration `20261079` | applied verbatim, no error |
| Slice 8 checker | VERDICT PASS, 73 pass / 0 fail; V5 and V6 unchanged |
| Probe | PROBE PASS, P01..P14 all PASS, rolled back |
| After the probe | 43 / 12 / 0, fingerprint `8d6bbb2344a2c9940e65fd51ca6ccf82`; 0 proposals, 0 lines, 0 batches, 0 probe rows |

Old checker rows that now FAIL by design (section 9 step 3): slice 2 VERDICT, rows 150 and 160; slice 3 VERDICT, rows 103 and 210.

---

## Change History

| Date | Change | Details |
|------|--------|---------|
| 2026-10-16 | Created | Dev workplan for R-9 row 8: migration `20261072` (apply batches, apply / dismiss / review functions, SC6-8 grant narrowing, policy drop, new comment), two-layer stale check per basis, routes, UI, guards, tests; O-1..O-18, B-1..B-4; no code written |
| 2026-10-16 | Updated: slice 6 merged, SA slice 7 note | Merged origin/main `ac674ceb` (slice 6, PR #441); `livePriceWrites.guard` references re-checked against the merged file. §2.2 rewritten to the binding SA note from the slice 7 review: the apply function now compares cached input against the charged rate (column above 0, else OpenAI half input, else NULL) with `IS NOT DISTINCT FROM` (supersedes "never compares the cached column"); `current_row_id` resolved by kind; image `table` checks `cost_per_image`; `image_setting` always stale (user decision 2026-10-16: the image-price setting no longer affects charging); apply writes the cached rate only as NULL or above 0. Effective time claims only "within 1 hour" (O-12 resolved). Image guardrail: whole-set apply and an incomplete-set warning (O-19, K-11). Image repository stays read-only. `20261072` re-checked free |
| 2026-10-17 | SA workplan review | Approved with conditions RC-1..RC-16: migration number moves to `20261074` (`20261072`/`20261073` taken by `feature/bos-finance-health-4b`); batch row before line marks; up-front `ROW EXCLUSIVE` table lock in the apply function plus a `SHARE ROW EXCLUSIVE` line in runbook paste 2 (replaces the advisory-key proposal for O-4); dismiss uses the submit lock order; exact-decimal stale check with a parity test; MAINTAIN revoked from all roles on `ai_model_pricing`; rollback blocked only by applied lines or batches, plus an EXECUTE-revoke emergency stop; old checker FAIL rows listed for the user. O-1..O-19 ruled; user decisions B-1..B-4 (2026-10-17) recorded |
| 2026-10-17 | RC-1..RC-16 folded in; user decisions recorded | Migration `20261074` (RC-1); batch row before line updates (RC-2); apply lock order with `LOCK TABLE … IN ROW EXCLUSIVE MODE` and the stale check in separate statements, `lock_timeout 5s`, 409 `busy` (RC-3); runbook paste 2 SHARE ROW EXCLUSIVE lock, to be coded in slice 8 (RC-4); dismiss takes the same advisory keys in order (RC-5); exact decimals and the parity test (RC-6); apply-time flags (RC-7); widened grants on `ai_model_pricing` (RC-8, O-6); rollback refuses only on a batch or an applied line, emergency `REVOKE EXECUTE` stop (RC-9); old checker rows named for the user (RC-10); fresh fingerprint capture (RC-11); one `logAndFlush` list (RC-12); RC-13..RC-16 details. Finding 3 corrected. B-1..B-4 decided by the user 2026-10-17; O-9 recorded as an R-4 amendment. T-0 checklist added. No code |
| 2026-10-17 | Migration number re-check | `20261074` and `20261075` found in worktree `neuronforge-de8a` (data export DE-8a, not pushed). Recorded in §1; to be settled at T-0 (next free today: `20261076`) |
| 2026-10-17 | Slice 7 SA code review F-1, F-5 | F-1: the expected cached value is OpenAI-only (`CASE WHEN line.provider='openai' AND live.cached_input_cost_per_token > 0 THEN live.cached_input_cost_per_token WHEN line.provider='openai' THEN live.input_cost_per_token/2 ELSE NULL END`); parity test, T-0 check and §1 aligned; the drawer labels a non-OpenAI cached rate "stored, not charged" (RC-15). F-5: the apply route bounds `refreshPricingCache()` with a timeout and claims only "in effect within 1 hour". Requirement slice 8 note amended to match |
| 2026-10-17 | Code complete (slice 7 merged; user: "start slice 8") | T-0 done (merge `c32a0093`, migration renumbered `20261079`, parity confirmed, pins 214 / 72). Migration, rollback, checker and probe; `AiPriceApplyRepository`; Dismiss and the decision read on `AiPriceProposalRepository`; `applyDecision.ts`, `applySchema.ts`, `decisionErrors.ts`; apply, dismiss and margin-review routes; the panel, the margin notice and the help text; `livePriceWrites` LW-3 / LW-5; runbook paste 2 lock and the emergency stop; three audit events; register rows 111–113. Deviations D-1..D-8 in section 10. Uncommitted, awaiting SA code review and QA |
| 2026-10-18 | SA code review CR8-1..CR8-5 and QA findings fixed | CR8-1: one neutral 42501 message (also the emergency stop), quoted exactly in runbook §6 and asserted in the route and runbook tests. CR8-2: the panel focuses its heading and scrolls into view; Cancel returns focus to the opening button; `aria-required` and `aria-describedby` added. CR8-3: §9 steps 2 and 3 corrected (slice 8 checker V5/V6 before and after; row 160's six rows; slice 2 row 130 added to "later"). CR8-4: the margin item shows the OpenAI cached-input change when the line has no cached price. CR8-5: §2.3 records the rollback-vs-apply short deadlock as accepted. QA: exact 50-line cap and ascending key-order pins, the trigger condition and admin RAISE pins, a probe step that tries to reopen a done review, route tests R01c / R06b / R06c, image lines in the margin tests, a 50-line cap in the browser, a truthful answer after commit (`applied_unconfirmed`), and a notice when more than 20 margin reviews are open |
